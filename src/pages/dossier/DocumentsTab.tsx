import { Fragment, useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { anneeLocaleDe, formatDate } from '../../lib/format'
import type { CategorieDocument, DocumentDivers, SousDossier } from '../../lib/types'
import AnneeTabs, { type ValeurAnnee } from '../../components/AnneeTabs'
import BarreRecherche from '../../components/BarreRecherche'
import { correspondALaRecherche } from '../../lib/recherche'
import AjouterDocumentsModal from './AjouterDocumentsModal'
import { documentsAvecTexteOcr, enregistrerTexteOcr, lireTexteOcrDuDocument, texteOcrDuDocument } from '../../lib/texteOcr'
import { documentsARelire, relireTextesDocuments } from '../../lib/relectureDocuments'
import { lireTout } from '../../lib/lectureComplete'
import BandeauLecturePartielle from '../../components/BandeauLecturePartielle'
import { chargerDoublonsDeTexte } from '../../lib/doublonsTexte'
import { messageErreur } from '../../lib/messageErreur'
import { retirerFichiers } from '../../lib/stockage'

const LABEL_CATEGORIE: Record<CategorieDocument, string> = {
  releve_bancaire: 'Relevé bancaire',
  cotisation: 'Appel de cotisation',
  attestation: 'Attestation / certificat',
  autre: 'Autre',
}

// Palier 5+ — archive des documents qui ne sont ni des pièces d'achat/vente ni des lignes bancaires :
// relevés de compte, attestations, appels de cotisation avant rattachement à une échéance (voir
// CotisationsTab). Alimentée automatiquement par le tri de AjouterDocumentsModal (même point d'entrée
// que Pièces, voir PiecesTab) — reclassable et complétable ici à la main.
export default function DocumentsTab({ dossierId }: { dossierId: string }) {
  const [documents, setDocuments] = useState<DocumentDivers[]>([])
  const [sousDossiers, setSousDossiers] = useState<SousDossier[]>([])
  const [loading, setLoading] = useState(true)
  const [categorieFilter, setCategorieFilter] = useState<'toutes' | CategorieDocument>('toutes')
  const [anneeFilter, setAnneeFilter] = useState<ValeurAnnee>('toutes')
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [ajoutOuvert, setAjoutOuvert] = useState(false)
  const [recherche, setRecherche] = useState('')

  // Documents dont on a le texte lu, et celui actuellement déplié. Les identifiants seuls : un texte
  // OCR pèse des kilo-octets, et cette liste peut compter des dizaines de lignes.
  const [avecTexteOcr, setAvecTexteOcr] = useState<Set<string>>(new Set())
  // Non nul quand la liste ci-dessus n'a PAS pu être lue. Un ensemble vide veut alors dire « je ne
  // sais pas », et surtout pas « aucun texte » : proposer « Retrouver le texte lu » sur cette base
  // paierait Textract une seconde fois sur des documents déjà lus (voir lib/texteOcr.ts).
  const [presenceTexteIncertaine, setPresenceTexteIncertaine] = useState<string | null>(null)
  // Non nul quand la liste des documents n'a pas pu être lue en entier (voir lib/lectureComplete.ts).
  const [lectureIncomplete, setLectureIncomplete] = useState<string | null>(null)
  const [ocrOuvert, setOcrOuvert] = useState<{ documentId: string; texte: string | null } | null>(null)
  const [relecture, setRelecture] = useState<{ fait: number; total: number; nomFichier: string } | null>(null)
  // Le verrou est un ref, jamais l'état ci-dessus : `setRelecture` ne prend effet qu'au rendu
  // suivant, donc `disabled` laisse passer deux clics rapprochés et les deux entrent dans la
  // boucle. Ici chaque passage est un appel Textract FACTURÉ sur les mêmes documents — deux
  // boucles parallèles paieraient donc deux fois la même lecture, sans que rien ne le signale.
  const relectureEnCours = useRef(false)

  // Verrou de la conversion document → pièce, PAR DOCUMENT et non global : convertir deux documents
  // à la suite est un geste normal, les bloquer l'un l'autre transformerait le second clic en
  // silence. Deux clics sur LE MÊME document, eux, créeraient deux pièces à partir du même fichier —
  // et rien ne les rattraperait : la détection de doublon porte sur l'empreinte d'un fichier DÉPOSÉ,
  // or ici aucun fichier n'est envoyé, la pièce reprend le chemin de stockage du document.
  const conversionsEnCours = useRef(new Set<string>())

  // Même comportement que dans PiecesTab : on ouvre en affichant « Chargement… » plutôt que de rester
  // muet assez longtemps pour qu'on reclique.
  async function basculerTexteOcr(documentId: string) {
    if (ocrOuvert?.documentId === documentId) { setOcrOuvert(null); return }
    setOcrOuvert({ documentId, texte: null })
    const texte = await texteOcrDuDocument(documentId)
    setOcrOuvert((actuel) => (actuel?.documentId === documentId ? { documentId, texte } : actuel))
  }

  // Documents dont le texte lu est identique à celui d'une autre pièce ou d'un autre document du
  // dossier. Le compte porte sur le GROUPE entier (pièces + documents) : ce qui intéresse
  // l'opérateur est « combien d'exemplaires de ce document existent », pas « combien du même côté ».
  //
  // Cet écran ne pouvait PAS porter ce badge jusqu'au 20/09/2026, et pas par oubli : aucun document
  // n'avait de texte, donc aucun groupe ne pouvait en contenir un. `relireTextesDocuments` a changé
  // ça — 36 documents lus sur le dossier `test` — et a rendu joignable un cas que seule la Checklist
  // savait compter, en renvoyant vers l'onglet Pièces où un doublon purement documentaire n'a aucune
  // ligne à afficher. Un point qui annonce « 1 » et une destination vide.
  const [doublonParDocument, setDoublonParDocument] = useState<Map<string, number>>(new Map())

  async function load() {
    setLoading(true)
    const [lectureDocuments, lectureSousDossiers] = await Promise.all([
      // Lue par tranches, triée sur un ordre TOTAL (voir lib/lectureComplete.ts) : un dossier
      // accumule un relevé par mois et par compte, plus les attestations — cette table grandit
      // toute seule, et le bouton « Retrouver le texte lu » compte ce qu'elle rend.
      lireTout<DocumentDivers>((debut, fin) =>
        supabase.from('documents_divers').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).order('created_at', { ascending: false }).order('id').range(debut, fin),
      ),
      lireTout<SousDossier>((debut, fin) =>
        supabase.from('sous_dossiers').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).order('ordre').order('nom').order('id').range(debut, fin),
      ),
    ])
    setDocuments(lectureDocuments.lignes)
    setLectureIncomplete(lectureDocuments.complete ? null : lectureDocuments.motif)
    setSousDossiers(lectureSousDossiers.lignes)
    const presence = await documentsAvecTexteOcr(dossierId)
    setAvecTexteOcr(presence.avecTexte)
    setPresenceTexteIncertaine(presence.erreur)
    // Best-effort, et journalisé : un doublon non signalé laisse l'écran dans son état d'avant, il
    // ne rend rien de faux. Faire échouer tout l'onglet Documents pour ça serait disproportionné.
    const doublons = await chargerDoublonsDeTexte(dossierId).catch((err) => {
      console.error('Doublons de contenu illisibles :', err)
      return []
    })
    const parDocument = new Map<string, number>()
    for (const doublon of doublons) {
      for (const id of doublon.documentIds) parDocument.set(id, doublon.pieceIds.length + doublon.documentIds.length)
    }
    setDoublonParDocument(parDocument)
    setLoading(false)
  }

  useEffect(() => { load() }, [dossierId])

  // Documents du dossier ENTIER, pas seulement ceux du filtre affiché : un texte manquant ne dépend
  // ni de la catégorie regardée ni de l'année, et le bouton annonce son nombre — ce qu'il va traiter
  // reste donc explicite malgré tout.
  const documentsSansTexte = documentsARelire(documents, avecTexteOcr)

  // Rattrape le texte lu par l'OCR sur les documents déposés avant qu'on le conserve. Textract
  // tournait déjà sur chacun d'eux et son texte était jeté : c'est une lecture déjà payée une fois,
  // et qu'il faut repayer faute de l'avoir gardée.
  //
  // **Elle n'écrit QUE le texte** — un document n'a ni date, ni tiers, ni montant, ni statut en base,
  // donc il n'y a rien d'autre à écrire et rien à détruire (voir lib/relectureDocuments.ts).
  async function relireDocumentsSansTexte() {
    if (documentsSansTexte.length === 0 || relectureEnCours.current || presenceTexteIncertaine) return
    if (!window.confirm(
      `Relancer la lecture automatique sur ${documentsSansTexte.length} document(s) ?\n\n` +
      `Elle archive le texte lu, pour l'afficher ensuite sous « texte lu » sur chaque ligne.\n` +
      `Rien d'autre n'est modifié — un document n'a ni date, ni montant, ni statut.\n` +
      `Chaque document repasse par l'analyse, comptez quelques secondes par fichier.`,
    )) return

    // Posé AVANT le premier `await`, sinon le verrou arrive trop tard pour servir à quelque chose.
    relectureEnCours.current = true
    setRelecture({ fait: 0, total: documentsSansTexte.length, nomFichier: '' })
    let resultat
    try {
      resultat = await relireTextesDocuments(documents, avecTexteOcr, (fait, total, nomFichier) =>
        setRelecture({ fait, total, nomFichier }),
      )
    } finally {
      relectureEnCours.current = false
      setRelecture(null)
    }
    load()

    const lignes = [`${resultat.textesArchives.length} texte(s) archivé(s) — visibles sous « texte lu » sur chaque ligne.`]
    // Dit à part d'un échec : l'analyse a bien eu lieu et a bien été facturée, il n'y avait
    // simplement rien à lire. Les confondre ferait relancer indéfiniment sur les mêmes fichiers.
    if (resultat.sansTexte.length > 0) {
      lignes.push(
        `\n${resultat.sansTexte.length} document(s) sans texte lisible (page blanche, photo illisible) :\n` +
        resultat.sansTexte.slice(0, 5).map((n) => `• ${n}`).join('\n') +
        (resultat.sansTexte.length > 5 ? `\n… et ${resultat.sansTexte.length - 5} autre(s)` : ''),
      )
    }
    if (resultat.echecs.length > 0) {
      lignes.push(
        `\n${resultat.echecs.length} en échec :\n` +
        resultat.echecs.slice(0, 5).map((e) => `• ${e.nomFichier} : ${e.message}`).join('\n'),
      )
    }
    window.alert(lignes.join('\n'))
  }

  // Pas de date propre au document (juste sa date d'ajout dans l'appli) — l'onglet Année filtre donc
  // sur created_at, pas sur la période réelle du document (un vieux relevé déposé aujourd'hui atterrit
  // dans l'année en cours, pas dans l'année qu'il couvre).
  const anneesDisponibles = [...new Set(documents.map((d) => anneeLocaleDe(d.created_at)))].sort((a, b) => b - a)

  const sousDossierLabel = (id: string | null) => sousDossiers.find((s) => s.id === id)?.nom ?? '—'

  // Filtres et recherche séparés : le décompte de la barre compare ce qui reste après recherche à ce
  // que les filtres laissaient passer, sinon « 3 sur 40 » mélangerait deux causes de réduction.
  const avantRecherche = documents.filter((d) => {
    if (categorieFilter !== 'toutes' && d.categorie !== categorieFilter) return false
    if (anneeFilter !== 'toutes' && anneeLocaleDe(d.created_at) !== anneeFilter) return false
    return true
  })
  // Ce qui est cherchable est ce qui est affiché sur la ligne : nom du fichier, catégorie lisible,
  // sous-dossier et date d'ajout — pas les identifiants ni les chemins de stockage, invisibles.
  const filtered = avantRecherche.filter((d) =>
    correspondALaRecherche(
      [d.nom_fichier, LABEL_CATEGORIE[d.categorie], sousDossierLabel(d.sous_dossier_id), formatDate(d.created_at)],
      recherche,
    ),
  )

  async function changerCategorie(doc: DocumentDivers, categorie: CategorieDocument) {
    await supabase.from('documents_divers').update({ categorie }).eq('id', doc.id)
    load()
  }

  async function voir(storagePath: string) {
    const { data, error: signError } = await supabase.storage.from('pieces').createSignedUrl(storagePath, 300)
    if (signError || !data) {
      window.alert('Aperçu indisponible.')
      return
    }
    window.open(data.signedUrl, '_blank')
  }

  async function supprimer(doc: DocumentDivers) {
    if (!window.confirm(`Supprimer définitivement "${doc.nom_fichier}" ?`)) return
    // LA LIGNE D'ABORD, LE FICHIER ENSUITE — et seulement si elle est bien partie. Le fichier était
    // retiré quoi qu'il arrive : une suppression refusée (RLS, réseau) laissait donc une ligne bien
    // visible qui désigne un fichier disparu. C'est pire qu'un orphelin — le téléchargement casse, et
    // l'empreinte SHA-256 que la piste d'audit donne pour preuve ne vérifie plus rien. La fonction
    // jumelle trente lignes plus bas (`supprimerSelection`) teste déjà `deleteError` ; celle-ci, non.
    const { error: erreurSuppression } = await supabase.from('documents_divers').delete().eq('id', doc.id)
    if (erreurSuppression) {
      setError(messageErreur(erreurSuppression, 'La suppression a échoué.'))
      return
    }
    await retirerFichiers('pieces', [doc.storage_path], 'DocumentsTab')
    load()
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    if (selected.size === filtered.length && filtered.length > 0) {
      setSelected(new Set())
    } else {
      setSelected(new Set(filtered.map((d) => d.id)))
    }
  }

  async function deleteSelection() {
    if (selected.size === 0) return
    if (!window.confirm(`Supprimer définitivement ${selected.size} document(s) ? Cette action est irréversible.`)) return
    for (const id of selected) {
      const doc = documents.find((d) => d.id === id)
      const { error: deleteError } = await supabase.from('documents_divers').delete().eq('id', id)
      if (deleteError) continue
      if (doc?.storage_path) {
        await retirerFichiers('pieces', [doc.storage_path], 'DocumentsTab')
      }
    }
    setSelected(new Set())
    load()
  }

  // Bascule vers l'onglet Pièces un document mal classé (une vraie facture passée à tort en document
  // divers) — recrée une pièce à partir du même fichier déjà en storage, à compléter/extraire ensuite
  // comme n'importe quelle autre pièce.
  async function convertirEnPiece(doc: DocumentDivers) {
    // Posé AVANT le premier `await` — un verrou posé après ne verrouille rien.
    if (conversionsEnCours.current.has(doc.id)) return
    conversionsEnCours.current.add(doc.id)
    try {
      const { data: userData } = await supabase.auth.getUser()
      // Le texte est lu AVANT toute suppression : il est rattaché au document, et la suppression de
      // celui-ci l'emporterait en cascade. C'est précisément ce qui a fait perdre leur texte aux trois
      // SNIR du dossier de test quand ils ont été déplacés vers Documents.
      //
      // Et la lecture doit DIRE si elle a échoué : « pas de texte » et « lecture refusée » rendent
      // tous deux null, mais le second veut dire qu'un texte existe peut-être et qu'on s'apprête à
      // l'effacer. Dans le doute, on ne convertit pas — rien n'est encore créé à cet instant, donc
      // renoncer ici ne laisse rien à moitié fait.
      const { texte, erreur } = await lireTexteOcrDuDocument(doc.id)
      if (erreur) {
        setError(`Le texte lu de ce document n'a pas pu être relu (${erreur}) — conversion annulée pour ne pas le perdre.`)
        return
      }

      const { data: piece, error: insertError } = await supabase.from('pieces').insert({
        dossier_id: dossierId,
        uploaded_by: userData.user!.id,
        storage_path: doc.storage_path,
        nom_fichier: doc.nom_fichier,
        sous_dossier_id: doc.sous_dossier_id,
        type_piece: 'achat',
        statut: 'a_valider',
      }).select('id').single()
      if (insertError || !piece) {
        setError(insertError?.message ?? "La conversion n'a rien rendu.")
        return
      }

      // Rattaché à la pièce avant que le document ne disparaisse — sinon le texte serait perdu au
      // moment même où il redevient utile, sur une pièce qu'il faut justement arbitrer.
      await enregistrerTexteOcr(dossierId, { type: 'piece', id: piece.id as string }, texte)

      // La suppression est vérifiée, et son échec se DIT : la pièce, elle, est déjà créée. Passé
      // sous silence, le même fichier vivrait des deux côtés, et le réflexe — recliquer — créerait
      // une pièce de plus à chaque fois.
      const { error: deleteError } = await supabase.from('documents_divers').delete().eq('id', doc.id)
      if (deleteError) {
        setError(
          `La pièce a bien été créée dans Justificatifs, mais le document n'a pas pu être retiré d'ici ` +
          `(${deleteError.message}). Retire-le à la main, sinon le même fichier existe en double.`,
        )
      } else {
        setError(null)
      }
      load()
    } finally {
      conversionsEnCours.current.delete(doc.id)
    }
  }

  return (
    <>
      <p className="muted" style={{ marginTop: -8, marginBottom: 4 }}>
        Relevés bancaires, attestations, appels de cotisation — les documents sans montant à
        ventiler, triés et classés ici automatiquement plutôt que dans Justificatifs.
      </p>
      <details className="muted" style={{ marginBottom: 20 }}>
        <summary style={{ cursor: 'pointer' }}>En savoir plus</summary>
        <p style={{ marginTop: 6, marginBottom: 0 }}>
          Reclasse ou convertis en justificatif si le tri automatique s'est trompé ; un appel de
          cotisation se rattache à une échéance depuis l'onglet Cotisations.
        </p>
      </details>

      <AnneeTabs annees={anneesDisponibles} valeur={anneeFilter} onChange={setAnneeFilter} />

      <div style={{ marginBottom: 14 }}>
        <BarreRecherche
          valeur={recherche}
          onChange={setRecherche}
          placeholder="Rechercher un document, une catégorie, un sous-dossier…"
          affiches={filtered.length}
          total={avantRecherche.length}
        />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className={`btn btn-sm ${categorieFilter === 'toutes' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setCategorieFilter('toutes')}>
            Toutes
          </button>
          {(Object.keys(LABEL_CATEGORIE) as CategorieDocument[]).map((c) => (
            <button key={c} className={`btn btn-sm ${categorieFilter === c ? 'btn-primary' : 'btn-outline'}`} onClick={() => setCategorieFilter(c)}>
              {LABEL_CATEGORIE[c]}
            </button>
          ))}
          {filtered.length > 0 && (
            <button className="btn btn-outline btn-sm" onClick={toggleSelectAll}>
              {selected.size === filtered.length ? 'Tout désélectionner' : 'Tout sélectionner'}
            </button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {documentsSansTexte.length > 0 && !presenceTexteIncertaine && (
            <button
              className="btn btn-outline btn-sm"
              disabled={relecture !== null}
              onClick={relireDocumentsSansTexte}
              title="Relance la lecture automatique pour archiver le texte lu sur ces documents et pouvoir le relire ici. Rien d'autre n'est modifié."
            >
              {relecture
                ? `Lecture… ${relecture.fait}/${relecture.total}${relecture.nomFichier ? ` — ${relecture.nomFichier}` : ''}`
                : `Retrouver le texte lu (${documentsSansTexte.length})`}
            </button>
          )}
          {selected.size > 0 && (
            <button className="btn btn-danger btn-sm" onClick={deleteSelection}>
              Supprimer la sélection ({selected.size})
            </button>
          )}
          <button className="btn btn-primary btn-sm" onClick={() => setAjoutOuvert(true)}>+ Ajouter des documents</button>
        </div>
      </div>

      <BandeauLecturePartielle
        quoi="Les documents du dossier"
        motif={lectureIncomplete}
        consequence="La liste ci-dessous n’est donc pas complète — recharge la page avant de t’y fier."
      />

      {presenceTexteIncertaine && (
        // Dit pourquoi le bouton a disparu, plutôt que de le laisser manquer sans raison visible.
        <p className="error-text">
          La liste des textes déjà lus n'a pas pu être chargée ({presenceTexteIncertaine}) —
          « Retrouver le texte lu » est masqué : relancer la lecture repaierait Textract sur des
          documents dont le texte est peut-être déjà archivé.
        </p>
      )}

      {error && <p className="error-text">{error}</p>}

      <div className="card table-scroll" style={{ padding: 0 }}>
        {loading ? (
          <p className="muted" style={{ padding: 20 }}>Chargement…</p>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            {recherche.trim() ? `Aucun document ne correspond à « ${recherche.trim()} ».` : 'Aucun document.'}
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th className="col-checkbox"></th>
                <th>Fichier</th>
                <th>Catégorie</th>
                <th className="hide-mobile">Sous-dossier</th>
                <th className="hide-mobile">Ajouté le</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((d) => (
                <Fragment key={d.id}>
                <tr>
                  <td className="col-checkbox" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(d.id)} onChange={() => toggleSelect(d.id)} />
                  </td>
                  <td>
                    <a href="#" onClick={(e) => { e.preventDefault(); voir(d.storage_path) }}>{d.nom_fichier}</a>
                    {d.attached_to_cotisation_id && <span className="badge badge-ok" style={{ marginLeft: 8 }}>Rattaché à une échéance</span>}
                    {doublonParDocument.has(d.id) && (
                      <span
                        className="badge badge-danger"
                        style={{ marginLeft: 8, fontSize: '0.7rem' }}
                        title={`${doublonParDocument.get(d.id)} pièces/documents de ce dossier ont exactement le même texte lu — c'est le même document déposé plusieurs fois, sous des fichiers différents. L'empreinte du fichier ne peut pas le voir.`}
                      >
                        Doublon de contenu
                      </span>
                    )}
                    {avecTexteOcr.has(d.id) && (
                      <button
                        type="button"
                        className="lien-texte-lu"
                        onClick={(e) => { e.preventDefault(); basculerTexteOcr(d.id) }}
                      >
                        {ocrOuvert?.documentId === d.id ? '▾ texte lu' : '▸ texte lu'}
                      </button>
                    )}
                  </td>
                  <td style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <select
                      style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: '4px 6px' }}
                      value={d.categorie}
                      onChange={(e) => changerCategorie(d, e.target.value as CategorieDocument)}
                    >
                      {(Object.keys(LABEL_CATEGORIE) as CategorieDocument[]).map((c) => (
                        <option key={c} value={c}>{LABEL_CATEGORIE[c]}</option>
                      ))}
                    </select>
                  </td>
                  <td className="hide-mobile">{sousDossierLabel(d.sous_dossier_id)}</td>
                  <td className="hide-mobile">{formatDate(d.created_at)}</td>
                  <td className="td-actions" onClick={(e) => e.stopPropagation()}>
                    <button className="btn btn-outline btn-sm" onClick={() => convertirEnPiece(d)}>C'est une facture</button>
                    <button className="btn btn-danger btn-sm" onClick={() => supprimer(d)}>Supprimer</button>
                  </td>
                </tr>
                {ocrOuvert?.documentId === d.id && (
                  <tr>
                    <td colSpan={6} style={{ background: 'var(--color-surface-2)' }}>
                      <div className="texte-lu">
                        <div className="texte-lu-entete">
                          <strong>Texte lu sur le document</strong>
                          <span className="muted">
                            Tel que la reconnaissance automatique l'a lu, sans correction. Sur un
                            relevé SNIR ou un appel de cotisation, c'est ce qui permet de retrouver un
                            montant sans rouvrir le PDF.
                          </span>
                        </div>
                        {ocrOuvert.texte === null
                          ? <p className="muted" style={{ margin: 0 }}>Chargement…</p>
                          : <pre className="texte-lu-corps">{ocrOuvert.texte}</pre>}
                      </div>
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {ajoutOuvert && (
        <AjouterDocumentsModal
          dossierId={dossierId}
          sousDossiers={sousDossiers}
          onClose={() => setAjoutOuvert(false)}
          onImported={load}
        />
      )}
    </>
  )
}
