import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { TAILLE_MAX } from './bornesStockage'
import { deposerLeLogo } from './logoDesFacturesEcriture'
import { empreinteDe, jpegFictif, logoDe } from '../test/logoFictif'
import { mondeDuSeau as monde } from '../test/stockageFactice'

// LE DÉPÔT DU FICHIER D'UN LOGO (étape A5c2a), joué par le vrai SDK du stockage contre un seau factice
// (src/test/stockageFactice.ts) : ce qui part, sous quel type et quel nom, et ce que devient un nom déjà pris. Données fictives.

vi.mock('./supabase', async () => ({ supabase: { storage: (await import('../test/stockageFactice')).mondeDuSeau.stockage } }))

const D = 'a5c00000-0000-4000-8000-0000000000d1'
let H: string
let CHEMIN: string

beforeAll(async () => {
  H = await empreinteDe(logoDe())
  CHEMIN = `${D}/logos/${H}.png`
})
beforeEach(() => { monde.reinitialiser() })

const fichier = (octets: Uint8Array<ArrayBuffer>, nom = 'logo.png', type = 'image/png') => new File([octets], nom, { type })

describe('un logo déposé', () => {
  it('part sous son nom d’empreinte, sans mise à jour possible, dans un corps réétiqueté à sa signature', async () => {
    // Le navigateur croit à un SVG : seul compte ce que prouvent les octets.
    const depot = await deposerLeLogo(D, fichier(logoDe(), 'logo.svg', 'image/svg+xml'), H)
    expect(depot).toMatchObject({ dejaLa: false, pret: { chemin: CHEMIN, empreinte: H, type: 'image/png' } })
    expect(monde.envois).toEqual([{ methode: 'POST', chemin: CHEMIN, type: 'image/png', upsert: 'false' }])
    expect(monde.seau.has(CHEMIN)).toBe(true)
  })

  it('un JPEG se dépose sous son extension', async () => {
    const h = await empreinteDe(jpegFictif())
    const depot = await deposerLeLogo(D, fichier(jpegFictif(), 'logo.png', 'image/png'), h)
    expect(depot.pret.chemin).toBe(`${D}/logos/${h}.jpg`)
    expect(monde.envois).toEqual([{ methode: 'POST', chemin: `${D}/logos/${h}.jpg`, type: 'image/jpeg', upsert: 'false' }])
  })
})

describe('un fichier que le seau refuserait ne part pas', () => {
  it('un format non pris en charge, dit avant tout envoi', async () => {
    const texte = new TextEncoder().encode('pas une image') as Uint8Array<ArrayBuffer>
    await expect(deposerLeLogo(D, fichier(texte, 'logo.png'), H)).rejects.toThrow('Ce logo n’est pas pris : format non pris en charge')
    expect(monde.envois).toEqual([])
  })

  it('un poids au-delà de la borne, dit avant tout envoi', async () => {
    await expect(deposerLeLogo(D, fichier(logoDe(TAILLE_MAX.ventes)), H)).rejects.toThrow(/Ce logo n’est pas pris : il pèse .* qu’un logo de facture peut peser/)
    expect(monde.envois).toEqual([])
  })

  it('un fichier qui n’a plus l’empreinte que l’écran avait jugée', async () => {
    await expect(deposerLeLogo(D, fichier(logoDe(3)), H)).rejects.toThrow('Le fichier choisi a changé depuis son choix : il faut le choisir de nouveau.')
    expect(monde.envois).toEqual([])
  })
})

