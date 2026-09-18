// Edge Function : extraction automatique des champs d'une pièce (facture/reçu) via AWS Textract.
//
// Le navigateur télécharge d'abord le fichier depuis le bucket Storage 'pieces' avec sa propre
// session (déjà autorisée par les policies RLS du bucket pour ce dossier), puis envoie les octets
// bruts ici. Cette fonction ne fait donc aucune vérification d'autorisation supplémentaire : si le
// navigateur a pu obtenir le fichier, l'utilisateur y avait déjà droit. Elle ne touche ni la base ni
// le storage Supabase — elle est un simple relais vers Textract, qui seul détient les identifiants AWS.
//
// Rien n'est jamais enregistré automatiquement : le résultat n'est qu'une suggestion que
// l'utilisateur valide ou corrige côté client avant sauvegarde.

import {
  TextractClient,
  AnalyzeExpenseCommand,
  StartExpenseAnalysisCommand,
  GetExpenseAnalysisCommand,
} from "npm:@aws-sdk/client-textract@3"
import { S3Client, PutObjectCommand, DeleteObjectCommand } from "npm:@aws-sdk/client-s3@3"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  })
}

interface ExpenseField {
  Type?: { Text?: string }
  ValueDetection?: { Text?: string; Confidence?: number }
}

interface TextractBlock {
  BlockType?: string
  Text?: string
}

// Reprend l'algorithme de src/lib/csv.ts (parseMontantBancaire) — fichier auto-porteur, voir
// l'en-tête — plutôt que d'en écrire une troisième version.
//
// Une seule différence, assumée : ici les lettres résiduelles sont retirées ("120,00 EUR"), parce
// que Textract rend le texte tel qu'imprimé sur la facture. Côté CSV, au contraire, refuser "12abc"
// est délibéré — c'est une cellule qui n'est pas un montant, et l'accepter fausserait la détection
// des colonnes. Les deux ne peuvent donc pas être strictement identiques.
//
// L'ancienne version était `parseFloat(raw.replace(/[^0-9.,-]/g,"").replace(",","."))`. Elle ne
// remplaçait que la *première* virgule, et parseFloat s'arrête au séparateur suivant :
//   "1.234,56" → "1.234.56" → 1,23 €   (une facture de 1 234,56 € enregistrée à 1,23 €)
//   "1,234.56" → "1.234.56" → 1,23 €
//   "45,20-"   → "45.20-"   → +45,20   (signe rejeté en fin perdu : un avoir devient une charge)
//   "(45,20)"  → "45,20"    → +45,20   (idem entre parenthèses)
// C'est le montant TTC et le HT de chaque pièce qui en dépendent — même défaut que celui corrigé
// dans csv.ts (import CSV) puis relevePdf.ts (import PDF), troisième occurrence.
//
// Le séparateur décimal ne peut pas être supposé : selon l'émetteur, le point sépare les milliers
// ("1.234,56") ou les décimales ("1,234.56"). On retient comme décimal le dernier séparateur suivi
// d'un ou deux chiffres en fin de chaîne — un montant n'a jamais trois décimales.
function parseAmount(raw?: string): number | null {
  if (!raw) return null
  let s = raw.replace(/[\s\u00a0\u202f]/g, "").replace(/\u20ac/g, "")
  if (!s) return null

  let negatif = false
  if (/^\(.+\)$/.test(s)) {
    negatif = true
    s = s.slice(1, -1)
  }
  if (s.endsWith("-")) {
    negatif = true
    s = s.slice(0, -1)
  } else if (s.startsWith("-")) {
    negatif = true
    s = s.slice(1)
  } else if (s.startsWith("+")) {
    s = s.slice(1)
  }

  // Textract rend le texte tel qu'imprimé : il peut rester des lettres ("EUR", "TTC"). On les retire
  // après le traitement du signe, pour ne pas confondre un "-" de fin avec un tiret de mise en forme.
  s = s.replace(/[^0-9.,]/g, "")
  if (!/^\d[\d.,]*$/.test(s)) return null

  const dernierSeparateur = Math.max(s.lastIndexOf(","), s.lastIndexOf("."))
  let entier = s
  let decimales = ""
  if (dernierSeparateur !== -1 && /^\d{1,2}$/.test(s.slice(dernierSeparateur + 1))) {
    entier = s.slice(0, dernierSeparateur)
    decimales = s.slice(dernierSeparateur + 1)
  }
  entier = entier.replace(/[.,]/g, "")
  if (!/^\d+$/.test(entier)) return null

  const n = Number(decimales ? entier + "." + decimales : entier)
  return Number.isNaN(n) ? null : (negatif ? -n : n)
}

// Le calendrier est vérifié, pas seulement les bornes 1-12 et 1-31 : un « 31/02/2023 » lu de travers
// rendait « 2023-02-31 », une date qui n'existe pas. Postgres refuse la ligne (`date` invalide) et le
// dépôt échoue sur une erreur incompréhensible, ou la valeur voyage jusqu'à un tri qui la classe
// n'importe où. Même contrôle que `dateExiste` dans src/lib/csv.ts — jour 0 du mois suivant = dernier
// jour du mois visé, en UTC donc insensible au fuseau.
function toIsoDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1) return null
  if (day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return null
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
  return dateFuture(iso) ? null : iso
}

// Une pièce comptable ne peut pas être datée du futur : ce qu'on lit alors est une date de validité,
// d'échéance ou de fin de droits, pas la date du document. Constaté sur un import réel — un
// justificatif d'immatriculation ressorti au 27/09/2028.
//
// Le contrôle est ici, dans `toIsoDate`, et non dans la règle de repli : le repli passe déjà par la
// fenêtre `a > anneeReference + 1` de `datesDeLaLigne` et n'aurait jamais pu produire 2028. Cette
// date venait du champ INVOICE_RECEIPT_DATE étiqueté par Textract, qui rejoint `parseDate` sans
// aucune borne d'année. Placer le refus dans `toIsoDate` couvre les deux chemins d'un coup.
//
// Un jour de marge : la fonction tourne en UTC alors que les pièces sont datées à Paris (UTC+1/+2).
// Sans cette marge, une facture du jour même serait refusée en fin de soirée.
//
// Ne corrige QUE l'impossible. Une date passée mais fausse — un relevé de situation 2025 ressorti au
// 15/05/2023 parce que la première date lue était celle d'un contrat — reste à traiter par la règle
// de lecture elle-même : aucun contrôle de bornes ne peut la distinguer d'une pièce ancienne réelle.
function dateFuture(iso: string): boolean {
  const limite = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
  return iso > limite
}

