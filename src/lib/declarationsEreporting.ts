import { remplirModele } from './encaissementsFactures'
import type {
  ContenuAchats, ContenuPaiements, ContenuVentes, DeclarationEreporting, Lecture, RefusEreporting, SourceEreporting,
} from './ereporting'
import { ajouterJours, formatDate } from './format'
import { DEBUT_EREPORTING_PME, periodeDe, type ObjetEreporting } from './periodesEreporting'
import { memeRegime, rythme, type LigneDeRegime } from './regimesEreporting'
import { empreinte } from './sauvegardeFichier'
import type {
  DeclarationEreportingHorsApplication, EncaissementFacture, FactureEmise, Piece, PieceEcarteeEreporting, PieceHorsDeFrance,
  RegimeEreporting, SourceDeclarationEreporting,
} from './types'

// LA DÉCLARATION D'E-REPORTING HORS APPLICATION (ligne 28.5, étape e, cinquième temps, seconde moitié e5b1 ; migration
// `declarations_ereporting`).
//
// Le cabinet dépose l'e-reporting d'une période sur la plateforme agréée du dossier, hors de l'application, puis dit ici
// ce qu'il a déclaré : la base garde le CONTENU que l'application avait calculé (lib/ereporting.ts, étape e4), figé, et son
// empreinte, qu'elle calcule elle-même. Une seule déclaration active par dossier, objet et période ; une correction est une
// rectificative qui remplace la période ENTIÈRE (spécifications externes de la DGFiP v3.2, dossier général, § 3.7.7, note
// 127). Ce module, PUR — il ne lit ni la base ni l'horloge —, dit :
//   - AVANT LE CLIC, ce que `declarer_ereporting_hors_application` refuserait, dans son ordre et sous ses mots
//     (`REFUS_DECLARATION`, `refusDeclaration`) — declarationsEreporting.test.ts les confronte au texte de la fonction, et
//     rejoue l'essai (supabase/essais/declarationsEreporting.sql) appel par appel ;
//   - LA FORME CANONIQUE d'un contenu (`formeCanonique`) : le texte que la base garde du `jsonb` reçu — les clés triées par
//     longueur en octets puis octet par octet, les séparateurs « , » et « : », un nombre sans exposant —, celui qu'elle
//     empreinte (`empreinteDuContenu`, SHA-256 de ses octets UTF-8) et qu'elle borne à un mégaoctet ;
//   - LE CONTENU À DÉCLARER (`contenuADeclarer`) : celui d'e4, précédé de ce qu'il déclare — l'objet et les bornes ;
//   - LA PIÈCE QUE SA DÉCLARATION RETIENT (`declarationQuiRetientLaPiece`, hypothèse E5-Q6) ;
//   - « À RECTIFIER » (`etatDeLaDeclaration`) : l'écart entre le contenu figé et celui qu'e4 calcule aujourd'hui pour la
//     même période, opération par opération — ajoutée, retirée, changée —, et ses causes : le régime retiré (hypothèse
//     E5-Q7), l'écart d'une pièce retiré, une fiche posée, remplacée ou retirée après la déclaration.
// La lecture des deux tables est à part (lib/declarationsEreportingLecture.ts).

/** La version du contenu que ce module écrit : un contenu figé d'une autre version se lit sous la sienne. */
export const VERSION_DU_CONTENU = 1

/** Ce qu'un contenu pèse au plus, en octets de sa forme canonique (`declarations_ereporting_contenu`). */
export const TAILLE_MAXIMALE_CONTENU = 1_048_576

export const LONGUEUR_MAXIMALE_PLATEFORME = 200
export const LONGUEUR_MAXIMALE_NOTE = 2000

/** Les trois déclarations d'une période, et la fonction n'en connaît pas d'autre. */
export const OBJETS_DECLARES: readonly ObjetEreporting[] = ['ventes', 'achats', 'paiements']

/** Où chaque contenu range ses opérations (e4), et ce que chacune désigne comme sources. */
const CLE_DES_OPERATIONS = { achats: 'achats', ventes: 'transactions', paiements: 'paiements' } as const
const LISTE_DES_SOURCES = { ventes: 'factures', paiements: 'encaissements' } as const
const GENRE_DES_SOURCES = { achats: 'fiche', ventes: 'facture', paiements: 'encaissement' } as const
const ROLE_DU_DECLARANT = { achats: 'BY', ventes: 'SE', paiements: 'SE' } as const

// ── Les refus de la fonction ────────────────────────────────────────────────────────────────────────────────────────

