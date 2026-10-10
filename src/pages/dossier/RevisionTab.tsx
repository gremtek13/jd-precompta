import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { lireTout } from '../../lib/lectureComplete'
import { messageErreur } from '../../lib/messageErreur'
import { anneeDe, anneeEtMoisEcoules, aujourdHuiAParis, formatDate, premierJourDuMoisCourant } from '../../lib/format'
import type { ModeleComptable } from '../../lib/engagement'
import { lireLaChecklist } from '../../lib/checklistLecture'
import { pointsDeLaChecklist, type DonneesDeLaChecklist } from '../../lib/pointsDeLaChecklist'
import { controlesPourLaRevision, type ControleExistant } from '../../lib/controlesDeLaRevision'
import {
  argumentsDeJustifierSolde, revisionDeLExercice, type CompteEnRevision, type ContexteDeJustification, type DecisionComposee,
  type DonneesDeLaRevision, type EtatDuSolde, type RevisionDeLExercice,
} from '../../lib/revision'
import { DESCRIPTION_DES_CYCLES, type CycleRevision } from '../../lib/revisionCycles'
import { soldeEnMots, type DocumentPourRevision, type TypeDeReference } from '../../lib/revisionPreuves'
import { CAUSES_DU_CYCLE, ETAT_DU_CYCLE, ETAT_DU_SOLDE, PASTILLE_DU_VERDICT } from '../../lib/revisionLibelles'
import {
  argumentsDeConclureCycle, argumentsDeNoterRevision, argumentsDeRevoirCycle, cyclesDeLExercice, type ConclusionComposee,
  type ContexteDesCycles, type CycleRevu, type CyclesDeLExercice, type EtatDuCycle, type ExercicePourLesCycles,
} from '../../lib/revisionRevue'
import type {
  AvisRevueRevision, ControleReleveBancaire, NatureNoteRevision, PeriodiciteTva, RevisionConclusion, RevisionJustification,
  RevisionNote, RevisionPreuve, RevisionRevue, SoldeReporte, StatutTva,
} from '../../lib/types'
import type { DossierTab } from '../../lib/ongletsDossier'
import { useAnnee } from '../../context/AnneeContext'
import { useExercicesValides } from '../../context/ExercicesValidesContext'
import { useAuth } from '../../context/AuthContext'
import { useGardePanneau, usePanneauDroit } from '../../lib/panneauDroit'
import PanneauDroit from '../../components/PanneauDroit'
import BandeauLecturePartielle, { type AccordLecture } from '../../components/BandeauLecturePartielle'
import KpiTile from '../../components/widgets/KpiTile'
import FicheSolde from './FicheSolde'
import FicheCycle, { type GesteDuCycle } from './FicheCycle'

// LA RÉVISION DES SOLDES DE BILAN D'UN EXERCICE (ligne 41, étape R3 ; conception du 09/10/2026, HISTORIQUE.md, « LA
// RÉVISION DES COMPTES : LA CONCEPTION », § 4.1 à 4.3). Chaque solde de bilan au 31 décembre se JUSTIFIE par une pièce,
// s'ACCEPTE sur motif ou se SIGNALE en anomalie — une décision datée, à son auteur, qui ne s'efface pas : elle se
// remplace, et l'historique reste. L'état d'un solde se DÉDUIT (lib/revision.ts) ; l'application PROPOSE une preuve
// (lib/revisionPreuves.ts) et ne décide jamais à la place du cabinet. Les comptes et les contrôles existants se rangent
// par cycle (lib/revisionCycles.ts) ; ceux de la Vue d'ensemble sont les MÊMES points, tirés des mêmes lectures
// (lib/checklistLecture.ts, lib/pointsDeLaChecklist.ts).
//
// TOUT SE LIT EN ENTIER, ET RIEN NE SE DIT SUR UNE LECTURE PARTIELLE : un état déduit d'une liste tronquée mentirait, et
// une décision est une écriture. Avant la première réponse, « Chargement… » ; sur une lecture partielle, le bandeau de
// chacune, et ni état, ni preuve, ni geste.
//
// UNE DÉCISION S'ÉCRIT PAR `justifier_solde` SEULE (base, étape R1), sous un verrou `useRef` relâché APRÈS la relecture :
// ses refus se disent avant le clic (lib/revision.ts, `refusDeJustifierSolde`), et la base reste juge.
//
// Les hypothèses de l'étape R1 sont celles de la base (Q2, Q3, Q7, Q8, Q11) ; l'écran n'en tranche aucune autre, et dit
// ce qui reste au jugement du cabinet.
//
// LES CYCLES (étape R4, phase C ; conception, § 4.4) : chaque carte porte aussi le TRAVAIL du cycle — son état DÉDUIT
// (`cyclesDeLExercice`, jamais stocké), sa conclusion courante, ce que l'exercice précédent a laissé à suivre — et son
// panneau (`FicheCycle`, volet `cycle`) le programme proposé, la conclusion, le journal et la revue du chef. Les trois
// tables de l'étape se lisent EN ENTIER avec le reste ; une conclusion, une note et une revue s'écrivent par
// `conclure_cycle`, `noter_revision` et `revoir_cycle` SEULES, sous un verrou `useRef` relâché après la relecture. La
// revue ne s'offre qu'au chef du cabinet (hypothèse Q2) ; la base le vérifie de toute façon.

interface MotifDeLecture { quoi: string; accord: AccordLecture; motif: string }

interface LectureDeLaRevision {
  checklist: DonneesDeLaChecklist
  reprise: DonneesDeLaRevision['reprise']
  reportes: SoldeReporte[]
  controlesReleves: ControleReleveBancaire[]
  documents: DocumentPourRevision[]
  decisions: RevisionJustification[]
  preuves: RevisionPreuve[]
  // Les tables des cycles (étape R4). Les lignes de `revision_notes` s'appellent ici le `journal`, comme dans le module :
  // une clé ou une lecture nommée `notes` serait comptée parmi les anciennes colonnes des notes internes.
  conclusions: RevisionConclusion[]
  journal: RevisionNote[]
  revues: RevisionRevue[]
  motifs: MotifDeLecture[]
}