function parseDate(raw?: string): string | null {
  if (!raw) return null
  const trimmed = raw.trim()

  // ISO ou proche : AAAA-MM-JJ, AAAA/MM/JJ
  let m = trimmed.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
  if (m) return toIsoDate(+m[1], +m[2], +m[3])

  // Format français/européen usuel sur les factures et reçus : JJ/MM/AAAA, JJ-MM-AAAA, JJ.MM.AAAA
  // (année sur 2 ou 4 chiffres). `new Date()` interprète ça à l'américaine (MM/JJ) et échoue
  // silencieusement dès que le jour dépasse 12 — d'où les dates manquantes malgré une extraction OK.
  m = trimmed.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/)
  if (m) {
    let year = +m[3]
    if (year < 100) year += year < 70 ? 2000 : 1900
    return toIsoDate(year, +m[2], +m[1])
  }

  // Dernier recours pour les formats textuels (ex. "27 August 2026") que Date sait parfois lire.
  // Repasse par le même refus du futur que toIsoDate — sinon ce chemin le contournerait.
  const d = new Date(trimmed)
  if (Number.isNaN(d.getTime())) return null
  const iso = d.toISOString().slice(0, 10)
  return dateFuture(iso) ? null : iso
}

// Repli de lecture de la date sur le texte OCR brut, quand Textract n'a étiqueté aucun champ
// INVOICE_RECEIPT_DATE. Même principe que `tvaDepuisTexteBrut` plus bas : le texte a bien été lu,
// c'est l'étiquetage qui manque. Constaté sur un fournisseur récurrent dont 18 factures sur 22 sont
// ressorties sans date alors qu'elle y est imprimée en clair — et une pièce sans date n'entre
// ensuite dans aucun pack (voir packGenerator), donc le manque coûte cher.
//
// Volontairement prudent : dater une facture du jour où elle doit être *payée* la range dans le
// mauvais mois, parfois dans le mauvais exercice. Mieux vaut rendre null — le manque est désormais
// signalé à l'écran et dans le récapitulatif — que de remplir avec une date plausible mais fausse.

// Distincte de `MOIS_FR` plus bas, qui sert aux échéanciers de cotisation : celle-là est indexée en
// majuscules accentuées et rend "01".."12", celle-ci sans accents et rend un nombre. Les deux ne sont
// pas fusionnées ici parce que unifier reviendrait à toucher la lecture des cotisations, qui n'est
// pas couverte par des tests — à faire, mais pas en passant.
const MOIS_PAR_NOM: Record<string, number> = {
  janvier: 1, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6,
  juillet: 7, aout: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12,
}

// Accents retirés pour que "février"/"fevrier" et "août"/"aout" tombent sur la même clé : l'OCR rend
// l'un ou l'autre selon la qualité du scan.
function sansAccents(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
}

// Libellés qui annoncent la date de la facture elle-même.
const LIBELLE_DATE_FACTURE = /\b(date\s*(?:de\s*)?(?:la\s*)?(?:facture|facturation|emission|edition)?|facturee?\s+le|facture\s+du|emise?\s+le)\b/
// « Marseille, le 30 juin 2025 » : la formule d'usage des factures et courriers français, où aucun
// libellé « Date » n'apparaît nulle part — c'est exactement la mise en page du fournisseur qui a
// motivé ce repli. Sans cette règle, la lecture ne tenait que parce que le document ne portait
// qu'une seule date (règle 3) : dès qu'il en porte une autre non exclue — « Livré le… », « Relevé
// arrêté au… » — elle échouait.
//
// Le lookahead exige un chiffre juste après, ou la fin de ligne quand la date tombe dans la colonne
// suivante. Sans lui, « Cordialement, le service comptable » passerait pour une annonce de date.
const LIBELLE_VILLE_LE = /,\s*le(?=\s*$|\s+\d)/
// Libellés qui annoncent une AUTRE date : échéance, règlement, livraison, commande, bornes de
// période. Une ligne qui en contient un est écartée, même si elle porte aussi une date valide.
const LIBELLE_AUTRE_DATE = /\b(echeance|reglement|payable|a\s*payer|date\s*limite|livraison|commande|periode|valable|naissance)\b/

const DATE_ISO_REGEX = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g
const DATE_NUMERIQUE_REGEX = /\b(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})\b/g
const DATE_TEXTUELLE_REGEX = /\b(\d{1,2})(?:er)?\s+([a-z]+)\.?\s+(\d{4})\b/g

// Toutes les dates lisibles d'une ligne, en ISO. Une année aberrante est écartée : un numéro de
// facture ou une référence peut ressembler à une date par accident.
function datesDeLaLigne(ligne: string, anneeReference: number): string[] {
  const normalisee = sansAccents(ligne)
  const trouvees: string[] = []
  const ajouter = (a: number, m: number, j: number) => {
    if (a < 2000 || a > anneeReference + 1) return
    const iso = toIsoDate(a, m, j)
    if (iso) trouvees.push(iso)
  }

  for (const m of normalisee.matchAll(DATE_ISO_REGEX)) ajouter(+m[1], +m[2], +m[3])
  for (const m of normalisee.matchAll(DATE_NUMERIQUE_REGEX)) {
    let annee = +m[3]
    if (annee < 100) annee += annee < 70 ? 2000 : 1900
    // JJ/MM et non MM/JJ : ces documents sont français. Lire à l'américaine daterait du 1er décembre
    // une facture du 12 janvier, sans que rien ne le signale.
    ajouter(annee, +m[2], +m[1])
  }
  for (const m of normalisee.matchAll(DATE_TEXTUELLE_REGEX)) {
    const mois = MOIS_PAR_NOM[m[2]]
    if (mois) ajouter(+m[3], mois, +m[1])
  }
  return trouvees
}

type OrigineDate = "libelle" | "unique" | "premiere"

// Le diagnostic porte la ligne d'où chaque date a été lue : sans elle, un échec ne dit que « voici
// des dates », sans permettre de comprendre laquelle était la bonne ni pourquoi la règle a hésité.
function candidatsAvecLigne(utiles: { ligne: string; dates: string[] }[]): string[] {
  const vus = new Set<string>()
  const sortie: string[] = []
  for (const u of utiles) {
    for (const d of u.dates) {
      if (vus.has(d)) continue
      vus.add(d)
      sortie.push(`${d} \u2190 ${u.ligne.slice(0, 80)}`)
    }
  }
  return sortie
}

