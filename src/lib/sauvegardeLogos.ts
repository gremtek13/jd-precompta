import { TAILLE_MAX, TYPES_DES_LOGOS_DE_FACTURE } from './bornesStockage'
import {
  FORME_CHEMIN_DU_LOGO, FORME_EMPREINTE_DU_LOGO, SEAU_DU_LOGO, logoDeLaVersion, logoPret, typeDuNomDuLogo, type LogoLu, type TypeDuLogo,
} from './logoDesFactures'

// LE LOGO DES FACTURES DANS LA SAUVEGARDE D'UN DOSSIER (espace client, étape A5c2b ; décision du cabinet A5C-Q5, 17/10/2026 :
// le fichier rejoint la sauvegarde avec l'écran du logo). Un module PUR — il ne lit ni la base ni le seau, n'appelle personne,
// ne lit pas l'horloge — : ce que le fichier de sauvegarde porte des logos, ce que son manifeste en dit, ce qui s'y tient ou
// non, et ce que la restauration redéposera ou dira. La lecture du seau (`lireLeLogo`) et le dépôt (`deposerLeLogo`) vivent
// dans src/lib/sauvegardeDonnees.ts ; le fichier de sauvegarde, dans src/lib/sauvegardeFichier.ts.
//
// CE QUI ENTRE : le fichier de CHAQUE logo qu'une version des paramètres de facturation du dossier désigne — la courante comme
// les remplacées, un logo désigné deux fois porté une fois —, relu dans le seau `ventes` par la session qui sauvegarde, son
// SHA-256 recalculé égal à celui de la version et son type relu à sa signature (`lireLeLogo`), encodé en base64 (RFC 4648,
// §4). Un fichier du seau qu'AUCUNE version ne désigne (un dépôt dont la version a été refusée, A5C-Q3) n'y entre pas : rien
// ne le lit, et la restauration n'aurait nulle part où le désigner. Les autres fichiers du stockage (pièces, documents,
// packs) restent hors de la sauvegarde, comme avant.
//
// UN LOGO QUI MANQUE SE DIT, il ne se tait jamais : le manifeste nomme chaque logo désigné qu'il ne porte pas — absent du seau,
// refusé, illisible, ou d'une autre empreinte — avec sa raison ; une sauvegarde qu'on croit complète est pire qu'une
// sauvegarde qu'on sait partielle. Il ne fait pas échouer la sauvegarde (question A5C2B-Q1) : les lignes du dossier sont ce
// qu'on ne retrouverait nulle part, le logo est une image que le client a choisie et garde ; une sauvegarde refusée pour lui
// laisserait toute la comptabilité sans copie.

// ── Le format ────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * La version du format du fichier de sauvegarde. 1 : les lignes du dossier. 2 (étape A5c2b) : les lignes, et le fichier de
 * chaque logo des factures que ses versions désignent (`fichiers`), avec ce que le manifeste en dit (`logos`). Une sauvegarde
 * de version 1 se lit et se restaure toujours, sans aucun fichier ; une version plus récente que le code est refusée.
 * Définie ici, dans un module pur, parce que la lecture du fichier (sauvegardeFichier.ts) la juge sans importer le client de
 * la base ; sauvegardeDonnees.ts la réexporte.
 */
export const VERSION_SAUVEGARDE = 2

/** Un logo qu'une version des paramètres désigne : son chemin dans le seau, son empreinte, le type que dit son nom, son dossier. */
export interface LogoDesigne {
  chemin: string
  empreinte: string
  type: TypeDuLogo
  dossierId: string
}

/** Ce que le manifeste dit d'un fichier que la sauvegarde porte. */
export interface LogoInclus {
  chemin: string
  empreinte: string
  type: TypeDuLogo
  octets: number
}

/** Un fichier de logo dans le fichier de sauvegarde : son seau, ce qu'il doit être, et ses octets en base64. */
export interface FichierDeSauvegarde extends LogoInclus {
  seau: typeof SEAU_DU_LOGO
  base64: string
}

