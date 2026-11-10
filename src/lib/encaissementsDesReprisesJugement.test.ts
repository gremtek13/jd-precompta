import { beforeEach, describe, expect, it, vi } from 'vitest'
import { REFUS_ENCAISSEMENT_D_UNE_REPRISE } from './encaissementsDesReprises'
import {
  REFUS_ENREGISTREMENT, REFUS_ENREGISTREMENT_DES_REPRISES, REFUS_REPRISE_NON_LUE, montantsParTauxDuDocument,
  refusDeLaFacture, refusEnregistrementExportes, refusEnregistrementVente,
  type AvoirRepris, type ContexteFacture, type ContexteVente, type FacturePourEncaissement, type LigneDeFacture,
  type RepriseDeLaFacture, type SaisieEncaissement,
} from './encaissementsFactures'
import { MIGRATIONS_DES_FACTURES_REPRISES, definitionApresLesPreparees } from '../test/schema'
import { messagesSql } from '../test/raiseSql'

// LES ENCAISSEMENTS D'UNE FACTURE REPRISE, JUGÉS AVANT LE CLIC (étape A8c ; la migration `factures_reprises_encaissements`,
// A8b, préparée). Le drapeau `FACTURES_IMPORTEES_PREVUES` est joué dans ses deux états par un accesseur : baissé, une
// facture reprise se refuse dès son état, comme aujourd'hui, et rien d'autre ne change ; levé, elle reçoit les refus et
// les plafonds de la migration, sous ses mots.

const drapeau = vi.hoisted(() => ({ leve: false }))
vi.mock('./facturesImportees', () => ({ get FACTURES_IMPORTEES_PREVUES() { return drapeau.leve } }))

const D = 'd1'
const AUJOURD_HUI = '2027-03-15'

// Trois lignes de 10,01 € à 20 % : ligne à ligne, 2,00 € de TVA chacune (6,00 €) ; par taux, 30,03 × 20 % = 6,006, soit
// 6,01 € — la règle d'EN 16931 (BR-CO-17) que l'ancien logiciel a pu suivre, et que sa TVA déclarée trahit.
const LIGNES: LigneDeFacture[] = [1, 2, 3].map((ordre) => ({
  facture_id: 'r1', ordre, designation: `Séance ${ordre}`, quantite: 1, prix_unitaire_ht: 10.01, taux_tva: 20,
}))
// Un avoir repris qui la crédite, trois lignes de 1,67 € à 20 % : ligne à ligne 0,99 € de TVA, par taux 5,01 × 20 % = 1,00 €,
// sa TVA déclarée (−1,00 €, un avoir s'enregistre en négatif) : 6,01 € TTC.
const LIGNES_AVOIR: LigneDeFacture[] = [1, 2, 3].map((ordre) => ({
  facture_id: 'ar1', ordre, designation: `Geste ${ordre}`, quantite: -1, prix_unitaire_ht: 1.67, taux_tva: 20,
}))

function facture(o: Partial<FacturePourEncaissement> & { statut?: string } = {}): FacturePourEncaissement {
  return {
    id: 'r1', dossier_id: D, statut: 'importee' as FacturePourEncaissement['statut'], type: 'facture', numero: 'FA-2026-118',
    date_emission: '2026-11-20', emetteur_siret: null, montant_ht: 30.03, montant_tva: 6.01, montant_ttc: 36.04,
    superpdp_invoice_id: null, tiers_nom: 'Client fictif', source_de_la_vente: true, ...o,
  } as FacturePourEncaissement
}

const AVOIR_REPRIS: AvoirRepris = { id: 'ar1', type: 'avoir', statut: 'importee', montant_tva: -1, montant_ttc: -6.01, origine_id: 'r1' }

function reprise(o: Partial<RepriseDeLaFacture> = {}): RepriseDeLaFacture {
  return {
    factureId: 'r1', repriseLe: '2027-01-01', natureOperation: 'services', encaisseAvantReprise: 10,
    encaisseParTaux: [{ taux: 20, encaisse: 10 }], avoirsRepris: [AVOIR_REPRIS], ...o,
  }
}

function contexte(o: Partial<ContexteFacture> = {}): ContexteFacture {
  return {
    dossierId: D, facture: facture(), lignes: [...LIGNES, ...LIGNES_AVOIR], transmissions: [], evenementsSuperpdp: [],
    statutsRecus: [], encaissements: [], parts: [], reprise: reprise(), ...o,
  }
}

