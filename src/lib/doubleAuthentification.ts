// LA DOUBLE AUTHENTIFICATION, PREMIER TEMPS (ligne 51.5, étape C7 ; MEG3-Q4) : un compte inscrit, s'il le veut, une
// application d'authentification (TOTP) comme second facteur, et la connexion lui demande alors son code avant tout écran.
// RIEN n'est exigé en base dans ce premier temps : la porte est celle de l'écran (App.tsx). Le second temps l'exigera dans
// les fonctions qui disent qui est du cabinet et dans les prédicats des cases du client (HISTORIQUE.md, « LA DOUBLE
// AUTHENTIFICATION, PREMIER TEMPS »).
//
// CE QUE DIT LE SERVICE (documentation de Supabase, « Multi-Factor Authentication » et la référence JavaScript de
// `mfa.unenroll` et `mfa.enroll`, relues le 06/11/2026 ; auth-js 2.112.4, GoTrueClient) :
// - le niveau de la session est la revendication `aal` de son jeton : `aal1` après un mot de passe ou un lien, `aal2`
//   après le code d'un second facteur ;
// - `getAuthenticatorAssuranceLevel()`, sans argument, n'appelle pas le service : il lit la session gardée — le niveau
//   dans son jeton, et `aal2` pour niveau suivant dès que la copie de l'utilisateur qu'elle porte (`user.factors`) compte
//   un facteur vérifié. `niveauxDeLaSession` fait le même calcul sur la session que l'application tient déjà : la porte
//   se décide DANS le rendu, sans attente ni écran de passage, et la session élevée par le code (« MFA_CHALLENGE_VERIFIED »)
//   l'ouvre aussitôt (confronté au vrai client dans doubleAuthentification.test.ts) ;
// - un facteur VÉRIFIÉ ne se retire que d'une session `aal2` ; un facteur inachevé, de toute session ;
// - le retrait ne fait redescendre la session qu'au renouvellement de son jeton (`refreshSession()` le rend immédiat) :
//   d'ici là, le jeton dit `aal2` d'un compte qui n'a plus de facteur — le « jeton à rafraîchir » ;
// - la première vérification d'un facteur ferme toutes les AUTRES sessions du compte ;
// - aucun code de secours n'existe : on conseille un second appareil.

import { messageErreur } from './messageErreur'

export type Niveau = 'aal1' | 'aal2'
export type EspaceDuCompte = 'cabinet' | 'client'
/** Le cabinet se vouvoie, le client se tutoie ; les écrans d'avant les rôles (connexion, lien) tutoient, comme Login. */
export type Registre = 'vous' | 'tu'

export function registreDe(espace: EspaceDuCompte): Registre {
  return espace === 'cabinet' ? 'vous' : 'tu'
}

export interface Niveaux { actuel: Niveau | null; suivant: Niveau | null }

/** Un facteur tel que le service le décrit (`Factor` d'auth-js) : les seuls champs lus ici. */
export interface FacteurDuService {
  id: string
  friendly_name?: string | null
  factor_type: string
  status: string
  created_at?: string | null
}

export interface Facteur { id: string; nom: string; type: string; verifie: boolean; creeLe: string | null }

export function facteurDe(f: FacteurDuService): Facteur {
  return { id: f.id, nom: (f.friendly_name ?? '').trim(), type: f.factor_type, verifie: f.status === 'verified', creeLe: f.created_at ?? null }
}

/** La session telle que la porte la lit : son jeton, et la copie de l'utilisateur qu'elle porte. */
export interface SessionLue { access_token: string; user: { factors?: readonly FacteurDuService[] | null } }

/**
 * Le niveau qu'un jeton porte. Comme auth-js : un jeton sans `aal` — le service n'en émet pas — se lit nul, et la porte le
 * traite comme `aal1`. Un jeton illisible se lit nul aussi : devant un facteur vérifié, il demande le code (le côté fermé).
 */
export function niveauDuJeton(jeton: string): Niveau | null {
  const parties = jeton.split('.')
  if (parties.length !== 3) return null
  try {
    const base64 = parties[1].replace(/-/g, '+').replace(/_/g, '/')
    const binaire = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4))
    const charge: unknown = JSON.parse(new TextDecoder().decode(Uint8Array.from(binaire, (c) => c.charCodeAt(0))))
    if (!charge || typeof charge !== 'object' || Array.isArray(charge)) return null
    const aal = (charge as { aal?: unknown }).aal
    return aal === 'aal1' || aal === 'aal2' ? aal : null
  } catch {
    return null
  }
}

