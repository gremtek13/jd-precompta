import { refusDuRetraitDUneSource, type EtatDeLaCitation, type GesteSurUneSource } from './revision'
import { BLANCS_D_UN_TEXTE } from './revisionSoldes'
import type { EntreeDossierPermanent, NatureDossierPermanent, RevisionJustification, RevisionPreuve } from './types'

// LE DOSSIER PERMANENT DE LA RÉVISION (ligne 41, étape R7 ; migration `dossier_permanent`).
//
// « L'expert-comptable constitue un dossier de travail contenant la documentation de ses travaux » (NP 2300, § 16). Il
// « comprend » « les informations utiles sur l'entité pour la mission en cours et les missions ultérieures », et « peut
// contenir » « un exemplaire de la lettre de mission », « des documents juridiques de l'entité et contrats importants »,
// « la description de l'entité et de son activité », « la présentation de l'organisation comptable » (A9, une liste
// donnée « sans préjudice d'autres éléments ») ; la mission tient dans « un contrat écrit définissant leur mission », qui
// « peut prendre la forme d'une lettre de mission » (décret n° 2012-432, art. 151). Textes relus sur Légifrance le
// 11/10/2026. Ce qui vaut pour plusieurs exercices se range dans un dossier PERMANENT : une entrée par élément, datée,
// signée, valable pour une période, qui cite au plus une pièce ou un document du dossier par son empreinte. Une entrée ne
// se modifie pas : une nouvelle version la REMPLACE, la version courante se RETIRE, une fois, et une entrée retirée ne se
// remplace plus.
//
// LA BASE TIENT LA RÈGLE : seules `consigner_au_dossier_permanent` et `retirer_du_dossier_permanent` écrivent. Ce module
// dit AVANT le clic ce qu'elles refuseraient, dans leur ordre et sous leurs mots (`REFUS_CONSIGNATION`, `REFUS_RETRAIT`) :
// dossierPermanent.test.ts les confronte au texte des fonctions que l'export porte, et dossierPermanentEssai.test.ts
// rejoue l'essai (supabase/essais/dossierPermanent.sql) appel par appel. Il lit aussi ce qui n'est pas stocké : la version
// courante d'une entrée (`entreesDuDossierPermanent`), les entrées qui valent pour un exercice (`entreesDeLExercice`), ce
// qu'une citation prouve encore (`etatDeLaCitation`), et ce que `garder_source_citee` refuserait d'une pièce ou d'un
// document cité (`refusDuRetraitDUneSourceCitee`). Un module PUR : il ne lit rien en base et ne lit pas l'horloge.
//
// LES HYPOTHÈSES DE LA MIGRATION, reprises telles qu'elles y sont, sans en trancher aucune : Q2 (tout membre affecté au
// dossier consigne et retire : l'accès est un paramètre, `accesAuDossier`, que l'écran tient de la session) ; Q8 (une
// source citée — même par une version remplacée ou une entrée retirée — ne se supprime plus et ne change plus de dossier) ;
// Q9 (un fichier du cabinet attend l'étape R8 : la citation n'en désigne pas). Le dossier permanent n'appartient à aucun
// exercice : la règle des exercices terminés (Q11) ne le concerne pas, et rien ici ne lit l'année du jour.

// ── Les listes de la base ─────────────────────────────────────────────────────────────────────────────────────────

/** Les huit natures d'une entrée, dans l'ordre de A9 : c'est aussi l'ordre dans lequel la garde des sources les nomme. */
export const NATURES_DU_DOSSIER_PERMANENT: readonly NatureDossierPermanent[] = [
  'lettre_mission', 'description', 'organisation_comptable', 'statuts', 'bail', 'contrat_emprunt', 'contrat', 'autre',
]

/** Le libellé de chaque nature, tel que `garder_source_citee` le dit dans son message ; l'écran le reprend tel quel. */
export const LIBELLES_DES_NATURES: Readonly<Record<NatureDossierPermanent, string>> = {
  lettre_mission: 'lettre de mission',
  description: "description de l'entité",
  organisation_comptable: 'organisation comptable',
  statuts: 'statuts',
  bail: 'bail',
  contrat_emprunt: "contrat d'emprunt",
  contrat: 'contrat',
  autre: 'autre document',
}

