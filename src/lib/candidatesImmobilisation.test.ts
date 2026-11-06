import { describe, expect, it } from 'vitest'
import { achatsAImmobiliser, posteQuiPeutRangerUnBien, SEUIL_IMMOBILISATION } from './candidatesImmobilisation'
import type { Categorie, Piece } from './types'

// LES ACHATS À IMMOBILISER (IMMO-Q2, relecture des immobilisations du 03/11/2026, D7) : la carte des candidates mêlait au
// matériel les relevés de recettes, les loyers, les assurances et les prélèvements de 500 € ou plus. Elle ne propose plus que
// des achats, hors des postes qui ne rangent jamais un bien. Typés sans `as`.

const categorie = (id: string, poste: string | null): Categorie => ({
  id, dossier_id: null, code: id, libelle: id, ordre: 1, compte_comptable: null, poste_2035: poste,
})
const CATEGORIES = [
  categorie('c-achats', 'Achats'), categorie('c-loyer', 'Loyers et charges locatives'), categorie('c-assurance', "Primes d'assurance"),
  categorie('c-cotis', 'Cotisations sociales personnelles'), categorie('c-hono', 'Honoraires ne constituant pas des rétrocessions'),
  categorie('c-entretien', 'Entretien et réparations'), categorie('c-maison', 'Poste du cabinet que le rattachement ignore'),
  categorie('c-sans-poste', null),
]

const piece = (id: string, o: Partial<Piece> = {}): Piece => ({
  id, dossier_id: 'd1', uploaded_by: null, source: 'upload', storage_path: `d1/${id}.pdf`, nom_fichier: `${id}.pdf`,
  storage_hash: null, date_piece: '2025-04-02', tiers: 'Fournisseur fictif', montant_ht: 1000, montant_tva: 200, montant_ttc: 1200,
  devise: 'EUR', montant_devise: null, taux_change: null, conversion_source: null, categorie_id: null, sous_dossier_id: null,
  type_piece: 'achat', statut: 'validee', confiance: null, superpdp_invoice_id: null, flux_hote: null, flux_id: null,
  lisible_path: null, identite_numero: null, identite_siren_vendeur: null, identite_date: null, identite_nature: null, facture_id: null,
  vente_hors_des_factures: false, created_at: '2025-04-02T09:00:00Z', updated_at: '2025-04-02T09:00:00Z', ...o,
})

const ids = (pieces: Piece[], o: { assujetti?: boolean; exclues?: string[] } = {}) =>
  achatsAImmobiliser(pieces, CATEGORIES, o.assujetti ?? false, new Set(o.exclues ?? [])).map((p) => p.id)

describe('achatsAImmobiliser — des achats seulement', () => {
  it('ne propose ni une vente, ni une note de frais, ni un document « autre »', () => {
    expect(ids([
      piece('achat'), piece('vente', { type_piece: 'vente' }), piece('note', { type_piece: 'note_frais' }), piece('autre', { type_piece: 'autre' }),
    ])).toEqual(['achat'])
  })

  it('écarte un loyer, une assurance, des cotisations, des honoraires ; garde les achats, l’entretien et ce qu’il ne connaît pas', () => {
    expect(ids(CATEGORIES.map((c) => piece(`p-${c.id}`, { categorie_id: c.id })))).toEqual([
      'p-c-achats', 'p-c-entretien', 'p-c-maison', 'p-c-sans-poste',
    ])
  })

  it('garde une pièce sans catégorie, et une pièce d’une catégorie non lue : mieux vaut une candidate de trop qu’un bien perdu', () => {
    expect(ids([piece('sans'), piece('inconnue', { categorie_id: 'c-non-lue' })])).toEqual(['sans', 'inconnue'])
  })

  it('juge le seuil sur la valeur qui s’amortit : le hors taxe d’un assujetti, le TTC sinon', () => {
    const p = piece('p', { montant_ht: 450, montant_tva: 90, montant_ttc: 540 })
    expect(SEUIL_IMMOBILISATION).toBe(500)
    expect(ids([p], { assujetti: false })).toEqual(['p'])
    expect(ids([p], { assujetti: true })).toEqual([])
  })

  it('écarte une pièce déjà au registre ou figée', () => {
    expect(ids([piece('a'), piece('b')], { exclues: ['a'] })).toEqual(['b'])
  })
})

describe('posteQuiPeutRangerUnBien', () => {
  it('reconnaît le poste à la casse et aux accents près', () => {
    expect(posteQuiPeutRangerUnBien('LOYERS ET CHARGES LOCATIVES')).toBe(false)
    expect(posteQuiPeutRangerUnBien('primes d’assurance')).toBe(false)
    expect(posteQuiPeutRangerUnBien('Petit outillage')).toBe(true)
    expect(posteQuiPeutRangerUnBien(null)).toBe(true)
  })
})
