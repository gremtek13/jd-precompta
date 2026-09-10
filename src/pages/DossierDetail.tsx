import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { rechercherCodeNaf } from '../lib/sirene'
import type { Dossier } from '../lib/types'
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
import AssistantFlottant from './dossier/AssistantFlottant'
import DossierParcours, { type DossierTab } from '../components/DossierParcours'
import AnneeTabs, { type ValeurAnnee } from '../components/AnneeTabs'
import { AnneeProvider, useAnnee } from '../context/AnneeContext'
import Avatar from '../components/widgets/Avatar'

// L'onglet actif fait partie de l'URL (voir la route /dossiers/:id/:tab dans App.tsx) plutôt qu'un
// simple état React : sans ça, ouvrir une pièce dans un nouvel onglet puis faire "retour" ramenait
// tout droit à la liste des dossiers au lieu de l'onglet Pièces qu'on venait de quitter — aucune
// navigation interne n'était mémorisée par le navigateur. Cette liste sert à valider le paramètre
// d'URL (une valeur absente ou invalide retombe sur "checklist").
const TABS_VALIDES: DossierTab[] = [
  'checklist', 'documents', 'pieces', 'factures', 'banque', 'ecritures', 'statistiques', 'immobilisations',
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
  const [dossier, setDossier] = useState<Dossier | null>(null)
  const [detectingNaf, setDetectingNaf] = useState(false)
  const [anneesDisponibles, setAnneesDisponibles] = useState<number[] | null>(null)

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
    supabase.from('dossiers').select('*').eq('id', id).single().then(({ data }) => setDossier(data))
  }, [id])

  // Années réellement disponibles sur les trois sources datées qui alimentent les onglets partageant
  // l'exercice (voir TABS_AVEC_EXERCICE) — juste la colonne date de chacune, pas les lignes entières :
  // chaque onglet continue de charger ses propres données pour son propre affichage, cette requête ne
  // sert qu'à calculer l'exercice par défaut et la liste de boutons de l'en-tête.
  useEffect(() => {
    if (!id) return
    let annule = false
    setAnneesDisponibles(null)
    Promise.all([
      supabase.from('pieces').select('date_piece').eq('dossier_id', id).not('date_piece', 'is', null),
      supabase.from('lignes_bancaires').select('date').eq('dossier_id', id),
      supabase.from('ecritures_brouillon').select('date').eq('dossier_id', id),
    ]).then(([{ data: pcs }, { data: lgs }, { data: ecr }]) => {
      if (annule) return
      const annees = new Set<number>()
      for (const p of pcs ?? []) if (p.date_piece) annees.add(new Date(p.date_piece).getFullYear())
      for (const l of lgs ?? []) annees.add(new Date(l.date).getFullYear())
      for (const e of ecr ?? []) annees.add(new Date(e.date).getFullYear())
      setAnneesDisponibles([...annees].sort((a, b) => b - a))
    })
    return () => { annule = true }
  }, [id])

  if (!id) return null

  async function toggleAssujettiTva() {
    if (!dossier) return
    const nouvelleValeur = !dossier.assujetti_tva
    setDossier({ ...dossier, assujetti_tva: nouvelleValeur }) // optimiste, un dossier à la fois
    const { error } = await supabase.from('dossiers').update({ assujetti_tva: nouvelleValeur }).eq('id', dossier.id)
    if (error) {
      setDossier({ ...dossier, assujetti_tva: !nouvelleValeur }) // annule si l'enregistrement échoue
      window.alert(error.message)
    }
  }

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
    setDossier({ ...dossier, code_naf: infos.codeNaf, libelle_naf: infos.libelleNaf })
  }

  // "Cockpit" du dossier : avatar, nom, identifiants et réglages en pastilles, sélecteur d'exercice à
  // droite (partagé entre onglets, voir AnneeContext) — un seul bloc d'en-tête plutôt qu'un titre
  // suivi d'une ligne de badges flottants.
  const cockpit = (
    <header className="cockpit">
      <div className="cockpit-identite">
        {dossier ? <Avatar nom={dossier.nom} taille={56} /> : <span className="skeleton" style={{ width: 56, height: 56, borderRadius: 12 }} />}
        <div style={{ minWidth: 0 }}>
          {dossier ? <h1>{dossier.nom}</h1> : <div className="skeleton skeleton-ligne" style={{ width: 220, height: 22 }} />}
          <div className="cockpit-meta">
            {dossier?.siret && <span className="cockpit-siret">SIRET {dossier.siret}</span>}
            {dossier && (
              <button
                type="button"
                className={`badge badge-bouton ${dossier.assujetti_tva ? 'badge-ok' : 'badge-neutral'}`}
                title="Clique pour changer — la plupart des dossiers IDEL sont exonérés de TVA sur les actes de soins"
                onClick={toggleAssujettiTva}
              >
                TVA : {dossier.assujetti_tva ? 'assujetti' : 'exonéré'}
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
      {anneesDisponibles !== null && TABS_AVEC_EXERCICE.includes(tab) && (
        <div className="cockpit-droite">
          <SelecteurExerciceEntete annees={anneesDisponibles} />
        </div>
      )}
    </header>
  )

  return (
    <>
      <Link to="/dossiers" className="retour">&larr; Tableau de bord</Link>

      {anneesDisponibles === null ? (
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
        <AnneeProvider key={id} defaut={calculerAnneeParDefaut(anneesDisponibles)}>
          {cockpit}
          <DossierParcours tab={tab} onChange={allerA} />

          {tab === 'checklist' && <ChecklistTab dossierId={id} assujettiTva={dossier?.assujetti_tva ?? false} onNavigate={allerA} />}
          {tab === 'pieces' && <PiecesTab dossierId={id} />}
          {tab === 'factures' && (
            <FacturesTab
              dossierId={id}
              dossierNom={dossier?.nom ?? ''}
              dossierSiret={dossier?.siret ?? null}
              dossierAdresse={dossier?.adresse ?? null}
              assujettiTva={dossier?.assujetti_tva ?? false}
              onAdresseUpdated={(adresse) => dossier && setDossier({ ...dossier, adresse })}
            />
          )}
          {tab === 'packs' && dossier && <PacksTab dossierId={id} dossierNom={dossier.nom} />}
          {tab === 'banque' && <BanqueTab dossierId={id} />}
          {tab === 'documents' && <DocumentsTab dossierId={id} />}
          {tab === 'ecritures' && <EcrituresTab dossierId={id} dossierSiret={dossier?.siret ?? null} assujettiTva={dossier?.assujetti_tva ?? false} />}
          {tab === 'statistiques' && <StatistiquesTab dossierId={id} onNavigate={allerA} />}
          {tab === 'immobilisations' && <ImmobilisationsTab dossierId={id} />}
          {tab === 'cotisations' && <CotisationsTab dossierId={id} />}
          {tab === 'cloture' && <ClotureTab dossierId={id} />}
          {tab === 'estimation' && <EstimationTab dossierId={id} />}
          {tab === 'financement' && <FinancementTab dossierId={id} />}
          {tab === 'supplements' && <SupplementsTab dossierId={id} />}
          {tab === 'informations' && (
            <InformationsTab
              dossierId={id}
              dossierNom={dossier?.nom ?? ''}
              dossierSiret={dossier?.siret ?? null}
              dossierAdresse={dossier?.adresse ?? null}
              onIdentiteUpdated={(siret, adresse) => dossier && setDossier({ ...dossier, siret, adresse })}
            />
          )}
          {tab === 'virements' && <VirementsTab dossierId={id} />}
          {tab === 'acces' && <AccesTab dossierId={id} dossierNom={dossier?.nom ?? ''} codeEmail={dossier?.code_email ?? null} />}
        </AnneeProvider>
      )}

      <AssistantFlottant dossierId={id} />
    </>
  )
}

// Sélecteur d'exercice de l'en-tête (voir AnneeContext) — un seul composant plutôt qu'un appel direct
// à useAnnee() dans DossierDetail : useAnnee() suppose d'être sous un <AnneeProvider>, qui n'englobe
// que ce bloc (pas tout DossierDetail), lui-même conditionné par le chargement des années disponibles.
function SelecteurExerciceEntete({ annees }: { annees: number[] }) {
  const { annee, setAnnee } = useAnnee()
  return <AnneeTabs annees={annees} valeur={annee} onChange={setAnnee} />
}
