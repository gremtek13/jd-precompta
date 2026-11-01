import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { cleFournisseur, normalizeTiers, slugify } from '../../lib/format'
import { extractPiece, fichierDejaPresent, hashFichier } from '../../lib/extraction'
import { suggererCategorie } from '../../lib/tiersCategories'
import { AVERTISSEMENT_PAIEMENT_DEFAIT, LIBELLE_MOTIF_TVA, piecesTvaImpossible } from '../../lib/controles'
import { convertirMontants, deviseDuTexte, DEVISE_PIVOT, libelleConversion } from '../../lib/devises'
import { tauxBce } from '../../lib/tauxChange'
import { useAuth } from '../../context/AuthContext'
import type { Categorie, Piece, PieceCommentaire, SousDossier, TiersCategorie, TiersCategorieCabinet, TypePiece } from '../../lib/types'
import FilCommentaires from '../../components/FilCommentaires'
import { EntetePanneau } from '../../components/PanneauDroit'
import { IconChevron, IconPrecedent } from '../../components/icons'
import { messageErreur } from '../../lib/messageErreur'
import { retirerFichiers } from '../../lib/stockage'
import { fichierAMontrer, fichiersDeLaPiece } from '../../lib/fichiersPiece'
import { ouvrirJustificatif } from '../../lib/depot'
import { libelleIssue, type PropositionCategorie } from '../../lib/categorisationIa'
import { proposerCategorie } from '../../lib/propositionCategorie'
import { AUCUNE_PIECE_SUPPRIMEE, messageBilanSuppressionPieces } from '../../lib/bilanSuppression'
import { PASTILLE_DE_LA_MARQUE, type MarqueDeLaPiece } from '../../lib/ventesJumelles'
import { enregistrerNoteInterne, lireNoteInterne, noteModifiee, type LectureNoteInterne } from '../../lib/notesInternes'
import { ficheEmporteeParLaSuppression } from '../../lib/propositionsHorsDeFrance'
import { pieceDeclaree } from '../../lib/ereportingEcran'
import FicheHorsDeFrance, { type DonneesHorsDeFrance } from './FicheHorsDeFrance'
import ExemplaireDeLaFacture, { type DonneesExemplaire } from './ExemplaireDeLaFacture'
import { refusDuFormulaireDeLaPiece } from '../../lib/exemplairesDesFacturesEcran'
import { passageJugeParG3, refusDeLaValidationDUneVente, type PieceMarquable } from '../../lib/exemplairesDesFactures'
import { pieceAJour, type LectureDeCeQueLaPieceEst, type MarquesDeLaPiece } from '../../lib/marquesDeLaPiece'
import { lireCeQueLaPieceEst, relireLesMarquesDeLaPiece } from '../../lib/marquesDeLaPieceLecture'
import { preparerPiece, refusDUnePiece } from '../../lib/bornesStockage'
import ReglementParLaCaisse, { type CaisseDeLaPiece } from './ReglementParLaCaisse'
import {
  etatDeLaCaisseDeLaFiche, refusDeLaDesignationParLaCaisse, refusDuTypeDeLaPiece, suppressionRetenueParLaCaisse,
} from '../../lib/paiementParLaCaisseEcran'

// L'apprentissage tiers → catégorie ne doit jamais faire échouer l'enregistrement d'une pièce : il
// reste best-effort. Mais l'avaler en silence n'est pas la même chose, et c'est ce qui a permis à la
// règle cabinet d'échouer à chaque fois sans que rien ne le signale — la table est restée vide alors
// que les quatre règles de dossier, elles, se sont bien écrites. Un échec est désormais journalisé.
async function memoriser(quoi: string, requete: PromiseLike<{ error: { message: string } | null }>) {
  const { error } = await requete
  if (error) console.warn(`Mémorisation de ${quoi} impossible (sans conséquence sur la pièce) :`, error.message)
}

function typeApercu(nom: string): 'image' | 'pdf' | 'autre' {
  const ext = nom.toLowerCase().split('.').pop() ?? ''
  if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) return 'image'
  if (ext === 'pdf') return 'pdf'
  return 'autre'
}

// La fiche d'une pièce, dans le panneau de droite (voir lib/panneauDroit.ts) — elle était une fenêtre
// modale qui assombrissait tout l'écran, et elle reste un simple contenu : c'est l'écran appelant qui
// la pose dans le volet, lui donne sa place dans la liste et décide de ce qui suit un enregistrement.
// Ce qu'elle y gagne est le geste que la maquette validée mettait en avant : parcourir et valider les
// pièces à la chaîne, la liste toujours visible à côté, sans rouvrir de fenêtre.
interface Props {
  dossierId: string
  categories: Categorie[]
  sousDossiers: SousDossier[]
  tiersCategories: TiersCategorie[]
  tiersCategoriesCabinet: TiersCategorieCabinet[]
  tiersConnus: string[]
  piece: Piece | null // null = création
  // Le fil des précisions de cette pièce, déjà chargé par l'écran appelant — voir lib/commentaires.ts.
  commentaires: PieceCommentaire[]
  onClose: () => void
  onSaved: () => void
  // Remonté à l'écran appelant : une précision ajoutée ici doit apparaître sur la ligne d'arbitrage
  // même si la fiche est fermée sans être enregistrée. Commenter n'est pas modifier la pièce.
  onCommentaireAjoute: (commentaire: PieceCommentaire) => void
  onCommentaireSupprime: (id: string) => void
  // Sa place dans la liste d'où elle est ouverte (« Justificatif 3 sur 12 ») et de quoi passer à la
  // voisine sans y revenir — null aux deux bouts.
  navigation?: { position: string; precedente: (() => void) | null; suivante: (() => void) | null }
  // Rapprochée d'un mouvement bancaire : dit dans la fiche comme sur la ligne de la liste.
  rapprochee?: boolean
  // Après une VALIDATION, l'écran appelant enchaîne sur la prochaine pièce à valider. Sans lui, la
  // fiche se ferme, comme la fenêtre d'avant.
  onValidee?: (pieceId: string) => void
  // Rapporte si la fiche porte une saisie non enregistrée : c'est l'écran appelant qui garde le volet
  // (la garde de sortie de lib/panneauDroit.ts). Doit être une fonction STABLE.
  onModifiee?: (modifiee: boolean) => void
  // L'écran appelant SAIT que cette pièce n'a pas de texte lu : « Proposer une catégorie » n'aurait
  // rien à citer, donc ne s'affiche pas. Dans le doute (liste des textes illisible), il reste : la
  // fonction refuse alors sans appeler le modèle, donc sans rien facturer.
  sansTexteLu?: boolean
  // CE QU'UN EXERCICE VALIDÉ A FIGÉ (lib/validationExercice.ts, `piecesFigees`) : la phrase qui le dit — « L'exercice
  // 2025 est validé » —, ou rien. Une pièce qui justifie une écriture validée ne change plus que dans ses notes et son
  // sous-dossier, et ne se supprime plus (`garder_piece_validee`) : la fiche le dit et n'offre que ces deux champs,
  // au lieu de laisser la base refuser un enregistrement que tout l'écran proposait.
  figeePar?: string | null
  // LA RÉVISION DES SOLDES QUI CITE CETTE PIÈCE (ligne 41, hypothèse Q8, `garder_source_citee`) : la phrase de la base
  // qui refuse sa suppression (`refusDuRetraitDUneSource`), ou rien. La fiche le dit et n'offre pas « Supprimer » ; le
  // reste de la pièce se modifie toujours — un fichier remplacé change son empreinte, et la décision qui la cite le dira.
  citeePar?: string | null
  // LA FACTURE ÉMISE QUE CETTE PIÈCE PORTE (ligne 28.6, lib/ventesJumelles.ts) : sa marque, et le nom des autres pièces
  // qui portent la même facture. L'écran appelant ne la donne que sur des listes lues en entier ; rien, sinon.
  venteEmise?: (Pick<MarqueDeLaPiece, 'genre' | 'libelle' | 'explication'> & { autres: string[] }) | null
  // LA FICHE « FOURNISSEUR ÉTABLI HORS DE FRANCE » (ligne 28.5, e-reporting, étape e3) : les fiches du dossier lues par
  // l'écran appelant, de quoi les relire, le gel de la pièce et les pièces du dossier. Obligatoire : la confirmation de
  // la suppression nomme la fiche qu'elle emporte (la clé est en cascade), et un appelant qui l'oublierait la tairait.
  horsDeFrance: DonneesHorsDeFrance
  // CE QUE CETTE PIÈCE EST (ligne 28.6 : étapes VF1b et VF6c) : les factures validées du dossier lues par l'écran appelant, le
  // gel de la pièce et de quoi relire sa ligne après un geste. FACULTATIF, et sa seule absence suffit : sans lui la fiche
  // n'offre aucun geste sur la marque d'une pièce de vente — un geste ne s'offre jamais sur des données que l'appelant n'a pas
  // lues —, ne lit rien de plus, et laisse la base juger seule la validation d'une vente (G3). Avec lui, la fiche lit
  // elle-même ce que la pièce est (lib/marquesDeLaPieceLecture.ts) : la bascule du dossier, le pont, les liens, le virement
  // mixte, le journal. Le cabinet seul ouvre cette fiche (l'onglet des justificatifs) ; l'espace du client ne la monte pas.
  exemplaire?: DonneesExemplaire | null
  // LA CAISSE DU DOSSIER (ligne 26.6, étape C9b ; CAISSE-Q4) : sa lecture, le dossier, les paiements de chaque pièce et de quoi
  // relire. FACULTATIF, et son absence suffit : sans elle — le drapeau `PAIEMENT_PAR_LA_CAISSE_EXPORTE` baissé, un dossier en
  // engagement —, la fiche ne dit rien de la caisse et n'offre aucun geste, comme hier. Avec elle, la section « Payée en
  // espèces » règle la pièce par la caisse et en retire un paiement, et la garde de la pièce (`garder_piece_payee_par_la_caisse`)
  // se dit avant l'enregistrement, la désignation et la suppression.
  caisse?: CaisseDeLaPiece | null
}

