import { useState, type CSSProperties, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'

interface Props {
  dossierId: string
  type: 'facture' | 'relance_pieces'
  // Adresse déjà connue (memberships.email pour une relance, factures_emises.tiers_email pour un
  // renvoi) — pré-remplie mais toujours modifiable, un cabinet peut vouloir viser une autre adresse.
  destinataireInitial?: string | null
  factureId?: string
  titre: string
  description: string
  onClose: () => void
  onSent?: () => void
}

// Modale générique d'envoi d'e-mail (voir supabase/functions/send-email) — réutilisée pour les deux
// modèles existants (facture, relance de pièces) plutôt que dupliquée : seuls le titre/la description
// et les paramètres passés à la fonction changent d'un usage à l'autre.
export default function EnvoyerEmailModal({ dossierId, type, destinataireInitial, factureId, titre, description, onClose, onSent }: Props) {
  const [destinataire, setDestinataire] = useState(destinataireInitial ?? '')
  const [message, setMessage] = useState('')
  const [envoi, setEnvoi] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const [envoye, setEnvoye] = useState(false)

  async function envoyer(e: FormEvent) {
    e.preventDefault()
    setEnvoi(true)
    setErreur(null)
    const { data, error: invokeError } = await supabase.functions.invoke<{ ok?: boolean; error?: string }>('send-email', {
      body: { dossierId, type, destinataire: destinataire.trim(), message: message.trim() || undefined, factureId },
    })
    setEnvoi(false)
    if (data?.error || invokeError) {
      setErreur(data?.error ?? "Échec de l'envoi.")
      return
    }
    setEnvoye(true)
    onSent?.()
  }

  return (
    <div style={overlayStyle}>
      <div className="card" style={{ width: 'min(480px, 92vw)' }}>
        <h2 style={{ marginTop: 0 }}>{titre}</h2>
        {envoye ? (
          <>
            <p><span className="badge badge-ok">Envoyé</span> à {destinataire}.</p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
              <button type="button" className="btn btn-primary" onClick={onClose}>Fermer</button>
            </div>
          </>
        ) : (
          <form onSubmit={envoyer}>
            <p className="muted" style={{ marginTop: -8 }}>{description}</p>
            <div className="field">
              <label htmlFor="email-destinataire">Adresse du destinataire</label>
              <input id="email-destinataire" type="email" required value={destinataire} onChange={(e) => setDestinataire(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="email-message">Message personnalisé (facultatif)</label>
              <textarea id="email-message" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Laisse vide pour le message par défaut." />
            </div>
            {erreur && <p className="error-text">{erreur}</p>}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
              <button type="button" className="btn btn-outline" onClick={onClose} disabled={envoi}>Annuler</button>
              <button type="submit" className="btn btn-primary" disabled={envoi}>{envoi ? 'Envoi…' : 'Envoyer'}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

const overlayStyle: CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20,
}
