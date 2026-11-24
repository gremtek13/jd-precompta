import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { REGLAGES_D_EXPORT_PREVUS, TABLES_DES_REGLAGES_D_EXPORT } from './reglagesDExport'
import {
  auPlanAujourdHui, auPlanDesReglagesDExport, CHEMINS_DOSSIER, CHEMINS_DOSSIER_PREVUS, CLES_PRIMAIRES, CLES_PRIMAIRES_PREVUES,
  LIENS_GARDES, ORDRE_RESTAURATION, ORDRE_RESTAURATION_PREVU, planExportDossier, RELATIONS, RELATIONS_PREVUES,
  TABLES_AUTO_REFERENCEES, TABLES_AUTO_REFERENCEES_PAR_VAGUES, TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES, tablesSansChemin,
  violationsOrdre,
} from './sauvegarde'

// LES RÉGLAGES DE L'EXPORT VERS UN LOGICIEL COMPTABLE AU PLAN DE SAUVEGARDE (EXP-Q4 (A)). Leur migration, `reglages_d_export`,
// est préparée, pas appliquée : tant que la base ne la porte pas, le plan effectif ne dit RIEN de sa table — une sauvegarde
// lirait une table absente et échouerait —, et le plan PRÉVU est déjà juste, confronté aux clés de la migration, pour que la
// ranger dans supabase/schema/ et lever `REGLAGES_D_EXPORT_PREVUS` suffisent le jour venu. La migration se lit là où elle est :
// préparée, ou rangée dans l'export — ce test passe dans les deux états, et la simulation du drapeau levé (24/11/2026) l'a joué
// ainsi.

const TABLES: readonly string[] = TABLES_DES_REGLAGES_D_EXPORT
const NOM = /^\d{14}_reglages_d_export\.sql$/
const ou = (dossier: string) => {
  const chemin = new URL(`../../supabase/${dossier}/`, import.meta.url).pathname
  const nom = readdirSync(chemin).find((n) => NOM.test(n))
  return nom ? chemin + nom : null
}
const PREPAREE = ou('preparees')
const RANGEE = ou('schema')
const MIGRATION = readFileSync((RANGEE ?? PREPAREE)!, 'utf8')

/** Les clés étrangères de la table de la migration, à leur action : `colonne → parent (action)`. */
function clesDeLaTable(table: string): string[] {
  const corps = new RegExp(`create table public\\.${table} \\(([\\s\\S]*?)\\n\\);`, 'i').exec(MIGRATION)![1]
  return [...corps.matchAll(/^\s+([a-z_]+) uuid[^,\n]* references public\.([a-z_]+) ?\(id\)( on delete (cascade|set null))?/gm)]
    .map(([, colonne, parent, , action]) => `${colonne} → ${parent} (${action === 'cascade' ? 'cascade' : action === 'set null' ? 'met_a_null' : 'bloque'})`)
    .sort()
}

