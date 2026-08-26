import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { Dossier } from '../lib/types'
import PiecesTab from './dossier/PiecesTab'
import PacksTab from './dossier/PacksTab'
import AccesTab from './dossier/AccesTab'

type Tab = 'pieces' | 'packs' | 'acces'

export default function DossierDetail() {
  const { id } = useParams<{ id: string }>()
  const [dossier, setDossier] = useState<Dossier | null>(null)
  const [tab, setTab] = useState<Tab>('pieces')

  useEffect(() => {
    if (!id) return
    supabase.from('dossiers').select('*').eq('id', id).single().then(({ data }) => setDossier(data))
  }, [id])

  if (!id) return null

  return (
    <>
      <Link to="/dossiers" className="muted">&larr; Dossiers</Link>
      <div className="topbar">
        <h1>{dossier?.nom ?? 'Chargement…'}</h1>
      </div>
      {dossier?.siret && <p className="muted" style={{ marginTop: -12 }}>SIRET {dossier.siret}</p>}

      <div className="tabs">
        <button className={tab === 'pieces' ? 'active' : ''} onClick={() => setTab('pieces')}>Pièces</button>
        <button className={tab === 'packs' ? 'active' : ''} onClick={() => setTab('packs')}>Packs</button>
        <button className={tab === 'acces' ? 'active' : ''} onClick={() => setTab('acces')}>Accès</button>
      </div>

      {tab === 'pieces' && <PiecesTab dossierId={id} />}
      {tab === 'packs' && dossier && <PacksTab dossierId={id} dossierNom={dossier.nom} />}
      {tab === 'acces' && <AccesTab dossierId={id} />}
    </>
  )
}
