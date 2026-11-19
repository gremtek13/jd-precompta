import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { OPTIONS_DES_CABINETS_PREVUES, TABLES_DES_OPTIONS_DES_CABINETS } from './modulesDuCabinet'
import {
  auPlanAujourdHui,
  auPlanDesOptionsDesCabinets,
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

// LES OPTIONS DES CABINETS AU PLAN DE SAUVEGARDE (conception 56, OPT1). Leur migration, `options_des_cabinets`, est
// préparée, pas appliquée : tant que l'export ne la porte pas, le plan effectif ne doit RIEN dire de la table — une
// sauvegarde lirait une table absente —, et le plan PRÉVU doit déjà être juste, pour que lever
// `OPTIONS_DES_CABINETS_PREVUES` suffise le jour venu. Une table de niveau cabinet : hors de l'export d'un dossier
// (restaurer un dossier dans un autre cabinet ne lui donne pas les options de l'ancien, conception 56, § 7).

const TABLE = 'options_des_cabinets'
const MIGRATION = readFileSync(
  new URL('../../supabase/schema/20261119140325_options_des_cabinets.sql', import.meta.url), 'utf8')

describe('le filtre du plan, côté options des cabinets', () => {
  it('la table n’est au plan que le drapeau levé ; toute autre l’est toujours', () => {
    expect(TABLES_DES_OPTIONS_DES_CABINETS).toEqual([TABLE])
    expect(auPlanDesOptionsDesCabinets(TABLE, false)).toBe(false)
    expect(auPlanDesOptionsDesCabinets(TABLE, true)).toBe(true)
    for (const table of ['cabinets', 'cabinet_admins', 'copies_des_fichiers', 'dossiers']) {
      expect(auPlanDesOptionsDesCabinets(table, false), table).toBe(true)
    }
    expect(auPlanAujourdHui(TABLE)).toBe(OPTIONS_DES_CABINETS_PREVUES)
  })

  it('drapeau baissé, le plan effectif ne nomme pas la table — drapeau levé, partout', () => {
    const nommees = new Set([
      ...RELATIONS.flatMap((r) => [r.enfant, r.parent]), ...ORDRE_RESTAURATION, ...Object.keys(CHEMINS_DOSSIER),
      ...Object.keys(CLES_PRIMAIRES),
    ])
    expect(nommees.has(TABLE)).toBe(OPTIONS_DES_CABINETS_PREVUES)
  })
})

describe('le plan prévu, options des cabinets comprises', () => {
  it('une table du cabinet : après les copies des fichiers, avant les dossiers, hors de l’export d’un dossier, sa clé, sa relation, aucune vague', () => {
    const rang = ORDRE_RESTAURATION_PREVU.indexOf(TABLE)
    expect(ORDRE_RESTAURATION_PREVU.slice(rang - 1, rang + 2)).toEqual(['copies_des_fichiers', TABLE, 'dossiers'])
    expect(ORDRE_RESTAURATION_PREVU.indexOf('cabinets')).toBeLessThan(rang)
    expect(CHEMINS_DOSSIER_PREVUS[TABLE]).toEqual({ acces: 'cabinet' })
    expect(CLES_PRIMAIRES_PREVUES[TABLE]).toEqual(['cabinet_id', 'module'])
    expect(RELATIONS_PREVUES.filter((r) => r.enfant === TABLE || r.parent === TABLE)).toEqual([
      { enfant: TABLE, parent: 'cabinets', colonne: 'cabinet_id', aLaSuppression: 'cascade' },
    ])
    expect(TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES.some((a) => a.table === TABLE)).toBe(false)
  })

  it('le plan redit la migration : le cabinet en cascade, la clé (cabinet, module), aucun dossier', () => {
    const corps = /create table public\.options_des_cabinets \(([\s\S]*?)\n\);/i.exec(MIGRATION)?.[1] ?? ''
    expect(corps).toMatch(/cabinet_id uuid not null references public\.cabinets \(id\) on delete cascade,/)
    expect(corps).toMatch(/constraint options_des_cabinets_pkey primary key \(cabinet_id, module\),/)
    expect(corps).not.toMatch(/dossier_id|references public\.dossiers/)
  })
})
