import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { messageErreur } from '../../lib/messageErreur'
import { formatDate } from '../../lib/format'
import { ouvrirApercu } from '../../lib/apercu'
import { preparerDocumentDuCabinet } from '../../lib/bornesStockage'
import { LIBELLE_TITRE_DU_DOCUMENT, NATURES_DES_DOCUMENTS, refusDeLaPublication } from '../../lib/documentsEtDemandes'
import {
  confirmationDeLaPublication, confirmationDuRetrait, lecteursDesDocuments, natureDite, ouverturesDuDocument,
  type DocumentDuCabinet,
} from '../../lib/documentsEtDemandesVue'
import { lireLesDocumentsDuCabinet, type DocumentsDuCabinetLus } from '../../lib/documentsEtDemandesLecture'
import { deposerEtPublierUnDocument } from '../../lib/documentsEtDemandesEcriture'
import BandeauLecturePartielle from '../../components/BandeauLecturePartielle'
import ConfirmationArticle from './ConfirmationArticle'

// « DOCUMENTS MIS À DISPOSITION » (espace client, ligne 51.5, étape B3a ; la base : B2). Dans l'onglet des documents
// administratifs, sous `DOCUMENTS_ET_DEMANDES_PREVUS` : le cabinet dépose un document (la 2035, la liasse, les comptes, une
// attestation, la lettre de mission, un courrier), le publie, le retire ; il voit quels accès l'ont ouvert, et quand.
//
// RIEN NE PART SUR UNE LECTURE ABSENTE OU PARTIELLE : les documents et les accès du dossier sont lus en entier, sinon aucun
// geste — la confirmation dit QUI lira le document, et ne le dit que d'une liste d'accès entière. Les refus se disent avant
// le clic (la saisie aux mots de la base, le fichier à sa signature et à son poids). Un seul verrou `useRef` pour les deux
// gestes, relâché après la relecture.

type Confirmer =
  | { genre: 'publier'; saisie: { titre: string; nature: string; exercice: number | null }; fichier: File; lecteurs: string[] }
  | { genre: 'retirer'; document: DocumentDuCabinet; ouvertures: number | null }

/** L'exercice saisi : vide, aucun ; sinon le nombre tel quel — la règle du module dit s'il convient. */
const exerciceSaisi = (texte: string): number | null => (texte.trim() === '' ? null : Number(texte.trim()))

