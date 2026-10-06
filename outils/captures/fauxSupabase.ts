// Faux client Supabase du banc de capture (voir vite.config.ts, vitrine.mjs) — données FICTIVES
// uniquement : aucun nom, aucun montant de ce fichier ne vient d'un dossier réel, et ce doit rester
// vrai (les vrais dossiers porteront des données de patients).
//
// Il ne simule que ce qu'un écran LIT : les filtres `eq`/`in`/`is`/`gte`/`lte` s'appliquent quand la
// colonne existe dans la ligne, `range` pagine et `count` annonce le total — sans quoi `lireTout`
// déclarerait chaque lecture incomplète et les écrans afficheraient leur bandeau au lieu de leurs
// données. Les écritures ne font rien. Une table absente d'ici est lue vide.
//
// Les dossiers de la VALIDATION (d9, d10) tirent leurs écritures, leur numérotation et la 2035 gardée du
// code même de l'application (voir `dossierDeValidation`) : écrits à la main, ils montreraient un écart
// de concordance ou une 2035 « qui ne se retrouve plus » qui ne viendraient que du banc. Ces modules
// n'importent pas le client Supabase, donc ne bouclent pas sur ce fichier.
import { acquisitionsDesBiens, ecritureDeLaDotation } from '../../src/lib/amortissements'
import { ecritureDuMouvement, type MouvementBancaire } from '../../src/lib/affectationBanque'
import { arrondirPourFormulaire, valeursDesCases } from '../../src/lib/cases2035'
import { cotisationsComptees, ecritureDeLaCotisation } from '../../src/lib/cotisationRapprochee'
import { calculerDeclaration2035 } from '../../src/lib/declaration2035'
import { lignesPourPiece, piecesAComptabiliser } from '../../src/lib/ecritures'
import { numeroterFec } from '../../src/lib/fec'
import { ecritureDuForfait } from '../../src/lib/forfaitKilometrique'
import { partsDuReleve } from '../../src/lib/partsDuReleve'
import { paiementsDesPieces } from '../../src/lib/rattachement'
import { instantane2035 } from '../../src/lib/validationExercice'
import { ecritureDuVirementPersonnel } from '../../src/lib/virementPersonnel'
import type {
  Categorie, CotisationDeclaree, EcritureBrouillon, Immobilisation, NatureImmobilisation, Piece, VehiculeDossier,
} from '../../src/lib/types'

type Ligne = Record<string, unknown>

const MAINTENANT = '2026-09-25T08:00:00Z'

// Logo du cabinet : aucun par défaut. Le banc d'installabilité (installable.mjs) en pose un, par une
// clé du stockage local écrite avant le chargement, pour éprouver le manifeste que reçoit un cabinet
// qui a son logo — celui des deux qui n'était pas installable. La valeur est l'adresse du logo.
const LOGO_DU_BANC = typeof localStorage === 'undefined' ? null : localStorage.getItem('banc-logo')

const dossiers: Ligne[] = [
  ['d1', 'Cabinet infirmier Moreau', '12345678900012', '86.90D', 'Activités des infirmiers et des sages-femmes'],
  ['d2', 'Sophie Lambert', null, null, null],
  ['d3', 'Marc Petit', null, null, null],
  ['d4', 'Julie Roux', null, null, null],
  ['d5', 'SCM Les Oliviers', null, null, null],
  ['d6', 'Thomas Girard', null, null, null],
  // Le seul dossier assujetti à la TVA du banc : un conseil qui facture et encaisse par virement.
  // C'est lui que montre l'onglet TVA (voir TVA_D7 plus bas) ; le cabinet infirmier, exonéré comme
  // toute infirmière, n'a pas de déclaration à déposer.
  ['d7', 'Atelier Bernard Conseil', '98765432100015', '70.22Z', 'Conseil pour les affaires et autres conseils de gestion'],
  // Le seul dossier tenu en ENGAGEMENT (BIC, IS) du banc : une société de design, assujettie, dont les
  // factures passent en 401/411 et que ses règlements soldent (voir ENGAGEMENT_D8 plus bas).
  ['d8', 'SAS Lumen Studio', '11122233300014', '74.10Z', 'Activités spécialisées de design'],
  // Les deux dossiers de la VALIDATION d'un exercice (voir `dossierDeValidation`) : une kinésithérapeute dont
  // l'exercice 2025 est validé — tout ce qu'il a produit est figé — et 2026 en cours ; un ostéopathe dont
  // l'exercice 2025, complet et concordant, attend sa validation.
  ['d9', 'Hélène Marchand', '22233344400017', '86.90E', "Activités des professionnels de la rééducation, de l'appareillage et des pédicures-podologues"],
  ['d10', 'Paul Bertin', '33344455500018', '86.90F', 'Activités de santé humaine non classées ailleurs'],
].map(([id, nom, siret, code_naf, libelle_naf]) => ({
  id, nom, siret, code_naf, libelle_naf, cabinet_id: 'cab1', contact_nom: null, contact_email: null,
  notes: null, archive: false, created_at: '2026-01-05T09:00:00Z', code_email: id,
  assujetti_tva: id === 'd7' || id === 'd8', adresse: null,
  tva_periodicite: 'trimestrielle', tva_sur_debits: false,
  mode_comptable: id === 'd8' ? 'engagement' : 'tresorerie', compte_notes_de_frais: '455000',
}))

// Les postes sont ceux que le formulaire connaît (lib/cases2035.ts), comme un cabinet les saisit — sauf
// l'électricité, laissée sur un poste qu'aucune case ne reçoit : c'est elle qui fait paraître « Postes sans
// case du formulaire » dans la Clôture du cabinet infirmier, et le préalable qui en refuse la validation.
const categories: Ligne[] = [
  ['c1', 'Télécommunications', '626000', 'Fournitures de bureau, frais de documentation, de correspondance et de téléphone'],
  ['c2', 'Petit matériel médical', '606300', 'Achats'],
  ['c3', 'Électricité', '606100', 'eau_gaz_electricite'],
  ['c4', 'Assurances', '616000', "Primes d'assurance"],
  ['c5', 'Entretien du véhicule', '615500', 'Entretien et réparations'],
  ['c6', 'Loyer', '613200', 'Loyers et charges locatives'],
  ['c7', 'Fournitures de bureau', '606400', 'Fournitures de bureau'],
  ['c8', 'Logiciels et abonnements', '651000', 'Autres frais divers de gestion'],
  // La seule catégorie de RECETTE du banc : les ventes du dossier en engagement, et les virements de
  // l'Assurance maladie que le cabinet infirmier affecte sans justificatif (voir l8).
  ['c9', 'Prestations de services', '706000', 'Recettes'],
  // Des frais que la banque prélève sans facture : l'autre mouvement affecté du banc (l9).
  ['c10', 'Frais bancaires', '627000', 'Frais financiers'],
].map(([id, libelle, compte_comptable, poste_2035], i) => ({
  id, libelle, compte_comptable, poste_2035, code: String(id), dossier_id: null, ordre: i,
}))

function piece(id: string, date: string, tiers: string, ttc: number, tva: number, categorie: string | null, statut: string): Ligne {
  return {
    id, dossier_id: 'd1', uploaded_by: null, source: 'upload', storage_path: `d1/${id}.pdf`, nom_fichier: `${id}.pdf`,
    storage_hash: null, date_piece: date, tiers, montant_ht: Math.round((ttc - tva) * 100) / 100, montant_tva: tva,
    montant_ttc: ttc, devise: 'EUR', montant_devise: null, taux_change: null, conversion_source: null,
    categorie_id: categorie, sous_dossier_id: null, type_piece: 'achat', statut, notes: null, confiance: 'haute',
    superpdp_invoice_id: null, created_at: `${date}T10:00:00Z`, updated_at: MAINTENANT,
  }
}

const pieces: Ligne[] = [
  piece('p1', '2026-09-12', 'Télécom Plus', 39.99, 6.67, 'c1', 'a_valider'),
  piece('p2', '2026-09-10', 'Pharma Distrib Sud', 186.4, 31.07, 'c2', 'a_valider'),
  piece('p3', '2026-09-05', 'Énergie Services', 84.2, 14.03, 'c3', 'validee'),
  piece('p4', '2026-09-02', 'Assurance Pro Santé', 312, 0, 'c4', 'validee'),
  piece('p5', '2026-08-28', 'Garage du Centre', 245.6, 40.93, 'c5', 'a_valider'),
  piece('p6', '2026-08-25', 'SCI Les Tilleuls', 650, 0, 'c6', 'validee'),
  piece('p7', '2026-08-21', 'Papeterie Moderne', 27.35, 4.56, 'c7', 'validee'),
  piece('p8', '2026-08-18', 'LogiSoins', 29, 4.83, null, 'a_valider'),
  // Deux factures d'un même fournisseur et l'avoir qu'il a consenti, réglés par UN virement (l20, voir
  // `reglements_groupes`) : 264 + 132 − 24 = 372 €.
  piece('p9', '2026-09-03', 'Médical Équipement Pro', 264, 44, 'c2', 'validee'),
  piece('p10', '2026-09-09', 'Médical Équipement Pro', 132, 22, 'c2', 'validee'),
  piece('p11', '2026-09-12', 'Médical Équipement Pro', -24, -4, 'c2', 'validee'),
  // Deux biens IMMOBILISÉS (voir `immobilisations`) : un fauteuil de soins acheté avant la reprise du
  // dossier — sa valeur et son amortissement jusqu'à fin 2025 sont dans les à-nouveaux (`an2`, `an3`), donc
  // son acquisition ne s'écrit pas — et un ordinateur acheté en 2026, dont l'acquisition est écrite (`ac1`).
  // Leur facture est le justificatif de chacune de leurs dotations.
  piece('p12', '2021-12-20', 'Fauteuils Médicaux du Sud', 3200, 0, 'c2', 'validee'),
  piece('p13', '2026-02-15', 'Informatique Pro', 1200, 0, 'c7', 'validee'),
  // Le scooter de tournée, immobilisé (`i-d1c`) ET déclaré au cadre 7 sous le barème (`ve3`) : la Clôture dit que
  // le barème couvre déjà son amortissement, que la case CH déduit une seconde fois.
  piece('p14', '2026-03-10', 'Moto Services', 4200, 0, 'c5', 'validee'),
]

