import { useState, type CSSProperties } from 'react'
import { formatDate, formatMoney } from '../../lib/format'
import { pourLEspace, type EspaceVentes } from '../../lib/espaceVentes'
import { avisDeLEnvoiDuDevis, refusDeLEnvoiDuDevis, type EtatDevis } from '../../lib/devis'
import type { Devis } from '../../lib/types'

// L'ENVOI D'UN DEVIS ÉMIS PAR E-MAIL (espace client, étape P6c3) : l'adresse du destinataire, préremplie avec celle que le devis
// porte (`tiers_email`) et modifiable, et un message facultatif. Elle ne fait que SAISIR : la vue (DevisVue.tsx) tient le verrou,
// la confirmation qui nomme le devis, le client, le total et l'adresse, et l'appel à `send-email` (lib/devisEnvoi.ts).
//
// LES REFUS SE DISENT AVANT LE CLIC, sur l'adresse TELLE QU'ELLE PART (`refusDeLEnvoiDuDevis`, aux mots de la fonction) : « Envoyer »
// grisé sous le refus. Un devis expiré, répondu ou facturé n'est pas refusé : la fenêtre le dit (`avisDeLEnvoiDuDevis`), et la
// confirmation le redit.

type Props = {
  espace: EspaceVentes
  dossierId: string
  // Le devis tel que la liste l'a lu, et son état déduit.
  devis: Devis
  etat: EtatDevis
  occupe: boolean
  erreur: string | null
  onClose: () => void
  onEnvoyer: (destinataire: string, message: string) => void
}

export default function DevisEmailModal(props: Props) {
  const { espace, dossierId, devis, etat, occupe, erreur } = props
  const dire = (texte: string) => pourLEspace(espace, texte)
  const [destinataire, setDestinataire] = useState(devis.tiers_email ?? '')
  const [message, setMessage] = useState('')
  const refus = refusDeLEnvoiDuDevis(dossierId, devis, destinataire)
  const avis = avisDeLEnvoiDuDevis(devis, etat)

  return (
    <div style={overlayStyle}>
      <div className="card" role="dialog" aria-modal="true" aria-labelledby="devis-email-titre" style={{ width: 'min(520px, 96vw)', maxHeight: '92vh', overflowY: 'auto' }}>
        <h2 id="devis-email-titre" style={{ marginTop: 0 }}>Envoyer le devis {devis.numero} par e-mail</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          <span className="nom-fichier">{devis.tiers_nom}</span> — {formatMoney(devis.montant_ttc)} TTC, daté du {formatDate(devis.date_emission)},
          valable jusqu’au {formatDate(devis.date_validite)}. Le détail du devis (lignes, totaux, conditions, mentions légales) part dans
          le corps de l’e-mail, sans pièce jointe ; les notes et la réponse enregistrée n’y figurent pas.
        </p>

        <div className="field">
          <label htmlFor="devis-email-destinataire">Adresse du destinataire</label>
          <input
            id="devis-email-destinataire" type="email" value={destinataire}
            onChange={(e) => setDestinataire(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="devis-email-message">Message personnalisé (facultatif)</label>
          <textarea
            id="devis-email-message" rows={3} value={message} onChange={(e) => setMessage(e.target.value)}
            placeholder="Laisse vide pour le message par défaut."
          />
        </div>

        {erreur ? <p className="error-text" role="alert">{erreur}</p>
          : refus ? <p className="error-text">{dire(refus)}</p>
            : avis && <p className="alerte-tva">{dire(avis)}</p>}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 10, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-outline" onClick={props.onClose} disabled={occupe}>Annuler</button>
          <button
            type="button" className="btn btn-primary" disabled={occupe || refus != null}
            onClick={() => props.onEnvoyer(destinataire, message)}
          >
            {occupe ? 'Envoi…' : 'Envoyer'}
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