export const RAISONS_D_UN_MANQUE = ['absent', 'refuse', 'illisible', 'autre_empreinte'] as const
export type RaisonDUnManque = (typeof RAISONS_D_UN_MANQUE)[number]

/** Un logo désigné que la sauvegarde ne porte pas, et pourquoi — en mots, pour qui ouvre le fichier sans l'application. */
export interface LogoManquant {
  chemin: string
  empreinte: string
  raison: RaisonDUnManque
  explication: string
}

/** Ce que le manifeste d'une version 2 dit des logos : ceux qu'elle porte, ceux qui lui manquent. */
export interface LogosDuManifeste {
  inclus: LogoInclus[]
  manquants: LogoManquant[]
}

type Contenu = Record<string, Record<string, unknown>[]>

const estObjet = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
/** Le même logo : le même chemin et la même empreinte (le nom d'un logo EST son empreinte, mais on ne le suppose pas). */
const memeLogo = (a: { chemin: string; empreinte: string }, b: { chemin: string; empreinte: string }) =>
  a.chemin === b.chemin && a.empreinte === b.empreinte

// ── Les logos que les versions désignent ─────────────────────────────────────────────────────────────────────────────
// Lus sur les lignes de `parametres_facturation` telles que la sauvegarde les porte. Une ligne sans logo, ou dont les colonnes
// ne sont pas là (une base sans la migration), n'en désigne aucun. Un chemin d'une autre forme n'existe pas en base : trois
// contraintes le tiennent (`parametres_facturation_logo_entier`, `_sha256_forme`, `_chemin_forme` : le chemin est celui du
// dossier de la ligne, nommé par son empreinte).
function logoDeLaLigne(ligne: Record<string, unknown>): LogoDesigne | null {
  const chemin = ligne.logo_chemin
  const empreinte = ligne.logo_sha256
  if (typeof chemin !== 'string' || typeof empreinte !== 'string') return null
  const logo = logoDeLaVersion({ logo_chemin: chemin, logo_sha256: empreinte })
  if (logo === null || logo === 'non lu') return null
  return { ...logo, dossierId: String(ligne.dossier_id) }
}

/** Les logos distincts que les versions de la sauvegarde désignent, rangés par chemin (l'ordre des octets). */
export function logosDesVersions(contenu: Contenu): LogoDesigne[] {
  const parChemin = new Map<string, LogoDesigne>()
  // Un fichier relu est du JSON : une table qui n'est pas une liste, une ligne qui n'est pas un objet ne désignent rien.
  const lignes: unknown = contenu.parametres_facturation
  for (const ligne of Array.isArray(lignes) ? lignes : []) {
    const logo = estObjet(ligne) ? logoDeLaLigne(ligne) : null
    if (logo && !parChemin.has(logo.chemin)) parChemin.set(logo.chemin, logo)
  }
  return [...parChemin.values()].sort((a, b) => (a.chemin < b.chemin ? -1 : a.chemin > b.chemin ? 1 : 0))
}

// ── Le base64 ────────────────────────────────────────────────────────────────────────────────────────────────────────
// Par tranches : `String.fromCharCode(...octets)` d'un coup dépasserait le nombre d'arguments qu'un appel admet pour un logo
// de 500 Kio. `btoa` et `atob` sont ceux du navigateur et de Node ; le test les confronte à `Buffer`, une référence extérieure.
const TRANCHE_BASE64 = 0x8000

/** Les octets d'un fichier, en base64 (RFC 4648, §4, avec le remplissage). */
export function enBase64(octets: Uint8Array): string {
  let binaire = ''
  for (let i = 0; i < octets.length; i += TRANCHE_BASE64) binaire += String.fromCharCode(...octets.subarray(i, i + TRANCHE_BASE64))
  return btoa(binaire)
}

