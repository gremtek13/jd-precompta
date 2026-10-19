import { useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { messageErreur } from '../../lib/messageErreur'
import type { LectureComplete } from '../../lib/lectureComplete'
import type { Piece } from '../../lib/types'
import {
  argumentsDeLaDesignation, argumentsDuRetraitDeLaDesignation, refusDeLaDesignation, refusDuRetraitDeLaDesignation,
  type ContexteDesignation,
} from '../../lib/exemplairesDesFactures'
import type { FactureProposee } from '../../lib/exemplairesDesFacturesLecture'
import {
  confirmationDeLaDesignation, confirmationDuRetraitDeLaDesignation, descriptionDeLaFacture, ligneDuChoix,
  PARAGRAPHE_DE_LA_DESIGNATION, phraseDeLaPieceDesignee,
} from '../../lib/exemplairesDesFacturesEcran'

// L'EXEMPLAIRE D'UNE FACTURE ÉMISE, DANS LA FICHE D'UNE PIÈCE DE VENTE (ligne 28.6, chantier EC-Q3, étape VF1b ; la base et
// la règle : VF1a, lib/exemplairesDesFactures.ts). Une pièce de vente est l'exemplaire d'une facture émise dans l'application
// quand elle est l'original que la plateforme du client a rendu, ou le PDF que le cabinet a déposé : le cabinet la DÉSIGNE
// ici, ou DÉFAIT la désignation. Un geste du CABINET seul — la fiche d'une pièce n'est montée que par l'onglet des
// justificatifs du dossier, jamais dans l'espace du client, et la base refuse tout autre appelant.
//
// CE QU'ELLE NE FAIT JAMAIS :
// - rien sur une lecture pas encore revenue, partielle ou refusée : les factures émises du dossier lui viennent de l'onglet
//   (lues EN ENTIER, lib/exemplairesDesFacturesLecture.ts), le gel aussi (`piecesFigees`). Faute de l'une ou de l'autre, elle
//   ne montre ni ne propose aucun geste, et le dit ;
// - rien d'écrit sans un clic confirmé qui NOMME la facture ; ce que la base refuserait se dit AVANT le clic, par le module,
//   dans son ordre et sous ses mots (sauf l'accès, qu'un écran ne peut pas dire) — la base reste juge, et un refus qu'elle
//   oppose quand même se dit à son tour (`messageErreur`) ;
// - rien proposé à la place du cabinet : aucune facture n'est choisie d'avance. Le pont déduit ce qu'il peut (flux, Super
//   PDP, identité) ; ce qu'il ne peut pas déduire, le cabinet le désigne.
//
// Le verrou d'écriture est un `useRef` posé avant le `try` et relâché APRÈS la relecture de la pièce : la désignation paraît,
// ou la base a vu ce que l'écran n'avait pas lu (la pièce figée entre-temps, une autre désignation).

export interface DonneesExemplaire {
  /** Les factures émises VALIDÉES du dossier, lues en entier ; null avant leur première lecture. */
  factures: LectureComplete<FactureProposee> | null
  /** Relit les factures du dossier (l'onglet qui les a lues) : rendue quand la lecture est revenue. */
  relireLesFactures: () => Promise<void>
  /** L'exercice qui fige la pièce (`piecesFigees`), nul si rien ne la fige. */
  anneeFigeante: number | null
  /** Non nul quand les écritures validées ou les biens n'ont pas été lus en entier : on ne sait pas si la pièce est figée. */
  gelIncomplet: string | null
  /** Relit LA PIÈCE après un geste (l'onglet qui la tient) : rendue quand la lecture est revenue, avec son motif si elle a
   * échoué (null sinon). L'écran appelant remplace alors la pièce, dans sa liste comme dans la fiche. */
  relirePiece: (pieceId: string) => Promise<string | null>
}

interface Props {
  dossierId: string
  /** La pièce TELLE QU'ENREGISTRÉE : c'est à elle que la base juge la désignation. */
  piece: Piece
  donnees: DonneesExemplaire
  /** Les noms des autres pièces qui portent la même facture quand le pont dit la vente comptée plusieurs fois ; null sinon. */
  autresPieces: readonly string[] | null
}

const TITRE = 'Exemplaire d’une facture émise'

export default function ExemplaireDeLaFacture({ dossierId, piece, donnees, autresPieces }: Props) {
  const { factures, relireLesFactures, anneeFigeante, gelIncomplet, relirePiece } = donnees
  const [choix, setChoix] = useState('')
  const [erreur, setErreur] = useState<string | null>(null)
  const [occupe, setOccupe] = useState(false)
  // Posée quand la relecture de la pièce, après un geste, a échoué : l'écran ne sait plus ce que la base a retenu.
  const [relecturePerdue, setRelecturePerdue] = useState<string | null>(null)
  // Le verrou des deux écritures de la section (désigner, défaire), posé avant le `try`, relâché après la relecture de la
  // pièce : deux envois du même rendu, ou un retrait parti pendant une désignation, seraient jugés par la base sur une
  // pièce que l'écran n'a pas relue. Et celui des relectures, qui ne lisent que.
  const ecritureEnCours = useRef(false)
  const relectureEnCours = useRef(false)

  const designee = piece.facture_id
  // Une pièce qui n'est pas une vente et ne porte rien n'a pas de section : le geste est celui d'une pièce de vente.
  if (piece.type_piece !== 'vente' && designee === null) return null

  if (factures === null) {
    return (
      <section className="fiche-hdf" aria-busy="true">
        <h3>{TITRE}</h3>
        <p className="muted">Lecture des factures émises du dossier…</p>
      </section>
    )
  }

  async function relireLesFacturesDuDossier() {
    if (relectureEnCours.current) return
    relectureEnCours.current = true
    try {
      await relireLesFactures()
    } finally {
      relectureEnCours.current = false
    }
  }

  async function relireLaPiece() {
    if (relectureEnCours.current) return
    relectureEnCours.current = true
    try {
      setRelecturePerdue(await relirePiece(piece.id))
    } finally {
      relectureEnCours.current = false
    }
  }

  if (!factures.complete) {
    return (
      <section className="fiche-hdf">
        <h3>{TITRE}</h3>
        <p className="error-text">
          Les factures émises du dossier n’ont pas pu être lues en entier ({factures.motif}) : cette pièce ne se désigne
          ni ne se défait d’ici — le choix et la confirmation nomment une facture, qu’on ne peut pas nommer sur une liste incomplète.
        </p>
        <div className="fiche-hdf-actions">
          <button type="button" className="btn btn-outline btn-sm" onClick={() => void relireLesFacturesDuDossier()}>
            Relire les factures
          </button>
        </div>
      </section>
    )
  }

  const lues = factures.lignes
  const facture = designee === null ? null : lues.find((f) => f.id === designee) ?? null
  const contexte: ContexteDesignation = { dossierId, anneeFigeante, factures: lues }

  // On ne sait pas si la pièce est figée, ou la dernière relecture de la pièce a échoué : la base jugerait sur autre chose
  // que ce que l'écran montre.
  const geste = gelIncomplet !== null
    ? `La liste des écritures validées n’a pas pu être lue en entier (${gelIncomplet}) : faute de savoir si un exercice validé fige cette pièce, sa désignation ne se pose ni ne se défait d’ici.`
    : relecturePerdue !== null
      ? `La pièce n’a pas pu être relue après le dernier geste (${relecturePerdue}) : l’écran ne sait plus si elle est désignée.`
      : null

  async function designer() {
    if (ecritureEnCours.current || geste !== null || choix === '') return
    // Le refus du module, jugé sur la saisie TELLE QU'ELLE PART.
    if (refusDeLaDesignation(piece, choix, contexte) !== null) return
    const cible = lues.find((f) => f.id === choix)
    if (!cible) return
    if (!window.confirm(confirmationDeLaDesignation(piece.nom_fichier, cible))) return
    // Posé AVANT le `try` et avant le premier `await` : un verrou posé après ne verrouille rien.
    ecritureEnCours.current = true
    setOccupe(true)
    setErreur(null)
    try {
      const { error } = await supabase.rpc('designer_exemplaire_facture', argumentsDeLaDesignation(dossierId, piece.id, choix))
      if (error) setErreur(messageErreur(error, 'La pièce n’a pas pu être désignée.'))
      else setChoix('')
      // Relue dans les deux cas, AVANT de relâcher le verrou : désignée, la pièce porte sa facture ; refusée, la base a
      // peut-être vu ce que l'écran n'avait pas lu, et le refus suivant se dira avant le clic.
      setRelecturePerdue(await relirePiece(piece.id))
    } finally {
      ecritureEnCours.current = false
      setOccupe(false)
    }
  }

  async function defaire() {
    if (ecritureEnCours.current || geste !== null || facture === null) return
    if (refusDuRetraitDeLaDesignation(piece, contexte) !== null) return
    if (!window.confirm(confirmationDuRetraitDeLaDesignation(piece.nom_fichier, facture, autresPieces))) return
    ecritureEnCours.current = true
    setOccupe(true)
    setErreur(null)
    try {
      const { error } = await supabase.rpc('defaire_exemplaire_facture', argumentsDuRetraitDeLaDesignation(dossierId, piece.id))
      if (error) setErreur(messageErreur(error, 'La désignation n’a pas pu être défaite.'))
      setRelecturePerdue(await relirePiece(piece.id))
    } finally {
      ecritureEnCours.current = false
      setOccupe(false)
    }
  }

  // ── Une pièce désignée ──────────────────────────────────────────────────────────────────────────────────────────────
  if (designee !== null) {
    const refusDuRetrait = refusDuRetraitDeLaDesignation(piece, contexte)
    return (
      <section className="fiche-hdf">
        <h3>{TITRE}</h3>
        {facture ? (
          <dl className="fiche-hdf-detail">
            <dt>{facture.type === 'avoir' ? 'Avoir' : 'Facture'}</dt>
            <dd>
              <span className="nom-fichier">{facture.numero ?? '(sans numéro)'}</span> — {descriptionDeLaFacture(facture)}
            </dd>
            <dt>Désignation</dt>
            <dd>{phraseDeLaPieceDesignee(facture)}</dd>
          </dl>
        ) : (
          <p className="fiche-hdf-refus">
            Cette pièce est désignée comme l’exemplaire d’une facture émise que la liste lue ne contient pas : son numéro ne
            peut pas être dit, et la désignation ne se défait pas d’ici.
          </p>
        )}
        {geste !== null && <p className="fiche-hdf-refus">{geste}</p>}
        {geste === null && facture !== null && refusDuRetrait !== null && <p className="fiche-hdf-refus">{refusDuRetrait.message}</p>}
        {erreur && <p className="error-text">{erreur}</p>}
        <div className="fiche-hdf-actions">
          {relecturePerdue !== null && (
            <button type="button" className="btn btn-outline btn-sm" disabled={occupe} onClick={() => void relireLaPiece()}>
              Relire la pièce
            </button>
          )}
          {geste === null && facture !== null && refusDuRetrait === null && (
            <button type="button" className="btn btn-outline btn-sm" disabled={occupe} onClick={() => void defaire()}>
              {occupe ? 'Désignation défaite…' : 'Défaire la désignation'}
            </button>
          )}
        </div>
      </section>
    )
  }

  // ── Une pièce de vente que rien ne désigne ──────────────────────────────────────────────────────────────────────────
  // Le refus de la PIÈCE, sans rien choisir : ce qu'une désignation, quelle que soit la facture, rencontrerait d'abord. La
  // facture introuvable est celle du choix vide, pas un refus de la pièce.
  const refusDeLaPiece = (() => {
    const r = refusDeLaDesignation(piece, null, contexte)
    return r !== null && r.cle !== 'facture_introuvable' ? r : null
  })()
  const refusDuChoix = choix !== '' ? refusDeLaDesignation(piece, choix, contexte) : null

  return (
    <section className="fiche-hdf">
      <h3>{TITRE}</h3>
      {/* Écrit avant tout choix : il dit les deux cas, la facture source de sa vente et l'autre (étape VF3b3). */}
      <p className="muted">{PARAGRAPHE_DE_LA_DESIGNATION}</p>
      {geste !== null ? (
        <p className="fiche-hdf-refus">{geste}</p>
      ) : refusDeLaPiece !== null ? (
        <p className="fiche-hdf-refus">{refusDeLaPiece.message}</p>
      ) : lues.length === 0 ? (
        <p className="muted">Ce dossier n’a aucune facture émise validée : il n’y a rien à désigner.</p>
      ) : (
        <>
          <div className="field">
            <label htmlFor="exemplaire-facture">Facture dont cette pièce est l’exemplaire</label>
            <select id="exemplaire-facture" value={choix} disabled={occupe} onChange={(e) => setChoix(e.target.value)}>
              <option value="">— Choisir la facture —</option>
              {lues.map((f) => <option key={f.id} value={f.id}>{ligneDuChoix(f)}</option>)}
            </select>
          </div>
          {refusDuChoix !== null && <p className="fiche-hdf-refus">{refusDuChoix.message}</p>}
          <div className="fiche-hdf-actions">
            <button
              type="button"
              className="btn btn-outline btn-sm"
              disabled={occupe || choix === '' || refusDuChoix !== null}
              onClick={() => void designer()}
            >
              {occupe ? 'Désignation…' : 'Désigner comme exemplaire'}
            </button>
          </div>
        </>
      )}
      {erreur && <p className="error-text">{erreur}</p>}
      {relecturePerdue !== null && (
        <div className="fiche-hdf-actions">
          <button type="button" className="btn btn-outline btn-sm" disabled={occupe} onClick={() => void relireLaPiece()}>
            Relire la pièce
          </button>
        </div>
      )}
    </section>
  )
}