// Les refus de `declarer_ereporting_hors_application`, dans l'ordre de la fonction et sous ses mots, avec leur code :
// chaque « % » reçoit la valeur que la base y met (`remplirModele`).
export const REFUS_DECLARATION = [
  { cle: 'acces', code: '42501', modele: 'Accès refusé à ce dossier.' },
  { cle: 'objet', code: '22023', modele: "Une déclaration d'e-reporting porte sur les ventes, les achats ou les paiements du dossier." },
  { cle: 'bornes_absentes', code: '22023', modele: 'Les deux bornes de la période sont à renseigner.' },
  { cle: 'regime_introuvable', code: 'P0002', modele: 'Régime introuvable dans ce dossier.' },
  { cle: 'regime_retire', code: '22023', modele: 'Ce régime est retiré : une période se déclare sous le régime confirmé qui la couvre.' },
  { cle: 'regime_posterieur', code: '22023', modele: "Ce régime ne vaut qu'à partir du % : il ne couvre pas le début de la période." },
  { cle: 'regime_depasse', code: '22023', modele: 'Le régime en vigueur le % est celui confirmé à partir du % : relisez.' },
  {
    cle: 'regime_change', code: '22023',
    modele: 'Le régime du dossier change dans la période, le % : une période à cheval sur deux régimes ne se déclare pas ici, '
      + 'les sources publiques ne disant pas comment. À trancher par le cabinet.',
  },
  {
    cle: 'paiements_sur_debits', code: '22023',
    modele: "Sous ce régime, sur option pour la TVA sur les débits, le dossier n'a pas de données de paiement à déclarer.",
  },
  { cle: 'periode_hors_regime', code: '22023', modele: "Du % au % n'est pas une période de ses déclarations : sous ce régime, elles se font %." },
  {
    cle: 'avant_l_obligation', code: '22023',
    modele: "La période finit le %, avant le 1er septembre 2027 : l'e-reporting d'une PME ou d'une micro-entreprise commence "
      + 'avec les factures de ce jour.',
  },
  {
    cle: 'chevauchement', code: '22023',
    modele: "La période chevauche celle d'une déclaration active, du % au % : une même opération ne se déclare pas deux fois. "
      + 'À trancher par le cabinet.',
  },
  {
    cle: 'deja_declaree', code: '22023',
    modele: 'Une déclaration de cette période est déjà active, faite sur « % » : une correction se fait par une déclaration '
      + 'rectificative, qui la remplace entière.',
  },
  { cle: 'remplacee_introuvable', code: 'P0002', modele: 'Déclaration introuvable dans ce dossier.' },
  {
    cle: 'remplacee_autre_periode', code: '22023',
    modele: 'Une rectificative remplace la déclaration de la même période et du même objet : celle-ci en déclare une autre.',
  },
  {
    cle: 'remplacee_deja', code: '22023',
    modele: 'Cette déclaration est déjà remplacée : une rectificative remplace la déclaration active de la période.',
  },
  { cle: 'plateforme_absente', code: '22023', modele: 'La plateforme sur laquelle la période a été déclarée est à nommer.' },
  { cle: 'plateforme_trop_longue', code: '22023', modele: 'Le nom de la plateforme dépasse 200 caractères.' },
  { cle: 'note_trop_longue', code: '22023', modele: 'La note de la déclaration dépasse 2 000 caractères.' },
  { cle: 'contenu_absent', code: '22023', modele: "Le contenu déclaré est à joindre : celui que l'application a calculé pour la période." },
  { cle: 'contenu_trop_grand', code: '22023', modele: 'Le contenu déclaré dépasse un mégaoctet (1 048 576 octets).' },
  { cle: 'contenu_autre', code: '22023', modele: 'Le contenu ne porte pas sur cet objet et cette période : relisez.' },
  { cle: 'contenu_illisible', code: '22023', modele: 'Le contenu déclaré ne se lit pas : chaque opération porte sa date et ses sources.' },
  { cle: 'operation_hors_periode', code: '22023', modele: 'Une opération du contenu est datée du %, hors de la période : relisez.' },
  { cle: 'a_blanc', code: '22023', modele: "Une période sans opération ne se déclare pas : aucune transmission n'est attendue." },
  {
    cle: 'source_en_double', code: '22023',
    modele: "Une même source figure deux fois dans le contenu : une opération ne se déclare qu'une fois.",
  },
  { cle: 'nombre_operations', code: '22023', modele: "Le contenu n'annonce pas le nombre de ses opérations (%) : relisez." },
  { cle: 'source_inconnue', code: '22023', modele: "Une source du contenu n'est pas % de ce dossier : relisez." },
  {
    cle: 'source_deja_declaree', code: '22023',
    modele: "Une opération du contenu est déjà déclarée, dans la période du % au % : la période qui la porte se rectifie d'abord.",
  },
  { cle: 'periode_en_cours', code: '22023', modele: "La période n'est pas finie : elle se déclare à partir du %." },
] as const

export type CleRefusDeclaration = (typeof REFUS_DECLARATION)[number]['cle']

export interface RefusDeclaration {
  cle: CleRefusDeclaration
  code: '42501' | 'P0002' | '22023'
  message: string
}

/** Ce que `source_inconnue` dit d'une source, selon l'objet : la valeur de son « % ». */
export const SOURCES_ATTENDUES: Readonly<Record<ObjetEreporting, string>> = {
  achats: "la fiche « fournisseur établi hors de France » d'une pièce",
  ventes: 'une facture validée',
  paiements: 'un encaissement',
}

// Le refus de `garder_piece_declaree` (hypothèse E5-Q6), sous ses mots.
export const REFUS_SUPPRESSION_PIECE = "Cette pièce est déclarée à l'e-reporting des achats du % au % : elle ne se supprime plus, "
  + 'sauf avec son dossier — une erreur se corrige par une déclaration rectificative de la période.'

function dire(cle: CleRefusDeclaration, ...valeurs: string[]): RefusDeclaration {
  const r = REFUS_DECLARATION.find((x) => x.cle === cle) as (typeof REFUS_DECLARATION)[number]
  return { cle, code: r.code, message: remplirModele(r.modele, valeurs) }
}

// ── Ce que la base lit d'un texte, d'une date, d'un identifiant ─────────────────────────────────────────────────────

// `btrim(x)` sans second argument ne retire que l'ESPACE, et `length` compte des caractères, pas des unités UTF-16 (la
// règle de lib/regimesEreporting.ts, relevée en production le 10/10/2026).
const blanc = (texte: string) => /^ *$/.test(texte)
const caracteres = (texte: string) => [...texte].length

const encodeur = new TextEncoder()
const octetsDe = (texte: string) => encodeur.encode(texte)

const bissextile = (a: number) => (a % 4 === 0 && a % 100 !== 0) || a % 400 === 0
const JOURS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

/**
 * Une date civile AAAA-MM-JJ que la base lit comme une date : quatre chiffres d'année (l'an 0 n'existe pas), un mois, un
 * jour qui existe ce mois-là, sur le calendrier grégorien — ce que `pg_input_is_valid(x, 'date')` accepte sous cette forme,
 * relevé sur la réplique le 11/10/2026 (« 0000-01-01 » et « 2027-02-29 » refusées, « 0001-01-01 » et « 2028-02-29 »
 * admises). Sans `Date` : le fuseau de qui regarde n'y change rien.
 */
export function dateCivileStricte(texte: unknown): string | null {
  if (typeof texte !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(texte)) return null
  const [a, m, j] = texte.split('-').map(Number)
  if (a < 1 || m < 1 || m > 12 || j < 1) return null
  return j <= (m === 2 && bissextile(a) ? 29 : JOURS[m - 1]) ? texte : null
}