function dateDepuisTexteBrut(lignes: string[], anneeReference: number): { date: string | null; origine: OrigineDate | null; candidats: string[] } {
  const utiles = lignes.map((ligne) => {
    const normalisee = sansAccents(ligne)
    return {
      ligne,
      dates: datesDeLaLigne(ligne, anneeReference),
      estDateFacture: LIBELLE_DATE_FACTURE.test(normalisee) || LIBELLE_VILLE_LE.test(normalisee),
      estAutreDate: LIBELLE_AUTRE_DATE.test(normalisee),
    }
  })

  // 1. Une ligne qui annonce explicitement la date de facture, sans autre libellé trompeur.
  for (const u of utiles) {
    if (u.estDateFacture && !u.estAutreDate && u.dates.length > 0) return { date: u.dates[0], origine: "libelle", candidats: [] }
  }

  // 2. Le libellé seul sur sa ligne, la date plus bas — mise en page en tableau, où l'en-tête
  //    « Date » et sa valeur ne survivent pas sur la même ligne OCR. Même piège que la ventilation
  //    TVA des tickets de caisse, traitée plus bas.
  //
  //    La valeur n'est pas forcément sur la ligne juste après : entre « Date » et « 31/01/2023 » il
  //    reste les autres colonnes de l'en-tête puis le début de la ligne de valeurs. On regarde donc
  //    quelques lignes en avant, mais pas tout le document — au-delà, la première date rencontrée
  //    n'a plus de rapport avec l'en-tête et on retomberait à choisir au hasard.
  const PORTEE_APRES_LIBELLE = 5
  for (let i = 0; i < utiles.length - 1; i++) {
    const u = utiles[i]
    if (!u.estDateFacture || u.estAutreDate || u.dates.length > 0) continue
    for (let j = i + 1; j < Math.min(i + 1 + PORTEE_APRES_LIBELLE, utiles.length); j++) {
      const suivante = utiles[j]
      if (suivante.estAutreDate) continue
      if (suivante.dates.length > 0) return { date: suivante.dates[0], origine: "libelle", candidats: [] }
    }
  }

  // 3. Aucun libellé reconnu, mais le document ne porte qu'une seule date distincte : elle ne peut
  //    guère être autre chose que la sienne.
  const candidates = [...new Set(utiles.filter((u) => !u.estAutreDate).flatMap((u) => u.dates))]
  if (candidates.length === 1) return { date: candidates[0], origine: "unique", candidats: [] }

  // 4. Plusieurs dates, aucun libellé : on retient la première dans l'ordre de lecture. Une facture
  //    imprime sa propre date dans son en-tête, avant ses conditions de règlement et avant ses
  //    mentions légales de pied de page — l'ordre de lecture porte donc l'information.
  //
  //    Cette règle a d'abord été écartée : mieux valait rendre null que risquer de dater une pièce
  //    du jour où elle doit être payée. Un cas réel l'a tranchée. Sur huit factures d'un fournisseur,
  //    les dates vues étaient systématiquement, dans cet ordre : la date de facture (fin de mois),
  //    trois dates constantes d'un document à l'autre (mentions légales), et l'échéance au 5 du mois
  //    suivant. La première est la bonne à chaque fois, et recoupée avec les factures voisines déjà
  //    datées par Textract, elle forme une série strictement croissante avec les numéros de facture.
  //
  //    Le résultat est marqué "premiere" et remonté à part par l'appelant : une date déduite est
  //    proposée à la vérification, jamais présentée comme lue. C'est ce qui permet de retenir cette
  //    règle sans revenir sur le principe — ne jamais deviner en silence.
  if (candidates.length > 1) return { date: candidates[0], origine: "premiere", candidats: [] }

  return { date: null, origine: null, candidats: candidatsAvecLigne(utiles) }
}

// Certains tickets de caisse (restauration notamment) impriment un tableau de ventilation TVA par
// taux — "TVA 10 %   40,91   4,09   45,00" (HT, TVA, TTC) — comme du texte simple plutôt que comme
// un vrai tableau structuré. Textract ne le reconnaît alors pas comme un champ "TAX"/"SUBTOTAL" (rien
// dans SummaryFields), et pire : sur un ticket de caisse étroit, chaque colonne devient sa propre
// ligne OCR (constaté sur un cas réel) plutôt qu'une seule ligne "taux HT TVA TTC" — la mise en page
// horizontale ne survit pas à la reconnaissance. Le taux reste en revanche immédiatement suivi de
// ses 3 montants (HT, TVA, TTC) dans l'ordre de lecture, donc on parcourt les lignes en cherchant un
// taux isolé puis on prend les 3 lignes suivantes si elles ressemblent à des montants.
const TAUX_TVA_REGEX = /^(?:TVA\s*)?\d{1,2}(?:[.,]\d+)?\s*%$/i
const MONTANT_LIGNE_REGEX = /^[\d\s]+[.,]\d{2}$/

function lignesOcr(blocks: TextractBlock[]): string[] {
  return blocks.filter((b) => b.BlockType === "LINE" && b.Text).map((b) => b.Text!.trim())
}

function tvaDepuisTexteBrut(lignes: string[]): number | null {
  let montant: number | null = null
  for (let i = 0; i < lignes.length; i++) {
    if (!TAUX_TVA_REGEX.test(lignes[i])) continue
    const [ht, tva, ttc] = lignes.slice(i + 1, i + 4)
    if (MONTANT_LIGNE_REGEX.test(ht) && MONTANT_LIGNE_REGEX.test(tva) && MONTANT_LIGNE_REGEX.test(ttc)) {
      const montantTva = parseAmount(tva)
      if (montantTva != null) montant = (montant ?? 0) + montantTva
    }
  }
  return montant != null ? Number(montant.toFixed(2)) : null
}

// "facture" et "facture_vente" restent en PIÈCES, les autres partent dans l'archive Documents — c'est
// `orientationDe` (src/lib/extraction.ts) qui porte cette répartition côté application.
type ClassificationDocument = "releve_bancaire" | "cotisation" | "attestation" | "autre" | "facture" | "facture_vente"

// Repère les documents qui ne sont pas des factures d'achat/vente avant même l'extraction HT/TVA/TTC —
// sur mots-clés caractéristiques cherchés dans le texte OCR brut (ces documents n'ont justement pas de
// champs de facture reconnus par Textract, donc pas de SummaryFields exploitables pour les distinguer).
// Aucun appel Textract supplémentaire : réutilise le même texte que la ventilation TVA ci-dessus. Le
// repli par défaut reste "facture" — en cas de doute, mieux vaut une pièce à vérifier qu'un document
// classé à tort dans une archive où personne ne relit les montants.
// Constaté sur un relevé Caisse d'Épargne réel : la mention explicite "relevé de compte" n'apparaît
// pas forcément (remplacée par "SYNTHESE DE VOTRE COMPTE" / "RESUME D'ACTIVITE" / "SOLDE PRECEDENT"
// selon la banque). Les codes d'opération ("VIR SEPA", "PRLV") sont un signal plus fiable mais peuvent
// apparaître une fois isolément sur une facture (conditions de paiement) — on exige plusieurs
// occurrences plutôt qu'une seule pour éviter un faux positif.
const MARQUEURS_RELEVE_BANCAIRE = [
  /RELEV[EÉ]\s+DE\s+COMPTE/,
  /SOLDE\s+(CR[EÉ]DITEUR|D[EÉ]BITEUR|PR[EÉ]C[EÉ]DENT)/,
  /SYNTH[EÈ]SE\s+DE\s+VOTRE\s+COMPTE/,
  /R[EÉ]SUM[EÉ]\s+D.?ACTIVIT[EÉ]/,
]

// Relevés d'ACTIVITÉ de l'Assurance Maladie (SNIR, relevé individuel d'activité et de prescriptions,
// relevé d'honoraires). Ce sont des états de ce que le praticien a facturé — jamais une dépense.
// Constaté en production : trois d'entre eux dormaient dans les Pièces du dossier test, statut « à
// valider », dont un à 52 357 € que l'OCR avait pris pour un montant de facture. Le jour où un
// opérateur leur donne une catégorie, les charges du dossier gonflent d'autant.
const MARQUEURS_RELEVE_ACTIVITE = [
  /RELEV[EÉ]\s+INDIVIDUEL\s+D.ACTIVIT[EÉ]/,
  /RELEV[EÉ]\s+D.HONORAIRES/,
  /\bSNIR\b/,
]