// Tout ce que la révision lit du dossier : les lectures de la Vue d'ensemble — ses points s'y rangent, et le module y
// trouve le brouillon, la reprise, le relevé, les pièces, le registre, les emprunts, les déclarations et les catégories —,
// et ce qu'elles ne portent pas : les soldes reportés, les contrôles de TOUS les relevés, les documents, les décisions de
// la révision et leurs preuves. Le dossier ENTIER, tous exercices : l'ouverture lit ceux d'avant, la reprise le précédent,
// une citation sa source quel que soit son exercice.
async function lireLaRevision(dossierId: string): Promise<LectureDeLaRevision> {
  const [
    checklist, lectureReportes, lectureControles, lectureDocuments, lectureDecisions, lecturePreuves, lectureConclusions,
    lectureJournal, lectureRevues,
  ] = await Promise.all([
    lireLaChecklist(dossierId),
    lireTout<SoldeReporte>((debut, fin) =>
      supabase.from('soldes_reportes').select('*', { count: 'exact' })
        .eq('dossier_id', dossierId).order('date').order('compte').order('id').range(debut, fin),
    ),
    lireTout<ControleReleveBancaire>((debut, fin) =>
      supabase.from('controles_releves_bancaires').select('*', { count: 'exact' })
        .eq('dossier_id', dossierId).order('id').range(debut, fin),
    ),
    // Les colonnes que la révision lit, et le nom que l'écran montre : rien d'autre d'un document.
    lireTout<DocumentPourRevision>((debut, fin) =>
      supabase.from('documents_divers').select('id, nom_fichier, categorie, storage_hash', { count: 'exact' })
        .eq('dossier_id', dossierId).order('id').range(debut, fin),
    ),
    lireTout<RevisionJustification>((debut, fin) =>
      supabase.from('revision_justifications').select('*', { count: 'exact' })
        .eq('dossier_id', dossierId).order('id').range(debut, fin),
    ),
    lireTout<RevisionPreuve>((debut, fin) =>
      supabase.from('revision_preuves').select('*', { count: 'exact' })
        .eq('dossier_id', dossierId).order('id').range(debut, fin),
    ),
    // Les cycles, tous exercices : les points à suivre se lisent sur l'exercice précédent.
    lireTout<RevisionConclusion>((debut, fin) =>
      supabase.from('revision_conclusions').select('*', { count: 'exact' })
        .eq('dossier_id', dossierId).order('id').range(debut, fin),
    ),
    lireTout<RevisionNote>((debut, fin) =>
      supabase.from('revision_notes').select('*', { count: 'exact' })
        .eq('dossier_id', dossierId).order('id').range(debut, fin),
    ),
    lireTout<RevisionRevue>((debut, fin) =>
      supabase.from('revision_revues').select('*', { count: 'exact' })
        .eq('dossier_id', dossierId).order('id').range(debut, fin),
    ),
  ])
  // Chaque lecture a son bandeau : dire laquelle manque, c'est dire où chercher.
  const motifs: MotifDeLecture[] = []
  if (checklist.lectureIncomplete) motifs.push({ quoi: 'Les données du dossier', accord: 'lues', motif: checklist.lectureIncomplete })
  if (checklist.ouvertureIncomplete) motifs.push({ quoi: 'Les à-nouveaux du dossier', accord: 'lus', motif: checklist.ouvertureIncomplete })
  if (checklist.relevesIncoherents === null) {
    motifs.push({ quoi: 'Les relevés qui ne bouclent pas', accord: 'lus', motif: 'la lecture a échoué' })
  }
  if (checklist.doublonsTexte === null) {
    motifs.push({ quoi: 'Les doublons de contenu du dossier', accord: 'lus', motif: 'la lecture a échoué' })
  }
  if (checklist.infoInconnue) motifs.push({ quoi: 'Les informations complémentaires du dossier', accord: 'lues', motif: checklist.infoInconnue })
  if (checklist.clotureInconnue) motifs.push({ quoi: 'Les exercices clos du dossier', accord: 'lus', motif: checklist.clotureInconnue })
  if (lectureReportes.motif) motifs.push({ quoi: 'Les soldes reportés des exercices validés', accord: 'lus', motif: lectureReportes.motif })
  if (lectureControles.motif) motifs.push({ quoi: 'Les contrôles des relevés bancaires', accord: 'lus', motif: lectureControles.motif })
  if (lectureDocuments.motif) motifs.push({ quoi: 'Les documents du dossier', accord: 'lus', motif: lectureDocuments.motif })
  if (lectureDecisions.motif) motifs.push({ quoi: 'Les décisions de la révision', accord: 'lues', motif: lectureDecisions.motif })
  if (lecturePreuves.motif) motifs.push({ quoi: 'Les preuves citées par la révision', accord: 'lues', motif: lecturePreuves.motif })
  if (lectureConclusions.motif) motifs.push({ quoi: 'Les conclusions des cycles', accord: 'lues', motif: lectureConclusions.motif })
  if (lectureJournal.motif) motifs.push({ quoi: 'Le journal des cycles', accord: 'lu', motif: lectureJournal.motif })
  if (lectureRevues.motif) motifs.push({ quoi: 'Les revues des cycles', accord: 'lues', motif: lectureRevues.motif })
  return {
    checklist: { ...checklist, relevesIncoherents: checklist.relevesIncoherents ?? [], doublonsTexte: checklist.doublonsTexte ?? [] },
    reprise: checklist.aNouveaux,
    reportes: lectureReportes.lignes,
    controlesReleves: lectureControles.lignes,
    documents: lectureDocuments.lignes,
    decisions: lectureDecisions.lignes,
    preuves: lecturePreuves.lignes,
    conclusions: lectureConclusions.lignes,
    journal: lectureJournal.lignes,
    revues: lectureRevues.lignes,
    motifs,
  }
}

