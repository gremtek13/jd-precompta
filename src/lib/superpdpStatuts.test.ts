import { describe, expect, it } from 'vitest'
import { badgeClasseStatutSuperpdp, libelleStatutSuperpdp } from './superpdpStatuts'

// LES STATUTS DU CYCLE DE VIE D'UNE FACTURE SOUS LES MOTS DE LA DGFiP (ligne 28.5, étape d3). Le tableau ci-dessous est
// RECOPIÉ du tableau 8 des spécifications externes de la facturation électronique (dossier général, v3.2 du
// 30/04/2026, § 3.6.4, p. 59), et non de superpdpStatuts.ts : un libellé changé par commodité dans le module doit faire
// virer ce test au rouge. Une seule entorse, dite : « Emise » y perd l'accent de sa capitale, que l'écran lui rend.
// 501 vient de l'annexe 2 (v2.3, onglet « Statuts », objet « Flux »).
const TABLEAU_8: Record<string, string> = {
  'fr:200': 'Déposée',
  'fr:201': 'Émise par la plateforme',
  'fr:202': 'Reçue par la plateforme',
  'fr:203': 'Mise à disposition',
  'fr:204': 'Prise en charge',
  'fr:205': 'Approuvée',
  'fr:206': 'Approuvée partiellement',
  'fr:207': 'En litige',
  'fr:208': 'Suspendue',
  'fr:209': 'Complétée',
  'fr:210': 'Refusée',
  'fr:211': 'Paiement transmis',
  'fr:212': 'Encaissée',
  'fr:213': 'Rejetée',
  'fr:501': 'Irrecevable',
}

describe('superpdpStatuts — les libellés de la DGFiP', () => {
  it('chaque statut du cycle de vie porte le libellé du tableau 8', () => {
    for (const [code, libelle] of Object.entries(TABLEAU_8)) expect(libelleStatutSuperpdp(code), code).toBe(libelle)
  })

  it('les quatre statuts obligatoires gardent leur gravité', () => {
    expect(badgeClasseStatutSuperpdp('fr:212')).toBe('badge-ok')
    expect(badgeClasseStatutSuperpdp('fr:210')).toBe('badge-danger')
    expect(badgeClasseStatutSuperpdp('fr:213')).toBe('badge-danger')
    expect(badgeClasseStatutSuperpdp('fr:200')).toBe('badge-warning')
  })

  it('un code inconnu s’affiche tel quel, sans pastille de gravité', () => {
    expect(libelleStatutSuperpdp('fr:999')).toBe('fr:999')
    expect(badgeClasseStatutSuperpdp('fr:999')).toBe('badge-neutral')
    expect(badgeClasseStatutSuperpdp(null)).toBe('badge-neutral')
  })
})
