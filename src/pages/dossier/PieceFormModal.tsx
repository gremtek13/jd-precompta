import { useState, type CSSProperties, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { slugify } from '../../lib/format'
import type { Categorie, Piece, TypePiece } from '../../lib/types'

interface Props {
  dossierId: string
  categories: Categorie[]
  tiersConnus: string[]
  piece: Piece | null // null = création
  onClose: () => void
  onSaved: () => void
}

export default function PieceFormModal({ dossierId, categories, tiersConnus, piece, onClose, onSaved }: Props) {
  const [file, setFile] = useState<File | null>(null)
  const [datePiece, setDatePiece] = useState(piece?.date_piece ?? '')
  const [tiers, setTiers] = useState(piece?.tiers ?? '')
  const [typePiece, setTypePiece] = useState<TypePiece>(piece?.type_piece ?? 'achat')
  const [categorieId, setCategorieId] = useState(piece?.categorie_id ?? '')
  const [montantHt, setMontantHt] = useState(piece?.montant_ht?.toString() ?? '')
  const [montantTva, setMontantTva] = useState(piece?.montant_tva?.toString() ?? '')
  const [montantTtc, setMontantTtc] = useState(piece?.montant_ttc?.toString() ?? '')
  const [notes, setNotes] = useState(piece?.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function recalcFromHtTva(ht: string, tva: string) {
    const htN = parseFloat(ht)
    const tvaN = parseFloat(tva)
    if (!Number.isNaN(htN) && !Number.isNaN(tvaN)) {
      setMontantTtc((htN + tvaN).toFixed(2))
    }
  }

  async function uploadFile(): Promise<string | null> {
    if (!file) return piece?.storage_path ?? null
    const path = `${dossierId}/${Date.now()}-${slugify(file.name)}`
    const { error } = await supabase.storage.from('pieces').upload(path, file)
    if (error) throw error
    return path
  }

  async function save(statut: 'a_valider' | 'validee') {
    setSaving(true)
    setError(null)
    try {
      if (statut === 'validee' && !montantTtc) {
        throw new Error('Le montant TTC est obligatoire pour valider une pièce.')
      }
      if (!piece && !file) {
        throw new Error('Merci de déposer un fichier.')
      }
      const storagePath = await uploadFile()
      const { data: userData } = await supabase.auth.getUser()

      const payload = {
        dossier_id: dossierId,
        storage_path: storagePath,
        nom_fichier: file?.name ?? piece?.nom_fichier,
        date_piece: datePiece || null,
        tiers: tiers || null,
        type_piece: typePiece,
        categorie_id: categorieId || null,
        montant_ht: montantHt ? parseFloat(montantHt) : null,
        montant_tva: montantTva ? parseFloat(montantTva) : null,
        montant_ttc: montantTtc ? parseFloat(montantTtc) : null,
        notes: notes || null,
        statut,
      }

      if (piece) {
        const { error } = await supabase.from('pieces').update(payload).eq('id', piece.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('pieces').insert({ ...payload, uploaded_by: userData.user!.id })
        if (error) throw error
      }

      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Une erreur est survenue.')
    } finally {
      setSaving(false)
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    save('validee')
  }

  return (
    <div style={overlayStyle}>
      <div className="card" style={{ width: 520, maxHeight: '90vh', overflowY: 'auto' }}>
        <h2 style={{ marginTop: 0 }}>{piece ? 'Modifier la pièce' : 'Ajouter une pièce'}</h2>
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="file">Fichier {piece && '(laisser vide pour garder l\'actuel)'}</label>
            <input id="file" type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            {piece && !file && <span className="muted">Actuel : {piece.nom_fichier}</span>}
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="date">Date de la pièce</label>
              <input id="date" type="date" value={datePiece} onChange={(e) => setDatePiece(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="type">Type</label>
              <select id="type" value={typePiece} onChange={(e) => setTypePiece(e.target.value as TypePiece)}>
                <option value="achat">Achat</option>
                <option value="vente">Vente</option>
                <option value="note_frais">Note de frais</option>
                <option value="autre">Autre</option>
              </select>
            </div>
          </div>

          <div className="field">
            <label htmlFor="tiers">Tiers (fournisseur / client)</label>
            <input id="tiers" list="tiers-connus" value={tiers} onChange={(e) => setTiers(e.target.value)} />
            <datalist id="tiers-connus">
              {tiersConnus.map((t) => <option key={t} value={t} />)}
            </datalist>
          </div>

          <div className="field">
            <label htmlFor="categorie">Catégorie</label>
            <select id="categorie" value={categorieId} onChange={(e) => setCategorieId(e.target.value)}>
              <option value="">— Choisir —</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.libelle}</option>)}
            </select>
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="ht">Montant HT</label>
              <input id="ht" type="number" step="0.01" value={montantHt} onChange={(e) => { setMontantHt(e.target.value); recalcFromHtTva(e.target.value, montantTva) }} />
            </div>
            <div className="field">
              <label htmlFor="tva">TVA</label>
              <input id="tva" type="number" step="0.01" value={montantTva} onChange={(e) => { setMontantTva(e.target.value); recalcFromHtTva(montantHt, e.target.value) }} />
            </div>
            <div className="field">
              <label htmlFor="ttc">Montant TTC</label>
              <input id="ttc" type="number" step="0.01" value={montantTtc} onChange={(e) => setMontantTtc(e.target.value)} />
            </div>
          </div>

          <div className="field">
            <label htmlFor="notes">Notes</label>
            <textarea id="notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          {error && <p className="error-text">{error}</p>}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 10 }}>
            <button type="button" className="btn btn-outline" onClick={onClose}>Annuler</button>
            <button type="button" className="btn btn-outline" disabled={saving} onClick={() => save('a_valider')}>
              Enregistrer brouillon
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Enregistrement…' : 'Valider'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

const overlayStyle: CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20,
}
