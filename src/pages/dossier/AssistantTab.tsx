import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { formatDate } from '../../lib/format'
import { formatUsd } from '../../lib/coutsApi'
import { extraireErreurFonction } from '../../lib/invokeErreur'

interface MessageBrut {
  conversation_id: string
  role: 'user' | 'assistant'
  texte: string
  outils_utilises: string[] | null
  created_at: string
}

// Assistant conversationnel en lecture seule sur ce dossier (voir supabase/functions/agent-comptable) :
// répond à des questions ("Pourquoi le compte 6251 a augmenté ?", "Quelles sont les anomalies ?") en
// interrogeant les données déjà en base via des outils contrôlés, jamais en écrivant quoi que ce soit.
// Historique persisté dans agent_conversations, partagé entre tous les admins du cabinet pour ce
// dossier (comme le reste de l'appli — le cabinet est un seul acteur) : changer d'onglet ou recharger
// la page ne perd plus la conversation.
//
// Plusieurs conversations distinctes par dossier (voir conversation_id, migration
// agent_conversations_threads) — "Nouvelle conversation" ouvrait auparavant un fil vide en effaçant
// définitivement l'ancien, partagé avec tout le cabinet, sans confirmation (voir audit ergonomie).
// Elle se contente maintenant de générer un nouvel identifiant de fil localement : rien n'est
// supprimé, les anciennes conversations restent consultables depuis le menu "Conversations". Seule
// une suppression explicite (bouton "×" sur un fil précis, avec confirmation) efface pour de bon.
export default function AssistantTab({ dossierId }: { dossierId: string }) {
  const { session } = useAuth()
  const [tous, setTous] = useState<MessageBrut[]>([])
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [chargement, setChargement] = useState(true)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Plafond IA du cabinet (voir agent-comptable, verifierPlafondCabinet et migration
  // cabinets_plafond_ia) : non bloquant, contrairement au blocage (qui remonte comme une erreur
  // ordinaire via data.error, voir plus bas) — juste un signal affiché au comptable après chaque
  // réponse. Réinitialisé à null au changement de dossier : reflète l'usage du dossier consulté, pas
  // un cabinet précédent.
  const [alerteCout, setAlerteCout] = useState<{ coutMoisUsd: number; limiteAlerteUsd: number } | null>(null)
  const [historiqueOuvert, setHistoriqueOuvert] = useState(false)
  const zoneRef = useRef<HTMLTextAreaElement>(null)
  const historiqueRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function surClicExterieur(e: MouseEvent) {
      if (historiqueRef.current && !historiqueRef.current.contains(e.target as Node)) setHistoriqueOuvert(false)
    }
    document.addEventListener('mousedown', surClicExterieur)
    return () => document.removeEventListener('mousedown', surClicExterieur)
  }, [])

  async function charger() {
    setChargement(true)
    const { data } = await supabase
      .from('agent_conversations')
      .select('conversation_id, role, texte, outils_utilises, created_at')
      .eq('dossier_id', dossierId)
      .order('created_at', { ascending: true })
    const lignes = data ?? []
    setTous(lignes)
    // Seulement au tout premier chargement (conversationId encore null) : ouvre le fil le plus récent
    // s'il y en a un, sinon un fil neuf — un rechargement après l'envoi d'un message ne doit pas
    // changer le fil affiché.
    setConversationId((actuel) => actuel ?? (lignes.length > 0 ? lignes[lignes.length - 1].conversation_id : crypto.randomUUID()))
    setChargement(false)
  }

  useEffect(() => {
    setConversationId(null) // force charger() à retomber sur le fil le plus récent de ce dossier
    setAlerteCout(null)
    charger()
  }, [dossierId])

  // Un fil par conversation_id, le plus récent en premier — regroupé côté client à partir de la même
  // liste déjà chargée (pas de requête séparée) : le volume par dossier reste modeste, comme pour les
  // lignes bancaires ou les pièces ailleurs dans l'appli.
  const threads = useMemo(() => {
    const parConversation = new Map<string, MessageBrut[]>()
    for (const m of tous) {
      const arr = parConversation.get(m.conversation_id) ?? []
      arr.push(m)
      parConversation.set(m.conversation_id, arr)
    }
    return [...parConversation.entries()]
      .map(([id, msgs]) => ({
        id,
        debut: msgs[0].created_at,
        nbMessages: msgs.length,
        premierMessage: msgs.find((m) => m.role === 'user')?.texte ?? msgs[0].texte,
      }))
      .sort((a, b) => new Date(b.debut).getTime() - new Date(a.debut).getTime())
  }, [tous])

  const messages = tous.filter((m) => m.conversation_id === conversationId)

  // Best-effort : un échec d'enregistrement de l'historique ne doit jamais casser la conversation
  // elle-même, seulement priver cette ligne de persistance (rare, et sans conséquence grave).
  // `usage` (tokens Bedrock consommés pour produire cette réponse — voir agent-comptable) n'existe
  // que pour un message assistant, jamais un message user (aucun appel modèle) : sert à estimer le
  // coût réel de l'agent par dossier/cabinet (voir lib/coutsApi.ts, page Comptes master).
  async function enregistrer(role: 'user' | 'assistant', texte: string, outils?: string[], usage?: { tokens_entree: number; tokens_sortie: number }) {
    if (!conversationId) return
    await supabase.from('agent_conversations').insert({
      dossier_id: dossierId,
      conversation_id: conversationId,
      role,
      texte,
      outils_utilises: outils ?? null,
      tokens_entree: usage?.tokens_entree ?? null,
      tokens_sortie: usage?.tokens_sortie ?? null,
      created_by: session?.user.id ?? null,
    })
  }

  async function envoyer(e: FormEvent) {
    e.preventDefault()
    const texte = input.trim()
    if (!texte || loading || !conversationId) return

    setInput('')
    setError(null)
    const historique = messages.map((m) => ({ role: m.role, texte: m.texte }))
    setTous((prev) => [...prev, { conversation_id: conversationId, role: 'user', texte, outils_utilises: null, created_at: new Date().toISOString() }])
    setLoading(true)
    enregistrer('user', texte)

    try {
      const { data, error: invokeError } = await supabase.functions.invoke<{
        reponse?: string; outils_utilises?: string[]; usage?: { tokens_entree: number; tokens_sortie: number }
        alerte_cout?: boolean; cout_mois_usd?: number; limite_alerte_usd?: number; error?: string
      }>('agent-comptable', { body: { dossierId, message: texte, historique } })
      // Sur un statut non-2xx, data reste toujours vide (voir lib/invokeErreur.ts) — le message
      // précis se lit sur invokeError.context. C'est ici (et seulement ici) que remonte le blocage
      // par plafond IA (voir agent-comptable, verifierPlafondCabinet) : pas de champ dédié côté
      // réponse, juste ce même message d'erreur.
      if (data?.error) throw new Error(data.error)
      if (invokeError) throw new Error(await extraireErreurFonction(invokeError))
      const reponseTexte = data?.reponse
      if (!reponseTexte) throw new Error("Réponse vide.")

      setTous((prev) => [...prev, {
        conversation_id: conversationId, role: 'assistant', texte: reponseTexte,
        outils_utilises: data.outils_utilises ?? null, created_at: new Date().toISOString(),
      }])
      enregistrer('assistant', reponseTexte, data.outils_utilises, data.usage)
      setAlerteCout(data.alerte_cout ? { coutMoisUsd: data.cout_mois_usd ?? 0, limiteAlerteUsd: data.limite_alerte_usd ?? 0 } : null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Une erreur est survenue.')
    } finally {
      setLoading(false)
      zoneRef.current?.focus()
    }
  }

  // Ouvre un fil neuf sans rien supprimer — voir le commentaire en tête de fichier. Le premier message
  // envoyé dans ce fil est ce qui le fera apparaître dans la liste des conversations ; tant que rien
  // n'est envoyé, un fil vide n'est jamais persisté.
  function nouvelleConversation() {
    setConversationId(crypto.randomUUID())
    setError(null)
    setHistoriqueOuvert(false)
  }

  // Seule vraie suppression restante — explicitement nommée et confirmée (voir audit ergonomie),
  // contrairement à l'ancien comportement de "Nouvelle conversation".
  async function supprimerConversation(id: string) {
    if (!window.confirm(
      "Supprimer définitivement cette conversation ? Elle est partagée avec le reste du cabinet — personne ne pourra plus la relire.",
    )) return
    await supabase.from('agent_conversations').delete().eq('dossier_id', dossierId).eq('conversation_id', id)
    setTous((prev) => prev.filter((m) => m.conversation_id !== id))
    if (id === conversationId) setConversationId(crypto.randomUUID())
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
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8, flexShrink: 0 }}>
        <div style={{ position: 'relative' }} ref={historiqueRef}>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setHistoriqueOuvert((v) => !v)}>
            Conversations{threads.length > 0 ? ` (${threads.length})` : ''}
          </button>
          {historiqueOuvert && (
            <div className="options-menu" style={{ right: 0, left: 'auto', minWidth: 260 }}>
              <button type="button" className="nav-menu-item" onClick={nouvelleConversation}>
                + Nouvelle conversation
              </button>
              {threads.length > 0 && <div style={{ borderTop: '1px solid var(--color-border)', margin: '4px 0' }} />}
              {threads.map((t) => (
                <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <button
                    type="button"
                    className={`nav-menu-item ${t.id === conversationId ? 'active' : ''}`}
                    style={{ flex: 1, minWidth: 0 }}
                    onClick={() => { setConversationId(t.id); setHistoriqueOuvert(false) }}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
                      {formatDate(t.debut)} — {t.premierMessage.length > 32 ? `${t.premierMessage.slice(0, 32)}…` : t.premierMessage}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => supprimerConversation(t.id)}
                    title="Supprimer cette conversation"
                    style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-light)', padding: '6px 8px', fontWeight: 700 }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

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
                {m.outils_utilises && m.outils_utilises.length > 0 && (
                  <span className="muted" style={{ fontSize: '0.78rem', marginTop: 4 }}>
                    Outils utilisés : {m.outils_utilises.join(', ')}
                  </span>
                )}
              </div>
            ))}
            {loading && <span className="muted">L'assistant réfléchit…</span>}
          </div>
        )}
      </div>

      {error && <p className="error-text" style={{ flexShrink: 0 }}>{error}</p>}

      {alerteCout && (
        <p
          className="muted"
          style={{
            flexShrink: 0, margin: '0 0 8px', padding: '8px 12px', borderRadius: 8, fontSize: '0.82rem',
            background: 'var(--color-warning-light)', color: 'var(--color-warning)',
          }}
        >
          Seuil d'alerte du cabinet atteint : {formatUsd(alerteCout.coutMoisUsd)} d'usage de l'agent ce mois-ci
          (seuil {formatUsd(alerteCout.limiteAlerteUsd)}). L'agent reste utilisable — ajustable depuis Comptes master.
        </p>
      )}

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
        <button className="btn btn-primary" type="submit" disabled={loading || !input.trim()}>
          {loading ? 'Envoi…' : 'Envoyer'}
        </button>
      </form>
    </div>
  )
}
