// LE DOSSIER DU CABINET (ligne 47, lot LM1 ; LM-Q1 et LM-Q2 du 11/11/2026). Un cabinet DÉSIGNE l'un de ses dossiers comme
// le sien (`cabinets.dossier_du_cabinet`) : il y facture ses honoraires en son propre nom — aucun mandataire figé, la série
// du dossier, jamais celle du mandataire —, aucun accès client ne s'y pose, et il ne se supprime que par le chef de son
// cabinet, ses factures avec lui (LM1-Q1 (B)). La base
// tient la règle (la migration `dossier_du_cabinet`, PRÉPARÉE le 11/11/2026, supabase/preparees/) ; ce module la redit,
// pur, pour la dire avant le clic à l'écran de LM2 : les refus de `designer_dossier_du_cabinet` dans son ordre et à ses
// mots, ceux des deux gardes, et le prédicat du mandataire. Rien ne s'en lit tant que le drapeau est baissé.
// Récit : HISTORIQUE.md, « 11/11/2026 — LM1 ».

/** Levé le jour où la migration `dossier_du_cabinet` est en production (son fichier dans supabase/schema/). */
export const DOSSIER_DU_CABINET_PREVU: boolean = false

/** Les refus de `designer_dossier_du_cabinet`, dans l'ordre de la fonction, à ses mots et à son code. */
export const REFUS_DE_LA_DESIGNATION = [
  { cle: 'acces', code: '42501', modele: 'Accès refusé à ce cabinet.' },
  { cle: 'cabinet', code: 'P0002', modele: 'Cabinet introuvable.' },
  { cle: 'horsDuCabinet', code: 'P0002', modele: 'Ce dossier n’est pas un dossier de ce cabinet.' },
  { cle: 'irreversible', code: '23514', modele: 'Le dossier du cabinet porte déjà une facture validée : sa désignation ne change plus.' },
  {
    cle: 'accesClient', code: '23514',
    modele: 'Ce dossier a un accès client : le dossier du cabinet n’en a aucun, ses honoraires y seraient lus. Retirer d’abord ses accès.',
  },
  {
    cle: 'mandataire', code: '23514',
    modele: 'Ce dossier porte une facture validée au nom et pour le compte d’un client : il ne devient pas le dossier du cabinet.',
  },
] as const

export type RefusDeLaDesignation = (typeof REFUS_DE_LA_DESIGNATION)[number]['cle']

/** La garde de `memberships`, celle d'un changement de cabinet et celle de la suppression d'un dossier (23514). */
export const REFUS_ACCES_CLIENT =
  'Le dossier du cabinet ne reçoit aucun accès client : il porte les honoraires de tous les clients du cabinet.'
export const REFUS_CHANGEMENT_DE_CABINET = 'Le dossier du cabinet ne change pas de cabinet.'
export const REFUS_SUPPRESSION =
  'Le dossier du cabinet ne se supprime que par le chef du cabinet : il porte les factures du cabinet, qui partent avec lui.'

/** Ce que l'écran sait avant le clic, lu en entier ; `null` : pas lu (le refus de la lecture se dit à part). */
export interface EtatDeLaDesignation {
  estChefDuCabinet: boolean
  /** Le cabinet dont on change la désignation. */
  cabinetId: string
  /** Le dossier désigné aujourd'hui, ou `null`. */
  dossierActuel: string | null
  /** Le dossier actuel porte une facture validée ou reprise (tout statut sauf « brouillon »). */
  actuelPorteUneFactureValidee: boolean
  /** Le dossier à désigner, ou `null` pour retirer la désignation. */
  dossierVise: string | null
  /** Le cabinet du dossier visé, tel que la base le dit. */
  cabinetDuDossierVise: string | null
  visePorteUnAccesClient: boolean
  /** Le dossier visé porte une facture validée au nom et pour le compte d'un client (`mandataire_nom` posé). */
  visePorteUneFactureEnMandataire: boolean
}

