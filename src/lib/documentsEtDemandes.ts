// LES DOCUMENTS ET LES DEMANDES DU CABINET (espace client, ligne 51.5, étape B2 ; MEG2-Q9). La migration
// `documents_et_demandes` (supabase/preparees/20261111234000_documents_et_demandes.sql) est PRÉPARÉE, pas appliquée ; elle
// vient après `trois_cases_de_l_acces` (B1), dont elle lit la case « Documents ». Le drapeau se lève le jour où son fichier
// entre dans `supabase/schema/` : ses cinq tables entrent alors au plan de sauvegarde (`auPlanAujourdHui`,
// src/lib/sauvegarde.ts), la suppression d'un dossier vide aussi son seau (src/lib/suppressionDossier.ts), et l'onglet Accès
// dit ce que la case « Documents » ouvre (src/lib/droitsAcces.ts). Les écrans (« Documents » du client, les sections du
// cabinet) et la relance par e-mail sont l'étape B3.
//
// Ce module redit la base : les mots de chaque refus des fonctions, dans leur ordre ; les listes fermées (natures, ce
// qu'une demande attend, les motifs de clôture) ; l'état d'une demande, qui se DÉDUIT et ne se stocke pas ; le libellé de
// chaque texte libre que le cabinet saisit et que le client lit. documentsEtDemandes.test.ts confronte chaque mot et chaque
// liste au texte de la migration. Il n'importe pas le client Supabase.

/** La migration `documents_et_demandes` est-elle en base ? Non : préparée le 11/11/2026 (B2), pas appliquée. */
export const DOCUMENTS_ET_DEMANDES_PREVUS: boolean = false

/**
 * La relance d'une demande PAR E-MAIL (étape B3b) est-elle offerte ? Non : sa migration `relance_des_demandes_par_email`
 * (supabase/preparees/20261111239000, après B1 et B2) est préparée, pas appliquée, et `send-email` la refuse tant que sa
 * constante `RELANCES_DE_DEMANDES_EN_BASE` est baissée. L'ordre : la migration, la fonction redéployée sa constante levée,
 * puis ce drapeau, avec `DOCUMENTS_ET_DEMANDES_PREVUS` ; relancesDeDemandesHttp.test.ts refuse ce drapeau levé sur une
 * fonction qui refuserait la relance. Le bouton qu'il ouvrira reste à écrire (B3b, seconde partie).
 */
export const RELANCE_DES_DEMANDES_PAR_EMAIL_PREVUE: boolean = false

/** Les cinq tables de la migration, dans l'ordre de leur restauration. */
export const TABLES_DES_DOCUMENTS_ET_DEMANDES = [
  'documents_cabinet', 'lectures_documents', 'demandes_cabinet', 'demandes_reponses', 'relances_demandes',
] as const

// ── Les listes fermées de la base ─────────────────────────────────────────────────────────────────────────────────────

/** La nature d'un document mis à disposition : la contrainte `documents_cabinet_nature`, et ses mots. */
export const NATURES_DES_DOCUMENTS = {
  '2035': 'La 2035',
  liasse: 'La liasse fiscale',
  comptes_annuels: 'Les comptes annuels',
  attestation: 'Une attestation',
  lettre_de_mission: 'La lettre de mission',
  courrier: 'Un courrier',
  autre: 'Autre document',
} as const
export type NatureDUnDocument = keyof typeof NATURES_DES_DOCUMENTS

/** Ce qu'une demande attend : la contrainte `demandes_cabinet_attendu`, et ses mots. */
export const CE_QU_ATTEND_UNE_DEMANDE = {
  fichier: 'Un fichier',
  reponse: 'Une réponse',
  les_deux: 'Un fichier et une réponse',
} as const
export type AttenduDUneDemande = keyof typeof CE_QU_ATTEND_UNE_DEMANDE

/** Pourquoi une demande est close : la contrainte `demandes_cabinet_motif` — une liste fermée, aucun texte libre (B2-Q1). */
export const MOTIFS_DE_CLOTURE = {
  satisfaite: 'Satisfaite',
  sans_objet: 'Sans objet',
  remplacee: 'Remplacée par une autre demande',
} as const
export type MotifDeCloture = keyof typeof MOTIFS_DE_CLOTURE

