import type { DossierEreporting, Lecture } from '../lib/ereporting'
import {
  declarationCalculee, type FactureDeLEcran, type PieceDeLEcran, type SourcesEreporting,
} from '../lib/ereportingEcran'
import { contenuADeclarer } from '../lib/declarationsEreporting'
import type { ObjetEreporting } from '../lib/periodesEreporting'
import type {
  DeclarationEreportingHorsApplication, EncaissementFacture, EncaissementFactureTaux, FactureLigne, PieceEcarteeEreporting,
  PieceHorsDeFrance, PieceHorsDeFranceTaux, RegimeEreporting, SourceDeclarationEreporting,
} from '../lib/types'

// LE MONDE FICTIF DES TESTS DE L'E-REPORTING À L'ÉCRAN (étape e5c) : un dossier redevable au réel trimestriel, un régime
// confirmé depuis le 1er janvier 2026 (chaque mois), et, pour octobre 2027, un achat à un fournisseur irlandais décrit
// par sa fiche, une vente à un particulier et son encaissement. « Aujourd'hui » est le 5 novembre 2027 : octobre est
// échu et se déclare avant le 10, novembre est en cours. Chaque ligne est FICTIVE (aucun nom réel, aucun SIREN réel).
// Les jeux sont typés sans `as` : le compilateur confronte chaque champ à la table.

export const SIRET = '12345678200010'
export const SIREN = '123456782'
export const NUMERO_TVA = 'FR11123456782'
export const AUJOURDHUI = '2027-11-05'
export const OCTOBRE = { debut: '2027-10-01', fin: '2027-10-31' }
export const SEPTEMBRE = { debut: '2027-09-01', fin: '2027-09-30' }
export const NOVEMBRE = { debut: '2027-11-01', fin: '2027-11-30' }

// Les identifiants que la base lit comme des `uuid` : un contenu figé les cite (la fiche et la pièce d'un achat, les factures,
// les encaissements), et le module ne lit une opération que si ses identifiants en sont (`uuidCommeLaBase`).
export const R1 = '00000000-0000-4000-8000-0000000000a1'
export const R2 = '00000000-0000-4000-8000-0000000000a2'
export const P1 = '00000000-0000-4000-8000-0000000000b1'
export const P2 = '00000000-0000-4000-8000-0000000000b2'
export const P9 = '00000000-0000-4000-8000-0000000000b9'
export const F1 = '00000000-0000-4000-8000-0000000000c1'
export const F2 = '00000000-0000-4000-8000-0000000000c2'
export const V1 = '00000000-0000-4000-8000-0000000000d1'
export const V2 = '00000000-0000-4000-8000-0000000000d2'
export const E1 = '00000000-0000-4000-8000-0000000000e1'
export const E2 = '00000000-0000-4000-8000-0000000000e2'
export const X1 = '00000000-0000-4000-8000-0000000000f1'
export const D1 = '00000000-0000-4000-8000-000000000011'
export const D2 = '00000000-0000-4000-8000-000000000012'

export const lu = <T>(lignes: T[]): Lecture<T> => ({ lignes, complete: true, motif: null })
export const luEnPartie = <T>(lignes: T[], motif: string): Lecture<T> => ({ lignes, complete: false, motif })

export function dossier(o: Partial<DossierEreporting> = {}): DossierEreporting {
  return {
    id: 'd1', siret: SIRET, statut_tva: 'redevable', article_exoneration: null, numero_tva_attribue: false,
    tva_periodicite: 'trimestrielle', tva_sur_debits: false, ...o,
  }
}

export function regime(o: Partial<RegimeEreporting> = {}): RegimeEreporting {
  return {
    id: R1, dossier_id: 'd1', depuis: '2026-01-01', statut_tva: 'redevable', article_exoneration: null,
    tva_periodicite: 'trimestrielle', tva_sur_debits: false, frequence_transactions: 'mois', frequence_paiements: 'mois',
    note: null, cree_par: 'u1', cree_le: '2026-01-02T10:00:00Z', retire_le: null, retire_par: null, ...o,
  }
}

export function piece(o: Partial<PieceDeLEcran> = {}): PieceDeLEcran {
  return {
    id: P1, dossier_id: 'd1', type_piece: 'achat', devise: 'EUR', montant_ttc: 120, montant_devise: null, montant_tva: null,
    tiers: 'Editeur Logiciel', date_piece: '2027-10-05', nom_fichier: 'facture-logiciel.pdf', ...o,
  }
}

export function fiche(o: Partial<PieceHorsDeFrance> = {}): PieceHorsDeFrance {
  return {
    id: F1, dossier_id: 'd1', piece_id: P1, remplace_id: null, numero: 'INV-1', date_facture: '2027-10-05',
    type_document: '380', facture_origine_numero: null, facture_origine_date: null, devise: 'EUR', pays: 'IE',
    schema_identifiant: '0223', identifiant: 'IE7777777T', nature: 'services', autoliquidation: true, date_operation: null,
    periode_debut: null, periode_fin: null, cree_par: 'u1', cree_le: '2027-10-06T10:00:00Z', retire_le: null, retire_par: null,
    ...o,
  }
}

