import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ClientLettresDeMission from './ClientLettresDeMission'
import { motsDuCabinet } from '../lib/espaceVentes'
import { COMMENT_ACCEPTER, REFUS_DU_PDF_SANS_EMPREINTE, lettresDuClientRendues, type LettreDuClient } from '../lib/lettresDuClient'
import type { LettresDuClientLues } from '../lib/lettresDuClientLecture'

// « Mes lettres de mission » (étape LM6) : la lecture est mockée, le tirage du PDF et son téléchargement aussi. L'écran
// garde : rien avant le retour ; un refus et une valeur illisible se disent, sans aucune lettre ni « aucune » ; le vide d'une
// valeur entière seulement ; la proposition dit comment accepter hors ligne (aucun bouton n'écrit) ; le PDF se refuse d'une
// lettre dont l'empreinte n'est pas retrouvée ; deux clics du même `act` ne tirent qu'un PDF ; les mots du client.

const faux = vi.hoisted(() => ({
  lecture: null as LettresDuClientLues | null,
  tirages: 0,
  telechargements: [] as string[],
  retenir: [] as (() => void)[],
}))

vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ dossierActifId: 'd1' }) }))
vi.mock('../lib/lettresDuClientLecture', () => ({
  lireLesLettresDuClient: () => (faux.lecture ? Promise.resolve(faux.lecture) : new Promise(() => {})),
}))
vi.mock('../lib/pdfLettreDeMission', () => ({
  pdfDeLaLettre: () => { faux.tirages++; return new Promise((r) => { faux.retenir.push(() => r(new Uint8Array([1]))) }) },
}))
vi.mock('../lib/apercu', () => ({
  telechargerUnPdf: (_o: Uint8Array, nom: string) => { faux.telechargements.push(nom); return { ok: true } },
}))

afterEach(() => { faux.lecture = null; faux.tirages = 0; faux.telechargements = []; faux.retenir = [] })

const lettre = (p: Record<string, unknown> = {}): LettreDuClient => lettresDuClientRendues({
  dossier_du_cabinet_designe: true,
  lettres: [{
    id: 'l1', remplace_id: null, missions: ['tenue_comptable'], repartition: [{ tache: 'Transmettre', par: 'client' }],
    honoraires: [{ forme: 'forfait', libelle: 'Tenue trimestrielle', montant_ht: 4321.98, periodicite: 'trimestre' }],
    date_effet: '2026-01-01', premier_exercice: 2026, fin_initiale: '2026-12-31', reconduction_tacite: true, preavis_mois: 3,
    signataire_nom: 'Jeanne Essai', signataire_qualite: 'Titulaire', signataire_designe: true,
    identite_client: { denomination: 'CLIENT' }, identite_cabinet: { denomination: 'CABINET' }, clauses: ['sous_traitance'],
    modele: { id: 'm1', titre: 'Modèle', conditions_generales: 'CG', missions: { tenue_comptable: 'Tenir.' }, clauses: { sous_traitance: 'RGPD.' } },
    proposee_le: '2025-12-01T10:00:00+00:00', empreinte: 'b'.repeat(64), empreinte_verifiee: true, acceptee_le: null,
    mode_acceptation: null, signee_le: null, refusee_le: null, retiree_le: null, fin_au: null, ...p,
  }],
})!.lettres[0]
const lue = (lettres: LettreDuClient[]): LettresDuClientLues => ({ etat: 'lue', dossierId: 'd1', dossierDuCabinetDesigne: true, lettres })

describe('« Mes lettres de mission »', () => {
  it('rien avant le retour de la lecture', () => {
    render(<ClientLettresDeMission />)
    expect(screen.getByText('Chargement…')).toBeTruthy()
    expect(screen.queryByText(/aucune lettre/)).toBeNull()
  })

  it('un refus et une valeur illisible se disent, sans « aucune lettre »', async () => {
    faux.lecture = { etat: 'refusee', dossierId: 'd1', motif: 'Accès refusé à ce dossier.' }
    const { unmount } = render(<ClientLettresDeMission />)
    await waitFor(() => expect(screen.getByText(/ne te sont pas ouvertes/)).toBeTruthy())
    expect(screen.queryByText(/aucune lettre/)).toBeNull()
    unmount()
    faux.lecture = { etat: 'illisible', dossierId: 'd1', motif: 'la réponse ne se lit pas telle quelle' }
    render(<ClientLettresDeMission />)
    await waitFor(() => expect(screen.getByText(/n’ont pas pu être lues/)).toBeTruthy())
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('le vide d’une valeur lue entière', async () => {
    faux.lecture = lue([])
    render(<ClientLettresDeMission />)
    await waitFor(() => expect(screen.getByText('Ton cabinet ne t’a proposé aucune lettre de mission.')).toBeTruthy())
  })

  it('une proposition : ses honoraires, comment l’accepter hors ligne, qui signe ; aucun bouton n’écrit ; les mots du client', async () => {
    faux.lecture = lue([lettre()])
    const { container } = render(<ClientLettresDeMission />)
    await waitFor(() => expect(screen.getByText(COMMENT_ACCEPTER)).toBeTruthy())
    expect(screen.getByText('Ton cabinet t’a désigné pour la signer.')).toBeTruthy()
    expect(container.textContent).toContain('Tenue trimestrielle')
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Télécharger la lettre (PDF)'])
    expect(motsDuCabinet(container.textContent ?? '')).toEqual([])
  })

  it('le PDF se refuse d’une lettre dont l’empreinte n’est pas retrouvée', async () => {
    faux.lecture = lue([lettre({ empreinte_verifiee: false })])
    render(<ClientLettresDeMission />)
    const bouton = await screen.findByRole('button', { name: 'Télécharger la lettre (PDF)' })
    await act(async () => { fireEvent.click(bouton) })
    expect(screen.getByRole('alert').textContent).toBe(REFUS_DU_PDF_SANS_EMPREINTE)
    expect(faux.tirages).toBe(0)
  })

  it('deux clics du même act ne tirent qu’un PDF, téléchargé sous son nom', async () => {
    faux.lecture = lue([lettre()])
    render(<ClientLettresDeMission />)
    const bouton = await screen.findByRole('button', { name: 'Télécharger la lettre (PDF)' })
    act(() => { fireEvent.click(bouton); fireEvent.click(bouton) })
    expect(faux.tirages).toBe(1)
    await act(async () => { faux.retenir.forEach((r) => r()) })
    await waitFor(() => expect(faux.telechargements).toEqual(['lettre-de-mission-2025-12-01-bbbbbbbb.pdf']))
  })
})
