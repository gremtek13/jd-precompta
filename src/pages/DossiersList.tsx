import { useEffect, useState, type CSSProperties, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { rechercherCodeNaf } from '../lib/sirene'
import type { Dossier } from '../lib/types'

interface DossierRow extends Dossier {
  nbAValider: number
  moisPresents: number
  moisEcoules: number
  cotisationsOk: boolean
}

const ANNEE_COURANTE = new Date().getFullYear()
const MOIS_ECOULES = new Date().getMonth() + 1

// Dashboard cabinet : ce qui a besoin d'attention sur l'ensemble des dossiers, sans avoir à ouvrir
// chacun pour le savoir. Trois requêtes globales (pas une par dossier) puis agrégation côté client —
// mêmes signaux que la Checklist de chaque dossier (relevés bancaires de l'année en cours, appels de
// cotisation), volontairement réduits aux deux qui s'appliquent à tous les dossiers sans configuration
// préalable (véhicule, tickets restaurant... restent spécifiques à la Checklist du dossier).
export default function DossiersList() {
  const [dossiers, setDossiers] = useState<DossierRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showNew, setShowNew] = useState(false)
  const navigate = useNavigate()

  async function load() {
    setLoading(true)
    const debutAnnee = `${ANNEE_COURANTE}-01-01`

    const [{ data: dossierData }, { data: pieceCounts }, { data: lignesBancaires }, { data: cotisations }] = await Promise.all([
      supabase.from('dossiers').select('*').eq('archive', false).order('nom'),
      supabase.from('pieces').select('dossier_id').eq('statut', 'a_valider'),
      supabase.from('lignes_bancaires').select('dossier_id, date').gte('date', debutAnnee),
      supabase.from('cotisations_declarees').select('dossier_id, echeance').gte('echeance', debutAnnee),
    ])

    const aValider = new Map<string, number>()
    for (const p of pieceCounts ?? []) aValider.set(p.dossier_id, (aValider.get(p.dossier_id) ?? 0) + 1)

    const moisParDossier = new Map<string, Set<number>>()
    for (const l of lignesBancaires ?? []) {
      const set = moisParDossier.get(l.dossier_id) ?? new Set<number>()
      set.add(new Date(l.date).getMonth() + 1)
      moisParDossier.set(l.dossier_id, set)
    }

    const cotisationsOk = new Set<string>()
    for (const c of cotisations ?? []) cotisationsOk.add(c.dossier_id)

    setDossiers(
      (dossierData ?? []).map((d) => ({
        ...d,
        nbAValider: aValider.get(d.id) ?? 0,
        moisPresents: moisParDossier.get(d.id)?.size ?? 0,
        moisEcoules: MOIS_ECOULES,
        cotisationsOk: cotisationsOk.has(d.id),
      })),
    )
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  const filtered = dossiers.filter((d) => d.nom.toLowerCase().includes(search.toLowerCase()))

  // Un dossier avec au moins un point à régler remonte en premier — inutile de parcourir toute la
  // liste pour repérer ce qui a besoin d'attention.
  const alerte = (d: DossierRow) => d.nbAValider > 0 || d.moisPresents < d.moisEcoules || !d.cotisationsOk
  const trie = [...filtered].sort((a, b) => Number(alerte(b)) - Number(alerte(a)) || a.nom.localeCompare(b.nom))
  const nbAvecAlerte = filtered.filter(alerte).length

  return (
    <>
      <div className="topbar">
        <h1>Dossiers</h1>
        <button className="btn btn-primary" onClick={() => setShowNew(true)}>+ Nouveau dossier</button>
      </div>

      {!loading && filtered.length > 0 && (
        <div className="stat-grid">
          <div className="stat-card">
            <div className="stat-value">{filtered.length}</div>
            <div className="stat-label">Dossier(s) au total</div>
          </div>
          <div className={`stat-card ${nbAvecAlerte > 0 ? 'stat-warning' : ''}`}>
            <div className="stat-value">{nbAvecAlerte}</div>
            <div className="stat-label">Avec un point à régler</div>
          </div>
          <div className="stat-card stat-ok">
            <div className="stat-value">{filtered.length - nbAvecAlerte}</div>
            <div className="stat-label">À jour</div>
          </div>
        </div>
      )}

      <input
        placeholder="Rechercher un dossier…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ marginBottom: 16, padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 8, width: 280, maxWidth: '100%' }}
      />

      <div className="card table-scroll" style={{ padding: 0 }}>
        {loading ? (
          <p className="muted" style={{ padding: 20 }}>Chargement…</p>
        ) : filtered.length === 0 ? (
          <div className="empty-state">Aucun dossier pour l'instant.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Nom</th>
                <th>Pièces</th>
                <th>Relevés bancaires {ANNEE_COURANTE}</th>
                <th>Cotisations {ANNEE_COURANTE}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {trie.map((d) => (
                <tr key={d.id} className="clickable" onClick={() => navigate(`/dossiers/${d.id}`)}>
                  <td>{d.nom}</td>
                  <td>
                    {d.nbAValider > 0 ? (
                      <span className="badge badge-warning">{d.nbAValider} à valider</span>
                    ) : (
                      <span className="badge badge-ok">à jour</span>
                    )}
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div className="progress-track mini-progress">
                        <div
                          className={`progress-fill ${d.moisPresents < d.moisEcoules ? 'warning' : ''}`}
                          style={{ width: `${Math.min(100, (d.moisPresents / d.moisEcoules) * 100)}%` }}
                        />
                      </div>
                      <span className="muted" style={{ fontSize: '0.8rem', fontWeight: 600 }}>{d.moisPresents}/{d.moisEcoules}</span>
                    </div>
                  </td>
                  <td>
                    {d.cotisationsOk ? (
                      <span className="badge badge-ok">reçues</span>
                    ) : (
                      <span className="badge badge-warning">aucune</span>
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
  const [codeNaf, setCodeNaf] = useState<string | null>(null)
  const [libelleNaf, setLibelleNaf] = useState<string | null>(null)
  const [detectingNaf, setDetectingNaf] = useState(false)

  // Détection best-effort de la profession dès que le SIRET est complet (14 chiffres) — voir
  // lib/sirene.ts. Jamais bloquant : un échec laisse juste le champ vide, à compléter plus tard.
  async function detecterNaf() {
    setCodeNaf(null)
    setLibelleNaf(null)
    if (siret.replace(/\D/g, '').length !== 14) return
    setDetectingNaf(true)
    const infos = await rechercherCodeNaf(siret)
    setDetectingNaf(false)
    if (infos) {
      setCodeNaf(infos.codeNaf)
      setLibelleNaf(infos.libelleNaf)
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    const { error } = await supabase.from('dossiers').insert({
      nom,
      siret: siret || null,
      contact_nom: contactNom || null,
      contact_email: contactEmail || null,
      code_naf: codeNaf,
      libelle_naf: libelleNaf,
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
      <div className="card" style={{ width: 'min(420px, 92vw)' }}>
        <h2 style={{ marginTop: 0 }}>Nouveau dossier</h2>
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="nom">Nom du client</label>
            <input id="nom" required value={nom} onChange={(e) => setNom(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="siret">SIRET</label>
            <input id="siret" value={siret} onChange={(e) => setSiret(e.target.value)} onBlur={detecterNaf} />
            {detectingNaf && <span className="muted" style={{ fontSize: '0.82rem' }}>Détection de la profession…</span>}
            {!detectingNaf && (libelleNaf || codeNaf) && (
              <span className="muted" style={{ fontSize: '0.82rem' }}>
                Profession détectée : {libelleNaf ?? `code NAF ${codeNaf}`}
              </span>
            )}
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
