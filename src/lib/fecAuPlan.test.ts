import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { brouillonDesVentes, composition, exportsDesVentes, sourcesDuDossierBascule } from '../test/dossierBascule'
import { SANS_ECRITURE_DE_VENTE, SANS_VENTE_FACTUREE } from '../test/ventesFacturees'
import { OPERATIONS_DE_CAISSE_ABSENTES } from './controlesDeLaCaisse'
import { CHAMPS_BNC_NON_EXPORTES, genererFec } from './fec'
import { comptesDeTiers, lettrages } from './lettrage'
import { PLAN_DECALE, PLAN_PAR_DEFAUT } from './planComptable'
import type { ModeleComptable } from './engagement'
import type { Categorie, EcritureBrouillon, LettrageManuel, ModeComptable, Piece } from './types'
import { modeleDecale, modeleDeTest } from '../test/modeles'
import { colonnes } from '../test/fecDgfip'

// LE FEC SOUS LE PLAN PAR DÉFAUT EST CELUI D'HIER, À L'OCTET PRÈS (ligne 43, étape PC3, quatrième tranche). L'auxiliaire
// du FEC et le lettrage lisent désormais le plan du dossier — son préfixe d'auxiliaire et ses comptes de tiers — au lieu
// des numéros du catalogue. Sous le plan par défaut, rien ne doit changer : chaque fichier ci-dessous est confronté, texte
// ENTIER, à l'empreinte SHA-256 et à la longueur du fichier que produisait le code d'avant cette tranche (commit c00866e),
// relevées sur ce code-là avant toute modification. Trois dossiers fictifs : un praticien en trésorerie, une société en
// engagement avec ses tiers (401, 404, 411, un tiers sans nom, une facture payée en partie, un lettrage fait à la main), et
// un dossier basculé, ses ventes facturées dans les deux modèles. Données FICTIVES.
//
// JJ1Q1-Q3 (08/11/2026) : la PieceRef d'une pièce n'est plus le nom de son fichier mais `referenceDUnePiece` (sa date et
// son empreinte courte, ici sans empreinte : le début de son identifiant). Les deux empreintes des dossiers qui portent des
// pièces ont été relevées de nouveau, après avoir confronté colonne par colonne le fichier d'avant au fichier neuf : seule
// la colonne PieceRef diffère (« achat.pdf » devenu « 20260310-achat », …). Les dossiers basculés n'en ont pas : inchangés.
//
// INAL4-Q1 (11/11/2026) : la PieceRef d'un mouvement du relevé n'est plus le nom du fichier importé mais `referenceDuReleve`
// (« Relevé du JJ/MM/AAAA »). Les deux empreintes des dossiers basculés ont été relevées de nouveau, après avoir ramené cette
// seule colonne à l'ancien nom dans le fichier neuf : il redonnait, à l'octet près, les deux empreintes d'avant (deux lignes
// changées dans chaque modèle). Les dossiers sans mouvement : inchangés.

const piece = (id: string, o: Partial<Piece> = {}): Piece => ({
  id, dossier_id: 'd1', nom_fichier: `${id}.pdf`, chemin_stockage: '', statut: 'validee',
  type_piece: 'achat', date_piece: '2026-03-10', montant_ht: null, montant_tva: null,
  montant_ttc: 100, tiers: null, categorie_id: null, sous_dossier_id: null, notes: null,
  created_at: '2026-03-10T00:00:00Z', ...o,
} as Piece)

const ligne = (pieceId: string, o: Partial<EcritureBrouillon> = {}): EcritureBrouillon => ({
  id: `e-${pieceId}-${o.compte ?? '606100'}`, dossier_id: 'd1', piece_id: pieceId,
  ligne_bancaire_id: null, date: '2026-03-10', libelle: 'Fournisseur', sens: 'debit',
  statut: 'proposee', compte: '606100', montant: 100, created_at: '2026-03-10T00:00:00Z', ...o,
} as EcritureBrouillon)

const CATEGORIES = [
  { id: 'c-achats', dossier_id: null, nom: 'Petit matériel', compte_comptable: '606100' },
] as unknown as Categorie[]

