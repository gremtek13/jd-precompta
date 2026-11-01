import { analyserEcritures, ecrituresSansObjet, piecesAComptabiliser } from './ecritures'
import type { ModeleComptable } from './engagement'
import { categoriesSansCompte, categoriesSansPoste, detailPiecesSansDate, immobilisationsSansJustificatif, moisEnDoubleSurAbonnement, montantsDesMouvementsIgnores, mouvementsIgnoresHorsFec, mouvementsRapprochesSansObjet, piecesADateImpossible, piecesDeviseNonConvertie, piecesPayeesEnPartie, piecesSansTva, piecesTvaImpossible, piecesValideesSansCategorie } from './controles'
import { mouvementsSurUnCompteDeBilanDesynchronises } from './compteDeBilan'
import { piecesMontantIntrouvableEnBanque } from './appariementBanque'
import { rupturesPisteAudit } from './pisteAudit'
import { ligneDUneVenteFacturee, mouvementsClassesParEncaissements } from './ecrituresVentesFactureesEcran'
import { idsMouvementsJustifiesParLeReleve, mouvementsAffectes, mouvementsAffectesDesynchronises, recettesAffecteesSansTaux } from './affectationBanque'
import { virementsPersonnelsAEcrire } from './virementPersonnel'
import { couvertureDuReleve, echeancesDesynchronisees, echeancesNonRapprochees } from './echeanceEmprunt'
import { cotisationsAEcrire, rapprochementsCotisationRefuses } from './cotisationRapprochee'
import { previsionnellesSansPaiement } from './previsionnelles'
import { acquisitionsDesBiens, dotationsDuRegistre, dotationsEnDefaut } from './amortissements'
import { forfaitsDuCadre7, forfaitsEnDefaut } from './forfaitKilometrique'
import { liquidationsDesynchronisees, paiementsTvaDesynchronises, periodesEnRetard } from './liquidationTva'
import type { Emprunt } from './emprunts'
import type { DoublonDeTexte } from './doublonsTexte'
import { anneeDe } from './format'
import { confronterLOuverture, exerciceAConfronter, ouvertureEnEcart } from './ouvertureConfrontee'
import type { OuvertureBanque } from './planTresorerie'
import type {
  ANouveau, ControleReleveBancaire, Categorie, CotisationDeclaree, DeclarationTva, EcritureBrouillon, Immobilisation, InformationsDossier,
  FactureEmise, LigneBancaire, LettrageManuel, NatureImmobilisation, PeriodiciteTva, Piece, ReglementGroupe, SoldeReporte, StatutTva, VehiculeDossier, VentilationBancaire,
} from './types'
import { etatsDesLettragesManuels, piecesLettreesALaMain } from './lettrage'
import { mouvementsVentilesDesynchronises, partsDesVentilations, recettesVentileesSansTaux, ventilationsIncoherentes } from './ventilationBanque'
import { paiementsDesPieces, piecesPayees } from './rattachement'
import { partsEncaissees } from './encaissementsFactures'
import { PAIEMENT_PAR_LA_CAISSE_EXPORTE, paiementsParLaCaisseDuDossierSelon } from './paiementParLaCaisse'
import { estContrepartieCaisse } from './ecritures'
import {
  detailJumellesIncoherentes, detailPiecesADesigner, detailVentesEnDouble, detailVentesHorsFacturesAVerifier,
  jumellesDuDossier, piecesADesigner, ventesEnDouble, ventesHorsFacturesAVerifier,
  type FacturePourJumelle, type TransmissionPourJumelle,
} from './ventesJumelles'
import { piecesPayeesEnTrop, reglementsGroupesIncoherents } from './reglementGroupe'
import type { DossierTab } from './ongletsDossier'
import { exercicesAReclamer, moisManquantsDe, pointsUtiles, type ExerciceAReclamer } from './resteAEnvoyer'
import type { LectureDesVentesDuReleve } from './mouvementsDesVentes'
import { detailDesEncaissementsSansMouvement, ventesDeLaChecklist } from './ventesDeLaChecklist'
import { exemplairesDesSources, horsDesExemplairesDesSources, type FacturesSources } from './facturesSources'
import { recettesVivantes, type CaisseLue } from './recettesDeCaisse'
import {
  caisseNegative, caisseNegativeDite, detailDesOperationsAReprendre, detailDesPaiementsARetirer, detailDesPaiementsDePiecesAValider,
  detailDesRecettesARevoir, detailDesVersementsEnRecette, dossierTientUneCaisse, etatDeLaCaisseLue, mouvementsDAvantLOuverture,
  operationsDeCaisseAReprendre, operationsDeCaisseDuDossier, paiementsDePiecesAValider, paiementsParLaCaisseARetirer, piecesDeVenteDe,
  recettesDeCaisseARevoir, versementsDEspecesEnRecette, type EspecesDesFactures,
} from './controlesDeLaCaisse'

// LES POINTS DE LA VUE D'ENSEMBLE (pages/dossier/ChecklistTab.tsx) : les points à traiter, rangés en paramétrage et en
// travail, et les documents attendus du client. Ils étaient calculés DANS l'écran, et l'onglet de la révision (ligne 41,
// étape R3) en a besoin : il range chacun dans le cycle qu'il concerne (lib/revisionCycles.ts). Recomposés ailleurs, ils
// auraient divergé au premier point ajouté — comme l'arithmétique d'exercice de `lib/resteAEnvoyer.ts`, écrite trois
// fois. Ils vivent donc ici, une fois, et les deux écrans les lisent ; leurs lectures, dans lib/checklistLecture.ts.
//
// Un module PUR : il ne lit rien et ne lit pas l'horloge — l'écran lui donne l'année, les mois écoulés et le premier
// jour du mois en cours, lus au rendu (« maintenant » ne se lit jamais au chargement d'un module).
//
// Le texte de chaque point est celui de l'écran, mot pour mot : `ChecklistTab.test.tsx` le garde. Et deux gardes lisent
// CETTE source comme du texte pour y trouver les identifiants : `revisionCycles.test.ts` (chaque point a son cycle) et
// `prealablesValidation.test.ts` (chaque point en erreur est repris par la validation, ou écarté) — un point s'écrit donc
// toujours `{ id: '…', …, severite: '…' }`.

const NOMS_MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']

// "action" : le libellé du bouton, propre à chaque point plutôt qu'un "Aller à l'onglet" générique
// répété sur toute la liste — dit ce que l'onglet cible va permettre de faire, pas juste où il est.
// `detail` : une ligne d'instruction sous le libellé, pour les points dont le bouton ne suffit pas
// à trouver ce qu'ils annoncent. Le cas qui l'a rendu nécessaire est `date-impossible`.
// `sansNombre` : un point qui ne compte rien — le dossier entier est concerné ou ne l'est pas —, dont le libellé
// se lit donc sans le « 1 » qui le précéderait.
export interface PointATraiter { id: string; label: string; action: string; nb: number; cible: DossierTab; severite: 'erreur' | 'attention'; detail?: string; sansNombre?: boolean }

// Un document attendu du client. `coche` : le justificatif qu'il marque reçu d'un clic (une case des informations du
// dossier) — l'écran en fait le geste ; ce module ne fait que le nommer.
export interface DocumentAttendu {
  id: string
  label: string
  ok: boolean
  detail?: string
  cible?: DossierTab
  // Libellé du bouton d'action quand `cible` est renseigné — jamais le générique "Aller à l'onglet".
  action?: string
  coche?: 'justificatif_tickets_restaurant_recu' | 'justificatif_cheques_vacances_recu'
}

/** Ce que la Vue d'ensemble a lu du dossier (lib/checklistLecture.ts), avec les drapeaux de ses lectures partielles. */
export interface DonneesDeLaChecklist {
  // Le nom dit le filtre : cette liste ne porte QUE les validées.
  piecesValidees: Piece[]
  piecesAValider: Piece[]
  cotisations: CotisationDeclaree[]
  lignes: LigneBancaire[]
  relevesIncoherents: ControleReleveBancaire[]
  doublonsTexte: DoublonDeTexte[]
  immobilisations: Immobilisation[]
  natures: NatureImmobilisation[]
  categories: Categorie[]
  ecritures: EcritureBrouillon[]
  emprunts: Emprunt[]
  ventilations: VentilationBancaire[]
  // Lues en partie, une part non lue ferait passer sa ventilation pour incohérente : ce point-là se tait.
  ventilationsPartielles: boolean
  reglements: ReglementGroupe[]
  reglementsPartiels: boolean
  // Le relevé ou les parts des virements groupés lus en partie : un paiement non lu ferait passer une pièce réglée
  // pour payée en partie, donc ce point-là se tait.
  paiementsPartiels: boolean
  lettragesManuels: LettrageManuel[]
  vehicules: VehiculeDossier[]
  declarationsTva: DeclarationTva[]
  declarationsPartielles: boolean
  // Avec leur montant (étape VF6e) : le symptôme d'une pièce déclarée à tort compare son TTC à celui d'une facture source.
  facturesEmises: (FacturePourJumelle & Pick<FactureEmise, 'montant_ttc'>)[]
  transmissions: TransmissionPourJumelle[]
  jumellesPartielles: boolean
  // Les factures SOURCES de leur vente parmi les factures émises lues (étape VF6a, lib/facturesSources.ts) : leur exemplaire
  // ne compte nulle part, et les points qui jugent une pièce comme une pièce qui compte l'écartent — le brouillon (à
  // générer, à régénérer, sans objet, sans contrepartie, déséquilibré), la catégorie et son compte ou son poste, la devise,
  // la TVA, le montant introuvable en banque, le paiement partiel ou en trop. Lues avec les factures émises : en partie,
  // `lectureIncomplete` le dit. Le pont juge aussi par elles (étape VF6e) : une facture source compte sa vente elle-même.
  facturesSources: FacturesSources
  info: InformationsDossier | null
  // Non nul = on ne SAIT PAS ce que le dossier porte comme informations : les points qui en dépendent se taisent.
  infoInconnue: string | null
  anneesCloturees: number[]
  ouverture: OuvertureBanque | null
  ouvertureIncomplete: string | null
  // L'ouverture REPRISE d'un autre logiciel, telle que lue (la révision en tire l'ouverture de ses exercices), et les soldes
  // REPORTÉS par la validation de chaque exercice : de quoi confronter l'ouverture de l'exercice qui suit le dernier validé à la
  // clôture du précédent (O33-Q3, lib/ouvertureConfrontee.ts).
  aNouveaux: ANouveau[]
  soldesReportes: SoldeReporte[]
  // Le motif de la première des lectures de cette confrontation (brouillon, catégories, pièces, reprise, soldes reportés) qui
  // n'est pas entière, ou rien. Sans valeur par défaut : lue en partie, la confrontation se tait — jamais « aucun écart ».
  entreesDeLOuvertureIncompletes: string | null
  // Les ventes facturées d'un dossier qui a basculé (ligne 28.65, étape VF5f ; lib/ventesDeLaChecklist.ts) : la lecture de
  // l'onglet Banque, lue ou incomplète ; NULLE pour un dossier qui n'a pas basculé, qui ne lit rien de plus. Incomplète, les
  // deux points qui en dépendent se taisent, et l'écran le dit.
  ventesFacturees: LectureDesVentesDuReleve | null
  // LA CAISSE DU DOSSIER (ligne 26.6, étape C3b ; lib/controlesDeLaCaisse.ts), telle que lue (lib/caisseLecture.ts) : absente
  // (le drapeau `CAISSE_EXPORTEE` baissé — aucun point de plus, la liste est celle d'hier), lue en entier, ou lue en partie —
  // ses quatre points se taisent alors, et l'écran le dit.
  caisse: CaisseLue
  // Le motif de la première des lectures dont les points de la caisse dépendent — ses opérations, le brouillon, les
  // catégories, le relevé, la reprise, les ventilations — qui n'est pas entière, ou rien ; rien aussi pour une caisse absente.
  // Sans valeur par défaut : lue en partie, une entrée les tait — jamais « rien à reprendre » sur ce qu'on n'a pas lu en
  // entier.
  entreesDeLaCaisseIncompletes: string | null
}

