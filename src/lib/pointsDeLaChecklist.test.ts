import { describe, expect, it } from 'vitest'
import { SANS_FACTURE_SOURCE } from '../test/ventesFacturees'
import { pointsDeLaChecklist, type ContexteDeLaChecklist, type DonneesDeLaChecklist } from './pointsDeLaChecklist'
import type { ANouveau, Categorie, DeclarationTva, EcritureBrouillon, InformationsDossier, LigneBancaire, OperationCaisse, Piece, SoldeReporte } from './types'
import { ecritureDeLOperation } from './caisse'
import type { CaisseLue } from './recettesDeCaisse'
import type { LectureDesVentesDuReleve } from './mouvementsDesVentes'
import { COMPTE_BANQUE } from './comptes'
import { formatMoney } from './format'
import { A_NOUVEAU_NON_VALIDE, NON_VALIDEE } from '../test/ecritures'
import { PLAN_PAR_DEFAUT } from './planComptable'
import { CAISSE_PAS_EN_BASE } from './controlesDeLaCaisse'

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
    anneesCloturees: [], ouverture: null, ouvertureIncomplete: null, aNouveaux: [], soldesReportes: [], entreesDeLOuvertureIncompletes: null,
    ventesFacturees: null, facturesSources: SANS_FACTURE_SOURCE, caisse: CAISSE_PAS_EN_BASE, entreesDeLaCaisseIncompletes: null, ...o,
  }
}

const CONTEXTE: ContexteDeLaChecklist = {
  assujettiTva: true, periodiciteTva: 'trimestrielle', statutTva: 'redevable', modele: { mode: 'tresorerie', compteNotesDeFrais: '108000', plan: PLAN_PAR_DEFAUT },
  frontiere: null, anneesValidees: [], aujourdHui: '2026-10-24', anneeCourante: 2026, moisEcoules: 9, premierJourDuMois: '2026-10-01',
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
    identite_siren_vendeur: null, identite_date: null, identite_nature: null, facture_id: 'f1', vente_hors_des_factures: false, created_at: '2026-03-10T09:00:00Z',
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

  // LES TROIS POINTS QUE VF6a LAISSAIT (étape VF6e) : la catégorie de l'exemplaire ne réclame ni compte ni poste — il ne
  // s'écrit pas, la 2035 l'écarte —, et il ne se dit pas payé en trop — il ne se règle pas, sa facture s'encaisse.
  const SANS_COMPTE: Categorie = { ...HONORAIRES, id: 'c-nue', code: 'autre', compte_comptable: null, poste_2035: null }
  const casVF6e: [string, Partial<DonneesDeLaChecklist>, { source: number; autre: number }][] = [
    ['comptes-manquants', { piecesValidees: [piece({ categorie_id: 'c-nue' })], categories: [SANS_COMPTE] }, { source: 0, autre: 1 }],
    ['postes-manquants', { piecesValidees: [piece({ categorie_id: 'c-nue' })], categories: [SANS_COMPTE] }, { source: 0, autre: 1 }],
    ['pieces-payees-en-trop', {
      piecesValidees: [piece({})], categories: [HONORAIRES],
      lignes: [ENCAISSEMENT, ligne({ id: 'm2', statut: 'rapprochee', piece_id: 'x', montant: 120, date: '2026-03-21' })],
    }, { source: 0, autre: 1 }],
  ]
  for (const [i, [id, d, attendu]] of casVF6e.entries()) {
    it(`VF6e ${i + 1}. « ${id} » : l’exemplaire d’une facture source ${attendu.source ? 'y compte' : 'n’y compte pas'}, celui d’une autre ${attendu.autre ? 'y compte' : 'non'}`, () => {
      expect(nb(d, id, new Set(['f1'])), 'facture source').toBe(attendu.source)
      expect(nb(d, id, new Set(['f2'])), 'facture qui n’est pas source').toBe(attendu.autre)
      expect(nb(d, id, SANS_FACTURE_SOURCE), 'aucune facture source').toBe(attendu.autre)
    })
  }

  it('VF6e : une catégorie qu’une autre pièce emploie aussi réclame toujours son compte et son poste', () => {
    const d = { piecesValidees: [piece({ categorie_id: 'c-nue' }), piece({ id: 'y', facture_id: null, categorie_id: 'c-nue' })], categories: [SANS_COMPTE] }
    expect(nb(d, 'comptes-manquants', new Set(['f1']))).toBe(1)
    expect(nb(d, 'postes-manquants', new Set(['f1']))).toBe(1)
  })
})

