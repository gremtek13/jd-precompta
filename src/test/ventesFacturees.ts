import type { LigneDeFacture } from '../lib/encaissementsFactures'
import type { EncaissementVendu, FactureVendue, PartVendue, VentesFacturees } from '../lib/ventesFacturees'
import type { RecettesFacturees } from '../lib/estimation'
import type { EcritureVenteFacturee } from '../lib/ecrituresVentesFacturees'
import type { JustificatifsDesVentes } from '../lib/pisteAudit'
import type { FacturesSources } from '../lib/facturesSources'

// LES VENTES FACTURÉES DES TESTS (ligne 28.6, chantier EC-Q3, étape VF3b1). Les moteurs reçoivent les ventes facturées en
// paramètre OBLIGATOIRE, sans valeur par défaut (lib/declaration2035.ts) : le code de production n'en fabrique aucune, et
// c'est ICI, hors de `src/lib`, que vit la valeur vide qu'un jeu d'essai sans facture source passe EXPLICITEMENT — un
// test qui la donne dit qu'il ne parle pas des ventes facturées, il ne l'oublie pas.
//
// Et de quoi en bâtir de vraies : les lignes de la base telles que la lecture les rend (lib/ventesFactureesLecture.ts),
// que les tests passent au module pur (`ventesFacturees`) plutôt que d'écrire ses parts à la main — une part écrite à la
// main ne prouverait rien de ce que le module rend. Données FICTIVES.

/**
 * Aucune écriture d'une vente facturée composée (étape VF4c2) : ce que le FEC reçoit d'un dossier qui n'a pas basculé, ou
 * d'un jeu d'essai qui ne parle pas des ventes facturées (lib/fec.ts, `numeroterFec`).
 */
export const SANS_ECRITURE_DE_VENTE: readonly EcritureVenteFacturee[] = []

/** Aucune vente facturée, ni preuve d'une facture : ce que la piste d'audit reçoit d'un jeu qui n'en parle pas (lib/pisteAudit.ts). */
export const SANS_VENTE_FACTUREE: JustificatifsDesVentes = {
  ecritures: [], factures: [], encaissements: [], exemplaires: [], transmissions: [],
}

/**
 * Aucune facture source (étape VF6a, lib/facturesSources.ts) : ce que le brouillon, ses contrôles, la Checklist et les
 * préalables de la validation reçoivent d'un jeu d'essai qui ne parle pas de l'exemplaire d'une facture source.
 */
export const SANS_FACTURE_SOURCE: FacturesSources = new Set<string>()

/** Aucune pièce exemplaire d'une facture source (`exemplairesDesSources`), pour `analyserEcritures`. */
export const SANS_EXEMPLAIRE: ReadonlySet<string> = new Set<string>()

/** Aucune facture source : ni part, ni exigibilité, ni document, ni écart, ni excédent. */
export function ventesFactureesVides(dossierId: string): VentesFacturees {
  return { dossierId, parts: [], exigibilites: [], documents: [], ecartees: [], excedents: [], sources: new Set<string>() }
}

/**
 * Les recettes facturées de l'estimation (lib/estimation.ts) d'un dossier sans facture source : COMPTÉES, et nulles — le
 * chemin du cabinet. À ne pas confondre avec « non comptées », l'état que choisit « Ma simulation » et que son écran dit.
 */
export function recettesFactureesVides(): RecettesFacturees {
  return { etat: 'comptees', parMois: new Map<string, number>(), sources: new Set<string>() }
}

/** Une facture validée SOURCE de sa vente, de services, sans l'option pour les débits. */
export function factureVendue(o: Partial<FactureVendue> = {}): FactureVendue {
  return {
    id: 'f1', dossier_id: 'd1', statut: 'validee', type: 'facture', numero: 'F2025-0001', date_emission: '2025-11-10',
    tiers_nom: 'Client fictif', facture_origine_id: null, source_de_la_vente: true, nature_operation: 'services',
    option_debits: false, date_prestation: null, ...o,
  }
}

/** Une ligne de facture : son hors taxe et son taux (un avoir la porte en quantité négative). */
export function ligneVendue(factureId: string, ht: number, taux: number, ordre = 1): LigneDeFacture {
  return { facture_id: factureId, ordre, designation: 'Prestation fictive', quantite: 1, prix_unitaire_ht: ht, taux_tva: taux }
}

/** Un encaissement du registre, et sa part au taux donné pour tout son montant. */
export function encaissementVendu(
  o: Partial<EncaissementVendu> & Pick<EncaissementVendu, 'id' | 'date_encaissement' | 'montant'>, taux = 20,
): { encaissement: EncaissementVendu; part: PartVendue } {
  const encaissement: EncaissementVendu = {
    dossier_id: 'd1', facture_id: 'f1', moyen: 'virement', ligne_bancaire_id: null, annule_id: null,
    cree_le: `${o.date_encaissement}T10:00:00Z`, retire_le: null, ...o,
  }
  return { encaissement, part: { encaissement_id: encaissement.id, dossier_id: encaissement.dossier_id, taux, montant: encaissement.montant } }
}
