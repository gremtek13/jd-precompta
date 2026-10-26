// CE QUE L'ÉCRAN DIT APRÈS LA CRÉATION D'UN ACCÈS CLIENT OU D'UN MEMBRE DE L'ÉQUIPE (décision du cabinet du 10/10/2026).
//
// `create-client-access` et `create-team-member` ne touchent JAMAIS au mot de passe d'un compte qui existe déjà : ils le
// reprennent tel qu'il est (s'il est déjà lié au cabinet ; sinon ils refusent en 409, comme avant — sauf l'onglet Accès,
// qui rattache sur confirmation, voir plus bas), et disent lequel des deux cas s'est produit — `compte: "cree"` : le mot
// de passe saisi est celui du compte, le cabinet le communique ; `compte: "existant"` : il n'a pas servi, et le
// communiquer ferait chercher au titulaire un mot de passe qui n'ouvre rien.
// Le titulaire change le sien lui-même : « Mot de passe oublié » sur l'écran de connexion, ou, pour un client, le lien
// que le cabinet lui envoie depuis l'onglet Accès. Aucun appel ici : les écrans appellent, ce module décide de ce qui se
// dit (comme `recuperationMotDePasse.ts`), et de ce qui part.
import { CE_QUE_DONNE_UN_ACCES, DOMAINES } from './droitsAcces'
import type { RoleCabinetAdmin } from './types'

/** Ce que la réponse dit du compte : créé (le mot de passe saisi est le sien), existant (il n'a pas servi), ou rien de sûr. */
export type CompteDeLaCreation = 'cree' | 'existant' | 'inconnu'

/**
 * Le compte, lu dans la réponse de la fonction. Un objet sans le champ vient d'une fonction d'avant le 10/10/2026, qui
 * répondait `{ ok: true }` après avoir posé le mot de passe saisi sur le compte, neuf ou repris : il est alors celui du
 * compte, comme pour un compte créé. Toute autre réponse ne dit rien de sûr, et l'écran ne promet rien.
 */
export function compteDeLaReponse(reponse: unknown): CompteDeLaCreation {
  if (reponse === null || typeof reponse !== 'object') return 'inconnu'
  const compte = (reponse as { compte?: unknown }).compte
  if (compte === 'existant') return 'existant'
  if (compte === 'cree' || compte === undefined) return 'cree'
  return 'inconnu'
}

// Le bouton de l'onglet Accès qui envoie au client le lien de « Mot de passe oublié » (`AccesTab.tsx`).
const BOUTON_DU_LIEN = '« Envoyer un lien de réinitialisation »'

/** Ce que l'onglet Accès dit d'un accès créé, avec l'adresse envoyée à la fonction. */
export function avisDeLAccesCree(adresse: string, compte: CompteDeLaCreation): string {
  if (compte === 'cree') return `L'accès de ${adresse} est créé : communique-lui le mot de passe initial que tu as saisi.`
  if (compte === 'existant') {
    return `L'accès de ${adresse} est créé. Cette adresse avait déjà un compte : le client garde son mot de passe actuel, `
      + "et celui saisi ici n'a pas été posé — ne le lui communique pas. S'il ne s'en souvient plus, envoie-lui un lien "
      + `depuis la liste des accès (${BOUTON_DU_LIEN}).`
  }
  return `L'accès de ${adresse} est créé, mais la réponse ne dit pas si cette adresse avait déjà un compte : le mot de `
    + "passe saisi n'est peut-être pas le sien. S'il ne lui ouvre pas de session, envoie-lui un lien depuis la liste des "
    + `accès (${BOUTON_DU_LIEN}).`
}

/** Ce que l'écran de l'équipe dit d'un membre ajouté. Un membre n'a pas d'onglet Accès : son lien, il le demande lui-même. */
export function avisDuMembreAjoute(adresse: string, compte: CompteDeLaCreation): string {
  if (compte === 'cree') return `${adresse} a rejoint l'équipe : communique-lui le mot de passe que tu as saisi.`
  const recours = "« Mot de passe oublié », sur l'écran de connexion, lui envoie un lien pour en choisir un autre."
  if (compte === 'existant') {
    return `${adresse} a rejoint l'équipe. Cette adresse avait déjà un compte : la personne garde son mot de passe `
      + "actuel, et celui saisi ici n'a pas été posé — ne le lui communique pas. Si elle ne s'en souvient plus, "
      + recours
  }
  return `${adresse} a rejoint l'équipe, mais la réponse ne dit pas si cette adresse avait déjà un compte : le mot de `
    + "passe saisi n'est peut-être pas le sien. S'il ne lui ouvre pas de session, " + recours
}