// ── Les libellés des textes libres que le client lit (CLAUDE.md : un texte libre du cabinet, dans une table qu'un droit du
// client ouvre, le dit dans son libellé) ───────────────────────────────────────────────────────────────────────────────
export const LIBELLE_TITRE_DU_DOCUMENT = 'Titre (le client « Documents » le lit)'
export const LIBELLE_OBJET_DE_LA_DEMANDE = 'Objet (tous les accès de ton client le lisent)'
export const LIBELLE_DETAIL_DE_LA_DEMANDE = 'Détail (facultatif ; tous les accès de ton client le lisent)'
export const LIBELLE_TEXTE_DE_LA_REPONSE = 'Ta réponse (ton cabinet et tous les accès de ton dossier la lisent)'

// ── Les refus des fonctions, aux mots de la base, à la lettre (apostrophes droites comprises) ──────────────────────────────────────────────────────────────────────
export const REFUS = {
  accesAuDossier: "Accès refusé à ce dossier.",
  accesAuDocument: "Accès refusé à ce document.",
  accesALaDemande: "Accès refusé à cette demande.",
  titre: "Le titre d'un document est un texte de deux cents caractères au plus, qui ne soit pas vide.",
  nature: "La nature d'un document est la 2035, la liasse, les comptes annuels, une attestation, la lettre de mission, un courrier, ou autre chose.",
  exercice: "L'exercice d'un document est une année entre 2000 et 2100, ou rien.",
  nomDuFichier: "Le nom d'un fichier est un texte de deux cents caractères au plus, qui ne soit pas vide.",
  chemin: "Le fichier d'un document se dépose sous <dossier>/<document>/<empreinte>.<pdf|jpg|png>, dans ce dossier et pour ce document : ce chemin n'a pas cette forme.",
  dejaPublie: "Ce document est déjà publié.",
  fichierAbsent: "Le fichier de ce document n'est pas dans le stockage : le déposer d'abord.",
  fichierInadmis: "Le fichier déposé n'est pas du type que dit son extension, ou dépasse la borne du seau.",
  dejaRetire: "Ce document est déjà retiré.",
  objet: "L'objet d'une demande est un texte de deux cents caractères au plus, qui ne soit pas vide.",
  detail: "Le détail d'une demande est un texte de quatre mille caractères au plus, qui ne soit pas vide, ou rien.",
  attendu: "Une demande attend un fichier, une réponse, ou les deux.",
  echeance: "L'échéance d'une demande ne se fixe pas dans le passé.",
  motif: "Une demande se clôt satisfaite, sans objet, ou remplacée par une autre.",
  dejaClose: "Cette demande est déjà close.",
  closeSansRelance: "Cette demande est close : elle ne se relance plus.",
  rienARepondre: "Une réponse porte un texte, un fichier, ou les deux.",
  texteDeLaReponse: "Le texte d'une réponse est un texte de quatre mille caractères au plus, qui ne soit pas vide.",
  pieceEtDocument: "Une réponse joint une pièce ou un document, pas les deux.",
  closeSansReponse: "Cette demande est close : ton cabinet n'attend plus de réponse.",
  pasSonDepot: "Ce fichier n'est pas un dépôt que tu as fait pour cette demande.",
} as const

/** Un texte qui n'est pas vide une fois ses blancs ôtés — le `btrim(…) <> ''` de la base, qui ôte les espaces. */
const nonVide = (texte: string) => texte.replace(/^ +| +$/g, '') !== ''

/** La longueur d'un texte en caractères, comme `char_length` (et non en unités UTF-16). */
const caracteres = (texte: string) => [...texte].length

/** Ce que le cabinet saisit pour mettre un document à disposition, avant le dépôt de son fichier. */
export interface SaisieDUnDocument {
  titre: string
  nature: string
  exercice: number | null
  nomFichier: string
}

/** Le refus d'une publication, dit avant le clic, dans l'ordre de `publier_document_du_cabinet` ; nul si elle peut partir. */
export function refusDeLaPublication(saisie: SaisieDUnDocument): string | null {
  if (!nonVide(saisie.titre) || caracteres(saisie.titre) > 200) return REFUS.titre
  if (!(saisie.nature in NATURES_DES_DOCUMENTS)) return REFUS.nature
  if (saisie.exercice !== null && !(Number.isInteger(saisie.exercice) && saisie.exercice >= 2000 && saisie.exercice <= 2100)) {
    return REFUS.exercice
  }
  if (!nonVide(saisie.nomFichier) || caracteres(saisie.nomFichier) > 200) return REFUS.nomDuFichier
  return null
}

