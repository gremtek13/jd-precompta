import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CONSOMMATION_TENUE_PAR_LA_FONCTION, TABLES_DES_CONSOMMATIONS } from './consommationDeLAssistant'
import {
  auPlanAujourdHui,
  auPlanDesConsommations,
  CHEMINS_DOSSIER,
  CHEMINS_DOSSIER_PREVUS,
  CLES_PRIMAIRES,
  ORDRE_RESTAURATION,
  ORDRE_RESTAURATION_PREVU,
  RELATIONS,
  RELATIONS_PREVUES,
  TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES,
} from './sauvegarde'

// LE JOURNAL DE CONSOMMATION DE L'ASSISTANT AU PLAN DE SAUVEGARDE (ASSIST-Q1). Sa migration, `consommations_de_l_assistant`, est
// préparée, pas appliquée : tant que l'export ne la porte pas, le plan effectif ne dit RIEN de la table, et le plan PRÉVU est
// déjà juste, pour que lever `CONSOMMATION_TENUE_PAR_LA_FONCTION` suffise le jour venu. Une table du cabinet : hors de l'export
// d'un dossier — la consommation est celle du cabinet qui a payé l'appel, et la sauvegarde d'un dossier ne porte pas qui a
// interrogé l'assistant.

const TABLE = 'consommations_de_l_assistant'
const MIGRATION = readFileSync(
  new URL('../../supabase/preparees/20261127230000_consommations_de_l_assistant.sql', import.meta.url), 'utf8')

describe('le filtre du plan, côté journal de consommation', () => {
  it('la table n’est au plan que le drapeau levé ; toute autre l’est toujours', () => {
    expect(TABLES_DES_CONSOMMATIONS).toEqual([TABLE])
    expect(auPlanDesConsommations(TABLE, false)).toBe(false)
    expect(auPlanDesConsommations(TABLE, true)).toBe(true)
    for (const table of ['cabinets', 'dossiers', 'agent_conversations', 'connexions_plateformes']) {
      expect(auPlanDesConsommations(table, false), table).toBe(true)
    }
    expect(auPlanAujourdHui(TABLE)).toBe(CONSOMMATION_TENUE_PAR_LA_FONCTION)
  })

  it('drapeau baissé, le plan effectif ne nomme pas la table — drapeau levé, partout', () => {
    const nommees = new Set([
      ...RELATIONS.flatMap((r) => [r.enfant, r.parent]), ...ORDRE_RESTAURATION, ...Object.keys(CHEMINS_DOSSIER),
      ...Object.keys(CLES_PRIMAIRES),
    ])
    expect(nommees.has(TABLE)).toBe(CONSOMMATION_TENUE_PAR_LA_FONCTION)
  })
})

describe('le plan prévu, journal de consommation compris', () => {
  it('une table du cabinet : après ses deux parents, hors de l’export d’un dossier, la clé commune, ses deux relations, aucune vague', () => {
    const rang = ORDRE_RESTAURATION_PREVU.indexOf(TABLE)
    expect(ORDRE_RESTAURATION_PREVU.slice(rang - 1, rang + 2)).toEqual(['connexions_plateformes', TABLE, 'controles_releves_bancaires'])
    expect(ORDRE_RESTAURATION_PREVU.indexOf('cabinets')).toBeLessThan(rang)
    expect(ORDRE_RESTAURATION_PREVU.indexOf('dossiers')).toBeLessThan(rang)
    expect(CHEMINS_DOSSIER_PREVUS[TABLE]).toEqual({ acces: 'cabinet' })
    expect(RELATIONS_PREVUES.filter((r) => r.enfant === TABLE || r.parent === TABLE)).toEqual([
      { enfant: TABLE, parent: 'cabinets', colonne: 'cabinet_id', aLaSuppression: 'cascade' },
      { enfant: TABLE, parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'met_a_null' },
    ])
    expect(TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES.some((a) => a.table === TABLE)).toBe(false)
  })

  it('le plan redit la migration : le cabinet en cascade, le dossier mis à nul, la clé `id`', () => {
    const corps = /create table public\.consommations_de_l_assistant \(([\s\S]*?)\n\);/i.exec(MIGRATION)?.[1] ?? ''
    expect(corps).toMatch(/id uuid primary key default gen_random_uuid\(\),/)
    expect(corps).toMatch(/cabinet_id uuid not null references public\.cabinets \(id\) on delete cascade,/)
    expect(corps).toMatch(/dossier_id uuid references public\.dossiers \(id\) on delete set null,/)
    expect([...corps.matchAll(/references public\.(\w+)/g)].map((m) => m[1])).toEqual(['cabinets', 'dossiers'])
  })
})
