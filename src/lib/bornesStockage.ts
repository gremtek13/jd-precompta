// LES BORNES DES SEAUX DU STOCKAGE (ligne 22.6 de la feuille de route, 12/10/2026 ; le quatrième, `ventes`, étape A5c1 de
// l'espace client, 17/10/2026).
//
// Jusqu'ici aucun seau ne bornait ni la taille ni le type de ce qu'on y dépose, et `cabinet-logos`, PUBLIC, acceptait un
// SVG — qui peut porter du script, servi depuis le domaine du stockage. Les bornes vivent à DEUX endroits : ici, où
// l'application les vérifie AVANT l'envoi et dit le refus en français ; et dans la migration `bornes_du_stockage`
// (supabase/schema/), où le stockage les applique lui-même (413 au-delà de la taille, 415 hors des types).
// `bornesStockage.test.ts` confronte les deux valeur par valeur, et `depotsDansLesSeaux.test.ts` exige que chaque dépôt
// de toute la source envoie un type que la migration admet pour son seau.
//
// LE TYPE ENVOYÉ, C'EST L'APPLICATION QUI LE DÉCIDE. Le SDK installé (storage-js 2.112.4, `uploadOrUpdate`) envoie un
// `Blob` en multipart et y IGNORE l'option `contentType` : la partie porte le type du Blob — `application/octet-stream`
// s'il est vide —, et c'est lui que le stockage juge. Or le type d'un `File` est celui que le système d'exploitation
// déduit de l'extension : un CSV y est `text/csv`, `application/vnd.ms-excel` (Windows avec Excel),
// `text/comma-separated-values` (Android) ou rien du tout. Borner le seau sur ces variantes, c'était une liste ouverte,
// ou refuser en production un relevé qui passait la veille. Chaque dépôt part donc dans un Blob RÉÉTIQUETÉ ici, d'un type
// de la liste de son seau : `preparerPiece` (un fichier choisi ou reçu), `preparerLogo`, `preparerContenu` (ce que
// l'application construit elle-même — un pack, une facture reçue d'une plateforme), `preparerLogoDeFacture` (le logo des
// factures d'un dossier, seau `ventes`).
//
// LE SEAU `ventes` (étape A5c1) : PRIVÉ, le logo des factures d'un dossier, PNG ou JPEG, 500 Kio au plus, jamais un SVG.
// Ses bornes vivent ici et dans la migration `logo_des_factures`, appliquée sur l'accord du cabinet et portée par l'export :
// bornesStockage.test.ts confronte le module à elle et à l'essai supabase/essais/bornesStockage.sql
// (`LOGO_DES_FACTURES_EXPORTE`, src/lib/logoDesFactures.ts). Un seul dépôt de la source y écrit : celui de l'écran du logo
// (src/lib/logoDesFacturesEcriture.ts, étape A5c2a), qui passe par `logoPret`.
//
// Ce module ne dépose rien : il rend le corps à envoyer, ou le refus à dire. Il n'importe pas le client Supabase.

export type Seau = 'pieces' | 'packs' | 'cabinet-logos' | 'ventes'

// ── DÉBUT COPIE bornesDesPieces ──────────────────────────────────────────────────────────────────────────────────────
// LA BORNE D'UNE PIÈCE ET LE TYPE SOUS LEQUEL ELLE SE DÉPOSE (ligne 22.6). L'original vit dans src/lib/bornesStockage.ts ;
// il est copié À L'IDENTIQUE dans receive-email, auto-portée, et bornesDesPiecesCopie.test.ts compare la copie au
// caractère près et l'exécute contre l'original.

/**
 * La plus grande pièce déposée, 20 Mio (20 971 520 octets) : décision du cabinet du 13/10/2026 (S226-Q1), la borne que
 * receive-email appliquait déjà aux pièces jointes. Au-dessus du plus gros fichier d'aujourd'hui (1,4 Mo) et d'une photo
 * de téléphone (3 à 15 Mo), en dessous du plafond du plan gratuit (50 Mo) ; la lecture automatique, elle, s'arrête à
 * 10 Mio (extract-piece). La changer, c'est la changer ici, dans cette copie, et par une nouvelle migration du seau :
 * `bornes_du_stockage` est appliquée.
 */
export const TAILLE_MAX_PIECE = 20 * 1024 * 1024

/** Le type d'une pièce d'après son extension : celles que l'application accepte depuis toujours. */
const TYPES_PAR_EXTENSION: ReadonlyMap<string, string> = new Map([
  ['pdf', 'application/pdf'], ['jpg', 'image/jpeg'], ['jpeg', 'image/jpeg'], ['png', 'image/png'], ['csv', 'text/csv'],
])

