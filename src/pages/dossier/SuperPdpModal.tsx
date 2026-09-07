import { useEffect, useState, type CSSProperties, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'

interface Statut {
  configured: boolean
  client_id: string | null
}

interface ResultatSync {
  importees: number
  deja_connues: number
  en_attente_traitement: number
  erreurs: string[]
}

// Facturation électronique — réception des factures fournisseurs via Super PDP (plateforme de
// dématérialisation partenaire agréée DGFiP, voir supabase/functions/superpdp-sync). Une application
// Super PDP est rattachée à une seule entreprise/SIRET : chaque dossier a ses propres identifiants,
// jamais partagés — à créer sur https://www.superpdp.tech pour l'entreprise de ce dossier.
export default function SuperPdpModal({ dossierId, onClose, onImported }: { dossierId: string; onClose: () => void; onImported: () => void }) {
  const [statut, setStatut] = useState<Statut | null>(null)
  const [reconfigurer, setReconfigurer] = useState(false)
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resultat, setResultat] = useState<ResultatSync | null>(null)

  async function chargerStatut() {
    const { data, error: invokeError } = await supabase.functions.invoke<Statut>('superpdp-credentials', {
      body: { dossierId, action: 'status' },
    })
    if (invokeError || !data) {
      setError("Impossible de vérifier la configuration Super PDP.")
      return
    }
    setStatut(data)
  }

  useEffect(() => { chargerStatut() }, [dossierId])

  async function enregistrer(e: FormEvent) {
    e.preventDefault()
    if (!clientId.trim() || !clientSecret.trim()) return
    setSaving(true)
    setError(null)
    const { data, error: invokeError } = await supabase.functions.invoke<{ ok?: boolean; error?: string }>('superpdp-credentials', {
      body: { dossierId, action: 'save', client_id: clientId.trim(), client_secret: clientSecret.trim() },
    })
    setSaving(false)
    if (data?.error || invokeError) {
      setError(data?.error ?? "Échec de l'enregistrement.")
      return
    }
    setClientId('')
    setClientSecret('')
    setReconfigurer(false)
    chargerStatut()
  }

  async function retirer() {
    if (!window.confirm("Retirer les identifiants Super PDP de ce dossier ? La synchronisation ne sera plus possible tant qu'ils ne seront pas reconfigurés.")) return
    await supabase.functions.invoke('superpdp-credentials', { body: { dossierId, action: 'remove' } })
    setResultat(null)
    chargerStatut()
  }

  async function synchroniser() {
    setSyncing(true)
    setError(null)
    setResultat(null)
    const { data, error: invokeError } = await supabase.functions.invoke<ResultatSync & { error?: string }>('superpdp-sync', {
      body: { dossierId },
    })
    setSyncing(false)
    if (data?.error || invokeError) {
      setError(data?.error ?? 'Échec de la synchronisation.')
      return
    }
    if (data) {
      setResultat(data)
      if (data.importees > 0) onImported()
    }
  }

  const afficherFormulaire = statut !== null && (!statut.configured || reconfigurer)

  return (
    <div style={overlayStyle}>
      <div className="card" style={{ width: 'min(560px, 92vw)', maxHeight: '90vh', overflowY: 'auto' }}>
        <h2 style={{ marginTop: 0 }}>Facturation électronique — Super PDP</h2>
        <p className="muted" style={{ marginTop: -8 }}>
          Récupère automatiquement les factures fournisseurs reçues par ce dossier via Super PDP
          (plateforme agréée DGFiP). Chaque facture importée arrive en Pièces avec le statut « à
          valider », comme un import classique — rien n'est jamais validé automatiquement.
        </p>

        {statut === null && !error && <p className="muted">Vérification…</p>}

        {afficherFormulaire && (
          <form onSubmit={enregistrer}>
            <p className="muted" style={{ fontSize: '0.85rem', marginTop: -4 }}>
              Identifiants de l'application OAuth Super PDP créée pour l'entreprise de ce dossier
              (Tableau de bord Super PDP → Applications → Confidentielle). Copie-les directement
              depuis le site plutôt que de les retaper à la main.
            </p>
            <div className="field">
              <label htmlFor="spdp-client-id">Identifiant (client_id)</label>
              <input id="spdp-client-id" value={clientId} onChange={(e) => setClientId(e.target.value)} required />
            </div>
            <div className="field">
              <label htmlFor="spdp-client-secret">Secret (client_secret)</label>
              <input id="spdp-client-secret" type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} required />
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              {reconfigurer && (
                <button type="button" className="btn btn-outline" onClick={() => setReconfigurer(false)}>Annuler</button>
              )}
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </div>
          </form>
        )}

        {statut?.configured && !reconfigurer && (
          <>
            <p>
              <span className="badge badge-ok">Configuré</span>{' '}
              <span className="muted" style={{ fontSize: '0.85rem' }}>identifiant : {statut.client_id}</span>
            </p>

            {resultat && (
              <div className="card" style={{ background: 'var(--surface-2, #f4f4f4)', marginBottom: 12 }}>
                <p style={{ margin: 0 }}>
                  {resultat.importees} nouvelle(s) facture(s) importée(s)
                  {resultat.deja_connues > 0 && ` — ${resultat.deja_connues} déjà connue(s)`}
                  {resultat.en_attente_traitement > 0 && ` — ${resultat.en_attente_traitement} encore en cours de traitement chez Super PDP (réessaie dans un instant)`}
                </p>
                {resultat.erreurs.length > 0 && (
                  <ul style={{ marginBottom: 0 }}>
                    {resultat.erreurs.map((e, i) => <li key={i} className="error-text">{e}</li>)}
                  </ul>
                )}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-outline" onClick={() => setReconfigurer(true)}>Changer les identifiants</button>
              <button type="button" className="btn btn-outline" onClick={retirer}>Retirer</button>
              <button type="button" className="btn btn-primary" disabled={syncing} onClick={synchroniser}>
                {syncing ? 'Synchronisation…' : 'Synchroniser maintenant'}
              </button>
            </div>
          </>
        )}

        {error && <p className="error-text">{error}</p>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="button" className="btn btn-outline" onClick={onClose}>Fermer</button>
        </div>
      </div>
    </div>
  )
}

const overlayStyle: CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20,
}
