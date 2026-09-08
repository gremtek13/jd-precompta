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
