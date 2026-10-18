import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import RibsAConfirmer from './RibsAConfirmer'
import { LIBELLE_ALLER_AUX_FACTURES } from '../lib/changementDeRib'
import {
  AUCUN_RIB_A_CONFIRMER, LECTURE_MANQUEE_DE_LA_LISTE, MENTION_DOSSIER_ARCHIVE, lireLesDossiersAuRibAConfirmer, phraseDuCompte,
  type DossiersAuRibAConfirmerLus, type LectureDesDossiersAuRib,
} from '../lib/dossiersAuRibAConfirmer'
import { avisDuChangement } from '../lib/changementDeRib'
import { CONSEIL_VERIFICATION_RIB } from '../lib/parametresFacturationVue'
import { elementRendu, idDuDossierFictif, listeRendue } from '../test/dossiersAuRibAConfirmer'

// LA LISTE DES RIB PROPOSÉS QUI ATTENDENT LE CABINET, SEULE (espace client, étape A5b3d) : le composant de présentation reçoit la LECTURE
// et ne lit rien. Quatre états : rien (pas de lecture, pas revenue) et « aucun » (la liste vide, lue en entier) ne montrent RIEN ; la
// liste (le compte, une ligne par dossier dans l'ordre reçu, la marque d'un archivé, le lien vers SES factures, le conseil UNE fois) ;
// la lecture manquée (une ligne discrète, le motif en infobulle). Ce que l'écran en fait avec la base : DossiersList.ribsAConfirmer.test.tsx.

function lu(...elements: Record<string, unknown>[]): DossiersAuRibAConfirmerLus {
  const l = lireLesDossiersAuRibAConfirmer(listeRendue(...elements))
  if (l === null) throw new Error('la liste fictive doit se lire')
  return l
}
const monter = (lecture: LectureDesDossiersAuRib | null) =>
  render(<MemoryRouter><RibsAConfirmer lecture={lecture} /></MemoryRouter>)

describe('RibsAConfirmer — rien à dire', () => {
  it('sans lecture (drapeau baissé, aucune clé) : rien', () => {
    const { container } = monter(null)
    expect(container.innerHTML).toBe('')
  })
  it('pas revenue : rien — ni squelette, ni « aucun »', () => {
    const { container } = monter({ etat: 'en_cours' })
    expect(container.innerHTML).toBe('')
  })
  it('la liste vide, lue en entier : rien non plus (l’avis se tait sur ce qui n’attend personne)', () => {
    const { container } = monter({ etat: 'lue', lu: lu() })
    expect(container.innerHTML).toBe('')
    expect(document.body.textContent).not.toContain(AUCUN_RIB_A_CONFIRMER)
  })
})

describe('RibsAConfirmer — la liste', () => {
  const deux = lu(
    elementRendu(2, { nom: 'Zèbre Santé', changement: { jour: '2026-09-01' } }),
    elementRendu(1, { nom: 'Alpha Soins', archive: true, changement: { jour: '2026-10-12' } }),
  )

  it('le compte en titre, les lignes DANS L’ORDRE reçu (jamais retriées), chacune avec la phrase de son avis', () => {
    monter({ etat: 'lue', lu: deux })
    const section = screen.getByRole('region', { name: phraseDuCompte(deux) })
    const lignes = within(section).getAllByRole('listitem')
    expect(lignes.map((l) => l.querySelector('.ribs-a-confirmer-nom')?.textContent)).toEqual(['Zèbre Santé', 'Alpha Soins'])
    // La phrase de l'avis de la Vue d'ensemble, au caractère près, pour chaque dossier.
    deux.dossiers.forEach((d, i) => {
      expect(lignes[i].querySelector('.ribs-a-confirmer-avis')?.textContent).toBe(avisDuChangement(d.changement, 'cabinet').phrase)
    })
  })

  it('la marque d’un dossier archivé sur SA ligne seule', () => {
    monter({ etat: 'lue', lu: deux })
    const lignes = screen.getAllByRole('listitem')
    expect(within(lignes[0]).queryByText(MENTION_DOSSIER_ARCHIVE)).toBeNull()
    expect(within(lignes[1]).getByText(MENTION_DOSSIER_ARCHIVE)).toBeTruthy()
    expect(screen.getAllByText(MENTION_DOSSIER_ARCHIVE)).toHaveLength(1)
  })

  it('chaque ligne mène à l’onglet Factures de SON dossier, sous le libellé du module', () => {
    monter({ etat: 'lue', lu: deux })
    const liens = screen.getAllByRole('link', { name: LIBELLE_ALLER_AUX_FACTURES })
    expect(liens.map((a) => a.getAttribute('href'))).toEqual([
      `/dossiers/${idDuDossierFictif(2)}/factures`, `/dossiers/${idDuDossierFictif(1)}/factures`,
    ])
    // Le nom du dossier décrit son lien : deux liens de même nom restent distincts pour qui les entend.
    expect(liens.map((a) => document.getElementById(a.getAttribute('aria-describedby') ?? '')?.textContent)).toEqual(['Zèbre Santé', 'Alpha Soins'])
  })

  it('le conseil de vérification est dit UNE fois, pas une fois par ligne', () => {
    monter({ etat: 'lue', lu: deux })
    expect(screen.getAllByText(CONSEIL_VERIFICATION_RIB)).toHaveLength(1)
  })

  it('un seul dossier : le compte au singulier, une ligne, un conseil, une pastille d’attention', () => {
    const un = lu(elementRendu(3, { nom: 'Seul Dossier' }))
    const { container } = monter({ etat: 'lue', lu: un })
    expect(screen.getByRole('region', { name: phraseDuCompte(un) })).toBeTruthy()
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(container.querySelectorAll('.check-dot.check-attention')).toHaveLength(1)
  })
})

describe('RibsAConfirmer — la liste n’a pas pu être lue', () => {
  it('illisible : la ligne discrète, sans pastille, sans lien, jamais « aucun »', () => {
    const { container } = monter({ etat: 'illisible' })
    expect(screen.getByText(LECTURE_MANQUEE_DE_LA_LISTE)).toBeTruthy()
    expect(screen.getByText(LECTURE_MANQUEE_DE_LA_LISTE).getAttribute('title')).toBeNull()
    expect(container.querySelector('.avis-rib-discret')).not.toBeNull()
    expect(container.querySelector('.check-dot')).toBeNull()
    expect(screen.queryAllByRole('link')).toHaveLength(0)
    expect(document.body.textContent).not.toContain(AUCUN_RIB_A_CONFIRMER)
  })
  it('refusée : la même ligne, le motif en infobulle', () => {
    monter({ etat: 'refusee', motif: 'Seul le cabinet lit les RIB à confirmer.' })
    expect(screen.getByText(LECTURE_MANQUEE_DE_LA_LISTE).getAttribute('title')).toBe('Seul le cabinet lit les RIB à confirmer.')
  })
  it('la section de la ligne discrète porte le nom de sa phrase', () => {
    monter({ etat: 'illisible' })
    expect(screen.getByRole('region', { name: LECTURE_MANQUEE_DE_LA_LISTE })).toBeTruthy()
  })
})
