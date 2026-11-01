import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CARTES_DE_CLOTURE, motsDeLaBase, NOM_DU_MOYEN_SANS_MOUVEMENT, POINTS_DE_LA_CHECKLIST_ECARTES, prealablesDeValidation,
  prochainExerciceAValider, REFUS_VENTES_FACTUREES_DE_LA_VALIDATION, type DonneesDeValidation,
} from './prealablesValidation'
import { calculerDeclaration2035 } from './declaration2035'
import { concordance2035 } from './concordance2035'
import { ecritureDuPaiementPersonnel } from './cotisationPersonnelle'
import { cotisationsComptees } from './cotisationRapprochee'
import { paiementsDesPieces, type PartEncaissee } from './rattachement'
import { lignesPourPiece } from './ecritures'
import type { ModeleComptable } from './engagement'
import { COMPTE_BANQUE } from './comptes'
import type { Emprunt } from './emprunts'
import { formatMoney } from './format'
import type {
  ANouveau, Categorie, ControleReleveBancaire, CotisationDeclaree, DeclarationTva, EcritureBrouillon, Immobilisation,
  LigneBancaire, NatureImmobilisation, OperationCaisse, Piece, ReglementGroupe, SoldeReporte, VehiculeDossier, VentilationBancaire,
} from './types'
import { demandeDeValidation } from './validationExercice'
import type { FacturePourJumelle } from './ventesJumelles'
import { A_NOUVEAU_NON_VALIDE, NON_VALIDEE } from '../test/ecritures'
import { PLAN_PAR_DEFAUT } from './planComptable'
import { SANS_FACTURE_SOURCE, ventesFactureesVides } from '../test/ventesFacturees'
import { derniereDefinitionSql, fichiersDuSchema } from '../test/schema'
import { argumentsSql, codesSql, messagesSql } from '../test/raiseSql'
import { etapesDe } from '../test/essaiSql'
import { correspondAuModele } from '../test/essaiVentesFacturees'
import { brouillonDesVentes, composition, ligneBancaire, sourcesDuDossierBascule } from '../test/dossierBascule'
import { encaissementVendu } from '../test/ventesFacturees'
import { etatsDesVentesFacturees, type SourcesDesEcrituresDeVente } from './ecrituresVentesFactureesEcran'
import { ventesDeLaChecklist } from './ventesDeLaChecklist'
import { ventesFacturees } from './ventesFacturees'
import { frontiereDeValidation } from './validationExercice'
import { CAISSE_ABSENTE } from './recettesDeCaisse'
import { OPERATIONS_DE_CAISSE_ABSENTES } from './controlesDeLaCaisse'
import { ecritureDeLOperation } from './caisse'
import { recetteDeCaisse } from './recettesDeCaisse'
import type { OperationsDeCaisse } from './controlesDeLaCaisse'

// Un petit dossier fictif tenu en trésorerie, exercice 2025 : une facture d'achat payée et écrite comme la
// génération l'écrit. La 2035 et sa concordance avec les écritures sont calculées par les vrais moteurs —
// un préalable qui se trompe sur un dossier juste se verrait ici.
const ACHATS: Categorie = {
  id: 'c-achats', dossier_id: null, code: 'achats', libelle: 'Achats', ordre: 1, compte_comptable: '606100', poste_2035: 'Achats',
}

const piece = (id: string, o: Partial<Piece> = {}): Piece => ({
  id, dossier_id: 'd1', uploaded_by: null, source: 'upload', storage_path: `d1/${id}.pdf`, nom_fichier: `${id}.pdf`,
  storage_hash: null, date_piece: '2025-03-10', tiers: 'Fournisseur', montant_ht: null, montant_tva: null, montant_ttc: 120,
  devise: 'EUR', montant_devise: null, taux_change: null, conversion_source: null, categorie_id: 'c-achats',
  sous_dossier_id: null, type_piece: 'achat', statut: 'validee', notes: null, confiance: null, superpdp_invoice_id: null, flux_hote: null, flux_id: null, lisible_path: null,
  identite_numero: null, identite_siren_vendeur: null, identite_date: null, identite_nature: null, facture_id: null, vente_hors_des_factures: false,
  created_at: '2025-03-10T09:00:00Z', updated_at: '2025-03-10T09:00:00Z', ...o,
})

const ligne = (id: string, o: Partial<LigneBancaire> = {}): LigneBancaire => ({
  id, dossier_id: 'd1', date: '2025-03-12', libelle: 'PRLV FOURNISSEUR', montant: -120, statut: 'rapprochee',
  piece_id: null, cotisation_id: null, categorie_id: null, taux_tva: null, prelevement_personnel: false,
  emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false, reglement_groupe: false, compte_bilan: null, declaration_tva_id: null,
  id_externe: null, source_fichier: 'releve-2025.pdf', libelle_brut: null, created_at: '2025-04-01T09:00:00Z', encaissements_de_factures: false, ...o,
})

const ecriture = (id: string, o: Partial<EcritureBrouillon> = {}): EcritureBrouillon => ({
  id, dossier_id: 'd1', piece_id: 'p1', ligne_bancaire_id: null, date: '2025-03-12', compte: '606100', libelle: 'Fournisseur',
  montant: 120, sens: 'debit', statut: 'proposee', immobilisation_id: null, vehicule_id: null, declaration_tva_id: null, cotisation_id: null, ...NON_VALIDEE,
  created_at: '2025-04-01T09:00:00Z', encaissement_id: null, facture_id: null, ...o,
})

const aNouveau = (date: string): ANouveau => ({
  id: 'an1', dossier_id: 'd1', date, compte: COMPTE_BANQUE, compte_origine: '512', libelle: 'Banque', sens: 'debit', montant: 1000,
  source_nom: 'balance.csv', source_empreinte: 'a'.repeat(64), ...A_NOUVEAU_NON_VALIDE, created_at: '2025-02-01T00:00:00Z',
})
// Une ouverture reprise ÉQUILIBRÉE, comme la base l'exige (`enregistrer_a_nouveaux`) : la banque face au capital.
const ouvertureReprise = (date: string): ANouveau[] => [
  aNouveau(date),
  { ...aNouveau(date), id: 'an2', compte: '101000', compte_origine: '101', libelle: 'Capital individuel', sens: 'credit' },
]
// Un solde reporté par la validation de l'exercice précédent (ligne 34).
const reporte = (id: string, date: string, compte: string, libelle: string, sens: 'debit' | 'credit', montant: number): SoldeReporte => ({
  id, dossier_id: 'd1', date, compte, libelle, sens, montant, source_nom: `Exercice ${Number(date.slice(0, 4)) - 1} validé`,
  source_empreinte: 'b'.repeat(64), created_at: `${date}T00:00:00Z`, ...A_NOUVEAU_NON_VALIDE,
})

const RECETTES: Categorie = {
  id: 'c-recettes', dossier_id: null, code: 'recettes', libelle: 'Honoraires encaissés', ordre: 2, compte_comptable: '706000',
  poste_2035: 'Recettes',
}
const MATERIEL: NatureImmobilisation = {
  id: 'n1', dossier_id: null, libelle: 'Matériel', duree_annees_defaut: 5, ordre: 1, compte_immobilisation: '218300',
}
const part = (id: string, ligne: string, categorie: string | null, montant: number): VentilationBancaire => ({
  id, dossier_id: 'd1', ligne_bancaire_id: ligne, categorie_id: categorie, part_personnelle: categorie === null, montant,
  taux_tva: null, created_at: '2025-01-01T00:00:00Z',
})
const partReglee = (id: string, ligne: string, pieceId: string | null, montant: number): ReglementGroupe => ({
  id, dossier_id: 'd1', ligne_bancaire_id: ligne, piece_id: pieceId, montant, created_at: '2025-01-01T00:00:00Z',
})
const echeance = (id: string, date: string, montant: number): CotisationDeclaree => ({
  id, dossier_id: 'd1', echeance: date, montant_appele: montant, montant_verse: null, montant_csg_crds: null,
  previsionnel: false, created_at: '2025-01-01T00:00:00Z', paiement_personnel_le: null,
})
const bien = (id: string, o: Partial<Immobilisation> = {}): Immobilisation => ({
  id, dossier_id: 'd1', piece_id: 'p9', nature_id: 'n1', libelle: 'Fauteuil', valeur: 1200, date_acquisition: '2025-01-01',
  date_mise_en_service: null, duree_annees: 5, created_at: '2025-01-01T00:00:00Z', ...o,
})
// Une déclaration de TVA enregistrée par la CA3 de l'application, néant par défaut : sa liquidation ne porte rien.
const declarationTva = (id: string, debut: string, fin: string, o: Partial<DeclarationTva> = {}): DeclarationTva => ({
  id, dossier_id: 'd1', periode_debut: debut, periode_fin: fin, tva_declaree: 0, credit_anterieur: 0, remboursement_demande: 0,
  date_declaration: null, notes: null, created_at: '2025-01-01T00:00:00Z', cases: {}, tva_collectee: 0, tva_deductible: 0,
  tva_deductible_immobilisations: 0, ...o,
})
const vehicule = (id: string, annee: number, km: number): VehiculeDossier => ({
  id, dossier_id: 'd1', annee, modele: 'Clio', type: 'voiture', puissance_fiscale: 5, bareme: 'bnc', motorisation: 'thermique',
  carburant: 'diesel', km_professionnel: km, inscrit_immobilisations: false, amortissements_a_reintegrer: null,
  created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z',
})

// Une facture émise validée (ligne 28.6) : sa vente revient comme pièce de la plateforme du client ou de Super PDP.
const factureEmise = (o: Partial<FacturePourJumelle> = {}): FacturePourJumelle => ({
  id: 'f1', dossier_id: 'd1', statut: 'validee', type: 'facture', numero: 'F2025-0001', date_emission: '2025-06-01',
  emetteur_siret: '12345678900012', superpdp_invoice_id: 4242, ...o,
})

const P1 = piece('p1')
const L1 = ligne('l1', { piece_id: 'p1' })
const E1 = ecriture('e1')
const E2 = ecriture('e2', { compte: COMPTE_BANQUE, sens: 'credit', ligne_bancaire_id: 'l1' })

type Surcharges = Partial<Omit<DonneesDeValidation, 'declaration' | 'concordance'>>

// Les données de validation de 2025, la 2035 et la concordance recalculées sur les données passées.
function donnees(o: Surcharges = {}): DonneesDeValidation {
  const base: Omit<DonneesDeValidation, 'declaration' | 'concordance'> = {
    annee: 2025, anneeCourante: 2026, aujourdHui: '2026-03-15', modele: { mode: 'tresorerie', compteNotesDeFrais: '108000', plan: PLAN_PAR_DEFAUT }, assujettiTva: false,
    anneesValidees: [], lectureIncomplete: null, piecesValidees: [P1], piecesAValider: [], categories: [ACHATS],
    immobilisations: [], natures: [], ecritures: [E1, E2], lignes: [L1], ventilations: [], reglements: [], encaissees: [], cotisations: [],
    vehicules: [], emprunts: [], aNouveaux: [], soldesReportes: [], declarationsTva: [], periodiciteTva: 'trimestrielle', relevesIncoherents: [],
    doublonsTexte: [], facturesEmises: [], transmissions: [], facturesSources: SANS_FACTURE_SOURCE,
    etatsDesVentes: { etat: 'sans_objet' }, ventesDeLaChecklist: { etat: 'sans_objet' }, operationsDeCaisse: OPERATIONS_DE_CAISSE_ABSENTES, ...o,
  }
  if (base.modele.mode === 'engagement') return { ...base, declaration: null, concordance: null }
  const paiements = paiementsDesPieces(base.lignes, base.reglements, base.encaissees, [])
  const declaration = calculerDeclaration2035(
    base.annee, [...base.piecesValidees], [...base.categories], [...base.immobilisations], [], [...base.vehicules],
    base.assujettiTva, paiements, [], base.declarationsTva, PLAN_PAR_DEFAUT, ventesFactureesVides('d1'),
    { etat: 'sans_bascule' }, CAISSE_ABSENTE,
  )
  const ouverture = base.aNouveaux.length > 0 ? base.aNouveaux[0].date : null
  const concordance = concordance2035(
    declaration, base.ecritures,
    { piecesValidees: new Set(base.piecesValidees.map((p) => p.id)), piecesImmobilisees: new Set(), mouvementsDesVentesFacturees: new Set() },
    ouverture,
  )
  return { ...base, declaration, concordance }
}

const ids = (d: DonneesDeValidation) => prealablesDeValidation(d).prealables.map((p) => p.id)
const prealable = (d: DonneesDeValidation, id: string) => prealablesDeValidation(d).prealables.find((p) => p.id === id)

describe('prealablesDeValidation — un exercice tenu', () => {
  it('ne trouve rien à redire, et rend la numérotation que la validation enverra', () => {
    const etat = prealablesDeValidation(donnees())
    expect(etat.prealables).toEqual([])
    expect(etat.validable).toBe(true)
    expect(etat.numerotation!.lignes.map((l) => [l.ecriture.id, l.journal, l.numero])).toEqual([['e1', 'AC', 1], ['e2', 'AC', 1]])
  })

  // Une lecture partielle ne commande pas d'écriture, et une validation est l'écriture la plus définitive qui soit.
  it('s’arrête sur une lecture partielle, sans rien conclure d’autre', () => {
    const etat = prealablesDeValidation(donnees({ lectureIncomplete: 'pièces : 1 000 lues sur 1 200' }))
    expect(etat.prealables.map((p) => [p.id, p.bloquant])).toEqual([['lecture-partielle', true]])
    expect(etat.prealables[0].message).toContain('1 000 lues sur 1 200')
    expect(etat.numerotation).toBeNull()
    expect(etat.validable).toBe(false)
  })
})

// L'OUVERTURE DE L'EXERCICE SUIVANT (ligne 34) : la validation l'écrit dans le même clic, et la numérotation de
// l'exercice reçoit les soldes que la validation précédente a reportés — la base exige qu'elle couvre exactement la
// reprise de l'exercice et ses soldes reportés.
describe('prealablesDeValidation — le report des soldes', () => {
  // L'exercice 2024 validé dont ces soldes sont le report : l'apport de l'exploitant, 1 000 € en banque face au 108, que
  // le report verse au capital individuel — l'ouverture de 2025 reprend ainsi sa clôture (O33-Q1).
  const EXERCICE_2024 = [
    ecriture('e-2024-1', { piece_id: null, date: '2024-01-02', compte: COMPTE_BANQUE, montant: 1000, statut: 'validee' }),
    ecriture('e-2024-2', { piece_id: null, date: '2024-01-02', compte: '108000', montant: 1000, sens: 'credit', statut: 'validee' }),
  ]
  const REPORTES = [
    reporte('s1', '2025-01-01', COMPTE_BANQUE, 'Banque', 'debit', 1000),
    reporte('s2', '2025-01-01', '101000', 'Capital individuel', 'credit', 1000),
    // Ceux qui ouvrent un autre exercice n'y entrent pas.
    reporte('s3', '2026-01-01', COMPTE_BANQUE, 'Banque', 'debit', 880),
  ]

  it('numérote les soldes reportés qui ouvrent l’exercice, et eux seuls, et les envoie à la base', () => {
    const etat = prealablesDeValidation(donnees({ anneesValidees: [2024], soldesReportes: REPORTES, ecritures: [E1, E2, ...EXERCICE_2024] }))
    expect(etat.prealables).toEqual([])
    expect(etat.numerotation!.aNouveaux.map((a) => a.aNouveau.id)).toEqual(['s2', 's1'])
    expect(etat.numerotation!.aNouveaux.every((a) => a.aNouveau.compte_origine === null)).toBe(true)
    expect(demandeDeValidation(etat.numerotation!, null).p_a_nouveaux).toEqual([
      { id: 's2', compte_lib: 'Capital individuel', ecriture_lib: 'À-nouveau Capital individuel' },
      { id: 's1', compte_lib: 'Banque', ecriture_lib: 'À-nouveau Banque' },
    ])
  })

  it('montre l’ouverture de l’exercice suivant : le résultat d’une entreprise individuelle au capital individuel', () => {
    const etat = prealablesDeValidation(donnees({ anneesValidees: [2024], soldesReportes: REPORTES }))
    expect(etat.report).toMatchObject({ exercice: 2025, date: '2026-01-01', source: 'Exercice 2025 validé', resultat: -120 })
    expect(etat.report!.soldes).toEqual([
      { compte: '101000', libelle: 'Capital individuel', sens: 'credit', montant: 880 },
      { compte: COMPTE_BANQUE, libelle: 'Banque', sens: 'debit', montant: 880 },
    ])
    // Sur une lecture partielle, rien n'est calculé.
    expect(prealablesDeValidation(donnees({ lectureIncomplete: 'x' })).report).toBeNull()
  })

  it('refuse un compte qui ne se reporterait pas, avec ses numéros', () => {
    const d = donnees({ categories: [{ ...ACHATS, compte_comptable: '801000' }], ecritures: [ecriture('e1', { compte: '801000' }), E2] })
    expect(prealable(d, 'report-hors-classes')).toMatchObject({ nb: 1, bloquant: true, cible: 'ecritures', detail: 'Comptes : 801000.' })
    expect(prealable(d, 'report-hors-classes')!.message).toContain("à la fin de l'exercice 2025 : il ne se reporterait pas")
    expect(ids(donnees())).not.toContain('report-hors-classes')
  })

  it('refuse une ouverture qui ne s’équilibre pas — sauf à côté d’une écriture déséquilibrée, qui en est la cause', () => {
    const seule = donnees({ anneesValidees: [2024], soldesReportes: [REPORTES[0]] })
    expect(prealable(seule, 'report-desequilibre')).toMatchObject({
      nb: null, bloquant: true, cible: 'ecritures', detail: 'Écart de 1000,00 € entre les débits et les crédits.',
      message: "Les soldes de l'exercice 2025 ne s'équilibrent pas, à-nouveaux compris : l'ouverture de l'exercice suivant ne peut pas s'écrire.",
    })
    const desequilibree = donnees({ ecritures: [E1, ecriture('e2', { compte: COMPTE_BANQUE, sens: 'credit', ligne_bancaire_id: 'l1', montant: 100 })] })
    expect(ids(desequilibree)).toContain('ecritures-desequilibrees')
    expect(ids(desequilibree)).not.toContain('report-desequilibre')
  })
})

