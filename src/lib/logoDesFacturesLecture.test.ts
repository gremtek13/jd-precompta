import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { TAILLE_MAX } from './bornesStockage'
import { lireLeLogo } from './logoDesFacturesLecture'
import { supabase } from './supabase'
import { empreinteDe, jpegFictif, logoDe } from '../test/logoFictif'
import { mondeDuSeau as monde } from '../test/stockageFactice'

// LE FICHIER DU LOGO, RELU DANS LE SEAU (étape A5c2a) : le vrai SDK du stockage contre un seau factice
// (src/test/stockageFactice.ts). Ce que la lecture doit dire de chaque réponse — le fichier vérifié, ou la raison pour
// laquelle l'écran n'en montre rien — et qu'elle ne rejette jamais. Données fictives.

vi.mock('./supabase', async () => ({ supabase: { storage: (await import('../test/stockageFactice')).mondeDuSeau.stockage } }))

const D = 'a5c00000-0000-4000-8000-0000000000d1'
let H: string
let CHEMIN: string

beforeAll(async () => {
  H = await empreinteDe(logoDe())
  CHEMIN = `${D}/logos/${H}.png`
})
beforeEach(() => { monde.reinitialiser() })
afterEach(() => { vi.restoreAllMocks() })

const deposer = (chemin: string, octets: Uint8Array<ArrayBuffer>) => { monde.seau.set(chemin, new Blob([octets])) }

describe('le fichier que la version désigne, lu et vérifié', () => {
  it('l’empreinte recalculée est celle de la version : le fichier est rendu, réétiqueté à sa signature', async () => {
    deposer(CHEMIN, logoDe())
    const lu = await lireLeLogo({ chemin: CHEMIN, empreinte: H })
    expect(lu).toMatchObject({ etat: 'verifie', type: 'image/png', taille: logoDe().byteLength })
    if (lu.etat !== 'verifie') throw new Error('attendu : vérifié')
    // Le service a répondu en application/octet-stream : le corps rendu porte le type que prouve sa signature.
    expect(lu.corps.type).toBe('image/png')
    expect(new Uint8Array(await lu.corps.arrayBuffer())).toEqual(logoDe())
    expect(monde.envois).toEqual([{ methode: 'GET', chemin: CHEMIN, type: null, upsert: null }])
  })

  it('un autre fichier sous le même nom : « autre empreinte », jamais une image à montrer', async () => {
    deposer(CHEMIN, logoDe(7))
    expect(await lireLeLogo({ chemin: CHEMIN, empreinte: H })).toEqual({ etat: 'autre_empreinte' })
  })

  it('l’empreinte juste mais un fichier qui n’est ni un PNG ni un JPEG : illisible', async () => {
    const texte = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>') as Uint8Array<ArrayBuffer>
    const h = await empreinteDe(texte)
    deposer(`${D}/logos/${h}.png`, texte)
    expect(await lireLeLogo({ chemin: `${D}/logos/${h}.png`, empreinte: h })).toEqual({ etat: 'illisible' })
  })

  it('l’empreinte juste mais un JPEG sous un nom en .png : le type de la signature n’est pas celui du nom, illisible', async () => {
    const h = await empreinteDe(jpegFictif())
    deposer(`${D}/logos/${h}.png`, jpegFictif())
    expect(await lireLeLogo({ chemin: `${D}/logos/${h}.png`, empreinte: h })).toEqual({ etat: 'illisible' })
    // Sous son vrai nom, le même fichier est vérifié.
    deposer(`${D}/logos/${h}.jpg`, jpegFictif())
    expect(await lireLeLogo({ chemin: `${D}/logos/${h}.jpg`, empreinte: h })).toMatchObject({ etat: 'verifie', type: 'image/jpeg' })
  })

  it('un fichier vide, ou plus gros que la borne du seau : illisible, sans calcul d’empreinte', async () => {
    deposer(CHEMIN, new Uint8Array(0))
    expect(await lireLeLogo({ chemin: CHEMIN, empreinte: H })).toEqual({ etat: 'illisible' })
    deposer(CHEMIN, logoDe(TAILLE_MAX.ventes))
    expect(await lireLeLogo({ chemin: CHEMIN, empreinte: H })).toEqual({ etat: 'illisible' })
  })

  it('une réponse qui n’est pas un fichier (le faux client des gardes rend une liste) : illisible', async () => {
    const lecture = vi.spyOn(supabase.storage, 'from').mockReturnValue({
      download: async () => ({ data: [], error: null }),
    } as unknown as ReturnType<typeof supabase.storage.from>)
    expect(await lireLeLogo({ chemin: CHEMIN, empreinte: H })).toEqual({ etat: 'illisible' })
    expect(lecture).toHaveBeenCalledWith('ventes')
  })
})

