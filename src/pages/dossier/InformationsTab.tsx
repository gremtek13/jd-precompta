import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import type { VehiculeType } from '../../lib/types'

// Informations déclaratives saisies une fois par le cabinet (ou récupérées auprès du client) plutôt
// que déduites d'un document — un type de véhicule ou l'existence de tickets-restaurant ne se lit pas
// de manière fiable dans un relevé bancaire. Alimentent la Checklist (justificatifs à obtenir) et,
// plus tard, le calcul des paniers repas (jours_travailles_an).
export default function InformationsTab({ dossierId }: { dossierId: string }) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const [vehiculeType, setVehiculeType] = useState<VehiculeType>('aucun')
  const [vehiculeLibelle, setVehiculeLibelle] = useState('')
  const [joursTravailles, setJoursTravailles] = useState('')
  const [ticketsRestaurant, setTicketsRestaurant] = useState(false)
  const [chequesVacances, setChequesVacances] = useState(false)
  const [notes, setNotes] = useState('')

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('informations_dossier').select('*').eq('dossier_id', dossierId).maybeSingle()
    if (data) {
      setVehiculeType(data.vehicule_type)
      setVehiculeLibelle(data.vehicule_libelle ?? '')
      setJoursTravailles(data.jours_travailles_an != null ? String(data.jours_travailles_an) : '')
      setTicketsRestaurant(data.tickets_restaurant)
      setChequesVacances(data.cheques_vacances)
      setNotes(data.notes ?? '')
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [dossierId])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const payload = {
        dossier_id: dossierId,
        vehicule_type: vehiculeType,
        vehicule_libelle: vehiculeType === 'aucun' ? null : (vehiculeLibelle.trim() || null),
        jours_travailles_an: joursTravailles ? parseInt(joursTravailles, 10) : null,
        tickets_restaurant: ticketsRestaurant,
        cheques_vacances: chequesVacances,
        notes: notes.trim() || null,
        updated_at: new Date().toISOString(),
      }
      // Upsert sur dossier_id (contrainte unique en base) : une seule ligne d'informations par
      // dossier, qu'elle existe déjà ou non.
      const { error: upsertError } = await supabase.from('informations_dossier').upsert(payload, { onConflict: 'dossier_id' })
      if (upsertError) throw upsertError
      setSaved(true)
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Une erreur est survenue.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <p className="muted">Chargement…</p>

  return (
    <div className="card" style={{ maxWidth: 640 }}>
      <h3 style={{ marginTop: 0 }}>Informations du client</h3>
      <p className="muted" style={{ marginTop: -8 }}>
        Renseigné une fois, rarement modifié — sert à savoir quels justificatifs demander (voir la Checklist)
        et plus tard au calcul des paniers repas.
      </p>

      <form onSubmit={handleSubmit}>
        <div className="field-row">
          <div className="field">
            <label htmlFor="vehiculeType">Véhicule</label>
            <select id="vehiculeType" value={vehiculeType} onChange={(e) => setVehiculeType(e.target.value as VehiculeType)}>
              <option value="aucun">Aucun</option>
              <option value="personnel_ik">Personnel — indemnités kilométriques (IK)</option>
              <option value="societe">Véhicule de société</option>
            </select>
          </div>
          {vehiculeType !== 'aucun' && (
            <div className="field">
              <label htmlFor="vehiculeLibelle">Véhicule (modèle)</label>
              <input id="vehiculeLibelle" value={vehiculeLibelle} onChange={(e) => setVehiculeLibelle(e.target.value)} placeholder="ex. Peugeot 308" />
            </div>
          )}
        </div>

        <div className="field">
          <label htmlFor="jours">Jours travaillés dans l'année</label>
          <input id="jours" type="number" min={0} max={366} value={joursTravailles} onChange={(e) => setJoursTravailles(e.target.value)} style={{ maxWidth: 140 }} />
        </div>

        <div className="field">
          <label>
            <input type="checkbox" checked={ticketsRestaurant} onChange={(e) => setTicketsRestaurant(e.target.checked)} style={{ marginRight: 6 }} />
            Tickets restaurant
          </label>
        </div>
        <div className="field">
          <label>
            <input type="checkbox" checked={chequesVacances} onChange={(e) => setChequesVacances(e.target.checked)} style={{ marginRight: 6 }} />
            Chèques vacances
          </label>
        </div>

        <div className="field">
          <label htmlFor="notes">Autres informations (mutuelle, local professionnel…)</label>
          <textarea id="notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        {error && <p className="error-text">{error}</p>}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button className="btn btn-primary" type="submit" disabled={saving}>
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
          {saved && <span className="muted">Enregistré ✓</span>}
        </div>
      </form>
    </div>
  )
}
