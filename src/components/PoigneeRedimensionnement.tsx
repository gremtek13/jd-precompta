import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { Bornes } from '../lib/largeurVolets'

// LE BORD D'UN VOLET, QU'ON GLISSE POUR LE REDIMENSIONNER (voir lib/largeurVolets.ts). Un séparateur au sens de
// l'accessibilité : il prend le focus, et le clavier fait ce que fait la souris — les flèches déplacent le bord, Début
// et Fin le portent aux bornes, Entrée rend la largeur d'origine, comme le double-clic.
//
// `sens` dit de quel côté du bord est le volet : +1 pour la barre latérale, qui s'élargit quand on tire vers la droite ;
// −1 pour le volet de droite, qui s'élargit quand on tire vers la gauche. Le composant ne connaît que la largeur qu'on
// lui donne et les bornes du moment : c'est la coque qui décide, et qui retient.
//
// UNE LARGEUR SE RETIENT QUAND ON LÂCHE LE BORD, pas à chaque pixel, et seulement s'il a bougé : un simple clic n'écrit
// pas une préférence que personne n'a exprimée — celle-ci figerait la largeur d'aujourd'hui, et un volet dont la largeur
// d'origine changerait demain resterait à l'ancienne.
const PAS = 16
const GRAND_PAS = 64

export default function PoigneeRedimensionnement({
  libelle, controle, sens, largeur, bornes, onLargeur, onRetenir, onOrigine, onGlisse, className,
}: {
  libelle: string
  // L'identifiant de l'élément redimensionné (`aria-controls`).
  controle: string
  sens: 1 | -1
  largeur: number
  bornes: Bornes
  // La largeur pendant le geste, déjà bornée.
  onLargeur: (largeur: number) => void
  // La largeur à retenir, à la fin du geste.
  onRetenir: (largeur: number) => void
  // Revenir à la largeur d'origine.
  onOrigine: () => void
  // Le geste commence ou finit : la coque coupe alors ses transitions et la sélection de texte.
  onGlisse?: (enCours: boolean) => void
  className?: string
}) {
  const geste = useRef<{ pointeur: number; x: number; depart: number; derniere: number } | null>(null)
  const [glisse, setGlisse] = useState(false)

  const borner = (valeur: number) => Math.min(bornes.max, Math.max(bornes.min, Math.round(valeur)))

  function debut(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return
    e.preventDefault()
    e.currentTarget.focus()
    // Le pointeur reste à la poignée même s'il passe au-dessus d'un aperçu de justificatif (une iframe, qui sinon
    // garderait les mouvements pour elle) ou sort de la fenêtre.
    e.currentTarget.setPointerCapture?.(e.pointerId)
    geste.current = { pointeur: e.pointerId, x: e.clientX, depart: largeur, derniere: largeur }
    setGlisse(true)
    onGlisse?.(true)
  }

  function deplacement(e: PointerEvent<HTMLDivElement>) {
    const g = geste.current
    if (!g || g.pointeur !== e.pointerId) return
    const suivante = borner(g.depart + sens * (e.clientX - g.x))
    if (suivante === g.derniere) return
    g.derniere = suivante
    onLargeur(suivante)
  }

  function fin(e: PointerEvent<HTMLDivElement>) {
    const g = geste.current
    if (!g || g.pointeur !== e.pointerId) return
    geste.current = null
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    setGlisse(false)
    onGlisse?.(false)
    if (g.derniere !== g.depart) onRetenir(g.derniere)
  }

  function clavier(e: KeyboardEvent<HTMLDivElement>) {
    let suivante: number | null = null
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const pas = e.shiftKey ? GRAND_PAS : PAS
      suivante = borner(largeur + (e.key === 'ArrowRight' ? 1 : -1) * sens * pas)
    } else if (e.key === 'Home') {
      suivante = bornes.min
    } else if (e.key === 'End') {
      suivante = bornes.max
    } else if (e.key === 'Enter') {
      e.preventDefault()
      onOrigine()
      return
    } else {
      return
    }
    e.preventDefault()
    if (suivante === largeur) return
    onLargeur(suivante)
    onRetenir(suivante)
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={libelle}
      aria-controls={controle}
      aria-valuenow={largeur}
      aria-valuemin={bornes.min}
      aria-valuemax={bornes.max}
      tabIndex={0}
      title={`${libelle} — glisser pour changer la largeur, double-clic pour revenir à la largeur d'origine`}
      className={`poignee-volet${glisse ? ' glisse' : ''}${className ? ` ${className}` : ''}`}
      onPointerDown={debut}
      onPointerMove={deplacement}
      onPointerUp={fin}
      onPointerCancel={fin}
      onLostPointerCapture={fin}
      onDoubleClick={onOrigine}
      onKeyDown={clavier}
    />
  )
}
