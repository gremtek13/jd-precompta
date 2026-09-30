import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { extraireErreurFonction } from '../lib/invokeErreur'

// LE RETOUR DE LA BANQUE (connexion bancaire, ligne 24). La banque renvoie le navigateur vers
// `retour-banque.html` (public/), qui recopie ses paramètres ici : le code d'autorisation et le jeton
// de la demande, ou une erreur. Le code se remet à la fonction `banque-connexion`, qui ouvre l'accès et
// retrouve le DOSSIER au jeton — cette page ne le connaît pas, et ne l'apprend que de la réponse.
//
// Le code ne sert qu'UNE fois, et ne vit que quelques minutes : l'appel part une seule fois, même quand
// React monte deux fois l'écran (mode strict). La promesse est gardée dans un ref, et chaque montage en
// attend la réponse — un simple drapeau « déjà lancé » laisserait le second montage sans réponse, le
// premier ayant été démonté entre-temps.

interface Finalisation {
  dossierId: string
  renouvellement: boolean
  compte_repris: boolean
  avertissement: string | null
}

type Issue =
  | { etat: 'en_cours' }
  | { etat: 'refus'; message: string }
  | { etat: 'a_dire'; dossierId: string; phrases: string[] }

// Le code d'erreur rendu par la banque ne s'affiche que s'il a la forme d'un code : le texte d'une adresse
// se fabrique, et cette page ne doit pas afficher une phrase que n'importe qui peut écrire dans un lien.
const CODE_ERREUR = /^[a-z_]{1,40}$/i

async function finaliser(code: string, etat: string): Promise<{ donnees: Finalisation; erreur: null } | { donnees: null; erreur: string }> {
  const { data, error } = await supabase.functions.invoke<Finalisation>('banque-connexion', {
    body: { action: 'finaliser', code, state: etat },
  })
  if (error || !data) return { donnees: null, erreur: await extraireErreurFonction(error, "La connexion à la banque n'a pas pu être enregistrée.") }
  return { donnees: data, erreur: null }
}

export default function RetourBanque() {
  const [parametres] = useSearchParams()
  const navigate = useNavigate()
  const code = parametres.get('code') ?? ''
  const etat = parametres.get('state') ?? ''
  const erreurBanque = parametres.get('error')
  const appel = useRef<ReturnType<typeof finaliser> | null>(null)
  const [issue, setIssue] = useState<Issue>({ etat: 'en_cours' })

  // Une adresse sans code, ou qui porte l'erreur de la banque, ne part pas chez la fonction : il n'y a
  // rien à finaliser. Calculé, pas mis en état — rien à attendre.
  const refusImmediat = erreurBanque !== null
    ? "La banque n'a pas donné accès aux comptes : la connexion n'a pas abouti" +
      (CODE_ERREUR.test(erreurBanque) ? ` (${erreurBanque})` : '') + '. Elle peut être reprise depuis l’onglet Banque du dossier.'
    : code === '' || etat === ''
      ? "Cette adresse ne porte pas de réponse de banque : rien à enregistrer."
      : null

  useEffect(() => {
    if (refusImmediat !== null) return
    let annule = false
    if (!appel.current) appel.current = finaliser(code, etat)
    appel.current.then((r) => {
      if (annule) return
      if (r.erreur !== null) { setIssue({ etat: 'refus', message: r.erreur }); return }
      const phrases: string[] = []
      if (r.donnees.renouvellement && !r.donnees.compte_repris) {
        phrases.push("L'accord renouvelé n'ouvre plus le compte que tu importais : choisis de nouveau le compte à importer.")
      }
      if (r.donnees.avertissement) phrases.push(r.donnees.avertissement)
      // Rien à dire : on rejoint l'onglet Banque, en REMPLAÇANT cette page dans l'historique — le code
      // d'autorisation ne doit pas rester à portée du bouton « précédent ».
      if (phrases.length === 0) navigate(`/dossiers/${r.donnees.dossierId}/banque`, { replace: true })
      else setIssue({ etat: 'a_dire', dossierId: r.donnees.dossierId, phrases })
    })
    return () => { annule = true }
  }, [code, etat, refusImmediat, navigate])

  return (
    <div className="card" style={{ maxWidth: 640 }}>
      <h2 style={{ marginTop: 0 }}>Connexion bancaire</h2>
      {refusImmediat !== null && (
        <>
          <p className="error-text">{refusImmediat}</p>
          <Link to="/dossiers" replace>Retour aux dossiers</Link>
        </>
      )}
      {refusImmediat === null && issue.etat === 'en_cours' && <p className="muted">Enregistrement de l’accord de la banque…</p>}
      {refusImmediat === null && issue.etat === 'refus' && (
        <>
          <p className="error-text">{issue.message}</p>
          <Link to="/dossiers" replace>Retour aux dossiers</Link>
        </>
      )}
      {refusImmediat === null && issue.etat === 'a_dire' && (
        <>
          <p>La banque est connectée.</p>
          {issue.phrases.map((p) => <p key={p} className="muted">{p}</p>)}
          <Link to={`/dossiers/${issue.dossierId}/banque`} replace className="btn btn-primary btn-sm">
            Continuer vers l’onglet Banque
          </Link>
        </>
      )}
    </div>
  )
}
