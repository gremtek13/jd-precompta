// LE DÉPART D'UN CLIENT (ligne 44, lot INAL5 ; INAL-Q6 du 11/11/2026, « Avoir le choix »). Au départ d'un client, le cabinet
// CHOISIT : (1) remettre les archives — le paquet d'archive de chaque exercice validé (lib/paquetDArchive.ts) — puis
// supprimer le dossier ; ou (2) garder le dossier dix ans, à compter du 31 décembre du dernier exercice validé, sans plus y
// travailler. La base tient la règle (la migration `depart_du_client`, PRÉPARÉE le 11/11/2026, supabase/preparees/) : ce
// module la redit, PUR, pour la dire avant le clic — les refus de ses fonctions et de ses gardes, à leurs mots, la date du
// terme, les exercices dont le paquet manque, au jour de Paris. Rien ne s'en lit tant que le drapeau est baissé.
// Récit : HISTORIQUE.md, « 11/11/2026 — INAL5 ».

/** Levé le jour où la migration `depart_du_client` est en production (son fichier dans supabase/schema/). */
export const DEPART_DU_CLIENT_PREVU: boolean = false

/** Les années de conservation : LPF, art. L102 B, dix ans à compter de la dernière opération des livres. */
export const ANNEES_DE_CONSERVATION = 10

/** Le terme de la conservation d'un exercice, ou d'un dossier dont c'est le dernier exercice validé : le 31 décembre de la
 *  dixième année qui suit (`make_date(annee + 10, 12, 31)` dans la migration). */
export function termeDeConservation(annee: number): string {
  return `${annee + ANNEES_DE_CONSERVATION}-12-31`
}

/** Une date civile AAAA-MM-JJ dite JJ/MM/AAAA (le `to_char(…, 'DD/MM/YYYY')` des messages de la base). */
export function dateDite(jour: string): string {
  const [a, m, j] = jour.split('-')
  return `${j}/${m}/${a}`
}

/** Les refus des fonctions et des gardes de la migration, à leurs mots et à leur code (`%` : ce que la base y place). */
export const REFUS_DU_DEPART = {
  acces: { code: '42501', modele: 'Seul le chef du cabinet conserve un dossier ou lève sa conservation.' },
  dejaConserve: { code: '23514', modele: 'Ce dossier est déjà conservé jusqu’au %.' },
  aucunExercice: {
    code: '23514',
    modele: 'Aucun exercice n’est validé : il n’y a pas de livres à conserver dix ans. Valider d’abord le dernier exercice, ou supprimer le dossier.',
  },
  accesClient: {
    code: '23514', modele: 'Ce dossier a encore % accès client : un dossier conservé n’en a aucun. Les retirer d’abord (onglet Accès).',
  },
  pasConserve: { code: 'P0002', modele: 'Ce dossier n’est pas conservé : rien à lever.' },
  suppressionAvantLeTerme: {
    code: '23514',
    modele: 'Ce dossier est conservé jusqu’au % : il ne se supprime pas avant. Seul le super-administrateur le retire plus tôt.',
  },
  paquetsManquants: {
    code: '23514',
    modele: 'Le paquet d’archive n’a pas été téléchargé pour l’exercice validé %. Un dossier qui porte un exercice validé ne se supprime qu’après la remise de chaque paquet au client (onglet Écritures, « Paquet d’archive »), ou se conserve dix ans.',
  },
} as const

/** Un modèle de refus, ses `%` remplacés dans l'ordre. */
export function motsDuRefus(cle: keyof typeof REFUS_DU_DEPART, ...valeurs: (string | number)[]): string {
  let i = 0
  return REFUS_DU_DEPART[cle].modele.replace(/%/g, () => String(valeurs[i++]))
}

