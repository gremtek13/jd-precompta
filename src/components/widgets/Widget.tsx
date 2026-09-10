import type { ReactNode } from 'react'

// Carte titrée des tableaux de bord (voir .bento dans index.css) — un titre, une action facultative à
// droite (lien "Tout voir", bouton...), un corps. Même coquille partout pour que les tableaux de bord
// se lisent comme un seul système plutôt qu'une collection de cartes dessinées chacune à sa façon.
export default function Widget({
  titre, sousTitre, action, children, className, plein,
}: { titre: string; sousTitre?: string; action?: ReactNode; children: ReactNode; className?: string; plein?: boolean }) {
  return (
    <section className={`widget${plein ? ' widget-plein' : ''}${className ? ` ${className}` : ''}`}>
      <header className="widget-entete">
        <div>
          <h3 className="widget-titre">{titre}</h3>
          {sousTitre && <p className="widget-sous-titre">{sousTitre}</p>}
        </div>
        {action && <div className="widget-action">{action}</div>}
      </header>
      <div className="widget-corps">{children}</div>
    </section>
  )
}