/** Les octets qu'un texte base64 porte ; null s'il n'en est pas un. */
export function depuisBase64(texte: string): Uint8Array<ArrayBuffer> | null {
  let binaire: string
  try {
    binaire = atob(texte)
  } catch {
    return null
  }
  const octets = new Uint8Array(binaire.length)
  for (let i = 0; i < binaire.length; i++) octets[i] = binaire.charCodeAt(i)
  return octets
}

// ── La sauvegarde d'un logo ──────────────────────────────────────────────────────────────────────────────────────────
/** Pourquoi un logo désigné n'est pas dans la sauvegarde : la phrase que le manifeste porte. */
export function explicationDuManque(lu: Exclude<LogoLu, { etat: 'verifie' }>): string {
  switch (lu.etat) {
    case 'absent':
      return 'Le stockage du dossier ne rend pas ce fichier (il manque au seau, ou la session qui sauvegarde ne le lit pas) : '
        + 'il n’est pas dans cette sauvegarde.'
    case 'refuse':
      return `Le stockage n’a pas rendu ce fichier (${lu.motif}) : il n’est pas dans cette sauvegarde ; une sauvegarde refaite `
        + 'plus tard peut le porter.'
    case 'illisible':
      return 'Le fichier rendu n’est pas une image PNG ou JPEG de 500 Ko au plus, du type que dit son nom : il n’est pas dans '
        + 'cette sauvegarde.'
    case 'autre_empreinte':
      return 'Le fichier rendu n’est pas celui que la version désigne (son empreinte diffère) : il n’est pas dans cette '
        + 'sauvegarde.'
  }
}

/**
 * Ce que la sauvegarde retient d'un logo désigné, d'après sa relecture dans le seau (`lireLeLogo`) : le fichier vérifié,
 * encodé ; ou le manque et sa raison. Le fichier n'est pas rehaché ici : la relecture l'a fait, sur ces mêmes octets.
 */
export async function logoSauvegarde(logo: LogoDesigne, lu: LogoLu): Promise<{ fichier: FichierDeSauvegarde } | { manquant: LogoManquant }> {
  if (lu.etat !== 'verifie') {
    return { manquant: { chemin: logo.chemin, empreinte: logo.empreinte, raison: lu.etat, explication: explicationDuManque(lu) } }
  }
  const octets = new Uint8Array(await lu.corps.arrayBuffer())
  return {
    fichier: { seau: SEAU_DU_LOGO, chemin: logo.chemin, empreinte: logo.empreinte, type: lu.type, octets: octets.length, base64: enBase64(octets) },
  }
}

/** Ce que le manifeste dit des fichiers portés : tout, sauf leurs octets. */
export function logoInclus(f: FichierDeSauvegarde): LogoInclus {
  return { chemin: f.chemin, empreinte: f.empreinte, type: f.type, octets: f.octets }
}

// ── La cohérence d'une sauvegarde relue ──────────────────────────────────────────────────────────────────────────────
// Ce que la lecture d'un fichier de sauvegarde (sauvegardeFichier.ts) refuse des logos, avant toute restauration : une
// sauvegarde de version 2 dit, dans son manifeste, chaque fichier qu'elle porte et chaque logo désigné qu'elle ne porte pas,
// et rien d'autre ; un fichier qu'aucune version ne désigne est un intrus (la restauration ne le redéposerait nulle part, et
// le dossier qu'il nommerait ne serait pas forcément celui-ci). Les OCTETS ne se jugent pas ici : un fichier abîmé se dit à la
// restauration, qui ne le redépose pas (`planDesLogos`), sans empêcher les lignes de revenir (question A5C2B-Q2).

