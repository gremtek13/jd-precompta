import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { messageErreur } from '../../lib/messageErreur'
import { aujourdHuiAParis, formatDate, formatMoney } from '../../lib/format'
import { LIBELLE_MOTIF_REFUS_NOTE_DE_FRAIS } from '../../lib/droitsAcces'
import { NOTES_DE_FRAIS_PREVUES } from '../../lib/notesDeFrais'
import {
  confirmationDeLApprobation, confirmationDuRefus, confirmationDuRemboursement, detailDesKilometres, gestesDeLaNote,
  LIBELLES_DES_NATURES, MOTS_DE_L_ETAT, notesAMontrer, passagesDeLaNote, personneDiteAuCabinet, signalDeLaNote,
  type NoteDeFrais,
} from '../../lib/notesDeFraisVue'
import { lireLesNotesDeFraisDuDossier, type NotesDeFraisDuDossierLues } from '../../lib/notesDeFraisLecture'
import BandeauLecturePartielle from '../../components/BandeauLecturePartielle'
import DecisionDeLaNoteDeFrais, { type DecisionSaisie } from '../../components/DecisionDeLaNoteDeFrais'

// LES NOTES DE FRAIS DU CLIENT, CÔTÉ CABINET (espace client, ligne 51.5, étape B8 ; la base : B7). Montée par l'onglet
// Justificatifs sous `NOTES_DE_FRAIS_PREVUES` seulement : là où le cabinet valide les pièces que ces notes citent, et où vivent
// déjà les achats du client (la fiche d'une pièce d'achat, étape B5). Elle dit les notes que le client a SOUMISES et leur
// suite — un brouillon reste chez son auteur, il ne se compte qu'en nombre —, et offre, comme la base les ouvre au cabinet du
// dossier : approuver, refuser sous un motif dont le libellé dit que l'auteur le LIT, déclarer le remboursement. Chaque geste
// par sa fonction seule, à la version lue, sur une confirmation qui nomme la note, sous un verrou `useRef` relâché après la
// relecture. Rien ne s'écrit en comptabilité d'ici : l'écriture d'une note au 421 vient après. Une lecture partielle ou
// refusée le dit et n'offre aucun geste. Tous ses boutons sont `type="button"`.

const BADGE: Readonly<Record<NoteDeFrais['etat'], string>> = {
  brouillon: 'badge-neutral', soumise: 'badge-warning', approuvee: 'badge-ok', refusee: 'badge-danger', remboursee: 'badge-ok',
  retiree: 'badge-neutral',
}

