import { readdirSync, readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEPOT_DES_HONORAIRES_PREVU } from './depotDesHonoraires'
import {
  auPlanAujourdHui, auPlanDesHonorairesDeposes, CHEMINS_DOSSIER, CHEMINS_DOSSIER_PREVUS, CLES_PRIMAIRES, CLES_PRIMAIRES_PREVUES,
  LIENS_GARDES, ORDRE_RESTAURATION, ORDRE_RESTAURATION_PREVU, planExportDossier, RELATIONS, RELATIONS_PREVUES,
  TABLES_AUTO_REFERENCEES_PAR_VAGUES, TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES, TABLES_DES_HONORAIRES_DEPOSES,
  TABLES_DES_HONORAIRES_FACTURES, tablesSansChemin, violationsOrdre,
} from './sauvegarde'

// LE DÉPÔT DES FACTURES D'HONORAIRES AU PLAN DE SAUVEGARDE (ligne 47, LM8). Sa migration, `depot_des_honoraires`, est en
// production depuis le 12/11/2026, le drapeau levé. Baissé — l'état d'avant, joué plus bas —, le plan effectif ne doit RIEN
// dire de sa table : une sauvegarde lirait une table absente et échouerait. Le plan PRÉVU est confronté aux clés de la
// migration.

const TABLE = 'honoraires_deposes'
const dossier = new URL('../../supabase/schema/', import.meta.url).pathname
const MIGRATION = readFileSync(dossier + readdirSync(dossier).find((n) => /^\d{14}_depot_des_honoraires\.sql$/.test(n))!, 'utf8')

describe('le filtre du plan, côté dépôt des honoraires', () => {
  it('la table n’est au plan que le drapeau levé ; toute autre l’est toujours', () => {
    expect(TABLES_DES_HONORAIRES_DEPOSES).toEqual([TABLE])
    expect(auPlanDesHonorairesDeposes(TABLE, false)).toBe(false)
    expect(auPlanDesHonorairesDeposes(TABLE, true)).toBe(true)
    for (const table of ['dossiers', 'factures_emises', 'pieces', ...TABLES_DES_HONORAIRES_FACTURES]) {
      expect(auPlanDesHonorairesDeposes(table, false), table).toBe(true)
    }
    expect(auPlanAujourdHui(TABLE)).toBe(DEPOT_DES_HONORAIRES_PREVU)
  })

  it('drapeau baissé, le plan effectif ne nomme pas la table — drapeau levé, partout', () => {
    const nommees = new Set([
      ...RELATIONS.flatMap((r) => [r.enfant, r.parent]), ...ORDRE_RESTAURATION, ...Object.keys(CHEMINS_DOSSIER),
      ...TABLES_AUTO_REFERENCEES_PAR_VAGUES.map((a) => a.table), ...Object.keys(CLES_PRIMAIRES),
    ])
    expect(nommees.has(TABLE)).toBe(DEPOT_DES_HONORAIRES_PREVU)
  })
})