/**
 * L'identifiant qu'un texte désigne pour la base (`uuid`), sous sa forme canonique — 32 chiffres hexadécimaux en minuscules
 * et leurs quatre tirets —, ou null quand la base ne le lirait pas. La règle est celle de son lecteur (`string_to_uuid`) :
 * une accolade ouvrante facultative, seize octets de deux chiffres hexadécimaux, un tiret permis après chaque groupe de
 * quatre chiffres sauf le dernier, l'accolade fermante si l'ouvrante y est, et rien d'autre — relevé sur la réplique le
 * 11/10/2026 (accolades et tirets tous les quatre chiffres admis, une espace refusée).
 */
export function uuidCommeLaBase(texte: unknown): string | null {
  if (typeof texte !== 'string') return null
  let i = 0
  const accolade = texte[0] === '{'
  if (accolade) i++
  let hex = ''
  for (let octet = 0; octet < 16; octet++) {
    const paire = texte.slice(i, i + 2)
    if (!/^[0-9a-fA-F]{2}$/.test(paire)) return null
    hex += paire.toLowerCase()
    i += 2
    if (texte[i] === '-' && octet % 2 === 1 && octet < 15) i++
  }
  if (accolade) {
    if (texte[i] !== '}') return null
    i++
  }
  if (i !== texte.length) return null
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

// ── La forme canonique ──────────────────────────────────────────────────────────────────────────────────────────────

/** Les clés d'un objet `jsonb`, dans l'ordre où la base les garde : la plus courte en octets d'abord, puis octet par octet. */
function comparerCles(a: string, b: string): number {
  const x = octetsDe(a)
  const y = octetsDe(b)
  if (x.length !== y.length) return x.length - y.length
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i]
  return 0
}

/** Une chaîne telle que la base l'écrit (`escape_json`) : les six échappements courts, `\u00xx` en minuscules pour les
 * autres caractères de commande, tout le reste tel quel. Une demi-paire de substitution ou le caractère nul ne se
 * gardent pas dans un texte de la base : la base refuserait le contenu. */
function chaineCommeLaBase(s: string): string {
  let sortie = '"'
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = s.charCodeAt(i + 1)
      if (!(d >= 0xdc00 && d <= 0xdfff)) throw new Error('Une chaîne du contenu porte une demi-paire de substitution : la base ne la garde pas.')
      sortie += s[i] + s[i + 1]
      i++
      continue
    }
    if (c >= 0xdc00 && c <= 0xdfff) throw new Error('Une chaîne du contenu porte une demi-paire de substitution : la base ne la garde pas.')
    if (c === 0) throw new Error('Une chaîne du contenu porte le caractère nul : la base ne le garde pas.')
    const court: Record<number, string> = { 8: '\\b', 9: '\\t', 10: '\\n', 12: '\\f', 13: '\\r', 34: '\\"', 92: '\\\\' }
    sortie += court[c] ?? (c < 0x20 ? `\\u${c.toString(16).padStart(4, '0')}` : s[i])
  }
  return `${sortie}"`
}

/** Un nombre tel que la base l'écrit (`numeric`) : les chiffres que JavaScript envoie, jamais un exposant — « 1e-7 »
 * devient « 0.0000001 », comme `numeric_out`. */
function nombreCommeLaBase(n: number): string {
  if (!Number.isFinite(n)) return 'null'
  const texte = String(n)
  if (!texte.includes('e')) return texte
  const [mantisse, exposant] = texte.split('e')
  const negatif = mantisse.startsWith('-')
  const [entier, fraction = ''] = (negatif ? mantisse.slice(1) : mantisse).split('.')
  const chiffres = entier + fraction
  const virgule = entier.length + Number(exposant)
  const absolu = virgule <= 0 ? `0.${'0'.repeat(-virgule)}${chiffres}`
    : virgule >= chiffres.length ? chiffres + '0'.repeat(virgule - chiffres.length)
      : `${chiffres.slice(0, virgule)}.${chiffres.slice(virgule)}`
  return negatif ? `-${absolu}` : absolu
}

/**
 * LE TEXTE QUE LA BASE GARDE D'UN CONTENU (`contenu::text`), depuis la valeur que le navigateur envoie — celle que
 * `JSON.stringify` écrirait : un objet en clés triées par longueur en octets puis octet par octet (`jsonb` ne garde pas
 * l'ordre d'écriture), « , » entre deux éléments et « : » après une clé, les chaînes échappées comme `escape_json`, les
 * nombres sans exposant. C'est ce texte que la base empreinte (`empreinteDuContenu`) et dont elle borne la taille ; la
 * confrontation à une table relevée en base est dans declarationsEreporting.test.ts.
 */
export function formeCanonique(valeur: unknown): string {
  if (valeur != null && typeof (valeur as { toJSON?: unknown }).toJSON === 'function') {
    return formeCanonique((valeur as { toJSON: () => unknown }).toJSON())
  }
  if (valeur === null) return 'null'
  if (typeof valeur === 'boolean') return valeur ? 'true' : 'false'
  if (typeof valeur === 'number') return nombreCommeLaBase(valeur)
  if (typeof valeur === 'string') return chaineCommeLaBase(valeur)
  if (typeof valeur === 'bigint') throw new Error('Un entier long ne s’écrit pas en JSON.')
  if (Array.isArray(valeur)) {
    return `[${valeur.map((v) => (v === undefined || typeof v === 'function' || typeof v === 'symbol' ? 'null' : formeCanonique(v))).join(', ')}]`
  }
  if (typeof valeur === 'object') {
    const entrees = Object.entries(valeur as Record<string, unknown>)
      .filter(([, v]) => v !== undefined && typeof v !== 'function' && typeof v !== 'symbol')
      .sort(([a], [b]) => comparerCles(a, b))
    return `{${entrees.map(([c, v]) => `${chaineCommeLaBase(c)}: ${formeCanonique(v)}`).join(', ')}}`
  }
  throw new Error(`Une valeur que la base ne garde pas : ${typeof valeur}.`)
}

