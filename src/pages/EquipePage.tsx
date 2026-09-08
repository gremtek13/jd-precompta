import { useEffect, useState, type CSSProperties, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import type { CabinetAdmin, Dossier, DossierAssignation, RoleCabinetAdmin } from '../lib/types'

const LABEL_ROLE: Record<RoleCabinetAdmin, string> = {
  comptable_en_chef: 'Comptable en chef',
  comptable: 'Comptable',
}

// Gestion de l'équipe du cabinet — réservée aux chefs de cabinet (voir Layout, lien affiché seulement
// si estChef) : un "comptable en chef" voit tous les dossiers du cabinet, un simple "comptable"
// seulement ceux qui lui sont explicitement assignés ici. Seule la création du compte de connexion
// passe par une Edge Function (clé de service nécessaire pour créer un compte Auth) — le reste
// (retrait, changement de rôle, assignation de dossiers) se fait directement, protégé par les règles
// de sécurité (RLS) : un simple comptable qui tenterait ces actions serait de toute façon refusé côté
// serveur, pas seulement caché côté écran.
export default function EquipePage() {
  const { session, monCabinetId } = useAuth()
  const [membres, setMembres] = useState<CabinetAdmin[]>([])
  const [dossiers, setDossiers] = useState<Dossier[]>([])
  const [assignations, setAssignations] = useState<DossierAssignation[]>([])
  const [loading, setLoading] = useState(true)

  const [ajout, setAjout] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<RoleCabinetAdmin>('comptable')
  const [enregistrement, setEnregistrement] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)

  const [gestionDossiersDe, setGestionDossiersDe] = useState<CabinetAdmin | null>(null)

  async function load() {
    if (!monCabinetId) return
    setLoading(true)
    const [{ data: membresData }, { data: dossiersData }, { data: assignationsData }] = await Promise.all([
      supabase.from('cabinet_admins').select('user_id, cabinet_id, role, email').eq('cabinet_id', monCabinetId),
      supabase.from('dossiers').select('*').eq('cabinet_id', monCabinetId).order('nom'),
      supabase.from('dossier_assignations').select('*'),
    ])
    setMembres((membresData ?? []) as CabinetAdmin[])
    setDossiers(dossiersData ?? [])
    setAssignations(assignationsData ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [monCabinetId])

  async function ajouterMembre(e: FormEvent) {
    e.preventDefault()
    if (password.length < 10) {
      setErreur('Le mot de passe doit faire au moins 10 caractères.')
      return
    }
    setEnregistrement(true)
    setErreur(null)
    const { data, error: invokeError } = await supabase.functions.invoke<{ ok?: boolean; error?: string }>('create-team-member', {
      body: { email: email.trim(), password, role },
    })
    setEnregistrement(false)
    if (data?.error || invokeError) {
      setErreur(data?.error ?? "Échec de la création du compte.")
      return
    }
    setEmail('')
    setPassword('')
    setRole('comptable')
    setAjout(false)
    load()
  }

  async function changerRole(m: CabinetAdmin, nouveauRole: RoleCabinetAdmin) {
    const { error } = await supabase.from('cabinet_admins').update({ role: nouveauRole }).eq('user_id', m.user_id)
    if (error) {
      window.alert(error.message)
      return
    }
    load()
  }

  async function retirer(m: CabinetAdmin) {
    if (!window.confirm(`Retirer ${m.email ?? 'ce membre'} du cabinet ? Son compte de connexion n'est pas supprimé, seul son accès l'est.`)) return
    const { error } = await supabase.from('cabinet_admins').delete().eq('user_id', m.user_id)
    if (error) {
      window.alert(error.message)
      return
    }
    load()
  }

  function dossiersAssignesA(userId: string): Set<string> {
    return new Set(assignations.filter((a) => a.user_id === userId).map((a) => a.dossier_id))
  }

  async function toggleAssignation(userId: string, dossierId: string, assigne: boolean) {
    if (assigne) {
      await supabase.from('dossier_assignations').delete().eq('user_id', userId).eq('dossier_id', dossierId)
    } else {
      await supabase.from('dossier_assignations').insert({ user_id: userId, dossier_id: dossierId })
    }
    load()
  }

  return (
    <>
      <div className="topbar">
        <h1>Équipe</h1>
        <button className="btn btn-primary btn-sm" onClick={() => setAjout(true)}>+ Ajouter un membre</button>
      </div>
      <p className="muted" style={{ marginTop: -12, marginBottom: 20 }}>
        Un comptable en chef voit tous les dossiers du cabinet ; un comptable ne voit que ceux qui lui
        sont assignés explicitement ci-dessous.
      </p>

      <div className="card table-scroll" style={{ padding: 0 }}>
        {loading ? (
          <p className="muted" style={{ padding: 20 }}>Chargement…</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Email</th>
                <th>Rôle</th>
                <th>Dossiers assignés</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {membres.map((m) => (
                <tr key={m.user_id}>
                  <td>{m.email ?? '—'} {m.user_id === session?.user.id && <span className="muted">(toi)</span>}</td>
                  <td>
                    <select
                      value={m.role}
                      onChange={(e) => changerRole(m, e.target.value as RoleCabinetAdmin)}
                      aria-label={`Rôle actuel : ${LABEL_ROLE[m.role]}`}
                      // maxWidth 100% : sans ça un <select> prend la largeur de sa plus longue option
                      // ("Comptable en chef") indépendamment de sa cellule — sur mobile, où
                      // table-layout:fixed serre les colonnes, ça le faisait déborder par-dessus la
                      // colonne suivante ("Dossiers assignés") au lieu de s'y contenir.
                      style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: '4px 6px', maxWidth: '100%' }}
                    >
                      <option value="comptable_en_chef">Comptable en chef</option>
                      <option value="comptable">Comptable</option>
                    </select>
                  </td>
                  <td>
                    {m.role === 'comptable_en_chef' ? (
                      <span className="muted">Tous (chef)</span>
                    ) : (
                      <button type="button" className="btn btn-outline btn-sm" onClick={() => setGestionDossiersDe(m)}>
                        {dossiersAssignesA(m.user_id).size} dossier(s) — gérer
                      </button>
                    )}
                  </td>
                  <td className="td-actions">
                    <button type="button" className="btn btn-danger btn-sm" onClick={() => retirer(m)}>Retirer</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {ajout && (
        <div style={overlayStyle}>
          <div className="card" style={{ width: 'min(420px, 92vw)' }}>
            <h2 style={{ marginTop: 0 }}>Ajouter un membre de l'équipe</h2>
            <form onSubmit={ajouterMembre}>
              <div className="field">
                <label htmlFor="eq-email">Email</label>
                <input id="eq-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="eq-password">Mot de passe (au moins 10 caractères)</label>
                <input id="eq-password" type="text" required minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="eq-role">Rôle</label>
                <select id="eq-role" value={role} onChange={(e) => setRole(e.target.value as RoleCabinetAdmin)}>
                  <option value="comptable">Comptable (dossiers assignés seulement)</option>
                  <option value="comptable_en_chef">Comptable en chef (tous les dossiers)</option>
                </select>
              </div>
              {erreur && <p className="error-text">{erreur}</p>}
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
                <button type="button" className="btn btn-outline" onClick={() => setAjout(false)} disabled={enregistrement}>Annuler</button>
                <button type="submit" className="btn btn-primary" disabled={enregistrement}>
                  {enregistrement ? 'Création…' : 'Créer le compte'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {gestionDossiersDe && (
        <div style={overlayStyle}>
          <div className="card" style={{ width: 'min(420px, 92vw)', maxHeight: '80vh', overflowY: 'auto' }}>
            <h2 style={{ marginTop: 0 }}>Dossiers assignés à {gestionDossiersDe.email}</h2>
            {dossiers.length === 0 ? (
              <p className="muted">Aucun dossier dans ce cabinet.</p>
            ) : (
              <div>
                {dossiers.map((d) => {
                  const assigne = dossiersAssignesA(gestionDossiersDe.user_id).has(d.id)
                  return (
                    <label key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0' }}>
                      <input
                        type="checkbox"
                        checked={assigne}
                        onChange={() => toggleAssignation(gestionDossiersDe.user_id, d.id, assigne)}
                      />
                      {d.nom}
                    </label>
                  )
                })}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
              <button type="button" className="btn btn-primary" onClick={() => setGestionDossiersDe(null)}>Terminé</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

const overlayStyle: CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20,
}