function ligne(id: string, date: string, libelle: string, montant: number, statut: string, pieceId: string | null, categorie: string | null = null): Ligne {
  return {
    id, dossier_id: 'd1', date, libelle, montant, statut, piece_id: pieceId, cotisation_id: null, categorie_id: categorie,
    taux_tva: null, prelevement_personnel: false, source_fichier: 'releve-septembre.csv', libelle_brut: null, created_at: MAINTENANT,
    emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false, reglement_groupe: false,
    id_externe: null,
  }
}

// Un mouvement rapproché d'un EMPRUNT (lib/echeanceEmprunt.ts), tel que `rapprocher_echeance_emprunt`
// le laisse : le découpage validé gardé sur la ligne — le numéro de l'échéance, ses intérêts et son
// assurance ; pour un déblocage, ni numéro, ni intérêts, ni assurance.
function mouvementEmprunt(id: string, date: string, libelle: string, montant: number, echeance: number | null, interets: number, assurance: number): Ligne {
  return {
    ...ligne(id, date, libelle, montant, 'rapprochee', null),
    emprunt_id: 'em1', emprunt_echeance: echeance, emprunt_interets: interets, emprunt_assurance: assurance,
  }
}

// L'écriture d'un mouvement AFFECTÉ à une catégorie sans justificatif (lib/affectationBanque.ts) : le
// compte de la catégorie face à la banque, sans pièce, telle que `affecter_mouvement_bancaire` l'écrit.
// Sans elle, la Checklist du banc dirait ces mouvements « à réaffecter ».
function ecritureReleve(id: string, mouvement: string, date: string, compte: string, libelle: string, sens: 'debit' | 'credit', montant: number): Ligne {
  return {
    id, dossier_id: 'd1', piece_id: null, ligne_bancaire_id: mouvement, date, compte, libelle, sens, montant,
    statut: 'proposee', created_at: MAINTENANT,
  }
}

// Une ligne du CADRE 7 du cabinet infirmier (lib/forfaitKilometrique.ts) : un véhicule et ses kilomètres
// professionnels d'un exercice.
function vehicule(
  id: string, annee: number, modele: string | null, type: string, puissance: number, motorisation: string,
  carburant: string | null, km: number, inscrit = false,
): Ligne {
  return {
    id, dossier_id: 'd1', annee, modele, type, puissance_fiscale: puissance, bareme: 'bnc', motorisation, carburant,
    km_professionnel: km, inscrit_immobilisations: inscrit, amortissements_a_reintegrer: null, created_at: MAINTENANT,
    updated_at: MAINTENANT,
  }
}

// Le FORFAIT KILOMÉTRIQUE d'une ligne du cadre 7, tel que `ecrire_forfait_kilometrique` l'écrit : au 31
// décembre, sans pièce, ni mouvement, ni bien, le 625110 face au compte de l'exploitant.
function ecritureForfait(id: string, vehiculeId: string, libelle: string, compte: string, sens: 'debit' | 'credit', montant: number): Ligne {
  return {
    id, dossier_id: 'd1', piece_id: null, ligne_bancaire_id: null, immobilisation_id: null, vehicule_id: vehiculeId,
    date: '2026-12-31', compte, libelle, sens, montant, statut: 'proposee', created_at: MAINTENANT,
  }
}

// L'écriture d'une pièce du cabinet infirmier réglée par un VIREMENT GROUPÉ (lib/reglementGroupe.ts) : la
// charge au TTC — le dossier ne récupère pas la TVA —, datée au paiement, et une contrepartie banque au
// montant de SA part, désignant le virement. Un avoir va dans l'autre sens.
function ecriturePiece(id: string, pieceId: string, mouvement: string | null, date: string, compte: string, sens: 'debit' | 'credit', montant: number): Ligne {
  return {
    id, dossier_id: 'd1', piece_id: pieceId, ligne_bancaire_id: mouvement, date, compte, libelle: 'Médical Équipement Pro', sens, montant,
    statut: 'proposee', created_at: MAINTENANT,
  }
}

// Les pièces du dossier assujetti (d7), sur les deuxième et troisième trimestres 2026 : la déclaration
// que l'onglet TVA propose dépend du jour où le banc tourne (la dernière période close), et chacun des
// deux trimestres porte des recettes, des achats, et le second une recette qu'aucun paiement ne date.
function pieceTva(id: string, date: string, tiers: string, ht: number, tva: number, type: 'achat' | 'vente'): Ligne {
  return {
    id, dossier_id: 'd7', uploaded_by: null, source: 'upload', storage_path: `d7/${id}.pdf`, nom_fichier: `${id}.pdf`,
    storage_hash: null, date_piece: date, tiers, montant_ht: ht, montant_tva: tva, montant_ttc: Math.round((ht + tva) * 100) / 100,
    devise: 'EUR', montant_devise: null, taux_change: null, conversion_source: null, categorie_id: null,
    sous_dossier_id: null, type_piece: type, statut: 'validee', notes: null, confiance: 'haute',
    superpdp_invoice_id: null, created_at: `${date}T10:00:00Z`, updated_at: MAINTENANT,
  }
}

function paiementTva(id: string, date: string, libelle: string, montant: number, pieceId: string | null): Ligne {
  return {
    id, dossier_id: 'd7', date, libelle, montant, statut: 'rapprochee', piece_id: pieceId, cotisation_id: null, categorie_id: null,
    taux_tva: null, prelevement_personnel: false, source_fichier: 'releve-2026.csv', libelle_brut: null, created_at: MAINTENANT,
    emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false, reglement_groupe: false,
    id_externe: null,
  }
}

const TVA_D7 = {
  pieces: [
    pieceTva('v1', '2026-04-30', 'Société Delta', 4000, 800, 'vente'),
    pieceTva('a1', '2026-06-01', 'Espace Pro — loyer du bureau', 900, 180, 'achat'),
    pieceTva('a2', '2026-06-18', 'Techno Plus — ordinateur portable', 1500, 300, 'achat'),
    pieceTva('v2', '2026-07-31', 'Groupe Hélios', 2500, 500, 'vente'),
    pieceTva('a3', '2026-07-15', 'Logiciel de facturation', 50, 10, 'achat'),
    pieceTva('v3', '2026-09-10', 'Cabinet Vasseur', 1200, 240, 'vente'),
  ],
  lignes: [
    paiementTva('t1', '2026-05-15', 'VIR SOCIETE DELTA', 4800, 'v1'),
    paiementTva('t2', '2026-06-05', 'PRLV ESPACE PRO', -1080, 'a1'),
    paiementTva('t3', '2026-06-20', 'CB TECHNO PLUS', -1800, 'a2'),
    paiementTva('t4', '2026-08-14', 'VIR GROUPE HELIOS', 3000, 'v2'),
    paiementTva('t5', '2026-07-20', 'PRLV LOGICIEL FACTURATION', -60, 'a3'),
  ],
}

// Les recettes du dossier assujetti encaissées SANS facture au dossier (lib/tvaDuReleve.ts), au troisième
// trimestre : un acompte affecté à 20 % — la catégorie au hors taxe, le 445710 à côté —, des honoraires
// affectés avant que le dossier devienne assujetti, sans taux (« TVA à choisir » dans Banque, un point de la
// Checklist, une recette que l'onglet TVA écarte en le disant), et une remise de carte ventilée dont la part
// de recette porte son taux. Leurs écritures sont celles que la base écrit.
function ecritureD7(...args: Parameters<typeof ecritureReleve>): Ligne {
  return { ...ecritureReleve(...args), dossier_id: 'd7' }
}