/** L'empreinte que la base calcule d'un contenu : SHA-256 des octets UTF-8 de sa forme canonique, en hexadécimal. */
export async function empreinteDuContenu(contenu: unknown): Promise<string> {
  return empreinte(formeCanonique(contenu))
}

/** Ce que pèse un contenu pour la base, en octets de sa forme canonique. */
export function tailleDuContenu(contenu: unknown): number {
  return octetsDe(formeCanonique(contenu)).length
}

// ── Le contenu à déclarer ───────────────────────────────────────────────────────────────────────────────────────────

export type ContenuDuCalcul = ContenuAchats | ContenuVentes | ContenuPaiements

/** Le contenu qu'une déclaration fige : celui d'e4, précédé de sa version, de son objet et de ses bornes, que la base
 * confronte à ce qui est déclaré. */
export type ContenuDeclare = { version: number; objet: ObjetEreporting; debut: string; fin: string } & ContenuDuCalcul

/** Le contenu à déclarer d'une déclaration calculée par e4 ; null quand elle n'a ni période ni contenu (un arrêt). Que
 * la période se déclare aujourd'hui — ses refus — n'est pas jugé ici : c'est l'écran qui ne propose le geste qu'à une
 * déclaration « à déclarer » sans refus. */
export function contenuADeclarer(d: DeclarationEreporting<ContenuDuCalcul>): ContenuDeclare | null {
  if (d.periode == null || d.contenu == null) return null
  // Le contenu d'e4 vient APRÈS l'enveloppe : une clé d'e4 qui porterait l'un de ses noms la remplacerait, et le refus 22
  // le dirait avant le clic, au lieu d'effacer en silence ce qu'e4 a calculé. Aucune ne le fait aujourd'hui.
  return { version: VERSION_DU_CONTENU, objet: d.objet, debut: d.periode.debut, fin: d.periode.fin, ...d.contenu }
}

// ── Ce que l'écran envoie ───────────────────────────────────────────────────────────────────────────────────────────

/** Ce que le cabinet déclare. Les textes sont ceux de l'écran ; un autre texte est un refus, pas une erreur de type. */
export interface SaisieDeclaration {
  objet: string | null
  debut: string | null
  fin: string | null
  /** Le régime sous lequel l'écran a jugé la période (`regimeDeLaPeriode`). */
  regimeId: string | null
  /** Nul pour une initiale ; l'active de la période pour une rectificative. */
  remplaceId: string | null
  plateforme: string | null
  /** Le contenu à déclarer (`contenuADeclarer`). */
  contenu: unknown
  note: string | null
}

/** Les paramètres de `declarer_ereporting_hors_application`, dans l'ordre de sa signature : le dossier annoncé d'abord, et
 * des dates civiles seules — une autre forme ne parviendrait pas à la fonction. */
export function argumentsDeLaDeclaration(dossierId: string, s: SaisieDeclaration) {
  return {
    p_dossier_id: dossierId,
    p_objet: s.objet,
    p_debut: dateCivileStricte(s.debut),
    p_fin: dateCivileStricte(s.fin),
    p_regime_id: s.regimeId,
    p_remplace_id: s.remplaceId,
    p_plateforme: s.plateforme,
    p_contenu: s.contenu ?? null,
    p_note: s.note,
  }
}

/** Ce que l'écran sait quand il propose de déclarer : les lectures du dossier, EN ENTIER, et le jour à Paris. */
export interface ContexteDeLaDeclaration {
  dossierId: string
  /** Les régimes du dossier, retirés compris (`regimes_ereporting`). */
  regimes: readonly LigneDeRegime[]
  /** Les déclarations du dossier, remplacées comprises. */
  declarations: readonly Pick<DeclarationEreportingHorsApplication, 'id' | 'dossier_id' | 'objet' | 'periode_debut' | 'periode_fin' | 'etat' | 'plateforme'>[]
  /** Les sources de ces déclarations. */
  sources: readonly Pick<SourceDeclarationEreporting, 'declaration_id' | 'genre' | 'source_id'>[]
  /** Les fiches « hors de France » du dossier, toutes versions, et ses pièces. */
  fiches: readonly Pick<PieceHorsDeFrance, 'id' | 'dossier_id' | 'piece_id'>[]
  pieces: readonly Pick<Piece, 'id' | 'dossier_id'>[]
  /** Les factures émises du dossier, et les encaissements de son registre. */
  factures: readonly Pick<FactureEmise, 'id' | 'dossier_id' | 'statut'>[]
  encaissements: readonly Pick<EncaissementFacture, 'id' | 'dossier_id'>[]
  /** Aujourd'hui À PARIS (`aujourdHuiAParis`) : la base lit la date ainsi. */
  aujourdHui: string
}

const estObjet = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)

/** Ce que `->>` rend d'une clé d'un objet `jsonb` : le texte d'une chaîne, nul pour une clé absente ou `null`, la forme
 * canonique de toute autre valeur. */
function texteJson(v: unknown): string | null {
  if (v === undefined || v === null) return null
  return typeof v === 'string' ? v : formeCanonique(v)
}

const parDebutPuisId = (a: { periode_debut: string; id: string }, b: { periode_debut: string; id: string }) =>
  a.periode_debut < b.periode_debut ? -1 : a.periode_debut > b.periode_debut ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0

/**
 * POURQUOI CETTE DÉCLARATION NE SE FERAIT PAS, dit avant le clic, dans l'ordre de la fonction et sous ses mots — sauf
 * l'accès, que l'écran ne peut pas dire. Null : la base l'accepterait. Les identifiants se comparent sous leur forme
 * canonique, celle que les lectures rendent.
 */
