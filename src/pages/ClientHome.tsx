import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { IconChecklist, IconDocuments, IconInformations, IconPieces } from '../components/icons'
import type { Dossier } from '../lib/types'

const CLE_ONBOARDING_VU = 'jd-precompta-client-onboarding-vu'

// Page d'accueil du client — un point d'entrée, pas un tableau de bord : une salutation et deux
// grosses icônes façon écran d'accueil de téléphone (glyphe blanc sur pastille arrondie, libellé
// dessous), plus intuitif pour quelqu'un qui n'est pas comptable qu'un menu latéral avec plusieurs
// entrées de texte. La sidebar reste disponible pour la navigation directe une fois qu'on connaît l'appli.
export default function ClientHome() {
  const { dossierIds } = useAuth()
  const dossierId = dossierIds[0]
  const [dossier, setDossier] = useState<Dossier | null>(null)
  const [onboardingVu, setOnboardingVu] = useState(true)

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
      </div>

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