// L'avancement des cycles de l'exercice, en mots : « 9 cycles — revu : 1 ; en cours : 2 ; non commencé : 6. » L'état
// avant son nombre : il ne s'accorde pas.
function resumeDesCycles(avancement: Record<EtatDuCycle, number>): string {
  const total = Object.values(avancement).reduce((s, n) => s + n, 0)
  const parts = (Object.entries(avancement) as [EtatDuCycle, number][]).filter(([, n]) => n > 0)
    .map(([etat, n]) => `${ETAT_DU_CYCLE[etat].mot} : ${n}`)
  return `${total} cycle${total > 1 ? 's' : ''} — ${parts.join(' ; ')}.`
}

// Un résumé de l'avancement d'un cycle : « 3 soldes : 1 justifié, 2 à justifier ».
function resumeDeLAvancement(avancement: Record<EtatDuSolde, number>): string {
  const total = Object.values(avancement).reduce((s, n) => s + n, 0)
  const parts = (Object.entries(avancement) as [EtatDuSolde, number][]).filter(([, n]) => n > 0)
    .map(([etat, n]) => `${n} ${ETAT_DU_SOLDE[etat].mot}`)
  return `${total} solde${total > 1 ? 's' : ''} de bilan : ${parts.join(', ')}.`
}

export default function RevisionTab({ dossierId, modele, assujettiTva, periodiciteTva, statutTva, onNavigate }: {
  dossierId: string
  // Le modèle ENTIER, sans valeur par défaut : il décide des cycles du dossier (les tiers en engagement) et de ses
  // preuves, comme de ses points de contrôle.
  modele: ModeleComptable
  assujettiTva: boolean
  periodiciteTva: PeriodiciteTva
  statutTva: StatutTva | null
  onNavigate: (tab: DossierTab) => void
}) {
  const { annee } = useAnnee()
  const { exercices, frontiere } = useExercicesValides()
  const { session, estChef } = useAuth()
  const [lecture, setLecture] = useState<LectureDeLaRevision | null>(null)

  // La décision : un verrou d'exécution, posé avant le `try`, relâché après la relecture — un second clic du même
  // rendu enverrait une seconde décision, que la base refuserait (refus 10) sans que l'écran ait rien relu.
  const decisionEnCours = useRef(false)
  const [enCours, setEnCours] = useState(false)
  const [erreurDecision, setErreurDecision] = useState<{ compte: string; message: string } | null>(null)

  // « Vérifier l'empreinte » de l'exercice précédent (`verifier_exercice_valide`) : la preuve du 101000 la lit. Gardée
  // AVEC l'exercice vérifié : un autre exercice choisi en tête ne s'en sert pas.
  const verificationEnCours = useRef(false)
  const [verification, setVerification] = useState<{ annee: number; resultat: boolean | null } | null>(null)
  const [erreurVerification, setErreurVerification] = useState<string | null>(null)

  // Le panneau « justifier » vit dans le volet de droite ; sa garde retient une saisie non enregistrée.
  const panneau = usePanneauDroit('solde')
  const [compteOuvert, setCompteOuvert] = useState<string | null>(null)
  const ficheModifiee = useRef(false)
  const noterModification = useCallback((modifiee: boolean) => { ficheModifiee.current = modifiee }, [])
  const confirmerAbandon = useCallback(
    () => !ficheModifiee.current || window.confirm('La décision en cours de saisie n’est pas enregistrée. L’abandonner ?'),
    [],
  )
  useGardePanneau('solde', compteOuvert ? confirmerAbandon : null)

  // LE TRAVAIL D'UN CYCLE : un verrou d'exécution pour les trois fonctions, posé avant le `try` et relâché APRÈS la
  // relecture — un second clic du même rendu enverrait une seconde conclusion (que la base refuserait, refus 10), une
  // seconde note (qu'elle écrirait : le journal ne refuse pas un doublon) ou une seconde revue (refus 9). Une décision sur
  // un solde et le travail d'un cycle s'attendent l'un l'autre : chacun relit tout, et une relecture plus lente ne doit
  // pas écrire par-dessus celle qui suit l'autre écriture.
  const cycleEnCours = useRef(false)
  const [cycleOccupe, setCycleOccupe] = useState(false)
  const [erreurCycle, setErreurCycle] = useState<{ cycle: CycleRevision; geste: GesteDuCycle; message: string } | null>(null)
  const panneauCycle = usePanneauDroit('cycle')
  const [cycleOuvert, setCycleOuvert] = useState<CycleRevision | null>(null)
  const cycleModifie = useRef(false)
  const noterModificationDuCycle = useCallback((modifie: boolean) => { cycleModifie.current = modifie }, [])
  const confirmerAbandonDuCycle = useCallback(
    () => !cycleModifie.current || window.confirm('La saisie en cours sur ce cycle n’est pas enregistrée. L’abandonner ?'),
    [],
  )
  useGardePanneau('cycle', cycleOuvert ? confirmerAbandonDuCycle : null)

  useEffect(() => {
    let annule = false
    void lireLaRevision(dossierId).then((lue) => { if (!annule) setLecture(lue) })
    return () => { annule = true }
  }, [dossierId])

  async function decider(decision: DecisionComposee) {
    if (decisionEnCours.current || cycleEnCours.current || typeof annee !== 'number') return
    // Posé AVANT le `try` et avant le premier `await` : un verrou posé après ne verrouille rien.
    decisionEnCours.current = true
    setEnCours(true)
    setErreurDecision(null)
    try {
      const { error } = await supabase.rpc('justifier_solde', argumentsDeJustifierSolde(dossierId, annee, decision))
      if (error) {
        setErreurDecision({ compte: decision.compte, message: messageErreur(error, 'La décision n’a pas pu être enregistrée.') })
      } else {
        ficheModifiee.current = false
      }
      // Relue dans les deux cas, AVANT de relâcher le verrou : écrite, la décision paraît dans l'historique et l'état du
      // solde change ; refusée, la base a peut-être vu ce que l'écran n'avait pas lu (une autre décision, une écriture).
      setLecture(await lireLaRevision(dossierId))
    } finally {
      decisionEnCours.current = false
      setEnCours(false)
    }
  }

  async function conclure(cycle: CycleRevision, composee: ConclusionComposee): Promise<boolean> {
    if (cycleEnCours.current || decisionEnCours.current || typeof annee !== 'number') return false
    // Posé AVANT le `try` et avant le premier `await`.
    cycleEnCours.current = true
    setCycleOccupe(true)
    setErreurCycle(null)
    let ecrite = false
    try {
      const { error } = await supabase.rpc('conclure_cycle', argumentsDeConclureCycle(dossierId, annee, composee))
      if (error) {
        setErreurCycle({ cycle, geste: 'conclure', message: messageErreur(error, 'La conclusion n’a pas pu être enregistrée.') })
      } else {
        ecrite = true
      }
      // Relue dans les deux cas, AVANT de relâcher le verrou : écrite, elle devient la courante et l'état du cycle change ;
      // refusée, la base a peut-être vu ce que l'écran n'avait pas lu (une autre conclusion prise depuis).
      setLecture(await lireLaRevision(dossierId))
    } finally {
      cycleEnCours.current = false
      setCycleOccupe(false)
    }
    return ecrite
  }

  async function noter(cycle: CycleRevision, nature: NatureNoteRevision, texte: string): Promise<boolean> {
    if (cycleEnCours.current || decisionEnCours.current || typeof annee !== 'number') return false
    cycleEnCours.current = true
    setCycleOccupe(true)
    setErreurCycle(null)
    let ecrite = false
    try {
      const { error } = await supabase.rpc('noter_revision', argumentsDeNoterRevision(dossierId, annee, cycle, nature, texte))
      if (error) {
        setErreurCycle({ cycle, geste: 'noter', message: messageErreur(error, 'La note n’a pas pu être ajoutée au journal.') })
      } else {
        ecrite = true
      }
      setLecture(await lireLaRevision(dossierId))
    } finally {
      cycleEnCours.current = false
      setCycleOccupe(false)
    }
    return ecrite
  }

  async function revoir(cycle: CycleRevision, conclusionId: string, avis: AvisRevueRevision, observation: string | null): Promise<boolean> {
    if (cycleEnCours.current || decisionEnCours.current || typeof annee !== 'number') return false
    cycleEnCours.current = true
    setCycleOccupe(true)
    setErreurCycle(null)
    let ecrite = false
    try {
      const { error } = await supabase.rpc('revoir_cycle', argumentsDeRevoirCycle(dossierId, annee, conclusionId, avis, observation))
      if (error) {
        setErreurCycle({ cycle, geste: 'revoir', message: messageErreur(error, 'La revue n’a pas pu être enregistrée.') })
      } else {
        ecrite = true
      }
      setLecture(await lireLaRevision(dossierId))
    } finally {
      cycleEnCours.current = false
      setCycleOccupe(false)
    }
    return ecrite
  }

  async function verifierEmpreinte(anneeVerifiee: number) {
    if (verificationEnCours.current) return
    verificationEnCours.current = true
    setErreurVerification(null)
    try {
      const { data, error } = await supabase.rpc('verifier_exercice_valide', { p_dossier_id: dossierId, p_annee: anneeVerifiee })
      if (error) {
        setErreurVerification(messageErreur(error, 'L’empreinte n’a pas pu être vérifiée.'))
        return
      }
      // Vrai, faux, ou rien quand la base ne trouve pas l'exercice validé : le module lit les trois.
      setVerification({ annee: anneeVerifiee, resultat: data === true ? true : data === false ? false : null })
    } finally {
      verificationEnCours.current = false
    }
  }

  function ouvrir(compte: string) {
    if (panneau.ouvert && compteOuvert !== null && compteOuvert !== compte && !confirmerAbandon()) return
    if (!panneau.ouvrir()) return
    ficheModifiee.current = false
    setErreurDecision(null)
    setCompteOuvert(compte)
  }

  function fermer() {
    if (panneau.fermer()) setCompteOuvert(null)
  }

  function ouvrirCycle(cycle: CycleRevision) {
    if (panneauCycle.ouvert && cycleOuvert !== null && cycleOuvert !== cycle && !confirmerAbandonDuCycle()) return
    if (!panneauCycle.ouvrir()) return
    cycleModifie.current = false
    setErreurCycle(null)
    setCycleOuvert(cycle)
  }

  function fermerCycle() {
    if (panneauCycle.fermer()) setCycleOuvert(null)
  }

  if (!lecture) {
    return <div className="card"><p className="muted" style={{ margin: 0 }}>Chargement…</p></div>
  }
  if (lecture.motifs.length > 0) {
    return (
      <div className="card">
        {lecture.motifs.map((m) => (
          <BandeauLecturePartielle
            key={m.quoi}
            quoi={m.quoi}
            accord={m.accord}
            motif={m.motif}
            consequence="La révision ne dit rien d’une lecture incomplète — ni l’état d’un solde ou d’un cycle, ni sa preuve —, et n’offre aucune décision, conclusion, note ni revue. Recharge la page."
          />
        ))}
      </div>
    )
  }
  if (typeof annee !== 'number') {
    return (
      <div className="card">
        <p style={{ margin: 0 }}>La révision porte sur les soldes d’un exercice au 31 décembre : choisis-en un en tête du dossier.</p>
      </div>
    )
  }

  // « Aujourd'hui » se lit au rendu, jamais au chargement du module : la page ne se recharge pas d'un jour à l'autre. La
  // base lit l'année À PARIS ; la Vue d'ensemble compte ses mois comme elle l'a toujours fait (`anneeEtMoisEcoules`).
  const anneeCourante = anneeDe(aujourdHuiAParis())
  const { annee: anneeDesPoints, moisEcoules } = anneeEtMoisEcoules()
  const points = pointsDeLaChecklist(lecture.checklist, {
    assujettiTva, periodiciteTva, statutTva, modele, frontiere, anneeCourante: anneeDesPoints, moisEcoules,
    premierJourDuMois: premierJourDuMoisCourant(),
  })
  const pieces = [...lecture.checklist.piecesValidees, ...lecture.checklist.piecesAValider]
  const donnees: DonneesDeLaRevision = {
    annee, anneeCourante, modele, assujettiTva, periodiciteTva,
    ecritures: lecture.checklist.ecritures, reprise: lecture.reprise, reportes: lecture.reportes, exercicesValides: exercices,
    verificationPrecedent: verification !== null && verification.annee === annee - 1 ? verification.resultat : null,
    lignes: lecture.checklist.lignes, controlesReleves: lecture.controlesReleves, pieces, documents: lecture.documents,
    immobilisations: lecture.checklist.immobilisations, natures: lecture.checklist.natures, emprunts: lecture.checklist.emprunts,
    declarationsTva: lecture.checklist.declarationsTva, lectureIncomplete: null, categories: lecture.checklist.categories,
    decisions: lecture.decisions, preuves: lecture.preuves,
  }
  const revision = revisionDeLExercice(donnees, controlesPourLaRevision(points, annee))
  // Ce qu'il faut pour dire les refus de `justifier_solde` : l'accès est celui de la session — cet onglet ne s'ouvre que
  // sur un dossier que la base laisse lire au compte (`admin_du_dossier`, hypothèse Q2), et la base reste juge.
  const contexte: ContexteDeJustification = {
    accesAuDossier: true, anneeCourante, decisions: lecture.decisions, pieces, documents: lecture.documents,
    reprise: lecture.reprise, reportes: lecture.reportes, anneesValidees: exercices.map((e) => e.annee),
    ecritures: lecture.checklist.ecritures,
  }
  const valide = exercices.find((e) => e.annee === annee) ?? null
  const precedentValide = exercices.some((e) => e.annee === annee - 1)

  // Les cycles de l'exercice, leur état DÉDUIT (lib/revisionRevue.ts) : la lecture est entière à ce point — sinon l'écran
  // s'est arrêté à ses bandeaux.
  const cycles = cyclesDeLExercice(
    revision,
    { conclusions: lecture.conclusions, journal: lecture.journal, revues: lecture.revues, decisions: lecture.decisions },
    null,
    anneeCourante,
  )
  // Ce qu'il faut pour dire les refus des trois fonctions : l'accès comme pour les soldes ; le chef du cabinet tel que la
  // session le dit (le super-administrateur compris, comme `est_chef_du_cabinet`). La base reste juge.
  const contexteDesCycles: ContexteDesCycles = {
    accesAuDossier: true, chefDuCabinet: estChef, anneeCourante, conclusions: lecture.conclusions, revues: lecture.revues,
  }
  const cycleAffiche = cycleOuvert !== null && panneauCycle.ouvert ? cycles.cycles.find((x) => x.cycle === cycleOuvert) ?? null : null

  // Le nom de ce qu'une ligne de détail désigne : la preuve ne porte que des identifiants, jamais un texte saisi.
  function nommer(reference: { type: TypeDeReference; id: string }): string | null {
    const c = lecture?.checklist
    if (!c) return null
    switch (reference.type) {
      case 'releve': return lecture?.controlesReleves.find((r) => r.id === reference.id)?.source_fichier ?? null
      case 'mouvement': {
        const l = c.lignes.find((x) => x.id === reference.id)
        return l ? `${formatDate(l.date)} ${l.libelle}` : null
      }
      case 'ecriture': return c.ecritures.find((e) => e.id === reference.id)?.libelle ?? null
      case 'bien': return c.immobilisations.find((b) => b.id === reference.id)?.libelle ?? null
      case 'emprunt': return c.emprunts.find((e) => e.id === reference.id)?.nom ?? null
      case 'declaration': {
        const d = c.declarationsTva.find((x) => x.id === reference.id)
        return d ? `du ${formatDate(d.periode_debut)} au ${formatDate(d.periode_fin)}` : null
      }
      case 'a-nouveau': return lecture?.reprise.find((a) => a.id === reference.id)?.libelle ?? null
      case 'solde-reporte': return lecture?.reportes.find((s) => s.id === reference.id)?.libelle ?? null
    }
  }

  const compteAffiche = compteOuvert !== null && panneau.ouvert ? revision.comptes.find((c) => c.compte === compteOuvert) ?? null : null
  const raisonSansDecision = revision.message ?? null

  return (
    <>
      <EnTete
        annee={annee}
        revision={revision}
        cycles={cycles}
        valideLe={valide?.valide_le ?? null}
        precedentValide={precedentValide}
        verification={verification !== null && verification.annee === annee - 1 ? verification.resultat : undefined}
        erreurVerification={erreurVerification}
        onVerifier={() => verifierEmpreinte(annee - 1)}
        onNavigate={onNavigate}
      />

      {revision.exercice?.type === 'revisable' && (
        <div className="bento" style={{ marginTop: 20 }}>
          <div className="span-3">
            <KpiTile
              libelle="Soldes à justifier"
              valeur={revision.avancement['a-justifier']}
              statut={revision.avancement['a-justifier'] > 0 ? 'warning' : 'ok'}
              detail="sans décision, solde non nul"
            />
          </div>
          <div className="span-3">
            <KpiTile
              libelle="Justifiés ou acceptés"
              valeur={revision.avancement.justifie + revision.avancement.accepte}
              statut="neutral"
              detail={`dont ${revision.avancement.accepte} accepté${revision.avancement.accepte > 1 ? 's' : ''} sur motif`}
            />
          </div>
          <div className="span-3">
            <KpiTile
              libelle="À revoir"
              valeur={revision.avancement['a-revoir']}
              statut={revision.avancement['a-revoir'] > 0 ? 'warning' : 'ok'}
              detail="décision qui ne tient plus"
            />
          </div>
          <div className="span-3">
            <KpiTile
              libelle="Anomalies"
              valeur={revision.avancement.anomalie}
              statut={revision.avancement.anomalie > 0 ? 'danger' : 'ok'}
              detail="signalées par le cabinet"
            />
          </div>
        </div>
      )}

      {/* Les cycles que la révision des soldes retient, et ceux qu'une conclusion ou une note nomme : rien d'écrit ne se
          cache (`cyclesDeLExercice`). */}
      {cycles.cycles.map((revu) => {
        const soldes = revision.cycles.find((x) => x.cycle === revu.cycle)
        return (
          <CarteDuCycle
            key={revu.cycle}
            cycle={revu.cycle}
            annee={annee}
            comptes={(soldes?.comptes ?? []).map((compte) => revision.comptes.find((c) => c.compte === compte) as CompteEnRevision)}
            avancement={soldes?.avancement ?? null}
            controles={soldes?.controles ?? []}
            peutDecider={revision.peutDecider}
            revu={revu}
            exercice={cycles.exercice}
            onOuvrir={ouvrir}
            onOuvrirCycle={ouvrirCycle}
            onNavigate={onNavigate}
          />
        )
      })}

      {(revision.horsDuMotif.length > 0 || revision.controlesHorsCycle.length > 0 || revision.controlesInconnus.length > 0) && (
        <section className="card" style={{ marginTop: 20 }}>
          <h3 style={{ marginTop: 0 }}>Hors des cycles</h3>
          {revision.horsDuMotif.length > 0 && (
            <>
              <p className="muted">
                Ces comptes portent un solde sans être ni de bilan (classes 1 à 5) ni de résultat : aucun ne se justifie, et la
                validation de l’exercice les refuse.
              </p>
              <ul style={{ marginTop: 0, paddingLeft: 20 }}>
                {revision.horsDuMotif.map((h) => <li key={h.compte}>{`${h.compte} : ${soldeEnMots(h.soldeCentimes)}`}</li>)}
              </ul>
            </>
          )}
          {[...revision.controlesHorsCycle, ...revision.controlesInconnus].length > 0 && (
            <ListeDesControles controles={[...revision.controlesHorsCycle, ...revision.controlesInconnus]} onNavigate={onNavigate} />
          )}
        </section>
      )}

      {compteAffiche && (
        <PanneauDroit nom="solde">
          {/* `key` : un formulaire par compte, par exercice et par décision courante — une décision écrite repart d'une
              saisie vide, un refus garde la saisie pour la corriger. */}
          <FicheSolde
            key={`${annee}|${compteAffiche.compte}|${compteAffiche.chaine.courante?.id ?? ''}`}
            dossierId={dossierId}
            annee={annee}
            compte={compteAffiche}
            peutDecider={revision.peutDecider}
            raisonSansDecision={raisonSansDecision}
            contexte={contexte}
            pieces={pieces}
            documents={lecture.documents}
            preuves={lecture.preuves}
            valideLe={valide?.valide_le ?? null}
            utilisateur={session?.user.id ?? null}
            nommer={nommer}
            occupe={enCours || cycleOccupe}
            erreur={erreurDecision !== null && erreurDecision.compte === compteAffiche.compte ? erreurDecision.message : null}
            onDecider={decider}
            onModifiee={noterModification}
            onFermer={fermer}
          />
        </PanneauDroit>
      )}

      {cycleAffiche && cycles.exercice !== null && (
        <PanneauDroit nom="cycle">
          {/* `key` : une saisie par cycle et par exercice ; une conclusion, une note ou une revue écrite remet sa propre
              saisie à zéro, et laisse les autres. */}
          <FicheCycle
            key={`${annee}|${cycleAffiche.cycle}`}
            dossierId={dossierId}
            annee={annee}
            cycle={cycleAffiche}
            exercice={cycles.exercice}
            contexte={contexteDesCycles}
            utilisateur={session?.user.id ?? null}
            occupe={cycleOccupe || enCours}
            erreur={erreurCycle !== null && erreurCycle.cycle === cycleAffiche.cycle ? erreurCycle : null}
            onConclure={(composee) => conclure(cycleAffiche.cycle, composee)}
            onNoter={(nature, texte) => noter(cycleAffiche.cycle, nature, texte)}
            onRevoir={(conclusionId, avis, observation) => revoir(cycleAffiche.cycle, conclusionId, avis, observation)}
            onModifiee={noterModificationDuCycle}
            onFermer={fermerCycle}
          />
        </PanneauDroit>
      )}
    </>
  )
}

