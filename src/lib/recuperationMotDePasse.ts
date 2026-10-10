import { messageErreur } from './messageErreur'

// « MOT DE PASSE OUBLIÉ » (demande du cabinet du 09/10/2026) : ce que l'écran de connexion demande, ce que le lien de
// l'e-mail rapporte, et ce que l'écran du nouveau mot de passe refuse. Aucun appel ici : les écrans appellent
// (`Login.tsx`, `NouveauMotDePasse.tsx`, et l'onglet Accès, qui envoie le même lien depuis le cabinet), ce module décide
// de ce qui se dit. Chaque demande de lien passe `{ redirectTo: ADRESSE_DE_RETOUR }` : le test le vérifie sur la source.
// Il porte aussi LA RÈGLE DES MOTS DE PASSE du projet, telle que les quatre écrans qui en posent un la disent, et ce que
// le service d'authentification dit quand il refuse un compte ou un mot de passe — un bloc que les trois fonctions qui
// créent des comptes recopient (10/10/2026, défaut 23.5).
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

// ── LA RÈGLE DES MOTS DE PASSE DU PROJET, TELLE QUE LES ÉCRANS LA DISENT ─────────────────────────────────────────────
// Un REFLET. La règle qui fait foi est celle du service d'authentification, réglée au tableau de bord de Supabase
// (Sign In / Providers → Email : la longueur minimale, et les sortes de caractères exigées, que le cabinet a posées le
// 10/10/2026 : une minuscule, une majuscule, un chiffre et un symbole). Les écrans qui posent un mot de passe — l'onglet
// Accès, l'équipe, un nouveau cabinet, le nouveau mot de passe — la disent avant le clic et refusent avant tout appel un
// mot de passe qui ne la suit pas ; le service reste juge, et son refus se dit en français (`refusDuMotDePasse`,
// ci-dessous). Un réglage changé au tableau de bord se reporte ici et dans PLAN_DE_REPRISE.md (§3, point 6) : sinon
// l'écran refuse ce que le service accepterait, ou le service refuse — en le disant — ce que l'écran a laissé partir.

/** La longueur de la création des comptes (create-client-access, create-team-member, create-cabinet), confrontée par le test. */
export const LONGUEUR_MINIMALE_MOT_DE_PASSE = 10

/**
 * Les sortes de caractères exigées, chacune avec les caractères qui la font, tels que le service les liste dans son
 * refus (message relevé le 10/10/2026, « Password should contain at least one character of each: … », que le test
 * recopie) : il en exige un de chaque jeu (`strings.ContainsAny`, supabase/auth, `checkPasswordStrength`). Un « é »
 * n'est donc pas une minuscule, ni « € », « § » ou l'espace un symbole : seuls comptent les 32 signes de ponctuation
 * de l'ASCII.
 */
