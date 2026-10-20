import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { LigneDeFacture } from '../lib/encaissementsFactures'
import {
  ecrituresDesVentesFacturees, type EcrituresDesVentesFacturees, type MouvementDesEncaissements, type SourceEcritureVente,
} from '../lib/ecrituresVentesFacturees'
import { montantsDuDocument } from '../lib/factureCii'
import { PLAN_PAR_DEFAUT } from '../lib/planComptable'
import type { ModeComptable, MoyenEncaissement, NatureOperation } from '../lib/types'
import { prorataArrondi, type EncaissementVendu, type FactureVendue, type PartVendue } from '../lib/ventesFacturees'

// L'ESSAI DES ÉCRITURES D'UNE VENTE FACTURÉE (supabase/essais/ecrituresVentesFacturees.sql, chantier EC-Q3, étape VF4b),
// CÔTÉ MODULE : le jeu que l'essai pose en base — un cas par point du § 5 de la conception, dans les deux modèles
// comptables, et une vente écartée par motif — et ce que le module en attend, que l'essai exige de la base ligne à ligne ;
// la table de la règle du cumul (des triplets V, P, T et la TVA de chaque part du jeu), relevée par le MODULE
// (`prorataArrondi`, `ventesFacturees`), que la base refait en entiers. ecritureVenteFacturee.test.ts exige que l'essai
// porte exactement ce que ces fonctions rendent. Données FICTIVES.

export const TEXTE_ESSAI_ECRITURES = readFileSync(new URL('../../supabase/essais/ecrituresVentesFacturees.sql', import.meta.url), 'utf8')

// Les identifiants du jeu : un préfixe fixe, puis cinq chiffres — les dossiers 1 à 3, les factures 101 à 199, les avoirs
// 301 à 399, les mouvements 401 à 499, les encaissements 501 à 599 ; ceux du dossier en engagement, 1 000 de plus.
export const PREFIXE_ESSAI = '5f4b0000-0000-4000-8000-0000000'
export const uuidEssai = (n: number) => `${PREFIXE_ESSAI}${String(n).padStart(5, '0')}`

/** Le dossier en trésorerie et celui en engagement, qui portent le même jeu (le troisième, qui n'a pas basculé, est à part). */
export const DOSSIERS_DU_JEU: readonly { numero: number; mode: ModeComptable; decalage: number }[] = [
  { numero: 1, mode: 'tresorerie', decalage: 0 },
  { numero: 2, mode: 'engagement', decalage: 1000 },
]

interface FactureDuJeu {
  i: number
  numero: string
  type: 'facture' | 'avoir'
  emission: string
  nature: NatureOperation | null
  debits: boolean | null
  livraison: string | null
  origine: number | null
  source: boolean
  /** [quantité, prix unitaire hors taxe, taux]. */
  lignes: readonly (readonly [number, number, number])[]
}
interface MouvementDuJeu { i: number; date: string; montant: number; classe: boolean }
interface EncaissementDuJeu {
  i: number
  facture: number
  date: string
  montant: number
  moyen: MoyenEncaissement
  ligne: number | null
  annule: number | null
  retire: boolean
  compte: string | null
  /** [taux, montant]. */
  parts: readonly (readonly [number, number])[]
}

const F = (i: number, numero: string, emission: string, lignes: FactureDuJeu['lignes'], o: Partial<FactureDuJeu> = {}): FactureDuJeu => ({
  i, numero, type: 'facture', emission, nature: 'services', debits: false, livraison: null, origine: null, source: true, lignes, ...o,
})
const A = (i: number, numero: string, emission: string, origine: number, lignes: FactureDuJeu['lignes'], o: Partial<FactureDuJeu> = {}) =>
  F(i, numero, emission, lignes, { type: 'avoir', origine, ...o })

