// Ce que l'écran affiche quand une collection n'a PAS pu être lue en entier (voir
// lib/lectureComplete.ts). Un seul composant plutôt qu'un paragraphe recopié par écran : le message
// doit dire la même chose partout, et surtout il doit exister partout — un bouton grisé ou un total
// discrètement faux, sans raison visible, est le début d'un ticket que personne ne pourra
// diagnostiquer.
//
// `consequence` est propre à l'écran, et c'est la seule partie qui varie : ce que le cabinet a sous
// les yeux et qui est devenu faux. La dire est tout l'intérêt du bandeau — « lecture partielle »
// tout seul ne dit pas si c'est grave.
export default function BandeauLecturePartielle({ quoi, motif, consequence }: {
  quoi: string
  motif: string | null
  consequence: string
}) {
  if (!motif) return null
  return (
    <p className="error-text">
      {quoi} n'ont pas pu être lues en entier ({motif}). {consequence}
    </p>
  )
}