export const SORTES_DE_CARACTERES: readonly { sorte: string; caracteres: string }[] = [
  { sorte: 'une minuscule', caracteres: 'abcdefghijklmnopqrstuvwxyz' },
  { sorte: 'une majuscule', caracteres: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' },
  { sorte: 'un chiffre', caracteres: '0123456789' },
  { sorte: 'un symbole', caracteres: '!@#$%^&*()_+-=[]{};\'\\:"|<>?,./`~' },
]

/** « a », « a et b », « a, b et c ». */
function enumeration(termes: readonly string[]): string {
  return termes.length <= 1 ? termes.join('') : `${termes.slice(0, -1).join(', ')} et ${termes[termes.length - 1]}`
}

const SYMBOLES = SORTES_DE_CARACTERES.find((s) => s.sorte === 'un symbole')?.caracteres ?? ''

/**
 * La règle en une phrase : ce que les écrans disent sous le champ, avant le clic. Les symboles se listent depuis le jeu
 * même que `refusDeLaRegle` consulte : la phrase ne peut pas promettre un symbole que l'écran refuserait.
 */
export const REGLE_DU_MOT_DE_PASSE = `Règle du projet : au moins ${LONGUEUR_MINIMALE_MOT_DE_PASSE} caractères, dont `
  + `${enumeration(SORTES_DE_CARACTERES.map((s) => s.sorte))} — l'un de ${[...SYMBOLES].join(' ')} `
  + "(une lettre accentuée, « € » ou l'espace ne comptent pas)."

/**
 * Ce que la règle refuse d'un mot de passe, dit en français, ou null s'il la suit : jugé avant tout appel, il dit tout
 * ce qui manque d'un coup. La longueur se compte comme les trois fonctions la comptent (`password.length`) ; le service,
 * lui, compte des octets, toujours au moins autant : ce que l'écran laisse partir, la longueur du service l'admet.
 */
export function refusDeLaRegle(motDePasse: string): string | null {
  const court = motDePasse.length < LONGUEUR_MINIMALE_MOT_DE_PASSE
  const manquantes = SORTES_DE_CARACTERES
    .filter(({ caracteres }) => ![...caracteres].some((c) => motDePasse.includes(c)))
    .map((s) => s.sorte)
  if (!court && manquantes.length === 0) return null
  const exigences = [
    ...(court ? [`faire au moins ${LONGUEUR_MINIMALE_MOT_DE_PASSE} caractères`] : []),
    ...(manquantes.length > 0 ? [`contenir ${enumeration(manquantes)}`] : []),
  ]
  return `Ce mot de passe ne suit pas la règle du projet : il doit ${exigences.join(', et ')}.`
}

// ── DÉBUT COPIE refusDuService ───────────────────────────────────────────────────────────────────────────────────────
// CE QUE LE SERVICE D'AUTHENTIFICATION DIT QUAND IL REFUSE de créer un compte (`auth.admin.createUser` :
// create-client-access, create-team-member, create-cabinet) ou de poser un mot de passe (`auth.updateUser` : l'écran
// du nouveau mot de passe). Son original vit dans src/lib/recuperationMotDePasse.ts ; il est copié À L'IDENTIQUE dans
// les trois fonctions, qui sont auto-portées, et refusDuServiceCopie.test.ts compare les copies au caractère près et les
// exécute contre l'original.
//
// Lu sur le CODE de l'erreur, jamais sur son statut ni sur son message. Le service (supabase/auth, `adminUserCreate`
// et `errors.go`) rend 422 pour une adresse déjà inscrite (`email_exists`) COMME pour un mot de passe que la règle du
// projet refuse (`weak_password`) : la détection par le statut prenait le second pour le premier, et le cabinet lisait
// « Un compte existe déjà… » sur un mot de passe refusé (10/10/2026, défaut 23.5). Le message, lui, est en anglais et
// change d'une version du service à l'autre. auth-js (2.112.4, `lib/fetch.js`) recopie sur l'erreur le code de la
// réponse (`code`), et fait d'un refus du mot de passe une `AuthWeakPasswordError` qui porte ses raisons (`reasons`) —
// `refusDuServiceClient.test.ts` le joue sur le client installé.

/**
 * Les codes d'une adresse qui a déjà un compte : `email_exists`, celui d'`adminUserCreate`, et `user_already_exists`,
 * celui de l'inscription publique — auth-js nomme les deux, et ils disent la même chose.
 */
const CODES_DEJA_INSCRIT: readonly string[] = ['email_exists', 'user_already_exists']

/** Le code que porte une erreur du service (`AuthError.code`), lu sur la valeur et non sur sa classe. */
function codeDuRefus(erreur: unknown): string | null {
  if (erreur === null || typeof erreur !== 'object') return null
  const code = (erreur as { code?: unknown }).code
  return typeof code === 'string' ? code : null
}

/** Vrai si le service refuse la création parce que l'adresse a déjà un compte. */
export function adresseDejaInscrite(erreur: unknown): boolean {
  const code = codeDuRefus(erreur)
  return code !== null && CODES_DEJA_INSCRIT.includes(code)
}

/**
 * Ce qui manque au mot de passe, raison par raison, dans l'ordre où le service les juge (`checkPasswordStrength` :
 * `length`, `characters`, `pwned`). Une raison qu'il ajouterait demain ne se recopie pas : un texte venu du service ne
 * s'affiche pas tel quel, et la phrase de tête suffit à dire le refus.
 */
const CE_QUI_MANQUE: readonly (readonly [string, string])[] = [
  ['length', 'il est trop court'],
  ['characters', "il lui manque une sorte de caractères qu'elle exige (minuscule, majuscule, chiffre ou symbole, selon le réglage)"],
  ['pwned', 'il figure parmi les mots de passe divulgués lors de fuites de données'],
]

/**
 * Le refus d'un mot de passe par la règle du projet, dit en français — ou null si l'erreur n'en est pas un. La règle
 * se règle au tableau de bord de Supabase et le service seul l'applique : la phrase la dit « du projet », et dit ce
 * qui manque sans la recopier (elle a pu changer depuis que les écrans en ont écrit le reflet).
 */
export function refusDuMotDePasse(erreur: unknown): string | null {
  if (codeDuRefus(erreur) !== 'weak_password') return null
  const lues = (erreur as { reasons?: unknown }).reasons
  const raisons: unknown[] = Array.isArray(lues) ? lues : []
  const manques = CE_QUI_MANQUE.filter(([raison]) => raisons.includes(raison)).map(([, phrase]) => phrase)
  const tete = "Le service d'authentification refuse ce mot de passe : il ne suit pas la règle des mots de passe du projet, "
    + 'réglée au tableau de bord de Supabase'
  return manques.length === 0 ? `${tete}.` : `${tete} — ${manques.join(' ; ')}.`
}
// ── FIN COPIE refusDuService ─────────────────────────────────────────────────────────────────────────────────────────

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

/** Les deux saisies du nouveau mot de passe, jugées avant tout appel : la règle d'abord, c'est elle qu'on corrige en premier. */
export function refusDuNouveauMotDePasse(motDePasse: string, confirmation: string): string | null {
  const refus = refusDeLaRegle(motDePasse)
  if (refus !== null) return refus
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
  // La même phrase que les trois fonctions qui créent des comptes, ce qui manque compris.
  const refus = refusDuMotDePasse(erreur)
  if (refus !== null) return `${refus} Choisis-en un autre.`
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
