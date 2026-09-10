import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { formatDate, formatMoney } from '../../lib/format'
import { suggererCategorie } from '../../lib/tiersCategories'
import type { Categorie, Piece, SousDossier, TiersCategorie, TiersCategorieCabinet } from '../../lib/types'
import PieceFormModal from './PieceFormModal'
import AjouterDocumentsModal from './AjouterDocumentsModal'
import ImportDossierModal from './ImportDossierModal'
import SuperPdpModal from './SuperPdpModal'
import { useAnnee } from '../../context/AnneeContext'

export default function PiecesTab({ dossierId }: { dossierId: string }) {
  const [pieces, setPieces] = useState<Piece[]>([])
  const [categories, setCategories] = useState<Categorie[]>([])
  const [sousDossiers, setSousDossiers] = useState<SousDossier[]>([])
  const [tiersCategories, setTiersCategories] = useState<TiersCategorie[]>([])
  const [tiersCategoriesCabinet, setTiersCategoriesCabinet] = useState<TiersCategorieCabinet[]>([])
  const [applyingSuggestions, setApplyingSuggestions] = useState(false)
  const [loading, setLoading] = useState(true)
  const [statutFilter, setStatutFilter] = useState<'toutes' | 'a_valider' | 'validee'>('toutes')
  const [sousDossierFilter, setSousDossierFilter] = useState<'tous' | 'sans' | string>('tous')
  // L'exercice lui-même vient de l'en-tête du dossier (voir AnneeContext, partagé avec Banque,
  // Écritures, Statistiques et Clôture) — "sans date" reste un filtre local, propre aux pièces : les
  // autres onglets partagés n'ont pas cette notion (un mouvement bancaire ou une écriture a toujours
  // une date), donc rien à unifier avec l'en-tête pour ce cas précis. Mutuellement exclusif avec
  // l'exercice sélectionné : cocher "Sans date" met de côté le filtre d'exercice, comme avant.
  const { annee: anneeFilter } = useAnnee()
  const [sansDateOnly, setSansDateOnly] = useState(false)
  const [editing, setEditing] = useState<Piece | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [ajoutOuvert, setAjoutOuvert] = useState(false)
  const [importDossierOuvert, setImportDossierOuvert] = useState(false)
  const [superPdpOpen, setSuperPdpOpen] = useState(false)

  async function load() {
    setLoading(true)
    const { data: piecesData } = await supabase
      .from('pieces')
      .select('*')
      .eq('dossier_id', dossierId)
      .order('date_piece', { ascending: false, nullsFirst: false })

    const { data: categoriesData } = await supabase
      .from('categories')
      .select('*')
      .or(`dossier_id.eq.${dossierId},dossier_id.is.null`)
      .order('ordre')

    const { data: sousDossiersData } = await supabase
      .from('sous_dossiers')
      .select('*')
      .eq('dossier_id', dossierId)
      .order('ordre')
      .order('nom')

    const { data: tiersCategoriesData } = await supabase
      .from('tiers_categories')
      .select('*')
      .eq('dossier_id', dossierId)

    const { data: tiersCategoriesCabinetData } = await supabase
      .from('tiers_categories_cabinet')
      .select('*')

    setPieces(piecesData ?? [])
    setCategories(categoriesData ?? [])
    setSousDossiers(sousDossiersData ?? [])
    setTiersCategories(tiersCategoriesData ?? [])
    setTiersCategoriesCabinet(tiersCategoriesCabinetData ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [dossierId])

  // Un dossier est par client, pas par année (voir Estimation) — les pièces s'accumulent sur plusieurs
  // exercices sans jamais être archivées ailleurs. Le filtre d'exercice ne déplace rien, il joue sur
  // la vraie date du document (date_piece) plutôt que sa date d'ajout dans l'appli.
  const aPiecesSansDate = pieces.some((p) => !p.date_piece)

  const filteredBase = pieces.filter((p) => {
    if (statutFilter !== 'toutes' && p.statut !== statutFilter) return false
    if (sousDossierFilter === 'sans' && p.sous_dossier_id) return false
    if (sousDossierFilter !== 'tous' && sousDossierFilter !== 'sans' && p.sous_dossier_id !== sousDossierFilter) return false
    if (sansDateOnly) return !p.date_piece
    if (anneeFilter !== 'toutes' && (!p.date_piece || new Date(p.date_piece).getFullYear() !== anneeFilter)) return false
    return true
  })
  // "À valider" seulement : les pièces à faible confiance d'extraction remontent en premier — ce sont
  // celles qui ont le plus de chances d'avoir un champ faux, donc celles qui méritent d'être regardées
  // avant les autres plutôt que de tout revérifier au même niveau d'attention (voir Piece.confiance).
  // Tri stable (Array.sort) : à confiance égale, l'ordre par date d'origine est conservé.
  const PRIORITE_CONFIANCE: Record<string, number> = { basse: 0, moyenne: 1, haute: 2 }
  const filtered = statutFilter === 'a_valider'
    ? [...filteredBase].sort((a, b) => (PRIORITE_CONFIANCE[a.confiance ?? ''] ?? 3) - (PRIORITE_CONFIANCE[b.confiance ?? ''] ?? 3))
    : filteredBase
  const tiersConnus = [...new Set(pieces.map((p) => p.tiers).filter((t): t is string => !!t))]
  const categorieLabel = (id: string | null) => categories.find((c) => c.id === id)?.libelle ?? '—'
  const sousDossierLabel = (id: string | null) => sousDossiers.find((s) => s.id === id)?.nom ?? '—'

  // Catégorie suggérée pour une pièce pas encore catégorisée, d'après son tiers — règle du dossier ou
  // du cabinet déjà apprise (voir lib/tiersCategories.ts). Juste un aperçu tant que rien n'est
  // appliqué : la pièce garde categorie_id à null jusqu'au clic explicite ci-dessous ou dans la fiche.
  const suggestionPour = (p: Piece): string | null => {
    if (p.categorie_id || !p.tiers) return null
    return suggererCategorie(p.tiers, tiersCategories, tiersCategoriesCabinet)
  }
  const piecesAvecSuggestion = pieces.filter((p) => suggestionPour(p) !== null)

  // Un seul clic pour reprendre, sur toutes les pièces sans catégorie, la correspondance déjà connue
  // pour leur tiers — sans passer par chaque fiche une par une. Ne fait rien sur les pièces sans
  // correspondance connue : elles restent à catégoriser à la main comme avant.
  async function appliquerSuggestions() {
    if (piecesAvecSuggestion.length === 0) return
    setApplyingSuggestions(true)
    await Promise.all(
      piecesAvecSuggestion.map((p) => supabase.from('pieces').update({ categorie_id: suggestionPour(p) }).eq('id', p.id)),
    )
    setApplyingSuggestions(false)
    load()
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function validateSelection() {
    const ids = [...selected].filter((id) => pieces.find((p) => p.id === id)?.montant_ttc != null)
    if (ids.length === 0) return
    await supabase.from('pieces').update({ statut: 'validee' }).in('id', ids)
    setSelected(new Set())
    load()
  }

  function toggleSelectAll() {
    if (selected.size === filtered.length && filtered.length > 0) {
      setSelected(new Set())
    } else {
      setSelected(new Set(filtered.map((p) => p.id)))
    }
  }

  // Suppression ligne par ligne (pas un .in() groupé) : une pièce encore liée à un rapprochement
  // bancaire ou à un pack déjà généré bloque sur une contrainte de clé étrangère (23503) — ça ne doit
  // pas empêcher de supprimer le reste de la sélection, juste être compté à part.
  async function deleteSelection() {
    if (selected.size === 0) return
    if (!window.confirm(`Supprimer définitivement ${selected.size} pièce(s) ? Cette action est irréversible.`)) return
    let supprimees = 0
    let bloquees = 0
    for (const id of selected) {
      const piece = pieces.find((p) => p.id === id)
      const { error } = await supabase.from('pieces').delete().eq('id', id)
      if (error) {
        bloquees++
        continue
      }
      if (piece?.storage_path) {
        await supabase.storage.from('pieces').remove([piece.storage_path]).catch(() => {})
      }
      supprimees++
    }
    setSelected(new Set())
    load()
    if (bloquees > 0) {
      window.alert(
        `${supprimees} pièce(s) supprimée(s). ${bloquees} n'ont pas pu l'être (liées à un rapprochement bancaire ou à un pack déjà généré) — retire d'abord ce lien.`,
      )
    }
  }

  async function createSousDossier() {
    const nom = window.prompt('Nom du sous-dossier (ex : 2024, Chantier A, Notes de frais Jean)')
    if (!nom || !nom.trim()) return
    const { error } = await supabase.from('sous_dossiers').insert({ dossier_id: dossierId, nom: nom.trim() })
    if (error) {
      window.alert(error.message)
      return
    }
    load()
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {(['toutes', 'a_valider', 'validee'] as const).map((s) => (
            <button
              key={s}
              className={`btn btn-sm ${statutFilter === s ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setStatutFilter(s)}
            >
              {s === 'toutes' ? 'Toutes' : s === 'a_valider' ? 'À valider' : 'Validées'}
            </button>
          ))}
          {/* Filtre local, indépendant de l'exercice de l'en-tête (voir déclaration de sansDateOnly
              ci-dessus) — une pièce sans date n'appartient à aucun exercice, ça ne fait pas sens de
              l'unifier avec le sélecteur partagé. */}
          {aPiecesSansDate && (
            <button
              className={`btn btn-sm ${sansDateOnly ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setSansDateOnly((v) => !v)}
              title="Pièces sans date renseignée, en dehors de tout exercice"
            >
              Sans date
            </button>
          )}
          <select value={sousDossierFilter} onChange={(e) => setSousDossierFilter(e.target.value)} style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: '5px 8px', fontSize: '0.8rem' }}>
            <option value="tous">Tous les sous-dossiers</option>
            <option value="sans">Sans sous-dossier</option>
            {sousDossiers.map((s) => <option key={s.id} value={s.id}>{s.nom}</option>)}
          </select>
          <button className="btn btn-outline btn-sm" onClick={createSousDossier}>+ Sous-dossier</button>
          {filtered.length > 0 && (
            <button className="btn btn-outline btn-sm" onClick={toggleSelectAll}>
              {selected.size === filtered.length ? 'Tout désélectionner' : 'Tout sélectionner'}
            </button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {piecesAvecSuggestion.length > 0 && (
            <button className="btn btn-outline btn-sm" disabled={applyingSuggestions} onClick={appliquerSuggestions}>
              {applyingSuggestions ? 'Application…' : `Appliquer les suggestions (${piecesAvecSuggestion.length})`}
            </button>
          )}
          {selected.size > 0 && (
            <>
              <button className="btn btn-outline btn-sm" onClick={validateSelection}>
                Valider la sélection ({selected.size})
              </button>
              <button className="btn btn-danger btn-sm" onClick={deleteSelection}>
                Supprimer la sélection ({selected.size})
              </button>
            </>
          )}
          <button className="btn btn-outline btn-sm" onClick={() => setSuperPdpOpen(true)}>🔌 Facture électronique</button>
          <button className="btn btn-outline btn-sm" onClick={() => setImportDossierOuvert(true)} title="Pour importer une arborescence de dossiers depuis ton ordinateur, avec sous-dossiers automatiques">
            📁 Importer un dossier complet
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => setAjoutOuvert(true)}>+ Ajouter des documents</button>
        </div>
      </div>

      <div className="card table-scroll" style={{ padding: 0 }}>
        {loading ? (
          <p className="muted" style={{ padding: 20 }}>Chargement…</p>
        ) : filtered.length === 0 ? (
          <div className="empty-state">Aucune pièce.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th className="col-checkbox"></th>
                <th>Date</th>
                <th>Tiers</th>
                <th className="hide-mobile">Catégorie</th>
                <th className="hide-mobile">Sous-dossier</th>
                <th>Montant TTC</th>
                <th className="hide-mobile">Confiance</th>
                <th>Statut</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id} className="clickable">
                  <td className="col-checkbox" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggleSelect(p.id)} />
                  </td>
                  <td onClick={() => setEditing(p)}>{formatDate(p.date_piece)}</td>
                  <td onClick={() => setEditing(p)}>{p.tiers ?? '—'}</td>
                  <td className="hide-mobile" onClick={() => setEditing(p)}>
                    {p.categorie_id ? (
                      categorieLabel(p.categorie_id)
                    ) : suggestionPour(p) ? (
                      <>— <span className="muted" style={{ fontSize: '0.8rem' }}>(suggéré : {categorieLabel(suggestionPour(p))})</span></>
                    ) : '—'}
                  </td>
                  <td className="hide-mobile" onClick={() => setEditing(p)}>{sousDossierLabel(p.sous_dossier_id)}</td>
                  <td onClick={() => setEditing(p)}>{formatMoney(p.montant_ttc)}</td>
                  <td className="hide-mobile" onClick={() => setEditing(p)}>
                    {p.confiance === 'basse' && <span className="badge badge-danger">Basse — à vérifier</span>}
                    {p.confiance === 'moyenne' && <span className="badge badge-warning">Moyenne</span>}
                    {p.confiance === 'haute' && <span className="badge badge-ok">Haute</span>}
                    {!p.confiance && <span className="muted">—</span>}
                  </td>
                  <td onClick={() => setEditing(p)}>
                    {p.statut === 'validee'
                      ? <span className="badge badge-ok">Validée</span>
                      : <span className="badge badge-warning">À valider</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <PieceFormModal
          dossierId={dossierId}
          categories={categories}
          sousDossiers={sousDossiers}
          tiersCategories={tiersCategories}
          tiersCategoriesCabinet={tiersCategoriesCabinet}
          tiersConnus={tiersConnus}
          piece={editing}
          onClose={() => setEditing(null)}
          onSaved={load}
        />
      )}

      {ajoutOuvert && (
        <AjouterDocumentsModal
          dossierId={dossierId}
          sousDossiers={sousDossiers}
          onClose={() => setAjoutOuvert(false)}
          onImported={load}
        />
      )}

      {importDossierOuvert && (
        <ImportDossierModal
          dossierId={dossierId}
          sousDossiers={sousDossiers}
          onClose={() => setImportDossierOuvert(false)}
          onImported={load}
        />
      )}

      {superPdpOpen && (
        <SuperPdpModal dossierId={dossierId} onClose={() => setSuperPdpOpen(false)} onImported={load} />
      )}
    </>
  )
}
