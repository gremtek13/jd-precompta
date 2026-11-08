// LA RÉPÉTITION D'UNE ANNÉE SUR DONNÉES FICTIVES (MVP-D6) — le parcours d'un praticien BNC en trésorerie, exonéré de TVA,
// dossier basculé « ventes par les factures » (MVP-D1), de son relevé importé à la 2035 et au FEC de 2025, avant que son
// année réelle entre. Les données : src/test/repetitionDUneAnnee.ts, écrites en clair. Les ATTENDUS sont tirés ici à la main,
// par des sommes écrites en clair, jamais par un moteur ; les moteurs, eux, sont appelés comme leurs écrans les appellent,
// avec leurs vrais paramètres obligatoires (la façon de outils/charge/annee.mts).
//
// Un écart ou un blocage ne se corrige pas ici : il se marque `it.fails` avec sa cause, pour le lot qui le corrigera.

import { beforeAll, describe, expect, it } from 'vitest'
import { lignesDeDonnees, parseCsv, detectColumnMapping } from './csv'
import { AUCUNE_DECISION, interpreterReleve, type ReleveInterprete } from './importReleve'
import { lireReleveOfxQif, REGLAGE_OFX_QIF } from './releveOfxQif'
import { controlerSolde, type ControleSolde } from './soldeReleve'
import { soldesDeLaCaisse, ecritureDeLOperation, type EtatDeLaCaisse } from './caisse'
import { cotisationsComptees, ecritureDeLaCotisation } from './cotisationRapprochee'
import { concordance2035, type Concordance2035 } from './concordance2035'
import { calculerDeclaration2035, type Declaration2035 } from './declaration2035'
import { valeursDesCases } from './cases2035'
import { calculerBalance, ecrituresAGenerer, piecesAComptabiliser } from './ecritures'
import { ecritureDuMouvement } from './affectationBanque'
import { ecritureDuVirementPersonnel } from './virementPersonnel'
import { ecritureDuCompteDeBilan } from './compteDeBilan'
import { ecritureDuForfait } from './forfaitKilometrique'
import { acquisitionsDesBiens, ecritureDeLaDotation } from './amortissements'
import {
  ecrituresDesVentesPourLa2035, etatsDesVentesFacturees, mouvementsClassesParEncaissements, type SourcesDesEcrituresDeVente,
} from './ecrituresVentesFactureesEcran'
import { CHAMPS_BNC_EXPORTES } from './champsBncExportes'
import { CHAMPS_BNC_NON_EXPORTES, formaterFec, numeroterFec } from './fec'
import { partsDuReleve } from './partsDuReleve'
import { pisteAudit, type LignePisteAudit } from './pisteAudit'
import { pointsDeLaChecklist, type PointATraiter } from './pointsDeLaChecklist'
import { prealablesDeValidation, type EtatDeValidation } from './prealablesValidation'
import { AUCUNE_SAISIE_2035 } from './saisies2035'
import { ventesDeLaChecklist } from './ventesDeLaChecklist'
import { paiementsDesPieces } from './rattachement'
import type { ControleReleveBancaire, EcritureBrouillon, LigneBancaire } from './types'
import { SANS_ACOMPTE, ventesFacturees } from './ventesFacturees'
import { lignesAuBrouillon, ecrituresDesVentesFacturees } from './ecrituresVentesFacturees'
import { recettesDeCaisseDuDossier, recettesPourLesMoteurs, type CaisseLue } from './recettesDeCaisse'
import { operationsDeCaisseDuDossier, operationsPourLesControles } from './controlesDeLaCaisse'
import { paiementsParLaCaisseDuDossier } from './paiementParLaCaisse'
import { NON_VALIDEE } from '../test/ecritures'
import { modeleDeTest } from '../test/modeles'
import {
  ANNEE, A_NOUVEAUX, CATEGORIES, COTISATIONS, D, FACTURES, IMMOBILISATIONS, MOUVEMENTS, NATURE_MATERIEL, OPERATIONS_DE_CAISSE, PIECES,
  VEHICULES, encaissementsEtParts, reglementsDuMouvement, texteDuReleveCsv, texteDuReleveOfx,
} from '../test/repetitionDUneAnnee'

