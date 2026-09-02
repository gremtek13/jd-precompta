import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { CotisationDeclaree, Immobilisation, InformationsDossier, LigneBancaire, NatureImmobilisation, Piece } from '../../lib/types'
import type { DossierTab } from '../../components/DossierParcours'

const NOMS_MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']

interface ItemChecklist {
  id: string
  label: string
  ok: boolean
  detail?: string
  cible?: DossierTab
  onToggle?: () => void
}

// Première page du dossier — ce qu'il reste à obtenir du client, en un coup d'œil (pastille verte /
// rouge) plutôt qu'à reconstituer en fouillant chaque onglet. Volontairement limité à ce qu'on peut
// vérifier de façon fiable sur des données déjà en base (comptage de mois/documents, mots-clés sur une
// nature d'immobilisation que le cabinet nomme lui-même) — jamais une lecture OCR devinée à l'aveugle.
// Les points qui ne se détectent pas de façon fiable (justificatif titres-restaurant reçu...) sont de
// simples cases à cocher manuellement, pas un faux positif automatique.
export default function ChecklistTab({ dossierId, onNavigate }: { dossierId: string; onNavigate: (tab: DossierTab) => void }) {
  const [pieces, setPieces] = useState<Piece[]>([])
  const [cotisations, setCotisations] = useState<CotisationDeclaree[]>([])
  const [lignes, setLignes] = useState<LigneBancaire[]>([])
  const [immobilisations, setImmobilisations] = useState<Immobilisation[]>([])
  const [natures, setNatures] = useState<NatureImmobilisation[]>([])
  const [info, setInfo] = useState<InformationsDossier | null>(null)
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    const [
      { data: piecesData },
      { data: cotisationsData },
      { data: lignesData },
      { data: immobilisationsData },
      { data: naturesData },
      { data: infoData },
    ] = await Promise.all([
      supabase.from('pieces').select('*').eq('dossier_id', dossierId).eq('statut', 'validee'),
      supabase.from('cotisations_declarees').select('*').eq('dossier_id', dossierId),
      supabase.from('lignes_bancaires').select('*').eq('dossier_id', dossierId),
      supabase.from('immobilisations').select('*').eq('dossier_id', dossierId),
      supabase.from('natures_immobilisation').select('*').or(`dossier_id.eq.${dossierId},dossier_id.is.null`),
      supabase.from('informations_dossier').select('*').eq('dossier_id', dossierId).maybeSingle(),
    ])
    setPieces(piecesData ?? [])
    setCotisations(cotisationsData ?? [])
    setLignes(lignesData ?? [])
    setImmobilisations(immobilisationsData ?? [])
    setNatures(naturesData ?? [])
    setInfo(infoData ?? null)
    setLoading(false)
  }

  useEffect(() => { load() }, [dossierId])

  async function toggleJustificatif(champ: 'justificatif_tickets_restaurant_recu' | 'justificatif_cheques_vacances_recu') {
    if (!info) return
    await supabase.from('informations_dossier').update({ [champ]: !info[champ] }).eq('id', info.id)
    load()
  }

  if (loading) return <p className="muted">Chargement…</p>

  const anneeCourante = new Date().getFullYear()
  const moisEcoules = new Date().getMonth() + 1

  const moisPresents = new Set(
    lignes.filter((l) => new Date(l.date).getFullYear() === anneeCourante).map((l) => new Date(l.date).getMonth() + 1),
  )
  const moisManquants = Array.from({ length: moisEcoules }, (_, i) => i + 1).filter((m) => !moisPresents.has(m))

  const cotisationsAnnee = cotisations.filter((c) => new Date(c.echeance).getFullYear() === anneeCourante)
  const piecesAnnee = pieces.filter((p) => p.date_piece && new Date(p.date_piece).getFullYear() === anneeCourante)

  const items: ItemChecklist[] = [
    {
      id: 'banque',
      label: `Relevés bancaires ${anneeCourante}`,
      ok: moisManquants.length === 0,
      detail: moisManquants.length > 0
        ? `Mois manquants : ${moisManquants.map((m) => NOMS_MOIS[m - 1]).join(', ')}`
        : `${moisEcoules}/${moisEcoules} mois reçus`,
      cible: 'banque',
    },
    {
      id: 'cotisations',
      label: `Appels de cotisation ${anneeCourante}`,
      ok: cotisationsAnnee.length > 0,
      detail: cotisationsAnnee.length > 0 ? `${cotisationsAnnee.length} échéance(s) enregistrée(s)` : 'Aucune échéance enregistrée pour cette année',
      cible: 'cotisations',
    },
    {
      id: 'factures',
      label: `Factures / pièces ${anneeCourante}`,
      ok: piecesAnnee.length > 0,
      detail: piecesAnnee.length > 0 ? `${piecesAnnee.length} pièce(s) déposée(s)` : 'Aucune pièce déposée pour cette année',
      cible: 'pieces',
    },
  ]

  if (!info) {
    items.push({
      id: 'informations',
      label: 'Informations complémentaires du client',
      ok: false,
      detail: 'Véhicule, tickets restaurant, chèques vacances… à renseigner une fois',
      cible: 'informations',
    })
  } else {
    if (info.vehicule_type === 'societe') {
      const vehiculeTrouve = immobilisations.some((i) => {
        const nature = natures.find((n) => n.id === i.nature_id)
        return nature && /v[eé]hicule|voiture/i.test(nature.libelle)
      })
      items.push({
        id: 'vehicule',
        label: "Facture d'achat du véhicule de société",
        ok: vehiculeTrouve,
        detail: vehiculeTrouve ? undefined : 'Aucune immobilisation de type véhicule enregistrée',
        cible: 'immobilisations',
      })
    }
    if (info.tickets_restaurant) {
      items.push({
        id: 'tickets',
        label: 'Justificatif titres-restaurant reçu',
        ok: info.justificatif_tickets_restaurant_recu,
        detail: 'À cocher une fois le justificatif obtenu du client',
        onToggle: () => toggleJustificatif('justificatif_tickets_restaurant_recu'),
      })
    }
    if (info.cheques_vacances) {
      items.push({
        id: 'vacances',
        label: 'Justificatif chèques-vacances reçu',
        ok: info.justificatif_cheques_vacances_recu,
        detail: 'À cocher une fois le justificatif obtenu du client',
        onToggle: () => toggleJustificatif('justificatif_cheques_vacances_recu'),
      })
    }
  }

  const nbManquants = items.filter((i) => !i.ok).length
  const nbOk = items.length - nbManquants

  return (
    <>
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        <div className={`stat-card ${nbManquants > 0 ? 'stat-warning' : 'stat-ok'}`}>
          <div className="stat-value">{nbOk}/{items.length}</div>
          <div className="stat-label">Point(s) réglé(s)</div>
          <div className="progress-track" style={{ marginTop: 10 }}>
            <div
              className={`progress-fill ${nbManquants > 0 ? 'warning' : ''}`}
              style={{ width: `${items.length > 0 ? (nbOk / items.length) * 100 : 100}%` }}
            />
          </div>
        </div>
      </div>
      <p className="muted" style={{ marginTop: -12, marginBottom: 20 }}>
        Indicative — vérifie toujours avant de considérer un point comme réglé.
      </p>

      <div className="card" style={{ padding: 0 }}>
        {items.map((item) => (
          <div
            key={item.id}
            style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '14px 20px',
              borderBottom: '1px solid var(--color-border)',
            }}
          >
            <button
              type="button"
              onClick={item.onToggle}
              disabled={!item.onToggle}
              title={item.onToggle ? 'Cliquer pour marquer comme reçu/non reçu' : undefined}
              className="pastille"
              style={{
                width: 14, height: 14, borderRadius: '50%', border: 'none', flexShrink: 0, padding: 0,
                background: item.ok ? 'var(--color-primary)' : 'var(--color-danger)',
                cursor: item.onToggle ? 'pointer' : 'default',
              }}
            />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{item.label}</div>
              {item.detail && <div className="muted" style={{ fontSize: '0.82rem' }}>{item.detail}</div>}
            </div>
            {item.cible && !item.ok && (
              <button type="button" className="btn btn-outline btn-sm" onClick={() => onNavigate(item.cible!)}>
                Aller à l'onglet
              </button>
            )}
          </div>
        ))}
      </div>
    </>
  )
}
