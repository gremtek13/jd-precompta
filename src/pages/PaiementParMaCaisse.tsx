import { useRef, useState, type KeyboardEvent } from 'react'
import type { DossierDeLaCaisse } from '../lib/caisse'
import type { JourDeLaCaisseDuClient, OperationDuClient } from '../lib/caisseClient'
import { pourLEspace } from '../lib/espaceVentes'
import { messageErreur } from '../lib/messageErreur'
import {
  confirmationDuPaiement, confirmationDuRetraitDuPaiement, paiementDit, paiementEnregistre, paiementRetire,
  paiementsDeLaPiece, payableParLaCaisse, pieceVueParLeClient, premiereAnneeLue, retraitDuPaiement, verdictDuPaiement,
  type FormulaireDuPaiement,
} from '../lib/paiementDeMesPieces'
import { supabase } from '../lib/supabase'
import type { Piece } from '../lib/types'

// LE PAIEMENT D'UNE PIÈCE PAR SA CAISSE, DANS « MES PIÈCES » (espace client, ligne 26.6, étape C12b ; CAISSE2-Q4, (A)). Ouvert
// sous la ligne d'une pièce, pour le praticien qui porte la case « Caisse » relue à la base. La logique est dans
// lib/paiementDeMesPieces.ts : l'écran appelle, affiche, et pose le verrou.
//
// LES RÈGLES DES ÉCRANS DU CLIENT QUI S'APPLIQUENT : monté seulement sur une caisse lue en entier et rejouée, et des pièces lues
// en entier (`caisseDeMesPieces`) ; un geste passe la fonction SQL seule, sous UN verrou `useRef` posé avant l'appel et relâché
// dans un `finally` APRÈS la relecture ; chaque refus se dit AVANT le clic, sur la saisie telle qu'elle part ; une confirmation
// nomme ce qui part ; le refus de la base se dit aux mots du client (`pourLEspace`). Le montant de la pièce ne s'affiche
// JAMAIS : le praticien tape les espèces qu'il a sorties ou reçues, sans signe ; le sens vient de la pièce.

// Le formulaire vit dans une ligne du tableau des dépôts : « Entrée » n'envoie rien, le paiement ne part que par son bouton.
function sansEnvoi(e: KeyboardEvent<HTMLInputElement>) {
  if (e.key === 'Enter') e.preventDefault()
}

const FORMULAIRE_VIDE: FormulaireDuPaiement = { date: '', montant: '' }

