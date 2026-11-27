import { describe, expect, it } from 'vitest'
import {
  achatsDesAccesLus, PHRASE_JUSTIFICATIF_NON_RELU, PHRASE_MODELE_INCONNU, PHRASE_NOTE_D_UN_SALARIE_ENGAGEMENT,
  PHRASE_NOTE_D_UN_SALARIE_TRESORERIE, PHRASE_NOTE_DE_L_EXPLOITANT_ENGAGEMENT, PHRASE_NOTE_DE_L_EXPLOITANT_TRESORERIE,
  PHRASE_POUR_QUI_INCONNU, PHRASE_PROPOSE_EXPLOITANT, PHRASE_PROPOSE_SALARIE, pourQuiEstLaNote, rangementDuJustificatif,
  seJugeLeJustificatif, suiteDuRemboursement, typeAttenduDuJustificatif,
  detailDesJustificatifsARanger, justificatifsARanger, NOTES_DE_FRAIS_SANS_OBJET, type NotesDeFraisDesControles,
} from './notesDeFraisEnComptabilite'
import { estNoteDeLExploitant } from './noteDeFraisEnTresorerie'
import { ETATS_DES_NOTES } from './notesDeFrais'
import type { NoteDeFrais } from './notesDeFraisVue'

// Lot L3 (conception 58, § 2.1) : la note de l'exploitant en « Note de frais » (à sa date, face au compte de l'exploitant), celle
// d'un salarié en « Achat » (à son remboursement) ; pour qui : certain pour un salarié nommé, proposé d'après la case « Achats »
// de l'auteur sinon ; rien ne se propose sur des accès non relus.

type N = Pick<NoteDeFrais, 'auteur' | 'beneficiaire_salarie' | 'etat' | 'piece_id'>
const note = (n: Partial<N>): N => ({ auteur: 'u1', beneficiaire_salarie: null, etat: 'approuvee', piece_id: 'p1', ...n })
const achats = new Map([['u1', true], ['u2', false]])

describe('pour qui est la note', () => {
  it('un salarié nommé, sans doute ; pour soi, d’après la case « Achats » ; sinon rien', () => {
    expect(pourQuiEstLaNote(note({ beneficiaire_salarie: 'Salarié fictif' }), null)).toEqual({ pourQui: 'salarie', certain: true })
    expect(pourQuiEstLaNote(note({ beneficiaire_salarie: 'Salarié fictif', auteur: 'u1' }), achats)).toEqual({ pourQui: 'salarie', certain: true })
    expect(pourQuiEstLaNote(note({ auteur: 'u1' }), achats)).toEqual({ pourQui: 'exploitant', certain: false })
    expect(pourQuiEstLaNote(note({ auteur: 'u2' }), achats)).toEqual({ pourQui: 'salarie', certain: false })
    // L'auteur qui n'est plus un accès du dossier, ou des accès non relus : rien.
    expect(pourQuiEstLaNote(note({ auteur: 'u9' }), achats)).toBeNull()
    expect(pourQuiEstLaNote(note({ auteur: 'u1' }), null)).toBeNull()
  })

  it('les cases relues en entier seulement, et seul `true` accorde', () => {
    expect(achatsDesAccesLus({ complete: false, lignes: [{ user_id: 'u1', droit_achats: true }] })).toBeNull()
    const lues = achatsDesAccesLus({ complete: true, lignes: [{ user_id: 'u1', droit_achats: true }, { user_id: 'u2', droit_achats: null }] })
    expect(lues?.get('u1')).toBe(true)
    expect(lues?.get('u2')).toBe(false)
    expect(lues?.has('u3')).toBe(false)
  })
})

describe('le type attendu du justificatif', () => {
  it('l’exploitant en « Note de frais », le salarié en « Achat » en trésorerie, rien en engagement', () => {
    expect(typeAttenduDuJustificatif('exploitant', 'tresorerie')).toBe('note_frais')
    expect(typeAttenduDuJustificatif('exploitant', 'engagement')).toBe('note_frais')
    expect(typeAttenduDuJustificatif('salarie', 'tresorerie')).toBe('achat')
    expect(typeAttenduDuJustificatif('salarie', 'engagement')).toBeNull()
  })

  it('confronté à la règle de L1 : le type attendu de l’exploitant est la note qui ne justifie aucun mouvement, celui du salarié non', () => {
    expect(estNoteDeLExploitant({ type_piece: typeAttenduDuJustificatif('exploitant', 'tresorerie') ?? 'autre' }, 'tresorerie')).toBe(true)
    expect(estNoteDeLExploitant({ type_piece: typeAttenduDuJustificatif('salarie', 'tresorerie') ?? 'note_frais' }, 'tresorerie')).toBe(false)
  })
})