/** Ce que l'écran sait du dossier et du moment, lu au rendu. */
export interface ContexteDeLaChecklist {
  assujettiTva: boolean
  periodiciteTva: PeriodiciteTva
  statutTva: StatutTva | null
  modele: ModeleComptable
  // La frontière des exercices validés (lib/validationExercice.ts).
  frontiere: string | null
  // Les exercices validés, dont la frontière est le dernier : l'exercice dont l'ouverture se confronte est celui qui le suit.
  anneesValidees: readonly number[]
  // Aujourd'hui À PARIS (AAAA-MM-JJ, `aujourdHuiAParis`), lu au rendu : le bilan d'un exercice qui n'est pas clos est provisoire.
  aujourdHui: string
  // L'année et les mois écoulés, d'un même instant (`anneeEtMoisEcoules`).
  anneeCourante: number
  moisEcoules: number
  // `premierJourDuMoisCourant()`, lu au rendu : il dit quelles périodes de TVA sont échues.
  premierJourDuMois: string
}

export interface PointsDeLaChecklist {
  tousLesPointsATraiter: PointATraiter[]
  // Ceux qui comptent quelque chose — les seuls que l'écran montre.
  pointsATraiter: PointATraiter[]
  pointsParametrage: PointATraiter[]
  pointsTravail: PointATraiter[]
  documentsAttendus: DocumentAttendu[]
  exerciceCourant: ExerciceAReclamer
  moisManquants: number[]
  moisRecus: number
  piecesConfianceBasse: Piece[]
}