export default function FichePiece({ dossierId, categories, sousDossiers, tiersCategories, tiersCategoriesCabinet, tiersConnus, piece, commentaires: commentairesInitiaux, onClose, onSaved, onCommentaireAjoute, onCommentaireSupprime, navigation, rapprochee = false, onValidee, onModifiee, sansTexteLu = false, figeePar = null, citeePar = null, venteEmise = null, horsDeFrance, exemplaire = null, caisse = null }: Props) {
  const fige = piece !== null && figeePar !== null
  // LA PIÈCE DONT LA FICHE EST DÉCLARÉE À L'E-REPORTING ne se supprime plus (hypothèse E5-Q6, `garder_piece_declaree`) : la
  // fiche le dit sous les mots de la base et n'offre pas « Supprimer ». Les fiches ou les déclarations lues en partie ne
  // disent rien d'elle : la confirmation de la suppression le dit (`declaree.sait === false`).
  const declaree = piece !== null ? pieceDeclaree(piece.id, horsDeFrance.lecture, horsDeFrance.declarations) : null
  const declareePar = declaree?.sait ? declaree.message : null
  // Cabinet de l'utilisateur connecté : la règle tiers → catégorie partagée entre dossiers lui
  // appartient (contrainte unique (cabinet_id, tiers_normalise), RLS admin_du_cabinet). L'omettre
  // était l'une des deux raisons pour lesquelles elle ne s'écrivait jamais.
  const { monCabinetId, session } = useAuth()
  // Le compte connecté : le journal d'une pièce dit ses gestes « par vous ».
  const moi = session?.user.id ?? null
  const [file, setFile] = useState<File | null>(null)
  // Les bornes du seau des pièces (ligne 22.6), jugées dès le choix du fichier : le refus se dit tout de suite, avec le
  // poids et la borne, et le fichier n'est pas retenu. `choixDuFichier` est le choix en cours d'examen : la réponse pour
  // un fichier déjà remplacé par un autre choix ne décide plus rien.
  const choixDuFichier = useRef<File | null>(null)
  const [refusFichier, setRefusFichier] = useState<string | null>(null)
  const [datePiece, setDatePiece] = useState(piece?.date_piece ?? '')
  const [tiers, setTiers] = useState(piece?.tiers ?? '')
  const [typePiece, setTypePiece] = useState<TypePiece>(piece?.type_piece ?? 'achat')
  const [categorieId, setCategorieId] = useState(piece?.categorie_id ?? '')
  const [sousDossierId, setSousDossierId] = useState(piece?.sous_dossier_id ?? '')
  const [montantHt, setMontantHt] = useState(piece?.montant_ht?.toString() ?? '')
  const [montantTva, setMontantTva] = useState(piece?.montant_tva?.toString() ?? '')
  const [montantTtc, setMontantTtc] = useState(piece?.montant_ttc?.toString() ?? '')
  // La devise et sa conversion suivent la pièce sans être modifiables champ par champ : un taux saisi
  // à la main ne serait plus justifiable devant un contrôle. Ce qui est offert, c'est de REFAIRE la
  // conversion au taux BCE de la date courante — le cas qui arrive vraiment, quand la date lue était
  // fausse et qu'on vient de la corriger.
  const [devise, setDevise] = useState(piece?.devise ?? DEVISE_PIVOT)
  const [montantDevise, setMontantDevise] = useState<number | null>(piece?.montant_devise ?? null)
  const [tauxChange, setTauxChange] = useState<number | null>(piece?.taux_change ?? null)
  const [conversionSource, setConversionSource] = useState<'bce' | 'banque' | null>(piece?.conversion_source ?? null)
  const [dateTaux, setDateTaux] = useState<string | null>(null)
  const [conversionEnCours, setConversionEnCours] = useState(false)
  const [conversionErreur, setConversionErreur] = useState<string | null>(null)
  // LA NOTE INTERNE, lue à part : elle vit dans `notes_internes`, que le client ne lit pas (espace client, étape P0),
  // et non plus sur la pièce. Tant qu'elle n'est pas lue (`null`), ou si elle ne l'a pas été, le champ n'est pas
  // offert et l'enregistrement de la pièce ne la touche pas : un champ vide faute d'avoir lu effacerait la note au
  // premier enregistrement. Une pièce en cours de création n'a pas encore de note, comme elle n'a pas de fil.
  // La lecture est gardée AVEC la pièce pour laquelle elle a été faite : la fiche est clée par pièce (voir PiecesTab),
  // mais si elle passait un jour d'une pièce à l'autre sans se remonter, la note de l'une ne s'offrirait pas pour
  // l'autre — et ne s'y écrirait pas.
  const pieceId = piece?.id ?? null
  const [noteLue, setNoteLue] = useState<{ pour: string; lecture: LectureNoteInterne } | null>(null)
  const lectureNote = noteLue !== null && noteLue.pour === pieceId ? noteLue.lecture : null
  const [notes, setNotes] = useState('')
  const [commentaires, setCommentaires] = useState(commentairesInitiaux)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [extracting, setExtracting] = useState(false)
  // Verrou d'exécution de l'extraction, en `useRef` : `setExtracting(true)` ne prend effet qu'au rendu suivant, donc
  // `disabled={extracting}` laissait passer deux clics du même rendu — deux lectures FACTURÉES du même fichier (OCR puis
  // citation), dont la plus lente réécrivait les champs déjà corrigés d'après la première.
  const extractionEnCours = useRef(false)
  const [extractionError, setExtractionError] = useState<string | null>(null)
  // Initialisé depuis la pièce (pas null) : sans ça, rouvrir une pièce déjà extraite sans relancer
  // l'extraction écraserait sa confiance enregistrée à la sauvegarde suivante.
  const [confiance, setConfiance] = useState<'haute' | 'moyenne' | 'basse' | null>(piece?.confiance ?? null)
  const [suggestionAutre, setSuggestionAutre] = useState<string | null>(null)
  const [lignesBrutes, setLignesBrutes] = useState<string[] | undefined>(undefined)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  // La catégorie proposée par le modèle, avec le TYPE pour lequel elle a été demandée : le sens de la
  // pièce décide des catégories proposables, donc une proposition faite pour un achat ne vaut plus
  // rien quand l'opérateur repasse la pièce en vente.
  const [proposition, setProposition] = useState<{ pourType: TypePiece; resultat: PropositionCategorie } | null>(null)
  const [proposant, setProposant] = useState(false)
  const [erreurProposition, setErreurProposition] = useState<string | null>(null)
  // Une saisie de la fiche « hors de France » en cours, non enregistrée : la garde du volet la protège comme le reste.
  const [ficheHorsDeFranceModifiee, setFicheHorsDeFranceModifiee] = useState(false)

  // Une saisie NON ENREGISTRÉE : tout champ qui s'écarte de la pièce telle qu'ouverte, un fichier
  // choisi, une extraction qui a rempli le formulaire. Dans une fenêtre modale la question ne se
  // posait pas — rien d'autre n'était cliquable. Dans le volet, une autre ligne, « suivante »,
  // « Assistant » ou la croix peuvent chasser la fiche : l'écran appelant s'en sert pour demander
  // avant de laisser partir ce qui a été tapé.
  const modifiee = file !== null
    || datePiece !== (piece?.date_piece ?? '')
    || tiers !== (piece?.tiers ?? '')
    || typePiece !== (piece?.type_piece ?? 'achat')
    || categorieId !== (piece?.categorie_id ?? '')
    || sousDossierId !== (piece?.sous_dossier_id ?? '')
    || montantHt !== (piece?.montant_ht?.toString() ?? '')
    || montantTva !== (piece?.montant_tva?.toString() ?? '')
    || montantTtc !== (piece?.montant_ttc?.toString() ?? '')
    || devise !== (piece?.devise ?? DEVISE_PIVOT)
    || montantDevise !== (piece?.montant_devise ?? null)
    || tauxChange !== (piece?.taux_change ?? null)
    || noteModifiee(lectureNote, notes)
    || ficheHorsDeFranceModifiee
  useEffect(() => { onModifiee?.(modifiee) }, [modifiee, onModifiee])
  // Ce que la base compare à la fiche « hors de France » : le type, la TVA, le TTC, la devise et le montant dans la devise
  // ENREGISTRÉS. Tant qu'un de ces champs porte une saisie, la fiche ne s'enregistre pas : elle serait jugée sur autre
  // chose que ce que l'écran montre.
  const pieceModifieePourLaFiche = piece !== null && (
    typePiece !== piece.type_piece
    || montantTva !== (piece.montant_tva?.toString() ?? '')
    || montantTtc !== (piece.montant_ttc?.toString() ?? '')
    || devise !== piece.devise
    || montantDevise !== piece.montant_devise
  )
  // Démontée — remplacée, fermée —, elle n'a plus rien à protéger.
  useEffect(() => () => onModifiee?.(false), [onModifiee])

  // LA MARQUE DE LA PIÈCE (étape VF6c) : sa désignation, sa déclaration, son statut — relus par la fiche après chacun de ses
  // gestes. L'écran appelant ne recopie que la désignation dans la pièce qu'il lui passe ; une déclaration posée ou retirée
  // ne se verrait pas sans cette relecture (`pieceAJour` : la plus récente des deux).
  const [marquesRelues, setMarquesRelues] = useState<MarquesDeLaPiece | null>(null)
  const pieceMarquee = piece === null ? null : pieceAJour(piece, marquesRelues)

  // La désignation et la déclaration se jouent dans la base, sur la pièce ENREGISTRÉE : le formulaire dit avant
  // l'enregistrement ce que la garde refuserait — sa nature ne change pas —, sans toucher au reste de la saisie.
  // LA CAISSE (étape C9b) : les opérations du dossier, lues en entier, ou rien — le drapeau baissé, aucune. Une pièce qu'un
  // paiement non retiré cite reste d'achat ou de vente ; une pièce qu'un paiement cite, retiré ou non, ne se supprime plus.
  const etatDeLaCaisse = caisse === null ? null : etatDeLaCaisseDeLaFiche(caisse.lecture, dossierId)
  const operationsDeLaCaisse = etatDeLaCaisse?.etat === 'lue' ? etatDeLaCaisse.donnees.operations : null
  const refusDeLaNature = pieceMarquee !== null
    ? refusDuFormulaireDeLaPiece(pieceMarquee, typePiece, exemplaire?.factures?.lignes ?? null)
      ?? (operationsDeLaCaisse === null ? null : refusDuTypeDeLaPiece(pieceMarquee, typePiece, operationsDeLaCaisse))
    : null
  const retenueParLaCaisse = piece !== null && operationsDeLaCaisse !== null ? suppressionRetenueParLaCaisse(piece.id, operationsDeLaCaisse) : null

  // CE QUE LA PIÈCE EST (étape VF6c, lib/marquesDeLaPieceLecture.ts), lu par la fiche quand l'écran appelant lui a donné les
  // factures (`exemplaire`) et qu'il s'agit d'une vente — enregistrée, saisie, ou marquée. Une lecture plus lente écrit en
  // dernier : seule la DERNIÈRE demandée s'inscrit, et elle porte la pièce pour laquelle elle a été faite.
  const [lectureDesMarques, setLectureDesMarques] = useState<LectureDeCeQueLaPieceEst | null>(null)
  const lectureEnVigueur = lectureDesMarques !== null && lectureDesMarques.pour === pieceId ? lectureDesMarques : null
  const besoinDesMarques = exemplaire !== null && (typePiece === 'vente' || pieceMarquee?.type_piece === 'vente'
    || (pieceMarquee?.facture_id ?? null) !== null || pieceMarquee?.vente_hors_des_factures === true)
  // La pièce que la lecture regarde (son pont) : tenue à jour APRÈS le rendu, avant l'effet qui lit — une relecture n'a pas à
  // repartir chaque fois que l'écran appelant recopie la désignation dans un nouvel objet.
  const pieceALire = useRef(piece)
  useEffect(() => { pieceALire.current = piece }, [piece])
  const derniereLecture = useRef(0)
  const relireCeQuElleEst = useCallback(async () => {
    const numero = ++derniereLecture.current
    const lecture = await lireCeQueLaPieceEst(dossierId, pieceALire.current)
    if (numero === derniereLecture.current) setLectureDesMarques(lecture)
  }, [dossierId])
  useEffect(() => {
    if (besoinDesMarques) void relireCeQuElleEst()
  }, [besoinDesMarques, pieceId, relireCeQuElleEst])

  // Après un geste de la section : la marque de LA pièce, relue par la fiche ; sa ligne dans la liste de l'écran appelant ;
  // ce qu'elle est (le journal a une ligne de plus). Le motif d'un échec, que la section dit.
  async function apresUnGeste(): Promise<string | null> {
    if (piece === null || exemplaire === null) return null
    const relue = await relireLesMarquesDeLaPiece(dossierId, piece.id)
    if ('marques' in relue) setMarquesRelues(relue.marques)
    const motifDeLaListe = await exemplaire.relirePiece(piece.id)
    await relireCeQuElleEst()
    return 'motif' in relue ? relue.motif : motifDeLaListe
  }

  // G3 (étape VF6b) : dans un dossier dont les factures sont la source de leurs ventes, une pièce de vente qui DEVIENT
  // validée est désignée exemplaire de la facture que le pont prouve, ou déclarée vente hors des factures — et ne naît jamais
  // validée. « Valider » le dit avant le clic, sous les mots de la base ; tant que la fiche ne sait pas si le dossier a
  // basculé, la validation d'une vente attend (« Enregistrer brouillon » reste offert : G3 ne juge pas une pièce à valider).
  // Sans `exemplaire`, la fiche ne lit rien, et la base juge seule.
  const pieceValidee: PieceMarquable = {
    id: pieceMarquee?.id ?? '', dossier_id: dossierId, type_piece: typePiece, statut: 'validee',
    nom_fichier: file?.name ?? pieceMarquee?.nom_fichier ?? '',
    facture_id: pieceMarquee?.facture_id ?? null, vente_hors_des_factures: pieceMarquee?.vente_hors_des_factures ?? false,
  }
  const contexteLu = lectureEnVigueur?.contexte.etat === 'lu' ? lectureEnVigueur.contexte.contexte : null
  const facturesLues = exemplaire?.factures?.complete ? exemplaire.factures.lignes : null
  const g3Juge = exemplaire !== null && !fige && passageJugeParG3(pieceMarquee, pieceValidee)
  const attenteDeLaValidation: string | null = !g3Juge ? null
    : lectureEnVigueur === null
      ? 'La validation d’une pièce de vente attend de savoir si les factures de ce dossier sont la source de leurs ventes : lecture en cours…'
      : lectureEnVigueur.contexte.etat === 'incomplet'
        ? `La validation d’une pièce de vente attend : ce que la base dit de ce dossier n’a pas pu être lu en entier (${lectureEnVigueur.contexte.motif}). La pièce s’enregistre à valider.`
        // Le refus de G3 nomme la facture que le pont prouve : elle se lit d'abord, pour ne jamais en taire le numéro.
        : contexteLu !== null && contexteLu.dossierBascule && contexteLu.pont.genre === 'une' && facturesLues === null
          ? 'La validation d’une pièce de vente attend les factures émises du dossier, lues en entier.'
          : null
  const refusDeLaValidation = !g3Juge || contexteLu === null || attenteDeLaValidation !== null ? null
    : refusDeLaValidationDUneVente(pieceMarquee, pieceValidee, {
      factures: facturesLues ?? [], basculeDuDossier: contexteLu.dossierBascule, pont: contexteLu.pont,
    })?.message ?? null
  // La section « Ce que cette pièce est » dit elle-même une lecture incomplète et offre de la refaire ; ailleurs (une pièce
  // en création, ou qui devient une vente), la fiche l'offre ici.
  const sectionMontree = pieceMarquee !== null && exemplaire !== null && (pieceMarquee.type_piece === 'vente'
    || pieceMarquee.facture_id !== null || pieceMarquee.vente_hors_des_factures)

  // La note de CETTE pièce, lue à l'ouverture. Une réponse qui arrive pour une pièce déjà quittée est sans effet : le
  // drapeau d'annulation l'écarte, et ni la lecture ni le texte du champ ne passent à la pièce suivante.
  const [lecturesDeLaNote, setLecturesDeLaNote] = useState(0)
  useEffect(() => {
    if (!pieceId) return
    let annule = false
    lireNoteInterne({ type: 'piece', id: pieceId }).then((lecture) => {
      if (annule) return
      setNoteLue({ pour: pieceId, lecture })
      if (lecture.etat === 'lue') setNotes(lecture.texte)
    })
    return () => { annule = true }
  }, [pieceId, lecturesDeLaNote])
  function relireLaNote() {
    setNoteLue(null)
    setLecturesDeLaNote((n) => n + 1)
  }

  // Écrit la note si elle a changé — et seulement si elle a été LUE : elle part avant la pièce, de sorte qu'un refus
  // n'a rien écrit d'autre, et que la pièce enregistrée ensuite ne la réécrit pas.
  async function enregistrerLaNote() {
    if (!piece || !noteModifiee(lectureNote, notes)) return
    await enregistrerNoteInterne(dossierId, { type: 'piece', id: piece.id }, notes)
    setNoteLue({ pour: piece.id, lecture: { etat: 'lue', texte: notes } })
  }

  // Aperçu : le fichier fraîchement choisi se prévisualise localement (pas besoin de l'uploader
  // d'abord) ; le fichier déjà en storage passe par une URL signée temporaire, le bucket n'étant pas
  // public. On révoque l'URL locale à chaque changement pour ne pas fuiter de mémoire.
  //
  // Une facture reçue de la plateforme du client en XML se MONTRE par sa version lisible (voir lib/fichiersPiece.ts) :
  // un XML ne se lit pas, et c'est le PDF qu'on regarde avant de valider. L'original reste à portée d'un lien.
  const fichierMontre = piece ? fichierAMontrer(piece) : null
  const cheminApercu = fichierMontre?.chemin ?? null
  useEffect(() => {
    if (file) {
      const url = URL.createObjectURL(file)
      setPreviewUrl(url)
      setPreviewError(null)
      return () => URL.revokeObjectURL(url)
    }
    if (cheminApercu) {
      let annule = false
      supabase.storage.from('pieces').createSignedUrl(cheminApercu, 300).then(({ data, error }) => {
        if (annule) return
        if (error || !data) {
          setPreviewError("Aperçu indisponible.")
          setPreviewUrl(null)
        } else {
          setPreviewUrl(data.signedUrl)
          setPreviewError(null)
        }
      })
      return () => { annule = true }
    }
    setPreviewUrl(null)
  }, [file, cheminApercu])

  // Si ce tiers a déjà été catégorisé sur une pièce précédente — de ce dossier en priorité, sinon
  // partagée entre tous les dossiers (voir lib/tiersCategories.ts) — on reprend la même catégorie
  // automatiquement, sans écraser un choix déjà fait manuellement.
  function suggestCategorieFromTiers(value: string) {
    if (categorieId || !value.trim()) return
    const suggestion = suggererCategorie(value, tiersCategories, tiersCategoriesCabinet)
    if (suggestion) setCategorieId(suggestion)
  }

  // « Proposer une catégorie » — le contrat vit dans lib/categorisationIa.ts : une liste fermée, un
  // extrait retrouvé dans le document, et RIEN d'écrit. La proposition remplit au plus le champ, sur
  // un second clic ; l'enregistrement reste celui de la fiche.
  //
  // Verrou en `useRef`, posé avant le `try` et relâché dans le `finally` (CLAUDE.md) : chaque clic
  // est un appel au modèle FACTURÉ, et deux clics du même rendu passeraient un état React.
  const propositionEnCours = useRef(false)
  async function proposer() {
    if (!piece || propositionEnCours.current) return
    propositionEnCours.current = true
    const pourType = typePiece
    setProposant(true)
    setErreurProposition(null)
    setProposition(null)
    try {
      const resultat = await proposerCategorie(piece.id, pourType)
      setProposition({ pourType, resultat })
    } catch (err) {
      setErreurProposition(messageErreur(err, 'La proposition n’a pas pu être obtenue.'))
    } finally {
      propositionEnCours.current = false
      setProposant(false)
    }
  }

  function recalcFromHtTva(ht: string, tva: string) {
    const htN = parseFloat(ht)
    const tvaN = parseFloat(tva)
    if (!Number.isNaN(htN) && !Number.isNaN(tvaN)) {
      setMontantTtc((htN + tvaN).toFixed(2))
    }
  }

  async function handleExtract() {
    // Posé avant le `try` : dedans, le `return` du deuxième clic sortirait par le `finally` et relâcherait le verrou du
    // premier, encore en cours.
    if (extractionEnCours.current) return
    extractionEnCours.current = true
    setExtracting(true)
    setExtractionError(null)
    setConfiance(null)
    setLignesBrutes(undefined)
    setSuggestionAutre(null)
    try {
      // Fichier fraîchement choisi, ou téléchargement du fichier déjà attaché en édition.
      let source: Blob
      let name: string
      if (file) {
        source = file
        name = file.name
      } else if (piece?.storage_path) {
        const { data, error } = await supabase.storage.from('pieces').download(piece.storage_path)
        if (error || !data) throw new Error("Impossible de récupérer le fichier existant.")
        source = data
        name = piece.nom_fichier
      } else {
        throw new Error('Dépose un fichier avant de lancer l\'extraction.')
      }

      const result = await extractPiece(source, name)

      if (result.date_piece) setDatePiece(result.date_piece)
      if (result.tiers) {
        setTiers(result.tiers)
        suggestCategorieFromTiers(result.tiers)
      }
      // La devise se pose AVANT les montants, et les montants lus sont convertis s'il le faut : ils
      // sortent de l'extraction dans la devise du document, alors que les champs de ce formulaire —
      // comme les colonnes en base — sont en euros. Les recopier tels quels ferait entrer des dollars
      // dans la comptabilité, à un montant parfaitement plausible.
      const lue = (deviseDuTexte(result.texte_ocr) ?? DEVISE_PIVOT).toUpperCase()
      const enDevise = { montant_ht: result.montant_ht, montant_tva: result.montant_tva, montant_ttc: result.montant_ttc }
      const trouve = lue === DEVISE_PIVOT ? null : await tauxBce(lue, result.date_piece ?? datePiece)
      const montants = trouve ? convertirMontants(enDevise, trouve.taux) : enDevise

      setDevise(lue)
      setMontantDevise(lue === DEVISE_PIVOT ? null : result.montant_ttc ?? null)
      setTauxChange(trouve?.taux ?? null)
      setDateTaux(trouve?.date ?? null)
      setConversionSource(trouve ? 'bce' : null)
      if (lue !== DEVISE_PIVOT && !trouve) {
        setConversionErreur(`Document en ${lue}, mais aucun taux BCE n'a pu être obtenu — les montants restent à convertir.`)
      }

      if (montants.montant_ht != null) setMontantHt(montants.montant_ht.toString())
      if (montants.montant_tva != null) setMontantTva(montants.montant_tva.toString())
      if (montants.montant_ttc != null) setMontantTtc(montants.montant_ttc.toString())
      setConfiance(result.confiance)
      if (result._lignes_brutes) setLignesBrutes(result._lignes_brutes)
      // Un bordereau de télétransmission est une pièce, mais dans l'autre sens : ce que le praticien a
      // facturé. Le sens connu est APPLIQUÉ plutôt que suggéré (voir CLAUDE.md, « une valeur par
      // défaut connue s'applique ») — laissé sur « Achat », le montant part en charge et la recette
      // qu'il justifie n'est comptée nulle part. L'utilisateur garde le sélecteur pour corriger.
      const classification = result.classification
      if (classification === 'facture_vente') {
        setTypePiece('vente')
        setSuggestionAutre("Ce document est un bordereau de télétransmission : un justificatif de RECETTE, pas une dépense. Le type est passé à « Vente » — la date à retenir reste celle de l'encaissement si elle diffère.")
      } else if (classification !== 'facture') {
        const labels: Record<Exclude<typeof classification, 'facture' | 'facture_vente'>, string> = {
          releve_bancaire: 'un relevé bancaire',
          cotisation: 'un appel de cotisation',
          attestation: 'une attestation/certificat',
          // Relevé d'activité de l'Assurance Maladie, relevé de situation d'un contrat d'épargne :
          // des états, jamais une dépense. Le montant qu'on y lit est un capital ou un chiffre
          // d'activité, et le porter en charge fausse la déclaration de son montant entier.
          autre: "un relevé d'activité ou de situation (ni une facture, ni une dépense)",
        }
        setSuggestionAutre(`Ce document ressemble plutôt à ${labels[classification]} qu'à une facture — l'onglet Documents serait peut-être plus adapté.`)
      }
    } catch (err) {
      setExtractionError(messageErreur(err, "L'extraction automatique a échoué — remplis le formulaire à la main."))
    } finally {
      extractionEnCours.current = false
      setExtracting(false)
    }
  }

  // Le fichier est retenu tout de suite, comme avant ; s'il dépasse les bornes, il est retiré dès la réponse et le refus
  // se dit sous le champ. Une lecture ratée ici se journalise : l'enregistrement le rejuge et dit son erreur.
  async function choisirFichier(champ: HTMLInputElement) {
    const choisi = champ.files?.[0] ?? null
    choixDuFichier.current = choisi
    setFile(choisi)
    setConfiance(null)
    setExtractionError(null)
    setRefusFichier(null)
    if (!choisi) return
    let refus
    try {
      refus = await refusDUnePiece(choisi)
    } catch (e) {
      console.warn('[FichePiece] le fichier choisi n’a pas pu être lu ; l’enregistrement le rejugera :', messageErreur(e, 'illisible'))
      return
    }
    if (!refus || choixDuFichier.current !== choisi) return
    choixDuFichier.current = null
    setFile(null)
    champ.value = ''
    setRefusFichier(`Ce fichier n’est pas pris : ${refus.message}.`)
  }

  // Rejugé ici, avant l'envoi : un enregistrement parti avant la réponse du choix ne dépose pas un fichier que le seau
  // refuserait — et c'est d'ici que part le corps RÉÉTIQUETÉ du type qu'il admet (lib/bornesStockage.ts).
  async function uploadFile(): Promise<string | null> {
    if (!file) return piece?.storage_path ?? null
    const pret = await preparerPiece(file)
    if ('refus' in pret) throw new Error(`Ce fichier n’est pas pris : ${pret.refus.message}.`)
    const path = `${dossierId}/${Date.now()}-${slugify(file.name)}`
    const { error } = await supabase.storage.from('pieces').upload(path, pret.corps)
    if (error) throw error
    return path
  }

  // Refait la conversion au taux BCE de la date actuellement saisie. Le seul geste offert sur le
  // change : le taux n'est pas modifiable à la main, parce qu'un taux inventé ne se justifie pas, et
  // la devise non plus — elle est lue sur le document.
  async function reconvertir() {
    if (devise === DEVISE_PIVOT || montantDevise == null) return
    if (!datePiece) {
      setConversionErreur('Renseigne la date de la pièce : le taux dépend du jour.')
      return
    }
    setConversionEnCours(true)
    setConversionErreur(null)
    try {
      const trouve = await tauxBce(devise, datePiece)
      if (!trouve) {
        setConversionErreur(`Aucun taux BCE trouvé pour ${devise} au ${datePiece}.`)
        return
      }
      // Le TTC d'origine est la seule valeur sûre quand la pièce a déjà été convertie une fois :
      // reconvertir les montants EN EUROS déjà stockés les ferait passer deux fois par le change.
      const base = {
        montant_ht: montantHt ? Number.parseFloat(montantHt) * trouve.taux : null,
        montant_tva: montantTva ? Number.parseFloat(montantTva) * trouve.taux : null,
        montant_ttc: montantDevise,
      }
      const converti = convertirMontants(base, trouve.taux)
      setMontantHt(converti.montant_ht?.toFixed(2) ?? '')
      setMontantTva(converti.montant_tva?.toFixed(2) ?? '')
      setMontantTtc(converti.montant_ttc?.toFixed(2) ?? '')
      setTauxChange(trouve.taux)
      setDateTaux(trouve.date)
      // Reconvertir à la BCE reprend une valeur provisoire, même si la pièce avait déjà été réglée
      // sur la banque : c'est bien un retour en arrière, et le dire est le minimum.
      setConversionSource('bce')
    } finally {
      setConversionEnCours(false)
    }
  }

  // Le contrôle partagé appliqué aux valeurs EN COURS DE SAISIE, sans passer par la base : la règle
  // n'existe qu'à un seul endroit (lib/controles.ts) et cet écran ne fait que la consulter. Un champ
  // vide vaut « non renseigné » — le contrôle ne se prononce que sur ce qui est là.
  const nombreOuNull = (v: string) => (v.trim() === '' ? null : Number.parseFloat(v))
  const motifTvaSaisie = piecesTvaImpossible([{
    ...(piece ?? ({} as Piece)),
    montant_ht: nombreOuNull(montantHt),
    montant_tva: nombreOuNull(montantTva),
    montant_ttc: nombreOuNull(montantTtc),
  } as Piece])[0]?.motif ?? null

  // Verrou en `useRef`, POSÉ AVANT LE `try`. Deux raisons, et la seconde est celle qu'on oublie :
  // `saving` est un état React, donc `disabled={saving}` ne ferme rien contre deux clics dans le
  // même rendu ; et placé DANS le `try`, le `return` du deuxième clic sortirait par le `finally`,
  // qui relâcherait le verrou du PREMIER, encore en cours — il faut trois clics pour le voir
  // (CLAUDE.md).
  //
  // Le doublon crée une PIÈCE de plus sur le même justificatif, et une pièce en double est une
  // charge comptée deux fois — en 2035 comme en balance. Même famille que l'import en masse qui
  // écrivait 141 lignes pour 78 fichiers, sur le chemin à l'unité cette fois.
  const enregistrementEnCours = useRef(false)

  async function save(statut: 'a_valider' | 'validee') {
    if (enregistrementEnCours.current) return
    // Une pièce désignée exemplaire d'une facture, ou déclarée vente hors des factures, reste une pièce de vente : le refus de
    // la garde est dit sous le champ, et rien ne part qu'elle refuserait. Ni une validation que G3 refuserait, ou qui attend
    // de savoir si elle la refuserait.
    if (refusDeLaNature !== null) return
    if (statut === 'validee' && (refusDeLaValidation !== null || attenteDeLaValidation !== null)) return
    enregistrementEnCours.current = true
    setSaving(true)
    setError(null)
    try {
      if (statut === 'validee' && !montantTtc) {
        throw new Error('Le montant TTC est obligatoire pour valider une pièce.')
      }
      if (!piece && !file) {
        throw new Error('Merci de déposer un fichier.')
      }
      await enregistrerLaNote()
      // Uniquement quand un nouveau fichier est choisi (pas en simple modification d'une pièce
      // existante sans redéposer) — même détection que l'import en masse et les autres dépôts à
      // l'unité (Documents, Cotisations).
      const hash = file ? await hashFichier(file) : null
      if (hash && (await fichierDejaPresent(dossierId, hash))) {
        throw new Error('Ce fichier est déjà présent dans ce dossier (Pièces ou Documents).')
      }
      const storagePath = await uploadFile()
      const { data: userData } = await supabase.auth.getUser()

      const payload = {
        dossier_id: dossierId,
        storage_path: storagePath,
        ...(hash ? { storage_hash: hash } : {}),
        nom_fichier: file?.name ?? piece?.nom_fichier,
        date_piece: datePiece || null,
        tiers: tiers || null,
        type_piece: typePiece,
        categorie_id: categorieId || null,
        sous_dossier_id: sousDossierId || null,
        montant_ht: montantHt ? parseFloat(montantHt) : null,
        montant_tva: montantTva ? parseFloat(montantTva) : null,
        montant_ttc: montantTtc ? parseFloat(montantTtc) : null,
        // Les trois montants ci-dessus sont en euros, toujours. Ces trois-ci disent dans quelle
        // devise le document est écrit et comment on est passé de l'un à l'autre (voir
        // lib/devises.ts) — une contrainte en base impose qu'ils soient nuls pour une pièce en euros.
        devise,
        montant_devise: devise === DEVISE_PIVOT ? null : montantDevise,
        taux_change: devise === DEVISE_PIVOT ? null : tauxChange,
        conversion_source: devise === DEVISE_PIVOT || tauxChange == null ? null : conversionSource ?? 'bce',
        statut,
        confiance,
      }

      if (piece) {
        const { error } = await supabase.from('pieces').update(payload).eq('id', piece.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('pieces').insert({ ...payload, uploaded_by: userData.user!.id })
        if (error) throw error
      }

      // Mémorise la correspondance tiers → catégorie pour la reproposer automatiquement la prochaine
      // fois, sur ce dossier. Best-effort : un échec ici ne doit pas remettre en cause la sauvegarde
      // de la pièce — mais il est journalisé, jamais avalé en silence (voir `memoriser`).
      if (tiers.trim() && categorieId) {
        // La règle est apprise sous l'identité du fournisseur, pas sous la graphie exacte lue par
        // l'OCR : sinon un arbitrage fait sur « Transmedical et soigner redevient » ne servirait à
        // aucune des seize autres pièces du même fournisseur. Même clé que l'écran de
        // catégorisation en masse, pour que les deux chemins alimentent le même apprentissage.
        const cleRegle = cleFournisseur(tiers) ?? normalizeTiers(tiers)
        await memoriser(
          'la règle de ce dossier',
          supabase.from('tiers_categories').upsert(
            { dossier_id: dossierId, tiers_normalise: cleRegle, categorie_id: categorieId },
            { onConflict: 'dossier_id,tiers_normalise' },
          ),
        )
        // Catégorie choisie parmi les catégories globales (dossier_id null) : la correspondance a du
        // sens au-delà de ce seul dossier (une mutuelle, une banque... reviennent souvent d'un client
        // à l'autre), donc on la mémorise aussi au niveau cabinet — voir lib/tiersCategories.ts. Une
        // catégorie propre à ce dossier reste, elle, sans équivalent chez un autre client.
        const categorieChoisie = categories.find((c) => c.id === categorieId)
        if (categorieChoisie && categorieChoisie.dossier_id === null && monCabinetId) {
          await memoriser(
            'la règle du cabinet',
            supabase.from('tiers_categories_cabinet').upsert(
              { cabinet_id: monCabinetId, tiers_normalise: cleRegle, categorie_id: categorieId },
              { onConflict: 'cabinet_id,tiers_normalise' },
            ),
          )
        }
      }

      // Enregistrée : plus rien à protéger — dit AVANT de chaîner, sinon la garde demanderait
      // d'abandonner une saisie qui vient justement d'être enregistrée.
      onModifiee?.(false)
      onSaved()
      if (statut === 'validee' && piece && onValidee) onValidee(piece.id)
      else onClose()
    } catch (err) {
      setError(messageErreur(err))
    } finally {
      enregistrementEnCours.current = false
      setSaving(false)
    }
  }

  // Une pièce FIGÉE n'enregistre que ce qui reste libre — sa note interne (une autre table, que la validation ne fige
  // pas) et son sous-dossier —, rien d'autre : la base refuserait le reste (`garder_piece_validee`), et renvoyer tous
  // les champs tels quels ne ferait que prendre ce risque pour rien. Même verrou que l'enregistrement ordinaire, posé
  // avant le `try` pour la même raison.
  async function enregistrerCeQuiResteLibre() {
    if (!piece || enregistrementEnCours.current) return
    enregistrementEnCours.current = true
    setSaving(true)
    setError(null)
    try {
      await enregistrerLaNote()
      const { error } = await supabase.from('pieces')
        .update({ sous_dossier_id: sousDossierId || null })
        .eq('id', piece.id)
      if (error) throw error
      onModifiee?.(false)
      onSaved()
      onClose()
    } catch (err) {
      setError(messageErreur(err))
    } finally {
      enregistrementEnCours.current = false
      setSaving(false)
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (fige) enregistrerCeQuiResteLibre()
    else save('validee')
  }

  async function handleDelete() {
    if (!piece) return
    // Le bouton n'est pas offert sur une pièce citée ; si la lecture des citations change pendant que la fiche est
    // ouverte, la phrase de la base se dit ici plutôt qu'une confirmation qui mènerait à son refus.
    if (citeePar) {
      setError(citeePar)
      return
    }
    if (declareePar) {
      setError(declareePar)
      return
    }
    if (retenueParLaCaisse) {
      setError(retenueParLaCaisse)
      return
    }
    // La fiche « hors de France » part avec la pièce (clé en cascade), toutes versions comprises : la confirmation la nomme.
    const ficheEmportee = ficheEmporteeParLaSuppression(piece.id, horsDeFrance.lecture)
    if (!window.confirm(
      `Supprimer définitivement la pièce "${piece.nom_fichier}" ? Cette action est irréversible.\n\n${AVERTISSEMENT_PAIEMENT_DEFAIT}`
      + (ficheEmportee ? `\n\n${ficheEmportee}` : '')
      + (declaree && !declaree.sait ? `\n\n${declaree.message}` : ''),
    )) return
    setDeleting(true)
    setError(null)
    try {
      // La ligne supprimée se LIT (`.select('id')`) : PostgREST rend une suppression qui ne touche aucune ligne comme un
      // succès, et retirer les fichiers sur la seule absence d'erreur laisserait une pièce visible sans son fichier.
      const { data: supprimee, error: deleteError } = await supabase.from('pieces').delete().eq('id', piece.id).select('id').maybeSingle()
      if (!deleteError && !supprimee) {
        throw new Error(messageBilanSuppressionPieces({ demandes: 1, supprimes: 0, motifs: [AUCUNE_PIECE_SUPPRIMEE] }) ?? AUCUNE_PIECE_SUPPRIMEE)
      }
      if (deleteError) {
        // Contrainte de clé étrangère (23503) : la pièce est encore référencée par une table qui
        // REFUSE la suppression. Gardé comme garde-fou, mais ce chemin ne peut pas se lever
        // aujourd'hui — mesuré le 23/09/2026, les cinq clés entrantes de `pieces` sont en SET NULL
        // ou CASCADE, et `packs` n'a aucune clé entrante (`pack_pieces` a été supprimée). Le message
        // d'avant nommait justement ces deux liens-là et envoyait « retirer » ce qui ne bloque rien ;
        // il ne devine donc plus la cause, il dit ce qu'on sait et rend la raison de Postgres.
        if (deleteError.code === '23503') {
          throw new Error(
            'Impossible de supprimer : cette pièce est encore référencée ailleurs dans la base. '
            + `Raison rendue par la base : ${messageErreur(deleteError, 'aucune')}`,
          )
        }
        throw deleteError
      }

      // Best-effort : le fichier au storage n'a pas besoin de bloquer la suppression de la pièce s'il
      // a déjà disparu ou si la suppression échoue pour une autre raison. Ses DEUX fichiers quand elle en a
      // deux : la version lisible laissée seule ne serait plus désignée par rien.
      const fichiers = fichiersDeLaPiece(piece)
      if (fichiers.length > 0) {
        await retirerFichiers('pieces', fichiers, 'FichePiece')
      }

      onModifiee?.(false)
      onSaved()
      onClose()
    } catch (err) {
      setError(messageErreur(err))
    } finally {
      setDeleting(false)
    }
  }

  const genreApercu = file ? typeApercu(file.name) : fichierMontre?.lisible ? 'pdf' : typeApercu(piece?.nom_fichier ?? '')
  // Une facture reçue de la plateforme du client : son fichier est l'original transmis — le remplacer romprait le lien
  // entre la pièce et ce que la plateforme a remis —, et ses champs viennent de la facture électronique elle-même, qu'une
  // lecture du document ne ferait que deviner moins bien, et payer.
  const recuePlateforme = piece?.source === 'plateforme'
  const occupee = saving || deleting

  // Une pièce sans catégorie : d'abord ce que les règles apprises savent de son fournisseur, et le
  // modèle SEULEMENT pour ce qu'elles ne savent pas (CLAUDE.md, « les règles d'abord »). Une règle
  // connue ne coûte rien ; le modèle, un appel facturé.
  const regle = suggererCategorie(tiers, tiersCategories, tiersCategoriesCabinet)
  const categorieRegle = regle ? categories.find((c) => c.id === regle) ?? null : null
  const propositionAffichee = proposition && proposition.pourType === typePiece ? proposition.resultat : null
  const categorieProposee = propositionAffichee?.categorieId
    ? categories.find((c) => c.id === propositionAffichee.categorieId) ?? null
    : null
  const messageProposition = !propositionAffichee || categorieProposee
    ? null
    : propositionAffichee.issue === 'retenue'
      // L'identifiant rendu n'est pas dans la liste de la fiche : une catégorie créée ou retirée depuis
      // l'ouverture de l'écran. La poser dans le champ enregistrerait une valeur que le champ n'affiche pas.
      ? 'La catégorie proposée n’est pas dans la liste de ce dossier : rechargez la page, puis réessayez.'
      : libelleIssue(propositionAffichee.issue)

  return (
    <div className="fiche-piece">
      <EntetePanneau
        titre={navigation?.position ?? (piece ? 'Justificatif' : 'Ajouter une pièce')}
        sousTitre={piece ? (tiers.trim() || piece.nom_fichier) : null}
        actions={navigation && (
          <>
            {/* Grisés pendant un enregistrement : la fiche changerait de pièce sous une réponse
                encore attendue, et l'enchaînement qui suit une validation partirait de la mauvaise. */}
            <button
              type="button"
              className="panneau-bouton-icone"
              onClick={navigation.precedente ?? undefined}
              disabled={!navigation.precedente || occupee}
              aria-label="Justificatif précédent"
              title="Justificatif précédent"
            >
              <IconPrecedent width={18} height={18} />
            </button>
            <button
              type="button"
              className="panneau-bouton-icone"
              onClick={navigation.suivante ?? undefined}
              disabled={!navigation.suivante || occupee}
              aria-label="Justificatif suivant"
              title="Justificatif suivant"
            >
              <IconChevron width={18} height={18} />
            </button>
          </>
        )}
        onFermer={onClose}
      />
      {/* Corps qui défile, pied fixe : sur un justificatif long (PDF), les boutons d'action
          restaient sinon hors champ tant qu'on n'avait pas fait défiler tout le formulaire. */}
      <form onSubmit={handleSubmit} className="fiche-piece-formulaire">
        <div className="fiche-piece-corps">
          {fige && (
            <p className="fiche-piece-figee">
              {figeePar} : cette pièce justifie une écriture validée. Sa date, son tiers, son type, sa catégorie, ses
              montants et son fichier ne changent plus, et elle ne se supprime plus ; ses notes internes et son
              sous-dossier restent modifiables, et une précision du client s’ajoute toujours. Une erreur trouvée après la
              validation se corrige sur l’exercice suivant.
            </p>
          )}
          {citeePar && <p className="fiche-piece-figee">{citeePar}</p>}
          {declareePar && <p className="fiche-piece-figee">{declareePar}</p>}
          {retenueParLaCaisse && <p className="fiche-piece-figee">{retenueParLaCaisse}</p>}
          {venteEmise && (
            <div className="fiche-piece-vente">
              <span className={`badge ${PASTILLE_DE_LA_MARQUE[venteEmise.genre]}`}>{venteEmise.libelle}</span>
              <p>{venteEmise.explication}</p>
              {venteEmise.autres.length > 0 && (
                <p>
                  {venteEmise.autres.length === 1 ? 'L’autre pièce qui la porte : ' : 'Les autres pièces qui la portent : '}
                  {venteEmise.autres.map((nom, i) => (
                    <span key={`${i}-${nom}`}>{i > 0 && ', '}<span className="nom-fichier">« {nom} »</span></span>
                  ))}
                  .
                </p>
              )}
            </div>
          )}
          {pieceMarquee && exemplaire && (
            <ExemplaireDeLaFacture
              dossierId={dossierId}
              piece={pieceMarquee}
              donnees={exemplaire}
              ceQuElleEst={{ lecture: lectureEnVigueur, relire: relireCeQuElleEst, apresUnGeste, moi }}
              autresPieces={venteEmise?.genre === 'double' ? venteEmise.autres : null}
              refusParLaCaisse={operationsDeLaCaisse === null ? null : (factureId) => refusDeLaDesignationParLaCaisse(
                pieceMarquee, exemplaire.factures?.lignes.find((f) => f.id === factureId) ?? null, operationsDeLaCaisse)}
            />
          )}
          {(previewUrl || previewError) && (
            <div className="field fiche-piece-apercu">
              {previewError ? (
                <p className="muted" style={{ margin: 0 }}>{previewError}</p>
              ) : (
                <>
                  {genreApercu === 'image' && <img src={previewUrl!} alt="Aperçu de la pièce" />}
                  {genreApercu === 'pdf' && <iframe src={previewUrl!} title="Aperçu de la pièce" />}
                  <a href={previewUrl!} target="_blank" rel="noreferrer" className="muted">
                    Ouvrir dans un nouvel onglet ↗
                  </a>
                </>
              )}
              {!file && fichierMontre?.lisible && piece && (
                <p className="muted" style={{ margin: 0 }}>
                  Version lisible rendue par la plateforme.{' '}
                  <button type="button" className="lien-texte-lu" onClick={() => ouvrirJustificatif(piece.storage_path)}>
                    Voir l’original transmis (XML) ↗
                  </button>
                </p>
              )}
            </div>
          )}

          {recuePlateforme ? (
            <p className="muted fiche-piece-plateforme">
              Facture reçue de la plateforme du client{piece?.flux_hote ? ` (${piece.flux_hote})` : ''} : {piece?.nom_fichier}.
              Son fichier est l’original transmis, il ne se remplace pas ; et ses champs viennent de la facture
              électronique elle-même : rien n’est à extraire.
            </p>
          ) : (
            <>
              <div className="field">
                <label htmlFor="file">{piece ? 'Remplacer le fichier' : 'Fichier'}</label>
                <input id="file" type="file" accept=".pdf,.jpg,.jpeg,.png" disabled={fige} onChange={(e) => { void choisirFichier(e.target) }} />
                {piece && !file && <span className="muted">Actuel : {piece.nom_fichier}</span>}
                {refusFichier && <span className="error-text">{refusFichier}</span>}
              </div>

              <div className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  disabled={fige || extracting || (!file && !piece?.storage_path)}
                  onClick={handleExtract}
                >
                  {extracting ? 'Extraction…' : '✨ Extraire automatiquement'}
                </button>
                {confiance && (
                  <span className={`badge ${confiance === 'haute' ? 'badge-ok' : confiance === 'moyenne' ? 'badge-warning' : 'badge-neutral'}`}>
                    Confiance {confiance} — vérifie les champs
                  </span>
                )}
              </div>
            </>
          )}
          {extractionError && <p className="error-text" style={{ marginTop: -8 }}>{extractionError}</p>}
          {suggestionAutre && <p className="muted" style={{ marginTop: -8 }}>💡 {suggestionAutre}</p>}

          {lignesBrutes && (
            <details className="field" style={{ marginTop: -8 }}>
              <summary className="muted" style={{ cursor: 'pointer' }}>TVA introuvable — diagnostic (temporaire), clique pour copier</summary>
              <pre style={{ fontSize: '0.75rem', background: 'var(--color-bg)', padding: 8, borderRadius: 8, overflowX: 'auto', userSelect: 'all' }}>
                {lignesBrutes.join('\n')}
              </pre>
            </details>
          )}

          <div className="field-row">
            <div className="field">
              <label htmlFor="date">Date de la pièce</label>
              <input id="date" type="date" value={datePiece} disabled={fige} onChange={(e) => setDatePiece(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="type">Type</label>
              <select id="type" value={typePiece} disabled={fige} onChange={(e) => setTypePiece(e.target.value as TypePiece)}>
                <option value="achat">Achat</option>
                <option value="vente">Vente</option>
                <option value="note_frais">Note de frais</option>
                <option value="autre">Autre</option>
              </select>
            </div>
          </div>

          {refusDeLaNature !== null && <p className="error-text" style={{ marginTop: -8 }}>{refusDeLaNature}</p>}

          <div className="field">
            <label htmlFor="tiers">Tiers (fournisseur / client)</label>
            <input
              id="tiers"
              list="tiers-connus"
              value={tiers}
              disabled={fige}
              onChange={(e) => setTiers(e.target.value)}
              onBlur={(e) => suggestCategorieFromTiers(e.target.value)}
            />
            <datalist id="tiers-connus">
              {tiersConnus.map((t) => <option key={t} value={t} />)}
            </datalist>
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="categorie">Catégorie</label>
              <select id="categorie" value={categorieId} disabled={fige} onChange={(e) => setCategorieId(e.target.value)}>
                <option value="">— Choisir —</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.libelle}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="sousDossier">Sous-dossier</label>
              <select id="sousDossier" value={sousDossierId} onChange={(e) => setSousDossierId(e.target.value)}>
                <option value="">— Aucun —</option>
                {sousDossiers.map((s) => <option key={s.id} value={s.id}>{s.nom}</option>)}
              </select>
            </div>
          </div>

          {piece && !fige && !categorieId && (categorieRegle ? (
            <div className="proposition-categorie">
              <p>Une règle apprise range ce fournisseur en <strong>{categorieRegle.libelle}</strong>.</p>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => setCategorieId(categorieRegle.id)}>
                Appliquer
              </button>
            </div>
          ) : !regle && !sansTexteLu && (
            <div className="proposition-categorie">
              {categorieProposee && propositionAffichee ? (
                <>
                  <p>
                    Proposée : <strong>{categorieProposee.libelle}</strong>, parce que le document porte
                    {' '}« {propositionAffichee.indice} ».
                    <span className="muted"> L’extrait figure bien sur le document ; c’est à vous de juger s’il justifie la catégorie.</span>
                  </p>
                  <div className="proposition-categorie-actions">
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => setCategorieId(categorieProposee.id)}>
                      Appliquer
                    </button>
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => setProposition(null)}>
                      Écarter
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <button type="button" className="btn btn-outline btn-sm" disabled={proposant} onClick={proposer}>
                    {proposant ? 'Proposition…' : '✨ Proposer une catégorie'}
                  </button>
                  {messageProposition && <p className="muted">{messageProposition}</p>}
                  {erreurProposition && <p className="error-text">{erreurProposition}</p>}
                </>
              )}
            </div>
          ))}

          <div className="field-row fiche-piece-montants">
            <div className="field">
              <label htmlFor="ht">Montant HT</label>
              <input id="ht" type="number" step="0.01" value={montantHt} disabled={fige} onChange={(e) => { setMontantHt(e.target.value); recalcFromHtTva(e.target.value, montantTva) }} />
            </div>
            <div className="field">
              <label htmlFor="tva">TVA</label>
              <input id="tva" type="number" step="0.01" value={montantTva} disabled={fige} onChange={(e) => { setMontantTva(e.target.value); recalcFromHtTva(montantHt, e.target.value) }} />
            </div>
            <div className="field">
              <label htmlFor="ttc">Montant TTC</label>
              <input id="ttc" type="number" step="0.01" value={montantTtc} disabled={fige} onChange={(e) => setMontantTtc(e.target.value)} />
            </div>
          </div>

          {/* Au-dessus des trois montants : ils sont en EUROS, et le document dit autre chose.
              Sans cette ligne, on croit relire la facture alors qu'on lit sa conversion. */}
          {devise !== DEVISE_PIVOT && (
            <div className="bloc-devise">
              <div>
                <strong>Document en {devise}</strong>
                {tauxChange != null && montantDevise != null ? (
                  <span className="muted">
                    {' — '}{libelleConversion(montantDevise, devise, tauxChange, dateTaux ?? datePiece)}.
                    {' '}Les montants ci-dessous sont le résultat de cette conversion, en euros.
                    {' '}{conversionSource === 'banque'
                      ? 'Montant DÉFINITIF : repris du mouvement bancaire qui a payé la pièce, frais de change compris.'
                      : 'Montant PROVISOIRE : il sera remplacé par ce que la banque a réellement débité, au rapprochement.'}
                  </span>
                ) : (
                  <span className="muted">
                    {' — '}non convertie : aucun taux BCE n'a pu être obtenu au dépôt.
                    {montantDevise != null && ` Montant lu sur le document : ${montantDevise.toFixed(2)} ${devise}.`}
                  </span>
                )}
              </div>
              <button type="button" className="btn btn-outline btn-sm" disabled={fige || conversionEnCours || montantDevise == null} onClick={reconvertir}>
                {conversionEnCours ? 'Conversion…' : `Convertir au taux du ${datePiece || '…'}`}
              </button>
              {conversionErreur && <p className="alerte-tva" style={{ margin: 0 }}>{conversionErreur}</p>}
            </div>
          )}

          {/* Sous les trois champs, et calculé en direct : c'est l'endroit et le moment où la
              personne a le document sous les yeux. La règle n'est pas réécrite ici — c'est le
              contrôle partagé qui tranche (voir lib/controles.ts), appliqué aux valeurs en
              cours de saisie plutôt qu'à la pièce enregistrée. */}
          {motifTvaSaisie && (
            <p className="alerte-tva">
              <strong>TVA impossible :</strong> {LIBELLE_MOTIF_TVA[motifTvaSaisie]}. Ces montants
              ne peuvent pas être ceux du document — la TVA lue part telle quelle en déduction.
            </p>
          )}

          {piece && (
            <FicheHorsDeFrance
              dossierId={dossierId}
              piece={piece}
              pieceModifiee={pieceModifieePourLaFiche}
              donnees={horsDeFrance}
              sansTexteLu={sansTexteLu}
              onModifiee={setFicheHorsDeFranceModifiee}
            />
          )}

          {/* Une pièce pas encore enregistrée n'a rien à quoi rattacher sa note : le champ paraît une fois la pièce
              créée, comme le fil plus bas. Lue en échec, la note n'est pas offerte à la saisie (voir `lectureNote`). */}
          {piece && (
            <div className="field">
              <label htmlFor="notes">Notes internes</label>
              {lectureNote?.etat === 'illisible' ? (
                <div>
                  <p className="error-text" style={{ margin: 0 }}>
                    La note interne n’a pas pu être lue ({lectureNote.message}) : elle ne s’affiche pas, et
                    l’enregistrement de la pièce n’y touche pas.
                  </p>
                  <button type="button" className="btn btn-outline btn-sm" onClick={relireLaNote}>Relire la note</button>
                </div>
              ) : (
                <textarea
                  id="notes"
                  rows={2}
                  value={lectureNote === null ? '' : notes}
                  disabled={lectureNote === null}
                  aria-busy={lectureNote === null}
                  placeholder={lectureNote === null ? 'Lecture de la note…' : undefined}
                  onChange={(e) => setNotes(e.target.value)}
                />
              )}
              <p className="muted" style={{ fontSize: '0.78rem', margin: '4px 0 0' }}>
                Pour le cabinet seul : le client ne la lit pas. Les précisions échangées avec lui sont plus bas.
              </p>
            </div>
          )}

          {/* Le fil client/cabinet, à côté du document plutôt que dans un onglet à part : c'est
              en regardant la facture qu'on a besoin de savoir ce que le client en a dit. Une
              pièce pas encore enregistrée n'a pas d'identifiant, donc rien à quoi rattacher un
              commentaire — le fil n'apparaît qu'une fois la pièce créée. */}
          {piece && (
            <div className="field">
              <label>Précisions du client</label>
              <FilCommentaires
                dossierId={dossierId}
                cible={{ type: 'piece', id: piece.id }}
                commentaires={commentaires}
                estCabinet
                onAjout={(c) => { setCommentaires((prev) => [...prev, c]); onCommentaireAjoute(c) }}
                onSuppression={(id) => {
                  setCommentaires((prev) => prev.filter((c) => c.id !== id))
                  onCommentaireSupprime(id)
                }}
              />
            </div>
          )}

          {rapprochee && <p className="fiche-piece-rapprochee">Rapprochée avec un mouvement bancaire.</p>}
          {pieceMarquee && caisse && (
            <ReglementParLaCaisse dossierId={dossierId} piece={pieceMarquee} factures={exemplaire?.factures ?? null} caisse={caisse} />
          )}

          {refusDeLaValidation !== null && <p className="error-text">{refusDeLaValidation}</p>}
          {attenteDeLaValidation !== null && (
            <div>
              <p className="muted" style={{ margin: 0 }}>{attenteDeLaValidation}</p>
              {!sectionMontree && lectureEnVigueur?.contexte.etat === 'incomplet' && (
                <button type="button" className="btn btn-outline btn-sm" onClick={() => void relireCeQuElleEst()}>Relire</button>
              )}
            </div>
          )}

          {error && <p className="error-text">{error}</p>}
        </div>

        <div className="fiche-piece-pied">
          {piece && !fige && !citeePar && !declareePar && !retenueParLaCaisse ? (
            <button type="button" className="btn btn-danger btn-sm" disabled={occupee} onClick={handleDelete}>
              {deleting ? 'Suppression…' : 'Supprimer'}
            </button>
          ) : <span />}
          <div className="fiche-piece-actions">
            {!fige && (
              <button type="button" className="btn btn-outline btn-sm" disabled={occupee || refusDeLaNature !== null} onClick={() => save('a_valider')}>
                Enregistrer brouillon
              </button>
            )}
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={occupee || refusDeLaNature !== null || refusDeLaValidation !== null || attenteDeLaValidation !== null}
            >
              {saving ? 'Enregistrement…' : fige ? 'Enregistrer' : 'Valider'}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
