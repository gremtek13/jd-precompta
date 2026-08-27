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

import { TextractClient, AnalyzeExpenseCommand } from "npm:@aws-sdk/client-textract@3"

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

function parseAmount(raw?: string): number | null {
  if (!raw) return null
  const n = parseFloat(raw.replace(/[^0-9.,-]/g, "").replace(",", "."))
  return Number.isNaN(n) ? null : n
}

function parseDate(raw?: string): string | null {
  if (!raw) return null
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

function extractFields(result: { ExpenseDocuments?: { SummaryFields?: ExpenseField[] }[] }) {
  const doc = result.ExpenseDocuments?.[0]
  if (!doc) {
    return { tiers: null, date_piece: null, montant_ht: null, montant_tva: null, montant_ttc: null, confiance: "basse" as const }
  }

  const summary: Record<string, { text: string; confidence: number }> = {}
  for (const field of doc.SummaryFields ?? []) {
    const type = field.Type?.Text
    const text = field.ValueDetection?.Text
    const confidence = field.ValueDetection?.Confidence ?? 0
    if (type && text) summary[type] = { text, confidence }
  }

  const total = summary["TOTAL"]
  const vendor = summary["VENDOR_NAME"]
  const date = summary["INVOICE_RECEIPT_DATE"]
  const tax = summary["TAX"]

  const montantTtc = parseAmount(total?.text)
  const montantTva = parseAmount(tax?.text)

  const confidences = [total, vendor, date].filter((f): f is { text: string; confidence: number } => !!f).map((f) => f.confidence)
  const avgConfidence = confidences.length ? confidences.reduce((a, b) => a + b, 0) / confidences.length : 0

  return {
    tiers: vendor?.text ?? null,
    date_piece: parseDate(date?.text),
    montant_ttc: montantTtc,
    montant_tva: montantTva,
    montant_ht: montantTtc != null && montantTva != null ? Number((montantTtc - montantTva).toFixed(2)) : null,
    confiance: avgConfidence >= 90 ? "haute" as const : avgConfidence >= 70 ? "moyenne" as const : "basse" as const,
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

    const result = await client.send(new AnalyzeExpenseCommand({ Document: { Bytes: fileBytes } }))

    return json(extractFields(result))
  } catch (err) {
    console.error(err)
    // Textract AnalyzeExpense ne traite que les PDF d'une page ou les images (JPEG/PNG/TIFF) —
    // un PDF multi-pages échoue ici, l'utilisateur remplit alors le formulaire manuellement.
    return json({ error: err instanceof Error ? err.message : "Échec de l'extraction automatique." }, 500)
  }
})
