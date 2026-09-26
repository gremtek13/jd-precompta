// Edge Function : PROPOSER une catégorie pour UNE pièce, d'après le texte que l'OCR y a lu.
//
// Le bouton « Proposer une catégorie » de la fiche d'une pièce l'appelle, sur un clic, quand aucune
// règle ne connaît le fournisseur. Le contrat vit dans `src/lib/categorisationIa.ts`, recopié plus bas
// au caractère près : une liste FERMÉE de catégories filtrée sur le sens de la pièce, un extrait
// RECOPIÉ du document que le code retrouve dans le texte, et RIEN d'écrit — la fonction propose,
// l'opérateur applique dans la fiche, puis enregistre. Mesuré avant d'être construit (25/09/2026, les
// 42 textes du dossier `test`) : zéro code inventé, zéro inversion de sens, 6 propositions sur 7
// conformes aux décisions déjà prises par le cabinet.
//
// QUI APPELLE : un membre du cabinet qui a accès au dossier de la pièce (`admin_du_dossier`). Un client
// lit les pièces de son dossier mais n'a pas à voir de catégorie (accès client restreint, voir
// CLAUDE.md), et un compte inscrit seul n'est administrateur de rien.
//
// CE QUI SORT D'ICI : la proposition repart vers l'écran qui l'a demandée — l'extrait est un fragment
// d'un document que l'opérateur a déjà sous les yeux. Le JOURNAL, lui, ne porte que les tokens et
// l'issue, JAMAIS l'extrait : un fragment de document peut être un nom de patient (même règle que
// `extract-piece`).
//
// LE COÛT EST JOURNALISÉ, PAS PLAFONNÉ — la décision prise pour `extract-piece`, pour la même raison :
// de l'ordre de 0,003 $ par clic (≈ 1 950 tokens d'entrée mesurés), un clic par pièce que les règles ne
// couvrent pas. Le plafond, distinct de celui de l'assistant, s'ajoutera quand le volume le justifiera ;
// la ligne `[proposer-categorie] …` de `query_logs` est ce qui permettra d'en juger.

import AnthropicBedrock from "npm:@anthropic-ai/bedrock-sdk@0.33.4"
import { createClient } from "npm:@supabase/supabase-js@2"

// Le modèle que la mesure du 25/09/2026 a jugé. En changer demande une NOUVELLE mesure de la
// catégorisation (CLAUDE.md) : `categorisationIaCopie.test.ts` le fige, et vérifie que le harnais
// `evaluer-extraction`, appelé sans argument, mesure bien celui-là.
const MODELE_CATEGORIE = "eu.anthropic.claude-haiku-4-5-20251001-v1:0"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TYPES_PIECE = ["achat", "vente", "note_frais", "autre"]

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

// ── DÉBUT COPIE categorisationIa ────────────────────────────────────────────────────────────────
// Ce bloc est recopié AU CARACTÈRE PRÈS dans les Edge Functions qui en ont besoin (elles sont
// auto-portées). `categorisationIaCopie.test.ts` compare le texte de chaque copie à celui-ci, puis
// l'EXÉCUTE : une copie qui se reformate doit être recopiée, pas « à peu près » tenue à jour. Le bloc
// ne dépend donc de rien d'autre que de lui-même — pas même de `types.ts`.

/** Ce que le modèle voit d'une catégorie : jamais son identifiant, qui ne lui dirait rien. */
export interface CategoriePourIa {
  code: string
  libelle: string
  poste_2035: string | null
  compte_comptable: string | null
}

export type NatureCategorie = 'dépense' | 'recette'

export type IssueProposition =
  // Un code de la liste, justifié par un extrait retrouvé dans le texte : la seule issue proposable.
  | 'retenue'
  // Le modèle rend null : une RÉPONSE, pas une faute — un champ vide se remplit à la main.
  | 'abstention'
  // Un code hors de la liste PROPOSÉE : composé par le modèle, ou pris dans la nature contraire à
  // celle de la pièce — les deux sont rejetés de la même façon, puisque le modèle ne les a pas reçus.
  | 'code inconnu'
  // Un code sans justification, ou une « justification » sans un seul mot : rien à montrer.
  | 'indice manquant'
  // Une justification que le document ne porte pas : composée, comme une citation inventée.
  | 'indice absent du texte'
  // Pas d'objet JSON exploitable dans la réponse.
  | 'réponse illisible'