const RELEVE_D7 = {
  lignes: [
    { ...paiementTva('t6', '2026-08-12', 'VIR ATELIER RIVIERE ACOMPTE MISSION', 1800, null), categorie_id: 'c9', taux_tva: 20 },
    { ...paiementTva('t7', '2026-09-17', 'VIR CABINET NOEL HONORAIRES', 360, null), categorie_id: 'c9' },
    { ...paiementTva('t8', '2026-09-24', 'REMISE CB SEPTEMBRE CONSEIL', 237.6, null), ventilee: true },
  ],
  ventilations: [
    { id: 'vb5', dossier_id: 'd7', ligne_bancaire_id: 't8', categorie_id: 'c9', part_personnelle: false, montant: 240, taux_tva: 20, created_at: MAINTENANT },
    { id: 'vb6', dossier_id: 'd7', ligne_bancaire_id: 't8', categorie_id: 'c10', part_personnelle: false, montant: -2.4, taux_tva: null, created_at: MAINTENANT },
  ],
  ecritures: [
    ecritureD7('r19', 't6', '2026-08-12', '706000', 'VIR ATELIER RIVIERE ACOMPTE MISSION', 'credit', 1500),
    ecritureD7('r20', 't6', '2026-08-12', '445710', 'VIR ATELIER RIVIERE ACOMPTE MISSION', 'credit', 300),
    ecritureD7('r21', 't6', '2026-08-12', '512000', 'VIR ATELIER RIVIERE ACOMPTE MISSION', 'debit', 1800),
    ecritureD7('r22', 't7', '2026-09-17', '706000', 'VIR CABINET NOEL HONORAIRES', 'credit', 360),
    ecritureD7('r23', 't7', '2026-09-17', '512000', 'VIR CABINET NOEL HONORAIRES', 'debit', 360),
    ecritureD7('r24', 't8', '2026-09-24', '706000', 'REMISE CB SEPTEMBRE CONSEIL', 'credit', 200),
    ecritureD7('r25', 't8', '2026-09-24', '445710', 'REMISE CB SEPTEMBRE CONSEIL', 'credit', 40),
    ecritureD7('r26', 't8', '2026-09-24', '627000', 'REMISE CB SEPTEMBRE CONSEIL', 'debit', 2.4),
    ecritureD7('r27', 't8', '2026-09-24', '512000', 'REMISE CB SEPTEMBRE CONSEIL', 'debit', 237.6),
  ],
}

// Le dossier en ENGAGEMENT (d8) : une vente et un achat réglés, un achat qui attend son règlement, et
// le brouillon que l'application en tire (lib/engagement.ts) — la facture en 401/411 à sa date, le
// règlement au mouvement, chacune équilibrée seule. C'est lui qui fait paraître le réglage du modèle
// (verrouillé, le brouillon n'étant pas vide), la Clôture sans 2035 et « facture(s) sans règlement
// rapproché ».
function pieceEngagement(
  id: string, date: string, tiers: string, ht: number, tva: number, type: 'achat' | 'vente', categorie: string, nom: string,
): Ligne {
  return { ...pieceTva(id, date, tiers, ht, tva, type), dossier_id: 'd8', storage_path: `d8/${id}.pdf`, nom_fichier: nom, categorie_id: categorie }
}

function ecriture(id: string, pieceId: string, date: string, compte: string, libelle: string, sens: 'debit' | 'credit', montant: number, mouvement: string | null = null): Ligne {
  return {
    id, dossier_id: 'd8', piece_id: pieceId, ligne_bancaire_id: mouvement, date, compte, libelle, sens, montant,
    statut: 'proposee', created_at: MAINTENANT,
  }
}

const ENGAGEMENT_D8 = {
  pieces: [
    pieceEngagement('e1', '2026-07-10', 'Maison Arlan', 3000, 600, 'vente', 'c9', 'arlan-facture-0710.pdf'),
    pieceEngagement('e2', '2026-08-05', 'Imprimerie Duval', 450, 90, 'achat', 'c7', 'duval-facture-0805.pdf'),
    pieceEngagement('e3', '2026-09-01', 'Cloud Hébergement', 100, 20, 'achat', 'c8', 'cloud-facture-0901.pdf'),
    // Un écran de studio acheté en septembre 2025 et immobilisé, dont la dotation 2025 n'est pas écrite : la
    // Checklist la réclame.
    pieceEngagement('e4', '2025-09-01', 'Studio Lumière', 2400, 480, 'achat', 'c7', 'studio-lumiere-ecran.pdf'),
    // Une vente encaissée EN PARTIE : elle reste ouverte au 411, avec son reste, dans les comptes de tiers de la
    // Balance des comptes (lib/lettrage.ts) — à côté de l'achat qui attend son règlement et de l'écran de studio.
    pieceEngagement('e5', '2026-08-28', 'Atelier Corsaire', 1500, 300, 'vente', 'c9', 'corsaire-facture-0828.pdf'),
    // LE LETTRAGE FAIT À LA MAIN (ligne 32, seconde brique, lib/lettrage.ts) : une facture de l'imprimeur annulée par
    // son avoir, lettrées ensemble sans mouvement bancaire — elles ne sont plus ouvertes ; un avoir de l'hébergeur lettré
    // avec sa facture puis corrigé à la baisse, si bien que le lettrage ne se solde plus (il reste 60 €) ; et un avoir
    // consenti à l'atelier pour le reste de sa facture encaissée en partie, que la carte PROPOSE de lettrer.
    pieceEngagement('e6', '2026-09-08', 'Imprimerie Duval', 200, 40, 'achat', 'c7', 'duval-facture-0908.pdf'),
    pieceEngagement('e7', '2026-09-12', 'Imprimerie Duval', -200, -40, 'achat', 'c7', 'duval-avoir-0912.pdf'),
    pieceEngagement('e8', '2026-09-10', 'Cloud Hébergement', -50, -10, 'achat', 'c8', 'cloud-avoir-0910.pdf'),
    pieceEngagement('e9', '2026-09-20', 'Atelier Corsaire', -666.67, -133.33, 'vente', 'c9', 'corsaire-avoir-0920.pdf'),
  ],
  lignes: [
    { ...paiementTva('b1', '2026-07-25', 'VIR MAISON ARLAN', 3600, 'e1'), dossier_id: 'd8' },
    { ...paiementTva('b2', '2026-08-20', 'PRLV IMPRIMERIE DUVAL', -540, 'e2'), dossier_id: 'd8' },
    { ...paiementTva('b3', '2026-09-15', 'VIR ATELIER CORSAIRE ACOMPTE', 1000, 'e5'), dossier_id: 'd8' },
  ],
  ecritures: [
    ecriture('w1', 'e1', '2026-07-10', '706000', 'Maison Arlan', 'credit', 3000),
    ecriture('w2', 'e1', '2026-07-10', '445710', 'Maison Arlan', 'credit', 600),
    ecriture('w3', 'e1', '2026-07-10', '411000', 'Maison Arlan', 'debit', 3600),
    ecriture('w4', 'e1', '2026-07-25', '411000', 'Maison Arlan', 'credit', 3600, 'b1'),
    ecriture('w5', 'e1', '2026-07-25', '512000', 'Maison Arlan', 'debit', 3600, 'b1'),
    ecriture('w6', 'e2', '2026-08-05', '606400', 'Imprimerie Duval', 'debit', 450),
    ecriture('w7', 'e2', '2026-08-05', '445660', 'Imprimerie Duval', 'debit', 90),
    ecriture('w8', 'e2', '2026-08-05', '401000', 'Imprimerie Duval', 'credit', 540),
    ecriture('w9', 'e2', '2026-08-20', '401000', 'Imprimerie Duval', 'debit', 540, 'b2'),
    ecriture('w10', 'e2', '2026-08-20', '512000', 'Imprimerie Duval', 'credit', 540, 'b2'),
    ecriture('w11', 'e3', '2026-09-01', '651000', 'Cloud Hébergement', 'debit', 100),
    ecriture('w12', 'e3', '2026-09-01', '445660', 'Cloud Hébergement', 'debit', 20),
    ecriture('w13', 'e3', '2026-09-01', '401000', 'Cloud Hébergement', 'credit', 120),
    // L'ACQUISITION de l'écran de studio (lib/ecritures.ts) : le bien au compte de sa nature, sa TVA au 445620
    // (sur immobilisations), la dette au 404000 (fournisseurs d'immobilisations), à la date de la facture.
    ecriture('w14', 'e4', '2025-09-01', '218300', 'Studio Lumière', 'debit', 2400),
    ecriture('w15', 'e4', '2025-09-01', '445620', 'Studio Lumière', 'debit', 480),
    ecriture('w16', 'e4', '2025-09-01', '404000', 'Studio Lumière', 'credit', 2880),
    ecriture('w17', 'e5', '2026-08-28', '706000', 'Atelier Corsaire', 'credit', 1500),
    ecriture('w18', 'e5', '2026-08-28', '445710', 'Atelier Corsaire', 'credit', 300),
    ecriture('w19', 'e5', '2026-08-28', '411000', 'Atelier Corsaire', 'debit', 1800),
    ecriture('w20', 'e5', '2026-09-15', '411000', 'Atelier Corsaire', 'credit', 1000, 'b3'),
    ecriture('w21', 'e5', '2026-09-15', '512000', 'Atelier Corsaire', 'debit', 1000, 'b3'),
    // Un avoir s'écrit à l'envers de sa facture (lib/engagement.ts) : sa charge au crédit, sa dette au débit.
    ecriture('w22', 'e6', '2026-09-08', '606400', 'Imprimerie Duval', 'debit', 200),
    ecriture('w23', 'e6', '2026-09-08', '445660', 'Imprimerie Duval', 'debit', 40),
    ecriture('w24', 'e6', '2026-09-08', '401000', 'Imprimerie Duval', 'credit', 240),
    ecriture('w25', 'e7', '2026-09-12', '606400', 'Imprimerie Duval', 'credit', 200),
    ecriture('w26', 'e7', '2026-09-12', '445660', 'Imprimerie Duval', 'credit', 40),
    ecriture('w27', 'e7', '2026-09-12', '401000', 'Imprimerie Duval', 'debit', 240),
    ecriture('w28', 'e8', '2026-09-10', '651000', 'Cloud Hébergement', 'credit', 50),
    ecriture('w29', 'e8', '2026-09-10', '445660', 'Cloud Hébergement', 'credit', 10),
    ecriture('w30', 'e8', '2026-09-10', '401000', 'Cloud Hébergement', 'debit', 60),
    ecriture('w31', 'e9', '2026-09-20', '706000', 'Atelier Corsaire', 'debit', 666.67),
    ecriture('w32', 'e9', '2026-09-20', '445710', 'Atelier Corsaire', 'debit', 133.33),
    ecriture('w33', 'e9', '2026-09-20', '411000', 'Atelier Corsaire', 'credit', 800),
  ],
  // Ce que la base garde d'un lettrage fait à la main : l'appariement, rien d'autre. Le code et la date se calculent.
  lettrages: [
    { id: 'lm1', dossier_id: 'd8', groupe: 'lg1', piece_id: 'e6', compte: '401000', created_at: '2026-09-22T09:30:00Z' },
    { id: 'lm2', dossier_id: 'd8', groupe: 'lg1', piece_id: 'e7', compte: '401000', created_at: '2026-09-22T09:30:00Z' },
    { id: 'lm3', dossier_id: 'd8', groupe: 'lg2', piece_id: 'e3', compte: '401000', created_at: '2026-09-23T14:10:00Z' },
    { id: 'lm4', dossier_id: 'd8', groupe: 'lg2', piece_id: 'e8', compte: '401000', created_at: '2026-09-23T14:10:00Z' },
  ],
}

