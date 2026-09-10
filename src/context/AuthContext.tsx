import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

type Role = 'cabinet' | 'client' | null

// Clé localStorage du dossier actif choisi par un client ayant plusieurs sociétés — survit à un
// rafraîchissement de page, mais reste propre à ce navigateur (pas un champ en base : ce n'est qu'une
// préférence d'affichage, sans conséquence sur les droits d'accès déjà gérés par dossierIds/RLS).
const CLE_DOSSIER_ACTIF = 'jd-precompta-dossier-actif'

export interface SocieteClient { id: string; nom: string }

interface AuthState {
  session: Session | null
  role: Role
  dossierIds: string[] // dossiers accessibles (pertinent seulement pour role === 'client')
  // Sociétés accessibles avec leur nom, pour le sélecteur de société (voir Layout.tsx,
  // SelecteurSociete) — un simple client à un seul dossier n'en a jamais l'usage.
  mesSocietes: SocieteClient[]
  // Société actuellement affichée pour un client qui en a plusieurs — toutes les pages client
  // (ClientHome, ClientUpload...) lisent cette valeur plutôt que dossierIds[0], qui ignorait
  // silencieusement toute société au-delà de la première.
  dossierActifId: string | null
  setDossierActifId: (id: string) => void
  // Vrai si l'utilisateur supervise tous les cabinets (voir la page Comptes master) plutôt qu'un seul —
  // résolu via l'appel RPC is_super_admin() : la table super_admins elle-même est verrouillée (RLS sans
  // aucune policy), impossible à lire directement depuis le navigateur, même pour soi-même.
  isSuperAdmin: boolean
  // Chef de cabinet (rôle comptable_en_chef, voir cabinet_admins.role) — donne accès à la page
  // Équipe. Un super-admin est toujours considéré chef (il gère son propre cabinet en plus de
  // superviser les autres). Sans intérêt pour role !== 'cabinet'.
  estChef: boolean
  // Cabinet de l'utilisateur connecté — sert à la page Équipe (rôle cabinet) et à la charte graphique
  // (voir lib/branding.ts, les deux rôles), qui a besoin de savoir quel cabinet habiller sans le
  // redemander. Pour un client, résolu via le cabinet_id du dossier de sa première adhésion (un client
  // n'appartient jamais qu'à un seul cabinet dans ce modèle) ; null tant qu'aucune adhésion n'existe.
  monCabinetId: string | null
  loading: boolean
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [role, setRole] = useState<Role>(null)
  const [dossierIds, setDossierIds] = useState<string[]>([])
  const [mesSocietes, setMesSocietes] = useState<SocieteClient[]>([])
  const [dossierActifId, setDossierActifIdState] = useState<string | null>(null)
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [estChef, setEstChef] = useState(false)
  const [monCabinetId, setMonCabinetId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    let cancelled = false

    async function resolveRole() {
      if (!session) {
        setRole(null)
        setDossierIds([])
        setMesSocietes([])
        setDossierActifIdState(null)
        setIsSuperAdmin(false)
        setEstChef(false)
        setMonCabinetId(null)
        setLoading(false)
        return
      }
      setLoading(true)

      const { data: adminRow } = await supabase
        .from('cabinet_admins')
        .select('cabinet_id, role')
        .eq('user_id', session.user.id)
        .maybeSingle()

      if (cancelled) return

      if (adminRow) {
        const { data: estSuperAdmin } = await supabase.rpc('is_super_admin')
        if (cancelled) return
        setRole('cabinet')
        setDossierIds([])
        setMesSocietes([])
        setDossierActifIdState(null)
        setIsSuperAdmin(!!estSuperAdmin)
        setEstChef(!!estSuperAdmin || adminRow.role === 'comptable_en_chef')
        setMonCabinetId(adminRow.cabinet_id)
        setLoading(false)
        return
      }

      const { data: memberships } = await supabase
        .from('memberships')
        .select('dossier_id')
        .eq('user_id', session.user.id)

      if (cancelled) return

      const ids = (memberships ?? []).map((m) => m.dossier_id)

      // Nom + cabinet de chaque société accessible, en un seul aller-retour — sert au sélecteur de
      // société (voir mesSocietes ci-dessus) et, pour le cabinet_id, uniquement à la charte graphique
      // (lib/branding.ts) : sans conséquence sur les droits d'accès, déjà gérés par dossierIds/RLS. Un
      // client n'appartient jamais qu'à un seul cabinet dans ce modèle, donc n'importe laquelle de ses
      // sociétés donne le bon cabinet_id. Best-effort : un échec ici ne doit pas empêcher la connexion.
      let cabinetId: string | null = null
      let societes: SocieteClient[] = []
      if (ids.length > 0) {
        const { data: dossiersData } = await supabase.from('dossiers').select('id, nom, cabinet_id').in('id', ids)
        if (dossiersData && dossiersData.length > 0) {
          cabinetId = dossiersData[0].cabinet_id
          societes = dossiersData.map((d) => ({ id: d.id, nom: d.nom }))
        }
      }
      if (cancelled) return

      // Restaure la société choisie au dernier passage (voir CLE_DOSSIER_ACTIF) si elle est toujours
      // accessible, sinon retombe sur la première — jamais une société qu'un accès révoqué depuis
      // aurait retirée entre-temps.
      const dossierSauvegarde = localStorage.getItem(CLE_DOSSIER_ACTIF)
      const dossierActif = dossierSauvegarde && ids.includes(dossierSauvegarde) ? dossierSauvegarde : (ids[0] ?? null)

      setRole('client')
      setDossierIds(ids)
      setMesSocietes(societes)
      setDossierActifIdState(dossierActif)
      setIsSuperAdmin(false)
      setEstChef(false)
      setMonCabinetId(cabinetId)
      setLoading(false)
    }

    resolveRole()
    return () => {
      cancelled = true
    }
  }, [session])

  async function signOut() {
    await supabase.auth.signOut()
  }

  function setDossierActifId(id: string) {
    setDossierActifIdState(id)
    localStorage.setItem(CLE_DOSSIER_ACTIF, id)
  }

  return (
    <AuthContext.Provider
      value={{ session, role, dossierIds, mesSocietes, dossierActifId, setDossierActifId, isSuperAdmin, estChef, monCabinetId, loading, signOut }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth doit être utilisé dans AuthProvider')
  return ctx
}
