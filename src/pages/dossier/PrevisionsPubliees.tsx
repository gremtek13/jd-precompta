import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { messageErreur } from '../../lib/messageErreur'
import { aujourdHuiAParis, formatDate } from '../../lib/format'
import { moisEnLettres } from '../../lib/echeancierClient'
import {
  CE_QUE_LE_CLIENT_LIT, composerLaPrevision, confirmationDeLaPublication, confirmationDuRetrait, contenuLu, memesMois, montantDit,
  previsionEnCours, REFUS_DU_MODULE, refusDeLaLectureDuPlan, type ContenuDeLaPrevision, type EntreeDeLaPrevision,
  type PrevisionPubliee,
} from '../../lib/previsionsPubliees'
import { lireLesPrevisionsDuCabinet, type LectureDuCabinet } from '../../lib/previsionsPublieesLecture'
import BandeauLecturePartielle from '../../components/BandeauLecturePartielle'
import ConfirmationArticle from './ConfirmationArticle'

// PUBLIER LA PRÉVISION AU CLIENT (espace client, C8-Q2 ; derrière `PREVISIONS_PUBLIEES_PREVUES`). Sous le plan de trésorerie
// de l'onglet Financement, qui la calcule déjà : les mêmes écritures, les mêmes réglages de mois. Le module compose le contenu
// au jour de Paris (lib/previsionsPubliees.ts, `composerLaPrevision`), et `publier_prevision` le fige ; `retirer_prevision`
// le retire ; « Remplacer » est une nouvelle publication qui cite celle en cours.
//
// RIEN NE PART SUR UNE LECTURE ABSENTE OU PARTIELLE : les prévisions du dossier sont lues en entier, et le plan lui-même ne
// repose que sur des lectures entières (`lectureDuPlan`), sinon aucun geste. Les refus se disent avant le clic, sur le
// contenu TEL QU'IL PARTIRA ; la confirmation nomme le départ, le rythme, les mois et le solde à la fin, et dit que c'est une
// prévision ; un seul verrou `useRef` pour les deux gestes, relâché après la relecture.

type Confirmer =
  | { genre: 'publier'; contenu: ContenuDeLaPrevision; remplacee: PrevisionPubliee | null }
  | { genre: 'retirer'; prevision: PrevisionPubliee }

