import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { MODELE_DU_CABINET_PREVU, TABLES_DU_MODELE_DU_CABINET } from './modeleDuCabinet'
import {
  auPlanAujourdHui,
  auPlanDuModeleDuCabinet,
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

// LE MODÈLE DE PLAN DU CABINET AU PLAN DE SAUVEGARDE (ligne 43, PC5). Sa migration, `modele_de_plan_du_cabinet`, est
// préparée, pas appliquée : tant que l'export ne la porte pas, le plan effectif ne doit RIEN dire de la table — une
// sauvegarde lirait une table absente —, et le plan PRÉVU doit déjà être juste, pour que lever `MODELE_DU_CABINET_PREVU`
// suffise le jour venu. Une table de niveau cabinet : hors de l'export d'un dossier (l'export d'un cabinet la porte).

const TABLE = 'plan_comptable_cabinet'
const MIGRATION = readFileSync(
  new URL('../../supabase/schema/20261112134459_modele_de_plan_du_cabinet.sql', import.meta.url), 'utf8')

describe('le filtre du plan, côté modèle du cabinet', () => {
  it('la table n’est au plan que le drapeau levé ; toute autre l’est toujours', () => {
    expect(TABLES_DU_MODELE_DU_CABINET).toEqual([TABLE])
    expect(auPlanDuModeleDuCabinet(TABLE, false)).toBe(false)
    expect(auPlanDuModeleDuCabinet(TABLE, true)).toBe(true)
    for (const table of ['cabinets', 'cabinet_admins', 'roles_comptables', 'plan_comptable_dossier', 'dossiers']) {
      expect(auPlanDuModeleDuCabinet(table, false), table).toBe(true)
    }
    expect(auPlanAujourdHui(TABLE)).toBe(MODELE_DU_CABINET_PREVU)
  })

  it('drapeau baissé, le plan effectif ne nomme pas la table — drapeau levé, partout', () => {
    const nommees = new Set([
      ...RELATIONS.flatMap((r) => [r.enfant, r.parent]), ...ORDRE_RESTAURATION, ...Object.keys(CHEMINS_DOSSIER),
      ...Object.keys(CLES_PRIMAIRES),
    ])
    expect(nommees.has(TABLE)).toBe(MODELE_DU_CABINET_PREVU)
  })
})

describe('le plan prévu, modèle du cabinet compris', () => {
  it('une table du cabinet : juste après le catalogue des rôles, avant les équipes, hors de l’export d’un dossier, sa clé, ses relations, aucune vague', () => {
    const rang = ORDRE_RESTAURATION_PREVU.indexOf(TABLE)
    expect(ORDRE_RESTAURATION_PREVU.slice(rang - 1, rang + 2)).toEqual(['roles_comptables', TABLE, 'cabinet_admins'])
    for (const parent of ['cabinets', 'roles_comptables']) expect(ORDRE_RESTAURATION_PREVU.indexOf(parent)).toBeLessThan(rang)
    expect(ORDRE_RESTAURATION_PREVU.indexOf('dossiers')).toBeGreaterThan(rang)
    expect(CHEMINS_DOSSIER_PREVUS[TABLE]).toEqual({ acces: 'cabinet' })
    expect(CLES_PRIMAIRES_PREVUES[TABLE]).toEqual(['cabinet_id', 'role'])
    expect(RELATIONS_PREVUES.filter((r) => r.enfant === TABLE || r.parent === TABLE)).toEqual([
      { enfant: TABLE, parent: 'cabinets', colonne: 'cabinet_id', aLaSuppression: 'cascade' },
      { enfant: TABLE, parent: 'roles_comptables', colonne: 'role', aLaSuppression: 'bloque' },
    ])
    expect(TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES.some((a) => a.table === TABLE)).toBe(false)
  })

  it('le plan redit la migration : les deux clés étrangères, la clé (cabinet, rôle), aucun dossier', () => {
    const corps = /create table public\.plan_comptable_cabinet \(([\s\S]*?)\n\);/i.exec(MIGRATION)?.[1] ?? ''
    expect(corps).toMatch(/cabinet_id uuid not null references public\.cabinets\(id\) on delete cascade,/)
    expect(corps).toMatch(/role text not null references public\.roles_comptables\(role\),/)
    expect(corps).toMatch(/constraint plan_comptable_cabinet_pkey primary key \(cabinet_id, role\),/)
    expect(corps).not.toMatch(/dossier_id/)
  })
})