// Les ÉCHÉANCES DE COTISATION du cabinet infirmier (lib/cotisationRapprochee.ts) : l'appel d'août de l'Urssaf,
// prélevé et écrit — la cotisation au 646000, sa CSG-CRDS au 108000 ; l'échéance de septembre de la caisse
// de retraite, rapprochée avant que le rapprochement écrive, donc sans écriture (« Écrire les 1 » dans
// Cotisations, un point de la Checklist) ; un remboursement rapproché à tort d'un appel, qui ne s'écrit pas
// (la pastille « Ne s'écrit pas » dans Banque) ; et l'appel d'octobre, que rien ne paie encore.
function echeanceCotisation(id: string, echeance: string, appele: number, csg: number | null): Ligne {
  return {
    id, dossier_id: 'd1', echeance, montant_appele: appele, montant_verse: null, montant_csg_crds: csg,
    previsionnel: false, created_at: MAINTENANT,
  }
}

const COTISATIONS_D1 = {
  echeances: [
    echeanceCotisation('cs1', '2026-08-05', 520, 48.5),
    echeanceCotisation('cs2', '2026-09-05', 310, null),
    echeanceCotisation('cs3', '2026-09-20', 180, null),
    echeanceCotisation('cs4', '2026-10-05', 520, 48.5),
  ],
  lignes: [
    { ...ligne('l21', '2026-08-05', 'PRLV URSSAF COTISATIONS AOUT', -520, 'rapprochee', null), cotisation_id: 'cs1' },
    { ...ligne('l22', '2026-09-07', 'PRLV CAISSE RETRAITE ECHEANCE SEPTEMBRE', -310, 'rapprochee', null), cotisation_id: 'cs2' },
    { ...ligne('l23', '2026-09-21', 'VIR URSSAF REMBOURSEMENT', 180, 'rapprochee', null), cotisation_id: 'cs3' },
  ],
  ecritures: [
    ecritureReleve('r28', 'l21', '2026-08-05', '646000', 'PRLV URSSAF COTISATIONS AOUT', 'debit', 471.5),
    ecritureReleve('r29', 'l21', '2026-08-05', '108000', 'PRLV URSSAF COTISATIONS AOUT', 'debit', 48.5),
    ecritureReleve('r30', 'l21', '2026-08-05', '512000', 'PRLV URSSAF COTISATIONS AOUT', 'credit', 520),
  ],
}

// Une conversation d'assistant, pour photographier le panneau de droite ouvert — mêmes données
// fictives que le reste (Télécom Plus, LogiSoins) : le texte des réponses est écrit ici, jamais tiré
// d'un vrai échange.
function message(n: number, role: 'user' | 'assistant', texte: string, outils: string[] | null = null): Ligne {
  return {
    id: `m${n}`, dossier_id: 'd1', conversation_id: 'c1', role, texte, outils_utilises: outils,
    tokens_entree: null, tokens_sortie: null, created_by: 'u1', created_at: `2026-09-25T07:5${n}:00Z`,
  }
}

// Une ouverture reprise d'un autre logiciel (voir lib/aNouveaux.ts) : c'est elle qui fait paraître la
// note d'ouverture des Écritures et de la Balance des comptes, la ligne « Depuis l'ouverture » de la
// trésorerie et le bloc « Ouverture enregistrée » des Informations. Équilibrée au centime, comme la
// base l'exige.
function aNouveau(id: string, compte: string, compteOrigine: string, libelle: string, sens: 'debit' | 'credit', montant: number): Ligne {
  return {
    id, dossier_id: 'd1', date: '2026-01-01', compte, compte_origine: compteOrigine, libelle, sens, montant,
    source_nom: 'balance-2025.csv', source_empreinte: '0'.repeat(64), created_at: MAINTENANT,
  }
}

// Les natures : une partagée par le cabinet, une propre au cabinet infirmier, chacune avec son compte.
const natures: Ligne[] = [
  { id: 'n1', dossier_id: null, libelle: 'Matériel informatique', duree_annees_defaut: 3, ordre: 1, compte_immobilisation: '218300' },
  { id: 'n2', dossier_id: 'd1', libelle: 'Matériel médical', duree_annees_defaut: 10, ordre: 2, compte_immobilisation: '215400' },
  { id: 'n3', dossier_id: null, libelle: 'Matériel de transport', duree_annees_defaut: 5, ordre: 3, compte_immobilisation: '218200' },
]

// ── LES DEUX DOSSIERS DE LA VALIDATION (d9, d10) ──────────────────────────────────────────────────────────
//
// Leurs écritures sont celles que l'application ÉCRIRAIT — composées par ses propres fonctions, pas recopiées
// ici —, l'exercice 2025 de d9 est validé avec la numérotation même de son FEC, et sa 2035 gardée est celle
// que la Clôture calcule. Écrites à la main, une écriture d'un centime à côté ou une 2035 arrondie
// autrement ferait dire au banc « la 2035 ne se retrouve plus » ou « écart de concordance » : ce que les
// captures montreraient viendrait du banc, pas de l'application. Si la base refusait une de ces écritures, la
// Clôture le dirait aussi — c'est la même règle des deux côtés.

const TRESORERIE = { mode: 'tresorerie', compteNotesDeFrais: '455000' } as const

function pieceDe(dossier: string, id: string, date: string, tiers: string, ttc: number, categorie: string): Ligne {
  return { ...piece(id, date, tiers, ttc, 0, categorie, 'validee'), dossier_id: dossier, storage_path: `${dossier}/${id}.pdf` }
}

function mouvementDe(dossier: string, id: string, date: string, libelle: string, montant: number, statut: string, lien: Ligne = {}): Ligne {
  return { ...ligne(id, date, libelle, montant, statut, null), dossier_id: dossier, source_fichier: `releve-${date.slice(0, 4)}.csv`, ...lien }
}

interface SourcesDeValidation {
  dossier: string
  // Préfixe des identifiants d'écriture, propre au dossier.
  prefixe: string
  pieces: Ligne[]
  lignes: Ligne[]
  cotisations: Ligne[]
  immobilisations: Ligne[]
  vehicules: Ligne[]
  // Les exercices dont la dotation de chaque bien est écrite.
  dotations: number[]
}

function ecrituresDe(s: SourcesDeValidation): Ligne[] {
  const lignes = s.lignes as unknown as MouvementBancaire[]
  const rapprochees = lignes.filter((l) => l.statut === 'rapprochee')
  const paiements = paiementsDesPieces(rapprochees, [])
  const acquisitions = acquisitionsDesBiens(s.immobilisations as unknown as Immobilisation[], natures as unknown as NatureImmobilisation[], null)
  let n = 0
  const ecriture = (l: { compte: string; sens: 'debit' | 'credit'; montant: number; libelle: string; date: string }, liens: Ligne): Ligne => ({
    id: `${s.prefixe}${++n}`, dossier_id: s.dossier, piece_id: null, ligne_bancaire_id: null, immobilisation_id: null, vehicule_id: null,
    date: l.date, compte: l.compte, libelle: l.libelle, sens: l.sens, montant: l.montant, statut: 'proposee', created_at: MAINTENANT,
    valide_le: null, journal_code: null, numero_ecriture: null, piece_ref: null, piece_date: null, compte_lib: null, comp_aux_num: null,
    comp_aux_lib: null, ...liens,
  })
  const parPiece = piecesAComptabiliser(s.pieces as unknown as Piece[], categories as unknown as Categorie[], acquisitions)
    .flatMap(({ piece: p, compte, immobilisation }) =>
      lignesPourPiece(s.dossier, p, { compte, immobilisation }, false, paiements.get(p.id) ?? [], TRESORERIE)
        .map((l) => ecriture(l, { piece_id: l.piece_id, ligne_bancaire_id: l.ligne_bancaire_id ?? null })))
  const parMouvement = rapprochees.flatMap((m) => {
    const categorie = categories.find((c) => c.id === m.categorie_id)
    const cotisation = s.cotisations.find((c) => c.id === m.cotisation_id) as unknown as CotisationDeclaree | undefined
    const lignesDuMouvement = categorie ? ecritureDuMouvement(m, String(categorie.compte_comptable), null)
      : cotisation ? ecritureDeLaCotisation(m, cotisation, TRESORERIE.mode)
        : []
    return lignesDuMouvement.map((l) => ecriture({ ...l, date: m.date }, { ligne_bancaire_id: m.id }))
  })
  const virements = lignes.filter((m) => m.prelevement_personnel)
    .flatMap((m) => ecritureDuVirementPersonnel(m, TRESORERIE).map((l) => ecriture({ ...l, date: m.date }, { ligne_bancaire_id: m.id })))
  const dotations = s.immobilisations.flatMap((b) => {
    const bien = b as unknown as Immobilisation
    const compte = String(natures.find((x) => x.id === bien.nature_id)?.compte_immobilisation)
    return s.dotations.flatMap((annee) => ecritureDeLaDotation(bien, compte, annee, null)
      .map((l) => ecriture({ ...l, date: `${annee}-12-31` }, { immobilisation_id: bien.id })))
  })
  const forfaits = s.vehicules.flatMap((v) => {
    const vehicule = v as unknown as VehiculeDossier
    return (ecritureDuForfait(vehicule, TRESORERIE, null) ?? [])
      .map((l) => ecriture({ ...l, date: `${vehicule.annee}-12-31` }, { vehicule_id: vehicule.id }))
  })
  return [...parPiece, ...parMouvement, ...virements, ...dotations, ...forfaits]
}