// LE JEU. Montants en euros.
export const FACTURES: readonly FactureDuJeu[] = [
  // F101 : des services à 20 %, encaissés par un virement du même jour (la banque : le mouvement n'a rien à écrire).
  F(101, 'F2026-0001', '2026-03-02', [[1, 100, 20]]),
  // F102 : deux taux, des espèces versées en banque le lendemain (53, que le mouvement solde), puis un virement crédité
  // deux jours après, moins 0,35 € de frais (627).
  F(102, 'F2026-0002', '2026-03-03', [[1, 1000, 20], [1, 100, 5.5]]),
  // F103 : un bien livré cinq jours après sa facture ; un acompte en espèces avant la livraison (53), le solde le jour même
  // de la livraison (411 : la taxe est due à la livraison, pas à l'encaissement de ce jour).
  F(103, 'F2026-0003', '2026-03-04', [[2, 150, 10]], { nature: 'biens', livraison: '2026-03-09' }),
  // F104 : des services sur l'option pour les débits, un avoir après la facture, puis le paiement.
  F(104, 'F2026-0004', '2026-03-05', [[1, 500, 20]], { debits: true }),
  A(301, 'A2026-0001', '2026-03-12', 104, [[-1, 50, 20]], { debits: true }),
  // F105 : une franchise (0 %), encaissée par compensation sur un compte que le cabinet a choisi, puis contre-passée sans
  // mouvement — sur ce même compte ([T]).
  F(105, 'F2026-0005', '2026-03-06', [[1, 80, 0]]),
  // F106 : un encaissement défait par un débit d'un autre jour ; un chèque contre-passé sans mouvement.
  F(106, 'F2026-0006', '2026-03-07', [[1, 200, 20]]),
  // F107 : une vente écartée — un encaissement que sa part ne fait pas.
  F(107, 'F2026-0007', '2026-03-08', [[1, 10, 20]]),
  // F108 : payée à moitié, sur un mouvement d'un autre jour pas encore classé ; un chèque retiré ; un mouvement classé que
  // citent aussi ce chèque retiré et un encaissement défait sans mouvement, qu'il ne compte pas.
  F(108, 'F2026-0008', '2026-03-09', [[1, 300, 20]]),
  // F109 : payée en trois fois, la règle du cumul au centime, un avoir le jour du dernier paiement, et le premier paiement
  // contre-passé entre-temps — l'exact opposé de sa TVA, non la règle du cumul.
  F(109, 'F2026-0009', '2026-03-10', [[1, 83.33, 20]]),
  A(302, 'A2026-0002', '2026-03-15', 109, [[-1, 0.83, 20]]),
  // F110 : deux compensations, l'une sans compte, l'autre sur le compte des clients, que la base refuse.
  F(110, 'F2026-0010', '2026-03-11', [[1, 40, 20]]),
  // F111 et son avoir : validés avant la bascule, ils ne sont pas source ; F111 partage un mouvement avec F112, et en a un
  // à lui seul.
  F(111, 'F2026-0011', '2026-03-12', [[1, 30, 20]], { source: false }),
  A(303, 'A2026-0003', '2026-03-13', 111, [[-1, 5, 20]], { source: false }),
  F(112, 'F2026-0012', '2026-03-12', [[1, 25, 20]]),
  // F113 : un mouvement classé que ses encaissements dépassent au-delà des frais.
  F(113, 'F2026-0013', '2026-03-13', [[1, 20, 20]]),
  // F114 : une facture de l'exercice 2025, validé dans le dossier en trésorerie.
  F(114, 'F2025-0001', '2025-12-10', [[1, 50, 20]]),
  // F115 à F119 : une vente écartée par motif — la nature, l'option pour les débits, aucune ligne, une contre-passation
  // qui n'est pas l'opposé de son encaissement, un avoir du jour d'un encaissement, qui annule son taux.
  F(115, 'F2026-0014', '2026-03-15', [[1, 10, 20]], { nature: null }),
  F(116, 'F2026-0015', '2026-03-15', [[1, 10, 20]], { debits: null }),
  F(117, 'F2026-0016', '2026-03-15', []),
  F(118, 'F2026-0017', '2026-03-16', [[1, 10, 20], [1, 10, 5.5]]),
  F(119, 'F2026-0018', '2026-03-16', [[1, 10, 20]]),
  A(304, 'A2026-0004', '2026-03-18', 119, [[-1, 10, 20]]),
  // F120 : quatre mouvements classés, chacun d'un encaissement d'un autre jour — des encaissements en deçà du mouvement,
  // l'écart des frais au seuil (5 €, sous 2 %), au-delà du plafond de 5 € (sous 2 %), au-delà de 2 % (sous 5 €).
  F(120, 'F2026-0019', '2026-03-25', [[1, 1000, 20]]),
  // F121 : deux encaissements du même jour, rangés par leur création, qui ne suit pas leur numéro : le premier créé porte
  // le centime de TVA que la règle du cumul arrondit.
  F(121, 'F2026-0020', '2026-03-27', [[1, 100, 20]]),
  // F122 et F123 : une vente écartée — une contre-passation datée avant son encaissement ; une autre qui ne répartit pas
  // son montant sur les taux comme son encaissement (la restauration seule pose l'une et l'autre).
  F(122, 'F2026-0021', '2026-03-27', [[1, 10, 20]]),
  F(123, 'F2026-0022', '2026-03-27', [[1, 10, 20], [1, 10, 5.5]]),
]