// Relevés de SITUATION d'un contrat d'épargne (assurance vie, épargne retraite, retraite
// professionnelle supplémentaire). Un relevé de situation donne un CAPITAL, pas un versement : ce
// n'est ni une charge ni une preuve de cotisation déductible — celle-ci passe par un avis de
// versement. Quatre d'entre eux étaient en Pièces pour 21 208 €.
//
// Volontairement fondés sur « relevé … de situation » et sur les libellés de produit, jamais sur le
// seul mot « assurance vie » : il figure aussi sur de vraies factures de courtier.
const MARQUEURS_SITUATION_EPARGNE = [
  /RELEV[EÉ]\s+(ANNUEL\s+|TRIMESTRIEL\s+)?(DE\s+)?SITUATION/,
  /[EÉ]PARGNE\s+RETRAITE/,
  /RETRAITE\s+PROFESSIONNELLE\s+SUPPL[EÉ]MENTAIRE/,
]

// Bordereau de télétransmission : le récapitulatif d'un lot de feuilles de soins électroniques envoyé
// à l'Assurance Maladie et aux mutuelles. C'est ce que le praticien a FACTURÉ, donc une pièce de
// RECETTE — la seule famille reconnue ici qui reste en Pièces sans être un achat.
//
// Le danger est double et silencieux : classé en achat (le défaut de tous les dépôts), son montant
// part en charge, et la recette qu'il justifie n'est comptée nulle part. Un même euro compte alors
// deux fois à l'envers dans le résultat.
//
// Le nom du document est réglementaire (SESAM-Vitale) et commun à tous les logiciels de facturation
// professionnels, contrairement à la mise en page : c'est donc lui, et lui seul, qui sert de marqueur.
// Les libellés propres à un éditeur (« LOT NON SECURISE », « Réalisé par ... ») sont volontairement
// écartés — ils ne diraient rien du bordereau du confrère qui utilise un autre logiciel. Ajouter une
// variante suppose de l'avoir lue sur un vrai document, jamais devinée.
const MARQUEURS_RECETTE = [
  /BORDEREAU\s+DE\s+T[EÉ]L[EÉ]TRANSMISSION/,
]

function classifieDocument(lignes: string[]): ClassificationDocument {
  const texte = lignes.join(" ").toUpperCase()
  const occurrencesOperationsBancaires = (texte.match(/VIR SEPA|PRLV\b/g) ?? []).length
  // En premier, volontairement : ce marqueur porte sur le TITRE du document, le signal le plus
  // spécifique de toute la fonction. Un mot-clé croisé au fil d'un long texte OCR (« attestation »
  // dans une mention de bas de page, un « PRLV » dans un libellé de règlement) ne doit pas primer sur
  // le nom que le document se donne lui-même — d'autant qu'ici l'erreur ne déclasse pas une pièce vers
  // une archive, elle perd une recette.
  if (MARQUEURS_RECETTE.some((m) => m.test(texte))) {
    return "facture_vente"
  }
  if (MARQUEURS_RELEVE_BANCAIRE.some((m) => m.test(texte)) || occurrencesOperationsBancaires >= 3) {
    return "releve_bancaire"
  }
  if (/URSSAF|CARPIMKO|APPEL\s+DE\s+COTISATIONS?|COTISATIONS?\s+(SOCIALES?|PROVISIONNELLES?)/.test(texte)) {
    return "cotisation"
  }
  // APRÈS les cotisations, volontairement : un courrier URSSAF parle lui aussi de « situation », et
  // c'est bien un appel de cotisation qu'il faut y voir, pas un relevé d'épargne.
  if (MARQUEURS_RELEVE_ACTIVITE.some((m) => m.test(texte)) || MARQUEURS_SITUATION_EPARGNE.some((m) => m.test(texte))) {
    return "autre"
  }
  // Constaté sur un avis de situation d'impôt réel : cet en-tête apparaît sur tout document officiel de
  // l'administration fiscale (avis d'impôt, taxe foncière, CFE...) — jamais sur une vraie facture.
  // Catégorie "attestation" la plus proche déjà existante, faute d'un poste dédié à ces documents.
  if (/ATTESTATION|CERTIFICAT\s+DE|[EÉ]CH[EÉ]ANCIER\s+ANNUEL|DIRECTION\s+G[EÉ]N[EÉ]RALE\s+DES\s+FINANCES\s+PUBLIQUES/.test(texte)) {
    return "attestation"
  }
  return "facture"
}

// Formulaire 2035 réel (généré par un logiciel comptable) : le formulaire précise "Ne portez qu'une
// somme par ligne (ne pas porter les centimes)" — les montants sont des entiers, jamais de virgule,
// avec l'espace comme séparateur de milliers. Uniquement des chiffres/espaces, donc, contrairement au
// motif décimal utilisé pour une facture.
const MONTANT_2035_REGEX = /^\d[\d\s]{0,9}$/

function parseMontant2035(raw: string): number | null {
  const n = parseInt(raw.replace(/\s/g, ""), 10)
  return Number.isNaN(n) ? null : n
}

// Cherche un montant sur la ligne d'un libellé donné (fin de ligne, cas d'un formulaire qui imprime
// "Libellé ... 12 345" sur une seule ligne visuelle) ou sur l'une des 2 lignes suivantes (cas où l'OCR
// sépare libellé et montant). Renvoie null plutôt qu'un mauvais numéro si rien de net — sur un
// formulaire aussi dense qu'une 2035, mieux vaut laisser le champ vide à compléter à la main que
// remonter un chiffre pris au hasard dans la grille.
function montantApresLibelle(lignes: string[], libelleRegex: RegExp): number | null {
  for (let i = 0; i < lignes.length; i++) {
    if (!libelleRegex.test(lignes[i])) continue
    const surLaLigne = lignes[i].match(/(\d[\d\s]{0,9})\s*$/)
    if (surLaLigne) {
      const montant = parseMontant2035(surLaLigne[1])
      if (montant != null) return montant
    }
    for (const suivante of lignes.slice(i + 1, i + 3)) {
      if (MONTANT_2035_REGEX.test(suivante.trim())) {
        const montant = parseMontant2035(suivante.trim())
        if (montant != null) return montant
      }
    }
  }
  return null
}

// Diagnostic temporaire : la ligne où un libellé a matché, plus les 4 suivantes — pour voir le vrai
// découpage en lignes que Textract produit sur un cas réel (une 2035 est une grille dense où le
// premier essai a remonté un numéro de ligne du formulaire au lieu d'un montant), plutôt que deviner
// un nouveau motif à l'aveugle. À retirer une fois le motif confirmé sur un cas réel.
function contexteAutourLibelle(lignes: string[], libelleRegex: RegExp): string[] {
  const contexte: string[] = []
  for (let i = 0; i < lignes.length; i++) {
    if (!libelleRegex.test(lignes[i])) continue
    contexte.push(`[${i}] ${lignes[i]}`, ...lignes.slice(i + 1, i + 5).map((l, j) => `[${i + 1 + j}] ${l}`))
  }
  return contexte
}

