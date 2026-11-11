import { dateAParis, formatDate, formatMoney } from './format'
import {
  REFUS_DU_DEPOT, etatDuDepot, nomDuFichierDepose, refusDuDepot, type DepotLu, type EtatDuDepot, type FactureADeposer,
} from './depotDesHonoraires'

// LE DÉPÔT DES HONORAIRES, À L'ÉCRAN (ligne 47, LM8 ; derrière `DEPOT_DES_HONORAIRES_PREVU`, baissé). Module PUR : ce que la
// carte « Honoraires déposés chez les clients » de l'onglet Factures du dossier du cabinet, et « Mes pièces » côté client,
// tirent des lectures — le client de chaque facture (la règle de `client_de_la_facture_d_honoraires`, redite), l'état du
// dépôt, le refus avant le clic (lib/depotDesHonoraires.ts) et les mots de la confirmation, qui NOMMENT ce qui part et chez
// qui. LM8-Q1 (A) : la pièce retirée du dossier du client rend la facture « à déposer » ; LM8-Q2 (A) : déposer demande les
// deux dossiers ; LM8-Q3 (A) : le PDF tiré des valeurs figées (lib/pdfFactureFigee.ts) ; LM-Q8 : sur un clic.

/** Un lien de `honoraires_factures`, réduit à ce qui désigne le client (son ordre : `cree_le`, puis `id`). */
export interface LienLu { id: string; facture_id: string; lettre_id: string; cree_le: string }

/** Une lettre de mission, réduite à son client. */
export interface LettreDuClient { id: string; dossier_client_id: string | null }

/** Un dossier du cabinet que le compte lit (le nom seul). */
export interface DossierLu { id: string; nom: string }

/** Ce que la carte sait d'une facture du dossier du cabinet. */
export type FactureDuDepot = FactureADeposer & { date_emission: string; montant_ttc: number }

/**
 * Le client d'une facture d'honoraires, comme la base le lit : celui de la lettre que cite son PREMIER lien (par `cree_le`,
 * puis `id`) ; d'un avoir, celui de la facture qu'il corrige. `null` : aucun lien, ou une lettre sans client.
 */
export function clientDeLaFacture(
  facture: Pick<FactureADeposer, 'id' | 'type' | 'facture_origine_id'>, liens: readonly LienLu[], lettres: readonly LettreDuClient[],
): string | null {
  const cible = facture.type === 'avoir' ? facture.facture_origine_id : facture.id
  if (cible === null) return null
  const premier = liens.filter((l) => l.facture_id === cible)
    .sort((a, b) => (a.cree_le < b.cree_le ? -1 : a.cree_le > b.cree_le ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0]
  if (!premier) return null
  return lettres.find((l) => l.id === premier.lettre_id)?.dossier_client_id ?? null
}

/** Une ligne de la carte : la facture, son client (lu ou non), l'état du dépôt et le refus avant le clic. */
export interface LigneDuDepot {
  facture: FactureDuDepot
  clientId: string
  /** Le nom du dossier du client, `null` quand le compte ne le lit pas (fermé, ou disparu). */
  nomDuClient: string | null
  etat: EtatDuDepot
  refus: string | null
}

/**
 * Les factures d'honoraires de la carte : les validées et figées qui désignent un client par leurs honoraires (une facture
 * qui n'en facture aucun n'est pas une facture d'honoraires : elle ne s'y montre pas), dans l'ordre de leur émission.
 */
export function lignesDuDepot(entree: {
  factures: readonly FactureDuDepot[]
  liens: readonly LienLu[]
  lettres: readonly LettreDuClient[]
  dossiers: readonly DossierLu[]
  depots: readonly DepotLu[]
}): LigneDuDepot[] {
  const lignes: LigneDuDepot[] = []
  for (const facture of entree.factures) {
    if (facture.statut !== 'validee') continue
    const clientId = clientDeLaFacture(facture, entree.liens, entree.lettres)
    if (clientId === null) continue
    const dossier = entree.dossiers.find((d) => d.id === clientId) ?? null
    const refus = refusDuDepot({
      estDossierDuCabinet: true, facture, clientDesHonoraires: clientId,
      dossierClientOuvert: dossier === null ? false : null, depots: entree.depots,
    })
    lignes.push({
      facture, clientId, nomDuClient: dossier?.nom ?? null, etat: etatDuDepot(facture.id, entree.depots),
      refus: refus === null ? null : REFUS_DU_DEPOT[refus],
    })
  }
  return lignes.sort((a, b) => (a.facture.date_emission < b.facture.date_emission ? -1 : a.facture.date_emission > b.facture.date_emission ? 1
    : (a.facture.numero ?? '') < (b.facture.numero ?? '') ? -1 : (a.facture.numero ?? '') > (b.facture.numero ?? '') ? 1 : 0))
}

/** L'état, en mots du cabinet. Le jour d'un dépôt se lit à Paris (un instant). */
export function motsDeLEtat(etat: EtatDuDepot): string {
  if (etat.etat === 'jamais') return 'À déposer'
  const jour = formatDate(dateAParis(etat.depot.depose_le))
  if (etat.etat === 'chez_le_client') return `Déposée le ${jour}`
  return `À déposer — la pièce déposée le ${jour} a été retirée du dossier du client`
}

/** La confirmation : ce qui part (la nature, le numéro, le montant, le nom du fichier) et chez qui, et ce que ça crée. */
export function confirmationDuDepot(ligne: Pick<LigneDuDepot, 'facture' | 'nomDuClient'>): string {
  const f = ligne.facture
  const nature = f.type === 'avoir' ? `l’avoir ${f.numero ?? ''}` : `la facture ${f.numero ?? ''}`
  return `Déposer ${nature} (${formatMoney(f.montant_ttc)} TTC) dans le dossier « ${ligne.nomDuClient ?? '—'} » ? `
    + `Une copie en PDF, tirée des seules valeurs figées de la facture, y entre sous le nom « ${nomDuFichierDepose(f)} », `
    + 'comme une pièce d’achat « à valider », sans catégorie. Le client la voit dans « Mes pièces ». Si la pièce est retirée '
    + 'de son dossier, la facture redevient « à déposer ».'
}

/** Le mot de « Mes pièces » pour une pièce que le cabinet a déposée (le tutoiement de l'espace client). */
export function motDuClientPourLaPiece(nature: string): string {
  return nature === 'avoir' ? 'Avoir d’honoraires déposé par ton cabinet' : 'Facture d’honoraires déposée par ton cabinet'
}

/** Ce que « Mes pièces » dit quand la lecture des honoraires déposés a échoué : une ligne discrète, jamais le silence. */
export function honorairesDeposesIllisibles(motif: string): string {
  return `On n’a pas pu lire quelles pièces ton cabinet a déposées pour ses honoraires (${motif}).`
}
