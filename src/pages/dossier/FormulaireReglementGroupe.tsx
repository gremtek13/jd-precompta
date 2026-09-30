import { useState } from 'react'
import { seuilAlignement } from '../../lib/alignementBanque'
import { ecartEnJours } from '../../lib/appariementBanque'
import { formatDate, formatMoney } from '../../lib/format'
import type { PaiementsDesPieces } from '../../lib/rattachement'
import {
  nomDeLaPiece, partSaisieDe, partSigneeDe, refusReglementGroupe, resteARegler, resteARepartir, signeReglant,
  type PartReglement,
} from '../../lib/reglementGroupe'
import type { LigneBancaire, Piece, ReglementGroupe } from '../../lib/types'

// Un virement qui règle plusieurs pièces (lib/reglementGroupe.ts), dans la fiche d'un mouvement. Une ligne
// par pièce : la pièce, et la part du mouvement qui la règle, saisie POSITIVE — un avoir se déduit en
// l'ajoutant comme les autres, sa part allant d'elle-même dans l'autre sens. Le reste à répartir se lit à
// chaque frappe.
//
// Rien ne part avant le clic, et ce que la base refuserait est dit avant lui (`refusReglementGroupe`), avec
// un refus de plus que la base : une pièce qui serait payée deux fois. Choisir une pièce propose ce qu'il en
// reste à régler, sans rien écrire : c'est le cas courant d'un virement qui solde plusieurs factures. Tant
// qu'une part n'a ni pièce ni montant, on le demande sans crier à l'erreur, comme la ventilation.

interface LignePart { cle: number; pieceId: string; montant: string }

