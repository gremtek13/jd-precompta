import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { useAuth } from '../context/AuthContext'
import { assombrir, eclaircir, estCouleurHexValide } from './colors'

export interface CabinetBranding {
  nom: string
  couleurPrimaire: string | null
  policeGoogleFont: string | null
  logoUrl: string | null
}

// CabinetBrandingPage (formulaire) et Layout (application réelle de la charte) montent chacun leur
// propre instance de useCabinetBranding — sans ce petit bus d'événements, enregistrer un changement
// dans le formulaire n'avait aucun moyen de prévenir l'instance de Layout déjà montée, qui ne
// rechargeait donc qu'au prochain rechargement complet de la page (bug remonté : "ça change pas").
const EVENEMENT_MAJ = 'cabinet-branding:maj'

export function signalerMajBranding() {
  window.dispatchEvent(new Event(EVENEMENT_MAJ))
}

// Icônes par défaut (voir index.html, data-favicon-default) détachées du <head> pendant qu'un logo de
// cabinet est actif, pour les remettre à l'identique dès qu'il n'y en a plus. Au niveau du module (pas
// d'un state React) : Layout et CabinetBrandingPage montent chacun leur propre instance du hook (voir
// plus haut), les deux doivent partager la même mémoire de "qu'est-ce qui a été détaché" plutôt que
// risquer une double détache ou un oubli de restauration selon l'instance qui se démonte en premier.
let iconesDefautDetachees: Element[] | null = null
// URL blob du dernier manifest reconstruit (voir plus bas) — révoquée avant d'en créer une nouvelle,
// sinon chaque changement de cabinet/couleur en accumule une de plus pour la durée de l'onglet.
let dernierManifestBlobUrl: string | null = null

function appliquerFaviconCabinet(logoUrl: string | null, nom: string | null, couleurPrimaire: string | null) {
  // Toujours reconstruites depuis zéro (jamais réutilisées) : plus simple que de comparer à l'état
  // précédent, et sans coût réel vu le nombre de nœuds en jeu.
  document.querySelectorAll('[data-cabinet-favicon]').forEach((el) => el.remove())
  const ancienLienManifest = document.querySelector('link[rel="manifest"]') as HTMLLinkElement | null

  if (logoUrl) {
    if (!iconesDefautDetachees) {
      iconesDefautDetachees = [...document.querySelectorAll('[data-favicon-default]')]
      iconesDefautDetachees.forEach((el) => el.remove())
    }
    for (const rel of ['icon', 'apple-touch-icon']) {
      const lien = document.createElement('link')
      lien.rel = rel
      // Pas de type/sizes fixe : le logo uploadé peut être .png/.jpg/.svg/.webp, de dimensions
      // quelconques (voir CabinetBrandingPage) — laisser le navigateur sniffer plutôt que de mentir
      // sur le format évite qu'il rejette silencieusement l'icône par mismatch type/contenu.
      lien.href = logoUrl
      lien.setAttribute('data-cabinet-favicon', 'true')
      document.head.appendChild(lien)
    }
    // Le manifest statique (public/manifest.webmanifest) ne peut pas varier par cabinet — une seule
    // build pour toute la plateforme — donc reconstruit ici à la volée et servi via une URL blob,
    // uniquement pour l'icône d'ajout à l'écran d'accueil Android/Chrome (iOS s'appuie sur
    // apple-touch-icon ci-dessus, pas sur le manifest).
    const manifest = {
      name: nom || 'JD Precompta',
      short_name: nom || 'JD Precompta',
      start_url: '/',
      display: 'standalone',
      background_color: '#F7F5F0',
      theme_color: couleurPrimaire && estCouleurHexValide(couleurPrimaire) ? couleurPrimaire : '#0F2438',
      icons: [{ src: logoUrl, sizes: 'any', purpose: 'any' }],
    }
    if (dernierManifestBlobUrl) URL.revokeObjectURL(dernierManifestBlobUrl)
    dernierManifestBlobUrl = URL.createObjectURL(new Blob([JSON.stringify(manifest)], { type: 'application/json' }))
    if (ancienLienManifest) ancienLienManifest.href = dernierManifestBlobUrl
  } else if (iconesDefautDetachees) {
    iconesDefautDetachees.forEach((el) => document.head.appendChild(el))
    iconesDefautDetachees = null
    if (ancienLienManifest) ancienLienManifest.href = '/manifest.webmanifest'
    if (dernierManifestBlobUrl) {
      URL.revokeObjectURL(dernierManifestBlobUrl)
      dernierManifestBlobUrl = null
    }
  }
}