const MODELE = modeleDeTest('tresorerie')
const PLAN = MODELE.plan
const ASSUJETTI = false
const FIN = `${ANNEE}-12-31`

// ── Les attendus, à la main ──────────────────────────────────────────────────────────────────────────────────────────
// Recettes (AA) : les factures payées — 12 virements de 120,00, 6 chèques et 6 paiements en espèces de 90,00 (la facture
// du 20/12, impayée, ne compte pas) —, 12 virements de l'Assurance maladie de 4 000,00, 12 recettes en espèces de 60,00.
const AA = 12 * 120 + 6 * 90 + 6 * 90 + 12 * 4000 + 12 * 60 // 51 240,00
// Achats (BA) : les dix pièces rapprochées, celle payée en espèces, les deux du virement groupé.
const BA = (85.40 + 132.00 + 64.90 + 210.00 + 98.30 + 150.00 + 77.70 + 120.50 + 189.90 + 56.00) + 45.00 + (200.00 + 250.00) // 1 679,70
const BF = 12 * 800 // 9 600,00
const BM = 59.99 // l'abonnement : payé, rejeté, repris — une seule fois
const BN = 12 * 7.50 // 90,00
// Les cotisations : 12 × 650,00 et 380,00 à l'Urssaf (CSG-CRDS 12 × 194,00 et 97,00), 2 × 1 800,00 à la retraite.
const CSG_CRDS = 12 * 194 + 97 // 2 425,00, entière au compte de l'exploitant
const BK = 12 * 650 + 380 + 2 * 1800 - CSG_CRDS // 9 355,00
const BT = BK // toutes obligatoires
const BV = (12 * 194 + 97) * 68 / 97 // 6,8 points sur 9,7 : 1 700,00
// Le barème 2025, 5 CV, 8 000 km : d × 0,357 + 1 395.
const BJ = 8000 * 0.357 + 1395 // 4 251,00
// L'appareil : 3 600,00 sur 5 ans, mis en service le 01/04 — 270 jours sur 360.
const CH = 3600 / 5 * 270 / 360 // 540,00
const BR = BA + BF + BM + BN + BK + BV + BJ
const RESULTAT = AA - BR - CH // 23 964,31
// La banque : le solde d'ouverture, plus les crédits, moins les débits.
const CREDITS = 12 * 120 + 6 * 90 + 12 * 4000 + (300 + 400 + 300) + 59.99
const DEBITS = 1184.70 + 450 + 3600 + 12 * 800 + 2 * 59.99 + 12 * 7.5 + (12 * 650 + 380) + 2 * 1800 + 12 * 2000
const BANQUE_AU_31_12 = 4000 + CREDITS - DEBITS // 4 215,31
// La caisse : espèces des factures et recettes sans facture, moins la pièce payée, le prélèvement et les versements.
const CAISSE_AU_31_12 = 6 * 90 + 12 * 60 - 45 - 100 - (300 + 400 + 300) // 115,00

const c = (n: number) => Math.round(n * 100)

// ── Le parcours ──────────────────────────────────────────────────────────────────────────────────────────────────────
interface Parcours {
  csv: ReleveInterprete
  controle: ControleSolde | null
  lignes: LigneBancaire[]
  brouillon: EcritureBrouillon[]
  declaration: Declaration2035
  cases: Map<string, number>
  concordance: Concordance2035
  checklist: PointATraiter[]
  validation: EtatDeValidation
  fec: string
  piste: LignePisteAudit[]
  etatDeLaCaisse: EtatDeLaCaisse
}
let p: Parcours

