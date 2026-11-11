import { formatDate, formatMoney } from './format'
import type { ControleReleveBancaire, LigneBancaire } from './types'

// LA SUITE DES RELEVÉS IMPORTÉS (RELEVE-Q1, réponse du cabinet du 08/11/2026 : « le signaler dès l'import »). Chaque fichier
// boucle en lui-même (`controlerSolde`, lib/soldeReleve.ts) ; un relevé exporté à moitié — août jusqu'au 15 — boucle aussi, et
// rien ne le voyait avant la validation (HISTORIQUE.md, « LA RÉPÉTITION, SECONDE PASSE »). Ce module confronte le solde de
// clôture d'un relevé contrôlé au solde d'ouverture du relevé qui le suit. Une ALERTE seulement : rien ne bloque, rien ne
// s'écrit. Module PUR : les contrôles conservés à l'import (`controles_releves_bancaires`) et le relevé en base, en entrée.
//
// LES CONVENTIONS, celles de lib/releveAuTrenteEtUn.ts : un contrôle porte les dates de ses deux lignes de solde ; son solde
// initial est celui d'AVANT ses mouvements (le matin de `periode_debut`), son solde final celui d'APRÈS (le soir de
// `periode_fin`). Les montants se comparent en CENTIMES ENTIERS, au centime : aucune tolérance au-delà de l'arrondi.
// Ce module juge les relevés d'UN compte : depuis MCB4, l'appelant d'un dossier qui en tient plusieurs le rejoue compte par
// compte (lib/releveParCompte.ts, `jonctionsParCompte`), et la jonction porte alors le nom du compte, que les phrases disent.
//
// LA RÈGLE. Les relevés contrôlés se rangent par début de période, puis fin, puis identifiant. Le PRÉCÉDENT d'un relevé est,
// parmi ceux rangés avant lui, celui qui va le plus loin (la fin la plus tardive) : un relevé contenu dans un autre ne devient
// le précédent de personne.
//   - Le suivant commence APRÈS la fin du précédent (le cas des relevés mensuels) : le solde final du précédent doit être le
//     solde initial du suivant. Si le relevé en base porte des mouvements datés entre les deux — d'un fichier sans ses deux
//     soldes (un OFX), d'une saisie, d'une connexion —, aucun relevé contrôlé ne les couvre : ils NE SE COMPARENT PAS.
//   - Les deux se RECOUVRENT (le suivant commence au plus tard le dernier jour du précédent) : le précédent porte le solde du
//     début du suivant — son solde final, moins ses mouvements datés du premier jour du suivant ou après. C'est le précédent
//     qui le dit, pas le suivant : les mouvements du suivant que le dédoublonnage a écartés ne sont pas sous son nom en base,
//     et un relevé arrêté avant une opération de son dernier jour (janvier exporté le 28 avant le virement du jour) dirait au
//     soir du 28 un solde que son propre fichier ne porte pas. Le solde initial du suivant se lit au matin de son premier
//     jour, ou au soir de ce jour pour une banque qui date l'ouverture de la veille au soir : la rupture ne se dit que s'il
//     ne retrouve AUCUN des deux. Le calcul exige un précédent qui boucle, dont les mouvements se retrouvent par le nom du
//     fichier et font encore la somme contrôlée à l'import ; sinon, ils ne se comparent pas.
// Un fichier sans ses deux soldes n'a pas de contrôle : il n'entre dans aucune comparaison, et ceux qui l'encadrent ne se
// comparent pas (ses mouvements sont entre eux). Jamais une rupture inventée : ce qui ne se compare pas se dit tel.

const centimes = (montant: number) => Math.round(montant * 100)

/** Ce qu'un contrôle de relevé apporte à la comparaison. */
export type ReleveControle = Pick<
  ControleReleveBancaire, 'id' | 'source_fichier' | 'solde_initial' | 'solde_final' | 'somme_mouvements' | 'coherent' | 'periode_debut' | 'periode_fin'
>
/** Ce qu'un mouvement du relevé en base apporte : sa date, son montant, et le fichier qui l'a importé. */
export type MouvementDuReleve = Pick<LigneBancaire, 'date' | 'montant' | 'source_fichier'>

