import { INVENTAIRE_EXPORTE, INVENTAIRE_PREVU } from './inventaire'
import type { DeclarationDeLaValidation, InventaireDeLaValidation, ProvisionDeLaValidation } from './inventaireDeLaValidation'
import type { InventaireDesControles, OperationDesControles } from './inventaireDesControles'
import { lireTout } from './lectureComplete'
import { messageErreur } from './messageErreur'
import { supabase } from './supabase'

// CE QUE LA VALIDATION LIT DE L'INVENTAIRE D'UN DOSSIER (ligne 35, INV3 ; lib/inventaireDeLaValidation.ts) : ses régularisations,
// ses déclarations et ses provisions, chacune EN ENTIER (`lireTout`, un tri total terminé par la clé primaire), les colonnes
// que les juges lisent, nommées. DERRIÈRE `INVENTAIRE_PREVU` : baissé, les tables ne sont pas en base — aucun appel, l'inventaire
// est sans objet, et la validation celle d'hier. Ne rejette jamais : une lecture refusée, coupée, ou une ligne que les juges ne
// croiraient pas se dit (`incomplete`), et la validation se suspend.

export type LectureDeLInventaire =
  | { dossierId: string; etat: 'sans_objet' }
  | { dossierId: string; etat: 'lu'; inventaire: Extract<InventaireDesControles, { etat: 'lu' }> }
  | { dossierId: string; etat: 'incomplete'; motif: string }

/** L'inventaire d'un dossier, lu pour sa validation ; ne rejette jamais. Drapeau baissé, aucun appel. */
export async function lireLInventaireDeLaValidation(dossierId: string): Promise<LectureDeLInventaire> {
  return lireLInventaireDeLaValidationSelon(dossierId, INVENTAIRE_PREVU)
}

const NATURES = new Set(['cca', 'pca', 'fnp', 'fae', 'charge_a_payer', 'produit_a_recevoir', 'provision'])
const entier = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v)
const texte = (v: unknown): v is string => typeof v === 'string'

function operationLue(l: Record<string, unknown>): OperationDesControles | null {
  if (!texte(l.id) || !entier(l.exercice) || !texte(l.nature) || !NATURES.has(l.nature) || !texte(l.compte_resultat)
    || !texte(l.compte_regularisation) || !entier(l.montant_centimes) || !entier(l.tva_centimes) || !texte(l.objet)
    || !(l.provision_id === null || texte(l.provision_id)) || typeof l.reprise !== 'boolean'
    || !(l.piece_citee_id === null || texte(l.piece_citee_id))) return null
  return {
    id: l.id, exercice: l.exercice, nature: l.nature as OperationDesControles['nature'], compte_resultat: l.compte_resultat,
    compte_regularisation: l.compte_regularisation, montant_centimes: l.montant_centimes, tva_centimes: l.tva_centimes, objet: l.objet,
    provision_id: l.provision_id, reprise: l.reprise, piece_citee_id: l.piece_citee_id,
  }
}

function declarationLue(l: Record<string, unknown>): DeclarationDeLaValidation | null {
  if (!texte(l.id) || !entier(l.exercice) || !(l.retire_le === null || texte(l.retire_le))) return null
  return { id: l.id, exercice: l.exercice, retire_le: l.retire_le }
}

function provisionLue(l: Record<string, unknown>): ProvisionDeLaValidation | null {
  if (!texte(l.id) || !texte(l.compte_provision) || !(l.reprise_centimes === null || entier(l.reprise_centimes))) return null
  return { id: l.id, compte_provision: l.compte_provision, reprise_centimes: l.reprise_centimes }
}

