import { supabase } from './supabase'
import { extractPiece } from './extraction'
import type { Piece } from './types'

// Rejoue l'extraction sur des pièces déjà enregistrées, dans un seul but : leur trouver la date qui
// manque. Une pièce sans date n'entre dans aucun pack — le filtre `gte`/`lte` sur `date_piece` écarte
// les NULL (voir packGenerator) — donc elle est invisible du livrable envoyé au comptable, quelle que
// soit la période demandée.
//
// Pourquoi une reprise en masse : Textract n'étiquette le champ INVOICE_RECEIPT_DATE que de façon
// irrégulière, et le repli qui lit la date dans le texte OCR brut est arrivé après coup. Les pièces
// déposées avant n'en ont donc jamais bénéficié, et les reprendre une par une à la main n'a aucun
// intérêt quand elles se comptent par dizaines.
//
// **Seule `date_piece` est écrite, et seulement si elle était vide.** Jamais le tiers, jamais les
// montants, jamais le statut : ces pièces sont pour la plupart déjà validées, donc relues et
// éventuellement corrigées à la main par le comptable. Réécrire un montant corrigé avec ce que
// l'OCR croit lire détruirait ce travail sans que personne ne s'en aperçoive. C'est la règle qui
// rend cette action sûre à lancer sur un dossier entier.

export interface ResultatReextraction {
  // Pièces effectivement datées et enregistrées.
  datees: { nomFichier: string; date: string }[]
  // Extraction réussie, mais aucune date exploitable. `datesVues` porte ce que le repli a trouvé sans
  // pouvoir trancher — de quoi ajuster la lecture sur un cas réel plutôt qu'à l'aveugle.
  sansDate: { nomFichier: string; datesVues: string[] }[]
  // Extraction ou enregistrement en échec, avec la cause.
  echecs: { nomFichier: string; message: string }[]
}

export function piecesADater(pieces: Piece[]): Piece[] {
  return pieces.filter((p) => !p.date_piece && !!p.storage_path)
}

export async function reextraireDates(
  pieces: Piece[],
  onProgression?: (fait: number, total: number, nomFichier: string) => void,
): Promise<ResultatReextraction> {
  const aTraiter = piecesADater(pieces)
  const resultat: ResultatReextraction = { datees: [], sansDate: [], echecs: [] }

  // Séquentiel, jamais en parallèle : chaque PDF passe par le chemin asynchrone de Textract, qui
  // dépose le fichier sur S3 et sonde le job jusqu'à 50 s. Lancer vingt analyses d'un coup multiplie
  // le coût au même instant et risque le throttling côté AWS, pour un gain nul sur une action qu'on
  // ne lance qu'une fois. La progression est remontée à l'appelant, qui peut l'afficher.
  let fait = 0
  for (const piece of aTraiter) {
    onProgression?.(fait, aTraiter.length, piece.nom_fichier)
    try {
      const { data: fichier, error: erreurTelechargement } = await supabase.storage
        .from('pieces')
        .download(piece.storage_path)
      if (erreurTelechargement || !fichier) {
        throw new Error(erreurTelechargement?.message ?? 'fichier introuvable dans le stockage')
      }

      const extraction = await extractPiece(fichier, piece.nom_fichier)

      if (!extraction.date_piece) {
        resultat.sansDate.push({ nomFichier: piece.nom_fichier, datesVues: extraction._diag_dates ?? [] })
        continue
      }

      // Écriture vérifiée, jamais supposée : sans ce contrôle, une policy RLS refusant la mise à jour
      // laisserait l'écran annoncer « N pièces datées » sur des lignes restées vides en base.
      const { error: erreurEcriture } = await supabase
        .from('pieces')
        .update({ date_piece: extraction.date_piece })
        .eq('id', piece.id)
      if (erreurEcriture) throw erreurEcriture

      resultat.datees.push({ nomFichier: piece.nom_fichier, date: extraction.date_piece })
    } catch (err) {
      resultat.echecs.push({
        nomFichier: piece.nom_fichier,
        message: err instanceof Error ? err.message : "l'extraction a échoué",
      })
    } finally {
      fait += 1
    }
  }

  onProgression?.(fait, aTraiter.length, '')
  return resultat
}
