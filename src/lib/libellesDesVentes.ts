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
//   - un achat (et toute pièce qui n'est pas de vente) garde le nom de son fournisseur, comme hier ; sans fournisseur lu,
//     « Pièce du JJ/MM/AAAA » à la date de la pièce (« Pièce sans date » sans elle), jamais le nom de son fichier, que le
//     praticien a pu nommer d'après un patient (JJ1Q1-Q2, réponse du cabinet du 08/11/2026).
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

/** Une facture qu'un mouvement du relevé encaisse, telle que le libellé de son écriture la lit : son numéro, que
 *  l'appelant nomme (« F2026-0001 », ou le début de l'identifiant d'une facture sans numéro), et son client figé. */
export type FactureDuMouvement = { numero: string } & Pick<FactureEmise, 'tiers_siret' | 'tiers_nom'>

/** La longueur au-delà de laquelle le libellé d'un mouvement ne cite plus chaque facture. Ni la base (`text`) ni le FEC
 *  (article A47 A-1 du LPF, qui ne fixe aucune longueur à EcritureLib) n'en imposent une : celle des libellés du plan
 *  comptable d'un dossier (`plan_comptable_dossier_libelle`), pour qu'une ligne reste lisible chez l'expert-comptable. */
export const LONGUEUR_DU_LIBELLE_D_UN_MOUVEMENT = 200

/**
 * Le libellé de l'écriture d'un mouvement du relevé que ses encaissements classent (JJ1, relecture du jour J,
 * 06/11/2026) : « Relevé du JJ/MM/AAAA — » et les numéros des factures que ses encaissements citent, sans doublon, dans
 * l'ordre des octets — JAMAIS le libellé de la banque, qui nomme qui a payé (« VIR SEPA RECU DE MME … ») et que le FEC
 * rendrait en EcritureLib. Le nom d'un client n'y entre que par `libelleDUneVenteFacturee`, et seulement quand TOUTES les
 * factures citées sont d'entreprises : une seule facture d'un particulier, et le libellé ne nomme personne. Trop long, il
 * retombe sur les seuls numéros, puis sur le premier et le compte des autres.
 */
export function libelleDUnMouvementDesVentes(date: string, factures: readonly FactureDuMouvement[]): string {
  const debut = `Relevé du ${formatDate(date)}`
  const parNumero = new Map<string, FactureDuMouvement>()
  for (const f of factures) if (!parNumero.has(f.numero)) parNumero.set(f.numero, f)
  const numeros = [...parNumero.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  if (numeros.length === 0) return debut
  const toutesDEntreprises = numeros.every((n) => nomDuClientEcrit(parNumero.get(n)!) !== null)
  const essais = [
    ...(toutesDEntreprises ? [numeros.map((n) => libelleDUneVenteFacturee(n, parNumero.get(n)!)).join(', ')] : []),
    numeros.join(', '),
  ]
  for (const liste of essais) {
    const libelle = `${debut} — ${liste}`
    if (libelle.length <= LONGUEUR_DU_LIBELLE_D_UN_MOUVEMENT) return libelle
  }
  const autres = numeros.length - 1
  return `${debut} — ${numeros[0]} et ${autres} autre${autres > 1 ? 's' : ''} facture${autres > 1 ? 's' : ''}`.slice(0, LONGUEUR_DU_LIBELLE_D_UN_MOUVEMENT)
}

/** Une pièce telle que son libellé la lit : jamais le nom de son fichier (JJ1Q1-Q2), que le type ne laisse pas lire. */
export type PieceLibellee = Pick<Piece, 'type_piece' | 'tiers' | 'date_piece'>

/** Le libellé d'une pièce dont le fournisseur n'a pas été lu (JJ1Q1-Q2) : sa date, jamais une date devinée. */
export const LIBELLE_D_UNE_PIECE_SANS_DATE = 'Pièce sans date'

/**
 * Le libellé des écritures d'une pièce (sa charge ou son produit, sa TVA, son compte de tiers, ses contreparties) : une
 * pièce de vente, « Recette du JJ/MM/AAAA » à la date de la pièce (« Recette » sans date lue) ; toute autre pièce, son
 * tiers lu, tel quel, comme hier ; sans tiers lu (nul ou blanc), « Pièce du JJ/MM/AAAA » à la date de la pièce, « Pièce
 * sans date » sans elle — jamais le nom de son fichier (JJ1Q1-Q2), ni la date du dépôt, qui n'est pas celle de la pièce.
 * Ce qui est déjà au brouillon garde son libellé (FEC22Q7-Q1) : seules les écritures composées ensuite le portent.
 */
export function libelleDUnePiece(piece: PieceLibellee): string {
  if (piece.type_piece === 'vente') return piece.date_piece ? `Recette du ${formatDate(piece.date_piece)}` : 'Recette'
  // `!= null` : une lecture qui n'a pas demandé la colonne (undefined) n'a pas lu de tiers non plus.
  if (piece.tiers != null && piece.tiers.trim() !== '') return piece.tiers
  return piece.date_piece ? `Pièce du ${formatDate(piece.date_piece)}` : LIBELLE_D_UNE_PIECE_SANS_DATE
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
