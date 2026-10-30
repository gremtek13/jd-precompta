import type { ModeleComptable } from './engagement'
import type { DossierTab } from './ongletsDossier'
import type { Concordance2035 } from './concordance2035'
import { partCsgNonDeductible, type Declaration2035 } from './declaration2035'
import { casesNegatives, doublonFraisVehicules, valeursDesCases } from './cases2035'
import type { DoublonDeTexte } from './doublonsTexte'
import type { Emprunt } from './emprunts'
import { numeroterFec, type NumerotationFec } from './fec'
import { liquidationsDesynchronisees, paiementsTvaDesynchronises, periodesNonDeclarees } from './liquidationTva'
import { confronterLOuverture, ouvertureEnEcart } from './ouvertureConfrontee'
import { analyserEcritures, ecrituresSansObjet, piecesAComptabiliser } from './ecritures'
import {
  immobilisationsSansJustificatif, moisEnDoubleSurAbonnement, montantsDesMouvementsIgnores, mouvementsIgnoresHorsFec,
  mouvementsRapprochesSansObjet, piecesADateImpossible, piecesDeviseNonConvertie, piecesPayeesEnPartie, piecesTvaImpossible,
  piecesValideesSansCategorie,
} from './controles'
import { mouvementsSurUnCompteDeBilanDesynchronises } from './compteDeBilan'
import { mouvementsAffectes, mouvementsAffectesDesynchronises, recettesAffecteesSansTaux } from './affectationBanque'
import { mouvementsVentilesDesynchronises, partsDesVentilations, recettesVentileesSansTaux, ventilationsIncoherentes } from './ventilationBanque'
import { virementsPersonnelsAEcrire } from './virementPersonnel'
import { cotisationsAEcrire, cotisationsComptees, rapprochementsCotisationRefuses } from './cotisationRapprochee'
import { paiementsPersonnelsAReprendre } from './cotisationPersonnelle'
import { couvertureDuReleve, echeancesDesynchronisees, echeancesNonRapprochees } from './echeanceEmprunt'
import { acquisitionsDesBiens, dotationDeLExercice, dotationsDuRegistre, dotationsEnDefaut } from './amortissements'
import { amortissementsSousLeBareme, forfaitsDuCadre7, forfaitsEnDefaut } from './forfaitKilometrique'
import { piecesPayeesEnTrop, reglementsGroupesIncoherents } from './reglementGroupe'
import { paiementsDesPieces, rattachementsTresorerie, type PaiementsDesPieces, type PartEncaissee } from './rattachement'
import { defautsDeNumerotation, estFigee, frontiereDeValidation } from './validationExercice'
import { mouvementsDeCloture, ouvertureDeLExercice, soldesAReporter, type ReportDesSoldes } from './reportDesSoldes'
import { jumellesDuDossier, ventesEnDouble, type FacturePourJumelle, type TransmissionPourJumelle } from './ventesJumelles'
import { exemplairesDesSources, horsDesExemplairesDesSources, type FacturesSources } from './facturesSources'
import { memeEcritureQueLeBrouillon } from './ecrituresVentesFacturees'
import { LIBELLE_ETAT_SOURCE, type EtatsDesVentes, type SourceDeVenteEtat } from './ecrituresVentesFactureesEcran'
import { MOYENS_ENCAISSEMENT } from './encaissementsFactures'
import { anneeDe, formatDate, formatMoney } from './format'
import type { VentesDeLaChecklist } from './ventesDeLaChecklist'
import {
  caisseNegative, caisseNegativeDite, detailDesOperationsAReprendre, detailDesRecettesARevoir, etatDeLaCaisseLue,
  operationsDe, operationsDeCaisseAReprendre, recettesDeCaisseARevoir, type EspecesDesFactures, type OperationsDeCaisse,
} from './controlesDeLaCaisse'
import type {
  ANouveau, Categorie, ControleReleveBancaire, CotisationDeclaree, DeclarationTva, EcritureBrouillon, Immobilisation,
  LigneBancaire, NatureImmobilisation, PeriodiciteTva, Piece, ReglementGroupe, SoldeReporte, VehiculeDossier, VentilationBancaire,
} from './types'

// CE QUI EMPÊCHE DE VALIDER UN EXERCICE, DIT AVANT LE CLIC (ligne 26.6, étape d). Une validation ne se défait
// pas : ce qu'elle fige d'incomplet ou de faux le reste. Deux familles de préalables, et un principe pour chacune.
//
// CE QUE LA BASE REFUSERA, dans l'ordre où elle le refuse et avec ses mots (`valider_exercice`) : un exercice en
// cours, déjà validé, pris hors de l'ordre ou antérieur à l'ouverture ; des écritures antérieures non validées ;
// des mouvements à traiter. Les dire ici évite un clic qui échoue — et la base reste le seul juge : un préalable
// que l'écran aurait manqué, elle le refuse quand même.
//
// LA VALIDATION FIGE TOUT CE QUI PRÉCÈDE LE 31 DÉCEMBRE, pas seulement l'exercice : la frontière de la base est
// une date. Un exercice antérieur que rien n'a validé serait donc figé sans l'avoir été — ses pièces, ses
// mouvements, son forfait ou sa dotation à jamais sans écriture, et sa 2035 à jamais sans concordance. Sans
// ouverture ni exercice validé, le premier exercice qui porte quelque chose se valide donc d'abord ; ensuite,
// la base impose l'ordre, et chaque validation ne fige plus qu'un exercice. Les contrôles qui suivent ne
// regardent donc que l'exercice.
//
// CE QUE LA BASE NE VOIT PAS, et que l'application refuse à sa place — décision du cabinet le 04/10/2026 : on ne
// valide pas tant que la 2035 et les écritures ne concordent pas au centime, ni tant qu'une écriture est en
// anomalie. Une base qui ne sait pas calculer une 2035 ne peut pas le vérifier. L'anomalie se lit ici dans les
// DEUX modèles — en trésorerie aussi, au-delà de la concordance : la concordance compare les comptes de RÉSULTAT,
// et un virement personnel sans écriture, une ligne de banque mal datée ou une TVA sur le mauvais compte la
// laissent juste pendant que le FEC est faux. CE SONT LES CONTRÔLES EN ERREUR DE LA CHECKLIST, ramenés à
// l'exercice : un défaut que l'application signale en erreur ne se fige pas. `prealablesValidation.test.ts` vérifie
// que chaque point en erreur de la Checklist est repris ici ou écarté avec sa raison.
//
// L'OUVERTURE DE L'EXERCICE, CONFRONTÉE À LA CLÔTURE DU PRÉCÉDENT, en est aussi (O33-Q1, décision du cabinet du
// 18/10/2026) : « le bilan d'ouverture d'un exercice doit correspondre au bilan de clôture de l'exercice précédent »
// (code de commerce, art. L123-19, al. 3 ; PCG, art. 112-2). La base ne calcule pas de bilan, comme elle ne calcule pas
// de 2035 : l'onglet Bilan les confronte (lib/ouvertureConfrontee.ts), et un écart retient la validation.
// La Checklist le dit aussi, avant le geste (O33-Q3, lib/pointsDeLaChecklist.ts) : ses mots sont écrits une fois, dans
// lib/ouvertureConfrontee.ts (`ouvertureEnEcart`), et dits pareils là et ici.
//
// ET CE QUI RESTERAIT EN SUSPENS : une pièce à valider de l'exercice, une pièce sans date, une date impossible.
// Après la validation, aucune écriture ne se passe plus dans l'exercice : une pièce qu'on validerait ensuite ne
// pourrait plus y être comptabilisée.

export interface PrealableDeValidation {
  id: string
  // Le nombre d'éléments en cause, quand le préalable en compte ; nul pour une condition (un exercice en cours).
  nb: number | null
  // Avec un nombre, ce qu'il compte, à la manière de la Checklist (« pièce(s) à valider … ») ; sans, une
  // phrase qui se lit seule — celle de la base quand elle refuserait de même.
  message: string
  cible: DossierTab
  // Un préalable bloquant refuse la validation ; un avertissement se lit avant de valider, sans la refuser.
  bloquant: boolean
  detail?: string
  // L'exercice qui se valide d'abord, quand le préalable tient à l'ordre des exercices : l'écran y mène d'un clic.
  // Sans cela, il nommerait un exercice que rien n'affiche peut-être — une année qui ne porte qu'une échéance de
  // cotisation, ou rien du tout, n'est pas dans la liste des exercices de l'en-tête.
  exercice?: number
}

