import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LigneDeFacture } from './encaissementsFactures'
import { derniereDefinitionSql } from '../test/schema'
import {
  SANS_ACOMPTE, prorataArrondi, recettesFactureesDeLaPeriode, ventesFacturees, type EncaissementVendu, type FactureVendue,
  type PartVendue, type RepriseVendue, type SourcesVentesFacturees,
} from './ventesFacturees'

// LES VENTES FACTURÉES D'UNE FACTURE REPRISE (étape A8c ; `calcul_vente_facturee` depuis la migration
// `factures_reprises_encaissements`, A8b, préparée). Le drapeau `FACTURES_IMPORTEES_PREVUES` est joué dans ses deux états
// par un accesseur : baissé, une reprise ne compte nulle part, comme aujourd'hui ; levé, elle compte par son registre, le
// cumul parti de l'encaissé avant la reprise, sans document, sans exigibilité de livraison ni de débits. Données FICTIVES.

const drapeau = vi.hoisted(() => ({ leve: false }))
vi.mock('./facturesImportees', () => ({ get FACTURES_IMPORTEES_PREVUES() { return drapeau.leve } }))

const D = 'd1'

const facture = (o: Partial<FactureVendue> & { statut?: string } = {}): FactureVendue => ({
  id: 'r1', dossier_id: D, statut: 'importee' as FactureVendue['statut'], type: 'facture', numero: 'FA-2026-118',
  date_emission: '2026-11-20', tiers_nom: 'Client fictif', facture_origine_id: null, source_de_la_vente: true,
  nature_operation: 'services', option_debits: false, date_prestation: null, ...o,
} as FactureVendue)

// Trois lignes de 10,01 € à 20 %, déclarées par taux (6,01 € de TVA : 36,04 € TTC) ; un avoir repris de trois lignes de
// 1,67 €, déclaré par taux (−1,00 € : −6,01 € TTC), daté d'avant la reprise.
const LIGNES: LigneDeFacture[] = [
  ...[1, 2, 3].map((ordre) => ({ facture_id: 'r1', ordre, designation: 'Séance', quantite: 1, prix_unitaire_ht: 10.01, taux_tva: 20 })),
  ...[1, 2, 3].map((ordre) => ({ facture_id: 'ar1', ordre, designation: 'Geste', quantite: -1, prix_unitaire_ht: 1.67, taux_tva: 20 })),
]
const AVOIR_REPRIS = facture({ id: 'ar1', type: 'avoir', numero: 'AV-2026-7', date_emission: '2026-12-01' })
const REPRISES: RepriseVendue[] = [
  { facture_id: 'r1', dossier_id: D, origine_id: null, encaisse_par_taux: [{ taux: 20, encaisse: 10 }], montant_tva: 6.01 },
  { facture_id: 'ar1', dossier_id: D, origine_id: 'r1', encaisse_par_taux: [], montant_tva: -1 },
]

const encaissement = (o: Partial<EncaissementVendu> = {}): EncaissementVendu => ({
  id: 'e1', dossier_id: D, facture_id: 'r1', date_encaissement: '2027-02-10', montant: 20.03, moyen: 'virement',
  ligne_bancaire_id: null, annule_id: null, cree_le: '2027-02-10T10:00:00Z', retire_le: null, ...o,
})
const PARTS: PartVendue[] = [{ encaissement_id: 'e1', dossier_id: D, taux: 20, montant: 20.03 }]

const sources = (o: Partial<SourcesVentesFacturees> = {}): SourcesVentesFacturees => ({
  dossierId: D, factures: [facture(), AVOIR_REPRIS], lignes: LIGNES, encaissements: [encaissement()], parts: PARTS,
  acomptes: SANS_ACOMPTE, reprises: REPRISES, ...o,
})

beforeEach(() => {
  drapeau.leve = false
})

describe('drapeau baissé : une facture reprise ne compte nulle part', () => {
  it('ni part, ni document, ni exigibilité, ni écart ; elle n’est pas une source', () => {
    const v = ventesFacturees(sources())
    expect(v.parts).toEqual([])
    expect(v.documents).toEqual([])
    expect(v.exigibilites).toEqual([])
    expect(v.ecartees).toEqual([])
    expect([...v.sources]).toEqual([])
  })
})

