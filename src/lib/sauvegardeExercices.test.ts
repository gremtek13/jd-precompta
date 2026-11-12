import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { EXERCICES_DECALES_PREVUS, TABLES_DES_EXERCICES } from './exercices'
import {
  auPlanAujourdHui, auPlanDesExercices, CHEMINS_DOSSIER, CHEMINS_DOSSIER_PREVUS, CLES_PRIMAIRES, CLES_PRIMAIRES_PREVUES,
  LIENS_GARDES, ORDRE_RESTAURATION, ORDRE_RESTAURATION_PREVU, planExportDossier, RELATIONS, RELATIONS_PREVUES,
  TABLES_AUTO_REFERENCEES_PAR_VAGUES, TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES, tablesSansChemin, violationsOrdre,
} from './sauvegarde'

// LES EXERCICES DÉCLARÉS AU PLAN DE SAUVEGARDE (ligne 42, EXD2). Leur migration, `exercices_du_dossier`, est préparée, pas
// appliquée : tant que l'export ne la porte pas, le plan effectif ne doit RIEN dire de sa table — une sauvegarde lirait une
// table absente et échouerait —, et le plan PRÉVU doit déjà être juste, confronté aux clés de la migration, pour que lever
// `EXERCICES_DECALES_PREVUS` suffise le jour venu.

const TABLES: readonly string[] = TABLES_DES_EXERCICES
const dossier = new URL('../../supabase/preparees/', import.meta.url).pathname
const MIGRATION = readFileSync(dossier + readdirSync(dossier).find((n) => /^\d{14}_exercices_du_dossier\.sql$/.test(n))!, 'utf8')

/** Les clés étrangères d'une table de la migration, à leur action : `colonne → parent (action)`. */
function clesDeLaMigration(table: string): string[] {
  const corps = new RegExp(`create table public\\.${table} \\(([\\s\\S]*?)\\n\\);`, 'i').exec(MIGRATION)![1]
  return [...corps.matchAll(/^\s+([a-z_]+) uuid[^,\n]* references public\.([a-z_]+) \(id\)( on delete (cascade|set null))?/gm)]
    .map(([, colonne, parent, , action]) => `${colonne} → ${parent} (${action === 'cascade' ? 'cascade' : action === 'set null' ? 'met_a_null' : 'bloque'})`)
    .sort()
}

describe('le filtre du plan, côté exercices déclarés', () => {
  it('la table n’est au plan que le drapeau levé ; toute autre l’est toujours', () => {
    for (const table of TABLES) {
      expect(auPlanDesExercices(table, false), table).toBe(false)
      expect(auPlanDesExercices(table, true), table).toBe(true)
      expect(auPlanAujourdHui(table), table).toBe(EXERCICES_DECALES_PREVUS)
    }
    for (const table of ['dossiers', 'exercices_valides', 'exercices_clotures']) expect(auPlanDesExercices(table, false), table).toBe(true)
  })

  it('drapeau baissé, le plan effectif ne nomme pas la table', () => {
    const nommees = new Set([
      ...RELATIONS.flatMap((r) => [r.enfant, r.parent]), ...ORDRE_RESTAURATION, ...Object.keys(CHEMINS_DOSSIER),
      ...TABLES_AUTO_REFERENCEES_PAR_VAGUES.map((a) => a.table), ...Object.keys(CLES_PRIMAIRES),
    ])
    for (const table of TABLES) expect(nommees.has(table), table).toBe(EXERCICES_DECALES_PREVUS)
  })
})

describe('le plan prévu, exercices déclarés compris', () => {
  it('la table y entre une fois : l’ordre, le chemin direct ; ni vague ni clé à part', () => {
    for (const table of TABLES) {
      expect(ORDRE_RESTAURATION_PREVU.filter((t) => t === table), table).toHaveLength(1)
      expect(CHEMINS_DOSSIER_PREVUS[table], table).toEqual({ acces: 'direct' })
      expect(TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES.filter((a) => a.table === table), table).toEqual([])
      expect(Object.keys(CLES_PRIMAIRES_PREVUES), table).not.toContain(table)
    }
  })

  it('ses relations sont les clés étrangères de la migration, à leur action : le dossier en cascade', () => {
    for (const table of TABLES) {
      const siennes = RELATIONS_PREVUES.filter((r) => r.enfant === table).map((r) => `${r.colonne} → ${r.parent} (${r.aLaSuppression})`).sort()
      expect(siennes, table).toEqual(clesDeLaMigration(table))
      expect(siennes, table).toEqual(['dossier_id → dossiers (cascade)'])
      expect(LIENS_GARDES.some((r) => r.enfant === table), table).toBe(false)
    }
  })

  it('juste après le dossier, bien avant les exercices validés ; l’ordre respecte toutes les dépendances', () => {
    const rang = ORDRE_RESTAURATION_PREVU.indexOf('dossiers')
    expect(ORDRE_RESTAURATION_PREVU.slice(rang, rang + 2)).toEqual(['dossiers', ...TABLES])
    for (const datee of ['pieces', 'lignes_bancaires', 'ecritures_brouillon', 'a_nouveaux', 'exercices_valides']) {
      expect(ORDRE_RESTAURATION_PREVU.indexOf('exercices'), datee).toBeLessThan(ORDRE_RESTAURATION_PREVU.indexOf(datee))
    }
    expect(violationsOrdre(ORDRE_RESTAURATION_PREVU, [...RELATIONS_PREVUES, ...LIENS_GARDES])).toEqual([])
    expect(tablesSansChemin(ORDRE_RESTAURATION_PREVU, CHEMINS_DOSSIER_PREVUS)).toEqual([])
    expect(planExportDossier(ORDRE_RESTAURATION_PREVU, CHEMINS_DOSSIER_PREVUS).map((e) => e.table)).toEqual(expect.arrayContaining([...TABLES]))
  })

  it('un défaut planté se voit : les exercices avant leur dossier', () => {
    const sans = ORDRE_RESTAURATION_PREVU.filter((t) => t !== 'exercices')
    expect(violationsOrdre(['exercices', ...sans], [...RELATIONS_PREVUES, ...LIENS_GARDES]).length).toBeGreaterThan(0)
  })
})
