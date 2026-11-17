// LA SECTION DES PAIEMENTS DE L'ASSURANCE MALADIE, SUR QUELS DOSSIERS (NOE4-Q1 (C), réponse du cabinet du 17/11/2026 :
// « seulement sur un code NAF de santé (86…) »).
//
// Un module PUR : ni base, ni horloge. La section (`components/PaiementsAssuranceMaladie.tsx`, l'onglet Banque du cabinet et
// « Ma banque » du client) et l'association de ses paiements au relevé (NOE5b : la section et la fiche d'un crédit) ne
// s'offrent que pour un dossier dont le code NAF LU est d'une activité de santé humaine ; un code absent, illisible ou pas
// encore lu ne l'offre pas. Côté cabinet, l'onglet Informations dit pourquoi en une phrase (jamais le silence) ; côté
// client, rien ne se dit : la section n'existe pas pour lui.
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
// deux chiffres, une lettre) ; la même forme sans le point est admise, rien d'autre n'est deviné.

/** Pourquoi la section s'offre ou non : `sante`, la seule qui l'offre ; `non-lu`, le dossier (ou sa colonne) pas encore lu ;
 *  `absent`, aucun code au dossier ; `illisible`, un code qui n'a pas la forme d'un code NAF ; `hors-sante`, un code NAF
 *  lisible hors de la division 86. */
export type RaisonDeLaSection = 'sante' | 'non-lu' | 'absent' | 'illisible' | 'hors-sante'

export interface SectionAssuranceMaladie {
  readonly offerte: boolean
  readonly raison: RaisonDeLaSection
  /** Le code lu, sous la forme « 86.90D », quand il a la forme d'un code NAF ; nul sinon. */
  readonly code: string | null
}

/** La division de la santé humaine (NAF rév. 2, section Q). */
export const DIVISION_DE_LA_SANTE = '86'

const FORME_DU_CODE = /^(\d{2})\.?(\d{2})([A-Z])$/

/** Le code NAF sous la forme « 86.90D », ou nul s'il n'en a pas la forme (les espaces de bord retirés, la lettre en
 *  majuscule ; rien d'autre n'est corrigé). */
export function codeNafLu(code: string): string | null {
  const m = FORME_DU_CODE.exec(code.trim().toUpperCase())
  return m ? `${m[1]}.${m[2]}${m[3]}` : null
}

/** La règle de NOE4-Q1 (C). `codeNaf` : la colonne `dossiers.code_naf` telle que l'écran l'a lue — `undefined` tant que le
 *  dossier (ou cette colonne) n'est pas lu, `null` quand il n'en a pas. */
export function sectionAssuranceMaladie(codeNaf: string | null | undefined): SectionAssuranceMaladie {
  if (codeNaf === undefined) return { offerte: false, raison: 'non-lu', code: null }
  if (codeNaf === null || codeNaf.trim() === '') return { offerte: false, raison: 'absent', code: null }
  const code = codeNafLu(codeNaf)
  if (code === null) return { offerte: false, raison: 'illisible', code: null }
  return code.startsWith(`${DIVISION_DE_LA_SANTE}.`)
    ? { offerte: true, raison: 'sante', code }
    : { offerte: false, raison: 'hors-sante', code }
}

const NOM_DE_LA_SECTION = 'La section « Paiements de l’assurance maladie » de l’onglet Banque'

/** La phrase de l'onglet Informations du cabinet, dans tous les cas : ce que la règle a décidé, et sur quoi. Neutre : elle
 *  ne conseille rien. Jamais montrée au client. */
export function phraseDeLaSectionAuCabinet(section: SectionAssuranceMaladie): string {
  switch (section.raison) {
    case 'sante':
      return `${NOM_DE_LA_SECTION} est offerte : le code NAF du dossier (${section.code}) est celui d’une activité de santé `
        + 'humaine (division 86).'
    case 'hors-sante':
      return `${NOM_DE_LA_SECTION} n’est pas offerte : le code NAF du dossier (${section.code}) n’est pas celui d’une activité `
        + 'de santé humaine (division 86).'
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