/** Ce qu'un dossier conservé interdit : l'argument de chaque déclencheur de la garde, dans l'ordre de la migration. */
export const INTERDITS_DU_DOSSIER_CONSERVE = [
  { table: 'pieces', mots: 'aucune pièce ne s’y dépose plus' },
  { table: 'ecritures_brouillon', mots: 'aucune écriture ne s’y passe plus' },
  { table: 'memberships', mots: 'aucun accès client ne s’y pose plus' },
  { table: 'exercices_valides', mots: 'aucun exercice ne s’y valide plus' },
] as const

/** Un exercice validé, tel que la base le garde (`exercices_valides`). */
export interface ExerciceValideDuDepart { annee: number; empreinte: string }
/** Un paquet téléchargé (`paquets_d_archive_telecharges`). */
export interface PaquetTelecharge { annee: number; empreinte_exercice: string; telecharge_le: string }
/** La conservation en cours d'un dossier (la ligne de `conservations_des_dossiers` qui n'est pas levée). */
export interface ConservationEnCours { jusqu_au: string; dernier_exercice: number; posee_le: string }

/**
 * Les exercices validés dont la conservation court encore au jour de Paris `jour` (AAAA-MM-JJ) et dont aucun paquet n'a été
 * téléchargé À LEUR EMPREINTE — la condition de `garder_depart_du_dossier`. Triés.
 */
export function exercicesSansPaquet(
  exercices: readonly ExerciceValideDuDepart[], paquets: readonly PaquetTelecharge[], jour: string,
): number[] {
  return exercices
    .filter((e) => termeDeConservation(e.annee) >= jour)
    .filter((e) => !paquets.some((p) => p.annee === e.annee && p.empreinte_exercice === e.empreinte))
    .map((e) => e.annee)
    .sort((a, b) => a - b)
}

/** Le refus de la suppression d'un dossier, à dire AVANT de vider son stockage (la base ne refuse la ligne qu'après), ou
 *  `null`. Le super-administrateur n'est retenu par rien (la migration l'exempte des deux conditions). */
export function refusDeLaSuppressionAuDepart(p: {
  superAdministrateur: boolean
  conservation: ConservationEnCours | null
  exercices: readonly ExerciceValideDuDepart[]
  paquets: readonly PaquetTelecharge[]
  jour: string
}): string | null {
  if (p.superAdministrateur) return null
  if (p.conservation !== null && p.conservation.jusqu_au >= p.jour) {
    return motsDuRefus('suppressionAvantLeTerme', dateDite(p.conservation.jusqu_au))
  }
  const manquants = exercicesSansPaquet(p.exercices, p.paquets, p.jour)
  return manquants.length > 0 ? motsDuRefus('paquetsManquants', manquants.join(', ')) : null
}

/** Le refus de la pose de la conservation, dans l'ordre de `conserver_le_dossier`, ou `null`. */
export function refusDeLaConservation(p: {
  estChef: boolean; conservation: ConservationEnCours | null; exercices: readonly ExerciceValideDuDepart[]; accesClient: number
}): string | null {
  if (!p.estChef) return motsDuRefus('acces')
  if (p.conservation !== null) return motsDuRefus('dejaConserve', dateDite(p.conservation.jusqu_au))
  if (p.exercices.length === 0) return motsDuRefus('aucunExercice')
  if (p.accesClient > 0) return motsDuRefus('accesClient', p.accesClient)
  return null
}

/** Le dernier exercice validé, et le terme qu'une conservation posée aujourd'hui prendrait ; `null` sans exercice validé. */
export function termeAPoser(exercices: readonly ExerciceValideDuDepart[]): { dernier: number; jusquAu: string } | null {
  if (exercices.length === 0) return null
  const dernier = Math.max(...exercices.map((e) => e.annee))
  return { dernier, jusquAu: termeDeConservation(dernier) }
}

// ── LA CARTE DU DÉPART (onglet Informations) ──────────────────────────────────────────────────────────────────────────

export const TITRE_DE_LA_CARTE = 'Le départ du client'