// Lecture best-effort d'une ancienne déclaration 2035 (revenus non commerciaux), pour préremplir le
// repère annuel de l'onglet Estimation sans ressaisir les chiffres à la main. Toujours à vérifier
// contre le document affiché : ce formulaire est une grille dense, moins linéaire qu'une facture ou
// un relevé, donc moins fiable que le reste de l'extraction.
//
// Confirmé sur un cas réel (diagnostic) : "Recettes (brutes|encaissées)" est un mauvais repère — le
// motif matche aussi "Montant de la TVA afférente aux recettes brutes" plus bas dans le formulaire, et
// la case AA elle-même (juste après le libellé "Recettes encaissées...") peut porter un montant très
// inférieur au vrai CA (2 € constaté, alors que "Montant net des recettes" donnait le bon chiffre
// juste après). "Montant net des recettes" (case AD) s'est révélé fiable et sans ambiguïté — on s'y
// tient plutôt que de deviner un repli supplémentaire non vérifié.
function lectureDeclaration2035(lignes: string[]): {
  recettes: number | null
  charges_sociales_personnelles: number | null
  resultat: number | null
  _diag_2035?: string[]
  _diag_resultat?: string[]
} {
  const recettes = montantApresLibelle(lignes, /MONTANT\s+NET\s+DES\s+RECETTES/i)
  const chargesSociales = montantApresLibelle(lignes, /CHARGES\s+SOCIALES\s+PERSONNELLES/i)

  // Confirmé sur un cas réel (diagnostic) : la première occurrence de "Bénéfice" dans le document est
  // bien la bonne — le chiffre de la page de garde ("1- Résultat fiscal") et celui du détail du calcul
  // ("Bénéfice (ligne 38 – ligne 45)") plus loin donnent la même valeur. Les autres mentions de
  // "Bénéfice" (case à cocher d'exonération, société civile de moyens...) arrivent toutes après dans
  // le document, donc jamais rencontrées en premier. Repli sur "Déficit" (négatif) si le client est en
  // perte plutôt qu'en bénéfice — jamais les deux à la fois sur une même déclaration.
  const benefice = montantApresLibelle(lignes, /B[EÉ]N[EÉ]FICE/i)
  const deficit = benefice == null ? montantApresLibelle(lignes, /D[EÉ]FICIT/i) : null
  const resultat = benefice ?? (deficit != null ? -deficit : null)

  return {
    recettes,
    charges_sociales_personnelles: chargesSociales,
    resultat,
    // Diagnostic temporaire : uniquement si le montant correspondant reste introuvable — même logique
    // que le repli TVA texte brut, pour ajuster sur un cas réel plutôt qu'à l'aveugle.
    ...(recettes == null || chargesSociales == null
      ? {
          _diag_2035: [
            ...contexteAutourLibelle(lignes, /MONTANT\s+NET\s+DES\s+RECETTES/i),
            ...contexteAutourLibelle(lignes, /CHARGES\s+SOCIALES\s+PERSONNELLES/i),
          ],
        }
      : {}),
    ...(resultat == null
      ? {
          _diag_resultat: [
            ...contexteAutourLibelle(lignes, /R[EÉ]SULTAT\s+FISCAL/i),
            ...contexteAutourLibelle(lignes, /B[EÉ]N[EÉ]FICE/i),
            ...contexteAutourLibelle(lignes, /D[EÉ]FICIT/i),
          ],
        }
      : {}),
  }
}

const MOIS_FR: Record<string, string> = {
  JANVIER: "01", "FÉVRIER": "02", FEVRIER: "02", MARS: "03", AVRIL: "04", MAI: "05", JUIN: "06",
  JUILLET: "07", AOUT: "08", "AOÛT": "08", SEPTEMBRE: "09", OCTOBRE: "10", NOVEMBRE: "11",
  "DÉCEMBRE": "12", DECEMBRE: "12",
}

// Format CARPIMKO réel : "10 JUILLET 2023  1191,00 EUROS", une ligne (jour mois année montant EUROS)
// par échéance — cherché sur le texte joint plutôt que ligne par ligne, faute de savoir si Textract
// regroupe une échéance sur une seule ligne ou la scinde. Un éventuel échéancier "PRÉVISIONNEL" (année
// suivante, pas encore un appel officiel) n'est plus exclu : la caisse le prélève en pratique dès les
// premiers mois de l'année suivante, donc remonté comme les autres mais marqué "previsionnel" pour ne
// pas le confondre avec un montant définitif — corrigé automatiquement quand l'appel définitif arrive
// (voir CotisationsTab.creerEcheancesProposees côté client).
function lectureEcheancierEnLigne(lignes: string[]): { date: string; montant: number; previsionnel: boolean }[] {
  const texte = lignes.join(" ")
  const idxPrevisionnel = texte.toUpperCase().indexOf("PRÉVISIONNEL")

  const regex = /(\d{1,2})\s+(JANVIER|F[EÉ]VRIER|MARS|AVRIL|MAI|JUIN|JUILLET|AO[UÛ]T|SEPTEMBRE|OCTOBRE|NOVEMBRE|D[EÉ]CEMBRE)\s+(\d{4})\s+(\d[\d\s]*,\d{2})\s*EUROS/gi
  const echeances: { date: string; montant: number; previsionnel: boolean }[] = []
  let m: RegExpExecArray | null
  while ((m = regex.exec(texte))) {
    const mois = MOIS_FR[m[2].toUpperCase()]
    const montant = parseFloat(m[4].replace(/\s/g, "").replace(",", "."))
    const date = mois ? toIsoDate(+m[3], +mois, +m[1]) : null
    if (date && !Number.isNaN(montant)) {
      echeances.push({ date, montant, previsionnel: idxPrevisionnel !== -1 && m.index >= idxPrevisionnel })
    }
  }
  return echeances
}

const JOUR_MOIS_REGEX = /^(\d{1,2})\s+(JANVIER|F[EÉ]VRIER|MARS|AVRIL|MAI|JUIN|JUILLET|AO[UÛ]T|SEPTEMBRE|OCTOBRE|NOVEMBRE|D[EÉ]CEMBRE)$/i
const MONTANT_EUROS_REGEX = /^([\d\s]+,\d{2})\s*€?$/

function montantEuros(ligne?: string): number | null {
  if (!ligne) return null
  const m = ligne.trim().match(MONTANT_EUROS_REGEX)
  if (!m) return null
  const n = parseFloat(m[1].replace(/\s/g, "").replace(",", "."))
  return Number.isNaN(n) ? null : n
}

