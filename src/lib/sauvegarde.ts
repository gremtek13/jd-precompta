// Socle de la sauvegarde et de la restauration : l'ordre des tables, le graphe de leurs dépendances,
// et le contrôle qui dit si une restauration a VRAIMENT tout remis.
//
// Pourquoi ce fichier existe, et pourquoi il ne parle pas au réseau : la partie qui se trompe dans
// une restauration n'est pas l'accès à la base, c'est l'ORDRE et la COMPLÉTUDE. Les deux sont de la
// logique pure, donc testables sans rien simuler — et c'est la seule façon de répéter une
// restauration à chaque exécution de la suite de tests plutôt qu'une fois par an.
//
// Tout ce qui suit est LU du schéma réel (pg_constraint) le 18/09/2026, jamais supposé — et
// `sauvegardeRelations.test.ts` le compare au schéma exporté à chaque exécution : une clé étrangère
// ajoutée par une migration et oubliée ici fait échouer la suite, action à la suppression comprise.

import { ADRESSES_RECEPTION_EXPORTEES } from './adressesReception'
import { ARTICLES_EXPORTES } from './articles'
import { CONTACTS_EXPORTES } from './contacts'
import { DEVIS_EXPORTES } from './devis'
import { EXEMPLAIRES_DES_FACTURES_EXPORTES } from './exemplairesDesFactures'
import { PARAMETRES_FACTURATION_EXPORTES } from './parametresFacturation'

/** Une relation de clé étrangère, telle que Postgres la déclare. */
export interface Relation {
  /** La table qui porte la colonne. */
  enfant: string
  /** La table pointée. Elle doit exister AVANT l'enfant. */
  parent: string
  colonne: string
  /** Ce que fait Postgres quand la ligne parente disparaît. */
  aLaSuppression: 'cascade' | 'bloque' | 'met_a_null'
}

// LES DEVIS (espace client, étape P5 ; migrations devis_du_client et devis_du_client_suppression, présentées au cabinet,
// PAS ENCORE APPLIQUÉES). Leurs trois tables sont déclarées ci-dessous à leur place — relations, ordre, chemins, clé de la
// série — et RETIRÉES du plan tant que `DEVIS_EXPORTES` (src/lib/devis.ts) est baissé : la production ne les a pas, et
// lire une table absente ferait échouer toute sauvegarde. Le jour où l'export porte les migrations, lever le drapeau les
// met au plan, et les tests qui confrontent le plan au schéma exporté les jugent comme les autres. Les listes « prévues »
// sont le plan tel qu'il sera : restaurationEssai.test.ts et sauvegardeDevis.test.ts l'éprouvent avant le jour.
export const TABLES_DES_DEVIS: readonly string[] = ['devis', 'devis_factures', 'devis_numerotation']

/** Une table au plan de sauvegarde : toutes, sauf celles des devis tant que leurs migrations ne sont pas exportées. */
export function auPlan(table: string, devisExportes: boolean): boolean {
  return devisExportes || !TABLES_DES_DEVIS.includes(table)
}

// LES ARTICLES (espace client, étape A1 ; migration `articles`, présentée au cabinet et appliquée sur son accord) : le
// patron des devis, sous leur propre drapeau (`ARTICLES_EXPORTES`, src/lib/articles.ts), levé. Leur table est déclarée
// ci-dessous à sa place — sa relation, son rang, son chemin — et serait RETIRÉE du plan le drapeau rebaissé (avant tout
// retour arrière de la migration) ; sauvegardeArticles.test.ts éprouve le plan prévu et le plan du jour.
export const TABLES_DES_ARTICLES: readonly string[] = ['articles']

/** Une table au plan, côté articles : toutes, sauf la leur tant que sa migration n'est pas exportée. */
export function auPlanDesArticles(table: string, articlesExportes: boolean): boolean {
  return articlesExportes || !TABLES_DES_ARTICLES.includes(table)
}

// LES ADRESSES DE RÉCEPTION (espace client, étape A6a ; migration `adresses_reception`, présentée au cabinet et appliquée
// sur son accord) : le patron des articles, sous leur propre drapeau (`ADRESSES_RECEPTION_EXPORTEES`,
// src/lib/adressesReception.ts), levé. Leur table est déclarée ci-dessous à sa place — ses deux relations, son rang, son
// chemin, et sa vague (une version remplace la courante, `remplace_id`) — et serait RETIRÉE du plan le drapeau rebaissé
// (avant tout retour arrière de la migration) ; sauvegardeAdressesReception.test.ts éprouve le plan prévu et le plan du
// jour.
export const TABLES_DES_ADRESSES_RECEPTION: readonly string[] = ['adresses_reception']

/** Une table au plan, côté adresses de réception : toutes, sauf la leur tant que sa migration n'est pas exportée. */
export function auPlanDesAdressesReception(table: string, adressesExportees: boolean): boolean {
  return adressesExportees || !TABLES_DES_ADRESSES_RECEPTION.includes(table)
}

// LES CONTACTS (espace client, étape A4a ; migration `contacts`, présentée au cabinet et appliquée sur son accord) : le
// patron des adresses de réception, sous leur propre drapeau (`CONTACTS_EXPORTES`, src/lib/contacts.ts), levé. Leur
// table est déclarée ci-dessous à sa place — sa relation, son rang, son chemin ; aucune vague, un contact ne pointe aucun
// contact — et serait RETIRÉE du plan le drapeau rebaissé (avant tout retour arrière de la migration) ;
// sauvegardeContacts.test.ts éprouve le plan prévu et le plan du jour.
export const TABLES_DES_CONTACTS: readonly string[] = ['contacts']

/** Une table au plan, côté contacts : toutes, sauf la leur tant que sa migration n'est pas exportée. */
export function auPlanDesContacts(table: string, contactsExportes: boolean): boolean {
  return contactsExportes || !TABLES_DES_CONTACTS.includes(table)
}

// LES PARAMÈTRES DE FACTURATION (espace client, étape A5a ; migration `parametres_facturation`, présentée au cabinet et
// appliquée sur son accord) : le patron des adresses de réception, sous leur propre drapeau
// (`PARAMETRES_FACTURATION_EXPORTES`, src/lib/parametresFacturation.ts), levé. Leur table est déclarée ci-dessous à sa
// place — ses deux relations, son rang, son chemin, et sa vague (une version remplace la courante, `remplace_id`) — et
// serait RETIRÉE du plan le drapeau rebaissé (avant tout retour arrière de la migration) ;
// sauvegardeParametresFacturation.test.ts éprouve le plan prévu et le plan du jour.
export const TABLES_DES_PARAMETRES_FACTURATION: readonly string[] = ['parametres_facturation']

/** Une table au plan, côté paramètres de facturation : toutes, sauf la leur tant que sa migration n'est pas exportée. */
export function auPlanDesParametresFacturation(table: string, parametresExportes: boolean): boolean {
  return parametresExportes || !TABLES_DES_PARAMETRES_FACTURATION.includes(table)
}

/** Une table au plan AUJOURD'HUI : celles d'une migration préparée seulement son drapeau levé — les devis, les articles, les
 *  adresses de réception, les contacts, les paramètres de facturation. */
export function auPlanAujourdHui(table: string): boolean {
  return auPlan(table, DEVIS_EXPORTES) && auPlanDesArticles(table, ARTICLES_EXPORTES)
    && auPlanDesAdressesReception(table, ADRESSES_RECEPTION_EXPORTEES) && auPlanDesContacts(table, CONTACTS_EXPORTES)
    && auPlanDesParametresFacturation(table, PARAMETRES_FACTURATION_EXPORTES)
}

// L'EXEMPLAIRE D'UNE FACTURE (chantier EC-Q3, étape VF1a ; migration `exemplaires_des_factures`, en base et dans l'export
// depuis le 18/10/2026) : ni table, ni rang, ni chemin nouveaux — une COLONNE de plus sur une table au plan,
// `pieces.facture_id`, et sa clé vers `factures_emises`, sans action à la suppression (une facture validée ne se supprime
// qu'avec son dossier). Les factures précèdent déjà les pièces dans l'ordre de restauration, ce que la clé exige, et la
// sauvegarde recopie des lignes entières (`select('*')`) : une pièce désignée se réinsère désignée, par la porte que la
// garde ouvre au super-administrateur. La relation est déclarée ci-dessous à sa place ; elle quitterait le graphe du jour si
// `EXEMPLAIRES_DES_FACTURES_EXPORTES` (src/lib/exemplairesDesFactures.ts) était rebaissé, avant un retour arrière de la
// migration — sauvegardeRelations.test.ts juge ce graphe contre l'export. Levé, `liensPerdus` refuse avant toute écriture
// la sauvegarde d'une pièce désignée dont la facture manque. sauvegardeExemplaires.test.ts éprouve le graphe prévu et le
// graphe du jour, sous chaque état du drapeau.
export const RELATIONS_DES_EXEMPLAIRES: readonly Pick<Relation, 'enfant' | 'colonne'>[] = [{ enfant: 'pieces', colonne: 'facture_id' }]

/** Une relation au graphe, côté exemplaires : toutes, sauf la désignation tant que sa migration n'est pas exportée. */
export function auGrapheDesExemplaires(relation: Pick<Relation, 'enfant' | 'colonne'>, exemplairesExportes: boolean): boolean {
  return exemplairesExportes
    || !RELATIONS_DES_EXEMPLAIRES.some((r) => r.enfant === relation.enfant && r.colonne === relation.colonne)
}

