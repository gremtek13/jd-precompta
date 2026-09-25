import { useState, type CSSProperties } from 'react'
import { supabase } from '../../lib/supabase'
import { formatMoney } from '../../lib/format'
import { grouperParTiers, piecesSansTiers, type GroupeTiers } from '../../lib/suggestionTiers'
import type { Categorie, Piece, TiersCategorie, TiersCategorieCabinet } from '../../lib/types'
import { messageErreur } from '../../lib/messageErreur'

// Catégorisation en masse, un arbitrage par fournisseur plutôt qu'un par pièce. Sur un import réel,
// 58 pièces à catégoriser ne portaient que 28 tiers distincts — c'est ce rapport que cet écran
// exploite, et il s'améliore à chaque passage puisque chaque choix devient une règle réutilisée.
//
// Tout arrive pré-rempli, rien n'est enregistré sans le clic : c'est un écran de vérification, pas
// de saisie. L'origine de chaque proposition est affichée pour que le regard se porte là où il
// faut — une règle déjà choisie par le cabinet ne se relit pas comme un mot-clé deviné.

interface Props {
  dossierId: string
  cabinetId: string | null
  pieces: Piece[]
  categories: Categorie[]
  reglesDossier: TiersCategorie[]
  reglesCabinet: TiersCategorieCabinet[]
  onClose: () => void
  onApplied: () => void
}

const overlayStyle: CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 50,
}

const BADGE: Record<GroupeTiers['origine'], { texte: string; classe: string; aide: string }> = {
  regle: { texte: 'Règle connue', classe: 'badge badge-ok', aide: 'Catégorie déjà choisie pour ce tiers sur une pièce précédente.' },
  motcle: { texte: 'À vérifier', classe: 'badge badge-neutral', aide: "Déduit d'un mot du nom du fournisseur — contrôle rapide conseillé." },
  aucune: { texte: 'À choisir', classe: 'badge badge-danger', aide: 'Rien de connu pour ce tiers.' },
}

