import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { formatDate, formatMoney } from '../../lib/format'
import type { Categorie, EcritureBrouillon, Piece } from '../../lib/types'
import BrouillonBanner from '../../components/BrouillonBanner'

// Palier 5 — brouillon comptable, brique 1 (journal). Génère une proposition d'écriture pour
// chaque pièce validée dont la catégorie a un compte associé. Reste volontairement simple (une
// ligne par pièce, pas de contrepartie bancaire) : l'objectif est de faire gagner du temps à
// l'expert-comptable sur la ventilation par compte, pas de simuler une vraie comptabilité en
// partie double — voir le bandeau ci-dessous, non négociable.
export default function EcrituresTab({ dossierId }: { dossierId: string }) {
  const [categories, setCategories] = useState<Categorie[]>([])
  const [pieces, setPieces] = useState<Piece[]>([])
  const [ecritures, setEcritures] = useState<EcritureBrouillon[]>([])
  const [immobilisationPieceIds, setImmobilisationPieceIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [comptesEdit, setComptesEdit] = useState<Record<string, string>>({})

  async function load() {
    setLoading(true)
    const [{ data: categoriesData }, { data: piecesData }, { data: ecrituresData }, { data: immobilisationsData }] = await Promise.all([
      supabase.from('categories').select('*').or(`dossier_id.eq.${dossierId},dossier_id.is.null`).order('ordre'),
      supabase.from('pieces').select('*').eq('dossier_id', dossierId).eq('statut', 'validee'),
      supabase.from('ecritures_brouillon').select('*').eq('dossier_id', dossierId).order('date', { ascending: false }),
      supabase.from('immobilisations').select('piece_id').eq('dossier_id', dossierId),
    ])
    setCategories(categoriesData ?? [])
    setPieces(piecesData ?? [])
    setEcritures(ecrituresData ?? [])
    setImmobilisationPieceIds(new Set((immobilisationsData ?? []).map((i) => i.piece_id).filter((id): id is string => !!id)))
    setLoading(false)
  }

  useEffect(() => { load() }, [dossierId])

  const categorieById = (id: string | null) => categories.find((c) => c.id === id) ?? null

  // Catégories utilisées par au moins une pièce validée mais sans compte associé — impossible de
  // générer l'écriture correspondante tant que ce n'est pas renseigné.
  const categoriesSansCompte = categories.filter(
    (c) => !c.compte_comptable && pieces.some((p) => p.categorie_id === c.id),
  )

  async function saveCompte(categorieId: string) {
    const valeur = (comptesEdit[categorieId] ?? '').trim()
    if (!valeur) return
    const { error: saveError } = await supabase.from('categories').update({ compte_comptable: valeur }).eq('id', categorieId)
    if (saveError) {
      setError(saveError.message)
      return
    }
    load()
  }

  // Une pièce enregistrée comme immobilisation (onglet Immobilisations) est un actif, pas une charge
  // courante — elle ne doit pas aussi générer une écriture de charge ici, sous peine de compter la
  // dépense deux fois dans le brouillon.
  const piecesEligibles = pieces.filter(
    (p) => p.montant_ttc != null && !!categorieById(p.categorie_id)?.compte_comptable && !immobilisationPieceIds.has(p.id),
  )
  const enAttente = piecesEligibles.filter((p) => !ecritures.some((e) => e.piece_id === p.id))

  async function genererEcritures() {
    if (enAttente.length === 0) return
    setGenerating(true)
    setError(null)
    try {
      const rows = enAttente.map((p) => {
        const cat = categorieById(p.categorie_id)!
        return {
          dossier_id: dossierId,
          piece_id: p.id,
          date: p.date_piece ?? p.created_at.slice(0, 10),
          compte: cat.compte_comptable!,
          libelle: p.tiers ?? p.nom_fichier,
          montant: p.montant_ttc!,
          sens: p.type_piece === 'vente' ? 'credit' : 'debit',
          statut: 'proposee',
        }
      })
      const { error: insertError } = await supabase.from('ecritures_brouillon').insert(rows)
      if (insertError) throw insertError
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Une erreur est survenue.')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <>
      <BrouillonBanner />

      {categoriesSansCompte.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ marginTop: 0 }}>Comptes manquants</h3>
          <p className="muted" style={{ marginTop: -8 }}>
            Ces catégories sont utilisées par des pièces validées mais n'ont pas encore de compte comptable associé —
            les écritures correspondantes ne peuvent pas être générées tant que ce n'est pas fait.
          </p>
          <table>
            <thead><tr><th>Catégorie</th><th>Compte</th><th></th></tr></thead>
            <tbody>
              {categoriesSansCompte.map((c) => (
                <tr key={c.id}>
                  <td>{c.libelle}</td>
                  <td>
                    <input
                      style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: '5px 8px', width: 120 }}
                      placeholder="ex. 606100"
                      value={comptesEdit[c.id] ?? ''}
                      onChange={(e) => setComptesEdit((prev) => ({ ...prev, [c.id]: e.target.value }))}
                    />
                  </td>
                  <td>
                    <button className="btn btn-outline btn-sm" onClick={() => saveCompte(c.id)}>Enregistrer</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <p className="muted" style={{ margin: 0 }}>
          {ecritures.length} écriture{ecritures.length > 1 ? 's' : ''} proposée{ecritures.length > 1 ? 's' : ''}
          {enAttente.length > 0 && ` — ${enAttente.length} pièce${enAttente.length > 1 ? 's' : ''} en attente de génération`}
        </p>
        <button className="btn btn-primary btn-sm" disabled={generating || enAttente.length === 0} onClick={genererEcritures}>
          {generating ? 'Génération…' : `Générer les écritures manquantes${enAttente.length > 0 ? ` (${enAttente.length})` : ''}`}
        </button>
      </div>

      {error && <p className="error-text">{error}</p>}

      <div className="card table-scroll" style={{ padding: 0 }}>
        {loading ? (
          <p className="muted" style={{ padding: 20 }}>Chargement…</p>
        ) : ecritures.length === 0 ? (
          <div className="empty-state">Aucune écriture proposée pour l'instant.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Compte</th>
                <th>Libellé</th>
                <th>Montant</th>
                <th>Sens</th>
              </tr>
            </thead>
            <tbody>
              {ecritures.map((e) => (
                <tr key={e.id}>
                  <td>{formatDate(e.date)}</td>
                  <td style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{e.compte}</td>
                  <td>{e.libelle}</td>
                  <td>{formatMoney(e.montant)}</td>
                  <td>
                    {e.sens === 'debit'
                      ? <span className="badge badge-neutral">Débit</span>
                      : <span className="badge badge-ok">Crédit</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}