export default function PrevisionsPubliees({ dossierId, entree, moisAffiches, lectureDuPlan }: {
  dossierId: string
  /** Ce que le plan affiché au-dessus calcule : les mêmes écritures, les mêmes mois, sans le jour (celui de Paris). */
  entree: Omit<EntreeDeLaPrevision, 'aujourdHui'>
  /** Les mois que le plan affiché projette (AAAA-MM). */
  moisAffiches: readonly string[]
  /** Le motif d'une lecture partielle d'où le plan se calcule, ou nul : partielle, rien ne se publie. */
  lectureDuPlan: string | null
}) {
  const [lecture, setLecture] = useState<LectureDuCabinet | null>(null)
  const [confirmer, setConfirmer] = useState<Confirmer | null>(null)
  const [message, setMessage] = useState<{ genre: 'ok' | 'erreur'; texte: string } | null>(null)
  const gesteEnCours = useRef(false)
  const [occupe, setOccupe] = useState(false)
  const derniereLecture = useRef(0)

  // Une lecture plus lente écrit en dernier : seule la plus récente compte (le numéro de la dernière partie).
  async function relire() {
    const numero = ++derniereLecture.current
    const l = await lireLesPrevisionsDuCabinet(dossierId)
    if (numero === derniereLecture.current) setLecture(l)
  }

  useEffect(() => {
    let annule = false
    const numero = ++derniereLecture.current
    lireLesPrevisionsDuCabinet(dossierId).then((l) => {
      if (!annule && numero === derniereLecture.current) setLecture(l)
    })
    return () => { annule = true }
  }, [dossierId])

  const lue = lecture !== null && lecture.dossierId === dossierId ? lecture : null
  const entiere = lue !== null && lue.previsions.complete
  const enCours = entiere ? previsionEnCours(lue.previsions.lignes) : null

  // La composition, au jour de Paris : elle dit son refus, ou le contenu tel qu'il partira.
  const composition = entiere && lectureDuPlan === null ? composerLaPrevision({ ...entree, aujourdHui: aujourdHuiAParis() }) : null
  const refus = lue === null ? null
    : !entiere ? REFUS_DU_MODULE.lecture
      : lectureDuPlan !== null ? refusDeLaLectureDuPlan(lectureDuPlan)
        : composition !== null && !composition.ok ? composition.refus
          : composition !== null && composition.ok && !memesMois(composition.contenu, moisAffiches) ? REFUS_DU_MODULE.moisDifferents
            : null

  async function publier(contenu: ContenuDeLaPrevision, remplacee: PrevisionPubliee | null) {
    if (gesteEnCours.current) return
    gesteEnCours.current = true
    setOccupe(true)
    setMessage(null)
    try {
      const { error } = await supabase.rpc('publier_prevision', {
        p_dossier_id: dossierId, p_contenu: contenu, p_remplace_id: remplacee?.id ?? null,
      })
      setMessage(error
        ? { genre: 'erreur', texte: `La prévision n’a pas été publiée : ${messageErreur(error, 'refus de la base.')}` }
        : { genre: 'ok', texte: `La prévision établie le ${formatDate(contenu.etablie_le)} est publiée au client.` })
    } finally {
      await relire()
      setConfirmer(null)
      gesteEnCours.current = false
      setOccupe(false)
    }
  }

  async function retirer(prevision: PrevisionPubliee) {
    if (gesteEnCours.current) return
    gesteEnCours.current = true
    setOccupe(true)
    setMessage(null)
    try {
      const { error } = await supabase.rpc('retirer_prevision', { p_prevision_id: prevision.id })
      setMessage(error
        ? { genre: 'erreur', texte: `La prévision n’a pas été retirée : ${messageErreur(error, 'refus de la base.')}` }
        : { genre: 'ok', texte: `La prévision publiée le ${formatDate(prevision.publiee_le)} est retirée.` })
    } finally {
      await relire()
      setConfirmer(null)
      gesteEnCours.current = false
      setOccupe(false)
    }
  }

  const fenetre = confirmer === null ? null
    : confirmer.genre === 'publier' ? confirmationDeLaPublication(confirmer.contenu, confirmer.remplacee)
      : confirmationDuRetrait(confirmer.prevision)
  // La prévision en cours, relue à sa forme : son dernier mois et son solde à la fin, ou « illisible ».
  const enCoursLue = enCours ? contenuLu(enCours.contenu) : null
  const dernierMois = enCoursLue ? enCoursLue.mois[enCoursLue.mois.length - 1] : null

  return (
    <section style={{ marginTop: 16 }} aria-labelledby="previsions-publiees-titre">
      <h3 id="previsions-publiees-titre" style={{ marginBottom: 4 }}>Publier au client</h3>
      <p className="muted" style={{ marginTop: 0 }}>{CE_QUE_LE_CLIENT_LIT}</p>
      {lue === null ? (
        <p className="muted">Chargement…</p>
      ) : (
        <>
          <BandeauLecturePartielle
            quoi="Les prévisions publiées" accord="lues" motif={lue.previsions.motif}
            consequence="Rien ne se publie ni ne se retire : recharge la page."
          />
          {refus && <p className="error-text">{refus}</p>}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
            <button
              type="button" className="btn btn-primary"
              disabled={occupe || refus !== null || composition === null || !composition.ok}
              title={refus ?? undefined}
              onClick={() => {
                if (composition?.ok) setConfirmer({ genre: 'publier', contenu: composition.contenu, remplacee: enCours })
              }}
            >
              {enCours ? `Remplacer la prévision publiée le ${formatDate(enCours.publiee_le)}` : 'Publier cette prévision'}
            </button>
          </div>
          {message && (message.genre === 'ok'
            ? <p role="status">{message.texte}</p>
            : <p className="error-text" role="alert">{message.texte}</p>)}
          {entiere && (enCours === null ? (
            <p className="muted">Aucune prévision n’est publiée au client.</p>
          ) : (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <p style={{ margin: 0 }}>
                Publiée le {formatDate(enCours.publiee_le)} :{' '}
                {dernierMois
                  ? <>solde à la fin de {moisEnLettres(dernierMois.mois)}, <span style={{ whiteSpace: 'nowrap' }}>{montantDit(dernierMois.solde_fin)}</span>.</>
                  : 'illisible.'}
              </p>
              <button
                type="button" className="btn btn-outline btn-sm" disabled={occupe}
                onClick={() => setConfirmer({ genre: 'retirer', prevision: enCours })}
              >
                Retirer
              </button>
            </div>
          ))}
        </>
      )}
      {confirmer && fenetre && (
        <ConfirmationArticle
          titre={fenetre.titre} boutonLabel={fenetre.bouton} occupe={occupe} refus={null} erreur={null}
          onConfirmer={() => {
            void (confirmer.genre === 'publier' ? publier(confirmer.contenu, confirmer.remplacee) : retirer(confirmer.prevision))
          }}
          onAnnuler={() => setConfirmer(null)}
        >
          {fenetre.paragraphes.map((p) => <p key={p}>{p}</p>)}
        </ConfirmationArticle>
      )}
    </section>
  )
}
