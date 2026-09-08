import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { eclaircir, estCouleurHexValide } from '../lib/colors'
import type { Cabinet } from '../lib/types'

// Polices proposées, pas de champ libre : un nom de police Google Fonts mal orthographié ne casse
// rien (repli silencieux sur Inter dans le navigateur) mais ne sert à rien non plus — autant garantir
// que chaque choix fonctionne vraiment, plutôt que de laisser deviner un nom exact.
const POLICES_PROPOSEES = [
  { valeur: '', label: 'Inter (par défaut)' },
  { valeur: 'Roboto', label: 'Roboto' },
  { valeur: 'Lato', label: 'Lato' },
  { valeur: 'Source Sans 3', label: 'Source Sans 3' },
  { valeur: 'Nunito Sans', label: 'Nunito Sans' },
  { valeur: 'Work Sans', label: 'Work Sans' },
  { valeur: 'IBM Plex Sans', label: 'IBM Plex Sans' },
  { valeur: 'Merriweather', label: 'Merriweather (empattements)' },
]

const COULEUR_DEFAUT = '#2f7a6f' // --color-primary par défaut (thème clair), point de départ neutre

// Charte graphique du cabinet — réservée aux chefs de cabinet (voir Layout, lien affiché seulement si
// estChef) : couleur d'accent, police et logo remplacent les valeurs par défaut JD Precompta pour tout
// le monde connecté sous ce cabinet, comptables comme clients (voir lib/branding.ts, appliqué dans
// Layout). couleur_primaire_claire n'est jamais saisie ici : dérivée automatiquement à l'enregistrement
// (voir lib/colors.ts) — demander deux couleurs cohérentes à régler à la main n'aurait pas de sens.
export default function CabinetBrandingPage() {
  const { monCabinetId } = useAuth()
  const [cabinet, setCabinet] = useState<Cabinet | null>(null)
  const [loading, setLoading] = useState(true)
  const [couleur, setCouleur] = useState(COULEUR_DEFAUT)
  const [police, setPolice] = useState('')
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [succes, setSucces] = useState(false)

  async function charger() {
    if (!monCabinetId) return
    setLoading(true)
    const { data } = await supabase.from('cabinets').select('*').eq('id', monCabinetId).maybeSingle()
    if (data) {
      setCabinet(data)
      setCouleur(data.couleur_primaire ?? COULEUR_DEFAUT)
      setPolice(data.police_google_font ?? '')
    }
    setLoading(false)
  }

  useEffect(() => { charger() }, [monCabinetId])

  // Aperçu local du logo choisi avant tout enregistrement, ou aperçu du logo déjà en place sinon —
  // même logique que PieceFormModal pour la pièce jointe.
  useEffect(() => {
    if (logoFile) {
      const url = URL.createObjectURL(logoFile)
      setLogoPreviewUrl(url)
      return () => URL.revokeObjectURL(url)
    }
    if (cabinet?.logo_storage_path) {
      setLogoPreviewUrl(supabase.storage.from('cabinet-logos').getPublicUrl(cabinet.logo_storage_path).data.publicUrl)
    } else {
      setLogoPreviewUrl(null)
    }
  }, [logoFile, cabinet?.logo_storage_path])

  function choisirLogo(e: ChangeEvent<HTMLInputElement>) {
    setLogoFile(e.target.files?.[0] ?? null)
  }

  async function enregistrer(e: FormEvent) {
    e.preventDefault()
    if (!monCabinetId) return
    if (!estCouleurHexValide(couleur)) {
      setError('Couleur invalide — choisis-en une avec le sélecteur ci-dessus.')
      return
    }
    setSaving(true)
    setError(null)
    setSucces(false)
    try {
      let logoStoragePath = cabinet?.logo_storage_path ?? null
      if (logoFile) {
        const extension = logoFile.name.split('.').pop() || 'png'
        const chemin = `${monCabinetId}/logo-${Date.now()}.${extension}`
        const { error: uploadError } = await supabase.storage.from('cabinet-logos').upload(chemin, logoFile)
        if (uploadError) throw uploadError
        // L'ancien logo n'est pas gardé — un seul logo actif à la fois, pas d'archive à faire le
        // ménage dessus plus tard. Best-effort : un échec de suppression ne bloque pas le nouveau.
        if (logoStoragePath) {
          await supabase.storage.from('cabinet-logos').remove([logoStoragePath]).catch(() => {})
        }
        logoStoragePath = chemin
      }

      const { error: updateError } = await supabase
        .from('cabinets')
        .update({
          couleur_primaire: couleur,
          couleur_primaire_claire: eclaircir(couleur, 0.88),
          police_google_font: police || null,
          logo_storage_path: logoStoragePath,
        })
        .eq('id', monCabinetId)
      if (updateError) throw updateError

      setLogoFile(null)
      setSucces(true)
      await charger()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Une erreur est survenue.')
    } finally {
      setSaving(false)
    }
  }

  async function retirerLogo() {
    if (!monCabinetId || !cabinet?.logo_storage_path) return
    if (!window.confirm('Retirer le logo du cabinet ?')) return
    setSaving(true)
    setError(null)
    try {
      await supabase.storage.from('cabinet-logos').remove([cabinet.logo_storage_path]).catch(() => {})
      const { error: updateError } = await supabase.from('cabinets').update({ logo_storage_path: null }).eq('id', monCabinetId)
      if (updateError) throw updateError
      setLogoFile(null)
      await charger()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Une erreur est survenue.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <p className="muted">Chargement…</p>

  return (
    <>
      <div className="topbar">
        <h1>Apparence du cabinet</h1>
      </div>
      <p className="muted" style={{ marginTop: -12, marginBottom: 20 }}>
        Couleur, police et logo remplacent les valeurs par défaut de JD Precompta pour tout le monde
        connecté sous ce cabinet — les comptables de l'équipe comme les clients.
      </p>

      <div className="card" style={{ maxWidth: 480 }}>
        <form onSubmit={enregistrer}>
          <div className="field">
            <label htmlFor="couleur">Couleur d'accent</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input
                id="couleur"
                type="color"
                value={estCouleurHexValide(couleur) ? couleur : COULEUR_DEFAUT}
                onChange={(e) => setCouleur(e.target.value)}
                style={{ width: 44, height: 36, padding: 2, cursor: 'pointer' }}
              />
              <input
                type="text"
                value={couleur}
                onChange={(e) => setCouleur(e.target.value)}
                placeholder="#2f7a6f"
                style={{ width: 110 }}
              />
              <button type="button" className="btn btn-sm" style={{ background: couleur, color: '#fff', border: 'none' }} disabled>
                Aperçu
              </button>
            </div>
          </div>

          <div className="field">
            <label htmlFor="police">Police</label>
            <select id="police" value={police} onChange={(e) => setPolice(e.target.value)}>
              {POLICES_PROPOSEES.map((p) => <option key={p.valeur} value={p.valeur}>{p.label}</option>)}
            </select>
          </div>

          <div className="field">
            <label htmlFor="logo">Logo</label>
            {logoPreviewUrl && (
              <div style={{ marginBottom: 8 }}>
                <img
                  src={logoPreviewUrl}
                  alt="Logo du cabinet"
                  style={{ maxHeight: 60, maxWidth: 220, objectFit: 'contain', borderRadius: 8, border: '1px solid var(--color-border)', padding: 6, background: '#fff' }}
                />
              </div>
            )}
            <input id="logo" type="file" accept=".png,.jpg,.jpeg,.svg,.webp" onChange={choisirLogo} />
            {cabinet?.logo_storage_path && !logoFile && (
              <button type="button" className="btn btn-outline btn-sm" style={{ marginTop: 8 }} onClick={retirerLogo} disabled={saving}>
                Retirer le logo
              </button>
            )}
          </div>

          {error && <p className="error-text">{error}</p>}
          {succes && <p className="muted" style={{ color: 'var(--color-primary)' }}>Enregistré.</p>}

          <button type="submit" className="btn btn-primary" disabled={saving} style={{ marginTop: 6 }}>
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </form>
      </div>
    </>
  )
}