// VALIDE un exercice comme `valider_exercice` le laisse : chaque écriture de l'exercice porte son journal, son
// numéro et les champs du FEC que la numérotation lui donne, et l'exercice validé garde ses totaux et sa 2035
// — calculée exactement comme la Clôture la calcule. L'empreinte est fictive : le banc répond « intacte » à
// `verifier_exercice_valide`.
function valider(s: SourcesDeValidation, ecritures: Ligne[], annee: number, valideLe: string, empreinte: string): Ligne {
  const dansLExercice = ecritures.filter((e) => String(e.date) <= `${annee}-12-31` && String(e.date) >= `${annee}-01-01`)
  const numerotation = numeroterFec(
    dansLExercice as unknown as EcritureBrouillon[], s.pieces as unknown as Piece[], categories as unknown as Categorie[], [],
    TRESORERIE.mode, s.lignes as unknown as MouvementBancaire[],
  )
  if (numerotation.horsFec.length > 0) console.error('[banc] écritures hors du FEC dans le dossier validé', numerotation.horsFec)
  for (const l of numerotation.lignes) {
    Object.assign(ecritures.find((e) => e.id === l.ecriture.id)!, {
      statut: 'validee', valide_le: valideLe, journal_code: l.journal, numero_ecriture: l.numero, piece_ref: l.pieceRef,
      piece_date: l.pieceDate, compte_lib: l.compteLib, comp_aux_num: l.compAuxNum, comp_aux_lib: l.compAuxLib,
    })
  }
  const centimes = (sens: 'debit' | 'credit') =>
    dansLExercice.filter((e) => e.sens === sens).reduce((t, e) => t + Math.round(Number(e.montant) * 100), 0) / 100

  const lignes = (s.lignes as unknown as MouvementBancaire[]).filter((l) => l.statut === 'rapprochee')
  const declaration = calculerDeclaration2035(
    annee, s.pieces as unknown as Piece[], categories as unknown as Categorie[], s.immobilisations as unknown as Immobilisation[],
    cotisationsComptees(s.cotisations as unknown as CotisationDeclaree[], lignes, TRESORERIE.mode),
    s.vehicules as unknown as VehiculeDossier[], false, paiementsDesPieces(lignes, []), partsDuReleve(lignes, categories as unknown as Categorie[], [], false),
  )
  const { valeurs } = valeursDesCases(declaration)
  const dossier = dossiers.find((d) => d.id === s.dossier)!
  const entete = { nom: dossier.nom as string | null, activite: dossier.libelle_naf as string | null, siret: dossier.siret as string | null }
  return {
    dossier_id: s.dossier, annee, valide_le: valideLe, valide_par: 'u1', mode_comptable: TRESORERIE.mode,
    nb_lignes: dansLExercice.length,
    nb_ecritures: new Set(numerotation.lignes.map((l) => `${l.journal}|${l.numero}`)).size,
    total_debit: centimes('debit'), total_credit: centimes('credit'),
    empreinte_precedente: null, empreinte,
    declaration: instantane2035(declaration, valeurs, arrondirPourFormulaire(valeurs, annee), entete),
  }
}

// Hélène Marchand, kinésithérapeute, tient sa comptabilité de trésorerie : 2025 est VALIDÉ — ses pièces, ses
// mouvements, son bien, sa ligne du cadre 7 et son échéance de cotisation sont figés avec ses écritures — et
// 2026, en cours, porte un loyer réglé et un virement de l'Assurance maladie à traiter.
const SOURCES_D9: SourcesDeValidation = {
  dossier: 'd9',
  prefixe: 'k-e',
  pieces: [
    pieceDe('d9', 'k1', '2025-01-05', 'SCI Les Platanes', 700, 'c6'),
    pieceDe('d9', 'k2', '2025-04-02', 'Assurance Pro Santé', 380, 'c4'),
    pieceDe('d9', 'k3', '2025-10-01', 'Informatique Pro', 1500, 'c7'),
    pieceDe('d9', 'k4', '2026-01-05', 'SCI Les Platanes', 700, 'c6'),
  ],
  lignes: [
    mouvementDe('d9', 'm1', '2025-01-08', 'PRLV SCI LES PLATANES LOYER JANVIER', -700, 'rapprochee', { piece_id: 'k1' }),
    mouvementDe('d9', 'm2', '2025-04-10', 'PRLV ASSURANCE PRO SANTE', -380, 'rapprochee', { piece_id: 'k2' }),
    mouvementDe('d9', 'm3', '2025-10-03', 'CB INFORMATIQUE PRO', -1500, 'rapprochee', { piece_id: 'k3' }),
    mouvementDe('d9', 'm4', '2025-06-20', 'VIR CPAM REMBOURSEMENTS JUIN', 6200, 'rapprochee', { categorie_id: 'c9' }),
    mouvementDe('d9', 'm5', '2025-11-20', 'VIR CPAM REMBOURSEMENTS NOVEMBRE', 5400, 'rapprochee', { categorie_id: 'c9' }),
    mouvementDe('d9', 'm6', '2025-12-31', 'FRAIS TENUE DE COMPTE', -24, 'rapprochee', { categorie_id: 'c10' }),
    mouvementDe('d9', 'm7', '2025-09-05', 'PRLV URSSAF COTISATIONS', -950, 'rapprochee', { cotisation_id: 'ck1' }),
    mouvementDe('d9', 'm10', '2025-12-15', 'VIR COMPTE PERSO DECEMBRE', -2000, 'ignoree', { prelevement_personnel: true }),
    mouvementDe('d9', 'm8', '2026-01-08', 'PRLV SCI LES PLATANES LOYER JANVIER', -700, 'rapprochee', { piece_id: 'k4' }),
    mouvementDe('d9', 'm9', '2026-02-20', 'VIR CPAM REMBOURSEMENTS FEVRIER', 3100, 'non_rapprochee'),
  ],
  cotisations: [{ ...echeanceCotisation('ck1', '2025-09-05', 950, 90), dossier_id: 'd9' }],
  immobilisations: [{
    id: 'i-d9', dossier_id: 'd9', piece_id: 'k3', nature_id: 'n1', libelle: 'Ordinateur portable', valeur: 1500,
    date_acquisition: '2025-10-01', date_mise_en_service: null, duree_annees: 3, created_at: MAINTENANT,
  }],
  vehicules: [{ ...vehicule('ve-d9', 2025, 'Renault Clio', 'voiture', 4, 'thermique', 'super_sans_plomb', 6000), dossier_id: 'd9' }],
  dotations: [2025],
}
const ECRITURES_D9 = ecrituresDe(SOURCES_D9)
const VALIDE_D9 = valider(SOURCES_D9, ECRITURES_D9, 2025, '2026-03-02T09:30:00Z', '9f2c4e81b07d36a5c8e1f4290b6d73e5a1c9f08b2e4d6a7c3b5f1e9d0a2c4b68')

// Paul Bertin, ostéopathe : 2025 est complet — sa pièce est payée, son encaissement affecté, ses écritures
// écrites et concordantes — et attend sa validation.
const SOURCES_D10: SourcesDeValidation = {
  dossier: 'd10',
  prefixe: 'q-e',
  pieces: [pieceDe('d10', 'o1', '2025-03-01', 'Cabinet Partagé Saint-Roch', 450, 'c6')],
  lignes: [
    mouvementDe('d10', 'q1', '2025-03-03', 'PRLV CABINET PARTAGE SAINT ROCH', -450, 'rapprochee', { piece_id: 'o1' }),
    mouvementDe('d10', 'q2', '2025-05-15', 'VIR PATIENTS MAI', 2300, 'rapprochee', { categorie_id: 'c9' }),
  ],
  cotisations: [],
  immobilisations: [],
  vehicules: [],
  dotations: [],
}
const ECRITURES_D10 = ecrituresDe(SOURCES_D10)