describe('ce que le stockage répond quand il ne rend pas le fichier', () => {
  it.each([
    ['400 dont le corps dit 404, comme le service le rend', () => Response.json({ statusCode: '404', error: 'not_found', message: 'Object not found' }, { status: 400 })],
    ['404', () => Response.json({ statusCode: '404', error: 'not_found', message: 'Object not found' }, { status: 404 })],
    ['400 dont le seul corps dit 404, sans les mots du service', () => Response.json({ statusCode: '404', error: 'x', message: 'objet manquant' }, { status: 400 })],
    ['404 dont le corps n’a pas les mots du service', () => Response.json({ statusCode: '400', error: 'x', message: 'objet manquant' }, { status: 404 })],
    ['une passerelle : 404 sans corps JSON', () => new Response('<html>Not Found</html>', { status: 404, statusText: 'Not Found' })],
  ])('%s : absent', async (_quoi, reponse) => {
    monde.reponseLecture = reponse
    expect(await lireLeLogo({ chemin: CHEMIN, empreinte: H })).toEqual({ etat: 'absent' })
  })

  it('le seau vide : absent', async () => {
    expect(await lireLeLogo({ chemin: CHEMIN, empreinte: H })).toEqual({ etat: 'absent' })
  })

  it('un refus (403) : refusé, sous les mots du service', async () => {
    monde.reponseLecture = () => Response.json({ statusCode: '403', error: 'Unauthorized', message: 'permission refusée' }, { status: 403 })
    expect(await lireLeLogo({ chemin: CHEMIN, empreinte: H })).toEqual({ etat: 'refuse', motif: 'permission refusée' })
  })

  it('une panne du service (500) : refusé, jamais « absent »', async () => {
    monde.reponseLecture = () => new Response('erreur', { status: 500, statusText: 'Internal Server Error' })
    expect(await lireLeLogo({ chemin: CHEMIN, empreinte: H })).toMatchObject({ etat: 'refuse' })
  })
})

describe('elle ne rejette jamais', () => {
  it('un client qui lève : refusé, avec la raison', async () => {
    vi.spyOn(supabase.storage, 'from').mockImplementation(() => { throw new Error('le client est tombé') })
    expect(await lireLeLogo({ chemin: CHEMIN, empreinte: H })).toEqual({ etat: 'refuse', motif: 'le client est tombé' })
  })

  it('un téléchargement qui rejette : refusé, avec la raison', async () => {
    vi.spyOn(supabase.storage, 'from').mockReturnValue({
      download: async () => { throw new Error('réseau coupé') },
    } as unknown as ReturnType<typeof supabase.storage.from>)
    expect(await lireLeLogo({ chemin: CHEMIN, empreinte: H })).toEqual({ etat: 'refuse', motif: 'réseau coupé' })
  })

  it('un fichier qu’on ne peut pas lire en octets : illisible', async () => {
    vi.spyOn(supabase.storage, 'from').mockReturnValue({
      download: async () => ({ data: { size: 10, arrayBuffer: async () => { throw new Error('illisible') } }, error: null }),
    } as unknown as ReturnType<typeof supabase.storage.from>)
    expect(await lireLeLogo({ chemin: CHEMIN, empreinte: H })).toEqual({ etat: 'illisible' })
  })

  it('la panne du réseau, vue du SDK (un fetch qui lève), est dite refusée', async () => {
    monde.reponseLecture = () => { throw new TypeError('fetch failed') }
    expect(await lireLeLogo({ chemin: CHEMIN, empreinte: H })).toMatchObject({ etat: 'refuse' })
  })
})
