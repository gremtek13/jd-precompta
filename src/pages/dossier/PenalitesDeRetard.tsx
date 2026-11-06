import { formatDate, formatMoney } from '../../lib/format'
import { origineDuTauxEnMots, tauxEnMots, type Penalites } from '../../lib/relances'

interface Props {
  jours: number
  /** Le jour de Paris de la dernière relance, déduit du journal ; nul : jamais relancée. */
  relanceeLe: string | null
  penalites: Penalites
  /** Le texte des pénalités que la facture a figé, cité quand il ne se lit pas sans deviner. */
  texteFige: string | null
}

// CE QUE LA RELANCE MONTRE AVANT LE CLIC (étape C5) : le retard, la dernière relance, et les pénalités de retard et
// l'indemnité forfaitaire CALCULÉES au jour de Paris (lib/relances.ts) — montrées, jamais facturées seules, et jamais
// écrites dans l'e-mail. Pour un particulier, rien de cela, et la raison le dit.
export default function PenalitesDeRetard({ jours, relanceeLe, penalites, texteFige }: Props) {
  return (
    <div style={{ margin: '0 0 12px' }}>
      <p style={{ margin: '0 0 6px' }}>
        <span className="badge badge-danger">En retard de {jours} jour{jours > 1 ? 's' : ''}</span>{' '}
        {relanceeLe ? <span className="badge badge-neutral">Relancée le {formatDate(relanceeLe)}</span> : <span className="muted">Jamais relancée.</span>}
      </p>
      {penalites.etat === 'calculees' ? (
        <>
          <p style={{ margin: '0 0 4px' }}>
            Pénalités de retard : <strong>{formatMoney(penalites.penalitesCentimes / 100)}</strong> ; indemnité forfaitaire
            pour frais de recouvrement : <strong>{formatMoney(penalites.indemniteCentimes / 100)}</strong>.
          </p>
          <ul className="muted" style={{ margin: '0 0 4px', paddingLeft: 18, fontSize: '0.85rem' }}>
            {penalites.periodes.map((p) => (
              <li key={p.du}>du {formatDate(p.du)} au {formatDate(p.au)} : {p.jours} jour{p.jours > 1 ? 's' : ''} à {tauxEnMots(p.centiemes)} l’an</li>
            ))}
          </ul>
          <p className="muted" style={{ margin: '0 0 4px', fontSize: '0.85rem' }}>
            {origineDuTauxEnMots(penalites.regime, penalites.taux)}
            {penalites.taux.origine === 'loi' && penalites.taux.motif === 'texte_illisible' && texteFige ? ` Texte de la facture : « ${texteFige} ».` : ''}
          </p>
          <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
            Calculées sur le TTC qui reste dû, au jour de Paris, sur 365 jours : montrées pour information, elles ne se
            facturent jamais seules, et l’e-mail ne les cite pas.
          </p>
        </>
      ) : (
        <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>{penalites.raison}</p>
      )}
    </div>
  )
}
