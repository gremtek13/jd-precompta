import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { formatDate, formatMoney } from '../../lib/format'
import type { CotisationDeclaree } from '../../lib/types'
import BrouillonBanner from '../../components/BrouillonBanner'

// Taux CSG-CRDS en vigueur pour les indépendants/professions libérales : 9,70 % au total, dont
// 6,80 points déductibles du revenu imposable et 2,90 points non déductibles. Source : barèmes
// Urssaf.fr — à vérifier périodiquement, ces taux peuvent évoluer d'une année sur l'autre.
const TAUX_CSG_DEDUCTIBLE = 6.8
const TAUX_CSG_CRDS_TOTAL = 9.7

// Palier 5, brique 4 — suivi des cotisations sociales. Saisie manuelle des appels et versements
// URSSAF (montants connus tardivement, jamais déductibles d'un relevé bancaire seul) et calcul
// proposé de la répartition CSG déductible/non déductible — uniquement sur la part CSG-CRDS
// explicitement renseignée, jamais sur le montant appelé total qui cumule d'autres cotisations.
export default function CotisationsTab({ dossierId }: { dossierId: string }) {
  const [cotisations, setCotisations] = useState<CotisationDeclaree[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [echeance, setEcheance] = useState('')
  const [montantAppele, setMontantAppele] = useState('')
  const [montantVerse, setMontantVerse] = useState('')
  const [montantCsgCrds, setMontantCsgCrds] = useState('')

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('cotisations_declarees')
      .select('*')
      .eq('dossier_id', dossierId)
      .order('echeance', { ascending: false })
    setCotisations(data ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [dossierId])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const { error: insertError } = await supabase.from('cotisations_declarees').insert({
        dossier_id: dossierId,
        echeance,
        montant_appele: parseFloat(montantAppele),
        montant_verse: montantVerse ? parseFloat(montantVerse) : null,
        montant_csg_crds: montantCsgCrds ? parseFloat(montantCsgCrds) : null,
      })
      if (insertError) throw insertError
      setEcheance('')
      setMontantAppele('')
      setMontantVerse('')
      setMontantCsgCrds('')
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Une erreur est survenue.')
    } finally {
      setSaving(false)
    }
  }

  async function supprimer(id: string) {
    if (!window.confirm('Retirer cette échéance ?')) return
    await supabase.from('cotisations_declarees').delete().eq('id', id)
    load()
  }

  function csgDeductible(montantCsgCrds: number | null): number | null {
    if (montantCsgCrds == null) return null
    return Number((montantCsgCrds * (TAUX_CSG_DEDUCTIBLE / TAUX_CSG_CRDS_TOTAL)).toFixed(2))
  }

  const totalAppele = cotisations.reduce((sum, c) => sum + c.montant_appele, 0)
  const totalVerse = cotisations.reduce((sum, c) => sum + (c.montant_verse ?? 0), 0)
  const totalCsgDeductible = cotisations.reduce((sum, c) => sum + (csgDeductible(c.montant_csg_crds) ?? 0), 0)

  return (
    <>
      <BrouillonBanner />

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginTop: 0 }}>Ajouter une échéance</h3>
        <form onSubmit={handleSubmit}>
          <div className="field-row">
            <div className="field">
              <label htmlFor="echeance">Échéance</label>
              <input id="echeance" type="date" required value={echeance} onChange={(e) => setEcheance(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="appele">Montant appelé</label>
              <input id="appele" type="number" step="0.01" required value={montantAppele} onChange={(e) => setMontantAppele(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="verse">Montant versé</label>
              <input id="verse" type="number" step="0.01" value={montantVerse} onChange={(e) => setMontantVerse(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="csg">dont CSG-CRDS</label>
              <input id="csg" type="number" step="0.01" value={montantCsgCrds} onChange={(e) => setMontantCsgCrds(e.target.value)} />
            </div>
          </div>
          <p className="muted" style={{ marginTop: -8 }}>
            "dont CSG-CRDS" : uniquement la part CSG-CRDS visible sur le décompte Urssaf, pas le montant
            appelé total — c'est la seule part sur laquelle la déductibilité peut être calculée.
          </p>
          {error && <p className="error-text">{error}</p>}
          <button className="btn btn-primary btn-sm" type="submit" disabled={saving}>
            {saving ? 'Enregistrement…' : 'Ajouter'}
          </button>
        </form>
      </div>

      {cotisations.length > 0 && (
        <div className="card" style={{ marginBottom: 20, display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <div>
            <span className="muted" style={{ display: 'block' }}>Total appelé</span>
            <strong>{formatMoney(totalAppele)}</strong>
          </div>
          <div>
            <span className="muted" style={{ display: 'block' }}>Total versé</span>
            <strong>{formatMoney(totalVerse)}</strong>
          </div>
          <div>
            <span className="muted" style={{ display: 'block' }}>Reste à verser</span>
            <strong>{formatMoney(totalAppele - totalVerse)}</strong>
          </div>
          <div>
            <span className="muted" style={{ display: 'block' }}>CSG déductible (proposée)</span>
            <strong>{formatMoney(totalCsgDeductible)}</strong>
          </div>
        </div>
      )}

      <div className="card table-scroll" style={{ padding: 0 }}>
        {loading ? (
          <p className="muted" style={{ padding: 20 }}>Chargement…</p>
        ) : cotisations.length === 0 ? (
          <div className="empty-state">Aucune échéance enregistrée pour l'instant.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Échéance</th>
                <th>Appelé</th>
                <th>Versé</th>
                <th>dont CSG-CRDS</th>
                <th>CSG déductible</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {cotisations.map((c) => (
                <tr key={c.id}>
                  <td>{formatDate(c.echeance)}</td>
                  <td>{formatMoney(c.montant_appele)}</td>
                  <td>{c.montant_verse != null ? formatMoney(c.montant_verse) : '—'}</td>
                  <td>{c.montant_csg_crds != null ? formatMoney(c.montant_csg_crds) : '—'}</td>
                  <td>{csgDeductible(c.montant_csg_crds) != null ? formatMoney(csgDeductible(c.montant_csg_crds)) : '—'}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <button className="btn btn-danger btn-sm" onClick={() => supprimer(c.id)}>Retirer</button>
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
