import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { CASES_DU_MEDECIN_PREVUES, casesDuMedecinDeLExercice, valeursLues,
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
    // Les deux cases d'un médecin en base (RET-Q2, `CASES_DU_MEDECIN_PREVUES` levé) : la ligne les porte, nulles tant que le
    // cabinet ne les a pas dites.
    const cases = { cumul_emploi_retraite: null, dispense_complementaire: null }
    const medecin = { medecin: { cumulEmploiRetraite: null, dispenseComplementaire: null } }
    expect(lireParametresDUnExercice({ annee: 2025, acre: false, taux_dentiste: 0.35, ...cases })).toEqual({ annee: 2025, acre: false, tauxDentiste: 0.35, ...medecin })
    expect(lireParametresDUnExercice({ annee: 2025, acre: null, taux_dentiste: '0.40', ...cases })).toEqual({ annee: 2025, acre: null, tauxDentiste: 0.4, ...medecin })
    expect(lireParametresDUnExercice({ annee: 2025, acre: null, taux_dentiste: 1.5, ...cases })).toBeNull()
    expect(lireParametresDUnExercice({ annee: 2025, acre: 'oui', taux_dentiste: null, ...cases })).toBeNull()
    expect(lireParametresDUnExercice({ annee: '2025', acre: null, taux_dentiste: null, ...cases })).toBeNull()
    // L'état d'avant RET-Q2 (le drapeau baissé) : les trois colonnes d'hier.
    expect(lireParametresDUnExercice({ annee: 2025, acre: false, taux_dentiste: 0.35 }, false)).toEqual({ annee: 2025, acre: false, tauxDentiste: 0.35 })
    expect(lireParametresDUnExercice({ annee: 2025, acre: null, taux_dentiste: '0.40' }, false)).toEqual({ annee: 2025, acre: null, tauxDentiste: 0.4 })
    expect(lireParametresDUnExercice({ annee: 2025, acre: null, taux_dentiste: 1.5 }, false)).toBeNull()
    expect(lireParametresDUnExercice({ annee: 2025, acre: 'oui', taux_dentiste: null }, false)).toBeNull()
    expect(lireParametresDUnExercice({ annee: '2025', acre: null, taux_dentiste: null }, false)).toBeNull()
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
    const date = (debutActivite: string) => valeursSaisies({ debutActivite, acre: '', tauxDentiste: '', cumul: '', dispense: '', exoneration: '' })
    expect(date('2025-07-01').valeurs?.debut_activite).toBe('2025-07-01')
    expect(date('').valeurs?.debut_activite).toBeNull()
    for (const d of ['2025-02-30', '1899-12-31', '2101-01-01', '01/07/2025']) expect(date(d).refus, d).toMatch(/date du calendrier/)
  })

  it('le taux se tape à la virgule ou au point ; l’ACRE en trois états', () => {
    const cases = { cumul_emploi_retraite: null, dispense_complementaire: null }
    expect(valeursSaisies({ debutActivite: '', acre: 'oui', tauxDentiste: '0,35', cumul: '', dispense: '', exoneration: '' }).valeurs).toEqual({ debut_activite: null, acre: true, taux_dentiste: 0.35, ...cases })
    expect(valeursSaisies({ debutActivite: '', acre: 'non', tauxDentiste: '1', cumul: '', dispense: '', exoneration: '' }).valeurs).toEqual({ debut_activite: null, acre: false, taux_dentiste: 1, ...cases })
    // L'état d'avant RET-Q2 (le drapeau baissé) : les trois clés d'hier.
    expect(valeursSaisies({ debutActivite: '', acre: 'oui', tauxDentiste: '0,35', cumul: '', dispense: '', exoneration: '' }, false).valeurs).toEqual({ debut_activite: null, acre: true, taux_dentiste: 0.35 })
    for (const t of ['1,5', '-0,1', '0,355', '1e-1', 'abc']) {
      expect(valeursSaisies({ debutActivite: '', acre: '', tauxDentiste: t, cumul: '', dispense: '', exoneration: '' }).refus, t).toMatch(/entre 0 et 1, au centième/)
    }
  })

  it('l’aller et retour de la saisie, et l’égalité qui retient l’enregistrement', () => {
    const v = { debut_activite: '2025-07-01', acre: false, taux_dentiste: 0.35, cumul_emploi_retraite: true, dispense_complementaire: null }
    expect(valeursSaisies(saisieDe(v)).valeurs).toEqual(v)
    // L'état d'avant RET-Q2 (le drapeau baissé) : les trois clés d'hier.
    const hier = { debut_activite: '2025-07-01', acre: false, taux_dentiste: 0.35 }
    expect(valeursSaisies(saisieDe(hier), false).valeurs).toEqual(hier)
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

// LES DEUX CASES D'UN MÉDECIN (RET-Q2, migration `cumul_et_dispense_du_medecin`, en production depuis le 15/11/2026) : la
// forme à cinq clés, sous `CASES_DU_MEDECIN_PREVUES` (levé) seulement, confrontée au texte de la migration ; la forme d'hier,
// le drapeau baissé, jouée tant que son code existe.
describe('les deux cases d’un médecin (RET-Q2)', () => {
  const PREPAREE = readFileSync(new URL('../../supabase/schema/20261115074806_cumul_et_dispense_du_medecin.sql', import.meta.url), 'utf8')
  const lecture = (cases?: { cumulEmploiRetraite: boolean | null; dispenseComplementaire: boolean | null }) => ({
    dossierId: 'd', etat: 'lus' as const, debutActivite: '2024-11-15',
    parExercice: new Map([[2025, { acre: false, tauxDentiste: null, ...(cases ? { medecin: cases } : {}) }]]),
  })

  it('le drapeau est levé, la migration en base : par défaut, les cinq clés et la ligne lue avec ses deux cases', () => {
    expect(CASES_DU_MEDECIN_PREVUES).toBe(true)
    expect(Object.keys(valeursLues(lecture({ cumulEmploiRetraite: null, dispenseComplementaire: null }), 2025)).sort())
      .toEqual(['acre', 'cumul_emploi_retraite', 'debut_activite', 'dispense_complementaire', 'taux_dentiste'])
    expect(lireParametresDUnExercice({ annee: 2025, acre: null, taux_dentiste: null })).toBeNull()
  })

  it('baissé (l’état d’avant) : les valeurs d’hier, trois clés', () => {
    expect(Object.keys(valeursLues(lecture(), 2025, false)).sort()).toEqual(['acre', 'debut_activite', 'taux_dentiste'])
    expect(Object.keys(valeursSaisies({ debutActivite: '', acre: '', tauxDentiste: '', cumul: 'oui', dispense: 'non', exoneration: '' }, false).valeurs!).sort())
      .toEqual(['acre', 'debut_activite', 'taux_dentiste'])
    expect(lireParametresDUnExercice({ annee: 2025, acre: null, taux_dentiste: null }, false)).toEqual({ annee: 2025, acre: null, tauxDentiste: null })
  })

  it('levé : cinq clés des deux côtés, celles que la fonction attend, dans l’ordre de son tableau', () => {
    const cles = /v_cles_du_medecin constant text\[\] := array\[([^\]]*)\];/.exec(PREPAREE)![1].split(',').map((c) => c.trim().replace(/'/g, ''))
    const lues = valeursLues(lecture({ cumulEmploiRetraite: true, dispenseComplementaire: null }), 2025, true)
    expect(Object.keys(lues).sort()).toEqual(cles)
    expect(lues).toMatchObject({ cumul_emploi_retraite: true, dispense_complementaire: null })
    const saisies = valeursSaisies({ ...saisieDe(lues), dispense: 'oui' }, true).valeurs!
    expect(Object.keys(saisies).sort()).toEqual(cles)
    expect(saisies).toMatchObject({ cumul_emploi_retraite: true, dispense_complementaire: true })
    expect(memesValeurs(saisies, lues)).toBe(false)
    expect(memesValeurs(valeursSaisies(saisieDe(lues), true).valeurs!, lues)).toBe(true)
  })

  it('levé : une ligne lue porte ses deux cases, booléennes ou nulles ; une autre forme la rend illisible', () => {
    expect(lireParametresDUnExercice({ annee: 2025, acre: null, taux_dentiste: null, cumul_emploi_retraite: false, dispense_complementaire: null }, true))
      .toEqual({ annee: 2025, acre: null, tauxDentiste: null, medecin: { cumulEmploiRetraite: false, dispenseComplementaire: null } })
    expect(lireParametresDUnExercice({ annee: 2025, acre: null, taux_dentiste: null, cumul_emploi_retraite: 'oui', dispense_complementaire: null }, true)).toBeNull()
    expect(lireParametresDUnExercice({ annee: 2025, acre: null, taux_dentiste: null }, true)).toBeNull()
    expect(PREPAREE).toContain('add column cumul_emploi_retraite boolean,\n  add column dispense_complementaire boolean;')
  })

  it('l’estimation reçoit les cases de l’exercice, nulles quand il n’en a pas ; rien d’une lecture partielle', () => {
    expect(casesDuMedecinDeLExercice(lecture({ cumulEmploiRetraite: true, dispenseComplementaire: false }), 2025))
      .toEqual({ cumulEmploiRetraite: true, dispenseComplementaire: false })
    expect(casesDuMedecinDeLExercice(lecture(), 2026)).toEqual({ cumulEmploiRetraite: null, dispenseComplementaire: null })
    expect(casesDuMedecinDeLExercice({ dossierId: 'd', etat: 'incomplets', motif: 'x' }, 2025)).toBeNull()
    expect(casesDuMedecinDeLExercice(null, 2025)).toBeNull()
  })
})

