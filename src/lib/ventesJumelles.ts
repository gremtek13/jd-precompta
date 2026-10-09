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
// Le détail NOMME chaque pièce, et l'onglet Justificatifs la marque (`marquesDesPieces`) : sa recherche la retrouve
// par son nom comme par le numéro de la facture — un point qui annonce un nombre sans que sa cible puisse le montrer
// cesse d'être cru.

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

// ── Ce que l'onglet Justificatifs en montre (phase C de la ligne 28.6) ─────────────────────────────────────────────────
// La pièce elle-même porte sa marque, sur sa ligne et dans sa fiche : c'est là qu'on la valide, et une vente comptée deux
// fois se corrige en n'en gardant qu'une. Tout se déduit de `jumellesDuDossier` : une marque ne dit rien que le pont ne
// sache — et l'écran ne l'appelle que sur des listes LUES EN ENTIER, une facture non lue faisant passer une pièce
// contradictoire pour une jumelle.

/** Ce qu'une pièce est pour le pont : la jumelle d'une facture, l'une des pièces d'une vente comptée plusieurs fois, ou
 * une pièce dont les preuves se contredisent. */
export type GenreMarque = 'jumelle' | 'double' | 'incoherente'

export interface MarqueDeLaPiece {
  genre: GenreMarque
  /** Le texte de la pastille : « Facture émise F2026-0007 », « Comptée deux fois », « À vérifier : … ». */
  libelle: string
  /** Ce qu'elle veut dire, preuves comprises : l'infobulle de la ligne, le texte de la fiche. */
  explication: string
  /** Les numéros des factures émises qu'elle désigne : la recherche de l'onglet les trouve. */
  numeros: string[]
  /** Les autres pièces qui portent la même facture, dans l'ordre des pièces données ; vide hors d'une vente en double. */
  autresPieces: string[]
}

/** La pastille de chaque genre : le neutre pour une jumelle (rien n'est faux), le danger pour une vente comptée deux fois
 * (une erreur de la Checklist), l'attention pour une pièce à vérifier (une attention de la Checklist). */
export const PASTILLE_DE_LA_MARQUE: Record<GenreMarque, string> = {
  jumelle: 'badge-neutral',
  double: 'badge-danger',
  incoherente: 'badge-warning',
}

const PREUVE_DITE: Record<PreuveJumelle, string> = {
  flux: 'par le flux de sa transmission',
  superpdp: 'par l’identifiant de Super PDP',
  identite: 'par son numéro, son vendeur et son année',
}

const enumerer = (mots: readonly string[]) =>
  (mots.length <= 1 ? mots.join('') : `${mots.slice(0, -1).join(', ')} et ${mots[mots.length - 1]}`)

const fois = (n: number) => (n === 2 ? 'deux' : n === 3 ? 'trois' : String(n))

const A_VERIFIER = 'elle n’est tenue pour la pièce d’aucune facture émise. Vérifiez-la sur la plateforme avant de la valider.'

/**
 * La marque de chaque pièce que le pont reconnaît, ou dont les preuves se contredisent ; une pièce sans marque n'est pas
 * dans la table. `factures` : celles qu'on a données au pont, pour leurs numéros et leur nature.
 */