/** Ce qui ne va pas dans la FORME d'un fichier de logo ; null quand elle est juste. */
function fauteDeForme(f: unknown): string | null {
  if (!estObjet(f)) return 'n’est pas un objet'
  if (f.seau !== SEAU_DU_LOGO) return `n’est pas du seau « ${SEAU_DU_LOGO} »`
  if (typeof f.empreinte !== 'string' || !FORME_EMPREINTE_DU_LOGO.test(f.empreinte)) return 'n’a pas une empreinte SHA-256 en soixante-quatre chiffres hexadécimaux'
  if (typeof f.chemin !== 'string' || !FORME_CHEMIN_DU_LOGO.test(f.chemin)) return 'n’a pas le chemin d’un logo (« dossier/logos/empreinte.png » ou « .jpg »)'
  if (f.chemin.split('/')[2].split('.')[0] !== f.empreinte) return 'n’est pas nommé par son empreinte'
  if (typeof f.type !== 'string' || !(TYPES_DES_LOGOS_DE_FACTURE as readonly string[]).includes(f.type) || f.type !== typeDuNomDuLogo(f.chemin)) {
    return 'n’a pas le type que dit son nom (PNG ou JPEG)'
  }
  if (typeof f.octets !== 'number' || !Number.isSafeInteger(f.octets) || f.octets < 1 || f.octets > TAILLE_MAX.ventes) {
    return `n’a pas un poids d’un à ${TAILLE_MAX.ventes} octets`
  }
  if (typeof f.base64 !== 'string') return 'n’a pas ses octets en base64'
  return null
}

function fauteDuManquant(m: unknown): string | null {
  if (!estObjet(m)) return 'n’est pas un objet'
  if (typeof m.chemin !== 'string' || typeof m.empreinte !== 'string') return 'n’a pas de chemin ni d’empreinte lisibles'
  if (typeof m.raison !== 'string' || !(RAISONS_D_UN_MANQUE as readonly string[]).includes(m.raison)) return 'n’a pas une raison connue'
  if (typeof m.explication !== 'string') return 'n’a pas d’explication'
  return null
}

/**
 * Les incohérences des logos d'une sauvegarde relue — `logos` et `fichiers` tels que le JSON les donne —, vide quand tout se
 * tient. Une version 1 ne porte aucun fichier. Une version 2 : chaque fichier a la forme d'un logo, est annoncé au manifeste
 * tel qu'il est porté, et une version de la sauvegarde le désigne ; chaque logo désigné est porté ou dit manquant ; rien n'est
 * dit deux fois.
 */
