import { sirenDe } from './factureCii'
import type { FactureEmise, Piece, TransmissionFacture } from './types'

// LA VENTE QUI REVIENT : LE PONT ENTRE UNE FACTURE ÉMISE ET SA PIÈCE JUMELLE (ligne 28.6 de la feuille de route).
//
// Une facture émise par l'application ne compte elle-même NULLE PART : ni la 2035, ni la CA3, ni le brouillon, ni le
// FEC ne lisent `factures_emises` — les ventes n'entrent que par leurs justificatifs (décision du cabinet du
// 28/09/2026). Transmise par la plateforme agréée du client ou par Super PDP, elle REVIENT comme pièce de vente
// quand on importe les factures de la plateforme (`receptionPlateforme.ts`) ou qu'on synchronise Super PDP
// (`superpdp-sync`) : cette pièce-là est la vente, au dossier. Ce module dit QUELLE pièce est quelle facture émise —
// sa JUMELLE —, et quelle vente est portée par plusieurs pièces, donc comptée plusieurs fois.
//
// LE LIEN SE DÉDUIT, IL NE SE STOCKE PAS, comme le lettrage (lib/lettrage.ts) : de faits qui ne changent pas, chacun
// une IDENTITÉ, jamais un rapprochement d'un montant, d'une date ou d'un nom.
//   - LE FLUX : la pièce porte l'hôte et l'identifiant du flux qu'une transmission de la facture a déposé
//     (`pieces.flux_hote/flux_id` = `transmissions_factures.hote/flux_id`) — si la plateforme liste la facture déposée
//     sous l'identifiant que le dépôt a rendu, ce qu'aucune plateforme réelle n'a encore montré ;
//   - SUPER PDP : la pièce porte l'identifiant de Super PDP que l'envoi a écrit sur la facture, ou que sa transmission
//     `superpdp` a gardé quand l'écriture sur la facture a échoué (`superpdp-emit`) ;
//   - L'IDENTITÉ G1.42 : ce que l'original structuré de la pièce dit, lu à l'import et gardé sur la pièce
//     (`identite_*`) — son numéro, le SIREN de son vendeur et l'année de sa date d'émission — égal à ce que la facture
//     VALIDÉE a FIGÉ (son numéro, le SIREN de son émetteur figé à la validation, jamais celui du dossier d'aujourd'hui,
//     et l'année de sa date). C'est l'identité qu'une facture a pour l'administration (spécifications externes de la
//     DGFiP v3.2, annexe 7 v1.9, règle G1.42 ; dossier général, § 3.6.7, note 109), la même que d7 suit pour rattacher
//     un statut lu (lib/cdarRecu.ts). Elle reconnaît aussi une facture que le client a déposée lui-même sur sa
//     plateforme, et un flux que la plateforme aurait renommé.
// Un lien déduit ne vieillit pas : une transmission enregistrée après l'import, une facture validée après, le font
// apparaître sans rien réécrire, et une sauvegarde n'a rien d'autre à emporter que les faits.
//
// CE QUI NE SE RECONNAÎT PAS : une pièce DÉPOSÉE — un PDF de la même vente, un e-mail. Rien ne la relie à sa facture
// émise sans lire son texte ou rapprocher montant, date et client, ce que le pont s'interdit : une vente portée par sa
// jumelle ET par un PDF ne se voit pas ici (note de la ligne 28.6, question au cabinet).
//
// DEUX PREUVES QUI SE CONTREDISENT NE FONT PAS UNE JUMELLE : une pièce que ses preuves rattachent à deux factures, ou
// dont l'identité désigne une facture d'une autre nature (un avoir pour une facture), n'est la jumelle d'aucune — elle
// est dite à part (`incoherentes`), comme d7 écarte un statut « incohérent » plutôt que de choisir.

