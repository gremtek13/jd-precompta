import { useState, type KeyboardEvent, type RefObject } from 'react'
import type { DossierDeLaCaisse } from '../lib/caisse'
import type { JourDeLaCaisseDuClient, OperationDuClient } from '../lib/caisseClient'
import { CORRECTION_DU_PAIEMENT_EXPORTEE, motsDuRemedeSelon } from '../lib/correctionDuPaiement'
import {
  confirmationDeLaCorrectionDuClient, confirmationDuPaiement, confirmationDuRetraitDuPaiement, correctionDuPaiementSelon,
  formulaireDeLaCorrectionDuClient, paiementCorrige, paiementDit, paiementEnregistre, paiementRetire, paiementsDeLaPiece,
  payableParLaCaisse, pieceVueParLeClient, premiereAnneeLue, retraitDuPaiement, verdictDeLaCorrectionDuClientSelon,
  verdictDuPaiement, type FormulaireDuPaiement,
} from '../lib/paiementDeMesPieces'
import type { SaisieDuReglement } from '../lib/paiementParLaCaisse'
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
//
// CORRIGER SON PAIEMENT D'UN SEUL GESTE (C12B-Q1 ; la migration `correction_du_paiement_par_la_caisse`, PRÉPARÉE, pas
// appliquée) : « Corriger » ouvre, sous le paiement, son jour et ses espèces sans signe ; la base écrit le nouveau et retire
// l'ancien. Le drapeau `CORRECTION_DU_PAIEMENT_EXPORTEE` baissé (lu ici, à chaque rendu), le bouton ne se rend pas et l'aide est
// celle d'hier : « Mes pièces » est celle d'hier, au caractère près.
//
// LE VERROU N'EST PAS ICI. Il est celui de « Mes pièces » (`ClientUpload`), qui porte aussi les trois appels (`payer`, `retirer`,
// `corriger`) :
// un verrou propre à ce formulaire disparaîtrait avec lui quand le praticien en ouvre un autre sur une autre pièce, et deux
// paiements partiraient sur une caisse pas encore relue. Ici, `verrou` ne se LIT que pour ne pas confirmer ce qui ne partirait
// pas, et `enVol` retient les boutons ; l'issue de l'appel (le refus de la base, ou rien) revient par `surIssue`, avant la relecture.

// Le formulaire vit dans une ligne du tableau des dépôts : « Entrée » n'envoie rien, le paiement ne part que par son bouton.
function sansEnvoi(e: KeyboardEvent<HTMLInputElement>) {
  if (e.key === 'Enter') e.preventDefault()
}

const FORMULAIRE_VIDE: FormulaireDuPaiement = { date: '', montant: '' }

