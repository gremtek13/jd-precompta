import { afterEach, describe, expect, it, vi } from 'vitest'
import { SAISIES_2035_EXPORTEES } from './saisies2035'
import {
  auPlanAujourdHui,
  auPlanDesSaisies2035,
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
  TABLES_DES_PARAMETRES_FACTURATION,
  TABLES_DES_SAISIES_2035,
  TABLES_DES_SITUATIONS_PUBLIEES,
  TABLES_DU_JOURNAL_DES_DESIGNATIONS,
  tablesSansChemin,
  violationsOrdre,
} from './sauvegarde'

// LES SAISIES DE LA 2035 AU PLAN DE SAUVEGARDE (étapes 2035S3 à S5). Leur migration, `saisies_2035`, est préparée, pas
// appliquée : drapeau baissé, le plan effectif ne dit RIEN de la table — une sauvegarde lirait une table absente et
// échouerait —, et le plan PRÉVU est déjà juste, pour que lever `SAISIES_2035_EXPORTEES` suffise le jour venu.

const TABLE = 'saisies_2035'

describe('le filtre du plan, côté saisies de la 2035', () => {
  it('la table n’est au plan que le drapeau levé ; toute autre l’est toujours ; le filtre du jour suit le drapeau', () => {
    expect(TABLES_DES_SAISIES_2035).toEqual([TABLE])
    expect(auPlanDesSaisies2035(TABLE, false)).toBe(false)
    expect(auPlanDesSaisies2035(TABLE, true)).toBe(true)
    expect(auPlanDesSaisies2035('exercices_valides', false)).toBe(true)
    expect(auPlanAujourdHui(TABLE)).toBe(SAISIES_2035_EXPORTEES)
    const autres = [...TABLES_DES_DEVIS, ...TABLES_DES_ARTICLES, ...TABLES_DES_ADRESSES_RECEPTION, ...TABLES_DES_CONTACTS,
      ...TABLES_DES_PARAMETRES_FACTURATION, ...TABLES_DU_JOURNAL_DES_DESIGNATIONS, ...TABLES_DE_LA_CAISSE,
      ...TABLES_DE_LA_TRACE_DES_DROITS, ...TABLES_DES_SITUATIONS_PUBLIEES]
    expect(TABLES_DES_SAISIES_2035.filter((t) => autres.includes(t))).toEqual([])
  })

  it('drapeau baissé, le plan effectif ne nomme pas la table ; sa clé est la commune', () => {
    const nommees = new Set([
      ...RELATIONS.flatMap((r) => [r.enfant, r.parent]), ...ORDRE_RESTAURATION, ...Object.keys(CHEMINS_DOSSIER),
      ...TABLES_AUTO_REFERENCEES_PAR_VAGUES.map((a) => a.table), ...Object.keys(CLES_PRIMAIRES),
    ])
    expect(nommees.has(TABLE)).toBe(SAISIES_2035_EXPORTEES)
    expect(Object.keys(CLES_PRIMAIRES_PREVUES)).not.toContain(TABLE)
    expect(clePrimaire(TABLE)).toEqual(['id'])
  })
})

describe('le plan prévu, saisies comprises', () => {
  it('l’ordre — juste avant les exercices validés, que leur gel exige —, le chemin, aucune vague, la relation de la migration', () => {
    expect(ORDRE_RESTAURATION_PREVU.filter((t) => t === TABLE)).toHaveLength(1)
    expect(ORDRE_RESTAURATION_PREVU.indexOf(TABLE)).toBe(ORDRE_RESTAURATION_PREVU.indexOf('exercices_valides') - 1)
    expect(CHEMINS_DOSSIER_PREVUS[TABLE]).toEqual({ acces: 'direct' })
    expect(TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES.filter((a) => a.table === TABLE)).toEqual([])
    expect(RELATIONS_PREVUES.filter((r) => r.enfant === TABLE || r.parent === TABLE)
      .map((r) => `${r.enfant}.${r.colonne} → ${r.parent} (${r.aLaSuppression})`)).toEqual(['saisies_2035.dossier_id → dossiers (cascade)'])
  })

  it('l’ordre prévu respecte toutes les dépendances, les chemins se suivent ; un défaut planté se voit', () => {
    expect(violationsOrdre(ORDRE_RESTAURATION_PREVU, [...RELATIONS_PREVUES, ...LIENS_GARDES])).toEqual([])
    expect(tablesSansChemin(ORDRE_RESTAURATION_PREVU, CHEMINS_DOSSIER_PREVUS)).toEqual([])
    expect(planExportDossier(ORDRE_RESTAURATION_PREVU, CHEMINS_DOSSIER_PREVUS).map((e) => e.table)).toContain(TABLE)
    const plante = ORDRE_RESTAURATION_PREVU.filter((t) => t !== TABLE)
    plante.splice(plante.indexOf('dossiers'), 0, TABLE)
    expect(violationsOrdre(plante, [...RELATIONS_PREVUES, ...LIENS_GARDES]).map((v) => `${v.enfant} → ${v.parent}`))
      .toContain('saisies_2035 → dossiers')
  })
})

describe('les saisies dans les deux états du drapeau : la réinsertion', () => {
  afterEach(() => {
    vi.doUnmock('./saisies2035')
    vi.resetModules()
  })

  async function sauvegardeSous(drapeau: boolean) {
    vi.resetModules()
    vi.doMock('./saisies2035', async (original) => ({ ...(await original<typeof import('./saisies2035')>()), SAISIES_2035_EXPORTEES: drapeau }))
    return import('./sauvegarde')
  }

  const contenu = {
    dossiers: [{ id: 'd1' }],
    saisies_2035: [
      { id: 's1', dossier_id: 'd1', annee: 2025, code: 'CC', centimes: 120000, note_annexe: 'Quote-part personnelle du loyer',
        created_at: '2026-01-10T08:00:00Z', updated_at: '2026-01-10T08:00:00Z' },
      { id: 's2', dossier_id: 'd1', annee: 2025, code: 'DE', centimes: 30000, note_annexe: null,
        created_at: '2026-01-10T08:00:00Z', updated_at: '2026-01-11T08:00:00Z' },
    ],
  }

  it('levé : les deux saisies, telles quelles, en une étape', async () => {
    const s = await sauvegardeSous(true)
    const etapes = s.planReinsertion(contenu).etapes.filter((e) => e.table === TABLE)
    expect(etapes.map((e) => e.lignes.map((l) => l.id))).toEqual([['s1', 's2']])
    expect(etapes[0].lignes[0]).toMatchObject({ code: 'CC', centimes: 120000, note_annexe: 'Quote-part personnelle du loyer' })
    expect(s.liensPerdus(contenu)).toEqual([])
  })

  it('baissé : rien n’en part, et rien ne s’en dit', async () => {
    const s = await sauvegardeSous(false)
    expect(s.planReinsertion(contenu).etapes.some((e) => e.table === TABLE)).toBe(false)
    expect(s.ORDRE_RESTAURATION).not.toContain(TABLE)
  })
})
