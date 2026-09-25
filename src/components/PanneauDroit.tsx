import { useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { PanneauDroitContexte, usePanneauDroitContexte, type GardesPanneau } from '../lib/panneauDroit'
import { IconFermer } from './icons'

// Le panneau contextuel de droite — voir lib/panneauDroit.ts pour ce qu'il partage et pourquoi un seul
// contenu l'occupe à la fois. La coque (Layout) pose le fournisseur autour de tout, et l'emplacement
// après le panneau central ; un écran y affiche un contenu par <PanneauDroit nom="…">.
export function FournisseurPanneauDroit({ children }: { children: ReactNode }) {
  const [cible, setCible] = useState<HTMLElement | null>(null)
  const [occupant, setOccupant] = useState<string | null>(null)
  const garde = useRef<(() => boolean) | null>(null)
  const gardes = useMemo<GardesPanneau>(() => ({
    consulter: () => garde.current?.() ?? true,
    poser: (g) => { garde.current = g },
    // Seulement la SIENNE : celle d'un contenu parti ne doit pas effacer celle de son successeur.
    retirer: (g) => { if (garde.current === g) garde.current = null },
  }), [])
  const valeur = useMemo(() => ({ cible, setCible, occupant, setOccupant, gardes }), [cible, occupant, gardes])
  return <PanneauDroitContexte.Provider value={valeur}>{children}</PanneauDroitContexte.Provider>
}

// L'emplacement lui-même. VIDE, il ne s'affiche pas (`:empty` dans index.css), et c'est ce qui le fait
// disparaître quand son contenu quitte l'écran — le dossier qu'on referme emporte l'assistant — sans que
// personne ait à le lui dire. L'occupant, lui, reste retenu : rouvrir un dossier retrouve l'assistant
// là où on l'avait laissé, comme le panneau latéral d'une application qu'on n'a pas refermé.
//
// Il porte le NOM de son occupant (`data-occupant`) : sur téléphone, une fiche de pièce a besoin de
// tout l'écran là où l'assistant tient dans une carte (voir index.css).
export function EmplacementPanneauDroit() {
  const { setCible, occupant } = usePanneauDroitContexte()
  return (
    <aside
      id="panneau-droit"
      className="panneau-droit"
      aria-label="Panneau contextuel"
      data-occupant={occupant ?? undefined}
      ref={setCible}
    />
  )
}

export default function PanneauDroit({ nom, children }: { nom: string; children: ReactNode }) {
  const { cible, occupant } = usePanneauDroitContexte()
  if (!cible || occupant !== nom) return null
  return createPortal(children, cible)
}

// En-tête commun des contenus du volet : de quoi il s'agit, sur quoi, et le moyen de le refermer —
// toujours au même endroit, quel que soit le contenu.
export function EntetePanneau({ icone, titre, sousTitre, actions, onFermer }: {
  icone?: ReactNode
  titre: string
  sousTitre?: string | null
  actions?: ReactNode
  onFermer: () => void
}) {
  return (
    <header className="panneau-entete">
      {icone && <span className="panneau-entete-icone" aria-hidden="true">{icone}</span>}
      <div className="panneau-entete-titres">
        <h2 className="panneau-entete-titre">{titre}</h2>
        {sousTitre && <span className="panneau-entete-sous-titre">{sousTitre}</span>}
      </div>
      {actions}
      <button type="button" className="panneau-bouton-icone" onClick={onFermer} aria-label="Fermer le panneau" title="Fermer le panneau">
        <IconFermer width={18} height={18} />
      </button>
    </header>
  )
}