// Format URSSAF réel (courrier de régularisation) : le tableau imprime une ligne "jour mois" (sans
// année, ex. "05 janvier"), suivie de 3 lignes de montants dans un ordre fixe — régularisation,
// cotisations provisionnelles, montant restant à payer. La 3e ligne (montant restant à payer) est le
// bon montant, sauf pour les mois déjà passés à la date du courrier où elle affiche "/" (déjà réglé
// au montant provisionnel d'origine) : on retombe alors sur la 2e ligne, toujours renseignée.
// L'année est prise sur l'en-tête "ÉCHÉANCIER DE COTISATIONS <année>", absente de la ligne de date.
function lectureEcheancierParLignes(lignes: string[]): { date: string; montant: number; previsionnel: boolean }[] {
  const anneeMatch = lignes.join(" ").match(/[EÉ]CH[EÉ]ANCIER\s+DE\s+COTISATIONS\s+(\d{4})/i)
  if (!anneeMatch) return []
  const annee = anneeMatch[1]

  // Ce format (courrier de régularisation URSSAF) n'a pas de section "PRÉVISIONNEL" séparée comme
  // CARPIMKO — chaque échéance de ce tableau est déjà un montant à payer, jamais une estimation.
  const echeances: { date: string; montant: number; previsionnel: boolean }[] = []
  for (let i = 0; i < lignes.length; i++) {
    const m = lignes[i].trim().match(JOUR_MOIS_REGEX)
    if (!m) continue
    const mois = MOIS_FR[m[2].toUpperCase()]
    if (!mois) continue
    const montant = montantEuros(lignes[i + 3]) ?? montantEuros(lignes[i + 2])
    if (montant == null) continue
    const date = toIsoDate(+annee, +mois, +m[1])
    if (date) echeances.push({ date, montant, previsionnel: false })
  }
  return echeances
}

function lectureAppelCotisation(lignes: string[]): { echeances: { date: string; montant: number; previsionnel: boolean }[]; _diag_cotisation?: string[] } {
  const echeances = lectureEcheancierEnLigne(lignes)
  const echeancesFinal = echeances.length > 0 ? echeances : lectureEcheancierParLignes(lignes)

  return {
    echeances: echeancesFinal,
    // Diagnostic temporaire : toujours renvoyé, pas seulement quand rien n'est trouvé — constaté sur un
    // cas réel (CARPIMKO) qu'une partie des échéances peut manquer (ex. l'année suivante) alors que le
    // reste a bien été trouvé, ce qui masquerait le problème si le diagnostic n'apparaissait qu'à zéro
    // résultat. Le texte OCR en entier, pas juste un contexte étroit autour d'un mot-clé — constaté par
    // ailleurs (URSSAF) que le tableau utile peut être loin de toute mention de ce mot-clé.
    _diag_cotisation: lignes.map((l, i) => `[${i}] ${l}`),
  }
}

// Le taux de TVA le plus élevé applicable en France. Au-delà, ce n'est pas une TVA : c'est une
// lecture fausse. Sert d'arbitre quand deux lectures se contredisent — une seule des deux peut être
// légale, et c'est celle-là qu'on retient.
const TAUX_TVA_MAXIMAL = 0.2
const TOLERANCE_CENTIME = 0.01

type Redressement = "doublon_tva" | "arbitrage_soustraction" | "permutation_ht_tva"

interface MontantsResolus {
  montant_ht: number | null
  montant_tva: number | null
  montant_ttc: number | null
  /** Ce qu'il a fallu redresser. Une lecture redressée est juste, mais elle n'est plus « lue ». */
  redressement: Redressement | null
  /** Les trois montants sont présents, bouclent, et le taux est légal. */
  coherent: boolean
}

function arrondi(n: number): number {
  return Math.round(n * 100) / 100
}

function tauxLegal(ht: number | null, tva: number | null): boolean {
  if (ht == null || tva == null) return false
  if (ht === 0) return tva === 0
  if (Math.sign(tva) !== Math.sign(ht) && tva !== 0) return false
  return Math.abs(tva) <= Math.abs(ht) * TAUX_TVA_MAXIMAL + TOLERANCE_CENTIME
}

// Reconstitue les trois montants d'une pièce à partir de ce que Textract a étiqueté, en refusant
// d'écrire un triplet qui ne peut pas être vrai.
//
// Trois défauts constatés sur le corpus réel, chacun invisible pour qui ne regarde que la confiance
// de lecture — Textract avait parfaitement lu les caractères dans les trois cas :
//
// 1. LE MÊME TOTAL DE TVA COMPTÉ PLUSIEURS FOIS. Textract émet un champ "TAX" par détection, et une
//    facture imprime couramment son total de TVA deux ou trois fois (récapitulatif, pied de page,
//    tableau de ventilation). Les additionner triplait le montant : sur une facture Apple réelle,
//    79,84 € détecté 3 fois est devenu 239,52 € en base, en confiance « haute ».
//
// 2. UN SOUS-TOTAL LU À ZÉRO. Un HT à 0 sous un TTC non nul n'est pas une lecture, c'est un échec de
//    lecture : il donne un taux infini. Le traiter comme absent fait retomber sur la soustraction,
//    qui elle est juste (constaté sur une facture INPI : 0 / 188,81 au lieu de 178,64 / 10,17).
//
// 3. HT ET TVA PERMUTÉS. Le cas qu'aucun contrôle arithmétique ne peut voir : 69,60 + 480,40 = 550,00
//    boucle parfaitement. Seule la LÉGALITÉ le trahit — 690 % de TVA n'existe pas, alors que la
//    lecture inverse donne 14,5 %, taux normal pour une note de restaurant mêlant 10 % et 20 %.
//
// Règle d'arbitrage : quand le TOTAL et le SOUS-TOTAL sont tous deux lus, ils déterminent la TVA par
// soustraction, et une TVA détectée qui les contredit est une troisième lecture contre deux. On
// l'écarte — SAUF si la soustraction donne un taux illégal et la détection un taux légal, auquel cas
// c'est le sous-total qui était mal lu.
function resoudreMontants(
  totalLu: number | null,
  sousTotalLu: number | null,
  taxesDetectees: number[],
): MontantsResolus {
  let redressement: Redressement | null = null

  // Défaut 1 : on somme les montants DISTINCTS. Deux lignes de TVA réellement différentes (taux
  // multiples) restent additionnées ; le même montant détecté plusieurs fois ne compte qu'une fois.
  // Le cas perdant — deux lignes de TVA distinctes portant par coïncidence le même montant — est
  // rattrapé juste après par la soustraction quand le sous-total est lu, et reste bien plus rare que
  // le récapitulatif imprimé deux fois, qui est la norme.
  const distinctes = [...new Set(taxesDetectees)]
  if (distinctes.length < taxesDetectees.length) redressement = "doublon_tva"
  const tvaDetectee = distinctes.length > 0 ? arrondi(distinctes.reduce((a, b) => a + b, 0)) : null

  // Défaut 2 : un sous-total nul face à un total non nul est écarté, pas cru.
  const sousTotal = sousTotalLu === 0 && totalLu != null && totalLu !== 0 ? null : sousTotalLu

  let ht = sousTotal
  let tva = tvaDetectee
  const ttc = totalLu

  if (ttc != null && sousTotal != null) {
    const parSoustraction = arrondi(ttc - sousTotal)
    if (tvaDetectee == null || Math.abs(tvaDetectee - parSoustraction) <= TOLERANCE_CENTIME) {
      tva = parSoustraction
    } else if (!tauxLegal(sousTotal, parSoustraction) && tauxLegal(arrondi(ttc - tvaDetectee), tvaDetectee)) {
      // Le sous-total était la mauvaise lecture : on le refait à partir de la TVA détectée.
      ht = arrondi(ttc - tvaDetectee)
      tva = tvaDetectee
      redressement = "arbitrage_soustraction"
    } else {
      tva = parSoustraction
      redressement = "arbitrage_soustraction"
    }
  } else if (ttc != null && tva != null) {
    ht = arrondi(ttc - tva)
  }

  // Défaut 3 : la permutation, que seule la légalité peut trahir.
  if (ht != null && tva != null && !tauxLegal(ht, tva) && tauxLegal(tva, ht)) {
    const permute = ht
    ht = tva
    tva = permute
    redressement = "permutation_ht_tva"
  }

  const coherent = ttc != null && ht != null && tva != null
    && Math.abs(ht + tva - ttc) <= TOLERANCE_CENTIME
    && tauxLegal(ht, tva)

  return { montant_ht: ht, montant_tva: tva, montant_ttc: ttc, redressement, coherent }
}

