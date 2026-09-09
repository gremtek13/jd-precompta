import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { formatDate, formatMoney } from '../../lib/format'
import type { FactureEmise } from '../../lib/types'
import AnneeTabs, { type ValeurAnnee } from '../../components/AnneeTabs'
import FactureFormModal from './FactureFormModal'
import FactureAvoirModal from './FactureAvoirModal'
import FactureApercu from './FactureApercu'
import SuperPdpFactureModal from './SuperPdpFactureModal'
import { badgeClasseStatutSuperpdp, libelleStatutSuperpdp } from '../../lib/superpdpStatuts'
import EnvoyerEmailModal from '../../components/EnvoyerEmailModal'

interface Props {
  dossierId: string
  dossierNom: string
  dossierSiret: string | null
  dossierAdresse: string | null
  assujettiTva: boolean
  onAdresseUpdated: (adresse: string) => void
}

// Facturation du dossier — émet soi-même des factures conformes, en complément de la réception déjà
// en place (Super PDP, voir SuperPdpModal). Une facture validée peut être transmise au client via
// Super PDP (voir SuperPdpFactureModal, supabase/functions/superpdp-emit) ou, comme avant, simplement
// imprimée/exportée en PDF pour être envoyée manuellement — les deux restent possibles, la
// transmission électronique n'est jamais obligatoire (ex. client sans SIRET, ou pas encore configuré).
export default function FacturesTab({ dossierId, dossierNom, dossierSiret, dossierAdresse, assujettiTva, onAdresseUpdated }: Props) {
  const [factures, setFactures] = useState<FactureEmise[]>([])
  const [loading, setLoading] = useState(true)
  const [anneeFilter, setAnneeFilter] = useState<ValeurAnnee>('toutes')
  const [editing, setEditing] = useState<FactureEmise | 'new' | null>(null)
  const [apercu, setApercu] = useState<FactureEmise | null>(null)
  const [avoirDe, setAvoirDe] = useState<FactureEmise | null>(null)
  const [superpdpDe, setSuperpdpDe] = useState<FactureEmise | null>(null)
  const [emailDe, setEmailDe] = useState<FactureEmise | null>(null)

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('factures_emises').select('*').eq('dossier_id', dossierId).order('date_emission', { ascending: false })
    setFactures(data ?? [])
    setLoading(false)
  }
  useEffect(() => { load() }, [dossierId])

  const anneesDisponibles = [...new Set(factures.map((f) => new Date(f.date_emission).getFullYear()))].sort((a, b) => b - a)
  const filtered = factures.filter((f) => anneeFilter === 'toutes' || new Date(f.date_emission).getFullYear() === anneeFilter)

  async function supprimer(f: FactureEmise) {
    if (!window.confirm(`Supprimer le brouillon de facture pour "${f.tiers_nom}" ? Cette action est irréversible.`)) return
    await supabase.from('factures_emises').delete().eq('id', f.id)
    load()
  }

  function ouvrir(f: FactureEmise) {
    if (f.statut === 'validee') setApercu(f)
    else setEditing(f)
  }

  return (
    <>
      <p className="muted" style={{ marginTop: -8, marginBottom: 20 }}>
        Une facture validée reçoit un numéro définitif et n'est plus modifiable — corrige une erreur
        par une facture d'avoir (bouton "Avoir" sur la ligne) plutôt qu'en la rouvrant. Un avoir a sa
        propre numérotation (série "A", indépendante des factures) et référence toujours la facture
        corrigée. La transmission automatique via une plateforme agréée arrivera dans une prochaine
        étape : imprime ou enregistre en PDF pour l'envoyer toi-même.
      </p>

      <AnneeTabs annees={anneesDisponibles} valeur={anneeFilter} onChange={setAnneeFilter} />

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
        <button className="btn btn-primary btn-sm" onClick={() => setEditing('new')}>+ Nouvelle facture</button>
      </div>

      <div className="card table-scroll" style={{ padding: 0 }}>
        {loading ? (
          <p className="muted" style={{ padding: 20 }}>Chargement…</p>
        ) : filtered.length === 0 ? (
          <div className="empty-state">Aucune facture.</div>
        ) : (
          <table>
            <thead>
              <tr><th>Numéro</th><th>Date</th><th>Client</th><th>Montant TTC</th><th>Statut</th><th></th></tr>
            </thead>
            <tbody>
              {filtered.map((f) => {
                const origine = f.facture_origine_id ? factures.find((o) => o.id === f.facture_origine_id) : null
                return (
                  <tr key={f.id} className="clickable" onClick={() => ouvrir(f)}>
                    <td>
                      {f.numero ?? '—'}
                      {f.type === 'avoir' && (
                        <>
                          {' '}<span className="badge badge-neutral">Avoir</span>
                          <div className="muted" style={{ fontSize: '0.78rem' }}>→ {origine?.numero ?? f.facture_origine_id?.slice(0, 8)}</div>
                        </>
                      )}
                    </td>
                    <td>{formatDate(f.date_emission)}</td>
                    <td>{f.tiers_nom}</td>
                    <td>{formatMoney(f.montant_ttc)}</td>
                    <td>
                      {f.statut === 'validee'
                        ? <span className="badge badge-ok">Validée</span>
                        : <span className="badge badge-warning">Brouillon</span>}
                      {f.statut === 'validee' && f.superpdp_invoice_id && (
                        <div style={{ marginTop: 4 }}>
                          <span className={`badge ${badgeClasseStatutSuperpdp(f.superpdp_dernier_statut)}`}>
                            Super PDP · {f.superpdp_dernier_statut ? libelleStatutSuperpdp(f.superpdp_dernier_statut) : '…'}
                          </span>
                        </div>
                      )}
                    </td>
                    <td className="td-actions" onClick={(e) => e.stopPropagation()}>
                      {f.statut === 'brouillon' && (
                        <button className="btn btn-danger btn-sm" onClick={() => supprimer(f)}>Supprimer</button>
                      )}
                      {f.statut === 'validee' && (
                        <button className="btn btn-outline btn-sm" onClick={() => setApercu(f)}>Aperçu</button>
                      )}
                      {f.statut === 'validee' && f.type === 'facture' && (
                        <button className="btn btn-outline btn-sm" onClick={() => setAvoirDe(f)}>Avoir</button>
                      )}
                      {f.statut === 'validee' && (
                        <button className="btn btn-outline btn-sm" onClick={() => setSuperpdpDe(f)}>Super PDP</button>
                      )}
                      {f.statut === 'validee' && (
                        <button className="btn btn-outline btn-sm" onClick={() => setEmailDe(f)}>Envoyer par e-mail</button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <FactureFormModal
          dossierId={dossierId}
          dossierNom={dossierNom}
          dossierSiret={dossierSiret}
          dossierAdresse={dossierAdresse}
          assujettiTva={assujettiTva}
          facture={editing === 'new' ? null : editing}
          onAdresseUpdated={onAdresseUpdated}
          onClose={() => setEditing(null)}
          onSaved={load}
        />
      )}

      {apercu && <FactureApercu facture={apercu} onClose={() => setApercu(null)} />}

      {avoirDe && (
        <FactureAvoirModal
          dossierId={dossierId}
          factureOrigine={avoirDe}
          onClose={() => setAvoirDe(null)}
          onCreated={load}
        />
      )}

      {superpdpDe && (
        <SuperPdpFactureModal
          dossierId={dossierId}
          facture={superpdpDe}
          onClose={() => setSuperpdpDe(null)}
          onUpdated={load}
        />
      )}

      {emailDe && (
        <EnvoyerEmailModal
          dossierId={dossierId}
          type="facture"
          factureId={emailDe.id}
          destinataireInitial={emailDe.tiers_email}
          titre={`Envoyer la ${emailDe.type === 'avoir' ? 'note d’avoir' : 'facture'} ${emailDe.numero ?? ''} par e-mail`}
          description="Le détail (lignes, montants, mentions légales) est envoyé dans le corps de l'e-mail — sans pièce jointe PDF pour l'instant."
          onClose={() => setEmailDe(null)}
          onSent={load}
        />
      )}
    </>
  )
}
