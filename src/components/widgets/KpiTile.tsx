import type { ReactNode } from 'react'
import Sparkline from './Sparkline'

export type StatutKpi = 'neutral' | 'ok' | 'warning' | 'danger'

interface Props {
  libelle: string
  valeur: ReactNode
  // Petit texte sous la valeur (période, source, "vs mois dernier"...).
  detail?: string
  // Variation signée, avec le sens qui compte : `positif` dit si c'est une bonne nouvelle, pas si le
  // nombre monte — une hausse des pièces à valider n'est pas une bonne nouvelle.
  delta?: { texte: string; positif?: boolean }
  statut?: StatutKpi
  tendance?: number[]
  // Ancre vers l'écran de détail — toute la tuile devient cliquable.
  onClick?: () => void
}

// Tuile chiffrée (voir guide de visualisation : libellé en phrase, valeur en chiffres proportionnels,
// delta signé, sparkline 12 points). Le statut se lit à une pastille colorée à côté du libellé, jamais
// en colorant le chiffre lui-même : le texte garde sa couleur de texte, la couleur porte le sens à
// côté.
export default function KpiTile({ libelle, valeur, detail, delta, statut = 'neutral', tendance, onClick }: Props) {
  const Balise = onClick ? 'button' : 'div'
  return (
    <Balise className={`kpi kpi-${statut}`} onClick={onClick} type={onClick ? 'button' : undefined}>
      <div className="kpi-libelle">
        {statut !== 'neutral' && <span className="kpi-dot" aria-hidden="true" />}
        {libelle}
      </div>
      <div className="kpi-valeur">{valeur}</div>
      <div className="kpi-pied">
        <div className="kpi-pied-texte">
          {delta && (
            <span className={`kpi-delta ${delta.positif === true ? 'pos' : delta.positif === false ? 'neg' : ''}`}>{delta.texte}</span>
          )}
          {detail && <span className="kpi-detail">{detail}</span>}
        </div>
        {tendance && tendance.length >= 2 && <Sparkline valeurs={tendance} />}
      </div>
    </Balise>
  )
}