// Le graphe complet des dépendances entre tables du schéma `public`. Les relations vers `auth.users`
// sont volontairement absentes : cette table n'appartient pas à l'application, elle n'est ni
// sauvegardée ni restaurée par ce chemin, et l'y faire figurer donnerait l'illusion du contraire.
export const RELATIONS_PREVUES: readonly Relation[] = [
  { enfant: 'a_nouveaux', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'agent_conversations', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'cabinet_admins', parent: 'cabinets', colonne: 'cabinet_id', aLaSuppression: 'bloque' },
  { enfant: 'categories', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'comptes_courants_associes', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'connexions_bancaires', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'connexions_plateformes', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'controles_releves_bancaires', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'cotisations_declarees', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'declarations_ereporting', parent: 'declarations_ereporting', colonne: 'remplace_id', aLaSuppression: 'bloque' },
  { enfant: 'declarations_ereporting', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'declarations_ereporting', parent: 'regimes_ereporting', colonne: 'regime_id', aLaSuppression: 'bloque' },
  { enfant: 'declarations_ereporting_sources', parent: 'declarations_ereporting', colonne: 'declaration_id', aLaSuppression: 'cascade' },
  { enfant: 'declarations_ereporting_sources', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'declarations_tva', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'devis', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'devis_factures', parent: 'devis', colonne: 'devis_id', aLaSuppression: 'cascade' },
  { enfant: 'devis_factures', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'devis_factures', parent: 'factures_emises', colonne: 'facture_id', aLaSuppression: 'cascade' },
  { enfant: 'devis_numerotation', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'documents_divers', parent: 'cotisations_declarees', colonne: 'attached_to_cotisation_id', aLaSuppression: 'met_a_null' },
  { enfant: 'documents_divers', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'documents_divers', parent: 'sous_dossiers', colonne: 'sous_dossier_id', aLaSuppression: 'bloque' },
  { enfant: 'dossier_assignations', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'dossier_permanent', parent: 'dossier_permanent', colonne: 'remplace_id', aLaSuppression: 'bloque' },
  { enfant: 'dossier_permanent', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'dossiers', parent: 'cabinets', colonne: 'cabinet_id', aLaSuppression: 'bloque' },
  { enfant: 'ecritures_brouillon', parent: 'cotisations_declarees', colonne: 'cotisation_id', aLaSuppression: 'cascade' },
  { enfant: 'ecritures_brouillon', parent: 'declarations_tva', colonne: 'declaration_tva_id', aLaSuppression: 'bloque' },
  { enfant: 'ecritures_brouillon', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  // La vente facturée (chantier EC-Q3, étapes VF2 et VF4 ; migration `source_de_la_vente`) : l'encaissement ou la facture
  // source qu'une écriture porte, sans action à la suppression. Les encaissements et les factures précèdent déjà le
  // brouillon dans l'ordre de restauration, ce que les clés exigent ; sauvegardeVenteFacturee.test.ts l'éprouve.
  { enfant: 'ecritures_brouillon', parent: 'encaissements_factures', colonne: 'encaissement_id', aLaSuppression: 'bloque' },
  { enfant: 'ecritures_brouillon', parent: 'factures_emises', colonne: 'facture_id', aLaSuppression: 'bloque' },
  { enfant: 'ecritures_brouillon', parent: 'immobilisations', colonne: 'immobilisation_id', aLaSuppression: 'bloque' },
  { enfant: 'ecritures_brouillon', parent: 'lignes_bancaires', colonne: 'ligne_bancaire_id', aLaSuppression: 'met_a_null' },
  { enfant: 'ecritures_brouillon', parent: 'pieces', colonne: 'piece_id', aLaSuppression: 'met_a_null' },
  { enfant: 'ecritures_brouillon', parent: 'vehicules', colonne: 'vehicule_id', aLaSuppression: 'bloque' },
  { enfant: 'emails_envoyes', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'emails_envoyes', parent: 'factures_emises', colonne: 'facture_id', aLaSuppression: 'met_a_null' },
  { enfant: 'emprunts', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'encaissements_factures', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'encaissements_factures', parent: 'encaissements_factures', colonne: 'annule_id', aLaSuppression: 'bloque' },
  { enfant: 'encaissements_factures', parent: 'factures_emises', colonne: 'facture_id', aLaSuppression: 'cascade' },
  { enfant: 'encaissements_factures', parent: 'lignes_bancaires', colonne: 'ligne_bancaire_id', aLaSuppression: 'bloque' },
  { enfant: 'encaissements_factures_taux', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'encaissements_factures_taux', parent: 'encaissements_factures', colonne: 'encaissement_id', aLaSuppression: 'cascade' },
  { enfant: 'exercices_clotures', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'exercices_valides', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'facture_lignes', parent: 'factures_emises', colonne: 'facture_id', aLaSuppression: 'cascade' },
  { enfant: 'facture_numerotation', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'facture_superpdp_events', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'facture_superpdp_events', parent: 'factures_emises', colonne: 'facture_id', aLaSuppression: 'cascade' },
  { enfant: 'factures_emises', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'factures_emises', parent: 'factures_emises', colonne: 'facture_origine_id', aLaSuppression: 'bloque' },
  { enfant: 'immobilisations', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'immobilisations', parent: 'natures_immobilisation', colonne: 'nature_id', aLaSuppression: 'bloque' },
  { enfant: 'immobilisations', parent: 'pieces', colonne: 'piece_id', aLaSuppression: 'met_a_null' },
  { enfant: 'informations_dossier', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'justificatifs_proposes', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'justificatifs_proposes', parent: 'lignes_bancaires', colonne: 'ligne_bancaire_id', aLaSuppression: 'cascade' },
  { enfant: 'justificatifs_proposes', parent: 'pieces', colonne: 'piece_id', aLaSuppression: 'cascade' },
  { enfant: 'lettrages_manuels', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'lettrages_manuels', parent: 'pieces', colonne: 'piece_id', aLaSuppression: 'met_a_null' },
  { enfant: 'lignes_bancaires', parent: 'categories', colonne: 'categorie_id', aLaSuppression: 'bloque' },
  { enfant: 'lignes_bancaires', parent: 'cotisations_declarees', colonne: 'cotisation_id', aLaSuppression: 'met_a_null' },
  { enfant: 'lignes_bancaires', parent: 'declarations_tva', colonne: 'declaration_tva_id', aLaSuppression: 'bloque' },
  { enfant: 'lignes_bancaires', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'lignes_bancaires', parent: 'emprunts', colonne: 'emprunt_id', aLaSuppression: 'bloque' },
  { enfant: 'lignes_bancaires', parent: 'pieces', colonne: 'piece_id', aLaSuppression: 'met_a_null' },
  { enfant: 'memberships', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'mouvements_cca', parent: 'comptes_courants_associes', colonne: 'compte_id', aLaSuppression: 'cascade' },
  { enfant: 'natures_immobilisation', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'notes_internes', parent: 'documents_divers', colonne: 'document_id', aLaSuppression: 'cascade' },
  { enfant: 'notes_internes', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'notes_internes', parent: 'pieces', colonne: 'piece_id', aLaSuppression: 'cascade' },
  { enfant: 'packs', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'piece_commentaires', parent: 'documents_divers', colonne: 'document_id', aLaSuppression: 'cascade' },
  { enfant: 'piece_commentaires', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'piece_commentaires', parent: 'pieces', colonne: 'piece_id', aLaSuppression: 'cascade' },
  { enfant: 'piece_textes_ocr', parent: 'documents_divers', colonne: 'document_id', aLaSuppression: 'cascade' },
  { enfant: 'piece_textes_ocr', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'piece_textes_ocr', parent: 'pieces', colonne: 'piece_id', aLaSuppression: 'cascade' },
  { enfant: 'pieces', parent: 'categories', colonne: 'categorie_id', aLaSuppression: 'bloque' },
  { enfant: 'pieces', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'pieces', parent: 'sous_dossiers', colonne: 'sous_dossier_id', aLaSuppression: 'met_a_null' },
  { enfant: 'pieces_ecartees_ereporting', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'pieces_ecartees_ereporting', parent: 'pieces', colonne: 'piece_id', aLaSuppression: 'cascade' },
  { enfant: 'pieces_hors_de_france', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'pieces_hors_de_france', parent: 'pieces', colonne: 'piece_id', aLaSuppression: 'cascade' },
  { enfant: 'pieces_hors_de_france', parent: 'pieces_hors_de_france', colonne: 'remplace_id', aLaSuppression: 'bloque' },
  { enfant: 'pieces_hors_de_france_taux', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'pieces_hors_de_france_taux', parent: 'pieces_hors_de_france', colonne: 'fiche_id', aLaSuppression: 'cascade' },
  { enfant: 'plan_comptable_dossier', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'plan_comptable_dossier', parent: 'roles_comptables', colonne: 'role', aLaSuppression: 'bloque' },
  { enfant: 'precisions_mouvements', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'precisions_mouvements', parent: 'lignes_bancaires', colonne: 'ligne_bancaire_id', aLaSuppression: 'cascade' },
  { enfant: 'previsionnels_bancaires', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'references_annuelles', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'references_postes_annuels', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'regimes_ereporting', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'reglements_groupes', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'reglements_groupes', parent: 'lignes_bancaires', colonne: 'ligne_bancaire_id', aLaSuppression: 'cascade' },
  { enfant: 'reglements_groupes', parent: 'pieces', colonne: 'piece_id', aLaSuppression: 'met_a_null' },
  { enfant: 'regles_affectation_bancaire', parent: 'categories', colonne: 'categorie_id', aLaSuppression: 'bloque' },
  { enfant: 'regles_affectation_bancaire', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'regles_bancaires_ignorees', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'revision_justifications', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'revision_justifications', parent: 'revision_justifications', colonne: 'remplace_id', aLaSuppression: 'bloque' },
  { enfant: 'revision_justifications', parent: 'revision_justifications', colonne: 'reprise_de', aLaSuppression: 'bloque' },
  { enfant: 'revision_preuves', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'revision_preuves', parent: 'revision_justifications', colonne: 'justification_id', aLaSuppression: 'cascade' },
  { enfant: 'revision_conclusions', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'revision_conclusions', parent: 'revision_conclusions', colonne: 'remplace_id', aLaSuppression: 'bloque' },
  { enfant: 'revision_notes', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'revision_revues', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'revision_revues', parent: 'revision_conclusions', colonne: 'conclusion_id', aLaSuppression: 'bloque' },
  { enfant: 'revision_seuils', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'revision_seuils', parent: 'revision_seuils', colonne: 'remplace_id', aLaSuppression: 'bloque' },
  { enfant: 'revision_explications', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'revision_explications', parent: 'revision_explications', colonne: 'remplace_id', aLaSuppression: 'bloque' },
  { enfant: 'soldes_reportes', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'sous_dossiers', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'statuts_factures_recus', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'statuts_factures_recus', parent: 'factures_emises', colonne: 'facture_id', aLaSuppression: 'bloque' },
  { enfant: 'superpdp_credentials', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'supplements', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'supplements', parent: 'factures_emises', colonne: 'facture_id', aLaSuppression: 'met_a_null' },
  { enfant: 'tiers_categories', parent: 'categories', colonne: 'categorie_id', aLaSuppression: 'bloque' },
  { enfant: 'tiers_categories', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'tiers_categories_cabinet', parent: 'cabinets', colonne: 'cabinet_id', aLaSuppression: 'bloque' },
  { enfant: 'tiers_categories_cabinet', parent: 'categories', colonne: 'categorie_id', aLaSuppression: 'bloque' },
  { enfant: 'transmissions_encaissements', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'transmissions_encaissements', parent: 'encaissements_factures', colonne: 'encaissement_id', aLaSuppression: 'bloque' },
  { enfant: 'transmissions_encaissements', parent: 'factures_emises', colonne: 'facture_id', aLaSuppression: 'bloque' },
  { enfant: 'transmissions_factures', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'transmissions_factures', parent: 'factures_emises', colonne: 'facture_id', aLaSuppression: 'cascade' },
  { enfant: 'vehicules', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'ventilations_bancaires', parent: 'categories', colonne: 'categorie_id', aLaSuppression: 'bloque' },
  { enfant: 'ventilations_bancaires', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'ventilations_bancaires', parent: 'lignes_bancaires', colonne: 'ligne_bancaire_id', aLaSuppression: 'cascade' },
  { enfant: 'volet_social_pamc', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  // Les pièces jointes écartées à la réception par e-mail (ligne 22.7) : seulement leur dossier.
  { enfant: 'pieces_jointes_ecartees', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  // Les articles (espace client, étape A1) : seulement leur dossier, jusqu'à l'étape A7.
  { enfant: 'articles', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  // Les adresses de réception (espace client, étape A6a) : leur dossier, et la version qu'une adresse remplace.
  { enfant: 'adresses_reception', parent: 'adresses_reception', colonne: 'remplace_id', aLaSuppression: 'bloque' },
  { enfant: 'adresses_reception', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  // Les contacts (espace client, étape A4a) : seulement leur dossier — une facture n'en garde que la copie.
  { enfant: 'contacts', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  // Les paramètres de facturation (espace client, étape A5a) : leur dossier, et la version qu'une version remplace.
  { enfant: 'parametres_facturation', parent: 'parametres_facturation', colonne: 'remplace_id', aLaSuppression: 'bloque' },
  { enfant: 'parametres_facturation', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  // L'exemplaire d'une facture (chantier EC-Q3, étape VF1a) : la facture émise validée dont la pièce est un exemplaire.
  { enfant: 'pieces', parent: 'factures_emises', colonne: 'facture_id', aLaSuppression: 'bloque' },
]

// Le graphe tel que la base l'a AUJOURD'HUI : sans les relations des devis, des articles, des adresses de réception, des
// contacts ni des paramètres de facturation tant que leurs migrations ne sont pas exportées, ni celle de l'exemplaire d'une
// facture tant que la sienne ne l'est pas.
export const RELATIONS: readonly Relation[] = RELATIONS_PREVUES
  .filter((r) => auPlanAujourdHui(r.enfant) && auGrapheDesExemplaires(r, EXEMPLAIRES_DES_FACTURES_EXPORTES))

// Les liens qu'une GARDE tient, et non une clé étrangère (ligne 41, étape R1, migration revision_des_soldes). Une preuve
// de la révision cite une pièce ou un document de son dossier : la garde `garder_revision_preuve` le vérifie à
// l'insertion, et `garder_source_citee` refuse ensuite de supprimer ou de déplacer la source — une règle que le cabinet
// peut encore changer (hypothèse Q8), d'où une fonction plutôt qu'une clé qu'il faudrait alors retirer. Pour la
// restauration, ils comptent comme des clés sans action : la source doit être écrite AVANT la preuve, et une source
// absente de la sauvegarde est un lien perdu, que rien ne permet d'effacer (une preuve cite exactement une source).
// `sauvegarde.test.ts` les confronte au texte de la garde, et à l'absence de clé dans l'export.
//
// Une entrée du dossier permanent (étape R7, migration `dossier_permanent`) cite de même AU PLUS une pièce ou un document
// de son dossier, sans clé : `garder_dossier_permanent` le vérifie à l'insertion, la même `garder_source_citee` garde la
// source ensuite. Un lien perdu ne s'efface pas non plus : une entrée ne se modifie pas, et celle qui ne dit rien d'autre
// que sa citation ne dirait plus rien.
export const LIENS_GARDES: readonly Relation[] = [
  { enfant: 'revision_preuves', parent: 'documents_divers', colonne: 'document_id', aLaSuppression: 'bloque' },
  { enfant: 'revision_preuves', parent: 'pieces', colonne: 'piece_id', aLaSuppression: 'bloque' },
  { enfant: 'dossier_permanent', parent: 'documents_divers', colonne: 'document_id', aLaSuppression: 'bloque' },
  { enfant: 'dossier_permanent', parent: 'pieces', colonne: 'piece_id', aLaSuppression: 'bloque' },
]

/** Tout ce que la restauration doit respecter : les clés étrangères, et les liens qu'une garde tient. */
export const TOUS_LES_LIENS: readonly Relation[] = [...RELATIONS, ...LIENS_GARDES]

// L'ordre dans lequel réinsérer les tables pour qu'une restauration aboutisse : toute table parente
// précède ses enfants. Calculé par tri topologique sur RELATIONS, puis figé ici — et vérifié à chaque
// exécution des tests contre RELATIONS, de sorte qu'une relation ajoutée sans reclasser la liste
// casse bruyamment au lieu de casser une nuit de restauration.
//
// Les tables sans aucune dépendance (cabinets, super_admins, taux_change_bce, roles_comptables) viennent en tête ;
// `ecritures_brouillon` suit tout le reste de la chaîne comptable, dont elle dépend.
//
// `exercices_valides` ferme la marche, et ce n'est pas le tri qui l'y met : son seul parent est le dossier.
// Réinsérée, une validation fige son exercice — la base refuse alors d'y poser un mouvement, une part, un
// bien, une ligne du cadre 7, une échéance, un à-nouveau ou une écriture, et ne laisse le super-administrateur
// réinsérer une écriture DÉJÀ validée, ou un solde reporté sur l'exercice suivant (ligne 34), que dans un dossier
// qui n'a encore aucun exercice validé. Posée avant, elle ferait échouer la restauration de tout ce qui la suit.
// `sauvegarde.test.ts` la garde en dernier.
//
// `encaissements_factures_taux` suit `facture_lignes` pour une raison que le graphe ne dit pas : son déclencheur
// refuse une part dont le taux n'est pas celui d'une ligne de la facture, et il le lit dans `facture_lignes`, sans
// clé étrangère. `sauvegarde.test.ts` garde aussi cet ordre-là.
//
// `transmissions_encaissements` suit `transmissions_factures` et `facture_superpdp_events` pour la même raison (étape
// d4) : sa garde refuse une déclaration qui n'est pas faite sur la plateforme qui a reçu la facture, ou d'une facture
// que cette plateforme n'a pas acceptée — et elle le lit dans ces deux tables, sans clé étrangère. Les déclarations,
// elles, se réinsèrent dans n'importe quel ordre : celle d'une contre-passation ne lit pas celle de l'encaissement
// qu'elle annule. `sauvegarde.test.ts` garde cet ordre.
//
// `statuts_factures_recus` précède `transmissions_factures` et `transmissions_encaissements` (étape d7) : leurs gardes
// refusent la transmission d'une facture refusée ou rejetée sur sa plateforme, celle de l'avoir qui l'annule et la
// déclaration de son encaissement — et le lisent là, sans clé étrangère. Elles ne comptent qu'un statut lu AVANT la
// ligne qu'elles gardent (`lu_le`, que la restauration rejoue) : réinsérés d'abord, les statuts laissent passer tout ce
// qui les précédait, et refusent ce qui n'aurait pas pu naître après eux. `sauvegarde.test.ts` garde cet ordre.
//
// La révision des comptes (ligne 41, étape R1) vient après le brouillon et avant `exercices_valides` : ses décisions ne
// lisent rien qu'une validation fige, et une décision prise APRÈS la validation se restaure comme une autre. Les
// décisions partent par vagues (`TABLES_AUTO_REFERENCEES_PAR_VAGUES`) ; leurs preuves suivent les pièces et les
// documents qu'elles citent, que leur garde lit sans clé étrangère (`LIENS_GARDES`, que `violationsOrdre` compte).
// Les cycles de la révision (étape R4) les suivent, pour la même raison : rien de ce qu'une validation fige ne les
// concerne. Les conclusions partent par vagues (`remplace_id`), leurs revues après elles, le journal n'importe où.
// La revue analytique (étape R5) les suit à son tour : le seuil de signification d'un exercice et les explications de ses
// variations ne lisent, à l'insertion, que le seuil ou l'explication qu'ils remplacent — leurs gardes ne lisent ni la
// validation ni le brouillon ; les montants, la base ne les vérifie que dans `expliquer_variation`, que la restauration
// ne rejoue pas. Les deux chaînes partent par vagues (`remplace_id`). `sauvegarde.test.ts` garde cet ordre.
//
// La fiche « hors de France » d'une pièce (ligne 28.5, étape e2) suit les pièces qu'elle décrit et PRÉCÈDE le brouillon :
// sa garde refuse une fiche sur une pièce qu'une écriture validée fige — la sienne ou celle de son bien —, et le lit
// dans `ecritures_brouillon`, sans clé étrangère. Réinsérées avant les écritures, ses versions passent telles qu'elles
// ont été écrites, par vagues (`remplace_id`), et sa ventilation la suit. `sauvegarde.test.ts` garde cet ordre.
//
// Le plan comptable d'un dossier (ligne 43, étape PC1) se réinsère JUSTE APRÈS son dossier, avant tout ce qui porte un
// compte : sa garde n'admet la restauration que dans un dossier qui n'a encore ni écriture, ni à-nouveau, ni solde
// reporté — et les écritures d'une pièce devront, à l'étape PC4, trouver le plan du dossier déjà là. Le catalogue des
// rôles (`roles_comptables`) vient en tête, avec les autres tables sans parent : posé par migration dans toute base, il
// n'est dans aucune sauvegarde d'un dossier (`PARENTS_HORS_PLAN_VOULUS`). `sauvegarde.test.ts` garde cet ordre.
//
// Les propositions de justificatif et les précisions sur un mouvement (espace client, étape P7, migration
// `banque_du_client`) suivent les mouvements et les pièces qu'elles désignent, et précèdent `exercices_valides` sans
// qu'il le faille : aucune de leurs gardes ne lit une validation. À l'insertion, elles ne refusent qu'une ligne dont
// le mouvement ou la pièce n'est pas de son dossier ; la restauration y insère par la policy du super-administrateur,
// et une proposition déjà retirée se réinsère telle quelle, datée de son retrait.
//
// Le régime d'e-reporting confirmé et la pièce écartée (ligne 28.5, étape e5a, migration
// `regimes_ereporting_et_pieces_ecartees`) suivent les registres de P7 : le régime ne dépend que de son dossier, l'écart
// suit la pièce qu'il vise (sa garde la lit, de son dossier) ; aucune validation ne les fige, et rien de ce qui précède
// ne les lit. L'histoire se réinsère telle qu'elle a été écrite, retraits compris — la garde d'un régime ne regarde
// pas l'insertion, celle d'un écart que sa pièce —, par la policy du super-administrateur. À cette place, ils ne
// déplacent que le rang de `exercices_valides` dans l'essai de restauration. Le contrôle de l'ordre contre le graphe
// (`sauvegarde.test.ts`) garde l'écart après sa pièce.
//
// La déclaration d'e-reporting hors application et ses sources (ligne 28.5, étape e5b1, migration
// `declarations_ereporting`) suivent le régime sous lequel elle a été jugée (`regime_id`, une clé sans action) ; aucune
// validation ne les fige, et rien de ce qui précède ne les lit. Une rectificative pointe la déclaration qu'elle remplace
// (`remplace_id`) : la chaîne d'une période part par VAGUES, et la garde, à l'insertion, ne lit que cette cible — déjà
// « remplacée » dans la sauvegarde —, le régime, les autres déclarations actives et l'empreinte du contenu, qu'elle
// recalcule sur le texte du `jsonb` reçu : un contenu produit par le module (ses nombres sont des doubles du navigateur)
// traverse une sauvegarde à l'identique. Les sources suivent leur déclaration ; elles désignent une fiche, une facture
// ou un encaissement SANS clé — l'histoire d'une déclaration remplacée survit à sa pièce —, et leur garde ne lit que la
// déclaration : elles ne sont pas des `LIENS_GARDES`. À cette place, elles ne déplacent que le rang de
// `exercices_valides` dans l'essai de restauration. `sauvegarde.test.ts` garde cet ordre.
//
// Le dossier permanent de la révision (ligne 41, étape R7, migration `dossier_permanent`) suit les déclarations
// d'e-reporting : son seul parent est le dossier, et sa garde lit, à l'insertion, la version qu'une entrée remplace — par
// VAGUES (`remplace_id`) — et la pièce ou le document qu'elle cite, sans clé (`LIENS_GARDES`) : ils sont plus haut.
// Aucune validation ne le fige ; une entrée retirée se réinsère telle qu'elle a été retirée, par la policy du
// super-administrateur. À cette place, il ne déplace que le rang des devis et de `exercices_valides` dans l'essai de
// restauration. `sauvegarde.test.ts` garde cet ordre.
//
// Les pièces jointes écartées à la réception par e-mail (ligne 22.7, migration `pieces_jointes_ecartees`) suivent le
// dossier permanent : leur seul parent est le dossier, aucune garde ne les lit à l'insertion (la leur ne garde que la mise
// à jour), aucune validation ne les fige ; une ligne déjà marquée vue se réinsère telle quelle, par la policy du
// super-administrateur. À cette place, elles ne déplacent que le rang des devis et de `exercices_valides` dans l'essai de
// restauration. `sauvegarde.test.ts` garde cet ordre.
//
// Les devis (espace client, étape P5) viennent juste avant `exercices_valides`, APRÈS les registres de P7 : leurs
// parents (le dossier, les factures) sont plus haut, aucune validation ne les fige, et à cette place ils ne déplacent
// le rang d'aucune table d'hier dans l'essai de restauration. La série d'abord (aucune policy : la sauvegarde n'en lit
// rien, elle se reprend du plus haut numéro restauré), les devis — un devis émis ne naît que par la porte de la
// restauration, dans un dossier sans série —, puis leurs liens, dont la garde lit le devis et la facture.
// `sauvegardeDevis.test.ts` garde cet ordre.
//
// Les articles (espace client, étape A1) viennent juste après `agent_conversations`, à la place que le tri leur donne parmi
// les tables qui ne dépendent que du dossier — et AVANT les factures, comme la conception le veut : à l'étape A7, une
// ligne de facture désignera l'article qui l'a pré-remplie (`facture_lignes.article_id`), et devra le trouver déjà écrit.
// Aucune garde ne les lit, aucune validation ne les fige ; un article retiré se réinsère tel quel, par la policy du
// super-administrateur. Le jour où leur table existe, l'essai de restauration les met à cette place et recule d'un rang les
// tables qui suivent. `sauvegardeArticles.test.ts` garde cet ordre.
//
// Les adresses de réception (espace client, étape A6a) viennent après les pièces jointes écartées, à la fin de ce qui ne
// dépend que du dossier : leur seul parent est le dossier, rien ne les lit à l'insertion d'une autre ligne, aucune
// validation ne les fige. Une version en remplace une autre de son dossier (`remplace_id`) : elles partent par VAGUES, et
// leur garde, à l'insertion, ne lit que la version remplacée — déjà écrite. Le jour où leur table existe, l'essai de
// restauration les met à cette place : seuls les rangs des devis et d'`exercices_valides` changent.
// `sauvegardeAdressesReception.test.ts` garde cet ordre.
//
// Les contacts (espace client, étape A4a) viennent après les adresses de réception, à la fin de ce qui ne dépend que du
// dossier : leur seul parent est le dossier, rien ne les lit à l'insertion d'une autre ligne — une facture ne garde que la
// COPIE de son client, sans clé vers lui —, aucune validation ne les fige ; un contact retiré ou effacé se réinsère tel
// quel, par la policy du super-administrateur. Le jour où leur table existe, l'essai de restauration les met à cette place :
// seuls les rangs des devis et d'`exercices_valides` changent. `sauvegardeContacts.test.ts` garde cet ordre.
//
// Les paramètres de facturation (espace client, étape A5a) viennent après les contacts, à la fin de ce qui ne dépend que du
// dossier : leur seul parent est le dossier — et la version qu'une version remplace, écrite par la vague d'avant —, rien
// ne les lit à l'insertion d'une autre ligne avant l'étape A7, aucune validation ne les fige ; une version se réinsère
// telle quelle, son RIB proposé ou confirmé et ses auteurs compris, par la policy du super-administrateur. Le jour où leur
// table existe, l'essai de restauration les met à cette place : seuls les rangs des devis et d'`exercices_valides`
// changent. `sauvegardeParametresFacturation.test.ts` garde cet ordre.
export const ORDRE_RESTAURATION_PREVU: readonly string[] = [
  'cabinets',
  'super_admins',
  'taux_change_bce',
  'roles_comptables',
  'cabinet_admins',
  'dossiers',
  'plan_comptable_dossier',
  'a_nouveaux',
  'agent_conversations',
  'articles',
  'categories',
  'comptes_courants_associes',
  'connexions_bancaires',
  'connexions_plateformes',
  'controles_releves_bancaires',
  'cotisations_declarees',
  'declarations_tva',
  'dossier_assignations',
  'emprunts',
  'exercices_clotures',
  'facture_numerotation',
  'factures_emises',
  'informations_dossier',
  'memberships',
  'natures_immobilisation',
  'packs',
  'previsionnels_bancaires',
  'references_annuelles',
  'references_postes_annuels',
  'regles_bancaires_ignorees',
  'soldes_reportes',
  'sous_dossiers',
  'superpdp_credentials',
  'vehicules',
  'volet_social_pamc',
  'documents_divers',
  'emails_envoyes',
  'facture_lignes',
  'facture_superpdp_events',
  'statuts_factures_recus',
  'transmissions_factures',
  'mouvements_cca',
  'pieces',
  'supplements',
  'regles_affectation_bancaire',
  'tiers_categories',
  'tiers_categories_cabinet',
  'immobilisations',
  'lignes_bancaires',
  'ventilations_bancaires',
  'reglements_groupes',
  'encaissements_factures',
  'encaissements_factures_taux',
  'transmissions_encaissements',
  'lettrages_manuels',
  'piece_commentaires',
  'piece_textes_ocr',
  'notes_internes',
  'pieces_hors_de_france',
  'pieces_hors_de_france_taux',
  'ecritures_brouillon',
  'revision_justifications',
  'revision_preuves',
  'revision_conclusions',
  'revision_notes',
  'revision_revues',
  'revision_seuils',
  'revision_explications',
  'justificatifs_proposes',
  'precisions_mouvements',
  'regimes_ereporting',
  'pieces_ecartees_ereporting',
  'declarations_ereporting',
  'declarations_ereporting_sources',
  'dossier_permanent',
  'pieces_jointes_ecartees',
  'adresses_reception',
  'contacts',
  'parametres_facturation',
  'devis_numerotation',
  'devis',
  'devis_factures',
  'exercices_valides',
]

// L'ordre tel qu'il s'applique AUJOURD'HUI : sans les tables des devis, des articles, des adresses de réception, des
// contacts ni des paramètres de facturation tant que leurs migrations ne sont pas exportées.
export const ORDRE_RESTAURATION: readonly string[] = ORDRE_RESTAURATION_PREVU.filter((t) => auPlanAujourdHui(t))

// Une table qui se référence elle-même ne peut PAS être restaurée en un seul passage : la première
// ligne insérée peut pointer une ligne qui n'existe pas encore. Ici c'est `factures_emises`, dont un
// avoir porte l'identifiant de la facture qu'il annule (`facture_origine_id`).
//
// La restauration doit donc se faire en deux temps sur ces tables : insérer toutes les lignes avec la
// colonne auto-référencée à NULL, puis la renseigner par une seconde passe. Aucun ordre de tables,
// aussi juste soit-il, ne peut éviter ça.
//
// Et la base ne laisse faire ces deux temps que par UNE porte (migration factures_validees_figees,
// 07/10/2026) : une facture validée ne s'insère, avec ses lignes, que par le super-administrateur dans
// un dossier qui n'a jamais validé de facture — donc sans compteur de numérotation, que la sauvegarde
// n'emporte pas (`facture_numerotation` n'a aucune policy : sa lecture rend zéro ligne). Le second
// passage ne peut que poser ce lien, sur un avoir qui n'en a pas encore. La première facture validée
// ensuite pose le compteur, reprend la suite du plus haut numéro restauré et referme la porte.
// facturesFigees.test.ts garde que ce lien est le seul de cette table.
export const TABLES_AUTO_REFERENCEES: readonly { table: string; colonne: string }[] = [
  { table: 'factures_emises', colonne: 'facture_origine_id' },
]

// Une table qui se référence elle-même et que la seconde passe ne PEUT PAS restaurer : `encaissements_factures`, dont
// une annulation porte l'encaissement qu'elle contre-passe (`annule_id`, migration encaissements_des_factures,
// 08/10/2026). La colonne ne part pas à NULL — la base veut qu'un montant négatif soit une annulation et qu'une
// annulation soit négative (`encaissements_factures_signe`) — et ne se repose pas ensuite : un encaissement ne se
// modifie plus après son insertion, sauf son retrait. Ses lignes partent donc par VAGUES : celles qui ne pointent
// rien, puis celles dont la cible est déjà écrite. Une vague par écriture distincte, et non l'ordre des lignes dans
// un même lot : le déclencheur lit la cible, et Postgres ne promet pas l'ordre dans lequel une commande traite ses
// lignes. Une annulation ne s'annule pas (le même déclencheur) : deux vagues suffisent, et le plan en ferait plus.
//
// `revision_justifications` aussi (ligne 41, étape R1), et par DEUX colonnes : une décision en remplace une autre du même
// compte et du même exercice (`remplace_id`), et reprend la justification permanente de l'exercice précédent
// (`reprise_de`). Immuable, elle ne part pas à NULL pour se compléter ensuite, et sa garde lit chaque cible : une
// décision part dans la vague qui suit l'écriture de TOUTES ses cibles — une chaîne de remplacements fait autant de
// vagues qu'elle a de maillons.
//
// Une table d'une migration PRÉPARÉE y est déclarée d'avance, comme dans l'ordre (la liste « prévue ») ; la liste du jour
// ne la porte que son drapeau levé — le graphe du jour, que `sauvegarde.test.ts` confronte à ces vagues, ne la connaît pas
// avant.
export const TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES: readonly { table: string; colonne: string }[] = [
  { table: 'encaissements_factures', colonne: 'annule_id' },
  { table: 'revision_justifications', colonne: 'remplace_id' },
  { table: 'revision_justifications', colonne: 'reprise_de' },
  // La fiche « hors de France » (ligne 28.5, étape e2) : une version en remplace une autre de la même pièce
  // (`remplace_id`) ; immuable hors de son retrait, elle ne part pas à NULL, et sa garde lit la version remplacée.
  { table: 'pieces_hors_de_france', colonne: 'remplace_id' },
  // La conclusion d'un cycle de la révision (ligne 41, étape R4) : elle en remplace une du même cycle et du même exercice
  // (`remplace_id`) ; immuable, elle ne part pas à NULL, et sa garde lit la conclusion remplacée.
  { table: 'revision_conclusions', colonne: 'remplace_id' },
  // Le seuil de signification d'un exercice et l'explication d'une variation (ligne 41, étape R5) : l'un remplace un seuil
  // du même exercice, l'autre une explication de la même ligne et du même exercice (`remplace_id`) ; immuables, ils ne
  // partent pas à NULL, et leur garde lit la cible.
  { table: 'revision_seuils', colonne: 'remplace_id' },
  { table: 'revision_explications', colonne: 'remplace_id' },
  // La déclaration d'e-reporting hors application (ligne 28.5, étape e5b1) : une rectificative remplace la déclaration
  // de la même période (`remplace_id`) ; immuable hors du passage de l'active à « remplacée », elle ne part pas à NULL, et
  // sa garde exige une cible déjà écrite et déjà « remplacée ».
  { table: 'declarations_ereporting', colonne: 'remplace_id' },
  // Le dossier permanent de la révision (ligne 41, étape R7) : une version en remplace une autre de son dossier
  // (`remplace_id`) ; immuable hors de son retrait, elle ne part pas à NULL, et sa garde lit la version remplacée — qu'elle
  // exige non retirée : une entrée retirée n'a pas de suite dans une sauvegarde.
  { table: 'dossier_permanent', colonne: 'remplace_id' },
  // L'adresse de réception d'un dossier (espace client, étape A6a) : une version en remplace une autre de son dossier
  // (`remplace_id`) ; immuable, elle ne part pas à NULL, et sa garde lit la version remplacée.
  { table: 'adresses_reception', colonne: 'remplace_id' },
  // Les paramètres de facturation d'un dossier (espace client, étape A5a) : une version en remplace une autre de son
  // dossier (`remplace_id`) ; immuable hors de la confirmation de son RIB, elle ne part pas à NULL, et sa garde lit la
  // version remplacée.
  { table: 'parametres_facturation', colonne: 'remplace_id' },
]

// Les vagues telles qu'elles s'appliquent AUJOURD'HUI : sans celle des adresses de réception, ni celle des paramètres de
// facturation, tant que leur migration n'est pas exportée.
export const TABLES_AUTO_REFERENCEES_PAR_VAGUES: readonly { table: string; colonne: string }[] =
  TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES.filter((a) => auPlanAujourdHui(a.table))

// Les vagues d'une table auto-référencée : la première ne pointe aucune ligne de la sauvegarde, chaque suivante ne
// pointe que des lignes des précédentes, par chacune des colonnes données. Une ligne qui pointe une ligne ABSENTE de la
// sauvegarde part comme si son lien était vide : `liensPerdus` l'a déjà signalée, et la restauration refuse avant
// d'écrire. Un cycle, que la base refuse, ne fait pas boucler le plan : ce qui ne peut plus avancer part en dernier, et
// c'est la base qui dira non.
export function vaguesParLien(
  lignes: Record<string, unknown>[],
  colonnes: string | readonly string[],
): Record<string, unknown>[][] {
  const liens = typeof colonnes === 'string' ? [colonnes] : colonnes
  const presents = new Set(lignes.map((l) => String(l.id)))
  const ecrits = new Set<string>()
  const vagues: Record<string, unknown>[][] = []
  let reste = lignes
  while (reste.length > 0) {
    const vague = reste.filter((l) => liens.every((c) => l[c] == null || !presents.has(String(l[c])) || ecrits.has(String(l[c]))))
    if (vague.length === 0) {
      vagues.push(reste)
      break
    }
    for (const l of vague) ecrits.add(String(l.id))
    vagues.push(vague)
    reste = reste.filter((l) => !ecrits.has(String(l.id)))
  }
  return vagues
}

/** Un lien qui pointe une ligne absente de la sauvegarde. */
export interface LienPerdu {
  table: string
  colonne: string
  parent: string
  /** L'identifiant pointé, introuvable. */
  valeur: string
  /**
   * Vrai quand la colonne accepte NULL, donc quand la restauration PEUT aboutir en effaçant le lien
   * au lieu de s'arrêter. C'est le cas dangereux — non parce que Postgres se tairait, mais parce que
   * c'est nous qui serions tentés de le faire taire. Voir le commentaire de `liensPerdus`.
   */
  effacable: boolean
}

type Contenu = Record<string, Record<string, unknown>[]>

// Le contrôle qui décide si une sauvegarde est réellement complète — à exécuter AVANT de restaurer.
//
// La première version de ce commentaire affirmait que Postgres, sur une relation ON DELETE SET NULL,
// accepte une ligne dont le parent manque et écrit NULL en silence. C'est FAUX, et l'essai en base l'a
// montré (18/09/2026, schéma jetable, deux tables, une relation SET NULL) : à l'INSERT, Postgres refuse
// par `foreign_key_violation`, exactement comme sur les autres. ON DELETE ne décrit que ce qui arrive à
// la SUPPRESSION du parent ; il ne relâche rien à l'insertion.
//
// Le danger est réel, mais il est ailleurs, et il est pire :
//
//   1. Une restauration n'est pas atomique. Quarante tables insérées par lots successifs : l'échec
//      arrive au milieu, sur une base déjà à moitié peuplée, et il faut décider à 3 h du matin ce
//      qu'on fait des trente-neuf autres. Ce contrôle le dit AVANT que rien ne soit écrit.
//   2. C'est NOUS qui produisons le silence. Face à un refus sur une colonne nullable, la correction
//      qui vient à l'esprit est d'y mettre NULL pour que ça passe — et ça passe. Neuf relations du
//      graphe métier le permettent, et ce sont précisément celles qui portent le travail comptable :
//
//   lignes_bancaires.piece_id      le rapprochement bancaire de chaque mouvement
//   ecritures_brouillon.piece_id   la pièce justifiant chaque écriture
//   ecritures_brouillon.ligne_bancaire_id  le mouvement qui la justifie
//   immobilisations.piece_id       la facture d'achat de l'immobilisation
//   supplements.facture_id         le rattachement d'un supplément à sa facture
//
// Un dossier ainsi « restauré » paraît intact : toutes les pièces sont là, tous les mouvements aussi.
// Seul le lien entre eux a disparu — le rapprochement est défait, les écritures sont orphelines, et
// rien à l'écran ne le dit. C'est ce qu'on découvre six mois plus tard, en cherchant autre chose.
//
// D'où `effacable`, qui ne dit pas « Postgres se taira » mais « ce lien-là peut être sacrifié pour que
// la restauration passe » — c'est-à-dire : ne le sacrifie pas sans le savoir.
//
// `contenu` est la sauvegarde entière : un tableau de lignes par table.
//
// La comparaison se fait sur la CLÉ PRIMAIRE du parent, et c'est justifié mais pas évident : une clé
// étrangère d'une seule colonne ne vise qu'une clé primaire d'une seule colonne, qui est `id` partout
// sauf au catalogue des rôles comptables (`role`, ligne 43, étape PC1) — le premier parent du graphe
// dont la clé ne s'appelle pas `id`. Comparée sur `id`, chaque ligne du plan d'un dossier qui viserait
// un rôle présent dans la sauvegarde serait déclarée perdue, donc la restauration refusée.
// `sauvegardeClesPrimaires.test.ts` vérifie que toute table PARENTE a une clé d'une seule colonne, et
// que c'est celle que CLES_PRIMAIRES déclare — en DÉRIVANT les clés primaires du schéma exporté,
// `alter` rejoués. Une table à clé composite n'est le parent de personne : elle n'a pas d'identifiants
// ici. Cette règle a vécu sans aucun test derrière elle jusqu'au 22/09/2026 : un parent à clé
// composite ferait déclarer perdue CHAQUE ligne fille, donc refuser toute restauration.
export function liensPerdus(contenu: Contenu): LienPerdu[] {
  const identifiants = new Map<string, Set<string>>()
  for (const [table, lignes] of Object.entries(contenu)) {
    const cle = clePrimaire(table)
    if (cle.length !== 1) continue
    identifiants.set(table, new Set(lignes.map((l) => String(l[cle[0]]))))
  }

  const perdus: LienPerdu[] = []
  for (const relation of TOUS_LES_LIENS) {
    const lignes = contenu[relation.enfant]
    if (!lignes) continue
    // Une table parente absente de la sauvegarde n'est pas un lien perdu mais un périmètre : on ne
    // sauvegarde pas forcément tout le schéma (un export par dossier, par exemple). Ce qui compte est
    // qu'une table PRÉSENTE ne référence rien qui manque.
    const connus = identifiants.get(relation.parent)
    if (!connus) continue

    for (const ligne of lignes) {
      const valeur = ligne[relation.colonne]
      // Un lien vide est un lien absent, pas un lien cassé : la plupart de ces colonnes sont
      // facultatives (une pièce sans sous-dossier, un mouvement non rapproché).
      if (valeur == null) continue
      if (connus.has(String(valeur))) continue
      perdus.push({
        table: relation.enfant,
        colonne: relation.colonne,
        parent: relation.parent,
        valeur: String(valeur),
        effacable: relation.aLaSuppression === 'met_a_null',
      })
    }
  }
  return perdus
}

// Les clés primaires qui ne sont pas `id`, lues de pg_constraint le 18/09/2026 — et celles d'`exercices_valides`
// (le dossier et l'année) à sa création, le 04/10/2026, de `connexions_plateformes` (le dossier) le 07/10/2026, et
// d'`encaissements_factures_taux` (l'encaissement et le taux) le 08/10/2026.
//
// Pourquoi les inscrire : deux mécanismes en dépendent, et tous deux échouaient dessus.
//
// La pagination d'abord. Lire une table par tranches sans ORDER BY laisse Postgres rendre les lignes
// dans l'ordre qui l'arrange, et il peut changer d'une tranche à l'autre : on récupère alors des
// doublons et des trous, sans la moindre erreur. Il faut donc trier sur un ordre TOTAL, c'est-à-dire
// sur la clé primaire — et trier sur `id` casserait franchement ici, ces neuf tables n'ayant pas même
// de colonne `id`.
//
// L'identité d'une ligne ensuite : savoir si une ligne existe déjà dans la base d'arrivée, ce dont
// dépend la réinsertion des lignes partagées, ne peut se lire que sur sa vraie clé.
//
// Six de ces neuf sont dans le plan d'export d'un dossier : `connexions_plateformes`, `encaissements_factures_taux`,
// `exercices_valides`, `facture_numerotation`, `previsionnels_bancaires` et `superpdp_credentials`. Elles sont petites
// par nature — une ligne par dossier, par exercice ou par taux d'un encaissement — donc la pagination ne s'y
// déclenchera jamais en pratique. Ce n'est pas une raison de les traiter à part : un mécanisme dont la justesse
// dépend de la petitesse des données est un mécanisme qui tombera le jour où elles grandissent.
//
// `pieces_hors_de_france_taux` (ligne 28.5, étape e2) en fait DIX, et sept dans le plan d'export : une ligne par code et
// par taux d'une version de la fiche « hors de France », petite par nature elle aussi.
// Le plan comptable d'un dossier et le catalogue des rôles (ligne 43, étape PC1) en ont aussi une à eux — DOUZE tables
// en tout, huit dans le plan d'export, où le catalogue n'entre pas : le dossier et le rôle (une ligne par rôle que le
// dossier règle, trente-deux au plus) ; le rôle. Le catalogue est le premier PARENT du
// graphe dont la clé ne s'appelle pas `id` : c'est sur elle que `liensPerdus` compare, et que la restauration lit, dans
// la base d'arrivée, les rôles qu'un plan désigne (`referencesExternes`).
//
// `devis_numerotation` (espace client, étape P5) en fera TREIZE, et neuf dans le plan d'export, le jour où ses
// migrations seront exportées : une ligne par dossier et par année, comme `facture_numerotation`.
//
// Les sources d'une déclaration d'e-reporting (ligne 28.5, étape e5b1) en ont une aussi — la déclaration, le genre et la
// source : une ligne par fiche, facture ou encaissement déclaré —, ce qui porte le compte à TREIZE tables, neuf dans le
// plan d'export (quatorze et dix avec la série des devis).
export const CLES_PRIMAIRES_PREVUES: Readonly<Record<string, readonly string[]>> = {
  cabinet_admins: ['user_id'],
  connexions_plateformes: ['dossier_id'],
  declarations_ereporting_sources: ['declaration_id', 'genre', 'source_id'],
  devis_numerotation: ['dossier_id', 'annee'],
  encaissements_factures_taux: ['encaissement_id', 'taux'],
  exercices_valides: ['dossier_id', 'annee'],
  facture_numerotation: ['dossier_id', 'annee', 'type'],
  pieces_hors_de_france_taux: ['fiche_id', 'code_tva', 'taux'],
  plan_comptable_dossier: ['dossier_id', 'role'],
  previsionnels_bancaires: ['dossier_id'],
  roles_comptables: ['role'],
  super_admins: ['user_id'],
  superpdp_credentials: ['dossier_id'],
  taux_change_bce: ['date', 'devise'],
}

// Les clés telles qu'elles s'appliquent AUJOURD'HUI : sans la série des devis tant que ses migrations ne sont pas exportées.
// (Les articles ont la clé commune, `id` : ils n'ont pas de ligne ici ; les contacts non plus.)
export const CLES_PRIMAIRES: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
  Object.entries(CLES_PRIMAIRES_PREVUES).filter(([table]) => auPlanAujourdHui(table)),
)

/** La clé primaire d'une table — `id` sauf exception déclarée. */
export function clePrimaire(table: string): readonly string[] {
  return CLES_PRIMAIRES[table] ?? ['id']
}

// L'identité d'une ligne, sous une forme comparable : ce qui permet de dire « cette ligne-là est déjà
// en base ». Les valeurs sont séparées par un caractère que n'emploie aucun identifiant du schéma,
// sinon deux clés composites différentes pourraient se confondre en une seule chaîne.
export function identiteLigne(table: string, ligne: Record<string, unknown>): string {
  return clePrimaire(table).map((colonne) => String(ligne[colonne])).join('\u0000')
}

// LES COLONNES GÉNÉRÉES — celles que la base CALCULE (`generated always as (…) stored`) —, lues de l'export du schéma et
// du catalogue de la production le 11/10/2026 : une seule, l'empreinte du texte lu (migration 20260919142532).
//
// Postgres refuse qu'une insertion y écrive quoi que ce soit, la valeur qu'il aurait calculée comme NULL, et il le refuse
// avant d'avoir lu une ligne (428C9, « cannot insert a non-DEFAULT value into column »). Or la sauvegarde lit des lignes
// ENTIÈRES (`select('*')`), et PostgREST insère toute colonne que nomme une ligne du lot (l'union de leurs clés) :
// jusqu'au 11/10/2026, la restauration d'un dossier qui avait un texte lu s'arrêtait sur `piece_textes_ocr`, une
// cinquantaine de tables déjà écrites (défaut relevé à l'étape e5b1). Le plan de réinsertion RETIRE désormais ces
// colonnes de chaque ligne qu'il envoie (`sansColonnesGenerees`), et la base les recalcule de ce qui est restauré.
//
// La sauvegarde, elle, continue de les LIRE, et c'est voulu : remplacer `*` par une liste de colonnes ferait une liste
// d'inclusion tenue à la main, qu'une colonne ajoutée demain quitterait sans un mot ; les sauvegardes déjà écrites les
// portent, et doivent se restaurer telles quelles ; et la valeur lue reste le témoin du recalcul, que l'essai de
// restauration compare à celle de la base d'arrivée (`supabase/essais/restauration.sql`).
//
// `sauvegardeColonnesGenerees.test.ts` confronte cette liste à l'export du schéma, dans les deux sens, et vérifie
// qu'aucune de ces colonnes n'est une clé ni un lien que le plan lit ; `restaurationEssai.test.ts`, à celle que l'essai
// recopie.
export const COLONNES_GENEREES: Readonly<Record<string, readonly string[]>> = {
  piece_textes_ocr: ['texte_md5'],
}

/**
 * Les lignes d'une table telles que la restauration les envoie : sans les colonnes que la base calcule. Des copies, et
 * seulement pour une table qui en a — la sauvegarde reçue reste intacte (`liensPerdus` et la vérification la relisent).
 */
export function sansColonnesGenerees(table: string, lignes: Record<string, unknown>[]): Record<string, unknown>[] {
  const generees = COLONNES_GENEREES[table] ?? []
  if (generees.length === 0) return lignes
  return lignes.map((ligne) => Object.fromEntries(Object.entries(ligne).filter(([colonne]) => !generees.includes(colonne))))
}

/** Une violation de l'ordre : un enfant placé avant son parent, ou une table absente de l'ordre. */
export interface ViolationOrdre {
  enfant: string
  parent: string
  motif: 'parent_apres_enfant' | 'table_absente_de_lordre'
}

// Vérifie qu'un ordre de restauration respecte bien toutes les dépendances.
//
// Sert de garde-fou permanent : ORDRE_RESTAURATION est une liste figée, écrite à la main à partir
// d'un calcul. Le jour où une relation est ajoutée au schéma sans reclasser la liste, ce contrôle le
// dit — au lieu de laisser la découverte pour la nuit où on restaure vraiment.
//
// Les auto-références sont ignorées : elles ne peuvent être satisfaites par aucun ordre de TABLES (voir
// TABLES_AUTO_REFERENCEES et TABLES_AUTO_REFERENCEES_PAR_VAGUES), et les compter comme violations rendrait le
// contrôle toujours rouge.
export function violationsOrdre(
  ordre: readonly string[],
  relations: readonly Relation[] = TOUS_LES_LIENS,
): ViolationOrdre[] {
  const rang = new Map(ordre.map((table, i) => [table, i]))
  const violations: ViolationOrdre[] = []

  for (const relation of relations) {
    if (relation.enfant === relation.parent) continue
    const rangEnfant = rang.get(relation.enfant)
    const rangParent = rang.get(relation.parent)
    if (rangEnfant === undefined || rangParent === undefined) {
      violations.push({ enfant: relation.enfant, parent: relation.parent, motif: 'table_absente_de_lordre' })
      continue
    }
    // `>=` et non `>`, bien que l'égalité soit aujourd'hui inatteignable : deux tables distinctes ont
    // toujours des rangs distincts, et le seul cas d'égalité — une table et elle-même — est écarté
    // juste au-dessus. La borne large est donc équivalente à la borne stricte en l'état, et aucun
    // test ne peut les distinguer. Elle est gardée parce qu'elle cesse de l'être dès qu'on touche à
    // l'exemption des auto-références au-dessus : `>` laisserait alors passer en silence une table
    // déclarée parente d'elle-même, qu'aucun ordre ne peut satisfaire.
    if (rangParent >= rangEnfant) {
      violations.push({ enfant: relation.enfant, parent: relation.parent, motif: 'parent_apres_enfant' })
    }
  }
  return violations
}

// Comment atteindre, pour chaque table, les lignes qui appartiennent à UN dossier.
//
// Le piège que ça ferme : trente-deux des quarante tables portent une colonne `dossier_id`, et on
// serait tenté d'écrire « pour chaque table, WHERE dossier_id = ? ». Deux tables n'en ont pas et ne
// sont atteignables que par leur parent — `facture_lignes` par sa facture, `mouvements_cca` par son
// compte courant. Un export naïf rendrait zéro ligne pour ces deux-là, sans la moindre erreur : toutes
// les lignes de facture et tous les mouvements de compte courant perdus, en silence. C'est la même
// classe de panne que les liens en SET NULL plus haut, et elle mérite la même méfiance.
//
// Le piège suivant, découvert en écrivant l'export réel, et bien plus coûteux : `dossier_id` est
// NULLABLE sur deux tables — `categories` et `natures_immobilisation`. Elles mélangent les lignes
// propres à un dossier et des lignes PARTAGÉES par tous, marquées d'un `dossier_id` nul. Or en SQL une
// comparaison avec NULL n'est jamais vraie : `WHERE dossier_id = <le dossier>` écarte les lignes
// partagées sans le dire. C'est mot pour mot le défaut du filtre de période sur les pièces sans date,
// revenu sur une autre colonne.
//
// Ce qu'il coûtait ici, mesuré en production le 18/09/2026 : les DIX catégories et les HUIT natures
// d'immobilisation du cabinet sont partagées, aucune n'appartient à un dossier. Un export « direct »
// rendait donc zéro ligne pour ces deux tables, pendant que les 28 pièces catégorisées du cabinet —
// toutes les 28 — et une immobilisation sur deux les pointaient. (Un premier comptage annonçait 76 :
// il additionnait les pièces SANS catégorie, qu'une jointure externe range du même côté que celles
// sur catégorie partagée. Le fait ne change pas, le chiffre si.)
// Et `pieces.categorie_id` comme `immobilisations.nature_id`
// sont en NO ACTION : la restauration se serait arrêtée net sur `pieces`, la plus grosse table de la
// chaîne, sans que rien en aval ne soit tenté. D'où `partage`, qui lit les deux.
//
// Ce qui reste dehors, et la règle qui le décide : une table est exclue de l'export d'un dossier
// uniquement si RIEN dans l'export ne la pointe. Les taux de change, les super-administrateurs et les
// cabinets eux-mêmes remplissent cette condition — sauf `cabinets`, que `dossiers.cabinet_id` pointe,
// et qui est donc un prérequis explicite de la base d'arrivée (voir `referencesExternes`) ; de même le
// catalogue des rôles comptables, que le plan d'un dossier pointe (`PARENTS_HORS_PLAN_VOULUS`). Les tables
// de niveau cabinet sont dehors pour une raison de sens, pas de graphe : elles décrivent qui dirige le
// cabinet et quelles règles il partage, pas ce que contient un dossier. Les embarquer ferait
// réinsérer, en restaurant un client, la liste des administrateurs du cabinet.
//
// Cette règle n'est pas une intention : `parentsHorsPlan` la vérifie à chaque exécution des tests.
export type CheminDossier =
  /** La ligne `dossiers` elle-même : c'est ce qu'on restaure, tout le reste y pend. */
  | { acces: 'le_dossier' }
  /** `dossier_id` NOT NULL : toutes les lignes du dossier, et rien d'autre. */
  | { acces: 'direct' }
  /**
   * `dossier_id` NULLABLE : la table mélange les lignes d'un dossier et des lignes PARTAGÉES entre
   * tous (`dossier_id` nul). Les deux doivent être lues — voir le commentaire ci-dessous, c'est le
   * piège qui rendait cet export inexploitable.
   */
  | { acces: 'partage' }
  /** Pas de `dossier_id` : les lignes se prennent par les identifiants déjà lus dans `parent`. */
  | { acces: 'par_parent'; parent: string; colonne: string }
  /** Table de niveau cabinet : elle décrit le cabinet, pas le dossier — hors de cet export. */
  | { acces: 'cabinet' }
  /** Référentiel que rien dans l'export ne pointe : hors de cet export lui aussi. */
  | { acces: 'global' }

export const CHEMINS_DOSSIER_PREVUS: Readonly<Record<string, CheminDossier>> = {
  cabinets: { acces: 'global' },
  super_admins: { acces: 'global' },
  taux_change_bce: { acces: 'global' },
  roles_comptables: { acces: 'global' },

  dossiers: { acces: 'le_dossier' },
  cabinet_admins: { acces: 'cabinet' },
  tiers_categories_cabinet: { acces: 'cabinet' },

  categories: { acces: 'partage' },
  natures_immobilisation: { acces: 'partage' },

  facture_lignes: { acces: 'par_parent', parent: 'factures_emises', colonne: 'facture_id' },
  mouvements_cca: { acces: 'par_parent', parent: 'comptes_courants_associes', colonne: 'compte_id' },

  a_nouveaux: { acces: 'direct' },
  agent_conversations: { acces: 'direct' },
  comptes_courants_associes: { acces: 'direct' },
  connexions_bancaires: { acces: 'direct' },
  connexions_plateformes: { acces: 'direct' },
  controles_releves_bancaires: { acces: 'direct' },
  cotisations_declarees: { acces: 'direct' },
  declarations_ereporting: { acces: 'direct' },
  declarations_ereporting_sources: { acces: 'direct' },
  declarations_tva: { acces: 'direct' },
  devis: { acces: 'direct' },
  devis_factures: { acces: 'direct' },
  devis_numerotation: { acces: 'direct' },
  documents_divers: { acces: 'direct' },
  dossier_assignations: { acces: 'direct' },
  dossier_permanent: { acces: 'direct' },
  ecritures_brouillon: { acces: 'direct' },
  emails_envoyes: { acces: 'direct' },
  emprunts: { acces: 'direct' },
  encaissements_factures: { acces: 'direct' },
  encaissements_factures_taux: { acces: 'direct' },
  exercices_clotures: { acces: 'direct' },
  exercices_valides: { acces: 'direct' },
  facture_numerotation: { acces: 'direct' },
  facture_superpdp_events: { acces: 'direct' },
  factures_emises: { acces: 'direct' },
  immobilisations: { acces: 'direct' },
  informations_dossier: { acces: 'direct' },
  justificatifs_proposes: { acces: 'direct' },
  lettrages_manuels: { acces: 'direct' },
  lignes_bancaires: { acces: 'direct' },
  memberships: { acces: 'direct' },
  notes_internes: { acces: 'direct' },
  packs: { acces: 'direct' },
  piece_commentaires: { acces: 'direct' },
  piece_textes_ocr: { acces: 'direct' },
  pieces: { acces: 'direct' },
  pieces_ecartees_ereporting: { acces: 'direct' },
  pieces_hors_de_france: { acces: 'direct' },
  pieces_hors_de_france_taux: { acces: 'direct' },
  plan_comptable_dossier: { acces: 'direct' },
  precisions_mouvements: { acces: 'direct' },
  previsionnels_bancaires: { acces: 'direct' },
  references_annuelles: { acces: 'direct' },
  references_postes_annuels: { acces: 'direct' },
  regimes_ereporting: { acces: 'direct' },
  reglements_groupes: { acces: 'direct' },
  regles_affectation_bancaire: { acces: 'direct' },
  regles_bancaires_ignorees: { acces: 'direct' },
  revision_justifications: { acces: 'direct' },
  revision_preuves: { acces: 'direct' },
  revision_conclusions: { acces: 'direct' },
  revision_notes: { acces: 'direct' },
  revision_revues: { acces: 'direct' },
  revision_seuils: { acces: 'direct' },
  revision_explications: { acces: 'direct' },
  soldes_reportes: { acces: 'direct' },
  sous_dossiers: { acces: 'direct' },
  statuts_factures_recus: { acces: 'direct' },
  superpdp_credentials: { acces: 'direct' },
  supplements: { acces: 'direct' },
  tiers_categories: { acces: 'direct' },
  transmissions_encaissements: { acces: 'direct' },
  transmissions_factures: { acces: 'direct' },
  vehicules: { acces: 'direct' },
  ventilations_bancaires: { acces: 'direct' },
  volet_social_pamc: { acces: 'direct' },
  pieces_jointes_ecartees: { acces: 'direct' },
  articles: { acces: 'direct' },
  adresses_reception: { acces: 'direct' },
  contacts: { acces: 'direct' },
  parametres_facturation: { acces: 'direct' },
}

// Les chemins tels qu'ils s'appliquent AUJOURD'HUI : sans les tables des devis, des articles, des adresses de réception, des
// contacts ni des paramètres de facturation tant que leurs migrations ne sont pas exportées.
export const CHEMINS_DOSSIER: Readonly<Record<string, CheminDossier>> = Object.fromEntries(
  Object.entries(CHEMINS_DOSSIER_PREVUS).filter(([table]) => auPlanAujourdHui(table)),
)

/** Une étape du plan de lecture d'un dossier, dans l'ordre où elle doit être exécutée. */
export interface EtapeExport {
  table: string
  chemin: CheminDossier
}

// Le plan de lecture d'un dossier : les tables à lire, dans un ordre où chaque table atteignable
// seulement par son parent vient APRÈS lui — sans quoi on n'aurait pas encore les identifiants
// nécessaires pour la lire.
//
// L'ordre de restauration convient tel quel, puisqu'un parent y précède toujours ses enfants ; on le
// réutilise plutôt que d'en tenir un second, qui finirait par diverger.
//
// Sont exclues les tables que rien dans l'export ne pointe (`global`) et celles qui décrivent le
// cabinet plutôt que le dossier (`cabinet`). Attention à ne pas confondre avec `partage` : une ligne
// partagée est bien dans l'export, parce que les pièces du dossier la pointent — ce qui la distingue
// d'un référentiel, c'est qu'elle sera réinsérée seulement si elle manque (voir `estLignePartagee`).
export function planExportDossier(
  ordre: readonly string[] = ORDRE_RESTAURATION,
  chemins: Readonly<Record<string, CheminDossier>> = CHEMINS_DOSSIER,
): EtapeExport[] {
  return ordre
    .map((table) => ({ table, chemin: chemins[table] }))
    .filter((e): e is EtapeExport => e.chemin != null && e.chemin.acces !== 'global' && e.chemin.acces !== 'cabinet')
}

// Vrai quand la ligne appartient à tout le cabinet plutôt qu'au dossier exporté.
//
// Se lit dans la donnée elle-même (`dossier_id` nul) plutôt que dans une déclaration à tenir à jour à
// côté : une seconde liste finirait par diverger de la première, et rien ne le dirait.
//
// La conséquence est au moment de la restauration : une ligne partagée est réinsérée SEULEMENT si elle
// manque. Elle ne se réécrit jamais — une catégorie renommée depuis la sauvegarde, ou dont le compte
// comptable a été corrigé, appartient à tous les dossiers du cabinet, et restaurer un client n'est pas
// une raison de la ramener en arrière pour les autres.
export function estLignePartagee(table: string, ligne: Record<string, unknown>): boolean {
  return CHEMINS_DOSSIER[table]?.acces === 'partage' && ligne.dossier_id == null
}

/** Une table dont on ne saurait pas lire les lignes : elle serait absente de tout export, en silence. */
export interface TableSansChemin {
  table: string
  motif: 'chemin_non_declare' | 'parent_lu_trop_tard'
}

// Le garde-fou permanent sur la carte ci-dessus.
//
// Deux façons de perdre une table sans s'en apercevoir : ne pas déclarer son chemin du tout — elle
// sort alors de l'export sans un mot — ou déclarer un parent lu APRÈS elle, auquel cas on chercherait
// ses lignes avec une liste d'identifiants encore vide, ce qui rend zéro ligne et aucune erreur.
export function tablesSansChemin(
  ordre: readonly string[] = ORDRE_RESTAURATION,
  chemins: Readonly<Record<string, CheminDossier>> = CHEMINS_DOSSIER,
): TableSansChemin[] {
  const rang = new Map(ordre.map((table, i) => [table, i]))
  const problemes: TableSansChemin[] = []

  for (const table of ordre) {
    const chemin = chemins[table]
    if (!chemin) {
      problemes.push({ table, motif: 'chemin_non_declare' })
      continue
    }
    if (chemin.acces !== 'par_parent') continue
    const rangParent = rang.get(chemin.parent)
    if (rangParent === undefined || rangParent >= rang.get(table)!) {
      problemes.push({ table, motif: 'parent_lu_trop_tard' })
    }
  }
  return problemes
}

/** Une table que l'export pointe sans la lire : la restauration s'arrêtera dessus. */
export interface ParentHorsPlan {
  parent: string
  /** Les tables du plan qui la pointent. */
  pointeePar: string[]
  /** Vrai quand le lien accepte NULL : la restauration pourrait passer en sacrifiant le lien. */
  effacable: boolean
}

// L'invariant qui aurait évité le défaut des lignes partagées, et qui l'évitera la prochaine fois.
//
// La règle est simple et se vérifie toute seule : si une table du plan pointe une table absente du
// plan, alors la restauration butera dessus — soit Postgres refuse (NO ACTION), soit il faut sacrifier
// le lien. Deux exceptions sont légitimes, et elles doivent être VOULUES, pas subies
// (`PARENTS_HORS_PLAN_VOULUS`) : `cabinets`, qu'un export de dossier ne contient délibérément pas et que
// la base d'arrivée doit déjà porter ; et `roles_comptables`, le catalogue des rôles du plan comptable
// (ligne 43, étape PC1), qu'une migration pose dans toute base — une sauvegarde qui le porterait
// réécrirait, en restaurant un client, les défauts de l'application pour tous les dossiers. La base
// d'arrivée doit connaître chaque rôle que le plan du dossier désigne : `referencesExternes` les nomme,
// et la restauration les y lit avant d'écrire.
//
// Écrit après coup : `categories` et `natures_immobilisation` étaient lues avec un filtre qui rendait
// zéro ligne, donc absentes de fait de tout export, pendant que les pièces et les immobilisations les
// pointaient. Ce contrôle-là l'aurait dit dès la première exécution des tests.
export const PARENTS_HORS_PLAN_VOULUS: readonly string[] = ['cabinets', 'roles_comptables']

export function parentsHorsPlan(
  ordre: readonly string[] = ORDRE_RESTAURATION,
  chemins: Readonly<Record<string, CheminDossier>> = CHEMINS_DOSSIER,
): ParentHorsPlan[] {
  const dansLePlan = new Set(planExportDossier(ordre, chemins).map((e) => e.table))
  const parTable = new Map<string, ParentHorsPlan>()

  for (const relation of TOUS_LES_LIENS) {
    if (!dansLePlan.has(relation.enfant)) continue
    if (dansLePlan.has(relation.parent)) continue
    // Une table sans chemin déclaré relève de `tablesSansChemin`, qui le dit mieux : la compter ici
    // aussi ferait deux alertes pour un seul défaut.
    if (chemins[relation.parent] == null) continue

    const deja = parTable.get(relation.parent)
    if (deja) {
      if (!deja.pointeePar.includes(relation.enfant)) deja.pointeePar.push(relation.enfant)
      // Un parent pointé par plusieurs liens n'est effaçable que si TOUS le sont : il suffit d'un
      // lien obligatoire pour que la restauration s'arrête.
      deja.effacable = deja.effacable && relation.aLaSuppression === 'met_a_null'
      continue
    }
    parTable.set(relation.parent, {
      parent: relation.parent,
      pointeePar: [relation.enfant],
      effacable: relation.aLaSuppression === 'met_a_null',
    })
  }

  return [...parTable.values()].sort((a, b) => a.parent.localeCompare(b.parent))
}

// L'ordre de SUPPRESSION est l'inverse exact de l'ordre de restauration : on retire les enfants avant
// les parents. Déduit plutôt que réécrit — deux listes à tenir finiraient par diverger, et la seconde
// ne serait vérifiée par personne.
export function ordreSuppression(ordre: readonly string[] = ORDRE_RESTAURATION): string[] {
  return [...ordre].reverse()
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Ce qu'une sauvegarde de données ne contient pas — et qu'il faudra pourtant pour la restaurer.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Une colonne qui pointe un compte utilisateur (`auth.users`), table que ce chemin ne sauvegarde pas. */
export interface PrerequisCompte {
  table: string
  colonne: string
  /**
   * Vrai quand la colonne est NOT NULL. La distinction décide de tout : un prérequis facultatif se
   * solde par une trace d'auteur perdue, un prérequis obligatoire empêche purement et simplement la
   * ligne d'être réinsérée, et il n'existe aucun contournement — on ne met pas NULL dans une colonne
   * qui le refuse.
   */
  obligatoire: boolean
}

// Les quatorze colonnes du schéma `public` qui pointent `auth.users`, lues de pg_constraint le
// 18/09/2026 comme le reste de ce fichier.
//
// RELATIONS les exclut volontairement, et c'est justifié : `auth.users` n'appartient pas à
// l'application, ce chemin ne la sauvegarde pas et ne la restaurera pas. Mais les taire entièrement
// revient à laisser croire qu'un export de données suffit à remonter un dossier. Il ne suffit pas :
// quatre tables du plan d'export portent un compte en NOT NULL — `cabinet_admins`,
// `dossier_assignations`, `memberships` et `packs`. Une restauration dans une base dont les comptes
// ont disparu s'arrête net sur elles : la direction du cabinet, les affectations d'équipe, les accès
// clients et l'historique des packs.
//
// Autrement dit : la sauvegarde des données et celle des comptes sont deux sauvegardes, pas une. Les
// lister ici, hors de RELATIONS, dit les deux choses à la fois — elles ne sont pas restaurées, et
// elles sont exigées.
export const PREREQUIS_AUTH: readonly PrerequisCompte[] = [
  { table: 'agent_conversations', colonne: 'created_by', obligatoire: false },
  { table: 'cabinet_admins', colonne: 'user_id', obligatoire: true },
  { table: 'comptes_courants_associes', colonne: 'created_by', obligatoire: false },
  { table: 'dossier_assignations', colonne: 'user_id', obligatoire: true },
  { table: 'emails_envoyes', colonne: 'envoye_par', obligatoire: false },
  { table: 'emprunts', colonne: 'created_by', obligatoire: false },
  { table: 'memberships', colonne: 'user_id', obligatoire: true },
  { table: 'mouvements_cca', colonne: 'created_by', obligatoire: false },
  { table: 'packs', colonne: 'generated_by', obligatoire: true },
  { table: 'piece_commentaires', colonne: 'auteur_id', obligatoire: false },
  { table: 'pieces', colonne: 'uploaded_by', obligatoire: false },
  { table: 'previsionnels_bancaires', colonne: 'updated_by', obligatoire: false },
  { table: 'super_admins', colonne: 'user_id', obligatoire: true },
  { table: 'supplements', colonne: 'created_by', obligatoire: false },
]

/** Les comptes utilisateurs dont une sauvegarde dépend, séparés selon ce que coûte leur absence. */
export interface ComptesRequis {
  /** Sans eux, la restauration s'arrête : la colonne refuse NULL. */
  obligatoires: string[]
  /** Sans eux, la restauration aboutit ; seule la trace de l'auteur est perdue. */
  facultatifs: string[]
}

// Les comptes qu'il faudra avoir sous la main avant de restaurer cette sauvegarde-ci.
//
// À exécuter en même temps que `liensPerdus`, et pour la même raison : savoir avant d'écrire la
// première ligne, plutôt que de le découvrir sur la trente-septième table.
//
// Un compte qui figure dans les deux colonnes est obligatoire — c'est le cas dès qu'un même
// utilisateur a, par exemple, généré un pack et déposé une pièce.
export function comptesRequis(contenu: Contenu): ComptesRequis {
  const obligatoires = new Set<string>()
  const facultatifs = new Set<string>()

  for (const prerequis of PREREQUIS_AUTH) {
    const lignes = contenu[prerequis.table]
    if (!lignes) continue
    for (const ligne of lignes) {
      const valeur = ligne[prerequis.colonne]
      if (valeur == null) continue
      ;(prerequis.obligatoire ? obligatoires : facultatifs).add(String(valeur))
    }
  }

  for (const compte of obligatoires) facultatifs.delete(compte)
  return { obligatoires: [...obligatoires].sort(), facultatifs: [...facultatifs].sort() }
}

/** Une ligne que la sauvegarde suppose déjà présente dans la base d'arrivée. */
export interface ReferenceExterne {
  table: string
  colonne: string
  /** La table parente, absente de la sauvegarde. */
  parent: string
  /** Les identifiants attendus, sans doublon. */
  valeurs: string[]
}

// L'envers exact de `liensPerdus` : ce que celui-ci ignore délibérément, celui-ci le nomme.
//
// `liensPerdus` passe son chemin quand la table parente est absente de la sauvegarde, et il a raison —
// un export d'un seul dossier ne contient pas `cabinets`, ce n'est pas une faute. Mais le silence
// laissait ces lignes-là sans statut : ni perdues, ni garanties. Or elles décident du succès de la
// restauration tout autant que les autres, à ceci près qu'elles ne dépendent pas de la sauvegarde
// mais de la base d'arrivée.
//
// Concrètement, sur un export de dossier : la ligne `cabinets` du cabinet propriétaire. Sans elle,
// `dossiers.cabinet_id` échoue à la toute première table, et rien d'autre ne sera tenté.
export function referencesExternes(contenu: Contenu): ReferenceExterne[] {
  const externes: ReferenceExterne[] = []

  for (const relation of TOUS_LES_LIENS) {
    const lignes = contenu[relation.enfant]
    if (!lignes) continue
    // La table parente est là : ses liens relèvent de `liensPerdus`, pas d'ici.
    if (contenu[relation.parent]) continue

    const valeurs = new Set<string>()
    for (const ligne of lignes) {
      const valeur = ligne[relation.colonne]
      if (valeur == null) continue
      valeurs.add(String(valeur))
    }
    if (valeurs.size === 0) continue
    externes.push({
      table: relation.enfant,
      colonne: relation.colonne,
      parent: relation.parent,
      valeurs: [...valeurs].sort(),
    })
  }
  return externes
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Les anciennes colonnes des notes internes (espace client, étape P0).
// ─────────────────────────────────────────────────────────────────────────────────────────────────

// `pieces.notes` et `documents_divers.notes` portaient les notes internes du cabinet dans des tables que le client du
// dossier LIT. Depuis le 09/10/2026 elles vivent dans `notes_internes`, que le cabinet seul lit (migration
// notes_internes_du_cabinet) ; `dossiers.notes`, qu'aucune ligne n'a jamais remplie, attend avec elles sa suppression
// (question EC-Q7 au cabinet). Plus aucun code ne les écrit, la restauration non plus : elle retire la clé de chaque
// ligne. Une sauvegarde d'hier la porte encore, et la réécrire rendrait au client ce qu'on vient de lui retirer — ou
// échouerait sur une colonne supprimée.
//
// Une note qu'aucune ligne de `notes_internes` ne porte dans la sauvegarde — toutes, pour une sauvegarde faite avant la
// migration, qui n'a pas cette table — y passe, comme la migration les a recopiées : le texte tel qu'écrit, une note
// blanche n'en étant pas une. Une cible qui a déjà sa ligne la garde : c'est elle qui fait foi, l'ancienne colonne
// n'étant plus tenue à jour (une note effacée y reste une ligne au texte vide, jamais retirée — elle ne ressuscite donc
// pas ici). Une note de DOSSIER n'a nulle part où aller : la restauration se refuse plutôt que de la perdre sans le dire.
export const ANCIENNES_COLONNES_DES_NOTES = ['pieces', 'documents_divers', 'dossiers'] as const

/** Une note blanche n'en est pas une : la règle de la recopie, `btrim(notes, E' \t\n\r') <> ''` en base. */
export function noteBlanche(texte: string): boolean {
  return /^[ \t\n\r]*$/.test(texte)
}

export interface ContenuSansAnciennesNotes {
  /** La sauvegarde à écrire : sans les anciennes colonnes, ses notes dans `notes_internes`. */
  contenu: Contenu
  /** Les notes des anciennes colonnes passées dans `notes_internes`. */
  notesRecopiees: number
  /** Ce que la restauration perdrait : elle se refuse. */
  refus: string[]
}

// Pure, comme le reste de ce fichier : la sauvegarde reçue n'est jamais modifiée — `liensPerdus` et la vérification
// doivent encore pouvoir la lire telle qu'elle est.
export function sansAnciennesNotes(contenu: Contenu): ContenuSansAnciennesNotes {
  const sortie: Contenu = { ...contenu }
  const refus: string[] = []
  const deja = new Set((contenu.notes_internes ?? []).flatMap((n) =>
    [n.piece_id != null ? `piece:${String(n.piece_id)}` : null, n.document_id != null ? `document:${String(n.document_id)}` : null]
      .filter((c): c is string => c !== null)))
  const recopiees: Record<string, unknown>[] = []
  for (const table of ANCIENNES_COLONNES_DES_NOTES) {
    const lignes = contenu[table]
    if (!lignes) continue
    sortie[table] = lignes.map((ligne) => {
      if (!('notes' in ligne)) return ligne
      const { notes, ...reste } = ligne
      if (typeof notes !== 'string' || noteBlanche(notes)) return reste
      if (table === 'dossiers') {
        refus.push(`La fiche du dossier « ${String(ligne.id)} » porte une note (dossiers.notes) que l'application ne garde `
          + 'plus nulle part : la restaurer la perdrait.')
        return reste
      }
      const cible = table === 'pieces' ? 'piece' : 'document'
      if (!deja.has(`${cible}:${String(ligne.id)}`)) {
        recopiees.push({ dossier_id: ligne.dossier_id, [cible === 'piece' ? 'piece_id' : 'document_id']: ligne.id, texte: notes })
      }
      return reste
    })
  }
  if (recopiees.length > 0) sortie.notes_internes = [...(contenu.notes_internes ?? []), ...recopiees]
  return { contenu: sortie, notesRecopiees: recopiees.length, refus }
}

/**
 * L'identité d'une ligne pour la vérification d'une restauration : sa clé primaire, sauf pour une note interne, qui se
 * reconnaît à sa CIBLE — une note recopiée d'une ancienne colonne n'a d'identifiant qu'une fois écrite (la base le
 * tire), et une cible n'a qu'une note (contraintes uniques de la migration).
 */
export function identiteRestauree(table: string, ligne: Record<string, unknown>): string {
  if (table !== 'notes_internes') return identiteLigne(table, ligne)
  return ligne.piece_id != null ? `piece:${String(ligne.piece_id)}` : `document:${String(ligne.document_id)}`
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Le plan de réinsertion : dans quel ordre écrire, et ce qu'il faut repasser ensuite.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Une table à réinsérer, avec les lignes telles qu'elles doivent partir au PREMIER passage — sans les colonnes que la
 *  base calcule (`COLONNES_GENEREES`). */
export interface EtapeReinsertion {
  table: string
  lignes: Record<string, unknown>[]
}

/** Les valeurs auto-référencées à reposer, une fois toutes les lignes de la table en place. */
export interface SecondePasse {
  table: string
  colonne: string
  valeurs: { id: string; valeur: unknown }[]
}

export interface PlanReinsertion {
  etapes: EtapeReinsertion[]
  secondePasse: SecondePasse[]
  /**
   * Les tables présentes dans la sauvegarde mais absentes de l'ordre de restauration. Elles ne
   * seraient écrites nulle part : un appelant qui les ignore restaure moins qu'il ne croit.
   */
  tablesIgnorees: string[]
}

// Transforme une sauvegarde en la suite d'écritures qui la remet en base.
//
// Pourquoi la seconde passe, exactement : `factures_emises.facture_origine_id` pointe une autre
// facture (un avoir désigne celle qu'il annule). L'essai en base du 18/09/2026 est plus précis que ce
// qu'on croyait — Postgres ACCEPTE un avoir placé avant son origine tant que les deux lignes partent
// dans la MÊME commande INSERT ; il le refuse dès qu'elles partent en deux commandes.
//
// Or une restauration découpe forcément ses écritures en lots : le lot est un paramètre technique, il
// ne doit pas décider si la restauration aboutit. Sans seconde passe, une table restaurée d'un bloc
// passerait et la même table restaurée en deux lots échouerait — le genre de panne qui n'apparaît
// qu'en production, parce que seule la production est assez grosse pour franchir le seuil.
//
// D'où la règle : la colonne part à NULL pour tout le monde, puis on la repose. Le résultat ne dépend
// alors plus d'aucune taille de lot.
//
// Et ce qui s'écrit est la sauvegarde SANS les anciennes colonnes des notes internes, ses notes dans `notes_internes`
// (voir `sansAnciennesNotes`) : la restauration n'écrit pas ce que plus aucun code n'écrit. Ni ce que la base calcule
// (voir `COLONNES_GENEREES`) : chaque étape part sans ses colonnes générées.
export function planReinsertion(
  sauvegarde: Contenu,
  ordre: readonly string[] = ORDRE_RESTAURATION,
): PlanReinsertion {
  const contenu = sansAnciennesNotes(sauvegarde).contenu
  const etapes: EtapeReinsertion[] = []
  const secondePasse: SecondePasse[] = []

  for (const table of ordre) {
    const lignes = contenu[table]
    if (!lignes || lignes.length === 0) continue

    const parVagues = TABLES_AUTO_REFERENCEES_PAR_VAGUES.filter((a) => a.table === table).map((a) => a.colonne)
    if (parVagues.length > 0) {
      // Les lignes partent telles quelles, liens compris : aucune seconde passe ne les reposerait.
      for (const vague of vaguesParLien(lignes, parVagues)) etapes.push({ table, lignes: vague })
      continue
    }

    const auto = TABLES_AUTO_REFERENCEES.filter((a) => a.table === table)
    if (auto.length === 0) {
      etapes.push({ table, lignes })
      continue
    }

    // Copie plutôt que modification en place : la sauvegarde reçue doit rester intacte, ne serait-ce
    // que pour que `liensPerdus` puisse encore être exécuté dessus après coup.
    const premierePasse = lignes.map((ligne) => ({ ...ligne }))
    for (const { colonne } of auto) {
      const valeurs: { id: string; valeur: unknown }[] = []
      for (const ligne of premierePasse) {
        if (ligne[colonne] == null) continue
        valeurs.push({ id: String(ligne.id), valeur: ligne[colonne] })
        ligne[colonne] = null
      }
      if (valeurs.length > 0) secondePasse.push({ table, colonne, valeurs })
    }
    etapes.push({ table, lignes: premierePasse })
  }

  const connues = new Set(ordre)
  const tablesIgnorees = Object.keys(contenu)
    .filter((table) => !connues.has(table) && contenu[table].length > 0)
    .sort()

  // Les colonnes générées se retirent ICI, une fois pour toutes les étapes — les vagues, la première passe des avoirs et
  // les lignes ordinaires —, après le calcul des vagues et de la seconde passe, qui lisent l'identifiant et les liens de
  // chaque ligne. Aucune colonne générée n'en est un (`sauvegardeColonnesGenerees.test.ts`) ; à cette place, le résultat
  // n'en dépend pas.
  return {
    etapes: etapes.map(({ table, lignes }) => ({ table, lignes: sansColonnesGenerees(table, lignes) })),
    secondePasse,
    tablesIgnorees,
  }
}
