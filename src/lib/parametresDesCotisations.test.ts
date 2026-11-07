import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  PARAMETRES_DES_COTISATIONS_EXPORTES, lireDebutActivite, lireParametresDUnExercice, memesValeurs, parametresDeLEnregistrement,
  parametresDeLEstimation, saisieDe, tauxDentisteAdmis, valeursSaisies,
} from './parametresDesCotisations'

// Un client qui lève à toute lecture : drapeau baissé, aucun appel ; levé, la lecture qui lève se dit incomplète.
vi.mock('./supabase', () => ({ supabase: { from: () => { throw new Error('aucune lecture attendue, drapeau baissé') } } }))

// LES PARAMÈTRES DES COTISATIONS (ligne 27, TNS-Q1 et TNS-Q4) : ce que le module croit d'une ligne lue, ce qu'il donne à
// l'estimation, et les refus de la base qu'il redit avant le clic, confrontés au texte de la migration (dans l'export depuis le 07/11/2026).
const MIGRATION = readFileSync(new URL('../../supabase/schema/20261107165534_parametres_des_cotisations.sql', import.meta.url), 'utf8')

describe('le drapeau', () => {
  // Levé le 07/11/2026, le jour de l'application : la lecture part. Son état d'avant reste éprouvé par la fonction …Selon(false).
  it('levé : la lecture part ; baissé, elle ne fait aucun appel et rend « absents »', async () => {
    expect(PARAMETRES_DES_COTISATIONS_EXPORTES).toBe(true)
    const { lireLesParametresDesCotisations, lireLesParametresDesCotisationsSelon } = await import('./parametresDesCotisationsLecture')
    expect((await lireLesParametresDesCotisations('d')).etat).toBe('incomplets')
    expect(await lireLesParametresDesCotisationsSelon('d', false)).toEqual({ dossierId: 'd', etat: 'absents' })
    // Levé, la lecture part, et une lecture qui lève se dit incomplète, sans rejeter.
    expect((await lireLesParametresDesCotisationsSelon('d', true)).etat).toBe('incomplets')
  })
})

describe('ce que l’estimation reçoit', () => {
  it('absents : l’estimation d’hier ; pas lus ou lus en partie : rien', () => {
    expect(parametresDeLEstimation({ dossierId: 'd', etat: 'absents' }, 2025)).toEqual({ tenus: false })
    expect(parametresDeLEstimation(null, 2025)).toBeNull()
    expect(parametresDeLEstimation({ dossierId: 'd', etat: 'incomplets', motif: 'x' }, 2025)).toBeNull()
  })

  it('lus : chaque valeur telle qu’en base, l’exercice absent valant non dit', () => {
    const lecture = { dossierId: 'd', etat: 'lus' as const, debutActivite: '2025-07-01',
      parExercice: new Map([[2025, { acre: true, tauxDentiste: 0.35 }]]) }
    expect(parametresDeLEstimation(lecture, 2025)).toEqual({ tenus: true, debutActivite: '2025-07-01', acre: true, tauxDentiste: 0.35 })
    expect(parametresDeLEstimation(lecture, 2026)).toEqual({ tenus: true, debutActivite: '2025-07-01', acre: null, tauxDentiste: null })
  })
})

describe('les lignes lues', () => {
  it('le début d’activité : une date, ou null ; toute autre forme ne se croit pas', () => {
    expect(lireDebutActivite({ date_debut: '2025-07-01' })).toBe('2025-07-01')
    expect(lireDebutActivite({ date_debut: null })).toBeNull()
    expect(lireDebutActivite({ date_debut: '01/07/2025' })).toBeUndefined()
    expect(lireDebutActivite(null)).toBeUndefined()
  })

  it('les paramètres d’un exercice : le taux en nombre ou en texte, entre 0 et 1, au centième', () => {
    expect(lireParametresDUnExercice({ annee: 2025, acre: false, taux_dentiste: 0.35 })).toEqual({ annee: 2025, acre: false, tauxDentiste: 0.35 })
    expect(lireParametresDUnExercice({ annee: 2025, acre: null, taux_dentiste: '0.40' })).toEqual({ annee: 2025, acre: null, tauxDentiste: 0.4 })
    expect(lireParametresDUnExercice({ annee: 2025, acre: null, taux_dentiste: 1.5 })).toBeNull()
    expect(lireParametresDUnExercice({ annee: 2025, acre: 'oui', taux_dentiste: null })).toBeNull()
    expect(lireParametresDUnExercice({ annee: '2025', acre: null, taux_dentiste: null })).toBeNull()
  })
})

