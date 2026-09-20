// Extraction des champs d'une pièce à partir de son TEXTE OCR, par un modèle de langage.
//
// POURQUOI CE MODULE EXISTE. `AnalyzeExpense` (Textract) fait deux choses : il lit le texte, et il
// tente d'ÉTIQUETER des champs. La seconde est irrégulière au point d'être peu exploitable —
// `INVOICE_RECEIPT_DATE` n'est sorti que sur 4 factures sur 22 d'un même fournisseur, alors que la
// date était lue dans tous les cas. Le projet a donc dû construire un repli sur texte brut pour
// chaque champ qui compte, et c'est ce repli qui travaille en pratique. On paie le tarif fort
// (10 $/1000 pages contre 1,50 $ pour l'OCR seul) pour un étiquetage qu'on contourne déjà.
//
// LA DÉCISION QUI GOUVERNE TOUT LE RESTE : **le modèle CITE, il ne calcule jamais.**
//
// Il ne rend pas `1234.56`, il rend la chaîne telle qu'imprimée sur le document : `"1 234,56 €"`.
// Le code vérifie ensuite que cette chaîne figure bien dans le texte source, puis la passe aux
// analyseurs déjà éprouvés du projet (`parseMontantBancaire`, `parseDate`). Trois conséquences, et
// c'est ce qui rend l'approche acceptable sur une chaîne qui finit en 2035 et en FEC :
//
//   1. **Une valeur inventée ne passe pas.** Un montant composé par le modèle n'est nulle part dans
//      le texte : il est rejeté. Le fondement de cette garantie est une mesure, pas une intuition —
//      sur le dossier `test`, 39 pièces sur 39 portant un montant l'écrivent mot pour mot dans leur
//      propre texte OCR (voir CLAUDE.md, « un contrôle à l'envers »).
//   2. **Aucun arrondi, aucun format, aucun fuseau ne dépend du modèle.** Ces règles sont déjà
//      écrites et testées ailleurs ; les lui confier serait les réécrire une troisième fois — ce que
//      ce dépôt refuse par principe (« un montant n'est jamais analysé deux fois »).
//   3. **Ça se mesure sans vérité terrain.** Un champ cité et retrouvé dans le texte est FONDÉ,
//      qu'on sache ou non s'il est le bon. Sur ce dossier, 11 pièces seulement sont validées à la
//      main : un score de justesse n'y aurait aucune portée, une couverture de champs fondés, si.
//
// Ce module ne parle à personne : ni Supabase, ni réseau, ni DOM. Il tient le CONTRAT et la
// VÉRIFICATION ; l'appel au modèle et l'analyse des citations retenues vivent chez l'appelant.

/** Les champs que le modèle a le droit de citer. Rien d'autre ne lui est demandé. */
export type ChampCite = 'tiers' | 'date' | 'devise' | 'totalTtc' | 'totalHt' | 'totalTva'

export const CHAMPS_CITES: readonly ChampCite[] = ['tiers', 'date', 'devise', 'totalTtc', 'totalHt', 'totalTva']

// LA DEVISE EST UN CHAMP, PAS UN DÉTAIL — et c'est la mesure sur les 41 pièces réelles qui l'a
// imposé, pas la relecture. Quatre factures du dossier portent « 24.00 » en DOLLARS ; la base y
// stocke 20,68 / 20,60 / 20,52 / 20,44 €, quatre conversions au taux BCE du jour. Le modèle citait
// 24,00 — ce qui est juste, c'est ce qui est imprimé — et sans la devise l'appelant aurait écrit
// 24 dans `montant_ttc` au lieu de `montant_devise` : 16 % d'erreur sur chaque facture étrangère,
// en silence, sur des charges qui partent en 2035.
// Son contrôle verbatim est FAIBLE, et il faut le savoir : « € » figure dans presque tous les
// textes. Il garantit que le symbole est présent, rien de plus. La vraie protection est ailleurs —
// l'appelant confronte la devise citée aux colonnes `devise`/`montant_devise` déjà prévues.

// Les trois champs dont la citation est un NOMBRE. Ils bénéficient d'une seconde passe plus
// tolérante (voir `verifierCitations`) ; `tiers` et `date` non.
const CHAMPS_MONTANT: readonly ChampCite[] = ['totalTtc', 'totalHt', 'totalTva']