/** Les longueurs que la base admet, en caractères (et non en unités UTF-16). */
export const LONGUEUR_MAX_TITRE = 500
export const LONGUEUR_MAX_TEXTE = 8000
/** Les bornes d'une date de validité, comprises. */
export const PREMIER_JOUR_DE_VALIDITE = '1900-01-01'
export const DERNIER_JOUR_DE_VALIDITE = '2100-12-31'

// ── Ce que les deux fonctions refusent, dit avant le clic ─────────────────────────────────────────────────────────

// LES REFUS, DANS L'ORDRE DU TEXTE DE CHAQUE FONCTION ET SOUS SES MOTS — aucun n'a de « % » : chaque message se dit tel
// quel. `refus` est le numéro du rang dans la fonction, que dossierPermanent.test.ts lit dans ses commentaires.
const MESSAGE_SOURCE_HORS_DOSSIER = "La pièce ou le document cité n'est pas de ce dossier."

export const REFUS_CONSIGNATION = [
  { cle: 'acces', refus: 1, modele: 'Accès refusé à ce dossier.' },
  {
    cle: 'nature', refus: 2,
    modele: "Une entrée du dossier permanent est la lettre de mission, la description de l'entité, son organisation comptable, ses statuts, un bail, un contrat d'emprunt, un autre contrat, ou autre chose.",
  },
  { cle: 'titre_absent', refus: 3, modele: 'Une entrée du dossier permanent porte un titre.' },
  { cle: 'titre_trop_long', refus: 3, modele: 'Un titre tient en 500 caractères au plus.' },
  { cle: 'texte_blanc', refus: 4, modele: 'Un texte ne se compose pas que de blancs : le laisser vide.' },
  { cle: 'texte_trop_long', refus: 4, modele: 'Un texte tient en 8 000 caractères au plus.' },
  {
    cle: 'citation_illisible', refus: 5,
    modele: 'La citation est illisible : une pièce ou un document du dossier, désigné par son identifiant.',
  },
  {
    cle: 'rien_a_dire', refus: 6,
    modele: "Une entrée du dossier permanent dit quelque chose : un texte, ou la pièce ou le document qu'elle cite.",
  },
  { cle: 'validite_hors_bornes', refus: 7, modele: 'Une date de validité est comprise entre 1900 et 2100.' },
  { cle: 'validite_inversee', refus: 7, modele: 'La fin de validité précède son début.' },
  {
    cle: 'remplacement_hors_dossier', refus: 8,
    modele: "L'entrée à remplacer n'est pas une entrée du dossier permanent de ce dossier.",
  },
  { cle: 'remplacement_perime', refus: 8, modele: 'Cette entrée a été remplacée depuis : relire avant de la remplacer.' },
  {
    cle: 'remplacement_retiree', refus: 8,
    modele: 'Cette entrée est retirée : elle ne se remplace plus, une nouvelle entrée se consigne.',
  },
  // La fonction lève le même message de la pièce et du document : deux refus, une phrase.
  { cle: 'piece_hors_dossier', refus: 9, modele: MESSAGE_SOURCE_HORS_DOSSIER },
  { cle: 'document_hors_dossier', refus: 9, modele: MESSAGE_SOURCE_HORS_DOSSIER },
] as const

export const REFUS_RETRAIT = [
  { cle: 'acces', refus: 1, modele: 'Accès refusé à ce dossier.' },
  { cle: 'introuvable', refus: 2, modele: 'Entrée introuvable dans ce dossier.' },
  { cle: 'remplacee_depuis', refus: 3, modele: 'Cette entrée a été remplacée depuis : relire avant de la retirer.' },
  { cle: 'deja_retiree', refus: 4, modele: 'Cette entrée est déjà retirée.' },
] as const

export type CleRefusConsignation = (typeof REFUS_CONSIGNATION)[number]['cle']
export type CleRefusRetrait = (typeof REFUS_RETRAIT)[number]['cle']

export interface RefusDuDossierPermanent<K extends string> {
  cle: K
  // Le rang du refus dans l'ordre de sa fonction.
  refus: number
  // Le code SQLSTATE que la base lève : 42501 pour l'accès, P0002 pour une entrée introuvable, 22023 pour les autres.
  code: '42501' | '22023' | 'P0002'
  message: string
}

