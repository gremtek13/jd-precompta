import { messageErreur } from './messageErreur'

// « MOT DE PASSE OUBLIÉ » (demande du cabinet du 09/10/2026) : ce que l'écran de connexion demande, ce que le lien de
// l'e-mail rapporte, et ce que l'écran du nouveau mot de passe refuse. Aucun appel ici : les écrans appellent
// (`Login.tsx`, `NouveauMotDePasse.tsx`, et l'onglet Accès, qui envoie le même lien depuis le cabinet), ce module décide
// de ce qui se dit. Chaque demande de lien passe `{ redirectTo: ADRESSE_DE_RETOUR }` : le test le vérifie sur la source.
//
// CE QUE FAIT LE CLIENT SUPABASE AU CHARGEMENT, lu dans le code installé (@supabase/supabase-js et @supabase/auth-js
// 2.112.4), et non dans une documentation :
//   - le flux par défaut est `implicit` (`DEFAULT_AUTH_OPTIONS` de supabase-js), et `lib/supabase.ts` ne le change pas ;
//   - à sa construction, `_initialize` lit l'adresse (`parseParametersFromURL` : le fragment, puis les paramètres de
//     l'adresse, qui l'emportent) ; un `access_token` ou une erreur en fait un retour à traiter
//     (`_isImplicitGrantCallback`) ;
//   - `_getSessionFromURL` vérifie le jeton auprès du service (`_getUser`), enregistre la session, vide le fragment
//     (`window.location.hash = ''`) APRÈS cet aller-retour, puis émet `PASSWORD_RECOVERY` quand `type=recovery` ;
//   - une erreur dans l'adresse ne vide rien : le fragment reste, et aucune session n'est ouverte.
// Le service, lui (supabase/auth, `AsRedirectURL` et `prepErrorRedirectURL`), renvoie vers `redirect_to + "#" + …` :
// les jetons, ou `error`, `error_code`, `error_description`, dans le FRAGMENT en flux implicite. Ce contrat se JOUE sur le
// vrai client installé dans `recuperationMotDePasseClient.test.ts` : une mise à jour de supabase-js qui le romprait y vire
// au rouge, alors que les autres tests doublent le client.
//
// POURQUOI PAS LE FLUX PKCE : son vérificateur reste dans le navigateur qui a fait la demande. Sur un iPhone, la demande
// part de l'application installée et le lien s'ouvre dans Safari, qui n'a pas ce vérificateur : le lien échouerait.
// Le flux implicite marche quel que soit le navigateur qui ouvre le lien.

/**
 * L'adresse où le lien de l'e-mail ramène : la racine de l'application en ligne, passée EXPLICITEMENT (sans elle, le
 * service retombe sur la « Site URL » du tableau de bord), couverte par l'URL de retour autorisée
 * `https://compta.jdarnis.fr/**`. Jamais de fragment : le service y ajoute le sien après un « # », et un second « # »
 * rendrait les jetons illisibles au client. Le domaine est celui de `public/CNAME` (le test les confronte).
 */
export const ADRESSE_DE_RETOUR = 'https://compta.jdarnis.fr/'

/** La règle de la création des comptes (create-client-access, create-team-member, create-cabinet), confrontée par le test. */
export const LONGUEUR_MINIMALE_MOT_DE_PASSE = 10

/**
 * Ce que l'adresse du chargement rapporte d'un lien d'authentification. `recuperation` porte le jeton d'accès du lien :
 * la session que le client ouvre avec lui se reconnaît à ce jeton, sans dépendre de l'heure à laquelle l'événement
 * `PASSWORD_RECOVERY` arrive.
 */
export type RetourDuLien =
  | { nature: 'aucun' }
  | { nature: 'recuperation'; jeton: string }
  | { nature: 'refus'; code: string | null }

export const AUCUN_RETOUR: RetourDuLien = { nature: 'aucun' }

// Le code d'erreur ne s'affiche que s'il a la forme d'un code : le texte d'une adresse se fabrique, et l'écran ne doit
// pas afficher une phrase que n'importe qui peut écrire dans un lien (le précédent de RetourBanque). Pour la même raison,
// `error_description` ne s'affiche jamais.
const CODE_ERREUR = /^[a-z_]{1,40}$/i

/**
 * Lit le retour d'un lien d'authentification dans l'adresse. Un fragment qui commence par « / » est une route de
 * l'application (HashRouter), jamais un retour du service : le retour de la banque (`#/retour-banque?state=…&error=…`)
 * ne doit pas passer pour un lien refusé.
 */