export const MOUVEMENTS: readonly MouvementDuJeu[] = [
  { i: 401, date: '2026-03-02', montant: 120, classe: true },
  { i: 402, date: '2026-03-20', montant: 1005.15, classe: true },
  { i: 403, date: '2026-03-09', montant: 230, classe: true },
  { i: 404, date: '2026-03-16', montant: 540, classe: true },
  { i: 405, date: '2026-03-17', montant: 240, classe: true },
  { i: 406, date: '2026-03-19', montant: -240, classe: true },
  { i: 407, date: '2026-03-21', montant: 180, classe: false },
  { i: 408, date: '2026-03-22', montant: 60, classe: true },
  { i: 409, date: '2026-03-23', montant: 10, classe: true },
  { i: 410, date: '2026-03-09', montant: 0.02, classe: true },
  { i: 411, date: '2026-03-25', montant: 50, classe: false },
  { i: 412, date: '2026-03-16', montant: 300, classe: true },
  { i: 413, date: '2026-03-24', montant: 6, classe: false },
  { i: 414, date: '2026-03-23', montant: 60, classe: true },
  { i: 415, date: '2026-03-27', montant: 50, classe: true },
  { i: 416, date: '2026-03-27', montant: 295, classe: true },
  { i: 417, date: '2026-03-27', montant: 294.5, classe: true },
  { i: 418, date: '2026-03-27', montant: 97.5, classe: true },
  { i: 419, date: '2026-03-25', montant: 50, classe: true },
]

const E = (i: number, facture: number, date: string, montant: number, moyen: MoyenEncaissement, parts: EncaissementDuJeu['parts'],
  o: Partial<EncaissementDuJeu> = {}): EncaissementDuJeu => ({
  i, facture, date, montant, moyen, ligne: null, annule: null, retire: false, compte: null, parts, ...o,
})

