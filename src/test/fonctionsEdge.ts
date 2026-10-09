import { createHmac, timingSafeEqual } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { format } from 'node:util'
import ts from 'typescript'
import { predicatEq, predicatIn, predicatIs, predicatNot, predicatOr, type Ligne, type Predicat } from './filtresPostgrest'
import { clesPrimairesDuSchema, fichiersDuSchema, relationsDuSchema, type RelationDuSchema } from './schema'

// LES EDGE FUNCTIONS APPELÉES EN HTTP, DANS LA SUITE — DEPUIS LEUR VRAIE SOURCE, SANS RÉSEAU, SANS SECRET, SANS APPEL
// FACTURÉ (ligne 23 de la feuille de route).
//
// Jusqu'ici une Edge Function était gardée par des BLOCS — extraits de sa source, transpilés, exécutés — et par des
// scanners qui lisent son TEXTE. Ce que rien ne faisait, c'est l'APPELER : avec une session ou sans, avec un compte
// rattaché à rien, un client, un membre d'équipe qui n'est pas assigné au dossier, un corps illisible. L'ordre « contrôle
// de l'appelant, puis dépense » se lisait sur la source par des positions de chaînes, et chaque déploiement se vérifiait
// à la main. Les appeler une fois déployées demanderait des secrets et des appels facturés, depuis une CI qui n'a ni
// l'un ni l'autre. Ce harnais lève l'obstacle sans le payer.
//
// LA FORME, ET POURQUOI CELLE-CI :
//   - la source ENTIÈRE de `supabase/functions/<fonction>/index.ts` est transpilée par le compilateur du projet
//     (`ts.transpileModule`, en CommonJS) puis exécutée par `new Function` — l'idiome des gardes de copie, appliqué au
//     fichier au lieu d'un bloc. Rien n'est écrit sur disque et aucun chargeur de modules n'intervient : une source
//     MUTÉE se charge comme la vraie, en mémoire, sans que le fichier servi pendant la suite change d'un octet ;
//   - ses imports (`npm:`, `jsr:`) se résolvent vers des FAUX déclarés ici, et un import que le harnais ne connaît pas
//     LÈVE : une version de SDK changée, un module ajouté se voient au premier chargement ;
//   - `Deno` est un faux à deux portes : `Deno.serve` CAPTURE le gestionnaire, `Deno.env.get` rend un environnement
//     d'essai dont les clés sont FABRIQUÉES (`sb_publishable_…`, `sb_secret_…` trop courts pour passer pour de vraies,
//     voir `clesSupabase.test.ts`) ;
//   - `fetch`, `console`, `Date` et `setTimeout` lui sont passés en paramètres : la fonction ne voit QUE le réseau que le
//     test déclare (un hôte inconnu lève, et la tentative se compte), ses journaux se relisent, et son horloge se décale
//     sans toucher à celle de la suite ;
//   - le MONDE qu'elle rencontre — la base, dont les filtres s'APPLIQUENT et dont les clés (primaires, étrangères) sont
//     lues dans le schéma exporté ; la RLS des lectures faites avec le jeton de l'appelant ; le service
//     d'authentification, qui dit qui est la session ; la passerelle et son `verify_jwt`, lu dans `config.toml` ; le
//     stockage, AWS, Bedrock, Resend — est un objet du test, qui JOURNALISE tout ce qu'on lui demande. Un contrat se juge
//     sur ce journal : « aucune dépense avant le contrôle » est un journal sans dépense, pas une relecture de l'ordre
//     des lignes.
// Le gestionnaire capturé reçoit de vraies `Request` et rend de vraies `Response`.
//
// CE QUE CE HARNAIS NE PROUVE PAS, annoncé plutôt que laissé croire : que les faux se comportent comme les vrais
// services. Chaque faux reproduit ce que la documentation publique du service décrit — la signature d'un webhook Svix,
// l'en-tête porteur que lit le service d'authentification, la ligne unique de PostgREST (PGRST116) — et lève sur toute
// forme qu'il ne modélise pas, plutôt que de répondre au hasard. Un premier appel réel reste la seule preuve qu'une
// plateforme répond comme on le croit.

// ── LES SOURCES ET LEUR CONFIGURATION ────────────────────────────────────────────────────────────────────────────────

export const RACINE_FONCTIONS = new URL('../../supabase/functions/', import.meta.url)
const CONFIG = new URL('../../supabase/config.toml', import.meta.url)

/** Toutes les fonctions du dépôt : chaque dossier de `supabase/functions/`. Le garde part d'ici, jamais d'une liste. */
export function slugsDesFonctions(): string[] {
  return readdirSync(RACINE_FONCTIONS, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
}

/** La source servie d'une fonction. Un dossier sans `index.ts` lève : la plateforme ne saurait pas quoi déployer. */
export function sourceDe(slug: string): string {
  return readFileSync(new URL(`${slug}/index.ts`, RACINE_FONCTIONS), 'utf8')
}

/**
 * Une copie MUTÉE d'une source, en mémoire : chaque remplacement se pose UNE fois, et une ancre absente ou ambiguë
 * lève — une mutation qui ne s'applique pas ne prouve rien. Le fichier servi pendant la suite ne change jamais.
 */
export function muter(source: string, remplacements: readonly (readonly [string, string])[]): string {
  let mutee = source
  for (const [avant, apres] of remplacements) {
    const n = mutee.split(avant).length - 1
    if (n !== 1) throw new Error(`ancre trouvée ${n} fois : ${avant.slice(0, 80)}`)
    mutee = mutee.replace(avant, () => apres)
  }
  return mutee
}

/**
 * Le `verify_jwt` d'une fonction, tel que `supabase/config.toml` le fixe — la valeur que tout déploiement repasse. Une
 * fonction sans section lève : la passerelle la traiterait à `true`, et le harnais ne devine pas.
 */
export function verifyJwtDe(slug: string): boolean {
  const texte = readFileSync(CONFIG, 'utf8')
  const section = new RegExp(`^\\[functions\\.${slug.replace(/[-]/g, '\\-')}\\]\\s*\\nverify_jwt = (true|false)$`, 'm')
    .exec(texte)
  if (!section) throw new Error(`config.toml ne fixe pas verify_jwt pour « ${slug} »`)
  return section[1] === 'true'
}

// ── L'ENVIRONNEMENT D'ESSAI : RIEN DE VRAI ───────────────────────────────────────────────────────────────────────────
// Des valeurs FABRIQUÉES, de la forme que les fonctions vérifient (le préfixe des clés de Supabase), jamais assez
// longues pour passer pour une clé réelle : `clesSupabase.test.ts` refuse tout fichier suivi qui porterait
// `sb_secret_` suivi de vingt caractères. Aucun secret n'est lu, ni pour « vérifier une forme ».

export const URL_PROJET = 'https://projet-essai.supabase.invalid'
export const CLE_PUBLIABLE = 'sb_publishable_harnais'
export const CLE_SECRETE = 'sb_secret_harnais'
export const SECRET_AWS = 'secret-aws-du-harnais'
export const CLE_RESEND = 'cle-resend-du-harnais'
/** Le secret d'un webhook Svix : `whsec_` puis une clé en base 64 (documentation publique de Svix). */
export const SECRET_WEBHOOK = `whsec_${Buffer.from('secret-du-webhook-du-harnais').toString('base64')}`

export type Environnement = Record<string, string | undefined>

export function environnementEssai(): Environnement {
  return {
    SUPABASE_URL: URL_PROJET,
    SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: CLE_PUBLIABLE }),
    SUPABASE_SECRET_KEYS: JSON.stringify({ default: CLE_SECRETE }),
    AWS_ACCESS_KEY_ID: 'identifiant-aws-du-harnais',
    AWS_SECRET_ACCESS_KEY: SECRET_AWS,
    AWS_REGION: 'eu-central-1',
    AWS_TEXTRACT_BUCKET: 'seau-du-harnais',
    RESEND_API_KEY: CLE_RESEND,
    RESEND_WEBHOOK_SECRET: SECRET_WEBHOOK,
  }
}

// ── LE MONDE QUE LA FONCTION RENCONTRE ───────────────────────────────────────────────────────────────────────────────

export type Role = 'service' | 'authentifie' | 'anonyme' | 'refuse'
export type Operation = 'select' | 'insert' | 'upsert' | 'update' | 'delete'

/** Ce que la fonction a demandé au monde, dans l'ordre. Rien de ce qui passe ici n'est un secret ni un mot de passe. */
export type Evenement =
  | { genre: 'client'; cle: 'publiable' | 'secrete' | 'inconnue'; porteur: boolean }
  | { genre: 'session'; utilisateur: string | null }
  | { genre: 'comptes'; operation: string }
  | { genre: 'lecture'; table: string; role: Role; filtres: string[] }
  | { genre: 'ecriture'; table: string; operation: Exclude<Operation, 'select'>; role: Role }
  | { genre: 'rpc'; nom: string; role: Role }
  | { genre: 'stockage'; seau: string; operation: string; chemins: string[] }
  | { genre: 'reseau'; hote: string; methode: string; chemin: string; declare: boolean }
  | { genre: 'client-aws'; service: 'textract' | 's3' | 'bedrock'; region: unknown }
  | { genre: 'aws'; service: 'textract' | 's3'; commande: string; region: unknown }
  | { genre: 'modele'; modele: unknown; region: unknown }
  | { genre: 'resend'; operation: 'verifier' | 'envoyer' | 'piece-jointe' }