function saisie(o: Partial<SaisieEncaissement> = {}): SaisieEncaissement {
  return { date: '2027-02-10', montant: 20.03, moyen: 'virement', ligneBancaireId: null, repartition: [{ taux: 20, montant: 20.03 }], ...o }
}

const VENTE: ContexteVente = { anneesValidees: [], factures: [] }
const juger = (c: ContexteFacture, s: SaisieEncaissement) => refusEnregistrementVente(c, s, [], AUJOURD_HUI, true, VENTE)

beforeEach(() => {
  drapeau.leve = false
})

describe('drapeau baissé : une facture reprise se refuse dès son état, et rien d’autre ne change', () => {
  it('« brouillon », comme aujourd’hui, contexte de reprise ou non', () => {
    expect(refusDeLaFacture(contexte())?.cle).toBe('brouillon')
    expect(refusDeLaFacture(contexte({ reprise: undefined }))?.cle).toBe('brouillon')
    expect(juger(contexte(), saisie())?.cle).toBe('brouillon')
  })

  it('les montants par taux d’une reprise restent ceux de ses lignes : ligne à ligne', () => {
    expect(montantsParTauxDuDocument(facture(), LIGNES)).toEqual([{ taux: 20, baseCentimes: 3003, tvaCentimes: 600, ttcCentimes: 3603 }])
  })

  it('les refus que la base porte aujourd’hui : ceux de l’export, sans les quatre neufs', () => {
    expect(refusEnregistrementExportes()).toBe(REFUS_ENREGISTREMENT)
  })
})

