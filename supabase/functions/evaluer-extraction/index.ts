// ESSAI DE MESURE — pas une fonctionnalité. À rejouer, pas à lire.
//
// Elle répond à DEUX questions, chacune décisive pour une marche de l'extraction :
//   - « extraction » (celle d'origine, et la question par défaut) : un modèle qui lit le texte OCR
//     extrait-il les champs d'une pièce aussi bien que l'étiquetage d'AnalyzeExpense, qu'on paie près
//     de sept fois le prix de l'OCR seul ?
//   - « categorie » (25/09/2026) : le même modèle, sur le même texte, propose-t-il une catégorie
//     comptable FONDÉE — prise dans la liste du dossier et justifiée par un extrait du document — et
//     retrouve-t-il les choix que le cabinet a déjà faits ? Voir `src/lib/categorisationIa.ts`.
//
// ELLE N'EST OUVERTE QUE PENDANT UNE FENÊTRE DATÉE, ET C'EST UNE CORRECTION DE SÉCURITÉ (25/09/2026).
// Le dépôt est PUBLIC : le nom de cette fonction, l'identifiant du dossier `test` (écrit en clair dans
// `supabase/essais/`) et la clé publique du projet (servie avec l'application) sont à la portée de
// n'importe qui. Jusqu'à cette date, n'importe qui pouvait donc lancer cet essai et faire payer au
// cabinet un appel au modèle par pièce, en boucle. `verify_jwt` n'y changeait rien : la clé publique
// EST un jeton valide. Hors de la fenêtre, la fonction ne répond plus qu'à `limite: 0`, qui ne
// facture rien. La rouvrir est un acte délibéré — changer la date de `ESSAI_OUVERT_JUSQU_A` puis
// redéployer, avec la comparaison avant écrasement et l'aller-retour de tout déploiement — et une
// fenêtre ne se POUSSE jamais ouverte : `categorisationIaCopie.test.ts` refuse une date à venir.
//
// POURQUOI UNE EDGE FUNCTION ET PAS UN SCRIPT. Les textes OCR de ce dossier portent des noms de
// patients (bordereaux de télétransmission, feuilles de soins). Ils ne doivent donc jamais quitter
// l'infrastructure ni remonter dans une conversation. La mesure se fait ici, côté serveur, et ne
// rend que des COMPTES, des citations non nominatives — montants, devises et dates — et des codes
// de catégorie : jamais un tiers, jamais un nom de fichier, jamais un fragment de texte.
//
// Auto-portée : `verifierCitations` y est recopiée de `src/lib/extractionChamps.ts`, et
// `extractionChampsCopie.test.ts` EXÉCUTE les deux copies l'une contre l'autre ; le bloc de
// `src/lib/categorisationIa.ts` y est recopié au caractère près, et `categorisationIaCopie.test.ts`
// le compare puis l'exécute.
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
// LE DÉFAUT SUIT LA PRODUCTION, et `extractionChampsCopie.test.ts` le garde. Un `modele` passé en
// paramètre le remplace — c'est la raison d'être de ce harnais, comparer deux modèles — mais ce
// qu'il fait SANS argument doit rester « mesurer ce que la production exécute ». Même famille que la
// région ci-dessus : un harnais qui dérive de la production cesse de la mesurer, et son résultat ne
// le dit pas, il reste plausible.
//
// Pour ne pas les rechercher : les formes courtes `eu.anthropic.claude-haiku-4-5` et
// `eu.anthropic.claude-sonnet-5` rendent une `ValidationException` (« The provided model identifier
// is invalid »). Seule la forme datée complète passe, alors que `eu.anthropic.claude-sonnet-4-6`
// fonctionne sans suffixe : les deux conventions coexistent.
const MODELE_PAR_DEFAUT = "eu.anthropic.claude-haiku-4-5-20251001-v1:0"

// La fenêtre pendant laquelle l'essai facture (voir l'en-tête). Au-delà, seul `limite: 0` répond.
const ESSAI_OUVERT_JUSQU_A = "2026-09-25T19:30:00Z"

// La question « categorie » interroge le modèle QUATRE pièces à la fois : une à une, un dossier de
// quarante pièces frôlerait le mur de la plateforme (150 s), qui coupe sans rien rendre. Et elle
// s'arrête d'elle-même avant ce mur, en DISANT combien de pièces elle n'a pas traitées.
const EN_PARALLELE = 4
const BUDGET_MS = 100_000

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

