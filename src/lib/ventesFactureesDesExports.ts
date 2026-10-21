import {
  cleFecEncaissement, cleFecFacture, cleFecMouvementEncaissements, memeEcritureQueLeBrouillon, type EcritureVenteFacturee,
} from './ecrituresVentesFacturees'
import type { EcritureBrouillon, EncaissementFacture, FactureEmise } from './types'

// LES EXPORTS LISENT LES ÉCRITURES D'UNE VENTE FACTURÉE (ligne 28.6, chantier EC-Q3, étape VF4c2 ; conception : HISTORIQUE.md,
// « LA FACTURE VALIDÉE, SOURCE DE SA VENTE : LA CONCEPTION », § 5, § 8 et § 14). Un module PUR, que le FEC (lib/fec.ts), la
// piste d'audit (lib/pisteAudit.ts) et le lettrage (lib/lettrage.ts) partagent : une règle, un endroit.
//
// CE QUE LA BASE NE RANGE PAS. `ecrire_vente_facturee` n'écrit d'une ligne que sa date, son compte, son sens, son montant, son
// libellé, son mouvement et sa source — `facture_id` (une facture ou un avoir), `encaissement_id` (un encaissement ou une
// contre-passation), ou aucune des deux pour une ligne d'un mouvement que ses encaissements classent. Le journal, la pièce
// (PieceRef, PieceDate) et le client de l'auxiliaire du 411 sont ceux que la COMPOSITION rend (lib/ecrituresVentesFacturees.ts,
// étape VF4a) : chaque ligne doit donc retrouver l'écriture composée qu'elle porte.
//
// LE RATTACHEMENT (`rattachementDesVentes`) : une ligne du brouillon se rattache à son écriture composée par sa SOURCE et sa
// DATE — la clé du FEC que la composition donne à chaque écriture (`facture|<facture ou avoir>|<date>`,
// `encaissement|<encaissement>|<date>`, `mouvement-encaissements|<mouvement>`) —, JAMAIS d'après un montant ou un libellé ;
// et seulement si les lignes de cette source à cette date sont EXACTEMENT l'écriture composée (`memeEcritureQueLeBrouillon` :
// comptes, sens, centimes, mouvement, date et source — la comparaison même de la fonction de VF4b, et l'état « à jour » de
// l'onglet). Une ligne que la composition ne rend plus telle quelle — une source « à réécrire » ou « à retirer » (R3) — n'est
// pas rattachée : le FEC la laisse hors du fichier, la piste d'audit le dit, le lettrage ne la lettre pas. La rattacher
// quand même mettrait dans le fichier une écriture qui n'est plus celle que sa source commande, sous la pièce d'une autre.

/** Une facture ou un avoir du dossier, tel que les exports le nomment. */
export type FactureDesExports = Pick<FactureEmise,
  'id' | 'dossier_id' | 'type' | 'numero' | 'tiers_nom' | 'date_emission' | 'montant_ttc' | 'facture_origine_id' | 'source_de_la_vente'>

/** Un encaissement du registre (contre-passations comprises), tel que les exports le nomment. */
export type EncaissementDesExports = Pick<EncaissementFacture,
  'id' | 'dossier_id' | 'facture_id' | 'date_encaissement' | 'montant' | 'moyen' | 'ligne_bancaire_id' | 'annule_id'>

/** Les factures et le registre des encaissements du dossier, lus EN ENTIER : à quelle facture une ligne se rattache. */
export interface FacturesDesLignes {
  factures: readonly FactureDesExports[]
  encaissements: readonly EncaissementDesExports[]
}

/** Et la composition des écritures (lib/ecrituresVentesFacturees.ts), sur les mêmes lectures. */
export interface VentesFactureesDesExports extends FacturesDesLignes {
  ecritures: readonly EcritureVenteFacturee[]
}

/** Ce que le rattachement lit d'une ligne du brouillon : sa source, sa date, et ce que la comparaison regarde. */
export type LigneRattachable = Pick<EcritureBrouillon,
  'id' | 'piece_id' | 'ligne_bancaire_id' | 'facture_id' | 'encaissement_id' | 'immobilisation_id' | 'vehicule_id'
  | 'declaration_tva_id' | 'cotisation_id' | 'date' | 'compte' | 'montant' | 'sens'>