beforeAll(() => {
  // Le drapeau des quatre champs d'un BNC, tel qu'il est : baissé (FEC22c1). Levé, la demande de validation et le FEC portent
  // les champs du choix de l'expert-comptable (FEC22-E2) — ce test se reprend alors, avec ce choix.
  if (CHAMPS_BNC_EXPORTES !== null) throw new Error('CHAMPS_BNC_EXPORTES est levé : la répétition se reprend avec le choix de FEC22-E2.')
  // L'import du relevé par le chemin de l'onglet Banque : le texte, la détection des colonnes, l'interprétation, le contrôle.
  const rows = parseCsv(texteDuReleveCsv())
  const detecte = detectColumnMapping(rows)
  const { donnees } = lignesDeDonnees(rows, detecte.hasHeader, detecte.ligneEnTete)
  const csv = interpreterReleve(donnees, {
    colDate: detecte.colDate, colLibelle: detecte.colLibelle, hasHeader: detecte.hasHeader, format: detecte.format,
    colMontant: detecte.colMontant, colDebit: detecte.colDebit, colCredit: detecte.colCredit, colSolde: detecte.colSolde,
  }, AUCUNE_DECISION)
  const controle = controlerSolde(csv.soldes, csv.operations)
  if (csv.operations.length !== MOUVEMENTS.length) throw new Error(`L'import rend ${csv.operations.length} opérations, l'année en a ${MOUVEMENTS.length}.`)

  // Les lignes de la base : l'opération importée, puis le classement que le cabinet (ou le praticien) lui donne.
  const lignes: LigneBancaire[] = csv.operations.map((o, i) => {
    const x = MOUVEMENTS[i]
    if (o.date !== x.date || o.montant !== x.montant) throw new Error(`Opération ${i} importée ${o.date} ${o.montant}, attendue ${x.date} ${x.montant}.`)
    const k = x.classement
    return {
      id: `00000000-0000-4000-8002-${String(i).padStart(12, '0')}`, dossier_id: D, date: o.date, libelle: o.libelle, montant: o.montant,
      statut: k.type === 'personnel' ? 'ignoree' : 'rapprochee',
      piece_id: k.type === 'piece' ? k.pieceId : null, cotisation_id: k.type === 'cotisation' ? k.cotisationId : null,
      categorie_id: k.type === 'categorie' ? k.categorie.id : null, taux_tva: null, prelevement_personnel: k.type === 'personnel',
      emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false,
      reglement_groupe: k.type === 'groupe', compte_bilan: k.type === 'caisse' ? PLAN.caisse : null, declaration_tva_id: null,
      id_externe: null, source_fichier: 'releve-2025.csv', libelle_brut: o.brut, created_at: `${ANNEE + 1}-01-05T10:00:00Z`,
      encaissements_de_factures: k.type === 'encaissements',
    }
  })
  const reglements = MOUVEMENTS.flatMap((x, i) => (x.classement.type === 'groupe' ? reglementsDuMouvement(lignes[i].id, x.classement.parts) : []))
  const { encaissements, parts } = encaissementsEtParts((factureId) => {
    const i = MOUVEMENTS.findIndex((x) => x.classement.type === 'encaissements' && x.classement.factureId === factureId)
    return i < 0 ? null : lignes[i].id
  })
  const factures = FACTURES.map((f) => f.facture)
  const lignesDeFacture = FACTURES.map((f) => f.ligne)

  // La chaîne de l'onglet Clôture, sur des lectures faites en entier.
  const caisseLue: CaisseLue = { dossierId: D, enBase: true, lignes: OPERATIONS_DE_CAISSE, complete: true, motif: null }
  const recettesDeCaisse = recettesPourLesMoteurs(recettesDeCaisseDuDossier(caisseLue, D, CATEGORIES, ASSUJETTI))
  const operationsDeCaisse = operationsPourLesControles(operationsDeCaisseDuDossier(caisseLue, D))
  const paiementsDeLaCaisse = paiementsParLaCaisseDuDossier(caisseLue, D)
  if (recettesDeCaisse === null || operationsDeCaisse === null || paiementsDeLaCaisse === null) throw new Error('La caisse ne se lit pas.')
  const paiements = paiementsDesPieces(lignes, reglements, [], paiementsDeLaCaisse)
  const partsReleve = partsDuReleve(lignes, CATEGORIES, [], ASSUJETTI)
  const comptees = cotisationsComptees(COTISATIONS, lignes, MODELE.mode)
  const ventes = ventesFacturees({ dossierId: D, factures, lignes: lignesDeFacture, encaissements, parts, acomptes: SANS_ACOMPTE })
  const mouvementsDesEncaissements = lignes.filter((l) => l.encaissements_de_factures)
  const sourcesEcritures: SourcesDesEcrituresDeVente = {
    dossierId: D, factures, lignes: lignesDeFacture, encaissements, parts, mouvements: mouvementsDesEncaissements, exemplaires: [],
  }
  const pourLa2035 = ecrituresDesVentesPourLa2035({
    dossierId: D, ventesParLesFactures: true, facturesSources: ventes.sources, lecture: { dossierId: D, etat: 'lue', sources: sourcesEcritures },
    mode: MODELE.mode, plan: PLAN,
  })
  if (pourLa2035.etat !== 'pret') throw new Error(`Les écritures des ventes ne sont pas prêtes : ${pourLa2035.etat}`)

  // Le brouillon, composé par les moteurs, comme chaque geste l'écrit.
  let e = 0
  const ecriture = (x: Pick<EcritureBrouillon, 'date' | 'compte' | 'libelle' | 'montant' | 'sens'> & Partial<EcritureBrouillon>): EcritureBrouillon => ({
    ...NON_VALIDEE, id: `00000000-0000-4000-8008-${String(e++).padStart(12, '0')}`, dossier_id: D, statut: 'proposee',
    created_at: `${ANNEE + 1}-01-10T10:00:00Z`, piece_id: null, ligne_bancaire_id: null, immobilisation_id: null, vehicule_id: null,
    declaration_tva_id: null, cotisation_id: null, encaissement_id: null, facture_id: null, operation_caisse_id: null, ...x,
  })
  const acquisitions = acquisitionsDesBiens(IMMOBILISATIONS, [NATURE_MATERIEL], null)
  const generation = ecrituresAGenerer(D, piecesAComptabiliser(PIECES, CATEGORIES, acquisitions, ventes.sources), [], ASSUJETTI, paiements, MODELE, null)
  const brouillon: EcritureBrouillon[] = generation.lignes.map((l) => ecriture(l))
  for (const l of lignes) {
    const x = MOUVEMENTS[lignes.indexOf(l)].classement
    const composees = x.type === 'categorie' ? ecritureDuMouvement(l, x.categorie.compte_comptable!, null, PLAN)
      : x.type === 'cotisation' ? ecritureDeLaCotisation(l, COTISATIONS.find((k) => k.id === x.cotisationId)!, MODELE.mode, PLAN)
        : x.type === 'personnel' ? ecritureDuVirementPersonnel(l, MODELE)
          : x.type === 'caisse' ? ecritureDuCompteDeBilan(l, PLAN.caisse, PLAN)
            : []
    for (const k of composees) {
      // Le rapprochement d'une échéance s'écrit sur son MOUVEMENT ; `cotisation_id` ne désigne que le paiement depuis le compte
      // personnel (lib/concordance2035.ts, la référence d'une écriture).
      brouillon.push(ecriture({ date: l.date, ...k, ligne_bancaire_id: l.id }))
    }
  }
  for (const op of OPERATIONS_DE_CAISSE) {
    if (op.genre === 'paiement') continue
    const aEcrire = { genre: op.genre, date: op.date, montant: op.montant, taux_tva: op.taux_tva, categorie: op.genre === 'recette' ? CATEGORIES.find((k) => k.id === op.categorie_id)! : null }
    for (const k of ecritureDeLOperation(aEcrire, MODELE)) brouillon.push(ecriture({ date: op.date, ...k, operation_caisse_id: op.id }))
  }
  const composition = ecrituresDesVentesFacturees({
    sources: { dossierId: D, factures, lignes: lignesDeFacture, encaissements, parts },
    mouvements: mouvementsDesEncaissements, comptesDeContrepartie: new Map(), exemplaires: [], mode: MODELE.mode, plan: PLAN,
  })
  for (const v of composition.ecritures) for (const k of lignesAuBrouillon(D, v)) brouillon.push(ecriture(k))
  for (const bien of IMMOBILISATIONS) {
    for (const k of ecritureDeLaDotation(bien, NATURE_MATERIEL.compte_immobilisation, ANNEE, null, PLAN)) brouillon.push(ecriture({ date: FIN, ...k, immobilisation_id: bien.id }))
  }
  for (const v of VEHICULES) for (const k of ecritureDuForfait(v, MODELE, null) ?? []) brouillon.push(ecriture({ date: FIN, ...k, vehicule_id: v.id }))

  const declaration = calculerDeclaration2035(ANNEE, PIECES, CATEGORIES, IMMOBILISATIONS, comptees, VEHICULES, ASSUJETTI, paiements, partsReleve, [], PLAN, ventes, pourLa2035.ecritures, recettesDeCaisse)
  const contexteConcordance = {
    piecesValidees: new Set(PIECES.map((x) => x.id)), piecesImmobilisees: new Set(IMMOBILISATIONS.map((i) => i.piece_id ?? '')),
    mouvementsDesVentesFacturees: mouvementsClassesParEncaissements(lignes),
  }
  const concordance = concordance2035(declaration, brouillon, contexteConcordance, null)
  const lectureDesSources = { dossierId: D, etat: 'lue' as const, sources: sourcesEcritures }
  const facturesEmises = factures.map((f) => ({ ...f, emetteur_siret: null, superpdp_invoice_id: null }))
  const controlesReleves: ControleReleveBancaire[] = controle ? [{
    id: '00000000-0000-4000-8012-000000000001', dossier_id: D, source_fichier: 'releve-2025.csv', solde_initial: controle.soldeInitial,
    solde_final: controle.soldeFinal, somme_mouvements: controle.sommeMouvements, ecart: controle.ecart, coherent: controle.coherent,
    periode_debut: controle.dateInitiale, periode_fin: controle.dateFinale, created_at: `${ANNEE + 1}-01-05T10:00:00Z`,
  }] : []

  const checklist = pointsDeLaChecklist({
    piecesValidees: PIECES, piecesAValider: [], cotisations: COTISATIONS, lignes, relevesIncoherents: controlesReleves.filter((k) => !k.coherent), controlesReleves, doublonsTexte: [],
    immobilisations: IMMOBILISATIONS, natures: [NATURE_MATERIEL], categories: CATEGORIES, ecritures: brouillon, emprunts: [], ventilations: [],
    ventilationsPartielles: false, reglements, reglementsPartiels: false, paiementsPartiels: false, lettragesManuels: [], vehicules: VEHICULES,
    declarationsTva: [], declarationsPartielles: false, facturesEmises, transmissions: [], jumellesPartielles: false,
    facturesSources: ventes.sources, info: null, infoInconnue: null, anneesCloturees: [], ouverture: null, ouvertureIncomplete: null,
    aNouveaux: A_NOUVEAUX, soldesReportes: [], entreesDeLOuvertureIncompletes: null, ventesFacturees: lectureDesSources, caisse: caisseLue,
    entreesDeLaCaisseIncompletes: null, entreesDeLaRepriseDesBiensIncompletes: null,
  }, {
    assujettiTva: ASSUJETTI, periodiciteTva: 'mensuelle', statutTva: 'exonere', modele: MODELE, frontiere: null, anneesValidees: [],
    aujourdHui: FIN, anneeCourante: ANNEE, moisEcoules: 12, premierJourDuMois: `${ANNEE}-12-01`,
  }).tousLesPointsATraiter

  const validation = prealablesDeValidation({
    annee: ANNEE, anneeCourante: ANNEE + 1, aujourdHui: `${ANNEE + 1}-01-20`, modele: MODELE, assujettiTva: ASSUJETTI, anneesValidees: [],
    lectureIncomplete: null, piecesValidees: PIECES, piecesAValider: [], categories: CATEGORIES, immobilisations: IMMOBILISATIONS,
    natures: [NATURE_MATERIEL], ecritures: brouillon, lignes, ventilations: [], reglements, encaissees: [], cotisations: COTISATIONS,
    vehicules: VEHICULES, emprunts: [], aNouveaux: A_NOUVEAUX, soldesReportes: [], declarationsTva: [], periodiciteTva: 'mensuelle',
    controlesReleves, doublonsTexte: [], facturesEmises, transmissions: [], facturesSources: ventes.sources,
    etatsDesVentes: etatsDesVentesFacturees({ sources: sourcesEcritures, brouillon, mode: MODELE.mode, plan: PLAN, anneesValidees: [], ventesParLesFactures: true }),
    ventesDeLaChecklist: ventesDeLaChecklist(lectureDesSources, null), operationsDeCaisse, champsBnc: CHAMPS_BNC_NON_EXPORTES,
    declaration, saisies2035: AUCUNE_SAISIE_2035, concordance,
  })

  const fec = formaterFec(numeroterFec(brouillon, PIECES, CATEGORIES, A_NOUVEAUX, MODELE, lignes, composition.ecritures, operationsDeCaisse, CHAMPS_BNC_NON_EXPORTES), new Map(), MODELE.mode)
  const piste = pisteAudit(brouillon, PIECES, lignes, A_NOUVEAUX, {
    immobilisations: IMMOBILISATIONS, factures: PIECES, vehicules: VEHICULES, caisse: operationsDeCaisse, plan: PLAN,
    ventes: { ecritures: composition.ecritures, factures, encaissements, exemplaires: [], transmissions: [] },
  })
  const etatDeLaCaisse: EtatDeLaCaisse = {
    compteCaisse: PLAN.caisse, ouvertures: [], operations: OPERATIONS_DE_CAISSE, mouvements: lignes, encaissements, factures,
  }
  p = {
    csv, controle, lignes, brouillon, declaration, cases: valeursDesCases(declaration, AUCUNE_SAISIE_2035).valeurs, concordance, checklist,
    validation, fec, piste, etatDeLaCaisse,
  }
})

