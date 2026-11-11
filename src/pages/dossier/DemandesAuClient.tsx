import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { messageErreur } from '../../lib/messageErreur'
import { aujourdHuiAParis, formatDate } from '../../lib/format'
import { ouvrirApercu } from '../../lib/apercu'
import {
  CE_QU_ATTEND_UNE_DEMANDE, LIBELLE_DETAIL_DE_LA_DEMANDE, LIBELLE_OBJET_DE_LA_DEMANDE, MOTIFS_DE_CLOTURE, MOTS_DE_L_ETAT,
  refusDeLaCloture, refusDeLaDemande, type EtatDUneDemande,
} from '../../lib/documentsEtDemandes'
import {
  attenduDit, confirmationDeLaCloture, demandesDites, fichierDeLaReponseDit, motifDit, type DemandeDuCabinet,
} from '../../lib/documentsEtDemandesVue'
import { lireLesDemandesDuCabinet, type DemandesDuCabinetLues } from '../../lib/documentsEtDemandesLecture'
import BandeauLecturePartielle from '../../components/BandeauLecturePartielle'
import ConfirmationArticle from './ConfirmationArticle'

// « DEMANDES AU CLIENT » (espace client, ligne 51.5, étape B3a ; la base : B2). Dans l'onglet des documents administratifs,
// sous `DOCUMENTS_ET_DEMANDES_PREVUS` : le cabinet ouvre une demande (un objet, une échéance, ce qu'il attend), la relance
// — à l'écran du client seulement : la relance par e-mail est l'étape B3b —, la clôt par un motif de la liste fermée
// (B2-Q1 ; une demande ne se modifie pas, elle se clôt « remplacée », B2-Q4), et lit les réponses et ce qu'elles joignent.
//
// L'ÉTAT D'UNE DEMANDE SE DÉDUIT, et seulement de listes lues en entier (demandes, réponses, relances) : sinon aucune n'est
// montrée et aucun geste n'est offert. Les refus se disent avant le clic, aux mots de la base. Un seul verrou `useRef` pour
// les trois gestes, relâché après la relecture.

const BADGE: Readonly<Record<EtatDUneDemande, string>> = {
  ouverte: 'badge-ok', repondue: 'badge-neutral', en_retard: 'badge-warning', close: 'badge-neutral',
}

