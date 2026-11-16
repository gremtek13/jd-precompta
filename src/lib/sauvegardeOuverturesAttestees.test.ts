import { afterEach, describe, expect, it, vi } from 'vitest'
import { OUVERTURES_ATTESTEES_PREVUES, TABLES_DES_OUVERTURES_ATTESTEES } from './ouverturesAttestees'
import {
  auPlanAujourdHui,
  auPlanDesOuverturesAttestees,
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
import { TABLES_DES_ADRESSES_DES_ACCES_RETIRES } from './adressesDesAccesRetires'

// QUI A OUVERT UN ACCÈS CLIENT, AU PLAN DE SAUVEGARDE (P1TQ2-Q1). Sa migration, `auteur_des_ouvertures_d_acces`, est en
// production depuis le 16/11/2026, le drapeau levé : le plan effectif porte la table ; baissé (l'état d'avant, gardé tant que
// son code existe), il n'en dirait RIEN — une sauvegarde lirait une table absente et échouerait. Le plan prévu la porte, à sa place, juste après l'adresse des accès retirés, donc après la trace qu'elle
// nomme ; ce fichier juge les deux, et le plan du jour sous chaque état du drapeau (`vi.doMock`).

const TABLE = 'auteurs_des_ouvertures'

describe('le filtre du plan, côté auteurs des ouvertures', () => {
  it('la table n’est au plan que le drapeau levé ; toute autre l’est toujours', () => {
    expect(TABLES_DES_OUVERTURES_ATTESTEES).toEqual([TABLE])
    expect(auPlanDesOuverturesAttestees(TABLE, false)).toBe(false)
    expect(auPlanDesOuverturesAttestees(TABLE, true)).toBe(true)
    for (const table of ['dossiers', 'memberships', 'trace_des_droits', 'adresses_des_acces_retires']) {
      expect(auPlanDesOuverturesAttestees(table, false), table).toBe(true)
    }
  })

  it('le filtre du jour suit le drapeau, et le plan effectif ne nomme la table que le drapeau levé', () => {
    expect(auPlanAujourdHui(TABLE)).toBe(OUVERTURES_ATTESTEES_PREVUES)
    const nommees = new Set([
      ...RELATIONS.flatMap((r) => [r.enfant, r.parent]), ...ORDRE_RESTAURATION, ...Object.keys(CHEMINS_DOSSIER),
      ...TABLES_AUTO_REFERENCEES_PAR_VAGUES.map((a) => a.table), ...Object.keys(CLES_PRIMAIRES),
    ])
    expect(nommees.has(TABLE)).toBe(OUVERTURES_ATTESTEES_PREVUES)
    expect(Object.keys(CLES_PRIMAIRES_PREVUES)).not.toContain(TABLE)
    expect(clePrimaire(TABLE)).toEqual(['id'])
  })
})

describe('le plan prévu, les auteurs des ouvertures compris', () => {
  it('la table y entre une fois, juste après l’adresse des accès retirés — après la trace —, par le chemin direct, sans vague', () => {
    expect(ORDRE_RESTAURATION_PREVU.filter((t) => t === TABLE)).toHaveLength(1)
    expect(ORDRE_RESTAURATION_PREVU[ORDRE_RESTAURATION_PREVU.indexOf(TABLE) - 1]).toBe(TABLES_DES_ADRESSES_DES_ACCES_RETIRES[0])
    expect(ORDRE_RESTAURATION_PREVU.indexOf(TABLE)).toBeGreaterThan(ORDRE_RESTAURATION_PREVU.indexOf(TABLES_DE_LA_TRACE_DES_DROITS[0]))
    expect(CHEMINS_DOSSIER_PREVUS[TABLE]).toEqual({ acces: 'direct' })
    expect(TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES.some((a) => a.table === TABLE)).toBe(false)
  })

  it('sa seule relation, telle que la migration la déclare : le dossier en cascade — ni l’accès, ni la trace, ni le compte', () => {
    expect(RELATIONS_PREVUES.filter((r) => r.enfant === TABLE)).toEqual([
      { enfant: TABLE, parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
    ])
    expect(RELATIONS_PREVUES.filter((r) => r.parent === TABLE)).toEqual([])
    expect(violationsOrdre(ORDRE_RESTAURATION_PREVU, [...RELATIONS_PREVUES, ...LIENS_GARDES])).toEqual([])
  })
})

describe('le plan du jour, sous chaque état du drapeau', () => {
  afterEach(() => {
    vi.doUnmock('./ouverturesAttestees')
    vi.resetModules()
  })

  it('le drapeau levé depuis que la migration est en base (16/11/2026) : la table est au plan du jour', () => {
    expect(OUVERTURES_ATTESTEES_PREVUES).toBe(true)
    expect(auPlanAujourdHui(TABLE)).toBe(true)
  })

  it('baissé : le plan effectif ne nomme pas la table, et l’ordre reste juste', async () => {
    vi.resetModules()
    vi.doMock('./ouverturesAttestees', async (importOriginal) => ({
      ...(await importOriginal<typeof import('./ouverturesAttestees')>()), OUVERTURES_ATTESTEES_PREVUES: false,
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
    vi.doMock('./ouverturesAttestees', async (importOriginal) => ({
      ...(await importOriginal<typeof import('./ouverturesAttestees')>()), OUVERTURES_ATTESTEES_PREVUES: true,
    }))
    const leve = await import('./sauvegarde')
    expect(leve.auPlanAujourdHui(TABLE)).toBe(true)
    expect(leve.ORDRE_RESTAURATION).toContain(TABLE)
    expect(leve.CHEMINS_DOSSIER[TABLE]).toEqual({ acces: 'direct' })
    expect(leve.RELATIONS.filter((r) => r.enfant === TABLE)).toHaveLength(1)
    expect(leve.violationsOrdre(leve.ORDRE_RESTAURATION, [...leve.RELATIONS, ...leve.LIENS_GARDES])).toEqual([])
  })
})
