import { useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { messageErreur } from '../../lib/messageErreur'
import type { LectureComplete } from '../../lib/lectureComplete'
import type { Piece } from '../../lib/types'
import {
  argumentsDeLaDeclaration, argumentsDeLaDesignation, argumentsDuRetraitDeLaDeclaration, argumentsDuRetraitDeLaDesignation,
  exerciceFigeantLaFactureSource, refusDeLaDeclaration, refusDeLaDesignationMarquee, refusDuRetraitDeLaDeclaration,
  refusDuRetraitMarque, type ContexteDesMarques,
} from '../../lib/exemplairesDesFactures'
import type { FactureProposee } from '../../lib/exemplairesDesFacturesLecture'
import {
  confirmationDeLaDeclaration, confirmationDeLaDesignation, confirmationDuRetraitDeLaDeclaration,
  confirmationDuRetraitDeLaDesignation, dateDuGeste, descriptionDeLaFacture, ligneDuChoix, PARAGRAPHE_D_UN_DOSSIER_BASCULE,
  PARAGRAPHE_DE_LA_DESIGNATION, phraseDeLaPieceDeclaree, phraseDeLaPieceDesignee, phraseDuGeste, phraseDuJournalIllisible,
  phraseDuJournalResteAilleurs, TITRE_DE_LA_SECTION, type CeQuElleEtait,
} from '../../lib/exemplairesDesFacturesEcran'
import { auteurDuGeste, journalDeLaPiece, type LectureDeCeQueLaPieceEst } from '../../lib/marquesDeLaPiece'

// CE QUE CETTE PIÈCE EST, DANS LA FICHE D'UNE PIÈCE DE VENTE (ligne 28.6, chantier EC-Q3 : étape VF1b, puis VF6c ; la base et
// la règle : VF1a et VF6b, lib/exemplairesDesFactures.ts). Une pièce de vente est l'EXEMPLAIRE d'une facture émise dans
// l'application — l'original que la plateforme du client a rendu, ou le PDF que le cabinet a déposé —, ou, dans un dossier dont
// les factures sont la source de leurs ventes, une VENTE HORS DES FACTURES de l'application (une prestation facturée
// ailleurs, une recette sans facture). Le cabinet la désigne ici, remplace la facture qu'elle désigne ou sa déclaration d'un
// seul geste (VF6-Q1), défait la désignation, la déclare, retire la déclaration ; et le journal dit qui a fait chaque geste,
// et quand. Des gestes du CABINET seul — la fiche d'une pièce n'est montée que par l'onglet des justificatifs du dossier,
// jamais dans l'espace du client, et la base refuse tout autre appelant (exemplaireCabinetSeul.test.ts).
//
// CE QU'ELLE NE FAIT JAMAIS :
// - rien sur une lecture pas encore revenue, partielle ou refusée : les factures émises du dossier et le gel de la pièce lui
//   viennent de l'onglet (lib/exemplairesDesFacturesLecture.ts, `piecesFigees`), la bascule du dossier, le pont de la pièce,
//   ses liens au relevé et le virement mixte de la fiche (lib/marquesDeLaPieceLecture.ts). Faute de l'un d'eux, elle ne
//   propose aucun geste, et le dit ;
// - rien d'écrit sans un clic confirmé qui NOMME la pièce et la facture, et dit ce que le geste change à ce qui se compte ;
//   ce que la base refuserait se dit AVANT le clic, par le module, dans son ordre et sous ses mots (sauf l'accès, qu'un écran
//   ne peut pas dire) — la base reste juge, et un refus qu'elle oppose quand même se dit à son tour (`messageErreur`) ;
// - rien proposé à la place du cabinet : aucune facture n'est choisie d'avance. Dans un dossier basculé, le pont DIT la
//   facture qu'il prouve (le refus de la déclaration la nomme) ; ce qu'il ne peut pas déduire, le cabinet le désigne ;
// - rien d'offert que la validation d'un exercice a figé (le gel des désignations, étape VF7e) : une désignation figée se dit
//   sous les mots de la base — « … figée par la validation de l'exercice … » — et aucun geste ne la change ; le choix dit
//   d'une facture source figée qu'elle l'est, et elle ne reçoit plus qu'une première désignation (VF7-Q1, option B), que la
//   confirmation dit aussitôt figée ;
// - rien d'affirmé du journal qu'elle n'a pas lu en entier : illisible, il le dit ; un auteur qu'elle ne peut pas nommer est
//   « un autre compte ».
//
// Le verrou d'écriture est un `useRef` posé avant le `try` et relâché APRÈS la relecture de la pièce (sa marque, la liste de
// l'onglet, ce qu'elle est) : la marque paraît, ou la base a vu ce que l'écran n'avait pas lu, et le refus suivant se dit
// avant le clic.

export interface DonneesExemplaire {
  /** Les factures émises VALIDÉES du dossier, lues en entier ; null avant leur première lecture. */
  factures: LectureComplete<FactureProposee> | null
  /** Relit les factures du dossier (l'onglet qui les a lues) : rendue quand la lecture est revenue. */
  relireLesFactures: () => Promise<void>
  /** L'exercice qui fige la pièce (`piecesFigees`), nul si rien ne la fige. */
  anneeFigeante: number | null
  /** Non nul quand les écritures validées ou les biens n'ont pas été lus en entier : on ne sait pas si la pièce est figée. */
  gelIncomplet: string | null
  /** Relit LA PIÈCE dans la liste de l'onglet après un geste : rendue quand la lecture est revenue, avec son motif si elle a
   * échoué (null sinon). L'onglet remplace la ligne de sa liste, et la désignation de la fiche ouverte. */
  relirePiece: (pieceId: string) => Promise<string | null>
}

/** Ce que la fiche a lu de ce que la pièce est (lib/marquesDeLaPieceLecture.ts), et de quoi le relire. */
export interface CeQueLaFicheSait {
  /** Null tant que la lecture n'est pas revenue — ou qu'elle était celle d'une autre pièce. */
  lecture: LectureDeCeQueLaPieceEst | null
  /** Relit ce que la pièce est : rendue quand la lecture est revenue. */
  relire: () => Promise<void>
  /** Après un geste : relit la marque de LA pièce, sa ligne dans l'onglet, et ce qu'elle est ; le motif d'un échec, ou null. */
  apresUnGeste: () => Promise<string | null>
  /** Le compte connecté : ses gestes se disent « par vous ». */
  moi: string | null
}

interface Props {
  dossierId: string
  /** La pièce TELLE QU'ENREGISTRÉE, sa marque relue après un geste : c'est à elle que la base juge chaque geste. */
  piece: Piece
  donnees: DonneesExemplaire
  ceQuElleEst: CeQueLaFicheSait
  /** Les noms des autres pièces qui portent la même facture quand le pont dit la vente comptée plusieurs fois ; null sinon. */
  autresPieces: readonly string[] | null
}

type Geste = 'designer_exemplaire_facture' | 'defaire_exemplaire_facture' | 'declarer_vente_hors_des_factures'
  | 'retirer_declaration_hors_des_factures'

export default function ExemplaireDeLaFacture({ dossierId, piece, donnees, ceQuElleEst, autresPieces }: Props) {
  const { factures, relireLesFactures, anneeFigeante, gelIncomplet } = donnees
  const { lecture, relire, apresUnGeste, moi } = ceQuElleEst
  const [choix, setChoix] = useState('')
  const [erreur, setErreur] = useState<string | null>(null)
  const [occupe, setOccupe] = useState<Geste | null>(null)
  // Posée quand la relecture de la pièce, après un geste, a échoué : l'écran ne sait plus ce que la base a retenu.
  const [relecturePerdue, setRelecturePerdue] = useState<string | null>(null)
  // Le verrou des quatre écritures de la section, posé avant le `try`, relâché après la relecture de la pièce : deux envois
  // du même rendu, ou un retrait parti pendant une désignation, seraient jugés par la base sur une pièce que l'écran n'a pas
  // relue. Et celui des relectures, qui ne lisent que.
  const ecritureEnCours = useRef(false)
  const relectureEnCours = useRef(false)

  const designee = piece.facture_id
  const declaree = piece.vente_hors_des_factures
  // Une pièce qui n'est pas une vente et ne porte rien n'a pas de section : les gestes sont ceux d'une pièce de vente.
  if (piece.type_piece !== 'vente' && designee === null && !declaree) return null

  async function relireSousVerrou(lire: () => Promise<void>) {
    if (relectureEnCours.current) return
    relectureEnCours.current = true
    try {
      await lire()
    } finally {
      relectureEnCours.current = false
    }
  }

  const enAttente = (texte: string) => (
    <section className="fiche-hdf" aria-label={TITRE_DE_LA_SECTION} aria-busy="true">
      <h3>{TITRE_DE_LA_SECTION}</h3>
      <p className="muted">{texte}</p>
    </section>
  )
  if (factures === null) return enAttente('Lecture des factures émises du dossier…')

  if (!factures.complete) {
    return (
      <section className="fiche-hdf" aria-label={TITRE_DE_LA_SECTION}>
        <h3>{TITRE_DE_LA_SECTION}</h3>
        <p className="error-text">
          Les factures émises du dossier n’ont pas pu être lues en entier ({factures.motif}) : cette pièce ne se désigne, ne
          se déclare ni ne se défait d’ici — le choix et la confirmation nomment une facture, qu’on ne peut pas nommer sur une
          liste incomplète.
        </p>
        <div className="fiche-hdf-actions">
          <button type="button" className="btn btn-outline btn-sm" onClick={() => void relireSousVerrou(relireLesFactures)}>
            Relire les factures
          </button>
        </div>
      </section>
    )
  }
  if (lecture === null || lecture.pour !== piece.id) return enAttente('Lecture de ce que la pièce est et de son journal…')

  if (lecture.contexte.etat === 'incomplet') {
    return (
      <section className="fiche-hdf" aria-label={TITRE_DE_LA_SECTION}>
        <h3>{TITRE_DE_LA_SECTION}</h3>
        <p className="error-text">
          Ce que la base dit de cette pièce n’a pas pu être lu en entier ({lecture.contexte.motif}) : elle ne se désigne, ne se
          déclare ni ne se défait d’ici, et sa validation attend.
        </p>
        <div className="fiche-hdf-actions">
          <button type="button" className="btn btn-outline btn-sm" onClick={() => void relireSousVerrou(relire)}>
            Relire
          </button>
        </div>
      </section>
    )
  }

  const lues = factures.lignes
  const lu = lecture.contexte.contexte
  const bascule = lu.dossierBascule
  const facture = designee === null ? null : lues.find((f) => f.id === designee) ?? null
  const contexte: ContexteDesMarques = {
    dossierId, anneeFigeante, factures: lues, exercicesValides: lu.exercicesValides, dossierBascule: bascule, pont: lu.pont,
    liens: lu.liens, facturesDuVirementMixte: lu.facturesDuVirementMixte,
  }
  // L'exercice validé qui fige une facture source (VF7e) : le choix et la confirmation le disent.
  const gelDe = (f: FactureProposee) => exerciceFigeantLaFactureSource(f, lu.exercicesValides)
  const avant: CeQuElleEtait = facture !== null ? { genre: 'designee', facture } : declaree ? { genre: 'declaree' } : { genre: 'rien' }

  // On ne sait pas si la pièce est figée, la dernière relecture de la pièce a échoué, ou la facture qu'elle désigne manque à
  // la liste lue : la base jugerait sur autre chose que ce que l'écran montre, et la confirmation ne pourrait pas la nommer.
  const bloque = gelIncomplet !== null
    ? `La liste des écritures validées n’a pas pu être lue en entier (${gelIncomplet}) : faute de savoir si un exercice validé fige cette pièce, sa marque ne change pas d’ici.`
    : relecturePerdue !== null
      ? `La pièce n’a pas pu être relue après le dernier geste (${relecturePerdue}) : l’écran ne sait plus ce qu’elle est.`
      : designee !== null && facture === null
        ? 'Cette pièce est désignée comme l’exemplaire d’une facture émise que la liste lue ne contient pas : son numéro ne peut pas être dit, et sa marque ne change pas d’ici.'
        : null

  // Les refus du module, jugés sur la pièce TELLE QU'ENREGISTRÉE. Celui de la pièce, sans rien choisir : ce qu'une désignation,
  // quelle que soit la facture, rencontrerait d'abord (la facture introuvable est celle du choix vide, pas un refus de la pièce).
  const refusDeLaPiece = (() => {
    const r = refusDeLaDesignationMarquee(piece, null, contexte)
    return r !== null && r.cle !== 'facture_introuvable' ? r : null
  })()
  const refusDuChoix = choix !== '' ? refusDeLaDesignationMarquee(piece, choix, contexte) : null
  const refusDuRetrait = designee !== null ? refusDuRetraitMarque(piece, contexte) : null
  // La déclaration ne s'offre que dans un dossier basculé (hors de lui elle ne dirait rien) ; refusée, son refus se dit pour
  // une pièce que rien ne marque — c'est là qu'il nomme la facture que le pont prouve, ou les preuves qui se contredisent.
  const refusDeclaration = bascule && !declaree ? refusDeLaDeclaration(piece, contexte) : null
  const refusRetraitDeclaration = declaree ? refusDuRetraitDeLaDeclaration(piece, contexte) : null
  const refusDits = [...new Set([
    refusDeLaPiece?.message,
    refusDuRetrait?.message,
    designee === null ? refusDeclaration?.message : undefined,
    refusRetraitDeclaration?.message,
  ].filter((m): m is string => m !== undefined))]

  // Un geste : confirmé, puis la fonction seule, sous le verrou ; relue dans les deux cas AVANT de relâcher le verrou —
  // marquée, la pièce le montre ; refusée, la base a peut-être vu ce que l'écran n'avait pas lu, et le refus suivant se dira
  // avant le clic.
  async function executer(geste: Geste, args: Record<string, string>, confirmation: string, repli: string, reussi?: () => void) {
    if (ecritureEnCours.current || bloque !== null) return
    if (!window.confirm(confirmation)) return
    // Posé AVANT le `try` et avant le premier `await` : un verrou posé après ne verrouille rien.
    ecritureEnCours.current = true
    setOccupe(geste)
    setErreur(null)
    try {
      const { error } = await supabase.rpc(geste, args)
      if (error) setErreur(messageErreur(error, repli))
      else reussi?.()
      setRelecturePerdue(await apresUnGeste())
    } finally {
      ecritureEnCours.current = false
      setOccupe(null)
    }
  }

  function designer() {
    // Le refus du module, jugé sur la saisie TELLE QU'ELLE PART.
    if (choix === '' || refusDeLaDesignationMarquee(piece, choix, contexte) !== null) return
    const cible = lues.find((f) => f.id === choix)
    if (!cible) return
    void executer('designer_exemplaire_facture', argumentsDeLaDesignation(dossierId, piece.id, choix),
      confirmationDeLaDesignation(piece.nom_fichier, cible, avant, gelDe(cible)), 'La pièce n’a pas pu être désignée.',
      () => setChoix(''))
  }

  function defaire() {
    if (facture === null || refusDuRetraitMarque(piece, contexte) !== null) return
    void executer('defaire_exemplaire_facture', argumentsDuRetraitDeLaDesignation(dossierId, piece.id),
      confirmationDuRetraitDeLaDesignation(piece.nom_fichier, facture, autresPieces, bascule),
      'La désignation n’a pas pu être défaite.')
  }

  function declarer() {
    if (!bascule || declaree || refusDeLaDeclaration(piece, contexte) !== null) return
    void executer('declarer_vente_hors_des_factures', argumentsDeLaDeclaration(dossierId, piece.id),
      confirmationDeLaDeclaration(piece.nom_fichier, facture !== null ? { genre: 'designee', facture } : { genre: 'rien' }),
      'La pièce n’a pas pu être déclarée.')
  }

  function retirerLaDeclaration() {
    if (!declaree || refusDuRetraitDeLaDeclaration(piece, contexte) !== null) return
    void executer('retirer_declaration_hors_des_factures', argumentsDuRetraitDeLaDeclaration(dossierId, piece.id),
      confirmationDuRetraitDeLaDeclaration(piece.nom_fichier, bascule), 'La déclaration n’a pas pu être retirée.')
  }

  const occupee = occupe !== null
  const offreDesigner = bloque === null && refusDeLaPiece === null && lues.length > 0
  const offreDefaire = bloque === null && facture !== null && refusDuRetrait === null
  const offreDeclarer = bloque === null && bascule && !declaree && refusDeclaration === null
  const offreRetirer = bloque === null && declaree && refusRetraitDeclaration === null

  return (
    <section className="fiche-hdf" aria-label={TITRE_DE_LA_SECTION}>
      <h3>{TITRE_DE_LA_SECTION}</h3>
      {facture !== null ? (
        <dl className="fiche-hdf-detail">
          <dt>{facture.type === 'avoir' ? 'Avoir' : 'Facture'}</dt>
          <dd>
            <span className="nom-fichier">{facture.numero ?? '(sans numéro)'}</span> — {descriptionDeLaFacture(facture)}
          </dd>
          <dt>Désignation</dt>
          <dd>{phraseDeLaPieceDesignee(facture)}</dd>
        </dl>
      ) : declaree ? (
        <p>{phraseDeLaPieceDeclaree(bascule)}</p>
      ) : designee === null ? (
        // Écrit avant tout choix : il dit les deux cas, la facture source de sa vente et l'autre (étape VF3b3) ; et, dans un
        // dossier basculé, les deux marques que la validation attend (G3).
        <p className="muted">{bascule ? PARAGRAPHE_D_UN_DOSSIER_BASCULE : PARAGRAPHE_DE_LA_DESIGNATION}</p>
      ) : null}

      {bloque !== null ? <p className="fiche-hdf-refus">{bloque}</p> : refusDits.map((m) => <p key={m} className="fiche-hdf-refus">{m}</p>)}

      {bloque === null && refusDeLaPiece === null && lues.length === 0 && designee === null && (
        <p className="muted">Ce dossier n’a aucune facture émise validée : il n’y a rien à désigner.</p>
      )}
      {offreDesigner && (
        <>
          <div className="field">
            <label htmlFor="exemplaire-facture">
              {designee !== null ? 'Désigner une autre facture à la place' : 'Facture dont cette pièce est l’exemplaire'}
            </label>
            <select id="exemplaire-facture" value={choix} disabled={occupee} onChange={(e) => setChoix(e.target.value)}>
              <option value="">— Choisir la facture —</option>
              {lues.map((f) => <option key={f.id} value={f.id}>{ligneDuChoix(f, gelDe(f))}</option>)}
            </select>
          </div>
          {refusDuChoix !== null && <p className="fiche-hdf-refus">{refusDuChoix.message}</p>}
        </>
      )}
      {(offreDesigner || offreDefaire || offreDeclarer || offreRetirer) && (
        <div className="fiche-hdf-actions">
          {offreDesigner && (
            <button
              type="button"
              className="btn btn-outline btn-sm"
              disabled={occupee || choix === '' || refusDuChoix !== null}
              onClick={designer}
            >
              {occupe === 'designer_exemplaire_facture' ? 'Désignation…'
                : designee !== null ? 'Désigner cette facture à la place' : 'Désigner comme exemplaire'}
            </button>
          )}
          {offreDefaire && (
            <button type="button" className="btn btn-outline btn-sm" disabled={occupee} onClick={defaire}>
              {occupe === 'defaire_exemplaire_facture' ? 'Désignation défaite…' : 'Défaire la désignation'}
            </button>
          )}
          {offreDeclarer && (
            <button type="button" className="btn btn-outline btn-sm" disabled={occupee} onClick={declarer}>
              {occupe === 'declarer_vente_hors_des_factures' ? 'Déclaration…' : 'Déclarer vente hors des factures de l’application'}
            </button>
          )}
          {offreRetirer && (
            <button type="button" className="btn btn-outline btn-sm" disabled={occupee} onClick={retirerLaDeclaration}>
              {occupe === 'retirer_declaration_hors_des_factures' ? 'Retrait…' : 'Retirer la déclaration'}
            </button>
          )}
        </div>
      )}
      {erreur && <p className="error-text">{erreur}</p>}
      {relecturePerdue !== null && (
        <div className="fiche-hdf-actions">
          <button
            type="button"
            className="btn btn-outline btn-sm"
            disabled={occupee}
            onClick={() => void relireSousVerrou(async () => { setRelecturePerdue(await apresUnGeste()) })}
          >
            Relire la pièce
          </button>
        </div>
      )}

      <JournalDeLaPiece dossierId={dossierId} pieceId={piece.id} lecture={lecture} factures={lues} moi={moi} />
    </section>
  )
}

// LE JOURNAL DE LA PIÈCE (VF6-Q3) : chaque geste de ce dossier, qui l'a fait et quand ; ceux qui sont restés dans un autre
// dossier quand la pièce en vient (VF6B-Q1) ; illisible, il le dit, et n'affirme rien — ni le vide, ni l'absence d'un
// journal ailleurs.
function JournalDeLaPiece({ dossierId, pieceId, lecture, factures, moi }: {
  dossierId: string
  pieceId: string
  lecture: LectureDeCeQueLaPieceEst
  factures: readonly FactureProposee[]
  moi: string | null
}) {
  const journal = lecture.journal
  if (journal === null) return null
  return (
    <div className="fiche-hdf-saisie" aria-label="Journal de la pièce">
      <p className="fiche-hdf-sous-titre">Journal de la pièce</p>
      {journal.etat === 'incomplet' ? (
        <p className="error-text">{phraseDuJournalIllisible(journal.motif)}</p>
      ) : (() => {
        const { ici, ailleurs } = journalDeLaPiece(journal.lignes, dossierId, pieceId)
        return (
          <>
            {ici.length === 0 ? (
              <p className="muted">Aucun geste de ce dossier n’est inscrit au journal de cette pièce.</p>
            ) : (
              <ul className="fiche-hdf-signaux">
                {ici.map((l) => {
                  const auteur = auteurDuGeste(l.auteur_id, moi, lecture.equipe)
                  return (
                    <li key={l.id}>
                      {phraseDuGeste(l, factures)} — par{' '}
                      {auteur.includes('@') ? <span className="courriel">{auteur}</span> : auteur}, le {dateDuGeste(l)}
                    </li>
                  )
                })}
              </ul>
            )}
            {ici.length > 0 && lecture.equipe !== null && lecture.equipe.etat === 'incomplete' && (
              <p className="muted">
                La liste de l’équipe n’a pas pu être lue en entier ({lecture.equipe.motif}) : les auteurs ne se nomment pas.
              </p>
            )}
            {ailleurs.map((a) => (
              <p key={a.dossierId} className="muted">
                {phraseDuJournalResteAilleurs(a.gestes, journal.nomsDesAutresDossiers?.get(a.dossierId) ?? null)}
              </p>
            ))}
          </>
        )
      })()}
    </div>
  )
}
