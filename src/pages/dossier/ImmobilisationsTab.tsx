import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { lireTout } from '../../lib/lectureComplete'
import { anneeDe, dateLocaleDe, formatDate, formatMoney } from '../../lib/format'
import { dotationsNonProratisees, RESERVE_PRORATA_TEMPORIS } from '../../lib/declaration2035'
import { immobilisationSansJustificatif } from '../../lib/controles'
import type { Immobilisation, NatureImmobilisation, Piece } from '../../lib/types'
import BrouillonBanner from '../../components/BrouillonBanner'
import AnneeTabs, { type ValeurAnnee } from '../../components/AnneeTabs'
import BarreRecherche from '../../components/BarreRecherche'
import { correspondALaRecherche } from '../../lib/recherche'
import { messageErreur } from '../../lib/messageErreur'
import BandeauLecturePartielle from '../../components/BandeauLecturePartielle'

// Seuil au-delà duquel une dépense est candidate à l'immobilisation plutôt qu'à la charge courante.
// Valeur usuelle citée dans le document d'architecture — pas encore configurable par dossier, cette
// version couvre le cas standard.
const SEUIL_IMMOBILISATION = 500
const DUREE_DEFAUT_ANNEES = 5

// Palier 5, brique 2 — registre des immobilisations. Une pièce validée dépassant le seuil est
// proposée comme candidate ; c'est toujours le cabinet qui décide de l'enregistrer comme telle
// (jamais automatique). La nature du bien (téléphone, véhicule...) suggère une durée d'amortissement
// usuelle — toujours modifiable, l'arbitrage réel restant à l'expert-comptable. La dotation annuelle
// affichée est un calcul linéaire simple, sans prorata temporis.
//
// CETTE RÉSERVE-LÀ RENVOYAIT À « LE BANDEAU », QUI NE LA PORTE PAS : le bandeau de cet écran est le
// rappel générique « Brouillon », affiché partout, et il ne dit rien de la première annuité. La
// réserve ne vivait donc que dans ce commentaire, pendant que l'écran affichait une colonne
// « Dotation annuelle » qui a toutes les apparences d'une annuité calculée. Elle est désormais
// CALCULÉE et montrée (voir `dotationsNonProratisees`), et seulement quand elle apprend quelque
// chose — un bien acquis le 1er janvier a bien une première annuité pleine.
export default function ImmobilisationsTab({ dossierId }: { dossierId: string }) {
  const [piecesValidees, setPiecesValidees] = useState<Piece[]>([])
  const [lectureIncomplete, setLectureIncomplete] = useState<string | null>(null)
  const [immobilisations, setImmobilisations] = useState<Immobilisation[]>([])
  const [natures, setNatures] = useState<NatureImmobilisation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [naturesChoisies, setNaturesChoisies] = useState<Record<string, string>>({})
  const [durees, setDurees] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [anneeFilter, setAnneeFilter] = useState<ValeurAnnee>('toutes')
  const [recherche, setRecherche] = useState('')

  async function load() {
    setLoading(true)
    const [lecturePieces, lectureImmobilisations, lectureNatures] = await Promise.all([
      // Lue par tranches (voir lib/lectureComplete.ts) : c'est parmi ces pièces qu'on choisit celle
      // à immobiliser, et une liste tronquée ne paraît pas tronquée.
      // `piecesValidees` et non `pieces` : la lecture ne rend QUE les validées, et le filtre est
      // juste — on immobilise une facture vérifiée, pas une pièce en attente d'arbitrage. C'est le
      // NOM qui mentait. Cet écran est le seul des sept à avoir échappé au renommage de 2026 (voir
      // CLAUDE.md, « un nom qui ment sur son filtre »).
      lireTout<Piece>((debut, fin) =>
        supabase.from('pieces').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).eq('statut', 'validee').order('id').range(debut, fin),
      ),
      lireTout<Immobilisation>((debut, fin) =>
        supabase.from('immobilisations').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).order('date_acquisition', { ascending: false }).order('id').range(debut, fin),
      ),
      lireTout<NatureImmobilisation>((debut, fin) =>
        supabase.from('natures_immobilisation').select('*', { count: 'exact' })
          .or(`dossier_id.eq.${dossierId},dossier_id.is.null`).order('ordre').order('id').range(debut, fin),
      ),
    ])
    setPiecesValidees(lecturePieces.lignes)
    setImmobilisations(lectureImmobilisations.lignes)
    setNatures(lectureNatures.lignes)
    setLectureIncomplete(
      [lecturePieces, lectureImmobilisations, lectureNatures]
        .find((l) => !l.complete)?.motif ?? null,
    )
    setLoading(false)
  }

  useEffect(() => { load() }, [dossierId])

  const dejaEnregistrees = new Set(immobilisations.map((i) => i.piece_id).filter(Boolean))
  const candidates = piecesValidees.filter(
    (p) => p.montant_ttc != null && p.montant_ttc >= SEUIL_IMMOBILISATION && !dejaEnregistrees.has(p.id),
  )
  const natureLabel = (id: string | null) => natures.find((n) => n.id === id)?.libelle ?? '—'

  // Le filtre par année ne porte que sur le registre déjà enregistré — les candidates restent toujours
  // toutes affichées (une pièce ancienne oubliée reste à traiter quelle que soit l'année sélectionnée).
  const anneesDisponibles = [...new Set(immobilisations.map((i) => anneeDe(i.date_acquisition)))].sort((a, b) => b - a)
  const immobilisationsFiltrees = anneeFilter === 'toutes'
    ? immobilisations
    : immobilisations.filter((i) => anneeDe(i.date_acquisition) === anneeFilter)

  // La recherche ne porte que sur le registre, pas sur les candidates : celles-ci sont une liste de
  // tâches à traiter, bornée par le seuil, et en masquer une derrière un filtre de texte reviendrait
  // à la faire oublier.
  const immobilisationsAffichees = immobilisationsFiltrees.filter((i) =>
    correspondALaRecherche(
      [i.libelle, natureLabel(i.nature_id), i.valeur, i.date_acquisition, formatDate(i.date_acquisition), i.duree_annees],
      recherche,
    ),
  )

  // La même fonction que Clôture, appelée sur chaque exercice d'acquisition présent : la colonne
  // « Dotation annuelle » ci-dessous est pleine pour tout le monde, et il faut dire pour qui c'est
  // faux.
  //
  // Sur l'ensemble d'AVANT la recherche, jamais sur `immobilisationsAffichees` — et c'est la règle
  // du projet prise par son côté le plus coûteux : une recherche ne doit pas fabriquer une ALERTE
  // (le piège de la Balance des comptes), mais elle doit encore moins en faire disparaître une, ce
  // qui fabrique une BONNE nouvelle que personne n'ira vérifier (le piège de la liste des dossiers).
  // La note NOMME le bien, donc elle reste exploitable même si la recherche le masque.
  const dotationsAReprendre = anneesDisponibles.flatMap((a) => dotationsNonProratisees(immobilisationsFiltrees, a))

  // Changer la nature choisie pré-remplit la durée suggérée, sans écraser une durée déjà modifiée à la
  // main pour cette pièce.
  function choisirNature(pieceId: string, natureId: string) {
    setNaturesChoisies((prev) => ({ ...prev, [pieceId]: natureId }))
    const nature = natures.find((n) => n.id === natureId)
    if (nature && !durees[pieceId]) {
      setDurees((prev) => ({ ...prev, [pieceId]: String(nature.duree_annees_defaut) }))
    }
  }

  async function ajouterNature() {
    const libelle = window.prompt('Nom de la nature (ex : Matériel médical, Mobilier...)')
    if (!libelle || !libelle.trim()) return
    const dureeStr = window.prompt('Durée d\'amortissement usuelle (en années)', String(DUREE_DEFAUT_ANNEES))
    const duree = parseInt(dureeStr ?? '', 10)
    if (!duree || duree < 1) return
    const { error: insertError } = await supabase.from('natures_immobilisation').insert({
      dossier_id: dossierId,
      libelle: libelle.trim(),
      duree_annees_defaut: duree,
    })
    if (insertError) {
      window.alert(insertError.message)
      return
    }
    load()
  }

  async function enregistrer(piece: Piece) {
    const duree = parseInt(durees[piece.id] ?? String(DUREE_DEFAUT_ANNEES), 10)
    if (!duree || duree < 1) {
      setError('Durée invalide.')
      return
    }
    setSaving(piece.id)
    setError(null)
    try {
      const { error: insertError } = await supabase.from('immobilisations').insert({
        dossier_id: dossierId,
        piece_id: piece.id,
        nature_id: naturesChoisies[piece.id] || null,
        libelle: piece.tiers ?? piece.nom_fichier,
        valeur: piece.montant_ttc,
        date_acquisition: piece.date_piece ?? dateLocaleDe(piece.created_at),
        duree_annees: duree,
      })
      if (insertError) throw insertError
      load()
    } catch (err) {
      // Contrainte unique sur piece_id (voir migration immobilisations_piece_id_unique) : deux onglets
      // ouverts, un double-clic ou une liste d'immobilisations lue à moitié peuvent tenter
      // d'enregistrer la même pièce deux fois.
      //
      // Reconnue à son CODE, jamais à l'héritage : l'erreur arrive ici par `throw insertError`, un
      // objet Postgrest NU, qui n'est pas une instance d'`Error`. Le test `err instanceof Error`
      // d'avant rendait donc ce message impossible — l'opérateur lisait la phrase brute de Postgres,
      // et la liste n'était pas relue (voir lib/messageErreur.ts, même défaut sous une autre forme).
      if ((err as { code?: unknown } | null)?.code === '23505') {
        setError('Cette pièce a déjà été enregistrée comme immobilisation.')
        load()
        return
      }
      setError(messageErreur(err))
    } finally {
      setSaving(null)
    }
  }

  async function retirer(i: Immobilisation) {
    // La phrase « la pièce redevient une charge » suppose qu'il RESTE une pièce. Sur une
    // immobilisation dont le justificatif a été supprimé — l'état que signale
    // `immobilisationSansJustificatif`, et dont l'action recommandée EST ce bouton — elle est
    // fausse, et elle rassure à l'envers : rien ne redevient une charge, et le retrait efface la
    // dernière trace comptable de la dépense (plus de pièce, donc plus d'amortissement non plus).
    const confirmation = immobilisationSansJustificatif(i)
      ? 'Retirer cette immobilisation ? Son justificatif a déjà été supprimé : l’amortissement '
        + 'disparaît de la 2035 et rien ne le remplace — cette dépense ne sera plus comptée nulle part.'
      : 'Retirer cette immobilisation ? La pièce redevient une charge courante ordinaire.'
    if (!window.confirm(confirmation)) return
    await supabase.from('immobilisations').delete().eq('id', i.id)
    load()
  }

  return (
    <>
      <BandeauLecturePartielle
        quoi="Les immobilisations et les pièces validées"
        motif={lectureIncomplete}
        consequence={
          'Le tableau d’amortissement et le total des dotations ci-dessous portent donc sur une partie ' +
          'du dossier, et une pièce déjà immobilisée peut réapparaître dans les candidates.'
        }
      />
      <BrouillonBanner />

      {candidates.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
            <h3 style={{ marginTop: 0 }}>Candidates à l'immobilisation</h3>
            <button className="btn btn-outline btn-sm" onClick={ajouterNature}>+ Nature</button>
          </div>
          <p className="muted" style={{ marginTop: -8 }}>
            Pièces validées de {formatMoney(SEUIL_IMMOBILISATION)} ou plus — à toi de décider si c'est un
            investissement (matériel, véhicule…) ou une simple charge importante. La nature suggère une
            durée usuelle, toujours modifiable.
          </p>
          {/* Dans un conteneur qui défile, comme les autres tableaux : avec le panneau de droite ouvert,
              la colonne du bouton débordait du panneau central et passait sous le volet. */}
          <div className="table-scroll">
            <table>
              <thead><tr><th>Pièce</th><th>Montant</th><th>Nature</th><th>Durée (années)</th><th></th></tr></thead>
              <tbody>
                {candidates.map((p) => (
                  <tr key={p.id}>
                    <td>{p.tiers ?? p.nom_fichier}</td>
                    <td>{formatMoney(p.montant_ttc)}</td>
                    <td>
                      <select
                        style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: '5px 8px' }}
                        value={naturesChoisies[p.id] ?? ''}
                        onChange={(e) => choisirNature(p.id, e.target.value)}
                      >
                        <option value="">— Choisir —</option>
                        {natures.map((n) => <option key={n.id} value={n.id}>{n.libelle}</option>)}
                      </select>
                    </td>
                    <td>
                      <input
                        type="number"
                        min={1}
                        style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: '5px 8px', width: 70 }}
                        placeholder={String(DUREE_DEFAUT_ANNEES)}
                        value={durees[p.id] ?? ''}
                        onChange={(e) => setDurees((prev) => ({ ...prev, [p.id]: e.target.value }))}
                      />
                    </td>
                    <td>
                      <button className="btn btn-outline btn-sm" disabled={saving === p.id} onClick={() => enregistrer(p)}>
                        {saving === p.id ? 'Enregistrement…' : 'Enregistrer comme immobilisation'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {error && <p className="error-text">{error}</p>}

      <AnneeTabs annees={anneesDisponibles} valeur={anneeFilter} onChange={setAnneeFilter} />

      <div style={{ marginBottom: 14 }}>
        <BarreRecherche
          valeur={recherche}
          onChange={setRecherche}
          placeholder="Rechercher un libellé, une nature, un montant…"
          affiches={immobilisationsAffichees.length}
          total={immobilisationsFiltrees.length}
        />
      </div>

      {dotationsAReprendre.length > 0 && (
        <div className="card" style={{ marginBottom: 20, borderLeft: '3px solid var(--color-warning)' }}>
          <h3 style={{ marginTop: 0 }}>
            Première annuité à reprendre ({dotationsAReprendre.length})
          </h3>
          <p className="muted" style={{ marginTop: -8 }}>{RESERVE_PRORATA_TEMPORIS}</p>
          <table>
            <thead>
              <tr>
                <th>Bien</th>
                <th>Acquisition</th>
                <th style={{ textAlign: 'right' }}>Dotation comptée</th>
                <th style={{ textAlign: 'right' }}>Prorata temporis</th>
              </tr>
            </thead>
            <tbody>
              {dotationsAReprendre.map((d) => (
                <tr key={`${d.libelle}-${d.dateAcquisition}`}>
                  <td>{d.libelle}</td>
                  <td>{formatDate(d.dateAcquisition)}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--color-danger)' }}>
                    {formatMoney(d.dotationComptee)}
                  </td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {formatMoney(d.dotationProratisee)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card table-scroll" style={{ padding: 0 }}>
        {loading ? (
          <p className="muted" style={{ padding: 20 }}>Chargement…</p>
        ) : immobilisationsAffichees.length === 0 ? (
          <div className="empty-state">
            {recherche.trim()
              ? `Aucune immobilisation ne correspond à « ${recherche.trim()} ».`
              : "Aucune immobilisation enregistrée pour l'instant."}
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Libellé</th>
                <th>Nature</th>
                <th>Valeur</th>
                <th>Date d'acquisition</th>
                <th>Durée</th>
                <th>Dotation annuelle</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {immobilisationsAffichees.map((i) => (
                <tr key={i.id}>
                  <td>
                    {i.libelle}
                    {/* `piece_id` nul ne peut venir que d'une pièce supprimée : le seul chemin de
                        création de cet écran pose toujours le lien. La dotation, elle, continue de
                        partir en case CH — voir `immobilisationSansJustificatif`. */}
                    {immobilisationSansJustificatif(i) && (
                      <span className="badge badge-danger" style={{ marginLeft: 8 }}>Justificatif supprimé</span>
                    )}
                  </td>
                  <td>{natureLabel(i.nature_id)}</td>
                  <td>{formatMoney(i.valeur)}</td>
                  <td>{formatDate(i.date_acquisition)}</td>
                  <td>{i.duree_annees} an{i.duree_annees > 1 ? 's' : ''}</td>
                  <td>{formatMoney(i.valeur / i.duree_annees)}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <button className="btn btn-danger btn-sm" onClick={() => retirer(i)}>Retirer</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}
