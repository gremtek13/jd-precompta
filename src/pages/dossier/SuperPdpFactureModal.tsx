import { useEffect, useState, type CSSProperties } from 'react'
import { supabase } from '../../lib/supabase'
import { formatDate } from '../../lib/format'
import { badgeClasseStatutSuperpdp, libelleStatutSuperpdp } from '../../lib/superpdpStatuts'
import type { FactureEmise, FactureSuperpdpEvent } from '../../lib/types'

interface Props {
  dossierId: string
  facture: FactureEmise
  onClose: () => void
  onUpdated: () => void
}

// Transmission d'une facture validée via Super PDP (voir supabase/functions/superpdp-emit) — deux
// actions distinctes possibles :
// - "Envoyer" une seule fois (irréversible une fois transmise — voir en-tête de la fonction ; seul un
//   avoir corrige une facture déjà transmise, jamais un renvoi).
// - "Actualiser" ensuite, autant de fois que voulu, pour suivre le cycle de vie asynchrone (soumise →
//   envoyée → acceptée/refusée...) — pas de webhook branché pour l'instant, un clic manuel suffit vu
//   le volume attendu (quelques factures par mois et par dossier).
export default function SuperPdpFactureModal({ dossierId, facture, onClose, onUpdated }: Props) {
  const [evenements, setEvenements] = useState<FactureSuperpdpEvent[] | null>(null)
  const [enCours, setEnCours] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)

  async function charger() {
    const { data } = await supabase
      .from('facture_superpdp_events')
      .select('*')
      .eq('facture_id', facture.id)
      .order('occurred_at', { ascending: true })
    setEvenements((data ?? []) as FactureSuperpdpEvent[])
  }
  useEffect(() => { charger() }, [facture.id])

  async function appeler(action: 'envoyer' | 'actualiser') {
    setEnCours(true)
    setErreur(null)
    const { data, error: invokeError } = await supabase.functions.invoke<{ ok?: boolean; error?: string }>('superpdp-emit', {
      body: { dossierId, factureId: facture.id, action },
    })
    setEnCours(false)
    if (data?.error || invokeError) {
      setErreur(data?.error ?? "Échec de l'appel à Super PDP.")
      return
    }
    await charger()
    onUpdated()
  }

  const dernierCode = evenements && evenements.length > 0 ? evenements[evenements.length - 1].status_code : facture.superpdp_dernier_statut

  return (
    <div style={overlayStyle}>
      <div className="card" style={{ width: 'min(560px, 92vw)', maxHeight: '90vh', overflowY: 'auto' }}>
        <h2 style={{ marginTop: 0 }}>Super PDP — facture {facture.numero}</h2>
        <p className="muted" style={{ marginTop: -8 }}>
          Transmission au client via la plateforme agréée Super PDP (réseau Peppol/PPF). Une fois
          envoyée, une facture ne peut plus être annulée par cette voie — corrige une erreur avec une
          facture d'avoir, comme pour un envoi papier.
        </p>

        {!facture.superpdp_invoice_id ? (
          <>
            <p><span className="badge badge-neutral">Jamais transmise</span></p>
            {erreur && <p className="error-text">{erreur}</p>}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
              <button type="button" className="btn btn-outline" onClick={onClose} disabled={enCours}>Fermer</button>
              <button type="button" className="btn btn-primary" disabled={enCours} onClick={() => appeler('envoyer')}>
                {enCours ? 'Envoi…' : 'Envoyer via Super PDP'}
              </button>
            </div>
          </>
        ) : (
          <>
            <p>
              <span className={`badge ${badgeClasseStatutSuperpdp(dernierCode)}`}>
                {dernierCode ? libelleStatutSuperpdp(dernierCode) : 'Statut inconnu'}
              </span>{' '}
              <span className="muted" style={{ fontSize: '0.85rem' }}>id Super PDP : {facture.superpdp_invoice_id}</span>
            </p>

            <div className="field">
              <label>Historique</label>
              {evenements === null ? (
                <p className="muted">Chargement…</p>
              ) : evenements.length === 0 ? (
                <p className="muted">Aucun événement pour l'instant — actualise dans quelques instants.</p>
              ) : (
                <div className="table-scroll" style={{ border: '1px solid var(--color-border)', borderRadius: 8 }}>
                  <table>
                    <thead><tr><th>Date</th><th>Statut</th><th>Détail</th></tr></thead>
                    <tbody>
                      {[...evenements].reverse().map((e) => (
                        <tr key={e.id}>
                          <td>{formatDate(e.occurred_at)}</td>
                          <td><span className={`badge ${badgeClasseStatutSuperpdp(e.status_code)}`}>{libelleStatutSuperpdp(e.status_code)}</span></td>
                          <td className="muted" style={{ fontSize: '0.82rem' }}>{e.status_text}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {erreur && <p className="error-text">{erreur}</p>}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
              <button type="button" className="btn btn-outline" onClick={onClose} disabled={enCours}>Fermer</button>
              <button type="button" className="btn btn-outline" disabled={enCours} onClick={() => appeler('actualiser')}>
                {enCours ? 'Actualisation…' : 'Actualiser le statut'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

const overlayStyle: CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20,
}