export interface DonneesDeValidation {
  annee: number
  // L'année en cours À PARIS (`aujourdHuiAParis`) : la base la lit ainsi, et la nuit du Nouvel An ne doit pas
  // faire diverger l'écran et la base.
  anneeCourante: number
  // Aujourd'hui À PARIS (AAAA-MM-JJ, `aujourdHuiAParis`), le même instant : l'onglet Bilan le reçoit, et l'ouverture se
  // confronte ici sur ses entrées à lui (`confronterLOuverture`).
  aujourdHui: string
  modele: ModeleComptable
  assujettiTva: boolean
  anneesValidees: readonly number[]
  // Le motif d'une lecture partielle de l'une des collections ci-dessous, ou rien. Une lecture partielle ne
  // commande pas d'écriture (CLAUDE.md) — et une validation est l'écriture la plus définitive qui soit.
  lectureIncomplete: string | null
  piecesValidees: readonly Piece[]
  piecesAValider: readonly Piece[]
  categories: readonly Categorie[]
  immobilisations: readonly Immobilisation[]
  natures: readonly NatureImmobilisation[]
  // Tout le brouillon et tout le relevé du dossier : une écriture antérieure non validée et un mouvement d'un
  // exercice précédent comptent aussi.
  ecritures: readonly EcritureBrouillon[]
  lignes: readonly LigneBancaire[]
  ventilations: readonly VentilationBancaire[]
  reglements: readonly ReglementGroupe[]
  // Ce que les virements mixtes paient de leurs exemplaires (étape VF5h ; lib/encaissementsFactures.ts,
  // `partsEncaissees`) : sans eux, la pièce qu'un tel virement paie s'attendrait à sa date de facture, et ses écritures,
  // datées par lui, se diraient désynchronisées.
  encaissees: readonly PartEncaissee[]
  cotisations: readonly CotisationDeclaree[]
  vehicules: readonly VehiculeDossier[]
  emprunts: readonly Emprunt[]
  // L'ouverture REPRISE d'un autre logiciel (`a_nouveaux`) : sa date décide de l'ordre des exercices et de ce que la
  // balance reprise porte déjà.
  aNouveaux: readonly ANouveau[]
  // Les soldes REPORTÉS par la validation de chaque exercice (ligne 34, lib/reportDesSoldes.ts) : ceux du 1er janvier
  // ouvrent l'exercice à valider, et sa numérotation les reçoit avec la reprise — la base exige qu'elle couvre exactement
  // l'une et les autres.
  soldesReportes: readonly SoldeReporte[]
  // Les déclarations de TVA enregistrées, et la périodicité du dossier : une liquidation ou un paiement qui ne suit plus
  // sa déclaration se refuse, une période sans déclaration se dit (ligne 26.8).
  declarationsTva: readonly DeclarationTva[]
  periodiciteTva: PeriodiciteTva
  // Nuls quand on n'a pas pu les lire : ils ne se taisent pas, ils deviennent un préalable.
  relevesIncoherents: readonly ControleReleveBancaire[] | null
  doublonsTexte: readonly DoublonDeTexte[] | null
  // Les factures émises VALIDÉES du dossier et leurs transmissions (ligne 28.6, lib/ventesJumelles.ts) : une vente que
  // plusieurs pièces portent compte deux fois dans la 2035, la CA3 et les écritures. Lues en partie, elles suspendent la
  // validation comme les autres collections (`lectureIncomplete`).
  facturesEmises: readonly FacturePourJumelle[]
  transmissions: readonly TransmissionPourJumelle[]
  // Les factures SOURCES de leur vente (étape VF6a, lib/facturesSources.ts ; `VentesFacturees.sources`) : leur exemplaire ne
  // compte nulle part, et les préalables qui jugent une pièce comme une pièce qui compte l'écartent — sinon la validation
  // attendrait son écriture, sa catégorie ou sa conversion, que rien ne lit. NULLES quand on ne les a pas lues en entier :
  // la validation se suspend, comme sur toute lecture partielle. Sans valeur par défaut.
  facturesSources: FacturesSources | null
  // LES VENTES FACTURÉES D'UN DOSSIER BASCULÉ (chantier EC-Q3, étape VF7c), sur la lecture que Clôture fait déjà
  // (lib/ecrituresVentesFactureesLecture.ts) et le brouillon entier : les états de la section « Ventes facturées » de
  // l'onglet Écritures (`etatsDesVentesFacturees` — la composition que la numérotation reçoit, et chaque source à écrire,
  // à réécrire, à retirer ou qui ne s'écrit pas) et ce que la Vue d'ensemble en dit (`ventesDeLaChecklist` — les mouvements
  // réservés, les encaissements sans mouvement). « Sans objet » pour un dossier qui n'a pas basculé ; NULS tant qu'ils ne
  // sont pas revenus pour ce dossier — la validation se suspend alors, comme sur toute lecture partielle. Sans valeur par
  // défaut : oubliés, les écritures d'un dossier basculé sortiraient de la numérotation que la base exige entière.
  etatsDesVentes: EtatsDesVentesDeLaValidation | null
  ventesDeLaChecklist: VentesDeLaChecklist | null
  // LA CAISSE DU DOSSIER (ligne 26.6, étape C3b ; lib/controlesDeLaCaisse.ts) : ses opérations lues EN ENTIER, retirées
  // comprises, ou la caisse ABSENTE (le drapeau `CAISSE_EXPORTEE` baissé : rien ne change). NULLES tant qu'elles ne sont pas
  // revenues entières pour ce dossier : la validation se suspend, comme sur toute lecture partielle. Sans valeur par défaut :
  // oubliées, les écritures de la caisse sortiraient de la numérotation que la base exige entière, et les trois préalables
  // de la caisse se tairaient.
  operationsDeCaisse: OperationsDeCaisse | null
  // En trésorerie, la 2035 de l'exercice et sa concordance avec les écritures ; RIEN en engagement, où la 2035 ne se
  // produit pas — l'appelant ne la calcule pas, et la base refuserait de la recevoir.
  declaration: Declaration2035 | null
  concordance: Concordance2035 | null
}

export interface EtatDeValidation {
  prealables: PrealableDeValidation[]
  // La numérotation de l'exercice, celle que la validation enverra — nulle quand une lecture est partielle.
  numerotation: NumerotationFec | null
  // L'ouverture de l'exercice suivant, telle que la validation l'écrira dans le même clic (ligne 34) — nulle quand une
  // lecture est partielle.
  report: ReportDesSoldes | null
  // Vrai quand aucun préalable bloquant ne reste.
  validable: boolean
}

function pluriel(n: number, singulier: string, plurielForme = `${singulier}s`): string {
  return `${n} ${n > 1 ? plurielForme : singulier}`
}

// Les dates où une pièce s'écrit, ou s'écrira : en trésorerie, celles de ses paiements et, pour le reste, sa date
// de facture (lib/rattachement.ts) ; en engagement, sa facture à sa date et chacun de ses règlements à la sienne.
function datesDesEcrituresAttendues(piece: Piece, paiements: PaiementsDesPieces, modele: ModeleComptable): string[] {
  const p = paiements.get(piece.id) ?? []
  const dates = modele.mode === 'engagement'
    ? [piece.date_piece, ...p.map((m) => m.date)]
    : rattachementsTresorerie(piece, p).map((r) => r.date)
  return dates.filter((d): d is string => d !== null)
}

// Ce qui décide de l'ordre des exercices : ce qui est validé, l'ouverture, et ce que chaque année porte.
export type SuiteDesExercices = Pick<DonneesDeValidation,
  'anneeCourante' | 'modele' | 'anneesValidees' | 'aNouveaux' | 'ecritures' | 'lignes' | 'reglements' | 'encaissees'
  | 'piecesValidees' | 'piecesAValider' | 'cotisations' | 'vehicules' | 'immobilisations' | 'etatsDesVentes'>

// Les années qui portent quelque chose : une écriture, un mouvement qui n'est pas ignoré (un virement personnel
// l'est, et s'écrit), une pièce validée à la date où elle s'écrit, une pièce à valider, une échéance de
// cotisation là où elle compte — au prélèvement qui la paie, sinon à son échéance (lib/cotisationRapprochee.ts) :
// une échéance de décembre prélevée en janvier ne fait pas de décembre un exercice à valider —, un forfait
// kilométrique, la mise en service d'un bien. Et, d'un dossier basculé (étape VF7c), les dates des ventes facturées :
// l'émission d'une facture ou d'un avoir source, un encaissement — contre-passation comprise —, un mouvement que ses
// encaissements classent ; un exercice qui n'a qu'elles se valide d'abord, comme un autre.
function anneesActives(d: SuiteDesExercices, paiements: PaiementsDesPieces): Set<number> {
  const annees = new Set<number>()
  const noter = (date: string | null) => { if (date) annees.add(anneeDe(date)) }
  for (const e of d.ecritures) noter(e.date)
  for (const l of d.lignes) if (l.statut !== 'ignoree' || l.prelevement_personnel) noter(l.date)
  for (const p of d.piecesValidees) for (const date of datesDesEcrituresAttendues(p, paiements, d.modele)) noter(date)
  for (const p of d.piecesAValider) noter(p.date_piece)
  for (const c of cotisationsComptees(d.cotisations, d.lignes, d.modele.mode)) noter(c.date)
  for (const v of d.vehicules) if (v.km_professionnel > 0) annees.add(v.annee)
  for (const i of d.immobilisations) noter(i.date_mise_en_service ?? i.date_acquisition)
  for (const date of datesDesVentesFacturees(d.etatsDesVentes)) noter(date)
  return annees
}

// Les dates des ventes facturées d'un dossier basculé, sur la composition de ses états : l'émission de chaque facture ou avoir
// source (ses documents), chaque encaissement et contre-passation (ses parts), chaque écriture composée — un mouvement que ses
// encaissements classent compris —, et la date de chaque source que les états nomment (une vente écartée, qui n'a ni
// document ni part). Aucune pour un dossier qui n'a pas basculé, ni sur des états qui ne sont pas lus.
function datesDesVentesFacturees(etats: EtatsDesVentesDeLaValidation | null): string[] {
  if (etats?.etat !== 'lus') return []
  const { ventes, ecritures } = etats.contexte.composition
  return [
    ...ventes.documents.map((x) => x.date), ...ventes.parts.map((x) => x.date), ...ecritures.map((e) => e.date),
    ...etats.sources.map((s) => s.date),
  ]
}

// LE PROCHAIN EXERCICE À VALIDER, celui que les préalables d'ordre réclament : l'exercice qui suit le dernier
// validé ; sans validation, celui de l'ouverture d'un dossier repris ; sans ouverture, le premier qui porte quelque
// chose. Nul quand il n'est pas encore terminé, ou que rien n'est à valider. Une ouverture ne se pose plus après une
// validation (la base le refuse), donc le dernier exercice validé la suit toujours.
//
// Clôture le montre même quand rien ne l'y ferait paraître — une année vide entre deux autres, ou qui ne porte
// qu'une échéance de cotisation : sinon la validation de tous les exercices suivants attendrait un exercice que
// l'écran ne propose pas.
export function prochainExerciceAValider(d: SuiteDesExercices): number | null {
  const ouverture = d.aNouveaux.length === 0 ? null : d.aNouveaux.map((a) => a.date).sort()[0]
  const prochain = d.anneesValidees.length > 0
    ? Math.max(...d.anneesValidees) + 1
    : ouverture !== null
      ? anneeDe(ouverture)
      : Math.min(...anneesActives(d, paiementsDesPieces(d.lignes, d.reglements, d.encaissees)))
  return Number.isFinite(prochain) && prochain < d.anneeCourante ? prochain : null
}

// CE QUE LA BASE REFUSE AUSSI POUR LES VENTES FACTURÉES D'UN DOSSIER BASCULÉ (chantier EC-Q3, étape VF7b ; migration
// `validation_des_ventes_facturees`) : les refus que `valider_exercice` y ajoute, DANS L'ORDRE DE SON TEXTE, SOUS SES MOTS
// ET SON CODE. Un mouvement RÉSERVÉ à des encaissements de factures sources (un crédit ; un débit, à leurs
// contre-passations), dit AVANT les mouvements à traiter, sous son nom ; puis, après eux, un encaissement par virement ou
// par prélèvement sans son mouvement ; puis la PREMIÈRE source en défaut de l'exercice (`ventes_facturees_de_l_exercice`,
// de la frontière au 31 décembre), sous les mots de son état. Chaque « % » est une valeur de la base : l'exercice, une date
// (JJ/MM/AAAA), un numéro de facture, le nom du moyen (`NOM_DU_MOYEN_SANS_MOUVEMENT`), ou le nom de la source (« la
// facture F2025-0001 », « l'encaissement du 10/03/2025 de la facture F2025-0001 », « la contre-passation du … », « le
// mouvement du … »). Ses MOTS SEULEMENT : les préalables les diront avant le clic à l'étape VF7c ; jusque-là, la base
// refuse seule, et `prealablesValidation.test.ts` confronte cette liste au texte exporté et à l'essai
// (supabase/essais/validationDesVentesFacturees.sql).
export const REFUS_VENTES_FACTUREES_DE_LA_VALIDATION = [
  {
    cle: 'mouvement_reserve_credit',
    modele: "L'exercice % porte un mouvement du % réservé à l'encaissement de la facture % : le classer par ses encaissements avant la validation.",
    code: '23514',
  },
  {
    cle: 'mouvement_reserve_debit',
    modele: "L'exercice % porte un mouvement du % réservé à la contre-passation d'un encaissement de la facture % : le classer par ses contre-passations avant la validation.",
    code: '23514',
  },
  {
    cle: 'encaissement_sans_mouvement',
    modele: "L'exercice % porte un encaissement de la facture % par % du %, sans son mouvement : il manque au relevé, ou n'y est pas rattaché — le rattacher avant la validation.",
    code: '23514',
  },
  { cle: 'a_ecrire', modele: "L'exercice % porte une vente facturée qui n'est pas écrite : % — l'écrire avant la validation.", code: '23514' },
  {
    cle: 'a_reecrire',
    modele: "L'exercice % porte une vente facturée dont l'écriture proposée n'est plus celle que sa source commande : % — la réécrire avant la validation.",
    code: '23514',
  },
  {
    cle: 'a_retirer',
    modele: "L'exercice % porte l'écriture proposée d'une vente facturée qui n'a plus rien à écrire : % — la retirer avant la validation.",
    code: '23514',
  },
  {
    cle: 'ne_s_ecrit_pas',
    modele: "L'exercice % porte une vente facturée qui ne s'écrit pas : % — lever ce qui la retient avant la validation.",
    code: '23514',
  },
] as const

