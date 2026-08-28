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
// dans SummaryFields), mais le texte reste présent dans l'OCR brut (Blocks) — on y cherche ce motif
// en dernier recours et on additionne la colonne TVA de chaque taux trouvé.
const LIGNE_TVA_REGEX = /TVA\s*(\d{1,2}(?:[.,]\d+)?)\s*%\s+([\d\s]+[.,]\d{2})\s+([\d\s]+[.,]\d{2})\s+([\d\s]+[.,]\d{2})/gi

function tvaDepuisTexteBrut(blocks: TextractBlock[]): { montant: number | null; lignes: string[] } {
  const lignes = blocks.filter((b) => b.BlockType === "LINE" && b.Text).map((b) => b.Text!)
  let montant: number | null = null
  for (const ligne of lignes) {
    LIGNE_TVA_REGEX.lastIndex = 0
    const m = LIGNE_TVA_REGEX.exec(ligne)
    if (m) {
      const tva = parseAmount(m[3])
      if (tva != null) montant = (montant ?? 0) + tva
    }
  }
  return { montant: montant != null ? Number(montant.toFixed(2)) : null, lignes }
}

function extractFields(result: { ExpenseDocuments?: { SummaryFields?: ExpenseField[]; Blocks?: TextractBlock[] }[] }) {
  const doc = result.ExpenseDocuments?.[0]
  if (!doc) {
    return { tiers: null, date_piece: null, montant_ht: null, montant_tva: null, montant_ttc: null, confiance: "basse" as const }
  }

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
    const { montant, lignes } = tvaDepuisTexteBrut(doc.Blocks ?? [])
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
