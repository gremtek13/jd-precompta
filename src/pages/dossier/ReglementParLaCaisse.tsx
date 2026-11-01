import { useRef, useState, type KeyboardEvent } from 'react'
import { useExercicesValides } from '../../context/ExercicesValidesContext'
import { origineDite } from '../../lib/caisse'
import type { ContexteDeLaCaisse } from '../../lib/caisseEcran'
import type { ModeleComptable } from '../../lib/engagement'
import { aujourdHuiAParis } from '../../lib/format'
import type { LectureComplete } from '../../lib/lectureComplete'
import { messageErreur } from '../../lib/messageErreur'
import {
  avertissementDuReglement, confirmationDuReglement, confirmationDuRetraitDuPaiement, etatDeLaCaisseDeLaFiche, montantPropose,
  paiementNomme, paiementsDeLaPiece, pieceDuPaiement, refusDuRetraitDuPaiement, verdictDuReglement, type FactureDuPaiement,
  type LectureDeLaCaisseDeLaPiece,
} from '../../lib/paiementParLaCaisseEcran'
import type { PaiementsDesPieces } from '../../lib/rattachement'
import { supabase } from '../../lib/supabase'
import type { OperationCaisse, Piece } from '../../lib/types'

// « RÉGLER PAR LA CAISSE », DANS LA FICHE D'UNE PIÈCE, CÔTÉ CABINET (ligne 26.6, étape C9b ; CAISSE-Q4, (B)). Une pièce payée en
// espèces se règle par la caisse du dossier : une opération de genre `paiement` qui la cite, à sa date, d'un montant signé
// comme le relevé (`regler_piece_par_la_caisse`, la migration `paiement_par_la_caisse`). La logique est dans
// lib/paiementParLaCaisseEcran.ts et lib/paiementParLaCaisse.ts : l'écran appelle, affiche, et pose le verrou.
//
// LES RÈGLES DES ÉCRANS QUI S'APPLIQUENT : rien avant le retour de la lecture ; la caisse lue EN ENTIER — lue en partie, la
// section le dit et n'offre AUCUN geste ; un geste passe la fonction SQL seule, sous un verrou `useRef` posé avant l'appel et
// relâché dans un `finally` APRÈS la relecture ; chaque refus se dit AVANT le clic, sur la saisie telle qu'elle part ; une
// confirmation nomme ce qui part ; l'erreur de la base se dit (`messageErreur`). Le drapeau `PAIEMENT_PAR_LA_CAISSE_EXPORTE`
// baissé, la section ne se monte pas (`etatDeLaCaisseDeLaFiche` rend `absente`) : la fiche est celle d'hier.
//
// UNE CAISSE NE NOMME PERSONNE : la section dit le jour et les espèces d'un paiement, jamais un tiers ; la pièce elle-même est
// celle que la fiche montre, comme ailleurs, et la caisse n'en stocke rien.

/** Ce que l'onglet Justificatifs donne à la fiche pour la caisse : la lecture, le dossier, les paiements, et de quoi relire. */
export interface CaisseDeLaPiece {
  /** La caisse du dossier (`lireLaCaisseDuDossier`), ou nulle tant qu'elle n'est pas revenue. */
  lecture: LectureDeLaCaisseDeLaPiece | null
  modele: ModeleComptable
  assujettiTva: boolean
  /**
   * Les paiements de chaque pièce — le relevé, les parts des virements, et la caisse —, tous lus en entier ; nuls sinon : le
   * reste à régler ne se propose pas, et la pièce ne se règle pas d'ici — la base juge le reste au centime sur ses paiements
   * du relevé aussi (relecture du 01/11/2026), et la fiche ne dit pas avant le clic ce qu'elle n'a pas lu.
   */
  paiements: PaiementsDesPieces | null
  /** Relit la caisse et les paiements de l'onglet ; rendue quand la relecture est revenue. */
  relire: () => Promise<void>
}

export const TITRE_DE_LA_CAISSE = 'Payée en espèces'

// La section vit dans le formulaire de la fiche : « Entrée » dans l'un de ses champs l'enverrait — et validerait la pièce. Le
// paiement ne part que par son bouton, après sa confirmation.
function sansEnvoi(e: KeyboardEvent<HTMLInputElement>) {
  if (e.key === 'Enter') e.preventDefault()
}

