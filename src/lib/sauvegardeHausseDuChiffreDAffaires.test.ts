import { afterEach, describe, expect, it, vi } from 'vitest'
import { HAUSSE_DU_CHIFFRE_D_AFFAIRES_PREVUE } from './hausseDuChiffreDAffaires'
import {
  auPlanAujourdHui,
  auPlanDeLaHausseDuChiffreDAffaires,
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
  TABLES_DE_LA_HAUSSE_DU_CHIFFRE_D_AFFAIRES,
  tablesSansChemin,
  violationsOrdre,
} from './sauvegarde'

// L'ALERTE DU CHIFFRE D'AFFAIRES AU PLAN DE SAUVEGARDE (la demande du cabinet du 15/11/2026 ; le seuil de baisse, CA-Q2, le
// 16/11/2026, une colonne de la même table : le plan ne change pas). Sa migration,
// `hausse_du_chiffre_d_affaires`, est préparée (supabase/preparees/20261115140000_hausse_du_chiffre_d_affaires.sql) et le
// drapeau baissé : le plan effectif ne dit RIEN des deux tables — une sauvegarde lirait des tables absentes et échouerait ; le
// plan PRÉVU les porte, et les deux états du drapeau se jouent (`vi.doMock`, plus bas).

const TABLES = ['seuils_du_chiffre_d_affaires', 'hausses_vues_avec_le_client'] as const

describe('le filtre du plan, côté alerte de hausse', () => {
  it('les tables ne sont au plan que le drapeau levé ; toute autre l’est toujours ; le filtre du jour suit le drapeau', () => {
    expect(TABLES_DE_LA_HAUSSE_DU_CHIFFRE_D_AFFAIRES).toEqual([...TABLES])
    for (const t of TABLES) {
      expect(auPlanDeLaHausseDuChiffreDAffaires(t, false)).toBe(false)
      expect(auPlanDeLaHausseDuChiffreDAffaires(t, true)).toBe(true)
      expect(auPlanAujourdHui(t)).toBe(HAUSSE_DU_CHIFFRE_D_AFFAIRES_PREVUE)
    }
    expect(auPlanDeLaHausseDuChiffreDAffaires('memberships', false)).toBe(true)
  })

  it('drapeau baissé, le plan effectif ne nomme pas les tables ; leur clé est la commune', () => {
    const nommees = new Set([
      ...RELATIONS.flatMap((r) => [r.enfant, r.parent]), ...ORDRE_RESTAURATION, ...Object.keys(CHEMINS_DOSSIER),
      ...TABLES_AUTO_REFERENCEES_PAR_VAGUES.map((a) => a.table), ...Object.keys(CLES_PRIMAIRES),
    ])
    for (const t of TABLES) {
      expect(nommees.has(t)).toBe(HAUSSE_DU_CHIFFRE_D_AFFAIRES_PREVUE)
      expect(Object.keys(CLES_PRIMAIRES_PREVUES)).not.toContain(t)
      expect(clePrimaire(t)).toEqual(['id'])
    }
  })
})

