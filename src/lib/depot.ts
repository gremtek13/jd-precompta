import { supabase } from './supabase'
import { ACHAT_PAR_DEFAUT, extractPiece, fichierDejaPresent, hashFichier, orientationDe, textractPeutLire, type ExtractionResult } from './extraction'
import { slugify } from './format'
import type { CibleCommentaire } from './commentaires'
import { enregistrerTexteOcr } from './texteOcr'
import { montantsPourPiece } from './tauxChange'
import { messageErreur } from './messageErreur'
import { ouvrirApercu } from './apercu'
import { retirerFichiers } from './stockage'

// En cas de succès, la ligne créée est nommée : c'est ce qui permet à l'écran de proposer au client
// d'y ajouter une précision tout de suite, au seul moment où il sait encore pourquoi la dépense a été
// faite (voir lib/commentaires.ts). Sans elle, il faudrait deviner laquelle des lignes rechargées est
// la sienne — et sur deux photos de la même enseigne prises à une minute d'intervalle, c'est faux.
export type ResultatDepot =
  | { statut: 'ok'; cible: CibleCommentaire }
  | { statut: 'doublon' }
  | { statut: 'erreur'; message: string }

// Dépose un seul fichier pour un dossier client : hash anti-doublon, upload storage, extraction
// automatique (sauf CSV, classé direct en relevé bancaire), puis insertion en pieces ou
// documents_divers selon le résultat. Extrait de ClientUpload pour être partagé avec la prise de
// photo directe sur l'accueil (ClientHome) — un seul endroit à faire évoluer si le pipeline change,
// peu importe d'où vient le fichier (glisser-déposer, sélecteur, appareil photo).
//
// Comme dans ClientUpload, l'extraction se fait AVANT l'écriture en base, jamais en correction après
// coup : le client n'a pas le droit de modifier une pièce une fois déposée, donc le classement et les
// montants lus doivent être connus dès l'unique insertion.
//
// Pipeline volontairement jumeau de `importerFichierDossier` (lib/importFichiers.ts), qui fait la
// même chose côté cabinet : hash, anti-doublon, envoi, raccourci CSV, extraction, aiguillage
// Pièces/Documents. Les deux existent parce que les contrats diffèrent (le cabinet importe un lot et
// laisse remonter ses erreurs, le client dépose un fichier et reçoit un statut), mais toute
// correction apportée à l'un doit être portée à l'autre — c'est ainsi que le nettoyage de l'orphelin
// ci-dessous a manqué ici pendant un temps alors qu'il existait déjà là-bas.
//
// `hashsDuLot` est l'équivalent du `hashsConnus` du cabinet, mais il n'a pas le même rôle et ne peut
// pas avoir la même mécanique : le cabinet traite ses fichiers en série et n'y note un fichier
// qu'une fois écrit, alors que le client les dépose en parallèle (Promise.all dans ClientUpload).
// Deux fichiers de contenu identique du même lot — le cas courant étant la même facture téléchargée
// deux fois depuis un portail fournisseur, « facture.pdf » et « facture (1).pdf » — passent donc
// tous deux la vérification en base avant que l'un ait écrit sa ligne, et repartent en double sans
// que rien ne les arrête : il n'y a pas d'index unique sur (dossier_id, storage_hash). Le paramètre
// est requis, et non optionnel avec un Set vide par défaut, pour qu'aucun appelant ne retombe dans
// ce trou sans l'avoir décidé.
export async function deposerFichier(dossierId: string, file: File, hashsDuLot: Set<string>): Promise<ResultatDepot> {
  const hash = await hashFichier(file)
  if (hashsDuLot.has(hash)) return { statut: 'doublon' }
  // Réservation immédiate : aucun `await` entre le test et l'ajout, donc rien ne peut s'intercaler
  // (JavaScript est mono-thread). Ce Set note ce qui est *engagé*, pas ce qui est écrit — la
  // réservation est relâchée plus bas si le dépôt échoue, sans quoi un fichier dont l'envoi a raté
  // serait ensuite annoncé « déjà déposé » et ne repartirait jamais.
  hashsDuLot.add(hash)

  try {
    if (await fichierDejaPresent(dossierId, hash)) return { statut: 'doublon' }

    const path = `${dossierId}/${Date.now()}-${slugify(file.name)}`
    const { error: uploadError } = await supabase.storage.from('pieces').upload(path, file)
    if (uploadError) throw uploadError

    // Le fichier est dans le stockage mais rien ne pointe encore dessus : si l'insertion échoue, on
    // le retire avant de remonter l'erreur. Sans cela il y restait orphelin — un client ne voit rien,
    // et seule la suppression du dossier entier l'aurait nettoyé.
    // Rend l'identifiant de la ligne écrite : l'écran en a besoin pour proposer tout de suite une
    // précision sur CE dépôt-là.
    const enregistrer = async (table: 'pieces' | 'documents_divers', ligne: Record<string, unknown>): Promise<string> => {
      const { data, error } = await supabase.from(table).insert(ligne).select('id').single()
      if (error || !data) {
        // ET LE RETRAIT LUI-MÊME SE VÉRIFIE : une compensation dont on jette le résultat laisse
        // exactement l'orphelin qu'elle existe pour éviter. Rien ne recharge le STOCKAGE — aucun écran
        // ne le relit jamais — donc l'échec n'aurait aucun témoin, et chaque nouvel essai déposerait un
        // fichier de plus (le chemin porte un horodatage). `retirerFichiers` journalise et ne LÈVE
        // jamais — c'est ce qui garantit que l'erreur remontée reste celle de l'INSERTION, la seule
        // qui explique à l'utilisateur ce qui s'est passé, et non une coupure réseau survenue après.
        await retirerFichiers('pieces', [path], 'depot')
        throw error ?? new Error("l'enregistrement n'a rien rendu")
      }
      return data.id as string
    }

    const estCsv = file.name.toLowerCase().endsWith('.csv')
    if (estCsv) {
      const id = await enregistrer('documents_divers', {
        dossier_id: dossierId, storage_path: path, storage_hash: hash, nom_fichier: file.name, categorie: 'releve_bancaire',
      })
      return { statut: 'ok', cible: { type: 'document', id } }
    }

    // Un format que Textract ne lit pas n'est pas envoyé : il rendrait un 400 et l'on retomberait de
    // toute façon sur `ACHAT_PAR_DEFAUT` ci-dessous. Même issue, un aller-retour en moins — et
    // surtout la règle est désormais NOMMÉE (voir `textractPeutLire`) au lieu d'être un `.csv` écrit
    // en dur ici et dans `importFichiers.ts`, que la relecture n'avait pas hérité.
    let extraction: ExtractionResult | null = null
    if (textractPeutLire(file.name)) {
      try {
        extraction = await extractPiece(file, file.name)
      } catch {
        extraction = null // best-effort : atterrit en Pièces à compléter par le cabinet si l'extraction échoue
      }
    }

    const orientation = extraction ? orientationDe(extraction.classification) : ACHAT_PAR_DEFAUT

    if (orientation.destination === 'documents') {
      const id = await enregistrer('documents_divers', {
        dossier_id: dossierId, storage_path: path, storage_hash: hash, nom_fichier: file.name,
        categorie: orientation.categorie,
      })
      // Le texte lu vaut pour un document autant que pour une pièce : Textract a déjà tourné, il est
      // déjà payé. Le jeter ici rendait illisible tout ce qui part en archive — relevés, cotisations,
      // et les SNIR qui portent les honoraires de l'année.
      await enregistrerTexteOcr(dossierId, { type: 'document', id }, extraction?.texte_ocr)
      return { statut: 'ok', cible: { type: 'document', id } }
    } else {
      const { data: userData } = await supabase.auth.getUser()
      // Conversion en euros AVANT l'insertion, comme le classement et les montants lus : le client
      // n'a pas le droit de modifier une pièce déposée, donc rien ne peut être corrigé après coup.
      const montants = await montantsPourPiece(extraction ?? {}, extraction?.date_piece ?? null)
      const id = await enregistrer('pieces', {
        dossier_id: dossierId, uploaded_by: userData.user?.id ?? null, storage_path: path, storage_hash: hash,
        nom_fichier: file.name, type_piece: orientation.type_piece, statut: 'a_valider',
        date_piece: extraction?.date_piece ?? null,
        tiers: extraction?.tiers ?? null,
        ...montants,
        confiance: extraction?.confiance ?? null,
      })
      // Après l'insertion, jamais avant : la policy exige que la pièce existe déjà. N'échoue jamais
      // le dépôt — ce texte est un confort de relecture, et perdre le document du client pour ça
      // serait sans commune mesure (voir lib/texteOcr.ts).
      await enregistrerTexteOcr(dossierId, { type: 'piece', id }, extraction?.texte_ocr)
      return { statut: 'ok', cible: { type: 'piece', id } }
    }
  } catch (err) {
    hashsDuLot.delete(hash)
    return { statut: 'erreur', message: messageErreur(err, "l'envoi a échoué")}
  }
}

// Ouvre le justificatif d'une pièce dans un nouvel onglet via une URL signée temporaire (le bucket
// "pieces" n'est pas public) — même mécanisme que l'aperçu de FichePiece, réutilisé pour
// consulter un justificatif sans quitter l'écran de rapprochement bancaire (voir BanqueTab) : on n'y
// affichait jusqu'ici que le tiers et le montant, jamais le document lui-même.
export async function ouvrirJustificatif(storagePath: string): Promise<void> {
  // Passe par le point unique (lib/apercu.ts) : la version locale disait « Aperçu indisponible »
  // sans la raison, et son `noopener` rendait par-dessus le marché un blocage de fenêtre
  // indiscernable d'une réussite.
  const resultat = await ouvrirApercu('pieces', storagePath, 300)
  if (!resultat.ok) window.alert(resultat.message)
}
