import { describe, expect, it } from 'vitest'
import {
  bilanDeLExercice, regleDuCompte, RUBRIQUES_ACTIF, RUBRIQUES_PASSIF, type BilanDeLExercice, type Destination,
  type EntreesDuBilan, type IdRubriqueActif, type IdRubriquePassif,
} from './bilan'
import type { ModeleComptable } from './engagement'
import type { ANouveau, Categorie, EcritureBrouillon, Piece, SoldeReporte } from './types'
import { A_NOUVEAU_NON_VALIDE, NON_VALIDEE } from '../test/ecritures'

// LE BILAN SE CONFRONTE À DES BILANS CALCULÉS À LA MAIN, jamais au module lui-même : chaque cas pose des écritures, fait
// le calcul en commentaire, compte par compte, et attend des montants écrits en toutes lettres, en centimes. Le passage
// des comptes aux rubriques est confronté à une table recopiée des libellés du 2033-A-SD 2026 et du PCG, pas à la table
// du module.

const SOCIETE: ModeleComptable = { mode: 'engagement', compteNotesDeFrais: '455000' }
const EXPLOITANT_BNC: ModeleComptable = { mode: 'tresorerie', compteNotesDeFrais: '455000' }
const EXPLOITANT_BIC: ModeleComptable = { mode: 'engagement', compteNotesDeFrais: '108000' }

let numero = 0
function ecriture(o: Partial<EcritureBrouillon>): EcritureBrouillon {
  numero += 1
  return {
    id: `e${String(numero).padStart(5, '0')}`, dossier_id: 'd1', piece_id: null, ligne_bancaire_id: null,
    date: '2026-06-30', compte: '512000', libelle: 'Écriture d’essai', montant: 0, sens: 'debit', statut: 'proposee',
    created_at: '2026-06-30T10:00:00Z', immobilisation_id: null, vehicule_id: null, declaration_tva_id: null, cotisation_id: null,
    ...NON_VALIDEE, ...o,
  }
}

type Ligne = [compte: string, sens: 'D' | 'C', euros: number]

// Une écriture du brouillon, ligne à ligne : la date, ses lignes, et la pièce (et le mouvement) qu'elle porte.
function ecrire(date: string, lignes: Ligne[], piece: { piece_id?: string; ligne_bancaire_id?: string } = {}): EcritureBrouillon[] {
  return lignes.map(([compte, sens, montant]) => ecriture({
    date, compte, montant, sens: sens === 'D' ? 'debit' : 'credit',
    piece_id: piece.piece_id ?? null, ligne_bancaire_id: piece.ligne_bancaire_id ?? null,
  }))
}

function aNouveau(o: Partial<ANouveau>): ANouveau {
  numero += 1
  return {
    id: `a${numero}`, dossier_id: 'd1', date: '2026-01-01', compte: '512000', compte_origine: '512000', libelle: 'Banque',
    sens: 'debit', montant: 0, source_nom: 'balance-fictive.csv', source_empreinte: 'empreinte-fictive',
    created_at: '2026-02-01T10:00:00Z', ...A_NOUVEAU_NON_VALIDE, ...o,
  }
}

function reprise(date: string, lignes: Ligne[]): ANouveau[] {
  return lignes.map(([compte, sens, montant]) => aNouveau({ date, compte, compte_origine: compte, sens: sens === 'D' ? 'debit' : 'credit', montant }))
}

function soldeReporte(o: Partial<SoldeReporte>): SoldeReporte {
  numero += 1
  return {
    id: `s${numero}`, dossier_id: 'd1', date: '2026-01-01', compte: '512000', libelle: 'Banque', sens: 'debit', montant: 0,
    source_nom: 'Exercice 2025 validé', source_empreinte: 'empreinte-2025', created_at: '2026-02-01T10:00:00Z',
    compte_lib: null, ecriture_lib: null, ...o,
  }
}

function reportes(date: string, lignes: Ligne[]): SoldeReporte[] {
  return lignes.map(([compte, sens, montant]) => soldeReporte({ date, compte, sens: sens === 'D' ? 'debit' : 'credit', montant }))
}

function piece(id: string, tiers: string | null): Pick<Piece, 'id' | 'tiers'> {
  return { id, tiers }
}

function categorie(o: Partial<Categorie>): Categorie {
  return { id: 'cat', dossier_id: null, code: 'achats', libelle: 'Achats', ordre: 1, compte_comptable: '606000', poste_2035: null, ...o }
}

function entrees(o: Partial<EntreesDuBilan>): EntreesDuBilan {
  return {
    exercice: 2026, ecritures: [], categories: [], reprise: [], reportes: [], anneesValidees: [], pieces: [],
    modele: SOCIETE, aujourdHui: '2027-03-15', ...o,
  }
}

type Etabli = Extract<BilanDeLExercice, { etat: 'etabli' }>

function etabli(b: BilanDeLExercice): Etabli {
  if (b.etat !== 'etabli') throw new Error(`bilan non établi : ${b.motif.texte}`)
  return b
}

// Ce qui porte un montant : [rubrique, brut, amortissements, net] à l'actif, [rubrique, montant] au passif.
function nonNuls(b: Etabli) {
  return {
    actif: b.actif.filter((r) => r.brut !== 0 || r.amortissements !== 0).map((r) => [r.id, r.brut, r.amortissements, r.net]),
    passif: b.passif.filter((r) => r.montant !== 0).map((r) => [r.id, r.montant]),
  }
}

const actifDe = (b: Etabli, id: IdRubriqueActif) => b.actif.find((r) => r.id === id)!
const passifDe = (b: Etabli, id: IdRubriquePassif) => b.passif.find((r) => r.id === id)!
const codes = (b: Etabli) => b.points.map((p) => p.code)

