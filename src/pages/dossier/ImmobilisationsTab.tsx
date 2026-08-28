import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { formatDate, formatMoney } from '../../lib/format'
import type { Immobilisation, Piece } from '../../lib/types'
import BrouillonBanner from '../../components/BrouillonBanner'

// Seuil au-delà duquel une dépense est candidate à l'immobilisation plutôt qu'à la charge courante.
// Valeur usuelle citée dans le document d'architecture — pas encore configurable par dossier, cette
// version couvre le cas standard.
const SEUIL_IMMOBILISATION = 500
const DUREE_DEFAUT_ANNEES = 5

// Palier 5, brique 2 — registre des immobilisations. Une pièce validée dépassant le seuil est
// proposée comme candidate ; c'est toujours le cabinet qui décide de l'enregistrer comme telle
// (jamais automatique), avec une durée d'amortissement suggérée mais modifiable. La dotation
// annuelle affichée est un calcul linéaire simple, sans prorata temporis — voir le bandeau.
export default function ImmobilisationsTab({ dossierId }: { dossierId: string }) {
  const [pieces, setPieces] = useState<Piece[]>([])
  const [immobilisations, setImmobilisations] = useState<Immobilisation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [durees, setDurees] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    const [{ data: piecesData }, { data: immobilisationsData }] = await Promise.all([
      supabase.from('pieces').select('*').eq('dossier_id', dossierId).eq('statut', 'validee'),
      supabase.from('immobilisations').select('*').eq('dossier_id', dossierId).order('date_acquisition', { ascending: false }),
    ])
    setPieces(piecesData ?? [])
    setImmobilisations(immobilisationsData ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [dossierId])

  const dejaEnregistrees = new Set(immobilisations.map((i) => i.piece_id).filter(Boolean))
  const candidates = pieces.filter(
    (p) => p.montant_ttc != null && p.montant_ttc >= SEUIL_IMMOBILISATION && !dejaEnregistrees.has(p.id),
  )

  async function enregistrer(piece: Piece) {
    const duree = parseInt(durees[piece.id] ?? String(DUREE_DEFAUT_ANNEES), 10)
    if (!duree || duree < 1) {
      setError('Durée invalide.')
      return
    }
    setSaving(piece.id)
    setError(null)
    try {
      const { error: insertError } = await supabase.from('immobilisations').insert({
        dossier_id: dossierId,
        piece_id: piece.id,
        libelle: piece.tiers ?? piece.nom_fichier,
        valeur: piece.montant_ttc,
        date_acquisition: piece.date_piece ?? piece.created_at.slice(0, 10),
        duree_annees: duree,
      })
      if (insertError) throw insertError
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Une erreur est survenue.')
    } finally {
      setSaving(null)
    }
  }

  async function retirer(id: string) {
    if (!window.confirm('Retirer cette immobilisation ? La pièce redevient une charge courante ordinaire.')) return
    await supabase.from('immobilisations').delete().eq('id', id)
    load()
  }

  return (
    <>
      <BrouillonBanner />

      {candidates.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ marginTop: 0 }}>Candidates à l'immobilisation</h3>
          <p className="muted" style={{ marginTop: -8 }}>
            Pièces validées de {formatMoney(SEUIL_IMMOBILISATION)} ou plus — à toi de décider si c'est un
            investissement (matériel, véhicule…) ou une simple charge importante.
          </p>
          <table>
            <thead><tr><th>Pièce</th><th>Montant</th><th>Durée (années)</th><th></th></tr></thead>
            <tbody>
              {candidates.map((p) => (
                <tr key={p.id}>
                  <td>{p.tiers ?? p.nom_fichier}</td>
                  <td>{formatMoney(p.montant_ttc)}</td>
                  <td>
                    <input
                      type="number"
                      min={1}
                      style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: '5px 8px', width: 70 }}
                      placeholder={String(DUREE_DEFAUT_ANNEES)}
                      value={durees[p.id] ?? ''}
                      onChange={(e) => setDurees((prev) => ({ ...prev, [p.id]: e.target.value }))}
                    />
                  </td>
                  <td>
                    <button className="btn btn-outline btn-sm" disabled={saving === p.id} onClick={() => enregistrer(p)}>
                      {saving === p.id ? 'Enregistrement…' : 'Enregistrer comme immobilisation'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {error && <p className="error-text">{error}</p>}

      <div className="card table-scroll" style={{ padding: 0 }}>
        {loading ? (
          <p className="muted" style={{ padding: 20 }}>Chargement…</p>
        ) : immobilisations.length === 0 ? (
          <div className="empty-state">Aucune immobilisation enregistrée pour l'instant.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Libellé</th>
                <th>Valeur</th>
                <th>Date d'acquisition</th>
                <th>Durée</th>
                <th>Dotation annuelle</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {immobilisations.map((i) => (
                <tr key={i.id}>
                  <td>{i.libelle}</td>
                  <td>{formatMoney(i.valeur)}</td>
                  <td>{formatDate(i.date_acquisition)}</td>
                  <td>{i.duree_annees} an{i.duree_annees > 1 ? 's' : ''}</td>
                  <td>{formatMoney(i.valeur / i.duree_annees)}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <button className="btn btn-danger btn-sm" onClick={() => retirer(i.id)}>Retirer</button>
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
