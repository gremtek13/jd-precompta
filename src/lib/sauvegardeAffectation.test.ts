import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { AFFECTATION_PREVUE, TABLES_DE_L_AFFECTATION } from './affectationDuResultat'
import {
  auGrapheDeLAffectation, auPlanAujourdHui, auPlanDeLAffectation, CHEMINS_DOSSIER, CHEMINS_DOSSIER_PREVUS, CLES_PRIMAIRES,
  CLES_PRIMAIRES_PREVUES, LIENS_GARDES, ORDRE_RESTAURATION, ORDRE_RESTAURATION_PREVU, RELATIONS, RELATIONS_PREVUES,
  TABLES_AUTO_REFERENCEES_PAR_VAGUES, TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES, tablesSansChemin, violationsOrdre,
} from './sauvegarde'

// L'AFFECTATION DU RÉSULTAT AU PLAN DE SAUVEGARDE (lignes 33 et 45, AFF2). Sa migration, `affectation_du_resultat`, est
// préparée, pas appliquée : tant que la base ne la porte pas, le plan effectif ne dit RIEN de ses deux tables ni de la
// colonne du brouillon qui cite une décision — une sauvegarde lirait une table absente et échouerait —, et le plan PRÉVU est
// déjà juste, confronté aux clés de la migration, pour que lever `AFFECTATION_PREVUE` suffise le jour venu.

const TABLES: readonly string[] = TABLES_DE_L_AFFECTATION
const MIGRATION = readFileSync(new URL('../../supabase/preparees/20261112233000_affectation_du_resultat.sql', import.meta.url), 'utf8')

/** Les clés étrangères d'une table de la migration, à leur action : `colonne → parent (action)`. */
function clesDeLaTable(table: string): string[] {
  const corps = new RegExp(`create table public\\.${table} \\(([\\s\\S]*?)\\n\\);`, 'i').exec(MIGRATION)![1]
  return [...corps.matchAll(/^\s+([a-z_]+) uuid[^,\n]* references public\.([a-z_]+)\(id\)( on delete (cascade|set null))?/gm)]
    .map(([, colonne, parent, , action]) => `${colonne} → ${parent} (${action === 'cascade' ? 'cascade' : action === 'set null' ? 'met_a_null' : 'bloque'})`)
    .sort()
}

describe('le filtre du plan, côté affectation du résultat', () => {
  it('ses tables ne sont au plan que le drapeau levé ; toute autre l’est toujours', () => {
    for (const table of TABLES) {
      expect(auPlanDeLAffectation(table, false), table).toBe(false)
      expect(auPlanDeLAffectation(table, true), table).toBe(true)
      expect(auPlanAujourdHui(table), table).toBe(AFFECTATION_PREVUE)
    }
    for (const table of ['dossiers', 'ecritures_brouillon', 'exercices_valides']) expect(auPlanDeLAffectation(table, false), table).toBe(true)
  })

  it('drapeau baissé, le plan effectif ne nomme ni ses tables ni la colonne du brouillon qui cite une décision', () => {
    const nommees = new Set([
      ...RELATIONS.flatMap((r) => [r.enfant, r.parent]), ...ORDRE_RESTAURATION, ...Object.keys(CHEMINS_DOSSIER),
      ...TABLES_AUTO_REFERENCEES_PAR_VAGUES.map((a) => a.table), ...Object.keys(CLES_PRIMAIRES),
    ])
    for (const table of TABLES) expect(nommees.has(table), table).toBe(AFFECTATION_PREVUE)
    expect(RELATIONS.some((r) => r.colonne === 'affectation_id')).toBe(AFFECTATION_PREVUE)
    expect(auGrapheDeLAffectation({ enfant: 'ecritures_brouillon', parent: 'affectations_du_resultat' }, false)).toBe(false)
    expect(auGrapheDeLAffectation({ enfant: 'ecritures_brouillon', parent: 'affectations_du_resultat' }, true)).toBe(true)
    expect(auGrapheDeLAffectation({ enfant: 'ecritures_brouillon', parent: 'pieces' }, false)).toBe(true)
  })
})

describe('le plan prévu, affectation du résultat comprise', () => {
  it('chaque table y entre une fois : l’ordre, le chemin direct ; aucune vague ; la clé de la répartition, la sienne', () => {
    for (const table of TABLES) {
      expect(ORDRE_RESTAURATION_PREVU.filter((t) => t === table), table).toHaveLength(1)
      expect(CHEMINS_DOSSIER_PREVUS[table], table).toEqual({ acces: 'direct' })
      expect(TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES.filter((a) => a.table === table), table).toEqual([])
    }
    expect(Object.keys(CLES_PRIMAIRES_PREVUES)).not.toContain('affectations_du_resultat')
    expect(CLES_PRIMAIRES_PREVUES.lignes_d_affectation).toEqual(['affectation_id', 'rang'])
    expect(MIGRATION).toContain('constraint lignes_d_affectation_pkey primary key (affectation_id, rang),')
  })

  it('leurs relations sont les clés étrangères de la migration, à leur action, et celle de la colonne du brouillon', () => {
    for (const table of TABLES) {
      const siennes = RELATIONS_PREVUES.filter((r) => r.enfant === table).map((r) => `${r.colonne} → ${r.parent} (${r.aLaSuppression})`).sort()
      expect(siennes, table).toEqual(clesDeLaTable(table))
    }
    expect(clesDeLaTable('lignes_d_affectation')).toEqual(['affectation_id → affectations_du_resultat (cascade)', 'dossier_id → dossiers (cascade)'])
    expect(MIGRATION).toContain('alter table public.ecritures_brouillon add column affectation_id uuid\n'
      + '  constraint ecritures_brouillon_affectation_id_fkey references public.affectations_du_resultat(id);')
    expect(RELATIONS_PREVUES.filter((r) => r.colonne === 'affectation_id' && r.enfant === 'ecritures_brouillon')).toEqual([
      { enfant: 'ecritures_brouillon', parent: 'affectations_du_resultat', colonne: 'affectation_id', aLaSuppression: 'bloque' }])
    expect(LIENS_GARDES.some((r) => (TABLES as readonly string[]).includes(r.enfant))).toBe(false)
  })

  it('après les stocks, avant le brouillon et les exercices validés ; l’ordre respecte toutes les dépendances', () => {
    const rang = (t: string) => ORDRE_RESTAURATION_PREVU.indexOf(t)
    expect(rang('affectations_du_resultat')).toBeLessThan(rang('lignes_d_affectation'))
    expect(rang('lignes_d_affectation')).toBeLessThan(rang('ecritures_brouillon'))
    expect(rang('affectations_du_resultat')).toBeLessThan(rang('exercices_valides'))
    expect(violationsOrdre(ORDRE_RESTAURATION_PREVU, [...RELATIONS_PREVUES, ...LIENS_GARDES])).toEqual([])
    expect(tablesSansChemin(ORDRE_RESTAURATION_PREVU, CHEMINS_DOSSIER_PREVUS)).toEqual([])
  })
})
