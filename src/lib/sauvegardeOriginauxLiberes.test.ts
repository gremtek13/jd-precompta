import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { ORIGINAUX_RETENUS_PREVUS, TABLES_DES_ORIGINAUX_LIBERES } from './originauxRetenus'
import {
  auPlanAujourdHui,
  auPlanDesOriginauxLiberes,
  CHEMINS_DOSSIER,
  CHEMINS_DOSSIER_PREVUS,
  CLES_PRIMAIRES,
  CLES_PRIMAIRES_PREVUES,
  ORDRE_RESTAURATION,
  ORDRE_RESTAURATION_PREVU,
  RELATIONS,
  RELATIONS_PREVUES,
  TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES,
} from './sauvegarde'

// LES ORIGINAUX LIBÉRÉS PAR LA SUPPRESSION DE LEUR DOSSIER AU PLAN DE SAUVEGARDE (ligne 51.5, A8D2A-Q1). Leur migration,
// `originaux_retenus_par_leur_import`, est en production depuis le 12/11/2026, le drapeau levé : la table entre au plan
// effectif. Baissé — l'état d'avant, éprouvé tant que son code existe —, le plan effectif ne doit RIEN dire de la table :
// une sauvegarde lirait une table absente. Le plan PRÉVU la porte, à sa place. Une table de niveau cabinet : hors de
// l'export d'un dossier.

const TABLE = 'originaux_liberes'
const MIGRATION = readFileSync(
  new URL('../../supabase/schema/20261112140751_originaux_retenus_par_leur_import.sql', import.meta.url), 'utf8')

describe('le filtre du plan, côté originaux libérés', () => {
  it('la table n’est au plan que le drapeau levé ; toute autre l’est toujours', () => {
    expect(TABLES_DES_ORIGINAUX_LIBERES).toEqual([TABLE])
    expect(auPlanDesOriginauxLiberes(TABLE, false)).toBe(false)
    expect(auPlanDesOriginauxLiberes(TABLE, true)).toBe(true)
    for (const table of ['cabinets', 'cabinet_admins', 'dossiers', 'imports_factures', 'factures_importees']) {
      expect(auPlanDesOriginauxLiberes(table, false), table).toBe(true)
    }
    expect(auPlanAujourdHui(TABLE)).toBe(ORIGINAUX_RETENUS_PREVUS)
  })

  it('drapeau baissé, le plan effectif ne nomme pas la table — drapeau levé, partout', () => {
    const nommees = new Set([
      ...RELATIONS.flatMap((r) => [r.enfant, r.parent]), ...ORDRE_RESTAURATION, ...Object.keys(CHEMINS_DOSSIER),
      ...Object.keys(CLES_PRIMAIRES),
    ])
    expect(nommees.has(TABLE)).toBe(ORIGINAUX_RETENUS_PREVUS)
  })
})

describe('le plan prévu, originaux libérés compris', () => {
  it('une table du cabinet : après `cabinet_admins`, hors de l’export d’un dossier, sa clé, sa relation, aucune vague', () => {
    const rang = ORDRE_RESTAURATION_PREVU.indexOf(TABLE)
    expect(rang).toBeGreaterThan(0)
    expect(ORDRE_RESTAURATION_PREVU[rang - 1]).toBe('cabinet_admins')
    expect(ORDRE_RESTAURATION_PREVU.indexOf('cabinets')).toBeLessThan(rang)
    expect(CHEMINS_DOSSIER_PREVUS[TABLE]).toEqual({ acces: 'cabinet' })
    expect(CLES_PRIMAIRES_PREVUES[TABLE]).toEqual(['chemin'])
    expect(RELATIONS_PREVUES.filter((r) => r.enfant === TABLE || r.parent === TABLE)).toEqual([
      { enfant: TABLE, parent: 'cabinets', colonne: 'cabinet_id', aLaSuppression: 'cascade' },
    ])
    expect(TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES.some((a) => a.table === TABLE)).toBe(false)
  })

  it('le plan redit la migration : la clé `chemin`, la clé vers le cabinet en cascade, aucun dossier', () => {
    const corps = /create table public\.originaux_liberes \(([\s\S]*?)\n\);/i.exec(MIGRATION)?.[1] ?? ''
    expect(corps).toMatch(/^\s*chemin text primary key,/i)
    expect(corps).toMatch(/cabinet_id uuid not null references public\.cabinets\(id\) on delete cascade,/i)
    expect(corps).not.toMatch(/dossier_id/i)
  })
})

describe('le plan du jour, sous chaque état du drapeau', () => {
  afterEach(() => {
    vi.doUnmock('./originauxRetenus')
    vi.resetModules()
  })

  it('le drapeau levé depuis le 12/11/2026 : la table est au plan du jour', () => {
    expect(ORIGINAUX_RETENUS_PREVUS).toBe(true)
    expect(auPlanAujourdHui(TABLE)).toBe(true)
  })

  it('baissé (l’état d’avant) : le plan effectif ne nomme pas la table, et l’ordre reste juste', async () => {
    vi.resetModules()
    vi.doMock('./originauxRetenus', async (importOriginal) => ({
      ...(await importOriginal<typeof import('./originauxRetenus')>()), ORIGINAUX_RETENUS_PREVUS: false,
    }))
    const baisse = await import('./sauvegarde')
    expect(baisse.auPlanAujourdHui(TABLE)).toBe(false)
    expect(baisse.ORDRE_RESTAURATION).not.toContain(TABLE)
    expect(baisse.CHEMINS_DOSSIER[TABLE]).toBeUndefined()
    expect(baisse.RELATIONS.filter((r) => r.enfant === TABLE || r.parent === TABLE)).toEqual([])
    expect(baisse.violationsOrdre(baisse.ORDRE_RESTAURATION, [...baisse.RELATIONS, ...baisse.LIENS_GARDES])).toEqual([])
  })
})
