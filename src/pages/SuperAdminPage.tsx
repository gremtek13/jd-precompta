import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

interface CabinetApercu {
  id: string
  nom: string
  couleur_primaire: string | null
  logo_storage_path: string | null
  nb_dossiers: number
  nb_admins: number
  nb_clients: number
  created_at: string
}

// Réservée au(x) super-admin(s) (voir AuthContext.isSuperAdmin, résolu via le RPC is_super_admin()) —
// une vue d'ensemble en lecture seule de tous les comptes master (cabinets) de la plateforme. Aucune
// création/modification de cabinet ici : ça reste un accès direct en base, fait manuellement à chaque
// onboarding (voir discussion) — cet écran sert seulement à ne pas avoir à redemander "combien j'ai de
// cabinets, avec combien de dossiers chacun" à chaque fois.
export default function SuperAdminPage() {
  const [cabinets, setCabinets] = useState<CabinetApercu[]>([])
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    const [{ data: cabinetsData }, { data: dossiersData }, { data: adminsData }, { data: membershipsData }] = await Promise.all([
      supabase.from('cabinets').select('id, nom, couleur_primaire, logo_storage_path, created_at').order('created_at'),
      supabase.from('dossiers').select('id, cabinet_id'),
      supabase.from('cabinet_admins').select('cabinet_id'),
      supabase.from('memberships').select('dossier_id'),
    ])

    const cabinetParDossier = new Map(((dossiersData ?? []) as { id: string; cabinet_id: string }[]).map((d) => [d.id, d.cabinet_id]))

    const nbDossiers = new Map<string, number>()
    for (const d of (dossiersData ?? []) as { cabinet_id: string }[]) {
      nbDossiers.set(d.cabinet_id, (nbDossiers.get(d.cabinet_id) ?? 0) + 1)
    }
    const nbAdmins = new Map<string, number>()
    for (const a of (adminsData ?? []) as { cabinet_id: string }[]) {
      nbAdmins.set(a.cabinet_id, (nbAdmins.get(a.cabinet_id) ?? 0) + 1)
    }
    // Un client est rattaché à un dossier, pas directement à un cabinet — on passe par la carte
    // dossier → cabinet construite ci-dessus pour les compter au bon endroit.
    const nbClients = new Map<string, number>()
    for (const m of (membershipsData ?? []) as { dossier_id: string }[]) {
      const cabinetId = cabinetParDossier.get(m.dossier_id)
      if (cabinetId) nbClients.set(cabinetId, (nbClients.get(cabinetId) ?? 0) + 1)
    }

    setCabinets(((cabinetsData ?? []) as { id: string; nom: string; couleur_primaire: string | null; logo_storage_path: string | null; created_at: string }[]).map((c) => ({
      ...c,
      nb_dossiers: nbDossiers.get(c.id) ?? 0,
      nb_admins: nbAdmins.get(c.id) ?? 0,
      nb_clients: nbClients.get(c.id) ?? 0,
    })))
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  return (
    <>
      <div className="topbar">
        <h1>Comptes master</h1>
      </div>
      <p className="muted" style={{ marginTop: -12, marginBottom: 20 }}>
        Vue d'ensemble de tous les cabinets de la plateforme (le tien inclus) — en lecture seule.
        Créer un nouveau cabinet ou changer sa charte graphique reste un accès direct en base, jamais
        un formulaire ici.
      </p>

      <div className="card table-scroll" style={{ padding: 0 }}>
        {loading ? (
          <p className="muted" style={{ padding: 20 }}>Chargement…</p>
        ) : cabinets.length === 0 ? (
          <div className="empty-state">Aucun cabinet.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th></th>
                <th>Cabinet</th>
                <th>Dossiers</th>
                <th>Admins</th>
                <th>Clients</th>
                <th>Créé le</th>
              </tr>
            </thead>
            <tbody>
              {cabinets.map((c) => (
                <tr key={c.id}>
                  <td>
                    <span
                      title={c.couleur_primaire ?? 'Aucune couleur configurée'}
                      style={{
                        display: 'inline-block', width: 14, height: 14, borderRadius: '50%',
                        background: c.couleur_primaire ?? 'var(--color-border)',
                        border: '1px solid var(--color-border)',
                      }}
                    />
                  </td>
                  <td style={{ fontWeight: 600 }}>{c.nom}</td>
                  <td>{c.nb_dossiers}</td>
                  <td>{c.nb_admins}</td>
                  <td>{c.nb_clients}</td>
                  <td>{new Date(c.created_at).toLocaleDateString('fr-FR')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}
