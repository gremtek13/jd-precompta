// LA FACTURE D'HONORAIRES DÉPOSÉE CHEZ LE CLIENT (ligne 47, lot LM8 ; la migration `depot_des_honoraires`, PRÉPARÉE le
// 11/11/2026, supabase/preparees/20261111230000_depot_des_honoraires.sql, après LM1, LM4 et LM7). Le récit : HISTORIQUE.md,
// « 11/11/2026 — LM8 ».
//
// Module PUR (aucun appel) : il redit, dans leur ordre et à leurs mots, les refus de `deposer_honoraires_chez_le_client`
// que l'écran peut juger AVANT le clic — avant de tirer le PDF et de le déposer dans le seau des pièces, qu'un refus de la
// base laisserait à retirer —, compose le chemin et le nom du fichier comme la base les attend, et lit l'état du dépôt
// d'une facture dans ce que rend `depots_des_honoraires`. La base juge seule ce que l'écran ne sait pas (le fichier rangé,
// son type, une empreinte déjà au dossier du client) ; ses refus se disent tels qu'elle les rend.
//
// Derrière `DEPOT_DES_HONORAIRES_PREVU`, BAISSÉ : la production n'a ni la table ni les fonctions, et aucun écran ne les
// appelle tant que la migration n'est pas collée et exportée. depotDesHonoraires.test.ts confronte chaque mot et l'ordre à
// la migration.

export const DEPOT_DES_HONORAIRES_PREVU = false

/** Les refus de la fonction, à ses mots — dans l'ordre où elle les lève (la même liste, dans le même ordre, que la migration). */
export const REFUS_DU_DEPOT = {
  acces: 'Accès refusé à ce dossier.',
  dossierDuCabinet: "Les factures d'honoraires se déposent depuis le dossier du cabinet.",
  empreinte: "L'empreinte du fichier est son SHA-256, en soixante-quatre caractères hexadécimaux minuscules.",
  chemin: 'Le fichier se dépose dans le dossier du client, en PDF, sous un nom sans dossier.',
  introuvable: 'Facture introuvable dans le dossier du cabinet.',
  pasValidee: 'Seule une facture validée se dépose chez le client.',
  repriseOuNonFigee: "Une facture reprise de l'ancien logiciel, ou qui n'a pas figé ses mentions, ne se dépose pas d'ici : son PDF ne se tirerait pas de ses seules valeurs figées.",
  sansHonoraires: "Cette facture ne facture les honoraires d'aucune lettre de mission : elle ne se dépose chez aucun client.",
  avoirAvantSaFacture: "Un avoir se dépose après la facture qu'il corrige, et tant qu'elle est chez le client.",
  dossierClientDisparu: "Le dossier du client n'existe plus dans ce cabinet.",
  dossierClientFerme: "Le dossier du client n'est pas ouvert à ce compte : le chef du cabinet, ou un membre qui y est assigné, y dépose la facture.",
  dejaDeposee: 'Cette facture est déjà déposée chez le client.',
  fichierAbsent: "Le PDF n'est pas déposé dans le seau des pièces, sous le dossier du client : le déposer d'abord.",
  fichierDejaPiece: 'Ce fichier est déjà une pièce du dossier du client.',
} as const

export type RefusDuDepot = keyof typeof REFUS_DU_DEPOT

/** Ce que l'écran sait d'une facture du dossier du cabinet. */
export type FactureADeposer = {
  id: string
  type: 'facture' | 'avoir'
  statut: string
  mentions_figees: boolean
  numero: string | null
  facture_origine_id: string | null
}

/** Une ligne de `depots_des_honoraires` : le DERNIER dépôt d'une facture, et si sa pièce est encore chez le client. */
export type DepotLu = {
  facture_id: string
  depot: number
  dossier_client_id: string
  piece_id: string
  depose_le: string
  presente: boolean
}

/** L'état d'une facture côté dépôt : jamais déposée, chez le client, ou déposée puis sa pièce retirée (à redéposer). */
export type EtatDuDepot = { etat: 'jamais' } | { etat: 'chez_le_client'; depot: DepotLu } | { etat: 'retiree'; depot: DepotLu }

export function etatDuDepot(factureId: string, depots: readonly DepotLu[]): EtatDuDepot {
  const depot = depots.find((d) => d.facture_id === factureId)
  if (!depot) return { etat: 'jamais' }
  return depot.presente ? { etat: 'chez_le_client', depot } : { etat: 'retiree', depot }
}

/**
 * Ce que l'écran juge AVANT le clic, dans l'ordre de la fonction. Chaque entrée est obligatoire : `clientDesHonoraires` est
 * le dossier du client que les honoraires de la facture désignent (nul : aucun) ; `dossierClientOuvert`, que le compte
 * ouvre ce dossier (`null` : inconnu, la base jugera) ; `depots`, ce que `depots_des_honoraires` a rendu EN ENTIER.
 */
export function refusDuDepot(entree: {
  estDossierDuCabinet: boolean
  facture: FactureADeposer | null
  clientDesHonoraires: string | null
  dossierClientOuvert: boolean | null
  depots: readonly DepotLu[]
}): RefusDuDepot | null {
  const { facture } = entree
  if (!entree.estDossierDuCabinet) return 'dossierDuCabinet'
  if (facture === null) return 'introuvable'
  if (facture.statut !== 'validee' && facture.statut !== 'importee') return 'pasValidee'
  if (facture.statut === 'importee' || !facture.mentions_figees) return 'repriseOuNonFigee'
  if (entree.clientDesHonoraires === null) return 'sansHonoraires'
  if (facture.type === 'avoir') {
    const origine = facture.facture_origine_id === null ? null : etatDuDepot(facture.facture_origine_id, entree.depots)
    if (origine === null || origine.etat !== 'chez_le_client' || origine.depot.dossier_client_id !== entree.clientDesHonoraires) {
      return 'avoirAvantSaFacture'
    }
  }
  if (entree.dossierClientOuvert === false) return 'dossierClientFerme'
  if (etatDuDepot(facture.id, entree.depots).etat === 'chez_le_client') return 'dejaDeposee'
  return null
}

/** Le nom du fichier de la pièce, tel que la base le compose (« Facture F2026-0001.pdf », « Avoir … »). */
export function nomDuFichierDepose(facture: Pick<FactureADeposer, 'type' | 'numero'>): string {
  return `${facture.type === 'avoir' ? 'Avoir ' : 'Facture '}${facture.numero ?? ''}.pdf`
}

/**
 * Le chemin du PDF dans le seau des pièces : sous le dossier du client (le premier segment, que la policy du seau juge),
 * sans sous-dossier, en `.pdf` — la forme que la fonction exige. L'horodatage le rend unique, comme tout dépôt.
 */
export function cheminDuDepot(dossierClientId: string, horodatage: number, facture: Pick<FactureADeposer, 'type' | 'numero'>): string {
  const base = `${facture.type === 'avoir' ? 'avoir' : 'facture'}-${facture.numero ?? 'sans-numero'}`
    .toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  return `${dossierClientId}/${horodatage}-honoraires-${base}.pdf`
}
