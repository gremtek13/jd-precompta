import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ACHATS_DU_CLIENT_PREVUS, TABLES_DES_ACHATS_DU_CLIENT } from './achatsClient'
import {
  auPlanAujourdHui, auPlanDesAchatsDuClient, CHEMINS_DOSSIER, CHEMINS_DOSSIER_PREVUS, CLES_PRIMAIRES, CLES_PRIMAIRES_PREVUES,
  LIENS_GARDES, ORDRE_RESTAURATION, ORDRE_RESTAURATION_PREVU, planExportDossier, RELATIONS, RELATIONS_PREVUES,
  TABLES_AUTO_REFERENCEES_PAR_VAGUES, TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES, tablesSansChemin, violationsOrdre,
} from './sauvegarde'

// LES ACHATS DU CLIENT AU PLAN DE SAUVEGARDE (ligne 51.5, B4). Leur migration, `achats_du_client`, est préparée, pas
// appliquée : tant que l'export ne la porte pas, le plan effectif ne doit RIEN dire de ses deux tables — une sauvegarde
// lirait une table absente et échouerait —, et le plan PRÉVU doit déjà être juste, confronté aux clés de la migration, pour
// que lever `ACHATS_DU_CLIENT_PREVUS` suffise le jour venu. Les trois colonnes neuves de `pieces` n'y changent rien : la
// sauvegarde recopie des lignes entières, et la garde de l'échéance laisse la restauration les réinsérer.

const TABLES: readonly string[] = TABLES_DES_ACHATS_DU_CLIENT
const dossier = new URL('../../supabase/preparees/', import.meta.url).pathname
const MIGRATION = readFileSync(dossier + readdirSync(dossier).find((n) => /^\d{14}_achats_du_client\.sql$/.test(n))!, 'utf8')

/** Les clés étrangères d'une table de la migration, à leur action : `colonne → parent (action)`. */
function clesDeLaMigration(table: string): string[] {
  const corps = new RegExp(`create table public\\.${table} \\(([\\s\\S]*?)\\n\\);`, 'i').exec(MIGRATION)![1]
  return [...corps.matchAll(/^\s+([a-z_]+) uuid[^,\n]* references public\.([a-z_]+) \(id\)( on delete (cascade|set null))?/gm)]
    .map(([, colonne, parent, , action]) => `${colonne} → ${parent} (${action === 'cascade' ? 'cascade' : action === 'set null' ? 'met_a_null' : 'bloque'})`)
    .sort()
}

describe('le filtre du plan, côté achats du client', () => {
  it('les tables ne sont au plan que le drapeau levé ; toute autre l’est toujours', () => {
    for (const table of TABLES) {
      expect(auPlanDesAchatsDuClient(table, false), table).toBe(false)
      expect(auPlanDesAchatsDuClient(table, true), table).toBe(true)
      expect(auPlanAujourdHui(table), table).toBe(ACHATS_DU_CLIENT_PREVUS)
    }
    for (const table of ['dossiers', 'pieces', 'piece_commentaires']) expect(auPlanDesAchatsDuClient(table, false), table).toBe(true)
  })

  it('drapeau baissé, le plan effectif ne nomme aucune des deux tables', () => {
    const nommees = new Set([
      ...RELATIONS.flatMap((r) => [r.enfant, r.parent]), ...ORDRE_RESTAURATION, ...Object.keys(CHEMINS_DOSSIER),
      ...TABLES_AUTO_REFERENCEES_PAR_VAGUES.map((a) => a.table), ...Object.keys(CLES_PRIMAIRES),
    ])
    for (const table of TABLES) expect(nommees.has(table), table).toBe(ACHATS_DU_CLIENT_PREVUS)
  })
})

describe('le plan prévu, achats du client compris', () => {
  it('chaque table y entre une fois : l’ordre, le chemin direct ; ni vague ni clé à part', () => {
    for (const table of TABLES) {
      expect(ORDRE_RESTAURATION_PREVU.filter((t) => t === table), table).toHaveLength(1)
      expect(CHEMINS_DOSSIER_PREVUS[table], table).toEqual({ acces: 'direct' })
      expect(TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES.filter((a) => a.table === table), table).toEqual([])
      expect(Object.keys(CLES_PRIMAIRES_PREVUES), table).not.toContain(table)
    }
  })

  it('leurs relations sont les clés étrangères de la migration, à leur action : la pièce et le dossier en cascade', () => {
    for (const table of TABLES) {
      const siennes = RELATIONS_PREVUES.filter((r) => r.enfant === table).map((r) => `${r.colonne} → ${r.parent} (${r.aLaSuppression})`).sort()
      expect(siennes, table).toEqual(clesDeLaMigration(table))
      expect(siennes, table).toEqual(['dossier_id → dossiers (cascade)', 'piece_id → pieces (cascade)'])
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

  it('un défaut planté se voit : une déclaration avant sa pièce', () => {
    const sans = ORDRE_RESTAURATION_PREVU.filter((t) => t !== 'paiements_declares')
    const avant = ['paiements_declares', ...sans]
    expect(violationsOrdre(avant, [...RELATIONS_PREVUES, ...LIENS_GARDES]).length).toBeGreaterThan(0)
  })
})
