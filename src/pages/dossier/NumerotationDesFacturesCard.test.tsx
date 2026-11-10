import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../../test/ecrans'
import { AnneeProvider, useAnnee } from '../../context/AnneeContext'
import { seriesLues, paroleLue, modelePose } from '../../lib/numerotationContinueCarte'
import type { LectureDeLaNumerotation } from '../../lib/numerotationContinueLecture'

// LA CARTE « NUMÉROTATION DES FACTURES » (ligne 51.5, étape A9b) : ce qu'aucun calcul pur ne voit — le drapeau (les deux états :
// baissé, la carte ne rend ni ne lit rien ; levé, elle lit et offre), « Chargement… » avant la lecture, l'absence de tout geste
// sur une lecture illisible ou pour un membre de l'équipe, le refus dit avant le clic, la confirmation qui nomme ce qui se fige,
// le verrou (deux clics du même `act`, un seul appel), et la relecture après le geste. Données FICTIVES.

const etat = vi.hoisted(() => ({ prevue: false, chef: true }))
const appels = vi.hoisted(() => ({ lire: vi.fn(), poser: vi.fn(), confirmer: vi.fn(), lever: vi.fn() }))

vi.mock('../../lib/numerotationContinue', async (original) => {
  const reel = await original<typeof import('../../lib/numerotationContinue')>()
  return { ...reel, get NUMEROTATION_CONTINUE_PREVUE() { return etat.prevue }, get CARTE_DE_LA_NUMEROTATION_OFFERTE() { return etat.prevue } }
})
vi.mock('../../lib/numerotationContinueLecture', () => ({
  lireLaNumerotation: appels.lire, poserLeModele: appels.poser, confirmerLaFin: appels.confirmer, leverLesTrous: appels.lever,
}))
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ estChef: etat.chef }) }))

import NumerotationDesFacturesCard from './NumerotationDesFacturesCard'

function ligne(nature: string, emetteur: string, modele: string, surcharge: Record<string, unknown> = {}) {
  return {
    nature, emetteur, modele, annuel: true, depuis: null, modele_par_defaut: true, premier: 1, emis: null, importes: 0, valides: 0,
    fin: null, trous: [], refus: null, prochain_numero: null, ...surcharge,
  }
}

function lecture(surcharge: Record<string, unknown> = {}, annee = 2026): LectureDeLaNumerotation {
  const series = seriesLues([
    ligne('facture', 'client', 'F{AAAA}-{N:4}', {
      importes: 8, emis: 8, fin: 10, trous: [[3, 4]], refus: 'La série du modèle F{AAAA}-{N:4} (2026) a des trous : F2026-0003 à F2026-0004.',
      ...surcharge,
    }),
    ligne('avoir', 'client', 'A{AAAA}-{N:4}', { prochain_numero: 'A2026-0001' }),
    ligne('facture', 'mandataire', 'M{AAAA}-{N:4}', { prochain_numero: 'M2026-0001' }),
    ligne('avoir', 'mandataire', 'MA{AAAA}-{N:4}', { prochain_numero: 'MA2026-0001' }),
  ])
  const paroles = [
    paroleLue({ id: 'p1', modele: 'F{AAAA}-{N:4}', annuel: true, annee: 2026, geste: 'fin', premier: 10, dernier: 10, motif: 'Dernier numéro du relevé', pose_le: '2026-11-10T10:00:00+00:00' }),
    paroleLue({ id: 'p2', modele: 'F{AAAA}-{N:4}', annuel: true, annee: 2026, geste: 'trous', premier: 6, dernier: 7, motif: 'Annulées dans l’ancien logiciel', pose_le: '2026-11-10T10:05:00+00:00' }),
  ]
  const modeles = [modelePose({ id: 'm1', nature: 'facture', emetteur: 'client', modele: 'F{AAAA}-{N:4}', annuel: true, depuis: 2025, premier_numero: 1 })]
  if (!series || paroles.includes(null) || modeles.includes(null)) throw new Error('le jeu d’essai se lit')
  return { dossierId: 'd1', annee, etat: 'lue', series, paroles: paroles as never, modeles: modeles as never }
}