export function refusDeclaration(s: SaisieDeclaration, c: ContexteDeLaDeclaration): RefusDeclaration | null {
  // 2. L'objet ; 3. les bornes, des dates civiles.
  const objet = OBJETS_DECLARES.find((o) => o === s.objet)
  if (objet == null) return dire('objet')
  const debut = dateCivileStricte(s.debut)
  const fin = dateCivileStricte(s.fin)
  if (debut == null || fin == null) return dire('bornes_absentes')
  // 4 à 8. Le régime : du dossier, actif, qui couvre le premier jour, en vigueur ce jour-là, sans changement jusqu'à la fin.
  const regime = c.regimes.find((r) => r.id === uuidCommeLaBase(s.regimeId) && r.dossier_id === c.dossierId)
  if (regime == null) return dire('regime_introuvable')
  if (regime.retire_le != null) return dire('regime_retire')
  if (regime.depuis > debut) return dire('regime_posterieur', formatDate(regime.depuis))
  const actifs = c.regimes.filter((r) => r.dossier_id === c.dossierId && r.retire_le == null)
  const suivant = actifs.filter((r) => r.depuis > regime.depuis && r.depuis <= debut).sort((a, b) => (a.depuis < b.depuis ? 1 : -1))[0]
  if (suivant) return dire('regime_depasse', formatDate(debut), formatDate(suivant.depuis))
  const change = actifs.filter((r) => r.depuis > debut && r.depuis <= fin && !memeRegime(r, regime))
    .sort((a, b) => (a.depuis < b.depuis ? -1 : 1))[0]
  if (change) return dire('regime_change', formatDate(change.depuis))
  // 9 et 10. La fréquence de l'objet, et la période qu'elle donne au premier jour (e1).
  const frequence = objet === 'paiements' ? regime.frequence_paiements : regime.frequence_transactions
  if (frequence == null) return dire('paiements_sur_debits')
  const periode = periodeDe(debut, frequence)
  if (periode == null || periode.debut !== debut || periode.fin !== fin) {
    return dire('periode_hors_regime', formatDate(debut), formatDate(fin), rythme(frequence))
  }
  // 11. L'obligation.
  if (fin < DEBUT_EREPORTING_PME) return dire('avant_l_obligation', formatDate(fin))
  // 12. Une déclaration active d'autres bornes qui chevauche la période.
  const actives = c.declarations.filter((d) => d.dossier_id === c.dossierId && d.etat === 'declaree')
  const autre = actives
    .filter((d) => d.objet === objet && !(d.periode_debut === debut && d.periode_fin === fin)
      && d.periode_debut <= fin && debut <= d.periode_fin)
    .sort(parDebutPuisId)[0]
  if (autre) return dire('chevauchement', formatDate(autre.periode_debut), formatDate(autre.periode_fin))
  // 13 à 16. L'initiale, ou la rectificative et la déclaration qu'elle remplace.
  const remplaceId = s.remplaceId == null ? null : uuidCommeLaBase(s.remplaceId)
  if (s.remplaceId == null) {
    const active = actives.find((d) => d.objet === objet && d.periode_debut === debut && d.periode_fin === fin)
    if (active) return dire('deja_declaree', active.plateforme)
  } else {
    const remplacee = c.declarations.find((d) => d.id === remplaceId && d.dossier_id === c.dossierId)
    if (remplacee == null) return dire('remplacee_introuvable')
    if (remplacee.objet !== objet || remplacee.periode_debut !== debut || remplacee.periode_fin !== fin) return dire('remplacee_autre_periode')
    if (remplacee.etat !== 'declaree') return dire('remplacee_deja')
  }
  // 17 à 19. La plateforme et la note.
  if (s.plateforme == null || blanc(s.plateforme)) return dire('plateforme_absente')
  if (caracteres(s.plateforme) > LONGUEUR_MAXIMALE_PLATEFORME) return dire('plateforme_trop_longue')
  if (s.note != null && !blanc(s.note) && caracteres(s.note) > LONGUEUR_MAXIMALE_NOTE) return dire('note_trop_longue')
  // 20 à 22. Le contenu : un objet d'un mégaoctet au plus, sur l'objet, les bornes et le rôle annoncés.
  const contenu = s.contenu
  if (!estObjet(contenu)) return dire('contenu_absent')
  if (tailleDuContenu(contenu) > TAILLE_MAXIMALE_CONTENU) return dire('contenu_trop_grand')
  if (texteJson(contenu.objet) !== objet || texteJson(contenu.debut) !== debut || texteJson(contenu.fin) !== fin
    || texteJson(contenu.role) !== ROLE_DU_DECLARANT[objet]) return dire('contenu_autre')
  // 23 et 24. Les opérations, lisibles, et datées dans la période.
  const operations = operationsLisibles(objet, contenu[CLE_DES_OPERATIONS[objet]])
  if (operations == null) return dire('contenu_illisible')
  const horsPeriode = operations.map((o) => o.date).filter((d) => d < debut || d > fin).sort()[0]
  if (horsPeriode) return dire('operation_hors_periode', formatDate(horsPeriode))
  // 25 à 27. Au moins une opération, aucune source deux fois, le nombre annoncé.
  const ids = operations.flatMap((o) => o.sources)
  if (ids.length === 0) return dire('a_blanc')
  if (new Set(ids).size !== ids.length) return dire('source_en_double')
  if (typeof contenu.nombreOperations !== 'number' || contenu.nombreOperations !== ids.length) {
    return dire('nombre_operations', String(ids.length))
  }
  // 28. Des sources de ce dossier : pour un achat, la fiche nommée — n'importe laquelle de ses versions, la base ne juge
  // pas ici laquelle (« à rectifier » le dira) — dont la pièce est celle que l'achat nomme, et cette pièce, du dossier ;
  // une facture validée ; un encaissement.
  const pieces = operations.map((o) => o.piece).filter((p): p is string => p != null)
  const connue = (o: OperationLisible): boolean => {
    if (objet === 'achats') {
      return c.fiches.some((f) => f.id === o.sources[0] && f.dossier_id === c.dossierId && f.piece_id === o.piece)
        && c.pieces.some((p) => p.id === o.piece && p.dossier_id === c.dossierId)
    }
    if (objet === 'ventes') {
      return o.sources.every((id) => c.factures.some((f) => f.id === id && f.dossier_id === c.dossierId && f.statut === 'validee'))
    }
    return o.sources.every((id) => c.encaissements.some((e) => e.id === id && e.dossier_id === c.dossierId))
  }
  if (!operations.every(connue)) return dire('source_inconnue', SOURCES_ATTENDUES[objet])
  // 29. Une opération qu'une autre déclaration active porte déjà — pour un achat, la même pièce, quelle que soit la
  // version de sa fiche ; la déclaration que la rectificative remplace ne compte pas.
  const piecesDesFiches = new Map(c.fiches.map((f) => [f.id, f.piece_id]))
  const genre = GENRE_DES_SOURCES[objet]
  const dejaDeclaree = actives
    .filter((d) => d.id !== remplaceId && c.sources.some((x) => x.declaration_id === d.id && x.genre === genre
      && (objet === 'achats' ? pieces.includes(piecesDesFiches.get(x.source_id) ?? '') : ids.includes(x.source_id))))
    .sort(parDebutPuisId)[0]
  if (dejaDeclaree) return dire('source_deja_declaree', formatDate(dejaDeclaree.periode_debut), formatDate(dejaDeclaree.periode_fin))
  // 30. La période finie, à Paris.
  if (fin >= c.aujourdHui) return dire('periode_en_cours', formatDate(ajouterJours(fin, 1)))
  return null
}

