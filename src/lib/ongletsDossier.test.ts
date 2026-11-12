import { describe, expect, it } from 'vitest'
import { CAISSE_EXPORTEE } from './caisse'
import { INVENTAIRE_EXPORTE } from './inventaire'
import { GROUPES_PARCOURS, groupesDuParcours, libelleDeLOnglet, ongletsValides, type DossierTab } from './ongletsDossier'

describe('libelleDeLOnglet — un écran nommé comme la navigation le nomme', () => {
  it('nomme une destination directe et un écran d’un regroupement', () => {
    expect(libelleDeLOnglet('checklist')).toBe("Vue d'ensemble")
    expect(libelleDeLOnglet('banque')).toBe('Banque')
    expect(libelleDeLOnglet('pieces')).toBe('Justificatifs')
    expect(libelleDeLOnglet('informations')).toBe('Informations du dossier')
    // Le bilan (ligne 33) est dans la navigation, sous Comptabilité, juste après la balance dont il range les soldes.
    expect(libelleDeLOnglet('bilan')).toBe('Bilan')
    const comptabilite = GROUPES_PARCOURS.find((g) => g.id === 'comptabilite')!.enfants!.map((e) => e.id)
    expect(comptabilite.indexOf('bilan')).toBe(comptabilite.indexOf('statistiques') + 1)
  })

  it('nomme chaque écran de la navigation, et jamais par son identifiant', () => {
    const ecrans = GROUPES_PARCOURS.flatMap((g) => [...(g.cible ? [g.cible] : []), ...(g.enfants ?? []).map((e) => e.id)])
    expect(ecrans.length).toBeGreaterThanOrEqual(18)
    for (const tab of ecrans) expect(libelleDeLOnglet(tab as DossierTab)).not.toBe(tab)
  })
})

// L'ONGLET CAISSE (ligne 26.6, étape C4) N'EXISTE QUE LA CAISSE EN BASE. Baissé, le drapeau `CAISSE_EXPORTEE` laisse la navigation
// d'hier, au caractère près : aucun onglet neuf, aucune adresse `/dossiers/:id/caisse` routable. Levé, « Caisse » suit Banque,
// destination directe comme elle. La source est la fonction, qui joue chaque état ; la constante suit le drapeau du jour.
describe('groupesDuParcours — la caisse offerte ou non', () => {
  // L'inventaire baissé : c'est la navigation d'avant l'onglet Inventaire que ces cas gardent.
  const identifiants = (caisse: boolean) => groupesDuParcours(caisse, false).map((g) => g.id)

  it('baissé : la navigation d’hier, cinq groupes et vingt écrans, sans la caisse', () => {
    expect(identifiants(false)).toEqual(['checklist', 'documents-groupe', 'banque', 'comptabilite', 'cabinet'])
    expect(ongletsValides(false, false)).toHaveLength(20)
    expect(ongletsValides(false, false)).not.toContain('caisse')
  })

  it('levé : « Caisse » vient juste après Banque, destination directe, et son adresse devient routable', () => {
    expect(identifiants(true)).toEqual(['checklist', 'documents-groupe', 'banque', 'caisse', 'comptabilite', 'cabinet'])
    const caisse = groupesDuParcours(true, false).find((g) => g.id === 'caisse')!
    expect(caisse).toMatchObject({ label: 'Caisse', cible: 'caisse' })
    expect(caisse.enfants).toBeUndefined()
    expect(ongletsValides(true, false)).toHaveLength(21)
    expect(ongletsValides(true, false)).toContain('caisse')
  })

  it('les deux états ne diffèrent que de cet onglet : rien d’autre ne bouge', () => {
    expect(groupesDuParcours(true, false).filter((g) => g.id !== 'caisse')).toEqual(groupesDuParcours(false, false))
    expect(ongletsValides(true, false).filter((t) => t !== 'caisse')).toEqual(ongletsValides(false, false))
  })

  it('chaque écran de la navigation est routable, dans les quatre états', () => {
    for (const caisse of [false, true]) {
      for (const inventaire of [false, true]) {
        const ecrans = groupesDuParcours(caisse, inventaire).flatMap((g) => [...(g.cible ? [g.cible] : []), ...(g.enfants ?? []).map((e) => e.id)])
        expect(ongletsValides(caisse, inventaire).sort()).toEqual([...ecrans].sort())
        expect(new Set(ecrans).size, 'aucun écran en double').toBe(ecrans.length)
      }
    }
  })

  it('la liste du jour suit les deux drapeaux, quel que soit leur état, et la caisse se nomme dans les deux', () => {
    expect(GROUPES_PARCOURS).toEqual(groupesDuParcours(CAISSE_EXPORTEE, INVENTAIRE_EXPORTE))
    expect(libelleDeLOnglet('caisse')).toBe('Caisse')
  })
})

// L'ONGLET INVENTAIRE (ligne 35, INV5) N'EST OFFERT QUE LE DRAPEAU `INVENTAIRE_EXPORTE` LEVÉ. Baissé, la navigation est celle
// d'hier, au caractère près ; levé, « Inventaire » précède Clôture dans Comptabilité, et son adresse devient routable.
describe('groupesDuParcours — l’inventaire offert ou non', () => {
  it('baissé : la liste d’hier, sans l’inventaire, dans les deux états de la caisse', () => {
    for (const caisse of [false, true]) {
      expect(ongletsValides(caisse, false)).not.toContain('inventaire')
      const comptabilite = groupesDuParcours(caisse, false).find((g) => g.id === 'comptabilite')!.enfants!.map((e) => e.id)
      expect(comptabilite).not.toContain('inventaire')
    }
  })

  it('levé : « Inventaire » précède Clôture, sous Comptabilité, et rien d’autre ne bouge', () => {
    for (const caisse of [false, true]) {
      const comptabilite = groupesDuParcours(caisse, true).find((g) => g.id === 'comptabilite')!.enfants!
      const ids = comptabilite.map((e) => e.id)
      expect(ids.indexOf('inventaire')).toBe(ids.indexOf('cloture') - 1)
      expect(comptabilite.find((e) => e.id === 'inventaire')!.label).toBe('Inventaire')
      expect(ongletsValides(caisse, true)).toContain('inventaire')
      expect(ongletsValides(caisse, true).filter((t) => t !== 'inventaire')).toEqual(ongletsValides(caisse, false))
      const autres = groupesDuParcours(caisse, true).filter((g) => g.id !== 'comptabilite')
      expect(autres).toEqual(groupesDuParcours(caisse, false).filter((g) => g.id !== 'comptabilite'))
    }
  })

  it('l’inventaire se nomme dans les deux états, et le drapeau du jour est baissé tant que la mise en production n’est pas faite', () => {
    expect(libelleDeLOnglet('inventaire')).toBe('Inventaire')
    expect(INVENTAIRE_EXPORTE).toBe(false)
  })
})
