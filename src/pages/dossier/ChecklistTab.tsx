import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { analyserEcritures, tvaNettePourPeriode } from '../../lib/ecritures'
import { categoriesSansCompte, categoriesSansPoste, piecesSansTva } from '../../lib/controles'
import { moisEcoulesCetteAnnee } from '../../lib/format'
import type { Categorie, CotisationDeclaree, DeclarationTva, EcritureBrouillon, Immobilisation, InformationsDossier, LigneBancaire, NatureImmobilisation, Piece } from '../../lib/types'
import type { DossierTab } from '../../components/DossierParcours'

const NOMS_MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']

interface ItemChecklist {
  id: string
  label: string
  ok: boolean
  detail?: string
  cible?: DossierTab
  // Libellé du bouton d'action quand `cible` est renseigné — jamais le générique "Aller à l'onglet"
  // (voir PointATraiter, même principe).
  action?: string
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
  const [declarationsTva, setDeclarationsTva] = useState<DeclarationTva[]>([])
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
      { data: declarationsData },
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
      supabase.from('declarations_tva').select('*').eq('dossier_id', dossierId),
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
    setDeclarationsTva(declarationsData ?? [])
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
  const moisEcoules = moisEcoulesCetteAnnee()

  const moisPresents = new Set(
    lignes.filter((l) => new Date(l.date).getFullYear() === anneeCourante).map((l) => new Date(l.date).getMonth() + 1),
  )
  const moisManquants = Array.from({ length: moisEcoules }, (_, i) => i + 1).filter((m) => !moisPresents.has(m))

  const cotisationsAnnee = cotisations.filter((c) => new Date(c.echeance).getFullYear() === anneeCourante)
  // Toutes les pièces reçues cette année, validées ou non : ce point vérifie que le client a bien
  // envoyé quelque chose, pas que le cabinet a fini de le vérifier (ce serait plutôt "confiance-basse"
  // ci-dessus) — se limiter aux pièces validées faisait dire "aucune pièce déposée" alors que des
  // pièces fraîchement importées, encore à valider, étaient déjà bien là.
  const piecesAnnee = [...pieces, ...piecesAValider].filter((p) => p.date_piece && new Date(p.date_piece).getFullYear() === anneeCourante)

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
  // Même tolérance qu'EcrituresTab (1 € : une CA3 se dépose en euros arrondis).
  const declarationsEnEcart = declarationsTva.filter(
    (d) => Math.abs(d.tva_declaree - tvaNettePourPeriode(ecritures, d.periode_debut, d.periode_fin)) > 1,
  )
  // Le pendant côté Banque de "en attente de rapprochement bancaire" ci-dessous (qui part des
  // écritures) : un mouvement bancaire importé mais jamais rattaché à une pièce, une cotisation, ou
  // marqué personnel/à ignorer — le seul cycle du dossier qui manquait encore à ce tableau de bord.
  const lignesNonRapprochees = lignes.filter((l) => l.statut === 'non_rapprochee')

  // "action" : le libellé du bouton, propre à chaque point plutôt qu'un "Aller à l'onglet" générique
  // répété sur toute la liste — dit ce que l'onglet cible va permettre de faire, pas juste où il est.
  interface PointATraiter { id: string; label: string; action: string; nb: number; cible: DossierTab; severite: 'erreur' | 'attention' }
  const tousLesPointsATraiter: PointATraiter[] = [
    { id: 'desequilibrees', label: 'écriture(s) déséquilibrée(s)', action: 'Voir les écritures déséquilibrées', nb: groupesDesequilibres.length, cible: 'ecritures', severite: 'erreur' },
    { id: 'desynchronisees', label: 'écriture(s) à régénérer (pièce modifiée depuis)', action: 'Régénérer les écritures concernées', nb: piecesDesynchronisees.length, cible: 'ecritures', severite: 'erreur' },
    { id: 'tva-en-ecart', label: 'déclaration(s) de TVA en écart avec le brouillon', action: "Voir l'écart de TVA", nb: declarationsEnEcart.length, cible: 'ecritures', severite: 'erreur' },
    { id: 'confiance-basse', label: 'pièce(s) à faible confiance d\'extraction, à vérifier', action: 'Vérifier ces pièces', nb: piecesConfianceBasse.length, cible: 'pieces', severite: 'attention' },
    { id: 'comptes-manquants', label: 'catégorie(s) sans compte comptable', action: 'Compléter le compte comptable', nb: catSansCompte.length, cible: 'ecritures', severite: 'attention' },
    { id: 'postes-manquants', label: 'catégorie(s) sans poste 2035', action: 'Compléter le poste 2035', nb: catSansPoste.length, cible: 'cloture', severite: 'attention' },
    { id: 'sans-tva', label: 'pièce(s) validée(s) sans TVA renseignée', action: 'Compléter la TVA', nb: sansTva.length, cible: 'ecritures', severite: 'attention' },
    { id: 'sans-contrepartie', label: 'écriture(s) en attente de rapprochement bancaire', action: 'Voir les écritures à rapprocher', nb: nbSansContrepartie, cible: 'banque', severite: 'attention' },
    { id: 'lignes-non-rapprochees', label: 'ligne(s) bancaire(s) non rapprochée(s)', action: 'Voir les opérations à rapprocher', nb: lignesNonRapprochees.length, cible: 'banque', severite: 'attention' },
  ]
  const pointsATraiter = tousLesPointsATraiter.filter((p) => p.nb > 0)
  // Trois groupes distincts (voir audit ergonomie) plutôt qu'un seul total mélangeant des natures très
  // différentes ("315 à vérifier" ne dit rien d'actionnable si 312 sont des lignes bancaires courantes
  // et 3 des vraies erreurs) : paramétrage (config à finir une fois, ne dépend pas du client), travail
  // courant du cabinet (à traiter au fil de l'eau), documents attendus (dépend du client, voir `items`
  // plus bas). Un déséquilibre ou une désynchronisation reste plus urgent qu'une case de paramétrage,
  // d'où la sévérité conservée à l'intérieur du groupe "Travail à effectuer".
  const IDS_PARAMETRAGE = new Set(['comptes-manquants', 'postes-manquants'])
  const pointsParametrage = pointsATraiter.filter((p) => IDS_PARAMETRAGE.has(p.id))
  const pointsTravail = pointsATraiter.filter((p) => !IDS_PARAMETRAGE.has(p.id))

