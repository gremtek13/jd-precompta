import { useState, type CSSProperties } from 'react'

// Confirmation renforcée pour une suppression irréversible (dossier, cabinet) — un simple
// window.confirm() se ferme en un clic distrait sans lire son contenu ; taper le nom exact force à
// s'arrêter et à vérifier ce qu'on s'apprête à supprimer avant que le bouton ne devienne cliquable.
export default function ConfirmationSuppression({
  titre, description, nomAttendu, boutonLabel, enCours, erreur, onConfirmer, onAnnuler,
}: {
  titre: string
  description: string
  nomAttendu: string
  boutonLabel: string
  enCours: boolean
  erreur?: string | null
  onConfirmer: () => void
  onAnnuler: () => void
}) {
  const [saisie, setSaisie] = useState('')
  const correspond = saisie === nomAttendu

  return (
    <div style={overlayStyle}>
      <div className="card" style={{ width: 'min(460px, 92vw)' }}>
        <h2 style={{ marginTop: 0 }}>{titre}</h2>
        <p className="muted" style={{ whiteSpace: 'pre-line' }}>{description}</p>
        <div className="field">
          <label htmlFor="confirmation-nom">Tape « {nomAttendu} » pour confirmer</label>
          <input
            id="confirmation-nom"
            value={saisie}
            onChange={(e) => setSaisie(e.target.value)}
            autoFocus
            autoComplete="off"
          />
        </div>
        {erreur && <p className="error-text">{erreur}</p>}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="button" className="btn btn-outline" onClick={onAnnuler} disabled={enCours}>Annuler</button>
          <button type="button" className="btn btn-danger" disabled={!correspond || enCours} onClick={onConfirmer}>
            {enCours ? 'Suppression…' : boutonLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

const overlayStyle: CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 20,
}
