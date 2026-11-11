import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import DocumentsMisADisposition from './DocumentsMisADisposition'
import { REFUS } from '../../lib/documentsEtDemandes'
import type { DocumentsDuCabinetLus } from '../../lib/documentsEtDemandesLecture'
import type { DocumentDuCabinet } from '../../lib/documentsEtDemandesVue'

// « Documents mis à disposition », côté cabinet (étape B3a). La lecture et le dépôt sont mockés ; le retrait, par `rpc`.
// L'écran garde ce qu'aucun calcul pur ne voit : rien avant le retour, aucun geste sur une lecture partielle, le refus dit
// avant le clic, la confirmation qui nomme le document et qui le lira, un seul envoi pour deux clics, la relecture après
// chaque geste, et qui a ouvert chaque document.

const faux = vi.hoisted(() => ({
  lecture: null as DocumentsDuCabinetLus | null,
  lectures: 0,
  publications: [] as { dossierId: string; saisie: unknown; fichier: File }[],
  appels: [] as { nom: string; args: Record<string, unknown> }[],
  retenir: [] as (() => void)[],
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: (nom: string, args: Record<string, unknown>) => {
      faux.appels.push({ nom, args })
      return new Promise((r) => { faux.retenir.push(() => r({ data: {}, error: null })) })
    },
  },
}))
vi.mock('../../lib/documentsEtDemandesLecture', () => ({
  lireLesDocumentsDuCabinet: () => { faux.lectures++; return faux.lecture ? Promise.resolve(faux.lecture) : new Promise(() => {}) },
}))
vi.mock('../../lib/documentsEtDemandesEcriture', () => ({
  deposerEtPublierUnDocument: (dossierId: string, saisie: unknown, fichier: File) => {
    faux.publications.push({ dossierId, saisie, fichier })
    return new Promise((r) => { faux.retenir.push(() => r({ ok: true, document: { titre: 'Liasse 2025' } })) })
  },
}))

afterEach(() => { faux.lecture = null; faux.lectures = 0; faux.publications = []; faux.appels = []; faux.retenir = [] })

const document = (p: Partial<DocumentDuCabinet>): DocumentDuCabinet => ({
  id: 'doc1', dossier_id: 'd1', titre: 'Liasse 2024', nature: 'liasse', exercice: 2024, chemin: 'd1/doc1/x.pdf',
  nom_fichier: 'liasse-2024.pdf', sha256: 'a'.repeat(64), taille: 10, type_mime: 'application/pdf', publie_par: 'u0',
  publie_le: '2026-05-02T08:00:00Z', retire_par: null, retire_le: null, ...p,
})
const lecture = (documents: DocumentDuCabinet[], p: Partial<DocumentsDuCabinetLus> = {}): DocumentsDuCabinetLus => ({
  dossierId: 'd1',
  documents: { lignes: documents, complete: true, motif: null },
  lectures: { lignes: [{ id: 'l1', dossier_id: 'd1', document_id: 'doc1', lecteur: 'u1', lu_le: '2026-05-03T08:00:00Z' }], complete: true, motif: null },
  acces: { lignes: [{ user_id: 'u1', email: 'client@exemple.fr', droit_documents: true }], complete: true, motif: null },
  ...p,
})
const PDF = () => new File([new TextEncoder().encode('%PDF-1.7 fictif')], 'liasse-2025.pdf', { type: 'application/pdf' })

async function saisir(titre: string, f: File) {
  fireEvent.change(screen.getByLabelText(/Titre \(le client « Documents » le lit\)/), { target: { value: titre } })
  fireEvent.change(screen.getByLabelText('Nature'), { target: { value: 'liasse' } })
  fireEvent.change(screen.getByLabelText('Exercice (facultatif)'), { target: { value: '2025' } })
  await act(async () => { fireEvent.change(screen.getByLabelText(/^Fichier/), { target: { files: [f] } }) })
}

