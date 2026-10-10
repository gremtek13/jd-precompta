// LA RÈGLE DES MOTS DE PASSE TELLE QUE LE SERVICE D'AUTHENTIFICATION L'APPLIQUE — un MODÈLE de son comportement, pour
// le faux service du harnais des Edge Functions (`fonctionsEdge.ts`) et pour le test qui confronte le reflet des écrans
// (`lib/recuperationMotDePasse.ts`) au service. Écrit d'après ce que fait le service (supabase/auth, dépôt public, lu le
// 10/10/2026 : `checkPasswordStrength` dans `internal/api/password.go`, `adminUserCreate` dans `internal/api/admin.go`,
// la réponse dans `internal/api/errors.go`), et d'après ce qu'il a répondu en production le même jour ; jamais recopié.
//
// Ce que le service fait d'un mot de passe, dans l'ordre :
//   - au-delà de 72 OCTETS (la limite de bcrypt), il refuse en 400 `validation_failed`, avant toute autre raison ;
//   - sous la longueur minimale, comptée en OCTETS (UTF-8) et non en caractères, la raison `length` ;
//   - pour les jeux de caractères exigés, s'il en manque un — aucun de ses caractères dans le mot de passe —, la raison
//     `characters`, une seule fois, et le message liste TOUS les jeux ;
//   - si la protection des mots de passe divulgués est allumée et connaît celui-ci, la raison `pwned` ;
//   - une raison au moins : 422 `weak_password`, les raisons dans `weak_password.reasons`, les messages mis bout à bout.
// Et `adminUserCreate` juge l'adresse AVANT le mot de passe : une adresse déjà inscrite rend `email_exists` (422), quel
// que soit le mot de passe.

export interface RegleDuService {
  /** La longueur minimale (6 sur un projet neuf), comptée en octets. */
  longueurMinimale: number
  /** Les jeux de caractères exigés, un caractère au moins de chacun ; aucun sur un projet neuf. */
  jeux: readonly string[]
  /** Les mots de passe que la protection des mots de passe divulgués connaît, ou null : protection éteinte (plan gratuit). */
  divulgues: readonly string[] | null
}

/** Un projet neuf : six caractères, aucune sorte exigée, protection éteinte. */
export const REGLE_D_UN_PROJET_NEUF: RegleDuService = { longueurMinimale: 6, jeux: [], divulgues: null }

/** Au-delà, bcrypt refuse : le service répond `validation_failed`. */
export const LONGUEUR_MAXIMALE_EN_OCTETS = 72

/**
 * Le refus que le service a rendu en PRODUCTION le 10/10/2026 (journaux d'authentification, relevés par la session),
 * à la création d'un accès client, juste après que le cabinet a exigé au tableau de bord des minuscules, des majuscules,
 * des chiffres et des symboles. Recopié tel quel : c'est la référence extérieure de la règle du projet.
 */
export const MESSAGE_RELEVE_LE_10_10_2026 =
  "Password should contain at least one character of each: abcdefghijklmnopqrstuvwxyz, ABCDEFGHIJKLMNOPQRSTUVWXYZ, 0123456789, !@#$%^&*()_+-=[]{};'\\:\"|<>?,./`~."

/** Les jeux qu'un tel message liste : séparés par « , » (aucun jeu ne contient d'espace), le point final retiré. */
export function jeuxDuMessage(message: string): string[] {
  const tete = 'Password should contain at least one character of each: '
  if (!message.startsWith(tete) || !message.endsWith('.')) throw new Error(`message du service illisible : ${message}`)
  return message.slice(tete.length, -1).split(', ')
}

/**
 * La règle du projet telle que le service l'appliquait le 10/10/2026 : les jeux du message relevé, et la longueur de la
 * création des comptes (le minimum que les trois fonctions vérifient elles-mêmes ; celui du tableau de bord n'a pas été
 * relevé). La protection des mots de passe divulgués est réservée au plan payant : éteinte.
 */
export const REGLE_DU_PROJET_RELEVEE: RegleDuService = {
  longueurMinimale: 10,
  jeux: jeuxDuMessage(MESSAGE_RELEVE_LE_10_10_2026),
  divulgues: null,
}

/** Les raisons d'un refus, telles que le service les nomme (et qu'auth-js les type : `WeakPasswordReasons`). */
export type RaisonDuService = 'length' | 'characters' | 'pwned'

export type JugementDuService =
  | { admis: true }
  | { admis: false; code: 'validation_failed'; statut: 400; message: string }
  | { admis: false; code: 'weak_password'; statut: 422; message: string; raisons: RaisonDuService[] }

/** Ce que le service répond d'un mot de passe, sous une règle donnée. */
export function jugementDuService(motDePasse: string, regle: RegleDuService): JugementDuService {
  const octets = new TextEncoder().encode(motDePasse).length
  if (octets > LONGUEUR_MAXIMALE_EN_OCTETS) {
    return { admis: false, code: 'validation_failed', statut: 400, message: `Password cannot be longer than ${LONGUEUR_MAXIMALE_EN_OCTETS} characters` }
  }
  const raisons: RaisonDuService[] = []
  const messages: string[] = []
  if (octets < regle.longueurMinimale) {
    raisons.push('length')
    messages.push(`Password should be at least ${regle.longueurMinimale} characters.`)
  }
  if (regle.jeux.some((jeu) => jeu !== '' && ![...jeu].some((c) => motDePasse.includes(c)))) {
    raisons.push('characters')
    messages.push(`Password should contain at least one character of each: ${regle.jeux.join(', ')}.`)
  }
  if (regle.divulgues?.includes(motDePasse)) {
    raisons.push('pwned')
    messages.push('Password is known to be weak and easy to guess, please choose a different one.')
  }
  return raisons.length === 0 ? { admis: true } : { admis: false, code: 'weak_password', statut: 422, message: messages.join(' '), raisons }
}
