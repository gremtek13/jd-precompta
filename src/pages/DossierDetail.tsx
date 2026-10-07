import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { rechercherCodeNaf } from '../lib/sirene'
import { EXPLICATIONS_MODE, modeleDuDossier } from '../lib/engagement'
import { STATUTS_TVA, libelleCourtStatutTva, resumeObligations } from '../lib/statutTva'
import type { Dossier, ExerciceValide } from '../lib/types'
import PiecesTab from './dossier/PiecesTab'
import FacturesTab from './dossier/FacturesTab'
import PacksTab from './dossier/PacksTab'
import BanqueTab from './dossier/BanqueTab'
import AccesTab from './dossier/AccesTab'
import EcrituresTab from './dossier/EcrituresTab'
import StatistiquesTab from './dossier/StatistiquesTab'
import ImmobilisationsTab from './dossier/ImmobilisationsTab'
import CotisationsTab from './dossier/CotisationsTab'
import ClotureTab from './dossier/ClotureTab'
import DocumentsTab from './dossier/DocumentsTab'
import EstimationTab from './dossier/EstimationTab'
import FinancementTab from './dossier/FinancementTab'
import SupplementsTab from './dossier/SupplementsTab'
import InformationsTab from './dossier/InformationsTab'
import ChecklistTab from './dossier/ChecklistTab'
import VirementsTab from './dossier/VirementsTab'
import TvaTab from './dossier/TvaTab'
import AssistantDossier, { BoutonAssistant } from './dossier/AssistantDossier'
import DossierParcours, { type DossierTab } from '../components/DossierParcours'
import AnneeTabs, { type ValeurAnnee } from '../components/AnneeTabs'
import { AnneeProvider, useAnnee } from '../context/AnneeContext'
import { ExercicesValidesProvider } from '../context/ExercicesValidesContext'
import Avatar from '../components/widgets/Avatar'
import BandeauLecturePartielle from '../components/BandeauLecturePartielle'
import { anneeDe } from '../lib/format'
import { lireTout } from '../lib/lectureComplete'
import { messageErreur } from '../lib/messageErreur'

// L'onglet actif fait partie de l'URL (voir la route /dossiers/:id/:tab dans App.tsx) plutôt qu'un
// simple état React : sans ça, ouvrir une pièce dans un nouvel onglet puis faire "retour" ramenait
// tout droit à la liste des dossiers au lieu de l'onglet Pièces qu'on venait de quitter — aucune
// navigation interne n'était mémorisée par le navigateur. Cette liste sert à valider le paramètre
// d'URL (une valeur absente ou invalide retombe sur "checklist").
const TABS_VALIDES: DossierTab[] = [
  'checklist', 'documents', 'pieces', 'factures', 'banque', 'ecritures', 'statistiques', 'tva', 'immobilisations',
  'cotisations', 'cloture', 'estimation', 'financement', 'supplements', 'packs', 'informations', 'virements', 'acces',
]

// Onglets où l'exercice sélectionné a un effet réel (voir AnneeContext) — le sélecteur d'exercice de
// l'en-tête ne s'affiche que là, pas sur des écrans (Informations, Packs...) où il ne changerait rien.
const TABS_AVEC_EXERCICE: DossierTab[] = ['pieces', 'banque', 'ecritures', 'statistiques', 'cloture']

// Exercice le plus pertinent à afficher par défaut à l'ouverture du dossier — jamais "toutes" sur un
// dossier qui a déjà de l'historique : mélanger plusieurs exercices dans un total (Clôture, en
// particulier) n'a de sens que si l'utilisateur le choisit explicitement. Préfère l'année civile en
// cours si elle a déjà de l'activité, sinon l'année précédente (cas courant : on clôture N-1 en début
// d'année N), sinon la plus récente année avec de l'activité, sinon "toutes" (dossier neuf, rien à
// mélanger).
function calculerAnneeParDefaut(anneesDisponibles: number[]): ValeurAnnee {
  if (anneesDisponibles.length === 0) return 'toutes'
  const anneeCourante = new Date().getFullYear()
  if (anneesDisponibles.includes(anneeCourante)) return anneeCourante
  if (anneesDisponibles.includes(anneeCourante - 1)) return anneeCourante - 1
  return anneesDisponibles[0]
}

