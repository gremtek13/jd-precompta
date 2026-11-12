import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { COPIE_DES_FICHIERS_PREVUE, TABLES_DES_COPIES_DES_FICHIERS } from './copieDesFichiers'
import {
  auPlanAujourdHui,
  auPlanDesCopiesDesFichiers,
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

// LES COPIES DES FICHIERS AU PLAN DE SAUVEGARDE (INAL6). Leur migration, `copies_des_fichiers`, est préparée, pas
// appliquée : tant que l'export ne la porte pas, le plan effectif ne dit RIEN de la table, et le plan PRÉVU est déjà juste.
// Une table de niveau cabinet : hors de l'export d'un dossier.

const TABLE = 'copies_des_fichiers'
const MIGRATION = readFileSync(new URL('../../supabase/preparees/20261112160000_copies_des_fichiers.sql', import.meta.url), 'utf8')

describe('le filtre du plan, côté copies des fichiers', () => {
  it('la table n’est au plan que le drapeau levé ; toute autre l’est toujours', () => {
    expect(TABLES_DES_COPIES_DES_FICHIERS).toEqual([TABLE])
    expect(auPlanDesCopiesDesFichiers(TABLE, false)).toBe(false)
    expect(auPlanDesCopiesDesFichiers(TABLE, true)).toBe(true)
    for (const table of ['cabinets', 'cabinet_admins', 'dossiers', 'pieces']) expect(auPlanDesCopiesDesFichiers(table, false), table).toBe(true)
    expect(auPlanAujourdHui(TABLE)).toBe(COPIE_DES_FICHIERS_PREVUE)
  })

  it('drapeau baissé, le plan effectif ne nomme pas la table', () => {
    const nommees = new Set([
      ...RELATIONS.flatMap((r) => [r.enfant, r.parent]), ...ORDRE_RESTAURATION, ...Object.keys(CHEMINS_DOSSIER), ...Object.keys(CLES_PRIMAIRES),
    ])
    expect(nommees.has(TABLE)).toBe(COPIE_DES_FICHIERS_PREVUE)
  })
})

describe('le plan prévu, copies des fichiers comprises', () => {
  it('une table du cabinet : après `cabinet_admins` et les originaux libérés, hors de l’export d’un dossier, la clé commune, sa relation, aucune vague', () => {
    const rang = ORDRE_RESTAURATION_PREVU.indexOf(TABLE)
    expect(ORDRE_RESTAURATION_PREVU.slice(rang - 2, rang)).toEqual(['cabinet_admins', 'originaux_liberes'])
    expect(ORDRE_RESTAURATION_PREVU.indexOf('dossiers')).toBeGreaterThan(rang)
    expect(CHEMINS_DOSSIER_PREVUS[TABLE]).toEqual({ acces: 'cabinet' })
    expect(CLES_PRIMAIRES_PREVUES[TABLE]).toBeUndefined()
    expect(RELATIONS_PREVUES.filter((r) => r.enfant === TABLE || r.parent === TABLE)).toEqual([
      { enfant: TABLE, parent: 'cabinets', colonne: 'cabinet_id', aLaSuppression: 'cascade' },
    ])
    expect(TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES.some((a) => a.table === TABLE)).toBe(false)
  })

  it('le plan redit la migration : la clé `id`, le cabinet en cascade, aucun dossier', () => {
    const corps = /create table public\.copies_des_fichiers \(([\s\S]*?)\n\);/i.exec(MIGRATION)?.[1] ?? ''
    expect(corps).toMatch(/\n  id uuid primary key,/)
    expect(corps).toMatch(/cabinet_id uuid not null references public\.cabinets\(id\) on delete cascade,/)
    expect(corps).not.toMatch(/dossier_id|references public\.dossiers/)
  })
})
