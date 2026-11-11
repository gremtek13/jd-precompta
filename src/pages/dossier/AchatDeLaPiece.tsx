import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { messageErreur } from '../../lib/messageErreur'
import { aujourdHuiAParis } from '../../lib/format'
import { accesDeLaLecture } from '../../lib/auteursVentes'
import type { PaiementDeclare } from '../../lib/achatsClient'
import { confirmationDuRetraitAuCabinet, declarationDiteAuCabinet, echeanceDiteAuCabinet } from '../../lib/achatsClientVue'
import { lireLAchatDeLaPiece, type AchatDeLaPieceLu } from '../../lib/achatsClientLecture'
import BandeauLecturePartielle from '../../components/BandeauLecturePartielle'

// LES ACHATS DU CLIENT DANS LA FICHE D'UNE PIÈCE D'ACHAT (espace client, ligne 51.5, étape B5 ; la base : B4). Montée par
// FichePiece sous `ACHATS_DU_CLIENT_PREVUS` seulement, pour une pièce d'achat déjà enregistrée. Elle dit :
//  - l'échéance, relue en base (la fiche reçoit une pièce lue sans ses colonnes neuves), et qui l'a fixée — « par le client »
//    d'un compte reconnu parmi les accès lus en entier, jamais deviné ;
//  - les paiements que le client a déclarés (« proposé par le client le … »), une PROPOSITION : rien ne s'écrit en
//    comptabilité d'ici ; le rapprochement et la caisse restent les seuls chemins d'un paiement ;
//  - « Retirer » une déclaration (B4-Q4 : le cabinet le peut ; la ligne reste, avec la date du retrait), sur une confirmation
//    qui nomme la pièce et la déclaration qui part, par `retirer_paiement_declare` seule, sous un verrou `useRef` relâché
//    après la relecture.
// Une lecture partielle ou refusée le dit et n'offre aucun geste. Tous ses boutons sont `type="button"` : la fiche est un
// formulaire, et un clic ici ne doit pas l'enregistrer.

export default function AchatDeLaPiece({ dossierId, pieceId, nomFichier }: { dossierId: string; pieceId: string; nomFichier: string }) {
  const [lecture, setLecture] = useState<AchatDeLaPieceLu | null>(null)
  const [message, setMessage] = useState<{ genre: 'ok' | 'erreur'; texte: string } | null>(null)
  const retraitEnCours = useRef(false)
  const [occupe, setOccupe] = useState(false)
  const derniereLecture = useRef(0)

  useEffect(() => {
    let annule = false
    const numero = ++derniereLecture.current
    lireLAchatDeLaPiece(dossierId, pieceId).then((l) => { if (!annule && numero === derniereLecture.current) setLecture(l) })
    return () => { annule = true }
  }, [dossierId, pieceId])

  async function relire() {
    const numero = ++derniereLecture.current
    const l = await lireLAchatDeLaPiece(dossierId, pieceId)
    if (numero === derniereLecture.current) setLecture(l)
  }

  async function retirer(p: PaiementDeclare) {
    if (retraitEnCours.current) return
    if (!window.confirm(confirmationDuRetraitAuCabinet(p, nomFichier))) return
    retraitEnCours.current = true
    setOccupe(true)
    setMessage(null)
    try {
      const { error } = await supabase.rpc('retirer_paiement_declare', { p_paiement_id: p.id })
      setMessage(error
        ? { genre: 'erreur', texte: `La déclaration n’est pas retirée : ${messageErreur(error, 'refus de la base.')}` }
        : { genre: 'ok', texte: 'La déclaration est retirée ; sa ligne reste.' })
    } finally {
      await relire()
      retraitEnCours.current = false
      setOccupe(false)
    }
  }

  const lue = lecture !== null && lecture.dossierId === dossierId && lecture.pieceId === pieceId ? lecture : null
  const echeance = lue !== null && lue.echeance.complete ? lue.echeance.lignes[0] : null
  const paiements = lue !== null && lue.paiements.complete ? lue.paiements.lignes : null

  return (
    <div className="field" aria-label="Ce que le client en dit">
      <strong>Ce que le client en dit</strong>
      {lue === null ? (
        <p className="muted" style={{ margin: '4px 0' }}>Chargement…</p>
      ) : (
        <>
          {echeance !== null
            ? <p style={{ margin: '4px 0' }}>{echeanceDiteAuCabinet(echeance, accesDeLaLecture(lue.acces), aujourdHuiAParis())}</p>
            : <BandeauLecturePartielle quoi="L’échéance de la pièce" accord="lue" motif={lue.echeance.motif}
                consequence="Elle ne se dit pas d’ici." />}
          {paiements === null ? (
            <BandeauLecturePartielle quoi="Les paiements déclarés par le client" accord="lus" motif={lue.paiements.motif}
              consequence="Aucun ne se dit ni ne se retire d’ici." />
          ) : paiements.length === 0 ? (
            <p className="muted" style={{ margin: '4px 0' }}>Le client n’a déclaré aucun paiement de cette facture.</p>
          ) : (
            <>
              <ul style={{ margin: '4px 0', paddingLeft: 16 }}>
                {paiements.map((p) => (
                  <li key={p.id} className={p.retire_le === null ? undefined : 'muted'}>
                    {declarationDiteAuCabinet(p)}
                    {p.retire_le === null && (
                      <> <button type="button" className="btn btn-outline btn-sm" disabled={occupe} onClick={() => { void retirer(p) }}>
                        Retirer
                      </button></>
                    )}
                  </li>
                ))}
              </ul>
              <p className="muted" style={{ margin: '4px 0' }}>
                Une déclaration du client est une proposition : elle n’écrit rien en comptabilité. Le paiement se rapproche du
                relevé, ou se règle par la caisse.
              </p>
            </>
          )}
          {message !== null && (message.genre === 'ok'
            ? <p role="status" style={{ margin: '4px 0' }}>{message.texte}</p>
            : <p className="error-text" role="alert">{message.texte}</p>)}
        </>
      )}
    </div>
  )
}
