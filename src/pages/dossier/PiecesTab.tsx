import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { formatDate, formatMoney } from '../../lib/format'
import type { Categorie, Piece, SousDossier } from '../../lib/types'
import PieceFormModal from './PieceFormModal'

export default function PiecesTab({ dossierId }: { dossierId: string }) {
  const [pieces, setPieces] = useState<Piece[]>([])
  const [categories, setCategories] = useState<Categorie[]>([])
  const [sousDossiers, setSousDossiers] = useState<SousDossier[]>([])
  const [loading, setLoading] = useState(true)
  const [statutFilter, setStatutFilter] = useState<'toutes' | 'a_valider' | 'validee'>('toutes')
  const [sousDossierFilter, setSousDossierFilter] = useState<'tous' | 'sans' | string>('tous')
  const [editing, setEditing] = useState<Piece | null | 'new'>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())

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

    setPieces(piecesData ?? [])
    setCategories(categoriesData ?? [])
    setSousDossiers(sousDossiersData ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [dossierId])

  const filtered = pieces.filter((p) => {
    if (statutFilter !== 'toutes' && p.statut !== statutFilter) return false
    if (sousDossierFilter === 'sans') return !p.sous_dossier_id
    if (sousDossierFilter !== 'tous') return p.sous_dossier_id === sousDossierFilter
    return true
  })
  const tiersConnus = [...new Set(pieces.map((p) => p.tiers).filter((t): t is string => !!t))]
  const categorieLabel = (id: string | null) => categories.find((c) => c.id === id)?.libelle ?? '—'
  const sousDossierLabel = (id: string | null) => sousDossiers.find((s) => s.id === id)?.nom ?? '—'

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
          <select value={sousDossierFilter} onChange={(e) => setSousDossierFilter(e.target.value)} style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: '5px 8px', fontSize: '0.8rem' }}>
            <option value="tous">Tous les sous-dossiers</option>
            <option value="sans">Sans sous-dossier</option>
            {sousDossiers.map((s) => <option key={s.id} value={s.id}>{s.nom}</option>)}
          </select>
          <button className="btn btn-outline btn-sm" onClick={createSousDossier}>+ Sous-dossier</button>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {selected.size > 0 && (
            <button className="btn btn-outline btn-sm" onClick={validateSelection}>
              Valider la sélection ({selected.size})
            </button>
          )}
          <button className="btn btn-primary btn-sm" onClick={() => setEditing('new')}>+ Ajouter une pièce</button>
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
                <th></th>
                <th>Date</th>
                <th>Tiers</th>
                <th>Catégorie</th>
                <th>Sous-dossier</th>
                <th>Montant TTC</th>
                <th>Statut</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id} className="clickable">
                  <td onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggleSelect(p.id)} />
                  </td>
                  <td onClick={() => setEditing(p)}>{formatDate(p.date_piece)}</td>
                  <td onClick={() => setEditing(p)}>{p.tiers ?? '—'}</td>
                  <td onClick={() => setEditing(p)}>{categorieLabel(p.categorie_id)}</td>
                  <td onClick={() => setEditing(p)}>{sousDossierLabel(p.sous_dossier_id)}</td>
                  <td onClick={() => setEditing(p)}>{formatMoney(p.montant_ttc)}</td>
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
          tiersConnus={tiersConnus}
          piece={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={load}
        />
      )}
    </>
  )
}