export default function PaiementParMaCaisse({ piece, dossier, operations, jours, moi, anneeEnCours, aujourdhui, payer: payerLaPiece, retirer: retirerOperation, corriger: corrigerOperation, verrou, enVol }: {
  piece: Pick<Piece, 'id' | 'type_piece' | 'montant_ttc' | 'created_at'>
  /** Le dossier tel que les règles le lisent, sur la caisse rejouée (`caisseDeMesPieces`). */
  dossier: DossierDeLaCaisse
  operations: readonly OperationDuClient[]
  jours: readonly JourDeLaCaisseDuClient[]
  moi: string
  anneeEnCours: number
  aujourdhui: string
  /**
   * Paie la pièce, sous le verrou de l'écran : `surIssue` reçoit le refus de la base aux mots du client, ou `null` quand elle a
   * écrit, AVANT la relecture de la caisse ; la promesse ne revient qu'après elle. Rien n'est appelé si un geste est déjà en vol.
   */
  payer: (saisie: SaisieDuReglement, surIssue: (refus: string | null) => void) => Promise<void>
  /** Retire un paiement, mêmes termes que `payer`. */
  retirer: (operationId: string, surIssue: (refus: string | null) => void) => Promise<void>
  /** Corrige un paiement — le remplace par un autre jour ou un autre montant —, mêmes termes que `payer`. */
  corriger: (saisie: { operation_id: string; date: string; montant: number }, surIssue: (refus: string | null) => void) => Promise<void>
  /** Le verrou de l'écran : posé par `payer`, `retirer` et `corriger`, jamais ici ; lu ici avant toute confirmation. */
  verrou: RefObject<boolean>
  /** Un geste est en vol (pour l'affichage : le verrou, lui, se lit sur le `verrou`). */
  enVol: boolean
}) {
  const [formulaire, setFormulaire] = useState<FormulaireDuPaiement>(FORMULAIRE_VIDE)
  const [message, setMessage] = useState<{ genre: 'ok' | 'erreur'; texte: string } | null>(null)
  // La correction ouverte : le paiement qu'elle reprend, et ce que le praticien a tapé ; nulle quand aucune ne l'est.
  const [correction, setCorrection] = useState<{ id: string; formulaire: FormulaireDuPaiement } | null>(null)
  const vue = pieceVueParLeClient(piece)
  const premiere = premiereAnneeLue(anneeEnCours)
  const paiements = paiementsDeLaPiece(piece.id, operations)
  const payable = payableParLaCaisse(piece)
  const verdict = payable ? verdictDuPaiement(formulaire, vue, dossier, jours, premiere) : null

  // L'issue d'un geste : le refus de la base, ou le succès ; dite avant la relecture de la caisse.
  function dire(refus: string | null, reussite: string, echec: string, apres?: () => void) {
    if (refus !== null) setMessage({ genre: 'erreur', texte: `${echec} : ${refus}` })
    else {
      apres?.()
      setMessage({ genre: 'ok', texte: reussite })
    }
  }

  async function payer() {
    if (verrou.current || verdict === null || verdict.etat !== 'permis') return
    const { saisie } = verdict
    if (!window.confirm(confirmationDuPaiement(saisie, piece.created_at, verdict.soldeApres))) return
    setMessage(null)
    await payerLaPiece(saisie, (refus) => dire(refus, paiementEnregistre(saisie, piece.created_at), 'Ton paiement n’a pas été enregistré',
      () => setFormulaire(FORMULAIRE_VIDE)))
  }

  async function retirer(o: OperationDuClient) {
    if (verrou.current) return
    const retrait = retraitDuPaiement(o, dossier, jours, moi, premiere)
    if (!retrait.offert || retrait.refus !== null) return
    if (!window.confirm(confirmationDuRetraitDuPaiement(o, piece.created_at, dossier))) return
    setMessage(null)
    await retirerOperation(o.id, (refus) => dire(refus, paiementRetire(o), 'Ton paiement n’a pas été retiré'))
  }

  // La correction ouverte, son paiement relu dans la caisse lue (une relecture qui l'a retiré ou remplacé la ferme), et son
  // verdict sur la saisie telle qu'elle part.
  const enCorrection = correction === null ? null : paiements.find((o) => o.id === correction.id) ?? null
  const verdictCorrection = correction !== null && enCorrection !== null
    ? verdictDeLaCorrectionDuClientSelon(CORRECTION_DU_PAIEMENT_EXPORTEE, correction.formulaire, enCorrection, vue, dossier, jours, premiere)
    : null

  async function corriger() {
    if (verrou.current || enCorrection === null || verdictCorrection === null || verdictCorrection.etat !== 'permis') return
    const ancien = enCorrection
    const v = verdictCorrection
    if (!window.confirm(confirmationDeLaCorrectionDuClient(ancien, v, piece.created_at))) return
    setMessage(null)
    await corrigerOperation(v.saisie, (refus) => dire(refus, paiementCorrige(ancien, v, piece.created_at), 'Ton paiement n’a pas été corrigé',
      () => setCorrection(null)))
  }

  function changerLaCorrection(champ: keyof FormulaireDuPaiement, valeur: string) {
    setCorrection((c) => (c === null ? c : { ...c, formulaire: { ...c.formulaire, [champ]: valeur } }))
  }

  const idDate = `paiement-caisse-date-${piece.id}`
  const idMontant = `paiement-caisse-montant-${piece.id}`

  return (
    <div className="paiement-par-ma-caisse">
      {paiements.length > 0 && (
        <ul style={{ margin: '0 0 8px', paddingLeft: 18 }}>
          {paiements.map((o) => {
            const retrait = retraitDuPaiement(o, dossier, jours, moi, premiere)
            const corrigible = correctionDuPaiementSelon(CORRECTION_DU_PAIEMENT_EXPORTEE, o, dossier, jours, moi, premiere)
            const ouverte = correction !== null && enCorrection !== null && enCorrection.id === o.id
            const idDateCorrigee = `correction-caisse-date-${o.id}`
            const idMontantCorrige = `correction-caisse-montant-${o.id}`
            return (
              <li key={o.id}>
                <span>{paiementDit(o, moi)}</span>
                {retrait.offert && (
                  <>
                    {' '}
                    <button
                      type="button" className="btn btn-outline btn-sm" disabled={enVol || retrait.refus !== null}
                      title={retrait.refus ?? undefined} onClick={() => { void retirer(o) }}
                    >
                      Retirer
                    </button>
                    {retrait.refus !== null && <span className="error-text" style={{ display: 'block' }}>{retrait.refus}</span>}
                  </>
                )}
                {corrigible.offert && (
                  <>
                    {' '}
                    <button
                      type="button" className="btn btn-outline btn-sm" disabled={enVol || corrigible.refus !== null}
                      title={corrigible.refus ?? undefined} aria-expanded={ouverte}
                      onClick={() => {
                        // Le clic peut précéder le rendu qui désactive le bouton : le verrou, lui, est déjà posé.
                        if (verrou.current) return
                        setCorrection(ouverte ? null : { id: o.id, formulaire: formulaireDeLaCorrectionDuClient(o) })
                      }}
                    >
                      Corriger
                    </button>
                    {/* Le même refus que celui du retrait (un paiement d'avant les années lues) ne se dit qu'une fois. */}
                    {corrigible.refus !== null && !(retrait.offert && retrait.refus === corrigible.refus)
                      && <span className="error-text" style={{ display: 'block' }}>{corrigible.refus}</span>}
                  </>
                )}
                {ouverte && correction !== null && (
                  <div className="field-row aligne-bas" style={{ marginTop: 6 }}>
                    <div className="field">
                      <label htmlFor={idDateCorrigee}>{vue.especesEntrent ? 'Jour où tu as vraiment reçu les espèces' : 'Jour où tu as vraiment payé'}</label>
                      <input
                        id={idDateCorrigee} type="date" value={correction.formulaire.date} disabled={enVol} onKeyDown={sansEnvoi}
                        min={`${premiere}-01-01`} max={aujourdhui} onChange={(e) => changerLaCorrection('date', e.target.value)}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor={idMontantCorrige}>Montant exact de tes espèces (€)</label>
                      <input
                        id={idMontantCorrige} type="text" inputMode="decimal" autoComplete="off" value={correction.formulaire.montant}
                        disabled={enVol} onKeyDown={sansEnvoi} onChange={(e) => changerLaCorrection('montant', e.target.value)}
                      />
                    </div>
                    <button
                      type="button" className="btn btn-primary btn-sm" disabled={enVol || verdictCorrection?.etat !== 'permis'}
                      onClick={() => { void corriger() }}
                    >
                      {enVol ? 'Écriture…' : 'Enregistrer la correction'}
                    </button>
                    <button type="button" className="btn btn-outline btn-sm" disabled={enVol} onClick={() => setCorrection(null)}>
                      Annuler
                    </button>
                  </div>
                )}
                {ouverte && verdictCorrection?.etat === 'refuse' && <p className="error-text" role="alert">{verdictCorrection.message}</p>}
              </li>
            )
          })}
        </ul>
      )}
      {paiements.some((o) => retraitDuPaiement(o, dossier, jours, moi, premiere).offert) && (
        <p className="muted" style={{ margin: '0 0 8px' }}>{motsDuRemedeSelon(CORRECTION_DU_PAIEMENT_EXPORTEE).aideDuClient}</p>
      )}

      {payable && (
        <>
          <div className="field-row aligne-bas">
            <div className="field">
              <label htmlFor={idDate}>{vue.especesEntrent ? 'Jour où tu as reçu les espèces' : 'Jour où tu as payé'}</label>
              <input
                id={idDate} type="date" value={formulaire.date} disabled={enVol} onKeyDown={sansEnvoi}
                min={`${premiere}-01-01`} max={aujourdhui}
                onChange={(e) => setFormulaire((f) => ({ ...f, date: e.target.value }))}
              />
            </div>
            <div className="field">
              <label htmlFor={idMontant}>Montant de tes espèces (€)</label>
              <input
                id={idMontant} type="text" inputMode="decimal" autoComplete="off" value={formulaire.montant} placeholder="80,00"
                disabled={enVol} onKeyDown={sansEnvoi}
                onChange={(e) => setFormulaire((f) => ({ ...f, montant: e.target.value }))}
              />
            </div>
            <button
              type="button" className="btn btn-primary btn-sm" disabled={enVol || verdict?.etat !== 'permis'}
              onClick={() => { void payer() }}
            >
              {enVol ? 'Écriture…' : 'Enregistrer'}
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