interface OperationLisible {
  date: string
  /** Les identifiants de ses sources, sous leur forme canonique : la fiche d'un achat, les factures ou les encaissements
   * d'un agrégat. */
  sources: string[]
  /** La pièce d'un achat. */
  piece: string | null
}

/** Les opérations d'un contenu comme la base les lit (refus 23) : un tableau d'objets, chacun sa date civile et ses
 * sources ; null dès que l'une ne se lit pas. */
function operationsLisibles(objet: ObjetEreporting, brut: unknown): OperationLisible[] | null {
  if (!Array.isArray(brut)) return null
  const lues: OperationLisible[] = []
  for (const o of brut) {
    if (!estObjet(o)) return null
    const date = typeof o.date === 'string' ? dateCivileStricte(o.date) : null
    if (date == null) return null
    if (objet === 'achats') {
      const fiche = uuidCommeLaBase(o.ficheId)
      const piece = uuidCommeLaBase(o.pieceId)
      if (fiche == null || piece == null) return null
      lues.push({ date, sources: [fiche], piece })
    } else {
      const liste = o[LISTE_DES_SOURCES[objet]]
      if (!Array.isArray(liste)) return null
      const sources = liste.map(uuidCommeLaBase)
      if (sources.some((x) => x == null)) return null
      lues.push({ date, sources: sources as string[], piece: null })
    }
  }
  return lues
}

// ── Les déclarations d'un dossier ───────────────────────────────────────────────────────────────────────────────────

type LigneDeDeclaration = Pick<DeclarationEreportingHorsApplication, 'id' | 'dossier_id' | 'objet' | 'periode_debut' | 'periode_fin' | 'etat'>

/** La déclaration ACTIVE d'un dossier pour un objet et une période — une seule : la base le garantit. */
export function declarationActive<D extends LigneDeDeclaration>(
  declarations: readonly D[], dossierId: string, objet: ObjetEreporting, periode: { debut: string; fin: string },
): D | null {
  return declarations.find((d) => d.dossier_id === dossierId && d.objet === objet && d.etat === 'declaree'
    && d.periode_debut === periode.debut && d.periode_fin === periode.fin) ?? null
}

/**
 * LA DÉCLARATION QUI RETIENT UNE PIÈCE (hypothèse E5-Q6, `garder_piece_declaree`) : la première active — par sa période —
 * dont une source est une fiche de la pièce, n'importe quelle version, et le refus que la base opposerait à sa
 * suppression ; null : rien ne la retient. Seules comptent les fiches du dossier de la pièce et les sources de leurs
 * déclarations.
 */
export function declarationQuiRetientLaPiece<D extends LigneDeDeclaration>(
  pieceId: string,
  lectures: {
    fiches: readonly Pick<PieceHorsDeFrance, 'id' | 'dossier_id' | 'piece_id'>[]
    declarations: readonly D[]
    sources: readonly Pick<SourceDeclarationEreporting, 'declaration_id' | 'dossier_id' | 'genre' | 'source_id'>[]
  },
): { declaration: D; message: string } | null {
  const fiches = lectures.fiches.filter((f) => f.piece_id === pieceId)
  const declaration = lectures.declarations
    .filter((d) => d.etat === 'declaree' && lectures.sources.some((s) => s.declaration_id === d.id && s.genre === 'fiche'
      && fiches.some((f) => f.id === s.source_id && f.dossier_id === s.dossier_id)))
    .sort(parDebutPuisId)[0]
  if (declaration == null) return null
  return {
    declaration,
    message: remplirModele(REFUS_SUPPRESSION_PIECE, [formatDate(declaration.periode_debut), formatDate(declaration.periode_fin)]),
  }
}

// ── À rectifier ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** Une opération déclarée qui ne l'est plus de la même façon : la clé est la pièce d'un achat, le jour, la catégorie et
 * l'option d'un agrégat de ventes, le jour d'un agrégat de paiements — ou `declarant` pour l'identité du déclarant. */
export interface DifferenceDOperation {
  sorte: 'ajoutee' | 'retiree' | 'changee'
  cle: string
  /** Le jour de l'opération (celui d'aujourd'hui, ou celui qui avait été déclaré) ; nul pour le déclarant. */
  date: string | null
  /** Les champs déclarés qui ont changé, pour une opération changée. */
  champs: string[]
  /** Les sources entrées dans l'opération, et celles qui en sont sorties. */
  sourcesAjoutees: SourceEreporting[]
  sourcesRetirees: SourceEreporting[]
}

/** Ce qui fait passer une période déclarée « à rectifier », jamais un refus (conception d'e5b, § 3). Les instants sont
 * ceux de la base. */