export function facteursDeLaSession(session: SessionLue): Facteur[] {
  return (session.user.factors ?? []).map(facteurDe)
}

/** Le calcul de `getAuthenticatorAssuranceLevel()` sans argument (auth-js), sur la session que l'application tient. */
export function niveauxDeLaSession(session: SessionLue): Niveaux {
  const actuel = niveauDuJeton(session.access_token)
  const verifies = facteursDeLaSession(session).filter((f) => f.verifie).length
  return { actuel, suivant: verifies > 0 ? 'aal2' : actuel }
}

/**
 * L'état d'un compte :
 * - `sans-facteur` : rien à demander, l'application s'ouvre ; « Sécurité du compte » propose d'inscrire un appareil ;
 * - `code-a-donner` : un facteur vérifié, et cette session n'a pas encore donné son code — AUCUN écran de l'application ;
 * - `verifie` : la session a donné son code ;
 * - `jeton-a-rafraichir` : le jeton ou la copie de l'utilisateur gardée dans la session ne disent plus ce que le service
 *   sait (un facteur retiré, ou vérifié ailleurs) ; l'application reste ouverte, et l'écran propose d'actualiser la session.
 * `facteurs` : la liste lue au service (`listFactors`), ou celle de la session ; nulle, les seuls niveaux décident.
 */
export type EtatDuCompte = 'sans-facteur' | 'code-a-donner' | 'verifie' | 'jeton-a-rafraichir'

export function etatDuCompte(niveaux: Niveaux, facteurs: readonly Facteur[] | null): EtatDuCompte {
  const { actuel, suivant } = niveaux
  if (facteurs === null) {
    if (suivant === 'aal2' && actuel !== 'aal2') return 'code-a-donner'
    return actuel === 'aal2' ? 'verifie' : 'sans-facteur'
  }
  const verifies = facteurs.filter((f) => f.verifie).length
  if (verifies === 0) return actuel === 'aal2' || suivant === 'aal2' ? 'jeton-a-rafraichir' : 'sans-facteur'
  if (actuel === 'aal2') return 'verifie'
  return suivant === 'aal2' ? 'code-a-donner' : 'jeton-a-rafraichir'
}

export function etatDeLaSession(session: SessionLue): EtatDuCompte {
  return etatDuCompte(niveauxDeLaSession(session), facteursDeLaSession(session))
}

/** Ce que la porte de l'application fait d'un état : seul le code à donner la ferme. */
export function porteDeLApplication(etat: EtatDuCompte): 'ouverte' | 'code' {
  return etat === 'code-a-donner' ? 'code' : 'ouverte'
}

// ── La saisie ────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Le code tel qu'il part : sans ses espaces (les applications l'affichent souvent en deux groupes de trois). */
export function codeSaisi(saisie: string): string {
  return saisie.replace(/\s/g, '')
}

/** Le refus d'un code, dit avant le clic, sur la saisie telle qu'elle part ; nul pour six chiffres. */
export function refusDuCode(saisie: string): string | null {
  return /^[0-9]{6}$/.test(codeSaisi(saisie)) ? null : 'Le code compte six chiffres, sans lettre ni signe.'
}

/** Le nom proposé pour un appareil : « Téléphone », puis « Appareil 2 », « Appareil 3 »… — un nom qu'aucun ne porte. */
export function nomPropose(facteurs: readonly Facteur[]): string {
  const pris = new Set(facteurs.map((f) => f.nom))
  if (!pris.has('Téléphone')) return 'Téléphone'
  for (let n = 2; ; n++) if (!pris.has(`Appareil ${n}`)) return `Appareil ${n}`
}

/** Le refus d'un nom : vide, ou déjà porté (le service refuse deux facteurs du même nom). */
export function refusDuNom(nom: string, facteurs: readonly Facteur[], registre: Registre): string | null {
  const net = nom.trim()
  if (net === '') return registre === 'vous' ? 'Donnez un nom à cet appareil.' : 'Donne un nom à cet appareil.'
  if (facteurs.some((f) => f.nom === net)) {
    return registre === 'vous' ? 'Un appareil porte déjà ce nom : choisissez-en un autre.' : 'Un appareil porte déjà ce nom : choisis-en un autre.'
  }
  return null
}

/** La clé à recopier, par groupes de quatre : lisible, et aucun morceau ne se coupe en fin de ligne. */
export function secretEnGroupes(secret: string): string {
  return (secret.match(/.{1,4}/g) ?? []).join(' ')
}