/** La facture émise, telle que le pont la lit (colonnes de `factures_emises`). */
export type FacturePourJumelle = Pick<FactureEmise,
  'id' | 'dossier_id' | 'statut' | 'type' | 'numero' | 'date_emission' | 'emetteur_siret' | 'superpdp_invoice_id'>

/** Une transmission de la facture : son flux, et son canal (le flux d'une transmission `superpdp` est l'identifiant de Super PDP). */
export type TransmissionPourJumelle = Pick<TransmissionFacture, 'facture_id' | 'canal' | 'hote' | 'flux_id'>

/** La pièce, telle que le pont la lit (colonnes de `pieces`). */
export type PiecePourJumelle = Pick<Piece,
  'id' | 'dossier_id' | 'flux_hote' | 'flux_id' | 'superpdp_invoice_id'
  | 'identite_numero' | 'identite_siren_vendeur' | 'identite_date' | 'identite_nature'>

/** Ce qui relie une pièce à sa facture : le flux de sa transmission, l'identifiant de Super PDP, l'identité G1.42. */
export type PreuveJumelle = 'flux' | 'superpdp' | 'identite'

export interface Jumelle {
  pieceId: string
  factureId: string
  /** Toutes les preuves qui tiennent, dans l'ordre flux, Super PDP, identité. */
  preuves: PreuveJumelle[]
}

export type IncoherenceJumelle =
  /** Ses preuves la rattachent à plusieurs factures émises. */
  | { pieceId: string; motif: 'plusieurs_factures'; factureIds: string[] }
  /** Son identité désigne une facture, mais l'original dit une autre nature (un avoir pour une facture, ou l'inverse). */
  | { pieceId: string; motif: 'nature'; factureId: string }

export interface JumellesDuDossier {
  /** Chaque pièce jumelle, et la facture émise qu'elle porte. */
  parPiece: Map<string, Jumelle>
  /** Chaque facture émise portée par au moins une pièce, et ses jumelles, dans l'ordre des pièces données. */
  parFacture: Map<string, Jumelle[]>
  /** Les pièces dont les preuves se contredisent : aucune n'est la jumelle de rien. */
  incoherentes: IncoherenceJumelle[]
}

const ORDRE_DES_PREUVES: readonly PreuveJumelle[] = ['flux', 'superpdp', 'identite']

const cleFlux = (hote: string, id: string) => `${hote} ${id}`

/**
 * Les jumelles du dossier : pour chaque pièce, la facture émise VALIDÉE de son dossier qu'elle porte, et par quelles
 * preuves. Les listes sont celles du dossier — ou d'une partie : une facture absente des factures données ne se
 * rattache à rien, et une pièce que ses preuves rattacheraient aussi à une facture non donnée passe pour cohérente.
 * Une transmission ne compte que pour une facture donnée.
 */
