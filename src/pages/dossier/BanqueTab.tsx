import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { detectColumnMapping, libelleDeLigne, parseCsv, parseDateBancaire, parseMontantBancaire } from '../../lib/csv'
import { extractPdfLignes } from '../../lib/pdfText'
import { parseLignesFromPdf, type FormatMontant, type LigneExtraite, type LignePdf } from '../../lib/relevePdf'
import { anneeDe, formatDate, formatMoney, jourDe, moisDe } from '../../lib/format'
import { rendreAuxDatesDeFacture, retirerContrepartieBanque, synchroniserContrepartieBanque } from '../../lib/contrepartieBanque'
import type { ModeleComptable } from '../../lib/engagement'
import type {
  Categorie, ControleReleveBancaire, CotisationDeclaree, DocumentDivers, LigneBancaire, Piece, RegleAffectationBancaire, RegleBancaireIgnoree,
  ReglementGroupe, StatutLigneBancaire, VentilationBancaire,
} from '../../lib/types'
import { paiementsDesPieces, piecesPayees } from '../../lib/rattachement'
import { nomDeLaPiece, piecesPayeesEnTrop, refusReglementGroupe, type PartReglement } from '../../lib/reglementGroupe'
import { useAnnee } from '../../context/AnneeContext'
import { useExercicesValides } from '../../context/ExercicesValidesContext'
import { dateFigee, estFigee } from '../../lib/validationExercice'
import BarreRecherche from '../../components/BarreRecherche'
import { correspondALaRecherche } from '../../lib/recherche'
import { controlerSolde, lignesDeSolde } from '../../lib/soldeReleve'
import { chargerRelevesIncoherents, enregistrerControleReleve } from '../../lib/controlesReleves'
import {
  analyserAppariements, candidatsCotisations, candidatsPieces, JOURS_TOLERANCE_RAPPROCHEMENT,
  libelleExploitable, piecesMontantIntrouvableEnBanque, planRapprochementAutomatique,
} from '../../lib/appariementBanque'
import { mouvementRapprocheSansObjet, pastillesDePaiement, piecesPayeesEnPartie, piecesPayeesPar } from '../../lib/controles'
import { ecritureDuMouvement, mouvementsAffectes, recettesAffecteesSansTaux, refusAffectation } from '../../lib/affectationBanque'
import { compteDuDirigeant, ecritureDuVirementPersonnel, refusVirementPersonnel } from '../../lib/virementPersonnel'
import {
  echeancesOccupees, ecritureDeLEcheance, empruntPlausible, raisonEmpruntPlausible, refusDecoupage, refusEcheanceEmprunt,
  type DecoupageEcheance,
} from '../../lib/echeanceEmprunt'
import type { Emprunt } from '../../lib/emprunts'
import {
  envoisDuLot, justificatifPossible, normaliserPourRegle, planAffectationParRegles, refusMotif, sensDuMouvement, totauxParCategorie,
} from '../../lib/reglesAffectation'
import { reglerPieceSurBanque } from '../../lib/reglementBanque'
import { lirePiecesFigees, type LecturePiecesFigees } from '../../lib/piecesFigeesLecture'
import { ecritureDeLaVentilation, partsDesVentilations, recettesVentileesSansTaux, refusVentilation, type PartSaisie } from '../../lib/ventilationBanque'
import { libelleTaux } from '../../lib/tvaDuReleve'
import { ecritureDeLaCotisation, rapprochementsCotisationRefuses, refusRapprochementCotisation } from '../../lib/cotisationRapprochee'
import { lireTout } from '../../lib/lectureComplete'
import { statutPourLibelle } from '../../lib/reglesIgnorees'
import BandeauLecturePartielle from '../../components/BandeauLecturePartielle'
import PanneauDroit from '../../components/PanneauDroit'
import ConnexionBancaireCard from './ConnexionBancaireCard'
import { usePanneauDroit } from '../../lib/panneauDroit'
import FicheMouvement from './FicheMouvement'
import { messageErreur } from '../../lib/messageErreur'

const NOMS_MOIS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre']

// Signature (date, libellé, montant) d'un mouvement bancaire — sert à repérer un doublon d'import
// (le même relevé déposé deux fois, CSV ou PDF) avant l'insertion. Le montant est arrondi à 2
// décimales pour éviter qu'un écart d'arrondi flottant sans intérêt (12.1 vs 12.10) fasse manquer un
// vrai doublon.
// Ce qu'un import dit des lignes qu'un exercice validé a écartées : un relevé qui en porte, c'est un exercice validé
// auquel il manque des mouvements — rien ne peut plus les y ajouter, et une opération oubliée se corrige sur
// l'exercice suivant. `toutes` : aucune autre ligne n'était à importer ; `doublons` : celles déjà au relevé.
function phraseLignesFigees(nb: number, frontiere: string, toutes: boolean, doublons = 0): string {
  const sujet = nb > 1 ? `${nb} lignes datées` : toutes ? 'une ligne datée' : 'Une ligne datée'
  const autres = !toutes || doublons === 0 ? '' : doublons === 1 ? ' L’autre est déjà au relevé.' : ` Les ${doublons} autres sont déjà au relevé.`
  return `${toutes ? 'Rien à importer : ' : ''}${sujet} d’un exercice validé, au plus tard le ${formatDate(frontiere)}, `
    + `${nb > 1 ? 'ne s’importent' : 'ne s’importe'} pas — un exercice validé ne reçoit plus de mouvement. Le relevé de cet `
    + `exercice ne ${nb > 1 ? 'les' : 'la'} porte pas : une opération oubliée se corrige sur l’exercice suivant.${autres}`
}

function signatureLigne(l: { date: string; libelle: string; montant: number }): string {
  return `${l.date}|${l.libelle}|${l.montant.toFixed(2)}`
}

const AUCUNE_PIECE_FIGEE: LecturePiecesFigees = { figees: new Map(), avecEcritureValidee: new Set(), motif: null }
const REMBOURSEMENT_D_UNE_NOTE_FIGEE = 'Une note de frais du même montant, d’un exercice validé, est peut-être remboursée par ce '
  + 'mouvement : à classer en virement personnel, pas à affecter — la dépense compterait deux fois.'

