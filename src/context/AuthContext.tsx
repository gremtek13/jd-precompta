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
    // CE QUE LA SOURCE DE LA BIBLIOTHÈQUE DIT, ET QUI CORRIGE L'INTUITION (vérifié dans
    // `@supabase/auth-js`, GoTrueClient._signOut) : sur une erreur SERVEUR — réseau, 5xx —
    // `removeCurrentSession()` est appelé AVANT que l'erreur soit rendue, donc la session locale
    // part quand même et l'écran revient bien à la connexion. Un seul chemin laisse l'utilisateur
    // connecté sans le dire : une erreur sur la LECTURE de la session locale, qui sort avant tout
    // retrait. Étroit, mais silencieux — et sur un poste de cabinet partagé, c'est une session
    // laissée ouverte derrière un bouton qui n'a rien fait de visible.
    // ET IL Y A PIRE QUE LE LOCAL : la portée par défaut est `global`, donc « Déconnexion » promet
    // de fermer TOUTES les sessions du compte. Sur une erreur réseau, la révocation côté serveur
    // n'a PAS eu lieu — le jeton reste valide jusqu'à son expiration, et rien ne le dit.
    // Best-effort JOURNALISÉ plutôt que remonté : l'écran est déjà reparti à la connexion dans le
    // cas courant, donc un message n'aurait personne à qui parler — mais l'avaler sans trace
    // rendrait ce chemin indiagnosticable. C'est le précédent `tauxChange.tauxBce`.
    const { error } = await supabase.auth.signOut()
    if (error) console.error('[signOut] déconnexion incomplète :', error.message)
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