export function incoherencesDesLogos(version: number, logos: unknown, fichiers: unknown, contenu: Contenu): string[] {
  if (version < 2) {
    return Array.isArray(fichiers) && fichiers.length > 0
      ? ['logos : une sauvegarde au format 1 ne porte aucun fichier, et ceux-ci ne seraient redéposés nulle part']
      : []
  }
  if (!estObjet(logos) || !Array.isArray(logos.inclus) || !Array.isArray(logos.manquants)) {
    return ['logos : le manifeste ne dit pas les logos des factures (« logos.inclus », « logos.manquants »)']
  }
  if (!Array.isArray(fichiers)) return ['logos : les fichiers des logos (« fichiers ») ne sont pas une liste']

  const fautes: string[] = []
  const portes: FichierDeSauvegarde[] = []
  fichiers.forEach((f, i) => {
    const faute = fauteDeForme(f)
    const nom = estObjet(f) && typeof f.chemin === 'string' ? `« ${f.chemin} »` : `n° ${i + 1}`
    if (faute) fautes.push(`logos : le fichier ${nom} ${faute}`)
    else portes.push(f as unknown as FichierDeSauvegarde)
  })
  const inclus: LogoInclus[] = []
  for (const l of logos.inclus as unknown[]) {
    if (estObjet(l) && typeof l.chemin === 'string' && typeof l.empreinte === 'string') inclus.push(l as unknown as LogoInclus)
    else fautes.push('logos : une entrée de « logos.inclus » n’a pas de chemin ni d’empreinte lisibles')
  }
  const manquants: LogoManquant[] = []
  for (const m of logos.manquants as unknown[]) {
    const faute = fauteDuManquant(m)
    if (faute) fautes.push(`logos : une entrée de « logos.manquants » ${faute}`)
    else manquants.push(m as unknown as LogoManquant)
  }
  if (fautes.length > 0) return fautes

  const designes = logosDesVersions(contenu)
  const vus = new Set<string>()
  for (const f of portes) {
    if (vus.has(f.chemin)) fautes.push(`logos : le fichier « ${f.chemin} » est porté deux fois`)
    vus.add(f.chemin)
    const annonce = inclus.find((l) => l.chemin === f.chemin)
    if (!annonce) fautes.push(`logos : le fichier « ${f.chemin} » est porté sans être annoncé au manifeste`)
    else if (annonce.empreinte !== f.empreinte || annonce.type !== f.type || annonce.octets !== f.octets) {
      fautes.push(`logos : le fichier « ${f.chemin} » n’est pas porté tel que le manifeste l’annonce`)
    }
    if (!designes.some((d) => memeLogo(d, f))) fautes.push(`logos : le fichier « ${f.chemin} » n’est désigné par aucune version des paramètres de facturation`)
  }
  for (const l of inclus) {
    if (!portes.some((f) => f.chemin === l.chemin)) fautes.push(`logos : le fichier « ${l.chemin} » est annoncé au manifeste et n’est pas porté`)
  }
  for (const m of manquants) {
    if (portes.some((f) => f.chemin === m.chemin)) fautes.push(`logos : le fichier « ${m.chemin} » est porté et dit manquant`)
    if (!designes.some((d) => memeLogo(d, m))) fautes.push(`logos : le logo manquant « ${m.chemin} » n’est désigné par aucune version`)
  }
  for (const d of designes) {
    if (!portes.some((f) => memeLogo(f, d)) && !manquants.some((m) => memeLogo(m, d))) {
      fautes.push(`logos : le logo « ${d.chemin} », qu’une version désigne, n’est ni porté ni dit manquant`)
    }
  }
  return fautes
}

// ── La restauration ──────────────────────────────────────────────────────────────────────────────────────────────────
/** Ce que la restauration lit d'une sauvegarde pour ses logos. */
export interface SauvegardeAvecLogos {
  manifeste: { version: number; dossierId: string; logos?: LogosDuManifeste }
  contenu: Contenu
  fichiers?: FichierDeSauvegarde[]
}

/** Un logo prêt à redéposer : vérifié contre la version qui le désigne, ses octets dans un Blob. */
export interface LogoARedeposer {
  chemin: string
  empreinte: string
  dossierId: string
  corps: Blob
}

export type IssueDUnLogo = 'redepose' | 'deja_la' | 'non_redepose' | 'absent_de_la_sauvegarde'

/** Ce que la restauration a fait d'un logo désigné, ou d'un fichier porté — dit au bilan, jamais tu. */
export interface LogoRestaure {
  chemin: string
  empreinte: string
  issue: IssueDUnLogo
  explication: string
}

const OU_REDEPOSER = 'il est à redéposer depuis la vue « Paramètres » de l’onglet Factures (« Redéposer le fichier »).'

/**
 * Ce que la restauration redéposera, jugé AVANT la première écriture et sans réseau : chaque fichier porté, s'il est désigné
 * par une version de la sauvegarde — une version du dossier restauré —, se décode, est un logo que le seau admet (`logoPret` :
 * sa signature, sa borne), a l'empreinte de la version, et se range au chemin que la version désigne — celui que `logoPret`
 * tire du dossier, de l'empreinte et du type des octets, jamais celui que le fichier annonce. Le super-administrateur qui
 * restaure peut déposer sous tout dossier (`gere_les_ventes` l'admet partout) : ces contrôles sont ce qui l'en garde. Sinon
 * le fichier n'est pas redéposé, et le bilan dit pourquoi ; de même chaque logo désigné que la sauvegarde ne porte pas.
 */
