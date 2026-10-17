import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SauvegardeCard from './SauvegardeCard'
import type { LogosDuManifeste } from '../../lib/sauvegardeLogos'

// LA CARTE DE LA SAUVEGARDE ET LE LOGO DES FACTURES (étape A5c2b). Ce qu'aucun calcul pur ne voit : un logo que la sauvegarde
// n'a pas pu lire se DIT à l'écran, en clair, sous le nom du fichier téléchargé — jamais seulement dans le repli « Ce que ce
// fichier ne contient pas », qu'on n'ouvre pas. La lecture du dossier est simulée : son module a ses propres tests.

const faux = vi.hoisted(() => ({ logos: undefined as unknown }))

vi.mock('../../lib/sauvegardeDonnees', () => ({
  exporterDossier: async () => ({
    manifeste: {
      version: 2, dossierId: 'd1', dossierNom: 'Atelier fictif', cabinetId: 'c1', faiteLe: '2026-10-17T10:00:00.000Z',
      lignesParTable: { dossiers: 1, parametres_facturation: 2 }, comptes: { obligatoires: [], facultatifs: [] },
      referencesExternes: [], liensPerdus: [], horsPerimetre: ['Une ligne de ce que la sauvegarde ne porte pas.'], logos: faux.logos,
    },
    contenu: { dossiers: [{ id: 'd1' }], parametres_facturation: [{ id: 'v1' }, { id: 'v2' }] },
    fichiers: [],
  }),
  telechargerSauvegarde: async () => 'sauvegarde_Atelier_fictif_2026-10-17.json',
}))

const MANQUE = 'Le stockage du dossier ne rend pas ce fichier (il manque au seau, ou la session qui sauvegarde ne le lit pas) : il '
  + 'n’est pas dans cette sauvegarde.'

beforeEach(() => { faux.logos = { inclus: [], manquants: [] } satisfies LogosDuManifeste })

async function sauvegarder() {
  render(<SauvegardeCard dossierId="d1" dossierNom="Atelier fictif" />)
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Télécharger la sauvegarde' })) })
  await screen.findByText('sauvegarde_Atelier_fictif_2026-10-17.json')
}

describe('la carte de la sauvegarde et le logo des factures', () => {
  it('dit, avant le clic, que le fichier porte le logo des factures — et qu’il est confidentiel', () => {
    render(<SauvegardeCard dossierId="d1" dossierNom="Atelier fictif" />)
    expect(screen.getByText(/s'il en a un, le\s+logo de ses factures/)).toBeTruthy()
    expect(screen.getByText(/le\s+seul fichier qu'aucun pack ne porte : le logo des factures/)).toBeTruthy()
    expect(screen.getByText(/le logo des factures, qui peut\s+porter le nom d'un entrepreneur individuel/)).toBeTruthy()
  })

  it('un logo que la sauvegarde ne porte pas : dit en clair, hors du repli, avec sa raison', async () => {
    faux.logos = { inclus: [], manquants: [{ chemin: 'c', empreinte: 'h', raison: 'absent', explication: MANQUE }] } satisfies LogosDuManifeste
    await sauvegarder()
    const dit = screen.getByRole('status')
    expect(dit.textContent).toBe('1 logo des factures n’est pas dans cette sauvegarde, que les versions des paramètres désignent '
      + `pourtant ; le reste du dossier y est. ${MANQUE}`)
    expect(dit.closest('details')).toBeNull()
    expect(dit.className).toBe('alerte-tva')
  })

  it('aucun manque : rien n’en est dit', async () => {
    faux.logos = {
      inclus: [{ chemin: 'c', empreinte: 'h', type: 'image/png', octets: 70 }], manquants: [],
    } satisfies LogosDuManifeste
    await sauvegarder()
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByText(/n’est pas dans cette sauvegarde/)).toBeNull()
  })
})