describe('la saisie, et les refus de la base redits avant le clic', () => {
  it('les bornes du taux sont celles de la contrainte', () => {
    expect(MIGRATION).toContain('taux_dentiste >= 0 and taux_dentiste <= 1 and taux_dentiste = round(taux_dentiste, 2)')
    for (const t of [0, 0.01, 0.35, 1]) expect(tauxDentisteAdmis(t), String(t)).toBe(true)
    for (const t of [-0.01, 1.01, 0.355, Number.NaN]) expect(tauxDentisteAdmis(t), String(t)).toBe(false)
  })

  it('les bornes de la date sont celles de la contrainte, et une date hors du calendrier se refuse', () => {
    expect(MIGRATION).toContain("date_debut >= date '1900-01-01' and date_debut <= date '2100-12-31'")
    const date = (debutActivite: string) => valeursSaisies({ debutActivite, acre: '', tauxDentiste: '' })
    expect(date('2025-07-01').valeurs?.debut_activite).toBe('2025-07-01')
    expect(date('').valeurs?.debut_activite).toBeNull()
    for (const d of ['2025-02-30', '1899-12-31', '2101-01-01', '01/07/2025']) expect(date(d).refus, d).toMatch(/date du calendrier/)
  })

  it('le taux se tape à la virgule ou au point ; l’ACRE en trois états', () => {
    expect(valeursSaisies({ debutActivite: '', acre: 'oui', tauxDentiste: '0,35' }).valeurs).toEqual({ debut_activite: null, acre: true, taux_dentiste: 0.35 })
    expect(valeursSaisies({ debutActivite: '', acre: 'non', tauxDentiste: '1' }).valeurs).toEqual({ debut_activite: null, acre: false, taux_dentiste: 1 })
    for (const t of ['1,5', '-0,1', '0,355', '1e-1', 'abc']) {
      expect(valeursSaisies({ debutActivite: '', acre: '', tauxDentiste: t }).refus, t).toMatch(/entre 0 et 1, au centième/)
    }
  })

  it('l’aller et retour de la saisie, et l’égalité qui retient l’enregistrement', () => {
    const v = { debut_activite: '2025-07-01', acre: false, taux_dentiste: 0.35 }
    expect(valeursSaisies(saisieDe(v)).valeurs).toEqual(v)
    expect(memesValeurs(v, { ...v })).toBe(true)
    expect(memesValeurs(v, { ...v, acre: null })).toBe(false)
  })

  it('les paramètres de la fonction portent ses quatre noms, et les trois clés de chaque valeur', () => {
    expect(MIGRATION).toContain('enregistrer_parametres_des_cotisations(p_dossier_id uuid, p_annee integer, p_lus jsonb, p_saisis jsonb)')
    expect(MIGRATION).toContain("v_cles constant text[] := array['acre', 'debut_activite', 'taux_dentiste'];")
    const lues = { debut_activite: null, acre: null, taux_dentiste: null }
    const p = parametresDeLEnregistrement('d', 2025, lues, { ...lues, acre: true })
    expect(Object.keys(p)).toEqual(['p_dossier_id', 'p_annee', 'p_lus', 'p_saisis'])
    expect(Object.keys(p.p_lus).sort()).toEqual(['acre', 'debut_activite', 'taux_dentiste'])
    expect(Object.keys(p.p_saisis).sort()).toEqual(['acre', 'debut_activite', 'taux_dentiste'])
  })
})
