// ESSAI DE MESURE — pas une fonctionnalité. À rejouer, pas à lire.
//
// Elle répond à UNE question, celle qui décide de la « marche 1 » : un modèle qui lit le texte OCR
// extrait-il les champs d'une pièce aussi bien que l'étiquetage d'AnalyzeExpense, qu'on paie près de
// sept fois le prix de l'OCR seul ?
//
// POURQUOI UNE EDGE FUNCTION ET PAS UN SCRIPT. Les textes OCR de ce dossier portent des noms de
// patients (bordereaux de télétransmission, feuilles de soins). Ils ne doivent donc jamais quitter
// l'infrastructure ni remonter dans une conversation. La mesure se fait ici, côté serveur, et ne
// rend que des COMPTES et des citations non nominatives — montants, devises et dates, jamais un
// tiers, jamais un nom de fichier, jamais un fragment de texte.
//
// Auto-portée : `verifierCitations` y est recopiée de `src/lib/extractionChamps.ts`, et
// `extractionChampsCopie.test.ts` EXÉCUTE les deux copies l'une contre l'autre.
//
// ELLE NE VÉRIFIE AUCUN PLAFOND DE COÛT IA, et c'est acceptable pour un essai lancé à la main —
// mais ce ne doit PAS devenir le motif en production : l'extraction et l'assistant comptable ont
// besoin de deux compteurs distincts, sinon 5 000 documents par mois feraient sauter le plafond de
// l'assistant sans que personne comprenne pourquoi.

import AnthropicBedrock from "npm:@anthropic-ai/bedrock-sdk@0.33.4"
import { createClient } from "npm:@supabase/supabase-js@2"

// LA MÊME RÉGION QUE LA PRODUCTION, ET PAS UNE AUTRE — écrite exactement comme dans
// `extract-piece`, dont c'est le chemin qu'on mesure. Deux raisons, et la seconde n'est pas celle
// qu'on croit d'abord :
//   1. RGPD. Cet essai envoie le TEXTE OCR INTÉGRAL de chaque pièce au modèle, noms de patients
//      compris. Mesurer ailleurs, c'est faire sortir les mêmes données vers une autre juridiction
//      que celle que le registre annonce.
//   2. La DISPONIBILITÉ D'UN MODÈLE EST PAR RÉGION. Un profil d'inférence joignable ici et pas là
//      est le cas normal, pas l'exception — `agent-comptable` câble eu-west-1 en dur précisément
//      parce que son modèle n'y était proposé que là. Une mesure faite dans une région que la
//      production n'utilise pas prouve donc la disponibilité AILLEURS, ce qui ne décide rien.
// Gardée par `edgeFunctionsRegions.test.ts`, qui lit cette source.
const REGION = Deno.env.get("AWS_REGION") ?? "eu-central-1"
const MODELE_PAR_DEFAUT = "eu.anthropic.claude-sonnet-4-6"

// ── DÉBUT COPIE extractionChamps ────────────────────────────────────────────────────────────────
// Recopié de `src/lib/extractionChamps.ts` (Edge Function auto-portée : aucun import de `src/`).
//
// ÉCRIT SANS ANNOTATIONS DE TYPE, DÉLIBÉRÉMENT. C'est ce qui permet à `extractionChampsCopie.test.ts`
// d'EXTRAIRE ce bloc et de l'EXÉCUTER contre l'original, plutôt que de le relire. Un garde-fou qui
// compare deux comportements attrape une dérive ; un qui compare deux textes attrape un reformatage.
const CHAMPS_CITES = ["tiers", "date", "devise", "totalTtc", "totalHt", "totalTva"]
const CHAMPS_MONTANT = ["totalTtc", "totalHt", "totalTva"]

function normaliser(texte) {
  return texte.replace(/\s+/g, " ").trim().toLowerCase()
}

function verifierCitations(citations, texte) {
  const normalise = normaliser(texte)
  const sansBlancs = normalise.replace(/\s/g, "")
  const retenues = {}
  const rejetees = []

  for (const champ of CHAMPS_CITES) {
    const citation = citations[champ]
    if (citation == null) continue
    if (citation.trim() === "") {
      rejetees.push({ champ, citation, motif: "citation vide" })
      continue
    }
    const cible = normaliser(citation)
    const trouvee = normalise.includes(cible)
      || (CHAMPS_MONTANT.includes(champ) && sansBlancs.includes(cible.replace(/\s/g, "")))
    if (trouvee) retenues[champ] = citation
    else rejetees.push({ champ, citation, motif: "absente du texte" })
  }
  return { retenues, rejetees }
}
// ── FIN COPIE extractionChamps ──────────────────────────────────────────────────────────────────

