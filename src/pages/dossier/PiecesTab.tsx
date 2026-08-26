import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { formatDate, formatMoney } from '../../lib/format'
import type { Categorie, Piece } from '../../lib/types'
import PieceFormModal from './PieceFormModal'

export default function PiecesTab({ dossierId }: { dossierId: string }) {
  const [pieces, setPieces] = useState<Piece[]>([])
  const [categories, setCategories] = useState<Categorie[]>([])
  const [loading, setLoading] = useState(true)
  const [statutFilter, setStatutFilter] = useState<'toutes' | 'a_valider' | 'validee'>('toutes')
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

    setPieces(piecesData ?? [])
    setCategories(categoriesData ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [dossierId])

  const filtered = pieces.filter((p) => statutFilter === 'toutes' || p.statut === statutFilter)
  const tiersConnus = [...new Set(pieces.map((p) => p.tiers).filter((t): t is string => !!t))]
  const categorieLabel = (id: string | null) => categories.find((c) => c.id === id)?.libelle ?? '—'

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

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['toutes', 'a_valider', 'validee'] as const).map((s) => (
            <button
              key={s}
              className={`btn btn-sm ${statutFilter === s ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setStatutFilter(s)}
            >
              {s === 'toutes' ? 'Toutes' : s === 'a_valider' ? 'À valider' : 'Validées'}
            </button>
          ))}
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

      <div className="card" style={{ padding: 0 }}>
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
          tiersConnus={tiersConnus}
          piece={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={load}
        />
      )}
    </>
  )
}