// Charte graphique par cabinet (voir CabinetBrandingPage) — appliquée aussi bien aux comptables du
// cabinet qu'à ses clients, les deux partageant le même Layout : la couleur d'accent et la police
// choisies par un cabinet remplacent le turquoise/Inter par défaut de JD Precompta pour tout le monde
// connecté sous ce cabinet, comptables comme clients. Rien ne change pour un cabinet qui n'a encore
// rien configuré (couleur_primaire nulle) — les valeurs par défaut du CSS restent actives.
export function useCabinetBranding(): CabinetBranding | null {
  const { monCabinetId } = useAuth()
  const [branding, setBranding] = useState<CabinetBranding | null>(null)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    function surMaj() { setVersion((v) => v + 1) }
    window.addEventListener(EVENEMENT_MAJ, surMaj)
    return () => window.removeEventListener(EVENEMENT_MAJ, surMaj)
  }, [])

  useEffect(() => {
    let annule = false
    if (!monCabinetId) {
      setBranding(null)
      return
    }
    supabase
      .from('cabinets')
      .select('nom, couleur_primaire, police_google_font, logo_storage_path')
      .eq('id', monCabinetId)
      .maybeSingle()
      .then(({ data }) => {
        if (annule || !data) return
        const logoUrl = data.logo_storage_path
          ? supabase.storage.from('cabinet-logos').getPublicUrl(data.logo_storage_path).data.publicUrl
          : null
        setBranding({
          nom: data.nom,
          couleurPrimaire: data.couleur_primaire,
          policeGoogleFont: data.police_google_font,
          logoUrl,
        })
      })
    return () => { annule = true }
  }, [monCabinetId, version])

  // Couleur : posée en style inline sur la racine — priorité systématique sur les valeurs de
  // index.css (thème clair ou sombre), qui restent la référence pour tout cabinet n'ayant rien
  // configuré. Trois variables à couvrir, pas seulement --color-primary : sans les deux autres, les
  // badges/survols garderaient la teinte JD par défaut à côté du nouvel accent, un mélange incohérent.
  useEffect(() => {
    const racine = document.documentElement
    const couleur = branding?.couleurPrimaire
    if (couleur && estCouleurHexValide(couleur)) {
      racine.style.setProperty('--color-primary', couleur)
      racine.style.setProperty('--color-primary-hover', assombrir(couleur, 0.12))
      racine.style.setProperty('--color-primary-light', eclaircir(couleur, 0.88))
    } else {
      racine.style.removeProperty('--color-primary')
      racine.style.removeProperty('--color-primary-hover')
      racine.style.removeProperty('--color-primary-light')
    }
    return () => {
      racine.style.removeProperty('--color-primary')
      racine.style.removeProperty('--color-primary-hover')
      racine.style.removeProperty('--color-primary-light')
    }
  }, [branding?.couleurPrimaire])

  // Favicon/icône d'écran d'accueil : reprend le logo du cabinet s'il en a un (voir
  // appliquerFaviconCabinet ci-dessus) — pas de nettoyage au démontage : quand branding.logoUrl
  // repasse à null (déconnexion, cabinet sans logo), cette même fonction revient déjà d'elle-même
  // aux icônes par défaut, inutile de dupliquer cette logique dans un retour de useEffect.
  useEffect(() => {
    appliquerFaviconCabinet(branding?.logoUrl ?? null, branding?.nom ?? null, branding?.couleurPrimaire ?? null)
  }, [branding?.logoUrl, branding?.nom, branding?.couleurPrimaire])

  // Police : chargée dynamiquement (même mécanisme que Inter dans index.html, posé statiquement) puis
  // appliquée au <body> — jamais sur :root, pour ne pas casser d'éventuelles polices à part déjà
  // choisies via une règle CSS plus spécifique ailleurs (aucune actuellement, mais un <body> reste le
  // point d'entrée le plus sûr).
  useEffect(() => {
    const police = branding?.policeGoogleFont
    if (!police) return
    const id = 'cabinet-google-font'
    let lien = document.getElementById(id) as HTMLLinkElement | null
    if (!lien) {
      lien = document.createElement('link')
      lien.id = id
      lien.rel = 'stylesheet'
      document.head.appendChild(lien)
    }
    lien.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(police)}:wght@400;600;700;800&display=swap`
    document.body.style.fontFamily = `"${police}", "Inter", -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`
    return () => { document.body.style.fontFamily = '' }
  }, [branding?.policeGoogleFont])

  return branding
}