describe('bilanDeLExercice — des bilans calculés à la main', () => {
  it('une société en engagement, premier exercice : clients, TVA, banque, capital et bénéfice', () => {
    const ecritures = [
      ...ecrire('2026-01-02', [['512000', 'D', 10_000], ['101000', 'C', 10_000]]),
      ...ecrire('2026-02-10', [['411000', 'D', 1_200], ['706000', 'C', 1_000], ['445710', 'C', 200]], { piece_id: 'p1' }),
      ...ecrire('2026-03-15', [['512000', 'D', 700], ['411000', 'C', 700]], { piece_id: 'p1', ligne_bancaire_id: 'm1' }),
      ...ecrire('2026-03-20', [['606000', 'D', 500], ['445660', 'D', 100], ['401000', 'C', 600]], { piece_id: 'p2' }),
      ...ecrire('2026-04-05', [['401000', 'D', 600], ['512000', 'C', 600]], { piece_id: 'p2', ligne_bancaire_id: 'm2' }),
    ]
    // 512 : 10 000 + 700 − 600 = 10 100 D. 411 : 1 200 − 700 = 500 D. 445660 : 100 D. 401 : soldé.
    // 101 : 10 000 C. 445710 : 200 C. Résultat : 1 000 − 500 = 500.
    // Actif : clients 500, autres créances 100, disponibilités 10 100 = 10 700.
    // Passif : capital 10 000, résultat 500, dettes fiscales et sociales 200 = 10 700.
    const b = etabli(bilanDeLExercice(entrees({ ecritures, pieces: [piece('p1', 'Alphamed'), piece('p2', 'Bravopapier')] })))
    expect(nonNuls(b)).toEqual({
      actif: [['clients', 50_000, 0, 50_000], ['autres-creances', 10_000, 0, 10_000], ['disponibilites', 1_010_000, 0, 1_010_000]],
      passif: [['capital', 1_000_000], ['resultat', 50_000], ['dettes-fiscales-sociales', 20_000]],
    })
    expect(b.resultat).toBe(50_000)
    expect(b.totauxActif).toEqual({
      immobilise: { brut: 0, amortissements: 0, net: 0 },
      circulant: { brut: 1_070_000, amortissements: 0, net: 1_070_000 },
      aClasser: 0, brut: 1_070_000, amortissements: 0, net: 1_070_000,
    })
    expect(b.totauxPassif).toEqual({ capitauxPropres: 1_050_000, provisions: 0, dettes: 20_000, aClasser: 0, total: 1_070_000 })
    expect(b.ecart).toBe(0)
    expect(b.renvois).toEqual({ dontTva: 20_000, dontComptesCourantsDebiteurs: 0 })
    expect(b.individuel).toBe(false)
    expect(b.provisoire).toBe(false)
    expect(b.ouverture).toEqual({ type: 'sans-objet' })
    expect(codes(b)).toEqual(['premier-exercice'])
  })

  it('un emprunt, un véhicule amorti et une perte', () => {
    const ecritures = [
      ...ecrire('2026-01-05', [['512000', 'D', 5_000], ['101000', 'C', 5_000]]),
      ...ecrire('2026-01-10', [['512000', 'D', 20_000], ['164000', 'C', 20_000]], { ligne_bancaire_id: 'm1' }),
      ...ecrire('2026-03-01', [['218200', 'D', 18_000], ['445620', 'D', 3_600], ['404000', 'C', 21_600]], { piece_id: 'p3' }),
      ...ecrire('2026-03-05', [['404000', 'D', 21_600], ['512000', 'C', 21_600]], { piece_id: 'p3', ligne_bancaire_id: 'm2' }),
      ...ecrire('2026-06-30', [['164000', 'D', 1_500], ['661100', 'D', 200], ['616800', 'D', 30], ['512000', 'C', 1_730]], { ligne_bancaire_id: 'm3' }),
      ...ecrire('2026-12-31', [['681100', 'D', 3_000], ['281820', 'C', 3_000]]),
    ]
    // 512 : 5 000 + 20 000 − 21 600 − 1 730 = 1 670 D. 164 : 20 000 − 1 500 = 18 500 C. 218200 : 18 000 D, amorti de
    // 3 000 (281820). 445620 : 3 600 D. 404 : soldé. 101 : 5 000 C. Résultat : −(200 + 30 + 3 000) = −3 230.
    // Actif : corporelles 18 000 − 3 000 = 15 000 ; autres créances 3 600 ; disponibilités 1 670 = 20 270.
    // Passif : capital 5 000 ; résultat −3 230 ; emprunts 18 500 = 20 270.
    const b = etabli(bilanDeLExercice(entrees({ ecritures, pieces: [piece('p3', 'Garagecharlie')] })))
    expect(nonNuls(b)).toEqual({
      actif: [['corporelles', 1_800_000, 300_000, 1_500_000], ['autres-creances', 360_000, 0, 360_000], ['disponibilites', 167_000, 0, 167_000]],
      passif: [['capital', 500_000], ['resultat', -323_000], ['emprunts', 1_850_000]],
    })
    expect(b.resultat).toBe(-323_000)
    expect(b.totauxActif.immobilise).toEqual({ brut: 1_800_000, amortissements: 300_000, net: 1_500_000 })
    expect(b.totauxActif).toMatchObject({ brut: 2_327_000, amortissements: 300_000, net: 2_027_000 })
    expect(b.totauxPassif).toEqual({ capitauxPropres: 177_000, provisions: 0, dettes: 1_850_000, aClasser: 0, total: 2_027_000 })
    expect(b.ecart).toBe(0)
    // L'amortissement est dans la colonne 2 de sa rubrique, et nulle part ailleurs.
    expect(actifDe(b, 'corporelles').contributions.map((c) => [c.compte, c.colonne, c.centimes])).toEqual([
      ['218200', 'brut', 1_800_000], ['281820', 'amortissements', 300_000],
    ])
  })

  it('une banque créditrice, un client créditeur et un fournisseur débiteur : rien ne se compense', () => {
    const ecritures = [
      ...ecrire('2026-02-01', [['411000', 'D', 2_400], ['706000', 'C', 2_000], ['445710', 'C', 400]], { piece_id: 'p4' }),
      ...ecrire('2026-02-10', [['512000', 'D', 300], ['411000', 'C', 300]], { piece_id: 'p5', ligne_bancaire_id: 'm1' }),
      ...ecrire('2026-03-01', [['606000', 'D', 1_000], ['445660', 'D', 200], ['401000', 'C', 1_200]], { piece_id: 'p6' }),
      ...ecrire('2026-03-05', [['401000', 'D', 500], ['512000', 'C', 500]], { piece_id: 'p7', ligne_bancaire_id: 'm2' }),
      ...ecrire('2026-03-10', [['401000', 'D', 1_200], ['512000', 'C', 1_200]], { piece_id: 'p6', ligne_bancaire_id: 'm3' }),
      // Alphamed paie en 2027 : au 31 décembre 2026, il doit encore ses 2 400.
      ...ecrire('2027-01-15', [['512000', 'D', 2_400], ['411000', 'C', 2_400]], { piece_id: 'p4', ligne_bancaire_id: 'm4' }),
    ]
    const pieces = [piece('p4', 'Alphamed'), piece('p5', 'Deltasoin'), piece('p6', 'Bravopapier'), piece('p7', 'Echoprint')]
    // 512 : 300 − 500 − 1 200 = −1 400, une banque CRÉDITRICE : un concours bancaire au passif.
    // 411 : 2 100 D au total, mais Alphamed doit 2 400 et Deltasoin a payé 300 sans facture : 2 400 à l'actif, 300 au passif.
    // 401 : 500 D au total : Bravopapier soldé, Echoprint débiteur de 500 — une créance.
    // Résultat : 2 000 − 1 000 = 1 000.
    // Actif : clients 2 400 ; autres créances 500 + 200 (TVA déductible) = 700 → 3 100.
    // Passif : résultat 1 000 ; emprunts et dettes assimilées 1 400 ; dettes fiscales 400 ; autres dettes 300 → 3 100.
    const b = etabli(bilanDeLExercice(entrees({ ecritures, pieces })))
    expect(nonNuls(b)).toEqual({
      actif: [['clients', 240_000, 0, 240_000], ['autres-creances', 70_000, 0, 70_000]],
      passif: [['resultat', 100_000], ['emprunts', 140_000], ['dettes-fiscales-sociales', 40_000], ['autres-dettes', 30_000]],
    })
    expect(b.ecart).toBe(0)
    expect(b.totauxActif.net).toBe(310_000)
    expect(b.totauxPassif.total).toBe(310_000)
    // Le détail par tiers, de chaque côté : le compte auxiliaire du FEC et son montant dans le sens de la rubrique.
    expect(actifDe(b, 'clients').contributions).toEqual([expect.objectContaining({
      compte: '411000', centimes: 240_000, tiers: [{ auxiliaire: 'CALPHAMED', libelle: 'Alphamed', centimes: 240_000 }],
    })])
    expect(passifDe(b, 'autres-dettes').contributions).toEqual([expect.objectContaining({
      compte: '411000', centimes: 30_000, tiers: [{ auxiliaire: 'CDELTASOIN', libelle: 'Deltasoin', centimes: 30_000 }],
    })])
    expect(actifDe(b, 'autres-creances').contributions.map((c) => [c.compte, c.centimes, c.tiers])).toEqual([
      ['401000', 50_000, [{ auxiliaire: 'FECHOPRINT', libelle: 'Echoprint', centimes: 50_000 }]],
      ['445660', 20_000, null],
    ])
    expect(passifDe(b, 'emprunts').contributions.map((c) => [c.compte, c.centimes, c.inhabituel])).toEqual([['512000', 140_000, false]])
    expect(codes(b)).not.toContain('soldes-inhabituels')
  })

  it('un BNC en trésorerie repris d’un autre logiciel : le compte de l’exploitant et le résultat précédent font le capital', () => {
    const ouverture = reprise('2026-01-01', [['512000', 'D', 11_000], ['101000', 'C', 8_000], ['120000', 'C', 3_000]])
    const ecritures = [
      ...ecrire('2026-01-31', [['512000', 'D', 50_000], ['706000', 'C', 50_000]]),
      ...ecrire('2026-02-28', [['606000', 'D', 12_000], ['512000', 'C', 12_000]]),
      ...ecrire('2026-03-31', [['108000', 'D', 30_000], ['512000', 'C', 30_000]]),
      ...ecrire('2026-05-05', [['646000', 'D', 4_000], ['108000', 'D', 1_000], ['512000', 'C', 5_000]]),
      ...ecrire('2026-06-01', [['218300', 'D', 2_000], ['512000', 'C', 2_000]]),
      ...ecrire('2026-12-31', [['681100', 'D', 400], ['281830', 'C', 400]]),
    ]
    // 512 : 11 000 + 50 000 − 12 000 − 30 000 − 5 000 − 2 000 = 12 000 D. 108 : 31 000 D. 101 : 8 000 C. 120 : 3 000 C.
    // Capital individuel : 8 000 + 3 000 − 31 000 = −20 000. Résultat : 50 000 − 12 000 − 4 000 − 400 = 33 600.
    // Actif : corporelles 2 000 − 400 = 1 600 ; disponibilités 12 000 → 13 600.
    // Passif : capital −20 000 ; résultat 33 600 → 13 600.
    const b = etabli(bilanDeLExercice(entrees({ ecritures, reprise: ouverture, modele: EXPLOITANT_BNC })))
    expect(nonNuls(b)).toEqual({
      actif: [['corporelles', 200_000, 40_000, 160_000], ['disponibilites', 1_200_000, 0, 1_200_000]],
      passif: [['capital', -2_000_000], ['resultat', 3_360_000]],
    })
    expect(b.individuel).toBe(true)
    expect(b.ecart).toBe(0)
    expect(passifDe(b, 'capital').contributions.map((c) => [c.compte, c.centimes, c.inhabituel])).toEqual([
      ['101000', 800_000, false], ['108000', -3_100_000, false], ['120000', 300_000, false],
    ])
    expect(b.ouverture).toEqual({ type: 'reprise', date: '2026-01-01', source: 'balance-fictive.csv' })
    expect(codes(b)).toEqual([])
  })

  it('une société dont l’exercice précédent est validé : le résultat de 2025 attend son affectation, à part', () => {
    const ouverture = reportes('2026-01-01', [['512000', 'D', 4_000], ['101000', 'C', 1_000], ['120000', 'C', 3_000]])
    const ecritures = ecrire('2026-04-01', [['411000', 'D', 1_000], ['706000', 'C', 1_000]], { piece_id: 'p8' })
    // Actif : clients 1 000 ; disponibilités 4 000 → 5 000. Passif : capital 1 000 ; résultat 2025 en attente 3 000 ;
    // résultat 1 000 → 5 000.
    const b = etabli(bilanDeLExercice(entrees({
      ecritures, reportes: ouverture, anneesValidees: [2025], pieces: [piece('p8', 'Foxtrotmed')],
    })))
    expect(nonNuls(b)).toEqual({
      actif: [['clients', 100_000, 0, 100_000], ['disponibilites', 400_000, 0, 400_000]],
      passif: [['capital', 100_000], ['resultat', 100_000], ['resultats-en-attente', 300_000]],
    })
    expect(b.totauxPassif.capitauxPropres).toBe(500_000)
    expect(b.ecart).toBe(0)
    expect(b.ouverture).toEqual({ type: 'report', depuis: 2025, lignes: 3 })
    expect(codes(b)).toEqual(['affectation-non-ecrite'])
    expect(b.points[0].comptes).toEqual(['120000'])
    // Le même report dans une entreprise individuelle irait au capital (PCG, art. 1211-12) — la base ne l'y laisse
    // d'ailleurs jamais : elle verse le résultat au 101000.
    const ei = etabli(bilanDeLExercice(entrees({
      ecritures, reportes: ouverture, anneesValidees: [2025], pieces: [piece('p8', 'Foxtrotmed')], modele: EXPLOITANT_BIC,
    })))
    expect(passifDe(ei, 'capital').montant).toBe(400_000)
    expect(passifDe(ei, 'resultats-en-attente').montant).toBe(0)
    expect(codes(ei)).toEqual([])
  })

  it('un client se lit sur toute sa vie depuis la reprise : une facture de l’an dernier réglée cette année ne le rend pas créditeur', () => {
    // 2025, exercice repris puis validé : l'ouverture porte 900 de clients sans détail, encaissés sans pièce ; Golfmed est
    // facturé 600.
    const ouverture = reprise('2025-01-01', [['411000', 'D', 900], ['512000', 'D', 100], ['101000', 'C', 1_000]])
    // Une écriture de 2024, ANTÉRIEURE à la reprise : son effet est dans la balance reprise, et le détail par tiers ne la
    // compte pas une seconde fois.
    const avantLaReprise = ecrire('2024-06-01', [['411000', 'D', 77], ['706000', 'C', 77]], { piece_id: 'p11' })
    const en2025 = [
      ...ecrire('2025-05-01', [['411000', 'D', 600], ['706000', 'C', 600]], { piece_id: 'p9' }),
      ...ecrire('2025-06-01', [['512000', 'D', 900], ['411000', 'C', 900]], { ligne_bancaire_id: 'm0' }),
    ]
    // Le report que la validation de 2025 a écrit : 411 600 D, 512 1 000 D, 101 1 000 C, résultat 600 au 120.
    const report = reportes('2026-01-01', [['411000', 'D', 600], ['512000', 'D', 1_000], ['101000', 'C', 1_000], ['120000', 'C', 600]])
    // 2026 : Golfmed paie sa facture de 2025, Hotelmed paie 250 sans facture.
    const en2026 = [
      ...ecrire('2026-02-01', [['512000', 'D', 600], ['411000', 'C', 600]], { piece_id: 'p9', ligne_bancaire_id: 'm1' }),
      ...ecrire('2026-03-01', [['512000', 'D', 250], ['411000', 'C', 250]], { piece_id: 'p10', ligne_bancaire_id: 'm2' }),
    ]
    // 411 en 2026 : 600 − 600 − 250 = −250. Depuis la reprise, tiers par tiers : sans détail 900 − 900 = 0, Golfmed
    // 600 − 600 = 0, Hotelmed −250. Le seul solde est celui d'Hotelmed : 250 d'autres dettes, aucun client à l'actif.
    // Lu sur la seule année 2026, Golfmed paraîtrait créditeur de 600 et l'ouverture débitrice de 600 sans détail.
    // Actif : disponibilités 1 000 + 600 + 250 = 1 850. Passif : capital 1 000, résultat 2025 en attente 600, autres
    // dettes 250 → 1 850.
    const entree = entrees({
      ecritures: [...avantLaReprise, ...en2025, ...en2026], reprise: ouverture, reportes: report, anneesValidees: [2025],
      pieces: [piece('p9', 'Golfmed'), piece('p10', 'Hotelmed'), piece('p11', 'Indiamed')],
    })
    const b = etabli(bilanDeLExercice(entree))
    expect(nonNuls(b)).toEqual({
      actif: [['disponibilites', 185_000, 0, 185_000]],
      passif: [['capital', 100_000], ['resultats-en-attente', 60_000], ['autres-dettes', 25_000]],
    })
    expect(passifDe(b, 'autres-dettes').contributions).toEqual([expect.objectContaining({
      compte: '411000', centimes: 25_000, tiers: [{ auxiliaire: 'CHOTELMED', libelle: 'Hotelmed', centimes: 25_000 }],
    })])
    expect(actifDe(b, 'clients').contributions).toEqual([])
    expect(codes(b)).not.toContain('detail-des-tiers')

    // Un report qui ne retrouverait pas le détail (défensif : la validation l'écrit depuis les mêmes écritures) : le
    // compte se présente en entier, du côté de son solde, et le bilan le dit. 411 : 700 − 600 − 250 = −150.
    const faux = reportes('2026-01-01', [['411000', 'D', 700], ['512000', 'D', 1_000], ['101000', 'C', 1_100], ['120000', 'C', 600]])
    const c = etabli(bilanDeLExercice({ ...entree, reportes: faux }))
    expect(passifDe(c, 'autres-dettes').contributions.map((x) => [x.compte, x.centimes, x.tiers])).toEqual([['411000', 15_000, null]])
    expect(c.ecart).toBe(0)
    expect(c.points.find((p) => p.code === 'detail-des-tiers')?.comptes).toEqual(['411000'])
  })

  it('un compte à classer, un compte hors des classes et une écriture déséquilibrée : l’écart se nomme et se décompose', () => {
    const ecritures = [
      ...ecrire('2026-01-02', [['512000', 'D', 2_000], ['104000', 'C', 2_000]]),
      ...ecrire('2026-02-01', [['801000', 'D', 50], ['512000', 'C', 50]]),
      ...ecrire('2026-03-01', [['606000', 'D', 100], ['512000', 'C', 90]]),
      // Un compte hors des classes, mais soldé : il ne porte rien, le bilan n'a rien à en dire.
      ...ecrire('2026-03-02', [['809000', 'D', 5], ['809000', 'C', 5]]),
      ...ecrire('2026-03-03', [['201000', 'D', 25], ['512000', 'C', 25]]),
    ]
    // 512 : 2 000 − 50 − 90 − 25 = 1 835 D. 104 : 2 000 C et 201 : 25 D, que le 2033-A ne nomme pas. 801 : 50 D, hors des
    // classes. Résultat : −100. Actif : 1 835 + 25 à classer = 1 860. Passif : résultat −100 + 2 000 à classer = 1 900.
    // Écart : −40, soit les 10 de plus au débit de l'écriture déséquilibrée moins les 50 que porte le 801.
    const b = etabli(bilanDeLExercice(entrees({ ecritures })))
    expect(nonNuls(b)).toEqual({
      actif: [['disponibilites', 183_500, 0, 183_500], ['a-classer-actif', 2_500, 0, 2_500]],
      passif: [['resultat', -10_000], ['a-classer-passif', 200_000]],
    })
    expect(b.totauxActif).toMatchObject({ aClasser: 2_500, brut: 186_000, net: 186_000 })
    expect(b.totauxPassif.aClasser).toBe(200_000)
    expect(b.ecart).toBe(-4_000)
    expect(codes(b)).toEqual(['desequilibre', 'hors-classes', 'a-classer', 'premier-exercice'])
    const desequilibre = b.points[0]
    expect(desequilibre.texte).toMatch(/^Le bilan ne s’équilibre pas : l’actif est inférieur au passif de 40,00\s€\./)
    expect(desequilibre.texte).toMatch(/10,00\s€ de plus au débit/)
    expect(desequilibre.texte).toMatch(/50,00\s€ au débit/)
    expect(b.points[1].comptes).toEqual(['801000'])
    expect(b.points[2].comptes).toEqual(['104000', '201000'])
    expect(passifDe(b, 'a-classer-passif').contributions[0].raison).toMatch(/Primes liées au capital/)
    expect(actifDe(b, 'a-classer-actif').contributions[0].raison).toMatch(/Frais d’établissement/)
  })

  it('un solde de l’autre sens reste dans sa rubrique, en négatif, et se dit', () => {
    const ecritures = [
      ...ecrire('2026-01-02', [['512000', 'D', 1_000], ['101000', 'C', 1_000]]),
      ...ecrire('2026-02-01', [['606000', 'D', 30], ['531000', 'C', 30]]),
      ...ecrire('2026-12-31', [['281830', 'D', 20], ['781100', 'C', 20]]),
    ]
    // La caisse est créditrice de 30 : elle reste en disponibilités, 1 000 − 30 = 970. L'amortissement est débiteur de
    // 20 : il reste en colonne 2 des corporelles, −20, net +20. Résultat : 20 − 30 = −10.
    // Actif : 20 + 970 = 990. Passif : capital 1 000 − 10 = 990.
    const b = etabli(bilanDeLExercice(entrees({ ecritures })))
    expect(nonNuls(b)).toEqual({
      actif: [['corporelles', 0, -2_000, 2_000], ['disponibilites', 97_000, 0, 97_000]],
      passif: [['capital', 100_000], ['resultat', -1_000]],
    })
    expect(b.ecart).toBe(0)
    const point = b.points.find((p) => p.code === 'soldes-inhabituels')!
    expect(point.comptes).toEqual(['281830', '531000'])
    expect(point.texte).toMatch(/281830 \(20,00\s€ au débit\), 531000 \(30,00\s€ au crédit\)/)
  })

  it('la TVA reste brute, le compte courant d’associé suit son sens, les virements internes se disent', () => {
    const ecritures = [
      ...ecrire('2026-01-02', [['512000', 'D', 3_000], ['455000', 'C', 3_000]]),
      ...ecrire('2026-02-01', [['606000', 'D', 1_000], ['445660', 'D', 300], ['512000', 'C', 1_300]]),
      ...ecrire('2026-03-01', [['512000', 'D', 2_500], ['706000', 'C', 2_000], ['445710', 'C', 500]]),
      ...ecrire('2026-04-01', [['580000', 'D', 400], ['512000', 'C', 400]]),
    ]
    // 512 : 3 000 − 1 300 + 2 500 − 400 = 3 800 D ; 580 : 400 D, des fonds sur un autre compte du professionnel.
    // TVA : 300 déductible à l'actif, 500 collectée au passif — jamais 200 nets. Résultat : 2 000 − 1 000 = 1 000.
    // Actif : autres créances 300 ; disponibilités 3 800 + 400 = 4 200 → 4 500.
    // Passif : résultat 1 000 ; dettes fiscales 500 (dont TVA 500) ; comptes courants d'associés 3 000 → 4 500.
    const b = etabli(bilanDeLExercice(entrees({ ecritures })))
    expect(nonNuls(b)).toEqual({
      actif: [['autres-creances', 30_000, 0, 30_000], ['disponibilites', 420_000, 0, 420_000]],
      passif: [['resultat', 100_000], ['dettes-fiscales-sociales', 50_000], ['comptes-courants', 300_000]],
    })
    expect(b.renvois).toEqual({ dontTva: 50_000, dontComptesCourantsDebiteurs: 0 })
    expect(codes(b)).toContain('virements-internes')
    expect(b.points.find((p) => p.code === 'virements-internes')!.comptes).toEqual(['580000'])

    // Le même associé qui a prélevé plus qu'il n'a apporté : son compte courant DÉBITEUR est une créance, et le renvoi
    // 199 la reprend. 455 : 3 000 − 3 500 = 500 D ; 512 : 3 800 − 3 500 = 300 D.
    // Un compte d'associé qui n'est pas un compte courant (458, opérations faites en commun) débiteur de 10 : une autre
    // créance, hors du renvoi 199. Autres créances : 300 + 500 + 10 = 810 ; disponibilités : 3 800 − 3 500 − 10 + 400 = 690.
    const debiteur = etabli(bilanDeLExercice(entrees({
      ecritures: [
        ...ecritures,
        ...ecrire('2026-05-01', [['455000', 'D', 3_500], ['512000', 'C', 3_500]]),
        ...ecrire('2026-05-02', [['458000', 'D', 10], ['512000', 'C', 10]]),
      ],
    })))
    expect(actifDe(debiteur, 'autres-creances').brut).toBe(81_000)
    expect(actifDe(debiteur, 'disponibilites').brut).toBe(69_000)
    expect(passifDe(debiteur, 'comptes-courants').montant).toBe(0)
    expect(debiteur.renvois).toEqual({ dontTva: 50_000, dontComptesCourantsDebiteurs: 50_000 })
    expect(debiteur.ecart).toBe(0)
  })

  it('un compte d’inventaire repris sans mouvement dans l’exercice se signale', () => {
    const ouverture = reprise('2026-01-01', [['486000', 'D', 300], ['371000', 'D', 1_000], ['512000', 'D', 700], ['101000', 'C', 2_000]])
    // Actif : marchandises 1 000, charges constatées d'avance 300, disponibilités 700 → 2 000. Passif : capital 2 000.
    const b = etabli(bilanDeLExercice(entrees({ reprise: ouverture })))
    expect(nonNuls(b)).toEqual({
      actif: [['marchandises', 100_000, 0, 100_000], ['charges-constatees-avance', 30_000, 0, 30_000], ['disponibilites', 70_000, 0, 70_000]],
      passif: [['capital', 200_000]],
    })
    expect(b.points.find((p) => p.code === 'inventaire-non-revu')!.comptes).toEqual(['371000', '486000'])
    // Mouvementé dans l'exercice, il a été revu, même revenu au même montant : la charge constatée d'avance contre-passée
    // à l'ouverture (art. 1214-48) puis reconstituée à la clôture — une assurance du même prix chaque année.
    const revu = etabli(bilanDeLExercice(entrees({
      reprise: ouverture,
      ecritures: [
        ...ecrire('2026-01-01', [['616000', 'D', 300], ['486000', 'C', 300]]),
        ...ecrire('2026-12-31', [['486000', 'D', 300], ['616000', 'C', 300]]),
      ],
    })))
    expect(actifDe(revu, 'charges-constatees-avance').brut).toBe(30_000)
    expect(revu.points.find((p) => p.code === 'inventaire-non-revu')!.comptes).toEqual(['371000'])
  })

  it('un exercice en cours est provisoire, un exercice clos ne l’est pas', () => {
    const ecritures = ecrire('2026-01-02', [['512000', 'D', 100], ['101000', 'C', 100]])
    expect(etabli(bilanDeLExercice(entrees({ ecritures, aujourdHui: '2026-10-09' }))).provisoire).toBe(true)
    expect(codes(etabli(bilanDeLExercice(entrees({ ecritures, aujourdHui: '2026-12-31' }))))).toContain('exercice-en-cours')
    expect(etabli(bilanDeLExercice(entrees({ ecritures, aujourdHui: '2027-01-01' }))).provisoire).toBe(false)
  })

  it('un report à nouveau dans une entreprise individuelle se dit ; le 108 d’une société est à classer', () => {
    const ecritures = ecrire('2026-01-02', [['512000', 'D', 500], ['110000', 'C', 300], ['108000', 'C', 200]])
    const ei = etabli(bilanDeLExercice(entrees({ ecritures, modele: EXPLOITANT_BIC })))
    expect(nonNuls(ei).passif).toEqual([['capital', 20_000], ['report-a-nouveau', 30_000]])
    expect(codes(ei)).toContain('report-a-nouveau-exploitant')
    const societe = etabli(bilanDeLExercice(entrees({ ecritures, modele: SOCIETE })))
    expect(nonNuls(societe).passif).toEqual([['report-a-nouveau', 30_000], ['a-classer-passif', 20_000]])
    expect(codes(societe)).not.toContain('report-a-nouveau-exploitant')
    expect(societe.points.find((p) => p.code === 'a-classer')!.comptes).toEqual(['108000'])
  })

  it('un compte d’attente se dit pour lui-même', () => {
    const ecritures = ecrire('2026-01-02', [['512000', 'D', 80], ['471000', 'C', 80]])
    const b = etabli(bilanDeLExercice(entrees({ ecritures })))
    expect(passifDe(b, 'a-classer-passif').montant).toBe(8_000)
    expect(codes(b)).toContain('compte-d-attente')
    expect(codes(b)).not.toContain('a-classer')
  })

  it('le libellé d’un compte est celui de la Balance des comptes', () => {
    // Le 274100 n'est nommé que par la balance reprise ; le 275000 par l'application ; le 444000 par une catégorie,
    // qui l'emporte sur le plan comptable.
    const ouverture = [
      aNouveau({ compte: '274100', compte_origine: '274100', libelle: 'Prêt fictif au salarié', sens: 'debit', montant: 500 }),
      aNouveau({ compte: '101000', compte_origine: '101000', libelle: 'Capital', sens: 'credit', montant: 500 }),
    ]
    const ecritures = [
      ...ecrire('2026-01-02', [['512000', 'D', 10], ['275000', 'C', 10]]),
      ...ecrire('2026-02-02', [['606000', 'D', 7], ['444000', 'C', 7]]),
    ]
    const b = etabli(bilanDeLExercice(entrees({
      ecritures, reprise: ouverture, categories: [categorie({ compte_comptable: '444000', libelle: 'Impôt fictif à payer' })],
    })))
    expect(actifDe(b, 'financieres').contributions.map((c) => [c.compte, c.libelle, c.centimes, c.inhabituel])).toEqual([
      ['274100', 'Prêt fictif au salarié', 50_000, false],
      ['275000', 'Dépôts et cautionnements versés', -1_000, true],
    ])
    expect(passifDe(b, 'dettes-fiscales-sociales').contributions.map((c) => [c.compte, c.libelle])).toEqual([['444000', 'Impôt fictif à payer']])
    // Un impôt sur les bénéfices dans les dettes fiscales n'est pas de la TVA : le renvoi 169 ne le compte pas.
    expect(b.renvois).toEqual({ dontTva: 0, dontComptesCourantsDebiteurs: 0 })
    expect(b.ecart).toBe(0)
  })

  it('les montants se comptent en centimes entiers, ligne à ligne', () => {
    // 1,15 € au débit contre 0,58 € et 0,57 € au crédit : en virgule flottante, 1,15 × 100 vaut 114,999…, 0,58 × 100
    // 57,999… et 0,57 × 100 56,999… — tronqués, ils rendraient 114 contre 113. Arrondis ligne à ligne : 115 contre 115.
    const ecritures = ecrire('2026-03-01', [['512000', 'D', 1.15], ['706000', 'C', 0.58], ['706000', 'C', 0.57]])
    const b = etabli(bilanDeLExercice(entrees({ ecritures, modele: EXPLOITANT_BNC })))
    expect(nonNuls(b)).toEqual({ actif: [['disponibilites', 115, 0, 115]], passif: [['resultat', 115]] })
    expect(b.ecart).toBe(0)
  })

  it('les tiers d’un même côté se rangent par nom, la part sans détail en dernier', () => {
    const ouverture = reprise('2026-01-01', [['411000', 'D', 500], ['101000', 'C', 500]])
    const ecritures = [
      ...ecrire('2026-02-01', [['411000', 'D', 100], ['706000', 'C', 100]], { piece_id: 'p20' }),
      ...ecrire('2026-02-02', [['411000', 'D', 200], ['706000', 'C', 200]], { piece_id: 'p21' }),
    ]
    // Clients : 500 sans détail + Zuludoc 100 + Alphamed 200 = 800.
    const b = etabli(bilanDeLExercice(entrees({ ecritures, reprise: ouverture, pieces: [piece('p20', 'Zuludoc'), piece('p21', 'Alphamed')] })))
    expect(actifDe(b, 'clients').contributions).toEqual([expect.objectContaining({
      compte: '411000', centimes: 80_000,
      tiers: [
        { auxiliaire: 'CALPHAMED', libelle: 'Alphamed', centimes: 20_000 },
        { auxiliaire: 'CZULUDOC', libelle: 'Zuludoc', centimes: 10_000 },
        { auxiliaire: null, libelle: 'Sans détail par tiers', centimes: 50_000 },
      ],
    })])
  })

  it('un bénéfice et une perte antérieurs qui se compensent attendent tout de même leur affectation', () => {
    const ouverture = reportes('2026-01-01', [['512000', 'D', 1_000], ['101000', 'C', 1_000], ['120000', 'C', 100], ['129000', 'D', 100]])
    const b = etabli(bilanDeLExercice(entrees({ reportes: ouverture, anneesValidees: [2025] })))
    expect(passifDe(b, 'resultats-en-attente').montant).toBe(0)
    expect(b.points.find((p) => p.code === 'affectation-non-ecrite')?.comptes).toEqual(['120000', '129000'])
  })
})

