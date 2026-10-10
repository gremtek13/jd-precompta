import { describe, expect, it } from 'vitest'
import { controlesPourLaRevision } from './controlesDeLaRevision'
import { controlesParCycle } from './revisionCycles'
import type { DocumentAttendu, PointATraiter } from './pointsDeLaChecklist'

// Les contrôles que la révision range : les points de la Vue d'ensemble, tels qu'elle les dit, et ses documents attendus
// de l'exercice révisé seulement.

const point = (o: Partial<PointATraiter>): PointATraiter => ({
  id: 'lignes-non-rapprochees', label: 'ligne(s) bancaire(s) non rapprochée(s)', action: 'Voir les opérations à rapprocher',
  nb: 3, cible: 'banque', severite: 'attention', ...o,
})
const document = (o: Partial<DocumentAttendu>): DocumentAttendu => ({
  id: 'banque-2025', label: 'Relevés bancaires 2025', ok: false, detail: 'Mois manquants : mars', cible: 'banque',
  action: 'Importer le relevé manquant', ...o,
})

describe('controlesPourLaRevision', () => {
  it('reprend chaque point à traiter sous le libellé de la Vue d’ensemble, son nombre devant', () => {
    expect(controlesPourLaRevision({ pointsATraiter: [point({})], documentsAttendus: [] }, 2025)).toEqual([{
      id: 'lignes-non-rapprochees', libelle: '3 ligne(s) bancaire(s) non rapprochée(s)', detail: null, cible: 'banque',
      action: 'Voir les opérations à rapprocher', gravite: 'attention',
    }])
  })

  it('un point qui ne compte rien se lit sans nombre, et garde sa gravité et son détail', () => {
    const [c] = controlesPourLaRevision({
      pointsATraiter: [point({ id: 'statut-tva', label: 'Statut de TVA à préciser', nb: 1, sansNombre: true, severite: 'erreur', detail: 'Un détail.' })],
      documentsAttendus: [],
    }, 2025)
    expect(c.libelle).toBe('Statut de TVA à préciser')
    expect(c.gravite).toBe('erreur')
    expect(c.detail).toBe('Un détail.')
  })

  it('ne retient des documents attendus que ceux qui manquent, de l’exercice révisé ou sans exercice', () => {
    const controles = controlesPourLaRevision({
      pointsATraiter: [],
      documentsAttendus: [
        document({}),
        document({ id: 'banque-2026', label: 'Relevés bancaires 2026' }),
        document({ id: 'cotisations-2025', label: 'Appels de cotisation 2025', ok: true }),
        document({ id: 'informations', label: 'Informations complémentaires du client', cible: 'informations', action: 'Compléter les informations' }),
        document({ id: 'tickets', label: 'Justificatif titres-restaurant reçu', cible: undefined, action: undefined, detail: undefined }),
      ],
    }, 2025)
    expect(controles.map((c) => c.id)).toEqual(['banque-2025', 'informations', 'tickets'])
    expect(controles[0]).toEqual({
      id: 'banque-2025', libelle: 'Relevés bancaires 2025', detail: 'Mois manquants : mars', cible: 'banque',
      action: 'Importer le relevé manquant', gravite: 'attention',
    })
    // Un justificatif à cocher n'a pas d'onglet : il se coche dans la Vue d'ensemble.
    expect(controles[2]).toMatchObject({ cible: 'checklist', action: 'Le cocher dans la Vue d’ensemble', detail: null })
  })

  it('un document attendu avec son onglet mais sans libellé d’action dit « Voir »', () => {
    const [c] = controlesPourLaRevision({ pointsATraiter: [], documentsAttendus: [document({ action: undefined })] }, 2025)
    expect(c.action).toBe('Voir')
  })

  it('chaque contrôle composé ici a un cycle : aucun ne tombe parmi les inconnus', () => {
    const controles = controlesPourLaRevision({
      pointsATraiter: [point({}), point({ id: 'piste-rompue' }), point({ id: 'sans-contrepartie' })],
      documentsAttendus: [document({}), document({ id: 'vehicule', label: 'Facture du véhicule' }), document({ id: 'tickets', cible: undefined })],
    }, 2025)
    const ranges = controlesParCycle(controles, 'tresorerie')
    expect(ranges.inconnus).toEqual([])
    expect(ranges.horsCycle).toEqual([])
  })
})