  const items: ItemChecklist[] = [
    {
      id: 'banque',
      label: `Relevés bancaires ${anneeCourante}`,
      ok: moisManquants.length === 0,
      // moisEcoules à 0 (janvier, aucun mois encore révolu) : rien à réclamer pour l'instant, pas un
      // "0/0" qui se lirait comme un compte à rebours étrange.
      detail: moisEcoules === 0
        ? "Aucun mois encore révolu cette année"
        : moisManquants.length > 0
          ? `Mois manquants : ${moisManquants.map((m) => NOMS_MOIS[m - 1]).join(', ')}`
          : `${moisEcoules}/${moisEcoules} mois reçus`,
      cible: 'banque',
      action: 'Importer le relevé manquant',
    },
    {
      id: 'cotisations',
      label: `Appels de cotisation ${anneeCourante}`,
      ok: cotisationsAnnee.length > 0,
      detail: cotisationsAnnee.length > 0 ? `${cotisationsAnnee.length} échéance(s) enregistrée(s)` : 'Aucune échéance enregistrée pour cette année',
      cible: 'cotisations',
      action: 'Voir les cotisations',
    },
    {
      id: 'factures',
      label: `Factures / pièces ${anneeCourante}`,
      ok: piecesAnnee.length > 0,
      detail: piecesAnnee.length > 0 ? `${piecesAnnee.length} pièce(s) déposée(s)` : 'Aucune pièce déposée pour cette année',
      cible: 'pieces',
      action: 'Voir les pièces',
    },
  ]

  if (!info) {
    items.push({
      id: 'informations',
      label: 'Informations complémentaires du client',
      ok: false,
      detail: 'Véhicule, tickets restaurant, chèques vacances… à renseigner une fois',
      cible: 'informations',
      action: 'Compléter les informations',
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
        action: 'Enregistrer le véhicule',
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

  // Bloc "Paramétrage" / "Travail à effectuer" : même présentation pour les deux, un compteur séparé
  // par groupe plutôt qu'un total unique mélangeant leurs natures (voir audit ergonomie). Une seule
  // carte, pas une carte dans une carte : les lignes sont juste séparées par un filet, la couleur
  // réservée à la pastille de chaque ligne plutôt qu'à la bordure entière du bloc — moins de boîtes
  // empilées, moins de couleur qui crie (voir discussion sur l'aspect "amateur").
  function blocPoints(titre: string, points: PointATraiter[], texteVide: string) {
    return (
      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>{titre}</h3>
        {points.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>{texteVide}</p>
        ) : (
          <div>
            {points.map((p, i) => (
              <div
                key={p.id}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderTop: i > 0 ? '1px solid var(--color-border)' : 'none' }}
              >
                <span
                  style={{
                    width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                    background: p.severite === 'erreur' ? 'var(--color-danger)' : 'var(--color-warning)',
                  }}
                />
                <div style={{ flex: 1, minWidth: 0, fontWeight: 600 }}>{p.nb} {p.label}</div>
                <button type="button" className="btn btn-outline btn-sm" onClick={() => onNavigate(p.cible)}>
                  {p.action}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <>
      {blocPoints('Paramétrage à compléter', pointsParametrage, 'Rien à compléter — comptes et postes 2035 sont renseignés.')}
      {blocPoints('Travail à effectuer', pointsTravail, 'Rien à signaler pour l\'instant — aucune anomalie détectée.')}

      {/* Troisième bloc : ce qui dépend du client (documents), pas du cabinet — sur une échelle
          différente des deux blocs ci-dessus (des anomalies internes), d'où la séparation nette plutôt
          qu'un total combiné. */}
      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Documents attendus</h3>
        <p className="muted" style={{ marginTop: -8, marginBottom: 14 }}>
          {nbOk}/{items.length} reçu(s) — ce que le dossier attend du client, à ne pas confondre avec le travail interne ci-dessus.
        </p>
        <div className="progress-track" style={{ marginBottom: 4 }}>
          <div
            className={`progress-fill ${nbManquants > 0 ? 'warning' : ''}`}
            style={{ width: `${items.length > 0 ? (nbOk / items.length) * 100 : 100}%` }}
          />
        </div>
        <div>
          {items.map((item, i) => (
            <div
              key={item.id}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderTop: i > 0 ? '1px solid var(--color-border)' : 'none' }}
            >
              <button
                type="button"
                onClick={item.onToggle}
                disabled={!item.onToggle}
                title={item.onToggle ? 'Cliquer pour marquer comme reçu/non reçu' : undefined}
                style={{
                  width: 8, height: 8, borderRadius: '50%', border: 'none', flexShrink: 0, padding: 0,
                  background: item.ok ? 'var(--color-primary)' : 'var(--color-danger)',
                  cursor: item.onToggle ? 'pointer' : 'default',
                }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{item.label}</div>
                {item.detail && <div className="muted" style={{ fontSize: '0.82rem' }}>{item.detail}</div>}
              </div>
              {item.cible && !item.ok && (
                <button type="button" className="btn btn-outline btn-sm" onClick={() => onNavigate(item.cible!)}>
                  {item.action ?? 'Voir'}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
