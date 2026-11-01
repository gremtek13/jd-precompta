import { compteeASonEcheance, cotisationsComptees } from './cotisationRapprochee'
import { couvertureDuReleve } from './echeanceEmprunt'
import type { MouvementBancaire } from './affectationBanque'
import { formatDate, formatMoney } from './format'
import type { CotisationDeclaree, ModeComptable } from './types'

// L'ÉCHÉANCE PRÉVISIONNELLE ET L'APPEL DÉFINITIF (étape 2035S2, relecture de la 2035 du 01/11/2026, point 2 ; 2035S-Q4,
// réponse (A), recommandée, écrite sans réponse du cabinet, qui a demandé de continuer et d'arbitrer plus tard).
//
// L'échéancier prévisionnel d'une caisse (CARPIMKO, « ÉCHÉANCIER PRÉVISIONNEL » de l'avis de N−1) pose une échéance, le
// 20/01 ; l'appel définitif la fixe à une autre date, le 05/02, et c'est lui que le relevé paie. La création depuis un avis
// ne reconnaissait la prévisionnelle qu'à sa date EXACTE : l'appel s'insérait à côté d'elle, la prévisionnelle qu'aucun
// prélèvement ne paie restait comptée à son échéance (`cotisationsComptees` ne lit pas `previsionnel`), et les deux
// comptaient en BK — 620 € au lieu de 320 €. Aucune unicité en base ne l'empêche.
//
// DEUX GESTES, sans migration :
//   1. à la création depuis un avis, l'appel définitif proposé à une date où rien n'existe REMPLACE la prévisionnelle du
//      même mois qu'aucun paiement ne date — la ligne le dit avant le clic, le clic porte sur elle la date, le montant et
//      `previsionnel = false` (une mise à jour, que `garder_cotisation_valide` accepte hors d'un exercice validé), jamais un
//      remplacement que le cabinet n'a pas vu (`remplacementsDesPrevisionnelles`) ;
//   2. dans la Checklist et dans Clôture, un point en ATTENTION : la prévisionnelle qu'aucun prélèvement ne paie, dans la
//      fenêtre que le relevé couvre — l'appel définitif l'a peut-être remplacée (`previsionnellesSansPaiement`). Il ne
//      retient pas la validation (2035S-Q4, (A)).
//
// Le garde de l'autre côté : une prévisionnelle déjà PAYÉE (prélevée, ou payée depuis le compte personnel) a été payée —
// l'appel d'une autre date est une échéance de plus, réelle, et les deux comptent à juste titre. Elle ne se remplace pas.

// 2035S-Q4 : QUAND L'APPEL DÉFINITIF REMPLACE-T-IL LA PRÉVISIONNELLE ? Réponse (A) : quand il tombe le MÊME MOIS civil. La
// réponse (B) — une fenêtre de quinze jours — s'écrit ici seulement (|écart| ≤ 15 jours) ; la réponse (C) — jamais à la
// création, le point d'attention seul — en rendant `false`.
export function remplaceLaPrevisionnelle(datePrevisionnelle: string, dateDefinitive: string): boolean {
  return datePrevisionnelle.slice(0, 7) === dateDefinitive.slice(0, 7)
}

export interface EcheanceProposee {
  date: string
  montant: number
  previsionnel: boolean
}

/** Ce que l'écran sait d'une échéance du dossier pour juger qu'une prévisionnelle peut se remplacer. */
export interface ContexteDesRemplacements {
  // Le mouvement rapproché qui la paie, quand le relevé en connaît un. Sur une lecture partielle des paiements, on ne le
  // sait pas : `paiementsLus` est faux, et aucun remplacement ne se propose (voir `inconnues`).
  payeeParUnMouvement: (c: CotisationDeclaree) => boolean
  paiementsLus: boolean
  // Figée par un exercice validé : sa date ne change plus (`garder_cotisation_valide`).
  figee: (c: CotisationDeclaree) => boolean
}

export interface RemplacementsDesPrevisionnelles {
  // L'indice de la proposition (dans la liste reçue) → la prévisionnelle qu'elle remplace.
  remplacements: ReadonlyMap<number, CotisationDeclaree>
  // Les propositions dont le mois porte PLUSIEURS prévisionnelles remplaçables : aucune n'est choisie à la place du
  // cabinet ; l'appel s'ajoute, et le point d'attention dira celle qui reste.
  ambigues: ReadonlyMap<number, CotisationDeclaree[]>
  // Les propositions dont une prévisionnelle du mois POURRAIT être remplacée, mais dont le paiement n'a pas été lu : la
  // création se suspend plutôt que d'ajouter l'appel à côté d'elle, ou de remplacer une prévisionnelle déjà prélevée.
  inconnues: ReadonlySet<number>
}

