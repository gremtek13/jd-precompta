import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { ajouterMois, dernierJourDuMois, formatDate, formatMoney, premierJourDuMoisCourant } from '../../lib/format'
import { generatePack } from '../../lib/packGenerator'
import { lireTout } from '../../lib/lectureComplete'
import BandeauLecturePartielle from '../../components/BandeauLecturePartielle'
import type { Pack, Piece } from '../../lib/types'

// Période proposée par défaut : le mois précédent en entier. Calculée sur le calendrier civil plutôt
// que via `Date.toISOString()`, qui rendait la veille du bon jour à Paris (minuit local = 22 h UTC la
// veille en été) — la période démarrait et finissait un jour trop tôt, et le pack ratait les pièces
// datées du dernier jour du mois.
function premierJourMoisPrecedent(): string {
  return ajouterMois(premierJourDuMoisCourant(), -1)
}
function dernierJourMoisPrecedent(): string {
  return dernierJourDuMois(premierJourMoisPrecedent())
}

export default function PacksTab({ dossierId, dossierNom }: { dossierId: string; dossierNom: string }) {
  const [packs, setPacks] = useState<Pack[]>([])
  const [periodeDebut, setPeriodeDebut] = useState(premierJourMoisPrecedent())
  const [periodeFin, setPeriodeFin] = useState(dernierJourMoisPrecedent())
  // `sansDate` est compté À PART et jamais fondu dans les autres : une pièce sans date n'appartient
  // à AUCUNE période (`gte`/`lte` écarte les NULL), donc la rattacher à celle-ci serait la compter
  // dans chaque pack. Elle n'était simplement pas comptée du tout ici — alors que le générateur, lui,
  // la recense déjà et la remonte après coup. L'opérateur choisissait donc une période, lisait
  // « 4 pièces », et apprenait après génération qu'il en existait 18 autres.
  const [preview, setPreview] = useState<{ nbValidees: number; nbAValider: number; total: number; sansDate: number } | null>(null)
  const [previewIncomplet, setPreviewIncomplet] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function loadPacks() {
    const lecture = await lireTout<Pack>((debut, fin) =>
      supabase.from('packs').select('*', { count: 'exact' })
        .eq('dossier_id', dossierId).order('generated_at', { ascending: false }).order('id').range(debut, fin),
    )
    setPacks(lecture.lignes)
  }

  async function loadPreview() {
    // Lue par tranches : l'aperçu annonce ce que contiendra un livrable envoyé au comptable, et
    // `packGenerator` REFUSE déjà de produire un pack sur une lecture incomplète. L'aperçu, lui,
    // affichait un total tronqué sans le dire — donc plus optimiste que le générateur qui allait
    // refuser juste après.
    const lecture = await lireTout<Pick<Piece, 'statut' | 'montant_ttc'>>((debut, fin) =>
      supabase.from('pieces').select('statut, montant_ttc', { count: 'exact' })
        .eq('dossier_id', dossierId)
        .gte('date_piece', periodeDebut).lte('date_piece', periodeFin)
        .order('id').range(debut, fin),
    )
    // Les pièces sans date, par une requête à part : `gte`/`lte` ne les rend jamais, une comparaison
    // avec NULL n'étant jamais vraie en SQL. Même lecture que `packGenerator`, pour que l'écran et
    // le livrable disent la même chose au même moment.
    const sansDate = await lireTout<{ id: string }>((debut, fin) =>
      supabase.from('pieces').select('id', { count: 'exact' })
        .eq('dossier_id', dossierId).eq('statut', 'validee').is('date_piece', null)
        .order('id').range(debut, fin),
    )
    const rows = lecture.lignes
    setPreviewIncomplet(lecture.complete && sansDate.complete ? null : (lecture.motif ?? sansDate.motif))
    setPreview({
      nbValidees: rows.filter((r) => r.statut === 'validee').length,
      nbAValider: rows.filter((r) => r.statut === 'a_valider').length,
      total: rows.filter((r) => r.statut === 'validee').reduce((s, r) => s + (r.montant_ttc ?? 0), 0),
      sansDate: sansDate.lignes.length,
    })
  }

  useEffect(() => { loadPacks() }, [dossierId])
  useEffect(() => { loadPreview() }, [dossierId, periodeDebut, periodeFin])

  async function handleGenerate() {
    setGenerating(true)
    setError(null)
    try {
      const { nbPieces, totalTtc, storagePathZip, storagePathExcel, manquantes, sansDate } = await generatePack(dossierId, dossierNom, periodeDebut, periodeFin)
      const { data: userData } = await supabase.auth.getUser()
      // Le ZIP et l'Excel sont déjà dans le stockage à ce stade : sans cette ligne, ils y restent
      // sans que rien ne pointe dessus. Taire l'échec laissait l'écran afficher une génération
      // réussie et une liste inchangée, sans expliquer pourquoi.
      const { error: packError } = await supabase.from('packs').insert({
        dossier_id: dossierId,
        periode_debut: periodeDebut,
        periode_fin: periodeFin,
        generated_by: userData.user!.id,
        storage_path_zip: storagePathZip,
        storage_path_excel: storagePathExcel,
        nb_pieces: nbPieces,
        total_ttc: totalTtc,
      })
      if (packError) throw packError
      // Le pack est généré et enregistré, mais peut-être incomplet. Deux manques distincts, tous deux
      // à dire ici et pas seulement dans une feuille du classeur : un fichier qu'on n'a pas pu
      // récupérer, et une pièce validée sans date — celle-ci n'entre dans aucune période, donc dans
      // aucun pack, et rien ne le signalait jusqu'ici.
      const avertissements: string[] = []
      if (manquantes.length > 0) {
        avertissements.push(`${manquantes.length} pièce(s) n'ont pas pu être ajoutées à l'archive (fichier introuvable) : ${manquantes.slice(0, 3).join(', ')}${manquantes.length > 3 ? '…' : ''}. Voir l'onglet « Pièces manquantes » du récapitulatif.`)
      }
      if (sansDate.length > 0) {
        avertissements.push(`${sansDate.length} pièce(s) validée(s) de ce dossier n'ont pas de date : elles ne figurent dans aucun pack, quelle que soit la période — ${sansDate.slice(0, 3).join(', ')}${sansDate.length > 3 ? '…' : ''}. Leur donner une date pour qu'elles y entrent. Voir l'onglet « Pièces sans date ».`)
      }
      if (avertissements.length > 0) setError(`Pack généré, mais : ${avertissements.join(' ')}`)
      loadPacks()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'La génération a échoué.')
    } finally {
      setGenerating(false)
    }
  }

  async function download(path: string) {
    const { data, error } = await supabase.storage.from('packs').createSignedUrl(path, 60)
    if (error || !data) return
    window.open(data.signedUrl, '_blank')
  }

  return (
    <>
      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginTop: 0 }}>Générer un pack</h3>
        <div className="field-row">
          <div className="field">
            <label htmlFor="debut">Du</label>
            <input id="debut" type="date" value={periodeDebut} onChange={(e) => setPeriodeDebut(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="fin">Au</label>
            <input id="fin" type="date" value={periodeFin} onChange={(e) => setPeriodeFin(e.target.value)} />
          </div>
        </div>

        {preview && (
          <p className="muted">
            {preview.nbValidees} pièce(s) validée(s) — {formatMoney(preview.total)}
            {preview.nbAValider > 0 && (
              <span style={{ color: 'var(--color-warning)' }}> · {preview.nbAValider} pièce(s) encore à valider dans cette période, non incluses</span>
            )}
            {preview.sansDate > 0 && (
              <span style={{ color: 'var(--color-warning)' }}>
                {' '}· {preview.sansDate} pièce(s) validée(s) sans date — elles n’entrent dans AUCUNE
                période et seront recensées à part dans le récapitulatif
              </span>
            )}
          </p>
        )}

        <BandeauLecturePartielle
          quoi="Les pièces de la période"
          motif={previewIncomplet}
          consequence={
            'Le compte et le total ci-dessus portent donc sur une partie des pièces. La génération ' +
            'du pack refusera de toute façon tant que la lecture est partielle.'
          }
        />

        {error && <p className="error-text">{error}</p>}

        <button className="btn btn-primary" onClick={handleGenerate} disabled={generating || !preview || preview.nbValidees === 0}>
          {generating ? 'Génération…' : 'Générer le pack'}
        </button>
      </div>

      <h3>Historique</h3>
      <div className="card table-scroll" style={{ padding: 0 }}>
        {packs.length === 0 ? (
          <div className="empty-state">Aucun pack généré pour l'instant.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Période</th>
                <th>Générée le</th>
                <th>Pièces</th>
                <th>Total</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {packs.map((p) => (
                <tr key={p.id}>
                  <td>{formatDate(p.periode_debut)} → {formatDate(p.periode_fin)}</td>
                  <td>{formatDate(p.generated_at)}</td>
                  <td>{p.nb_pieces}</td>
                  <td>{formatMoney(p.total_ttc)}</td>
                  <td style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-outline btn-sm" onClick={() => download(p.storage_path_zip)}>ZIP</button>
                    <button className="btn btn-outline btn-sm" onClick={() => download(p.storage_path_excel)}>Excel</button>
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