// ── LE RATTACHEMENT D'UN COMPTE QUE CE CABINET NE CONNAÎT PAS, OU PLUS (23-Q2) ──────────────────────────────────────────
// Décision du cabinet du 18/10/2026, à la question « un compte existant que le cabinet ne connaît pas, ou plus, doit-il
// pouvoir recevoir un accès créé depuis l'onglet Accès ? » : « rattacher après une confirmation qui nomme l'adresse et ce
// qu'elle ouvre ». Le cas qui compte : rendre un accès à un client dont on a retiré le dernier accès. Le risque : ouvrir
// le dossier à une adresse mal tapée, ou à la personne d'un autre cabinet, qui le verrait aussitôt avec son propre mot de
// passe — d'où la confirmation, qui nomme l'adresse telle qu'elle partira, le dossier, et ce que l'accès ouvre.
//
// `create-client-access` refuse le premier appel comme avant (409) et n'en dit pas plus ; son corps porte seulement le
// marqueur `rattachementAConfirmer: true`, qu'aucun texte n'a à analyser. L'onglet ouvre alors la confirmation ; confirmé,
// le second appel porte `rattachementConfirme: true` — le booléen, et lui seul —, avec l'adresse et le mot de passe du
// premier : la fonction exige le mot de passe, qui ne servirait qu'à un compte disparu entre-temps (créé alors, et
// l'avis le dirait). Un compte qui sert à l'équipe d'un cabinet ou à l'administration de l'application ne se rattache pas,
// même confirmé : la fonction le refuse, sans marqueur, et l'onglet le dit comme tout refus.

/** Le champ du corps qui confirme le rattachement : la fonction n'y lit que le booléen `true`. */
export const CHAMP_DE_LA_CONFIRMATION = 'rattachementConfirme'

/** Le marqueur du refus d'un compte que ce cabinet ne connaît pas : une confirmation est possible. */
export const MARQUEUR_DU_RATTACHEMENT = 'rattachementAConfirmer'

/** Le corps d'un appel de `create-client-access` : la confirmation n'y figure qu'au second appel, et y vaut `true`. */
export function corpsDeLaCreation(dossierId: string, email: string, password: string, confirme: boolean): Record<string, unknown> {
  return confirme ? { dossierId, email, password, [CHAMP_DE_LA_CONFIRMATION]: true } : { dossierId, email, password }
}

/** Le corps d'un refus porte-t-il ce marqueur ? Seul le booléen `true`, sur un objet, le porte. */
function porteLeMarqueur(corps: unknown, marqueur: string): boolean {
  if (corps === null || typeof corps !== 'object' || Array.isArray(corps)) return false
  return (corps as Record<string, unknown>)[marqueur] === true
}

/** Le corps d'un refus dit-il qu'une confirmation est possible ? Seul le booléen `true`, sur un objet, le dit. */
export function rattachementAConfirmer(corps: unknown): boolean {
  return porteLeMarqueur(corps, MARQUEUR_DU_RATTACHEMENT)
}

/**
 * Une COPIE du corps d'un refus de la fonction, prise AVANT `extraireErreurFonction`, qui lit l'original : le corps d'une
 * réponse ne se lit qu'une fois (le patron de `lib/receptionPlateforme.ts`). Rien à copier hors d'une réponse intacte.
 */
export function copieDuRefus(erreur: unknown): Response | null {
  const contexte = erreur !== null && typeof erreur === 'object' ? (erreur as { context?: unknown }).context : undefined
  return contexte instanceof Response && !contexte.bodyUsed ? contexte.clone() : null
}

/** La copie d'un refus porte-t-elle ce marqueur ? Absente, illisible ou d'une autre forme, elle ne le porte pas. */
async function copiePorteLeMarqueur(copie: Response | null, marqueur: string): Promise<boolean> {
  if (copie === null) return false
  try {
    return porteLeMarqueur(await copie.json(), marqueur)
  } catch {
    // Un corps qui n'est pas du JSON (un délai de la plateforme Supabase) ne porte aucun marqueur.
    return false
  }
}

