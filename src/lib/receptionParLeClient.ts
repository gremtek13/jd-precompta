import type { FluxVu, ReponsePlateforme } from './receptionPlateforme'

// « RELEVER MA PLATEFORME » : LA RÉCEPTION DES FACTURES D'ACHAT PAR L'ACCÈS « ACHATS » (espace client, ligne 51.5, étape B4r ;
// B4-Q1 à B4-Q3, tranchées par le cabinet le 11/11/2026 à la recommandation). Le module pur de l'écran : ce que la fonction
// `plateforme-agreee` rend (`lister_achats`, `recevoir_achat`), la relève facture par facture, son bilan et ses mots. Les
// appels lui sont DONNÉS (`AppelsDeLaReleve`) : il ne connaît pas le client Supabase, et se teste seul.
//
// CE QUE FAIT LE SERVEUR, PAS L'ÉCRAN : il ne rend que les factures d'achat (B4-Q2), vérifie que chacune désigne la société
// comme acheteur, et ÉCRIT LA PIÈCE lui-même, « à valider », sans montants (B4-Q1) — le navigateur du client n'écrit rien. Le
// point de reprise du cabinet n'est ni lu ni écrit (B4-Q3) : la relève part du début, ou du `jusqua` de la page d'avant au
// cours de la même relève ; ce qui empêche une facture d'entrer deux fois est son flux, que le serveur cherche en base avant de
// la télécharger, puis la contrainte de la table — une facture déjà là coûte une ligne de la liste, jamais un téléchargement.

/** Une facture d'achat que la plateforme rend, et si elle est déjà au dossier (son flux, lu en base par le serveur). */
export interface FluxAchat extends FluxVu {
  deja_recue: boolean
}

export interface ListeDesAchats {
  hote: string
  version: string
  depuis: string | null
  flux: FluxAchat[]
  ecartes: { illisible: number; format: number; statut_inconnu: number; doublons: number }
  complete: boolean
  motif: string | null
  jusqua: string | null
}

/** Ce qu'une facture est devenue chez le serveur, sur un appel qui a abouti. */
export type IssueRecue = 'recue' | 'deja_recue' | 'doublon' | 'autre_entreprise' | 'au_cabinet'
const ISSUES: readonly IssueRecue[] = ['recue', 'deja_recue', 'doublon', 'autre_entreprise', 'au_cabinet']

export interface ReponseReception {
  hote: string
  flowId: string
  issue: IssueRecue
  raison?: string
  piece_id?: string
  sans_lisible?: boolean
}

export interface AppelsDeLaReleve {
  lister: (depuis: string | null) => Promise<ReponsePlateforme<ListeDesAchats>>
  recevoir: (version: string, flowId: string) => Promise<ReponsePlateforme<ReponseReception>>
}

export interface BilanDeLaReleve {
  recues: number
  sansLisible: number
  dejaLa: number
  doublons: number
  auCabinet: number
  autreEntreprise: number
  enAttente: number
  rejetees: number
  ecartees: number
  /** Une phrase par facture qui n'a pas pu être reçue cette fois : elle reviendra à la relève suivante. */
  echecs: string[]
  /** Pourquoi la relève s'est arrêtée avant la fin (une liste refusée, la connexion changée, l'accès refusé). */
  interruption: string | null
  /** La plateforme a tout rendu : rien ne reste à lire. */
  complete: boolean
  /** Pourquoi la plateforme n'a pas tout rendu, quand la relève n'est pas allée au bout. */
  motif: string | null
}

export const TOURS_PAR_RELEVE = 20

const BILAN_VIDE = (): BilanDeLaReleve => ({
  recues: 0, sansLisible: 0, dejaLa: 0, doublons: 0, auCabinet: 0, autreEntreprise: 0, enAttente: 0, rejetees: 0, ecartees: 0,
  echecs: [], interruption: null, complete: false, motif: null,
})

