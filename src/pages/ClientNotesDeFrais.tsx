import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { messageErreur } from '../lib/messageErreur'
import { aujourdHuiAParis, formatDate, formatMoney } from '../lib/format'
import { pourLEspace } from '../lib/espaceVentes'
import { LIBELLE_MOTIF_REFUS_NOTE_DE_FRAIS_CLIENT } from '../lib/droitsAcces'
import { NOTES_DE_FRAIS_PREVUES, refusDeLaSaisie, TYPES_DE_VEHICULE } from '../lib/notesDeFrais'
import type { TypeVehicule } from '../lib/baremeKilometrique'
import {
  confirmationDeLApprobation, confirmationDeLaSoumission, confirmationDuRefus, confirmationDuRemboursement, confirmationDuRetrait,
  cumulDesKilometres, detailDesKilometres, etatDuJustificatif, formulaireDeLaNote, formulaireNeuf, gestesDeLaNote,
  justificatifsCitables, LIBELLES_DES_NATURES, LIBELLES_DES_VEHICULES, montantDesKilometres, MOTS_DE_L_ETAT, NATURES_PROPOSEES,
  notesAMontrer, parametresDeLEnregistrement, passagesDeLaNote, personneDiteAuClient, PRESENTATION_DE_MES_NOTES_DE_FRAIS,
  AUCUNE_NOTE_A_DECIDER, refusDeLaSoumission, SANS_LA_CASE_FRAIS, SANS_LA_SAISIE, saisieDuFormulaire, saisieOuverte,
  signalDeLaNote, signalDeLaTranche,
  type FormulaireDeNote, type NoteDeFrais, type PieceDeLAuteur,
} from '../lib/notesDeFraisVue'
import { lireMesNotesDeFrais, type MesNotesDeFraisLues } from '../lib/notesDeFraisLecture'
import BandeauLecturePartielle from '../components/BandeauLecturePartielle'
import DecisionDeLaNoteDeFrais, { type DecisionSaisie } from '../components/DecisionDeLaNoteDeFrais'

// « MES NOTES DE FRAIS » (espace client, ligne 51.5, étape B8 ; la base : B7, `notes_de_frais`). L'écran du client qui porte
// la case « Notes de frais » sur la société AFFICHÉE : ses notes, le formulaire d'un brouillon (une dépense et son
// justificatif, ou des kilomètres au barème de leur année, le dépassement de la première tranche signalé), soumettre et
// retirer un brouillon ; avec « Achats » en plus, la note d'un salarié sans accès, et les décisions — approuver, refuser sous
// un motif que l'auteur lit, déclarer le remboursement. Avec « Achats » SEUL (B8-Q1), les décisions sans la saisie : ni
// « Nouvelle note » ni brouillon à soi (`saisieOuverte`), et l'écran le dit. Chaque geste par sa fonction seule, sous UN
// verrou `useRef` relâché après la relecture ; le refus du module se dit avant le clic, sur la saisie telle qu'elle part ;
// celui de la base, après, réécrit pour le client ; chaque confirmation nomme la note qui part.
//
// LES CASES SE LISENT DEUX FOIS (lib/notesDeFraisLecture.ts) : à la connexion pour la route, puis à la BASE avec les notes.
// RIEN N'EST AFFIRMÉ NI OFFERT SUR UNE LECTURE ABSENTE, EN COURS OU PARTIELLE : les notes et les pièces lues en entier, sinon
// aucune note ne s'affiche et aucun geste ne s'offre. Jamais une catégorie, un compte ni une écriture.

const BADGE: Readonly<Record<NoteDeFrais['etat'], string>> = {
  brouillon: 'badge-neutral', soumise: 'badge-warning', approuvee: 'badge-ok', refusee: 'badge-danger', remboursee: 'badge-ok',
  retiree: 'badge-neutral',
}

type Decision = { noteId: string; genre: 'refus' | 'remboursement' }
type Message = { cle: string; genre: 'ok' | 'erreur'; texte: string }
const NOUVELLE = 'nouvelle'