describe('la répétition d’une année 2025 : le relevé importé', () => {
  it('le CSV boucle : le solde du 31/12 imprimé par la banque est celui des mouvements', () => {
    expect(p.csv.ecartees).toEqual([])
    expect(p.csv.operations).toHaveLength(MOUVEMENTS.length)
    expect(p.controle).toMatchObject({ soldeInitial: 4000, soldeFinal: c(BANQUE_AU_31_12) / 100, coherent: true, ecart: 0 })
  })

  it('l’OFX du même relevé rend les mêmes opérations, et son solde comptable', () => {
    const lu = lireReleveOfxQif(texteDuReleveOfx())
    if (lu === null || lu.refus !== null) throw new Error(`OFX refusé : ${lu?.refus}`)
    expect(lu.doutes).toEqual([])
    expect(lu.sensDouteux).toEqual([])
    expect(lu.soldeAnnonce).toEqual({ nature: 'comptable', date: FIN, montant: c(BANQUE_AU_31_12) / 100 })
    const ofx = interpreterReleve(lu.lignes, REGLAGE_OFX_QIF, AUCUNE_DECISION)
    expect(ofx.ecartees).toEqual([])
    expect(ofx.operations.map((o) => [o.date, o.libelle, o.montant])).toEqual(p.csv.operations.map((o) => [o.date, o.libelle, o.montant]))
  })
})