export function taux(o: Partial<PieceHorsDeFranceTaux> = {}): PieceHorsDeFranceTaux {
  return { fiche_id: F1, dossier_id: 'd1', code_tva: 'AE', taux: 0, base: 120, tva: 0, motif_code: null, motif_texte: null, ...o }
}

export function facture(o: Partial<FactureDeLEcran> = {}): FactureDeLEcran {
  return {
    id: V1, dossier_id: 'd1', statut: 'validee', type: 'facture', date_emission: '2027-10-08', montant_ht: 100,
    montant_tva: 20, montant_ttc: 120, type_client: 'non_assujetti', nature_operation: 'services', option_debits: false,
    date_prestation: null, periode_fin: null, numero: 'F2027-0001', tiers_nom: 'Particulier Fictif', ...o,
  }
}

export function ligne(o: Partial<FactureLigne> = {}): Pick<FactureLigne, 'facture_id' | 'ordre' | 'designation' | 'quantite' | 'prix_unitaire_ht' | 'taux_tva'> {
  return { facture_id: V1, ordre: 0, designation: 'Séance', quantite: 1, prix_unitaire_ht: 100, taux_tva: 20, ...o }
}

export function encaissement(o: Partial<Pick<EncaissementFacture, 'id' | 'dossier_id' | 'facture_id' | 'date_encaissement' | 'montant' | 'annule_id' | 'retire_le'>> = {}) {
  return {
    id: E1, dossier_id: 'd1', facture_id: V1, date_encaissement: '2027-10-15', montant: 120, annule_id: null, retire_le: null, ...o,
  }
}

export function part(o: Partial<Pick<EncaissementFactureTaux, 'encaissement_id' | 'dossier_id' | 'taux' | 'montant'>> = {}) {
  return { encaissement_id: E1, dossier_id: 'd1', taux: 20, montant: 120, ...o }
}

export function ecart(o: Partial<PieceEcarteeEreporting> = {}): PieceEcarteeEreporting {
  return {
    id: X1, dossier_id: 'd1', piece_id: P9, motif: 'Fournisseur établi en France.', cree_par: 'u1',
    cree_le: '2027-10-20T10:00:00Z', retire_le: null, retire_par: null, ...o,
  }
}

/** Les sources du monde, lues en entier : le dossier fictif, son régime, l'achat d'octobre, la vente et son encaissement. */
export function sources(o: Partial<SourcesEreporting> = {}): SourcesEreporting {
  return {
    regimes: lu([regime()]),
    ecarts: lu<PieceEcarteeEreporting>([]),
    declarations: lu<DeclarationEreportingHorsApplication>([]),
    sources: lu<SourceDeclarationEreporting>([]),
    pieces: lu([piece()]),
    fiches: lu([fiche()]),
    taux: lu([taux()]),
    textes: lu([]),
    factures: lu([facture()]),
    lignes: lu([ligne()]),
    encaissements: lu([encaissement()]),
    parts: lu([part()]),
    ...o,
  }
}

/**
 * Une déclaration FAITE : celle que l'application calcule pour cette période, dans ce monde, figée comme la base la garde
 * (le contenu traverse un aller-retour JSON). Les sources sont celles du contenu, comme la fonction de la base les écrit.
 */
export function declaree(
  objet: ObjetEreporting, periode: { debut: string; fin: string }, s: SourcesEreporting = sources(),
  o: Partial<DeclarationEreportingHorsApplication> = {}, d: DossierEreporting = dossier(), aujourdHui = AUJOURDHUI,
): { declaration: DeclarationEreportingHorsApplication; sources: SourceDeclarationEreporting[] } {
  const calcul = declarationCalculee(objet, periode, s, d, aujourdHui)
  const contenu = contenuADeclarer(calcul)
  if (contenu == null) throw new Error('Ce monde ne donne aucun contenu pour cette période.')
  const id = o.id ?? D1
  const genre = objet === 'achats' ? 'fiche' : objet === 'ventes' ? 'facture' : 'encaissement'
  const ids = objet === 'achats'
    ? (contenu as { achats: { ficheId: string }[] }).achats.map((a) => a.ficheId)
    : objet === 'ventes'
      ? (contenu as { transactions: { factures: string[] }[] }).transactions.flatMap((t) => t.factures)
      : (contenu as { paiements: { encaissements: string[] }[] }).paiements.flatMap((p) => p.encaissements)
  return {
    declaration: {
      id, dossier_id: d.id, objet, periode_debut: periode.debut, periode_fin: periode.fin, regime_id: R1,
      type_transmission: 'IN', remplace_id: null, canal: 'manuel', plateforme: 'Plateforme fictive',
      contenu: JSON.parse(JSON.stringify(contenu)) as Record<string, unknown>,
      empreinte: 'a'.repeat(64), nb_operations: ids.length, etat: 'declaree', note: null, cree_par: 'u1',
      cree_le: '2027-11-02T09:00:00Z', ...o,
    },
    sources: ids.map((source_id) => ({ declaration_id: id, dossier_id: d.id, genre, source_id })),
  }
}
