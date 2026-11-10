import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ecrituresDesVentesFacturees } from './ecrituresVentesFacturees'
import {
  compositionDesSources, ecrituresDesVentesPourLa2035, etatsDesVentesFacturees, type EncaissementDesEcritures,
  type FactureDesEcritures, type MouvementDesEcritures, type SourcesDesEcrituresDeVente,
} from './ecrituresVentesFactureesEcran'
import type { LigneDeFacture } from './encaissementsFactures'
import { facturesSourcesDe } from './facturesSources'
import { PLAN_PAR_DEFAUT } from './planComptable'
import { LIBELLE_MOTIF_VENTE, type PartVendue, type RepriseVendue } from './ventesFacturees'

// LA SECTION « VENTES FACTURÉES » DE L'ONGLET ÉCRITURES COMPOSE UNE FACTURE REPRISE (étape A8c3, ligne 51.5). La composition
// de l'écran (`compositionDesSources`) passe les reprises lues avec les sources : une facture reprise s'y compose comme
// `ecriture_attendue_vente_facturee` d'A8b (la règle d'ecrituresVentesFactureesDesReprises.test.ts, confrontée là au texte
// exporté), au lieu d'être écartée. Une reprise que la lecture ne décrit pas se DIT (« ne s'écrit pas », la règle du cumul
// qui ne sait pas d'où partir), sans geste, jamais un calcul deviné. Le drapeau `FACTURES_IMPORTEES_PREVUES` est joué dans
// ses deux états par un accesseur. Données FICTIVES.

const drapeau = vi.hoisted(() => ({ leve: true }))
vi.mock('./facturesImportees', () => ({ get FACTURES_IMPORTEES_PREVUES() { return drapeau.leve } }))

beforeEach(() => {
  drapeau.leve = true
})

const D = 'd1'
const P = PLAN_PAR_DEFAUT

const facture = (o: Partial<FactureDesEcritures> & { statut?: string } = {}): FactureDesEcritures => ({
  id: 'r1', dossier_id: D, statut: 'importee', type: 'facture', numero: 'FA-2026-118', date_emission: '2026-11-20',
  tiers_nom: 'Client fictif', tiers_siret: null, facture_origine_id: null, source_de_la_vente: true, nature_operation: 'services',
  option_debits: false, date_prestation: null, montant_ttc: 36.04, ...o,
} as FactureDesEcritures)

// Le jeu d'ecrituresVentesFactureesDesReprises.test.ts : trois lignes de 10,01 € à 20 %, 10 € encaissés avant la reprise ;
// le paiement qui solde (20,03 €) porte 3,34 € de TVA.
const LIGNES: LigneDeFacture[] = [1, 2, 3].map((ordre) => ({
  facture_id: 'r1', ordre, designation: 'Séance', quantite: 1, prix_unitaire_ht: 10.01, taux_tva: 20,
}))
const REPRISES: RepriseVendue[] = [
  { facture_id: 'r1', dossier_id: D, origine_id: null, encaisse_par_taux: [{ taux: 20, encaisse: 10 }], montant_tva: 6.01 },
]
const ENCAISSEMENT: EncaissementDesEcritures = {
  id: 'e1', dossier_id: D, facture_id: 'r1', date_encaissement: '2027-02-10', montant: 20.03, moyen: 'virement',
  ligne_bancaire_id: 'm1', annule_id: null, cree_le: '2027-02-10T10:00:00Z', retire_le: null, compte_contrepartie: null, cree_par: null,
}
const PARTS: PartVendue[] = [{ encaissement_id: 'e1', dossier_id: D, taux: 20, montant: 20.03 }]
const MOUVEMENT: MouvementDesEcritures = {
  id: 'm1', dossier_id: D, date: '2027-02-12', montant: 20.03, libelle: 'VIR SEPA RECU DE MME FICTIVE', source_fichier: null,
  encaissements_de_factures: true, statut: 'rapprochee', piece_id: null, cotisation_id: null, categorie_id: null, emprunt_id: null,
  compte_bilan: null, declaration_tva_id: null, ventilee: false, reglement_groupe: false, prelevement_personnel: false,
}

const sources = (reprises: readonly RepriseVendue[] = REPRISES): SourcesDesEcrituresDeVente => ({
  dossierId: D, factures: [facture()], lignes: LIGNES, encaissements: [ENCAISSEMENT], parts: PARTS, mouvements: [MOUVEMENT],
  exemplaires: [], reprises,
})

