import { useEffect, useState, type CSSProperties, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { estimerCoutUsd, formatUsd } from '../lib/coutsApi'
import { genererExportCabinet } from '../lib/exportCabinet'
import ConfirmationSuppression from '../components/ConfirmationSuppression'

interface CabinetApercu {
  id: string
  nom: string
  couleur_primaire: string | null
  logo_storage_path: string | null
  nb_dossiers: number
  nb_admins: number
  nb_clients: number
  created_at: string
  // Consommation de l'agent comptable (Claude/Bedrock, voir lib/coutsApi.ts) cumulée sur tous les
  // dossiers du cabinet — 0 tant qu'aucune conversation n'a été enregistrée depuis l'ajout de ce
  // suivi (voir migration agent_conversations_tokens), jamais une facture AWS exacte.
  tokens_entree: number
  tokens_sortie: number
}

// Réservée au(x) super-admin(s) (voir AuthContext.isSuperAdmin, résolu via le RPC is_super_admin()) —
// vue d'ensemble de tous les comptes master (cabinets) de la plateforme, plus la création d'un
// nouveau cabinet (voir create-cabinet, la seule écriture possible depuis cet écran — changer la
// charte graphique d'un cabinet existant reste un accès direct en base). Un cabinet créé ici reçoit
// aussitôt son premier comptable en chef : un cabinet sans personne pour s'y connecter ne sert à rien.
export default function SuperAdminPage() {
  const [cabinets, setCabinets] = useState<CabinetApercu[]>([])
  const [loading, setLoading] = useState(true)

  const [ajout, setAjout] = useState(false)
  const [nom, setNom] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [enregistrement, setEnregistrement] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)

  const [aSupprimer, setASupprimer] = useState<CabinetApercu | null>(null)
  const [suppressionEnCours, setSuppressionEnCours] = useState(false)
  const [suppressionErreur, setSuppressionErreur] = useState<string | null>(null)

  // Export en cours pour au plus un cabinet à la fois (un export lit potentiellement des dizaines de
  // fichiers, inutile d'en permettre plusieurs en parallèle depuis le même écran) — l'id du cabinet
  // sert de clé pour savoir quelle ligne afficher "en cours", et le texte de progression accompagne.
  const [exportEnCours, setExportEnCours] = useState<string | null>(null)
  const [exportProgression, setExportProgression] = useState<{ fait: number; total: number } | null>(null)
  const [exportErreur, setExportErreur] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    const [{ data: cabinetsData }, { data: dossiersData }, { data: adminsData }, { data: membershipsData }, { data: usageData }] = await Promise.all([
      supabase.from('cabinets').select('id, nom, couleur_primaire, logo_storage_path, created_at').order('created_at'),
      supabase.from('dossiers').select('id, cabinet_id'),
      supabase.from('cabinet_admins').select('cabinet_id'),
      supabase.from('memberships').select('dossier_id'),
      // Uniquement les messages assistant (voir AssistantTab.enregistrer) : seuls eux déclenchent un
      // appel Bedrock facturé, un message user n'a jamais de tokens_entree/tokens_sortie renseignés.
      supabase.from('agent_conversations').select('dossier_id, tokens_entree, tokens_sortie').eq('role', 'assistant'),
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
    // Même logique que nbClients : un message d'agent est rattaché à un dossier, agrégé ici au
    // niveau du cabinet auquel ce dossier appartient.
    const tokensEntree = new Map<string, number>()
    const tokensSortie = new Map<string, number>()
    for (const u of (usageData ?? []) as { dossier_id: string; tokens_entree: number | null; tokens_sortie: number | null }[]) {
      const cabinetId = cabinetParDossier.get(u.dossier_id)
      if (!cabinetId) continue
      tokensEntree.set(cabinetId, (tokensEntree.get(cabinetId) ?? 0) + (u.tokens_entree ?? 0))
      tokensSortie.set(cabinetId, (tokensSortie.get(cabinetId) ?? 0) + (u.tokens_sortie ?? 0))
    }

    setCabinets(((cabinetsData ?? []) as { id: string; nom: string; couleur_primaire: string | null; logo_storage_path: string | null; created_at: string }[]).map((c) => ({
      ...c,
      nb_dossiers: nbDossiers.get(c.id) ?? 0,
      nb_admins: nbAdmins.get(c.id) ?? 0,
      nb_clients: nbClients.get(c.id) ?? 0,
      tokens_entree: tokensEntree.get(c.id) ?? 0,
      tokens_sortie: tokensSortie.get(c.id) ?? 0,
    })))
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function creerCabinet(e: FormEvent) {
    e.preventDefault()
    if (password.length < 10) {
      setErreur('Le mot de passe doit faire au moins 10 caractères.')
      return
    }
    setEnregistrement(true)
    setErreur(null)
    const { data, error: invokeError } = await supabase.functions.invoke<{ ok?: boolean; error?: string }>('create-cabinet', {
      body: { nom: nom.trim(), email: email.trim(), password },
    })
    setEnregistrement(false)
    if (data?.error || invokeError) {
      setErreur(data?.error ?? "Échec de la création du cabinet.")
      return
    }
    setNom('')
    setEmail('')
    setPassword('')
    setAjout(false)
    load()
  }

  // Réservée aux cabinets déjà vides (voir delete-cabinet) — la contrainte de clé étrangère fait déjà
  // tout le travail de garde-fou, cette fonction ne fait que relayer son message d'erreur.
  async function supprimerCabinet() {
    if (!aSupprimer) return
    setSuppressionEnCours(true)
    setSuppressionErreur(null)
    const { data, error: invokeError } = await supabase.functions.invoke<{ ok?: boolean; error?: string }>('delete-cabinet', {
      body: { cabinetId: aSupprimer.id },
    })
    setSuppressionEnCours(false)
    if (data?.error || invokeError) {
      setSuppressionErreur(data?.error ?? 'Échec de la suppression.')
      return
    }
    setASupprimer(null)
    load()
  }

  // Un ZIP par cabinet, un sous-dossier par dossier client, sur toute leur histoire (voir
  // lib/exportCabinet.ts) — utile notamment avant de vider un cabinet en vue de sa suppression, mais
  // pas réservé à ce cas : n'importe quel export ponctuel de tout un cabinet.
  async function exporterCabinet(c: CabinetApercu) {
    setExportEnCours(c.id)
    setExportErreur(null)
    setExportProgression({ fait: 0, total: c.nb_dossiers })
    try {
      await genererExportCabinet(c.id, c.nom, (fait, total) => setExportProgression({ fait, total }))
    } catch (err) {
      setExportErreur(`Export de "${c.nom}" : ${err instanceof Error ? err.message : 'échec.'}`)
    } finally {
      setExportEnCours(null)
      setExportProgression(null)
    }
  }

  return (
    <>
      <div className="topbar">
        <h1>Comptes master</h1>
        <button className="btn btn-primary btn-sm" onClick={() => setAjout(true)}>+ Nouveau cabinet</button>
      </div>
      <p className="muted" style={{ marginTop: -12, marginBottom: 20 }}>
        Vue d'ensemble de tous les cabinets de la plateforme (le tien inclus). Changer la charte
        graphique d'un cabinet existant reste un accès direct en base, jamais un formulaire ici — seule
        la création d'un nouveau cabinet (avec son premier comptable en chef) passe par ce bouton. Le
        coût estimé ne couvre que l'agent comptable (Claude via Amazon Bedrock, voir AssistantTab) —
        pas les autres API payantes de l'appli (Textract pour l'OCR des pièces, notamment) — et reste
        un ordre de grandeur, jamais la facture AWS exacte.
      </p>

      {exportErreur && <p className="error-text">{exportErreur}</p>}

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
                <th>Tokens agent (E/S)</th>
                <th>Coût estimé agent</th>
                <th>Créé le</th>
                <th></th>
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
                  <td>
                    {c.tokens_entree === 0 && c.tokens_sortie === 0
                      ? <span className="muted">—</span>
                      : `${c.tokens_entree.toLocaleString('fr-FR')} / ${c.tokens_sortie.toLocaleString('fr-FR')}`}
                  </td>
                  <td>{formatUsd(estimerCoutUsd(c.tokens_entree, c.tokens_sortie))}</td>
                  <td>{new Date(c.created_at).toLocaleDateString('fr-FR')}</td>
                  <td className="td-actions" style={{ display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      disabled={c.nb_dossiers === 0 || exportEnCours !== null}
                      title={c.nb_dossiers === 0 ? 'Aucun dossier à exporter.' : undefined}
                      onClick={() => exporterCabinet(c)}
                    >
                      {exportEnCours === c.id
                        ? (exportProgression ? `Export… (${exportProgression.fait}/${exportProgression.total})` : 'Export…')
                        : 'Exporter'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      disabled={c.nb_dossiers > 0 || c.nb_admins > 0}
                      title={c.nb_dossiers > 0 || c.nb_admins > 0
                        ? `Retire d'abord ses ${c.nb_dossiers} dossier(s) et ${c.nb_admins} membre(s) d'équipe.`
                        : undefined}
                      onClick={() => setASupprimer(c)}
                    >
                      Supprimer
                    </button>
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
            <h2 style={{ marginTop: 0 }}>Nouveau cabinet</h2>
            <p className="muted" style={{ marginTop: -8 }}>
              Crée le cabinet et son premier comptable en chef — il pourra ensuite inviter le reste de
              son équipe lui-même depuis son propre écran Équipe.
            </p>
            <form onSubmit={creerCabinet}>
              <div className="field">
                <label htmlFor="cab-nom">Nom du cabinet</label>
                <input id="cab-nom" required value={nom} onChange={(e) => setNom(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="cab-email">Email du comptable en chef</label>
                <input id="cab-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="cab-password">Mot de passe (au moins 10 caractères)</label>
                <input id="cab-password" type="text" required minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              {erreur && <p className="error-text">{erreur}</p>}
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
                <button type="button" className="btn btn-outline" onClick={() => setAjout(false)} disabled={enregistrement}>Annuler</button>
                <button type="submit" className="btn btn-primary" disabled={enregistrement}>
                  {enregistrement ? 'Création…' : 'Créer le cabinet'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {aSupprimer && (
        <ConfirmationSuppression
          titre="Supprimer ce cabinet"
          description={`Cette action supprime définitivement le cabinet "${aSupprimer.nom}". Impossible tant qu'il a encore des dossiers ou des membres d'équipe (retire-les d'abord).`}
          nomAttendu={aSupprimer.nom}
          boutonLabel="Supprimer définitivement"
          enCours={suppressionEnCours}
          erreur={suppressionErreur}
          onConfirmer={supprimerCabinet}
          onAnnuler={() => { setASupprimer(null); setSuppressionErreur(null) }}
        />
      )}
    </>
  )
}

const overlayStyle: CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20,
}
