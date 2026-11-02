import { sirenValide, siretValide } from './factureCii'
import { formatDate } from './format'
import type { FactureEmise, Piece } from './types'

// LE NOM DU CLIENT HORS DES LIBELLÉS D'UNE VENTE (FEC22-Q7, tranchée par le cabinet le 02/11/2026 sur la recommandation ;
// HISTORIQUE.md, « FEC22-Q7 : LE NOM DU CLIENT HORS DES LIBELLÉS D'UNE VENTE »). Le FEC part chez l'expert-comptable et,
// sur demande, chez l'administration ; pour un soignant, le client est un patient, et le libellé d'une écriture n'a pas à
// le nommer : « le nom ou une référence qui permet de le retrouver » (BOI-BNC-DECLA-10-20, § 280 ; CGI, art. 99 ; code
// pénal, art. 226-13). LA RÈGLE, ÉCRITE ICI SEULEMENT :
//   - une facture émise à une ENTREPRISE — un client que le SIRET ou le SIREN figé sur la facture désigne, jugé
//     EXACTEMENT comme l'identification du client du FEC (IdClient, `identificationDuClient`, lib/champsBncDuFec.ts, qui
//     appelle `sirenDuClient`) — garde son nom dans le libellé, et son compte auxiliaire au 411 ;
//   - toute autre facture se nomme par son NUMÉRO, que le libellé porte déjà, et son 411 va au compte « Clients divers » ;
//   - une PIÈCE DE VENTE déposée, dont rien ne dit si le client est une entreprise, s'écrit « Recette » et sa date, jamais
//     le nom lu (ni le tiers que l'OCR a lu, ni le nom du fichier), et son 411 va au compte « Clients divers » au FEC ;
//   - un achat (et toute pièce qui n'est pas de vente) garde le nom de son fournisseur, comme hier.
// Un module PUR : ni la base, ni l'horloge. libellesDesVentes.test.ts relève, dans TOUTE la source, les écritures
// composées et le compte auxiliaire du FEC : un nom lu hors de ces fonctions y est une faute.

/**
 * Le SIREN de l'entreprise cliente qu'une facture désigne, ou nul : les neuf premiers chiffres de `tiers_siret` quand il
 * n'est fait que de chiffres (quatorze, un SIRET ; neuf, un SIREN saisi seul) et passe la clé de Luhn de l'INSEE, celle
 * du SIREN comprise (`siretValide`, `sirenValide`, lib/factureCii.ts : La Poste et ses établissements compris). Un SIRET
 * mal formé ne se corrige pas (ni espace retiré ni chiffre deviné) : il ne désigne personne. Le prédicat UNIQUE de ce qui
 * est une entreprise, pour IdClient comme pour les libellés.
 */
export function sirenDuClient(facture: Pick<FactureEmise, 'tiers_siret'>): string | null {
  const s = facture.tiers_siret
  if (s !== null && /^\d{14}$/.test(s) && siretValide(s) && sirenValide(s.slice(0, 9))) return s.slice(0, 9)
  if (s !== null && /^\d{9}$/.test(s) && sirenValide(s)) return s
  return null
}

/**
 * Le nom qu'une écriture de la facture peut porter : celui du client quand c'est une entreprise (`sirenDuClient`), ses
 * blancs ramenés à un seul ; nul sinon — un particulier, un patient, ou un nom vide. C'est aussi le tiers d'où vient le
 * compte auxiliaire du 411 (`auxiliaireDuTiers`, lib/engagement.ts) : nul, le compte « Clients divers ».
 */
export function nomDuClientEcrit(facture: Pick<FactureEmise, 'tiers_siret' | 'tiers_nom'>): string | null {
  if (sirenDuClient(facture) === null) return null
  const nom = facture.tiers_nom.replace(/\s+/g, ' ').trim()
  return nom === '' ? null : nom
}

/**
 * Le libellé d'une écriture d'une vente facturée : son début (le geste et le numéro du document, que l'appelant compose,
 * « Facture F2026-0001 », « Encaissement, facture F2026-0001 »), suivi du nom du client quand c'est une entreprise. Le
 * numéro EST la référence d'un client qui n'en est pas une : rien ne s'ajoute.
 */
export function libelleDUneVenteFacturee(debut: string, facture: Pick<FactureEmise, 'tiers_siret' | 'tiers_nom'>): string {
  const nom = nomDuClientEcrit(facture)
  return nom === null ? debut : `${debut} — ${nom}`
}

/** Une pièce telle que son libellé la lit. */
export type PieceLibellee = Pick<Piece, 'type_piece' | 'tiers' | 'nom_fichier' | 'date_piece'>

/**
 * Le libellé des écritures d'une pièce (sa charge ou son produit, sa TVA, son compte de tiers, ses contreparties) : une
 * pièce de vente, « Recette du JJ/MM/AAAA » à la date de la pièce (« Recette » sans date lue) ; toute autre pièce, son
 * tiers lu, sinon le nom de son fichier, comme hier.
 */
export function libelleDUnePiece(piece: PieceLibellee): string {
  if (piece.type_piece === 'vente') return piece.date_piece ? `Recette du ${formatDate(piece.date_piece)}` : 'Recette'
  return piece.tiers ?? piece.nom_fichier
}

/**
 * Le tiers d'une pièce tel que le compte auxiliaire du FEC le lit (CompAuxNum, CompAuxLib) : aucun pour une pièce de vente
 * (le compte « Clients divers ») ni pour une pièce que la lecture ne rend pas (le compte « divers ») ; son tiers lu sinon.
 * Les écrans du cabinet (le lettrage à la main, les comptes de tiers, le bilan) regroupent toujours par le nom lu : ils ne
 * sortent pas du cabinet.
 */
export function tiersAuFec(piece: Pick<Piece, 'type_piece' | 'tiers'> | undefined): Pick<Piece, 'tiers'> {
  return { tiers: piece === undefined || piece.type_piece === 'vente' ? null : piece.tiers }
}