export default function DossierDetail() {
  const { id, tab: tabParam } = useParams<{ id: string; tab?: string }>()
  const navigate = useNavigate()
  const tab: DossierTab = TABS_VALIDES.includes(tabParam as DossierTab) ? (tabParam as DossierTab) : 'checklist'
  // Le dossier lu, AVEC l'identifiant pour lequel il l'a été — et de même pour les années. Cette page
  // ne se remonte pas quand la barre latérale mène d'un dossier à l'autre (même route, autre :id) :
  // un état gardé seul désignerait encore l'ANCIEN dossier jusqu'à la fin de la lecture du nouveau,
  // et pour de bon si celle de l'ancien arrivait la dernière. Son SIRET partirait sur une facture,
  // son code dans les consignes d'accès du client, et « TVA » basculerait l'ancien dossier. Ce qui
  // n'appartient pas au dossier de l'URL ne s'affiche donc pas : il vaut nul, et l'écran attend.
  const [lu, setLu] = useState<{ id: string; dossier: Dossier | null; erreur: string | null } | null>(null)
  const dossier = lu && lu.id === id ? lu.dossier : null
  const erreurDossier = lu && lu.id === id ? lu.erreur : null
  const [essaiDossier, setEssaiDossier] = useState(0)
  const [detectingNaf, setDetectingNaf] = useState(false)
  const [annees, setAnnees] = useState<{ id: string; liste: number[]; motif: string | null } | null>(null)
  const motifAnnees = annees && annees.id === id ? annees.motif : null
  // Les exercices validés du dossier (voir ExercicesValidesContext), lus comme son identité : avec
  // l'identifiant pour lequel ils l'ont été. Sans eux, un onglet proposerait de modifier ce que la validation
  // a figé, et crierait « à régénérer » sur des écritures que rien ne réécrira plus.
  const [valides, setValides] = useState<{ id: string; exercices: ExerciceValide[]; erreur: string | null } | null>(null)
  const exercicesValides = valides && valides.id === id ? valides.exercices : null
  const erreurValides = valides && valides.id === id ? valides.erreur : null
  // Un exercice validé reste au sélecteur de l'en-tête même quand rien ne le porte plus : un exercice vide se
  // valide, et il doit rester où le retrouver.
  const anneesDisponibles = annees && annees.id === id && exercicesValides
    ? [...new Set([...annees.liste, ...exercicesValides.map((e) => e.annee)])].sort((a, b) => b - a)
    : null
  // Les onglets ET le sélecteur d'exercice de l'en-tête — qui lit le même AnneeProvider — ne se
  // montent qu'une fois l'identité et les années du dossier de l'URL connues, jamais l'une sans
  // l'autre : les années arrivent souvent AVANT l'identité, et l'en-tête se rend aussi pendant
  // l'attente, hors de ce fournisseur, où le sélecteur lèverait et emporterait toute la page.
  const pret = !erreurDossier && !erreurValides && dossier !== null && anneesDisponibles !== null
  // Le modèle comptable du dossier (lib/engagement.ts), lu sur la ligne du dossier et JAMAIS supposé :
  // les onglets qui en dépendent ne se montent pas sans lui, plutôt que de retomber sur la trésorerie
  // — un dossier en engagement lu en trésorerie ferait signaler « à régénérer » toutes ses écritures.
  const modele = dossier ? modeleDuDossier(dossier) : null

  // Change ce dossier-là et lui seul : une réponse qui revient après qu'on a changé de dossier ne
  // doit pas écrire l'ancien sur le nouveau.
  function modifierDossier(dossierId: string, modification: Partial<Dossier>) {
    setLu((l) => (l?.id === dossierId && l.dossier ? { ...l, dossier: { ...l.dossier, ...modification } } : l))
  }

  // URL toujours explicite (avec son onglet) une fois montée — évite d'avoir deux URLs différentes
  // (/dossiers/:id et /dossiers/:id/checklist) pour le même écran.
  useEffect(() => {
    if (id && !tabParam) navigate(`/dossiers/${id}/checklist`, { replace: true })
  }, [id, tabParam, navigate])

  function allerA(nouvelOnglet: DossierTab) {
    if (id) navigate(`/dossiers/${id}/${nouvelOnglet}`)
  }

  useEffect(() => {
    if (!id) return
    let annule = false
    supabase.from('dossiers').select('*').eq('id', id).single().then(({ data, error }) => {
      if (annule) return
      // Aucune ligne (dossier supprimé, ou hors de portée de ce compte) rend PGRST116 : le message
      // brut de PostgREST ne dirait rien à l'opérateur.
      const erreur = !error ? null
        : error.code === 'PGRST116' ? 'ce dossier est introuvable, ou ce compte n’y a pas accès'
        : messageErreur(error, 'erreur inconnue')
      setLu({ id, dossier: error ? null : data, erreur })
    })
    return () => { annule = true }
  }, [id, essaiDossier])

  // Lus par tranches comme les autres collections, et la lecture partielle tient lieu de refus : un exercice
  // validé qu'on n'aurait pas lu laisserait les onglets proposer de modifier ce qu'il fige.
  const lireExercicesValides = useCallback(async (dossierId: string) => {
    const lecture = await lireTout<ExerciceValide>((debut, fin) =>
      supabase.from('exercices_valides').select('*', { count: 'exact' })
        .eq('dossier_id', dossierId).order('annee').order('dossier_id').range(debut, fin),
    )
    return { id: dossierId, exercices: lecture.lignes, erreur: lecture.complete ? null : lecture.motif }
  }, [])

  useEffect(() => {
    if (!id) return
    let annule = false
    lireExercicesValides(id).then((lus) => { if (!annule) setValides(lus) })
    return () => { annule = true }
  }, [id, essaiDossier, lireExercicesValides])

  // Après une validation (Clôture) : chaque onglet doit voir la nouvelle frontière.
  const relireExercicesValides = useCallback(async () => {
    if (!id) return
    setValides(await lireExercicesValides(id))
  }, [id, lireExercicesValides])

  // Années réellement disponibles sur les trois sources datées qui alimentent les onglets partageant
  // l'exercice (voir TABS_AVEC_EXERCICE) — juste la colonne date de chacune, pas les lignes entières :
  // chaque onglet continue de charger ses propres données pour son propre affichage, cette requête ne
  // sert qu'à calculer l'exercice par défaut et la liste de boutons de l'en-tête.
  useEffect(() => {
    if (!id) return
    let annule = false
    Promise.all([
      // Lues par tranches : tronquées, elles ne perdent pas des lignes visibles — elles font
      // disparaître un EXERCICE du sélecteur, et tout ce que le cabinet regarde ensuite est filtré
      // par lui (voir lib/lectureComplete.ts). Ce commentaire le disait depuis le début pendant que
      // le drapeau partait à la poubelle : la page le DIT désormais, sous la barre de ses écrans.
      lireTout<{ date_piece: string | null }>((debut, fin) =>
        supabase.from('pieces').select('date_piece', { count: 'exact' })
          .eq('dossier_id', id).not('date_piece', 'is', null).order('id').range(debut, fin),
      ),
      lireTout<{ date: string }>((debut, fin) =>
        supabase.from('lignes_bancaires').select('date', { count: 'exact' })
          .eq('dossier_id', id).order('id').range(debut, fin),
      ),
      lireTout<{ date: string }>((debut, fin) =>
        supabase.from('ecritures_brouillon').select('date', { count: 'exact' })
          .eq('dossier_id', id).order('id').range(debut, fin),
      ),
    ]).then(([pcs, lgs, ecr]) => {
      if (annule) return
      const annees = new Set<number>()
      for (const p of pcs.lignes) if (p.date_piece) annees.add(anneeDe(p.date_piece))
      for (const l of lgs.lignes) annees.add(anneeDe(l.date))
      for (const e of ecr.lignes) annees.add(anneeDe(e.date))
      setAnnees({
        id,
        liste: [...annees].sort((a, b) => b - a),
        motif: [pcs, lgs, ecr].find((l) => !l.complete)?.motif ?? null,
      })
    })
    return () => { annule = true }
  }, [id])

  if (!id) return null

  // Backfill pour les dossiers créés avant l'ajout du code NAF (voir lib/sirene.ts, appelé
  // automatiquement à la création d'un nouveau dossier) — un clic explicite, pas automatique au
  // chargement, pour ne jamais appeler une API externe sans que le cabinet l'ait demandé.
  async function detecterProfession() {
    if (!dossier?.siret) return
    setDetectingNaf(true)
    const infos = await rechercherCodeNaf(dossier.siret)
    setDetectingNaf(false)
    if (!infos) {
      window.alert("Profession introuvable pour ce SIRET (réseau indisponible ou SIRET non reconnu par la base SIRENE).")
      return
    }
    const { error } = await supabase.from('dossiers').update({ code_naf: infos.codeNaf, libelle_naf: infos.libelleNaf }).eq('id', dossier.id)
    if (error) {
      window.alert(error.message)
      return
    }
    modifierDossier(dossier.id, { code_naf: infos.codeNaf, libelle_naf: infos.libelleNaf })
  }

  // "Cockpit" du dossier : avatar, nom, identifiants et réglages en pastilles, sélecteur d'exercice à
  // droite (partagé entre onglets, voir AnneeContext) — un seul bloc d'en-tête plutôt qu'un titre
  // suivi d'une ligne de badges flottants. Et, sur ordinateur, le bouton qui ouvre l'assistant dans
  // le panneau de droite (voir AssistantDossier).
  const cockpit = (
    <header className="cockpit">
      <div className="cockpit-identite">
        {dossier ? <Avatar nom={dossier.nom} taille={56} /> : <span className="skeleton" style={{ width: 56, height: 56, borderRadius: 12 }} />}
        <div style={{ minWidth: 0 }}>
          {dossier ? <h1>{dossier.nom}</h1> : <div className="skeleton skeleton-ligne" style={{ width: 220, height: 22 }} />}
          <div className="cockpit-meta">
            {dossier?.siret && <span className="cockpit-siret">SIRET {dossier.siret}</span>}
            {dossier && (
              // Le statut de TVA (lib/statutTva.ts) : redevable, franchise en base, exonéré — ou à préciser, en
              // couleur d'alerte. Il se lit ici et se règle dans l'onglet TVA, où le badge mène, comme celui du
              // modèle comptable mène à Écritures. Il basculait ici le seul booléen « assujetti », qui rangeait la
              // franchise et l'exonération sous un même « exonéré » — c'est ce qui proposait la mention de la
              // franchise sur la facture d'un dossier de soins.
              <button
                type="button"
                className={`badge badge-bouton ${dossier.statut_tva === 'redevable' ? 'badge-ok' : dossier.statut_tva == null ? 'badge-warning' : 'badge-neutral'}`}
                title={`${dossier.statut_tva ? STATUTS_TVA.find((s) => s.statut === dossier.statut_tva)?.explication ?? '' : 'Statut de TVA à préciser.'} `
                  + `${resumeObligations(dossier.statut_tva, dossier.article_exoneration)} Il se règle dans l’onglet TVA.`}
                onClick={() => allerA('tva')}
              >
                TVA : {libelleCourtStatutTva(dossier.statut_tva)}
              </button>
            )}
            {dossier && (
              // Le modèle comptable, qui décide de toutes les écritures du dossier : il se lit ici et se
              // règle dans l'onglet Écritures, tant que le brouillon est vide — le badge y mène.
              <button
                type="button"
                className="badge badge-bouton badge-neutral"
                title={`${EXPLICATIONS_MODE[dossier.mode_comptable]} Il se règle dans l’onglet Écritures, tant que le brouillon d’écritures est vide.`}
                onClick={() => allerA('ecritures')}
              >
                Comptabilité : {dossier.mode_comptable === 'engagement' ? 'engagement' : 'trésorerie'}
              </button>
            )}
            {dossier && (dossier.libelle_naf || dossier.code_naf) && (
              <span className="badge badge-neutral" title={dossier.code_naf ?? undefined}>
                {dossier.libelle_naf ?? `NAF ${dossier.code_naf}`}
              </span>
            )}
            {dossier && dossier.siret && !dossier.code_naf && (
              <button type="button" className="btn btn-outline btn-sm" onClick={detecterProfession} disabled={detectingNaf}>
                {detectingNaf ? 'Détection…' : 'Détecter la profession (SIRET)'}
              </button>
            )}
          </div>
        </div>
      </div>
      {pret && TABS_AVEC_EXERCICE.includes(tab) && (
        <div className="cockpit-droite">
          <SelecteurExerciceEntete annees={anneesDisponibles} />
        </div>
      )}
      <BoutonAssistant />
    </header>
  )

  return (
    <>
      {/* Le chemin de retour sur MOBILE : sur ordinateur la barre latérale mène déjà partout, et ce
          lien s'y masque (voir .retour-tableau dans index.css). */}
      <Link to="/dossiers" className="retour retour-tableau">&larr; Tableau de bord</Link>

      {/* Les onglets ne se montent qu'avec l'identité du dossier de l'URL : plusieurs la RECOPIENT au
          montage (le formulaire d'Informations, par exemple), et montés trop tôt ils garderaient un
          SIRET vide — ou celui du dossier précédent — que le premier « Enregistrer » écrirait. */}
      {erreurDossier || erreurValides ? (
        <>
          {cockpit}
          <div className="card">
            <p className="error-text" style={{ marginTop: 0 }}>
              {erreurDossier
                ? `Ce dossier n’a pas pu être lu (${erreurDossier}). Ses écrans ne s’affichent pas : ils partiraient d’une identité vide — un SIRET vide sur une facture, par exemple.`
                : `Les exercices validés de ce dossier n’ont pas pu être lus (${erreurValides}). Ses écrans ne s’affichent pas : ils proposeraient de modifier ce qu’une validation a figé.`}
            </p>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setEssaiDossier((n) => n + 1)}>
              Réessayer
            </button>
          </div>
        </>
      ) : !pret ? (
        <>
          {cockpit}
          <DossierParcours tab={tab} onChange={allerA} />
          <div className="bento" aria-busy="true" aria-label="Chargement">
            <div className="skeleton skeleton-kpi span-3" />
            <div className="skeleton skeleton-kpi span-3" />
            <div className="skeleton skeleton-kpi span-3" />
            <div className="skeleton skeleton-kpi span-3" />
          </div>
        </>
      ) : (
        <ExercicesValidesProvider exercices={exercicesValides ?? []} relire={relireExercicesValides}>
          <AnneeProvider key={id} defaut={calculerAnneeParDefaut(anneesDisponibles)}>
            {cockpit}
            <DossierParcours tab={tab} onChange={allerA} />
            <BandeauLecturePartielle
              quoi="Les dates des justificatifs, relevés et écritures"
              motif={motifAnnees}
              consequence={
                'Le sélecteur d’exercice de l’en-tête peut donc omettre une année — un exercice absent de ' +
                'la liste n’est pas forcément vide —, et l’exercice ouvert d’office n’est peut-être pas le ' +
                'plus récent.'
              }
            />

            {tab === 'checklist' && modele && <ChecklistTab dossierId={id} assujettiTva={dossier?.assujetti_tva ?? false} periodiciteTva={dossier?.tva_periodicite ?? 'trimestrielle'} statutTva={dossier?.statut_tva ?? null} modele={modele} onNavigate={allerA} />}
            {tab === 'pieces' && <PiecesTab dossierId={id} dossierSiret={dossier?.siret ?? null} />}
            {tab === 'factures' && (
              <FacturesTab
                dossierId={id}
                dossierNom={dossier?.nom ?? ''}
                dossierSiret={dossier?.siret ?? null}
                dossierAdresse={dossier?.adresse ?? null}
                statutTva={dossier?.statut_tva ?? null}
                articleExoneration={dossier?.article_exoneration ?? null}
                onAdresseUpdated={(adresse) => modifierDossier(id, { adresse })}
              />
            )}
            {tab === 'packs' && dossier && <PacksTab dossierId={id} dossierNom={dossier.nom} />}
            {tab === 'banque' && modele && <BanqueTab dossierId={id} modele={modele} assujettiTva={dossier?.assujetti_tva ?? false} />}
            {tab === 'documents' && <DocumentsTab dossierId={id} />}
            {tab === 'ecritures' && modele && (
              <EcrituresTab
                dossierId={id}
                dossierNom={dossier?.nom ?? ''}
                dossierSiret={dossier?.siret ?? null}
                assujettiTva={dossier?.assujetti_tva ?? false}
                modele={modele}
                onModeleUpdated={(modification) => modifierDossier(id, modification)}
              />
            )}
            {tab === 'statistiques' && modele && <StatistiquesTab dossierId={id} onNavigate={allerA} modeComptable={modele.mode} />}
            {tab === 'tva' && dossier && (
              <TvaTab
                dossierId={id}
                assujettiTva={dossier.assujetti_tva}
                statutTva={dossier.statut_tva}
                articleExoneration={dossier.article_exoneration}
                onStatutUpdated={(modification) => modifierDossier(id, modification)}
                periodicite={dossier.tva_periodicite}
                surDebits={dossier.tva_sur_debits}
                onRegimeUpdated={(modification) => modifierDossier(id, modification)}
              />
            )}
            {tab === 'immobilisations' && <ImmobilisationsTab dossierId={id} assujettiTva={dossier?.assujetti_tva ?? false} />}
            {tab === 'cotisations' && modele && <CotisationsTab dossierId={id} modeComptable={modele.mode} />}
            {tab === 'cloture' && dossier && modele && (
              <ClotureTab
                dossierId={id}
                assujettiTva={dossier.assujetti_tva}
                periodiciteTva={dossier.tva_periodicite}
                modele={modele}
                onNavigate={allerA}
              />
            )}
            {tab === 'estimation' && modele && <EstimationTab dossierId={id} assujettiTva={dossier?.assujetti_tva ?? false} modeComptable={modele.mode} />}
            {tab === 'financement' && modele && <FinancementTab dossierId={id} assujettiTva={dossier?.assujetti_tva ?? false} modeComptable={modele.mode} />}
            {tab === 'supplements' && <SupplementsTab dossierId={id} />}
            {tab === 'informations' && modele && (
              <InformationsTab
                dossierId={id}
                dossierNom={dossier?.nom ?? ''}
                dossierSiret={dossier?.siret ?? null}
                dossierAdresse={dossier?.adresse ?? null}
                modele={modele}
                onIdentiteUpdated={(siret, adresse) => modifierDossier(id, { siret, adresse })}
              />
            )}
            {tab === 'virements' && modele && <VirementsTab dossierId={id} modele={modele} />}
            {tab === 'acces' && <AccesTab dossierId={id} dossierNom={dossier?.nom ?? ''} codeEmail={dossier?.code_email ?? null} />}
          </AnneeProvider>
        </ExercicesValidesProvider>
      )}

      <AssistantDossier dossierId={id} dossierNom={dossier?.nom ?? null} />
    </>
  )
}

// Sélecteur d'exercice de l'en-tête (voir AnneeContext) — un seul composant plutôt qu'un appel direct
// à useAnnee() dans DossierDetail : useAnnee() suppose d'être sous un <AnneeProvider>, qui n'englobe
// que ce bloc (pas tout DossierDetail), lui-même conditionné par le chargement des années disponibles.
// L'exercice choisi y paraît TOUJOURS, même quand rien ne le porte encore : Clôture mène à l'exercice que la
// validation réclame d'abord, qui peut n'avoir ni pièce, ni mouvement, ni écriture — et un en-tête sans onglet actif
// laisserait croire qu'on lit un autre exercice que celui affiché.
function SelecteurExerciceEntete({ annees }: { annees: number[] }) {
  const { annee, setAnnee } = useAnnee()
  const liste = typeof annee === 'number' && !annees.includes(annee) ? [...annees, annee].sort((x, y) => y - x) : annees
  return <AnneeTabs annees={liste} valeur={annee} onChange={setAnnee} />
}
