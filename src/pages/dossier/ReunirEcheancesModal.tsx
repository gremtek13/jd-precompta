import { useState, type CSSProperties } from 'react'
import { montantDeLEcheance } from '../../lib/cotisationRapprochee'
import { confirmationDeLaReunion, raisonDeNePasReunir, refusDeLaReunion, type ContexteDesGestes } from '../../lib/gestesDesEcheances'
import { formatDate, formatMoney } from '../../lib/format'
import type { CotisationDeclaree } from '../../lib/types'

// LA FENÊTRE « RÉUNIR » (COT-Q1) : l'échéance gardée, celle qu'on lui réunit (au choix parmi les candidates), et, avant le
// clic, ce que la réunion écrit — la date retenue, les montants, la CSG-CRDS — ou pourquoi elle ne se fait pas. Rien n'est
// jugé ici (lib/gestesDesEcheances.ts) ; l'onglet écrit, sous son verrou, dans l'ordre que le module justifie.
export default function ReunirEcheancesModal({
  gardee, candidates, avisDe, contexte, enCours, attente, erreur, onReunir, onFermer,
}: {
  gardee: CotisationDeclaree
  candidates: readonly CotisationDeclaree[]
  // Le nom de l'avis rattaché à une échéance, s'il y en a un : la confirmation dit qu'il redevient non rattaché.
  avisDe: (c: CotisationDeclaree) => string | null
  contexte: ContexteDesGestes
  enCours: boolean
  attente: string | null
  erreur: string | null
  onReunir: (retiree: CotisationDeclaree) => void
  onFermer: () => void
}) {
  // L'IDENTIFIANT de la candidate choisie, relu dans la liste à chaque rendu : une relecture qui la retire efface le choix.
  const [choisie, setChoisie] = useState<string | null>(null)
  const retiree = candidates.find((c) => c.id === choisie) ?? null
  const refus = retiree ? refusDeLaReunion(gardee, retiree, contexte) : null
  // Une relecture a pu la rapprocher, la figer ou la payer : la raison se dit, plutôt qu'une liste de candidates vide.
  const raisonDeLaGardee = raisonDeNePasReunir(gardee, contexte)

  return (
    <div style={overlayStyle}>
      <div className="card" role="dialog" aria-modal="true" aria-labelledby="titre-reunir" style={{ width: 'min(560px, 92vw)', maxHeight: '92vh', overflowY: 'auto' }}>
        <h2 id="titre-reunir" style={{ marginTop: 0 }}>Réunir à l’échéance du {formatDate(gardee.echeance)}</h2>
        <p className="muted" style={{ marginTop: -8 }}>
          Quand un seul prélèvement paie deux échéances (la mensualité et une régularisation), elles deviennent une seule, à leur
          somme, avant le rapprochement : un prélèvement ne se rapproche que d’une échéance.
        </p>
        <fieldset style={{ border: 0, padding: 0, margin: '0 0 12px' }}>
          <legend style={{ fontWeight: 600, marginBottom: 6 }}>L’échéance à lui réunir</legend>
          {raisonDeLaGardee
            ? <p className="error-text">{raisonDeLaGardee}</p>
            : candidates.length === 0
            ? <p className="muted">Aucune autre échéance ne peut lui être réunie.</p>
            : candidates.map((c) => (
              <label key={c.id} style={{ display: 'block', marginBottom: 4 }}>
                <input
                  type="radio" name="echeance-a-reunir" value={c.id} checked={choisie === c.id} disabled={enCours}
                  onChange={() => setChoisie(c.id)} style={{ marginRight: 6 }}
                />
                {formatDate(c.echeance)} — {formatMoney(montantDeLEcheance(c))}
                {c.montant_csg_crds != null ? `, dont ${formatMoney(Math.abs(c.montant_csg_crds))} de CSG-CRDS` : ', CSG-CRDS non saisie'}
              </label>
            ))}
        </fieldset>
        {retiree && (refus
          ? <p className="error-text">{refus}</p>
          : <p>{confirmationDeLaReunion(gardee, retiree, avisDe(retiree))}</p>)}
        {attente && <p className="muted">{attente}</p>}
        {erreur && <p className="error-text">{erreur}</p>}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap', marginTop: 16 }}>
          <button type="button" className="btn btn-outline" onClick={onFermer} disabled={enCours}>Annuler</button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={retiree === null || refus !== null || enCours || attente !== null}
            onClick={() => { if (retiree) onReunir(retiree) }}
          >
            {enCours ? 'Réunion…' : 'Réunir'}
          </button>
        </div>
      </div>
    </div>
  )
}

const overlayStyle: CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 20,
}
