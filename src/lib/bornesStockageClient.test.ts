import { StorageClient } from '@supabase/storage-js'
import { describe, expect, it } from 'vitest'
import { preparerLogo, preparerPiece } from './bornesStockage'
import { estUnDoublonDuStockage } from './logoDesFactures'
import { messageErreur } from './messageErreur'

// LE SDK INSTALLÉ, JOUÉ CONTRE UN SERVEUR FACTICE (ligne 22.6). Deux faits décident de la conception de
// lib/bornesStockage.ts, et ni l'un ni l'autre ne se lit dans la documentation — ils sont dans le code de storage-js
// (2.112.4) et de supabase/storage :
//   1. pour un Blob, `upload` construit un FormData et IGNORE l'option `contentType` : la partie porte le type du Blob,
//      `application/octet-stream` s'il est vide — et c'est ce type que le serveur juge contre `allowed_mime_types` ;
//   2. un refus du serveur (413 `EntityTooLarge`, 415 `InvalidMimeType`, corps `{ statusCode, code, error, message }`)
//      arrive en `StorageApiError`, sur le chemin non levant, avec sa phrase anglaise — que `messageErreur` dit en
//      français.

interface Envoi { url: string; partie: { type: string; entete: string } | null; enTeteContentType: string | null }

/** Un client du stockage dont le « serveur » note ce qu'il reçoit et répond ce qu'on lui dit. */
function client(reponse: () => Response) {
  const envois: Envoi[] = []
  const fetchFactice = async (url: RequestInfo | URL, init?: RequestInit) => {
    const corps = init?.body
    let partie: Envoi['partie'] = null
    if (corps instanceof FormData) {
      const fichier = corps.get('') as File
      // Ce qui part sur le fil : le texte multipart sérialisé, et l'en-tête Content-Type de la partie du fichier.
      const brut = await new Response(corps).text()
      const entete = /name=""; filename="[^"]*"\r\nContent-Type: ([^\r\n]*)/.exec(brut)?.[1] ?? ''
      partie = { type: fichier.type, entete }
    }
    const enTetes = new Headers(init?.headers)
    envois.push({ url: String(url), partie, enTeteContentType: enTetes.get('content-type') })
    return reponse()
  }
  const stockage = new StorageClient('https://projet.supabase.invalid/storage/v1', {}, fetchFactice as typeof fetch)
  return { stockage, envois }
}

const ok = () => Response.json({ Id: 'id', Key: 'pieces/d1/f' })
const refus = (statut: number, code: string, message: string) =>
  () => Response.json({ statusCode: String(statut), code, error: code, message }, { status: statut })

describe('ce que le SDK installé envoie', () => {
  it('pour un Blob, l’option contentType est ignorée : la partie porte le type du Blob', async () => {
    const { stockage, envois } = client(ok)
    const { error } = await stockage.from('pieces').upload('d1/f.csv', new Blob(['a;b'], { type: 'text/csv' }), { contentType: 'application/pdf' })
    expect(error).toBeNull()
    expect(envois[0].partie).toEqual({ type: 'text/csv', entete: 'text/csv' })
  })

  it('un fichier sans type part en application/octet-stream — ce qu’un relevé CSV d’un système inconnu enverrait', async () => {
    const { stockage, envois } = client(ok)
    await stockage.from('pieces').upload('d1/f.csv', new File(['a;b'], 'releve.csv', { type: '' }))
    expect(envois[0].partie?.entete).toBe('application/octet-stream')
  })

  it('le corps d’une pièce préparée part sous le type décidé, pas sous celui du navigateur', async () => {
    const { stockage, envois } = client(ok)
    const pret = await preparerPiece(new File(['a;b'], 'releve.csv', { type: 'application/vnd.ms-excel' }))
    if ('refus' in pret) throw new Error(pret.refus.message)
    await stockage.from('pieces').upload('d1/releve.csv', pret.corps)
    expect(envois[0].partie).toEqual({ type: 'text/csv', entete: 'text/csv' })
  })

  it('un logo préparé part sous le type que prouve sa signature', async () => {
    const { stockage, envois } = client(ok)
    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], 'logo.svg', { type: 'image/svg+xml' })
    const pret = await preparerLogo(png)
    if ('refus' in pret) throw new Error(pret.refus.message)
    await stockage.from('cabinet-logos').upload('c1/logo.png', pret.corps)
    expect(envois[0].partie?.entete).toBe('image/png')
  })

  it('un corps qui n’est pas un Blob part en en-tête, avec l’option contentType', async () => {
    const { stockage, envois } = client(ok)
    await stockage.from('pieces').upload('d1/f.pdf', new Uint8Array([0x25, 0x50]), { contentType: 'application/pdf' })
    expect(envois[0]).toEqual(expect.objectContaining({ partie: null, enTeteContentType: 'application/pdf' }))
  })
})