const PROMPT = `Tu lis le texte OCR d'un document comptable français et tu en extrais six champs.

RÈGLE ABSOLUE : tu RECOPIES des extraits du texte, tu ne calcules ni ne reformules jamais.
Rends chaque champ exactement tel qu'il est imprimé, espaces et symboles compris ("1 234,56 €",
"1er juin 2025"). N'ajoute pas de zéro, ne convertis pas de format, ne corrige pas une faute.

Si un champ n'apparaît pas dans le texte, rends null. C'est une bonne réponse : une valeur absente
se corrige à la main, une valeur inventée passe inaperçue et fausse une déclaration.

- tiers : la raison sociale de l'ÉMETTEUR du document (le fournisseur), pas le destinataire.
- date : la date d'ÉMISSION du document. Pas l'échéance, pas la date de règlement, pas une période
  de validité, pas une date de mention légale.
- devise : le symbole ou le code monétaire tel qu'il accompagne les montants ("€", "EUR", "$",
  "USD"). Si le document n'en porte aucun, rends null.
- totalTtc : le montant total toutes taxes comprises.
- totalHt : le total hors taxes.
- totalTva : le montant de TVA. S'il y a plusieurs taux, rends null — le total sera recalculé.

Réponds uniquement par un objet JSON avec ces six clés.`

Deno.serve(async (req) => {
  try {
    const { dossierId, modele = MODELE_PAR_DEFAUT, limite = 100 } = await req.json()
    if (!dossierId) return Response.json({ error: "dossierId manquant" }, { status: 400 })

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL"),
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
    )

    const { data: lignes, error } = await supabase
      .from("piece_textes_ocr")
      .select("piece_id, texte, pieces!inner(id, dossier_id, statut, date_piece, montant_ttc, montant_ht, montant_tva, devise, montant_devise)")
      .eq("pieces.dossier_id", dossierId)
      .not("piece_id", "is", null)
      .limit(limite)
    if (error) return Response.json({ error: error.message }, { status: 500 })

    const client = new AnthropicBedrock({
      awsRegion: REGION,
      awsAccessKey: Deno.env.get("AWS_ACCESS_KEY_ID"),
      awsSecretKey: Deno.env.get("AWS_SECRET_ACCESS_KEY"),
    })

    const couverture = { tiers: 0, date: 0, devise: 0, totalTtc: 0, totalHt: 0, totalTva: 0 }
    const rejets = { tiers: 0, date: 0, devise: 0, totalTtc: 0, totalHt: 0, totalTva: 0 }
    const parPiece = []
    let echecs = 0
    let tokensEntree = 0
    let tokensSortie = 0

    for (const ligne of lignes ?? []) {
      const piece = ligne.pieces
      try {
        const reponse = await client.messages.create({
          model: modele,
          max_tokens: 500,
          messages: [{ role: "user", content: `${PROMPT}\n\n--- TEXTE ---\n${ligne.texte}` }],
        })
        tokensEntree += reponse.usage?.input_tokens ?? 0
        tokensSortie += reponse.usage?.output_tokens ?? 0

        const brut = reponse.content.find((b) => b.type === "text")
        const json = brut?.text?.match(/\{[\s\S]*\}/)?.[0]
        if (!json) { echecs++; continue }
        const { retenues, rejetees } = verifierCitations(JSON.parse(json), ligne.texte)

        for (const champ of CHAMPS_CITES) if (retenues[champ]) couverture[champ]++
        for (const r of rejetees) rejets[r.champ]++

        // Ce qui remonte : des montants, des devises, des dates, des booléens. JAMAIS le tiers (sur
        // ce dossier un tiers lu vaut parfois le nom du client lui-même), jamais le nom de fichier,
        // jamais un fragment de texte.
        parPiece.push({
          pieceId: piece.id,
          validee: piece.statut === "validee",
          tiersFonde: Boolean(retenues.tiers),
          dateCitee: retenues.date ?? null,
          dateStockee: piece.date_piece,
          deviseCitee: retenues.devise ?? null,
          deviseStockee: piece.devise,
          ttcCite: retenues.totalTtc ?? null,
          ttcStocke: piece.montant_ttc,
          montantDeviseStocke: piece.montant_devise,
          htCite: retenues.totalHt ?? null,
          tvaCitee: retenues.totalTva ?? null,
          rejets: rejetees.map((r) => ({ champ: r.champ, motif: r.motif })),
        })
      } catch (err) {
        echecs++
        console.error("[evaluer-extraction]", piece?.id, err)
      }
    }

    return Response.json({
      // RENDUE, et c'est le point : le secret `AWS_REGION` l'emporte sur le repli ci-dessus, et
      // aucun fichier du dépôt ne peut dire sa valeur. Un commentaire d'une autre fonction
      // l'affirme (« eu-central-1 »), mais un commentaire est une déclaration, pas une mesure.
      // Appelée avec `limite: 0`, cette fonction répond donc à la question sans rien facturer.
      region: REGION,
      modele,
      pieces: (lignes ?? []).length,
      echecs,
      couverture,
      rejets,
      tokens: { entree: tokensEntree, sortie: tokensSortie },
      parPiece,
    })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
})