export interface PropositionVerifiee {
  /** Non nul SEULEMENT quand l'issue est « retenue » : c'est la seule proposition qu'on montre. */
  code: string | null
  /** L'extrait du document, tel que le modèle l'a recopié — ou null. */
  indice: string | null
  issue: IssueProposition
}

// La NATURE se lit au compte, pas au libellé : un plan comptable range les charges en classe 6 et les
// produits en classe 7, c'est un invariant du PCG et non un usage. Une catégorie sans compte n'a pas
// de nature déclarée — on ne la devine pas.
export function natureCategorie(categorie: { compte_comptable: string | null }): NatureCategorie | null {
  const compte = categorie.compte_comptable?.trim() ?? ''
  if (compte.startsWith('6')) return 'dépense'
  if (compte.startsWith('7')) return 'recette'
  return null
}

// LA MÊME NORMALISATION QUE `verifierCitations` pour un tiers (extractionChamps.ts), et un test le
// vérifie : blancs réduits (l'OCR ne les recolle pas de façon stable, et une espace insécable en vaut
// une ordinaire), casse ignorée — mais les ACCENTS CONSERVÉS. Les aplatir laisserait passer un extrait
// que le document ne porte pas, et c'est précisément la frontière entre « recopier » et « ressembler ».
// Jamais de retrait complet des blancs non plus : ce serait souder deux mots voisins, donc fabriquer
// un extrait absent du document.
export function normaliserIndice(texte: string): string {
  return texte.replace(/\s+/g, ' ').trim().toLowerCase()
}

// Le SENS d'une pièce, lu sur son type : une pièce de vente est une recette, un achat ou une note de
// frais une dépense. « autre » ne dit rien, et on ne le devine pas.
export function sensDePiece(typePiece: string | null): NatureCategorie | null {
  if (typePiece === 'vente') return 'recette'
  if (typePiece === 'achat' || typePiece === 'note_frais') return 'dépense'
  return null
}

export interface QuestionCategorisation {
  prompt: string
  /** Les SEULS codes que la vérification acceptera : exactement ceux que le prompt propose. */
  codes: string[]
}

/**
 * La question posée pour UNE pièce : le prompt, et la liste des codes qu'on acceptera en retour —
 * rendus ensemble, pour qu'ils ne puissent pas désigner deux listes différentes.
 *
 * LA LISTE EST FILTRÉE SUR LE SENS DE LA PIÈCE, ET C'EST LA MESURE QUI L'A IMPOSÉ (25/09/2026). Sans
 * ce filtre, 4 factures de télésecrétariat sur 16 ont été proposées en « Ventes / prestations », avec
 * un extrait bien présent sur le document : le fournisseur y facture des « prestations », et le
 * modèle a lu le mot du point de vue de celui qui les VEND. Une charge proposée en recette compte deux
 * fois à l'envers dans le résultat, et la vérification de l'extrait ne peut pas la voir — le mot est
 * bien imprimé. Une catégorie de l'autre nature n'est donc plus proposée du tout ; si le modèle la
 * rend quand même, elle est hors de la liste et rejetée comme un code inventé.
 *
 * Ce que ça coûte, et c'est le sens prudent : une pièce mal typée (une indemnité enregistrée comme
 * achat, le type par défaut) ne reçoit pas de proposition — un clic de plus, contre une recette
 * fabriquée. Le prompt demande alors de rendre null plutôt que de forcer.
 */
export function questionCategorisation(
  categories: readonly CategoriePourIa[], sens: NatureCategorie | null,
): QuestionCategorisation {
  const proposables = sens === null
    ? [...categories]
    : categories.filter((c) => {
      const nature = natureCategorie(c)
      return nature === null || nature === sens
    })
  return { prompt: promptCategorisation(proposables, sens), codes: proposables.map((c) => c.code) }
}