export function lireRetourDuLien(adresse: string): RetourDuLien {
  let url: URL
  try {
    url = new URL(adresse)
  } catch {
    return AUCUN_RETOUR
  }
  const fragment = url.hash.slice(1)
  if (fragment === '' || fragment.startsWith('/')) return AUCUN_RETOUR
  const parametres = new URLSearchParams(fragment)
  // Comme le client : une valeur vide ne compte pas.
  if (parametres.get('error') || parametres.get('error_code') || parametres.get('error_description')) {
    const code = parametres.get('error_code') || parametres.get('error')
    return { nature: 'refus', code: code && CODE_ERREUR.test(code) ? code : null }
  }
  const jeton = parametres.get('access_token')
  if (jeton && parametres.get('type') === 'recovery') return { nature: 'recuperation', jeton }
  return AUCUN_RETOUR
}

/** Le lien dont le jeton n'a ouvert aucune session : le client n'a pas pu le vérifier (expiré, révoqué, réseau). */
export const AVIS_LIEN_SANS_SESSION = "Ce lien n'a pas pu ouvrir de session : il a peut-être expiré, ou le service n'a pas répondu."

/** Ce qu'un lien refusé par le service se dit. `otp_expired` est le code d'un lien expiré OU déjà servi (supabase/auth, `verify.go`). */
export function avisDuRefus(code: string | null): string {
  if (code === null || code === 'otp_expired') return 'Ce lien ne peut plus servir : il a expiré, ou il a déjà été utilisé.'
  return `Ce lien a été refusé par le service d'authentification (code ${code}).`
}

/** Les deux saisies du nouveau mot de passe, jugées avant tout appel. */
export function refusDuNouveauMotDePasse(motDePasse: string, confirmation: string): string | null {
  if (motDePasse.length < LONGUEUR_MINIMALE_MOT_DE_PASSE) {
    return `Le mot de passe doit faire au moins ${LONGUEUR_MINIMALE_MOT_DE_PASSE} caractères.`
  }
  if (motDePasse !== confirmation) return 'Les deux saisies ne sont pas identiques.'
  return null
}

/**
 * Le message qui suit une demande de lien acceptée. Il est le même que l'adresse ait un compte ou non : le service
 * répond de même dans les deux cas et n'envoie rien quand aucun compte n'existe (documentation de Supabase, « Resetting
 * a password » : `resetPasswordForEmail()` ne révèle pas si un compte existe).
 */
export const MESSAGE_LIEN_DEMANDE =
  "Si un compte existe pour cette adresse, un e-mail vient d'y partir avec un lien pour choisir un nouveau mot de passe. " +
  "Le lien ne sert qu'une fois. Pense à regarder dans les courriers indésirables."

// Ce que porte une erreur du client d'authentification (`AuthError` : `code`, `status`, `name`), lu sur la valeur et
// non sur sa classe (erreursSupabase.test.ts interdit `instanceof Error` hors d'invokeErreur.ts).
function traits(erreur: unknown): { code: string | null; statut: number | null; nom: string | null } {
  if (!erreur || typeof erreur !== 'object') return { code: null, statut: null, nom: null }
  const e = erreur as { code?: unknown; status?: unknown; name?: unknown }
  return {
    code: typeof e.code === 'string' ? e.code : null,
    statut: typeof e.status === 'number' ? e.status : null,
    nom: typeof e.name === 'string' ? e.name : null,
  }
}

// Le débit : 429 (documentation de Supabase, « Rate limits »), sous l'un ou l'autre code.
function tropDeDemandes(t: ReturnType<typeof traits>): boolean {
  return t.statut === 429 || t.code === 'over_email_send_rate_limit' || t.code === 'over_request_rate_limit'
}

// Une requête qui n'est pas partie ou n'a pas eu de réponse : auth-js en fait une `AuthRetryableFetchError` de statut 0.
function sansReponse(t: ReturnType<typeof traits>): boolean {
  return t.nom === 'AuthRetryableFetchError' && t.statut === 0
}

const SANS_REPONSE = "Le service de connexion n'a pas répondu : vérifie la connexion à Internet, puis réessaie."

/**
 * L'erreur d'une demande de lien. Aucune ne nomme le compte. Le débit propre à UN compte (une demande par minute)
 * répond 429 quand le compte existe : c'est le service qui le rend, à quiconque l'appelle ; l'écran le dit sans nommer
 * personne.
 */