/** Ce que fait la première voie, et ce qui lui manque. */
export function ceQueDitLaRemise(p: { exercices: readonly ExerciceValideDuDepart[]; manquants: readonly number[] }): string {
  if (p.exercices.length === 0) {
    return 'Remettre les archives puis supprimer : aucun exercice n’est validé, il n’y a pas de paquet d’archive à remettre — '
      + 'la suppression (zone dangereuse, plus bas) retire le dossier comme aujourd’hui.'
  }
  const debut = 'Remettre les archives puis supprimer : télécharger le paquet d’archive de chaque exercice validé (onglet '
    + 'Écritures, « Paquet d’archive »), le remettre au client, à qui revient l’obligation de le garder dix ans, puis supprimer '
    + 'le dossier (zone dangereuse, plus bas).'
  if (p.manquants.length === 0) return `${debut} Tous les paquets sont téléchargés : la suppression est possible.`
  const n = p.manquants.length
  return `${debut} ${n === 1 ? 'Il manque le paquet de l’exercice' : 'Il manque les paquets des exercices'} ${p.manquants.join(', ')} : `
    + 'la suppression attend ce téléchargement.'
}

/** Ce que fait la seconde voie, selon qu'elle est posée ou non. */
export function ceQueDitLaConservation(p: { conservation: ConservationEnCours | null; aPoser: { dernier: number; jusquAu: string } | null }): string {
  if (p.conservation !== null) {
    return `Le dossier est conservé jusqu’au ${dateDite(p.conservation.jusqu_au)} (dix ans après l’exercice `
      + `${p.conservation.dernier_exercice}, le dernier validé). Il ne reçoit plus de pièce, d’écriture, d’accès client ni de `
      + 'validation, et ne se supprime pas avant cette date ; ses paquets d’archive se téléchargent toujours. Lever la '
      + 'conservation rouvre le dossier.'
  }
  if (p.aPoser === null) {
    return 'Garder le dossier dix ans : aucun exercice n’est validé, il n’y a pas de livres à conserver. Valider d’abord le dernier exercice.'
  }
  return `Garder le dossier dix ans : il serait conservé jusqu’au ${dateDite(p.aPoser.jusquAu)} (dix ans après l’exercice `
    + `${p.aPoser.dernier}, le dernier validé), sans plus y travailler — plus de pièce, d’écriture, d’accès client ni de `
    + 'validation, et aucune suppression avant cette date. Le cabinet peut lever la conservation à tout moment.'
}

/** La confirmation de la pose : elle NOMME le dossier, le terme, et ce qui s'interdit. */
export function confirmationDeLaConservation(nom: string, aPoser: { dernier: number; jusquAu: string }): string {
  return `Conserver « ${nom} » jusqu’au ${dateDite(aPoser.jusquAu)} : dix ans après l’exercice ${aPoser.dernier}. Le dossier ne `
    + 'recevra plus de pièce, d’écriture, d’accès client ni de validation, et ne se supprimera pas avant cette date.'
}

/** Ce que la confirmation de la suppression ajoute, sur un dossier qui porte des exercices validés : les paquets, NOMMÉS. */
export function ceQueLaSuppressionPerd(p: {
  exercices: readonly ExerciceValideDuDepart[]; manquants: readonly number[]; conservation: ConservationEnCours | null; jour: string
}): string {
  if (p.exercices.length === 0) return ''
  const annees = [...p.exercices].map((e) => e.annee).sort((a, b) => a - b)
  const conserve = p.conservation !== null && p.conservation.jusqu_au >= p.jour
    ? ` Le dossier est conservé jusqu’au ${dateDite(p.conservation.jusqu_au)} : seul le super-administrateur le supprime avant.`
    : ''
  if (p.manquants.length === 0) {
    return ` Les paquets d’archive des exercices validés (${annees.join(', ')}) ont été téléchargés : vérifie qu’ils ont été remis au client.${conserve}`
  }
  return ` Le paquet d’archive des exercices ${p.manquants.join(', ')} n’a pas été téléchargé : leurs livres et leurs pièces seraient perdus pour le client.${conserve}`
}
