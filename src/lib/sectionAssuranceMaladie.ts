// LA SECTION DES PAIEMENTS DE L'ASSURANCE MALADIE, SUR QUELS DOSSIERS (NOE4-Q1 (C), réponse du cabinet du 17/11/2026 :
// « seulement sur un code NAF de santé (86…) » ; NOE4Q1-Q1 (B), réponse du 18/11/2026 : la division 86 et une liste fermée de
// codes que l'assurance maladie paie aussi, `CODES_HORS_DE_LA_DIVISION`).
//
// Un module PUR : ni base, ni horloge. La section (`components/PaiementsAssuranceMaladie.tsx`, l'onglet Banque du cabinet et
// « Ma banque » du client) et l'association de ses paiements au relevé (NOE5b : la section et la fiche d'un crédit) ne
// s'offrent que pour un dossier dont le code NAF LU est d'une activité de santé humaine, ou de la liste fermée ; un code absent, illisible ou pas
// encore lu ne l'offre pas. Côté cabinet, l'onglet Informations dit pourquoi en une phrase (jamais le silence) ; côté
// client, rien ne se dit : la section n'existe pas pour lui.
//
// DÈS QU'UN IMPORT EXISTE (NOE4Q1-Q2 (A), réponse du cabinet du 18/11/2026) : la section reste offerte, gestes compris, quel
// que soit le code NAF — une règle d'affichage ne cache jamais des données déjà en base (un code changé, effacé ou devenu
// illisible après des imports). « Un import existe » ne se conclut que d'une ligne LUE : une lecture des imports partielle,
// refusée ou pas revenue ne dit pas qu'il n'y en a pas, et la règle du code NAF décide seule (le côté fermé). Une lecture
// partielle qui rend une ligne prouve qu'il en existe une.
//
// Ce que la règle ne fait PAS : elle ne touche à aucune donnée. Les paiements et les associations déjà en base continuent de
// se lire là où un calcul en dépend (un crédit associé n'est candidat d'aucune vente, NOE5-Q4 (A)) ; seuls les écrans qui les
// OFFRENT se taisent.
//
// SOURCE. INSEE, Nomenclature d'activités française, NAF rév. 2 (décret n° 2007-1888 du 26 décembre 2007) : la section Q,
// division 86 « Activités pour la santé humaine » — 86.10Z (activités hospitalières), 86.21Z (médecine générale), 86.22A à
// 86.22C (médecine spécialisée), 86.23Z (pratique dentaire), 86.90A à 86.90F (ambulances, laboratoires, centres de
// collecte, paramédical, rééducation, autres). La NACE rév. 2.1 (règlement délégué (UE) 2023/137), sur laquelle se bâtit la
// NAF qui la remplacera, garde la division 86. Un code se lit sous la forme de SIRENE, « 86.90D » (deux chiffres, un point,
// deux chiffres, une lettre) ; la même forme sans le point est admise, rien d'autre n'est deviné. La liste fermée, de la même
// nomenclature : 47.73Z (commerce de détail de produits pharmaceutiques en magasin spécialisé), 47.74Z (commerce de détail
// d'articles médicaux et orthopédiques en magasin spécialisé), 47.78A (commerces de détail d'optique), 49.32Z (transports de
// voyageurs par taxis) — des activités que l'assurance maladie paie en tiers payant ; une sous-classe voisine n'y entre pas.

/** Pourquoi le CODE offre la section ou non : `sante` (la division 86) et `liste` (la liste fermée), les seules qui l'offrent ; `non-lu`, le dossier (ou sa colonne) pas encore lu ;
 *  `absent`, aucun code au dossier ; `illisible`, un code qui n'a pas la forme d'un code NAF ; `hors-sante`, un code NAF
 *  lisible hors de la division 86 et de la liste fermée. */
export type RaisonDuCode = 'sante' | 'liste' | 'non-lu' | 'absent' | 'illisible' | 'hors-sante'

/** Pourquoi la section s'offre ou non : la raison du code, ou `imports` — offerte par des imports déjà en base alors que le
 *  code ne l'offrirait pas (NOE4Q1-Q2 (A)). */
export type RaisonDeLaSection = RaisonDuCode | 'imports'

/** Ce que l'écran sait des imports du dossier : `au-moins-un`, une ligne lue ; `aucun`, la liste lue EN ENTIER et vide ;
 *  `inconnu`, rien de sûr (pas revenue, refusée, partielle sans ligne, drapeau baissé). Seul `au-moins-un` change la règle. */
export type ImportsDeLaSection = 'au-moins-un' | 'aucun' | 'inconnu'

export interface SectionAssuranceMaladie {
  readonly offerte: boolean
  readonly raison: RaisonDeLaSection
  /** Ce que le code seul décide, que les imports l'emportent ou non : la phrase du cabinet le dit avec eux. */
  readonly raisonDuCode: RaisonDuCode
  /** Le code lu, sous la forme « 86.90D », quand il a la forme d'un code NAF ; nul sinon. */
  readonly code: string | null
}

/** La division de la santé humaine (NAF rév. 2, section Q). */
export const DIVISION_DE_LA_SANTE = '86'

/** Les codes hors de la division 86 qui offrent aussi la section (NOE4Q1-Q1 (B)), sous la forme de SIRENE ; liste FERMÉE. */
export const CODES_HORS_DE_LA_DIVISION: readonly string[] = ['47.73Z', '47.74Z', '47.78A', '49.32Z']

const FORME_DU_CODE = /^(\d{2})\.?(\d{2})([A-Z])$/

