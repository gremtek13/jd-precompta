import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { formatDate, formatMoney } from '../../lib/format'
import { generatePack } from '../../lib/packGenerator'
import type { Pack, Piece } from '../../lib/types'

function firstDayLastMonth(): string {
  const d = new Date()
  d.setMonth(d.getMonth() - 1, 1)
  return d.toISOString().slice(0, 10)
}
function lastDayLastMonth(): string {
  const d = new Date()
  d.setDate(0) // dernier jour du mois précédent
  return d.toISOString().slice(0, 10)
}

export default function PacksTab({ dossierId, dossierNom }: { dossierId: string; dossierNom: string }) {
  const [packs, setPacks] = useState<Pack[]>([])
  const [periodeDebut, setPeriodeDebut] = useState(firstDayLastMonth())
  const [periodeFin, setPeriodeFin] = useState(lastDayLastMonth())
  const [preview, setPreview] = useState<{ nbValidees: number; nbAValider: number; total: number } | null>(null)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function loadPacks() {
    const { data } = await supabase.from('packs').select('*').eq('dossier_id', dossierId).order('generated_at', { ascending: false })
    setPacks(data ?? [])
  }

  async function loadPreview() {
    const { data } = await supabase
      .from('pieces')
      .select('statut, montant_ttc')
      .eq('dossier_id', dossierId)
      .gte('date_piece', periodeDebut)
      .lte('date_piece', periodeFin)
    const rows = (data ?? []) as Pick<Piece, 'statut' | 'montant_ttc'>[]
    setPreview({
      nbValidees: rows.filter((r) => r.statut === 'validee').length,
      nbAValider: rows.filter((r) => r.statut === 'a_valider').length,
      total: rows.filter((r) => r.statut === 'validee').reduce((s, r) => s + (r.montant_ttc ?? 0), 0),
    })
  }

  useEffect(() => { loadPacks() }, [dossierId])
  useEffect(() => { loadPreview() }, [dossierId, periodeDebut, periodeFin])

  async function handleGenerate() {
    setGenerating(true)
    setError(null)
    try {
      const { nbPieces, totalTtc, storagePathZip, storagePathExcel } = await generatePack(dossierId, dossierNom, periodeDebut, periodeFin)
      const { data: userData } = await supabase.auth.getUser()
      await supabase.from('packs').insert({
        dossier_id: dossierId,
        periode_debut: periodeDebut,
        periode_fin: periodeFin,
        generated_by: userData.user!.id,
        storage_path_zip: storagePathZip,
        storage_path_excel: storagePathExcel,
        nb_pieces: nbPieces,
        total_ttc: totalTtc,
      })
      loadPacks()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'La génération a échoué.')
    } finally {
      setGenerating(false)
    }
  }

  async function download(path: string) {
    const { data, error } = await supabase.storage.from('packs').createSignedUrl(path, 60)
    if (error || !data) return
    window.open(data.signedUrl, '_blank')
  }

  return (
    <>
      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginTop: 0 }}>Générer un pack</h3>
        <div className="field-row">
          <div className="field">
            <label htmlFor="debut">Du</label>
            <input id="debut" type="date" value={periodeDebut} onChange={(e) => setPeriodeDebut(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="fin">Au</label>
            <input id="fin" type="date" value={periodeFin} onChange={(e) => setPeriodeFin(e.target.value)} />
          </div>
        </div>

        {preview && (
          <p className="muted">
            {preview.nbValidees} pièce(s) validée(s) — {formatMoney(preview.total)}
            {preview.nbAValider > 0 && (
              <span style={{ color: 'var(--color-warning)' }}> · {preview.nbAValider} pièce(s) encore à valider dans cette période, non incluses</span>
            )}
          </p>
        )}

        {error && <p className="error-text">{error}</p>}

        <button className="btn btn-primary" onClick={handleGenerate} disabled={generating || !preview || preview.nbValidees === 0}>
          {generating ? 'Génération…' : 'Générer le pack'}
        </button>
      </div>

      <h3>Historique</h3>
      <div className="card" style={{ padding: 0 }}>
        {packs.length === 0 ? (
          <div className="empty-state">Aucun pack généré pour l'instant.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Période</th>
                <th>Générée le</th>
                <th>Pièces</th>
                <th>Total</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {packs.map((p) => (
                <tr key={p.id}>
                  <td>{formatDate(p.periode_debut)} → {formatDate(p.periode_fin)}</td>
                  <td>{formatDate(p.generated_at)}</td>
                  <td>{p.nb_pieces}</td>
                  <td>{formatMoney(p.total_ttc)}</td>
                  <td style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-outline btn-sm" onClick={() => download(p.storage_path_zip)}>ZIP</button>
                    <button className="btn btn-outline btn-sm" onClick={() => download(p.storage_path_excel)}>Excel</button>
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
