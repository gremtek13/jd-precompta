import { useRef, useState, type FormEvent } from 'react'
import { MOTS, refusDuCode, type Facteur, type Registre } from '../lib/doubleAuthentification'
import { verifierLeCode } from '../lib/doubleAuthentificationAppels'

// LE CODE À LA CONNEXION (ligne 51.5, étape C7) : une session dont le compte a un second facteur vérifié et qui n'a pas
// encore donné son code n'ouvre AUCUN écran de l'application (App.tsx) — ni celui du nouveau mot de passe d'un lien
// « Mot de passe oublié ». Réussi, le code élève la session ; auth-js l'annonce, et la porte la relit dans le même rendu :
// cet écran s'efface de lui-même. Rien n'est encore exigé en base (premier temps).
interface Props {
  registre: Registre
  email: string | null
  // Les facteurs que porte la session (la copie de l'utilisateur qu'elle garde) : ceux dont un code peut l'ouvrir.
  facteurs: readonly Facteur[]
  motif: 'connexion' | 'recuperation'
  onDeconnexion: () => void
}

export default function CodeDeConnexion({ registre, email, facteurs, motif, onDeconnexion }: Props) {
  const mots = MOTS[registre]
  const appareils = facteurs.filter((f) => f.verifie && f.type === 'totp')
  const [choisi, setChoisi] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [erreur, setErreur] = useState<string | null>(null)
  const [enCours, setEnCours] = useState(false)
  // Le verrou d'exécution : deux envois partis du même geste ne font qu'une vérification.
  const verrouCode = useRef(false)
  const appareil = appareils.find((a) => a.id === choisi) ?? appareils[0] ?? null
  const refus = refusDuCode(code)

  async function verifier(e: FormEvent) {
    e.preventDefault()
    if (verrouCode.current) return
    if (appareil === null || refus !== null) return
    verrouCode.current = true
    setEnCours(true)
    setErreur(null)
    try {
      const issue = await verifierLeCode(appareil.id, code, registre)
      if (!issue.ok) {
        setErreur(issue.message)
        setCode('')
      }
    } finally {
      verrouCode.current = false
      setEnCours(false)
    }
  }

  return (
    <div className="login-shell">
      <div className="card login-card">
        <div className="brand-mark brand-mark-lg" style={{ margin: '0 auto' }}>JD</div>
        <h1>Code de vérification</h1>
        <p className="muted" style={{ marginBottom: 16 }}>
          {motif === 'recuperation' ? mots.invitationCodeRecuperation : mots.invitationCode}
        </p>
        {email && <p className="muted" style={{ marginBottom: 16 }}>Compte : <span className="courriel">{email}</span></p>}
        {appareil === null ? (
          <p className="error-text" role="alert">{mots.aucunAppareilPourLeCode}</p>
        ) : (
          <form onSubmit={verifier}>
            {appareils.length > 1 && (
              <div className="field">
                <label htmlFor="code-appareil">Appareil</label>
                <select id="code-appareil" value={appareil.id} onChange={(e) => setChoisi(e.target.value)}>
                  {appareils.map((a) => <option key={a.id} value={a.id}>{a.nom || 'Appareil sans nom'}</option>)}
                </select>
              </div>
            )}
            <div className="field">
              <label htmlFor="code-totp">Code à six chiffres</label>
              <input
                id="code-totp" inputMode="numeric" autoComplete="one-time-code" autoFocus
                aria-describedby={code !== '' && refus ? 'code-refus' : undefined}
                value={code} onChange={(e) => setCode(e.target.value)}
              />
            </div>
            {code !== '' && refus && <p className="muted" id="code-refus">{refus}</p>}
            {erreur && <p className="error-text" role="alert">{erreur}</p>}
            <button className="btn btn-primary" type="submit" disabled={enCours || refus !== null} style={{ width: '100%', marginTop: 6 }}>
              {enCours ? 'Vérification…' : 'Vérifier'}
            </button>
          </form>
        )}
        <p className="muted" style={{ marginTop: 16 }}>{mots.codePerdu}</p>
        <button className="btn btn-outline btn-sm" type="button" disabled={enCours} onClick={onDeconnexion} style={{ marginTop: 6 }}>
          Se déconnecter
        </button>
      </div>
    </div>
  )
}
