import { describe, expect, it } from 'vitest'
import { CAISSE_EXPORTEE } from './caisse'
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
  const identifiants = (caisse: boolean) => groupesDuParcours(caisse).map((g) => g.id)

  it('baissé : la navigation d’hier, cinq groupes et vingt écrans, sans la caisse', () => {
    expect(identifiants(false)).toEqual(['checklist', 'documents-groupe', 'banque', 'comptabilite', 'cabinet'])
    expect(ongletsValides(false)).toHaveLength(20)
    expect(ongletsValides(false)).not.toContain('caisse')
  })

  it('levé : « Caisse » vient juste après Banque, destination directe, et son adresse devient routable', () => {
    expect(identifiants(true)).toEqual(['checklist', 'documents-groupe', 'banque', 'caisse', 'comptabilite', 'cabinet'])
    const caisse = groupesDuParcours(true).find((g) => g.id === 'caisse')!
    expect(caisse).toMatchObject({ label: 'Caisse', cible: 'caisse' })
    expect(caisse.enfants).toBeUndefined()
    expect(ongletsValides(true)).toHaveLength(21)
    expect(ongletsValides(true)).toContain('caisse')
  })

  it('les deux états ne diffèrent que de cet onglet : rien d’autre ne bouge', () => {
    expect(groupesDuParcours(true).filter((g) => g.id !== 'caisse')).toEqual(groupesDuParcours(false))
    expect(ongletsValides(true).filter((t) => t !== 'caisse')).toEqual(ongletsValides(false))
  })

  it('chaque écran de la navigation est routable, dans les deux états', () => {
    for (const caisse of [false, true]) {
      const ecrans = groupesDuParcours(caisse).flatMap((g) => [...(g.cible ? [g.cible] : []), ...(g.enfants ?? []).map((e) => e.id)])
      expect(ongletsValides(caisse).sort()).toEqual([...ecrans].sort())
      expect(new Set(ecrans).size, 'aucun écran en double').toBe(ecrans.length)
    }
  })

  it('la liste du jour suit le drapeau, quel que soit son état, et la caisse se nomme dans les deux', () => {
    expect(GROUPES_PARCOURS).toEqual(groupesDuParcours(CAISSE_EXPORTEE))
    expect(libelleDeLOnglet('caisse')).toBe('Caisse')
  })
})