const TABLES: Record<string, Ligne[]> = {
  a_nouveaux: [
    aNouveau('an1', '512000', '51210000', 'Banque Populaire', 'debit', 8400),
    aNouveau('an2', '2154', '2154', 'Matériel médical', 'debit', 3200),
    aNouveau('an3', '28154', '28154', 'Amortissements du matériel médical', 'credit', 1280),
    aNouveau('an4', '164', '164', 'Emprunt matériel', 'credit', 2400),
    aNouveau('an5', '108', '108', 'Compte de l’exploitant', 'credit', 7920),
  ],
  agent_conversations: [
    message(1, 'user', 'Qu’est-ce qui reste à faire sur ce dossier ?'),
    message(2, 'assistant', '4 justificatifs sont à valider et 2 mouvements bancaires à rapprocher. Le prélèvement du 15/09 de Télécom Plus (39,99 €) correspond à la pièce du 12/09 : même montant, 3 jours d’écart.', ['points_a_traiter', 'lister_pieces']),
    message(3, 'user', 'Il reste une pièce sans catégorie ?'),
    message(4, 'assistant', 'Oui, une seule : LogiSoins, 29,00 € le 18/08/2026. C’est un abonnement de logiciel : une catégorie « Logiciels et abonnements » conviendrait.', ['lister_pieces']),
  ],
  cabinet_admins: [{ user_id: 'u1', cabinet_id: 'cab1', role: 'comptable_en_chef' }],
  cabinets: [{ id: 'cab1', nom: 'JD Consult', couleur_primaire: null, police_google_font: null, logo_storage_path: LOGO_DU_BANC ? 'cab1/logo.png' : null }],
  dossiers,
  categories,
  pieces: [...pieces, ...TVA_D7.pieces, ...ENGAGEMENT_D8.pieces, ...SOURCES_D9.pieces, ...SOURCES_D10.pieces],
  ecritures_brouillon: [
    // L'ACQUISITION de l'ordinateur du cabinet, telle que la génération l'écrit (lib/ecritures.ts) : sa facture sur
    // le compte de sa nature, au TTC — le dossier est exonéré —, à sa date, son paiement n'étant pas rapproché. Le
    // fauteuil, acquis avant la reprise du dossier, n'en a pas : la balance reprise porte déjà sa valeur (`an2`).
    { ...ecriturePiece('ac1', 'p13', null, '2026-02-15', '218300', 'debit', 1200), libelle: 'Informatique Pro' },
    { ...ecriturePiece('ac2', 'p14', null, '2026-03-10', '218200', 'debit', 4200), libelle: 'Moto Services' },
    // Les forfaits 2026 du cadre 7 : celui de la Peugeot, au barème (8 400 km × 0,357 + 1 395 = 4 393,80 €) ; celui
    // du scooter, écrit sur 2 400 km quand le cadre 7 en porte désormais 2 600 — à réécrire, et la Checklist le
    // réclame. Le cyclomoteur n'en a pas encore : l'exercice en cours ne se réclame pas.
    ecritureForfait('fk1', 've2', 'Indemnités kilométriques 2026 — Peugeot 208', '625110', 'debit', 4393.8),
    ecritureForfait('fk2', 've2', 'Indemnités kilométriques 2026 — Peugeot 208', '108000', 'credit', 4393.8),
    ecritureForfait('fk3', 've3', 'Indemnités kilométriques 2026 — Scooter de tournée', '625110', 'debit', 1348.8),
    ecritureForfait('fk4', 've3', 'Indemnités kilométriques 2026 — Scooter de tournée', '108000', 'credit', 1348.8),
    // La dotation 2026 de l'ordinateur du cabinet, telle que `ecrire_dotation_amortissement` l'écrit : au
    // 31 décembre, sans pièce ni mouvement, le 681100 face au compte d'amortissement de sa nature.
    { ...ecritureReleve('am1', '', '2026-12-31', '681100', 'Dotation 2026 — Ordinateur du cabinet', 'debit', 351.11), ligne_bancaire_id: null, immobilisation_id: 'i-d1b' },
    { ...ecritureReleve('am2', '', '2026-12-31', '281830', 'Dotation 2026 — Ordinateur du cabinet', 'credit', 351.11), ligne_bancaire_id: null, immobilisation_id: 'i-d1b' },
    ...ENGAGEMENT_D8.ecritures,
    ...RELEVE_D7.ecritures,
    ...COTISATIONS_D1.ecritures,
    ...ECRITURES_D9,
    ...ECRITURES_D10,
    ecritureReleve('r1', 'l8', '2026-08-20', '706000', 'VIR CPAM REMBOURSEMENTS AOUT', 'credit', 1850.4),
    ecritureReleve('r2', 'l8', '2026-08-20', '512000', 'VIR CPAM REMBOURSEMENTS AOUT', 'debit', 1850.4),
    ecritureReleve('r3', 'l9', '2026-08-31', '627000', 'FRAIS TENUE DE COMPTE', 'debit', 8.5),
    ecritureReleve('r4', 'l9', '2026-08-31', '512000', 'FRAIS TENUE DE COMPTE', 'credit', 8.5),
    ecritureReleve('r5', 'l13', '2026-09-25', '108000', 'VIR COMPTE PERSO SEPTEMBRE', 'debit', 1500),
    ecritureReleve('r6', 'l13', '2026-09-25', '512000', 'VIR COMPTE PERSO SEPTEMBRE', 'credit', 1500),
    // Le prêt véhicule (em1) : son déblocage au crédit du 164000, et sa première échéance découpée —
    // capital au 164000, intérêts au 661100, assurance au 616800.
    ecritureReleve('r7', 'l15', '2026-07-28', '164000', 'DEBLOCAGE PRET VEHICULE', 'credit', 15000),
    ecritureReleve('r8', 'l15', '2026-07-28', '512000', 'DEBLOCAGE PRET VEHICULE', 'debit', 15000),
    ecritureReleve('r9', 'l16', '2026-08-28', '164000', 'PRLV ECHEANCE PRET VEHICULE', 'debit', 291.01),
    ecritureReleve('r10', 'l16', '2026-08-28', '661100', 'PRLV ECHEANCE PRET VEHICULE', 'debit', 45),
    ecritureReleve('r11', 'l16', '2026-08-28', '616800', 'PRLV ECHEANCE PRET VEHICULE', 'debit', 12.5),
    ecritureReleve('r12', 'l16', '2026-08-28', '512000', 'PRLV ECHEANCE PRET VEHICULE', 'credit', 348.51),
    // Les deux mouvements ventilés : une ligne par part, puis la banque.
    ecritureReleve('r13', 'l18', '2026-09-16', '626000', 'PRLV SEPA FORFAIT MOBILE', 'debit', 42),
    ecritureReleve('r14', 'l18', '2026-09-16', '108000', 'PRLV SEPA FORFAIT MOBILE', 'debit', 18),
    ecritureReleve('r15', 'l18', '2026-09-16', '512000', 'PRLV SEPA FORFAIT MOBILE', 'credit', 60),
    ecritureReleve('r16', 'l19', '2026-09-19', '706000', 'REMISE CB SEPTEMBRE', 'credit', 490),
    ecritureReleve('r17', 'l19', '2026-09-19', '627000', 'REMISE CB SEPTEMBRE', 'debit', 4.7),
    ecritureReleve('r18', 'l19', '2026-09-19', '512000', 'REMISE CB SEPTEMBRE', 'debit', 485.3),
    // Les trois pièces du virement groupé l20 : chacune sa charge, datée au virement, et sa contrepartie.
    ecriturePiece('g1', 'p9', null, '2026-09-23', '606300', 'debit', 264),
    ecriturePiece('g2', 'p9', 'l20', '2026-09-23', '512000', 'credit', 264),
    ecriturePiece('g3', 'p10', null, '2026-09-23', '606300', 'debit', 132),
    ecriturePiece('g4', 'p10', 'l20', '2026-09-23', '512000', 'credit', 132),
    ecriturePiece('g5', 'p11', null, '2026-09-23', '606300', 'credit', 24),
    ecriturePiece('g6', 'p11', 'l20', '2026-09-23', '512000', 'debit', 24),
  ],
  // Les parts du virement groupé l20, signées comme le relevé : les deux factures en sortie, l'avoir en
  // entrée, déduit du paiement.
  reglements_groupes: [
    { id: 'rg1', dossier_id: 'd1', ligne_bancaire_id: 'l20', piece_id: 'p9', montant: -264, created_at: MAINTENANT },
    { id: 'rg2', dossier_id: 'd1', ligne_bancaire_id: 'l20', piece_id: 'p10', montant: -132, created_at: MAINTENANT },
    { id: 'rg3', dossier_id: 'd1', ligne_bancaire_id: 'l20', piece_id: 'p11', montant: 24, created_at: MAINTENANT },
  ],
  // Les parts des deux mouvements ventilés, signées comme le relevé.
  ventilations_bancaires: [
    { id: 'vb1', dossier_id: 'd1', ligne_bancaire_id: 'l18', categorie_id: 'c1', part_personnelle: false, montant: -42, taux_tva: null, created_at: MAINTENANT },
    { id: 'vb2', dossier_id: 'd1', ligne_bancaire_id: 'l18', categorie_id: null, part_personnelle: true, montant: -18, taux_tva: null, created_at: MAINTENANT },
    { id: 'vb3', dossier_id: 'd1', ligne_bancaire_id: 'l19', categorie_id: 'c9', part_personnelle: false, montant: 490, taux_tva: null, created_at: MAINTENANT },
    { id: 'vb4', dossier_id: 'd1', ligne_bancaire_id: 'l19', categorie_id: 'c10', part_personnelle: false, montant: -4.7, taux_tva: null, created_at: MAINTENANT },
    ...RELEVE_D7.ventilations,
  ],
  // Un prêt du cabinet infirmier, débloqué fin juillet : 15 000 € à 3,6 % sur 48 mois, soit 336,01 € par
  // mois, plus 12,50 € d'assurance. C'est lui qui fait paraître l'emprunt dans Financement, le découpage
  // d'une échéance dans la fiche d'un mouvement (l17, à rapprocher) et les intérêts dans la 2035.
  emprunts: [{
    id: 'em1', dossier_id: 'd1', nom: 'Prêt véhicule', organisme_preteur: 'Banque Régionale', capital_initial: 15000,
    taux_annuel: 3.6, date_debut: '2026-07-28', duree_mois: 48, created_at: MAINTENANT,
  }],
  // L'ordinateur du dossier d7 est immobilisé : sa TVA va en ligne 19 de la CA3, pas en 20. Sans nature,
  // sa dotation ne se compose pas, et le registre le dit.
  //
  // Les biens du cabinet infirmier (lib/amortissements.ts) : le fauteuil de soins, mis en service le 1er
  // janvier 2022 et amorti sur dix ans — 1 280 € jusqu'à fin 2025, ceux de la balance reprise —, dont la
  // dotation 2026 (320 €) reste à écrire ; et un ordinateur acheté le 15 février 2026, dont la dotation 2026
  // (351,11 €, prorata temporis) est déjà écrite.
  //
  // L'écran de studio de la société en engagement (d8), mis en service le 1er septembre 2025 : sa dotation
  // 2025 (266,67 €) manque, et la Checklist la réclame.
  immobilisations: [
    {
      id: 'i-d7', dossier_id: 'd7', piece_id: 'a2', nature_id: null, libelle: 'Ordinateur portable', valeur: 1500,
      date_acquisition: '2026-06-18', date_mise_en_service: null, duree_annees: 3, created_at: MAINTENANT,
    },
    {
      id: 'i-d1', dossier_id: 'd1', piece_id: 'p12', nature_id: 'n2', libelle: 'Fauteuil de soins', valeur: 3200,
      date_acquisition: '2021-12-20', date_mise_en_service: '2022-01-01', duree_annees: 10, created_at: MAINTENANT,
    },
    {
      id: 'i-d1b', dossier_id: 'd1', piece_id: 'p13', nature_id: 'n1', libelle: 'Ordinateur du cabinet', valeur: 1200,
      date_acquisition: '2026-02-15', date_mise_en_service: null, duree_annees: 3, created_at: MAINTENANT,
    },
    {
      id: 'i-d1c', dossier_id: 'd1', piece_id: 'p14', nature_id: 'n3', libelle: 'Scooter de tournée', valeur: 4200,
      date_acquisition: '2026-03-10', date_mise_en_service: null, duree_annees: 5, created_at: MAINTENANT,
    },
    {
      id: 'i-d8', dossier_id: 'd8', piece_id: 'e4', nature_id: 'n1', libelle: 'Écran de studio', valeur: 2400,
      date_acquisition: '2025-09-01', date_mise_en_service: null, duree_annees: 3, created_at: MAINTENANT,
    },
    ...SOURCES_D9.immobilisations,
  ],
  natures_immobilisation: natures,
  // Le CADRE 7 du cabinet infirmier : la Peugeot en 2025 — avant la reprise du dossier, son forfait est dans les
  // comptes repris — et en 2026, écrit ; le scooter de tournée, à réécrire ; un cyclomoteur, à écrire.
  vehicules: [
    vehicule('ve1', 2025, 'Peugeot 208', 'voiture', 5, 'thermique', 'diesel', 11200),
    vehicule('ve2', 2026, 'Peugeot 208', 'voiture', 5, 'thermique', 'diesel', 8400),
    vehicule('ve3', 2026, 'Scooter de tournée', 'moto', 3, 'electrique', null, 2600, true),
    vehicule('ve4', 2026, null, 'cyclomoteur', 0, 'thermique', 'super_sans_plomb', 1200),
    ...SOURCES_D9.vehicules,
  ],
  // La déclaration du premier trimestre, déposée : l'historique de l'onglet TVA la compare au calcul.
  declarations_tva: [{
    id: 'dt1', dossier_id: 'd7', periode_debut: '2026-01-01', periode_fin: '2026-03-31', tva_declaree: 0,
    credit_anterieur: 0, date_declaration: '2026-04-18', notes: null, created_at: '2026-04-18T09:00:00Z',
  }],
  // Le texte « lu » de la seule pièce sans catégorie : c'est ce qui fait offrir « Proposer une
  // catégorie » dans sa fiche. Écrit ici, fictif comme le reste.
  piece_textes_ocr: [{
    id: 't8', dossier_id: 'd1', piece_id: 'p8', document_id: null,
    texte: 'LOGISOINS SAS\nFacture n° 2026-0818\nAbonnement mensuel LogiSoins Premium — gestion des tournées et télétransmission\nTotal TTC 29,00 €',
  }],
  // Le volet social de l'exercice que Clôture affiche, déjà saisi : c'est ce qui fait paraître les
  // rubriques et l'estimation des cotisations dans les captures, au lieu d'un formulaire vide.
  volet_social_pamc: [{
    id: 'vs1', dossier_id: 'd1', annee: 2026, profession: 'auxiliaire_medical', remplacant: false,
    recettes_brutes: 64_000, honoraires_conventionnes: 61_500, depassements: 0, recettes_structures: null,
  }],
  // Les règles d'affectation du cabinet infirmier (lib/reglesAffectation.ts) : trois mouvements
  // proposés sur deux catégories, et un prélèvement « telecom » que la règle reconnaît mais que le lot
  // écarte — sa facture (p1, du même montant) attend d'être rapprochée.
  regles_affectation_bancaire: [
    { id: 'ra1', dossier_id: 'd1', motif: 'cpam', sens: 'encaissement', categorie_id: 'c9', taux_tva: null, created_at: MAINTENANT },
    { id: 'ra2', dossier_id: 'd1', motif: 'frais', sens: 'decaissement', categorie_id: 'c10', taux_tva: null, created_at: MAINTENANT },
    { id: 'ra3', dossier_id: 'd1', motif: 'telecom', sens: 'decaissement', categorie_id: 'c1', taux_tva: null, created_at: MAINTENANT },
  ],
  lignes_bancaires: [
    ligne('l1', '2026-09-15', 'PRLV SEPA TELECOM PLUS', -39.99, 'non_rapprochee', null),
    ligne('l2', '2026-09-11', 'CB PHARMA DISTRIB SUD', -186.4, 'non_rapprochee', null),
    ligne('l3', '2026-09-08', 'VIR CPAM TIERS PAYANT', 2418.6, 'non_rapprochee', null),
    ligne('l4', '2026-09-06', 'PRLV ENERGIE SERVICES', -84.2, 'rapprochee', 'p3'),
    ligne('l5', '2026-09-03', 'PRLV ASSURANCE PRO SANTE', -312, 'rapprochee', 'p4'),
    ligne('l6', '2026-09-01', 'PRLV SCI LES TILLEULS', -650, 'rapprochee', 'p6'),
    // Face à une pièce VALIDÉE (p7) : c'est la seule forme d'une « Pièce proposée » dans le panneau
    // d'un mouvement, une proposition ne portant que sur ce que le cabinet a relu.
    ligne('l7', '2026-08-24', 'CB PAPETERIE MODERNE', -27.35, 'non_rapprochee', null),
    // Deux mouvements AFFECTÉS sans justificatif : un virement de l'Assurance maladie en recette — pour
    // une infirmière, l'essentiel du chiffre d'affaires —, et des frais de tenue de compte.
    ligne('l8', '2026-08-20', 'VIR CPAM REMBOURSEMENTS AOUT', 1850.4, 'rapprochee', null, 'c9'),
    ligne('l9', '2026-08-31', 'FRAIS TENUE DE COMPTE', -8.5, 'rapprochee', null, 'c10'),
    // Deux mouvements à traiter que les règles d'affectation reconnaissent (voir
    // `regles_affectation_bancaire`) : la carte « Affectations proposées » les montre avec l3.
    ligne('l10', '2026-09-22', 'VIR CPAM TIERS PAYANT SEPT', 1375.2, 'non_rapprochee', null),
    ligne('l11', '2026-09-30', 'FRAIS OPPOSITION CHEQUE', -15, 'non_rapprochee', null),
    // Un acompte au garage : la facture (p5, 245,60 €) attend, d'un autre montant. Aucune paire « sans
    // doute », mais la fiche du mouvement avertit qu'un justificatif de ce tiers n'est rapproché de rien.
    ligne('l12', '2026-09-18', 'PRLV SEPA GARAGE DU CENTRE', -120, 'non_rapprochee', null),
    // Deux VIREMENTS PERSONNELS (lib/virementPersonnel.ts) : celui de septembre, écrit sur le compte de
    // l'exploitant ; celui de juillet, classé avant que ce classement s'écrive — sans écriture, l'onglet
    // Virements le montre et propose de l'écrire, et la Checklist le compte.
    { ...ligne('l13', '2026-09-25', 'VIR COMPTE PERSO SEPTEMBRE', -1500, 'ignoree', null), prelevement_personnel: true },
    { ...ligne('l14', '2026-07-25', 'VIR COMPTE PERSO JUILLET', -1200, 'ignoree', null), prelevement_personnel: true },
    // Le prêt véhicule : son déblocage et sa première échéance rapprochés, la deuxième à rapprocher — sa
    // fiche propose l'échéance n° 2 et son découpage (44,13 € d'intérêts, 12,50 € d'assurance).
    mouvementEmprunt('l15', '2026-07-28', 'DEBLOCAGE PRET VEHICULE', 15000, null, 0, 0),
    mouvementEmprunt('l16', '2026-08-28', 'PRLV ECHEANCE PRET VEHICULE', -348.51, 1, 45, 12.5),
    ligne('l17', '2026-09-28', 'PRLV ECHEANCE PRET VEHICULE', -348.51, 'non_rapprochee', null),
    // Deux mouvements VENTILÉS sur plusieurs comptes (lib/ventilationBanque.ts) : un forfait mobile payé
    // depuis le compte pro, professionnel pour 42 € et personnel pour 18 € ; et une remise de carte dont
    // la banque a retenu sa commission — 490 € d'honoraires, 4,70 € de frais, 485,30 € versés. Leurs
    // parts sont dans `ventilations_bancaires`, leurs écritures au brouillon.
    { ...ligne('l18', '2026-09-16', 'PRLV SEPA FORFAIT MOBILE', -60, 'rapprochee', null), ventilee: true },
    { ...ligne('l19', '2026-09-19', 'REMISE CB SEPTEMBRE', 485.3, 'rapprochee', null), ventilee: true },
    // Un VIREMENT qui règle plusieurs pièces (lib/reglementGroupe.ts) : deux factures d'un fournisseur, moins
    // l'avoir qu'il a consenti. Ses parts sont dans `reglements_groupes`, ses écritures au brouillon.
    { ...ligne('l20', '2026-09-23', 'VIR SEPA MEDICAL EQUIPEMENT PRO FACTURES AOUT SEPT', -372, 'rapprochee', null), reglement_groupe: true },
    ...COTISATIONS_D1.lignes,
    ...TVA_D7.lignes,
    ...RELEVE_D7.lignes,
    ...ENGAGEMENT_D8.lignes,
    ...SOURCES_D9.lignes,
    ...SOURCES_D10.lignes,
  ],
  cotisations_declarees: [...COTISATIONS_D1.echeances, ...SOURCES_D9.cotisations],
  // L'exercice 2025 de la kinésithérapeute, validé : ce qu'il garde, et sa 2035 telle qu'elle a été validée.
  exercices_valides: [VALIDE_D9],
  lettrages_manuels: ENGAGEMENT_D8.lettrages,
}

