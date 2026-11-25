import type { EspaceVentes } from './espaceVentes'
import type { Contact, FactureEmise } from './types'

// LE CODE OPAQUE D'UNE FICHE CLIENT (EXP58-Q2, tranchée (A) par le cabinet le 18/11/2026 : « un code opaque par fiche client
// (migration) » ; docs/conceptions/58-reponses-de-l-expert-comptable.md, § 1.4 et le lot L3, avant la validation de 2026).
// L'expert-comptable veut, dans l'identification du client du FEC d'un BNC en trésorerie (IdClient, LPF, art. A47 A-1, VIII,
// 7°, la vingt-deuxième information ; BOI-CF-IOR-60-40-20, § 310 : « codifiable sous le secret professionnel »), un code par
// client et sa table de correspondance, là où FEC22-Q4 (D) écrivait le SIREN d'une entreprise, sinon le numéro de la facture.
//
// CE QUE LA BASE TIENT (la migration `codes_des_clients`, en production depuis le 25/11/2026, 253, par l'outil :
// supabase/schema/20261125124544_codes_des_clients.sql) :
// chaque fiche de `contacts` reçoit à sa création un code, la lettre C et cinq chiffres (C00001 à C99999), le rang de sa
// création dans le dossier — jamais tiré du nom, du SIREN ni d'aucune donnée de la fiche —, posé par une garde de la table
// (`poser_code_client`, un compteur par dossier, `contacts_numerotation`), puis gardé : il ne change plus, l'effacement
// compris ; la restauration le réinsère tel quel et reprend le compteur au plus haut. La validation d'un exercice l'admet en
// identification du client quand une facture ou un avoir VALIDÉ du dossier vient de cette fiche (`contact_id`, figé à la
// validation). codesDesClients.test.ts confronte ce module au texte de la migration et de son retour.
//
// CE QUE CE MODULE TIENT, sans base ni horloge : le drapeau, la forme du code, le code de la fiche d'où vient une facture (ce
// que la lecture du FEC passe au module des quatre champs, lib/champsBncDuFec.ts, `codeDuClient`), et les mots des écrans
// (la vue « Clients », la fiche exportée, la phrase de l'onglet Accès).
//
// LE DRAPEAU BAISSÉ, RIEN NE CHANGEAIT : la colonne n'existait pas, la lecture du FEC ne la demandait pas, IdClient restait
// celui d'hier, à l'octet (le FEC fictif de la répétition compris), et aucun écran ne disait de code — l'état d'avant, que les
// tests jouent encore (un accesseur, ou le paramètre des fonctions `…Selon`).

/** Le drapeau de la migration `codes_des_clients` (EXP58-Q2) : LEVÉ depuis le 25/11/2026, la migration en base (253, par
 *  l'outil ; son fichier rangé dans supabase/schema/). Levé, la colonne `contacts.code_client` se lit (la vue « Clients », la
 *  fiche exportée, la lecture du FEC) et le compteur est au plan de sauvegarde. Jamais levé avant la migration : une lecture
 *  de la colonne avant elle ferait échouer celle des factures du FEC. */
export const CODES_DES_CLIENTS_PREVUS: boolean = true

/** La table que la migration crée, hors de toute lecture de l'API (aucune policy) : le plan de sauvegarde la porte derrière le
 *  drapeau, et la lit vide (RESTAU-Q3). */
export const TABLES_DES_CODES_DES_CLIENTS: readonly string[] = ['contacts_numerotation']

/** La forme du code, celle de la contrainte `contacts_code_client_forme` : C et cinq chiffres, jamais C00000. */
export const FORME_DU_CODE_CLIENT = /^C[0-9]{5}$/
export const PLUS_GRAND_CODE_CLIENT = 99999

/** Vrai pour un code de la forme que la base pose. */
export function estUnCodeClient(valeur: unknown): valeur is string {
  return typeof valeur === 'string' && FORME_DU_CODE_CLIENT.test(valeur) && valeur !== 'C00000'
}

/** Le code de rang `n` (de 1 à 99 999), tel que la garde de la base le compose : 'C' et le rang sur cinq chiffres. */
export function codeDuRang(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > PLUS_GRAND_CODE_CLIENT) throw new RangeError(`Rang de code hors de 1 à 99 999 : ${n}`)
  return `C${String(n).padStart(5, '0')}`
}

/** Les mots des refus de la garde, au caractère près (codesDesClients.test.ts les relit dans la migration). */
export const REFUS_DU_CODE_CLIENT = {
  change: {
    code: '23514',
    message: "Le code d'une fiche client est posé par la base à sa création et ne change plus : il désigne ce client dans le FEC.",
  },
  borne: {
    code: '23514',
    message: "Ce dossier a reçu ses 99 999 codes de fiche client (C00001 à C99999) : une fiche de plus n'a plus de code.",
  },
} as const

/** Une fiche telle que la lecture du FEC la lit : son identifiant, son dossier et son code — rien de son identité. */
export type FicheDuCode = Pick<Contact, 'id' | 'dossier_id'> & { code_client: string }

/** Le code de chaque fiche lue, par identifiant ; une fiche d'un autre dossier n'y entre pas. */
export function codesDesFiches(fiches: readonly FicheDuCode[], dossierId: string): ReadonlyMap<string, string> {
  return new Map(fiches.filter((f) => f.dossier_id === dossierId).map((f) => [f.id, f.code_client]))
}

/**
 * Le code de la fiche d'où vient le client d'une facture ou d'un avoir (`contact_id`, la provenance que la validation fige ;
 * l'avoir prend celle de sa facture), ou nul : sans provenance, ou une provenance qu'aucune fiche lue du dossier ne porte (la
 * base refuse qu'une facture en cite une d'ailleurs). La règle d'hier s'applique alors (`identificationDuClient`,
 * lib/champsBncDuFec.ts). `contact_id` absent d'une lecture qui ne le nomme pas : nul aussi.
 */
export function codeDuClientDeLaFacture(
  facture: Pick<FactureEmise, 'contact_id'>,
  codes: ReadonlyMap<string, string>,
): string | null {
  const fiche = facture.contact_id
  return fiche == null ? null : codes.get(fiche) ?? null
}

// ── Les mots des écrans ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Le libellé du code, celui de la colonne de la fiche exportée et de la vue « Clients ». */
export const LIBELLE_DU_CODE_CLIENT = 'Code client'

/** Ce que la vue « Clients » dit du code, une phrase pour la liste. Au client : tutoiement, aucun mot du cabinet. */
export function phraseDuCodeClient(espace: EspaceVentes): string {
  return espace === 'client'
    ? 'Chacun de tes clients reçoit à sa création un code (C00001, C00002…) qui ne change plus : il le désigne dans ta '
      + 'comptabilité sans le nommer.'
    : 'Chaque client reçoit à sa création un code (C00001, C00002…), posé par l’application et qui ne change plus, même effacé : '
      + 'il désigne le client dans l’identification du client du FEC, sans le nommer ; la fiche exportée le porte, pour qui lit '
      + 'le FEC.'
}

/** Ce que la phrase de l'onglet Accès ajoute aux colonnes d'un contact que le client « Ventes » lit, le drapeau levé. */
export const CODE_DANS_LA_PHRASE_DES_CASES = 'le code que la base donne à chaque contact'