/** Le refus d'un appel, dit au client : la raison que le serveur a nommée, sinon sa phrase. */
export function refusDitAuClient(erreur: string, raison: string | null): string {
  if (raison === 'sans_plateforme') return 'Ta société n’a pas de plateforme reliée chez ton cabinet : demande-lui de la relier.'
  if (raison === 'superpdp') {
    return 'Tes factures reçues arrivent déjà chez ton cabinet par Super PDP : relever ta plateforme les ferait entrer deux fois.'
  }
  if (raison === 'sans_siret') {
    return 'Le SIRET de ta société manque chez ton cabinet : sans lui, rien ne vérifierait qu’une facture t’est adressée.'
  }
  if (erreur === 'Dossier introuvable.') return 'Ta case « Achats » ne t’ouvre pas la relève de ta plateforme : parles-en à ton cabinet.'
  return `Ta plateforme n’a pas pu être relevée : ${erreur}`
}

/** La réponse du serveur est-elle celle de la facture demandée, chez la plateforme qui l'a listée ? */
function reponseDeLaFacture(r: ReponseReception, hote: string, flux: FluxAchat): boolean {
  return r !== null && typeof r === 'object' && r.hote === hote && r.flowId === flux.id && ISSUES.includes(r.issue)
}

/**
 * La relève, page à page et facture par facture. Une facture déjà là, en attente ou rejetée ne coûte aucun appel ; une
 * facture prête part au serveur, qui la reçoit ou dit pourquoi. La connexion changée, l'identité refusée ou une liste refusée
 * arrêtent tout et se disent ; un échec passager d'une facture se compte, et la relève continue.
 */
export async function releverMaPlateforme(
  appels: AppelsDeLaReleve,
  surProgres?: (faites: number) => void,
  tours: number = TOURS_PAR_RELEVE,
): Promise<BilanDeLaReleve> {
  const bilan = BILAN_VIDE()
  let depuis: string | null = null
  let faites = 0
  for (let tour = 0; tour < tours; tour++) {
    const liste = await appels.lister(depuis)
    if (liste.erreur !== null) {
      bilan.interruption = refusDitAuClient(liste.erreur, liste.drapeaux.raison)
      return bilan
    }
    const { hote, version } = liste.donnees
    bilan.ecartees += liste.donnees.ecartes.illisible + liste.donnees.ecartes.format + liste.donnees.ecartes.statut_inconnu
    for (const flux of liste.donnees.flux) {
      if (flux.deja_recue) { bilan.dejaLa++; continue }
      if (flux.etat === 'en_attente') { bilan.enAttente++; continue }
      if (flux.etat === 'en_erreur') { bilan.rejetees++; continue }
      const r = await appels.recevoir(version, flux.id)
      faites++
      surProgres?.(faites)
      if (r.erreur !== null) {
        if (r.drapeaux.perimee) {
          bilan.interruption = 'La connexion à ta plateforme a changé pendant la relève : relève-la de nouveau.'
          return bilan
        }
        if (r.drapeaux.acces_refuse || r.drapeaux.identifiants_refuses) {
          bilan.interruption = refusDitAuClient(r.erreur, r.drapeaux.raison)
          return bilan
        }
        if (r.drapeaux.raison === 'en_attente') bilan.enAttente++
        else if (r.drapeaux.raison === 'en_erreur') bilan.rejetees++
        else bilan.echecs.push(`« ${flux.nom ?? 'Facture sans nom'} » : ${r.erreur}`)
        continue
      }
      if (!reponseDeLaFacture(r.donnees, hote, flux)) {
        bilan.echecs.push(`« ${flux.nom ?? 'Facture sans nom'} » : la réponse ne correspond pas à la facture demandée.`)
        continue
      }
      const issue = r.donnees.issue
      if (issue === 'recue') {
        bilan.recues++
        if (r.donnees.sans_lisible === true) bilan.sansLisible++
      } else if (issue === 'deja_recue') bilan.dejaLa++
      else if (issue === 'doublon') bilan.doublons++
      else if (issue === 'autre_entreprise') bilan.autreEntreprise++
      else bilan.auCabinet++
    }
    if (liste.donnees.complete) {
      bilan.complete = true
      return bilan
    }
    // La suite au cours de la même relève : le point que la page rend possible, jamais gardé ; sans lui, ou s'il n'avance
    // plus, la relève s'arrête et dit pourquoi.
    const suite = liste.donnees.jusqua
    if (suite === null || suite === depuis) {
      bilan.motif = liste.donnees.motif
      return bilan
    }
    depuis = suite
  }
  bilan.motif = 'la relève s’arrête après un grand nombre de pages : relève de nouveau pour la suite'
  return bilan
}