describe('un nom déjà pris : le fichier qui y est est relu, jamais cru', () => {
  const doublonEn409 = () => Response.json({ statusCode: '409', error: 'Duplicate', message: 'The resource already exists' }, { status: 409 })
  const doublonEn400 = () => Response.json({ statusCode: '409', error: 'Duplicate', message: 'The resource already exists' }, { status: 400 })

  it.each([['409', doublonEn409], ['400 dont le corps dit 409', doublonEn400]])('%s, le même fichier : désigné sans nouveau dépôt', async (_quoi, reponse) => {
    monde.seau.set(CHEMIN, new Blob([logoDe()]))
    monde.reponseDepot = reponse
    const depot = await deposerLeLogo(D, fichier(logoDe()), H)
    expect(depot).toMatchObject({ dejaLa: true, pret: { chemin: CHEMIN, empreinte: H } })
    // Un dépôt refusé, puis la relecture du fichier qui y est — rien d'autre.
    expect(monde.envois.map((e) => e.methode)).toEqual(['POST', 'GET'])
    expect(monde.envois[1].chemin).toBe(CHEMIN)
  })

  it('le service lui-même (sans réponse forcée) : le second dépôt du même fichier bute, et le même fichier est reconnu', async () => {
    await deposerLeLogo(D, fichier(logoDe()), H)
    const encore = await deposerLeLogo(D, fichier(logoDe()), H)
    expect(encore.dejaLa).toBe(true)
    expect(monde.envois.map((e) => e.methode)).toEqual(['POST', 'POST', 'GET'])
  })

  it('un autre fichier sous le même nom : refusé, et dit', async () => {
    monde.seau.set(CHEMIN, new Blob([logoDe(9)]))
    await expect(deposerLeLogo(D, fichier(logoDe()), H)).rejects.toThrow(
      'Un fichier de ce nom est déjà dans l’espace du dossier, mais ce n’est pas ce logo (son empreinte diffère) : rien n’est enregistré.',
    )
  })

  it('un fichier qu’on ne peut pas relire (le stockage refuse de le rendre) : refusé, avec la raison', async () => {
    monde.reponseDepot = doublonEn409
    monde.reponseLecture = () => Response.json({ statusCode: '403', error: 'Unauthorized', message: 'permission refusée' }, { status: 403 })
    await expect(deposerLeLogo(D, fichier(logoDe()), H)).rejects.toThrow(
      'Un fichier de ce nom est déjà dans l’espace du dossier, mais le stockage refuse de le rendre (permission refusée) : rien n’est enregistré.',
    )
  })

  it('un fichier qui a disparu entre-temps : refusé, il n’a pas pu être relu', async () => {
    monde.reponseDepot = doublonEn409
    await expect(deposerLeLogo(D, fichier(logoDe()), H)).rejects.toThrow(
      'Un fichier de ce nom est déjà dans l’espace du dossier, mais il n’a pas pu être relu pour le vérifier : rien n’est enregistré.',
    )
  })
})

describe('un autre refus du stockage n’est pas un doublon', () => {
  it('un refus de la policy (403) : dit sous les mots du service, aucune relecture', async () => {
    monde.reponseDepot = () => Response.json({ statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' }, { status: 403 })
    await expect(deposerLeLogo(D, fichier(logoDe()), H)).rejects.toThrow('new row violates row-level security policy')
    expect(monde.envois.map((e) => e.methode)).toEqual(['POST'])
  })

  it('un 413 : dit en français', async () => {
    monde.reponseDepot = () => Response.json({ statusCode: '413', code: 'EntityTooLarge', error: 'EntityTooLarge', message: 'The object exceeded the maximum allowed size' }, { status: 413 })
    await expect(deposerLeLogo(D, fichier(logoDe()), H)).rejects.toThrow('Le stockage refuse ce fichier : il dépasse la taille admise pour ce dépôt')
    expect(monde.envois.map((e) => e.methode)).toEqual(['POST'])
  })

  it('un 415 : dit en français', async () => {
    monde.reponseDepot = () => Response.json({ statusCode: '415', code: 'InvalidMimeType', error: 'InvalidMimeType', message: 'mime type image/png is not supported' }, { status: 415 })
    await expect(deposerLeLogo(D, fichier(logoDe()), H)).rejects.toThrow('Le stockage refuse ce fichier : son format n’est pas admis pour ce dépôt')
  })
})