export default function DemandesAuClient({ dossierId }: { dossierId: string }) {
  const [lecture, setLecture] = useState<DemandesDuCabinetLues | null>(null)
  const [objet, setObjet] = useState('')
  const [detail, setDetail] = useState('')
  const [echeance, setEcheance] = useState('')
  const [attendu, setAttendu] = useState<string>('fichier')
  const [motifs, setMotifs] = useState<Record<string, string>>({})
  const [aClore, setAClore] = useState<{ demande: DemandeDuCabinet; motif: string } | null>(null)
  const [message, setMessage] = useState<{ genre: 'ok' | 'erreur'; texte: string } | null>(null)
  const gesteEnCours = useRef(false)
  const [occupe, setOccupe] = useState(false)
  const derniereLecture = useRef(0)

  async function relire() {
    const numero = ++derniereLecture.current
    const l = await lireLesDemandesDuCabinet(dossierId)
    if (numero === derniereLecture.current) setLecture(l)
  }

  useEffect(() => {
    let annule = false
    const numero = ++derniereLecture.current
    lireLesDemandesDuCabinet(dossierId).then((l) => {
      if (!annule && numero === derniereLecture.current) setLecture(l)
    })
    return () => { annule = true }
  }, [dossierId])

  const lue = lecture !== null && lecture.dossierId === dossierId ? lecture : null
  const entiere = lue !== null && lue.demandes.complete && lue.reponses.complete && lue.relances.complete
  const aujourdhui = aujourdHuiAParis()
  const saisie = { objet, detail: detail.trim() === '' ? null : detail, echeance: echeance === '' ? null : echeance, attendu }
  const refusDeLaSaisie = lue === null ? null
    : !entiere ? 'Les demandes du dossier ne sont pas lues en entier : rien ne s’ouvre, ne se relance ni ne se clôt.'
      : refusDeLaDemande(saisie, aujourdhui)
  const dites = entiere ? demandesDites(lue.demandes.lignes, lue.reponses.lignes, lue.relances.lignes, aujourdhui) : []
  const nomDuDepot = (genre: 'piece' | 'document', id: string | null) => {
    if (id === null || lue === null) return null
    const lus = genre === 'piece' ? lue.pieces : lue.documentsDivers
    return lus.complete ? lus.lignes.find((x) => x.id === id) ?? null : null
  }

  // Les trois gestes partagent un verrou : posé avant l'appel, relâché après la relecture. Chacun dit son refus.
  function commencer() {
    setOccupe(true)
    setMessage(null)
  }
  async function terminer() {
    await relire()
    setAClore(null)
    setOccupe(false)
  }
  const dire = (error: unknown, reussi: string, rate: string) => setMessage(error
    ? { genre: 'erreur', texte: `${rate} : ${messageErreur(error, 'refus de la base.')}` }
    : { genre: 'ok', texte: reussi })

  async function ouvrirLaDemande() {
    if (gesteEnCours.current) return
    gesteEnCours.current = true
    commencer()
    try {
      const { error } = await supabase.rpc('ouvrir_demande', {
        p_dossier_id: dossierId, p_objet: saisie.objet, p_detail: saisie.detail, p_echeance: saisie.echeance, p_attendu: saisie.attendu,
      })
      dire(error, `La demande « ${saisie.objet} » est ouverte : tous les accès du dossier la lisent.`, 'La demande n’a pas été ouverte')
      if (!error) { setObjet(''); setDetail(''); setEcheance('') }
    } finally {
      await terminer()
      gesteEnCours.current = false
    }
  }

  async function relancer(demande: DemandeDuCabinet) {
    if (gesteEnCours.current) return
    gesteEnCours.current = true
    commencer()
    try {
      const { error } = await supabase.rpc('relancer_demande', { p_demande_id: demande.id })
      dire(error, `La demande « ${demande.objet} » est relancée dans l’espace du client.`, 'La demande n’a pas été relancée')
    } finally {
      await terminer()
      gesteEnCours.current = false
    }
  }

  async function clore(demande: DemandeDuCabinet, motif: string) {
    if (gesteEnCours.current) return
    gesteEnCours.current = true
    commencer()
    try {
      const { error } = await supabase.rpc('clore_demande', { p_demande_id: demande.id, p_motif: motif })
      dire(error, `La demande « ${demande.objet} » est close (${motifDit(motif)}).`, 'La demande n’a pas été close')
    } finally {
      await terminer()
      gesteEnCours.current = false
    }
  }

  // Une pièce comme un document du dossier vivent dans le seau des pièces (l'onglet Documents les ouvre de même).
  async function ouvrirLeDepot(chemin: string) {
    const resultat = await ouvrirApercu('pieces', chemin, 300)
    if (!resultat.ok) setMessage({ genre: 'erreur', texte: resultat.message })
  }

  const fenetre = aClore === null ? null : confirmationDeLaCloture(aClore.demande, aClore.motif)

  return (
    <section style={{ marginTop: 24 }} aria-labelledby="demandes-au-client-titre">
      <h3 id="demandes-au-client-titre" style={{ marginBottom: 4 }}>Demandes au client</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        Tous les accès du dossier lisent les demandes, avec ou sans la case « Documents », et y répondent depuis leur espace :
        un texte, un fichier qu’ils ont déposé, ou les deux. Une demande ne se modifie pas : pour la changer, clos-la
        « remplacée » et ouvre-en une autre. La relance se lit dans l’espace du client, sans e-mail.
      </p>
      {lue === null ? (
        <p className="muted">Chargement…</p>
      ) : (
        <>
          <BandeauLecturePartielle quoi="Les demandes" accord="lues" motif={lue.demandes.motif}
            consequence="Aucune ne s’affiche, et rien ne s’ouvre ni ne se clôt : recharge la page." />
          <BandeauLecturePartielle quoi="Les réponses" accord="lues" motif={lue.reponses.motif}
            consequence="L’état des demandes ne se déduit pas, et rien ne s’ouvre ni ne se clôt : recharge la page." />
          <BandeauLecturePartielle quoi="Les relances" accord="lues" motif={lue.relances.motif}
            consequence="Aucune demande ne s’affiche : recharge la page." />
          {lue.reponses.complete && (
            <>
              <BandeauLecturePartielle quoi="Les pièces jointes aux réponses" accord="lues" motif={lue.pieces.motif}
                consequence="Elles ne s’ouvrent pas d’ici : recharge la page." />
              <BandeauLecturePartielle quoi="Les documents joints aux réponses" accord="lus" motif={lue.documentsDivers.motif}
                consequence="Ils ne s’ouvrent pas d’ici : recharge la page." />
            </>
          )}
          <div className="field-row aligne-bas" style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <label style={{ flex: '2 1 240px' }}>
              {LIBELLE_OBJET_DE_LA_DEMANDE}
              <input type="text" value={objet} maxLength={200} disabled={occupe} onChange={(e) => setObjet(e.target.value)} />
            </label>
            <label style={{ flex: '1 1 160px' }}>
              Ce que tu attends
              <select value={attendu} disabled={occupe} onChange={(e) => setAttendu(e.target.value)}>
                {Object.entries(CE_QU_ATTEND_UNE_DEMANDE).map(([valeur, mots]) => <option key={valeur} value={valeur}>{mots}</option>)}
              </select>
            </label>
            <label style={{ flex: '0 1 160px' }}>
              Échéance (facultative)
              <input type="date" value={echeance} min={aujourdhui} disabled={occupe} onChange={(e) => setEcheance(e.target.value)} />
            </label>
          </div>
          <label style={{ display: 'block', marginTop: 8 }}>
            {LIBELLE_DETAIL_DE_LA_DEMANDE}
            <textarea value={detail} maxLength={4000} rows={3} disabled={occupe} onChange={(e) => setDetail(e.target.value)} />
          </label>
          {objet !== '' && refusDeLaSaisie && <p className="error-text">{refusDeLaSaisie}</p>}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', margin: '8px 0 12px' }}>
            <button type="button" className="btn btn-primary" disabled={occupe || refusDeLaSaisie !== null}
              title={refusDeLaSaisie ?? undefined} onClick={() => { void ouvrirLaDemande() }}>
              Ouvrir la demande
            </button>
          </div>
          {message && (message.genre === 'ok'
            ? <p role="status">{message.texte}</p>
            : <p className="error-text" role="alert">{message.texte}</p>)}
          {entiere && (dites.length === 0 ? (
            <p className="muted">Aucune demande n’est ouverte à ce dossier.</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 10 }}>
              {dites.map(({ demande, etat, reponses, relances }) => {
                const motif = motifs[demande.id] ?? 'satisfaite'
                const refusDeClore = refusDeLaCloture(motif, demande.close_le !== null)
                return (
                  <li key={demande.id} className="card" aria-label={`Demande « ${demande.objet} »`}>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      <strong>{demande.objet}</strong>
                      <span className={`badge ${BADGE[etat]}`}>{MOTS_DE_L_ETAT[etat]}</span>
                    </div>
                    <p className="muted" style={{ margin: '4px 0' }}>
                      Ouverte le {formatDate(demande.ouverte_le)} · {attenduDit(demande.attendu)}
                      {demande.echeance !== null && ` · échéance le ${formatDate(demande.echeance)}`}
                      {relances.length > 0 && ` · relancée ${relances.length} fois, la dernière le ${formatDate(relances[relances.length - 1].relancee_le)}`}
                      {demande.close_le !== null && ` · close le ${formatDate(demande.close_le)} (${motifDit(demande.motif_de_cloture)})`}
                    </p>
                    {demande.detail !== null && <p style={{ margin: '4px 0', whiteSpace: 'pre-wrap' }}>{demande.detail}</p>}
                    {reponses.length > 0 && (
                      <ul style={{ margin: '6px 0', paddingLeft: 16 }}>
                        {reponses.map((r) => {
                          const genre = r.fichier === 'document' ? 'document' : 'piece'
                          const depot = nomDuDepot(genre, genre === 'piece' ? r.piece_id : r.document_id)
                          const joint = fichierDeLaReponseDit(r, depot?.nom_fichier ?? null)
                          return (
                            <li key={r.id}>
                              Réponse du {formatDate(r.ecrite_le)}
                              {r.texte !== null && <> : <span style={{ whiteSpace: 'pre-wrap' }}>{r.texte}</span></>}
                              {joint !== null && <> <span className="muted">{joint}</span></>}
                              {depot !== null && (
                                <> <button type="button" className="btn btn-outline btn-sm"
                                  onClick={() => { void ouvrirLeDepot(depot.storage_path) }}>Ouvrir</button></>
                              )}
                            </li>
                          )
                        })}
                      </ul>
                    )}
                    {demande.close_le === null && (
                      <div className="field-row aligne-bas" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                        <button type="button" className="btn btn-outline btn-sm" disabled={occupe}
                          onClick={() => { void relancer(demande) }}>
                          Relancer à l’écran
                        </button>
                        <label>
                          Motif de clôture
                          <select value={motif} disabled={occupe}
                            onChange={(e) => setMotifs((m) => ({ ...m, [demande.id]: e.target.value }))}>
                            {Object.entries(MOTIFS_DE_CLOTURE).map(([valeur, mots]) => <option key={valeur} value={valeur}>{mots}</option>)}
                          </select>
                        </label>
                        <button type="button" className="btn btn-outline btn-sm" disabled={occupe || refusDeClore !== null}
                          title={refusDeClore ?? undefined} onClick={() => setAClore({ demande, motif })}>
                          Clore
                        </button>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          ))}
        </>
      )}
      {aClore && fenetre && (
        <ConfirmationArticle
          titre={fenetre.titre} boutonLabel={fenetre.bouton} occupe={occupe} refus={null} erreur={null}
          onConfirmer={() => { void clore(aClore.demande, aClore.motif) }}
          onAnnuler={() => setAClore(null)}
        >
          {fenetre.paragraphes.map((p) => <p key={p}>{p}</p>)}
        </ConfirmationArticle>
      )}
    </section>
  )
}
