import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { parseCsv, parseDateBancaire, parseMontantBancaire } from '../../lib/csv'
import { formatDate, formatMoney } from '../../lib/format'
import type { LigneBancaire, Piece, StatutLigneBancaire } from '../../lib/types'

const JOURS_TOLERANCE_RAPPROCHEMENT = 5

export default function BanqueTab({ dossierId }: { dossierId: string }) {
  const [lignes, setLignes] = useState<LigneBancaire[]>([])
  const [pieces, setPieces] = useState<Piece[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'toutes' | StatutLigneBancaire>('non_rapprochee')

  async function load() {
    setLoading(true)
    const { data: lignesData } = await supabase
      .from('lignes_bancaires')
      .select('*')
      .eq('dossier_id', dossierId)
      .order('date', { ascending: false })

    const { data: piecesData } = await supabase
      .from('pieces')
      .select('*')
      .eq('dossier_id', dossierId)
      .eq('statut', 'validee')

    setLignes(lignesData ?? [])
    setPieces(piecesData ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [dossierId])

  const piecesRapprochees = useMemo(() => new Set(lignes.filter((l) => l.piece_id).map((l) => l.piece_id)), [lignes])
  const piecesSansMouvement = pieces.filter((p) => !piecesRapprochees.has(p.id))
  const filtered = filter === 'toutes' ? lignes : lignes.filter((l) => l.statut === filter)

  function suggestion(ligne: LigneBancaire): Piece | null {
    if (ligne.statut !== 'non_rapprochee') return null
    const ligneDate = new Date(ligne.date).getTime()
    const candidats = pieces.filter((p) => {
      if (piecesRapprochees.has(p.id)) return false
      if (p.montant_ttc == null) return false
      if (Math.abs(Math.abs(p.montant_ttc) - Math.abs(ligne.montant)) > 0.01) return false
      if (!p.date_piece) return false
      const jours = Math.abs(new Date(p.date_piece).getTime() - ligneDate) / 86_400_000
      return jours <= JOURS_TOLERANCE_RAPPROCHEMENT
    })
    return candidats[0] ?? null
  }

  async function rapprocher(ligneId: string, pieceId: string) {
    await supabase.from('lignes_bancaires').update({ statut: 'rapprochee', piece_id: pieceId }).eq('id', ligneId)
    load()
  }

  async function annulerRapprochement(ligneId: string) {
    await supabase.from('lignes_bancaires').update({ statut: 'non_rapprochee', piece_id: null }).eq('id', ligneId)
    load()
  }

  async function ignorer(ligneId: string) {
    await supabase.from('lignes_bancaires').update({ statut: 'ignoree', piece_id: null }).eq('id', ligneId)
    load()
  }

  const nonRapprochees = lignes.filter((l) => l.statut === 'non_rapprochee')
  const totalNonRapproche = nonRapprochees.reduce((s, l) => s + l.montant, 0)

  return (
    <>
      <ImportCsv dossierId={dossierId} onImported={load} />

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginTop: 0 }}>Écarts à vérifier</h3>
        <p className="muted" style={{ margin: 0 }}>
          {nonRapprochees.length} mouvement(s) bancaire(s) non rapproché(s) ({formatMoney(totalNonRapproche)})
          {' · '}
          {piecesSansMouvement.length} pièce(s) validée(s) sans mouvement bancaire correspondant
        </p>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        {(['toutes', 'non_rapprochee', 'rapprochee', 'ignoree'] as const).map((s) => (
          <button
            key={s}
            className={`btn btn-sm ${filter === s ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => setFilter(s)}
          >
            {s === 'toutes' ? 'Tous' : s === 'non_rapprochee' ? 'Non rapprochés' : s === 'rapprochee' ? 'Rapprochés' : 'Ignorés'}
          </button>
        ))}
      </div>

      <div className="card table-scroll" style={{ padding: 0 }}>
        {loading ? (
          <p className="muted" style={{ padding: 20 }}>Chargement…</p>
        ) : filtered.length === 0 ? (
          <div className="empty-state">Aucun mouvement bancaire{filter !== 'toutes' ? ' dans ce filtre' : ''}.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Libellé</th>
                <th>Montant</th>
                <th>Statut</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((l) => {
                const propose = suggestion(l)
                const piecePayee = l.piece_id ? pieces.find((p) => p.id === l.piece_id) : null
                return (
                  <tr key={l.id}>
                    <td>{formatDate(l.date)}</td>
                    <td>{l.libelle}</td>
                    <td>{formatMoney(l.montant)}</td>
                    <td>
                      {l.statut === 'rapprochee' && <span className="badge badge-ok">Rapproché{piecePayee ? ` — ${piecePayee.tiers ?? ''}` : ''}</span>}
                      {l.statut === 'non_rapprochee' && <span className="badge badge-warning">Non rapproché</span>}
                      {l.statut === 'ignoree' && <span className="badge badge-neutral">Ignoré</span>}
                    </td>
                    <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {l.statut === 'non_rapprochee' && propose && (
                        <button className="btn btn-outline btn-sm" onClick={() => rapprocher(l.id, propose.id)}>
                          Rapprocher avec {propose.tiers ?? 'cette pièce'} ({formatMoney(propose.montant_ttc)})
                        </button>
                      )}
                      {l.statut === 'non_rapprochee' && (
                        <>
                          <select
                            defaultValue=""
                            onChange={(e) => e.target.value && rapprocher(l.id, e.target.value)}
                            style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: '4px 6px', fontSize: '0.8rem' }}
                          >
                            <option value="">Associer manuellement…</option>
                            {pieces.filter((p) => !piecesRapprochees.has(p.id)).map((p) => (
                              <option key={p.id} value={p.id}>
                                {formatDate(p.date_piece)} — {p.tiers ?? '—'} — {formatMoney(p.montant_ttc)}
                              </option>
                            ))}
                          </select>
                          <button className="btn btn-outline btn-sm" onClick={() => ignorer(l.id)}>Ignorer</button>
                        </>
                      )}
                      {l.statut !== 'non_rapprochee' && (
                        <button className="btn btn-outline btn-sm" onClick={() => annulerRapprochement(l.id)}>Annuler</button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}

function ImportCsv({ dossierId, onImported }: { dossierId: string; onImported: () => void }) {
  const [rows, setRows] = useState<string[][] | null>(null)
  const [colDate, setColDate] = useState(0)
  const [colLibelle, setColLibelle] = useState(1)
  const [mode, setMode] = useState<'signe' | 'debit_credit'>('signe')
  const [colMontant, setColMontant] = useState(2)
  const [colDebit, setColDebit] = useState(2)
  const [colCredit, setColCredit] = useState(3)
  const [hasHeader, setHasHeader] = useState(true)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleFile(file: File) {
    setError(null)
    const text = await file.text()
    const parsed = parseCsv(text)
    if (parsed.length === 0) {
      setError('Fichier vide ou illisible.')
      return
    }
    setRows(parsed)
  }

  const dataRows = rows ? (hasHeader ? rows.slice(1) : rows) : []
  const nbColonnes = rows?.[0]?.length ?? 0

  async function handleImport() {
    if (!rows) return
    setImporting(true)
    setError(null)
    try {
      const toInsert: { dossier_id: string; date: string; libelle: string; montant: number }[] = []
      let ignorees = 0
      for (const row of dataRows) {
        const date = parseDateBancaire(row[colDate] ?? '')
        const libelle = (row[colLibelle] ?? '').trim()
        let montant: number | null = null
        if (mode === 'signe') {
          montant = parseMontantBancaire(row[colMontant] ?? '')
        } else {
          const debit = parseMontantBancaire(row[colDebit] ?? '') ?? 0
          const credit = parseMontantBancaire(row[colCredit] ?? '') ?? 0
          montant = credit - Math.abs(debit)
        }
        if (!date || montant == null || !libelle) {
          ignorees++
          continue
        }
        toInsert.push({ dossier_id: dossierId, date, libelle, montant })
      }
      if (toInsert.length === 0) throw new Error("Aucune ligne exploitable — vérifie le mapping des colonnes.")

      const { error } = await supabase.from('lignes_bancaires').insert(toInsert)
      if (error) throw error

      setRows(null)
      onImported()
      if (ignorees > 0) window.alert(`${toInsert.length} ligne(s) importée(s), ${ignorees} ignorée(s) (date/montant illisible).`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "L'import a échoué.")
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <h3 style={{ marginTop: 0 }}>Importer un relevé bancaire (CSV)</h3>
      <div className="field">
        <input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
      </div>

      {rows && (
        <>
          <div className="field">
            <label>
              <input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} style={{ marginRight: 6 }} />
              La première ligne est un en-tête
            </label>
          </div>

          <div className="table-scroll" style={{ marginBottom: 14, border: '1px solid var(--color-border)', borderRadius: 8 }}>
            <table>
              <tbody>
                {rows.slice(0, 4).map((r, i) => (
                  <tr key={i}>{r.map((cell, j) => <td key={j}>{cell}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="colDate">Colonne Date</label>
              <select id="colDate" value={colDate} onChange={(e) => setColDate(+e.target.value)}>
                {Array.from({ length: nbColonnes }).map((_, i) => <option key={i} value={i}>Colonne {i + 1}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="colLibelle">Colonne Libellé</label>
              <select id="colLibelle" value={colLibelle} onChange={(e) => setColLibelle(+e.target.value)}>
                {Array.from({ length: nbColonnes }).map((_, i) => <option key={i} value={i}>Colonne {i + 1}</option>)}
              </select>
            </div>
          </div>

          <div className="field">
            <label htmlFor="mode">Format du montant</label>
            <select id="mode" value={mode} onChange={(e) => setMode(e.target.value as 'signe' | 'debit_credit')}>
              <option value="signe">Une colonne (montant signé, négatif si débit)</option>
              <option value="debit_credit">Deux colonnes (Débit / Crédit séparées)</option>
            </select>
          </div>

          {mode === 'signe' ? (
            <div className="field">
              <label htmlFor="colMontant">Colonne Montant</label>
              <select id="colMontant" value={colMontant} onChange={(e) => setColMontant(+e.target.value)}>
                {Array.from({ length: nbColonnes }).map((_, i) => <option key={i} value={i}>Colonne {i + 1}</option>)}
              </select>
            </div>
          ) : (
            <div className="field-row">
              <div className="field">
                <label htmlFor="colDebit">Colonne Débit</label>
                <select id="colDebit" value={colDebit} onChange={(e) => setColDebit(+e.target.value)}>
                  {Array.from({ length: nbColonnes }).map((_, i) => <option key={i} value={i}>Colonne {i + 1}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="colCredit">Colonne Crédit</label>
                <select id="colCredit" value={colCredit} onChange={(e) => setColCredit(+e.target.value)}>
                  {Array.from({ length: nbColonnes }).map((_, i) => <option key={i} value={i}>Colonne {i + 1}</option>)}
                </select>
              </div>
            </div>
          )}

          {error && <p className="error-text">{error}</p>}

          <button className="btn btn-primary" onClick={handleImport} disabled={importing}>
            {importing ? 'Import…' : `Importer ${dataRows.length} ligne(s)`}
          </button>
        </>
      )}
    </div>
  )
}
