// L'appel à `proposer-categorie` (Edge Function), sur le clic de l'opérateur dans la fiche d'une
// pièce. Tout ce qui se calcule vit dans `categorisationIa.ts`, qui n'importe pas le client Supabase :
// ce module-ci ne fait que l'appel — voir CLAUDE.md, « un module de calcul n'importe jamais le client
// Supabase ».

import { supabase } from './supabase'
import { extraireErreurFonction } from './invokeErreur'
import { lireProposition, type PropositionCategorie } from './categorisationIa'
import type { TypePiece } from './types'

/**
 * Demande une catégorie pour une pièce, d'après le texte que l'OCR y a lu. RIEN n'est écrit : la
 * proposition revient à l'écran, et c'est l'opérateur qui l'applique puis enregistre. Le type est
 * celui AFFICHÉ dans la fiche — il a pu être corrigé sans être encore enregistré, et c'est lui qui
 * décide du sens des catégories proposées.
 */
export async function proposerCategorie(pieceId: string, typePiece: TypePiece): Promise<PropositionCategorie> {
  const { data, error } = await supabase.functions.invoke('proposer-categorie', { body: { pieceId, typePiece } })
  if (error) throw new Error(await extraireErreurFonction(error, 'La proposition n’a pas pu être obtenue.'))
  return lireProposition(data)
}
