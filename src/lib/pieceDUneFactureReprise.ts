// LA PIÈCE D'UNE FACTURE REPRISE (ligne 51.5, A8-Q5, tranchée par le cabinet le 07/11/2026 à la recommandation) : quand le PDF
// d'une facture de l'ancien logiciel est déjà une pièce de vente du dossier, la facture reprise le cite, et la pièce ne se
// règle plus par un mouvement, une part d'un virement groupé, une opération de caisse ni une écriture datés de la reprise des
// factures ou d'après — ses paiements d'après passent par le registre de la facture reprise (A8b). La base le tient : la
// migration `piece_d_une_facture_reprise` (supabase/schema/20261110143243_piece_d_une_facture_reprise.sql, préparée et
// appliquée par l'outil le 10/11/2026, après A8a, A9a et A8b). Ce module en redit les refus, aux mots de la base et dans l'ordre où ses
// fonctions les disent (pieceDUneFactureReprise.test.ts les confronte au texte de la migration), et le jugement d'une date de
// règlement, pour qu'un écran (A8d) les dise avant le clic. Pur : il n'importe jamais `supabase.ts`. Aucun écran ne s'en sert
// encore. A8Q5-Q1 (le 10/11/2026, « Oui, citer ; retrait refusé ») : une pièce que la validation d'un exercice a figée se cite
// — rien ne change dans l'exercice validé, le lien ne ferme que ses rapprochements d'après la reprise —, et son lien ne se
// retire pas : le refus « figée » n'est plus que celui du retrait.

/**
 * La migration est-elle en base ? Levé le 10/11/2026, le jour de son application : la table des liens est au plan de
 * sauvegarde (src/lib/sauvegarde.ts). Baissé, la lire aurait fait échouer toute sauvegarde ; le plan reste éprouvé sous les
 * deux états (sauvegardePieceDUneFactureReprise.test.ts).
 */
export const PIECE_D_UNE_FACTURE_REPRISE_PREVUE: boolean = true

/** La table de la migration, au plan de sauvegarde derrière le drapeau. */
export const TABLES_DE_LA_PIECE_D_UNE_FACTURE_REPRISE: readonly string[] = ['pieces_des_factures_reprises']

/** Un refus de la base : sa clé, son code SQLSTATE et ses mots (« % » à remplir, dans l'ordre). */
export interface RefusDeLaBase {
  cle: string
  code: string
  modele: string
}

const FIGEE = "La pièce « % » justifie une écriture validée de l'exercice % : le lien qui la cite ne se retire plus."
const ACCES = 'Accès refusé à ce dossier.'

/** Les refus de `citer_piece_de_facture_reprise`, dans l'ordre où la fonction les dit. */
export const REFUS_CITER = [
  { cle: 'acces', code: '42501', modele: ACCES },
  { cle: 'pas_une_reprise', code: '22023', modele: "Cette facture n'est pas une facture reprise de ce dossier." },
  { cle: 'facture_cite_deja', code: '23514', modele: "La facture reprise % cite déjà la pièce « % » : retirer ce lien d'abord." },
  { cle: 'piece_introuvable', code: 'P0002', modele: 'Pièce introuvable dans ce dossier.' },
  { cle: 'pas_une_vente', code: '22023', modele: "Seule une pièce de vente est l'original d'une facture reprise." },
  {
    cle: 'exemplaire',
    code: '23514',
    modele: "La pièce « % » est l'exemplaire de la facture % de l'application : elle n'est pas l'original d'une facture reprise.",
  },
  {
    cle: 'piece_citee_ailleurs',
    code: '23514',
    modele: "La pièce « % » est déjà l'original de la facture reprise % : une pièce n'est l'original que d'une facture reprise.",
  },
  {
    cle: 'reglee_apres_la_reprise',
    code: '23514',
    modele: "La pièce « % » est réglée le %, à la date de reprise des factures (le %) ou après : ce règlement passe par le registre de la facture reprise %. Défaire d'abord ce rapprochement.",
  },
] as const satisfies readonly RefusDeLaBase[]

