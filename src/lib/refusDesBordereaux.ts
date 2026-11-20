// LE REFUS D'UN BORDEREAU DE TÉLÉTRANSMISSION AU DÉPÔT (conception 59, lot BOR6, première partie ; BOR-Q9 (A), réponse du
// cabinet du 17/11/2026, dans la suite de NOE-Q6 (A) ; docs/conceptions/59-facture-a-l-assurance-maladie-bordereaux.md).
//
// Un bordereau de télétransmission porte les noms, les numéros d'assuré et les dates de naissance des patients. L'application
// n'est pas hébergée pour des données de santé (RGPD.md § 8.7) : un tel fichier ne doit atteindre ni le stockage, ni la
// lecture de `extract-piece` (Textract, puis le modèle). Déposé par erreur comme une pièce ou un document, il se REFUSE dans
// le navigateur, AVANT tout envoi, et la phrase dit pourquoi et où en importer les totaux à la place : la section « Facturé à
// l'assurance maladie » de l'onglet Banque, ou de « Ma banque », où le fichier se lit sur l'appareil sans partir.
//
// LE JUGEMENT VIT DANS LES PRÉPARATEURS DU DÉPÔT (lib/bornesStockage.ts : `preparerPiece`, `preparerDocumentDuCabinet`,
// `preparerOriginalDImport`, `preparerProcesVerbal`), le passage obligé de tout fichier choisi par une personne vers un seau
// (depotsDansLesSeaux.test.ts) ; refusDesBordereauxAuDepot.test.ts exige que chacun l'appelle. La forme se reconnaît par
// `porteLaFormeDUnBordereau` (lib/bordereauDeTeletransmission.ts, BOR1), le texte des pages par pdf.js dans le navigateur
// (lib/refusDesBordereauxLecture.ts).
//
// CE QUE LE LOT NE COUVRE PAS, dit plutôt que laissé croire :
//   - la réception par e-mail (`receive-email`) : elle ne lit pas le texte d'un PDF aujourd'hui ; l'écarter avant le stockage
//     demande d'y lire la couche de texte, dans l'Edge Function (la seconde partie de BOR6, à mesurer : pdf.js sous Deno, son
//     poids, le mur de 150 s) ;
//   - une image (une photo du bordereau) ou un PDF numérisé sans couche de texte : rien ne s'y lit sans OCR, et l'OCR sort du
//     navigateur ;
//   - un PDF que pdf.js n'ouvre pas (abîmé, protégé par un mot de passe) : ce qui ne se lit pas ne se reconnaît pas, il part
//     comme hier (BOR6-Q1) ;
//   - l'état des paiements de l'assurance maladie (le « bordereau » du payé, par journée comptable) et l'export CSV des
//     retours NOEMIE : leur forme n'est pas encore connue (BOR0, NOE1) — les reconnaître sans elle serait deviner (NOE-Q6).

/**
 * Le drapeau du refus (BOR6, première partie) : BAISSÉ, les préparateurs ne lisent aucun PDF et laissent partir un
 * bordereau comme hier ; LEVÉ, tout PDF déposé est lu par pdf.js avant l'envoi, et celui qui a la forme d'un bordereau de
 * télétransmission se refuse. Aucune migration : le drapeau a gardé le temps de l'essai dans un vrai navigateur (le coût de
 * la lecture d'un gros PDF, l'ouvrier de pdf.js chargé au premier dépôt, en dev et sur le build de production :
 * outils/captures/refusDesBordereaux.mjs), levé le 20/11/2026. Ses deux états se jouent par un accesseur
 * (bornesStockageBordereaux.test.ts).
 */
export const REFUS_DES_BORDEREAUX_PREVU: boolean = true

/**
 * Le refus, dit au cabinet — sans majuscule ni point final, comme les autres refus d'un seau : l'écran le place après le nom
 * du fichier. Il ne cite rien du fichier.
 */
export const REFUS_D_UN_BORDEREAU =
  'ce fichier a la forme d’un bordereau de télétransmission : il porte des noms de patients et ne se dépose pas au dossier, '
  + 'qui n’est pas hébergé pour des données de santé ; ses totaux s’importent dans la section « Facturé à l’assurance maladie » '
  + 'de l’onglet Banque, où le fichier est lu sur cet ordinateur sans être envoyé'

/** Le même refus, aux mots du client (le tutoiement de l'espace client) : sa banque est « Ma banque ». */
export const REFUS_D_UN_BORDEREAU_AU_CLIENT =
  'ce fichier a la forme d’un bordereau de télétransmission : il porte des noms de patients, il ne se dépose donc pas ici ; '
  + 'pour en importer les totaux, ouvre « Ma banque », section « Facturé à l’assurance maladie » : le fichier y est lu sur ton '
  + 'appareil sans être envoyé'
