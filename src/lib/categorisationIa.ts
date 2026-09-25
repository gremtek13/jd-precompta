// Proposition d'une CATÉGORIE comptable par un modèle de langage, d'après le TEXTE OCR d'une pièce.
//
// POURQUOI CE MODULE EXISTE. Les règles tiers → catégorie (`tiersCategories.ts`) n'apprennent
// qu'après un premier arbitrage, et ne disent rien d'un fournisseur inconnu. Le nom du fournisseur ne
// dit d'ailleurs pas toujours ce qui a été acheté : « BOULANGER MARSEILLE » peut être un four de salle
// d'attente comme un cadeau. Le texte du document, lui, le dit — « FOUR MICRO-ONDES » — et il est
// conservé depuis le 18/09/2026 (`piece_textes_ocr`).
//
// LE MÊME CONTRAT QUE L'EXTRACTION DES CHAMPS (`extractionChamps.ts`) : le modèle DÉSIGNE, le code
// VÉRIFIE, l'humain TRANCHE.
//   1. Il choisit dans une liste FERMÉE, par code. Un code hors de la liste est une invention : rejeté.
//   2. Il JUSTIFIE son choix par un extrait RECOPIÉ du document, que le code retrouve dans le texte.
//      Une justification composée est rejetée comme une citation inventée. C'est aussi ce qui rend la
//      proposition vérifiable d'un coup d'œil : « proposée parce que le document dit
//      "FOUR MICRO-ONDES" » se juge en une seconde, là où une catégorie nue se croit ou se refait.
//   3. Rien n'est écrit sans le clic de l'opérateur, comme toute proposition de ce projet.
//
// CE QUE LA VÉRIFICATION NE PROUVE PAS, écrit plutôt que laissé croire : qu'un extrait retrouvé
// justifie VRAIMENT la catégorie choisie. « FOUR MICRO-ONDES » est bien sur le document ; que ce soit
// un achat courant ou une immobilisation reste un arbitrage. La vérification garantit que la
// proposition repose sur le document et non sur une invention — la justesse, c'est l'humain qui la
// juge, et c'est pourquoi l'extrait lui est montré.
//
// Ce module ne parle à personne : ni Supabase, ni réseau, ni DOM. Le harnais de mesure
// (`evaluer-extraction`) en porte une copie auto-portée, et `categorisationIaCopie.test.ts` la garde.

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