// L'empreinte d'un fichier : son SHA-256, sa longueur en octets (UTF-8) et son nombre de lignes.
const empreinte = (texte: string) => ({
  sha256: createHash('sha256').update(texte, 'utf8').digest('hex'),
  octets: Buffer.byteLength(texte, 'utf8'),
  lignes: texte.split('\r\n').length,
})

// ── Le praticien en trésorerie ──────────────────────────────────────────────────────────────────────────────────────
const TRESORERIE = {
  pieces: [
    piece('achat', { tiers: 'Transmedical', montant_ttc: 120, categorie_id: 'c-achats' }),
    piece('bien', { tiers: 'Transmedical', nom_fichier: 'fauteuil.pdf', montant_ht: 1000, montant_tva: 200, montant_ttc: 1200 }),
    piece('vente', { tiers: 'CPAM', type_piece: 'vente', date_piece: '2026-03-15', montant_ttc: 50 }),
  ],
  brouillon: [
    ligne('achat', { id: 't1', compte: '606100', montant: 120, date: '2026-04-05', ligne_bancaire_id: 'l-achat' }),
    ligne('achat', { id: 't2', compte: '512000', sens: 'credit', montant: 120, date: '2026-04-05', ligne_bancaire_id: 'l-achat' }),
    ligne('bien', { id: 't3', compte: '215400', montant: 1000, date: '2026-04-05', ligne_bancaire_id: 'l-bien' }),
    ligne('bien', { id: 't4', compte: '445620', montant: 200, date: '2026-04-05', ligne_bancaire_id: 'l-bien' }),
    ligne('bien', { id: 't5', compte: '512000', sens: 'credit', montant: 1200, date: '2026-04-05', ligne_bancaire_id: 'l-bien' }),
    ligne('vente', { id: 't6', compte: '706000', sens: 'credit', montant: 50, date: '2026-03-20', ligne_bancaire_id: 'l-vente' }),
    ligne('vente', { id: 't7', compte: '512000', sens: 'debit', montant: 50, date: '2026-03-20', ligne_bancaire_id: 'l-vente' }),
  ],
}

// ── La société en engagement, et ses tiers ──────────────────────────────────────────────────────────────────────────
const ENGAGEMENT = {
  pieces: [
    piece('achat', { tiers: 'Transmedical', montant_ttc: 120 }),
    piece('vente', { tiers: 'CPAM', type_piece: 'vente', date_piece: '2026-03-15', montant_ttc: 50 }),
    piece('partielle', { tiers: 'Bureau Vallée', montant_ttc: 200, date_piece: '2026-03-12' }),
    piece('bien', { tiers: 'Transmedical', nom_fichier: 'fauteuil.pdf', montant_ht: 1000, montant_tva: 200, montant_ttc: 1200 }),
    piece('carte', { tiers: 'CARTE BANCAIRE', montant_ttc: 30, date_piece: '2026-03-18' }),
    piece('fm', { tiers: 'Garage', date_piece: '2026-05-02', montant_ttc: 300 }),
    piece('am', { tiers: 'Garage', date_piece: '2026-05-09', montant_ttc: -300 }),
  ],
  brouillon: [
    ligne('achat', { id: 'a1', compte: '606100', sens: 'debit', montant: 120 }),
    ligne('achat', { id: 'a2', compte: '401000', sens: 'credit', montant: 120 }),
    ligne('achat', { id: 'a3', compte: '401000', sens: 'debit', montant: 120, date: '2026-04-05', ligne_bancaire_id: 'l-achat', created_at: '2026-04-20T08:00:00Z' }),
    ligne('achat', { id: 'a4', compte: '512000', sens: 'credit', montant: 120, date: '2026-04-05', ligne_bancaire_id: 'l-achat', created_at: '2026-04-20T08:00:00Z' }),
    ligne('vente', { id: 'v1', compte: '706000', sens: 'credit', montant: 50, date: '2026-03-15' }),
    ligne('vente', { id: 'v2', compte: '411000', sens: 'debit', montant: 50, date: '2026-03-15' }),
    ligne('vente', { id: 'v3', compte: '411000', sens: 'credit', montant: 50, date: '2026-03-20', ligne_bancaire_id: 'l-vente' }),
    ligne('vente', { id: 'v4', compte: '512000', sens: 'debit', montant: 50, date: '2026-03-20', ligne_bancaire_id: 'l-vente' }),
    ligne('partielle', { id: 'p1', compte: '606100', sens: 'debit', montant: 200, date: '2026-03-12' }),
    ligne('partielle', { id: 'p2', compte: '401000', sens: 'credit', montant: 200, date: '2026-03-12' }),
    ligne('partielle', { id: 'p3', compte: '401000', sens: 'debit', montant: 150, date: '2026-03-25', ligne_bancaire_id: 'l-partielle' }),
    ligne('partielle', { id: 'p4', compte: '512000', sens: 'credit', montant: 150, date: '2026-03-25', ligne_bancaire_id: 'l-partielle' }),
    ligne('bien', { id: 'b1', compte: '215400', montant: 1000 }),
    ligne('bien', { id: 'b2', compte: '445620', montant: 200 }),
    ligne('bien', { id: 'b3', compte: '404000', sens: 'credit', montant: 1200 }),
    ligne('bien', { id: 'b4', compte: '404000', sens: 'debit', montant: 1200, date: '2026-04-05', ligne_bancaire_id: 'l-bien' }),
    ligne('bien', { id: 'b5', compte: '512000', sens: 'credit', montant: 1200, date: '2026-04-05', ligne_bancaire_id: 'l-bien' }),
    ligne('carte', { id: 'k1', compte: '606100', montant: 30, date: '2026-03-18' }),
    ligne('carte', { id: 'k2', compte: '401000', sens: 'credit', montant: 30, date: '2026-03-18' }),
    ligne('fm', { id: 'fm1', compte: '606100', sens: 'debit', montant: 300, date: '2026-05-02' }),
    ligne('fm', { id: 'fm2', compte: '401000', sens: 'credit', montant: 300, date: '2026-05-02' }),
    ligne('am', { id: 'am1', compte: '606100', sens: 'credit', montant: 300, date: '2026-05-09' }),
    ligne('am', { id: 'am2', compte: '401000', sens: 'debit', montant: 300, date: '2026-05-09' }),
  ],
  manuels: ['fm', 'am'].map((p): LettrageManuel => ({
    id: `g-${p}`, dossier_id: 'd1', groupe: 'g', piece_id: p, compte: '401000', created_at: '2026-05-12T08:00:00Z',
  } as LettrageManuel)),
}

