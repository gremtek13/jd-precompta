import { afterEach, describe, expect, it, vi } from 'vitest'
import { ADRESSES_DES_ACCES_RETIRES_PREVUES, TABLES_DES_ADRESSES_DES_ACCES_RETIRES } from './adressesDesAccesRetires'
import {
  auPlanAujourdHui,
  auPlanDesAdressesDesAccesRetires,
  CHEMINS_DOSSIER,
  CHEMINS_DOSSIER_PREVUS,
  CLES_PRIMAIRES,
  CLES_PRIMAIRES_PREVUES,
  clePrimaire,
  LIENS_GARDES,
  ORDRE_RESTAURATION,
  ORDRE_RESTAURATION_PREVU,
  RELATIONS,
  RELATIONS_PREVUES,
  TABLES_AUTO_REFERENCEES_PAR_VAGUES,
  TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES,
  TABLES_DE_LA_TRACE_DES_DROITS,
  violationsOrdre,
} from './sauvegarde'

// L'ADRESSE D'UN ACCÈS RETIRÉ AU PLAN DE SAUVEGARDE (P1T-E2). Sa migration, `adresse_des_acces_retires`, est en production
// depuis le 11/11/2026, le drapeau levé : la table entre au plan effectif. Baissé — l'état d'avant, éprouvé tant que son code
// existe —, le plan effectif ne doit RIEN dire de la table : une sauvegarde lirait une table absente et échouerait. Le plan
// prévu la porte, à sa place, juste après la trace des droits qu'elle nomme ; ce fichier juge les deux, et le plan du jour
// sous chaque état du drapeau (`vi.doMock`).

const TABLE = 'adresses_des_acces_retires'

describe('le filtre du plan, côté adresses des accès retirés', () => {
  it('la table n’est au plan que le drapeau levé ; toute autre l’est toujours', () => {
    expect(TABLES_DES_ADRESSES_DES_ACCES_RETIRES).toEqual([TABLE])
    expect(auPlanDesAdressesDesAccesRetires(TABLE, false)).toBe(false)
    expect(auPlanDesAdressesDesAccesRetires(TABLE, true)).toBe(true)
    for (const table of ['dossiers', 'memberships', 'trace_des_droits']) {
      expect(auPlanDesAdressesDesAccesRetires(table, false), table).toBe(true)
    }
  })

  it('le filtre du jour suit le drapeau, et le plan effectif ne nomme la table que le drapeau levé', () => {
    expect(auPlanAujourdHui(TABLE)).toBe(ADRESSES_DES_ACCES_RETIRES_PREVUES)
    const nommees = new Set([
      ...RELATIONS.flatMap((r) => [r.enfant, r.parent]), ...ORDRE_RESTAURATION, ...Object.keys(CHEMINS_DOSSIER),
      ...TABLES_AUTO_REFERENCEES_PAR_VAGUES.map((a) => a.table), ...Object.keys(CLES_PRIMAIRES),
    ])
    expect(nommees.has(TABLE)).toBe(ADRESSES_DES_ACCES_RETIRES_PREVUES)
    expect(Object.keys(CLES_PRIMAIRES_PREVUES)).not.toContain(TABLE)
    expect(clePrimaire(TABLE)).toEqual(['id'])
  })
})

describe('le plan prévu, l’adresse des accès retirés comprise', () => {
  it('la table y entre une fois, juste après la trace des droits, par le chemin direct, sans vague', () => {
    expect(ORDRE_RESTAURATION_PREVU.filter((t) => t === TABLE)).toHaveLength(1)
    expect(ORDRE_RESTAURATION_PREVU[ORDRE_RESTAURATION_PREVU.indexOf(TABLE) - 1]).toBe(TABLES_DE_LA_TRACE_DES_DROITS[0])
    expect(CHEMINS_DOSSIER_PREVUS[TABLE]).toEqual({ acces: 'direct' })
    expect(TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES.some((a) => a.table === TABLE)).toBe(false)
  })

  it('sa seule relation, telle que la migration la déclare : le dossier en cascade — ni l’accès, et aucune table ne la pointe', () => {
    expect(RELATIONS_PREVUES.filter((r) => r.enfant === TABLE)).toEqual([
      { enfant: TABLE, parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
    ])
    expect(RELATIONS_PREVUES.filter((r) => r.parent === TABLE)).toEqual([])
    expect(violationsOrdre(ORDRE_RESTAURATION_PREVU, [...RELATIONS_PREVUES, ...LIENS_GARDES])).toEqual([])
  })
})

describe('le plan du jour, sous chaque état du drapeau', () => {
  afterEach(() => {
    vi.doUnmock('./adressesDesAccesRetires')
    vi.resetModules()
  })

  it('le drapeau levé depuis le 11/11/2026 : la table est au plan du jour', () => {
    expect(ADRESSES_DES_ACCES_RETIRES_PREVUES).toBe(true)
    expect(auPlanAujourdHui(TABLE)).toBe(true)
  })

  it('baissé (l’état d’avant) : le plan effectif ne nomme pas la table, et l’ordre reste juste', async () => {
    vi.resetModules()
    vi.doMock('./adressesDesAccesRetires', async (importOriginal) => ({
      ...(await importOriginal<typeof import('./adressesDesAccesRetires')>()), ADRESSES_DES_ACCES_RETIRES_PREVUES: false,
    }))
    const baisse = await import('./sauvegarde')
    expect(baisse.auPlanAujourdHui(TABLE)).toBe(false)
    expect(baisse.ORDRE_RESTAURATION).not.toContain(TABLE)
    expect(baisse.CHEMINS_DOSSIER[TABLE]).toBeUndefined()
    expect(baisse.RELATIONS.filter((r) => r.enfant === TABLE || r.parent === TABLE)).toEqual([])
    expect(baisse.violationsOrdre(baisse.ORDRE_RESTAURATION, [...baisse.RELATIONS, ...baisse.LIENS_GARDES])).toEqual([])
  })

  it('levé : la table entre au plan effectif, à sa place, et l’ordre reste juste', async () => {
    vi.resetModules()
    vi.doMock('./adressesDesAccesRetires', async (importOriginal) => ({
      ...(await importOriginal<typeof import('./adressesDesAccesRetires')>()), ADRESSES_DES_ACCES_RETIRES_PREVUES: true,
    }))
    const leve = await import('./sauvegarde')
    expect(leve.auPlanAujourdHui(TABLE)).toBe(true)
    expect(leve.ORDRE_RESTAURATION).toContain(TABLE)
    expect(leve.CHEMINS_DOSSIER[TABLE]).toEqual({ acces: 'direct' })
    expect(leve.RELATIONS.filter((r) => r.enfant === TABLE)).toHaveLength(1)
    expect(leve.violationsOrdre(leve.ORDRE_RESTAURATION, [...leve.RELATIONS, ...leve.LIENS_GARDES])).toEqual([])
  })
})