describe('drapeau levé : la règle de `calcul_vente_facturee` après les trois migrations', () => {
  beforeEach(() => {
    drapeau.leve = true
  })

  it('le texte en vigueur ferme le document et les exigibilités d’avant la reprise sur l’état « importee »', () => {
    const sql = derniereDefinitionSql('calcul_vente_facturee')
    expect(sql).toContain("f.statut in ('validee', 'importee')")
    expect(sql).toContain("v_reprise := v_facture.statut = 'importee';")
    expect(sql).toContain('montants_par_taux_du_document(p_facture_id)')
    expect(sql.match(/if not v_reprise then/g)).toHaveLength(2)
  })

  it('le cumul part de l’encaissé avant la reprise, sur V et T nets de ses avoirs repris', () => {
    // V = 601 − 100 = 501, T = 3 604 − 601 = 3 003 ; avant la reprise, 1 000 centimes portaient 167 de TVA ; le
    // paiement qui solde (2 003) porte la différence : 501 − 167 = 334.
    expect(prorataArrondi(501, 1000, 3003)).toBe(167)
    const v = ventesFacturees(sources())
    expect(v.ecartees).toEqual([])
    expect(v.parts.map((p) => [p.date, p.taux, p.ttcCentimes, p.tvaCentimes, p.htCentimes, p.regime]))
      .toEqual([['2027-02-10', 20, 2003, 334, 1669, 'encaissement']])
    expect(v.excedents).toEqual([])
    expect([...v.sources].sort()).toEqual(['ar1', 'r1'])
    // La 2035 en trésorerie : la seule recette d'après la reprise.
    expect(recettesFactureesDeLaPeriode(v, '2027-01-01', '2027-12-31', 'tresorerie')).toBe(1669)
  })

  it('ni document : sa créance est dans la reprise — ni en engagement, ni ses avoirs repris', () => {
    const v = ventesFacturees(sources())
    expect(v.documents).toEqual([])
    expect(recettesFactureesDeLaPeriode(v, '2026-01-01', '2027-12-31', 'engagement')).toBe(0)
  })

  it('des services sans option : chaque part exigible à son encaissement', () => {
    expect(ventesFacturees(sources()).exigibilites.map((x) => [x.origine, x.date, x.baseCentimes, x.tvaCentimes]))
      .toEqual([['encaissement', '2027-02-10', 1669, 334]])
  })

  it('un bien, ou des services sur les débits : aucune exigibilité — l’ancien logiciel les a déclarées', () => {
    for (const o of [{ nature_operation: 'biens' as const }, { option_debits: true }]) {
      const v = ventesFacturees(sources({ factures: [facture(o), AVOIR_REPRIS] }))
      expect(v.exigibilites).toEqual([])
      expect(v.parts).toHaveLength(1)
    }
  })

  it('l’avoir que l’application émet sur elle : un document, et une régularisation à sa date', () => {
    const avoir = facture({ id: 'a1', statut: 'validee', type: 'avoir', numero: 'MA2027-0001', facture_origine_id: 'r1', date_emission: '2027-03-01' })
    const lignes = [...LIGNES, { facture_id: 'a1', ordre: 1, designation: 'Geste', quantite: -1, prix_unitaire_ht: 10, taux_tva: 20 }]
    const v = ventesFacturees(sources({
      factures: [facture({ nature_operation: 'biens' }), AVOIR_REPRIS, avoir], lignes, encaissements: [], parts: [],
    }))
    expect(v.documents.map((d) => [d.avoirId, d.date, d.baseCentimes, d.tvaCentimes])).toEqual([['a1', '2027-03-01', -1000, -200]])
    expect(v.exigibilites.map((x) => [x.origine, x.date, x.baseCentimes, x.tvaCentimes])).toEqual([['avoir', '2027-03-01', -1000, -200]])
  })

  it('sans sa ligne de `factures_importees` : écartée, et dite — jamais un cumul parti de zéro', () => {
    const v = ventesFacturees(sources({ reprises: [] }))
    expect(v.parts).toEqual([])
    expect(v.ecartees.map((e) => e.motif)).toEqual(['reprise_illisible'])
    expect(ventesFacturees(sources({ reprises: undefined })).ecartees.map((e) => e.motif)).toEqual(['reprise_illisible'])
  })

  it('un taux que ses avoirs repris annulent : plus de TTC à répartir', () => {
    const r = [{ ...REPRISES[0], encaisse_par_taux: [{ taux: 5.5, encaisse: 3 }] }, REPRISES[1]]
    expect(ventesFacturees(sources({ reprises: r })).ecartees.map((e) => e.motif)).toEqual(['ttc_nul'])
  })

  it('une facture de l’application garde sa règle, drapeau levé : son document à sa date', () => {
    const f = facture({ id: 'f1', statut: 'validee', numero: 'F2027-0001', date_emission: '2027-01-10' })
    const lignes = [{ facture_id: 'f1', ordre: 1, designation: 'Séance', quantite: 1, prix_unitaire_ht: 100, taux_tva: 20 }]
    const v = ventesFacturees(sources({ factures: [f], lignes, encaissements: [], parts: [], reprises: [] }))
    expect(v.documents.map((d) => [d.date, d.baseCentimes])).toEqual([['2027-01-10', 10000]])
    expect(v.ecartees).toEqual([])
  })
})