/**
 * Le refus que `designer_dossier_du_cabinet` opposerait, le premier dans l'ordre de la fonction, ou `null` (elle
 * accepte ; désigner le dossier déjà désigné ne change rien et n'est pas refusé). « Cabinet introuvable » ne se juge pas
 * ici : l'écran ne propose que le cabinet qu'il a lu.
 */
export function refusDeLaDesignation(e: EtatDeLaDesignation): RefusDeLaDesignation | null {
  if (!e.estChefDuCabinet) return 'acces'
  if (e.dossierVise !== null && e.cabinetDuDossierVise !== e.cabinetId) return 'horsDuCabinet'
  if (e.dossierActuel === e.dossierVise) return null
  if (e.dossierActuel !== null && e.actuelPorteUneFactureValidee) return 'irreversible'
  if (e.dossierVise !== null && e.visePorteUnAccesClient) return 'accesClient'
  if (e.dossierVise !== null && e.visePorteUneFactureEnMandataire) return 'mandataire'
  return null
}

/** Les mots d'un refus de la désignation. */
export function motsDuRefus(cle: RefusDeLaDesignation): string {
  return REFUS_DE_LA_DESIGNATION.find((r) => r.cle === cle)!.modele
}

/** Le dossier est-il celui que le cabinet a désigné ? Une désignation absente ou nulle : non. */
export function estLeDossierDuCabinet(dossierDuCabinet: string | null | undefined, dossierId: string): boolean {
  return typeof dossierDuCabinet === 'string' && dossierDuCabinet === dossierId
}

/**
 * Le prédicat qui pose `mandataire_nom` dans `enregistrer_facture` et choisit la série du mandataire dans
 * `numerotation_suivante` : le cabinet valide (`admin_du_dossier`) un dossier qui n'est pas le sien. La confirmation de
 * validation (P4) ne nomme le mandat que sous lui.
 */
export function valideAuNomDuClient(p: { valideParLeCabinet: boolean; estLeDossierDuCabinet: boolean }): boolean {
  return p.valideParLeCabinet && !p.estLeDossierDuCabinet
}

/**
 * Le refus de la suppression d'un dossier, à dire AVANT de vider son stockage (la base ne refuse la ligne qu'après). Le
 * dossier du cabinet se supprime par le chef de son cabinet, le super-administrateur compris (`est_chef_du_cabinet`) :
 * réponse du cabinet LM1-Q1 (B) du 11/11/2026, la confirmation nommant les factures qui partent avec lui.
 */
export function refusDeLaSuppression(p: { estLeDossierDuCabinet: boolean; chefDuCabinet: boolean }): string | null {
  return p.estLeDossierDuCabinet && !p.chefDuCabinet ? REFUS_SUPPRESSION : null
}

/** Une facture du dossier du cabinet qui partirait avec lui : tout statut sauf « brouillon » (validée, reprise, avoir). */
export interface FactureQuiPart {
  id: string
  numero: string | null
}

/** Leurs numéros, dans l'ordre (les chiffres comptés comme des nombres) ; un numéro absent se dit « sans numéro ». */
export function numerosQuiPartent(factures: readonly FactureQuiPart[]): string[] {
  return factures.map((f) => (f.numero == null || f.numero.trim() === '' ? 'sans numéro' : f.numero))
    .sort((a, b) => a.localeCompare(b, 'fr', { numeric: true }))
}

/**
 * Ce que la confirmation de la suppression du dossier du cabinet ajoute (LM1-Q1 (B)) : le NOMBRE des factures qui partent
 * avec lui et leurs NUMÉROS, tous, sur une liste lue en entier — la base ne confirme rien, l'écran nomme avant le clic.
 */