export async function planDesLogos(sauvegarde: SauvegardeAvecLogos): Promise<{ aRedeposer: LogoARedeposer[]; nonRedeposes: LogoRestaure[] }> {
  const designes = logosDesVersions(sauvegarde.contenu)
  const portes = sauvegarde.fichiers ?? []
  const aRedeposer: LogoARedeposer[] = []
  const nonRedeposes: LogoRestaure[] = []
  const non = (f: { chemin: string; empreinte: string }, explication: string) => {
    nonRedeposes.push({ chemin: f.chemin, empreinte: f.empreinte, issue: 'non_redepose', explication })
  }
  for (const f of portes) {
    const designe = designes.find((d) => memeLogo(d, f))
    if (!designe) {
      non(f, 'Aucune version des paramètres de la sauvegarde ne désigne ce fichier : il n’est pas redéposé.')
      continue
    }
    if (designe.dossierId !== sauvegarde.manifeste.dossierId) {
      non(f, 'La version qui le désigne n’est pas une version du dossier restauré : il n’est pas redéposé.')
      continue
    }
    const octets = depuisBase64(f.base64)
    if (octets === null) {
      non(f, 'Ses octets ne se décodent pas (base64 illisible) : le fichier de sauvegarde a été abîmé, il n’est pas redéposé.')
      continue
    }
    const pret = await logoPret(designe.dossierId, new Blob([octets]))
    if ('refus' in pret) {
      non(f, `Ce n’est pas un logo que le seau admet (${pret.refus.message}) : il n’est pas redéposé.`)
      continue
    }
    if (pret.empreinte !== f.empreinte) {
      non(f, 'Ses octets n’ont pas l’empreinte que la version désigne : le fichier de sauvegarde a été abîmé ou modifié, il '
        + 'n’est pas redéposé.')
      continue
    }
    if (pret.chemin !== f.chemin) {
      non(f, 'Ses octets ne sont pas du type que dit son nom, ou son chemin n’est pas sous le dossier de la version : il n’est '
        + 'pas redéposé.')
      continue
    }
    aRedeposer.push({ chemin: f.chemin, empreinte: f.empreinte, dossierId: designe.dossierId, corps: new Blob([octets]) })
  }
  for (const d of designes) {
    if (portes.some((f) => memeLogo(f, d))) continue
    const manquant = sauvegarde.manifeste.logos?.manquants.find((m) => memeLogo(m, d))
    const pourquoi = manquant
      ? manquant.explication
      : sauvegarde.manifeste.version < 2
        ? 'Une sauvegarde au format 1 ne porte aucun fichier.'
        : 'La sauvegarde ne porte pas ce fichier, et son manifeste ne dit pas pourquoi.'
    nonRedeposes.push({
      chemin: d.chemin, empreinte: d.empreinte, issue: 'absent_de_la_sauvegarde',
      explication: `${pourquoi} La version restaurée le désigne : ${OU_REDEPOSER}`,
    })
  }
  return { aRedeposer, nonRedeposes }
}

export const EXPLICATION_REDEPOSE = 'Le fichier est de retour au chemin que la version désigne ; son empreinte a été vérifiée avant le dépôt.'
export const EXPLICATION_DEJA_LA = 'Un fichier de ce nom était déjà dans le seau, de la même empreinte (relu et vérifié) : rien n’a été déposé.'

/** Le dépôt d'un logo a échoué : ce que le bilan en dit, et que le logo reste à redéposer. */
export function explicationDuDepotEchoue(message: string): string {
  const raison = /[.!?]$/.test(message.trim()) ? message.trim() : `${message.trim()}.`
  return `Le dépôt a échoué : ${raison} La version restaurée le désigne : ${OU_REDEPOSER}`
}

/** Le bilan des logos, rangé par chemin : ce qui a été redéposé, ce qui était là, ce qui manque et pourquoi. */
export function bilanDesLogos(logos: readonly LogoRestaure[]): LogoRestaure[] {
  return [...logos].sort((a, b) => (a.chemin < b.chemin ? -1 : a.chemin > b.chemin ? 1 : 0))
}