export interface ErreurFactice {
  message: string
  code?: string
  status?: number
  details?: string
}

/**
 * Une panne posée par le test : la prochaine demande qui lui correspond rend cette erreur — `fois` : combien de fois ;
 * `sauter` : combien de demandes correspondantes passent d'abord (la seconde lecture d'une table, pas la première).
 */
export type Panne = { erreur: ErreurFactice; fois?: number; sauter?: number } & (
  | { table: string; operation?: Operation }
  | { rpc: string }
  | { auth: 'getUser' | 'createUser' | 'listUsers' | 'updateUserById' | 'getUserById' }
  | { stockage: 'upload' | 'remove' }
)

export type Traitant = (requete: Request) => Response | Promise<Response>

export interface Compte {
  id: string
  email: string
}

export interface Monde {
  /** Les tables de `public`, ligne par ligne. Une table que le schéma exporté ne connaît pas lève à la première demande. */
  base: Record<string, Ligne[]>
  /** Les contraintes d'unicité au-delà de la clé primaire, que le schéma exporté ne porte pas sous une forme lue ici. */
  uniques: Record<string, string[][]>
  /** Ce que la base remplit elle-même à l'insertion (une valeur par défaut, un déclencheur). */
  defauts: Record<string, (ligne: Ligne) => Ligne>
  /** `auth.users`. */
  comptes: Compte[]
  /** Les jetons de session que le service d'authentification reconnaît (et que la passerelle tient pour des JWT signés). */
  sessions: Record<string, string>
  /** Le réseau, hôte par hôte. Un hôte absent lève : le réseau du harnais est FERMÉ. */
  hotes: Record<string, Traitant>
  textract: ((commande: string, entree: Record<string, unknown>) => unknown) | null
  s3: ((commande: string, entree: Record<string, unknown>) => unknown) | null
  modele: ((demande: Record<string, unknown>) => unknown) | null
  resend: {
    envoyer: ((message: Record<string, unknown>) => unknown) | null
    pieceJointe: ((demande: Record<string, unknown>) => unknown) | null
  }
  fichiers: Map<string, unknown>
  pannes: Panne[]
  /** Les lignes que PostgREST rend au plus par requête (« Max rows », 1 000 par défaut), sans le dire. */
  maxLignes: number
  /** Ce qu'on ajoute à l'horloge réelle, DANS la fonction seulement (une fenêtre datée, un mois de plafond). */
  decalageHorloge: number
  /** Les minuteries de la fonction partent tout de suite (un sondage de deux secondes ne fait pas attendre la suite). */
  minuteriesImmediates: boolean
  journal: Evenement[]
  journaux: { niveau: string; texte: string }[]
  /** Les exceptions que la fonction a laissé filer jusqu'à `Deno.serve`. */
  exceptions: unknown[]
  /** Les valeurs qu'aucune réponse ni aucun journal ne doit porter : les secrets du monde. */
  secrets: string[]
  /** Les valeurs d'une pièce ou d'un document : jamais dans un journal, jamais dans une réponse d'erreur. */
  sensibles: string[]
  /** Ce qu'un scénario relève en chemin (une demande faite au modèle, un appel d'une fonction à une autre). */
  notes: Record<string, unknown[]>
}

export function nouveauMonde(): Monde {
  return {
    base: {},
    uniques: {},
    defauts: {},
    comptes: [],
    sessions: {},
    hotes: {},
    textract: null,
    s3: null,
    modele: null,
    resend: { envoyer: null, pieceJointe: null },
    fichiers: new Map(),
    pannes: [],
    maxLignes: 1000,
    decalageHorloge: 0,
    minuteriesImmediates: false,
    journal: [],
    journaux: [],
    exceptions: [],
    secrets: [CLE_SECRETE, SECRET_AWS, CLE_RESEND, SECRET_WEBHOOK],
    sensibles: [],
    notes: {},
  }
}

/** La panne qui répond à cette demande, consommée si elle a un nombre de fois. */
function panneDe(monde: Monde, correspond: (p: Panne) => boolean): ErreurFactice | null {
  const index = monde.pannes.findIndex(correspond)
  if (index < 0) return null
  const panne = monde.pannes[index]
  if (panne.sauter !== undefined && panne.sauter > 0) {
    panne.sauter -= 1
    return null
  }
  if (panne.fois !== undefined) {
    panne.fois -= 1
    if (panne.fois <= 0) monde.pannes.splice(index, 1)
  }
  return panne.erreur
}

let compteurIdentifiants = 0
/** Un identifiant de la forme d'un uuid, DÉTERMINISTE : un essai rejoué rend les mêmes lignes. */
export function identifiantGenere(): string {
  compteurIdentifiants += 1
  return `00000000-0000-4000-8000-${compteurIdentifiants.toString(16).padStart(12, '0')}`
}

// ── LE SCHÉMA : CE QUE LA BASE SAIT DE SES TABLES ────────────────────────────────────────────────────────────────────
// Lu une fois dans l'export (`src/test/schema.ts`) : les tables qui existent, leur clé primaire, leurs clés étrangères.
// Une fonction qui demande une table inconnue se fait répondre ce que répond PostgREST (PGRST205) ; une insertion qui
// désigne une ligne absente, ou la suppression d'un parent encore désigné, ce que répond Postgres (23503).

interface Schema {
  cles: Map<string, string[]>
  relations: RelationDuSchema[]
}
let schemaLu: Schema | null = null
function schema(): Schema {
  if (!schemaLu) {
    const fichiers = fichiersDuSchema()
    schemaLu = { cles: clesPrimairesDuSchema(fichiers), relations: relationsDuSchema(fichiers) }
  }
  return schemaLu
}

// ── LA BASE : UN PostgREST QUI APPLIQUE CE QU'ON LUI DEMANDE ─────────────────────────────────────────────────────────

/** La RLS des lectures faites avec un jeton d'utilisateur, recopiée des policies du schéma exporté — table par table. */
type Politique = (ligne: Ligne, utilisateur: string | null, monde: Monde) => boolean

/** `admin_du_dossier` (migration `hierarchie_comptables`) : super-admin, chef du cabinet du dossier, ou membre assigné. */
export function adminDuDossier(monde: Monde, utilisateur: string | null, dossierId: unknown): boolean {
  if (!utilisateur) return false
  if ((monde.base.super_admins ?? []).some((s) => s.user_id === utilisateur)) return true
  const dossier = (monde.base.dossiers ?? []).find((d) => d.id === dossierId)
  if (!dossier) return false
  return (monde.base.cabinet_admins ?? []).some((ca) =>
    ca.user_id === utilisateur && ca.cabinet_id === dossier.cabinet_id && (
      ca.role === 'comptable_en_chef'
      || (monde.base.dossier_assignations ?? []).some((da) => da.dossier_id === dossierId && da.user_id === utilisateur)
    ))
}

function membreDuDossier(monde: Monde, utilisateur: string | null, dossierId: unknown): boolean {
  return !!utilisateur && (monde.base.memberships ?? []).some((m) => m.dossier_id === dossierId && m.user_id === utilisateur)
}

// `pieces_select` et `piece_textes_ocr_select` (le cabinet sur ses dossiers, le client sur le sien) ;
// `categories_select`, réservée aux connectés (migration `categories_et_natures_reservees_aux_connectes`).
const POLITIQUES_LECTURE: Record<string, Politique> = {
  pieces: (l, u, m) => adminDuDossier(m, u, l.dossier_id) || membreDuDossier(m, u, l.dossier_id),
  piece_textes_ocr: (l, u, m) => adminDuDossier(m, u, l.dossier_id) || membreDuDossier(m, u, l.dossier_id),
  categories: (l, u, m) => !!u && (l.dossier_id == null || adminDuDossier(m, u, l.dossier_id) || membreDuDossier(m, u, l.dossier_id)),
}

// Les fonctions SQL qu'une fonction appelle par `rpc`, avec ce que fait leur corps. Une autre LÈVE.
const FONCTIONS_SQL: Record<string, (monde: Monde, utilisateur: string | null, args: Record<string, unknown>) => unknown> = {
  admin_du_dossier: (monde, utilisateur, args) => adminDuDossier(monde, utilisateur, args.p_dossier_id),
}

const PGRST116 = (n: number): ErreurFactice => ({
  code: 'PGRST116',
  message: 'JSON object requested, multiple (or no) rows returned',
  details: `The result contains ${n} rows`,
  status: 406,
})

interface Jointure {
  relation: string
  colonnes: string
  colonneLocale: string
}

interface Selection {
  colonnes: string[] | '*'
  jointures: Jointure[]
}

