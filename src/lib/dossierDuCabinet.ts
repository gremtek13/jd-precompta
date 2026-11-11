// LE DOSSIER DU CABINET (ligne 47, lot LM1 ; LM-Q1 et LM-Q2 du 11/11/2026). Un cabinet DÉSIGNE l'un de ses dossiers comme
// le sien (`cabinets.dossier_du_cabinet`) : il y facture ses honoraires en son propre nom — aucun mandataire figé, la série
// du dossier, jamais celle du mandataire —, aucun accès client ne s'y pose, et il ne se supprime qu'avec le cabinet. La base
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
  'Le dossier du cabinet ne se supprime pas : il porte les factures du cabinet. Seul le super-administrateur le retire, avec le cabinet.'

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

/** Le refus de la suppression d'un dossier, à dire AVANT de vider son stockage (la base ne refuse la ligne qu'après). */
export function refusDeLaSuppression(p: { estLeDossierDuCabinet: boolean; superAdministrateur: boolean }): string | null {
  return p.estLeDossierDuCabinet && !p.superAdministrateur ? REFUS_SUPPRESSION : null
}
