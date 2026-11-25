import { describe, expect, it } from 'vitest'
import { ECRITURES_LIBRES_ABSENTES } from './ecrituresLibresDesExports'
import { ECRITURES_LIBRES_PREVUES, refusDeLEcritureLibre } from './ecritureLibre'
import type { PieceACiter } from './justificatifsDeLInventaire'
import {
  ligneDeLaPieceCitee, optionDeLaPieceCitee, optionDeLaPieceDUneEcritureLibre, optionsDesPiecesDUneEcritureLibre,
  piecesCitablesParUneEcritureLibre, piecesCiteesParDesEcrituresLibres,
  centimesDuMontant, confirmationDeLEcriture, confirmationDuRetrait, ecritureLibreDeLaLigne, ecrituresLibresPourLesMoteurs,
  effetSurLa2035, equilibreDeLaSaisie, formulaireDeLEcriture, formulaireVide, motifDesEcrituresLibres, saisieDuFormulaire,
  simulationTaitLesEcrituresLibres, type FormulaireDEcritureLibre,
} from './ecrituresLibresVue'

const formulaire = (o: Partial<FormulaireDEcritureLibre> = {}): FormulaireDEcritureLibre => ({
  ...formulaireVide('2025-06-30'), libelle: 'Part privée du téléphone', motif: 'Usage mixte, 30 %',
  lignes: [
    { compte: '108', sens: 'debit', montant: '120', poste: '', compteLib: '' },
    { compte: '6262', sens: 'credit', montant: '120,00', poste: 'Fournitures de bureau', compteLib: '' },
  ],
  ...o,
})
const CONTEXTE = { mode: 'tresorerie' as const, frontiere: null, ouverture: null, aujourdhui: '2025-11-22' }

describe('la saisie telle qu’elle part (EL5)', () => {
  it('les comptes lus comme l’application les lit, les montants au centime, le poste vide hors de la 2035', () => {
    const s = saisieDuFormulaire(formulaire())
    expect(s.lignes.map((l) => [l.compte, l.centimes, l.poste2035])).toEqual([['108000', 12000, null], ['626200', 12000, 'Fournitures de bureau']])
    expect(refusDeLEcritureLibre(s, CONTEXTE)).toEqual([])
    expect(equilibreDeLaSaisie(s)).toEqual({ debit: 12000, credit: 12000, ecart: 0, lisible: true })
  })

  it('un montant qui n’est pas au centime ne s’arrondit pas : le module le refuse', () => {
    expect(centimesDuMontant('12,345')).toBeNaN()
    expect(centimesDuMontant('-3')).toBeNaN()
    expect(centimesDuMontant('1 200,5')).toBe(120050)
    const s = saisieDuFormulaire(formulaire({ lignes: [{ compte: '108', sens: 'debit', montant: '12,345', poste: '', compteLib: '' }, formulaire().lignes[1]] }))
    expect(refusDeLEcritureLibre(s, CONTEXTE).map((r) => r.cle)).toContain('montant')
  })

  it('l’effet sur la 2035 : compté sous son poste, l’écart déclaré à part ; rien en engagement', () => {
    const s = saisieDuFormulaire(formulaire())
    expect(effetSurLa2035(s, 'tresorerie')).toEqual({ depensesComptees: -12000, recettesComptees: 0, depensesHors: 0, recettesHors: 0 })
    expect(effetSurLa2035(s, 'engagement').depensesComptees).toBe(0)
  })

  it('la confirmation nomme chaque ligne, les totaux et l’effet sur la 2035 ; un remplacement dit la version perdue', () => {
    const texte = confirmationDeLEcriture(formulaire(), 'tresorerie', ['Un avertissement'], 'Aucune pièce citée.')
    expect(texte).toContain('108000')
    expect(texte).toContain('626200')
    expect(texte).toContain('2035 : Fournitures de bureau')
    expect(texte).toContain('Total : débit')
    expect(texte).toContain('Effet sur la 2035')
    expect(texte).toContain('Attention : Un avertissement')
    expect(confirmationDeLEcriture(formulaire({ id: 'e1', versionLue: 3 }), 'tresorerie', [], 'Aucune pièce citée.')).toContain('version 3')
  })
})

