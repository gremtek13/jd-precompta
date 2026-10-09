import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SuperPdpModal from './SuperPdpModal'
import type { ConnexionPlateformeVue, DrapeauxPlateforme, ReponsePlateforme } from '../../lib/receptionPlateforme'

// LA SYNCHRONISATION SUPER PDP ET LA PLATEFORME DU CLIENT (ligne 28.5) reçoivent toutes deux les factures du dossier,
// et une facture reçue par les deux chemins entrerait deux fois : la synchronisation enregistre un résumé texte de la
// facture, la plateforme son original, donc l'empreinte d'un fichier ne les rapproche pas. La fenêtre « Plateforme du
// client » le dit quand la synchronisation est configurée ; celle-ci le dit quand la plateforme est reliée.
// Ouvrir la fenêtre ne synchronise rien — une synchronisation appelle Super PDP, et seul un clic la déclenche : le test
// le garde aussi.
const faux = vi.hoisted(() => ({
  appels: [] as { nom: string; body: unknown }[],
  lecturesPlateforme: [] as string[],
  plateforme: null as unknown,
  // La réponse de `superpdp-sync` attend `porteSynchronisation` quand le test la pose — la fenêtre pendant laquelle un
  // second clic arrive — et porte `refusSynchronisation` quand il y en a un.
  porteSynchronisation: null as Promise<void> | null,
  refusSynchronisation: null as string | null,
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    functions: {
      invoke: (nom: string, options: { body: unknown }) => {
        faux.appels.push({ nom, body: options.body })
        if (nom === 'superpdp-sync') {
          const repondre = () => (faux.refusSynchronisation
            ? { data: { error: faux.refusSynchronisation }, error: null }
            : { data: { importees: 0, deja_connues: 2, en_attente_traitement: 0, erreurs: [] }, error: null })
          return (faux.porteSynchronisation ?? Promise.resolve()).then(repondre)
        }
        return Promise.resolve({ data: { configured: true, client_id: 'app-cabinet' }, error: null })
      },
    },
  },
}))

vi.mock('../../lib/receptionPlateforme', () => ({
  lireConnexionPlateforme: (dossierId: string) => {
    faux.lecturesPlateforme.push(dossierId)
    return Promise.resolve(faux.plateforme)
  },
}))

const SANS_DRAPEAU: DrapeauxPlateforme = {
  definitif: false, raison: null, perimee: false, acces_refuse: false, identifiants_refuses: false,
}

const connexion: ConnexionPlateformeVue = {
  nom: 'Plateforme Alpha', url_flux: 'https://pa.exemple.fr/afnor', url_jeton: 'https://pa.exemple.fr/jeton',
  hote: 'pa.exemple.fr', client_id: 'cabinet', organisation_id: null, portee: null, recherche_depuis: null,
  derniere_recuperation: null, cycle_vie_depuis: null, cycle_vie_lu_le: null, created_at: '2026-10-01T10:00:00.000Z',
  version: 'v1',
}

function repondre(reponse: ReponsePlateforme<{ connexion: ConnexionPlateformeVue | null }>) {
  faux.plateforme = reponse
}

async function ouvrir() {
  await act(async () => { render(<SuperPdpModal dossierId="d1" onClose={() => {}} onImported={() => {}} />) })
}

beforeEach(() => {
  faux.appels = []
  faux.lecturesPlateforme = []
  faux.porteSynchronisation = null
  faux.refusSynchronisation = null
  repondre({ donnees: { connexion: null }, erreur: null, drapeaux: SANS_DRAPEAU })
})