export type CleRefusVentesFactureesDeLaValidation = (typeof REFUS_VENTES_FACTUREES_DE_LA_VALIDATION)[number]['cle']

// Les moyens d'un encaissement qui, sans mouvement au 31 décembre, retiennent la validation — encaissé à l'inscription au
// crédit, son mouvement est de son exercice —, et leur nom dans le refus. Un chèque, une carte ou un effet sans mouvement
// est un en-cours, aux valeurs à l'encaissement (EC3-Q7) : il ne retient pas.
export const NOM_DU_MOYEN_SANS_MOUVEMENT = { virement: 'virement', prelevement: 'prélèvement' } as const

// ── LES VENTES FACTURÉES D'UN DOSSIER BASCULÉ, DITES AVANT LE CLIC (chantier EC-Q3, étape VF7c) ─────────────────────────
// La conception : HISTORIQUE.md, « VF7, LA VALIDATION FIGE LA SOURCE : LA CONCEPTION », § 3 (d). Trois préalables neufs,
// sous les mots de la base et dans son ordre (`REFUS_VENTES_FACTUREES_DE_LA_VALIDATION`) : `mouvements-reserves` (avant les
// mouvements à traiter, qui ne les comptent plus), puis `encaissements-sans-mouvement` (un virement ou un prélèvement ; un
// chèque, une carte ou un effet sans mouvement est un en-cours au 511, dit en AVERTISSEMENT sous
// `encaissements-en-cours`), puis `ventes-facturees-a-ecrire`. La numérotation reçoit la composition : les lignes
// rattachées prennent le journal, la pièce et l'auxiliaire du FEC, celles qui ne le sont plus vont à
// `ventes-facturees-a-ecrire` et non plus à `ecritures-orphelines`. Pour un dossier qui n'a pas basculé, rien ne change :
// aucun de ces trois préalables, une composition vide, les orphelines comptées comme hier.

/** Ce que la validation reçoit de la section « Ventes facturées » de l'onglet Écritures : ses états, ou pourquoi il n'y en a pas. */
export type EtatsDesVentesDeLaValidation =
  // Le dossier n'a pas basculé : rien n'est lu de plus, rien ne change.
  | { etat: 'sans_objet' }
  // Basculé, les sources lues en partie ou refusées.
  | { etat: 'incomplete'; motif: string }
  // Basculé : les états (lib/ecrituresVentesFactureesEcran.ts), ou des lectures qui ne se tiennent pas (« incohérent »).
  | EtatsDesVentes

type EtatEnDefaut = Extract<CleRefusVentesFactureesDeLaValidation, 'a_ecrire' | 'a_reecrire' | 'a_retirer' | 'ne_s_ecrit_pas'>

/** Une source d'une vente facturée que la validation de l'exercice refuserait, et pourquoi. */
export interface VenteFactureeEnDefaut {
  source: SourceDeVenteEtat
  etat: EtatEnDefaut
  /** Le jour que la base nomme : la première date qui diffère, sinon celle de la source. */
  jour: string
  /** Les lignes PROPOSÉES de la source jusqu'au 31 décembre : celles qui se réécrivent ou se retirent. */
  lignes: readonly string[]
}

const ORDRE_DES_GENRES: Readonly<Record<SourceDeVenteEtat['source']['genre'], number>> = { facture: 0, avoir: 1, encaissement: 2, mouvement: 3 }

const premiere = (dates: readonly string[]) => dates.reduce((a, b) => (b < a ? b : a))

/**
 * LES SOURCES EN DÉFAUT JUSQU'AU 31 DÉCEMBRE DE L'EXERCICE, comme `ventes_facturees_de_l_exercice` les juge (migration
 * `validation_des_ventes_facturees`) : ce que la composition écrit après la frontière et jusqu'à `fin`, confronté aux lignes
 * proposées de la source dans la même fenêtre, date par date (`memeEcritureQueLeBrouillon`) — à écrire, à réécrire, à
 * retirer ; ou une source qui ne s'écrit pas, quand SA date y tombe. Une source « à écrire » en janvier suivant ne retient
 * pas l'exercice. Dans l'ordre de la base : le jour, le genre, puis la clé.
 */
export function ventesFactureesEnDefaut(
  sources: readonly SourceDeVenteEtat[], fin: string, frontiere: string | null,
): VenteFactureeEnDefaut[] {
  const defauts: VenteFactureeEnDefaut[] = []
  for (const s of sources) {
    if (s.etat === 'ne_s_ecrit_pas') {
      if (s.date <= fin && !estFigee(s.date, frontiere)) defauts.push({ source: s, etat: 'ne_s_ecrit_pas', jour: s.date, lignes: [] })
      continue
    }
    const attendues = s.aEcrire.filter((e) => e.date <= fin)
    const proposees = s.proposees.filter((l) => l.date <= fin)
    const lignes = proposees.map((l) => l.id)
    if (attendues.length === 0 && proposees.length === 0) continue
    if (proposees.length === 0) {
      defauts.push({ source: s, etat: 'a_ecrire', jour: premiere(attendues.map((e) => e.date)), lignes })
    } else if (attendues.length === 0) {
      defauts.push({ source: s, etat: 'a_retirer', jour: premiere(proposees.map((l) => l.date)), lignes })
    } else {
      const datesAttendues = new Set(attendues.map((e) => e.date))
      const differentes = [
        ...attendues.filter((e) => !memeEcritureQueLeBrouillon(e, proposees.filter((l) => l.date === e.date))).map((e) => e.date),
        ...proposees.filter((l) => !datesAttendues.has(l.date)).map((l) => l.date),
      ]
      if (differentes.length > 0) defauts.push({ source: s, etat: 'a_reecrire', jour: premiere(differentes), lignes })
    }
  }
  return defauts.sort((a, b) => (a.jour < b.jour ? -1 : a.jour > b.jour ? 1 : 0)
    || ORDRE_DES_GENRES[a.source.source.genre] - ORDRE_DES_GENRES[b.source.source.genre]
    || (a.source.cle < b.source.cle ? -1 : a.source.cle > b.source.cle ? 1 : 0))
}

/** Les mots d'un refus de la base, chaque « % » remplacé dans l'ordre par sa valeur. */
export function motsDeLaBase(cle: CleRefusVentesFactureesDeLaValidation, valeurs: readonly (string | number)[]): string {
  const modele = REFUS_VENTES_FACTUREES_DE_LA_VALIDATION.find((r) => r.cle === cle)!.modele
  let i = 0
  return modele.replace(/%/g, () => String(valeurs[i++]))
}

// Ce qui suspend la validation d'un dossier basculé : ses ventes facturées pas encore revenues, lues en partie, ou des
// lectures qui ne se tiennent pas — entre elles (un état « sans objet » et l'autre non), ou avec le brouillon.
function ventesIllisibles(d: Pick<DonneesDeValidation, 'etatsDesVentes' | 'ventesDeLaChecklist'>): string | null {
  const e = d.etatsDesVentes
  const c = d.ventesDeLaChecklist
  if (e === null || c === null) return 'les ventes facturées ne sont pas encore lues'
  if (e.etat === 'incomplete' || e.etat === 'incoherent') return `les ventes facturées : ${e.motif}`
  if (c.etat === 'incomplete') return `les ventes facturées : ${c.motif}`
  if ((e.etat === 'sans_objet') !== (c.etat === 'sans_objet')) return 'les ventes facturées lues ne se tiennent pas entre elles'
  return null
}

const AU_PLUS = 6
const libelleDuMoyen = (moyen: string) => (MOYENS_ENCAISSEMENT.find((m) => m.moyen === moyen)?.libelle ?? moyen).toLowerCase()
function enumeration(noms: readonly string[]): string {
  const cites = noms.slice(0, AU_PLUS)
  return `${cites.join(' ; ')}${noms.length > cites.length ? ` ; et ${noms.length - cites.length} autre(s)` : ''}`
}