// LE PONT PAR RÉGIME (ligne 28.65, étape VF6e ; lib/ventesJumelles.ts) : la vente comptée deux fois se juge par le régime de
// sa facture ; dans un dossier basculé, la pièce que le pont rattache sans désignation est à désigner ; et une vente déclarée
// hors des factures dont le TTC est celui d'une facture source sans exemplaire validé se vérifie (VF6-Q4). Le dossier a
// basculé quand il lit ses ventes facturées (`ventesFacturees` non nulle, lue ou non). Données FICTIVES.
describe('pointsDeLaChecklist : le pont par régime (VF6e)', () => {
  const piece = (o: Partial<Piece>): Piece => ({
    id: 'x', dossier_id: 'd1', uploaded_by: null, source: 'superpdp', storage_path: 'd1/x.pdf', nom_fichier: 'x.pdf', storage_hash: null,
    date_piece: '2026-04-02', tiers: 'Client fictif', montant_ht: 300, montant_tva: 60, montant_ttc: 360, devise: 'EUR', montant_devise: null,
    taux_change: null, conversion_source: null, categorie_id: null, sous_dossier_id: null, type_piece: 'vente', statut: 'a_valider',
    notes: null, confiance: null, superpdp_invoice_id: null, flux_hote: null, flux_id: null, lisible_path: null, identite_numero: null,
    identite_siren_vendeur: null, identite_date: null, identite_nature: null, facture_id: null, vente_hors_des_factures: false,
    created_at: '2026-04-03T09:00:00Z', updated_at: '2026-04-03T09:00:00Z', ...o,
  })
  const facture = (o: Partial<DonneesDeLaChecklist['facturesEmises'][number]> = {}): DonneesDeLaChecklist['facturesEmises'][number] => ({
    id: 'fs', dossier_id: 'd1', statut: 'validee', type: 'facture', numero: 'F2026-0021', date_emission: '2026-04-02',
    emetteur_siret: '12345678900012', superpdp_invoice_id: 21, montant_ttc: 360, ...o,
  })
  const FACTURES = [facture(), facture({ id: 'fa', numero: 'F2026-0003', superpdp_invoice_id: 3, date_emission: '2026-02-01' })]
  const BASCULE = { ventesFacturees: { dossierId: 'd1', etat: 'incomplete' as const, motif: 'lecture fictive' }, facturesSources: new Set(['fs']) }
  const points = (d: Partial<DonneesDeLaChecklist>) => pointsDeLaChecklist(donnees({ facturesEmises: FACTURES, ...d }), CONTEXTE).tousLesPointsATraiter
  const point = (d: Partial<DonneesDeLaChecklist>, id: string) => points(d).find((p) => p.id === id)

  it('deux exemplaires désignés d’une facture source ne sont pas une vente comptée deux fois ; une pièce validée non désignée, si', () => {
    const exemplaires = [piece({ id: 'p1', statut: 'validee', superpdp_invoice_id: 21, facture_id: 'fs' }), piece({ id: 'p2', statut: 'validee', facture_id: 'fs' })]
    expect(point({ ...BASCULE, piecesValidees: exemplaires }, 'ventes-en-double')?.nb).toBe(0)
    // Le régime d'hier, sur les mêmes pièces : comptée deux fois.
    expect(point({ piecesValidees: exemplaires }, 'ventes-en-double')?.nb).toBe(1)
    const validee = [piece({ id: 'p1', statut: 'validee', superpdp_invoice_id: 21, nom_fichier: 'original-0021.xml' })]
    expect(point({ ...BASCULE, piecesValidees: validee }, 'ventes-en-double')).toMatchObject({
      nb: 1, severite: 'erreur', detail: expect.stringContaining('F2026-0021, source de sa vente, et « original-0021.xml ».') as unknown as string,
    })
  })

  it('« exemplaires-a-designer » : dans un dossier basculé, la pièce que le pont rattache sans désignation, en attention', () => {
    const d = {
      piecesAValider: [piece({ id: 'p1', superpdp_invoice_id: 21, nom_fichier: 'original-0021.xml' }), piece({ id: 'p2', facture_id: 'fs' })],
      piecesValidees: [piece({ id: 'a1', statut: 'validee', superpdp_invoice_id: 3, nom_fichier: 'facture-0003.pdf' })],
    }
    expect(point({ ...BASCULE, ...d }, 'exemplaires-a-designer')).toEqual({
      id: 'exemplaires-a-designer',
      label: 'pièce(s) de vente que le pont rattache à une facture émise, à désigner exemplaire de cette facture',
      action: 'Désigner ces pièces', nb: 2, cible: 'pieces', severite: 'attention',
      detail: '« facture-0003.pdf » : F2026-0003. « original-0021.xml » : F2026-0021. Dans ce dossier, une pièce de vente ne se '
        + 'valide que désignée exemplaire de la facture que le pont prouve : sa fiche, dans Justificatifs, la désigne.',
    })
    // Hors d'un dossier basculé : rien.
    expect(point(d, 'exemplaires-a-designer')?.nb).toBe(0)
    // La jumelle VALIDÉE d'une facture source, sans désignation : comptée deux fois, en erreur — pas « à désigner » aussi.
    const validee = { piecesValidees: [piece({ id: 'p1', statut: 'validee', superpdp_invoice_id: 21 })] }
    expect(point({ ...BASCULE, ...validee }, 'ventes-en-double')?.nb).toBe(1)
    expect(point({ ...BASCULE, ...validee }, 'exemplaires-a-designer')?.nb).toBe(0)
    // Pièces, factures ou transmissions lues en partie : le point se tait.
    expect(point({ ...BASCULE, ...d, jumellesPartielles: true }, 'exemplaires-a-designer')?.nb).toBe(0)
  })

  it('« ventes-hors-factures-a-verifier » : une pièce déclarée du montant d’une facture source sans exemplaire validé, en attention', () => {
    const declaree = piece({ id: 'pd', statut: 'validee', vente_hors_des_factures: true, nom_fichier: 'formation.pdf', date_piece: '2026-06-30' })
    const p = point({ ...BASCULE, piecesValidees: [declaree] }, 'ventes-hors-factures-a-verifier')
    expect(p).toMatchObject({
      label: 'pièce(s) déclarée(s) vente hors des factures dont le montant est celui d’une facture source sans exemplaire validé',
      action: 'Vérifier ces pièces', nb: 1, cible: 'pieces', severite: 'attention',
    })
    expect(p?.detail?.replace(/\s/g, ' ')).toContain('« formation.pdf », 360,00 € : F2026-0021.')
    // Son exemplaire validé, ailleurs : rien à vérifier.
    expect(point({ ...BASCULE, piecesValidees: [declaree, piece({ id: 'ex', statut: 'validee', facture_id: 'fs' })] }, 'ventes-hors-factures-a-verifier')?.nb).toBe(0)
    // Lue en partie : le point se tait.
    expect(point({ ...BASCULE, piecesValidees: [declaree], jumellesPartielles: true }, 'ventes-hors-factures-a-verifier')?.nb).toBe(0)
    // Sans facture source : rien.
    expect(point({ piecesValidees: [declaree] }, 'ventes-hors-factures-a-verifier')?.nb).toBe(0)
  })
})

