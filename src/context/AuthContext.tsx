import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { messageErreur } from '../lib/messageErreur'
import { AUCUN_RETOUR, AVIS_LIEN_SANS_SESSION, avisDuRefus, type RetourDuLien } from '../lib/recuperationMotDePasse'

type Role = 'cabinet' | 'client' | null

// Clé localStorage du dossier actif choisi par un client ayant plusieurs sociétés — survit à un
// rafraîchissement de page, mais reste propre à ce navigateur (pas un champ en base : ce n'est qu'une
// préférence d'affichage, sans conséquence sur les droits d'accès déjà gérés par dossierIds/RLS).
const CLE_DOSSIER_ACTIF = 'jd-precompta-dossier-actif'

// Le compte dont la session vient d'un lien « Mot de passe oublié » et qui n'a pas encore choisi son nouveau mot de
// passe. Gardé dans le navigateur parce que la session, elle, y survit : Safari sur iPhone recharge un onglet laissé
// en arrière-plan, et sans ce drapeau l'application s'ouvrirait alors sans plus le demander. Partagé entre les onglets,
// comme la session.
const CLE_RECUPERATION = 'jd-precompta-recuperation'

function lireRecuperation(): string | null {
  try {
    return localStorage.getItem(CLE_RECUPERATION)
  } catch {
    return null
  }
}

function ecrireRecuperation(id: string | null) {
  try {
    if (id === null) localStorage.removeItem(CLE_RECUPERATION)
    else localStorage.setItem(CLE_RECUPERATION, id)
  } catch {
    // Stockage refusé (navigation privée) : la récupération reste connue de cet onglet, en mémoire.
  }
}

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
  // La session ouverte par un lien « Mot de passe oublié » : l'écran du nouveau mot de passe passe avant tout autre
  // (App.tsx), jusqu'à ce qu'il soit choisi. Vrai seulement pour CE compte.
  recuperation: boolean
  terminerRecuperation: () => void
  // Ce que le lien de l'adresse n'a pas pu faire (expiré, déjà servi, refusé, ou sans session), dit jusqu'à la
  // prochaine connexion ou jusqu'à ce que l'écran le congédie.
  avisDuLien: string | null
  oublierAvisDuLien: () => void
}

const AuthContext = createContext<AuthState | null>(null)

