import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { analyserEcritures, ecrituresSansObjet, piecesAComptabiliser } from '../../lib/ecritures'
import type { ModeleComptable } from '../../lib/engagement'
import { categoriesSansCompte, categoriesSansPoste, detailPiecesSansDate, immobilisationsSansJustificatif, moisEnDoubleSurAbonnement, mouvementsRapprochesSansObjet, piecesADateImpossible, piecesDeviseNonConvertie, piecesPayeesEnPartie, piecesSansTva, piecesTvaImpossible, piecesValideesSansCategorie } from '../../lib/controles'
import { chargerRelevesIncoherents } from '../../lib/controlesReleves'
import { piecesMontantIntrouvableEnBanque } from '../../lib/appariementBanque'
import { rupturesPisteAudit } from '../../lib/pisteAudit'
import { idsMouvementsJustifiesParLeReleve, mouvementsAffectes, mouvementsAffectesDesynchronises, recettesAffecteesSansTaux } from '../../lib/affectationBanque'
import { virementsPersonnelsAEcrire } from '../../lib/virementPersonnel'
import { couvertureDuReleve, echeancesDesynchronisees, echeancesNonRapprochees } from '../../lib/echeanceEmprunt'
import { cotisationsAEcrire, rapprochementsCotisationRefuses } from '../../lib/cotisationRapprochee'
import { acquisitionsDesBiens, dotationsDuRegistre, dotationsEnDefaut } from '../../lib/amortissements'
import { forfaitsDuCadre7, forfaitsEnDefaut } from '../../lib/forfaitKilometrique'
import type { Emprunt } from '../../lib/emprunts'
import { chargerDoublonsDeTexte, type DoublonDeTexte } from '../../lib/doublonsTexte'
import { anneeDe, anneeEtMoisEcoules, formatDate, formatMoney } from '../../lib/format'
import { calculerEvolutionMensuelle, soldesFinDeMois } from '../../lib/tableauPilotage'
import { ouvertureBanque } from '../../lib/aNouveaux'
import type { OuvertureBanque } from '../../lib/planTresorerie'
import type {
  ANouveau, ControleReleveBancaire, Categorie, CotisationDeclaree, EcritureBrouillon, Immobilisation, InformationsDossier, LigneBancaire,
  NatureImmobilisation, Piece, ReglementGroupe, VehiculeDossier, VentilationBancaire,
} from '../../lib/types'
import { mouvementsVentilesDesynchronises, partsDesVentilations, recettesVentileesSansTaux, ventilationsIncoherentes } from '../../lib/ventilationBanque'
import { paiementsDesPieces, piecesPayees } from '../../lib/rattachement'
import { piecesPayeesEnTrop, reglementsGroupesIncoherents } from '../../lib/reglementGroupe'
import type { DossierTab } from '../../components/DossierParcours'
import KpiTile from '../../components/widgets/KpiTile'
import Widget from '../../components/widgets/Widget'
import ProgressRing from '../../components/widgets/ProgressRing'
import MonthlyBars from '../../components/widgets/MonthlyBars'
import BandeauLecturePartielle from '../../components/BandeauLecturePartielle'
import { lireTout } from '../../lib/lectureComplete'
import { lireAnneesCloturees } from '../../lib/clotureExercice'
import { chargerInformationsDossier } from '../../lib/informationsDossier'
import { exercicesAReclamer, moisManquantsDe, pointsUtiles, reserveCloturesInconnues } from '../../lib/resteAEnvoyer'
import { useExercicesValides } from '../../context/ExercicesValidesContext'

const NB_MOIS_TRESORERIE = 12
const NB_MOIS_COLONNES = 6

const NOMS_MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']

interface ItemChecklist {
  id: string
  label: string
  ok: boolean
  detail?: string
  cible?: DossierTab
  // Libellé du bouton d'action quand `cible` est renseigné — jamais le générique "Aller à l'onglet"
  // (voir PointATraiter, même principe).
  action?: string
  onToggle?: () => void
}

