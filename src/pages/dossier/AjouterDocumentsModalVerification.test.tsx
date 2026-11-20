import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import AjouterDocumentsModal from './AjouterDocumentsModal'

// LA VÉRIFICATION D'UN FICHIER CHOISI SE DIT PENDANT QU'ELLE DURE (BOR6, essai du 20/11/2026 dans un vrai navigateur,
// outils/captures/refusDesBordereaux.mjs) : la lecture d'un gros PDF par pdf.js, qui y cherche un bordereau de
// télétransmission, a duré 15 secondes sans que la fenêtre montre rien. La lecture est tenue ici en attente, puis rendue.

const lecture = vi.hoisted(() => ({ rendre: null as null | ((bordereau: boolean) => void) }))

vi.mock('../../lib/refusDesBordereauxLecture', () => ({
  bordereauDansLeFichier: () => new Promise<boolean>((resoudre) => { lecture.rendre = resoudre }),
}))
vi.mock('../../lib/importFichiers', () => ({ chargerHashsExistants: vi.fn(), importerFichierDossier: vi.fn() }))
vi.mock('../../lib/supabase', () => ({ supabase: {} }))

describe('AjouterDocumentsModal — la vérification d’un fichier choisi', () => {
  it('dit la vérification pendant la lecture, puis montre le fichier retenu', async () => {
    render(<AjouterDocumentsModal dossierId="dossier-de-test" sousDossiers={[]} onClose={() => {}} onImported={() => {}} />)
    const champ = document.querySelector('input[type=file]') as HTMLInputElement
    const pdf = new File(['%PDF-1.7\n'], 'facture.pdf', { type: 'application/pdf' })
    await act(async () => { fireEvent.change(champ, { target: { files: [pdf] } }) })
    expect(screen.getByRole('status').textContent).toBe('Vérification de 1 fichier(s) avant l’envoi…')
    expect(screen.queryByText('facture.pdf')).toBeNull()
    await act(async () => { lecture.rendre?.(false) })
    expect(screen.queryByText(/Vérification de/)).toBeNull()
    expect(screen.getByText('facture.pdf')).toBeTruthy()
  })

  it('un bordereau lu se dit refusé, et la vérification s’efface', async () => {
    render(<AjouterDocumentsModal dossierId="dossier-de-test" sousDossiers={[]} onClose={() => {}} onImported={() => {}} />)
    const champ = document.querySelector('input[type=file]') as HTMLInputElement
    await act(async () => { fireEvent.change(champ, { target: { files: [new File(['%PDF-1.7\n'], 'lot.pdf')] } }) })
    await act(async () => { lecture.rendre?.(true) })
    expect(screen.queryByText(/Vérification de/)).toBeNull()
    expect(screen.getByText(/1 à la forme d’un bordereau de télétransmission/)).toBeTruthy()
  })
})
