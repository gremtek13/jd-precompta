import { useEffect, useState, type CSSProperties, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { normalizeTiers, slugify } from '../../lib/format'
import type { Categorie, Piece, SousDossier, TiersCategorie, TypePiece } from '../../lib/types'

function typeApercu(nom: string): 'image' | 'pdf' | 'autre' {
  const ext = nom.toLowerCase().split('.').pop() ?? ''
  if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) return 'image'
  if (ext === 'pdf') return 'pdf'
  return 'autre'
}

interface Props {
  dossierId: string
  categories: Categorie[]
  sousDossiers: SousDossier[]
  tiersCategories: TiersCategorie[]
  tiersConnus: string[]
  piece: Piece | null // null = création
  onClose: () => void
  onSaved: () => void
}

export default function PieceFormModal({ dossierId, categories, sousDossiers, tiersCategories, tiersConnus, piece, onClose, onSaved }: Props) {
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
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [extracting, setExtracting] = useState(false)
  const [extractionError, setExtractionError] = useState<string | null>(null)
  const [confiance, setConfiance] = useState<'haute' | 'moyenne' | 'basse' | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)

  // Aperçu : le fichier fraîchement choisi se prévisualise localement (pas besoin de l'uploader
  // d'abord) ; le fichier déjà en storage passe par une URL signée temporaire, le bucket n'étant pas
  // public. On révoque l'URL locale à chaque changement pour ne pas fuiter de mémoire.
  useEffect(() => {
    if (file) {
      const url = URL.createObjectURL(file)
      setPreviewUrl(url)
      setPreviewError(null)
      return () => URL.revokeObjectURL(url)
    }
    if (piece?.storage_path) {
      let annule = false
      supabase.storage.from('pieces').createSignedUrl(piece.storage_path, 300).then(({ data, error }) => {
        if (annule) return
        if (error || !data) {
          setPreviewError("Aperçu indisponible.")
          setPreviewUrl(null)
        } else {
          setPreviewUrl(data.signedUrl)
          setPreviewError(null)
        }
      })
      return () => { annule = true }
    }
    setPreviewUrl(null)
  }, [file, piece?.storage_path])

  // Si ce tiers a déjà été catégorisé sur une pièce précédente de ce dossier, on reprend la même
  // catégorie automatiquement — sans écraser un choix déjà fait manuellement.
  function suggestCategorieFromTiers(value: string) {
    if (categorieId || !value.trim()) return
    const match = tiersCategories.find((tc) => tc.tiers_normalise === normalizeTiers(value))
    if (match) setCategorieId(match.categorie_id)
  }

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

  // Textract n'accepte que JPEG/PNG/PDF(1 page)/TIFF. Une photo de téléphone peut être en HEIC en
  // interne malgré un nom en .jpeg, ou avoir des particularités (profil couleur, etc.) que Textract
  // refuse. On la redécode systématiquement en JPEG standard côté navigateur avant l'envoi — les PDF
  // passent tels quels, Textract les gère nativement.
  async function normalizeForExtraction(source: Blob, name: string): Promise<Blob> {
    const isPdf = source.type === 'application/pdf' || name.toLowerCase().endsWith('.pdf')
    if (isPdf) return source

    try {
      const bitmap = await createImageBitmap(source)
      const maxSide = 2400
      const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
      const w = Math.round(bitmap.width * scale)
      const h = Math.round(bitmap.height * scale)
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Canvas indisponible.')
      ctx.drawImage(bitmap, 0, 0, w, h)
      return await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Conversion JPEG impossible.'))), 'image/jpeg', 0.9)
      )
    } catch {
      // Format non décodable par le navigateur : on envoie tel quel, Textract tranchera.
      return source
    }
  }

  async function handleExtract() {
    setExtracting(true)
    setExtractionError(null)
    setConfiance(null)
    try {
      // Fichier fraîchement choisi, ou téléchargement du fichier déjà attaché en édition.
      let source: Blob
      let name: string
      if (file) {
        source = file
        name = file.name
      } else if (piece?.storage_path) {
        const { data, error } = await supabase.storage.from('pieces').download(piece.storage_path)
        if (error || !data) throw new Error("Impossible de récupérer le fichier existant.")
        source = data
        name = piece.nom_fichier
      } else {
        throw new Error('Dépose un fichier avant de lancer l\'extraction.')
      }

      const normalized = await normalizeForExtraction(source, name)
      const bytes = await normalized.arrayBuffer()

      const { data: result, error } = await supabase.functions.invoke<ExtractionResult>('extract-piece', { body: bytes })
      if (error) throw error
      if (!result || result.error) throw new Error(result?.error ?? "L'extraction a échoué.")

      if (result.date_piece) setDatePiece(result.date_piece)
      if (result.tiers) {
        setTiers(result.tiers)
        suggestCategorieFromTiers(result.tiers)
      }
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

      // Mémorise la correspondance tiers → catégorie pour la reproposer automatiquement la prochaine
      // fois. Best-effort : un échec ici ne doit pas remettre en cause la sauvegarde de la pièce.
      if (tiers.trim() && categorieId) {
        await supabase.from('tiers_categories').upsert(
          { dossier_id: dossierId, tiers_normalise: normalizeTiers(tiers), categorie_id: categorieId },
          { onConflict: 'dossier_id,tiers_normalise' },
        )
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

  async function handleDelete() {
    if (!piece) return
    if (!window.confirm(`Supprimer définitivement la pièce "${piece.nom_fichier}" ? Cette action est irréversible.`)) return
    setDeleting(true)
    setError(null)
    try {
      const { error: deleteError } = await supabase.from('pieces').delete().eq('id', piece.id)
      if (deleteError) {
        // Contrainte de clé étrangère (23503) : la pièce est encore référencée ailleurs (rapprochement
        // bancaire, pack déjà généré) — message clair plutôt que l'erreur Postgres brute.
        if (deleteError.code === '23503') {
          throw new Error(
            "Impossible de supprimer : cette pièce est liée à un rapprochement bancaire ou à un pack déjà généré. Retire d'abord ce lien avant de la supprimer."
          )
        }
        throw deleteError
      }

      // Best-effort : le fichier au storage n'a pas besoin de bloquer la suppression de la pièce s'il
      // a déjà disparu ou si la suppression échoue pour une autre raison.
      if (piece.storage_path) {
        await supabase.storage.from('pieces').remove([piece.storage_path]).catch(() => {})
      }

      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Une erreur est survenue.')
    } finally {
      setDeleting(false)
    }
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

          {(previewUrl || previewError) && (
            <div className="field">
              {previewError ? (
                <p className="muted" style={{ margin: 0 }}>{previewError}</p>
              ) : (
                <>
                  {typeApercu(file?.name ?? piece?.nom_fichier ?? '') === 'image' && (
                    <img
                      src={previewUrl!}
                      alt="Aperçu de la pièce"
                      style={{ maxWidth: '100%', maxHeight: 280, objectFit: 'contain', borderRadius: 8, border: '1px solid var(--color-border)' }}
                    />
                  )}
                  {typeApercu(file?.name ?? piece?.nom_fichier ?? '') === 'pdf' && (
                    <iframe
                      src={previewUrl!}
                      title="Aperçu de la pièce"
                      style={{ width: '100%', height: 320, border: '1px solid var(--color-border)', borderRadius: 8 }}
                    />
                  )}
                  <a href={previewUrl!} target="_blank" rel="noreferrer" className="muted" style={{ display: 'inline-block', marginTop: 6 }}>
                    Ouvrir dans un nouvel onglet ↗
                  </a>
                </>
              )}
            </div>
          )}

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
            <input
              id="tiers"
              list="tiers-connus"
              value={tiers}
              onChange={(e) => setTiers(e.target.value)}
              onBlur={(e) => suggestCategorieFromTiers(e.target.value)}
            />
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

          <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
            {piece ? (
              <button type="button" className="btn btn-danger" disabled={deleting || saving} onClick={handleDelete}>
                {deleting ? 'Suppression…' : 'Supprimer'}
              </button>
            ) : <span />}
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" className="btn btn-outline" onClick={onClose}>Annuler</button>
              <button type="button" className="btn btn-outline" disabled={saving || deleting} onClick={() => save('a_valider')}>
                Enregistrer brouillon
              </button>
              <button type="submit" className="btn btn-primary" disabled={saving || deleting}>
                {saving ? 'Enregistrement…' : 'Valider'}
              </button>
            </div>
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