export default function DocumentsMisADisposition({ dossierId }: { dossierId: string }) {
  const [lecture, setLecture] = useState<DocumentsDuCabinetLus | null>(null)
  const [titre, setTitre] = useState('')
  const [nature, setNature] = useState<string>('2035')
  const [exercice, setExercice] = useState('')
  const [fichier, setFichier] = useState<File | null>(null)
  const [refusDuFichier, setRefusDuFichier] = useState<string | null>(null)
  const [confirmer, setConfirmer] = useState<Confirmer | null>(null)
  const [message, setMessage] = useState<{ genre: 'ok' | 'erreur'; texte: string } | null>(null)
  const gesteEnCours = useRef(false)
  const [occupe, setOccupe] = useState(false)
  const derniereLecture = useRef(0)
  const champFichier = useRef<HTMLInputElement>(null)

  async function relire() {
    const numero = ++derniereLecture.current
    const l = await lireLesDocumentsDuCabinet(dossierId)
    if (numero === derniereLecture.current) setLecture(l)
  }

  useEffect(() => {
    let annule = false
    const numero = ++derniereLecture.current
    lireLesDocumentsDuCabinet(dossierId).then((l) => {
      if (!annule && numero === derniereLecture.current) setLecture(l)
    })
    return () => { annule = true }
  }, [dossierId])

  const lue = lecture !== null && lecture.dossierId === dossierId ? lecture : null
  const entiere = lue !== null && lue.documents.complete && lue.acces.complete
  const saisie = { titre, nature, exercice: exerciceSaisi(exercice) }
  const refus = lue === null ? null
    : !entiere ? 'Les documents ou les accès du dossier ne sont pas lus en entier : rien ne se publie ni ne se retire.'
      : fichier === null ? 'Choisis le fichier du document.'
        : refusDuFichier ?? refusDeLaPublication({ ...saisie, nomFichier: fichier.name })

  // Le fichier se juge dès qu'il est choisi (sa signature, son poids) : le refus se dit avant le clic. Seul le dernier choix
  // écrit son refus.
  const dernierChoix = useRef<File | null>(null)
  async function choisirLeFichier(f: File | null) {
    dernierChoix.current = f
    setFichier(f)
    setRefusDuFichier(null)
    if (f === null) return
    const pret = await preparerDocumentDuCabinet(f)
    if ('refus' in pret && dernierChoix.current === f) setRefusDuFichier(`Ce fichier ne se dépose pas : ${pret.refus.message}.`)
  }

  async function publier(saisieFigee: { titre: string; nature: string; exercice: number | null }, f: File) {
    if (gesteEnCours.current) return
    gesteEnCours.current = true
    setOccupe(true)
    setMessage(null)
    try {
      const issue = await deposerEtPublierUnDocument(dossierId, saisieFigee, f)
      if (issue.ok) {
        setMessage({ genre: 'ok', texte: `Le document « ${issue.document.titre} » est publié.` })
        setTitre('')
        setExercice('')
        setFichier(null)
        if (champFichier.current) champFichier.current.value = ''
      } else {
        setMessage({ genre: 'erreur', texte: issue.message })
      }
    } finally {
      await relire()
      setConfirmer(null)
      gesteEnCours.current = false
      setOccupe(false)
    }
  }

  async function retirer(document: DocumentDuCabinet) {
    if (gesteEnCours.current) return
    gesteEnCours.current = true
    setOccupe(true)
    setMessage(null)
    try {
      const { error } = await supabase.rpc('retirer_document_du_cabinet', { p_document_id: document.id })
      setMessage(error
        ? { genre: 'erreur', texte: `Le document n’a pas été retiré : ${messageErreur(error, 'refus de la base.')}` }
        : { genre: 'ok', texte: `Le document « ${document.titre} » est retiré.` })
    } finally {
      await relire()
      setConfirmer(null)
      gesteEnCours.current = false
      setOccupe(false)
    }
  }

  async function ouvrir(document: DocumentDuCabinet) {
    const resultat = await ouvrirApercu('documents-cabinet', document.chemin, 300, dossierId)
    if (!resultat.ok) setMessage({ genre: 'erreur', texte: resultat.message })
  }

  const fenetre = confirmer === null ? null
    : confirmer.genre === 'publier' ? confirmationDeLaPublication(confirmer.saisie, confirmer.fichier.name, confirmer.lecteurs)
      : confirmationDuRetrait(confirmer.document, confirmer.ouvertures)

  const documents = entiere ? [...lue.documents.lignes].reverse() : []

  return (
    <section style={{ marginTop: 24 }} aria-labelledby="documents-mis-a-disposition-titre">
      <h3 id="documents-mis-a-disposition-titre" style={{ marginBottom: 4 }}>Documents mis à disposition</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        Ce que tu publies ici, les accès qui portent la case « Documents » le lisent dans leur espace ; leur première ouverture
        se date. Un document retiré ne se lit plus, mais reste au dossier avec la preuve de ses lectures.
      </p>
      {lue === null ? (
        <p className="muted">Chargement…</p>
      ) : (
        <>
          <BandeauLecturePartielle quoi="Les documents mis à disposition" accord="lus" motif={lue.documents.motif}
            consequence="Rien ne se publie ni ne se retire : recharge la page." />
          <BandeauLecturePartielle quoi="Les accès du dossier" accord="lus" motif={lue.acces.motif}
            consequence="Qui lira un document ne se dit pas, et rien ne se publie : recharge la page." />
          <BandeauLecturePartielle quoi="Les ouvertures des documents" accord="lues" motif={lue.lectures.motif}
            consequence="Qui a ouvert un document ne se dit pas : recharge la page." />
          <div className="field-row aligne-bas" style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <label style={{ flex: '2 1 220px' }}>
              {LIBELLE_TITRE_DU_DOCUMENT}
              <input type="text" value={titre} maxLength={200} disabled={occupe} onChange={(e) => setTitre(e.target.value)} />
            </label>
            <label style={{ flex: '1 1 160px' }}>
              Nature
              <select value={nature} disabled={occupe} onChange={(e) => setNature(e.target.value)}>
                {Object.entries(NATURES_DES_DOCUMENTS).map(([valeur, mots]) => <option key={valeur} value={valeur}>{mots}</option>)}
              </select>
            </label>
            <label style={{ flex: '0 1 120px' }}>
              Exercice (facultatif)
              <input type="text" inputMode="numeric" value={exercice} disabled={occupe} onChange={(e) => setExercice(e.target.value)} />
            </label>
            <label style={{ flex: '2 1 220px' }}>
              Fichier (PDF, JPEG ou PNG, 20 Mo au plus)
              <input ref={champFichier} type="file" accept="application/pdf,image/jpeg,image/png" disabled={occupe}
                onChange={(e) => { void choisirLeFichier(e.target.files?.[0] ?? null) }} />
            </label>
            <button type="button" className="btn btn-primary" disabled={occupe || refus !== null} title={refus ?? undefined}
              onClick={() => {
                if (refus === null && fichier !== null && entiere) {
                  setConfirmer({ genre: 'publier', saisie, fichier, lecteurs: lecteursDesDocuments(lue.acces.lignes) })
                }
              }}>
              Publier le document
            </button>
          </div>
          {refus && fichier !== null && <p className="error-text">{refus}</p>}
          {message && (message.genre === 'ok'
            ? <p role="status">{message.texte}</p>
            : <p className="error-text" role="alert">{message.texte}</p>)}
          {entiere && (documents.length === 0 ? (
            <p className="muted">Aucun document n’est mis à disposition de ce dossier.</p>
          ) : (
            <div className="table-scroll tableau-adaptable" style={{ border: '1px solid var(--color-border)', borderRadius: 8 }}>
              <table className="table-empilable">
                <thead><tr><th>Titre</th><th>Nature</th><th>Publié le</th><th>État</th><th>Ouvert par</th><th></th></tr></thead>
                <tbody>
                  {documents.map((d) => {
                    const ouvertures = lue.lectures.complete ? ouverturesDuDocument(d.id, lue.lectures.lignes, lue.acces.lignes) : null
                    return (
                      <tr key={d.id}>
                        <td data-libelle="Titre">{d.titre}<br /><span className="muted nom-fichier">{d.nom_fichier}</span></td>
                        <td data-libelle="Nature">{natureDite(d.nature)}{d.exercice !== null && ` ${d.exercice}`}</td>
                        <td data-libelle="Publié le">{formatDate(d.publie_le)}</td>
                        <td data-libelle="État">
                          {d.retire_le === null
                            ? <span className="badge badge-ok">Publié</span>
                            : <span className="badge badge-neutral">Retiré le {formatDate(d.retire_le)}</span>}
                        </td>
                        <td data-libelle="Ouvert par">
                          {ouvertures === null ? '—' : ouvertures.length === 0 ? <span className="muted">Personne</span> : (
                            <ul style={{ margin: 0, paddingLeft: 16 }}>
                              {ouvertures.map((o, i) => (
                                <li key={i}>
                                  {o.email === null ? 'Un accès retiré depuis' : <span className="courriel">{o.email}</span>}
                                  {' '}le {formatDate(o.lu_le)}
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                        <td className="td-actions">
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            <button type="button" className="btn btn-outline btn-sm" onClick={() => { void ouvrir(d) }}>Ouvrir</button>
                            {d.retire_le === null && (
                              <button type="button" className="btn btn-outline btn-sm" disabled={occupe}
                                onClick={() => setConfirmer({ genre: 'retirer', document: d, ouvertures: ouvertures?.length ?? null })}>
                                Retirer
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </>
      )}
      {confirmer && fenetre && (
        <ConfirmationArticle
          titre={fenetre.titre} boutonLabel={fenetre.bouton} occupe={occupe} refus={null} erreur={null}
          onConfirmer={() => {
            void (confirmer.genre === 'publier' ? publier(confirmer.saisie, confirmer.fichier) : retirer(confirmer.document))
          }}
          onAnnuler={() => setConfirmer(null)}
        >
          {fenetre.paragraphes.map((p) => <p key={p}>{p}</p>)}
        </ConfirmationArticle>
      )}
    </section>
  )
}