function extractFields(result: { ExpenseDocuments?: { SummaryFields?: ExpenseField[]; Blocks?: TextractBlock[] }[] }) {
  const documents = result.ExpenseDocuments ?? []
  if (documents.length === 0) {
    return {
      tiers: null, date_piece: null, montant_ht: null, montant_tva: null, montant_ttc: null,
      confiance: "basse" as const, classification: "facture" as const, texte_ocr: "",
      lecture_2035: { recettes: null, charges_sociales_personnelles: null, resultat: null, _diag_2035: undefined, _diag_resultat: undefined },
      lecture_cotisation: { echeances: [], _diag_cotisation: undefined },
    }
  }

  // Un document multi-pages (relevé, 2035...) peut être renvoyé par Textract comme plusieurs
  // ExpenseDocuments — un par page ou groupe de pages — pas forcément un seul avec toutes les Blocks.
  // La classification, le repli TVA texte brut et la lecture 2035 doivent donc chercher sur toutes les
  // pages, pas juste la première : sinon un libellé tombant sur une page suivante serait invisible.
  const lignes = lignesOcr(documents.flatMap((d) => d.Blocks ?? []))

  const summary: Record<string, { text: string; confidence: number }> = {}
  // Une facture peut avoir plusieurs lignes de TVA (taux différents) — Textract renvoie alors
  // plusieurs champs de type "TAX" ; les garder tous dans un Record écraserait tout sauf le dernier,
  // donc on les collecte à part plutôt que de les traiter comme les autres champs uniques.
  //
  // Collectés, et non additionnés au fil de l'eau : Textract émet aussi un champ par RÉPÉTITION du
  // même total sur le document, et les additionner en aveugle multipliait la TVA par le nombre de
  // fois qu'elle est imprimée. C'est resoudreMontants qui décide de ce qui s'additionne.
  const taxesDetectees: number[] = []
  let taxConfidenceSum = 0
  let taxConfidenceCount = 0
  // Même raison que pour lignesOcr ci-dessus : la date/le fournisseur/le total peuvent être détectés
  // sur un ExpenseDocuments[1+] plutôt que [0] sur un document multi-pages — constaté en pratique par
  // des dates trouvées sur certains documents et pas d'autres sans raison apparente. On parcourt tous
  // les groupes et on garde la première occurrence de chaque champ (page 1 en priorité), jamais la
  // dernière qui pourrait provenir d'une mention moins fiable plus loin dans le document.
  for (const doc of documents) {
    for (const field of doc.SummaryFields ?? []) {
      const type = field.Type?.Text
      const text = field.ValueDetection?.Text
      const confidence = field.ValueDetection?.Confidence ?? 0
      if (!type || !text) continue

      if (type === "TAX") {
        const amount = parseAmount(text)
        if (amount != null) {
          taxesDetectees.push(amount)
          taxConfidenceSum += confidence
          taxConfidenceCount++
        }
        continue
      }
      if (!summary[type]) summary[type] = { text, confidence }
    }
  }

  const total = summary["TOTAL"]
  const vendor = summary["VENDOR_NAME"]
  const date = summary["INVOICE_RECEIPT_DATE"]
  const subtotal = summary["SUBTOTAL"]

  const montantTtc = parseAmount(total?.text)
  const montantHtDeclare = parseAmount(subtotal?.text)

  // Reconstitution des trois montants, y compris la déduction de la TVA par différence quand une
  // facture affiche un HT et un TTC sans que Textract isole de ligne "TVA" (voir resoudreMontants).
  let montants = resoudreMontants(montantTtc, montantHtDeclare, taxesDetectees)

  // Dernier recours : tableau de ventilation TVA imprimé comme texte simple (tickets de caisse).
  // Diagnostic temporaire inclus tant que le motif n'est pas confirmé sur un cas réel.
  let lignesBrutesDiag: string[] | undefined
  if (montants.montant_tva == null) {
    const montant = tvaDepuisTexteBrut(lignes)
    if (montant != null) montants = resoudreMontants(montantTtc, montantHtDeclare, [montant])
    else lignesBrutesDiag = lignes
  }

  // Date : le champ étiqueté par Textract d'abord, puis le texte OCR brut. Textract n'étiquette
  // INVOICE_RECEIPT_DATE que de façon irrégulière — sur un fournisseur récurrent réel, 4 factures
  // sur 22 seulement — alors que la date est lue et présente dans `lignes` dans tous les cas.
  let datePiece = parseDate(date?.text)
  let datesDiag: string[] | undefined
  // Renseigné uniquement quand la date vient de la règle de dernier recours (première date en ordre
  // de lecture) : l'appelant la remonte alors à vérifier plutôt que de la présenter comme lue.
  let dateDeduite = false
  if (!datePiece) {
    const repli = dateDepuisTexteBrut(lignes, new Date().getUTCFullYear())
    if (repli.date) {
      datePiece = repli.date
      dateDeduite = repli.origine === "premiere"
    } else if (repli.candidats.length > 0) {
      datesDiag = repli.candidats
    }
  }

  const confidences = [total, vendor, date].filter((f): f is { text: string; confidence: number } => !!f).map((f) => f.confidence)
  if (taxConfidenceCount > 0) confidences.push(taxConfidenceSum / taxConfidenceCount)
  const avgConfidence = confidences.length ? confidences.reduce((a, b) => a + b, 0) / confidences.length : 0

  // La confiance rendue par Textract mesure la LISIBILITÉ, pas la justesse : elle dit qu'il a bien lu
  // les caractères, pas qu'il a pris le bon nombre. Les onze pièces à TVA démontrablement fausse du
  // corpus étaient TOUTES en « haute » — l'opérateur qui trie par confiance pour savoir quoi relire
  // regardait précisément la mauvaise colonne.
  //
  // On la plafonne donc par ce que les montants disent d'eux-mêmes. Une pièce dont les trois montants
  // ne bouclent pas, ou dont le taux est impossible, ne peut pas être annoncée comme sûre : c'est
  // exactement celle qu'il faut rouvrir. Une pièce redressée est juste, mais elle n'a plus été lue —
  // « moyenne » dit qu'on y a touché.
  const lecture = avgConfidence >= 90 ? "haute" as const : avgConfidence >= 70 ? "moyenne" as const : "basse" as const
  const plafond = !montants.coherent ? "basse" as const : montants.redressement ? "moyenne" as const : "haute" as const
  const rang = { basse: 0, moyenne: 1, haute: 2 }
  const confiance = rang[lecture] <= rang[plafond] ? lecture : plafond

  return {
    tiers: vendor?.text ?? null,
    date_piece: datePiece,
    montant_ttc: montants.montant_ttc,
    montant_tva: montants.montant_tva,
    montant_ht: montants.montant_ht,
    confiance,
    classification: classifieDocument(lignes),
    // Le texte lu, rendu tel quel. Il était jusqu'ici calculé puis jeté : il sert à classer le
    // document, à retrouver une date et à rattraper une TVA, mais rien n'en sortait. Or c'est
    // exactement ce qui manque à l'opérateur devant « BOULANGER MARSEILLE, 199,99 € » — la réponse
    // (« FOUR MICRO-ONDES ») était sous ses yeux à l'extraction, et personne ne l'a gardée.
    // Aucun filtrage ni troncature : ce qui sera montré doit être ce qui a été lu, sinon on ne peut
    // plus diagnostiquer une extraction douteuse avec.
    texte_ocr: lignes.join("\n"),
    lecture_2035: lectureDeclaration2035(lignes),
    lecture_cotisation: lectureAppelCotisation(lignes),
    // Diagnostic temporaire : uniquement présent si la TVA reste introuvable après toutes les
    // tentatives — permet de voir le texte OCR brut plutôt que de deviner encore un nouveau motif.
    ...(lignesBrutesDiag ? { _lignes_brutes: lignesBrutesDiag } : {}),
    ...(datesDiag ? { _diag_dates: datesDiag } : {}),
    ...(dateDeduite ? { _date_deduite: true } : {}),
    // Ce qui a dû être redressé, pour que l'appelant puisse le dire plutôt que de présenter un
    // montant reconstitué comme un montant lu — même raison que _date_deduite juste au-dessus.
    ...(montants.redressement ? { _montants_redresses: montants.redressement } : {}),
  }
}