function fabrique<K extends string>(liste: readonly { cle: K; refus: number; modele: string }[], introuvable: K | null) {
  return (cle: K): RefusDuDossierPermanent<K> => {
    const r = liste.find((x) => x.cle === cle) as { cle: K; refus: number; modele: string }
    return { cle, refus: r.refus, code: r.refus === 1 ? '42501' : cle === introuvable ? 'P0002' : '22023', message: r.modele }
  }
}
const refusConsignation = fabrique<CleRefusConsignation>(REFUS_CONSIGNATION, null)
const refusRetrait = fabrique<CleRefusRetrait>(REFUS_RETRAIT, 'introuvable')

// Ce que la base lit d'un texte : `btrim(x, E' \t\n\r')` ne retire que ces quatre blancs — une espace insécable n'en est
// pas un —, et `length` compte des caractères, pas des unités UTF-16. Un identifiant se compare sans la casse, comme un
// uuid.
const queDesBlancs = (t: string) => [...t].every((c) => BLANCS_D_UN_TEXTE.includes(c))
const caracteres = (t: string) => [...t].length
const minuscules = (id: string) => id.toLowerCase()
const meme = (a: string | null, b: string | null) => a !== null && b !== null && minuscules(a) === minuscules(b)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Ce qu'une entrée cite : une pièce ou un document du dossier, par son identifiant. */
export type CitationPermanente = { pieceId: string } | { documentId: string }

/**
 * La citation telle que la base la lit (refus 5) : rien — l'absence ou le JSON `null` —, ou un objet d'UNE seule clé,
 * `piece_id` ou `document_id`, dont la valeur est une chaîne qui s'écrit comme un uuid ; tout le reste est illisible, un
 * `fichier_id` compris tant que l'étape R8 n'est pas faite.
 */
export function lireLaCitation(citation: unknown): CitationPermanente | null | 'illisible' {
  if (citation === null || citation === undefined) return null
  if (typeof citation !== 'object' || Array.isArray(citation)) return 'illisible'
  const cles = Object.keys(citation)
  if (cles.length !== 1 || (cles[0] !== 'piece_id' && cles[0] !== 'document_id')) return 'illisible'
  const valeur: unknown = (citation as Record<string, unknown>)[cles[0]]
  if (typeof valeur !== 'string' || !UUID.test(valeur)) return 'illisible'
  return cles[0] === 'piece_id' ? { pieceId: valeur } : { documentId: valeur }
}

/** Les arguments de `consigner_au_dossier_permanent`, tels que supabase-js les envoie : les huit, nuls plutôt qu'absents. */
export interface ArgumentsConsigner {
  p_dossier_id: string
  p_nature: string | null
  p_titre: string | null
  p_texte: string | null
  // `{ piece_id }`, `{ document_id }`, ou nul — ce que la fonction reçoit en jsonb.
  p_citation: unknown
  // AAAA-MM-JJ, ou nul.
  p_valable_du: string | null
  p_valable_jusqu_au: string | null
  p_remplace_id: string | null
}

/** Les arguments de `retirer_du_dossier_permanent`. */
export interface ArgumentsRetirer {
  p_dossier_id: string
  p_entree_id: string | null
}

/** Ce que l'écran a lu pour dire les refus : la session, les entrées du dossier, ses pièces et ses documents. */
export interface ContexteDuDossierPermanent {
  // L'appelant est-il `admin_du_dossier` du dossier annoncé ? Hypothèse Q2 : tout membre affecté consigne et retire.
  accesAuDossier: boolean
  // Les entrées du dossier, lues EN ENTIER (lib/dossierPermanentLecture.ts), remplacées et retirées comprises.
  entrees: readonly Pick<EntreeDossierPermanent, 'id' | 'dossier_id' | 'remplace_id' | 'retire_le'>[]
  // Les identifiants des pièces et des documents du dossier : une citation désigne l'un d'eux.
  pieces: readonly string[]
  documents: readonly string[]
}

// Une date AAAA-MM-JJ se compare comme un texte, l'année sur quatre chiffres.
const horsBornes = (date: string | null) =>
  date !== null && (date < PREMIER_JOUR_DE_VALIDITE || date > DERNIER_JOUR_DE_VALIDITE)

