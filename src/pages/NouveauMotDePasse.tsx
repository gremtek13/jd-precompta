import { useRef, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import {
  LONGUEUR_MINIMALE_MOT_DE_PASSE, REGLE_DU_MOT_DE_PASSE, messageErreurDuMotDePasse, refusDuNouveauMotDePasse,
} from '../lib/recuperationMotDePasse'

// L'ÉCRAN DU NOUVEAU MOT DE PASSE : la session ouverte par un lien « Mot de passe oublié » y arrive avant tout autre
// écran (App.tsx), et l'application ne s'ouvre qu'une fois le mot de passe changé. Le compte s'affiche — le lien a
// prouvé que la personne en lit les e-mails — et sert d'identifiant aux gestionnaires de mots de passe.
interface Props {
  email: string | null
  onTermine: () => void
  onDeconnexion: () => void
}

export default function NouveauMotDePasse({ email, onTermine, onDeconnexion }: Props) {
  const [motDePasse, setMotDePasse] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [erreur, setErreur] = useState<string | null>(null)
  const [enCours, setEnCours] = useState(false)
  // Le verrou d'exécution : deux envois partis du même geste ne font qu'un appel.
  const verrou = useRef(false)

  async function enregistrer(e: FormEvent) {
    e.preventDefault()
    if (verrou.current) return
    // Jugé avant tout appel : `minLength` se contourne, et la règle des mots de passe du projet (un reflet de celle du
    // tableau de bord) se dit ici avant que le service ne la fasse respecter.
    const refus = refusDuNouveauMotDePasse(motDePasse, confirmation)
    if (refus !== null) {
      setErreur(refus)
      return
    }
    verrou.current = true
    setEnCours(true)
    setErreur(null)
    try {
      const { error } = await supabase.auth.updateUser({ password: motDePasse })
      if (error) {
        setErreur(messageErreurDuMotDePasse(error))
        return
      }
      onTermine()
    } catch (x) {
      setErreur(messageErreurDuMotDePasse(x))
    } finally {
      verrou.current = false
      setEnCours(false)
    }
  }

  return (
    <div className="login-shell">
      <div className="card login-card">
        <div className="brand-mark brand-mark-lg" style={{ margin: '0 auto' }}>JD</div>
        <h1>Choisir un nouveau mot de passe</h1>
        <p className="muted" style={{ marginBottom: 20 }}>
          Le lien de l'e-mail a ouvert ta session. Choisis le mot de passe qui servira désormais à te connecter.
        </p>
        <form onSubmit={enregistrer}>
          <div className="field">
            <label htmlFor="mdp-compte">Compte</label>
            <input id="mdp-compte" type="email" autoComplete="username" value={email ?? ''} readOnly />
          </div>
          <div className="field">
            <label htmlFor="mdp-nouveau">Nouveau mot de passe</label>
            <input
              id="mdp-nouveau" type="password" required autoComplete="new-password" minLength={LONGUEUR_MINIMALE_MOT_DE_PASSE}
              aria-describedby="mdp-regle" value={motDePasse} onChange={(e) => setMotDePasse(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="mdp-confirmation">Confirmer le mot de passe</label>
            <input
              id="mdp-confirmation" type="password" required autoComplete="new-password" minLength={LONGUEUR_MINIMALE_MOT_DE_PASSE}
              value={confirmation} onChange={(e) => setConfirmation(e.target.value)}
            />
          </div>
          <p className="muted" id="mdp-regle">{REGLE_DU_MOT_DE_PASSE}</p>
          {erreur && <p className="error-text" role="alert">{erreur}</p>}
          <button className="btn btn-primary" type="submit" disabled={enCours} style={{ width: '100%', marginTop: 6 }}>
            {enCours ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </form>
        <button className="btn btn-outline btn-sm" type="button" disabled={enCours} onClick={onDeconnexion} style={{ marginTop: 14 }}>
          Se déconnecter
        </button>
      </div>
    </div>
  )
}
