import { readdirSync, readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LETTRES_DE_MISSION_PREVUES } from './lettresDeMission'
import {
  auPlanAujourdHui, auPlanDesLettresDeMission, CHEMINS_DOSSIER, CHEMINS_DOSSIER_PREVUS, CLES_PRIMAIRES, CLES_PRIMAIRES_PREVUES,
  LIENS_GARDES, ORDRE_RESTAURATION, ORDRE_RESTAURATION_PREVU, planExportDossier, RELATIONS, RELATIONS_PREVUES,
  TABLES_AUTO_REFERENCEES_PAR_VAGUES, TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES, TABLES_DE_LA_NUMEROTATION_CONTINUE,
  TABLES_DES_FACTURES_IMPORTEES, TABLES_DES_LETTRES_DE_MISSION, tablesSansChemin, violationsOrdre,
} from './sauvegarde'

// LES LETTRES DE MISSION AU PLAN DE SAUVEGARDE (ligne 47, LM4). Leur migration, `lettres_de_mission`, est en production
// depuis le 12/11/2026, le drapeau levé. Baissé — l'état d'avant, joué plus bas —, le plan effectif ne doit RIEN dire de ses
// deux tables : une sauvegarde lirait une table absente et échouerait. Le plan PRÉVU est confronté aux clés de la migration.

const MODELES = 'modeles_lettre_de_mission'
const LETTRES = 'lettres_de_mission'
const dossier = new URL('../../supabase/schema/', import.meta.url).pathname
const MIGRATION = readFileSync(dossier + readdirSync(dossier).find((n) => /^\d{14}_lettres_de_mission\.sql$/.test(n))!, 'utf8')

describe('le filtre du plan, côté lettres de mission', () => {
  it('les deux tables ne sont au plan que le drapeau levé ; toute autre l’est toujours', () => {
    expect(TABLES_DES_LETTRES_DE_MISSION).toEqual([MODELES, LETTRES])
    for (const table of TABLES_DES_LETTRES_DE_MISSION) {
      expect(auPlanDesLettresDeMission(table, false), table).toBe(false)
      expect(auPlanDesLettresDeMission(table, true), table).toBe(true)
    }
    for (const table of ['dossiers', 'documents_divers', 'dossier_permanent']) expect(auPlanDesLettresDeMission(table, false), table).toBe(true)
    expect(auPlanAujourdHui(LETTRES)).toBe(LETTRES_DE_MISSION_PREVUES)
    expect([...TABLES_DE_LA_NUMEROTATION_CONTINUE, ...TABLES_DES_FACTURES_IMPORTEES].filter((t) => TABLES_DES_LETTRES_DE_MISSION.includes(t)))
      .toEqual([])
  })

  it('drapeau baissé, le plan effectif ne nomme pas les deux tables — drapeau levé, partout', () => {
    const nommees = new Set([
      ...RELATIONS.flatMap((r) => [r.enfant, r.parent]), ...ORDRE_RESTAURATION, ...Object.keys(CHEMINS_DOSSIER),
      ...TABLES_AUTO_REFERENCEES_PAR_VAGUES.map((a) => a.table), ...Object.keys(CLES_PRIMAIRES),
    ])
    expect(nommees.has(MODELES)).toBe(LETTRES_DE_MISSION_PREVUES)
    expect(nommees.has(LETTRES)).toBe(LETTRES_DE_MISSION_PREVUES)
  })
})