export default function PaiementParMaCaisse({ dossierId, piece, dossier, operations, jours, moi, anneeEnCours, aujourdhui, relire }: {
  dossierId: string
  piece: Pick<Piece, 'id' | 'type_piece' | 'montant_ttc' | 'created_at'>
  /** Le dossier tel que les règles le lisent, sur la caisse rejouée (`caisseDeMesPieces`). */
  dossier: DossierDeLaCaisse
  operations: readonly OperationDuClient[]
  jours: readonly JourDeLaCaisseDuClient[]
  moi: string
  anneeEnCours: number
  aujourdhui: string
  /** Relit la caisse ; rendue quand la relecture est revenue. */
  relire: () => Promise<void>
}) {
  const [formulaire, setFormulaire] = useState<FormulaireDuPaiement>(FORMULAIRE_VIDE)
  const [message, setMessage] = useState<{ genre: 'ok' | 'erreur'; texte: string } | null>(null)
  // UN verrou pour les deux gestes (payer, retirer) : deux gestes qui se croisent jugeraient la caisse sur deux lectures.
  const ecritureEnCours = useRef(false)
  const [enCours, setEnCours] = useState(false)

  const vue = pieceVueParLeClient(piece)
  const premiere = premiereAnneeLue(anneeEnCours)
  const paiements = paiementsDeLaPiece(piece.id, operations)
  const payable = payableParLaCaisse(piece)
  const verdict = payable ? verdictDuPaiement(formulaire, vue, dossier, jours, premiere) : null

  // Un geste : le verrou, l'appel, la relecture (même sur un refus : la base a peut-être vu ce que l'écran n'avait pas lu), le
  // message. `appel` rend le refus de la base aux mots du client, ou rien quand elle a écrit.
  async function agir(appel: () => Promise<string | null>, reussite: string, echec: string, apres?: () => void) {
    // Le verrou est lu ET posé ici, avant le premier `await`.
    if (ecritureEnCours.current) return
    ecritureEnCours.current = true
    setEnCours(true)
    setMessage(null)
    try {
      const refus = await appel()
      if (refus !== null) setMessage({ genre: 'erreur', texte: `${echec} : ${refus}` })
      else {
        apres?.()
        setMessage({ genre: 'ok', texte: reussite })
      }
      await relire()
    } finally {
      ecritureEnCours.current = false
      setEnCours(false)
    }
  }

  async function payer() {
    if (ecritureEnCours.current || verdict === null || verdict.etat !== 'permis') return
    const { saisie } = verdict
    if (!window.confirm(confirmationDuPaiement(saisie, piece.created_at, verdict.soldeApres))) return
    await agir(async () => {
      const { error } = await supabase.rpc('regler_piece_par_la_caisse', {
        p_dossier_id: dossierId, p_piece_id: saisie.piece_id, p_date: saisie.date, p_montant: saisie.montant,
      })
      return error ? pourLEspace('client', messageErreur(error, 'raison inconnue')) : null
    }, paiementEnregistre(saisie, piece.created_at), 'Ton paiement n’a pas été enregistré', () => setFormulaire(FORMULAIRE_VIDE))
  }

  async function retirer(o: OperationDuClient) {
    if (ecritureEnCours.current) return
    const retrait = retraitDuPaiement(o, dossier, jours, moi)
    if (!retrait.offert || retrait.refus !== null) return
    if (!window.confirm(confirmationDuRetraitDuPaiement(o, piece.created_at, dossier))) return
    await agir(async () => {
      const { error } = await supabase.rpc('retirer_operation_caisse', { p_dossier_id: dossierId, p_operation_id: o.id })
      return error ? pourLEspace('client', messageErreur(error, 'raison inconnue')) : null
    }, paiementRetire(o), 'Ton paiement n’a pas été retiré')
  }

  const idDate = `paiement-caisse-date-${piece.id}`
  const idMontant = `paiement-caisse-montant-${piece.id}`

  return (
    <div className="paiement-par-ma-caisse">
      {paiements.length > 0 && (
        <ul style={{ margin: '0 0 8px', paddingLeft: 18 }}>
          {paiements.map((o) => {
            const retrait = retraitDuPaiement(o, dossier, jours, moi)
            return (
              <li key={o.id}>
                <span>{paiementDit(o, moi)}</span>
                {retrait.offert && (
                  <>
                    {' '}
                    <button
                      type="button" className="btn btn-outline btn-sm" disabled={enCours || retrait.refus !== null}
                      title={retrait.refus ?? undefined} onClick={() => { void retirer(o) }}
                    >
                      Retirer
                    </button>
                    {retrait.refus !== null && <span className="error-text" style={{ display: 'block' }}>{retrait.refus}</span>}
                  </>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {paiements.some((o) => retraitDuPaiement(o, dossier, jours, moi).offert) && (
        <p className="muted" style={{ margin: '0 0 8px' }}>Pour corriger un paiement, retire-le puis enregistre le bon.</p>
      )}

      {payable && (
        <>
          <div className="field-row aligne-bas">
            <div className="field">
              <label htmlFor={idDate}>{vue.especesEntrent ? 'Jour où tu as reçu les espèces' : 'Jour où tu as payé'}</label>
              <input
                id={idDate} type="date" value={formulaire.date} disabled={enCours} onKeyDown={sansEnvoi}
                min={`${premiere}-01-01`} max={aujourdhui}
                onChange={(e) => setFormulaire((f) => ({ ...f, date: e.target.value }))}
              />
            </div>
            <div className="field">
              <label htmlFor={idMontant}>Montant de tes espèces (€)</label>
              <input
                id={idMontant} type="text" inputMode="decimal" autoComplete="off" value={formulaire.montant} placeholder="80,00"
                disabled={enCours} onKeyDown={sansEnvoi}
                onChange={(e) => setFormulaire((f) => ({ ...f, montant: e.target.value }))}
              />
            </div>
            <button
              type="button" className="btn btn-primary btn-sm" disabled={enCours || verdict?.etat !== 'permis'}
              onClick={() => { void payer() }}
            >
              {enCours ? 'Écriture…' : 'Enregistrer'}
            </button>
          </div>
          <p className="muted" style={{ margin: '0 0 6px' }}>
            {vue.especesEntrent
              ? 'Le montant des espèces que tu as reçues pour cette pièce, sans signe : elles entrent dans ta caisse.'
              : 'Le montant que tu as sorti de ta caisse pour cette pièce, sans signe. Si tu as payé de ta poche, ce n’est pas ta '
                + 'caisse : c’est une note de frais.'}
          </p>
          {verdict?.etat === 'refuse' && <p className="error-text" role="alert">{verdict.message}</p>}
        </>
      )}

      {message && (
        <p className={message.genre === 'erreur' ? 'error-text' : 'muted'} role={message.genre === 'erreur' ? 'alert' : 'status'}>
          {message.texte}
        </p>
      )}
    </div>
  )
}
