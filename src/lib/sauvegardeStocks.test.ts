import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { STOCKS_PREVUS, TABLES_DES_STOCKS } from './stocks'
import {
  auGrapheDesStocks, auPlanAujourdHui, auPlanDesStocks, CHEMINS_DOSSIER, CHEMINS_DOSSIER_PREVUS, CLES_PRIMAIRES,
  CLES_PRIMAIRES_PREVUES, LIENS_GARDES, ORDRE_RESTAURATION, ORDRE_RESTAURATION_PREVU, planExportDossier, RELATIONS,
  RELATIONS_PREVUES, TABLES_AUTO_REFERENCEES_PAR_VAGUES, TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES, tablesSansChemin,
  violationsOrdre,
} from './sauvegarde'

// LES STOCKS DE CLÔTURE AU PLAN DE SAUVEGARDE (ligne 36, LIA2). Leur migration, `stocks_de_cloture`, est préparée, pas
// appliquée : tant que la base ne la porte pas, le plan effectif ne dit RIEN de sa table ni de la colonne du brouillon qui
// la cite — une sauvegarde lirait une table absente et échouerait —, et le plan PRÉVU est déjà juste, confronté aux clés de
// la migration, pour que lever `STOCKS_PREVUS` suffise le jour venu.

const TABLES: readonly string[] = TABLES_DES_STOCKS
const dossier = new URL('../../supabase/preparees/', import.meta.url).pathname
const MIGRATION = readFileSync(dossier + readdirSync(dossier).find((n) => /^\d{14}_stocks_de_cloture\.sql$/.test(n))!, 'utf8')

/** Les clés étrangères de la table de la migration, à leur action : `colonne → parent (action)`. */
function clesDeLaTable(table: string): string[] {
  const corps = new RegExp(`create table public\\.${table} \\(([\\s\\S]*?)\\n\\);`, 'i').exec(MIGRATION)![1]
  return [...corps.matchAll(/^\s+([a-z_]+) uuid[^,\n]* references public\.([a-z_]+) \(id\)( on delete (cascade|set null))?/gm)]
    .map(([, colonne, parent, , action]) => `${colonne} → ${parent} (${action === 'cascade' ? 'cascade' : action === 'set null' ? 'met_a_null' : 'bloque'})`)
    .sort()
}

describe('le filtre du plan, côté stocks de clôture', () => {
  it('la table n’est au plan que le drapeau levé ; toute autre l’est toujours', () => {
    for (const table of TABLES) {
      expect(auPlanDesStocks(table, false), table).toBe(false)
      expect(auPlanDesStocks(table, true), table).toBe(true)
      expect(auPlanAujourdHui(table), table).toBe(STOCKS_PREVUS)
    }
    for (const table of ['dossiers', 'ecritures_brouillon', 'exercices_valides']) expect(auPlanDesStocks(table, false), table).toBe(true)
  })

  it('drapeau baissé, le plan effectif ne nomme ni la table ni la colonne du brouillon qui la cite', () => {
    const nommees = new Set([
      ...RELATIONS.flatMap((r) => [r.enfant, r.parent]), ...ORDRE_RESTAURATION, ...Object.keys(CHEMINS_DOSSIER),
      ...TABLES_AUTO_REFERENCEES_PAR_VAGUES.map((a) => a.table), ...Object.keys(CLES_PRIMAIRES),
    ])
    for (const table of TABLES) expect(nommees.has(table), table).toBe(STOCKS_PREVUS)
    expect(RELATIONS.some((r) => r.colonne === 'stock_de_cloture_id')).toBe(STOCKS_PREVUS)
    const brouillon = { enfant: 'ecritures_brouillon', parent: 'stocks_de_cloture' }
    expect(auGrapheDesStocks(brouillon, false)).toBe(false)
    expect(auGrapheDesStocks(brouillon, true)).toBe(true)
    expect(auGrapheDesStocks({ enfant: 'ecritures_brouillon', parent: 'pieces' }, false)).toBe(true)
  })
})

describe('le plan prévu, stocks de clôture compris', () => {
  it('la table y entre une fois : l’ordre, le chemin direct ; ni vague ni clé à part', () => {
    for (const table of TABLES) {
      expect(ORDRE_RESTAURATION_PREVU.filter((t) => t === table), table).toHaveLength(1)
      expect(CHEMINS_DOSSIER_PREVUS[table], table).toEqual({ acces: 'direct' })
      expect(TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES.filter((a) => a.table === table), table).toEqual([])
      expect(Object.keys(CLES_PRIMAIRES_PREVUES), table).not.toContain(table)
    }
  })

  it('ses relations sont les clés étrangères de la migration, à leur action, et celle de la colonne du brouillon', () => {
    const siennes = RELATIONS_PREVUES.filter((r) => r.enfant === 'stocks_de_cloture')
      .map((r) => `${r.colonne} → ${r.parent} (${r.aLaSuppression})`).sort()
    expect(siennes).toEqual(clesDeLaTable('stocks_de_cloture'))
    expect(siennes).toEqual(['dossier_id → dossiers (cascade)', 'piece_citee_id → pieces (bloque)'])
    expect(MIGRATION).toContain(
      'alter table public.ecritures_brouillon add column stock_de_cloture_id uuid references public.stocks_de_cloture (id);')
    expect(RELATIONS_PREVUES.filter((r) => r.colonne === 'stock_de_cloture_id')).toEqual([
      { enfant: 'ecritures_brouillon', parent: 'stocks_de_cloture', colonne: 'stock_de_cloture_id', aLaSuppression: 'bloque' }])
    expect(LIENS_GARDES.some((r) => r.enfant === 'stocks_de_cloture')).toBe(false)
  })

  it('après les pièces, avant le brouillon et les exercices validés ; l’ordre respecte toutes les dépendances', () => {
    const rang = (t: string) => ORDRE_RESTAURATION_PREVU.indexOf(t)
    expect(rang('pieces')).toBeLessThan(rang('stocks_de_cloture'))
    expect(rang('stocks_de_cloture')).toBeLessThan(rang('ecritures_brouillon'))
    expect(rang('stocks_de_cloture')).toBeLessThan(rang('exercices_valides'))
    expect(violationsOrdre(ORDRE_RESTAURATION_PREVU, [...RELATIONS_PREVUES, ...LIENS_GARDES])).toEqual([])
    expect(tablesSansChemin(ORDRE_RESTAURATION_PREVU, CHEMINS_DOSSIER_PREVUS)).toEqual([])
    expect(planExportDossier(ORDRE_RESTAURATION_PREVU, CHEMINS_DOSSIER_PREVUS).map((e) => e.table)).toEqual(expect.arrayContaining([...TABLES]))
  })

  it('un défaut planté se voit : le stock après le brouillon qui le cite', () => {
    const sans = ORDRE_RESTAURATION_PREVU.filter((t) => t !== 'stocks_de_cloture')
    expect(violationsOrdre([...sans, 'stocks_de_cloture'], [...RELATIONS_PREVUES, ...LIENS_GARDES]).length).toBeGreaterThan(0)
  })
})