/** Découpe sur les virgules de premier niveau : `pieces!inner(id, dossier_id)` est UNE entrée. */
function entreesDeSelection(texte: string): string[] {
  const out: string[] = []
  let profondeur = 0
  let courant = ''
  for (const c of texte) {
    if (c === '(') profondeur++
    if (c === ')') profondeur--
    if (c === ',' && profondeur === 0) { out.push(courant.trim()); courant = '' } else courant += c
  }
  if (courant.trim()) out.push(courant.trim())
  return out
}

function analyserSelection(table: string, texte: string): Selection {
  const colonnes: string[] = []
  const jointures: Jointure[] = []
  let tout = false
  for (const entree of entreesDeSelection(texte)) {
    if (entree === '*') { tout = true; continue }
    if (/^\w+$/.test(entree)) { colonnes.push(entree); continue }
    const jointure = /^(\w+)!inner\(([^()]*)\)$/.exec(entree)
    if (jointure) {
      // Une ressource embarquée se rattache par la clé étrangère de la table vers elle — lue dans le schéma, jamais
      // supposée. Une jointure dans l'autre sens rendrait un tableau : pas modélisée.
      const relation = schema().relations.find((r) => r.enfant === table && r.parent === jointure[1])
      if (!relation) throw new Error(`Faux PostgREST : aucune clé de « ${table} » vers « ${jointure[1]} » dans le schéma exporté`)
      jointures.push({ relation: jointure[1], colonnes: jointure[2], colonneLocale: relation.colonne })
      continue
    }
    throw new Error(`Faux PostgREST : la sélection « ${entree} » n'est pas modélisée`)
  }
  return { colonnes: tout ? '*' : colonnes, jointures }
}

function projeter(ligne: Ligne, selection: Selection): Ligne {
  const sortie: Ligne = {}
  if (selection.colonnes === '*') Object.assign(sortie, ligne)
  else for (const c of selection.colonnes) sortie[c] = ligne[c] ?? null
  for (const j of selection.jointures) {
    const embarquee = ligne[j.relation] as Ligne | null
    sortie[j.relation] = embarquee ? projeter(embarquee, analyserSelection(j.relation, j.colonnes)) : null
  }
  return sortie
}

/** Une comparaison de PostgREST : un NULL ne compare jamais, un nombre se compare en nombre, le reste en texte. */
function comparer(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  const x = String(a)
  const y = String(b)
  return x < y ? -1 : x > y ? 1 : 0
}

function predicatComparaison(colonne: string, operateur: 'neq' | 'gt' | 'gte' | 'lt' | 'lte', valeur: unknown): Predicat {
  return (ligne) => {
    const v = ligne[colonne]
    if (v == null || valeur == null) return false
    const c = comparer(v, valeur)
    if (operateur === 'neq') return c !== 0
    if (operateur === 'gt') return c > 0
    if (operateur === 'gte') return c >= 0
    if (operateur === 'lt') return c < 0
    return c <= 0
  }
}

/** `like` / `ilike` : `%` (ou `*`, que PostgREST admet dans une adresse) pour une suite, `_` pour un caractère. */
function predicatMotif(colonne: string, motif: string, casse: boolean): Predicat {
  const corps = [...motif].map((c) => (c === '%' || c === '*' ? '.*' : c === '_' ? '.' : c.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))).join('')
  const expression = new RegExp(`^${corps}$`, casse ? 's' : 'is')
  return (ligne) => typeof ligne[colonne] === 'string' && expression.test(ligne[colonne] as string)
}

/** Un filtre sur une ressource embarquée (`pieces.dossier_id`) s'applique à elle ; sous `!inner`, il écarte le parent. */
function surColonne(colonne: string, fabrique: (c: string) => Predicat): Predicat {
  const point = colonne.indexOf('.')
  if (point < 0) return fabrique(colonne)
  const relation = colonne.slice(0, point)
  const predicat = fabrique(colonne.slice(point + 1))
  return (ligne) => {
    const embarquee = ligne[relation] as Ligne | null | undefined
    return !!embarquee && predicat(embarquee)
  }
}

export interface ReponseBase {
  data: unknown
  error: ErreurFactice | null
  count: number | null
  status: number
  statusText: string
}

interface ContexteClient {
  monde: Monde
  role: Role
  utilisateur: string | null
  refus: ErreurFactice | null
}

/** Une requête PostgREST que l'on CONSTRUIT puis qu'on attend : elle part au `then`, comme la vraie. */
class RequeteFactice {
  private operation: Operation = 'select'
  private colonnes = '*'
  private compte = false
  private tete = false
  private readonly filtres: { texte: string; predicat: Predicat }[] = []
  private readonly ordres: { colonne: string; croissant: boolean; nullsEnPremier: boolean | undefined }[] = []
  private plage: [number, number] | null = null
  private limite: number | null = null
  private unique: 'une' | 'au-plus-une' | null = null
  private valeurs: Ligne[] = []
  private surConflit: string[] | null = null
  private ignorerDoublons = false
  private retour: string | null = null
  private readonly table: string
  private readonly contexte: ContexteClient

  constructor(table: string, contexte: ContexteClient) {
    this.table = table
    this.contexte = contexte
  }

  select(colonnes = '*', options?: { count?: string; head?: boolean }) {
    if (this.operation !== 'select') {
      this.retour = colonnes
      return this
    }
    if (options?.count !== undefined && options.count !== 'exact') {
      throw new Error(`Faux PostgREST : count « ${options.count} » n'est pas modélisé`)
    }
    this.colonnes = colonnes
    this.compte = options?.count === 'exact'
    this.tete = options?.head === true
    return this
  }

  insert(valeurs: Ligne | Ligne[], options?: Record<string, unknown>) {
    if (options && Object.keys(options).length > 0) throw new Error('Faux PostgREST : options d’insertion non modélisées')
    this.operation = 'insert'
    this.valeurs = Array.isArray(valeurs) ? valeurs : [valeurs]
    return this
  }

  upsert(valeurs: Ligne | Ligne[], options?: { onConflict?: string; ignoreDuplicates?: boolean }) {
    this.operation = 'upsert'
    this.valeurs = Array.isArray(valeurs) ? valeurs : [valeurs]
    this.surConflit = options?.onConflict ? options.onConflict.split(',').map((c) => c.trim()) : null
    this.ignorerDoublons = options?.ignoreDuplicates === true
    return this
  }

  update(valeurs: Ligne) {
    this.operation = 'update'
    this.valeurs = [valeurs]
    return this
  }

  delete() {
    this.operation = 'delete'
    return this
  }

  private filtre(texte: string, predicat: Predicat) {
    this.filtres.push({ texte, predicat })
    return this
  }

  eq(colonne: string, valeur: unknown) { return this.filtre(`eq ${colonne} ${String(valeur)}`, surColonne(colonne, (c) => predicatEq(c, valeur))) }
  neq(colonne: string, valeur: unknown) { return this.filtre(`neq ${colonne} ${String(valeur)}`, surColonne(colonne, (c) => predicatComparaison(c, 'neq', valeur))) }
  gt(colonne: string, valeur: unknown) { return this.filtre(`gt ${colonne} ${String(valeur)}`, surColonne(colonne, (c) => predicatComparaison(c, 'gt', valeur))) }
  gte(colonne: string, valeur: unknown) { return this.filtre(`gte ${colonne} ${String(valeur)}`, surColonne(colonne, (c) => predicatComparaison(c, 'gte', valeur))) }
  lt(colonne: string, valeur: unknown) { return this.filtre(`lt ${colonne} ${String(valeur)}`, surColonne(colonne, (c) => predicatComparaison(c, 'lt', valeur))) }
  lte(colonne: string, valeur: unknown) { return this.filtre(`lte ${colonne} ${String(valeur)}`, surColonne(colonne, (c) => predicatComparaison(c, 'lte', valeur))) }
  in(colonne: string, valeurs: readonly unknown[]) { return this.filtre(`in ${colonne} ${valeurs.map(String).join(',')}`, surColonne(colonne, (c) => predicatIn(c, valeurs))) }
  is(colonne: string, valeur: unknown) { return this.filtre(`is ${colonne} ${String(valeur)}`, surColonne(colonne, (c) => predicatIs(c, valeur))) }
  not(colonne: string, operateur: string, valeur: unknown) { return this.filtre(`not ${colonne} ${operateur} ${String(valeur)}`, surColonne(colonne, (c) => predicatNot(c, operateur, valeur))) }
  or(expression: string) { return this.filtre(`or ${expression}`, predicatOr(expression)) }
  like(colonne: string, motif: string) { return this.filtre(`like ${colonne} ${motif}`, surColonne(colonne, (c) => predicatMotif(c, motif, true))) }
  ilike(colonne: string, motif: string) { return this.filtre(`ilike ${colonne} ${motif}`, surColonne(colonne, (c) => predicatMotif(c, motif, false))) }

  order(colonne: string, options?: { ascending?: boolean; nullsFirst?: boolean }) {
    this.ordres.push({ colonne, croissant: options?.ascending !== false, nullsEnPremier: options?.nullsFirst })
    return this
  }

  range(debut: number, fin: number) {
    this.plage = [debut, fin]
    return this
  }

  limit(n: number) {
    this.limite = n
    return this
  }

  single() {
    this.unique = 'une'
    return this
  }

