import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { motsDuCabinet } from './espaceVentes'
import { LIBELLE_MOTIF_REFUS_NOTE_DE_FRAIS, LIBELLE_MOTIF_REFUS_NOTE_DE_FRAIS_CLIENT } from './droitsAcces'
import { REFUS_DES_NOTES, refusDeLaSaisie } from './notesDeFrais'
import {
  confirmationDeLApprobation, confirmationDeLaSoumission, confirmationDuRefus, confirmationDuRemboursement, confirmationDuRetrait,
  cumulDesKilometres, etatDuJustificatif, formulaireDeLaNote, formulaireNeuf, gestesDeLaNote, justificatifsCitables,
  mesNotesDeFraisOuvertes, montantDesKilometres, notesAMontrer, parametresDeLEnregistrement, passagesDeLaNote,
  personneDiteAuClient, PRESENTATION_DE_MES_NOTES_DE_FRAIS, refusDeLaSoumission, refusDuMotifDeRefus, refusDuRemboursement,
  SANS_LA_CASE_FRAIS, saisieDuFormulaire, signalDeLaNote, signalDeLaTranche, type FormulaireDeNote, type NoteDeFrais,
  type PieceDeLAuteur,
} from './notesDeFraisVue'

// LES NOTES DE FRAIS À L'ÉCRAN (ligne 51.5, étape B8) : la règle et les mots, confrontés à la migration préparée (B7) — les
// paramètres de `enregistrer_note_de_frais`, ce qu'une note cite, ce qu'un profil peut en faire —, et les mots du client.

const PREPAREES = new URL('../../supabase/preparees/', import.meta.url)
const MIGRATION = readFileSync(new URL(readdirSync(PREPAREES).find((n) => /^\d{14}_notes_de_frais\.sql$/.test(n))!, PREPAREES), 'utf8')

const note = (n: Partial<NoteDeFrais>): NoteDeFrais => ({
  id: 'n1', dossier_id: 'd1', auteur: 'u1', beneficiaire_salarie: null, date_depense: '2026-11-02', nature: 'repas',
  motif: 'Déjeuner fictif', montant_ttc: 24.5, montant_tva: 2.23, distance_km: null, vehicule_type: null, puissance_fiscale: null,
  electrique: null, piece_id: 'p1', etat: 'brouillon', version: 1, cree_le: '2026-11-02T10:00:00Z', soumise_le: null,
  approuvee_le: null, refusee_le: null, motif_refus: null, remboursee_le: null, date_remboursement: null, moyen_remboursement: null,
  ...n,
})
const km = (n: Partial<NoteDeFrais>): NoteDeFrais => note({
  nature: 'kilometres', montant_ttc: 23.81, montant_tva: 0, piece_id: null, distance_km: 45, vehicule_type: 'voiture',
  puissance_fiscale: 3, electrique: false, ...n,
})
const piece = (p: Partial<PieceDeLAuteur>): PieceDeLAuteur => ({
  id: 'p1', dossier_id: 'd1', nom_fichier: 'ticket.pdf', statut: 'a_valider', uploaded_by: 'u1', date_piece: '2026-11-02',
  montant_ttc: 24.5, created_at: '2026-11-02T09:00:00Z', ...p,
})
const formulaire = (f: Partial<FormulaireDeNote>): FormulaireDeNote => ({ ...formulaireNeuf('2026-11-11'), ...f })