// `retourDuLien` : ce que l'adresse portait AU CHARGEMENT de la page (main.tsx la lit avant le premier rendu, voir
// lib/recuperationMotDePasse.ts). Sans lui, aucun lien n'est attendu.
export function AuthProvider({ children, retourDuLien = AUCUN_RETOUR }: { children: ReactNode; retourDuLien?: RetourDuLien }) {
  const [session, setSession] = useState<Session | null>(null)
  const [role, setRole] = useState<Role>(null)
  const [dossierIds, setDossierIds] = useState<string[]>([])
  const [mesSocietes, setMesSocietes] = useState<SocieteClient[]>([])
  const [dossierActifId, setDossierActifIdState] = useState<string | null>(null)
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [estChef, setEstChef] = useState(false)
  const [monCabinetId, setMonCabinetId] = useState<string | null>(null)
  // Tant que Supabase n'a pas répondu, `session` vaut null sans vouloir dire « déconnecté ».
  const [sessionConnue, setSessionConnue] = useState(false)
  // L'identifiant pour lequel les rôles ci-dessus ont été lus : `undefined` avant toute lecture, `null`
  // pour « personne ». Les rôles voyagent avec lui, comme l'identité d'un dossier avec son identifiant
  // (voir DossierDetail).
  const [rolesDe, setRolesDe] = useState<string | null | undefined>(undefined)
  // Le compte à qui l'écran du nouveau mot de passe est dû (voir CLE_RECUPERATION).
  const [recuperationDe, setRecuperationDe] = useState<string | null>(lireRecuperation)
  // Un lien refusé se sait dès l'adresse ; un lien sans session, à la première session connue (plus bas).
  const [avisDuLien, setAvisDuLien] = useState<string | null>(() => (retourDuLien.nature === 'refus' ? avisDuRefus(retourDuLien.code) : null))
  // Le jeton du lien, jugé UNE fois, sur la première session connue : c'est elle que le client a ouverte avec l'adresse.
  // Un ref, parce que les rappels de Supabase sont posés une seule fois.
  const jetonDuLien = useRef(retourDuLien.nature === 'recuperation' ? retourDuLien.jeton : null)

  function poserRecuperation(id: string | null) {
    setRecuperationDe(id)
    ecrireRecuperation(id)
  }

  useEffect(() => {
    function constater(s: Session | null) {
      setSession(s)
      setSessionConnue(true)
      const jeton = jetonDuLien.current
      jetonDuLien.current = null
      if (s === null) {
        // Personne n'est connecté : rien n'est dû, et un drapeau resté d'une session finie ne doit pas ressurgir à
        // la connexion suivante par mot de passe.
        poserRecuperation(null)
        // L'adresse portait un jeton et aucune session n'en est sortie : le client n'a pas pu le vérifier.
        if (jeton !== null) setAvisDuLien(AVIS_LIEN_SANS_SESSION)
      } else if (jeton !== null && s.access_token === jeton) {
        // La session ouverte par le lien : reconnue à son jeton, sans attendre `PASSWORD_RECOVERY`, que le client
        // émet après coup (un `setTimeout`) et à ceux seulement qui l'écoutent déjà.
        poserRecuperation(s.user.id)
      }
    }
    supabase.auth.getSession()
      .then(({ data }) => constater(data.session))
      // Une lecture qui lève ne doit pas laisser « Chargement… » à l'écran pour toujours : faute de
      // session, c'est l'écran de connexion qui s'affiche — comme avant que le chargement se déduise.
      .catch((e: unknown) => console.error('[session] lecture impossible :', messageErreur(e, 'raison inconnue')))
      .finally(() => setSessionConnue(true))
    const { data: sub } = supabase.auth.onAuthStateChange((evenement, s) => {
      constater(s)
      // Émis aussi aux autres onglets (BroadcastChannel d'auth-js) : ils partagent la session, et l'écran avec elle.
      if (evenement === 'PASSWORD_RECOVERY' && s) poserRecuperation(s.user.id)
      // Le mot de passe changé, ici ou dans un autre onglet : plus rien n'est dû, ni à dire du lien.
      if (evenement === 'USER_UPDATED') {
        poserRecuperation(null)
        setAvisDuLien(null)
      }
      // Une connexion (ou un retour sur l'onglet) clôt ce qu'il y avait à dire d'un lien.
      if (evenement === 'SIGNED_IN') setAvisDuLien(null)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  // Les rôles se relisent quand l'IDENTITÉ change, jamais sur l'objet session. Supabase en renvoie une
  // copie neuve à chaque retour sur l'onglet (un « SIGNED_IN » émis par sa reprise de session, vérifié
  // dans auth-js, `_recoverAndRefresh`) et à chaque jeton renouvelé (« TOKEN_REFRESHED »). Relus sur
  // l'objet, les rôles repassaient `loading` à vrai : l'application entière retombait sur
  // « Chargement… » et remontait tous ses écrans, qui perdaient ce qu'ils affichaient ou ce qu'on y
  // saisissait — l'aperçu d'une récupération bancaire disparaissait ainsi après un passage par une
  // autre fenêtre, et chaque écran relisait toute sa base, deux fois.
  const userId = session?.user.id ?? null

  // Le chargement se DÉDUIT, il ne se pose pas. Posé par l'effet qui lit les rôles, il retombait
  // à faux dès le premier rendu — aucune session n'étant encore connue, il n'y avait rien à lire —, puis
  // ne repassait à vrai qu'APRÈS le rendu qui recevait la session. Entre les deux, l'application
  // affichait l'écran de connexion au démarrage, puis montait ses écrans sans rôle, qu'elle démontait
  // aussitôt ; et quand un autre compte se connectait, un rendu passait avec sa session et les rôles du
  // compte précédent. Déduit, il est vrai DANS le rendu où la session arrive ou change de compte.
  // Personne n'étant connecté, il n'y a rien à attendre : l'écran de connexion vient tout de suite.
  const loading = !sessionConnue || (userId !== null && rolesDe !== userId)

  // Déduite comme le chargement : le drapeau ne vaut que pour le compte connecté (une session n'est posée qu'une fois
  // connue). Elle n'attend pas les rôles — l'écran du nouveau mot de passe n'en a pas besoin, et rien d'autre ne doit
  // s'afficher avant lui.
  const recuperation = userId !== null && recuperationDe === userId

  function terminerRecuperation() {
    poserRecuperation(null)
    setAvisDuLien(null)
  }

  useEffect(() => {
    let cancelled = false

    async function resolveRole() {
      if (!userId) {
        setRole(null)
        setDossierIds([])
        setMesSocietes([])
        setDossierActifIdState(null)
        setIsSuperAdmin(false)
        setEstChef(false)
        setMonCabinetId(null)
        setRolesDe(null)
        return
      }

      const { data: adminRow } = await supabase
        .from('cabinet_admins')
        .select('cabinet_id, role')
        .eq('user_id', userId)
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
        setRolesDe(userId)
        return
      }

      const { data: memberships } = await supabase
        .from('memberships')
        .select('dossier_id')
        .eq('user_id', userId)

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
      setRolesDe(userId)
    }

    resolveRole()
    return () => {
      cancelled = true
    }
  }, [userId])

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
      value={{
        session, role, dossierIds, mesSocietes, dossierActifId, setDossierActifId, isSuperAdmin, estChef, monCabinetId, loading, signOut,
        recuperation, terminerRecuperation, avisDuLien, oublierAvisDuLien: () => setAvisDuLien(null),
      }}
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