  maybeSingle() {
    this.unique = 'au-plus-une'
    return this
  }

  then<A = ReponseBase, B = never>(
    accepte?: ((r: ReponseBase) => A | PromiseLike<A>) | null,
    rejette?: ((e: unknown) => B | PromiseLike<B>) | null,
  ): Promise<A | B> {
    return Promise.resolve().then(() => this.executer()).then(accepte, rejette)
  }

  private lignes(): Ligne[] {
    const { monde } = this.contexte
    if (!schema().cles.has(this.table)) {
      throw new ErreurPostgrest({ code: 'PGRST205', message: `Could not find the table 'public.${this.table}' in the schema cache`, status: 404 })
    }
    return (monde.base[this.table] ??= [])
  }

  private executer(): ReponseBase {
    const { monde, role, utilisateur, refus } = this.contexte
    if (this.operation === 'select') {
      monde.journal.push({ genre: 'lecture', table: this.table, role, filtres: this.filtres.map((f) => f.texte) })
    } else {
      monde.journal.push({ genre: 'ecriture', table: this.table, operation: this.operation, role })
    }
    if (refus) return echec(refus)
    const panne = panneDe(monde, (p) => 'table' in p && p.table === this.table && (p.operation ?? this.operation) === this.operation)
    if (panne) return echec(panne)
    try {
      if (this.operation === 'select') return this.lire(role, utilisateur)
      if (role !== 'service') {
        throw new Error(`Faux PostgREST : une écriture de « ${this.table} » avec le jeton d'un utilisateur n'est pas modélisée`)
      }
      return this.ecrire()
    } catch (e) {
      if (e instanceof ErreurPostgrest) return echec(e.erreur)
      throw e
    }
  }

  private lire(role: Role, utilisateur: string | null): ReponseBase {
    const { monde } = this.contexte
    const selection = analyserSelection(this.table, this.colonnes)
    let lignes = this.lignes().map((l) => this.embarquer({ ...l }, selection))
    if (role !== 'service') {
      const politique = POLITIQUES_LECTURE[this.table]
      if (!politique) throw new Error(`Faux PostgREST : la RLS de « ${this.table} » n'est pas modélisée pour un jeton d'utilisateur`)
      lignes = lignes.filter((l) => politique(l, role === 'authentifie' ? utilisateur : null, monde))
    }
    lignes = lignes.filter((l) => this.filtres.every((f) => f.predicat(l)))
    for (const j of selection.jointures) lignes = lignes.filter((l) => l[j.relation] != null)
    const total = lignes.length
    lignes = this.trier(lignes)
    if (this.plage) lignes = lignes.slice(this.plage[0], this.plage[1] + 1)
    if (this.limite !== null) lignes = lignes.slice(0, this.limite)
    lignes = lignes.slice(0, monde.maxLignes)
    const rendues = lignes.map((l) => projeter(l, selection))
    return this.rendre(this.tete ? null : rendues, this.compte ? total : null, 200)
  }

  private embarquer(ligne: Ligne, selection: Selection): Ligne {
    for (const j of selection.jointures) {
      const parent = (this.contexte.monde.base[j.relation] ?? []).find((p) => p.id === ligne[j.colonneLocale])
      ligne[j.relation] = parent ? { ...parent } : null
    }
    return ligne
  }

  private trier(lignes: Ligne[]): Ligne[] {
    if (this.ordres.length === 0) return lignes
    return [...lignes].sort((a, b) => {
      for (const o of this.ordres) {
        const x = a[o.colonne]
        const y = b[o.colonne]
        if (x == null && y == null) continue
        // Postgres : NULLS LAST en ordre croissant, NULLS FIRST en ordre décroissant, sauf demande contraire.
        const nullsEnPremier = o.nullsEnPremier ?? !o.croissant
        if (x == null) return nullsEnPremier ? -1 : 1
        if (y == null) return nullsEnPremier ? 1 : -1
        const c = comparer(x, y)
        if (c !== 0) return o.croissant ? c : -c
      }
      return 0
    })
  }

  private rendre(lignes: Ligne[] | null, compte: number | null, status: number): ReponseBase {
    if (this.unique === null) return { data: lignes, error: null, count: compte, status, statusText: 'OK' }
    const liste = lignes ?? []
    if (liste.length > 1 || (this.unique === 'une' && liste.length === 0)) return echec(PGRST116(liste.length))
    return { data: liste[0] ?? null, error: null, count: compte, status, statusText: 'OK' }
  }

  private cle(): string[] {
    return schema().cles.get(this.table) ?? []
  }

  private memeCle(a: Ligne, b: Ligne, colonnes: string[]): boolean {
    return colonnes.length > 0 && colonnes.every((c) => a[c] != null && a[c] === b[c])
  }

  private doublon(ligne: Ligne, existantes: Ligne[]): ErreurFactice | null {
    const contraintes = [this.cle(), ...(this.contexte.monde.uniques[this.table] ?? [])]
    for (const colonnes of contraintes) {
      if (existantes.some((e) => e !== ligne && this.memeCle(e, ligne, colonnes))) {
        return {
          code: '23505',
          message: `duplicate key value violates unique constraint "${this.table}_${colonnes.join('_')}_key"`,
          details: `Key (${colonnes.join(', ')}) already exists.`,
          status: 409,
        }
      }
    }
    return null
  }

  /** Les clés étrangères de la ligne : chaque valeur non nulle doit désigner une ligne qui existe. */
  private referencesManquantes(ligne: Ligne): ErreurFactice | null {
    const { monde } = this.contexte
    for (const r of schema().relations.filter((rel) => rel.enfant === this.table)) {
      const valeur = ligne[r.colonne]
      if (valeur == null) continue
      const existe = r.parent === 'auth.users'
        ? monde.comptes.some((c) => c.id === valeur)
        : r.parent.includes('.') || (monde.base[r.parent] ?? []).some((p) => p[(schema().cles.get(r.parent) ?? ['id'])[0]] === valeur)
      if (!existe) {
        return {
          code: '23503',
          message: `insert or update on table "${this.table}" violates foreign key constraint "${r.nom}"`,
          details: `Key (${r.colonne})=(${String(valeur)}) is not present in table "${r.parent}".`,
          status: 409,
        }
      }
    }
    return null
  }

  private ecrire(): ReponseBase {
    const { monde } = this.contexte
    const lignes = this.lignes()
    let touchees: Ligne[] = []
    if (this.operation === 'insert' || this.operation === 'upsert') {
      // Tout ou rien : les lignes se jugent toutes avant que la première ne s'écrive, comme dans une instruction SQL.
      const cle = this.surConflit ?? this.cle()
      const ajoutees: Ligne[] = []
      const misesAJour: { ligne: Ligne; valeur: Ligne }[] = []
      for (const valeur of this.valeurs) {
        const existante = this.operation === 'upsert' ? [...lignes, ...ajoutees].find((l) => this.memeCle(l, valeur, cle)) : undefined
        if (existante) {
          if (!this.ignorerDoublons) misesAJour.push({ ligne: existante, valeur })
          continue
        }
        const complete: Ligne = { ...(monde.defauts[this.table]?.(valeur) ?? {}), ...valeur }
        if (this.cle().length === 1 && this.cle()[0] === 'id' && complete.id == null) complete.id = identifiantGenere()
        const faute = this.doublon(complete, [...lignes, ...ajoutees]) ?? this.referencesManquantes(complete)
        if (faute) return echec(faute)
        ajoutees.push(complete)
      }
      for (const { ligne, valeur } of misesAJour) Object.assign(ligne, valeur)
      lignes.push(...ajoutees)
      touchees = [...misesAJour.map((m) => m.ligne), ...ajoutees]
    } else if (this.operation === 'update') {
      const cibles = lignes.filter((l) => this.filtres.every((f) => f.predicat(l)))
      for (const l of cibles) {
        const apres = { ...l, ...this.valeurs[0] }
        const faute = this.doublon(apres, lignes.filter((x) => x !== l)) ?? this.referencesManquantes(apres)
        if (faute) return echec(faute)
      }
      for (const l of cibles) Object.assign(l, this.valeurs[0])
      touchees = cibles
    } else {
      const cibles = lignes.filter((l) => this.filtres.every((f) => f.predicat(l)))
      const faute = supprimer(monde, this.table, cibles)
      if (faute) return echec(faute)
      touchees = cibles
    }
    if (this.retour === null) return { data: null, error: null, count: null, status: this.operation === 'insert' ? 201 : 204, statusText: 'OK' }
    const selection = analyserSelection(this.table, this.retour)
    return this.rendre(touchees.map((l) => projeter(l, selection)), null, 200)
  }
}

/** Une erreur de PostgREST, levée là où le calcul la découvre et rendue en `{ error }` comme la vraie. */
class ErreurPostgrest {
  readonly erreur: ErreurFactice
  constructor(erreur: ErreurFactice) {
    this.erreur = erreur
  }
}

function echec(erreur: ErreurFactice): ReponseBase {
  return { data: null, error: { ...erreur }, count: null, status: erreur.status ?? 400, statusText: 'Erreur' }
}

