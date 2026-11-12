import { afterEach, describe, expect, it, vi } from 'vitest'
import { DOSSIER_DU_CABINET_PREVU } from './dossierDuCabinet'
import {
  auGrapheDuDossierDuCabinet,
  CHEMINS_DOSSIER_PREVUS,
  LIENS_GARDES,
  ORDRE_RESTAURATION,
  RELATIONS,
  RELATIONS_PREVUES,
  violationsOrdre,
} from './sauvegarde'

// LA DÉSIGNATION DU DOSSIER DU CABINET AU GRAPHE DE LA SAUVEGARDE (ligne 47, LM1). La migration `dossier_du_cabinet`, en
// production depuis le 12/11/2026, pose `cabinets.dossier_du_cabinet`, une clé vers `dossiers` mise à nul quand le dossier part :
// le graphe du jour la porte, puisqu'il doit dire exactement ce que dit le schéma (sauvegardeRelations.test.ts). Le cabinet est
// une table `global`, qu'aucune sauvegarde d'un dossier ne réécrit, et il précède tout dossier : `violationsOrdre` n'exige
// aucun ordre d'un enfant global — sans quoi toute sauvegarde serait refusée (`exporterDossier` lit ses violations avant
// tout). Le drapeau baissé, l'état d'avant : la relation n'est pas au graphe.

const DESIGNATION = (r: { enfant: string; colonne: string }) => r.enfant === 'cabinets' && r.colonne === 'dossier_du_cabinet'

describe('la désignation du dossier du cabinet, au graphe', () => {
  it('le graphe prévu la porte, mise à nul, du cabinet vers le dossier', () => {
    expect(RELATIONS_PREVUES.filter(DESIGNATION)).toEqual([
      { enfant: 'cabinets', parent: 'dossiers', colonne: 'dossier_du_cabinet', aLaSuppression: 'met_a_null' },
    ])
  })

  it('le filtre : la désignation n’est au graphe que le drapeau levé ; toute autre relation l’est toujours', () => {
    const designation = RELATIONS_PREVUES.find(DESIGNATION)!
    expect(auGrapheDuDossierDuCabinet(designation, false)).toBe(false)
    expect(auGrapheDuDossierDuCabinet(designation, true)).toBe(true)
    const autre = RELATIONS_PREVUES.find((r) => r.enfant === 'dossiers' && r.parent === 'cabinets')!
    expect(auGrapheDuDossierDuCabinet(autre, false)).toBe(true)
    expect(DOSSIER_DU_CABINET_PREVU).toBe(true)
    expect(RELATIONS.some(DESIGNATION)).toBe(true)
  })

  it('le cabinet précède tout dossier, et l’ordre du jour reste juste : un enfant global n’attend aucun parent', () => {
    expect(CHEMINS_DOSSIER_PREVUS.cabinets).toEqual({ acces: 'global' })
    expect(ORDRE_RESTAURATION.indexOf('cabinets')).toBeLessThan(ORDRE_RESTAURATION.indexOf('dossiers'))
    expect(violationsOrdre(ORDRE_RESTAURATION, [...RELATIONS, ...LIENS_GARDES])).toEqual([])
  })

  it('la règle ne vaut que pour un enfant global : un défaut planté sur une table restaurée se voit encore', () => {
    const plantee = { enfant: 'pieces', parent: 'lignes_bancaires', colonne: 'x', aLaSuppression: 'met_a_null' as const }
    expect(ORDRE_RESTAURATION.indexOf('pieces')).toBeLessThan(ORDRE_RESTAURATION.indexOf('lignes_bancaires'))
    expect(violationsOrdre(ORDRE_RESTAURATION, [plantee])).toEqual([
      { enfant: 'pieces', parent: 'lignes_bancaires', motif: 'parent_apres_enfant' },
    ])
  })
})

describe('le graphe du jour sous chaque état du drapeau', () => {
  afterEach(() => {
    vi.doUnmock('./dossierDuCabinet')
    vi.resetModules()
  })

  it('baissé (l’état d’avant) : la désignation n’est pas au graphe, et l’ordre reste juste', async () => {
    vi.resetModules()
    vi.doMock('./dossierDuCabinet', async (importOriginal) => ({
      ...(await importOriginal<typeof import('./dossierDuCabinet')>()), DOSSIER_DU_CABINET_PREVU: false,
    }))
    const baisse = await import('./sauvegarde')
    expect(baisse.RELATIONS.some(DESIGNATION)).toBe(false)
    expect(baisse.violationsOrdre(baisse.ORDRE_RESTAURATION, [...baisse.RELATIONS, ...baisse.LIENS_GARDES])).toEqual([])
  })
})
