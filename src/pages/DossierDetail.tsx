import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { Dossier } from '../lib/types'
import PiecesTab from './dossier/PiecesTab'
import PacksTab from './dossier/PacksTab'
import BanqueTab from './dossier/BanqueTab'
import AccesTab from './dossier/AccesTab'
import EcrituresTab from './dossier/EcrituresTab'
import ImmobilisationsTab from './dossier/ImmobilisationsTab'
import CotisationsTab from './dossier/CotisationsTab'
import ClotureTab from './dossier/ClotureTab'
import DocumentsTab from './dossier/DocumentsTab'
import EstimationTab from './dossier/EstimationTab'
import InformationsTab from './dossier/InformationsTab'
import ChecklistTab from './dossier/ChecklistTab'
import VirementsTab from './dossier/VirementsTab'
import DossierParcours, { type DossierTab } from '../components/DossierParcours'

export default function DossierDetail() {
  const { id } = useParams<{ id: string }>()
  const [dossier, setDossier] = useState<Dossier | null>(null)
  const [tab, setTab] = useState<DossierTab>('checklist')

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
      </div>

      <DossierParcours tab={tab} onChange={setTab} />

      {tab === 'checklist' && <ChecklistTab dossierId={id} onNavigate={setTab} />}
      {tab === 'pieces' && <PiecesTab dossierId={id} />}
      {tab === 'packs' && dossier && <PacksTab dossierId={id} dossierNom={dossier.nom} />}
      {tab === 'banque' && <BanqueTab dossierId={id} />}
      {tab === 'documents' && <DocumentsTab dossierId={id} />}
      {tab === 'ecritures' && <EcrituresTab dossierId={id} assujettiTva={dossier?.assujetti_tva ?? false} />}
      {tab === 'immobilisations' && <ImmobilisationsTab dossierId={id} />}
      {tab === 'cotisations' && <CotisationsTab dossierId={id} />}
      {tab === 'cloture' && <ClotureTab dossierId={id} />}
      {tab === 'estimation' && <EstimationTab dossierId={id} />}
      {tab === 'informations' && <InformationsTab dossierId={id} />}
      {tab === 'virements' && <VirementsTab dossierId={id} />}
      {tab === 'acces' && <AccesTab dossierId={id} codeEmail={dossier?.code_email ?? null} />}
    </>
  )
}
