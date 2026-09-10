import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { supabase } from '../../lib/supabase'
import { detectColumnMapping, parseCsv, parseDateBancaire, parseMontantBancaire } from '../../lib/csv'
import { extractPdfText, parseLignesFromPdfText, type LigneExtraite } from '../../lib/pdfText'
import { formatDate, formatMoney } from '../../lib/format'
import { retirerContrepartieBanque, synchroniserContrepartieBanque } from '../../lib/ecritures'
import type { CotisationDeclaree, DocumentDivers, LigneBancaire, Piece, RegleBancaireIgnoree, StatutLigneBancaire } from '../../lib/types'
import { useAnnee } from '../../context/AnneeContext'

const JOURS_TOLERANCE_RAPPROCHEMENT = 5
const NOMS_MOIS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre']

// Signature (date, libellé, montant) d'un mouvement bancaire — sert à repérer un doublon d'import
// (le même relevé déposé deux fois, CSV ou PDF) avant l'insertion. Le montant est arrondi à 2
// décimales pour éviter qu'un écart d'arrondi flottant sans intérêt (12.1 vs 12.10) fasse manquer un
// vrai doublon.
function signatureLigne(l: { date: string; libelle: string; montant: number }): string {
  return `${l.date}|${l.libelle}|${l.montant.toFixed(2)}`
}

// Trie les pièces/cotisations candidates du menu "Associer à…" par plausibilité pour cette ligne —
// montant identique d'abord, puis proximité de date — plutôt que dans l'ordre de la requête, qui
// mélangeait sans distinction une pièce de l'année en cours avec une pièce de deux ans plus tôt (voir
// audit ergonomie). Un score, pas un filtre : aucune candidate n'est retirée, on peut toujours associer
// une pièce d'une autre année, juste plus bas dans la liste plutôt qu'au hasard.
function scoreCorrespondance(montantRef: number | null, dateRef: string | null, ligne: LigneBancaire): number {
  const montantOk = montantRef != null && Math.abs(Math.abs(montantRef) - Math.abs(ligne.montant)) <= 0.01
  const jours = dateRef ? Math.abs(new Date(dateRef).getTime() - new Date(ligne.date).getTime()) / 86_400_000 : Number.MAX_SAFE_INTEGER
  return (montantOk ? 0 : 1_000_000) + jours
}

