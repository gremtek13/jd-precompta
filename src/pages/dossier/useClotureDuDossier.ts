import { useBanquesDuDossier } from '../../lib/useBanquesDuDossier'
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { anneeDe, aujourdHuiAParis, aujourdHuiSql } from '../../lib/format'
import { categoriesSansPoste as calculerCategoriesSansPoste, piecesValideesSansCategorie } from '../../lib/controles'
import {
  calculerDeclaration2035, partCsgNonDeductible, type Declaration2035, type PartCsgNonDeductible } from '../../lib/declaration2035'
import { fraisDesMouvements } from '../../lib/ecrituresVentesFacturees'
import { acquisitionsDesBiens, dotationDeLExercice } from '../../lib/amortissements'
import { amortissementsSousLeBareme } from '../../lib/forfaitKilometrique'
import {
  arrondirPourFormulaire, carburantSousLeBareme, casesNegatives, doublonFraisVehicules,
  incoherencesDesCases, partDeBKSansNature, valeursDesCases } from '../../lib/cases2035'
import {
  type CarburantSousLeBareme, type DoublonFraisVehicule, type IncoherenceCase, type PosteNonRattache } from '../../lib/cases2035'
import { comptesPartagesEntreCases, concordance2035 } from '../../lib/concordance2035'
import { immobilisationsSansJustificatif } from '../../lib/controles'
import { lireAnneesCloturees } from '../../lib/clotureExercice'
import { anneesDesRattachements, paiementsDesPieces, rattachements } from '../../lib/rattachement'
import { partsDuReleve } from '../../lib/partsDuReleve'
import { natureDuCompte } from '../../lib/affectationBanque'
import { cotisationsComptees } from '../../lib/cotisationRapprochee'
import { echeancesNonRapprochees } from '../../lib/echeanceEmprunt'
import type { Emprunt } from '../../lib/emprunts'
import type { ModeleComptable } from '../../lib/engagement'
import { chargerControlesReleves } from '../../lib/controlesReleves'
import { lireLesComptesDuDossier } from '../../lib/comptesBancairesLecture'
import { COMPTES_BANCAIRES_PREVUS } from '../../lib/comptesBancaires'
import type { LectureDesComptes } from '../../lib/importParCompte'
import { chargerDoublonsDeTexte, type DoublonDeTexte } from '../../lib/doublonsTexte'
import {
  prealablesDeValidation, prochainExerciceAValider, type ChampsBncDeLaValidation, type EtatsDesVentesDeLaValidation } from '../../lib/prealablesValidation'
import { CHAMPS_BNC_EXPORTES } from '../../lib/champsBncDuFec'
import { lireLesChampsBnc, type LectureDesChampsBnc } from '../../lib/champsBncLecture'
import type { FacturePourJumelle, TransmissionPourJumelle } from '../../lib/ventesJumelles'
import { lectureDuDossier, lireLesVentesFacturees, type LectureVentesFacturees } from '../../lib/ventesFactureesLecture'
import { ecrituresDesVentesPourLa2035, etatsDesVentesFacturees, mouvementsClassesParEncaissements } from '../../lib/ecrituresVentesFactureesEcran'
import { lireLesSourcesDesEcrituresDeVente, type LectureSourcesDesEcrituresDeVente } from '../../lib/ecrituresVentesFactureesLecture'
import {
  demandeDeValidation, exerciceQuiFige, frontiereDeValidation, instantane2035 } from '../../lib/validationExercice'
import { ventesDeLaChecklist } from '../../lib/ventesDeLaChecklist'
import type {
  ANouveau, Categorie, ControleReleveBancaire, CotisationDeclaree, DeclarationTva, EcritureBrouillon, ExerciceValide, Immobilisation,
  LigneBancaire, NatureImmobilisation, PeriodiciteTva, Piece, ReglementGroupe, SoldeReporte, VehiculeDossier, VentilationBancaire } from '../../lib/types'
import { useAnnee } from '../../context/AnneeContext'
import { useExercicesValides } from '../../context/ExercicesValidesContext'
import { useAuth } from '../../context/AuthContext'
import { lireTout } from '../../lib/lectureComplete'
import { lireLesSoldesReportes } from '../../lib/soldesReportesLecture'
import { messageErreur } from '../../lib/messageErreur'
import { AUCUNE_FACTURE_SOURCE, horsDesExemplairesDesSources } from '../../lib/facturesSources'
import { lireLaCaisse, type LectureDeLaCaisse } from '../../lib/caisseLecture'
import { lireLesEcrituresLibres } from '../../lib/ecrituresLibresLecture'
import { ecrituresLibresPourLesMoteurs, motifDesEcrituresLibres, type LectureDesEcrituresLibres } from '../../lib/ecrituresLibresVue'
import { ECRITURES_LIBRES_ABSENTES } from '../../lib/ecrituresLibresDesExports'
import { lireLesNotesDeFraisDesControles } from '../../lib/notesDeFraisLecture'
import { NOTES_DE_FRAIS_SANS_OBJET, type NotesDeFraisDesControles } from '../../lib/notesDeFraisEnComptabilite'
import { AUCUNE_SAISIE_2035, motifDesSaisies2035, SAISIES_2035_EXPORTEES, saisiesDeLExercice } from '../../lib/saisies2035'
import type { LectureDesSaisies2035 } from '../../lib/saisies2035'
import { lireLesSaisies2035 } from '../../lib/saisies2035Lecture'
import { inventaireDeLaLecture, lireLInventaireDeLaValidation, motifDeLInventaire, type LectureDeLInventaire } from '../../lib/inventaireLecture'
import { INVENTAIRE_PREVU } from '../../lib/inventaire'
import {
  SAISIES_2035E_EXPORTEES } from '../../lib/saisies2035E'
import type { LectureDesSaisies2035E } from '../../lib/saisies2035E'
import { lireLesSaisies2035E } from '../../lib/saisies2035ELecture'
import { paiementsParLaCaisseDuDossier } from '../../lib/paiementParLaCaisse'
import { operationsDeCaisseDuDossier, operationsPourLesControles } from '../../lib/controlesDeLaCaisse'
import {
  motifDeLaCaisse, recettesDe, recettesDeCaisseDuDossier, recettesPourLesMoteurs } from '../../lib/recettesDeCaisse'

// Palier 5, briques 5 et 6 réunies — postes de la 2035 et clôture brouillon. Regroupe et totalise
// par poste (recettes, achats, charges sociales, amortissements...) sans jamais calculer d'impôt.
// Chaque pièce rejoint l'exercice de son PAIEMENT quand le rapprochement bancaire le connaît, sa date
// de facture sinon — et l'écran liste celles qui comptent ainsi faute de paiement (voir
// lib/rattachement.ts) : c'est la règle BNC des recettes encaissées et des dépenses payées.
// `modele` : un dossier tenu en ENGAGEMENT (BIC, IS) ne produit pas de 2035 — elle déclare des
// bénéfices non commerciaux, tenus en trésorerie. L'écran le dit, et n'y garde que la clôture de
// l'exercice, qui ne dépend pas de la déclaration (purge du texte lu, fin des relances), et sa
// validation. Le modèle ENTIER, pas seulement son mode : la validation juge l'écriture d'un virement
// personnel et d'un forfait sur le compte du dirigeant qu'il désigne (lib/prealablesValidation.ts).
//
// LA VALIDATION D'UN EXERCICE (ligne 26.6, étape d) vit ici, sous la déclaration qu'elle fige : une carte
// par exercice dit ce qui l'empêche, valide, puis montre l'exercice validé (ValidationExerciceCard). Un
// exercice validé en trésorerie montre la 2035 TELLE QU'ELLE A ÉTÉ VALIDÉE — l'instantané gardé par la
// base —, pas un calcul d'aujourd'hui, et dit les cases où un nouveau calcul ne la retrouverait plus.
import { prealablesPourLaRevision, type PrealablesDeLaRevision } from '../../lib/prealablesDeLaRevision'

