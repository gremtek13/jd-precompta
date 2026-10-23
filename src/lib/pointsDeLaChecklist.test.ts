import { describe, expect, it } from 'vitest'
import { SANS_FACTURE_SOURCE } from '../test/ventesFacturees'
import { pointsDeLaChecklist, type ContexteDeLaChecklist, type DonneesDeLaChecklist } from './pointsDeLaChecklist'
import type { Categorie, DeclarationTva, EcritureBrouillon, InformationsDossier, LigneBancaire, Piece } from './types'
import { PLAN_PAR_DEFAUT } from './planComptable'

// Les points de la Vue d'ensemble, sortis de ChecklistTab (ligne 41, étape R3) : `ChecklistTab.test.tsx` garde ce que
// l'écran en affiche, mot pour mot. Ici, ce que le module seul décide : il ne lit pas l'horloge — le premier jour du mois
// et les mois écoulés viennent de l'appelant —, et il NOMME le justificatif qu'un document attendu coche, sans en faire
// le geste.

function donnees(o: Partial<DonneesDeLaChecklist>): DonneesDeLaChecklist {
  return {
    piecesValidees: [], piecesAValider: [], cotisations: [], lignes: [], relevesIncoherents: [], doublonsTexte: [], immobilisations: [],
    natures: [], categories: [], ecritures: [], emprunts: [], ventilations: [], ventilationsPartielles: false, reglements: [],
    reglementsPartiels: false, paiementsPartiels: false, lettragesManuels: [], vehicules: [], declarationsTva: [],
    declarationsPartielles: false, facturesEmises: [], transmissions: [], jumellesPartielles: false, info: null, infoInconnue: null,
    anneesCloturees: [], ouverture: null, ouvertureIncomplete: null, ventesFacturees: null, facturesSources: SANS_FACTURE_SOURCE, ...o,
  }
}

const CONTEXTE: ContexteDeLaChecklist = {
  assujettiTva: true, periodiciteTva: 'trimestrielle', statutTva: 'redevable', modele: { mode: 'tresorerie', compteNotesDeFrais: '108000', plan: PLAN_PAR_DEFAUT },
  frontiere: null, anneeCourante: 2026, moisEcoules: 9, premierJourDuMois: '2026-10-01',
}

function informations(o: Partial<InformationsDossier>): InformationsDossier {
  return {
    id: 'i1', dossier_id: 'd1', vehicule_type: 'aucun', vehicule_libelle: null, jours_travailles_an: null, tickets_restaurant: false,
    justificatif_tickets_restaurant_recu: false, cheques_vacances: false, justificatif_cheques_vacances_recu: false, notes: null,
    updated_at: '2026-01-01T10:00:00Z', ...o,
  }
}

function ligne(o: Partial<LigneBancaire>): LigneBancaire {
  return {
    id: 'l', dossier_id: 'd1', date: '2026-01-15', libelle: 'MOUVEMENT FICTIF', montant: 10, statut: 'ignoree', piece_id: null,
    cotisation_id: null, categorie_id: null, taux_tva: null, emprunt_id: null, emprunt_echeance: null, emprunt_interets: null,
    emprunt_assurance: null, ventilee: false, reglement_groupe: false, compte_bilan: null, declaration_tva_id: null,
    prelevement_personnel: false, source_fichier: 'releve.pdf', libelle_brut: 'MOUVEMENT FICTIF', id_externe: null,
    created_at: '2026-01-16T10:00:00Z', encaissements_de_factures: false, ...o,
  }
}

function declaration(o: Partial<DeclarationTva>): DeclarationTva {
  return {
    id: 'dt', dossier_id: 'd1', periode_debut: '2026-01-01', periode_fin: '2026-03-31', tva_declaree: 0, credit_anterieur: 0,
    remboursement_demande: 0, date_declaration: null, notes: null, created_at: '2026-04-10T10:00:00Z', cases: null,
    tva_collectee: null, tva_deductible: null, tva_deductible_immobilisations: null, ...o,
  }
}