// Le FEC tel que l'onglet Écritures le produit, lettrage compris, sous le plan par défaut.
function fecDuDossier(
  mode: ModeComptable, pieces: Piece[], brouillon: EcritureBrouillon[], manuels: LettrageManuel[], categories: Categorie[],
): string {
  const lettrage = lettrages(brouillon, pieces, manuels, modeleDeTest(mode), SANS_VENTE_FACTUREE)
  return genererFec(brouillon, pieces, categories, [], modeleDeTest(mode), [], lettrage, SANS_ECRITURE_DE_VENTE, OPERATIONS_DE_CAISSE_ABSENTES, CHAMPS_BNC_NON_EXPORTES)
}

function fecDuDossierBascule(mode: ModeComptable): string {
  const sources = sourcesDuDossierBascule()
  const c = composition(sources, mode, PLAN_PAR_DEFAUT)
  const brouillon = brouillonDesVentes(c)
  const lettrage = lettrages(brouillon, [], [], modeleDeTest(mode), exportsDesVentes(sources, c))
  return genererFec(brouillon, [], [], [], modeleDeTest(mode), [], lettrage, c.ecritures, OPERATIONS_DE_CAISSE_ABSENTES, CHAMPS_BNC_NON_EXPORTES)
}

describe('le FEC sous le plan par défaut, à l’octet près', () => {
  it('le praticien en trésorerie', () => {
    expect(empreinte(fecDuDossier('tresorerie', TRESORERIE.pieces, TRESORERIE.brouillon, [], CATEGORIES))).toEqual({
      sha256: '6238e9904700bfbae21c6ee04c353e1b11add9ed4fbc9c72dfb1777eb5cfc518', octets: 977, lignes: 8,
    })
  })
  it('la société en engagement, ses tiers, ses lettrages', () => {
    expect(empreinte(fecDuDossier('engagement', ENGAGEMENT.pieces, ENGAGEMENT.brouillon, ENGAGEMENT.manuels, CATEGORIES))).toEqual({
      sha256: 'af49417586fc0e32a16e96d50d6f7dc196ae71ff7beeca55f4d0b2b906f47809', octets: 3055, lignes: 24,
    })
  })
  it('le dossier basculé en trésorerie, ses ventes facturées', () => {
    expect(empreinte(fecDuDossierBascule('tresorerie'))).toEqual({
      sha256: '7e5fe8e0dbeb987f77c472a8b6b09047bd8659aea0fbb1c92e8c7fee030ced47', octets: 1381, lignes: 9,
    })
  })
  it('le dossier basculé en engagement, ses ventes facturées et leur lettrage', () => {
    expect(empreinte(fecDuDossierBascule('engagement'))).toEqual({
      sha256: '53c34dd6279e30f9644c026aec574d752c346eba91972cbcbf6510d5dcee6851', octets: 3530, lignes: 23,
    })
  })
})

