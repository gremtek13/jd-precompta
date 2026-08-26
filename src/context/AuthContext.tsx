import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

type Role = 'cabinet' | 'client' | null

interface AuthState {
  session: Session | null
  role: Role
  dossierIds: string[] // dossiers accessibles (pertinent seulement pour role === 'client')
  loading: boolean
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [role, setRole] = useState<Role>(null)
  const [dossierIds, setDossierIds] = useState<string[]>([])
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
        setLoading(false)
        return
      }
      setLoading(true)

      const { data: adminRow } = await supabase
        .from('cabinet_admins')
        .select('user_id')
        .eq('user_id', session.user.id)
        .maybeSingle()

      if (cancelled) return

      if (adminRow) {
        setRole('cabinet')
        setDossierIds([])
        setLoading(false)
        return
      }

      const { data: memberships } = await supabase
        .from('memberships')
        .select('dossier_id')
        .eq('user_id', session.user.id)

      if (cancelled) return
      setRole('client')
      setDossierIds((memberships ?? []).map((m) => m.dossier_id))
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
    <AuthContext.Provider value={{ session, role, dossierIds, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth doit être utilisé dans AuthProvider')
  return ctx
}