describe('les documents mis à disposition (cabinet)', () => {
  it('rien n’est offert ni affirmé avant le retour de la lecture', () => {
    render(<DocumentsMisADisposition dossierId="d1" />)
    expect(screen.getByText('Chargement…')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Publier le document' })).toBeNull()
  })

  it('la confirmation nomme le document et qui le lira ; deux clics, un seul dépôt ; puis la relecture', async () => {
    faux.lecture = lecture([])
    render(<DocumentsMisADisposition dossierId="d1" />)
    expect(await screen.findByText('Aucun document n’est mis à disposition de ce dossier.')).toBeTruthy()
    await saisir('Liasse 2025', PDF())
    fireEvent.click(screen.getByRole('button', { name: 'Publier le document' }))
    const fenetre = screen.getByRole('alertdialog')
    expect(fenetre.textContent).toContain('Publier « Liasse 2025 » — La liasse fiscale, exercice 2025')
    expect(fenetre.textContent).toContain('« liasse-2025.pdf »')
    expect(fenetre.textContent).toContain('Le liront, dans leur espace : client@exemple.fr')
    const bouton = screen.getByRole('button', { name: 'Déposer et publier' })
    act(() => { fireEvent.click(bouton); fireEvent.click(bouton) })
    expect(faux.publications).toHaveLength(1)
    expect(faux.publications[0]).toMatchObject({ dossierId: 'd1', saisie: { titre: 'Liasse 2025', nature: 'liasse', exercice: 2025 } })
    const avant = faux.lectures
    await act(async () => { faux.retenir.forEach((r) => r()) })
    await waitFor(() => expect(faux.lectures).toBe(avant + 1))
    expect(await screen.findByText('Le document « Liasse 2025 » est publié.')).toBeTruthy()
  })

  it('le refus se dit avant le clic : un exercice hors des bornes, un fichier qui n’est pas un PDF, JPEG ou PNG', async () => {
    faux.lecture = lecture([])
    render(<DocumentsMisADisposition dossierId="d1" />)
    await screen.findByText('Aucun document n’est mis à disposition de ce dossier.')
    await saisir('Liasse', PDF())
    fireEvent.change(screen.getByLabelText('Exercice (facultatif)'), { target: { value: '1999' } })
    expect(screen.getByText(REFUS.exercice)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Publier le document' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Exercice (facultatif)'), { target: { value: '' } })
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/^Fichier/), { target: { files: [new File(['<svg/>'], 'a.pdf', { type: 'application/pdf' })] } })
    })
    expect(await screen.findByText(/un document mis à disposition se dépose en PDF, JPEG ou PNG/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Publier le document' }) as HTMLButtonElement).disabled).toBe(true)
    expect(faux.publications).toHaveLength(0)
  })

  it('qui a ouvert chaque document ; « Retirer » nomme le document et passe par sa fonction, un appel pour deux clics', async () => {
    faux.lecture = lecture([document({}), document({ id: 'doc2', titre: 'Ancien courrier', retire_le: '2026-06-01T08:00:00Z', retire_par: 'u0' })])
    render(<DocumentsMisADisposition dossierId="d1" />)
    expect(await screen.findByText('client@exemple.fr')).toBeTruthy()
    expect(screen.getByText(/Retiré le 01\/06\/2026/)).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Retirer' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Retirer' }))
    expect(screen.getByRole('alertdialog').textContent).toContain('« Liasse 2024 »')
    expect(screen.getByRole('alertdialog').textContent).toContain('sa première ouverture')
    const bouton = screen.getByRole('button', { name: 'Retirer le document' })
    act(() => { fireEvent.click(bouton); fireEvent.click(bouton) })
    expect(faux.appels).toEqual([{ nom: 'retirer_document_du_cabinet', args: { p_document_id: 'doc1' } }])
    await act(async () => { faux.retenir.forEach((r) => r()) })
    expect(await screen.findByText('Le document « Liasse 2024 » est retiré.')).toBeTruthy()
  })

  it('une lecture partielle des documents ou des accès n’offre aucun geste et ne dit pas le vide', async () => {
    faux.lecture = lecture([document({})], { acces: { lignes: [], complete: false, motif: 'lecture interrompue' } })
    render(<DocumentsMisADisposition dossierId="d1" />)
    expect(await screen.findByText(/Les accès du dossier n'ont pas pu être lus en entier/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Retirer' })).toBeNull()
    expect(screen.queryByText(/Aucun document/)).toBeNull()
    await saisir('Liasse 2025', PDF())
    expect((screen.getByRole('button', { name: 'Publier le document' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
