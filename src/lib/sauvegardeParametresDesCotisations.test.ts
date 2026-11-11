import { afterEach, describe, expect, it, vi } from 'vitest'
import { PARAMETRES_DES_COTISATIONS_EXPORTES } from './parametresDesCotisations'
import {
  auPlanAujourdHui,
  auPlanDesParametresDesCotisations,
  CHEMINS_DOSSIER,
  CHEMINS_DOSSIER_PREVUS,
  CLES_PRIMAIRES,
  CLES_PRIMAIRES_PREVUES,
  clePrimaire,
  LIENS_GARDES,
  ORDRE_RESTAURATION,
  ORDRE_RESTAURATION_PREVU,
  planExportDossier,
  RELATIONS,
  RELATIONS_PREVUES,
  TABLES_AUTO_REFERENCEES_PAR_VAGUES,
  TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES,
  TABLES_DE_LA_CAISSE,
  TABLES_DE_LA_TRACE_DES_DROITS,
  TABLES_DES_ADRESSES_RECEPTION,
  TABLES_DES_ARTICLES,
  TABLES_DES_CONTACTS,
  TABLES_DES_DEVIS,
  TABLES_DES_PARAMETRES_DES_COTISATIONS,
  TABLES_DES_PARAMETRES_FACTURATION,
  TABLES_DES_SAISIES_2035,
  TABLES_DES_SITUATIONS_PUBLIEES,
  TABLES_DU_JOURNAL_DES_DESIGNATIONS,
  tablesSansChemin,
  violationsOrdre,
} from './sauvegarde'

// LES PARAMÈTRES DES COTISATIONS AU PLAN DE SAUVEGARDE (ligne 27, TNS-Q1 et TNS-Q4). Leur migration,
// `parametres_des_cotisations`, est en production depuis le 07/11/2026, `PARAMETRES_DES_COTISATIONS_EXPORTES` levé : le plan
// effectif porte les deux tables. Baissé — son état d'avant, joué ici par `vi.doMock` —, il n'en dirait RIEN (une
// sauvegarde lirait une table absente et échouerait), et le plan PRÉVU reste celui que le drapeau levé suit.

const DEBUT = 'debuts_d_activite'
const TABLE = 'parametres_des_cotisations'

describe('le filtre du plan, côté paramètres des cotisations', () => {
  it('les tables ne sont au plan que le drapeau levé ; toute autre l’est toujours ; le filtre du jour suit le drapeau', () => {
    expect(TABLES_DES_PARAMETRES_DES_COTISATIONS).toEqual([DEBUT, TABLE])
    for (const t of [DEBUT, TABLE]) {
      expect(auPlanDesParametresDesCotisations(t, false)).toBe(false)
      expect(auPlanDesParametresDesCotisations(t, true)).toBe(true)
      expect(auPlanAujourdHui(t)).toBe(PARAMETRES_DES_COTISATIONS_EXPORTES)
    }
    expect(auPlanDesParametresDesCotisations('exercices_valides', false)).toBe(true)
    const autres = [...TABLES_DES_DEVIS, ...TABLES_DES_ARTICLES, ...TABLES_DES_ADRESSES_RECEPTION, ...TABLES_DES_CONTACTS,
      ...TABLES_DES_PARAMETRES_FACTURATION, ...TABLES_DU_JOURNAL_DES_DESIGNATIONS, ...TABLES_DE_LA_CAISSE,
      ...TABLES_DE_LA_TRACE_DES_DROITS, ...TABLES_DES_SITUATIONS_PUBLIEES, ...TABLES_DES_SAISIES_2035]
    expect(TABLES_DES_PARAMETRES_DES_COTISATIONS.filter((t) => autres.includes(t))).toEqual([])
  })

  it('drapeau baissé, le plan effectif ne nomme pas les tables ; leur clé est la commune', () => {
    const nommees = new Set([
      ...RELATIONS.flatMap((r) => [r.enfant, r.parent]), ...ORDRE_RESTAURATION, ...Object.keys(CHEMINS_DOSSIER),
      ...TABLES_AUTO_REFERENCEES_PAR_VAGUES.map((a) => a.table), ...Object.keys(CLES_PRIMAIRES),
    ])
    for (const t of [DEBUT, TABLE]) {
      expect(nommees.has(t)).toBe(PARAMETRES_DES_COTISATIONS_EXPORTES)
      expect(Object.keys(CLES_PRIMAIRES_PREVUES)).not.toContain(t)
      expect(clePrimaire(t)).toEqual(['id'])
    }
  })
})