describe('le rangement du justificatif d’une note', () => {
  it('seules les notes approuvées ou remboursées qui citent une pièce se jugent', () => {
    const jugees = ETATS_DES_NOTES.filter((etat) => seJugeLeJustificatif({ etat, piece_id: 'p1' }))
    expect(jugees).toEqual(['approuvee', 'remboursee'])
    expect(seJugeLeJustificatif({ etat: 'approuvee', piece_id: null })).toBe(false)
    expect(rangementDuJustificatif(note({ etat: 'soumise' }), { type_piece: 'achat' }, achats, 'tresorerie')).toBeNull()
  })

  it('l’exploitant en trésorerie : bien rangé, rien à ranger ; rangé en « Achat », à reprendre', () => {
    expect(rangementDuJustificatif(note({}), { type_piece: 'note_frais' }, achats, 'tresorerie')).toEqual({
      pourQui: { pourQui: 'exploitant', certain: false }, attendu: 'note_frais', aRanger: false,
      phrases: [PHRASE_NOTE_DE_L_EXPLOITANT_TRESORERIE, PHRASE_PROPOSE_EXPLOITANT],
    })
    const mal = rangementDuJustificatif(note({ etat: 'remboursee' }), { type_piece: 'achat' }, achats, 'tresorerie')
    expect(mal?.aRanger).toBe(true)
    expect(mal?.phrases.at(-1)).toBe('Son justificatif est rangé en « Achat » : à reprendre dans sa fiche, en « Note de frais ».')
  })

  it('le salarié en trésorerie : en « Achat » ; en « Note de frais », à reprendre ; certain pour un salarié nommé', () => {
    const nomme = note({ beneficiaire_salarie: 'Salarié fictif' })
    expect(rangementDuJustificatif(nomme, { type_piece: 'achat' }, null, 'tresorerie')).toEqual({
      pourQui: { pourQui: 'salarie', certain: true }, attendu: 'achat', aRanger: false, phrases: [PHRASE_NOTE_D_UN_SALARIE_TRESORERIE],
    })
    expect(rangementDuJustificatif(nomme, { type_piece: 'note_frais' }, null, 'tresorerie')?.aRanger).toBe(true)
    expect(rangementDuJustificatif(note({ auteur: 'u2' }), { type_piece: 'autre' }, achats, 'tresorerie')).toEqual({
      pourQui: { pourQui: 'salarie', certain: false }, attendu: 'achat', aRanger: true,
      phrases: [PHRASE_NOTE_D_UN_SALARIE_TRESORERIE, PHRASE_PROPOSE_SALARIE,
        'Son justificatif est rangé en « Autre » : à reprendre dans sa fiche, en « Achat ».'],
    })
  })

  it('en engagement : l’exploitant en « Note de frais » ; le salarié sans type attendu, la « Note de frais » seule signalée', () => {
    expect(rangementDuJustificatif(note({}), { type_piece: 'note_frais' }, achats, 'engagement')?.phrases[0]).toBe(PHRASE_NOTE_DE_L_EXPLOITANT_ENGAGEMENT)
    const nomme = note({ beneficiaire_salarie: 'Salarié fictif' })
    expect(rangementDuJustificatif(nomme, { type_piece: 'achat' }, null, 'engagement')).toEqual({
      pourQui: { pourQui: 'salarie', certain: true }, attendu: null, aRanger: false, phrases: [PHRASE_NOTE_D_UN_SALARIE_ENGAGEMENT],
    })
    const enNote = rangementDuJustificatif(nomme, { type_piece: 'note_frais' }, null, 'engagement')
    expect(enNote?.aRanger).toBe(true)
    expect(enNote?.phrases.at(-1)).toBe('Son justificatif est rangé en « Note de frais » : à reprendre dans sa fiche.')
  })

  it('le modèle non relu, les accès non relus, le justificatif non relu : rien d’affirmé', () => {
    expect(rangementDuJustificatif(note({}), { type_piece: 'achat' }, achats, null)).toEqual({
      pourQui: { pourQui: 'exploitant', certain: false }, attendu: null, aRanger: false, phrases: [PHRASE_MODELE_INCONNU],
    })
    expect(rangementDuJustificatif(note({}), { type_piece: 'achat' }, null, 'tresorerie')).toEqual({
      pourQui: null, attendu: null, aRanger: false, phrases: [PHRASE_POUR_QUI_INCONNU],
    })
    const nonRelu = rangementDuJustificatif(note({}), null, achats, 'tresorerie')
    expect(nonRelu?.aRanger).toBe(false)
    expect(nonRelu?.phrases.at(-1)).toBe(PHRASE_JUSTIFICATIF_NON_RELU)
  })
})

