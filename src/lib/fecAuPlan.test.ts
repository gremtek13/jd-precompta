import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { brouillonDesVentes, composition, exportsDesVentes, sourcesDuDossierBascule } from '../test/dossierBascule'
import { SANS_ECRITURE_DE_VENTE, SANS_VENTE_FACTUREE } from '../test/ventesFacturees'
import { OPERATIONS_DE_CAISSE_ABSENTES } from './controlesDeLaCaisse'
import { CHAMPS_BNC_NON_EXPORTES, genererFec } from './fec'
import { lettrages } from './lettrage'
import { PLAN_PAR_DEFAUT } from './planComptable'
import type { Categorie, EcritureBrouillon, LettrageManuel, ModeComptable, Piece } from './types'

// LE FEC SOUS LE PLAN PAR DÉFAUT EST CELUI D'HIER, À L'OCTET PRÈS (ligne 43, étape PC3, quatrième tranche). L'auxiliaire
// du FEC et le lettrage lisent désormais le plan du dossier — son préfixe d'auxiliaire et ses comptes de tiers — au lieu
// des numéros du catalogue. Sous le plan par défaut, rien ne doit changer : chaque fichier ci-dessous est confronté, texte
// ENTIER, à l'empreinte SHA-256 et à la longueur du fichier que produisait le code d'avant cette tranche (commit c00866e),
// relevées sur ce code-là avant toute modification. Trois dossiers fictifs : un praticien en trésorerie, une société en
// engagement avec ses tiers (401, 404, 411, un tiers sans nom, une facture payée en partie, un lettrage fait à la main), et
// un dossier basculé, ses ventes facturées dans les deux modèles. Données FICTIVES.

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
  const lettrage = lettrages(brouillon, pieces, manuels, mode, SANS_VENTE_FACTUREE)
  return genererFec(brouillon, pieces, categories, [], mode, [], lettrage, SANS_ECRITURE_DE_VENTE, OPERATIONS_DE_CAISSE_ABSENTES, CHAMPS_BNC_NON_EXPORTES)
}

function fecDuDossierBascule(mode: ModeComptable): string {
  const sources = sourcesDuDossierBascule()
  const c = composition(sources, mode, PLAN_PAR_DEFAUT)
  const brouillon = brouillonDesVentes(c)
  const lettrage = lettrages(brouillon, [], [], mode, exportsDesVentes(sources, c))
  return genererFec(brouillon, [], [], [], mode, [], lettrage, c.ecritures, OPERATIONS_DE_CAISSE_ABSENTES, CHAMPS_BNC_NON_EXPORTES)
}

describe('le FEC sous le plan par défaut, à l’octet près', () => {
  it('le praticien en trésorerie', () => {
    expect(empreinte(fecDuDossier('tresorerie', TRESORERIE.pieces, TRESORERIE.brouillon, [], CATEGORIES))).toEqual({
      sha256: '41e3483b87435e8f5380b310b495db4e395aa3c8c12ba81553757f8aaba17aef', octets: 954, lignes: 8,
    })
  })
  it('la société en engagement, ses tiers, ses lettrages', () => {
    expect(empreinte(fecDuDossier('engagement', ENGAGEMENT.pieces, ENGAGEMENT.brouillon, ENGAGEMENT.manuels, CATEGORIES))).toEqual({
      sha256: '25d21258924bb26562e57481f0e4ea587e67206944d06a2220f13d4c8fcde16c', octets: 2964, lignes: 24,
    })
  })
  it('le dossier basculé en trésorerie, ses ventes facturées', () => {
    expect(empreinte(fecDuDossierBascule('tresorerie'))).toEqual({
      sha256: 'cadf8491bf9f3d8aabb032da5180291171b2258be7429c39ab6575abcba3d3d3', octets: 1373, lignes: 9,
    })
  })
  it('le dossier basculé en engagement, ses ventes facturées et leur lettrage', () => {
    expect(empreinte(fecDuDossierBascule('engagement'))).toEqual({
      sha256: '7f2339a80dca9544a4e3878bac44ac6c213fe0f48cd1a9ecd12455d002555889', octets: 3522, lignes: 23,
    })
  })
})