export type CauseARectifier =
  /** Le régime sous lequel la période a été déclarée est retiré (hypothèse E5-Q7). */
  | { cause: 'regime_retire'; regimeId: string; le: string }
  /** Une pièce écartée au moment de la déclaration ne l'est plus : elle est de nouveau à vérifier. */
  | { cause: 'ecart_retire'; pieceId: string; le: string }
  /** Une fiche posée après la déclaration décrit un achat de la période. */
  | { cause: 'fiche_posee_apres'; pieceId: string; ficheId: string; le: string }
  /** La fiche d'un achat déclaré a été remplacée ou retirée après la déclaration. */
  | { cause: 'fiche_changee_apres'; pieceId: string; ficheId: string; le: string }

export interface EtatDeLaDeclaration {
  /** À jour : ce qui a été déclaré est ce que l'application calcule aujourd'hui ; à rectifier : ils diffèrent, ou une
   * cause le demande ; indéterminé : aujourd'hui ne se calcule pas en entier, et rien ne s'affirme. */
  etat: 'a_jour' | 'a_rectifier' | 'indetermine'
  differences: DifferenceDOperation[]
  causes: CauseARectifier[]
  /** Ce que le calcul d'aujourd'hui refuse (lib/ereporting.ts) : pourquoi rien ne s'affirme, ou pourquoi la rectificative
   * ne se fait pas encore. */
  refus: RefusEreporting[]
  /** Pourquoi rien ne s'affirme de ce module : une lecture partielle, un contenu figé illisible. */
  motifs: string[]
}

/** Ce qu'il faut pour dire les causes : les régimes, les écarts et les fiches du dossier, lus EN ENTIER. */
export interface ContexteDesCauses {
  regimes: Lecture<Pick<RegimeEreporting, 'id' | 'retire_le'>>
  ecarts: Lecture<Pick<PieceEcarteeEreporting, 'piece_id' | 'cree_le' | 'retire_le'>>
  fiches: Lecture<Pick<PieceHorsDeFrance, 'id' | 'piece_id' | 'cree_le' | 'retire_le'>>
}

type DeclarationFigee = Pick<DeclarationEreportingHorsApplication, 'objet' | 'periode_debut' | 'periode_fin' | 'regime_id' | 'contenu' | 'cree_le'>

interface OperationComparee {
  cle: string
  date: string
  sources: string[]
  /** Chaque champ déclaré, sous sa forme canonique. */
  champs: Map<string, string>
  piece: string | null
}

/** Les champs qui NOMMENT une opération ou ses sources : ils ne se comparent pas comme des données déclarées. */
const HORS_DES_CHAMPS: Readonly<Record<ObjetEreporting, readonly string[]>> = {
  achats: ['ficheId', 'pieceId'],
  ventes: ['date', 'categorie', 'optionDebits', 'factures'],
  paiements: ['date', 'encaissements'],
}

/** Les opérations d'un contenu déclaré ou calculé, lues sans rien deviner : null quand l'une ne se lit pas. */
function operationsComparees(objet: ObjetEreporting, contenu: unknown): Map<string, OperationComparee> | null {
  if (!estObjet(contenu)) return null
  const brut = contenu[CLE_DES_OPERATIONS[objet]]
  const lisibles = operationsLisibles(objet, brut)
  if (lisibles == null) return null
  const operations = new Map<string, OperationComparee>()
  for (const [i, o] of (brut as Record<string, unknown>[]).entries()) {
    const lue = lisibles[i]
    const cle = objet === 'achats' ? (lue.piece as string)
      : objet === 'ventes' ? `${lue.date}|${texteJson(o.categorie)}|${texteJson(o.optionDebits)}` : lue.date
    if (operations.has(cle)) return null
    const champs = new Map(Object.entries(o).filter(([k, v]) => !HORS_DES_CHAMPS[objet].includes(k) && v !== undefined)
      .map(([k, v]) => [k, formeCanonique(v)]))
    operations.set(cle, { cle, date: lue.date, sources: lue.sources, champs, piece: lue.piece })
  }
  return operations
}

const CHAMPS_DU_DECLARANT = ['role', 'siren', 'numeroTva'] as const
const instant = (x: string) => Date.parse(x)

/**
 * L'ÉTAT D'UNE DÉCLARATION ACTIVE, face à ce qu'e4 calcule AUJOURD'HUI pour la même période (`aujourdhui`, avec les
 * lectures d'aujourd'hui) : à jour, à rectifier — et en quoi, opération par opération —, ou indéterminé. Une rectificative
 * remplace la période entière : la liste des écarts dit pourquoi la refaire, jamais une opération à ajouter seule. Une
 * cause suffit à la dire « à rectifier », même quand aujourd'hui ne se calcule pas en entier ; sans cause, un calcul
 * incomplet ou une lecture partielle ne laissent rien affirmer.
 */
