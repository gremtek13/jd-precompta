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

function parseAmount(raw?: string): number | null {
  if (!raw) return null
  const n = parseFloat(raw.replace(/[^0-9.,-]/g, "").replace(",", "."))
  return Number.isNaN(n) ? null : n
}

function toIsoDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
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
  const d = new Date(trimmed)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
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

type ClassificationDocument = "releve_bancaire" | "cotisation" | "attestation" | "facture"

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

function classifieDocument(lignes: string[]): ClassificationDocument {
  const texte = lignes.join(" ").toUpperCase()
  const occurrencesOperationsBancaires = (texte.match(/VIR SEPA|PRLV\b/g) ?? []).length
  if (MARQUEURS_RELEVE_BANCAIRE.some((m) => m.test(texte)) || occurrencesOperationsBancaires >= 3) {
    return "releve_bancaire"
  }
  if (/URSSAF|CARPIMKO|APPEL\s+DE\s+COTISATIONS?|COTISATIONS?\s+(SOCIALES?|PROVISIONNELLES?)/.test(texte)) {
    return "cotisation"
  }
  if (/ATTESTATION|CERTIFICAT\s+DE|[EÉ]CH[EÉ]ANCIER\s+ANNUEL/.test(texte)) {
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

// Un avis d'appel de cotisation (URSSAF/CARPIMKO) réel n'a pas "un montant + une date" mais un
// échéancier de plusieurs mensualités ("10 JUILLET 2023  1191,00 EUROS", une ligne par échéance).
// Cherche sur le texte joint plutôt que ligne par ligne (on ne sait pas si Textract regroupe une
// échéance sur une seule ligne ou la scinde) toutes les occurrences "jour mois année montant EUROS".
// Coupe avant un éventuel échéancier "PRÉVISIONNEL" (année suivante, pas encore appelé) pour ne
// retenir que les échéances réellement dues.
function lectureAppelCotisation(lignes: string[]): { echeances: { date: string; montant: number }[]; _diag_cotisation?: string[] } {
  const texte = lignes.join(" ")
  const idxPrevisionnel = texte.toUpperCase().indexOf("PRÉVISIONNEL")
  const zoneUtile = idxPrevisionnel === -1 ? texte : texte.slice(0, idxPrevisionnel)

  const regex = /(\d{1,2})\s+(JANVIER|F[EÉ]VRIER|MARS|AVRIL|MAI|JUIN|JUILLET|AO[UÛ]T|SEPTEMBRE|OCTOBRE|NOVEMBRE|D[EÉ]CEMBRE)\s+(\d{4})\s+(\d[\d\s]*,\d{2})\s*EUROS/gi
  const echeances: { date: string; montant: number }[] = []
  let m: RegExpExecArray | null
  while ((m = regex.exec(zoneUtile))) {
    const mois = MOIS_FR[m[2].toUpperCase()]
    const montant = parseFloat(m[4].replace(/\s/g, "").replace(",", "."))
    const date = mois ? toIsoDate(+m[3], +mois, +m[1]) : null
    if (date && !Number.isNaN(montant)) echeances.push({ date, montant })
  }

  return {
    echeances,
    // Diagnostic temporaire : uniquement si rien n'est trouvé — permet de voir le contexte réel autour
    // d'un éventuel échéancier plutôt que de deviner un nouveau motif à l'aveugle.
    ...(echeances.length === 0 ? { _diag_cotisation: contexteAutourLibelle(lignes, /[EÉ]CH[EÉ]ANCIER/i) } : {}),
  }
}

function extractFields(result: { ExpenseDocuments?: { SummaryFields?: ExpenseField[]; Blocks?: TextractBlock[] }[] }) {
  const doc = result.ExpenseDocuments?.[0]
  if (!doc) {
    return {
      tiers: null, date_piece: null, montant_ht: null, montant_tva: null, montant_ttc: null,
      confiance: "basse" as const, classification: "facture" as const,
      lecture_2035: { recettes: null, charges_sociales_personnelles: null, resultat: null, _diag_2035: undefined, _diag_resultat: undefined },
      lecture_cotisation: { echeances: [], _diag_cotisation: undefined },
    }
  }

  // Un document multi-pages (relevé, 2035...) peut être renvoyé par Textract comme plusieurs
  // ExpenseDocuments — un par page ou groupe de pages — pas forcément un seul avec toutes les Blocks.
  // La classification, le repli TVA texte brut et la lecture 2035 doivent donc chercher sur toutes les
  // pages, pas juste la première : sinon un libellé tombant sur une page suivante serait invisible.
  const lignes = lignesOcr((result.ExpenseDocuments ?? []).flatMap((d) => d.Blocks ?? []))

  const summary: Record<string, { text: string; confidence: number }> = {}
  // Une facture peut avoir plusieurs lignes de TVA (taux différents) — Textract renvoie alors
  // plusieurs champs de type "TAX" ; les garder tous dans un Record écraserait tout sauf le dernier,
  // donc on les additionne à part plutôt que de les traiter comme les autres champs uniques.
  let montantTva: number | null = null
  let taxConfidenceSum = 0
  let taxConfidenceCount = 0
  for (const field of doc.SummaryFields ?? []) {
    const type = field.Type?.Text
    const text = field.ValueDetection?.Text
    const confidence = field.ValueDetection?.Confidence ?? 0
    if (!type || !text) continue

    if (type === "TAX") {
      const amount = parseAmount(text)
      if (amount != null) {
        montantTva = (montantTva ?? 0) + amount
        taxConfidenceSum += confidence
        taxConfidenceCount++
      }
      continue
    }
    summary[type] = { text, confidence }
  }

  const total = summary["TOTAL"]
  const vendor = summary["VENDOR_NAME"]
  const date = summary["INVOICE_RECEIPT_DATE"]
  const subtotal = summary["SUBTOTAL"]

  const montantTtc = parseAmount(total?.text)
  const montantHtDeclare = parseAmount(subtotal?.text)

  // Certaines factures affichent clairement un montant HT et un montant TTC sans que Textract
  // reconnaisse pour autant une ligne "TVA" dédiée (mention "TVA" absente ou mal isolée du reste du
  // texte) — la TVA se déduit alors par différence plutôt que de rester vide à tort.
  if (montantTva == null && montantTtc != null && montantHtDeclare != null) {
    montantTva = Number((montantTtc - montantHtDeclare).toFixed(2))
  }

  // Dernier recours : tableau de ventilation TVA imprimé comme texte simple (tickets de caisse).
  // Diagnostic temporaire inclus tant que le motif n'est pas confirmé sur un cas réel.
  let lignesBrutesDiag: string[] | undefined
  if (montantTva == null) {
    const montant = tvaDepuisTexteBrut(lignes)
    if (montant != null) montantTva = montant
    else lignesBrutesDiag = lignes
  }

  const confidences = [total, vendor, date].filter((f): f is { text: string; confidence: number } => !!f).map((f) => f.confidence)
  if (taxConfidenceCount > 0) confidences.push(taxConfidenceSum / taxConfidenceCount)
  const avgConfidence = confidences.length ? confidences.reduce((a, b) => a + b, 0) / confidences.length : 0

  return {
    tiers: vendor?.text ?? null,
    date_piece: parseDate(date?.text),
    montant_ttc: montantTtc,
    montant_tva: montantTva,
    montant_ht: montantHtDeclare ?? (montantTtc != null && montantTva != null ? Number((montantTtc - montantTva).toFixed(2)) : null),
    confiance: avgConfidence >= 90 ? "haute" as const : avgConfidence >= 70 ? "moyenne" as const : "basse" as const,
    classification: classifieDocument(lignes),
    lecture_2035: lectureDeclaration2035(lignes),
    lecture_cotisation: lectureAppelCotisation(lignes),
    // Diagnostic temporaire : uniquement présent si la TVA reste introuvable après toutes les
    // tentatives — permet de voir le texte OCR brut plutôt que de deviner encore un nouveau motif.
    ...(lignesBrutesDiag ? { _lignes_brutes: lignesBrutesDiag } : {}),
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