// SOUS LE PLAN DÉCALÉ, le préfixe et les comptes de tiers du plan sont lus, ceux du catalogue ne le sont plus : la même
// société, ses comptes de tiers et sa banque au plan décalé (401100, 404100, 411100, 512100), ses préfixes FO, IM et CL.
describe('le FEC et le lettrage sous le plan décalé', () => {
  const VERS_DECALE: Readonly<Record<string, string>> = {
    '401000': PLAN_DECALE.fournisseurs, '404000': PLAN_DECALE.fournisseurs_immobilisations, '411000': PLAN_DECALE.clients,
    '512000': PLAN_DECALE.banque,
  }
  const brouillon = ENGAGEMENT.brouillon.map((e) => ({ ...e, compte: VERS_DECALE[e.compte] ?? e.compte }))
  const manuels = ENGAGEMENT.manuels.map((l) => ({ ...l, compte: PLAN_DECALE.fournisseurs }))
  const fec = (modele: ModeleComptable) => colonnes(genererFec(
    brouillon, ENGAGEMENT.pieces, CATEGORIES, [], modele, [], lettrages(brouillon, ENGAGEMENT.pieces, manuels, modele, SANS_VENTE_FACTUREE),
    SANS_ECRITURE_DE_VENTE, OPERATIONS_DE_CAISSE_ABSENTES, CHAMPS_BNC_NON_EXPORTES,
  )).slice(1).filter((r) => r[6] !== '' || r[13] !== '').map((r) => [r[2], r[4], r[6], r[13]])

  it('donne à chaque tiers l’auxiliaire au préfixe du plan, et lettre ses comptes de tiers', () => {
    expect(fec(modeleDecale('engagement'))).toEqual([
      ['AC00001', '401100', 'FOTRANSMEDICAL', 'A'],
      ['AC00002', '404100', 'IMTRANSMEDICAL', 'A'],
      ['AC00003', '401100', 'FOBUREAU', ''],
      ['VE00001', '411100', 'CLDIVERS', 'A'],
      ['AC00004', '401100', 'FODIVERS', ''],
      ['BQ00001', '411100', 'CLDIVERS', 'A'],
      ['BQ00002', '401100', 'FOBUREAU', ''],
      ['BQ00003', '401100', 'FOTRANSMEDICAL', 'A'],
      ['BQ00004', '404100', 'IMTRANSMEDICAL', 'A'],
      ['AC00005', '401100', 'FOGARAGE', 'B'],
      ['AC00006', '401100', 'FOGARAGE', 'B'],
    ])
  })

  it('ne les reconnaît pas sous le plan par défaut : ni auxiliaire ni lettrage sur des comptes qui ne sont pas les siens', () => {
    expect(fec(modeleDeTest('engagement'))).toEqual([])
  })

  it('range la balance des tiers sous les comptes du plan, et les nomme', () => {
    const soldes = comptesDeTiers(brouillon, ENGAGEMENT.pieces, [], manuels, modeleDecale('engagement'), '2026-12-31', SANS_VENTE_FACTUREE)
    expect(soldes.map((s) => [s.compte, s.auxiliaire, s.solde])).toEqual([['401100', 'FOBUREAU', 50], ['401100', 'FODIVERS', 30]])
    expect(comptesDeTiers(brouillon, ENGAGEMENT.pieces, [], manuels, modeleDeTest('engagement'), '2026-12-31', SANS_VENTE_FACTUREE))
      .toEqual([])
  })
})