const accord = (n: number, un: string, plusieurs: string) => `${n} ${n === 1 ? un : plusieurs}`

/** Le bilan en phrases, pour le client : une par ce qui s'est passé, rien pour ce qui n'est pas arrivé. */
export function phrasesDuBilan(b: BilanDeLaReleve): string[] {
  const p: string[] = []
  if (b.recues > 0) {
    p.push(`${accord(b.recues, 'facture reçue', 'factures reçues')} : ${b.recues === 1 ? 'elle arrive' : 'elles arrivent'} chez ton cabinet, à valider.` +
      (b.sansLisible > 0 ? ` ${accord(b.sansLisible, 'n’a pas', 'n’ont pas')} de version lisible : ton cabinet lira l’original.` : ''))
  }
  if (b.dejaLa > 0) p.push(`${accord(b.dejaLa, 'facture était déjà là', 'factures étaient déjà là')} : rien ne revient deux fois.`)
  if (b.doublons > 0) p.push(`${accord(b.doublons, 'facture avait déjà été déposée', 'factures avaient déjà été déposées')} à la main : elle${b.doublons === 1 ? '' : 's'} ne revien${b.doublons === 1 ? 't' : 'nent'} pas.`)
  if (b.auCabinet > 0) {
    p.push(`${accord(b.auCabinet, 'facture attend', 'factures attendent')} ton cabinet : la relève ne sait pas vérifier qu’elle${b.auCabinet === 1 ? ' t’est adressée' : 's te sont adressées'}.`)
  }
  if (b.autreEntreprise > 0) {
    p.push(`${accord(b.autreEntreprise, 'facture ne désigne', 'factures ne désignent')} pas ta société comme acheteur : elle${b.autreEntreprise === 1 ? ' n’est pas reçue' : 's ne sont pas reçues'}, et ton cabinet vérifiera ta plateforme.`)
  }
  if (b.enAttente > 0) p.push(`${accord(b.enAttente, 'facture est', 'factures sont')} encore en traitement chez ta plateforme : elle${b.enAttente === 1 ? ' viendra' : 's viendront'} à une prochaine relève.`)
  if (b.rejetees > 0) p.push(`${accord(b.rejetees, 'facture a été rejetée', 'factures ont été rejetées')} par ta plateforme.`)
  if (b.ecartees > 0) p.push(`${accord(b.ecartees, 'facture rendue', 'factures rendues')} sous une forme illisible ou inconnue : ton cabinet les verra par sa propre réception.`)
  if (b.echecs.length > 0) p.push(`${accord(b.echecs.length, 'facture n’a pas pu être reçue', 'factures n’ont pas pu être reçues')} cette fois ; elle${b.echecs.length === 1 ? ' reviendra' : 's reviendront'} à la relève suivante.`)
  if (p.length === 0 && b.interruption === null) p.push('Ta plateforme n’a aucune facture d’achat à recevoir.')
  if (!b.complete && b.interruption === null && b.motif !== null) p.push(`La relève n’est pas allée au bout : ${b.motif}.`)
  return p
}