// La connexion bancaire (ligne 24) : une banque du BAC À SABLE connectée au cabinet infirmier, son compte
// choisi parmi deux, et une récupération qui rend des mouvements FICTIFS — dont un déjà dans le relevé
// importé en fichier (l11), pour que l'aperçu dise ce qu'il écarte, et un libellé LONG, pour éprouver le
// passage à la ligne du tableau. Les autres dossiers n'ont pas de banque connectée : ils montrent
// « Connecter une banque », puis la liste que rend `banques`.
const CONNEXION_D1 = {
  banque_nom: 'Mock ASPSP', banque_pays: 'FI', type_acces: 'personal', environnement: 'SANDBOX', etat: 'active',
  valide_jusqu_au: '2027-03-20T10:00:00+00:00', derniere_recuperation: '2026-09-20T08:30:00+00:00',
  created_at: '2026-09-20T08:00:00+00:00', compte_empreinte: 'emp-courant',
  comptes: [
    { empreinte: 'emp-courant', nom: 'Compte professionnel', devise: 'EUR', iban_fin: '4821', mouvements_lisibles: true },
    { empreinte: 'emp-livret', nom: 'Livret professionnel', devise: 'EUR', iban_fin: '7730', mouvements_lisibles: true },
  ],
}

function connexionBancaire(corps: Ligne): { data: unknown; error: unknown } {
  const d1 = corps.dossierId === 'd1'
  switch (corps.action) {
    case 'statut':
      return { data: { configuree: true, connexion: d1 ? CONNEXION_D1 : null }, error: null }
    case 'banques':
      return {
        data: {
          environnement: 'SANDBOX',
          banques: [
            { nom: 'Mock ASPSP', pays: 'FI', types_acces: ['business', 'personal'], accord_jours: 180 },
            { nom: 'Banque Fictive du Littoral', pays: 'FI', types_acces: ['personal'], accord_jours: 90 },
          ],
        },
        error: null,
      }
    case 'mouvements':
      return {
        data: {
          du: corps.du, au: corps.au, complete: true, motif: null, banque_nom: 'Mock ASPSP', environnement: 'SANDBOX',
          compte: { nom: 'Compte professionnel', iban_fin: '4821' }, avertissement: null,
          ecartes: { non_comptabilises: 1, autre_devise: 0, hors_periode: 0, illisibles: 0, doublons: 0 },
          mouvements: [
            { id_externe: 'eb:r:banc-1', date: '2026-09-29', libelle: 'PRLV SEPA LOGISOINS ABONNEMENT', montant: -29 },
            { id_externe: 'eb:r:banc-2', date: '2026-09-29', libelle: 'CB STATION SERVICE DU PORT', montant: -58.4 },
            {
              id_externe: 'eb:r:banc-3', date: '2026-09-30', montant: 312.8,
              libelle: 'VIR SEPA RECU / DE: MUTUELLE GENERALE DES PROFESSIONS DE SANTE / MOTIF: REMBOURSEMENTS TIERS PAYANT SEPTEMBRE 2026 / REF: 2026093000417',
            },
            { id_externe: 'eb:r:banc-4', date: '2026-09-30', libelle: 'FRAIS OPPOSITION CHEQUE', montant: -15 },
          ],
        },
        error: null,
      }
    default:
      return { data: null, error: { message: 'maquette' } }
  }
}