describe('pointsDeLaChecklist', () => {
  it('la piste rompue ne compte pas les écritures d’une vente facturée, comme l’onglet Écritures où elle renvoie (VF4c1)', () => {
    const ecriture = (o: Partial<EcritureBrouillon>): EcritureBrouillon => ({
      id: 'e', dossier_id: 'd1', piece_id: null, ligne_bancaire_id: null, date: '2026-03-10', compte: '411000', libelle: 'Vente facturée',
      montant: 120, sens: 'debit', statut: 'proposee', created_at: '2026-03-10T10:00:00Z', immobilisation_id: null, vehicule_id: null,
      declaration_tva_id: null, cotisation_id: null, encaissement_id: null, facture_id: null, valide_le: null, journal_code: null,
      numero_ecriture: null, piece_ref: null, piece_date: null, compte_lib: null, comp_aux_num: null, comp_aux_lib: null, ...o,
    })
    const ecritures = [
      ecriture({ id: 'v1', facture_id: 'f1' }),
      ecriture({ id: 'v2', compte: '512000', ligne_bancaire_id: 'm1', encaissement_id: 'e1' }),
      ecriture({ id: 'v3', compte: '512000', ligne_bancaire_id: 'm2' }),
      ecriture({ id: 'v4', compte: '511000', sens: 'credit', ligne_bancaire_id: 'm2' }),
    ]
    const lignes = [ligne({ id: 'm1', statut: 'rapprochee', encaissements_de_factures: true }), ligne({ id: 'm2', statut: 'rapprochee', encaissements_de_factures: true })]
    const piste = (d: Partial<DonneesDeLaChecklist>) => pointsDeLaChecklist(donnees(d), CONTEXTE).tousLesPointsATraiter.find((p) => p.id === 'piste-rompue')?.nb
    expect(piste({ ecritures, lignes })).toBe(0)
    // Une ligne sans pièce ni source, et celles d'un mouvement déclassé, restent des ruptures.
    const declasse = [lignes[0], ligne({ id: 'm2', statut: 'non_rapprochee', encaissements_de_factures: false })]
    expect(piste({ ecritures: [...ecritures, ecriture({ id: 'o', compte: '606100' })], lignes: declasse })).toBe(3)
  })

  it('« rapprochés sans justificatif » ne compte pas un mouvement classé par ses encaissements de factures (VF5a1)', () => {
    const compte = (lignes: LigneBancaire[]) =>
      pointsDeLaChecklist(donnees({ lignes }), CONTEXTE).tousLesPointsATraiter.find((p) => p.id === 'rapproches-sans-objet')?.nb
    const classe = ligne({ id: 'm1', statut: 'rapprochee', montant: 598.5, encaissements_de_factures: true })
    expect(compte([classe])).toBe(0)
    // Sans le drapeau, le même mouvement ne désigne rien : un point en erreur.
    expect(compte([{ ...classe, encaissements_de_factures: false }])).toBe(1)
  })

  it('nomme le justificatif que coche un document attendu, sans en faire le geste', () => {
    const { documentsAttendus } = pointsDeLaChecklist(
      donnees({ info: informations({ tickets_restaurant: true, cheques_vacances: true, justificatif_cheques_vacances_recu: true }) }),
      CONTEXTE,
    )
    expect(documentsAttendus.find((d) => d.id === 'tickets')).toMatchObject({ ok: false, coche: 'justificatif_tickets_restaurant_recu' })
    expect(documentsAttendus.find((d) => d.id === 'vacances')).toMatchObject({ ok: true, coche: 'justificatif_cheques_vacances_recu' })
    expect(documentsAttendus.find((d) => d.id === 'banque-2026')?.coche).toBeUndefined()
  })

  it('les périodes de TVA échues se lisent au premier jour du mois que donne l’appelant, pas à l’horloge', () => {
    // Une activité en 2026, aucune déclaration : au 1er octobre, les deux premiers trimestres sont échus ; au 1er avril,
    // aucun encore.
    const d = donnees({ lignes: [ligne({ date: '2026-01-15' })] })
    const enRetard = (premierJourDuMois: string) => pointsDeLaChecklist(d, { ...CONTEXTE, premierJourDuMois })
      .tousLesPointsATraiter.find((p) => p.id === 'periodes-tva-non-declarees')?.nb
    expect(enRetard('2026-10-01')).toBeGreaterThan(0)
    expect(enRetard('2026-04-01')).toBe(0)
    // Déclarée, la période ne se réclame plus.
    const declare = pointsDeLaChecklist(donnees({ lignes: [ligne({})], declarationsTva: [declaration({})] }), { ...CONTEXTE, premierJourDuMois: '2026-07-01' })
    expect(declare.tousLesPointsATraiter.find((p) => p.id === 'periodes-tva-non-declarees')?.nb).toBe(0)
  })

  it('les mois écoulés viennent de l’appelant : ils disent quels relevés sont attendus', () => {
    const neuf = pointsDeLaChecklist(donnees({}), CONTEXTE)
    expect(neuf.exerciceCourant.moisAttendus).toHaveLength(9)
    expect(neuf.moisManquants).toHaveLength(9)
    expect(neuf.moisRecus).toBe(0)
    const zero = pointsDeLaChecklist(donnees({}), { ...CONTEXTE, moisEcoules: 0 })
    expect(zero.exerciceCourant.moisAttendus).toEqual([])
  })

  it('ne montre que les points qui comptent quelque chose, rangés en paramétrage et en travail', () => {
    const r = pointsDeLaChecklist(donnees({ lignes: [ligne({ statut: 'non_rapprochee' })] }), { ...CONTEXTE, statutTva: null })
    expect(r.pointsATraiter.map((p) => p.id)).toEqual(expect.arrayContaining(['statut-tva', 'lignes-non-rapprochees']))
    expect(r.pointsParametrage.map((p) => p.id)).toEqual(['statut-tva'])
    expect(r.pointsTravail.map((p) => p.id)).toContain('lignes-non-rapprochees')
    expect(r.pointsATraiter.every((p) => p.nb > 0)).toBe(true)
    expect(r.tousLesPointsATraiter.length).toBeGreaterThan(r.pointsATraiter.length)
  })
})