describe('drapeau levé : les refus et les plafonds d’une facture reprise, sous les mots de la migration', () => {
  beforeEach(() => {
    drapeau.leve = true
  })

  it('les refus en vigueur après les trois migrations : ceux d’hier, les quatre neufs à leur rang', () => {
    expect(refusEnregistrementExportes()).toBe(REFUS_ENREGISTREMENT_DES_REPRISES)
    const sql = definitionApresLesPreparees('enregistrer_encaissement', MIGRATIONS_DES_FACTURES_REPRISES)
    expect(REFUS_ENREGISTREMENT_DES_REPRISES.map((r) => r.modele)).toEqual(messagesSql(sql))
    expect(REFUS_ENREGISTREMENT_DES_REPRISES).toHaveLength(REFUS_ENREGISTREMENT.length + REFUS_ENCAISSEMENT_D_UNE_REPRISE.length)
  })

  it('la règle de TVA de ses montants déclarés : par taux quand la somme des taux fait sa TVA, sinon ligne à ligne', () => {
    expect(montantsParTauxDuDocument(facture(), LIGNES)).toEqual([{ taux: 20, baseCentimes: 3003, tvaCentimes: 601, ttcCentimes: 3604 }])
    expect(montantsParTauxDuDocument(facture({ montant_tva: 6 }), LIGNES))
      .toEqual([{ taux: 20, baseCentimes: 3003, tvaCentimes: 600, ttcCentimes: 3603 }])
    // Un avoir repris, dans son sens : en positif ; sa TVA déclarée, négative, se compare à l'opposé.
    expect(montantsParTauxDuDocument(AVOIR_REPRIS, LIGNES_AVOIR)).toEqual([{ taux: 20, baseCentimes: 501, tvaCentimes: 100, ttcCentimes: 601 }])
    // Une facture de l'application suit toujours ses lignes : la règle ne vaut que pour une reprise.
    expect(montantsParTauxDuDocument(facture({ statut: 'validee' }), LIGNES)[0].tvaCentimes).toBe(600)
  })

  it('une reprise arrondie par taux se retrouve dans ses lignes ; la même facture de l’application, non', () => {
    expect(refusDeLaFacture(contexte())).toBeNull()
    expect(refusDeLaFacture(contexte({ facture: facture({ statut: 'validee' }) }))?.cle).toBe('lignes_incoherentes')
  })

  it('sans ce que sa reprise porte, ou avec celui d’une autre facture : aucun encaissement ne se juge', () => {
    expect(refusDeLaFacture(contexte({ reprise: undefined }))).toEqual({ cle: REFUS_REPRISE_NON_LUE.cle, message: REFUS_REPRISE_NON_LUE.modele })
    expect(refusDeLaFacture(contexte({ reprise: reprise({ factureId: 'autre' }) }))?.cle).toBe('reprise_non_lue')
  })

  it('A8B-Q1 : une reprise qui mêle biens et services, après le rejet et avant les montants', () => {
    expect(refusDeLaFacture(contexte({ reprise: reprise({ natureOperation: 'mixte' }) })))
      .toEqual({ cle: 'reprise_mixte', message: expect.stringMatching(/^La facture FA-2026-118 est reprise de l'ancien logiciel et mêle biens et services/) })
    expect(refusDeLaFacture(contexte({ reprise: reprise({ natureOperation: 'mixte' }), transmissions: [
      { facture_id: 'r1', canal: 'superpdp', etat: 'rejete', hote: 'api.superpdp.tech', flux_id: null },
    ] }))?.cle).toBe('rejetee')
  })

  it('A8-Q2 : un encaissement daté d’avant la reprise, après la date future et avant la frontière', () => {
    const r = juger(contexte(), saisie({ date: '2026-12-31' }))
    expect(r?.cle).toBe('avant_la_reprise')
    expect(r?.message).toContain('le 01/01/2027, ou d\'après')
    expect(juger(contexte(), saisie({ date: '2027-03-16' }))?.cle).toBe('date_future')
    expect(juger(contexte(), saisie({ date: '2027-01-01' }))).toBeNull()
    // Une date de reprise nulle s'écrit comme la base l'écrit.
    expect(juger(contexte({ reprise: reprise({ repriseLe: null }) }), saisie())?.message).toContain('le <NULL>, ou')
  })

  it('A8-Q6 : le plafond au total, net des avoirs repris et de l’encaissé avant la reprise', () => {
    // 36,04 − 6,01 (l'avoir repris) − 10 (avant la reprise) = 20,03 €.
    expect(juger(contexte(), saisie())).toBeNull()
    const r = juger(contexte(), saisie({ montant: 20.04, repartition: [{ taux: 20, montant: 20.04 }] }))
    expect(r?.cle).toBe('plafond_reprise')
    expect(r?.message).toContain('il reste 20,03 € à encaisser.')
    // Un avoir repris d'une autre facture, ou un avoir de l'application à l'état « importee » qui ne la cite pas, ne crédite rien.
    const ailleurs = contexte({ reprise: reprise({ avoirsRepris: [{ ...AVOIR_REPRIS, origine_id: 'r2' }] }) })
    expect(juger(ailleurs, saisie({ montant: 26.04, repartition: [{ taux: 20, montant: 26.04 }] }))).toBeNull()
    expect(juger(ailleurs, saisie({ montant: 26.05, repartition: [{ taux: 20, montant: 26.05 }] }))?.cle).toBe('plafond_reprise')
  })

  it('A8-Q6 : le plafond d’un taux, net de ce qui était encaissé à ce taux avant la reprise', () => {
    // Aucun avoir repris : le total admet 36,04 − 10 = 26,04 € ; le taux, 36,04 − 14 = 22,04 € (l'encaissé avant se répartit
    // ici à 14 € sur le taux contre 10 € au total, un jeu d'essai que la base n'écrirait pas) : le taux refuse seul.
    const c = contexte({ reprise: reprise({ avoirsRepris: [], encaisseParTaux: [{ taux: 20, encaisse: 14 }] }) })
    const r = juger(c, saisie({ montant: 26.04, repartition: [{ taux: 20, montant: 26.04 }] }))
    expect(r?.cle).toBe('plafond_reprise_taux')
    expect(r?.message).toBe("À 20 %, l'encaissement dépasserait ce que la facture reprise porte encore, nette de ses avoirs et de ce qui en était encaissé avant la reprise : il reste 22,04 € à encaisser à ce taux.")
  })

  it('une facture de l’application garde ses refus d’hier, drapeau levé', () => {
    const validee = contexte({ facture: facture({ statut: 'validee', montant_tva: 6, montant_ttc: 36.03, source_de_la_vente: false }), reprise: undefined })
    const r = juger(validee, saisie({ montant: 36.04, repartition: [{ taux: 20, montant: 36.04 }] }))
    expect(r?.cle).toBe('plafond_facture')
  })
})