// L'OUVERTURE DE L'EXERCICE CONFRONTÉE À LA CLÔTURE DU PRÉCÉDENT (O33-Q1, décision du cabinet du 18/10/2026) : la
// confrontation de l'onglet Bilan (lib/ouvertureConfrontee.ts), dont un écart retient la validation. 2024 validé, tenu dans
// l'application : l'apport de l'exploitant, 1 000 € en banque face au 108. Sa clôture, telle que le report la verse :
// 512000 1 000 D, 101000 1 000 C (le 108 au capital individuel, PCG, art. 1211-10). Les soldes reportés au 01/01/2025
// la reprennent, ou s'en écartent d'une façon choisie.
describe('prealablesDeValidation — l’ouverture confrontée à la clôture de l’exercice précédent', () => {
  const APPORT_2024 = [
    ecriture('a1', { piece_id: null, date: '2024-01-02', compte: COMPTE_BANQUE, montant: 1000, statut: 'validee' }),
    ecriture('a2', { piece_id: null, date: '2024-01-02', compte: '108000', montant: 1000, sens: 'credit', statut: 'validee' }),
  ]
  const ouvertPar = (soldes: [compte: string, sens: 'debit' | 'credit', montant: number][], o: Surcharges = {}) => donnees({
    anneesValidees: [2024], ecritures: [E1, E2, ...APPORT_2024],
    soldesReportes: soldes.map(([compte, sens, montant], i) => reporte(`s${i}`, '2025-01-01', compte, `Compte ${compte}`, sens, montant)),
    ...o,
  })
  const SUITE = "L'ouverture de 2025 est faite des soldes reportés à la validation de 2024, figés avec lui : l'écart ne vient pas "
    + "d'une saisie et ne se corrige pas dans l'application. Le signaler. Le détail, compte par compte, est dans l'onglet Bilan "
    + "de l'exercice 2025, à la ligne « Ouverture »."
  const message = (combien: string) => `L'ouverture de l'exercice 2025 ne reprend pas la clôture de 2024 : ${combien} en écart. `
    + "Le bilan d'ouverture doit correspondre au bilan de clôture de l'exercice précédent (code de commerce, art. L123-19 ; "
    + "PCG, art. 112-2) : l'exercice 2025 ne se valide pas sur cet écart."

  it('une ouverture qui reprend la clôture ne retient rien', () => {
    const etat = prealablesDeValidation(ouvertPar([[COMPTE_BANQUE, 'debit', 1000], ['101000', 'credit', 1000]]))
    expect(etat.prealables).toEqual([])
    expect(etat.validable).toBe(true)
  })

  it('un écart d’un centime retient la validation, et dit ses rubriques, leurs montants et leurs comptes', () => {
    const etat = prealablesDeValidation(ouvertPar([[COMPTE_BANQUE, 'debit', 1000.01], ['101000', 'credit', 1000.01]]))
    expect(etat.validable).toBe(false)
    expect(etat.prealables).toEqual([{
      id: 'ouverture-en-ecart', nb: null, cible: 'bilan', bloquant: true,
      message: message('2 comptes et 2 rubriques du bilan'),
      detail: `En écart : Disponibilités (actif), ouverture ${formatMoney(1000.01)}, clôture de 2024 ${formatMoney(1000)} (compte `
        + `512000) ; Capital social ou individuel (passif), ouverture ${formatMoney(1000.01)}, clôture de 2024 ${formatMoney(1000)} `
        + `(compte 101000). ${SUITE}`,
    }])
  })

  it('une rubrique dit tous ses comptes en écart, au pluriel', () => {
    // 512000 900 D et 530000 99,99 D, quand la clôture porte 1 000 € en banque et rien en caisse.
    const d = ouvertPar([[COMPTE_BANQUE, 'debit', 900], ['530000', 'debit', 99.99], ['101000', 'credit', 999.99]])
    expect(prealable(d, 'ouverture-en-ecart')).toMatchObject({
      message: message('3 comptes et 2 rubriques du bilan'),
      detail: `En écart : Disponibilités (actif), ouverture ${formatMoney(999.99)}, clôture de 2024 ${formatMoney(1000)} (comptes `
        + `512000, 530000) ; Capital social ou individuel (passif), ouverture ${formatMoney(999.99)}, clôture de 2024 `
        + `${formatMoney(1000)} (compte 101000). ${SUITE}`,
    })
  })

  it('un seul compte, une seule rubrique : au singulier', () => {
    const d = ouvertPar([[COMPTE_BANQUE, 'debit', 1000.01], ['101000', 'credit', 1000]])
    expect(prealable(d, 'ouverture-en-ecart')!.message).toBe(message('1 compte et 1 rubrique du bilan'))
  })

  it('deux écarts qui se compensent dans une rubrique : les comptes se disent à part, sans rubrique', () => {
    // Le 108 reporté tel quel au lieu du 101000 : le capital individuel concorde, les deux comptes non.
    const d = ouvertPar([[COMPTE_BANQUE, 'debit', 1000], ['108000', 'credit', 1000]])
    expect(prealable(d, 'ouverture-en-ecart')).toMatchObject({
      bloquant: true,
      message: message('2 comptes'),
      detail: `Comptes en écart dans des rubriques qui concordent, les écarts s'y compensant : 101000, 108000. ${SUITE}`,
    })
  })

  it('sans confrontation, rien ne se retient ni ne se dit : premier exercice, reprise, ouverture en attente', () => {
    // Le premier exercice du dossier : rien ne le précède dans l'application.
    expect(ids(donnees())).toEqual([])
    // 2025 s'ouvre par une balance reprise : 2024 est tenu dans le logiciel précédent (O33-Q2, plus tard).
    expect(ids(donnees({ aNouveaux: ouvertureReprise('2025-01-01') }))).toEqual([])
    // 2024 n'est pas validé : l'ouverture de 2025 l'attend, et l'ordre seul refuse.
    expect(ids(donnees({ anneesValidees: [2023], ecritures: [E1, E2, ...APPORT_2024] }))).toEqual(['ordre'])
    // 2024 ne s'établit pas — son ouverture attend 2023, que rien n'a validé : la confrontation n'a pas lieu, et le
    // préalable suit ce qu'elle dit.
    const avecDesEcrituresDe2023 = ouvertPar([[COMPTE_BANQUE, 'debit', 1], ['101000', 'credit', 1]], {
      ecritures: [E1, E2, ...APPORT_2024, ecriture('x1', { piece_id: null, date: '2023-05-01', statut: 'validee' })],
    })
    expect(ids(avecDesEcrituresDe2023)).not.toContain('ouverture-en-ecart')
  })

  it('sur une lecture partielle, ne confronte rien et retient la validation en disant pourquoi', () => {
    const etat = prealablesDeValidation(ouvertPar([[COMPTE_BANQUE, 'debit', 1000.01], ['101000', 'credit', 1000.01]], {
      lectureIncomplete: 'soldes reportés : 1 lu sur 2',
    }))
    expect(etat.prealables.map((p) => p.id)).toEqual(['lecture-partielle'])
    expect(etat.prealables[0].message).toContain('soldes reportés : 1 lu sur 2')
    expect(etat.validable).toBe(false)
  })
})

describe('prealablesDeValidation — ce que la base refusera, avec ses mots', () => {
  it('refuse un exercice en cours', () => {
    expect(prealable(donnees({ annee: 2026 }), 'exercice-en-cours')?.message).toBe("L'exercice 2026 n'est pas terminé : il se valide une fois clos.")
    // Le garde symétrique : l'exercice qui précède l'année en cours se valide.
    expect(ids(donnees({ annee: 2025, anneeCourante: 2026 }))).not.toContain('exercice-en-cours')
  })

  it('refuse un exercice déjà validé, ou pris hors de l’ordre', () => {
    expect(prealable(donnees({ anneesValidees: [2025] }), 'deja-valide')?.message).toBe("L'exercice 2025 est déjà validé, ou un exercice postérieur l'est.")
    expect(prealable(donnees({ anneesValidees: [2023] }), 'ordre')?.message).toBe("L'exercice 2024 n'est pas validé : les exercices se valident dans l'ordre.")
    // L'écran mène à l'exercice qui se valide d'abord.
    expect(prealable(donnees({ anneesValidees: [2023] }), 'ordre')?.exercice).toBe(2024)
    expect(ids(donnees({ anneesValidees: [2024] }))).toEqual([])
  })

  it('refuse un exercice des comptes repris, et fait valider d’abord celui des à-nouveaux', () => {
    expect(prealable(donnees({ aNouveaux: [aNouveau('2026-01-01')] }), 'avant-ouverture')?.message)
      .toBe("L'exercice 2025 précède l'ouverture du dossier : il est dans les comptes repris.")
    expect(prealable(donnees({ aNouveaux: [aNouveau('2024-01-01')] }), 'ouverture-d-abord')?.message)
      .toBe("L'exercice 2024 porte les à-nouveaux du dossier : il se valide d'abord.")
    expect(prealable(donnees({ aNouveaux: [aNouveau('2024-01-01')] }), 'ouverture-d-abord')?.exercice).toBe(2024)
    // Un exercice des comptes repris ne se valide pas : rien à quoi mener.
    expect(prealable(donnees({ aNouveaux: [aNouveau('2026-01-01')] }), 'avant-ouverture')?.exercice).toBeUndefined()
    // L'exercice des à-nouveaux validé, l'ouverture de 2025 en est le report (O33-Q1) : la reprise, que rien n'a mouvementée.
    expect(ids(donnees({
      aNouveaux: ouvertureReprise('2024-01-01'), anneesValidees: [2024],
      soldesReportes: [
        reporte('s1', '2025-01-01', COMPTE_BANQUE, 'Banque', 'debit', 1000),
        reporte('s2', '2025-01-01', '101000', 'Capital individuel', 'credit', 1000),
      ],
    }))).toEqual([])
  })

  it('refuse des écritures antérieures non validées — et, avant l’ouverture, dit de les retirer ou de les redater', () => {
    const ancienne = ecriture('e0', { piece_id: null, ligne_bancaire_id: null, date: '2024-06-01' })
    expect(prealable(donnees({ ecritures: [E1, E2, ancienne] }), 'ecritures-anterieures')?.message)
      .toBe("L'exercice 2024 porte des écritures qui ne sont pas validées : les exercices se valident dans l'ordre.")
    expect(prealable(donnees({ ecritures: [E1, E2, ancienne] }), 'ecritures-anterieures')?.exercice).toBe(2024)
    expect(prealable(donnees({ ecritures: [E1, E2, ancienne], aNouveaux: [aNouveau('2025-01-01')] }), 'ecritures-anterieures')?.message)
      .toBe("Des écritures antérieures à l'ouverture du dossier ne sont pas validées : cette période est dans les comptes repris, les retirer ou les redater avant la validation.")
    // Avant l'ouverture, aucun exercice ne se valide : on retire ou on redate, on ne mène nulle part.
    expect(prealable(donnees({ ecritures: [E1, E2, ancienne], aNouveaux: [aNouveau('2025-01-01')] }), 'ecritures-anterieures')?.exercice)
      .toBeUndefined()
  })

  it('refuse des mouvements à traiter jusqu’au 31 décembre, pas au-delà', () => {
    expect(prealable(donnees({ lignes: [L1, ligne('l9', { statut: 'non_rapprochee', date: '2025-12-31' })] }), 'mouvements-a-traiter')?.message)
      .toBe("L'exercice 2025 porte des mouvements bancaires à traiter : ils se traitent avant la validation.")
    expect(ids(donnees({ lignes: [L1, ligne('l9', { statut: 'non_rapprochee', date: '2026-01-01' })] }))).not.toContain('mouvements-a-traiter')
    expect(prealable(donnees({ lignes: [L1, ligne('l9', { statut: 'non_rapprochee', date: '2024-12-01' })], aNouveaux: [aNouveau('2025-01-01')] }), 'mouvements-a-traiter')?.message)
      .toBe("Des mouvements bancaires antérieurs à l'ouverture du dossier restent à traiter : les ignorer avant la validation.")
  })
})

describe('prealablesDeValidation — la validation fige tout ce qui précède', () => {
  // Le garde symétrique de « avant l'ouverture » et « l'ouverture d'abord » : l'exercice qui porte les à-nouveaux
  // se valide, et sa numérotation les porte — eux seuls.
  it('valide l’exercice qui porte l’ouverture, à-nouveaux compris dans sa numérotation', () => {
    const etat = prealablesDeValidation(donnees({ aNouveaux: ouvertureReprise('2025-01-01') }))
    expect(etat.prealables).toEqual([])
    expect(etat.numerotation!.aNouveaux.map((a) => a.aNouveau.id)).toEqual(['an2', 'an1'])
    expect(prealablesDeValidation(donnees({ aNouveaux: [aNouveau('2024-01-01')], anneesValidees: [2024] })).numerotation!.aNouveaux).toEqual([])
  })

  it('ne retient pas une écriture antérieure déjà validée', () => {
    // Un achat de 2024 payé en 2024, validé ; l'ouverture de 2025 en est le report : la banque, et la perte au capital
    // individuel (O33-Q1).
    const ancienne = ecriture('e0', { piece_id: null, ligne_bancaire_id: null, date: '2024-06-01', statut: 'validee' })
    const banque = ecriture('e00', { piece_id: null, ligne_bancaire_id: null, date: '2024-06-01', statut: 'validee', compte: COMPTE_BANQUE, sens: 'credit' })
    const soldesReportes = [
      reporte('s1', '2025-01-01', COMPTE_BANQUE, 'Banque', 'credit', 120),
      reporte('s2', '2025-01-01', '101000', 'Capital individuel', 'debit', 120),
    ]
    expect(ids(donnees({ ecritures: [E1, E2, ancienne, banque], anneesValidees: [2024], soldesReportes }))).toEqual([])
  })

  // Sans ouverture ni exercice validé, valider 2025 figerait 2024 sans qu'il l'ait été.
  it('fait valider d’abord le premier exercice qui porte quelque chose', () => {
    const message = "L'exercice 2024 porte déjà des pièces, des mouvements ou des écritures : il se valide d'abord. Valider 2025 le figerait sans qu'il l'ait été."
    const actifs: Surcharges[] = [
      { piecesAValider: [piece('a0', { statut: 'a_valider', date_piece: '2024-11-02' })] },
      { piecesValidees: [P1, piece('p0', { date_piece: '2024-11-02', montant_ttc: 30 })] },
      { lignes: [L1, ligne('l0', { date: '2024-12-20', statut: 'ignoree', prelevement_personnel: true, montant: -400 })] },
      { cotisations: [echeance('c0', '2024-11-05', 300)] },
      { vehicules: [vehicule('v0', 2024, 1200)] },
      { immobilisations: [bien('i0', { date_acquisition: '2024-06-01' })], natures: [MATERIEL] },
    ]
    for (const o of actifs) expect(prealable(donnees(o), 'exercice-anterieur-d-abord')).toMatchObject({ message, exercice: 2024 })
    // Un mouvement ignoré n'est pas une activité, un véhicule sans kilomètre non plus ; une ouverture ou un exercice
    // validé fige déjà ce qui précède.
    expect(ids(donnees({ lignes: [L1, ligne('l0', { date: '2024-12-20', statut: 'ignoree' })] }))).toEqual([])
    expect(ids(donnees({ vehicules: [vehicule('v0', 2024, 0)] }))).toEqual([])
    expect(ids(donnees({ ...actifs[0], aNouveaux: [aNouveau('2025-01-01')] }))).not.toContain('exercice-anterieur-d-abord')
  })

  // Une pièce que la frontière coupe — sa facture dans l'exercice validé, son règlement dans celui qu'on valide — ne se
  // juge que sur sa part ouverte (lib/ecritures.ts) : la facture validée, sur l'ancien compte de sa catégorie, ne se
  // réécrira plus, et la dire « à régénérer » refuserait la validation pour toujours.
  it('ne juge une pièce coupée par l’exercice validé que sur sa part ouverte', () => {
    const engagement: ModeleComptable = { mode: 'engagement', compteNotesDeFrais: '455000', plan: PLAN_PAR_DEFAUT }
    const facture = piece('p1', { date_piece: '2025-12-20', created_at: '2025-12-21T09:00:00Z' })
    const janvier = ligne('l-jan', { date: '2026-01-05', piece_id: 'p1' })
    // Telles que la génération les écrit ; la facture a été validée avec 2025, son règlement est de 2026.
    const ecrites = lignesPourPiece('d1', facture, { compte: '606100', immobilisation: false }, false,
      paiementsDesPieces([janvier], [], [], []).get('p1') ?? [], engagement)
      .map((l, i) => ecriture(`e${i}`, { ...l, ligne_bancaire_id: l.ligne_bancaire_id ?? null, statut: l.date <= '2025-12-31' ? 'validee' : 'proposee' }))
    expect(ecrites.map((e) => [e.date, e.compte, e.statut])).toEqual([
      ['2025-12-20', '606100', 'validee'], ['2025-12-20', '401000', 'validee'],
      ['2026-01-05', '401000', 'proposee'], ['2026-01-05', COMPTE_BANQUE, 'proposee'],
    ])
    // La catégorie est passée au 606300 depuis la validation : la facture validée reste sur l'ancien compte.
    const d = donnees({
      annee: 2026, anneeCourante: 2027, aujourdHui: '2027-03-15', anneesValidees: [2025], modele: engagement, piecesValidees: [facture],
      categories: [{ ...ACHATS, compte_comptable: '606300' }], lignes: [janvier], ecritures: ecrites,
      // L'ouverture de 2026, report de 2025 validé (O33-Q1) : la dette au fournisseur, et la perte d'une société au 129000.
      soldesReportes: [
        reporte('s1', '2026-01-01', '129000', 'Résultat de l’exercice (perte)', 'debit', 120),
        reporte('s2', '2026-01-01', '401000', 'Fournisseurs', 'credit', 120),
      ],
    })
    expect(ids(d)).toEqual([])
    // En engagement aussi, l'ouverture se confronte : sans ses soldes reportés, elle ne reprend pas la clôture de 2025.
    expect(ids({ ...d, soldesReportes: [] })).toEqual(['ouverture-en-ecart'])
    // Son règlement manque — le mouvement rapproché, l'écriture pas encore là : la part ouverte le dit.
    expect(ids({ ...d, ecritures: ecrites.filter((e) => e.date <= '2025-12-31') })).toContain('desynchronisees')
  })

  it('ne le répète pas quand les écritures antérieures l’ont déjà nommé', () => {
    const ancienne = ecriture('e0', { piece_id: 'p0', date: '2024-11-02', montant: 30 })
    const etat = ids(donnees({ piecesValidees: [P1, piece('p0', { date_piece: '2024-11-02', montant_ttc: 30 })], ecritures: [E1, E2, ancienne] }))
    expect(etat).toContain('ecritures-anterieures')
    expect(etat).not.toContain('exercice-anterieur-d-abord')
  })
})

// L'exercice que les préalables d'ordre réclament, que Clôture propose même quand rien d'autre ne l'y ferait paraître.
describe('prochainExerciceAValider', () => {
  it('rend l’exercice qui suit le dernier validé, tant qu’il est terminé', () => {
    expect(prochainExerciceAValider(donnees({ anneesValidees: [2023] }))).toBe(2024)
    expect(prochainExerciceAValider(donnees({ anneesValidees: [2024, 2023] }))).toBe(2025)
    expect(prochainExerciceAValider(donnees({ anneesValidees: [2025] }))).toBeNull()
  })

  it('sans validation, rend l’exercice de l’ouverture d’un dossier repris', () => {
    expect(prochainExerciceAValider(donnees({ aNouveaux: [aNouveau('2024-01-01')] }))).toBe(2024)
    expect(prochainExerciceAValider(donnees({ aNouveaux: [aNouveau('2026-01-01')] }))).toBeNull()
    // L'ouverture l'emporte sur une activité antérieure : cette période est dans les comptes repris.
    expect(prochainExerciceAValider(donnees({ aNouveaux: [aNouveau('2025-01-01')], cotisations: [echeance('c0', '2023-11-05', 300)] }))).toBe(2025)
  })

  // Une année qui ne porte qu'une échéance de cotisation, un forfait ou la mise en service d'un bien n'est pas dans la
  // liste des exercices de l'en-tête : c'est pourquoi Clôture la propose elle-même.
  it('sans ouverture ni validation, rend le premier exercice qui porte quelque chose', () => {
    expect(prochainExerciceAValider(donnees())).toBe(2025)
    expect(prochainExerciceAValider(donnees({ cotisations: [echeance('c0', '2023-11-05', 300)] }))).toBe(2023)
    expect(prochainExerciceAValider(donnees({ vehicules: [vehicule('v0', 2022, 800)] }))).toBe(2022)
    expect(prochainExerciceAValider(donnees({
      immobilisations: [bien('i0', { date_acquisition: '2023-12-20', date_mise_en_service: '2024-01-15' })],
    }))).toBe(2024)
    // Un mouvement ignoré n'est pas une activité.
    expect(prochainExerciceAValider(donnees({ lignes: [L1, ligne('l0', { date: '2023-12-20', statut: 'ignoree' })] }))).toBe(2025)
  })

  // Une échéance compte au prélèvement qui la paie, comme dans la 2035 et le FEC : prélevée l'exercice suivant, elle ne
  // fait pas de son échéance un exercice à valider.
  it('date une échéance de cotisation au prélèvement qui la paie', () => {
    const prelevee = { cotisations: [echeance('c0', '2024-12-05', 300)], lignes: [L1, ligne('l0', { date: '2025-01-06', montant: -300, cotisation_id: 'c0' })] }
    expect(prochainExerciceAValider(donnees(prelevee))).toBe(2025)
    expect(ids(donnees(prelevee))).not.toContain('exercice-anterieur-d-abord')
    // Le garde symétrique : sans prélèvement, elle compte à son échéance.
    expect(prochainExerciceAValider(donnees({ cotisations: [echeance('c0', '2024-12-05', 300)] }))).toBe(2024)
  })

  it('ne rend rien quand rien n’est à valider, ou que tout est dans l’exercice en cours', () => {
    expect(prochainExerciceAValider(donnees({ piecesValidees: [], ecritures: [], lignes: [] }))).toBeNull()
    expect(prochainExerciceAValider(donnees({
      piecesValidees: [piece('p1', { date_piece: '2026-02-01' })], lignes: [ligne('l1', { piece_id: 'p1', date: '2026-02-03' })],
      ecritures: [ecriture('e1', { date: '2026-02-03' })],
    }))).toBeNull()
  })
})