type Filtre = (l: Ligne) => boolean

function requete(table: string) {
  const filtres: Filtre[] = []
  let tete = false
  let unique: 'single' | 'maybe' | null = null
  let debut = 0
  let fin = Number.MAX_SAFE_INTEGER
  const sur = (col: string, test: (v: unknown) => boolean): Filtre => (l) => !(col in l) || test(l[col])
  const chaine: Record<string, unknown> = {}
  const soi = () => chaine
  Object.assign(chaine, {
    select: (_c?: string, options?: { head?: boolean }) => { tete = !!options?.head; return chaine },
    insert: soi, update: soi, upsert: soi, delete: soi,
    eq: (c: string, v: unknown) => { filtres.push(sur(c, (x) => x === v)); return chaine },
    neq: (c: string, v: unknown) => { filtres.push(sur(c, (x) => x !== v)); return chaine },
    in: (c: string, vs: unknown[]) => { filtres.push(sur(c, (x) => vs.includes(x))); return chaine },
    is: (c: string, v: unknown) => { filtres.push(sur(c, (x) => x === v)); return chaine },
    not: (c: string, op: string, v: unknown) => { filtres.push(sur(c, (x) => (op === 'is' ? x !== v : true))); return chaine },
    gte: (c: string, v: string) => { filtres.push(sur(c, (x) => x == null || String(x) >= v)); return chaine },
    lte: (c: string, v: string) => { filtres.push(sur(c, (x) => x == null || String(x) <= v)); return chaine },
    gt: soi, lt: soi, like: soi, ilike: soi, or: soi, filter: soi, match: soi, contains: soi, order: soi, limit: soi,
    range: (d: number, f: number) => { debut = d; fin = f; return chaine },
    single: () => { unique = 'single'; return chaine },
    maybeSingle: () => { unique = 'maybe'; return chaine },
    then: (suite: (r: unknown) => unknown, echec?: (e: unknown) => unknown) => {
      const lignes = (TABLES[table] ?? []).filter((l) => filtres.every((f) => f(l)))
      let reponse: unknown
      if (unique) reponse = { data: lignes[0] ?? null, error: null }
      else if (tete) reponse = { data: null, error: null, count: lignes.length }
      else reponse = { data: lignes.slice(debut, fin + 1), error: null, count: lignes.length }
      return Promise.resolve(reponse).then(suite, echec)
    },
  })
  return chaine
}

const session = { user: { id: 'u1', email: 'cabinet@exemple.fr' }, access_token: 'faux' }

export const supabase = {
  auth: {
    getSession: () => Promise.resolve({ data: { session }, error: null }),
    getUser: () => Promise.resolve({ data: { user: session.user }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signOut: () => Promise.resolve({ error: null }),
  },
  // « Vérifier l'empreinte » d'un exercice validé répond « intacte » ; tout autre appel, faux.
  rpc: (nom: string) => Promise.resolve({ data: nom === 'verifier_exercice_valide', error: null }),
  from: (table: string) => requete(table),
  storage: {
    from: () => ({
      getPublicUrl: () => ({ data: { publicUrl: LOGO_DU_BANC ?? '' } }),
      createSignedUrl: () => Promise.resolve({ data: null, error: { message: 'maquette' } }),
      download: () => Promise.resolve({ data: null, error: { message: 'maquette' } }),
      list: () => Promise.resolve({ data: [], error: null }),
      upload: () => Promise.resolve({ data: null, error: { message: 'maquette' } }),
      remove: () => Promise.resolve({ data: null, error: null }),
    }),
  },
  // « Proposer une catégorie » répond une proposition retenue, avec un extrait LONG : c'est lui qui
  // éprouve le passage à la ligne dans le volet. La connexion bancaire répond pour le cabinet infirmier
  // (voir CONNEXION_D1). Tout le reste reste une maquette.
  functions: {
    invoke: (nom: string, options?: { body?: Ligne }) => {
      if (nom === 'proposer-categorie') {
        return Promise.resolve({ data: { issue: 'retenue', categorieId: 'c8', indice: 'Abonnement mensuel LogiSoins Premium — gestion des tournées et télétransmission' }, error: null })
      }
      if (nom === 'banque-connexion') return Promise.resolve(connexionBancaire(options?.body ?? {}))
      return Promise.resolve({ data: null, error: { message: 'maquette' } })
    },
  },
}
