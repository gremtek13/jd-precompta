import {
  centimesDe, former, ORDRE_DES_REFUS, refusDeLAncienne, retraitJuge, sansLOperation, type CleDuRefus, type CodeDuRefus,
  type DossierDeLaCaisse, type EtatDeLaCaisse, type OperationDeLaCaisse, type RefusCaisse,
} from './caisse'
import {
  jugerSelonLeLecteur, ORDRE_DU_PAIEMENT, type CleDuPaiement, type PieceDuPaiement, type PieceDuPaiementDuClient, type PieceLue,
} from './paiementParLaCaisse'

// CORRIGER UN PAIEMENT EN ESPÈCES D'UN SEUL GESTE, CE QUE LA BASE EN DIRA AVANT LE CLIC (C12B-Q1 ; ligne 26.6 ; MVP-D2). La
// décision du cabinet, le 04/11/2026, contre la recommandation : « Un seul geste « Corriger » (une migration) » — HISTORIQUE.md,
// « VINGT-QUATRE RÉPONSES DU CABINET » ; le récit : « LA CAISSE : CORRIGER UN PAIEMENT EN ESPÈCES D'UN SEUL GESTE (C12B-Q1)
// (PRÉPARÉE, PAS APPLIQUÉE) » ; la base : la migration `correction_du_paiement_par_la_caisse`, préparée le 04/11/2026
// (supabase/preparees/), PAS APPLIQUÉE — sa fonction, `remplacer_paiement_par_la_caisse(dossier, opération, date, montant)`.
//
// PUR : aucun appel au réseau, aucun import du client Supabase. Ce module redit, dans leur ORDRE, sous leurs MOTS et leurs
// CODES, les refus de la fonction neuve, sans en recopier aucun : la base juge l'ancien paiement par les cinq premiers refus
// du retrait (ceux de lib/caisse.ts, `refusDeLAncienne`), puis son genre (le seul mot neuf, `MOTS_DE_LA_CORRECTION`) ; le
// nouveau par `regler_piece_par_la_caisse` elle-même, l'ancien retiré (ici, `jugerSelonLeLecteur` de lib/paiementParLaCaisse.ts,
// le même jugement que le paiement d'une pièce) ; enfin la caisse sous les mots du retrait de l'ancien (`retraitJuge`), le
// nouveau écrit — la fonction retire l'ancien par `retirer_operation_caisse`. `correctionDuPaiement.test.ts` confronte l'ordre
// et les mots au texte de la migration, où qu'elle soit (préparée aujourd'hui, dans l'export le jour de son application), et
// le banc de l'essai (src/test/essaiCaisse.ts) rejoue ses étapes 270 à 289 par ce module, au verdict de la base.
//
// LE DRAPEAU. `CORRECTION_DU_PAIEMENT_EXPORTEE` reste BAISSÉ tant que la migration n'est pas dans l'export : aucun écran ne
// corrige un paiement, et les jugements `…Selon` le disent (`absent`) sans juger ; les écrans sont ceux d'hier, au caractère
// près. Levé le jour de l'application — le fichier dans l'export, sous la version de sa ligne d'historique —, « Corriger »
// s'offre dans « Mes pièces » (le praticien, ses propres paiements) et dans la fiche d'une pièce (le cabinet). Les moteurs ne
// changent pas : ils ne comptent que les paiements non retirés (`paiementsParLaCaisseSelon`), et la base retire l'ancien.
export const CORRECTION_DU_PAIEMENT_EXPORTEE = false

// ── Les mots de la base ───────────────────────────────────────────────────────────────────────────────────────────────

// Le seul refus neuf de `remplacer_paiement_par_la_caisse` : une opération qui n'est pas le paiement d'une pièce. Son gabarit
// est le texte du `raise exception` de la migration ; les autres sont ceux du retrait (lib/caisse.ts) et du paiement
// (lib/paiementParLaCaisse.ts), sous leurs clés.
export const MOTS_DE_LA_CORRECTION = {
  pas_un_paiement: { code: '22023', gabarit: 'Seul le paiement d\'une pièce par la caisse se corrige ainsi : une autre opération de la caisse se remplace.' },
} as const satisfies Record<string, { code: CodeDuRefus; gabarit: string }>