export const ENCAISSEMENTS: readonly EncaissementDuJeu[] = [
  E(501, 101, '2026-03-02', 120, 'virement', [[20, 120]], { ligne: 401 }),
  E(502, 102, '2026-03-15', 300, 'especes', [[20, 250], [5.5, 50]], { ligne: 412 }),
  E(503, 102, '2026-03-18', 1005.5, 'virement', [[20, 950], [5.5, 55.5]], { ligne: 402 }),
  E(504, 103, '2026-03-06', 100, 'especes', [[10, 100]]),
  E(505, 103, '2026-03-09', 230, 'virement', [[10, 230]], { ligne: 403 }),
  E(506, 104, '2026-03-16', 540, 'virement', [[20, 540]], { ligne: 404 }),
  E(507, 105, '2026-03-08', 80, 'compensation', [[0, 80]], { compte: '467200' }),
  E(508, 106, '2026-03-17', 240, 'virement', [[20, 240]], { ligne: 405 }),
  E(509, 106, '2026-03-18', -240, 'virement', [[20, -240]], { ligne: 406, annule: 508 }),
  E(510, 106, '2026-03-19', 12, 'cheque', [[20, 12]]),
  E(511, 106, '2026-03-24', -12, 'cheque', [[20, -12]], { annule: 510 }),
  E(512, 107, '2026-03-09', 0.02, 'virement', [[20, 0.01]], { ligne: 410 }),
  E(513, 108, '2026-03-19', 180, 'virement', [[20, 180]], { ligne: 407 }),
  E(514, 108, '2026-03-20', 50, 'cheque', [[20, 50]], { retire: true, ligne: 414 }),
  E(515, 109, '2026-03-11', 33.33, 'carte', [[20, 33.33]]),
  E(516, 109, '2026-03-12', 33.33, 'prelevement', [[20, 33.33]]),
  E(517, 109, '2026-03-15', 32.34, 'effet', [[20, 32.34]]),
  E(518, 110, '2026-03-12', 24, 'compensation', [[20, 24]]),
  E(519, 110, '2026-03-13', 24, 'autre', [[20, 24]], { compte: '411000' }),
  E(520, 111, '2026-03-22', 30, 'virement', [[20, 30]], { ligne: 408 }),
  E(521, 112, '2026-03-22', 30, 'virement', [[20, 30]], { ligne: 408 }),
  E(522, 113, '2026-03-23', 24, 'virement', [[20, 24]], { ligne: 409 }),
  E(523, 114, '2025-12-31', 30, 'compensation', [[20, 30]]),
  E(524, 114, '2025-12-31', 30, 'cheque', [[20, 30]]),
  E(525, 118, '2026-03-16', 12, 'cheque', [[20, 12]]),
  E(526, 118, '2026-03-17', -12, 'cheque', [[5.5, -12]], { annule: 525 }),
  E(527, 119, '2026-03-18', 12, 'cheque', [[20, 12]]),
  // Créés à 10 h 59 et à 10 h 01 (`creeLe`) : le 541 d'abord.
  E(539, 121, '2026-03-28', 0.03, 'virement', [[20, 0.03]]),
  E(541, 121, '2026-03-28', 0.03, 'virement', [[20, 0.03]]),
  E(542, 109, '2026-03-13', -33.33, 'carte', [[20, -33.33]], { annule: 515 }),
  E(543, 105, '2026-03-09', -80, 'compensation', [[0, -80]], { annule: 507 }),
  E(544, 111, '2026-03-24', 6, 'virement', [[20, 6]], { ligne: 413 }),
  E(545, 108, '2026-03-21', 60, 'virement', [[20, 60]], { ligne: 414 }),
  E(546, 108, '2026-03-21', 40, 'virement', [[20, 40]], { ligne: 414 }),
  E(547, 108, '2026-03-22', -40, 'virement', [[20, -40]], { annule: 546 }),
  E(548, 120, '2026-03-26', 40, 'virement', [[20, 40]], { ligne: 415 }),
  E(549, 120, '2026-03-26', 300, 'virement', [[20, 300]], { ligne: 416 }),
  E(550, 120, '2026-03-26', 300, 'virement', [[20, 300]], { ligne: 417 }),
  E(551, 120, '2026-03-26', 100, 'virement', [[20, 100]], { ligne: 418 }),
  E(552, 122, '2026-03-29', 12, 'cheque', [[20, 12]]),
  E(553, 122, '2026-03-28', -12, 'cheque', [[20, -12]], { annule: 552 }),
  E(554, 123, '2026-03-28', 2, 'cheque', [[20, 1], [5.5, 1]]),
  E(555, 123, '2026-03-29', -2, 'cheque', [[20, -1.5], [5.5, -0.5]], { annule: 554 }),
  // Un mouvement classé qui porte l'encaissement d'une facture source, et celui d'une facture qui ne l'est pas, défait
  // sans mouvement : il ne compte plus.
  E(556, 111, '2026-03-25', 6, 'virement', [[20, 6]], { ligne: 419 }),
  E(557, 111, '2026-03-26', -6, 'virement', [[20, -6]], { annule: 556 }),
  E(558, 120, '2026-03-25', 50, 'virement', [[20, 50]], { ligne: 419 }),
]

