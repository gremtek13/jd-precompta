import { Fragment, useEffect, useState, type DragEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { deposerFichier } from '../lib/depot'
import { anneeDe, anneeLocaleDe, formatDate, moisDe, moisEcoulesCetteAnnee } from '../lib/format'
import type { CotisationDeclaree, DocumentDivers, LigneBancaire, Piece, PieceCommentaire } from '../lib/types'
import BarreRecherche from '../components/BarreRecherche'
import { correspondALaRecherche } from '../lib/recherche'
import FilCommentaires from '../components/FilCommentaires'
import BandeauLecturePartielle from '../components/BandeauLecturePartielle'
import { chargerCommentaires, cleCible, commentairesParCible } from '../lib/commentaires'
import type { CibleCommentaire } from '../lib/commentaires'
import { lireTout } from '../lib/lectureComplete'

const NOMS_MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
const ANNEE_COURANTE = new Date().getFullYear()
// Mois entièrement terminés, pas mois entamés (voir lib/format) — cet écran comptait le mois en cours
// comme dû, et réclamait donc au client un relevé qui n'existe pas encore, en contradiction avec
// l'accueil et la Checklist du cabinet, qui utilisent tous deux ce même calcul.
const MOIS_ECOULES = moisEcoulesCetteAnnee()

const LABEL_CATEGORIE: Record<DocumentDivers['categorie'], string> = {
  releve_bancaire: 'Relevé bancaire',
  cotisation: 'Appel de cotisation',
  attestation: 'Attestation / certificat',
  autre: 'Document',
}

// Une ligne de "Mes dépôts" fusionne pieces (factures/reçus) et documents_divers (relevés, cotisations,
// attestations) — le client dépose un fichier, peu importe où il finit rangé en base ; ce qui compte
// pour lui c'est de voir que chaque envoi est bien arrivé et a été reconnu.
interface Depot {
  id: string
  nomFichier: string
  createdAt: string
  label: string
  traite: boolean
  // Ce sur quoi une précision se rattache. Null tant que le fichier est en cours d'analyse : aucune
  // ligne n'existe encore en base, il n'y a rien à commenter.
  cible: CibleCommentaire | null
}

export default function ClientUpload() {
  const { dossierActifId } = useAuth()
  const dossierId = dossierActifId
  const [pieces, setPieces] = useState<Piece[]>([])
  const [documents, setDocuments] = useState<DocumentDivers[]>([])
  const [lignes, setLignes] = useState<LigneBancaire[]>([])
  const [cotisations, setCotisations] = useState<CotisationDeclaree[]>([])
  // Non nul quand la liste des envois ou des relevés n'a pas pu être lue en entier. Dit au client,
  // dans sa langue : sans ça l'écran pourrait lui réclamer un document qu'il a déjà envoyé.
  const [lectureIncomplete, setLectureIncomplete] = useState<string | null>(null)
  // À part de `lectureIncomplete` : un fil de précisions tronqué n'a pas la même conséquence qu'une
  // liste d'envois tronquée, et le bandeau ne sert qu'à dire CE QUI est devenu faux.
  const [precisionsIncompletes, setPrecisionsIncompletes] = useState<string | null>(null)
  // Fichiers en cours d'envoi/analyse — état purement local (pas encore une ligne en base) : le temps
  // que Textract réponde (jusqu'à 50s sur un document multi-pages), aucune ligne n'existe encore, donc
  // rien à corriger après coup. Voir handleFiles.
  const [enCours, setEnCours] = useState<{ id: string; nomFichier: string }[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [recherche, setRecherche] = useState('')
  const [error, setError] = useState<string | null>(null)
  // Les précisions du dossier, chargées en une fois. Une requête par ligne de la liste en produirait
  // autant que de dépôts, pour un écran que le client ouvre sur son téléphone.
  const [commentaires, setCommentaires] = useState<PieceCommentaire[]>([])
  // Le dépôt dont la zone de précision est ouverte. Amorcé par la photo prise depuis l'accueil, qui
  // navigue ici en désignant la ligne qu'elle vient de créer (voir ClientHome).
  const cibleDepuisAccueil = (useLocation().state as { preciser?: CibleCommentaire } | null)?.preciser
  const [filOuvert, setFilOuvert] = useState<string | null>(
    cibleDepuisAccueil ? cleCible(cibleDepuisAccueil) : null,
  )

  async function load() {
    if (!dossierId) return
    const [lecturePieces, lectureDocuments, lectureLignes, lectureCotisations, commentairesData] = await Promise.all([
      // Lues par tranches : le plafond de PostgREST ne se signale pas (voir lib/lectureComplete.ts),
      // et c'est sur ces deux collections que repose « ce qu'il reste à envoyer ». Tronquées, elles
      // demanderaient au client des documents qu'il a déjà envoyés.
      lireTout<Piece>((debut, fin) =>
        supabase.from('pieces').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).order('created_at', { ascending: false }).order('id').range(debut, fin),
      ),
      lireTout<DocumentDivers>((debut, fin) =>
        supabase.from('documents_divers').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).order('created_at', { ascending: false }).order('id').range(debut, fin),
      ),
      lireTout<LigneBancaire>((debut, fin) =>
        supabase.from('lignes_bancaires').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).order('id').range(debut, fin),
      ),
      lireTout<CotisationDeclaree>((debut, fin) =>
        supabase.from('cotisations_declarees').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).order('id').range(debut, fin),
      ),
      chargerCommentaires(dossierId),
    ])
    setPieces(lecturePieces.lignes)
    setDocuments(lectureDocuments.lignes)
    setLignes(lectureLignes.lignes)
    setLectureIncomplete(lecturePieces.motif ?? lectureLignes.motif)
    setCotisations(lectureCotisations.lignes)
    setCommentaires(commentairesData.commentaires)
    setPrecisionsIncompletes(commentairesData.motif)
  }

  useEffect(() => { load() }, [dossierId])

  // Chaque fichier suit son propre chemin, en parallèle — hash-check anti-doublon, upload storage,
  // extraction automatique, classement Pièces/Documents — via deposerFichier (lib/depot.ts), partagé
  // avec la prise de photo directe sur l'accueil (ClientHome). Ici on ajoute juste le suivi local
  // "Analyse en cours…" et l'agrégation des erreurs pour l'affichage de cet écran.
  async function handleFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList)
    if (files.length === 0 || !dossierId) return
    setError(null)
    const erreurs: string[] = []
    // Partagé par tous les fichiers de ce dépôt-ci : les branches partent en parallèle, donc deux
    // fichiers de contenu identique passeraient sinon tous deux la vérification anti-doublon en base
    // avant que l'un ait écrit sa ligne (voir deposerFichier). Un Set neuf par lot, jamais réutilisé
    // d'un dépôt à l'autre : au dépôt suivant, la base fait foi.
    const hashsDuLot = new Set<string>()

    await Promise.all(files.map(async (file) => {
      const localId = `${Date.now()}-${Math.random()}-${file.name}`
      setEnCours((prev) => [...prev, { id: localId, nomFichier: file.name }])
      const resultat = await deposerFichier(dossierId, file, hashsDuLot)
      if (resultat.statut === 'doublon') erreurs.push(`${file.name} : déjà déposé, pas réenvoyé.`)
      else if (resultat.statut === 'erreur') erreurs.push(`${file.name} : ${resultat.message}.`)
      // Un seul fichier déposé : on ouvre sa zone de précision, tant que le client se souvient de ce
      // qu'il vient d'envoyer. Sur un lot, on ne devine pas lequel mériterait un mot — en ouvrir un
      // au hasard ferait écrire la précision sous la mauvaise pièce.
      else if (files.length === 1) setFilOuvert(cleCible(resultat.cible))
      setEnCours((prev) => prev.filter((f) => f.id !== localId))
      load()
    }))

    if (erreurs.length > 0) setError(erreurs.join(' '))
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragOver(false)
    if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files)
  }

  if (!dossierId) {
    return <p className="muted">Aucun dossier ne t'est encore rattaché — contacte JD Consult.</p>
  }

  const depots: Depot[] = [
    ...pieces.map((p): Depot => ({
      id: `piece-${p.id}`,
      nomFichier: p.nom_fichier,
      createdAt: p.created_at,
      label: p.statut === 'validee' ? 'Facture — traitée' : 'Facture — en attente de traitement',
      traite: p.statut === 'validee',
      cible: { type: 'piece', id: p.id },
    })),
    ...documents.map((d): Depot => ({
      id: `doc-${d.id}`,
      nomFichier: d.nom_fichier,
      createdAt: d.created_at,
      label: LABEL_CATEGORIE[d.categorie],
      traite: true,
      cible: { type: 'document', id: d.id },
    })),
    ...enCours.map((f): Depot => ({
      id: f.id, nomFichier: f.nomFichier, createdAt: new Date().toISOString(), label: 'Analyse en cours…', traite: false,
      cible: null,
    })),
  ].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))

  const parCible = commentairesParCible(commentaires)

  // La recherche porte aussi sur les précisions : « salle d'attente » est souvent tout ce dont le
  // client se souvient d'un dépôt, bien plus sûrement que le nom du fichier que son téléphone a
  // choisi tout seul.
  const depotsAffiches = depots.filter((d) => {
    const fil = d.cible ? parCible.get(cleCible(d.cible)) ?? [] : []
    return correspondALaRecherche(
      [d.nomFichier, d.label, d.createdAt, formatDate(d.createdAt), ...fil.map((c) => c.texte)],
      recherche,
    )
  })

  // "Ce qu'il manque" — les 3 signaux communs à tous les dossiers (mêmes que le Dashboard cabinet),
  // pour que le client sache ce qu'il reste à envoyer sans avoir à demander. Volontairement limité à
  // ces trois-là : le reste (véhicule, tickets restaurant...) dépend d'une configuration par dossier
  // que le client ne voit pas ici.
  const moisPresents = new Set(
    lignes.filter((l) => anneeDe(l.date) === ANNEE_COURANTE).map((l) => moisDe(l.date)),
  )
  const moisManquants = Array.from({ length: MOIS_ECOULES }, (_, i) => i + 1).filter((m) => !moisPresents.has(m))
  const cotisationsAnnee = cotisations.filter((c) => anneeDe(c.echeance) === ANNEE_COURANTE)
  const piecesEtDocsAnnee = depots.filter((d) => anneeLocaleDe(d.createdAt) === ANNEE_COURANTE)

  const items = [
    {
      id: 'banque',
      label: `Relevés bancaires ${ANNEE_COURANTE}`,
      ok: moisManquants.length === 0,
      detail: MOIS_ECOULES === 0
        ? "Aucun mois encore terminé cette année"
        : moisManquants.length > 0
          ? `Mois manquants : ${moisManquants.map((m) => NOMS_MOIS[m - 1]).join(', ')}`
          : `${MOIS_ECOULES}/${MOIS_ECOULES} mois reçus`,
    },
    {
      id: 'cotisations',
      label: `Appels de cotisation ${ANNEE_COURANTE}`,
      ok: cotisationsAnnee.length > 0,
      detail: cotisationsAnnee.length > 0 ? `${cotisationsAnnee.length} échéance(s) reçue(s)` : "Aucun appel reçu pour l'instant cette année",
    },
    {
      id: 'depots',
      label: `Factures et documents ${ANNEE_COURANTE}`,
      ok: piecesEtDocsAnnee.length > 0,
      detail: `${piecesEtDocsAnnee.length} déposé(s)`,
    },
  ]

  return (
    <>
      <div className="topbar"><h1>Mes pièces</h1></div>

      <BandeauLecturePartielle
        quoi="Tes envois"
        motif={lectureIncomplete}
        technique={false}
        consequence="Recharge la page : cette liste peut te demander un document que tu as déjà envoyé."
      />
      <BandeauLecturePartielle
        quoi="Tes précisions"
        motif={precisionsIncompletes}
        technique={false}
        consequence="Recharge la page : il manque peut-être des messages sous tes documents."
      />

      <h3>Ce qu'il reste à envoyer</h3>
      <div className="card" style={{ padding: 0, marginBottom: 20 }}>
        {items.map((item) => (
          <div key={item.id} className="checklist-item">
            <span
              className="pastille"
              style={{
                width: 14, height: 14, borderRadius: '50%', flexShrink: 0,
                background: item.ok ? 'var(--color-primary)' : 'var(--color-danger)',
              }}
            />
            <div className="checklist-item-body">
              <div style={{ fontWeight: 600 }}>{item.label}</div>
              <div className="muted" style={{ fontSize: '0.82rem' }}>{item.detail}</div>
            </div>
          </div>
        ))}
      </div>

      <h3>Déposer des fichiers</h3>
      <div
        className="card"
        style={{
          marginBottom: 20, textAlign: 'center', cursor: 'pointer',
          border: dragOver ? '2px dashed var(--color-primary)' : '2px dashed var(--color-border)',
          background: dragOver ? 'var(--color-primary-light)' : 'var(--color-surface)',
        }}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        <p style={{ margin: '8px 0', fontWeight: 600 }}>Glisse tes fichiers ici</p>
        <p className="muted" style={{ margin: '0 0 14px' }}>
          Factures, reçus, notes de frais, relevés bancaires (CSV), appels de cotisation — plusieurs fichiers à la fois.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          <label className="btn btn-primary" style={{ cursor: 'pointer' }} onClick={(e) => e.stopPropagation()}>
            Choisir des fichiers
            <input
              type="file"
              multiple
              accept=".pdf,.jpg,.jpeg,.png,.csv"
              style={{ display: 'none' }}
              onChange={(e) => { if (e.target.files) handleFiles(e.target.files); e.target.value = '' }}
            />
          </label>
          {/* capture="environment" ouvre directement l'appareil photo arrière sur mobile (au lieu de la
              galerie) — le fichier qui en sort est un File comme un autre, donc handleFiles s'en occupe
              sans rien savoir de sa provenance : même hash-check, même upload, même extraction automatique. */}
          <label className="btn btn-outline" style={{ cursor: 'pointer' }} onClick={(e) => e.stopPropagation()}>
            📷 Prendre une photo
            <input
              type="file"
              accept="image/*"
              capture="environment"
              style={{ display: 'none' }}
              onChange={(e) => { if (e.target.files) handleFiles(e.target.files); e.target.value = '' }}
            />
          </label>
        </div>
      </div>

      {error && <p className="error-text" style={{ marginBottom: 14 }}>{error}</p>}

      <h3>Mes dépôts</h3>
      <div style={{ marginBottom: 14 }}>
        <BarreRecherche
          valeur={recherche}
          onChange={setRecherche}
          placeholder="Rechercher un fichier…"
          affiches={depotsAffiches.length}
          total={depots.length}
        />
      </div>
      <div className="card table-scroll" style={{ padding: 0 }}>
        {depotsAffiches.length === 0 ? (
          <div className="empty-state">
            {recherche.trim()
              ? `Aucun dépôt ne correspond à « ${recherche.trim()} ».`
              : "Aucun dépôt pour l'instant."}
          </div>
        ) : (
          <table>
            <thead><tr><th>Fichier</th><th>Déposé le</th><th>Statut</th><th>Précisions</th></tr></thead>
            <tbody>
              {depotsAffiches.map((d) => {
                const cle = d.cible ? cleCible(d.cible) : null
                const fil = cle ? parCible.get(cle) ?? [] : []
                const ouvert = cle !== null && filOuvert === cle
                return (
                  <Fragment key={d.id}>
                    <tr>
                      <td>{d.nomFichier}</td>
                      <td>{formatDate(d.createdAt)}</td>
                      <td>
                        {!d.traite && d.label === 'Analyse en cours…'
                          ? <span className="badge badge-neutral">Analyse en cours…</span>
                          : d.traite
                            ? <span className="badge badge-ok">{d.label}</span>
                            : <span className="badge badge-neutral">{d.label}</span>}
                      </td>
                      <td>
                        {/* Rien à commenter tant que l'analyse tourne : la ligne n'existe pas encore. */}
                        {d.cible === null ? (
                          <span className="muted">—</span>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-outline btn-sm"
                            onClick={() => setFilOuvert(ouvert ? null : cle)}
                          >
                            {fil.length > 0 ? `💬 ${fil.length}` : '+ Préciser'}
                          </button>
                        )}
                      </td>
                    </tr>
                    {ouvert && d.cible && dossierId && (
                      <tr>
                        <td colSpan={4} style={{ background: 'var(--color-surface-2)' }}>
                          <FilCommentaires
                            dossierId={dossierId}
                            cible={d.cible}
                            commentaires={fil}
                            estCabinet={false}
                            autoFocus
                            onAjout={(c) => setCommentaires((prev) => [...prev, c])}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}
