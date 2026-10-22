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
import { calculerCa3, type DonneesTva } from '../../src/lib/declarationTva'
import { lignesPourPiece, piecesAComptabiliser } from '../../src/lib/ecritures'
import { numeroterFec } from '../../src/lib/fec'
import { ecritureDuForfait } from '../../src/lib/forfaitKilometrique'
import { aPayerDe, declarationDeLaCa3, ecritureDeLaLiquidation, ecritureDuPaiementTva } from '../../src/lib/liquidationTva'
import { calculerTotaux } from '../../src/lib/montantsFacture'
import { repartitionProposee, ttcParTaux } from '../../src/lib/encaissementsFactures'
import { partsDuReleve } from '../../src/lib/partsDuReleve'
import { paiementsDesPieces } from '../../src/lib/rattachement'
import { PLAN_PAR_DEFAUT, ROLES_COMPTABLES } from '../../src/lib/planComptable'
import { mouvementsDeCloture, soldesAReporter } from '../../src/lib/reportDesSoldes'
import { mentionTva } from '../../src/lib/statutTva'
import { instantane2035 } from '../../src/lib/validationExercice'
import * as ER from '../../src/test/ereportingEcran'
import { ventesFactureesVides } from '../../src/test/ventesFacturees'
import { ecritureDuVirementPersonnel } from '../../src/lib/virementPersonnel'
import type {
  Categorie, CotisationDeclaree, EcritureBrouillon, EncaissementFacture, EncaissementFactureTaux, FactureEmise, FactureLigne,
  FactureSuperpdpEvent, Immobilisation, NatureImmobilisation, Piece, PieceEcarteeEreporting, PieceHorsDeFrance, PieceHorsDeFranceTaux,
  RegimeEreporting, StatutFactureRecu, TransmissionEncaissement, TransmissionFacture,
  VehiculeDossier, VentilationBancaire,
} from '../../src/lib/types'

type Ligne = Record<string, unknown>

const MAINTENANT = '2026-09-25T08:00:00Z'

// Logo du cabinet : aucun par défaut. Le banc d'installabilité (installable.mjs) en pose un, par une
// clé du stockage local écrite avant le chargement, pour éprouver le manifeste que reçoit un cabinet
// qui a son logo — celui des deux qui n'était pas installable. La valeur est l'adresse du logo.
const LOGO_DU_BANC = typeof localStorage === 'undefined' ? null : localStorage.getItem('banc-logo')

// Le banc se joue aussi EN CLIENT (la coque d'un client, son accueil) : une clé du stockage local, posée avant le chargement
// comme celle du logo, retire le compte de l'équipe du cabinet et rattache le même identifiant au cabinet infirmier par une
// adhésion. Le rôle se lit alors comme en production (AuthContext : `cabinet_admins`, sinon `memberships`) — pas par un
// drapeau que l'application ignorerait.
const CLIENT_DU_BANC = typeof localStorage === 'undefined' ? false : localStorage.getItem('banc-client') === '1'

// « Mes ventes » (espace client, étape P4a) : une seconde clé rattache AUSSI ce compte à l'atelier de conseil (d7), redevable,
// dont les factures portent transmissions, encaissements et déclarations — avec la case « Ventes », et « Banque » quand la
// clé vaut « banque ». Le client a alors deux sociétés : son sélecteur paraît, et la société affichée se choisit par la clé
// d'AuthContext (`jd-precompta-dossier-actif`).
const VENTES_DU_BANC = typeof localStorage === 'undefined' ? null : localStorage.getItem('banc-client-ventes')

// La fenêtre des encaissements d'une facture SOURCE, chez le client (ligne 28.65, étape VF5b) : une troisième clé, posée par
// les seules visites qui la montrent, rattache le compte du banc au dossier basculé (d12) avec « Ventes » et « Banque », et à
// lui seul — sa seule société est alors la société affichée, quelle que soit la clé d'AuthContext que le banc repose à chaque
// chargement. Les autres visites du client ne la voient pas.
const CLIENT_DU_DOSSIER_BASCULE = typeof localStorage === 'undefined' ? false : localStorage.getItem('banc-client-basculee') === '1'

// L'identité LÉGALE des dossiers du banc (étape A5b2, onglet Informations) : quatre colonnes de `dossiers`, que l'onglet lit et écrit
// avec le SIRET et l'adresse. Une société (forme et capital), un entrepreneur individuel (sa dénomination en « EI », aucun
// capital), et la catégorie dont le libellé de l'INSEE est le plus long (141 caractères : le `<select>` à 390 px) ; le dossier
// d6 n'en porte AUCUNE colonne, comme une lecture d'avant la migration — la carte dit alors qu'elle ne les a pas lues. Les autres
// les ont nulles. Rien d'autre ne les lit : ajouté après coup, la table des dossiers ci-dessous les range par identifiant.
const IDENTITE_LEGALE_DU_BANC: Record<string, Record<string, unknown>> = {
  d1: { denomination_imprimee: 'Claire Moreau EI', rcs_ville: null, forme_juridique: '1000', capital: null },
  d8: { denomination_imprimee: 'LUMEN STUDIO', rcs_ville: 'Lyon', forme_juridique: '5710', capital: 150000 },
  d5: { denomination_imprimee: 'SCM Les Oliviers', rcs_ville: 'Aix-en-Provence', forme_juridique: '5570', capital: 9999999999999.99 },
  d6: {},
}
const IDENTITE_LEGALE_VIDE = { denomination_imprimee: null, rcs_ville: null, forme_juridique: null, capital: null }

const dossiers: Ligne[] = [
  ['d1', 'Cabinet infirmier Moreau', '12345678900012', '86.90D', 'Activités des infirmiers et des sages-femmes'],
  ['d2', 'Sophie Lambert', null, null, null],
  // Marc Petit, en franchise en base, a un numéro de TVA intracommunautaire (`numero_tva_attribue`, plus bas) : la carte
  // de l'onglet TVA le CALCULE de son SIREN, et seul celui-ci passe la clé de Luhn — aucun SIREN des autres dossiers ne la
  // passe, et la carte y dirait que le numéro ne se calcule pas.
  ['d3', 'Marc Petit', '12345678200010', '74.20Z', 'Activités photographiques'],
  ['d4', 'Julie Roux', null, null, null],
  ['d5', 'SCM Les Oliviers', null, null, null],
  ['d6', 'Thomas Girard', null, null, null],
  // Le seul dossier assujetti à la TVA du banc : un conseil qui facture et encaisse par virement.
  // C'est lui que montre l'onglet TVA (voir TVA_D7 plus bas) ; le cabinet infirmier, exonéré comme
  // toute infirmière, n'a pas de déclaration à déposer. Son SIRET (08/10/2026) est celui des exemples de la facture
  // électronique (`outils/facturation/exemples`) : l'ancien passait la clé de Luhn sur ses quatorze chiffres, mais pas sur
  // les neuf du SIREN, et l'aperçu d'une facture de ce redevable n'imprimait alors aucun numéro de TVA — il le calcule du SIREN.
  ['d7', 'Atelier Bernard Conseil', '98765432400019', '70.22Z', 'Conseil pour les affaires et autres conseils de gestion'],
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
  // Le statut de TVA fait foi et le booléen en est déduit (ligne 28.5) : la migration a rendu redevable
  // tout dossier assujetti, et laissé les autres à préciser. Le cabinet infirmier a depuis reçu le sien —
  // exonéré, ses soins (art. 261, 4, 1°) —, Marc Petit est en franchise en base, les autres restent à préciser.
  // Marc Petit a un numéro de TVA intracommunautaire (la case de l'onglet TVA) ; le cabinet infirmier n'en a pas.
  assujetti_tva: id === 'd7' || id === 'd8',
  statut_tva: id === 'd7' || id === 'd8' ? 'redevable' : id === 'd1' ? 'exonere' : id === 'd3' ? 'franchise' : null,
  article_exoneration: id === 'd1' ? 'cgi_261_4_1' : null, adresse: null,
  numero_tva_attribue: id === 'd3',
  ...(IDENTITE_LEGALE_DU_BANC[id as string] ?? IDENTITE_LEGALE_VIDE),
  tva_periodicite: 'trimestrielle', tva_sur_debits: false,
  mode_comptable: id === 'd8' ? 'engagement' : 'tresorerie', compte_notes_de_frais: '455000',
}))

// Le code e-mail d'un vrai dossier est son nom en tirets suivi de six caractères de son identifiant (`generate_code_email`) :
// l'adresse de collecte que « Mes pièces » montre au client (ligne 22.93) est donc LONGUE, et le banc doit la mesurer telle.
// Le cabinet infirmier a la sienne, réaliste ; l'atelier, une adresse extrême (un nom de société très long) pour éprouver le
// retour à la ligne d'un mot de plus de 24 caractères. Ajouté après coup : la ligne ci-dessus donne aux autres leur identifiant.
for (const [id, code] of [
  ['d1', 'cabinet-infirmier-moreau-1a2b3c'],
  ['d7', 'societe-civile-de-moyens-des-cabinets-infirmiers-de-la-vallee-9f8e7d'],
]) {
  const dossier = dossiers.find((d) => d.id === id)
  if (dossier) dossier.code_email = code
}

// Le dossier BASCULÉ (d12, voir `FACTURES_D12`) : archivé, hors de la liste des dossiers — seules les visites qui l'ouvrent
// par son adresse le voient. Ajouté après coup : la table ci-dessus ne connaît ni l'archive ni la bascule.
dossiers.push({
  ...(dossiers.find((d) => d.id === 'd7') as Ligne),
  id: 'd12', nom: 'Clara Fontaine Conseil', siret: '44455566600019', code_naf: '70.22Z',
  libelle_naf: 'Conseil pour les affaires et autres conseils de gestion', code_email: 'd12', archive: true,
  ventes_par_les_factures: true, ...IDENTITE_LEGALE_VIDE,
})

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
    superpdp_invoice_id: null, flux_hote: null, flux_id: null, lisible_path: null, created_at: `${date}T10:00:00Z`, updated_at: MAINTENANT,
    identite_numero: null, identite_siren_vendeur: null, identite_date: null, identite_nature: null,
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
  // Une facture reçue de la PLATEFORME DU CLIENT (ligne 28.5, voir CONNEXION_PLATEFORME_D1) : son original est un XML,
  // la plateforme en a rendu une version lisible, et l'import a gardé sa remarque dans la note interne de la pièce — dans
  // `notes_internes` depuis l'espace client P0 (voir NOTES_INTERNES plus bas) : sur la pièce, la fiche ne la lit plus.
  {
    ...piece('p15', '2026-09-29', 'Laboratoire Biosanté Provence', 96, 16, null, 'a_valider'),
    source: 'plateforme', storage_path: 'd1/plateforme/fx-15.xml', nom_fichier: 'FA-2026-0930-BIOSANTE.xml',
    flux_hote: 'flux.plateforme-alpha.example', flux_id: 'fx-15', lisible_path: 'd1/plateforme/fx-15.pdf',
  },
  // LA VENTE QUI REVIENT DEUX FOIS (ligne 28.6) : la facture F2026-0013 (`f13`), partie par Super PDP sous 4242, revenue
  // par la synchronisation Super PDP ET par la plateforme du client, dont l'original dit son numéro, son vendeur et son
  // année. Les deux lignes portent « Comptée deux fois », et la fiche de l'une nomme l'autre.
  {
    ...piece('p16', '2026-09-18', 'Résidence Les Cèdres SAS', 480, 80, null, 'a_valider'),
    type_piece: 'vente', source: 'superpdp', superpdp_invoice_id: 4242, nom_fichier: 'SUPERPDP-4242-F2026-0013.txt',
  },
  {
    ...piece('p17', '2026-09-18', 'Résidence Les Cèdres (plateforme)', 480, 80, null, 'a_valider'),
    type_piece: 'vente', source: 'plateforme', storage_path: 'd1/plateforme/fx-17.xml', nom_fichier: 'F2026-0013-RESIDENCE-LES-CEDRES.xml',
    flux_hote: 'flux.plateforme-alpha.example', flux_id: 'fx-17',
    identite_numero: 'F2026-0013', identite_siren_vendeur: '123456789', identite_date: '2026-09-18', identite_nature: 'facture',
  },
]

// DEUX ACHATS À DES FOURNISSEURS ÉTABLIS HORS DE FRANCE (ligne 28.5, e-reporting, étape e3), fictifs comme le reste : un
// abonnement payé en dollars à un éditeur établi en Irlande, sans TVA, dont la fiche « hors de France » a deux versions
// (`FICHES_HORS_DE_FRANCE`) ; et une prestation d'un studio établi au Portugal, sans fiche encore, dont le texte lu porte
// un numéro de TVA, un numéro de facture et la mention d'autoliquidation — de quoi faire paraître les signaux, puis les
// propositions de la saisie.
pieces.push(
  {
    ...piece('p18', '2026-09-20', 'Nuage Logiciel Ltd', 100, 0, 'c8', 'a_valider'),
    devise: 'USD', montant_devise: 108, taux_change: 0.925926, conversion_source: 'bce',
  },
  piece('p19', '2026-09-24', 'Studio Lumière Lisboa', 250, 0, 'c7', 'a_valider'),
)

function ficheHorsDeFrance(id: string, remplace: string | null, creeLe: string, o: Ligne = {}): Ligne {
  return {
    id, dossier_id: 'd1', piece_id: 'p18', remplace_id: remplace, numero: 'NL-2026-0917', date_facture: '2026-09-20',
    type_document: '380', facture_origine_numero: null, facture_origine_date: null, devise: 'USD', pays: 'IE',
    schema_identifiant: '0223', identifiant: 'IE1234567WA', nature: 'services', autoliquidation: true, date_operation: null,
    periode_debut: null, periode_fin: null, cree_par: 'u1', cree_le: creeLe, retire_le: null, retire_par: null, ...o,
  }
}

const FICHES_HORS_DE_FRANCE: Ligne[] = [
  ficheHorsDeFrance('hdf1', null, '2026-09-21T09:00:00Z', { nature: 'mixte' }),
  ficheHorsDeFrance('hdf2', 'hdf1', '2026-09-22T09:00:00Z', { periode_debut: '2026-09-01', periode_fin: '2026-09-30' }),
]
const TAUX_HORS_DE_FRANCE: Ligne[] = [
  { fiche_id: 'hdf1', dossier_id: 'd1', code_tva: 'AE', taux: 0, base: 108, tva: 0, motif_code: null, motif_texte: null },
  { fiche_id: 'hdf2', dossier_id: 'd1', code_tva: 'AE', taux: 0, base: 108, tva: 0, motif_code: null, motif_texte: null },
]

// Les notes internes du cabinet (espace client, P0) : celle que l'import par la plateforme a laissée sur la facture reçue
// (p15). La fiche d'une pièce la lit dans cette table, que le client ne lit pas.
const NOTES_INTERNES: Ligne[] = [
  {
    id: 'ni15', dossier_id: 'd1', piece_id: 'p15', document_id: null,
    texte: 'Reçue de la plateforme du client — à vérifier :\n- Le SIREN du destinataire n’est pas écrit sur la facture.',
    created_at: '2026-09-29T10:05:00Z', updated_at: '2026-09-29T10:05:00Z',
  },
]