/**
 * Une suppression, avec ce que les clés étrangères en font : refusée (23503) si un enfant la désigne sans règle, en
 * cascade, ou en remettant le lien à NULL. Tout ou rien, comme dans Postgres : rien ne change si un refus apparaît.
 */
function supprimer(monde: Monde, table: string, cibles: Ligne[]): ErreurFactice | null {
  const aSupprimer = new Map<string, Set<Ligne>>()
  const aVider: { ligne: Ligne; colonne: string }[] = []
  const parcourir = (t: string, lignes: Ligne[]): ErreurFactice | null => {
    const deja = aSupprimer.get(t) ?? new Set<Ligne>()
    aSupprimer.set(t, deja)
    const nouvelles = lignes.filter((l) => !deja.has(l))
    for (const l of nouvelles) deja.add(l)
    const pk = (schema().cles.get(t) ?? ['id'])[0]
    for (const r of schema().relations.filter((rel) => rel.parent === t)) {
      const enfants = (monde.base[r.enfant] ?? []).filter((e) => nouvelles.some((l) => e[r.colonne] != null && e[r.colonne] === l[pk]))
      if (enfants.length === 0) continue
      if (r.aLaSuppression === 'bloque') {
        return {
          code: '23503',
          message: `update or delete on table "${t}" violates foreign key constraint "${r.nom}" on table "${r.enfant}"`,
          details: `Key is still referenced from table "${r.enfant}".`,
          status: 409,
        }
      }
      if (r.aLaSuppression === 'met_a_null') {
        for (const e of enfants) aVider.push({ ligne: e, colonne: r.colonne })
        continue
      }
      const faute = parcourir(r.enfant, enfants)
      if (faute) return faute
    }
    return null
  }
  const faute = parcourir(table, cibles)
  if (faute) return faute
  for (const { ligne, colonne } of aVider) ligne[colonne] = null
  for (const [t, lignes] of aSupprimer) monde.base[t] = (monde.base[t] ?? []).filter((l) => !lignes.has(l))
  return null
}

// ── L'AUTHENTIFICATION ───────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Le jeton que le service d'authentification lit dans un en-tête : `Bearer <jeton>` (ou `bearer`), séparés par UNE
 * espace, sans blanc final — la forme que GoTrue extrait (`^(?:B|b)earer (\S+$)`, dépôt public supabase/auth).
 */
export function jetonPorteur(entete: string | null | undefined): string | null {
  return /^(?:B|b)earer (\S+)$/.exec(entete ?? '')?.[1] ?? null
}

function utilisateurDe(monde: Monde, jeton: string | null): Compte | null {
  const id = jeton ? monde.sessions[jeton] : undefined
  return id ? monde.comptes.find((c) => c.id === id) ?? null : null
}

function serviceAuthentification(monde: Monde, contexte: { cle: 'publiable' | 'secrete' | 'inconnue'; autorisation: string | null }) {
  const reponseCompte = (compte: Compte | null, erreur: ErreurFactice | null) =>
    ({ data: { user: compte ? { id: compte.id, email: compte.email, aud: 'authenticated', role: 'authenticated' } : null }, error: erreur })
  const refusAdmin = { status: 403, code: 'not_admin', message: 'User not allowed' }
  const admin = <T>(operation: 'createUser' | 'listUsers' | 'updateUserById' | 'getUserById', faire: () => T) => {
    monde.journal.push({ genre: 'comptes', operation })
    if (contexte.cle !== 'secrete') return { data: { user: null, users: [] }, error: refusAdmin }
    const panne = panneDe(monde, (p) => 'auth' in p && p.auth === operation)
    if (panne) return { data: { user: null, users: [] }, error: panne }
    return faire()
  }
  return {
    // Sans argument, la session vient de l'en-tête `Authorization` que le client porte (`hasCustomAuthorizationHeader`
    // d'auth-js) ; sans en-tête ni session, auth-js rend « Auth session missing! » sans rien demander au service.
    getUser: async (jwt?: string) => {
      if (!jwt && !contexte.autorisation) {
        return reponseCompte(null, { message: 'Auth session missing!', status: 400, code: 'session_missing' })
      }
      if (contexte.cle === 'inconnue') return reponseCompte(null, { message: 'Invalid API key', status: 401 })
      const jeton = jwt ?? jetonPorteur(contexte.autorisation)
      const panne = panneDe(monde, (p) => 'auth' in p && p.auth === 'getUser')
      const compte = panne ? null : utilisateurDe(monde, jeton)
      monde.journal.push({ genre: 'session', utilisateur: compte?.id ?? null })
      if (panne) return reponseCompte(null, panne)
      if (!compte) return reponseCompte(null, { message: 'invalid JWT: unable to parse or verify signature', status: 403, code: 'bad_jwt' })
      return reponseCompte(compte, null)
    },
    admin: {
      createUser: async (attributs: { email?: string; password?: string }) => admin('createUser', () => {
        const email = String(attributs.email ?? '').toLowerCase()
        if (monde.comptes.some((c) => c.email.toLowerCase() === email)) {
          return reponseCompte(null, { status: 422, code: 'email_exists', message: 'A user with this email address has already been registered' })
        }
        const compte = { id: identifiantGenere(), email }
        monde.comptes.push(compte)
        return reponseCompte(compte, null)
      }),
      listUsers: async (options?: { page?: number; perPage?: number }) => admin('listUsers', () => {
        const parPage = options?.perPage ?? 50
        const page = options?.page ?? 1
        const users = monde.comptes.slice((page - 1) * parPage, page * parPage).map((c) => ({ id: c.id, email: c.email }))
        return { data: { users, aud: 'authenticated' }, error: null }
      }),
      updateUserById: async (id: string) => admin('updateUserById', () => {
        const compte = monde.comptes.find((c) => c.id === id) ?? null
        return compte ? reponseCompte(compte, null) : reponseCompte(null, { status: 404, code: 'user_not_found', message: 'User not found' })
      }),
      getUserById: async (id: string) => admin('getUserById', () => {
        const compte = monde.comptes.find((c) => c.id === id) ?? null
        return compte ? reponseCompte(compte, null) : reponseCompte(null, { status: 404, code: 'user_not_found', message: 'User not found' })
      }),
    },
  }
}

// ── LE CLIENT SUPABASE ───────────────────────────────────────────────────────────────────────────────────────────────

/** Le rôle sous lequel PostgREST sert une requête : la clé, puis le jeton porteur s'il y en a un. */
function contexteDe(monde: Monde, cle: 'publiable' | 'secrete' | 'inconnue', autorisation: string | null): ContexteClient {
  if (cle === 'inconnue') return { monde, role: 'refuse', utilisateur: null, refus: { message: 'Invalid API key', status: 401 } }
  if (cle === 'secrete') {
    if (autorisation) throw new Error('Faux client : la clé secrète AVEC un jeton d’utilisateur n’est pas modélisée')
    return { monde, role: 'service', utilisateur: null, refus: null }
  }
  if (!autorisation) return { monde, role: 'anonyme', utilisateur: null, refus: null }
  const compte = utilisateurDe(monde, jetonPorteur(autorisation))
  if (!compte) return { monde, role: 'refuse', utilisateur: null, refus: { code: 'PGRST301', message: 'JWT invalide', status: 401 } }
  return { monde, role: 'authentifie', utilisateur: compte.id, refus: null }
}

function clientSupabase(monde: Monde, env: Environnement, url: unknown, cleRecue: unknown, options: unknown) {
  if (!url) throw new Error('supabaseUrl is required.')
  if (url !== env.SUPABASE_URL) throw new Error(`Faux client : un client vers « ${String(url)} », qui n'est pas le projet d'essai`)
  if (!cleRecue) throw new Error('supabaseKey is required.')
  const entetes = (options as { global?: { headers?: Record<string, string> } } | undefined)?.global?.headers ?? {}
  const autorisation = Object.entries(entetes).find(([nom]) => nom.toLowerCase() === 'authorization')?.[1] ?? null
  const cle = cleRecue === CLE_SECRETE ? 'secrete' : cleRecue === CLE_PUBLIABLE ? 'publiable' : 'inconnue'
  monde.journal.push({ genre: 'client', cle, porteur: autorisation !== null })
  const contexte = () => contexteDe(monde, cle, autorisation)
  return {
    from: (table: string) => new RequeteFactice(table, contexte()),
    rpc: async (nom: string, args: Record<string, unknown> = {}) => {
      const c = contexte()
      monde.journal.push({ genre: 'rpc', nom, role: c.role })
      if (c.refus) return echec(c.refus)
      const panne = panneDe(monde, (p) => 'rpc' in p && p.rpc === nom)
      if (panne) return echec(panne)
      const corps = FONCTIONS_SQL[nom]
      if (!corps) throw new Error(`Faux PostgREST : la fonction SQL « ${nom} » n'est pas modélisée`)
      return { data: corps(monde, c.utilisateur, args), error: null, count: null, status: 200, statusText: 'OK' }
    },
    auth: serviceAuthentification(monde, { cle, autorisation }),
    storage: {
      from: (seau: string) => ({
        upload: async (chemin: string, corps: unknown, opts?: { upsert?: boolean }) => {
          monde.journal.push({ genre: 'stockage', seau, operation: 'upload', chemins: [chemin] })
          if (cle !== 'secrete') throw new Error('Faux stockage : un dépôt avec le jeton d’un utilisateur n’est pas modélisé')
          const panne = panneDe(monde, (p) => 'stockage' in p && p.stockage === 'upload')
          if (panne) return { data: null, error: panne }
          const nom = `${seau}/${chemin}`
          if (monde.fichiers.has(nom) && !opts?.upsert) return { data: null, error: { message: 'The resource already exists', status: 409 } }
          monde.fichiers.set(nom, corps)
          return { data: { path: chemin }, error: null }
        },
        remove: async (chemins: string[]) => {
          monde.journal.push({ genre: 'stockage', seau, operation: 'remove', chemins })
          const panne = panneDe(monde, (p) => 'stockage' in p && p.stockage === 'remove')
          if (panne) return { data: null, error: panne }
          for (const c of chemins) monde.fichiers.delete(`${seau}/${c}`)
          return { data: chemins.map((name) => ({ name })), error: null }
        },
      }),
    },
  }
}

