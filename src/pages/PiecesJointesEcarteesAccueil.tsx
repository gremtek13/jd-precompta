import { Link } from 'react-router-dom'
import type { LectureComplete } from '../lib/lectureComplete'
import { ACCUEIL_VERIFICATION_IMPOSSIBLE, titreDuSignalement, VOIR_DANS_MES_PIECES } from '../lib/piecesJointesEcarteesClient'
import type { PieceJointeEcarteeDuClient } from '../lib/types'

// LA LIGNE DE L'ACCUEIL SUR LES PIÈCES JOINTES ÉCARTÉES (ligne 22.94). L'accueil LIT (ClientHome, par la lecture qu'il partage
// avec « Mes pièces ») et passe la lecture ici, qui ne fait que la dire : combien, sous la phrase de la carte de « Mes pièces »
// et de l'onglet Justificatifs, puis un renvoi vers « Mes pièces » qui dit le reste. Ni raison, ni jour, ni poids, ni adresse.
//
// Quatre états : pas revenue, rien — aucune affirmation avant la lecture, et pas d'attente non plus, l'accueil n'en dépend pas ;
// lue en entier et vide, rien (pas de « aucune ») ; la liste, une ligne teintée d'une pastille d'attention ; partielle, refusée
// ou illisible, une ligne discrète — sans pastille, le motif en infobulle — qui dit que la vérification n'a pas pu se faire et
// renvoie au même endroit : jamais le silence d'une liste qu'on croirait vide.
export default function PiecesJointesEcarteesAccueil({ lecture }: {
  lecture: LectureComplete<PieceJointeEcarteeDuClient> | null
}) {
  if (lecture === null) return null
  if (!lecture.complete) {
    return (
      <section className="client-signalement client-signalement-discret" aria-label="Vérification des pièces jointes reçues par e-mail">
        <p className="client-signalement-texte muted" title={lecture.motif ?? undefined}>{ACCUEIL_VERIFICATION_IMPOSSIBLE}</p>
        <Link to="/mes-pieces" className="btn btn-outline btn-sm">{VOIR_DANS_MES_PIECES}</Link>
      </section>
    )
  }
  if (lecture.lignes.length === 0) return null
  return (
    <section className="client-signalement" aria-label="Pièces jointes reçues par e-mail et non déposées">
      <span className="check-dot check-attention" aria-hidden="true" />
      <p className="client-signalement-texte">{titreDuSignalement(lecture.lignes.length)}</p>
      <Link to="/mes-pieces" className="btn btn-outline btn-sm">{VOIR_DANS_MES_PIECES}</Link>
    </section>
  )
}