// L'EXEMPLAIRE D'UNE FACTURE SOURCE (ligne 28.65, étape VF6a ; lib/facturesSources.ts) : sa facture compte la vente, et les
// points qui jugent une pièce comme une pièce qui compte l'écartent — le même exemplaire, désigné à une facture qui n'est
// pas source, se compte comme hier. L'écriture déjà passée sur lui, elle, devient sans objet. Données FICTIVES.
describe('pointsDeLaChecklist : l’exemplaire d’une facture source (VF6a)', () => {
  const piece = (o: Partial<Piece>): Piece => ({
    id: 'x', dossier_id: 'd1', uploaded_by: null, source: 'upload', storage_path: 'd1/x.pdf', nom_fichier: 'x.pdf', storage_hash: null,
    date_piece: '2026-03-10', tiers: 'Client fictif', montant_ht: 100, montant_tva: 20, montant_ttc: 120, devise: 'EUR', montant_devise: null,
    taux_change: null, conversion_source: null, categorie_id: 'c-vente', sous_dossier_id: null, type_piece: 'vente', statut: 'validee',
    notes: null, confiance: null, superpdp_invoice_id: null, flux_hote: null, flux_id: null, lisible_path: null, identite_numero: null,
    identite_siren_vendeur: null, identite_date: null, identite_nature: null, facture_id: 'f1', created_at: '2026-03-10T09:00:00Z',
    updated_at: '2026-03-10T09:00:00Z', ...o,
  })
  const ecriture = (o: Partial<EcritureBrouillon>): EcritureBrouillon => ({
    id: 'e', dossier_id: 'd1', piece_id: 'x', ligne_bancaire_id: null, date: '2026-03-10', compte: '706000', libelle: 'Client fictif',
    montant: 100, sens: 'credit', statut: 'proposee', created_at: '2026-03-10T10:00:00Z', immobilisation_id: null, vehicule_id: null,
    declaration_tva_id: null, cotisation_id: null, encaissement_id: null, facture_id: null, valide_le: null, journal_code: null,
    numero_ecriture: null, piece_ref: null, piece_date: null, compte_lib: null, comp_aux_num: null, comp_aux_lib: null, ...o,
  })
  const HONORAIRES: Categorie = {
    id: 'c-vente', dossier_id: null, code: 'honoraires', libelle: 'Honoraires', ordre: 1, compte_comptable: '706000', poste_2035: 'Recettes',
  }
  // Son écriture telle que la génération l'écrit en trésorerie, encaissée le 20 mars.
  const ENCAISSEMENT = ligne({ id: 'm1', statut: 'rapprochee', piece_id: 'x', montant: 120, date: '2026-03-20' })
  const ECRITURE = [
    ecriture({ id: 'e1', date: '2026-03-20' }),
    ecriture({ id: 'e2', date: '2026-03-20', compte: '445710', montant: 20 }),
    ecriture({ id: 'e3', date: '2026-03-20', compte: '512000', montant: 120, sens: 'debit', ligne_bancaire_id: 'm1' }),
  ]
  const cas: [string, Partial<DonneesDeLaChecklist>, { source: number; autre: number }][] = [
    ['montant-suspect', { piecesValidees: [piece({})], lignes: [ligne({ id: 'm9', montant: -50 })], categories: [HONORAIRES] }, { source: 0, autre: 1 }],
    ['sans-categorie', { piecesValidees: [piece({ categorie_id: null })] }, { source: 0, autre: 1 }],
    ['tva-impossible', { piecesValidees: [piece({ montant_tva: 50 })], categories: [HONORAIRES] }, { source: 0, autre: 1 }],
    // Sur les deux piles, comme hier : à valider aussi.
    ['tva-impossible', { piecesAValider: [piece({ statut: 'a_valider', montant_tva: 50 })] }, { source: 0, autre: 1 }],
    ['devise-non-convertie', { piecesValidees: [piece({ devise: 'USD', montant_devise: 140, montant_ht: null, montant_tva: null, montant_ttc: null })] }, { source: 0, autre: 1 }],
    ['devise-non-convertie', { piecesAValider: [piece({ statut: 'a_valider', devise: 'USD', montant_devise: 140, montant_ht: null, montant_tva: null, montant_ttc: null })] }, { source: 0, autre: 1 }],
    ['sans-tva', { piecesValidees: [piece({ montant_tva: null, montant_ht: null })], categories: [HONORAIRES] }, { source: 0, autre: 1 }],
    ['pieces-payees-en-partie', {
      piecesValidees: [piece({ montant_ttc: 500, montant_ht: null, montant_tva: null })], categories: [HONORAIRES],
      lignes: [ligne({ id: 'm1', statut: 'rapprochee', piece_id: 'x', montant: 50 })],
    }, { source: 0, autre: 1 }],
    // L'écriture déjà passée : sans objet pour l'exemplaire d'une facture source, juste pour celui d'une autre.
    ['ecritures-sans-objet', { piecesValidees: [piece({})], categories: [HONORAIRES], lignes: [ENCAISSEMENT], ecritures: ECRITURE }, { source: 1, autre: 0 }],
    // Sans sa banque, elle n'attend pas de rapprochement ; mal équilibrée, elle ne se régénère pas ; modifiée, non plus.
    ['sans-contrepartie', { piecesValidees: [piece({})], categories: [HONORAIRES], ecritures: ECRITURE.slice(0, 2) }, { source: 0, autre: 1 }],
    ['desequilibrees', {
      piecesValidees: [piece({})], categories: [HONORAIRES], lignes: [ENCAISSEMENT],
      ecritures: [...ECRITURE.slice(0, 2), { ...ECRITURE[2], montant: 90 }],
    }, { source: 0, autre: 1 }],
    ['desynchronisees', { piecesValidees: [piece({ montant_ttc: 150, montant_ht: 125, montant_tva: 25 })], categories: [HONORAIRES], lignes: [ENCAISSEMENT], ecritures: ECRITURE }, { source: 0, autre: 1 }],
    // Le témoin : la pièce telle que son écriture l'a écrite est à jour — l'écriture est bien celle de la génération.
    ['desynchronisees', { piecesValidees: [piece({})], categories: [HONORAIRES], lignes: [ENCAISSEMENT], ecritures: ECRITURE }, { source: 0, autre: 0 }],
    ['desequilibrees', { piecesValidees: [piece({})], categories: [HONORAIRES], lignes: [ENCAISSEMENT], ecritures: ECRITURE }, { source: 0, autre: 0 }],
  ]
  const nb = (d: Partial<DonneesDeLaChecklist>, id: string, sources: ReadonlySet<string>) =>
    pointsDeLaChecklist(donnees({ ...d, facturesSources: sources }), CONTEXTE).tousLesPointsATraiter.find((p) => p.id === id)?.nb

  for (const [i, [id, d, attendu]] of cas.entries()) {
    it(`${i + 1}. « ${id} » : l’exemplaire d’une facture source ${attendu.source ? 'y compte' : 'n’y compte pas'}, celui d’une autre ${attendu.autre ? 'y compte' : 'non'}`, () => {
      expect(nb(d, id, new Set(['f1'])), 'facture source').toBe(attendu.source)
      // La même pièce, désignée à une facture qui n'est pas source, ou un dossier sans facture source : comme hier.
      expect(nb(d, id, new Set(['f2'])), 'facture qui n’est pas source').toBe(attendu.autre)
      expect(nb(d, id, SANS_FACTURE_SOURCE), 'aucune facture source').toBe(attendu.autre)
    })
  }

  it('n’écarte que l’exemplaire : une autre pièce du même défaut se compte toujours', () => {
    const d = { piecesValidees: [piece({ categorie_id: null }), piece({ id: 'y', facture_id: null, categorie_id: null })] }
    expect(nb(d, 'sans-categorie', new Set(['f1']))).toBe(1)
  })
})
