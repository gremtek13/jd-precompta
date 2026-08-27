import { useState, type CSSProperties, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { slugify } from '../../lib/format'
import type { Categorie, Piece, SousDossier, TypePiece } from '../../lib/types'

interface Props {
  dossierId: string
  categories: Categorie[]
  sousDossiers: SousDossier[]
  tiersConnus: string[]
  piece: Piece | null // null = création
  onClose: () => void
  onSaved: () => void
}

export default function PieceFormModal({ dossierId, categories, sousDossiers, tiersConnus, piece, onClose, onSaved }: Props) {
  const [file, setFile] = useState<File | null>(null)
  const [datePiece, setDatePiece] = useState(piece?.date_piece ?? '')
  const [tiers, setTiers] = useState(piece?.tiers ?? '')
  const [typePiece, setTypePiece] = useState<TypePiece>(piece?.type_piece ?? 'achat')
  const [categorieId, setCategorieId] = useState(piece?.categorie_id ?? '')
  const [sousDossierId, setSousDossierId] = useState(piece?.sous_dossier_id ?? '')
  const [montantHt, setMontantHt] = useState(piece?.montant_ht?.toString() ?? '')
  const [montantTva, setMontantTva] = useState(piece?.montant_tva?.toString() ?? '')
  const [montantTtc, setMontantTtc] = useState(piece?.montant_ttc?.toString() ?? '')
  const [notes, setNotes] = useState(piece?.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [extracting, setExtracting] = useState(false)
  const [extractionError, setExtractionError] = useState<string | null>(null)
  const [confiance, setConfiance] = useState<'haute' | 'moyenne' | 'basse' | null>(null)

  function recalcFromHtTva(ht: string, tva: string) {
    const htN = parseFloat(ht)
    const tvaN = parseFloat(tva)
    if (!Number.isNaN(htN) && !Number.isNaN(tvaN)) {
      setMontantTtc((htN + tvaN).toFixed(2))
    }
  }

  interface ExtractionResult {
    tiers: string | null
    date_piece: string | null
    montant_ht: number | null
    montant_tva: number | null
    montant_ttc: number | null
    confiance: 'haute' | 'moyenne' | 'basse'
    error?: string
  }

  async function handleExtract() {
    setExtracting(true)
    setExtractionError(null)
    setConfiance(null)
    try {
      // Octets du fichier fraîchement choisi, ou téléchargement du fichier déjà attaché en édition.
      let bytes: ArrayBuffer
      if (file) {
        bytes = await file.arrayBuffer()
      } else if (piece?.storage_path) {
        const { data, error } = await supabase.storage.from('pieces').download(piece.storage_path)
        if (error || !data) throw new Error("Impossible de récupérer le fichier existant.")
        bytes = await data.arrayBuffer()
      } else {
        throw new Error('Dépose un fichier avant de lancer l\'extraction.')
      }

      const { data: result, error } = await supabase.functions.invoke<ExtractionResult>('extract-piece', { body: bytes })
      if (error) throw error
      if (!result || result.error) throw new Error(result?.error ?? "L'extraction a échoué.")

      if (result.date_piece) setDatePiece(result.date_piece)
      if (result.tiers) setTiers(result.tiers)
      if (result.montant_ht != null) setMontantHt(result.montant_ht.toString())
      if (result.montant_tva != null) setMontantTva(result.montant_tva.toString())
      if (result.montant_ttc != null) setMontantTtc(result.montant_ttc.toString())
      setConfiance(result.confiance)
    } catch (err) {
      setExtractionError(err instanceof Error ? err.message : "L'extraction automatique a échoué — remplis le formulaire à la main.")
    } finally {
      setExtracting(false)
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
        sous_dossier_id: sousDossierId || null,
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
      <div className="card" style={{ width: 'min(520px, 92vw)', maxHeight: '90vh', overflowY: 'auto' }}>
        <h2 style={{ marginTop: 0 }}>{piece ? 'Modifier la pièce' : 'Ajouter une pièce'}</h2>
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="file">Fichier {piece && '(laisser vide pour garder l\'actuel)'}</label>
            <input id="file" type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setConfiance(null); setExtractionError(null) }} />
            {piece && !file && <span className="muted">Actuel : {piece.nom_fichier}</span>}
          </div>

          <div className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              disabled={extracting || (!file && !piece?.storage_path)}
              onClick={handleExtract}
            >
              {extracting ? 'Extraction…' : '✨ Extraire automatiquement'}
            </button>
            {confiance && (
              <span className={`badge ${confiance === 'haute' ? 'badge-ok' : confiance === 'moyenne' ? 'badge-warning' : 'badge-neutral'}`}>
                Confiance {confiance} — vérifie les champs
              </span>
            )}
          </div>
          {extractionError && <p className="error-text" style={{ marginTop: -8 }}>{extractionError}</p>}

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

          <div className="field-row">
            <div className="field">
              <label htmlFor="categorie">Catégorie</label>
              <select id="categorie" value={categorieId} onChange={(e) => setCategorieId(e.target.value)}>
                <option value="">— Choisir —</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.libelle}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="sousDossier">Sous-dossier</label>
              <select id="sousDossier" value={sousDossierId} onChange={(e) => setSousDossierId(e.target.value)}>
                <option value="">— Aucun —</option>
                {sousDossiers.map((s) => <option key={s.id} value={s.id}>{s.nom}</option>)}
              </select>
            </div>
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