export type RaisonSansComparaison =
  // Des mouvements du relevé en base, datés entre la fin du précédent et le début du suivant, qu'aucun des deux ne porte.
  | 'mouvements entre les deux'
  // Les deux se recouvrent, et le précédent ne boucle pas : son solde au début du suivant ne se calcule pas.
  | 'le précédent ne boucle pas'
  // Les deux se recouvrent, et les mouvements du précédent ne se retrouvent pas (aucun nom de fichier) ou ne font plus la somme
  // contrôlée à l'import.
  | 'mouvements du précédent introuvables'

export type JonctionDesReleves =
  | { precedent: ReleveControle; suivant: ReleveControle; etat: 'se suivent' }
  // `attendu` : le solde que le précédent porte au début du suivant ; `lu` : le solde initial du suivant ; `ecart` = lu −
  // attendu. En centimes. `recouvrement` : les deux périodes se recouvrent (l'attendu est alors calculé, pas imprimé).
  | { precedent: ReleveControle; suivant: ReleveControle; etat: 'rupture'; attendu: number; lu: number; ecart: number; recouvrement: boolean }
  | { precedent: ReleveControle; suivant: ReleveControle; etat: 'ne se compare pas'; raison: RaisonSansComparaison }

type Date_ = { periode_debut: string; periode_fin: string }
const date = (r: ReleveControle) => r as ReleveControle & Date_

/** Les jonctions de tous les relevés contrôlés du dossier, dans l'ordre des périodes. Un contrôle sans ses deux dates n'en a pas. */
export function jonctionsDesReleves(
  controles: readonly ReleveControle[],
  lignes: readonly MouvementDuReleve[],
): JonctionDesReleves[] {
  const ranges = controles
    .filter((k) => k.periode_debut !== null && k.periode_fin !== null)
    .map(date)
    .sort((a, b) => a.periode_debut.localeCompare(b.periode_debut) || a.periode_fin.localeCompare(b.periode_fin) || a.id.localeCompare(b.id))
  const jonctions: JonctionDesReleves[] = []
  let precedent: (ReleveControle & Date_) | null = null
  for (const suivant of ranges) {
    if (precedent !== null) jonctions.push(jonction(precedent, suivant, lignes))
    if (precedent === null || suivant.periode_fin > precedent.periode_fin) precedent = suivant
  }
  return jonctions
}

function jonction(precedent: ReleveControle & Date_, suivant: ReleveControle & Date_, lignes: readonly MouvementDuReleve[]): JonctionDesReleves {
  const lu = centimes(suivant.solde_initial)
  const fichiers = new Set([precedent.source_fichier, suivant.source_fichier].filter((s) => s !== null))
  if (suivant.periode_debut > precedent.periode_fin) {
    const entre = lignes.some((l) => l.date > precedent.periode_fin && l.date < suivant.periode_debut
      && !(l.source_fichier !== null && fichiers.has(l.source_fichier)))
    if (entre) return { precedent, suivant, etat: 'ne se compare pas', raison: 'mouvements entre les deux' }
    const attendu = centimes(precedent.solde_final)
    return attendu === lu ? { precedent, suivant, etat: 'se suivent' }
      : { precedent, suivant, etat: 'rupture', attendu, lu, ecart: lu - attendu, recouvrement: false }
  }
  if (!precedent.coherent) return { precedent, suivant, etat: 'ne se compare pas', raison: 'le précédent ne boucle pas' }
  const duPrecedent = precedent.source_fichier === null ? null : lignes.filter((l) => l.source_fichier === precedent.source_fichier)
  if (duPrecedent === null || duPrecedent.reduce((s, l) => s + centimes(l.montant), 0) !== centimes(precedent.somme_mouvements)) {
    return { precedent, suivant, etat: 'ne se compare pas', raison: 'mouvements du précédent introuvables' }
  }
  const final = centimes(precedent.solde_final)
  const matin = final - duPrecedent.filter((l) => l.date >= suivant.periode_debut).reduce((s, l) => s + centimes(l.montant), 0)
  const soir = final - duPrecedent.filter((l) => l.date > suivant.periode_debut).reduce((s, l) => s + centimes(l.montant), 0)
  return lu === matin || lu === soir ? { precedent, suivant, etat: 'se suivent' }
    : { precedent, suivant, etat: 'rupture', attendu: matin, lu, ecart: lu - matin, recouvrement: true }
}