export default function ReglementParLaCaisse({ dossierId, piece, factures, caisse }: {
  dossierId: string
  /** La pièce TELLE QU'ENREGISTRÉE (sa marque relue) : c'est elle que la base juge. */
  piece: Piece
  factures: LectureComplete<FactureDuPaiement> | null
  caisse: CaisseDeLaPiece
}) {
  const { anneesValidees } = useExercicesValides()
  const [date, setDate] = useState('')
  // Le montant TAPÉ, ou nul tant que le cabinet n'y a pas touché : le champ propose alors le reste à régler.
  const [montantTape, setMontantTape] = useState<string | null>(null)
  const [message, setMessage] = useState<{ genre: 'ok' | 'erreur'; texte: string } | null>(null)
  // UN verrou pour les deux gestes (régler, retirer) : deux gestes qui se croisent jugeraient la caisse sur deux lectures.
  const ecritureEnCours = useRef(false)
  const [enCours, setEnCours] = useState(false)

  const etat = etatDeLaCaisseDeLaFiche(caisse.lecture, dossierId)
  if (etat.etat === 'absente') return null
  // La caisse ne se tient qu'en trésorerie (la base refuse le paiement d'un dossier en engagement) : rien à dire ici.
  if (caisse.modele.mode !== 'tresorerie') return null

  if (etat.etat === 'en_attente') {
    return (
      <section className="fiche-hdf" aria-label={TITRE_DE_LA_CAISSE} aria-busy="true">
        <h3>{TITRE_DE_LA_CAISSE}</h3>
        <p className="muted">Lecture de la caisse du dossier…</p>
      </section>
    )
  }
  if (etat.etat === 'incomplete') {
    return (
      <section className="fiche-hdf" aria-label={TITRE_DE_LA_CAISSE}>
        <h3>{TITRE_DE_LA_CAISSE}</h3>
        <p className="error-text">
          La caisse du dossier n’a pas pu être lue en entier ({etat.motif}) : ses paiements en espèces ne se disent pas, et cette
          pièce ne se règle ni ne se retire de la caisse d’ici. Recharge la page.
        </p>
      </section>
    )
  }

  const donnees = etat.donnees
  const paiements = paiementsDeLaPiece(piece.id, donnees.operations)
  // Une pièce qui n'est ni d'achat ni de vente ne se paie pas par la caisse : sans paiement, la section ne se montre pas.
  const reglable = piece.type_piece === 'achat' || piece.type_piece === 'vente'
  if (!reglable && paiements.length === 0) return null

  // Le jour à Paris, relu à chaque rendu : « maintenant » ne se lit jamais au chargement d'un module.
  const ctx: ContexteDeLaCaisse = { modele: caisse.modele, assujettiTva: caisse.assujettiTva, aujourdhui: aujourdHuiAParis(), anneesValidees }
  // Les paiements de la pièce — le relevé et la caisse —, lus en entier, ou nuls : la base juge le reste au centime sur ceux du
  // relevé aussi (relecture du 01/11/2026), et la fiche ne règle rien sur des paiements qu'elle n'a pas tous lus.
  const sesPaiements = caisse.paiements === null ? null : caisse.paiements.get(piece.id) ?? []
  const laPiece = pieceDuPaiement(piece, factures, sesPaiements)
  const proposition = montantPropose(piece, sesPaiements)
  const montant = montantTape ?? proposition
  const verdict = 'piece' in laPiece ? verdictDuReglement({ date, montant }, ctx, donnees, laPiece.piece) : null
  // La pièce déjà payée par la banque, ou payée en trop : dit avant le clic, et repris par la confirmation (rien ne se refuse).
  const avertissement = verdict?.etat === 'permis' && 'piece' in laPiece
    ? avertissementDuReglement(laPiece.piece, donnees, Math.round(verdict.operation.montant * 100))
    : null

  // Un geste : le verrou, l'appel, la relecture (même sur un refus : la base a peut-être vu ce que l'écran n'avait pas lu), le
  // message. `appel` rend le refus de la base en clair, ou rien quand elle a écrit.
  async function agir(appel: () => Promise<string | null>, reussite: string, echec: string, apres?: () => void) {
    if (ecritureEnCours.current) return
    ecritureEnCours.current = true
    setEnCours(true)
    setMessage(null)
    try {
      const refus = await appel()
      if (refus !== null) setMessage({ genre: 'erreur', texte: `${echec} : ${refus}` })
      else {
        apres?.()
        setMessage({ genre: 'ok', texte: reussite })
      }
      await caisse.relire()
    } finally {
      ecritureEnCours.current = false
      setEnCours(false)
    }
  }

  async function regler() {
    if (ecritureEnCours.current || verdict === null || verdict.etat !== 'permis') return
    if (!window.confirm(confirmationDuReglement(piece.nom_fichier, verdict, caisse.modele.plan.caisse, avertissement))) return
    const { saisie } = verdict
    await agir(async () => {
      const { error } = await supabase.rpc('regler_piece_par_la_caisse', {
        p_dossier_id: dossierId, p_piece_id: saisie.piece_id, p_date: saisie.date, p_montant: saisie.montant,
      })
      return error ? messageErreur(error, 'raison inconnue') : null
    }, `Réglée par la caisse : ${paiementNomme(verdict.operation)}.`, 'Le paiement n’a pas été enregistré', () => {
      setDate('')
      setMontantTape(null)
    })
  }

  async function retirer(o: OperationCaisse) {
    if (ecritureEnCours.current || refusDuRetraitDuPaiement(o.id, ctx, donnees) !== null) return
    if (!window.confirm(confirmationDuRetraitDuPaiement(o, ctx, donnees))) return
    await agir(async () => {
      const { error } = await supabase.rpc('retirer_operation_caisse', { p_dossier_id: dossierId, p_operation_id: o.id })
      return error ? messageErreur(error, 'raison inconnue') : null
    }, `Retiré : ${paiementNomme(o)}.`, 'Le paiement n’a pas été retiré')
  }

  return (
    <section className="fiche-hdf" aria-label={TITRE_DE_LA_CAISSE}>
      <h3>{TITRE_DE_LA_CAISSE}</h3>
      {paiements.length === 0
        ? <p className="muted">Aucun paiement de cette pièce par la caisse du dossier.</p>
        : (
          <ul style={{ margin: '0 0 8px', paddingLeft: 18 }}>
            {paiements.map((o) => {
              const refus = o.retire_le == null ? refusDuRetraitDuPaiement(o.id, ctx, donnees) : null
              const origine = origineDite(o)
              return (
                <li key={o.id}>
                  <span>{paiementNomme(o).replace(/^./, (c) => c.toUpperCase())}</span>
                  {origine && <> <span className="badge badge-neutral">{origine}</span></>}
                  {o.retire_le != null
                    ? <> <span className="badge badge-neutral">Retiré</span></>
                    : (
                      <>
                        {' '}
                        <button
                          type="button" className="btn btn-outline btn-sm" disabled={enCours || refus !== null}
                          title={refus ?? undefined} onClick={() => { void retirer(o) }}
                        >
                          Retirer
                        </button>
                        {refus !== null && <span className="muted"> {refus}</span>}
                      </>
                    )}
                </li>
              )
            })}
          </ul>
        )}

      {reglable && ('illisible' in laPiece
        ? (
          <p className="error-text">
            Cette pièce ne se règle pas par la caisse d’ici : {laPiece.illisible}. Recharge la page.
          </p>
        )
        : (
          <>
            <div className="field-row aligne-bas">
              <div className="field">
                <label htmlFor="caisse-paiement-date">Jour du paiement en espèces</label>
                <input
                  id="caisse-paiement-date" type="date" value={date} disabled={enCours} onKeyDown={sansEnvoi}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="caisse-paiement-montant">Montant (signé comme le relevé)</label>
                <input
                  id="caisse-paiement-montant" type="text" inputMode="decimal" autoComplete="off" value={montant} disabled={enCours}
                  placeholder={piece.type_piece === 'vente' ? 'ex. 80,00' : 'ex. -80,00'}
                  onKeyDown={sansEnvoi} onChange={(e) => setMontantTape(e.target.value)}
                />
              </div>
              <button
                type="button" className="btn btn-outline btn-sm" disabled={enCours || verdict === null || verdict.etat !== 'permis'}
                onClick={() => { void regler() }}
              >
                {enCours ? 'Écriture…' : 'Régler par la caisse'}
              </button>
            </div>
            <p className="muted" style={{ margin: '0 0 6px' }}>
              {proposition !== '' && montantTape === null
                ? 'Le montant proposé est ce qu’il reste à régler de la pièce. '
                : ''}
              Une sortie d’espèces s’écrit en négatif, une entrée en positif — l’inverse pour un avoir. Si le praticien a payé de sa
              poche, ce n’est pas la caisse : c’est une note de frais.
            </p>
            {verdict !== null && (verdict.etat === 'refuse' || verdict.etat === 'illisible') && (
              <p className="error-text" role="alert">{verdict.message}</p>
            )}
            {avertissement !== null && <p className="muted" role="status">{avertissement}</p>}
          </>
        ))}

      {message && (
        <p className={message.genre === 'erreur' ? 'error-text' : 'muted'} role={message.genre === 'erreur' ? 'alert' : 'status'}>
          {message.texte}
        </p>
      )}
    </section>
  )
}