// ── Les mots ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface MotsDuSecondFacteur {
  invitationCode: string
  invitationCodeRecuperation: string
  aucunAppareilPourLeCode: string
  codePerdu: string
  introduction: string
  aucunAppareil: string
  conseilSecondAppareil: string
  avantConfirmation: string
  scanner: string
  confirme: string
  jetonARafraichir: string
  copieImpossible: string
  confirmationRetrait: (nom: string, dernierVerifie: boolean) => string
}

export const MOTS: Readonly<Record<Registre, MotsDuSecondFacteur>> = {
  vous: {
    invitationCode: 'Ce compte est protégé par un second facteur : saisissez le code à six chiffres qu’affiche votre application d’authentification.',
    invitationCodeRecuperation: 'Avant de choisir un nouveau mot de passe, saisissez le code à six chiffres qu’affiche votre application d’authentification.',
    aucunAppareilPourLeCode: 'Ce compte demande un second facteur, mais aucune application d’authentification n’y est inscrite : déconnectez-vous et prévenez l’administrateur de l’application.',
    codePerdu: 'Plus d’accès à votre application ? Aucun code de secours n’existe : seul l’administrateur de l’application peut retirer le second facteur de ce compte.',
    introduction: 'Un second facteur demande, à chaque connexion, le code à six chiffres d’une application d’authentification (Google Authenticator, Microsoft Authenticator, 1Password…), en plus du mot de passe. Il reste facultatif pour l’instant.',
    aucunAppareil: 'Aucun appareil n’est inscrit : ce compte se connecte avec son seul mot de passe.',
    conseilSecondAppareil: 'Aucun code de secours n’est fourni : inscrivez un second appareil (un autre téléphone, une tablette) pour garder l’accès si le premier se perd.',
    avantConfirmation: 'Confirmer cet appareil ferme les autres sessions de ce compte (sur d’autres navigateurs ou appareils) ; chaque connexion demandera ensuite un code.',
    scanner: 'Scannez ce code QR avec votre application d’authentification, ou saisissez-y la clé ci-dessous ; puis donnez le code à six chiffres qu’elle affiche.',
    confirme: 'Appareil confirmé : la prochaine connexion demandera son code.',
    jetonARafraichir: 'La session ne reflète pas encore le dernier changement des appareils de ce compte : actualisez-la avant tout autre geste.',
    copieImpossible: 'La copie a échoué : recopiez la clé à la main.',
    confirmationRetrait: (nom, dernier) => `Retirer « ${nom} » ? Ses codes ne seront plus acceptés.`
      + (dernier ? ' C’est le dernier appareil confirmé : ce compte se connectera de nouveau avec son seul mot de passe.' : ''),
  },
  tu: {
    invitationCode: 'Ton compte est protégé par un second facteur : saisis le code à six chiffres qu’affiche ton application d’authentification.',
    invitationCodeRecuperation: 'Avant de choisir un nouveau mot de passe, saisis le code à six chiffres qu’affiche ton application d’authentification.',
    aucunAppareilPourLeCode: 'Ton compte demande un second facteur, mais aucune application d’authentification n’y est inscrite : déconnecte-toi et préviens ton cabinet.',
    codePerdu: 'Plus d’accès à ton application ? Aucun code de secours n’existe : demande à ton cabinet de faire retirer ton second facteur.',
    introduction: 'Un second facteur demande, à chaque connexion, le code à six chiffres d’une application d’authentification (Google Authenticator, Microsoft Authenticator, 1Password…), en plus du mot de passe. Il reste facultatif pour l’instant.',
    aucunAppareil: 'Aucun appareil n’est inscrit : ton compte se connecte avec ton seul mot de passe.',
    conseilSecondAppareil: 'Aucun code de secours n’est fourni : inscris un second appareil (un autre téléphone, une tablette) pour garder l’accès si le premier se perd.',
    avantConfirmation: 'Confirmer cet appareil ferme les autres sessions de ton compte (sur d’autres navigateurs ou appareils) ; chaque connexion demandera ensuite un code.',
    scanner: 'Scanne ce code QR avec ton application d’authentification, ou saisis-y la clé ci-dessous ; puis donne le code à six chiffres qu’elle affiche.',
    confirme: 'Appareil confirmé : ta prochaine connexion demandera son code.',
    jetonARafraichir: 'Ta session ne reflète pas encore le dernier changement de tes appareils : actualise-la avant tout autre geste.',
    copieImpossible: 'La copie a échoué : recopie la clé à la main.',
    confirmationRetrait: (nom, dernier) => `Retirer « ${nom} » ? Ses codes ne seront plus acceptés.`
      + (dernier ? ' C’est le dernier appareil confirmé : ton compte se connectera de nouveau avec ton seul mot de passe.' : ''),
  },
}