// L'OUVERTURE DE L'EXERCICE QUI SUIT LE DERNIER VALIDÉ, CONFRONTÉE À LA CLÔTURE DU PRÉCÉDENT (O33-Q3) : le même calcul que
// l'onglet Bilan et le préalable de la validation (`ouverture-en-ecart`, O33-Q1, prealablesValidation.test.ts), dit AVANT le geste
// de validation. Le dossier fictif du préalable : 2024 validé, l'apport de l'exploitant (1 000 € en banque face au 108), dont la
// clôture, telle que le report la verse, est 512000 1 000 D et 101000 1 000 C (PCG, art. 1211-10).
describe('pointsDeLaChecklist : l’ouverture confrontée à la clôture du précédent (O33-Q3)', () => {
  const ecriture = (id: string, date: string, compte: string, sens: 'debit' | 'credit'): EcritureBrouillon => ({
    id, dossier_id: 'd1', piece_id: null, ligne_bancaire_id: null, date, compte, libelle: 'Apport de l’exploitant', montant: 1000, sens,
    statut: 'validee', created_at: `${date}T10:00:00Z`, immobilisation_id: null, vehicule_id: null, declaration_tva_id: null,
    cotisation_id: null, encaissement_id: null, facture_id: null, ...NON_VALIDEE,
  })
  const apport = (annee: number) => [
    ecriture(`a${annee}1`, `${annee}-01-02`, COMPTE_BANQUE, 'debit'), ecriture(`a${annee}2`, `${annee}-01-02`, '108000', 'credit'),
  ]
  const reporte = (id: string, date: string, compte: string, sens: 'debit' | 'credit', montant: number): SoldeReporte => ({
    id, dossier_id: 'd1', date, compte, libelle: `Compte ${compte}`, sens, montant, source_nom: `Exercice ${Number(date.slice(0, 4)) - 1} validé`,
    source_empreinte: 'b'.repeat(64), created_at: `${date}T00:00:00Z`, ...A_NOUVEAU_NON_VALIDE,
  })
  const ouvrir = (date: string, montant: number) => [
    reporte(`s${date}1`, date, COMPTE_BANQUE, 'debit', montant), reporte(`s${date}2`, date, '101000', 'credit', montant),
  ]
  const apresLa2024: Partial<DonneesDeLaChecklist> = { ecritures: apport(2024) }
  const dans = (anneesValidees: number[]): ContexteDeLaChecklist => ({ ...CONTEXTE, anneesValidees })
  const resultat = (d: Partial<DonneesDeLaChecklist>, c: ContexteDeLaChecklist = dans([2024])) => pointsDeLaChecklist(donnees(d), c)
  const point = (d: Partial<DonneesDeLaChecklist>, c?: ContexteDeLaChecklist) =>
    resultat(d, c).tousLesPointsATraiter.find((x) => x.id === 'ouverture-en-ecart')

  // Les mots du préalable (prealablesValidation.test.ts, « un écart d’un centime ») : ils sont écrits une fois, dans
  // lib/ouvertureConfrontee.ts, et dits pareils où l'écart retient la validation et où il se voit avant.
  const MESSAGE = "L'ouverture de l'exercice 2025 ne reprend pas la clôture de 2024 : 2 comptes et 2 rubriques du bilan en écart. "
    + "Le bilan d'ouverture doit correspondre au bilan de clôture de l'exercice précédent (code de commerce, art. L123-19 ; "
    + "PCG, art. 112-2) : l'exercice 2025 ne se valide pas sur cet écart."
  const DETAIL = `En écart : Disponibilités (actif), ouverture ${formatMoney(1000.01)}, clôture de 2024 ${formatMoney(1000)} (compte 512000) ; `
    + `Capital social ou individuel (passif), ouverture ${formatMoney(1000.01)}, clôture de 2024 ${formatMoney(1000)} (compte 101000). `
    + "L'ouverture de 2025 est faite des soldes reportés à la validation de 2024, figés avec lui : l'écart ne vient pas d'une saisie et ne "
    + "se corrige pas dans l'application. Le signaler. Le détail, compte par compte, est dans l'onglet Bilan de l'exercice 2025, à la ligne « Ouverture »."

  it('un écart d’un centime se dit en erreur, avec les mots du préalable, et renvoie à l’onglet Bilan', () => {
    const r = resultat({ ...apresLa2024, soldesReportes: ouvrir('2025-01-01', 1000.01) })
    const p = r.tousLesPointsATraiter.find((x) => x.id === 'ouverture-en-ecart')
    expect(p).toEqual({
      id: 'ouverture-en-ecart', label: MESSAGE, detail: DETAIL, action: 'Voir l’ouverture dans le bilan', nb: 1, cible: 'bilan',
      severite: 'erreur', sansNombre: true,
    })
    // Un point du travail à effectuer, que l'écran montre : il compte, et la révision le range dans l'« ensemble ».
    expect(r.pointsATraiter.map((x) => x.id)).toContain('ouverture-en-ecart')
    expect(r.pointsTravail.map((x) => x.id)).toContain('ouverture-en-ecart')
    expect(r.pointsParametrage.map((x) => x.id)).not.toContain('ouverture-en-ecart')
  })

  it('une ouverture qui reprend la clôture ne dit rien', () => {
    const d = { ...apresLa2024, soldesReportes: ouvrir('2025-01-01', 1000) }
    expect(point(d)?.nb).toBe(0)
    expect(resultat(d).pointsATraiter.map((x) => x.id)).not.toContain('ouverture-en-ecart')
  })

  it('des soldes reportés qui manquent à l’ouverture sont un écart, pas un silence', () => {
    expect(point({ ...apresLa2024, soldesReportes: [] })?.nb).toBe(1)
  })

  it('sans exercice validé, il n’y a rien à confronter : ni écart, ni premier exercice, ni balance reprise', () => {
    const ecart = { ...apresLa2024, soldesReportes: ouvrir('2025-01-01', 1000.01) }
    expect(point(ecart, dans([]))?.nb).toBe(0)
    // 2025 s'ouvre par une balance reprise, contrôlée à son import (O33-Q2, plus tard) : 2024 est tenu dans l'ancien logiciel.
    const reprise: ANouveau[] = [{
      id: 'an1', dossier_id: 'd1', date: '2025-01-01', compte: COMPTE_BANQUE, compte_origine: '512', libelle: 'Banque', sens: 'debit',
      montant: 1000, source_nom: 'balance.csv', source_empreinte: 'a'.repeat(64), ...A_NOUVEAU_NON_VALIDE, created_at: '2025-02-01T00:00:00Z',
    }]
    expect(point({ aNouveaux: reprise, ecritures: [] }, dans([]))?.nb).toBe(0)
  })

  it('ne juge que l’exercice qui suit le dernier validé : l’ouverture d’un exercice déjà validé est figée avec lui', () => {
    // 2023 validé (apport de 1 000 €), 2024 ouvert par 999 € : un écart de 2024 sur 2023, figé quand 2024 a été validé. Les soldes
    // reportés de 2025 reprennent bien la clôture de 2024, restée à 999 €.
    const d = { ecritures: apport(2023), soldesReportes: [...ouvrir('2024-01-01', 999), ...ouvrir('2025-01-01', 999)] }
    expect(point(d, dans([2023, 2024]))?.nb).toBe(0)
    // 2024 pas encore validé : c'est lui que la validation réclame ensuite, et son ouverture ne reprend pas la clôture de 2023.
    expect(point(d, dans([2023]))?.nb).toBe(1)
  })

  it('l’exercice qui suit le dernier validé se juge même s’il n’est pas clos : l’écart se voit dès qu’il existe', () => {
    const d = { ...apresLa2024, soldesReportes: ouvrir('2025-01-01', 1000.01) }
    expect(point(d, { ...dans([2024]), anneeCourante: 2025, aujourdHui: '2025-06-15' })?.nb).toBe(1)
  })

  it('se tait sur une lecture partielle — et ne dit jamais « aucun écart » de ce qu’il n’a pas lu en entier', () => {
    const d = { ...apresLa2024, soldesReportes: ouvrir('2025-01-01', 1000.01) }
    expect(point({ ...d, entreesDeLOuvertureIncompletes: 'lecture interrompue après 500 ligne(s) : permission denied' })?.nb).toBe(0)
    expect(point(d)?.nb).toBe(1)
  })

  it('un 401 qui porte deux fournisseurs, une créance et une dette, concorde : les pièces des deux piles sont celles du préalable', () => {
    // Une société en engagement. 401 : Alpha payé 150 pour 100 (50 D, une créance), Beta 300 non payé (300 C), l'une des pièces
    // validée et l'autre à valider : les deux piles sont données à la confrontation, comme au préalable de la validation (le tiers
    // d'une pièce ne change ni un compte ni une rubrique en écart, mais l'entrée est celle de l'onglet Bilan).
    const societe = { mode: 'engagement' as const, compteNotesDeFrais: '455000', plan: PLAN_PAR_DEFAUT }
    const pieceDe = (id: string, tiers: string, statut: 'validee' | 'a_valider'): Piece => ({
      id, dossier_id: 'd1', uploaded_by: null, source: 'upload', storage_path: `d1/${id}.pdf`, nom_fichier: `${id}.pdf`, storage_hash: null,
      date_piece: '2025-02-01', tiers, montant_ht: null, montant_tva: null, montant_ttc: 100, devise: 'EUR', montant_devise: null,
      taux_change: null, conversion_source: null, categorie_id: null, sous_dossier_id: null, type_piece: 'achat', statut, notes: null,
      confiance: null, superpdp_invoice_id: null, flux_hote: null, flux_id: null, lisible_path: null, identite_numero: null,
      identite_siren_vendeur: null, identite_date: null, identite_nature: null, facture_id: null, vente_hors_des_factures: false, created_at: '2025-02-01T09:00:00Z',
      updated_at: '2025-02-01T09:00:00Z',
    })
    const ligne = (id: string, date: string, compte: string, sens: 'debit' | 'credit', montant: number, pieceId: string | null = null) =>
      ({ ...ecriture(id, date, compte, sens), montant, piece_id: pieceId })
    const ecritures = [
      ligne('b1', '2025-01-02', COMPTE_BANQUE, 'debit', 1000), ligne('b2', '2025-01-02', '101000', 'credit', 1000),
      ligne('c1', '2025-02-01', '606000', 'debit', 100, 'pa'), ligne('c2', '2025-02-01', '401000', 'credit', 100, 'pa'),
      ligne('c3', '2025-02-15', '401000', 'debit', 150, 'pa'), ligne('c4', '2025-02-15', COMPTE_BANQUE, 'credit', 150, 'pa'),
      ligne('c5', '2025-03-01', '606000', 'debit', 300, 'pb'), ligne('c6', '2025-03-01', '401000', 'credit', 300, 'pb'),
    ]
    const d = {
      ecritures, piecesValidees: [pieceDe('pa', 'Alpha Essai', 'validee')], piecesAValider: [pieceDe('pb', 'Beta Essai', 'a_valider')],
      soldesReportes: [
        reporte('t1', '2026-01-01', '101000', 'credit', 1000), reporte('t2', '2026-01-01', '129000', 'debit', 400),
        reporte('t3', '2026-01-01', '401000', 'credit', 250), reporte('t4', '2026-01-01', COMPTE_BANQUE, 'debit', 850),
      ],
    }
    const contexte = { ...dans([2025]), modele: societe, anneeCourante: 2027, aujourdHui: '2027-03-15' }
    expect(point(d, contexte)?.nb).toBe(0)
  })

  it('N−1 ouvert par une balance reprise : sa clôture part de la reprise, que la Vue d’ensemble lit', () => {
    // 2024 s'ouvre par la balance reprise du 1er janvier (1 000 € en banque face au capital), sans autre écriture, et 2024 est
    // validé : sa clôture est la reprise, et les soldes reportés de 2025 la reprennent. Sans la reprise, 2024 serait un exercice
    // sans ouverture ni mouvement, et 2025 s'ouvrirait sur 1 000 € que rien ne précède.
    const ligne = (id: string, compte: string, sens: 'debit' | 'credit'): ANouveau => ({
      id, dossier_id: 'd1', date: '2024-01-01', compte, compte_origine: compte.slice(0, 3), libelle: `Compte ${compte}`, sens, montant: 1000,
      source_nom: 'balance.csv', source_empreinte: 'a'.repeat(64), ...A_NOUVEAU_NON_VALIDE, created_at: '2024-02-01T00:00:00Z',
    })
    const reprise = [ligne('r1', COMPTE_BANQUE, 'debit'), ligne('r2', '101000', 'credit')]
    expect(point({ aNouveaux: reprise, soldesReportes: ouvrir('2025-01-01', 1000) })?.nb).toBe(0)
    expect(point({ aNouveaux: reprise, soldesReportes: ouvrir('2025-01-01', 1000.01) })?.nb).toBe(1)
  })

  it('juge sur le modèle du dossier : en engagement, la perte d’une société reste au 129000', () => {
    // La clôture de 2024 d'une société en engagement : un achat de 120 € à crédit, donc une perte de 120 € et une dette de 120 €.
    const engagement = { mode: 'engagement' as const, compteNotesDeFrais: '455000', plan: PLAN_PAR_DEFAUT }
    const achat = [
      { ...ecriture('x1', '2024-06-01', '606100', 'debit'), montant: 120 }, { ...ecriture('x2', '2024-06-01', '401000', 'credit'), montant: 120 },
    ]
    const juste = [
      reporte('s1', '2025-01-01', '129000', 'debit', 120), reporte('s2', '2025-01-01', '401000', 'credit', 120),
    ]
    expect(point({ ecritures: achat, soldesReportes: juste }, { ...dans([2024]), modele: engagement })?.nb).toBe(0)
    // La même ouverture, jugée comme celle d'une entreprise individuelle (trésorerie) : la perte irait au capital, 101000.
    expect(point({ ecritures: achat, soldesReportes: juste })?.nb).toBe(1)
  })
})

