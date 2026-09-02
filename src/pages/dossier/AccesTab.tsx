import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'

interface MembershipRow {
  id: string
  user_id: string
  email: string | null
}

// Domaine dédié à la réception (Resend) — distinct du domaine principal pour ne pas toucher à la
// messagerie personnelle existante. Voir Palier 4 : le client configure un simple transfert
// automatique de ses e-mails de prélèvement vers cette adresse, sans jamais donner accès à sa boîte.
const DOMAINE_COLLECTE_EMAIL = 'precompta.jdarnis.fr'

export default function AccesTab({ dossierId, codeEmail }: { dossierId: string; codeEmail: string | null }) {
  const [rows, setRows] = useState<MembershipRow[]>([])
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [inviting, setInviting] = useState(false)
  const [copie, setCopie] = useState(false)

  async function load() {
    const { data } = await supabase.from('memberships').select('id, user_id, email').eq('dossier_id', dossierId)
    setRows(data ?? [])
  }

  useEffect(() => { load() }, [dossierId])

  async function handleCreateAccess(e: FormEvent) {
    e.preventDefault()
    setInviting(true)
    setError(null)
    try {
      // Passe par une fonction Edge (clé de service) plutôt qu'un signUp() classique côté navigateur :
      // retirer un accès (bouton "Retirer" ci-dessous) ne supprime que la ligne memberships, jamais le
      // compte Auth sous-jacent — un signUp() sur la même adresse pour un autre dossier échouerait donc
      // en "déjà inscrit". La fonction réutilise le compte existant le cas échéant.
      const { data, error: invokeError } = await supabase.functions.invoke<{ ok?: true; error?: string }>(
        'create-client-access',
        { body: { dossierId, email, password } },
      )
      if (invokeError) throw invokeError
      if (data?.error) throw new Error(data.error)

      setEmail('')
      setPassword('')
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Une erreur est survenue.')
    } finally {
      setInviting(false)
    }
  }

  async function revoke(membershipId: string) {
    await supabase.from('memberships').delete().eq('id', membershipId)
    load()
  }

  const adresseCollecte = codeEmail ? `${codeEmail}@${DOMAINE_COLLECTE_EMAIL}` : null

  async function copierAdresse() {
    if (!adresseCollecte) return
    await navigator.clipboard.writeText(adresseCollecte)
    setCopie(true)
    setTimeout(() => setCopie(false), 2000)
  }

  return (
    <>
      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginTop: 0 }}>Collecte automatique par e-mail</h3>
        <p className="muted" style={{ marginTop: -8 }}>
          Le client transfère ses e-mails de prélèvement récurrent (assurance, cotisations…) vers cette adresse —
          un simple réglage de transfert automatique dans sa boîte, sans jamais donner accès à sa messagerie.
          Les pièces jointes reçues arrivent directement en pièces à valider.
        </p>
        {adresseCollecte ? (
          <div className="field-row" style={{ alignItems: 'center' }}>
            <code style={{ background: 'var(--surface-2, #f4f4f4)', padding: '6px 10px', borderRadius: 6 }}>
              {adresseCollecte}
            </code>
            <button type="button" className="btn btn-outline btn-sm" onClick={copierAdresse}>
              {copie ? 'Copié ✓' : 'Copier'}
            </button>
          </div>
        ) : (
          <p className="muted">Adresse en cours de génération — recharge la page si elle n'apparaît pas.</p>
        )}
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginTop: 0 }}>Donner un accès client</h3>
        <p className="muted" style={{ marginTop: -8 }}>
          Le client pourra uniquement déposer des pièces sur ce dossier — aucun accès aux montants, catégories ou packs.
        </p>
        <form onSubmit={handleCreateAccess}>
          <div className="field-row">
            <div className="field">
              <label htmlFor="email">Email du client</label>
              <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="password">Mot de passe initial</label>
              <input id="password" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
          </div>
          {error && <p className="error-text">{error}</p>}
          <button className="btn btn-primary" type="submit" disabled={inviting}>
            {inviting ? 'Création…' : 'Créer l\'accès'}
          </button>
        </form>
      </div>

      <h3>Accès actuels</h3>
      <div className="card table-scroll" style={{ padding: 0 }}>
        {rows.length === 0 ? (
          <div className="empty-state">Aucun accès client pour ce dossier.</div>
        ) : (
          <table>
            <thead><tr><th>Utilisateur</th><th></th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.email ?? r.user_id}</td>
                  <td><button className="btn btn-danger btn-sm" onClick={() => revoke(r.id)}>Retirer</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}
