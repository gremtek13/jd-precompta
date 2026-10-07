import type { FluxEcartes, IssueImport, SaisieConnexion } from './receptionPlateforme'

// CE QUE LA FENÊTRE « PLATEFORME DU CLIENT » DIT (pages/dossier/PlateformeClientModal.tsx), à part de l'écran pour se
// tester sans lui : ce qu'une saisie a de faux avant le clic, les écarts d'une recherche et le bilan d'un import, en
// phrases. Aucun appel ici — les types seuls viennent du module de la réception.

// Le préréglage de Super PDP, la plateforme partenaire du cabinet : ses adresses pour le service des flux et pour les
// jetons. Un préremplissage, pas une valeur imposée : chaque plateforme donne les siennes au client.
export const PRESET_SUPER_PDP = {
  nom: 'Super PDP',
  url_flux: 'https://api.superpdp.tech/afnor-flow',
  url_jeton: 'https://api.superpdp.tech/oauth2/token',
}

export const SAISIE_VIDE: SaisieConnexion = {
  nom: '', url_flux: '', url_jeton: '', client_id: '', client_secret: '', organisation_id: '', portee: '',
}

/**
 * Ce que la fonction refuserait d'une saisie, dit avant le clic — seulement ce qui est FAUX, jamais ce qui manque
 * encore : un formulaire qu'on commence à remplir demande, il ne crie pas. Les règles complètes vivent dans la
 * fonction (`saisieDeConnexion`), qui les redit en français si une autre lui échappait ici.
 */
export function refusSaisie(saisie: SaisieConnexion): string | null {
  if (saisie.nom.trim().length > 80) return 'Le nom de la plateforme tient en 80 caractères au plus.'
  for (const [valeur, libelle] of [[saisie.url_flux, 'L’adresse du service des flux'], [saisie.url_jeton, 'L’adresse des jetons']]) {
    const v = valeur.trim()
    if (v !== '' && !/^https:\/\//i.test(v)) return `${libelle} doit commencer par https:// — la fonction y envoie un secret.`
  }
  if (saisie.organisation_id.trim() !== '' && !/^[!-~]{1,200}$/.test(saisie.organisation_id.trim())) {
    return 'L’organisation s’écrit sans espace ni accent : c’est une valeur d’en-tête.'
  }
  return null
}

/** La saisie est-elle complète ? Le secret n'est exigé qu'à la création : à la modification, vide, il est gardé. */
export function saisieComplete(saisie: SaisieConnexion, creation: boolean): boolean {
  return saisie.nom.trim() !== '' && saisie.url_flux.trim() !== '' && saisie.url_jeton.trim() !== '' &&
    saisie.client_id.trim() !== '' && (!creation || saisie.client_secret.trim() !== '')
}

const LIBELLES_ECARTS: Record<keyof FluxEcartes, (n: number) => string> = {
  autre_flux: (n) => `${n} message(s) qui ne sont pas des factures (statuts de cycle de vie, e-reporting)`,
  illisible: (n) => `${n} facture(s) sans identifiant ou sans date de mise à jour lisible`,
  format: (n) => `${n} facture(s) dans un format que l’application ne lit pas`,
  statut_inconnu: (n) => `${n} facture(s) dont la plateforme ne dit pas si elle est prête`,
  doublons: (n) => `${n} facture(s) listée(s) deux fois par la plateforme`,
}

/** Les écarts de la liste, en phrases — vide quand rien n'a été écarté. */
export function ecartsEnPhrases(ecartes: FluxEcartes): string[] {
  return (Object.keys(LIBELLES_ECARTS) as (keyof FluxEcartes)[])
    .filter((cle) => ecartes[cle] > 0)
    .map((cle) => LIBELLES_ECARTS[cle](ecartes[cle]))
}

/** Le bilan d'un import, compté par issue. */
export function compteDesIssues(issues: IssueImport[]): Record<IssueImport['statut'], number> {
  const compte = { importee: 0, deja_importee: 0, doublon: 0, autre_entreprise: 0, echec: 0, interrompu: 0 }
  for (const i of issues) compte[i.statut]++
  return compte
}

/** Ce qu'il faut savoir d'une facture que l'import n'a pas importée telle quelle. */
export function phraseDeLIssue(issue: IssueImport): string {
  switch (issue.statut) {
    case 'importee':
      return `importée — à vérifier : ${issue.avertissements.join(' ')}`
    case 'deja_importee':
      return 'déjà dans le dossier.'
    case 'doublon':
      return 'son fichier est déjà au dossier : rien n’est importé une seconde fois.'
    case 'autre_entreprise':
      return `adressée à l’entreprise de SIREN ${issue.siren}, pas à ce dossier : elle n’est pas importée. Si le SIRET du dossier `
        + 'était faux, corrigez-le puis reprenez la recherche du début.'
    case 'echec':
      return issue.definitif ? `${issue.message} Elle ne s’importera pas telle quelle.` : `${issue.message} Elle reviendra à la prochaine recherche.`
    case 'interrompu':
      return issue.message
  }
}