export function etatDeLaDeclaration(
  declaree: DeclarationFigee,
  aujourdhui: DeclarationEreporting<ContenuDuCalcul>,
  contexte: ContexteDesCauses,
): EtatDeLaDeclaration {
  const indetermine = (motifs: string[], refus: RefusEreporting[] = []): EtatDeLaDeclaration =>
    ({ etat: 'indetermine', differences: [], causes: [], refus, motifs })
  const partielles = Object.entries(contexte).filter(([, l]) => !l.complete)
    .map(([nom, l]) => `La lecture ${NOMS_DES_LECTURES[nom] ?? nom} n'est pas revenue entière (${l.motif ?? 'sans motif rendu'}).`)
  if (partielles.length > 0) return indetermine(partielles)
  if (aujourdhui.objet !== declaree.objet) throw new Error('La déclaration et le calcul ne portent pas sur le même objet.')
  const objet = declaree.objet
  const figees = operationsComparees(objet, declaree.contenu)
  if (figees == null) return indetermine(['Le contenu figé de la déclaration ne se lit pas : une ligne écrite d’ailleurs que par sa fonction.'])

  const causes: CauseARectifier[] = []
  const declareeLe = instant(declaree.cree_le)
  const regime = contexte.regimes.lignes.find((r) => r.id === declaree.regime_id)
  if (regime?.retire_le != null) causes.push({ cause: 'regime_retire', regimeId: regime.id, le: regime.retire_le })

  // Les sources d'aujourd'hui qui désignent une pièce : les achats calculés, et les refus qui la nomment.
  const calculees = aujourdhui.contenu == null ? null : operationsComparees(objet, contenuADeclarer(aujourdhui))
  const piecesDuJour = new Set<string>([
    ...[...(calculees?.values() ?? [])].map((o) => o.piece).filter((p): p is string => p != null),
    ...aujourdhui.refus.flatMap((r) => r.sources).filter((s) => s.genre === 'piece').map((s) => s.id),
  ])
  if (objet === 'achats') {
    // Une pièce que le calcul d'aujourd'hui fait attendre, écartée au moment de la déclaration, et reprise depuis.
    const enAttente = new Set(aujourdhui.refus.filter((r) => r.cle === 'achat_a_verifier' || r.cle === 'achat_avec_tva')
      .flatMap((r) => r.sources).filter((s) => s.genre === 'piece').map((s) => s.id))
    for (const pieceId of [...enAttente].sort()) {
      const repris = contexte.ecarts.lignes
        .filter((e) => e.piece_id === pieceId && e.retire_le != null && instant(e.cree_le) <= declareeLe
          && instant(e.retire_le) > declareeLe)
        .sort((a, b) => instant(a.retire_le as string) - instant(b.retire_le as string))[0]
      if (repris) causes.push({ cause: 'ecart_retire', pieceId, le: repris.retire_le as string })
    }
    // Les fiches d'une pièce déclarée, remplacées ou retirées depuis ; celles d'une pièce que le jour porte, posées depuis.
    const pieceDeclarees = new Set([...figees.values()].map((o) => o.piece as string))
    for (const pieceId of [...new Set([...pieceDeclarees, ...piecesDuJour])].sort()) {
      const siennes = contexte.fiches.lignes.filter((f) => f.piece_id === pieceId)
      if (pieceDeclarees.has(pieceId)) {
        const apres = siennes
          .flatMap((f) => [
            ...(instant(f.cree_le) > declareeLe ? [{ ficheId: f.id, le: f.cree_le }] : []),
            ...(f.retire_le != null && instant(f.retire_le) > declareeLe ? [{ ficheId: f.id, le: f.retire_le }] : []),
          ])
          .sort((a, b) => instant(a.le) - instant(b.le))[0]
        if (apres) causes.push({ cause: 'fiche_changee_apres', pieceId, ...apres })
      } else if (siennes.length > 0 && siennes.every((f) => instant(f.cree_le) > declareeLe)) {
        const premiere = [...siennes].sort((a, b) => instant(a.cree_le) - instant(b.cree_le))[0]
        causes.push({ cause: 'fiche_posee_apres', pieceId, ficheId: premiere.id, le: premiere.cree_le })
      }
    }
  }

  // Sans calcul entier d'aujourd'hui — un arrêt d'e4 (aucun contenu), ou une opération qu'il refuse (l'état
  // « incomplète », qu'e4 réserve aux refus qui en changent l'état) —, une cause dit « à rectifier » ; rien d'autre ne
  // s'affirme.
  if (calculees == null || aujourdhui.etat === 'incomplete') {
    return { etat: causes.length > 0 ? 'a_rectifier' : 'indetermine', differences: [], causes, refus: aujourdhui.refus, motifs: [] }
  }

  const differences: DifferenceDOperation[] = []
  const genre = GENRE_DES_SOURCES[objet]
  const sources = (ids: readonly string[]) => [...ids].sort().map((id) => ({ genre, id }))
  for (const cle of [...new Set([...figees.keys(), ...calculees.keys()])]) {
    const avant = figees.get(cle)
    const apres = calculees.get(cle)
    if (avant == null && apres != null) {
      differences.push({ sorte: 'ajoutee', cle, date: apres.date, champs: [], sourcesAjoutees: sources(apres.sources), sourcesRetirees: [] })
    } else if (avant != null && apres == null) {
      differences.push({ sorte: 'retiree', cle, date: avant.date, champs: [], sourcesAjoutees: [], sourcesRetirees: sources(avant.sources) })
    } else if (avant != null && apres != null) {
      const champs = [...new Set([...avant.champs.keys(), ...apres.champs.keys()])].sort()
        .filter((k) => avant.champs.get(k) !== apres.champs.get(k))
      const entrees = apres.sources.filter((id) => !avant.sources.includes(id))
      const sorties = avant.sources.filter((id) => !apres.sources.includes(id))
      // Une nouvelle version de la fiche d'un achat qui déclare la même chose n'est pas un écart : seules ses données le sont.
      if (champs.length > 0 || (objet !== 'achats' && (entrees.length > 0 || sorties.length > 0))) {
        differences.push({ sorte: 'changee', cle, date: apres.date, champs, sourcesAjoutees: sources(entrees), sourcesRetirees: sources(sorties) })
      }
    }
  }
  differences.sort((a, b) => ((a.date ?? '') < (b.date ?? '') ? -1 : (a.date ?? '') > (b.date ?? '') ? 1 : a.cle < b.cle ? -1 : a.cle > b.cle ? 1 : 0))
  const declarantAvant = estObjet(declaree.contenu) ? declaree.contenu : {}
  const declarantApres = contenuADeclarer(aujourdhui) as unknown as Record<string, unknown>
  const declarant = CHAMPS_DU_DECLARANT.filter((k) => texteJson(declarantAvant[k]) !== texteJson(declarantApres[k]))
  if (declarant.length > 0) {
    differences.unshift({ sorte: 'changee', cle: 'declarant', date: null, champs: [...declarant], sourcesAjoutees: [], sourcesRetirees: [] })
  }
  return {
    etat: differences.length > 0 || causes.length > 0 ? 'a_rectifier' : 'a_jour',
    differences, causes, refus: aujourdhui.refus, motifs: [],
  }
}

const NOMS_DES_LECTURES: Readonly<Record<string, string>> = {
  regimes: 'des régimes confirmés',
  ecarts: 'des pièces écartées',
  fiches: 'des fiches « fournisseur établi hors de France »',
}
