import { useState } from 'react'
import type { CategorieDocument, DocumentDivers, SousDossier } from '../../lib/types'
import { EntetePanneau } from '../../components/PanneauDroit'
import ApercuDuFichier from '../../components/ApercuDuFichier'
import { IconChevron, IconPrecedent } from '../../components/icons'
import { genreDApercu } from '../../lib/genreDApercu'
import { formatDate } from '../../lib/format'
import { lireTexteOcrDuDocument } from '../../lib/texteOcr'
import { PHRASE_FACTURE_PROBABLE } from '../../lib/facturesProbablesLecture'

// LA FICHE D'UN DOCUMENT, DANS LE PANNEAU DE DROITE (onglet Documents administratifs, demande du cabinet du 16/11/2026) :
// l'aperçu du fichier et les gestes que la LIGNE offre déjà — la catégorie, « C'est une facture », « Supprimer », le texte
// lu, l'ouverture dans un onglet —, sans un de plus. La fiche n'écrit rien elle-même : chaque geste est la fonction de
// l'onglet (`DocumentsTab`), avec ses refus, sa confirmation, son verrou et sa relecture, la même que depuis la liste.
// C'est l'onglet qui la pose dans le volet, lui donne sa place dans la liste affichée, et la ferme après une suppression.
// Il la monte avec `key` = le document : passer au suivant repart de zéro, et une lecture (l'aperçu, le texte lu) partie
// pour le document quitté ne s'affiche jamais sur le suivant.
//
// LE SOUS-DOSSIER SE CHOISIT ICI, ET ICI SEULEMENT (DOCF-Q1 (A), tranchée par le cabinet le 16/11/2026), comme dans la fiche
// d'une pièce : la ligne n'offre pas ce geste. La fiche n'offre que les sous-dossiers de CE dossier, lus EN ENTIER par
// l'onglet ; lus en partie, ou pas encore revenus, elle dit le sous-dossier sans offrir de choix (`choixDuSousDossier`).
export interface GestesDuDocument {
  changerCategorie: (categorie: CategorieDocument) => void
  // Null : aucun sous-dossier.
  changerSousDossier: (sousDossierId: string | null) => void
  convertir: () => void
  supprimer: () => void
  ouvrir: () => void
}

