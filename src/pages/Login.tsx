import { useRef, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { ADRESSE_DE_RETOUR, MESSAGE_LIEN_DEMANDE, messageErreurDuLien } from '../lib/recuperationMotDePasse'

// `avis` : ce que le lien de l'adresse n'a pas pu faire (expiré, déjà servi…), voir AuthContext. Il ouvre d'emblée la
// demande d'un nouveau lien, qui est le remède.
export default function Login({ avis = null }: { avis?: string | null }) {
  const [mode, setMode] = useState<'connexion' | 'oubli'>(avis ? 'oubli' : 'connexion')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [envoi, setEnvoi] = useState(false)
  const [erreurLien, setErreurLien] = useState<string | null>(null)
  const [lienDemande, setLienDemande] = useState(false)
  // Le verrou de la demande de lien : chaque demande part en e-mail et compte dans le débit du service.
  const verrouLien = useRef(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)
    if (error) setError("Email ou mot de passe incorrect.")
  }

  async function demanderLien(e: FormEvent) {
    e.preventDefault()
    if (verrouLien.current) return
    const adresse = email.trim()
    if (adresse === '') {
      setErreurLien("Indique l'adresse e-mail du compte.")
      return
    }
    verrouLien.current = true
    setEnvoi(true)
    setErreurLien(null)
    setLienDemande(false)
    try {
      // Le retour est passé EXPLICITEMENT : sans lui, le service retombe sur la « Site URL » du tableau de bord.
      const { error: erreur } = await supabase.auth.resetPasswordForEmail(adresse, { redirectTo: ADRESSE_DE_RETOUR })
      if (erreur) setErreurLien(messageErreurDuLien(erreur))
      // Le même message qu'un compte existe ou non (voir MESSAGE_LIEN_DEMANDE).
      else setLienDemande(true)
    } catch (x) {
      setErreurLien(messageErreurDuLien(x))
    } finally {
      verrouLien.current = false
      setEnvoi(false)
    }
  }

  function changerDeMode(suivant: 'connexion' | 'oubli') {
    setMode(suivant)
    setError(null)
    setErreurLien(null)
    setLienDemande(false)
  }

  return (
    <div className="login-shell">
      <div className="card login-card">
        <div className="brand-mark brand-mark-lg" style={{ margin: '0 auto' }}>JD</div>
        <h1>JD Precompta</h1>
        {mode === 'connexion' ? (
          <>
            <p className="muted" style={{ marginBottom: 20 }}>Connexion à ton espace</p>
            <form onSubmit={handleSubmit}>
              <div className="field">
                <label htmlFor="email">Email</label>
                <input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="password">Mot de passe</label>
                <input id="password" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              {error && <p className="error-text">{error}</p>}
              <button className="btn btn-primary" type="submit" disabled={loading} style={{ width: '100%', marginTop: 6 }}>
                {loading ? 'Connexion…' : 'Se connecter'}
              </button>
            </form>
            <button className="btn btn-outline btn-sm" type="button" onClick={() => changerDeMode('oubli')} style={{ marginTop: 14 }}>
              Mot de passe oublié ?
            </button>
          </>
        ) : (
          <>
            <p className="muted" style={{ marginBottom: 20 }}>Mot de passe oublié</p>
            {avis && !lienDemande && (
              <p className="error-text" role="alert" style={{ marginBottom: 12 }}>{avis} Demande un nouveau lien ci-dessous.</p>
            )}
            <form onSubmit={demanderLien}>
              <div className="field">
                <label htmlFor="email">Email</label>
                <input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <p className="muted">Tu recevras à cette adresse un lien pour choisir un nouveau mot de passe.</p>
              {erreurLien && <p className="error-text" role="alert">{erreurLien}</p>}
              {lienDemande && <p role="status">{MESSAGE_LIEN_DEMANDE}</p>}
              <button className="btn btn-primary" type="submit" disabled={envoi} style={{ width: '100%', marginTop: 6 }}>
                {envoi ? 'Envoi…' : 'Recevoir un lien'}
              </button>
            </form>
            <button className="btn btn-outline btn-sm" type="button" disabled={envoi} onClick={() => changerDeMode('connexion')} style={{ marginTop: 14 }}>
              Retour à la connexion
            </button>
          </>
        )}
      </div>
    </div>
  )
}
