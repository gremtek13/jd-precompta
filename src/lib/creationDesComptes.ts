// CE QUE L'ÉCRAN DIT APRÈS LA CRÉATION D'UN ACCÈS CLIENT OU D'UN MEMBRE DE L'ÉQUIPE (décision du cabinet du 10/10/2026).
//
// `create-client-access` et `create-team-member` ne touchent JAMAIS au mot de passe d'un compte qui existe déjà : ils le
// reprennent tel qu'il est (s'il est déjà lié au cabinet ; sinon ils refusent en 409, comme avant), et disent lequel des
// deux cas s'est produit — `compte: "cree"` : le mot de passe saisi est celui du compte, le cabinet le communique ;
// `compte: "existant"` : il n'a pas servi, et le communiquer ferait chercher au titulaire un mot de passe qui n'ouvre rien.
// Le titulaire change le sien lui-même : « Mot de passe oublié » sur l'écran de connexion, ou, pour un client, le lien
// que le cabinet lui envoie depuis l'onglet Accès. Aucun appel ici : les écrans appellent, ce module décide de ce qui se
// dit (comme `recuperationMotDePasse.ts`).

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
