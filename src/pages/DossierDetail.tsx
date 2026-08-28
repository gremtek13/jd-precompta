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

type Tab = 'pieces' | 'packs' | 'banque' | 'ecritures' | 'immobilisations' | 'cotisations' | 'cloture' | 'acces'

export default function DossierDetail() {
  const { id } = useParams<{ id: string }>()
  const [dossier, setDossier] = useState<Dossier | null>(null)
  const [tab, setTab] = useState<Tab>('pieces')

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

      <div className="tabs">
        <button className={tab === 'pieces' ? 'active' : ''} onClick={() => setTab('pieces')}>Pièces</button>
        <button className={tab === 'packs' ? 'active' : ''} onClick={() => setTab('packs')}>Packs</button>
        <button className={tab === 'banque' ? 'active' : ''} onClick={() => setTab('banque')}>Banque</button>
        <button className={tab === 'ecritures' ? 'active' : ''} onClick={() => setTab('ecritures')}>Écritures</button>
        <button className={tab === 'immobilisations' ? 'active' : ''} onClick={() => setTab('immobilisations')}>Immobilisations</button>
        <button className={tab === 'cotisations' ? 'active' : ''} onClick={() => setTab('cotisations')}>Cotisations</button>
        <button className={tab === 'cloture' ? 'active' : ''} onClick={() => setTab('cloture')}>Clôture</button>
        <button className={tab === 'acces' ? 'active' : ''} onClick={() => setTab('acces')}>Accès</button>
      </div>

      {tab === 'pieces' && <PiecesTab dossierId={id} />}
      {tab === 'packs' && dossier && <PacksTab dossierId={id} dossierNom={dossier.nom} />}
      {tab === 'banque' && <BanqueTab dossierId={id} />}
      {tab === 'ecritures' && <EcrituresTab dossierId={id} assujettiTva={dossier?.assujetti_tva ?? false} />}
      {tab === 'immobilisations' && <ImmobilisationsTab dossierId={id} />}
      {tab === 'cotisations' && <CotisationsTab dossierId={id} />}
      {tab === 'cloture' && <ClotureTab dossierId={id} />}
      {tab === 'acces' && <AccesTab dossierId={id} codeEmail={dossier?.code_email ?? null} />}
    </>
  )
}