/**
 * Ceux qui ne bouclent pas, du plus récent au plus ancien (la fin de période, nulle en dernier, puis l'identifiant) : l'ordre
 * de `chargerRelevesIncoherents`, tiré des contrôles lus une fois pour les deux usages.
 */
export function relevesIncoherentsDe<T extends ReleveControle>(controles: readonly T[]): T[] {
  return controles.filter((k) => !k.coherent).sort((a, b) => {
    if (a.periode_fin !== b.periode_fin) {
      if (a.periode_fin === null) return 1
      if (b.periode_fin === null) return -1
      return b.periode_fin.localeCompare(a.periode_fin)
    }
    return a.id.localeCompare(b.id)
  })
}

/** Les seules ruptures : ce que la Vue d'ensemble compte et ce que l'onglet Banque montre. */
export function rupturesDesReleves(jonctions: readonly JonctionDesReleves[]): Extract<JonctionDesReleves, { etat: 'rupture' }>[] {
  return jonctions.filter((j): j is Extract<JonctionDesReleves, { etat: 'rupture' }> => j.etat === 'rupture')
}

/**
 * Les contrôles tels qu'ils seront en base après l'import d'un fichier : le sien remplace celui du même nom (l'upsert sur
 * `(dossier_id, source_fichier)`, lib/controlesReleves.ts) ; un fichier sans nom s'ajoute.
 */
export function controlesAvecLeFichier(controles: readonly ReleveControle[], fichier: ReleveControle): ReleveControle[] {
  return [...controles.filter((k) => fichier.source_fichier === null || k.source_fichier !== fichier.source_fichier), fichier]
}

const periode = (r: ReleveControle) => `du ${formatDate(r.periode_debut)} au ${formatDate(r.periode_fin)}`
const nomme = (r: ReleveControle) => `le relevé ${periode(r)}${r.source_fichier ? ` (« ${r.source_fichier} »)` : ''}`
const euros = (c: number) => formatMoney(c / 100)

/** Le nom du compte d'une jonction (lib/releveParCompte.ts), nul ou absent pour un dossier à un compte. */
type NomDuCompte = { nomDuCompte?: string | null }
const surLeCompte = (j: NomDuCompte) => (j.nomDuCompte == null ? '' : `Sur le compte « ${j.nomDuCompte} », `)

/** Une rupture, en une phrase qui nomme les deux périodes, les deux soldes et l'écart — et le compte, dès deux comptes. */
export function phraseDeLaRupture(j: Extract<JonctionDesReleves, { etat: 'rupture' }> & NomDuCompte): string {
  const premier = surLeCompte(j) === '' ? nomme(j.precedent) : `${surLeCompte(j)}${nomme(j.precedent)}`
  const debut = j.recouvrement
    ? `${premier.charAt(0).toUpperCase()}${premier.slice(1)} porte ${euros(j.attendu)} au matin du ${formatDate(j.suivant.periode_debut)}`
    : `${premier.charAt(0).toUpperCase()}${premier.slice(1)} finit à ${euros(j.attendu)}`
  return `${debut} ; ${nomme(j.suivant)} s'ouvre à ${euros(j.lu)} : un écart de ${euros(Math.abs(j.ecart))}. `
    + 'Des opérations manquent probablement entre les deux (un relevé exporté en partie, ou une période non importée) ; '
    + 'rien n’est bloqué, mais les totaux bancaires en dépendent.'
}