// ── AWS, BEDROCK, RESEND ─────────────────────────────────────────────────────────────────────────────────────────────

/** Une commande d'un SDK AWS : son nom et son entrée, rien d'autre. */
function commande(nom: string) {
  return class {
    readonly nom = nom
    readonly input: Record<string, unknown>
    constructor(input: Record<string, unknown>) {
      this.input = input
    }
  }
}

function clientAws(monde: Monde, env: Environnement, service: 'textract' | 's3') {
  return class {
    readonly config: { region?: unknown; credentials?: { accessKeyId?: unknown; secretAccessKey?: unknown } }
    constructor(config: { region?: unknown; credentials?: { accessKeyId?: unknown; secretAccessKey?: unknown } }) {
      this.config = config
      monde.journal.push({ genre: 'client-aws', service, region: config?.region })
    }
    async send(c: { nom: string; input: Record<string, unknown> }) {
      monde.journal.push({ genre: 'aws', service, commande: c.nom, region: this.config?.region })
      // AWS refuse une signature faite d'autres identifiants que ceux du compte : la fonction doit passer les siens.
      if (this.config?.credentials?.secretAccessKey !== env.AWS_SECRET_ACCESS_KEY) {
        throw Object.assign(new Error('The security token included in the request is invalid.'), { name: 'UnrecognizedClientException' })
      }
      const traitant = service === 'textract' ? monde.textract : monde.s3
      if (!traitant) throw new Error(`Harnais : appel ${service} « ${c.nom} » non attendu par le test`)
      return traitant(c.nom, c.input)
    }
  }
}

/** L'erreur d'API du SDK d'Anthropic (`Anthropic.APIError`), seul usage qu'en fait `agent-comptable`. */
export class ErreurApiModele {
  readonly status: number
  readonly message: string
  readonly name = 'APIError'
  constructor(status: number, message: string) {
    this.status = status
    this.message = message
  }
}

function clientBedrock(monde: Monde) {
  return class {
    readonly options: { awsRegion?: unknown }
    readonly messages: { create: (demande: Record<string, unknown>) => Promise<unknown> }
    constructor(options: { awsRegion?: unknown }) {
      this.options = options
      monde.journal.push({ genre: 'client-aws', service: 'bedrock', region: options?.awsRegion })
      this.messages = {
        create: async (demande) => {
          monde.journal.push({ genre: 'modele', modele: demande?.model, region: options?.awsRegion })
          if (!monde.modele) throw new Error('Harnais : appel au modèle non attendu par le test')
          return monde.modele(demande)
        },
      }
    }
  }
}

/**
 * La vérification d'un webhook Svix, telle que la documentation publique de Svix la décrit (« Verifying webhooks
 * manually ») : le contenu signé est `${id}.${horodatage}.${corps}`, la clé est la partie base 64 du secret après
 * `whsec_`, la signature est un HMAC-SHA256 en base 64 précédé de `v1,` (plusieurs, séparées d'une espace), et un
 * horodatage écarté de plus de cinq minutes est refusé. `resend.webhooks.verify` lève sur toute signature fausse.
 */
export function verifierWebhookSvix(
  corps: string, entetes: { id?: unknown; timestamp?: unknown; signature?: unknown }, secret: unknown, maintenantS: number,
): unknown {
  const { id, timestamp, signature } = entetes
  if (typeof id !== 'string' || typeof timestamp !== 'string' || typeof signature !== 'string' || typeof secret !== 'string') {
    throw new Error('Missing required headers')
  }
  const horodatage = Number(timestamp)
  if (!Number.isInteger(horodatage)) throw new Error('Invalid Signature Headers')
  if (maintenantS - horodatage > 300) throw new Error('Message timestamp too old')
  if (horodatage - maintenantS > 300) throw new Error('Message timestamp too new')
  const cle = Buffer.from(secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret, 'base64')
  const attendue = createHmac('sha256', cle).update(`${id}.${timestamp}.${corps}`).digest()
  for (const partie of signature.split(' ')) {
    const [version, valeur] = partie.split(',')
    if (version !== 'v1' || !valeur) continue
    const recue = Buffer.from(valeur, 'base64')
    if (recue.length === attendue.length && timingSafeEqual(recue, attendue)) return JSON.parse(corps)
  }
  throw new Error('No matching signature found')
}

/** Les en-têtes qu'envoie Resend pour un corps donné, signés par un secret donné (celui du projet par défaut). */
export function signerWebhook(corps: string, options: { secret?: string; id?: string; horodatageS?: number } = {}): Record<string, string> {
  const id = options.id ?? 'msg_harnais'
  const horodatage = String(options.horodatageS ?? Math.floor(Date.now() / 1000))
  const secret = options.secret ?? SECRET_WEBHOOK
  const cle = Buffer.from(secret.slice('whsec_'.length), 'base64')
  const signature = createHmac('sha256', cle).update(`${id}.${horodatage}.${corps}`).digest('base64')
  return { 'svix-id': id, 'svix-timestamp': horodatage, 'svix-signature': `v1,${signature}` }
}

function clientResend(monde: Monde, env: Environnement) {
  const maintenantS = () => Math.floor((Date.now() + monde.decalageHorloge) / 1000)
  return class {
    readonly cle: unknown
    readonly webhooks: { verify: (demande: { payload: string; headers: Record<string, unknown>; webhookSecret: unknown }) => unknown }
    readonly emails: {
      send: (message: Record<string, unknown>) => Promise<unknown>
      receiving: { attachments: { get: (demande: Record<string, unknown>) => Promise<unknown> } }
    }
    constructor(cle: unknown) {
      this.cle = cle
      this.webhooks = {
        verify: ({ payload, headers, webhookSecret }) => {
          monde.journal.push({ genre: 'resend', operation: 'verifier' })
          return verifierWebhookSvix(payload, headers, webhookSecret, maintenantS())
        },
      }
      const refusCle = { data: null, error: { name: 'validation_error', message: 'API key is invalid' } }
      this.emails = {
        send: async (message) => {
          monde.journal.push({ genre: 'resend', operation: 'envoyer' })
          if (cle !== env.RESEND_API_KEY) return refusCle
          if (!monde.resend.envoyer) throw new Error('Harnais : envoi d’e-mail non attendu par le test')
          return monde.resend.envoyer(message)
        },
        receiving: {
          attachments: {
            get: async (demande) => {
              monde.journal.push({ genre: 'resend', operation: 'piece-jointe' })
              if (cle !== env.RESEND_API_KEY) return refusCle
              if (!monde.resend.pieceJointe) throw new Error('Harnais : lecture de pièce jointe non attendue par le test')
              return monde.resend.pieceJointe(demande)
            },
          },
        },
      }
    }
  }
}

// ── LE RÉSEAU FERMÉ ──────────────────────────────────────────────────────────────────────────────────────────────────

function reseau(monde: Monde) {
  return async (entree: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const requete = new Request(entree, init)
    const adresse = new URL(requete.url)
    const traitant = monde.hotes[adresse.host]
    monde.journal.push({ genre: 'reseau', hote: adresse.host, methode: requete.method, chemin: `${adresse.pathname}${adresse.search}`, declare: !!traitant })
    if (!traitant) throw new TypeError(`Réseau fermé : l'hôte « ${adresse.host} » n'est pas déclaré par le test`)
    return traitant(requete)
  }
}

// ── LE CHARGEMENT D'UNE FONCTION ─────────────────────────────────────────────────────────────────────────────────────

const transpilees = new Map<string, string>()

/**
 * Transpile une source à l'avance — dans un `beforeAll`, jamais dans un test : la plus longue (`agent-comptable`, plus de
 * 3 000 lignes) prend plusieurs secondes sur une machine chargée, et un test n'a pas à payer le compilateur.
 */
export function prechauffer(source: string): void {
  transpiler(source)
}

/** Le compilateur du projet, en CommonJS : les `import` deviennent des `require` que le harnais résout. */
function transpiler(source: string): string {
  let js = transpilees.get(source)
  if (js === undefined) {
    js = ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
      fileName: 'index.ts',
    }).outputText
    transpilees.set(source, js)
  }
  return js
}