// ── Les refus du service ─────────────────────────────────────────────────────────────────────────────────────────────
export type Etape = 'lecture' | 'inscription' | 'verification' | 'retrait' | 'actualisation'

const ECHEC: Readonly<Record<Etape, string>> = {
  lecture: 'La sécurité du compte n’a pas pu être lue',
  inscription: 'L’appareil n’a pas pu être ajouté',
  verification: 'Le code n’a pas pu être vérifié',
  retrait: 'L’appareil n’a pas pu être retiré',
  actualisation: 'La session n’a pas pu être actualisée',
}

/**
 * Le refus du service, lu à son CODE (les codes d'erreur d'auth-js, lib/error-codes.ts), jamais à son seul statut ; un
 * refus inconnu se dit avec son message, par `messageErreur` — jamais une erreur nue.
 */
export function messageDuService(etape: Etape, erreur: unknown, registre: Registre): string {
  const e = erreur && typeof erreur === 'object' ? erreur as { code?: unknown; status?: unknown; name?: unknown } : {}
  const code = typeof e.code === 'string' ? e.code : null
  const statut = typeof e.status === 'number' ? e.status : null
  const vous = registre === 'vous'
  if (code === 'mfa_verification_failed') {
    return vous ? 'Ce code n’est pas le bon, ou il a expiré : saisissez celui que l’application affiche maintenant.'
      : 'Ce code n’est pas le bon, ou il a expiré : saisis celui que l’application affiche maintenant.'
  }
  if (code === 'mfa_challenge_expired') {
    return vous ? 'Le délai de vérification est passé : saisissez le code affiché maintenant.' : 'Le délai de vérification est passé : saisis le code affiché maintenant.'
  }
  if (code === 'insufficient_aal') {
    return vous ? 'Le service demande d’abord le code de cette session : déconnectez-vous, reconnectez-vous en donnant votre code, puis recommencez.'
      : 'Le service demande d’abord le code de cette session : déconnecte-toi, reconnecte-toi en donnant ton code, puis recommence.'
  }
  if (code === 'mfa_factor_name_conflict') {
    return vous ? 'Un appareil porte déjà ce nom : choisissez-en un autre.' : 'Un appareil porte déjà ce nom : choisis-en un autre.'
  }
  if (code === 'too_many_enrolled_mfa_factors') {
    return vous ? 'Le nombre maximal d’appareils est atteint : retirez-en un avant d’en ajouter un autre.'
      : 'Le nombre maximal d’appareils est atteint : retires-en un avant d’en ajouter un autre.'
  }
  if (code === 'mfa_factor_not_found') return 'Cet appareil n’est plus inscrit.'
  if (code === 'mfa_totp_enroll_not_enabled' || code === 'mfa_totp_verify_not_enabled') {
    return 'Le service n’accepte pas les applications d’authentification en ce moment.'
  }
  if (code === 'mfa_ip_address_mismatch') {
    return vous ? 'La vérification doit se faire depuis la connexion qui l’a commencée : recommencez.'
      : 'La vérification doit se faire depuis la connexion qui l’a commencée : recommence.'
  }
  if (statut === 429 || code === 'over_request_rate_limit' || code === 'mfa_verification_rejected') {
    return vous ? 'Trop de tentatives en peu de temps : attendez quelques minutes, puis réessayez.'
      : 'Trop de tentatives en peu de temps : attends quelques minutes, puis réessaie.'
  }
  // auth-js fait de `session_not_found` une `AuthSessionMissingError` (lib/fetch.js, handleError).
  if (e.name === 'AuthSessionMissingError' || code === 'session_not_found' || code === 'session_expired') {
    return vous ? 'La session a pris fin : reconnectez-vous.' : 'La session a pris fin : reconnecte-toi.'
  }
  // Une requête sans réponse : auth-js en fait une `AuthRetryableFetchError` de statut 0.
  if (e.name === 'AuthRetryableFetchError' && statut === 0) {
    return vous ? 'Le service de connexion n’a pas répondu : vérifiez la connexion à Internet, puis réessayez.'
      : 'Le service de connexion n’a pas répondu : vérifie la connexion à Internet, puis réessaie.'
  }
  return `${ECHEC[etape]} : ${messageErreur(erreur, 'raison inconnue')}`
}