/**
 * Le prompt, construit à partir de la liste des catégories proposables — la liste FERMÉE dans laquelle
 * le modèle doit choisir — et du sens de la pièce. Le texte OCR est ajouté par l'appelant, après
 * `--- TEXTE ---`, comme pour l'extraction des champs. Passer par `questionCategorisation`, qui filtre
 * la liste et rend les codes à accepter avec le prompt.
 *
 * Trois choses y sont dites, et chacune répare une façon connue de se tromper :
 *   - **recopier l'extrait, jamais le reformuler** — c'est la condition de la vérification ;
 *   - **null est une bonne réponse** — sans ça un modèle remplit toujours, et une catégorie plausible
 *     est exactement ce qu'un opérateur pressé valide sans la relire ;
 *   - **la catégorie fourre-tout n'est pas une abstention** — un modèle qui hésite se réfugie dans
 *     « Autre », ce qui a l'air d'une réponse et n'en est pas une.
 *
 * LE SENS DE LA PIÈCE EST DONNÉ, et dit du point de vue du professionnel : une première version ne le
 * donnait pas — `type_piece` vaut « achat » par défaut, donc il paraissait n'apprendre rien — et la
 * mesure l'a démentie (voir `questionCategorisation`). Le type par défaut se trompe rarement ; le
 * modèle, lui, se trompait de point de vue sur un mot aussi courant que « prestations ».
 */
export function promptCategorisation(categories: readonly CategoriePourIa[], sens: NatureCategorie | null): string {
  const lignes = categories.map((c) => {
    const morceaux = [c.code, c.libelle]
    if (c.poste_2035) morceaux.push(`poste 2035 « ${c.poste_2035} »`)
    const nature = natureCategorie(c)
    if (nature) morceaux.push(nature)
    return `- ${morceaux.join(' — ')}`
  })

  const phraseSens = sens === 'dépense'
    ? `Cette pièce est une DÉPENSE du professionnel dont on tient la comptabilité : ce qu'il a acheté ou
payé. Si le document parle de « prestations » ou de « ventes », ce sont celles du fournisseur. Seules
les catégories de dépense sont proposées ; si le document montre au contraire de l'argent reçu (un
remboursement, une indemnité), rends null.\n\n`
    : sens === 'recette'
      ? `Cette pièce est une RECETTE du professionnel dont on tient la comptabilité : de l'argent qu'il a
encaissé. Seules les catégories de recette sont proposées ; si le document montre au contraire une
dépense, rends null.\n\n`
      : ''

  return `Tu classes une pièce comptable française dans UNE catégorie, d'après le texte OCR du document.

${phraseSens}Catégories possibles (code — libellé — poste de la déclaration 2035 — nature) :
${lignes.join('\n')}

Réponds uniquement par un objet JSON à deux clés :
- categorie : le CODE exact d'une catégorie de la liste ci-dessus, ou null.
- indice : quelques mots RECOPIÉS d'une seule ligne du texte, tels qu'ils sont imprimés, qui montrent
  ce qui a été acheté ou encaissé et justifient ce choix ("FOUR MICRO-ONDES", "Abonnement mensuel",
  "Péage"). Pas de phrase de ta main, pas de reformulation, pas de morceaux de lignes différentes
  mis bout à bout. null si categorie est null.

null est une bonne réponse. Rends-le si le texte ne dit pas ce qui a été acheté ou encaissé, ou si
tu hésites entre plusieurs catégories : une catégorie laissée vide se choisit à la main, une
catégorie plausible mais fausse risque d'être validée sans être relue.

Une catégorie fourre-tout (« Autre », « Divers ») est une vraie catégorie, pour ce qu'aucune autre ne
couvre — pas une façon de ne pas choisir.`
}

// LES RÉGLAGES DE L'APPEL FONT PARTIE DE LA QUESTION autant que le prompt : la mesure et la production
// les partagent, donc ils vivent dans ce bloc. La température nulle rend la réponse REPRODUCTIBLE : une
// même pièce redemandée reçoit la même proposition, sans quoi l'opérateur ne saurait laquelle croire.
// CE QU'ELLE NE FAIT PAS, mesuré plutôt que prêté : passer à zéro n'a changé la réponse que d'1 pièce
// sur 42. La dispersion vue sur un même fournisseur (seize factures mensuelles : 3 « Honoraires »,
// 1 « Autre », 12 sans proposition) vient donc des DOCUMENTS, pas du tirage — et c'est aux règles
// apprises de l'effacer (`tiersCategories.ts`) : le modèle n'est interrogé que pour un fournisseur
// qu'aucune règle ne connaît encore.
export const REGLAGES_MODELE = { max_tokens: 300, temperature: 0 } as const

// Un extrait qui ne contient aucun mot ne justifie rien : « € », « 12,00 » ou « N° » se retrouvent
// dans presque tous les textes, donc passeraient la vérification sans rien montrer à l'opérateur.
const UN_MOT = /\p{L}{3,}/u

