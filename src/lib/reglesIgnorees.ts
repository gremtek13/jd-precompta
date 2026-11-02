import type { MouvementsHorsDesLots } from './mouvementsDesVentes'
import { libelleCorrespond, normaliserPourRegle, refusMotif, sensDuMouvement } from './reglesAffectation'
import {
  nomDeLaRegleSelon, SENS_DES_REGLES_IGNOREES_EXPORTE, sensDeLaRegleSelon, vautPourLeSens, type RegleDeSens,
} from './sensDesReglesIgnorees'
import type { LigneBancaire, RegleBancaireIgnoree, StatutLigneBancaire } from './types'

// Le statut d'un mouvement À SON IMPORT : « ignoré » quand une règle « toujours ignorer » du dossier en
// reconnaît le libellé, « à traiter » sinon. Ce statut est ÉCRIT en base : une règle qu'on n'a pas lue
// laisserait « à traiter » un mouvement qu'elle couvre, et aucun rechargement ne le réparerait — d'où la
// suspension de chaque import sur une lecture partielle des règles.
//
// Commun aux trois chemins d'import — un relevé CSV, un relevé PDF, la connexion bancaire —, et c'est la
// raison d'être de ce module : la règle vivait dans l'onglet Banque, et la connexion bancaire en aurait
// écrit une seconde copie.
//
// LE JUGEMENT DU MOTIF EST CELUI DES RÈGLES D'AFFECTATION (lib/reglesAffectation.ts), appelé et non recopié : le motif et le
// libellé sous leur forme normalisée (`normaliserPourRegle`), le motif cherché en DÉBUT DE MOT (`libelleCorrespond`), et
// un motif fait seulement de mots communs aux relevés refusé (`refusMotif`). La règle cherchait une SOUS-CHAÎNE, sans
// rien refuser : « prlv » faisait ignorer chaque prélèvement, « edf » trouvait « medformation ». Une règle déjà en base dont
// le motif ne désigne pas un tiers est INOPÉRANTE : elle ne fait plus rien ignorer, l'écran la dit telle et l'import
// compte les mouvements qu'elle reconnaît et laisse à traiter (`phraseDesIgnores`) — un mouvement laissé à traiter coûte
// un clic, un mouvement ignoré à tort sort de la comptabilité sans que rien ne le montre.
//
// LE SENS (REGLES-Q1, lib/sensDesReglesIgnorees.ts ; la migration `sens_des_regles_ignorees`, préparée). Le drapeau levé, une
// règle retient le sens du mouvement qui l'a créée, et ne fait ignorer que les mouvements de ce sens — à l'import comme sur
// les mouvements déjà importés (`ignoresParLaRegle`) ; une règle d'avant, nulle, vaut pour les deux sens, comme hier, et
// l'import dit encore les encaissements qu'elle fait ignorer. Le drapeau baissé, la table n'a que `motif` : une règle née
// d'un débit fait ignorer aussi les crédits qu'elle reconnaît, et deux ceintures le disent — sa création nomme les
// mouvements de l'autre sens qu'elle reconnaît déjà, avant le clic (`autreSensReconnu`), et l'import compte, règle par
// règle, les encaissements qu'elle a fait ignorer. Chaque fonction prend le drapeau en paramètre (`…Selon`) ; celle sans
// suffixe lit celui du module.
export function regleOperante(regle: Pick<RegleBancaireIgnoree, 'motif'>): boolean {
  return refusMotif(regle.motif) === null
}

function reconnait(libelleNormalise: string, regle: Pick<RegleBancaireIgnoree, 'motif'>): boolean {
  return libelleCorrespond(libelleNormalise, normaliserPourRegle(regle.motif))
}

type MouvementJuge = Pick<LigneBancaire, 'libelle' | 'montant'>

// La règle vaut-elle pour ce mouvement, par son sens ? Toujours, le drapeau baissé.
function deSonSens(parSens: boolean, regle: RegleDeSens, mouvement: Pick<LigneBancaire, 'montant'>): boolean {
  return vautPourLeSens(sensDeLaRegleSelon(parSens, regle), sensDuMouvement(mouvement))
}

