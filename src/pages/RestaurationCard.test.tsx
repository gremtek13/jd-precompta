import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RestaurationCard from './RestaurationCard'
import type { EcartRestauration, ResultatRestauration, SauvegardeDossier } from '../lib/sauvegardeDonnees'
import { EXPLICATION_REDEPOSE, explicationDuDepotEchoue } from '../lib/sauvegardeLogos'

// LA CARTE DE LA RESTAURATION ET LES LOGOS DES FACTURES (étape A5c2b). Ce qu'aucun calcul pur ne voit : AVANT le clic, la
// carte dit ce que la sauvegarde porte des logos ; APRÈS, le bilan de chaque logo — redéposé, ou non et pourquoi —, que la
// relecture soit juste ou non ; un nouveau fichier choisi efface le bilan d'avant. La lecture du fichier, la restauration
// et la relecture sont simulées : leurs modules ont leurs propres tests.

const D = 'a5c00000-0000-4000-8000-0000000000d1'
const CA = `${D}/logos/${'a'.repeat(64)}.png`
const CB = `${D}/logos/${'b'.repeat(64)}.png`

const faux = vi.hoisted(() => ({
  sauvegarde: null as unknown,
  resultat: null as unknown,
  ecarts: [] as unknown[],
  restaurations: 0,
}))

vi.mock('../lib/sauvegardeFichier', () => ({ lireSauvegarde: async () => faux.sauvegarde }))
vi.mock('../lib/sauvegardeDonnees', () => ({
  restaurerSauvegarde: async () => { faux.restaurations += 1; return faux.resultat },
  verifierRestauration: async () => faux.ecarts,
}))

function sauvegarde(): SauvegardeDossier {
  const fichier = (chemin: string, empreinte: string) => ({ seau: 'ventes' as const, chemin, empreinte, type: 'image/png' as const, octets: 70, base64: 'AA==' })
  return {
    manifeste: {
      version: 2, dossierId: D, dossierNom: 'Atelier fictif', cabinetId: 'c1', faiteLe: '2026-10-17T10:00:00.000Z',
      lignesParTable: { dossiers: 1, parametres_facturation: 2 }, comptes: { obligatoires: [], facultatifs: [] },
      referencesExternes: [], liensPerdus: [], horsPerimetre: [],
      logos: { inclus: [{ chemin: CA, empreinte: 'a'.repeat(64), type: 'image/png', octets: 70 }], manquants: [] },
    },
    contenu: {
      dossiers: [{ id: D }],
      parametres_facturation: [
        { id: 'v1', dossier_id: D, logo_chemin: CA, logo_sha256: 'a'.repeat(64) },
        { id: 'v2', dossier_id: D, logo_chemin: CB, logo_sha256: 'b'.repeat(64), remplace_id: 'v1' },
      ],
    },
    fichiers: [fichier(CA, 'a'.repeat(64))],
  }
}

function resultat(logos: ResultatRestauration['logos']): ResultatRestauration {
  return { lignesParTable: { dossiers: 1, parametres_facturation: 2 }, partageesConservees: 0, liensReposes: 0, logos }
}

beforeEach(() => {
  faux.sauvegarde = sauvegarde()
  faux.resultat = resultat([
    { chemin: CA, empreinte: 'a'.repeat(64), issue: 'redepose', explication: EXPLICATION_REDEPOSE },
    { chemin: CB, empreinte: 'b'.repeat(64), issue: 'non_redepose', explication: explicationDuDepotEchoue('permission refusée') },
  ])
  faux.ecarts = []
  faux.restaurations = 0
})

async function choisir() {
  const champ = document.querySelector('input[type="file"]') as HTMLInputElement
  await act(async () => { fireEvent.change(champ, { target: { files: [new File(['{}'], 'sauvegarde.json', { type: 'application/json' })] } }) })
}
const restaurer = () => act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Restaurer « Atelier fictif »/ })) })

describe('la carte de la restauration et les logos des factures', () => {
  it('avant le clic : ce que la sauvegarde porte des logos, et ce qu’elle ne porte pas', async () => {
    render(<RestaurationCard />)
    await choisir()
    expect(await screen.findByText(/^Logos des factures : 1 fichier porté, .* ; 1 logo désigné que la sauvegarde ne porte pas\.$/)).toBeTruthy()
    expect(screen.queryByRole('list', { name: 'Bilan des logos des factures' })).toBeNull()
  })

  it('après : le bilan de chaque logo, une ligne chacun, la relecture juste', async () => {
    render(<RestaurationCard />)
    await choisir()
    await restaurer()
    const bilan = await screen.findByRole('list', { name: 'Bilan des logos des factures' })
    expect(within(bilan).getAllByRole('listitem').map((l) => l.textContent)).toEqual([
      `Redéposé — ${CA} : ${EXPLICATION_REDEPOSE}`,
      `Non redéposé — ${CB} : ${explicationDuDepotEchoue('permission refusée')}`,
    ])
    expect(screen.getByText(/^Restauration vérifiée/)).toBeTruthy()
  })

  it('un fichier qui n’est pas revenu : le bilan le dit, ET la relecture dit la restauration incomplète', async () => {
    faux.ecarts = [{ table: 'ventes', motif: 'fichier_absent', identite: CB }] satisfies EcartRestauration[]
    render(<RestaurationCard />)
    await choisir()
    await restaurer()
    expect(await screen.findByRole('list', { name: 'Bilan des logos des factures' })).toBeTruthy()
    expect(screen.getByText(/^Restauration terminée mais INCOMPLÈTE : 1 écart\(s\) à la relecture\. ventes fichier_absent/)).toBeTruthy()
    expect(screen.queryByText(/^Restauration vérifiée/)).toBeNull()
  })

  it('un nouveau fichier choisi efface le bilan d’avant', async () => {
    render(<RestaurationCard />)
    await choisir()
    await restaurer()
    await screen.findByRole('list', { name: 'Bilan des logos des factures' })
    await choisir()
    expect(screen.queryByRole('list', { name: 'Bilan des logos des factures' })).toBeNull()
    expect(faux.restaurations).toBe(1)
  })
})