export default function ClientNotesDeFrais() {
  const { dossierActifId, session } = useAuth()
  const dossierId = dossierActifId
  const moi = session?.user.id ?? null
  const [lecture, setLecture] = useState<MesNotesDeFraisLues | null>(null)
  const [formulaire, setFormulaire] = useState<FormulaireDeNote | null>(null)
  const [decision, setDecision] = useState<Decision | null>(null)
  const [message, setMessage] = useState<Message | null>(null)
  const ecritureEnCours = useRef(false)
  const [occupe, setOccupe] = useState(false)
  const derniereLecture = useRef(0)

  useEffect(() => {
    if (!NOTES_DE_FRAIS_PREVUES || !dossierId || !moi) return
    // La coque remonte l'écran à chaque changement de société (`<Outlet key>`) ; une réponse arrivée après coup ne s'écrit pas.
    let annule = false
    const numero = ++derniereLecture.current
    lireMesNotesDeFrais(dossierId, moi).then((l) => { if (!annule && numero === derniereLecture.current) setLecture(l) })
    return () => { annule = true }
  }, [dossierId, moi])

  if (!NOTES_DE_FRAIS_PREVUES) return null

  async function relire(id: string, compte: string) {
    const numero = ++derniereLecture.current
    const l = await lireMesNotesDeFrais(id, compte)
    if (numero === derniereLecture.current) setLecture(l)
  }

  const lue = lecture !== null && lecture.dossierId === dossierId ? lecture : null
  const entiere = lue?.etat === 'lues' && lue.lesNotes.complete && lue.pieces.complete ? lue : null
  const aujourdhui = aujourdHuiAParis()
  const lesNotes = entiere?.lesNotes.lignes ?? []
  const pieces = entiere?.pieces.lignes ?? []

  /** Un geste, sous le verrou de l'écran : la fonction de la base, ce qu'elle a dit, puis la relecture. */
  async function agir(cle: string, nom: string, args: Record<string, unknown>, reussi: string, rate: string, apres?: () => void) {
    if (ecritureEnCours.current || !dossierId || !moi) return
    ecritureEnCours.current = true
    setOccupe(true)
    setMessage(null)
    try {
      const { error } = await supabase.rpc(nom, args)
      if (error) {
        setMessage({ cle, genre: 'erreur', texte: pourLEspace('client', `${rate} : ${messageErreur(error, 'refus de la base.')}`) })
      } else {
        setMessage({ cle, genre: 'ok', texte: reussi })
        apres?.()
      }
    } finally {
      await relire(dossierId, moi)
      ecritureEnCours.current = false
      setOccupe(false)
    }
  }

  function enregistrer(f: FormulaireDeNote) {
    if (!dossierId) return
    const cle = f.noteId ?? NOUVELLE
    void agir(cle, 'enregistrer_note_de_frais', parametresDeLEnregistrement(dossierId, f, saisieDuFormulaire(f)),
      'Ton brouillon est enregistré : soumets-le quand il est prêt.', 'Ton brouillon n’est pas enregistré', () => setFormulaire(null))
  }

  function soumettre(n: NoteDeFrais) {
    if (ecritureEnCours.current || !window.confirm(confirmationDeLaSoumission(n))) return
    void agir(n.id, 'soumettre_note_de_frais', { p_note_id: n.id, p_version_lue: n.version },
      'Ta note est soumise.', 'Ta note n’est pas soumise')
  }

  function retirer(n: NoteDeFrais) {
    const justificatif = n.piece_id === null ? null : pieces.find((p) => p.id === n.piece_id)?.nom_fichier ?? null
    if (ecritureEnCours.current || !window.confirm(confirmationDuRetrait(n, justificatif))) return
    void agir(n.id, 'retirer_note_de_frais', { p_note_id: n.id, p_version_lue: n.version },
      'Ton brouillon est retiré.', 'Ton brouillon n’est pas retiré')
  }

  function approuver(n: NoteDeFrais) {
    if (ecritureEnCours.current || !window.confirm(confirmationDeLApprobation(n))) return
    void agir(n.id, 'approuver_note_de_frais', { p_note_id: n.id, p_version_lue: n.version },
      'La note est approuvée.', 'La note n’est pas approuvée')
  }

  function decider(n: NoteDeFrais, d: DecisionSaisie) {
    if (ecritureEnCours.current) return
    if (d.genre === 'refus') {
      if (!window.confirm(confirmationDuRefus(n, d.motif))) return
      void agir(n.id, 'refuser_note_de_frais', { p_note_id: n.id, p_version_lue: n.version, p_motif: d.motif },
        'La note est refusée.', 'La note n’est pas refusée', () => setDecision(null))
    } else {
      if (!window.confirm(confirmationDuRemboursement(n, d.date, d.moyen))) return
      void agir(n.id, 'rembourser_note_de_frais', { p_note_id: n.id, p_version_lue: n.version, p_date: d.date, p_moyen: d.moyen },
        'Le remboursement est déclaré.', 'Le remboursement n’est pas déclaré', () => setDecision(null))
    }
  }

  const ditPour = (cle: string) => message !== null && message.cle === cle && (message.genre === 'ok'
    ? <p role="status">{message.texte}</p>
    : <p className="error-text" role="alert">{message.texte}</p>)

  const dites = notesAMontrer(lesNotes)

  return (
    <>
      <div className="topbar"><h1>Mes notes de frais</h1></div>
      <p className="muted" style={{ marginTop: 0 }}>{PRESENTATION_DE_MES_NOTES_DE_FRAIS}</p>
      {lue === null ? (
        <p className="muted">Chargement…</p>
      ) : lue.etat === 'echec' ? (
        <p className="error-text">Tes notes de frais ne s’affichent pas : {lue.motif}. Recharge la page.</p>
      ) : lue.etat === 'sans_frais' ? (
        <p className="muted">{SANS_LA_CASE_FRAIS}</p>
      ) : entiere === null || moi === null || dossierId === null ? (
        <BandeauLecturePartielle quoi="Tes notes de frais" accord="lues" technique={false}
          motif={lue.lesNotes.motif ?? lue.pieces.motif}
          consequence="Aucune ne s’affiche, et rien ne s’écrit d’ici : l’une d’elles, ou l’un de tes justificatifs, pourrait manquer. Recharge la page." />
      ) : (
        <>
          {!saisieOuverte(entiere) ? (
            <p className="muted" style={{ marginBottom: 10 }}>{SANS_LA_SAISIE}</p>
          ) : formulaire !== null && formulaire.noteId === null ? (
            <div className="card" aria-label="Nouvelle note de frais" style={{ marginBottom: 10 }}>
              <strong>Nouvelle note de frais</strong>
              <FormulaireDeLaNote f={formulaire} lesNotes={lesNotes} pieces={pieces} moi={moi} dossierId={dossierId}
                achats={entiere.achats} aujourdhui={aujourdhui} occupe={occupe}
                changer={setFormulaire} annuler={() => setFormulaire(null)} envoyer={enregistrer} />
              {ditPour(NOUVELLE)}
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
              <button type="button" className="btn btn-primary btn-sm" disabled={occupe}
                onClick={() => { setDecision(null); setFormulaire(formulaireNeuf(aujourdhui)) }}>
                Nouvelle note
              </button>
            </div>
          )}
          {/* Un message sans carte où se dire — la note neuve enregistrée, un brouillon retiré — se dit ici. */}
          {message !== null && !(message.cle === NOUVELLE ? formulaire !== null && formulaire.noteId === null : dites.some((n) => n.id === message.cle))
            && ditPour(message.cle)}
          {dites.length === 0 ? (
            <p className="muted">{saisieOuverte(entiere) ? 'Tu n’as aucune note de frais pour l’instant.' : AUCUNE_NOTE_A_DECIDER}</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 10 }}>
              {dites.map((n) => {
                const gestes = gestesDeLaNote(n, { moi, cabinet: false, frais: entiere.frais, achats: entiere.achats })
                const enModification = formulaire !== null && formulaire.noteId === n.id ? formulaire : null
                const decisionOuverte = decision !== null && decision.noteId === n.id ? decision : null
                const justificatif = n.piece_id === null ? null : pieces.find((p) => p.id === n.piece_id) ?? null
                const refusSoumission = gestes.soumettre ? refusDeLaSoumission(n, pieces) : null
                const kilometres = detailDesKilometres(n)
                const signal = signalDeLaNote(n, lesNotes, 'client')
                return (
                  <li key={n.id} className="card" aria-label={`Note « ${LIBELLES_DES_NATURES[n.nature]} du ${formatDate(n.date_depense)} »`}>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      <strong>{LIBELLES_DES_NATURES[n.nature]}</strong>
                      <span className={`badge ${BADGE[n.etat]}`}>{MOTS_DE_L_ETAT[n.etat]}</span>
                      <span className="muted">{personneDiteAuClient(n, moi)}</span>
                    </div>
                    <p className="muted" style={{ margin: '4px 0' }}>
                      du {formatDate(n.date_depense)} · « {n.motif} » · <span>{formatMoney(n.montant_ttc)}</span> TTC
                      {n.montant_tva > 0 && <> dont <span>{formatMoney(n.montant_tva)}</span> de TVA</>}
                    </p>
                    {kilometres !== null && <p style={{ margin: '4px 0' }}>{kilometres}</p>}
                    {n.piece_id !== null && (
                      <p style={{ margin: '4px 0' }}>
                        Justificatif : {justificatif !== null ? <span className="nom-fichier">{justificatif.nom_fichier}</span> : 'une pièce du dossier'}
                      </p>
                    )}
                    {passagesDeLaNote(n).length > 0 && <p className="muted" style={{ margin: '4px 0' }}>{passagesDeLaNote(n).join(' · ')}</p>}
                    {signal !== null && <p className="muted" role="note" style={{ margin: '4px 0' }}>{signal}</p>}
                    {enModification !== null ? (
                      <FormulaireDeLaNote f={enModification} lesNotes={lesNotes} pieces={pieces} moi={moi} dossierId={dossierId}
                        achats={entiere.achats} aujourdhui={aujourdhui} occupe={occupe}
                        changer={setFormulaire} annuler={() => setFormulaire(null)} envoyer={enregistrer} />
                    ) : decisionOuverte !== null ? (
                      <DecisionDeLaNoteDeFrais note={n} genre={decisionOuverte.genre} espace="client"
                        libelleDuMotif={LIBELLE_MOTIF_REFUS_NOTE_DE_FRAIS_CLIENT} aujourdhui={aujourdhui} occupe={occupe}
                        annuler={() => setDecision(null)} envoyer={(d) => decider(n, d)} />
                    ) : (
                      <>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                          {gestes.modifier && (
                            <button type="button" className="btn btn-outline btn-sm" disabled={occupe}
                              onClick={() => { setDecision(null); setFormulaire(formulaireDeLaNote(n)) }}>Modifier</button>
                          )}
                          {gestes.soumettre && (
                            <button type="button" className="btn btn-primary btn-sm" disabled={occupe || refusSoumission !== null}
                              title={refusSoumission === null ? undefined : pourLEspace('client', refusSoumission)}
                              onClick={() => soumettre(n)}>Soumettre</button>
                          )}
                          {gestes.retirer && (
                            <button type="button" className="btn btn-outline btn-sm" disabled={occupe} onClick={() => retirer(n)}>Retirer</button>
                          )}
                          {gestes.approuver && (
                            <button type="button" className="btn btn-primary btn-sm" disabled={occupe} onClick={() => approuver(n)}>Approuver</button>
                          )}
                          {gestes.refuser && (
                            <button type="button" className="btn btn-outline btn-sm" disabled={occupe}
                              onClick={() => { setFormulaire(null); setDecision({ noteId: n.id, genre: 'refus' }) }}>Refuser</button>
                          )}
                          {gestes.rembourser && (
                            <button type="button" className="btn btn-primary btn-sm" disabled={occupe}
                              onClick={() => { setFormulaire(null); setDecision({ noteId: n.id, genre: 'remboursement' }) }}>
                              Déclarer remboursée
                            </button>
                          )}
                        </div>
                        {refusSoumission !== null && <p className="error-text">{pourLEspace('client', refusSoumission)}</p>}
                      </>
                    )}
                    {ditPour(n.id)}
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

function FormulaireDeLaNote({ f, lesNotes, pieces, moi, dossierId, achats, aujourdhui, occupe, changer, annuler, envoyer }: {
  f: FormulaireDeNote
  lesNotes: readonly NoteDeFrais[]
  pieces: readonly PieceDeLAuteur[]
  moi: string
  dossierId: string
  achats: boolean
  aujourdhui: string
  occupe: boolean
  changer: (f: FormulaireDeNote) => void
  annuler: () => void
  envoyer: (f: FormulaireDeNote) => void
}) {
  const saisie = saisieDuFormulaire(f)
  const refus = refusDeLaSaisie(saisie, {
    aujourdHui: aujourdhui, achats,
    justificatif: etatDuJustificatif(saisie.pieceId, pieces, lesNotes, moi, dossierId, f.noteId),
  })
  const citables = justificatifsCitables(pieces, lesNotes, moi, dossierId, f.noteId)
  const kilometres = f.nature === 'kilometres'
  const montant = kilometres ? montantDesKilometres(f) : null
  const annee = Number(f.date.slice(0, 4))
  const distance = /^\d+$/.test(f.distance.trim()) ? Number(f.distance.trim()) : 0
  const signal = kilometres && (TYPES_DE_VEHICULE as readonly string[]).includes(f.vehicule) && Number.isInteger(annee)
    ? signalDeLaTranche(annee, f.vehicule as TypeVehicule, distance + cumulDesKilometres(lesNotes,
      { auteur: moi, beneficiaire_salarie: f.pourUnSalarie ? f.salarie : null }, annee, f.vehicule as TypeVehicule, f.noteId), 'client')
    : null
  const dit = refus === null ? null : pourLEspace('client', refus)
  return (
    <div style={{ marginTop: 6 }}>
      <div className="field-row aligne-bas" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {achats && (
          <label>
            <input type="checkbox" checked={f.pourUnSalarie} disabled={occupe} onChange={(e) => changer({ ...f, pourUnSalarie: e.target.checked })} />
            {' '}Pour un salarié sans accès
          </label>
        )}
        {f.pourUnSalarie && (
          <label>
            Nom du salarié
            <input type="text" value={f.salarie} maxLength={120} disabled={occupe} onChange={(e) => changer({ ...f, salarie: e.target.value })} />
          </label>
        )}
        <label>
          Date de la dépense
          <input type="date" value={f.date} max={aujourdhui} disabled={occupe} onChange={(e) => changer({ ...f, date: e.target.value })} />
        </label>
        <label>
          Nature
          <select value={f.nature} disabled={occupe} onChange={(e) => changer({ ...f, nature: e.target.value })}>
            <option value="">Choisis…</option>
            {NATURES_PROPOSEES.map((n) => <option key={n.valeur} value={n.valeur}>{n.libelle}</option>)}
          </select>
        </label>
        <label style={{ flex: '1 1 220px' }}>
          Motif
          <input type="text" value={f.motif} maxLength={200} disabled={occupe} onChange={(e) => changer({ ...f, motif: e.target.value })} />
        </label>
      </div>
      {kilometres ? (
        <div className="field-row aligne-bas" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
          <label>
            Distance (km)
            <input type="text" inputMode="numeric" value={f.distance} disabled={occupe} onChange={(e) => changer({ ...f, distance: e.target.value })} />
          </label>
          <label>
            Véhicule
            <select value={f.vehicule} disabled={occupe} onChange={(e) => changer({ ...f, vehicule: e.target.value })}>
              <option value="">Choisis…</option>
              {TYPES_DE_VEHICULE.map((t) => <option key={t} value={t}>{LIBELLES_DES_VEHICULES[t]}</option>)}
            </select>
          </label>
          <label>
            Puissance fiscale (CV)
            <input type="text" inputMode="numeric" value={f.puissance} disabled={occupe} onChange={(e) => changer({ ...f, puissance: e.target.value })} />
          </label>
          <label>
            Électrique
            <select value={f.electrique} disabled={occupe} onChange={(e) => changer({ ...f, electrique: e.target.value as FormulaireDeNote['electrique'] })}>
              <option value="">Choisis…</option>
              <option value="non">non</option>
              <option value="oui">oui</option>
            </select>
          </label>
          <p style={{ margin: 0 }}>
            {montant !== null
              ? <>Montant au barème de {f.date.slice(0, 4)} : <span>{formatMoney(montant)}</span></>
              : <span className="muted">Le montant se calcule au barème de l’année de la dépense.</span>}
          </p>
        </div>
      ) : (
        <div className="field-row aligne-bas" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
          <label>
            Montant TTC (€)
            <input type="text" inputMode="decimal" value={f.ttc} disabled={occupe} onChange={(e) => changer({ ...f, ttc: e.target.value })} />
          </label>
          <label>
            Dont TVA (€, facultatif)
            <input type="text" inputMode="decimal" value={f.tva} disabled={occupe} onChange={(e) => changer({ ...f, tva: e.target.value })} />
          </label>
          <label style={{ flex: '1 1 220px' }}>
            Justificatif
            <select value={f.pieceId} disabled={occupe} onChange={(e) => changer({ ...f, pieceId: e.target.value })}>
              <option value="">Aucun pour l’instant</option>
              {citables.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nom_fichier}{p.date_piece !== null ? ` — ${formatDate(p.date_piece)}` : ''}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {!kilometres && citables.length === 0 && (
        <p className="muted" style={{ margin: '4px 0' }}>
          Aucune pièce que tu as déposée n’est libre : dépose d’abord ton justificatif dans « Mes pièces ». Une note se soumet avec lui.
        </p>
      )}
      {signal !== null && <p className="muted" role="note" style={{ margin: '4px 0' }}>{signal}</p>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
        <button type="button" className="btn btn-primary btn-sm" disabled={occupe || refus !== null} title={dit ?? undefined}
          onClick={() => envoyer(f)}>
          Enregistrer le brouillon
        </button>
        <button type="button" className="btn btn-outline btn-sm" disabled={occupe} onClick={annuler}>Annuler</button>
      </div>
      {dit !== null && <p className="error-text">{dit}</p>}
    </div>
  )
}