export function statutPourMouvementSelon(parSens: boolean, mouvement: MouvementJuge, regles: readonly RegleDeSens[]): StatutLigneBancaire {
  const l = normaliserPourRegle(mouvement.libelle)
  return regles.some((r) => regleOperante(r) && deSonSens(parSens, r, mouvement) && reconnait(l, r)) ? 'ignoree' : 'non_rapprochee'
}

/** Le statut d'un mouvement à son import, selon les règles du dossier — et leur sens, le drapeau levé. */
export function statutPourMouvement(mouvement: MouvementJuge, regles: readonly RegleDeSens[]): StatutLigneBancaire {
  return statutPourMouvementSelon(SENS_DES_REGLES_IGNOREES_EXPORTE, mouvement, regles)
}

const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? 's' : ''}`

/**
 * Ce que les règles « toujours ignorer » ont fait des mouvements d'un import, dit dans son alerte : combien chaque règle en
 * a fait ignorer, dont combien d'ENCAISSEMENTS pour une règle des deux sens (un encaissement ignoré sort des recettes), et
 * combien une règle inopérante en reconnaît et laisse à traiter. Une chaîne vide quand aucune règle n'a rien reconnu ;
 * sinon elle commence par deux sauts de ligne, pour suivre le reste de l'alerte. Le drapeau levé, chaque règle est nommée
 * avec son sens ; baissé, chacune vaut pour les deux sens, et la phrase est celle d'hier.
 */
export function phraseDesIgnoresSelon(parSens: boolean, mouvements: readonly MouvementJuge[], regles: readonly RegleDeSens[]): string {
  const operantes = regles.filter(regleOperante)
  const inoperantes = regles.filter((r) => !regleOperante(r))
  const parRegle = new Map<RegleDeSens, { nombre: number; encaissements: number }>()
  const laisses = new Map<RegleDeSens, number>()
  let ignores = 0
  for (const m of mouvements) {
    const l = normaliserPourRegle(m.libelle)
    const qui = operantes.filter((r) => deSonSens(parSens, r, m) && reconnait(l, r))
    if (qui.length > 0) {
      ignores++
      for (const r of qui) {
        const c = parRegle.get(r) ?? { nombre: 0, encaissements: 0 }
        c.nombre++
        if (sensDuMouvement(m) === 'encaissement') c.encaissements++
        parRegle.set(r, c)
      }
      continue
    }
    for (const r of inoperantes) if (deSonSens(parSens, r, m) && reconnait(l, r)) laisses.set(r, (laisses.get(r) ?? 0) + 1)
  }
  // Une règle des deux sens — toute règle, le drapeau baissé — dit les encaissements qu'elle a fait ignorer ; une règle d'un
  // sens n'en a pas à dire : elle ne prend que le sien.
  const desDeuxSens = (r: RegleDeSens) => sensDeLaRegleSelon(parSens, r) === null
  const phrases: string[] = []
  if (ignores > 0) {
    // Dans l'ordre des règles, celui où l'écran les montre.
    const detail = operantes.flatMap((r) => {
      const c = parRegle.get(r)
      return c ? [`${nomDeLaRegleSelon(parSens, r)} ${c.nombre}${c.encaissements > 0 && desDeuxSens(r) ? ` (dont ${pluriel(c.encaissements, 'encaissement')})` : ''}`] : []
    })
    const encaissements = [...parRegle].some(([r, c]) => c.encaissements > 0 && desDeuxSens(r))
    phrases.push(`${pluriel(ignores, 'mouvement')} ignoré${ignores > 1 ? 's' : ''} par une règle « toujours ignorer » : ${detail.join(', ')}.`
      + (!encaissements ? ''
        : parSens
          ? ' Une règle des deux sens fait ignorer aussi les encaissements : vérifie qu’aucun encaissement ignoré n’est une recette — ignoré, il sort des recettes. '
            + 'Pour qu’elle ne vise que les paiements, recrée-la depuis un paiement, puis retire-la.'
          : ' Une règle ne retient pas encore le sens du mouvement : vérifie qu’aucun encaissement ignoré n’est une recette — ignoré, il sort des recettes.'))
  }
  for (const [r, n] of laisses) {
    phrases.push(`La règle ${nomDeLaRegleSelon(parSens, r)} ne fait plus rien ignorer : son motif désigne un type d’opération, pas un tiers. `
      + `${pluriel(n, 'mouvement')} qu’elle reconnaît ${n > 1 ? 'restent' : 'reste'} à traiter ; retire-la, ou remplace-la par un mot qui nomme le tiers.`)
  }
  return phrases.length === 0 ? '' : `\n\n${phrases.join('\n')}`
}

/** L'alerte d'import, selon le drapeau du module. */
export function phraseDesIgnores(mouvements: readonly MouvementJuge[], regles: readonly RegleDeSens[]): string {
  return phraseDesIgnoresSelon(SENS_DES_REGLES_IGNOREES_EXPORTE, mouvements, regles)
}

/**
 * Les mouvements de L'AUTRE SENS que celui de `ligne` que le motif reconnaît, dans le relevé lu : ceux qu'une règle née de
 * `ligne` ferait aussi ignorer, aujourd'hui et aux prochains imports, faute de retenir son sens. Leur création les nomme
 * avant le clic — le drapeau baissé : levé, la règle retient son sens et n'en fait ignorer aucun.
 */
export function autreSensReconnu<L extends Pick<LigneBancaire, 'id' | 'libelle' | 'montant'>>(
  ligne: Pick<LigneBancaire, 'id' | 'montant'>, motif: string, lignes: readonly L[],
): L[] {
  const sens = sensDuMouvement(ligne)
  const regle = { motif }
  return lignes.filter((l) => l.id !== ligne.id && sensDuMouvement(l) !== null && sensDuMouvement(l) !== sens
    && reconnait(normaliserPourRegle(l.libelle), regle))
}

export interface IgnoresParLaRegle<L> {
  // Les mouvements déjà importés que la règle nouvelle fait ignorer, en une seule mise à jour.
  aIgnorer: L[]
  // Ceux qu'elle reconnaît mais qui portent des encaissements de factures (étape VF5a2, lib/mouvementsDesVentes.ts) : la
  // garde G2 refuserait la mise à jour ENTIÈRE. Ils restent à traiter ; l'écran dit combien, et pourquoi.
  ecartesParLesVentes: L[]
}

// LA RÈGLE « TOUJOURS IGNORER », SUR LES MOUVEMENTS DÉJÀ IMPORTÉS : ceux qui sont à traiter, de son sens, et dont le libellé
// contient le motif — le jugement même de l'import (`statutPourMouvementSelon`), qui, lui, ne rencontre jamais un mouvement
// réservé : un mouvement naît libre, et un encaissement ne le cite qu'ensuite. `horsDesLots` n'a pas de valeur par défaut.
export function ignoresParLaRegleSelon<L extends Pick<LigneBancaire, 'id' | 'statut' | 'libelle' | 'montant'>>(
  parSens: boolean,
  lignes: readonly L[],
  regle: RegleDeSens,
  horsDesLots: MouvementsHorsDesLots,
): IgnoresParLaRegle<L> {
  const resultat: IgnoresParLaRegle<L> = { aIgnorer: [], ecartesParLesVentes: [] }
  for (const l of lignes) {
    if (l.statut !== 'non_rapprochee' || statutPourMouvementSelon(parSens, l, [regle]) !== 'ignoree') continue
    if (horsDesLots.has(l.id)) resultat.ecartesParLesVentes.push(l)
    else resultat.aIgnorer.push(l)
  }
  return resultat
}

/** Les mouvements déjà importés que la règle nouvelle fait ignorer, selon le drapeau du module. */
export function ignoresParLaRegle<L extends Pick<LigneBancaire, 'id' | 'statut' | 'libelle' | 'montant'>>(
  lignes: readonly L[],
  regle: RegleDeSens,
  horsDesLots: MouvementsHorsDesLots,
): IgnoresParLaRegle<L> {
  return ignoresParLaRegleSelon(SENS_DES_REGLES_IGNOREES_EXPORTE, lignes, regle, horsDesLots)
}