export type CleDeLaCorrection = keyof typeof MOTS_DE_LA_CORRECTION

// L'ORDRE DES REFUS DE `remplacer_paiement_par_la_caisse`, écrit une fois : l'accès (`qui_ecrit_la_caisse`), avant tout ; les
// cinq premiers refus du retrait sur l'ancien, ceux de `retirer_operation_caisse` ; son genre ; puis ceux de
// `regler_piece_par_la_caisse` sur le nouveau, dans leur ordre ; enfin la caisse négative — celle du nouveau sous le geste
// `paiement`, celle du retrait de l'ancien sous `retrait_paiement` —, dont le texte vient de `texte_caisse_negative`, à part.
export const ORDRE_DE_LA_CORRECTION: readonly (CleDuRefus | CleDeLaCorrection | CleDuPaiement)[] = [
  ...ORDRE_DES_REFUS.retirer_operation_caisse,
  'pas_un_paiement',
  ...ORDRE_DU_PAIEMENT.regler_piece_par_la_caisse,
]

function refusDeLaCorrection(cle: CleDeLaCorrection): RefusCaisse {
  const { code, gabarit } = MOTS_DE_LA_CORRECTION[cle]
  return { code, message: former(gabarit) }
}

// ── Le jugement ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** Ce que l'écran envoie avec l'ancien paiement : le jour et le montant du nouveau, signé comme le relevé. */
export interface SaisieDeLaCorrection {
  date: string | null
  montant: number | null
}

export type JugementDeLaCorrection =
  /** La migration n'est pas en base : rien ne se corrige, et rien ne se juge. */
  | { etat: 'absent' }
  | { etat: 'refuse'; refus: RefusCaisse }
  /** L'ancien paiement, le nouveau tel que la base l'écrirait (son lien compris), et la caisse qu'ils laissent. */
  | { etat: 'accepte'; ancien: OperationDeLaCaisse; operation: OperationDeLaCaisse; caisse: EtatDeLaCaisse }

function jugerSelonLeLecteurDeLaPiece(operationId: string | null, saisie: SaisieDeLaCorrection, dossier: DossierDeLaCaisse,
  trouver: (pieceId: string) => PieceLue | null, instant: string, id: string): JugementDeLaCorrection {
  const non = (refus: RefusCaisse): JugementDeLaCorrection => ({ etat: 'refuse', refus })
  // 1 à 5. L'accès, puis les cinq premiers refus du retrait, sur l'ancien : le client ne corrige que ses propres paiements.
  const lAncien = refusDeLAncienne(operationId, dossier)
  if (lAncien.refus) return non(lAncien.refus)
  const ancien = lAncien.operation
  // 6. Un paiement d'une pièce : une autre opération se remplace par sa saisie.
  if (ancien.genre !== 'paiement' || ancien.piece_id == null) return non(refusDeLaCorrection('pas_un_paiement'))
  // 7. Le nouveau, de la même pièce, jugé comme `regler_piece_par_la_caisse` le juge, l'ancien retiré : son plafond et son
  //    reste au centime ne comptent plus l'ancien, sa caisse négative se juge sur ce que la correction laisse.
  const sansLui: DossierDeLaCaisse = { ...dossier, caisse: sansLOperation(dossier.caisse, ancien.id, instant) }
  const nouveau = jugerSelonLeLecteur({ piece_id: ancien.piece_id, date: saisie.date, montant: saisie.montant }, sansLui, trouver, id)
  if (nouveau.etat === 'refuse') return non(nouveau.refus)
  if (nouveau.etat !== 'accepte') return { etat: 'absent' }
  const operation: OperationDeLaCaisse = { ...nouveau.operation, remplace_id: ancien.id }
  const caisse: EtatDeLaCaisse = { ...nouveau.caisse, operations: nouveau.caisse.operations.map((o) => (o.id === id ? operation : o)) }
  // 8. La caisse, quand l'ancien apportait des espèces que le nouveau ne rend pas : sous les mots du retrait de l'ancien.
  const negative = retraitJuge(ancien, caisse)
  if (negative) return non(negative)
  return { etat: 'accepte', ancien, operation, caisse }
}