// ── La vérification ──────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Les fichiers de la sauvegarde que la relecture du dossier restauré ne trouve pas dans le seau, vérifiés à leur chemin :
 * un écart chacun. Un logo que la sauvegarde ne portait pas n'en est pas un — la relecture ne peut pas trouver ce qu'elle
 * n'a pas reçu, et le bilan l'a dit.
 */
export function ecartsDesLogos(
  sauvegarde: { fichiers?: readonly FichierDeSauvegarde[] }, relue: { fichiers?: readonly FichierDeSauvegarde[] },
): { table: typeof SEAU_DU_LOGO; motif: 'fichier_absent'; identite: string }[] {
  return (sauvegarde.fichiers ?? [])
    .filter((f) => !(relue.fichiers ?? []).some((r) => memeLogo(r, f)))
    .map((f) => ({ table: SEAU_DU_LOGO, motif: 'fichier_absent' as const, identite: f.chemin }))
}

// ── Ce que les écrans en disent ──────────────────────────────────────────────────────────────────────────────────────
const pluriel = (n: number, un: string, plusieurs: string) => `${n} ${n > 1 ? plusieurs : un}`

/** Ce que la carte de la sauvegarde dit, en clair, des logos qui manquent à la sauvegarde téléchargée ; null s'il n'en manque aucun. */
export function phraseDesLogosManquants(logos: LogosDuManifeste | undefined): string | null {
  if (!logos || logos.manquants.length === 0) return null
  const n = logos.manquants.length
  return `${pluriel(n, 'logo des factures n’est pas', 'logos des factures ne sont pas')} dans cette sauvegarde, que les `
    + 'versions des paramètres désignent pourtant ; le reste du dossier y est. '
    + logos.manquants.map((m) => m.explication).join(' ')
}

/** Ce que la carte de la restauration dit des logos AVANT le clic ; null quand la sauvegarde n'en désigne aucun. */
export function resumeDesLogos(sauvegarde: SauvegardeAvecLogos): string | null {
  const designes = logosDesVersions(sauvegarde.contenu)
  const portes = sauvegarde.fichiers ?? []
  if (designes.length === 0 && portes.length === 0) return null
  if (sauvegarde.manifeste.version < 2) {
    return `Sauvegarde au format 1 : elle ne porte aucun fichier. Les versions des paramètres de facturation désignent `
      + `${pluriel(designes.length, 'logo', 'logos')} : ${designes.length > 1 ? 'ils seront' : 'il sera'} à redéposer depuis la vue `
      + '« Paramètres » de l’onglet Factures.'
  }
  const manquants = designes.filter((d) => !portes.some((f) => memeLogo(f, d))).length
  return `Logos des factures : ${pluriel(portes.length, 'fichier porté', 'fichiers portés')}, redéposés dans le seau `
    + `« ${SEAU_DU_LOGO} » après les lignes, leur empreinte vérifiée avant chaque dépôt`
    + (manquants > 0 ? ` ; ${pluriel(manquants, 'logo désigné', 'logos désignés')} que la sauvegarde ne porte pas.` : '.')
}

const LIBELLES_DES_ISSUES: Record<IssueDUnLogo, string> = {
  redepose: 'Redéposé',
  deja_la: 'Déjà présent',
  non_redepose: 'Non redéposé',
  absent_de_la_sauvegarde: 'Absent de la sauvegarde',
}

/** Le bilan des logos après une restauration, une ligne par logo : son issue, son chemin, et ce qu'il faut en savoir. */
export function phrasesDuBilanDesLogos(logos: readonly LogoRestaure[]): string[] {
  return bilanDesLogos(logos).map((l) => `${LIBELLES_DES_ISSUES[l.issue]} — ${l.chemin} : ${l.explication}`)
}