describe('le plan prévu, lettres de mission comprises', () => {
  it('les deux tables y entrent partout : l’ordre, les chemins, leurs vagues — leur clé est la commune', () => {
    for (const table of TABLES_DES_LETTRES_DE_MISSION) {
      expect(ORDRE_RESTAURATION_PREVU.filter((t) => t === table), table).toHaveLength(1)
      expect(CHEMINS_DOSSIER_PREVUS[table], table).toEqual({ acces: 'direct' })
      expect(TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES.filter((a) => a.table === table), table).toEqual([{ table, colonne: 'remplace_id' }])
      expect(Object.keys(CLES_PRIMAIRES_PREVUES), table).not.toContain(table)
    }
  })

  it('leurs relations sont les clés étrangères de la migration, à leur action ; le dossier du client n’en est pas une', () => {
    const desSiennes = RELATIONS_PREVUES.filter((r) => TABLES_DES_LETTRES_DE_MISSION.includes(r.enfant))
      .map((r) => `${r.enfant}.${r.colonne} → ${r.parent} (${r.aLaSuppression})`).sort()
    const tables = [...MIGRATION.matchAll(/create table public\.([a-z_]+) \(([\s\S]*?)\n\);/gi)]
    const declarees = tables.flatMap(([, enfant, corps]) => [...corps.matchAll(/^\s+([a-z_]+) uuid[^,\n]* references public\.([a-z_]+) \(id\)( on delete cascade)?/gm)]
      .map(([, colonne, parent, cascade]) => `${enfant}.${colonne} → ${parent} (${cascade ? 'cascade' : 'bloque'})`)).sort()
    expect(declarees).toHaveLength(6)
    expect(desSiennes).toEqual(declarees)
    expect(MIGRATION).toMatch(/^\s+dossier_client_id uuid,$/m)
    expect(LIENS_GARDES.some((r) => TABLES_DES_LETTRES_DE_MISSION.includes(r.enfant))).toBe(false)
  })

  it('après les documents que le papier signé cite, le modèle avant la lettre ; l’ordre respecte toutes les dépendances', () => {
    const rang = (t: string) => ORDRE_RESTAURATION_PREVU.indexOf(t)
    expect(rang('documents_divers')).toBeLessThan(rang(MODELES))
    expect(rang(MODELES)).toBeLessThan(rang(LETTRES))
    expect(violationsOrdre(ORDRE_RESTAURATION_PREVU, [...RELATIONS_PREVUES, ...LIENS_GARDES])).toEqual([])
    expect(tablesSansChemin(ORDRE_RESTAURATION_PREVU, CHEMINS_DOSSIER_PREVUS)).toEqual([])
    expect(planExportDossier(ORDRE_RESTAURATION_PREVU, CHEMINS_DOSSIER_PREVUS).map((e) => e.table)).toContain(LETTRES)
  })

  it('un défaut planté se voit : une lettre avant son modèle', () => {
    const deplace = ORDRE_RESTAURATION_PREVU.filter((t) => t !== LETTRES)
    deplace.splice(deplace.indexOf(MODELES), 0, LETTRES)
    expect(violationsOrdre(deplace, [...RELATIONS_PREVUES, ...LIENS_GARDES]).map((v) => `${v.enfant} → ${v.parent}`))
      .toContain('lettres_de_mission → modeles_lettre_de_mission')
  })
})

describe('les lettres de mission dans les deux états du drapeau', () => {
  afterEach(() => {
    vi.doUnmock('./lettresDeMission')
    vi.resetModules()
  })

  // Le plan du jour est calculé au chargement du module : on le recharge sous l'état voulu.
  async function sauvegardeSous(drapeau: boolean) {
    vi.resetModules()
    vi.doMock('./lettresDeMission', async (importOriginal) => ({
      ...(await importOriginal<typeof import('./lettresDeMission')>()),
      LETTRES_DE_MISSION_PREVUES: drapeau,
    }))
    return import('./sauvegarde')
  }

  it('levé, les deux tables entrent au plan du jour, à leur rang ; baissé, elles en sortent', async () => {
    const leve = await sauvegardeSous(true)
    expect(leve.ORDRE_RESTAURATION).toContain(LETTRES)
    expect(leve.ORDRE_RESTAURATION.indexOf(MODELES)).toBeLessThan(leve.ORDRE_RESTAURATION.indexOf(LETTRES))
    expect(leve.RELATIONS.some((r) => r.enfant === LETTRES && r.parent === 'documents_divers')).toBe(true)
    const baisse = await sauvegardeSous(false)
    expect(baisse.ORDRE_RESTAURATION).not.toContain(LETTRES)
    expect(baisse.RELATIONS.some((r) => r.enfant === LETTRES)).toBe(false)
  })
})