/**
 * Ce que `remplacer_paiement_par_la_caisse` refuserait de CETTE correction, telle qu'elle part, dans son ordre et sous ses mots ;
 * ou le paiement qu'elle écrirait. `pieces` sont celles du DOSSIER telles que la base les lit (le cabinet, ou un banc qui joue
 * le client en lisant tout) ; `instant` est celui du retrait de l'ancien, `id` celui que l'écran donne au nouveau en attendant
 * la base. Le drapeau baissé (`enBase` faux) : `absent`, sans juger.
 */
export function jugerLaCorrectionSelon(enBase: boolean, operationId: string | null, saisie: SaisieDeLaCorrection,
  dossier: DossierDeLaCaisse, pieces: readonly PieceDuPaiement[], instant: string, id: string): JugementDeLaCorrection {
  if (!enBase) return { etat: 'absent' }
  return jugerSelonLeLecteurDeLaPiece(operationId, saisie, dossier, (pieceId) => {
    const piece = pieces.find((p) => p.id === pieceId)
    return piece == null ? null : { lecteur: 'cabinet', piece }
  }, instant, id)
}

/**
 * LA BRANCHE DU CLIENT (« Mes pièces ») : ce que la fonction refuserait d'une correction partie de l'écran du client, et que
 * cet écran PEUT savoir — le type et le sens de la pièce, jamais son montant : l'exemplaire d'une facture source, le plafond
 * d'une pièce validée et le reste au centime restent au jugement de la base, après le clic, comme pour son paiement
 * (`jugerLeReglementDuClientSelon`).
 */
export function jugerLaCorrectionDuClientSelon(enBase: boolean, operationId: string | null, saisie: SaisieDeLaCorrection,
  dossier: DossierDeLaCaisse, pieces: readonly PieceDuPaiementDuClient[], instant: string, id: string): JugementDeLaCorrection {
  if (!enBase) return { etat: 'absent' }
  return jugerSelonLeLecteurDeLaPiece(operationId, saisie, dossier, (pieceId) => {
    const piece = pieces.find((p) => p.id === pieceId)
    return piece == null ? null : { lecteur: 'client', piece }
  }, instant, id)
}

/** Le même jugement, selon le drapeau : `absent` tant que la migration n'est pas dans l'export. */
export function jugerLaCorrection(operationId: string | null, saisie: SaisieDeLaCorrection, dossier: DossierDeLaCaisse,
  pieces: readonly PieceDuPaiement[], instant: string, id: string): JugementDeLaCorrection {
  return jugerLaCorrectionSelon(CORRECTION_DU_PAIEMENT_EXPORTEE, operationId, saisie, dossier, pieces, instant, id)
}

/** La branche du client, selon le drapeau. */
export function jugerLaCorrectionDuClient(operationId: string | null, saisie: SaisieDeLaCorrection, dossier: DossierDeLaCaisse,
  pieces: readonly PieceDuPaiementDuClient[], instant: string, id: string): JugementDeLaCorrection {
  return jugerLaCorrectionDuClientSelon(CORRECTION_DU_PAIEMENT_EXPORTEE, operationId, saisie, dossier, pieces, instant, id)
}

/**
 * La correction s'offre-t-elle sur CE paiement, le drapeau dit ? Un paiement d'une pièce, non retiré : celui qu'une
 * correction remplace se dit à part (sa chaîne). Le reste — l'auteur pour le client, la frontière — est le jugement.
 */
export function correctionOfferteSelon(enBase: boolean, o: Pick<OperationDeLaCaisse, 'genre' | 'piece_id' | 'retire_le'>): boolean {
  return enBase && o.genre === 'paiement' && o.piece_id != null && o.retire_le == null
}

