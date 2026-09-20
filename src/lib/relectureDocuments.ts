import { supabase } from './supabase'
import { extractPiece, textractPeutLire } from './extraction'
import { enregistrerTexteOcr, texteOcrExploitable } from './texteOcr'
import type { DocumentDivers, Piece } from './types'

// Rejoue l'extraction sur des pièces déjà enregistrées, pour combler ce qui leur manque : la date, et
// le texte lu par l'OCR.
//
// **La date** : une pièce sans date n'entre dans aucun pack — le filtre `gte`/`lte` sur `date_piece`
// écarte les NULL (voir packGenerator) — donc elle est invisible du livrable envoyé au comptable,
// quelle que soit la période demandée. Textract n'étiquette le champ INVOICE_RECEIPT_DATE que de
// façon irrégulière, et le repli qui lit la date dans le texte brut est arrivé après coup : les
// pièces déposées avant n'en ont jamais bénéficié.
//
// **Le texte OCR** : il était calculé à chaque extraction puis jeté (voir lib/texteOcr.ts). Toutes
// les pièces déposées avant qu'on le conserve n'en ont donc aucun — or ce sont exactement celles que
// le cabinet arbitre aujourd'hui, et pour lesquelles « BOULANGER MARSEILLE » ne dit rien.
//
// **Les deux ensemble, en une seule passe.** Chaque relecture coûte un appel Textract facturé et
// jusqu'à 50 secondes : les séparer en deux actions paierait deux fois la même lecture. Ce qui est
// demandé au service est identique, seul diffère ce qu'on en garde.
//
// **Rien d'autre n'est jamais écrit.** Jamais le tiers, jamais les montants, jamais le statut : ces
// pièces sont pour la plupart déjà validées, donc relues et corrigées à la main par le comptable.
// Réécrire un montant corrigé avec ce que l'OCR croit lire détruirait ce travail sans que personne
// ne s'en aperçoive. Et la date n'est écrite que si elle était VIDE. C'est cette règle qui rend
// l'action sûre à lancer sur un dossier entier.

export interface ResultatRelecture {
  // Pièces effectivement datées et enregistrées. `deduite` distingue une date lue sur un libellé
  // reconnu d'une date retenue par la règle de dernier recours (première date en ordre de lecture) :
  // la seconde est juste dans la très grande majorité des mises en page, mais elle se vérifie.
  datees: { nomFichier: string; date: string; deduite: boolean }[]
  // Extraction réussie, mais aucune date exploitable. `datesVues` porte ce que le repli a trouvé sans
  // pouvoir trancher — de quoi ajuster la lecture sur un cas réel plutôt qu'à l'aveugle.
  sansDate: { nomFichier: string; datesVues: string[] }[]
  // Pièces dont le texte lu a été archivé. Compté à part des dates : une pièce déjà datée peut
  // n'être relue que pour son texte, et une pièce peut repartir sans texte si Textract n'a rien lu.
  textesArchives: string[]
  // Extraction ou enregistrement en échec, avec la cause.
  echecs: { nomFichier: string; message: string }[]
}

export function piecesADater(pieces: Piece[]): Piece[] {
  return pieces.filter((p) => !p.date_piece && !!p.storage_path)
}

// Les pièces qu'une relecture ferait progresser : celles sans date, et celles dont on n'a pas le
// texte lu. `avecTexteOcr` vient de la base (voir texteOcr.piecesAvecTexteOcr) — sans lui, on
// relirait tout le dossier à chaque lancement, en repayant Textract pour rien.
//
// « Progresser » exclut ce que Textract ne sait pas lire (voir `textractPeutLire`) : un CSV ou un
// texte brut n'obtiendra jamais de texte, donc il resterait éligible à chaque lancement — un résidu
// qui ne se résorbe pas et qui se présente à l'écran comme un échec, c'est-à-dire comme quelque
// chose à réessayer.
export function piecesARelire(pieces: Piece[], avecTexteOcr: Set<string>): Piece[] {
  return pieces.filter(
    (p) => !!p.storage_path && textractPeutLire(p.nom_fichier) && (!p.date_piece || !avecTexteOcr.has(p.id)),
  )
}

