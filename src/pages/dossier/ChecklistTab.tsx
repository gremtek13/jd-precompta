import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { analyserEcritures } from '../../lib/ecritures'
import { categoriesSansCompte, categoriesSansPoste, piecesSansTva } from '../../lib/controles'
import type { Categorie, CotisationDeclaree, EcritureBrouillon, Immobilisation, InformationsDossier, LigneBancaire, NatureImmobilisation, Piece } from '../../lib/types'
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
export default function ChecklistTab({ dossierId, assujettiTva, onNavigate }: { dossierId: string; assujettiTva: boolean; onNavigate: (tab: DossierTab) => void }) {
  const [pieces, setPieces] = useState<Piece[]>([])
  const [piecesAValider, setPiecesAValider] = useState<Piece[]>([])
  const [cotisations, setCotisations] = useState<CotisationDeclaree[]>([])
  const [lignes, setLignes] = useState<LigneBancaire[]>([])
  const [immobilisations, setImmobilisations] = useState<Immobilisation[]>([])
  const [natures, setNatures] = useState<NatureImmobilisation[]>([])
  const [categories, setCategories] = useState<Categorie[]>([])
  const [ecritures, setEcritures] = useState<EcritureBrouillon[]>([])
  const [info, setInfo] = useState<InformationsDossier | null>(null)
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    const [
      { data: piecesData },
      { data: piecesAValiderData },
      { data: cotisationsData },
      { data: lignesData },
      { data: immobilisationsData },
      { data: naturesData },
      { data: categoriesData },
      { data: ecrituresData },
      { data: infoData },
    ] = await Promise.all([
      supabase.from('pieces').select('*').eq('dossier_id', dossierId).eq('statut', 'validee'),
      supabase.from('pieces').select('*').eq('dossier_id', dossierId).eq('statut', 'a_valider'),
      supabase.from('cotisations_declarees').select('*').eq('dossier_id', dossierId),
      supabase.from('lignes_bancaires').select('*').eq('dossier_id', dossierId),
      supabase.from('immobilisations').select('*').eq('dossier_id', dossierId),
      supabase.from('natures_immobilisation').select('*').or(`dossier_id.eq.${dossierId},dossier_id.is.null`),
      supabase.from('categories').select('*').or(`dossier_id.eq.${dossierId},dossier_id.is.null`),
      supabase.from('ecritures_brouillon').select('*').eq('dossier_id', dossierId),
      supabase.from('informations_dossier').select('*').eq('dossier_id', dossierId).maybeSingle(),
    ])
    setPieces(piecesData ?? [])
    setPiecesAValider(piecesAValiderData ?? [])
    setCotisations(cotisationsData ?? [])
    setLignes(lignesData ?? [])
    setImmobilisations(immobilisationsData ?? [])
    setNatures(naturesData ?? [])
    setCategories(categoriesData ?? [])
    setEcritures(ecrituresData ?? [])
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

  // "Points à traiter" — regroupe en un seul endroit les anomalies déjà détectées séparément dans
  // Pièces (confiance basse), Écritures (comptes manquants, TVA, désynchronisation, déséquilibre) et
  // Clôture (postes manquants), pour ne pas avoir à visiter chaque onglet pour savoir si quelque chose
  // a besoin d'attention. Toujours les mêmes calculs (lib/controles.ts, lib/ecritures.ts) — rien de
  // recalculé différemment ici, juste rassemblé.
  const categorieById = (id: string | null) => categories.find((c) => c.id === id) ?? null
  const immobilisationPieceIds = new Set(immobilisations.map((i) => i.piece_id).filter(Boolean))
  const piecesEligiblesEcritures = pieces.filter(
    (p) => p.montant_ttc != null && !!categorieById(p.categorie_id)?.compte_comptable && !immobilisationPieceIds.has(p.id),
  )
  const { nbSansContrepartie, groupesDesequilibres, piecesDesynchronisees } = analyserEcritures(ecritures, piecesEligiblesEcritures)
  const piecesConfianceBasse = piecesAValider.filter((p) => p.confiance === 'basse')
  const catSansCompte = categoriesSansCompte(categories, pieces)
  const catSansPoste = categoriesSansPoste(categories, pieces)
  const sansTva = piecesSansTva(pieces, assujettiTva)

  interface PointATraiter { id: string; label: string; nb: number; cible: DossierTab; severite: 'erreur' | 'attention' }
  const tousLesPointsATraiter: PointATraiter[] = [
    { id: 'desequilibrees', label: 'écriture(s) déséquilibrée(s)', nb: groupesDesequilibres.length, cible: 'ecritures', severite: 'erreur' },
    { id: 'desynchronisees', label: 'écriture(s) à régénérer (pièce modifiée depuis)', nb: piecesDesynchronisees.length, cible: 'ecritures', severite: 'erreur' },
    { id: 'confiance-basse', label: 'pièce(s) à faible confiance d\'extraction, à vérifier', nb: piecesConfianceBasse.length, cible: 'pieces', severite: 'attention' },
    { id: 'comptes-manquants', label: 'catégorie(s) sans compte comptable', nb: catSansCompte.length, cible: 'ecritures', severite: 'attention' },
    { id: 'postes-manquants', label: 'catégorie(s) sans poste 2035', nb: catSansPoste.length, cible: 'cloture', severite: 'attention' },
    { id: 'sans-tva', label: 'pièce(s) validée(s) sans TVA renseignée', nb: sansTva.length, cible: 'ecritures', severite: 'attention' },
    { id: 'sans-contrepartie', label: 'écriture(s) en attente de rapprochement bancaire', nb: nbSansContrepartie, cible: 'banque', severite: 'attention' },
  ]
  const pointsATraiter = tousLesPointsATraiter.filter((p) => p.nb > 0)
  const nbErreurs = pointsATraiter.filter((p) => p.severite === 'erreur').reduce((s, p) => s + p.nb, 0)
  const nbAttentions = pointsATraiter.filter((p) => p.severite === 'attention').reduce((s, p) => s + p.nb, 0)

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
      {pointsATraiter.length > 0 ? (
        <div className="card" style={{ marginBottom: 20, borderColor: nbErreurs > 0 ? 'var(--color-danger)' : 'var(--color-warning)' }}>
          <h3 style={{ marginTop: 0 }}>Points à traiter</h3>
          <p className="muted" style={{ marginTop: -8 }}>
            {nbErreurs > 0 && <>{nbErreurs} erreur{nbErreurs > 1 ? 's' : ''} probable{nbErreurs > 1 ? 's' : ''}</>}
            {nbErreurs > 0 && nbAttentions > 0 && ' — '}
            {nbAttentions > 0 && <>{nbAttentions} à vérifier</>}
            {' '}— déjà détecté dans Pièces, Écritures ou Clôture, juste rassemblé ici pour ne pas avoir à visiter chaque onglet.
          </p>
          <div className="card" style={{ padding: 0 }}>
            {pointsATraiter.map((p) => (
              <div key={p.id} className="checklist-item">
                <span
                  className="pastille"
                  style={{
                    width: 14, height: 14, borderRadius: '50%', flexShrink: 0,
                    background: p.severite === 'erreur' ? 'var(--color-danger)' : 'var(--color-warning)',
                  }}
                />
                <div className="checklist-item-body">
                  <div style={{ fontWeight: 600 }}>{p.nb} {p.label}</div>
                </div>
                <button type="button" className="btn btn-outline btn-sm" onClick={() => onNavigate(p.cible)}>
                  Aller à l'onglet
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="card" style={{ marginBottom: 20, borderColor: 'var(--color-primary)' }}>
          <h3 style={{ marginTop: 0 }}>Points à traiter</h3>
          <p className="muted" style={{ margin: 0 }}>Rien à signaler pour l'instant — aucune anomalie détectée.</p>
        </div>
      )}

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
          <div key={item.id} className="checklist-item">
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
            <div className="checklist-item-body">
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