// L'instant de création d'un encaissement : son jour, à une minute qui suit son numéro — deux encaissements d'un même jour
// se rangent par lui, en base comme dans le module.
const creeLe = (e: EncaissementDuJeu) => `${e.date}T10:${String(e.i % 60).padStart(2, '0')}:00+00:00`

/** Le jeu tel que le module le lit, pour un dossier du jeu. */
export interface JeuDuDossier {
  dossierId: string
  mode: ModeComptable
  factures: FactureVendue[]
  lignes: LigneDeFacture[]
  encaissements: EncaissementVendu[]
  parts: PartVendue[]
  mouvements: MouvementDesEncaissements[]
  comptes: Map<string, string>
}

function dossierDuJeu(numero: number) {
  const d = DOSSIERS_DU_JEU.find((x) => x.numero === numero)
  if (!d) throw new Error(`dossier ${numero} hors du jeu`)
  return d
}

export function jeuDuDossier(numero: number): JeuDuDossier {
  const d = dossierDuJeu(numero)
  const u = (i: number) => uuidEssai(i + d.decalage)
  const dossierId = uuidEssai(d.numero)
  return {
    dossierId,
    mode: d.mode,
    factures: FACTURES.map((f) => ({
      id: u(f.i), dossier_id: dossierId, statut: 'validee', type: f.type, numero: f.numero, date_emission: f.emission,
      tiers_nom: 'ESSAI', facture_origine_id: f.origine == null ? null : u(f.origine), source_de_la_vente: f.source,
      nature_operation: f.nature, option_debits: f.debits, date_prestation: f.livraison,
    })),
    lignes: FACTURES.flatMap((f) => f.lignes.map(([quantite, prix, taux], k) => ({
      facture_id: u(f.i), ordre: k + 1, designation: 'ESSAI', quantite, prix_unitaire_ht: prix, taux_tva: taux,
    }))),
    encaissements: ENCAISSEMENTS.map((e) => ({
      id: u(e.i), dossier_id: dossierId, facture_id: u(e.facture), date_encaissement: e.date, montant: e.montant, moyen: e.moyen,
      ligne_bancaire_id: e.ligne == null ? null : u(e.ligne), annule_id: e.annule == null ? null : u(e.annule),
      cree_le: creeLe(e), retire_le: e.retire ? `${e.date}T12:00:00+00:00` : null,
    })),
    parts: ENCAISSEMENTS.flatMap((e) => e.parts.map(([taux, montant]) => ({ encaissement_id: u(e.i), dossier_id: dossierId, taux, montant }))),
    mouvements: MOUVEMENTS.map((m) => ({
      id: u(m.i), dossier_id: dossierId, date: m.date, montant: m.montant, libelle: 'ESSAI', source_fichier: null,
      encaissements_de_factures: m.classe,
    })),
    comptes: new Map(ENCAISSEMENTS.filter((e) => e.compte != null).map((e) => [u(e.i), e.compte as string])),
  }
}