const ILLISIBLE: LectureDeLaNumerotation = { dossierId: 'd1', annee: 2026, etat: 'illisible', motif: 'les modèles posés : lecture incomplète' }

function ChoixDeLAnnee({ valeur }: { valeur: 'toutes' | number }) {
  const { setAnnee } = useAnnee()
  return <button type="button" onClick={() => setAnnee(valeur)}>choisir</button>
}

function monter(defaut: 'toutes' | number = 2026, dossierId = 'd1') {
  return render(
    <AnneeProvider defaut={defaut}>
      <ChoixDeLAnnee valeur={2027} />
      <NumerotationDesFacturesCard dossierId={dossierId} />
    </AnneeProvider>,
  )
}

beforeEach(() => {
  appels.lire.mockReset().mockResolvedValue(lecture())
  appels.poser.mockReset().mockResolvedValue({ ok: true })
  appels.confirmer.mockReset().mockResolvedValue({ ok: true })
  appels.lever.mockReset().mockResolvedValue({ ok: true })
  etat.prevue = true
  etat.chef = true
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})
afterEach(() => {
  etat.prevue = false
  vi.restoreAllMocks()
})

describe('le drapeau de la carte', () => {
  it('baissé : elle ne rend rien et ne lit rien (l’état d’avant)', () => {
    etat.prevue = false
    const { container } = monter()
    expect(container.querySelector('[data-testid="numerotation-des-factures"]')).toBeNull()
    expect(screen.queryByText('Numérotation des factures')).toBeNull()
    expect(appels.lire).not.toHaveBeenCalled()
  })

  it('levé : elle lit l’exercice du dossier et se montre', async () => {
    monter()
    expect(await screen.findByText('Numérotation des factures')).toBeTruthy()
    expect(appels.lire).toHaveBeenCalledWith('d1', 2026)
  })
})

describe('ce que la carte dit', () => {
  it('rien n’est affirmé ni offert avant le retour de la lecture', async () => {
    let rendre: (v: LectureDeLaNumerotation) => void = () => {}
    appels.lire.mockReturnValue(new Promise<LectureDeLaNumerotation>((r) => { rendre = r }))
    monter()
    expect(screen.getByText('Chargement…')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Poser le modèle|Confirmer la fin|Lever ces trous/ })).toBeNull()
    expect(screen.queryByText(/Modèle/)).toBeNull()
    await act(async () => { rendre(lecture()) })
    expect(screen.queryByText('Chargement…')).toBeNull()
    expect(screen.getByRole('button', { name: 'Poser le modèle' })).toBeTruthy()
  })

  it('pour chaque série : le modèle, un exemple, la fin confirmée, les trous nommés, ceux qui sont levés et leur motif', async () => {
    monter()
    const client = await screen.findByTestId('serie-facture-client')
    expect(within(client).getByText('Factures du client')).toBeTruthy()
    expect(client.textContent).toContain('F{AAAA}-{N:4}')
    expect(client.textContent).toContain('Exemple : F2026-0001')
    expect(client.textContent).toContain('Fin de la suite reprise confirmée : F2026-0010')
    expect(client.textContent).toContain('Dernier numéro du relevé')
    expect(client.textContent).toContain('Trous : F2026-0003 à F2026-0004')
    expect(client.textContent).toContain('Trous levés')
    expect(client.textContent).toContain('F2026-0006 à F2026-0007')
    expect(client.textContent).toContain('Annulées dans l’ancien logiciel')
    expect(client.textContent).toContain('Retient la prochaine validation')
    for (const id of ['serie-avoir-client', 'serie-facture-mandataire', 'serie-avoir-mandataire']) expect(screen.getByTestId(id)).toBeTruthy()
    expect(screen.getByTestId('serie-facture-mandataire').textContent).toContain('Prochain numéro : M2026-0001')
  })

  it('« toutes » les années : rien à lire, rien à écrire', async () => {
    monter('toutes')
    expect(await screen.findByText(/Choisis un exercice/)).toBeTruthy()
    expect(appels.lire).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Poser le modèle' })).toBeNull()
  })

  it('un autre exercice relit : « Chargement… » jusqu’à la bonne lecture, jamais celle de l’année d’avant', async () => {
    monter()
    await screen.findByTestId('serie-facture-client')
    let rendre: (v: LectureDeLaNumerotation) => void = () => {}
    appels.lire.mockReturnValue(new Promise<LectureDeLaNumerotation>((r) => { rendre = r }))
    fireEvent.click(screen.getByRole('button', { name: 'choisir' }))
    await waitFor(() => expect(appels.lire).toHaveBeenLastCalledWith('d1', 2027))
    expect(screen.getByText('Chargement…')).toBeTruthy()
    expect(screen.queryByTestId('serie-facture-client')).toBeNull()
    await act(async () => { rendre(lecture({}, 2027)) })
    expect(screen.getByTestId('serie-facture-client')).toBeTruthy()
  })
})