describe('« Mes notes de frais » et ses justificatifs', () => {
  it('l’écran n’existe qu’avec la migration et la case « Notes de frais »', () => {
    expect(mesNotesDeFraisOuvertes(true, true)).toBe(true)
    expect(mesNotesDeFraisOuvertes(false, true)).toBe(false)
    expect(mesNotesDeFraisOuvertes(true, false)).toBe(false)
  })

  it('un justificatif citable : déposé par l’auteur dans ce dossier, à valider, cité par aucune autre note (B7-Q2)', () => {
    const pieces = [
      piece({}), piece({ id: 'p2', uploaded_by: 'u2' }), piece({ id: 'p3', statut: 'validee' }), piece({ id: 'p4' }),
      piece({ id: 'p5', dossier_id: 'd2' }), piece({ id: 'p6', created_at: '2026-11-05T09:00:00Z' }),
    ]
    const notes = [note({ id: 'n1', piece_id: 'p1' }), note({ id: 'n2', piece_id: 'p4' })]
    expect(justificatifsCitables(pieces, notes, 'u1', 'd1', null).map((p) => p.id)).toEqual(['p6'])
    // La note qui le cite déjà le garde.
    expect(justificatifsCitables(pieces, notes, 'u1', 'd1', 'n1').map((p) => p.id)).toEqual(['p6', 'p1'])
  })

  it('l’état du justificatif donne à `refusDeLaSaisie` les refus de la base, dans son ordre', () => {
    const notes = [note({ id: 'n2', piece_id: 'p4' })]
    const pieces = [piece({}), piece({ id: 'p2', uploaded_by: 'u2' }), piece({ id: 'p3', statut: 'validee' }), piece({ id: 'p4' })]
    const refus = (pieceId: string) => refusDeLaSaisie(saisieDuFormulaire(formulaire({ nature: 'repas', motif: 'Déjeuner', ttc: '24,50', pieceId })), {
      aujourdHui: '2026-11-11', achats: false, justificatif: etatDuJustificatif(pieceId, pieces, notes, 'u1', 'd1', null),
    })
    expect(refus('p1')).toBeNull()
    expect(refus('p2')).toBe(REFUS_DES_NOTES.justificatifDeLAuteur)
    expect(refus('inconnue')).toBe(REFUS_DES_NOTES.justificatifDeLAuteur)
    expect(refus('p3')).toBe(REFUS_DES_NOTES.justificatifValide)
    expect(refus('p4')).toBe(REFUS_DES_NOTES.justificatifCite)
    expect(etatDuJustificatif(null, pieces, notes, 'u1', 'd1', null)).toBeNull()
  })
})

describe('le formulaire, tel qu’il part', () => {
  it('des kilomètres : le montant du barème de l’année, ni TVA ni justificatif, même saisis avant de changer de nature', () => {
    const f = formulaire({
      nature: 'kilometres', motif: 'Rendez-vous', date: '2026-11-02', distance: '45', vehicule: 'voiture', puissance: '3',
      electrique: 'non', ttc: '99', tva: '5', pieceId: 'p1',
    })
    expect(montantDesKilometres(f)).toBe(23.81)
    const s = saisieDuFormulaire(f)
    expect(s).toMatchObject({ montantTtc: 23.81, montantTva: null, pieceId: null, distanceKm: 45,
      vehicule: { type: 'voiture', puissanceFiscale: 3, electrique: false } })
    expect(refusDeLaSaisie(s, { aujourdHui: '2026-11-11', achats: false, justificatif: null })).toBeNull()
    // Sans barème pour l'année, rien ne se calcule à sa place.
    expect(montantDesKilometres({ ...f, date: '2019-03-01' })).toBeNull()
    expect(refusDeLaSaisie(saisieDuFormulaire({ ...f, date: '2019-03-01' }), { aujourdHui: '2026-11-11', achats: false, justificatif: null }))
      .toBe(REFUS_DES_NOTES.baremeAbsent(2019))
  })

  it('une dépense : ni distance ni véhicule, une TVA illisible refusée, jamais un zéro inventé', () => {
    const f = formulaire({ nature: 'repas', motif: 'Déjeuner', ttc: '24,50', tva: '2,2,3', distance: '45', vehicule: 'voiture' })
    const s = saisieDuFormulaire(f)
    expect(s).toMatchObject({ montantTtc: 24.5, distanceKm: null, vehicule: null })
    expect(refusDeLaSaisie(s, { aujourdHui: '2026-11-11', achats: false, justificatif: null })).toBe(REFUS_DES_NOTES.tva)
    expect(saisieDuFormulaire({ ...f, tva: '' }).montantTva).toBeNull()
    expect(refusDeLaSaisie(saisieDuFormulaire({ ...f, ttc: 'douze' }), { aujourdHui: '2026-11-11', achats: false, justificatif: null }))
      .toBe(REFUS_DES_NOTES.ttc)
  })

  it('la note d’un salarié se refuse sans « Achats » (B7-Q1)', () => {
    const s = saisieDuFormulaire(formulaire({ pourUnSalarie: true, salarie: 'Salarié fictif', nature: 'repas', motif: 'Déjeuner', ttc: '10' }))
    expect(refusDeLaSaisie(s, { aujourdHui: '2026-11-11', achats: false, justificatif: null })).toBe(REFUS_DES_NOTES.salarieSansAchats)
    expect(refusDeLaSaisie(s, { aujourdHui: '2026-11-11', achats: true, justificatif: null })).toBeNull()
  })

  it('les paramètres sont ceux de `enregistrer_note_de_frais`, dans son ordre ; un brouillon relu retient sa version', () => {
    const entete = /create function public\.enregistrer_note_de_frais\(([^)]*)\)/i.exec(MIGRATION)![1]
    const noms = [...entete.matchAll(/\b(p_[a-z_]+)\s/g)].map((m) => m[1])
    const f = formulaireDeLaNote(note({ version: 4 }))
    const p = parametresDeLEnregistrement('d1', f, saisieDuFormulaire(f))
    expect(Object.keys(p)).toEqual(noms)
    expect(p).toMatchObject({ p_note_id: 'n1', p_version_lue: 4, p_montant_ttc: 24.5, p_montant_tva: 2.23, p_piece_id: 'p1' })
    expect(formulaireDeLaNote(km({})).ttc).toBe('')
  })
})