export function ceQuePerdLeDossierDuCabinet(factures: readonly FactureQuiPart[]): string {
  const n = factures.length
  if (n === 0) return ' C’est le dossier du cabinet : il ne porte aucune facture validée.'
  const numeros = numerosQuiPartent(factures).join(', ')
  return n === 1
    ? ` C’est le dossier du cabinet : sa facture validée part avec lui, la facture ${numeros}.`
    : ` C’est le dossier du cabinet : ses ${n} factures validées partent avec lui, les factures ${numeros}.`
}

/**
 * La suppression relit les factures du dossier du cabinet AVANT de vider le stockage : celles que la confirmation a nommées
 * (leurs identifiants) doivent être exactement celles que la base porte encore — une facture validée entre-temps n'aurait
 * pas été nommée. `nommees` nul : la confirmation n'a rien nommé.
 */
export function refusDesFacturesNommees(nommees: readonly string[] | null, lues: readonly FactureQuiPart[]): string | null {
  if (nommees === null) return 'La confirmation n’a pas nommé les factures du dossier du cabinet : rien n’a été supprimé.'
  const ensemble = new Set(nommees)
  if (ensemble.size !== lues.length || lues.some((f) => !ensemble.has(f.id))) {
    return 'Les factures du dossier du cabinet ont changé depuis la confirmation : rien n’a été supprimé. Relire avant de supprimer.'
  }
  return null
}

// ── L'ÉCRAN (LM2) ─────────────────────────────────────────────────────────────────────────────────────────────────────
// Ce que la liste des dossiers, le tableau de bord, les RIB à confirmer et la carte de l'onglet Informations disent du dossier
// du cabinet (lib/dossierDuCabinetLecture.ts lit). Rien ne se lit tant que le drapeau est baissé : la colonne n'existe pas, et
// la nommer ferait échouer la lecture.

/** Le titre de sa place à part, dans la barre latérale et sur le tableau de bord ; la mention qui le nomme ailleurs. */
export const TITRE_MON_CABINET = 'Mon cabinet'

/**
 * Les dossiers d'une liste, séparés : ceux des clients, et ceux qu'un cabinet a désignés comme le sien (un pour le chef ; le
 * super-administrateur voit ceux de tous les cabinets). L'ordre de la liste est gardé dans chaque partie.
 */
export function separerLeDossierDuCabinet<T extends { id: string }>(
  dossiers: readonly T[], designes: ReadonlySet<string>,
): { clients: T[]; duCabinet: T[] } {
  return { clients: dossiers.filter((d) => !designes.has(d.id)), duCabinet: dossiers.filter((d) => designes.has(d.id)) }
}

/** Ce que la carte de l'onglet Informations dit du dossier, selon la désignation lue. */
export function ceQueDitLaDesignation(p: { estLeDossierDuCabinet: boolean; unAutreEstDesigne: boolean; nomDeLAutre: string | null }): string {
  if (p.estLeDossierDuCabinet) {
    return 'C’est le dossier du cabinet : le cabinet y facture ses honoraires en son propre nom — aucune mention de mandat, '
      + 'la série de numérotation du dossier. Aucun accès client ne s’y pose, et il ne se supprime que par le chef du cabinet, '
      + 'ses factures avec lui.'
  }
  if (p.unAutreEstDesigne) {
    return p.nomDeLAutre !== null
      ? `Le dossier du cabinet est « ${p.nomDeLAutre} ». Celui-ci est un dossier client.`
      : 'Le cabinet a désigné un autre dossier comme le sien. Celui-ci est un dossier client.'
  }
  return 'Aucun dossier n’est désigné comme celui du cabinet. Le cabinet qui facture ses propres honoraires dans l’application '
    + 'les tient dans un dossier à lui, désigné ici : ses factures n’y portent pas la mention d’un mandat.'
}

/**
 * La confirmation de la désignation : elle NOMME le dossier (et celui qu'il remplace), dit ce que la désignation change, et
 * qu'elle devient irréversible dès une facture validée. Celle du retrait nomme le dossier et ce qu'il redevient.
 */