describe('la répétition d’une année 2025 : la 2035', () => {
  it.each([
    ['AA', AA], ['BA', BA], ['BF', BF], ['BM', BM], ['BN', BN], ['BK', BK], ['BT', BT], ['BV', BV], ['BJ', BJ], ['CH', CH],
    ['BR', BR], ['CP', RESULTAT],
  ])('la case %s vaut l’attendu tiré à la main', (code, attendu) => {
    expect(c(p.cases.get(code) ?? NaN)).toBe(c(attendu))
  })

  it('aucune TVA : ni case BD, ni compte de TVA au brouillon', () => {
    expect(p.cases.get('BD')).toBe(0)
    expect(p.brouillon.filter((e) => e.compte.startsWith('445'))).toEqual([])
  })

  it('rien d’écarté, rien sans paiement connu, et la facture du 20/12 impayée ne compte pas', () => {
    expect(Object.values(p.declaration.exclusions).every((l) => l.length === 0)).toBe(true)
    expect(p.declaration.sansPaiementConnu).toEqual([])
    expect(c(p.declaration.totalRecettes)).toBe(c(AA))
    expect(c(p.declaration.resultat + CH)).toBe(c(AA - BR))
  })

  it('la 2035 concorde avec les écritures au centime', () => {
    expect(p.concordance.ecarts).toEqual([])
    expect(p.concordance.concorde).toBe(true)
  })
})

