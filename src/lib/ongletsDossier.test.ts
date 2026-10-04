import { describe, expect, it } from 'vitest'
import { GROUPES_PARCOURS, libelleDeLOnglet, type DossierTab } from './ongletsDossier'

describe('libelleDeLOnglet — un écran nommé comme la navigation le nomme', () => {
  it('nomme une destination directe et un écran d’un regroupement', () => {
    expect(libelleDeLOnglet('checklist')).toBe("Vue d'ensemble")
    expect(libelleDeLOnglet('banque')).toBe('Banque')
    expect(libelleDeLOnglet('pieces')).toBe('Justificatifs')
    expect(libelleDeLOnglet('informations')).toBe('Informations du dossier')
  })

  it('nomme chaque écran de la navigation, et jamais par son identifiant', () => {
    const ecrans = GROUPES_PARCOURS.flatMap((g) => [...(g.cible ? [g.cible] : []), ...(g.enfants ?? []).map((e) => e.id)])
    expect(ecrans.length).toBeGreaterThanOrEqual(18)
    for (const tab of ecrans) expect(libelleDeLOnglet(tab as DossierTab)).not.toBe(tab)
  })
})
