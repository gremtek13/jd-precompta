import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  CARTES_DE_CLOTURE, POINTS_DE_LA_CHECKLIST_ECARTES, prealablesDeValidation, prochainExerciceAValider, type DonneesDeValidation,
} from './prealablesValidation'
import { calculerDeclaration2035 } from './declaration2035'
import { concordance2035 } from './concordance2035'
import { paiementsDesPieces } from './rattachement'
import { lignesPourPiece } from './ecritures'
import type { ModeleComptable } from './engagement'
import { COMPTE_BANQUE } from './comptes'
import type { Emprunt } from './emprunts'
import type {
  ANouveau, Categorie, ControleReleveBancaire, CotisationDeclaree, DeclarationTva, EcritureBrouillon, Immobilisation,
  LigneBancaire, NatureImmobilisation, Piece, ReglementGroupe, SoldeReporte, VehiculeDossier, VentilationBancaire,
} from './types'
import { demandeDeValidation } from './validationExercice'
import { A_NOUVEAU_NON_VALIDE, NON_VALIDEE } from '../test/ecritures'

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
  created_at: '2025-03-10T09:00:00Z', updated_at: '2025-03-10T09:00:00Z', ...o,
})

const ligne = (id: string, o: Partial<LigneBancaire> = {}): LigneBancaire => ({
  id, dossier_id: 'd1', date: '2025-03-12', libelle: 'PRLV FOURNISSEUR', montant: -120, statut: 'rapprochee',
  piece_id: null, cotisation_id: null, categorie_id: null, taux_tva: null, prelevement_personnel: false,
  emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false, reglement_groupe: false, compte_bilan: null, declaration_tva_id: null,
  id_externe: null, source_fichier: 'releve-2025.pdf', libelle_brut: null, created_at: '2025-04-01T09:00:00Z', ...o,
})