describe('le plan prévu, paramètres compris', () => {
  it('l’ordre — avant les exercices validés, que le gel des paramètres d’un exercice exige —, les chemins, aucune vague, les relations de la migration', () => {
    for (const t of [DEBUT, TABLE]) {
      expect(ORDRE_RESTAURATION_PREVU.filter((x) => x === t)).toHaveLength(1)
      expect(CHEMINS_DOSSIER_PREVUS[t]).toEqual({ acces: 'direct' })
      expect(TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES.filter((a) => a.table === t)).toEqual([])
    }
    // Le début d'activité, puis les paramètres d'un exercice, puis les saisies de la 2035, puis les exercices validés.
    const fin = ORDRE_RESTAURATION_PREVU.indexOf('exercices_valides')
    // Les saisies de l'annexe 2035-E (ligne 48) suivent celles de la 2035.
    expect(ORDRE_RESTAURATION_PREVU.slice(fin - 4, fin)).toEqual([DEBUT, TABLE, 'saisies_2035', 'saisies_2035e'])
    expect(RELATIONS_PREVUES.filter((r) => [DEBUT, TABLE].includes(r.enfant) || [DEBUT, TABLE].includes(r.parent))
      .map((r) => `${r.enfant}.${r.colonne} → ${r.parent} (${r.aLaSuppression})`)).toEqual([
      'debuts_d_activite.dossier_id → dossiers (cascade)', 'parametres_des_cotisations.dossier_id → dossiers (cascade)',
    ])
  })

  it('l’ordre prévu respecte toutes les dépendances, les chemins se suivent ; un défaut planté se voit', () => {
    expect(violationsOrdre(ORDRE_RESTAURATION_PREVU, [...RELATIONS_PREVUES, ...LIENS_GARDES])).toEqual([])
    expect(tablesSansChemin(ORDRE_RESTAURATION_PREVU, CHEMINS_DOSSIER_PREVUS)).toEqual([])
    const tables = planExportDossier(ORDRE_RESTAURATION_PREVU, CHEMINS_DOSSIER_PREVUS).map((e) => e.table)
    expect(tables).toContain(DEBUT)
    expect(tables).toContain(TABLE)
    const plante = ORDRE_RESTAURATION_PREVU.filter((t) => t !== TABLE)
    plante.splice(plante.indexOf('dossiers'), 0, TABLE)
    expect(violationsOrdre(plante, [...RELATIONS_PREVUES, ...LIENS_GARDES]).map((v) => `${v.enfant} → ${v.parent}`))
      .toContain('parametres_des_cotisations → dossiers')
  })
})

describe('les paramètres dans les deux états du drapeau : la réinsertion', () => {
  afterEach(() => {
    vi.doUnmock('./parametresDesCotisations')
    vi.resetModules()
  })

  async function sauvegardeSous(drapeau: boolean) {
    vi.resetModules()
    vi.doMock('./parametresDesCotisations', async (original) => ({
      ...(await original<typeof import('./parametresDesCotisations')>()), PARAMETRES_DES_COTISATIONS_EXPORTES: drapeau,
    }))
    return import('./sauvegarde')
  }

  const contenu = {
    dossiers: [{ id: 'd1' }],
    debuts_d_activite: [
      { id: 'a1', dossier_id: 'd1', date_debut: '2025-07-01', created_at: '2026-01-10T08:00:00Z', updated_at: '2026-01-10T08:00:00Z' },
    ],
    parametres_des_cotisations: [
      { id: 'p1', dossier_id: 'd1', annee: 2025, acre: true, taux_dentiste: null,
        created_at: '2026-01-10T08:00:00Z', updated_at: '2026-01-10T08:00:00Z' },
      { id: 'p2', dossier_id: 'd1', annee: 2026, acre: null, taux_dentiste: 0.35,
        created_at: '2026-01-10T08:00:00Z', updated_at: '2026-01-11T08:00:00Z' },
    ],
  }

  it('levé : le début d’activité et les deux exercices, tels quels', async () => {
    const s = await sauvegardeSous(true)
    const etapes = s.planReinsertion(contenu).etapes
    expect(etapes.filter((e) => e.table === DEBUT).map((e) => e.lignes.map((l) => l.id))).toEqual([['a1']])
    const parametres = etapes.filter((e) => e.table === TABLE)
    expect(parametres.map((e) => e.lignes.map((l) => l.id))).toEqual([['p1', 'p2']])
    expect(parametres[0].lignes[1]).toMatchObject({ annee: 2026, acre: null, taux_dentiste: 0.35 })
    expect(s.liensPerdus(contenu)).toEqual([])
  })

  it('baissé : rien n’en part, et rien ne s’en dit', async () => {
    const s = await sauvegardeSous(false)
    expect(s.planReinsertion(contenu).etapes.some((e) => e.table === DEBUT || e.table === TABLE)).toBe(false)
    expect(s.ORDRE_RESTAURATION).not.toContain(DEBUT)
    expect(s.ORDRE_RESTAURATION).not.toContain(TABLE)
  })
})