describe('bilanDeLExercice — un bilan qui serait faux ne s’établit pas', () => {
  it('un exercice dont l’ouverture attend la validation du précédent', () => {
    const ecritures = [
      ...ecrire('2025-03-01', [['512000', 'D', 1_000], ['101000', 'C', 1_000]]),
      ...ecrire('2026-03-01', [['606000', 'D', 100], ['512000', 'C', 100]]),
    ]
    const b = bilanDeLExercice(entrees({ ecritures }))
    expect(b).toEqual({
      etat: 'non-etabli', exercice: 2026, dateCloture: '2026-12-31',
      motif: {
        code: 'ouverture-en-attente',
        texte: 'L’exercice 2026 n’a pas encore d’ouverture : elle s’écrira à la validation de l’exercice 2025 (Clôture). '
          + 'Jusque-là, ses comptes de bilan partiraient de zéro, et son bilan serait faux.',
      },
    })
    // Le premier exercice, lui, s'établit, et l'exercice validé ouvre le suivant.
    expect(bilanDeLExercice(entrees({ ecritures, exercice: 2025 })).etat).toBe('etabli')
    expect(bilanDeLExercice(entrees({ ecritures, anneesValidees: [2025] })).etat).toBe('etabli')
  })

  it('un exercice antérieur à la reprise du dossier', () => {
    const b = bilanDeLExercice(entrees({ exercice: 2025, reprise: reprise('2026-01-01', [['512000', 'D', 10], ['101000', 'C', 10]]) }))
    expect(b.etat).toBe('non-etabli')
    if (b.etat === 'non-etabli') {
      expect(b.motif.code).toBe('avant-la-reprise')
      expect(b.motif.texte).toBe('L’exercice 2025 précède la reprise du dossier, ouvert le 01/01/2026 : ses comptes sont ceux '
        + 'du logiciel précédent, et son bilan aussi.')
    }
  })
})

