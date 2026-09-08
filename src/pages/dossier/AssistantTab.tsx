import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import type { AgentConversation } from '../../lib/types'

interface Message {
  role: 'user' | 'assistant'
  texte: string
  outils?: string[]
}

// Assistant conversationnel en lecture seule sur ce dossier (voir supabase/functions/agent-comptable) :
// répond à des questions ("Pourquoi le compte 6251 a augmenté ?", "Quelles sont les anomalies ?") en
// interrogeant les données déjà en base via des outils contrôlés, jamais en écrivant quoi que ce soit.
// Historique persisté dans agent_conversations, partagé entre tous les admins du cabinet pour ce
// dossier (comme le reste de l'appli — le cabinet est un seul acteur) : changer d'onglet ou
// recharger la page ne perd plus la conversation.
export default function AssistantTab({ dossierId }: { dossierId: string }) {
  const { session } = useAuth()
  const [messages, setMessages] = useState<Message[]>([])
  const [chargement, setChargement] = useState(true)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const zoneRef = useRef<HTMLTextAreaElement>(null)

  async function charger() {
    setChargement(true)
    const { data } = await supabase
      .from('agent_conversations')
      .select('role, texte, outils_utilises')
      .eq('dossier_id', dossierId)
      .order('created_at', { ascending: true })
    setMessages((data ?? []).map((r: Pick<AgentConversation, 'role' | 'texte' | 'outils_utilises'>) => ({
      role: r.role,
      texte: r.texte,
      outils: r.outils_utilises ?? undefined,
    })))
    setChargement(false)
  }

  useEffect(() => { charger() }, [dossierId])

  // Best-effort : un échec d'enregistrement de l'historique ne doit jamais casser la conversation
  // elle-même, seulement priver cette ligne de persistance (rare, et sans conséquence grave).
  async function enregistrer(role: 'user' | 'assistant', texte: string, outils?: string[]) {
    await supabase.from('agent_conversations').insert({
      dossier_id: dossierId,
      role,
      texte,
      outils_utilises: outils ?? null,
      created_by: session?.user.id ?? null,
    })
  }

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
    enregistrer('user', texte)

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
      enregistrer('assistant', data.reponse, data.outils_utilises)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Une erreur est survenue.')
    } finally {
      setLoading(false)
      zoneRef.current?.focus()
    }
  }

  // Historique partagé entre tout le cabinet (voir le commentaire en tête de fichier) : un clic
  // malheureux ici effaçait jusqu'ici la conversation de tout le monde, sans confirmation — contraire
  // à toute autre suppression de l'appli, qui en demande toujours une (voir audit ergonomie).
  async function nouvelleConversation() {
    if (!window.confirm(
      "Supprimer définitivement cette conversation ? Elle est partagée avec le reste du cabinet — personne ne pourra plus la relire.",
    )) return
    setMessages([])
    setError(null)
    await supabase.from('agent_conversations').delete().eq('dossier_id', dossierId)
  }

  function surTouche(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      envoyer(e)
    }
  }

  // Mise en page "chat" à hauteur pleine (remplit le panneau flottant qui l'héberge, voir
  // AssistantFlottant) : seule la zone de messages défile, le champ de saisie reste toujours visible
  // en bas — jamais toute la conversation qui défile en bloc, ce qui pousserait le champ hors écran
  // sur mobile (bug initial : le contenu débordait carrément du panneau, non contenu du tout).
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div className="card table-scroll" style={{ padding: 0, flex: 1, minHeight: 0, overflowY: 'auto', marginBottom: 10 }}>
        {chargement ? (
          <p className="muted" style={{ padding: 20 }}>Chargement…</p>
        ) : messages.length === 0 ? (
          <div className="empty-state">
            Répond uniquement à partir des données déjà présentes dans ce dossier — ne modifie jamais
            rien. Pose une question, par exemple « Pourquoi le compte 6251 a-t-il augmenté cette
            année ? » ou « Quelles sont les anomalies de ce dossier ? ».
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
                    background: m.role === 'user' ? 'var(--color-primary)' : 'var(--color-bg)',
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

      {error && <p className="error-text" style={{ flexShrink: 0 }}>{error}</p>}

      <form onSubmit={envoyer} style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div className="field" style={{ margin: 0 }}>
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
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" type="submit" disabled={loading || !input.trim()} style={{ flex: 1 }}>
            {loading ? 'Envoi…' : 'Envoyer'}
          </button>
          {messages.length > 0 && (
            <button
              type="button"
              className="btn btn-outline"
              disabled={loading}
              onClick={nouvelleConversation}
            >
              Nouvelle conversation
            </button>
          )}
        </div>
      </form>
    </div>
  )
}
