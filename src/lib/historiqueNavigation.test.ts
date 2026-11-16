import { describe, expect, it } from 'vitest'
import {
  HISTORIQUE_VIDE, cheminRevenable, libelleDuRetour, noterNavigation, retourPossible,
  type HistoriqueNavigation, type TypeDeNavigation,
} from './historiqueNavigation'

// Rejoue une suite de navigations depuis l'historique vide, comme la coque les voit rendu après rendu.
function rejouer(pas: [TypeDeNavigation, string, string][]): HistoriqueNavigation {
  return pas.reduce((h, [type, cle, chemin]) => noterNavigation(h, type, { cle, chemin }), HISTORIQUE_VIDE)
}

describe('noterNavigation et retourPossible', () => {
  it('à l’arrivée, rien avant : pas de retour, quel que soit le type de la première entrée', () => {
    for (const type of ['POP', 'PUSH', 'REPLACE'] as const) {
      expect(retourPossible(rejouer([[type, 'a', '/dossiers']]))).toBeNull()
    }
  })

  it('une navigation empile, et le retour mène à l’entrée d’avant, d’un pas', () => {
    const h = rejouer([['POP', 'a', '/dossiers/d1/checklist'], ['PUSH', 'b', '/dossiers/d1/banque']])
    expect(retourPossible(h)).toEqual({ chemin: '/dossiers/d1/checklist', pas: 1 })
  })

  it('le même emplacement revu (un second rendu) ne change rien', () => {
    const h = rejouer([['POP', 'a', '/dossiers'], ['PUSH', 'b', '/equipe']])
    expect(noterNavigation(h, 'PUSH', { cle: 'b', chemin: '/equipe' })).toBe(h)
  })

  it('une redirection n’empile pas : elle remplace l’entrée où l’on était', () => {
    // L'arrivée sur « / » redirigée vers le tableau de bord, puis l'onglet par défaut d'un dossier.
    const h = rejouer([
      ['POP', 'a', '/'], ['REPLACE', 'b', '/dossiers'],
      ['PUSH', 'c', '/dossiers/d1'], ['REPLACE', 'd', '/dossiers/d1/checklist'],
    ])
    expect(h.entrees.map((e) => e.chemin)).toEqual(['/dossiers', '/dossiers/d1/checklist'])
    expect(retourPossible(h)).toEqual({ chemin: '/dossiers', pas: 1 })
    expect(retourPossible(rejouer([['POP', 'a', '/'], ['REPLACE', 'b', '/dossiers']]))).toBeNull()
  })

  it('rouvrir le même emplacement ne fait pas un retour de plus : le retour saute le doublon, en autant de pas', () => {
    const h = rejouer([['POP', 'a', '/dossiers/d1/checklist'], ['PUSH', 'b', '/dossiers/d1/banque'], ['PUSH', 'c', '/dossiers/d1/banque']])
    expect(retourPossible(h)).toEqual({ chemin: '/dossiers/d1/checklist', pas: 2 })
    // Rien que des doublons derrière : pas de retour.
    expect(retourPossible(rejouer([['POP', 'a', '/accueil'], ['PUSH', 'b', '/accueil']]))).toBeNull()
  })

  it('un retour par le navigateur dépile aussi, et la pile vidée retire le bouton', () => {
    let h = rejouer([['POP', 'a', '/accueil'], ['PUSH', 'b', '/mes-pieces'], ['PUSH', 'c', '/ma-banque']])
    h = noterNavigation(h, 'POP', { cle: 'b', chemin: '/mes-pieces' })
    expect(retourPossible(h)).toEqual({ chemin: '/accueil', pas: 1 })
    h = noterNavigation(h, 'POP', { cle: 'a', chemin: '/accueil' })
    expect(retourPossible(h)).toBeNull()
    // « Suivant » du navigateur : l'entrée laissée derrière est retrouvée, et ce qui la précède avec elle.
    h = noterNavigation(h, 'POP', { cle: 'b', chemin: '/mes-pieces' })
    expect(retourPossible(h)).toEqual({ chemin: '/accueil', pas: 1 })
  })

  it('une nouvelle navigation après un retour oublie ce qui suivait, comme le navigateur', () => {
    let h = rejouer([['POP', 'a', '/accueil'], ['PUSH', 'b', '/mes-pieces'], ['PUSH', 'c', '/ma-banque']])
    h = noterNavigation(h, 'POP', { cle: 'b', chemin: '/mes-pieces' })
    h = noterNavigation(h, 'PUSH', { cle: 'd', chemin: '/mon-echeancier' })
    expect(h.entrees.map((e) => e.cle)).toEqual(['a', 'b', 'd'])
    expect(retourPossible(h)).toEqual({ chemin: '/mes-pieces', pas: 1 })
  })

  it('un retour du navigateur vers une entrée jamais vue (d’avant la coque) repart d’elle seule', () => {
    let h = rejouer([['POP', 'a', '/dossiers'], ['PUSH', 'b', '/equipe']])
    h = noterNavigation(h, 'POP', { cle: 'inconnue', chemin: '/dossiers/d9/banque' })
    expect(h).toEqual({ entrees: [{ cle: 'inconnue', chemin: '/dossiers/d9/banque' }], position: 0 })
    expect(retourPossible(h)).toBeNull()
  })

  it('une adresse tapée à la main (clé « default » de nouveau) prend la place de l’entrée de même clé, sous son chemin', () => {
    let h = rejouer([['POP', 'default', '/dossiers']])
    h = noterNavigation(h, 'POP', { cle: 'default', chemin: '/equipe' })
    expect(h.entrees).toEqual([{ cle: 'default', chemin: '/equipe' }])
    h = noterNavigation(h, 'PUSH', { cle: 'b', chemin: '/dossiers/d1/banque' })
    expect(retourPossible(h)).toEqual({ chemin: '/equipe', pas: 1 })
  })

  it('ne ramène jamais au retour de la banque, ni au fragment d’un lien d’authentification', () => {
    expect(retourPossible(rejouer([['POP', 'a', '/retour-banque?state=x&code=y'], ['PUSH', 'b', '/dossiers/d1/banque']]))).toBeNull()
    expect(retourPossible(rejouer([['POP', 'a', 'access_token=x&type=recovery'], ['PUSH', 'b', '/dossiers']]))).toBeNull()
    expect(cheminRevenable('/retour-banque')).toBe(false)
    expect(cheminRevenable('/dossiers?nouveau=1')).toBe(true)
  })
})