describe('le plan prévu, dépôt des honoraires compris', () => {
  it('la table y entre : l’ordre, le chemin ; ni vague ni clé à part', () => {
    expect(ORDRE_RESTAURATION_PREVU.filter((t) => t === TABLE)).toHaveLength(1)
    expect(CHEMINS_DOSSIER_PREVUS[TABLE]).toEqual({ acces: 'direct' })
    expect(TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES.filter((a) => a.table === TABLE)).toEqual([])
    expect(Object.keys(CLES_PRIMAIRES_PREVUES)).not.toContain(TABLE)
  })

  it('ses relations sont les clés étrangères de la migration, à leur action ; le client et sa pièce, sans clé', () => {
    const siennes = RELATIONS_PREVUES.filter((r) => r.enfant === TABLE)
      .map((r) => `${r.colonne} → ${r.parent} (${r.aLaSuppression})`).sort()
    const corps = /create table public\.honoraires_deposes \(([\s\S]*?)\n\);/i.exec(MIGRATION)![1]
    const declarees = [...corps.matchAll(/^\s+([a-z_]+) uuid[^,\n]* references public\.([a-z_]+) \(id\)( on delete cascade)?/gm)]
      .map(([, colonne, parent, cascade]) => `${colonne} → ${parent} (${cascade ? 'cascade' : 'bloque'})`).sort()
    expect(declarees).toEqual(['dossier_id → dossiers (cascade)', 'facture_id → factures_emises (bloque)'])
    expect(siennes).toEqual(declarees)
    expect(corps).toMatch(/^\s+dossier_client_id uuid not null,$/m)
    expect(corps).toMatch(/^\s+piece_id uuid not null,$/m)
    expect(LIENS_GARDES.some((r) => r.enfant === TABLE)).toBe(false)
  })

  it('après les factures d’honoraires et les factures ; l’ordre respecte toutes les dépendances', () => {
    const rang = (t: string) => ORDRE_RESTAURATION_PREVU.indexOf(t)
    expect(rang('factures_emises')).toBeLessThan(rang(TABLE))
    expect(rang('honoraires_factures')).toBeLessThan(rang(TABLE))
    expect(violationsOrdre(ORDRE_RESTAURATION_PREVU, [...RELATIONS_PREVUES, ...LIENS_GARDES])).toEqual([])
    expect(tablesSansChemin(ORDRE_RESTAURATION_PREVU, CHEMINS_DOSSIER_PREVUS)).toEqual([])
    expect(planExportDossier(ORDRE_RESTAURATION_PREVU, CHEMINS_DOSSIER_PREVUS).map((e) => e.table)).toContain(TABLE)
  })

  it('un défaut planté se voit : le dépôt avant sa facture', () => {
    const deplace = ORDRE_RESTAURATION_PREVU.filter((t) => t !== TABLE)
    deplace.splice(deplace.indexOf('factures_emises'), 0, TABLE)
    expect(violationsOrdre(deplace, [...RELATIONS_PREVUES, ...LIENS_GARDES]).map((v) => `${v.enfant} → ${v.parent}`))
      .toContain('honoraires_deposes → factures_emises')
  })
})

describe('le dépôt des honoraires dans les deux états du drapeau', () => {
  afterEach(() => {
    vi.doUnmock('./depotDesHonoraires')
    vi.doUnmock('./honorairesAFacturer')
    vi.doUnmock('./lettresDeMission')
    vi.resetModules()
  })

  // Le plan du jour est calculé au chargement du module : on le recharge sous l'état voulu (les lettres et les factures
  // d'honoraires levées aussi : la migration les suppose).
  async function sauvegardeSous(drapeau: boolean) {
    vi.resetModules()
    vi.doMock('./depotDesHonoraires', async (importOriginal) => ({
      ...(await importOriginal<typeof import('./depotDesHonoraires')>()),
      DEPOT_DES_HONORAIRES_PREVU: drapeau,
    }))
    vi.doMock('./honorairesAFacturer', async (importOriginal) => ({
      ...(await importOriginal<typeof import('./honorairesAFacturer')>()),
      HONORAIRES_FACTURES_PREVUS: true,
    }))
    vi.doMock('./lettresDeMission', async (importOriginal) => ({
      ...(await importOriginal<typeof import('./lettresDeMission')>()),
      LETTRES_DE_MISSION_PREVUES: true,
    }))
    return import('./sauvegarde')
  }

  it('levé, la table entre au plan du jour, après les factures d’honoraires ; baissé, elle en sort', async () => {
    const leve = await sauvegardeSous(true)
    expect(leve.ORDRE_RESTAURATION.indexOf('honoraires_factures')).toBeLessThan(leve.ORDRE_RESTAURATION.indexOf(TABLE))
    expect(leve.RELATIONS.some((r) => r.enfant === TABLE && r.parent === 'factures_emises')).toBe(true)
    const baisse = await sauvegardeSous(false)
    expect(baisse.ORDRE_RESTAURATION).not.toContain(TABLE)
    expect(baisse.ORDRE_RESTAURATION).toContain('honoraires_factures')
    expect(baisse.RELATIONS.some((r) => r.enfant === TABLE)).toBe(false)
  })
})