describe('SuperPdpModal — la plateforme du client reliée au même dossier', () => {
  it('une plateforme reliée : la fenêtre le dit, en la nommant', async () => {
    repondre({ donnees: { connexion }, erreur: null, drapeaux: SANS_DRAPEAU })
    await ouvrir()
    expect(screen.getByText(/La plateforme du client \(Plateforme Alpha\) est aussi reliée à ce dossier/)).toBeTruthy()
    expect(screen.getByText(/entrerait deux fois\. N’en gardez qu’un\./)).toBeTruthy()
  })

  it('aucune plateforme reliée : rien n’est dit (garde symétrique)', async () => {
    await ouvrir()
    // Ancre : la fenêtre a fini de lire — sans elle, l'absence passerait sur un écran encore en chargement.
    expect(screen.getByText('Configuré')).toBeTruthy()
    expect(faux.lecturesPlateforme).toEqual(['d1'])
    expect(screen.queryByText(/entrerait deux fois/)).toBeNull()
  })

  it('une lecture refusée ne passe pas pour « aucune plateforme » : elle se dit', async () => {
    repondre({ donnees: null, erreur: 'Accès refusé à ce dossier.', drapeaux: SANS_DRAPEAU })
    await ouvrir()
    expect(screen.getByText(
      /La connexion à la plateforme du client n’a pas pu être lue \(Accès refusé à ce dossier\.\) : si elle est reliée/,
    )).toBeTruthy()
    expect(screen.queryByText(/est aussi reliée/)).toBeNull()
  })

  it('ouvrir la fenêtre ne synchronise rien : le statut et la connexion sont lus, et c’est tout', async () => {
    await ouvrir()
    expect(screen.getByText('Configuré')).toBeTruthy()
    expect(faux.appels).toEqual([{ nom: 'superpdp-credentials', body: { dossierId: 'd1', action: 'status' } }])
    expect(faux.lecturesPlateforme).toEqual(['d1'])
  })
})

// « SYNCHRONISER MAINTENANT » NE SE PROTÉGEAIT QUE PAR UN ÉTAT (09/10/2026). `disabled={syncing}` ne prend effet qu'au rendu
// suivant : deux clics du même rendu lançaient deux synchronisations — deux séries d'appels à Super PDP pour les mêmes
// factures, la seconde se heurtant aux pièces que la première vient d'écrire. Le cas à TROIS clics est le seul à
// distinguer un verrou posé dans le `try`.
describe('SuperPdpModal — le verrou de la synchronisation', () => {
  const synchronisations = () => faux.appels.filter((a) => a.nom === 'superpdp-sync')
  function retenirLaSynchronisation(): () => Promise<void> {
    let ouvrirPorte = () => {}
    faux.porteSynchronisation = new Promise<void>((resolve) => { ouvrirPorte = resolve })
    return async () => {
      faux.porteSynchronisation = null
      await act(async () => { ouvrirPorte() })
    }
  }
  async function boutonDeSynchronisation() {
    await ouvrir()
    return screen.getByRole('button', { name: 'Synchroniser maintenant' }) as HTMLButtonElement
  }

  it('ne synchronise qu’une fois quand le bouton part deux fois dans le même rendu', async () => {
    const bouton = await boutonDeSynchronisation()
    const liberer = retenirLaSynchronisation()

    await act(async () => { bouton.click(); bouton.click() })

    expect(synchronisations()).toHaveLength(1)
    expect(bouton.disabled).toBe(true)
    expect(bouton.textContent).toBe('Synchronisation…')
    await liberer()
    expect(screen.getByText(/2 déjà connue\(s\)/)).toBeTruthy()
  })

  it('trois clics dans le même rendu ne synchronisent qu’une fois', async () => {
    const bouton = await boutonDeSynchronisation()
    const liberer = retenirLaSynchronisation()

    await act(async () => { bouton.click(); bouton.click(); bouton.click() })

    expect(synchronisations()).toHaveLength(1)
    await liberer()
  })

  it('relâche le verrou sur un refus, et le dit', async () => {
    faux.refusSynchronisation = 'Identifiants refusés par Super PDP.'
    const bouton = await boutonDeSynchronisation()

    await act(async () => { bouton.click() })
    expect(screen.getByText('Identifiants refusés par Super PDP.')).toBeTruthy()
    await act(async () => { bouton.click() })

    expect(synchronisations()).toHaveLength(2)
  })
})