describe('un refus du stockage se dit en français', () => {
  it('413 EntityTooLarge', async () => {
    const { stockage } = client(refus(413, 'EntityTooLarge', 'The object exceeded the maximum allowed size'))
    const { error } = await stockage.from('pieces').upload('d1/f.pdf', new Blob(['x'], { type: 'application/pdf' }))
    expect(messageErreur(error, 'repli')).toBe('Le stockage refuse ce fichier : il dépasse la taille admise pour ce dépôt')
  })

  it('415 InvalidMimeType', async () => {
    const { stockage } = client(refus(415, 'InvalidMimeType', 'mime type image/svg+xml is not supported'))
    const { error } = await stockage.from('cabinet-logos').upload('c1/l.svg', new Blob(['<svg/>'], { type: 'image/svg+xml' }))
    expect(messageErreur(error, 'repli')).toBe('Le stockage refuse ce fichier : son format n’est pas admis pour ce dépôt')
  })

  it('un 413 d’une passerelle, sans corps JSON, aussi', async () => {
    const { stockage } = client(() => new Response('<html>Request Entity Too Large</html>', { status: 413, statusText: 'Payload Too Large' }))
    const { error } = await stockage.from('packs').upload('d1/p.zip', new Blob(['x'], { type: 'application/zip' }))
    expect(messageErreur(error, 'repli')).toBe('Le stockage refuse ce fichier : il dépasse la taille admise pour ce dépôt')
  })

  it('un autre refus du stockage garde sa phrase, et un objet qui n’en vient pas n’est pas pris pour lui', async () => {
    const { stockage } = client(refus(409, 'KeyAlreadyExists', 'The resource already exists'))
    const { error } = await stockage.from('pieces').upload('d1/f.pdf', new Blob(['x'], { type: 'application/pdf' }))
    expect(messageErreur(error, 'repli')).toBe('The resource already exists')
    expect(messageErreur({ code: 'EntityTooLarge', status: 413, message: 'payload' }, 'repli')).toBe('payload')
  })
})

// UN NOM DÉJÀ PRIS (étape A5c2a). Le nom d'un logo de facture est son empreinte : le reposer bute sur l'unicité du seau, qui
// n'admet aucune mise à jour. Ce que le SDK installé rapporte d'un doublon, joué contre lui — les formes que le service
// rend selon sa version : un 409 ; un 400 dont le CORPS porte `statusCode: '409'` (le SDK garde le statut de la réponse dans
// `status` et celui du corps dans `statusCode`) ; un corps sans `message`, dont `error: 'Duplicate'` devient le message — et
// ce qui n'en est pas un.
describe('un nom déjà pris se reconnaît sur ce que le SDK en rapporte', () => {
  const depot = async (reponse: () => Response) => {
    const { stockage } = client(reponse)
    const { error } = await stockage.from('ventes').upload('d1/logos/f.png', new Blob(['x'], { type: 'image/png' }), { upsert: false })
    return error
  }

  it('409 avec le corps ordinaire du service', async () => {
    const error = await depot(() => Response.json({ statusCode: '409', error: 'Duplicate', message: 'The resource already exists' }, { status: 409 }))
    expect(error).toMatchObject({ status: 409, statusCode: '409' })
    expect(estUnDoublonDuStockage(error)).toBe(true)
  })

  it('400 dont le corps porte le statut 409 : le statut de la réponse n’est pas celui du corps', async () => {
    const error = await depot(() => Response.json({ statusCode: '409', error: 'Duplicate', message: 'The resource already exists' }, { status: 400 }))
    expect(error).toMatchObject({ status: 400, statusCode: '409' })
    expect(estUnDoublonDuStockage(error)).toBe(true)
  })

  it('un corps sans message : l’erreur « Duplicate » devient le message', async () => {
    const error = await depot(() => Response.json({ statusCode: '400', error: 'Duplicate' }, { status: 400 }))
    expect(error).toMatchObject({ message: 'Duplicate' })
    expect(estUnDoublonDuStockage(error)).toBe(true)
  })

  it('un corps qui donne le code du service', async () => {
    const error = await depot(() => Response.json({ statusCode: '400', code: 'ResourceAlreadyExists', message: 'Resource exists' }, { status: 400 }))
    expect(estUnDoublonDuStockage(error)).toBe(true)
  })

  it('un 409 sans corps JSON (une passerelle) aussi', async () => {
    const error = await depot(() => new Response('<html>Conflict</html>', { status: 409, statusText: 'Conflict' }))
    expect(estUnDoublonDuStockage(error)).toBe(true)
  })

  it.each<[string, () => Response]>([
    ['413 : trop gros', refus(413, 'EntityTooLarge', 'The object exceeded the maximum allowed size')],
    ['415 : format refusé', refus(415, 'InvalidMimeType', 'mime type image/svg+xml is not supported')],
    ['403 : la policy refuse', () => Response.json({ statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' }, { status: 403 })],
    ['404 : le seau n’existe pas', () => Response.json({ statusCode: '404', error: 'Bucket not found', message: 'Bucket not found' }, { status: 404 })],
    ['500 sans corps', () => new Response('erreur', { status: 500 })],
  ])('%s n’est pas un doublon', async (_quoi, reponse) => {
    expect(estUnDoublonDuStockage(await depot(reponse))).toBe(false)
  })

  it('un objet qui ne vient pas du stockage n’est pas pris pour lui — ni null, ni un texte, ni une erreur de Postgrest', () => {
    expect(estUnDoublonDuStockage({ status: 409, statusCode: '409', message: 'Duplicate' })).toBe(false)
    expect(estUnDoublonDuStockage({ code: '23505', message: 'duplicate key value violates unique constraint' })).toBe(false)
    expect(estUnDoublonDuStockage(new Error('409'))).toBe(false)
    expect(estUnDoublonDuStockage('409')).toBe(false)
    expect(estUnDoublonDuStockage(null)).toBe(false)
    expect(estUnDoublonDuStockage(undefined)).toBe(false)
  })
})
