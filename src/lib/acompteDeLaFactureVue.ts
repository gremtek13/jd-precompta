import type { AcompteCii } from './factureCii'
import { formatDate } from './format'

// CE QUE L'APERÇU IMPRIME DE L'ACOMPTE D'UN DEVIS (étape P5b4b ; conception : HISTORIQUE.md, « L'ACOMPTE D'UN DEVIS : LA
// CONCEPTION (P5B) »). Module pur : l'aperçu (`FactureApercu`, les deux espaces) ne décide rien, il pose ce que rend
// `ceQueLAcompteImprime`.
//   - LA FACTURE D'ACOMPTE : « FACTURE D'ACOMPTE » et son numéro ; « Acompte sur le devis … du … » (le devis lié) ; la date
//     du versement, connue et autre que celle de la facture (BOI-TVA-DECLA-30-20-20-10, § 160 ; BT-9).
//   - LA FINALE : « FACTURE », et « Facture définitive après l'acompte … du …, repris en déduction » — ou « les acomptes » —
//     (§ 60 : « la facture définitive doit faire référence aux différentes factures d'acomptes ») ; ses lignes de reprise
//     s'impriment comme toute ligne, quantité et montants négatifs.
//   - L'AVOIR D'UN ACOMPTE : « AVOIR », et « Avoir sur la facture d'acompte … du … » à la place de « En référence à la
//     facture … ».
// SANS ACOMPTE (le drapeau baissé, ou une facture qui n'en porte ni n'en reprend) : `sans`, et l'aperçu est celui d'hier au
// caractère près. Pas encore lu, ou illisible : rien ne s'imprime tant qu'on ne sait pas ce qu'est la facture — le titre
// d'une facture d'acompte imprimée « FACTURE » serait faux.

/** Une facture citée (l'acompte qu'un avoir corrige) : son numéro et sa date, tels que la base les rend. */
export interface FactureCitee {
  numero: string | null
  date_emission: string
}

/** Le devis auquel la facture est liée (`devis_factures`), cité par l'aperçu d'une facture d'acompte. */
export interface DevisCite {
  numero: string
  date_emission: string
}

/** L'acompte d'une facture tel que la lecture le rend (lib/acompteDeLaFactureLecture.ts), gardé avec la facture lue. */
export type LectureAcompte =
  | { factureId: string; etat: 'lue'; acompte: AcompteCii; origine: FactureCitee | null; devis: DevisCite | null }
  | { factureId: string; etat: 'illisible'; motif: string }

export type AcompteImprime =
  // Rien de l'acompte : l'aperçu d'hier.
  | { etat: 'sans' }
  // Pas encore lu, ou illisible : l'écran le dit (jamais le papier), et l'impression ne s'offre pas.
  | { etat: 'retenu'; avis: string }
  // Le titre (sans le numéro), les références sous le titre, et si la référence d'hier à la facture corrigée reste.
  | { etat: 'imprime'; titre: string; references: readonly string[]; referenceDOrigine: boolean }

export const ACOMPTE_EN_LECTURE = 'Lecture de l’acompte de la facture… L’impression attend : on ne sait pas encore si c’est une facture d’acompte.'

const citee = (numero: string | null, dateEmission: string) => `${numero ?? '(sans numéro)'} du ${formatDate(dateEmission)}`

function enumeration(elements: readonly string[]): string {
  return elements.length <= 1 ? elements.join('') : `${elements.slice(0, -1).join(', ')} et ${elements[elements.length - 1]}`
}

/**
 * Ce que l'aperçu imprime de l'acompte de la facture. `lecture` nulle : pas encore revenue (ou revenue pour une autre
 * facture : l'appelant ne passe que celle de la facture montrée).
 */
export function ceQueLAcompteImprime(
  facture: { type: 'facture' | 'avoir'; date_emission: string },
  lecture: LectureAcompte | null,
): AcompteImprime {
  if (lecture === null) return { etat: 'retenu', avis: ACOMPTE_EN_LECTURE }
  if (lecture.etat === 'illisible') {
    return { etat: 'retenu', avis: `${lecture.motif} L’impression ne s’offre pas : on ne sait pas si c’est une facture d’acompte, une facture finale ou leur avoir.` }
  }
  const a = lecture.acompte
  const illisible = (quoi: string): AcompteImprime => ({ etat: 'retenu', avis: `${quoi} L’impression ne s’offre pas : rouvre l’aperçu.` })
  if (a.acompte === null) return illisible('La marque d’acompte de la facture n’est pas lue.')

  if (facture.type === 'avoir') {
    if (a.origineAcompte === null) return illisible('La marque d’acompte de la facture que l’avoir corrige n’est pas lue.')
    if (!a.origineAcompte) return { etat: 'sans' }
    if (lecture.origine === null) return illisible('Le numéro et la date de la facture d’acompte que l’avoir corrige ne sont pas lus.')
    return {
      etat: 'imprime', titre: 'AVOIR', referenceDOrigine: false,
      references: [`Avoir sur la facture d’acompte ${citee(lecture.origine.numero, lecture.origine.date_emission)}`],
    }
  }

  if (a.acompte) {
    const references: string[] = []
    if (lecture.devis) references.push(`Acompte sur le devis ${citee(lecture.devis.numero, lecture.devis.date_emission)}`)
    if (a.dateVersement !== null && a.dateVersement !== facture.date_emission) references.push(`Acompte versé le ${formatDate(a.dateVersement)}`)
    return { etat: 'imprime', titre: 'FACTURE D’ACOMPTE', references, referenceDOrigine: true }
  }

  if (a.reprises.length === 0 && a.acomptesRepris.length === 0) return { etat: 'sans' }
  // La finale cite TOUS les acomptes qu'elle reprend : une reprise dont l'acompte n'est pas lu ferait imprimer une phrase
  // qui en tairait un.
  const parId = new Map(a.acomptesRepris.map((r) => [r.id, r]))
  if (a.reprises.some((r) => r.factureId === null || !parId.has(r.factureId))) {
    return illisible('Une facture d’acompte que la facture reprend n’est pas lue.')
  }
  const cites = [...new Set(a.reprises.map((r) => r.factureId as string))]
    .map((id) => parId.get(id)!)
    .sort((x, y) => x.date_emission.localeCompare(y.date_emission) || (x.numero ?? '').localeCompare(y.numero ?? ''))
  if (cites.some((r) => r.acompte !== true)) return illisible('Une facture que la facture reprend n’est pas lue comme une facture d’acompte.')
  const liste = enumeration(cites.map((r) => citee(r.numero, r.date_emission)))
  return {
    etat: 'imprime', titre: 'FACTURE', referenceDOrigine: true,
    references: [cites.length === 1
      ? `Facture définitive après l’acompte ${liste}, repris en déduction`
      : `Facture définitive après les acomptes ${liste}, repris en déduction`],
  }
}

// LA FENÊTRE DE TRANSMISSION (`TransmissionFactureModal`) : l'acompte se passe à `refusEmission`, dont les refus se disent
// avant le clic ; tant qu'il n'est pas lu, ou s'il est illisible, aucun geste de transmission ne s'offre, et elle le dit.
export const ACOMPTE_A_LIRE_AVANT_LA_TRANSMISSION =
  'Lecture de l’acompte de la facture… Rien n’est proposé avant : on ne sait pas encore si c’est une facture d’acompte.'

export function acompteIllisibleAvantLaTransmission(motif: string): string {
  return `${motif} On ne sait donc pas si c’est une facture d’acompte, une facture finale ou leur avoir : rien n’est proposé. Rouvre cette fenêtre.`
}