export default function BanqueTab({ dossierId }: { dossierId: string }) {
  const [lignes, setLignes] = useState<LigneBancaire[]>([])
  const [pieces, setPieces] = useState<Piece[]>([])
  const [cotisations, setCotisations] = useState<CotisationDeclaree[]>([])
  const [regles, setRegles] = useState<RegleBancaireIgnoree[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'toutes' | StatutLigneBancaire>('non_rapprochee')
  // Exercice partagé avec Pièces/Écritures/Statistiques/Clôture, sélectionné dans l'en-tête du
  // dossier (voir AnneeContext) — pas de sélecteur local ici.
  const { annee: anneeFilter } = useAnnee()
  // 'tous' ou un mois 0-11 — remis à 'tous' à chaque changement d'année pour ne jamais rester bloqué
  // sur un mois qui n'existe plus dans la nouvelle année sélectionnée.
  const [moisFilter, setMoisFilter] = useState<'tous' | number>('tous')
  useEffect(() => { setMoisFilter('tous') }, [anneeFilter])
  const [recherche, setRecherche] = useState('')
  const [rapprochementAuto, setRapprochementAuto] = useState(false)
  // Ligne ouverte dans le panneau de détail (voir plus bas) — le tableau lui-même reste compact
  // (date/libellé/montant/statut uniquement) : sur un dossier avec plusieurs centaines de mouvements,
  // afficher les boutons et menus de rapprochement sur chaque ligne rendait l'écran interminable
  // (voir audit ergonomie). Toutes les actions vivent maintenant dans ce panneau, une ligne à la fois.
  const [ligneOuverte, setLigneOuverte] = useState<LigneBancaire | null>(null)

  async function load() {
    setLoading(true)
    const { data: lignesData } = await supabase
      .from('lignes_bancaires')
      .select('*')
      .eq('dossier_id', dossierId)
      .order('date', { ascending: false })

    const { data: piecesData } = await supabase
      .from('pieces')
      .select('*')
      .eq('dossier_id', dossierId)
      .eq('statut', 'validee')

    const { data: cotisationsData } = await supabase
      .from('cotisations_declarees')
      .select('*')
      .eq('dossier_id', dossierId)

    const { data: reglesData } = await supabase
      .from('regles_bancaires_ignorees')
      .select('*')
      .eq('dossier_id', dossierId)
      .order('motif')

    setLignes(lignesData ?? [])
    setPieces(piecesData ?? [])
    setCotisations(cotisationsData ?? [])
    setRegles(reglesData ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [dossierId])

  const piecesRapprochees = useMemo(() => new Set(lignes.filter((l) => l.piece_id).map((l) => l.piece_id)), [lignes])
  const piecesSansMouvement = pieces.filter((p) => !piecesRapprochees.has(p.id))
  const cotisationsRapprochees = useMemo(() => new Set(lignes.filter((l) => l.cotisation_id).map((l) => l.cotisation_id)), [lignes])
  const cotisationsSansMouvement = cotisations.filter((c) => !cotisationsRapprochees.has(c.id))


  // Mois proposés dans le filtre : seulement ceux qui existent réellement dans l'année déjà
  // sélectionnée (et le statut déjà filtré) — jamais les 12 mois de l'année par défaut, dont la
  // plupart seraient vides sur un dossier récent.
  const lignesAnneeEtStatut = lignes.filter((l) => {
    if (filter !== 'toutes' && l.statut !== filter) return false
    if (anneeFilter !== 'toutes' && new Date(l.date).getFullYear() !== anneeFilter) return false
    return true
  })
  const moisDisponibles = [...new Set(lignesAnneeEtStatut.map((l) => new Date(l.date).getMonth()))].sort((a, b) => a - b)

  const rechercheNormalisee = recherche.trim().toLowerCase()
  const filtered = lignesAnneeEtStatut.filter((l) => {
    if (moisFilter !== 'tous' && new Date(l.date).getMonth() !== moisFilter) return false
    if (rechercheNormalisee) {
      const matchLibelle = l.libelle.toLowerCase().includes(rechercheNormalisee)
      const matchMontant = l.montant.toFixed(2).replace('.', ',').includes(rechercheNormalisee)
      if (!matchLibelle && !matchMontant) return false
    }
    return true
  })

  function suggestion(ligne: LigneBancaire): Piece | null {
    if (ligne.statut !== 'non_rapprochee') return null
    const ligneDate = new Date(ligne.date).getTime()
    const candidats = pieces.filter((p) => {
      if (piecesRapprochees.has(p.id)) return false
      if (p.montant_ttc == null) return false
      if (Math.abs(Math.abs(p.montant_ttc) - Math.abs(ligne.montant)) > 0.01) return false
      if (!p.date_piece) return false
      const jours = Math.abs(new Date(p.date_piece).getTime() - ligneDate) / 86_400_000
      return jours <= JOURS_TOLERANCE_RAPPROCHEMENT
    })
    return candidats[0] ?? null
  }

  // Même logique que pour les pièces, mais comparée au montant réellement versé (montant_verse) quand
  // il est connu — un appel n'est pas toujours prélevé pour son montant appelé exact (régularisation,
  // paiement partiel) — sinon au montant appelé, seul chiffre disponible avant paiement.
  function suggestionCotisation(ligne: LigneBancaire): CotisationDeclaree | null {
    if (ligne.statut !== 'non_rapprochee') return null
    const ligneDate = new Date(ligne.date).getTime()
    const candidats = cotisations.filter((c) => {
      if (cotisationsRapprochees.has(c.id)) return false
      const montantRef = c.montant_verse ?? c.montant_appele
      if (Math.abs(Math.abs(montantRef) - Math.abs(ligne.montant)) > 0.01) return false
      const jours = Math.abs(new Date(c.echeance).getTime() - ligneDate) / 86_400_000
      return jours <= JOURS_TOLERANCE_RAPPROCHEMENT
    })
    return candidats[0] ?? null
  }

  // Un prélèvement récurrent (assurance, virement personnel...) sans règle "Toujours ignorer" — soit
  // parce que le libellé varie légèrement d'un mois à l'autre (une date ou un numéro dedans), soit
  // simplement parce que personne n'a pensé à créer la règle — se retraite à la main chaque mois sans
  // que l'appli s'en souvienne. Repère ici un mouvement au même montant et à peu près au même jour du
  // mois qu'un ou plusieurs mois précédents déjà résolus de façon cohérente (tous ignorés, ou tous
  // marqués virement personnel) et propose d'appliquer la même résolution — jamais si les résolutions
  // passées divergent, ni sur une seule occurrence antérieure (trop tôt pour parler de récurrence).
  function suggestionRecurrente(ligne: LigneBancaire): { action: 'ignorer' | 'virement_personnel'; occurrences: number } | null {
    if (ligne.statut !== 'non_rapprochee') return null
    const jourLigne = new Date(ligne.date).getDate()
    const moisLigne = new Date(ligne.date).getFullYear() * 12 + new Date(ligne.date).getMonth()

    const correspondances = lignes.filter((l) => {
      if (l.id === ligne.id) return false
      if (Math.abs(l.montant - ligne.montant) > 0.01) return false
      const moisL = new Date(l.date).getFullYear() * 12 + new Date(l.date).getMonth()
      if (moisL === moisLigne) return false
      if (Math.abs(new Date(l.date).getDate() - jourLigne) > 3) return false
      return l.prelevement_personnel || l.statut === 'ignoree'
    })
    if (correspondances.length < 2) return null

    if (correspondances.every((l) => l.prelevement_personnel)) {
      return { action: 'virement_personnel', occurrences: correspondances.length }
    }
    if (correspondances.every((l) => l.statut === 'ignoree' && !l.prelevement_personnel)) {
      return { action: 'ignorer', occurrences: correspondances.length }
    }
    return null
  }

  // Correctif audit sécurité (rapprochements, Importante) : le résultat de la mise à jour de
  // lignes_bancaires était ignoré — en cas d'échec (RLS, réseau...), le code créait quand même la
  // contrepartie banque comme si le rapprochement avait réussi, laissant une écriture de contrepartie
  // pour un mouvement qui, en base, n'est pas réellement marqué rapproché. On vérifie maintenant
  // l'erreur avant d'enchaîner sur l'opération dépendante, et on la signale plutôt que de la taire.
  async function rapprocher(ligneId: string, pieceId: string) {
    const { error } = await supabase.from('lignes_bancaires').update({ statut: 'rapprochee', piece_id: pieceId, cotisation_id: null }).eq('id', ligneId)
    if (error) { window.alert(`Le rapprochement n'a pas pu être enregistré : ${error.message}`); return }
    const ligne = lignes.find((l) => l.id === ligneId)
    const piece = pieces.find((p) => p.id === pieceId)
    if (ligne && piece) await synchroniserContrepartieBanque(dossierId, piece, ligne)
    load()
  }

  async function rapprocherCotisation(ligneId: string, cotisationId: string) {
    const { error } = await supabase.from('lignes_bancaires').update({ statut: 'rapprochee', cotisation_id: cotisationId, piece_id: null }).eq('id', ligneId)
    if (error) { window.alert(`Le rapprochement n'a pas pu être enregistré : ${error.message}`); return }
    load()
  }

  async function annulerRapprochement(ligneId: string) {
    const ancienPieceId = lignes.find((l) => l.id === ligneId)?.piece_id ?? null
    const { error } = await supabase.from('lignes_bancaires').update({
      statut: 'non_rapprochee', piece_id: null, cotisation_id: null, prelevement_personnel: false,
    }).eq('id', ligneId)
    if (error) { window.alert(`L'annulation du rapprochement n'a pas pu être enregistrée : ${error.message}`); return }
    if (ancienPieceId) await retirerContrepartieBanque(ancienPieceId)
    load()
  }

  async function ignorer(ligneId: string) {
    await supabase.from('lignes_bancaires').update({ statut: 'ignoree', piece_id: null }).eq('id', ligneId)
    load()
  }

  // Virement du compte pro vers le compte personnel — n'a ni pièce ni échéance à rattacher (ce n'est
  // pas une charge), donc classé "ignoree" comme n'importe quel mouvement sans justificatif, mais avec
  // ce drapeau à part pour rester identifiable dans l'onglet Virements plutôt que de se perdre parmi
  // les autres lignes ignorées (assurance, etc.).
  async function marquerVirementPersonnel(ligneId: string) {
    await supabase.from('lignes_bancaires').update({
      statut: 'ignoree', piece_id: null, cotisation_id: null, prelevement_personnel: true,
    }).eq('id', ligneId)
    load()
  }

  // Ignore cette ligne ET mémorise un mot-clé pour que toutes les lignes similaires (déjà importées
  // ou futures) soient automatiquement classées "ignorées" — utile pour les prélèvements récurrents
  // (assurance, cotisations) qui n'ont pas de pièce à fournir à chaque échéance.
  async function toujoursIgnorer(ligne: LigneBancaire) {
    const motif = window.prompt(
      'Mot-clé stable qui identifie ce type de mouvement récurrent (ex. "MACSF", "SWISSLIFE") — toute future ligne contenant ce mot sera automatiquement ignorée.',
      ligne.libelle,
    )
    if (!motif || !motif.trim()) return
    const motifNormalise = motif.trim().toLowerCase()

    const { error } = await supabase.from('regles_bancaires_ignorees').insert({ dossier_id: dossierId, motif: motifNormalise })
    if (error) {
      window.alert(error.message)
      return
    }

    const aMettreAJour = lignes.filter((l) => l.statut === 'non_rapprochee' && l.libelle.toLowerCase().includes(motifNormalise))
    if (aMettreAJour.length > 0) {
      await supabase.from('lignes_bancaires').update({ statut: 'ignoree', piece_id: null }).in('id', aMettreAJour.map((l) => l.id))
    }
    load()
  }

  async function retirerRegle(id: string) {
    await supabase.from('regles_bancaires_ignorees').delete().eq('id', id)
    load()
  }

  const nonRapprochees = lignes.filter((l) => l.statut === 'non_rapprochee')
  const totalNonRapproche = nonRapprochees.reduce((s, l) => s + l.montant, 0)

  // Même critère que suggestion()/suggestionCotisation() (montant + date à ±5 jours), mais avec des
  // ensembles "consommés" locaux plutôt que piecesRapprochees/cotisationsRapprochees (dérivés de l'état
  // en base) — sinon deux mouvements différents pourraient tous les deux se voir proposer la même
  // pièce/échéance dans une seule passe, avant que l'écriture en base n'ait eu le temps de se refléter.
  function rapprochementsAutomatiques(): { ligneId: string; pieceId?: string; cotisationId?: string }[] {
    const piecesConsommees = new Set(piecesRapprochees)
    const cotisationsConsommees = new Set(cotisationsRapprochees)
    const maj: { ligneId: string; pieceId?: string; cotisationId?: string }[] = []

    for (const ligne of nonRapprochees) {
      const ligneDate = new Date(ligne.date).getTime()
      const piece = pieces.find((p) => {
        if (piecesConsommees.has(p.id)) return false
        if (p.montant_ttc == null || !p.date_piece) return false
        if (Math.abs(Math.abs(p.montant_ttc) - Math.abs(ligne.montant)) > 0.01) return false
        const jours = Math.abs(new Date(p.date_piece).getTime() - ligneDate) / 86_400_000
        return jours <= JOURS_TOLERANCE_RAPPROCHEMENT
      })
      if (piece) {
        piecesConsommees.add(piece.id)
        maj.push({ ligneId: ligne.id, pieceId: piece.id })
        continue
      }
      const cotisation = cotisations.find((c) => {
        if (cotisationsConsommees.has(c.id)) return false
        const montantRef = c.montant_verse ?? c.montant_appele
        if (Math.abs(Math.abs(montantRef) - Math.abs(ligne.montant)) > 0.01) return false
        const jours = Math.abs(new Date(c.echeance).getTime() - ligneDate) / 86_400_000
        return jours <= JOURS_TOLERANCE_RAPPROCHEMENT
      })
      if (cotisation) {
        cotisationsConsommees.add(cotisation.id)
        maj.push({ ligneId: ligne.id, cotisationId: cotisation.id })
      }
    }
    return maj
  }

  const suggestionsAutomatiques = rapprochementsAutomatiques()

  // Applique en une fois tous les rapprochements sûrs (montant + date proches, un seul candidat
  // disponible) — rien n'est écrit sans ce clic explicite, et le tableau reste modifiable/annulable
  // ligne par ligne ensuite comme n'importe quel rapprochement.
  async function rapprocherTout() {
    const maj = rapprochementsAutomatiques()
    if (maj.length === 0) return
    setRapprochementAuto(true)
    try {
      const resultats = await Promise.all(
        maj.map((m) =>
          supabase
            .from('lignes_bancaires')
            .update({ statut: 'rapprochee', piece_id: m.pieceId ?? null, cotisation_id: m.cotisationId ?? null })
            .eq('id', m.ligneId),
        ),
      )
      // Correctif audit sécurité (rapprochements, Importante) : seules les lignes réellement mises à
      // jour reçoivent leur contrepartie banque — jamais toutes en bloc, sinon un échec isolé (une
      // ligne verrouillée, une erreur réseau au milieu du lot...) laisserait une écriture de
      // contrepartie pour un mouvement qui, en base, n'est en réalité pas rapproché.
      const echecs = resultats.filter((r) => r.error)
      const reussies = maj.filter((_, i) => !resultats[i].error)
      if (echecs.length > 0) {
        window.alert(
          `${echecs.length} rapprochement${echecs.length > 1 ? 's' : ''} sur ${maj.length} n'${echecs.length > 1 ? 'ont' : 'a'} pas pu être enregistré${echecs.length > 1 ? 's' : ''} (${echecs[0].error!.message}) — les autres ont bien été appliqués.`,
        )
      }
      await Promise.all(
        reussies
          .filter((m): m is { ligneId: string; pieceId: string } => !!m.pieceId)
          .map((m) => {
            const ligne = lignes.find((l) => l.id === m.ligneId)
            const piece = pieces.find((p) => p.id === m.pieceId)
            return ligne && piece ? synchroniserContrepartieBanque(dossierId, piece, ligne) : Promise.resolve()
          }),
      )
    } finally {
      setRapprochementAuto(false)
      load()
    }
  }

  return (
    <>
      <ImportCsv dossierId={dossierId} onImported={load} regles={regles} lignesExistantes={lignes} />

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginTop: 0 }}>Écarts à vérifier</h3>
        <p className="muted" style={{ margin: 0 }}>
          {nonRapprochees.length} mouvement(s) bancaire(s) non rapproché(s) ({formatMoney(totalNonRapproche)})
          {' · '}
          {piecesSansMouvement.length} pièce(s) validée(s) sans mouvement bancaire correspondant
          {' · '}
          {cotisationsSansMouvement.length} échéance(s) de cotisation sans mouvement bancaire correspondant
        </p>
        {suggestionsAutomatiques.length > 0 && (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            style={{ marginTop: 10 }}
            disabled={rapprochementAuto}
            onClick={rapprocherTout}
          >
            {rapprochementAuto ? 'Rapprochement…' : `Tout rapprocher automatiquement (${suggestionsAutomatiques.length})`}
          </button>
        )}
        {regles.length > 0 && (
          <p className="muted" style={{ marginTop: 8, marginBottom: 0 }}>
            Ignorés automatiquement :{' '}
            {regles.map((r) => (
              <span key={r.id} className="badge badge-neutral" style={{ marginRight: 6 }}>
                {r.motif}
                <button
                  type="button"
                  onClick={() => retirerRegle(r.id)}
                  style={{ marginLeft: 6, border: 'none', background: 'none', cursor: 'pointer', color: 'inherit', fontWeight: 700 }}
                  title="Retirer cette règle"
                >
                  ×
                </button>
              </span>
            ))}
          </p>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        {(['toutes', 'non_rapprochee', 'rapprochee', 'ignoree'] as const).map((s) => (
          <button
            key={s}
            className={`btn btn-sm ${filter === s ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => setFilter(s)}
          >
            {s === 'toutes' ? 'Tous' : s === 'non_rapprochee' ? 'Non rapprochés' : s === 'rapprochee' ? 'Rapprochés' : 'Ignorés'}
          </button>
        ))}
      </div>

      {moisDisponibles.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
          <button className={`btn btn-sm ${moisFilter === 'tous' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setMoisFilter('tous')}>
            Tous les mois
          </button>
          {moisDisponibles.map((m) => (
            <button key={m} className={`btn btn-sm ${moisFilter === m ? 'btn-primary' : 'btn-outline'}`} onClick={() => setMoisFilter(m)}>
              {NOMS_MOIS[m]}
            </button>
          ))}
        </div>
      )}

      <input
        placeholder="Rechercher par libellé ou montant…"
        value={recherche}
        onChange={(e) => setRecherche(e.target.value)}
        style={{ marginBottom: 14, padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 8, width: 320, maxWidth: '100%' }}
      />

      {/* Tableau volontairement compact (date/libellé/montant/statut) — les boutons et menus de
          rapprochement vivent dans le panneau de détail ouvert au clic sur une ligne, pas ici : avec
          plusieurs centaines de mouvements, les répéter sur chaque ligne rendait l'écran interminable
          (voir audit ergonomie). */}
      <div className="card table-scroll" style={{ padding: 0 }}>
        {loading ? (
          <p className="muted" style={{ padding: 20 }}>Chargement…</p>
        ) : filtered.length === 0 ? (
          <div className="empty-state">Aucun mouvement bancaire{filter !== 'toutes' || moisFilter !== 'tous' || recherche ? ' dans ce filtre' : ''}.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Libellé</th>
                <th>Montant</th>
                <th>Statut</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((l) => {
                const piecePayee = l.piece_id ? pieces.find((p) => p.id === l.piece_id) : null
                const cotisationPayee = l.cotisation_id ? cotisations.find((c) => c.id === l.cotisation_id) : null
                const aUneSuggestion = l.statut === 'non_rapprochee' && !!(suggestion(l) || suggestionCotisation(l) || suggestionRecurrente(l))
                return (
                  <tr key={l.id} className="clickable" onClick={() => setLigneOuverte(l)}>
                    <td>{formatDate(l.date)}</td>
                    <td>{l.libelle}</td>
                    <td>{formatMoney(l.montant)}</td>
                    <td>
                      {l.prelevement_personnel && <span className="badge badge-neutral">Virement personnel</span>}
                      {!l.prelevement_personnel && l.statut === 'rapprochee' && (
                        <span className="badge badge-ok">
                          Rapproché
                          {piecePayee ? ` — ${piecePayee.tiers ?? ''}` : ''}
                          {cotisationPayee ? ` — Cotisation du ${formatDate(cotisationPayee.echeance)}` : ''}
                        </span>
                      )}
                      {!l.prelevement_personnel && l.statut === 'non_rapprochee' && (
                        <span className="badge badge-warning">Non rapproché{aUneSuggestion ? ' · suggestion' : ''}</span>
                      )}
                      {!l.prelevement_personnel && l.statut === 'ignoree' && <span className="badge badge-neutral">Ignoré</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {ligneOuverte && (
        <PanneauLigne
          ligne={ligneOuverte}
          pieces={pieces}
          cotisations={cotisations}
          piecesRapprochees={piecesRapprochees}
          cotisationsRapprochees={cotisationsRapprochees}
          suggestion={suggestion}
          suggestionCotisation={suggestionCotisation}
          suggestionRecurrente={suggestionRecurrente}
          onClose={() => setLigneOuverte(null)}
          onRapprocher={(pieceId) => { rapprocher(ligneOuverte.id, pieceId); setLigneOuverte(null) }}
          onRapprocherCotisation={(cotisationId) => { rapprocherCotisation(ligneOuverte.id, cotisationId); setLigneOuverte(null) }}
          onVirementPersonnel={() => { marquerVirementPersonnel(ligneOuverte.id); setLigneOuverte(null) }}
          onIgnorer={() => { ignorer(ligneOuverte.id); setLigneOuverte(null) }}
          onToujoursIgnorer={() => { toujoursIgnorer(ligneOuverte); setLigneOuverte(null) }}
          onAnnuler={() => { annulerRapprochement(ligneOuverte.id); setLigneOuverte(null) }}
        />
      )}
    </>
  )
}

interface PanneauLigneProps {
  ligne: LigneBancaire
  pieces: Piece[]
  cotisations: CotisationDeclaree[]
  piecesRapprochees: Set<string | null>
  cotisationsRapprochees: Set<string | null>
  suggestion: (l: LigneBancaire) => Piece | null
  suggestionCotisation: (l: LigneBancaire) => CotisationDeclaree | null
  suggestionRecurrente: (l: LigneBancaire) => { action: 'ignorer' | 'virement_personnel'; occurrences: number } | null
  onClose: () => void
  onRapprocher: (pieceId: string) => void
  onRapprocherCotisation: (cotisationId: string) => void
  onVirementPersonnel: () => void
  onIgnorer: () => void
  onToujoursIgnorer: () => void
  onAnnuler: () => void
}

// Panneau de détail ouvert au clic sur une ligne (voir le tableau compact ci-dessus) : regroupe tout
// ce qui était avant étalé sur chaque ligne du tableau (suggestion, menus d'association, ignorer...).
// Une seule ligne ouverte à la fois, jamais de rapprochement fait par erreur en glissant sur le
// tableau — l'utilisateur doit explicitement ouvrir puis choisir une action.
function PanneauLigne({
  ligne, pieces, cotisations, piecesRapprochees, cotisationsRapprochees,
  suggestion, suggestionCotisation, suggestionRecurrente,
  onClose, onRapprocher, onRapprocherCotisation, onVirementPersonnel, onIgnorer, onToujoursIgnorer, onAnnuler,
}: PanneauLigneProps) {
  const propose = suggestion(ligne)
  const proposeCotisation = !propose ? suggestionCotisation(ligne) : null
  const proposeRecurrent = !propose && !proposeCotisation ? suggestionRecurrente(ligne) : null
  const piecePayee = ligne.piece_id ? pieces.find((p) => p.id === ligne.piece_id) : null
  const cotisationPayee = ligne.cotisation_id ? cotisations.find((c) => c.id === ligne.cotisation_id) : null
  const piecesTriees = ligne.statut === 'non_rapprochee'
    ? [...pieces].filter((p) => !piecesRapprochees.has(p.id))
        .sort((a, b) => scoreCorrespondance(a.montant_ttc, a.date_piece, ligne) - scoreCorrespondance(b.montant_ttc, b.date_piece, ligne))
    : []
  const cotisationsTriees = ligne.statut === 'non_rapprochee'
    ? [...cotisations].filter((c) => !cotisationsRapprochees.has(c.id))
        .sort((a, b) =>
          scoreCorrespondance(a.montant_verse ?? a.montant_appele, a.echeance, ligne)
          - scoreCorrespondance(b.montant_verse ?? b.montant_appele, b.echeance, ligne))
    : []

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div className="card" style={{ width: 'min(480px, 92vw)', maxHeight: '85vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
          <div>
            <h2 style={{ margin: 0 }}>{formatMoney(ligne.montant)}</h2>
            <p className="muted" style={{ margin: '4px 0 0' }}>{formatDate(ligne.date)} — {ligne.libelle}</p>
          </div>
          <button type="button" className="btn btn-outline btn-sm" onClick={onClose}>Fermer</button>
        </div>

        {/* Traçabilité de l'import (voir audit ergonomie) — surtout utile quand libelle est retombé
            sur le générique "Mouvement bancaire" : de quoi retrouver le fichier et la ligne d'origine
            sans devoir rouvrir le relevé. Absent sur tout import antérieur à cet ajout. */}
        {(ligne.source_fichier || (ligne.libelle_brut && ligne.libelle_brut !== ligne.libelle)) && (
          <p className="muted" style={{ fontSize: '0.78rem', marginTop: 6 }}>
            {ligne.source_fichier && <>Importé depuis « {ligne.source_fichier} »</>}
            {ligne.source_fichier && ligne.libelle_brut && ligne.libelle_brut !== ligne.libelle && ' — '}
            {ligne.libelle_brut && ligne.libelle_brut !== ligne.libelle && <>ligne brute : {ligne.libelle_brut}</>}
          </p>
        )}

        <div style={{ marginTop: 16 }}>
          {ligne.prelevement_personnel && <span className="badge badge-neutral">Virement personnel</span>}
          {!ligne.prelevement_personnel && ligne.statut === 'rapprochee' && (
            <span className="badge badge-ok">
              Rapproché
              {piecePayee ? ` — ${piecePayee.tiers ?? ''}` : ''}
              {cotisationPayee ? ` — Cotisation du ${formatDate(cotisationPayee.echeance)}` : ''}
            </span>
          )}
          {!ligne.prelevement_personnel && ligne.statut === 'non_rapprochee' && <span className="badge badge-warning">Non rapproché</span>}
          {!ligne.prelevement_personnel && ligne.statut === 'ignoree' && <span className="badge badge-neutral">Ignoré</span>}
        </div>

        {ligne.statut === 'non_rapprochee' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
            {propose && (
              <button className="btn btn-outline" onClick={() => onRapprocher(propose.id)}>
                Rapprocher avec {propose.tiers ?? 'cette pièce'} ({formatMoney(propose.montant_ttc)})
              </button>
            )}
            {proposeCotisation && (
              <button className="btn btn-outline" onClick={() => onRapprocherCotisation(proposeCotisation.id)}>
                Rapprocher avec l'échéance du {formatDate(proposeCotisation.echeance)} ({formatMoney(proposeCotisation.montant_verse ?? proposeCotisation.montant_appele)})
              </button>
            )}
            {proposeRecurrent && (
              <button
                className="btn btn-outline"
                onClick={() => proposeRecurrent.action === 'virement_personnel' ? onVirementPersonnel() : onIgnorer()}
                title={`Même montant, même période du mois que ${proposeRecurrent.occurrences} mouvement(s) déjà classé(s) ainsi`}
              >
                {proposeRecurrent.action === 'virement_personnel' ? 'Virement personnel' : 'Ignorer'} (récurrent, {proposeRecurrent.occurrences}×)
              </button>
            )}

            <div className="field">
              <label htmlFor="associer-piece">Associer à une pièce</label>
              <select id="associer-piece" defaultValue="" onChange={(e) => e.target.value && onRapprocher(e.target.value)}>
                <option value="">— Choisir —</option>
                {piecesTriees.map((p) => (
                  <option key={p.id} value={p.id}>
                    {formatDate(p.date_piece)} — {p.tiers ?? '—'} — {formatMoney(p.montant_ttc)}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor="associer-cotisation">Associer à une cotisation</label>
              <select id="associer-cotisation" defaultValue="" onChange={(e) => e.target.value && onRapprocherCotisation(e.target.value)}>
                <option value="">— Choisir —</option>
                {cotisationsTriees.map((c) => (
                  <option key={c.id} value={c.id}>
                    {formatDate(c.echeance)} — {formatMoney(c.montant_verse ?? c.montant_appele)}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn btn-outline btn-sm" onClick={onVirementPersonnel}>Virement personnel</button>
              <button className="btn btn-outline btn-sm" onClick={onIgnorer}>Ignorer</button>
              <button className="btn btn-outline btn-sm" onClick={onToujoursIgnorer}>Toujours ignorer ce type…</button>
            </div>
          </div>
        )}

        {ligne.statut !== 'non_rapprochee' && (
          <div style={{ marginTop: 16 }}>
            <button className="btn btn-outline" onClick={onAnnuler}>Annuler le rapprochement</button>
          </div>
        )}
      </div>
    </div>
  )
}

const overlayStyle: CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20,
}

function statutPourLibelle(libelle: string, regles: RegleBancaireIgnoree[]): StatutLigneBancaire {
  const l = libelle.toLowerCase()
  return regles.some((r) => l.includes(r.motif)) ? 'ignoree' : 'non_rapprochee'
}

function ImportCsv({ dossierId, onImported, regles, lignesExistantes }: { dossierId: string; onImported: () => void; regles: RegleBancaireIgnoree[]; lignesExistantes: LigneBancaire[] }) {
  const [source, setSource] = useState<'csv' | 'pdf'>('csv')
  const [rows, setRows] = useState<string[][] | null>(null)
  const [colDate, setColDate] = useState(0)
  const [colLibelle, setColLibelle] = useState(1)
  const [mode, setMode] = useState<'signe' | 'debit_credit'>('signe')
  const [colMontant, setColMontant] = useState(2)
  const [colDebit, setColDebit] = useState(2)
  const [colCredit, setColCredit] = useState(3)
  const [hasHeader, setHasHeader] = useState(true)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [pdfRows, setPdfRows] = useState<LigneExtraite[] | null>(null)
  const [pdfExtracting, setPdfExtracting] = useState(false)
  const [documentsReleve, setDocumentsReleve] = useState<DocumentDivers[]>([])
  // Nom du fichier en cours d'import (voir audit ergonomie) — persisté sur chaque ligne créée
  // (source_fichier) pour pouvoir retrouver le relevé d'origine plus tard, notamment quand le libellé
  // est retombé sur le générique "Mouvement bancaire".
  const [sourceFileName, setSourceFileName] = useState<string | null>(null)

  useEffect(() => {
    supabase.from('documents_divers').select('*').eq('dossier_id', dossierId).eq('categorie', 'releve_bancaire')
      .then(({ data }) => setDocumentsReleve(data ?? []))
  }, [dossierId])

  // Même Blob générique que handlePdfBlob ci-dessous : un fichier fraîchement déposé (File) ou un CSV
  // déjà classé dans l'archive Documents (Blob téléchargé du storage) suivent le même traitement.
  async function handleFile(blob: Blob, nom: string) {
    setError(null)
    setSourceFileName(nom)
    const text = await blob.text()
    const parsed = parseCsv(text)
    if (parsed.length === 0) {
      setError('Fichier vide ou illisible.')
      return
    }
    setRows(parsed)

    // Détection automatique du mapping de colonnes à partir du contenu — reste modifiable ensuite
    // si la banque a un format inhabituel que la détection n'aurait pas bien reconnu.
    const detected = detectColumnMapping(parsed)
    setColDate(detected.colDate)
    setColMontant(detected.colMontant)
    setColLibelle(detected.colLibelle)
    setHasHeader(detected.hasHeader)
    setMode('signe')
  }

  const dataRows = rows ? (hasHeader ? rows.slice(1) : rows) : []
  // Les lignes peuvent avoir des longueurs différentes selon les banques (ex. ligne de solde plus
  // courte que les lignes d'opérations) — on prend le plus grand nombre de colonnes observé.
  const nbColonnes = rows ? rows.reduce((max, r) => Math.max(max, r.length), 0) : 0

  // Point d'entrée commun, qu'il s'agisse d'un fichier fraîchement déposé (Blob = File) ou d'un
  // relevé déjà classé dans l'archive Documents (Blob téléchargé du storage) — même traitement.
  async function handlePdfBlob(blob: Blob, nom: string) {
    setError(null)
    setSourceFileName(nom)
    setPdfRows(null)
    setPdfExtracting(true)
    try {
      const text = await extractPdfText(blob)
      const extraites = parseLignesFromPdfText(text)
      if (extraites.length === 0) {
        throw new Error("Aucune opération détectée dans ce PDF — la mise en page n'est peut-être pas reconnue. Essaie l'export CSV si la banque le propose.")
      }
      setPdfRows(extraites)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lecture du PDF impossible.')
    } finally {
      setPdfExtracting(false)
    }
  }

  async function utiliserDocument(doc: DocumentDivers) {
    setError(null)
    setPdfExtracting(true)
    const { data, error: downloadError } = await supabase.storage.from('pieces').download(doc.storage_path)
    if (downloadError || !data) {
      setError("Impossible de récupérer ce document.")
      setPdfExtracting(false)
      return
    }
    await handlePdfBlob(data, doc.nom_fichier)
  }

  async function utiliserDocumentCsv(doc: DocumentDivers) {
    setError(null)
    const { data, error: downloadError } = await supabase.storage.from('pieces').download(doc.storage_path)
    if (downloadError || !data) {
      setError("Impossible de récupérer ce document.")
      return
    }
    await handleFile(data, doc.nom_fichier)
  }

  // Une même catégorie "relevé bancaire" peut désormais contenir des CSV et des PDF (classification
  // automatique par extension pour les CSV, voir DocumentsTab/ImportDossierModal) — chaque sous-onglet
  // ne doit proposer que les fichiers qu'il sait effectivement traiter.
  const documentsReleveCsv = documentsReleve.filter((d) => d.nom_fichier.toLowerCase().endsWith('.csv'))
  const documentsRelevePdf = documentsReleve.filter((d) => d.nom_fichier.toLowerCase().endsWith('.pdf'))

  function updatePdfRow(index: number, patch: Partial<LigneExtraite>) {
    setPdfRows((prev) => prev && prev.map((r, i) => (i === index ? { ...r, ...patch } : r)))
  }

  function removePdfRow(index: number) {
    setPdfRows((prev) => prev && prev.filter((_, i) => i !== index))
  }

  async function handleImportPdfRows() {
    if (!pdfRows || pdfRows.length === 0) return
    setImporting(true)
    setError(null)
    try {
      // Même dédoublonnage que l'import CSV (voir handleImport) — un relevé PDF redéposé par erreur
      // ne doit pas dupliquer chaque mouvement déjà en base.
      const signaturesVues = new Set(lignesExistantes.map(signatureLigne))
      const aInserer: typeof pdfRows = []
      let doublons = 0
      for (const r of pdfRows) {
        const sig = signatureLigne(r)
        if (signaturesVues.has(sig)) { doublons++; continue }
        signaturesVues.add(sig)
        aInserer.push(r)
      }
      if (aInserer.length === 0) throw new Error("Ce relevé semble déjà importé (mêmes date, libellé et montant).")

      const { error } = await supabase.from('lignes_bancaires').insert(
        aInserer.map((r) => ({
          dossier_id: dossierId, date: r.date, libelle: r.libelle, montant: r.montant,
          statut: statutPourLibelle(r.libelle, regles), source_fichier: sourceFileName,
        })),
      )
      if (error) throw error
      setPdfRows(null)
      setSourceFileName(null)
      onImported()
      if (doublons > 0) window.alert(`${aInserer.length} ligne(s) importée(s), ${doublons} déjà présente(s) ignorée(s).`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "L'import a échoué.")
    } finally {
      setImporting(false)
    }
  }

  async function handleImport() {
    if (!rows) return
    setImporting(true)
    setError(null)
    try {
      const toInsert: { dossier_id: string; date: string; libelle: string; montant: number; statut: StatutLigneBancaire; source_fichier: string | null; libelle_brut: string | null }[] = []
      let ignorees = 0
      for (const row of dataRows) {
        const date = parseDateBancaire(row[colDate] ?? '')
        // Le libellé n'est qu'informatif (pas utilisé pour le rapprochement) — certaines banques le
        // laissent vide sur certaines lignes selon le type d'opération. On ne rejette la ligne que si
        // la date ou le montant, les deux champs réellement nécessaires, sont illisibles. La ligne
        // brute du fichier est gardée à part (libelle_brut) : si le générique "Mouvement bancaire"
        // s'applique faute de mieux, on garde de quoi retrouver ce qu'il y avait réellement dessus
        // (voir audit ergonomie) plutôt que de perdre l'information.
        const libelle = (row[colLibelle] ?? '').trim() || 'Mouvement bancaire'
        let montant: number | null = null
        if (mode === 'signe') {
          montant = parseMontantBancaire(row[colMontant] ?? '')
        } else {
          const debit = parseMontantBancaire(row[colDebit] ?? '') ?? 0
          const credit = parseMontantBancaire(row[colCredit] ?? '') ?? 0
          montant = credit - Math.abs(debit)
        }
        if (!date || montant == null) {
          ignorees++
          continue
        }
        toInsert.push({
          dossier_id: dossierId, date, libelle, montant, statut: statutPourLibelle(libelle, regles),
          source_fichier: sourceFileName, libelle_brut: row.join(' | '),
        })
      }

      // Un relevé déposé deux fois (nouvelle tentative après un doute, mauvais fichier repris par
      // erreur...) dupliquerait sinon silencieusement chaque mouvement — même signature (date,
      // libellé, montant) qu'une ligne déjà en base, ou répétée dans ce même fichier.
      const signaturesVues = new Set(lignesExistantes.map(signatureLigne))
      const aInserer: typeof toInsert = []
      let doublons = 0
      for (const ligne of toInsert) {
        const sig = signatureLigne(ligne)
        if (signaturesVues.has(sig)) { doublons++; continue }
        signaturesVues.add(sig)
        aInserer.push(ligne)
      }
      if (aInserer.length === 0) throw new Error(doublons > 0 ? "Ce relevé semble déjà importé (mêmes date, libellé et montant)." : "Aucune ligne exploitable — vérifie le mapping des colonnes.")

      const { error } = await supabase.from('lignes_bancaires').insert(aInserer)
      if (error) throw error

      setRows(null)
      setSourceFileName(null)
      onImported()
      const messages = [`${aInserer.length} ligne(s) importée(s)`]
      if (doublons > 0) messages.push(`${doublons} déjà présente(s), ignorée(s)`)
      if (ignorees > 0) messages.push(`${ignorees} ignorée(s) (date/montant illisible)`)
      if (doublons > 0 || ignorees > 0) window.alert(messages.join(', ') + '.')
    } catch (err) {
      setError(err instanceof Error ? err.message : "L'import a échoué.")
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <h3 style={{ marginTop: 0 }}>Importer un relevé bancaire</h3>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <button type="button" className={`btn btn-sm ${source === 'csv' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setSource('csv')}>CSV</button>
        <button type="button" className={`btn btn-sm ${source === 'pdf' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setSource('pdf')}>PDF</button>
      </div>

      {source === 'csv' && (
        <>
          {documentsReleveCsv.length > 0 && (
            <div className="field">
              <label>Déjà dans Documents</label>
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                {documentsReleveCsv.map((d) => (
                  <li key={d.id} style={{ marginBottom: 4 }}>
                    {d.nom_fichier}{' '}
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => utiliserDocumentCsv(d)}>
                      Utiliser ce relevé
                    </button>
                  </li>
                ))}
              </ul>
              <p className="muted" style={{ marginTop: 6 }}>— ou dépose un nouveau fichier :</p>
            </div>
          )}
          <div className="field">
            <input type="file" accept=".csv,text/csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f, f.name) }} />
          </div>
        </>
      )}

      {source === 'csv' && rows && (
        <>
          <p className="muted" style={{ marginTop: -4 }}>
            Mapping détecté automatiquement à partir du fichier — vérifie l'aperçu ci-dessous et corrige si besoin.
          </p>
          <div className="field">
            <label>
              <input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} style={{ marginRight: 6 }} />
              La première ligne est un en-tête
            </label>
          </div>

          <div className="table-scroll" style={{ marginBottom: 14, border: '1px solid var(--color-border)', borderRadius: 8 }}>
            <table>
              <tbody>
                {rows.slice(0, 4).map((r, i) => (
                  <tr key={i}>{r.map((cell, j) => <td key={j}>{cell}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="colDate">Colonne Date</label>
              <select id="colDate" value={colDate} onChange={(e) => setColDate(+e.target.value)}>
                {Array.from({ length: nbColonnes }).map((_, i) => <option key={i} value={i}>Colonne {i + 1}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="colLibelle">Colonne Libellé</label>
              <select id="colLibelle" value={colLibelle} onChange={(e) => setColLibelle(+e.target.value)}>
                {Array.from({ length: nbColonnes }).map((_, i) => <option key={i} value={i}>Colonne {i + 1}</option>)}
              </select>
            </div>
          </div>

          <div className="field">
            <label htmlFor="mode">Format du montant</label>
            <select id="mode" value={mode} onChange={(e) => setMode(e.target.value as 'signe' | 'debit_credit')}>
              <option value="signe">Une colonne (montant signé, négatif si débit)</option>
              <option value="debit_credit">Deux colonnes (Débit / Crédit séparées)</option>
            </select>
          </div>

          {mode === 'signe' ? (
            <div className="field">
              <label htmlFor="colMontant">Colonne Montant</label>
              <select id="colMontant" value={colMontant} onChange={(e) => setColMontant(+e.target.value)}>
                {Array.from({ length: nbColonnes }).map((_, i) => <option key={i} value={i}>Colonne {i + 1}</option>)}
              </select>
            </div>
          ) : (
            <div className="field-row">
              <div className="field">
                <label htmlFor="colDebit">Colonne Débit</label>
                <select id="colDebit" value={colDebit} onChange={(e) => setColDebit(+e.target.value)}>
                  {Array.from({ length: nbColonnes }).map((_, i) => <option key={i} value={i}>Colonne {i + 1}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="colCredit">Colonne Crédit</label>
                <select id="colCredit" value={colCredit} onChange={(e) => setColCredit(+e.target.value)}>
                  {Array.from({ length: nbColonnes }).map((_, i) => <option key={i} value={i}>Colonne {i + 1}</option>)}
                </select>
              </div>
            </div>
          )}

          <button className="btn btn-primary" onClick={handleImport} disabled={importing}>
            {importing ? 'Import…' : `Importer ${dataRows.length} ligne(s)`}
          </button>
        </>
      )}

      {source === 'pdf' && (
        <>
          {documentsRelevePdf.length > 0 && (
            <div className="field">
              <label>Déjà dans Documents</label>
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                {documentsRelevePdf.map((d) => (
                  <li key={d.id} style={{ marginBottom: 4 }}>
                    {d.nom_fichier}{' '}
                    <button type="button" className="btn btn-outline btn-sm" disabled={pdfExtracting} onClick={() => utiliserDocument(d)}>
                      Utiliser ce relevé
                    </button>
                  </li>
                ))}
              </ul>
              <p className="muted" style={{ marginTop: 6 }}>— ou dépose un nouveau fichier :</p>
            </div>
          )}
          <div className="field">
            <input type="file" accept=".pdf,application/pdf" onChange={(e) => { const f = e.target.files?.[0]; if (f) handlePdfBlob(f, f.name) }} />
          </div>
          <p className="muted" style={{ marginTop: -8 }}>
            Une ligne par opération détectée automatiquement (date + montant) — vérifie et corrige le tableau avant d'importer, l'extraction PDF est moins fiable qu'un CSV.
          </p>

          {pdfExtracting && <p className="muted">Lecture du PDF…</p>}

          {pdfRows && (
            <>
              <div className="table-scroll" style={{ marginBottom: 14, border: '1px solid var(--color-border)', borderRadius: 8 }}>
                <table>
                  <thead><tr><th>Date</th><th>Libellé</th><th>Montant</th><th></th></tr></thead>
                  <tbody>
                    {pdfRows.map((r, i) => (
                      <tr key={i}>
                        <td><input type="date" value={r.date} onChange={(e) => updatePdfRow(i, { date: e.target.value })} style={{ width: 135 }} /></td>
                        <td><input value={r.libelle} onChange={(e) => updatePdfRow(i, { libelle: e.target.value })} style={{ width: '100%', minWidth: 180 }} /></td>
                        <td><input type="number" step="0.01" value={r.montant} onChange={(e) => updatePdfRow(i, { montant: parseFloat(e.target.value) || 0 })} style={{ width: 95 }} /></td>
                        <td><button type="button" className="btn btn-outline btn-sm" onClick={() => removePdfRow(i)}>Retirer</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button className="btn btn-primary" onClick={handleImportPdfRows} disabled={importing || pdfRows.length === 0}>
                {importing ? 'Import…' : `Importer ${pdfRows.length} ligne(s)`}
              </button>
            </>
          )}
        </>
      )}

      {error && <p className="error-text" style={{ marginTop: 12 }}>{error}</p>}
    </div>
  )
}
