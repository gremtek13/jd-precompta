import BandeauLecturePartielle from '../components/BandeauLecturePartielle'
import type { LectureComplete } from '../lib/lectureComplete'
import {
  ceQueTuPeuxFaire, dOuEllesViennent, ECARTEES_EN_LECTURE, phraseDeLaRaison, quandPourLeClient, SI_LA_LECTURE_MANQUE,
  titreDuSignalement,
} from '../lib/piecesJointesEcarteesClient'
import type { PieceJointeEcarteeDuClient } from '../lib/types'

// LES PIÈCES JOINTES ÉCARTÉES, EN TÊTE DE « MES PIÈCES » (ligne 22.9). L'écran du client les LIT (ClientUpload, par
// `pieces_jointes_ecartees_du_client`) et passe la lecture ici, qui ne fait que la dire — sans nom de fichier : la base
// n'en garde pas. Le jour, la raison et le poids ; ce qu'il peut faire ; rien à cocher ni à marquer : son geste est de
// renvoyer la pièce jointe, plus bas, ou par e-mail.
//
// Tant que la lecture n'est pas revenue, l'attente seule se dit (une alerte qui n'a pas lu ne peut rien affirmer, ni le
// vide) ; lue EN ENTIER et vide, rien ; lue en partie, refusée ou illisible, le bandeau, dans ses mots, sans compte.
// Les mêmes classes que la carte de l'onglet Justificatifs (index.css) : la même alerte, de l'autre côté.

export default function PiecesJointesEcarteesClient({ lecture }: { lecture: LectureComplete<PieceJointeEcarteeDuClient> | null }) {
  if (lecture === null) {
    return <p className="muted pieces-jointes-ecartees-attente" aria-busy="true">{ECARTEES_EN_LECTURE}</p>
  }
  if (!lecture.complete) {
    return (
      <BandeauLecturePartielle
        quoi="Les pièces jointes reçues par e-mail" accord="lues" motif={lecture.motif ?? 'lecture incomplète'}
        technique={false} consequence={SI_LA_LECTURE_MANQUE}
      />
    )
  }
  if (lecture.lignes.length === 0) return null
  return (
    <section className="card pieces-jointes-ecartees" aria-label="Pièces jointes reçues par e-mail et non déposées">
      <h3>{titreDuSignalement(lecture.lignes.length)}</h3>
      <p className="muted">{dOuEllesViennent(lecture.lignes.length)}</p>
      <ul className="pieces-jointes-ecartees-liste">
        {/* Rien ne distingue deux pièces jointes d'un même jour, d'une même raison et d'un même poids : la clé prend aussi
            leur rang, la liste étant relue d'un bloc et jamais réordonnée sur place. */}
        {lecture.lignes.map((e, i) => (
          <li key={`${i}-${e.jour}-${e.raison}-${e.octets ?? 'inconnu'}`}>
            <span className="pieces-jointes-ecartees-quand">{quandPourLeClient(e.jour)}</span> — {phraseDeLaRaison(e)}
          </li>
        ))}
      </ul>
      {ceQueTuPeuxFaire(lecture.lignes).map((phrase) => <p key={phrase}>{phrase}</p>)}
    </section>
  )
}
