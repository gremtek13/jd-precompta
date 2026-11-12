import { supabase } from './supabase'
import { extractPiece, textractPeutLire, type ExtractionResult } from './extraction'
import { pieceNonLue } from './lectureDesPieces'
import { montantsPourPiece } from './tauxChange'
import { enregistrerTexteOcr, texteOcrExploitable } from './texteOcr'
import type { DocumentDivers, Piece } from './types'
import { messageErreur } from './messageErreur'
import { cheminDuDossier, MOTIF_CHEMIN_HORS_DU_DOSSIER } from './cheminDuDossier'

// Rejoue l'extraction sur des pièces déjà enregistrées, pour combler ce qui leur manque : la date, et
// le texte lu par l'OCR.
//
// **La date** : une pièce sans date n'entre dans aucun pack — le filtre `gte`/`lte` sur `date_piece`
// écarte les NULL (voir packGenerator) — donc elle est invisible du livrable envoyé au comptable,
// quelle que soit la période demandée. Les pièces déposées avant que la lecture de date ne soit
// fiable n'en ont jamais bénéficié — d'abord parce que le repli sur texte brut est arrivé après
// coup, puis parce que `parseDate` perdait les dates précédées d'un jour de la semaine jusqu'au
// 21/09/2026. Une relecture est donc le seul moyen de leur appliquer les corrections d'après coup.
// (Le mécanisme d'origine — l'étiquetage irrégulier d'`INVOICE_RECEIPT_DATE` par `AnalyzeExpense` —
// n'existe plus depuis la marche 1 : c'est le MODÈLE qui désigne la date, et il la cite sur 42 des
// 43 textes du corpus réel. La relecture garde donc tout son sens, pour une autre raison.)
//
// **Le texte OCR** : il était calculé à chaque extraction puis jeté (voir lib/texteOcr.ts). Toutes
// les pièces déposées avant qu'on le conserve n'en ont donc aucun — or ce sont exactement celles que
// le cabinet arbitre aujourd'hui, et pour lesquelles « BOULANGER MARSEILLE » ne dit rien.
//
// **Les deux ensemble, en une seule passe.** Chaque relecture coûte un appel Textract facturé, plus
// un appel au modèle de citation : les séparer en deux actions paierait deux fois la même lecture.
// Ce qui est demandé au service est identique, seul diffère ce qu'on en garde.
//
// **Rien d'autre n'est jamais écrit, sauf sur une pièce que rien n'a lue.** Jamais le statut ; jamais le tiers ni les
// montants d'une pièce validée ou dont un montant a été saisi : ces pièces sont relues et corrigées à la main par le
// comptable, et réécrire un montant corrigé avec ce que l'OCR croit lire détruirait ce travail sans que personne ne s'en
// aperçoive. La date n'est écrite que si elle était VIDE. C'est cette règle qui rend l'action sûre à lancer sur un dossier
// entier.
//
// **LA PIÈCE QUE RIEN N'A LUE** (relecture du 04/11/2026, D5 ; PIECES-Q5, sur la recommandation) : « à valider », sans
// AUCUN montant — ni en euros, ni dans sa devise (`pieceNonLue`) —, elle n'a jamais été touchée : sa lecture a raté au
// dépôt (Textract, le modèle, un délai), et la relecture ne lui rendait que sa date, la laissant à ressaisir en entier, ou à
// relire pièce par pièce dans sa fiche (facturé à nouveau). Pour elle seule, la relecture écrit aussi les montants lus
// (convertis comme au dépôt, `montantsPourPiece`) et le tiers s'il est vide — et l'écriture le RE-VÉRIFIE en base : elle ne
// part que si la pièce est encore à valider et sans montant (et sans tiers, pour l'écrire), sinon elle ne touche rien et
// le dit. Ni la confiance, ni la catégorie, ni le statut : la pièce reste à valider, sous les yeux du cabinet.

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
  // Les pièces que rien n'avait lues (PIECES-Q5) dont les montants lus ont été écrits — le tiers avec, s'il manquait.
  montantsEcrits: { nomFichier: string; tiers: boolean }[]
  // Celles dont la relecture a lu un montant sans l'écrire : la base a vu la pièce validée, ou un montant (ou un tiers)
  // saisi entre la lecture de la liste et l'écriture.
  montantsNonEcrits: string[]
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
//
// Et la pièce que rien n'a lue (PIECES-Q5), même datée et pourvue de son texte : la citation des montants a pu rater seule,
// et c'est elle que la relecture complète désormais.
export function piecesARelire(pieces: Piece[], avecTexteOcr: Set<string>): Piece[] {
  return pieces.filter(
    (p) => !!p.storage_path && textractPeutLire(p.nom_fichier)
      && (!p.date_piece || !avecTexteOcr.has(p.id) || pieceNonLue(p)),
  )
}

