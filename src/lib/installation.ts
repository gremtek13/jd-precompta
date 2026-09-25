// Installer l'application depuis le navigateur (PWA) : ce que la barre latérale propose, selon le
// navigateur, et rien du tout dans l'application une fois installée (voir BoutonInstallation).
//
// Les navigateurs ne se ressemblent pas, d'où trois réponses :
// - Edge et Chrome (et les autres navigateurs Chromium) annoncent qu'ils savent installer la page par
//   l'événement `beforeinstallprompt`. On le garde, et le bouton ouvre LEUR fenêtre d'installation.
//   Mais ils ne l'émettent qu'après un peu d'usage de la page (un clic, une trentaine de secondes), et
//   jamais quand l'application est déjà installée : en attendant, le bouton donne une consigne —
//   l'icône d'installation de la barre d'adresse, présente dès que la page est installable.
// - Safari sur Mac installe par son menu (Fichier, puis « Ajouter au Dock », macOS 14 et plus) et
//   n'offre aucun moyen de le déclencher depuis la page : le bouton le dit.
// - Firefox ne sait pas installer une application web : le bouton le dit aussi, plutôt que de
//   manquer sans raison visible.
//
// Aucun appel réseau : tout se passe dans le navigateur, et l'installation reste un geste de
// l'utilisateur, jamais une fenêtre ouverte d'office.

/** L'événement `beforeinstallprompt`, que TypeScript ne décrit pas (il n'est pas normalisé). */
export interface InviteInstallation extends Event {
  prompt(): Promise<void>
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export interface EtatInstallation {
  /** Le navigateur a annoncé qu'il peut ouvrir sa fenêtre d'installation. */
  inviteDisponible: boolean
  /** L'application vient d'être installée depuis cet onglet (`appinstalled`). */
  installee: boolean
}

// Au niveau du module et non d'un état React : l'événement arrive une fois par chargement de page,
// souvent avant que la barre latérale soit montée — c'est `main.tsx` qui écoute, dès le démarrage.
let invite: InviteInstallation | null = null
let etat: EtatInstallation = { inviteDisponible: false, installee: false }
const abonnes = new Set<() => void>()

function publier(installee: boolean) {
  etat = { inviteDisponible: invite !== null, installee }
  for (const abonne of abonnes) abonne()
}

/** Écoute les deux événements d'installation ; rend de quoi arrêter d'écouter. */
export function ecouterInstallation(cible: Window = window): () => void {
  function surInvite(evenement: Event) {
    // Garder la main : c'est le bouton qui ouvrira la fenêtre, à la demande de l'utilisateur.
    evenement.preventDefault()
    invite = evenement as InviteInstallation
    publier(etat.installee)
  }
  function surInstallation() {
    invite = null
    publier(true)
  }
  cible.addEventListener('beforeinstallprompt', surInvite)
  cible.addEventListener('appinstalled', surInstallation)
  return () => {
    cible.removeEventListener('beforeinstallprompt', surInvite)
    cible.removeEventListener('appinstalled', surInstallation)
  }
}

export function sAbonnerInstallation(abonne: () => void): () => void {
  abonnes.add(abonne)
  return () => { abonnes.delete(abonne) }
}

/** Instantané stable tant que rien ne change (pour `useSyncExternalStore`). */
export function lireEtatInstallation(): EtatInstallation {
  return etat
}

/**
 * Retire l'invite AVANT qu'on l'ouvre. Un événement ne s'ouvre qu'une fois (un second `prompt()`
 * lève), et deux clics rapprochés arrivent dans le même rendu : c'est ce retrait synchrone qui fait
 * que le second ne trouve plus rien, comme un verrou.
 */
export function prendreInvite(): InviteInstallation | null {
  const prise = invite
  if (prise) {
    invite = null
    publier(etat.installee)
  }
  return prise
}

/** Pour les tests : repartir d'un navigateur qui n'a encore rien annoncé. */
export function oublierInstallation() {
  invite = null
  publier(false)
}

/** Lancée depuis l'application installée (sa propre fenêtre), et non dans un onglet du navigateur. */
export function estEnApplication(fenetre: Window = window): boolean {
  if ((fenetre.navigator as Navigator & { standalone?: boolean }).standalone === true) return true
  if (typeof fenetre.matchMedia !== 'function') return false
  return ['standalone', 'window-controls-overlay', 'minimal-ui', 'fullscreen']
    .some((mode) => fenetre.matchMedia(`(display-mode: ${mode})`).matches)
}

export type Navigateur = 'chromium' | 'safari-mac' | 'firefox' | 'autre'

/**
 * Le navigateur, lu sur sa signature. L'ordre compte : Edge et Chrome écrivent aussi « Safari », et
 * un iPad se présente comme un Mac — c'est l'écran tactile qui le trahit.
 */
export function navigateurDe(userAgent: string, pointsTactiles: number): Navigateur {
  if (/Android|Mobile|iPhone|iPad/.test(userAgent)) return 'autre'
  if (/\bFirefox\/\d/.test(userAgent)) return 'firefox'
  if (/\b(Chrome|Chromium|Edg)\/\d/.test(userAgent)) return 'chromium'
  if (/Macintosh/.test(userAgent) && /\bVersion\/\d+.*\bSafari\//.test(userAgent) && pointsTactiles <= 1) return 'safari-mac'
  return 'autre'
}

export type PropositionInstallation =
  | { type: 'rien' }
  | { type: 'invite' }
  | { type: 'consigne'; texte: string }

export function propositionInstallation(p: {
  enApplication: boolean
  etat: EtatInstallation
  userAgent: string
  pointsTactiles: number
  /** Le nom sous lequel l'application s'installe : celui du cabinet quand il a son logo. */
  nomApplication: string
  /** L'adresse à ouvrir dans un autre navigateur (`location.origin`). */
  adresse: string
}): PropositionInstallation {
  if (p.enApplication || p.etat.installee) return { type: 'rien' }
  if (p.etat.inviteDisponible) return { type: 'invite' }
  switch (navigateurDe(p.userAgent, p.pointsTactiles)) {
    case 'chromium':
      return {
        type: 'consigne',
        texte: "Cliquez sur l'icône d'installation, à droite de la barre d'adresse. Si elle n'y est pas, "
          + `l'application est sans doute déjà installée : cherchez « ${p.nomApplication} » dans le menu `
          + 'Démarrer ou dans le dossier Applications.',
      }
    case 'safari-mac': {
      const version = Number(p.userAgent.match(/\bVersion\/(\d+)/)?.[1] ?? 0)
      return version >= 17
        ? { type: 'consigne', texte: 'Dans Safari : menu Fichier, puis « Ajouter au Dock ».' }
        : {
          type: 'consigne',
          texte: 'Cette version de Safari ne sait pas installer une application : il faut macOS 14 '
            + '(Sonoma) ou plus récent. Edge et Chrome savent aussi le faire.',
        }
    }
    case 'firefox':
      return {
        type: 'consigne',
        texte: `Firefox ne sait pas installer une application. Ouvrez ${p.adresse} dans Edge, Chrome `
          + 'ou Safari, puis revenez à ce bouton.',
      }
    case 'autre':
      return { type: 'rien' }
  }
}
