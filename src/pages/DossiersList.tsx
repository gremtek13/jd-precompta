import { useEffect, useState, type CSSProperties, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { Dossier } from '../lib/types'

interface DossierRow extends Dossier {
  nb_a_valider: number
}

export default function DossiersList() {
  const [dossiers, setDossiers] = useState<DossierRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showNew, setShowNew] = useState(false)
  const navigate = useNavigate()

  async function load() {
    setLoading(true)
    const { data: dossierData } = await supabase
      .from('dossiers')
      .select('*')
      .eq('archive', false)
      .order('nom')

    const { data: pieceCounts } = await supabase
      .from('pieces')
      .select('dossier_id')
      .eq('statut', 'a_valider')

    const counts = new Map<string, number>()
    for (const p of pieceCounts ?? []) {
      counts.set(p.dossier_id, (counts.get(p.dossier_id) ?? 0) + 1)
    }

    setDossiers((dossierData ?? []).map((d) => ({ ...d, nb_a_valider: counts.get(d.id) ?? 0 })))
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  const filtered = dossiers.filter((d) => d.nom.toLowerCase().includes(search.toLowerCase()))

  return (
    <>
      <div className="topbar">
        <h1>Dossiers</h1>
        <button className="btn btn-primary" onClick={() => setShowNew(true)}>+ Nouveau dossier</button>
      </div>

      <input
        placeholder="Rechercher un dossier…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ marginBottom: 16, padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 8, width: 280 }}
      />

      <div className="card" style={{ padding: 0 }}>
        {loading ? (
          <p className="muted" style={{ padding: 20 }}>Chargement…</p>
        ) : filtered.length === 0 ? (
          <div className="empty-state">Aucun dossier pour l'instant.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Nom</th>
                <th>Pièces à valider</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((d) => (
                <tr key={d.id} className="clickable" onClick={() => navigate(`/dossiers/${d.id}`)}>
                  <td>{d.nom}</td>
                  <td>
                    {d.nb_a_valider > 0 ? (
                      <span className="badge badge-warning">{d.nb_a_valider} à valider</span>
                    ) : (
                      <span className="badge badge-ok">à jour</span>
                    )}
                  </td>
                  <td>
                    <Link to={`/dossiers/${d.id}`} className="btn btn-outline btn-sm" onClick={(e) => e.stopPropagation()}>
                      Ouvrir
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showNew && <NewDossierModal onClose={() => setShowNew(false)} onCreated={load} />}
    </>
  )
}

function NewDossierModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [nom, setNom] = useState('')
  const [siret, setSiret] = useState('')
  const [contactNom, setContactNom] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    const { error } = await supabase.from('dossiers').insert({
      nom,
      siret: siret || null,
      contact_nom: contactNom || null,
      contact_email: contactEmail || null,
    })
    setSaving(false)
    if (error) {
      setError(error.message)
      return
    }
    onCreated()
    onClose()
  }

  return (
    <div style={overlayStyle}>
      <div className="card" style={{ width: 420 }}>
        <h2 style={{ marginTop: 0 }}>Nouveau dossier</h2>
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="nom">Nom du client</label>
            <input id="nom" required value={nom} onChange={(e) => setNom(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="siret">SIRET</label>
            <input id="siret" value={siret} onChange={(e) => setSiret(e.target.value)} />
          </div>
          <div className="field-row">
            <div className="field">
              <label htmlFor="contactNom">Contact</label>
              <input id="contactNom" value={contactNom} onChange={(e) => setContactNom(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="contactEmail">Email contact</label>
              <input id="contactEmail" type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
            </div>
          </div>
          {error && <p className="error-text">{error}</p>}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 10 }}>
            <button type="button" className="btn btn-outline" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Création…' : 'Créer'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

const overlayStyle: CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50,
}