/**
 * Ce que `consigner_au_dossier_permanent` refuserait, le premier refus dans son ordre, avec son code et ses mots ; nul
 * quand elle écrirait l'entrée. Le refus 1 dépend de la session ; aucun autre ne dépend de qui clique. Une date d'une
 * autre forme qu'AAAA-MM-JJ ne parvient pas à la fonction — la base refuserait de la lire comme une date — :
 * `argumentsDeConsigner` ne l'envoie pas.
 */
export function refusDeConsigner(
  a: ArgumentsConsigner,
  c: ContexteDuDossierPermanent,
): RefusDuDossierPermanent<CleRefusConsignation> | null {
  // 1. L'accès (hypothèse Q2).
  if (!c.accesAuDossier) return refusConsignation('acces')
  // 2. Une des huit natures, à la lettre.
  if (a.p_nature === null || !(NATURES_DU_DOSSIER_PERMANENT as readonly string[]).includes(a.p_nature)) {
    return refusConsignation('nature')
  }
  // 3. Un titre, qui ne soit pas que des blancs.
  if (a.p_titre === null || queDesBlancs(a.p_titre)) return refusConsignation('titre_absent')
  if (caracteres(a.p_titre) > LONGUEUR_MAX_TITRE) return refusConsignation('titre_trop_long')
  // 4. Un texte est facultatif ; des blancs seuls n'en sont pas un.
  if (a.p_texte !== null && queDesBlancs(a.p_texte)) return refusConsignation('texte_blanc')
  if (a.p_texte !== null && caracteres(a.p_texte) > LONGUEUR_MAX_TEXTE) return refusConsignation('texte_trop_long')
  // 5. La citation.
  const citation = lireLaCitation(a.p_citation)
  if (citation === 'illisible') return refusConsignation('citation_illisible')
  // 6. Une entrée dit quelque chose.
  if (a.p_texte === null && citation === null) return refusConsignation('rien_a_dire')
  // 7. La validité.
  if (horsBornes(a.p_valable_du) || horsBornes(a.p_valable_jusqu_au)) return refusConsignation('validite_hors_bornes')
  if (a.p_valable_du !== null && a.p_valable_jusqu_au !== null && a.p_valable_jusqu_au < a.p_valable_du) {
    return refusConsignation('validite_inversee')
  }
  // 8. On remplace la version courante d'une entrée du dossier, qui n'est pas retirée.
  if (a.p_remplace_id !== null) {
    const cible = c.entrees.find((e) => meme(e.id, a.p_remplace_id) && meme(e.dossier_id, a.p_dossier_id))
    if (cible === undefined) return refusConsignation('remplacement_hors_dossier')
    if (c.entrees.some((e) => meme(e.remplace_id, cible.id))) return refusConsignation('remplacement_perime')
    if (cible.retire_le !== null) return refusConsignation('remplacement_retiree')
  }
  // 9. La source citée est du dossier : une pièce parmi ses pièces, un document parmi ses documents.
  if (citation !== null && 'pieceId' in citation && !c.pieces.some((id) => meme(id, citation.pieceId))) {
    return refusConsignation('piece_hors_dossier')
  }
  if (citation !== null && 'documentId' in citation && !c.documents.some((id) => meme(id, citation.documentId))) {
    return refusConsignation('document_hors_dossier')
  }
  return null
}

/** Ce que `retirer_du_dossier_permanent` refuserait, dans son ordre ; nul quand elle retirerait l'entrée. */
export function refusDeRetirer(
  a: ArgumentsRetirer,
  c: Pick<ContexteDuDossierPermanent, 'accesAuDossier' | 'entrees'>,
): RefusDuDossierPermanent<CleRefusRetrait> | null {
  // 1.
  if (!c.accesAuDossier) return refusRetrait('acces')
  // 2. L'entrée, dans ce dossier.
  const entree = c.entrees.find((e) => meme(e.id, a.p_entree_id) && meme(e.dossier_id, a.p_dossier_id))
  if (entree === undefined) return refusRetrait('introuvable')
  // 3. La version courante seule.
  if (c.entrees.some((e) => meme(e.remplace_id, entree.id))) return refusRetrait('remplacee_depuis')
  // 4. Une fois.
  if (entree.retire_le !== null) return refusRetrait('deja_retiree')
  return null
}

