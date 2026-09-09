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
import InformationsTab from './dossier/InformationsTab'
import ChecklistTab from './dossier/ChecklistTab'
import VirementsTab from './dossier/VirementsTab'
import AssistantFlottant from './dossier/AssistantFlottant'
import DossierParcours, { type DossierTab } from '../components/DossierParcours'

// L'onglet actif fait partie de l'URL (voir la route /dossiers/:id/:tab dans App.tsx) plutôt qu'un
// simple état React : sans ça, ouvrir une pièce dans un nouvel onglet puis faire "retour" ramenait
// tout droit à la liste des dossiers au lieu de l'onglet Pièces qu'on venait de quitter — aucune
// navigation interne n'était mémorisée par le navigateur. Cette liste sert à valider le paramètre
// d'URL (une valeur absente ou invalide retombe sur "checklist").
const TABS_VALIDES: DossierTab[] = [
  'checklist', 'documents', 'pieces', 'factures', 'banque', 'ecritures', 'statistiques', 'immobilisations',
  'cotisations', 'cloture', 'estimation', 'financement', 'packs', 'informations', 'virements', 'acces',
]

export default function DossierDetail() {
  const { id, tab: tabParam } = useParams<{ id: string; tab?: string }>()
  const navigate = useNavigate()
  const tab: DossierTab = TABS_VALIDES.includes(tabParam as DossierTab) ? (tabParam as DossierTab) : 'checklist'
  const [dossier, setDossier] = useState<Dossier | null>(null)
  const [detectingNaf, setDetectingNaf] = useState(false)

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

  return (
    <>
      <Link to="/dossiers" className="muted">&larr; Dossiers</Link>
      <div className="topbar">
        <h1>{dossier?.nom ?? 'Chargement…'}</h1>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: -12, marginBottom: 6, flexWrap: 'wrap' }}>
        {dossier?.siret && <p className="muted" style={{ margin: 0 }}>SIRET {dossier.siret}</p>}
        {dossier && (
          <button
            type="button"
            className={`badge ${dossier.assujetti_tva ? 'badge-ok' : 'badge-neutral'}`}
            style={{ border: 'none', cursor: 'pointer' }}
            title="Clique pour changer — la plupart des dossiers IDEL sont exonérés de TVA sur les actes de soins"
            onClick={toggleAssujettiTva}
          >
            TVA : {dossier.assujetti_tva ? 'Assujetti' : 'Exonéré'}
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
      {tab === 'statistiques' && <StatistiquesTab dossierId={id} />}
      {tab === 'immobilisations' && <ImmobilisationsTab dossierId={id} />}
      {tab === 'cotisations' && <CotisationsTab dossierId={id} />}
      {tab === 'cloture' && <ClotureTab dossierId={id} />}
      {tab === 'estimation' && <EstimationTab dossierId={id} />}
      {tab === 'financement' && <FinancementTab dossierId={id} />}
      {tab === 'informations' && <InformationsTab dossierId={id} dossierNom={dossier?.nom ?? ''} />}
      {tab === 'virements' && <VirementsTab dossierId={id} />}
      {tab === 'acces' && <AccesTab dossierId={id} dossierNom={dossier?.nom ?? ''} codeEmail={dossier?.code_email ?? null} />}

      <AssistantFlottant dossierId={id} />
    </>
  )
}
