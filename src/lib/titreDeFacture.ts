// ── DÉBUT COPIE titreDeFacture ───────────────────────────────────────────────────────────────────────────────────────
// LE NOM QUE SE DONNE UNE FACTURE L'EMPORTE SUR UN MOT CROISÉ DANS SON TEXTE (relecture du 04/11/2026, D4 ; PIECES-Q3, sur la
// recommandation). `classifieDocument` (extract-piece) cherchait ses mots dans le texte entier : « Votre attestation
// d'assurance est jointe » faisait d'une prime de responsabilité civile une attestation, « déclarations sociales (URSSAF,
// CARPIMKO) » des honoraires de l'expert-comptable un appel de cotisation, « Solde précédent » une facture de téléphone un
// relevé de banque — rangées dans Documents, hors de la 2035, sans justificatif pour le débit qui les paie. Un document dont
// l'une des premières lignes COMMENCE par « FACTURE » ou « NOTE D'HONORAIRES », et qui imprime un montant, est une facture.
//
// L'original vit ici ; il est copié À L'IDENTIQUE dans extract-piece, auto-portée, et titreDeFactureCopie.test.ts compare la
// copie au caractère près et l'exécute contre l'original. L'onglet Documents s'en sert aussi, sur le texte lu d'un document
// déjà rangé, pour dire « Facture probable » là où la lecture d'hier s'est trompée.

/**
 * Combien de lignes, en ordre de lecture, portent le titre : l'en-tête du fournisseur (nom, adresse, SIRET) passe souvent
 * avant le mot « FACTURE », imprimé à droite, que Textract lit après la colonne de gauche.
 */
export const LIGNES_DU_TITRE = 10

/**
 * Une ligne qui COMMENCE par le nom que se donne une facture — « FACTURE N° 25-118 », « Facture du 05/03/2025 », « Votre
 * facture », « Note d'honoraires » —, jamais « FACTURE CARTE » ni « FACTURE CB », libellés d'opération d'un relevé de banque.
 * Un mot du milieu d'une ligne (« LOT de 2 Factures », « paiement de la facture ») ne compte pas.
 */
const LIGNE_DE_TITRE_FACTURE = /^(VOTRE\s+)?(FACTURE|NOTE\s+D\W?\s*HONORAIRES)\b(?!\s+(CARTE|CB)\b)/

/** Un montant imprimé, à deux décimales : une facture en porte au moins un, un courrier qui la cite pas forcément. */
const MONTANT_IMPRIME = /\d[.,]\d{2}(?!\d)/

/** Le document se donne-t-il pour une facture, dans son titre, et imprime-t-il un montant ? */
export function titreDeFacture(lignes: readonly string[]): boolean {
  const titre = lignes.slice(0, LIGNES_DU_TITRE).map((ligne) => ligne.trim().toUpperCase())
  return titre.some((ligne) => LIGNE_DE_TITRE_FACTURE.test(ligne)) && lignes.some((ligne) => MONTANT_IMPRIME.test(ligne))
}
// ── FIN COPIE titreDeFacture ─────────────────────────────────────────────────────────────────────────────────────────