// ── Ce que l'écran envoie ─────────────────────────────────────────────────────────────────────────────────────────

/** Ce que le cabinet saisit d'une entrée, avant que l'écran l'envoie. */
export interface SaisieDuDossierPermanent {
  nature: NatureDossierPermanent | null
  titre: string
  texte: string
  citation: CitationPermanente | null
  // AAAA-MM-JJ (un champ de date), ou rien.
  valableDu: string | null
  valableJusquAu: string | null
}

// Une date civile AAAA-MM-JJ qui existe ; une autre forme ne parviendrait pas à la fonction, et ne part pas.
function dateCivile(date: string | null): string | null {
  if (date === null || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const [annee, mois, jour] = date.split('-').map(Number)
  const vraie = new Date(Date.UTC(annee, mois - 1, jour))
  return vraie.getUTCFullYear() === annee && vraie.getUTCMonth() === mois - 1 && vraie.getUTCDate() === jour ? date : null
}

/**
 * Les arguments de `consigner_au_dossier_permanent`, dans l'ordre de sa signature : des blancs partent nuls — un titre
 * fait de blancs se dit absent, un texte fait de blancs n'en est pas un —, une date qui n'en est pas une ne part pas.
 * `remplaceId` : la version courante que la saisie remplace, ou nul pour une entrée nouvelle.
 */
export function argumentsDeConsigner(
  dossierId: string,
  s: SaisieDuDossierPermanent,
  remplaceId: string | null,
): ArgumentsConsigner {
  const nonBlanc = (t: string) => (queDesBlancs(t) ? null : t)
  return {
    p_dossier_id: dossierId,
    p_nature: s.nature,
    p_titre: nonBlanc(s.titre),
    p_texte: nonBlanc(s.texte),
    p_citation: s.citation === null ? null
      : 'pieceId' in s.citation ? { piece_id: s.citation.pieceId } : { document_id: s.citation.documentId },
    p_valable_du: dateCivile(s.valableDu),
    p_valable_jusqu_au: dateCivile(s.valableJusquAu),
    p_remplace_id: remplaceId,
  }
}

/** Les arguments de `retirer_du_dossier_permanent`, dans l'ordre de sa signature. */
export function argumentsDeRetirer(dossierId: string, entreeId: string): ArgumentsRetirer {
  return { p_dossier_id: dossierId, p_entree_id: entreeId }
}

// ── Ce qui se déduit, et ne se stocke pas ─────────────────────────────────────────────────────────────────────────

/** Une entrée du dossier permanent : la chaîne de ses versions, de la première à la courante. */
export interface EntreeDuDossierPermanent {
  versions: EntreeDossierPermanent[]
  courante: EntreeDossierPermanent
  // La version courante est retirée : l'entrée n'est plus au dossier permanent, et son histoire reste.
  retiree: boolean
}

export interface EntreesLues {
  // Une par chaîne, dans l'ordre de leur première version (l'instant, puis l'identifiant).
  entrees: EntreeDuDossierPermanent[]
  // Faux quand une version désigne une version absente de la lecture, quand deux versions en remplacent une même, quand
  // une version retirée a une suite, ou quand une chaîne boucle : la base ne laisse rien de tel se former, et une
  // lecture qui le montre ne se croit pas — rien ne s'en déduit.
  lisible: boolean
}

const instant = (e: Pick<EntreeDossierPermanent, 'cree_le' | 'id'>) => Date.parse(e.cree_le)
const parCreation = (a: EntreeDossierPermanent, b: EntreeDossierPermanent) =>
  instant(a) - instant(b) || (minuscules(a.id) < minuscules(b.id) ? -1 : minuscules(a.id) > minuscules(b.id) ? 1 : 0)

/** Les entrées du dossier permanent, chacune sa chaîne de versions, depuis les lignes lues EN ENTIER. */
export function entreesDuDossierPermanent(lignes: readonly EntreeDossierPermanent[]): EntreesLues {
  const parId = new Map(lignes.map((l) => [minuscules(l.id), l]))
  const suites = new Map<string, EntreeDossierPermanent[]>()
  for (const l of lignes) {
    if (l.remplace_id === null) continue
    const cle = minuscules(l.remplace_id)
    suites.set(cle, [...(suites.get(cle) ?? []), l])
  }
  let lisible = true
  const atteintes = new Set<string>()
  const entrees: EntreeDuDossierPermanent[] = []
  for (const premiere of [...lignes].filter((l) => l.remplace_id === null).sort(parCreation)) {
    const versions = [premiere]
    atteintes.add(minuscules(premiere.id))
    for (;;) {
      const derniere = versions[versions.length - 1]
      const suite = suites.get(minuscules(derniere.id))?.[0]
      if (suite === undefined || atteintes.has(minuscules(suite.id))) break
      if (derniere.retire_le !== null) lisible = false
      versions.push(suite)
      atteintes.add(minuscules(suite.id))
    }
    const courante = versions[versions.length - 1]
    entrees.push({ versions, courante, retiree: courante.retire_le !== null })
  }
  // Une version qu'aucune première n'atteint : la suite d'une version absente, la seconde suite d'une même version (le
  // chemin n'en suit qu'une), une chaîne qui boucle. Seule la suite d'une version retirée se voit en chemin, plus haut.
  if (atteintes.size !== parId.size) lisible = false
  return { entrees, lisible }
}

/** La version vaut-elle pour l'exercice — sa période de validité touche-t-elle l'année civile, bornes comprises ? */
export function vautPourLExercice(
  v: Pick<EntreeDossierPermanent, 'valable_du' | 'valable_jusqu_au'>,
  annee: number,
): boolean {
  const an = String(annee).padStart(4, '0')
  return (v.valable_du === null || v.valable_du <= `${an}-12-31`) && (v.valable_jusqu_au === null || v.valable_jusqu_au >= `${an}-01-01`)
}

/**
 * Les entrées qui valent pour un exercice : celles qui ne sont pas retirées et dont la version COURANTE touche l'année. Nul
 * sur une lecture partielle ou une chaîne illisible : rien ne s'affirme.
 */
export function entreesDeLExercice(lues: EntreesLues, complete: boolean, annee: number): EntreeDuDossierPermanent[] | null {
  if (!complete || !lues.lisible) return null
  return lues.entrees.filter((e) => !e.retiree && vautPourLExercice(e.courante, annee))
}

// CE QUE A9 PROPOSE AU DOSSIER PERMANENT et qu'aucune entrée en vigueur ne porte pour l'exercice : une INFORMATION — le
// dossier « peut contenir » ces éléments —, jamais une faute. Les documents juridiques et les contrats dépendent de
// l'entité : ils n'y sont pas.
export const ELEMENTS_PROPOSES_PAR_A9: readonly NatureDossierPermanent[] = ['lettre_mission', 'description', 'organisation_comptable']

/** Les éléments que A9 propose et qu'aucune entrée en vigueur ne porte pour l'exercice ; nul quand rien ne s'affirme. */
export function elementsSansEntree(lues: EntreesLues, complete: boolean, annee: number): NatureDossierPermanent[] | null {
  const enVigueur = entreesDeLExercice(lues, complete, annee)
  if (enVigueur === null) return null
  return ELEMENTS_PROPOSES_PAR_A9.filter((n) => !enVigueur.some((e) => e.courante.nature === n))
}

// CE QU'UNE CITATION PROUVE ENCORE, sous la règle de la révision d'un solde (lib/revision.ts, `verifierCitation`) : la
// base a recopié l'empreinte de la source au moment de la citation — un SHA-256 en minuscules hexadécimales, ou rien — ;
// l'écran relit celle du jour. `introuvable` : la source n'est pas dans ce que l'écran a lu — une lecture qui l'a manquée,
// ou un fichier du cabinet (étape R8), qui ne se lit pas encore.
const empreinteValide = (h: string | null | undefined) => (typeof h === 'string' && /^[0-9a-f]{64}$/.test(h) ? h : null)

/** L'état de la citation d'une version ; nul quand elle ne cite rien. Les clés des deux tables sont en minuscules. */
export function etatDeLaCitation(
  v: Pick<EntreeDossierPermanent, 'piece_id' | 'document_id' | 'fichier_id' | 'empreinte'>,
  pieces: ReadonlyMap<string, { storage_hash: string | null }>,
  documents: ReadonlyMap<string, { storage_hash: string | null }>,
): EtatDeLaCitation | null {
  if (v.piece_id === null && v.document_id === null && v.fichier_id === null) return null
  const source = v.piece_id !== null ? pieces.get(minuscules(v.piece_id))
    : v.document_id !== null ? documents.get(minuscules(v.document_id)) : undefined
  if (source === undefined) return 'introuvable'
  const duJour = empreinteValide(source.storage_hash)
  if (v.empreinte === null) return 'sans-empreinte'
  if (duJour === null) return 'disparue'
  return duJour === v.empreinte ? 'intacte' : 'changee'
}

// ── Une source citée ne se retire plus (hypothèse Q8, la règle de l'étape R1) ─────────────────────────────────────

// CE QUE `garder_source_citee` REFUSE, DIT AVANT LE CLIC. Une pièce ou un document cité par le dossier permanent — même
// par une version remplacée ou une entrée retirée : l'historique garde ses preuves — ne se supprime plus et ne change plus
// de dossier, sauf avec son dossier entier. La garde dit d'abord la révision d'un solde (lib/revision.ts), puis le
// dossier permanent, par la NATURE de l'entrée qui cite — la première dans l'ordre de A9 —, jamais par son titre.
// dossierPermanent.test.ts confronte le message au texte du déclencheur ; l'essai le joue sur chacune des huit natures.

/** La nature que la garde nomme : la première, dans l'ordre de A9, des versions qui citent la source ; nulle sinon. */
export function natureQuiGardeLaSource(
  source: { pieceId: string } | { documentId: string },
  lignes: readonly Pick<EntreeDossierPermanent, 'nature' | 'piece_id' | 'document_id'>[],
): NatureDossierPermanent | null {
  const [colonne, visee] = 'pieceId' in source ? ['piece_id', source.pieceId] as const : ['document_id', source.documentId] as const
  const natures = new Set(lignes.filter((l) => meme(l[colonne], visee)).map((l) => l.nature))
  return NATURES_DU_DOSSIER_PERMANENT.find((n) => natures.has(n)) ?? null
}

/** Le refus du dossier permanent, mot pour mot, pour ce geste sur cette source ; nul quand aucune version ne la cite. */
export function refusDuRetraitParLeDossierPermanent(
  source: { pieceId: string } | { documentId: string },
  geste: GesteSurUneSource,
  lignes: readonly Pick<EntreeDossierPermanent, 'nature' | 'piece_id' | 'document_id'>[],
): string | null {
  const nature = natureQuiGardeLaSource(source, lignes)
  if (nature === null) return null
  const piece = 'pieceId' in source
  const consequence = geste === 'suppression'
    ? (piece ? 'elle ne se supprime plus' : 'il ne se supprime plus')
    : (piece ? 'elle ne change plus de dossier' : 'il ne change plus de dossier')
  return `${piece ? 'Cette pièce est citée' : 'Ce document est cité'} par le dossier permanent (${LIBELLES_DES_NATURES[nature]}) : `
    + `${consequence}, sauf avec son dossier.`
}

/**
 * Le refus de `garder_source_citee` tout entier, dans son ordre : la révision d'un solde d'abord, sous ses mots d'hier,
 * puis le dossier permanent ; nul quand rien de ce qui a été lu ne cite la source — la base reste juge.
 */
export function refusDuRetraitDUneSourceCitee(
  source: { pieceId: string } | { documentId: string },
  geste: GesteSurUneSource,
  revision: {
    decisions: readonly Pick<RevisionJustification, 'id' | 'annee' | 'compte'>[]
    preuves: readonly Pick<RevisionPreuve, 'justification_id' | 'piece_id' | 'document_id'>[]
  },
  lignes: readonly Pick<EntreeDossierPermanent, 'nature' | 'piece_id' | 'document_id'>[],
): string | null {
  return refusDuRetraitDUneSource(source, geste, revision.decisions, revision.preuves)
    ?? refusDuRetraitParLeDossierPermanent(source, geste, lignes)
}