describe('la répétition d’une année 2025 : la banque, la caisse, la balance', () => {
  it('le 512 et la caisse au 31/12', () => {
    const balance = calculerBalance(p.brouillon, CATEGORIES, A_NOUVEAUX)
    const solde = (compte: string) => c(balance.find((b) => b.compte === compte)?.solde ?? NaN)
    expect(solde('512000')).toBe(c(BANQUE_AU_31_12))
    expect(solde('530000')).toBe(c(CAISSE_AU_31_12))
    expect(c(balance.reduce((s, b) => s + b.totalDebit, 0))).toBe(c(balance.reduce((s, b) => s + b.totalCredit, 0)))
  })

  it('la caisse, rejouée jour par jour, finit à son solde et ne passe jamais sous zéro', () => {
    const soldes = soldesDeLaCaisse(p.etatDeLaCaisse)
    expect(soldes.at(-1)).toEqual({ jour: '2025-12-29', centimes: c(CAISSE_AU_31_12) })
    expect(soldes.filter((x) => x.centimes < 0)).toEqual([])
  })
})

describe('la répétition d’une année 2025 : la Vue d’ensemble et la validation', () => {
  it('la Checklist n’a aucune erreur, ni aucun point d’attention', () => {
    expect(p.checklist.filter((x) => x.nb > 0).map((x) => `${x.severite} ${x.id} (${x.nb})`)).toEqual([])
  })

  it('les préalables de la validation de l’année complète ne bloquent rien, ni n’avertissent', () => {
    expect(p.validation.prealables.map((x) => `${x.bloquant ? 'bloquant' : 'avertissement'} ${x.id}`)).toEqual([])
    expect(p.validation.validable).toBe(true)
    expect(p.validation.fecSansChampsBnc).toBe(true)
  })
})