export function marquesDesPieces(
  factures: readonly Pick<FactureEmise, 'id' | 'numero' | 'type'>[],
  jumelles: JumellesDuDossier,
): Map<string, MarqueDeLaPiece> {
  const facture = (id: string) => factures.find((f) => f.id === id)
  // Une facture validée porte toujours son numéro (la base le donne à la validation) : l'absence ne se verrait que sur
  // des données lues de travers, et se dit sans rien inventer.
  const nom = (id: string) => facture(id)?.numero ?? '(sans numéro)'
  const numeros = (ids: readonly string[]) =>
    ids.flatMap((id) => { const n = facture(id)?.numero; return n == null ? [] : [n] })

  const marques = new Map<string, MarqueDeLaPiece>()
  for (const [pieceId, j] of jumelles.parPiece) {
    const reconnue = `reconnue ${enumerer(j.preuves.map((p) => PREUVE_DITE[p]))}`
    const portees = jumelles.parFacture.get(j.factureId) ?? []
    if (portees.length > 1) {
      marques.set(pieceId, {
        genre: 'double',
        libelle: `Comptée ${fois(portees.length)} fois`,
        explication: `La facture ${nom(j.factureId)} émise dans l’application est portée par ${portees.length} pièces, dont `
          + `celle-ci, ${reconnue}. Validées, elles la comptent ${fois(portees.length)} fois dans la 2035, la CA3 et les `
          + 'écritures : gardez une seule pièce par facture — celle reçue de la plateforme du client porte l’original.',
        numeros: numeros([j.factureId]),
        autresPieces: portees.filter((x) => x.pieceId !== pieceId).map((x) => x.pieceId),
      })
    } else {
      marques.set(pieceId, {
        genre: 'jumelle',
        libelle: `Facture émise ${nom(j.factureId)}`,
        explication: `Cette pièce est la facture ${nom(j.factureId)} émise dans l’application, revenue comme pièce — `
          + `${reconnue}. C’est la même vente : elle ne se compte qu’une fois.`,
        numeros: numeros([j.factureId]),
        autresPieces: [],
      })
    }
  }
  for (const i of jumelles.incoherentes) {
    if (i.motif === 'plusieurs_factures') {
      marques.set(i.pieceId, {
        genre: 'incoherente',
        libelle: `À vérifier : désigne ${enumerer(i.factureIds.map(nom))}`,
        explication: `Ses preuves la rattachent à ${enumerer(i.factureIds.map(nom))} à la fois : ${A_VERIFIER}`,
        numeros: numeros(i.factureIds),
        autresPieces: [],
      })
      continue
    }
    // L'original dit l'autre nature que celle de la facture que son numéro désigne.
    const avoir = facture(i.factureId)?.type === 'avoir'
    marques.set(i.pieceId, {
      genre: 'incoherente',
      libelle: `À vérifier : porte le numéro ${avoir ? 'de l’avoir' : 'de la facture'} ${nom(i.factureId)}`,
      explication: `Son original dit ${avoir ? 'une facture' : 'un avoir'}, et ${nom(i.factureId)} est `
        + `${avoir ? 'un avoir émis' : 'une facture émise'} dans l’application : ${A_VERIFIER}`,
      numeros: numeros([i.factureId]),
      autresPieces: [],
    })
  }
  return marques
}

// ── Ce que le bilan d'un import en dit ────────────────────────────────────────────────────────────────────────────────

export interface JumellesImportees {
  /** Les pièces importées que le pont reconnaît comme la jumelle d'une facture émise. */
  reconnues: number
  /** Parmi elles, celles dont la facture est portée par une autre pièce aussi : la vente compte deux fois. */
  dejaPortees: number
  /** Les pièces importées dont les preuves se contredisent. */
  incoherentes: number
}

/** Ce que le pont dit des pièces qu'un import vient de créer, jugé sur TOUTES les pièces du dossier. */
export function jumellesImportees(pieceIds: readonly string[], jumelles: JumellesDuDossier): JumellesImportees {
  const importees = new Set(pieceIds)
  let reconnues = 0
  let dejaPortees = 0
  for (const id of importees) {
    const j = jumelles.parPiece.get(id)
    if (!j) continue
    reconnues++
    if ((jumelles.parFacture.get(j.factureId) ?? []).length > 1) dejaPortees++
  }
  const incoherentes = jumelles.incoherentes.filter((i) => importees.has(i.pieceId)).length
  return { reconnues, dejaPortees, incoherentes }
}

/** Les phrases du bilan : rien quand aucune pièce importée n'a affaire à une facture émise. */
export function phrasesJumellesImportees(j: JumellesImportees): string[] {
  const phrases: string[] = []
  if (j.reconnues > 0) {
    const reconnues = j.reconnues === 1
      ? '1 vente reconnue comme une facture émise de l’application'
      : `${j.reconnues} ventes reconnues comme des factures émises de l’application`
    phrases.push(j.dejaPortees === 0
      ? `${reconnues} : Justificatifs ${j.reconnues > 1 ? 'les' : 'la'} marque.`
      : `${reconnues}, dont ${j.dejaPortees} déjà portée${j.dejaPortees > 1 ? 's' : ''} par une autre pièce : ne validez `
        + 'qu’une pièce par facture ; la Checklist le signale.')
  }
  if (j.incoherentes > 0) {
    phrases.push(j.incoherentes === 1
      ? '1 pièce dont les preuves contredisent une facture émise : à vérifier sur la plateforme avant de la valider.'
      : `${j.incoherentes} pièces dont les preuves contredisent une facture émise : à vérifier sur la plateforme avant de `
        + 'les valider.')
  }
  return phrases
}
