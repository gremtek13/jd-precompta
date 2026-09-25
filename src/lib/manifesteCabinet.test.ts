import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { FOND_APPLICATION, ID_APPLICATION, THEME_APPLICATION, manifesteDuCabinet } from './manifesteCabinet'

// Les deux manifestes d'application : celui de public/, et celui qu'un cabinet reçoit quand il a son
// logo. Ce sont eux que lit le navigateur pour INSTALLER l'application.
//
// Pourquoi ce test existe. Le second n'était pas installable — son `start_url` relatif ne se résolvait
// pas contre l'URL `blob:` qui le sert — pendant que le premier l'était. Or c'est le second que reçoit
// le cabinet JD Consult, qui a un logo. Rien ne le montrait : un avertissement en console, et une icône
// d'installation qui n'apparaissait simplement pas. Il garde donc trois choses : que chaque adresse du
// manifeste d'un cabinet se résout contre une vraie URL `blob:`, que les deux manifestes décrivent la
// MÊME application (une application installée ne change pas d'identité avec le logo), et que le
// manifeste statique remplit ce que Chrome exige pour installer.

const racine = (chemin: string) => new URL(`../../${chemin}`, import.meta.url)

interface ManifesteLu {
  id?: string
  name?: string
  short_name?: string
  start_url?: string
  scope?: string
  display?: string
  background_color?: string
  theme_color?: string
  prefer_related_applications?: boolean
  icons?: { src: string; sizes: string; type?: string; purpose?: string }[]
}

const statique = JSON.parse(readFileSync(racine('public/manifest.webmanifest'), 'utf8')) as ManifesteLu

const ORIGINE = 'https://compta.jdarnis.fr'
// Telle que la fabrique `URL.createObjectURL` : c'est contre ELLE que le navigateur résout les adresses
// du manifeste d'un cabinet.
const URL_BLOB = `blob:${ORIGINE}/0f6c2b1e-8d6a-4c1e-9f3a-2b7d5e4c1a90`
const URL_STATIQUE = `${ORIGINE}/manifest.webmanifest`

/** L'adresse absolue que le navigateur en tire, ou null s'il l'écarte. */
function resoudre(adresse: string | undefined, base: string): string | null {
  if (adresse === undefined) return null
  try {
    return new URL(adresse, base).href
  } catch {
    return null
  }
}

/** Ce qui fait l'identité d'une application installée, résolu comme le fait le navigateur. */
function identite(m: ManifesteLu, urlManifeste: string) {
  const depart = resoudre(m.start_url, urlManifeste)
  return {
    id: depart ? resoudre(m.id, new URL(depart).origin) : null,
    depart,
    portee: resoudre(m.scope, urlManifeste),
    affichage: m.display,
  }
}

const cabinet = manifesteDuCabinet({
  origine: ORIGINE, nom: 'Cabinet Exemple', logoUrl: 'https://stockage.exemple.test/logo.png', couleurPrimaire: '#1d4587',
})

describe('le manifeste d’un cabinet qui a son logo', () => {
  it('se résout entièrement contre l’URL blob qui le sert', () => {
    // Le harnais sait échouer : une adresse relative ne se résout pas contre cette base-là. Sans ce
    // contrôle, une base mal écrite rendrait ce test vert sur le défaut d'origine.
    expect(resoudre('/', URL_BLOB)).toBeNull()
    expect(resoudre(cabinet.start_url, URL_BLOB)).toBe(`${ORIGINE}/`)
    expect(resoudre(cabinet.scope, URL_BLOB)).toBe(`${ORIGINE}/`)
  })

  it('décrit la même application que le manifeste statique', () => {
    expect(identite(cabinet, URL_BLOB)).toEqual(identite(statique, URL_STATIQUE))
    expect(identite(cabinet, URL_BLOB).id).toBe(`${ORIGINE}/`)
    expect(cabinet.background_color).toBe(statique.background_color)
  })

  it('porte le nom du cabinet et sa couleur, avec un repli pour chacun', () => {
    expect(cabinet.name).toBe('Cabinet Exemple')
    expect(cabinet.short_name).toBe('Cabinet Exemple')
    expect(cabinet.theme_color).toBe('#1d4587')
    const sansRien = manifesteDuCabinet({ origine: ORIGINE, nom: '  ', logoUrl: 'x', couleurPrimaire: 'bleu' })
    expect(sansRien.name).toBe('JD Precompta')
    expect(sansRien.theme_color).toBe(statique.theme_color)
    expect(manifesteDuCabinet({ origine: ORIGINE, nom: null, logoUrl: 'x', couleurPrimaire: null }).name).toBe('JD Precompta')
  })

  it('présente le logo sans lui inventer de taille ni de format', () => {
    expect(cabinet.icons).toEqual([{ src: 'https://stockage.exemple.test/logo.png', sizes: 'any', purpose: 'any' }])
  })

  it('suit l’adresse où l’application est ouverte, jamais une adresse écrite en dur', () => {
    const ailleurs = manifesteDuCabinet({ origine: 'http://127.0.0.1:5199', nom: 'X', logoUrl: 'x', couleurPrimaire: null })
    expect(ailleurs.start_url).toBe('http://127.0.0.1:5199/')
    expect(ailleurs.scope).toBe('http://127.0.0.1:5199/')
  })
})

describe('le manifeste statique', () => {
  it('remplit ce que Chrome exige pour installer', () => {
    expect(statique.name?.trim()).toBeTruthy()
    expect(statique.short_name?.trim()).toBeTruthy()
    expect(statique.start_url).toBe('/')
    expect(['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay']).toContain(statique.display)
    expect(statique.prefer_related_applications).not.toBe(true)
  })

  it('porte l’identité et les couleurs que reprend le manifeste d’un cabinet', () => {
    expect(statique.id).toBe(ID_APPLICATION)
    expect(statique.background_color).toBe(FOND_APPLICATION)
    expect(statique.theme_color).toBe(THEME_APPLICATION)
  })

  it('désigne des icônes de 192 et 512 pixels qui existent, aux dimensions annoncées', () => {
    const icones = statique.icons ?? []
    expect(icones.map((i) => i.sizes).sort()).toEqual(['192x192', '512x512'])
    for (const icone of icones) {
      expect(icone.type).toBe('image/png')
      expect(icone.purpose ?? 'any').toContain('any')
      const fichier = readFileSync(racine(`public${icone.src}`))
      // Signature PNG, puis largeur et hauteur dans l'en-tête IHDR.
      expect(fichier.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
      expect(`${fichier.readUInt32BE(16)}x${fichier.readUInt32BE(20)}`).toBe(icone.sizes)
    }
  })
})