/**
 * Vérifie la réponse BRUTE du modèle : la lit, contrôle que le code est dans la liste et que
 * l'extrait figure dans le texte source. Rend une seule issue, jamais une proposition « à moitié
 * vraie » : un code juste sans justification n'est pas proposable, parce qu'il n'y aurait rien à
 * montrer à l'opérateur pour qu'il juge.
 */
export function verifierProposition(
  brut: string | null | undefined, codes: readonly string[], texte: string,
): PropositionVerifiee {
  const illisible: PropositionVerifiee = { code: null, indice: null, issue: 'réponse illisible' }

  // Le modèle entoure parfois son objet d'un bloc de code ou d'une phrase : on prend du premier `{`
  // au dernier `}`, comme l'extraction des champs.
  const json = brut?.match(/\{[\s\S]*\}/)?.[0]
  if (!json) return illisible
  // Un texte qui commence par `{` et se lit en JSON est forcément un objet : pas de tableau ni de
  // valeur nue à écarter ici, seulement un JSON invalide.
  let reponse: { categorie?: unknown; indice?: unknown }
  try {
    reponse = JSON.parse(json)
  } catch {
    return illisible
  }
  const { categorie, indice } = reponse

  // Absente, nulle ou vide : le modèle dit qu'il ne tranche pas. Une réponse, pas une faute.
  if (categorie == null || (typeof categorie === 'string' && categorie.trim() === '')) {
    return { code: null, indice: null, issue: 'abstention' }
  }
  if (typeof categorie !== 'string') return illisible

  // La casse n'est pas une invention (« Honoraires » pour « honoraires ») ; tout le reste l'est. Le
  // code rendu est TOUJOURS celui de la liste, jamais la graphie du modèle.
  const demande = categorie.trim()
  const code = codes.find((c) => c === demande) ?? codes.find((c) => c.toLowerCase() === demande.toLowerCase())
  if (!code) return { code: null, indice: null, issue: 'code inconnu' }

  if (typeof indice !== 'string' || !UN_MOT.test(indice)) {
    return { code: null, indice: typeof indice === 'string' ? indice : null, issue: 'indice manquant' }
  }
  if (!normaliserIndice(texte).includes(normaliserIndice(indice))) {
    return { code: null, indice, issue: 'indice absent du texte' }
  }
  return { code, indice, issue: 'retenue' }
}
// ── FIN COPIE categorisationIa ──────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }
  if (req.method !== "POST") {
    return json({ error: "Méthode non autorisée." }, 405)
  }

  const authHeader = req.headers.get("Authorization")
  if (!authHeader) {
    return json({ error: "Non authentifié." }, 401)
  }

  try {
    const supabaseAsCaller = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: appelant, error: erreurAppelant } = await supabaseAsCaller.auth.getUser()
    if (erreurAppelant || !appelant.user) {
      return json({ error: "Non authentifié." }, 401)
    }

    let payload: { pieceId?: unknown; typePiece?: unknown }
    try {
      payload = await req.json()
    } catch {
      return json({ error: "Corps de requête invalide." }, 400)
    }
    const pieceId = typeof payload.pieceId === "string" ? payload.pieceId.trim() : ""
    if (!UUID.test(pieceId)) {
      return json({ error: "pieceId : l'identifiant d'une pièce est attendu." }, 400)
    }

    // TOUT SE LIT AVEC LE JETON DE L'APPELANT : la fonction n'écrit rien et n'a besoin d'aucun
    // privilège de plus que lui — la RLS dit déjà ce qu'il peut voir.
    const { data: piece, error: erreurPiece } = await supabaseAsCaller
      .from("pieces")
      .select("id, dossier_id, type_piece")
      .eq("id", pieceId)
      .maybeSingle()
    if (erreurPiece) {
      return json({ error: `Lecture de la pièce impossible : ${erreurPiece.message}` }, 500)
    }
    // L'identifiant du dossier finit dans un filtre PostgREST écrit en texte : il doit en être un.
    if (!piece || !UUID.test(piece.dossier_id)) {
      return json({ error: "Pièce introuvable." }, 404)
    }

    // Un CLIENT lit les pièces de son dossier — ses propres dépôts — : la RLS ne suffit donc pas à dire
    // qu'on est du cabinet. Même contrôle que les autres fonctions d'un dossier.
    const { data: aAcces, error: erreurAcces } = await supabaseAsCaller
      .rpc("admin_du_dossier", { p_dossier_id: piece.dossier_id })
    if (erreurAcces) {
      return json({ error: `Contrôle d'accès impossible : ${erreurAcces.message}` }, 500)
    }
    if (!aAcces) {
      return json({ error: "Pièce introuvable." }, 404)
    }

    const [lecture, lues] = await Promise.all([
      supabaseAsCaller.from("piece_textes_ocr").select("texte").eq("piece_id", piece.id).maybeSingle(),
      // Celles du cabinet (dossier_id nul) et celles de CE dossier : l'appelant peut en administrer
      // d'autres, dont les catégories propres n'ont rien à faire dans la question. Lues avec leur compte
      // annoncé : tronquée, la liste changerait la question posée au modèle sans le dire.
      supabaseAsCaller
        .from("categories")
        .select("id, code, libelle, poste_2035, compte_comptable, dossier_id", { count: "exact" })
        .or(`dossier_id.is.null,dossier_id.eq.${piece.dossier_id}`)
        .order("ordre")
        .order("id"),
    ])
    if (lecture.error) {
      return json({ error: `Lecture du texte de la pièce impossible : ${lecture.error.message}` }, 500)
    }
    if (lues.error) {
      return json({ error: `Lecture des catégories impossible : ${lues.error.message}` }, 500)
    }
    const texte: string = lecture.data?.texte ?? ""
    // Pas de texte, rien à citer : le modèle n'est pas appelé, donc rien n'est facturé.
    if (!texte.trim()) {
      return json({ error: "Cette pièce n'a pas de texte lu : relancez d'abord « Retrouver le texte lu »." }, 422)
    }
    const categories = lues.data ?? []
    if (categories.length !== lues.count) {
      return json({ error: "Les catégories n'ont été lues qu'en partie : la question posée au modèle serait amputée." }, 500)
    }

    // Une catégorie propre au dossier l'emporte sur celle du cabinet qui porterait le même code — la
    // règle du harnais de mesure, pour que la production pose la question qui a été mesurée.
    const parCode = new Map()
    for (const c of categories) if (!c.dossier_id) parCode.set(c.code, c)
    for (const c of categories) if (c.dossier_id) parCode.set(c.code, c)
    const liste = [...parCode.values()]

    // Le type AFFICHÉ dans la fiche, s'il est donné : l'opérateur a pu le corriger sans avoir encore
    // enregistré, et c'est le sens qu'il a sous les yeux qui filtre la liste.
    const type = typeof payload.typePiece === "string" && TYPES_PIECE.includes(payload.typePiece)
      ? payload.typePiece
      : piece.type_piece
    const { prompt, codes } = questionCategorisation(liste, sensDePiece(type))

    // Même région que la lecture et la citation des champs : le texte d'un document sort au même
    // endroit que le document, et `edgeFunctionsRegions.test.ts` le garde.
    const client = new AnthropicBedrock({
      awsRegion: Deno.env.get("AWS_REGION") ?? "eu-central-1",
      awsAccessKey: Deno.env.get("AWS_ACCESS_KEY_ID"),
      awsSecretKey: Deno.env.get("AWS_SECRET_ACCESS_KEY"),
    })
    const reponse = await client.messages.create({
      model: MODELE_CATEGORIE,
      ...REGLAGES_MODELE,
      messages: [{ role: "user", content: `${prompt}\n\n--- TEXTE ---\n${texte}` }],
    })
    const brut = reponse.content.find((b: { type: string }) => b.type === "text")?.text
    const verifiee = verifierProposition(brut, codes, texte)
    // Les tokens et l'issue, JAMAIS l'extrait — voir l'en-tête.
    console.log(
      `[proposer-categorie] ${MODELE_CATEGORIE} — ${reponse.usage?.input_tokens ?? 0} tokens entrée, `
        + `${reponse.usage?.output_tokens ?? 0} tokens sortie, issue : ${verifiee.issue}`,
    )

    // L'identifiant, pas le code : c'est lui que la fiche pose dans son champ. Et l'extrait ne repart
    // QU'AVEC une proposition retenue — un extrait rejeté est ce que la vérification vient d'écarter.
    const retenue = verifiee.code ? liste.find((c) => c.code === verifiee.code) : undefined
    return json({
      issue: verifiee.issue,
      categorieId: retenue?.id ?? null,
      indice: retenue ? verifiee.indice : null,
    })
  } catch (err) {
    console.error("[proposer-categorie]", err)
    return json({ error: err instanceof Error ? err.message : "La proposition n'a pas pu être obtenue." }, 500)
  }
})