export function compositionDuJeu(numero: number): EcrituresDesVentesFacturees {
  const j = jeuDuDossier(numero)
  return ecrituresDesVentesFacturees({
    sources: { dossierId: j.dossierId, factures: j.factures, lignes: j.lignes, encaissements: j.encaissements, parts: j.parts },
    mouvements: j.mouvements, comptesDeContrepartie: j.comptes, mode: j.mode, plan: PLAN_PAR_DEFAUT,
  })
}

const ordreC = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/** Le genre d'une source, comme l'essai l'abrège : f, a, e, m. */
export type GenreAbrege = 'f' | 'a' | 'e' | 'm'
const GENRES: Readonly<Record<GenreAbrege, SourceEcritureVente['genre']>> = { f: 'facture', a: 'avoir', e: 'encaissement', m: 'mouvement' }

/** Toutes les sources du jeu, abrégées : [genre, numéro]. */
export function sourcesDuJeu(): [GenreAbrege, number][] {
  return [
    ...FACTURES.map((f): [GenreAbrege, number] => [f.type === 'avoir' ? 'a' : 'f', f.i]),
    ...ENCAISSEMENTS.map((e): [GenreAbrege, number] => ['e', e.i]),
    ...MOUVEMENTS.map((m): [GenreAbrege, number] => ['m', m.i]),
  ]
}

/**
 * Ce que le module dit d'une source d'un dossier du jeu, rendu comme la macro VUE de l'essai rend ce qu'en dit
 * `ecriture_attendue_vente_facturee` : le motif (et son détail : le motif de la facture écartée, le compte refusé), sinon
 * ses lignes jour par jour (« MM-JJ compte+centimes@mouvement », le compte sans ses zéros de fin, débit « + », crédit
 * « - »), sinon « ∅ ». La base dit
 * aussi « écartée » d'un avoir ou d'un encaissement d'une facture que le module écarte, dont il ne dit rien de plus.
 */
export function vueDuModule(numero: number, genre: GenreAbrege, n: number): string {
  const d = dossierDuJeu(numero)
  const j = jeuDuDossier(numero)
  const r = compositionDuJeu(numero)
  const id = uuidEssai(n + d.decalage)
  const g = GENRES[genre]
  const cle = (s: SourceEcritureVente) => (s.genre === 'encaissement' ? s.encaissementId : s.genre === 'mouvement' ? s.ligneBancaireId : s.factureId)
  const ecartees = new Map(r.ventes.ecartees.map((e) => [e.factureId, e.motif as string]))
  const factureDeLaSource = g === 'facture' ? id : g === 'avoir' ? j.factures.find((f) => f.id === id)?.facture_origine_id
    : g === 'encaissement' ? j.encaissements.find((e) => e.id === id)?.facture_id : null
  if (factureDeLaSource && ecartees.has(factureDeLaSource)) return `vente_ecartee(${ecartees.get(factureDeLaSource)})`
  const nonEcrite = r.nonEcrites.find((x) => x.source.genre === g && cle(x.source) === id)
  if (nonEcrite) {
    if (nonEcrite.motif !== 'compte_refuse') return nonEcrite.motif
    const e = j.encaissements.find((x) => x.id === id)
    const t = e && e.annule_id != null && e.ligne_bancaire_id == null ? e.annule_id : id
    return `compte_refuse(${j.comptes.get(t)})`
  }
  const lignes = r.ecritures.filter((e) => e.source.genre === g && cle(e.source) === id)
    .flatMap((e) => e.lignes.map((l) => `${e.date}|${l.compte}|${l.sens}|${l.centimes}|${l.ligneBancaireId ?? ''}`))
    .sort(ordreC)
  if (lignes.length === 0) return '∅'
  const jours = [...new Set(lignes.map((l) => l.slice(0, 10)))].sort(ordreC)
  return jours.map((jour) => `${jour.slice(5)} ${lignes.filter((l) => l.startsWith(jour)).map((l) => {
    const [, compte, sens, centimes, ligne] = l.split('|')
    return `${compte.replace(/0+$/, '')}${sens === 'debit' ? '+' : '-'}${centimes}${ligne ? `@${ligne.slice(-3)}` : ''}`
  }).join(' ')}`).join(' ; ')
}