// LA CAISSE DANS LA VUE D'ENSEMBLE (ligne 26.6, étape C3b ; lib/controlesDeLaCaisse.ts) : quatre points, qui ne paraissent que
// sur une caisse lue — absente (le drapeau baissé), la liste est celle d'hier, point pour point. Chacun dans ses deux sens,
// tu sur une lecture partielle. Des jeux FICTIFS.
describe('pointsDeLaChecklist — la caisse (étape C3b)', () => {
  const HONORAIRES: Categorie = {
    id: 'k-hono', dossier_id: 'd1', code: 'honoraires', libelle: 'Honoraires', compte_comptable: '706000', poste_2035: 'Recettes encaissées',
    ordre: 1, created_at: '2026-01-01T00:00:00Z',
  } as Categorie
  const operation = (o: Partial<OperationCaisse>): OperationCaisse => ({
    id: 'o', dossier_id: 'd1', genre: 'apport', date: '2026-03-02', montant: 50, categorie_id: null, taux_tva: null,
    encaissements_du_jour: null, piece_id: null, origine: 'cabinet', remplace_id: null, cree_le: '2026-03-02T18:00:00Z',
    cree_par: null, retire_le: null, retire_par: null, ...o,
  })
  const lignesDe = (o: OperationCaisse): EcritureBrouillon[] => ecritureDeLOperation({
    genre: o.genre as 'apport', date: o.date, montant: o.montant, taux_tva: null,
    categorie: o.categorie_id ? { libelle: HONORAIRES.libelle, compte_comptable: HONORAIRES.compte_comptable } : null,
  }, CONTEXTE.modele).map((l, i) => ({
    id: `${o.id}-${i}`, dossier_id: 'd1', piece_id: null, ligne_bancaire_id: null, date: o.date, compte: l.compte, libelle: l.libelle,
    montant: l.montant, sens: l.sens, statut: 'proposee', created_at: '2026-03-02T18:00:00Z', immobilisation_id: null, vehicule_id: null,
    declaration_tva_id: null, cotisation_id: null, encaissement_id: null, facture_id: null, ...NON_VALIDEE, operation_caisse_id: o.id,
  }))
  const caisseLue = (operations: OperationCaisse[], o: Partial<CaisseLue> = {}): CaisseLue =>
    ({ dossierId: 'd1', enBase: true, lignes: operations, complete: true, motif: null, ...o })
  const A = operation({ id: 'a1', montant: 50 })
  const IDS = ['caisse-a-reprendre', 'caisse-negative', 'recettes-de-caisse-a-revoir', 'versements-especes-en-recette']
  const tous = (d: Partial<DonneesDeLaChecklist>, c: ContexteDeLaChecklist = CONTEXTE) => pointsDeLaChecklist(donnees(d), c).tousLesPointsATraiter
  const nb = (d: Partial<DonneesDeLaChecklist>, id: string, c: ContexteDeLaChecklist = CONTEXTE) => tous(d, c).find((p) => p.id === id)?.nb

  it('NEUTRE : la caisse absente n’ajoute aucun point — la liste est celle d’hier, au caractère près', () => {
    const avant = tous({ lignes: [ligne({ statut: 'non_rapprochee' })] })
    expect(avant.some((p) => IDS.includes(p.id))).toBe(false)
    // Lue, les quatre paraissent, à zéro quand tout tient — et les autres points ne changent pas d'un caractère.
    const apres = tous({ lignes: [ligne({ statut: 'non_rapprochee' })], caisse: caisseLue([]) })
    expect(apres.filter((p) => IDS.includes(p.id)).map((p) => [p.id, p.nb, p.severite])).toEqual([
      ['caisse-a-reprendre', 0, 'erreur'], ['caisse-negative', 0, 'erreur'], ['recettes-de-caisse-a-revoir', 0, 'erreur'],
      ['versements-especes-en-recette', 0, 'attention'],
    ])
    expect(apres.filter((p) => !IDS.includes(p.id))).toEqual(avant)
  })

  // L'ÉTAPE C4 : le point « postes-manquants » compte la catégorie sans poste 2035 qu'une recette de caisse range — Clôture la
  // compte déjà (`recettesDeCaisseSansPoste`) : la 2035 ne la compterait nulle part, et la Vue d'ensemble se taisait.
  it('postes-manquants : la catégorie sans poste d’une recette de caisse compte — une seule fois, comme celle d’un mouvement', () => {
    const sansPoste: Categorie = { ...HONORAIRES, poste_2035: null }
    const recette = operation({ id: 'r1', genre: 'recette', montant: 85, categorie_id: sansPoste.id, encaissements_du_jour: [] })
    const autre = operation({ id: 'r2', genre: 'recette', date: '2026-03-03', montant: 40, categorie_id: sansPoste.id, encaissements_du_jour: [] })
    const lue = (operations: OperationCaisse[]) => ({ categories: [sansPoste], caisse: caisseLue(operations) })
    expect(nb(lue([recette]), 'postes-manquants')).toBe(1)
    expect(nb(lue([recette, autre]), 'postes-manquants')).toBe(1)
    // Un poste renseigné, un apport sans catégorie, une recette retirée ou remplacée : rien à compléter.
    expect(nb({ categories: [HONORAIRES], caisse: caisseLue([recette]) }, 'postes-manquants')).toBe(0)
    expect(nb(lue([A]), 'postes-manquants')).toBe(0)
    expect(nb(lue([{ ...recette, retire_le: '2026-03-04T08:00:00Z' }]), 'postes-manquants')).toBe(0)
    expect(nb(lue([{ ...recette, retire_le: '2026-03-04T08:00:00Z' }, { ...autre, remplace_id: 'r1' }]), 'postes-manquants')).toBe(1)
  })

  it('postes-manquants, NEUTRE : la caisse absente, ou lue en partie, laisse le point tel qu’il était', () => {
    const sansPoste: Categorie = { ...HONORAIRES, poste_2035: null }
    const recette = operation({ id: 'r1', genre: 'recette', montant: 85, categorie_id: sansPoste.id, encaissements_du_jour: [] })
    expect(nb({ categories: [sansPoste] }, 'postes-manquants')).toBe(0)
    expect(nb({ categories: [sansPoste], caisse: caisseLue([recette], { complete: false, motif: '500 lues sur 900' }) }, 'postes-manquants')).toBe(0)
  })

  it('caisse-a-reprendre : l’écriture manque ; à jour, rien ; ce que la frontière fige, rien', () => {
    expect(nb({ caisse: caisseLue([A]), ecritures: lignesDe(A) }, 'caisse-a-reprendre')).toBe(0)
    const p = tous({ caisse: caisseLue([A]) }).find((x) => x.id === 'caisse-a-reprendre')!
    expect([p.nb, p.cible, p.severite]).toEqual([1, 'caisse', 'erreur'])
    expect(p.detail!.replace(/[\u00a0\u202f]/g, ' ')).toBe('le 02/03/2026, apport de 50,00 € (écriture absente).')
    expect(nb({ caisse: caisseLue([A]) }, 'caisse-a-reprendre', { ...CONTEXTE, frontiere: '2026-12-31' })).toBe(0)
  })

  it('caisse-negative : le jour et le solde, un point qui ne compte rien', () => {
    const P = operation({ id: 'p1', genre: 'prelevement', date: '2026-03-05', montant: 80 })
    const p = tous({ caisse: caisseLue([A, P]), ecritures: [...lignesDe(A), ...lignesDe(P)] }).find((x) => x.id === 'caisse-negative')!
    expect([p.nb, p.sansNombre, p.severite]).toEqual([1, true, 'erreur'])
    expect(p.label.replace(/[\u00a0\u202f]/g, ' ')).toBe('La caisse est négative le 05/03/2026 (−30,00 €) — son solde est débiteur ou nul')
    expect(nb({ caisse: caisseLue([A, { ...P, montant: 50 }]) }, 'caisse-negative')).toBe(0)
  })

  it('recettes-de-caisse-a-revoir : un encaissement en espèces de son jour enregistré depuis, dans un dossier basculé', () => {
    const R = operation({ id: 'r1', genre: 'recette', date: '2026-03-12', montant: 120, categorie_id: HONORAIRES.id, encaissements_du_jour: [] })
    const ventes = (encaissements: unknown[]): LectureDesVentesDuReleve => ({
      dossierId: 'd1', etat: 'lue',
      sources: { dossierId: 'd1', factures: [{ id: 'f1', numero: 'F2026-0012', source_de_la_vente: true }], encaissements, mouvements: [], exemplaires: [] },
    } as unknown as LectureDesVentesDuReleve)
    const especes = { id: 'e1', facture_id: 'f1', date_encaissement: '2026-03-12', montant: 30, moyen: 'especes', ligne_bancaire_id: null, annule_id: null, retire_le: null }
    const d = { caisse: caisseLue([R]), categories: [HONORAIRES], ecritures: lignesDe(R) }
    const p = tous({ ...d, ventesFacturees: ventes([especes]) }).find((x) => x.id === 'recettes-de-caisse-a-revoir')!
    expect(p.nb).toBe(1)
    expect(p.detail!.replace(/[\u00a0\u202f]/g, ' ')).toBe('le 12/03/2026, recette de 120,00 € (F2026-0012).')
    expect(nb({ ...d, ventesFacturees: ventes([]) }, 'recettes-de-caisse-a-revoir')).toBe(0)
    // Les ventes facturées lues en partie : ce point et la caisse négative se taisent, sous leur bandeau ; « à reprendre » reste.
    const partielles: LectureDesVentesDuReleve = { dossierId: 'd1', etat: 'incomplete', motif: 'les encaissements' }
    expect(nb({ ...d, ventesFacturees: partielles }, 'recettes-de-caisse-a-revoir')).toBe(0)
    expect(nb({ caisse: caisseLue([A]), ventesFacturees: partielles }, 'caisse-a-reprendre')).toBe(1)
    // Même une recette qui a reconnu des espèces, que la lecture partielle ne montre plus ; même une caisse négative.
    const reconnue = { ...R, encaissements_du_jour: ['e1'] }
    expect(nb({ caisse: caisseLue([reconnue]), categories: [HONORAIRES], ecritures: lignesDe(reconnue), ventesFacturees: partielles }, 'recettes-de-caisse-a-revoir')).toBe(0)
    expect(nb({ caisse: caisseLue([reconnue]), categories: [HONORAIRES], ecritures: lignesDe(reconnue), ventesFacturees: ventes([]) }, 'recettes-de-caisse-a-revoir')).toBe(1)
    const P = operation({ id: 'p1', genre: 'prelevement', date: '2026-03-05', montant: 80 })
    expect(nb({ caisse: caisseLue([A, P]), ecritures: [...lignesDe(A), ...lignesDe(P)], ventesFacturees: partielles }, 'caisse-negative')).toBe(0)
    expect(nb({ caisse: caisseLue([A, P]), ecritures: [...lignesDe(A), ...lignesDe(P)], ventesFacturees: ventes([]) }, 'caisse-negative')).toBe(1)
  })

  it('versements-especes-en-recette : un crédit libellé « VERSEMENT ESPECES » rangé en recette, dans un dossier qui tient une caisse', () => {
    const versement = ligne({ id: 'v1', date: '2026-03-14', montant: 400, libelle: 'VERSEMENT ESPECES', statut: 'rapprochee', categorie_id: HONORAIRES.id })
    const d = { categories: [HONORAIRES], lignes: [versement], caisse: caisseLue([A]), ecritures: lignesDe(A) }
    const p = tous(d).find((x) => x.id === 'versements-especes-en-recette')!
    expect([p.nb, p.cible, p.severite]).toEqual([1, 'banque', 'attention'])
    expect(p.detail!.replace(/[\u00a0\u202f]/g, ' ')).toBe('Dans Banque, filtre « Rapprochés » : le 14/03/2026, 400,00 € (VERSEMENT ESPECES). Un versement se remet à '
      + 'traiter, puis se classe sur la caisse.')
    // Sans opération vivante, aucune caisse : le symptôme ne se dit pas.
    expect(nb({ ...d, caisse: caisseLue([{ ...A, retire_le: '2026-03-03T10:00:00Z' }]), ecritures: [] }, 'versements-especes-en-recette')).toBe(0)
    expect(nb({ ...d, lignes: [{ ...versement, libelle: 'VIR CPAM', libelle_brut: 'VIR CPAM' }] }, 'versements-especes-en-recette')).toBe(0)
  })

  it('lue en partie, ou une de ses entrées : les quatre se taisent', () => {
    const incompletes = tous({ caisse: caisseLue([A], { complete: false, motif: 'coupée' }) })
    expect(incompletes.some((p) => IDS.includes(p.id))).toBe(false)
    const entree = tous({ caisse: caisseLue([A]), entreesDeLaCaisseIncompletes: 'le brouillon : 1 000 lues sur 1 200' })
    expect(entree.filter((p) => IDS.includes(p.id)).map((p) => p.nb)).toEqual([0, 0, 0, 0])
  })
})
