import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ClientComptes from './ClientComptes'
import { motsDuCabinet } from '../lib/espaceVentes'
import { composerLaSituation, type SituationDuMoteur, type SituationPubliee } from '../lib/situationsPubliees'
import type { LectureDuClient } from '../lib/situationsPublieesLecture'

// « Mes comptes » (étape C4b) : la lecture est mockée (lib/situationsPublieesLecture.ts a son propre test) ; l'écran garde ce
// qu'aucun calcul pur ne voit — rien avant le retour, une lecture partielle ou refusée dite sans chiffre, le vide affirmé
// d'une liste entière seulement, la plus récente montrée, N face à N−1, aucun geste, les mots du client.

const faux = vi.hoisted(() => ({ reponse: null as Promise<LectureDuClient> | null }))

vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ dossierActifId: 'd1' }) }))
vi.mock('../lib/situationsPublieesLecture', () => ({
  lireLesSituationsDuClient: () => faux.reponse ?? new Promise(() => {}),
}))

afterEach(() => { faux.reponse = null })

const moteur = (debut: string, fin: string, totaux: [string, number][]): SituationDuMoteur => ({
  periodeDebut: debut, periodeFin: fin, totauxParPoste: totaux, ventesFactureesEcartees: [], fraisSansPoste: [],
  recettesDeCaisseSansPoste: [] })

function situation(id: string, arretee: string, publiee: string, avecN1 = true): SituationPubliee {
  const annee = Number(arretee.slice(0, 4))
  const r = composerLaSituation({
    arreteeAu: arretee, aujourdHui: '2026-11-06', anneesValidees: [],
    situation: moteur(`${annee}-01-01`, arretee, [['Recettes', 12500], ['Achats', -2300.5]]), tva: { assujetti: false },
    nMoins1: avecN1 ? { situation: moteur(`${annee - 1}-01-01`, `${annee - 1}${arretee.slice(4)}`, [['Recettes', 11000]]), tva: { assujetti: false } } : null,
  })
  if (!r.ok) throw new Error(r.refus)
  return { id, dossier_id: 'd1', annee, geste: 'publication', arretee_au: arretee, statut: 'provisoire', contenu: r.contenu,
    remplace_id: null, auteur: 'a', publiee_le: publiee }
}

const lue = (lignes: SituationPubliee[], complete = true): LectureDuClient =>
  ({ dossierId: 'd1', etat: 'lue', situations: { lignes, complete, motif: complete ? null : 'lecture interrompue' } })

describe('« Mes comptes »', () => {
  it('rien n’est affirmé avant le retour de la lecture', () => {
    render(<ClientComptes />)
    expect(screen.getByText('Chargement…')).toBeTruthy()
    expect(screen.queryByText(/aucune situation/)).toBeNull()
  })

  it('la plus récente situation, son statut, N face à N−1, en euros ; aucun geste, les mots du client', async () => {
    faux.reponse = Promise.resolve(lue([situation('a', '2025-03-31', '2025-04-01T08:00:00Z'), situation('b', '2025-06-30', '2025-07-01T08:00:00Z')]))
    render(<ClientComptes />)
    expect(await screen.findByText(/Situation arrêtée au 30\/06\/2025/)).toBeTruthy()
    expect(screen.getByRole('heading', { level: 2 }).textContent).toContain('provisoire')
    const tableau = screen.getByRole('table')
    expect(tableau.textContent).toContain('2025')
    expect(tableau.textContent).toContain('2024')
    expect(tableau.textContent?.replace(/\s/g, ' ')).toContain('12 500,00')
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    // Deux situations en cours : le choix de celle qu'on lit, qui n'écrit rien.
    expect(screen.getByLabelText('Situation')).toBeTruthy()
    expect(motsDuCabinet(document.body.textContent ?? '')).toEqual([])
  })

  it('une liste lue en partie ne montre aucune situation, ni « aucune »', async () => {
    faux.reponse = Promise.resolve(lue([situation('b', '2025-06-30', '2025-07-01T08:00:00Z')], false))
    render(<ClientComptes />)
    expect(await screen.findByText(/pas pu être affichées en entier/)).toBeTruthy()
    expect(screen.queryByText(/Situation arrêtée/)).toBeNull()
    expect(screen.queryByText(/aucune situation/)).toBeNull()
  })

  it('le vide se dit d’une liste lue en entier ; la case retirée et l’échec se disent sans chiffre', async () => {
    faux.reponse = Promise.resolve(lue([]))
    const { unmount } = render(<ClientComptes />)
    expect(await screen.findByText('Ton cabinet ne t’a publié aucune situation pour l’instant.')).toBeTruthy()
    unmount()
    faux.reponse = Promise.resolve({ dossierId: 'd1', etat: 'sans_comptes' })
    const second = render(<ClientComptes />)
    expect(await screen.findByText(/ne porte plus « Comptes »/)).toBeTruthy()
    second.unmount()
    faux.reponse = Promise.resolve({ dossierId: 'd1', etat: 'echec', motif: 'refus' })
    render(<ClientComptes />)
    expect(await screen.findByText(/Tes comptes ne s’affichent pas : refus/)).toBeTruthy()
  })

  it('un contenu illisible ne montre aucun chiffre ; une réponse d’une autre société ne s’affiche pas', async () => {
    const abimee = { ...situation('b', '2025-06-30', '2025-07-01T08:00:00Z'), contenu: null }
    faux.reponse = Promise.resolve(lue([abimee]))
    const { unmount } = render(<ClientComptes />)
    expect(await screen.findByText(/Cette situation ne se lit pas/)).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
    unmount()
    faux.reponse = Promise.resolve({ ...lue([situation('b', '2025-06-30', '2025-07-01T08:00:00Z')]), dossierId: 'd2' })
    render(<ClientComptes />)
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.getByText('Chargement…')).toBeTruthy()
  })

  it('sans la comparaison publiée, une seule colonne, et la phrase le dit', async () => {
    faux.reponse = Promise.resolve(lue([situation('b', '2025-06-30', '2025-07-01T08:00:00Z', false)]))
    render(<ClientComptes />)
    expect(await screen.findByText(/ne l’a pas publiée avec l’exercice précédent/)).toBeTruthy()
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Poste', '2025'])
  })
})