export default function FicheDocument({
  dossierId, document: doc, libellesCategories, sousDossier, choixDuSousDossier, avecTexteLu, factureProbable, doublon,
  citation, refus, conversionSuspendue, erreur, navigation, gestes, onFermer,
}: {
  dossierId: string
  document: DocumentDivers
  libellesCategories: Record<CategorieDocument, string>
  // Le nom du sous-dossier, tel que la ligne l'affiche (« — » sans sous-dossier).
  sousDossier: string
  // Les sous-dossiers de ce dossier, lus en entier : le choix s'offre. Sinon, pourquoi il ne s'offre pas.
  choixDuSousDossier: { offert: true; sousDossiers: readonly SousDossier[] } | { offert: false; motif: string }
  // L'onglet SAIT qu'un texte lu existe (la liste des textes lue) : la section ne s'offre que là, comme sur la ligne.
  avecTexteLu: boolean
  factureProbable: boolean
  // Le nombre d'exemplaires du même texte lu dans le dossier, ou null.
  doublon: number | null
  // La pastille de ce qui cite le document, et la phrase de la base qui refuse sa suppression — ou null.
  citation: string | null
  refus: string | null
  // Pourquoi « C'est une facture » attend (citations lues en partie, ou pas encore revenues), ou null.
  conversionSuspendue: string | null
  // Ce que le dernier geste sur CE document a dit.
  erreur: string | null
  navigation: { position: string; precedent: (() => void) | null; suivant: (() => void) | null }
  gestes: GestesDuDocument
  onFermer: () => void
}) {
  // Le texte lu, chargé au clic seulement (comme sur la ligne) : `null` replié, `chargement`, puis le texte ou l'échec dit.
  const [texteLu, setTexteLu] = useState<null | { etat: 'chargement' } | { etat: 'lu'; texte: string | null } | { etat: 'erreur'; motif: string }>(null)
  // La fiche est clée par document : une lecture revenue après qu'on a ouvert un autre document arrive à une fiche
  // démontée, et ne s'écrit nulle part. Repliée entre-temps, la section le reste.
  async function basculerTexteLu() {
    if (texteLu !== null) { setTexteLu(null); return }
    setTexteLu({ etat: 'chargement' })
    const { texte, erreur: motif } = await lireTexteOcrDuDocument(doc.id)
    setTexteLu((actuel) => (actuel?.etat !== 'chargement' ? actuel : motif ? { etat: 'erreur', motif } : { etat: 'lu', texte }))
  }

  return (
    <div className="fiche-piece fiche-document">
      <EntetePanneau
        titre={navigation.position}
        sousTitre={doc.nom_fichier}
        actions={(
          <>
            <button
              type="button"
              className="panneau-bouton-icone"
              onClick={navigation.precedent ?? undefined}
              disabled={!navigation.precedent}
              aria-label="Document précédent"
              title="Document précédent"
            >
              <IconPrecedent width={18} height={18} />
            </button>
            <button
              type="button"
              className="panneau-bouton-icone"
              onClick={navigation.suivant ?? undefined}
              disabled={!navigation.suivant}
              aria-label="Document suivant"
              title="Document suivant"
            >
              <IconChevron width={18} height={18} />
            </button>
          </>
        )}
        onFermer={onFermer}
      />
      <div className="fiche-piece-corps">
        {erreur && <p className="error-text">{erreur}</p>}
        {(doc.attached_to_cotisation_id || factureProbable || doublon !== null || citation) && (
          <div className="fiche-document-pastilles">
            {doc.attached_to_cotisation_id && <span className="badge badge-ok">Rattaché à une échéance</span>}
            {!doc.attached_to_cotisation_id && factureProbable && (
              <span className="badge badge-warning" title={PHRASE_FACTURE_PROBABLE}>Facture probable</span>
            )}
            {doublon !== null && (
              <span
                className="badge badge-danger"
                title={`${doublon} pièces/documents de ce dossier ont exactement le même texte lu — c'est le même document déposé plusieurs fois, sous des fichiers différents. L'empreinte du fichier ne peut pas le voir.`}
              >
                Doublon de contenu
              </span>
            )}
            {citation && <span className="badge badge-neutral">{citation}</span>}
          </div>
        )}
        {refus && <p className="fiche-piece-figee">{refus}</p>}

        <ApercuDuFichier
          dossierId={dossierId}
          chemin={doc.storage_path}
          genre={genreDApercu(doc.nom_fichier)}
          libelle="Aperçu du document"
          ouvrir={gestes.ouvrir}
        />

        <div className="field">
          <label htmlFor={`categorie-${doc.id}`}>Catégorie</label>
          <select
            id={`categorie-${doc.id}`}
            value={doc.categorie}
            onChange={(e) => gestes.changerCategorie(e.target.value as CategorieDocument)}
          >
            {(Object.keys(libellesCategories) as CategorieDocument[]).map((c) => (
              <option key={c} value={c}>{libellesCategories[c]}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`sous-dossier-${doc.id}`}>Sous-dossier</label>
          {choixDuSousDossier.offert ? (
            <select
              id={`sous-dossier-${doc.id}`}
              value={doc.sous_dossier_id ?? ''}
              onChange={(e) => gestes.changerSousDossier(e.target.value === '' ? null : e.target.value)}
            >
              <option value="">— Aucun —</option>
              {choixDuSousDossier.sousDossiers.map((s) => <option key={s.id} value={s.id}>{s.nom}</option>)}
              {/* Un sous-dossier que la liste du dossier, lue en entier, ne porte pas : la base ne lie pas le sous-dossier
                  d'un document à son dossier (DOCF-Q1-B). Dit, jamais choisi. */}
              {doc.sous_dossier_id !== null && !choixDuSousDossier.sousDossiers.some((s) => s.id === doc.sous_dossier_id) && (
                <option value={doc.sous_dossier_id} disabled>Sous-dossier absent de ce dossier</option>
              )}
            </select>
          ) : (
            <>
              <p style={{ margin: 0 }}>{sousDossier}</p>
              <p className="muted" style={{ margin: 0, fontSize: '0.82rem' }}>{choixDuSousDossier.motif}</p>
            </>
          )}
        </div>
        <p className="muted fiche-document-details">Ajouté le {formatDate(doc.created_at)}</p>

        {avecTexteLu && (
          <div className="texte-lu">
            <button type="button" className="lien-texte-lu" style={{ marginLeft: 0 }} onClick={basculerTexteLu}>
              {texteLu === null ? '▸ texte lu' : '▾ texte lu'}
            </button>
            {texteLu !== null && (
              <>
                <div className="texte-lu-entete">
                  <span className="muted">Tel que la reconnaissance automatique l'a lu, sans correction.</span>
                </div>
                {texteLu.etat === 'chargement' && <p className="muted" style={{ margin: 0 }}>Chargement…</p>}
                {texteLu.etat === 'erreur' && (
                  <p className="error-text" style={{ margin: 0 }}>Le texte lu n’a pas pu être relu ({texteLu.motif}).</p>
                )}
                {texteLu.etat === 'lu' && (texteLu.texte === null
                  ? <p className="muted" style={{ margin: 0 }}>Aucun texte lu pour ce document.</p>
                  : <pre className="texte-lu-corps">{texteLu.texte}</pre>)}
              </>
            )}
          </div>
        )}
      </div>
      {!refus && (
        <div className="fiche-piece-pied">
          <div className="fiche-piece-actions">
            <button
              type="button"
              className="btn btn-outline btn-sm"
              disabled={conversionSuspendue !== null}
              title={conversionSuspendue ?? undefined}
              onClick={gestes.convertir}
            >
              C'est une facture
            </button>
          </div>
          <button type="button" className="btn btn-danger btn-sm" onClick={gestes.supprimer}>Supprimer</button>
        </div>
      )}
    </div>
  )
}