function EnTete({ annee, revision, cycles, valideLe, precedentValide, verification, erreurVerification, onVerifier, onNavigate }: {
  annee: number
  revision: RevisionDeLExercice<ControleExistant>
  cycles: CyclesDeLExercice
  valideLe: string | null
  precedentValide: boolean
  // La vérification de l'empreinte de l'exercice précédent : vrai, faux, rien (la base ne le trouve pas), ou pas faite.
  verification: boolean | null | undefined
  erreurVerification: string | null
  onVerifier: () => void
  onNavigate: (tab: DossierTab) => void
}) {
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>{`Révision des soldes de bilan au 31/12/${annee}`}</h3>
      {revision.message && <p className="error-text">{revision.message}</p>}
      {revision.exercice?.type === 'en-attente' && (
        <div style={{ marginBottom: 12 }}>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => onNavigate('cloture')}>
            {`Valider l’exercice ${annee - 1} dans Clôture`}
          </button>
        </div>
      )}
      <p className="muted">
        Chaque solde de bilan se justifie par une pièce ou un document, s’accepte sur motif, ou se signale en anomalie.
        L’application propose une preuve et dit ce qu’elle établit et ce qu’elle n’établit pas ; seul ton clic en fait une
        décision — datée, à ton nom, qui ne s’efface pas : elle se remplace par une autre, et l’historique reste.
      </p>
      <p className="muted">
        Chaque cycle se travaille sur son programme, se conclut — révisé, ou en anomalie —, garde son journal, et se revoit
        par le chef du cabinet ; le cycle « Ensemble » porte la synthèse.
        {cycles.cycles.length > 0 && ` Pour ${annee} : ${resumeDesCycles(cycles.avancement)}`}
      </p>
      {valideLe && (
        <p className="muted">
          {`L’exercice ${annee} est validé depuis le ${formatDate(valideLe)} : ses soldes sont définitifs. La révision reste ouverte, `
            + 'et une décision prise désormais le dit (« après la validation »).'}
        </p>
      )}
      {precedentValide && (
        <div style={{ marginBottom: 12 }}>
          <div className="fiche-mouvement-boutons">
            <button type="button" className="btn btn-outline btn-sm" onClick={onVerifier}>
              {`Vérifier l’empreinte de l’exercice ${annee - 1}`}
            </button>
          </div>
          {verification === true && (
            <p className="muted" style={{ marginBottom: 0 }}>{`L’exercice ${annee - 1} se relit tel qu’il a été validé : son empreinte est intacte.`}</p>
          )}
          {verification === false && (
            <p className="error-text" style={{ marginBottom: 0 }}>
              {`L’empreinte de l’exercice ${annee - 1} ne correspond plus à ce qu’il porte : l’ouverture de ${annee} ne se prouve pas par lui.`}
            </p>
          )}
          {verification === null && (
            <p className="muted" style={{ marginBottom: 0 }}>{`La base ne trouve pas l’exercice ${annee - 1} validé.`}</p>
          )}
          {erreurVerification && <p className="error-text" style={{ marginBottom: 0 }}>{erreurVerification}</p>}
        </div>
      )}
      <details>
        <summary>Ce que la révision ne tranche pas</summary>
        <ul style={{ margin: '8px 0 0', paddingLeft: 20, display: 'grid', gap: 6 }}>
          <li>La suffisance d’une preuve, le seuil de signification, l’explication d’un écart : ton jugement. L’application ne marque jamais un solde « justifié » d’elle-même, même quand sa preuve tombe juste au centime.</li>
          <li>La révision n’empêche pas encore de valider l’exercice (question Q1 au cabinet).</li>
          <li>Tout membre du cabinet affecté au dossier décide d’un solde et prépare un cycle ; seul le chef du cabinet revoit un cycle, et il peut revoir ce qu’il a préparé — la trace le dit (Q2, hypothèse en base).</li>
          <li>Le programme de chaque cycle est une proposition de l’application : le cocher, l’annoter, le compléter, et juger s’il suffit, c’est ton travail. Un travail non fait n’empêche pas de conclure.</li>
          <li>La mission (Q5) n’est pas tranchée : la conclusion envisagée d’une attestation s’écrit dans la conclusion du cycle « Ensemble ». Le dossier de travail ne se fige pas encore (Q6, étape R9).</li>
          <li>Un solde s’accepte sans pièce, sur un motif obligatoire (Q3, hypothèse en base).</li>
          <li>Une pièce ou un document cité ne se supprime plus, sauf avec son dossier (Q8, hypothèse en base).</li>
          <li>Seul un exercice terminé se révise (Q11, hypothèse en base).</li>
          <li>Les points de la Vue d’ensemble rangés sous chaque cycle portent sur tout le dossier ; les préalables de la validation n’y sont pas encore — ils se lisent dans Clôture.</li>
        </ul>
      </details>
    </div>
  )
}

