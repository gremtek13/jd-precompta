import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { aujourdHuiAParis, formatDate } from '../lib/format'
import { telechargerUnPdf } from '../lib/apercu'
import { pdfDeLaLettre } from '../lib/pdfLettreDeMission'
import { LIBELLE_MISSION, libelleDesHonoraires } from '../lib/lettresDeMissionVue'
import {
  COMMENT_ACCEPTER, etatEnMots, etatPourLeClient, pdfDeLaLettreDuClient, quiSigne, type LettreDuClient,
} from '../lib/lettresDuClient'
import { lireLesLettresDuClient, type LettresDuClientLues } from '../lib/lettresDuClientLecture'

// « MES LETTRES DE MISSION » (espace client, ligne 47, étape LM6 ; la base : `lettres_du_client`). L'écran du client qui
// porte la case « Documents » sur la société AFFICHÉE : les lettres de mission que son cabinet lui a PROPOSÉES, telles
// qu'elles se sont figées — missions, tâches, honoraires, durée —, leur état, et leur PDF, tiré des seules valeurs figées
// par la mise en page du cabinet et refusé d'une lettre dont la base n'a pas retrouvé l'empreinte.
//
// AUCUN GESTE N'ÉCRIT : l'acceptation en ligne reste fermée (LM-Q10) ; l'écran dit comment accepter hors ligne. RIEN N'EST
// AFFIRMÉ SUR UNE LECTURE ABSENTE, EN COURS, REFUSÉE OU ILLISIBLE : « Chargement… » avant le retour ; « aucune lettre » ne se
// dit que d'une valeur lue entière. Le téléchargement passe un verrou `useRef` (rien ne s'écrit, mais deux clics ne tirent
// pas deux PDF).

export default function ClientLettresDeMission() {
  const { dossierActifId } = useAuth()
  const dossierId = dossierActifId
  const [lecture, setLecture] = useState<LettresDuClientLues | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const telechargement = useRef(false)
  const [occupe, setOccupe] = useState(false)

  useEffect(() => {
    if (!dossierId) return
    // La coque remonte l'écran à chaque changement de société (`<Outlet key>`) ; une réponse arrivée après coup ne s'écrit pas.
    let annule = false
    void lireLesLettresDuClient(dossierId).then((l) => { if (!annule) setLecture(l) })
    return () => { annule = true }
  }, [dossierId])

  const lue = lecture !== null && lecture.dossierId === dossierId ? lecture : null

  async function telecharger(l: LettreDuClient) {
    if (telechargement.current) return
    telechargement.current = true
    setOccupe(true)
    setMessage(null)
    try {
      const pdf = pdfDeLaLettreDuClient(l)
      if (!pdf.ok) { setMessage(pdf.message); return }
      const octets = await pdfDeLaLettre(pdf.blocs, { empreinte: pdf.empreinte, instant: pdf.instant })
      const issue = telechargerUnPdf(octets, pdf.nom)
      if (!issue.ok) setMessage(issue.message)
    } catch {
      setMessage('Le PDF n’a pas pu être tiré : réessaie, ou demande la lettre à ton cabinet.')
    } finally {
      telechargement.current = false
      setOccupe(false)
    }
  }

  const aujourdhui = aujourdHuiAParis()
  return (
    <div className="page">
      <h1>Mes lettres de mission</h1>
      <p className="texte-discret">
        Les lettres de mission que ton cabinet t’a proposées : ce qu’il fait pour toi, ce qui reste de ton côté, ses honoraires
        et leur durée, telles qu’elles ont été figées à la proposition.
      </p>
      {message && <p className="message-erreur" role="alert">{message}</p>}
      {!dossierId ? null : lue === null ? (
        <p>Chargement…</p>
      ) : lue.etat === 'refusee' ? (
        <p className="message-erreur">Tes lettres de mission ne te sont pas ouvertes : {lue.motif}</p>
      ) : lue.etat === 'illisible' ? (
        <p className="message-erreur">Tes lettres de mission n’ont pas pu être lues : {lue.motif}. Rien n’est dit d’ici.</p>
      ) : lue.lettres.length === 0 ? (
        <p>Ton cabinet ne t’a proposé aucune lettre de mission.</p>
      ) : (
        [...lue.lettres].reverse().map((l) => {
          const etat = etatPourLeClient(l, lue.lettres, aujourdhui)
          return (
            <section key={l.id} className="carte" aria-label={`Lettre proposée le ${formatDate(l.proposee_le)}`}>
              <h2>Lettre proposée le {formatDate(l.proposee_le)}</h2>
              <p><strong>{etatEnMots(l, etat)}</strong></p>
              <p>Missions : {l.missions.map((m) => LIBELLE_MISSION[m]).join(', ')}</p>
              <ul>{l.honoraires.map((h, i) => <li key={i}>{libelleDesHonoraires(h)}</li>)}</ul>
              <p>
                Effet au {formatDate(l.date_effet)}, première période jusqu’au {formatDate(l.fin_initiale)}
                {l.reconduction_tacite ? ', reconduite tacitement' : ', sans reconduction tacite'} ; préavis de {l.preavis_mois} mois.
              </p>
              {etat === 'proposee' && (
                <div className="encart">
                  <p>{COMMENT_ACCEPTER}</p>
                  <p>{quiSigne(l)}</p>
                </div>
              )}
              <div className="field-row">
                <button type="button" className="btn btn-secondary" disabled={occupe} onClick={() => void telecharger(l)}>
                  Télécharger la lettre (PDF)
                </button>
                <span className="texte-discret">Empreinte {l.empreinte.slice(0, 12)}…</span>
              </div>
            </section>
          )
        })
      )}
    </div>
  )
}
