import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { anneeDe, formatDate, formatMoney } from '../../lib/format'
import type { FactureEmise } from '../../lib/types'
import AnneeTabs, { type ValeurAnnee } from '../../components/AnneeTabs'
import BarreRecherche from '../../components/BarreRecherche'
import { correspondALaRecherche } from '../../lib/recherche'
import FactureFormModal from './FactureFormModal'
import FactureAvoirModal from './FactureAvoirModal'
import FactureApercu from './FactureApercu'
import SuperPdpFactureModal from './SuperPdpFactureModal'
import { badgeClasseStatutSuperpdp, libelleStatutSuperpdp } from '../../lib/superpdpStatuts'
import EnvoyerEmailModal from '../../components/EnvoyerEmailModal'
import { lireTout } from '../../lib/lectureComplete'
import BandeauLecturePartielle from '../../components/BandeauLecturePartielle'
import { messageErreur } from '../../lib/messageErreur'

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
  const [lectureIncomplete, setLectureIncomplete] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [anneeFilter, setAnneeFilter] = useState<ValeurAnnee>('toutes')
  const [recherche, setRecherche] = useState('')
  const [editing, setEditing] = useState<FactureEmise | 'new' | null>(null)
  const [apercu, setApercu] = useState<FactureEmise | null>(null)
  const [avoirDe, setAvoirDe] = useState<FactureEmise | null>(null)
  const [superpdpDe, setSuperpdpDe] = useState<FactureEmise | null>(null)
  const [emailDe, setEmailDe] = useState<FactureEmise | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    // La suite des factures émises est LÉGALE : elle n'admet ni trou ni doublon, et une liste
    // tronquée ferait croire à un trou là où il n'y en a pas. Tri TOTAL, `date_emission` n'étant
    // pas unique — plusieurs factures partent le même jour.
    const lecture = await lireTout<FactureEmise>((debut, fin) =>
      supabase.from('factures_emises').select('*', { count: 'exact' })
        .eq('dossier_id', dossierId).order('date_emission', { ascending: false }).order('id').range(debut, fin),
    )
    setFactures(lecture.lignes)
    setLectureIncomplete(lecture.complete ? null : lecture.motif)
    setLoading(false)
  }
  useEffect(() => { load() }, [dossierId])

  const anneesDisponibles = [...new Set(factures.map((f) => anneeDe(f.date_emission)))].sort((a, b) => b - a)
  const avantRecherche = factures.filter((f) => anneeFilter === 'toutes' || anneeDe(f.date_emission) === anneeFilter)
  const filtered = avantRecherche.filter((f) =>
    correspondALaRecherche([f.numero, f.tiers_nom, f.statut, f.date_emission, formatDate(f.date_emission), f.montant_ttc], recherche),
  )

  // Le résultat de la suppression est LU : le `load()` qui suit fait bien réapparaître un brouillon
  // refusé, mais sans un mot, sur un geste que l'opérateur vient de CONFIRMER — le réflexe est alors
  // de reconfirmer, et d'obtenir le même silence (le défaut de `SuperPdpModal.retirer`, corrigé de
  // même sur `SupplementsTab` et `AccesTab`).
  async function supprimer(f: FactureEmise) {
    if (!window.confirm(`Supprimer le brouillon de facture pour "${f.tiers_nom}" ? Cette action est irréversible.`)) return
    setErreur(null)
    const { error: suppressionError } = await supabase.from('factures_emises').delete().eq('id', f.id)
    if (suppressionError) setErreur(messageErreur(suppressionError, 'Le brouillon n’a pas pu être supprimé.'))
    load()
  }

  function ouvrir(f: FactureEmise) {
    if (f.statut === 'validee') setApercu(f)
    else setEditing(f)
  }

  return (
    <>
      <BandeauLecturePartielle
        quoi="Les factures du dossier"
        motif={lectureIncomplete}
        consequence={
          'La suite des numéros est LÉGALE : une liste tronquée fait croire à un trou là où il n’y en ' +
          'a pas. Recharge la page avant d’en conclure quoi que ce soit.'
        }
      />
      <p className="muted" style={{ marginTop: -8, marginBottom: 4 }}>
        Une facture validée reçoit un numéro définitif et n'est plus modifiable — corrige une erreur
        par une facture d'avoir plutôt qu'en la rouvrant.
      </p>
      <details className="muted" style={{ marginBottom: 20 }}>
        <summary style={{ cursor: 'pointer' }}>En savoir plus</summary>
        <p style={{ marginTop: 6, marginBottom: 0 }}>
          Le bouton "Avoir" sur une ligne crée un avoir avec sa propre numérotation (série "A",
          indépendante des factures), qui référence toujours la facture corrigée. Une fois validée,
          une facture peut être transmise directement au client via Super PDP (facturation
          électronique, plateforme agréée) ou envoyée par e-mail — imprimer/enregistrer en PDF reste
          possible si tu préfères l'envoyer toi-même.
        </p>
      </details>

      <AnneeTabs annees={anneesDisponibles} valeur={anneeFilter} onChange={setAnneeFilter} />

      <div style={{ marginBottom: 14 }}>
        <BarreRecherche
          valeur={recherche}
          onChange={setRecherche}
          placeholder="Rechercher un numéro, un client, un montant…"
          affiches={filtered.length}
          total={avantRecherche.length}
        />
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
        <button className="btn btn-primary btn-sm" onClick={() => setEditing('new')}>+ Nouvelle facture</button>
      </div>

      {erreur && <p className="error-text">{erreur}</p>}

      <div className="card table-scroll" style={{ padding: 0 }}>
        {loading ? (
          <p className="muted" style={{ padding: 20 }}>Chargement…</p>
        ) : filtered.length === 0 ? (
          // « Aucune facture » seulement sur une lecture COMPLÈTE : une lecture refusée rend aussi une
          // liste vide, et l'affirmation deviendrait fausse au lieu d'une panne dite — sur la suite de
          // numéros qu'un cabinet doit pouvoir présenter sans trou (même règle que PacksTab).
          <div className="empty-state">
            {recherche.trim()
              ? `Aucune facture ne correspond à « ${recherche.trim()} ».`
              : lectureIncomplete ? 'La liste des factures n’a pas pu être lue.' : 'Aucune facture.'}
          </div>
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