describe('les kilomètres de l’année et la première tranche (B7-Q3)', () => {
  it('le cumul d’une personne, pour un type de véhicule et une année ; ni retirée, ni refusée, ni la note remplacée', () => {
    const notes = [
      km({ id: 'a', distance_km: 3000 }), km({ id: 'b', distance_km: 1000, etat: 'soumise' }),
      km({ id: 'c', distance_km: 900, etat: 'refusee' }), km({ id: 'd', distance_km: 800, etat: 'retiree' }),
      km({ id: 'e', distance_km: 700, beneficiaire_salarie: 'Salarié fictif' }), km({ id: 'f', distance_km: 600, auteur: 'u2' }),
      km({ id: 'g', distance_km: 500, date_depense: '2025-06-01' }), km({ id: 'h', distance_km: 400, vehicule_type: 'moto' }),
    ]
    const moi = { auteur: 'u1', beneficiaire_salarie: null }
    expect(cumulDesKilometres(notes, moi, 2026, 'voiture', null)).toBe(4000)
    expect(cumulDesKilometres(notes, moi, 2026, 'voiture', 'a')).toBe(1000)
    expect(cumulDesKilometres(notes, { auteur: 'u1', beneficiaire_salarie: 'Salarié fictif' }, 2026, 'voiture', null)).toBe(700)
  })

  it('au-delà de la première tranche, le signal ; en deçà, rien ; sans barème, rien', () => {
    expect(signalDeLaTranche(2026, 'voiture', 5000, 'client')).toBeNull()
    const signal = signalDeLaTranche(2026, 'voiture', 5001, 'client')!
    expect(signal).toContain('(5\u202f000 km)')
    expect(signal).toContain('ton cabinet régularise')
    expect(signalDeLaTranche(2026, 'voiture', 5001, 'cabinet')).toContain('le cabinet régularise')
    expect(signalDeLaTranche(2019, 'voiture', 9000, 'client')).toBeNull()
    expect(signalDeLaNote(km({ distance_km: 5200 }), [km({ distance_km: 5200 })], 'client')).not.toBeNull()
    expect(signalDeLaNote(note({}), [note({})], 'client')).toBeNull()
  })
})

describe('les gestes, aux règles des six fonctions', () => {
  const gestes = (n: NoteDeFrais, a: Partial<{ moi: string; cabinet: boolean; frais: boolean; achats: boolean }>) =>
    Object.entries(gestesDeLaNote(n, { moi: 'u1', cabinet: false, frais: true, achats: false, ...a })).filter(([, v]) => v).map(([k]) => k)

  it('son brouillon, son auteur ; celui d’un salarié, avec « Achats » ; jamais le cabinet', () => {
    expect(gestes(note({}), {})).toEqual(['modifier', 'soumettre', 'retirer'])
    expect(gestes(note({ auteur: 'u2' }), { achats: true })).toEqual([])
    expect(gestes(note({ beneficiaire_salarie: 'Salarié fictif' }), {})).toEqual([])
    expect(gestes(note({ beneficiaire_salarie: 'Salarié fictif' }), { achats: true })).toEqual(['modifier', 'soumettre', 'retirer'])
    expect(gestes(note({}), { cabinet: true, frais: false })).toEqual([])
  })

  it('une note soumise s’approuve ou se refuse, une approuvée se rembourse : « Achats » ou le cabinet', () => {
    expect(gestes(note({ etat: 'soumise' }), {})).toEqual([])
    expect(gestes(note({ etat: 'soumise', auteur: 'u2' }), { achats: true })).toEqual(['approuver', 'refuser'])
    expect(gestes(note({ etat: 'soumise' }), { cabinet: true, frais: false })).toEqual(['approuver', 'refuser'])
    expect(gestes(note({ etat: 'approuvee' }), { cabinet: true, frais: false })).toEqual(['rembourser'])
    for (const etat of ['refusee', 'remboursee', 'retiree'] as const) expect(gestes(note({ etat }), { cabinet: true, achats: true })).toEqual([])
  })

  it('les refus de la soumission, du motif et du remboursement, avant le clic', () => {
    expect(refusDeLaSoumission(note({ piece_id: null }), [])).toBe(REFUS_DES_NOTES.sansJustificatif)
    expect(refusDeLaSoumission(note({}), [piece({ statut: 'validee' })])).toBe(REFUS_DES_NOTES.justificatifValide)
    expect(refusDeLaSoumission(note({}), [piece({})])).toBeNull()
    expect(refusDeLaSoumission(km({}), [])).toBeNull()
    expect(refusDeLaSoumission(km({ montant_ttc: 23.8 }), [])).toBe(REFUS_DES_NOTES.baremeChange(2026))
    expect(refusDeLaSoumission(km({ date_depense: '2019-03-01' }), [])).toBe(REFUS_DES_NOTES.baremeAbsent(2019))
    expect(refusDuMotifDeRefus('  ')).toBe(REFUS_DES_NOTES.motifDuRefus)
    expect(refusDuMotifDeRefus('x'.repeat(201))).toBe(REFUS_DES_NOTES.motifDuRefus)
    expect(refusDuMotifDeRefus('Sans rapport avec l’activité')).toBeNull()
    const n = note({ etat: 'approuvee' })
    expect(refusDuRemboursement(n, '2026-11-01', 'virement', '2026-11-11')).toBe(REFUS_DES_NOTES.dateDuRemboursement)
    expect(refusDuRemboursement(n, '2026-11-12', 'virement', '2026-11-11')).toBe(REFUS_DES_NOTES.dateDuRemboursement)
    expect(refusDuRemboursement(n, '2026-11-05', '', '2026-11-11')).toBe(REFUS_DES_NOTES.moyenDuRemboursement)
    expect(refusDuRemboursement(n, '2026-11-05', 'paie', '2026-11-11')).toBeNull()
  })
})