/**
 * Ce que le modèle rend : pour chaque champ, la chaîne TELLE QU'IMPRIMÉE sur le document, ou `null`
 * s'il ne la trouve pas. `null` est une réponse légitime et attendue — bien meilleure qu'une valeur
 * plausible, puisqu'une pièce sans montant se voit et se corrige, là qu'un montant faux voyage.
 */
export type CitationsChamps = Partial<Record<ChampCite, string | null>>

export type MotifRejet =
  // La citation ne se retrouve pas dans le texte source : le modèle l'a composée.
  | 'absente du texte'
  // Le modèle a rendu une chaîne vide plutôt que `null` — à distinguer d'une absence franche, parce
  // que l'une est un défaut de format et l'autre une réponse.
  | 'citation vide'

export interface VerificationCitations {
  /** Les citations retrouvées dans le texte, prêtes à être analysées par l'appelant. */
  retenues: Partial<Record<ChampCite, string>>
  /** Ce qui a été écarté, et pourquoi — jamais en silence : c'est ce qui permet de diagnostiquer. */
  rejetees: { champ: ChampCite; citation: string; motif: MotifRejet }[]
}

// L'OCR ne recolle pas les blancs de façon stable, et une facture imprime volontiers ses montants
// avec une espace insécable ou fine insécable. `\s` en JavaScript couvre déjà U+00A0 et U+202F, donc
// tout blanc devient une espace simple des deux côtés.
//
// La casse est ignorée : le modèle peut normaliser une capitale en recopiant, et ce n'est pas une
// invention. Les ACCENTS, eux, sont conservés — les aplatir laisserait passer une citation que le
// document ne porte pas, et c'est précisément ce qu'on cherche à empêcher.
function normaliser(texte: string): string {
  return texte.replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * Vérifie que chaque citation figure réellement dans le texte source.
 *
 * Deux passes, et l'asymétrie entre elles est délibérée :
 *
 *   1. Blancs normalisés, casse ignorée — la passe normale, pour tous les champs.
 *   2. Blancs ENTIÈREMENT retirés — réservée aux montants. Le séparateur de milliers est une
 *      information de présentation : « 1 234,56 » et « 1234,56 » désignent le même nombre, et un
 *      modèle qui recopie sans l'espace n'a rien inventé. Cette tolérance n'ouvre aucune porte,
 *      puisque les chiffres doivent toujours être présents, dans l'ordre, dans le texte.
 *      Elle n'est PAS étendue à `tiers` : y retirer les blancs laisserait deux mots voisins se
 *      souder, donc fabriquer une raison sociale que le document ne porte pas.
 */
export function verifierCitations(citations: CitationsChamps, texte: string): VerificationCitations {
  const normalise = normaliser(texte)
  const sansBlancs = normalise.replace(/\s/g, '')

  const retenues: Partial<Record<ChampCite, string>> = {}
  const rejetees: VerificationCitations['rejetees'] = []

  for (const champ of CHAMPS_CITES) {
    const citation = citations[champ]
    // Absent ou explicitement nul : le modèle dit qu'il n'a pas trouvé. C'est une réponse, pas un
    // rejet — la recenser parmi les rejets noierait les vraies inventions.
    if (citation == null) continue
    if (citation.trim() === '') {
      rejetees.push({ champ, citation, motif: 'citation vide' })
      continue
    }

    const cible = normaliser(citation)
    const trouvee = normalise.includes(cible)
      || (CHAMPS_MONTANT.includes(champ) && sansBlancs.includes(cible.replace(/\s/g, '')))

    if (trouvee) retenues[champ] = citation
    else rejetees.push({ champ, citation, motif: 'absente du texte' })
  }

  return { retenues, rejetees }
}

// Le prompt, versionné ici plutôt que dispersé dans l'appelant : c'est la pièce qui bougera le plus,
// et une copie qui dérive est le défaut récurrent de ce dépôt (voir « chercher toutes les copies
// avant de corriger la première »).
//
// Il dit trois choses, et chacune répare une façon connue de se tromper :
//   - **recopier, jamais reformuler** — c'est la condition de la vérification ci-dessus ;
//   - **`null` est une bonne réponse** — sans ça un modèle remplit toujours, et une date plausible
//     envoie une pièce dans le mauvais exercice sans que rien ne le signale ;
//   - **la date d'ÉMISSION** — une facture imprime aussi son échéance, ses conditions de règlement
//     et ses mentions légales ; c'est le piège qui a coûté le plus cher à l'extraction actuelle.
export const PROMPT_EXTRACTION = `Tu lis le texte OCR d'un document comptable français et tu en extrais six champs.

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