function CarteDuCycle({
  cycle, annee, comptes, avancement, controles, peutDecider, revu, exercice, onOuvrir, onOuvrirCycle, onNavigate,
}: {
  cycle: CycleRevision
  annee: number
  comptes: CompteEnRevision[]
  // Nul pour un cycle que seule une conclusion ou une note nomme : la révision des soldes ne l'a pas retenu.
  avancement: Record<EtatDuSolde, number> | null
  controles: ControleExistant[]
  peutDecider: boolean
  revu: CycleRevu
  exercice: ExercicePourLesCycles | null
  onOuvrir: (compte: string) => void
  onOuvrirCycle: (cycle: CycleRevision) => void
  onNavigate: (tab: DossierTab) => void
}) {
  const description = DESCRIPTION_DES_CYCLES[cycle]
  const etat = ETAT_DU_CYCLE[revu.etat]
  const courante = revu.chaine.courante
  return (
    <section className="card" style={{ marginTop: 20 }} aria-label={`Cycle ${description.libelle}`}>
      <h3 style={{ marginTop: 0 }}>{description.libelle}</h3>
      {description.nonCouvert && <p className="muted">{description.nonCouvert}</p>}
      <TravailDuCycle revu={revu} libelle={description.libelle} etat={etat} courante={courante} exercice={exercice} onOuvrirCycle={onOuvrirCycle} />
      {comptes.length === 0 || avancement === null ? (
        cycle !== 'ensemble' && <p className="muted">{`Aucun solde de bilan de ce cycle au 31/12/${annee}.`}</p>
      ) : (
        <>
          <p className="muted">{resumeDeLAvancement(avancement)}</p>
          <div className="table-scroll tableau-adaptable">
            <table className="table-empilable">
              <thead>
                <tr><th>Compte</th><th>Solde au 31/12</th><th>Preuve proposée</th><th>État</th><th></th></tr>
              </thead>
              <tbody>
                {comptes.map((c) => (
                  <tr key={c.compte}>
                    {/* Le contenu de chaque cellule dans UNE `div` : repliée en fiche, la cellule est une rangée flex, et deux
                        enfants directs s'y serreraient côte à côte — le numéro du compte s'y coupait au milieu. */}
                    <td data-libelle="Compte">
                      <div>
                        <strong style={{ whiteSpace: 'nowrap' }}>{c.compte}</strong>
                        <div className="muted">{c.libelle}</div>
                      </div>
                    </td>
                    <td data-libelle="Solde au 31/12">{soldeEnMots(c.soldeCentimes)}</td>
                    <td data-libelle="Preuve proposée">
                      <div>
                        <span className={`badge ${PASTILLE_DU_VERDICT[c.preuve.verdict].classe}`}>{PASTILLE_DU_VERDICT[c.preuve.verdict].mot}</span>
                        <div className="muted">{c.preuve.resume}</div>
                      </div>
                    </td>
                    <td data-libelle="État">
                      <div>
                        <span className={`badge ${ETAT_DU_SOLDE[c.etat].classe}`}>{ETAT_DU_SOLDE[c.etat].mot}</span>
                        {(c.reprise || c.apresLaValidation || c.repriseDeLExercicePrecedent || c.chaine.decisions.length > 0) && (
                          <div className="muted">
                            {[
                              c.chaine.decisions.length > 0 ? `${c.chaine.decisions.length} décision${c.chaine.decisions.length > 1 ? 's' : ''}` : null,
                              c.repriseDeLExercicePrecedent ? `reprise de ${annee - 1}` : null,
                              c.apresLaValidation ? 'après la validation' : null,
                              c.reprise ? `justification de ${annee - 1} à reprendre` : null,
                            ].filter((x) => x !== null).join(' · ')}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="td-actions">
                      <button type="button" className="btn btn-outline btn-sm" aria-label={`Ouvrir le compte ${c.compte}`} onClick={() => onOuvrir(c.compte)}>
                        {peutDecider && (c.etat === 'a-justifier' || c.etat === 'a-revoir') ? 'Justifier' : 'Ouvrir'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {controles.length > 0 && (
        <>
          <h4 style={{ marginBottom: 4 }}>Ce que la Vue d’ensemble signale</h4>
          <ListeDesControles controles={controles} onNavigate={onNavigate} />
        </>
      )}
    </section>
  )
}

// Le travail du cycle, en tête de sa carte : son état déduit et ce qui le retient, la conclusion courante et sa revue, ce
// que l'exercice précédent a laissé à suivre — et le panneau, où tout se lit et se fait.
function TravailDuCycle({ revu, libelle, etat, courante, exercice, onOuvrirCycle }: {
  revu: CycleRevu
  libelle: string
  etat: { mot: string; classe: string }
  courante: CycleRevu['chaine']['courante']
  exercice: ExercicePourLesCycles | null
  onOuvrirCycle: (cycle: CycleRevision) => void
}) {
  // Les travaux non faits sont un constat, jamais un refus : la carte les compte, sans rien en conclure.
  const travaux = revu.programme !== null && revu.programme.lisible ? revu.programme.travaux.length : null
  const faits = travaux === null ? 0 : travaux - revu.travauxNonFaits
  const resume = [
    courante
      ? `Conclusion du ${formatDate(courante.cree_le)}${travaux === null ? '' : travaux === 0 ? ' — programme vide' : ` — programme : ${faits} fait${faits > 1 ? 's' : ''} sur ${travaux}`}`
      : null,
    revu.revue ? `revue le ${formatDate(revu.revue.revue.revu_le)}` : null,
    revu.journal.length > 0 ? `journal : ${revu.journal.length} note${revu.journal.length > 1 ? 's' : ''}` : null,
  ].filter((x) => x !== null)
  return (
    <div className="check-ligne" style={{ marginBottom: 12 }}>
      <div className="check-ligne-corps">
        <div className="check-ligne-libelle">
          <span className={`badge ${etat.classe}`}>{etat.mot}</span>
        </div>
        {revu.causes.length > 0 && (
          <div className="check-ligne-detail">{`Ce qui le retient : ${revu.causes.map((x) => CAUSES_DU_CYCLE[x]).join(' ; ')}.`}</div>
        )}
        {resume.length > 0 && <div className="check-ligne-detail">{resume.join(' · ')}</div>}
        {revu.pointsASuivre && (
          <div className="check-ligne-detail" style={{ whiteSpace: 'pre-wrap' }}>
            {`Laissé à suivre par ${revu.pointsASuivre.annee} : ${revu.pointsASuivre.texte}`}
          </div>
        )}
      </div>
      <button type="button" className="btn btn-outline btn-sm" aria-label={`Ouvrir le cycle ${libelle}`} onClick={() => onOuvrirCycle(revu.cycle)}>
        {exercice === 'ouvert' && courante === null ? 'Conclure' : 'Ouvrir le cycle'}
      </button>
    </div>
  )
}

function ListeDesControles({ controles, onNavigate }: { controles: ControleExistant[]; onNavigate: (tab: DossierTab) => void }) {
  return (
    <div>
      {controles.map((c) => (
        <div key={c.id} className="check-ligne">
          <span className={`check-dot ${c.gravite === 'erreur' ? 'check-manque' : 'check-attention'}`} />
          <div className="check-ligne-corps">
            <div className="check-ligne-libelle">{c.libelle}</div>
            {c.detail && <div className="check-ligne-detail">{c.detail}</div>}
          </div>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => onNavigate(c.cible)}>{c.action}</button>
        </div>
      ))}
    </div>
  )
}
