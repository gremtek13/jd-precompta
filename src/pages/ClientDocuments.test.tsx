import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ClientDocuments from './ClientDocuments'
import { motsDuCabinet } from '../lib/espaceVentes'
import { SANS_LA_CASE_DOCUMENTS, type DocumentDuCabinet } from '../lib/documentsEtDemandesVue'
import type { MesDocumentsLus } from '../lib/documentsEtDemandesLecture'

// « Mes documents » (étape B3a) : la lecture est mockée ; l'ouverture (`ouvrirApercu`) et sa datation (`rpc`) aussi.
// L'écran garde : rien avant le retour ; la case relue à la base, sans elle aucun document ; une lecture partielle sans
// document ; le vide d'une liste entière seulement ; ouvrir date la lecture, une fois pour deux clics, puis la relecture ;
// un document qui ne s'ouvre pas ne se date pas ; les mots du client.

const faux = vi.hoisted(() => ({
  lecture: null as MesDocumentsLus | null,
  lectures: 0,
  ouvertures: [] as { seau: string; chemin: string }[],
  ouvre: true,
  appels: [] as { nom: string; args: Record<string, unknown> }[],
  retenir: [] as (() => void)[],
}))

vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ dossierActifId: 'd1' }) }))
vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: (nom: string, args: Record<string, unknown>) => {
      faux.appels.push({ nom, args })
      return Promise.resolve({ data: {}, error: null })
    },
  },
}))
vi.mock('../lib/apercu', () => ({
  ouvrirApercu: (seau: string, chemin: string) => {
    faux.ouvertures.push({ seau, chemin })
    return new Promise((r) => {
      faux.retenir.push(() => r(faux.ouvre ? { ok: true } : { ok: false, message: 'L’ouverture a été bloquée par le navigateur.' }))
    })
  },
}))
vi.mock('../lib/documentsEtDemandesLecture', () => ({
  lireMesDocuments: () => { faux.lectures++; return faux.lecture ? Promise.resolve(faux.lecture) : new Promise(() => {}) },
}))

afterEach(() => { faux.lecture = null; faux.lectures = 0; faux.ouvertures = []; faux.ouvre = true; faux.appels = []; faux.retenir = [] })

const document = (p: Partial<DocumentDuCabinet>): DocumentDuCabinet => ({
  id: 'doc1', dossier_id: 'd1', titre: 'Ta liasse 2025', nature: 'liasse', exercice: 2025, chemin: 'd1/doc1/x.pdf',
  nom_fichier: 'liasse.pdf', sha256: 'a'.repeat(64), taille: 10, type_mime: 'application/pdf', publie_par: 'u0',
  publie_le: '2026-05-02T08:00:00Z', retire_par: null, retire_le: null, ...p,
})
const lus = (documents: DocumentDuCabinet[], complete = true): MesDocumentsLus => ({
  dossierId: 'd1', etat: 'lus',
  documents: { lignes: documents, complete, motif: complete ? null : 'lecture interrompue' },
  lectures: { lignes: [], complete: true, motif: null },
})
// `document` nomme ici la fabrique d'un document du cabinet : la page se lit par `globalThis`.
const texteDeLEcran = () => globalThis.document.body.textContent ?? ''

describe('« Mes documents »', () => {
  it('rien avant le retour ; sans la case relue à la base, aucun document', async () => {
    const { unmount } = render(<ClientDocuments />)
    expect(screen.getByText('Chargement…')).toBeTruthy()
    unmount()
    faux.lecture = { dossierId: 'd1', etat: 'sans_documents' }
    render(<ClientDocuments />)
    expect(await screen.findByText(SANS_LA_CASE_DOCUMENTS)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Ouvrir' })).toBeNull()
  })

  it('une lecture partielle ne montre aucun document et ne dit pas le vide ; une liste entière vide le dit', async () => {
    faux.lecture = lus([document({})], false)
    const { unmount } = render(<ClientDocuments />)
    expect(await screen.findByText(/n'ont pas pu être affichés en entier|n'ont pas pu être lus en entier/)).toBeTruthy()
    expect(screen.queryByText('Ta liasse 2025')).toBeNull()
    unmount()
    faux.lecture = lus([])
    render(<ClientDocuments />)
    expect(await screen.findByText('Ton cabinet ne t’a publié aucun document pour l’instant.')).toBeTruthy()
  })

  it('ouvrir date la première lecture : une ouverture pour deux clics, puis la datation et la relecture', async () => {
    faux.lecture = lus([document({})])
    render(<ClientDocuments />)
    const bouton = await screen.findByRole('button', { name: 'Ouvrir' })
    act(() => { fireEvent.click(bouton); fireEvent.click(bouton) })
    expect(faux.ouvertures).toEqual([{ seau: 'documents-cabinet', chemin: 'd1/doc1/x.pdf' }])
    const avant = faux.lectures
    await act(async () => { faux.retenir.forEach((r) => r()) })
    expect(faux.appels).toEqual([{ nom: 'marquer_document_lu', args: { p_document_id: 'doc1' } }])
    await waitFor(() => expect(faux.lectures).toBe(avant + 1))
    expect(motsDuCabinet(texteDeLEcran())).toEqual([])
  })

  it('un document qui ne s’ouvre pas ne se date pas, et le dit', async () => {
    faux.lecture = lus([document({})])
    faux.ouvre = false
    render(<ClientDocuments />)
    fireEvent.click(await screen.findByRole('button', { name: 'Ouvrir' }))
    await act(async () => { faux.retenir.forEach((r) => r()) })
    expect(await screen.findByText('L’ouverture a été bloquée par le navigateur.')).toBeTruthy()
    expect(faux.appels).toHaveLength(0)
  })
})