/** La copie porte-t-elle le marqueur du rattachement ? Absente, illisible ou d'une autre forme, elle ne le porte pas. */
export async function refusARattacher(copie: Response | null): Promise<boolean> {
  return copiePorteLeMarqueur(copie, MARQUEUR_DU_RATTACHEMENT)
}

export interface ConfirmationDuRattachement {
  titre: string
  /** La phrase qui nomme l'adresse, en trois morceaux : l'écran met l'adresse dans `.courriel`, qui ne la coupe pas. */
  adresse: { avant: string; adresse: string; apres: string }
  paragraphes: readonly string[]
  bouton: string
}

/**
 * Ce que dit la fenêtre de confirmation, avec l'adresse TELLE QU'ELLE PARTIRA (celle du premier appel, que le second
 * renvoie) et le nom du dossier. Ce que l'accès ouvre est la phrase de l'onglet (`CE_QUE_DONNE_UN_ACCES`, à l'état de son
 * drapeau), jamais une règle recopiée ; un accès neuf arrive sans ses deux cases, que la phrase nomme par leur libellé.
 */
export function confirmationDuRattachement(adresse: string, dossierNom: string): ConfirmationDuRattachement {
  const cases = DOMAINES.map((d) => `« ${d.libelle} »`).join(' et ')
  return {
    titre: 'Rattacher ce compte au dossier ?',
    adresse: {
      avant: "L'adresse ",
      adresse,
      apres: " a déjà un compte, que ce cabinet ne connaît pas, ou plus : il n'est rattaché à aucun de ses dossiers ni à "
        + `son équipe. Vérifie que c'est bien celle de ton client : rattaché, ce compte ouvre aussitôt le dossier « ${dossierNom} » `
        + 'à la personne qui le tient, avec son propre mot de passe.',
    },
    paragraphes: [
      CE_QUE_DONNE_UN_ACCES,
      `L'accès arrive sans les cases ${cases} : tu les coches ensuite dans la liste des accès, si besoin.`,
      "Le mot de passe initial que tu as saisi ne sert pas : ce compte garde le sien, et rien n'y est changé. Si ton client "
        + `ne s'en souvient plus, envoie-lui un lien depuis la liste des accès (${BOUTON_DU_LIEN}).`,
    ],
    bouton: 'Rattacher ce compte',
  }
}

// ── L'ENTRÉE DANS L'ÉQUIPE D'UN CLIENT DE CE CABINET (23Q2Q2-Q1) ────────────────────────────────────────────────────────
// Décision du cabinet du 26/10/2026, à la recommandation : « le confirmer, en nommant l'adresse, le rôle et ce qu'il
// perd ». AuthContext range du côté du cabinet tout compte qui a une ligne d'équipe, avant de lire ses accès : entré dans
// l'équipe, le client d'un dossier de ce cabinet perdait son espace client sans que rien ne le dise, et une adresse mal
// tapée suffisait — choisi « Comptable en chef », il voyait tous les dossiers du cabinet. `create-team-member` refuse le
// premier appel en 409, avec le seul marqueur `entreeAConfirmer: true` ; la page de l'équipe ouvre alors sa
// confirmation ; confirmé, le second appel porte `entreeConfirmee: true` — le booléen, et lui seul —, avec l'adresse, le
// mot de passe et le rôle du premier. Le patron de 23-Q2, plus haut : `copieDuRefus` vaut pour les deux.

/** Le champ du corps qui confirme l'entrée dans l'équipe : la fonction n'y lit que le booléen `true`. */
export const CHAMP_DE_L_ENTREE = 'entreeConfirmee'

/** Le marqueur du refus d'un client de ce cabinet : son entrée dans l'équipe attend une confirmation. */
export const MARQUEUR_DE_L_ENTREE = 'entreeAConfirmer'

/** Le corps d'un appel de `create-team-member` : la confirmation n'y figure qu'au second appel, et y vaut `true`. */
export function corpsDuMembre(email: string, password: string, role: RoleCabinetAdmin, confirme: boolean): Record<string, unknown> {
  return confirme ? { email, password, role, [CHAMP_DE_L_ENTREE]: true } : { email, password, role }
}

/** Le corps d'un refus dit-il que l'entrée attend une confirmation ? Seul le booléen `true`, sur un objet, le dit. */
export function entreeAConfirmer(corps: unknown): boolean {
  return porteLeMarqueur(corps, MARQUEUR_DE_L_ENTREE)
}

