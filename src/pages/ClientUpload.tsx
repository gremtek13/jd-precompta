import { useEffect, useState, type DragEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { extractPiece, fichierDejaPresent, hashFichier, type ExtractionResult } from '../lib/extraction'
import { formatDate, slugify } from '../lib/format'
import type { CotisationDeclaree, DocumentDivers, LigneBancaire, Piece } from '../lib/types'

const NOMS_MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
const ANNEE_COURANTE = new Date().getFullYear()
const MOIS_ECOULES = new Date().getMonth() + 1

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
}

export default function ClientUpload() {
  const { dossierIds } = useAuth()
  const dossierId = dossierIds[0] // un client n'a en général qu'un seul dossier
  const [pieces, setPieces] = useState<Piece[]>([])
  const [documents, setDocuments] = useState<DocumentDivers[]>([])
  const [lignes, setLignes] = useState<LigneBancaire[]>([])
  const [cotisations, setCotisations] = useState<CotisationDeclaree[]>([])
  // Fichiers en cours d'envoi/analyse — état purement local (pas encore une ligne en base) : le temps
  // que Textract réponde (jusqu'à 50s sur un document multi-pages), aucune ligne n'existe encore, donc
  // rien à corriger après coup. Voir handleFiles.
  const [enCours, setEnCours] = useState<{ id: string; nomFichier: string }[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    if (!dossierId) return
    const [{ data: piecesData }, { data: documentsData }, { data: lignesData }, { data: cotisationsData }] = await Promise.all([
      supabase.from('pieces').select('*').eq('dossier_id', dossierId).order('created_at', { ascending: false }),
      supabase.from('documents_divers').select('*').eq('dossier_id', dossierId).order('created_at', { ascending: false }),
      supabase.from('lignes_bancaires').select('*').eq('dossier_id', dossierId),
      supabase.from('cotisations_declarees').select('*').eq('dossier_id', dossierId),
    ])
    setPieces(piecesData ?? [])
    setDocuments(documentsData ?? [])
    setLignes(lignesData ?? [])
    setCotisations(cotisationsData ?? [])
  }

  useEffect(() => { load() }, [dossierId])

  // Chaque fichier suit son propre chemin, en parallèle : vérifie d'abord qu'il n'est pas déjà présent
  // (même hash, Pièces ou Documents), l'envoie au storage, puis — sauf CSV, jamais analysé par Textract
  // et classé directement en relevé bancaire sur son extension — tente une extraction automatique.
  // L'extraction se fait AVANT l'écriture en base (pas en correction après coup, comme côté cabinet) :
  // le client n'a pas le droit de modifier une pièce une fois déposée (seul le cabinet valide/corrige),
  // donc le classement et les montants lus doivent être connus dès l'unique insertion.
  async function handleFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList)
    if (files.length === 0 || !dossierId) return
    setError(null)
    const erreurs: string[] = []

    await Promise.all(files.map(async (file) => {
      const localId = `${Date.now()}-${Math.random()}-${file.name}`
      try {
        const hash = await hashFichier(file)
        if (await fichierDejaPresent(dossierId, hash)) {
          erreurs.push(`${file.name} : déjà déposé, pas réenvoyé.`)
          return
        }

        setEnCours((prev) => [...prev, { id: localId, nomFichier: file.name }])

        const path = `${dossierId}/${Date.now()}-${slugify(file.name)}`
        const { error: uploadError } = await supabase.storage.from('pieces').upload(path, file)
        if (uploadError) throw uploadError

        const estCsv = file.name.toLowerCase().endsWith('.csv')
        if (estCsv) {
          const { error: insertError } = await supabase.from('documents_divers').insert({
            dossier_id: dossierId, storage_path: path, storage_hash: hash, nom_fichier: file.name, categorie: 'releve_bancaire',
          })
          if (insertError) throw insertError
          return
        }

        let extraction: ExtractionResult | null = null
        try {
          extraction = await extractPiece(file, file.name)
        } catch {
          extraction = null // best-effort : atterrit en Pièces à compléter par le cabinet si l'extraction échoue
        }

        if (extraction && extraction.classification !== 'facture') {
          const { error: insertError } = await supabase.from('documents_divers').insert({
            dossier_id: dossierId, storage_path: path, storage_hash: hash, nom_fichier: file.name,
            categorie: extraction.classification,
          })
          if (insertError) throw insertError
        } else {
          const { data: userData } = await supabase.auth.getUser()
          const { error: insertError } = await supabase.from('pieces').insert({
            dossier_id: dossierId, uploaded_by: userData.user!.id, storage_path: path, storage_hash: hash,
            nom_fichier: file.name, type_piece: 'achat', statut: 'a_valider',
            date_piece: extraction?.date_piece ?? null,
            tiers: extraction?.tiers ?? null,
            montant_ht: extraction?.montant_ht ?? null,
            montant_tva: extraction?.montant_tva ?? null,
            montant_ttc: extraction?.montant_ttc ?? null,
          })
          if (insertError) throw insertError
        }
      } catch (err) {
        erreurs.push(`${file.name} : ${err instanceof Error ? err.message : "l'envoi a échoué"}.`)
      } finally {
        setEnCours((prev) => prev.filter((f) => f.id !== localId))
        load()
      }
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
    })),
    ...documents.map((d): Depot => ({
      id: `doc-${d.id}`,
      nomFichier: d.nom_fichier,
      createdAt: d.created_at,
      label: LABEL_CATEGORIE[d.categorie],
      traite: true,
    })),
    ...enCours.map((f): Depot => ({
      id: f.id, nomFichier: f.nomFichier, createdAt: new Date().toISOString(), label: 'Analyse en cours…', traite: false,
    })),
  ].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))

  // "Ce qu'il manque" — les 3 signaux communs à tous les dossiers (mêmes que le Dashboard cabinet),
  // pour que le client sache ce qu'il reste à envoyer sans avoir à demander. Volontairement limité à
  // ces trois-là : le reste (véhicule, tickets restaurant...) dépend d'une configuration par dossier
  // que le client ne voit pas ici.
  const moisPresents = new Set(
    lignes.filter((l) => new Date(l.date).getFullYear() === ANNEE_COURANTE).map((l) => new Date(l.date).getMonth() + 1),
  )
  const moisManquants = Array.from({ length: MOIS_ECOULES }, (_, i) => i + 1).filter((m) => !moisPresents.has(m))
  const cotisationsAnnee = cotisations.filter((c) => new Date(c.echeance).getFullYear() === ANNEE_COURANTE)
  const piecesEtDocsAnnee = depots.filter((d) => new Date(d.createdAt).getFullYear() === ANNEE_COURANTE)

  const items = [
    {
      id: 'banque',
      label: `Relevés bancaires ${ANNEE_COURANTE}`,
      ok: moisManquants.length === 0,
      detail: moisManquants.length > 0
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
      <div className="card table-scroll" style={{ padding: 0 }}>
        {depots.length === 0 ? (
          <div className="empty-state">Aucun dépôt pour l'instant.</div>
        ) : (
          <table>
            <thead><tr><th>Fichier</th><th>Déposé le</th><th>Statut</th></tr></thead>
            <tbody>
              {depots.map((d) => (
                <tr key={d.id}>
                  <td>{d.nomFichier}</td>
                  <td>{formatDate(d.createdAt)}</td>
                  <td>
                    {!d.traite && d.label === 'Analyse en cours…'
                      ? <span className="badge badge-neutral">Analyse en cours…</span>
                      : d.traite
                        ? <span className="badge badge-ok">{d.label}</span>
                        : <span className="badge badge-neutral">{d.label}</span>}
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
