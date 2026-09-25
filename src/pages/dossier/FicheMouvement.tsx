import { useState, type ReactNode } from 'react'
import { EntetePanneau } from '../../components/PanneauDroit'
import { IconAttention, IconChevron, IconCoche, IconPrecedent } from '../../components/icons'
import {
  candidatsCotisations, candidatsPieces, ecartEnJours, libelleExploitable, sensCoherent, tiersConfirmeParBanque,
} from '../../lib/appariementBanque'
import { ecartAvecBanque } from '../../lib/alignementBanque'
import { mouvementRapprocheSansObjet } from '../../lib/controles'
import { ouvrirJustificatif } from '../../lib/depot'
import { formatDate, formatMoney } from '../../lib/format'
import type { CotisationDeclaree, LigneBancaire, Piece } from '../../lib/types'

// Le rapprochement d'un mouvement bancaire, dans le panneau de droite — étape 2 de l'interface
// d'ordinateur, comme la fiche d'une pièce (voir FichePiece). Il remplace la fenêtre qui assombrissait
// tout l'écran : le relevé reste visible et cliquable à côté, et on arbitre un mouvement en gardant
// ses voisins sous les yeux.
//
// Trois choix, tirés de la maquette validée par le cabinet :
// - la pièce proposée se JUSTIFIE. Les signaux que le rapprochement mesure — montant, écart de date,
//   fournisseur retrouvé dans le libellé — sont dits, et ce qui ne concorde pas l'est aussi : trois
//   coches alignées sous une pièce que le rapprochement certain refuserait feraient d'une
//   ressemblance une preuve (voir lib/appariementBanque.ts, « trois signaux, tous obligatoires ») ;
// - quand plusieurs pièces conviennent AUSSI BIEN, aucune n'est « proposée » : elles sont toutes
//   montrées, chacune avec son justificatif. C'est le cas que « Tout rapprocher automatiquement »
//   refuse de trancher, et mettre la première en avant le trancherait à sa place, par l'ordre de tri ;
// - après une action, le mouvement RESTE affiché, dans son nouvel état (« Rapproché avec… ») : on voit
//   ce qu'on vient de faire, l'annulation est à portée de main, et « Suivant » mène au mouvement qui a
//   pris sa place dans la liste (voir BanqueTab).

export interface NavigationMouvement {
  position: string
  precedent: (() => void) | null
  suivant: (() => void) | null
}

export interface RecurrenceMouvement {
  action: 'ignorer' | 'virement_personnel'
  occurrences: number
}

interface FicheMouvementProps {
  ligne: LigneBancaire
  // Toutes les pièces chargées, à valider comprises : le choix à la main les offre toutes.
  pieces: Piece[]
  // Les seules qu'on PROPOSE : une proposition ne porte que sur une pièce relue par le cabinet —
  // rapprocher sur de l'OCR non validé écrirait une écriture sur un montant que personne n'a confirmé.
  piecesValidees: Piece[]
  cotisations: CotisationDeclaree[]
  piecesRapprochees: ReadonlySet<string>
  cotisationsRapprochees: ReadonlySet<string>
  recurrence: RecurrenceMouvement | null
  navigation: NavigationMouvement
  // Une écriture est en cours sur ce relevé — sur ce mouvement ou par un rapprochement en lot. Les
  // actions attendent qu'elle finisse : deux écritures qui se croisent sur le même mouvement
  // laisseraient une contrepartie banque sans rapprochement en face (voir BanqueTab).
  occupe: boolean
  onFermer: () => void
  onRapprocher: (pieceId: string) => void
  onRapprocherCotisation: (cotisationId: string) => void
  onVirementPersonnel: () => void
  onIgnorer: () => void
  onToujoursIgnorer: () => void
  onRemettreATraiter: () => void
}

interface Signal { ok: boolean; texte: string }

function joursDEcart(jours: number, avec: string): string {
  if (jours === 0) return `Même date que ${avec}`
  return `${jours} jour${jours > 1 ? 's' : ''} d’écart avec ${avec}`
}

