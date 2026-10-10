import type { Emprunt } from '../lib/emprunts'
import type { DonneesDeLaRevision } from '../lib/revision'
import type { DocumentPourRevision, PiecePourRevision } from '../lib/revisionPreuves'
import type {
  ANouveau, Categorie, ControleReleveBancaire, DeclarationTva, EcritureBrouillon, Immobilisation, LigneBancaire,
  NatureImmobilisation, RevisionJustification, RevisionPreuve, SoldeReporte,
} from '../lib/types'
import { A_NOUVEAU_NON_VALIDE, NON_VALIDEE } from './ecritures'

// LES FABRIQUES DES TESTS DE LA RÉVISION (ligne 41, étape R2) : une ligne de chaque table que le module lit, entière —
// colonnes NOT NULL comprises —, que chaque cas complète de ce qui le distingue. Des jeux FICTIFS : aucun libellé, aucun
// nom ne vient d'un dossier réel ; ceux qui suivent servent à prouver que le module n'en recopie aucun.

export const DOSSIER = 'd0551e40-0000-4000-8000-000000000001'
export const AUTEUR = 'a0000000-0000-4000-8000-000000000001'

// Des chaînes qu'un jeu d'essai pose dans les champs que le cabinet ou le client saisit — libellé d'un mouvement, nom
// d'un fichier, d'un tiers, d'un bien, d'un emprunt — : aucune ne doit paraître dans ce que le module compose.
export const MARQUE_SAISIE = 'MARQUE-SAISIE-7Q'

export function ecriture(o: Partial<EcritureBrouillon>): EcritureBrouillon {
  return {
    id: 'e', dossier_id: DOSSIER, piece_id: null, ligne_bancaire_id: null, date: '2025-01-01', compte: '512000',
    libelle: `${MARQUE_SAISIE} écriture`, montant: 1, sens: 'debit', statut: 'proposee', created_at: '2025-01-01T10:00:00Z',
    immobilisation_id: null, vehicule_id: null, declaration_tva_id: null, cotisation_id: null, ...NON_VALIDEE, ...o,
  }
}

export function aNouveau(o: Partial<ANouveau>): ANouveau {
  return {
    id: 'a', dossier_id: DOSSIER, date: '2025-01-01', compte: '512000', compte_origine: null, libelle: `${MARQUE_SAISIE} reprise`,
    sens: 'debit', montant: 1, source_nom: `${MARQUE_SAISIE}-balance.csv`, source_empreinte: 'a'.repeat(64),
    created_at: '2025-01-01T10:00:00Z', ...A_NOUVEAU_NON_VALIDE, ...o,
  }
}

export function soldeReporte(o: Partial<SoldeReporte>): SoldeReporte {
  return {
    id: 's', dossier_id: DOSSIER, date: '2025-01-01', compte: '512000', libelle: 'Banque', sens: 'debit', montant: 1,
    source_nom: 'Exercice 2024 validé', source_empreinte: 'b'.repeat(64), created_at: '2025-01-01T10:00:00Z',
    compte_lib: null, ecriture_lib: null, ...o,
  }
}

export function ligne(o: Partial<LigneBancaire>): LigneBancaire {
  return {
    id: 'l', dossier_id: DOSSIER, date: '2025-01-01', libelle: `${MARQUE_SAISIE} mouvement`, montant: 1, statut: 'rapprochee',
    piece_id: null, cotisation_id: null, categorie_id: null, taux_tva: null, emprunt_id: null, emprunt_echeance: null,
    emprunt_interets: null, emprunt_assurance: null, ventilee: false, reglement_groupe: false, compte_bilan: null,
    declaration_tva_id: null, prelevement_personnel: false, source_fichier: `${MARQUE_SAISIE}-releve.pdf`,
    libelle_brut: `${MARQUE_SAISIE} brut`, id_externe: null, created_at: '2025-01-01T10:00:00Z', ...o,
  }
}

export function controleReleve(o: Partial<ControleReleveBancaire>): ControleReleveBancaire {
  return {
    id: 'c', dossier_id: DOSSIER, source_fichier: `${MARQUE_SAISIE}-releve.pdf`, solde_initial: 0, solde_final: 0,
    somme_mouvements: 0, ecart: 0, coherent: true, periode_debut: '2025-12-01', periode_fin: '2025-12-31',
    created_at: '2026-01-05T10:00:00Z', ...o,
  }
}