/** Le code NAF sous la forme « 86.90D », ou nul s'il n'en a pas la forme (les espaces de bord retirés, la lettre en
 *  majuscule ; rien d'autre n'est corrigé). */
export function codeNafLu(code: string): string | null {
  const m = FORME_DU_CODE.exec(code.trim().toUpperCase())
  return m ? `${m[1]}.${m[2]}${m[3]}` : null
}

/** Ce que le code NAF seul décide (NOE4-Q1 (C), NOE4Q1-Q1 (B)), et le code lu. */
function regleDuCode(codeNaf: string | null | undefined): { raison: RaisonDuCode; code: string | null } {
  if (codeNaf === undefined) return { raison: 'non-lu', code: null }
  if (codeNaf === null || codeNaf.trim() === '') return { raison: 'absent', code: null }
  const code = codeNafLu(codeNaf)
  if (code === null) return { raison: 'illisible', code: null }
  if (code.startsWith(`${DIVISION_DE_LA_SANTE}.`)) return { raison: 'sante', code }
  if (CODES_HORS_DE_LA_DIVISION.includes(code)) return { raison: 'liste', code }
  return { raison: 'hors-sante', code }
}

/** La règle de NOE4-Q1 (C), de NOE4Q1-Q1 (B) et de NOE4Q1-Q2 (A). `codeNaf` : la colonne `dossiers.code_naf` telle que
 *  l'écran l'a lue — `undefined` tant que le dossier (ou cette colonne) n'est pas lu, `null` quand il n'en a pas. `imports` :
 *  ce que l'écran sait des imports du dossier (`importsDeLaLecture`), sans valeur par défaut. */
export function sectionAssuranceMaladie(codeNaf: string | null | undefined, imports: ImportsDeLaSection): SectionAssuranceMaladie {
  const { raison, code } = regleDuCode(codeNaf)
  if (raison === 'sante' || raison === 'liste') return { offerte: true, raison, raisonDuCode: raison, code }
  if (imports === 'au-moins-un') return { offerte: true, raison: 'imports', raisonDuCode: raison, code }
  return { offerte: false, raison, raisonDuCode: raison, code }
}

/** Ce qu'une lecture des imports dit de leur existence, pour le dossier demandé seulement : une ligne lue (même d'une lecture
 *  partielle) en prouve une ; une liste vide ne dit « aucun » que lue en entier ; tout le reste est `inconnu`. */
export function importsDeLaLecture(
  lu: { dossierId: string; etat: string; imports?: { lignes: readonly unknown[]; complete: boolean } } | null,
  dossierId: string,
): ImportsDeLaSection {
  if (lu === null || lu.dossierId !== dossierId || lu.etat !== 'lus' || !lu.imports) return 'inconnu'
  if (lu.imports.lignes.length > 0) return 'au-moins-un'
  return lu.imports.complete ? 'aucun' : 'inconnu'
}

const NOM_DE_LA_SECTION = 'La section « Paiements de l’assurance maladie » de l’onglet Banque'
const LISTE_DITE = `de la liste fermée des activités que l’assurance maladie paie aussi (${CODES_HORS_DE_LA_DIVISION.join(', ')})`

/** La phrase de l'onglet Informations du cabinet, dans tous les cas : ce que la règle a décidé, et sur quoi. Neutre : elle
 *  ne conseille rien. Jamais montrée au client. */
export function phraseDeLaSectionAuCabinet(section: SectionAssuranceMaladie): string {
  if (section.raison === 'imports') {
    return `${NOM_DE_LA_SECTION} reste offerte : des paiements ont déjà été importés pour ce dossier, alors que `
      + `${sansLesImports(section)}. Elle ne cache pas des données déjà en base.`
  }
  switch (section.raison) {
    case 'sante':
      return `${NOM_DE_LA_SECTION} est offerte : le code NAF du dossier (${section.code}) est celui d’une activité de santé `
        + 'humaine (division 86).'
    case 'liste':
      return `${NOM_DE_LA_SECTION} est offerte : le code NAF du dossier (${section.code}) est ${LISTE_DITE}.`
    case 'hors-sante':
      return `${NOM_DE_LA_SECTION} n’est pas offerte : le code NAF du dossier (${section.code}) n’est ni celui d’une activité `
        + `de santé humaine (division 86) ni ${LISTE_DITE}.`
    case 'absent':
      return `${NOM_DE_LA_SECTION} n’est pas offerte : le dossier n’a pas de code NAF. Il se lit depuis le SIRET, `
        + 'par « Détecter la profession (SIRET) » en tête du dossier.'
    case 'illisible':
      return `${NOM_DE_LA_SECTION} n’est pas offerte : le code NAF enregistré n’a pas la forme d’un code NAF (par exemple `
        + '« 86.90D »).'
    case 'non-lu':
      return `${NOM_DE_LA_SECTION} n’est pas offerte : le code NAF du dossier n’a pas été lu.`
  }
}

/** Ce que le code seul dirait, quand des imports l'emportent : la fin de la phrase du cabinet. */
function sansLesImports(section: SectionAssuranceMaladie): string {
  switch (section.raisonDuCode) {
    case 'hors-sante':
      return `le code NAF du dossier (${section.code}) n’est ni celui d’une activité de santé humaine (division 86) ni `
        + LISTE_DITE
    case 'absent':
      return 'le dossier n’a pas de code NAF'
    case 'illisible':
      return 'le code NAF enregistré n’a pas la forme d’un code NAF'
    case 'non-lu':
      return 'le code NAF du dossier n’a pas été lu'
    case 'sante':
    case 'liste':
      return `le code NAF du dossier (${section.code}) l’offre aussi`
  }
}