describe('la migration, préparée ou rangée, et le drapeau', () => {
  it('elle est à un seul endroit ; rangée dans l’export, le drapeau est levé ; préparée, il est baissé', () => {
    expect([PREPAREE, RANGEE].filter((c) => c !== null)).toHaveLength(1)
    expect(REGLAGES_D_EXPORT_PREVUS).toBe(RANGEE !== null)
  })

  it('elle crée la seule table que le plan déclare', () => {
    expect([...MIGRATION.matchAll(/^create\s+table\s+public\.([a-z_]+)\s*\(/gim)].map((m) => m[1])).toEqual([...TABLES])
  })
})

describe('le filtre du plan, côté réglages d’export', () => {
  it('la table n’est au plan que le drapeau levé ; toute autre l’est toujours', () => {
    for (const table of TABLES) {
      expect(auPlanDesReglagesDExport(table, false), table).toBe(false)
      expect(auPlanDesReglagesDExport(table, true), table).toBe(true)
      expect(auPlanAujourdHui(table), table).toBe(REGLAGES_D_EXPORT_PREVUS)
    }
    for (const table of ['dossiers', 'pieces', 'seuils_du_chiffre_d_affaires', 'hausses_vues_avec_le_client']) {
      expect(auPlanDesReglagesDExport(table, false), table).toBe(true)
    }
  })

  it('le plan effectif ne nomme la table que le drapeau levé', () => {
    const nommees = new Set([
      ...RELATIONS.flatMap((r) => [r.enfant, r.parent]), ...ORDRE_RESTAURATION, ...Object.keys(CHEMINS_DOSSIER),
      ...TABLES_AUTO_REFERENCEES_PAR_VAGUES.map((a) => a.table), ...Object.keys(CLES_PRIMAIRES),
    ])
    for (const table of TABLES) expect(nommees.has(table), table).toBe(REGLAGES_D_EXPORT_PREVUS)
  })
})

describe('le plan prévu, réglages d’export compris', () => {
  it('la table y entre une fois : l’ordre, le chemin direct ; ni vague, ni seconde passe, ni clé à part', () => {
    for (const table of TABLES) {
      expect(ORDRE_RESTAURATION_PREVU.filter((t) => t === table), table).toHaveLength(1)
      expect(CHEMINS_DOSSIER_PREVUS[table], table).toEqual({ acces: 'direct' })
      expect(TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES.filter((a) => a.table === table), table).toEqual([])
      expect(TABLES_AUTO_REFERENCEES.filter((a) => a.table === table), table).toEqual([])
      expect(Object.keys(CLES_PRIMAIRES_PREVUES), table).not.toContain(table)
    }
    // Aucune auto-référence dans la migration : une version se réécrit en place, elle ne cite pas celle qu'elle remplace.
    expect(MIGRATION).not.toMatch(/remplace_id\s+uuid/)
  })

  it('ses relations sont les clés étrangères de la migration, à leur action', () => {
    const siennes = RELATIONS_PREVUES.filter((r) => TABLES.includes(r.enfant))
      .map((r) => `${r.colonne} → ${r.parent} (${r.aLaSuppression})`).sort()
    expect(siennes).toEqual(clesDeLaTable('reglages_d_export'))
    expect(siennes).toEqual(['dossier_id → dossiers (cascade)'])
    expect(RELATIONS_PREVUES.some((r) => TABLES.includes(r.parent))).toBe(false)
    expect(LIENS_GARDES.some((r) => TABLES.includes(r.enfant) || TABLES.includes(r.parent))).toBe(false)
  })

  it('juste après les marques de l’alerte du chiffre d’affaires, après le dossier', () => {
    const rang = (t: string) => ORDRE_RESTAURATION_PREVU.indexOf(t)
    expect(ORDRE_RESTAURATION_PREVU[rang('reglages_d_export') - 1]).toBe('hausses_vues_avec_le_client')
    expect(rang('dossiers')).toBeLessThan(rang('reglages_d_export'))
    expect(violationsOrdre(ORDRE_RESTAURATION_PREVU, [...RELATIONS_PREVUES, ...LIENS_GARDES])).toEqual([])
    expect(tablesSansChemin(ORDRE_RESTAURATION_PREVU, CHEMINS_DOSSIER_PREVUS)).toEqual([])
    expect(planExportDossier(ORDRE_RESTAURATION_PREVU, CHEMINS_DOSSIER_PREVUS).map((e) => e.table)).toEqual(expect.arrayContaining([...TABLES]))
  })

  it('l’ordre du jour est le plan prévu filtré par le drapeau', () => {
    expect(ORDRE_RESTAURATION).toEqual(ORDRE_RESTAURATION_PREVU.filter((t) => auPlanAujourdHui(t)))
    expect(ORDRE_RESTAURATION.includes('reglages_d_export')).toBe(REGLAGES_D_EXPORT_PREVUS)
  })

  it('un défaut planté se voit : la table avant son dossier', () => {
    const sans = ORDRE_RESTAURATION_PREVU.filter((t) => t !== 'reglages_d_export')
    const avant = ['reglages_d_export', ...sans]
    expect(violationsOrdre(avant, [...RELATIONS_PREVUES, ...LIENS_GARDES]).map((v) => `${v.enfant} → ${v.parent}`))
      .toContain('reglages_d_export → dossiers')
  })
})