/** La même lecture, selon que les tables sont en base : les deux états du drapeau, que les tests jouent. */
export async function lireLInventaireDeLaValidationSelon(dossierId: string, enBase: boolean): Promise<LectureDeLInventaire> {
  if (!enBase) return { dossierId, etat: 'sans_objet' }
  try {
    const [operations, declarations, provisions] = await Promise.all([
      lireTout<Record<string, unknown>>((debut, fin) => supabase.from('operations_inventaire')
        .select('id, exercice, nature, compte_resultat, compte_regularisation, montant_centimes, tva_centimes, objet, provision_id, reprise, piece_citee_id', { count: 'exact' })
        .eq('dossier_id', dossierId).order('exercice').order('id').range(debut, fin)),
      lireTout<Record<string, unknown>>((debut, fin) => supabase.from('inventaires_declares')
        .select('id, exercice, retire_le', { count: 'exact' })
        .eq('dossier_id', dossierId).order('exercice').order('id').range(debut, fin)),
      lireTout<Record<string, unknown>>((debut, fin) => supabase.from('provisions')
        .select('id, compte_provision, reprise_centimes', { count: 'exact' })
        .eq('dossier_id', dossierId).order('id').range(debut, fin)),
    ])
    // Chaque drapeau lu, l'un après l'autre : une lecture en partie suspend la validation, et dit laquelle.
    if (!operations.complete) return { dossierId, etat: 'incomplete', motif: `les régularisations : ${operations.motif ?? 'lecture partielle'}` }
    if (!declarations.complete) return { dossierId, etat: 'incomplete', motif: `les déclarations : ${declarations.motif ?? 'lecture partielle'}` }
    if (!provisions.complete) return { dossierId, etat: 'incomplete', motif: `les provisions : ${provisions.motif ?? 'lecture partielle'}` }
    const ops = operations.lignes.map(operationLue)
    const decs = declarations.lignes.map(declarationLue)
    const provs = provisions.lignes.map(provisionLue)
    if (ops.includes(null) || decs.includes(null) || provs.includes(null)) {
      return { dossierId, etat: 'incomplete', motif: 'une ligne de l’inventaire lue ne se croit pas' }
    }
    return {
      dossierId, etat: 'lu',
      inventaire: {
        etat: 'lu',
        operations: ops as OperationDesControles[],
        declarations: decs as DeclarationDeLaValidation[],
        provisions: provs as ProvisionDeLaValidation[],
      },
    }
  } catch (e) {
    return { dossierId, etat: 'incomplete', motif: messageErreur(e, 'la lecture de l’inventaire a échoué') }
  }
}

// CE QUE LES CONTRÔLES LISENT DE L'INVENTAIRE (ligne 35, INV6 ; lib/inventaireDesControles.ts) : le bilan, la Vue d'ensemble,
// la Clôture et la révision. La même lecture, DERRIÈRE `INVENTAIRE_EXPORTE` : baissé, aucun appel — l'inventaire est sans objet,
// et ces écrans sont ceux d'hier. Levé, `INVENTAIRE_PREVU` l'est aussi (inventaireDeLEcranLecture.test.ts garde l'implication).
export async function lireLInventaireDesControles(dossierId: string): Promise<LectureDeLInventaire> {
  return lireLInventaireDeLaValidationSelon(dossierId, INVENTAIRE_EXPORTE)
}

/** Ce que les contrôles reçoivent : l'inventaire sans objet ou lu entier ; nul tant qu'il n'est pas revenu entier. */
export function inventaireDesControlesDeLaLecture(lecture: LectureDeLInventaire | null): InventaireDesControles | null {
  if (lecture === null || lecture.etat === 'incomplete') return null
  return lecture.etat === 'sans_objet' ? { etat: 'sans_objet' } : lecture.inventaire
}

/** Ce que la validation reçoit (lib/prealablesValidation.ts) : l'inventaire, sans objet, ou nul tant qu'il n'est pas lu entier. */
export function inventaireDeLaLecture(lecture: LectureDeLInventaire | null): InventaireDeLaValidation | null {
  if (lecture === null || lecture.etat === 'incomplete') return null
  return lecture.etat === 'sans_objet' ? { etat: 'sans_objet' } : lecture.inventaire
}

/** Le motif qui suspend la validation, ou nul quand l'inventaire est sans objet ou lu en entier. */
export function motifDeLInventaire(lecture: LectureDeLInventaire | null): string | null {
  if (lecture === null) return 'l’inventaire du dossier n’est pas encore lu'
  return lecture.etat === 'incomplete' ? `l’inventaire du dossier : ${lecture.motif}` : null
}
