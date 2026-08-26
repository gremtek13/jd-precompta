import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'

interface MembershipRow {
  id: string
  user_id: string
  email: string | null
}

export default function AccesTab({ dossierId }: { dossierId: string }) {
  const [rows, setRows] = useState<MembershipRow[]>([])
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [inviting, setInviting] = useState(false)

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
      // Compte client créé via signUp classique (clé publique) : email de confirmation envoyé automatiquement.
      // Si la confirmation email est désactivée sur le projet, signUp connecte directement le nouveau
      // compte et remplacerait notre session admin — on la sauvegarde pour la restaurer après coup.
      const { data: adminSessionData } = await supabase.auth.getSession()
      const adminSession = adminSessionData.session

      const { data, error: signUpError } = await supabase.auth.signUp({ email, password })
      if (signUpError) throw signUpError
      if (!data.user) throw new Error("La création du compte n'a rien retourné.")

      if (data.session && adminSession) {
        await supabase.auth.setSession({
          access_token: adminSession.access_token,
          refresh_token: adminSession.refresh_token,
        })
      }

      const { error: membershipError } = await supabase
        .from('memberships')
        .insert({ user_id: data.user.id, dossier_id: dossierId, role: 'client', email })
      if (membershipError) throw membershipError

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

  return (
    <>
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
      <div className="card" style={{ padding: 0 }}>
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