describe('prealablesDeValidation — ce qui resterait en suspens', () => {
  it('refuse une pièce à valider de l’exercice, pas celle d’un autre ni celle des comptes repris', () => {
    expect(prealable(donnees({ piecesAValider: [piece('a1', { statut: 'a_valider', date_piece: '2025-11-02' })] }), 'pieces-a-valider')?.nb).toBe(1)
    expect(ids(donnees({ piecesAValider: [piece('a1', { statut: 'a_valider', date_piece: '2026-01-02' })] }))).not.toContain('pieces-a-valider')
    expect(ids(donnees({
      piecesAValider: [piece('a1', { statut: 'a_valider', date_piece: '2025-01-02' })], aNouveaux: [aNouveau('2025-06-01')],
    }))).not.toContain('pieces-a-valider')
  })

  it('refuse une pièce sans date et une date impossible, qui peuvent appartenir à l’exercice', () => {
    expect(prealable(donnees({ piecesAValider: [piece('a1', { statut: 'a_valider', date_piece: null })] }), 'pieces-sans-date')?.nb).toBe(1)
    expect(prealable(donnees({
      piecesAValider: [piece('a1', { statut: 'a_valider', date_piece: '2028-09-27', created_at: '2026-09-16T09:00:00Z' })],
    }), 'date-impossible')?.nb).toBe(1)
  })
})

describe('prealablesDeValidation — la numérotation et la 2035', () => {
  // Le cas courant en trésorerie : une facture dont le paiement n'est pas rapproché a sa charge sans sa banque.
  it('nomme l’écriture déséquilibrée et son écart, et renvoie à Banque', () => {
    const p = prealable(donnees({ lignes: [ligne('l1', { statut: 'non_rapprochee', date: '2026-01-05' })], ecritures: [ecriture('e1', { date: '2025-03-10' })] }), 'ecritures-desequilibrees')
    expect(p).toMatchObject({ nb: 1, cible: 'banque', bloquant: true, detail: 'p1.pdf (écart de 120,00 €)' })
  })

  it('refuse une écriture que rien ne rattache, et l’écart qu’elle fait avec la 2035', () => {
    const orpheline = ecriture('o1', { piece_id: null, date: '2025-08-01', montant: 19.99 })
    expect(ids(donnees({ ecritures: [E1, E2, orpheline] }))).toEqual(expect.arrayContaining(['ecritures-orphelines', 'concordance']))
  })

  it('refuse une pièce que la 2035 ne compte pas', () => {
    const sansCategorie = piece('p2', { categorie_id: null, date_piece: '2025-05-02', montant_ttc: 40 })
    const etat = ids(donnees({ piecesValidees: [P1, sansCategorie] }))
    expect(etat).toEqual(expect.arrayContaining(['sans-categorie', 'exclusions-2035']))
  })

  // LES FRAIS D'UN MOUVEMENT D'ENCAISSEMENTS SANS POSTE (ligne 28.65, VF4C3-Q1) : un trou dans la 2035, comme une pièce sans
  // poste — refusé sous le même préalable.
  it('refuse les frais d’un mouvement d’encaissements que la 2035 ne range sur aucune ligne', () => {
    const d = donnees()
    const frais = { ligneBancaireId: 'm1', date: '2025-06-10', libelle: 'VIR CLIENT FICTIF', compte: '627000', centimes: 200 }
    const avecFrais = { ...d, declaration: { ...d.declaration!, exclusions: { ...d.declaration!.exclusions, fraisSansPoste: [{ frais, categorie: null }] } } }
    expect(prealable(d, 'exclusions-2035')).toBeUndefined()
    expect(prealable(avecFrais, 'exclusions-2035')).toMatchObject({ nb: 1, cible: 'cloture', bloquant: true })
  })

  it('refuse une pièce validée de l’exercice que rien n’a encore écrite', () => {
    expect(prealable(donnees({ ecritures: [] }), 'ecritures-a-generer')?.nb).toBe(1)
  })

  // En trésorerie une pièce compte à son PAIEMENT : réglée l'année suivante, elle s'écrira l'année suivante, et ne
  // retient pas cet exercice. En engagement, sa facture s'écrit à sa date.
  it('ramène une pièce à l’exercice où elle s’écrit, selon le modèle', () => {
    const decembre = piece('p2', { date_piece: '2025-12-20', montant_ttc: 60 })
    const janvier = ligne('l2', { piece_id: 'p2', date: '2026-01-05', montant: -60 })
    expect(ids(donnees({ piecesValidees: [P1, decembre], lignes: [L1, janvier] }))).not.toContain('ecritures-a-generer')
    expect(ids(donnees({
      modele: { mode: 'engagement', compteNotesDeFrais: '455000', plan: PLAN_PAR_DEFAUT }, piecesValidees: [decembre], lignes: [janvier], ecritures: [],
    }))).toContain('ecritures-a-generer')
  })
})

describe('prealablesDeValidation — les anomalies, ramenées à l’exercice', () => {
  const virement = (id: string, date: string) => ligne(id, { date, montant: -500, statut: 'ignoree', prelevement_personnel: true, piece_id: null })

  it('refuse un virement personnel de l’exercice sans écriture, pas celui de l’exercice suivant', () => {
    expect(prealable(donnees({ lignes: [L1, virement('v1', '2025-07-01')] }), 'virements-sans-ecriture')?.nb).toBe(1)
    expect(ids(donnees({ lignes: [L1, virement('v1', '2026-02-01')] }))).not.toContain('virements-sans-ecriture')
  })

  it('refuse une écriture à régénérer de l’exercice', () => {
    expect(prealable(donnees({ piecesValidees: [{ ...P1, montant_ttc: 130 }] }), 'desynchronisees')?.nb).toBe(1)
  })

  it('bloque sur un contrôle qu’on n’a pas pu lire, au lieu de le croire muet', () => {
    expect(ids(donnees({ relevesIncoherents: null, doublonsTexte: null }))).toEqual(expect.arrayContaining(['releves-inconnus', 'doublons-inconnus']))
  })

  it('refuse un relevé qui ne boucle pas sur l’exercice, ou dont on ignore la période', () => {
    const releve = (o: Partial<ControleReleveBancaire>): ControleReleveBancaire => ({
      id: 'r1', dossier_id: 'd1', source_fichier: 'releve.pdf', solde_initial: 0, solde_final: 0, somme_mouvements: 50, ecart: 50,
      coherent: false, periode_debut: '2025-03-01', periode_fin: '2025-03-31', created_at: '2025-04-01T00:00:00Z', ...o,
    })
    expect(prealable(donnees({ relevesIncoherents: [releve({})] }), 'releve-incoherent')?.nb).toBe(1)
    expect(prealable(donnees({ relevesIncoherents: [releve({ periode_debut: null, periode_fin: null })] }), 'releve-incoherent')?.nb).toBe(1)
    expect(ids(donnees({ relevesIncoherents: [releve({ periode_debut: '2026-03-01', periode_fin: '2026-03-31' })] }))).not.toContain('releve-incoherent')
    expect(ids(donnees({ relevesIncoherents: [releve({ coherent: true })] }))).not.toContain('releve-incoherent')
  })

  it('avertit sans refuser d’une échéance d’emprunt de l’exercice que rien ne paie', () => {
    const pret: Emprunt = {
      id: 'emp1', dossier_id: 'd1', nom: 'Prêt cabinet', organisme_preteur: null, capital_initial: 12000, taux_annuel: 3,
      date_debut: '2025-01-05', duree_mois: 60, created_at: '2025-01-01T00:00:00Z',
    }
    const etat = prealablesDeValidation(donnees({ emprunts: [pret], lignes: [L1, ligne('l8', { date: '2025-12-20', statut: 'ignoree' })] }))
    const avertissement = etat.prealables.find((p) => p.id === 'echeances-emprunt-non-rapprochees')
    expect(avertissement?.bloquant).toBe(false)
    expect(avertissement!.nb).toBeGreaterThan(0)
    expect(etat.validable).toBe(true)
  })
})

// LES MOUVEMENTS IGNORÉS DE L'EXERCICE (lib/controles.ts) ne sont écrits nulle part : juste pour un doublon, faux pour un
// mouvement réel. Rien ne les distingue : un avertissement, qui dit ce qu'ils emportent, jamais un refus.
describe('prealablesDeValidation — les mouvements ignorés', () => {
  const ignore = (id: string, date: string, montant: number, o: Partial<LigneBancaire> = {}) =>
    ligne(id, { date, montant, statut: 'ignoree', ...o })

  it('avertit sans refuser, et dit ce qu’ils emportent', () => {
    const etat = prealablesDeValidation(donnees({ lignes: [L1, ignore('l8', '2025-12-20', -45), ignore('l9', '2025-11-02', 300)] }))
    const avertissement = etat.prealables.find((p) => p.id === 'mouvements-ignores')
    expect(avertissement?.bloquant).toBe(false)
    expect(avertissement?.nb).toBe(2)
    expect(avertissement?.detail).toMatch(/^300,00\s€ encaissés et 45,00\s€ payés\. Dans Banque, filtre « Ignorés »\.$/)
    expect(etat.validable).toBe(true)
  })

  it('ne compte ni un mouvement ignoré d’un autre exercice, ni un virement personnel', () => {
    expect(ids(donnees({ lignes: [L1, ignore('l8', '2026-01-20', -45)] }))).not.toContain('mouvements-ignores')
    expect(ids(donnees({ lignes: [L1, ignore('l8', '2024-12-20', -45)], anneesValidees: [2024] }))).not.toContain('mouvements-ignores')
    const etat = prealablesDeValidation(donnees({ lignes: [L1, ignore('l8', '2025-06-20', -45, { prelevement_personnel: true })] }))
    expect(etat.prealables.map((p) => p.id)).not.toContain('mouvements-ignores')
  })
})

// LA TVA LIQUIDÉE (lib/liquidationTva.ts) : une écriture de liquidation ou de paiement qui suit sa déclaration se valide ;
// une période de l'exercice qu'aucune déclaration ne couvre se dit, sans refuser — une CA12, ou une déclaration faite
// ailleurs, ne passe pas par l'application.
describe('prealablesDeValidation — la TVA liquidée', () => {
  const Q = (n: number) => [`2025-${String(3 * n - 2).padStart(2, '0')}-01`, `2025-${String(3 * n).padStart(2, '0')}-${n === 1 || n === 4 ? 31 : 30}`] as const
  const trimestres = [1, 2, 3, 4].map((n) => declarationTva(`q${n}`, ...Q(n)))

  it('valide une liquidation et un paiement écrits comme la base les écrit', () => {
    const q1 = declarationTva('q1', ...Q(1), { tva_declaree: 79, tva_collectee: 100.40, tva_deductible: 20.60, cases: {
      l16: 100, l20: 21, l23: 21, l28: 79, l32: 79,
    } })
    const liquidation = [
      ecriture('lq1', { piece_id: null, declaration_tva_id: 'q1', date: '2025-03-31', compte: '445710', montant: 100.40 }),
      ecriture('lq2', { piece_id: null, declaration_tva_id: 'q1', date: '2025-03-31', compte: '445660', sens: 'credit', montant: 20.60 }),
      ecriture('lq3', { piece_id: null, declaration_tva_id: 'q1', date: '2025-03-31', compte: '445510', sens: 'credit', montant: 79 }),
      // L'arrondi à l'euro de la CA3 : un produit de l'exercice, que la 2035 compte en « Gains divers ».
      ecriture('lq4', { piece_id: null, declaration_tva_id: 'q1', date: '2025-03-31', compte: '758000', sens: 'credit', montant: 0.80 }),
    ]
    const prelevement = ligne('lt', { date: '2025-04-20', montant: -79, declaration_tva_id: 'q1' })
    const paiement = [
      ecriture('pt1', { piece_id: null, ligne_bancaire_id: 'lt', date: '2025-04-20', compte: COMPTE_BANQUE, sens: 'credit', montant: 79 }),
      ecriture('pt2', { piece_id: null, ligne_bancaire_id: 'lt', date: '2025-04-20', compte: '445510', montant: 79 }),
    ]
    const d = donnees({ declarationsTva: [q1], lignes: [L1, prelevement], ecritures: [E1, E2, ...liquidation, ...paiement] })
    const etat = prealablesDeValidation(d)
    expect(etat.prealables).toEqual([])
    // La liquidation au journal des opérations diverses, le paiement à celui de banque : rien d'orphelin.
    expect(etat.numerotation!.horsFec).toEqual([])
    // Le garde symétrique : un montant qui ne suit plus se refuse, d'un côté comme de l'autre.
    const faussee = (id: string, montant: number) => (e: EcritureBrouillon) => (e.id === id ? { ...e, montant } : e)
    expect(ids({ ...d, ecritures: d.ecritures.map(faussee('lq3', 80)).map(faussee('lq1', 101.40)) })).toContain('liquidations-tva-perimees')
    expect(ids({ ...d, ecritures: d.ecritures.map(faussee('pt1', 80)).map(faussee('pt2', 80)) })).toContain('paiements-tva-perimes')
  })

  it('ne juge plus une liquidation ni un paiement qu’un exercice validé a figés', () => {
    const q4 = declarationTva('q4', ...Q(4), { tva_declaree: 200, tva_collectee: 200, cases: { l16: 200, l28: 200, l32: 200 } })
    const janvier = ligne('lt', { date: '2026-01-20', montant: -200, declaration_tva_id: 'q4' })
    // L'exercice 2025 validé : sa liquidation ne se réécrit plus ; le paiement de janvier, lui, se juge en 2026.
    const d = donnees({ annee: 2026, anneeCourante: 2027, aujourdHui: '2027-03-15', anneesValidees: [2025], declarationsTva: [q4], piecesValidees: [], lignes: [janvier], ecritures: [] })
    expect(ids(d)).not.toContain('liquidations-tva-perimees')
    expect(ids(d)).toContain('paiements-tva-perimes')
  })

  it('avertit, sans refuser, d’une période de l’exercice qu’aucune déclaration ne couvre', () => {
    const etat = prealablesDeValidation(donnees({ assujettiTva: true, declarationsTva: trimestres.slice(0, 3) }))
    const p = etat.prealables.find((x) => x.id === 'periodes-tva-non-declarees')
    expect(p).toMatchObject({ nb: 1, bloquant: false, cible: 'tva', detail: '4e trimestre 2025' })
    expect(etat.validable).toBe(true)
    // Toutes les périodes déclarées : rien à dire.
    expect(ids(donnees({ assujettiTva: true, declarationsTva: trimestres }))).not.toContain('periodes-tva-non-declarees')
    // Les mois d'une autre périodicité couvrent aussi : trois mois déclarés font un trimestre.
    const mois = ['10', '11', '12'].map((m) => declarationTva(`m${m}`, `2025-${m}-01`, `2025-${m}-${m === '11' ? 30 : 31}`))
    expect(ids(donnees({ assujettiTva: true, declarationsTva: [...trimestres.slice(0, 3), ...mois] }))).not.toContain('periodes-tva-non-declarees')
  })

  it('nomme chaque mois sans déclaration, en mensuelle', () => {
    const p = prealable(donnees({ assujettiTva: true, periodiciteTva: 'mensuelle', declarationsTva: trimestres.slice(0, 3) }), 'periodes-tva-non-declarees')
    expect(p).toMatchObject({ nb: 3, detail: 'octobre 2025, novembre 2025, décembre 2025' })
  })

  it('se tait sur un dossier qui ne déclare pas de TVA, et sur un exercice en cours', () => {
    expect(ids(donnees({ declarationsTva: [] }))).not.toContain('periodes-tva-non-declarees')
    expect(ids(donnees({ assujettiTva: true, annee: 2026, anneeCourante: 2026 }))).not.toContain('periodes-tva-non-declarees')
  })
})

// CHAQUE CONTRÔLE REPRIS DE LA CHECKLIST, sur un défaut construit pour lui : il se déclenche quand le défaut est
// dans l'exercice, et se tait quand le même défaut est dans l'exercice suivant — que la validation ne fige pas.
// Sans le premier cas, un contrôle débranché laisserait figer un défaut ; sans le second, un contrôle qui compte
// tout le dossier refuserait un exercice juste.
// LA CAISSE (ligne 26.6, étape C3b) : les fabriques de ses cas, ici et plus bas. L'écriture d'une opération est celle que la
// base compose (`ecritureDeLOperation`), telle qu'elle arrive au brouillon. Des jeux FICTIFS.
const MODELE_CAISSE: ModeleComptable = { mode: 'tresorerie', compteNotesDeFrais: '108000', plan: PLAN_PAR_DEFAUT }
const operationDeCaisse = (o: Partial<OperationCaisse>): OperationCaisse => ({
  id: 'o', dossier_id: 'd1', genre: 'apport', date: '2025-03-02', montant: 50, categorie_id: null, taux_tva: null,
  encaissements_du_jour: null, piece_id: null, origine: 'cabinet', remplace_id: null, cree_le: '2025-03-02T18:00:00Z',
  cree_par: null, retire_le: null, retire_par: null, ...o,
})
const HONORAIRES_CAISSE: Categorie = { ...ACHATS, id: 'k-hono', code: 'honoraires', libelle: 'Honoraires', compte_comptable: '706000', poste_2035: 'Recettes encaissées y compris les remboursements de frais' }
// L'écriture que la base compose pour l'opération, telle qu'elle arrive au brouillon.
const lignesDeLaCaisse = (o: OperationCaisse): EcritureBrouillon[] => ecritureDeLOperation({
  genre: o.genre as 'apport', date: o.date, montant: o.montant, taux_tva: null,
  categorie: o.categorie_id ? { libelle: HONORAIRES_CAISSE.libelle, compte_comptable: HONORAIRES_CAISSE.compte_comptable } : null,
}, MODELE_CAISSE).map((l, i) => ecriture(`${o.id}-${i}`, {
  piece_id: null, date: o.date, compte: l.compte, sens: l.sens, montant: l.montant, libelle: l.libelle, operation_caisse_id: o.id,
}))
const APPORT = operationDeCaisse({ id: 'a1', date: '2025-03-02', montant: 50 })
const PRELEVEMENT = operationDeCaisse({ id: 'p1', genre: 'prelevement', date: '2025-03-05', montant: 30 })
const caisseLue = (operations: OperationCaisse[]): OperationsDeCaisse => ({ etat: 'lue', dossierId: 'd1', operations })

