// Ce que l'écran affiche quand une collection n'a PAS pu être lue en entier (voir
// lib/lectureComplete.ts). Un seul composant plutôt qu'un paragraphe recopié par écran : le message
// doit dire la même chose partout, et surtout il doit exister partout — un bouton grisé ou un total
// discrètement faux, sans raison visible, est le début d'un ticket que personne ne pourra
// diagnostiquer.
//
// `consequence` est propre à l'écran, et c'est la seule partie qui varie : ce que le cabinet a sous
// les yeux et qui est devenu faux. La dire est tout l'intérêt du bandeau — « lecture partielle »
// tout seul ne dit pas si c'est grave.
//
// `technique` dit si le MOTIF (« 500 lignes lues sur 900 ») s'affiche ou se réfugie dans une
// infobulle. Côté cabinet il s'affiche : c'est ce qu'on recopiera dans un signalement. Côté client
// il reste en infobulle — un chiffre de pagination ne veut rien dire pour lui, et les écrans client
// parlent sa langue (« en cours de vérification », jamais « à valider »).
export default function BandeauLecturePartielle({ quoi, motif, consequence, technique = true }: {
  quoi: string
  motif: string | null
  consequence: string
  technique?: boolean
}) {
  if (!motif) return null
  return (
    <p className="error-text" title={technique ? undefined : motif}>
      {quoi} n'ont pas pu être {technique ? `lues en entier (${motif})` : 'affichées en entier'}. {consequence}
    </p>
  )
}