export async function relireDocuments(
  pieces: Piece[],
  avecTexteOcr: Set<string>,
  onProgression?: (fait: number, total: number, nomFichier: string) => void,
): Promise<ResultatRelecture> {
  const aTraiter = piecesARelire(pieces, avecTexteOcr)
  const resultat: ResultatRelecture = { datees: [], sansDate: [], textesArchives: [], echecs: [] }

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

      // Le texte d'abord : il s'archive même quand aucune date n'est trouvée, sinon une pièce
      // indatable repartirait aussi sans texte — alors que c'est justement celle dont l'opérateur a
      // le plus besoin de savoir ce qu'elle contient.
      if (texteOcrExploitable(extraction.texte_ocr)) {
        await enregistrerTexteOcr(piece.dossier_id, { type: 'piece', id: piece.id }, extraction.texte_ocr)
        resultat.textesArchives.push(piece.nom_fichier)
      }

      // La date n'est écrite que si elle manquait : une pièce relue pour son seul texte ne doit pas
      // voir sa date, corrigée à la main, remplacée par ce que l'OCR croit lire.
      if (piece.date_piece) continue

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

      resultat.datees.push({
        nomFichier: piece.nom_fichier,
        date: extraction.date_piece,
        deduite: extraction._date_deduite === true,
      })
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

// ═══ Le pendant côté DOCUMENTS ══════════════════════════════════════════════════════════════════
//
// Textract tourne sur TOUS les fichiers déposés, pièces comme documents — relevés bancaires, appels
// de cotisation, attestations, relevés d'activité. Le texte revenait donc pour chacun d'eux, et il
// était jeté : la table a bien reçu sa colonne `document_id` et l'écran sait afficher « texte lu »,
// mais RIEN ne l'a jamais rempli pour un document déjà en base. Mesuré le 19/09/2026 sur le dossier
// `test` : 37 documents sur 37 sans texte, dont les SNIR qui portent les honoraires de l'année —
// précisément le document qu'un cabinet veut pouvoir relire. Un chemin d'écriture qui n'existe pour
// aucun appelant est une fonctionnalité à moitié livrée, et rien ne le signale : la colonne est là,
// l'affichage est là, et l'écran reste muet parce qu'il n'y a rien à afficher.
//
// **Elle n'écrit QUE le texte**, et c'est plus fort encore que du côté des pièces : un document n'a
// ni date, ni tiers, ni montant, ni statut en base (voir `documents_divers`). Il n'y a donc
// littéralement rien d'autre à écrire — et cette fonction ne doit jamais devenir l'endroit où on
// commencerait à en déduire.

export interface ResultatRelectureDocuments {
  // Documents dont le texte lu a été archivé.
  textesArchives: string[]
  // Extraction réussie mais Textract n'a rien lu (page blanche, photo illisible). Distinct d'un
  // échec : l'appel a bien eu lieu et a bien été facturé, il n'y avait simplement rien à garder.
  // Le dire évite de relancer indéfiniment la relecture sur les mêmes fichiers muets.
  sansTexte: string[]
  echecs: { nomFichier: string; message: string }[]
}

// Les documents qu'une relecture ferait progresser : ceux dont on n'a pas le texte. Sans
// `avecTexteOcr` (voir texteOcr.documentsAvecTexteOcr) on relirait tout le dossier à chaque
// lancement, en repayant Textract pour du texte déjà en base.
//
// Et sans `textractPeutLire`, on le relancerait indéfiniment sur ce qu'il ne lira jamais : les
// relevés bancaires CSV, que le dépôt écarte déjà de l'extraction, sont dans cette table comme les
// autres documents. C'est ici que ça se voit, le compte s'affichant sur le bouton.
export function documentsARelire(documents: DocumentDivers[], avecTexteOcr: Set<string>): DocumentDivers[] {
  return documents.filter((d) => !!d.storage_path && textractPeutLire(d.nom_fichier) && !avecTexteOcr.has(d.id))
}

export async function relireTextesDocuments(
  documents: DocumentDivers[],
  avecTexteOcr: Set<string>,
  onProgression?: (fait: number, total: number, nomFichier: string) => void,
): Promise<ResultatRelectureDocuments> {
  const aTraiter = documentsARelire(documents, avecTexteOcr)
  const resultat: ResultatRelectureDocuments = { textesArchives: [], sansTexte: [], echecs: [] }

  // Séquentiel pour la même raison que côté pièces : chaque PDF passe par le chemin asynchrone de
  // Textract (dépôt S3 puis sondage jusqu'à 50 s), et lancer trente analyses d'un coup multiplie le
  // coût au même instant pour un gain nul sur une action qu'on ne lance qu'une fois.
  let fait = 0
  for (const document of aTraiter) {
    onProgression?.(fait, aTraiter.length, document.nom_fichier)
    try {
      const { data: fichier, error: erreurTelechargement } = await supabase.storage
        .from('pieces')
        .download(document.storage_path)
      if (erreurTelechargement || !fichier) {
        throw new Error(erreurTelechargement?.message ?? 'fichier introuvable dans le stockage')
      }

      const extraction = await extractPiece(fichier, document.nom_fichier)
      if (!texteOcrExploitable(extraction.texte_ocr)) {
        resultat.sansTexte.push(document.nom_fichier)
        continue
      }

      await enregistrerTexteOcr(
        document.dossier_id,
        { type: 'document', id: document.id },
        extraction.texte_ocr,
      )
      resultat.textesArchives.push(document.nom_fichier)
    } catch (err) {
      resultat.echecs.push({
        nomFichier: document.nom_fichier,
        message: err instanceof Error ? err.message : "l'extraction a échoué",
      })
    } finally {
      fait += 1
    }
  }

  onProgression?.(fait, aTraiter.length, '')
  return resultat
}