/** Le type d'une pièce d'après ses premiers octets, quand son nom ne le dit pas : PDF, JPEG ou PNG. */
function typeParSignature(o: Uint8Array): string | null {
  if (o[0] === 0x25 && o[1] === 0x50 && o[2] === 0x44 && o[3] === 0x46) return 'application/pdf'
  if (o[0] === 0xff && o[1] === 0xd8 && o[2] === 0xff) return 'image/jpeg'
  if (o[0] === 0x89 && o[1] === 0x50 && o[2] === 0x4e && o[3] === 0x47) return 'image/png'
  return null
}

/**
 * Le type sous lequel une pièce se dépose, ou null si l'application ne la prend pas : son extension d'abord, comme
 * l'import l'a toujours fait ; sinon sa signature — un PDF renommé sans extension reste un PDF. Le type que déclare le
 * navigateur ou l'expéditeur d'un e-mail ne compte pas.
 */
export function typeDUnePiece(nom: string, debut: Uint8Array): string | null {
  const point = nom.lastIndexOf('.')
  const parExtension = point < 0 ? undefined : TYPES_PAR_EXTENSION.get(nom.slice(point + 1).toLowerCase())
  return parExtension ?? typeParSignature(debut)
}
// ── FIN COPIE bornesDesPieces ────────────────────────────────────────────────────────────────────────────────────────

/**
 * Les types que chaque seau admet : la liste de la migration `bornes_du_stockage` — et, pour `ventes`, celle de la migration
 * `logo_des_factures` —, rien d'autre.
 */