// La clé que la ligne prendrait si elle est d'une vente facturée, nulle sinon. Le troisième genre — une ligne sans pièce ni
// aucune autre source, d'un mouvement dont la composition rend l'écriture — est celui de la garde G5 ; un mouvement classé
// AUTREMENT n'est jamais composé (G1 : un mouvement classé par ses encaissements ne porte rien d'autre).
function cleDeLaLigne(b: LigneRattachable, mouvementsComposes: ReadonlySet<string>): string | null {
  if (b.facture_id != null) return cleFecFacture(b.facture_id, b.date)
  if (b.encaissement_id != null) return cleFecEncaissement(b.encaissement_id, b.date)
  if (b.piece_id == null && b.ligne_bancaire_id != null && mouvementsComposes.has(b.ligne_bancaire_id) && b.immobilisation_id == null
    && b.vehicule_id == null && b.declaration_tva_id == null && b.cotisation_id == null) {
    return cleFecMouvementEncaissements(b.ligne_bancaire_id)
  }
  return null
}

/**
 * Les lignes du brouillon rattachées à leur écriture composée, par identifiant de ligne. Une ligne d'une vente facturée
 * absente de la table n'est pas rattachée : la composition ne rend plus son écriture telle quelle (« à réécrire » ou « à
 * retirer »), ou elle n'a pas été lue. Pur ; le résultat ne dépend pas de l'ordre de lecture. `brouillon` peut n'être
 * qu'une partie du brouillon (un exercice) : une écriture composée n'a qu'une date, elle est entière ou absente.
 */
export function rattachementDesVentes<L extends LigneRattachable>(
  brouillon: readonly L[], composees: readonly EcritureVenteFacturee[],
): ReadonlyMap<string, EcritureVenteFacturee> {
  const parCle = new Map(composees.map((e) => [e.cle, e]))
  const mouvementsComposes = new Set(composees.flatMap((e) => (e.source.genre === 'mouvement' ? [e.source.ligneBancaireId] : [])))
  const groupes = new Map<string, L[]>()
  for (const b of brouillon) {
    const cle = cleDeLaLigne(b, mouvementsComposes)
    if (cle !== null) groupes.set(cle, [...(groupes.get(cle) ?? []), b])
  }
  const rattachees = new Map<string, EcritureVenteFacturee>()
  for (const [cle, lignes] of groupes) {
    const composee = parCle.get(cle)
    if (composee && memeEcritureQueLeBrouillon(composee, lignes)) for (const l of lignes) rattachees.set(l.id, composee)
  }
  return rattachees
}

/** La ligne porte-t-elle une facture ou un encaissement ? Seule la fonction de VF4b remplit ces colonnes. */
export function porteUneSourceDeVente(b: Pick<EcritureBrouillon, 'facture_id' | 'encaissement_id'>): boolean {
  return b.facture_id != null || b.encaissement_id != null
}

/** Pour chaque facture ou avoir, la facture dont il porte la créance ; pour chaque encaissement, la facture qu'il règle. */
export interface IndexDesFactures {
  factures: ReadonlyMap<string, FactureDesExports>
  encaissements: ReadonlyMap<string, EncaissementDesExports>
  /** La facture dont un document porte la créance : elle-même, ou celle qu'un avoir corrige. */
  factureDuDocument: ReadonlyMap<string, string>
}

export function indexDesFactures(lus: FacturesDesLignes): IndexDesFactures {
  const factures = new Map(lus.factures.map((f) => [f.id, f]))
  return {
    factures,
    encaissements: new Map(lus.encaissements.map((e) => [e.id, e])),
    // Un avoir corrige la facture qu'il cite (la base l'exige depuis le 07/10/2026) ; défensif, un avoir sans elle est sa
    // propre créance.
    factureDuDocument: new Map(lus.factures.map((f) => [f.id, f.type === 'avoir' && f.facture_origine_id != null ? f.facture_origine_id : f.id])),
  }
}

/**
 * La facture dont une ligne d'une vente facturée porte la créance au 411 : la sienne, celle que corrige son avoir, celle
 * que règle son encaissement (ou que sa contre-passation défait). Nulle pour une ligne d'un mouvement — il ne touche pas
 * au 411 —, hors d'une vente facturée, ou quand la lecture ne connaît pas la source.
 */
export function factureDeLaLigne(b: Pick<EcritureBrouillon, 'facture_id' | 'encaissement_id'>, index: IndexDesFactures): string | null {
  if (b.facture_id != null) return index.factureDuDocument.get(b.facture_id) ?? null
  if (b.encaissement_id != null) return index.encaissements.get(b.encaissement_id)?.facture_id ?? null
  return null
}

/** Le nom d'une facture ou d'un avoir, en clair : « la facture F2025-0001 », « l'avoir A2025-0002 ». */
export function nomDuDocument(f: Pick<FactureDesExports, 'type' | 'numero' | 'id'>): string {
  return `${f.type === 'avoir' ? 'Avoir' : 'Facture'} ${f.numero ?? f.id.slice(0, 8)}`
}