export async function relireDocuments(
  pieces: Piece[],
  avecTexteOcr: Set<string>,
  onProgression?: (fait: number, total: number, nomFichier: string) => void,
): Promise<ResultatRelecture> {
  const aTraiter = piecesARelire(pieces, avecTexteOcr)
  const resultat: ResultatRelecture = {
    datees: [], sansDate: [], textesArchives: [], echecs: [], montantsEcrits: [], montantsNonEcrits: [],
  }

  // Séquentiel, jamais en parallèle : chaque PDF passe par le chemin asynchrone de Textract, qui
  // dépose le fichier sur S3 et sonde le job. Lancer vingt analyses d'un coup multiplie le coût au
  // même instant et risque le throttling côté AWS, pour un gain nul sur une action qu'on ne lance
  // qu'une fois. La progression est remontée à l'appelant, qui peut l'afficher.
  //
  // CE QUE COÛTE UN LOT A TRIPLÉ LE 21/09/2026, et c'est écrit ici plutôt que tu : le sondage
  // attendait 50 s en dur, il longe maintenant le mur de la plateforme (110 s de lecture, plus 30 s
  // de citation). Un document COURT ne change pas — la boucle sort dès que le job est fini — mais un
  // document long qui échouait en 52 s prend désormais jusqu'à 140 s et RÉUSSIT. Le pire cas d'un
  // lot passe donc d'environ 50 s à 140 s par pièce. C'est le bon échange (un document lu vaut mieux
  // qu'un lot rapide qui n'en lit aucun), mais quiconque dimensionne un lot doit partir du bon
  // chiffre.
  let fait = 0
  for (const piece of aTraiter) {
    onProgression?.(fait, aTraiter.length, piece.nom_fichier)
    try {
      // Le fichier d'un autre dossier ne se lit pas aux droits du cabinet, et ce qu'il dirait ne s'écrit pas sur une pièce
      // que le client voit (CFCS-Q1) : un échec, sans le chemin.
      if (!cheminDuDossier(piece.storage_path, piece.dossier_id)) {
        resultat.echecs.push({ nomFichier: piece.nom_fichier, message: MOTIF_CHEMIN_HORS_DU_DOSSIER })
        continue
      }
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

      // Les montants, et le tiers vide, d'une pièce que rien n'a lue — elle seule (PIECES-Q5).
      if (pieceNonLue(piece)) await ecrireLesMontantsLus(piece, extraction, resultat)

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
        message: messageErreur(err, "l'extraction a échoué"),
      })
    } finally {
      fait += 1
    }
  }

  onProgression?.(fait, aTraiter.length, '')
  return resultat
}

// L'écriture des montants lus sur une pièce que rien n'avait lue (PIECES-Q5). Rien quand la relecture n'a lu aucun montant.
// L'écriture porte ses propres conditions, que la base juge au moment d'écrire — encore à valider, encore sans aucun
// montant, encore sans tiers si elle l'écrit — et rend la ligne touchée : sans elle, rien n'a été écrit, et c'est dit.
async function ecrireLesMontantsLus(piece: Piece, extraction: ExtractionResult, resultat: ResultatRelecture): Promise<void> {
  if (extraction.montant_ttc == null && extraction.montant_ht == null && extraction.montant_tva == null) return
  const montants = await montantsPourPiece(extraction, extraction.date_piece ?? piece.date_piece)
  const tiers = !piece.tiers && extraction.tiers ? extraction.tiers : null
  let requete = supabase.from('pieces')
    .update(tiers ? { ...montants, tiers } : montants)
    .eq('id', piece.id)
    .eq('statut', 'a_valider')
    .is('montant_ht', null).is('montant_tva', null).is('montant_ttc', null).is('montant_devise', null)
  if (tiers) requete = requete.is('tiers', null)
  const { data, error } = await requete.select('id')
  if (error) throw error
  if (!data || data.length === 0) resultat.montantsNonEcrits.push(piece.nom_fichier)
  else resultat.montantsEcrits.push({ nomFichier: piece.nom_fichier, tiers: tiers !== null })
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
  // Textract (dépôt S3 puis sondage), et lancer trente analyses d'un coup multiplie le coût au même
  // instant pour un gain nul sur une action qu'on ne lance qu'une fois. Le pire cas par document est
  // celui décrit plus haut, et il a triplé le 21/09/2026.
  let fait = 0
  for (const document of aTraiter) {
    onProgression?.(fait, aTraiter.length, document.nom_fichier)
    try {
      // Comme pour les pièces (CFCS-Q1) : un document du client qui nomme un autre dossier n'est pas lu.
      if (!cheminDuDossier(document.storage_path, document.dossier_id)) {
        resultat.echecs.push({ nomFichier: document.nom_fichier, message: MOTIF_CHEMIN_HORS_DU_DOSSIER })
        continue
      }
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
        message: messageErreur(err, "l'extraction a échoué"),
      })
    } finally {
      fait += 1
    }
  }

  onProgression?.(fait, aTraiter.length, '')
  return resultat
}
