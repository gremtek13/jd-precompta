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
import { ETAT_DU_SOLDE, PASTILLE_DU_VERDICT } from '../../lib/revisionLibelles'
import type {
  ControleReleveBancaire, PeriodiciteTva, RevisionJustification, RevisionPreuve, SoldeReporte, StatutTva,
} from '../../lib/types'
import type { DossierTab } from '../../lib/ongletsDossier'
import { useAnnee } from '../../context/AnneeContext'
import { useExercicesValides } from '../../context/ExercicesValidesContext'
import { useAuth } from '../../context/AuthContext'
import { useGardePanneau, usePanneauDroit } from '../../lib/panneauDroit'
import PanneauDroit from '../../components/PanneauDroit'
import BandeauLecturePartielle from '../../components/BandeauLecturePartielle'
import KpiTile from '../../components/widgets/KpiTile'
import FicheSolde from './FicheSolde'

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

interface MotifDeLecture { quoi: string; accord: 'lues' | 'lus' | 'lue'; motif: string }

interface LectureDeLaRevision {
  checklist: DonneesDeLaChecklist
  reprise: DonneesDeLaRevision['reprise']
  reportes: SoldeReporte[]
  controlesReleves: ControleReleveBancaire[]
  documents: DocumentPourRevision[]
  decisions: RevisionJustification[]
  preuves: RevisionPreuve[]
  motifs: MotifDeLecture[]
}

// Tout ce que la révision lit du dossier : les lectures de la Vue d'ensemble — ses points s'y rangent, et le module y
// trouve le brouillon, la reprise, le relevé, les pièces, le registre, les emprunts, les déclarations et les catégories —,
// et ce qu'elles ne portent pas : les soldes reportés, les contrôles de TOUS les relevés, les documents, les décisions de
// la révision et leurs preuves. Le dossier ENTIER, tous exercices : l'ouverture lit ceux d'avant, la reprise le précédent,
// une citation sa source quel que soit son exercice.
async function lireLaRevision(dossierId: string): Promise<LectureDeLaRevision> {
  const [checklist, lectureReportes, lectureControles, lectureDocuments, lectureDecisions, lecturePreuves] = await Promise.all([
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
  return {
    checklist: { ...checklist, relevesIncoherents: checklist.relevesIncoherents ?? [], doublonsTexte: checklist.doublonsTexte ?? [] },
    reprise: checklist.aNouveaux,
    reportes: lectureReportes.lignes,
    controlesReleves: lectureControles.lignes,
    documents: lectureDocuments.lignes,
    decisions: lectureDecisions.lignes,
    preuves: lecturePreuves.lignes,
    motifs,
  }
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
  const { session } = useAuth()
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

  useEffect(() => {
    let annule = false
    void lireLaRevision(dossierId).then((lue) => { if (!annule) setLecture(lue) })
    return () => { annule = true }
  }, [dossierId])

  async function decider(decision: DecisionComposee) {
    if (decisionEnCours.current || typeof annee !== 'number') return
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
            consequence="La révision ne dit rien d’une lecture incomplète — ni l’état d’un solde, ni sa preuve —, et n’offre aucune décision. Recharge la page."
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

      {revision.cycles.map((cycle) => (
        <CarteDuCycle
          key={cycle.cycle}
          cycle={cycle.cycle}
          annee={annee}
          comptes={cycle.comptes.map((compte) => revision.comptes.find((c) => c.compte === compte) as CompteEnRevision)}
          avancement={cycle.avancement}
          controles={cycle.controles}
          peutDecider={revision.peutDecider}
          onOuvrir={ouvrir}
          onNavigate={onNavigate}
        />
      ))}

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
            occupe={enCours}
            erreur={erreurDecision !== null && erreurDecision.compte === compteAffiche.compte ? erreurDecision.message : null}
            onDecider={decider}
            onModifiee={noterModification}
            onFermer={fermer}
          />
        </PanneauDroit>
      )}
    </>
  )
}

function EnTete({ annee, revision, valideLe, precedentValide, verification, erreurVerification, onVerifier, onNavigate }: {
  annee: number
  revision: RevisionDeLExercice<ControleExistant>
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
          <li>Tout membre du cabinet affecté au dossier décide d’un solde ; la revue par le chef viendra avec les cycles (Q2, hypothèse en base).</li>
          <li>Un solde s’accepte sans pièce, sur un motif obligatoire (Q3, hypothèse en base).</li>
          <li>Une pièce ou un document cité ne se supprime plus, sauf avec son dossier (Q8, hypothèse en base).</li>
          <li>Seul un exercice terminé se révise (Q11, hypothèse en base).</li>
          <li>Les points de la Vue d’ensemble rangés sous chaque cycle portent sur tout le dossier ; les préalables de la validation n’y sont pas encore — ils se lisent dans Clôture.</li>
        </ul>
      </details>
    </div>
  )
}

function CarteDuCycle({ cycle, annee, comptes, avancement, controles, peutDecider, onOuvrir, onNavigate }: {
  cycle: CycleRevision
  annee: number
  comptes: CompteEnRevision[]
  avancement: Record<EtatDuSolde, number>
  controles: ControleExistant[]
  peutDecider: boolean
  onOuvrir: (compte: string) => void
  onNavigate: (tab: DossierTab) => void
}) {
  const description = DESCRIPTION_DES_CYCLES[cycle]
  return (
    <section className="card" style={{ marginTop: 20 }} aria-label={`Cycle ${description.libelle}`}>
      <h3 style={{ marginTop: 0 }}>{description.libelle}</h3>
      {description.nonCouvert && <p className="muted">{description.nonCouvert}</p>}
      {comptes.length === 0 ? (
        <p className="muted">{`Aucun solde de bilan de ce cycle au 31/12/${annee}.`}</p>
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
