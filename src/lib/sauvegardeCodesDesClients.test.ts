import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CODES_DES_CLIENTS_PREVUS, TABLES_DES_CODES_DES_CLIENTS } from './codesDesClients'
import {
  auPlanAujourdHui, auPlanDesCodesDesClients, CHEMINS_DOSSIER, CHEMINS_DOSSIER_PREVUS, CLES_PRIMAIRES, CLES_PRIMAIRES_PREVUES,
  LIENS_GARDES, ORDRE_RESTAURATION, ORDRE_RESTAURATION_PREVU, planExportDossier, RELATIONS, RELATIONS_PREVUES,
  TABLES_AUTO_REFERENCEES, TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES, tablesSansChemin, violationsOrdre,
} from './sauvegarde'

// LE COMPTEUR DES CODES DES FICHES CLIENTS AU PLAN DE SAUVEGARDE (EXP58-Q2). Sa migration, `codes_des_clients`, est préparée,
// pas appliquée : tant que la base ne la porte pas, le plan effectif ne dit RIEN de `contacts_numerotation` — une sauvegarde lirait
// une table absente et échouerait —, et le plan PRÉVU est déjà juste, confronté à la clé de la migration, pour que la ranger dans
// supabase/schema/ et lever `CODES_DES_CLIENTS_PREVUS` suffisent le jour venu. Le code d'une fiche, lui, est une colonne de
// `contacts`, déjà au plan : la sauvegarde le porte par `select('*')`, la restauration le réinsère, la garde des contacts le garde
// (supabase/essais/codesDesClients.sql, 4 à 4d). Le compteur n'a aucune policy : la sauvegarde le lit vide, et le dit (RESTAU-Q3,
// lib/restaurationInterrompue.ts). La migration se lit là où elle est : préparée, ou rangée dans l'export — ce test passe dans les
// deux états, et la simulation du drapeau levé (24/11/2026) l'a joué ainsi.

const TABLES: readonly string[] = TABLES_DES_CODES_DES_CLIENTS
const NOM = /^\d{14}_codes_des_clients\.sql$/
const ou = (dossier: string) => {
  const chemin = new URL(`../../supabase/${dossier}/`, import.meta.url).pathname
  const nom = readdirSync(chemin).find((n) => NOM.test(n))
  return nom ? chemin + nom : null
}
const PREPAREE = ou('preparees')
const RANGEE = ou('schema')
const MIGRATION = readFileSync((RANGEE ?? PREPAREE)!, 'utf8')

describe('la migration, préparée ou rangée, et le drapeau', () => {
  it('elle est à un seul endroit ; rangée dans l’export, le drapeau est levé ; préparée, il est baissé', () => {
    expect([PREPAREE, RANGEE].filter((c) => c !== null)).toHaveLength(1)
    expect(CODES_DES_CLIENTS_PREVUS).toBe(RANGEE !== null)
  })
})

describe('le filtre du plan, côté codes des fiches clients', () => {
  it('le compteur n’est au plan que le drapeau levé ; toute autre table l’est toujours, les contacts compris', () => {
    for (const table of TABLES) {
      expect(auPlanDesCodesDesClients(table, false), table).toBe(false)
      expect(auPlanDesCodesDesClients(table, true), table).toBe(true)
      expect(auPlanAujourdHui(table), table).toBe(CODES_DES_CLIENTS_PREVUS)
    }
    for (const table of ['dossiers', 'contacts', 'factures_emises', 'facture_numerotation']) {
      expect(auPlanDesCodesDesClients(table, false), table).toBe(true)
    }
  })

  it('le plan effectif ne nomme le compteur que le drapeau levé', () => {
    const nommees = new Set([
      ...RELATIONS.flatMap((r) => [r.enfant, r.parent]), ...ORDRE_RESTAURATION, ...Object.keys(CHEMINS_DOSSIER),
      ...Object.keys(CLES_PRIMAIRES),
    ])
    for (const table of TABLES) expect(nommees.has(table), table).toBe(CODES_DES_CLIENTS_PREVUS)
    expect(ORDRE_RESTAURATION).toEqual(ORDRE_RESTAURATION_PREVU.filter((t) => auPlanAujourdHui(t)))
  })
})

describe('le plan prévu, compteur compris', () => {
  it('la table y entre une fois : l’ordre, le chemin direct, sa clé — le dossier — ; ni vague, ni seconde passe', () => {
    for (const table of TABLES) {
      expect(ORDRE_RESTAURATION_PREVU.filter((t) => t === table), table).toHaveLength(1)
      expect(CHEMINS_DOSSIER_PREVUS[table], table).toEqual({ acces: 'direct' })
      expect(CLES_PRIMAIRES_PREVUES[table], table).toEqual(['dossier_id'])
      expect(TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES.filter((a) => a.table === table), table).toEqual([])
      expect(TABLES_AUTO_REFERENCEES.filter((a) => a.table === table), table).toEqual([])
    }
    expect(MIGRATION).toContain('dossier_id uuid primary key references public.dossiers (id) on delete cascade,')
  })

  it('sa relation est la clé de la migration, à son action : le dossier, en cascade ; aucun lien gardé', () => {
    expect(RELATIONS_PREVUES.filter((r) => r.enfant === 'contacts_numerotation')).toEqual([
      { enfant: 'contacts_numerotation', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' }])
    expect(RELATIONS_PREVUES.some((r) => r.parent === 'contacts_numerotation')).toBe(false)
    expect(LIENS_GARDES.some((r) => r.enfant === 'contacts_numerotation' || r.parent === 'contacts_numerotation')).toBe(false)
    // La migration ne crée aucune autre clé étrangère : le code d'une fiche n'en porte aucune.
    expect([...MIGRATION.matchAll(/\breferences\s+public\.(\w+)/gi)].map((m) => m[1])).toEqual(['dossiers'])
  })

  it('juste après les contacts, après le dossier ; le plan reste ordonné et chaque table a son chemin', () => {
    const rang = (t: string) => ORDRE_RESTAURATION_PREVU.indexOf(t)
    expect(ORDRE_RESTAURATION_PREVU[rang('contacts_numerotation') - 1]).toBe('contacts')
    expect(rang('dossiers')).toBeLessThan(rang('contacts_numerotation'))
    expect(violationsOrdre(ORDRE_RESTAURATION_PREVU, [...RELATIONS_PREVUES, ...LIENS_GARDES])).toEqual([])
    expect(tablesSansChemin(ORDRE_RESTAURATION_PREVU, CHEMINS_DOSSIER_PREVUS)).toEqual([])
    expect(planExportDossier(ORDRE_RESTAURATION_PREVU, CHEMINS_DOSSIER_PREVUS).map((e) => e.table)).toEqual(expect.arrayContaining([...TABLES]))
  })

  it('un défaut planté se voit : le compteur avant le dossier qu’il désigne', () => {
    const sans = ORDRE_RESTAURATION_PREVU.filter((t) => t !== 'contacts_numerotation')
    const avant = [...sans]
    avant.splice(avant.indexOf('dossiers'), 0, 'contacts_numerotation')
    expect(violationsOrdre(avant, [...RELATIONS_PREVUES, ...LIENS_GARDES]).map((v) => `${v.enfant} → ${v.parent}`))
      .toContain('contacts_numerotation → dossiers')
  })
})
