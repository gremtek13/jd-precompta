import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DEPART_DU_CLIENT_PREVU } from './departDuClient'
import {
  auPlanAujourdHui, auPlanDuDepart, CHEMINS_DOSSIER, CHEMINS_DOSSIER_PREVUS, CLES_PRIMAIRES, CLES_PRIMAIRES_PREVUES,
  ORDRE_RESTAURATION, ORDRE_RESTAURATION_PREVU, RELATIONS, RELATIONS_PREVUES, TABLES_AUTO_REFERENCEES_PAR_VAGUES,
  TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES, TABLES_DU_DEPART,
} from './sauvegarde'

// LE DÉPART D'UN CLIENT AU PLAN DE SAUVEGARDE (ligne 44, INAL5). Sa migration, `depart_du_client`, est préparée, pas
// appliquée : tant que l'export ne la porte pas, le plan effectif ne doit RIEN dire de ses deux tables — une sauvegarde lirait
// une table absente et échouerait —, et le plan PRÉVU doit déjà être juste, confronté aux clés de la migration. La
// conservation se restaure EN DERNIER : en cours, elle refuserait la restauration des tables que sa garde protège.

const PAQUETS = 'paquets_d_archive_telecharges'
const CONSERVATIONS = 'conservations_des_dossiers'
const dossier = new URL('../../supabase/preparees/', import.meta.url).pathname
const MIGRATION = readFileSync(dossier + readdirSync(dossier).find((n) => /^\d{14}_depart_du_client\.sql$/.test(n))!, 'utf8')

describe('le filtre du plan, côté départ d’un client', () => {
  it('les deux tables ne sont au plan que le drapeau levé ; toute autre l’est toujours', () => {
    expect(TABLES_DU_DEPART).toEqual([PAQUETS, CONSERVATIONS])
    for (const table of TABLES_DU_DEPART) {
      expect(auPlanDuDepart(table, false), table).toBe(false)
      expect(auPlanDuDepart(table, true), table).toBe(true)
    }
    for (const table of ['dossiers', 'exercices_valides', 'pieces']) expect(auPlanDuDepart(table, false), table).toBe(true)
    expect(auPlanAujourdHui(CONSERVATIONS)).toBe(DEPART_DU_CLIENT_PREVU)
  })

  it('drapeau baissé, le plan effectif ne nomme pas les deux tables', () => {
    const nommees = new Set([
      ...RELATIONS.flatMap((r) => [r.enfant, r.parent]), ...ORDRE_RESTAURATION, ...Object.keys(CHEMINS_DOSSIER),
      ...TABLES_AUTO_REFERENCEES_PAR_VAGUES.map((a) => a.table), ...Object.keys(CLES_PRIMAIRES),
    ])
    expect(nommees.has(PAQUETS)).toBe(DEPART_DU_CLIENT_PREVU)
    expect(nommees.has(CONSERVATIONS)).toBe(DEPART_DU_CLIENT_PREVU)
  })
})

describe('le plan prévu, départ d’un client compris', () => {
  it('les deux tables y entrent : l’ordre, les chemins — ni vagues, et leur clé est la commune', () => {
    for (const table of TABLES_DU_DEPART) {
      expect(ORDRE_RESTAURATION_PREVU.filter((t) => t === table), table).toHaveLength(1)
      expect(CHEMINS_DOSSIER_PREVUS[table], table).toEqual({ acces: 'direct' })
      expect(TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES.filter((a) => a.table === table), table).toEqual([])
      expect(Object.keys(CLES_PRIMAIRES_PREVUES), table).not.toContain(table)
      expect(MIGRATION, table).toMatch(new RegExp(`create table public\\.${table} \\(\\n  id uuid primary key default gen_random_uuid\\(\\),`, 'i'))
    }
  })

  it('la conservation est la DERNIÈRE table restaurée, après toutes celles que sa garde protège', () => {
    expect(ORDRE_RESTAURATION_PREVU[ORDRE_RESTAURATION_PREVU.length - 1]).toBe(CONSERVATIONS)
    const gardees = [...MIGRATION.matchAll(/create trigger [a-z_]+_dossier_conserve\n  before insert(?: or update of dossier_id)? on public\.([a-z_]+)/gi)]
      .map(([, table]) => table)
    expect(gardees.sort()).toEqual(['ecritures_brouillon', 'exercices_valides', 'memberships', 'pieces'])
    for (const table of gardees) {
      expect(ORDRE_RESTAURATION_PREVU.indexOf(table), table).toBeGreaterThanOrEqual(0)
      expect(ORDRE_RESTAURATION_PREVU.indexOf(table), table).toBeLessThan(ORDRE_RESTAURATION_PREVU.indexOf(CONSERVATIONS))
    }
  })

  it('leurs relations sont les clés étrangères de la migration, à leur action', () => {
    const desSiennes = RELATIONS_PREVUES.filter((r) => TABLES_DU_DEPART.includes(r.enfant))
      .map((r) => `${r.enfant}.${r.colonne} → ${r.parent} (${r.aLaSuppression})`).sort()
    const tables = [...MIGRATION.matchAll(/create table public\.([a-z_]+) \(([\s\S]*?)\n\);/gi)]
    const declarees = tables.flatMap(([, enfant, corps]) => [...corps.matchAll(/^\s+([a-z_]+) uuid[^,\n]* references public\.([a-z_]+) \(id\)( on delete cascade)?/gm)]
      .map(([, colonne, parent, cascade]) => `${enfant}.${colonne} → ${parent} (${cascade ? 'cascade' : 'bloque'})`)).sort()
    expect(declarees).toEqual([`${CONSERVATIONS}.dossier_id → dossiers (cascade)`, `${PAQUETS}.dossier_id → dossiers (cascade)`])
    expect(desSiennes).toEqual(declarees)
  })

  it('la restauration passe par la porte que les policies ouvrent au super-administrateur', () => {
    for (const table of TABLES_DU_DEPART) {
      expect(MIGRATION).toContain(`create policy ${table}_restauration on public.${table}\n  for insert to authenticated with check (public.is_super_admin());`)
    }
  })
})
