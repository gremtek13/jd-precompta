import { useState } from 'react'
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
        <div className="card assistant-panneau">
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
        className="assistant-bouton"
      >
        <IconAssistant width={24} height={24} />
      </button>
    </>
  )
}
