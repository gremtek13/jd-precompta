// UN DOSSIER QUI PORTE DES FACTURES REPRISES NE PASSE PAS EN COMPTABILITÉ D'ENGAGEMENT (ligne 51.5 ; A8B-Q3, « Le refuser »,
// tranchée par le cabinet le 11/11/2026 à la recommandation ; HISTORIQUE.md, « 13/11/2026 — PC4Q2-Q1, A8B-Q3 ET A8Q5Q3-Q2 :
// TROIS MIGRATIONS PRÉPARÉES »).
//
// L'import des factures d'un ancien logiciel se refuse en engagement (A8-Q3, `importer_factures`) : la créance d'une facture
// d'avant y serait au compte client de la balance reprise, que l'application n'écrit pas encore. La migration
// `reprises_retiennent_la_tresorerie` (en production depuis le 15/11/2026, par l'outil, sur l'accord du cabinet —
// A8B-Q3-migration ; supabase/schema/20261115074926_reprises_retiennent_la_tresorerie.sql) ferme
// l'autre chemin : la garde du réglage du modèle comptable (`verrouiller_modele_comptable`) refuse le passage VERS
// l'engagement d'un dossier qui porte une facture ou un avoir à l'état « importee », APRÈS son refus d'hier (un brouillon qui
// n'est pas vide), sous les mots ci-dessous — que reprisesRetiennentLaTresorerie.test.ts confronte au texte de la migration.
//
// CE MODULE EST PUR : la règle et les mots ; la lecture vit dans lib/reprisesRetiennentLaTresorerieLecture.ts. La carte
// « Modèle comptable » de l'onglet Écritures dit le refus AVANT le clic, et n'offre pas le passage : un dossier qui porte des
// factures reprises, ou dont la lecture n'est pas revenue entière, ne passe pas en engagement d'ici.
//
// LE DRAPEAU, LEVÉ depuis le 15/11/2026, la migration en production : la carte « Modèle comptable » lit les factures
// reprises du dossier et dit le refus avant le clic. Baissé — l'état d'avant, que les tests jouent encore —, rien n'est lu
// (sans appel au réseau), rien n'est refusé : l'écran d'hier, au caractère près. Il se baisse AVANT tout retour de la
// migration. Il se lit À CHAQUE APPEL (`reprisesRetiennentLaTresoreriePrevues`) : les tests jouent ses deux états sur
// l'objet ci-dessous, et le confrontent à l'export.
export const DRAPEAU_DES_REPRISES_ET_DU_MODELE = {
  /** Vrai depuis le 15/11/2026 : la migration `reprises_retiennent_la_tresorerie` est en production et dans l'export. */
  REPRISES_RETIENNENT_LA_TRESORERIE_PREVUES: true as boolean,
}

/** Le drapeau, lu à l'appel. */
export function reprisesRetiennentLaTresoreriePrevues(): boolean {
  return DRAPEAU_DES_REPRISES_ET_DU_MODELE.REPRISES_RETIENNENT_LA_TRESORERIE_PREVUES
}

/** Le refus de la base, à ses mots (l'apostrophe courbée de l'écran ; le test les confronte au texte de la migration). */
export const REFUS_ENGAGEMENT_DES_REPRISES = 'Ce dossier porte des factures reprises d’un ancien logiciel : il ne passe pas en '
  + 'comptabilité d’engagement, où la créance d’une facture d’avant serait au compte client de la reprise, que l’application '
  + 'n’écrit pas encore.'

/** Un refus de l'ÉCRAN, pas de la base : la lecture n'est pas revenue entière, et le passage ne se juge pas d'ici. */
export const REPRISES_NON_LUES = 'Ce que le dossier porte de factures reprises d’un ancien logiciel n’est pas lu : il ne passe '
  + 'pas en comptabilité d’engagement sur cette lecture.'

/** Ce que l'onglet a lu des factures reprises d'un dossier : leur nombre, ou le motif de son manque. */
export type LectureDesReprisesDuModele =
  | { dossierId: string; etat: 'lue'; nombre: number }
  | { dossierId: string; etat: 'illisible'; motif: string }

/**
 * Ce qui retient le passage du dossier en engagement, avant le clic — nul quand rien ne le retient. `prevu` : l'état du
 * drapeau (sans valeur par défaut). Baissé, rien. Levé : une lecture absente, d'un autre dossier ou illisible retient
 * (`REPRISES_NON_LUES`) ; une facture reprise ou plus, le refus de la base. Le compte du dirigeant et le retour en
 * trésorerie ne se jugent pas ici, comme en base.
 */
export function refusDuPassageEnEngagement(
  lecture: LectureDesReprisesDuModele | null,
  dossierId: string,
  prevu: boolean,
): string | null {
  if (!prevu) return null
  if (lecture === null || lecture.dossierId !== dossierId || lecture.etat === 'illisible') return REPRISES_NON_LUES
  return lecture.nombre > 0 ? REFUS_ENGAGEMENT_DES_REPRISES : null
}