// `modele` : le modèle comptable du dossier (lib/engagement.ts). En trésorerie, un rapprochement
// écrit la contrepartie banque de la pièce ; en engagement, le RÈGLEMENT de la facture — le compte de
// tiers contre la banque —, et l'annuler retire ce règlement-là et lui seul.
// `assujettiTva` : une recette sans facture ne s'affecte pas sur un dossier assujetti, sa TVA ne se
// lisant pas sur un relevé (lib/affectationBanque.ts).
export default function BanqueTab({ dossierId, modele, assujettiTva }: {
  dossierId: string; modele: ModeleComptable; assujettiTva: boolean
}) {
  const [lignes, setLignes] = useState<LigneBancaire[]>([])
  // Ce que le rapprochement écrit au brouillon, nommé comme le modèle le nomme dans les messages.
  const ecritureDeBanque = modele.mode === 'engagement' ? "l'écriture de règlement" : "l'écriture de contrepartie banque"
  // Non nul quand le relevé n'a pas pu être lu en entier — voir lib/lectureComplete.ts.
  const [lignesIncompletes, setLignesIncompletes] = useState<string | null>(null)
  // Les PIÈCES sont l'autre moitié du rapprochement, et leur lecture était restée en `select('*')`
  // nu quand celle des mouvements est passée par `lireTout` — la copie oubliée du portage.
  const [piecesIncompletes, setPiecesIncompletes] = useState<string | null>(null)
  // À part des deux autres : une cotisation ou une règle manquante ne rend pas le relevé
  // partiel, elle laisse un mouvement à traiter que quelque chose couvrait déjà.
  const [referencesIncompletes, setReferencesIncompletes] = useState<string | null>(null)
  const [pieces, setPieces] = useState<Piece[]>([])
  const [cotisations, setCotisations] = useState<CotisationDeclaree[]>([])
  // Les catégories, pour affecter un mouvement sans justificatif (ligne 26.6). Leur drapeau est à part :
  // lues en partie, elles n'effacent aucun mouvement — elles en laissent un sans le nom de sa catégorie,
  // et manquent à la liste de choix.
  const [categories, setCategories] = useState<Categorie[]>([])
  const [categoriesIncompletes, setCategoriesIncompletes] = useState<string | null>(null)
  const [regles, setRegles] = useState<RegleBancaireIgnoree[]>([])
  // Les règles d'affectation apprises par libellé (lib/reglesAffectation.ts). Leur drapeau est à part :
  // tronquée, la liste ne cache aucun mouvement, mais une règle plus précise qu'on n'a pas lue aurait pu
  // changer la catégorie proposée — le lot est alors suspendu.
  const [reglesAffectation, setReglesAffectation] = useState<RegleAffectationBancaire[]>([])
  const [reglesAffectationIncompletes, setReglesAffectationIncompletes] = useState<string | null>(null)
  // Les emprunts du dossier (lib/echeanceEmprunt.ts) : de quoi rapprocher une échéance ou un déblocage.
  // Leur drapeau est à part : lus en partie, ils ne changent aucun mouvement — un emprunt manque au choix
  // de la fiche, et un paiement qui ressemble à l'une de ses échéances n'est plus reconnu comme tel, donc
  // pourrait entrer dans le lot des règles d'affectation, qui est alors suspendu.
  const [emprunts, setEmprunts] = useState<Emprunt[]>([])
  const [empruntsIncomplets, setEmpruntsIncomplets] = useState<string | null>(null)
  // Les parts des mouvements ventilés sur plusieurs comptes (lib/ventilationBanque.ts). Leur drapeau est à
  // part : lues en partie, elles ne changent aucun mouvement — un mouvement ventilé s'affiche sans toutes
  // ses parts, et les modifier est suspendu, puisque la modification repartirait des seules parts lues.
  const [ventilations, setVentilations] = useState<VentilationBancaire[]>([])
  const [ventilationsIncompletes, setVentilationsIncompletes] = useState<string | null>(null)
  // Les parts des virements qui règlent plusieurs pièces (lib/reglementGroupe.ts, ligne 26). Chacune est un
  // PAIEMENT de sa pièce : lues en partie, elles laissent une pièce payée paraître sans paiement — donc de
  // nouveau candidate au rapprochement, jusque dans les lots —, et le mouvement sans toutes ses pièces. Le
  // règlement groupé et les lots qui rapprochent des pièces sont alors suspendus.
  const [reglements, setReglements] = useState<ReglementGroupe[]>([])
  // LES PIÈCES QU'UN EXERCICE VALIDÉ A FIGÉES (lib/piecesFigeesLecture.ts). Aucune ne se règle plus sur le montant de
  // la banque — la base refuserait d'en changer les montants (`garder_piece_validee`) —, et en trésorerie celles qui
  // portent elles-mêmes une écriture validée ne se rapprochent plus (voir `piecesHorsRapprochement`). Leur drapeau est à
  // part : lues en partie, elles laissent une pièce figée paraître à rapprocher.
  const [piecesFigees, setPiecesFigees] = useState<LecturePiecesFigees>(AUCUNE_PIECE_FIGEE)
  const [reglementsIncomplets, setReglementsIncomplets] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'toutes' | StatutLigneBancaire>('non_rapprochee')
  // Exercice partagé avec Pièces/Écritures/Statistiques/Clôture, sélectionné dans l'en-tête du
  // dossier (voir AnneeContext) — pas de sélecteur local ici.
  const { annee: anneeFilter } = useAnnee()
  // CE QU'UN EXERCICE VALIDÉ A FIGÉ (lib/validationExercice.ts) : un mouvement daté au plus tard à la frontière ne
  // s'importe, ne se rapproche, ne se classe et ne se modifie plus — la base le refuse (`garder_mouvement_valide`).
  // Les imports l'écartent et le comptent, la fiche ne propose plus rien, et les points qui réclameraient un geste
  // impossible se taisent.
  const { frontiere, anneesValidees } = useExercicesValides()
  // 'tous' ou un mois 0-11 — remis à 'tous' à chaque changement d'année pour ne jamais rester bloqué
  // sur un mois qui n'existe plus dans la nouvelle année sélectionnée.
  const [moisFilter, setMoisFilter] = useState<'tous' | number>('tous')
  useEffect(() => { setMoisFilter('tous') }, [anneeFilter])
  const [recherche, setRecherche] = useState('')
  const [rapprochementAuto, setRapprochementAuto] = useState(false)
  // Le mouvement ouvert dans le panneau de droite (voir FicheMouvement) — le tableau lui-même reste
  // compact (date/libellé/montant/statut) : sur un dossier de plusieurs centaines de mouvements, les
  // boutons et menus de rapprochement répétés sur chaque ligne rendaient l'écran interminable (voir
  // audit ergonomie). Retenu par son IDENTIFIANT, jamais par une copie de la ligne : le panneau relit
  // le mouvement dans `lignes` à chaque rendu, donc montre son état APRÈS une action (« Rapproché
  // avec… ») au lieu de celui du clic. `rang` est sa place dans la liste affichée à l'ouverture — il
  // la quitte souvent (rapproché sous le filtre « Non rapprochés »), et « Suivant » mène alors au
  // mouvement qui l'a prise.
  const panneauMouvement = usePanneauDroit('mouvement')
  const [mouvementOuvert, setMouvementOuvert] = useState<{ id: string; rang: number } | null>(null)
  // Relevés dont l'arithmétique ne tombe pas juste. Affichés en permanence, pas seulement à l'import :
  // c'est toute la raison d'être de leur conservation en base (voir lib/controlesReleves.ts).
  const [relevesIncoherents, setRelevesIncoherents] = useState<ControleReleveBancaire[]>([])

  async function load() {
    setLoading(true)
    // Lue par tranches, triée sur un ordre TOTAL (`date` n'est pas unique) : PostgREST plafonne le
    // nombre de lignes rendues sans le signaler, et c'est la plus grosse table du projet — le total
    // non rapproché, le contrôle de solde et tout le rapprochement porteraient alors sur une partie
    // du relevé (voir lib/lectureComplete.ts).
    const lecture = await lireTout<LigneBancaire>((debut, fin) =>
      supabase.from('lignes_bancaires').select('*', { count: 'exact' })
        .eq('dossier_id', dossierId)
        .order('date', { ascending: false }).order('id').range(debut, fin),
    )
    const lignesData = lecture.lignes
    setLignesIncompletes(lecture.complete ? null : lecture.motif)

    // Les pièces encore à valider sont chargées elles aussi : c'est justement sur elles que porte
    // l'appariement certain (voir lib/appariementBanque.ts), qui sert à les valider plutôt qu'à
    // attendre qu'elles le soient. Les propositions ligne à ligne existantes restent, elles,
    // limitées aux pièces déjà validées — voir `piecesValidees`.
    // Lue par tranches, triée sur un ordre TOTAL (voir lib/lectureComplete.ts). Tronquée, cette
    // liste ne rend pas « moins de pièces » : elle retire des CANDIDATS au rapprochement, donc des
    // mouvements restent sans pièce en face alors que la pièce existe — et l'écran ne dit rien,
    // parce qu'un mouvement non rapproché est exactement ce qu'il affiche quand tout va bien.
    const lecturePieces = await lireTout<Piece>((debut, fin) =>
      supabase.from('pieces').select('*', { count: 'exact' })
        .eq('dossier_id', dossierId).in('statut', ['a_valider', 'validee'])
        .order('id').range(debut, fin),
    )
    const piecesData = lecturePieces.lignes
    setPiecesIncompletes(lecturePieces.complete ? null : lecturePieces.motif)

    const lectureCotisations = await lireTout<CotisationDeclaree>((debut, fin) =>
      supabase.from('cotisations_declarees').select('*', { count: 'exact' })
        .eq('dossier_id', dossierId).order('id').range(debut, fin),
    )

    // Une règle par motif ajouté à la main : la liste ne se vide jamais et grandit à chaque
    // import. Tri TOTAL — `motif` est saisi, donc pas unique.
    const lectureRegles = await lireTout<RegleBancaireIgnoree>((debut, fin) =>
      supabase.from('regles_bancaires_ignorees').select('*', { count: 'exact' })
        .eq('dossier_id', dossierId).order('motif').order('id').range(debut, fin),
    )
    // Troisième drapeau, et sa conséquence n'est celle d'aucun des deux autres. Les cotisations sont
    // des CANDIDATES au rapprochement automatique et alimentent le compte « sans mouvement » ; les
    // règles, elles, décident du `statut` ÉCRIT EN BASE à l'import d'un relevé
    // (`statutPourLibelle`). Une liste de règles tronquée n'affiche donc pas seulement de travers :
    // elle importe des mouvements « à traiter » qu'une règle couvre, et aucun rechargement ne le
    // répare ensuite.
    setReferencesIncompletes(
      [lectureCotisations, lectureRegles].find((l) => !l.complete)?.motif ?? null,
    )

    // Les catégories du dossier et celles de tout le cabinet (`dossier_id` nul) : un `eq` seul écarterait
    // les secondes, qui sont justement celles par défaut.
    const lectureCategories = await lireTout<Categorie>((debut, fin) =>
      supabase.from('categories').select('*', { count: 'exact' })
        .or(`dossier_id.eq.${dossierId},dossier_id.is.null`).order('ordre').order('id').range(debut, fin),
    )
    setCategoriesIncompletes(lectureCategories.complete ? null : lectureCategories.motif)

    // Une règle par motif et par sens : la liste grandit à chaque règle retenue. Tri TOTAL.
    const lectureReglesAffectation = await lireTout<RegleAffectationBancaire>((debut, fin) =>
      supabase.from('regles_affectation_bancaire').select('*', { count: 'exact' })
        .eq('dossier_id', dossierId).order('motif').order('sens').order('id').range(debut, fin),
    )
    setReglesAffectationIncompletes(lectureReglesAffectation.complete ? null : lectureReglesAffectation.motif)

    // Un emprunt par ligne de la carte Financement. Tri TOTAL : deux emprunts peuvent commencer le même jour.
    const lectureEmprunts = await lireTout<Emprunt>((debut, fin) =>
      supabase.from('emprunts').select('*', { count: 'exact' })
        .eq('dossier_id', dossierId).order('date_debut').order('id').range(debut, fin),
    )
    setEmpruntsIncomplets(lectureEmprunts.complete ? null : lectureEmprunts.motif)

    // Deux parts ou plus par mouvement ventilé. Tri TOTAL sur l'identifiant.
    const lectureVentilations = await lireTout<VentilationBancaire>((debut, fin) =>
      supabase.from('ventilations_bancaires').select('*', { count: 'exact' })
        .eq('dossier_id', dossierId).order('id').range(debut, fin),
    )
    setVentilationsIncompletes(lectureVentilations.complete ? null : lectureVentilations.motif)

    // Deux parts ou plus par virement qui règle plusieurs pièces. Tri TOTAL sur l'identifiant.
    const lectureReglements = await lireTout<ReglementGroupe>((debut, fin) =>
      supabase.from('reglements_groupes').select('*', { count: 'exact' })
        .eq('dossier_id', dossierId).order('id').range(debut, fin),
    )
    setReglementsIncomplets(lectureReglements.complete ? null : lectureReglements.motif)

    const lectureFigees = await lirePiecesFigees(dossierId)

    // Best-effort : un contrôle illisible ne doit pas empêcher l'écran de s'afficher, mais l'échec
    // est journalisé plutôt qu'avalé — une liste vide se lirait sinon « aucun écart ».
    const controles = await chargerRelevesIncoherents(dossierId).catch((err) => {
      console.error(err)
      return [] as ControleReleveBancaire[]
    })

    setLignes(lignesData)
    setPieces(piecesData ?? [])
    setCotisations(lectureCotisations.lignes)
    setCategories(lectureCategories.lignes)
    setRegles(lectureRegles.lignes)
    setReglesAffectation(lectureReglesAffectation.lignes)
    setEmprunts(lectureEmprunts.lignes)
    setVentilations(lectureVentilations.lignes)
    setReglements(lectureReglements.lignes)
    setPiecesFigees(lectureFigees)
    setRelevesIncoherents(controles)
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [dossierId])

  // Les propositions ligne à ligne et le bouton « tout rapprocher » historiques ne portent que sur
  // des pièces déjà relues par le cabinet : rapprocher sur de l'OCR non validé reviendrait à écrire
  // une écriture comptable sur un montant que personne n'a confirmé.
  const piecesValidees = useMemo(() => pieces.filter((p) => p.statut === 'validee'), [pieces])
  // Les paiements de chaque pièce : les mouvements rapprochés d'elle, et les parts des virements qui en
  // règlent plusieurs (lib/rattachement.ts). Une pièce payée, en tout ou en partie, n'est plus candidate :
  // une pièce réglée par la part d'un virement groupé se laisserait sinon rapprocher d'un second mouvement.
  const paiements = useMemo(() => paiementsDesPieces(lignes, reglements), [lignes, reglements])
  const piecesRapprochees = useMemo(() => piecesPayees(paiements), [paiements])
  const piecesSansMouvement = piecesValidees.filter((p) => !piecesRapprochees.has(p.id))
  // EN TRÉSORERIE, UNE PIÈCE QUI PORTE ELLE-MÊME UNE ÉCRITURE VALIDÉE NE SE RAPPROCHE PLUS. Son écriture s'équilibre déjà
  // sans paiement — une note de frais, face au compte de l'exploitant —, et la rapprocher la redaterait au paiement, ce
  // que la base refuse, pendant que la 2035 de l'exercice suivant la compterait une seconde fois. Le remboursement d'une
  // telle note est un virement personnel. EN ENGAGEMENT, une facture validée se règle normalement : son règlement
  // s'écrit à la date du mouvement, sans toucher à la facture. Une pièce figée seulement par le bien qu'elle justifie
  // reste proposée : son paiement, quand il vient après, s'écrit après la frontière.
  const piecesFigeesHorsRapprochement = useMemo(
    () => (modele.mode === 'tresorerie' ? piecesFigees.avecEcritureValidee : new Set<string>()),
    [modele.mode, piecesFigees],
  )
  const piecesHorsRapprochement = useMemo(
    () => (piecesFigeesHorsRapprochement.size === 0
      ? piecesRapprochees
      : new Set([...piecesRapprochees, ...piecesFigeesHorsRapprochement])),
    [piecesRapprochees, piecesFigeesHorsRapprochement],
  )
  // Sous-ensemble plus grave que la simple absence de rapprochement : un montant qui n'apparaît nulle
  // part dans le relevé, à AUCUNE date, signale soit un relevé incomplet soit un montant faux — voir
  // lib/appariementBanque.ts. Calculé sur TOUTES les lignes importées, pas seulement les non
  // rapprochées : le contrôle porte sur l'existence du montant dans le fichier, pas sur sa disponibilité.
  const piecesMontantSuspect = useMemo(
    () => piecesMontantIntrouvableEnBanque(piecesSansMouvement, lignes),
    [piecesSansMouvement, lignes],
  )
  const cotisationsRapprochees = useMemo(
    () => new Set(lignes.map((l) => l.cotisation_id).filter((id): id is string => id != null)),
    [lignes],
  )
  const cotisationsSansMouvement = cotisations.filter((c) => !cotisationsRapprochees.has(c.id))


  // Mois proposés dans le filtre : seulement ceux qui existent réellement dans l'année déjà
  // sélectionnée (et le statut déjà filtré) — jamais les 12 mois de l'année par défaut, dont la
  // plupart seraient vides sur un dossier récent.
  const lignesAnneeEtStatut = lignes.filter((l) => {
    if (filter !== 'toutes' && l.statut !== filter) return false
    if (anneeFilter !== 'toutes' && anneeDe(l.date) !== anneeFilter) return false
    return true
  })
  const moisDisponibles = [...new Set(lignesAnneeEtStatut.map((l) => (moisDe(l.date) - 1)))].sort((a, b) => a - b)

  // Le compteur de la barre de recherche compare ce qui est comparable : `avantRecherche` porte déjà
  // les filtres Statut/Année/Mois, la recherche ne fait que réduire cet ensemble-là.
  const avantRecherche = lignesAnneeEtStatut.filter(
    (l) => moisFilter === 'tous' || (moisDe(l.date) - 1) === moisFilter,
  )
  const filtered = avantRecherche.filter((l) =>
    correspondALaRecherche([l.libelle, l.montant, l.date, formatDate(l.date)], recherche),
  )

  // Le critère vit dans lib/appariementBanque.ts, testé, et non plus recopié ici : c'est le même que
  // celui du bouton « Tout rapprocher », qui doit rester le même par construction et pas par
  // vigilance. Ici on garde la première candidate — le panneau montre de toute façon TOUTES les
  // pièces triées par score, et propose de voir le justificatif avant de confirmer.
  function suggestion(ligne: LigneBancaire): Piece | null {
    if (ligne.statut !== 'non_rapprochee') return null
    return candidatsPieces(ligne, piecesValidees, piecesHorsRapprochement)[0] ?? null
  }

  function suggestionCotisation(ligne: LigneBancaire): CotisationDeclaree | null {
    if (ligne.statut !== 'non_rapprochee') return null
    return candidatsCotisations(ligne, cotisations, cotisationsRapprochees)[0] ?? null
  }

  // Un prélèvement récurrent (assurance, virement personnel...) sans règle "Toujours ignorer" — soit
  // parce que le libellé varie légèrement d'un mois à l'autre (une date ou un numéro dedans), soit
  // simplement parce que personne n'a pensé à créer la règle — se retraite à la main chaque mois sans
  // que l'appli s'en souvienne. Repère ici un mouvement au même montant et à peu près au même jour du
  // mois qu'un ou plusieurs mois précédents déjà résolus de façon cohérente (tous ignorés, ou tous
  // marqués virement personnel) et propose d'appliquer la même résolution — jamais si les résolutions
  // passées divergent, ni sur une seule occurrence antérieure (trop tôt pour parler de récurrence).
  function suggestionRecurrente(ligne: LigneBancaire): { action: 'ignorer' | 'virement_personnel'; occurrences: number } | null {
    if (ligne.statut !== 'non_rapprochee') return null
    const jourLigne = jourDe(ligne.date)
    const moisLigne = anneeDe(ligne.date) * 12 + (moisDe(ligne.date) - 1)

    const correspondances = lignes.filter((l) => {
      if (l.id === ligne.id) return false
      if (Math.abs(l.montant - ligne.montant) > 0.01) return false
      const moisL = anneeDe(l.date) * 12 + (moisDe(l.date) - 1)
      if (moisL === moisLigne) return false
      if (Math.abs(jourDe(l.date) - jourLigne) > 3) return false
      return l.prelevement_personnel || l.statut === 'ignoree'
    })
    if (correspondances.length < 2) return null

    if (correspondances.every((l) => l.prelevement_personnel)) {
      return { action: 'virement_personnel', occurrences: correspondances.length }
    }
    if (correspondances.every((l) => l.statut === 'ignoree' && !l.prelevement_personnel)) {
      return { action: 'ignorer', occurrences: correspondances.length }
    }
    return null
  }

  // UN SEUL verrou pour toutes les écritures de rapprochement de l'écran : le lot « sans doute
  // possible », « Tout rapprocher automatiquement » et les actions du panneau d'un mouvement. Tant que
  // le rapprochement vivait dans une fenêtre qui recouvrait l'écran, on ne pouvait pas lancer un lot
  // en arbitrant une ligne. Le panneau de droite laisse la liste cliquable à côté — c'est tout son
  // intérêt — donc les deux peuvent désormais se croiser sur le même mouvement, et deux écritures qui
  // se croisent laissent une contrepartie banque pour une pièce que le mouvement ne désigne plus.
  //
  // Un `useRef` posé avant tout `await` (un état React ne prend effet qu'au rendu suivant, deux clics
  // du même rendu passeraient), relâché dans un `finally` — et APRÈS la relecture du relevé : relâché
  // avant, le panneau montrerait encore « Associer cette pièce » sur un mouvement déjà rapproché le
  // temps que la relecture revienne, et un second clic referait le rapprochement.
  const ecritureEnCours = useRef(false)
  const [actionMouvementEnCours, setActionMouvementEnCours] = useState(false)

  // `ecrire` rend `true` quand il a écrit quelque chose — c'est alors seulement qu'on relit le relevé.
  // Une exception est dite, et suivie d'une relecture : une écriture interrompue a pu aller à mi-chemin,
  // et le panneau ne doit pas rester sur un état qu'on ne connaît plus. Elle ne remonte pas au-delà :
  // un gestionnaire de clic d'où s'échappe une exception n'affiche rien (voir CLAUDE.md, les deux
  // modales d'import qui avalaient celle de `chargerHashsExistants`).
  async function sousVerrou(marquer: (enCours: boolean) => void, ecrire: () => Promise<boolean>) {
    if (ecritureEnCours.current) return
    ecritureEnCours.current = true
    marquer(true)
    try {
      if (await ecrire()) await load()
    } catch (err) {
      window.alert(`L'opération n'a pas pu aller à son terme : ${messageErreur(err, 'raison inconnue')}`)
      await load()
    } finally {
      ecritureEnCours.current = false
      marquer(false)
    }
  }

  function agirSurMouvement(ecrire: () => Promise<boolean>) {
    return sousVerrou(setActionMouvementEnCours, ecrire)
  }

  // Une pièce figée par un exercice validé ne se règle plus sur le montant de la banque : la base refuserait d'en changer
  // les montants. Son rapprochement s'écrit quand même, au montant du mouvement. Les quatre chemins de rapprochement y
  // passent, « Valider et rapprocher » compris, qui ne porte pourtant que des pièces à valider — qu'aucune validation ne
  // fige : la règle ne doit pas dépendre de ce que chaque lot sélectionne.
  //
  // Et elle se règle sur le TOTAL que la banque aura payé pour elle une fois ce paiement posé : ses autres paiements — un
  // mouvement déjà rapproché d'elle, la part d'un virement groupé — et celui-ci (lib/reglementBanque.ts). Un paiement
  // seul n'en est qu'une fraction.
  function reglerSiLibre(piece: Piece, ligneId: string, montant: number): Promise<Piece> {
    if (piecesFigees.figees.has(piece.id)) return Promise.resolve(piece)
    const autres = (paiements.get(piece.id) ?? []).filter((paiement) => paiement.id !== ligneId)
    return reglerPieceSurBanque(piece, [...autres, { montant }])
  }

  // Correctif audit sécurité (rapprochements, Importante) : le résultat de la mise à jour de
  // lignes_bancaires était ignoré — en cas d'échec (RLS, réseau...), le code créait quand même la
  // contrepartie banque comme si le rapprochement avait réussi, laissant une écriture de contrepartie
  // pour un mouvement qui, en base, n'est pas réellement marqué rapproché. On vérifie maintenant
  // l'erreur avant d'enchaîner sur l'opération dépendante, et on la signale plutôt que de la taire.
  //
  // Le lien vers une échéance de cotisation n'est PAS remis à zéro ici : rapprochée d'une échéance, une
  // ligne porte une écriture que seule la base retire (`retirer_rapprochement_cotisation`). Si un autre
  // onglet l'a rapprochée entre-temps, la contrainte `lignes_bancaires_un_seul_rapprochement` refuse
  // cette mise à jour, au lieu d'en défaire le lien en silence et de laisser son écriture derrière.
  async function rapprocher(ligneId: string, pieceId: string): Promise<boolean> {
    const { error } = await supabase.from('lignes_bancaires').update({ statut: 'rapprochee', piece_id: pieceId }).eq('id', ligneId)
    if (error) { window.alert(`Le rapprochement n'a pas pu être enregistré : ${error.message}`); return false }
    const ligne = lignes.find((l) => l.id === ligneId)
    const pieceAvant = pieces.find((p) => p.id === pieceId)
    // Le règlement AVANT la contrepartie : celle-ci reprend les montants de la pièce, et les
    // écrirait donc avec la valeur provisoire si l'ordre était inversé (voir lib/reglementBanque.ts).
    const piece = ligne && pieceAvant ? await reglerSiLibre(pieceAvant, ligne.id, ligne.montant) : pieceAvant
    // Le rapprochement est enregistré ; seule la contrepartie comptable a pu échouer. On le dit sans
    // annuler ce qui a réussi — la contrepartie se recréera au prochain passage, elle est idempotente.
    if (ligne && piece) {
      try {
        await synchroniserContrepartieBanque(dossierId, piece, ligne, modele)
      } catch (err) {
        window.alert(`Le rapprochement est enregistré, mais ${ecritureDeBanque} n'a pas pu être créée : ${messageErreur(err, 'raison inconnue')}`)
      }
    }
    return true
  }

  // LIGNE 26.6, ÉTAPE (b) : une échéance de cotisation rapprochée S'ÉCRIT. L'écriture est composée ici
  // (lib/cotisationRapprochee.ts, testé) — la cotisation au 646000, sa CSG-CRDS au 108000 en trésorerie,
  // face à la banque — et `rapprocher_cotisation` la VÉRIFIE contre le mouvement, l'échéance et le mode
  // du dossier, puis l'écrit AVEC le rapprochement, dans une transaction. Rejouée sur un mouvement déjà
  // rapproché d'une échéance, elle remplace son rapprochement et son écriture.
  async function rapprocherCotisation(ligneId: string, cotisationId: string): Promise<boolean> {
    const ligne = lignes.find((l) => l.id === ligneId)
    const cotisation = cotisations.find((c) => c.id === cotisationId)
    if (!ligne || !cotisation) return false
    const refus = refusRapprochementCotisation(ligne, cotisation, modele.mode)
    if (refus) { window.alert(refus); return false }
    const { error } = await supabase.rpc('rapprocher_cotisation', {
      p_ligne_bancaire_id: ligne.id,
      p_cotisation_id: cotisation.id,
      p_ecritures: ecritureDeLaCotisation(ligne, cotisation, modele.mode),
    })
    if (error) { window.alert(`Le rapprochement n'a pas pu être enregistré : ${messageErreur(error, 'raison inconnue')}`); return false }
    return true
  }

  // Défait un rapprochement comme un classement (ignoré, virement personnel) : dans les trois cas le
  // mouvement redevient « à traiter », sans rien qui le rattache.
  async function remettreATraiter(ligneId: string): Promise<boolean> {
    const ligne = lignes.find((l) => l.id === ligneId)
    // Un règlement groupé part avec ses parts et ses écritures, par la base : une simple remise à « à
    // traiter », la contrainte `lignes_bancaires_reglement_groupe_rapproche` la refuserait.
    if (ligne?.reglement_groupe) return retirerReglementGroupe(ligneId)
    // Un virement personnel part avec son écriture, par la base (`retirer_virement_personnel`) : une
    // simple remise à « à traiter » la laisserait au brouillon sans plus rien qui la justifie — une
    // rupture de la piste d'audit, et un prélèvement compté dans la trésorerie d'un mouvement à traiter.
    if (ligne?.prelevement_personnel) {
      const { error } = await supabase.rpc('retirer_virement_personnel', { p_ligne_bancaire_id: ligneId })
      if (error) { window.alert(`Le virement personnel n'a pas pu être remis à traiter : ${messageErreur(error, 'raison inconnue')}`); return false }
      return true
    }
    // Une échéance de cotisation part avec son écriture, par la base, pour la même raison.
    if (ligne?.cotisation_id) {
      const { error } = await supabase.rpc('retirer_rapprochement_cotisation', { p_ligne_bancaire_id: ligneId })
      if (error) { window.alert(`Le rapprochement n'a pas pu être annulé : ${messageErreur(error, 'raison inconnue')}`); return false }
      return true
    }
    const ancienPieceId = ligne?.piece_id ?? null
    // Sans `cotisation_id` : un rapprochement d'échéance posé entre-temps ailleurs fait refuser cette mise à
    // jour (`lignes_bancaires_cotisation_rapprochee`), au lieu d'en orpheliner l'écriture.
    const { error } = await supabase.from('lignes_bancaires').update({
      statut: 'non_rapprochee', piece_id: null, prelevement_personnel: false,
    }).eq('id', ligneId)
    if (error) { window.alert(`Le mouvement n'a pas pu être remis à traiter : ${error.message}`); return false }
    // Ici l'échec compte double : l'annulation est enregistrée mais la contrepartie banque reste,
    // donc une écriture de paiement subsiste pour un mouvement qui n'est plus rapproché.
    if (ancienPieceId) {
      try {
        await retirerContrepartieBanque(ligneId, ancienPieceId, pieces.find((p) => p.id === ancienPieceId) ?? null, modele)
      } catch (err) {
        window.alert(`Le rapprochement est annulé, mais ${ecritureDeBanque} n'a pas pu être retirée : ${messageErreur(err, 'raison inconnue')}\n\nElle reste dans le brouillon d'écritures.`)
      }
    }
    return true
  }

  // LIGNE 26.6 : un mouvement sans justificatif affecté à une catégorie. L'écriture est composée ici
  // (lib/affectationBanque.ts, testé) ; `affecter_mouvement_bancaire` la VÉRIFIE contre le mouvement et
  // la catégorie, puis l'écrit AVEC l'affectation, dans une seule transaction — un mouvement affecté
  // sans écriture compterait dans la 2035 et pas dans le FEC. Réaffecter passe par le même appel : la
  // base remplace l'écriture précédente.
  //
  // `motifRegle` : l'affectation se retient aussi en RÈGLE (lib/reglesAffectation.ts), écrite APRÈS
  // l'affectation — une règle sans l'affectation qui l'a fait naître proposerait une catégorie que
  // personne n'a encore choisie. Remplacée si elle existe déjà pour ce motif et ce sens (contrainte
  // totale `regles_affectation_bancaire_unique`, que l'`onConflict` vise).
  //
  // `taux` : celui d'une recette d'un dossier assujetti (lib/tvaDuReleve.ts), choisi dans la fiche ; la
  // base l'exige là et le refuse ailleurs. La règle retenue le garde, pour que le lot le reprenne.
  async function affecter(ligne: LigneBancaire, categorieId: string, motifRegle: string | null, taux: number | null): Promise<boolean> {
    const categorie = categories.find((c) => c.id === categorieId)
    if (!categorie) return false
    const refus = refusAffectation(ligne, categorie, assujettiTva, taux)
    if (refus || !categorie.compte_comptable) {
      window.alert(refus ?? `La catégorie « ${categorie.libelle} » n’a pas de compte.`)
      return false
    }
    const { error } = await supabase.rpc('affecter_mouvement_bancaire', {
      p_ligne_bancaire_id: ligne.id,
      p_categorie_id: categorie.id,
      p_ecritures: ecritureDuMouvement(ligne, categorie.compte_comptable, taux),
      p_taux_tva: taux,
    })
    if (error) { window.alert(`L'affectation n'a pas pu être enregistrée : ${messageErreur(error, 'raison inconnue')}`); return false }
    const sens = sensDuMouvement(ligne)
    if (motifRegle !== null && sens && !refusMotif(motifRegle) && !reglesAffectationIncompletes) {
      const { error: erreurRegle } = await supabase.from('regles_affectation_bancaire').upsert(
        { dossier_id: dossierId, motif: normaliserPourRegle(motifRegle), sens, categorie_id: categorie.id, taux_tva: taux },
        { onConflict: 'dossier_id,motif,sens' },
      )
      if (erreurRegle) {
        window.alert(`Le mouvement est affecté, mais la règle n'a pas pu être enregistrée : ${messageErreur(erreurRegle, 'raison inconnue')}`)
      }
    }
    return true
  }

  // Retirer une règle ne touche à AUCUN mouvement : ceux qu'elle a fait affecter le restent, ceux qui
  // restent à traiter ne sont simplement plus proposés. La confirmation le dit, et l'échec aussi — un
  // geste confirmé qui échoue en silence se reconfirme, et rend le même silence.
  async function retirerRegleAffectation(regle: RegleAffectationBancaire) {
    const categorie = categories.find((c) => c.id === regle.categorie_id)
    const confirme = window.confirm(
      `Retirer la règle « ${regle.motif} » (${regle.sens === 'encaissement' ? 'encaissements' : 'paiements'} → ${categorie?.libelle ?? 'catégorie non lue'}) ?\n\n` +
      'Les mouvements déjà affectés le restent ; ceux qui restent à traiter ne seront plus proposés.',
    )
    if (!confirme) return
    const { error } = await supabase.from('regles_affectation_bancaire').delete().eq('id', regle.id)
    if (error) window.alert(`La règle n'a pas pu être retirée : ${messageErreur(error, 'raison inconnue')}`)
    load()
  }

  // L'affectation et son écriture partent ENSEMBLE, par la base : remettre le mouvement « à traiter »
  // par une simple mise à jour laisserait l'écriture derrière lui — et la contrainte
  // `lignes_bancaires_affectation_rapprochee` la refuserait de toute façon.
  async function retirerAffectation(ligneId: string): Promise<boolean> {
    const { error } = await supabase.rpc('retirer_affectation_mouvement_bancaire', { p_ligne_bancaire_id: ligneId })
    if (error) { window.alert(`L'affectation n'a pas pu être annulée : ${messageErreur(error, 'raison inconnue')}`); return false }
    return true
  }

  // LIGNE 26.6 : une échéance d'emprunt — capital au 164, intérêts au 661, assurance au 616 — ou un
  // déblocage. L'écriture est composée ici (lib/echeanceEmprunt.ts, testé) ; `rapprocher_echeance_emprunt`
  // la VÉRIFIE contre le mouvement et le découpage validé, puis l'écrit AVEC le rapprochement, dans une
  // seule transaction. Rapprocher de nouveau un mouvement déjà rapproché d'un emprunt remplace son
  // découpage et son écriture. Les refus de la base sont refaits ici, pour qu'on ne clique pas pour rien.
  async function rapprocherEmprunt(ligne: LigneBancaire, empruntId: string, d: DecoupageEcheance): Promise<boolean> {
    const emprunt = emprunts.find((e) => e.id === empruntId)
    if (!emprunt) return false
    const refus = refusEcheanceEmprunt(ligne) ?? refusDecoupage(ligne, emprunt, d, echeancesOccupees(lignes, emprunt.id, ligne.id))
    if (refus) { window.alert(refus); return false }
    const { error } = await supabase.rpc('rapprocher_echeance_emprunt', {
      p_ligne_bancaire_id: ligne.id,
      p_emprunt_id: emprunt.id,
      p_echeance: d.echeance,
      p_interets: d.interets,
      p_assurance: d.assurance,
      p_ecritures: ecritureDeLEcheance(ligne, d),
    })
    if (error) { window.alert(`Le rapprochement de l'emprunt n'a pas pu être enregistré : ${messageErreur(error, 'raison inconnue')}`); return false }
    return true
  }

  // Le rapprochement et son écriture partent ENSEMBLE, par la base.
  async function retirerEmprunt(ligneId: string): Promise<boolean> {
    const { error } = await supabase.rpc('retirer_echeance_emprunt', { p_ligne_bancaire_id: ligneId })
    if (error) { window.alert(`Le rapprochement de l'emprunt n'a pas pu être annulé : ${messageErreur(error, 'raison inconnue')}`); return false }
    return true
  }

  // LIGNE 26.6 : un mouvement ventilé sur plusieurs comptes. L'écriture est composée ici
  // (lib/ventilationBanque.ts, testé) ; `ventiler_mouvement_bancaire` la VÉRIFIE contre le mouvement et les
  // parts, puis écrit la ventilation, ses parts et son écriture dans une seule transaction. Ventiler de
  // nouveau un mouvement ventilé remplace ses parts et son écriture. Les refus de la base sont refaits ici.
  async function ventiler(ligne: LigneBancaire, parts: PartSaisie[]): Promise<boolean> {
    const refus = refusVentilation(ligne, parts, categories, assujettiTva)
    const ecriture = refus ? null : ecritureDeLaVentilation(ligne, parts, categories, modele, assujettiTva)
    if (!ecriture) {
      window.alert(refus ?? 'Une part n’a pas de compte de charge ou de produit : la ventilation ne peut pas s’écrire.')
      return false
    }
    const { error } = await supabase.rpc('ventiler_mouvement_bancaire', {
      p_ligne_bancaire_id: ligne.id,
      p_parts: parts.map((part) => ({
        categorie_id: part.categorie_id, part_personnelle: part.part_personnelle, montant: part.montant, taux_tva: part.taux_tva,
      })),
      p_ecritures: ecriture,
    })
    if (error) { window.alert(`La ventilation n'a pas pu être enregistrée : ${messageErreur(error, 'raison inconnue')}`); return false }
    return true
  }

  // La ventilation, ses parts et son écriture partent ENSEMBLE, par la base.
  async function retirerVentilation(ligneId: string): Promise<boolean> {
    const { error } = await supabase.rpc('retirer_ventilation_mouvement_bancaire', { p_ligne_bancaire_id: ligneId })
    if (error) { window.alert(`La ventilation n'a pas pu être annulée : ${messageErreur(error, 'raison inconnue')}`); return false }
    return true
  }

  // LIGNE 26 : un virement qui règle plusieurs pièces. Les parts sont vérifiées ici (lib/reglementGroupe.ts,
  // testé) ; `regler_pieces_par_mouvement` refait les refus de la base, écrit le règlement et ses parts —
  // en remplaçant celles d'un règlement précédent — et retire les écritures du mouvement, dans une seule
  // transaction. Les écritures se refont ENSUITE, pièce par pièce, par le chemin d'un rapprochement simple :
  // la contrepartie banque de chaque part (le règlement du compte de tiers en engagement), à la date du
  // mouvement. Un échec n'y défait pas le règlement, déjà écrit : il est dit, et le contrôle des écritures
  // le signale jusqu'à « Régénérer ».
  //
  // Suspendu sur une lecture partielle des parts : une pièce payée par une part non lue paraîtrait à régler,
  // et le refus d'un second paiement ne la verrait pas.
  async function reglerEnGroupe(ligne: LigneBancaire, parts: PartReglement[]): Promise<boolean> {
    if (reglementsIncomplets) {
      window.alert(`Les parts des règlements groupés n'ont pas pu être lues en entier (${reglementsIncomplets}) : recharge la page avant de régler plusieurs pièces.`)
      return false
    }
    const refus = refusReglementGroupe(ligne, parts, pieces, paiements)
    if (refus) { window.alert(refus); return false }
    const avant = reglements.flatMap((r) => (r.ligne_bancaire_id === ligne.id && r.piece_id ? [r.piece_id] : []))
    const { error } = await supabase.rpc('regler_pieces_par_mouvement', {
      p_ligne_bancaire_id: ligne.id,
      p_parts: parts.map((part) => ({ piece_id: part.piece_id, montant: part.montant })),
    })
    if (error) { window.alert(`Le règlement groupé n'a pas pu être enregistré : ${messageErreur(error, 'raison inconnue')}`); return false }

    const echecs: string[] = []
    // La base vient de retirer les écritures de ce mouvement : les pièces qu'il réglait AVANT retournent
    // d'abord à la date de leur facture quand plus rien ne les date ; chaque part reçoit ensuite sa
    // contrepartie, qui redate sa pièce au mouvement quand elle la règle à elle seule.
    try {
      await rendreAuxDatesDeFacture(pieces.filter((p) => avant.includes(p.id)), modele)
    } catch (err) {
      echecs.push(`retour à la date de facture : ${messageErreur(err, 'raison inconnue')}`)
    }
    for (const part of parts) {
      const pieceAvant = pieces.find((p) => p.id === part.piece_id)
      if (!pieceAvant) continue
      try {
        // Réglée sur le TOTAL que la banque a payé pour elle — cette part, et ses autres paiements : payée aussi
        // ailleurs, la part n'en est qu'une fraction, et l'aligner sur elle seule fausserait la pièce (voir
        // lib/reglementBanque.ts). Une pièce en devise quitte ainsi son cours provisoire.
        const piece = await reglerSiLibre(pieceAvant, ligne.id, part.montant)
        await synchroniserContrepartieBanque(dossierId, piece, { id: ligne.id, date: ligne.date, montant: part.montant }, modele)
      } catch (err) {
        echecs.push(`${nomDeLaPiece(pieceAvant)} : ${messageErreur(err, 'raison inconnue')}`)
      }
    }
    if (echecs.length > 0) {
      window.alert(
        `Le règlement groupé est enregistré, mais des écritures n'ont pas pu suivre :\n${echecs.join('\n')}\n\n`
        + 'Le contrôle des écritures (Écritures) les signale : « Régénérer » les remet en place.',
      )
    }
    return true
  }

  // Le règlement, ses parts et les écritures du mouvement partent ENSEMBLE, par la base
  // (`retirer_reglement_groupe`). Les pièces qu'il réglait retournent ensuite à la date de leur facture quand
  // plus rien ne les date. Suspendu sur une lecture partielle des parts : celles qu'on n'a pas lues n'y
  // retourneraient pas.
  async function retirerReglementGroupe(ligneId: string): Promise<boolean> {
    if (reglementsIncomplets) {
      window.alert(`Les parts des règlements groupés n'ont pas pu être lues en entier (${reglementsIncomplets}) : recharge la page avant d'annuler ce règlement.`)
      return false
    }
    const reglees = reglements.flatMap((r) => (r.ligne_bancaire_id === ligneId && r.piece_id ? [r.piece_id] : []))
    const { error } = await supabase.rpc('retirer_reglement_groupe', { p_ligne_bancaire_id: ligneId })
    if (error) { window.alert(`Le règlement groupé n'a pas pu être annulé : ${messageErreur(error, 'raison inconnue')}`); return false }
    try {
      await rendreAuxDatesDeFacture(pieces.filter((p) => reglees.includes(p.id)), modele)
    } catch (err) {
      window.alert(
        `Le règlement groupé est annulé, mais les écritures de ses pièces n'ont pas pu revenir à la date de leur facture : ${messageErreur(err, 'raison inconnue')}\n\n`
        + 'Le contrôle des écritures (Écritures) les signale : « Régénérer » les remet en place.',
      )
    }
    return true
  }

  // L'erreur est lue, et plus seulement suivie d'une relecture : le panneau reste sur le mouvement
  // après l'action, donc un échec muet laisserait l'opérateur croire le mouvement classé.
  async function ignorer(ligneId: string): Promise<boolean> {
    const { error } = await supabase.from('lignes_bancaires').update({ statut: 'ignoree', piece_id: null }).eq('id', ligneId)
    if (error) { window.alert(`Le mouvement n'a pas pu être ignoré : ${error.message}`); return false }
    return true
  }

  // Virement entre le compte pro et le compte personnel de l'exploitant — un prélèvement, ou un apport.
  // Ni pièce ni échéance à rattacher, ni charge ni recette : il s'ÉCRIT sur le compte du dirigeant face
  // à la banque (lib/virementPersonnel.ts, testé), par `classer_virement_personnel`, qui VÉRIFIE
  // l'écriture contre le mouvement et le compte du dossier puis l'écrit AVEC le classement, dans une
  // seule transaction — classé sans écriture, il manquait au FEC et à la trésorerie. Le mouvement reste
  // « ignoré », avec le drapeau qui le range dans l'onglet Virements.
  async function marquerVirementPersonnel(ligneId: string): Promise<boolean> {
    const ligne = lignes.find((l) => l.id === ligneId)
    if (!ligne) return false
    const refus = refusVirementPersonnel(ligne)
    if (refus) { window.alert(refus); return false }
    const { error } = await supabase.rpc('classer_virement_personnel', {
      p_ligne_bancaire_id: ligne.id,
      p_ecritures: ecritureDuVirementPersonnel(ligne, modele),
    })
    if (error) { window.alert(`Le mouvement n'a pas pu être classé en virement personnel : ${messageErreur(error, 'raison inconnue')}`); return false }
    return true
  }

  // Ignore cette ligne ET mémorise un mot-clé pour que toutes les lignes similaires (déjà importées
  // ou futures) soient automatiquement classées "ignorées" — utile pour les prélèvements récurrents
  // (assurance, cotisations) qui n'ont pas de pièce à fournir à chaque échéance.
  async function toujoursIgnorer(ligne: LigneBancaire): Promise<boolean> {
    const motif = window.prompt(
      'Mot-clé stable qui identifie ce type de mouvement récurrent (ex. "MACSF", "SWISSLIFE") — toute future ligne contenant ce mot sera automatiquement ignorée.',
      ligne.libelle,
    )
    if (!motif || !motif.trim()) return false
    const motifNormalise = motif.trim().toLowerCase()

    const { error } = await supabase.from('regles_bancaires_ignorees').insert({ dossier_id: dossierId, motif: motifNormalise })
    if (error) {
      window.alert(`La règle n'a pas pu être enregistrée : ${error.message}`)
      return false
    }

    const aMettreAJour = lignes.filter((l) => l.statut === 'non_rapprochee' && l.libelle.toLowerCase().includes(motifNormalise))
    if (aMettreAJour.length > 0) {
      const { error: errMaj } = await supabase.from('lignes_bancaires').update({ statut: 'ignoree', piece_id: null }).in('id', aMettreAJour.map((l) => l.id))
      if (errMaj) window.alert(`La règle est enregistrée, mais les mouvements déjà importés n'ont pas pu être ignorés : ${errMaj.message}`)
    }
    return true
  }

  async function retirerRegle(id: string) {
    await supabase.from('regles_bancaires_ignorees').delete().eq('id', id)
    load()
  }

  // Les parts de chaque mouvement ventilé : la pastille de la liste en dit le nombre, la fiche les montre.
  const partsParLigne = useMemo(() => {
    const m = new Map<string, VentilationBancaire[]>()
    for (const v of ventilations) m.set(v.ligne_bancaire_id, [...(m.get(v.ligne_bancaire_id) ?? []), v])
    return m
  }, [ventilations])

  // Les recettes du relevé écrites SANS TAUX sur un dossier assujetti — affectées ou ventilées avant qu'il le
  // devienne : leur TVA n'est dans aucune CA3, et la 2035 compte la taxe en recette. La Checklist les compte et
  // envoie ici ; la pastille « TVA à choisir » les montre dans la liste, la fiche dit quoi faire.
  const idsRecettesSansTaux = useMemo(() => {
    if (!assujettiTva) return new Set<string>()
    return new Set([
      ...recettesAffecteesSansTaux(mouvementsAffectes(lignes, categories, true), true, frontiere).map((m) => m.ligne.id),
      ...recettesVentileesSansTaux(partsDesVentilations(lignes, ventilations, categories, true), true, frontiere).map((l) => l.id),
    ])
  }, [assujettiTva, lignes, categories, ventilations, frontiere])

  // Les mouvements rapprochés d'une échéance de cotisation qui ne PEUVENT pas s'écrire — un encaissement
  // rapproché d'un appel, posé quand l'écran ne regardait pas le sens (lib/cotisationRapprochee.ts). La
  // Checklist les compte et envoie ici ; la pastille « Ne s’écrit pas » les montre, la fiche dit pourquoi. Pas d'un
  // exercice validé : ni le mouvement ni l'échéance n'y changent plus, et la pastille appellerait un geste refusé.
  const idsCotisationsRefusees = useMemo(
    () => new Set(rapprochementsCotisationRefuses(lignes, cotisations, modele.mode, frontiere).map((r) => r.ligne.id)),
    [lignes, cotisations, modele.mode, frontiere],
  )

  // Les parts de chaque virement qui règle plusieurs pièces : la pastille de la liste en dit le nombre, la
  // fiche les montre.
  const reglementsParLigne = useMemo(() => {
    const m = new Map<string, ReglementGroupe[]>()
    for (const r of reglements) m.set(r.ligne_bancaire_id, [...(m.get(r.ligne_bancaire_id) ?? []), r])
    return m
  }, [reglements])

  // CE QUE LES PAIEMENTS D'UNE PIÈCE LAISSENT À PAYER, OU ONT PAYÉ DE TROP — jugé sur le TOTAL de ses paiements
  // (lib/controles.ts), comme la Checklist : comparés un à un à la pièce, les deux paiements d'une facture réglée
  // en deux fois s'en écartaient chacun, et l'écran criait deux fois sur une pièce payée. Sur le relevé ou les
  // parts lus en partie, un paiement non lu ferait paraître une pièce réglée payée en partie : ce reste-là se tait.
  const restesAPayer = useMemo(
    () => (lignesIncompletes || reglementsIncomplets
      ? new Map<string, number>()
      : new Map(piecesPayeesEnPartie(pieces, paiements, modele.mode).map((x) => [x.piece.id, x.reste]))),
    [pieces, paiements, modele.mode, lignesIncompletes, reglementsIncomplets],
  )
  const payeesEnTrop = useMemo(
    () => new Map(piecesPayeesEnTrop(pieces, paiements).map((x) => [x.piece.id, x.enTrop])),
    [pieces, paiements],
  )

  // Mémoïsée parce que `planAuto` en dépend : recréée à chaque rendu, elle relançait le plan — un
  // produit mouvements × pièces — à chaque frappe dans la recherche, et rendait son `useMemo` inopérant.
  const nonRapprochees = useMemo(() => lignes.filter((l) => l.statut === 'non_rapprochee'), [lignes])
  const totalNonRapproche = nonRapprochees.reduce((s, l) => s + l.montant, 0)

  // Le plan vit dans lib/appariementBanque.ts, testé. Il REFUSE de trancher quand deux pièces
  // conviennent aussi bien l'une que l'autre, dans les deux sens — la version précédente parcourait
  // les lignes en « consommant » les pièces au passage, si bien que le premier mouvement rencontré
  // emportait la pièce : pas un choix, un effet de l'ordre de tri, en masse et sur un seul clic.
  const planAuto = useMemo(
    () => planRapprochementAutomatique(nonRapprochees, piecesValidees, cotisations, {
      pieces: piecesHorsRapprochement, cotisations: cotisationsRapprochees,
    }),
    [nonRapprochees, piecesValidees, cotisations, piecesHorsRapprochement, cotisationsRapprochees],
  )
  const suggestionsAutomatiques = planAuto.retenus

  // Appariements où le montant, la date ET le fournisseur concordent — le seul cas où valider une
  // pièce n'apprend rien à personne. Le tri vit dans lib/appariementBanque.ts, testé ; ici il ne
  // reste que l'écriture en base. Voir ce module pour pourquoi trois signaux et pas deux.
  //
  // Seules les pièces que rien ne paie encore y entrent : une pièce réglée par la part d'un virement groupé
  // — ou déjà rapprochée — que le lot « Valider et rapprocher » rattacherait à un second mouvement du même
  // montant serait payée deux fois.
  const { certains: appariementsCertains, aArbitrer: appariementsDouteux } = useMemo(
    () => analyserAppariements(pieces.filter((p) => !piecesHorsRapprochement.has(p.id)), lignes),
    [pieces, lignes, piecesHorsRapprochement],
  )
  const certainsAValider = appariementsCertains.filter((a) => a.piece.statut !== 'validee')

  // UNE LECTURE PARTIELLE NE COMMANDE PAS D'ÉCRITURE. Les deux lots ci-dessous n'écrivent que ce
  // qu'aucun doute ne sépare, et « aucun doute » veut dire UN SEUL candidat de part et d'autre. Or une
  // unicité se juge sur ce qu'on a LU : que la jumelle d'une pièce (deux factures mensuelles
  // identiques) ou d'un mouvement tombe au-delà d'une lecture tronquée, et l'autre paraît seule —
  // le lot rattache alors le mauvais justificatif, et le second lot VALIDE la pièce sur cette
  // fausse certitude. Le rapprochement ligne à ligne, lui, reste ouvert : c'est l'opérateur qui y
  // tranche, bandeaux sous les yeux.
  // Les parts des règlements groupés en font partie : une pièce payée par une part non lue paraîtrait seule
  // candidate, et le lot la rapprocherait d'un second mouvement.
  // En trésorerie, les pièces figées aussi : une pièce figée qu'on n'a pas lue comme telle paraîtrait seule candidate.
  const lotAutomatiqueSuspendu = lignesIncompletes ?? piecesIncompletes ?? referencesIncompletes ?? reglementsIncomplets
    ?? (modele.mode === 'tresorerie' ? piecesFigees.motif : null)
  const lotCertainSuspendu = lignesIncompletes ?? piecesIncompletes ?? reglementsIncomplets

  // LES AFFECTATIONS QUE LES RÈGLES PROPOSENT (lib/reglesAffectation.ts). Un mouvement qui a peut-être
  // son justificatif — une pièce ou une échéance du même montant, une pièce du même tiers — en est
  // écarté : affecté, il compterait dans la 2035 à côté de sa pièce. De même un mouvement qui ressemble
  // à une échéance d'emprunt (`empruntPlausible`) : affecté à une catégorie de charge, son CAPITAL
  // compterait en charge — une règle au nom de la banque les désigne aussi bien que ses frais.
  //
  // Et en trésorerie, un paiement du même montant qu'une NOTE DE FRAIS figée : il en est peut-être le remboursement, un
  // virement personnel. Affecté à une charge, la dépense compterait deux fois — dans l'exercice validé et dans celui-ci.
  const notesFigees = useMemo(
    () => piecesValidees.filter((p) => p.type_piece === 'note_frais' && piecesFigeesHorsRapprochement.has(p.id)),
    [piecesValidees, piecesFigeesHorsRapprochement],
  )
  const planRegles = useMemo(() => {
    const justificatifs = { pieces, piecesRapprochees: piecesHorsRapprochement, cotisations, cotisationsRapprochees }
    return planAffectationParRegles(lignes, reglesAffectation, categories, assujettiTva, (l) => {
      const justificatif = justificatifPossible(l, justificatifs)
      if (justificatif) return justificatif
      if (candidatsPieces(l, notesFigees, piecesRapprochees).length > 0) return REMBOURSEMENT_D_UNE_NOTE_FIGEE
      const emprunt = empruntPlausible(l, emprunts, lignes)
      return emprunt ? raisonEmpruntPlausible(emprunt) : null
    })
  }, [lignes, reglesAffectation, categories, assujettiTva, pieces, piecesHorsRapprochement, notesFigees, piecesRapprochees, cotisations, cotisationsRapprochees, emprunts])
  const idsProposesParRegle = useMemo(() => new Set(planRegles.propositions.map((p) => p.ligne.id)), [planRegles])
  const idsEmpruntPlausible = useMemo(
    () => new Set(nonRapprochees.filter((l) => empruntPlausible(l, emprunts, lignes)).map((l) => l.id)),
    [nonRapprochees, emprunts, lignes],
  )
  // Toutes les lectures dont le plan dépend : un mouvement tronqué, une pièce ou une échéance non lue
  // (le mouvement paraîtrait sans justificatif), une catégorie ou une règle manquante (une règle plus
  // précise aurait changé la catégorie). Une lecture partielle ne commande pas d'écriture.
  const lotReglesSuspendu = lignesIncompletes ?? piecesIncompletes ?? referencesIncompletes
    ?? categoriesIncompletes ?? reglesAffectationIncompletes ?? empruntsIncomplets
  const [affectationLotEnCours, setAffectationLotEnCours] = useState(false)
  const [progressionLot, setProgressionLot] = useState<string | null>(null)

  // Écrit le lot par envois (TAILLE_ENVOI_AFFECTATION), chacun tout ou rien : `affecter_mouvements_bancaires`
  // refait pour chaque mouvement les vérifications de l'affectation à l'unité, et refuse l'envoi entier
  // si l'un d'eux n'est plus à traiter. Sous le verrou partagé des écritures de l'écran.
  async function affecterSelonLesRegles() {
    if (planRegles.propositions.length === 0 || lotReglesSuspendu) return
    const envois = envoisDuLot(planRegles.propositions)
    const total = planRegles.propositions.length
    await sousVerrou(setAffectationLotEnCours, async () => {
      let faits = 0
      try {
        for (const envoi of envois) {
          setProgressionLot(`${faits} / ${total}`)
          const { error } = await supabase.rpc('affecter_mouvements_bancaires', { p_affectations: envoi })
          if (error) {
            window.alert(
              `${faits > 0 ? `${faits} mouvement${faits > 1 ? 's' : ''} affecté${faits > 1 ? 's' : ''}, puis l'envoi suivant` : 'Le lot'} a été refusé, et rien de cet envoi n'a été écrit : ${messageErreur(error, 'raison inconnue')}`,
            )
            return faits > 0
          }
          faits += envoi.length
        }
        return true
      } finally {
        setProgressionLot(null)
      }
    })
  }

  // Valide la pièce ET rapproche le mouvement, en une passe. Les deux vont ensemble : c'est la
  // concordance avec la banque qui justifie la validation, la séparer n'aurait pas de sens.
  // Sous le verrou partagé (voir `sousVerrou`) : un double clic enverrait sinon deux fois les mêmes
  // écritures de contrepartie (voir ImportDossierModal, même correctif).
  async function validerEtRapprocherLot() {
    if (certainsAValider.length === 0 || lotCertainSuspendu) return
    await sousVerrou(setRapprochementAuto, async () => {
      const echecs: string[] = []
      for (const a of certainsAValider) {
        const { error: errPiece } = await supabase.from('pieces').update({ statut: 'validee' }).eq('id', a.piece.id)
        if (errPiece) { echecs.push(`${a.piece.tiers ?? a.piece.nom_fichier} : ${errPiece.message}`); continue }

        // Le rapprochement n'est tenté qu'une fois la validation réellement écrite : l'inverse
        // laisserait un mouvement rapproché sur une pièce restée « à valider ».
        const { error: errLigne } = await supabase
          .from('lignes_bancaires')
          .update({ statut: 'rapprochee', piece_id: a.piece.id })
          .eq('id', a.ligne.id)
        if (errLigne) { echecs.push(`${a.piece.tiers ?? a.piece.nom_fichier} : ${errLigne.message}`); continue }

        try {
          const piece = await reglerSiLibre(a.piece, a.ligne.id, a.ligne.montant)
          await synchroniserContrepartieBanque(dossierId, piece, a.ligne, modele)
        } catch (err) {
          // La pièce est validée et le mouvement rapproché ; seule la contrepartie comptable manque.
          // On le dit plutôt que de laisser croire que tout est passé.
          echecs.push(`${a.piece.tiers ?? a.piece.nom_fichier} : ${ecritureDeBanque} non créée (${messageErreur(err, 'raison inconnue')})`)
        }
      }
      if (echecs.length > 0) {
        window.alert(`${certainsAValider.length - echecs.length} pièce(s) validée(s) et rapprochée(s).\n\nÉchecs :\n${echecs.join('\n')}`)
      }
      return true
    })
  }

  // Applique en une fois tous les rapprochements sûrs (montant + date proches, un seul candidat
  // disponible DE PART ET D'AUTRE) — rien n'est écrit sans ce clic explicite, et le tableau reste
  // modifiable/annulable ligne par ligne ensuite comme n'importe quel rapprochement.
  //
  // Sous le verrou partagé : ce bouton ne portait d'abord que `rapprochementAuto`, un ÉTAT React, pour
  // se désactiver — or un état ne prend effet qu'au rendu suivant, donc un double clic passait les
  // deux dans le même rendu et enverrait deux fois les mêmes écritures de contrepartie. Même défaut
  // que VehiculesCard, ImportDossierModal et « C'est une facture » (DocumentsTab), trouvé en écrivant
  // le test de cet onglet plutôt qu'en le relisant.
  //
  // « Un seul candidat disponible » était annoncé ici bien avant d'être vrai : le tri décidait à la
  // place de l'opérateur quand plusieurs pièces convenaient. C'est `planRapprochementAutomatique`
  // qui le garantit maintenant, et `appariementBanque.test.ts` le fige (describe
  // `planRapprochementAutomatique`, avec ses gardes symétriques). La phrase était au FUTUR
  // alors que le test existait déjà — une promesse qu'on ne peut pas vérifier en la lisant.
  async function rapprocherTout() {
    const maj = planAuto.retenus
    if (maj.length === 0 || lotAutomatiqueSuspendu) return
    await sousVerrou(setRapprochementAuto, async () => {
      // Une échéance de cotisation passe par la base, qui écrit son écriture avec le rapprochement ; une
      // pièce, par une mise à jour suivie de sa contrepartie, comme à la main.
      const resultats: { error: { message: string } | null }[] = await Promise.all(
        maj.map(async (m) => {
          if (m.cotisationId) {
            const ligne = lignes.find((l) => l.id === m.ligneId)
            const cotisation = cotisations.find((c) => c.id === m.cotisationId)
            if (!ligne || !cotisation) return { error: { message: 'mouvement ou échéance introuvable' } }
            const { error } = await supabase.rpc('rapprocher_cotisation', {
              p_ligne_bancaire_id: ligne.id,
              p_cotisation_id: cotisation.id,
              p_ecritures: ecritureDeLaCotisation(ligne, cotisation, modele.mode),
            })
            return { error: error ? { message: messageErreur(error, 'raison inconnue') } : null }
          }
          const { error } = await supabase.from('lignes_bancaires').update({ statut: 'rapprochee', piece_id: m.pieceId }).eq('id', m.ligneId)
          return { error: error ? { message: messageErreur(error, 'raison inconnue') } : null }
        }),
      )
      // Correctif audit sécurité (rapprochements, Importante) : seules les lignes réellement mises à
      // jour reçoivent leur contrepartie banque — jamais toutes en bloc, sinon un échec isolé (une
      // ligne verrouillée, une erreur réseau au milieu du lot...) laisserait une écriture de
      // contrepartie pour un mouvement qui, en base, n'est en réalité pas rapproché.
      const echecs = resultats.filter((r) => r.error)
      const reussies = maj.filter((_, i) => !resultats[i].error)
      if (echecs.length > 0) {
        window.alert(
          `${echecs.length} rapprochement${echecs.length > 1 ? 's' : ''} sur ${maj.length} n'${echecs.length > 1 ? 'ont' : 'a'} pas pu être enregistré${echecs.length > 1 ? 's' : ''} (${echecs[0].error!.message}) — les autres ont bien été appliqués.`,
        )
      }
      // `allSettled` et non `all` : une contrepartie en échec ne doit pas empêcher les autres d'être
      // créées. Les échecs sont comptés et annoncés en une fois, comme les rapprochements ci-dessus.
      //
      // Le règlement sur le montant bancaire AVANT la contrepartie, comme les deux autres chemins de
      // rapprochement de cet écran. Il manquait à celui-ci depuis qu'il existe : une pièce en devise
      // rapprochée par le lot restait « provisoire » au cours BCE alors que la banque venait de donner
      // son montant réel — un jumeau qu'on corrige d'un seul côté (voir lib/reglementBanque.ts).
      const contreparties = await Promise.allSettled(
        reussies
          .filter((m): m is { ligneId: string; pieceId: string } => !!m.pieceId)
          .map(async (m) => {
            const ligne = lignes.find((l) => l.id === m.ligneId)
            const pieceAvant = pieces.find((p) => p.id === m.pieceId)
            if (!ligne || !pieceAvant) return
            const piece = await reglerSiLibre(pieceAvant, ligne.id, ligne.montant)
            await synchroniserContrepartieBanque(dossierId, piece, ligne, modele)
          }),
      )
      const contrepartiesEnEchec = contreparties.filter((r) => r.status === 'rejected')
      if (contrepartiesEnEchec.length > 0) {
        const premier = contrepartiesEnEchec[0] as PromiseRejectedResult
        window.alert(
          `${contrepartiesEnEchec.length} écriture${contrepartiesEnEchec.length > 1 ? 's' : ''} ${modele.mode === 'engagement' ? 'de règlement' : 'de contrepartie banque'} n'${contrepartiesEnEchec.length > 1 ? 'ont' : 'a'} pas pu être créée${contrepartiesEnEchec.length > 1 ? 's' : ''} (${messageErreur(premier.reason, 'raison inconnue')}) — les rapprochements, eux, sont enregistrés.`,
        )
      }
      return true
    })
  }

  // Le mouvement ouvert, relu dans `lignes` à chaque rendu — voir `mouvementOuvert`.
  const ligneOuverte = mouvementOuvert ? lignes.find((l) => l.id === mouvementOuvert.id) ?? null : null
  const mouvementVisible = ligneOuverte !== null && panneauMouvement.ouvert

  function ouvrirMouvement(ligne: LigneBancaire, rang: number) {
    if (!panneauMouvement.ouvrir()) return
    setMouvementOuvert({ id: ligne.id, rang })
  }

  function fermerMouvement() {
    if (panneauMouvement.fermer()) setMouvementOuvert(null)
  }

  // « Mouvement N sur M » sur la liste AFFICHÉE, comme la fiche d'une pièce. Un mouvement qui en est
  // sorti — rapproché sous le filtre « Non rapprochés », le cas courant — a laissé sa place à son
  // suivant : « Suivant » mène à celui-là, et on enchaîne sans revenir à la liste.
  const rangAffiche = ligneOuverte ? filtered.findIndex((l) => l.id === ligneOuverte.id) : -1
  const rangRepere = rangAffiche !== -1 ? rangAffiche : mouvementOuvert?.rang ?? -1
  const rangPrecedent = rangRepere - 1
  const rangSuivant = rangAffiche !== -1 ? rangAffiche + 1 : rangRepere
  const navigationMouvement = {
    position: rangAffiche === -1 ? 'Mouvement hors de la liste affichée' : `Mouvement ${rangAffiche + 1} sur ${filtered.length}`,
    precedent: rangPrecedent >= 0 && rangPrecedent < filtered.length
      ? () => ouvrirMouvement(filtered[rangPrecedent], rangPrecedent)
      : null,
    suivant: rangSuivant >= 0 && rangSuivant < filtered.length
      ? () => ouvrirMouvement(filtered[rangSuivant], rangSuivant)
      : null,
  }

  return (
    <>
      <BandeauLecturePartielle
        quoi="Les mouvements bancaires"
        accord="lus"
        motif={lignesIncompletes}
        consequence={
          'Les totaux, le contrôle de solde et le rapprochement ci-dessous portent donc sur une ' +
          'partie du relevé, et l’import comme les rapprochements en lot sont suspendus. Recharge ' +
          'la page avant de t’appuyer dessus.'
        }
      />

      {/* Deux bandeaux et non un seul : la `consequence` est ce qui distingue « lecture partielle »
          d'un avertissement utile, et les deux manques ne produisent pas la même erreur. */}
      <BandeauLecturePartielle
        quoi="Les pièces à rapprocher"
        motif={piecesIncompletes}
        consequence={
          'Des justificatifs manquent donc dans les candidats au rapprochement : un mouvement peut ' +
          'ressortir « sans pièce » alors que la pièce existe, et les rapprochements en lot sont ' +
          'suspendus. Recharge la page avant d’arbitrer.'
        }
      />

      <BandeauLecturePartielle
        quoi="Les cotisations et les règles « toujours ignorer »"
        motif={referencesIncompletes}
        consequence={
          'Un mouvement peut donc rester « à traiter » alors qu’une cotisation ou une règle le ' +
          'couvre. L’import d’un relevé, dont le statut écrit en base suivrait cette liste tronquée, ' +
          'et le rapprochement automatique sont suspendus. Recharge la page.'
        }
      />

      <BandeauLecturePartielle
        quoi="Les catégories"
        motif={categoriesIncompletes}
        consequence={
          'Un mouvement affecté peut donc s’afficher sans le nom de sa catégorie, et la liste de choix ' +
          'de la fiche d’un mouvement peut en manquer. Recharge la page avant d’affecter.'
        }
      />

      <BandeauLecturePartielle
        quoi="Les emprunts"
        accord="lus"
        motif={empruntsIncomplets}
        consequence={
          'Un emprunt peut donc manquer au choix de la fiche d’un mouvement, et un paiement qui ressemble à ' +
          'l’une de ses échéances n’être pas reconnu : l’affectation en lot est suspendue. Recharge la page.'
        }
      />

      <BandeauLecturePartielle
        quoi="Les parts des mouvements ventilés"
        motif={ventilationsIncompletes}
        consequence={
          'Un mouvement ventilé peut donc s’afficher sans toutes ses parts, et modifier une ventilation est ' +
          'suspendu. Recharge la page.'
        }
      />

      <BandeauLecturePartielle
        quoi="Les parts des virements qui règlent plusieurs pièces"
        motif={reglementsIncomplets}
        consequence={
          'Une pièce déjà payée peut donc paraître sans paiement, et un virement groupé s’afficher sans toutes ses ' +
          'pièces. Régler plusieurs pièces et les rapprochements en lot sont suspendus. Recharge la page.'
        }
      />

      <BandeauLecturePartielle
        quoi="Les écritures validées et les immobilisations du dossier"
        motif={piecesFigees.motif}
        consequence={modele.mode === 'tresorerie'
          ? 'Une pièce qu’un exercice validé a figée peut donc être proposée au rapprochement : la base refuserait d’en ' +
            'redater les écritures validées. Le rapprochement automatique est suspendu. Recharge la page.'
          : 'Une pièce qu’un exercice validé a figée peut donc paraître encore alignable sur le montant de la banque : la ' +
            'base refusera d’en changer le montant, et son règlement s’écrira au montant du mouvement. Recharge la page.'}
      />

      <BandeauLecturePartielle
        quoi="Les règles d’affectation"
        motif={reglesAffectationIncompletes}
        consequence={
          'Une règle plus précise peut donc manquer, et la catégorie proposée à un mouvement être fausse. ' +
          'L’affectation en lot et l’enregistrement d’une nouvelle règle sont suspendus. Recharge la page.'
        }
      />

      <ConnexionBancaireCard
        dossierId={dossierId}
        lignes={lignes}
        regles={regles}
        suspension={lignesIncompletes ?? referencesIncompletes}
        frontiere={frontiere}
        onImported={load}
      />

      <ImportCsv
        dossierId={dossierId}
        onImported={load}
        regles={regles}
        lignesExistantes={lignes}
        lectureIncomplete={lignesIncompletes ?? referencesIncompletes}
        frontiere={frontiere}
      />

      {relevesIncoherents.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            {relevesIncoherents.length === 1 ? 'Un relevé ne boucle pas' : `${relevesIncoherents.length} relevés ne bouclent pas`}
            <span className="badge badge-danger">à traiter</span>
          </h3>
          <p className="muted" style={{ marginTop: -8 }}>
            Solde d'ouverture + somme des mouvements ne donne pas le solde de clôture : il manque
            probablement des opérations dans le fichier importé. Tant que l'écart n'est pas expliqué,
            les totaux bancaires de ce dossier — et tout ce qui en découle — sont incomplets.
          </p>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {relevesIncoherents.map((c) => (
              <li key={c.id} style={{ marginBottom: 4 }}>
                {c.source_fichier ?? 'Relevé sans nom de fichier'}
                {c.periode_debut && c.periode_fin ? ` (${formatDate(c.periode_debut)} → ${formatDate(c.periode_fin)})` : ''}
                {' — écart de '}<strong>{formatMoney(Math.abs(c.ecart))}</strong>
                {' : '}{formatMoney(c.solde_initial)} + {formatMoney(c.somme_mouvements)} ={' '}
                {formatMoney(c.solde_initial + c.somme_mouvements)}, alors que la clôture indique {formatMoney(c.solde_final)}.
              </li>
            ))}
          </ul>
        </div>
      )}

      {piecesMontantSuspect.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            {piecesMontantSuspect.length === 1
              ? 'Un montant ne correspond à aucun mouvement bancaire'
              : `${piecesMontantSuspect.length} montants ne correspondent à aucun mouvement bancaire`}
            <span className="badge badge-danger">à vérifier</span>
          </h3>
          <p className="muted" style={{ marginTop: -8 }}>
            Ce montant n'apparaît nulle part dans le relevé importé, à aucune date. Deux causes
            possibles, qu'aucune règle ne peut départager à votre place : soit le relevé est incomplet
            (l'opération n'a jamais été déposée sur ce compte), soit le montant lu sur la pièce est
            faux — l'extraction a pu prendre un sous-total, un solde antérieur ou un montant déjà réglé
            au lieu du total du document.
          </p>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {piecesMontantSuspect.map((p) => (
              <li key={p.id} style={{ marginBottom: 4 }}>
                {p.tiers ?? 'Fournisseur non lu'} — {formatMoney(p.montant_ttc ?? 0)}
                {p.date_piece ? ` (${formatDate(p.date_piece)})` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginTop: 0 }}>Écarts à vérifier</h3>
        <p className="muted" style={{ margin: 0 }}>
          {nonRapprochees.length} mouvement(s) bancaire(s) non rapproché(s) ({formatMoney(totalNonRapproche)})
          {' · '}
          {piecesSansMouvement.length} pièce(s) validée(s) sans mouvement bancaire correspondant
          {' · '}
          {cotisationsSansMouvement.length} échéance(s) de cotisation sans mouvement bancaire correspondant
        </p>
        {suggestionsAutomatiques.length > 0 && (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            style={{ marginTop: 10 }}
            disabled={rapprochementAuto || actionMouvementEnCours || affectationLotEnCours || lotAutomatiqueSuspendu !== null}
            onClick={rapprocherTout}
          >
            {rapprochementAuto ? 'Rapprochement…' : `Tout rapprocher automatiquement (${suggestionsAutomatiques.length})`}
          </button>
        )}
        {suggestionsAutomatiques.length > 0 && lotAutomatiqueSuspendu && (
          <p className="error-text" style={{ marginTop: 8, marginBottom: 0 }}>
            Rapprochement automatique suspendu : une lecture est incomplète ({lotAutomatiqueSuspendu}).
            Un mouvement qui paraît n'avoir qu'une pièce possible peut en avoir une seconde qu'on n'a
            pas lue. Recharge la page.
          </p>
        )}
        {/* Un bouton qui annonce N en en traitant moins ne dit pas où sont passées les autres — même
            règle que la feuille « Pièces manquantes » d'un pack. Ces lignes-là ont bien des
            candidates, mais plusieurs conviennent aussi bien : les départager demande d'ouvrir les
            documents, et c'est le travail de l'opérateur, pas celui d'un tri. */}
        {planAuto.ecartesPourAmbiguite > 0 && (
          <p className="muted" style={{ marginTop: 8, marginBottom: 0 }}>
            {planAuto.ecartesPourAmbiguite} mouvement(s) ont plusieurs pièces ou échéances possibles et
            ne sont pas rapprochés automatiquement — ouvre la ligne pour choisir.
          </p>
        )}
        {reglesAffectation.length > 0 && (
          <p className="muted" style={{ marginTop: 8, marginBottom: 0 }}>
            Règles d'affectation :{' '}
            {reglesAffectation.map((r) => (
              <span key={r.id} className="badge badge-neutral" style={{ marginRight: 6 }}>
                « {r.motif} » · {r.sens === 'encaissement' ? 'encaissements' : 'paiements'} →{' '}
                {categories.find((c) => c.id === r.categorie_id)?.libelle ?? 'catégorie non lue'}
                <button
                  type="button"
                  onClick={() => retirerRegleAffectation(r)}
                  style={{ marginLeft: 6, border: 'none', background: 'none', cursor: 'pointer', color: 'inherit', fontWeight: 700 }}
                  title="Retirer cette règle"
                  aria-label={`Retirer la règle « ${r.motif} »`}
                >
                  ×
                </button>
              </span>
            ))}
          </p>
        )}
        {regles.length > 0 && (
          <p className="muted" style={{ marginTop: 8, marginBottom: 0 }}>
            Ignorés automatiquement :{' '}
            {regles.map((r) => (
              <span key={r.id} className="badge badge-neutral" style={{ marginRight: 6 }}>
                {r.motif}
                <button
                  type="button"
                  onClick={() => retirerRegle(r.id)}
                  style={{ marginLeft: 6, border: 'none', background: 'none', cursor: 'pointer', color: 'inherit', fontWeight: 700 }}
                  title="Retirer cette règle"
                >
                  ×
                </button>
              </span>
            ))}
          </p>
        )}
      </div>

      {certainsAValider.length > 0 && (
        <div className="card" style={{ marginBottom: 14, borderLeft: '3px solid var(--color-primary)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <h3 style={{ margin: 0 }}>Sans doute possible ({certainsAValider.length})</h3>
              <p className="muted" style={{ margin: '4px 0 0' }}>
                Pour ces pièces, la banque confirme les trois : le montant au centime, la date à
                {' '}{JOURS_TOLERANCE_RAPPROCHEMENT} jours près avec un seul rapprochement possible, et le fournisseur dans
                le libellé du mouvement. Les relire une par une n'apprendrait rien.
              </p>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              disabled={rapprochementAuto || actionMouvementEnCours || affectationLotEnCours || lotCertainSuspendu !== null}
              onClick={validerEtRapprocherLot}
            >
              {rapprochementAuto ? 'Traitement…' : certainsAValider.length === 1 ? 'Valider et rapprocher cette pièce' : `Valider et rapprocher les ${certainsAValider.length}`}
            </button>
          </div>
          {lotCertainSuspendu && (
            <p className="error-text" style={{ marginTop: 8, marginBottom: 0 }}>
              Validation en lot suspendue : une lecture est incomplète ({lotCertainSuspendu}). « Un seul
              rapprochement possible » ne se juge que sur tout le relevé et toutes les pièces. Recharge
              la page.
            </p>
          )}
          <div className="table-scroll" style={{ marginTop: 12 }}>
            <table>
              <thead>
                <tr>
                  <th>Pièce</th>
                  <th style={{ textAlign: 'right' }}>Montant</th>
                  <th>Date pièce</th>
                  <th>Mouvement</th>
                  <th>Libellé bancaire</th>
                </tr>
              </thead>
              <tbody>
                {certainsAValider.map((a) => (
                  <tr key={a.piece.id}>
                    <td>{a.piece.tiers ?? a.piece.nom_fichier}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatMoney(a.piece.montant_ttc ?? 0)}</td>
                    <td>{formatDate(a.piece.date_piece!)}</td>
                    <td>
                      {formatDate(a.ligne.date)}
                      <span className="muted" style={{ marginLeft: 6 }}>({a.ecartJours} j)</span>
                    </td>
                    <td className="muted" style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {libelleExploitable(a.ligne)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {appariementsDouteux.length > 0 && (
        <div className="card" style={{ marginBottom: 14, borderLeft: '3px solid var(--color-warning)' }}>
          <h3 style={{ marginTop: 0 }}>À trancher par l'opérateur ({appariementsDouteux.length})</h3>
          <p className="muted" style={{ marginTop: -8 }}>
            Le montant et la date collent, mais quelque chose empêche de conclure. Ce sont les cas où
            un humain décide — et les seuls qui méritent son temps.
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Pièce</th>
                  <th style={{ textAlign: 'right' }}>Montant</th>
                  <th>Date pièce</th>
                  <th>Pourquoi</th>
                  <th>Libellé bancaire</th>
                </tr>
              </thead>
              <tbody>
                {appariementsDouteux.map((a) => (
                  <tr key={`${a.piece.id}-${a.ligne.id}`}>
                    <td>{a.piece.tiers ?? a.piece.nom_fichier}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatMoney(a.piece.montant_ttc ?? 0)}</td>
                    <td>{formatDate(a.piece.date_piece!)}</td>
                    <td style={{ color: 'var(--color-warning)' }}>{a.motif}</td>
                    <td className="muted" style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {libelleExploitable(a.ligne)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Après les pièces, et c'est voulu : un mouvement qui a son justificatif se rapproche, il ne
          s'affecte pas — le plan les écarte, et les montre à part. */}
      {(planRegles.propositions.length + planRegles.aRapprocher.length + planRegles.refus.length + planRegles.conflits.length) > 0 && (
        <div className="card" style={{ marginBottom: 14, borderLeft: '3px solid var(--color-primary)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <h3 style={{ margin: 0 }}>Affectations proposées par vos règles ({planRegles.propositions.length})</h3>
              <p className="muted" style={{ margin: '4px 0 0' }}>
                Chaque mouvement ci-dessous porte un libellé qu'une de vos règles reconnaît. Rien n'est écrit
                sans ce clic : chacun le sera sur le compte de sa catégorie face à la banque, comme une
                affectation faite à la main — une recette d'un dossier assujetti au hors taxe, sa TVA à côté,
                au taux de sa règle —, et compté dans la 2035 à sa date.
              </p>
            </div>
            {planRegles.propositions.length > 0 && (
              <button
                type="button"
                className="btn btn-primary"
                disabled={affectationLotEnCours || rapprochementAuto || actionMouvementEnCours || lotReglesSuspendu !== null}
                onClick={affecterSelonLesRegles}
              >
                {affectationLotEnCours
                  ? `Affectation…${progressionLot ? ` (${progressionLot})` : ''}`
                  : planRegles.propositions.length === 1 ? 'Affecter ce mouvement' : `Affecter les ${planRegles.propositions.length}`}
              </button>
            )}
          </div>
          {lotReglesSuspendu && planRegles.propositions.length > 0 && (
            <p className="error-text" style={{ marginTop: 8, marginBottom: 0 }}>
              Affectation en lot suspendue : une lecture est incomplète ({lotReglesSuspendu}). Un mouvement
              peut avoir un justificatif qu'on n'a pas lu, ou une règle plus précise qu'on n'a pas lue.
              Recharge la page.
            </p>
          )}
          {planRegles.propositions.length > 0 && (
            <ul style={{ margin: '10px 0 0', paddingLeft: 20 }}>
              {totauxParCategorie(planRegles.propositions).map((t) => (
                <li key={t.categorie.id}>
                  <strong>{t.categorie.libelle}</strong> ({t.categorie.compte_comptable}) : {t.nombre} mouvement{t.nombre > 1 ? 's' : ''},{' '}
                  {formatMoney(t.montant)}
                </li>
              ))}
            </ul>
          )}
          {planRegles.propositions.length > 0 && (
            <details style={{ marginTop: 10 }}>
              <summary>Voir les {planRegles.propositions.length} mouvement{planRegles.propositions.length > 1 ? 's' : ''}</summary>
              <div className="table-scroll" style={{ marginTop: 8 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Libellé bancaire</th>
                      <th style={{ textAlign: 'right' }}>Montant</th>
                      <th>Catégorie</th>
                      <th>Règle</th>
                    </tr>
                  </thead>
                  <tbody>
                    {planRegles.propositions.map((p) => (
                      <tr key={p.ligne.id}>
                        <td>{formatDate(p.ligne.date)}</td>
                        <td className="muted" style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {libelleExploitable(p.ligne)}
                        </td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatMoney(p.ligne.montant)}</td>
                        <td>
                          {p.categorie.libelle}
                          {p.taux != null ? ` (TVA ${libelleTaux(p.taux)})` : ''}
                        </td>
                        <td>« {p.regle.motif} »</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
          {/* Ce que les règles reconnaissent sans le proposer, et pourquoi — un lot qui en traite moins
              qu'il n'en reconnaît dit où sont passés les autres. */}
          {planRegles.aRapprocher.length > 0 && (
            <details style={{ marginTop: 10 }}>
              <summary>
                {planRegles.aRapprocher.length} mouvement{planRegles.aRapprocher.length > 1 ? 's' : ''} à rapprocher plutôt qu'affecter
              </summary>
              <p className="muted" style={{ margin: '6px 0' }}>
                Une règle les reconnaît, mais leur justificatif est peut-être au dossier : affectés, ils
                compteraient dans la 2035 à côté de leur pièce. Ouvre-les pour les rapprocher.
              </p>
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                {planRegles.aRapprocher.map((r) => (
                  <li key={r.ligne.id}>
                    {formatDate(r.ligne.date)} — {libelleExploitable(r.ligne)} — {formatMoney(r.ligne.montant)} : {r.raison}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {planRegles.refus.length > 0 && (
            <details style={{ marginTop: 10 }}>
              <summary>
                {planRegles.refus.length} mouvement{planRegles.refus.length > 1 ? 's' : ''} que l'affectation refuserait
              </summary>
              <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
                {planRegles.refus.map((r) => (
                  <li key={r.ligne.id}>
                    {formatDate(r.ligne.date)} — {libelleExploitable(r.ligne)} — {formatMoney(r.ligne.montant)} (règle « {r.regle.motif} ») : {r.raison}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {planRegles.conflits.length > 0 && (
            <details style={{ marginTop: 10 }}>
              <summary>
                {planRegles.conflits.length} mouvement{planRegles.conflits.length > 1 ? 's' : ''} où des règles se contredisent
              </summary>
              <p className="muted" style={{ margin: '6px 0' }}>
                Plusieurs règles reconnaissent leur libellé sans s'accorder sur la catégorie, et aucune ne
                contient les autres : rien n'est proposé. Retire la règle qui n'a pas lieu d'être, ou
                affecte-les à la main.
              </p>
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                {planRegles.conflits.map((c) => (
                  <li key={c.ligne.id}>
                    {formatDate(c.ligne.date)} — {libelleExploitable(c.ligne)} : {c.regles.map((r) => `« ${r.motif} »`).join(', ')}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        {(['toutes', 'non_rapprochee', 'rapprochee', 'ignoree'] as const).map((s) => (
          <button
            key={s}
            className={`btn btn-sm ${filter === s ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => setFilter(s)}
          >
            {s === 'toutes' ? 'Tous' : s === 'non_rapprochee' ? 'Non rapprochés' : s === 'rapprochee' ? 'Rapprochés' : 'Ignorés'}
          </button>
        ))}
      </div>

      {moisDisponibles.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
          <button className={`btn btn-sm ${moisFilter === 'tous' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setMoisFilter('tous')}>
            Tous les mois
          </button>
          {moisDisponibles.map((m) => (
            <button key={m} className={`btn btn-sm ${moisFilter === m ? 'btn-primary' : 'btn-outline'}`} onClick={() => setMoisFilter(m)}>
              {NOMS_MOIS[m]}
            </button>
          ))}
        </div>
      )}

      <div style={{ marginBottom: 14 }}>
        <BarreRecherche
          valeur={recherche}
          onChange={setRecherche}
          placeholder="Rechercher un libellé, un montant, une date…"
          affiches={filtered.length}
          total={avantRecherche.length}
        />
      </div>

      {/* Tableau volontairement compact (date/libellé/montant/statut) — les boutons et menus de
          rapprochement vivent dans le panneau de détail ouvert au clic sur une ligne, pas ici : avec
          plusieurs centaines de mouvements, les répéter sur chaque ligne rendait l'écran interminable
          (voir audit ergonomie). */}
      <div className="card table-scroll" style={{ padding: 0 }}>
        {loading ? (
          <p className="muted" style={{ padding: 20 }}>Chargement…</p>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            {recherche.trim()
              ? `Aucun mouvement ne correspond à « ${recherche.trim()} ».`
              : `Aucun mouvement bancaire${filter !== 'toutes' || moisFilter !== 'tous' ? ' dans ce filtre' : ''}.`}
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Libellé</th>
                <th>Montant</th>
                <th>Statut</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((l, rang) => {
                const piecePayee = l.piece_id ? pieces.find((p) => p.id === l.piece_id) : null
                const pastillesPaiement = pastillesDePaiement(piecesPayeesPar(l, reglementsParLigne.get(l.id) ?? []), restesAPayer, payeesEnTrop, l.reglement_groupe)
                const cotisationPayee = l.cotisation_id ? cotisations.find((c) => c.id === l.cotisation_id) : null
                const categorieAffectee = l.statut === 'rapprochee' && l.categorie_id
                  ? categories.find((c) => c.id === l.categorie_id) ?? null
                  : null
                const empruntDuMouvement = l.statut === 'rapprochee' && l.emprunt_id
                  ? emprunts.find((e) => e.id === l.emprunt_id) ?? null
                  : null
                const aUneSuggestion = l.statut === 'non_rapprochee' && (!!(suggestion(l) || suggestionCotisation(l) || suggestionRecurrente(l))
                  || idsProposesParRegle.has(l.id) || idsEmpruntPlausible.has(l.id))
                return (
                  <tr
                    key={l.id}
                    className={`clickable${mouvementVisible && ligneOuverte?.id === l.id ? ' ligne-ouverte' : ''}`}
                    onClick={() => ouvrirMouvement(l, rang)}
                  >
                    <td>{formatDate(l.date)}</td>
                    <td>{l.libelle}</td>
                    <td>{formatMoney(l.montant)}</td>
                    <td>
                      {l.prelevement_personnel && <span className="badge badge-neutral">Virement personnel</span>}
                      {/* Une pastille VERTE sur un mouvement qui ne désigne plus rien est une
                          affirmation fausse, et elle est indiscernable d'un vrai rapprochement : une
                          pièce sans tiers rend exactement le même libellé nu. Voir
                          `mouvementRapprocheSansObjet` pour ce qui la produit. */}
                      {!l.prelevement_personnel && mouvementRapprocheSansObjet(l) && (
                        <span className="badge badge-danger">Rapproché sans justificatif</span>
                      )}
                      {/* Affecté, il n'est pas « Rapproché » d'une pièce : sa preuve est le relevé, et la
                          pastille le dit plutôt que de laisser un « Rapproché » nu. */}
                      {!l.prelevement_personnel && l.statut === 'rapprochee' && l.categorie_id && (
                        <span className="badge badge-ok">
                          Affecté{categorieAffectee ? ` — ${categorieAffectee.libelle}` : ''}
                          {assujettiTva && l.taux_tva != null ? ` · TVA ${libelleTaux(l.taux_tva)}` : ''}
                        </span>
                      )}
                      {/* Rapproché d'un emprunt : l'échéance qu'il paie, ou son déblocage — pas un « Rapproché » nu. */}
                      {l.statut === 'rapprochee' && l.emprunt_id && (
                        <span className="badge badge-ok">
                          {l.montant > 0 ? 'Déblocage d’emprunt' : `Échéance n° ${l.emprunt_echeance}`}
                          {empruntDuMouvement ? ` — ${empruntDuMouvement.nom}` : ''}
                        </span>
                      )}
                      {/* Ventilé : ses parts vivent à part, et la pastille en dit le nombre plutôt qu'un « Rapproché » nu. */}
                      {l.statut === 'rapprochee' && l.ventilee && (
                        <span className="badge badge-ok">
                          {(partsParLigne.get(l.id)?.length ?? 0) >= 2 ? `Ventilé sur ${partsParLigne.get(l.id)!.length} comptes` : 'Ventilé'}
                        </span>
                      )}
                      {/* Règle plusieurs pièces : ses parts vivent à part, et la pastille en dit le nombre — pas
                          sur une lecture partielle des parts, où il serait faux. */}
                      {l.statut === 'rapprochee' && l.reglement_groupe && (
                        <span className="badge badge-ok">
                          {!reglementsIncomplets && (reglementsParLigne.get(l.id)?.length ?? 0) >= 2
                            ? `Règle ${reglementsParLigne.get(l.id)!.length} pièces`
                            : 'Règle plusieurs pièces'}
                        </span>
                      )}
                      {!l.prelevement_personnel && l.statut === 'rapprochee' && !l.categorie_id && !l.emprunt_id && !l.ventilee && !l.reglement_groupe && !mouvementRapprocheSansObjet(l) && (
                        <span className="badge badge-ok">
                          Rapproché
                          {piecePayee ? ` — ${piecePayee.tiers ?? ''}` : ''}
                          {cotisationPayee ? ` — Cotisation du ${formatDate(cotisationPayee.echeance)}` : ''}
                        </span>
                      )}
                      {/* Une recette écrite sans taux sur un dossier assujetti : sa TVA n'est dans aucune CA3. */}
                      {idsRecettesSansTaux.has(l.id) && <span className="badge badge-danger">TVA à choisir</span>}
                      {/* Un rapprochement d'échéance qui ne peut pas s'écrire : ni au FEC, ni dans la 2035 à sa date. */}
                      {idsCotisationsRefusees.has(l.id) && <span className="badge badge-danger">Ne s’écrit pas</span>}
                      {/* Sous le seuil la pièce a été ALIGNÉE sur la banque, donc il ne reste aucun
                          écart à montrer. Au-dessus, on n'a rien écrasé — et sans cette pastille la
                          seule chose qui le dirait est le déséquilibre des écritures, qui n'existe
                          pas tant qu'elles n'ont pas été générées. Jugé sur le total payé de la pièce. */}
                      {pastillesPaiement.map((texte) => <span key={texte} className="badge badge-danger">{texte}</span>)}
                      {!l.prelevement_personnel && l.statut === 'non_rapprochee' && (
                        <span className="badge badge-warning">Non rapproché{aUneSuggestion ? ' · suggestion' : ''}</span>
                      )}
                      {!l.prelevement_personnel && l.statut === 'ignoree' && <span className="badge badge-neutral">Ignoré</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {ligneOuverte && mouvementVisible && (
        <PanneauDroit nom="mouvement">
          {/* `key` : un panneau par mouvement. Passer au suivant repart de SON état — le choix fait à
              la main dans la liste déroulante du précédent ne le suit pas. */}
          <FicheMouvement
            key={ligneOuverte.id}
            ligne={ligneOuverte}
            figeePar={dateFigee(ligneOuverte.date, anneesValidees)}
            pieces={pieces}
            piecesValidees={piecesValidees}
            cotisations={cotisations}
            categories={categories}
            regles={reglesAffectation}
            reglesIncompletes={reglesAffectationIncompletes}
            lignes={lignes}
            assujettiTva={assujettiTva}
            compteDirigeant={compteDuDirigeant(modele)}
            modeComptable={modele.mode}
            piecesRapprochees={piecesRapprochees}
            piecesFigees={piecesFigeesHorsRapprochement}
            cotisationsRapprochees={cotisationsRapprochees}
            recurrence={suggestionRecurrente(ligneOuverte)}
            navigation={navigationMouvement}
            occupe={actionMouvementEnCours || rapprochementAuto || affectationLotEnCours}
            onFermer={fermerMouvement}
            onRapprocher={(pieceId) => agirSurMouvement(() => rapprocher(ligneOuverte.id, pieceId))}
            onRapprocherCotisation={(cotisationId) => agirSurMouvement(() => rapprocherCotisation(ligneOuverte.id, cotisationId))}
            onVirementPersonnel={() => agirSurMouvement(() => marquerVirementPersonnel(ligneOuverte.id))}
            onIgnorer={() => agirSurMouvement(() => ignorer(ligneOuverte.id))}
            onToujoursIgnorer={() => agirSurMouvement(() => toujoursIgnorer(ligneOuverte))}
            onRemettreATraiter={() => agirSurMouvement(() => remettreATraiter(ligneOuverte.id))}
            onAffecter={(categorieId, motifRegle, taux) => agirSurMouvement(() => affecter(ligneOuverte, categorieId, motifRegle, taux))}
            onRetirerAffectation={() => agirSurMouvement(() => retirerAffectation(ligneOuverte.id))}
            emprunts={emprunts}
            empruntsIncomplets={empruntsIncomplets}
            onRapprocherEmprunt={(empruntId, decoupage) => agirSurMouvement(() => rapprocherEmprunt(ligneOuverte, empruntId, decoupage))}
            onRetirerEmprunt={() => agirSurMouvement(() => retirerEmprunt(ligneOuverte.id))}
            ventilations={partsParLigne.get(ligneOuverte.id) ?? []}
            ventilationsIncompletes={ventilationsIncompletes}
            onVentiler={(parts) => agirSurMouvement(() => ventiler(ligneOuverte, parts))}
            onRetirerVentilation={() => agirSurMouvement(() => retirerVentilation(ligneOuverte.id))}
            reglements={reglementsParLigne.get(ligneOuverte.id) ?? []}
            reglementsIncomplets={reglementsIncomplets}
            paiements={paiements}
            onReglerEnGroupe={(parts) => agirSurMouvement(() => reglerEnGroupe(ligneOuverte, parts))}
            onRetirerReglementGroupe={() => agirSurMouvement(() => retirerReglementGroupe(ligneOuverte.id))}
            restesAPayer={restesAPayer}
            payeesEnTrop={payeesEnTrop}
          />
        </PanneauDroit>
      )}
    </>
  )
}

// `lectureIncomplete` : ce que l'import ne peut pas voir. Le dédoublonnage compare le relevé aux
// mouvements LUS, et le statut de chaque ligne suit les règles LUES : sur une lecture tronquée, un
// mouvement déjà importé le serait une seconde fois — et aucun écran ne permet de retirer un
// mouvement bancaire. L'import se refuse donc, comme `chargerHashsExistants` lève plutôt que de
// laisser passer un fichier « pas encore importé » sur une liste d'empreintes incomplète.
//
// `frontiere` : un mouvement daté d'un exercice validé ne s'importe plus — la base refuserait le lot entier. Il est
// écarté et compté, comme un doublon, et l'alerte de fin d'import le dit : un relevé qui en porte, c'est un exercice
// validé auquel il manque des mouvements, et rien ne peut plus les y ajouter.
function ImportCsv({ dossierId, onImported, regles, lignesExistantes, lectureIncomplete, frontiere }: {
  dossierId: string; onImported: () => void; regles: RegleBancaireIgnoree[]; lignesExistantes: LigneBancaire[]
  lectureIncomplete: string | null; frontiere: string | null
}) {
  const [source, setSource] = useState<'csv' | 'pdf'>('csv')
  const [rows, setRows] = useState<string[][] | null>(null)
  const [colDate, setColDate] = useState(0)
  const [colLibelle, setColLibelle] = useState(1)
  const [mode, setMode] = useState<'signe' | 'debit_credit'>('signe')
  const [colMontant, setColMontant] = useState(2)
  const [colDebit, setColDebit] = useState(2)
  const [colCredit, setColCredit] = useState(3)
  const [hasHeader, setHasHeader] = useState(true)
  const [importing, setImporting] = useState(false)
  // Verrou d'exécution des deux imports : `importing` est un état React, qui ne prend effet qu'au
  // rendu suivant — deux clics du même rendu importaient deux fois le relevé entier, chacun
  // dédoublonnant contre la même liste d'avant.
  const importEnCours = useRef(false)
  const [error, setError] = useState<string | null>(null)

  const [pdfRows, setPdfRows] = useState<LigneExtraite[] | null>(null)
  // Les lignes brutes du PDF sont gardées telles quelles : changer le format du montant doit
  // pouvoir relire le relevé sans le redemander, et sans perdre les corrections déjà saisies moins
  // que de faire redéposer le fichier.
  const [pdfLignes, setPdfLignes] = useState<LignePdf[] | null>(null)
  const [pdfFormat, setPdfFormat] = useState<FormatMontant>('signe')
  const [pdfExtracting, setPdfExtracting] = useState(false)
  const [documentsReleve, setDocumentsReleve] = useState<DocumentDivers[]>([])
  // Tronquée, cette liste ne ment pas sur un montant : elle CACHE un relevé déjà classé, qu'on croit
  // alors devoir redemander au client ou redéposer.
  const [motifReleves, setMotifReleves] = useState<string | null>(null)
  // Nom du fichier en cours d'import (voir audit ergonomie) — persisté sur chaque ligne créée
  // (source_fichier) pour pouvoir retrouver le relevé d'origine plus tard, notamment quand le libellé
  // est retombé sur le générique "Mouvement bancaire".
  const [sourceFileName, setSourceFileName] = useState<string | null>(null)

  useEffect(() => {
    // Lue par tranches (voir lib/lectureComplete.ts) : un dossier accumule un relevé par mois et
    // par compte, et cette liste est celle où l'on vient rechercher un fichier à importer.
    lireTout<DocumentDivers>((debut, fin) =>
      supabase.from('documents_divers').select('*', { count: 'exact' })
        .eq('dossier_id', dossierId).eq('categorie', 'releve_bancaire').order('id').range(debut, fin),
    ).then((lecture) => {
      setDocumentsReleve(lecture.lignes)
      setMotifReleves(lecture.complete ? null : lecture.motif)
    })
  }, [dossierId])

  // Même Blob générique que handlePdfBlob ci-dessous : un fichier fraîchement déposé (File) ou un CSV
  // déjà classé dans l'archive Documents (Blob téléchargé du storage) suivent le même traitement.
  async function handleFile(blob: Blob, nom: string) {
    setError(null)
    setSourceFileName(nom)
    const text = await blob.text()
    const parsed = parseCsv(text)
    if (parsed.length === 0) {
      setError('Fichier vide ou illisible.')
      return
    }
    setRows(parsed)

    // Détection automatique du mapping de colonnes à partir du contenu — reste modifiable ensuite
    // si la banque a un format inhabituel que la détection n'aurait pas bien reconnu.
    const detected = detectColumnMapping(parsed)
    setColDate(detected.colDate)
    setColMontant(detected.colMontant)
    setColLibelle(detected.colLibelle)
    setHasHeader(detected.hasHeader)
    setMode('signe')
  }

  const dataRows = rows ? (hasHeader ? rows.slice(1) : rows) : []
  // Les lignes peuvent avoir des longueurs différentes selon les banques (ex. ligne de solde plus
  // courte que les lignes d'opérations) — on prend le plus grand nombre de colonnes observé.
  const nbColonnes = rows ? rows.reduce((max, r) => Math.max(max, r.length), 0) : 0

  // Point d'entrée commun, qu'il s'agisse d'un fichier fraîchement déposé (Blob = File) ou d'un
  // relevé déjà classé dans l'archive Documents (Blob téléchargé du storage) — même traitement.
  async function handlePdfBlob(blob: Blob, nom: string) {
    setError(null)
    setSourceFileName(nom)
    setPdfRows(null)
    setPdfLignes(null)
    setPdfExtracting(true)
    try {
      const lignes = await extractPdfLignes(blob)
      const extraites = parseLignesFromPdf(lignes, pdfFormat, 'tous')
      if (extraites.length === 0) {
        throw new Error("Aucune opération détectée dans ce PDF — la mise en page n'est peut-être pas reconnue. Essaie l'export CSV si la banque le propose.")
      }
      setPdfLignes(lignes)
      setPdfRows(extraites)
    } catch (err) {
      setError(messageErreur(err, 'Lecture du PDF impossible.'))
    } finally {
      setPdfExtracting(false)
    }
  }

  async function utiliserDocument(doc: DocumentDivers) {
    setError(null)
    setPdfExtracting(true)
    const { data, error: downloadError } = await supabase.storage.from('pieces').download(doc.storage_path)
    if (downloadError || !data) {
      setError("Impossible de récupérer ce document.")
      setPdfExtracting(false)
      return
    }
    await handlePdfBlob(data, doc.nom_fichier)
  }

  async function utiliserDocumentCsv(doc: DocumentDivers) {
    setError(null)
    const { data, error: downloadError } = await supabase.storage.from('pieces').download(doc.storage_path)
    if (downloadError || !data) {
      setError("Impossible de récupérer ce document.")
      return
    }
    await handleFile(data, doc.nom_fichier)
  }

  // Une même catégorie "relevé bancaire" peut désormais contenir des CSV et des PDF (classification
  // automatique par extension pour les CSV, voir DocumentsTab/ImportDossierModal) — chaque sous-onglet
  // ne doit proposer que les fichiers qu'il sait effectivement traiter.
  const documentsReleveCsv = documentsReleve.filter((d) => d.nom_fichier.toLowerCase().endsWith('.csv'))
  const documentsRelevePdf = documentsReleve.filter((d) => d.nom_fichier.toLowerCase().endsWith('.pdf'))

  function updatePdfRow(index: number, patch: Partial<LigneExtraite>) {
    setPdfRows((prev) => prev && prev.map((r, i) => (i === index ? { ...r, ...patch } : r)))
  }

  function removePdfRow(index: number) {
    setPdfRows((prev) => prev && prev.filter((_, i) => i !== index))
  }

  // Changer de format relit le relevé depuis les lignes brutes gardées en mémoire, plutôt que de
  // demander à nouveau le fichier. Les corrections déjà saisies dans le tableau sont perdues — le
  // format se choisit avant de corriger, pas après, et le dire vaut mieux que de tenter une fusion
  // qui donnerait un mélange des deux.
  function changerFormatPdf(format: FormatMontant) {
    setPdfFormat(format)
    if (pdfLignes) setPdfRows(parseLignesFromPdf(pdfLignes, format, 'tous'))
  }

  async function handleImportPdfRows() {
    if (!pdfRows || pdfRows.length === 0 || importEnCours.current) return
    if (lectureIncomplete) return
    importEnCours.current = true
    setImporting(true)
    setError(null)
    try {
      // Même dédoublonnage que l'import CSV (voir handleImport) — un relevé PDF redéposé par erreur
      // ne doit pas dupliquer chaque mouvement déjà en base.
      // Les lignes cochées « solde » ne sont pas des opérations : elles ne s'importent pas, elles
      // servent à contrôler le relevé. Le drapeau vit sur la ligne et non dans un jeu d'indices à
      // côté — retirer une ligne de l'aperçu décalerait sinon les suivantes, et le contrôle porterait
      // en silence sur les mauvais montants.
      const operations = pdfRows.filter((r) => !r.estSolde)
      const soldesDesignes = pdfRows.filter((r) => r.estSolde).map(({ date, montant }) => ({ date, montant }))

      const signaturesVues = new Set(lignesExistantes.map(signatureLigne))
      const aInserer: typeof pdfRows = []
      let doublons = 0
      let figees = 0
      for (const r of operations) {
        const sig = signatureLigne(r)
        if (signaturesVues.has(sig)) { doublons++; continue }
        signaturesVues.add(sig)
        if (estFigee(r.date, frontiere)) { figees++; continue }
        aInserer.push(r)
      }
      if (aInserer.length === 0) {
        throw new Error(figees > 0 && frontiere
          ? phraseLignesFigees(figees, frontiere, true, doublons)
          : "Ce relevé semble déjà importé (mêmes date, libellé et montant).")
      }

      const { error } = await supabase.from('lignes_bancaires').insert(
        aInserer.map((r) => ({
          dossier_id: dossierId, date: r.date, libelle: r.libelle, montant: r.montant,
          statut: statutPourLibelle(r.libelle, regles), source_fichier: sourceFileName,
        })),
      )
      if (error) throw error

      // Le chemin PDF n'avait AUCUN contrôle d'arithmétique : les lignes de solde étaient jetées au
      // parsing, donc rien ne vérifiait que le relevé bouclait. Elles sont maintenant relues à part.
      // `pdfRows` et non `aInserer` : le contrôle porte sur l'arithmétique DU RELEVÉ, donc les lignes
      // écartées comme déjà présentes en base en font partie — les retirer ferait apparaître un écart
      // qui n'existe pas dès qu'un relevé chevauche un import précédent (même raison que côté CSV).
      // `operations` et non `aInserer` : le contrôle porte sur l'arithmétique DU RELEVÉ, donc les
      // lignes écartées comme déjà présentes en base en font partie — les retirer ferait apparaître
      // un écart qui n'existe pas dès qu'un relevé chevauche un import précédent (comme côté CSV).
      const controlePdf = controlerSolde(soldesDesignes, operations)
      if (controlePdf) await enregistrerControleReleve(dossierId, sourceFileName, controlePdf)
      const alertePdf = controlePdf && !controlePdf.coherent
        ? `\n\n⚠ Ce relevé ne boucle pas.\nSolde d'ouverture ${controlePdf.soldeInitial.toFixed(2)} € + mouvements ${controlePdf.sommeMouvements.toFixed(2)} € = ${controlePdf.attendu.toFixed(2)} €, alors que le solde de clôture indique ${controlePdf.soldeFinal.toFixed(2)} €.\nÉcart de ${Math.abs(controlePdf.ecart).toFixed(2)} € : il manque probablement des opérations dans le fichier.`
        : ''

      setPdfRows(null)
      setPdfLignes(null)
      setSourceFileName(null)
      onImported()
      if (doublons > 0 || figees > 0 || alertePdf) {
        window.alert(`${aInserer.length} ligne(s) importée(s)${doublons > 0 ? `, ${doublons} déjà présente(s) ignorée(s)` : ''}${soldesDesignes.length > 0 ? `, ${soldesDesignes.length} ligne(s) de solde écartée(s)` : ''}.`
          + (figees > 0 && frontiere ? `\n\n${phraseLignesFigees(figees, frontiere, false)}` : '') + alertePdf)
      }
    } catch (err) {
      setError(messageErreur(err, "L'import a échoué."))
    } finally {
      importEnCours.current = false
      setImporting(false)
    }
  }

  async function handleImport() {
    if (!rows || importEnCours.current) return
    if (lectureIncomplete) return
    importEnCours.current = true
    setImporting(true)
    setError(null)
    try {
      const mapping = { colDate, colMontant, colLibelle, hasHeader }

      // Un relevé ne contient pas que des opérations : il porte aussi le solde d'ouverture et le
      // solde de clôture. Importées comme des mouvements, ces lignes faussent tous les totaux et ne
      // pourront jamais être rapprochées. Elles sont écartées de l'import — et servent juste après à
      // contrôler le relevé lui-même.
      const indicesSolde = new Set(lignesDeSolde(dataRows, mapping).map((l) => l.index))
      const soldes: { date: string; montant: number }[] = []

      const toInsert: { dossier_id: string; date: string; libelle: string; montant: number; statut: StatutLigneBancaire; source_fichier: string | null; libelle_brut: string | null }[] = []
      let ignorees = 0
      for (const [index, row] of dataRows.entries()) {
        const date = parseDateBancaire(row[colDate] ?? '')
        // Certaines banques laissent la colonne Libellé vide sur une partie des lignes (débits et
        // crédits dans deux colonnes distinctes, par exemple) : `libelleDeLigne` reconstitue alors le
        // texte depuis les autres colonnes, parce qu'un mouvement sans libellé est invisible pour la
        // recherche, les règles « toujours ignorer » et la détection de récurrence. Le générique ne
        // sert plus que si la ligne entière est vide en dehors de la date et du montant. La ligne
        // brute reste gardée à part (libelle_brut) pour pouvoir remonter à la source.
        // On ne rejette la ligne que si la date ou le montant, seuls champs réellement nécessaires,
        // sont illisibles.
        const libelle = libelleDeLigne(row, mapping) || 'Mouvement bancaire'
        let montant: number | null = null
        if (mode === 'signe') {
          montant = parseMontantBancaire(row[colMontant] ?? '')
        } else {
          const debit = parseMontantBancaire(row[colDebit] ?? '') ?? 0
          const credit = parseMontantBancaire(row[colCredit] ?? '') ?? 0
          montant = credit - Math.abs(debit)
        }
        if (!date || montant == null) {
          ignorees++
          continue
        }
        if (indicesSolde.has(index)) {
          soldes.push({ date, montant })
          continue
        }
        toInsert.push({
          dossier_id: dossierId, date, libelle, montant, statut: statutPourLibelle(libelle, regles),
          source_fichier: sourceFileName, libelle_brut: row.join(' | '),
        })
      }

      // Un relevé déposé deux fois (nouvelle tentative après un doute, mauvais fichier repris par
      // erreur...) dupliquerait sinon silencieusement chaque mouvement — même signature (date,
      // libellé, montant) qu'une ligne déjà en base, ou répétée dans ce même fichier.
      const signaturesVues = new Set(lignesExistantes.map(signatureLigne))
      const aInserer: typeof toInsert = []
      let doublons = 0
      let figees = 0
      for (const ligne of toInsert) {
        const sig = signatureLigne(ligne)
        if (signaturesVues.has(sig)) { doublons++; continue }
        signaturesVues.add(sig)
        if (estFigee(ligne.date, frontiere)) { figees++; continue }
        aInserer.push(ligne)
      }
      if (aInserer.length === 0) {
        throw new Error(figees > 0 && frontiere
          ? phraseLignesFigees(figees, frontiere, true, doublons)
          : doublons > 0 ? "Ce relevé semble déjà importé (mêmes date, libellé et montant)." : "Aucune ligne exploitable — vérifie le mapping des colonnes.")
      }

      const { error } = await supabase.from('lignes_bancaires').insert(aInserer)
      if (error) throw error

      setRows(null)
      setSourceFileName(null)
      onImported()
      const messages = [`${aInserer.length} ligne(s) importée(s)`]
      if (doublons > 0) messages.push(`${doublons} déjà présente(s), ignorée(s)`)
      if (figees > 0 && frontiere) messages.push(`${figees} datée(s) d’un exercice validé, non importée(s)`)
      if (ignorees > 0) messages.push(`${ignorees} ignorée(s) (date/montant illisible)`)
      if (soldes.length > 0) messages.push(`${soldes.length} ligne(s) de solde écartée(s)`)

      // Le contrôle que les lignes de solde rendent possible : solde d'ouverture + mouvements doit
      // donner le solde de clôture. Quand ça ne tombe pas juste, le relevé est incomplet — il vaut
      // mieux l'apprendre maintenant qu'après avoir bâti une comptabilité dessus.
      // `toInsert` et non `aInserer` : le contrôle vérifie l'arithmétique DU FICHIER. Les lignes
      // écartées comme déjà présentes en base en font partie ; les retirer de la somme ferait
      // apparaître un écart qui n'existe pas dès qu'un relevé chevauche un import précédent.
      const controle = controlerSolde(soldes, toInsert)
      // Conservé en base, et pas seulement annoncé : l'alerte ci-dessous disparaît au premier clic,
      // alors qu'un relevé qui ne boucle pas reste un problème tant qu'il n'est pas traité.
      if (controle) await enregistrerControleReleve(dossierId, sourceFileName, controle)
      const alerte = controle && !controle.coherent
        ? `\n\n⚠ Ce relevé ne boucle pas.\nSolde d'ouverture ${controle.soldeInitial.toFixed(2)} € + mouvements ${controle.sommeMouvements.toFixed(2)} € = ${controle.attendu.toFixed(2)} €, alors que le solde de clôture indique ${controle.soldeFinal.toFixed(2)} €.\nÉcart de ${Math.abs(controle.ecart).toFixed(2)} € : il manque probablement des opérations dans le fichier.`
        : ''
      if (doublons > 0 || ignorees > 0 || soldes.length > 0 || figees > 0 || alerte) {
        window.alert(messages.join(', ') + '.' + (figees > 0 && frontiere ? `\n\n${phraseLignesFigees(figees, frontiere, false)}` : '') + alerte)
      }
    } catch (err) {
      setError(messageErreur(err, "L'import a échoué."))
    } finally {
      importEnCours.current = false
      setImporting(false)
    }
  }

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <h3 style={{ marginTop: 0 }}>Importer un relevé bancaire</h3>
      {lectureIncomplete && (
        <p className="error-text">
          Import suspendu : une lecture est incomplète ({lectureIncomplete}). Le dédoublonnage ne
          verrait qu'une partie des mouvements déjà en base, et un mouvement importé une seconde fois
          ne pourrait plus être retiré. Recharge la page.
        </p>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <button type="button" className={`btn btn-sm ${source === 'csv' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setSource('csv')}>CSV</button>
        <button type="button" className={`btn btn-sm ${source === 'pdf' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setSource('pdf')}>PDF</button>
      </div>

      <BandeauLecturePartielle
        quoi="Les relevés déjà classés dans Documents"
        accord="lus"
        motif={motifReleves}
        consequence="Un relevé peut donc manquer à la liste ci-dessous sans être absent de Documents : s’il n’y apparaît pas, dépose le fichier directement."
      />

      {source === 'csv' && (
        <>
          {documentsReleveCsv.length > 0 && (
            <div className="field">
              <label>Déjà dans Documents</label>
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                {documentsReleveCsv.map((d) => (
                  <li key={d.id} style={{ marginBottom: 4 }}>
                    {d.nom_fichier}{' '}
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => utiliserDocumentCsv(d)}>
                      Utiliser ce relevé
                    </button>
                  </li>
                ))}
              </ul>
              <p className="muted" style={{ marginTop: 6 }}>— ou dépose un nouveau fichier :</p>
            </div>
          )}
          <div className="field">
            <input type="file" accept=".csv,text/csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f, f.name) }} />
          </div>
        </>
      )}

      {source === 'csv' && rows && (
        <>
          <p className="muted" style={{ marginTop: -4 }}>
            Mapping détecté automatiquement à partir du fichier — vérifie l'aperçu ci-dessous et corrige si besoin.
          </p>
          <div className="field">
            <label>
              <input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} style={{ marginRight: 6 }} />
              La première ligne est un en-tête
            </label>
          </div>

          <div className="table-scroll" style={{ marginBottom: 14, border: '1px solid var(--color-border)', borderRadius: 8 }}>
            <table>
              <tbody>
                {rows.slice(0, 4).map((r, i) => (
                  <tr key={i}>{r.map((cell, j) => <td key={j}>{cell}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="colDate">Colonne Date</label>
              <select id="colDate" value={colDate} onChange={(e) => setColDate(+e.target.value)}>
                {Array.from({ length: nbColonnes }).map((_, i) => <option key={i} value={i}>Colonne {i + 1}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="colLibelle">Colonne Libellé</label>
              <select id="colLibelle" value={colLibelle} onChange={(e) => setColLibelle(+e.target.value)}>
                {Array.from({ length: nbColonnes }).map((_, i) => <option key={i} value={i}>Colonne {i + 1}</option>)}
              </select>
            </div>
          </div>

          <div className="field">
            <label htmlFor="mode">Format du montant</label>
            <select id="mode" value={mode} onChange={(e) => setMode(e.target.value as 'signe' | 'debit_credit')}>
              <option value="signe">Une colonne (montant signé, négatif si débit)</option>
              <option value="debit_credit">Deux colonnes (Débit / Crédit séparées)</option>
            </select>
          </div>

          {mode === 'signe' ? (
            <div className="field">
              <label htmlFor="colMontant">Colonne Montant</label>
              <select id="colMontant" value={colMontant} onChange={(e) => setColMontant(+e.target.value)}>
                {Array.from({ length: nbColonnes }).map((_, i) => <option key={i} value={i}>Colonne {i + 1}</option>)}
              </select>
            </div>
          ) : (
            <div className="field-row">
              <div className="field">
                <label htmlFor="colDebit">Colonne Débit</label>
                <select id="colDebit" value={colDebit} onChange={(e) => setColDebit(+e.target.value)}>
                  {Array.from({ length: nbColonnes }).map((_, i) => <option key={i} value={i}>Colonne {i + 1}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="colCredit">Colonne Crédit</label>
                <select id="colCredit" value={colCredit} onChange={(e) => setColCredit(+e.target.value)}>
                  {Array.from({ length: nbColonnes }).map((_, i) => <option key={i} value={i}>Colonne {i + 1}</option>)}
                </select>
              </div>
            </div>
          )}

          <button className="btn btn-primary" onClick={handleImport} disabled={importing || lectureIncomplete !== null}>
            {importing ? 'Import…' : `Importer ${dataRows.length} ligne(s)`}
          </button>
        </>
      )}

      {source === 'pdf' && (
        <>
          {documentsRelevePdf.length > 0 && (
            <div className="field">
              <label>Déjà dans Documents</label>
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                {documentsRelevePdf.map((d) => (
                  <li key={d.id} style={{ marginBottom: 4 }}>
                    {d.nom_fichier}{' '}
                    <button type="button" className="btn btn-outline btn-sm" disabled={pdfExtracting} onClick={() => utiliserDocument(d)}>
                      Utiliser ce relevé
                    </button>
                  </li>
                ))}
              </ul>
              <p className="muted" style={{ marginTop: 6 }}>— ou dépose un nouveau fichier :</p>
            </div>
          )}
          <div className="field">
            <input type="file" accept=".pdf,application/pdf" onChange={(e) => { const f = e.target.files?.[0]; if (f) handlePdfBlob(f, f.name) }} />
          </div>
          <p className="muted" style={{ marginTop: -8 }}>
            Une ligne par opération détectée automatiquement (date + montant) — vérifie et corrige le tableau avant d'importer, l'extraction PDF est moins fiable qu'un CSV.
          </p>

          {pdfExtracting && <p className="muted">Lecture du PDF…</p>}

          {pdfRows && (
            <>
              <div className="field">
                <label htmlFor="pdfFormat">Format du montant</label>
                <select id="pdfFormat" value={pdfFormat} onChange={(e) => changerFormatPdf(e.target.value as FormatMontant)}>
                  <option value="signe">Une colonne (montant signé, négatif si débit)</option>
                  <option value="debit_credit">Deux colonnes (Débit / Crédit séparées)</option>
                </select>
              </div>
              {pdfFormat === 'debit_credit' && (
                <p className="muted" style={{ marginTop: -8 }}>
                  {pdfRows.every((r) => r.montant <= 0)
                    ? "Une seule colonne de montants trouvée sur ce relevé : impossible de dire laquelle, tout est passé en débit. Corrige les crédits ci-dessous."
                    : "Le débit et le crédit sont reconnus à la position du montant sur la ligne. Vérifie quand même quelques lignes."}
                </p>
              )}
              <p className="muted" style={{ marginTop: pdfFormat === 'debit_credit' ? 0 : -8 }}>
                Coche « Solde » sur les deux lignes qui portent le solde d'ouverture et le solde de
                clôture : elles ne seront pas importées comme des mouvements, et serviront à vérifier
                que le relevé boucle. Les banques qui écrivent le mot « solde » sont déjà cochées —
                la tienne écrit parfois le numéro de compte à la place, d'où la case.
                {(() => {
                  const coches = pdfRows.filter((r) => r.estSolde).length
                  if (coches === 2) return ' ✓ Deux soldes désignés : le relevé sera vérifié.'
                  if (coches === 0) return ' Aucun solde désigné pour l’instant : le relevé sera importé sans vérification.'
                  return ` ${coches} solde désigné : il en faut exactement deux (ouverture et clôture) pour que la vérification soit possible.`
                })()}
              </p>
              <div className="table-scroll" style={{ marginBottom: 14, border: '1px solid var(--color-border)', borderRadius: 8 }}>
                <table>
                  <thead><tr><th>Solde</th><th>Date</th><th>Libellé</th><th>Montant</th><th></th></tr></thead>
                  <tbody>
                    {pdfRows.map((r, i) => (
                      <tr key={i} style={r.estSolde ? { opacity: 0.6 } : undefined}>
                        <td style={{ textAlign: 'center' }}>
                          <input
                            type="checkbox"
                            checked={!!r.estSolde}
                            aria-label={`Ligne ${i + 1} : solde plutôt qu'opération`}
                            onChange={(e) => updatePdfRow(i, { estSolde: e.target.checked })}
                          />
                        </td>
                        <td><input type="date" value={r.date} onChange={(e) => updatePdfRow(i, { date: e.target.value })} style={{ width: 135 }} /></td>
                        <td><input value={r.libelle} onChange={(e) => updatePdfRow(i, { libelle: e.target.value })} style={{ width: '100%', minWidth: 180 }} /></td>
                        <td><input type="number" step="0.01" value={r.montant} onChange={(e) => updatePdfRow(i, { montant: parseFloat(e.target.value) || 0 })} style={{ width: 95 }} /></td>
                        <td><button type="button" className="btn btn-outline btn-sm" onClick={() => removePdfRow(i)}>Retirer</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button
                className="btn btn-primary"
                onClick={handleImportPdfRows}
                disabled={importing || lectureIncomplete !== null || pdfRows.filter((r) => !r.estSolde).length === 0}
              >
                {importing ? 'Import…' : `Importer ${pdfRows.filter((r) => !r.estSolde).length} ligne(s)`}
              </button>
            </>
          )}
        </>
      )}

      {error && <p className="error-text" style={{ marginTop: 12 }}>{error}</p>}
    </div>
  )
}
