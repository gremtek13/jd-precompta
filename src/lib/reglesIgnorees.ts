import type { MouvementsHorsDesLots } from './mouvementsDesVentes'
import { libelleCorrespond, normaliserPourRegle, refusMotif, sensDuMouvement } from './reglesAffectation'
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
// LE SENS MANQUE, et il faudrait une migration pour l'avoir : la table `regles_bancaires_ignorees` n'a que `motif`. Une
// règle née d'un débit fait donc ignorer aussi les crédits qu'elle reconnaît. Deux ceintures en attendant : sa création
// nomme les mouvements de l'autre sens qu'elle reconnaît déjà, avant le clic (`autreSensReconnu`), et l'import dit, règle
// par règle, combien d'encaissements elle a fait ignorer.
export function regleOperante(regle: Pick<RegleBancaireIgnoree, 'motif'>): boolean {
  return refusMotif(regle.motif) === null
}

function reconnait(libelleNormalise: string, regle: Pick<RegleBancaireIgnoree, 'motif'>): boolean {
  return libelleCorrespond(libelleNormalise, normaliserPourRegle(regle.motif))
}

export function statutPourLibelle(libelle: string, regles: Pick<RegleBancaireIgnoree, 'motif'>[]): StatutLigneBancaire {
  const l = normaliserPourRegle(libelle)
  return regles.some((r) => regleOperante(r) && reconnait(l, r)) ? 'ignoree' : 'non_rapprochee'
}

type MouvementImporte = Pick<LigneBancaire, 'libelle' | 'montant'>

const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? 's' : ''}`

/**
 * Ce que les règles « toujours ignorer » ont fait des mouvements d'un import, dit dans son alerte : combien chaque règle en
 * a fait ignorer, dont combien d'ENCAISSEMENTS (une règle ne connaît pas son sens, et un encaissement ignoré sort des
 * recettes), et combien une règle inopérante en reconnaît et laisse à traiter. Une chaîne vide quand aucune règle n'a rien
 * reconnu ; sinon elle commence par deux sauts de ligne, pour suivre le reste de l'alerte.
 */
export function phraseDesIgnores(mouvements: readonly MouvementImporte[], regles: readonly Pick<RegleBancaireIgnoree, 'motif'>[]): string {
  const operantes = regles.filter(regleOperante)
  const inoperantes = regles.filter((r) => !regleOperante(r))
  const parRegle = new Map<string, { nombre: number; encaissements: number }>()
  const laisses = new Map<string, number>()
  let ignores = 0
  for (const m of mouvements) {
    const l = normaliserPourRegle(m.libelle)
    const qui = operantes.filter((r) => reconnait(l, r))
    if (qui.length > 0) {
      ignores++
      for (const r of qui) {
        const c = parRegle.get(r.motif) ?? { nombre: 0, encaissements: 0 }
        c.nombre++
        if (sensDuMouvement(m) === 'encaissement') c.encaissements++
        parRegle.set(r.motif, c)
      }
      continue
    }
    for (const r of inoperantes) if (reconnait(l, r)) laisses.set(r.motif, (laisses.get(r.motif) ?? 0) + 1)
  }
  const phrases: string[] = []
  if (ignores > 0) {
    // Dans l'ordre des règles, celui où l'écran les montre.
    const detail = operantes.flatMap((r) => {
      const c = parRegle.get(r.motif)
      return c ? [`« ${r.motif} » ${c.nombre}${c.encaissements > 0 ? ` (dont ${pluriel(c.encaissements, 'encaissement')})` : ''}`] : []
    })
    const encaissements = [...parRegle.values()].some((c) => c.encaissements > 0)
    phrases.push(`${pluriel(ignores, 'mouvement')} ignoré${ignores > 1 ? 's' : ''} par une règle « toujours ignorer » : ${detail.join(', ')}.`
      + (encaissements
        ? ' Une règle ne retient pas encore le sens du mouvement : vérifie qu’aucun encaissement ignoré n’est une recette — ignoré, il sort des recettes.'
        : ''))
  }
  for (const [motif, n] of laisses) {
    phrases.push(`La règle « ${motif} » ne fait plus rien ignorer : son motif désigne un type d’opération, pas un tiers. `
      + `${pluriel(n, 'mouvement')} qu’elle reconnaît ${n > 1 ? 'restent' : 'reste'} à traiter ; retire-la, ou remplace-la par un mot qui nomme le tiers.`)
  }
  return phrases.length === 0 ? '' : `\n\n${phrases.join('\n')}`
}

/**
 * Les mouvements de L'AUTRE SENS que celui de `ligne` que le motif reconnaît, dans le relevé lu : ceux qu'une règle née de
 * `ligne` ferait aussi ignorer, aujourd'hui et aux prochains imports, faute de retenir son sens. Leur création les nomme
 * avant le clic.
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

// LA RÈGLE « TOUJOURS IGNORER », SUR LES MOUVEMENTS DÉJÀ IMPORTÉS : ceux qui sont à traiter et dont le libellé contient le
// motif — le jugement même de l'import (`statutPourLibelle`), qui, lui, ne rencontre jamais un mouvement réservé : un
// mouvement naît libre, et un encaissement ne le cite qu'ensuite. `horsDesLots` n'a pas de valeur par défaut.
export function ignoresParLaRegle<L extends Pick<LigneBancaire, 'id' | 'statut' | 'libelle'>>(
  lignes: readonly L[],
  motif: string,
  horsDesLots: MouvementsHorsDesLots,
): IgnoresParLaRegle<L> {
  const resultat: IgnoresParLaRegle<L> = { aIgnorer: [], ecartesParLesVentes: [] }
  for (const l of lignes) {
    if (l.statut !== 'non_rapprochee' || statutPourLibelle(l.libelle, [{ motif }]) !== 'ignoree') continue
    if (horsDesLots.has(l.id)) resultat.ecartesParLesVentes.push(l)
    else resultat.aIgnorer.push(l)
  }
  return resultat
}