/** La même, selon le drapeau. */
export function correctionOfferte(o: Pick<OperationDeLaCaisse, 'genre' | 'piece_id' | 'retire_le'>): boolean {
  return correctionOfferteSelon(CORRECTION_DU_PAIEMENT_EXPORTEE, o)
}

/** Une correction qui ne change rien — le même jour, le même montant — n'a rien à écrire : la règle du formulaire seul. */
export const RIEN_A_CORRIGER = 'Rien à corriger : ce sont le jour et le montant de ce paiement.'

// ── Ce que les écrans disent du remède, selon le drapeau ──────────────────────────────────────────────────────────────

// LES MOTS QUI DISENT COMMENT REPRENDRE UN PAIEMENT. Le drapeau baissé, ceux d'hier, au caractère près — retirer, puis
// payer de nouveau ; levé, le geste neuf. Une seule table, que chaque écran lit par `motsDuRemedeSelon`, le drapeau qu'IL a
// importé en paramètre (les tests le jouent dans ses deux états, par l'import) : la pastille d'un
// paiement dans l'onglet Caisse, l'aide et la confirmation d'un retrait dans « Mes pièces » (le client, tutoyé), et le
// remède d'un paiement que sa pièce contredit depuis (`caisse-paiements-a-retirer` : le détail, le préalable de la
// validation, le libellé du point de la Vue d'ensemble). Hier, ce détail disait de retirer le paiement « dans l'onglet
// Caisse », qui n'offre pas ce geste sur un paiement : levé, il dit la fiche de la pièce, où les deux gestes vivent.
const MOTS_DU_REMEDE = {
  hier: {
    pastille: 'Se retire depuis la fiche de la pièce',
    aideDuClient: 'Pour corriger un paiement, retire-le puis enregistre le bon.',
    finDuRetraitDuClient: 'Pour le corriger, retire-le puis enregistre le bon.',
    detail: 'Dans l’onglet Caisse, retirer le paiement, puis le saisir de nouveau depuis la fiche de la pièce, au montant exact — '
      + 'ou corriger la pièce.',
    prealable: 'Retirer le paiement, puis le saisir de nouveau au montant exact — ou corriger la pièce — avant la validation.',
    point: 'à retirer, puis à saisir de nouveau',
  },
  correction: {
    pastille: 'Se corrige ou se retire depuis la fiche de la pièce',
    aideDuClient: 'Pour corriger le jour ou le montant d’un paiement, « Corriger » le remplace d’un seul geste.',
    finDuRetraitDuClient: 'Pour corriger son jour ou son montant, « Corriger » le remplace d’un seul geste.',
    detail: 'Depuis la fiche de la pièce, corriger le paiement au montant exact, dans le sens de la pièce — ou corriger la pièce.',
    prealable: 'Corriger le paiement au montant exact depuis la fiche de la pièce — ou corriger la pièce — avant la validation.',
    point: 'à corriger depuis la fiche de la pièce',
  },
} as const

export type MotsDuRemede = (typeof MOTS_DU_REMEDE)[keyof typeof MOTS_DU_REMEDE]

/** Les mots du remède, la migration en base ou non. */
export function motsDuRemedeSelon(enBase: boolean): MotsDuRemede {
  return enBase ? MOTS_DU_REMEDE.correction : MOTS_DU_REMEDE.hier
}


/**
 * La règle du formulaire : le jour et le montant du nouveau sont-ils ceux de l'ancien, au centime près — un montant qui n'est
 * pas au centime n'est celui de personne (la base le refuse sous ses mots) ?
 */
export function correctionSansChangement(ancien: Pick<OperationDeLaCaisse, 'date' | 'montant'>, saisie: SaisieDeLaCorrection): boolean {
  if (saisie.date !== ancien.date || saisie.montant == null) return false
  const nouveau = centimesDe(saisie.montant)
  return nouveau !== null && nouveau === centimesDe(ancien.montant)
}