/** Une liste de sources, rendue comme un contrôle VUE de l'essai : « e501 : <trésorerie> / <engagement> | … », ou une
 * seule fois ce que les deux modèles rendent pareil. */
export function vueDesSources(sources: readonly (readonly [GenreAbrege, number])[]): string {
  return sources.map(([g, n]) => {
    const [r, e] = [vueDuModule(1, g, n), vueDuModule(2, g, n)]
    return `${g}${n} : ${r === e ? r : `${r} / ${e}`}`
  }).join(' | ')
}

/** Les parts du dossier en trésorerie selon le module, comme le contrôle 2 les rend : « encaissement:taux:TTC:TVA ». */
export function partsDuJeu(): string {
  return compositionDuJeu(1).ventes.parts
    .map((p) => ({ n: p.encaissementId.slice(-3), taux: p.taux, texte: `${p.encaissementId.slice(-3)}:${p.taux}:${p.ttcCentimes}:${p.tvaCentimes}` }))
    .sort((a, b) => ordreC(a.n, b.n) || b.taux - a.taux)
    .map((p) => p.texte).join(' ')
}

/** Les triplets de la règle du cumul : V, P, T, dont la base doit rendre V × P / T arrondi comme le module, le demi loin
 * de zéro. Des demis exacts, des négatifs, zéro, et des montants de dix mille milliards d'euros en centimes. */
export const TRIPLETS_DU_CUMUL: readonly (readonly [number, number, number])[] = [
  [2000, 5000, 12000], [2000, 6000, 12000], [-2000, 6000, 12000], [1, 1, 2], [-1, 1, 2], [1, 3, 2], [3, 1, 2], [-3, 1, 2],
  [0, 7, 9], [7, 0, 9], [1667, 3333, 10000], [1667, 6666, 10000], [1650, 9900, 9900], [550, 1055, 10550],
  [550, 5275, 10550], [-550, 5275, 10550], [2000, 12001, 12000], [2000, 11999, 12000], [100, 1, 200], [100, 3, 200],
  [999_999_999_999_999, 999_999_999_999_999, 999_999_999_999_998], [123_456_789_012_345, 98_765_432_109, 999_999_999_999_999],
  [-123_456_789_012_345, 98_765_432_109, 999_999_999_999_999], [1, 999_999_999_999_999, 2_000_000_000_000_000],
  [1, 1_000_000_000_000_000, 2_000_000_000_000_000], [5, 1, 10], [15, 1, 10], [25, 1, 10], [-25, 1, 10], [833, 3333, 9999],
  // Un quotient de quinze chiffres, juste sous le demi : une division `numeric` l'arrondirait au demi, puis au-dessus.
  [999_999_999_999_997, 500_000_000_000_001, 999_999_999_999_998],
]

/** Ce que le module rend pour chaque triplet, comme le contrôle 1 le rend. */
export function cumulDuModule(): string {
  return TRIPLETS_DU_CUMUL.map(([v, p, t]) => String(prorataArrondi(v, p, t))).join(' ')
}

/** Un jour du jeu, comme la macro JEU l'écrit : son écart au 1er mars 2026. */
export const jourDuJeu = (date: string) => Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse('2026-03-01T00:00:00Z')) / 86_400_000)

/**
 * Le jeu, sous la forme que l'essai pose en base (la macro JEU), compacte : des tableaux, ce qui est rarement rempli en
 * dernier, et les cases vides de la fin ôtées (l'essai les lit nulles) ; un jour, son écart au 1er mars 2026 ; un
 * booléen, 0 ou 1 (un encaissement retiré, 1 ou rien) ; la nature, « s » ou « b » ; le type d'une facture, l'initiale de
 * son numéro ; ses montants en euros. La facture d'origine d'un avoir et l'encaissement qu'annule une contre-passation
 * sont au même rang (8), que l'essai lit par une seule macro. L'essai date la création d'un encaissement comme
 * `creeLe`, de son jour et de son numéro.
 */
