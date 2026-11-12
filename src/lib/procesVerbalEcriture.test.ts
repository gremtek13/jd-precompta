import { beforeEach, describe, expect, it, vi } from 'vitest'
import { preparerProcesVerbal } from './bornesStockage'
import { empreinteSha256 } from './logoDesFactures'

// LE DÉPÔT DU PROCÈS-VERBAL SIGNÉ (ligne 45, AFF5) : le fichier rejugé et son empreinte recalculée avant tout envoi, déposé au
// chemin de sa décision PUIS joint par `joindre_document_affectation` seule ; un chemin déjà pris relu à son empreinte ; le
// fichier déposé par l'appel retiré quand la fonction refuse, jamais celui qu'on a trouvé là.

const appels = vi.hoisted(() => ({
  upload: vi.fn(), download: vi.fn(), rpc: vi.fn(), retirer: vi.fn(),
}))
vi.mock('./supabase', () => ({
  supabase: {
    storage: { from: (seau: string) => ({
      upload: (...a: unknown[]) => appels.upload(seau, ...a),
      download: (...a: unknown[]) => appels.download(seau, ...a),
    }) },
    rpc: (...a: unknown[]) => appels.rpc(...a),
  },
}))
vi.mock('./stockage', () => ({ retirerFichiers: (...a: unknown[]) => appels.retirer(...a) }))

import { joindreLeProcesVerbal } from './procesVerbalEcriture'

const D = '11111111-1111-4111-8111-111111111111'
const A = '22222222-2222-4222-8222-222222222222'
const pdf = (texte = 'signé') => new Blob([`%PDF-1.7\n${texte}`], { type: 'text/plain' })
const DOUBLON = { __isStorageError: true, statusCode: '409', message: 'Duplicate' }

beforeEach(() => {
  for (const f of Object.values(appels)) f.mockReset()
  appels.upload.mockResolvedValue({ data: { path: 'x' }, error: null })
  appels.rpc.mockResolvedValue({ data: null, error: null })
})

describe('preparerProcesVerbal', () => {
  it('un PDF lu à sa signature, réétiqueté ; autre chose ou plus de 20 Mio : refusé', async () => {
    const pret = await preparerProcesVerbal(pdf())
    expect('refus' in pret ? null : pret.type).toBe('application/pdf')
    const image = await preparerProcesVerbal(new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'application/pdf' }))
    expect('refus' in image && image.refus.message).toBe('format non pris en charge (un procès-verbal signé se dépose en PDF)')
    const lourd = await preparerProcesVerbal(new Blob(['%PDF', new Uint8Array(20 * 1024 * 1024)]))
    expect('refus' in lourd && lourd.refus.raison).toBe('taille')
  })
})

describe('joindreLeProcesVerbal', () => {
  it('dépose au chemin de la décision, dans le seau des dossiers, puis joint chemin et empreinte', async () => {
    const f = pdf()
    const empreinte = await empreinteSha256(f)
    expect(await joindreLeProcesVerbal(D, A, f, empreinte)).toEqual({ ok: true })
    expect(appels.upload).toHaveBeenCalledWith('pieces', `${D}/affectations/${A}.pdf`, expect.any(Blob), { contentType: 'application/pdf', upsert: false })
    expect(appels.rpc).toHaveBeenCalledWith('joindre_document_affectation', { p_affectation_id: A, p_chemin: `${D}/affectations/${A}.pdf`, p_empreinte: empreinte })
  })

  it('un fichier refusé ou changé depuis son choix : rien ne part', async () => {
    const refus = await joindreLeProcesVerbal(D, A, new Blob(['texte']), 'a'.repeat(64))
    expect(refus).toEqual({ ok: false, message: 'Ce document n’est pas pris : format non pris en charge (un procès-verbal signé se dépose en PDF).' })
    const change = await joindreLeProcesVerbal(D, A, pdf(), 'a'.repeat(64))
    expect(change.ok).toBe(false)
    expect(appels.upload).not.toHaveBeenCalled()
    expect(appels.rpc).not.toHaveBeenCalled()
  })

  it('la fonction refuse : le fichier déposé par cet appel se retire, et le refus de la base se dit', async () => {
    const f = pdf()
    appels.rpc.mockResolvedValue({ data: null, error: { message: 'Le procès-verbal de cette décision est déjà joint : une version nouvelle de la décision en produit un nouveau.' } })
    const issue = await joindreLeProcesVerbal(D, A, f, await empreinteSha256(f))
    expect(issue).toEqual({ ok: false, message: 'Le procès-verbal de cette décision est déjà joint : une version nouvelle de la décision en produit un nouveau.' })
    expect(appels.retirer).toHaveBeenCalledWith('pieces', [`${D}/affectations/${A}.pdf`], expect.any(String), D)
  })

  it('un chemin déjà pris par le MÊME fichier (un essai précédent) : joint sans nouveau dépôt, jamais retiré', async () => {
    const f = pdf()
    appels.upload.mockResolvedValue({ data: null, error: DOUBLON })
    appels.download.mockResolvedValue({ data: pdf(), error: null })
    expect(await joindreLeProcesVerbal(D, A, f, await empreinteSha256(f))).toEqual({ ok: true })
    appels.rpc.mockResolvedValue({ data: null, error: { message: 'refus' } })
    expect((await joindreLeProcesVerbal(D, A, f, await empreinteSha256(f))).ok).toBe(false)
    expect(appels.retirer).not.toHaveBeenCalled()
  })

  it('un chemin déjà pris par un AUTRE fichier, ou illisible : rien n’est joint', async () => {
    const f = pdf()
    appels.upload.mockResolvedValue({ data: null, error: DOUBLON })
    appels.download.mockResolvedValue({ data: pdf('autre'), error: null })
    const autre = await joindreLeProcesVerbal(D, A, f, await empreinteSha256(f))
    expect(autre.ok === false && autre.message).toContain('son empreinte diffère')
    appels.download.mockResolvedValue({ data: null, error: { message: 'non' } })
    const illisible = await joindreLeProcesVerbal(D, A, f, await empreinteSha256(f))
    expect(illisible.ok === false && illisible.message).toContain('n’a pas pu être relu')
    expect(appels.rpc).not.toHaveBeenCalled()
  })

  it('un refus du stockage autre qu’un doublon : dit, la fonction pas appelée', async () => {
    const f = pdf()
    appels.upload.mockResolvedValue({ data: null, error: { message: 'Payload too large' } })
    const issue = await joindreLeProcesVerbal(D, A, f, await empreinteSha256(f))
    expect(issue.ok === false && issue.message).toContain('Payload too large')
    expect(appels.rpc).not.toHaveBeenCalled()
  })
})
