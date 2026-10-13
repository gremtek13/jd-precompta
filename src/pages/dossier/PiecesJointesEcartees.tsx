import { useCallback, useEffect, useRef, useState } from 'react'
import BandeauLecturePartielle from '../../components/BandeauLecturePartielle'
import type { LectureComplete } from '../../lib/lectureComplete'
import { messageErreur } from '../../lib/messageErreur'
import {
  CE_QUE_FAIT_LA_MARQUE, ceQueLeCabinetPeutFaire, libelleDuGeste, phraseDeLaLigneVue, phraseDeLaRaison, quandRecue,
  rangerLesEcarts, refusDeMarquerVues, titreDuSignalement,
} from '../../lib/piecesJointesEcartees'
import { lirePiecesJointesEcartees } from '../../lib/piecesJointesEcarteesLecture'
import { supabase } from '../../lib/supabase'
import type { PieceJointeEcartee } from '../../lib/types'

// LES PIÈCES JOINTES ÉCARTÉES À LA RÉCEPTION PAR E-MAIL, DANS L'ONGLET JUSTIFICATIFS (ligne 22.7). C'est là que le cabinet
// travaille les pièces reçues — celles de l'adresse de collecte y arrivent « à valider » — : c'est donc là qu'il voit
// celles qui ne sont PAS arrivées, et pourquoi (src/lib/piecesJointesEcartees.ts). L'onglet Accès, où se lit l'adresse,
// ne se visite qu'à la mise en place ; un point de la Vue d'ensemble entraînerait les cycles de la révision et les
// préalables de la validation, pour un fait qui ne touche aucun compte.
//
// Tant que la lecture n'est pas revenue, l'attente seule se dit (une alerte qui n'a pas lu ne peut rien affirmer, ni le
// vide) ; lue EN ENTIER et vide, rien ; lue en partie ou refusée, le bandeau le dit, sans compte ni geste. Le cabinet
// marque vues celles que l'écran a montrées, par `marquer_pieces_jointes_vues` seule, sous un verrou relâché après la
// relecture — relue aussi sur un refus, qui se dit.

export default function PiecesJointesEcartees({ dossierId }: { dossierId: string }) {
  // La lecture, AVEC le dossier pour lequel elle a été faite : nulle tant que la première n'est pas revenue, et pour un
  // autre dossier que celui d'aujourd'hui.
  const [lue, setLue] = useState<{ dossierId: string; lecture: LectureComplete<PieceJointeEcartee> } | null>(null)
  const lecture = lue !== null && lue.dossierId === dossierId ? lue.lecture : null
  const [erreur, setErreur] = useState<string | null>(null)
  const [enCours, setEnCours] = useState(false)
  const marquageEnCours = useRef(false)

  const relire = useCallback(async () => {
    setLue({ dossierId, lecture: await lirePiecesJointesEcartees(dossierId) })
  }, [dossierId])

  // Une lecture plus lente que le changement de dossier n'écrit pas : le drapeau d'annulation.
  useEffect(() => {
    let annule = false
    lirePiecesJointesEcartees(dossierId).then((l) => { if (!annule) setLue({ dossierId, lecture: l }) })
    return () => { annule = true }
  }, [dossierId])

  // Avant la lecture : l'attente, dite — ni un compte, ni le silence d'une liste qu'on croirait vide.
  if (lecture === null) {
    return <p className="muted pieces-jointes-ecartees-attente" aria-busy="true">Lecture des pièces jointes écartées à la réception par e-mail…</p>
  }
  if (!lecture.complete) {
    return (
      <BandeauLecturePartielle
        quoi="Les pièces jointes écartées à la réception par e-mail" accord="lues" motif={lecture.motif ?? 'lecture incomplète'}
        consequence="Une pièce jointe que la réception a écartée peut donc ne pas être signalée ici, et rien ne se marque vu. Recharge la page."
      />
    )
  }
  const { aSignaler, dejaVues } = rangerLesEcarts(dossierId, lecture.lignes)
  if (aSignaler.length === 0 && dejaVues.length === 0) return null
  const ids = aSignaler.map((e) => e.id)
  const refus = refusDeMarquerVues({ dossierId, lecture, ids })

  async function marquerVues() {
    if (marquageEnCours.current) return
    if (refusDeMarquerVues({ dossierId, lecture, ids }) !== null) return
    marquageEnCours.current = true
    setEnCours(true)
    try {
      const { error } = await supabase.rpc('marquer_pieces_jointes_vues', { p_dossier_id: dossierId, p_ids: ids })
      setErreur(error ? `Elles n’ont pas pu être marquées vues : ${messageErreur(error, 'raison inconnue')}` : null)
      await relire()
    } finally {
      marquageEnCours.current = false
      setEnCours(false)
    }
  }

  const historique = dejaVues.length > 0 && (
    <details className="pieces-jointes-ecartees-vues">
      <summary>
        {dejaVues.length === 1 ? '1 pièce jointe écartée déjà vue' : `${dejaVues.length} pièces jointes écartées déjà vues`}
      </summary>
      <ul>
        {dejaVues.map((e) => <li key={e.id}>{phraseDeLaLigneVue(e)}</li>)}
      </ul>
    </details>
  )

  if (aSignaler.length === 0) return <div className="pieces-jointes-ecartees-seules">{historique}</div>

  return (
    <section className="card pieces-jointes-ecartees" aria-label="Pièces jointes écartées à la réception par e-mail">
      <h3>{titreDuSignalement(aSignaler.length)}</h3>
      <ul className="pieces-jointes-ecartees-liste">
        {aSignaler.map((e) => (
          <li key={e.id}><span className="pieces-jointes-ecartees-quand">{quandRecue(e.recue_le)}</span> — {phraseDeLaRaison(e)}</li>
        ))}
      </ul>
      <p>{ceQueLeCabinetPeutFaire(aSignaler.length)}</p>
      {erreur && <p className="error-text" role="alert">{erreur}</p>}
      <div className="pieces-jointes-ecartees-actions">
        <button type="button" className="btn btn-outline btn-sm" disabled={enCours || refus !== null} onClick={marquerVues}>
          {enCours ? 'Enregistrement…' : libelleDuGeste(aSignaler.length)}
        </button>
        <span className="muted">{refus ?? CE_QUE_FAIT_LA_MARQUE}</span>
      </div>
      {historique}
    </section>
  )
}