export const TYPES_ADMIS = {
  pieces: ['application/pdf', 'image/jpeg', 'image/png', 'text/csv', 'text/plain'],
  packs: ['application/zip', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  'cabinet-logos': ['image/png', 'image/jpeg', 'image/webp'],
  // Le logo des factures : deux formats que tout PDF sait porter (le JPEG par `DCTDecode`, le PNG par `FlateDecode` et ses
  // prédicteurs, ISO 32000-1, §7.4) ; ni WebP, qu'aucun filtre du PDF ne lit, ni SVG, qui porte du script.
  ventes: ['image/png', 'image/jpeg'],
} as const satisfies Record<Seau, readonly string[]>

/** La plus grande taille que chaque seau admet, en octets : la valeur de la migration. */
export const TAILLE_MAX = {
  pieces: TAILLE_MAX_PIECE,
  // Le plafond du plan gratuit (50 Mio) : un pack plus lourd ne passe déjà pas aujourd'hui — la borne ne fait que le
  // dire avant l'envoi, en français.
  packs: 50 * 1024 * 1024,
  // Un logo s'affiche dans la barre latérale de chaque page : 500 Kio suffisent, et le logo d'aujourd'hui en pèse 26.
  'cabinet-logos': 500 * 1024,
  // Le logo des factures : la même borne, celle de la conception (§A.5.2) — une en-tête de facture, pas une photographie.
  ventes: 500 * 1024,
} as const satisfies Record<Seau, number>

export type TypeAdmis<S extends Seau> = (typeof TYPES_ADMIS)[S][number]

/** Un type admis, avec ou sans paramètres (`text/plain; charset=utf-8`) : le stockage ne juge que `type/sous-type`. */
export type TypeDuSeau<S extends Seau> = TypeAdmis<S> | `${TypeAdmis<S>};${string}` | `${TypeAdmis<S>}; ${string}`

/** Ce que `preparerPiece` peut envoyer — et `typeDUnePiece`, dans receive-email. */
export const TYPES_DES_FICHIERS_DE_PIECE = ['application/pdf', 'image/jpeg', 'image/png', 'text/csv'] as const

/** Ce que `preparerLogo` peut envoyer. */
export const TYPES_DES_LOGOS = TYPES_ADMIS['cabinet-logos']

/** Ce que `preparerLogoDeFacture` peut envoyer. */
export const TYPES_DES_LOGOS_DE_FACTURE = TYPES_ADMIS.ventes

/** Ce qu'un seau refuse, et pourquoi. */
export interface RefusDuDepot {
  raison: 'format' | 'taille'
  /** La phrase, sans majuscule ni point final : l'écran la place après le nom du fichier, ou après un deux-points. */
  message: string
  /** Ce que pèse le fichier, en octets. */
  taille: number
}

/** Le corps à déposer — un Blob du type que le seau admet —, son type et sa taille. */
export interface DepotPret {
  corps: Blob
  type: string
  taille: number
}

export type IssueDuDepot = DepotPret | { refus: RefusDuDepot }

/** Ce qu'un seau contient, pour dire « au-delà des 20 Mo qu'une pièce peut peser ». */
const CE_QU_IL_CONTIENT: Record<Seau, string> = {
  pieces: 'une pièce',
  packs: 'un pack',
  'cabinet-logos': 'un logo',
  ventes: 'un logo de facture',
}

/** Les formats d'un seau, dits à qui dépose. */
const FORMATS_DITS: Record<Seau, string> = {
  pieces: 'une pièce se dépose en PDF, JPEG, PNG ou CSV',
  packs: 'un pack est une archive ZIP et son récapitulatif Excel',
  'cabinet-logos': 'un logo se dépose en PNG, JPEG ou WebP',
  ventes: 'un logo de facture se dépose en PNG ou en JPEG',
}

const KIO = 1024
const MIO = 1024 * 1024

/** Un poids en Ko ou en Mo (1 Ko = 1 024 octets, comme le stockage compte), à une décimale, sans coupure de ligne. */
export function poids(octets: number): string {
  if (octets < KIO) return `${octets} octet${octets > 1 ? 's' : ''}`
  const [valeur, unite] = octets < MIO ? [octets / KIO, 'Ko'] : [octets / MIO, 'Mo']
  return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1, useGrouping: false }).format(valeur)} ${unite}`
}

/** Un poids à l'octet près, chiffres groupés (espace fine insécable). */
function aLOctet(octets: number): string {
  return `${new Intl.NumberFormat('fr-FR').format(octets)} octets`
}

/**
 * Des poids et leur borne, dits pour qu'on voie l'écart : à une décimale, un poids et la borne peuvent s'écrire pareil
 * (20 Mio et un octet se lisent « 20 Mo ») — tout se dit alors à l'octet. Exportée pour la pièce jointe qu'une réception
 * par e-mail a écartée (ligne 22.7, src/lib/piecesJointesEcartees.ts) : elle se dit comme le refus d'un dépôt.
 */
export function poidsFaceALaBorne(octets: readonly number[], borne: number): { lus: string[]; borne: string } {
  const lus = octets.map(poids)
  if (!lus.includes(poids(borne))) return { lus, borne: poids(borne) }
  return { lus: octets.map(aLOctet), borne: aLOctet(borne) }
}

function refusDeTaille(seau: Seau, taille: number): RefusDuDepot {
  const dits = poidsFaceALaBorne([taille], TAILLE_MAX[seau])
  return {
    raison: 'taille', taille,
    message: `il pèse ${dits.lus[0]}, au-delà des ${dits.borne} qu’${CE_QU_IL_CONTIENT[seau]} peut peser`,
  }
}

function refusDeFormat(seau: Seau, taille: number): RefusDuDepot {
  return { raison: 'format', taille, message: `format non pris en charge (${FORMATS_DITS[seau]})` }
}

/** Le refus de la taille, ou le corps réétiqueté : le dernier pas de chaque préparation. */
function borner(seau: Seau, contenu: Blob | Uint8Array<ArrayBuffer>, type: string): IssueDuDepot {
  const taille = contenu instanceof Uint8Array ? contenu.byteLength : contenu.size
  if (taille > TAILLE_MAX[seau]) return { refus: refusDeTaille(seau, taille) }
  return { corps: new Blob([contenu], { type }), type, taille }
}

async function premiersOctets(fichier: Blob): Promise<Uint8Array> {
  return new Uint8Array(await fichier.slice(0, 16).arrayBuffer())
}

/**
 * Un fichier qui devient une PIÈCE (seau `pieces`) : déposé par le client ou le cabinet, ou reçu par e-mail (la copie de
 * receive-email). Son type est décidé par `typeDUnePiece`, sa taille bornée par `TAILLE_MAX_PIECE`.
 */
export async function preparerPiece(fichier: File): Promise<IssueDuDepot> {
  const type = typeDUnePiece(fichier.name, await premiersOctets(fichier))
  if (type === null) return { refus: refusDeFormat('pieces', fichier.size) }
  return borner('pieces', fichier, type)
}

/** Le refus d'une pièce, ou null si elle peut partir : ce qu'un écran dit dès le choix du fichier. */
export async function refusDUnePiece(fichier: File): Promise<RefusDuDepot | null> {
  const issue = await preparerPiece(fichier)
  return 'refus' in issue ? issue.refus : null
}

/**
 * Le type d'un logo, lu à sa SIGNATURE et jamais à son nom : le seau est public, il sert le type qu'on lui a dit, et un
 * SVG renommé « .png » n'en est pas un. PNG (ses huit octets), JPEG, WebP (« RIFF », puis « WEBP » au huitième octet).
 */
export function typeDUnLogo(o: Uint8Array): TypeAdmis<'cabinet-logos'> | null {
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (png.every((octet, i) => o[i] === octet)) return 'image/png'
  if (o[0] === 0xff && o[1] === 0xd8 && o[2] === 0xff) return 'image/jpeg'
  const riff = o[0] === 0x52 && o[1] === 0x49 && o[2] === 0x46 && o[3] === 0x46
  if (riff && o[8] === 0x57 && o[9] === 0x45 && o[10] === 0x42 && o[11] === 0x50) return 'image/webp'
  return null
}

/** L'extension du chemin d'un logo, tirée de son type — jamais du nom que portait le fichier. */
export function extensionDuLogo(type: string): string {
  return type === 'image/jpeg' ? 'jpg' : type === 'image/webp' ? 'webp' : 'png'
}

/** Un logo de cabinet (seau `cabinet-logos`, public) : PNG, JPEG ou WebP, 500 Kio au plus. */
export async function preparerLogo(fichier: Blob): Promise<IssueDuDepot> {
  const type = typeDUnLogo(await premiersOctets(fichier))
  if (type === null) return { refus: refusDeFormat('cabinet-logos', fichier.size) }
  return borner('cabinet-logos', fichier, type)
}

/** Le refus d'un logo, ou null s'il peut partir. */
export async function refusDUnLogo(fichier: Blob): Promise<RefusDuDepot | null> {
  const issue = await preparerLogo(fichier)
  return 'refus' in issue ? issue.refus : null
}

/**
 * Le type du logo des factures, lu à sa SIGNATURE et jamais à son nom ni au type que déclare le navigateur : PNG (ses huit
 * octets) ou JPEG ; un WebP, un SVG ou tout autre fichier n'en est pas un. Le jumeau de `typeDUnLogo`, sans le WebP.
 */
export function typeDUnLogoDeFacture(o: Uint8Array): TypeAdmis<'ventes'> | null {
  const type = typeDUnLogo(o)
  return type === 'image/png' || type === 'image/jpeg' ? type : null
}

/**
 * Le logo des factures d'un dossier (seau `ventes`, privé) : PNG ou JPEG, 500 Kio au plus, rendu dans un Blob RÉÉTIQUETÉ
 * du type que dit sa signature — celui que le stockage jugera, et que le chemin du logo dira (src/lib/logoDesFactures.ts).
 */
export async function preparerLogoDeFacture(fichier: Blob): Promise<IssueDuDepot> {
  const type = typeDUnLogoDeFacture(await premiersOctets(fichier))
  if (type === null) return { refus: refusDeFormat('ventes', fichier.size) }
  return borner('ventes', fichier, type)
}

/** `type/sous-type`, en minuscules, sans paramètres : ce que le stockage compare (RFC 9110, § 8.3.1). */
export function typeSansParametres(type: string): string {
  return type.split(';')[0].trim().toLowerCase()
}

/**
 * Ce que l'application construit elle-même — un pack et son récapitulatif, l'original d'une facture reçue et sa version
 * lisible : son type est donné par l'appelant, et le compilateur n'en accepte qu'un que le seau admet ; sa taille est
 * bornée. Le type est revérifié ici, pour qu'une valeur venue d'ailleurs que le code ne parte pas sans être jugée.
 */
export function preparerContenu<S extends Seau>(seau: S, contenu: Blob | Uint8Array<ArrayBuffer>, type: TypeDuSeau<S>): IssueDuDepot {
  const taille = contenu instanceof Uint8Array ? contenu.byteLength : contenu.size
  if (!(TYPES_ADMIS[seau] as readonly string[]).includes(typeSansParametres(type))) return { refus: refusDeFormat(seau, taille) }
  return borner(seau, contenu, type)
}

/**
 * Le bilan des fichiers écartés d'un lot, sans nom de fichier : combien, et pourquoi — le format, ou le poids de chacun
 * face à la borne. Vide quand rien n'est écarté.
 */
export function bilanDesRefus(seau: Seau, refus: readonly RefusDuDepot[]): string {
  if (refus.length === 0) return ''
  const formats = refus.filter((r) => r.raison === 'format').length
  const lourds = refus.filter((r) => r.raison === 'taille')
  const parts: string[] = []
  if (formats > 0) parts.push(`${formats} au format non pris en charge`)
  if (lourds.length > 0) {
    const dits = poidsFaceALaBorne(lourds.map((r) => r.taille), TAILLE_MAX[seau])
    parts.push(`${lourds.length} au-delà de ${dits.borne} (${dits.lus.join(', ')})`)
  }
  return `${refus.length} ignoré(s) : ${parts.join(' ; ')}`
}
