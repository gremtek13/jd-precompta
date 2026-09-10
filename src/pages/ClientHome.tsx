import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { deposerFichier } from '../lib/depot'
import { IconCamera, IconDocuments, IconEstimation, IconInformations } from '../components/icons'
import type { Dossier } from '../lib/types'

const CLE_ONBOARDING_VU = 'jd-precompta-client-onboarding-vu'

// Page d'accueil du client — un point d'entrée, pas un tableau de bord : une carte de bienvenue et
// quatre grandes tuiles (icône, libellé, une phrase qui dit à quoi ça sert), plus intuitif pour
// quelqu'un qui n'est pas comptable qu'un menu latéral de texte. La prise de photo est la tuile
// principale : c'est le geste le plus fréquent d'un client (une facture reçue → une photo).
export default function ClientHome() {
  const { dossierActifId } = useAuth()
  const dossierId = dossierActifId
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
  const aujourdhui = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <>
      <section className="client-hero">
        <span className="client-hero-date">{aujourdhui}</span>
        <h1>{prenom ? `Bonjour ${prenom} 👋` : 'Bonjour 👋'}</h1>
        <p className="client-hero-sous">{dossier ? `Ton espace pour ${dossier.nom}` : 'Ton espace'} — dépose, on s'occupe du reste.</p>
      </section>

      <div className="tuiles">
        <label className={`tuile tuile-principale${capturing ? ' tuile-desactivee' : ''}`}>
          <span className="tuile-icone"><IconCamera width={24} height={24} /></span>
          <span className="tuile-libelle">{capturing ? 'Analyse en cours…' : 'Prendre une photo'}</span>
          <span className="tuile-desc">Une facture, un reçu : photographie-le, il est reconnu et classé tout seul.</span>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            style={{ display: 'none' }}
            disabled={capturing}
            onChange={(e) => { handleCapture(e.target.files); e.target.value = '' }}
          />
        </label>
        <Link to="/mes-pieces" className="tuile">
          <span className="tuile-icone"><IconDocuments width={24} height={24} /></span>
          <span className="tuile-libelle">Mes pièces</span>
          <span className="tuile-desc">Dépose des fichiers et vois ce qu'il manque encore à ton dossier.</span>
        </Link>
        <Link to="/mes-informations" className="tuile">
          <span className="tuile-icone"><IconInformations width={24} height={24} /></span>
          <span className="tuile-libelle">Mes informations</span>
          <span className="tuile-desc">Véhicule, titres-restaurant, chèques-vacances… à renseigner une fois.</span>
        </Link>
        <Link to="/ma-simulation" className="tuile">
          <span className="tuile-icone"><IconEstimation width={24} height={24} /></span>
          <span className="tuile-libelle">Ma simulation</span>
          <span className="tuile-desc">Une estimation de tes charges sociales à partir de tes chiffres.</span>
        </Link>
      </div>

      {captureError && <p className="error-text" style={{ marginBottom: 16 }}>{captureError}</p>}

      {!onboardingVu && (
        <div className="widget">
          <header className="widget-entete">
            <div>
              <h3 className="widget-titre">Comment ça marche</h3>
              <p className="widget-sous-titre">Trois étapes, rien à trier de ton côté.</p>
            </div>
            <div className="widget-action">
              <button type="button" className="btn btn-outline btn-sm" onClick={masquerOnboarding}>Compris</button>
            </div>
          </header>
          <div className="widget-corps">
            <div className="etapes">
              <div className="etape">
                <span className="etape-num">1</span>
                <div>
                  <div className="etape-titre">Dépose tes fichiers</div>
                  <div className="etape-desc">Factures, reçus, relevés, appels de cotisation — sans trier.</div>
                </div>
              </div>
              <div className="etape">
                <span className="etape-num">2</span>
                <div>
                  <div className="etape-titre">C'est reconnu automatiquement</div>
                  <div className="etape-desc">Chaque fichier est analysé et classé dès l'envoi.</div>
                </div>
              </div>
              <div className="etape">
                <span className="etape-num">3</span>
                <div>
                  <div className="etape-titre">Suis ce qu'il reste</div>
                  <div className="etape-desc">La checklist dans "Mes pièces" te dit ce qui manque.</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