// Les signaux d'une pièce candidate. Le montant concorde par construction — `candidatsPieces` ne rend
// que celles-là, au centime près — ; le fournisseur et le sens, non, et ce sont eux qui séparent une
// concordance d'une coïncidence. Le sens n'est dit que lorsqu'il est CONTRAIRE : `candidatsPieces`
// compare les montants en valeur absolue, donc un remboursement du même montant se voit proposer
// l'achat qu'il annule.
function signauxPiece(piece: Piece, ligne: LigneBancaire): Signal[] {
  const signaux: Signal[] = [{ ok: true, texte: 'Même montant, au centime près' }]
  if (piece.date_piece) {
    signaux.push({ ok: true, texte: joursDEcart(ecartEnJours(piece.date_piece, ligne.date), 'la pièce') })
  }
  if (!piece.tiers?.trim()) {
    signaux.push({ ok: false, texte: 'Aucun fournisseur lu sur la pièce' })
  } else if (tiersConfirmeParBanque(piece.tiers, libelleExploitable(ligne))) {
    signaux.push({ ok: true, texte: 'Fournisseur retrouvé dans le libellé bancaire' })
  } else {
    signaux.push({ ok: false, texte: 'Fournisseur non retrouvé dans le libellé bancaire' })
  }
  if (!sensCoherent(piece, ligne)) {
    signaux.push({
      ok: false,
      texte: ligne.montant > 0
        ? 'Sens contraire : la pièce attend un paiement, le relevé montre un crédit'
        : 'Sens contraire : la pièce attend un encaissement, le relevé montre un débit',
    })
  }
  return signaux
}

function signauxCotisation(cotisation: CotisationDeclaree, ligne: LigneBancaire): Signal[] {
  return [
    {
      ok: true,
      texte: cotisation.montant_verse != null ? 'Même montant que le versement déclaré' : 'Même montant que l’appel de cotisation',
    },
    { ok: true, texte: joursDEcart(ecartEnJours(cotisation.echeance, ligne.date), 'l’échéance') },
  ]
}

// Trie les pièces et échéances du choix à la main par plausibilité pour ce mouvement — montant
// identique d'abord, puis proximité de date — plutôt que dans l'ordre de la requête, qui mélangeait
// une pièce de l'année avec une pièce de deux ans plus tôt (voir audit ergonomie). Un score, pas un
// filtre : aucune n'est retirée, on peut toujours associer une pièce d'une autre année.
function scoreCorrespondance(montantRef: number | null, dateRef: string | null, ligne: LigneBancaire): number {
  const montantOk = montantRef != null && Math.abs(Math.abs(montantRef) - Math.abs(ligne.montant)) <= 0.01
  const jours = dateRef ? ecartEnJours(dateRef, ligne.date) : Number.MAX_SAFE_INTEGER
  return (montantOk ? 0 : 1_000_000) + jours
}

function ListeSignaux({ signaux }: { signaux: Signal[] }) {
  return (
    <ul className="signaux-rapprochement">
      {signaux.map((s) => (
        <li key={s.texte} className={s.ok ? 'signal-concordant' : 'signal-reserve'}>
          {s.ok
            ? <IconCoche width={15} height={15} aria-hidden="true" />
            : <IconAttention width={15} height={15} aria-hidden="true" />}
          <span>{s.texte}</span>
        </li>
      ))}
    </ul>
  )
}

function CartePiece({ piece, signaux, action }: { piece: Piece; signaux?: Signal[]; action?: ReactNode }) {
  return (
    <div className="carte-rapprochement">
      <div className="carte-rapprochement-entete">
        <div className="carte-rapprochement-titres">
          <strong>{piece.tiers?.trim() || piece.nom_fichier}</strong>
          <span>{piece.date_piece ? `Pièce du ${formatDate(piece.date_piece)}` : 'Pièce sans date'}</span>
        </div>
        <strong className="carte-rapprochement-montant">{formatMoney(piece.montant_ttc)}</strong>
      </div>
      {signaux && <ListeSignaux signaux={signaux} />}
      <div className="carte-rapprochement-actions">
        {/* Le justificatif s'ouvre à côté, sans quitter le mouvement : c'est ce qu'on regarde avant de
            confirmer (voir audit ergonomie comparatif). */}
        <button type="button" className="carte-rapprochement-lien" onClick={() => ouvrirJustificatif(piece.storage_path)}>
          Voir le justificatif
        </button>
        {action}
      </div>
    </div>
  )
}

