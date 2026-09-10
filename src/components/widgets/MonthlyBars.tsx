import { useState } from 'react'
import { formatMoney } from '../../lib/format'
import type { MoisPilotage } from '../../lib/tableauPilotage'

const MOIS_COURT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']

function libelleMois(mois: string): string {
  const [annee, mm] = mois.split('-')
  return `${MOIS_COURT[parseInt(mm, 10) - 1]} ${annee.slice(2)}`
}

// Encaissements / décaissements par mois — forme "emphase" (voir guide de visualisation) : la série
// qui compte (les rentrées) en couleur d'accent, l'autre en gris de retrait, jamais le rouge de danger
// détourné en couleur de série. Deux séries, donc une légende ; colonnes ≤ 24 px arrondies au sommet
// et carrées à la base, séparées d'un interstice de surface ; seul le dernier mois porte ses valeurs en
// direct (le survol donne les autres) plutôt qu'un chiffre sur chaque barre.
export default function MonthlyBars({ mois }: { mois: MoisPilotage[] }) {
  const [survol, setSurvol] = useState<number | null>(null)
  if (mois.length === 0) return null
  const max = Math.max(1, ...mois.flatMap((m) => [m.encaissements, m.decaissements]))
  const dernier = mois.length - 1

  return (
    <div className="colonnes">
      <div className="colonnes-legende">
        <span><i className="legende-puce legende-accent" />Encaissements</span>
        <span><i className="legende-puce legende-gris" />Décaissements</span>
      </div>
      <div className="colonnes-zone">
        {mois.map((m, i) => (
          <div
            key={m.mois}
            className="colonnes-groupe"
            onMouseEnter={() => setSurvol(i)}
            onMouseLeave={() => setSurvol(null)}
            onFocus={() => setSurvol(i)}
            onBlur={() => setSurvol(null)}
            tabIndex={0}
          >
            {(survol === i || (survol === null && i === dernier)) && (
              <div className="colonnes-info" role="tooltip">
                <strong>{libelleMois(m.mois)}</strong>
                <span>+{formatMoney(m.encaissements)}</span>
                <span>−{formatMoney(m.decaissements)}</span>
              </div>
            )}
            <div className="colonnes-barres">
              <div className="colonne colonne-accent" style={{ height: `${(m.encaissements / max) * 100}%` }} />
              <div className="colonne colonne-gris" style={{ height: `${(m.decaissements / max) * 100}%` }} />
            </div>
            <div className="colonnes-mois">{libelleMois(m.mois)}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
