import { useEffect, useState, type CSSProperties, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { normalizeTiers, slugify } from '../../lib/format'
import { extractPiece, fichierDejaPresent, hashFichier } from '../../lib/extraction'
import { suggererCategorie } from '../../lib/tiersCategories'
import type { Categorie, Piece, SousDossier, TiersCategorie, TiersCategorieCabinet, TypePiece } from '../../lib/types'

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
  tiersCategoriesCabinet: TiersCategorieCabinet[]
  tiersConnus: string[]
  piece: Piece | null // null = création
  onClose: () => void
  onSaved: () => void
}

export default function PieceFormModal({ dossierId, categories, sousDossiers, tiersCategories, tiersCategoriesCabinet, tiersConnus, piece, onClose, onSaved }: Props) {
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
  // Initialisé depuis la pièce (pas null) : sans ça, rouvrir une pièce déjà extraite sans relancer
  // l'extraction écraserait sa confiance enregistrée à la sauvegarde suivante.
  const [confiance, setConfiance] = useState<'haute' | 'moyenne' | 'basse' | null>(piece?.confiance ?? null)
  const [suggestionAutre, setSuggestionAutre] = useState<string | null>(null)
  const [lignesBrutes, setLignesBrutes] = useState<string[] | undefined>(undefined)
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

  // Si ce tiers a déjà été catégorisé sur une pièce précédente — de ce dossier en priorité, sinon
  // partagée entre tous les dossiers (voir lib/tiersCategories.ts) — on reprend la même catégorie
  // automatiquement, sans écraser un choix déjà fait manuellement.
  function suggestCategorieFromTiers(value: string) {
    if (categorieId || !value.trim()) return
    const suggestion = suggererCategorie(value, tiersCategories, tiersCategoriesCabinet)
    if (suggestion) setCategorieId(suggestion)
  }

  function recalcFromHtTva(ht: string, tva: string) {
    const htN = parseFloat(ht)
    const tvaN = parseFloat(tva)
    if (!Number.isNaN(htN) && !Number.isNaN(tvaN)) {
      setMontantTtc((htN + tvaN).toFixed(2))
    }
  }

  async function handleExtract() {
    setExtracting(true)
    setExtractionError(null)
    setConfiance(null)
    setLignesBrutes(undefined)
    setSuggestionAutre(null)
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

      const result = await extractPiece(source, name)

      if (result.date_piece) setDatePiece(result.date_piece)
      if (result.tiers) {
        setTiers(result.tiers)
        suggestCategorieFromTiers(result.tiers)
      }
      if (result.montant_ht != null) setMontantHt(result.montant_ht.toString())
      if (result.montant_tva != null) setMontantTva(result.montant_tva.toString())
      if (result.montant_ttc != null) setMontantTtc(result.montant_ttc.toString())
      setConfiance(result.confiance)
      if (result._lignes_brutes) setLignesBrutes(result._lignes_brutes)
      // Signal doux, pas bloquant : la classification auto (utilisée pour trier l'import en masse)
      // pense que ce n'est pas une facture — l'utilisateur reste libre de continuer ici, mais autant
      // le prévenir plutôt que de laisser deviner pourquoi aucun montant ne ressort.
      const classification = result.classification
      if (classification !== 'facture') {
        const labels: Record<Exclude<typeof classification, 'facture'>, string> = {
          releve_bancaire: 'un relevé bancaire',
          cotisation: 'un appel de cotisation',
          attestation: 'une attestation/certificat',
        }
        setSuggestionAutre(`Ce document ressemble plutôt à ${labels[classification]} qu'à une facture — l'onglet Documents serait peut-être plus adapté.`)
      }
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
      // Uniquement quand un nouveau fichier est choisi (pas en simple modification d'une pièce
      // existante sans redéposer) — même détection que l'import en masse et les autres dépôts à
      // l'unité (Documents, Cotisations).
      const hash = file ? await hashFichier(file) : null
      if (hash && (await fichierDejaPresent(dossierId, hash))) {
        throw new Error('Ce fichier est déjà présent dans ce dossier (Pièces ou Documents).')
      }
      const storagePath = await uploadFile()
      const { data: userData } = await supabase.auth.getUser()

      const payload = {
        dossier_id: dossierId,
        storage_path: storagePath,
        ...(hash ? { storage_hash: hash } : {}),
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
        confiance,
      }

      if (piece) {
        const { error } = await supabase.from('pieces').update(payload).eq('id', piece.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('pieces').insert({ ...payload, uploaded_by: userData.user!.id })
        if (error) throw error
      }

      // Mémorise la correspondance tiers → catégorie pour la reproposer automatiquement la prochaine
      // fois, sur ce dossier. Best-effort : un échec ici ne doit pas remettre en cause la sauvegarde
      // de la pièce.
      if (tiers.trim() && categorieId) {
        await supabase.from('tiers_categories').upsert(
          { dossier_id: dossierId, tiers_normalise: normalizeTiers(tiers), categorie_id: categorieId },
          { onConflict: 'dossier_id,tiers_normalise' },
        )
        // Catégorie choisie parmi les catégories globales (dossier_id null) : la correspondance a du
        // sens au-delà de ce seul dossier (une mutuelle, une banque... reviennent souvent d'un client
        // à l'autre), donc on la mémorise aussi au niveau cabinet — voir lib/tiersCategories.ts. Une
        // catégorie propre à ce dossier reste, elle, sans équivalent chez un autre client.
        const categorieChoisie = categories.find((c) => c.id === categorieId)
        if (categorieChoisie && categorieChoisie.dossier_id === null) {
          await supabase.from('tiers_categories_cabinet').upsert(
            { tiers_normalise: normalizeTiers(tiers), categorie_id: categorieId },
            { onConflict: 'tiers_normalise' },
          )
        }
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
          {suggestionAutre && <p className="muted" style={{ marginTop: -8 }}>💡 {suggestionAutre}</p>}

          {lignesBrutes && (
            <details className="field" style={{ marginTop: -8 }}>
              <summary className="muted" style={{ cursor: 'pointer' }}>TVA introuvable — diagnostic (temporaire), clique pour copier</summary>
              <pre style={{ fontSize: '0.75rem', background: 'var(--color-bg)', padding: 8, borderRadius: 8, overflowX: 'auto', userSelect: 'all' }}>
                {lignesBrutes.join('\n')}
              </pre>
            </details>
          )}

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