describe('prealablesDeValidation — chaque contrôle repris, ramené à l’exercice', () => {
  const D = (a: number, mmjj: string) => `${a}-${mmjj}`
  const cas: [string, (a: number) => Surcharges][] = [
    ['sans-categorie', (a) => ({ piecesValidees: [P1, piece('p2', { categorie_id: null, date_piece: D(a, '05-02'), montant_ttc: 40 })] })],
    ['devise-non-convertie', (a) => ({ piecesValidees: [P1, piece('p2', { devise: 'USD', montant_devise: 24, date_piece: D(a, '05-02') })] })],
    ['tva-impossible', (a) => ({ piecesValidees: [P1, piece('p2', { montant_ht: 100, montant_tva: 50, montant_ttc: 120, date_piece: D(a, '05-02') })] })],
    ['mois-en-double', (a) => ({
      piecesAValider: ['03-01', '04-01', '06-01', '06-01'].map((j, i) =>
        piece(`m${i}`, { statut: 'a_valider', tiers: 'Transmedical', montant_ttc: 38.4, date_piece: D(a, j) })),
    })],
    ['doublon-texte', (a) => ({
      piecesAValider: [piece('d1', { statut: 'a_valider', date_piece: D(a, '06-01') }), piece('d2', { statut: 'a_valider', date_piece: D(a, '06-01') })],
      doublonsTexte: [{ empreinte: 'e', pieceIds: ['d1', 'd2'], documentIds: [] }],
    })],
    // La facture émise revenue de Super PDP ET de la plateforme du client (ligne 28.6) : deux pièces, une vente.
    ['ventes-en-double', (a) => ({
      piecesAValider: [
        piece('v1', { statut: 'a_valider', type_piece: 'vente', source: 'superpdp', date_piece: D(a, '06-01'), superpdp_invoice_id: 4242 }),
        piece('v2', { statut: 'a_valider', type_piece: 'vente', source: 'plateforme', date_piece: D(a, '06-01'), flux_hote: 'pa.exemple.fr', flux_id: 'flux-1' }),
      ],
      facturesEmises: [factureEmise({ date_emission: D(a, '06-01') })],
      transmissions: [{ facture_id: 'f1', canal: 'plateforme', hote: 'pa.exemple.fr', flux_id: 'flux-1' }],
    })],
    ['desynchronisees', (a) => ({
      piecesValidees: [P1, piece('p2', { date_piece: D(a, '05-02'), montant_ttc: 60 })],
      lignes: [L1, ligne('l2', { piece_id: 'p2', date: D(a, '05-04'), montant: -60 })],
      ecritures: [E1, E2, ecriture('e3', { piece_id: 'p2', date: D(a, '05-04'), montant: 50 }),
        ecriture('e4', { piece_id: 'p2', compte: COMPTE_BANQUE, sens: 'credit', ligne_bancaire_id: 'l2', date: D(a, '05-04'), montant: 50 })],
    })],
    ['ecritures-sans-objet', (a) => ({
      piecesValidees: [P1, piece('p2', { categorie_id: null, date_piece: D(a, '05-02'), montant_ttc: 60 })],
      ecritures: [E1, E2, ecriture('e3', { piece_id: 'p2', date: D(a, '05-02'), montant: 60 })],
    })],
    ['affectes-perimes', (a) => ({
      lignes: [L1, ligne('l2', { date: D(a, '06-01'), montant: -30, categorie_id: 'c-achats' })],
      ecritures: [E1, E2, ecriture('e3', { piece_id: null, ligne_bancaire_id: 'l2', date: D(a, '06-01'), compte: '606400', montant: 30 }),
        ecriture('e4', { piece_id: null, ligne_bancaire_id: 'l2', date: D(a, '06-01'), compte: COMPTE_BANQUE, sens: 'credit', montant: 30 })],
    })],
    ['recettes-affectees-assujetti', (a) => ({
      assujettiTva: true, categories: [ACHATS, RECETTES],
      lignes: [L1, ligne('l2', { date: D(a, '07-01'), montant: 200, categorie_id: 'c-recettes' })],
    })],
    ['ventiles-perimes', (a) => ({
      lignes: [L1, ligne('l2', { date: D(a, '08-01'), montant: -100, ventilee: true })],
      ventilations: [part('v1', 'l2', 'c-achats', -70), part('v2', 'l2', null, -30)],
    })],
    ['ventilations-incoherentes', (a) => ({
      lignes: [L1, ligne('l2', { date: D(a, '08-01'), montant: -100, ventilee: true })],
      ventilations: [part('v1', 'l2', 'c-achats', -70), part('v2', 'l2', null, -20)],
    })],
    ['virements-sans-ecriture', (a) => ({
      lignes: [L1, ligne('l2', { date: D(a, '07-01'), montant: -500, statut: 'ignoree', prelevement_personnel: true })],
    })],
    // Écrit sur un compte de bilan sans son écriture : défensif, la base les écrit ensemble.
    ['comptes-de-bilan-perimes', (a) => ({
      lignes: [L1, ligne('l2', { date: D(a, '06-15'), montant: -1000, compte_bilan: '580000' })],
    })],
    ['echeances-emprunt-perimees', (a) => ({
      lignes: [L1, ligne('l2', { date: D(a, '02-05'), montant: -250, emprunt_id: 'emp1', emprunt_echeance: 2, emprunt_interets: 30, emprunt_assurance: 5 })],
    })],
    ['cotisations-sans-ecriture', (a) => ({
      cotisations: [echeance('c1', D(a, '02-05'), 500)],
      lignes: [L1, ligne('l2', { date: D(a, '02-05'), montant: -500, cotisation_id: 'c1' })],
    })],
    ['cotisations-rapprochement-refuse', (a) => ({
      cotisations: [echeance('c1', D(a, '02-05'), 500)],
      lignes: [L1, ligne('l2', { date: D(a, '02-05'), montant: 500, cotisation_id: 'c1' })],
    })],
    // Une échéance payée depuis le compte personnel sans son écriture : défensif, la base les écrit ensemble. Elle compte
    // dans l'exercice de son PAIEMENT — ici un paiement de décembre qui reste dans l'exercice de l'échéance de novembre.
    ['paiements-personnels-a-reprendre', (a) => ({
      cotisations: [{ ...echeance('c1', D(a, '11-05'), 500), paiement_personnel_le: D(a, '12-20') }],
    })],
    ['rapproches-sans-objet', (a) => ({ lignes: [L1, ligne('l2', { date: D(a, '09-01'), montant: -15 })] })],
    ['reglements-groupes-incoherents', (a) => ({
      lignes: [L1, ligne('l2', { date: D(a, '09-01'), montant: -100, reglement_groupe: true })],
      reglements: [partReglee('r1', 'l2', null, -100)],
    })],
    ['pieces-payees-en-trop', (a) => ({
      piecesValidees: [P1, piece('p2', { date_piece: D(a, '05-02'), montant_ttc: 60 })],
      lignes: [L1, ligne('l2', { piece_id: 'p2', date: D(a, '05-04'), montant: -60 }), ligne('l3', { piece_id: 'p2', date: D(a, '05-06'), montant: -60 })],
    })],
    ['pieces-payees-en-partie', (a) => ({
      piecesValidees: [P1, piece('p2', { date_piece: D(a, '05-02'), montant_ttc: 500 })],
      lignes: [L1, ligne('l2', { piece_id: 'p2', date: D(a, '05-04'), montant: -50 })],
    })],
    ['immos-sans-justificatif', (a) => ({ immobilisations: [bien('i1', { piece_id: null, date_acquisition: D(a, '01-01') })], natures: [MATERIEL] })],
    ['dotations-a-ecrire', (a) => ({ immobilisations: [bien('i1', { date_acquisition: D(a, '01-01') })], natures: [MATERIEL] })],
    ['forfaits-a-ecrire', (a) => ({ vehicules: [vehicule('v1', a, 1000)] })],
    // Une déclaration sans son écriture de liquidation, un paiement de TVA sans la sienne : défensif, la base les écrit
    // ensemble. La liquidation compte dans l'exercice où finit sa période, le paiement dans celui de son mouvement.
    ['liquidations-tva-perimees', (a) => ({
      declarationsTva: [declarationTva('dt1', D(a, '01-01'), D(a, '03-31'), {
        tva_declaree: 200, tva_collectee: 200, cases: { l16: 200, l28: 200, l32: 200 },
      })],
    })],
    ['paiements-tva-perimes', (a) => ({
      lignes: [L1, ligne('l2', { date: D(a, '04-20'), montant: -200, declaration_tva_id: 'dt1' })],
    })],
    // LA CAISSE (étape C3b) : une opération sans son écriture ; un prélèvement qui la vide sous zéro ; une recette dont le jour
    // a changé depuis sa saisie. Défensifs les deux premiers : la base écrit l'opération avec son écriture, et refuse une caisse
    // négative.
    ['caisse-a-reprendre', (a) => ({ operationsDeCaisse: caisseLue([{ ...APPORT, date: D(a, '03-02') }]) })],
    ['caisse-negative', (a) => {
      const ops = [{ ...APPORT, date: D(a, '03-02') }, { ...PRELEVEMENT, date: D(a, '03-05'), montant: 80 }]
      return { ecritures: [E1, E2, ...ops.flatMap(lignesDeLaCaisse)], operationsDeCaisse: caisseLue(ops) }
    }],
    ['recettes-de-caisse-a-revoir', (a) => {
      const r = operationDeCaisse({
        id: 'r1', genre: 'recette', date: D(a, '03-12'), montant: 120, categorie_id: HONORAIRES_CAISSE.id, encaissements_du_jour: ['e-perdu'],
      })
      return { categories: [ACHATS, HONORAIRES_CAISSE], ecritures: [E1, E2, ...lignesDeLaCaisse(r)], operationsDeCaisse: caisseLue([r]) }
    }],
  ]

  // Sans exercice validé, le défaut porté par 2026 ferait aussi juger 2025 sur son activité : 2024 validé l'écarte.
  for (const [id, defaut] of cas) {
    it(`« ${id} » se déclenche sur l’exercice, et se tait sur le suivant`, () => {
      const etat = prealablesDeValidation(donnees({ ...defaut(2025), anneesValidees: [2024] }))
      expect(etat.prealables.find((p) => p.id === id)?.bloquant).toBe(true)
      expect(etat.validable).toBe(false)
      expect(ids(donnees({ ...defaut(2026), anneesValidees: [2024] }))).not.toContain(id)
    })
  }

  // UN MOUVEMENT CLASSÉ PAR SES ENCAISSEMENTS DE FACTURES (ligne 28.65, étape VF5a1) : rapproché sans pièce ni catégorie, il
  // n'est pas orphelin — sa justification est le registre. Le même mouvement sans le drapeau bloque la validation.
  it('« rapproches-sans-objet » se tait sur un mouvement classé par ses encaissements de factures', () => {
    const classe = ligne('l2', { date: '2025-09-01', montant: 598.5, encaissements_de_factures: true })
    expect(ids(donnees({ lignes: [L1, classe], anneesValidees: [2024] }))).not.toContain('rapproches-sans-objet')
    expect(prealable(donnees({ lignes: [L1, { ...classe, encaissements_de_factures: false }], anneesValidees: [2024] }), 'rapproches-sans-objet'))
      .toMatchObject({ nb: 1, bloquant: true })
  })

  // LA VENTE COMPTÉE DEUX FOIS (ligne 28.6) : en engagement aussi, où chaque pièce s'écrit à sa date, équilibrée — rien
  // d'autre ne la refuserait. Une facture que sa seule jumelle porte ne bloque rien.
  it('« ventes-en-double » : deux pièces validées pour une facture bloquent, en engagement comme en trésorerie ; une seule, rien', () => {
    const jumelle = (id: string, o: Partial<Piece> = {}) =>
      piece(id, { type_piece: 'vente', source: 'superpdp', date_piece: '2025-06-01', superpdp_invoice_id: 4242, ...o })
    for (const modele of [{ mode: 'tresorerie', compteNotesDeFrais: '108000', plan: PLAN_PAR_DEFAUT }, { mode: 'engagement', compteNotesDeFrais: '455000', plan: PLAN_PAR_DEFAUT }] as const) {
      const deux = prealable(donnees({ modele, piecesValidees: [P1, jumelle('v1'), jumelle('v2')], facturesEmises: [factureEmise()] }), 'ventes-en-double')
      expect(deux, modele.mode).toMatchObject({ nb: 1, bloquant: true, cible: 'pieces' })
      expect(ids(donnees({ modele, piecesValidees: [P1, jumelle('v1')], facturesEmises: [factureEmise()] })), modele.mode).not.toContain('ventes-en-double')
    }
    // Un brouillon n'a pas de jumelle : deux pièces qui porteraient son identifiant ne sont pas « la même vente ».
    expect(ids(donnees({ piecesValidees: [P1, jumelle('v1'), jumelle('v2')], facturesEmises: [factureEmise({ statut: 'brouillon' })] })))
      .not.toContain('ventes-en-double')
  })

  // LE PDF DÉSIGNÉ (chantier EC-Q3, étape VF1a) : la jumelle revenue de Super PDP et le PDF que le cabinet a déposé puis
  // désigné exemplaire de la même facture — le trou que 28.6-Q1 ferme. Le PDF que rien ne désigne ne se voit toujours pas.
  it('« ventes-en-double » : la jumelle et le PDF désigné exemplaire de la même facture bloquent ; le PDF non désigné, rien', () => {
    const jumelle = piece('v1', { type_piece: 'vente', source: 'superpdp', date_piece: '2025-06-01', superpdp_invoice_id: 4242 })
    const pdf = (o: Partial<Piece> = {}) => piece('v2', { type_piece: 'vente', date_piece: '2025-06-01', ...o })
    expect(prealable(donnees({ piecesValidees: [P1, jumelle], piecesAValider: [pdf({ statut: 'a_valider', facture_id: 'f1' })],
      facturesEmises: [factureEmise()] }), 'ventes-en-double')).toMatchObject({ nb: 1, bloquant: true, cible: 'pieces' })
    expect(ids(donnees({ piecesValidees: [P1, jumelle, pdf()], facturesEmises: [factureEmise()] }))).not.toContain('ventes-en-double')
    expect(ids(donnees({ piecesValidees: [P1, pdf({ facture_id: 'f1' })], facturesEmises: [factureEmise()] })))
      .not.toContain('ventes-en-double')
  })

  // LE PONT PAR RÉGIME (chantier EC-Q3, étape VF6e) : bloquant dans les deux régimes, chacun par sa règle. Une facture SOURCE
  // compte sa vente elle-même : la jumelle et le PDF tous deux désignés ne la comptent pas — rien ne bloque —, une pièce
  // validée qui n'est pas son exemplaire la compte une seconde fois — bloquant. Une facture d'avant la bascule, comme hier.
  it('« ventes-en-double » par régime : bloquant pour une facture source comptée par une pièce de plus, comme pour une autre', () => {
    const jumelle = (o: Partial<Piece> = {}) =>
      piece('v1', { type_piece: 'vente', source: 'superpdp', date_piece: '2025-06-01', superpdp_invoice_id: 4242, ...o })
    const pdf = piece('v2', { type_piece: 'vente', date_piece: '2025-06-01', facture_id: 'f1' })
    const source = (o: Surcharges) => donnees({ facturesEmises: [factureEmise()], facturesSources: new Set(['f1']), ...o })
    for (const modele of [{ mode: 'tresorerie', compteNotesDeFrais: '108000', plan: PLAN_PAR_DEFAUT }, { mode: 'engagement', compteNotesDeFrais: '455000', plan: PLAN_PAR_DEFAUT }] as const) {
      // Deux exemplaires désignés d'une facture source : ni l'un ni l'autre ne compte.
      expect(ids(source({ modele, piecesValidees: [P1, jumelle({ facture_id: 'f1' }), pdf] })), modele.mode).not.toContain('ventes-en-double')
      // La jumelle validée sans être désignée, à côté du PDF désigné : la vente compte par la facture ET par elle.
      expect(prealable(source({ modele, piecesValidees: [P1, jumelle(), pdf] }), 'ventes-en-double'), modele.mode)
        .toMatchObject({ nb: 1, bloquant: true, cible: 'pieces' })
      // Seule et validée, sans désignation : de même.
      expect(prealable(source({ modele, piecesValidees: [P1, jumelle()] }), 'ventes-en-double'), modele.mode)
        .toMatchObject({ nb: 1, bloquant: true })
      // À valider, elle ne compte pas encore : elle est à désigner, rien ne bloque à ce titre.
      expect(ids(source({ modele, piecesValidees: [P1, pdf], piecesAValider: [jumelle({ statut: 'a_valider' })] })), modele.mode)
        .not.toContain('ventes-en-double')
    }
    // Le régime d'hier sur les deux exemplaires : comptée deux fois, bloquant.
    expect(prealable(donnees({ piecesValidees: [P1, jumelle({ facture_id: 'f1' }), pdf], facturesEmises: [factureEmise()] }), 'ventes-en-double'))
      .toMatchObject({ nb: 1, bloquant: true })
  })

  // L'écart se juge sur le TOTAL payé de la pièce : réglée par un acompte puis par la part d'un virement groupé, elle
  // n'a rien à reprendre — le contrôle d'avant comparait chaque mouvement à la pièce, et refusait cette validation.
  it('« pieces-payees-en-partie » se tait sur une pièce réglée en deux fois', () => {
    const d = donnees({
      piecesValidees: [P1, piece('p2', { date_piece: '2025-05-02', montant_ttc: 1000 })],
      lignes: [
        L1,
        ligne('l2', { piece_id: 'p2', date: '2025-05-04', montant: -500 }),
        ligne('l3', { date: '2025-06-04', montant: -500, reglement_groupe: true }),
      ],
      reglements: [partReglee('r1', 'l3', 'p2', -500)],
    })
    expect(ids(d)).not.toContain('pieces-payees-en-partie')
  })

  // En engagement, le reste d'une facture payée en partie est une dette qui court au 401 : rien à refuser.
  it('« pieces-payees-en-partie » se tait en engagement', () => {
    const d = donnees({
      modele: { mode: 'engagement', compteNotesDeFrais: '455000', plan: PLAN_PAR_DEFAUT },
      piecesValidees: [P1, piece('p2', { date_piece: '2025-05-02', montant_ttc: 500 })],
      lignes: [L1, ligne('l2', { piece_id: 'p2', date: '2025-05-04', montant: -50 })],
    })
    expect(ids(d)).not.toContain('pieces-payees-en-partie')
  })

  it('compte la dotation de l’exercice, pas celle d’un exercice antérieur que le bien porte aussi', () => {
    expect(prealable(donnees({ immobilisations: [bien('i1', { date_acquisition: '2024-01-01' })], natures: [MATERIEL], anneesValidees: [2024] }), 'dotations-a-ecrire')?.nb).toBe(1)
  })

  it('compte un bien sans justificatif tant qu’il s’amortit dans l’exercice, plus après', () => {
    const ancien = bien('i1', { piece_id: null, date_acquisition: '2019-01-01', duree_annees: 3 })
    expect(ids(donnees({ immobilisations: [ancien], natures: [MATERIEL], anneesValidees: [2024] }))).not.toContain('immos-sans-justificatif')
  })

  it('a un cas pour chaque contrôle repris de la Checklist', () => {
    const module = readFileSync(new URL('./prealablesValidation.ts', import.meta.url), 'utf8')
    const repris = [...module.split("// ── Les anomalies du brouillon")[1].matchAll(/id: '([a-z0-9-]+)'/g)].map((m) => m[1])
      .filter((id) => ![
        'doublons-inconnus', 'releves-inconnus', 'releve-incoherent', 'echeances-emprunt-non-rapprochees', 'ecritures-a-generer',
        // Deux avertissements de la 2035, qui ne refusent rien : leurs cas sont plus bas.
        'csg-non-saisie', 'vehicule-amorti-sous-bareme',
        // Un avertissement aussi : un doublon ignoré est le bon geste. Son cas est plus haut.
        'mouvements-ignores',
        // Un avertissement encore : une CA12 ou une déclaration faite ailleurs. Son cas est plus bas.
        'periodes-tva-non-declarees',
        // Un avertissement d'un dossier basculé (étape VF7c) : un chèque, une carte ou un effet en cours au 511. Son cas est
        // avec les ventes facturées, plus bas.
        'encaissements-en-cours',
      ].includes(id))
    expect(repris.length).toBeGreaterThanOrEqual(20)
    expect(repris.filter((id) => !cas.some(([c]) => c === id))).toEqual([])
  })
})