export default function NotesDeFraisDuClient({ dossierId }: { dossierId: string }) {
  const [lecture, setLecture] = useState<NotesDeFraisDuDossierLues | null>(null)
  const [decision, setDecision] = useState<{ noteId: string; genre: 'refus' | 'remboursement' } | null>(null)
  const [message, setMessage] = useState<{ noteId: string; genre: 'ok' | 'erreur'; texte: string } | null>(null)
  const decisionEnCours = useRef(false)
  const [occupe, setOccupe] = useState(false)
  const derniereLecture = useRef(0)

  useEffect(() => {
    if (!NOTES_DE_FRAIS_PREVUES) return
    let annule = false
    const numero = ++derniereLecture.current
    lireLesNotesDeFraisDuDossier(dossierId).then((l) => { if (!annule && numero === derniereLecture.current) setLecture(l) })
    return () => { annule = true }
  }, [dossierId])

  if (!NOTES_DE_FRAIS_PREVUES) return null

  async function relire() {
    const numero = ++derniereLecture.current
    const l = await lireLesNotesDeFraisDuDossier(dossierId)
    if (numero === derniereLecture.current) setLecture(l)
  }

  async function agir(n: NoteDeFrais, nom: string, args: Record<string, unknown>, reussi: string, rate: string) {
    if (decisionEnCours.current) return
    decisionEnCours.current = true
    setOccupe(true)
    setMessage(null)
    try {
      const { error } = await supabase.rpc(nom, args)
      if (error) {
        setMessage({ noteId: n.id, genre: 'erreur', texte: `${rate} : ${messageErreur(error, 'refus de la base.')}` })
      } else {
        setMessage({ noteId: n.id, genre: 'ok', texte: reussi })
        setDecision(null)
      }
    } finally {
      await relire()
      decisionEnCours.current = false
      setOccupe(false)
    }
  }

  function approuver(n: NoteDeFrais) {
    if (decisionEnCours.current || !window.confirm(confirmationDeLApprobation(n))) return
    void agir(n, 'approuver_note_de_frais', { p_note_id: n.id, p_version_lue: n.version }, 'La note est approuvée.', 'La note n’est pas approuvée')
  }

  function decider(n: NoteDeFrais, d: DecisionSaisie) {
    if (decisionEnCours.current) return
    if (d.genre === 'refus') {
      if (!window.confirm(confirmationDuRefus(n, d.motif))) return
      void agir(n, 'refuser_note_de_frais', { p_note_id: n.id, p_version_lue: n.version, p_motif: d.motif },
        'La note est refusée ; son auteur lit le motif.', 'La note n’est pas refusée')
    } else {
      if (!window.confirm(confirmationDuRemboursement(n, d.date, d.moyen))) return
      void agir(n, 'rembourser_note_de_frais', { p_note_id: n.id, p_version_lue: n.version, p_date: d.date, p_moyen: d.moyen },
        'Le remboursement est déclaré.', 'Le remboursement n’est pas déclaré')
    }
  }

  const lue = lecture !== null && lecture.dossierId === dossierId ? lecture : null
  const lesNotes = lue !== null && lue.lesNotes.complete ? lue.lesNotes.lignes : null
  const justificatifs = lue !== null && lue.justificatifs.complete ? lue.justificatifs.lignes : null
  const aujourdhui = aujourdHuiAParis()

  return (
    <section className="card" aria-label="Notes de frais du client" style={{ marginBottom: 14 }}>
      <h2 style={{ marginTop: 0 }}>Notes de frais du client</h2>
      {lue === null ? (
        <p className="muted">Chargement…</p>
      ) : lesNotes === null || justificatifs === null ? (
        <BandeauLecturePartielle quoi="Les notes de frais du client" accord="lues" motif={lue.lesNotes.motif ?? lue.justificatifs.motif}
          consequence="Aucune ne se dit ni ne se décide d’ici." />
      ) : (() => {
        const montrees = notesAMontrer(lesNotes).filter((n) => n.etat !== 'brouillon')
        const brouillons = lesNotes.filter((n) => n.etat === 'brouillon').length
        return (
          <>
            {brouillons > 0 && (
              <p className="muted" style={{ marginTop: 0 }}>
                {brouillons === 1 ? 'Un brouillon est en cours' : `${brouillons} brouillons sont en cours`} chez le client : il ne se dit
                qu’une fois soumis.
              </p>
            )}
            {montrees.length === 0 ? (
              <p className="muted">Le client n’a soumis aucune note de frais.</p>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 10 }}>
                {montrees.map((n) => {
                  const gestes = gestesDeLaNote(n, { moi: '', cabinet: true, frais: false, achats: false })
                  const ouverte = decision !== null && decision.noteId === n.id ? decision : null
                  const justificatif = n.piece_id === null ? null : justificatifs.find((p) => p.id === n.piece_id) ?? null
                  const kilometres = detailDesKilometres(n)
                  const signal = signalDeLaNote(n, lesNotes, 'cabinet')
                  return (
                    <li key={n.id} aria-label={`Note « ${LIBELLES_DES_NATURES[n.nature]} du ${formatDate(n.date_depense)} »`}
                      style={{ borderTop: '1px solid var(--color-border)', paddingTop: 8 }}>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                        <strong>{LIBELLES_DES_NATURES[n.nature]}</strong>
                        <span className={`badge ${BADGE[n.etat]}`}>{MOTS_DE_L_ETAT[n.etat]}</span>
                        <span className="muted">{personneDiteAuCabinet(n)}</span>
                      </div>
                      <p className="muted" style={{ margin: '4px 0' }}>
                        du {formatDate(n.date_depense)} · « {n.motif} » · <span>{formatMoney(n.montant_ttc)}</span> TTC
                        {n.montant_tva > 0 && <> dont <span>{formatMoney(n.montant_tva)}</span> de TVA déclarée</>}
                      </p>
                      {kilometres !== null && <p style={{ margin: '4px 0' }}>{kilometres}</p>}
                      {n.piece_id !== null && (
                        <p style={{ margin: '4px 0' }}>
                          Justificatif : {justificatif !== null
                            ? <><span className="nom-fichier">{justificatif.nom_fichier}</span>{justificatif.statut === 'a_valider' ? ' (à valider)' : ''}</>
                            : 'une pièce du dossier qui ne s’est pas relue'}
                        </p>
                      )}
                      {passagesDeLaNote(n).length > 0 && <p className="muted" style={{ margin: '4px 0' }}>{passagesDeLaNote(n).join(' · ')}</p>}
                      {signal !== null && <p className="muted" role="note" style={{ margin: '4px 0' }}>{signal}</p>}
                      {ouverte !== null ? (
                        <DecisionDeLaNoteDeFrais note={n} genre={ouverte.genre} espace="cabinet" libelleDuMotif={LIBELLE_MOTIF_REFUS_NOTE_DE_FRAIS}
                          aujourdhui={aujourdhui} occupe={occupe} annuler={() => setDecision(null)} envoyer={(d) => decider(n, d)} />
                      ) : (gestes.approuver || gestes.rembourser) && (
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                          {gestes.approuver && (
                            <button type="button" className="btn btn-primary btn-sm" disabled={occupe} onClick={() => approuver(n)}>Approuver</button>
                          )}
                          {gestes.refuser && (
                            <button type="button" className="btn btn-outline btn-sm" disabled={occupe}
                              onClick={() => setDecision({ noteId: n.id, genre: 'refus' })}>Refuser</button>
                          )}
                          {gestes.rembourser && (
                            <button type="button" className="btn btn-primary btn-sm" disabled={occupe}
                              onClick={() => setDecision({ noteId: n.id, genre: 'remboursement' })}>Déclarer remboursée</button>
                          )}
                        </div>
                      )}
                      {message !== null && message.noteId === n.id && (message.genre === 'ok'
                        ? <p role="status" style={{ margin: '4px 0' }}>{message.texte}</p>
                        : <p className="error-text" role="alert">{message.texte}</p>)}
                    </li>
                  )
                })}
              </ul>
            )}
            <p className="muted" style={{ marginBottom: 0 }}>
              Une note approuvée ou remboursée n’écrit rien en comptabilité : le remboursement est déclaré, et la pièce qui la
              justifie se valide comme les autres.
            </p>
          </>
        )
      })()}
    </section>
  )
}