export function piece(o: Partial<PiecePourRevision>): PiecePourRevision {
  return { id: 'p', type_piece: 'achat', storage_hash: 'c'.repeat(64), montant_ht: null, montant_tva: null, montant_ttc: null, ...o }
}

export function documentDivers(o: Partial<DocumentPourRevision>): DocumentPourRevision {
  return { id: 'doc', nom_fichier: `${MARQUE_SAISIE}-document.pdf`, categorie: 'autre', storage_hash: 'd'.repeat(64), ...o }
}

export function nature(o: Partial<NatureImmobilisation>): NatureImmobilisation {
  return { id: 'n', dossier_id: null, libelle: `${MARQUE_SAISIE} nature`, duree_annees_defaut: 3, ordre: 1, compte_immobilisation: '218300', ...o }
}

export function bien(o: Partial<Immobilisation>): Immobilisation {
  return {
    id: 'b', dossier_id: DOSSIER, piece_id: null, nature_id: null, libelle: `${MARQUE_SAISIE} bien`, valeur: 1000,
    date_acquisition: '2025-01-01', date_mise_en_service: null, duree_annees: 3, created_at: '2025-01-01T10:00:00Z', ...o,
  }
}

export function emprunt(o: Partial<Emprunt>): Emprunt {
  return {
    id: 'em', dossier_id: DOSSIER, nom: `${MARQUE_SAISIE} prêt`, organisme_preteur: `${MARQUE_SAISIE} banque`,
    capital_initial: 12000, taux_annuel: 0, date_debut: '2025-01-01', duree_mois: 12, created_at: '2025-01-01T10:00:00Z', ...o,
  }
}

export function declaration(o: Partial<DeclarationTva>): DeclarationTva {
  return {
    id: 'dt', dossier_id: DOSSIER, periode_debut: '2025-10-01', periode_fin: '2025-12-31', tva_declaree: 0, credit_anterieur: 0,
    remboursement_demande: 0, date_declaration: null, notes: `${MARQUE_SAISIE} notes`, created_at: '2026-01-10T10:00:00Z', cases: null,
    tva_collectee: null, tva_deductible: null, tva_deductible_immobilisations: null, ...o,
  }
}

export function categorie(o: Partial<Categorie>): Categorie {
  return { id: 'cat', dossier_id: null, code: 'autre', libelle: `${MARQUE_SAISIE} catégorie`, ordre: 1, compte_comptable: null, poste_2035: null, ...o }
}

export function decision(o: Partial<RevisionJustification>): RevisionJustification {
  return {
    id: 'j', dossier_id: DOSSIER, annee: 2025, compte: '512000', solde: 0, etat: 'justifie', motif: null, portee: 'exercice',
    preuve_application: null, remplace_id: null, reprise_de: null, auteur: AUTEUR, cree_le: '2026-02-01T10:00:00+00:00', ...o,
  }
}

export function citation(o: Partial<RevisionPreuve>): RevisionPreuve {
  return {
    id: 'rp', dossier_id: DOSSIER, justification_id: 'j', piece_id: null, document_id: null, fichier_id: null, empreinte: null,
    precision: null, ...o,
  }
}

/** Ce qu'un écran aurait lu d'un dossier vide, exercice 2025 terminé, en trésorerie, non redevable. */
export function donnees(o: Partial<DonneesDeLaRevision>): DonneesDeLaRevision {
  return {
    annee: 2025, anneeCourante: 2026, modele: { mode: 'tresorerie', compteNotesDeFrais: '108000' }, assujettiTva: false,
    periodiciteTva: 'trimestrielle', ecritures: [], reprise: [], reportes: [], exercicesValides: [], verificationPrecedent: null,
    lignes: [], controlesReleves: [], pieces: [], documents: [], immobilisations: [], natures: [], emprunts: [],
    declarationsTva: [], lectureIncomplete: null, categories: [], decisions: [], preuves: [], ...o,
  }
}

/** Les deux lignes d'une écriture équilibrée, numérotées à partir de `id`. */
export function ecritureEquilibree(id: string, date: string, debit: string, credit: string, montant: number, o: Partial<EcritureBrouillon> = {}): EcritureBrouillon[] {
  return [
    ecriture({ id: `${id}-d`, date, compte: debit, sens: 'debit', montant, ...o }),
    ecriture({ id: `${id}-c`, date, compte: credit, sens: 'credit', montant, ...o }),
  ]
}