// L'EXEMPLAIRE D'UNE FACTURE SOURCE (ligne 28.65, étape VF6a ; lib/facturesSources.ts) : sa facture compte la vente. Les
// préalables qui jugent une pièce comme une pièce qui compte l'écartent — sinon la validation attendrait son écriture, sa
// catégorie, sa conversion, sa TVA ou son paiement, que rien ne lit, et, une fois G4 écrite (aucune écriture sur un
// exemplaire), « ecritures-a-generer » la retiendrait pour toujours. Son écriture déjà passée, elle, est sans objet, et
// refusée comme telle. L'exemplaire d'une facture qui n'est pas source se juge comme hier.
describe('prealablesDeValidation — l’exemplaire d’une facture source (VF6a)', () => {
  const exemplaire = (o: Partial<Piece> = {}) => piece('v1', {
    type_piece: 'vente', tiers: 'Client fictif', categorie_id: 'c-recettes', facture_id: 'f1', date_piece: '2025-05-02', montant_ttc: 60,
    created_at: '2025-05-03T09:00:00Z', ...o,
  })
  const ecritureDeLExemplaire = (o: Partial<EcritureBrouillon>) =>
    ecriture('ev', { piece_id: 'v1', date: '2025-05-04', compte: '706000', sens: 'credit', montant: 60, ...o })
  const cas: [string, Surcharges, { source: boolean; autre: boolean }][] = [
    ['ecritures-a-generer', { piecesValidees: [P1, exemplaire()] }, { source: false, autre: true }],
    ['sans-categorie', { piecesValidees: [P1, exemplaire({ categorie_id: null })] }, { source: false, autre: true }],
    ['devise-non-convertie', { piecesValidees: [P1, exemplaire({ devise: 'USD', montant_devise: 70 })] }, { source: false, autre: true }],
    ['tva-impossible', { piecesValidees: [P1, exemplaire({ montant_ht: 50, montant_tva: 30 })] }, { source: false, autre: true }],
    ['pieces-payees-en-partie', {
      piecesValidees: [P1, exemplaire({ montant_ttc: 500 })],
      lignes: [L1, ligne('l2', { piece_id: 'v1', date: '2025-05-04', montant: 50 })],
    }, { source: false, autre: true }],
    // L'écriture déjà passée sur lui : sans objet — refusée — pour l'exemplaire d'une facture source ; juste pour un autre.
    ['ecritures-sans-objet', {
      piecesValidees: [P1, exemplaire()], lignes: [L1, ligne('l2', { piece_id: 'v1', date: '2025-05-04', montant: 60 })],
      ecritures: [E1, E2, ecritureDeLExemplaire({ id: 'e3' }),
        ecritureDeLExemplaire({ id: 'e4', compte: COMPTE_BANQUE, sens: 'debit', ligne_bancaire_id: 'l2' })],
    }, { source: true, autre: false }],
    // Modifiée depuis : « à régénérer » pour un autre, jamais pour l'exemplaire d'une facture source, qui ne se régénère pas.
    ['desynchronisees', {
      piecesValidees: [P1, exemplaire({ montant_ttc: 80 })], lignes: [L1, ligne('l2', { piece_id: 'v1', date: '2025-05-04', montant: 80 })],
      ecritures: [E1, E2, ecritureDeLExemplaire({ id: 'e3' }),
        ecritureDeLExemplaire({ id: 'e4', compte: COMPTE_BANQUE, sens: 'debit', ligne_bancaire_id: 'l2' })],
    }, { source: false, autre: true }],
    // Étape VF6e, le préalable que VF6a laissait : payé plus que son montant — deux rapprochements de 60 € pour 60 €.
    ['pieces-payees-en-trop', {
      piecesValidees: [P1, exemplaire()],
      lignes: [L1, ligne('l2', { piece_id: 'v1', date: '2025-05-04', montant: 60 }), ligne('l3', { piece_id: 'v1', date: '2025-05-05', montant: 60 })],
    }, { source: false, autre: true }],
  ]

  for (const [id, surcharges, attendu] of cas) {
    it(`« ${id} » : ${attendu.source ? 'retient' : 'ne retient pas'} l’exemplaire d’une facture source, ${attendu.autre ? 'retient' : 'ne retient pas'} celui d’une autre`, () => {
      const avec = (facturesSources: ReadonlySet<string>) =>
        prealable(donnees({ ...surcharges, categories: [ACHATS, RECETTES], anneesValidees: [2024], facturesSources }), id)
      expect(avec(new Set(['f1']))?.bloquant ?? false, 'facture source').toBe(attendu.source)
      expect(avec(new Set(['f2']))?.bloquant ?? false, 'facture qui n’est pas source').toBe(attendu.autre)
      expect(avec(SANS_FACTURE_SOURCE)?.bloquant ?? false, 'aucune facture source').toBe(attendu.autre)
    })
  }

  it('l’exemplaire d’une facture source sans écriture, sans catégorie et à la TVA impossible ne retient rien de ce qui juge une pièce', () => {
    const d = donnees({ piecesValidees: [P1, exemplaire({ categorie_id: null, montant_ht: 50, montant_tva: 30 })], categories: [ACHATS, RECETTES],
      anneesValidees: [2024], facturesSources: new Set(['f1']) })
    const presents = ids(d)
    for (const id of ['ecritures-a-generer', 'sans-categorie', 'tva-impossible', 'ecritures-sans-objet', 'desynchronisees']) {
      expect(presents, id).not.toContain(id)
    }
  })

  it('sans les factures sources lues en entier, la validation se suspend et dit pourquoi', () => {
    const etat = prealablesDeValidation(donnees({ facturesSources: null }))
    expect(etat.validable).toBe(false)
    expect(etat.numerotation).toBeNull()
    expect(etat.prealables).toEqual([expect.objectContaining({
      id: 'lecture-partielle', bloquant: true,
      message: expect.stringContaining('les factures sources de leurs ventes ne sont pas lues en entier'),
    })])
    // Le motif que l'appelant donne l'emporte : il dit laquelle des lectures a manqué.
    expect(prealablesDeValidation(donnees({ facturesSources: null, lectureIncomplete: 'les ventes facturées : refusée' })).prealables[0].message)
      .toContain('(les ventes facturées : refusée)')
  })
})

// UNE ÉCHÉANCE PAYÉE DEPUIS LE COMPTE PERSONNEL (lib/cotisationPersonnelle.ts) : déclarée avec son écriture, elle ne
// bloque plus la validation — la 2035 la compte au jour du paiement, son écriture la porte ce jour-là, la concordance les
// trouve d'accord, et la numérotation la range au journal des opérations diverses. Avant elle, une échéance payée de la
// poche de l'exploitant restait en écart, sans geste pour le lever.
describe('prealablesDeValidation — une échéance payée depuis le compte personnel', () => {
  const payee: CotisationDeclaree = { ...echeance('c1', '2025-05-05', 500), montant_csg_crds: 48.5, paiement_personnel_le: '2025-05-10' }
  const ecrite = ecritureDuPaiementPersonnel(payee, { mode: 'tresorerie', compteNotesDeFrais: '108000', plan: PLAN_PAR_DEFAUT })
    .map((l, i) => ecriture(`pp${i}`, { piece_id: null, cotisation_id: 'c1', date: '2025-05-10', ...l }))

  // La 2035 et la concordance recalculées AVEC les échéances, comme les écrans les calculent (`cotisationsComptees`).
  function avecCotisations(o: Surcharges): DonneesDeValidation {
    const d = donnees(o)
    const declaration = calculerDeclaration2035(
      d.annee, [...d.piecesValidees], [...d.categories], [], cotisationsComptees(d.cotisations, d.lignes, 'tresorerie'), [],
      d.assujettiTva, paiementsDesPieces(d.lignes, d.reglements, [], []), [], [], PLAN_PAR_DEFAUT, ventesFactureesVides('d1'),
      { etat: 'sans_bascule' }, CAISSE_ABSENTE,
    )
    const concordance = concordance2035(
      declaration, d.ecritures,
      { piecesValidees: new Set(d.piecesValidees.map((p) => p.id)), piecesImmobilisees: new Set(), mouvementsDesVentesFacturees: new Set() },
      null,
    )
    return { ...d, declaration, concordance }
  }

  it('déclarée avec son écriture : rien à redire, et son écriture est numérotée au journal OD', () => {
    const etat = prealablesDeValidation(avecCotisations({ cotisations: [payee], ecritures: [E1, E2, ...ecrite] }))
    expect(etat.prealables).toEqual([])
    expect(etat.numerotation!.lignes.filter((l) => l.ecriture.cotisation_id === 'c1').map((l) => [l.journal, l.pieceRef]))
      .toEqual([['OD', 'Compte personnel du 10/05/2025'], ['OD', 'Compte personnel du 10/05/2025']])
  })

  it('sans paiement connu, l’échéance reste en écart dans la concordance — la règle d’avant', () => {
    expect(ids(avecCotisations({ cotisations: [{ ...payee, paiement_personnel_le: null }] }))).toContain('concordance')
  })

  it('payée sans son écriture : la concordance le dit, et le paiement est à reprendre', () => {
    expect(ids(avecCotisations({ cotisations: [payee] }))).toEqual(expect.arrayContaining(['concordance', 'paiements-personnels-a-reprendre']))
  })
})

// LA 2035 QUE LA VALIDATION FIGERAIT : une case que le formulaire ne porte pas, une case négative, la même dépense deux
// fois en case BJ. Les cartes de Clôture qui le disent se taisent une fois l'exercice validé : la validation le refuse
// donc avant. Ce qu'on ne peut pas refuser sans rendre l'exercice invalidable se lit avant de valider.
describe('prealablesDeValidation — la 2035 que la validation figerait', () => {
  it('refuse un poste qu’aucune case du formulaire ne porte', () => {
    const p = prealable(donnees({ categories: [{ ...ACHATS, poste_2035: 'eau_gaz_electricite' }] }), 'postes-sans-case')
    expect(p?.bloquant).toBe(true)
    expect(p?.nb).toBe(1)
    // Le garde symétrique : un poste du formulaire se valide.
    expect(ids(donnees())).not.toContain('postes-sans-case')
  })

  // Une vente rangée dans la catégorie des achats : le moteur la fondait dans la dépense « Achats » — l'achat venant
  // d'abord —, la recette se déduisait en case BA, et aucun préalable ne le voyait. Séparée, sa ligne est du mauvais
  // sens, et la validation la refuse.
  it('refuse une vente rangée dans une catégorie de dépense', () => {
    const p = prealable(donnees({ piecesValidees: [P1, piece('p2', { type_piece: 'vente', montant_ttc: 500 })] }), 'postes-sans-case')
    expect(p?.bloquant).toBe(true)
    expect(p?.nb).toBe(1)
  })

  it('refuse une case négative', () => {
    // Un avoir reçu sans achat dans l'exercice : la case BA passe sous zéro.
    const d = donnees({ piecesValidees: [piece('p1', { montant_ttc: -120 })], lignes: [ligne('l1', { piece_id: 'p1', montant: 120 })] })
    expect(prealable(d, 'cases-negatives')?.bloquant).toBe(true)
    expect(ids(donnees())).not.toContain('cases-negatives')
  })

  it('refuse des frais de véhicule au réel à côté du barème kilométrique', () => {
    const auReel = { ...ACHATS, poste_2035: 'Frais de véhicules' }
    const p = prealable(donnees({ categories: [auReel], vehicules: [vehicule('v1', 2025, 5000)] }), 'frais-vehicule-en-double')
    expect(p?.bloquant).toBe(true)
    expect(p?.nb).toBe(1)
    // Le réel seul, ou le barème seul, se valident.
    expect(ids(donnees({ categories: [auReel] }))).not.toContain('frais-vehicule-en-double')
    expect(ids(donnees({ vehicules: [vehicule('v1', 2025, 5000)] }))).not.toContain('frais-vehicule-en-double')
  })

  it('avertit d’une CSG-CRDS non saisie, sans refuser — et seulement sur l’exercice où l’échéance compte', () => {
    const p = prealable(donnees({ cotisations: [echeance('ck', '2025-03-05', 900)] }), 'csg-non-saisie')
    expect(p?.bloquant).toBe(false)
    expect(p?.nb).toBe(1)
    expect(p?.cible).toBe('cotisations')
    expect(ids(donnees({ cotisations: [{ ...echeance('ck', '2025-03-05', 900), montant_csg_crds: 90 }] }))).not.toContain('csg-non-saisie')
    expect(ids(donnees({ cotisations: [echeance('ck', '2026-03-05', 900)] }))).not.toContain('csg-non-saisie')
    // Un dossier tenu en engagement n'a pas de 2035, ni de ligne 25 où la CSG-CRDS serait déduite à tort.
    const engagement: ModeleComptable = { mode: 'engagement', compteNotesDeFrais: '455000', plan: PLAN_PAR_DEFAUT }
    expect(ids(donnees({ modele: engagement, cotisations: [echeance('ck', '2025-03-05', 900)] }))).not.toContain('csg-non-saisie')
  })

  it('avertit d’un véhicule du registre amorti l’année où le barème est retenu, sans refuser', () => {
    const transport: NatureImmobilisation = { ...MATERIEL, id: 'n-transport', compte_immobilisation: '218200' }
    const registre = { immobilisations: [bien('i1', { nature_id: 'n-transport' })], natures: [transport] }
    const p = prealable(donnees({ ...registre, vehicules: [vehicule('v1', 2025, 5000)] }), 'vehicule-amorti-sous-bareme')
    expect(p?.bloquant).toBe(false)
    expect(p?.nb).toBe(1)
    // Sans barème cette année-là, la dotation se déduit : rien à dire.
    expect(ids(donnees(registre))).not.toContain('vehicule-amorti-sous-bareme')
    // Ni en engagement, où il n'y a pas de 2035 à figer.
    const engagement: ModeleComptable = { mode: 'engagement', compteNotesDeFrais: '455000', plan: PLAN_PAR_DEFAUT }
    expect(ids(donnees({ ...registre, modele: engagement, vehicules: [vehicule('v1', 2025, 5000)] }))).not.toContain('vehicule-amorti-sous-bareme')
  })

  it('ne juge rien de la 2035 en engagement, qui n’en produit pas', () => {
    const presents = ids(donnees({
      modele: { mode: 'engagement', compteNotesDeFrais: '455000', plan: PLAN_PAR_DEFAUT },
      categories: [{ ...ACHATS, poste_2035: 'Frais de véhicules' }], vehicules: [vehicule('v1', 2025, 5000)],
      cotisations: [echeance('ck', '2025-03-05', 900)],
    }))
    for (const id of ['postes-sans-case', 'cases-negatives', 'frais-vehicule-en-double', 'csg-non-saisie', 'vehicule-amorti-sous-bareme']) {
      expect(presents).not.toContain(id)
    }
  })
})

// CHAQUE CARTE DE CLÔTURE EST REPRISE OU ÉCARTÉE AVEC SA RAISON. Une fois l'exercice validé, elles se taisent ; ce
// qu'elles signalent se refuse ou se lit donc avant. Une carte ajoutée demain à Clôture doit se poser la question.
describe('prealablesDeValidation — la couverture des cartes de Clôture', () => {
  const cloture = readFileSync(new URL('../pages/dossier/ClotureTab.tsx', import.meta.url), 'utf8')
  const module = readFileSync(new URL('./prealablesValidation.ts', import.meta.url), 'utf8')
  // Le titre d'une carte, lu dans son <h3> jusqu'à la balise fermante — sur plusieurs lignes s'il le faut —, sans ses
  // expressions (`{…}`), ses balises internes (un badge) ni les parenthèses que le compte retiré laisse vides.
  function titres(source: string): string[] {
    return [...source.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>/g)].map((m) => m[1]
      .replace(/<(\w+)\b[^>]*>[\s\S]*?<\/\1>/g, ' ')
      .replace(/\{[^{}]*\}/g, '')
      .replace(/\(\s*\)/g, '')
      .replace(/\s+/g, ' ')
      .trim())
  }
  const prealables = module.split('export const CARTES_DE_CLOTURE')[0]

  it('lit bien les titres des cartes — le plancher qui distingue « rien à redire » d’« aveugle »', () => {
    expect(titres(cloture).length).toBeGreaterThanOrEqual(15)
  })

  it('reprend chaque carte, ou l’écarte avec sa raison', () => {
    expect(titres(cloture).filter((t) => !(t in CARTES_DE_CLOTURE))).toEqual([])
  })

  it('ne nomme que des cartes qui existent, et des préalables qui existent', () => {
    const lus = new Set(titres(cloture))
    for (const [titre, sort] of Object.entries(CARTES_DE_CLOTURE)) {
      expect(lus.has(titre), `« ${titre} » n'est pas une carte de Clôture`).toBe(true)
      if ('prealable' in sort) expect(new RegExp(`id: '${sort.prealable}'`).test(prealables), sort.prealable).toBe(true)
    }
  })

  it('lit un titre écrit sur plusieurs lignes, avec un badge et un compte', () => {
    const source = `<h3 style={{ marginTop: 0, display: 'flex' }}>
      Pièces en défaut <span className="badge">à traiter</span>
    </h3>
    <h3 style={{ marginTop: 0 }}>Amortissement(s) sans justificatif ({liste.length})</h3>`
    expect(titres(source)).toEqual(['Pièces en défaut', 'Amortissement(s) sans justificatif'])
  })
})

