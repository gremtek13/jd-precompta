import { estCouleurHexValide } from './colors'

// Le manifeste d'application d'un cabinet qui a son propre logo. C'est lui que lit le navigateur pour
// INSTALLER l'application (nom, icône, adresse de départ), à la place de public/manifest.webmanifest :
// un cabinet en marque blanche ne doit pas s'installer sous le nom et le monogramme de JD Precompta.
// Une seule build sert tous les cabinets, donc il est construit à la volée et servi par une URL
// `blob:` (voir lib/branding.ts).
//
// TOUTE ADRESSE Y EST ABSOLUE, et c'est ce qui le rendait non installable jusqu'au 25/09/2026. Une
// adresse relative se résout contre l'URL du manifeste, et `/` ne se résout pas contre
// `blob:https://…/<uuid>`, une URL sans chemin hiérarchique. Chrome écartait donc `start_url`
// (« URL is invalid ») et refusait l'installation (`start-url-not-valid`), avec pour seule trace un
// avertissement en console. Or le cabinet JD Consult a un logo : c'est pour lui et pour ses clients que
// l'installation ne marchait pas, pendant que le manifeste statique, lui, était installable — et c'est
// celui-là qu'on vérifiait. Mesuré avec le Chromium du banc de capture (outils/captures/installable.mjs).
//
// `id` est celui du manifeste statique : une application installée garde son identité quand le cabinet
// pose ou retire son logo, et le navigateur met à jour son nom et son icône au lieu d'en voir deux.

/** Identité de l'application installée, commune aux deux manifestes. */
export const ID_APPLICATION = '/'

export interface IconeManifeste {
  src: string
  sizes: string
  purpose: string
  type?: string
}

export interface ManifesteApplication {
  id: string
  name: string
  short_name: string
  description?: string
  lang: string
  start_url: string
  scope: string
  display: 'standalone'
  background_color: string
  theme_color: string
  icons: IconeManifeste[]
}

/** Couleurs du manifeste statique, reprises quand le cabinet n'en fixe pas. */
export const FOND_APPLICATION = '#F7F5F0'
export const THEME_APPLICATION = '#0F2438'

export function manifesteDuCabinet(p: {
  /** `location.origin` — l'adresse de l'application telle que le navigateur l'a ouverte. */
  origine: string
  nom: string | null
  logoUrl: string
  couleurPrimaire: string | null
}): ManifesteApplication {
  const racine = new URL('/', p.origine).href
  const nom = p.nom?.trim() || 'JD Precompta'
  return {
    id: ID_APPLICATION,
    name: nom,
    short_name: nom,
    lang: 'fr',
    start_url: racine,
    scope: racine,
    display: 'standalone',
    background_color: FOND_APPLICATION,
    theme_color: p.couleurPrimaire && estCouleurHexValide(p.couleurPrimaire) ? p.couleurPrimaire : THEME_APPLICATION,
    // Pas de taille ni de type fixes : le logo déposé peut être un PNG, un JPEG, un SVG ou un WebP de
    // dimensions quelconques (voir CabinetBrandingPage) — mentir sur son format le ferait rejeter.
    icons: [{ src: p.logoUrl, sizes: 'any', purpose: 'any' }],
  }
}