describe('la lecture relue et passée aux moteurs (EL5)', () => {
  const brute = {
    id: 'e1', dossier_id: 'd1', exercice: 2025, numero: 2, date: '2025-12-31', libelle: 'Charge à payer', motif: 'Facture de janvier',
    lignes: [{ compte: '606100', sens: 'debit', centimes: 5000, poste_2035: null, compte_lib: null }, { compte: '408000', sens: 'credit', centimes: 5000, poste_2035: null, compte_lib: null }],
    avec_extourne: true, piece_citee_id: null, version: 2, cree_par: 'u1', cree_le: '2026-01-05T09:00:00Z', modifie_par: 'u2', modifie_le: '2026-01-06T09:00:00Z',
  }

  it('une ligne de la base se relit ; d’une autre forme, ou d’un autre dossier, elle ne se relit pas', () => {
    const e = ecritureLibreDeLaLigne(brute, 'd1')
    expect(e?.lignes).toHaveLength(2)
    expect(ecritureLibreDeLaLigne(brute, 'd2')).toBeNull()
    expect(ecritureLibreDeLaLigne({ ...brute, exercice: 2024 }, 'd1')).toBeNull()
    expect(ecritureLibreDeLaLigne({ ...brute, lignes: [brute.lignes[0]] }, 'd1')).toBeNull()
    expect(ecritureLibreDeLaLigne({ ...brute, lignes: [{ ...brute.lignes[0], sens: 'autre' }, brute.lignes[1]] }, 'd1')).toBeNull()
    expect(formulaireDeLEcriture(e!)).toMatchObject({ id: 'e1', versionLue: 2, avecExtourne: true })
    expect(confirmationDuRetrait(e!)).toContain('EL2025-0002')
  })

  // Le défaut suit le drapeau, qui suit la migration rangée dans l'export (ecritureLibre.test.ts) : le test le joue dans
  // l'état du dépôt, sans supposer la migration préparée ou rangée.
  it('le drapeau baissé : l’absence, avant même que la lecture revienne ; le défaut est l’état du dépôt', () => {
    expect(ecrituresLibresPourLesMoteurs(null, 'd1', false)).toBe(ECRITURES_LIBRES_ABSENTES)
    expect(ecrituresLibresPourLesMoteurs(null, 'd1')).toBe(ecrituresLibresPourLesMoteurs(null, 'd1', ECRITURES_LIBRES_PREVUES))
    expect(ecrituresLibresPourLesMoteurs(null, 'd1')).toBe(ECRITURES_LIBRES_PREVUES ? null : ECRITURES_LIBRES_ABSENTES)
  })

  it('levé : rien tant que la lecture n’est pas revenue pour CE dossier, ni quand elle est illisible', () => {
    expect(ecrituresLibresPourLesMoteurs(null, 'd1', true)).toBeNull()
    expect(ecrituresLibresPourLesMoteurs({ dossierId: 'd2', etat: 'absentes' }, 'd1', true)).toBeNull()
    expect(ecrituresLibresPourLesMoteurs({ dossierId: 'd1', etat: 'illisibles', motif: 'refusée' }, 'd1', true)).toBeNull()
    expect(motifDesEcrituresLibres({ dossierId: 'd1', etat: 'illisibles', motif: 'refusée' })).toContain('refusée')
    expect(motifDesEcrituresLibres(null)).toBeNull()
  })

  it('« Ma simulation » le dit le drapeau levé, en trésorerie seulement (EL5-Q1) ; le défaut est l’état du dépôt', () => {
    expect(simulationTaitLesEcrituresLibres('tresorerie', false)).toBe(false)
    expect(simulationTaitLesEcrituresLibres('tresorerie', true)).toBe(true)
    expect(simulationTaitLesEcrituresLibres('engagement', true)).toBe(false)
    expect(simulationTaitLesEcrituresLibres('tresorerie')).toBe(ECRITURES_LIBRES_PREVUES)
    expect(simulationTaitLesEcrituresLibres('engagement')).toBe(false)
  })
})