/** Le détail du point de la Vue d'ensemble : les deux périodes de chaque rupture et son écart, trois au plus. */
export function detailDesRuptures(ruptures: readonly (Extract<JonctionDesReleves, { etat: 'rupture' }> & NomDuCompte)[]): string | undefined {
  if (ruptures.length === 0) return undefined
  const dites = ruptures.slice(0, 3).map((j) => `${j.nomDuCompte == null ? '' : `compte « ${j.nomDuCompte} », `}`
    + `${periode(j.precedent)}, puis ${periode(j.suivant)} : un écart de ${euros(Math.abs(j.ecart))}`)
  return dites.join(' ; ') + (ruptures.length > 3 ? ` ; et ${ruptures.length - 3} autre(s)` : '') + '.'
}

const RAISONS: Readonly<Record<RaisonSansComparaison, string>> = {
  'mouvements entre les deux': 'des mouvements datés entre les deux ne viennent d’aucun relevé contrôlé (un fichier sans ses deux soldes, ou une saisie)',
  'le précédent ne boucle pas': 'le premier ne boucle pas : son solde au début du second ne se calcule pas',
  'mouvements du précédent introuvables': 'les mouvements du premier ne se retrouvent plus tels qu’importés : son solde au début du second ne se calcule pas',
}

/** Ce qui ne se compare pas, et pourquoi : dit, jamais une rupture inventée. */
export function phraseSansComparaison(j: Extract<JonctionDesReleves, { etat: 'ne se compare pas' }>): string {
  const premier = nomme(j.precedent)
  return `${premier.charAt(0).toUpperCase()}${premier.slice(1)} et ${nomme(j.suivant)} ne se comparent pas : ${RAISONS[j.raison]}.`
}

/** Un fichier importé sans ses deux soldes : aucun contrôle, donc aucune comparaison avec ses voisins. */
export const PHRASE_FICHIER_SANS_SOLDES = 'Ce relevé n’a pas ses deux soldes : il ne se compare ni au relevé qui le précède ni à celui qui le suit.'
/** Les contrôles déjà en base, illisibles : la suite des soldes n'est pas vérifiée, et rien ne s'affirme. */
export const PHRASE_SUITE_NON_VERIFIEE = 'Les relevés déjà importés n’ont pas pu être relus : la suite des soldes avec ce relevé n’est pas vérifiée.'

/**
 * Ce que l'import dit de la suite des soldes pour le fichier `fichier` (son contrôle, ou `null` s'il n'a pas ses deux soldes),
 * confronté aux relevés qui le précèdent et le suivent. `controles` : ceux du dossier, en base, lus en entier, ou `null` s'ils
 * n'ont pas pu l'être ; `lignes` : le relevé tel qu'il sera après l'import, les mouvements du fichier compris sous son nom.
 * `null` : rien à dire (le fichier suit et précède sans écart, ou n'a pas de voisin).
 */
export function phraseDeLaSuiteDuFichier(
  controles: readonly ReleveControle[] | null,
  lignes: readonly MouvementDuReleve[],
  fichier: ReleveControle | null,
): string | null {
  if (controles === null) return PHRASE_SUITE_NON_VERIFIEE
  if (fichier === null) return PHRASE_FICHIER_SANS_SOLDES
  const phrases = jonctionsDesReleves(controlesAvecLeFichier(controles, fichier), lignes)
    .filter((j) => j.precedent === fichier || j.suivant === fichier)
    .flatMap((j) => (j.etat === 'rupture' ? [`⚠ ${phraseDeLaRupture(j)}`] : j.etat === 'ne se compare pas' ? [phraseSansComparaison(j)] : []))
  return phrases.length === 0 ? null : phrases.join('\n')
}

/** Le contrôle d'un fichier pas encore enregistré, à la forme de la base : pour l'aperçu et l'alerte de l'import. */
export function controleDuFichier(
  sourceFichier: string | null,
  k: { soldeInitial: number; soldeFinal: number; sommeMouvements: number; coherent: boolean; dateInitiale: string; dateFinale: string },
): ReleveControle {
  return {
    id: `fichier:${sourceFichier ?? ''}`, source_fichier: sourceFichier, solde_initial: k.soldeInitial, solde_final: k.soldeFinal,
    somme_mouvements: k.sommeMouvements, coherent: k.coherent, periode_debut: k.dateInitiale, periode_fin: k.dateFinale,
  }
}