/** La copie porte-t-elle le marqueur de l'entrée ? Absente, illisible ou d'une autre forme, elle ne le porte pas. */
export async function refusAConfirmerLEntree(copie: Response | null): Promise<boolean> {
  return copiePorteLeMarqueur(copie, MARQUEUR_DE_L_ENTREE)
}

/** Le nom d'un rôle de l'équipe, tel que la page le montre. */
export const LIBELLE_DU_ROLE: Readonly<Record<RoleCabinetAdmin, string>> = {
  comptable_en_chef: 'Comptable en chef',
  comptable: 'Comptable',
}

// Ce qu'un rôle ouvre, lu dans la base : `admin_du_dossier` ouvre au chef du cabinet tous ses dossiers, et
// `est_chef_du_cabinet` son équipe ; à un comptable, les dossiers qui lui sont assignés (migration `hierarchie_comptables`).
// « verra », jamais « ne verra que » : la liste des dossiers lui montre AUSSI ceux dont elle reste cliente — `dossiers_select`
// lit ses accès, et `lib/listeDossiers.ts` ne filtre pas sur le cabinet — avec ses seuls droits de cliente (23Q2Q2Q1-Q1).
const CE_QUE_DONNE_LE_ROLE: Readonly<Record<RoleCabinetAdmin, string>> = {
  comptable_en_chef: 'elle verra et tiendra tous les dossiers du cabinet, et gérera son équipe',
  comptable: 'elle verra les dossiers que tu lui assignes',
}

/**
 * Ce que perd le client qui entre dans l'équipe, vérifié dans le code : AuthContext ne lit plus ses accès dès qu'il a une
 * ligne d'équipe, et l'application ne monte plus les écrans du client (App.tsx) ni leur navigation (Layout.tsx). AuthContext
 * ne relit les rôles qu'au changement d'identifiant — une ouverture de l'application, une connexion —, jamais sous une
 * session ouverte : d'où « dès qu'elle rouvrira l'application », et non « tout de suite ».
 */
export const CE_QUE_PERD_LE_CLIENT = "Dès qu'elle rouvrira l'application, ce compte n'ouvrira plus que l'espace du cabinet : "
  + "la personne perd son espace client — l'accueil, « Mes pièces » (le dépôt de ses pièces et de ses documents, ses "
  + "réponses à tes précisions), « Mes informations », « Ma simulation » et, selon les cases de ses accès, « Mes ventes » et "
  + '« Ma banque » —, pour chacune de ses sociétés.'

/** Ce qui reste : ses accès, en base, que l'application lui rouvre dès qu'il n'a plus de ligne d'équipe. */
export const CE_QUI_RESTE_AU_CLIENT = "Ses accès restent dans l'onglet Accès de ses dossiers : la retirer de l'équipe "
  + "(« Retirer ») lui rend son espace client, dès qu'elle rouvre l'application."

export interface ConfirmationDeLEntree {
  titre: string
  /** La phrase qui nomme l'adresse, en trois morceaux : l'écran met l'adresse dans `.courriel`, qui ne la coupe pas. */
  adresse: { avant: string; adresse: string; apres: string }
  paragraphes: readonly string[]
  bouton: string
}

/**
 * Ce que dit la fenêtre de confirmation, avec l'adresse et le rôle TELS QU'ILS PARTIRONT (ceux du premier appel, que le
 * second renvoie) : qui entre, comme quoi, et ce que la personne y perd.
 */
export function confirmationDeLEntree(adresse: string, role: RoleCabinetAdmin): ConfirmationDeLEntree {
  return {
    titre: "Faire entrer ce client dans l'équipe ?",
    adresse: {
      avant: "L'adresse ",
      adresse,
      apres: " est celle d'un client d'un dossier de ce cabinet. Vérifie que c'est bien celle de la personne que tu veux "
        + `faire entrer dans l'équipe : elle y entrera comme « ${LIBELLE_DU_ROLE[role]} », et ${CE_QUE_DONNE_LE_ROLE[role]}.`,
    },
    paragraphes: [
      CE_QUE_PERD_LE_CLIENT,
      CE_QUI_RESTE_AU_CLIENT,
      "Le mot de passe que tu as saisi ne sert pas : ce compte garde le sien, et rien n'y est changé. Si elle ne s'en "
        + "souvient plus, « Mot de passe oublié », sur l'écran de connexion, lui envoie un lien pour en choisir un autre.",
    ],
    bouton: "Faire entrer dans l'équipe",
  }
}