// CHAQUE POINT EN ERREUR DE LA CHECKLIST EST REPRIS OU ÉCARTÉ AVEC SA RAISON. La Checklist dit ce qui ne va pas
// dans le dossier ; un défaut qu'elle signale en erreur ne se fige pas. Un contrôle ajouté demain à la Checklist
// doit se poser la question de la validation : ce test le refuse tant qu'il ne figure dans aucune des deux listes.
describe('prealablesDeValidation — la couverture des points de la Checklist', () => {
  // Les points de la Checklist vivent dans lib/pointsDeLaChecklist.ts depuis l'étape R3 de la révision ; l'écran est
  // relu aussi, pour qu'un point qu'on y écrirait de nouveau en dur ne passe pas inaperçu.
  const checklist = [new URL('../pages/dossier/ChecklistTab.tsx', import.meta.url), new URL('./pointsDeLaChecklist.ts', import.meta.url)]
    .map((chemin) => readFileSync(chemin, 'utf8')).join('\n')
  const module = readFileSync(new URL('./prealablesValidation.ts', import.meta.url), 'utf8')

  // Les points écrits `{ id: '…', … severite: 'erreur' … }`, sur une ou plusieurs lignes : on lit chaque objet
  // jusqu'à son accolade fermante, jamais « la ligne ».
  function pointsEnErreur(source: string): string[] {
    const points: string[] = []
    for (const m of source.matchAll(/\{\s*id: '([a-z0-9-]+)'/g)) {
      let profondeur = 0
      let i = m.index!
      for (; i < source.length; i++) {
        if (source[i] === '{') profondeur++
        else if (source[i] === '}' && --profondeur === 0) break
      }
      if (/severite: 'erreur'/.test(source.slice(m.index!, i))) points.push(m[1])
    }
    return points
  }
  const repris = (id: string) => new RegExp(`id: '${id}'`).test(module.split('export const POINTS_DE_LA_CHECKLIST_ECARTES')[0])

  it('lit bien les points de la Checklist — le plancher qui distingue « rien à redire » d’« aveugle »', () => {
    expect(pointsEnErreur(checklist).length).toBeGreaterThanOrEqual(25)
  })

  it('reprend chaque point en erreur, ou l’écarte avec sa raison', () => {
    const orphelins = pointsEnErreur(checklist).filter((id) => !repris(id) && !(id in POINTS_DE_LA_CHECKLIST_ECARTES))
    expect(orphelins).toEqual([])
  })

  it('n’écarte que des points qui existent, et qu’il ne reprend pas aussi', () => {
    const points = new Set(pointsEnErreur(checklist))
    for (const id of Object.keys(POINTS_DE_LA_CHECKLIST_ECARTES)) {
      expect(points.has(id), `« ${id} » n'est pas un point en erreur de la Checklist`).toBe(true)
      expect(repris(id), `« ${id} » est écarté et repris à la fois`).toBe(false)
    }
  })

  // Le lecteur lui-même, sur une source synthétique : un point en erreur écrit sur plusieurs lignes est lu, un
  // point en « attention » ne l'est pas.
  it('lit un point écrit sur plusieurs lignes, et ignore un point en attention', () => {
    const source = `[
      { id: 'a', label: 'x', nb: 1, severite: 'attention' },
      {
        id: 'b', label: 'y',
        nb: 2, severite: 'erreur', detail: { texte: '}' === '}' ? 'z' : 'w' },
      },
    ]`
    expect(pointsEnErreur(source)).toEqual(['b'])
  })

  // LES DEUX POINTS DES VENTES FACTURÉES (ligne 28.65, étape VF5f) : en « attention » dans la Vue d'ensemble — ils disent
  // un geste à faire, pas une anomalie du brouillon —, et REPRIS par la validation depuis l'étape VF7c (conception de VF7,
  // § 3 d), comme elle reprend les mouvements à traiter : sous leurs identifiants, aux mots de la base, ni écartés.
  it('tient « mouvements réservés » et « encaissements sans mouvement » en attention, et les reprend dans la validation (VF7c)', () => {
    const points = readFileSync(new URL('./pointsDeLaChecklist.ts', import.meta.url), 'utf8')
    for (const id of ['mouvements-reserves', 'encaissements-sans-mouvement']) {
      const debut = points.indexOf(`id: '${id}'`)
      expect(debut, `« ${id} » n'est pas un point de la Checklist`).toBeGreaterThan(0)
      expect(points.slice(debut, points.indexOf('}', debut))).toContain("severite: 'attention'")
      expect(pointsEnErreur(checklist)).not.toContain(id)
      expect(repris(id), `« ${id} » n'est pas repris par la validation`).toBe(true)
      expect(id in POINTS_DE_LA_CHECKLIST_ECARTES).toBe(false)
    }
  })

  // LES DEUX POINTS DE LA JUMELLE INVERSÉE (étape VF6e) : en « attention ». La pièce à désigner ne se valide pas sans sa
  // marque — la base la refuse (G3) — et, validée avant la bascule, compte comme hier ; la vente déclarée dont le montant est
  // celui d'une facture source est un symptôme, qui ne décide rien (VF6-Q4). Ni l'un ni l'autre ne retient la validation ;
  // la vente comptée deux fois, elle, reste un préalable bloquant, dans les deux régimes.
  it('tient « exemplaires à désigner » et « ventes hors factures à vérifier » en attention, et « ventes en double » reprise', () => {
    const points = readFileSync(new URL('./pointsDeLaChecklist.ts', import.meta.url), 'utf8')
    for (const id of ['exemplaires-a-designer', 'ventes-hors-factures-a-verifier']) {
      const debut = points.indexOf(`id: '${id}'`)
      expect(debut, `« ${id} » n'est pas un point de la Checklist`).toBeGreaterThan(0)
      expect(points.slice(debut, points.indexOf('}', debut))).toContain("severite: 'attention'")
      expect(pointsEnErreur(checklist)).not.toContain(id)
      expect(repris(id), `« ${id} » est repris par la validation`).toBe(false)
      expect(id in POINTS_DE_LA_CHECKLIST_ECARTES).toBe(false)
    }
    expect(pointsEnErreur(checklist)).toContain('ventes-en-double')
    expect(repris('ventes-en-double')).toBe(true)
  })
})

// LE VIREMENT MIXTE (chantier EC-Q3, étape VF5h) : l'exemplaire d'une facture d'avant la bascule, qu'un crédit classé par
// ses encaissements paie, se date par lui (`partsEncaissees`, lib/rattachement.ts) — dans les préalables comme dans la
// 2035. Sans ses parts, il retomberait à sa date de facture : ses écritures, datées par le virement, se diraient « à
// régénérer », et l'exercice de sa facture deviendrait le premier à valider.
describe('prealablesDeValidation et prochainExerciceAValider — la pièce qu’un virement mixte paie (étape VF5h)', () => {
  const RECETTE_D_AVANT = piece('pv', {
    type_piece: 'vente', categorie_id: 'c-recettes', tiers: 'Client d’avant', date_piece: '2025-12-15', montant_ttc: 60, facture_id: 'fa',
  })
  // Le crédit de janvier, classé par ses encaissements : celui de la facture source, et les 60 € de la facture d'avant.
  const VIREMENT_MIXTE = ligne('mx', { date: '2026-01-08', libelle: 'VIR CLIENT', montant: 179.5, encaissements_de_factures: true })
  const PARTS: PartEncaissee[] = [{ ligne_bancaire_id: 'mx', piece_id: 'pv', montant: 60 }]
  const TRESORERIE: ModeleComptable = { mode: 'tresorerie', compteNotesDeFrais: '108000', plan: PLAN_PAR_DEFAUT }
  // Ses écritures telles que la génération les écrit : à la date du virement, sa banque sur lui.
  const ECRITES = lignesPourPiece('d1', RECETTE_D_AVANT, { compte: '706000', immobilisation: false }, false,
    paiementsDesPieces([VIREMENT_MIXTE], [], PARTS, []).get('pv') ?? [], TRESORERIE)
    .map((l, i) => ecriture(`ev${i}`, { ...l, piece_id: 'pv', ligne_bancaire_id: l.ligne_bancaire_id ?? null }))

  it('les écritures de la pièce sont celles de son paiement par le virement : 2025 n’a rien à régénérer', () => {
    expect(ECRITES.map((e) => e.date)).toEqual(['2026-01-08', '2026-01-08'])
    expect(ECRITES.find((e) => e.compte === COMPTE_BANQUE)).toMatchObject({ sens: 'debit', montant: 60, ligne_bancaire_id: 'mx' })
    const avec = (encaissees: PartEncaissee[]) => donnees({
      piecesValidees: [P1, RECETTE_D_AVANT], categories: [ACHATS, RECETTES], lignes: [L1, VIREMENT_MIXTE],
      ecritures: [E1, E2, ...ECRITES], encaissees,
    })
    expect(ids(avec(PARTS))).not.toContain('desynchronisees')
    // Sans les parts du virement mixte, la pièce compterait le 15/12/2025, et ses écritures de 2026 seraient « à régénérer ».
    expect(prealable(avec([]), 'desynchronisees')?.nb).toBe(1)
  })

  it('le premier exercice à valider est celui du virement, pas celui de la facture', () => {
    const avec = (encaissees: PartEncaissee[]) => prochainExerciceAValider(donnees({
      piecesValidees: [P1, { ...RECETTE_D_AVANT, date_piece: '2024-12-15' }], categories: [ACHATS, RECETTES],
      lignes: [L1, { ...VIREMENT_MIXTE, date: '2025-01-08' }], encaissees,
    }))
    expect(avec(PARTS)).toBe(2025)
    expect(avec([])).toBe(2024)
  })
})

// ── CE QUE LA BASE REFUSE POUR LES VENTES FACTURÉES (chantier EC-Q3, étape VF7b), CONFRONTÉ ────────────────────────────
// `REFUS_VENTES_FACTUREES_DE_LA_VALIDATION` redit les refus que la migration `validation_des_ventes_facturees` ajoute à
// `valider_exercice` : leurs mots, leurs codes, leurs valeurs, leur ordre et leur place parmi les refus d'hier, dans le texte
// exporté ; et l'essai (supabase/essais/validationDesVentesFacturees.sql) les exige de la base, chacun sous ses mots et son
// code, comme il n'exige rien que le texte d'une fonction ne dise.
describe('les refus de la validation pour les ventes facturées (étape VF7b) — le texte de valider_exercice et l’essai', () => {
  const sql = derniereDefinitionSql('valider_exercice')
  const messages = messagesSql(sql)
  const codes = codesSql(sql)
  const valeurs = argumentsSql(sql)
  const modeles: readonly string[] = REFUS_VENTES_FACTUREES_DE_LA_VALIDATION.map((r) => r.modele)
  const rangs = modeles.map((m) => messages.indexOf(m))
  const essai = readFileSync(new URL('../../supabase/essais/validationDesVentesFacturees.sql', import.meta.url), 'utf8')
  const exiges = (texte: string) => etapesDe(texte).filter((e) => e.code !== '' && e.code !== 'OK')
  const exige = (texte: string, modele: string, code: string) =>
    exiges(texte).some((e) => e.code === code && correspondAuModele(modele, e.attendu))

  it('les mêmes messages, dans l’ordre du texte, sous les mêmes codes, autant de « % » que de valeurs', () => {
    expect(REFUS_VENTES_FACTUREES_DE_LA_VALIDATION).toHaveLength(7)
    expect(rangs.every((r) => r >= 0), rangs.join(',')).toBe(true)
    expect([...rangs].sort((a, b) => a - b)).toEqual(rangs)
    expect(new Set(REFUS_VENTES_FACTUREES_DE_LA_VALIDATION.map((r) => r.cle)).size).toBe(7)
    REFUS_VENTES_FACTUREES_DE_LA_VALIDATION.forEach((r, k) => {
      expect(codes[rangs[k]], r.cle).toBe(r.code)
      expect(r.modele.split('%').length - 1, r.cle).toBe(valeurs[rangs[k]].length)
    })
  })

  it('à leur place : le mouvement réservé avant les mouvements à traiter, le reste après eux, avant la 2035', () => {
    const anterieurs = messages.indexOf("Des mouvements bancaires antérieurs à l'ouverture du dossier restent à traiter : les ignorer avant la validation.")
    const aTraiter = messages.indexOf("L'exercice % porte des mouvements bancaires à traiter : ils se traitent avant la validation.")
    expect(anterieurs).toBeGreaterThan(0)
    expect(aTraiter).toBe(anterieurs + 1)
    // Les deux du mouvement réservé, juste avant ceux des mouvements à traiter ; les cinq autres, juste après eux, puis la
    // 2035 (son refus s'écrit « '%' », le message choisi selon le modèle comptable).
    expect(rangs.slice(0, 2)).toEqual([anterieurs - 2, anterieurs - 1])
    expect(rangs.slice(2)).toEqual([aTraiter + 1, aTraiter + 2, aTraiter + 3, aTraiter + 4, aTraiter + 5])
    expect(messages[aTraiter + 6]).toBe('%')
    expect(valeurs[aTraiter + 6].join(' ')).toContain("'La 2035 à valider manque.'")
  })

  it('les valeurs que la base y met : l’exercice de la date nommée, la date, la facture, le moyen, la source', () => {
    const v = (cle: string) => valeurs[rangs[REFUS_VENTES_FACTUREES_DE_LA_VALIDATION.findIndex((r) => r.cle === cle)]]
    const reserve = ['extract(year from v_mouvement.date)::integer', "to_char(v_mouvement.date, 'DD/MM/YYYY')", 'v_numero']
    expect(v('mouvement_reserve_credit')).toEqual(reserve)
    expect(v('mouvement_reserve_debit')).toEqual(reserve)
    expect(v('encaissement_sans_mouvement')).toEqual([
      'extract(year from v_encaissement.date_encaissement)::integer', 'v_encaissement.numero',
      "case v_encaissement.moyen when 'virement' then 'virement' else 'prélèvement' end",
      "to_char(v_encaissement.date_encaissement, 'DD/MM/YYYY')",
    ])
    for (const cle of ['a_ecrire', 'a_reecrire', 'a_retirer', 'ne_s_ecrit_pas']) {
      expect(v(cle), cle).toEqual(['extract(year from v_vente.jour)::integer', 'v_vente.nom'])
    }
  })

  it('les moyens qui retiennent, et leur nom ; les états de la source, dans l’ordre des refus', () => {
    expect(sql).toContain(`e.moyen in (${Object.keys(NOM_DU_MOYEN_SANS_MOUVEMENT).map((m) => `'${m}'`).join(', ')})`)
    expect(sql).toContain(`case v_encaissement.moyen when 'virement' then '${NOM_DU_MOYEN_SANS_MOUVEMENT.virement}' else '${NOM_DU_MOYEN_SANS_MOUVEMENT.prelevement}' end`)
    const etats = [...sql.matchAll(/if v_vente\.etat = '(\w+)' then/g)].map((m) => m[1])
    expect(etats).toEqual(['a_ecrire', 'a_reecrire', 'a_retirer'])
    expect(REFUS_VENTES_FACTUREES_DE_LA_VALIDATION.slice(3).map((r) => r.cle)).toEqual([...etats, 'ne_s_ecrit_pas'])
    // Ce sont les quatre états que rend la fonction des sources en défaut.
    const jugement = derniereDefinitionSql('ventes_facturees_de_l_exercice')
    for (const etat of ['ne_s_ecrit_pas', 'a_ecrire', 'a_retirer', 'a_reecrire']) expect(jugement, etat).toContain(` '${etat}'`)
  })

  it('vire au rouge sur une dérive plantée : un mot, deux refus permutés, un refus ajouté, un code changé', () => {
    const relus = (texte: string) => modeles.map((m) => messagesSql(texte).indexOf(m))
    // Les deux du réservé se suivent, et les cinq autres aussi.
    const tenu = (r: number[]) => r.every((x) => x >= 0) && r.every((x, i) => i === 0 || i === 2 || x === r[i - 1] + 1)
    const premier = `raise exception '${modeles[3].replace(/'/g, "''")}'`
    const second = `raise exception '${modeles[4].replace(/'/g, "''")}'`
    expect(sql).toContain(premier)
    expect(sql).toContain(second)
    expect(tenu(rangs)).toBe(true)
    expect(tenu(relus(sql.replace(premier, `${premier.slice(0, -1)} !'`)))).toBe(false)
    expect(tenu(relus(sql.replace(premier, '§').replace(second, premier).replace('§', second)))).toBe(false)
    expect(tenu(relus(sql.replace(second, `raise exception 'Un refus de plus.' using errcode = '23514'; ${second}`)))).toBe(false)
    const code = "using errcode = '23514'"
    const dernier = sql.indexOf(code, sql.indexOf(second))
    const plante = `${sql.slice(0, dernier)}using errcode = '22023'${sql.slice(dernier + code.length)}`
    expect(codesSql(plante)[messagesSql(plante).indexOf(modeles[4])]).toBe('22023')
  })

  it('l’essai exige chaque refus de la base, sous ses mots et son code', () => {
    expect(etapesDe(essai).length).toBeGreaterThan(60)
    for (const r of REFUS_VENTES_FACTUREES_DE_LA_VALIDATION) expect(exige(essai, r.modele, r.code), r.cle).toBe(true)
  })

  it('chaque refus que l’essai exige est dans le texte d’une fonction, sous le même code', () => {
    const raiseSql = ['valider_exercice', 'ecrire_vente_facturee', 'retirer_ecriture_vente_facturee', 'garder_ecritures_validees']
      .flatMap((nom) => {
        const texte = derniereDefinitionSql(nom)
        const lesCodes = codesSql(texte)
        return messagesSql(texte).map((m, i) => [m, lesCodes[i]] as const)
      })
    expect(exiges(essai).length).toBeGreaterThan(15)
    for (const e of exiges(essai)) {
      expect(raiseSql.some(([m, c]) => c === e.code && correspondAuModele(m, e.attendu)), `${e.titre} : ${e.code} ${e.attendu}`).toBe(true)
    }
  })

  it('vire au rouge sur un refus que l’essai n’exigerait plus, ou sous un autre code', () => {
    const r = REFUS_VENTES_FACTUREES_DE_LA_VALIDATION[2]
    expect(exige(essai, r.modele, '22023')).toBe(false)
    const plante = essai.replace(/— le rattacher avant la validation\./g, '— le rattacher avant la validation !')
    expect(plante).not.toBe(essai)
    expect(exige(plante, r.modele, r.code)).toBe(false)
  })

  // La migration reprend `valider_exercice` telle que `report_des_soldes` l'a laissée : sa garde exige ce corps-là, au
  // caractère près, et ses refus d'hier y restent, mot pour mot et dans leur ordre — la définition d'hier, ligne à ligne,
  // se retrouve dans la nouvelle, qui n'ajoute que des lignes.
  const fichiers = fichiersDuSchema()
  const migration = fichiers.find((f) => /\/\d{14}_validation_des_ventes_facturees\.sql$/.test(f.chemin))
  const avant = (() => {
    const rang = fichiers.findIndex((f) => f === migration)
    const motif = /create (or replace )?function public\.valider_exercice\(/g
    const texte = fichiers.slice(0, rang).filter((f) => new RegExp(motif.source).test(f.texte)).at(-1)?.texte ?? ''
    const debut = [...texte.matchAll(motif)].at(-1)?.index ?? -1
    return debut < 0 ? '' : texte.slice(debut, texte.indexOf('$$;', debut))
  })()
  // La définition que CETTE migration pose. Une migration postérieure la reprend — `champs_bnc_du_fec` (ligne 26.6, lot
  // FEC22b), qui y ajoute les quatre champs du FEC d'un BNC, préparée hors de l'export puis dans l'export le jour de son
  // application — et porte alors la dernière ; champsBncFiges.test.ts confronte la sienne à celle-ci. Ce garde-ci
  // confronte donc ce que VF7b a posé, où que soit la dernière.
  const posee = (() => {
    const texte = migration?.texte ?? ''
    const debut = texte.search(/create (or replace )?function public\.valider_exercice\(/)
    return debut < 0 ? '' : texte.slice(debut, texte.indexOf('$$;', debut))
  })()
  const repriseDepuis = /\/\d{14}_champs_bnc_du_fec\.sql$/

  it('la migration : ses refus d’hier au caractère près, la définition d’hier contenue ligne à ligne dans la nouvelle', () => {
    expect(migration).toBeDefined()
    expect(avant).toContain('create or replace function public.valider_exercice(')
    const derniere = fichiers.filter((f) => /create (or replace )?function public\.valider_exercice\(/.test(f.texte)).at(-1)?.chemin ?? ''
    expect(derniere === migration?.chemin || repriseDepuis.test(derniere), derniere).toBe(true)
    // Tant qu'elle est la dernière, la base exécute ce qu'elle pose.
    if (derniere === migration?.chemin) expect(sql).toBe(posee)
    const lesMessages = messagesSql(posee)
    const lesRangs = modeles.map((m) => lesMessages.indexOf(m))
    expect(lesRangs.every((r) => r >= 0), lesRangs.join(',')).toBe(true)
    expect(lesMessages.filter((m) => !modeles.includes(m))).toEqual(messagesSql(avant))
    expect(codesSql(posee).filter((_, i) => !lesRangs.includes(i))).toEqual(codesSql(avant))
    const neuves = posee.split('\n')
    let k = 0
    for (const ligne of avant.split('\n')) {
      while (k < neuves.length && neuves[k] !== ligne) k++
      expect(k < neuves.length, ligne).toBe(true)
      k++
    }
  })

  it('la migration : sa garde sur le corps d’hier, deux fonctions neuves hors de l’API, rien que le détecteur retiendrait', () => {
    const texte = (migration as { texte: string }).texte
    const corps = avant.slice(avant.indexOf('as $$') + 'as $$'.length)
    expect(texte).toContain(`'${createHash('md5').update(corps).digest('hex')}', 'report_des_soldes'`)
    expect(texte).toContain("'8c4c7a5a618de4a692d2494f9a197b0c', 'report_des_soldes'")
    for (const f of ['ecritures_attendues_de_la_periode(uuid, date, date)', 'ventes_facturees_de_l_exercice(uuid, integer)']) {
      expect(texte).toContain(`revoke execute on function public.${f} from public, anon, authenticated;`)
    }
    for (const nom of ['ecritures_attendues_de_la_periode', 'ventes_facturees_de_l_exercice']) {
      expect(derniereDefinitionSql(nom), nom).not.toContain('security definer')
    }
    expect(texte).not.toMatch(/\b(drop|delete|truncate|grant)\b/i)
    expect(texte).not.toMatch(/\b(create|alter) (table|policy|trigger)\b/i)
    expect(texte).not.toContain('\\')
  })
})

// ── LES VENTES FACTURÉES D'UN DOSSIER BASCULÉ, DITES AVANT LE CLIC (chantier EC-Q3, étape VF7c) ─────────────────────────
// Le dossier basculé de src/test/dossierBascule.ts (trois factures de services, un avoir, un virement du même jour, un chèque
// crédité le lendemain), composé, écrit comme la fonction de VF4b l'écrit, puis jugé. Chaque préalable de ses deux côtés :
// présent sous les mots de la base, absent quand la base ne refuserait pas — hors de l'exercice, ou dans un dossier qui n'a
// pas basculé, où rien ne change. Données FICTIVES.
describe('prealablesDeValidation — les ventes facturées d’un dossier basculé (VF7c)', () => {
  const ENGAGEMENT: ModeleComptable = { mode: 'engagement', compteNotesDeFrais: '455000', plan: PLAN_PAR_DEFAUT }
  const TRESORERIE: ModeleComptable = { mode: 'tresorerie', compteNotesDeFrais: '108000', plan: PLAN_PAR_DEFAUT }
  const FRAIS_BANCAIRES: Categorie = {
    id: 'c-frais', dossier_id: null, code: 'frais_bancaires', libelle: 'Frais bancaires', ordre: 3, compte_comptable: '627000',
    poste_2035: 'Frais financiers',
  }
  type EncaissementDesSources = SourcesDesEcrituresDeVente['encaissements'][number]

  interface Bascule {
    sources?: SourcesDesEcrituresDeVente
    // Le brouillon que la fonction de VF4b écrirait pour la composition, retouché.
    brouillon?: (ecrit: EcritureBrouillon[]) => EcritureBrouillon[]
    modele?: ModeleComptable
    categories?: Categorie[]
    anneesValidees?: number[]
    autres?: Surcharges
  }
  function bascule(o: Bascule = {}): DonneesDeValidation {
    const sources = o.sources ?? sourcesDuDossierBascule()
    const modele = o.modele ?? ENGAGEMENT
    const c = composition(sources, modele.mode, modele.plan)
    const ecrit = brouillonDesVentes(c)
    const brouillon = o.brouillon ? o.brouillon(ecrit) : ecrit
    const anneesValidees = o.anneesValidees ?? []
    const ventes = ventesFacturees({
      dossierId: sources.dossierId, factures: sources.factures, lignes: sources.lignes, encaissements: sources.encaissements, parts: sources.parts,
    })
    const categories = o.categories ?? []
    const base = donnees({
      modele, assujettiTva: true, piecesValidees: [], categories, ecritures: brouillon, lignes: sources.mouvements.map(ligneBancaire),
      anneesValidees, facturesSources: ventes.sources,
      etatsDesVentes: etatsDesVentesFacturees({ sources, brouillon, mode: modele.mode, plan: modele.plan, anneesValidees, ventesParLesFactures: true }),
      ventesDeLaChecklist: ventesDeLaChecklist({ dossierId: sources.dossierId, etat: 'lue', sources }, frontiereDeValidation(anneesValidees)),
      ...o.autres,
    })
    if (modele.mode === 'engagement') return base
    // En trésorerie, la 2035 qui lit les ventes facturées et leurs écritures, et sa concordance avec le brouillon.
    const declaration = calculerDeclaration2035(
      2025, [], categories, [], [], [], true, paiementsDesPieces([], [], [], []), [], [], modele.plan, ventes, { etat: 'composees', composition: c }, CAISSE_ABSENTE,
    )
    const concordance = concordance2035(declaration, base.ecritures, {
      piecesValidees: new Set(), piecesImmobilisees: new Set(),
      mouvementsDesVentesFacturees: new Set(sources.mouvements.filter((m) => m.encaissements_de_factures).map((m) => m.id)),
    }, null)
    return { ...base, declaration, concordance }
  }
  const bloquants = (d: DonneesDeValidation) => prealablesDeValidation(d).prealables.filter((p) => p.bloquant).map((p) => p.id)
  // Un encaissement que rien ne rattache au relevé, et son mouvement retiré du relevé.
  const sansMouvement = (s: SourcesDesEcrituresDeVente, id: string, o: Partial<EncaissementDesSources> = {}): SourcesDesEcrituresDeVente => {
    const e = s.encaissements.find((x) => x.id === id)!
    return {
      ...s,
      encaissements: s.encaissements.map((x) => (x.id === id ? { ...x, ligne_bancaire_id: null, ...o } : x)),
      mouvements: s.mouvements.filter((m) => m.id !== e.ligne_bancaire_id),
    }
  }
  // Le virement m1 laissé à traiter : réservé à l'encaissement e1 qui le cite.
  const avecReserve = (): SourcesDesEcrituresDeVente => {
    const s = sourcesDuDossierBascule()
    return { ...s, mouvements: s.mouvements.map((m) => (m.id === 'm1' ? { ...m, statut: 'non_rapprochee' as const, encaissements_de_factures: false } : m)) }
  }
  const unEncaissementDePlus = (s: SourcesDesEcrituresDeVente, o: Parameters<typeof encaissementVendu>[0]): SourcesDesEcrituresDeVente => {
    const { encaissement, part } = encaissementVendu(o)
    return { ...s, encaissements: [...s.encaissements, { ...encaissement, compte_contrepartie: null, cree_par: null }], parts: [...s.parts, part] }
  }

  // LA CAISSE D'UN DOSSIER BASCULÉ (ligne 26.6, étape C3b ; CAISSE-Q2, (A)) : les espèces d'une facture source encaissées le
  // jour d'une recette de caisse, sur la lecture même des ventes facturées. Non reconnues par la recette, elle est à revoir.
  it('la caisse : une recette qui ne reconnaît pas les espèces d’une facture de son jour est à revoir (C3b)', () => {
    const sources = sansMouvement(sourcesDuDossierBascule(), 'e1', { moyen: 'especes' })
    const recette = (reconnus: string[]) => operationDeCaisse({
      id: 'r1', genre: 'recette', date: '2025-11-20', montant: 40, categorie_id: HONORAIRES_CAISSE.id, encaissements_du_jour: reconnus,
    })
    const d = (r: OperationCaisse) => bascule({
      sources, modele: TRESORERIE, categories: [HONORAIRES_CAISSE], brouillon: (ecrit) => [...ecrit, ...lignesDeLaCaisse(r)],
      autres: { operationsDeCaisse: caisseLue([r]) },
    })
    const p = prealable(d(recette([])), 'recettes-de-caisse-a-revoir')
    expect(p).toMatchObject({ nb: 1, bloquant: true, cible: 'caisse' })
    expect(p!.detail).toMatch(/^le 20\/11\/2025, recette de 40,00\s€ \(F\d{4}-\d{4}\)\.$/)
    expect(ids(d(recette(['e1'])))).not.toContain('recettes-de-caisse-a-revoir')
  })

  it('un exercice tenu : aucun préalable bloquant, et chaque écriture de vente numérotée — dans les deux modèles', () => {
    for (const modele of [ENGAGEMENT, TRESORERIE]) {
      const d = bascule({ modele })
      const etat = prealablesDeValidation(d)
      expect(etat.prealables.filter((p) => p.bloquant)).toEqual([])
      expect(etat.validable).toBe(true)
      expect(etat.numerotation!.horsFec).toEqual([])
      expect(etat.numerotation!.lignes.map((l) => l.ecriture.id).sort()).toEqual(d.ecritures.map((e) => e.id).sort())
    }
  })

  it('mouvements-reserves : sous les mots de la base, avant les mouvements à traiter, qui ne le comptent plus', () => {
    const d = bascule({ sources: avecReserve() })
    const p = prealable(d, 'mouvements-reserves')!
    expect(p.bloquant).toBe(true)
    expect(p.message).toBe(motsDeLaBase('mouvement_reserve_credit', [2025, '20/11/2025', 'F2025-0001']))
    expect(p.message).toBe("L'exercice 2025 porte un mouvement du 20/11/2025 réservé à l'encaissement de la facture F2025-0001 : le classer par ses encaissements avant la validation.")
    expect(p.detail).toMatch(/^1 mouvement concerné : le 20\/11\/2025/)
    expect(ids(d)).not.toContain('mouvements-a-traiter')
    // Un autre mouvement à traiter se dit toujours, et lui seul.
    const reserve = avecReserve()
    const autre = bascule({ sources: reserve, autres: { lignes: [...reserve.mouvements.map(ligneBancaire), ligne('l9', { statut: 'non_rapprochee', date: '2025-12-01' })] } })
    expect(ids(autre).indexOf('mouvements-reserves')).toBeLessThan(ids(autre).indexOf('mouvements-a-traiter'))
    expect(prealable(autre, 'mouvements-a-traiter')?.detail).toBe('1 mouvement concerné')
  })

  it('mouvements-reserves : un débit, sous les mots de ses contre-passations', () => {
    const d = bascule({ sources: avecReserve() })
    const lue = d.ventesDeLaChecklist!
    if (lue.etat !== 'lue') throw new Error('la Vue d’ensemble n’a pas lu les ventes')
    const debit = { ...d, ventesDeLaChecklist: { ...lue, reserves: lue.reserves.map((m) => ({ ...m, montant: -120 })) } }
    expect(prealable(debit, 'mouvements-reserves')?.message).toBe(
      "L'exercice 2025 porte un mouvement du 20/11/2025 réservé à la contre-passation d'un encaissement de la facture F2025-0001 : le classer par ses contre-passations avant la validation.",
    )
  })

  it('mouvements-reserves : de l’autre côté, ni un réservé de l’exercice suivant, ni un dossier qui n’a pas basculé', () => {
    const s = avecReserve()
    const enJanvier = {
      ...s,
      encaissements: s.encaissements.map((e) => (e.id === 'e1' ? { ...e, date_encaissement: '2026-01-05' } : e)),
      mouvements: s.mouvements.map((m) => (m.id === 'm1' ? { ...m, date: '2026-01-05' } : m)),
    }
    const d = bascule({ sources: enJanvier })
    expect(ids(d)).not.toContain('mouvements-reserves')
    expect(ids(d)).not.toContain('mouvements-a-traiter')
    // Le même mouvement dans un dossier qui n'a pas basculé : un mouvement à traiter, comme hier.
    const hier = donnees({ lignes: [L1, ligne('l9', { statut: 'non_rapprochee', date: '2025-11-20' })] })
    expect(ids(hier)).toContain('mouvements-a-traiter')
    expect(ids(hier)).not.toContain('mouvements-reserves')
  })

  it('encaissements-sans-mouvement : un virement ou un prélèvement sans son mouvement, sous les mots de la base', () => {
    const virement = bascule({ sources: sansMouvement(sourcesDuDossierBascule(), 'e1') })
    const p = prealable(virement, 'encaissements-sans-mouvement')!
    expect(p.bloquant).toBe(true)
    expect(p.message).toBe("L'exercice 2025 porte un encaissement de la facture F2025-0001 par virement du 20/11/2025, sans son mouvement : il manque au relevé, ou n'y est pas rattaché — le rattacher avant la validation.")
    expect(p.detail).toMatch(/^1 encaissement concerné : F2025-0001 \(virement du 20\/11\/2025, 120,00\s€\)/)
    const prelevement = bascule({ sources: sansMouvement(sourcesDuDossierBascule(), 'e1', { moyen: 'prelevement' }) })
    expect(prealable(prelevement, 'encaissements-sans-mouvement')?.message).toMatch(/par prélèvement du 20\/11\/2025, sans son mouvement/)
    expect(ids(prelevement)).not.toContain('encaissements-en-cours')
  })

  it('encaissements-sans-mouvement : de l’autre côté, un chèque en cours au 511 (un avertissement nommé), un virement de l’exercice suivant', () => {
    const cheque = bascule({ sources: sansMouvement(sourcesDuDossierBascule(), 'e2') })
    expect(bloquants(cheque)).toEqual([])
    expect(prealablesDeValidation(cheque).validable).toBe(true)
    const p = prealable(cheque, 'encaissements-en-cours')!
    expect(p).toMatchObject({ bloquant: false, nb: 1, cible: 'banque' })
    expect(p.message).toMatch(/au 31 décembre 2025 : un en-cours, au 511/)
    expect(p.detail).toMatch(/^F2025-0002 \(chèque du 21\/11\/2025, 100,00\s€\)\.$/)
    const s = sourcesDuDossierBascule()
    const enJanvier = sansMouvement({
      ...s, encaissements: s.encaissements.map((e) => (e.id === 'e1' ? { ...e, date_encaissement: '2026-01-05' } : e)),
    }, 'e1')
    expect(ids(bascule({ sources: enJanvier }))).not.toContain('encaissements-sans-mouvement')
  })

  it('ventes-facturees-a-ecrire : à écrire, la première nommée sous les mots de la base, et rien parmi les orphelines', () => {
    const d = bascule({ brouillon: (b) => b.filter((l) => l.encaissement_id !== 'e2') })
    const p = prealable(d, 'ventes-facturees-a-ecrire')!
    expect(p).toMatchObject({ bloquant: true, cible: 'ecritures', nb: null })
    expect(p.message).toMatch(/^L'exercice 2025 porte une vente facturée qui n'est pas écrite : l’encaissement du 21\/11\/2025 de la facture F2025-0002 \(Clinique du Parc, chèque, 100,00\s€\) — l'écrire avant la validation\.$/)
    expect(p.detail).toMatch(/^1 vente facturée concernée : .* \(à écrire\)\. Dans Écritures, la section « Ventes facturées »/)
    expect(ids(d)).not.toContain('ecritures-orphelines')
  })

  it('ventes-facturees-a-ecrire : à réécrire et à retirer — leurs lignes hors de la numérotation, nommées ici, pas orphelines', () => {
    const reecrire = bascule({ brouillon: (b) => b.map((l) => (l.encaissement_id === 'e1' && l.sens === 'credit' ? { ...l, montant: l.montant + 1 } : l)) })
    const etat = prealablesDeValidation(reecrire)
    expect(etat.numerotation!.horsFec.length).toBeGreaterThan(0)
    expect(etat.numerotation!.horsFec.every((e) => e.encaissement_id === 'e1')).toBe(true)
    expect(ids(reecrire)).not.toContain('ecritures-orphelines')
    expect(prealable(reecrire, 'ventes-facturees-a-ecrire')?.message).toMatch(/dont l'écriture proposée n'est plus celle que sa source commande : l’encaissement du 20\/11\/2025 de la facture F2025-0001 .* — la réécrire avant la validation\.$/)
    // Un encaissement retiré dont les lignes restent au brouillon : à retirer.
    const s = sourcesDuDossierBascule()
    const ecrites = brouillonDesVentes(composition(s, 'engagement', PLAN_PAR_DEFAUT))
    const retire = bascule({
      sources: { ...s, encaissements: s.encaissements.map((e) => (e.id === 'e2' ? { ...e, retire_le: '2025-12-01T10:00:00Z' } : e)) },
      brouillon: () => ecrites,
    })
    expect(prealablesDeValidation(retire).numerotation!.horsFec.length).toBeGreaterThan(0)
    expect(ids(retire)).not.toContain('ecritures-orphelines')
    expect(prealable(retire, 'ventes-facturees-a-ecrire')?.message).toMatch(/porte l'écriture proposée d'une vente facturée qui n'a plus rien à écrire : l’encaissement du 21\/11\/2025 de la facture F2025-0002 .* — la retirer avant la validation\.$/)
  })

  it('ventes-facturees-a-ecrire : une vente qui ne s’écrit pas — le compte d’une compensation à choisir', () => {
    const avecCompensation = unEncaissementDePlus(sourcesDuDossierBascule(), {
      id: 'e3', facture_id: 'f2', date_encaissement: '2025-12-01', montant: 20, moyen: 'compensation',
    })
    const p = prealable(bascule({ sources: avecCompensation }), 'ventes-facturees-a-ecrire')!
    expect(p.message).toMatch(/^L'exercice 2025 porte une vente facturée qui ne s'écrit pas : l’encaissement du 01\/12\/2025 de la facture F2025-0002 .* — lever ce qui la retient avant la validation\.$/)
    expect(p.detail).toMatch(/\(ne s’écrit pas\)/)
  })

  it('ventes-facturees-a-ecrire : de l’autre côté, une source de l’exercice suivant, et l’orpheline d’un dossier qui n’a pas basculé', () => {
    const enJanvier = unEncaissementDePlus(sourcesDuDossierBascule(), {
      id: 'e4', facture_id: 'f2', date_encaissement: '2026-01-10', montant: 40, moyen: 'cheque',
    })
    const d = bascule({ sources: enJanvier, brouillon: (b) => b.filter((l) => l.encaissement_id !== 'e4') })
    expect(ids(d)).not.toContain('ventes-facturees-a-ecrire')
    expect(prealablesDeValidation(d).validable).toBe(true)
    // Écrit, ou écrit puis devenu à réécrire : ses lignes de janvier ne regardent pas 2025.
    expect(ids(bascule({ sources: enJanvier }))).not.toContain('ventes-facturees-a-ecrire')
    const perime = bascule({ sources: enJanvier, brouillon: (b) => b.map((l) => (l.encaissement_id === 'e4' && l.sens === 'debit' ? { ...l, montant: l.montant + 1 } : l)) })
    expect(ids(perime)).not.toContain('ventes-facturees-a-ecrire')
    // Une vente qui ne s'écrit pas, datée de janvier suivant, ou d'un exercice que la validation fige déjà : pas en 2025.
    for (const [date, anneesValidees] of [['2026-01-15', []], ['2024-12-01', [2024]]] as const) {
      const compensation = unEncaissementDePlus(sourcesDuDossierBascule(), {
        id: 'e5', facture_id: 'f2', date_encaissement: date, montant: 20, moyen: 'compensation',
      })
      const x = bascule({ sources: compensation, anneesValidees: [...anneesValidees], autres: { anneesValidees: [...anneesValidees] } })
      expect(x.etatsDesVentes?.etat === 'lus' && x.etatsDesVentes.sources.some((v) => v.cle === 'encaissement|e5' && v.etat === 'ne_s_ecrit_pas')).toBe(true)
      expect(ids(x), date).not.toContain('ventes-facturees-a-ecrire')
    }
    // La même ligne dans un dossier qui n'a pas basculé : rien ne la rattache, comme hier.
    const hier = donnees({ ecritures: [E1, E2, ecriture('v1', { piece_id: null, encaissement_id: 'e1', compte: '411000', sens: 'credit', montant: 120 })] })
    expect(prealable(hier, 'ecritures-orphelines')?.nb).toBe(1)
    expect(ids(hier)).not.toContain('ventes-facturees-a-ecrire')
    // Et dans un dossier basculé, une ligne que rien ne rattache, sans vente, reste orpheline.
    const orpheline = bascule({
      brouillon: (b) => [...b, ecriture('o1', { piece_id: null, date: '2025-06-01' }), ecriture('o2', { piece_id: null, date: '2025-06-01', compte: COMPTE_BANQUE, sens: 'credit' })],
    })
    expect(prealable(orpheline, 'ecritures-orphelines')?.nb).toBe(2)
  })

  it('la concordance des frais d’un mouvement d’encaissements reste bloquante sur un exercice numéroté', () => {
    const s = sourcesDuDossierBascule()
    const avecFrais = { ...s, mouvements: s.mouvements.map((m) => ({ ...m, montant: m.montant - 2 })) }
    const tenu = bascule({ sources: avecFrais, modele: TRESORERIE, categories: [FRAIS_BANCAIRES] })
    const etat = prealablesDeValidation(tenu)
    expect(etat.validable).toBe(true)
    expect(etat.numerotation!.lignes.filter((l) => l.ecriture.compte === '627000')).toHaveLength(2)
    // Sans catégorie « Frais bancaires », la 2035 ne compte pas les frais que les écritures portent : numérotées, elles
    // n'en sont pas moins en écart — la concordance retient la validation, et rien d'autre ne s'en charge à sa place.
    const sansPoste = bascule({ sources: avecFrais, modele: TRESORERIE, categories: [] })
    expect(bloquants(sansPoste)).toEqual(['concordance', 'exclusions-2035'])
    expect(prealable(sansPoste, 'concordance')!.nb).toBeGreaterThan(0)
    expect(prealablesDeValidation(sansPoste).numerotation!.horsFec).toEqual([])
  })

  it('anneesActives apprend les dates des ventes facturées : un exercice qui n’a qu’elles se valide d’abord', () => {
    const s = sourcesDuDossierBascule()
    const en2024: SourcesDesEcrituresDeVente = {
      ...s,
      factures: s.factures.map((f) => ({ ...f, date_emission: f.date_emission.replace('2025', '2024') })),
      encaissements: s.encaissements.map((e) => ({ ...e, date_encaissement: e.date_encaissement.replace('2025', '2024'), ligne_bancaire_id: null })),
      mouvements: [],
    }
    // Ni écriture ni mouvement de 2024 : seules les ventes facturées y sont datées.
    const d = bascule({ sources: en2024, autres: { piecesValidees: [P1], lignes: [L1], ecritures: [E1, E2] } })
    expect(prochainExerciceAValider(d)).toBe(2024)
    expect(prealable(d, 'exercice-anterieur-d-abord')?.exercice).toBe(2024)
    expect(prochainExerciceAValider({ ...d, etatsDesVentes: { etat: 'sans_objet' } })).toBe(2025)
    // En trésorerie, une facture de services que rien n'encaisse encore n'écrit rien : son émission date l'exercice quand même.
    const seule: SourcesDesEcrituresDeVente = {
      ...en2024, factures: en2024.factures.filter((f) => f.id === 'f1'), lignes: en2024.lignes.filter((l) => l.facture_id === 'f1'),
      encaissements: [], parts: [],
    }
    const t = bascule({ sources: seule, modele: TRESORERIE, autres: { piecesValidees: [P1], lignes: [L1], ecritures: [E1, E2] } })
    expect(t.etatsDesVentes?.etat === 'lus' && t.etatsDesVentes.contexte.composition.ecritures).toEqual([])
    expect(prochainExerciceAValider(t)).toBe(2024)
  })

  it('lecture-partielle : des ventes facturées pas encore lues, lues en partie, ou qui ne se tiennent pas', () => {
    const d = bascule()
    expect(d.ventesDeLaChecklist?.etat).toBe('lue')
    const cas: [Partial<DonneesDeValidation>, RegExp][] = [
      [{ etatsDesVentes: null }, /les ventes facturées ne sont pas encore lues/],
      [{ ventesDeLaChecklist: null }, /les ventes facturées ne sont pas encore lues/],
      [{ etatsDesVentes: { etat: 'incomplete', motif: 'les encaissements : lecture refusée' } }, /les ventes facturées : les encaissements : lecture refusée/],
      [{ etatsDesVentes: { etat: 'incoherent', dossierId: 'd1', motif: 'une écriture cite une facture inconnue' } }, /une écriture cite une facture inconnue/],
      [{ ventesDeLaChecklist: { etat: 'incomplete', motif: 'les mouvements du relevé' } }, /les ventes facturées : les mouvements du relevé/],
      [{ etatsDesVentes: { etat: 'sans_objet' } }, /ne se tiennent pas entre elles/],
      [{ ventesDeLaChecklist: { etat: 'sans_objet' } }, /ne se tiennent pas entre elles/],
    ]
    for (const [o, motif] of cas) {
      const etat = prealablesDeValidation({ ...d, ...o })
      expect(etat.prealables.map((p) => p.id)).toEqual(['lecture-partielle'])
      expect(etat.prealables[0].message).toMatch(motif)
      expect(etat.numerotation).toBeNull()
    }
  })
})

// LA CAISSE (ligne 26.6, étape C3b ; lib/controlesDeLaCaisse.ts) : ses écritures numérotées avec les autres, au journal de leur
// genre ; trois préalables bloquants — une opération à reprendre, une caisse négative, une recette à revoir — et les recettes
// de caisse dans `exclusions-2035`, sous une phrase qui les nomme. La caisse absente (le drapeau baissé) ne change rien, et
// pas encore revenue ou lue en partie, la validation se suspend. Des jeux FICTIFS.
describe('prealablesDeValidation — la caisse (étape C3b)', () => {
  const IDS_DE_LA_CAISSE = ['caisse-a-reprendre', 'caisse-negative', 'recettes-de-caisse-a-revoir']
  const idsDeLaCaisse = (d: DonneesDeValidation) => ids(d).filter((id) => IDS_DE_LA_CAISSE.includes(id))

  it('lue, à jour : aucun préalable de plus, et ses écritures dans la numérotation que la validation figera', () => {
    const d = donnees({ ecritures: [E1, E2, ...lignesDeLaCaisse(APPORT), ...lignesDeLaCaisse(PRELEVEMENT)], operationsDeCaisse: caisseLue([APPORT, PRELEVEMENT]) })
    const etat = prealablesDeValidation(d)
    expect(etat.prealables).toEqual([])
    expect(etat.numerotation!.horsFec).toEqual([])
    expect(etat.numerotation!.lignes.filter((l) => l.ecriture.operation_caisse_id).map((l) => [l.ecriture.id, l.journal, l.numero, l.pieceRef]))
      .toEqual([
        ['a1-0', 'OD', 1, 'Caisse du 02/03/2025'], ['a1-1', 'OD', 1, 'Caisse du 02/03/2025'],
        ['p1-1', 'OD', 2, 'Caisse du 05/03/2025'], ['p1-0', 'OD', 2, 'Caisse du 05/03/2025'],
      ])
  })

  it('pas encore revenue, ou lue en partie : la validation se suspend', () => {
    const etat = prealablesDeValidation(donnees({ operationsDeCaisse: null }))
    expect(etat.prealables.map((p) => [p.id, p.bloquant])).toEqual([['lecture-partielle', true]])
    expect(etat.prealables[0].message).toContain('la caisse du dossier n’est pas lue en entier')
    expect(etat.numerotation).toBeNull()
  })

  it('NEUTRE : la caisse absente ne dit rien de plus — mais une ligne de caisse que rien ne lit ne se numérote pas', () => {
    expect(ids(donnees())).toEqual([])
    expect(ids(donnees({ operationsDeCaisse: caisseLue([]) }))).toEqual([])
    expect(ids(donnees({ ecritures: [E1, E2, ...lignesDeLaCaisse(APPORT)] }))).toEqual(['ecritures-orphelines'])
  })

  it('caisse-a-reprendre : l’écriture manque, ou ne suit plus — dans l’exercice seulement', () => {
    const p = prealable(donnees({ ecritures: [E1, E2, ...lignesDeLaCaisse(APPORT)], operationsDeCaisse: caisseLue([APPORT, PRELEVEMENT]) }), 'caisse-a-reprendre')!
    expect([p.nb, p.bloquant, p.cible]).toEqual([1, true, 'caisse'])
    expect(p.message).toContain('retirer l\'opération et la saisir de nouveau avant la validation')
    expect(p.detail!.replace(/[\u00a0\u202f]/g, ' ')).toBe('le 05/03/2025, prélèvement de 30,00 € (écriture absente).')
    const decalee = lignesDeLaCaisse(APPORT).map((e) => ({ ...e, compte: e.compte === PLAN_PAR_DEFAUT.caisse ? '531000' : e.compte }))
    expect(prealable(donnees({ ecritures: [E1, E2, ...decalee], operationsDeCaisse: caisseLue([APPORT]) }), 'caisse-a-reprendre')!.nb).toBe(1)
    // Une opération de l'exercice suivant ne retient pas celui-ci.
    const plusTard = operationDeCaisse({ id: 'a9', date: '2026-01-15' })
    expect(idsDeLaCaisse(donnees({ operationsDeCaisse: caisseLue([plusTard]) }))).toEqual([])
  })

  it('caisse-negative : défensif, le jour et le solde sous les mots de la base', () => {
    const P80 = { ...PRELEVEMENT, montant: 80 }
    const p = prealable(donnees({ ecritures: [E1, E2, ...lignesDeLaCaisse(APPORT), ...lignesDeLaCaisse(P80)], operationsDeCaisse: caisseLue([APPORT, P80]) }), 'caisse-negative')!
    expect([p.nb, p.bloquant, p.cible]).toEqual([null, true, 'caisse'])
    expect(p.message.replace(/[\u00a0\u202f]/g, ' ')).toBe('La caisse est négative le 05/03/2025 (−30,00 €) : son solde est débiteur ou nul. Saisir les recettes '
      + 'en espèces qui manquent, ou retirer la sortie d\'espèces qui la vide, avant la validation.')
    // Négative l'exercice suivant seulement : celui-ci n'est pas retenu.
    const P26 = { ...P80, date: '2026-02-01' }
    expect(idsDeLaCaisse(donnees({ ecritures: [E1, E2, ...lignesDeLaCaisse(APPORT), ...lignesDeLaCaisse(P26)], operationsDeCaisse: caisseLue([APPORT, P26]) }))).toEqual([])
  })

  it('recettes-de-caisse-a-revoir : l’ensemble reconnu de son jour n’est plus celui de la caisse (CAISSE-Q2)', () => {
    const R = operationDeCaisse({ id: 'r1', genre: 'recette', date: '2025-03-12', montant: 120, categorie_id: HONORAIRES_CAISSE.id, encaissements_du_jour: ['e-perdu'] })
    const d = donnees({ categories: [ACHATS, HONORAIRES_CAISSE], ecritures: [E1, E2, ...lignesDeLaCaisse(R)], operationsDeCaisse: caisseLue([R]) })
    const p = prealable(d, 'recettes-de-caisse-a-revoir')!
    expect([p.nb, p.bloquant]).toEqual([1, true])
    expect(p.detail!.replace(/[\u00a0\u202f]/g, ' ')).toBe('le 12/03/2025, recette de 120,00 € (sans numéro).')
    expect(idsDeLaCaisse(donnees({
      categories: [ACHATS, HONORAIRES_CAISSE], ecritures: [E1, E2, ...lignesDeLaCaisse({ ...R, encaissements_du_jour: [] })],
      operationsDeCaisse: caisseLue([{ ...R, encaissements_du_jour: [] }]),
    }))).toEqual([])
  })

  it('exclusions-2035 : la phrase d’hier sans recette de caisse exclue ; nommée, et comptée, avec', () => {
    const base = donnees()
    const sans = prealable({ ...base, declaration: { ...base.declaration!, exclusions: { ...base.declaration!.exclusions, sansMontant: [P1] } } }, 'exclusions-2035')!
    expect(sans.message).toBe("pièce(s) ou mouvement(s) que la 2035 ne compte pas (sans poste, sans montant, un compte sorti des comptes de résultat, ou les frais d'un mouvement d'encaissements sans poste) : les compléter avant la validation.")
    expect('detail' in sans).toBe(false)
    const recette = recetteDeCaisse({ id: 'r1', date: '2025-03-12', montant: 120, categorie_id: 'k-inconnue', taux_tva: null }, [], false)
    const avec = prealable({
      ...base,
      declaration: { ...base.declaration!, exclusions: { ...base.declaration!.exclusions, recettesDeCaisseSansProduit: [recette], recettesDeCaisseSansPoste: [recette] } },
    }, 'exclusions-2035')!
    expect(avec.nb).toBe(2)
    expect(avec.message).toContain('ou une recette de caisse dont la catégorie n\'a pas de poste ou n\'est plus un produit')
    expect(avec.detail).toBe('Dont 2 recettes de caisse : la carte « Recettes de caisse absentes du récapitulatif » ci-dessus les nomme.')
  })
})

// LE PAIEMENT D'UNE PIÈCE PAR LA CAISSE (ligne 26.6, étape C9a), le drapeau joué dans ses deux états. Baissé (la valeur du
// module), la validation ne lit aucun paiement par la caisse — tous les cas plus haut ; levé, elle les tire des opérations
// qu'elle reçoit, et une pièce compte à la date de ses espèces, pour l'ordre des exercices comme pour les montants payés.
const drapeauDuPaiement = vi.hoisted(() => ({ leve: null as boolean | null }))
vi.mock('./paiementParLaCaisse', async (original) => {
  const module = await original<typeof import('./paiementParLaCaisse')>()
  return {
    ...module,
    // Le drapeau lui-même aussi (étape C9b) : `caisse-a-reprendre` le lit pour juger la contrepartie d'un paiement.
    get PAIEMENT_PAR_LA_CAISSE_EXPORTE() { return drapeauDuPaiement.leve ?? module.PAIEMENT_PAR_LA_CAISSE_EXPORTE },
    paiementsParLaCaisse: (operations: Parameters<typeof module.paiementsParLaCaisse>[0]) =>
      module.paiementsParLaCaisseSelon(drapeauDuPaiement.leve ?? module.PAIEMENT_PAR_LA_CAISSE_EXPORTE, operations),
  }
})

describe('prealablesDeValidation — les paiements par la caisse (étape C9a)', () => {
  afterEach(() => { drapeauDuPaiement.leve = null })
  const P2 = piece('p2', { date_piece: '2024-12-20', montant_ttc: 80 })
  const ESPECES = operationDeCaisse({ id: 'oc-p2', genre: 'paiement', piece_id: 'p2', date: '2025-01-05', montant: -80 })

  it('l’ordre des exercices : une pièce de décembre payée en espèces en janvier fait de janvier l’exercice qui la porte', () => {
    const d = donnees({ piecesValidees: [P1, P2], operationsDeCaisse: caisseLue([ESPECES]) })
    expect(prochainExerciceAValider(d)).toBe(2024)
    drapeauDuPaiement.leve = true
    expect(prochainExerciceAValider(d)).toBe(2025)
    // Une caisse pas encore revenue (nulle) n'en rend aucun : la validation se suspend déjà sur elle.
    expect(prochainExerciceAValider(donnees({ piecesValidees: [P1, P2], operationsDeCaisse: null }))).toBe(2024)
  })

  // Étape C9b : la contrepartie d'un paiement par la caisse qui manque à une pièce écrite retient la validation, sous
  // `caisse-a-reprendre`, son remède dit — « Régénérer » ; le drapeau baissé, rien, et le message d'hier.
  it('caisse-a-reprendre : le paiement d’une pièce écrite sans sa contrepartie retient la validation', () => {
    const APPORT_2025 = operationDeCaisse({ id: 'oc-ap', genre: 'apport', date: '2025-01-02', montant: 500 })
    const paye = operationDeCaisse({ id: 'oc-p1', genre: 'paiement', piece_id: 'p1', date: '2025-03-12', montant: -120 })
    const d = donnees({ operationsDeCaisse: caisseLue([APPORT_2025, paye]), ecritures: [E1, ...lignesDeLaCaisse(APPORT_2025)] })
    drapeauDuPaiement.leve = false
    expect(prealable(d, 'caisse-a-reprendre')).toBeUndefined()
    drapeauDuPaiement.leve = true
    const p = prealable(d, 'caisse-a-reprendre')!
    expect([p.nb, p.bloquant, p.cible]).toEqual([1, true, 'caisse'])
    expect(p.detail).toMatch(/contrepartie absente des écritures de sa pièce : les régénérer/)
    expect(p.message).toMatch(/pour le paiement d'une pièce, régénérer les écritures de la pièce\.$/)
    // Sa contrepartie écrite au compte de la caisse : plus rien à reprendre.
    const contrepartie = ecriture('k1', { compte: PLAN_PAR_DEFAUT.caisse, sens: 'credit', operation_caisse_id: 'oc-p1' })
    expect(prealable(donnees({ ...d, ecritures: [E1, contrepartie, ...lignesDeLaCaisse(APPORT_2025)] }), 'caisse-a-reprendre')).toBeUndefined()
  })

  // Étape C9b : l'ensemble du jour d'une recette compte le paiement par la caisse d'une pièce de VENTE de son jour — la
  // validation passe les pièces de vente à la caisse, sans quoi la recette qui l'a reconnu paraîtrait à revoir.
  it('recettes-de-caisse-a-revoir : la recette qui a reconnu le paiement d’une pièce de vente de son jour n’est pas à revoir', () => {
    const VENTE = piece('pv', { type_piece: 'vente', date_piece: '2025-03-12', montant_ttc: 30 })
    const encaisse = operationDeCaisse({ id: 'oc-pv', genre: 'paiement', piece_id: 'pv', date: '2025-03-12', montant: 30 })
    const recette = operationDeCaisse({ id: 'oc-r', genre: 'recette', date: '2025-03-12', montant: 40, categorie_id: HONORAIRES_CAISSE.id, encaissements_du_jour: ['oc-pv'] })
    const d = donnees({
      piecesValidees: [P1, VENTE], categories: [ACHATS, HONORAIRES_CAISSE], operationsDeCaisse: caisseLue([recette, encaisse]),
      ecritures: [E1, E2, ...lignesDeLaCaisse(recette)],
    })
    expect(prealable(d, 'recettes-de-caisse-a-revoir')).toBeUndefined()
    // Sans la pièce de vente dans les piles, l'ensemble du jour ne la compte pas : la recette paraît à revoir.
    expect(prealable(donnees({ ...d, piecesValidees: [P1] }), 'recettes-de-caisse-a-revoir')?.nb).toBe(1)
  })

  it('payée en trop : le relevé et la caisse s’additionnent', () => {
    const ENTROP = operationDeCaisse({ id: 'oc-p1', genre: 'paiement', piece_id: 'p1', date: '2025-03-20', montant: -50 })
    const d = donnees({ operationsDeCaisse: caisseLue([ENTROP]) })
    expect(ids(d)).not.toContain('pieces-payees-en-trop')
    drapeauDuPaiement.leve = true
    expect(prealable(d, 'pieces-payees-en-trop')?.nb).toBe(1)
  })
})
