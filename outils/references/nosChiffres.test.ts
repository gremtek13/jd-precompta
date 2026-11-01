import { writeFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { planAmortissement } from '../lib/amortissements'
import { bilanDeLExercice, CASES_DES_TOTAUX, RUBRIQUES_ACTIF, RUBRIQUES_PASSIF } from '../lib/bilan'
import { arrondirPourFormulaire, CASES_2035, valeursDesCases } from '../lib/cases2035'
import { cotisationsComptees } from '../lib/cotisationRapprochee'
import { calculerDeclaration2035 } from '../lib/declaration2035'
import { calculerCa3, LIGNES_CA3 } from '../lib/declarationTva'
import { partsDuReleve } from '../lib/partsDuReleve'
import { paiementsDesPieces } from '../lib/rattachement'
import type {
  ANouveau, Categorie, CotisationDeclaree, EcritureBrouillon, Immobilisation, LigneBancaire, Piece, VehiculeDossier,
} from '../lib/types'
import { A_NOUVEAU_NON_VALIDE, NON_VALIDEE } from '../test/ecritures'
import {
  A_APRES_CLOTURE, A_COTISATIONS, A_PIECES, A_PRET, A_SITUATION, A_SOLDE_INITIAL, A_VEHICULE, B_APRES_PERIODE, B_PIECES, B_SOLDE_INITIAL,
  B_SITUATION, CATEGORIES_COMMUNES, D_BALANCE, D_SITUATION, REGISTRE, releveA, releveB, tableauDuPret,
  type MouvementDeReference, type PieceDeReference,
} from './donnees'

// NOS CHIFFRES SUR LES DOSSIERS DE RÉFÉRENCE, par les moteurs de l'application et dans l'ordre où les écrans les
// appellent (ClotureTab, TvaTab, ImmobilisationsTab, BilanTab). Ils se calculent et se FIGENT avant que l'expert-comptable
// rende les siens : la comparaison n'a de valeur que si les nôtres ne peuvent plus bouger après coup.
//
// FIGÉ SUR LA VERSION c506932 de l'application : ce fichier appelle les moteurs avec leurs signatures de ce jour-là, et ne
// se joue que copié dans `src/refs/` d'une copie de travail à cette version (README.md de ce dossier) ; il n'est ni
// compilé ni joué par la suite, et ne se met pas à jour quand les moteurs changent — c'est ce qui le rend rejouable.
// Le dossier où écrire nos chiffres et les données du document : HORS du dépôt, ou dans `outils/references/sortie/`,
// qu'ignore git. Nos chiffres ne se commitent jamais (README.md de ce dossier).
const SORTIE = process.env.SORTIE_REFERENCES ?? ''
if (SORTIE === '') throw new Error('SORTIE_REFERENCES : le dossier où écrire nos chiffres manque.')
const DOSSIER = 'dossier-de-reference'
const HORODATAGE = '2026-10-12T12:00:00Z'

const categories: Categorie[] = CATEGORIES_COMMUNES.map((c, i) => ({
  id: c.code, dossier_id: null, code: c.code, libelle: c.libelle, ordre: (i + 1) * 10, compte_comptable: c.compte, poste_2035: c.poste,
}))

function piece(p: PieceDeReference): Piece {
  return {
    id: p.id, dossier_id: DOSSIER, uploaded_by: null, source: 'upload', storage_path: `${DOSSIER}/${p.id}.pdf`, nom_fichier: `${p.id}.pdf`,
    storage_hash: null, date_piece: p.date, tiers: p.tiers, montant_ht: p.ht, montant_tva: p.tva, montant_ttc: p.ttc, devise: 'EUR',
    montant_devise: null, taux_change: null, conversion_source: null, categorie_id: p.categorie, sous_dossier_id: null,
    type_piece: p.type, statut: 'validee', notes: null, confiance: null, superpdp_invoice_id: null, flux_hote: null, flux_id: null,
    lisible_path: null, identite_numero: null, identite_siren_vendeur: null, identite_date: null, identite_nature: null,
    created_at: HORODATAGE, updated_at: HORODATAGE,
  }
}

function ligne(m: MouvementDeReference): LigneBancaire {
  const base: LigneBancaire = {
    id: m.id, dossier_id: DOSSIER, date: m.date, libelle: m.libelle, montant: m.montant, statut: 'rapprochee', piece_id: null,
    cotisation_id: null, categorie_id: null, taux_tva: null, emprunt_id: null, emprunt_echeance: null, emprunt_interets: null,
    emprunt_assurance: null, ventilee: false, reglement_groupe: false, compte_bilan: null, declaration_tva_id: null,
    prelevement_personnel: false, source_fichier: 'releve-fictif.csv', libelle_brut: m.libelle, id_externe: null, created_at: HORODATAGE,
  }
  const modele = m.modele
  switch (modele.type) {
    case 'categorie': return { ...base, categorie_id: modele.categorie, taux_tva: modele.taux ?? null }
    case 'personnel': return { ...base, prelevement_personnel: true }
    case 'piece': return { ...base, piece_id: modele.piece }
    case 'cotisation': return { ...base, cotisation_id: modele.cotisation }
    case 'emprunt': return {
      ...base, emprunt_id: 'pret-a', emprunt_echeance: modele.numero, emprunt_interets: modele.interets, emprunt_assurance: modele.assurance,
    }
  }
}

function dossierA() {
  const pieces = A_PIECES.map(piece)
  const lignes = [...releveA(), ...A_APRES_CLOTURE].map(ligne)
  const immobilisations: Immobilisation[] = REGISTRE.map((b) => ({
    id: b.id, dossier_id: DOSSIER, piece_id: b.piece ?? null, nature_id: null, libelle: b.libelle, valeur: b.valeur,
    date_acquisition: b.dateAcquisition, date_mise_en_service: b.dateMiseEnService, duree_annees: b.dureeAnnees, created_at: HORODATAGE,
  }))
  const cotisations: CotisationDeclaree[] = A_COTISATIONS.map((c) => ({
    id: c.id, dossier_id: DOSSIER, echeance: c.echeance, montant_appele: c.montant, montant_verse: null, montant_csg_crds: c.csgCrds,
    previsionnel: false, created_at: HORODATAGE, paiement_personnel_le: null,
  }))
  const vehicules: VehiculeDossier[] = [{
    id: 'vehicule-a', dossier_id: DOSSIER, annee: A_VEHICULE.annee, modele: null, type: A_VEHICULE.type,
    puissance_fiscale: A_VEHICULE.puissanceFiscale, bareme: 'bnc', motorisation: A_VEHICULE.motorisation, carburant: 'super_sans_plomb',
    km_professionnel: A_VEHICULE.kmProfessionnels, inscrit_immobilisations: false, amortissements_a_reintegrer: null,
    created_at: HORODATAGE, updated_at: HORODATAGE,
  }]
  const paiements = paiementsDesPieces(lignes, [], [], [])
  const parts = partsDuReleve(lignes, categories, [], false)
  const comptees = cotisationsComptees(cotisations, lignes, 'tresorerie')
  const d = calculerDeclaration2035(2025, pieces, categories, immobilisations, comptees, vehicules, false, paiements, parts, [])
  const { valeurs, postesSansCase } = valeursDesCases(d)
  const auxEuros = arrondirPourFormulaire(valeurs, 2025)
  const refusDeCotisation = comptees.filter((c) => c.refus !== null).map((c) => ({ id: c.cotisation.id, refus: c.refus }))
  return {
    cases: Object.fromEntries([...valeurs].filter(([, v]) => v !== 0)),
    casesALEuro: Object.fromEntries([...auxEuros].filter(([, v]) => v !== 0)),
    postes: [...d.recettes, ...d.depenses].map((l) => ({ poste: l.poste, nature: l.nature, montant: l.montant })),
    postesSansCase: postesSansCase.map((p) => ({ poste: p.ligne.poste, montant: p.ligne.montant, raison: p.raison })),
    exclusions: {
      sansPoste: d.exclusions.sansPoste.map((p) => p.id), sansDate: d.exclusions.sansDate.map((p) => p.id),
      sansMontant: d.exclusions.sansMontant.map((p) => p.id), mouvementsSansPoste: d.exclusions.mouvementsSansPoste.map((p) => p.ligne.id),
      mouvementsHorsResultat: d.exclusions.mouvementsHorsResultat.map((p) => p.ligne.id),
    },
    sansPaiementConnu: d.sansPaiementConnu.map((s) => ({ piece: s.piece.id, montant: s.montant })),
    refusDeCotisation,
    resultat: d.resultat,
  }
}

function dossierB() {
  const pieces = B_PIECES.map(piece)
  const lignes = [...releveB(), ...B_APRES_PERIODE].map(ligne)
  const paiements = paiementsDesPieces(lignes, [], [], [])
  const releve = partsDuReleve(lignes, categories, [], true)
  const pieceIdsImmobilisees = new Set(B_PIECES.filter((p) => p.immobilisation).map((p) => p.id))
  const ca3 = calculerCa3({ pieces, paiements, pieceIdsImmobilisees, releve }, { debut: '2026-03-01', fin: '2026-03-31' }, false, B_SITUATION.creditAnterieur, 0)
  const cases = ca3.cases as unknown as Record<string, number>
  return {
    lignes: LIGNES_CA3.map((l) => ({
      ligne: l.ligne, libelle: l.libelle,
      base: l.base ? cases[l.base] ?? 0 : null,
      montant: cases[l.montant] ?? 0,
    })),
    netPeriode: ca3.netPeriode,
    retenues: ca3.retenues.map((r) => ({ piece: r.piece.id, ligne: r.ligne, part: r.part })),
    ecartees: ca3.ecartees.map((e) => ({ piece: e.piece.id, motif: e.motif, part: e.part })),
    nonPlacees: ca3.nonPlacees.map((n) => ({ piece: n.piece.id, motif: n.motif })),
    releveRetenues: ca3.releveRetenues.map((r) => ({ ligne: r.part.ligne.id, case: r.ligne })),
    releveEcartees: ca3.releveEcartees.map((r) => ({ ligne: r.part.ligne.id, motif: r.motif })),
    tvaDesComptes: ca3.tvaDesComptes,
  }
}

function dossierC() {
  return REGISTRE.map((b) => ({
    bien: b.id, libelle: b.libelle,
    plan: planAmortissement({ valeur: b.valeur, duree_annees: b.dureeAnnees, date_acquisition: b.dateAcquisition, date_mise_en_service: b.dateMiseEnService }),
  }))
}

// LE BILAN : la balance de clôture se rejoue en une ouverture (à-nouveaux au 01/01/2025) et les opérations de 2025, de
// sorte que chaque solde de fin d'exercice soit celui de la balance remise à l'expert — vérifié plus bas, compte par compte.
let numero = 0
type L = [compte: string, sens: 'D' | 'C', euros: number]
function ecrire(date: string, journal: 'AC' | 'VE' | 'BQ' | 'OD', lignes: L[], pieceId: string | null = null): EcritureBrouillon[] {
  return lignes.map(([compte, sens, montant]) => {
    numero += 1
    return {
      id: `e${String(numero).padStart(5, '0')}`, dossier_id: DOSSIER, piece_id: pieceId, ligne_bancaire_id: null, date, compte,
      libelle: `Opération ${journal}`, montant, sens: sens === 'D' ? 'debit' : 'credit', statut: 'proposee', created_at: HORODATAGE,
      immobilisation_id: null, vehicule_id: null, declaration_tva_id: null, cotisation_id: null, ...NON_VALIDEE,
    }
  })
}

const D_PIECES = [
  { id: 'PV-CPAM', tiers: 'Assurance maladie (tiers payant)' },
  { id: 'PV-COMPL', tiers: 'Complémentaires santé' },
  { id: 'PV-PATIENT', tiers: 'Patient (fictif)' },
  { id: 'PA-LABO', tiers: 'Fournisseur de matériel médical (fictif)' },
  { id: 'PA-INFO', tiers: 'Prestataire informatique (fictif)' },
]

function ecrituresD(): EcritureBrouillon[] {
  return [
    ...ecrire('2025-06-30', 'VE', [['411000', 'D', 70_000], ['706000', 'C', 70_000]], 'PV-CPAM'),
    ...ecrire('2025-06-30', 'VE', [['411000', 'D', 18_000], ['706000', 'C', 18_000]], 'PV-COMPL'),
    ...ecrire('2025-06-30', 'VE', [['411000', 'D', 10_400], ['706000', 'C', 10_400]], 'PV-PATIENT'),
    ...ecrire('2025-07-15', 'BQ', [['512100', 'D', 66_580], ['411000', 'C', 66_580]], 'PV-CPAM'),
    ...ecrire('2025-07-15', 'BQ', [['512100', 'D', 17_620], ['411000', 'C', 17_620]], 'PV-COMPL'),
    ...ecrire('2025-07-15', 'BQ', [['512100', 'D', 10_460], ['411000', 'C', 10_460]], 'PV-PATIENT'),
    ...ecrire('2025-05-10', 'AC', [['606100', 'D', 3_100], ['401000', 'C', 3_100]], 'PA-LABO'),
    ...ecrire('2025-06-10', 'BQ', [['401000', 'D', 2_460], ['512100', 'C', 2_460]], 'PA-LABO'),
    ...ecrire('2025-05-10', 'AC', [['626000', 'D', 540], ['401000', 'C', 540]], 'PA-INFO'),
    ...ecrire('2025-06-10', 'BQ', [['401000', 'D', 660], ['512100', 'C', 660]], 'PA-INFO'),
    ...ecrire('2025-12-01', 'BQ', [['613200', 'D', 6_420], ['512100', 'C', 6_420]]),
    ...ecrire('2025-12-31', 'OD', [['486000', 'D', 420], ['613200', 'C', 420]]),
    ...ecrire('2025-03-01', 'BQ', [['616100', 'D', 1_450], ['512100', 'C', 1_450]]),
    ...ecrire('2025-04-20', 'BQ', [['622600', 'D', 2_280], ['512100', 'C', 2_280]]),
    ...ecrire('2025-11-30', 'BQ', [['625100', 'D', 3_849.50], ['512100', 'C', 3_849.50]]),
    ...ecrire('2025-11-30', 'BQ', [['625100', 'D', 50.50], ['512200', 'C', 50.50]]),
    ...ecrire('2025-12-31', 'BQ', [['627000', 'D', 180], ['512200', 'C', 180]]),
    ...ecrire('2025-12-15', 'BQ', [['635110', 'D', 410], ['512100', 'C', 410]]),
    ...ecrire('2025-12-20', 'BQ', [['641100', 'D', 42_000], ['512100', 'C', 42_000]]),
    ...ecrire('2025-12-31', 'OD', [['646000', 'D', 15_800], ['431000', 'C', 11_200], ['437000', 'C', 4_600]]),
    ...ecrire('2025-12-20', 'BQ', [['431000', 'D', 9_960], ['512100', 'C', 9_960]]),
    ...ecrire('2025-12-20', 'BQ', [['437000', 'D', 4_290], ['512100', 'C', 4_290]]),
    ...ecrire('2025-12-25', 'BQ', [['661100', 'D', 640], ['512100', 'C', 640]]),
    ...ecrire('2025-12-25', 'BQ', [['164000', 'D', 4_200], ['512100', 'C', 4_200]]),
    ...ecrire('2025-12-31', 'OD', [['681120', 'D', 2_030], ['281540', 'C', 1_400], ['281830', 'C', 630]]),
    ...ecrire('2025-12-31', 'OD', [['695000', 'D', 2_950], ['444000', 'C', 2_950]]),
    ...ecrire('2025-12-15', 'BQ', [['444000', 'D', 3_300], ['512100', 'C', 3_300]]),
    ...ecrire('2025-09-10', 'BQ', [['218300', 'D', 1_250], ['512100', 'C', 1_250]]),
  ]
}

function centimesDuSolde(lignes: { compte: string; sens: 'debit' | 'credit'; montant: number }[], compte: string): number {
  return lignes.filter((l) => l.compte === compte).reduce((s, l) => s + Math.round(l.montant * 100) * (l.sens === 'debit' ? 1 : -1), 0)
}

function dossierD() {
  const ecritures = ecrituresD()
  // L'ouverture : la balance de clôture moins les opérations de 2025, compte par compte (classes 1 à 5 seulement).
  const comptes = [...new Set(D_BALANCE.map((l) => l.compte))]
  const ouverture: ANouveau[] = []
  for (const compte of comptes) {
    const cloture = D_BALANCE.filter((l) => l.compte === compte).reduce((s, l) => s + Math.round(l.solde * 100), 0)
    const mouvements = centimesDuSolde(ecritures, compte)
    const centimes = cloture - mouvements
    if (centimes === 0) continue
    expect(Number(compte[0])).toBeLessThanOrEqual(5)
    numero += 1
    ouverture.push({
      id: `a${numero}`, dossier_id: DOSSIER, date: '2025-01-01', compte, compte_origine: compte, libelle: `À-nouveau ${compte}`,
      sens: centimes > 0 ? 'debit' : 'credit', montant: Math.abs(centimes) / 100, source_nom: 'balance-fictive-2024.csv',
      source_empreinte: 'empreinte-fictive', created_at: HORODATAGE, ...A_NOUVEAU_NON_VALIDE,
    })
  }
  // Chaque solde de clôture rejoué est celui de la balance remise à l'expert ; les tiers, par pièce.
  for (const compte of comptes) {
    const attendu = D_BALANCE.filter((l) => l.compte === compte).reduce((s, l) => s + Math.round(l.solde * 100), 0)
    expect(centimesDuSolde([...ouverture, ...ecritures], compte)).toBe(attendu)
  }
  const bilan = bilanDeLExercice({
    exercice: 2025, ecritures, categories, reprise: ouverture, reportes: [], anneesValidees: [],
    pieces: D_PIECES, modele: { mode: 'engagement', compteNotesDeFrais: '455000' }, aujourdHui: '2026-10-12',
  })
  return { bilan, ouverture: ouverture.map((a) => ({ compte: a.compte, sens: a.sens, montant: a.montant })) }
}

it('calcule et fige nos chiffres sur les quatre dossiers de référence', () => {
  const a = dossierA()
  const b = dossierB()
  const c = dossierC()
  const d = dossierD()
  const nosChiffres = { calculeLe: '2026-10-12', base: 'c506932', a, b, c, d: d.bilan }
  writeFileSync(`${SORTIE}/nos_chiffres.json`, `${JSON.stringify(nosChiffres, null, 2)}\n`)
  const donnees = {
    categories: CATEGORIES_COMMUNES,
    a: {
      situation: A_SITUATION, soldeInitial: A_SOLDE_INITIAL, releve: releveA(), apresCloture: A_APRES_CLOTURE, pieces: A_PIECES,
      cotisations: A_COTISATIONS, pret: A_PRET, echeancesDuPret: tableauDuPret(), vehicule: A_VEHICULE, registre: REGISTRE,
    },
    b: { situation: B_SITUATION, soldeInitial: B_SOLDE_INITIAL, releve: releveB(), apresPeriode: B_APRES_PERIODE, pieces: B_PIECES },
    d: { situation: D_SITUATION, balance: D_BALANCE },
    // La STRUCTURE des formulaires, sans aucun montant : les cases que la grille de réponse demande.
    formulaires: {
      cases2035: CASES_2035.map((c) => ({ code: c.code, ligne: c.ligne, libelle: c.libelle, formulaire: c.formulaire, cadre: c.cadre, sousCaseDe: c.sousCaseDe ?? null })),
      lignesCa3: LIGNES_CA3.map((l) => ({ ligne: l.ligne, libelle: l.libelle, code: l.code, cadre: l.cadre, aUneBase: Boolean(l.base) })),
      actif2033: RUBRIQUES_ACTIF.filter((r) => r.cases !== null).map((r) => ({ libelle: r.libelle, masse: r.masse, cases: r.cases })),
      passif2033: RUBRIQUES_PASSIF.filter((r) => r.case !== null).map((r) => ({ libelle: r.libelle, masse: r.masse, case: r.case })),
      totaux2033: CASES_DES_TOTAUX,
    },
  }
  writeFileSync(`${SORTIE}/donnees.json`, `${JSON.stringify(donnees, null, 2)}\n`)
  writeFileSync(`${SORTIE}/ouverture_d.json`, `${JSON.stringify(d.ouverture, null, 2)}\n`)
  expect(a.resultat).not.toBe(0)
})