function CarteCotisation({ cotisation, signaux, action }: { cotisation: CotisationDeclaree; signaux?: Signal[]; action?: ReactNode }) {
  return (
    <div className="carte-rapprochement">
      <div className="carte-rapprochement-entete">
        <div className="carte-rapprochement-titres">
          <strong>Cotisation sociale</strong>
          <span>
            Échéance du {formatDate(cotisation.echeance)}
            {cotisation.previsionnel ? ' (prévisionnelle)' : ''}
          </span>
        </div>
        <strong className="carte-rapprochement-montant">{formatMoney(cotisation.montant_verse ?? cotisation.montant_appele)}</strong>
      </div>
      {signaux && <ListeSignaux signaux={signaux} />}
      {action && <div className="carte-rapprochement-actions">{action}</div>}
    </div>
  )
}

export default function FicheMouvement({
  ligne, pieces, piecesValidees, cotisations, piecesRapprochees, cotisationsRapprochees, recurrence,
  navigation, occupe,
  onFermer, onRapprocher, onRapprocherCotisation, onVirementPersonnel, onIgnorer, onToujoursIgnorer, onRemettreATraiter,
}: FicheMouvementProps) {
  // Le choix à la main ne s'applique qu'au clic sur « Associer », jamais au changement de la liste :
  // sur une liste déroulante qui a le focus, les flèches du clavier changent la valeur — et
  // rapprochaient donc, dans la fenêtre d'avant, la première pièce venue sans qu'on l'ait choisie.
  const [pieceChoisie, setPieceChoisie] = useState('')
  const [cotisationChoisie, setCotisationChoisie] = useState('')

  const aTraiter = ligne.statut === 'non_rapprochee'
  const libelle = libelleExploitable(ligne) || ligne.libelle
  const sansObjet = mouvementRapprocheSansObjet(ligne)

  // Même précédence que le rapprochement automatique : une pièce avant une échéance, une échéance
  // avant une récurrence. Ce n'est pas un arbitrage entre égaux mais une règle de l'écran.
  const piecesCandidates = aTraiter ? candidatsPieces(ligne, piecesValidees, piecesRapprochees) : []
  const echeancesCandidates = aTraiter && piecesCandidates.length === 0
    ? candidatsCotisations(ligne, cotisations, cotisationsRapprochees)
    : []
  const recurrent = aTraiter && piecesCandidates.length === 0 && echeancesCandidates.length === 0 ? recurrence : null

  const piecePayee = ligne.piece_id ? pieces.find((p) => p.id === ligne.piece_id) ?? null : null
  const cotisationPayee = ligne.cotisation_id ? cotisations.find((c) => c.id === ligne.cotisation_id) ?? null : null
  // Seconde copie de la pastille de la liste, gardée par son propre test : le panneau est l'écran où
  // l'on ARBITRE, donc celui où l'écart doit se lire.
  const ecart = (() => {
    if (!piecePayee || ligne.statut !== 'rapprochee') return null
    const e = ecartAvecBanque(piecePayee, ligne)
    return e && e.ecart > 0 && !e.alignable ? e : null
  })()

  const piecesAuChoix = aTraiter
    ? pieces.filter((p) => !piecesRapprochees.has(p.id))
        .sort((a, b) => scoreCorrespondance(a.montant_ttc, a.date_piece, ligne) - scoreCorrespondance(b.montant_ttc, b.date_piece, ligne))
    : []
  const cotisationsAuChoix = aTraiter
    ? cotisations.filter((c) => !cotisationsRapprochees.has(c.id))
        .sort((a, b) =>
          scoreCorrespondance(a.montant_verse ?? a.montant_appele, a.echeance, ligne)
          - scoreCorrespondance(b.montant_verse ?? b.montant_appele, b.echeance, ligne))
    : []
  // Pourquoi rien n'est proposé, dit plutôt que deviné (voir audit ergonomie comparatif) : deux listes
  // vides ne disent pas si le dossier n'a rien à associer, ou si tout est déjà rapproché ailleurs.
  const aucuneReference = pieces.length === 0 && cotisations.length === 0
  const toutDejaRapproche = !aucuneReference && piecesAuChoix.length === 0 && cotisationsAuChoix.length === 0
  const unePropositionExiste = piecesCandidates.length > 0 || echeancesCandidates.length > 0

  let principal: ReactNode = null
  if (piecesCandidates.length === 1) {
    principal = (
      <button type="button" className="btn btn-primary" disabled={occupe} onClick={() => onRapprocher(piecesCandidates[0].id)}>
        Associer cette pièce
      </button>
    )
  } else if (echeancesCandidates.length === 1) {
    principal = (
      <button type="button" className="btn btn-primary" disabled={occupe} onClick={() => onRapprocherCotisation(echeancesCandidates[0].id)}>
        Associer cette échéance
      </button>
    )
  } else if (recurrent) {
    principal = (
      <button
        type="button"
        className="btn btn-primary"
        disabled={occupe}
        onClick={recurrent.action === 'virement_personnel' ? onVirementPersonnel : onIgnorer}
      >
        {recurrent.action === 'virement_personnel' ? 'Virement personnel' : 'Ignorer'}, comme les {recurrent.occurrences} précédents
      </button>
    )
  } else if (ligne.statut === 'rapprochee') {
    principal = (
      <button type="button" className="btn btn-outline" disabled={occupe} onClick={onRemettreATraiter}>
        Annuler le rapprochement
      </button>
    )
  } else if (ligne.statut === 'ignoree') {
    principal = (
      <button type="button" className="btn btn-outline" disabled={occupe} onClick={onRemettreATraiter}>
        Remettre à traiter
      </button>
    )
  }

  return (
    <div className="fiche-mouvement">
      {/* Pas de sous-titre : le libellé ouvre le corps, en entier — un libellé bancaire est souvent
          long, et l'en-tête le couperait. Répété juste au-dessus, il se lisait deux fois. */}
      <EntetePanneau
        titre={navigation.position}
        actions={(
          <>
            <button
              type="button"
              className="panneau-bouton-icone"
              onClick={navigation.precedent ?? undefined}
              disabled={!navigation.precedent}
              aria-label="Mouvement précédent"
              title="Mouvement précédent"
            >
              <IconPrecedent width={18} height={18} />
            </button>
            <button
              type="button"
              className="panneau-bouton-icone"
              onClick={navigation.suivant ?? undefined}
              disabled={!navigation.suivant}
              aria-label="Mouvement suivant"
              title="Mouvement suivant"
            >
              <IconChevron width={18} height={18} />
            </button>
          </>
        )}
        onFermer={onFermer}
      />

      <div className="fiche-mouvement-corps">
        <p className="fiche-mouvement-libelle">{libelle}</p>
        <div className="fiche-mouvement-tuiles">
          <div className="fiche-mouvement-tuile"><span>Date</span><strong>{formatDate(ligne.date)}</strong></div>
          <div className="fiche-mouvement-tuile"><span>Montant</span><strong>{formatMoney(ligne.montant)}</strong></div>
        </div>

        <div className="fiche-mouvement-etat">
          {ligne.prelevement_personnel && <span className="badge badge-neutral">Virement personnel</span>}
          {/* Une pastille verte sur un mouvement qui ne désigne plus rien serait une affirmation fausse,
              indiscernable d'un vrai rapprochement — voir `mouvementRapprocheSansObjet`. */}
          {!ligne.prelevement_personnel && sansObjet && <span className="badge badge-danger">Rapproché sans justificatif</span>}
          {!ligne.prelevement_personnel && ligne.statut === 'rapprochee' && !sansObjet && <span className="badge badge-ok">Rapproché</span>}
          {ecart && <span className="badge badge-danger">Écart de {formatMoney(ecart.ecart)} avec la pièce</span>}
          {!ligne.prelevement_personnel && aTraiter && <span className="badge badge-warning">Non rapproché</span>}
          {!ligne.prelevement_personnel && ligne.statut === 'ignoree' && <span className="badge badge-neutral">Ignoré</span>}
        </div>

        {piecesCandidates.length === 1 && (
          <section className="fiche-mouvement-section">
            <h3>Pièce proposée</h3>
            <CartePiece piece={piecesCandidates[0]} signaux={signauxPiece(piecesCandidates[0], ligne)} />
          </section>
        )}
        {piecesCandidates.length > 1 && (
          <section className="fiche-mouvement-section">
            <h3>{piecesCandidates.length} pièces conviennent aussi bien</h3>
            <p className="fiche-mouvement-note">
              Même montant, dates proches : ouvre les justificatifs avant de choisir. C’est pour cette
              raison que le rapprochement automatique laisse ce mouvement de côté.
            </p>
            {piecesCandidates.map((p) => (
              <CartePiece
                key={p.id}
                piece={p}
                signaux={signauxPiece(p, ligne)}
                action={(
                  <button type="button" className="btn btn-outline btn-sm" disabled={occupe} onClick={() => onRapprocher(p.id)}>
                    Associer celle-ci
                  </button>
                )}
              />
            ))}
          </section>
        )}
        {echeancesCandidates.length === 1 && (
          <section className="fiche-mouvement-section">
            <h3>Échéance proposée</h3>
            <CarteCotisation cotisation={echeancesCandidates[0]} signaux={signauxCotisation(echeancesCandidates[0], ligne)} />
          </section>
        )}
        {echeancesCandidates.length > 1 && (
          <section className="fiche-mouvement-section">
            <h3>{echeancesCandidates.length} échéances conviennent aussi bien</h3>
            {echeancesCandidates.map((c) => (
              <CarteCotisation
                key={c.id}
                cotisation={c}
                signaux={signauxCotisation(c, ligne)}
                action={(
                  <button type="button" className="btn btn-outline btn-sm" disabled={occupe} onClick={() => onRapprocherCotisation(c.id)}>
                    Associer celle-ci
                  </button>
                )}
              />
            ))}
          </section>
        )}
        {recurrent && (
          <section className="fiche-mouvement-section">
            <h3>Mouvement récurrent</h3>
            {/* Au pluriel sans détour : une récurrence n'est proposée qu'à partir de deux occurrences
                passées (voir `suggestionRecurrente`, BanqueTab). */}
            <p className="fiche-mouvement-note">
              Même montant, à trois jours près dans le mois, que {recurrent.occurrences} mouvements déjà
              {recurrent.action === 'virement_personnel' ? ' classés en virement personnel.' : ' ignorés.'}
            </p>
          </section>
        )}
        {aTraiter && !unePropositionExiste && !recurrent && (
          <p className="fiche-mouvement-vide">Aucune pièce proposée pour ce mouvement.</p>
        )}

        {aTraiter && (
          <section className="fiche-mouvement-section">
            <h3>{unePropositionExiste ? 'Choisir une autre pièce' : 'Choisir une pièce'}</h3>
            {piecesAuChoix.length > 0 && (
              <div className="field">
                <label htmlFor="associer-piece">Pièce</label>
                <div className="fiche-mouvement-choix">
                  <select id="associer-piece" value={pieceChoisie} onChange={(e) => setPieceChoisie(e.target.value)}>
                    <option value="">— Choisir —</option>
                    {piecesAuChoix.map((p) => (
                      <option key={p.id} value={p.id}>
                        {formatDate(p.date_piece)} — {p.tiers ?? '—'} — {formatMoney(p.montant_ttc)}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="btn btn-outline" disabled={!pieceChoisie || occupe} onClick={() => onRapprocher(pieceChoisie)}>
                    Associer
                  </button>
                </div>
              </div>
            )}
            {cotisationsAuChoix.length > 0 && (
              <div className="field">
                <label htmlFor="associer-cotisation">Échéance de cotisation</label>
                <div className="fiche-mouvement-choix">
                  <select id="associer-cotisation" value={cotisationChoisie} onChange={(e) => setCotisationChoisie(e.target.value)}>
                    <option value="">— Choisir —</option>
                    {cotisationsAuChoix.map((c) => (
                      <option key={c.id} value={c.id}>
                        {formatDate(c.echeance)} — {formatMoney(c.montant_verse ?? c.montant_appele)}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="btn btn-outline" disabled={!cotisationChoisie || occupe} onClick={() => onRapprocherCotisation(cotisationChoisie)}>
                    Associer
                  </button>
                </div>
              </div>
            )}
            {aucuneReference && (
              <p className="fiche-mouvement-note">
                Aucune pièce ni échéance de cotisation enregistrée dans ce dossier pour l’instant — dépose
                et valide d’abord le justificatif correspondant (Justificatifs), ou déclare l’échéance
                (Cotisations).
              </p>
            )}
            {toutDejaRapproche && (
              <p className="fiche-mouvement-note">
                Toutes les pièces et échéances de ce dossier sont déjà rapprochées d’un autre mouvement — si
                aucune ne correspond en réalité, vérifie un éventuel rapprochement fait par erreur ailleurs.
              </p>
            )}
          </section>
        )}

        {aTraiter && (
          <section className="fiche-mouvement-section">
            <h3>Sans justificatif</h3>
            <div className="fiche-mouvement-boutons">
              <button type="button" className="btn btn-outline btn-sm" disabled={occupe} onClick={onVirementPersonnel}>Virement personnel</button>
              <button type="button" className="btn btn-outline btn-sm" disabled={occupe} onClick={onIgnorer}>Ignorer</button>
              <button type="button" className="btn btn-outline btn-sm" disabled={occupe} onClick={onToujoursIgnorer}>Toujours ignorer ce type…</button>
            </div>
          </section>
        )}

        {ligne.statut === 'rapprochee' && !sansObjet && (
          <section className="fiche-mouvement-section">
            <h3>Rapproché avec</h3>
            {piecePayee && <CartePiece piece={piecePayee} />}
            {cotisationPayee && <CarteCotisation cotisation={cotisationPayee} />}
            {/* Le lien existe mais la ligne n'a pas été lue — une lecture partielle, que le bandeau en
                tête de l'écran annonce déjà. Dit ici plutôt qu'une section vide sous « Rapproché avec ». */}
            {ligne.piece_id && !piecePayee && <p className="fiche-mouvement-note">La pièce rapprochée ne figure pas parmi les pièces lues.</p>}
            {ligne.cotisation_id && !cotisationPayee && <p className="fiche-mouvement-note">L’échéance rapprochée ne figure pas parmi les échéances lues.</p>}
          </section>
        )}
        {sansObjet && (
          <p className="fiche-mouvement-alerte">
            La pièce ou l’échéance que désignait ce rapprochement a été supprimée : ce mouvement n’est plus
            rattaché à rien. Annule le rapprochement pour le refaire.
          </p>
        )}

        {/* Traçabilité de l'import (voir audit ergonomie) — surtout utile quand le libellé est retombé
            sur le générique « Mouvement bancaire » : de quoi retrouver le fichier et la ligne d'origine
            sans rouvrir le relevé. Absente sur tout import antérieur à cet ajout. */}
        {(ligne.source_fichier || (ligne.libelle_brut && ligne.libelle_brut !== ligne.libelle)) && (
          <p className="fiche-mouvement-origine">
            {ligne.source_fichier && <>Importé depuis « {ligne.source_fichier} »</>}
            {ligne.source_fichier && ligne.libelle_brut && ligne.libelle_brut !== ligne.libelle && ' — '}
            {ligne.libelle_brut && ligne.libelle_brut !== ligne.libelle && <>ligne brute : {ligne.libelle_brut}</>}
          </p>
        )}
      </div>

      {principal && <div className="fiche-mouvement-pied">{principal}</div>}
    </div>
  )
}