describe('les mots', () => {
  it('une confirmation nomme la note qui part ; aucun texte montré au client n’a les mots du cabinet', () => {
    const n = note({})
    const textes = [
      confirmationDeLaSoumission(n), confirmationDuRetrait(n, 'ticket.pdf'), confirmationDeLApprobation(n),
      confirmationDuRefus(n, 'Hors activité'), confirmationDuRemboursement(n, '2026-11-05', 'paie'),
    ]
    for (const t of textes) expect(t).toContain('Repas du 02/11/2026 — « Déjeuner fictif »')
    expect(confirmationDuRetrait(n, 'ticket.pdf')).toContain('« ticket.pdf »')
    expect(confirmationDuRemboursement(n, '2026-11-05', 'paie')).toContain('le 05/11/2026, avec la paie')
    const auClient = [
      ...textes, PRESENTATION_DE_MES_NOTES_DE_FRAIS, SANS_LA_CASE_FRAIS, LIBELLE_MOTIF_REFUS_NOTE_DE_FRAIS_CLIENT,
      personneDiteAuClient(n, 'u1'), personneDiteAuClient(note({ auteur: 'u2', beneficiaire_salarie: 'Salarié fictif' }), 'u1'),
      signalDeLaTranche(2026, 'voiture', 6000, 'client')!,
      ...passagesDeLaNote(note({ etat: 'refusee', soumise_le: '2026-11-03T10:00:00Z', refusee_le: '2026-11-04T10:00:00Z', motif_refus: 'Hors activité' })),
    ]
    expect(auClient.flatMap(motsDuCabinet)).toEqual([])
  })

  it('le motif d’un refus que le cabinet saisit dit, dans son libellé, que l’auteur le lit — ce que la migration ouvre', () => {
    expect(LIBELLE_MOTIF_REFUS_NOTE_DE_FRAIS).toContain('« Notes de frais »')
    expect(LIBELLE_MOTIF_REFUS_NOTE_DE_FRAIS).toMatch(/le lit\)$/)
    expect(MIGRATION).toMatch(/create policy notes_de_frais_lecture_auteur on public\.notes_de_frais\s+for select to authenticated using \(auteur = \(select auth\.uid\(\)\) and client_du_dossier\(dossier_id, 'frais'\)\);/i)
    expect(MIGRATION).toContain('que l\'\'auteur de la note LIT : un écran du cabinet qui le saisit le dit dans son libellé')
  })

  it('un brouillon retiré ne se montre plus ; les plus récentes d’abord', () => {
    const notes = [note({ id: 'a', date_depense: '2026-10-01' }), note({ id: 'b', etat: 'retiree', piece_id: null }), note({ id: 'c', date_depense: '2026-11-05' })]
    expect(notesAMontrer(notes).map((n) => n.id)).toEqual(['c', 'a'])
  })
})