describe('la pièce citée, facultative (EL-Q8 (A)), toute pièce du dossier (ELQ8-Q1 (B))', () => {
  const piece = (o: Partial<PieceACiter> = {}): PieceACiter => ({
    id: 'p1', dossier_id: 'd1', nom_fichier: 'facture-secrete.pdf', date_piece: '2025-06-12', tiers: 'Papeterie fictive',
    montant_ttc: 42.5, type_piece: 'achat', statut: 'validee', ...o,
  })
  const PIECES = [
    piece(),
    piece({ id: 'p2', date_piece: '2025-09-01', tiers: 'Énergie fictive', montant_ttc: 120 }),
    piece({ id: 'p3', date_piece: null, tiers: null, montant_ttc: null, type_piece: 'vente' }),
    piece({ id: 'p4', statut: 'a_valider' }),
    piece({ id: 'p5', dossier_id: 'd2' }),
  ]

  // ELQ8-Q1 (B), tranchée par le cabinet le 25/11/2026 : « toutes les pièces du dossier, « à valider » comprises, comme
  // l'inventaire » — ce que la base accepte (`enregistrer_ecriture_libre` : une pièce de ce dossier, quel que soit son statut).
  it('propose toutes les pièces de CE dossier, « à valider » comprises, la plus récente d’abord, une pièce sans date à la fin', () => {
    expect(piecesCitablesParUneEcritureLibre(PIECES, 'd1').map((p) => p.id)).toEqual(['p2', 'p1', 'p4', 'p3'])
    expect(piecesCitablesParUneEcritureLibre(PIECES, 'd2').map((p) => p.id)).toEqual(['p5'])
  })

  it('une pièce « à valider » se dit telle dans son option ; une validée, non', () => {
    expect(optionDeLaPieceDUneEcritureLibre(piece({ id: 'p4', statut: 'a_valider' })).detail).toMatch(/^42,50\s€ TTC · Dépense · à valider$/)
    expect(optionDeLaPieceDUneEcritureLibre(piece()).detail).not.toContain('à valider')
  })

  it('les pièces que des écritures libres citent, quel que soit leur statut, parmi celles lues', () => {
    const libres = [{ piece_citee_id: 'p4' }, { piece_citee_id: null }, { piece_citee_id: 'p1' }, { piece_citee_id: 'absente' }]
    expect(piecesCiteesParDesEcrituresLibres(PIECES, libres).map((p) => p.id)).toEqual(['p1', 'p4'])
    expect(piecesCiteesParDesEcrituresLibres(PIECES, [])).toEqual([])
  })

  it('désigne une pièce par sa date, son tiers et son montant, jamais par le nom de son fichier', () => {
    const o = optionDeLaPieceDUneEcritureLibre(piece())
    expect(o.titre).toBe('12/06/2025 — Papeterie fictive')
    expect(o.detail).toMatch(/^42,50\s€ TTC · Dépense$/)
    expect(o.fichier).toBe(false)
    expect(JSON.stringify(o)).not.toContain('facture-secrete')
    const sansRien = optionDeLaPieceDUneEcritureLibre(piece({ date_piece: null, tiers: '  ', montant_ttc: null, type_piece: 'vente' }))
    expect(sansRien.titre).toBe('Sans date — tiers non lu')
    expect(sansRien.detail).toBe('montant non lu · Recette')
    expect(optionsDesPiecesDUneEcritureLibre(PIECES, 'd1').map((x) => x.citation.id)).toEqual(['p2', 'p1', 'p4', 'p3'])
  })

  it('retrouve la pièce citée parmi les citables ; ni lue en entier, ni retrouvée, elle ne se devine pas', () => {
    expect(optionDeLaPieceCitee(null, PIECES, 'd1')).toBeNull()
    expect(optionDeLaPieceCitee('p1', null, 'd1')).toBeNull()
    expect(optionDeLaPieceCitee('p4', PIECES, 'd1')?.detail).toMatch(/· à valider$/)
    expect(optionDeLaPieceCitee('p5', PIECES, 'd1')).toBeNull()
    expect(optionDeLaPieceCitee('p1', PIECES, 'd1')?.titre).toBe('12/06/2025 — Papeterie fictive')
  })

  it('la ligne de la liste et de la confirmation dit chacun des quatre cas', () => {
    expect(ligneDeLaPieceCitee(null, PIECES, 'd1')).toBe('Aucune pièce citée : l’état des écritures libres en tient lieu.')
    expect(ligneDeLaPieceCitee('p1', null, 'd1')).toMatch(/déjà citée \(les pièces du dossier ne sont pas lues en entier\)/)
    expect(ligneDeLaPieceCitee('p5', PIECES, 'd1')).toBe('Pièce citée : une pièce du dossier qui n’est pas parmi ses pièces lues.')
    expect(ligneDeLaPieceCitee('p4', PIECES, 'd1')).toMatch(/^Pièce citée : 12\/06\/2025 — Papeterie fictive \(42,50\s€ TTC · Dépense · à valider\)\.$/)
    expect(ligneDeLaPieceCitee('p1', PIECES, 'd1')).toMatch(/^Pièce citée : 12\/06\/2025 — Papeterie fictive \(42,50\s€ TTC · Dépense\)\.$/)
  })

  it('la confirmation porte la ligne de la pièce citée', () => {
    const ligne = ligneDeLaPieceCitee('p1', PIECES, 'd1')
    expect(confirmationDeLEcriture(formulaire({ pieceCiteeId: 'p1' }), 'tresorerie', [], ligne).split('\n')).toContain(ligne)
  })
})
