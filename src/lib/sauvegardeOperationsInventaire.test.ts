import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { INVENTAIRE_PREVU, TABLES_DE_L_INVENTAIRE } from './inventaire'
import {
  auGrapheDeLInventaire, auPlanAujourdHui, auPlanDeLInventaire, CHEMINS_DOSSIER, CHEMINS_DOSSIER_PREVUS, CLES_PRIMAIRES,
  CLES_PRIMAIRES_PREVUES, LIENS_GARDES, ORDRE_RESTAURATION, ORDRE_RESTAURATION_PREVU, planExportDossier, RELATIONS,
  RELATIONS_DE_L_INVENTAIRE, RELATIONS_PREVUES, TABLES_AUTO_REFERENCEES_PAR_VAGUES, TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES,
  tablesSansChemin, violationsOrdre,
} from './sauvegarde'

// LES OPÉRATIONS D'INVENTAIRE AU PLAN DE SAUVEGARDE (ligne 35, INV2). Leur migration, `operations_d_inventaire`, est préparée,
// pas appliquée : tant qu'elle n'est pas en base, le plan effectif ne doit RIEN dire de sa table ni de la colonne qu'elle
// ajoute au brouillon — une sauvegarde lirait une table absente et échouerait —, et le plan PRÉVU doit déjà être juste,
// confronté aux clés de la migration, pour que lever `INVENTAIRE_PREVU` suffise le jour venu. Les six rôles du catalogue n'y
// entrent pas : le catalogue est hors sauvegarde.

const TABLES: readonly string[] = TABLES_DE_L_INVENTAIRE
const dossier = new URL('../../supabase/preparees/', import.meta.url).pathname
const MIGRATION = readFileSync(dossier + readdirSync(dossier).find((n) => /^\d{14}_operations_d_inventaire\.sql$/.test(n))!, 'utf8')

/** Les clés étrangères de la table de la migration, à leur action : `colonne → parent (action)`. */
function clesDeLaTable(): string[] {
  const corps = /create table public\.operations_inventaire \(([\s\S]*?)\n\);/i.exec(MIGRATION)![1]
  return [...corps.matchAll(/^\s+([a-z_]+) uuid[^,\n]* references public\.([a-z_]+)\(id\)( on delete (cascade|set null))?/gm)]
    .map(([, colonne, parent, , action]) => `${colonne} → ${parent} (${action === 'cascade' ? 'cascade' : action === 'set null' ? 'met_a_null' : 'bloque'})`)
    .sort()
}

describe('le filtre du plan, côté inventaire', () => {
  it('la table n’est au plan que le drapeau levé ; toute autre l’est toujours', () => {
    for (const table of TABLES) {
      expect(auPlanDeLInventaire(table, false), table).toBe(false)
      expect(auPlanDeLInventaire(table, true), table).toBe(true)
      expect(auPlanAujourdHui(table), table).toBe(INVENTAIRE_PREVU)
    }
    for (const table of ['dossiers', 'pieces', 'ecritures_brouillon']) expect(auPlanDeLInventaire(table, false), table).toBe(true)
  })

  it('drapeau baissé, le plan effectif ne nomme ni la table ni la colonne du brouillon', () => {
    const nommees = new Set([
      ...RELATIONS.flatMap((r) => [r.enfant, r.parent]), ...ORDRE_RESTAURATION, ...Object.keys(CHEMINS_DOSSIER),
      ...TABLES_AUTO_REFERENCEES_PAR_VAGUES.map((a) => a.table), ...Object.keys(CLES_PRIMAIRES),
    ])
    for (const table of TABLES) expect(nommees.has(table), table).toBe(INVENTAIRE_PREVU)
    expect(RELATIONS.some((r) => r.enfant === 'ecritures_brouillon' && r.colonne === 'operation_inventaire_id')).toBe(INVENTAIRE_PREVU)
  })

  it('la relation du brouillon ne vit au graphe que le drapeau levé ; toute autre y vit', () => {
    for (const r of RELATIONS_DE_L_INVENTAIRE) {
      expect(auGrapheDeLInventaire(r, false)).toBe(false)
      expect(auGrapheDeLInventaire(r, true)).toBe(true)
    }
    expect(auGrapheDeLInventaire({ enfant: 'ecritures_brouillon', colonne: 'operation_caisse_id' }, false)).toBe(true)
  })
})

describe('le plan prévu, inventaire compris', () => {
  it('la table y entre une fois : l’ordre, le chemin direct ; ni vague ni clé à part', () => {
    for (const table of TABLES) {
      expect(ORDRE_RESTAURATION_PREVU.filter((t) => t === table), table).toHaveLength(1)
      expect(CHEMINS_DOSSIER_PREVUS[table], table).toEqual({ acces: 'direct' })
      expect(TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES.filter((a) => a.table === table), table).toEqual([])
      expect(Object.keys(CLES_PRIMAIRES_PREVUES), table).not.toContain(table)
    }
  })

  it('ses relations sont les clés étrangères de la migration, à leur action ; la colonne du brouillon sans action', () => {
    const siennes = RELATIONS_PREVUES.filter((r) => r.enfant === 'operations_inventaire').map((r) => `${r.colonne} → ${r.parent} (${r.aLaSuppression})`).sort()
    expect(siennes).toEqual(clesDeLaTable())
    expect(siennes).toEqual(['dossier_id → dossiers (cascade)', 'piece_citee_id → pieces (bloque)'])
    expect(MIGRATION).toMatch(/alter table public\.ecritures_brouillon add column operation_inventaire_id uuid\n\s+constraint ecritures_brouillon_operation_inventaire_id_fkey references public\.operations_inventaire\(id\);/)
    expect(RELATIONS_PREVUES.filter((r) => r.enfant === 'ecritures_brouillon' && r.colonne === 'operation_inventaire_id'))
      .toEqual([{ enfant: 'ecritures_brouillon', parent: 'operations_inventaire', colonne: 'operation_inventaire_id', aLaSuppression: 'bloque' }])
    expect(LIENS_GARDES.some((r) => r.enfant === 'operations_inventaire')).toBe(false)
  })

  it('après les pièces, avant le brouillon et les exercices validés ; l’ordre respecte toutes les dépendances', () => {
    const rang = (t: string) => ORDRE_RESTAURATION_PREVU.indexOf(t)
    expect(rang('pieces')).toBeLessThan(rang('operations_inventaire'))
    expect(rang('operations_inventaire')).toBeLessThan(rang('ecritures_brouillon'))
    expect(rang('operations_inventaire')).toBeLessThan(rang('exercices_valides'))
    expect(violationsOrdre(ORDRE_RESTAURATION_PREVU, [...RELATIONS_PREVUES, ...LIENS_GARDES])).toEqual([])
    expect(tablesSansChemin(ORDRE_RESTAURATION_PREVU, CHEMINS_DOSSIER_PREVUS)).toEqual([])
    expect(planExportDossier(ORDRE_RESTAURATION_PREVU, CHEMINS_DOSSIER_PREVUS).map((e) => e.table)).toEqual(expect.arrayContaining([...TABLES]))
  })

  it('un défaut planté se voit : la régularisation après le brouillon qui la cite', () => {
    const sans = ORDRE_RESTAURATION_PREVU.filter((t) => t !== 'operations_inventaire')
    const apres = [...sans, 'operations_inventaire']
    expect(violationsOrdre(apres, [...RELATIONS_PREVUES, ...LIENS_GARDES]).length).toBeGreaterThan(0)
  })
})