export function confirmationDeLaDesignation(p: { nom: string; retrait: boolean; remplace: string | null }): string {
  if (p.retrait) {
    return `Retirer la désignation de « ${p.nom} » comme dossier du cabinet ?\n\n`
      + 'Il redevient un dossier ordinaire : une facture qu’y validera le cabinet portera de nouveau la mention de son mandat, '
      + 'dans la série du mandataire.'
  }
  return `Désigner « ${p.nom} » comme le dossier du cabinet ?\n\n`
    + 'Le cabinet y facturera ses honoraires en son propre nom : aucune mention de mandat, la série de numérotation du dossier. '
    + 'Aucun accès client ne pourra s’y poser, et il ne se supprimera que par le chef du cabinet, ses factures avec lui.'
    + (p.remplace !== null ? `\n\nIl remplace « ${p.remplace} », qui redevient un dossier ordinaire.` : '')
    + '\n\nCette désignation devient irréversible dès que le dossier porte une facture validée.'
}

// ── LE FORMULAIRE D'ACCÈS DE L'ONGLET ACCÈS (ligne 47, LM2) ───────────────────────────────────────────────────────────────
// Le dossier du cabinet ne reçoit aucun accès client (la garde de `memberships`, et `create-client-access` en 409) : l'onglet
// Accès le dit AVANT le clic, aux mots de la garde, et n'offre ni le formulaire ni le lien de réinitialisation d'un accès qui
// n'existera pas. Ce module juge sur la désignation lue (la lecture de l'écran ne rejette jamais) ; l'écran applique le
// drapeau : baissé, rien ne se lit et le formulaire reste offert comme hier.

/** Ce que l'onglet sait de la désignation ; `null` : pas encore revenue. */
export type DesignationPourLesAcces =
  | { etat: 'lue'; dossierId: string; dossierActuel: string | null }
  | { etat: 'illisible'; dossierId: string; motif: string }
  | null

export type EtatDuFormulaireDAcces =
  | { etat: 'offert' }
  /** Ce dossier est celui du cabinet : aucun accès client ne s'y pose. */
  | { etat: 'refuse'; phrase: string }
  /** La désignation n'est pas encore lue : rien ne s'affirme, rien ne s'offre. */
  | { etat: 'attend'; phrase: string }
  /** La désignation est illisible : on ne sait pas si ce dossier est celui du cabinet, rien ne s'offre. */
  | { etat: 'illisible'; phrase: string }

export const PHRASE_DESIGNATION_PAS_LUE =
  'La désignation du dossier du cabinet n’est pas encore lue : on ne sait pas encore si ce dossier peut recevoir un accès client.'

/** La phrase d'une désignation illisible, qui nomme son motif. */
export function phraseDesignationIllisible(motif: string): string {
  return `La désignation du dossier du cabinet n’a pas pu être lue (${motif}) : on ne sait pas si ce dossier peut recevoir un `
    + 'accès client, aucun ne se crée d’ici. Recharge la page.'
}

/**
 * Le formulaire « Donner un accès client », selon la désignation lue pour `dossierId` : refusé sur le dossier du cabinet
 * (`REFUS_ACCES_CLIENT`) ; retenu tant que la désignation n'est pas lue pour CE dossier, ou si elle est illisible — jamais
 * « offert » sur une lecture absente ; offert sinon.
 */
export function etatDuFormulaireDAcces(designation: DesignationPourLesAcces, dossierId: string): EtatDuFormulaireDAcces {
  if (designation === null || designation.dossierId !== dossierId) return { etat: 'attend', phrase: PHRASE_DESIGNATION_PAS_LUE }
  if (designation.etat === 'illisible') return { etat: 'illisible', phrase: phraseDesignationIllisible(designation.motif) }
  return estLeDossierDuCabinet(designation.dossierActuel, dossierId)
    ? { etat: 'refuse', phrase: REFUS_ACCES_CLIENT }
    : { etat: 'offert' }
}
