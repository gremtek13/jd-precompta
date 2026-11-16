import { useEffect, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { cheminDuDossier, MOTIF_CHEMIN_HORS_DU_DOSSIER } from '../lib/cheminDuDossier'
import type { GenreDApercu } from '../lib/genreDApercu'

// L'APERÇU D'UN FICHIER DANS UN CONTENU DU VOLET DE DROITE : la fiche d'une pièce, et depuis le 16/11/2026 celle d'un
// document (onglet Documents administratifs). Il vivait enfoui dans FichePiece ; sorti tel quel plutôt que recopié.
//
// Un fichier fraîchement choisi se montre localement (pas besoin de l'envoyer d'abord), son adresse locale révoquée à
// chaque changement pour ne pas fuiter de mémoire ; un fichier du stockage passe par une adresse signée temporaire, le
// seau n'étant pas public. Le chemin se juge contre son dossier AVANT toute demande au stockage (CFCS-Q1,
// lib/cheminDuDossier.ts) : un chemin qu'un client a pu poser hors du dossier ne s'ouvre pas aux droits du cabinet.
// Une réponse arrivée pour un autre fichier — la fiche a changé de pièce ou de document entre-temps — ne s'écrit pas.
//
// Ce qui ne se prévisualise pas (ni image ni PDF : un CSV) le dit, et garde le moyen de l'ouvrir.
export default function ApercuDuFichier({ dossierId, chemin, fichierLocal = null, genre, libelle, ouvrir, children }: {
  dossierId: string
  // Le chemin dans le seau `pieces`, ou null quand rien n'est encore déposé.
  chemin: string | null
  // Un fichier choisi dans la fiche, pas encore envoyé : il l'emporte sur le chemin.
  fichierLocal?: File | null
  genre: GenreDApercu
  // Ce que l'aperçu montre, pour l'image et le cadre du PDF (« Aperçu de la pièce »).
  libelle: string
  // Le moyen de l'ouvrir en grand. Absent, un lien vers l'adresse signée (la fiche d'une pièce, comme hier) ; donné, un
  // bouton qui passe par lib/apercu.ts (la fiche d'un document) — il dit lui-même un refus.
  ouvrir?: () => void
  // Ce qui suit l'aperçu, qu'il ait pu se faire ou non (la version lisible d'une facture reçue, par exemple).
  children?: ReactNode
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)

  useEffect(() => {
    if (fichierLocal) {
      const locale = URL.createObjectURL(fichierLocal)
      setUrl(locale)
      setErreur(null)
      return () => URL.revokeObjectURL(locale)
    }
    if (chemin) {
      if (!cheminDuDossier(chemin, dossierId)) {
        setErreur(`Aperçu indisponible : ${MOTIF_CHEMIN_HORS_DU_DOSSIER}.`)
        setUrl(null)
        return
      }
      let annule = false
      supabase.storage.from('pieces').createSignedUrl(chemin, 300).then(({ data, error }) => {
        if (annule) return
        if (error || !data) {
          setErreur('Aperçu indisponible.')
          setUrl(null)
        } else {
          setUrl(data.signedUrl)
          setErreur(null)
        }
      })
      return () => { annule = true }
    }
    setUrl(null)
    setErreur(null)
  }, [fichierLocal, chemin, dossierId])

  if (!url && !erreur) return null
  return (
    <div className="field fiche-piece-apercu">
      {erreur ? (
        <p className="muted" style={{ margin: 0 }}>{erreur}</p>
      ) : (
        <>
          {genre === 'image' && <img src={url!} alt={libelle} />}
          {genre === 'pdf' && <iframe src={url!} title={libelle} />}
          {genre === 'autre' && (
            <p className="muted" style={{ margin: 0 }}>Ce type de fichier ne s’affiche pas ici : ouvre-le dans un onglet.</p>
          )}
          {ouvrir ? (
            <button type="button" className="lien-texte-lu" onClick={ouvrir}>Ouvrir dans un onglet ↗</button>
          ) : (
            <a href={url!} target="_blank" rel="noreferrer" className="muted">
              Ouvrir dans un nouvel onglet ↗
            </a>
          )}
        </>
      )}
      {children}
    </div>
  )
}