// LES PRÉVISIONNELLES QUE LES APPELS DÉFINITIFS PROPOSÉS REMPLACENT. Pour chaque proposition définitive à une date où
// aucune échéance n'existe (à la même date, la confirmation d'hier la reconnaît déjà), la prévisionnelle du même mois
// (`remplaceLaPrevisionnelle`) : pas à la même date qu'une autre proposition (celle-là la confirme), qu'aucun mouvement ne
// paie, ni le compte personnel, sans versement saisi (le versement ferait foi sur l'appel remplacé), pas figée. Une
// prévisionnelle ne se remplace qu'une fois : les propositions se jugent dans l'ordre de leur date, la première prend la
// prévisionnelle, la suivante s'ajoute.
export function remplacementsDesPrevisionnelles(
  proposees: readonly EcheanceProposee[],
  cotisations: readonly CotisationDeclaree[],
  contexte: ContexteDesRemplacements,
): RemplacementsDesPrevisionnelles {
  const remplacements = new Map<number, CotisationDeclaree>()
  const ambigues = new Map<number, CotisationDeclaree[]>()
  const inconnues = new Set<number>()
  const prises = new Set<string>()
  const datesProposees = new Set(proposees.map((e) => e.date))
  const ordre = proposees.map((e, i) => ({ e, i })).sort((a, b) => a.e.date.localeCompare(b.e.date) || a.i - b.i)
  for (const { e, i } of ordre) {
    if (e.previsionnel || cotisations.some((c) => c.echeance === e.date)) continue
    const candidates = cotisations.filter((c) =>
      c.previsionnel && !prises.has(c.id) && c.echeance !== e.date && !datesProposees.has(c.echeance)
      && remplaceLaPrevisionnelle(c.echeance, e.date)
      && !c.paiement_personnel_le && c.montant_verse == null && !contexte.figee(c))
    if (candidates.length === 0) continue
    if (!contexte.paiementsLus) {
      inconnues.add(i)
      continue
    }
    const impayees = candidates.filter((c) => !contexte.payeeParUnMouvement(c))
    if (impayees.length === 1) {
      remplacements.set(i, impayees[0])
      prises.add(impayees[0].id)
    } else if (impayees.length > 1) {
      ambigues.set(i, impayees)
    }
  }
  return { remplacements, ambigues, inconnues }
}

// Ce que la ligne de la proposition dit avant le clic.
export function texteDuRemplacement(prevue: Pick<CotisationDeclaree, 'echeance' | 'montant_appele'>): string {
  return `Remplace la prévisionnelle du ${formatDate(prevue.echeance)} (${formatMoney(prevue.montant_appele)})`
}
export function texteDeLAmbiguite(prevues: readonly Pick<CotisationDeclaree, 'echeance'>[]): string {
  return `S’ajoute : ${prevues.length} prévisionnelles de ce mois (${prevues.map((p) => formatDate(p.echeance)).join(', ')}), aucune n’est remplacée à ta place`
}

// LES PRÉVISIONNELLES QU'AUCUN PAIEMENT NE DATE, DANS LA FENÊTRE QUE LE RELEVÉ COUVRE — le point d'attention. Comptées à
// leur échéance (`compteeASonEcheance` : ni un prélèvement rapproché qui s'écrit, ni un paiement depuis le compte personnel),
// marquées prévisionnelles, datées entre le premier mouvement du relevé (après la frontière des exercices validés) et le
// dernier, moins la marge laissée au prélèvement (`couvertureDuReleve`, celle des échéances d'emprunt) : un relevé lu qui
// ne porte pas son prélèvement dit qu'elle n'a peut-être jamais été payée — l'appel définitif l'a remplacée. Hors de cette
// fenêtre, rien : avant le premier relevé rien n'a été importé, après le dernier le prélèvement n'est peut-être pas passé.
// `lignes` : TOUT le relevé lu (la fenêtre), dont `cotisationsComptees` ne retient que les rapprochés.
export function previsionnellesSansPaiement(
  cotisations: readonly CotisationDeclaree[],
  lignes: readonly MouvementBancaire[],
  mode: ModeComptable,
  frontiere: string | null,
): CotisationDeclaree[] {
  const couverture = couvertureDuReleve(lignes, frontiere)
  if (!couverture) return []
  return cotisationsComptees(cotisations, lignes, mode)
    .filter((c) => c.cotisation.previsionnel && compteeASonEcheance(c)
      && c.cotisation.echeance >= couverture.debut && c.cotisation.echeance <= couverture.fin)
    .map((c) => c.cotisation)
    .sort((a, b) => a.echeance.localeCompare(b.echeance) || a.id.localeCompare(b.id))
}
