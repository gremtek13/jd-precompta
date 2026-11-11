import { readdirSync, readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HONORAIRES_FACTURES_PREVUS } from './honorairesAFacturer'
import {
  auPlanAujourdHui, auPlanDesHonorairesFactures, CHEMINS_DOSSIER, CHEMINS_DOSSIER_PREVUS, CLES_PRIMAIRES, CLES_PRIMAIRES_PREVUES,
  LIENS_GARDES, ORDRE_RESTAURATION, ORDRE_RESTAURATION_PREVU, planExportDossier, RELATIONS, RELATIONS_PREVUES,
  TABLES_AUTO_REFERENCEES_PAR_VAGUES, TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES, TABLES_DES_HONORAIRES_FACTURES,
  TABLES_DES_LETTRES_DE_MISSION, tablesSansChemin, violationsOrdre,
} from './sauvegarde'

// LES FACTURES D'HONORAIRES AU PLAN DE SAUVEGARDE (ligne 47, LM7). Leur migration, `honoraires_factures`, est préparée,
// pas appliquée : tant que l'export ne la porte pas, le plan effectif ne doit RIEN dire de sa table — une sauvegarde lirait
// une table absente et échouerait —, et le plan PRÉVU doit déjà être juste, confronté aux clés de la migration, pour que
// lever `HONORAIRES_FACTURES_PREVUS` suffise le jour venu.

const TABLE = 'honoraires_factures'
const dossier = new URL('../../supabase/preparees/', import.meta.url).pathname
const MIGRATION = readFileSync(dossier + readdirSync(dossier).find((n) => /^\d{14}_honoraires_factures\.sql$/.test(n))!, 'utf8')

describe('le filtre du plan, côté factures d’honoraires', () => {
  it('la table n’est au plan que le drapeau levé ; toute autre l’est toujours', () => {
    expect(TABLES_DES_HONORAIRES_FACTURES).toEqual([TABLE])
    expect(auPlanDesHonorairesFactures(TABLE, false)).toBe(false)
    expect(auPlanDesHonorairesFactures(TABLE, true)).toBe(true)
    for (const table of ['dossiers', 'factures_emises', ...TABLES_DES_LETTRES_DE_MISSION]) expect(auPlanDesHonorairesFactures(table, false), table).toBe(true)
    expect(auPlanAujourdHui(TABLE)).toBe(HONORAIRES_FACTURES_PREVUS)
  })

  it('drapeau baissé, le plan effectif ne nomme pas la table — drapeau levé, partout', () => {
    const nommees = new Set([
      ...RELATIONS.flatMap((r) => [r.enfant, r.parent]), ...ORDRE_RESTAURATION, ...Object.keys(CHEMINS_DOSSIER),
      ...TABLES_AUTO_REFERENCEES_PAR_VAGUES.map((a) => a.table), ...Object.keys(CLES_PRIMAIRES),
    ])
    expect(nommees.has(TABLE)).toBe(HONORAIRES_FACTURES_PREVUS)
  })
})

describe('le plan prévu, factures d’honoraires comprises', () => {
  it('la table y entre : l’ordre, le chemin ; ni vague ni clé à part', () => {
    expect(ORDRE_RESTAURATION_PREVU.filter((t) => t === TABLE)).toHaveLength(1)
    expect(CHEMINS_DOSSIER_PREVUS[TABLE]).toEqual({ acces: 'direct' })
    expect(TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES.filter((a) => a.table === TABLE)).toEqual([])
    expect(Object.keys(CLES_PRIMAIRES_PREVUES)).not.toContain(TABLE)
  })

  it('ses relations sont les clés étrangères de la migration, à leur action', () => {
    const siennes = RELATIONS_PREVUES.filter((r) => r.enfant === TABLE)
      .map((r) => `${r.colonne} → ${r.parent} (${r.aLaSuppression})`).sort()
    const corps = /create table public\.honoraires_factures \(([\s\S]*?)\n\);/i.exec(MIGRATION)![1]
    const declarees = [...corps.matchAll(/^\s+([a-z_]+) uuid[^,\n]* references public\.([a-z_]+) \(id\)( on delete cascade)?/gm)]
      .map(([, colonne, parent, cascade]) => `${colonne} → ${parent} (${cascade ? 'cascade' : 'bloque'})`).sort()
    expect(declarees).toEqual(['dossier_id → dossiers (cascade)', 'facture_id → factures_emises (cascade)', 'lettre_id → lettres_de_mission (bloque)'])
    expect(siennes).toEqual(declarees)
    expect(LIENS_GARDES.some((r) => r.enfant === TABLE)).toBe(false)
  })

  it('après les lettres et les factures qu’elle cite ; l’ordre respecte toutes les dépendances', () => {
    const rang = (t: string) => ORDRE_RESTAURATION_PREVU.indexOf(t)
    expect(rang('factures_emises')).toBeLessThan(rang(TABLE))
    expect(rang('lettres_de_mission')).toBeLessThan(rang(TABLE))
    expect(violationsOrdre(ORDRE_RESTAURATION_PREVU, [...RELATIONS_PREVUES, ...LIENS_GARDES])).toEqual([])
    expect(tablesSansChemin(ORDRE_RESTAURATION_PREVU, CHEMINS_DOSSIER_PREVUS)).toEqual([])
    expect(planExportDossier(ORDRE_RESTAURATION_PREVU, CHEMINS_DOSSIER_PREVUS).map((e) => e.table)).toContain(TABLE)
  })

  it('un défaut planté se voit : le lien avant sa lettre', () => {
    const deplace = ORDRE_RESTAURATION_PREVU.filter((t) => t !== TABLE)
    deplace.splice(deplace.indexOf('lettres_de_mission'), 0, TABLE)
    expect(violationsOrdre(deplace, [...RELATIONS_PREVUES, ...LIENS_GARDES]).map((v) => `${v.enfant} → ${v.parent}`))
      .toContain('honoraires_factures → lettres_de_mission')
  })
})

describe('les factures d’honoraires dans les deux états du drapeau', () => {
  afterEach(() => {
    vi.doUnmock('./honorairesAFacturer')
    vi.doUnmock('./lettresDeMission')
    vi.resetModules()
  })

  // Le plan du jour est calculé au chargement du module : on le recharge sous l'état voulu (les lettres levées aussi :
  // la migration les suppose).
  async function sauvegardeSous(drapeau: boolean) {
    vi.resetModules()
    vi.doMock('./honorairesAFacturer', async (importOriginal) => ({
      ...(await importOriginal<typeof import('./honorairesAFacturer')>()),
      HONORAIRES_FACTURES_PREVUS: drapeau,
    }))
    vi.doMock('./lettresDeMission', async (importOriginal) => ({
      ...(await importOriginal<typeof import('./lettresDeMission')>()),
      LETTRES_DE_MISSION_PREVUES: true,
    }))
    return import('./sauvegarde')
  }

  it('levé, la table entre au plan du jour, après sa lettre ; baissé, elle en sort', async () => {
    const leve = await sauvegardeSous(true)
    expect(leve.ORDRE_RESTAURATION.indexOf('lettres_de_mission')).toBeLessThan(leve.ORDRE_RESTAURATION.indexOf(TABLE))
    expect(leve.RELATIONS.some((r) => r.enfant === TABLE && r.parent === 'factures_emises')).toBe(true)
    const baisse = await sauvegardeSous(false)
    expect(baisse.ORDRE_RESTAURATION).not.toContain(TABLE)
    expect(baisse.RELATIONS.some((r) => r.enfant === TABLE)).toBe(false)
  })
})