function ligne(id: string, date: string, libelle: string, montant: number, statut: string, pieceId: string | null, categorie: string | null = null): Ligne {
  return {
    id, dossier_id: 'd1', date, libelle, montant, statut, piece_id: pieceId, cotisation_id: null, categorie_id: categorie,
    taux_tva: null, prelevement_personnel: false, source_fichier: 'releve-septembre.csv', libelle_brut: null, created_at: MAINTENANT,
    emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false, reglement_groupe: false, compte_bilan: null, declaration_tva_id: null,
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
function ecritureReleve(id: string, mouvement: string | null, date: string, compte: string, libelle: string, sens: 'debit' | 'credit', montant: number): Ligne {
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
    superpdp_invoice_id: null, flux_hote: null, flux_id: null, lisible_path: null, created_at: `${date}T10:00:00Z`, updated_at: MAINTENANT,
    identite_numero: null, identite_siren_vendeur: null, identite_date: null, identite_nature: null,
  }
}

function paiementTva(id: string, date: string, libelle: string, montant: number, pieceId: string | null): Ligne {
  return {
    id, dossier_id: 'd7', date, libelle, montant, statut: 'rapprochee', piece_id: pieceId, cotisation_id: null, categorie_id: null,
    taux_tva: null, prelevement_personnel: false, source_fichier: 'releve-2026.csv', libelle_brut: null, created_at: MAINTENANT,
    emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false, reglement_groupe: false, compte_bilan: null, declaration_tva_id: null,
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

// LES DÉCLARATIONS DE TVA du dossier assujetti (lib/liquidationTva.ts) : le premier trimestre, déposé à néant — aucune
// pièce n'y tombe —, et le deuxième, liquidé puis payé. Leurs cases, la TVA exacte des comptes et l'écriture de
// liquidation sont celles que l'onglet TVA calcule et que la base écrit à l'enregistrement : tirées ici du même code,
// elles ne peuvent pas montrer un écart qui ne viendrait que du banc. Le prélèvement du Trésor, rapproché de la
// seconde, s'écrit face au 445510 — mais n'en a payé qu'une partie : le complément, prélevé plus tard et encore à
// traiter, en paie exactement le reste, et sa fiche propose la déclaration. Le troisième trimestre reste à
// déclarer : c'est lui que l'onglet propose.
function declarationD7(id: string, debut: string, fin: string, depot: string) {
  const lignes = [...TVA_D7.lignes, ...RELEVE_D7.lignes] as unknown as MouvementBancaire[]
  const donnees: DonneesTva = {
    pieces: TVA_D7.pieces as unknown as Piece[],
    paiements: paiementsDesPieces(lignes, []),
    // L'ordinateur du dossier, immobilisé (`i-d7`) : sa TVA va en ligne 19.
    pieceIdsImmobilisees: new Set(['a2']),
    releve: partsDuReleve(lignes, categories as unknown as Categorie[], RELEVE_D7.ventilations as unknown as VentilationBancaire[], true),
    // Aucune facture du banc n'est SOURCE de sa vente : les ventes facturées que l'onglet TVA lirait sont vides, et la
    // valeur vide le dit (étape VF3b2).
    ventesFacturees: ventesFactureesVides('d7'),
  }
  const ca3 = calculerCa3(donnees, { debut, fin }, false, 0, 0)
  const liquidee = declarationDeLaCa3(ca3, { debut, fin })
  const creeLe = `${depot}T09:00:00Z`
  return {
    declaration: {
      id, dossier_id: 'd7', ...liquidee, tva_declaree: ca3.netPeriode, credit_anterieur: ca3.cases.l22,
      remboursement_demande: ca3.cases.l26, date_declaration: depot, notes: null, created_at: creeLe,
    },
    ecritures: ecritureDeLaLiquidation(liquidee, PLAN_PAR_DEFAUT).map((ligne, i): Ligne => ({
      id: `${id}-${i + 1}`, dossier_id: 'd7', piece_id: null, ligne_bancaire_id: null, declaration_tva_id: id, date: fin,
      ...ligne, statut: 'proposee', created_at: creeLe,
    })),
  }
}

const DECLARATIONS_D7 = [
  declarationD7('dt1', '2026-01-01', '2026-03-31', '2026-04-18'),
  declarationD7('dt2', '2026-04-01', '2026-06-30', '2026-07-17'),
]

const COMPLEMENT_TVA_D7 = 20
const PRELEVEMENT_TVA_D7: Ligne = {
  ...paiementTva('t9', '2026-07-24', 'PRLV SEPA DGFIP TVA 2T2026', COMPLEMENT_TVA_D7 - aPayerDe(DECLARATIONS_D7[1].declaration), null),
  declaration_tva_id: 'dt2',
}

const TVA_LIQUIDEE_D7 = {
  declarations: DECLARATIONS_D7.map((d) => d.declaration),
  lignes: [
    PRELEVEMENT_TVA_D7,
    { ...paiementTva('t10', '2026-08-07', 'PRLV SEPA DGFIP COMPLEMENT TVA', -COMPLEMENT_TVA_D7, null), statut: 'non_rapprochee' },
  ],
  ecritures: [
    ...DECLARATIONS_D7.flatMap((d) => d.ecritures),
    ...ecritureDuPaiementTva(PRELEVEMENT_TVA_D7 as unknown as MouvementBancaire, PLAN_PAR_DEFAUT).map((ligne, i): Ligne => ({
      id: `pt-${i + 1}`, dossier_id: 'd7', piece_id: null, ligne_bancaire_id: 't9', date: PRELEVEMENT_TVA_D7.date,
      ...ligne, statut: 'proposee', created_at: MAINTENANT,
    })),
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
// (la pastille « Ne s'écrit pas » dans Banque) ; l'appel d'octobre, que rien ne paie encore (le geste « Payée depuis le
// compte personnel… ») ; et celui de juillet, payé depuis le compte personnel de l'infirmière et écrit — la cotisation hors
// CSG-CRDS au 646000, face au 108000 (lib/cotisationPersonnelle.ts, ligne 26.6, phase C).
function echeanceCotisation(id: string, echeance: string, appele: number, csg: number | null, paiementPersonnel: string | null = null): Ligne {
  return {
    id, dossier_id: 'd1', echeance, montant_appele: appele, montant_verse: null, montant_csg_crds: csg,
    previsionnel: false, created_at: MAINTENANT, paiement_personnel_le: paiementPersonnel,
  }
}

const COTISATIONS_D1 = {
  echeances: [
    echeanceCotisation('cs1', '2026-08-05', 520, 48.5),
    echeanceCotisation('cs2', '2026-09-05', 310, null),
    echeanceCotisation('cs3', '2026-09-20', 180, null),
    echeanceCotisation('cs4', '2026-10-05', 520, 48.5),
    echeanceCotisation('cs5', '2026-07-05', 520, 48.5, '2026-07-08'),
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
    { ...ecritureReleve('r31', null, '2026-07-08', '646000', 'Cotisation, échéance du 05/07/2026, payée depuis le compte personnel', 'debit', 471.5), cotisation_id: 'cs5' },
    { ...ecritureReleve('r32', null, '2026-07-08', '108000', 'Cotisation, échéance du 05/07/2026, payée depuis le compte personnel', 'credit', 471.5), cotisation_id: 'cs5' },
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

const TRESORERIE = { mode: 'tresorerie', compteNotesDeFrais: '455000', plan: PLAN_PAR_DEFAUT } as const

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
    const lignesDuMouvement = categorie ? ecritureDuMouvement(m, String(categorie.compte_comptable), null, PLAN_PAR_DEFAUT)
      : cotisation ? ecritureDeLaCotisation(m, cotisation, TRESORERIE.mode, PLAN_PAR_DEFAUT)
        : []
    return lignesDuMouvement.map((l) => ecriture({ ...l, date: m.date }, { ligne_bancaire_id: m.id }))
  })
  const virements = lignes.filter((m) => m.prelevement_personnel)
    .flatMap((m) => ecritureDuVirementPersonnel(m, TRESORERIE).map((l) => ecriture({ ...l, date: m.date }, { ligne_bancaire_id: m.id })))
  const dotations = s.immobilisations.flatMap((b) => {
    const bien = b as unknown as Immobilisation
    const compte = String(natures.find((x) => x.id === bien.nature_id)?.compte_immobilisation)
    return s.dotations.flatMap((annee) => ecritureDeLaDotation(bien, compte, annee, null, PLAN_PAR_DEFAUT)
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
// `verifier_exercice_valide`. Et la validation écrit l'ouverture de l'exercice suivant (ligne 34) : ses soldes
// reportés, que le report de l'application tire de la même numérotation, comme la base les tire des écritures figées.
function valider(
  s: SourcesDeValidation, ecritures: Ligne[], annee: number, valideLe: string, empreinte: string,
): { valide: Ligne; reportes: Ligne[] } {
  const dansLExercice = ecritures.filter((e) => String(e.date) <= `${annee}-12-31` && String(e.date) >= `${annee}-01-01`)
  const numerotation = numeroterFec(
    dansLExercice as unknown as EcritureBrouillon[], s.pieces as unknown as Piece[], categories as unknown as Categorie[], [],
    // Le dossier que le banc valide n'a pas basculé : aucune écriture d'une vente facturée (étape VF4c2).
    TRESORERIE.mode, s.lignes as unknown as MouvementBancaire[], [],
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
    // Ni l'un ni l'autre dossier n'est assujetti : aucune déclaration de TVA, donc aucun arrondi de liquidation.
    [],
    PLAN_PAR_DEFAUT,
    // Aucune facture du banc n'est SOURCE de sa vente (`source_de_la_vente: false` partout) : les ventes facturées que la
    // Clôture lirait de ces dossiers sont vides, et la valeur vide le dit (étape VF3b1).
    ventesFactureesVides(s.dossier),
    { etat: 'sans_bascule' },
  )
  const { valeurs } = valeursDesCases(declaration)
  const dossier = dossiers.find((d) => d.id === s.dossier)!
  const entete = { nom: dossier.nom as string | null, activite: dossier.libelle_naf as string | null, siret: dossier.siret as string | null }
  const report = soldesAReporter(mouvementsDeCloture(numerotation), TRESORERIE, annee)
  if (report.horsClasses.length > 0 || report.ecartCentimes !== 0) console.error('[banc] la base refuserait ce report', report)
  return {
    valide: {
      dossier_id: s.dossier, annee, valide_le: valideLe, valide_par: 'u1', mode_comptable: TRESORERIE.mode,
      nb_lignes: dansLExercice.length,
      nb_ecritures: new Set(numerotation.lignes.map((l) => `${l.journal}|${l.numero}`)).size,
      total_debit: centimes('debit'), total_credit: centimes('credit'),
      empreinte_precedente: null, empreinte,
      declaration: instantane2035(declaration, valeurs, arrondirPourFormulaire(valeurs, annee), entete),
    },
    // Leurs libellés du FEC restent nuls tant que l'exercice qu'ils ouvrent n'est pas validé.
    reportes: report.soldes.map((solde, i) => ({
      id: `${s.prefixe}-sr${i + 1}`, dossier_id: s.dossier, date: report.date, compte: solde.compte, libelle: solde.libelle,
      sens: solde.sens, montant: solde.montant, source_nom: report.source, source_empreinte: empreinte, created_at: valideLe,
      compte_lib: null, ecriture_lib: null,
    })),
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
    // Une empreinte relevée à la main (R7C2) : la citation du contrat d'assurance du dossier permanent a CHANGÉ depuis (voir plus bas).
    { ...pieceDe('d9', 'k2', '2025-04-02', 'Assurance Pro Santé', 380, 'c4'), storage_hash: 'b'.repeat(64) },
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
const VALIDATION_D9 = valider(SOURCES_D9, ECRITURES_D9, 2025, '2026-03-02T09:30:00Z', '9f2c4e81b07d36a5c8e1f4290b6d73e5a1c9f08b2e4d6a7c3b5f1e9d0a2c4b68')

// Paul Bertin, ostéopathe : 2025 est complet — sa pièce est payée, son encaissement affecté, ses écritures
// écrites et concordantes — et attend sa validation. Sa carte montre l'ouverture que la validation écrira, et son
// exercice 2026 dit l'attendre.
const SOURCES_D10: SourcesDeValidation = {
  dossier: 'd10',
  prefixe: 'q-e',
  pieces: [pieceDe('d10', 'o1', '2025-03-01', 'Cabinet Partagé Saint-Roch', 450, 'c6')],
  lignes: [
    mouvementDe('d10', 'q1', '2025-03-03', 'PRLV CABINET PARTAGE SAINT ROCH', -450, 'rapprochee', { piece_id: 'o1' }),
    // 168 300 € d'honoraires en 2025 (ligne 48) : au-delà de 152 500 €, sa Clôture montre l'annexe 2035-E DUE — son tableau,
    // ses libellés de trois lignes, ce qu'elle suppose —, que le banc mesure sur les visites de 2025 de ce dossier.
    mouvementDe('d10', 'q2', '2025-05-15', 'VIR PATIENTS MAI', 168300, 'rapprochee', { categorie_id: 'c9' }),
    // 2026 a commencé : ses comptes de bilan partent de zéro tant que 2025 n'est pas validé, et ses écrans le disent.
    mouvementDe('d10', 'q3', '2026-01-20', 'VIR PATIENTS JANVIER', 1800, 'rapprochee', { categorie_id: 'c9' }),
  ],
  cotisations: [],
  immobilisations: [],
  vehicules: [],
  dotations: [],
}
const ECRITURES_D10 = ecrituresDe(SOURCES_D10)

// ── LES FACTURES ÉMISES DU CABINET INFIRMIER (ligne 28.5, étape c4) ────────────────────────────────────────────────
//
// Trois factures, pour mesurer ce que l'onglet Factures ne pouvait pas montrer faute de données :
//   - F2026-0012, validée, à un ORGANISME PUBLIC dont le nom est très long, avec toutes ses mentions (SIREN, code service,
//     numéro d'engagement, période) : la plateforme du client a refusé son dépôt, en un détail LONG, puis l'envoi par
//     Super PDP est parti sans réponse il y a plus d'un quart d'heure — c'est ce qui offre « Abandonner » ;
//   - F2026-0013, validée, à une ENTREPRISE, partie par Super PDP et acceptée : l'historique de ses statuts ;
//   - un brouillon, à un particulier.
// Le dossier est exonéré (art. 261, 4, 1°) : chaque ligne est à 0 %, et l'en-tête se déduit des lignes comme
// `enregistrer_facture` l'écrit. Les lignes sont typées sur celles de l'application (src/lib/types.ts) : une colonne
// ajoutée à `FactureEmise` fait échouer `tsc -b` ici, au lieu de s'afficher vide sur le banc. Les SIREN et SIRET des
// clients sont fictifs, mais portent une clé de Luhn valide : le jugement du générateur de la facture électronique
// ne les refuse pas.
//
// Le faux client n'ordonne rien : les factures sont rangées dans l'ordre que la lecture réelle rend (date d'émission
// décroissante), les transmissions et les événements dans celui de leur date.

// Un instant `minutes` avant MAINTENANT. « Abandonner » se juge sur l'horloge du NAVIGATEUR (lib/transmissionsFactures.ts) :
// une transmission datée d'avant MAINTENANT est abandonnable le jour où le banc tourne, quel qu'il soit.
const avantMaintenant = (minutes: number) => new Date(Date.parse(MAINTENANT) - minutes * 60_000).toISOString()

type LigneSaisie = Pick<FactureLigne, 'designation' | 'quantite' | 'prix_unitaire_ht' | 'taux_tva'>

const LIGNES_F12: LigneSaisie[] = [{
  designation: 'Soins infirmiers à domicile — tournées du matin et du soir auprès des patients du service, du 1er au 31 août 2026 (marché 2026-SSIAD-07)',
  quantite: 40, prix_unitaire_ht: 46, taux_tva: 0,
}]
const LIGNES_F13: LigneSaisie[] = [
  { designation: 'Soins infirmiers auprès des résidents — forfait d’août 2026', quantite: 1, prix_unitaire_ht: 2150, taux_tva: 0 },
  { designation: 'Frais de déplacement de la tournée', quantite: 4, prix_unitaire_ht: 37.5, taux_tva: 0 },
]
const LIGNES_BROUILLON: LigneSaisie[] = [
  { designation: 'Soins infirmiers non pris en charge — séance du 22 septembre 2026', quantite: 1, prix_unitaire_ht: 38, taux_tva: 0 },
]

const PENALITES_DE_RETARD =
  "En cas de retard de paiement, une pénalité égale à trois fois le taux d'intérêt légal sera exigible, " +
  'ainsi qu\'une indemnité forfaitaire pour frais de recouvrement de 40 €.'

const MENTIONS_LEGALES_D1 = [mentionTva('exonere', 'cgi_261_4_1'), PENALITES_DE_RETARD].join('\n')

// L'émetteur est recopié du dossier à chaque enregistrement (jamais relu à l'affichage) : le cabinet infirmier d1.
const EMETTEUR_D1 = {
  emetteur_nom: 'Cabinet infirmier Moreau', emetteur_siret: '12345678900012',
  emetteur_adresse: '12 rue des Mimosas\n13100 Aix-en-Provence',
}

const FACTURES_D1: FactureEmise[] = [
  // Le brouillon : « Supprimer » à la place des boutons d'une facture validée, aucun numéro, un client particulier
  // (non assujetti) sans SIREN ni adresse de facturation électronique, et l'option pour les débits encore nulle.
  {
    id: 'f14', dossier_id: 'd1', numero: null, statut: 'brouillon', type: 'facture', facture_origine_id: null,
    date_emission: '2026-09-24', date_echeance: null,
    tiers_nom: 'Mme Josiane Faure', tiers_adresse: '3 impasse du Lavoir\n13100 Aix-en-Provence', tiers_siret: null,
    ...calculerTotaux(LIGNES_BROUILLON),
    mentions_legales: MENTIONS_LEGALES_D1, notes: 'Séance non remboursée par l’Assurance maladie : règlement à réception.',
    source_de_la_vente: false,
    ...EMETTEUR_D1,
    superpdp_invoice_id: null, superpdp_dernier_statut: null, tiers_email: null,
    created_by: 'u-claire', valide_par: null, created_at: '2026-09-24T16:10:00Z', validated_at: null,
    type_client: 'non_assujetti', tiers_siren: null, tiers_adresse_electronique: null, code_service: null, numero_engagement: null,
    nature_operation: 'services', date_prestation: '2026-09-22', periode_debut: null, periode_fin: null,
    livraison_adresse: null, livraison_code_postal: null, livraison_ville: null, livraison_pays: null, option_debits: null,
  },
  // Une ENTREPRISE, partie par Super PDP (4242) et acceptée par son destinataire (fr:205) : son badge de la liste dit le
  // statut de Super PDP, et la fenêtre de transmission en garde l'historique. La prestation s'est achevée avant la facture.
  {
    id: 'f13', dossier_id: 'd1', numero: 'F2026-0013', statut: 'validee', type: 'facture', facture_origine_id: null,
    date_emission: '2026-09-18', date_echeance: '2026-10-18',
    tiers_nom: 'Résidence Les Cèdres SAS', tiers_adresse: '7 chemin des Cèdres\n13090 Aix-en-Provence', tiers_siret: '77712345600017',
    ...calculerTotaux(LIGNES_F13),
    mentions_legales: MENTIONS_LEGALES_D1, notes: null,
    source_de_la_vente: false,
    ...EMETTEUR_D1,
    superpdp_invoice_id: 4242, superpdp_dernier_statut: 'fr:205', tiers_email: 'comptabilite@residence-cedres.example',
    created_by: 'u1', valide_par: 'u1', created_at: '2026-09-18T08:30:00Z', validated_at: '2026-09-18T08:55:00Z',
    type_client: 'assujetti', tiers_siren: '777123456', tiers_adresse_electronique: '777123456',
    code_service: null, numero_engagement: null,
    nature_operation: 'services', date_prestation: '2026-08-31', periode_debut: null, periode_fin: null,
    livraison_adresse: null, livraison_code_postal: null, livraison_ville: null, livraison_pays: null, option_debits: false,
  },
  // L'ORGANISME PUBLIC au nom très long : toutes les mentions d'un client de Chorus Pro, une période plutôt qu'une date, et
  // l'adresse de facturation électronique qui l'achemine jusqu'à son service.
  {
    id: 'f12', dossier_id: 'd1', numero: 'F2026-0012', statut: 'validee', type: 'facture', facture_origine_id: null,
    date_emission: '2026-09-05', date_echeance: '2026-10-05',
    tiers_nom: 'CENTRE HOSPITALIER INTERCOMMUNAL DES DEUX VALLÉES — SERVICE DE SOINS INFIRMIERS À DOMICILE',
    tiers_adresse: '18 avenue des Deux Vallées\nBP 40120\n73000 Chambéry', tiers_siret: '25010002100014',
    ...calculerTotaux(LIGNES_F12),
    mentions_legales: MENTIONS_LEGALES_D1, notes: null,
    source_de_la_vente: false,
    ...EMETTEUR_D1,
    superpdp_invoice_id: null, superpdp_dernier_statut: null, tiers_email: 'achats@ch-deux-vallees.example',
    created_by: 'u1', valide_par: 'u1', created_at: '2026-09-05T08:40:00Z', validated_at: '2026-09-05T08:52:00Z',
    type_client: 'organisme_public', tiers_siren: '250100021',
    tiers_adresse_electronique: '250100021_25010002100014_SSIAD-DEUX-VALLEES',
    code_service: 'SSIAD-DV-0042', numero_engagement: 'EJ2026-004517',
    nature_operation: 'services', date_prestation: null, periode_debut: '2026-08-01', periode_fin: '2026-08-31',
    livraison_adresse: null, livraison_code_postal: null, livraison_ville: null, livraison_pays: null, option_debits: false,
  },
]

const lignesDeFacture = (factureId: string, lignes: LigneSaisie[]): FactureLigne[] =>
  lignes.map((l, i) => ({ id: `${factureId}-l${i + 1}`, facture_id: factureId, ordre: i + 1, ...l }))

const LIGNES_DES_FACTURES_D1: FactureLigne[] = [
  ...lignesDeFacture('f14', LIGNES_BROUILLON),
  ...lignesDeFacture('f13', LIGNES_F13),
  ...lignesDeFacture('f12', LIGNES_F12),
]

// Ce que la plateforme du client a répondu au dépôt de F2026-0012 : le détail que la fonction a nettoyé (300 caractères au
// plus) et que la fenêtre de transmission montre dans sa cellule « Détail », adresse sans espace comprise.
const DETAIL_DU_REFUS_DE_DEPOT =
  'Dépôt refusé par la plateforme (code 422) : l’adresse de facturation 250100021_25010002100014_SSIAD-DEUX-VALLEES est ' +
  'inconnue de l’annuaire, et la période du 01/08/2026 au 31/08/2026 recoupe celle d’une facture déjà déposée pour ce ' +
  'service. Corriger l’adresse, puis renouveler le dépôt.'

// Une seule transmission est ACTIVE par facture (envoi, déposée, acceptée) : F2026-0012 en a une — l'envoi par Super PDP
// sans issue connue, que le cabinet peut abandonner — derrière un dépôt refusé qui, lui, ne bloque rien. L'hôte du dépôt
// refusé est celui de la plateforme que le cabinet infirmier a reliée (`CONNEXION_PLATEFORME_D1`, déclarée plus bas).
const TRANSMISSIONS_D1: TransmissionFacture[] = [
  {
    id: 'tr1', dossier_id: 'd1', facture_id: 'f13', canal: 'superpdp', hote: 'api.superpdp.tech', flux_id: '4242',
    sha256: 'c'.repeat(64), etat: 'accepte', detail: null, cree_le: '2026-09-18T09:00:30Z', maj_le: '2026-09-18T09:20:00Z',
  },
  {
    id: 'tr2', dossier_id: 'd1', facture_id: 'f12', canal: 'plateforme', hote: 'flux.plateforme-alpha.example', flux_id: null,
    sha256: 'a'.repeat(64), etat: 'echec', detail: DETAIL_DU_REFUS_DE_DEPOT,
    cree_le: '2026-09-24T14:10:00Z', maj_le: '2026-09-24T14:10:05Z',
  },
  {
    id: 'tr3', dossier_id: 'd1', facture_id: 'f12', canal: 'superpdp', hote: 'api.superpdp.tech', flux_id: null,
    sha256: 'b'.repeat(64), etat: 'envoi', detail: null, cree_le: avantMaintenant(90), maj_le: avantMaintenant(90),
  },
]

// L'historique de F2026-0013 chez Super PDP, du plus ancien au plus récent : la fenêtre le range à l'envers.
const EVENEMENTS_SUPERPDP_D1: FactureSuperpdpEvent[] = [
  { id: 'sv1', facture_id: 'f13', superpdp_event_id: 91001, status_code: 'fr:200', status_text: 'Facture déposée sur la plateforme', occurred_at: '2026-09-18T09:01:00Z' },
  { id: 'sv2', facture_id: 'f13', superpdp_event_id: 91002, status_code: 'fr:202', status_text: 'Facture reçue par la plateforme du destinataire', occurred_at: '2026-09-18T09:04:00Z' },
  { id: 'sv3', facture_id: 'f13', superpdp_event_id: 91003, status_code: 'fr:205', status_text: 'Facture acceptée par le destinataire', occurred_at: '2026-09-18T09:20:00Z' },
]

// ── LA FACTURE ÉMISE DU DOSSIER REDEVABLE (d7), JAMAIS TRANSMISE ───────────────────────────────────────────────────
//
// Le cabinet infirmier est exonéré : ses lignes sont à 0 %, son aperçu n'imprime aucun numéro de TVA, et toutes ses
// factures validées ont déjà une transmission ou un refus. L'atelier de conseil en donne le contraire, que le banc ne
// mesurait pas : une facture VALIDÉE adressée à une entreprise, que rien n'a transmise, à deux taux — 20 % pour la mission,
// 5,5 % pour les livrets remis aux participants : une opération mixte, dont l'aperçu écrit « 5,5 % » avec sa virgule. Son aperçu
// imprime le numéro de TVA intracommunautaire de l'émetteur (calculé du SIREN de son SIRET figé, d'où le SIRET du dossier plus
// haut), et sa fenêtre de transmission offre ce que celle de F2026-0012 n'offre pas — « Envoyer par Super PDP » et « Déposer
// sur… », les deux boutons les plus larges de la rangée du bas, que les fonctions `invoke` plus bas rendent disponibles pour d7.
// Les SIREN et SIRET du client sont fictifs, mais portent une clé de Luhn valide.
const LIGNES_F7: LigneSaisie[] = [
  {
    designation: 'Mission de conseil — accompagnement à la mise en place de la facturation électronique, du 14 au 18 septembre 2026',
    quantite: 3, prix_unitaire_ht: 650, taux_tva: 20,
  },
  // Un livre imprimé : le taux réduit de 5,5 %. Les totaux de la facture se déduisent des lignes (`calculerTotaux`) :
  // 2 048,00 € HT et 395,39 € de TVA (390,00 € à 20 %, 5,39 € à 5,5 %), soit 2 443,39 € TTC.
  { designation: 'Livret de synthèse remis aux participants — quatre exemplaires imprimés', quantite: 4, prix_unitaire_ht: 24.5, taux_tva: 5.5 },
]

const FACTURES_D7: FactureEmise[] = [{
  id: 'f7', dossier_id: 'd7', numero: 'F2026-0007', statut: 'validee', type: 'facture', facture_origine_id: null,
  date_emission: '2026-09-22', date_echeance: '2026-10-22',
  tiers_nom: 'Menuiserie Roche & Fils SARL', tiers_adresse: '27 zone artisanale des Bruyères\n69130 Écully', tiers_siret: '55512345400012',
  source_de_la_vente: false,
  ...calculerTotaux(LIGNES_F7),
  mentions_legales: PENALITES_DE_RETARD, notes: null,
  emetteur_nom: 'Atelier Bernard Conseil', emetteur_siret: '98765432400019', emetteur_adresse: '4 rue des Tanneurs\n69002 Lyon',
  superpdp_invoice_id: null, superpdp_dernier_statut: null, tiers_email: null,
  // Validée par le titulaire de l'atelier (un accès client de d7, plus bas) : l'onglet Factures du cabinet dit « par le client ».
  created_by: 'u-bernard', valide_par: 'u-bernard', created_at: '2026-09-22T09:20:00Z', validated_at: '2026-09-22T09:41:00Z',
  type_client: 'assujetti', tiers_siren: '555123454', tiers_adresse_electronique: '555123454',
  code_service: null, numero_engagement: null,
  nature_operation: 'mixte', date_prestation: '2026-09-18', periode_debut: null, periode_fin: null,
  livraison_adresse: null, livraison_code_postal: null, livraison_ville: null, livraison_pays: null, option_debits: false,
}]

const LIGNES_DES_FACTURES_D7: FactureLigne[] = lignesDeFacture('f7', LIGNES_F7)

// LES ENCAISSEMENTS DE CETTE FACTURE (ligne 28.5, étape d3) : un virement de 1 000,00 € — la facture est « Encaissée en
// partie » —, et un chèque de 500,00 € RETIRÉ, que la fenêtre montre marqué, sans bouton. Aucun ne cite de mouvement :
// le relevé de l'atelier sert d'autres visites, qui ne doivent pas changer. La répartition est celle que l'écran
// proposerait, au prorata des TTC de chaque taux, calculée par le module plutôt que recopiée. Sa fenêtre dit aussi
// l'obligation REFUSÉE d'une facture mixte, et propose de saisir les 1 443,39 € qui restent.
const repartitionDuBanc = (encaissementId: string, centimes: number): EncaissementFactureTaux[] =>
  (repartitionProposee(centimes, ttcParTaux(FACTURES_D7[0], LIGNES_DES_FACTURES_D7)
    .map((t) => ({ taux: t.taux, resteCentimes: t.ttcCentimes }))) ?? [])
    .map((p) => ({ encaissement_id: encaissementId, dossier_id: 'd7', taux: p.taux, montant: p.centimes / 100 }))

const encaissementDuBanc = (o: Partial<EncaissementFacture> & Pick<EncaissementFacture, 'id'>): EncaissementFacture => ({
  dossier_id: 'd7', facture_id: 'f7', date_encaissement: '2026-10-01', montant: 1000, moyen: 'virement', ligne_bancaire_id: null,
  annule_id: null, motif: null, cree_par: 'u1', cree_le: '2026-10-01T09:00:00Z', retire_le: null, retire_par: null,
  compte_contrepartie: null, ...o,
})

const ENCAISSEMENTS_D7: EncaissementFacture[] = [
  encaissementDuBanc({ id: 'enc1', date_encaissement: '2026-09-30', montant: 500, moyen: 'cheque', cree_le: '2026-09-30T15:00:00Z',
    retire_le: '2026-10-02T08:00:00Z', retire_par: 'u1' }),
  encaissementDuBanc({ id: 'enc2' }),
]
const PARTS_D7: EncaissementFactureTaux[] = [...repartitionDuBanc('enc1', 50000), ...repartitionDuBanc('enc2', 100000)]

// ── LA DÉCLARATION DES ENCAISSEMENTS (ligne 28.5, étape d4) ──────────────────────────────────────────────────────────
//
// F2026-0007 ne peut rien déclarer — une facture mixte, dont l'obligation est refusée, que rien n'a transmise —, et la base
// refuserait une déclaration qui la viserait. D'où une seconde facture de l'atelier, F2026-0008 : une formation (des
// services, à 20 %), ACCEPTÉE par la plateforme du client (celle que l'atelier a reliée, `CONNEXION_PLATEFORME_D7`), émise
// en 2026 — l'obligation y est facultative, et « Déclaré sur la plateforme » s'offre. Ses encaissements disent les trois
// états de la colonne « Déclaration » : un virement de 600,00 € déclaré à la main avec une note LONGUE (elle éprouve le
// passage à la ligne), puis contre-passé — le virement rendu au client — par une contre-passation PAS ENCORE déclarée ; un
// virement de 900,00 € déclaré, qui offre « Contre-passer » ; un chèque de 300,00 €, à déclarer.
const LIGNES_F8: LigneSaisie[] = [
  {
    designation: 'Formation des équipes comptables à la facture électronique — deux sessions d’une journée, octobre 2026',
    quantite: 2, prix_unitaire_ht: 750, taux_tva: 20,
  },
]

const FACTURE_F8: FactureEmise = {
  ...FACTURES_D7[0],
  id: 'f8', numero: 'F2026-0008', date_emission: '2026-09-24', date_echeance: '2026-10-24',
  ...calculerTotaux(LIGNES_F8),
  created_at: '2026-09-24T09:00:00Z', validated_at: '2026-09-24T09:10:00Z',
  nature_operation: 'services', date_prestation: '2026-09-23',
}
const LIGNES_DE_F8: FactureLigne[] = lignesDeFacture('f8', LIGNES_F8)

const TRANSMISSIONS_D7: TransmissionFacture[] = [{
  id: 'tr8', dossier_id: 'd7', facture_id: 'f8', canal: 'plateforme', hote: 'flux.plateforme-beta.example', flux_id: 'fx-beta-208',
  sha256: 'd'.repeat(64), etat: 'accepte', detail: null, cree_par: 'u-bernard', cree_le: '2026-09-24T09:15:00Z', maj_le: '2026-09-24T09:40:00Z',
}]

const ENCAISSEMENTS_F8: EncaissementFacture[] = [
  encaissementDuBanc({ id: 'enc3', facture_id: 'f8', date_encaissement: '2026-09-28', montant: 600, cree_par: 'u-bernard', cree_le: '2026-09-28T16:00:00Z' }),
  encaissementDuBanc({
    id: 'enc4', facture_id: 'f8', date_encaissement: '2026-10-02', montant: -600, annule_id: 'enc3',
    motif: 'Virement rendu au client : la même somme avait été réglée deux fois, par virement et par chèque.',
    cree_par: 'u-bernard', cree_le: '2026-10-02T11:00:00Z',
  }),
  encaissementDuBanc({ id: 'enc5', facture_id: 'f8', date_encaissement: '2026-10-01', montant: 900 }),
  encaissementDuBanc({ id: 'enc6', facture_id: 'f8', date_encaissement: '2026-10-06', montant: 300, moyen: 'cheque', cree_le: '2026-10-06T10:00:00Z' }),
]
const PARTS_F8: EncaissementFactureTaux[] = ENCAISSEMENTS_F8.map((e) => ({
  encaissement_id: e.id, dossier_id: 'd7', taux: 20, montant: e.montant,
}))

const declarationDuBanc = (o: Partial<TransmissionEncaissement> & Pick<TransmissionEncaissement, 'id' | 'encaissement_id'>): TransmissionEncaissement => ({
  dossier_id: 'd7', facture_id: 'f8', canal: 'manuel', hote: 'flux.plateforme-beta.example', flux_id: null, sha256: null,
  etat: 'depose', detail: null, note: null, cree_par: 'u1', cree_le: '2026-09-29T10:12:00Z', maj_le: '2026-09-29T10:12:00Z', ...o,
})
const DECLARATIONS_ENCAISSEMENTS_D7: TransmissionEncaissement[] = [
  declarationDuBanc({
    id: 'te3', encaissement_id: 'enc3', cree_par: 'u-bernard',
    note: 'Saisi sur flux.plateforme-beta.example par Mme Bernard le 29/09/2026 à 10 h 12, référence de la plateforme STAT-212-0004417',
  }),
  declarationDuBanc({ id: 'te5', encaissement_id: 'enc5', note: 'Saisi par le client lui-même', cree_le: '2026-10-02T08:30:00Z', maj_le: '2026-10-02T08:30:00Z' }),
]

// ── LE CYCLE DE VIE DES FACTURES ÉMISES, LU SUR LA PLATEFORME DE L'ATELIER (ligne 28.5, étape d7) ─────────────────
//
// Une troisième facture de l'atelier, F2026-0009 : une formation que le CLIENT a déposée lui-même sur sa plateforme — aucune
// transmission ici —, prise en charge puis REFUSÉE par l'acheteur (210), motif et commentaire longs. L'onglet la montre
// « Cycle de vie · Refusée » et propose l'« Avoir interne » ; sa fenêtre de transmission dit qu'elle ne part pas ; celle de
// ses encaissements montre ses statuts, le refus en tête, et refuse l'enregistrement. F2026-0008, acceptée, a reçu trois
// statuts qui n'annulent rien — reçue par la plateforme, approuvée, paiement transmis avec ses montants tels qu'écrits — :
// sa déclaration dit « Statuts lus sur … le … : aucun refus de l'acheteur ». Tous FICTIFS.
const LIGNES_F9: LigneSaisie[] = [
  { designation: 'Atelier de prise en main de la plateforme agréée — une demi-journée', quantite: 1, prix_unitaire_ht: 480, taux_tva: 20 },
]
const FACTURE_F9: FactureEmise = {
  ...FACTURE_F8,
  id: 'f9', numero: 'F2026-0009', date_emission: '2026-09-29', date_echeance: '2026-10-29',
  ...calculerTotaux(LIGNES_F9),
  created_at: '2026-09-29T09:00:00Z', validated_at: '2026-09-29T09:05:00Z', date_prestation: '2026-09-26',
}
const LIGNES_DE_F9: FactureLigne[] = lignesDeFacture('f9', LIGNES_F9)

const statutDuBanc = (o: Partial<StatutFactureRecu> & Pick<StatutFactureRecu, 'id' | 'facture_id' | 'code'>): StatutFactureRecu => ({
  dossier_id: 'd7', hote: 'flux.plateforme-beta.example', flux_id: `lc-${o.id}`, message_id: `MSG-${o.id}`, emis_le: null,
  createur_role: 'BY', date_statut: null, motifs: null, commentaire: null, montants: [], lu_par: 'u1',
  lu_le: '2026-10-08T07:44:00.000Z', ...o,
})
const STATUTS_D7: StatutFactureRecu[] = [
  statutDuBanc({ id: 's81', facture_id: 'f8', code: '202', createur_role: 'WK', emis_le: '20260924093000', date_statut: '2026-09-24' }),
  statutDuBanc({ id: 's82', facture_id: 'f8', code: '205', emis_le: '20260925101500', date_statut: '2026-09-25' }),
  statutDuBanc({
    id: 's83', facture_id: 'f8', code: '211', emis_le: '20260928160000', date_statut: '2026-09-28',
    montants: [{ code: 'MPA', montant: '900.00', devise: 'EUR', taux: '20.00', date: '2026-09-28' }],
  }),
  statutDuBanc({ id: 's91', facture_id: 'f9', code: '204', createur_role: 'WK', emis_le: '20260929120000', date_statut: '2026-09-29' }),
  statutDuBanc({
    id: 's92', facture_id: 'f9', code: '210', emis_le: '20261002083000', date_statut: '2026-10-02',
    motifs: 'REF_PRESTATION : prestation non conforme à la commande ; REF_QUANTITE : nombre de participants contesté',
    commentaire: 'La demi-journée prévue au bon de commande BC-2026-0412 portait sur huit participants, la facture en compte douze.',
  }),
]

// Ce qu'un relevé rend au banc (« Lire les statuts de la plateforme », et « Relire les statuts depuis le début » du cabinet
// infirmier) : un refus gardé, avec une donnée écartée, un statut qui n'annule rien, des déjà lus, un statut d'une autre
// entreprise, le rejet d'un statut par la plateforme de l'administration (601) avec ce qu'il porte, un échec passager, un
// statut en attente et deux messages qui ne sont pas des statuts de facture. Allé au bout, il avance la connexion comme la
// fonction l'écrit en base : la relecture qui suit dit le même instant que le bilan.
function releveDuBanc(corps: Ligne) {
  const connexion = corps.dossierId === 'd1' ? CONNEXION_PLATEFORME_D1 : CONNEXION_PLATEFORME_D7
  const d7 = corps.dossierId === 'd7'
  const depuis = corps.depuisLeDebut === true ? null : connexion.cycle_vie_depuis
  connexion.cycle_vie_depuis = '2026-10-09T06:00:00.000Z'
  connexion.cycle_vie_lu_le = '2026-10-09T07:00:00.000Z'
  return {
    hote: connexion.hote, version: connexion.version, depuis,
    issues: [
      ...(d7
        ? [
          { flux: 'lc-s92', issue: 'garde', facture_id: 'f9', code: '210', avertissements: ['L’horodatage du statut n’est pas une date AAAAMMJJHHMMSS lisible : il est écarté.'] },
          { flux: 'lc-s83', issue: 'garde', facture_id: 'f8', code: '211', avertissements: [] },
        ]
        : []),
      { flux: 'lc-s81', issue: 'deja_lu' },
      { flux: 'lc-s82', issue: 'deja_lu' },
      {
        flux: 'lc-autre', issue: 'ecarte', ecart: 'autre_vendeur', code: '210', detail: null,
        raison: 'Le statut désigne une facture d’une autre entreprise que le dossier : il n’est pas gardé.',
      },
      {
        flux: 'lc-601', issue: 'ecarte', ecart: 'autre_objet', code: '601',
        raison: 'Le message porte sur un autre statut (un statut rejeté), pas sur une facture : il n’est pas gardé.',
        detail: {
          reference: 'MSG-2026-0930-STATUT-ENCAISSEE-0004417', date_objet: '2026-09-30',
          motifs: 'REJ_SEMAN : montant encaissé supérieur au montant de la facture', commentaire: null,
        },
      },
      {
        flux: 'lc-echec', issue: 'echec', statut_http: 504,
        raison: 'La plateforme n’a pas répondu à temps (téléchargement d’un statut). Réessayez dans un instant.',
      },
    ],
    ecartes: { autre_flux: 2, illisible: 0, format: 0, statut_inconnu: 0, doublons: 0 },
    en_attente: 1, en_erreur: 0, reportes: 0, complete: true, motif: null,
    cycle_vie_depuis: '2026-10-09T06:00:00.000Z', cycle_vie_lu_le: '2026-10-09T07:00:00.000Z', erreur_reprise: null,
  }
}

// LA RÉVISION DES SOLDES de la kinésithérapeute (ligne 41, étape R3) : trois décisions sur son exercice 2025, validé —
// le solde de la banque accepté sur motif avant la validation, l'ordinateur justifié par sa facture de façon permanente,
// et une anomalie signalée APRÈS la validation sur le compte de l'exploitant, pour un solde qui n'est plus le sien : la
// révision la dit « à revoir ». Les soldes sont ceux de ses écritures, comptés comme la base les compte.
const REVISION_D9 = {
  decisions: [
    {
      id: 'rj-d9-1', dossier_id: 'd9', annee: 2025, compte: '512000', solde: 6046, etat: 'accepte',
      motif: 'Relevé de décembre 2025 remis par la cliente : solde concordant.', portee: 'exercice', preuve_application: null,
      remplace_id: null, reprise_de: null, auteur: 'u1', cree_le: '2026-02-20T10:00:00+00:00',
    },
    {
      id: 'rj-d9-2', dossier_id: 'd9', annee: 2025, compte: '218300', solde: 1500, etat: 'justifie',
      motif: null, portee: 'permanente', preuve_application: null, remplace_id: null, reprise_de: null, auteur: 'u2',
      cree_le: '2026-02-21T10:00:00+00:00',
    },
    {
      id: 'rj-d9-3', dossier_id: 'd9', annee: 2025, compte: '108000', solde: -1200, etat: 'anomalie',
      motif: 'Un prélèvement personnel de décembre manque au relevé transmis : à demander à la cliente.', portee: 'exercice',
      preuve_application: null, remplace_id: null, reprise_de: null, auteur: 'u1', cree_le: '2026-04-02T10:00:00+00:00',
    },
  ] as Ligne[],
  preuves: [
    {
      id: 'rp-d9-1', dossier_id: 'd9', justification_id: 'rj-d9-2', piece_id: 'k3', document_id: null, fichier_id: null,
      empreinte: null, precision: 'Facture d’achat du 1er octobre 2025, ligne unique',
    },
  ] as Ligne[],
}

// LES CYCLES DE LA RÉVISION de la kinésithérapeute (ligne 41, étape R4, phase C), sur son exercice 2025 : la trésorerie
// conclue « révisé » et approuvée par le chef — son programme presque entier fait, une note par travail —, le registre
// conclu puis renvoyé à reprendre avec son observation, l'exploitant conclu en anomalie, les recettes au journal sans
// conclusion, et la synthèse rédigée, qui reste « en cours » tant que les autres cycles ne sont pas réglés. Ce que 2024
// a laissé à suivre en trésorerie s'affiche en tête de 2025. Des textes FICTIFS, sans nom de tiers ni donnée de patient.
const TRAVAUX_TRESORERIE_D9 = [
  { code: 'tresorerie-releves', travail: 'Obtenir le relevé au 31 décembre de chaque compte bancaire du dossier.', fait: true, note: 'Relevé de décembre 2025 remis par la cliente.' },
  { code: 'tresorerie-rapprochement', travail: 'Rapprocher le solde de chaque compte de banque du relevé au 31 décembre, et expliquer l’écart.', fait: true, note: 'Aucun écart.' },
  { code: 'tresorerie-mouvements', travail: 'Examiner les mouvements ignorés et ceux qui ne sont pas rapprochés.', fait: true },
  { code: 'tresorerie-virements-internes', travail: 'Vérifier que le compte de virements internes est soldé au 31 décembre.', fait: true },
  { code: 'tresorerie-especes', travail: 'Demander s’il existe des encaissements ou des paiements en espèces.', fait: false, note: 'Question posée, réponse attendue.' },
]
const CYCLES_D9 = {
  conclusions: [
    {
      id: 'rc-d9-2024', dossier_id: 'd9', annee: 2024, cycle: 'tresorerie', etat: 'revise', travaux: [],
      conclusion: 'Le solde bancaire concorde avec le relevé de fin d’année.',
      a_suivre: 'Obtenir l’attestation de solde du compte d’épargne professionnel, ouvert en novembre 2024.',
      remplace_id: null, auteur: 'u1', cree_le: '2025-03-10T10:00:00+00:00',
    },
    {
      id: 'rc-d9-1', dossier_id: 'd9', annee: 2025, cycle: 'tresorerie', etat: 'revise', travaux: TRAVAUX_TRESORERIE_D9,
      conclusion: 'Le solde de la banque est accepté sur le relevé de décembre ; aucun mouvement non rapproché ne reste.',
      a_suivre: null, remplace_id: null, auteur: 'u2', cree_le: '2026-04-10T10:00:00+00:00',
    },
    {
      id: 'rc-d9-2', dossier_id: 'd9', annee: 2025, cycle: 'immobilisations', etat: 'revise', travaux: [],
      conclusion: 'Le registre concorde avec les comptes 2183 et 28183 ; la facture de l’ordinateur est au dossier.',
      a_suivre: null, remplace_id: null, auteur: 'u2', cree_le: '2026-04-11T10:00:00+00:00',
    },
    {
      id: 'rc-d9-3', dossier_id: 'd9', annee: 2025, cycle: 'capitaux', etat: 'anomalie', travaux: [],
      conclusion: 'Un prélèvement personnel de décembre manque au relevé transmis : le compte de l’exploitant ne se justifie pas encore.',
      a_suivre: 'Rapprocher les prélèvements de 2026 mois par mois.', remplace_id: null, auteur: 'u1', cree_le: '2026-04-12T10:00:00+00:00',
    },
    {
      id: 'rc-d9-4', dossier_id: 'd9', annee: 2025, cycle: 'ensemble', etat: 'revise', travaux: [],
      conclusion: 'Note de synthèse : les recettes concordent avec le relevé annuel de l’assurance maladie ; une anomalie reste '
        + 'ouverte sur le compte de l’exploitant ; les autres cycles sont révisés ou en cours de revue.',
      a_suivre: null, remplace_id: null, auteur: 'u1', cree_le: '2026-04-13T10:00:00+00:00',
    },
  ] as Ligne[],
  journal: [
    {
      id: 'rn-d9-1', dossier_id: 'd9', annee: 2025, cycle: 'recettes', nature: 'echange_direction',
      texte: 'La cliente confirme qu’aucune recette n’a été encaissée en espèces en 2025.', auteur: 'u1', cree_le: '2026-04-05T10:00:00+00:00',
    },
    {
      id: 'rn-d9-2', dossier_id: 'd9', annee: 2025, cycle: 'recettes', nature: 'consultation',
      texte: 'Consultation interne sur le rattachement des chèques reçus fin décembre et crédités en janvier.', auteur: 'u2',
      cree_le: '2026-04-06T10:00:00+00:00',
    },
    {
      id: 'rn-d9-3', dossier_id: 'd9', annee: 2025, cycle: 'tresorerie', nature: 'travail',
      texte: 'Relevé de décembre rapproché ligne à ligne.', auteur: 'u2', cree_le: '2026-04-09T10:00:00+00:00',
    },
  ] as Ligne[],
  revues: [
    {
      id: 'rv-d9-1', dossier_id: 'd9', annee: 2025, conclusion_id: 'rc-d9-1', avis: 'approuve', observation: null, revu_par: 'u1',
      revu_le: '2026-04-20T10:00:00+00:00',
    },
    {
      id: 'rv-d9-2', dossier_id: 'd9', annee: 2025, conclusion_id: 'rc-d9-2', avis: 'a_reprendre',
      observation: 'Joindre le tableau des amortissements de l’exercice et dire la durée retenue pour l’ordinateur.', revu_par: 'u1',
      revu_le: '2026-04-20T11:00:00+00:00',
    },
  ] as Ligne[],
}

// LA REVUE ANALYTIQUE DE LA KINÉSITHÉRAPEUTE (ligne 41, étape R5, phase C) : 2025 est validé, son précédent, 2024, ne l'est pas — il
// se compare à ses repères annuels (onglet Estimation). Un seuil de 500 € après un premier de 300 €, une explication sur le total
// des recettes qui commente les montants du jour, et une sur le résultat qui commente d'autres chiffres — « à revoir ».
const DECLARATION_D9 = VALIDATION_D9.valide.declaration as { totalRecettes: number; resultat: number }
const REVUE_D9 = {
  seuils: [
    {
      id: 'rs-d9-1', dossier_id: 'd9', annee: 2025, seuil: 300, motif: 'Premier jet, avant d’avoir vu le relevé annuel.',
      remplace_id: null, auteur: 'u2', cree_le: '2026-04-02T10:00:00+00:00',
    },
    {
      id: 'rs-d9-2', dossier_id: 'd9', annee: 2025, seuil: 500,
      motif: 'Un trentième du chiffre d’affaires de l’exercice précédent, arrondi : en dessous, une variation ne change pas la lecture des comptes par la cliente.',
      remplace_id: 'rs-d9-1', auteur: 'u1', cree_le: '2026-04-03T10:00:00+00:00',
    },
  ] as Ligne[],
  explications: [
    {
      id: 're-d9-1', dossier_id: 'd9', annee: 2025, objet_type: 'total_2035', objet: 'recettes', nature: null,
      montant: DECLARATION_D9.totalRecettes, montant_precedent: 14800, source_precedent: 'reference',
      explication: 'Deux mois de congé maternité en 2025 : la cliente a été remplacée, et les remboursements de l’assurance maladie suivent.',
      remplace_id: null, auteur: 'u1', cree_le: '2026-04-04T10:00:00+00:00',
    },
    {
      id: 're-d9-2', dossier_id: 'd9', annee: 2025, objet_type: 'total_2035', objet: 'resultat', nature: null,
      montant: DECLARATION_D9.resultat + 100, montant_precedent: 6100, source_precedent: 'reference',
      explication: 'La baisse suit celle des recettes ; les charges fixes n’ont pas bougé.',
      remplace_id: null, auteur: 'u2', cree_le: '2026-04-04T11:00:00+00:00',
    },
  ] as Ligne[],
  reperes: [
    { id: 'ra-d9-2024', dossier_id: 'd9', annee: 2024, chiffre_affaires: 14800, resultat_net: 6100, total_cotisations_sociales: 2100, source: 'saisie_manuelle', created_at: '2025-04-01T10:00:00Z' },
  ] as Ligne[],
  postes: [
    { id: 'rp-d9-1', dossier_id: 'd9', annee: 2024, poste: 'Loyers et charges locatives', montant: 8400, created_at: '2025-04-01T10:00:00Z' },
    { id: 'rp-d9-2', dossier_id: 'd9', annee: 2024, poste: "Primes d'assurance", montant: 360, created_at: '2025-04-01T10:00:00Z' },
  ] as Ligne[],
}

// « MA BANQUE » (espace client, étape P9) : seulement pour le client du banc qui porte « Banque » sur l'atelier (d7), pour
// ne rien changer à ce que mesurent les passes du cabinet. Trois mouvements à traiter de plus — un abonnement au libellé
// LONG, sans justificatif ; un repas, pour lequel le client a déjà envoyé une pièce ; le loyer, sur lequel le cabinet a posé
// une question —, le fil de cette question, et le contrôle de solde du relevé d'août, cohérent : le solde « au relevé ».
const BANQUE_DU_CLIENT_D7 = CLIENT_DU_BANC && VENTES_DU_BANC === 'banque'
  ? {
    lignes: [
      { ...paiementTva('t20', '2026-09-26', 'PRLV SEPA ABONNEMENT LOGICIEL DE GESTION COMMERCIALE ET COMPTABLE', -59.9, null), statut: 'non_rapprochee' },
      { ...paiementTva('t21', '2026-09-22', 'CB RESTAURANT LE COMPTOIR DES HALLES', -42.5, null), statut: 'non_rapprochee' },
      { ...paiementTva('t22', '2026-09-05', 'VIR SEPA EMIS LOYER BUREAU SEPTEMBRE', -1080, null), statut: 'non_rapprochee' },
    ],
    propositions: [
      { id: 'jb1', dossier_id: 'd7', ligne_bancaire_id: 't21', piece_id: 'a3', auteur_id: 'u1', origine: 'client', created_at: '2026-09-23T08:00:00Z', retire_le: null, retire_par: null },
    ],
    precisions: [
      { id: 'qb1', dossier_id: 'd7', ligne_bancaire_id: 't22', auteur_id: 'u-cabinet', origine: 'cabinet', texte: 'Peux-tu nous envoyer la quittance de loyer de septembre ? Le bail ne couvre que jusqu’en août.', created_at: '2026-09-24T08:00:00Z' },
    ],
    controles: [
      { id: 'cb1', dossier_id: 'd7', source_fichier: 'releve-2026.csv', solde_initial: 10000, solde_final: 12480.35, somme_mouvements: 2480.35, ecart: 0, coherent: true, periode_debut: '2026-08-01', periode_fin: '2026-08-31', created_at: MAINTENANT },
    ],
  }
  : { lignes: [], propositions: [], precisions: [], controles: [] }

// ── L'E-REPORTING DE L'ATELIER (ligne 28.5, étape e5c) ───────────────────────────────────────────────────────────────
//
// Le monde fictif des tests de l'écran (`src/test/ereportingEcran.ts`), posé sur l'atelier (d7, redevable, trimestriel) :
// un régime confirmé « chaque mois » depuis le 1er janvier 2026 (et un premier, retiré, qui reste dans l'historique) ; pour
// octobre 2027, un achat à un éditeur établi en Irlande, DÉCLARÉ le 2 novembre puis dont la fiche a une version plus récente
// (« À rectifier »), une vente à un particulier déclarée et à jour, son encaissement à déclarer ; une pièce en dollars
// ÉCARTÉE, et, pour novembre, une pièce en dollars que rien n'a jugée (un candidat). Les déclarations sont CALCULÉES par
// le module de l'écran sur le monde d'avant la nouvelle version de la fiche, comme la base les aurait gardées. Ces dates
// sont de 2027 : les visites qui ouvrent la fenêtre posent l'horloge au 5 novembre 2027 (`debordements.mjs`). Tous FICTIFS.
const DOSSIER_EREPORTING = ER.dossier({ id: 'd7', siret: '98765432400019' })
const REGIMES_EREPORTING: RegimeEreporting[] = [
  ER.regime({
    id: ER.R2, dossier_id: 'd7', depuis: '2025-09-01', note: 'Saisi avec la mauvaise date de départ.',
    cree_le: '2026-01-02T09:00:00Z', retire_le: '2026-01-03T10:00:00Z', retire_par: 'u1',
  }),
  ER.regime({ id: ER.R1, dossier_id: 'd7', depuis: '2026-01-01', cree_le: '2026-01-03T10:30:00Z' }),
]
const LIGNES_E1: LigneSaisie[] = [
  { designation: 'Séance de conseil en organisation — particulier', quantite: 1, prix_unitaire_ht: 100, taux_tva: 20 },
]
const FACTURE_E1: FactureEmise = {
  ...FACTURES_D7[0],
  id: ER.V1, numero: 'F2027-0001', date_emission: '2027-10-08', date_echeance: '2027-11-07',
  ...calculerTotaux(LIGNES_E1),
  tiers_nom: 'Particulier Fictif', tiers_adresse: '1 rue des Essais\n69001 Lyon', tiers_siret: null, tiers_siren: null,
  tiers_adresse_electronique: null, type_client: 'non_assujetti', nature_operation: 'services', date_prestation: '2027-10-08',
  created_at: '2027-10-08T09:00:00Z', validated_at: '2027-10-08T09:10:00Z',
}
const ENCAISSEMENT_E1: EncaissementFacture = encaissementDuBanc({
  id: ER.E1, facture_id: ER.V1, date_encaissement: '2027-10-15', montant: 120, cree_le: '2027-10-15T09:00:00Z',
})
const PART_E1: EncaissementFactureTaux = { encaissement_id: ER.E1, dossier_id: 'd7', taux: 20, montant: 120 }

// « RÈGLEMENTS » (espace client, étape A3) : la liste de tous les encaissements de l'atelier lit ceux d'au-dessus — le
// chèque retiré de F2026-0007, la contre-passation de F2026-0008, les déclarés, le paiement d'un particulier de 2027 — et
// celui-ci, un virement qui DÉSIGNE un mouvement du relevé : le cabinet le voit nommé, le client sans « Banque » lit la
// phrase de la fenêtre à sa place. Daté du 4 octobre, entre la contre-passation et le chèque à déclarer : les visites qui
// cliquent le premier ou le dernier « Déclaré sur la plateforme » de F2026-0008 visent toujours les mêmes lignes.
const ENCAISSEMENT_A3: EncaissementFacture = encaissementDuBanc({
  id: 'enc7', facture_id: 'f8', date_encaissement: '2026-10-04', montant: 300, ligne_bancaire_id: 't7', cree_le: '2026-10-04T09:00:00Z',
})
const PART_A3: EncaissementFactureTaux = { encaissement_id: 'enc7', dossier_id: 'd7', taux: 20, montant: 300 }

// ── UN DOSSIER QUI A BASCULÉ (d12 ; ligne 28.65, chantier EC-Q3, étape VF5a1) ───────────────────────────────────────────
//
// Une consultante assujettie dont les factures validées dans l'application sont la SOURCE de leur vente
// (`ventes_par_les_factures`) : le relevé reconnaît les mouvements que leurs encaissements classent ou réservent. ARCHIVÉ, pour
// n'être vu que des visites qui l'ouvrent par son adresse (`banque-basculee/*`) : la liste des dossiers — la barre latérale, le
// tableau de bord — n'offre que les dossiers en cours, et les autres visites ne changent pas. Trois factures sources de
// services à 20 % : F2026-0021, encaissée par un virement crédité 1,50 € de moins (des frais), que le cabinet a CLASSÉ par ses
// encaissements ; F2026-0022, encaissée par un virement que la cliente a désigné depuis son espace, RÉSERVÉ, pas encore
// classé ; F2026-0023, payée par chèque, enregistré sans mouvement. Puis deux mouvements ordinaires, à traiter. Tous FICTIFS.
const EMETTEUR_D12 = {
  emetteur_nom: 'Clara Fontaine Conseil', emetteur_siret: '44455566600019', emetteur_adresse: '8 place des Tisserands\n31000 Toulouse',
}
const LIGNES_D12: Record<string, LigneSaisie[]> = {
  fb1: [{ designation: 'Accompagnement à la réorganisation du service comptable — septembre 2026', quantite: 1, prix_unitaire_ht: 500, taux_tva: 20 }],
  fb2: [{ designation: 'Audit des processus de facturation — deux journées', quantite: 2, prix_unitaire_ht: 200, taux_tva: 20 }],
  fb3: [{ designation: 'Atelier de formation des bénévoles à la tenue de la caisse', quantite: 1, prix_unitaire_ht: 250, taux_tva: 20 }],
  // Étape VF5b : une quatrième facture source et son avoir validé (plus bas).
  fb4: [{ designation: 'Diagnostic de la chaîne de facturation et restitution', quantite: 2, prix_unitaire_ht: 150, taux_tva: 20 }],
  fbA: [{ designation: 'Geste commercial sur le diagnostic', quantite: -1, prix_unitaire_ht: 50, taux_tva: 20 }],
  // Étape VF5d : trois factures sources dont un encaissement déclaré a été défait (plus bas).
  fb5: [{ designation: 'Charte de facturation et modèles de documents', quantite: 1, prix_unitaire_ht: 200, taux_tva: 20 }],
  fb6: [{ designation: 'Acompte sur l’atelier de mars, annulé à la demande du client', quantite: 1, prix_unitaire_ht: 100, taux_tva: 20 }],
  fb7: [{ designation: 'Relecture des conditions générales de vente', quantite: 1, prix_unitaire_ht: 100, taux_tva: 20 }],
}
const factureD12 = (id: string, numero: string, emission: string, tiers: string): FactureEmise => ({
  ...FACTURES_D7[0], ...EMETTEUR_D12,
  id, dossier_id: 'd12', numero, date_emission: emission, date_echeance: '2026-10-31',
  ...calculerTotaux(LIGNES_D12[id]),
  tiers_nom: tiers, tiers_adresse: '12 avenue des Fictions\n31000 Toulouse', tiers_siret: null, tiers_siren: null,
  tiers_adresse_electronique: null, type_client: 'assujetti', nature_operation: 'services', date_prestation: emission,
  source_de_la_vente: true, created_by: 'u1', valide_par: 'u1',
  created_at: `${emission}T09:00:00Z`, validated_at: `${emission}T09:10:00Z`,
})
const FACTURES_D12: FactureEmise[] = [
  factureD12('fb1', 'F2026-0021', '2026-09-10', 'Cabinet Durand & Associés, experts en organisation'),
  factureD12('fb2', 'F2026-0022', '2026-09-14', 'SARL Horizon Logistique du Grand Sud-Ouest'),
  factureD12('fb3', 'F2026-0023', '2026-09-18', 'Association Les Tilleuls du Plateau'),
  // LA FENÊTRE DES ENCAISSEMENTS D'UNE FACTURE SOURCE (étape VF5b) : F2026-0024 (360 €) et son avoir validé A2026-0003 (60 €),
  // que la fenêtre dit nette de l'avoir ; un chèque de 120,50 € enregistré et DÉCLARÉ, revenu impayé, que la banque a débité
  // 120 € — la contre-passation qui cite ce débit le dépasserait de 0,50 € : la base l'admet, et la fenêtre dit que le débit
  // ne pourra pas se classer.
  factureD12('fb4', 'F2026-0024', '2026-09-22', 'Maison de santé pluriprofessionnelle des Coteaux et du Lauragais'),
  {
    ...factureD12('fbA', 'A2026-0003', '2026-09-25', 'Maison de santé pluriprofessionnelle des Coteaux et du Lauragais'),
    type: 'avoir', facture_origine_id: 'fb4',

  },
  // LA FICHE D'UN DÉBIT (étape VF5d) : deux chèques déclarés, revenus impayés ENSEMBLE — celui de F2026-0025
  // contre-passé en citant le débit, celui de F2026-0027 contre-passé sans mouvement, à rattacher —, et l'acompte de
  // F2026-0026, rendu à la librairie par un virement que sa contre-passation a CLASSÉ.
  factureD12('fb5', 'F2026-0025', '2026-09-24', 'Atelier Bleu, studio de design graphique et d’édition'),
  factureD12('fb6', 'F2026-0026', '2026-09-25', 'Librairie des Arcades'),
  factureD12('fb7', 'F2026-0027', '2026-09-26', 'Compagnie théâtrale du Grand Rond'),
]
const LIGNES_DES_FACTURES_D12: FactureLigne[] = Object.entries(LIGNES_D12).flatMap(([id, lignes]) => lignesDeFacture(id, lignes))
const ENCAISSEMENTS_D12: EncaissementFacture[] = [
  encaissementDuBanc({
    id: 'eb1', dossier_id: 'd12', facture_id: 'fb1', date_encaissement: '2026-09-21', montant: 600, ligne_bancaire_id: 'b1',
    cree_le: '2026-09-21T10:00:00Z',
  }),
  // Enregistré par la cliente (son accès, plus bas), le virement désigné : « proposé par le client ».
  encaissementDuBanc({
    id: 'eb2', dossier_id: 'd12', facture_id: 'fb2', date_encaissement: '2026-09-28', montant: 480, ligne_bancaire_id: 'b2',
    cree_par: 'u-clara', cree_le: '2026-09-28T18:20:00Z',
  }),
  encaissementDuBanc({
    id: 'eb3', dossier_id: 'd12', facture_id: 'fb3', date_encaissement: '2026-10-05', montant: 300, moyen: 'cheque',
    cree_le: '2026-10-05T09:00:00Z',
  }),
  encaissementDuBanc({
    id: 'eb4', dossier_id: 'd12', facture_id: 'fb4', date_encaissement: '2026-10-06', montant: 120.5, moyen: 'cheque',
    cree_le: '2026-10-06T09:00:00Z',
  }),
  // Étape VF5d : les deux chèques revenus ensemble, déclarés puis contre-passés — l'un citant le débit, l'autre sans
  // mouvement —, et l'acompte rendu par virement.
  encaissementDuBanc({
    id: 'eb5', dossier_id: 'd12', facture_id: 'fb5', date_encaissement: '2026-09-29', montant: 240, moyen: 'cheque',
    cree_le: '2026-09-29T09:00:00Z',
  }),
  encaissementDuBanc({
    id: 'cb5', dossier_id: 'd12', facture_id: 'fb5', date_encaissement: '2026-10-16', montant: -240, moyen: 'cheque', annule_id: 'eb5',
    ligne_bancaire_id: 'b7', motif: 'Chèque revenu impayé : provision insuffisante', cree_le: '2026-10-16T10:00:00Z',
  }),
  encaissementDuBanc({
    id: 'eb7', dossier_id: 'd12', facture_id: 'fb7', date_encaissement: '2026-10-01', montant: 120, moyen: 'cheque',
    cree_le: '2026-10-01T09:00:00Z',
  }),
  encaissementDuBanc({
    id: 'cb7', dossier_id: 'd12', facture_id: 'fb7', date_encaissement: '2026-10-16', montant: -120, moyen: 'cheque', annule_id: 'eb7',
    motif: 'Chèque revenu impayé, constaté sur l’avis de la banque', cree_le: '2026-10-16T10:05:00Z',
  }),
  encaissementDuBanc({
    id: 'eb6', dossier_id: 'd12', facture_id: 'fb6', date_encaissement: '2026-09-26', montant: 120, moyen: 'virement',
    cree_le: '2026-09-26T09:00:00Z',
  }),
  encaissementDuBanc({
    id: 'cb6', dossier_id: 'd12', facture_id: 'fb6', date_encaissement: '2026-10-12', montant: -120, moyen: 'virement', annule_id: 'eb6',
    ligne_bancaire_id: 'b8', motif: 'Acompte rendu : atelier annulé à la demande du client', cree_le: '2026-10-12T10:00:00Z',
  }),
]
// Le chèque de F2026-0024, déclaré sur la plateforme qui a accepté la facture (étape VF5b).
const DECLARATIONS_D12: TransmissionEncaissement[] = [
  declarationDuBanc({
    id: 'te-d12', dossier_id: 'd12', facture_id: 'fb4', encaissement_id: 'eb4', hote: 'flux.plateforme-beta.example',
    cree_le: '2026-10-07T09:00:00Z', maj_le: '2026-10-07T09:00:00Z',
  }),
  // Étape VF5d : les trois encaissements défaits, déclarés avant de l'être.
  ...([['eb5', 'fb5', '2026-09-30'], ['eb6', 'fb6', '2026-09-27'], ['eb7', 'fb7', '2026-10-02']] as const).map(([e, f, jour]) => declarationDuBanc({
    id: `te-d12-${e}`, dossier_id: 'd12', facture_id: f, encaissement_id: e, hote: 'flux.plateforme-beta.example',
    cree_le: `${jour}T09:00:00Z`, maj_le: `${jour}T09:00:00Z`,
  })),
]
const PARTS_D12: EncaissementFactureTaux[] = ENCAISSEMENTS_D12.map((e) => ({ encaissement_id: e.id, dossier_id: 'd12', taux: 20, montant: e.montant }))
const RELEVE_D12: Ligne[] = [
  mouvementDe('d12', 'b1', '2026-09-21', 'VIR SEPA CABINET DURAND ET ASSOCIES REGLEMENT FACTURE F2026-0021', 598.5, 'rapprochee', {
    encaissements_de_factures: true,
  }),
  mouvementDe('d12', 'b2', '2026-09-28', 'VIR SEPA SARL HORIZON LOGISTIQUE DU GRAND SUD OUEST F2026-0022', 480, 'non_rapprochee'),
  mouvementDe('d12', 'b3', '2026-09-30', 'FRAIS TENUE DE COMPTE', -8.5, 'non_rapprochee'),
  mouvementDe('d12', 'b4', '2026-09-15', 'PRLV SEPA TELEPHONIE PRO', -36, 'non_rapprochee'),
  // Le retour du chèque impayé de F2026-0024 (étape VF5b), libre : la contre-passation peut le citer.
  mouvementDe('d12', 'b5', '2026-10-14', 'RETOUR CHEQUE IMPAYE REMISE 0042', -120, 'non_rapprochee'),
  // La remise du chèque de F2026-0023 (étape VF5c), un crédit LIBRE : sa fiche offre de lui rattacher ce chèque, enregistré
  // sans mouvement, ou d'y enregistrer l'encaissement de F2026-0024, qui reste à encaisser.
  mouvementDe('d12', 'b6', '2026-10-08', 'REMISE DE CHEQUES 0057 ASSOCIATION LES TILLEULS', 300, 'non_rapprochee'),
  // LA FICHE D'UN DÉBIT (étape VF5d). Le retour des deux chèques impayés, RÉSERVÉ par la contre-passation de F2026-0025
  // qui le cite : 120,80 € restent à faire, que la contre-passation de F2026-0027 sans mouvement, ou celle du chèque de
  // F2026-0024, feraient aux frais près. Puis l'acompte rendu à la librairie, CLASSÉ par sa contre-passation.
  mouvementDe('d12', 'b7', '2026-10-16', 'RETOUR DE 2 CHEQUES IMPAYES REMISE 0049 FRAIS INCLUS', -360.8, 'non_rapprochee'),
  mouvementDe('d12', 'b8', '2026-10-12', 'VIR SEPA RESTITUTION ACOMPTE LIBRAIRIE DES ARCADES', -120, 'rapprochee', {
    encaissements_de_factures: true,
  }),
]

const pieceEreporting = (o: Ligne): Ligne => ({
  ...piece('p-er', '2027-10-05', 'Editeur Logiciel', 120, 0, 'c8', 'a_valider'),
  dossier_id: 'd7', storage_path: 'd7/er.pdf', nom_fichier: 'er.pdf', ...o,
})
const PIECES_EREPORTING: Ligne[] = [
  pieceEreporting({ id: ER.P1, nom_fichier: 'facture-logiciel.pdf', storage_path: 'd7/facture-logiciel.pdf' }),
  // Écartée : un fournisseur en dollars qui s’est révélé établi en France.
  pieceEreporting({
    id: ER.P9, date_piece: '2027-10-20', tiers: 'Atelier Fictif Sàrl', devise: 'USD', montant_ttc: 90, montant_devise: 97,
    taux_change: 0.927835, conversion_source: 'bce', nom_fichier: 'atelier-fictif.pdf', storage_path: 'd7/atelier-fictif.pdf',
  }),
  // Candidate : en dollars, sans fiche ni écart, en novembre.
  pieceEreporting({
    id: ER.P2, date_piece: '2027-11-02', tiers: 'Nuage Studio Inc', devise: 'USD', montant_ttc: 200, montant_devise: 216,
    taux_change: 0.925926, conversion_source: 'bce', nom_fichier: 'nuage-studio.pdf', storage_path: 'd7/nuage-studio.pdf',
  }),
]
const FICHES_EREPORTING: PieceHorsDeFrance[] = [
  ER.fiche({ id: ER.F1, dossier_id: 'd7', piece_id: ER.P1 }),
  // La version plus récente (après la déclaration du 2 novembre) : le numéro corrigé.
  ER.fiche({ id: ER.F2, dossier_id: 'd7', piece_id: ER.P1, remplace_id: ER.F1, numero: 'INV-1-CORR', cree_le: '2027-11-03T09:00:00Z' }),
]
const TAUX_EREPORTING: PieceHorsDeFranceTaux[] = [
  ER.taux({ fiche_id: ER.F1, dossier_id: 'd7' }),
  ER.taux({ fiche_id: ER.F2, dossier_id: 'd7' }),
]
const ECART_EREPORTING: PieceEcarteeEreporting = ER.ecart({ id: ER.X1, dossier_id: 'd7', piece_id: ER.P9 })

// Le monde tel qu'il était le 2 novembre, avant la deuxième version de la fiche : c'est lui que les déclarations ont lu.
const MONDE_DU_2_NOVEMBRE = ER.sources({
  regimes: ER.lu([REGIMES_EREPORTING[1]]),
  pieces: ER.lu([ER.piece({ id: ER.P1, dossier_id: 'd7' })]),
  fiches: ER.lu([FICHES_EREPORTING[0]]),
  taux: ER.lu([TAUX_EREPORTING[0]]),
  factures: ER.lu([ER.facture({ id: ER.V1, dossier_id: 'd7' })]),
  lignes: ER.lu([ER.ligne({ facture_id: ER.V1 })]),
  encaissements: ER.lu([ER.encaissement({ id: ER.E1, dossier_id: 'd7', facture_id: ER.V1 })]),
  parts: ER.lu([ER.part({ encaissement_id: ER.E1, dossier_id: 'd7' })]),
})
const DECLARATION_DES_ACHATS = ER.declaree('achats', ER.OCTOBRE, MONDE_DU_2_NOVEMBRE, { id: ER.D1 }, DOSSIER_EREPORTING)
const DECLARATION_DES_VENTES = ER.declaree('ventes', ER.OCTOBRE, MONDE_DU_2_NOVEMBRE, { id: ER.D2, cree_le: '2027-11-02T09:05:00Z' }, DOSSIER_EREPORTING)

const EREPORTING_D7 = {
  regimes: REGIMES_EREPORTING.map((r) => ({ ...r })),
  ecarts: [{ ...ECART_EREPORTING }],
  declarations: [DECLARATION_DES_ACHATS.declaration, DECLARATION_DES_VENTES.declaration].map((d) => ({ ...d })),
  sources: [...DECLARATION_DES_ACHATS.sources, ...DECLARATION_DES_VENTES.sources].map((s) => ({ ...s })),
  fiches: FICHES_EREPORTING.map((f) => ({ ...f })),
  taux: TAUX_EREPORTING.map((t) => ({ ...t })),
}
// « MA BANQUE », CÔTÉ CABINET (espace client, étape P9b) : sur le cabinet infirmier (d1), et pour les passes du cabinet
// seulement, la pièce du garage que l'accès « Claire » a proposée pour le prélèvement du garage (l12) — un montant qui ne
// concorde pas, et la pièce encore à valider —, une proposition retirée avant elle, et le fil : la question du cabinet, la
// réponse du client, longue. Rien de la passe du client n'en change.
const ENVOIS_DU_CLIENT_D1 = CLIENT_DU_BANC
  ? { propositions: [], precisions: [] }
  : {
    propositions: [
      { id: 'jc1', dossier_id: 'd1', ligne_bancaire_id: 'l12', piece_id: 'p5', auteur_id: 'u-claire', origine: 'client', created_at: '2026-09-19T08:00:00Z', retire_le: null, retire_par: null },
      { id: 'jc0', dossier_id: 'd1', ligne_bancaire_id: 'l12', piece_id: 'p7', auteur_id: 'u-claire', origine: 'client', created_at: '2026-09-18T18:00:00Z', retire_le: '2026-09-18T18:30:00Z', retire_par: 'u-claire' },
    ],
    precisions: [
      { id: 'qc1', dossier_id: 'd1', ligne_bancaire_id: 'l12', auteur_id: 'u1', origine: 'cabinet', texte: 'Ce prélèvement du garage est-il l’entretien du véhicule de tournée ? Le montant ne correspond à aucune facture reçue.', created_at: '2026-09-18T09:00:00Z' },
      { id: 'qc2', dossier_id: 'd1', ligne_bancaire_id: 'l12', auteur_id: 'u-claire', origine: 'client', texte: 'Oui : la vidange et les plaquettes du scooter de tournée.\nLa facture du garage porte aussi le pneu changé en août, réglé à part par chèque — je vous envoie la facture complète.', created_at: '2026-09-19T07:55:00Z' },
    ],
  }

// LE DOSSIER PERMANENT de la kinésithérapeute (ligne 41, étape R7, phase C) : la lettre de mission en deux versions (la seconde,
// au titre LONG, prolonge la première), un bail qui cite une facture dont l'empreinte a disparu, une description sans date, un
// contrat d'emprunt retiré, et une entrée sans citation à la validité close. La description de l'organisation comptable manque :
// l'information « rien n'est en vigueur » s'affiche. Des textes FICTIFS, sans nom de tiers ni donnée de patient.
const DOSSIER_PERMANENT_D9: Ligne[] = [
  {
    id: 'dp-d9-1', dossier_id: 'd9', nature: 'lettre_mission', titre: 'Lettre de mission', texte: 'Mission de présentation des comptes annuels.',
    piece_id: null, document_id: null, fichier_id: null, empreinte: null, valable_du: '2025-01-01', valable_jusqu_au: '2025-12-31',
    remplace_id: null, auteur: 'u1', cree_le: '2025-01-10T09:00:00Z', retire_le: null, retire_par: null,
  },
  {
    id: 'dp-d9-2', dossier_id: 'd9', nature: 'lettre_mission',
    titre: 'Lettre de mission reconduite pour les exercices 2026 à 2028, avenant sur les honoraires et la périodicité des rendez-vous',
    texte: 'Mission de présentation des comptes annuels, reconduite tacitement.\nLes honoraires et le calendrier des échanges sont ceux de l’avenant joint.',
    piece_id: null, document_id: null, fichier_id: null, empreinte: null, valable_du: '2026-01-01', valable_jusqu_au: '2028-12-31',
    remplace_id: 'dp-d9-1', auteur: 'u2', cree_le: '2026-01-12T09:00:00Z', retire_le: null, retire_par: null,
  },
  {
    id: 'dp-d9-3', dossier_id: 'd9', nature: 'bail', titre: 'Bail des locaux du cabinet', texte: null,
    piece_id: 'k1', document_id: null, fichier_id: null, empreinte: 'a'.repeat(64), valable_du: '2024-07-01', valable_jusqu_au: '2033-06-30',
    remplace_id: null, auteur: 'u1', cree_le: '2026-02-03T09:00:00Z', retire_le: null, retire_par: null,
  },
  {
    id: 'dp-d9-4', dossier_id: 'd9', nature: 'description', titre: 'Activité libérale de rééducation',
    texte: 'Exercice individuel en cabinet, patientèle conventionnée, déplacements à domicile.',
    piece_id: null, document_id: null, fichier_id: null, empreinte: null, valable_du: null, valable_jusqu_au: null,
    remplace_id: null, auteur: 'u1', cree_le: '2026-02-04T09:00:00Z', retire_le: null, retire_par: null,
  },
  {
    id: 'dp-d9-5', dossier_id: 'd9', nature: 'contrat_emprunt', titre: 'Emprunt du matériel de rééducation', texte: 'Remboursé par anticipation.',
    piece_id: null, document_id: null, fichier_id: null, empreinte: null, valable_du: '2021-03-01', valable_jusqu_au: '2024-02-28',
    remplace_id: null, auteur: 'u1', cree_le: '2026-02-05T09:00:00Z', retire_le: '2026-03-02T09:00:00Z', retire_par: 'u1',
  },
  // R7C2 : un contrat dont la facture citée a CHANGÉ depuis la citation (l'empreinte du jour n'est plus celle qui fut relevée) —
  // le volet de sa « Nouvelle version » le dit avant le clic, et l'enregistrement le fait confirmer. Titre long : il éprouve aussi
  // les largeurs.
  {
    id: 'dp-d9-6', dossier_id: 'd9', nature: 'contrat', titre: 'Contrat d’assurance de responsabilité civile professionnelle, avenant de 2025',
    texte: 'Garantie reconduite chaque année.', piece_id: 'k2', document_id: null, fichier_id: null, empreinte: 'c'.repeat(64),
    valable_du: '2025-04-02', valable_jusqu_au: null, remplace_id: null, auteur: 'u1', cree_le: '2026-02-06T09:00:00Z', retire_le: null, retire_par: null,
  },
]

// L'ADRESSE DE RÉCEPTION des factures électroniques (espace client, étape A6b1), vue du cabinet (Justificatifs › « Adresse de
// réception ») et du client « Ventes » (« Mes ventes › Tes plateformes › Ton adresse de réception ») : l'atelier (d7, SIREN
// 987654324) en a trois versions — une déclaration sans vérification, une version vérifiée sur la plateforme au NOM LONG et à
// l'identifiant LONG (la cellule et la ligne se coupent où il faut), déclarée par le titulaire, et la courante, À VENIR,
// vérifiée sur le portail de l'annuaire, déclarée par lui aussi (« par le client » au cabinet) ; le cabinet infirmier (d1, SIREN
// 123456789) une seule, non vérifiée ; les autres dossiers n'en ont aucune (le dossier sans SIRET, d4, dit pourquoi on ne peut
// pas déclarer). Fictives, comme tout le banc ; les auteurs sont les comptes du banc (`u1`, `u-bernard`).
const ADRESSES_RECEPTION_DU_BANC: Ligne[] = [
  {
    id: 'adr-d7-1', dossier_id: 'd7', forme: 'siren', identifiant: '987654324', plateforme: 'Plateforme fictive Alpha', prise_effet: '2026-07-01',
    verification: 'declaration', verifiee_le: null, remplace_id: null, auteur: 'u1', cree_le: '2026-08-20T09:00:00Z',
  },
  {
    id: 'adr-d7-2', dossier_id: 'd7', forme: 'siren_siret_routage', remplace_id: 'adr-d7-1', auteur: 'u-bernard', cree_le: '2026-09-11T08:30:00Z',
    identifiant: '987654324_98765432400019_SERVICE-COMPTABILITE-FACTURES-FOURNISSEURS-2026',
    plateforme: 'Plateforme de dématérialisation partenaire des experts-comptables et des entreprises de conseil',
    prise_effet: '2026-09-15', verification: 'plateforme', verifiee_le: '2026-09-10',
  },
  {
    id: 'adr-d7-3', dossier_id: 'd7', forme: 'siren_siret', identifiant: '987654324_98765432400019', plateforme: 'Plateforme fictive Alpha',
    prise_effet: '2027-03-01', verification: 'portail_annuaire', verifiee_le: '2026-10-01', remplace_id: 'adr-d7-2', auteur: 'u-bernard',
    cree_le: '2026-10-02T14:10:00Z',
  },
  {
    id: 'adr-d1-1', dossier_id: 'd1', forme: 'siren', identifiant: '123456789', plateforme: 'Plateforme fictive Bêta', prise_effet: '2026-09-01',
    verification: 'declaration', verifiee_le: null, remplace_id: null, auteur: 'u1', cree_le: '2026-09-02T09:00:00Z',
  },
]

// LE CATALOGUE D'ARTICLES de l'atelier de conseil (d7, espace client, étape A2a), vu du cabinet (l'onglet Factures › Articles) et
// de son client « Ventes » (« Mes ventes › Articles ») : six articles FICTIFS — un prix à six décimales qu'un affichage à deux
// arrondirait, une désignation et une description LONGUES (la cellule se coupe, l'infobulle garde le texte), une référence
// absente, un taux réduit, un article créé par le client puis modifié par le cabinet, un article créé par le client et un
// RETIRÉ par lui (« par le client » au cabinet). Les auteurs sont les comptes du banc : `u1` (le compte du banc : le cabinet,
// ou le client de la passe client) et `u-bernard` (le titulaire de l'atelier, reconnu par `memberships`).
const articleDuBanc = (o: Ligne): Ligne => ({
  dossier_id: 'd7', description: null, retire_le: null, retire_par: null, modifie_par: null, modifie_le: null, ...o,
})
const ARTICLES_D7: Ligne[] = [
  articleDuBanc({
    id: 'art1', reference: 'CONS-H', designation: 'Séance de conseil en gestion', unite: 'HUR', prix_unitaire_ht: 90, taux_tva: 20, nature: 'services',
    description: 'Une heure en visioconférence ou à l’atelier, compte rendu écrit inclus sous quarante-huit heures, quel que soit le sujet traité pendant la séance.',
    cree_par: 'u1', cree_le: '2026-09-01T09:00:00Z',
  }),
  articleDuBanc({
    id: 'art2', reference: 'AUDIT-FORFAIT', unite: 'LS', prix_unitaire_ht: 1250, taux_tva: 20, nature: 'services',
    designation: 'Audit de l’organisation commerciale — forfait, déplacement, entretiens avec l’équipe et rapport de synthèse remis en main propre',
    cree_par: 'u-bernard', cree_le: '2026-09-03T09:00:00Z',
  }),
  articleDuBanc({
    id: 'art3', reference: 'JOINT-NT', designation: 'Joint torique de remplacement', unite: 'H87', prix_unitaire_ht: 0.123456, taux_tva: 20, nature: 'biens',
    cree_par: 'u-bernard', cree_le: '2026-09-04T09:00:00Z',
  }),
  articleDuBanc({
    id: 'art4', reference: null, designation: 'Abonnement mensuel de suivi', unite: 'MON', prix_unitaire_ht: 149.9, taux_tva: 20, nature: 'services',
    cree_par: 'u-bernard', cree_le: '2026-09-05T09:00:00Z', modifie_par: 'u1', modifie_le: '2026-09-20T09:00:00Z',
  }),
  articleDuBanc({
    id: 'art5', reference: 'SUPPORT-A4', designation: 'Supports pédagogiques imprimés', unite: 'C62', prix_unitaire_ht: 12.5, taux_tva: 5.5, nature: 'biens',
    cree_par: 'u1', cree_le: '2026-09-06T09:00:00Z',
  }),
  articleDuBanc({
    id: 'art6', reference: 'TARIF-2025', designation: 'Ancien tarif horaire', unite: 'HUR', prix_unitaire_ht: 80, taux_tva: 20, nature: 'services',
    cree_par: 'u1', cree_le: '2026-01-10T09:00:00Z', retire_par: 'u-bernard', retire_le: '2026-09-10T09:00:00Z',
  }),
]

// LE FICHIER DES CLIENTS du client (espace client, étape A4b1), vu du cabinet (l'onglet Factures › Clients) et de son client « Ventes »
// (« Mes ventes › Clients »). Les identifiants sont ceux des jeux d'essai du dépôt (`src/test/contacts.ts`, `src/test/facturesCii.ts`),
// jamais un SIREN pris au hasard : 123456782 et son établissement 12345678200010, 100000207 et son établissement 10000020700017
// (la commune de `facturesCii.ts`, avec son code service), 987654324. Aucune donnée réelle.
//  - l'atelier de conseil (d7) : une entreprise (e-mail long), un organisme public (code service, observations longues), une
//    association avec son SIREN seul, un particulier au nom très long, un client établi hors de France, un client retiré par son
//    titulaire (« par le client » au cabinet), un autre retiré par le cabinet, et un EFFACÉ qui ne doit paraître nulle part ;
//  - le cabinet infirmier (d1, dossier de SOINS) : une entreprise, une association avec son SIREN (admissible), et deux contacts
//    rangés avant le passage aux soins — un particulier et un client établi hors de France —, plus un particulier retiré (« Reprendre »
//    refusé), pour éprouver le signalement d'A4-Q4 et la ligne d'information.
const contactDuBanc = (o: Ligne): Ligne => ({
  dossier_id: 'd7', genre: 'client', adresse_electronique: null, code_service: null, email: null, observations: null, siren: null, siret: null,
  delai_paiement_jours: 30, retire_le: null, retire_par: null, efface_le: null, efface_par: null, modifie_par: null, modifie_le: null, ...o,
})
const CONTACTS_DU_BANC: Ligne[] = [
  contactDuBanc({
    id: 'ct1', type_client: 'assujetti', nom: 'Société Alpha Conseil', adresse: 'Zone d’activité des Essais, 13999 Démoville',
    siren: '123456782', siret: '12345678200010', email: 'comptabilite.fournisseurs@alpha-conseil-exemple.fr',
    cree_par: 'u1', cree_le: '2026-09-02T09:00:00Z',
  }),
  contactDuBanc({
    id: 'ct2', type_client: 'organisme_public', nom: 'Commune de Démoville — service des achats et de la commande publique',
    adresse: 'Hôtel de ville, place de la Mairie, 13999 Démoville', siren: '100000207', siret: '10000020700017',
    adresse_electronique: '100000207', code_service: 'SERVICE-ACHATS', delai_paiement_jours: 45,
    observations: 'Numéro d’engagement juridique obligatoire sur chaque facture ; dépôt sur Chorus Pro uniquement, jamais par e-mail.',
    cree_par: 'u-bernard', cree_le: '2026-09-03T09:00:00Z',
  }),
  contactDuBanc({
    id: 'ct3', type_client: 'non_assujetti', nom: 'Association fictive des amis de l’atelier', adresse: 'Rue des Essais, 13999 Démoville',
    siren: '987654324', delai_paiement_jours: null, cree_par: 'u-bernard', cree_le: '2026-09-04T09:00:00Z', modifie_par: 'u1', modifie_le: '2026-09-21T09:00:00Z',
  }),
  contactDuBanc({
    id: 'ct4', type_client: 'non_assujetti', nom: 'Client particulier fictif au nom volontairement très long pour éprouver le passage à la ligne',
    adresse: 'Impasse fictive, 13999 Démoville', email: 'particulier.fictif@exemple.fr', delai_paiement_jours: 0,
    cree_par: 'u1', cree_le: '2026-09-05T09:00:00Z',
  }),
  contactDuBanc({
    id: 'ct5', type_client: 'etranger', nom: 'Fictive Workshop Limited', adresse: '1 Example Street, Fictiveland', delai_paiement_jours: 60,
    cree_par: 'u1', cree_le: '2026-09-06T09:00:00Z',
  }),
  contactDuBanc({
    id: 'ct6', type_client: 'assujetti', nom: 'Ancienne société cliente', adresse: 'Avenue du Passé, 13999 Démoville',
    cree_par: 'u1', cree_le: '2026-01-10T09:00:00Z', retire_par: 'u-bernard', retire_le: '2026-09-10T09:00:00Z',
  }),
  contactDuBanc({
    id: 'ct7', type_client: 'assujetti', nom: 'Autre ancienne société cliente', adresse: 'Boulevard des Archives, 13999 Démoville',
    cree_par: 'u-bernard', cree_le: '2026-01-11T09:00:00Z', retire_par: 'u1', retire_le: '2026-09-11T09:00:00Z',
  }),
  contactDuBanc({
    id: 'ct8', type_client: null, nom: 'Contact effacé le 12/10/2026', adresse: null, delai_paiement_jours: null,
    cree_par: 'u-bernard', cree_le: '2026-01-12T09:00:00Z', efface_par: 'u1', efface_le: '2026-10-12T09:00:00Z',
  }),
  // Le cabinet infirmier (d1), dossier de soins.
  contactDuBanc({
    id: 'cs1', dossier_id: 'd1', type_client: 'assujetti', nom: 'Mutuelle fictive santé', adresse: '2 rue de la Prévoyance, 13999 Démoville',
    siren: '987654324', siret: '98765432400019', email: 'gestion@mutuelle-fictive-exemple.fr', cree_par: 'u-claire', cree_le: '2026-02-01T09:00:00Z',
  }),
  contactDuBanc({
    id: 'cs2', dossier_id: 'd1', type_client: 'non_assujetti', nom: 'Association fictive des patients', adresse: 'Salle des fêtes, 13999 Démoville',
    siren: '123456782', delai_paiement_jours: null, cree_par: 'u1', cree_le: '2026-02-02T09:00:00Z',
  }),
  contactDuBanc({
    id: 'cs3', dossier_id: 'd1', type_client: 'non_assujetti', nom: 'Particulier fictif rangé avant les soins', adresse: 'Impasse fictive, 13999 Démoville',
    delai_paiement_jours: null, cree_par: 'u1', cree_le: '2026-02-03T09:00:00Z',
  }),
  contactDuBanc({
    id: 'cs4', dossier_id: 'd1', type_client: 'etranger', nom: 'Fictive Health Limited', adresse: '3 Example Street, Fictiveland',
    delai_paiement_jours: null, cree_par: 'u1', cree_le: '2026-02-04T09:00:00Z',
  }),
  contactDuBanc({
    id: 'cs5', dossier_id: 'd1', type_client: 'non_assujetti', nom: 'Ancien particulier fictif', adresse: 'Allée fictive, 13999 Démoville',
    delai_paiement_jours: null, cree_par: 'u1', cree_le: '2026-02-05T09:00:00Z', retire_par: 'u1', retire_le: '2026-08-01T09:00:00Z',
  }),
]

// LES PARAMÈTRES DE FACTURATION de l'atelier (espace client, étape A5b1), vus du cabinet (l'onglet Factures › Paramètres) et de
// son client « Ventes » (« Mes ventes › Paramètres ») : une première version du cabinet, son RIB confirmé d'un même geste ; puis
// une version de son titulaire (u-bernard) qui change le RIB — seulement PROPOSÉ, le premier restant en vigueur —, avec des
// mentions et un titulaire longs, pour éprouver le passage à la ligne. IBAN FICTIFS (le code banque 99999, à clé juste, ceux des
// essais du dépôt) ; aucune donnée réelle.
// LE LOGO DES FACTURES de l'atelier (espace client, étape A5c2a) : la version courante désigne un petit PNG FICTIF de 160 × 48 pixels,
// construit ici de ses octets (une chaîne en base64, aucun fichier ajouté) et d'empreinte JUSTE — son SHA-256, calculé hors du banc sur
// ces mêmes octets : l'écran le recalcule avant de montrer l'image. Le chemin a la forme d'un logo (`<identifiant>/logos/<empreinte>.png`,
// l'identifiant au format de la base : ceux du banc, « d7 », ne l'ont pas). Le seau `ventes` du banc le rend ; un dépôt y range le fichier.
// Ce chemin ne commence donc pas par le dossier de sa version, ce que la base interdit (`parametres_facturation_logo_chemin_forme`) :
// toute version nouvelle tirée de la courante, logo repris, se dirait refusée (« le logo d'un autre dossier »). La passe du client, dont
// une visite remplit le formulaire « Modifier les paramètres » jusqu'à ce qu'il dise ce que deviendra le RIB, voit donc la même courante
// SANS logo ; celle du cabinet montre le logo et sa confirmation de retrait, et ne fait partir aucune version qui le reprendrait.
const EMPREINTE_DU_LOGO_DU_BANC = '14cafec1fc00ea04927c25274520f59c039061cf7c7595040682a5b10a4480d9'
const CHEMIN_DU_LOGO_DU_BANC = `a5c00000-0000-4000-8000-0000000000d7/logos/${EMPREINTE_DU_LOGO_DU_BANC}.png`
const OCTETS_DU_LOGO_DU_BANC = 'iVBORw0KGgoAAAANSUhEUgAAAKAAAAAwCAIAAAAZy+Y5AAAAlUlEQVR42u3cMQ3AIBRFURzVERbQhwdGlBDYcdBuhMJJrgLO9n5CeFLUwQVPAFiABViAtQS4j7ZhqADrz8C5Fn0GGDBgwIABAwYMGDBgwDoF2GRhyRJgwIABAwYMGDBgwIDdg2XJAgwYMGDAgAEDBgwYsNyDBRgwYMCAAQMGDBgwYMByDzZ0AL4DWH7ZEWABFmAB1msTjfYX2XeSUEUAAAAASUVORK5CYII='

const PARAMETRES_DU_BANC: Ligne[] = [
  {
    id: 'pf1', dossier_id: 'd7', delai_paiement_jours: 30, moyen_prefere: 'virement', escompte: 'Pas d’escompte pour paiement anticipé.',
    penalites: 'Pénalités de retard : taux d’intérêt appliqué par la Banque centrale européenne à son opération de refinancement la plus récente, majoré de 10 points de pourcentage (C. com., art. L441-10, II).',
    mentions_complementaires: null, pied_de_page: null, iban: 'FR9399999000010000000000100', bic: 'ESSAFR10', titulaire_compte: 'Atelier de conseil fictif',
    rib_etat: 'confirme', rib_confirme_par: 'u1', rib_confirme_le: '2026-09-01T08:00:00Z', remplace_id: null, auteur: 'u1', cree_le: '2026-09-01T08:00:00Z',
    logo_chemin: null, logo_sha256: null,
  },
  {
    id: 'pf2', dossier_id: 'd7', delai_paiement_jours: 45, moyen_prefere: 'virement', escompte: 'Pas d’escompte pour paiement anticipé.',
    penalites: 'Pénalités de retard : taux d’intérêt appliqué par la Banque centrale européenne à son opération de refinancement la plus récente, majoré de 10 points de pourcentage (C. com., art. L441-10, II).',
    mentions_complementaires: 'Indemnité forfaitaire pour frais de recouvrement en cas de retard de paiement : quarante euros. Toute réclamation se fait par écrit dans les huit jours.',
    pied_de_page: 'Atelier de conseil fictif — société fictive au capital fictif — 13999 Démoville',
    iban: 'FR1299999000010000000000200', bic: null, titulaire_compte: 'Atelier de conseil fictif, compte professionnel principal de l’atelier',
    rib_etat: 'propose', rib_confirme_par: null, rib_confirme_le: null, remplace_id: 'pf1', auteur: 'u-bernard', cree_le: '2026-10-12T14:30:00Z',
    logo_chemin: CLIENT_DU_BANC ? null : CHEMIN_DU_LOGO_DU_BANC, logo_sha256: CLIENT_DU_BANC ? null : EMPREINTE_DU_LOGO_DU_BANC,
  },
]

// Le seau `ventes` du banc (étape A5c2a) : le logo ci-dessus, et ce qu'un dépôt y range. Comme le service : un nom déjà pris bute
// (une `StorageApiError` du SDK, que l'application reconnaît à ce qu'elle porte), un objet absent se dit « Object not found ».
function octetsDeBase64(texte: string): Uint8Array<ArrayBuffer> {
  const binaire = atob(texte)
  const octets = new Uint8Array(binaire.length)
  for (let i = 0; i < binaire.length; i++) octets[i] = binaire.charCodeAt(i)
  return octets
}
const SEAU_VENTES = new Map<string, Blob>([[CHEMIN_DU_LOGO_DU_BANC, new Blob([octetsDeBase64(OCTETS_DU_LOGO_DU_BANC)], { type: 'image/png' })]])
const erreurDuStockage = (status: number, statusCode: string, message: string) => ({ __isStorageError: true, status, statusCode, message })

// `enregistrer_parametres_facturation` et `confirmer_rib` (étape A5b1), comme leurs fonctions en base pour ce que le banc montre :
// la version nouvelle remplace la courante, son RIB gardé tel quel garde son état, posé ou changé par le cabinet il est confirmé,
// par le client proposé ; la confirmation passe la courante à « confirmé ». Les refus, l'essai en base les juge.
function rpcDesParametres(nom: string, args?: Ligne): { data: unknown; error: null } | null {
  const versions = () => TABLES.parametres_facturation ?? []
  if (nom === 'enregistrer_parametres_facturation' && args) {
    const p = (args.p_parametres ?? {}) as Ligne
    const courante = versions().find((v) => v.dossier_id === args.p_dossier_id && !versions().some((s) => s.remplace_id === v.id))
    const garde = courante !== undefined && p.iban === courante.iban && p.bic === courante.bic && p.titulaire_compte === courante.titulaire_compte
    const etat = p.iban == null ? null : garde ? courante.rib_etat : CLIENT_DU_BANC ? 'propose' : 'confirme'
    const confirme = etat === 'confirme' && !garde
    const ecrite: Ligne = {
      id: `pf${versions().length + 1}`, dossier_id: args.p_dossier_id, ...p, logo_chemin: p.logo_chemin ?? null, logo_sha256: p.logo_sha256 ?? null,
      rib_etat: etat,
      rib_confirme_par: garde ? courante.rib_confirme_par : confirme ? session.user.id : null,
      rib_confirme_le: garde ? courante.rib_confirme_le : confirme ? new Date().toISOString() : null,
      remplace_id: args.p_remplace_id ?? null, auteur: session.user.id, cree_le: new Date().toISOString(),
    }
    TABLES.parametres_facturation = [...versions(), ecrite]
    return { data: ecrite, error: null }
  }
  if (nom === 'confirmer_rib' && args) {
    const v = versions().find((x) => x.id === args.p_version_id)
    if (!v) return null
    const ecrite = { ...v, rib_etat: 'confirme', rib_confirme_par: session.user.id, rib_confirme_le: new Date().toISOString() }
    TABLES.parametres_facturation = versions().map((x) => (x.id === v.id ? ecrite : x))
    return { data: ecrite, error: null }
  }
  return null
}

const TABLES: Record<string, Ligne[]> = {
  revision_seuils: REVUE_D9.seuils,
  revision_explications: REVUE_D9.explications,
  references_annuelles: REVUE_D9.reperes,
  references_postes_annuels: REVUE_D9.postes,
  revision_justifications: REVISION_D9.decisions,
  revision_preuves: REVISION_D9.preuves,
  revision_conclusions: CYCLES_D9.conclusions,
  revision_notes: CYCLES_D9.journal,
  revision_revues: CYCLES_D9.revues,
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
  cabinet_admins: CLIENT_DU_BANC ? [] : [{ user_id: 'u1', cabinet_id: 'cab1', role: 'comptable_en_chef' }],
  // Les accès du cabinet infirmier et leurs deux droits (espace client, étape P1) : l'onglet Accès montre leurs cases —
  // l'une cochée, et une adresse longue, qui éprouve la fiche repliée sur téléphone. En client, le compte du banc y a le
  // sien, sans droit ; AuthContext le trouve par son identifiant, l'onglet par le dossier.
  memberships: [
    { id: 'm1', user_id: 'u-claire', dossier_id: 'd1', role: 'client', email: 'claire.moreau@exemple.fr', droit_ventes: true, droit_banque: false, created_at: '2026-01-05T09:30:00Z' },
    { id: 'm2', user_id: 'u-secretariat', dossier_id: 'd1', role: 'client', email: 'secretariat.cabinet-moreau@exemple.fr', droit_ventes: false, droit_banque: false, created_at: '2026-02-10T09:30:00Z' },
    ...(CLIENT_DU_BANC && !CLIENT_DU_DOSSIER_BASCULE
      ? [{ id: 'm-u1', user_id: 'u1', dossier_id: 'd1', role: 'client', email: 'client@exemple.fr', droit_ventes: false, droit_banque: false, created_at: '2026-01-05T09:00:00Z' }]
      : []),
    ...(CLIENT_DU_BANC && CLIENT_DU_DOSSIER_BASCULE
      ? [{ id: 'm-u1-d12', user_id: 'u1', dossier_id: 'd12', role: 'client', email: 'client@exemple.fr', droit_ventes: true, droit_banque: true, created_at: '2026-01-05T09:00:00Z' }]
      : []),
    // Le titulaire de l'atelier (d7) : l'accès que l'onglet Factures du cabinet reconnaît comme « le client » (étape P4c).
    { id: 'm-bernard-d7', user_id: 'u-bernard', dossier_id: 'd7', role: 'client', email: 'bernard@atelier-exemple.fr', droit_ventes: true, droit_banque: false, created_at: '2026-01-06T09:00:00Z' },
    ...(CLIENT_DU_BANC && VENTES_DU_BANC && !CLIENT_DU_DOSSIER_BASCULE
      ? [{ id: 'm-u1-d7',
 user_id: 'u1', dossier_id: 'd7', role: 'client', email: 'client@exemple.fr', droit_ventes: true, droit_banque: VENTES_DU_BANC === 'banque', created_at: '2026-01-05T09:00:00Z' }]
      : []),
    // La titulaire du dossier basculé (d12), « Ventes » et « Banque » : l'onglet Banque la reconnaît comme « le client ».
    { id: 'm-clara-d12', user_id: 'u-clara', dossier_id: 'd12', role: 'client', email: 'clara.fontaine@exemple-fictif.fr', droit_ventes: true, droit_banque: true, created_at: '2026-01-07T09:00:00Z' },
  ],
  notes_internes: NOTES_INTERNES,
  cabinets: [{ id: 'cab1', nom: 'JD Consult', couleur_primaire: null, police_google_font: null, logo_storage_path: LOGO_DU_BANC ? 'cab1/logo.png' : null }],
  dossiers,
  categories,
  pieces: [...pieces, ...TVA_D7.pieces, ...ENGAGEMENT_D8.pieces, ...SOURCES_D9.pieces, ...SOURCES_D10.pieces, ...PIECES_EREPORTING],
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
    ...TVA_LIQUIDEE_D7.ecritures,
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
    // Les deux mouvements écrits sur un compte de bilan : le compte choisi face à la banque, dans le sens du mouvement.
    ecritureReleve('r31', 'l24', '2026-09-12', '580000', 'VIR VERS LIVRET PRO', 'debit', 3000),
    ecritureReleve('r32', 'l24', '2026-09-12', '512000', 'VIR VERS LIVRET PRO', 'credit', 3000),
    ecritureReleve('r33', 'l25', '2026-07-03', '275000', 'DEPOT DE GARANTIE BAIL CABINET', 'debit', 1300),
    ecritureReleve('r34', 'l25', '2026-07-03', '512000', 'DEPOT DE GARANTIE BAIL CABINET', 'credit', 1300),
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
  // Les déclarations du premier et du deuxième trimestre, déposées (voir `DECLARATIONS_D7`) : l'historique de
  // l'onglet TVA les compare au calcul et dit la seconde payée.
  declarations_tva: TVA_LIQUIDEE_D7.declarations,
  // Le texte « lu » de la seule pièce sans catégorie : c'est ce qui fait offrir « Proposer une
  // catégorie » dans sa fiche. Écrit ici, fictif comme le reste.
  piece_textes_ocr: [{
    id: 't8', dossier_id: 'd1', piece_id: 'p8', document_id: null,
    texte: 'LOGISOINS SAS\nFacture n° 2026-0818\nAbonnement mensuel LogiSoins Premium — gestion des tournées et télétransmission\nTotal TTC 29,00 €',
  }, {
    // Le texte « lu » de la prestation du studio établi au Portugal (p19) : signaux et propositions de sa fiche.
    id: 't19', dossier_id: 'd1', piece_id: 'p19', document_id: null,
    texte: 'STUDIO LUMIÈRE LISBOA LDA\nVAT PT 123 456 789\nInvoice number: FT-2026/118\nReportage photographique — septembre 2026\n'
      + 'VAT reverse charge — Article 196 of Directive 2006/112/EC\nTotal EUR 250.00',
  }],
  pieces_hors_de_france: [...FICHES_HORS_DE_FRANCE, ...EREPORTING_D7.fiches],
  pieces_hors_de_france_taux: [...TAUX_HORS_DE_FRANCE, ...EREPORTING_D7.taux],
  // L'e-reporting de l'atelier (étape e5c, voir `EREPORTING_D7`).
  regimes_ereporting: EREPORTING_D7.regimes,
  pieces_ecartees_ereporting: EREPORTING_D7.ecarts,
  declarations_ereporting: EREPORTING_D7.declarations,
  declarations_ereporting_sources: EREPORTING_D7.sources,
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
    // Le dossier basculé (d12, étape VF5a2) : une règle range les frais de tenue de compte, et une autre désigne le virement
    // réservé à l'encaissement de F2026-0022 — que la carte du lot dit écarté, avec les mots de la garde.
    { id: 'ra4', dossier_id: 'd12', motif: 'frais tenue', sens: 'decaissement', categorie_id: 'c10', taux_tva: null, created_at: MAINTENANT },
    { id: 'ra5', dossier_id: 'd12', motif: 'horizon', sens: 'encaissement', categorie_id: 'c9', taux_tva: 20, created_at: MAINTENANT },
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
    // Deux mouvements ÉCRITS SUR UN COMPTE DE BILAN (lib/compteDeBilan.ts) : un virement vers le livret d'épargne du
    // cabinet, au 580000, et le dépôt de garantie versé pour le bail du cabinet, au 275000 — ni charge ni recette.
    { ...ligne('l24', '2026-09-12', 'VIR VERS LIVRET PRO', -3000, 'rapprochee', null), compte_bilan: '580000' },
    { ...ligne('l25', '2026-07-03', 'DEPOT DE GARANTIE BAIL CABINET', -1300, 'rapprochee', null), compte_bilan: '275000' },
    // Un mouvement IGNORÉ : le virement de la CPAM du 8 septembre, importé une seconde fois — un doublon, qui le reste. La
    // Checklist le compte parmi les mouvements absents du FEC, avec son montant.
    ligne('l26', '2026-09-08', 'VIR CPAM TIERS PAYANT', 2418.6, 'ignoree', null),
    ...COTISATIONS_D1.lignes,
    ...TVA_D7.lignes,
    ...RELEVE_D7.lignes,
    ...TVA_LIQUIDEE_D7.lignes,
    ...ENGAGEMENT_D8.lignes,
    ...SOURCES_D9.lignes,
    ...SOURCES_D10.lignes,
    ...BANQUE_DU_CLIENT_D7.lignes,
    ...RELEVE_D12,
  ],
  justificatifs_proposes: [...BANQUE_DU_CLIENT_D7.propositions, ...ENVOIS_DU_CLIENT_D1.propositions],
  precisions_mouvements: [...BANQUE_DU_CLIENT_D7.precisions, ...ENVOIS_DU_CLIENT_D1.precisions],
  controles_releves_bancaires: BANQUE_DU_CLIENT_D7.controles,
  cotisations_declarees: [...COTISATIONS_D1.echeances, ...SOURCES_D9.cotisations],
  // L'exercice 2025 de la kinésithérapeute, validé : ce qu'il garde, et sa 2035 telle qu'elle a été validée.
  exercices_valides: [VALIDATION_D9.valide],
  // Et l'ouverture de son exercice 2026, que cette validation a écrite.
  soldes_reportes: VALIDATION_D9.reportes,
  lettrages_manuels: ENGAGEMENT_D8.lettrages,
  // Les factures émises du cabinet infirmier, leurs lignes, leurs transmissions et l'historique de Super PDP (voir
  // `FACTURES_D1`), puis celle, jamais transmise, de l'atelier de conseil (`FACTURES_D7`, sans transmission ni événement) :
  // typées sur l'application, rendues au faux client en lignes nues.
  // Puis F2026-0008, acceptée par la plateforme de l'atelier, et la déclaration de ses encaissements (étape d4).
  // Puis F2026-0009, refusée par l'acheteur sur la plateforme du client, et les statuts lus de l'atelier (étape d7).
  factures_emises: [...FACTURES_D1, ...FACTURES_D7, FACTURE_F8, FACTURE_F9, FACTURE_E1, ...FACTURES_D12].map((f) => ({ ...f })),
  facture_lignes: [
    ...LIGNES_DES_FACTURES_D1, ...LIGNES_DES_FACTURES_D7, ...LIGNES_DE_F8, ...LIGNES_DE_F9, ...lignesDeFacture(ER.V1, LIGNES_E1),
    ...LIGNES_DES_FACTURES_D12,
  ].map((l) => ({ ...l })),
  statuts_factures_recus: STATUTS_D7.map((s) => ({ ...s })),
  transmissions_factures: [...TRANSMISSIONS_D1, ...TRANSMISSIONS_D7].map((t) => ({ ...t })),
  facture_superpdp_events: EVENEMENTS_SUPERPDP_D1.map((e) => ({ ...e })),
  encaissements_factures: [...ENCAISSEMENTS_D7, ...ENCAISSEMENTS_F8, ENCAISSEMENT_E1, ENCAISSEMENT_A3, ...ENCAISSEMENTS_D12].map((e) => ({ ...e })),
  encaissements_factures_taux: [...PARTS_D7, ...PARTS_F8, PART_E1, PART_A3, ...PARTS_D12].map((p) => ({ ...p })),
  transmissions_encaissements: [...DECLARATIONS_ENCAISSEMENTS_D7, ...DECLARATIONS_D12].map((d) => ({ ...d })),

  dossier_permanent: DOSSIER_PERMANENT_D9.map((e) => ({ ...e })),
  // Les pièces jointes que la réception par e-mail a écartées pour le cabinet infirmier (ligne 22.7) : un format refusé et
  // une pièce trop lourde, à signaler en tête de l'onglet Justificatifs, et une déjà vue, dans l'historique replié. Des
  // poids et des instants fictifs, aucun nom — la table n'en garde pas.
  pieces_jointes_ecartees: [
    { id: 'pje-1', dossier_id: 'd1', recue_le: '2026-09-24T07:42:00Z', raison: 'format', octets: 48_312, empreinte: '1'.repeat(64), vue_le: null, vue_par: null },
    { id: 'pje-2', dossier_id: 'd1', recue_le: '2026-09-22T15:05:00Z', raison: 'taille', octets: 27_403_212, empreinte: '2'.repeat(64), vue_le: null, vue_par: null },
    { id: 'pje-3', dossier_id: 'd1', recue_le: '2026-09-02T09:10:00Z', raison: 'format', octets: 3_871, empreinte: '3'.repeat(64), vue_le: '2026-09-03T08:00:00Z', vue_par: 'u1' },
    // Puis un dépôt qui a échoué avant toute lecture (ligne 22.8) : sa raison, et aucun poids — rien n'a été lu.
    { id: 'pje-4', dossier_id: 'd1', recue_le: '2026-09-25T10:15:00Z', raison: 'depot', octets: null, empreinte: '4'.repeat(64), vue_le: null, vue_par: null },
    // Puis une pièce jointe arrivée vide (ligne 22.91) : sa raison, et son poids de zéro.
    { id: 'pje-5', dossier_id: 'd1', recue_le: '2026-09-25T16:40:00Z', raison: 'vide', octets: 0, empreinte: '5'.repeat(64), vue_le: null, vue_par: null },
    // Et pour l'atelier (d7), la société du client du banc (ligne 22.9) : « Mes pièces » les dit à son client — un format
    // refusé, un dépôt échoué avant toute lecture, reçu à 23 h 30 en temps universel (le lendemain à Paris), une pièce
    // jointe arrivée vide, déjà vue par le cabinet (la marque ne change rien pour le client). Fictifs, aucun nom.
    { id: 'pje-6', dossier_id: 'd7', recue_le: '2026-10-08T07:40:00Z', raison: 'format', octets: 6_112, empreinte: '6'.repeat(64), vue_le: null, vue_par: null },
    { id: 'pje-7', dossier_id: 'd7', recue_le: '2026-10-02T23:30:00Z', raison: 'depot', octets: null, empreinte: '7'.repeat(64), vue_le: null, vue_par: null },
    { id: 'pje-8', dossier_id: 'd7', recue_le: '2026-09-29T08:05:00Z', raison: 'vide', octets: 0, empreinte: '8'.repeat(64), vue_le: '2026-09-30T08:00:00Z', vue_par: 'u1' },
  ],
  // L'adresse de réception des factures électroniques (espace client, étape A6b1) : voir ADRESSES_RECEPTION_DU_BANC.
  adresses_reception: ADRESSES_RECEPTION_DU_BANC.map((a) => ({ ...a })),
  // Le catalogue d'articles de l'atelier (espace client, étape A2a) : voir ARTICLES_D7.
  articles: ARTICLES_D7.map((a) => ({ ...a })),
  // Le fichier des clients (espace client, étape A4b1) : voir CONTACTS_DU_BANC.
  contacts: CONTACTS_DU_BANC.map((c) => ({ ...c })),
  // Les paramètres de facturation (espace client, étape A5b1) : voir PARAMETRES_DU_BANC.
  parametres_facturation: PARAMETRES_DU_BANC.map((v) => ({ ...v })),
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

// LA PLATEFORME DU CLIENT (ligne 28.5, fenêtre « Plateforme du client » de l'onglet Pièces). Le cabinet infirmier a
// relié celle de sa cliente, qui a déjà livré une facture (p15). Une recherche rend quatre factures — une neuve au nom
// de fichier long, celle déjà importée, une que la plateforme traite encore et une qu'elle a rejetée — et écarte deux
// messages qui n'en sont pas. Le même dossier a aussi la synchronisation Super PDP configurée : les deux fenêtres
// disent le double import. Les autres dossiers n'ont ni l'une ni l'autre.
const CONNEXION_PLATEFORME_D1 = {
  nom: 'Plateforme Alpha', url_flux: 'https://flux.plateforme-alpha.example/afnor',
  url_jeton: 'https://flux.plateforme-alpha.example/oauth2/token', hote: 'flux.plateforme-alpha.example',
  client_id: 'cabinet-jd-consult', organisation_id: 'org-cabinet-infirmier-moreau', portee: null,
  recherche_depuis: '2026-09-30T08:00:00.000Z', derniere_recuperation: '2026-09-30T08:05:00.000Z',
  // Ses statuts n'ont jamais été relevés : l'onglet Factures le dit, et « Relire les statuts depuis le début » est le geste.
  cycle_vie_depuis: null as string | null, cycle_vie_lu_le: null as string | null,
  created_at: '2026-09-15T09:00:00.000Z', version: 'v-banc-1',
}

// Celle de l'atelier de conseil (d7) : une autre plateforme, reliée elle aussi — la fenêtre de transmission de sa facture
// jamais partie propose alors les DEUX canaux, Super PDP (voir `superpdp-credentials` plus bas) et celle-ci. Aucun écran
// de l'atelier n'appelle la plateforme avant qu'une fenêtre ne s'ouvre : ses autres visites ne changent pas.
const CONNEXION_PLATEFORME_D7 = {
  ...CONNEXION_PLATEFORME_D1,
  nom: 'Plateforme Bêta', url_flux: 'https://flux.plateforme-beta.example/afnor',
  url_jeton: 'https://flux.plateforme-beta.example/oauth2/token', hote: 'flux.plateforme-beta.example',
  organisation_id: 'org-atelier-bernard-conseil', version: 'v-banc-2',
  // Ses statuts ont été relevés jusqu'au bout la veille (étape d7) : la déclaration de F2026-0008 le dit.
  cycle_vie_depuis: '2026-10-08T06:45:00.000Z', cycle_vie_lu_le: '2026-10-08T07:45:00.000Z',
}

function fluxDuBanc(id: string, sens: 'achat' | 'vente', syntaxe: string, nom: string | null, etat: string) {
  return { id, sens, syntaxe, direction: sens === 'achat' ? 'In' : 'Out', nom, recu_le: '2026-10-06T07:30:00.000Z', mis_a_jour: '2026-10-06T07:31:00.000Z', etat }
}

function plateformeAgreee(corps: Ligne): { data: unknown; error: unknown } {
  const d1 = corps.dossierId === 'd1'
  switch (corps.action) {
    case 'statut':
      return { data: { connexion: d1 ? CONNEXION_PLATEFORME_D1 : corps.dossierId === 'd7' ? CONNEXION_PLATEFORME_D7 : null }, error: null }
    case 'tester':
      return { data: { ok: true }, error: null }
    case 'relever':
      return { data: releveDuBanc(corps), error: null }
    case 'lister':
      return {
        data: {
          hote: CONNEXION_PLATEFORME_D1.hote, version: CONNEXION_PLATEFORME_D1.version,
          depuis: CONNEXION_PLATEFORME_D1.recherche_depuis,
          flux: [
            fluxDuBanc('fx-neuve', 'achat', 'Factur-X', 'FA-2026-1004-PHARMA-DISTRIBUTION-SUD-RECAPITULATIF-MENSUEL-OCTOBRE.pdf', 'pret'),
            fluxDuBanc('fx-15', 'achat', 'CII', 'FA-2026-0930-BIOSANTE.xml', 'pret'),
            fluxDuBanc('fx-attente', 'vente', 'UBL', null, 'en_attente'),
            fluxDuBanc('fx-rejet', 'achat', 'CII', 'FA-2026-0927.xml', 'en_erreur'),
          ],
          ecartes: { autre_flux: 2, illisible: 0, format: 0, statut_inconnu: 0, doublons: 0 },
          complete: true, motif: null, jusqua: '2026-10-06T07:31:00.000Z',
        },
        error: null,
      }
    default:
      return { data: null, error: { message: 'maquette' } }
  }
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
    // LA JOINTURE DES LIGNES DE FACTURE (étape VF4c2) : `facture_lignes` se filtre sur une colonne de SA facture
    // (`factures_emises.dossier_id`, `factures_emises.source_de_la_vente` — lib/ventesFactureesLecture.ts), qu'une ligne ne
    // porte pas. `sur` laissait passer toute colonne absente : chaque lecture des ventes facturées recevait les lignes de
    // TOUTES les factures du banc, et se disait incomplète. Jugée ici sur la facture de la ligne, comme la base.
    eq: (c: string, v: unknown) => {
      if (c.startsWith('factures_emises.')) {
        const champ = c.slice('factures_emises.'.length)
        filtres.push((l) => (TABLES.factures_emises ?? []).some((f) => f.id === l.facture_id && f[champ] === v))
      } else filtres.push(sur(c, (x) => x === v))
      return chaine
    },
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

const session = { user: { id: 'u1', email: CLIENT_DU_BANC ? 'client@exemple.fr' : 'cabinet@exemple.fr' }, access_token: 'faux' }

// `couverture_du_releve` : les mois (au premier jour) où le relevé du dossier porte un mouvement ;
// `droits_sur_le_dossier` : comme en base, le cabinet gère les ventes et la banque ; un client, selon les cases de son
// accès (`memberships`).
function rpcDuBanc(nom: string, dossierId: string | undefined): { data: unknown; error: null | { message: string } } {
  if (nom === 'couverture_du_releve') {
    const mois = new Set((TABLES.lignes_bancaires ?? []).filter((l) => l.dossier_id === dossierId)
      .map((l) => String(l.date).slice(0, 7) + '-01'))
    return { data: [...mois].sort(), error: null }
  }
  if (nom === 'droits_sur_le_dossier') {
    const acces = (TABLES.memberships ?? []).find((m) => m.dossier_id === dossierId && m.user_id === session.user.id)
    const droits = {
      cabinet: !CLIENT_DU_BANC,
      membre: acces !== undefined,
      ventes: !CLIENT_DU_BANC || acces?.droit_ventes === true,
      banque: !CLIENT_DU_BANC || acces?.droit_banque === true,
    }
    return { data: droits, error: null }
  }
  // `etat_facture_electronique` (espace client, étape A6b2) : la plateforme du client et Super PDP, reliés ou non, et l'adresse de
  // réception COURANTE (la version qu'aucune autre ne remplace), comme la fonction en base — jamais un secret, un identifiant de
  // connexion ni une adresse de service. Le cabinet infirmier (d1) a sa plateforme et son adresse déclarée sans vérification :
  // « Active », non vérifiée ; l'atelier de conseil (d7) a la sienne et une adresse qui ne prend effet qu'en 2027 : « À
  // compléter », « À venir » ; un autre dossier n'a rien. Les identifiants sont des UUID, que le module de l'état exige.
  if (nom === 'etat_facture_electronique') {
    const uuidDuBanc = (texte: string) => {
      const hex = [...texte].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('').padEnd(32, '0').slice(0, 32)
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
    }
    const versions = (TABLES.adresses_reception ?? []).filter((a) => a.dossier_id === dossierId)
    const courante = versions.find((a) => !versions.some((b) => b.remplace_id === a.id))
    const connexion = dossierId === 'd1' ? CONNEXION_PLATEFORME_D1 : dossierId === 'd7' ? CONNEXION_PLATEFORME_D7 : null
    const superpdp = dossierId === 'd1' || dossierId === 'd7'
    return {
      data: {
        plateforme: connexion === null
          ? { reliee: false, nom: null, creee_le: null, derniere_recuperation: null, statuts_lus_le: null }
          : {
            reliee: true, nom: connexion.nom, creee_le: connexion.created_at, derniere_recuperation: connexion.derniere_recuperation,
            statuts_lus_le: connexion.cycle_vie_lu_le,
          },
        superpdp: superpdp ? { relie: true, depuis: '2026-09-05T14:00:00+02:00' } : { relie: false, depuis: null },
        adresse: courante === undefined ? null : {
          id: uuidDuBanc(String(courante.id)), forme: courante.forme, identifiant: courante.identifiant,
          plateforme: courante.plateforme, prise_effet: courante.prise_effet, verification: courante.verification,
          verifiee_le: courante.verifiee_le, auteur: uuidDuBanc(String(courante.auteur)), cree_le: courante.cree_le,
        },
      },
      error: null,
    }
  }
  // `dernier_changement_de_rib` (espace client, étape A5b3b) : le jour à Paris, le geste, l'auteur, l'état et l'effet du dernier
  // changement du RIB des factures, jamais le RIB — comme la fonction en base. Les jours se comptent à partir d'AUJOURD'HUI (l'avis
  // dure trente jours : des dates figées s'éteindraient). L'atelier de conseil (d7), que le client des passes porte : un RIB proposé
  // depuis un accès client, il y a trois jours, sur un RIB confirmé qui reste en vigueur — attente au cabinet comme chez le client.
  // Le cabinet infirmier (d1) : un RIB proposé il y a quarante jours, que le cabinet voit encore (il attend son geste) et que le
  // client — qui n'y porte aucune case — ne lit pas. d2 : posé par le cabinet il y a dix jours ; d3 : retiré il y a deux jours ;
  // d4 : une réponse illisible (la ligne discrète) ; d5 : changé il y a vingt-neuf jours (le dernier jour) ; d6 : il y a trente
  // jours (plus rien) ; les autres dossiers n'ont jamais changé de RIB.
  if (nom === 'dernier_changement_de_rib') {
    const jourDeParis = (decalage: number) => new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(Date.now() - decalage * 86_400_000))
    const rendu = (jour: string, geste: string, auteur: string, etat: string, ribEnVigueur: string) =>
      ({ data: { changement: { jour, geste, auteur, etat, rib_en_vigueur: ribEnVigueur } }, error: null })
    if (dossierId === 'd7') return rendu(jourDeParis(3), 'change', 'client', 'propose', 'inchange')
    if (dossierId === 'd1') return rendu(jourDeParis(40), 'pose', 'client', 'propose', 'aucun')
    if (dossierId === 'd2') return rendu(jourDeParis(10), 'pose', 'cabinet', 'confirme', 'pose')
    if (dossierId === 'd3') return rendu(jourDeParis(2), 'retire', 'inconnu', 'retire', 'retire')
    if (dossierId === 'd4') return { data: { changement: { jour: jourDeParis(1) } }, error: null }
    if (dossierId === 'd5') return rendu(jourDeParis(29), 'confirme', 'cabinet', 'confirme', 'change')
    if (dossierId === 'd6') return rendu(jourDeParis(30), 'confirme', 'cabinet', 'confirme', 'change')
    // d11 : un dossier ARCHIVÉ (il n'est pas dans la liste des dossiers du banc, qui n'offre que les dossiers en cours) dont un RIB
    // proposé attend toujours, depuis cinquante-cinq jours — la liste de `dossiers_au_rib_a_confirmer` le rend, marqué.
    if (dossierId === 'd11') return rendu(jourDeParis(55), 'pose', 'client', 'propose', 'aucun')
    return { data: { changement: null }, error: null }
  }
  // `dossiers_au_rib_a_confirmer` (espace client, étape A5b3d) : les dossiers dont le dernier changement du RIB est un RIB PROPOSÉ,
  // le plus ancien d'abord, puis l'identifiant — comme la fonction en base. Chaque élément reprend la réponse de
  // `dernier_changement_de_rib` ci-dessus (la même, jamais une seconde copie) : le tableau de bord et la Vue d'ensemble ne peuvent pas
  // se contredire. Le cabinet infirmier (d1, 40 jours), l'atelier (d7, 3 jours) et un dossier archivé (d11, 55 jours, au nom long).
  // Le levier `banc-rib-liste` (localStorage, lu à chaque appel) joue les autres états : « refusee » (le refus de la fonction),
  // « illisible » (une valeur d'une autre forme), « vide » (aucun dossier n'attend).
  if (nom === 'dossiers_au_rib_a_confirmer') {
    const levier = typeof localStorage === 'undefined' ? null : localStorage.getItem('banc-rib-liste')
    if (levier === 'refusee') return { data: null, error: { message: 'Seul le cabinet lit les RIB à confirmer.' } }
    if (levier === 'illisible') return { data: { dossiers: 'pas une liste' }, error: null }
    if (levier === 'vide') return { data: { dossiers: [] }, error: null }
    const uuid = (texte: string) => {
      const hex = [...texte].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('').padEnd(32, '0').slice(0, 32)
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
    }
    const NOMS_ARCHIVES: Record<string, string> = { d11: 'Société civile de moyens des cabinets infirmiers associés de la vallée' }
    const elements = ['d11', 'd1', 'd7'].map((id) => {
      const rendu = rpcDuBanc('dernier_changement_de_rib', id).data as { changement: { jour: string } }
      return {
        jour: rendu.changement.jour, dossier_id: uuid(id), archive: id in NOMS_ARCHIVES,
        nom: NOMS_ARCHIVES[id] ?? String(dossiers.find((d) => d.id === id)?.nom), changement: rendu.changement,
      }
    }).sort((a, b) => (a.jour < b.jour ? -1 : a.jour > b.jour ? 1 : a.dossier_id < b.dossier_id ? -1 : 1))
    return { data: { dossiers: elements.map((e) => ({ dossier_id: e.dossier_id, nom: e.nom, archive: e.archive, changement: e.changement })) }, error: null }
  }
  // `plan_du_dossier` (ligne 43, étape PC3) : le plan effectif d'un dossier, un rôle par ligne dans l'ordre du catalogue ;
  // aucun dossier du banc n'en règle un, chacun lit donc le défaut de chaque rôle, comme en base.
  if (nom === 'plan_du_dossier') {
    return {
      data: ROLES_COMPTABLES.map((r) => ({
        role: r.role, compte: r.compteDefaut, libelle: r.libelleDefaut, prefixe_auxiliaire: r.prefixeAuxiliaireDefaut, origine: 'application',
      })),
      error: null,
    }
  }
  // `pieces_jointes_ecartees_du_client` (ligne 22.9) : le jour à Paris, la raison et le poids des pièces jointes écartées
  // du dossier, de la plus récente à la plus ancienne, comme la fonction en base. Le banc ne juge pas la fenêtre de 90
  // jours (l'essai en base la juge) : il mesure la carte de « Mes pièces ».
  if (nom === 'pieces_jointes_ecartees_du_client') {
    const jourAParis = (instant: string) => new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(instant))
    return {
      data: (TABLES.pieces_jointes_ecartees ?? []).filter((e) => e.dossier_id === dossierId)
        .sort((a, b) => String(b.recue_le).localeCompare(String(a.recue_le)))
        .map((e) => ({ jour: jourAParis(String(e.recue_le)), raison: e.raison, octets: e.octets })),
      error: null,
    }
  }
  return { data: nom === 'verifier_exercice_valide', error: null }
}

export const supabase = {
  auth: {
    getSession: () => Promise.resolve({ data: { session }, error: null }),
    getUser: () => Promise.resolve({ data: { user: session.user }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signOut: () => Promise.resolve({ error: null }),
    // « Envoyer un lien de réinitialisation » (onglet Accès) : la demande est acceptée, et rien ne part vers personne.
    resetPasswordForEmail: () => Promise.resolve({ data: {}, error: null }),
  },
  // « Vérifier l'empreinte » d'un exercice validé répond « intacte » ; la couverture du relevé et les droits de
  // l'appelant (espace client, étape P7), comme leurs fonctions en base ; tout autre appel, faux.
  rpc: (nom: string, args?: { p_dossier_id?: string } & Ligne) => Promise.resolve(rpcDesParametres(nom, args) ?? rpcDuBanc(nom, args?.p_dossier_id)),
  from: (table: string) => requete(table),
  storage: {
    // Le seau `ventes` (étape A5c2a) rend et range les logos ; les autres seaux restent une maquette.
    from: (seau: string) => ({
      getPublicUrl: () => ({ data: { publicUrl: LOGO_DU_BANC ?? '' } }),
      createSignedUrl: () => Promise.resolve({ data: null, error: { message: 'maquette' } }),
      download: (chemin: string) => {
        if (seau !== 'ventes') return Promise.resolve({ data: null, error: { message: 'maquette' } })
        const fichier = SEAU_VENTES.get(chemin)
        return Promise.resolve(fichier ? { data: fichier, error: null } : { data: null, error: erreurDuStockage(400, '404', 'Object not found') })
      },
      list: () => Promise.resolve({ data: [], error: null }),
      upload: (chemin: string, corps: Blob) => {
        if (seau !== 'ventes') return Promise.resolve({ data: null, error: { message: 'maquette' } })
        if (SEAU_VENTES.has(chemin)) return Promise.resolve({ data: null, error: erreurDuStockage(409, '409', 'The resource already exists') })
        SEAU_VENTES.set(chemin, corps)
        return Promise.resolve({ data: { path: chemin }, error: null })
      },
      remove: () => Promise.resolve({ data: null, error: null }),
    }),
  },
  // « Proposer une catégorie » répond une proposition retenue, avec un extrait LONG : c'est lui qui
  // éprouve le passage à la ligne dans le volet. La connexion bancaire répond pour le cabinet infirmier
  // (voir CONNEXION_D1), et sa plateforme du client et sa synchronisation Super PDP aussi (voir
  // CONNEXION_PLATEFORME_D1) ; l'atelier de conseil (d7) a les deux également, pour la transmission de sa facture
  // (voir CONNEXION_PLATEFORME_D7). Tout le reste reste une maquette.
  functions: {
    invoke: (nom: string, options?: { body?: Ligne }) => {
      if (nom === 'proposer-categorie') {
        return Promise.resolve({ data: { issue: 'retenue', categorieId: 'c8', indice: 'Abonnement mensuel LogiSoins Premium — gestion des tournées et télétransmission' }, error: null })
      }
      if (nom === 'banque-connexion') return Promise.resolve(connexionBancaire(options?.body ?? {}))
      if (nom === 'plateforme-agreee') return Promise.resolve(plateformeAgreee(options?.body ?? {}))
      if (nom === 'superpdp-credentials') {
        const configured = options?.body?.dossierId === 'd1' || options?.body?.dossierId === 'd7'
        return Promise.resolve({ data: { configured, client_id: configured ? 'app-superpdp-moreau' : null }, error: null })
      }
      return Promise.resolve({ data: null, error: { message: 'maquette' } })
    },
  },
}
