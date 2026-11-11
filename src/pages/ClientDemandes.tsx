import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { messageErreur } from '../lib/messageErreur'
import { aujourdHuiAParis, formatDate } from '../lib/format'
import { pourLEspace } from '../lib/espaceVentes'
import { LIBELLE_TEXTE_DE_LA_REPONSE, MOTS_DE_L_ETAT, refusDeLaReponse, type EtatDUneDemande } from '../lib/documentsEtDemandes'
import {
  attenduDit, auteurDitAuClient, demandesDites, depotsCitables, derniereRelanceDiteAuClient, fichierDeLaReponseDit,
  PRESENTATION_DE_MES_DEMANDES,
} from '../lib/documentsEtDemandesVue'
import { lireMesDemandes, type MesDemandesLues } from '../lib/documentsEtDemandesLecture'
import BandeauLecturePartielle from '../components/BandeauLecturePartielle'

// « MES DEMANDES » (espace client, ligne 51.5, étape B3a ; la base : B2). À TOUT accès du dossier, sans case (MEG2-Q9) :
// ce que son cabinet lui demande, l'état de chaque demande (déduit), les relances, les réponses déjà envoyées — et sa
// réponse : un texte, un dépôt qu'il a fait par le chemin d'aujourd'hui (« Mes pièces ») depuis l'ouverture de la demande,
// ou les deux (`repondre_a_la_demande`). Une réponse ne se modifie pas ; une autre peut suivre tant que la demande est
// ouverte.
//
// RIEN N'EST AFFIRMÉ NI OFFERT SUR UNE LECTURE ABSENTE OU PARTIELLE : demandes, réponses et relances lues en entier, sinon
// aucune demande ne s'affiche ; ses dépôts lus en entier, sinon aucun n'est proposé (le texte reste). Le refus du module se
// dit avant le clic, réécrit pour le client ; ce que seule la base sait (le dépôt est-il bien le sien) se dit après. Un
// verrou `useRef`, relâché après la relecture.

const BADGE: Readonly<Record<EtatDUneDemande, string>> = {
  ouverte: 'badge-ok', repondue: 'badge-neutral', en_retard: 'badge-warning', close: 'badge-neutral',
}

interface Saisie { texte: string; depot: string }
const SAISIE_VIDE: Saisie = { texte: '', depot: '' }

