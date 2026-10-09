import type { FluxEcartes, IssueImport, PlanReception, SaisieConnexion } from './receptionPlateforme'

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

// La phrase accordée à son nombre : en français le pluriel commence à deux (« 1 facture », « 2 factures »), et une
// phrase au singulier change aussi son pronom (« elle ne revient pas »). « Importer les 1 facture(s) » ne se lit pas.
function accord(n: number, singulier: string, pluriel: string): string {
  return n >= 2 ? pluriel : singulier
}

// `doublons` compte les RÉPÉTITIONS d'une même facture dans la liste (la deuxième et les suivantes), pas les factures.
const LIBELLES_ECARTS: Record<keyof FluxEcartes, (n: number) => string> = {
  autre_flux: (n) => accord(n, `${n} message écarté : ce n’est pas une facture (statut de cycle de vie, e-reporting)`,
    `${n} messages écartés : ce ne sont pas des factures (statuts de cycle de vie, e-reporting)`),
  illisible: (n) => `${n} ${accord(n, 'facture écartée', 'factures écartées')} : sans identifiant ou sans date de mise à jour lisible`,
  format: (n) => `${n} ${accord(n, 'facture écartée', 'factures écartées')} : dans un format que l’application ne lit pas`,
  statut_inconnu: (n) => accord(n, `${n} facture écartée : la plateforme ne dit pas si elle est prête`,
    `${n} factures écartées : la plateforme ne dit pas si elles sont prêtes`),
  doublons: (n) => accord(n, `${n} doublon écarté : une facture que la plateforme a listée deux fois`,
    `${n} doublons écartés : des factures que la plateforme a listées plus d’une fois`),
}

/** Les écarts de la liste, en phrases — vide quand rien n'a été écarté. */
export function ecartsEnPhrases(ecartes: FluxEcartes): string[] {
  return (Object.keys(LIBELLES_ECARTS) as (keyof FluxEcartes)[])
    .filter((cle) => ecartes[cle] > 0)
    .map((cle) => LIBELLES_ECARTS[cle](ecartes[cle]))
}

/** Le titre du plan d'import. */
export function titreDuPlan(aImporter: number): string {
  return aImporter === 0 ? 'Aucune nouvelle facture à importer' : `${aImporter} ${accord(aImporter, 'facture', 'factures')} à importer`
}

/** Le bouton qui lance l'import (il n'existe que s'il y a au moins une facture à importer). */
export function libelleImporter(aImporter: number): string {
  return accord(aImporter, 'Importer la facture', `Importer les ${aImporter} factures`)
}

/** Ce que la recherche a vu sans le proposer à l'import, une phrase par cas — vide quand rien n'est à dire. */
export function phrasesDuPlan(plan: PlanReception): string[] {
  const d = plan.dejaImportes.length, a = plan.enAttente.length, r = plan.rejetes.length
  const phrases: string[] = []
  if (d > 0) phrases.push(accord(d, `${d} déjà importée : elle ne revient pas.`, `${d} déjà importées : elles ne reviennent pas.`))
  if (a > 0) {
    phrases.push(accord(a, `${a} encore en traitement chez la plateforme : elle reviendra à une prochaine recherche.`,
      `${a} encore en traitement chez la plateforme : elles reviendront à une prochaine recherche.`))
  }
  if (r > 0) phrases.push(accord(r, `${r} rejetée par la plateforme : elle ne s’importe pas.`, `${r} rejetées par la plateforme : elles ne s’importent pas.`))
  return phrases
}

/**
 * Le bilan d'un import en phrases, une par issue comptée. L'interruption n'y est pas : l'écran la dit à part, avec
 * sa raison.
 */
export function phrasesDuBilan(compte: Record<IssueImport['statut'], number>): string[] {
  const phrases = [compte.importee === 0
    ? 'Aucune facture importée.'
    : accord(compte.importee, `${compte.importee} facture importée, « à valider » dans Justificatifs.`,
      `${compte.importee} factures importées, « à valider » dans Justificatifs.`)]
  if (compte.deja_importee > 0) phrases.push(`${compte.deja_importee} déjà dans le dossier.`)
  if (compte.doublon > 0) {
    phrases.push(accord(compte.doublon, `${compte.doublon} dont le fichier est déjà au dossier (déposé autrement) : non importée.`,
      `${compte.doublon} dont le fichier est déjà au dossier (déposé autrement) : non importées.`))
  }
  if (compte.autre_entreprise > 0) {
    phrases.push(accord(compte.autre_entreprise, `${compte.autre_entreprise} adressée à une autre entreprise : non importée.`,
      `${compte.autre_entreprise} adressées à une autre entreprise : non importées.`))
  }
  if (compte.echec > 0) phrases.push(`${compte.echec} en échec.`)
  return phrases
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
      // Les remarques que la note interne de la pièce n'a pas pu garder : dites ici pour la dernière fois, et dites
      // comme telles — la fiche de la pièce ne les montrera pas.
      return issue.noteNonGardee
        ? `importée — à vérifier : ${issue.avertissements.join(' ')} Ces remarques ne sont PAS dans sa note interne `
          + `(${issue.noteNonGardee}) : reportez-les dans sa fiche avant de la valider.`
        : `importée — à vérifier : ${issue.avertissements.join(' ')}`
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