// LE PASSAGE DES COMPTES AUX RUBRIQUES, compte par compte : les comptes que l'application écrit, puis ceux qu'une balance
// reprise peut porter. Recopié à la main des libellés du 2033-A-SD 2026 (cerfa 15948*08), de sa notice et du PCG
// (art. 822-1, 1121-1, 1211-10 à 1215-59).
type Attendu = [compte: string, sens: 'D' | 'C', individuel: boolean, vers: string, ordinaire: 'D' | 'C' | null]

const ATTENDUS: Attendu[] = [
  ['512000', 'D', false, 'actif disponibilites brut', null],
  ['512000', 'C', false, 'passif emprunts', null],
  ['519000', 'C', false, 'passif emprunts', 'C'],
  ['530000', 'D', false, 'actif disponibilites brut', 'D'],
  ['580000', 'D', false, 'actif disponibilites brut', null],
  ['580000', 'C', false, 'a-classer', null],
  ['503000', 'D', false, 'actif vmp brut', 'D'],
  ['590000', 'C', false, 'actif vmp amortissements', 'C'],
  ['401000', 'C', false, 'passif fournisseurs', null],
  ['401000', 'D', false, 'actif autres-creances brut', null],
  ['404000', 'C', false, 'passif fournisseurs', null],
  ['408000', 'C', false, 'passif fournisseurs', null],
  ['409100', 'D', false, 'actif avances-versees brut', 'D'],
  ['409700', 'D', false, 'actif autres-creances brut', 'D'],
  ['411000', 'D', false, 'actif clients brut', null],
  ['411000', 'C', false, 'passif autres-dettes', null],
  ['418000', 'D', false, 'actif clients brut', null],
  ['419100', 'C', false, 'passif avances-recues', 'C'],
  ['419700', 'C', false, 'passif autres-dettes', 'C'],
  ['491000', 'C', false, 'actif clients amortissements', 'C'],
  ['421000', 'C', false, 'passif dettes-fiscales-sociales', null],
  ['425000', 'D', false, 'actif autres-creances brut', null],
  ['431000', 'C', false, 'passif dettes-fiscales-sociales', null],
  ['444000', 'C', false, 'passif dettes-fiscales-sociales', null],
  ['444000', 'D', false, 'actif autres-creances brut', null],
  ['445510', 'C', false, 'passif dettes-fiscales-sociales', null],
  ['445620', 'D', false, 'actif autres-creances brut', null],
  ['445660', 'D', false, 'actif autres-creances brut', null],
  ['445670', 'D', false, 'actif autres-creances brut', null],
  ['445710', 'C', false, 'passif dettes-fiscales-sociales', null],
  ['445830', 'D', false, 'actif autres-creances brut', null],
  ['455000', 'C', false, 'passif comptes-courants', null],
  ['455000', 'D', false, 'actif autres-creances brut', null],
  ['457000', 'C', false, 'passif autres-dettes', 'C'],
  ['467000', 'C', false, 'passif autres-dettes', null],
  ['467000', 'D', false, 'actif autres-creances brut', null],
  ['471000', 'C', false, 'a-classer', null],
  ['476000', 'D', false, 'a-classer', null],
  ['486000', 'D', false, 'actif charges-constatees-avance brut', 'D'],
  ['487000', 'C', false, 'passif produits-constates-avance', 'C'],
  ['101000', 'C', false, 'passif capital', 'C'],
  ['101000', 'D', true, 'passif capital', null],
  ['104000', 'C', false, 'a-classer', null],
  ['105000', 'C', false, 'passif ecarts-reevaluation', 'C'],
  ['106000', 'C', false, 'a-classer', null],
  ['106100', 'C', false, 'passif reserve-legale', 'C'],
  ['106400', 'C', false, 'passif reserves-reglementees', 'C'],
  ['106800', 'C', false, 'passif autres-reserves', 'C'],
  ['108000', 'D', true, 'passif capital', null],
  ['108000', 'D', false, 'a-classer', null],
  ['110000', 'C', false, 'passif report-a-nouveau', null],
  ['119000', 'D', false, 'passif report-a-nouveau', null],
  ['120000', 'C', false, 'passif resultats-en-attente', null],
  ['129000', 'D', false, 'passif resultats-en-attente', null],
  ['120000', 'C', true, 'passif capital', null],
  ['131000', 'C', false, 'passif subventions', null],
  ['139000', 'D', false, 'passif subventions', null],
  ['145000', 'C', false, 'passif provisions-reglementees', 'C'],
  ['151100', 'C', false, 'passif provisions', 'C'],
  ['164000', 'C', false, 'passif emprunts', 'C'],
  ['165000', 'C', false, 'passif emprunts', 'C'],
  ['167300', 'C', false, 'a-classer', null],
  ['169000', 'D', false, 'a-classer', null],
  ['201000', 'D', false, 'a-classer', null],
  ['205000', 'D', false, 'actif autres-incorporelles brut', 'D'],
  ['206000', 'D', false, 'actif fonds-commercial brut', 'D'],
  ['207000', 'D', false, 'actif fonds-commercial brut', 'D'],
  ['211000', 'D', false, 'actif corporelles brut', 'D'],
  ['218200', 'D', false, 'actif corporelles brut', 'D'],
  ['218300', 'D', false, 'actif corporelles brut', 'D'],
  ['238000', 'D', false, 'actif corporelles brut', 'D'],
  ['237000', 'D', false, 'actif autres-incorporelles brut', 'D'],
  ['261000', 'D', false, 'actif financieres brut', 'D'],
  ['274000', 'D', false, 'actif financieres brut', 'D'],
  ['275000', 'D', false, 'actif financieres brut', 'D'],
  ['280500', 'C', false, 'actif autres-incorporelles amortissements', 'C'],
  ['280700', 'C', false, 'actif fonds-commercial amortissements', 'C'],
  ['281820', 'C', false, 'actif corporelles amortissements', 'C'],
  ['281830', 'C', false, 'actif corporelles amortissements', 'C'],
  ['291100', 'C', false, 'actif corporelles amortissements', 'C'],
  ['296100', 'C', false, 'actif financieres amortissements', 'C'],
  ['280100', 'C', false, 'a-classer', null],
  ['310000', 'D', false, 'actif matieres brut', 'D'],
  ['335000', 'D', false, 'actif matieres brut', 'D'],
  ['355000', 'D', false, 'a-classer', null],
  ['370000', 'D', false, 'actif marchandises brut', 'D'],
  ['391000', 'C', false, 'actif matieres amortissements', 'C'],
  ['397000', 'C', false, 'actif marchandises amortissements', 'C'],
  ['801000', 'D', false, 'a-classer', null],
]