export default function ClientDemandes() {
  const { dossierActifId, session } = useAuth()
  const dossierId = dossierActifId
  const moi = session?.user.id ?? null
  const [lecture, setLecture] = useState<MesDemandesLues | null>(null)
  const [saisies, setSaisies] = useState<Record<string, Saisie>>({})
  const [message, setMessage] = useState<{ demande: string; genre: 'ok' | 'erreur'; texte: string } | null>(null)
  const envoiEnCours = useRef(false)
  const [occupe, setOccupe] = useState(false)
  const derniereLecture = useRef(0)

  useEffect(() => {
    if (!dossierId || !moi) return
    // La coque remonte l'écran à chaque changement de société (`<Outlet key>`) ; une réponse arrivée après coup ne s'écrit pas.
    let annule = false
    const numero = ++derniereLecture.current
    lireMesDemandes(dossierId, moi).then((l) => { if (!annule && numero === derniereLecture.current) setLecture(l) })
    return () => { annule = true }
  }, [dossierId, moi])

  async function relire(id: string, compte: string) {
    const numero = ++derniereLecture.current
    const l = await lireMesDemandes(id, compte)
    if (numero === derniereLecture.current) setLecture(l)
  }

  const lue = lecture !== null && lecture.dossierId === dossierId ? lecture : null
  const entiere = lue !== null && lue.demandes.complete && lue.reponses.complete && lue.relances.complete
  const depotsLus = lue !== null && lue.pieces.complete && lue.documentsDivers.complete
  const dites = entiere ? demandesDites(lue.demandes.lignes, lue.reponses.lignes, lue.relances.lignes, aujourdHuiAParis()) : []

  /** La réponse telle qu'elle partira : un texte vide n'est pas un texte ; le dépôt choisi, pièce ou document. */
  function reponseDe(s: Saisie) {
    const [genre, id] = s.depot === '' ? [null, null] : s.depot.split(':')
    return {
      texte: s.texte.trim() === '' ? null : s.texte,
      pieceId: genre === 'piece' ? id : null,
      documentId: genre === 'document' ? id : null,
    }
  }

  async function repondre(demandeId: string, s: Saisie) {
    if (envoiEnCours.current || !dossierId || !moi) return
    envoiEnCours.current = true
    setOccupe(true)
    setMessage(null)
    try {
      const r = reponseDe(s)
      const { error } = await supabase.rpc('repondre_a_la_demande', {
        p_demande_id: demandeId, p_texte: r.texte, p_piece_id: r.pieceId, p_document_id: r.documentId,
      })
      if (error) {
        setMessage({ demande: demandeId, genre: 'erreur', texte: pourLEspace('client', `Ta réponse n’est pas partie : ${messageErreur(error, 'refus de la base.')}`) })
      } else {
        setMessage({ demande: demandeId, genre: 'ok', texte: 'Ta réponse est envoyée à ton cabinet.' })
        setSaisies((tout) => ({ ...tout, [demandeId]: SAISIE_VIDE }))
      }
    } finally {
      await relire(dossierId, moi)
      envoiEnCours.current = false
      setOccupe(false)
    }
  }

  return (
    <>
      <div className="topbar"><h1>Mes demandes</h1></div>
      <p className="muted" style={{ marginTop: 0 }}>{PRESENTATION_DE_MES_DEMANDES}</p>
      {lue === null ? (
        <p className="muted">Chargement…</p>
      ) : !entiere ? (
        <BandeauLecturePartielle quoi="Les demandes de ton cabinet" accord="lues" technique={false}
          motif={lue.demandes.motif ?? lue.reponses.motif ?? lue.relances.motif}
          consequence="Aucune ne s’affiche : l’une d’elles, ou une réponse, pourrait manquer. Recharge la page." />
      ) : dites.length === 0 ? (
        <p className="muted">Ton cabinet ne t’a fait aucune demande pour l’instant.</p>
      ) : (
        <>
          <BandeauLecturePartielle quoi="Tes dépôts" accord="lus" technique={false}
            motif={lue.pieces.motif ?? lue.documentsDivers.motif}
            consequence="Aucun ne se joint à une réponse d’ici ; ton texte, lui, peut partir. Recharge la page." />
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 10 }}>
            {dites.map(({ demande, etat, reponses, relances }) => {
              const close = demande.close_le !== null
              const s = saisies[demande.id] ?? SAISIE_VIDE
              const refus = refusDeLaReponse(reponseDe(s), close)
              const citables = depotsLus && moi !== null
                ? depotsCitables(demande, lue.pieces.lignes, lue.documentsDivers.lignes, lue.reponses.lignes, moi) : []
              const derniere = relances.length > 0 ? relances[relances.length - 1] : null
              return (
                <li key={demande.id} className="card" aria-label={`Demande « ${demande.objet} »`}>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <strong>{demande.objet}</strong>
                    <span className={`badge ${BADGE[etat]}`}>{MOTS_DE_L_ETAT[etat]}</span>
                  </div>
                  <p className="muted" style={{ margin: '4px 0' }}>
                    Le {formatDate(demande.ouverte_le)} · ton cabinet attend : {attenduDit(demande.attendu).toLowerCase()}
                    {demande.echeance !== null && ` · avant le ${formatDate(demande.echeance)}`}
                    {derniere !== null && ` · ${derniereRelanceDiteAuClient(derniere)}`}
                  </p>
                  {demande.detail !== null && <p style={{ margin: '4px 0', whiteSpace: 'pre-wrap' }}>{demande.detail}</p>}
                  {reponses.length > 0 && (
                    <ul style={{ margin: '6px 0', paddingLeft: 16 }}>
                      {reponses.map((r) => {
                        const joint = fichierDeLaReponseDit(r, null)
                        return (
                          <li key={r.id}>
                            {moi !== null ? auteurDitAuClient(r.auteur, moi) : 'Un accès de ton dossier'}, le {formatDate(r.ecrite_le)}
                            {r.texte !== null && <> : <span style={{ whiteSpace: 'pre-wrap' }}>{r.texte}</span></>}
                            {joint !== null && <> <span className="muted">{joint}</span></>}
                          </li>
                        )
                      })}
                    </ul>
                  )}
                  {close ? (
                    <p className="muted" style={{ margin: '4px 0' }}>Cette demande est close : ton cabinet n’attend plus de réponse.</p>
                  ) : (
                    <div style={{ marginTop: 6 }}>
                      <label style={{ display: 'block' }}>
                        {LIBELLE_TEXTE_DE_LA_REPONSE}
                        <textarea rows={3} maxLength={4000} value={s.texte} disabled={occupe}
                          onChange={(e) => setSaisies((tout) => ({ ...tout, [demande.id]: { ...s, texte: e.target.value } }))} />
                      </label>
                      <div className="field-row aligne-bas" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                        <label style={{ flex: '1 1 240px' }}>
                          Fichier à joindre (déposé dans « Mes pièces » depuis cette demande)
                          <select value={s.depot} disabled={occupe || !depotsLus}
                            onChange={(e) => setSaisies((tout) => ({ ...tout, [demande.id]: { ...s, depot: e.target.value } }))}>
                            <option value="">{citables.length === 0 && depotsLus ? 'Aucun dépôt à joindre' : 'Aucun'}</option>
                            {citables.map((c) => (
                              <option key={`${c.genre}:${c.id}`} value={`${c.genre}:${c.id}`}>
                                {c.nom_fichier} (déposé le {formatDate(c.created_at)})
                              </option>
                            ))}
                          </select>
                        </label>
                        <button type="button" className="btn btn-primary" disabled={occupe || refus !== null}
                          title={refus === null ? undefined : pourLEspace('client', refus)}
                          onClick={() => { void repondre(demande.id, s) }}>
                          Envoyer ma réponse
                        </button>
                      </div>
                      {(s.texte !== '' || s.depot !== '') && refus !== null && (
                        <p className="error-text">{pourLEspace('client', refus)}</p>
                      )}
                    </div>
                  )}
                  {message !== null && message.demande === demande.id && (message.genre === 'ok'
                    ? <p role="status">{message.texte}</p>
                    : <p className="error-text" role="alert">{message.texte}</p>)}
                </li>
              )
            })}
          </ul>
        </>
      )}
    </>
  )
}