describe('le plan prévu, alerte comprise', () => {
  it('l’ordre (après les repères annuels par poste), les chemins, aucune vague, et les deux relations de la migration', () => {
    for (const t of TABLES) {
      expect(ORDRE_RESTAURATION_PREVU.filter((x) => x === t)).toHaveLength(1)
      expect(CHEMINS_DOSSIER_PREVUS[t]).toEqual({ acces: 'direct' })
      expect(TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES.some((a) => a.table === t)).toBe(false)
    }
    expect(ORDRE_RESTAURATION_PREVU[ORDRE_RESTAURATION_PREVU.indexOf('seuils_du_chiffre_d_affaires') - 1]).toBe('references_postes_annuels')
    expect(ORDRE_RESTAURATION_PREVU[ORDRE_RESTAURATION_PREVU.indexOf('seuils_du_chiffre_d_affaires') + 1]).toBe('hausses_vues_avec_le_client')
    expect(RELATIONS_PREVUES.filter((r) => (TABLES as readonly string[]).includes(r.enfant) || (TABLES as readonly string[]).includes(r.parent))
      .map((r) => `${r.enfant}.${r.colonne} → ${r.parent} (${r.aLaSuppression})`)).toEqual([
      'seuils_du_chiffre_d_affaires.dossier_id → dossiers (cascade)',
      'hausses_vues_avec_le_client.dossier_id → dossiers (cascade)',
    ])
  })

  it('l’ordre prévu respecte toutes les dépendances, les chemins se suivent ; un défaut planté se voit', () => {
    expect(violationsOrdre(ORDRE_RESTAURATION_PREVU, [...RELATIONS_PREVUES, ...LIENS_GARDES])).toEqual([])
    expect(tablesSansChemin(ORDRE_RESTAURATION_PREVU, CHEMINS_DOSSIER_PREVUS)).toEqual([])
    const exportees = planExportDossier(ORDRE_RESTAURATION_PREVU, CHEMINS_DOSSIER_PREVUS).map((e) => e.table)
    for (const t of TABLES) expect(exportees).toContain(t)
    const plante = ORDRE_RESTAURATION_PREVU.filter((t) => t !== 'hausses_vues_avec_le_client')
    plante.splice(plante.indexOf('dossiers'), 0, 'hausses_vues_avec_le_client')
    expect(violationsOrdre(plante, [...RELATIONS_PREVUES, ...LIENS_GARDES]).map((v) => `${v.enfant} → ${v.parent}`))
      .toContain('hausses_vues_avec_le_client → dossiers')
  })
})

describe('l’alerte dans les deux états du drapeau : la réinsertion', () => {
  afterEach(() => {
    vi.doUnmock('./hausseDuChiffreDAffaires')
    vi.resetModules()
  })

  async function sauvegardeSous(drapeau: boolean) {
    vi.resetModules()
    vi.doMock('./hausseDuChiffreDAffaires', async (original) => ({
      ...(await original<typeof import('./hausseDuChiffreDAffaires')>()), HAUSSE_DU_CHIFFRE_D_AFFAIRES_PREVUE: drapeau,
    }))
    return import('./sauvegarde')
  }

  const contenu = {
    dossiers: [{ id: 'd1' }],
    seuils_du_chiffre_d_affaires: [
      { id: 's1', dossier_id: 'd1', seuil_de_hausse: 20, seuil_de_baisse: 15, regle_par: 'u1', regle_le: '2026-11-15T08:00:00Z' },
    ],
    hausses_vues_avec_le_client: [
      { id: 'v1', dossier_id: 'd1', annee: 2026, trimestre: 3, vue_par: 'u1', vue_le: '2026-11-16T08:00:00Z' },
    ],
  }

  it('levé : les seuils et la marque se réinsèrent après leur dossier, sans lien perdu', async () => {
    const s = await sauvegardeSous(true)
    const etapes = s.planReinsertion(contenu).etapes
    const rang = (t: string) => etapes.findIndex((e) => e.table === t)
    for (const t of TABLES) expect(rang(t)).toBeGreaterThan(rang('dossiers'))
    expect(etapes.find((e) => e.table === 'hausses_vues_avec_le_client')?.lignes.map((l) => l.id)).toEqual(['v1'])
    // Les deux seuils partent sur leur ligne, tels qu'ils ont été lus.
    expect(etapes.find((e) => e.table === 'seuils_du_chiffre_d_affaires')?.lignes)
      .toEqual([expect.objectContaining({ seuil_de_hausse: 20, seuil_de_baisse: 15 })])
    expect(s.liensPerdus(contenu)).toEqual([])
  })

  it('baissé : rien n’en part, et rien ne s’en dit', async () => {
    const s = await sauvegardeSous(false)
    for (const t of TABLES) {
      expect(s.planReinsertion(contenu).etapes.some((e) => e.table === t)).toBe(false)
      expect(s.ORDRE_RESTAURATION).not.toContain(t)
    }
  })
})