/** L'horloge de la fonction : la vraie, décalée de ce que le monde demande — jamais figée, un sondage doit finir. */
function horloge(monde: Monde): DateConstructor {
  const Reelle = Date
  class DateDuMonde extends Reelle {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(Reelle.now() + monde.decalageHorloge)
      else super(...(args as [string | number | Date]))
    }
    static now(): number {
      return Reelle.now() + monde.decalageHorloge
    }
  }
  return DateDuMonde as unknown as DateConstructor
}

export interface Resultat {
  statut: number
  texte: string
  /** Le corps lu en JSON, ou `undefined` s'il n'en est pas. */
  json: unknown
  entetes: Headers
  /** La passerelle a refusé la requête : la fonction n'a pas tourné. */
  parLaPasserelle: boolean
  /** L'exception que la fonction a laissé filer : `Deno.serve` rend alors 500, en texte brut et sans en-tête CORS. */
  exception: unknown
  /** La fonction a lu le corps de la requête. */
  corpsLu: boolean
}

export interface FonctionChargee {
  slug: string
  source: string
  verifyJwt: boolean
  /** La réponse telle que la plateforme la rend, passerelle comprise : ce qu'une AUTRE fonction reçoit d'elle. */
  repondre: (requete: Request, options?: { passerelle?: boolean }) => Promise<{ reponse: Response; parLaPasserelle: boolean; exception: unknown }>
  /** La même, lue : statut, texte, JSON, en-têtes, et ce que la fonction a fait du corps. */
  appeler: (requete: Request, options?: { passerelle?: boolean }) => Promise<Resultat>
}

/**
 * Charge une fonction dans un monde : sa source (la vraie, ou une copie mutée), son environnement (celui d'essai, que
 * le test peut amender), ses imports résolus vers les faux. Le gestionnaire est capturé par `Deno.serve`, et `appeler`
 * le joue derrière la passerelle de la plateforme — `verify_jwt` lu dans `config.toml` — ou sans elle.
 */
export function chargerFonction(
  slug: string, monde: Monde, options: { source?: string; env?: Environnement } = {},
): FonctionChargee {
  const source = options.source ?? sourceDe(slug)
  const env: Environnement = { ...environnementEssai(), ...options.env }
  const supabase = { createClient: (url: unknown, cle: unknown, opts?: unknown) => clientSupabase(monde, env, url, cle, opts) }
  const modules: Record<string, unknown> = {
    'npm:@supabase/supabase-js@2': supabase,
    'jsr:@supabase/supabase-js@2': supabase,
    'jsr:@supabase/functions-js/edge-runtime.d.ts': {},
    'npm:@aws-sdk/client-textract@3': {
      TextractClient: clientAws(monde, env, 'textract'),
      DetectDocumentTextCommand: commande('DetectDocumentText'),
      StartDocumentTextDetectionCommand: commande('StartDocumentTextDetection'),
      GetDocumentTextDetectionCommand: commande('GetDocumentTextDetection'),
    },
    'npm:@aws-sdk/client-s3@3': {
      S3Client: clientAws(monde, env, 's3'),
      PutObjectCommand: commande('PutObject'),
      DeleteObjectCommand: commande('DeleteObject'),
    },
    'npm:@anthropic-ai/bedrock-sdk@0.33.4': { default: clientBedrock(monde) },
    'npm:@anthropic-ai/sdk@0.124.0': { default: { APIError: ErreurApiModele } },
    'npm:resend@6': { Resend: clientResend(monde, env) },
  }
  // `__esModule` : le compilateur enveloppe un import par défaut (`__importDefault`) sauf s'il vient d'un module ES — ce
  // que sont les vrais SDK. Sans lui, `new AnthropicBedrock(…)` viserait l'enveloppe et lèverait.
  const requerir = (specificateur: string) => {
    if (!(specificateur in modules)) throw new Error(`Import non déclaré au harnais : « ${specificateur} »`)
    return { __esModule: true, ...(modules[specificateur] as object) }
  }

  let gestionnaire: ((requete: Request) => Promise<Response> | Response) | null = null
  const Deno = {
    serve: (...args: unknown[]) => {
      if (gestionnaire) throw new Error(`${slug} : Deno.serve appelé deux fois`)
      const rappel = args.find((a) => typeof a === 'function')
      if (!rappel) throw new Error(`${slug} : Deno.serve sans gestionnaire`)
      gestionnaire = rappel as (requete: Request) => Promise<Response>
    },
    env: { get: (nom: string) => env[nom] },
  }
  const journal = (niveau: string) => (...args: unknown[]) => { monde.journaux.push({ niveau, texte: format(...args) }) }
  const consoleDuMonde = { log: journal('log'), info: journal('info'), warn: journal('warn'), error: journal('error'), debug: journal('debug') }
  const minuterie = (rappel: () => void, delai?: number) => {
    const m = setTimeout(rappel, monde.minuteriesImmediates ? 0 : delai)
    // Une minuterie de la fonction (le filet de 22 s de l'assistant) ne retient pas la suite une fois la réponse rendue.
    ;(m as unknown as { unref?: () => void }).unref?.()
    return m
  }
  const exportes: Record<string, unknown> = {}
  const executer = new Function('require', 'exports', 'module', 'Deno', 'fetch', 'console', 'Date', 'setTimeout', transpiler(source))
  executer(requerir, exportes, { exports: exportes }, Deno, reseau(monde), consoleDuMonde, horloge(monde), minuterie)
  if (!gestionnaire) throw new Error(`${slug} : aucun Deno.serve au chargement`)
  const capture: (requete: Request) => Promise<Response> | Response = gestionnaire
  const verifyJwt = verifyJwtDe(slug)

  const repondre: FonctionChargee['repondre'] = async (requete, opts = {}) => {
    if ((opts.passerelle ?? true) && verifyJwt && requete.method !== 'OPTIONS') {
      const refus = refusDeLaPasserelle(monde, requete)
      if (refus) return { reponse: refus, parLaPasserelle: true, exception: null }
    }
    try {
      const reponse = await capture(requete)
      if (!(reponse instanceof Response)) throw new TypeError(`${slug} : le gestionnaire n'a pas rendu une Response`)
      return { reponse, parLaPasserelle: false, exception: null }
    } catch (e) {
      monde.exceptions.push(e)
      // Ce que rend `Deno.serve` quand le gestionnaire lève : un 500 en texte brut, sans en-tête CORS.
      return { reponse: new Response('Internal Server Error', { status: 500 }), parLaPasserelle: false, exception: e }
    }
  }

  return {
    slug,
    source,
    verifyJwt,
    repondre,
    appeler: async (requete, opts = {}) => {
      const { reponse, parLaPasserelle, exception } = await repondre(requete, opts)
      const texte = await reponse.text()
      let json: unknown
      try {
        json = JSON.parse(texte)
      } catch {
        json = undefined
      }
      return { statut: reponse.status, texte, json, entetes: reponse.headers, parLaPasserelle, exception, corpsLu: requete.bodyUsed }
    },
  }
}

/**
 * Le projet d'essai vu du réseau : `/functions/v1/<fonction>` mène à la fonction chargée dans le MÊME monde, passerelle
 * comprise — c'est ainsi que `receive-email` et la sonde d'`evaluer-extraction` atteignent la vraie `extract-piece`.
 * Une fonction absente rend ce que rend la plateforme, un 404.
 */
export function projetSurLeReseau(fonctions: readonly FonctionChargee[]): Traitant {
  return async (requete) => {
    const nom = /^\/functions\/v1\/([\w-]+)$/.exec(new URL(requete.url).pathname)?.[1]
    const fonction = fonctions.find((f) => f.slug === nom)
    if (!fonction) return Response.json({ code: 'NOT_FOUND', message: 'Requested function was not found' }, { status: 404 })
    return (await fonction.repondre(requete)).reponse
  }
}

/** L'hôte du projet d'essai, celui que les fonctions joignent par `SUPABASE_URL`. */
export const HOTE_PROJET = new URL(URL_PROJET).host

/**
 * La passerelle de la plateforme, pour une fonction à `verify_jwt = true` : un JWT signé du projet dans
 * `Authorization: Bearer`, sinon 401 sans que la fonction tourne. Elle ne vérifie que la signature — jamais qu'un compte
 * est rattaché à quoi que ce soit — et ne sait lire qu'un jeton : une clé publishable ou secrète présentée en porteur est
 * refusée (« Invalid JWT »). Le préflight CORS (OPTIONS) passe.
 */
function refusDeLaPasserelle(monde: Monde, requete: Request): Response | null {
  const entete = requete.headers.get('Authorization')
  if (!entete) return Response.json({ code: 401, message: 'Missing authorization header' }, { status: 401 })
  const jeton = /^Bearer (\S+)$/i.exec(entete)?.[1]
  if (!jeton || !(jeton in monde.sessions)) return Response.json({ code: 401, message: 'Invalid JWT' }, { status: 401 })
  return null
}

// ── CE QUE LES CONTRATS JUGENT ───────────────────────────────────────────────────────────────────────────────────────