describe('la répétition d’une année 2025 : le FEC et la piste d’audit', () => {
  const lignesDuFec = () => p.fec.split('\r\n').filter((l) => l !== '')
  it('l’en-tête de l’article A47 A-1 et dix-huit colonnes sur chaque ligne', () => {
    const [entete, ...lignes] = lignesDuFec()
    expect(entete.split('\t')).toEqual([
      'JournalCode', 'JournalLib', 'EcritureNum', 'EcritureDate', 'CompteNum', 'CompteLib', 'CompAuxNum', 'CompAuxLib', 'PieceRef',
      'PieceDate', 'EcritureLib', 'Debit', 'Credit', 'EcritureLet', 'DateLet', 'ValidDate', 'Montantdevise', 'Idevise',
    ])
    expect(lignes.length).toBe(p.brouillon.length + A_NOUVEAUX.length)
    expect(lignes.filter((l) => l.split('\t').length !== 18)).toEqual([])
  })

  it('chaque écriture s’équilibre, toutes datées dans l’exercice, aucun libellé vide', () => {
    const [, ...lignes] = lignesDuFec().map((l) => l.split('\t'))
    const parEcriture = new Map<string, number>()
    for (const l of lignes) {
      const montant = (x: string) => c(Number(x.replace(',', '.')))
      parEcriture.set(`${l[0]}|${l[2]}`, (parEcriture.get(`${l[0]}|${l[2]}`) ?? 0) + montant(l[11]) - montant(l[12]))
    }
    expect([...parEcriture].filter(([, solde]) => solde !== 0)).toEqual([])
    expect(lignes.filter((l) => l[3] < `${ANNEE}0101` || l[3] > `${ANNEE}1231`)).toEqual([])
    expect(lignes.filter((l) => l[10].trim() === '' || l[5].trim() === '')).toEqual([])
  })

  it('la piste d’audit suit chaque écriture jusqu’à sa preuve, sans maillon manquant', () => {
    // Les à-nouveaux ont leur ligne, comme les écritures du brouillon.
    expect(p.piste.filter((l) => l.ecritureId !== null)).toHaveLength(p.brouillon.length + A_NOUVEAUX.length)
    expect(p.piste.filter((l) => l.manque.length > 0).map((l) => `${l.date} ${l.compte} ${l.libelle} : ${l.manque.join(' ; ')}`)).toEqual([])
    expect(p.piste.filter((l) => l.libelle.trim() === '')).toEqual([])
  })
})
