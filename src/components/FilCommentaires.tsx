import { useRef, useState } from 'react'
import { ajouterCommentaire, supprimerCommentaire } from '../lib/commentaires'
import type { CibleCommentaire } from '../lib/commentaires'
import { dateRelative } from '../lib/format'
import type { PieceCommentaire } from '../lib/types'

// Le fil des précisions portées sur une pièce ou un document. Deux écrans le partagent, et c'est
// voulu : le client écrit ce qu'il sait, le cabinet lit — et répond quand il a eu le client au
// téléphone. Un composant par côté aurait fini par montrer deux choses différentes.
//
// Il ne charge rien lui-même. L'écran qui l'affiche a déjà lu les commentaires du dossier en une
// requête ; les faire charger ici en produirait une par pièce sur une liste de quatre-vingts lignes.
//
// Rien n'est modifiable après coup : aucune policy UPDATE n'existe en base. Une correction est un
// commentaire de plus, pas une réécriture — c'est ce qui donne sa valeur au fil devant un contrôle.
// Le cabinet peut en RETIRER un (policy `piece_commentaires_delete`, `admin_du_dossier`), pour
// écarter un hors-sujet ; c'est tout autre chose que de le corriger, et le message de confirmation
// le dit plutôt que de laisser croire à une modification possible.

const PLACEHOLDER_CLIENT = 'Ex. : four de la salle d’attente — pas un achat personnel'
const PLACEHOLDER_CABINET = 'Ex. : appelé le client le 12/03, il confirme que c’est du matériel'

// Assez pour une précision utile, trop court pour un roman que personne ne lira.
export const LONGUEUR_MAX_COMMENTAIRE = 500

type ProprietesCommunes = {
  dossierId: string
  cible: CibleCommentaire
  commentaires: PieceCommentaire[]
  onAjout: (commentaire: PieceCommentaire) => void
  autoFocus?: boolean
}

// `onSuppression` est EXIGÉ du côté cabinet, et impossible côté client. Le compilateur porte ici une
// garantie qu'aucune relecture ne remplace : l'écran parent détient la liste des commentaires et
// affiche la dernière précision sur la ligne d'arbitrage. Un bouton « Retirer » dont le parent
// n'apprendrait rien laisserait ce résumé désigner un commentaire qui n'existe plus — l'écriture
// dont rien ne recharge l'état, motif déjà coûteux ailleurs dans ce projet.
type ProprietesFil =
  | (ProprietesCommunes & { estCabinet: true; onSuppression: (id: string) => void })
  | (ProprietesCommunes & { estCabinet?: false; onSuppression?: never })

export default function FilCommentaires(props: ProprietesFil) {
  const { dossierId, cible, commentaires, estCabinet, onAjout, autoFocus } = props
  const [texte, setTexte] = useState('')
  const [erreur, setErreur] = useState<string | null>(null)
  // Verrou posé avant tout `await` : un double clic écrirait deux fois le même commentaire, et rien
  // ne permettrait ensuite d'en effacer un (pas d'UPDATE, suppression réservée au cabinet).
  const envoiEnCours = useRef(false)
  // Celui-ci n'est PAS un verrou, et ne doit pas être « corrigé » en `useRef` : une suppression est
  // idempotente, deux clics retirent la même ligne. C'est l'état visuel qui dit que l'appel est
  // parti, sans quoi un réseau lent ressemble à un bouton mort.
  const [suppressionEnCours, setSuppressionEnCours] = useState<string | null>(null)

  async function envoyer() {
    if (envoiEnCours.current) return
    envoiEnCours.current = true
    try {
      const resultat = await ajouterCommentaire({ dossierId, cible, texte, estCabinet: estCabinet === true })
      if (!resultat.ok) { setErreur(resultat.message); return }
      setErreur(null)
      setTexte('')
      onAjout(resultat.commentaire)
    } finally {
      envoiEnCours.current = false
    }
  }

  async function retirer(commentaire: PieceCommentaire) {
    if (!props.estCabinet) return
    if (!window.confirm(
      'Retirer définitivement ce commentaire ? Personne ne pourra plus le lire, et rien ne le '
      + 'remplacera. Pour corriger une précision inexacte, en ajouter une nouvelle vaut mieux : le '
      + 'fil garde alors les deux, avec leur date.',
    )) return
    setErreur(null)
    setSuppressionEnCours(commentaire.id)
    const message = await supprimerCommentaire(commentaire.id)
    setSuppressionEnCours(null)
    // L'échec d'une suppression que l'utilisateur vient de confirmer se DIT. Muet, il laisse la
    // ligne en place sans un mot, et le réflexe — recliquer — rend le même silence.
    if (message) { setErreur(`Le commentaire n'a pas été retiré : ${message}`); return }
    props.onSuppression(commentaire.id)
  }

  return (
    <div className="fil-commentaires">
      {commentaires.length > 0 && (
        <ul className="fil-commentaires-liste">
          {commentaires.map((c) => (
            <li key={c.id} className={`fil-commentaire fil-commentaire-${c.origine}`}>
              <div className="fil-commentaire-entete">
                <span className={`badge ${c.origine === 'cabinet' ? 'badge-neutral' : 'badge-ok'}`}>
                  {c.origine === 'cabinet' ? 'Cabinet' : 'Client'}
                </span>
                <span className="muted">{dateRelative(c.created_at)}</span>
                {estCabinet && (
                  <button
                    type="button"
                    className="fil-commentaire-retirer"
                    disabled={suppressionEnCours !== null}
                    onClick={() => retirer(c)}
                  >
                    {suppressionEnCours === c.id ? 'Retrait…' : 'Retirer'}
                  </button>
                )}
              </div>
              <p className="fil-commentaire-texte">{c.texte}</p>
            </li>
          ))}
        </ul>
      )}

      <textarea
        value={texte}
        onChange={(e) => setTexte(e.target.value)}
        placeholder={estCabinet ? PLACEHOLDER_CABINET : PLACEHOLDER_CLIENT}
        maxLength={LONGUEUR_MAX_COMMENTAIRE}
        rows={2}
        autoFocus={autoFocus}
        className="fil-commentaires-saisie"
      />
      <div className="fil-commentaires-actions">
        <span className="muted" style={{ fontSize: '0.8rem' }}>
          {estCabinet
            ? 'Visible par le client. Une note ajoutée ne remplace pas la précédente.'
            : 'Facultatif — ça évite un appel du cabinet.'}
        </span>
        <button
          type="button"
          className="btn btn-outline btn-sm"
          disabled={texte.trim().length === 0}
          onClick={envoyer}
        >
          Ajouter
        </button>
      </div>
      {erreur && <p className="error-text" style={{ margin: '6px 0 0' }}>{erreur}</p>}
    </div>
  )
}