function lire(v: Destination): string {
  if (v.cote === 'actif') return `actif ${v.rubrique} ${v.colonne}`
  if (v.cote === 'passif') return `passif ${v.rubrique}`
  return 'a-classer'
}

describe('regleDuCompte — le passage des comptes aux rubriques du 2033-A', () => {
  it.each(ATTENDUS)('%s au %s (entreprise individuelle : %s) → %s', (compte, sens, individuel, vers, sensOrdinaire) => {
    const regle = regleDuCompte(compte, individuel)
    expect(lire(sens === 'D' ? regle.debiteur : regle.crediteur)).toBe(vers)
    expect(regle.sensOrdinaire).toBe(sensOrdinaire === null ? null : sensOrdinaire === 'D' ? 'debit' : 'credit')
  })

  it('les rubriques et leurs cases sont celles du formulaire, dans son ordre', () => {
    expect(RUBRIQUES_ACTIF.map((r) => [r.libelle, r.cases?.brut ?? null, r.cases?.amortissements ?? null])).toEqual([
      ['Fonds commercial', '010', '012'],
      ['Autres immobilisations incorporelles', '014', '016'],
      ['Immobilisations corporelles', '028', '030'],
      ['Immobilisations financières', '040', '042'],
      ['Matières premières, approvisionnements, en cours de production', '050', '052'],
      ['Marchandises', '060', '062'],
      ['Avances et acomptes versés sur commandes', '064', '066'],
      ['Clients et comptes rattachés', '068', '070'],
      ['Autres créances', '072', '074'],
      ['Charges constatées d’avance', '092', '094'],
      ['Valeurs mobilières de placement', '080', '082'],
      ['Disponibilités', '084', '086'],
      ['Comptes à classer', null, null],
    ])
    expect(RUBRIQUES_PASSIF.map((r) => [r.libelle, r.case])).toEqual([
      ['Capital social ou individuel', '120'],
      ['Écarts de réévaluation', '124'],
      ['Réserve légale', '126'],
      ['Réserves réglementées', '130'],
      ['Autres réserves', '132'],
      ['Report à nouveau', '134'],
      ['Résultat de l’exercice', '136'],
      ['Résultats antérieurs en attente d’affectation', null],
      ['Subventions d’investissement', '137'],
      ['Provisions réglementées', '140'],
      ['Provisions pour risques et charges', '154'],
      ['Emprunts et dettes assimilées', '156'],
      ['Avances et acomptes reçus sur commandes en cours', '164'],
      ['Fournisseurs et comptes rattachés', '166'],
      ['Dettes fiscales et sociales', '172'],
      ['Comptes courants d’associés', '173'],
      ['Autres dettes', '175'],
      ['Produits constatés d’avance', '174'],
      ['Comptes à classer', null],
    ])
  })
})