/** Ce que le cabinet saisit pour ouvrir une demande. `echeance` est une date civile `AAAA-MM-JJ`, ou nulle. */
export interface SaisieDUneDemande {
  objet: string
  detail: string | null
  echeance: string | null
  attendu: string
}

/**
 * Le refus d'une demande, dit avant le clic, dans l'ordre d'`ouvrir_demande` ; nul si elle peut partir. `aujourdhui` est le
 * jour de Paris (`AAAA-MM-JJ`), celui que la base lit : une échéance d'aujourd'hui est admise, celle d'hier non.
 */
export function refusDeLaDemande(saisie: SaisieDUneDemande, aujourdhui: string): string | null {
  if (!nonVide(saisie.objet) || caracteres(saisie.objet) > 200) return REFUS.objet
  if (saisie.detail !== null && (!nonVide(saisie.detail) || caracteres(saisie.detail) > 4000)) return REFUS.detail
  if (!(saisie.attendu in CE_QU_ATTEND_UNE_DEMANDE)) return REFUS.attendu
  if (saisie.echeance !== null && (saisie.echeance < aujourdhui || saisie.echeance > '2100-12-31')) return REFUS.echeance
  return null
}

/** Ce que le client envoie pour répondre : un texte, une pièce ou un document qu'il vient de déposer. */
export interface SaisieDUneReponse {
  texte: string | null
  pieceId: string | null
  documentId: string | null
}

/**
 * Le refus d'une réponse, dit avant le clic, dans l'ordre de `repondre_a_la_demande` pour ce que l'écran sait ; nul si elle
 * peut partir. Ce que seule la base sait — le dépôt est-il bien le sien, fait depuis l'ouverture — se dit après le clic.
 */
export function refusDeLaReponse(saisie: SaisieDUneReponse, demandeClose: boolean): string | null {
  if (saisie.texte === null && saisie.pieceId === null && saisie.documentId === null) return REFUS.rienARepondre
  if (saisie.texte !== null && (!nonVide(saisie.texte) || caracteres(saisie.texte) > 4000)) return REFUS.texteDeLaReponse
  if (saisie.pieceId !== null && saisie.documentId !== null) return REFUS.pieceEtDocument
  if (demandeClose) return REFUS.closeSansReponse
  return null
}

/** Le refus d'une clôture, dit avant le clic, dans l'ordre de `clore_demande` ; nul si elle peut partir. */
export function refusDeLaCloture(motif: string, demandeClose: boolean): string | null {
  if (!(motif in MOTIFS_DE_CLOTURE)) return REFUS.motif
  if (demandeClose) return REFUS.dejaClose
  return null
}

// ── L'état d'une demande, déduit ──────────────────────────────────────────────────────────────────────────────────────
export type EtatDUneDemande = 'close' | 'repondue' | 'en_retard' | 'ouverte'

export const MOTS_DE_L_ETAT: Readonly<Record<EtatDUneDemande, string>> = {
  close: 'Close',
  repondue: 'Répondue',
  en_retard: 'En retard',
  ouverte: 'Ouverte',
}

/** Une demande telle que la base la rend, réduite à ce dont son état dépend. */
export interface DemandeLue {
  echeance: string | null
  close_le: string | null
}

/**
 * L'état d'une demande : close si elle porte sa clôture ; sinon répondue dès sa première réponse ; sinon en retard, son
 * échéance passée au jour de Paris ; sinon ouverte. `nombreDeReponses` vient d'une liste lue EN ENTIER : sur une lecture
 * partielle, l'appelant ne déduit aucun état (le vide est une affirmation).
 */
export function etatDUneDemande(demande: DemandeLue, nombreDeReponses: number, aujourdhui: string): EtatDUneDemande {
  if (demande.close_le !== null) return 'close'
  if (nombreDeReponses > 0) return 'repondue'
  if (demande.echeance !== null && demande.echeance < aujourdhui) return 'en_retard'
  return 'ouverte'
}
