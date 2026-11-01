// LE DRAPEAU DES QUATRE CHAMPS DU FEC D'UN BNC EN TRÉSORERIE, ET LE CHOIX QU'IL PORTE (ligne 26.6, étape e ; lots FEC22c1 et
// FEC22c2). Un module SANS IMPORT : la génération des écritures (lib/ecritures.ts, par lib/ecritureParReglement.ts) le lit, et
// lib/champsBncDuFec.ts, qui le redit, importe lib/cases2035.ts — un cycle (cases2035 → declaration2035 → ecritures) qui
// l'évaluerait avant ses propres imports.

// ── Le choix de FEC22-Q1 ───────────────────────────────────────────────────────────────────────────────────────────────

/**
 * DateRglt et ModeRglt d'une écriture qui n'est PAS un règlement — une dotation, un forfait kilométrique, une liquidation
 * de TVA, les à-nouveaux, la TVA due d'une facture, une pièce sans paiement. Le VIII, 7° ne les dit pas « à blanc », et
 * Test Compta Demat ne les contrôle plus depuis le 23/01/2015 : la réponse du cabinet (FEC22-Q1, (C)) est « selon ce
 * qu'exige le logiciel de l'expert-comptable », que FEC22-E2 dira. `vides` : les deux à blanc ; `date_de_l_ecriture` :
 * DateRglt la date de l'écriture et ModeRglt « Sans règlement ». SANS VALEUR PAR DÉFAUT.
 */
export const SANS_REGLEMENT = ['vides', 'date_de_l_ecriture'] as const
export type SansReglement = (typeof SANS_REGLEMENT)[number]

export interface ChoixChampsBnc {
  sansReglement: SansReglement
}

// ── Le drapeau ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * LE FEC D'UN DOSSIER EN TRÉSORERIE PORTE-T-IL SES VINGT-DEUX CHAMPS (lot FEC22c) ? `null` : le drapeau BAISSÉ — le fichier
 * d'aujourd'hui, à dix-huit colonnes, est celui qu'on exporte, et rien de neuf n'est lu. Levé, il PORTE le choix de
 * FEC22-Q1 : le drapeau ne se lève qu'avec la réponse de l'expert-comptable à FEC22-E2 (vides, ou la date de l'écriture et
 * « Sans règlement »), de sorte que l'écran reçoive ce choix sans qu'aucune valeur par défaut ne le décide à sa place. Il
 * reste baissé tant que la migration FEC22b n'est pas appliquée : levé, la validation envoie les quatre valeurs (FEC22c2), que
 * la base d'avant la migration ignorerait — l'exercice serait validé sans elles, et ne pourrait plus les recevoir
 * (FEC22-Q6). Levé, il fait aussi écrire à la génération une ligne de charge et une de TVA par règlement d'une même date
 * (lib/ecritureParReglement.ts). Les tests le jouent dans ses deux états par un accesseur (`get CHAMPS_BNC_EXPORTES()`).
 */
export const CHAMPS_BNC_EXPORTES: ChoixChampsBnc | null = null