// LA LECTURE ET LES CALCULS DE CLÔTURE, ÉCRITS UNE FOIS (ligne 41) : la 2035 de chaque exercice, ses contrôles et les
// préalables de sa validation (lib/prealablesValidation.ts), tirés des mêmes lectures. Clôture les montre et y agit ; la
// Révision montre les préalables de l'exercice, en lecture seule (`prealablesDeLExercice`). Une lecture que deux écrans
// comptent s'écrit une fois : sortie de ClotureTab telle quelle, pour que la Révision ne dise jamais d'autres préalables
// que ceux que la carte « Valider l'exercice » juge.
export function useClotureDuDossier({ dossierId, assujettiTva, periodiciteTva, modele, ventesParLesFactures }: {
  dossierId: string
  assujettiTva: boolean
  periodiciteTva: PeriodiciteTva
  modele: ModeleComptable
  ventesParLesFactures: boolean
}) {
  // Les banques du dossier (MCB5) : la composition des ventes facturées écrit la jambe de banque au 512 du mouvement.
  const { banques } = useBanquesDuDossier(dossierId, modele.plan)
  const modeComptable = modele.mode
  // Seul le chef du cabinet valide un exercice (décision du 04/10/2026) — la base le refuse aux autres, et la
  // carte ne leur propose pas le geste.
  // `isSuperAdmin` : une catégorie commune à tous les cabinets ne se règle que par lui (lib/categoriesCommunes.ts).
  const { estChef, isSuperAdmin } = useAuth()
  const [categories, setCategories] = useState<Categorie[]>([])
  const [piecesValidees, setPiecesValidees] = useState<Piece[]>([])
  // Non nul quand l'une des QUATRE collections dont dépend la déclaration n'a pas pu être lue en
  // entier — pièces, catégories, immobilisations, cotisations, véhicules. Cet écran produit une
  // déclaration : une 2035 calculée sur une partie de ses entrées est plausible, fausse, et signée,
  // et le formulaire n'a nulle part où dire qu'il est amputé. Le remplissage se refuse donc.
  // Le nom dit « lecture » et non « pièces » : il a porté le second pendant que le garde-fou ne
  // vérifiait qu'une entrée sur quatre, ce qu'aucune relecture de l'écran ne pouvait montrer.
  const [lectureIncomplete, setLectureIncomplete] = useState<string | null>(null)
  // LES SAISIES DU CABINET DE LA 2035 (étapes 2035S3 à S5), gardées AVEC le dossier lu. Drapeau baissé, absentes d'emblée,
  // sans lecture : la 2035 est celle d'hier. Levé, rien ne se calcule pour de bon avant qu'elles soient revenues entières —
  // `saisiesIncompletes` suspend le PDF et la validation, comme toute lecture partielle.
  const [saisiesLues, setSaisiesLues] = useState<LectureDesSaisies2035 | null>(null)
  const lectureDesSaisies: LectureDesSaisies2035 | null = !SAISIES_2035_EXPORTEES ? { dossierId, etat: 'absentes' }
    : saisiesLues?.dossierId === dossierId ? saisiesLues : null
  const saisiesIncompletes = motifDesSaisies2035(lectureDesSaisies)
  const relireLesSaisies = useCallback(async () => {
    if (!SAISIES_2035_EXPORTEES) return
    const lecture = await lireLesSaisies2035(dossierId)
    setSaisiesLues(lecture)
  }, [dossierId])
  useEffect(() => {
    if (!SAISIES_2035_EXPORTEES) return
    let annule = false
    void lireLesSaisies2035(dossierId).then((lecture) => { if (!annule) setSaisiesLues(lecture) })
    return () => { annule = true }
  }, [dossierId])
  // L'INVENTAIRE DU DOSSIER (ligne 35, INV3 ; lib/inventaireLecture.ts), gardé AVEC le dossier lu, pour la validation seule.
  // Drapeau baissé, sans objet d'emblée, sans lecture : la validation d'hier. Levé, elle attend qu'il soit revenu entier
  // (`inventaireIncomplet` la suspend), et un exercice d'engagement se dit retenu par son inventaire avant le clic.
  const [inventaireLu, setInventaireLu] = useState<LectureDeLInventaire | null>(null)
  const lectureDeLInventaire: LectureDeLInventaire | null = !INVENTAIRE_PREVU ? { dossierId, etat: 'sans_objet' }
    : inventaireLu?.dossierId === dossierId ? inventaireLu : null
  const inventaireIncomplet = motifDeLInventaire(lectureDeLInventaire)
  useEffect(() => {
    if (!INVENTAIRE_PREVU) return
    let annule = false
    void lireLInventaireDeLaValidation(dossierId).then((lecture) => { if (!annule) setInventaireLu(lecture) })
    return () => { annule = true }
  }, [dossierId])
  // LES SAISIES DE L'ANNEXE 2035-E (ligne 48), gardées AVEC le dossier lu. Drapeau baissé, absentes, sans lecture :
  // l'annexe suppose ce qu'elle supposait hier, et le dit. Levé, l'annexe d'un exercice reçoit sa saisie, lue en entier.
  const [saisies2035ELues, setSaisies2035ELues] = useState<LectureDesSaisies2035E | null>(null)
  const lectureDesSaisies2035E: LectureDesSaisies2035E | null = !SAISIES_2035E_EXPORTEES ? { dossierId, etat: 'absentes' }
    : saisies2035ELues?.dossierId === dossierId ? saisies2035ELues : null
  const relireLesSaisies2035E = useCallback(async () => {
    if (!SAISIES_2035E_EXPORTEES) return
    setSaisies2035ELues(await lireLesSaisies2035E(dossierId))
  }, [dossierId])
  useEffect(() => {
    if (!SAISIES_2035E_EXPORTEES) return
    let annule = false
    void lireLesSaisies2035E(dossierId).then((lecture) => { if (!annule) setSaisies2035ELues(lecture) })
    return () => { annule = true }
  }, [dossierId])
  const [immobilisations, setImmobilisations] = useState<Immobilisation[]>([])
  const [cotisations, setCotisations] = useState<CotisationDeclaree[]>([])
  // Cadre 7 du 2035-B : le total des indemnités kilométriques alimente la case BJ, ligne 23.
  const [vehicules, setVehicules] = useState<VehiculeDossier[]>([])
  // Les mouvements rapprochés d'une pièce : ce sont eux qui la DATENT (voir lib/rattachement.ts).
  // TOUTES les lignes du relevé : la validation regarde aussi ce qui reste à traiter et les virements
  // personnels (lib/prealablesValidation.ts). La 2035 ne lit que les rapprochées, comme avant.
  const [toutesLesLignes, setToutesLesLignes] = useState<LigneBancaire[]>([])
  const lignesBancaires = toutesLesLignes.filter((l) => l.statut === 'rapprochee')
  // Les parts des mouvements ventilés sur plusieurs comptes (lib/ventilationBanque.ts) : elles vivent
  // dans leur propre table, et la 2035 les compte comme des mouvements affectés.
  const [ventilations, setVentilations] = useState<VentilationBancaire[]>([])
  // Les parts des virements qui règlent PLUSIEURS pièces (lib/reglementGroupe.ts) : chacune date sa pièce
  // comme un rapprochement simple.
  const [reglements, setReglements] = useState<ReglementGroupe[]>([])
  // Les déclarations de TVA enregistrées : l'arrondi de leur liquidation est un produit ou une charge de la 2035
  // (lib/liquidationTva.ts).
  const [declarationsTva, setDeclarationsTva] = useState<DeclarationTva[]>([])
  // Les emprunts, pour dire les échéances que l'échéancier prévoit dans l'exercice et qu'aucun
  // mouvement ne paie (lib/echeanceEmprunt.ts). Leur drapeau est à part : la 2035 lit le découpage
  // gardé sur les mouvements rapprochés, pas les emprunts — lus en partie, ils ne faussent aucune case,
  // ils taisent seulement une échéance manquante.
  const [emprunts, setEmprunts] = useState<Emprunt[]>([])
  const [empruntsIncomplets, setEmpruntsIncomplets] = useState<string | null>(null)
  // Les natures d'immobilisation, pour reconnaître un VÉHICULE au registre (compte 2182) amorti l'année où le
  // barème kilométrique est retenu (lib/forfaitKilometrique.ts). Leur drapeau est à part, comme celui des
  // emprunts : lues en partie, elles ne faussent aucune case, elles taisent seulement ce signal.
  const [natures, setNatures] = useState<NatureImmobilisation[]>([])
  const [naturesIncompletes, setNaturesIncompletes] = useState<string | null>(null)
  // Le brouillon d'écritures et l'ouverture d'un dossier repris, pour la concordance de la 2035 avec les
  // écritures. Leur drapeau suspend la CONCORDANCE, pas le formulaire : la 2035 ne dépend pas des écritures.
  const [ecritures, setEcritures] = useState<EcritureBrouillon[]>([])
  // Les à-nouveaux entiers : la validation numérote ceux de l'exercice qu'ils ouvrent, et fige leurs libellés.
  const [aNouveaux, setANouveaux] = useState<ANouveau[]>([])
  // Les soldes reportés par la validation de chaque exercice (ligne 34, lib/reportDesSoldes.ts) : ceux du 1er janvier
  // ouvrent l'exercice suivant, et sa validation les numérote comme une reprise.
  const [soldesReportes, setSoldesReportes] = useState<SoldeReporte[]>([])
  // À part du drapeau de la validation qui le comprend : un exercice validé dit l'ouverture qu'il a écrite, et se tait
  // seulement quand ce sont les soldes reportés qu'on n'a pas pu lire.
  const [reportesIncomplets, setReportesIncomplets] = useState<string | null>(null)
  const [ouverture, setOuverture] = useState<string | null>(null)
  // CE QUE LA VALIDATION LIT EN PLUS DE LA DÉCLARATION : les pièces à valider (un exercice ne se fige pas avec
  // une pièce en suspens), les exercices déjà validés, et deux contrôles de la Checklist. Ces deux-là sont nuls
  // quand on n'a pas pu les lire : ils ne se taisent pas, ils deviennent un préalable.
  const [piecesAValider, setPiecesAValider] = useState<Piece[]>([])
  const [exercicesValides, setExercicesValides] = useState<ExerciceValide[]>([])
  const [controlesReleves, setControlesReleves] = useState<ControleReleveBancaire[] | null>(null)
  // Les comptes bancaires du dossier (ligne 26.6, MCB4) : la validation juge la banque compte par compte, et le rappel du relevé
  // de janvier nomme chaque compte dès deux. Drapeau baissé, `sans_objet` d'emblée : rien ne change, à aucun instant.
  const [lectureDesComptes, setLectureDesComptes] = useState<LectureDesComptes>(
    COMPTES_BANCAIRES_PREVUS ? { etat: 'en_cours' } : { etat: 'sans_objet' })
  const [doublonsTexte, setDoublonsTexte] = useState<DoublonDeTexte[] | null>(null)
  // Les factures émises validées et leurs transmissions (ligne 28.6, lib/ventesJumelles.ts) : la validation refuse une
  // vente que plusieurs pièces portent. Lues en partie, elles suspendent la validation, pas la 2035, qui ne les lit pas.
  const [facturesEmises, setFacturesEmises] = useState<FacturePourJumelle[]>([])
  const [transmissions, setTransmissions] = useState<TransmissionPourJumelle[]>([])
  // LES VENTES FACTURÉES (ligne 28.6, étape VF3b1 ; lib/ventesFactureesLecture.ts) : une facture SOURCE de sa vente compte
  // dans la 2035 par ses encaissements, et son exemplaire ne compte plus. Lues tout ou rien, à côté des autres entrées de la
  // déclaration, et gardées AVEC le dossier qui les a demandées : tant qu'elles ne sont pas revenues entières pour ce
  // dossier, aucune 2035 ne se calcule — ni chiffre, ni formulaire, ni validation.
  const [lectureVentes, setLectureVentes] = useState<LectureVentesFacturees | null>(null)
  // LES SOURCES DES ÉCRITURES DES VENTES FACTURÉES d'un dossier qui a basculé (lib/ecrituresVentesFactureesLecture.ts) : la
  // 2035 en tire les frais d'un mouvement d'encaissements, par la composition même de l'onglet Écritures (VF4C3-Q1). Lues
  // tout ou rien avec le reste, gardées AVEC le dossier qui les a demandées, jamais lues pour un dossier qui n'a pas basculé :
  // tant qu'elles ne sont pas revenues entières pour ce dossier, aucune 2035 ne se calcule.
  const [lectureSourcesVentes, setLectureSourcesVentes] = useState<LectureSourcesDesEcrituresDeVente | null>(null)
  // LA CAISSE DU DOSSIER (ligne 26.6, étape C3a ; lib/caisseLecture.ts) : ses recettes en espèces comptent dans la 2035 à
  // leur date. Lue tout ou rien avec le reste, gardée AVEC le dossier qui l'a demandée ; le drapeau baissé, rien n'est lu ni
  // dit (la caisse absente). Lue en partie : aucune 2035 — ni chiffre, ni formulaire, ni validation —, et l'écran le dit.
  const [lectureCaisse, setLectureCaisse] = useState<LectureDeLaCaisse | null>(null)
  // LES ÉCRITURES LIBRES DE L'EXPERT-COMPTABLE (EL5 ; lib/ecrituresLibresLecture.ts) : la 2035 les compte (EL4), la validation
  // les numérote (EL3). Le drapeau baissé, l'absence, sans requête ; levé et lues en partie, aucune 2035 ni validation.
  const [lectureLibres, setLectureLibres] = useState<LectureDesEcrituresLibres | null>(null)
  // CE QUE LE FEC D'UN BNC EN TRÉSORERIE LIT DE PLUS (lot FEC22c2 ; lib/champsBncLecture.ts), la lecture même de l'onglet
  // Écritures : la validation reçoit les MÊMES entrées que l'export. Le drapeau baissé, rien n'est lu.
  const [lectureChampsBnc, setLectureChampsBnc] = useState<LectureDesChampsBnc | null>(null)
  // LES NOTES DE FRAIS DU CLIENT (L3-Q3 (A)) : gardées AVEC le dossier qui les a demandées ; un avertissement de la validation
  // seulement, muet tant qu'elles ne sont pas revenues pour ce dossier.
  const [notesDeFrais, setNotesDeFrais] = useState<{ dossierId: string; lues: NotesDeFraisDesControles } | null>(null)
  const [validationIncomplete, setValidationIncomplete] = useState<string | null>(null)
  const [ecrituresIncompletes, setEcrituresIncompletes] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [postesEdit, setPostesEdit] = useState<Record<string, string>>({})
  // Identité portée en en-tête du formulaire. Le SIRET s'écrit chiffre par chiffre dans sa grille,
  // et seulement si le formulaire la livre entière (voir grilleDeSaisie) : une grille mal alignée
  // décalerait tout le numéro d'un cran, ce qui est pire qu'une grille vide.
  // L'adresse ne sert qu'à l'annexe 2035-E, qui demande l'adresse professionnelle — celle que portent les factures.
  const [dossier, setDossier] = useState<{ nom: string | null; libelle_naf: string | null; siret: string | null; adresse: string | null } | null>(null)
  const [genere, setGenere] = useState<number | null>(null)
  // Exercices déjà marqués clôturés (table exercices_clotures), lus par `lireAnneesCloturees` —
  // seule copie de cette lecture depuis le 22/09/2026, pour que les trois écrans qui s'en servent
  // en tirent la même chose au même moment, son erreur comprise.
  const [cloturesConnues, setCloturesConnues] = useState<Set<number>>(new Set())
  // Non nul = on ne sait PAS lesquels sont clôturés, ce qui n'est pas « aucun ». Le bouton propose
  // alors « Clôturer » sur un exercice peut-être déjà bouclé : le geste reste sûr (rejouer la purge
  // ne repose pas de seconde ligne, voir lib/clotureExercice.ts) mais l'écran doit le DIRE.
  const [cloturesInconnues, setCloturesInconnues] = useState<string | null>(null)
  const [clotureMessage, setClotureMessage] = useState<string | null>(null)
  // Exercice partagé avec Pièces/Banque/Écritures/Statistiques, sélectionné dans l'en-tête du dossier
  // (voir AnneeContext) — pas de sélecteur local ici. Sa valeur par défaut (voir DossierDetail,
  // calculerAnneeParDefaut) est déjà un exercice précis plutôt que "toutes", justement pour éviter
  // que Clôture s'ouvre sur un mélange de plusieurs exercices sans que l'utilisateur l'ait choisi.
  const { annee: anneeFilter, setAnnee } = useAnnee()
  // Une validation déplace la frontière de tout le dossier : Clôture relit son exercice, et la page relit les
  // exercices validés que chaque onglet consulte pour savoir ce qui est figé (ExercicesValidesContext). Sans la
  // seconde relecture, Écritures proposerait encore de régénérer ce que la base vient de figer.
  const { relire: relireExercicesValides } = useExercicesValides()
  async function apresValidation() {
    await Promise.all([load(), relireExercicesValides()])
  }

  // LA DERNIÈRE LECTURE DEMANDÉE ÉCRIT SEULE : une lecture plus lente — celle d'avant un enregistrement, ou celle d'un dossier
  // quitté — ne remplace pas, en arrivant après, celle qui l'a suivie. Le numéro se prend avant la première attente.
  const derniereLecture = useRef(0)

  async function load() {
    const demande = ++derniereLecture.current
    setLoading(true)
    // LES QUATRE ENTRÉES DE LA DÉCLARATION SONT LUES PAR TRANCHES, PAS SEULEMENT LES PIÈCES.
    // PostgREST plafonne le nombre de lignes rendues sans le signaler (voir lib/lectureComplete.ts),
    // et cet écran produit une DÉCLARATION. Le garde-fou ne couvrait que `pieces` : il promettait
    // donc « ce formulaire est bâti sur tout » en n'ayant vérifié qu'une entrée sur quatre, et une
    // cotisation ou une immobilisation manquante est tout aussi plausible, fausse et signée.
    // Le tri est TOTAL partout (`id` en départage) : sans clé unique, deux tranches se recouvrent
    // ou sautent des lignes, et rien ne le signale.
    const [
      lectureCategories, lecturePieces, lectureImmobilisations, lectureCotisations, lectureVehicules, lectureLignes,
      { data: dossierData, error: dossierError }, clotures, lectureEmprunts, lectureVentilations, lectureReglements, lectureNatures,
      lectureEcritures, lectureOuverture, lectureAValider, lectureValides, lectureDeclarationsTva, lectureReportes,
      lectureFacturesEmises, lectureTransmissions, lectureVentesFacturees, lectureSourcesDesVentes, lectureDeLaCaisse,
      lectureDesChampsBnc, lectureDesLibres,
    ] = await Promise.all([
      lireTout<Categorie>((debut, fin) =>
        supabase.from('categories').select('*', { count: 'exact' })
          .or(`dossier_id.eq.${dossierId},dossier_id.is.null`).order('ordre').order('id').range(debut, fin),
      ),
      lireTout<Piece>((debut, fin) =>
        supabase.from('pieces').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).eq('statut', 'validee').order('id').range(debut, fin),
      ),
      lireTout<Immobilisation>((debut, fin) =>
        supabase.from('immobilisations').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).order('id').range(debut, fin),
      ),
      lireTout<CotisationDeclaree>((debut, fin) =>
        supabase.from('cotisations_declarees').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).order('id').range(debut, fin),
      ),
      // Tous exercices : c'est le moteur qui filtre sur l'année, comme pour les cotisations.
      lireTout<VehiculeDossier>((debut, fin) =>
        supabase.from('vehicules').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).order('id').range(debut, fin),
      ),
      // Les paiements qui DATENT les pièces, et les mouvements AFFECTÉS à une catégorie sans
      // justificatif (ligne 26.6), qui comptent eux-mêmes — les encaissements de l'Assurance maladie
      // d'un infirmier, qui ne dépose pas ses bordereaux. Tronquée, cette lecture ferait retomber sur
      // leur date de facture des pièces payées une autre année, ou retirerait des recettes : une 2035
      // plausible, fausse et signée, comme pour les quatre autres entrées. Elle rejoint donc le même
      // drapeau. TOUT le relevé : la 2035 n'en garde que les rapprochées (une ligne rapprochée d'une
      // échéance de cotisation la DATE, lib/cotisationRapprochee.ts), la validation lit aussi ce qui reste
      // à traiter et les virements personnels.
      lireTout<LigneBancaire>((debut, fin) =>
        supabase.from('lignes_bancaires').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId)
          .order('id').range(debut, fin),
      ),
      supabase.from('dossiers').select('nom, libelle_naf, siret, adresse').eq('id', dossierId).maybeSingle(),
      // Par `lireAnneesCloturees`, qui REND son erreur — plutôt qu'une lecture nue de plus. Les
      // trois écrans qui lisent cette table doivent en tirer la même chose au même moment.
      lireAnneesCloturees(dossierId),
      lireTout<Emprunt>((debut, fin) =>
        supabase.from('emprunts').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).order('date_debut').order('id').range(debut, fin),
      ),
      // Les parts des mouvements ventilés : une part tronquée retire de la 2035 ce qu'elle y met, donc
      // cette lecture rejoint le drapeau de la déclaration comme les mouvements eux-mêmes.
      lireTout<VentilationBancaire>((debut, fin) =>
        supabase.from('ventilations_bancaires').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).order('id').range(debut, fin),
      ),
      // Les parts des virements groupés : tronquées, elles font retomber sur leur date de facture des
      // pièces réglées une autre année — le même drapeau que les mouvements.
      lireTout<ReglementGroupe>((debut, fin) =>
        supabase.from('reglements_groupes').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).order('id').range(debut, fin),
      ),
      // Celles du dossier ET celles du cabinet (`dossier_id` nul) : ce sont presque toutes des natures partagées,
      // et un filtre sur le seul dossier les écarterait toutes.
      lireTout<NatureImmobilisation>((debut, fin) =>
        supabase.from('natures_immobilisation').select('*', { count: 'exact' })
          .or(`dossier_id.eq.${dossierId},dossier_id.is.null`).order('id').range(debut, fin),
      ),
      // TOUT le brouillon, toutes années : la concordance cherche dans un autre exercice l'écriture qui manque à
      // celui-ci (lib/concordance2035.ts). Tronquée, cette lecture ferait dire « sans écriture » à une source bien
      // écrite — d'où son drapeau à elle.
      lireTout<EcritureBrouillon>((debut, fin) =>
        supabase.from('ecritures_brouillon').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).order('date').order('id').range(debut, fin),
      ),
      // L'ouverture d'un dossier repris : un exercice qui la précède est dans la balance reprise, rien n'y est comparé.
      // Les à-nouveaux entiers : la validation de l'exercice qu'ils ouvrent les numérote.
      lireTout<ANouveau>((debut, fin) =>
        supabase.from('a_nouveaux').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).order('date').order('id').range(debut, fin),
      ),
      lireTout<Piece>((debut, fin) =>
        supabase.from('pieces').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).eq('statut', 'a_valider').order('id').range(debut, fin),
      ),
      lireTout<ExerciceValide>((debut, fin) =>
        supabase.from('exercices_valides').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).order('annee').order('dossier_id').range(debut, fin),
      ),
      // Les déclarations de TVA : l'arrondi de chaque liquidation entre dans la 2035. Tronquée, cette lecture en
      // retirerait un — le drapeau de la déclaration.
      lireTout<DeclarationTva>((debut, fin) =>
        supabase.from('declarations_tva').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).order('periode_debut').order('id').range(debut, fin),
      ),
      // Les soldes reportés : la validation numérote ceux de l'exercice qu'ils ouvrent. Tronquée, cette lecture ferait
      // refuser la validation par la base (« Les libellés proposés ne couvrent pas exactement… ») — le drapeau de la
      // validation, pas celui de la déclaration, qui ne les lit pas.
      lireLesSoldesReportes(dossierId),
      // Les factures émises validées et leurs transmissions : la vente qui revient de la plateforme du client ou de Super
      // PDP se reconnaît par elles (ligne 28.6). Le drapeau de la validation.
      lireTout<FacturePourJumelle>((debut, fin) =>
        supabase.from('factures_emises').select('id, dossier_id, statut, type, numero, date_emission, emetteur_siret, superpdp_invoice_id', { count: 'exact' })
          .eq('dossier_id', dossierId).eq('statut', 'validee').order('id').range(debut, fin),
      ),
      lireTout<TransmissionPourJumelle & { id: string }>((debut, fin) =>
        supabase.from('transmissions_factures').select('id, facture_id, canal, hote, flux_id', { count: 'exact' })
          .eq('dossier_id', dossierId).order('id').range(debut, fin),
      ),
      // Ne rejette jamais : une lecture refusée ou partielle revient « incomplète », avec son motif.
      lireLesVentesFacturees(dossierId),
      // Ne rejette jamais non plus ; jamais lue pour un dossier qui n'a pas basculé.
      ventesParLesFactures ? lireLesSourcesDesEcrituresDeVente(dossierId) : Promise.resolve(null),
      // Ne rejette jamais ; le drapeau baissé, ne touche pas au réseau.
      lireLaCaisse(dossierId),
      // Ne rejette jamais ; le drapeau `CHAMPS_BNC_EXPORTES` baissé, ne touche pas au réseau.
      lireLesChampsBnc(dossierId),
      // Ne rejette jamais ; le drapeau `ECRITURES_LIBRES_PREVUES` baissé, ne touche pas au réseau.
      lireLesEcrituresLibres(dossierId),
    ])
    // Les contrôles des relevés — tous : ceux qui ne bouclent pas, et ceux qui disent la banque au 31 décembre et d'où elle part
    // (MVPD7-Q2) — et les doublons de contenu, comme la Checklist les lit ; mais une lecture ratée n'y vaut jamais « rien à
    // signaler » : elle devient un préalable de la validation.
    // Et les comptes bancaires du dossier (MCB4), qui partagent le relevé : ne rejette jamais ; le drapeau
    // `COMPTES_BANCAIRES_PREVUS` baissé, ne touche pas au réseau (`sans_objet`).
    // Et les notes de frais du client (L3-Q3 (A)) : ne rejette jamais ; le drapeau baissé, sans un appel (sans objet).
    const [releves, doublons, comptes, notesLues] = await Promise.all([
      chargerControlesReleves(dossierId).catch((err) => { console.error(err); return null }),
      chargerDoublonsDeTexte(dossierId).catch((err) => { console.error(err); return null }),
      lireLesComptesDuDossier(dossierId),
      lireLesNotesDeFraisDesControles(dossierId),
    ])
    if (demande !== derniereLecture.current) return
    setLectureVentes(lectureVentesFacturees)
    setLectureSourcesVentes(lectureSourcesDesVentes)
    setLectureCaisse(lectureDeLaCaisse)
    setLectureLibres(lectureDesLibres)
    setLectureChampsBnc(lectureDesChampsBnc)
    setNotesDeFrais({ dossierId, lues: notesLues })
    setControlesReleves(releves)
    setLectureDesComptes(comptes)
    setDoublonsTexte(doublons)
    setPiecesAValider(lectureAValider.lignes)
    setExercicesValides(lectureValides.lignes)
    setFacturesEmises(lectureFacturesEmises.lignes)
    setTransmissions(lectureTransmissions.lignes)
    setValidationIncomplete(
      [lectureAValider, lectureValides, lectureReportes, lectureFacturesEmises, lectureTransmissions].find((l) => !l.complete)?.motif ?? null,
    )
    setANouveaux(lectureOuverture.lignes)
    setSoldesReportes(lectureReportes.lignes)
    setReportesIncomplets(lectureReportes.motif)
    setEcritures(lectureEcritures.lignes)
    setOuverture(lectureOuverture.lignes[0]?.date ?? null)
    setEcrituresIncompletes([lectureEcritures, lectureOuverture].find((l) => !l.complete)?.motif ?? null)
    setNatures(lectureNatures.lignes)
    setNaturesIncompletes(lectureNatures.complete ? null : lectureNatures.motif)
    setVentilations(lectureVentilations.lignes)
    setReglements(lectureReglements.lignes)
    setDeclarationsTva(lectureDeclarationsTva.lignes)
    setEmprunts(lectureEmprunts.lignes)
    setEmpruntsIncomplets(lectureEmprunts.complete ? null : lectureEmprunts.motif)
    setDossier(dossierData ?? null)
    setCloturesInconnues(clotures.erreur)
    setCloturesConnues(new Set(clotures.annees))
    setVehicules(lectureVehicules.lignes)
    setToutesLesLignes(lectureLignes.lignes)
    setCategories(lectureCategories.lignes)
    setPiecesValidees(lecturePieces.lignes)
    // Un seul drapeau pour les quatre : l'écran n'a rien de plus utile à dire selon laquelle a
    // manqué, et le formulaire se refuse dans tous les cas.
    //
    // L'IDENTITÉ DU DOSSIER Y REJOINT LES COLLECTIONS (22/09/2026) : `nom`, `libelle_naf` et
    // `siret` sont recopiés tels quels dans le formulaire (voir `remplir`), et une lecture refusée
    // les rendait tous trois nuls — donc une 2035 SIGNÉE sans identité de déclarant, sans qu'aucun
    // écran ne le dise. Ce n'est pas une lecture « partielle » au sens du plafond PostgREST, mais
    // le refus qu'elle appelle est exactement le même.
    setLectureIncomplete(
      [
        lecturePieces, lectureCategories, lectureImmobilisations, lectureCotisations, lectureVehicules, lectureLignes, lectureVentilations,
        lectureReglements, lectureDeclarationsTva,
      ].find((l) => !l.complete)?.motif
      ?? (dossierError ? messageErreur(dossierError, "l'identité du dossier n'a pas pu être lue") : null),
    )
    setImmobilisations(lectureImmobilisations.lignes)
    setCotisations(lectureCotisations.lignes)
    setLoading(false)
  }

  // Un dossier qui bascule relit ses ventes facturées.
  useEffect(() => { load() }, [dossierId, ventesParLesFactures])


  // La facture d'un bien du registre : la 2035 l'écarte — le bien compte par sa dotation —, donc sa
  // catégorie ne décide de rien ici.
  const pieceIdsImmobilisees = new Set(immobilisations.map((i) => i.piece_id).filter((id): id is string => !!id))


  // Un dossier est par client, pas par année : sans filtre, ce récapitulatif mélangerait tous les
  // exercices dans un seul total par poste — pas ce qu'on attend d'une clôture. "Toutes années" reste
  // disponible (utile pour un premier tour d'horizon) mais affiche un avertissement explicite.
  // L'année d'une pièce est celle de son paiement, ou de sa facture à défaut (voir lib/rattachement.ts)
  // — la même que celle où le moteur la compte, sans quoi un exercice où une pièce compte pourrait
  // manquer à la liste. En engagement, celle de sa facture.
  // La lecture des ventes facturées de CE dossier, ou rien ; lue entière, ses ventes, sinon nulles et le motif.
  const lectureVentesDuDossier = lectureDuDossier(lectureVentes, dossierId)
  const ventesLues = lectureVentesDuDossier?.etat === 'lue' ? lectureVentesDuDossier.ventes : null
  // Même famille que « Postes manquants », un cran plus tôt dans la chaîne : sans catégorie du tout,
  // le montant n'atteint même pas la question du poste (voir lib/controles.ts). Jamais l'exemplaire d'une facture source
  // (étape VF6a) : sa facture compte la vente, et une catégorie ne le ferait pas compter. Sur des factures sources lues en
  // entier seulement — sans elles, la 2035 ne se calcule pas, et la carte qui dit ce qui lui manque se tait avec elle.
  const piecesSansCategorie = ventesLues === null ? [] : piecesValideesSansCategorie(piecesValidees, pieceIdsImmobilisees, ventesLues.sources)
  // Catégories utilisées par une pièce validée, un mouvement affecté ou une part d'un mouvement ventilé
  // mais sans poste 2035 associé — le regroupement par poste les ignorera tant que ce n'est pas renseigné
  // (voir lib/controles.ts). Ni l'exemplaire d'une facture source (étape VF6e) : la 2035 l'écarte, et sa catégorie ne décide
  // de rien. Sur des ventes facturées pas encore lues pour CE dossier, ou lues en partie, la règle d'hier — la carte en
  // montre plus, jamais moins.
  const categoriesSansPosteDesSources = calculerCategoriesSansPoste(
    categories, horsDesExemplairesDesSources(piecesValidees, ventesLues?.sources ?? AUCUNE_FACTURE_SOURCE),
    [...lignesBancaires, ...ventilations], pieceIdsImmobilisees,
  )
  // LES FRAIS D'UN MOUVEMENT D'ENCAISSEMENTS (VF4C3-Q1) : ce que la 2035 reçoit des écritures des ventes facturées, sur les
  // lectures de CE dossier (lib/ecrituresVentesFactureesEcran.ts, `ecrituresDesVentesPourLa2035`). Un dossier basculé dont
  // les sources ne sont pas revenues entières n'a pas de 2035, comme sans ses ventes facturées.
  const pourLa2035 = ventesLues === null ? null : ecrituresDesVentesPourLa2035({
    dossierId, ventesParLesFactures, facturesSources: ventesLues.sources, lecture: lectureSourcesVentes, mode: modeComptable,
    plan: modele.plan, banques })
  const ecrituresDesVentes = pourLa2035?.etat === 'pret' ? pourLa2035.ecritures : null
  const ventesFacturees = ecrituresDesVentes === null ? null : ventesLues
  const ventesIncompletes = lectureVentesDuDossier?.etat === 'incomplete' ? lectureVentesDuDossier.motif
    : pourLa2035?.etat === 'incomplete' ? pourLa2035.motif : null
  // LES RECETTES DE CAISSE de CE dossier (étape C3a ; lib/recettesDeCaisse.ts), résolues sur ses catégories : absentes (le
  // drapeau baissé), elles ne changent rien ; pas encore revenues ou lues en partie, aucune 2035.
  const etatDeLaCaisse = recettesDeCaisseDuDossier(lectureCaisse, dossierId, categories, assujettiTva)
  const recettesDeCaisse = recettesPourLesMoteurs(etatDeLaCaisse)
  const caisseIncomplete = motifDeLaCaisse(etatDeLaCaisse)
  // SES OPÉRATIONS, telles que la validation les reçoit (étape C3b ; lib/controlesDeLaCaisse.ts) : la numérotation du FEC en
  // écrit chacune, et trois préalables la jugent. Sur la même lecture, pour CE dossier ; pas encore revenues ou lues en
  // partie, nulles — la validation se suspend. Absentes (le drapeau baissé), rien ne change.
  const operationsDeCaisse = operationsPourLesControles(operationsDeCaisseDuDossier(lectureCaisse, dossierId))
  // CE QUE LES VIREMENTS MIXTES PAIENT DE LEURS EXEMPLAIRES (étape VF5h ; lib/rattachement.ts), lu avec les ventes facturées :
  // une pièce qu'un tel virement paie se date par lui, dans la 2035 comme dans la validation. Sans facture source, aucun
  // mouvement n'est classé par ses encaissements, et il n'y en a aucun. Pas encore revenues ou lues en partie, aucune 2035
  // ne s'affiche ; et la validation se suspend en le disant, par la garde des factures sources (`motifValidation`).
  const encaissees = lectureVentesDuDossier?.etat === 'lue' ? lectureVentesDuDossier.encaissees : []
  // Et les paiements de pièces par la caisse (étape C9a) : la 2035 compte une pièce à la date de son paiement en espèces
  // (CGI, art. 93, 1). Aucun tant que la migration n'est pas en base. Nuls — la caisse pas encore revenue ou lue en partie —,
  // les recettes de caisse le sont aussi : ni 2035, ni validation (`operationsDeCaisse` nulles).
  const paiementsDeLaCaisse = paiementsParLaCaisseDuDossier(lectureCaisse, dossierId) ?? []
  const paiements = paiementsDesPieces(lignesBancaires, reglements, encaissees, paiementsDeLaCaisse)
  const parts = partsDuReleve(lignesBancaires, categories, ventilations, assujettiTva)
  // Les échéances de cotisation à la date et au montant du mouvement qui les paie, sinon à leur échéance :
  // la 2035 et le FEC disent la même année (lib/cotisationRapprochee.ts).
  const comptees = cotisationsComptees(cotisations, lignesBancaires, modeComptable)
  // L'année en cours À PARIS, comme la base la lit pour la validation.
  const anneeCourante = Number(aujourdHuiAParis().slice(0, 4))
  // Le prochain exercice à valider (lib/prealablesValidation.ts) : la liste le propose toujours, et les exercices
  // validés aussi — sinon une année vide, ou qui ne porte qu'une échéance de cotisation, manquerait à la liste, et la
  // validation de tous les exercices suivants l'attendrait sans que rien n'y mène.
  const anneesValidees = exercicesValides.map((e) => e.annee)
  // LES VENTES FACTURÉES D'UN DOSSIER BASCULÉ, TELLES QUE LA VALIDATION LES REÇOIT (étape VF7c ; lib/prealablesValidation.ts) :
  // sur la lecture que l'écran fait déjà (`lectureSourcesVentes`) et le brouillon entier, les états de la section « Ventes
  // facturées » de l'onglet Écritures et ce que la Vue d'ensemble en dit — la même composition, les mêmes jugements, jamais
  // une règle recopiée. Lus pour CE dossier seulement : pas encore revenus, nuls, et la validation attend ; lus en partie,
  // ou qui ne se tiennent pas, elle se suspend en le disant (`lecture-partielle`). Un dossier qui n'a pas basculé ne lit
  // rien de plus : « sans objet ».
  const sourcesDesVentesDuDossier = lectureSourcesVentes !== null && lectureSourcesVentes.dossierId === dossierId ? lectureSourcesVentes : null
  const etatsDesVentes: EtatsDesVentesDeLaValidation | null = !ventesParLesFactures ? { etat: 'sans_objet' }
    : sourcesDesVentesDuDossier === null ? null
      : sourcesDesVentesDuDossier.etat === 'incomplete' ? { etat: 'incomplete', motif: sourcesDesVentesDuDossier.motif }
        : etatsDesVentesFacturees({
          sources: sourcesDesVentesDuDossier.sources, brouillon: ecritures, mode: modeComptable, plan: modele.plan, banques, anneesValidees,
          ventesParLesFactures })
  const ventesDeLaVueDEnsemble = !ventesParLesFactures ? ventesDeLaChecklist(null, null)
    : sourcesDesVentesDuDossier === null ? null : ventesDeLaChecklist(sourcesDesVentesDuDossier, frontiereDeValidation(anneesValidees))
  const prochainAValider = prochainExerciceAValider({
    anneeCourante, modele, anneesValidees, aNouveaux, ecritures,
    lignes: toutesLesLignes, reglements, encaissees, operationsDeCaisse, piecesValidees, piecesAValider, cotisations, vehicules, immobilisations,
    etatsDesVentes, piecesCitees: ventesLues?.piecesCitees ?? null })
  const anneesDisponibles = [...new Set([
    ...piecesValidees.flatMap((p) => anneesDesRattachements(rattachements(p, paiements.get(p.id) ?? [], modeComptable))),
    // Un exercice qui n'a que des encaissements sans bordereau, ou des intérêts d'emprunt, doit se
    // proposer comme un autre.
    ...parts.map((m) => anneeDe(m.ligne.date)),
    // Et un exercice qui n'a que des encaissements de factures sources.
    ...(ventesFacturees?.parts ?? []).map((p) => anneeDe(p.date)),
    // Et un exercice qui n'a que des recettes en espèces.
    ...(recettesDeCaisse === null ? [] : recettesDe(recettesDeCaisse)).map((r) => anneeDe(r.date)),
    // Et un exercice qui n'a que les frais d'un mouvement d'encaissements — un chèque de décembre remis en janvier.
    ...(ecrituresDesVentes?.etat === 'composees' ? fraisDesMouvements(ecrituresDesVentes.composition, modele.plan) : [])
      .map((f) => anneeDe(f.date)),
    ...comptees.map((c) => anneeDe(c.date)),
    ...immobilisations.map((i) => anneeDe(i.date_acquisition)),
    ...vehicules.map((v) => v.annee),
    ...exercicesValides.map((e) => e.annee),
    ...(prochainAValider !== null ? [prochainAValider] : []),
  ])].sort((a, b) => b - a)

  // Une pièce déjà enregistrée comme immobilisation est représentée par sa dotation annuelle (poste
  // Amortissements) plutôt que par son montant complet — même logique d'exclusion que l'onglet
  // Écritures, pour ne pas compter la dépense deux fois.
  // Le calcul vit dans lib/declaration2035.ts : c'est le même moteur qui alimentera le formulaire
  // fiscal, donc il doit être testé et partagé plutôt que refait ici. Une 2035 est par nature
  // annuelle — le moteur exige un exercice précis, et « toutes » n'est qu'un cumul d'exercices pour
  // consultation (l'avertissement ci-dessous le dit).
  const exercices = typeof anneeFilter === 'number' ? [anneeFilter] : anneesDisponibles
  // Sans les ventes facturées du dossier lues en entier, AUCUNE 2035 : une déclaration sans ses ventes facturées serait
  // plausible, fausse et signée, et le moteur n'a pas de valeur par défaut à leur donner.
  // Ni sans sa caisse, pour la même raison : lue en partie, une recette en espèces manquerait à une 2035 signée.
  // Ni sans les écritures de l'expert-comptable (EL4, EL5) : lues en partie, une OD comptée manquerait à la 2035.
  const ecrituresLibres = ecrituresLibresPourLesMoteurs(lectureLibres, dossierId)
  const declarations = ventesFacturees === null || ecrituresDesVentes === null || recettesDeCaisse === null || ecrituresLibres === null
    ? [] : exercices.map((a) =>
      calculerDeclaration2035(a, piecesValidees, categories, immobilisations, comptees, vehicules, assujettiTva, paiements, parts, declarationsTva, modele.plan, ventesFacturees, ecrituresDesVentes, recettesDeCaisse, ecrituresLibres),
    )

  // Chaque exercice est rendu dans la forme du formulaire officiel — une case par encadré, dans
  // l'ordre imprimé. Une 2035 est annuelle : plutôt que de cumuler des cases de plusieurs exercices
  // (ce qui remplirait par exemple à la fois « excédent » et « insuffisance », impossible sur un vrai
  // formulaire), on affiche un tableau par exercice.
  // Les saisies du cabinet de l'exercice : pas encore lues entières, la 2035 se calcule sans elles et se suspend
  // (`saisiesIncompletes`) — ni PDF, ni validation.
  const formulaires = declarations.map((d) => ({
    declaration: d, ...valeursDesCases(d, saisiesDeLExercice(lectureDesSaisies, d.annee) ?? AUCUNE_SAISIE_2035) }))

  // CE QU'UN EXERCICE VALIDÉ A FIGÉ NE SE RÉCLAME PLUS (lib/validationExercice.ts). Sa 2035 est celle que la base garde,
  // et ni ses sources ni ses écritures ne changent plus : les cartes qui suivent appellent un geste — rapprocher,
  // catégoriser, saisir une CSG-CRDS, retirer un bien, corriger un véhicule, arbitrer une case — que la base refuserait
  // sur cet exercice, et elles y resteraient pour toujours, sans geste pour les lever. Elles ne portent donc que sur les
  // exercices OUVERTS ; un exercice que la validation d'un exercice postérieur fige ne l'est pas davantage. La
  // concordance d'un exercice figé se dit encore, sans rien proposer (ConcordanceCard).
  const ouvert = (annee: number) => exerciceQuiFige(annee, anneesValidees) === null
  const declarationsOuvertes = declarations.filter((d) => ouvert(d.annee))
  const formulairesOuverts = formulaires.filter((f) => ouvert(f.declaration.annee))

  // Postes que le rattachement ne sait pas placer, tous exercices affichés confondus. Même principe
  // que les pièces exclues : un poste qui n'atterrit dans aucune case est un montant absent de la
  // déclaration, et il doit se voir. Un même libellé peut porter des recettes ET des dépenses (« Honoraires ») : ce
  // sont deux lignes de la déclaration, gardées toutes les deux.
  const sansCase = new Map<string, PosteNonRattache>()
  for (const f of formulairesOuverts) {
    for (const p of f.postesSansCase) sansCase.set(`${p.ligne.nature}:${p.ligne.poste}`, p)
  }
  const postesSansCase = [...sansCase.values()]
  // Les catégories qui les portent : c'est leur poste qui se corrige, et aucun autre écran ne modifie un poste déjà
  // renseigné — sans ce formulaire, la carte enverrait corriger ce qu'on ne peut pas corriger, et la validation de
  // l'exercice, qui refuse un poste sans case, resterait refusée pour toujours.
  //
  // SAUF UNE LIGNE « DU MAUVAIS SENS » QUE LE POSTE DE SA CATÉGORIE N'EXPLIQUE PAS. La nature d'une pièce est son type,
  // celle d'une catégorie son compte : une vente rangée dans une catégorie de DÉPENSE — ou un achat dans une catégorie
  // de recette — fait une ligne du mauvais sens sous un poste juste. Renommer la catégorie ferait alors perdre leur case
  // à toutes ses dépenses ; c'est la PIÈCE qui change de catégorie. Le formulaire ne propose donc que les catégories
  // dont le poste est en cause — un libellé qu'aucune case ne connaît, ou celui de l'autre sens sur une catégorie du
  // sens de la ligne (une catégorie de recette au libellé d'une dépense) —, et les pièces rangées à contresens sont
  // nommées à part. Une catégorie sans compte n'a pas de sens connu : elle reste proposée, le cabinet tranche.
  const sensOppose = (n: 'recette' | 'depense') => (n === 'recette' ? 'depense' : 'recette')
  const categoriesSansCase = categories.filter((c) => c.poste_2035 !== null && postesSansCase.some((p) =>
    p.ligne.poste === c.poste_2035
    && (p.raison === 'aucune case connue' || natureDuCompte(c.compte_comptable) !== sensOppose(p.ligne.nature))))
  const piecesAContresens = new Map<string, Piece>()
  for (const f of formulairesOuverts) {
    for (const p of f.postesSansCase) {
      if (p.raison !== 'case du mauvais sens') continue
      for (const c of f.declaration.contributions) {
        if (c.source.type !== 'piece' || c.poste !== p.ligne.poste || c.nature !== p.ligne.nature) continue
        if (natureDuCompte(c.compte) === sensOppose(c.nature)) piecesAContresens.set(c.source.id, c.source.piece)
      }
    }
  }

  // Une case « dont » qui dépasse sa porteuse est une saisie contradictoire. Le moteur remplit les « dont » d'un poste qui
  // les nomme, et BT des échéances (étape 2035S1) : chacun est une part de sa porteuse par construction — sauf qu'un
  // remboursement de cotisations classé dans une catégorie de charge fait baisser BK sans toucher BT, et la carte paraît
  // (relecture du 03/11/2026, D4). La validation la refuse (`cases-dont-incoherentes`, le même calcul), puisque la carte
  // se tait une fois l'exercice validé.
  const incoherences: IncoherenceCase[] = formulairesOuverts.flatMap((f) => incoherencesDesCases(f.valeurs))

  // LA PART DE BK QUE RIEN NE QUALIFIE (étape 2035S1, 2035S-Q2 (A)) : le formulaire veut, ligne 25, la part obligatoire (BT),
  // les Madelin (BZ) et les plans d'épargne retraite (BU) ; BT ne compte que les échéances de l'onglet Cotisations, et une
  // catégorie au poste générique « Charges sociales personnelles » ne dit pas sa nature. Dit par exercice ouvert, avec le
  // geste qui la règle : ranger la catégorie sous le poste qui la nomme. Rien ne retient la validation.
  const bkSansNature = formulairesOuverts
    .map((f) => ({ annee: f.declaration.annee, montant: partDeBKSansNature(f.valeurs), bk: f.valeurs.get('BK') ?? 0 }))
    .filter((x) => x.montant > 0)

  // Forfait kilométrique ET frais de véhicule au réel dans la même déclaration : la dépense est
  // comptée deux fois en case BJ, et la case ne montre qu'un total qui ne dit pas de quoi il est fait.
  const doublonsVehicules: { annee: number; doublon: DoublonFraisVehicule }[] = declarationsOuvertes
    .map((d) => ({ annee: d.annee, doublon: doublonFraisVehicules(d) }))
    .filter((x): x is { annee: number; doublon: DoublonFraisVehicule } => x.doublon !== null)
  // Le carburant sous le barème (VEH-Q1) : la catégorie commune « Carburant / déplacements » porte le poste « Frais de
  // déplacement », que la carte du dessus laisse passer à dessein ; chaque dépense se nomme, sa date, son montant, sa catégorie.
  const carburantsSousBareme: { annee: number; carburant: CarburantSousLeBareme }[] = declarationsOuvertes
    .map((d) => ({ annee: d.annee, carburant: carburantSousLeBareme(d, categories, ventilations, assujettiTva) }))
    .filter((x): x is { annee: number; carburant: CarburantSousLeBareme } => x.carburant !== null)

  // La CSG-CRDS est portée EN ENTIER au poste « Cotisations sociales personnelles » (case BK), alors
  // que 2,9 de ses 9,7 points ne sont pas déductibles du résultat BNC. Le moteur ne retranche rien
  // — il totalise, il ne déclare pas — donc c'est ici que ça se dit, sur l'écran qui remplit le
  // formulaire. Deux états distincts : ce qu'on sait chiffrer, et ce qu'on ne sait pas encore.
  // NE RESTE QUE CE QUI N'EST PAS VENTILÉ. Depuis le 22/09/2026 le moteur sort la CSG-CRDS de la
  // ligne 25 et porte sa part déductible en case BV — pour une cotisation VENTILÉE il n'y a donc plus
  // rien à dire, et le redire serait une mise en garde permanente, qui cesse d'être lue puis emporte
  // ses voisines. Ce qui reste vrai, et que rien ne peut calculer : une cotisation dont la CSG-CRDS
  // n'est pas saisie garde sa part non déductible dans la ligne 25.
  const csgSansVentilation: { annee: number; part: PartCsgNonDeductible }[] = declarationsOuvertes
    .map((d) => ({ annee: d.annee, part: partCsgNonDeductible(comptees, d.annee) }))
    .filter((x): x is { annee: number; part: PartCsgNonDeductible } =>
      x.part !== null && x.part.nbSansVentilation > 0)

  // UNE DOTATION SANS JUSTIFICATIF SUR LE DOCUMENT QU'ON SIGNE. `immobilisations.piece_id` est en
  // `ON DELETE SET NULL` : supprimer la pièce détache l'immobilisation sans un mot, et
  // `calculerDeclaration2035` totalise la dotation sans regarder ce lien. CADRÉ SUR L'EXERCICE de
  // chaque déclaration affichée — le contrôle, lui, est année-libre (voir `immobilisationsSans-
  // Justificatif`) : ce qui compte ici est la dotation qui part RÉELLEMENT en case CH cette
  // année-là, pas un bien amorti depuis longtemps.
  const amortissementsSansJustificatif = declarationsOuvertes.flatMap((d) =>
    immobilisationsSansJustificatif(immobilisations, ouverture)
      .filter((i) => dotationDeLExercice(i, d.annee) > 0)
      .map((i) => ({ annee: d.annee, immo: i, dotation: dotationDeLExercice(i, d.annee) })),
  )

  // LES ÉCHÉANCES D'EMPRUNT QUE L'ÉCHÉANCIER PRÉVOIT DANS L'EXERCICE ET QU'AUCUN MOUVEMENT NE PAIE : la 2035
  // ne compte que les intérêts des échéances RAPPROCHÉES, au découpage validé — une échéance que rien ne
  // paie n'y est pas, et son prélèvement attend quelque part dans le relevé. Jusqu'à aujourd'hui pour
  // l'exercice en cours : une échéance à venir n'est pas en retard.
  const aujourdHui = aujourdHuiSql()
  const echeancesManquantes = declarationsOuvertes.flatMap((d) => {
    const fin = `${d.annee}-12-31` < aujourdHui ? `${d.annee}-12-31` : aujourdHui
    return echeancesNonRapprochees(emprunts, lignesBancaires, `${d.annee}-01-01`, fin).map((e) => ({ annee: d.annee, ...e }))
  })
  const interetsManquants = Math.round(echeancesManquantes.reduce((s, e) => s + e.echeance.interets, 0) * 100) / 100

  // LE VÉHICULE DU REGISTRE AMORTI L'ANNÉE OÙ LE BARÈME EST RETENU (lib/forfaitKilometrique.ts) : le barème couvre
  // déjà son amortissement, et la case CH le déduit une seconde fois. La notice veut ces amortissements
  // réintégrés au cadre B du tableau des immobilisations ; le moteur ne le fait pas — il le dit ici.
  const amortissementsVehicules = declarationsOuvertes.flatMap((d) => amortissementsSousLeBareme(immobilisations, natures, vehicules, d.annee))

  // Véhicules dont l'indemnité n'a pas pu être calculée : leur déduction manque sur le formulaire,
  // et rien sur le PDF ne le dirait.
  const vehiculesNonCalcules = declarationsOuvertes.flatMap((d) =>
    (d.indemnitesKilometriques?.nonCalcules ?? []).map((n) => ({ annee: d.annee, ...n })),
  )

  // LA 2035 SE RETROUVE-T-ELLE DANS LES ÉCRITURES ? Source par source et compte par compte, pour chaque exercice
  // affiché (lib/concordance2035.ts). La 2035 reste calculée depuis les sources ; la concordance dit ce qui
  // manque au FEC pour la porter. Les écritures d'une vente facturée s'y rapprochent de leur encaissement (étape VF4c3), et
  // celles des frais d'un mouvement d'encaissements de ce mouvement (VF4C3-Q1) ; les mouvements que leurs encaissements
  // classent, lus avec tous les mouvements, disent qu'une écriture de frais que la 2035 ne compte plus est à reprendre.
  const idsPiecesValidees = new Set(piecesValidees.map((p) => p.id))
  const mouvementsDesVentesFacturees = mouvementsClassesParEncaissements(toutesLesLignes)
  const concordances = new Map(declarations.map((d) => [d.annee, {
    concordance: concordance2035(d, ecritures, {
      piecesValidees: idsPiecesValidees, piecesImmobilisees: pieceIdsImmobilisees, mouvementsDesVentesFacturees }, ouverture),
    comptesPartages: comptesPartagesEntreCases(d) }]))

  // UNE CASE NÉGATIVE NE SE DÉPOSE PAS : un poste que ses remboursements font passer sous zéro garde son signe,
  // et quand il emporte sa case, c'est ici que ça se dit (lib/cases2035.ts, `casesNegatives`).
  const negatives = declarationsOuvertes.flatMap((d) => casesNegatives(d).map((c) => ({ annee: d.annee, ...c })))

  // LA VALIDATION DE CHAQUE EXERCICE AFFICHÉ (lib/prealablesValidation.ts) : validé, ce que la base en garde ;
  // sinon ce qui l'empêche, et ce que `valider_exercice` recevrait — la numérotation même du FEC et, en trésorerie,
  // la 2035 telle qu'elle est affichée. L'année en cours est lue À PARIS, comme la base la lit. Une lecture
  // partielle de l'une des collections lues ici suspend la validation, en le disant.
  // Les ventes facturées lues en partie en sont une : sans leurs factures sources, un exemplaire serait jugé comme une
  // pièce qui compte (étape VF6a), et sans ce que leurs virements mixtes paient, l'exemplaire d'une facture d'avant serait
  // daté par sa facture et non par le virement (étape VF5h) — leur motif se dit, en trésorerie comme en engagement ; pas
  // encore revenues, la validation attend (`facturesSources` nulles). Une seule garde pour les deux raisons.
  // La caisse lue en partie aussi (étape C3a) : sans elle, aucune 2035, et la validation ne part pas sur une 2035 qui manque.
  // LES QUATRE CHAMPS DU FEC D'UN BNC EN TRÉSORERIE (lot FEC22c2) : le drapeau baissé, ou un dossier en engagement, rien de
  // neuf — la demande d'hier. Levé, les MÊMES entrées que l'export de l'onglet Écritures (les paiements, la validation les tire
  // elle-même), sur des lectures toutes revenues en entier pour CE dossier : les factures et les cotisations, les ventilations,
  // le registre des encaissements d'un dossier basculé (aucun sinon : aucune écriture n'en vient), les biens. Une seule manque,
  // et la validation se suspend en le disant : l'exercice se figerait sans les quatre champs.
  const lectureChampsDuDossier = lectureChampsBnc !== null && lectureChampsBnc.dossierId === dossierId ? lectureChampsBnc : null
  const registreDesChamps = !ventesParLesFactures ? [] : sourcesDesVentesDuDossier?.etat === 'lue' ? sourcesDesVentesDuDossier.sources.encaissements : null
  const champsDeLaValidation: ChampsBncDeLaValidation | null = CHAMPS_BNC_EXPORTES === null || modele.mode === 'engagement'
    ? { etat: 'non_exportes' }
    : lectureChampsDuDossier?.etat === 'lue' && registreDesChamps !== null
      ? {
        etat: 'exportes',
        entrees: {
          choix: CHAMPS_BNC_EXPORTES, registre: registreDesChamps, factures: lectureChampsDuDossier.factures,
          cotisations: lectureChampsDuDossier.cotisations, ventilations,
          acquisitions: acquisitionsDesBiens(immobilisations, natures, ouverture), plan: modele.plan } }
      : null
  const champsBncIncomplets = champsDeLaValidation !== null ? null
    : lectureChampsDuDossier?.etat === 'incomplete' ? `les champs du FEC d’un BNC : ${lectureChampsDuDossier.motif}` : null
  const motifValidation = lectureIncomplete ?? ecrituresIncompletes ?? naturesIncompletes ?? empruntsIncomplets ?? validationIncomplete
    ?? saisiesIncompletes
    ?? (lectureVentesDuDossier?.etat === 'incomplete' ? `les ventes facturées : ${lectureVentesDuDossier.motif}` : null)
    ?? (caisseIncomplete !== null ? `la caisse : ${caisseIncomplete}` : null)
    ?? motifDesEcrituresLibres(lectureLibres)
    ?? champsBncIncomplets
    ?? inventaireIncomplet
  const entete = { nom: dossier?.nom ?? null, activite: dossier?.libelle_naf ?? null, siret: dossier?.siret ?? null }
  const validationDe = (annee: number, formulaire?: { declaration: Declaration2035; valeurs: Map<string, number> }) => {
    const valide = exercicesValides.find((e) => e.annee === annee) ?? null
    // L'ouverture qu'a écrite la validation : les soldes reportés au 1er janvier suivant.
    if (valide) {
      const reportesEcrits = reportesIncomplets !== null ? null
        : soldesReportes.filter((s) => s.date === `${annee + 1}-01-01`).length
      return { valide, etat: null, demande: null, reportesEcrits }
    }
    const etat = prealablesDeValidation({
      annee, anneeCourante, aujourdHui: aujourdHuiAParis(), modele, assujettiTva, anneesValidees,
      lectureIncomplete: motifValidation, piecesValidees, piecesAValider, categories, immobilisations, natures, ecritures,
      lignes: toutesLesLignes, ventilations, reglements, encaissees, cotisations, vehicules, emprunts, aNouveaux, soldesReportes, declarationsTva,
      periodiciteTva, controlesReleves, comptesBancaires: lectureDesComptes, doublonsTexte, facturesEmises, transmissions,
      // Les factures sources lues en entier pour CE dossier, ou rien : la validation se suspend alors (étape VF6a).
      facturesSources: ventesLues?.sources ?? null,
      // Et les pièces citées par une facture reprise (A8c4), lues avec elles.
      piecesCitees: ventesLues?.piecesCitees ?? null,
      etatsDesVentes, ventesDeLaChecklist: ventesDeLaVueDEnsemble, operationsDeCaisse, champsBnc: champsDeLaValidation,
      declaration: formulaire?.declaration ?? null,
      saisies2035: formulaire ? saisiesDeLExercice(lectureDesSaisies, annee) : AUCUNE_SAISIE_2035,
      concordance: formulaire ? concordances.get(annee)?.concordance ?? null : null,
      inventaire: inventaireDeLaLecture(lectureDeLInventaire),
      // Nulles (pas encore revenues, ou illisibles), la validation se suspend déjà par `motifValidation` : l'absence n'est
      // passée qu'alors, et ne numérote rien de plus.
      ecrituresLibres: ecrituresLibres ?? ECRITURES_LIBRES_ABSENTES,
      notesDeFrais: notesDeFrais !== null && notesDeFrais.dossierId === dossierId ? notesDeFrais.lues : NOTES_DE_FRAIS_SANS_OBJET })
    const demande = etat.validable && etat.numerotation
      ? demandeDeValidation(etat.numerotation, formulaire
        ? instantane2035(formulaire.declaration, formulaire.valeurs, arrondirPourFormulaire(formulaire.valeurs, annee), entete)
        : null)
      : null
    return { valide: null, etat, demande, reportesEcrits: null }
  }

  // LES PRÉALABLES DE L'EXERCICE POUR L'ONGLET RÉVISION (ligne 41, lib/prealablesDeLaRevision.ts) : ce que la carte « Valider
  // l'exercice » reçoit plus haut (`validationDe`), sur la 2035 de l'exercice en trésorerie, sans elle en engagement — comme
  // Clôture l'appelle. Rien avant que les lectures soient revenues, ni sur une lecture partielle : les saisies de la 2035 et
  // l'inventaire se lisent à part, et les ventes facturées d'une 2035 lue en partie suspendent aussi la carte de Clôture.
  function prealablesDeLExercice(annee: number): PrealablesDeLaRevision {
    const enCours = loading || lectureDesSaisies === null || lectureDeLInventaire === null
    const motif = motifValidation ?? ventesIncompletes
    if (enCours || motif !== null) return prealablesPourLaRevision({ enCours, motif, validation: null })
    if (modeComptable === 'engagement') return prealablesPourLaRevision({ enCours, motif, validation: validationDe(annee) })
    const formulaire = formulaires.find((f) => f.declaration.annee === annee)
    return prealablesPourLaRevision({ enCours, motif, validation: formulaire === undefined ? null : validationDe(annee, formulaire) })
  }

  return {
    modeComptable, estChef, isSuperAdmin, categories, piecesValidees, lectureIncomplete, lectureDesSaisies,
    saisiesIncompletes, relireLesSaisies, lectureDeLInventaire, lectureDesSaisies2035E, relireLesSaisies2035E,
    immobilisations, cotisations, vehicules, toutesLesLignes, empruntsIncomplets, natures, naturesIncompletes, ecritures,
    ouverture, piecesAValider, lectureDesComptes, ecrituresIncompletes, loading, error, setError, postesEdit,
    setPostesEdit, dossier, genere, setGenere, cloturesConnues, setCloturesConnues, cloturesInconnues, clotureMessage,
    setClotureMessage, anneeFilter, setAnnee, apresValidation, load, piecesSansCategorie, categoriesSansPosteDesSources,
    ventesFacturees, ventesIncompletes, recettesDeCaisse, caisseIncomplete, paiements, comptees, anneeCourante,
    anneesValidees, anneesDisponibles, exercices, formulaires, ouvert, declarationsOuvertes, postesSansCase,
    categoriesSansCase, piecesAContresens, incoherences, bkSansNature, doublonsVehicules, carburantsSousBareme,
    csgSansVentilation, amortissementsSansJustificatif, echeancesManquantes, interetsManquants, amortissementsVehicules,
    vehiculesNonCalcules, concordances, negatives, entete, validationDe, prealablesDeLExercice
  }
}
