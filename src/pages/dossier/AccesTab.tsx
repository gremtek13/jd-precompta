import { useEffect, useRef, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import EnvoyerEmailModal from '../../components/EnvoyerEmailModal'
import { extraireErreurFonction } from '../../lib/invokeErreur'
import { messageErreur } from '../../lib/messageErreur'

interface MembershipRow {
  id: string
  user_id: string
  email: string | null
}

// Domaine dédié à la réception (Resend) — distinct du domaine principal pour ne pas toucher à la
// messagerie personnelle existante. Voir Palier 4 : le client configure un simple transfert
// automatique de ses e-mails de prélèvement vers cette adresse, sans jamais donner accès à sa boîte.
const DOMAINE_COLLECTE_EMAIL = 'precompta.jdarnis.fr'

export default function AccesTab({ dossierId, dossierNom, codeEmail }: { dossierId: string; dossierNom: string; codeEmail: string | null }) {
  const [rows, setRows] = useState<MembershipRow[]>([])
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [inviting, setInviting] = useState(false)
  const [copie, setCopie] = useState(false)
  const [relanceDe, setRelanceDe] = useState<MembershipRow | null>(null)
  // « Aucun accès client pour ce dossier » est une AFFIRMATION, pas un écran vide : une lecture
  // refusée rendait la même liste vide, et le cabinet en concluait qu'il ne restait aucun accès.
  // C'est le pire sens pour ce geste-là — on coupe l'accès d'un client qui part, et on croit l'avoir
  // fait. Même famille que la suppression d'un dossier : une lecture dont l'échec ressemble à un
  // résultat vide se vérifie comme une écriture.
  const [erreurLecture, setErreurLecture] = useState<string | null>(null)

  // Verrou d'exécution en `useRef`, pas en état React : `setInviting(true)` ne prend effet qu'au
  // rendu suivant, donc `disabled={inviting}` laisse passer deux soumissions rapprochées — sur un
  // FORMULAIRE le déclencheur n'est même pas le double clic mais deux « Entrée » (CLAUDE.md, motif
  // déjà vu sur EnvoyerEmailModal, FactureAvoirModal et consorts). Posé AVANT le `try` : dedans, le
  // `return` du deuxième clic sortirait par le `finally`, qui relâcherait le verrou du PREMIER,
  // encore en cours.
  //
  // Le doublon ne crée pas qu'une ligne en trop : create-client-access appelle
  // `auth.admin.createUser` deux fois pour la même adresse, une course entre les deux appels que la
  // fonction ne peut pas fermer elle-même (elle ne voit rien de la seconde requête pendant que la
  // première est en vol) — au mieux un message d'erreur incompréhensible pour un accès qui vient
  // pourtant d'être créé, au pire deux appels admin facturés pour rien.
  const creationEnCours = useRef(false)

  async function load() {
    const { data, error: loadError } = await supabase.from('memberships').select('id, user_id, email').eq('dossier_id', dossierId)
    setErreurLecture(loadError ? messageErreur(loadError, "La liste des accès n'a pas pu être lue.") : null)
    setRows(data ?? [])
  }

  useEffect(() => { load() }, [dossierId])

  async function handleCreateAccess(e: FormEvent) {
    e.preventDefault()
    if (creationEnCours.current) return
    creationEnCours.current = true
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
      // Sur un statut non-2xx, supabase-js jette systématiquement un FunctionsHttpError générique
      // ("Edge Function returned a non-2xx status code") dans invokeError SANS jamais remplir data
      // (voir lib/invokeErreur.ts) — le message précis qu'on renvoie nous-mêmes (403/409/500...) se
      // lit sur invokeError.context, jamais sur data.error (toujours undefined dans ce cas).
      if (data?.error) throw new Error(data.error)
      if (invokeError) throw new Error(await extraireErreurFonction(invokeError))
      if (!data?.ok) throw new Error("La création de l'accès n'a rien retourné.")

      setEmail('')
      setPassword('')
      load()
    } catch (err) {
      setError(messageErreur(err))
    } finally {
      creationEnCours.current = false
      setInviting(false)
    }
  }

  async function revoke(membershipId: string) {
    // Le `load()` qui suit montre normalement l'échec (la ligne réapparaît) — sauf quand il échoue
    // pour la MÊME raison, et la liste se vide alors au lieu de garder sa ligne : l'écran dirait
    // « aucun accès » précisément quand l'accès est toujours là.
    const { error: deleteError } = await supabase.from('memberships').delete().eq('id', membershipId)
    if (deleteError) {
      setError(messageErreur(deleteError, "L'accès n'a pas pu être retiré."))
      return
    }
    setError(null)
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
              <input id="password" type="password" required minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} />
              <span className="muted">10 caractères minimum — c'est toi qui le choisis et le communiques au client, pas lui.</span>
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
        {erreurLecture ? (
          <div className="empty-state error-text">
            {erreurLecture} On ne peut donc pas dire qui a accès à ce dossier — surtout ne pas en
            conclure que personne ne l'a. Recharge la page.
          </div>
        ) : rows.length === 0 ? (
          <div className="empty-state">Aucun accès client pour ce dossier.</div>
        ) : (
          <table>
            <thead><tr><th>Utilisateur</th><th></th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.email ?? r.user_id}</td>
                  <td className="td-actions">
                    {r.email && (
                      <button className="btn btn-outline btn-sm" onClick={() => setRelanceDe(r)}>Relancer</button>
                    )}
                    <button className="btn btn-danger btn-sm" onClick={() => revoke(r.id)}>Retirer</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {relanceDe?.email && (
        <EnvoyerEmailModal
          dossierId={dossierId}
          type="relance_pieces"
          destinataireInitial={relanceDe.email}
          titre="Relancer pour obtenir des pièces"
          description={`Un e-mail invitant à se connecter pour déposer ses pièces sur "${dossierNom}".`}
          onClose={() => setRelanceDe(null)}
        />
      )}
    </>
  )
}
