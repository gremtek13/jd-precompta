import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

type Role = 'cabinet' | 'client' | null

interface AuthState {
  session: Session | null
  role: Role
  dossierIds: string[] // dossiers accessibles (pertinent seulement pour role === 'client')
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

      // Cabinet du client, via le dossier de sa première adhésion — seulement pour la charte
      // graphique (voir lib/branding.ts) ; sans conséquence sur ses droits d'accès, déjà gérés par
      // dossierIds/RLS. Best-effort : un échec ici ne doit pas empêcher la connexion.
      let cabinetId: string | null = null
      if (memberships && memberships.length > 0) {
        const { data: dossier } = await supabase
          .from('dossiers')
          .select('cabinet_id')
          .eq('id', memberships[0].dossier_id)
          .maybeSingle()
        cabinetId = dossier?.cabinet_id ?? null
      }
      if (cancelled) return

      setRole('client')
      setDossierIds((memberships ?? []).map((m) => m.dossier_id))
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

  return (
    <AuthContext.Provider value={{ session, role, dossierIds, isSuperAdmin, estChef, monCabinetId, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth doit être utilisé dans AuthProvider')
  return ctx
}
