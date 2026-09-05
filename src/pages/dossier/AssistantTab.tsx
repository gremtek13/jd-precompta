import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { supabase } from '../../lib/supabase'

interface Message {
  role: 'user' | 'assistant'
  texte: string
  outils?: string[]
}

// Assistant conversationnel en lecture seule sur ce dossier (voir supabase/functions/agent-comptable) :
// répond à des questions ("Pourquoi le compte 6251 a augmenté ?", "Quelles sont les anomalies ?") en
// interrogeant les données déjà en base via des outils contrôlés, jamais en écrivant quoi que ce soit.
// Conversation gardée en mémoire le temps de l'onglet seulement (pas de persistance en base pour ce
// premier jet) — recharger la page ou changer d'onglet repart d'une conversation vide.
export default function AssistantTab({ dossierId }: { dossierId: string }) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const zoneRef = useRef<HTMLTextAreaElement>(null)

  async function envoyer(e: FormEvent) {
    e.preventDefault()
    const texte = input.trim()
    if (!texte || loading) return

    setInput('')
    setError(null)
    const historique = messages.map((m) => ({ role: m.role, texte: m.texte }))
    const nouveauxMessages: Message[] = [...messages, { role: 'user', texte }]
    setMessages(nouveauxMessages)
    setLoading(true)

    try {
      const { data, error: invokeError } = await supabase.functions.invoke<{ reponse?: string; outils_utilises?: string[]; error?: string }>(
        'agent-comptable',
        { body: { dossierId, message: texte, historique } },
      )
      // Sur un statut non-2xx, invokeError est générique — le message précis est dans data.error.
      if (data?.error) throw new Error(data.error)
      if (invokeError) throw invokeError
      if (!data?.reponse) throw new Error("Réponse vide.")

      setMessages([...nouveauxMessages, { role: 'assistant', texte: data.reponse, outils: data.outils_utilises }])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Une erreur est survenue.')
    } finally {
      setLoading(false)
      zoneRef.current?.focus()
    }
  }

  function surTouche(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      envoyer(e)
    }
  }

  return (
    <>
      <p className="muted" style={{ marginTop: -8, marginBottom: 20 }}>
        Répond uniquement à partir des données déjà présentes dans ce dossier — ne modifie jamais
        rien, ne peut pas accéder à un autre dossier. Vérifie toujours un chiffre important avant de
        le communiquer.
      </p>

      <div className="card" style={{ padding: 0, marginBottom: 12, minHeight: 240 }}>
        {messages.length === 0 ? (
          <div className="empty-state">
            Pose une question, par exemple « Pourquoi le compte 6251 a-t-il augmenté cette année ? »
            ou « Quelles sont les anomalies de ce dossier ? ».
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: 16 }}>
            {messages.map((m, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                <div
                  style={{
                    maxWidth: '85%',
                    padding: '10px 14px',
                    borderRadius: 10,
                    whiteSpace: 'pre-wrap',
                    background: m.role === 'user' ? 'var(--color-primary)' : 'var(--surface-2, #f4f4f4)',
                    color: m.role === 'user' ? '#fff' : 'inherit',
                  }}
                >
                  {m.texte}
                </div>
                {m.outils && m.outils.length > 0 && (
                  <span className="muted" style={{ fontSize: '0.78rem', marginTop: 4 }}>
                    Outils utilisés : {m.outils.join(', ')}
                  </span>
                )}
              </div>
            ))}
            {loading && <span className="muted">L'assistant réfléchit…</span>}
          </div>
        )}
      </div>

      {error && <p className="error-text">{error}</p>}

      <form onSubmit={envoyer} className="field-row" style={{ alignItems: 'flex-end' }}>
        <div className="field" style={{ flex: 1 }}>
          <textarea
            aria-label="Question"
            ref={zoneRef}
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={surTouche}
            placeholder="Pose ta question… (Entrée pour envoyer, Maj+Entrée pour une nouvelle ligne)"
            disabled={loading}
          />
        </div>
        <button className="btn btn-primary" type="submit" disabled={loading || !input.trim()}>
          {loading ? 'Envoi…' : 'Envoyer'}
        </button>
        {messages.length > 0 && (
          <button
            type="button"
            className="btn btn-outline"
            disabled={loading}
            onClick={() => { setMessages([]); setError(null) }}
          >
            Nouvelle conversation
          </button>
        )}
      </form>
    </>
  )
}
