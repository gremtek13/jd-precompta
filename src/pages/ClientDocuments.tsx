import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { messageErreur } from '../lib/messageErreur'
import { formatDate } from '../lib/format'
import { ouvrirApercu } from '../lib/apercu'
import { pourLEspace } from '../lib/espaceVentes'
import {
  natureDite, PRESENTATION_DE_MES_DOCUMENTS, SANS_LA_CASE_DOCUMENTS, type DocumentDuCabinet,
} from '../lib/documentsEtDemandesVue'
import { lireMesDocuments, type MesDocumentsLus } from '../lib/documentsEtDemandesLecture'
import BandeauLecturePartielle from '../components/BandeauLecturePartielle'

// « MES DOCUMENTS » (espace client, ligne 51.5, étape B3a ; la base : B2). L'écran du client qui porte la case
// « Documents » sur la société AFFICHÉE : les documents que son cabinet lui a publiés (la RLS ne lui rend que ceux-là, non
// retirés). Un seul geste : ouvrir, qui date sa première lecture (`marquer_document_lu` — la preuve de la mise à
// disposition ; les ouvertures suivantes ne la changent pas).
//
// LA CASE SE LIT DEUX FOIS (lib/documentsEtDemandesLecture.ts) : à la connexion pour la route, puis à la BASE avec les
// documents. RIEN N'EST AFFIRMÉ SUR UNE LECTURE ABSENTE, EN COURS OU PARTIELLE : « Chargement… » avant le retour ; une liste
// lue en partie ne montre aucun document ; « aucun document » ne se dit que d'une liste lue en entier. Le verrou `useRef`
// tient l'ouverture et sa datation, relâché après la relecture.

export default function ClientDocuments() {
  const { dossierActifId } = useAuth()
  const dossierId = dossierActifId
  const [lecture, setLecture] = useState<MesDocumentsLus | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const ouvertureEnCours = useRef(false)
  const [occupe, setOccupe] = useState(false)
  const derniereLecture = useRef(0)

  useEffect(() => {
    if (!dossierId) return
    // La coque remonte l'écran à chaque changement de société (`<Outlet key>`) ; une réponse arrivée après coup ne s'écrit pas.
    let annule = false
    const numero = ++derniereLecture.current
    lireMesDocuments(dossierId).then((l) => { if (!annule && numero === derniereLecture.current) setLecture(l) })
    return () => { annule = true }
  }, [dossierId])

  async function relire(id: string) {
    const numero = ++derniereLecture.current
    const l = await lireMesDocuments(id)
    if (numero === derniereLecture.current) setLecture(l)
  }

  async function ouvrir(document: DocumentDuCabinet) {
    if (ouvertureEnCours.current || !dossierId) return
    ouvertureEnCours.current = true
    setOccupe(true)
    setMessage(null)
    try {
      const ouvert = await ouvrirApercu('documents-cabinet', document.chemin, 300)
      if (!ouvert.ok) {
        setMessage(ouvert.message)
        return
      }
      const { error } = await supabase.rpc('marquer_document_lu', { p_document_id: document.id })
      if (error) {
        setMessage(pourLEspace('client', `Le document s’est ouvert, mais ton ouverture n’a pas pu se dater : ${messageErreur(error, 'refus de la base.')}`))
      }
    } finally {
      await relire(dossierId)
      ouvertureEnCours.current = false
      setOccupe(false)
    }
  }

  const lue = lecture !== null && lecture.dossierId === dossierId ? lecture : null
  const documents = lue?.etat === 'lus' && lue.documents.complete
    ? [...lue.documents.lignes].filter((d) => d.retire_le === null).reverse() : null
  const ouvertLe = (id: string) => (lue?.etat === 'lus' && lue.lectures.complete
    ? lue.lectures.lignes.find((l) => l.document_id === id)?.lu_le ?? null : null)

  return (
    <>
      <div className="topbar"><h1>Mes documents</h1></div>
      <p className="muted" style={{ marginTop: 0 }}>{PRESENTATION_DE_MES_DOCUMENTS}</p>
      {lue === null ? (
        <p className="muted">Chargement…</p>
      ) : lue.etat === 'echec' ? (
        <p className="error-text">Tes documents ne s’affichent pas : {lue.motif}. Recharge la page.</p>
      ) : lue.etat === 'sans_documents' ? (
        <p className="muted">{SANS_LA_CASE_DOCUMENTS}</p>
      ) : documents === null ? (
        <BandeauLecturePartielle quoi="Les documents que ton cabinet t’a publiés" accord="lus" motif={lue.documents.motif}
          technique={false} consequence="Aucun ne s’affiche : l’un d’eux pourrait manquer. Recharge la page." />
      ) : (
        <>
          {message && <p className="error-text" role="alert">{message}</p>}
          {documents.length === 0 ? (
            <p className="muted">Ton cabinet ne t’a publié aucun document pour l’instant.</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 10 }}>
              {documents.map((d) => {
                const le = ouvertLe(d.id)
                return (
                  <li key={d.id} className="card" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                    <div style={{ flex: '1 1 220px' }}>
                      <strong>{d.titre}</strong>
                      <div className="muted">
                        {natureDite(d.nature)}{d.exercice !== null && `, exercice ${d.exercice}`} · publié le {formatDate(d.publie_le)}
                        {le !== null && ` · ouvert le ${formatDate(le)}`}
                      </div>
                    </div>
                    <button type="button" className="btn btn-outline btn-sm" disabled={occupe} onClick={() => { void ouvrir(d) }}>
                      Ouvrir
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}
    </>
  )
}