export default function FormulaireReglementGroupe({
  ligne, pieces, paiements, partsExistantes, suspension, occupe, verbe, onRegler,
}: {
  ligne: LigneBancaire
  // Les pièces du dossier, à valider comprises : le choix à la main les offre toutes, comme le rapprochement
  // d'une seule pièce.
  pieces: Piece[]
  // Les paiements de chaque pièce (lib/rattachement.ts) : de quoi dire ce qu'il en reste à régler.
  paiements: PaiementsDesPieces
  // Les parts d'un règlement en place, pour le modifier ; vide pour un premier règlement.
  partsExistantes: readonly ReglementGroupe[]
  // Non nul quand les parts des règlements groupés n'ont pas pu être lues en entier : une pièce déjà payée
  // paraîtrait alors à régler, et le règlement est suspendu.
  suspension: string | null
  occupe: boolean
  verbe: string
  onRegler: (parts: PartReglement[]) => void
}) {
  const parId = new Map(pieces.map((p) => [p.id, p]))
  const [parts, setParts] = useState<LignePart[]>(() => partsExistantes.length > 0
    ? partsExistantes.map((r, i) => {
        const piece = r.piece_id ? parId.get(r.piece_id) : undefined
        // Une part dont la pièce a été supprimée repart sans pièce : c'est à l'opérateur d'en choisir une,
        // ou de retirer la part.
        return { cle: i, pieceId: r.piece_id ?? '', montant: (piece ? partSaisieDe(piece, r.montant) : Math.abs(r.montant)).toFixed(2) }
      })
    : [{ cle: 0, pieceId: '', montant: '' }, { cle: 1, pieceId: '', montant: '' }])

  const reste = (piece: Piece) => resteARegler(piece, paiements.get(piece.id) ?? [], ligne.id)

  function modifier(cle: number, modification: Partial<LignePart>) {
    setParts((actuelles) => actuelles.map((p) => (p.cle === cle ? { ...p, ...modification } : p)))
  }
  // Choisir une pièce propose ce qu'il en reste à régler — sans écraser un montant déjà saisi.
  function choisir(cle: number, pieceId: string) {
    setParts((actuelles) => actuelles.map((p) => {
      if (p.cle !== cle) return p
      const piece = parId.get(pieceId)
      const propose = piece && p.montant.trim() === '' && reste(piece) > 0 ? reste(piece).toFixed(2) : p.montant
      return { ...p, pieceId, montant: propose }
    }))
  }
  function ajouter() {
    setParts((actuelles) => [...actuelles, { cle: Math.max(...actuelles.map((p) => p.cle)) + 1, pieceId: '', montant: '' }])
  }
  function retirer(cle: number) {
    setParts((actuelles) => actuelles.filter((p) => p.cle !== cle))
  }

  // Les pièces qu'on peut régler : celles qu'il reste à régler au-delà de l'écart d'alignement — en deçà,
  // elles sont réglées, comme les compte `partsDesPaiements` —, celles de ce règlement, et celles dont le
  // montant n'a pas été lu : les choisir dit pourquoi on ne peut pas les régler ainsi. Dans le sens du
  // mouvement d'abord (une facture d'achat pour un paiement), puis par proximité de date.
  const dansCeReglement = new Set(partsExistantes.map((r) => r.piece_id).filter((id): id is string => id != null))
  const sens = Math.sign(ligne.montant)
  const jours = (p: Piece) => (p.date_piece ? ecartEnJours(p.date_piece, ligne.date) : Number.MAX_SAFE_INTEGER)
  const offertes = pieces
    .filter((p) => dansCeReglement.has(p.id) || p.montant_ttc == null || reste(p) > seuilAlignement(p.montant_ttc))
    .sort((a, b) =>
      (signeReglant(a) === sens ? 0 : 1) - (signeReglant(b) === sens ? 0 : 1)
      || jours(a) - jours(b)
      || nomDeLaPiece(a).localeCompare(nomDeLaPiece(b)))

  function libelleOption(p: Piece): string {
    const r = reste(p)
    const partiel = p.montant_ttc != null && r < Math.abs(p.montant_ttc) ? ` (reste ${formatMoney(r)})` : ''
    return `${p.date_piece ? formatDate(p.date_piece) : 'Sans date'} — ${nomDeLaPiece(p)} — ${p.montant_ttc != null ? formatMoney(p.montant_ttc) : 'montant non lu'}`
      + `${partiel}${p.statut === 'validee' ? '' : ' — à valider'}`
  }

  // Signée comme le relevé. Une pièce sans montant lu garde la saisie telle quelle : c'est son absence de
  // montant que le refus doit dire, pas un montant nul.
  const signees: PartReglement[] = parts.map((p) => {
    const piece = parId.get(p.pieceId)
    const saisie = p.montant.trim() === '' ? Number.NaN : Number(p.montant)
    return { piece_id: p.pieceId, montant: piece && signeReglant(piece) !== 0 ? partSigneeDe(piece, saisie) : saisie }
  })
  const incomplete = parts.some((p) => p.pieceId === '' || p.montant.trim() === '')
  const refus = incomplete ? null : refusReglementGroupe(ligne, signees, pieces, paiements)
  const aRepartir = resteARepartir(ligne, signees.map((s) => ({ ...s, montant: Number.isFinite(s.montant) ? s.montant : 0 })))

  return (
    <>
      <div className="field fiche-mouvement-parts">
        {parts.map((p, i) => (
          <div key={p.cle} className="fiche-mouvement-part">
            <select aria-label={`Pièce ${i + 1}`} value={p.pieceId} onChange={(e) => choisir(p.cle, e.target.value)}>
              <option value="">— Choisir —</option>
              {/* Une pièce déjà choisie sur une autre ligne n'est plus offerte : ses parts se réunissent en une. */}
              {offertes.filter((o) => o.id === p.pieceId || !parts.some((x) => x.cle !== p.cle && x.pieceId === o.id)).map((o) => (
                <option key={o.id} value={o.id}>{libelleOption(o)}</option>
              ))}
            </select>
            <input
              type="number"
              min={0}
              step={0.01}
              aria-label={`Part de la pièce ${i + 1}`}
              value={p.montant}
              onChange={(e) => modifier(p.cle, { montant: e.target.value })}
            />
            {parts.length > 2 && (
              <button type="button" className="btn btn-outline btn-sm" aria-label={`Retirer la pièce ${i + 1}`} onClick={() => retirer(p.cle)}>
                Retirer
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="fiche-mouvement-boutons">
        <button type="button" className="btn btn-outline btn-sm" onClick={ajouter}>Ajouter une pièce</button>
      </div>
      <p className="fiche-mouvement-reste">
        {aRepartir === 0
          ? 'Les parts font le mouvement.'
          : aRepartir > 0
            ? `Reste à répartir : ${formatMoney(aRepartir)}`
            : `Les parts dépassent le mouvement de ${formatMoney(-aRepartir)}`}
      </p>
      <p className="fiche-mouvement-note">
        Montants positifs : chacun règle sa pièce. Un avoir se déduit en l’ajoutant comme une autre pièce, sa part
        allant dans l’autre sens.
      </p>
      {suspension && (
        <p className="fiche-mouvement-note">
          Les parts des règlements groupés n’ont pas pu être lues en entier : une pièce déjà payée peut paraître à
          régler. Régler plusieurs pièces est suspendu ; recharge la page.
        </p>
      )}
      {!suspension && incomplete && <p className="fiche-mouvement-note">Choisis la pièce et le montant de chaque part.</p>}
      {!suspension && refus && <p className="fiche-mouvement-alerte">{refus}</p>}
      <div className="fiche-mouvement-boutons">
        <button type="button" className="btn btn-outline" disabled={incomplete || !!refus || occupe || !!suspension} onClick={() => onRegler(signees)}>
          {verbe}
        </button>
      </div>
    </>
  )
}