/** Les refus de `retirer_piece_de_facture_reprise`, dans l'ordre où la fonction les dit. */
export const REFUS_RETIRER = [
  { cle: 'acces', code: '42501', modele: ACCES },
  { cle: 'aucun_lien', code: '22023', modele: 'Cette facture reprise ne cite aucune pièce de ce dossier.' },
  { cle: 'figee', code: '23514', modele: FIGEE },
] as const satisfies readonly RefusDeLaBase[]

/** Le refus de la garde des règlements (`garder_reglement_d_une_piece_reprise`), sur les quatre tables qu'elle garde. */
export const REFUS_DU_REGLEMENT = {
  cle: 'reglement_apres_la_reprise',
  code: '23514',
  modele: "La pièce « % » est l'original de la facture reprise % : ses règlements datés de la reprise des factures (le %) ou d'après passent par le registre de la facture, et le règlement du % ne la cite pas.",
} as const satisfies RefusDeLaBase

/** Les refus de la garde du lien (`garder_pieces_des_factures_reprises`), dans l'ordre où elle les dit. */
export const REFUS_DU_LIEN = [
  { cle: 'hors_de_sa_fonction', code: '42501', modele: "La pièce d'une facture reprise ne se cite que par citer_piece_de_facture_reprise, qui la juge." },
  { cle: 'pas_une_vente_du_dossier', code: '23514', modele: "Une facture reprise ne cite qu'une pièce de vente de son dossier." },
  { cle: 'piece_reglee_apres', code: '23514', modele: "Une facture reprise ne cite pas une pièce qu'un règlement daté de la reprise des factures ou d'après cite." },
  {
    cle: 'lien_modifie',
    code: '23514',
    modele: "Le lien d'une facture reprise à sa pièce ne se modifie pas : il se retire (retirer_piece_de_facture_reprise), puis se cite de nouveau.",
  },
] as const satisfies readonly RefusDeLaBase[]

/** Les refus de la garde de la pièce citée (`garder_piece_d_une_facture_reprise`), dans l'ordre où elle les dit. */
export const REFUS_DE_LA_PIECE = [
  { cle: 'suppression', code: '23514', modele: "La pièce « % » est l'original de la facture reprise % : retirer ce lien avant de la supprimer." },
  {
    cle: 'changement',
    code: '23514',
    modele: "La pièce « % » est l'original de la facture reprise % : elle reste une pièce de vente de son dossier, exemplaire d'aucune facture de l'application. Retirer ce lien d'abord.",
  },
] as const satisfies readonly RefusDeLaBase[]

/** Un modèle rempli comme `raise exception` le remplit : chaque « % » prend la valeur suivante, « %% » reste « % ». */
export function remplir(modele: string, ...valeurs: readonly (string | number)[]): string {
  let rang = 0
  return modele.replace(/%%|%/g, (m) => (m === '%%' ? '%' : String(valeurs[rang++] ?? '')))
}

/** Un jour civil `AAAA-MM-JJ` dit comme la base le dit (`to_char(…, 'DD/MM/YYYY')`). */
export function jourDit(jour: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(jour)
  if (!m) throw new Error(`Jour civil illisible : ${jour}`)
  return `${m[3]}/${m[2]}/${m[1]}`
}

/**
 * Le règlement d'une pièce citée par une facture reprise, daté de `jour`, se refuse-t-il ? Oui à la date de reprise des
 * factures ou après (deux jours civils `AAAA-MM-JJ`, comparés comme la base compare deux `date`) ; avant, il passe.
 */
export function reglementRefuse(jour: string, repriseLe: string): boolean {
  jourDit(jour)
  jourDit(repriseLe)
  return jour >= repriseLe
}

/** Le refus de la garde des règlements, rempli comme la base le remplit. */
export function refusDuReglement(nomFichier: string, numero: string, repriseLe: string, jour: string): string {
  return remplir(REFUS_DU_REGLEMENT.modele, nomFichier, numero, jourDit(repriseLe), jourDit(jour))
}