// Première page du dossier — ce qu'il reste à obtenir du client, en un coup d'œil (pastille verte /
// rouge) plutôt qu'à reconstituer en fouillant chaque onglet. Volontairement limité à ce qu'on peut
// vérifier de façon fiable sur des données déjà en base (comptage de mois/documents, mots-clés sur une
// nature d'immobilisation que le cabinet nomme lui-même) — jamais une lecture OCR devinée à l'aveugle.
// Les points qui ne se détectent pas de façon fiable (justificatif titres-restaurant reçu...) sont de
// simples cases à cocher manuellement, pas un faux positif automatique.
// `modele` : le modèle comptable du dossier (lib/engagement.ts), qui décide de ce que ses écritures
// doivent contenir — lues dans l'autre modèle, elles paraîtraient toutes « à régénérer ».
export default function ChecklistTab({ dossierId, assujettiTva, modele, onNavigate }: {
  dossierId: string
  assujettiTva: boolean
  modele: ModeleComptable
  onNavigate: (tab: DossierTab) => void
}) {
  // Ce que les exercices validés ont figé ne se compare plus : la base refuse de le réécrire, et le dire
  // « à régénérer » laisserait un point en erreur que rien ne lève (lib/validationExercice.ts).
  const { frontiere } = useExercicesValides()
  // Le nom dit le filtre, et ce n'est pas cosmétique : cet état s'appelait `pieces` alors qu'il ne
  // porte QUE les validées. Un contrôle branché dessus par réflexe devient muet sur tout ce qui est
  // encore à valider — c'est arrivé, sur `moisEnDoubleSurAbonnement`, dont les deux pièces du cas
  // réel sont justement « à valider ». Un piège qu'un nom honnête supprime vaut mieux qu'un piège
  // gardé par un contrôle.
  const [piecesValidees, setPiecesValidees] = useState<Piece[]>([])
  const [piecesAValider, setPiecesAValider] = useState<Piece[]>([])
  const [cotisations, setCotisations] = useState<CotisationDeclaree[]>([])
  const [lignes, setLignes] = useState<LigneBancaire[]>([])
  const [relevesIncoherents, setRelevesIncoherents] = useState<ControleReleveBancaire[]>([])
  const [doublonsTexte, setDoublonsTexte] = useState<DoublonDeTexte[]>([])
  const [immobilisations, setImmobilisations] = useState<Immobilisation[]>([])
  const [natures, setNatures] = useState<NatureImmobilisation[]>([])
  const [categories, setCategories] = useState<Categorie[]>([])
  const [ecritures, setEcritures] = useState<EcritureBrouillon[]>([])
  // Les emprunts : leurs échéances que le relevé couvre sans qu'aucun mouvement ne les paie sont un point
  // de cette liste, donc leur lecture rejoint `lectureIncomplete`.
  const [emprunts, setEmprunts] = useState<Emprunt[]>([])
  // Les parts des mouvements ventilés (lib/ventilationBanque.ts) : deux points de cette liste en dépendent,
  // et les catégories qu'elles désignent comptent parmi les catégories utilisées — donc le même drapeau.
  const [ventilations, setVentilations] = useState<VentilationBancaire[]>([])
  // Lues en partie, une part non lue ferait passer sa ventilation pour incohérente : ce point-là se tait
  // alors, et le bandeau de lecture partielle dit pourquoi — crier au loup sur un artefact de lecture est
  // ce que `rupturesPisteAudit` refuse déjà.
  const [ventilationsPartielles, setVentilationsPartielles] = useState(false)
  // Les parts des virements qui règlent PLUSIEURS pièces (lib/reglementGroupe.ts) : elles datent et règlent
  // leurs pièces comme des rapprochements simples, et deux points de cette liste en dépendent. Lues en
  // partie, une part non lue ferait passer son règlement pour incohérent : ce point-là se tait alors.
  const [reglements, setReglements] = useState<ReglementGroupe[]>([])
  const [reglementsPartiels, setReglementsPartiels] = useState(false)
  // Le relevé ou les parts des virements groupés lus en partie : un paiement non lu ferait passer une pièce
  // réglée pour payée en partie, donc ce point-là se tait.
  const [paiementsPartiels, setPaiementsPartiels] = useState(false)
  // Les lignes du cadre 7 (lib/forfaitKilometrique.ts) : le forfait de chacune doit être écrit au brouillon, et
  // ce point de la liste en dépend — donc le même drapeau que les autres collections.
  const [vehicules, setVehicules] = useState<VehiculeDossier[]>([])
  const [info, setInfo] = useState<InformationsDossier | null>(null)
  // Non nul = on ne SAIT PAS ce que le dossier porte comme informations. Sans ce drapeau, l'écran
  // qui prétend dire ce qui MANQUE affirmait « à renseigner » sur une lecture refusée — et passait
  // aussi sous silence les contrôles véhicule qui en dépendent.
  const [infoInconnue, setInfoInconnue] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  // Non nul quand l'une des grosses collections n'a pas pu être lue en entier : les points ci-dessous
  // portent alors sur une partie du dossier, et leur SILENCE ne prouve plus rien.
  const [lectureIncomplete, setLectureIncomplete] = useState<string | null>(null)
  // Exercices que le cabinet a marqués clos (voir lib/clotureExercice.ts) : c'est ce qui arrête la
  // réclamation des documents de l'exercice précédent. Une lecture refusée laisse la liste VIDE,
  // donc on continue de réclamer — jamais l'inverse (voir lib/resteAEnvoyer.ts).
  const [anneesCloturees, setAnneesCloturees] = useState<number[]>([])
  const [clotureInconnue, setClotureInconnue] = useState<string | null>(null)
  // Le solde de la banque à l'ouverture d'un dossier repris (voir lib/aNouveaux.ts) : la tuile de
  // trésorerie en part. À part de `lectureIncomplete`, qui parle des POINTS de la liste — l'ouverture n'en
  // commande que deux : les dotations aux amortissements (un exercice repris n'en demande pas) et
  // l'écriture de la facture d'un bien (un bien repris n'en demande pas). Lue à moitié, ils se TAISENT.
  const [ouverture, setOuverture] = useState<OuvertureBanque | null>(null)
  const [ouvertureIncomplete, setOuvertureIncomplete] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    const [
      lectureValidees,
      lectureAValider,
      lectureCotisations,
      lectureLignes,
      lectureImmobilisations,
      lectureNatures,
      lectureCategories,
      lectureEcritures,
      lectureInfos,
      clotures,
      lectureANouveaux,
      lectureEmprunts,
      lectureVentilations,
      lectureReglements,
      lectureVehicules,
    ] = await Promise.all([
      // Les quatre grosses collections sont lues par tranches, triées sur un ordre TOTAL : le
      // plafond de PostgREST ne se signale pas (voir lib/lectureComplete.ts), et cet écran est
      // précisément celui qui prétend dire ce qui MANQUE. Un contrôle qui ne voit qu'une partie du
      // dossier se tait sur le reste — et se taire est exactement ce qu'on attend de lui quand tout
      // va bien : la panne est indiscernable du succès.
      lireTout<Piece>((debut, fin) =>
        supabase.from('pieces').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).eq('statut', 'validee').order('id').range(debut, fin),
      ),
      lireTout<Piece>((debut, fin) =>
        supabase.from('pieces').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).eq('statut', 'a_valider').order('id').range(debut, fin),
      ),
      lireTout<CotisationDeclaree>((debut, fin) =>
        supabase.from('cotisations_declarees').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).order('id').range(debut, fin),
      ),
      lireTout<LigneBancaire>((debut, fin) =>
        supabase.from('lignes_bancaires').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).order('id').range(debut, fin),
      ),
      lireTout<Immobilisation>((debut, fin) =>
        supabase.from('immobilisations').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).order('id').range(debut, fin),
      ),
      lireTout<NatureImmobilisation>((debut, fin) =>
        supabase.from('natures_immobilisation').select('*', { count: 'exact' })
          .or(`dossier_id.eq.${dossierId},dossier_id.is.null`).order('id').range(debut, fin),
      ),
      lireTout<Categorie>((debut, fin) =>
        supabase.from('categories').select('*', { count: 'exact' })
          .or(`dossier_id.eq.${dossierId},dossier_id.is.null`).order('id').range(debut, fin),
      ),
      lireTout<EcritureBrouillon>((debut, fin) =>
        supabase.from('ecritures_brouillon').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).order('id').range(debut, fin),
      ),
      // Par le module partagé, qui REND son erreur : c'est la troisième copie de cette lecture
      // (InformationsTab et ClientInformations sont les deux autres), et la seule qui la jetait
      // encore — parce qu'une entrée de `Promise.all` s'écrit sans `await`, donc hors de portée du
      // scanner qui a corrigé les deux premières.
      chargerInformationsDossier(dossierId),
      lireAnneesCloturees(dossierId),
      lireTout<ANouveau>((debut, fin) =>
        supabase.from('a_nouveaux').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).order('compte').order('id').range(debut, fin),
      ),
      lireTout<Emprunt>((debut, fin) =>
        supabase.from('emprunts').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).order('date_debut').order('id').range(debut, fin),
      ),
      lireTout<VentilationBancaire>((debut, fin) =>
        supabase.from('ventilations_bancaires').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).order('id').range(debut, fin),
      ),
      lireTout<ReglementGroupe>((debut, fin) =>
        supabase.from('reglements_groupes').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).order('id').range(debut, fin),
      ),
      lireTout<VehiculeDossier>((debut, fin) =>
        supabase.from('vehicules').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).order('annee').order('id').range(debut, fin),
      ),
    ])
    // Best-effort, comme dans BanqueTab : l'échec est journalisé, jamais lu comme « aucun écart ».
    const controles = await chargerRelevesIncoherents(dossierId).catch((err) => {
      console.error(err)
      return [] as ControleReleveBancaire[]
    })
    setRelevesIncoherents(controles)
    // Même posture best-effort : journalisé, jamais lu comme « aucun doublon ».
    setDoublonsTexte(await chargerDoublonsDeTexte(dossierId).catch((err) => {
      console.error(err)
      return [] as DoublonDeTexte[]
    }))
    setPiecesValidees(lectureValidees.lignes)
    setPiecesAValider(lectureAValider.lignes)
    setCotisations(lectureCotisations.lignes)
    setLignes(lectureLignes.lignes)
    // TOUTES les collections dont dépend un point de cette liste, pas seulement les quatre grosses.
    // `categoriesSansCompte` et `categoriesSansPoste` partent des CATÉGORIES, `ecrituresSansObjet` des
    // IMMOBILISATIONS : une seule tronquée et le point
    // correspondant se TAIT — or se taire est exactement ce que cet écran fait quand tout va bien.
    // C'est le défaut de `ClotureTab`, qui refusait la 2035 « en n'ayant vérifié QUE les pièces ».
    setLectureIncomplete(
      [
        lectureValidees, lectureAValider, lectureCotisations, lectureLignes, lectureImmobilisations,
        lectureNatures, lectureCategories, lectureEcritures, lectureEmprunts, lectureVentilations, lectureReglements,
        lectureVehicules,
      ].find((l) => !l.complete)?.motif ?? null,
    )
    setVehicules(lectureVehicules.lignes)
    setReglements(lectureReglements.lignes)
    setReglementsPartiels(!lectureReglements.complete)
    setPaiementsPartiels(!lectureLignes.complete || !lectureReglements.complete)
    setEmprunts(lectureEmprunts.lignes)
    setVentilations(lectureVentilations.lignes)
    setVentilationsPartielles(!lectureVentilations.complete)
    setImmobilisations(lectureImmobilisations.lignes)
    setNatures(lectureNatures.lignes)
    setCategories(lectureCategories.lignes)
    setEcritures(lectureEcritures.lignes)
    setInfo(lectureInfos.informations)
    setInfoInconnue(lectureInfos.erreur)
    setAnneesCloturees(clotures.annees)
    setClotureInconnue(clotures.erreur)
    // Une ouverture lue à moitié donnerait un solde de départ faux : on n'en tire rien.
    setOuverture(lectureANouveaux.complete ? ouvertureBanque(lectureANouveaux.lignes) : null)
    setOuvertureIncomplete(lectureANouveaux.motif)
    setLoading(false)
  }

  useEffect(() => { load() }, [dossierId])

  async function toggleJustificatif(champ: 'justificatif_tickets_restaurant_recu' | 'justificatif_cheques_vacances_recu') {
    if (!info) return
    await supabase.from('informations_dossier').update({ [champ]: !info[champ] }).eq('id', info.id)
    load()
  }

  if (loading) {
    return (
      <div className="bento" aria-busy="true" aria-label="Chargement">
        <div className="skeleton skeleton-kpi span-3" />
        <div className="skeleton skeleton-kpi span-3" />
        <div className="skeleton skeleton-kpi span-3" />
        <div className="skeleton skeleton-kpi span-3" />
        <div className="skeleton skeleton-widget span-7" />
        <div className="skeleton skeleton-widget span-5" />
      </div>
    )
  }

  // Même instant pour les deux (voir anneeEtMoisEcoules) : « N mois écoulés » ne désigne des mois que
  // rapporté à SON année, et ces trois écrans doivent dire la même chose au même moment.
  const { annee: anneeCourante, moisEcoules } = anneeEtMoisEcoules()

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
  const aComptabiliser = piecesAComptabiliser(piecesJugees, categories, acquisitions)
  // Les paiements de chaque pièce — mouvements rapprochés et parts des virements groupés — décident de la
  // date qu'une écriture doit porter et de ses lignes de banque (lib/rattachement.ts). `lignes` porte tout
  // le relevé, et `paiementsDesPieces` n'en retient que les rapprochés.
  const paiements = paiementsDesPieces(lignes, reglements)
  const { nbSansContrepartie, groupesDesequilibres, piecesDesynchronisees } = analyserEcritures(ecritures, aComptabiliser, assujettiTva, paiements, modele, frontiere)
  const ecrituresSansObjetDuDossier = ecrituresSansObjet(ecritures, piecesJugees, categories, acquisitions, frontiere)
  // Les mouvements du relevé affectés à une catégorie sans justificatif (ligne 26.6) : leur écriture n'a
  // pas de pièce, par construction, et n'est pas une rupture de la piste d'audit.
  const affectes = mouvementsAffectes(lignes, categories, assujettiTva)
  const ruptures = rupturesPisteAudit(ecritures, idsMouvementsJustifiesParLeReleve(lignes))
  // L'écriture d'un mouvement affecté que son affectation ne produirait plus — la catégorie a changé de
  // compte depuis, ou la recette d'un dossier qui a cessé d'être assujetti porte encore sa TVA. Même
  // famille que les pièces « à régénérer », invisible de la même façon.
  const affectesPerimes = mouvementsAffectesDesynchronises(ecritures, affectes, frontiere)
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
  const cotisationsSansEcriture = cotisationsAEcrire(ecritures, lignes, cotisations, modele.mode, frontiere)
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
  // L'écriture d'une échéance rapprochée qui n'est plus celle de son découpage : défensif, la base les
  // écrivant ensemble — mais une écriture retirée par un autre chemin sortirait du FEC en silence.
  const echeancesPerimees = echeancesDesynchronisees(ecritures, lignes)
  const piecesConfianceBasse = piecesAValider.filter((p) => p.confiance === 'basse')
  // Les parts d'un mouvement ventilé désignent des catégories comme les mouvements affectés.
  // La facture d'un bien n'y compte pas : elle s'écrit sur le compte de sa nature, et la 2035 l'écarte.
  const catSansCompte = categoriesSansCompte(categories, piecesValidees, [...lignes, ...ventilations], pieceIdsImmobilisees)
  const catSansPoste = categoriesSansPoste(categories, piecesValidees, [...lignes, ...ventilations], pieceIdsImmobilisees)
  const sansTva = piecesSansTva(piecesValidees, assujettiTva)
  const sansCategorie = piecesValideesSansCategorie(piecesValidees, pieceIdsImmobilisees)
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
  // Sur les deux piles, validées comme à valider : une TVA arithmétiquement impossible l'est à tout
  // stade, et c'est avant la validation qu'il faut la voir — après, le chiffre est figé dans
  // l'écriture. Sans filtre sur l'assujettissement non plus : un montant impossible signale une
  // lecture ratée du document, et sur un dossier non assujetti c'est le TTC — donc la charge — qui
  // peut être faux (voir lib/controles.ts).
  const tvaImpossible = piecesTvaImpossible([...piecesValidees, ...piecesAValider])
  const deviseNonConvertie = piecesDeviseNonConvertie([...piecesValidees, ...piecesAValider])
  // Le pendant côté Banque de "en attente de rapprochement bancaire" ci-dessous (qui part des
  // écritures) : un mouvement bancaire importé mais jamais rattaché à une pièce, une cotisation, ou
  // marqué personnel/à ignorer — le seul cycle du dossier qui manquait encore à ce tableau de bord.
  const lignesNonRapprochees = lignes.filter((l) => l.statut === 'non_rapprochee')
  // L'AUTRE MOITIÉ, et celle qui ne se voyait nulle part : un mouvement que le dossier DIT rapproché
  // et qui ne désigne plus rien. Le point ci-dessus ne compte que les `non_rapprochee`, donc il se
  // tait exactement dessus — sur l'écran dont le métier est de dire ce qui manque. Voir
  // `mouvementsRapprochesSansObjet` : les deux clés du côté banque sont en `ON DELETE SET NULL`.
  const rapprochesSansObjet = mouvementsRapprochesSansObjet(lignes)
  // L'AUTRE MOITIÉ DE « LA BANQUE FAIT FOI » (décision du cabinet, 23/09/2026) : sous le seuil la
  // pièce est ALIGNÉE au rapprochement et il n'y a rien à dire ; au-dessus, un écart large est
  // presque toujours un paiement partiel, donc on le signale sans rien écraser. Jugé sur le TOTAL
  // payé de la pièce, pas mouvement par mouvement : une facture réglée en deux fois n'a rien à
  // reprendre. En trésorerie seulement — voir `piecesPayeesEnPartie`.
  const payeesEnPartie = paiementsPartiels ? [] : piecesPayeesEnPartie(piecesValidees, paiements, modele.mode)
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
    : dotationsEnDefaut(dotationsDuRegistre(immobilisations, natures, ecritures, ouverture?.date ?? null, anneeCourante, frontiere), anneeCourante)
  const exercicesDesDotations = [...new Set(dotationsManquantes.map((d) => d.annee))].sort((a, b) => a - b)
  // Les forfaits kilométriques qui manquent au brouillon, sur la même règle (lib/forfaitKilometrique.ts) : celui
  // d'un exercice FINI qui n'est pas écrit, et celui qui ne suit plus le cadre 7. La 2035 compte le forfait en
  // case BJ depuis le cadre 7, le FEC depuis le brouillon. Il dépend lui aussi de l'ouverture du dossier, avant
  // laquelle l'exercice est dans les comptes repris : lue à moitié, le point se tait.
  const forfaitsManquants = ouvertureIncomplete !== null
    ? []
    : forfaitsEnDefaut(forfaitsDuCadre7(vehicules, ecritures, modele, ouverture?.date ?? null, anneeCourante, frontiere), anneeCourante)
  const exercicesDesForfaits = [...new Set(forfaitsManquants.map((f) => f.vehicule.annee))].sort((a, b) => a - b)
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
  const payeesEnTrop = piecesPayeesEnTrop(piecesValidees, paiements)
  // `piecesValidees` et non `pieces` : ce contrôle ne vise que les pièces VALIDÉES, et son libellé le
  // dit. L'état s'appelait `pieces` quand ce point a été écrit, alors qu'il ne portait déjà que les
  // validées — c'est exactement le nom trompeur que le renommage a supprimé.
  const montantSuspect = piecesMontantIntrouvableEnBanque(piecesValidees.filter((p) => !piecesRapprocheesIds.has(p.id)), lignes)

  // "action" : le libellé du bouton, propre à chaque point plutôt qu'un "Aller à l'onglet" générique
  // répété sur toute la liste — dit ce que l'onglet cible va permettre de faire, pas juste où il est.
  // `detail` : une ligne d'instruction sous le libellé, pour les points dont le bouton ne suffit pas
  // à trouver ce qu'ils annoncent. Le cas qui l'a rendu nécessaire est `date-impossible` — voir
  // plus bas. La liste voisine (Paramétrage du dossier) portait déjà ce champ et son style.
  interface PointATraiter { id: string; label: string; action: string; nb: number; cible: DossierTab; severite: 'erreur' | 'attention'; detail?: string }
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
    // Plus de point « déclaration de TVA en écart avec le brouillon » (retiré le 28/09/2026) : le
    // brouillon date la TVA à la PIÈCE et ne porte aucune écriture pour un bien immobilisé, donc il
    // ne pouvait pas dire ce qu'une CA3 déposée sur les encaissements devait contenir — il aurait
    // crié à l'erreur sur des déclarations justes. L'onglet TVA compare chaque déclaration déposée au
    // calcul de SA période (lib/declarationTva.ts). Ne pas le remettre ici tant que la régularisation
    // d'une période déjà déposée (lignes 5B et 2C) n'est pas modélisée : l'écart y resterait
    // signalé en erreur même une fois régularisé.
    { id: 'confiance-basse', label: 'pièce(s) à faible confiance d\'extraction, à vérifier', action: 'Vérifier ces pièces', nb: piecesConfianceBasse.length, cible: 'pieces', severite: 'attention', detail: detailPiecesSansDate(piecesConfianceBasse) },
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
    // « Attention » et non « erreur » : c'est un travail en retard — le prélèvement est dans le relevé, à
    // traiter —, pas une donnée démontrée fausse. Mais il dit ce que le retard coûte.
    { id: 'echeances-emprunt-non-rapprochees', label: 'échéance(s) d’emprunt couverte(s) par le relevé sans mouvement rapproché — intérêts non comptés', action: 'Rapprocher ces prélèvements', nb: echeancesManquantes.length, cible: 'banque', severite: 'attention' },
  ]
  const pointsATraiter = tousLesPointsATraiter.filter((p) => p.nb > 0)
  // Trois groupes distincts (voir audit ergonomie) plutôt qu'un seul total mélangeant des natures très
  // différentes ("315 à vérifier" ne dit rien d'actionnable si 312 sont des lignes bancaires courantes
  // et 3 des vraies erreurs) : paramétrage (config à finir une fois, ne dépend pas du client), travail
  // courant du cabinet (à traiter au fil de l'eau), documents attendus (dépend du client, voir `items`
  // plus bas). Un déséquilibre ou une désynchronisation reste plus urgent qu'une case de paramétrage,
  // d'où la sévérité conservée à l'intérieur du groupe "Travail à effectuer".
  const IDS_PARAMETRAGE = new Set(['comptes-manquants', 'postes-manquants'])
  const pointsParametrage = pointsATraiter.filter((p) => IDS_PARAMETRAGE.has(p.id))
  const pointsTravail = pointsATraiter.filter((p) => !IDS_PARAMETRAGE.has(p.id))

  // UN JEU DE POINTS PAR EXERCICE RÉCLAMÉ. Au 1er janvier, l'exercice révolu reste réclamé en entier
  // tant que sa clôture n'est pas cochée — c'est le moment précis où le cabinet court après ses
  // pièces, et où cette liste repartait à zéro en annonçant qu'il ne restait rien.
  const pointsParExercice = exercices.flatMap((ex): (ItemChecklist & { annee: number })[] => {
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
  const items: ItemChecklist[] = pointsUtiles(pointsParExercice, anneeCourante)

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
        onToggle: () => toggleJustificatif('justificatif_tickets_restaurant_recu'),
      })
    }
    if (info.cheques_vacances) {
      items.push({
        id: 'vacances',
        label: 'Justificatif chèques-vacances reçu',
        ok: info.justificatif_cheques_vacances_recu,
        detail: 'À cocher une fois le justificatif obtenu du client',
        onToggle: () => toggleJustificatif('justificatif_cheques_vacances_recu'),
      })
    }
  }

  const nbManquants = items.filter((i) => !i.ok).length
  const nbOk = items.length - nbManquants

  // Tendances de trésorerie (compte 512 du brouillon d'écritures, voir lib/tableauPilotage) —
  // indépendantes de l'exercice sélectionné dans l'en-tête : une pente récente reste utile même en
  // consultant une année passée.
  const soldes = soldesFinDeMois(ecritures, NB_MOIS_TRESORERIE, ouverture)
  const soldeActuel = soldes.length > 0 ? soldes[soldes.length - 1].solde : null
  const soldePrecedent = soldes.length > 1 ? soldes[soldes.length - 2].solde : null
  const variationSolde = soldeActuel !== null && soldePrecedent !== null ? soldeActuel - soldePrecedent : null
  const evolutionMensuelle = calculerEvolutionMensuelle(ecritures, NB_MOIS_COLONNES)
  const nbErreurs = pointsTravail.filter((p) => p.severite === 'erreur').length

  // Liste de points (Paramétrage / Travail à effectuer) : même présentation pour les deux, un compteur
  // séparé par groupe plutôt qu'un total unique mélangeant leurs natures (voir audit ergonomie). Les
  // lignes sont juste séparées par un filet, la couleur réservée à la pastille de chaque ligne plutôt
  // qu'à la bordure entière du bloc.
  function listePoints(points: PointATraiter[], texteVide: string) {
    if (points.length === 0) return <p className="widget-vide">{texteVide}</p>
    return (
      <div>
        {points.map((p) => (
          <div key={p.id} className="check-ligne">
            <span className={`check-dot ${p.severite === 'erreur' ? 'check-manque' : 'check-attention'}`} />
            <div className="check-ligne-corps">
              <div className="check-ligne-libelle">{p.nb} {p.label}</div>
              {p.detail && <div className="check-ligne-detail">{p.detail}</div>}
            </div>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => onNavigate(p.cible)}>
              {p.action}
            </button>
          </div>
        ))}
      </div>
    )
  }

  return (
    <>
      <BandeauLecturePartielle
        quoi="Les données du dossier"
        motif={lectureIncomplete}
        consequence={
          'Les points ci-dessous portent donc sur une partie du dossier : leur SILENCE ne prouve ' +
          'plus rien. Recharge la page avant de t’y fier.'
        }
      />
      <BandeauLecturePartielle
        quoi="Les à-nouveaux du dossier"
        accord="lus"
        motif={ouvertureIncomplete}
        consequence={
          'La tuile Trésorerie ne peut donc pas partir du solde repris : elle n’affiche aucun montant, ' +
          'plutôt qu’un solde faux — et un rouge faux. Et les points qui en dépendent se taisent : les ' +
          'dotations aux amortissements, les forfaits kilométriques, et l’écriture de la facture d’un bien — ' +
          'c’est l’ouverture qui dit ce qui est déjà dans la balance reprise. Recharge la page.'
        }
      />
      {reserveCloturesInconnues(clotureInconnue, anneeCourante, { technique: true }) && (
        <p className="error-text">{reserveCloturesInconnues(clotureInconnue, anneeCourante, { technique: true })}</p>
      )}
      {infoInconnue && (
        <p className="error-text">
          {infoInconnue} Les points qui en dépendent sont donc absents de la liste ci-dessous —
          véhicule, tickets restaurant, chèques vacances : ni réclamés, ni déclarés à jour.
        </p>
      )}
      <div className="bento">
        <div className="span-3">
          <KpiTile
            libelle="Pièces à valider"
            valeur={piecesAValider.length}
            statut={piecesAValider.length > 0 ? 'warning' : 'ok'}
            detail={piecesConfianceBasse.length > 0 ? `dont ${piecesConfianceBasse.length} à faible confiance` : 'extraction vérifiée'}
            onClick={() => onNavigate('pieces')}
          />
        </div>
        <div className="span-3">
          {/* Une ouverture illisible ne laisse ni montant ni couleur : un dossier repris compté depuis
              zéro passerait au rouge sur un compte qui porte de l'argent. */}
          <KpiTile
            libelle="Trésorerie (brouillon)"
            valeur={ouvertureIncomplete !== null || soldeActuel === null ? '—' : formatMoney(soldeActuel)}
            statut={ouvertureIncomplete !== null || soldeActuel === null ? 'neutral' : soldeActuel < 0 ? 'danger' : 'ok'}
            delta={ouvertureIncomplete !== null || variationSolde === null ? undefined : { texte: `${variationSolde >= 0 ? '+' : '−'}${formatMoney(Math.abs(variationSolde))} sur le mois`, positif: variationSolde >= 0 }}
            detail={
              ouvertureIncomplete !== null ? 'ouverture illisible'
                : soldeActuel === null ? 'aucune écriture bancaire'
                : ouverture ? `depuis l’ouverture du ${formatDate(ouverture.date)}`
                : `${soldes.length} mois d'écritures`
            }
            tendance={ouvertureIncomplete !== null ? [] : soldes.map((s) => s.solde)}
            onClick={() => onNavigate('ecritures')}
          />
        </div>
        <div className="span-3">
          <KpiTile
            libelle={`Relevés ${anneeCourante}`}
            valeur={moisEcoules === 0 ? '—' : <>{moisRecus}<small>/ {moisEcoules}</small></>}
            statut={moisEcoules === 0 ? 'neutral' : moisManquants.length > 0 ? 'warning' : 'ok'}
            detail={moisEcoules === 0 ? 'aucun mois encore révolu' : moisManquants.length > 0 ? `${moisManquants.length} mois manquant(s)` : 'tous les mois reçus'}
            onClick={() => onNavigate('banque')}
          />
        </div>
        <div className="span-3">
          <KpiTile
            libelle="Anomalies"
            valeur={pointsTravail.reduce((s, p) => s + p.nb, 0)}
            statut={nbErreurs > 0 ? 'danger' : pointsTravail.length > 0 ? 'warning' : 'ok'}
            detail={nbErreurs > 0 ? `${nbErreurs} type(s) d'erreur bloquante` : pointsTravail.length > 0 ? 'à traiter au fil de l\'eau' : 'rien à signaler'}
          />
        </div>

        <Widget
          className="span-7"
          titre="Travail à effectuer"
          sousTitre="Anomalies détectées dans Pièces, Écritures, Banque et Clôture — rassemblées ici"
        >
          {listePoints(pointsTravail, "Rien à signaler pour l'instant — aucune anomalie détectée.")}
        </Widget>

        {/* Ce qui dépend du client (documents), pas du cabinet — sur une échelle différente des
            anomalies internes, d'où un widget à part plutôt qu'un total combiné. */}
        <Widget
          className="span-5"
          titre="Documents attendus"
          sousTitre="Ce que le dossier attend du client"
          action={<ProgressRing ratio={items.length > 0 ? nbOk / items.length : 1} statut={nbManquants > 0 ? 'warning' : 'ok'} taille={56} epaisseur={6} libelle={`${nbOk} sur ${items.length} reçus`} />}
        >
          <div>
            {items.map((item) => (
              <div key={item.id} className="check-ligne">
                <button
                  type="button"
                  className={`check-dot ${item.ok ? '' : 'check-manque'} ${item.onToggle ? 'check-cliquable' : ''}`}
                  onClick={item.onToggle}
                  disabled={!item.onToggle}
                  title={item.onToggle ? 'Cliquer pour marquer comme reçu/non reçu' : undefined}
                  aria-label={item.ok ? 'Reçu' : 'Manquant'}
                />
                <div className="check-ligne-corps">
                  <div className="check-ligne-libelle">{item.label}</div>
                  {item.detail && <div className="check-ligne-detail">{item.detail}</div>}
                </div>
                {item.cible && !item.ok && (
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => onNavigate(item.cible!)}>
                    {item.action ?? 'Voir'}
                  </button>
                )}
              </div>
            ))}
          </div>
        </Widget>

        <Widget
          className="span-7"
          titre="Encaissements et décaissements"
          sousTitre={`${NB_MOIS_COLONNES} derniers mois d'écritures bancaires (compte 512 du brouillon)`}
          action={<button type="button" className="btn btn-outline btn-sm" onClick={() => onNavigate('statistiques')}>Balance</button>}
        >
          {evolutionMensuelle.length === 0 ? (
            <p className="widget-vide">Aucune écriture bancaire générée pour l'instant — ce graphique se remplira au fil des écritures.</p>
          ) : (
            <MonthlyBars mois={evolutionMensuelle} />
          )}
        </Widget>

        <Widget className="span-5" titre="Paramétrage à compléter" sousTitre="Configuration à finir une fois, indépendante du client">
          {listePoints(pointsParametrage, 'Rien à compléter — comptes et postes 2035 sont renseignés.')}
        </Widget>
      </div>
    </>
  )
}