describe('aucun geste sans lecture entière, ni pour un membre de l’équipe', () => {
  it('lue en partie, refusée ou rompue : elle le dit et n’offre AUCUN geste', async () => {
    appels.lire.mockResolvedValue(ILLISIBLE)
    monter()
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringMatching(/les modèles posés : lecture incomplète.*Aucun geste/))
    expect(screen.queryByRole('button', { name: /Poser le modèle|Confirmer la fin|Lever ces trous/ })).toBeNull()
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.queryByTestId('serie-facture-client')).toBeNull()
  })

  it('un membre de l’équipe lit tout, et le dit : aucun geste', async () => {
    etat.chef = false
    monter()
    expect(await screen.findByTestId('serie-facture-client')).toBeTruthy()
    expect(screen.getByText(/Seul le chef du cabinet pose le modèle de numéro/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Poser le modèle|Confirmer la fin|Lever ces trous/ })).toBeNull()
  })
})

describe('le refus du module se dit AVANT le clic, sur la saisie telle qu’elle part', () => {
  it('poser un modèle : un texte refusé le dit et retient le bouton ; reçu, il donne son exemple', async () => {
    monter()
    const bouton = await screen.findByRole('button', { name: 'Poser le modèle' })
    expect(bouton).toHaveProperty('disabled', true)
    fireEvent.change(screen.getByLabelText('Modèle'), { target: { value: 'FAC{AAAA}' } })
    expect(screen.getByText(/porte un compteur, et un seul/)).toBeTruthy()
    expect(bouton).toHaveProperty('disabled', true)
    fireEvent.change(screen.getByLabelText('Modèle'), { target: { value: 'FAC{AAAA}-{N:5}' } })
    expect(screen.getByText('Exemple : FAC2026-00001')).toBeTruthy()
    expect(bouton).toHaveProperty('disabled', false)
    fireEvent.change(screen.getByLabelText('À partir de l’année'), { target: { value: '1999' } })
    expect(screen.getByText(/de 2000 à 2099/)).toBeTruthy()
    expect(bouton).toHaveProperty('disabled', true)
    fireEvent.click(bouton)
    expect(appels.poser).not.toHaveBeenCalled()
  })

  it('poser le modèle du client aux séries du cabinet : la racine propre, dite avant le clic', async () => {
    monter()
    await screen.findByRole('button', { name: 'Poser le modèle' })
    fireEvent.change(screen.getByLabelText('Série'), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText('Modèle'), { target: { value: 'F{AAAA}-{N:4}' } })
    expect(screen.getByText(/porte une racine propre, distincte de celle du client/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Poser le modèle' })).toHaveProperty('disabled', true)
  })

  it('confirmer la fin : le motif, les bornes et la fin qui ne recule pas, dits avant le clic', async () => {
    monter()
    const bouton = await screen.findByRole('button', { name: 'Confirmer la fin' })
    expect(bouton).toHaveProperty('disabled', true)
    fireEvent.change(screen.getByLabelText('Compteur du dernier numéro émis'), { target: { value: '7' } })
    expect(screen.getByText('Le cabinet écrit ce qui fonde son geste : un motif de 1 000 caractères au plus.')).toBeTruthy()
    fireEvent.change(screen.getAllByLabelText('Motif (ce qui fonde le geste)')[0], { target: { value: 'Relevé de l’ancien logiciel' } })
    expect(screen.getByText(/au moins 8 : le plus haut repris/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Compteur du dernier numéro émis'), { target: { value: '10' } })
    expect(screen.getByText(/déjà confirmée au numéro F2026-0010 : une fin confirmée ne recule pas/)).toBeTruthy()
    expect(bouton).toHaveProperty('disabled', true)
    fireEvent.change(screen.getByLabelText('Compteur du dernier numéro émis'), { target: { value: '11' } })
    expect(bouton).toHaveProperty('disabled', false)
  })

  it('lever des trous : seul un numéro qui manque se lève', async () => {
    monter()
    const bouton = await screen.findByRole('button', { name: 'Lever ces trous' })
    expect(screen.getByText(/Compteurs qui manquent : 3 à 4/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Du compteur'), { target: { value: '5' } })
    fireEvent.change(screen.getByLabelText('Au compteur'), { target: { value: '5' } })
    fireEvent.change(screen.getAllByLabelText('Motif (ce qui fonde le geste)')[1], { target: { value: 'Annulé' } })
    expect(screen.getByText(/ne sont pas un trou de la série du modèle F\{AAAA\}-\{N:4\} \(2026\)/)).toBeTruthy()
    expect(bouton).toHaveProperty('disabled', true)
    fireEvent.change(screen.getByLabelText('Du compteur'), { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText('Au compteur'), { target: { value: '4' } })
    expect(bouton).toHaveProperty('disabled', false)
  })

  it('une série sans trou n’offre pas de levée', async () => {
    appels.lire.mockResolvedValue(lecture({ trous: [], refus: null }))
    monter()
    await screen.findByRole('button', { name: 'Confirmer la fin' })
    expect(screen.getByText('Cette série n’a aucun trou à lever.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Lever ces trous' })).toBeNull()
  })
})

describe('un geste : confirmation qui nomme ce qui se fige, fonction SQL seule, verrou, relecture', () => {
  async function remplirLaFin() {
    const bouton = await screen.findByRole('button', { name: 'Confirmer la fin' })
    fireEvent.change(screen.getByLabelText('Compteur du dernier numéro émis'), { target: { value: '12' } })
    fireEvent.change(screen.getAllByLabelText('Motif (ce qui fonde le geste)')[0], { target: { value: 'Relevé de l’ancien logiciel' } })
    return bouton
  }

  it('confirmer la fin : la confirmation nomme le numéro et dit qu’elle ne se retire jamais ; un seul appel sous deux clics ; relue ensuite', async () => {
    let rendreLaRelecture: (v: LectureDeLaNumerotation) => void = () => {}
    const bouton = await (async () => { monter(); return remplirLaFin() })()
    appels.lire.mockReturnValue(new Promise<LectureDeLaNumerotation>((r) => { rendreLaRelecture = r }))
    await act(async () => {
      fireEvent.click(bouton)
      fireEvent.click(bouton)
    })
    expect(window.confirm).toHaveBeenCalledTimes(1)
    const confirmation = vi.mocked(window.confirm).mock.calls[0][0] as string
    expect(confirmation).toContain('F2026-0012')
    expect(confirmation).toContain('Relevé de l’ancien logiciel')
    expect(confirmation).toMatch(/ne se retire jamais/)
    expect(appels.confirmer).toHaveBeenCalledTimes(1)
    expect(appels.confirmer).toHaveBeenCalledWith({
      p_dossier_id: 'd1', p_nature: 'facture', p_emetteur: 'client', p_annee: 2026, p_dernier: 12, p_motif: 'Relevé de l’ancien logiciel',
    })
    // Tant que la relecture n'est pas revenue, le geste reste en cours : les boutons sont retenus.
    for (const b of screen.getAllByRole('button', { name: /Enregistrement…/ })) expect(b).toHaveProperty('disabled', true)
    expect(appels.confirmer).toHaveBeenCalledTimes(1)
    expect(appels.lire).toHaveBeenCalledTimes(2)
    await act(async () => { rendreLaRelecture(lecture({ fin: 12, emis: 12, trous: [[11, 11]] })) })
    expect(await screen.findByText(/La fin de la suite reprise est confirmée au numéro F2026-0012/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Confirmer la fin' })).toBeTruthy()
    // Les champs du geste réussi sont vidés.
    expect(screen.getByLabelText('Compteur du dernier numéro émis')).toHaveProperty('value', '')
  })

  it('une confirmation refusée n’écrit rien et relâche le verrou', async () => {
    vi.mocked(window.confirm).mockReturnValue(false)
    monter()
    const bouton = await remplirLaFin()
    await act(async () => { fireEvent.click(bouton) })
    expect(appels.confirmer).not.toHaveBeenCalled()
    vi.mocked(window.confirm).mockReturnValue(true)
    await act(async () => { fireEvent.click(bouton) })
    expect(appels.confirmer).toHaveBeenCalledTimes(1)
  })

  it('le refus de la base se dit sous ses mots, et la carte relit quand même', async () => {
    appels.confirmer.mockResolvedValue({ ok: false, message: 'L\'application a déjà continué la série du modèle F{AAAA}-{N:4} (2026).' })
    monter()
    const bouton = await remplirLaFin()
    await act(async () => { fireEvent.click(bouton) })
    expect(await screen.findByText(/Rien n’a changé : L'application a déjà continué la série/)).toBeTruthy()
    expect(appels.lire).toHaveBeenCalledTimes(2)
  })

  it('poser un modèle : un seul appel sous deux clics, aux paramètres exacts, la confirmation nomme l’exemple', async () => {
    monter()
    const bouton = await screen.findByRole('button', { name: 'Poser le modèle' })
    fireEvent.change(screen.getByLabelText('Modèle'), { target: { value: 'FAC{AAAA}-{N:5}' } })
    fireEvent.change(screen.getByLabelText('Premier numéro'), { target: { value: '12' } })
    await act(async () => {
      fireEvent.click(bouton)
      fireEvent.click(bouton)
    })
    expect(appels.poser).toHaveBeenCalledTimes(1)
    expect(appels.poser).toHaveBeenCalledWith({
      p_dossier_id: 'd1', p_nature: 'facture', p_emetteur: 'client', p_modele: 'FAC{AAAA}-{N:5}', p_annuel: true, p_depuis: 2026,
      p_premier_numero: 12,
    })
    expect(vi.mocked(window.confirm).mock.calls[0][0]).toContain('FAC2026-00012')
    await waitFor(() => expect(appels.lire).toHaveBeenCalledTimes(2))
    expect(await screen.findByText(/Le modèle « FAC\{AAAA\}-\{N:5\} » est posé/)).toBeTruthy()
  })

  it('lever des trous : un seul appel sous deux clics, la confirmation nomme les numéros et le motif', async () => {
    monter()
    const bouton = await screen.findByRole('button', { name: 'Lever ces trous' })
    fireEvent.change(screen.getByLabelText('Du compteur'), { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText('Au compteur'), { target: { value: '4' } })
    fireEvent.change(screen.getAllByLabelText('Motif (ce qui fonde le geste)')[1], { target: { value: 'Annulés dans l’ancien logiciel' } })
    await act(async () => {
      fireEvent.click(bouton)
      fireEvent.click(bouton)
    })
    expect(appels.lever).toHaveBeenCalledTimes(1)
    expect(appels.lever).toHaveBeenCalledWith({
      p_dossier_id: 'd1', p_nature: 'facture', p_emetteur: 'client', p_annee: 2026, p_premier: 3, p_dernier: 4,
      p_motif: 'Annulés dans l’ancien logiciel',
    })
    const confirmation = vi.mocked(window.confirm).mock.calls[0][0] as string
    expect(confirmation).toContain('F2026-0003 à F2026-0004')
    expect(confirmation).toContain('Annulés dans l’ancien logiciel')
    await waitFor(() => expect(appels.lire).toHaveBeenCalledTimes(2))
  })

  it('la relecture qui revient illisible retire tout geste', async () => {
    appels.lire.mockResolvedValueOnce(lecture()).mockResolvedValueOnce(ILLISIBLE)
    monter()
    const bouton = await remplirLaFin()
    await act(async () => { fireEvent.click(bouton) })
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Confirmer la fin' })).toBeNull()
  })
})