export function prealablesDeValidation(d: DonneesDeValidation): EtatDeValidation {
  const debut = `${d.annee}-01-01`
  const fin = `${d.annee}-12-31`
  const dansLExercice = (date: string | null | undefined) => !!date && date >= debut && date <= fin
  const ouverture = d.aNouveaux.length === 0 ? null : d.aNouveaux.map((a) => a.date).sort()[0]
  const anneeOuverture = ouverture ? anneeDe(ouverture) : null
  const prealables: PrealableDeValidation[] = []
  const bloque = (p: Omit<PrealableDeValidation, 'bloquant'>) => { if (p.nb === null || p.nb > 0) prealables.push({ ...p, bloquant: true }) }

  // ── Une lecture partielle d'abord : rien de ce qui suit ne vaudrait. ─────────────────────────────────────
  // Les factures sources non lues en entier en sont une : un exemplaire qu'on ne saurait pas reconnaître serait jugé comme
  // une pièce qui compte.
  // Les ventes facturées d'un dossier basculé aussi (étape VF7c) : sans elles, la numérotation laisserait leurs écritures
  // dehors, et les trois préalables qui les disent se tairaient.
  // La caisse pas encore revenue entière aussi (étape C3b) : sans ses opérations, ses écritures seraient « que rien ne
  // rattache », et ses préalables se tairaient.
  const lectureIncomplete = d.lectureIncomplete
    ?? (d.facturesSources === null ? 'les factures sources de leurs ventes ne sont pas lues en entier' : null)
    ?? ventesIllisibles(d)
    ?? (d.operationsDeCaisse === null ? 'la caisse du dossier n’est pas lue en entier' : null)
  if (lectureIncomplete !== null || d.facturesSources === null || d.etatsDesVentes === null || d.ventesDeLaChecklist === null
    || d.operationsDeCaisse === null) {
    prealables.push({
      id: 'lecture-partielle', nb: null, cible: 'cloture', bloquant: true,
      message: `La lecture du dossier est restée partielle (${lectureIncomplete}) : une validation ne se fait que sur tout le dossier. Recharger la page.`,
    })
    return { prealables, numerotation: null, report: null, validable: false }
  }
  const sources = d.facturesSources
  // Les états de la section « Ventes facturées » et ce que la Vue d'ensemble en dit, lus pour un dossier basculé ; rien
  // pour un autre (`ventesIllisibles` a écarté tout le reste).
  const etatsDesVentes = d.etatsDesVentes.etat === 'lus' ? d.etatsDesVentes : null
  const ventesDuReleve = d.ventesDeLaChecklist.etat === 'lue' ? d.ventesDeLaChecklist : null

  // ── Ce que la base refusera, avec ses mots. ─────────────────────────────────────────────────────────────
  const derniere = d.anneesValidees.length > 0 ? Math.max(...d.anneesValidees) : null
  if (d.annee >= d.anneeCourante) {
    bloque({ id: 'exercice-en-cours', nb: null, cible: 'cloture', message: `L'exercice ${d.annee} n'est pas terminé : il se valide une fois clos.` })
  }
  if (derniere !== null && d.annee <= derniere) {
    bloque({ id: 'deja-valide', nb: null, cible: 'cloture', message: `L'exercice ${d.annee} est déjà validé, ou un exercice postérieur l'est.` })
  } else if (derniere !== null && d.annee !== derniere + 1) {
    bloque({
      id: 'ordre', nb: null, cible: 'cloture', exercice: derniere + 1,
      message: `L'exercice ${derniere + 1} n'est pas validé : les exercices se valident dans l'ordre.`,
    })
  }
  if (anneeOuverture !== null && d.annee < anneeOuverture) {
    bloque({ id: 'avant-ouverture', nb: null, cible: 'cloture', message: `L'exercice ${d.annee} précède l'ouverture du dossier : il est dans les comptes repris.` })
  } else if (anneeOuverture !== null && anneeOuverture < d.annee && !d.anneesValidees.includes(anneeOuverture)) {
    bloque({
      id: 'ouverture-d-abord', nb: null, cible: 'cloture', exercice: anneeOuverture,
      message: `L'exercice ${anneeOuverture} porte les à-nouveaux du dossier : il se valide d'abord.`,
    })
  }
  const anterieures = d.ecritures.filter((e) => e.statut === 'proposee' && e.date < debut)
  const premiereAnterieure = anterieures.length > 0 ? Math.min(...anterieures.map((e) => anneeDe(e.date))) : null
  if (premiereAnterieure !== null) {
    const premiere = premiereAnterieure
    const avantOuverture = anneeOuverture !== null && premiere < anneeOuverture
    bloque({
      id: 'ecritures-anterieures', nb: null, cible: 'ecritures', detail: pluriel(anterieures.length, 'écriture concernée', 'écritures concernées'),
      // Avant l'ouverture, aucun exercice ne se valide : les écritures se retirent ou se redatent.
      ...(avantOuverture ? {} : { exercice: premiere }),
      message: avantOuverture
        ? "Des écritures antérieures à l'ouverture du dossier ne sont pas validées : cette période est dans les comptes repris, les retirer ou les redater avant la validation."
        : `L'exercice ${premiere} porte des écritures qui ne sont pas validées : les exercices se valident dans l'ordre.`,
    })
  }
  // LES MOUVEMENTS RÉSERVÉS À DES ENCAISSEMENTS DE FACTURES SOURCES (G2 ; étape VF7c) : la base les refuse AVANT les
  // mouvements à traiter, sous leur nom — ils ne se traitent que par leurs encaissements, un débit par ses
  // contre-passations. Ceux que la Vue d'ensemble compte (`ventesDeLaChecklist`, hors des exercices figés), datés jusqu'au
  // 31 décembre ; et les mouvements à traiter ne les comptent plus. Un dossier qui n'a pas basculé n'en a aucun.
  const dateDuMouvement = new Map(d.lignes.map((l) => [l.id, l.date]))
  const idsReserves = new Set((ventesDuReleve?.reserves ?? []).map((m) => m.id))
  // Un réservé que le relevé lu n'aurait pas — défensif : les deux lectures sont faites ensemble — se compte, sans date.
  const reserves = (ventesDuReleve?.reserves ?? [])
    .map((m) => ({ m, date: dateDuMouvement.get(m.id) ?? '' }))
    .filter((r) => r.date <= fin)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || (a.m.id < b.m.id ? -1 : a.m.id > b.m.id ? 1 : 0))
  if (reserves.length > 0) {
    const { m, date } = reserves[0]
    bloque({
      id: 'mouvements-reserves', nb: null, cible: 'banque',
      message: motsDeLaBase(m.montant >= 0 ? 'mouvement_reserve_credit' : 'mouvement_reserve_debit', [
        date === '' ? d.annee : anneeDe(date), formatDate(date || null), m.factures[0] ?? 'sans numéro',
      ]),
      detail: `${pluriel(reserves.length, 'mouvement concerné', 'mouvements concernés')} : ${enumeration(reserves.map((r) =>
        `le ${formatDate(r.date || null)}, ${formatMoney(r.m.montant)} (${r.m.factures.join(', ') || 'sans numéro'})`))}. Dans Banque, sa fiche le classe par ses encaissements.`,
    })
  }
  const aTraiter = d.lignes.filter((l) => l.statut === 'non_rapprochee' && l.date <= fin && !idsReserves.has(l.id))
  if (aTraiter.length > 0) {
    const premiere = Math.min(...aTraiter.map((l) => anneeDe(l.date)))
    bloque({
      id: 'mouvements-a-traiter', nb: null, cible: 'banque', detail: pluriel(aTraiter.length, 'mouvement concerné', 'mouvements concernés'),
      message: anneeOuverture !== null && premiere < anneeOuverture
        ? "Des mouvements bancaires antérieurs à l'ouverture du dossier restent à traiter : les ignorer avant la validation."
        : `L'exercice ${premiere} porte des mouvements bancaires à traiter : ils se traitent avant la validation.`,
    })
  }
  // UN ENCAISSEMENT PAR VIREMENT OU PAR PRÉLÈVEMENT SANS SON MOUVEMENT (étape VF7c) : encaissé à l'inscription au crédit, son
  // mouvement est de son exercice — il manque au relevé, ou n'y est pas rattaché. La base le refuse après les mouvements à
  // traiter ; un chèque, une carte ou un effet n'en est pas (un en-cours au 511, EC3-Q7), dit plus bas en avertissement.
  const sansMouvement = (ventesDuReleve?.sansMouvement ?? []).filter((e) => e.date_encaissement <= fin)
    .sort((a, b) => (a.date_encaissement < b.date_encaissement ? -1 : a.date_encaissement > b.date_encaissement ? 1 : 0)
      || (a.cree_le < b.cree_le ? -1 : a.cree_le > b.cree_le ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const numeroDeLaFacture = (factureId: string) => ventesDuReleve?.numeros.get(factureId) ?? 'sans numéro'
  const nomDeLEncaissement = (e: (typeof sansMouvement)[number]) =>
    `${numeroDeLaFacture(e.facture_id)} (${libelleDuMoyen(e.moyen)} du ${formatDate(e.date_encaissement)}, ${formatMoney(e.montant)})`
  const sansMouvementQuiRetient = sansMouvement.filter((e) => e.moyen === 'virement' || e.moyen === 'prelevement')
  if (sansMouvementQuiRetient.length > 0) {
    const e = sansMouvementQuiRetient[0]
    bloque({
      id: 'encaissements-sans-mouvement', nb: null, cible: 'banque',
      message: motsDeLaBase('encaissement_sans_mouvement', [
        anneeDe(e.date_encaissement), numeroDeLaFacture(e.facture_id),
        NOM_DU_MOYEN_SANS_MOUVEMENT[e.moyen as keyof typeof NOM_DU_MOYEN_SANS_MOUVEMENT], formatDate(e.date_encaissement),
      ]),
      detail: `${pluriel(sansMouvementQuiRetient.length, 'encaissement concerné', 'encaissements concernés')} : `
        + `${enumeration(sansMouvementQuiRetient.map(nomDeLEncaissement))}. Le crédit qui le porte se rattache depuis sa fiche, dans `
        + 'Banque — remis d’abord à traiter s’il a été ignoré. Un virement reçu sur un compte bancaire que le dossier ne suit '
        + 'pas s’enregistre par le moyen « autre », sur le compte de contrepartie de ce compte.',
    })
  }
  // UNE VENTE FACTURÉE QUI N'EST PAS ÉCRITE À JOUR (étape VF7c) : à écrire, à réécrire, à retirer, ou qui ne s'écrit pas —
  // jusqu'au 31 décembre, de la frontière, comme la base la juge ; chacune nommée, la première sous les mots de la base.
  const ventesEnDefaut = etatsDesVentes === null ? [] : ventesFactureesEnDefaut(etatsDesVentes.sources, fin, frontiereDeValidation(d.anneesValidees))
  if (ventesEnDefaut.length > 0) {
    const v = ventesEnDefaut[0]
    bloque({
      id: 'ventes-facturees-a-ecrire', nb: null, cible: 'ecritures',
      message: motsDeLaBase(v.etat, [anneeDe(v.jour), v.source.nom]),
      detail: `${pluriel(ventesEnDefaut.length, 'vente facturée concernée', 'ventes facturées concernées')} : `
        + `${enumeration(ventesEnDefaut.map((x) => `${x.source.nom} (${LIBELLE_ETAT_SOURCE[x.etat]})`))}. Dans Écritures, la `
        + 'section « Ventes facturées » écrit, réécrit ou retire chacune d’un clic, et dit ce qui retient celle qui ne s’écrit pas.',
    })
  }
  const paiements = paiementsDesPieces(d.lignes, d.reglements, d.encaissees)
  // Le premier exercice qui porte quelque chose, quand rien ne le fige encore — et que les écritures
  // antérieures ne l'ont pas déjà nommé.
  if (derniere === null && anneeOuverture === null) {
    const premiere = Math.min(...[...anneesActives(d, paiements)].filter((a) => a < d.annee))
    if (Number.isFinite(premiere) && premiere !== premiereAnterieure) {
      bloque({
        id: 'exercice-anterieur-d-abord', nb: null, cible: 'cloture', exercice: premiere,
        message: `L'exercice ${premiere} porte déjà des pièces, des mouvements ou des écritures : il se valide d'abord. Valider ${d.annee} le figerait sans qu'il l'ait été.`,
      })
    }
  }

  // ── Ce qui resterait en suspens. ──────────────────────────────────────────────────────────────────────
  // Une pièce à valider de l'exercice : validée ensuite, son écriture ne pourrait plus s'y passer. Avant
  // l'ouverture d'un dossier repris, la période est dans les comptes repris : rien ne s'y écrit de toute façon.
  const dansLaPeriodeTenue = (date: string | null) => dansLExercice(date) && (ouverture === null || date! >= ouverture)
  bloque({
    id: 'pieces-a-valider', nb: d.piecesAValider.filter((p) => dansLaPeriodeTenue(p.date_piece)).length, cible: 'pieces',
    message: `pièce(s) à valider datée(s) de l'exercice ${d.annee} : les valider, ou les retirer, avant la validation — ensuite, leur écriture ne pourrait plus s'y passer.`,
  })
  // Une pièce sans date appartient peut-être à cet exercice : on ne fige pas un exercice qu'elle pourrait compléter.
  bloque({
    id: 'pieces-sans-date', nb: [...d.piecesValidees, ...d.piecesAValider].filter((p) => !p.date_piece).length, cible: 'pieces',
    message: "pièce(s) sans date : elles appartiennent peut-être à cet exercice. Les dater avant la validation.",
    detail: "Dans Justificatifs, le filtre « Sans date » les montre.",
  })
  // Une date impossible cache la vraie, qui peut être dans cet exercice.
  bloque({
    id: 'date-impossible', nb: piecesADateImpossible([...d.piecesValidees, ...d.piecesAValider]).length, cible: 'pieces',
    message: "pièce(s) datée(s) après leur dépôt : leur vraie date est peut-être dans cet exercice. Les corriger avant la validation.",
    detail: "Choisir « toutes les années » dans l'en-tête du dossier pour les voir : elles portent le badge « Date impossible ».",
  })

  // ── La numérotation de l'exercice : celle que la validation enverra. ────────────────────────────────────
  const ecrituresDeLExercice = d.ecritures.filter((e) => dansLExercice(e.date))
  // AVEC LES VENTES FACTURÉES d'un dossier basculé (étape VF7c) : la composition même de la section « Ventes facturées »,
  // et chaque ligne qui la porte telle quelle (`rattachementDesVentes`) prend le journal, la pièce et l'auxiliaire du FEC —
  // le FEC d'après la validation est celui d'avant, ValidDate près. Une ligne qui ne la porte plus reste hors de la
  // numérotation, comme la base la refuserait ; elle se dit sous `ventes-facturees-a-ecrire`, qui nomme sa source, et non
  // parmi les écritures que rien ne rattache. Un dossier qui n'a pas basculé n'a aucune composition : rien ne change.
  // Et les opérations de la caisse (étape C3b) : chacune fait son écriture, au journal de son genre (CAISSE-Q3, (A)), la
  // pièce le récapitulatif de son jour — celle que la validation fige. La caisse absente n'en numérote aucune.
  const numerotation = numeroterFec(
    ecrituresDeLExercice, d.piecesValidees, [...d.categories], ouvertureDeLExercice(d.aNouveaux, d.soldesReportes, d.annee),
    d.modele.mode, d.lignes, etatsDesVentes?.contexte.composition.ecritures ?? [], d.operationsDeCaisse,
  )
  // Les lignes que `ventes-facturees-a-ecrire` nomme — à réécrire ou à retirer —, et elles seules : une ligne d'une vente
  // facturée qu'aucune source en défaut ne porterait (défensif) reste une écriture que rien ne rattache.
  const lignesDesVentesEnDefaut = new Set(ventesEnDefaut.flatMap((v) => v.lignes))
  bloque({
    id: 'ecritures-orphelines', nb: numerotation.horsFec.filter((e) => !lignesDesVentesEnDefaut.has(e.id)).length, cible: 'ecritures',
    message: "écriture(s) que rien ne rattache — ni pièce, ni mouvement, ni bien, ni véhicule, ni déclaration de TVA (le reste d'une pièce supprimée) : les retirer avant la validation.",
  })
  const defauts = defautsDeNumerotation(numerotation)
  const desequilibres = defauts.filter((x) => x.type === 'desequilibre')
  bloque({
    id: 'ecritures-desequilibrees', nb: desequilibres.length, cible: d.modele.mode === 'tresorerie' ? 'banque' : 'ecritures',
    message: d.modele.mode === 'tresorerie'
      ? "écriture(s) déséquilibrée(s) — le plus souvent une pièce dont le paiement n'est pas rapproché : rapprocher son paiement, ou la régénérer."
      : "écriture(s) déséquilibrée(s) : les régénérer avant la validation.",
    detail: desequilibres.slice(0, 5).map((x) => x.type === 'desequilibre'
      ? `${x.pieceRef} (écart de ${(Math.abs(x.ecartCentimes) / 100).toFixed(2).replace('.', ',')} €)` : '').join(' ; ') || undefined,
  })
  bloque({
    id: 'numerotation', nb: defauts.length - desequilibres.length, cible: 'ecritures',
    message: "défaut(s) de numérotation que la base refuserait : un compte qui porte deux libellés, des numéros qui ne se suivent pas, ou une écriture à deux pièces ou à deux dates. Signaler ce cas : il ne devrait pas se produire.",
  })

  // ── L'ouverture de l'exercice suivant, que la validation écrit dans le même clic (ligne 34). ────────────────────
  // La base la calcule sur l'exercice validé (`soldes_a_reporter`) et refuse deux choses, dites ici avec ses mots : un
  // compte qui n'est ni de bilan ni de résultat et porte un solde — il ne se reporterait pas —, et une ouverture qui ne
  // s'équilibre pas. Celle-ci ne se dit pas à côté d'une écriture déséquilibrée, qui en est la cause et se dit déjà ;
  // seule, elle ne peut venir que d'une ouverture de l'exercice elle-même déséquilibrée (défensif : la reprise et le
  // report de l'exercice précédent sont refusés déséquilibrés).
  const report = soldesAReporter(mouvementsDeCloture(numerotation), d.modele, d.annee)
  bloque({
    id: 'report-hors-classes', nb: report.horsClasses.length, cible: 'ecritures',
    message: `compte(s) qui ne sont ni de bilan ni de résultat portent un solde à la fin de l'exercice ${d.annee} : il ne se reporterait pas sur l'exercice suivant. Corriger leurs écritures — le compte de leur catégorie — avant la validation.`,
    detail: report.horsClasses.length > 0 ? `Comptes : ${report.horsClasses.join(', ')}.` : undefined,
  })
  if (report.ecartCentimes !== 0 && desequilibres.length === 0) {
    bloque({
      id: 'report-desequilibre', nb: null, cible: 'ecritures',
      message: `Les soldes de l'exercice ${d.annee} ne s'équilibrent pas, à-nouveaux compris : l'ouverture de l'exercice suivant ne peut pas s'écrire.`,
      detail: `Écart de ${(Math.abs(report.ecartCentimes) / 100).toFixed(2).replace('.', ',')} € entre les débits et les crédits.`,
    })
  }

  // ── L'ouverture de l'exercice, confrontée à la clôture du précédent (O33-Q1). ─────────────────────────────────
  // Le calcul de l'onglet Bilan, sur ses entrées, toutes lues en entier (une lecture partielle s'est arrêtée plus haut,
  // et l'onglet ne confronte rien sur une lecture partielle non plus) : tout le brouillon, les catégories, la reprise,
  // les soldes reportés, les exercices validés, les pièces des deux piles (leur tiers) et le modèle. Sans confrontation
  // — premier exercice, ouverture par une balance reprise (O33-Q2, plus tard), ouverture qui attend la validation du
  // précédent (l'ordre la refuse déjà) —, rien ne se retient et rien ne se dit : ni écart, ni « concorde ».
  const confrontation = confronterLOuverture({
    exercice: d.annee, ecritures: d.ecritures, categories: d.categories, reprise: d.aNouveaux, reportes: d.soldesReportes,
    anneesValidees: d.anneesValidees, pieces: [...d.piecesValidees, ...d.piecesAValider], modele: d.modele,
    aujourdHui: d.aujourdHui,
  }, 'complete')
  if (confrontation.etat === 'ecarts') {
    bloque({ id: 'ouverture-en-ecart', nb: null, cible: 'bilan', ...ouvertureEnEcart(confrontation) })
  }

  // ── La 2035 et les écritures (trésorerie). ──────────────────────────────────────────────────────────────
  // UNE 2035 VALIDÉE EST CELLE QUE LA BASE GARDE (lib/validationExercice.ts), et les cartes de Clôture qui disent ce
  // qu'elle a de faux se taisent une fois l'exercice validé — ce qu'elles demandent, la base le refuserait. Ce qu'elles
  // signalent se refuse donc ICI, avant, ou se lit : chaque carte de Clôture est reprise ou écartée avec sa raison
  // (`CARTES_DE_CLOTURE`, en fin de fichier). Les cartes sont au-dessus de celle de la validation, sur le même écran.
  if (d.declaration) {
    const e = d.declaration.exclusions
    bloque({
      id: 'concordance', nb: d.concordance ? d.concordance.ecarts.length : 0, cible: 'cloture',
      message: "écart(s) entre la 2035 et les écritures : la validation attend une concordance au centime. Le détail est dans la carte « Concordance avec les écritures » ci-dessus.",
    })
    // LES RECETTES DE CAISSE QUE LA 2035 NE COMPTE PAS (étape C3b ; la carte « Recettes de caisse absentes du
    // récapitulatif », étape C3a) : une catégorie sans poste, ou qui n'est plus un produit. Leur écriture est passée avec
    // l'opération, et la concordance les dit aussi en écart ; ici, elles sont nommées comme ce qu'elles sont. Sans recette
    // de caisse exclue — la caisse absente, ou toutes comptées —, le préalable est celui d'hier, au caractère près.
    const recettesDeCaisseExclues = e.recettesDeCaisseSansPoste.length + e.recettesDeCaisseSansProduit.length
    bloque({
      id: 'exclusions-2035',
      nb: e.sansPoste.length + e.sansMontant.length + e.mouvementsSansPoste.length + e.mouvementsHorsResultat.length + e.fraisSansPoste.length
        + recettesDeCaisseExclues,
      cible: 'cloture',
      message: recettesDeCaisseExclues === 0
        ? "pièce(s) ou mouvement(s) que la 2035 ne compte pas (sans poste, sans montant, un compte sorti des comptes de résultat, ou les frais d'un mouvement d'encaissements sans poste) : les compléter avant la validation."
        : "pièce(s), mouvement(s) ou recette(s) en espèces de la caisse que la 2035 ne compte pas (sans poste, sans montant, un compte sorti des comptes de résultat, les frais d'un mouvement d'encaissements sans poste, ou une recette de caisse dont la catégorie n'a pas de poste ou n'est plus un produit) : les compléter avant la validation — une recette de caisse sous une catégorie qui n'est plus un produit se retire et se saisit de nouveau.",
      ...(recettesDeCaisseExclues === 0 ? {} : {
        detail: `Dont ${pluriel(recettesDeCaisseExclues, 'recette de caisse', 'recettes de caisse')} : la carte « Recettes de caisse absentes du récapitulatif » ci-dessus les nomme.`,
      }),
    })
    // Un poste qu'aucune case ne porte : son montant est compté, et n'apparaît nulle part sur le formulaire — la 2035
    // validée serait fausse de ce montant, et ses totaux aussi. Une recette sous un libellé de dépense (ou l'inverse) en
    // est : la case de ce libellé la refuse, et la ligne se corrige par le poste de sa catégorie, ou en changeant de
    // catégorie la pièce rangée à contresens.
    bloque({
      id: 'postes-sans-case', nb: valeursDesCases(d.declaration).postesSansCase.length, cible: 'cloture',
      message: "poste(s) de la 2035 qu'aucune case du formulaire ne porte — leur montant n'y paraîtrait pas : donner à leur catégorie un poste du formulaire, ou changer de catégorie une pièce rangée à contresens (carte « Postes sans case du formulaire » ci-dessus).",
    })
    // Le formulaire n'admet pas de montant négatif : une case que des avoirs ou des remboursements font passer sous zéro
    // ne se dépose pas telle quelle.
    bloque({
      id: 'cases-negatives', nb: casesNegatives(d.declaration).length, cible: 'cloture',
      message: "case(s) négative(s) de la 2035 — des avoirs ou des remboursements y dépassent ce que la case compte, et le formulaire n'admet pas de montant négatif : arbitrer leur place avant la validation (carte « Case négative » ci-dessus).",
    })
    // Le barème kilométrique et les frais au réel du véhicule dans la même case BJ : la même dépense deux fois.
    bloque({
      id: 'frais-vehicule-en-double', nb: doublonFraisVehicules(d.declaration)?.postes.length ?? 0, cible: 'cloture',
      message: "poste(s) de frais de véhicule au réel à côté du barème kilométrique : la même dépense compterait deux fois en case BJ. Retirer l'un ou l'autre avant la validation (carte « Frais de véhicule comptés deux fois » ci-dessus).",
    })
  }

  // ── Les anomalies du brouillon, ramenées à l'exercice — les points en erreur de la Checklist. ───────────
  const ouvertureDate = ouverture
  const acquisitions = acquisitionsDesBiens(d.immobilisations, d.natures, ouvertureDate)
  const pieceIdsImmobilisees = new Set(acquisitions.keys())
  const ecrituresParPiece = new Map<string, EcritureBrouillon[]>()
  for (const e of d.ecritures) if (e.piece_id) ecrituresParPiece.set(e.piece_id, [...(ecrituresParPiece.get(e.piece_id) ?? []), e])
  // Une pièce concerne l'exercice si l'une de ses écritures y est datée, ou si l'une de celles qu'elle doit
  // produire y tombera.
  const pieceDeLExercice = (p: Piece) =>
    (ecrituresParPiece.get(p.id) ?? []).some((e) => dansLExercice(e.date))
    || datesDesEcrituresAttendues(p, paiements, d.modele).some(dansLExercice)
  const mouvementDeLExercice = (l: { date: string }) => dansLExercice(l.date)

  // Ce que les exercices déjà validés ont figé ne se compare plus (lib/validationExercice.ts) : une pièce payée dans
  // l'exercice à valider mais facturée dans le précédent n'est jugée que sur sa part encore ouverte.
  const frontiere = frontiereDeValidation(d.anneesValidees)
  // Ni l'écriture, ni la catégorie, ni la conversion, ni la TVA, ni le paiement de l'exemplaire d'une facture source (étape
  // VF6a) : sa facture compte la vente. Son écriture déjà passée, elle, est sans objet — et refusée comme telle.
  const aComptabiliser = piecesAComptabiliser([...d.piecesValidees], [...d.categories], acquisitions, sources)
  const validesQuiComptent = horsDesExemplairesDesSources(d.piecesValidees, sources)
  const { piecesDesynchronisees } = analyserEcritures(
    [...d.ecritures], aComptabiliser, d.assujettiTva, paiements, d.modele, frontiere, exemplairesDesSources(d.piecesValidees, sources),
  )
  bloque({
    id: 'ecritures-a-generer', cible: 'ecritures',
    nb: aComptabiliser.filter(({ piece }) => !ecrituresParPiece.has(piece.id) && pieceDeLExercice(piece)).length,
    message: "pièce(s) validée(s) de l'exercice sans écriture : générer leurs écritures avant la validation.",
  })
  bloque({
    id: 'desynchronisees', nb: piecesDesynchronisees.filter(pieceDeLExercice).length, cible: 'ecritures',
    message: "écriture(s) à régénérer (pièce modifiée depuis) : les régénérer avant la validation.",
  })
  bloque({
    id: 'ecritures-sans-objet', cible: 'ecritures',
    nb: ecrituresSansObjet([...d.ecritures], [...d.piecesValidees], [...d.categories], acquisitions, frontiere, d.modele.plan, sources)
      .filter((s) => (ecrituresParPiece.get(s.piece.id) ?? []).some((e) => dansLExercice(e.date))).length,
    message: "écriture(s) que la pièce ne justifie plus : retirer l'écriture ou corriger la pièce.",
  })
  bloque({
    id: 'sans-categorie', nb: piecesValideesSansCategorie([...d.piecesValidees], pieceIdsImmobilisees, sources).filter(pieceDeLExercice).length, cible: 'pieces',
    message: "pièce(s) validée(s) de l'exercice sans catégorie — invisibles en comptabilité : les catégoriser.",
  })
  bloque({
    id: 'devise-non-convertie', nb: piecesDeviseNonConvertie([...d.piecesValidees], sources).filter(pieceDeLExercice).length, cible: 'pieces',
    message: "pièce(s) en devise étrangère non converties en euros : les convertir.",
  })
  bloque({
    id: 'tva-impossible', nb: piecesTvaImpossible(validesQuiComptent).filter((t) => pieceDeLExercice(t.piece)).length, cible: 'pieces',
    message: "pièce(s) dont la TVA est arithmétiquement impossible : corriger leurs montants.",
  })
  bloque({
    id: 'mois-en-double', cible: 'pieces',
    nb: moisEnDoubleSurAbonnement([...d.piecesValidees, ...d.piecesAValider])
      .filter((m) => anneeDe(`${m.mois}-01`) === d.annee || anneeDe(`${m.moisProbable}-01`) === d.annee).length,
    message: "mois d'abonnement en double, avec un mois voisin vide — une pièce mal datée ou en double : vérifier ces pièces.",
  })
  if (d.doublonsTexte === null) {
    prealables.push({
      id: 'doublons-inconnus', nb: null, cible: 'pieces', bloquant: true,
      message: "Les doublons de contenu n'ont pas pu être vérifiés : réessayer avant la validation.",
    })
  } else {
    const piecesDuDossier = new Map([...d.piecesValidees, ...d.piecesAValider].map((p) => [p.id, p]))
    bloque({
      id: 'doublon-texte', cible: 'pieces',
      nb: d.doublonsTexte.filter((g) => g.pieceIds.some((id) => {
        const p = piecesDuDossier.get(id)
        return !!p && (dansLExercice(p.date_piece) || pieceDeLExercice(p))
      })).length,
      message: "pièce(s) déposée(s) plusieurs fois sous des fichiers différents : retirer le doublon.",
    })
  }
  // LA MÊME VENTE PORTÉE PAR PLUSIEURS PIÈCES (ligne 28.6) : sur les deux piles, comme la Checklist ; de l'exercice
  // quand l'une de ses pièces l'est. En trésorerie, la pièce restée sans paiement serait aussi refusée par ses écritures ;
  // en engagement, chacune s'écrit à sa date, équilibrée, et rien d'autre ne la voit. PAR RÉGIME (étape VF6e), comme la
  // Checklist : une facture source compte sa vente elle-même, et c'est une pièce VALIDÉE qui n'est pas son exemplaire qui la
  // compte une seconde fois ; deux exemplaires désignés d'une facture source ne comptent ni l'un ni l'autre.
  const piecesDesDeuxPiles = new Map([...d.piecesValidees, ...d.piecesAValider].map((p) => [p.id, p]))
  bloque({
    id: 'ventes-en-double', cible: 'pieces',
    nb: ventesEnDouble(
      d.facturesEmises, jumellesDuDossier(d.facturesEmises, d.transmissions, [...piecesDesDeuxPiles.values()]), sources,
      [...piecesDesDeuxPiles.values()],
    )
      .filter((v) => v.pieceIds.some((id) => {
        const p = piecesDesDeuxPiles.get(id)
        return !!p && (dansLExercice(p.date_piece) || pieceDeLExercice(p))
      })).length,
    message: "vente(s) portée(s) par plusieurs pièces — la même facture émise comptée plusieurs fois : n'en garder qu'une.",
  })
  if (d.relevesIncoherents === null) {
    prealables.push({
      id: 'releves-inconnus', nb: null, cible: 'banque', bloquant: true,
      message: "Le contrôle des relevés bancaires n'a pas pu être lu : réessayer avant la validation.",
    })
  } else {
    // Un relevé sans période connue peut couvrir l'exercice : il compte.
    bloque({
      id: 'releve-incoherent', cible: 'banque',
      nb: d.relevesIncoherents.filter((r) => !r.coherent
        && (r.periode_debut === null || r.periode_fin === null || (r.periode_debut <= fin && r.periode_fin >= debut))).length,
      message: "relevé(s) bancaire(s) de l'exercice qui ne bouclent pas — des mouvements manquent : les compléter.",
    })
  }

  const affectes = mouvementsAffectes(d.lignes, d.categories, d.assujettiTva)
  bloque({
    id: 'affectes-perimes', nb: mouvementsAffectesDesynchronises(d.ecritures, affectes, frontiere, d.modele.plan).filter((a) => mouvementDeLExercice(a.ligne)).length, cible: 'ecritures',
    message: "mouvement(s) affecté(s) dont l'écriture ne suit plus la catégorie : les réaffecter.",
  })
  bloque({
    id: 'recettes-affectees-assujetti', cible: 'banque',
    nb: recettesAffecteesSansTaux(affectes, d.assujettiTva, frontiere).filter((a) => mouvementDeLExercice(a.ligne)).length
      + recettesVentileesSansTaux(partsDesVentilations(d.lignes, d.ventilations, d.categories, d.assujettiTva), d.assujettiTva, frontiere)
        .filter(mouvementDeLExercice).length,
    message: "encaissement(s) affecté(s) ou ventilé(s) en recette sans taux de TVA, sur un dossier assujetti : choisir leur taux.",
  })
  bloque({
    id: 'ventiles-perimes', cible: 'ecritures',
    nb: mouvementsVentilesDesynchronises(d.ecritures, d.lignes, d.ventilations, d.categories, d.modele, d.assujettiTva, frontiere).filter(mouvementDeLExercice).length,
    message: "mouvement(s) ventilé(s) dont l'écriture ne suit plus les parts : les réécrire.",
  })
  bloque({
    id: 'ventilations-incoherentes', nb: ventilationsIncoherentes(d.lignes, d.ventilations).filter((v) => mouvementDeLExercice(v.ligne)).length, cible: 'banque',
    message: "mouvement(s) ventilé(s) dont les parts ne font plus le mouvement : modifier ou annuler ces ventilations.",
  })
  bloque({
    id: 'comptes-de-bilan-perimes', nb: mouvementsSurUnCompteDeBilanDesynchronises(d.ecritures, d.lignes, frontiere, d.modele.plan).filter(mouvementDeLExercice).length,
    cible: 'ecritures',
    message: "mouvement(s) écrit(s) sur un compte de bilan dont l'écriture ne suit plus le compte : les réécrire.",
  })
  // LA TVA LIQUIDÉE (lib/liquidationTva.ts) : la liquidation d'une déclaration s'écrit avec elle, son paiement et son
  // remboursement avec leur rapprochement — la base les écrit ensemble. Une écriture qui ne suit plus (défensif) se refuse
  // comme toute écriture en anomalie : validée, elle le resterait. La liquidation compte dans l'exercice où finit sa
  // période, le paiement dans celui de son mouvement.
  bloque({
    id: 'liquidations-tva-perimees', cible: 'ecritures',
    nb: liquidationsDesynchronisees(d.ecritures, d.declarationsTva.filter((x) => dansLExercice(x.periode_fin)), frontiere, d.modele.plan).length,
    message: "déclaration(s) de TVA de l'exercice dont l'écriture de liquidation manque ou ne suit plus la déclaration : la réécrire.",
  })
  bloque({
    id: 'paiements-tva-perimes', cible: 'ecritures',
    nb: paiementsTvaDesynchronises(d.ecritures, d.lignes, frontiere, d.modele.plan).filter(mouvementDeLExercice).length,
    message: "paiement(s) ou remboursement(s) de TVA dont l'écriture ne suit plus le mouvement : les réécrire.",
  })
  bloque({
    id: 'virements-sans-ecriture', nb: virementsPersonnelsAEcrire(d.ecritures, d.lignes, d.modele, frontiere).filter(mouvementDeLExercice).length, cible: 'virements',
    message: "virement(s) personnel(s) sans écriture — absents du FEC : les écrire.",
  })
  bloque({
    id: 'echeances-emprunt-perimees', nb: echeancesDesynchronisees(d.ecritures, d.lignes, d.modele.plan).filter(mouvementDeLExercice).length, cible: 'banque',
    message: "échéance(s) d'emprunt dont l'écriture ne suit plus le découpage : les rapprocher de nouveau.",
  })
  bloque({
    id: 'cotisations-sans-ecriture', nb: cotisationsAEcrire(d.ecritures, d.lignes, d.cotisations, d.modele.mode, frontiere, d.modele.plan).filter((c) => mouvementDeLExercice(c.ligne)).length,
    cible: 'cotisations',
    message: "échéance(s) de cotisation payée(s) dont l'écriture manque ou n'est plus à jour : les écrire.",
  })
  bloque({
    id: 'cotisations-rapprochement-refuse', cible: 'banque',
    nb: rapprochementsCotisationRefuses(d.lignes, d.cotisations, d.modele.mode, frontiere).filter((c) => mouvementDeLExercice(c.ligne)).length,
    message: "rapprochement(s) d'une échéance de cotisation qui ne peuvent pas s'écrire : les annuler.",
  })
  // LES PAIEMENTS DEPUIS LE COMPTE PERSONNEL (lib/cotisationPersonnelle.ts) : la base écrit le paiement et son écriture
  // ensemble et fige les montants de l'échéance tant qu'il tient — ce préalable est DÉFENSIF, et il vaut dans les deux
  // modèles : en engagement, aucune concordance ne verrait une écriture qui manque. Un paiement compte dans l'exercice
  // de sa date, celle de son écriture.
  bloque({
    id: 'paiements-personnels-a-reprendre', cible: 'cotisations',
    nb: paiementsPersonnelsAReprendre(d.ecritures, d.cotisations, d.modele, frontiere)
      .filter((p) => dansLExercice(p.cotisation.paiement_personnel_le)).length,
    message: "échéance(s) de cotisation payée(s) depuis le compte personnel dont l'écriture manque, ne suit plus l'échéance ou ne peut pas s'écrire : retirer le paiement, puis le déclarer de nouveau.",
  })
  // ── LA CAISSE (ligne 26.6, étape C3b ; lib/controlesDeLaCaisse.ts ; conception, § 4 et § 5). ─────────────────────────────
  // Trois préalables BLOQUANTS, que la base ne refuse pas — `valider_exercice` fige les écritures de la caisse avec les autres,
  // sans rien savoir d'elle : ce qu'ils signalent, validé, le resterait. Ils regardent l'exercice, hors des exercices figés.
  // La caisse absente (le drapeau baissé) n'a aucune opération : aucun ne se dit, et rien de plus n'est calculé. Ils mènent à
  // l'onglet Caisse (étape C4), qui retire l'opération et la saisit de nouveau, et leur détail nomme chaque opération.
  const operationsDeLaCaisse = operationsDe(d.operationsDeCaisse)
  if (operationsDeLaCaisse.length > 0) {
    const dossierDeLaCaisse = {
      modele: d.modele, assujettiTva: d.assujettiTva, categories: d.categories, ecritures: d.ecritures, frontiere,
      ouvertures: d.aNouveaux, mouvements: d.lignes,
      // Les espèces des factures d'un dossier basculé : le registre et ses factures, sur la lecture même des ventes facturées
      // (lues en entier : `ventesIllisibles` a suspendu tout le reste). Aucune pour un autre dossier : aucune facture source.
      especes: (etatsDesVentes === null ? { etat: 'sans_objet' } : {
        etat: 'lues', encaissements: etatsDesVentes.contexte.encaissements, factures: etatsDesVentes.contexte.factures,
      }) satisfies EspecesDesFactures,
    }
    // UNE OPÉRATION DONT L'ÉCRITURE MANQUE OU NE SUIT PLUS SA COMPOSITION — un plan ou un statut de TVA changé depuis la saisie,
    // une restauration : défensif, la base écrivant l'une avec l'autre. Validée, l'écriture fausse le resterait.
    const aReprendre = operationsDeCaisseAReprendre(operationsDeLaCaisse, dossierDeLaCaisse).filter((x) => dansLExercice(x.date))
    bloque({
      id: 'caisse-a-reprendre', nb: aReprendre.length, cible: 'caisse',
      message: "opération(s) de caisse de l'exercice dont l'écriture manque, ne suit plus l'opération ou ne peut plus s'écrire — un plan ou un statut de TVA changé depuis la saisie : retirer l'opération et la saisir de nouveau avant la validation.",
      detail: aReprendre.length > 0 ? detailDesOperationsAReprendre(aReprendre) : undefined,
    })
    const etatDeLaCaisse = etatDeLaCaisseLue(operationsDeLaCaisse, dossierDeLaCaisse)!
    // UNE CAISSE LUE NÉGATIVE (PCG, art. 1215-53 : son solde est débiteur ou nul) : défensif, la base refusant toute écriture
    // qui la rendrait négative — seule une restauration d'un état fautif la laisserait ainsi. Son premier jour négatif, s'il
    // tombe dans l'exercice ou avant lui sans être figé : validé, il le resterait.
    const negative = caisseNegative(etatDeLaCaisse, frontiere)
    if (negative !== null && negative.jour <= fin) {
      bloque({
        id: 'caisse-negative', nb: null, cible: 'caisse',
        message: `La caisse est négative le ${caisseNegativeDite(negative)} : son solde est débiteur ou nul. Saisir les recettes en espèces qui manquent, ou retirer la sortie d'espèces qui la vide, avant la validation.`,
      })
    }
    // UNE RECETTE DONT LE JOUR A CHANGÉ DEPUIS SA SAISIE (CAISSE-Q2, (A)) : un encaissement en espèces d'une facture, de son
    // jour, enregistré, retiré ou rattaché depuis — son total compte peut-être deux fois les espèces de la facture, ou en
    // oublie. Levé en retirant la recette et en la saisissant de nouveau, sur le jour tel qu'il est.
    const aRevoir = recettesDeCaisseARevoir(operationsDeLaCaisse, etatDeLaCaisse, frontiere).filter((r) => dansLExercice(r.operation.date))
    bloque({
      id: 'recettes-de-caisse-a-revoir', nb: aRevoir.length, cible: 'caisse',
      message: "recette(s) en espèces de l'exercice dont le jour a changé depuis la saisie — un encaissement en espèces d'une facture de ce jour enregistré, retiré ou rattaché depuis : vérifier que leur total ne compte pas les espèces de la facture, puis les retirer et les saisir de nouveau avant la validation.",
      detail: aRevoir.length > 0 ? detailDesRecettesARevoir(aRevoir, etatDeLaCaisse) : undefined,
    })
  }
  bloque({
    id: 'rapproches-sans-objet', nb: mouvementsRapprochesSansObjet([...d.lignes]).filter(mouvementDeLExercice).length, cible: 'banque',
    message: "mouvement(s) bancaire(s) rapproché(s) sans justificatif : annuler ou refaire ces rapprochements.",
  })
  bloque({
    id: 'reglements-groupes-incoherents', cible: 'banque',
    nb: new Set(reglementsGroupesIncoherents(d.lignes, d.reglements).filter((r) => mouvementDeLExercice(r.ligne)).map((r) => r.ligne.id)).size,
    message: "virement(s) groupé(s) dont une part ne justifie plus rien ou dont les parts ne font plus le mouvement : les régler de nouveau ou les annuler.",
  })
  // Ni l'exemplaire d'une facture source (étape VF6e) : il ne se règle pas, sa facture s'encaisse.
  bloque({
    id: 'pieces-payees-en-trop', cible: 'banque',
    nb: piecesPayeesEnTrop(validesQuiComptent, paiements).filter((p) => pieceDeLExercice(p.piece)).length,
    message: "pièce(s) payée(s) plus que leur montant — un paiement en double ? Annuler le paiement en trop.",
  })
  // Jugé sur le TOTAL payé de chaque pièce, jamais mouvement par mouvement (lib/controles.ts) : une facture réglée
  // en deux fois n'a rien à reprendre. En trésorerie seulement — en engagement, le reste court au 401 ou au 411.
  bloque({
    id: 'pieces-payees-en-partie', cible: 'banque',
    nb: piecesPayeesEnPartie(validesQuiComptent, paiements, d.modele.mode).filter((x) => pieceDeLExercice(x.piece)).length,
    message: "pièce(s) payée(s) en partie — leur écriture reste déséquilibrée : rapprocher le paiement qui manque, ou vérifier le montant de la pièce.",
  })
  // Un bien dont le justificatif a disparu, s'il s'amortit dans l'exercice : sa dotation partirait sans pièce.
  bloque({
    id: 'immos-sans-justificatif', cible: 'immobilisations',
    nb: immobilisationsSansJustificatif([...d.immobilisations])
      .filter((i) => dotationDeLExercice(i, d.annee) > 0 || d.ecritures.some((e) => e.immobilisation_id === i.id && dansLExercice(e.date))).length,
    message: "immobilisation(s) dont le justificatif a été supprimé : retrouver le justificatif ou retirer le bien.",
  })
  bloque({
    id: 'dotations-a-ecrire', cible: 'immobilisations',
    nb: dotationsEnDefaut(dotationsDuRegistre(d.immobilisations, d.natures, d.ecritures, ouvertureDate, d.anneeCourante, frontiere, d.modele.plan), d.anneeCourante)
      .filter((x) => x.annee === d.annee).length,
    message: "dotation(s) aux amortissements de l'exercice à écrire, ou qui ne suivent plus le registre : les écrire.",
  })
  // Un forfait que le barème ne sait pas calculer (puissance hors barème, kilométrage invalide) en est : la 2035 n'en
  // compte rien non plus (la carte « Véhicules absents de la case BJ » de Clôture), et c'est la ligne du cadre 7 qui se
  // corrige.
  bloque({
    id: 'forfaits-a-ecrire', cible: 'informations',
    nb: forfaitsEnDefaut(forfaitsDuCadre7(d.vehicules, d.ecritures, d.modele, ouvertureDate, d.anneeCourante, frontiere), d.anneeCourante)
      .filter((f) => f.vehicule.annee === d.annee).length,
    message: "forfait(s) kilométrique(s) de l'exercice à écrire, qui ne suivent plus le cadre 7, ou que le barème ne sait pas calculer — la ligne du cadre 7 est alors à corriger : les écrire.",
  })

  // ── Les avertissements : à lire avant de valider, sans refuser. ────────────────────────────────────────
  const couverture = couvertureDuReleve(d.lignes, frontiere)
  const echeancesManquantes = couverture
    ? echeancesNonRapprochees(d.emprunts, d.lignes, couverture.debut, couverture.fin).filter((x) => dansLExercice(x.echeance.date))
    : []
  if (echeancesManquantes.length > 0) {
    prealables.push({
      id: 'echeances-emprunt-non-rapprochees', nb: echeancesManquantes.length, cible: 'banque', bloquant: false,
      message: "échéance(s) d'emprunt de l'exercice qu'aucun mouvement ne paie — leurs intérêts ne sont pas comptés. Une fois l'exercice validé, ils ne le seront plus.",
    })
  }
  // UN CHÈQUE, UNE CARTE OU UN EFFET SANS MOUVEMENT AU 31 DÉCEMBRE (étape VF7c ; EC3-Q7) : un en-cours, écrit au 511, que la
  // base ne refuse pas — le mouvement de l'exercice suivant le soldera en s'y rattachant. Un avertissement, nommé : un
  // chèque remis et jamais crédité est aussi un impayé à reprendre.
  const enCours = sansMouvement.filter((e) => e.moyen !== 'virement' && e.moyen !== 'prelevement')
  if (enCours.length > 0) {
    prealables.push({
      id: 'encaissements-en-cours', nb: enCours.length, cible: 'banque', bloquant: false,
      message: `encaissement(s) de factures par chèque, carte ou effet sans mouvement du relevé au 31 décembre ${d.annee} : un en-cours, au 511, que le mouvement de son crédit soldera en s'y rattachant, même après la validation. Un chèque jamais crédité est un impayé, à contre-passer.`,
      detail: `${enumeration(enCours.map(nomDeLEncaissement))}.`,
    })
  }
  // LES MOUVEMENTS IGNORÉS DE L'EXERCICE ne sont écrits nulle part (lib/controles.ts) : juste pour un doublon, faux pour un
  // mouvement réel, qui manque alors au FEC. Rien ne les distingue d'ici : un avertissement, pas un refus — refuser
  // ferait reclasser un doublon pour valider. Mais validé, l'exercice fige ses mouvements : un oubli le resterait.
  const ignores = mouvementsIgnoresHorsFec(d.lignes, ouvertureDate, frontiere).filter(mouvementDeLExercice)
  if (ignores.length > 0) {
    const montants = montantsDesMouvementsIgnores(ignores)
    prealables.push({
      id: 'mouvements-ignores', nb: ignores.length, cible: 'banque', bloquant: false,
      message: "mouvement(s) ignoré(s) de l'exercice, absent(s) du FEC : un doublon le reste, un mouvement réel se remet à traiter et se classe. Une fois l'exercice validé, il ne le pourra plus.",
      detail: `${montants ? `${montants}. ` : ''}Dans Banque, filtre « Ignorés ».`,
    })
  }
  // LES PÉRIODES DE TVA DE L'EXERCICE QU'AUCUNE DÉCLARATION NE COUVRE (lib/liquidationTva.ts) : leur TVA reste aux comptes
  // 4457 et 4456, que rien ne soldera — une déclaration ne s'enregistre plus dans un exercice validé, et son paiement ne
  // trouvera rien à quoi se rapprocher. Un avertissement et non un refus : jusqu'aux exercices de 2026, un dossier au
  // régime simplifié dépose une CA12 que l'application ne prépare pas, et un cabinet peut déclarer ailleurs.
  if (d.assujettiTva) {
    const nonDeclarees = periodesNonDeclarees(d.declarationsTva, d.annee, d.periodiciteTva, `${d.anneeCourante}-01-01`, ouvertureDate)
    if (nonDeclarees.length > 0) {
      prealables.push({
        id: 'periodes-tva-non-declarees', nb: nonDeclarees.length, cible: 'tva', bloquant: false,
        message: "période(s) de TVA de l'exercice sans déclaration enregistrée : leur TVA reste aux comptes 4457 et 4456, que rien ne soldera. Une fois l'exercice validé, une déclaration ne s'y enregistrera plus.",
        detail: nonDeclarees.map((p) => p.libelle).join(', '),
      })
    }
  }
  if (d.declaration) {
    // UNE CSG-CRDS NON SAISIE : la part non déductible de ces cotisations part en déduction (ligne 25), et aucun calcul
    // ne peut la retrouver. Un avertissement et non un refus : une échéance de retraite n'en porte pas, et les refuser
    // ferait saisir un zéro sur chacune. Mais validé, l'exercice fige ses échéances : elle ne se saisira plus.
    const csg = partCsgNonDeductible(cotisationsComptees(d.cotisations, d.lignes, d.modele.mode), d.annee)
    if (csg && csg.nbSansVentilation > 0) {
      prealables.push({
        id: 'csg-non-saisie', nb: csg.nbSansVentilation, cible: 'cotisations', bloquant: false,
        message: "cotisation(s) de l'exercice dont la CSG-CRDS n'est pas saisie : leur part non déductible part en déduction, en ligne 25. Une fois l'exercice validé, elle ne se saisira plus.",
      })
    }
    // UN VÉHICULE DU REGISTRE AMORTI L'ANNÉE OÙ LE BARÈME EST RETENU : le barème couvre déjà son amortissement, et la
    // notice veut la dotation réintégrée — ce que l'application ne fait pas. Un avertissement et non un refus : le
    // véhicule peut légitimement figurer au registre, et rien dans l'application ne sait le réintégrer ; refuser
    // rendrait l'exercice invalidable. Il se dit donc avant, puisque la carte se tait après.
    const amortis = amortissementsSousLeBareme(d.immobilisations, d.natures, d.vehicules, d.annee)
    if (amortis.length > 0) {
      prealables.push({
        id: 'vehicule-amorti-sous-bareme', nb: amortis.length, cible: 'cloture', bloquant: false,
        message: "bien(s) du matériel de transport amorti(s) l'année où le barème kilométrique est retenu : la 2035 validée comptera leur dotation en case CH. La réintégrer sur la déclaration déposée (cadre B du tableau des immobilisations), ou retirer le bien du registre s'il n'est pas le véhicule du cadre 7.",
      })
    }
  }

  return { prealables, numerotation, report, validable: !prealables.some((p) => p.bloquant) }
}

// LES POINTS EN ERREUR DE LA CHECKLIST, et ce que la validation en fait. Chacun est repris ici (son
// identifiant figure dans `prealablesDeValidation`) ou écarté avec sa raison — `prealablesValidation.test.ts`
// lit la Checklist et refuse un point en erreur qui ne figure dans aucune des deux listes : un contrôle ajouté
// demain à la Checklist doit se poser la question ici.
export const POINTS_DE_LA_CHECKLIST_ECARTES: Readonly<Record<string, string>> = {
  'montant-suspect': "en trésorerie l'écriture d'une pièce non payée est déséquilibrée, donc refusée par la numérotation ; en engagement une facture impayée à la clôture est une dette, pas une anomalie",
  'piste-rompue': "ce sont les écritures que rien ne rattache, refusées sous « ecritures-orphelines »",
  desequilibrees: "jugé écriture par écriture sur la numérotation de l'exercice, sous « ecritures-desequilibrees »",
}

// LES CARTES DE CLÔTURE QUI DISENT CE QUE LA 2035 OU SES SOURCES ONT DE FAUX, et ce que la validation en fait. Une fois
// l'exercice validé elles se taisent — ce qu'elles demandent, la base le refuserait (ClotureTab, `ouvert`) — : ce
// qu'elles signalent doit donc être refusé ou lu AVANT. Chacune est reprise (l'identifiant d'un préalable) ou écartée
// avec sa raison ; `prealablesValidation.test.ts` lit les titres des cartes de Clôture et refuse une carte qui ne
// figure pas ici. Une carte ajoutée demain doit se poser la question.
export const CARTES_DE_CLOTURE: Readonly<Record<string, { prealable: string } | { ecartee: string }>> = {
  'Pièces validées sans catégorie': { prealable: 'sans-categorie' },
  'Postes manquants': { prealable: 'exclusions-2035' },
  'Pièces validées absentes du récapitulatif': { prealable: 'exclusions-2035' },
  'Mouvements affectés absents du récapitulatif': { prealable: 'exclusions-2035' },
  'Frais d’encaissements absents du récapitulatif': { prealable: 'exclusions-2035' },
  // Étape C3a : une recette de caisse que la 2035 ne compte pas a son écriture au brouillon, écrite avec l'opération — la
  // concordance la dit en écart (`sans_poste`, `caisse_a_reprendre`). Depuis l'étape C3b, `exclusions-2035` la compte aussi,
  // sous une phrase qui la nomme.
  'Recettes de caisse absentes du récapitulatif': { prealable: 'exclusions-2035' },
  'Échéances d’emprunt non rapprochées': { prealable: 'echeances-emprunt-non-rapprochees' },
  'Pièces comptées à leur date de facture': {
    ecartee: "une pièce dont aucun paiement n'est rapproché a une écriture sans banque, déséquilibrée, refusée sous « ecritures-desequilibrees » (ou sans écriture, sous « ecritures-a-generer ») ; une note de frais compte à sa date, qui est celle de son paiement",
  },
  'Cotisations comptées à leur échéance': {
    ecartee: "une échéance qu'aucun prélèvement ni paiement depuis le compte personnel ne date n'a pas d'écriture : la concordance la dit en écart, refusée sous « concordance »",
  },
  'Postes sans case du formulaire': { prealable: 'postes-sans-case' },
  'Cotisations dont la CSG-CRDS n’est pas saisie': { prealable: 'csg-non-saisie' },
  'Amortissement(s) sans justificatif': { prealable: 'immos-sans-justificatif' },
  'Frais de véhicule comptés deux fois': { prealable: 'frais-vehicule-en-double' },
  'Amortissement d’un véhicule déduit avec le barème': { prealable: 'vehicule-amorti-sous-bareme' },
  'Véhicules absents de la case BJ': { prealable: 'forfaits-a-ecrire' },
  'Cases « dont » incohérentes': {
    ecartee: "le moteur ne remplit aucune case « dont » (toutes saisies par le cabinet) et aucun écran ne les saisit : cette carte ne peut pas paraître",
  },
  'Case négative': { prealable: 'cases-negatives' },
  'La 2035 n’est pas produite pour ce dossier': { ecartee: "carte d'un dossier tenu en engagement, qui n'a pas de 2035" },
}
