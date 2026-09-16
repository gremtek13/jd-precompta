import { useRef, useState } from 'react'
import { ajouterCommentaire } from '../lib/commentaires'
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

const PLACEHOLDER_CLIENT = 'Ex. : four de la salle d’attente — pas un achat personnel'
const PLACEHOLDER_CABINET = 'Ex. : appelé le client le 12/03, il confirme que c’est du matériel'

// Assez pour une précision utile, trop court pour un roman que personne ne lira.
export const LONGUEUR_MAX_COMMENTAIRE = 500

export default function FilCommentaires({ dossierId, cible, commentaires, estCabinet, onAjout, autoFocus }: {
  dossierId: string
  cible: CibleCommentaire
  commentaires: PieceCommentaire[]
  estCabinet: boolean
  onAjout: (commentaire: PieceCommentaire) => void
  autoFocus?: boolean
}) {
  const [texte, setTexte] = useState('')
  const [erreur, setErreur] = useState<string | null>(null)
  // Verrou posé avant tout `await` : un double clic écrirait deux fois le même commentaire, et rien
  // ne permettrait ensuite d'en effacer un (pas d'UPDATE, suppression réservée au cabinet).
  const envoiEnCours = useRef(false)

  async function envoyer() {
    if (envoiEnCours.current) return
    envoiEnCours.current = true
    try {
      const resultat = await ajouterCommentaire({ dossierId, cible, texte, estCabinet })
      if (!resultat.ok) { setErreur(resultat.message); return }
      setErreur(null)
      setTexte('')
      onAjout(resultat.commentaire)
    } finally {
      envoiEnCours.current = false
    }
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