export default function CategoriserTiersModal({
  dossierId, cabinetId, pieces, categories, reglesDossier, reglesCabinet, onClose, onApplied,
}: Props) {
  const groupes = grouperParTiers(pieces, categories, reglesDossier, reglesCabinet)
  const sansTiers = piecesSansTiers(pieces)

  // Choix en cours, initialisés aux propositions. Un choix explicite du cabinet écrase la
  // proposition ; une chaîne vide signifie « je ne tranche pas », et la ligne sera ignorée.
  const [choix, setChoix] = useState<Record<string, string>>(() =>
    Object.fromEntries(groupes.map((g) => [g.tiersNormalise, g.categorieProposee ?? ''])),
  )
  const [enCours, setEnCours] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)

  const retenus = groupes.filter((g) => choix[g.tiersNormalise])
  const nbPieces = retenus.reduce((n, g) => n + g.pieceIds.length, 0)

  async function appliquer() {
    if (retenus.length === 0 || enCours) return
    setEnCours(true)
    setErreur(null)
    try {
      for (const groupe of retenus) {
        const categorieId = choix[groupe.tiersNormalise]

        // La catégorie des pièces d'abord : c'est le seul effet qui compte vraiment pour le
        // brouillon comptable. Vérifiée, jamais supposée — sans ce contrôle, un refus RLS laisserait
        // l'écran annoncer « N pièces catégorisées » sur des lignes restées vides.
        const { error: erreurPieces } = await supabase
          .from('pieces').update({ categorie_id: categorieId }).in('id', groupe.pieceIds)
        if (erreurPieces) throw erreurPieces

        // Puis la règle, pour que le prochain import se catégorise tout seul. Volontairement après :
        // si elle échoue, les pièces sont déjà catégorisées et on n'a rien perdu d'irremplaçable.
        const { error: erreurRegle } = await supabase.from('tiers_categories').upsert(
          { dossier_id: dossierId, tiers_normalise: groupe.tiersNormalise, categorie_id: categorieId },
          { onConflict: 'dossier_id,tiers_normalise' },
        )
        if (erreurRegle) throw erreurRegle

        // Catégorie globale (dossier_id null) : la correspondance vaut au-delà de ce client — une
        // mutuelle, une banque reviennent d'un dossier à l'autre. Même raisonnement que
        // FichePiece, d'où la règle cabinet en plus.
        const categorieChoisie = categories.find((c) => c.id === categorieId)
        if (cabinetId && categorieChoisie && categorieChoisie.dossier_id === null) {
          const { error: erreurCabinet } = await supabase.from('tiers_categories_cabinet').upsert(
            { cabinet_id: cabinetId, tiers_normalise: groupe.tiersNormalise, categorie_id: categorieId },
            { onConflict: 'cabinet_id,tiers_normalise' },
          )
          if (erreurCabinet) throw erreurCabinet
        }
      }
      onApplied()
      onClose()
    } catch (err) {
      setErreur(messageErreur(err))
    } finally {
      setEnCours(false)
    }
  }

  return (
    <div style={overlayStyle}>
      <div className="card" style={{ width: 'min(880px, 96vw)', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        <h2 style={{ marginTop: 0, marginBottom: 4 }}>Catégoriser par fournisseur</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Un choix par fournisseur au lieu d'un par pièce. Chaque ligne est pré-remplie ; ton choix
          catégorise toutes ses pièces d'un coup et devient une règle pour les prochains imports.
        </p>

        {groupes.length === 0 ? (
          <div className="empty-state">Aucune pièce sans catégorie ne porte de tiers exploitable.</div>
        ) : (
          <div className="table-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Fournisseur</th>
                  <th style={{ textAlign: 'right' }}>Pièces</th>
                  <th style={{ textAlign: 'right' }}>Total TTC</th>
                  <th>Origine</th>
                  <th>Catégorie</th>
                </tr>
              </thead>
              <tbody>
                {groupes.map((g) => {
                  const badge = BADGE[g.origine]
                  return (
                    <tr key={g.tiersNormalise}>
                      <td style={{ maxWidth: 260, overflowWrap: 'anywhere' }}>
                        {g.libelle}
                        {g.variantes.length > 0 && (
                          // Le regroupement réunit les graphies qu'un OCR produit pour un même
                          // fournisseur. Les montrer permet de le contester : c'est une déduction,
                          // pas un fait, et elle porte ici sur plusieurs pièces d'un coup.
                          <div
                            className="muted"
                            style={{ fontSize: '0.85em', marginTop: 2 }}
                            title={g.variantes.join('\n')}
                          >
                            aussi lu « {g.variantes.map((v) => v.replace(/\s+/g, ' ')).join(' », « ')} »
                          </div>
                        )}
                        {!g.fournisseurIdentifiable && (
                          // « CARTE BANCAIRE », « m sa » : l'OCR a lu autre chose que le
                          // fournisseur. Rien ne sera regroupé là-dessus, et une règle apprise sur
                          // un tel nom ne servirait jamais.
                          <div style={{ fontSize: '0.85em', marginTop: 2, color: 'var(--color-warning)' }}>
                            ⚠ ce nom n'identifie aucun fournisseur — vérifie la pièce
                          </div>
                        )}
                      </td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{g.pieceIds.length}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {/* Un montant non lu reste « — » : afficher 0,00 € ferait croire à une facture à zéro. */}
                        {g.totalTtc == null ? '—' : formatMoney(g.totalTtc)}
                      </td>
                      <td><span className={badge.classe} title={badge.aide}>{badge.texte}</span></td>
                      <td>
                        <select
                          style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: '5px 8px', maxWidth: 220 }}
                          value={choix[g.tiersNormalise] ?? ''}
                          onChange={(e) => setChoix((prev) => ({ ...prev, [g.tiersNormalise]: e.target.value }))}
                        >
                          <option value="">— Ne pas catégoriser —</option>
                          {categories.map((c) => <option key={c.id} value={c.id}>{c.libelle}</option>)}
                        </select>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {sansTiers.length > 0 && (
          <p className="muted" style={{ fontSize: '0.88rem', marginBottom: 0 }}>
            {sansTiers.length} pièce(s) sans tiers lisible ne peuvent pas être regroupées ici — elles
            restent à traiter une par une depuis la liste.
          </p>
        )}

        {erreur && <p className="error-text">{erreur}</p>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 14 }}>
          <button type="button" className="btn btn-outline" disabled={enCours} onClick={onClose}>Annuler</button>
          <button type="button" className="btn btn-primary" disabled={enCours || retenus.length === 0} onClick={appliquer}>
            {enCours ? 'Application…' : `Catégoriser ${nbPieces} pièce(s)`}
          </button>
        </div>
      </div>
    </div>
  )
}
