import { Fragment, useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { anneeDe, aujourdHuiAParis, aujourdHuiSql, formatMoney, formatDate } from '../../lib/format'
import { SUGGESTIONS_COMPTE_PAR_CODE } from '../../lib/ecritures'
import { montantRetenu } from '../../lib/montantRetenu'
import { categoriesSansPoste as calculerCategoriesSansPoste, piecesValideesSansCategorie } from '../../lib/controles'
import { calculerDeclaration2035, partCsgNonDeductible, type Declaration2035, type PartCsgNonDeductible } from '../../lib/declaration2035'
import { dotationDeLExercice } from '../../lib/amortissements'
import { amortissementsSousLeBareme } from '../../lib/forfaitKilometrique'
import {
  CASES_2035, PREMIER_EXERCICE_REVENU_BRUT_SOCIAL, arrondirPourFormulaire, casesNegatives, doublonFraisVehicules, incoherencesDesCases,
  valeursDesCases,
} from '../../lib/cases2035'
import { POSTES_PROPOSABLES, type DoublonFraisVehicule, type IncoherenceCase, type PosteNonRattache } from '../../lib/cases2035'
import { comptesPartagesEntreCases, concordance2035 } from '../../lib/concordance2035'
import { formaterMontant } from '../../lib/gabarit2035'
import { remplir2035 } from '../../lib/remplir2035'
import { immobilisationsSansJustificatif } from '../../lib/controles'
import { cloturerExercice, lireAnneesCloturees } from '../../lib/clotureExercice'
import { anneesDesRattachements, paiementsDesPieces, rattachements } from '../../lib/rattachement'
import { partsDuReleve } from '../../lib/partsDuReleve'
import { natureDuCompte } from '../../lib/affectationBanque'
import { cotisationsComptees } from '../../lib/cotisationRapprochee'
import { echeancesNonRapprochees } from '../../lib/echeanceEmprunt'
import type { Emprunt } from '../../lib/emprunts'
import type { ModeleComptable } from '../../lib/engagement'
import type { DossierTab } from '../../lib/ongletsDossier'
import { chargerRelevesIncoherents } from '../../lib/controlesReleves'
import { chargerDoublonsDeTexte, type DoublonDeTexte } from '../../lib/doublonsTexte'
import { prealablesDeValidation, prochainExerciceAValider } from '../../lib/prealablesValidation'
import {
  casesDeLInstantane, casesQuiDifferent, demandeDeValidation, exerciceQuiFige, instantane2035, lireInstantane2035, type Instantane2035,
} from '../../lib/validationExercice'
import type {
  ANouveau, Categorie, ControleReleveBancaire, CotisationDeclaree, DeclarationTva, EcritureBrouillon, ExerciceValide, Immobilisation,
  LigneBancaire, NatureImmobilisation, PeriodiciteTva, Piece, ReglementGroupe, SoldeReporte, VehiculeDossier, VentilationBancaire,
} from '../../lib/types'
import BrouillonBanner from '../../components/BrouillonBanner'
import BandeauLecturePartielle from '../../components/BandeauLecturePartielle'
import { useAnnee } from '../../context/AnneeContext'
import { useExercicesValides } from '../../context/ExercicesValidesContext'
import { useAuth } from '../../context/AuthContext'
import { lireTout } from '../../lib/lectureComplete'
import { messageErreur } from '../../lib/messageErreur'
import VoletSocialCard from './VoletSocialCard'
import ConcordanceCard from './ConcordanceCard'
import ValidationExerciceCard from './ValidationExerciceCard'

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
export default function ClotureTab({ dossierId, assujettiTva, periodiciteTva, modele, onNavigate }: {
  dossierId: string
  assujettiTva: boolean
  // La périodicité des déclarations de TVA : la validation d'un exercice dit les périodes qu'aucune ne couvre.
  periodiciteTva: PeriodiciteTva
  modele: ModeleComptable
  onNavigate?: (tab: DossierTab) => void
}) {
  const modeComptable = modele.mode
  // Seul le chef du cabinet valide un exercice (décision du 04/10/2026) — la base le refuse aux autres, et la
  // carte ne leur propose pas le geste.
  const { estChef } = useAuth()
  const [categories, setCategories] = useState<Categorie[]>([])
  const [piecesValidees, setPiecesValidees] = useState<Piece[]>([])
  // Non nul quand l'une des QUATRE collections dont dépend la déclaration n'a pas pu être lue en
  // entier — pièces, catégories, immobilisations, cotisations, véhicules. Cet écran produit une
  // déclaration : une 2035 calculée sur une partie de ses entrées est plausible, fausse, et signée,
  // et le formulaire n'a nulle part où dire qu'il est amputé. Le remplissage se refuse donc.
  // Le nom dit « lecture » et non « pièces » : il a porté le second pendant que le garde-fou ne
  // vérifiait qu'une entrée sur quatre, ce qu'aucune relecture de l'écran ne pouvait montrer.
  const [lectureIncomplete, setLectureIncomplete] = useState<string | null>(null)
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
  const [relevesIncoherents, setRelevesIncoherents] = useState<ControleReleveBancaire[] | null>(null)
  const [doublonsTexte, setDoublonsTexte] = useState<DoublonDeTexte[] | null>(null)
  const [validationIncomplete, setValidationIncomplete] = useState<string | null>(null)
  const [ecrituresIncompletes, setEcrituresIncompletes] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [postesEdit, setPostesEdit] = useState<Record<string, string>>({})
  // Identité portée en en-tête du formulaire. Le SIRET s'écrit chiffre par chiffre dans sa grille,
  // et seulement si le formulaire la livre entière (voir grilleDeSaisie) : une grille mal alignée
  // décalerait tout le numéro d'un cran, ce qui est pire qu'une grille vide.
  const [dossier, setDossier] = useState<{ nom: string | null; libelle_naf: string | null; siret: string | null } | null>(null)
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

  async function load() {
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
      // d'un infirmier, qui ne transmet pas ses bordereaux. Tronquée, cette lecture ferait retomber sur
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
      supabase.from('dossiers').select('nom, libelle_naf, siret').eq('id', dossierId).maybeSingle(),
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
      lireTout<SoldeReporte>((debut, fin) =>
        supabase.from('soldes_reportes').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).order('date').order('compte').order('id').range(debut, fin),
      ),
    ])
    // Le relevé qui ne boucle pas et les doublons de contenu, comme la Checklist les lit — mais une lecture ratée
    // n'y vaut jamais « rien à signaler » : elle devient un préalable de la validation.
    const [releves, doublons] = await Promise.all([
      chargerRelevesIncoherents(dossierId).catch((err) => { console.error(err); return null }),
      chargerDoublonsDeTexte(dossierId).catch((err) => { console.error(err); return null }),
    ])
    setRelevesIncoherents(releves)
    setDoublonsTexte(doublons)
    setPiecesAValider(lectureAValider.lignes)
    setExercicesValides(lectureValides.lignes)
    setValidationIncomplete([lectureAValider, lectureValides, lectureReportes].find((l) => !l.complete)?.motif ?? null)
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

  useEffect(() => { load() }, [dossierId])


  // La facture d'un bien du registre : la 2035 l'écarte — le bien compte par sa dotation —, donc sa
  // catégorie ne décide de rien ici.
  const pieceIdsImmobilisees = new Set(immobilisations.map((i) => i.piece_id).filter((id): id is string => !!id))
  // Catégories utilisées par une pièce validée, un mouvement affecté ou une part d'un mouvement ventilé
  // mais sans poste 2035 associé — le regroupement par poste les ignorera tant que ce n'est pas renseigné
  // (voir lib/controles.ts).
  const categoriesSansPoste = calculerCategoriesSansPoste(
    categories, piecesValidees, [...lignesBancaires, ...ventilations], pieceIdsImmobilisees,
  )
  // Même famille que « Postes manquants », un cran plus tôt dans la chaîne : sans catégorie du tout,
  // le montant n'atteint même pas la question du poste (voir lib/controles.ts).
  const piecesSansCategorie = piecesValideesSansCategorie(piecesValidees, pieceIdsImmobilisees)

  // Valeur affichée tant que le cabinet n'a rien tapé : la suggestion connue pour ce code de
  // catégorie, sinon vide — jamais enregistrée avant le clic explicite sur "Enregistrer".
  function posteAffiche(c: Categorie): string {
    return postesEdit[c.id] ?? SUGGESTIONS_COMPTE_PAR_CODE[c.code]?.poste2035 ?? ''
  }

  // `suggestion` : enregistrer la suggestion affichée quand rien n'a été tapé (« Postes manquants ») ; sans elle, seul ce
  // qui a été tapé s'enregistre (« Postes sans case », où le poste actuel est justement celui qu'on remplace).
  async function savePoste(categorieId: string, suggestion = true) {
    const categorie = categories.find((c) => c.id === categorieId)
    const repli = suggestion && categorie ? SUGGESTIONS_COMPTE_PAR_CODE[categorie.code]?.poste2035 : undefined
    const valeur = (postesEdit[categorieId] ?? repli ?? '').trim()
    if (!valeur) return
    const { error: saveError } = await supabase.from('categories').update({ poste_2035: valeur }).eq('id', categorieId)
    if (saveError) {
      setError(saveError.message)
      return
    }
    load()
  }

  // Un dossier est par client, pas par année : sans filtre, ce récapitulatif mélangerait tous les
  // exercices dans un seul total par poste — pas ce qu'on attend d'une clôture. "Toutes années" reste
  // disponible (utile pour un premier tour d'horizon) mais affiche un avertissement explicite.
  // L'année d'une pièce est celle de son paiement, ou de sa facture à défaut (voir lib/rattachement.ts)
  // — la même que celle où le moteur la compte, sans quoi un exercice où une pièce compte pourrait
  // manquer à la liste. En engagement, celle de sa facture.
  const paiements = paiementsDesPieces(lignesBancaires, reglements)
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
  const prochainAValider = prochainExerciceAValider({
    anneeCourante, modele, anneesValidees, aNouveaux, ecritures,
    lignes: toutesLesLignes, reglements, piecesValidees, piecesAValider, cotisations, vehicules, immobilisations,
  })
  const anneesDisponibles = [...new Set([
    ...piecesValidees.flatMap((p) => anneesDesRattachements(rattachements(p, paiements.get(p.id) ?? [], modeComptable))),
    // Un exercice qui n'a que des encaissements sans bordereau, ou des intérêts d'emprunt, doit se
    // proposer comme un autre.
    ...parts.map((m) => anneeDe(m.ligne.date)),
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
  const declarations = exercices.map((a) =>
    calculerDeclaration2035(a, piecesValidees, categories, immobilisations, comptees, vehicules, assujettiTva, paiements, parts, declarationsTva),
  )

  // Chaque exercice est rendu dans la forme du formulaire officiel — une case par encadré, dans
  // l'ordre imprimé. Une 2035 est annuelle : plutôt que de cumuler des cases de plusieurs exercices
  // (ce qui remplirait par exemple à la fois « excédent » et « insuffisance », impossible sur un vrai
  // formulaire), on affiche un tableau par exercice.
  const formulaires = declarations.map((d) => ({ declaration: d, ...valeursDesCases(d) }))

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

  // Garde armé à l'avance : une case « dont » qui dépasse sa porteuse est une saisie contradictoire.
  // Le moteur ne remplit jamais ces cases (toutes marquées `saisieCabinet`), donc rien ne peut le
  // déclencher tant que l'écran de saisie manuelle n'existe pas — il sera en place le jour où elle
  // arrivera, plutôt qu'à écrire après coup en ayant oublié la règle.
  const incoherences: IncoherenceCase[] = formulairesOuverts.flatMap((f) => incoherencesDesCases(f.valeurs))

  // Forfait kilométrique ET frais de véhicule au réel dans la même déclaration : la dépense est
  // comptée deux fois en case BJ, et la case ne montre qu'un total qui ne dit pas de quoi il est fait.
  const doublonsVehicules: { annee: number; doublon: DoublonFraisVehicule }[] = declarationsOuvertes
    .map((d) => ({ annee: d.annee, doublon: doublonFraisVehicules(d) }))
    .filter((x): x is { annee: number; doublon: DoublonFraisVehicule } => x.doublon !== null)

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
    immobilisationsSansJustificatif(immobilisations)
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
  // manque au FEC pour la porter.
  const idsPiecesValidees = new Set(piecesValidees.map((p) => p.id))
  const concordances = new Map(declarations.map((d) => [d.annee, {
    concordance: concordance2035(d, ecritures, { piecesValidees: idsPiecesValidees, piecesImmobilisees: pieceIdsImmobilisees }, ouverture),
    comptesPartages: comptesPartagesEntreCases(d),
  }]))

  // UNE CASE NÉGATIVE NE SE DÉPOSE PAS : un poste que ses remboursements font passer sous zéro garde son signe,
  // et quand il emporte sa case, c'est ici que ça se dit (lib/cases2035.ts, `casesNegatives`).
  const negatives = declarationsOuvertes.flatMap((d) => casesNegatives(d).map((c) => ({ annee: d.annee, ...c })))

  // LA VALIDATION DE CHAQUE EXERCICE AFFICHÉ (lib/prealablesValidation.ts) : validé, ce que la base en garde ;
  // sinon ce qui l'empêche, et ce que `valider_exercice` recevrait — la numérotation même du FEC et, en trésorerie,
  // la 2035 telle qu'elle est affichée. L'année en cours est lue À PARIS, comme la base la lit. Une lecture
  // partielle de l'une des collections lues ici suspend la validation, en le disant.
  const motifValidation = lectureIncomplete ?? ecrituresIncompletes ?? naturesIncompletes ?? empruntsIncomplets ?? validationIncomplete
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
      annee, anneeCourante, modele, assujettiTva, anneesValidees,
      lectureIncomplete: motifValidation, piecesValidees, piecesAValider, categories, immobilisations, natures, ecritures,
      lignes: toutesLesLignes, ventilations, reglements, cotisations, vehicules, emprunts, aNouveaux, soldesReportes, declarationsTva,
      periodiciteTva, relevesIncoherents, doublonsTexte,
      declaration: formulaire?.declaration ?? null,
      concordance: formulaire ? concordances.get(annee)?.concordance ?? null : null,
    })
    const demande = etat.validable && etat.numerotation
      ? demandeDeValidation(etat.numerotation, formulaire
        ? instantane2035(formulaire.declaration, formulaire.valeurs, arrondirPourFormulaire(formulaire.valeurs, annee), entete)
        : null)
      : null
    return { valide: null, etat, demande, reportesEcrits: null }
  }

  // Verrou posé avant tout `await` — c'est ce qui le rend effectif contre un double clic, là où un
  // `disabled` piloté par un état React laisse passer le second clic (voir ImportDossierModal).
  const generationEnCours = useRef(false)

  // `instantane` : la 2035 d'un exercice VALIDÉ, remplie telle qu'elle a été validée — ses cases à l'euro et son
  // déclarant — plutôt que recalculée.
  async function telechargerFormulaire(annee: number, valeurs: Map<string, number>, instantane: Instantane2035 | null = null) {
    if (generationEnCours.current || lectureIncomplete) return
    generationEnCours.current = true
    setError(null)
    try {
      // Arrondi à l'euro AVANT le dessin : le formulaire dit « ne pas porter les centimes », et les
      // totaux sont recalculés depuis les cases arrondies pour que la colonne s'additionne.
      const { pdf, codesSansAncrage } = await remplir2035(
        instantane ? casesDeLInstantane(instantane.formulaire) : arrondirPourFormulaire(valeurs, annee),
        instantane ? instantane.entete : entete,
      )
      if (codesSansAncrage.length > 0) {
        setError(`Cases non placées sur le formulaire : ${codesSansAncrage.join(', ')} — leur montant manque sur le PDF.`)
      }
      const url = URL.createObjectURL(new Blob([pdf as BlobPart], { type: 'application/pdf' }))
      const lien = document.createElement('a')
      lien.href = url
      lien.download = `2035-${annee}-${((instantane ? instantane.entete.nom : null) ?? dossier?.nom ?? 'dossier').replace(/[^\w-]+/g, '-')}.pdf`
      lien.click()
      URL.revokeObjectURL(url)
      setGenere(annee)
    } catch (e) {
      setError(messageErreur(e, 'Génération du formulaire impossible'))
    } finally {
      generationEnCours.current = false
    }
  }

  // Verrou par exercice, posé avant le `try` — un `disabled` piloté par un état React laisse passer
  // un second clic dans le même rendu (voir ImportDossierModal, FactureAvoirModal et les autres
  // porteurs de ce motif recensés dans CLAUDE.md).
  const cloturesEnCours = useRef<Set<number>>(new Set())

  async function handleCloturer(annee: number) {
    if (cloturesEnCours.current.has(annee)) return
    cloturesEnCours.current.add(annee)
    setError(null)
    setClotureMessage(null)
    const dejaCloture = cloturesConnues.has(annee)
    // LA CONFIRMATION NOMME LES DEUX CONSÉQUENCES, et c'est une correction du 22/09/2026 : la marque
    // de clôture en commande désormais une SECONDE, l'arrêt des réclamations de documents pour cet
    // exercice sur les trois écrans « ce qu'il reste à envoyer » (voir lib/resteAEnvoyer.ts). Un
    // message qui n'en nomme qu'une laisse cocher pour l'une et subir l'autre — et celle qu'il
    // taisait est justement celle qui fait qu'on vient cliquer ici.
    //
    // Même règle que les quatorze autres confirmations du projet : on NOMME ce qu'on perd
    // (« et tous ses mouvements », « La pièce redevient une charge courante ordinaire »).
    // « Êtes-vous sûr ? » se ferme d'un clic aussi distrait que le premier.
    const confirmation = dejaCloture
      ? `Relancer la purge des pièces sensibles de l'exercice ${annee} ? Cet exercice est déjà clôturé — cette action rattrape seulement les pièces validées depuis.`
      : `Clôturer l'exercice ${annee} ? Cette action est irréversible, et elle fait DEUX choses.\n\n`
        + `1. Le texte OCR déjà lu des justificatifs de recette (bordereaux de télétransmission) de `
        + `cet exercice sera supprimé définitivement. Les fichiers déposés, eux, ne sont pas touchés.\n\n`
        + `2. On cesse de réclamer les documents de ${annee} : ni la checklist du dossier, ni l'espace `
        + `du client ne les redemanderont.`
    if (!window.confirm(confirmation)) {
      cloturesEnCours.current.delete(annee)
      return
    }
    try {
      const resultat = await cloturerExercice(dossierId, annee)
      setCloturesConnues((prev) => new Set(prev).add(annee))
      setClotureMessage(
        resultat.piecesPurgees > 0
          ? `Exercice ${annee} clôturé — texte OCR supprimé pour ${resultat.piecesPurgees} pièce(s) sensible(s).`
          : `Exercice ${annee} clôturé — aucune pièce sensible à purger pour l'instant.`,
      )
    } catch (e) {
      setError(messageErreur(e, "Impossible de clôturer l'exercice."))
    } finally {
      cloturesEnCours.current.delete(annee)
    }
  }

  // Ce que le calcul a écarté, tous exercices affichés confondus. Une pièce validée qui n'entre dans
  // aucun total était jusqu'ici retirée par un `continue` muet : sur une base fiscale, c'est un
  // manquant que personne ne voit. Dédoublonné par id, une même pièce pouvant sortir d'un exercice
  // à l'autre pour la même raison.
  const exclues = new Map<string, { piece: Piece; raison: string }>()
  for (const d of declarationsOuvertes) {
    for (const p of d.exclusions.sansPoste) exclues.set(p.id, { piece: p, raison: 'catégorie sans poste 2035' })
    for (const p of d.exclusions.sansDate) exclues.set(p.id, { piece: p, raison: 'aucune date' })
    for (const p of d.exclusions.sansMontant) exclues.set(p.id, { piece: p, raison: 'aucun montant lisible' })
  }
  const piecesExclues = [...exclues.values()]
  // Même chose côté relevé : un mouvement affecté que la déclaration n'a pas pu compter. Un mouvement ne
  // compte que dans l'exercice de sa date, donc il ne peut sortir que d'une seule déclaration.
  const mouvementsExclus = declarationsOuvertes.flatMap((d) => [
    ...d.exclusions.mouvementsSansPoste.map((m) => ({ mouvement: m, raison: 'catégorie sans poste 2035' })),
    ...d.exclusions.mouvementsHorsResultat.map((m) => ({ mouvement: m, raison: 'compte de la catégorie hors charges et produits' })),
  ])

  // Ce qui compte à sa DATE DE FACTURE faute de paiement rapproché, exercice par exercice : une
  // supposition, pas une lecture — la pièce a peut-être été payée une autre année. Dite ici, sur
  // l'écran qui remplit la 2035, parce que c'est la seule chose qui distingue « payée en décembre » de
  // « facturée en décembre et payée on ne sait quand ».
  const sansPaiement = declarationsOuvertes.flatMap((d) => d.sansPaiementConnu.map((s) => ({ annee: d.annee, ...s })))
  // Les échéances de cotisation qu'aucun prélèvement rapproché ne date : elles comptent à leur échéance,
  // pour le versement saisi ou l'appel — une SUPPOSITION, dite comme celle des pièces ci-dessus
  // (lib/cotisationRapprochee.ts). Seulement celles des exercices affichés.
  const echeancesSansPaiement = comptees
    .filter((c) => c.ligne === null && exercices.includes(anneeDe(c.date)) && ouvert(anneeDe(c.date)))
    .sort((x, y) => x.date.localeCompare(y.date))

  // LA CARTE DES POSTES MANQUANTS VIT DANS LES DEUX MODÈLES. En engagement la 2035 n'est pas produite,
  // mais le poste regroupe encore les recettes et les charges de la situation intermédiaire (onglet
  // Financement) et du détail par poste de l'estimation, qui écartent une pièce sans poste — et c'est
  // ici que la Checklist envoie le compléter. Masquée avec le reste de la 2035, elle laissait le point
  // de la Checklist renvoyer vers un écran qui ne montre rien.
  const cartePostesManquants = categoriesSansPoste.length > 0 && (
    <div className="card" style={{ marginBottom: 20 }}>
      <h3 style={{ marginTop: 0 }}>Postes manquants</h3>
      <p className="muted" style={{ marginTop: -8 }}>
        {modeComptable === 'engagement'
          ? 'Ces catégories sont utilisées par des pièces validées ou des mouvements affectés mais n\'ont pas encore de poste associé. '
            + 'Ce dossier ne produit pas de 2035, mais le poste regroupe encore les recettes et les charges de '
            + 'la situation intermédiaire (onglet Financement) et du détail par poste de l\'estimation : leurs '
            + 'montants n\'y sont pas comptés tant que ce n\'est pas fait.'
          : 'Ces catégories sont utilisées par des pièces validées ou des mouvements affectés mais n\'ont pas encore de poste 2035 '
            + 'associé — leurs montants ne sont pas comptés dans le récapitulatif tant que ce n\'est pas fait.'}
        {' '}Un poste déjà renseigné est une suggestion à vérifier, pas une valeur figée.
      </p>
      <table>
        <thead><tr><th>Catégorie</th><th>Poste 2035</th><th></th></tr></thead>
        <tbody>
          {categoriesSansPoste.map((c) => (
            <tr key={c.id}>
              <td>{c.libelle}</td>
              <td style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: '5px 8px', width: 220 }}
                  placeholder="ex. Achats, Loyers, Recettes..."
                  value={posteAffiche(c)}
                  onChange={(e) => setPostesEdit((prev) => ({ ...prev, [c.id]: e.target.value }))}
                />
                {!postesEdit[c.id] && SUGGESTIONS_COMPTE_PAR_CODE[c.code] && (
                  <span className="badge badge-neutral">suggestion</span>
                )}
              </td>
              <td>
                <button className="btn btn-outline btn-sm" onClick={() => savePoste(c.id)}>Enregistrer</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )

  if (modeComptable === 'engagement') {
    const exercicesACloturer = typeof anneeFilter === 'number' ? [anneeFilter] : anneesDisponibles
    return (
      <>
        <BrouillonBanner />
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ marginTop: 0 }}>La 2035 n’est pas produite pour ce dossier</h3>
          <p className="muted" style={{ margin: 0 }}>
            Ce dossier est tenu en comptabilité d’engagement (BIC, IS). La 2035 déclare des bénéfices
            non commerciaux, déterminés sur les recettes encaissées et les dépenses payées : elle ne se
            tire pas d’une comptabilité d’engagement, pas plus que le volet social qui en découle. La
            liasse d’un tel dossier (2033 ou 2050) n’est pas encore préparée par l’application ; ses
            livrables sont le FEC et la balance des comptes, depuis l’onglet Écritures.
          </p>
        </div>
        {cloturesInconnues && (
          <p className="error-text">
            {cloturesInconnues} On ne sait donc pas quels exercices sont déjà clôturés : le bouton
            ci-dessous propose « Clôturer » même si ça a déjà été fait. Le rejouer ne pose pas de
            seconde clôture — il rattrape seulement les pièces validées depuis.
          </p>
        )}
        {error && <p className="error-text">{error}</p>}
        {clotureMessage && <p className="muted">{clotureMessage}</p>}
        {cartePostesManquants}
        {loading ? (
          <div className="card"><p className="muted" style={{ margin: 0 }}>Chargement…</p></div>
        ) : exercicesACloturer.length === 0 ? (
          <div className="card"><div className="empty-state">Aucun exercice à clôturer pour l'instant.</div></div>
        ) : (
          exercicesACloturer.map((annee) => (
            <Fragment key={annee}>
              <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
                <strong>Exercice {annee}</strong>
                <BoutonCloture cloture={cloturesConnues.has(annee)} onCloturer={() => handleCloturer(annee)} />
              </div>
              <ValidationExerciceCard
                dossierId={dossierId} annee={annee} {...validationDe(annee)} estChef={estChef} onValide={apresValidation} onNavigate={onNavigate}
                onChoisirExercice={setAnnee}
              />
            </Fragment>
          ))
        )}
      </>
    )
  }

  return (
    <>
      <BrouillonBanner />
      <p className="muted" style={{ marginTop: -8, marginBottom: 20 }}>
        Regroupement par poste de la 2035 des pièces validées et des mouvements du relevé affectés à
        une catégorie, complété par les amortissements et les cotisations sociales versées. Un simple
        total par poste — pas un résultat ni un calcul d'impôt, ce travail reste celui de
        l'expert-comptable.
      </p>

      {anneeFilter === 'toutes' && anneesDisponibles.length > 1 && (
        <p className="muted" style={{ marginTop: -4, marginBottom: 20, color: 'var(--color-warning)' }}>
          ⚠ Plusieurs exercices ({anneesDisponibles.join(', ')}) sont mélangés dans ce total — choisis
          un exercice dans le sélecteur en en-tête du dossier pour un vrai total de clôture.
        </p>
      )}

      {piecesSansCategorie.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            Pièces validées sans catégorie <span className="badge badge-danger">à traiter</span>
          </h3>
          <p className="muted" style={{ marginTop: -8 }}>
            {piecesSansCategorie.length === 1 ? 'Cette pièce validée n\'a' : `Ces ${piecesSansCategorie.length} pièces validées n'ont`} aucune catégorie : {piecesSansCategorie.length === 1 ? 'son montant n\'entre' : 'leurs montants n\'entrent'} dans aucun total ci-dessous, ni dans la 2035. Le récapitulatif est donc incomplet de {formatMoney(piecesSansCategorie.reduce((s, p) => s + (p.montant_ttc ?? 0), 0))} tant que la catégorie n'est pas donnée depuis l'onglet Justificatifs.
          </p>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {piecesSansCategorie.map((p) => (
              <li key={p.id}>{p.tiers ?? p.nom_fichier} — {formatMoney(p.montant_ttc)}{p.date_piece ? ` (${p.date_piece})` : ''}</li>
            ))}
          </ul>
        </div>
      )}

      {cartePostesManquants}

      {piecesExclues.length > 0 && (
        <div className="card" style={{ marginBottom: 20, borderLeft: '3px solid var(--color-warning)' }}>
          <h3 style={{ marginTop: 0 }}>Pièces validées absentes du récapitulatif ({piecesExclues.length})</h3>
          <p className="muted" style={{ marginTop: -8 }}>
            Ces pièces sont validées mais n'entrent dans aucun total : leur montant manquera dans la
            déclaration tant que la cause n'est pas levée.
          </p>
          <table>
            <thead><tr><th>Pièce</th><th>Motif</th><th style={{ textAlign: 'right' }}>Montant</th></tr></thead>
            <tbody>
              {piecesExclues.map(({ piece: p, raison }) => (
                <tr key={p.id}>
                  <td>{p.tiers ?? p.nom_fichier}</td>
                  <td className="muted">{raison}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {formatMoney(montantRetenu(p, assujettiTva))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {mouvementsExclus.length > 0 && (
        <div className="card" style={{ marginBottom: 20, borderLeft: '3px solid var(--color-warning)' }}>
          <h3 style={{ marginTop: 0 }}>Mouvements affectés absents du récapitulatif ({mouvementsExclus.length})</h3>
          <p className="muted" style={{ marginTop: -8 }}>
            Ces mouvements du relevé — ou ces parts d'un mouvement ventilé — sont affectés à une
            catégorie mais n'entrent dans aucun total : leur montant manquera dans la déclaration tant
            que la catégorie n'a pas de poste 2035, ou tant qu'elle n'est pas revenue sur un compte de
            charge ou de produit.
          </p>
          <div className="table-scroll">
            <table>
              <thead><tr><th>Date</th><th>Mouvement</th><th>Catégorie</th><th>Motif</th><th style={{ textAlign: 'right' }}>Montant</th></tr></thead>
              <tbody>
                {mouvementsExclus.map(({ mouvement: m, raison }) => (
                  <tr key={`${m.origine}|${m.ligne.id}|${m.libelle}`}>
                    <td>{formatDate(m.ligne.date)}</td>
                    <td>{m.ligne.libelle}</td>
                    <td>{m.libelle}</td>
                    <td className="muted">{raison}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatMoney(m.montantReleve)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <BandeauLecturePartielle
        quoi="Les emprunts"
        accord="lus"
        motif={empruntsIncomplets}
        consequence={
          'Des échéances d’emprunt que rien ne paie peuvent donc manquer à la liste de cet écran : leurs ' +
          'intérêts manqueraient à la 2035 sans que rien le dise. Recharge la page.'
        }
      />

      {echeancesManquantes.length > 0 && (
        <div className="card" style={{ marginBottom: 20, borderLeft: '3px solid var(--color-warning)' }}>
          <h3 style={{ marginTop: 0 }}>Échéances d’emprunt non rapprochées ({echeancesManquantes.length})</h3>
          <p className="muted" style={{ marginTop: -8 }}>
            L’échéancier prévoit ces échéances et aucun mouvement du relevé ne les paie : leurs intérêts —
            {' '}{formatMoney(interetsManquants)} selon l’échéancier — et leur assurance ne comptent pas dans la
            2035. Rapproche chaque prélèvement de son échéance dans l’onglet Banque ; si le relevé de ces
            mois n’est pas encore importé, c’est par là qu’il faut commencer.
          </p>
          <details>
            <summary>Voir les échéances</summary>
            <div className="table-scroll">
              <table>
                <thead><tr><th>Exercice</th><th>Emprunt</th><th>Échéance</th><th>Date prévue</th><th style={{ textAlign: 'right' }}>Intérêts prévus</th></tr></thead>
                <tbody>
                  {echeancesManquantes.map(({ annee, emprunt, echeance }) => (
                    <tr key={`${annee}-${emprunt.id}-${echeance.numero}`}>
                      <td>{annee}</td>
                      <td>{emprunt.nom}</td>
                      <td>n° {echeance.numero}</td>
                      <td>{formatDate(echeance.date)}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatMoney(echeance.interets)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      )}

      {sansPaiement.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ marginTop: 0 }}>Pièces comptées à leur date de facture ({sansPaiement.length})</h3>
          <p className="muted" style={{ marginTop: -8 }}>
            Aucun paiement rapproché ne date ces pièces : elles comptent dans l'exercice de leur
            facture. Une recette se déclare l'année de son encaissement, une dépense l'année de son
            paiement — si l'une a été réglée une autre année, la rapprocher de son mouvement dans
            l'onglet Banque la fera changer d'exercice.
          </p>
          <details>
            <summary>Voir les pièces</summary>
            <div className="table-scroll">
              <table>
                <thead><tr><th>Exercice</th><th>Pièce</th><th>Date de facture</th><th style={{ textAlign: 'right' }}>Montant compté</th></tr></thead>
                <tbody>
                  {sansPaiement.map(({ annee, piece: p, montant }) => (
                    <tr key={`${annee}-${p.id}`}>
                      <td>{annee}</td>
                      <td>{p.tiers ?? p.nom_fichier}</td>
                      <td>{formatDate(p.date_piece)}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatMoney(montant)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      )}

      {echeancesSansPaiement.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ marginTop: 0 }}>Cotisations comptées à leur échéance ({echeancesSansPaiement.length})</h3>
          <p className="muted" style={{ marginTop: -8 }}>
            Aucun prélèvement rapproché ne paie ces échéances : elles comptent dans l'exercice de leur
            échéance, pour le versement saisi ou l'appel. Une cotisation se déduit l'année où elle est
            payée — rapprocher l'échéance de son prélèvement dans l'onglet Banque la compte à la date et
            au montant du relevé, et l'écrit.
          </p>
          <details>
            <summary>Voir les échéances</summary>
            <div className="table-scroll">
              <table>
                <thead><tr><th>Exercice</th><th>Échéance</th><th style={{ textAlign: 'right' }}>Montant compté</th></tr></thead>
                <tbody>
                  {echeancesSansPaiement.map((c) => (
                    <tr key={c.cotisation.id}>
                      <td>{anneeDe(c.date)}</td>
                      <td>{formatDate(c.date)}{c.cotisation.previsionnel ? ' (prévisionnelle)' : ''}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatMoney(c.montant)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      )}

      {postesSansCase.length > 0 && (
        <div className="card" style={{ marginBottom: 20, borderLeft: '3px solid var(--color-warning)' }}>
          <h3 style={{ marginTop: 0 }}>Postes sans case du formulaire ({postesSansCase.length})</h3>
          <p className="muted" style={{ marginTop: -8 }}>
            Ces postes ont bien un total, mais le rattachement ne sait pas dans quelle case du
            formulaire les porter — leur montant n'apparaîtra nulle part sur la 2035, et l'exercice ne se
            valide pas tant que c'est le cas. Donnez à leur catégorie un poste du formulaire : la liste
            propose ses libellés.
          </p>
          <table>
            <thead><tr><th>Poste</th><th>Motif</th><th style={{ textAlign: 'right' }}>Montant</th></tr></thead>
            <tbody>
              {postesSansCase.map((p) => (
                <tr key={`${p.ligne.nature}:${p.ligne.poste}`}>
                  <td>{p.ligne.poste}</td>
                  <td className="muted">
                    {p.raison === 'case du mauvais sens'
                      ? `case ${p.codeRefuse} incompatible avec une ${p.ligne.nature}`
                      : p.raison}
                  </td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {formatMoney(p.ligne.montant)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {categoriesSansCase.length > 0 && (
            <div className="table-scroll tableau-adaptable" style={{ marginTop: 14 }}>
              <table className="table-formulaire table-empilable">
                <thead><tr><th>Catégorie</th><th>Poste actuel</th><th>Nouveau poste</th><th></th></tr></thead>
                <tbody>
                  {categoriesSansCase.map((c) => (
                    <tr key={c.id}>
                      <td data-libelle="Catégorie">{c.libelle}</td>
                      <td data-libelle="Poste actuel">{c.poste_2035}</td>
                      <td data-libelle="Nouveau poste">
                        <input
                          list="postes-du-formulaire"
                          aria-label={`Nouveau poste de la catégorie ${c.libelle}`}
                          placeholder="ex. Achats, Loyers et charges locatives…"
                          value={postesEdit[c.id] ?? ''}
                          onChange={(e) => setPostesEdit((prev) => ({ ...prev, [c.id]: e.target.value }))}
                        />
                      </td>
                      <td>
                        <button
                          className="btn btn-outline btn-sm"
                          disabled={!(postesEdit[c.id] ?? '').trim()}
                          onClick={() => savePoste(c.id, false)}
                        >
                          Enregistrer
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <datalist id="postes-du-formulaire">
                {POSTES_PROPOSABLES.map((poste) => <option key={poste} value={poste} />)}
              </datalist>
            </div>
          )}
          {piecesAContresens.size > 0 && (
            <>
              <p className="muted" style={{ marginTop: 14 }}>
                {piecesAContresens.size === 1 ? 'Une pièce est rangée' : `${piecesAContresens.size} pièces sont rangées`} dans
                une catégorie de l'autre sens — une vente dans une catégorie de dépense, ou un achat dans une catégorie de
                recette : c'est la pièce qui change de catégorie, dans les justificatifs. Renommer la catégorie ferait
                perdre leur case à ses autres pièces.
              </p>
              <div className="table-scroll">
                <table>
                  <thead><tr><th>Pièce</th><th>Type</th><th>Catégorie</th><th style={{ textAlign: 'right' }}>Montant</th></tr></thead>
                  <tbody>
                    {[...piecesAContresens.values()].map((p) => (
                      <tr key={p.id}>
                        <td>{p.tiers ?? p.nom_fichier}</td>
                        <td className="muted">{p.type_piece === 'vente' ? 'Vente' : 'Achat'}</td>
                        <td>{categories.find((c) => c.id === p.categorie_id)?.libelle ?? '—'}</td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          {formatMoney(montantRetenu(p, assujettiTva))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {onNavigate && (
                <button className="btn btn-outline btn-sm" style={{ marginTop: 10 }} onClick={() => onNavigate('pieces')}>
                  Ouvrir les justificatifs
                </button>
              )}
            </>
          )}
        </div>
      )}

      {csgSansVentilation.length > 0 && (
        <div className="card" style={{ marginBottom: 20, borderLeft: '3px solid var(--color-warning)' }}>
          <h3 style={{ marginTop: 0 }}>Cotisations dont la CSG-CRDS n’est pas saisie</h3>
          <p className="muted" style={{ marginTop: -8 }}>
            Quand le montant « dont CSG-CRDS » est renseigné, la déclaration l’extrait de la ligne 25
            et porte ses 6,8 points déductibles en case BV (ligne 14) — la part non déductible ne
            figure alors nulle part, et il n’y a rien à réintégrer. <strong>Les cotisations listées
            ci-dessous n’ont pas ce montant</strong> : elles restent portées en entier ligne 25, donc
            leur part non déductible part en déduction, et aucun calcul ne peut la retrouver — le
            taux ne s’applique pas au montant total d’un appel. Saisissez-la dans Cotisations
            (« dont CSG-CRDS »).
          </p>
          {/* Une colonne porte une phrase : dans une carte étroite — volet de droite ouvert —, le tableau se replie en
              fiches plutôt que de sortir de la carte (voir `.tableau-adaptable` dans index.css). */}
          <div className="table-scroll tableau-adaptable">
            <table className="table-empilable">
              <thead>
                <tr>
                  <th>Exercice</th>
                  <th style={{ textAlign: 'right' }}>CSG-CRDS saisie</th>
                  <th style={{ textAlign: 'right' }}>dont déductible, portée en BV</th>
                  <th style={{ textAlign: 'right' }}>sortie du résultat</th>
                  <th>Cotisations sans CSG-CRDS saisie</th>
                </tr>
              </thead>
              <tbody>
                {csgSansVentilation.map(({ annee, part }) => (
                  <tr key={annee}>
                    <td data-libelle="Exercice">{annee}</td>
                    <td data-libelle="CSG-CRDS saisie" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatMoney(part.totalCsgCrds)}</td>
                    <td data-libelle="dont déductible, portée en BV" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatMoney(part.csgDeductible)}</td>
                    <td data-libelle="sortie du résultat" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {formatMoney(part.csgNonDeductible)}
                    </td>
                    <td data-libelle="Cotisations sans CSG-CRDS saisie" style={{ color: 'var(--color-danger)' }}>
                      {`${part.nbSansVentilation} — part non déductible non chiffrable, à saisir dans Cotisations (« dont CSG-CRDS »)`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {amortissementsSansJustificatif.length > 0 && (
        <div className="card" style={{ marginBottom: 20, borderLeft: '3px solid var(--color-danger)' }}>
          <h3 style={{ marginTop: 0 }}>
            Amortissement(s) sans justificatif ({amortissementsSansJustificatif.length})
          </h3>
          <p className="muted" style={{ marginTop: -8 }}>
            La pièce qui justifiait ce bien a été supprimée : le lien est défait en silence et la dotation
            part quand même en case CH. Retrouve le justificatif, ou retire l’immobilisation depuis
            l’onglet Immobilisations avant de déposer cette déclaration.
          </p>
          <table>
            <thead>
              <tr>
                <th>Exercice</th>
                <th>Bien</th>
                <th>Acquisition</th>
                <th style={{ textAlign: 'right' }}>Dotation comptée</th>
              </tr>
            </thead>
            <tbody>
              {amortissementsSansJustificatif.map(({ annee, immo, dotation }) => (
                <tr key={`${annee}-${immo.id}`}>
                  <td>{annee}</td>
                  <td>{immo.libelle}</td>
                  <td>{formatDate(immo.date_acquisition)}</td>
                  <td style={{ textAlign: 'right' }}>{formatMoney(dotation)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {doublonsVehicules.length > 0 && (
        <div className="card" style={{ marginBottom: 20, borderLeft: '3px solid var(--color-danger)' }}>
          <h3 style={{ marginTop: 0 }}>Frais de véhicule comptés deux fois ({doublonsVehicules.length})</h3>
          <p className="muted" style={{ marginTop: -8 }}>
            Le barème kilométrique et des frais de véhicule au réel arrivent tous les deux dans la
            case BJ. La notice (renvoi 12) est explicite : l'option pour le forfait vaut pour l'année
            entière et pour tous les véhicules, et les dépenses qu'il couvre ne doivent alors figurer
            à aucun poste de charges. Il faut retirer l'un des deux — le choix vous revient, il engage
            l'exercice entier.
          </p>
          <table>
            <thead>
              <tr>
                <th>Exercice</th>
                <th>Poste au réel</th>
                <th style={{ textAlign: 'right' }}>Montant au réel</th>
                <th style={{ textAlign: 'right' }}>Barème kilométrique</th>
              </tr>
            </thead>
            <tbody>
              {doublonsVehicules.map(({ annee, doublon }) => (
                <tr key={annee}>
                  <td>{annee}</td>
                  <td>{doublon.postes.map((p) => p.poste).join(', ')}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--color-danger)' }}>
                    {formatMoney(doublon.totalPostes)}
                  </td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {formatMoney(doublon.montantIndemnites)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <BandeauLecturePartielle
        quoi="Les natures d’immobilisation"
        motif={naturesIncompletes}
        consequence="Un véhicule du registre amorti l’année où le barème kilométrique est retenu peut donc ne pas être signalé ci-dessous."
      />

      {amortissementsVehicules.length > 0 && (
        <div className="card" style={{ marginBottom: 20, borderLeft: '3px solid var(--color-danger)' }}>
          <h3 style={{ marginTop: 0 }}>Amortissement d’un véhicule déduit avec le barème ({amortissementsVehicules.length})</h3>
          <p className="muted" style={{ marginTop: -8 }}>
            Le barème kilométrique couvre déjà l’amortissement du véhicule. La notice de la 2035 le dit au tableau des
            immobilisations : en cas d’option pour le barème, « les amortissements afférents à ces véhicules doivent être
            réintégrés au cadre B du tableau des immobilisations et des amortissements ». La case CH compte pourtant la
            dotation de ce matériel de transport : réintégrez-la sur la déclaration, ou retirez le bien du registre s’il
            n’est pas le véhicule du cadre 7. L’application ne le fait pas à votre place.
          </p>
          <table>
            <thead>
              <tr>
                <th>Exercice</th><th>Bien</th><th style={{ textAlign: 'right' }}>Dotation comptée en CH</th>
              </tr>
            </thead>
            <tbody>
              {amortissementsVehicules.map(({ annee, immobilisation, dotation }) => (
                <tr key={`${annee}-${immobilisation.id}`}>
                  <td>{annee}</td>
                  <td>{immobilisation.libelle}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--color-danger)' }}>
                    {formatMoney(dotation)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {vehiculesNonCalcules.length > 0 && (
        <div className="card" style={{ marginBottom: 20, borderLeft: '3px solid var(--color-warning)' }}>
          <h3 style={{ marginTop: 0 }}>Véhicules absents de la case BJ ({vehiculesNonCalcules.length})</h3>
          <p className="muted" style={{ marginTop: -8 }}>
            Ces véhicules sont déclarés et leurs kilomètres saisis, mais l'indemnité n'a pas pu être
            calculée : leur déduction manque ligne 23 du formulaire, et rien sur le PDF ne le dirait.
          </p>
          <table>
            <thead>
              <tr>
                <th>Exercice</th><th>Véhicule</th><th style={{ textAlign: 'right' }}>Km pro</th><th>Motif</th>
              </tr>
            </thead>
            <tbody>
              {vehiculesNonCalcules.map((n, i) => (
                <tr key={`${n.annee}-${i}`}>
                  <td>{n.annee}</td>
                  <td>
                    {n.vehicule.type}
                    {n.vehicule.type !== 'cyclomoteur' && ` ${n.vehicule.puissanceFiscale} CV`}
                    {n.vehicule.electrique && ' électrique'}
                  </td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {n.vehicule.kmProfessionnel.toLocaleString('fr-FR')}
                  </td>
                  <td className="muted">{n.motif}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {incoherences.length > 0 && (
        <div className="card" style={{ marginBottom: 20, borderLeft: '3px solid var(--color-danger)' }}>
          <h3 style={{ marginTop: 0 }}>Cases « dont » incohérentes ({incoherences.length})</h3>
          <p className="muted" style={{ marginTop: -8 }}>
            Une case « dont » est une part de sa case porteuse : son montant y est déjà compté, il ne
            peut donc pas la dépasser. Les deux cases sont éloignées sur le formulaire, c'est le genre
            d'écart qu'une relecture ne rapproche pas toute seule.
          </p>
          <table>
            <thead>
              <tr>
                <th>Case porteuse</th>
                <th>Cases « dont »</th>
                <th style={{ textAlign: 'right' }}>Total « dont »</th>
                <th style={{ textAlign: 'right' }}>Porteuse</th>
              </tr>
            </thead>
            <tbody>
              {incoherences.map((i) => (
                <tr key={i.porteuse.code}>
                  <td>
                    <span style={{ fontFamily: 'monospace' }}>{i.porteuse.code}</span>
                    <span className="muted" style={{ marginLeft: 8 }}>{i.porteuse.libelle}</span>
                  </td>
                  <td style={{ fontFamily: 'monospace' }}>{i.sousCases.map((c) => c.code).join(' + ')}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--color-danger)' }}>
                    {formatMoney(i.totalSousCases)}
                  </td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {formatMoney(i.montantPorteuse)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {negatives.length > 0 && (
        <div className="card" style={{ marginBottom: 20, borderLeft: '3px solid var(--color-danger)' }}>
          <h3 style={{ marginTop: 0 }}>Case négative ({negatives.length})</h3>
          <p className="muted" style={{ marginTop: -8 }}>
            Les avoirs et les remboursements de l’exercice y dépassent ce que la case compte. Le formulaire
            n’admet pas de montant négatif : un remboursement reçu une année sans dépense du même poste se
            rattache le plus souvent à une dépense d’un exercice antérieur, et sa place est à arbitrer avant de
            signer. Le calcul ne le retourne plus en dépense — il le laissait compter deux fois à l’envers.
          </p>
          <div className="table-scroll">
            <table>
              <thead><tr><th>Exercice</th><th>Case</th><th>Postes</th><th style={{ textAlign: 'right' }}>Montant</th></tr></thead>
              <tbody>
                {negatives.map((n) => (
                  <tr key={`${n.annee}-${n.case.code}`}>
                    <td>{n.annee}</td>
                    <td>
                      <span style={{ fontFamily: 'monospace' }}>{n.case.code}</span>
                      <span className="muted" style={{ marginLeft: 8 }}>{n.case.libelle}</span>
                    </td>
                    <td>{n.postes.join(', ')}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--color-danger)' }}>{formatMoney(n.montant)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {cloturesInconnues && (
        <p className="error-text">
          {cloturesInconnues} On ne sait donc pas quels exercices sont déjà clôturés : le bouton
          ci-dessous propose « Clôturer » même si ça a déjà été fait. Le rejouer ne pose pas de
          seconde clôture — il rattrape seulement les pièces validées depuis.
        </p>
      )}

      {lectureIncomplete && (
        <p className="error-text">
          Une des entrées dont dépend la déclaration n'a pas pu être lue en entier
          ({lectureIncomplete}) — pièces, catégories, immobilisations, cotisations, véhicules,
          mouvements du relevé et leurs ventilations, déclarations de TVA, ou l'identité du dossier. Les
          montants ci-dessous portent donc sur une partie du dossier, et le remplissage du
          formulaire est bloqué : une 2035 calculée sur une lecture partielle est plausible, fausse,
          et signée.
        </p>
      )}

      {error && <p className="error-text">{error}</p>}
      {clotureMessage && <p className="muted">{clotureMessage}</p>}

      {loading ? (
        <div className="card"><p className="muted" style={{ margin: 0 }}>Chargement…</p></div>
      ) : formulaires.length === 0 ? (
        <div className="card"><div className="empty-state">Rien à regrouper pour l'instant.</div></div>
      ) : (
        formulaires.map((f) => {
          const annee = f.declaration.annee
          const validation = validationDe(annee, f)
          // La 2035 d'un exercice validé est celle que la base garde, pas un calcul d'aujourd'hui. Illisible, elle ne
          // s'affiche pas : montrer le calcul d'aujourd'hui à sa place laisserait signer autre chose que ce qui a été
          // validé.
          const instantane = validation.valide ? lireInstantane2035(validation.valide.declaration) : null
          return (
            <Fragment key={annee}>
              {validation.valide && !instantane ? (
                <div className="card" style={{ marginBottom: 20 }}>
                  <strong>Exercice {annee}</strong>
                  <p className="error-text" style={{ marginBottom: 0 }}>
                    La 2035 validée de {annee} n'a pas pu être relue : elle ne s'affiche pas, plutôt que de montrer à
                    sa place un calcul d'aujourd'hui qui n'est pas celui qui a été validé.
                  </p>
                </div>
              ) : (
                <FormulaireAnnuel
                  dossierId={dossierId}
                  annee={annee}
                  valeurs={instantane ? casesDeLInstantane(instantane.cases) : f.valeurs}
                  formulaire={instantane ? casesDeLInstantane(instantane.formulaire) : undefined}
                  validee={validation.valide && instantane
                    ? { le: validation.valide.valide_le, casesDifferentes: casesQuiDifferent(instantane, f.valeurs) }
                    : undefined}
                  genere={genere === annee}
                  onTelecharger={() => telechargerFormulaire(annee, f.valeurs, instantane)}
                  blocage={lectureIncomplete}
                  cloture={cloturesConnues.has(annee)}
                  onCloturer={() => handleCloturer(annee)}
                />
              )}
              <ConcordanceCard
                concordance={concordances.get(annee)!.concordance}
                comptesPartages={concordances.get(annee)!.comptesPartages}
                lectureIncomplete={lectureIncomplete ?? ecrituresIncompletes}
                ouverture={ouverture}
                figePar={exerciceQuiFige(annee, anneesValidees)}
              />
              <ValidationExerciceCard
                dossierId={dossierId} annee={annee} {...validation} estChef={estChef} onValide={apresValidation} onNavigate={onNavigate}
                onChoisirExercice={setAnnee}
              />
            </Fragment>
          )
        })
      )}
    </>
  )
}

// La clôture d'un exercice, écrite une fois pour les deux modèles : en engagement elle reste offerte
// alors que la 2035 ne l'est pas — elle ne dépend pas de la déclaration.
function BoutonCloture({ cloture, onCloturer }: { cloture: boolean; onCloturer: () => void }) {
  return (
    <>
      {cloture && <span className="badge badge-neutral">exercice clôturé</span>}
      <button
        className="btn btn-outline btn-sm"
        onClick={onCloturer}
        title={cloture
          ? "Rattraper la purge du texte OCR pour les pièces sensibles validées depuis la clôture."
          : "Marque l'exercice comme clôturé et supprime définitivement le texte OCR déjà lu des justificatifs de recette (bordereaux de télétransmission) de cet exercice."}
      >
        {cloture ? '↻ Rattraper la purge' : '🔒 Clôturer l’exercice'}
      </button>
    </>
  )
}

// Un exercice rendu dans la forme du formulaire : une ligne par case, dans l'ordre imprimé, avec son
// code et son libellé officiels. C'est ce qui permet à l'expert-comptable de relire case par case
// plutôt que de retraduire des « postes » maison — et c'est la même structure qui alimentera le PDF.
function FormulaireAnnuel({ dossierId, annee, valeurs, formulaire, validee, genere, onTelecharger, blocage, cloture, onCloturer }: {
  dossierId: string
  annee: number
  valeurs: Map<string, number>
  // Les cases à l'euro d'une 2035 VALIDÉE, telles que la base les garde ; sinon calculées depuis `valeurs`.
  formulaire?: Map<string, number>
  // Une 2035 validée : quand, et les cases qu'un calcul d'aujourd'hui ne retrouverait plus.
  validee?: { le: string; casesDifferentes: string[] }
  genere: boolean
  onTelecharger: () => void
  // Non nul quand la lecture des pièces n'a pas pu se dire complète : le bouton est alors grisé et
  // dit pourquoi, plutôt que de produire un formulaire qu'on croirait complet.
  blocage: string | null
  // Vrai si le cabinet a déjà demandé la clôture de cet exercice — le bouton change de libellé mais
  // reste actif, pour rattraper une pièce sensible validée après coup (voir clotureExercice.ts).
  cloture: boolean
  onCloturer: () => void
}) {
  // Une case à zéro que personne n'a alimentée n'apprend rien et noie le reste : on ne montre que
  // les cases qui portent un montant, plus les totaux, toujours affichés parce que c'est sur eux que
  // se fait la relecture. Sauf une case que le formulaire de cet exercice ne porte pas encore (le
  // cadre 8 avant les revenus 2025) : l'afficher à zéro ferait chercher sur la déclaration une case
  // qui n'y est pas.
  const visibles = CASES_2035.filter((c) =>
    (c.depuisExercice ?? annee) <= annee && ((valeurs.get(c.code) ?? 0) !== 0 || c.calculee))

  return (
    <div className="card" style={{ padding: 0, marginBottom: 20 }}>
      {/* `wrap` aux DEUX rangées : sur téléphone, « Clôturer l'exercice » et « Remplir le formulaire officiel » côte à côte
          mesurent plus que la carte (109 px de trop, vus au banc). Les boutons passent donc à la ligne entre eux, et le titre
          de l'exercice aussi, au lieu d'être réduit à un mot par ligne à côté d'eux. */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, padding: '14px 16px' }}>
        <div>
          <strong>Exercice {annee}</strong>
          <span className="muted" style={{ marginLeft: 10, fontSize: '0.9em' }}>
            2035-A-SD et 2035-B-SD — à relire case par case avant dépôt
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <BoutonCloture cloture={cloture} onCloturer={onCloturer} />
          <button
            className="btn btn-primary btn-sm"
            onClick={onTelecharger}
            disabled={blocage !== null}
            title={blocage ? `Lecture partielle d'une des collections de la déclaration (${blocage}) — le formulaire ne peut pas dire qu'il est amputé.` : undefined}
          >
            {genere ? '↻ Regénérer le formulaire' : '⬇ Remplir le formulaire officiel'}
          </button>
        </div>
      </div>
      {validee && (
        <div style={{ padding: '0 16px 12px' }}>
          <p className="muted" style={{ margin: 0 }}>
            2035 validée le {formatDate(validee.le)} : elle est relue telle qu'elle a été validée, pas recalculée.
          </p>
          {validee.casesDifferentes.length > 0 && (
            <p className="error-text" style={{ margin: '6px 0 0' }}>
              Recalculée aujourd'hui, elle diffère sur {validee.casesDifferentes.length > 1 ? 'les cases' : 'la case'}
              {' '}{validee.casesDifferentes.join(', ')} : une catégorie a changé de poste depuis, ou le calcul de
              l'application a évolué. C'est la 2035 validée qui fait foi.
            </p>
          )}
        </div>
      )}
      <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th style={{ width: 60 }}>Case</th>
            <th style={{ width: 80 }}>Ligne</th>
            <th>Libellé du formulaire</th>
            <th style={{ textAlign: 'right' }}>Montant</th>
          </tr>
        </thead>
        <tbody>
          {visibles.map((c) => (
            <tr key={c.code} style={c.calculee ? { fontWeight: 600 } : undefined}>
              <td style={{ fontFamily: 'monospace' }}>{c.code}</td>
              <td className="muted">{c.ligne}</td>
              <td>
                {c.libelle}
                <span className="muted" style={{ marginLeft: 8, fontSize: '0.85em' }}>
                  {c.formulaire}{c.calculee ? ` — ${c.calculee}` : ''}
                </span>
              </td>
              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {formatMoney(valeurs.get(c.code) ?? 0)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      {annee >= PREMIER_EXERCICE_REVENU_BRUT_SOCIAL && <ReportDeclarationRevenus annee={annee} valeurs={valeurs} formulaire={formulaire} />}
      {annee >= PREMIER_EXERCICE_REVENU_BRUT_SOCIAL && (
        <VoletSocialCard dossierId={dossierId} annee={annee} valeurs={valeurs} blocage={blocage} />
      )}
    </div>
  )
}

// Où vont les deux résultats de la 2035 sur la déclaration de revenus de l'exploitant. Le cadre 8
// n'a pas d'autre destination que le volet social : c'est de là que l'Urssaf tire l'assiette des
// cotisations et de la CSG-CRDS. L'administration le préremplit depuis la liasse, encore faut-il
// savoir quelle rubrique relire — et qu'aucun abattement ne doit y être retranché, puisque l'Urssaf
// applique le sien (notices 2041-DRI, rubrique « Revenu brut social »).
//
// Les codes des deux déclarants sont donnés ensemble : l'application ne sait pas lequel des deux
// l'exploitant est sur la déclaration du foyer.
//
// LES MONTANTS SONT CEUX DU FORMULAIRE, pas ceux du tableau : à l'euro, totaux recalculés sur les
// cases arrondies. C'est ce que l'administration reprend de la liasse, donc ce que le cabinet
// retrouvera prérempli — et ils peuvent différer d'un euro des montants au centime du tableau
// (120,60 € d'achats s'impriment 121, 5 000,40 € de recettes 5 000, et le bénéfice 4 279,80 €
// devient 4 279). Annoncer l'un pour l'autre ferait chercher un écart qui n'existe pas.
function ReportDeclarationRevenus({ annee, valeurs, formulaire: fige }: {
  annee: number
  valeurs: Map<string, number>
  // Les cases à l'euro d'une 2035 validée : le report dit ce qui a été validé, pas un nouvel arrondi.
  formulaire?: Map<string, number>
}) {
  const formulaire = fige ?? arrondirPourFormulaire(valeurs, annee)
  const montant = (code: string) => `${formaterMontant(formulaire.get(code) ?? 0)} €`
  const deficit = formulaire.get('CR') ?? 0
  const brutNegatif = formulaire.get('DC') ?? 0
  return (
    <div style={{ padding: '12px 16px 14px', borderTop: '1px solid var(--color-border)', fontSize: '0.9rem' }}>
      <strong>Report sur la déclaration des revenus {annee}</strong>
      <span className="muted" style={{ marginLeft: 8 }}>montants à l'euro, tels que le formulaire les porte</span>
      <ul style={{ margin: '8px 0', paddingLeft: 20 }}>
        <li>
          {deficit > 0
            ? <>Déficit de {montant('CR')} : case 5QE de la déclaration 2042-C-PRO (5RE pour le second déclarant).</>
            : <>Bénéfice de {montant('CP')} : case 5QC de la déclaration 2042-C-PRO (5RC pour le second déclarant).</>}
        </li>
        <li>
          {brutNegatif > 0
            ? <>Revenu brut social négatif de {montant('DC')} (case DC) : rubrique DSDG du volet social (DSDH pour le second déclarant).</>
            : <>Revenu brut social de {montant('DD')} (case DD) : rubrique DSDE du volet social (DSDF pour le second déclarant).</>}
          {' '}Prérempli quand l'exploitant n'a déposé que cette 2035. Avec plusieurs liasses, on cumule
          leurs revenus bruts sociaux. L'Urssaf applique elle-même l'abattement de 26 % : ne pas le
          retrancher.
        </li>
      </ul>
      <p className="muted" style={{ margin: 0, fontSize: '0.9em' }}>
        Revenu brut social calculé comme le résultat, plus les charges sociales personnelles (BK) et
        la CSG déductible (BV). L'application ne connaît pas le reste du renvoi (26) de la notice :
        les exonérations de la ligne 43 (zones franches, zones déficitaires en offre de soins,
        déductions des médecins de secteur I…), les sommes à réintégrer (DE : plus-values à court terme
        exonérées, intéressement de l'exploitant, bénéfices non professionnels) et à déduire (DB :
        indemnités journalières comptées dans les recettes, déficits non professionnels). Si le
        dossier en porte, le revenu brut social est à reprendre.
      </p>
    </div>
  )
}