describe('ce que la confirmation du remboursement ajoute', () => {
  it('en trésorerie seulement, et quand on sait pour qui', () => {
    expect(suiteDuRemboursement({ pourQui: 'exploitant', certain: false }, 'tresorerie')).toMatch(/virement personnel/)
    expect(suiteDuRemboursement({ pourQui: 'salarie', certain: true }, 'tresorerie')).toMatch(/se rapprochera du justificatif/)
    expect(suiteDuRemboursement({ pourQui: 'exploitant', certain: false }, 'engagement')).toBeNull()
    expect(suiteDuRemboursement(null, 'tresorerie')).toBeNull()
    expect(suiteDuRemboursement({ pourQui: 'salarie', certain: true }, null)).toBeNull()
  })
})

// L3-Q3 (A) : le justificatif à ranger, dit dans la Vue d'ensemble et avant la validation par le calcul de la section.
describe('les justificatifs à ranger, pour les contrôles', () => {
  const lues = (o: Partial<Extract<NotesDeFraisDesControles, { etat: 'lues' }>> = {}): NotesDeFraisDesControles => ({
    etat: 'lues',
    lesNotes: { complete: true, lignes: [
      { id: 'n1', ...note({ piece_id: 'p1' }) },
      { id: 'n2', ...note({ piece_id: 'p2', beneficiaire_salarie: 'Salarié fictif' }) },
      { id: 'n3', ...note({ piece_id: 'p3', etat: 'soumise' }) },
    ] },
    justificatifs: { complete: true, lignes: [
      { id: 'p1', nom_fichier: 'b.pdf', type_piece: 'achat' }, { id: 'p2', nom_fichier: 'a.pdf', type_piece: 'achat' },
      { id: 'p3', nom_fichier: 'c.pdf', type_piece: 'achat' },
    ] },
    acces: { complete: true, lignes: [{ user_id: 'u1', droit_achats: true }] },
    ...o,
  })

  it('nomme le justificatif d’une note de l’exploitant rangé en « Achat », comme la section, et pas celui d’un salarié', () => {
    expect(justificatifsARanger(lues(), 'tresorerie')).toEqual([
      { noteId: 'n1', pieceId: 'p1', nomFichier: 'b.pdf', range: 'achat', attendu: 'note_frais' },
    ])
    expect(detailDesJustificatifsARanger(justificatifsARanger(lues(), 'tresorerie'))).toBe('b.pdf : rangé en « Achat », attendu en « Note de frais »')
    expect(detailDesJustificatifsARanger([])).toBeUndefined()
  })

  it('muet sur une lecture partielle des notes ou de leurs justificatifs, et le drapeau baissé', () => {
    expect(justificatifsARanger(lues({ lesNotes: { complete: false, lignes: [] } }), 'tresorerie')).toEqual([])
    expect(justificatifsARanger(lues({ justificatifs: { complete: false, lignes: [] } }), 'tresorerie')).toEqual([])
    expect(justificatifsARanger(NOTES_DE_FRAIS_SANS_OBJET, 'tresorerie')).toEqual([])
    // Les accès lus en partie : rien ne se propose pour une note saisie pour soi, et le point non plus.
    expect(justificatifsARanger(lues({ acces: { complete: false, lignes: [] } }), 'tresorerie')).toEqual([])
  })
})