export function jumellesDuDossier(
  factures: readonly FacturePourJumelle[],
  transmissions: readonly TransmissionPourJumelle[],
  pieces: readonly PiecePourJumelle[],
): JumellesDuDossier {
  // Seule une facture VALIDÉE a été transmise, porte un numéro, a figé son émetteur : un brouillon n'a pas de jumelle.
  const validees = factures.filter((f) => f.statut === 'validee')
  const parId = new Map(validees.map((f) => [f.id, f]))

  const parFlux = new Map<string, Set<string>>()
  const parSuperpdp = new Map<string, Set<string>>()
  const ajouter = (index: Map<string, Set<string>>, cle: string, factureId: string) => {
    const ensemble = index.get(cle)
    if (ensemble) ensemble.add(factureId)
    else index.set(cle, new Set([factureId]))
  }
  for (const f of validees) {
    if (f.superpdp_invoice_id != null) ajouter(parSuperpdp, String(f.superpdp_invoice_id), f.id)
  }
  for (const t of transmissions) {
    if (t.flux_id == null || !parId.has(t.facture_id)) continue
    ajouter(parFlux, cleFlux(t.hote, t.flux_id), t.facture_id)
    // Le flux d'une transmission `superpdp` EST l'identifiant de Super PDP (superpdp-emit l'écrit `String(id)`) : il le
    // garde même quand l'écriture sur la facture a échoué.
    if (t.canal === 'superpdp') ajouter(parSuperpdp, t.flux_id, t.facture_id)
  }
  // Le numéro est unique dans un dossier (`factures_emises_numero_dossier_idx`) : une liste par numéro, au cas où on
  // donnerait les factures de plusieurs dossiers.
  const parNumero = new Map<string, FacturePourJumelle[]>()
  for (const f of validees) {
    if (f.numero == null) continue
    parNumero.set(f.numero, [...(parNumero.get(f.numero) ?? []), f])
  }

  const resultat: JumellesDuDossier = { parPiece: new Map(), parFacture: new Map(), incoherentes: [] }
  for (const p of pieces) {
    const preuves = new Map<string, Set<PreuveJumelle>>()
    const noter = (factureId: string, preuve: PreuveJumelle) => {
      // Une facture d'un autre dossier n'est jamais la jumelle d'une pièce de celui-ci.
      if (parId.get(factureId)?.dossier_id !== p.dossier_id) return
      const ensemble = preuves.get(factureId)
      if (ensemble) ensemble.add(preuve)
      else preuves.set(factureId, new Set([preuve]))
    }
    if (p.flux_hote != null && p.flux_id != null) {
      for (const id of parFlux.get(cleFlux(p.flux_hote, p.flux_id)) ?? []) noter(id, 'flux')
    }
    if (p.superpdp_invoice_id != null) {
      for (const id of parSuperpdp.get(String(p.superpdp_invoice_id)) ?? []) noter(id, 'superpdp')
    }
    let natureContraire: string | null = null
    if (p.identite_numero != null && p.identite_siren_vendeur != null && p.identite_date != null) {
      for (const f of parNumero.get(p.identite_numero) ?? []) {
        // Le SIREN que la facture a FIGÉ à sa validation, et l'année de sa date : l'identité G1.42 entière, ou rien.
        if (sirenDe(f.emetteur_siret) !== p.identite_siren_vendeur) continue
        if (f.date_emission.slice(0, 4) !== p.identite_date.slice(0, 4)) continue
        if (f.dossier_id !== p.dossier_id) continue
        if (p.identite_nature != null && p.identite_nature !== f.type) natureContraire = f.id
        else noter(f.id, 'identite')
      }
    }
    if (natureContraire !== null) {
      resultat.incoherentes.push({ pieceId: p.id, motif: 'nature', factureId: natureContraire })
      continue
    }
    if (preuves.size > 1) {
      resultat.incoherentes.push({ pieceId: p.id, motif: 'plusieurs_factures', factureIds: [...preuves.keys()].sort() })
      continue
    }
    if (preuves.size === 0) continue
    const [[factureId, ensemble]] = preuves
    const jumelle: Jumelle = { pieceId: p.id, factureId, preuves: ORDRE_DES_PREUVES.filter((x) => ensemble.has(x)) }
    resultat.parPiece.set(p.id, jumelle)
    resultat.parFacture.set(factureId, [...(resultat.parFacture.get(factureId) ?? []), jumelle])
  }
  return resultat
}

/** Les jumelles d'UNE facture — celles que les propositions d'encaissement lisent (lib/encaissementsFactures.ts). */
export function jumellesDeLaFacture(
  facture: FacturePourJumelle,
  transmissions: readonly TransmissionPourJumelle[],
  pieces: readonly PiecePourJumelle[],
): Jumelle[] {
  return jumellesDuDossier([facture], transmissions, pieces).parFacture.get(facture.id) ?? []
}

export interface VenteEnDouble {
  factureId: string
  /** Les pièces qui la portent toutes, dans l'ordre des pièces données. */
  pieceIds: string[]
}