// Un PDF commence toujours par la signature "%PDF" — permet de distinguer un PDF d'une image
// (JPEG/PNG) sans dépendre du nom de fichier ou d'un en-tête HTTP transmis par le client.
function isPdf(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46
}

interface ExpenseAnalysisResult {
  ExpenseDocuments?: { SummaryFields?: ExpenseField[]; Blocks?: TextractBlock[] }[]
}

// L'API synchrone AnalyzeExpense ne traite que les PDF d'une seule page (ou une image) — un PDF de
// plusieurs pages échoue systématiquement. L'API asynchrone StartExpenseAnalysis/GetExpenseAnalysis
// gère le multi-pages, mais impose que le document soit dans un bucket S3 (pas envoyé en direct) :
// on l'y dépose temporairement, on lance le job, on attend le résultat par sondage (pas de SNS —
// inutile pour une seule requête synchrone côté utilisateur), puis on supprime le fichier quel que
// soit le résultat, y compris en cas d'erreur.
async function analyzeExpensePdfAsync(fileBytes: Uint8Array, textract: TextractClient): Promise<ExpenseAnalysisResult> {
  const bucket = Deno.env.get("AWS_TEXTRACT_BUCKET")
  if (!bucket) throw new Error("AWS_TEXTRACT_BUCKET non configuré — extraction multi-pages indisponible.")

  const s3 = new S3Client({
    region: Deno.env.get("AWS_REGION") ?? "eu-central-1",
    credentials: {
      accessKeyId: Deno.env.get("AWS_ACCESS_KEY_ID")!,
      secretAccessKey: Deno.env.get("AWS_SECRET_ACCESS_KEY")!,
    },
  })

  const key = `tmp/${crypto.randomUUID()}.pdf`
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: fileBytes, ContentType: "application/pdf" }))

  try {
    const start = await textract.send(
      new StartExpenseAnalysisCommand({ DocumentLocation: { S3Object: { Bucket: bucket, Name: key } } }),
    )
    const jobId = start.JobId
    if (!jobId) throw new Error("Textract n'a pas renvoyé d'identifiant de job.")

    // Sondage toutes les 2s pendant 50s max — largement suffisant pour un document de quelques
    // pages ; au-delà, mieux vaut renvoyer une erreur claire que de laisser l'utilisateur attendre.
    const deadline = Date.now() + 50_000
    let last: (ExpenseAnalysisResult & { JobStatus?: string }) | undefined
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 2000))
      last = await textract.send(new GetExpenseAnalysisCommand({ JobId: jobId }))
      if (last.JobStatus === "SUCCEEDED" || last.JobStatus === "FAILED") break
    }

    if (!last || last.JobStatus !== "SUCCEEDED") {
      throw new Error(
        last?.JobStatus === "FAILED"
          ? "Textract n'a pas pu analyser ce document (illisible ou format non pris en charge)."
          : "Extraction trop longue — réessaie ou saisis les champs manuellement.",
      )
    }
    return last
  } finally {
    // Filet de sécurité : même si la suppression échoue, une règle de cycle de vie sur le bucket
    // purge automatiquement le dossier tmp/ après 1 jour (voir configuration du bucket).
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })).catch((e) => console.error("Suppression S3 tmp échouée:", e))
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    const fileBytes = new Uint8Array(await req.arrayBuffer())

    if (fileBytes.byteLength === 0) {
      return json({ error: "Fichier vide." }, 400)
    }
    if (fileBytes.byteLength > 10 * 1024 * 1024) {
      return json({ error: "Fichier trop volumineux pour l'extraction automatique (max 10 Mo)." }, 400)
    }

    const client = new TextractClient({
      region: Deno.env.get("AWS_REGION") ?? "eu-central-1",
      credentials: {
        accessKeyId: Deno.env.get("AWS_ACCESS_KEY_ID")!,
        secretAccessKey: Deno.env.get("AWS_SECRET_ACCESS_KEY")!,
      },
    })

    // Les PDF passent par le chemin asynchrone (seul à supporter le multi-pages) ; les images
    // (JPEG/PNG re-encodées côté client) restent sur le chemin synchrone, plus rapide et sans S3.
    const result = isPdf(fileBytes)
      ? await analyzeExpensePdfAsync(fileBytes, client)
      : await client.send(new AnalyzeExpenseCommand({ Document: { Bytes: fileBytes } }))

    return json(extractFields(result))
  } catch (err) {
    console.error(err)
    return json({ error: err instanceof Error ? err.message : "Échec de l'extraction automatique." }, 500)
  }
})