const ecriture = (id: string, o: Partial<EcritureBrouillon> = {}): EcritureBrouillon => ({
  id, dossier_id: 'd1', piece_id: 'p1', ligne_bancaire_id: null, date: '2025-03-12', compte: '606100', libelle: 'Fournisseur',
  montant: 120, sens: 'debit', statut: 'proposee', immobilisation_id: null, vehicule_id: null, declaration_tva_id: null, ...NON_VALIDEE,
  created_at: '2025-04-01T09:00:00Z', ...o,
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
  previsionnel: false, created_at: '2025-01-01T00:00:00Z',
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

const P1 = piece('p1')
const L1 = ligne('l1', { piece_id: 'p1' })
const E1 = ecriture('e1')
const E2 = ecriture('e2', { compte: COMPTE_BANQUE, sens: 'credit', ligne_bancaire_id: 'l1' })

type Surcharges = Partial<Omit<DonneesDeValidation, 'declaration' | 'concordance'>>

// Les données de validation de 2025, la 2035 et la concordance recalculées sur les données passées.
function donnees(o: Surcharges = {}): DonneesDeValidation {
  const base: Omit<DonneesDeValidation, 'declaration' | 'concordance'> = {
    annee: 2025, anneeCourante: 2026, modele: { mode: 'tresorerie', compteNotesDeFrais: '108000' }, assujettiTva: false,
    anneesValidees: [], lectureIncomplete: null, piecesValidees: [P1], piecesAValider: [], categories: [ACHATS],
    immobilisations: [], natures: [], ecritures: [E1, E2], lignes: [L1], ventilations: [], reglements: [], cotisations: [],
    vehicules: [], emprunts: [], aNouveaux: [], soldesReportes: [], declarationsTva: [], periodiciteTva: 'trimestrielle', relevesIncoherents: [],
    doublonsTexte: [], ...o,
  }
  if (base.modele.mode === 'engagement') return { ...base, declaration: null, concordance: null }
  const paiements = paiementsDesPieces(base.lignes, base.reglements)
  const declaration = calculerDeclaration2035(
    base.annee, [...base.piecesValidees], [...base.categories], [...base.immobilisations], [], [...base.vehicules],
    base.assujettiTva, paiements, [], base.declarationsTva,
  )
  const ouverture = base.aNouveaux.length > 0 ? base.aNouveaux[0].date : null
  const concordance = concordance2035(
    declaration, base.ecritures, { piecesValidees: new Set(base.piecesValidees.map((p) => p.id)), piecesImmobilisees: new Set() }, ouverture,
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
  const REPORTES = [
    reporte('s1', '2025-01-01', COMPTE_BANQUE, 'Banque', 'debit', 1000),
    reporte('s2', '2025-01-01', '101000', 'Capital individuel', 'credit', 1000),
    // Ceux qui ouvrent un autre exercice n'y entrent pas.
    reporte('s3', '2026-01-01', COMPTE_BANQUE, 'Banque', 'debit', 880),
  ]

  it('numérote les soldes reportés qui ouvrent l’exercice, et eux seuls, et les envoie à la base', () => {
    const etat = prealablesDeValidation(donnees({ anneesValidees: [2024], soldesReportes: REPORTES }))
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
    expect(ids(donnees({ aNouveaux: [aNouveau('2024-01-01')], anneesValidees: [2024] }))).toEqual([])
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
    const ancienne = ecriture('e0', { piece_id: null, ligne_bancaire_id: null, date: '2024-06-01', statut: 'validee' })
    expect(ids(donnees({ ecritures: [E1, E2, ancienne], anneesValidees: [2024] }))).toEqual([])
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
    const engagement: ModeleComptable = { mode: 'engagement', compteNotesDeFrais: '455000' }
    const facture = piece('p1', { date_piece: '2025-12-20', created_at: '2025-12-21T09:00:00Z' })
    const janvier = ligne('l-jan', { date: '2026-01-05', piece_id: 'p1' })
    // Telles que la génération les écrit ; la facture a été validée avec 2025, son règlement est de 2026.
    const ecrites = lignesPourPiece('d1', facture, { compte: '606100', immobilisation: false }, false,
      paiementsDesPieces([janvier], []).get('p1') ?? [], engagement)
      .map((l, i) => ecriture(`e${i}`, { ...l, ligne_bancaire_id: l.ligne_bancaire_id ?? null, statut: l.date <= '2025-12-31' ? 'validee' : 'proposee' }))
    expect(ecrites.map((e) => [e.date, e.compte, e.statut])).toEqual([
      ['2025-12-20', '606100', 'validee'], ['2025-12-20', '401000', 'validee'],
      ['2026-01-05', '401000', 'proposee'], ['2026-01-05', COMPTE_BANQUE, 'proposee'],
    ])
    // La catégorie est passée au 606300 depuis la validation : la facture validée reste sur l'ancien compte.
    const d = donnees({
      annee: 2026, anneeCourante: 2027, anneesValidees: [2025], modele: engagement, piecesValidees: [facture],
      categories: [{ ...ACHATS, compte_comptable: '606300' }], lignes: [janvier], ecritures: ecrites,
    })
    expect(ids(d)).toEqual([])
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
      modele: { mode: 'engagement', compteNotesDeFrais: '455000' }, piecesValidees: [decembre], lignes: [janvier], ecritures: [],
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
    const d = donnees({ annee: 2026, anneeCourante: 2027, anneesValidees: [2025], declarationsTva: [q4], piecesValidees: [], lignes: [janvier], ecritures: [] })
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
      modele: { mode: 'engagement', compteNotesDeFrais: '455000' },
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
      ].includes(id))
    expect(repris.length).toBeGreaterThanOrEqual(20)
    expect(repris.filter((id) => !cas.some(([c]) => c === id))).toEqual([])
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
    const engagement: ModeleComptable = { mode: 'engagement', compteNotesDeFrais: '455000' }
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
    const engagement: ModeleComptable = { mode: 'engagement', compteNotesDeFrais: '455000' }
    expect(ids(donnees({ ...registre, modele: engagement, vehicules: [vehicule('v1', 2025, 5000)] }))).not.toContain('vehicule-amorti-sous-bareme')
  })

  it('ne juge rien de la 2035 en engagement, qui n’en produit pas', () => {
    const presents = ids(donnees({
      modele: { mode: 'engagement', compteNotesDeFrais: '455000' },
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
  const checklist = readFileSync(new URL('../pages/dossier/ChecklistTab.tsx', import.meta.url), 'utf8')
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
})
