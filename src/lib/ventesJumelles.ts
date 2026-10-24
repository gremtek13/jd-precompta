import { sirenDe } from './factureCii'
import { formatMoney } from './format'
import type { FacturesSources } from './facturesSources'
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
// LA DÉSIGNATION, la quatrième preuve et la plus forte (chantier EC-Q3, étape VF1a ; décision du cabinet du 17/10/2026,
// 28.6-Q1 ; migration `exemplaires_des_factures`, lib/exemplairesDesFactures.ts) : le cabinet DÉSIGNE la pièce EXEMPLAIRE
// d'une facture émise (`pieces.facture_id`) — l'original revenu de la plateforme, ou le PDF qu'il a déposé, qu'aucun des
// trois autres faits ne relie à sa facture : rien ne la relie sans lire son texte ou rapprocher montant, date et client, ce
// que le pont s'interdit. La plus forte : c'est un geste du cabinet, que la base tient — une facture validée du même
// dossier, sur une pièce de vente, figée avec la pièce —, et elle se dit la première. Elle ne fait pas taire les autres :
// une pièce désignée à une facture que son flux, Super PDP ou son identité rattache à une autre reste incohérente, et
// l'écran la dit « à vérifier » ; la base ne juge pas cette cohérence (l'étape VF6 le fera pour une facture source). Ce
// que la désignation change : le pont voit le PDF, et une vente portée par sa jumelle ET par le PDF désigné se dit
// comptée deux fois — le trou que 28.6-Q1 ferme. Ce qu'elle ne change pas : ce qui se compte. Une pièce dont la colonne
// n'a pas été lue (`facture_id` absent) n'est désignée à rien : le pont ne la nomme que là où la lecture la porte.
//
// DEUX PREUVES QUI SE CONTREDISENT NE FONT PAS UNE JUMELLE : une pièce que ses preuves rattachent à deux factures, ou
// dont l'identité désigne une facture d'une autre nature (un avoir pour une facture), n'est la jumelle d'aucune — elle
// est dite à part (`incoherentes`), comme d7 écarte un statut « incohérent » plutôt que de choisir.

/** La facture émise, telle que le pont la lit (colonnes de `factures_emises`). */
export type FacturePourJumelle = Pick<FactureEmise,
  'id' | 'dossier_id' | 'statut' | 'type' | 'numero' | 'date_emission' | 'emetteur_siret' | 'superpdp_invoice_id'>

/** Une transmission de la facture : son flux, et son canal (le flux d'une transmission `superpdp` est l'identifiant de Super PDP). */
export type TransmissionPourJumelle = Pick<TransmissionFacture, 'facture_id' | 'canal' | 'hote' | 'flux_id'>

/** La pièce, telle que le pont la lit (colonnes de `pieces`). `facture_id`, la désignation, est facultatif : une lecture
 * qui ne nomme pas la colonne (drapeau `EXEMPLAIRES_DES_FACTURES_EXPORTES` baissé) ne la porte pas. */
export type PiecePourJumelle = Pick<Piece,
  'id' | 'dossier_id' | 'flux_hote' | 'flux_id' | 'superpdp_invoice_id'
  | 'identite_numero' | 'identite_siren_vendeur' | 'identite_date' | 'identite_nature'> & Partial<Pick<Piece, 'facture_id'>>

/**
 * Les colonnes de `pieces` que le pont lit, celles de `PiecePourJumelle` — sans la désignation, puis avec elle : une lecture
 * ne nomme `facture_id` que sa migration en base (`EXEMPLAIRES_DES_FACTURES_EXPORTES`, lib/exemplairesDesFactures.ts) ;
 * nommée avant, elle ferait échouer la lecture. Deux textes et non un texte composé à la volée : le client typé de
 * Supabase lit la liste des colonnes dans le TYPE du texte, et un texte quelconque lui ferait rendre des lignes d'erreur.
 */
export const COLONNES_DES_PIECES_DU_PONT =
  'id, dossier_id, flux_hote, flux_id, superpdp_invoice_id, identite_numero, identite_siren_vendeur, identite_date, identite_nature'
export const COLONNES_DES_PIECES_DU_PONT_ET_DESIGNATION = `${COLONNES_DES_PIECES_DU_PONT}, facture_id` as const