export function pointsDeLaChecklist(d: DonneesDeLaChecklist, c: ContexteDeLaChecklist): PointsDeLaChecklist {
  const {
    piecesValidees, piecesAValider, cotisations, lignes, relevesIncoherents, doublonsTexte, immobilisations, natures,
    categories, ecritures, emprunts, ventilations, ventilationsPartielles, reglements, reglementsPartiels, paiementsPartiels,
    lettragesManuels, vehicules, declarationsTva, declarationsPartielles, facturesEmises, transmissions, jumellesPartielles,
    info, infoInconnue, anneesCloturees, ouverture, ouvertureIncomplete, ventesFacturees, facturesSources, aNouveaux, soldesReportes,
    entreesDeLOuvertureIncompletes, caisse, entreesDeLaCaisseIncompletes,
  } = d
  const { assujettiTva, periodiciteTva, statutTva, modele, frontiere, anneesValidees, aujourdHui, anneeCourante, moisEcoules, premierJourDuMois } = c

  // L'ARITHMÉTIQUE D'EXERCICE VIT DANS `lib/resteAEnvoyer.ts`, partagée avec les deux écrans client :
  // elle était écrite trois fois et avait déjà divergé deux fois. Ce qui reste ici est ce qui diffère
  // légitimement — le critère de comptage des pièces (voir plus bas) et le registre des libellés.
  const exercices = exercicesAReclamer(anneeCourante, moisEcoules, anneesCloturees)
  // L'exercice en cours est toujours le dernier rendu (le révolu vient avant, dans l'ordre
  // chronologique) — et il est toujours rendu, même marqué clos.
  const exerciceCourant = exercices[exercices.length - 1]
  const moisManquants = moisManquantsDe(exerciceCourant, lignes)
  // Reçus PARMI LES MOIS RÉVOLUS, et non « mois présents » : un relevé daté d'un mois à venir
  // gonflait le numérateur et affichait « 13/8 ».
  const moisRecus = exerciceCourant.moisAttendus.length - moisManquants.length
  // Les pièces DATÉES de cette année, validées ou non — se limiter aux validées faisait dire "aucune
  // pièce déposée" alors que des pièces fraîchement importées, encore à valider, étaient déjà bien là.
  //
  // C'EST LA DATE DU DOCUMENT, PAS CELLE DU DÉPÔT, et le commentaire qui vivait ici disait l'inverse
  // (« toutes les pièces REÇUES cette année »). Les deux ne se ressemblent pas : mesuré sur le dossier
  // vivant, 43 pièces déposées en 2026 et UNE SEULE datée de 2026, le dépôt suivant la date de pièce
  // de 549 jours en médiane. La date du document est le bon critère ICI — le point demande si le
  // cabinet a de quoi travailler sur l'exercice, et le bouton mène à Pièces, dont le filtre d'exercice
  // lit lui aussi `date_piece`. Les écrans CLIENT posent l'autre question (« ai-je envoyé quelque
  // chose ? ») et comptent donc les dépôts : deux questions voisines, désormais dites distinctement.
  //
  // ET UNE PIÈCE SANS DATE N'EST SOUS AUCUN EXERCICE, donc comptée ici pour aucune année. Le taire
  // ferait afficher « Aucune pièce déposée » alors que le client a bien envoyé — et le cabinet le
  // relancerait pour des documents déjà reçus, pendant que l'écran du client les compte.
  const toutesPieces = [...piecesValidees, ...piecesAValider]
  const piecesSansDate = toutesPieces.filter((p) => !p.date_piece)
  const mentionSansDate = piecesSansDate.length > 0
    ? ` — ${piecesSansDate.length} pièce(s) sans date, rattachée(s) à aucun exercice`
    : ''

  // "Points à traiter" — regroupe en un seul endroit les anomalies déjà détectées séparément dans
  // Pièces (confiance basse), Écritures (comptes manquants, TVA, désynchronisation, déséquilibre) et
  // Clôture (postes manquants), pour ne pas avoir à visiter chaque onglet pour savoir si quelque chose
  // a besoin d'attention. Toujours les mêmes calculs (lib/controles.ts, lib/ecritures.ts) — rien de
  // recalculé différemment ici, juste rassemblé.
  // La facture d'un bien s'écrit sur le compte d'immobilisation de sa nature — ou rien : un bien sans
  // nature, et un bien acquis avant l'ouverture d'un dossier repris, que la balance reprise porte déjà
  // (lib/amortissements.ts). C'est l'OUVERTURE qui dit si un bien est repris : lue à moitié, les points qui
  // jugent l'écriture d'une facture de bien se taisent sur ces pièces-là, comme celui des dotations — ils
  // réclameraient sinon l'acquisition d'un bien que les à-nouveaux portent peut-être.
  const acquisitions = acquisitionsDesBiens(immobilisations, natures, ouverture?.date ?? null)
  const pieceIdsImmobilisees = new Set(acquisitions.keys())
  const piecesJugees = ouvertureIncomplete !== null
    ? piecesValidees.filter((p) => !pieceIdsImmobilisees.has(p.id))
    : piecesValidees
  // L'exemplaire d'une facture source ne s'écrit pas (étape VF6a) : sa facture écrit la vente. Les validées, pour les
  // contrôles qui partent de l'écriture : celles que `ecrituresSansObjet` juge, où son écriture se dit et se retire.
  const aComptabiliser = piecesAComptabiliser(piecesJugees, categories, acquisitions, facturesSources)
  const exemplaires = exemplairesDesSources(piecesValidees, facturesSources)
  // Les pièces qui COMPTENT, pour les points qui jugent une pièce par ses montants ou ses paiements : l'exemplaire d'une
  // facture source n'en est plus une — sa TVA, son montant et son règlement sont ceux de sa facture.
  const validesQuiComptent = horsDesExemplairesDesSources(piecesValidees, facturesSources)
  const aValiderQuiComptent = horsDesExemplairesDesSources(piecesAValider, facturesSources)
  // Les paiements de chaque pièce — mouvements rapprochés, parts des virements groupés, et, depuis l'étape VF5h, ce que
  // les virements mixtes paient des exemplaires (`partsEncaissees`, sur les ventes facturées lues en entier d'un dossier
  // basculé ; aucun ailleurs : sans facture source, aucun mouvement n'est classé par ses encaissements) — décident de la
  // date qu'une écriture doit porter et de ses lignes de banque (lib/rattachement.ts). `lignes` porte tout le relevé, et
  // `paiementsDesPieces` n'en retient que les rapprochés.
  const encaissees = ventesFacturees?.etat === 'lue'
    ? partsEncaissees(ventesFacturees.dossierId, ventesFacturees.sources.encaissements, ventesFacturees.sources,
      ventesFacturees.sources.exemplaires)
    : []
  // Et les paiements par la caisse (étape C9a), tirés des opérations lues : aucun tant que la migration n'est pas en base.
  // UNE CAISSE LUE EN PARTIE (étape C9b) ne rend aucun paiement — `paiementsDeLaCaisseInconnus` : une pièce payée en espèces y
  // paraîtrait sans paiement. Les points qui jugent une pièce par ses paiements se taisent alors, plutôt que de crier sur ce qu'on
  // n'a pas lu : la pièce dont l'écriture porte la contrepartie d'un paiement par la caisse ne se dit pas « à régénérer », et
  // « en attente de rapprochement », « payée en partie » et « montant introuvable » se taisent — le bandeau de la caisse le dit.
  const paiementsDeLaCaisse = paiementsParLaCaisseDuDossierSelon(PAIEMENT_PAR_LA_CAISSE_EXPORTE, caisse, caisse.dossierId)
  const paiementsDeLaCaisseInconnus = paiementsDeLaCaisse === null
  const paiements = paiementsDesPieces(lignes, reglements, encaissees, paiementsDeLaCaisse ?? [])
  const analyse = analyserEcritures(ecritures, aComptabiliser, assujettiTva, paiements, modele, frontiere, exemplaires)
  const { groupesDesequilibres } = analyse
  const payeesParLaCaisseAuBrouillon = new Set(ecritures.flatMap((e) => (estContrepartieCaisse(e) ? [e.piece_id!] : [])))
  const piecesDesynchronisees = paiementsDeLaCaisseInconnus
    ? analyse.piecesDesynchronisees.filter((p) => !payeesParLaCaisseAuBrouillon.has(p.id))
    : analyse.piecesDesynchronisees
  const piecesSansContrepartie = paiementsDeLaCaisseInconnus ? [] : analyse.piecesSansContrepartie
  // Les lettrages faits à la main (lib/lettrage.ts), revérifiés sur TOUTES les pièces lues, comme la carte des comptes
  // de tiers qui les montre : la liste qu'on y défait et ces points disent la même chose. En trésorerie, rien ne se
  // lettre et la liste est vide. Une facture qu'un lettrage qui tient solde avec son avoir n'attend plus de règlement :
  // la compter « sans règlement rapproché » enverrait chercher dans Banque un paiement qui n'existera jamais.
  const etatsLettrages = etatsDesLettragesManuels(ecritures, toutesPieces, lettragesManuels, modele.mode)
  const lettreesALaMain = piecesLettreesALaMain(etatsLettrages)
  const nbSansContrepartie = piecesSansContrepartie.filter((id) => !lettreesALaMain.has(id)).length
  const ecrituresSansObjetDuDossier = ecrituresSansObjet(ecritures, piecesJugees, categories, acquisitions, frontiere, modele.plan, facturesSources)
  // Les mouvements du relevé affectés à une catégorie sans justificatif (ligne 26.6) : leur écriture n'a
  // pas de pièce, par construction, et n'est pas une rupture de la piste d'audit.
  const affectes = mouvementsAffectes(lignes, categories, assujettiTva)
  // Les écritures d'une VENTE FACTURÉE (étape VF4c1) n'ont pas de pièce par construction : leur justification est leur
  // facture, leur encaissement, ou le mouvement que ses encaissements classent. L'onglet Écritures, où ce point renvoie, ne
  // les compte pas parmi les ruptures — ce point non plus, sur la même règle (lib/ecrituresVentesFactureesEcran.ts).
  const mouvementsDesVentes = mouvementsClassesParEncaissements(lignes)
  const ruptures = rupturesPisteAudit(
    ecritures.filter((e) => !ligneDUneVenteFacturee(e, mouvementsDesVentes)), idsMouvementsJustifiesParLeReleve(lignes),
  )
  // L'écriture d'un mouvement affecté que son affectation ne produirait plus — la catégorie a changé de
  // compte depuis, ou la recette d'un dossier qui a cessé d'être assujetti porte encore sa TVA. Même
  // famille que les pièces « à régénérer », invisible de la même façon.
  const affectesPerimes = mouvementsAffectesDesynchronises(ecritures, affectes, frontiere, modele.plan)
  // Des encaissements affectés en recette SANS TAUX alors que le dossier est assujetti — affectés avant
  // qu'il le devienne : leur TVA collectée n'est dans aucune CA3, et la 2035 compte la taxe en recette.
  // Pas d'un exercice validé : la base refuse de les réaffecter (lib/validationExercice.ts).
  const recettesSansTva = recettesAffecteesSansTaux(affectes, assujettiTva, frontiere)
  // Les mêmes, par une part d'un mouvement ventilé : un seul point, les deux se réparent pareil.
  const recettesVentileesSansTva = recettesVentileesSansTaux(partsDesVentilations(lignes, ventilations, categories, assujettiTva), assujettiTva, frontiere)
  // Une ventilation dont les parts ne font plus le mouvement (défensif, la base vérifie la somme), et une
  // écriture de mouvement ventilé qui ne suit plus ses parts — le compte d'une catégorie a changé depuis.
  const ventilationsFausses = ventilationsPartielles ? [] : ventilationsIncoherentes(lignes, ventilations)
  const ventilesPerimes = mouvementsVentilesDesynchronises(ecritures, lignes, ventilations, categories, modele, assujettiTva, frontiere)
  // Les virements personnels sans leur écriture — classés avant que ce classement s'écrive
  // (lib/virementPersonnel.ts). Ils ont l'air traités, et manquent au FEC comme à la trésorerie. Pas d'un
  // exercice validé : la base refuse d'y écrire.
  const virementsAEcrire = virementsPersonnelsAEcrire(ecritures, lignes, modele, frontiere)
  // Les échéances de cotisation payées par un mouvement rapproché dont l'écriture manque ou n'est plus
  // celle du rapprochement — rapprochées avant qu'il s'écrive, ou une CSG-CRDS saisie depuis
  // (lib/cotisationRapprochee.ts). Elles ont l'air payées, et manquent au FEC comme à la trésorerie. Pas d'un
  // exercice validé : la base refuse d'y écrire.
  const cotisationsSansEcriture = cotisationsAEcrire(ecritures, lignes, cotisations, modele.mode, frontiere, modele.plan)
  // Un rapprochement d'échéance qui ne PEUT pas s'écrire — un encaissement rapproché d'un appel, posé
  // quand l'écran ne regardait pas le sens : il ne date rien et n'a pas d'écriture. Pas d'un exercice validé : ni le
  // mouvement ni l'échéance n'y changent plus.
  const cotisationsRefusees = rapprochementsCotisationRefuses(lignes, cotisations, modele.mode, frontiere)
  // Les échéances d'emprunt que le relevé COUVRE — du premier mouvement au dernier, moins la marge laissée
  // au prélèvement — et qu'aucun mouvement ne paie : leurs intérêts manquent aux comptes, et le
  // prélèvement attend quelque part dans le relevé. Hors de cette fenêtre, on ne réclame rien : avant le
  // premier relevé rien n'a été importé, après le dernier le prélèvement n'est peut-être pas passé. Ni rien
  // d'un exercice validé : ses mouvements ne se rapprochent plus.
  const couverture = couvertureDuReleve(lignes, frontiere)
  const echeancesManquantes = couverture ? echeancesNonRapprochees(emprunts, lignes, couverture.debut, couverture.fin) : []
  // LES PRÉVISIONNELLES QU'AUCUN PRÉLÈVEMENT NE PAIE dans la fenêtre que le relevé couvre (étape 2035S2,
  // lib/previsionnelles.ts) : l'appel définitif d'une autre date l'a peut-être remplacée, et les deux comptent alors dans la
  // 2035. En attention, sans retenir la validation (2035S-Q4, (A)) ; la réponse (B), en erreur, demanderait son préalable
  // (prealablesValidation.test.ts le réclamerait). Le relevé lu en partie la tait : un prélèvement non lu la ferait paraître
  // impayée.
  const previsionnellesImpayees = paiementsPartiels ? [] : previsionnellesSansPaiement(cotisations, lignes, modele.mode, frontiere)
  // L'écriture d'une échéance rapprochée qui n'est plus celle de son découpage : défensif, la base les
  // écrivant ensemble — mais une écriture retirée par un autre chemin sortirait du FEC en silence.
  const echeancesPerimees = echeancesDesynchronisees(ecritures, lignes, modele.plan)
  const piecesConfianceBasse = piecesAValider.filter((p) => p.confiance === 'basse')
  // Les parts d'un mouvement ventilé désignent des catégories comme les mouvements affectés.
  // La facture d'un bien n'y compte pas : elle s'écrit sur le compte de sa nature, et la 2035 l'écarte.
  // Ni l'exemplaire d'une facture source (étape VF6e) : il ne s'écrit pas et la 2035 l'écarte — sa catégorie ne décide de
  // rien. Écarté ici, chez l'appelant, et non dans les deux fonctions : `agent-comptable` en porte une copie gardée
  // (agentComptableAffectation.test.ts), que ce lot ne redéploie pas.
  const catSansCompte = categoriesSansCompte(categories, validesQuiComptent, [...lignes, ...ventilations], pieceIdsImmobilisees)
  // LES RECETTES DE CAISSE (ligne 26.6, étape C4) rangent leur catégorie comme un mouvement affecté : sans poste, la 2035 ne les
  // compte nulle part (Clôture les dit déjà, `recettesDeCaisseSansPoste`). Sur une caisse lue en entier seulement ; absente ou
  // lue en partie, la liste est celle d'hier.
  const caisseDuDossier = operationsDeCaisseDuDossier(caisse, caisse.dossierId)
  const caisseLue = caisseDuDossier.etat === 'lue' ? caisseDuDossier : null
  const recettesDeLaCaisse = caisseLue === null ? [] : recettesVivantes(caisseLue.operations)
  const catSansPoste = categoriesSansPoste(categories, validesQuiComptent, [...lignes, ...ventilations, ...recettesDeLaCaisse], pieceIdsImmobilisees)
  const sansTva = piecesSansTva(validesQuiComptent, assujettiTva)
  const sansCategorie = piecesValideesSansCategorie(piecesValidees, pieceIdsImmobilisees, facturesSources)
  // Une pièce datée après son dépôt n'est pas « en attente » : elle est dans un autre exercice, donc
  // absente de Clôture, de la 2035 et de la Balance sans être comptée nulle part comme manquante.
  //
  // SUR LES DEUX PILES, comme ses trois voisins ci-dessous — et il était le seul des quatre à ne pas
  // l'être. Ce n'était pas un arbitrage, c'était un oubli, et il rendait le contrôle AVEUGLE en
  // production : la seule pièce de la base à porter une date impossible (27/09/2028, déposée le
  // 16/09/2026, sans tiers ni montant, confiance basse) est « à valider » — c'est-à-dire le cas même
  // qui a fait écrire ce contrôle, cité dans son propre commentaire.
  //
  // La règle qui départage les contrôles de cet écran, et qu'il faut appliquer au prochain :
  // un contrôle qui signale une donnée ABSENTE ne vise que les validées (l'absence est normale dans
  // la corbeille d'arrivée, et les signaler noierait le signal) ; un contrôle qui signale une donnée
  // DÉMONTRÉE FAUSSE vise les deux piles, parce qu'une donnée fausse n'est jamais normale et qu'elle
  // se corrige d'autant mieux qu'on la voit avant la validation. Une date postérieure au dépôt est
  // démontrée fausse.
  const dateImpossible = piecesADateImpossible([...piecesValidees, ...piecesAValider])
  // Sur TOUTES les pièces, validées ET à valider — et ce n'est pas un détail : `piecesValidees` ne porte ici
  // que les validées. Les deux pièces qui ont fait naître ce contrôle sont toutes deux « à valider »,
  // donc le brancher sur `piecesValidees` seul le rendrait muet sur le cas même qu'il est fait pour voir.
  // Une date fausse se corrige d'autant mieux qu'on la voit AVANT la validation ; après, plus
  // personne ne regarde la pièce.
  const moisEnDouble = moisEnDoubleSurAbonnement([...piecesValidees, ...piecesAValider])
  // LA MÊME VENTE PORTÉE PAR PLUSIEURS PIÈCES (ligne 28.6, lib/ventesJumelles.ts), sur les deux piles comme les doublons
  // de texte : un doublon est un fait, et il se corrige mieux avant la validation. Muets sur une lecture partielle.
  // PAR RÉGIME (étape VF6e) : une facture source compte sa vente elle-même — ses exemplaires désignés ne la doublent pas,
  // une pièce validée qui n'en est pas l'exemplaire, si. Dans un dossier basculé, la pièce que le pont rattache à une facture
  // sans être désignée est à désigner ; et une pièce déclarée hors des factures dont le TTC est celui d'une facture source
  // sans exemplaire validé, la même année, se vérifie (VF6-Q4). Le dossier a basculé quand il lit ses ventes facturées :
  // `ventesFacturees` n'est nulle QUE pour un dossier qui n'a pas basculé (lib/checklistLecture.ts), lue ou non.
  const regime = { dossierBascule: ventesFacturees !== null, sources: facturesSources }
  const jumelles = jumellesPartielles ? null : jumellesDuDossier(facturesEmises, transmissions, toutesPieces)
  const enDouble = jumelles ? ventesEnDouble(facturesEmises, jumelles, regime.sources, toutesPieces) : []
  const jumellesIncoherentes = jumelles?.incoherentes ?? []
  const aDesigner = jumelles ? piecesADesigner(jumelles, regime, enDouble) : []
  const horsFacturesAVerifier = jumellesPartielles ? [] : ventesHorsFacturesAVerifier(toutesPieces, facturesEmises, regime.sources)
  // Sur les deux piles, validées comme à valider : une TVA arithmétiquement impossible l'est à tout
  // stade, et c'est avant la validation qu'il faut la voir — après, le chiffre est figé dans
  // l'écriture. Sans filtre sur l'assujettissement non plus : un montant impossible signale une
  // lecture ratée du document, et sur un dossier non assujetti c'est le TTC — donc la charge — qui
  // peut être faux (voir lib/controles.ts).
  const tvaImpossible = piecesTvaImpossible([...validesQuiComptent, ...aValiderQuiComptent])
  const deviseNonConvertie = piecesDeviseNonConvertie([...piecesValidees, ...piecesAValider], facturesSources)
  // Le pendant côté Banque de "en attente de rapprochement bancaire" ci-dessous (qui part des
  // écritures) : un mouvement bancaire importé mais jamais rattaché à une pièce, une cotisation, ou
  // marqué personnel/à ignorer — le seul cycle du dossier qui manquait encore à ce tableau de bord.
  //
  // LES VENTES FACTURÉES D'UN DOSSIER QUI A BASCULÉ (étape VF5f) : un mouvement RÉSERVÉ à des encaissements de factures
  // n'attend pas de pièce, il attend que le cabinet le classe par eux — il se compte à part, comme l'onglet Banque le compte
  // (`comptesDuReleve`), jamais deux fois. Figé par la validation, rien ne le classe plus : il reste où il était. Sur une
  // lecture incomplète, on ne sait pas lesquels le sont : les lignes non rapprochées comptent tout, comme hier.
  const ventes = ventesDeLaChecklist(ventesFacturees, frontiere)
  const mouvementsReserves = ventes.etat === 'lue' ? ventes.reserves : []
  const idsReserves = new Set(mouvementsReserves.map((m) => m.id))
  const encaissementsSansMouvement = ventes.etat === 'lue' ? ventes.sansMouvement : []
  const lignesNonRapprochees = lignes.filter((l) => l.statut === 'non_rapprochee' && !idsReserves.has(l.id))
  // L'AUTRE MOITIÉ, et celle qui ne se voyait nulle part : un mouvement que le dossier DIT rapproché
  // et qui ne désigne plus rien. Le point ci-dessus ne compte que les `non_rapprochee`, donc il se
  // tait exactement dessus — sur l'écran dont le métier est de dire ce qui manque. Voir
  // `mouvementsRapprochesSansObjet` : les deux clés du côté banque sont en `ON DELETE SET NULL`.
  const rapprochesSansObjet = mouvementsRapprochesSansObjet(lignes)
  // LES MOUVEMENTS IGNORÉS, que rien n'écrit (lib/controles.ts) : « Ignorer » convient à un doublon, ou à un mouvement
  // antérieur aux à-nouveaux d'un dossier repris — la balance reprise le porte déjà. Un mouvement réel ignoré manque au
  // FEC, et le 512 du brouillon s'écarte du relevé d'autant. Tus sur une lecture partielle de l'ouverture : un mouvement
  // antérieur aux à-nouveaux y serait réclamé. Ni rien d'un exercice validé, que plus rien ne réécrit.
  const ignoresHorsFec = ouvertureIncomplete !== null ? [] : mouvementsIgnoresHorsFec(lignes, ouverture?.date ?? null, frontiere)
  const montantsIgnores = montantsDesMouvementsIgnores(ignoresHorsFec)
  // Un mouvement écrit sur un compte de bilan dont l'écriture ne suit plus le compte. Défensif : la base écrit le compte
  // et l'écriture ensemble (lib/compteDeBilan.ts).
  const bilanPerimes = mouvementsSurUnCompteDeBilanDesynchronises(ecritures, lignes, frontiere, modele.plan)
  // L'AUTRE MOITIÉ DE « LA BANQUE FAIT FOI » (décision du cabinet, 23/09/2026) : sous le seuil la
  // pièce est ALIGNÉE au rapprochement et il n'y a rien à dire ; au-dessus, un écart large est
  // presque toujours un paiement partiel, donc on le signale sans rien écraser. Jugé sur le TOTAL
  // payé de la pièce, pas mouvement par mouvement : une facture réglée en deux fois n'a rien à
  // reprendre. En trésorerie seulement — voir `piecesPayeesEnPartie`.
  // Des ventes facturées lues en partie taisent aussi ce point : un virement mixte non lu ferait passer son exemplaire pour
  // payé en partie.
  const payeesEnPartie = paiementsPartiels || ventesFacturees?.etat === 'incomplete' || paiementsDeLaCaisseInconnus ? []
    : piecesPayeesEnPartie(validesQuiComptent, paiements, modele.mode)
  // La TROISIÈME clé en `ON DELETE SET NULL` de `pieces` : supprimer une pièce immobilisée détache
  // son immobilisation sans un mot, et la dotation continue de partir en case CH d'une 2035 signée.
  const immosSansJustificatif = immobilisationsSansJustificatif(immobilisations)
  // Les dotations aux amortissements qui manquent au brouillon : celle d'un exercice FINI qui n'est pas
  // écrite, et celle qui ne suit plus le registre (lib/amortissements.ts). La 2035 compte la dotation depuis
  // le registre, le FEC depuis le brouillon : sans elle, les deux livrables diffèrent de la case CH. La
  // dotation de l'exercice EN COURS ne manque pas encore — l'onglet Immobilisations la propose sans la
  // réclamer. Elle dépend de l'ouverture du dossier, avant laquelle l'amortissement est dans les
  // à-nouveaux : lue à moitié, le point se tait plutôt que de réclamer un exercice repris.
  const dotationsManquantes = ouvertureIncomplete !== null
    ? []
    : dotationsEnDefaut(dotationsDuRegistre(immobilisations, natures, ecritures, ouverture?.date ?? null, anneeCourante, frontiere, modele.plan), anneeCourante)
  const exercicesDesDotations = [...new Set(dotationsManquantes.map((d) => d.annee))].sort((a, b) => a - b)
  // Les forfaits kilométriques qui manquent au brouillon, sur la même règle (lib/forfaitKilometrique.ts) : celui
  // d'un exercice FINI qui n'est pas écrit, et celui qui ne suit plus le cadre 7. La 2035 compte le forfait en
  // case BJ depuis le cadre 7, le FEC depuis le brouillon. Il dépend lui aussi de l'ouverture du dossier, avant
  // laquelle l'exercice est dans les comptes repris : lue à moitié, le point se tait.
  const forfaitsManquants = ouvertureIncomplete !== null
    ? []
    : forfaitsEnDefaut(forfaitsDuCadre7(vehicules, ecritures, modele, ouverture?.date ?? null, anneeCourante, frontiere), anneeCourante)
  const exercicesDesForfaits = [...new Set(forfaitsManquants.map((f) => f.vehicule.annee))].sort((a, b) => a - b)
  // LA TVA LIQUIDÉE ET PAYÉE (lib/liquidationTva.ts) : une liquidation qui ne suit plus ce que sa déclaration a
  // enregistré, un paiement dont l'écriture ne suit plus son mouvement — défensifs tous deux, la base les écrit
  // ensemble —, et les périodes dont la déclaration manque, une fois son échéance passée. Celles-ci sur les exercices où
  // le dossier a une activité, hors des exercices validés et des périodes reprises : elles se taisent sur une lecture
  // partielle des déclarations ou de l'ouverture, qui ferait réclamer une période déclarée ou reprise.
  const liquidationsPerimees = liquidationsDesynchronisees(ecritures, declarationsTva, frontiere, modele.plan)
  const paiementsTvaPerimes = paiementsTvaDesynchronises(ecritures, lignes, frontiere, modele.plan)
  const anneesActives = [
    ...lignes.map((l) => anneeDe(l.date)),
    ...piecesValidees.flatMap((p) => (p.date_piece ? [anneeDe(p.date_piece)] : [])),
  ]
  const periodesTvaEnRetard = !assujettiTva || declarationsPartielles || ouvertureIncomplete !== null
    ? []
    : periodesEnRetard(declarationsTva, periodiciteTva, anneesActives, premierJourDuMois, ouverture?.date ?? null, frontiere)
  const libellesEnRetard = periodesTvaEnRetard.length > 6
    ? `${periodesTvaEnRetard.slice(0, 6).map((p) => p.libelle).join(', ')} et ${periodesTvaEnRetard.length - 6} autre(s)`
    : periodesTvaEnRetard.map((p) => p.libelle).join(', ')
  // Signal plus grave que « en attente de rapprochement » : un montant qui n'apparaît nulle part dans
  // le relevé importé, à aucune date, révèle soit un relevé incomplet soit un montant faux — voir
  // lib/appariementBanque.ts. Ne porte que sur les pièces jamais rattachées à un mouvement, comme
  // BanqueTab.
  // Réglées par un rapprochement simple OU par la part d'un virement groupé : une pièce payée avec d'autres
  // n'a pas son montant sur une ligne du relevé, et ce n'est pas un montant suspect.
  const piecesRapprocheesIds = piecesPayees(paiements)
  // Un virement groupé dont une part ne justifie plus rien — sa pièce supprimée depuis —, ou dont les parts
  // ne font plus le mouvement (défensif, la base vérifie la somme). Et une pièce payée plus que son montant :
  // la 2035 la compte une fois, l'argent versé en trop n'y est nulle part (lib/reglementGroupe.ts).
  // Compté par MOUVEMENT : une part sans pièce et une somme qui ne tombe plus juste sont deux raisons pour un
  // seul virement à reprendre.
  const reglementsFaux = reglementsPartiels ? [] : [...new Set(reglementsGroupesIncoherents(lignes, reglements).map((r) => r.ligne.id))]
  // Ni l'exemplaire d'une facture source (étape VF6e) : il ne se règle pas, sa facture s'encaisse (G4 refuse son
  // rapprochement, la part d'un virement groupé et son écriture).
  const payeesEnTrop = piecesPayeesEnTrop(validesQuiComptent, paiements)
  const lettragesQuiNeTiennentPlus = etatsLettrages.filter((e) => e.motif !== null)
  // `piecesValidees` et non `pieces` : ce contrôle ne vise que les pièces VALIDÉES, et son libellé le
  // dit. L'état s'appelait `pieces` quand ce point a été écrit, alors qu'il ne portait déjà que les
  // validées — c'est exactement le nom trompeur que le renommage a supprimé.
  // Ni une pièce qu'un lettrage fait à la main qui tient solde : une facture lettrée avec son avoir n'attend aucun
  // mouvement, et son montant ne sera jamais dans le relevé. Le même critère que l'onglet Banque, où mène ce point.
  // Ni l'exemplaire d'une facture source (étape VF6a) : il ne se règle pas, sa facture s'encaisse — l'envoyer chercher dans
  // le relevé mènerait à le rapprocher, ce que G4 (VF6b) refusera.
  // Une caisse lue en partie le tait aussi : une pièce payée en espèces n'a, par construction, aucun mouvement du relevé.
  const montantSuspect = paiementsDeLaCaisseInconnus ? [] : piecesMontantIntrouvableEnBanque(
    validesQuiComptent.filter((p) => !piecesRapprocheesIds.has(p.id) && !lettreesALaMain.has(p.id)),
    lignes,
  )

  // L'OUVERTURE DE L'EXERCICE QUI SUIT LE DERNIER VALIDÉ, CONFRONTÉE À LA CLÔTURE DU PRÉCÉDENT (O33-Q3) : le calcul de l'onglet
  // Bilan et du préalable de la validation (`ouverture-en-ecart`, O33-Q1), sur les mêmes entrées — tout le brouillon, les
  // catégories, la reprise, les soldes reportés, les exercices validés, les pièces des deux piles (leur tiers) et le modèle —,
  // et les mêmes mots (`ouvertureEnEcart`). Sans exercice à confronter (rien de validé : premier exercice, ou balance reprise
  // que son import a contrôlée), sans confrontation (l'ouverture attend la validation du précédent, que l'ordre refuse déjà)
  // ou sur concordance, le point se tait ; lue en partie, une entrée le tait aussi, et l'écran le dit : jamais « aucun écart »
  // sur ce qu'on n'a pas lu en entier.
  const exerciceDeLOuverture = exerciceAConfronter(anneesValidees)
  const confrontation = exerciceDeLOuverture === null || entreesDeLOuvertureIncompletes !== null
    ? null
    : confronterLOuverture({
      exercice: exerciceDeLOuverture, ecritures, categories, reprise: aNouveaux, reportes: soldesReportes, anneesValidees,
      pieces: toutesPieces, modele, aujourdHui,
    }, 'complete')
  const ecartDOuverture = confrontation?.etat === 'ecarts' ? ouvertureEnEcart(confrontation) : null

  // LA CAISSE DU DOSSIER (ligne 26.6, étape C3b ; lib/controlesDeLaCaisse.ts ; conception, § 4 et § 5) : quatre points, que
  // la caisse lue EN ENTIER fait paraître. ABSENTE (le drapeau baissé), rien n'est calculé et la liste est celle d'hier, au
  // caractère près. Lue en partie, ou une de ses entrées (`entreesDeLaCaisseIncompletes`), ils se taisent — leur silence ne
  // prouverait rien —, et l'écran le dit. Les espèces des factures d'un dossier basculé (la lecture des ventes facturées) ne
  // servent qu'à deux d'entre eux : lues en partie, ces deux-là se taisent seuls, sous le bandeau des ventes facturées.
  // Trois points mènent à l'onglet Caisse (étape C4), où l'opération se retire et se saisit de nouveau, et leur détail nomme
  // chaque opération ; le quatrième mène à Banque, où le mouvement se voit sous « Rapprochés ».
  const caisseJugee = caisseLue !== null && entreesDeLaCaisseIncompletes === null ? caisseLue.operations : null
  const especes: EspecesDesFactures = ventesFacturees === null ? { etat: 'sans_objet' }
    : ventesFacturees.etat === 'incomplete' ? { etat: 'incomplete', motif: ventesFacturees.motif }
      : { etat: 'lues', encaissements: ventesFacturees.sources.encaissements, factures: ventesFacturees.sources.factures }
  const dossierDeLaCaisse = {
    modele, assujettiTva, categories, ecritures, frontiere, ouvertures: aNouveaux, mouvements: lignes, especes,
    // Les pièces de vente : l'ensemble du jour d'une recette compte leurs paiements par la caisse (étape C9b).
    piecesDeVente: piecesDeVenteDe(toutesPieces),
  }
  const caisseAReprendre = caisseJugee === null ? [] : operationsDeCaisseAReprendre(caisseJugee, dossierDeLaCaisse)
  const etatDeLaCaisse = caisseJugee === null ? null : etatDeLaCaisseLue(caisseJugee, dossierDeLaCaisse)
  const caisseEnNegatif = etatDeLaCaisse === null ? null : caisseNegative(etatDeLaCaisse, frontiere)
  const recettesARevoir = etatDeLaCaisse === null || caisseJugee === null ? [] : recettesDeCaisseARevoir(caisseJugee, etatDeLaCaisse, frontiere)
  // Un symptôme, dans un dossier qui tient une caisse — une opération vivante, les espèces d'une facture source (§ 4 a ;
  // C6-Q1), un solde repris ou un mouvement classé sur la caisse (la relecture du 31/10/2026 : le relevé importé avant le
  // brouillard) : un crédit libellé « VERSEMENT ESPECES » rangé en recette compte peut-être deux fois les espèces que la caisse
  // a déjà comptées. La reprise et le relevé sont lus en entier quand la caisse est jugée (`entreesDeLaCaisseIncompletes`).
  const repriseEtReleve = {
    compteCaisse: modele.plan.caisse,
    ouvertures: caisseJugee === null ? null : aNouveaux,
    mouvements: caisseJugee === null ? null : lignes,
  }
  const versementsEnRecette = caisseJugee === null || dossierTientUneCaisse(caisseDuDossier, especes, repriseEtReleve) !== 'oui' ? []
    : versementsDEspecesEnRecette(lignes, ventilations, categories, assujettiTva, frontiere)
  // UN MOUVEMENT D'AVANT L'OUVERTURE CLASSÉ SUR LA CAISSE (étape C9b ; le défaut K1) : ses espèces sont dans les comptes repris,
  // et le classement les compte une seconde fois. La migration `paiement_par_la_caisse` en refuse le classement et borne la
  // caisse en base : le point vient avec elle (`PAIEMENT_PAR_LA_CAISSE_EXPORTE`), sur la caisse jugée (la reprise et le relevé
  // lus en entier). Celui qui y est se retire depuis sa fiche, dans Banque.
  const avantLOuverture = caisseJugee === null || !PAIEMENT_PAR_LA_CAISSE_EXPORTE ? []
    : mouvementsDAvantLOuverture(lignes, aNouveaux, modele.plan.caisse, frontiere)
  // LA RELECTURE DU 01/11/2026. Le paiement d'une pièce que sa pièce contredit depuis — son type, ou son montant changé
  // (les défauts 2 et 4) : jugé sur la caisse jugée et sur TOUS les paiements de la pièce, que le relevé, ses parts et les
  // ventes facturées lus en partie rendraient faux — ils taisent alors le point, comme « payée en partie ». Et la pièce à
  // valider qu'un paiement cite (le défaut 1), que la validation de l'exercice du paiement attend.
  const paiementsARetirer = caisseJugee === null || !PAIEMENT_PAR_LA_CAISSE_EXPORTE ? []
    : paiementsParLaCaisseARetirer(caisseJugee, toutesPieces, paiements, frontiere)
      .filter((x) => x.raison === 'sens' || !(paiementsPartiels || ventesFacturees?.etat === 'incomplete'))
  const piecesAValiderPayees = caisseJugee === null || !PAIEMENT_PAR_LA_CAISSE_EXPORTE ? []
    : paiementsDePiecesAValider(caisseJugee, piecesAValider, frontiere)

  const tousLesPointsATraiter: PointATraiter[] = [
    // En tête, et en « erreur » : c'est le seul point de cette liste qui ne se voit nulle part
    // ailleurs. Une pièce validée sans catégorie a l'air traitée — elle ne produit pourtant ni
    // écriture ni ligne de 2035, et aucun autre contrôle ne la voit (voir lib/controles.ts).
    // Avant tout le reste : si le relevé lui-même est incomplet, les mouvements manquants faussent le
    // rapprochement, les totaux et la clôture. Corriger en aval ce qui vient d'une source amputée
    // revient à bâtir sur du sable.
    { id: 'releve-incoherent', label: 'relevé(s) bancaire(s) qui ne bouclent pas — mouvements manquants', action: 'Voir les relevés en écart', nb: relevesIncoherents.length, cible: 'banque', severite: 'erreur' },
    // Un montant qui n'apparaît nulle part dans le relevé, à aucune date : relevé incomplet ou montant
    // faux, deux causes qu'aucune règle interne au document ne peut départager (voir CLAUDE.md,
    // « Fiabilité de l'extraction OCR sur les montants »).
    { id: 'montant-suspect', label: 'pièce(s) validée(s) dont le montant ne correspond à aucun mouvement bancaire', action: 'Voir ces montants', nb: montantSuspect.length, cible: 'banque', severite: 'erreur' },
    { id: 'piste-rompue', label: "écriture(s) sans justificatif ou sans mouvement — piste d'audit rompue", action: 'Voir les écritures concernées', nb: ruptures.length, cible: 'ecritures', severite: 'erreur' },
    { id: 'sans-categorie', label: 'pièce(s) validée(s) sans catégorie — invisibles en compta', action: 'Catégoriser ces pièces', nb: sansCategorie.length, cible: 'pieces', severite: 'erreur', detail: detailPiecesSansDate(sansCategorie) },
    // « Erreur » et non « attention » : ce n'est pas une TVA douteuse, c'est une TVA dont le calcul
    // démontre qu'elle est fausse. Elle part telle quelle en TVA déductible et dans la charge.
    { id: 'tva-impossible', label: 'pièce(s) dont la TVA est arithmétiquement impossible', action: 'Corriger ces montants', nb: tvaImpossible.length, cible: 'pieces', severite: 'erreur', detail: detailPiecesSansDate(tvaImpossible.map((t) => t.piece)) },
    // Le bouton ne suffit PAS à trouver la pièce : elle est par définition dans un exercice futur,
    // donc écartée par le sélecteur d'exercice de l'en-tête, qui s'ouvre toujours sur une année
    // précise. « Corrigez ces dates » menait donc vers une liste où la pièce n'apparaît même pas —
    // et un point qui compte sans pouvoir montrer se paie en crédit.
    // Ce détail-ci reste ÉCRIT EN DUR, contrairement à ses voisins : la pièce a bien une date, elle
    // est seulement dans une autre année, donc `detailPiecesSansDate` n'aurait rien à en dire. Ce
    // point s'annonçait « le seul » dans ce cas ; il ne l'était que parmi les pièces DATÉES.
    { id: 'date-impossible', label: 'pièce(s) datée(s) après leur dépôt — rangées dans le mauvais exercice', action: 'Corriger ces dates', nb: dateImpossible.length, cible: 'pieces', severite: 'erreur', detail: "Choisir « toutes les années » dans l'en-tête du dossier pour les voir : elles portent le badge « Date impossible »." },
    // « Erreur » comme la date impossible, et pour la même raison : la pièce part dans le mauvais
    // mois, parfois le mauvais exercice. En prime elle bloque un rapprochement bancaire qui était
    // certain (voir lib/controles.ts) — le rapprochement, lui, n'annonce qu'un doute.
    { id: 'mois-en-double', label: "mois d'abonnement en double, avec un mois voisin vide — une pièce mal datée ou en double", action: 'Vérifier ces pièces', nb: moisEnDouble.length, cible: 'pieces', severite: 'erreur' },
    // « Erreur » : si les deux sont validées et catégorisées, la même charge est comptée deux fois —
    // dans la 2035 comme dans la balance. Et l'empreinte du FICHIER ne peut pas le voir (voir
    // lib/doublonsTexte.ts), donc aucun autre écran ne le signale.
    //
    // La destination suit le doublon, elle n'est pas écrite en dur. `cible: 'pieces'` était juste
    // tant que seules les pièces portaient un texte OCR ; depuis que les documents en ont un
    // (20/09/2026), un groupe peut n'être fait que de documents — et l'onglet Pièces n'a alors
    // aucune ligne à montrer. Un point qui annonce « 1 » et renvoie vers un écran vide est pire
    // qu'un point absent : l'opérateur cherche, ne trouve pas, et cesse de croire le suivant.
    { id: 'doublon-texte', label: 'document(s) déposé(s) plusieurs fois sous des fichiers différents', action: 'Voir les doublons', nb: doublonsTexte.length, cible: doublonsTexte.some((d) => d.pieceIds.length > 0) ? 'pieces' : 'documents', severite: 'erreur' },
    // LA MÊME FACTURE ÉMISE PORTÉE PAR PLUSIEURS PIÈCES (ligne 28.6) : revenue de la plateforme du client ET de Super PDP,
    // chacune la compte dans la 2035, la CA3 et le brouillon. Le point du dessus ne la voit pas : les deux pièces n'ont ni
    // le même fichier ni le même texte. Le PDF de la même vente déposé à la main ne se reconnaît pas ici — rien ne le relie
    // à sa facture sans rapprocher un montant, une date et un client.
    { id: 'ventes-en-double', label: 'vente(s) portée(s) par plusieurs pièces — la même facture émise comptée plusieurs fois', action: 'Voir ces pièces', nb: enDouble.length, cible: 'pieces', severite: 'erreur', detail: detailVentesEnDouble(enDouble, facturesEmises, toutesPieces) },
    // En « erreur » : la pièce n'a AUCUN montant en euros tant que le taux manque, donc elle ne
    // compte nulle part — ni en charge, ni en TVA, ni dans la 2035. Exactement l'effet d'une pièce
    // sans catégorie, par un autre chemin.
    { id: 'devise-non-convertie', label: 'pièce(s) en devise étrangère non converties en euros', action: 'Convertir ces pièces', nb: deviseNonConvertie.length, cible: 'pieces', severite: 'erreur', detail: detailPiecesSansDate(deviseNonConvertie) },
    { id: 'desequilibrees', label: 'écriture(s) déséquilibrée(s)', action: 'Voir les écritures déséquilibrées', nb: groupesDesequilibres.length, cible: 'ecritures', severite: 'erreur' },
    { id: 'desynchronisees', label: 'écriture(s) à régénérer (pièce modifiée depuis)', action: 'Régénérer les écritures concernées', nb: piecesDesynchronisees.length, cible: 'ecritures', severite: 'erreur' },
    // Le pendant côté relevé : un mouvement affecté dont l'écriture n'est plus celle de sa catégorie.
    { id: 'affectes-perimes', label: 'mouvement(s) affecté(s) dont l’écriture ne suit plus la catégorie', action: 'Réaffecter ces mouvements', nb: affectesPerimes.length, cible: 'ecritures', severite: 'erreur' },
    // Le pendant pour un emprunt : rapprocher de nouveau l'échéance (fiche du mouvement, « Corriger le
    // découpage ») réécrit son écriture.
    { id: 'echeances-emprunt-perimees', label: 'échéance(s) d’emprunt dont l’écriture ne suit plus le découpage', action: 'Rapprocher de nouveau ces échéances', nb: echeancesPerimees.length, cible: 'banque', severite: 'erreur' },
    // Le pendant pour un mouvement ventilé : « Réécrire », dans Écritures, reprend l'écriture depuis ses parts.
    { id: 'ventiles-perimes', label: 'mouvement(s) ventilé(s) dont l’écriture ne suit plus les parts', action: 'Réécrire ces ventilations', nb: ventilesPerimes.length, cible: 'ecritures', severite: 'erreur' },
    // Le pendant pour un mouvement écrit sur un compte de bilan : « Réécrire », dans Écritures. Défensif — la base écrit
    // le compte et l'écriture ensemble —, mais une écriture retirée par un autre chemin sortirait du FEC en silence.
    { id: 'comptes-de-bilan-perimes', label: 'mouvement(s) écrit(s) sur un compte de bilan dont l’écriture ne suit plus le compte', action: 'Réécrire ces mouvements', nb: bilanPerimes.length, cible: 'ecritures', severite: 'erreur' },
    // Le pendant pour la TVA : une liquidation qui ne suit plus ce que sa déclaration a enregistré, un paiement dont
    // l'écriture ne suit plus son mouvement. « Réécrire », dans Écritures, les reprend — la liquidation depuis la
    // déclaration déposée, sans la retirer.
    { id: 'liquidations-tva-perimees', label: 'déclaration(s) de TVA dont l’écriture de liquidation manque ou ne suit plus la déclaration', action: 'Réécrire ces liquidations', nb: liquidationsPerimees.length, cible: 'ecritures', severite: 'erreur' },
    { id: 'paiements-tva-perimes', label: 'paiement(s) ou remboursement(s) de TVA dont l’écriture ne suit plus le mouvement', action: 'Réécrire ces paiements', nb: paiementsTvaPerimes.length, cible: 'ecritures', severite: 'erreur' },
    // « Erreur » : la 2035 compte ce que disent les parts, l'écriture autre chose. Défensif — la base
    // vérifie la somme —, mais une part écrite ou retirée par un autre chemin ne se verrait nulle part.
    { id: 'ventilations-incoherentes', label: 'mouvement(s) ventilé(s) dont les parts ne font plus le mouvement', action: 'Modifier ou annuler ces ventilations', nb: ventilationsFausses.length, cible: 'banque', severite: 'erreur' },
    // « Erreur » : la TVA collectée d'un assujetti manque à sa CA3 — l'onglet TVA écarte ces recettes —, et
    // la 2035 compte la taxe comme du chiffre d'affaires. Rien ne choisit le taux à la place du cabinet : la
    // fiche du mouvement le demande, et réaffecter (ou ventiler de nouveau) l'écrit. Dans la liste de Banque,
    // ces mouvements portent la pastille « TVA à choisir » — sous le filtre « Rapprochés » : le filtre par
    // défaut, « Non rapprochés », ne les montre pas.
    { id: 'recettes-affectees-assujetti', label: 'encaissement(s) affecté(s) ou ventilé(s) en recette sans taux de TVA, sur un dossier assujetti', action: 'Choisir leur taux de TVA', nb: recettesSansTva.length + recettesVentileesSansTva.length, cible: 'banque', severite: 'erreur', detail: 'Dans Banque, filtre « Rapprochés » : ils portent la pastille « TVA à choisir ».' },
    // « Erreur » comme une pièce validée sans catégorie : le virement a l'air traité — il est classé —,
    // donc plus personne ne le regarde, et il manque au FEC. L'onglet Virements les montre et les écrit.
    { id: 'virements-sans-ecriture', label: 'virement(s) personnel(s) sans écriture — absents du FEC et de la trésorerie', action: 'Écrire ces virements', nb: virementsAEcrire.length, cible: 'virements', severite: 'erreur' },
    // « Erreur » pour la même raison : l'échéance a l'air payée, son prélèvement est rapproché, et rien ne
    // l'écrit. L'onglet Cotisations les montre et les écrit.
    { id: 'cotisations-sans-ecriture', label: 'échéance(s) de cotisation payée(s) dont l’écriture manque ou n’est plus à jour — absentes du FEC', action: 'Écrire ces échéances', nb: cotisationsSansEcriture.length, cible: 'cotisations', severite: 'erreur' },
    // « Erreur » : un encaissement rapproché d'un appel compterait un remboursement comme une charge ; il
    // ne s'écrit pas, et l'échéance reste comptée à sa date. Le geste est d'annuler le rapprochement.
    { id: 'cotisations-rapprochement-refuse', label: 'rapprochement(s) d’une échéance de cotisation qui ne peuvent pas s’écrire', action: 'Annuler ces rapprochements', nb: cotisationsRefusees.length, cible: 'banque', severite: 'erreur', detail: 'Dans Banque, filtre « Rapprochés » : ils portent la pastille « Ne s’écrit pas ».' },
    // Avant les autres points d'Écritures : ceux-là disent qu'il MANQUE quelque chose, celui-ci que
    // le brouillon compte quelque chose de faux — une charge immobilisée y est comptée deux fois.
    { id: 'ecritures-sans-objet', label: 'écriture(s) que la pièce ne justifie plus', action: "Retirer l'écriture ou corriger la pièce", nb: ecrituresSansObjetDuDossier.length, cible: 'ecritures', severite: 'erreur' },
    // Même famille qu'« écriture(s) que la pièce ne justifie plus », de l'autre côté de la relation :
    // là c'est le brouillon qui compte quelque chose de faux, ici c'est le relevé qui AFFIRME être
    // justifié. En « erreur » parce que ce n'est pas un travail en retard mais une donnée démontrée
    // fausse — et parce que le mouvement est sorti de tous les écrans qui auraient pu le rattraper.
    // En « erreur » et non « attention » : ce n'est pas un travail en retard, c'est une déduction
    // qui part sur un document signé sans pièce derrière — et le registre est le seul écran qui
    // puisse encore la montrer, la piste d'audit ne couvrant pas les immobilisations.
    { id: 'immos-sans-justificatif', label: 'immobilisation(s) dont le justificatif a été supprimé', action: "Retrouver le justificatif ou retirer l'immobilisation", nb: immosSansJustificatif.length, cible: 'immobilisations', severite: 'erreur' },
    // « Erreur » : la 2035 compte la dotation depuis le registre, le FEC ne la porte que si elle est écrite —
    // les deux livrables diffèrent de la case CH, comme pour un virement personnel sans écriture.
    {
      id: 'dotations-a-ecrire', label: 'dotation(s) aux amortissements à écrire ou qui ne suivent plus le registre',
      action: 'Écrire les dotations', nb: dotationsManquantes.length, cible: 'immobilisations', severite: 'erreur',
      detail: exercicesDesDotations.length > 0 ? `Exercice${exercicesDesDotations.length > 1 ? 's' : ''} : ${exercicesDesDotations.join(', ')}.` : undefined,
    },
    // « Erreur », pour la même raison : la 2035 compte le forfait en case BJ depuis le cadre 7, le FEC ne le porte
    // que s'il est écrit. Le cadre 7 vit dans l'onglet Informations, avec la carte qui écrit les forfaits.
    {
      id: 'forfaits-a-ecrire', label: 'forfait(s) kilométrique(s) à écrire ou qui ne suivent plus le cadre 7',
      action: 'Écrire les forfaits', nb: forfaitsManquants.length, cible: 'informations', severite: 'erreur',
      detail: exercicesDesForfaits.length > 0 ? `Exercice${exercicesDesForfaits.length > 1 ? 's' : ''} : ${exercicesDesForfaits.join(', ')}.` : undefined,
    },
    // « Erreur » : en trésorerie, l'écriture d'une pièce payée en partie reste déséquilibrée, et le FEC la refuse.
    { id: 'pieces-payees-en-partie', label: 'pièce(s) payée(s) en partie — un paiement manque ?', action: 'Rapprocher le paiement qui manque', nb: payeesEnPartie.length, cible: 'banque', severite: 'erreur', detail: 'Le mouvement qui paie le reste se rapproche depuis sa fiche, dans Banque : la pièce y est offerte pour son reste. Sous « Rapprochés », ses paiements portent la pastille « Reste … à payer ».' },
    { id: 'rapproches-sans-objet', label: 'mouvement(s) bancaire(s) rapproché(s) sans justificatif', action: 'Annuler ou refaire ce rapprochement', nb: rapprochesSansObjet.length, cible: 'banque', severite: 'erreur' },
    // La forme groupée du point ci-dessus : une part d'un virement qui règle plusieurs pièces a perdu la
    // sienne, ou les parts ne font plus le mouvement. « Erreur » pour la même raison.
    { id: 'reglements-groupes-incoherents', label: 'virement(s) groupé(s) dont une part ne justifie plus rien ou dont les parts ne font plus le mouvement', action: 'Régler de nouveau ou annuler ces virements', nb: reglementsFaux.length, cible: 'banque', severite: 'erreur' },
    // « Erreur » : la 2035 compte la pièce une fois, et l'argent versé en trop n'y est nulle part.
    { id: 'pieces-payees-en-trop', label: 'pièce(s) payée(s) plus que leur montant — un paiement en double ?', action: 'Annuler le paiement en trop', nb: payeesEnTrop.length, cible: 'banque', severite: 'erreur' },
    // LA CAISSE (étape C3b) : trois points en « erreur », que la validation reprend sous les mêmes identifiants — ils ne
    // paraissent que sur une caisse lue ; absente, la liste est celle d'hier.
    ...(caisseLue === null ? [] : [
      // Défensif : la base écrit l'opération et son écriture d'un tenant. Un plan ou un statut de TVA changé depuis la saisie,
      // ou une restauration, la ferait diverger : la 2035 et le FEC ne diraient plus la même caisse.
      {
        // Depuis C9b, aussi le paiement d'une pièce écrite dont la contrepartie manque ou ne suit plus : son remède est
        // « Régénérer » — le libellé le dit avec la migration, celui d'hier sans elle.
        id: 'caisse-a-reprendre', label: PAIEMENT_PAR_LA_CAISSE_EXPORTE
          ? 'opération(s) de caisse dont l’écriture manque, ne suit plus l’opération ou ne peut plus s’écrire — à retirer et saisir de nouveau ; pour le paiement d’une pièce, à régénérer avec ses écritures'
          : 'opération(s) de caisse dont l’écriture manque, ne suit plus l’opération ou ne peut plus s’écrire — à retirer et saisir de nouveau',
        action: 'Voir la caisse', nb: caisseAReprendre.length, cible: 'caisse' as const, severite: 'erreur' as const,
        detail: caisseAReprendre.length > 0 ? detailDesOperationsAReprendre(caisseAReprendre) : undefined,
      },
      // Défensif aussi : la base refuse toute écriture qui rendrait la caisse négative (PCG, art. 1215-53). Seule une
      // restauration d'un état fautif la laisserait ainsi. Un point qui ne compte rien : la caisse l'est ou non.
      {
        id: 'caisse-negative', label: caisseEnNegatif === null ? '' : `La caisse est négative le ${caisseNegativeDite(caisseEnNegatif)} — son solde est débiteur ou nul`,
        action: 'Voir la caisse', nb: caisseEnNegatif === null ? 0 : 1, cible: 'caisse' as const, severite: 'erreur' as const,
        detail: caisseEnNegatif === null ? undefined : 'Une recette en espèces manque avant ce jour, ou une sortie d’espèces est de trop : la saisir, ou la retirer.',
        sansNombre: true,
      },
      // Le défaut K1 (étape C9b) : un mouvement d'avant l'ouverture du dossier, classé sur la caisse — les espèces comptées deux
      // fois. « Erreur » : le bilan de l'exercice porterait la caisse en double.
      ...(!PAIEMENT_PAR_LA_CAISSE_EXPORTE ? [] : [{
        id: 'caisse-mouvements-avant-ouverture',
        label: 'mouvement(s) du relevé classé(s) sur la caisse et daté(s) d’avant l’ouverture du dossier — leurs espèces sont déjà dans les comptes repris : à retirer de la caisse',
        action: 'Voir ces mouvements', nb: avantLOuverture.length, cible: 'banque' as const, severite: 'erreur' as const,
        detail: avantLOuverture.length > 0
          ? `${detailDesVersementsEnRecette(avantLOuverture)} Dans Banque, filtre « Rapprochés » : sa fiche le remet à traiter.`
          : undefined,
      }]),
      // CAISSE-Q2, (A) : la saisie d'une recette reconnaît les espèces des factures de son jour ; un encaissement enregistré,
      // retiré ou rattaché depuis change ce jour-là, et le total saisi se revoit.
      {
        id: 'recettes-de-caisse-a-revoir', label: 'recette(s) en espèces dont le jour a changé depuis la saisie — un encaissement en espèces d’une facture enregistré, retiré ou rattaché depuis',
        action: 'Voir la caisse', nb: recettesARevoir.length, cible: 'caisse' as const, severite: 'erreur' as const,
        detail: recettesARevoir.length > 0 && etatDeLaCaisse !== null ? detailDesRecettesARevoir(recettesARevoir, etatDeLaCaisse) : undefined,
      },
      // Les défauts 2 et 4 de la relecture du 01/11/2026 : « erreur », son écriture ne s'équilibrerait pas — la validation le
      // reprend sous le même identifiant. Avec la migration seulement : sans elle, aucun paiement par la caisse.
      ...(!PAIEMENT_PAR_LA_CAISSE_EXPORTE ? [] : [{
        id: 'caisse-paiements-a-retirer',
        label: 'paiement(s) en espèces que leur pièce contredit depuis — un type ou un montant changé : à retirer, puis à saisir de nouveau',
        action: 'Voir la caisse', nb: paiementsARetirer.length, cible: 'caisse' as const, severite: 'erreur' as const,
        detail: paiementsARetirer.length > 0 ? detailDesPaiementsARetirer(paiementsARetirer) : undefined,
      }]),
    ]),
    // « Erreur » : la validation de cet exercice se refuse sur cet écart (même identifiant que son préalable), et le dire ici, c'est
    // le dire AVANT le geste. Rien ne s'y corrige — les soldes reportés sont figés avec l'exercice validé — : le point renvoie
    // à l'onglet Bilan, à la ligne « Ouverture », qui montre l'écart compte par compte. Un point qui ne compte rien : l'exercice
    // entier est concerné ou ne l'est pas, d'où `sansNombre`.
    {
      id: 'ouverture-en-ecart', label: ecartDOuverture?.message ?? '', action: 'Voir l’ouverture dans le bilan',
      nb: ecartDOuverture === null ? 0 : 1, cible: 'bilan', severite: 'erreur', detail: ecartDOuverture?.detail, sansNombre: true,
    },
    // Plus de point « déclaration de TVA en écart avec le brouillon » (retiré le 28/09/2026) : le
    // brouillon date la TVA à la PIÈCE et ne porte aucune écriture pour un bien immobilisé, donc il
    // ne pouvait pas dire ce qu'une CA3 déposée sur les encaissements devait contenir — il aurait
    // crié à l'erreur sur des déclarations justes. L'onglet TVA compare chaque déclaration déposée au
    // calcul de SA période (lib/declarationTva.ts). Ne pas le remettre ici tant que la régularisation
    // d'une période déjà déposée (lignes 5B et 2C) n'est pas modélisée : l'écart y resterait
    // signalé en erreur même une fois régularisé.
    { id: 'confiance-basse', label: 'pièce(s) à faible confiance d\'extraction, à vérifier', action: 'Vérifier ces pièces', nb: piecesConfianceBasse.length, cible: 'pieces', severite: 'attention', detail: detailPiecesSansDate(piecesConfianceBasse) },
    // Une pièce reçue que ses preuves rattachent à deux factures émises, ou dont l'identité dit une autre nature que la
    // facture qu'elle désigne : elle n'est la jumelle d'aucune, donc d'aucun des deux contrôles du dessus (ligne 28.6).
    { id: 'jumelles-incoherentes', label: 'pièce(s) reçue(s) dont les preuves contredisent une facture émise', action: 'Vérifier ces pièces', nb: jumellesIncoherentes.length, cible: 'pieces', severite: 'attention', detail: detailJumellesIncoherentes(jumellesIncoherentes, facturesEmises, toutesPieces) },
    // LA JUMELLE INVERSÉE (ligne 28.65, étape VF6e ; lib/ventesJumelles.ts). « Attention » : rien n'est faux tant que la pièce
    // n'est pas validée — la base refuse de la valider sans sa marque (G3) —, et une pièce validée avant la bascule compte
    // comme hier ; dans Justificatifs, elle porte la pastille « À désigner : c’est la facture … », et sa fiche la désigne.
    { id: 'exemplaires-a-designer', label: 'pièce(s) de vente que le pont rattache à une facture émise, à désigner exemplaire de cette facture', action: 'Désigner ces pièces', nb: aDesigner.length, cible: 'pieces', severite: 'attention', detail: detailPiecesADesigner(aDesigner, facturesEmises, toutesPieces) },
    // Le symptôme d'une déclaration à tort (VF6-Q4) : un montant égal ne prouve rien — deux prestations du même prix sont
    // possibles —, d'où l'« attention ». Le détail nomme chaque pièce, que la recherche de Justificatifs retrouve.
    { id: 'ventes-hors-factures-a-verifier', label: 'pièce(s) déclarée(s) vente hors des factures dont le montant est celui d’une facture source sans exemplaire validé', action: 'Vérifier ces pièces', nb: horsFacturesAVerifier.length, cible: 'pieces', severite: 'attention', detail: detailVentesHorsFacturesAVerifier(horsFacturesAVerifier, facturesEmises, toutesPieces) },
    // Un statut à préciser n'est pas une erreur : le dossier retient ses pièces TVA comprise, comme avant que le
    // statut existe. Mais la mention de ses factures et ce qu'il doit à la facturation électronique en dépendent
    // (lib/statutTva.ts), et c'est un réglage à faire une fois — d'où le bloc « Paramétrage ».
    {
      id: 'statut-tva', label: 'Statut de TVA à préciser — la mention de ses factures et ce qu’il doit à la facturation électronique en dépendent',
      action: 'Préciser le statut', nb: statutTva == null ? 1 : 0, cible: 'tva', severite: 'attention', sansNombre: true,
    },
    { id: 'comptes-manquants', label: 'catégorie(s) sans compte comptable', action: 'Compléter le compte comptable', nb: catSansCompte.length, cible: 'ecritures', severite: 'attention' },
    { id: 'postes-manquants', label: 'catégorie(s) sans poste 2035', action: 'Compléter le poste 2035', nb: catSansPoste.length, cible: 'cloture', severite: 'attention' },
    { id: 'sans-tva', label: 'pièce(s) validée(s) sans TVA renseignée', action: 'Compléter la TVA', nb: sansTva.length, cible: 'ecritures', severite: 'attention' },
    {
      id: 'sans-contrepartie',
      // En engagement, une facture sans règlement est une dette ou une créance qui court encore : le
      // point dit ce qui manque — un paiement rapproché —, pas une écriture incomplète.
      label: modele.mode === 'engagement' ? 'facture(s) sans règlement rapproché' : 'écriture(s) en attente de rapprochement bancaire',
      action: 'Voir les écritures à rapprocher', nb: nbSansContrepartie, cible: 'banque', severite: 'attention',
    },
    { id: 'lignes-non-rapprochees', label: 'ligne(s) bancaire(s) non rapprochée(s)', action: 'Voir les opérations à rapprocher', nb: lignesNonRapprochees.length, cible: 'banque', severite: 'attention' },
    // LES VENTES FACTURÉES D'UN DOSSIER QUI A BASCULÉ (ligne 28.65, étape VF5f ; lib/ventesDeLaChecklist.ts). « Attention »
    // jusqu'à VF7, qui les rendra préalables à la validation (conception d'EC-Q3, § 11) ; prealablesValidation.test.ts les
    // tient pour écartés d'ici là. Un mouvement réservé se voit dans Banque, sous sa pastille, et sa fiche le classe.
    {
      id: 'mouvements-reserves', label: 'mouvement(s) réservé(s) à des encaissements de factures, à classer',
      action: 'Classer ces mouvements', nb: mouvementsReserves.length, cible: 'banque', severite: 'attention',
      detail: 'Dans Banque, filtre « Non rapprochés » : ils portent la pastille « Réservé à l’encaissement de la facture … ». Leur fiche les classe par leurs encaissements.',
    },
    // L'onglet Banque ne LISTE pas un encaissement sans mouvement — il ne le propose que dans la fiche d'un crédit libre —,
    // la vue « Règlements » de l'onglet Factures, si : une ligne par encaissement, et sa colonne « Mouvement ». Le point y
    // mène, et son détail les nomme (un point qui compte doit pouvoir montrer ce qu'il compte). Un chèque remis le 31
    // décembre et crédité en janvier est un en-cours légitime : d'où l'« attention », que VF7 ne durcira que pour un
    // virement ou un prélèvement.
    {
      id: 'encaissements-sans-mouvement', label: 'encaissement(s) de factures par virement, prélèvement, chèque, carte ou effet sans mouvement du relevé',
      action: 'Voir ces règlements', nb: encaissementsSansMouvement.length, cible: 'factures', severite: 'attention',
      detail: ventes.etat === 'lue' && encaissementsSansMouvement.length > 0 ? detailDesEncaissementsSansMouvement(ventes) : undefined,
    },
    // LE VERSEMENT D'ESPÈCES RANGÉ EN RECETTE (étape C3b ; conception, § 4 a). « Attention » : un libellé est un symptôme,
    // jamais une preuve — mais un vrai versement rangé en recette compte deux fois des espèces que la caisse compte déjà. Le
    // point mène à Banque, où le mouvement se voit sous « Rapprochés », et son détail les nomme ; sa fiche le remet à traiter,
    // puis le classe sur la caisse. Il ne paraît que sur une caisse lue.
    ...(caisseLue === null ? [] : [
      {
        id: 'versements-especes-en-recette', label: 'crédit(s) du relevé dont le libellé dit un versement d’espèces, rangé(s) en recette — des espèces que la caisse compte peut-être déjà',
        action: 'Voir ces mouvements', nb: versementsEnRecette.length, cible: 'banque' as const, severite: 'attention' as const,
        detail: versementsEnRecette.length > 0
          ? `Dans Banque, filtre « Rapprochés » : ${detailDesVersementsEnRecette(versementsEnRecette)} Un versement se remet à traiter, puis se classe sur la caisse.`
          : undefined,
      },
      // LA PIÈCE À VALIDER QU'UN PAIEMENT PAR LA CAISSE CITE (conception reprise, § 8 ; le défaut 1 de la relecture du
      // 01/11/2026). « Attention » : une pièce à valider est un travail en cours, pas une anomalie — mais sa sortie d'espèces
      // n'est nulle part au brouillon tant qu'elle ne l'est pas, et la validation de l'exercice du paiement l'attend
      // (`pieces-a-valider`, qui la compte quelle que soit sa date). Avec la migration seulement.
      ...(!PAIEMENT_PAR_LA_CAISSE_EXPORTE ? [] : [{
        id: 'pieces-a-valider-payees-par-la-caisse',
        label: 'pièce(s) à valider payée(s) par la caisse — leur sortie d’espèces ne s’écrit qu’une fois la pièce validée et ses écritures générées',
        action: 'Valider ces pièces', nb: new Set(piecesAValiderPayees.map((x) => x.piece.id)).size, cible: 'pieces' as const,
        severite: 'attention' as const,
        detail: piecesAValiderPayees.length > 0 ? detailDesPaiementsDePiecesAValider(piecesAValiderPayees) : undefined,
      }]),
    ]),
    // « Attention » et non « erreur » : ignorer est le bon geste pour un doublon, et rien ne les distingue d'ici d'un
    // mouvement réel oublié. Le point les montre avec ce qu'ils emportent, le cabinet tranche.
    {
      id: 'mouvements-ignores', label: 'mouvement(s) ignoré(s), absent(s) du FEC — un doublon, ou un mouvement à classer ?',
      action: 'Voir les mouvements ignorés', nb: ignoresHorsFec.length, cible: 'banque', severite: 'attention',
      detail: `Dans Banque, filtre « Ignorés »${montantsIgnores ? ` : ${montantsIgnores}` : ''}. Un doublon reste ignoré ; un mouvement réel se remet à traiter et se classe.`,
    },
    // « Attention » : un lettrage qui ne tient plus n'est pas porté au FEC, donc rien de faux n'en sort — la facture
    // qu'il soldait reparaît simplement ouverte. La liste qui dit pourquoi, et d'où le défaire, est sous les comptes de
    // tiers de la Balance des comptes.
    {
      id: 'lettrages-qui-ne-tiennent-plus', label: 'lettrage(s) fait(s) à la main qui ne se solde(nt) plus',
      action: 'Voir les comptes de tiers', nb: lettragesQuiNeTiennentPlus.length, cible: 'statistiques', severite: 'attention',
      detail: 'Ils ne sont pas portés au FEC : la liste « Lettrages faits à la main », sous les comptes de tiers, dit pourquoi et les défait.',
    },
    // « Attention » : une CA3 en retard, ou déposée sans être enregistrée ici. Sa TVA reste aux comptes 4457 et 4456,
    // que rien ne solde, et son prélèvement ne trouve aucune déclaration à laquelle se rapprocher. Un dossier au régime
    // simplifié dépose jusqu'aux exercices de 2026 une CA12 que l'application ne prépare pas : le détail le dit.
    {
      id: 'periodes-tva-non-declarees', label: 'période(s) de TVA dont la déclaration n’est pas enregistrée — leur TVA reste aux comptes 4457 et 4456',
      action: 'Préparer ces déclarations', nb: periodesTvaEnRetard.length, cible: 'tva', severite: 'attention',
      detail: `${libellesEnRetard}. Une CA3 déposée ailleurs s’enregistre dans l’onglet TVA ; jusqu’aux exercices de 2026, un dossier au régime simplifié dépose une CA12, que l’application ne prépare pas.`,
    },
    // « Attention » et non « erreur » : c'est un travail en retard — le prélèvement est dans le relevé, à
    // traiter —, pas une donnée démontrée fausse. Mais il dit ce que le retard coûte.
    { id: 'echeances-emprunt-non-rapprochees', label: 'échéance(s) d’emprunt couverte(s) par le relevé sans mouvement rapproché — intérêts non comptés', action: 'Rapprocher ces prélèvements', nb: echeancesManquantes.length, cible: 'banque', severite: 'attention' },
    {
      id: 'previsionnelles-sans-paiement', label: 'échéance(s) prévisionnelle(s) de cotisation qu’aucun prélèvement ne paie alors que le relevé couvre leur date — l’appel définitif l’a peut-être remplacée',
      action: 'Retirer ou rapprocher ces échéances', nb: previsionnellesImpayees.length, cible: 'cotisations', severite: 'attention',
      detail: 'Comptées à leur échéance, elles s’ajoutent dans la 2035 à l’appel qui les a remplacées. Dans Cotisations, elles portent le badge « Prévisionnel ».',
    },
  ]
  const pointsATraiter = tousLesPointsATraiter.filter((p) => p.nb > 0)
  // Trois groupes distincts (voir audit ergonomie) plutôt qu'un seul total mélangeant des natures très
  // différentes ("315 à vérifier" ne dit rien d'actionnable si 312 sont des lignes bancaires courantes
  // et 3 des vraies erreurs) : paramétrage (config à finir une fois, ne dépend pas du client), travail
  // courant du cabinet (à traiter au fil de l'eau), documents attendus (dépend du client, voir `items`
  // plus bas). Un déséquilibre ou une désynchronisation reste plus urgent qu'une case de paramétrage,
  // d'où la sévérité conservée à l'intérieur du groupe "Travail à effectuer".
  const IDS_PARAMETRAGE = new Set(['statut-tva', 'comptes-manquants', 'postes-manquants'])
  const pointsParametrage = pointsATraiter.filter((p) => IDS_PARAMETRAGE.has(p.id))
  const pointsTravail = pointsATraiter.filter((p) => !IDS_PARAMETRAGE.has(p.id))

  // UN JEU DE POINTS PAR EXERCICE RÉCLAMÉ. Au 1er janvier, l'exercice révolu reste réclamé en entier
  // tant que sa clôture n'est pas cochée — c'est le moment précis où le cabinet court après ses
  // pièces, et où cette liste repartait à zéro en annonçant qu'il ne restait rien.
  const pointsParExercice = exercices.flatMap((ex): (DocumentAttendu & { annee: number })[] => {
    const manquants = ex.annee === anneeCourante ? moisManquants : moisManquantsDe(ex, lignes)
    const cotisationsEx = cotisations.filter((c) => anneeDe(c.echeance) === ex.annee)
    const piecesEx = toutesPieces.filter((p) => p.date_piece && anneeDe(p.date_piece) === ex.annee)
    const recus = ex.moisAttendus.length - manquants.length
    return [
      {
        annee: ex.annee,
        id: `banque-${ex.annee}`,
        label: `Relevés bancaires ${ex.annee}`,
        ok: manquants.length === 0,
        // Aucun mois attendu (janvier, aucun mois encore révolu) : rien à réclamer pour l'instant,
        // pas un "0/0" qui se lirait comme un compte à rebours étrange.
        detail: ex.moisAttendus.length === 0
          ? "Aucun mois encore révolu cette année"
          : manquants.length > 0
            ? `Mois manquants : ${manquants.map((m) => NOMS_MOIS[m - 1]).join(', ')}`
            : `${recus}/${ex.moisAttendus.length} mois reçus`,
        cible: 'banque',
        action: 'Importer le relevé manquant',
      },
      {
        annee: ex.annee,
        id: `cotisations-${ex.annee}`,
        label: `Appels de cotisation ${ex.annee}`,
        ok: cotisationsEx.length > 0,
        detail: cotisationsEx.length > 0 ? `${cotisationsEx.length} échéance(s) enregistrée(s)` : 'Aucune échéance enregistrée pour cet exercice',
        cible: 'cotisations',
        action: 'Voir les cotisations',
      },
      {
        annee: ex.annee,
        id: `factures-${ex.annee}`,
        label: `Factures / pièces ${ex.annee}`,
        ok: piecesEx.length > 0,
        // La mention des pièces sans date ne se porte qu'UNE fois, sur l'exercice en cours : elles
        // n'appartiennent à aucun exercice, et la répéter sous chacun ferait croire à un manque par
        // exercice.
        detail: (piecesEx.length > 0
          ? `${piecesEx.length} pièce(s) datée(s) de cet exercice`
          : 'Aucune pièce datée de cet exercice') + (ex.annee === anneeCourante ? mentionSansDate : ''),
        cible: 'pieces',
        action: 'Voir les pièces',
      },
    ]
  })
  // Un point SATISFAIT d'un exercice révolu n'apprend rien : la liste dit ce qu'il reste à envoyer,
  // pas ce qui a déjà été reçu il y a un an (voir pointsUtiles).
  const items: DocumentAttendu[] = pointsUtiles(pointsParExercice, anneeCourante)

  // `!info && !infoInconnue` : « il n'y a rien » et « on n'a pas lu » ne donnent pas le même point.
  // Le second est dit à part (voir le bandeau), parce que le contraire — réclamer des informations
  // déjà saisies — enverrait le cabinet relancer un client pour rien, sur l'écran dont c'est
  // justement le métier de dire ce qui manque.
  if (!info) {
    // Le point n'est poussé QUE si l'absence est démontrée. Une lecture refusée se dit dans le
    // bandeau, jamais ici : les deux se ressembleraient trop dans une liste de points à traiter.
    if (!infoInconnue) {
      items.push({
        id: 'informations',
        label: 'Informations complémentaires du client',
        ok: false,
        detail: 'Véhicule, tickets restaurant, chèques vacances… à renseigner une fois',
        cible: 'informations',
        action: 'Compléter les informations',
      })
    }
  } else {
    if (info.vehicule_type === 'societe') {
      const vehiculeTrouve = immobilisations.some((i) => {
        const nature = natures.find((n) => n.id === i.nature_id)
        return nature && /v[eé]hicule|voiture/i.test(nature.libelle)
      })
      items.push({
        id: 'vehicule',
        label: "Facture d'achat du véhicule de société",
        ok: vehiculeTrouve,
        detail: vehiculeTrouve ? undefined : 'Aucune immobilisation de type véhicule enregistrée',
        cible: 'immobilisations',
        action: 'Enregistrer le véhicule',
      })
    }
    if (info.tickets_restaurant) {
      items.push({
        id: 'tickets',
        label: 'Justificatif titres-restaurant reçu',
        ok: info.justificatif_tickets_restaurant_recu,
        detail: 'À cocher une fois le justificatif obtenu du client',
        coche: 'justificatif_tickets_restaurant_recu',
      })
    }
    if (info.cheques_vacances) {
      items.push({
        id: 'vacances',
        label: 'Justificatif chèques-vacances reçu',
        ok: info.justificatif_cheques_vacances_recu,
        detail: 'À cocher une fois le justificatif obtenu du client',
        coche: 'justificatif_cheques_vacances_recu',
      })
    }
  }

  return {
    tousLesPointsATraiter, pointsATraiter, pointsParametrage, pointsTravail, documentsAttendus: items, exerciceCourant,
    moisManquants, moisRecus, piecesConfianceBasse,
  }
}
