import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  POINTS_DE_LA_CHECKLIST_ECARTES, prealablesDeValidation, prochainExerciceAValider, type DonneesDeValidation,
} from './prealablesValidation'
import { calculerDeclaration2035 } from './declaration2035'
import { concordance2035 } from './concordance2035'
import { paiementsDesPieces } from './rattachement'
import { lignesPourPiece } from './ecritures'
import type { ModeleComptable } from './engagement'
import { COMPTE_BANQUE } from './comptes'
import type { Emprunt } from './emprunts'
import type {
  ANouveau, Categorie, ControleReleveBancaire, CotisationDeclaree, EcritureBrouillon, Immobilisation, LigneBancaire,
  NatureImmobilisation, Piece, ReglementGroupe, VehiculeDossier, VentilationBancaire,
} from './types'
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
  sous_dossier_id: null, type_piece: 'achat', statut: 'validee', notes: null, confiance: null, superpdp_invoice_id: null,
  created_at: '2025-03-10T09:00:00Z', updated_at: '2025-03-10T09:00:00Z', ...o,
})

const ligne = (id: string, o: Partial<LigneBancaire> = {}): LigneBancaire => ({
  id, dossier_id: 'd1', date: '2025-03-12', libelle: 'PRLV FOURNISSEUR', montant: -120, statut: 'rapprochee',
  piece_id: null, cotisation_id: null, categorie_id: null, taux_tva: null, prelevement_personnel: false,
  emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false, reglement_groupe: false,
  id_externe: null, source_fichier: 'releve-2025.pdf', libelle_brut: null, created_at: '2025-04-01T09:00:00Z', ...o,
})

const ecriture = (id: string, o: Partial<EcritureBrouillon> = {}): EcritureBrouillon => ({
  id, dossier_id: 'd1', piece_id: 'p1', ligne_bancaire_id: null, date: '2025-03-12', compte: '606100', libelle: 'Fournisseur',
  montant: 120, sens: 'debit', statut: 'proposee', immobilisation_id: null, vehicule_id: null, ...NON_VALIDEE,
  created_at: '2025-04-01T09:00:00Z', ...o,
})

const aNouveau = (date: string): ANouveau => ({
  id: 'an1', dossier_id: 'd1', date, compte: COMPTE_BANQUE, compte_origine: '512', libelle: 'Banque', sens: 'debit', montant: 1000,
  source_nom: 'balance.csv', source_empreinte: 'a'.repeat(64), ...A_NOUVEAU_NON_VALIDE, created_at: '2025-02-01T00:00:00Z',
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
    vehicules: [], emprunts: [], aNouveaux: [], relevesIncoherents: [], doublonsTexte: [], ...o,
  }
  if (base.modele.mode === 'engagement') return { ...base, declaration: null, concordance: null }
  const paiements = paiementsDesPieces(base.lignes, base.reglements)
  const declaration = calculerDeclaration2035(
    base.annee, [...base.piecesValidees], [...base.categories], [...base.immobilisations], [], [...base.vehicules],
    base.assujettiTva, paiements, [],
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
    const etat = prealablesDeValidation(donnees({ aNouveaux: [aNouveau('2025-01-01')] }))
    expect(etat.prealables).toEqual([])
    expect(etat.numerotation!.aNouveaux.map((a) => a.aNouveau.id)).toEqual(['an1'])
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
      .filter((id) => !['doublons-inconnus', 'releves-inconnus', 'releve-incoherent', 'echeances-emprunt-non-rapprochees', 'ecritures-a-generer'].includes(id))
    expect(repris.length).toBeGreaterThanOrEqual(20)
    expect(repris.filter((id) => !cas.some(([c]) => c === id))).toEqual([])
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