/** Ce qui relie une pièce à sa facture : la désignation par le cabinet, le flux de sa transmission, l'identifiant de
 * Super PDP, l'identité G1.42. */
export type PreuveJumelle = 'designation' | 'flux' | 'superpdp' | 'identite'

export interface Jumelle {
  pieceId: string
  factureId: string
  /** Toutes les preuves qui tiennent, dans l'ordre désignation, flux, Super PDP, identité. */
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

const ORDRE_DES_PREUVES: readonly PreuveJumelle[] = ['designation', 'flux', 'superpdp', 'identite']

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
    // La désignation : la base la tient pour une facture validée du même dossier ; le pont n'en juge que ce qu'il lit — une
    // facture absente des factures données ne se rattache à rien, comme pour les trois autres preuves.
    if (p.facture_id != null) noter(p.facture_id, 'designation')
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

// ── LE PONT PAR RÉGIME (chantier EC-Q3, étape VF6e ; conception : HISTORIQUE.md, « VF6, LA JUMELLE INVERSÉE : LA
// CONCEPTION », § 3 h) ─────────────────────────────────────────────────────────────────────────────────────────────────
// Dans un dossier dont les factures sont la SOURCE de leurs ventes (étape VF2, `dossiers.ventes_par_les_factures`), une
// facture source compte sa vente ELLE-MÊME — par ses encaissements en trésorerie, par elle-même en engagement — et son
// exemplaire désigné ne compte plus (étapes VF3b et VF6a, lib/facturesSources.ts). Ce que le pont en dit change donc avec
// le RÉGIME de la facture : une facture qui n'est pas source (tout dossier qui n'a pas basculé, et les factures d'avant la
// bascule) se compte par ses pièces, comme hier ; une facture source, par elle-même. Et dans un dossier basculé, la base
// refuse de valider une pièce de vente que rien ne marque (G3, migration `jumelle_inversee`) : la pièce que le pont
// rattache à une facture s'y DÉSIGNE exemplaire de cette facture, ce que le pont dit avant la validation.

/** Ce que le pont sait du dossier pour juger par régime. Rien n'a de valeur par défaut : un appelant qui oublierait la
 *  bascule ou les sources dirait d'hier ce que la base juge aujourd'hui. */
export interface RegimeDuPont {
  /** `dossiers.ventes_par_les_factures` : les factures du dossier sont la source de leurs ventes (étape VF2). */
  dossierBascule: boolean
  /** Les factures sources de leur vente, sur des factures émises lues EN ENTIER (`facturesSourcesDe`). Vides hors d'un
   *  dossier basculé : la base y refuse toute facture source (`fixer_source_de_la_vente`). */
  sources: FacturesSources
}

/** La pièce, telle que le pont la juge par régime : son statut (une pièce VALIDÉE compte), sa déclaration. */
export type PieceDuRegime = Pick<Piece, 'id' | 'statut' | 'vente_hors_des_factures'>

export interface VenteEnDouble {
  factureId: string
  /** Les pièces qui la comptent, dans l'ordre des pièces données : toutes ses pièces pour une facture qui n'est pas
   *  source ; pour une facture source, ses pièces VALIDÉES qui ne sont pas son exemplaire. */
  pieceIds: string[]
  /** Présent, et vrai, pour une facture SOURCE seulement : elle compte la vente elle-même, et ses pièces la comptent en plus. */
  parLaFacture?: true
}

const designee = (j: Jumelle) => j.preuves.includes('designation')

/**
 * LES VENTES COMPTÉES PLUSIEURS FOIS, par régime (étape VF6e).
 * - Une facture qui N'EST PAS source (un dossier qui n'a pas basculé, une facture d'avant la bascule) : portée par
 *   plusieurs pièces — sa jumelle reçue de la plateforme ET celle de la synchronisation Super PDP, ou sa jumelle ET le PDF
 *   que le cabinet a désigné exemplaire de la facture (étape VF1a). Validées, chacune compte la vente dans la 2035, la CA3
 *   et le brouillon. Dit sur les deux piles, validées comme à valider : un doublon est un fait, et c'est avant la
 *   validation qu'il se corrige le mieux. Inchangé.
 * - Une facture SOURCE compte sa vente elle-même : une pièce VALIDÉE que le pont lui rattache et qui n'est pas son
 *   exemplaire désigné la compte une seconde fois. Ses exemplaires ne comptent pas — deux exemplaires désignés, la jumelle
 *   et le PDF, ne sont pas un double —, et une pièce à valider ne compte pas encore (elle se dit « à désigner »). G3 empêche
 *   une telle pièce de DEVENIR validée dans un dossier basculé (point 3 de la garde) : le point reste en témoin — une pièce
 *   validée avant la bascule (EC3-Q1), ou avant que sa transmission soit connue (G3 ne juge qu'au passage).
 * Dans l'ordre des factures données.
 */
export function ventesEnDouble(
  factures: readonly Pick<FacturePourJumelle, 'id'>[],
  jumelles: JumellesDuDossier,
  sources: FacturesSources,
  pieces: readonly Pick<Piece, 'id' | 'statut'>[],
): VenteEnDouble[] {
  const statutDe = new Map(pieces.map((p) => [p.id, p.statut]))
  return factures.flatMap((f): VenteEnDouble[] => {
    const portees = jumelles.parFacture.get(f.id) ?? []
    if (!sources.has(f.id)) {
      return portees.length > 1 ? [{ factureId: f.id, pieceIds: portees.map((j) => j.pieceId) }] : []
    }
    const enPlus = portees.filter((j) => !designee(j) && statutDe.get(j.pieceId) === 'validee')
    return enPlus.length > 0 ? [{ factureId: f.id, pieceIds: enPlus.map((j) => j.pieceId), parLaFacture: true }] : []
  })
}

export interface PieceADesigner {
  pieceId: string
  factureId: string
}

/**
 * LES PIÈCES À DÉSIGNER (étape VF6e) : dans un dossier BASCULÉ, chaque pièce que le pont rattache à une facture émise
 * validée — source, ou d'avant la bascule — sans que le cabinet l'ait désignée exemplaire de cette facture. La base ne la
 * validera que désignée à elle (G3, point 3) ; validée avant, elle compte comme hier, et la désignation la relie à sa
 * facture (le virement mixte de l'étape VF5h exige son exemplaire unique). Une pièce comptée deux fois n'en est pas : elle
 * se dit « Comptée deux fois », plus grave, et sa marque dit aussi de la désigner. Rien hors d'un dossier basculé : la
 * désignation y reste un geste libre. Dans l'ordre des pièces données au pont.
 */
export function piecesADesigner(
  jumelles: JumellesDuDossier,
  regime: RegimeDuPont,
  enDouble: readonly VenteEnDouble[],
): PieceADesigner[] {
  if (!regime.dossierBascule) return []
  const doubles = new Set(enDouble.flatMap((v) => v.pieceIds))
  const resultat: PieceADesigner[] = []
  for (const [pieceId, j] of jumelles.parPiece) {
    if (designee(j) || doubles.has(pieceId)) continue
    resultat.push({ pieceId, factureId: j.factureId })
  }
  return resultat
}

export interface VenteHorsFacturesAVerifier {
  pieceId: string
  /** Les factures sources sans exemplaire validé dont le TTC est celui de la pièce, la même année. */
  factureIds: string[]
}

/** La facture, telle que le symptôme la lit : son montant et sa date. */
export type FacturePourLeSymptome = Pick<FactureEmise, 'id' | 'statut' | 'numero' | 'date_emission' | 'montant_ttc'>
/** La pièce, telle que le symptôme la lit. */
export type PiecePourLeSymptome = Pick<Piece,
  'id' | 'statut' | 'facture_id' | 'vente_hors_des_factures' | 'montant_ttc' | 'date_piece'>

const centimes = (n: number) => Math.round(n * 100)

/**
 * LE SYMPTÔME D'UNE PIÈCE DÉCLARÉE À TORT (VF6-Q4, tranchée le 23/10/2026 à la recommandation) : une pièce DÉCLARÉE vente
 * hors des factures de l'application dont le TTC est, au centime, celui d'une facture SOURCE de la même année qu'aucun
 * exemplaire validé ne porte. Si c'était le PDF de cette facture, la vente compterait deux fois — par la facture et par la
 * pièce. Un SYMPTÔME, qui ne décide rien : deux prestations du même prix sont possibles, et la déclaration est un geste du
 * cabinet. Le pont, lui, ne rapproche jamais un montant (le lien se déduit, il ne se devine pas) : ce point vit à côté de
 * lui. Sur les deux piles : une pièce déclarée à valider se vérifie mieux avant sa validation. L'année est celle de la date
 * de la pièce et de la date d'émission de la facture ; une pièce sans date ni montant ne se compare pas. Le montant est
 * signé (un avoir l'est) : au centime, le signe compris. Dans l'ordre des pièces données ; les factures de chaque pièce dans
 * l'ordre des factures données.
 */
export function ventesHorsFacturesAVerifier(
  pieces: readonly PiecePourLeSymptome[],
  factures: readonly FacturePourLeSymptome[],
  sources: FacturesSources,
): VenteHorsFacturesAVerifier[] {
  const exemplairesValides = new Set(
    pieces.flatMap((p) => (p.statut === 'validee' && p.facture_id != null ? [p.facture_id] : [])),
  )
  // Une recherche par (année, centimes) : aucun parcours des factures pour chaque pièce.
  const parCle = new Map<string, string[]>()
  for (const f of factures) {
    if (f.statut !== 'validee' || !sources.has(f.id) || exemplairesValides.has(f.id)) continue
    const cle = `${f.date_emission.slice(0, 4)} ${centimes(f.montant_ttc)}`
    parCle.set(cle, [...(parCle.get(cle) ?? []), f.id])
  }
  if (parCle.size === 0) return []
  return pieces.flatMap((p) => {
    if (!p.vente_hors_des_factures || p.montant_ttc == null || p.date_piece == null) return []
    const ids = parCle.get(`${p.date_piece.slice(0, 4)} ${centimes(p.montant_ttc)}`)
    return ids ? [{ pieceId: p.id, factureIds: ids }] : []
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

/** Les ventes comptées plusieurs fois : chaque facture et les pièces qui la portent ; rien quand il n'y en a pas. Une
 *  facture source se nomme avec les pièces qui la comptent en plus d'elle, et le remède se dit selon le régime : garder une
 *  seule pièce d'une facture qui n'est pas source ; désigner exemplaire de sa facture source la pièce qui la compte aussi. */
export function detailVentesEnDouble(
  enDouble: readonly VenteEnDouble[],
  factures: readonly Pick<FactureEmise, 'id' | 'numero'>[],
  pieces: readonly Pick<Piece, 'id' | 'nom_fichier'>[],
): string | undefined {
  if (enDouble.length === 0) return undefined
  const liste = enDouble.slice(0, AU_PLUS)
    .map((v) => (v.parLaFacture
      ? `${nomDeLaFacture(factures, v.factureId)}, source de sa vente, et ${nomsDesPieces(pieces, v.pieceIds)}.`
      : `${nomDeLaFacture(factures, v.factureId)} : ${nomsDesPieces(pieces, v.pieceIds)}.`)).join(' ')
  const remedes = [
    ...(enDouble.some((v) => !v.parLaFacture)
      ? [' Une vente ne se compte qu’une fois : gardez une seule pièce par facture — celle reçue de la plateforme du client '
        + 'porte l’original.'] : []),
    ...(enDouble.some((v) => v.parLaFacture)
      ? [' Une facture source compte sa vente elle-même : désignez la pièce validée exemplaire de sa facture, et elle ne '
        + 'comptera plus.'] : []),
  ]
  return `${liste}${etLeReste(enDouble.length)}${remedes.join('')}`
}

/** Les pièces à désigner : chacune et la facture que le pont prouve ; rien quand il n'y en a pas. */
export function detailPiecesADesigner(
  aDesigner: readonly PieceADesigner[],
  factures: readonly Pick<FactureEmise, 'id' | 'numero'>[],
  pieces: readonly Pick<Piece, 'id' | 'nom_fichier'>[],
): string | undefined {
  if (aDesigner.length === 0) return undefined
  const liste = aDesigner.slice(0, AU_PLUS)
    .map((x) => `${nomsDesPieces(pieces, [x.pieceId])} : ${nomDeLaFacture(factures, x.factureId)}.`).join(' ')
  return `${liste}${etLeReste(aDesigner.length)} Dans ce dossier, une pièce de vente ne se valide que désignée exemplaire `
    + 'de la facture que le pont prouve : sa fiche, dans Justificatifs, la désigne.'
}

/** Les pièces déclarées dont le montant est celui d'une facture source sans exemplaire : chacune, son montant et la
 *  facture ; rien quand il n'y en a pas. */
export function detailVentesHorsFacturesAVerifier(
  aVerifier: readonly VenteHorsFacturesAVerifier[],
  factures: readonly Pick<FactureEmise, 'id' | 'numero'>[],
  pieces: readonly Pick<Piece, 'id' | 'nom_fichier' | 'montant_ttc'>[],
): string | undefined {
  if (aVerifier.length === 0) return undefined
  const liste = aVerifier.slice(0, AU_PLUS).map((x) => {
    const montant = pieces.find((p) => p.id === x.pieceId)?.montant_ttc
    return `${nomsDesPieces(pieces, [x.pieceId])}${montant == null ? '' : `, ${formatMoney(montant)}`} : `
      + `${x.factureIds.map((id) => nomDeLaFacture(factures, id)).join(' ou ')}.`
  }).join(' ')
  return `${liste}${etLeReste(aVerifier.length)} Une facture source compte sa vente elle-même : si l’une de ces pièces est `
    + 'le PDF de la facture, la vente compte deux fois — désignez-la exemplaire de sa facture, la désignation remplace la '
    + 'déclaration. Deux prestations du même prix ne sont pas une erreur.'
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

/** Ce qu'une pièce est pour le pont : la jumelle d'une facture, l'une des pièces d'une vente comptée plusieurs fois, une
 * pièce dont les preuves se contredisent ; et, par régime (étape VF6e), l'exemplaire désigné d'une facture source, une
 * pièce à désigner exemplaire de sa facture dans un dossier basculé, une vente déclarée hors des factures de
 * l'application. */
export type GenreMarque = 'jumelle' | 'double' | 'incoherente' | 'exemplaire' | 'a_designer' | 'hors_factures'

export interface MarqueDeLaPiece {
  genre: GenreMarque
  /** Le texte de la pastille : « Facture émise F2026-0007 », « Comptée deux fois », « À vérifier : … », « Exemplaire de la
   *  facture F2026-0021 », « À désigner : c’est la facture F2026-0021 », « Vente hors des factures de l’application ». */
  libelle: string
  /** Ce qu'elle veut dire, preuves comprises : l'infobulle de la ligne, le texte de la fiche. */
  explication: string
  /** Les numéros des factures émises qu'elle désigne : la recherche de l'onglet les trouve. */
  numeros: string[]
  /** Les autres pièces qui portent la même facture, dans l'ordre des pièces données ; vide hors d'une vente en double. */
  autresPieces: string[]
}

/** La pastille de chaque genre : le neutre pour une jumelle, un exemplaire désigné ou une vente déclarée (rien n'est faux),
 * le danger pour une vente comptée deux fois (une erreur de la Checklist), l'attention pour une pièce à vérifier ou à
 * désigner (une attention de la Checklist). */
export const PASTILLE_DE_LA_MARQUE: Record<GenreMarque, string> = {
  jumelle: 'badge-neutral',
  double: 'badge-danger',
  incoherente: 'badge-warning',
  exemplaire: 'badge-neutral',
  a_designer: 'badge-warning',
  hors_factures: 'badge-neutral',
}

// Les trois faits que le pont DÉDUIT ; la désignation, un geste du cabinet, se dit à part et la première.
const PREUVE_DITE: Record<Exclude<PreuveJumelle, 'designation'>, string> = {
  flux: 'par le flux de sa transmission',
  superpdp: 'par l’identifiant de Super PDP',
  identite: 'par son numéro, son vendeur et son année',
}

const enumerer = (mots: readonly string[]) =>
  (mots.length <= 1 ? mots.join('') : `${mots.slice(0, -1).join(', ')} et ${mots[mots.length - 1]}`)

const DESIGNEE = 'désignée comme son exemplaire'

/** Ce qui relie la pièce à sa facture, dit : « désignée comme son exemplaire », puis « reconnue par … » — les deux, l'un
 * ou l'autre. */
function preuvesDites(preuves: readonly PreuveJumelle[]): string {
  const deduites = preuves.filter((p): p is Exclude<PreuveJumelle, 'designation'> => p !== 'designation')
  const reconnue = deduites.length > 0 ? `reconnue ${enumerer(deduites.map((p) => PREUVE_DITE[p]))}` : ''
  if (!preuves.includes('designation')) return reconnue
  return reconnue === '' ? DESIGNEE : `${DESIGNEE}, et ${reconnue}`
}

const fois = (n: number) => (n === 2 ? 'deux' : n === 3 ? 'trois' : String(n))

const A_VERIFIER = 'elle n’est tenue pour la pièce d’aucune facture émise. Vérifiez-la sur la plateforme avant de la valider.'

// Ce que dit la marque d'une pièce À DÉSIGNER, selon ce qu'elle est et la facture que le pont prouve.
function explicationADesigner(
  nomFacture: string, dites: string, source: boolean, validee: boolean, declaree: boolean,
): string {
  const ce = `Cette pièce est la facture ${nomFacture} émise dans l’application, revenue comme pièce — ${dites}.`
    + (declaree ? ' Elle est pourtant déclarée vente hors des factures de l’application.' : '')
  if (validee) {
    // Une pièce validée que le pont rattache à une facture SOURCE est comptée deux fois : elle n'arrive pas ici.
    return `${ce} Validée sans être désignée — avant la bascule du dossier, ou avant que sa transmission soit connue —, elle `
      + 'compte la vente comme une pièce : désignez-la exemplaire de cette facture, qui ne change rien à ce qui se compte '
      + 'et la relie à sa facture.'
  }
  return `${ce} Dans ce dossier, une pièce de vente ne se valide que désignée exemplaire de la facture que le pont prouve`
    + (declaree ? ' (la désignation remplace la déclaration)' : '') + ' : désignez-la avant de la valider. '
    + (source
      ? 'Désignée, elle ne compte pas : la facture, source de sa vente, la compte elle-même.'
      : 'Désignée, elle compte la vente comme aujourd’hui : la facture, émise avant la bascule, n’en est pas la source.')
}

/**
 * La marque de chaque pièce que le pont reconnaît, dont les preuves se contredisent, ou que le cabinet a déclarée vente
 * hors des factures de l'application ; une pièce sans marque n'est pas dans la table. `factures` : celles qu'on a données au
 * pont, pour leurs numéros et leur nature. `regime` : la bascule du dossier et ses factures sources (étape VF6e) ;
 * `pieces` : celles qu'on a données au pont, pour leur statut et leur déclaration. Par régime :
 * - une facture qui n'est pas source : comme hier — sa jumelle, ou « Comptée deux fois » quand plusieurs pièces la portent ;
 *   dans un dossier basculé, une pièce que rien ne désigne s'y dit « À désigner » ;
 * - une facture source : son exemplaire désigné, « Exemplaire de la facture … » ; une pièce validée qui la compte en plus,
 *   « Comptée deux fois » ; une pièce à valider que rien ne désigne, « À désigner : c’est la facture … » ;
 * - une pièce déclarée que le pont ne rattache à rien : « Vente hors des factures de l’application ».
 */
export function marquesDesPieces(
  factures: readonly Pick<FactureEmise, 'id' | 'numero' | 'type'>[],
  jumelles: JumellesDuDossier,
  regime: RegimeDuPont,
  pieces: readonly PieceDuRegime[],
): Map<string, MarqueDeLaPiece> {
  const facture = (id: string) => factures.find((f) => f.id === id)
  // Une facture validée porte toujours son numéro (la base le donne à la validation) : l'absence ne se verrait que sur
  // des données lues de travers, et se dit sans rien inventer.
  const nom = (id: string) => facture(id)?.numero ?? '(sans numéro)'
  const numeros = (ids: readonly string[]) =>
    ids.flatMap((id) => { const n = facture(id)?.numero; return n == null ? [] : [n] })
  const pieceDe = new Map(pieces.map((p) => [p.id, p]))
  // Le pont et les marques jugent par le même calcul : les doubles, puis les pièces à désigner.
  const enDouble = ventesEnDouble(factures, jumelles, regime.sources, pieces)
  const doubleDe = new Map(enDouble.flatMap((v) => v.pieceIds.map((id) => [id, v] as const)))
  const aDesigner = new Set(piecesADesigner(jumelles, regime, enDouble).map((x) => x.pieceId))

  const marques = new Map<string, MarqueDeLaPiece>()
  for (const [pieceId, j] of jumelles.parPiece) {
    const dites = preuvesDites(j.preuves)
    const portees = jumelles.parFacture.get(j.factureId) ?? []
    // Revenue de la plateforme : un des trois faits le prouve. Désignée seulement : un exemplaire que le cabinet a déposé.
    const revenue = j.preuves.some((p) => p !== 'designation')
    const source = regime.sources.has(j.factureId)
    const double = doubleDe.get(pieceId)
    const avoir = facture(j.factureId)?.type === 'avoir'
    if (double?.parLaFacture) {
      // La facture source compte la vente, et chaque pièce validée qui n'est pas son exemplaire la compte une fois de plus.
      const fs = fois(double.pieceIds.length + 1)
      marques.set(pieceId, {
        genre: 'double',
        libelle: `Comptée ${fs} fois`,
        explication: `La facture ${nom(j.factureId)} émise dans l’application est la source de sa vente : elle la compte `
          + `elle-même, et cette pièce validée, ${dites}, la compte aussi — ${fs} fois dans la 2035, la CA3 et les `
          + 'écritures. Désignez-la exemplaire de la facture : elle ne comptera plus.',
        numeros: numeros([j.factureId]),
        autresPieces: double.pieceIds.filter((x) => x !== pieceId),
      })
    } else if (double) {
      marques.set(pieceId, {
        genre: 'double',
        libelle: `Comptée ${fois(portees.length)} fois`,
        explication: `La facture ${nom(j.factureId)} émise dans l’application est portée par ${portees.length} pièces, dont `
          + `celle-ci, ${dites}. Validées, elles la comptent ${fois(portees.length)} fois dans la 2035, la CA3 et les `
          + 'écritures : gardez une seule pièce par facture — celle reçue de la plateforme du client porte l’original.',
        numeros: numeros([j.factureId]),
        autresPieces: portees.filter((x) => x.pieceId !== pieceId).map((x) => x.pieceId),
      })
    } else if (source && designee(j)) {
      marques.set(pieceId, {
        genre: 'exemplaire',
        libelle: `Exemplaire ${avoir ? 'de l’avoir' : 'de la facture'} ${nom(j.factureId)}`,
        explication: `Cette pièce est l’exemplaire ${avoir ? 'de l’avoir' : 'de la facture'} ${nom(j.factureId)} émis`
          + `${avoir ? '' : 'e'} dans l’application — ${dites}. La vente est comptée par la facture, source de sa vente : `
          + 'la pièce ne compte nulle part.',
        numeros: numeros([j.factureId]),
        autresPieces: [],
      })
    } else if (aDesigner.has(pieceId)) {
      const piece = pieceDe.get(pieceId)
      marques.set(pieceId, {
        genre: 'a_designer',
        libelle: `À désigner : c’est ${avoir ? 'l’avoir' : 'la facture'} ${nom(j.factureId)}`,
        explication: explicationADesigner(
          nom(j.factureId), dites, source, piece?.statut === 'validee', piece?.vente_hors_des_factures === true,
        ),
        numeros: numeros([j.factureId]),
        autresPieces: [],
      })
    } else {
      marques.set(pieceId, {
        genre: 'jumelle',
        libelle: `Facture émise ${nom(j.factureId)}`,
        explication: (revenue
          ? `Cette pièce est la facture ${nom(j.factureId)} émise dans l’application, revenue comme pièce — ${dites}.`
          : `Cette pièce est un exemplaire de la facture ${nom(j.factureId)} émise dans l’application — ${dites}.`)
          + ' C’est la même vente : elle ne se compte qu’une fois.',
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
  // La vente DÉCLARÉE hors des factures de l'application (étape VF6b), que le pont ne rattache à rien : une marque neutre,
  // la déclaration étant un geste du cabinet. Rattachée par le pont, elle porte la marque du pont (« À désigner »), qui dit
  // la déclaration ; ses preuves contraires, celle d'une pièce à vérifier.
  for (const p of pieces) {
    if (!p.vente_hors_des_factures || marques.has(p.id)) continue
    marques.set(p.id, {
      genre: 'hors_factures',
      libelle: 'Vente hors des factures de l’application',
      explication: regime.dossierBascule
        ? 'Le cabinet l’a déclarée vente hors des factures de l’application : aucune facture validée de l’application '
          + 'n’est la facture de cette vente, qui compte comme une vente. Si c’était le PDF d’une facture de '
          + 'l’application, la vente compterait deux fois.'
        : 'Le cabinet l’a déclarée vente hors des factures de l’application : dans un dossier dont les factures ne sont '
          + 'pas la source de leurs ventes, la déclaration ne change rien à ce qui se compte.',
      numeros: [],
      autresPieces: [],
    })
  }
  return marques
}

// ── Ce que le bilan d'un import en dit ────────────────────────────────────────────────────────────────────────────────

export interface JumellesImportees {
  /** Les pièces importées que le pont reconnaît comme la jumelle d'une facture émise. */
  reconnues: number
  /** Parmi elles, celles dont la facture — qui n'est pas source — est portée par une autre pièce aussi : la vente compte
   *  deux fois. Jamais pour une facture SOURCE (étape VF6e) : une pièce importée est à valider, elle ne compte pas encore, et
   *  désignée exemplaire de sa facture elle ne comptera pas. */
  dejaPortees: number
  /** Les pièces importées dont les preuves se contredisent. */
  incoherentes: number
}

/** Ce que le pont dit des pièces qu'un import vient de créer, jugé sur TOUTES les pièces du dossier. `sources` : les
 *  factures sources du dossier, lues en entier avec ses factures émises (étape VF6e). */
export function jumellesImportees(
  pieceIds: readonly string[], jumelles: JumellesDuDossier, sources: FacturesSources,
): JumellesImportees {
  const importees = new Set(pieceIds)
  let reconnues = 0
  let dejaPortees = 0
  for (const id of importees) {
    const j = jumelles.parPiece.get(id)
    if (!j) continue
    reconnues++
    if (!sources.has(j.factureId) && (jumelles.parFacture.get(j.factureId) ?? []).length > 1) dejaPortees++
  }
  const incoherentes = jumelles.incoherentes.filter((i) => importees.has(i.pieceId)).length
  return { reconnues, dejaPortees, incoherentes }
}

/** Les phrases du bilan : rien quand aucune pièce importée n'a affaire à une facture émise. `dossierBascule` (étape VF6e) :
 *  dans un dossier dont les factures sont la source de leurs ventes, une vente reconnue est À DÉSIGNER à sa validation —
 *  la base ne la validera que désignée exemplaire de sa facture (G3). Une pièce importée naît à valider : aucune ne l'est
 *  encore. */
export function phrasesJumellesImportees(j: JumellesImportees, dossierBascule: boolean): string[] {
  const phrases: string[] = []
  if (j.reconnues > 0) {
    const reconnues = j.reconnues === 1
      ? '1 vente reconnue comme une facture émise de l’application'
      : `${j.reconnues} ventes reconnues comme des factures émises de l’application`
    const aDesigner = dossierBascule
      ? `, à désigner exemplaire de ${j.reconnues > 1 ? 'leur' : 'sa'} facture à la validation` : ''
    phrases.push(j.dejaPortees === 0
      ? `${reconnues}${aDesigner} : Justificatifs ${j.reconnues > 1 ? 'les' : 'la'} marque.`
      : `${reconnues}${aDesigner}, dont ${j.dejaPortees} déjà portée${j.dejaPortees > 1 ? 's' : ''} par une autre pièce : `
        + 'ne validez qu’une pièce par facture ; la Checklist le signale.')
  }
  if (j.incoherentes > 0) {
    phrases.push(j.incoherentes === 1
      ? '1 pièce dont les preuves contredisent une facture émise : à vérifier sur la plateforme avant de la valider.'
      : `${j.incoherentes} pièces dont les preuves contredisent une facture émise : à vérifier sur la plateforme avant de `
        + 'les valider.')
  }
  return phrases
}