describe('libelleDuRetour', () => {
  it('nomme l’onglet du même dossier comme la barre le nomme', () => {
    expect(libelleDuRetour('/dossiers/d1/checklist', { chemin: '/dossiers/d1/banque', pas: 1 })).toBe('Retour à Banque')
    expect(libelleDuRetour('/dossiers/d1/banque', { chemin: '/dossiers/d1/pieces', pas: 1 })).toBe('Retour à Justificatifs')
  })

  it('ne nomme pas l’onglet d’un autre dossier, ni un onglet inconnu', () => {
    expect(libelleDuRetour('/dossiers/d1/checklist', { chemin: '/dossiers/d2/banque', pas: 1 })).toBe('Retour')
    expect(libelleDuRetour('/dossiers/d1/checklist', { chemin: '/dossiers/d1/inconnu', pas: 1 })).toBe('Retour')
  })

  it('nomme les écrans hors d’un dossier, au cabinet comme au client', () => {
    expect(libelleDuRetour('/dossiers/d1/checklist', { chemin: '/dossiers', pas: 1 })).toBe('Retour à Tableau de bord')
    expect(libelleDuRetour('/mes-pieces', { chemin: '/accueil', pas: 1 })).toBe('Retour à Accueil')
    expect(libelleDuRetour('/accueil', { chemin: '/ma-banque', pas: 1 })).toBe('Retour à Ma banque')
  })

  it('un chemin qui porte une requête se dit « Retour », sans nom', () => {
    expect(libelleDuRetour('/dossiers/d1/checklist', { chemin: '/dossiers?nouveau=1', pas: 1 })).toBe('Retour')
  })
})
