import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { deposerFichier } from '../lib/depot'
import { IconCamera, IconChecklist, IconDocuments, IconEstimation, IconInformations, IconPieces } from '../components/icons'
import type { Dossier } from '../lib/types'

const CLE_ONBOARDING_VU = 'jd-precompta-client-onboarding-vu'

// Page d'accueil du client — un point d'entrée, pas un tableau de bord : une salutation et deux
// grosses icônes façon écran d'accueil de téléphone (glyphe blanc sur pastille arrondie, libellé
// dessous), plus intuitif pour quelqu'un qui n'est pas comptable qu'un menu latéral avec plusieurs
// entrées de texte. La sidebar reste disponible pour la navigation directe une fois qu'on connaît l'appli.
export default function ClientHome() {
  const { dossierIds } = useAuth()
  const dossierId = dossierIds[0]
  const navigate = useNavigate()
  const [dossier, setDossier] = useState<Dossier | null>(null)
  const [onboardingVu, setOnboardingVu] = useState(true)
  const [capturing, setCapturing] = useState(false)
  const [captureError, setCaptureError] = useState<string | null>(null)

  useEffect(() => {
    if (!dossierId) return
    supabase.from('dossiers').select('*').eq('id', dossierId).maybeSingle().then(({ data }) => setDossier(data ?? null))
  }, [dossierId])

  useEffect(() => {
    setOnboardingVu(localStorage.getItem(CLE_ONBOARDING_VU) === '1')
  }, [])

  function masquerOnboarding() {
    localStorage.setItem(CLE_ONBOARDING_VU, '1')
    setOnboardingVu(true)
  }

  // Prise de photo directement depuis l'accueil — même pipeline que "Déposer des fichiers" (Mes
  // pièces) via deposerFichier (lib/depot.ts) : hash anti-doublon, upload, extraction automatique,
  // classement Pièces/Documents. Une fois traité, on renvoie vers "Mes pièces" pour que le client
  // voie tout de suite que sa photo est bien arrivée et où elle a été rangée.
  async function handleCapture(fileList: FileList | null) {
    if (!fileList || fileList.length === 0 || !dossierId) return
    const file = fileList[0]
    setCapturing(true)
    setCaptureError(null)
    const resultat = await deposerFichier(dossierId, file)
    setCapturing(false)
    if (resultat.statut === 'erreur') {
      setCaptureError(`${file.name} : ${resultat.message}.`)
      return
    }
    if (resultat.statut === 'doublon') {
      setCaptureError(`${file.name} : déjà déposé, pas réenvoyé.`)
      return
    }
    navigate('/mes-pieces')
  }

  if (!dossierId) {
    return <p className="muted">Aucun dossier ne t'est encore rattaché — contacte JD Consult.</p>
  }

  // Juste le prénom si on a un nom complet ("Marie Dupont" → "Marie") — plus chaleureux qu'un nom
  // entier ou qu'un générique "Bonjour" sans rien, mais on ne connaît que ce que le cabinet a saisi.
  const prenom = dossier?.contact_nom?.trim().split(/\s+/)[0]

  return (
    <div className="home-client">
      <h1 style={{ marginBottom: 2 }}>{prenom ? `Bonjour ${prenom} 👋` : 'Bonjour 👋'}</h1>
      <p className="muted" style={{ margin: 0 }}>{dossier ? `Ton espace pour ${dossier.nom}` : 'Ton espace'}</p>

      <div className="home-tiles">
        <Link to="/mes-pieces" className="home-tile">
          <span className="home-tile-icon"><IconDocuments width={34} height={34} /></span>
          <span className="home-tile-label">Mes pièces</span>
        </Link>
        <Link to="/mes-informations" className="home-tile">
          <span className="home-tile-icon"><IconInformations width={34} height={34} /></span>
          <span className="home-tile-label">Mes informations</span>
        </Link>
        <Link to="/ma-simulation" className="home-tile">
          <span className="home-tile-icon"><IconEstimation width={34} height={34} /></span>
          <span className="home-tile-label">Ma simulation</span>
        </Link>
        <label className="home-tile" style={{ cursor: capturing ? 'default' : 'pointer', opacity: capturing ? 0.6 : 1 }}>
          <span className="home-tile-icon"><IconCamera width={34} height={34} /></span>
          <span className="home-tile-label">{capturing ? 'Analyse en cours…' : 'Prendre une photo'}</span>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            style={{ display: 'none' }}
            disabled={capturing}
            onChange={(e) => { handleCapture(e.target.files); e.target.value = '' }}
          />
        </label>
      </div>

      {captureError && <p className="error-text" style={{ marginTop: 16 }}>{captureError}</p>}

      {!onboardingVu && (
        <div className="card" style={{ marginTop: 32, maxWidth: 560, textAlign: 'left', width: '100%' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
            <h3 style={{ marginTop: 0 }}>Comment ça marche</h3>
            <button type="button" className="btn btn-outline btn-sm" onClick={masquerOnboarding}>Compris</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 16 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span style={{ color: 'var(--color-primary)', flexShrink: 0 }}><IconDocuments width={20} height={20} /></span>
              <div>
                <div style={{ fontWeight: 600 }}>1. Dépose tes fichiers</div>
                <div className="muted" style={{ fontSize: '0.85rem' }}>Factures, reçus, relevés, appels de cotisation — sans trier.</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span style={{ color: 'var(--color-primary)', flexShrink: 0 }}><IconPieces width={20} height={20} /></span>
              <div>
                <div style={{ fontWeight: 600 }}>2. C'est reconnu automatiquement</div>
                <div className="muted" style={{ fontSize: '0.85rem' }}>Chaque fichier est analysé et classé dès l'envoi.</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span style={{ color: 'var(--color-primary)', flexShrink: 0 }}><IconChecklist width={20} height={20} /></span>
              <div>
                <div style={{ fontWeight: 600 }}>3. Suis ce qu'il reste</div>
                <div className="muted" style={{ fontSize: '0.85rem' }}>La checklist dans "Mes pièces" te dit ce qui manque.</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
