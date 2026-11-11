import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { NOTES_DE_FRAIS_PREVUES, TABLES_DES_NOTES_DE_FRAIS } from './notesDeFrais'
import {
  auPlanAujourdHui, auPlanDesNotesDeFrais, CHEMINS_DOSSIER, CHEMINS_DOSSIER_PREVUS, CLES_PRIMAIRES, CLES_PRIMAIRES_PREVUES,
  LIENS_GARDES, ORDRE_RESTAURATION, ORDRE_RESTAURATION_PREVU, planExportDossier, RELATIONS, RELATIONS_PREVUES,
  TABLES_AUTO_REFERENCEES_PAR_VAGUES, TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES, tablesSansChemin, violationsOrdre,
} from './sauvegarde'

// LES NOTES DE FRAIS AU PLAN DE SAUVEGARDE (ligne 51.5, B7). Leur migration, `notes_de_frais`, est préparée, pas
// appliquée : tant que l'export ne la porte pas, le plan effectif ne doit RIEN dire de sa table — une sauvegarde lirait une
// table absente et échouerait —, et le plan PRÉVU doit déjà être juste, confronté aux clés de la migration, pour que lever
// `NOTES_DE_FRAIS_PREVUES` suffise le jour venu. Le rôle `personnel` du catalogue n'y entre pas : le catalogue est hors
// sauvegarde (`PARENTS_HORS_PLAN_VOULUS`).

const TABLES: readonly string[] = TABLES_DES_NOTES_DE_FRAIS
const dossier = new URL('../../supabase/preparees/', import.meta.url).pathname
const MIGRATION = readFileSync(dossier + readdirSync(dossier).find((n) => /^\d{14}_notes_de_frais\.sql$/.test(n))!, 'utf8')

/** Les clés étrangères d'une table de la migration, à leur action : `colonne → parent (action)`. */
function clesDeLaMigration(table: string): string[] {
  const corps = new RegExp(`create table public\\.${table} \\(([\\s\\S]*?)\\n\\);`, 'i').exec(MIGRATION)![1]
  return [...corps.matchAll(/^\s+([a-z_]+) uuid[^,\n]* references public\.([a-z_]+) \(id\)( on delete (cascade|set null))?/gm)]
    .map(([, colonne, parent, , action]) => `${colonne} → ${parent} (${action === 'cascade' ? 'cascade' : action === 'set null' ? 'met_a_null' : 'bloque'})`)
    .sort()
}

describe('le filtre du plan, côté notes de frais', () => {
  it('les tables ne sont au plan que le drapeau levé ; toute autre l’est toujours', () => {
    for (const table of TABLES) {
      expect(auPlanDesNotesDeFrais(table, false), table).toBe(false)
      expect(auPlanDesNotesDeFrais(table, true), table).toBe(true)
      expect(auPlanAujourdHui(table), table).toBe(NOTES_DE_FRAIS_PREVUES)
    }
    for (const table of ['dossiers', 'pieces', 'piece_commentaires']) expect(auPlanDesNotesDeFrais(table, false), table).toBe(true)
  })

  it('drapeau baissé, le plan effectif ne nomme pas la table', () => {
    const nommees = new Set([
      ...RELATIONS.flatMap((r) => [r.enfant, r.parent]), ...ORDRE_RESTAURATION, ...Object.keys(CHEMINS_DOSSIER),
      ...TABLES_AUTO_REFERENCEES_PAR_VAGUES.map((a) => a.table), ...Object.keys(CLES_PRIMAIRES),
    ])
    for (const table of TABLES) expect(nommees.has(table), table).toBe(NOTES_DE_FRAIS_PREVUES)
  })
})

describe('le plan prévu, notes de frais comprises', () => {
  it('chaque table y entre une fois : l’ordre, le chemin direct ; ni vague ni clé à part', () => {
    for (const table of TABLES) {
      expect(ORDRE_RESTAURATION_PREVU.filter((t) => t === table), table).toHaveLength(1)
      expect(CHEMINS_DOSSIER_PREVUS[table], table).toEqual({ acces: 'direct' })
      expect(TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES.filter((a) => a.table === table), table).toEqual([])
      expect(Object.keys(CLES_PRIMAIRES_PREVUES), table).not.toContain(table)
    }
  })

  it('ses relations sont les clés étrangères de la migration, à leur action : le dossier en cascade, le justificatif bloque', () => {
    for (const table of TABLES) {
      const siennes = RELATIONS_PREVUES.filter((r) => r.enfant === table).map((r) => `${r.colonne} → ${r.parent} (${r.aLaSuppression})`).sort()
      expect(siennes, table).toEqual(clesDeLaMigration(table))
      expect(siennes, table).toEqual(['dossier_id → dossiers (cascade)', 'piece_id → pieces (bloque)'])
      expect(LIENS_GARDES.some((r) => r.enfant === table), table).toBe(false)
    }
  })

  it('après les pièces ; l’ordre respecte toutes les dépendances', () => {
    const rang = (t: string) => ORDRE_RESTAURATION_PREVU.indexOf(t)
    for (const table of TABLES) expect(rang('pieces'), table).toBeLessThan(rang(table))
    expect(violationsOrdre(ORDRE_RESTAURATION_PREVU, [...RELATIONS_PREVUES, ...LIENS_GARDES])).toEqual([])
    expect(tablesSansChemin(ORDRE_RESTAURATION_PREVU, CHEMINS_DOSSIER_PREVUS)).toEqual([])
    expect(planExportDossier(ORDRE_RESTAURATION_PREVU, CHEMINS_DOSSIER_PREVUS).map((e) => e.table)).toEqual(expect.arrayContaining([...TABLES]))
  })

  it('un défaut planté se voit : une note avant son justificatif', () => {
    const sans = ORDRE_RESTAURATION_PREVU.filter((t) => t !== 'notes_de_frais')
    const avant = ['notes_de_frais', ...sans]
    expect(violationsOrdre(avant, [...RELATIONS_PREVUES, ...LIENS_GARDES]).length).toBeGreaterThan(0)
  })
})
