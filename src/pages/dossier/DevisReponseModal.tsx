import { useState, type CSSProperties } from 'react'
import { formatDate, formatMoney } from '../../lib/format'
import { pourLEspace, type EspaceVentes } from '../../lib/espaceVentes'
import { avisHorsValidite, refusDeLaReponse, type SaisieReponseDevis } from '../../lib/devis'
import type { Devis } from '../../lib/types'

// LA RÉPONSE À UN DEVIS ÉMIS (espace client, étape P6a2) : « Accepté » ou « Refusé », et la date de la réponse, proposée au jour
// et modifiable. Elle ne fait que SAISIR : la vue (DevisVue.tsx) tient le verrou, la confirmation qui nomme le devis, le client,
// la réponse et sa date, et l'écriture, par `decider_devis` seule.
//
// LES REFUS SE DISENT AVANT LE CLIC, sur la réponse TELLE QU'ELLE PART (`refusDeLaReponse`, dans l'ordre de la base et sous ses
// mots) : « Enregistrer la réponse » grisé sous le refus. Une acceptation datée après la validité n'est pas refusée — elle se
// confirme, et la fenêtre le dit d'avance (`avisHorsValidite`).

type Props = {
  espace: EspaceVentes
  dossierId: string
  // Le devis tel que la liste l'a lu.
  devis: Devis
  aujourdHui: string
  occupe: boolean
  erreur: string | null
  onClose: () => void
  onRepondre: (saisie: SaisieReponseDevis) => void
}

export default function DevisReponseModal(props: Props) {
  const { espace, dossierId, devis, aujourdHui, occupe, erreur } = props
  const dire = (texte: string) => pourLEspace(espace, texte)
  const [saisie, setSaisie] = useState<SaisieReponseDevis>({ reponse: '', dateReponse: aujourdHui })
  const refus = refusDeLaReponse(dossierId, devis, saisie, aujourdHui)
  const avis = avisHorsValidite(devis, saisie)

  return (
    <div style={overlayStyle}>
      <div className="card" role="dialog" aria-modal="true" aria-labelledby="devis-reponse-titre" style={{ width: 'min(560px, 96vw)', maxHeight: '92vh', overflowY: 'auto' }}>
        <h2 id="devis-reponse-titre" style={{ marginTop: 0 }}>Réponse au devis {devis.numero}</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          <span className="nom-fichier">{devis.tiers_nom}</span> — {formatMoney(devis.montant_ttc)} TTC, daté du {formatDate(devis.date_emission)},
          valable jusqu’au {formatDate(devis.date_validite)}.
        </p>

        <fieldset className="field" style={{ border: 0, padding: 0, margin: '0 0 12px' }}>
          <legend>La réponse du client</legend>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <input
                type="radio" name="devis-reponse" checked={saisie.reponse === 'acceptee'}
                onChange={() => setSaisie((s) => ({ ...s, reponse: 'acceptee' }))}
              />
              Accepté
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <input
                type="radio" name="devis-reponse" checked={saisie.reponse === 'refusee'}
                onChange={() => setSaisie((s) => ({ ...s, reponse: 'refusee' }))}
              />
              Refusé
            </label>
          </div>
        </fieldset>

        <div className="field">
          <label htmlFor="devis-reponse-date">Date de la réponse</label>
          <input
            id="devis-reponse-date" type="date" value={saisie.dateReponse}
            onChange={(e) => setSaisie((s) => ({ ...s, dateReponse: e.target.value }))}
          />
        </div>

        {erreur ? <p className="error-text" role="alert">{erreur}</p>
          : refus ? <p className="error-text">{dire(refus)}</p>
            : avis && <p className="alerte-tva">{dire(avis)}</p>}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 10, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-outline" onClick={props.onClose} disabled={occupe}>Annuler</button>
          <button
            type="button" className="btn btn-primary" disabled={occupe || refus != null}
            onClick={() => props.onRepondre(saisie)}
          >
            {occupe ? 'Enregistrement…' : 'Enregistrer la réponse'}
          </button>
        </div>
      </div>
    </div>
  )
}

const overlayStyle: CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20,
}