/**
 * LES VENTES COMPTÉES PLUSIEURS FOIS : une facture émise que plusieurs pièces portent — sa jumelle reçue de la
 * plateforme ET celle de la synchronisation Super PDP, le plus souvent. Validées, chacune compte la vente dans la 2035,
 * la CA3 et le brouillon. Dit sur les deux piles, validées comme à valider : un doublon est un fait, et c'est avant la
 * validation qu'il se corrige le mieux. Dans l'ordre des factures données.
 */
export function ventesEnDouble(factures: readonly FacturePourJumelle[], jumelles: JumellesDuDossier): VenteEnDouble[] {
  return factures.flatMap((f) => {
    const pieces = jumelles.parFacture.get(f.id) ?? []
    return pieces.length > 1 ? [{ factureId: f.id, pieceIds: pieces.map((j) => j.pieceId) }] : []
  })
}

// ── Ce que la Checklist en dit ─────────────────────────────────────────────────────────────────────────────────────
// L'onglet Justificatifs ne marque pas encore une jumelle : le détail NOMME donc chaque pièce, que sa recherche
// retrouve — un point qui annonce un nombre sans que sa cible puisse le montrer cesse d'être cru.

const AU_PLUS = 3

const nomDeLaFacture = (factures: readonly Pick<FactureEmise, 'id' | 'numero'>[], id: string) =>
  factures.find((f) => f.id === id)?.numero ?? 'une facture sans numéro'

const nomsDesPieces = (pieces: readonly Pick<Piece, 'id' | 'nom_fichier'>[], ids: readonly string[]) =>
  ids.map((id) => `« ${pieces.find((p) => p.id === id)?.nom_fichier ?? id} »`).join(', ')

const etLeReste = (n: number) => (n > AU_PLUS ? ` Et ${n - AU_PLUS} autre${n - AU_PLUS > 1 ? 's' : ''}.` : '')

/** Les ventes comptées plusieurs fois : chaque facture et les pièces qui la portent ; rien quand il n'y en a pas. */
export function detailVentesEnDouble(
  enDouble: readonly VenteEnDouble[],
  factures: readonly Pick<FactureEmise, 'id' | 'numero'>[],
  pieces: readonly Pick<Piece, 'id' | 'nom_fichier'>[],
): string | undefined {
  if (enDouble.length === 0) return undefined
  const liste = enDouble.slice(0, AU_PLUS)
    .map((v) => `${nomDeLaFacture(factures, v.factureId)} : ${nomsDesPieces(pieces, v.pieceIds)}.`).join(' ')
  return `${liste}${etLeReste(enDouble.length)} Une vente ne se compte qu’une fois : gardez une seule pièce par facture — `
    + 'celle reçue de la plateforme du client porte l’original.'
}

/** Les pièces dont les preuves se contredisent : ce que chacune désigne ; rien quand il n'y en a pas. */
export function detailJumellesIncoherentes(
  incoherentes: readonly IncoherenceJumelle[],
  factures: readonly Pick<FactureEmise, 'id' | 'numero' | 'type'>[],
  pieces: readonly Pick<Piece, 'id' | 'nom_fichier'>[],
): string | undefined {
  if (incoherentes.length === 0) return undefined
  const liste = incoherentes.slice(0, AU_PLUS).map((i) => {
    const piece = nomsDesPieces(pieces, [i.pieceId])
    if (i.motif === 'plusieurs_factures') {
      return `${piece} désigne ${i.factureIds.map((id) => nomDeLaFacture(factures, id)).join(' et ')}.`
    }
    const f = factures.find((x) => x.id === i.factureId)
    const nature = f?.type === 'avoir' ? 'un avoir' : 'une facture'
    return `${piece} porte le numéro de ${nomDeLaFacture(factures, i.factureId)}, qui est ${nature}, sous une autre nature.`
  }).join(' ')
  return `${liste}${etLeReste(incoherentes.length)} Aucune n’est tenue pour la pièce de sa facture : vérifiez-les sur la `
    + 'plateforme avant de les valider.'
}
