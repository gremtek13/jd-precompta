import { useState, type CSSProperties } from 'react'
import { IconAssistant } from '../../components/icons'
import AssistantTab from './AssistantTab'

// Bulle de chat flottante plutôt qu'un onglet du parcours (voir audit ergonomie) : l'assistant est
// utilisable "à tout moment, sur n'importe quelle question", pas une étape du dossier — le sortir de
// la barre d'onglets libère une place et le rend accessible sans changer d'écran, quel que soit
// l'onglet affiché. Montée une seule fois par page dossier (voir DossierDetail), pas par onglet :
// l'état ouvert/fermé (et donc la conversation visible) survit à un changement d'onglet.
export default function AssistantFlottant({ dossierId }: { dossierId: string }) {
  const [ouvert, setOuvert] = useState(false)

  return (
    <>
      {ouvert && (
        <div className="card" style={panneauStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ margin: 0 }}>Assistant</h3>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => setOuvert(false)}
              aria-label="Fermer l'assistant"
              style={{ padding: '2px 10px' }}
            >
              ✕
            </button>
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <AssistantTab dossierId={dossierId} />
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOuvert((v) => !v)}
        aria-label={ouvert ? "Fermer l'assistant" : "Ouvrir l'assistant"}
        style={boutonStyle}
      >
        <IconAssistant width={24} height={24} />
      </button>
    </>
  )
}

const boutonStyle: CSSProperties = {
  position: 'fixed', bottom: 24, right: 24, zIndex: 45,
  width: 52, height: 52, borderRadius: '50%', border: 'none',
  background: 'var(--color-primary)', color: '#fff',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  cursor: 'pointer', boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
}

const panneauStyle: CSSProperties = {
  position: 'fixed', bottom: 88, right: 24, zIndex: 45,
  width: 'min(420px, 92vw)',
  // dvh (hauteur de viewport "dynamique") plutôt que vh : sur mobile, vh compte la fenêtre comme si la
  // barre d'adresse était toujours masquée, ce qui pouvait faire déborder le panneau de l'écran visible
  // réel (c'est ce qui rendait le contenu "flottant" par-dessus la page sur la capture envoyée).
  height: 'min(600px, 75dvh)',
  display: 'flex', flexDirection: 'column',
  // Rustine défensive indispensable : sans ça, un contenu plus haut que prévu déborde du panneau au
  // lieu d'être coupé/scrollable — exactement le bug observé (texte et boutons visibles par-dessus le
  // reste de la page, sans fond).
  overflow: 'hidden',
  boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
}