// ── LA QUESTION « categorie » ─────────────────────────────────────────────────────────────────────
// Ce qui remonte, comme pour l'extraction : des CODES de catégorie, des issues, des longueurs et des
// booléens. JAMAIS l'extrait lui-même — c'est un fragment du document, donc possiblement un nom de
// patient —, jamais le tiers, jamais un nom de fichier. La justesse se juge ensuite, hors d'ici, en
// rapprochant ces codes des choix que le cabinet a déjà faits.
async function mesurerCategorisation(supabase, client, dossierId, modele, limite) {
  // Les catégories proposables : celles du cabinet (dossier_id nul) et celles du dossier. Lues avec
  // leur compte annoncé : tronquée, la liste changerait la question posée au modèle sans le dire.
  const { data: categories, error: erreurCategories, count } = await supabase
    .from("categories")
    .select("id, code, libelle, poste_2035, compte_comptable, dossier_id", { count: "exact" })
    .or(`dossier_id.is.null,dossier_id.eq.${dossierId}`)
    .order("ordre")
    .order("id")
  if (erreurCategories) return { error: erreurCategories.message }
  const lues = categories ?? []
  if (lues.length !== count) return { error: "catégories lues en partie" }

  // Une catégorie propre au dossier l'emporte sur celle du cabinet qui porterait le même code.
  const parCode = new Map()
  for (const c of lues) if (!c.dossier_id) parCode.set(c.code, c)
  for (const c of lues) if (c.dossier_id) parCode.set(c.code, c)
  const liste = [...parCode.values()]
  const codeDe = new Map(lues.map((c) => [c.id, c.code]))

  const { data: lignes, error } = await supabase
    .from("piece_textes_ocr")
    .select("piece_id, texte, pieces!inner(id, dossier_id, type_piece, tiers, categorie_id)")
    .eq("pieces.dossier_id", dossierId)
    .not("piece_id", "is", null)
    .order("piece_id")
    .limit(limite)
  if (error) return { error: error.message }

  const toutes = lignes ?? []
  const debut = Date.now()
  const issues = {}
  const parPiece = []
  let echecs = 0
  let nonTraitees = 0
  let tokensEntree = 0
  let tokensSortie = 0

  for (let i = 0; i < toutes.length; i += EN_PARALLELE) {
    if (Date.now() - debut > BUDGET_MS) {
      nonTraitees = toutes.length - i
      break
    }
    await Promise.all(toutes.slice(i, i + EN_PARALLELE).map(async (ligne) => {
      const piece = ligne.pieces
      try {
        // La question dépend du SENS de la pièce : une dépense ne se voit proposer que des catégories
        // de dépense (voir `questionCategorisation`).
        const { prompt, codes } = questionCategorisation(liste, sensDePiece(piece.type_piece))
        const reponse = await client.messages.create({
          model: modele,
          ...REGLAGES_MODELE,
          messages: [{ role: "user", content: `${prompt}\n\n--- TEXTE ---\n${ligne.texte}` }],
        })
        tokensEntree += reponse.usage?.input_tokens ?? 0
        tokensSortie += reponse.usage?.output_tokens ?? 0

        const brut = reponse.content.find((b) => b.type === "text")?.text
        const verifiee = verifierProposition(brut, codes, ligne.texte)
        issues[verifiee.issue] = (issues[verifiee.issue] ?? 0) + 1

        // Un extrait qui n'est qu'un morceau du nom du fournisseur ne dit pas ce qui a été acheté :
        // compté à part, parce que c'est la justification la plus faible qu'on puisse montrer.
        const tiers = normaliserIndice(piece.tiers ?? "")
        const indice = verifiee.indice ? normaliserIndice(verifiee.indice) : ""
        const categorie = liste.find((c) => c.code === verifiee.code)
        parPiece.push({
          pieceId: piece.id,
          sens: piece.type_piece,
          categorieActuelle: codeDe.get(piece.categorie_id) ?? null,
          proposition: verifiee.code,
          issue: verifiee.issue,
          natureProposee: categorie ? natureCategorie(categorie) : null,
          indiceLongueur: verifiee.indice?.length ?? null,
          indiceDansLeFournisseur: Boolean(indice && tiers && tiers.includes(indice)),
        })
      } catch (err) {
        echecs++
        console.error("[evaluer-extraction] catégorie", piece?.id, err)
      }
    }))
  }

  return {
    question: "categorie",
    region: REGION,
    modele,
    categories: liste.length,
    pieces: toutes.length,
    nonTraitees,
    echecs,
    issues,
    tokens: { entree: tokensEntree, sortie: tokensSortie },
    parPiece,
  }
}

Deno.serve(async (req) => {
  try {
    const { dossierId, question = "extraction", modele = MODELE_PAR_DEFAUT, limite = 100 } = await req.json()
    if (!dossierId) return Response.json({ error: "dossierId manquant" }, { status: 400 })
    // Un identifiant qui n'en est pas un n'a rien à faire dans un filtre PostgREST écrit en texte.
    if (!/^[0-9a-f-]{36}$/i.test(String(dossierId))) {
      return Response.json({ error: "dossierId : un uuid" }, { status: 400 })
    }
    if (question !== "extraction" && question !== "categorie") {
      return Response.json({ error: "question : « extraction » ou « categorie »" }, { status: 400 })
    }
    if (!Number.isInteger(limite) || limite < 0) {
      return Response.json({ error: "limite : un entier positif ou nul" }, { status: 400 })
    }
    if (limite > 0 && Date.now() > Date.parse(ESSAI_OUVERT_JUSQU_A)) {
      return Response.json({
        error: `Essai fermé depuis le ${ESSAI_OUVERT_JUSQU_A} (UTC). Seul un appel avec \`limite: 0\`, `
          + "qui ne facture rien, reste possible ; rouvrir l'essai demande de changer cette date et de redéployer.",
      }, { status: 403 })
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL"),
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
    )

    if (question === "categorie") {
      const client = new AnthropicBedrock({
        awsRegion: REGION,
        awsAccessKey: Deno.env.get("AWS_ACCESS_KEY_ID"),
        awsSecretKey: Deno.env.get("AWS_SECRET_ACCESS_KEY"),
      })
      const resultat = await mesurerCategorisation(supabase, client, dossierId, modele, limite)
      return Response.json(resultat, { status: "error" in resultat ? 500 : 200 })
    }

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