/** Ce qui coûte ou laisse une trace hors de la fonction. Rien de tout cela ne part avant le contrôle de l'appelant. */
export function depensesDe(journal: readonly Evenement[]): Evenement[] {
  return journal.filter((e) =>
    e.genre === 'reseau' || e.genre === 'aws' || e.genre === 'modele' || e.genre === 'ecriture' || e.genre === 'stockage'
    || e.genre === 'comptes' || (e.genre === 'resend' && e.operation !== 'verifier'))
}

/** Une dépense dite en quelques mots, pour un message d'échec qui se lit. */
export function decrire(e: Evenement): string {
  switch (e.genre) {
    case 'reseau': return `réseau ${e.methode} ${e.hote}${e.chemin.split('?')[0]}`
    case 'aws': return `AWS ${e.service} ${e.commande}`
    // Le modèle sans son identifiant : aucun identifiant de modèle ne s'écrit hors des fonctions qui l'appellent.
    case 'modele': return 'modèle'
    case 'ecriture': return `écriture ${e.operation} ${e.table}`
    case 'stockage': return `stockage ${e.operation} ${e.seau}`
    case 'comptes': return `comptes ${e.operation}`
    case 'resend': return `Resend ${e.operation}`
    case 'lecture': return `lecture ${e.table} (${e.role})`
    case 'rpc': return `rpc ${e.nom} (${e.role})`
    case 'session': return 'session demandée au service d’authentification'
    case 'client': return `client Supabase (${e.cle})`
    case 'client-aws': return `client ${e.service}`
  }
}

/**
 * Les secrets et les valeurs de pièce que porte un texte rendu ou journalisé. Un secret se cherche entier ; une valeur
 * de pièce, par MORCEAUX de huit caractères — le message d'une erreur de `JSON.parse` n'en cite qu'un fragment
 * (« …"{"tiers": Quarzbuch"… »), et un fragment de nom est déjà une fuite. D'où des marqueurs inventés, qu'aucun texte
 * légitime ne contient.
 */
export function fuitesDans(texte: string, monde: Monde, valeursSensibles: boolean): string[] {
  const secrets = monde.secrets.filter((v) => v.length >= 4 && texte.includes(v))
  if (!valeursSensibles) return secrets
  const morceaux = monde.sensibles.filter((v) =>
    Array.from({ length: Math.max(1, v.length - 7) }, (_, i) => v.slice(i, i + 8)).some((m) => texte.includes(m)))
  return [...secrets, ...morceaux]
}

// ── LES PERSONNES ET LE MONDE DE RÉFÉRENCE ───────────────────────────────────────────────────────────────────────────

export const ID = {
  cabinet: 'c1000000-0000-4000-8000-000000000001',
  autreCabinet: 'c2000000-0000-4000-8000-000000000002',
  dossier: 'd1000000-0000-4000-8000-000000000001',
  dossierAutreCabinet: 'd2000000-0000-4000-8000-000000000002',
  dossierVoisin: 'd3000000-0000-4000-8000-000000000003',
} as const

/** Qui appelle. `inscrit` est ce que donne l'inscription publique, ouverte sur ce projet : une session rattachée à rien. */
export type Personne =
  | 'chef' | 'comptableAssigne' | 'comptableNonAssigne' | 'chefAutreCabinet' | 'client' | 'inscrit' | 'superAdmin'

export const PERSONNES: Record<Personne, { id: string; email: string; jeton: string }> = {
  chef: { id: 'a1000000-0000-4000-8000-000000000001', email: 'chef@cabinet-un.invalid', jeton: 'jeton-de-session-chef' },
  comptableAssigne: { id: 'a2000000-0000-4000-8000-000000000002', email: 'assigne@cabinet-un.invalid', jeton: 'jeton-de-session-assigne' },
  comptableNonAssigne: { id: 'a3000000-0000-4000-8000-000000000003', email: 'voisin@cabinet-un.invalid', jeton: 'jeton-de-session-voisin' },
  chefAutreCabinet: { id: 'a4000000-0000-4000-8000-000000000004', email: 'chef@cabinet-deux.invalid', jeton: 'jeton-de-session-autre-chef' },
  client: { id: 'a5000000-0000-4000-8000-000000000005', email: 'client@exemple.invalid', jeton: 'jeton-de-session-client' },
  inscrit: { id: 'a6000000-0000-4000-8000-000000000006', email: 'inscrit@exemple.invalid', jeton: 'jeton-de-session-inscrit' },
  superAdmin: { id: 'a7000000-0000-4000-8000-000000000007', email: 'super@plateforme.invalid', jeton: 'jeton-de-session-super' },
}

/**
 * Deux cabinets, trois dossiers, et les sept personnes : un chef et deux comptables du premier cabinet (l'un assigné au
 * dossier, l'autre à son voisin seulement), le chef du second, un client du dossier, un compte inscrit seul, et le
 * super-administrateur. Le tout fictif.
 */
export function mondeDeReference(): Monde {
  const monde = nouveauMonde()
  monde.comptes = Object.values(PERSONNES).map(({ id, email }) => ({ id, email }))
  monde.sessions = Object.fromEntries(Object.values(PERSONNES).map(({ id, jeton }) => [jeton, id]))
  monde.base = {
    cabinets: [
      { id: ID.cabinet, nom: 'Cabinet fictif un', limite_ia_alerte_usd: null, limite_ia_blocage_usd: null },
      { id: ID.autreCabinet, nom: 'Cabinet fictif deux', limite_ia_alerte_usd: null, limite_ia_blocage_usd: null },
    ],
    dossiers: [
      { id: ID.dossier, nom: 'Dossier fictif', cabinet_id: ID.cabinet, code_email: 'dossier-fictif' },
      { id: ID.dossierAutreCabinet, nom: 'Dossier d’un autre cabinet', cabinet_id: ID.autreCabinet, code_email: 'autre-cabinet' },
      { id: ID.dossierVoisin, nom: 'Dossier voisin', cabinet_id: ID.cabinet, code_email: 'dossier-voisin' },
    ],
    cabinet_admins: [
      { user_id: PERSONNES.chef.id, cabinet_id: ID.cabinet, role: 'comptable_en_chef', email: PERSONNES.chef.email },
      { user_id: PERSONNES.comptableAssigne.id, cabinet_id: ID.cabinet, role: 'comptable', email: PERSONNES.comptableAssigne.email },
      { user_id: PERSONNES.comptableNonAssigne.id, cabinet_id: ID.cabinet, role: 'comptable', email: PERSONNES.comptableNonAssigne.email },
      { user_id: PERSONNES.chefAutreCabinet.id, cabinet_id: ID.autreCabinet, role: 'comptable_en_chef', email: PERSONNES.chefAutreCabinet.email },
    ],
    dossier_assignations: [
      { id: 'e1000000-0000-4000-8000-000000000001', dossier_id: ID.dossier, user_id: PERSONNES.comptableAssigne.id },
      { id: 'e3000000-0000-4000-8000-000000000003', dossier_id: ID.dossierVoisin, user_id: PERSONNES.comptableNonAssigne.id },
    ],
    memberships: [
      { id: 'f1000000-0000-4000-8000-000000000001', user_id: PERSONNES.client.id, dossier_id: ID.dossier, role: 'client', email: PERSONNES.client.email },
    ],
    super_admins: [{ user_id: PERSONNES.superAdmin.id }],
  }
  monde.uniques = { memberships: [['user_id', 'dossier_id']] }
  return monde
}

/** Une requête comme le navigateur l'envoie : `apikey` publishable, la session en porteur s'il y en a une, du JSON. */
export function requeteDe(
  slug: string,
  options: {
    personne?: Personne | null
    corps?: unknown
    corpsBrut?: string | Uint8Array<ArrayBuffer>
    methode?: string
    entetes?: Record<string, string>
    apikey?: string | null
  } = {},
): Request {
  const entetes: Record<string, string> = { 'x-client-info': 'supabase-js/2', ...(options.entetes ?? {}) }
  const apikey = options.apikey === undefined ? CLE_PUBLIABLE : options.apikey
  if (apikey !== null) entetes.apikey = apikey
  if (options.personne) entetes.Authorization = `Bearer ${PERSONNES[options.personne].jeton}`
  const methode = options.methode ?? 'POST'
  let corps: string | Uint8Array<ArrayBuffer> | undefined
  if (options.corpsBrut !== undefined) corps = options.corpsBrut
  else if (options.corps !== undefined) {
    corps = JSON.stringify(options.corps)
    entetes['Content-Type'] = 'application/json'
  }
  return new Request(`${URL_PROJET}/functions/v1/${slug}`, {
    method: methode,
    headers: entetes,
    body: methode === 'GET' || methode === 'HEAD' || methode === 'OPTIONS' ? undefined : corps,
  })
}

/** Le préflight CORS d'un navigateur avant un `functions.invoke` : la méthode et les en-têtes qu'il va envoyer. */
export function preflightDe(slug: string, entetesDemandes: readonly string[]): Request {
  return new Request(`${URL_PROJET}/functions/v1/${slug}`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://compta.jdarnis.fr',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': entetesDemandes.join(','),
    },
  })
}