export function messageErreurDuLien(erreur: unknown): string {
  const t = traits(erreur)
  if (tropDeDemandes(t)) return 'Trop de demandes en peu de temps : attends quelques minutes avant de redemander un lien.'
  if (t.code === 'email_address_invalid') return "Cette adresse e-mail n'est pas valide."
  if (sansReponse(t)) return SANS_REPONSE
  return `Le lien n'a pas pu être demandé : ${messageErreur(erreur, 'raison inconnue')}`
}

/** L'erreur du changement de mot de passe. */
export function messageErreurDuMotDePasse(erreur: unknown): string {
  const t = traits(erreur)
  if (t.code === 'same_password') return "C'est déjà le mot de passe de ce compte : choisis-en un autre."
  if (t.code === 'weak_password') {
    return "Le service d'authentification refuse ce mot de passe comme trop faible : choisis-en un plus long, qui mêle minuscules, majuscules, chiffres et symboles."
  }
  // `session_not_found` devient une `AuthSessionMissingError` dans auth-js (lib/fetch.js, handleError).
  if (t.nom === 'AuthSessionMissingError' || t.code === 'session_expired' || t.statut === 401 || t.statut === 403) {
    return "La session ouverte par le lien a expiré : déconnecte-toi, puis redemande un lien depuis l'écran de connexion."
  }
  if (tropDeDemandes(t)) return 'Trop de demandes en peu de temps : attends quelques minutes, puis réessaie.'
  if (sansReponse(t)) return SANS_REPONSE
  return `Le mot de passe n'a pas pu être changé : ${messageErreur(erreur, 'raison inconnue')}`
}

// ── LE LIEN ENVOYÉ PAR LE CABINET (onglet Accès, décision du cabinet du 10/10/2026) ──────────────────────────────────
// Le même lien que « Mot de passe oublié », par le même appel (`resetPasswordForEmail`, retour `ADRESSE_DE_RETOUR`),
// parti d'un autre écran : la réinitialisation par un mot de passe que le cabinet poserait n'a pas été retenue. Le
// cabinet n'y gagne aucun droit : auth-js (2.112.4, `resetPasswordForEmail`) n'envoie à `/recover` que les en-têtes de
// son client — la clé publique, jamais le jeton de la session (supabase-js, `_initSupabaseAuthClient`, sans
// `fetchWithAuth`) —, c'est l'appel que quiconque fait depuis l'écran de connexion, et le lien
// part dans la boîte du titulaire du compte, seul à pouvoir s'en servir. La session du cabinet n'en est pas touchée.
//
// Ici, contrairement à l'écran de connexion, l'adresse est celle d'un accès que le cabinet a créé : les messages peuvent
// la nommer. Ce qu'ils ne disent pas : la durée du lien, réglée au tableau de bord et lue nulle part dans le dépôt.

/** La question posée avant l'envoi : elle nomme l'adresse, et ce que l'envoi ne change pas. */
export function questionDuLienEnvoye(adresse: string): string {
  return `Envoyer à ${adresse} un lien pour choisir un nouveau mot de passe ? `
    + "Le mot de passe actuel reste valable tant que le client n'en a pas choisi un autre par ce lien."
}

/** Ce que l'écran dit d'une demande acceptée par le service. */
export function avisDuLienEnvoye(adresse: string): string {
  return `Un lien de réinitialisation est parti vers ${adresse}. Il ne sert qu'une fois.`
}

/** L'erreur d'un envoi demandé par le cabinet : ce qui est parti ou non, et vers quelle adresse. */
export function messageErreurDuLienEnvoye(adresse: string, erreur: unknown): string {
  const t = traits(erreur)
  if (tropDeDemandes(t)) {
    // Le débit du service, par compte (un lien vient peut-être d'y partir, demandé d'ici ou par le client lui-même depuis
    // l'écran de connexion) ou pour tout le projet. Le refus n'envoie rien.
    return `Trop de demandes rapprochées : le service d'authentification n'a pas envoyé de nouveau lien vers ${adresse}. `
      + "Un lien vient peut-être d'y partir ; sinon, attends quelques minutes, puis réessaie."
  }
  if (t.code === 'email_address_invalid') {
    return `Le service d'authentification refuse l'adresse ${adresse} comme invalide : aucun lien n'est parti.`
  }
  // Sans réponse, la demande a pu atteindre le service ou non : on ne le sait pas, et l'écran le dit.
  if (sansReponse(t)) {
    return `Le service de connexion n'a pas répondu : on ne sait pas si le lien est parti vers ${adresse}. `
      + 'Vérifie la connexion à Internet, puis réessaie.'
  }
  return `Le lien n'a pas pu partir vers ${adresse} : ${messageErreur(erreur, 'raison inconnue')}`
}