const etats = (s: SourcesDesEcrituresDeVente) => {
  const r = etatsDesVentesFacturees({
    sources: s, brouillon: [], mode: 'tresorerie', plan: P, anneesValidees: [], ventesParLesFactures: true,
  })
  if (r.etat !== 'lus') throw new Error(r.motif)
  return r.sources
}

describe('le drapeau levé, la composition de l’écran passe les reprises lues', () => {
  it('compositionDesSources : celle du module des écritures AVEC les reprises — jamais une reprise écartée', () => {
    const c = compositionDesSources(sources(), 'tresorerie', P)
    if (c.etat !== 'composee') throw new Error(c.motif)
    const directe = ecrituresDesVentesFacturees({
      sources: { dossierId: D, factures: [facture()], lignes: LIGNES, encaissements: [ENCAISSEMENT], parts: PARTS, reprises: REPRISES },
      mouvements: [MOUVEMENT], comptesDeContrepartie: new Map(), exemplaires: [], mode: 'tresorerie', plan: P,
    })
    expect(c.composition.ventes.ecartees).toEqual([])
    expect(c.composition.ecritures).toEqual(directe.ecritures)
    expect(c.composition.ecritures.map((e) => e.lignes.map((l) => `${l.compte} ${l.sens} ${l.centimes}`).sort())).toEqual([
      [`${P.valeurs_a_l_encaissement} debit 2003`, `${P.tva_collectee} credit 334`, `${P.prestations_de_services} credit 1669`].sort(),
      [`${P.valeurs_a_l_encaissement} credit 2003`, `${P.banque} debit 2003`].sort(),
    ])
  })

  it('la section : l’encaissement et le mouvement d’une reprise sont « à écrire », nommés « facture reprise », sans refus', () => {
    const s = etats(sources())
    expect(s.map((x) => [x.source.genre, x.etat, x.geste, x.refus])).toEqual([
      ['encaissement', 'a_ecrire', 'ecrire', null],
      ['mouvement', 'a_ecrire', 'ecrire', null],
    ])
    expect(s[0].nom).toContain('de la facture reprise FA-2026-118')
    expect(s[0].aEcrire.map((e) => e.lignes.reduce((t, l) => t + (l.sens === 'debit' ? l.centimes : 0), 0))).toEqual([2003])
  })

  it('une reprise que la lecture ne décrit pas SE DIT : « ne s’écrit pas », la règle du cumul, aucun geste', () => {
    const s = etats(sources([]))
    const enc = s.find((x) => x.source.genre === 'encaissement')
    expect(enc?.etat).toBe('ne_s_ecrit_pas')
    expect(enc?.geste).toBeNull()
    expect(enc?.detail).toContain(LIBELLE_MOTIF_VENTE.reprise_illisible)
    expect(s.every((x) => x.aEcrire.length === 0 && x.geste === null)).toBe(true)
  })

  it('la 2035 reçoit la même composition : la reprise y compte, rien d’écarté', () => {
    const r = ecrituresDesVentesPourLa2035({
      dossierId: D, ventesParLesFactures: true, facturesSources: new Set(['r1']), lecture: { dossierId: D, etat: 'lue', sources: sources() },
      mode: 'tresorerie', plan: P,
    })
    if (r.etat !== 'pret' || r.ecritures.etat !== 'composees') throw new Error('la 2035 ne reçoit pas la composition')
    expect(r.ecritures.composition.ecritures.map((e) => e.source.genre)).toEqual(['encaissement', 'mouvement'])
    expect(r.ecritures.composition.ecritures).toHaveLength(2)
  })

  it('facturesSourcesDe : une facture reprise est une facture source, comme pour les moteurs ; un brouillon jamais', () => {
    expect([...facturesSourcesDe([facture(), facture({ id: 'b', statut: 'brouillon', source_de_la_vente: false })])]).toEqual(['r1'])
  })
})

describe('le drapeau baissé, rien ne change', () => {
  it('une facture reprise ne se liste pas, ne compte pas, et se nomme « facture »', () => {
    drapeau.leve = false
    expect(etats(sources())).toEqual(etats(sources([])))
    const c = compositionDesSources(sources(), 'tresorerie', P)
    if (c.etat !== 'composee') throw new Error(c.motif)
    expect(c.composition.ecritures.filter((e) => e.source.genre === 'encaissement')).toEqual([])
    expect([...facturesSourcesDe([facture()])]).toEqual([])
  })
})