export function jeuPourLaBase(): string {
  const montants = (f: FactureDuJeu) => {
    const groupes = montantsDuDocument({ type: f.type }, f.lignes.map(([quantite, prix, taux], k) => ({
      ordre: k + 1, designation: 'ESSAI', quantite, prix_unitaire_ht: prix, taux_tva: taux,
    })), null).groupes
    const signe = f.type === 'avoir' ? -1 : 1
    const ht = groupes.reduce((s, g) => s + g.baseCentimes, 0)
    const tva = groupes.reduce((s, g) => s + g.tvaCentimes, 0)
    return [(signe * ht) / 100, (signe * tva) / 100]
  }
  const b = (v: boolean | null) => (v == null ? null : v ? 1 : 0)
  const jour = (d: string | null) => (d == null ? null : jourDuJeu(d))
  const sansFinVide = (l: (string | number | null)[]) => {
    while (l.length > 0 && l[l.length - 1] == null) l.pop()
    return l
  }
  return JSON.stringify({
    f: FACTURES.map((f) => sansFinVide([f.i, f.numero, jour(f.emission), f.nature == null ? null : f.nature === 'biens' ? 'b' : 's',
      b(f.debits), b(f.source), ...montants(f), f.origine, jour(f.livraison)])),
    l: FACTURES.flatMap((f) => f.lignes.map(([q, p, t], k) => [f.i, k + 1, q, p, t])),
    m: MOUVEMENTS.map((m) => [m.i, jour(m.date), m.montant, b(m.classe)]),
    e: ENCAISSEMENTS.map((e) => sansFinVide([e.i, e.facture, jour(e.date), e.montant, e.moyen, e.ligne, e.retire ? 1 : null, e.compte,
      e.annule])),
    p: ENCAISSEMENTS.flatMap((e) => e.parts.map(([t, m]) => [e.i, t, m])),
  })
}

// ── L'essai, lu ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** L'empreinte d'un attendu long, comme l'essai l'écrit : « md5: » et l'empreinte de son texte (UTF-8, comme la base). */
export const empreinteDAttendu = (texte: string) => `md5:${createHash('md5').update(texte, 'utf8').digest('hex')}`

/** L'attendu en clair d'un contrôle de l'essai dont l'attendu est une empreinte : le commentaire « -- attendu N : … » qui
 * le précède, ou rien. */
export function attenduEnClairDeLEssai(numero: string, texte: string = TEXTE_ESSAI_ECRITURES): string | null {
  const m = new RegExp(`^\\s*-- attendu ${numero} : (.*)$`, 'm').exec(texte)
  return m ? m[1] : null
}

/** Une macro de l'essai : le texte entre `'NOM', $m$` et `$m$`. */
export function macroDeLEssai(nom: string, texte: string = TEXTE_ESSAI_ECRITURES): string | null {
  const m = new RegExp(`'${nom}', \\$m\\$([\\s\\S]*?)\\$m\\$`).exec(texte)
  return m ? m[1] : null
}

/** Les sources qu'un contrôle VUE de l'essai rend, dans son ordre : la liste « '{f101,e501,…}' » qui le termine, ou rien
 * pour un autre contrôle. */
export function sourcesDuControleVue(requete: string): [GenreAbrege, number][] {
  const m = /'\{([faem]\d+(?:,[faem]\d+)*)\}'::text\[\]\) with ordinality s\(x, o\)$/.exec(requete)
  return m ? m[1].split(',').map((x) => [x[0] as GenreAbrege, Number(x.slice(1))]) : []
}
