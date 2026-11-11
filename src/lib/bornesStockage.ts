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

// ── LE SEAU `ventes` : LE LOGO DES FACTURES, ET L'ORIGINAL D'UNE FACTURE REPRISE (A8d2a) ──────────────────────────────
// Le logo des factures a SES bornes, quelles que soient celles du seau : deux formats que tout PDF sait porter (le JPEG par
// `DCTDecode`, le PNG par `FlateDecode` et ses prédicteurs, ISO 32000-1, §7.4) — ni WebP, qu'aucun filtre du PDF ne lit,
// ni SVG, qui porte du script — et 500 Kio, la borne de la conception (§A.5.2) : une en-tête de facture, pas une
// photographie. Jusqu'à A8d2a, le seau ne portait que lui, et ses bornes étaient celles du seau.
//
// La migration `originaux_des_imports` (supabase/schema/20261111131855_originaux_des_imports.sql, en production depuis le
// 11/11/2026) y range aussi l'ORIGINAL d'une
// facture reprise de l'ancien logiciel, sous `<dossier>/imports/<lot>/<empreinte>.<pdf|xml|csv>` : le stockage jugeant le
// type et la taille au niveau du SEAU (une policy ne voit pas le fichier), le seau admet alors l'union — 20 Mio, et le
// PDF, le texte brut (un XML, rangé en `text/plain` : servi sous un type XML, il peut porter du script, comme un SVG) et
// le CSV en plus —, et `enregistrer_parametres_facturation` borne le logo à la plus petite de la borne du seau et de
// 512 000 octets. `ORIGINAUX_DES_IMPORTS_PREVUS` dit si elle est en base : levé le 11/11/2026 ; son état d'avant (le seau aux bornes du
// logo) reste éprouvé par `bornesDuSeauDesVentes(false)` et, dans les écrans, par un accesseur.

/** La migration `originaux_des_imports` est-elle en base ? Oui depuis le 11/11/2026 (A8d2a, version 20261111131855). */
export const ORIGINAUX_DES_IMPORTS_PREVUS: boolean = true

/** Ce que `preparerLogoDeFacture` peut envoyer : PNG ou JPEG. */
export const TYPES_DES_LOGOS_DE_FACTURE = ['image/png', 'image/jpeg'] as const

/** Le poids d'un logo de facture : 500 Kio, la borne que la fonction des paramètres tient, quelle que soit celle du seau. */
export const TAILLE_MAX_LOGO_DE_FACTURE = 500 * 1024

/**
 * Ce que `preparerOriginalDImport` peut envoyer : le PDF (une Factur-X), le texte brut (un XML CII ou UBL) et le CSV — ni
 * SVG, ni HTML, ni type XML : un original se lit, il ne s'exécute pas.
 */
export const TYPES_DES_ORIGINAUX_D_IMPORT = ['application/pdf', 'text/plain', 'text/csv'] as const

/** Le poids d'un original d'import : 20 Mio, la borne des pièces (S226-Q1) — une Factur-X en pèse quelques centaines de Ko. */
export const TAILLE_MAX_ORIGINAL_D_IMPORT = TAILLE_MAX_PIECE

type TypeDuSeauDesVentes = (typeof TYPES_DES_LOGOS_DE_FACTURE)[number] | (typeof TYPES_DES_ORIGINAUX_D_IMPORT)[number]

/**
 * Les bornes du seau `ventes`, migration `originaux_des_imports` en base ou non : sans elle, celles du logo ; avec elle,
 * l'union, que la migration pose et que bornesStockage.test.ts confronte à son texte et à l'essai.
 */
export function bornesDuSeauDesVentes(originauxEnBase: boolean): { types: readonly TypeDuSeauDesVentes[]; taille: number } {
  return originauxEnBase
    ? { types: [...TYPES_DES_LOGOS_DE_FACTURE, ...TYPES_DES_ORIGINAUX_D_IMPORT], taille: TAILLE_MAX_ORIGINAL_D_IMPORT }
    : { types: TYPES_DES_LOGOS_DE_FACTURE, taille: TAILLE_MAX_LOGO_DE_FACTURE }
}

/**
 * Les types que chaque seau admet : la liste de la migration `bornes_du_stockage` — et, pour `ventes`, celle de la migration
 * `logo_des_factures`, ou d'`originaux_des_imports` quand elle est en base —, rien d'autre.
 */
export const TYPES_ADMIS = {
  pieces: ['application/pdf', 'image/jpeg', 'image/png', 'text/csv', 'text/plain'],
  packs: ['application/zip', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  'cabinet-logos': ['image/png', 'image/jpeg', 'image/webp'],
  ventes: bornesDuSeauDesVentes(ORIGINAUX_DES_IMPORTS_PREVUS).types,
} as const satisfies Record<Seau, readonly string[]>

/** La plus grande taille que chaque seau admet, en octets : la valeur de la migration. */
export const TAILLE_MAX = {
  pieces: TAILLE_MAX_PIECE,
  // Le plafond du plan gratuit (50 Mio) : un pack plus lourd ne passe déjà pas aujourd'hui — la borne ne fait que le
  // dire avant l'envoi, en français.
  packs: 50 * 1024 * 1024,
  // Un logo s'affiche dans la barre latérale de chaque page : 500 Kio suffisent, et le logo d'aujourd'hui en pèse 26.
  'cabinet-logos': 500 * 1024,
  ventes: bornesDuSeauDesVentes(ORIGINAUX_DES_IMPORTS_PREVUS).taille,
} as const satisfies Record<Seau, number>

export type TypeAdmis<S extends Seau> = (typeof TYPES_ADMIS)[S][number]

/** Un type admis, avec ou sans paramètres (`text/plain; charset=utf-8`) : le stockage ne juge que `type/sous-type`. */
export type TypeDuSeau<S extends Seau> = TypeAdmis<S> | `${TypeAdmis<S>};${string}` | `${TypeAdmis<S>}; ${string}`

/** Ce que `preparerPiece` peut envoyer — et `typeDUnePiece`, dans receive-email. */
export const TYPES_DES_FICHIERS_DE_PIECE = ['application/pdf', 'image/jpeg', 'image/png', 'text/csv'] as const

/** Ce que `preparerLogo` peut envoyer. */
export const TYPES_DES_LOGOS = TYPES_ADMIS['cabinet-logos']

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

/**
 * Ce qu'on dépose : sa borne, ce que c'est (pour dire le refus), ses formats. Un seau entier — ou, dans le seau `ventes`
 * qui en porte deux depuis A8d2a, le logo des factures et l'original d'une facture reprise, chacun sous SES bornes.
 */
interface Genre { borne: number; ceQueCest: string; formats: string }

const genreDuSeau = (seau: Seau): Genre => ({ borne: TAILLE_MAX[seau], ceQueCest: CE_QU_IL_CONTIENT[seau], formats: FORMATS_DITS[seau] })

const LOGO_DE_FACTURE: Genre = { borne: TAILLE_MAX_LOGO_DE_FACTURE, ceQueCest: CE_QU_IL_CONTIENT.ventes, formats: FORMATS_DITS.ventes }

const ORIGINAL_D_IMPORT: Genre = {
  borne: TAILLE_MAX_ORIGINAL_D_IMPORT,
  ceQueCest: 'un original de facture reprise',
  formats: 'un original de facture reprise se dépose en PDF (Factur-X), en XML (CII ou UBL) ou en CSV',
}

function refusDeTaille(genre: Genre, taille: number): RefusDuDepot {
  const dits = poidsFaceALaBorne([taille], genre.borne)
  return {
    raison: 'taille', taille,
    message: `il pèse ${dits.lus[0]}, au-delà des ${dits.borne} qu’${genre.ceQueCest} peut peser`,
  }
}

function refusDeFormat(genre: Genre, taille: number): RefusDuDepot {
  return { raison: 'format', taille, message: `format non pris en charge (${genre.formats})` }
}

/** Le refus de la taille, ou le corps réétiqueté : le dernier pas de chaque préparation. */
function borner(genre: Genre, contenu: Blob | Uint8Array<ArrayBuffer>, type: string): IssueDuDepot {
  const taille = contenu instanceof Uint8Array ? contenu.byteLength : contenu.size
  if (taille > genre.borne) return { refus: refusDeTaille(genre, taille) }
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
  if (type === null) return { refus: refusDeFormat(genreDuSeau('pieces'), fichier.size) }
  return borner(genreDuSeau('pieces'), fichier, type)
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
  if (type === null) return { refus: refusDeFormat(genreDuSeau('cabinet-logos'), fichier.size) }
  return borner(genreDuSeau('cabinet-logos'), fichier, type)
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
export function typeDUnLogoDeFacture(o: Uint8Array): (typeof TYPES_DES_LOGOS_DE_FACTURE)[number] | null {
  const type = typeDUnLogo(o)
  return type === 'image/png' || type === 'image/jpeg' ? type : null
}

/**
 * Le logo des factures d'un dossier (seau `ventes`, privé) : PNG ou JPEG, 500 Kio au plus — SES bornes, celles du seau ou
 * non (A8d2a) —, rendu dans un Blob RÉÉTIQUETÉ du type que dit sa signature — celui que le stockage jugera, et que le
 * chemin du logo dira (src/lib/logoDesFactures.ts).
 */
export async function preparerLogoDeFacture(fichier: Blob): Promise<IssueDuDepot> {
  const type = typeDUnLogoDeFacture(await premiersOctets(fichier))
  if (type === null) return { refus: refusDeFormat(LOGO_DE_FACTURE, fichier.size) }
  return borner(LOGO_DE_FACTURE, fichier, type)
}

// ── L'ORIGINAL D'UNE FACTURE REPRISE (A8d2a) ─────────────────────────────────────────────────────────────────────────
// Le fichier de l'ancien logiciel que l'import a lu (src/lib/lectureDesFacturesReprises.ts) : son FORMAT se décide au
// CONTENU, jamais au nom ni au type du navigateur — un PDF à sa signature, un XML à sa racine (une facture CII ou UBL) ;
// le CSV seul, qui n'a pas de signature, à son extension. Il se range sous un chemin dont la policy du seau exige la forme
// EXACTE (`ventes_depot_d_un_original`) : le dossier et le lot en UUID minuscules, le nom l'empreinte SHA-256 du fichier,
// l'extension tirée du type. Le nom d'origine, qui peut nommer un client, ne va pas au stockage.

/** La forme du chemin d'un original : celle de la policy `ventes_depot_d_un_original` (bornesStockage.test.ts les confronte). */
export const FORME_CHEMIN_D_UN_ORIGINAL =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/imports\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{64}\.(pdf|xml|csv)$/

/** La racine d'une facture XML que l'import lit : CII (`CrossIndustryInvoice`) ou UBL (`Invoice`, `CreditNote`). */
const RACINE_D_UNE_FACTURE_XML = /^<(?:[A-Za-z_][\w.-]*:)?(?:CrossIndustryInvoice|Invoice|CreditNote)[\s/>]/

/** Le début d'un XML après son prologue, ses commentaires et ses instructions : là où sa racine s'ouvre. */
function racineDuXml(texte: string): string {
  let reste = texte.trimStart()
  for (;;) {
    const avant = reste
    reste = reste.replace(/^<\?[\s\S]*?\?>/, '').replace(/^<!--[\s\S]*?-->/, '').trimStart()
    if (reste === avant) return reste
  }
}

/**
 * Le type sous lequel un original se dépose, ou null s'il n'en est pas un : `application/pdf` (sa signature),
 * `text/plain` (un XML dont la racine est une facture CII ou UBL — jamais un type XML, qui peut porter du script),
 * `text/csv` (l'extension, le CSV n'ayant pas de signature, et un contenu qui n'est ni un PDF ni un balisage).
 */
export function typeDUnOriginal(nom: string, debut: Uint8Array): (typeof TYPES_DES_ORIGINAUX_D_IMPORT)[number] | null {
  if (debut[0] === 0x25 && debut[1] === 0x50 && debut[2] === 0x44 && debut[3] === 0x46) return 'application/pdf'
  // Les balises sont en ASCII : lues octet pour octet, après la marque d'ordre UTF-8 (EF BB BF) s'il y en a une.
  const bom = debut[0] === 0xef && debut[1] === 0xbb && debut[2] === 0xbf ? 3 : 0
  const racine = racineDuXml(new TextDecoder('latin1').decode(debut.subarray(bom)))
  if (racine.startsWith('<')) return RACINE_D_UNE_FACTURE_XML.test(racine) ? 'text/plain' : null
  return /\.csv$/i.test(nom) ? 'text/csv' : null
}

/** L'extension du chemin d'un original, tirée de son type — jamais du nom que portait le fichier. */
export function extensionDeLOriginal(type: (typeof TYPES_DES_ORIGINAUX_D_IMPORT)[number]): 'pdf' | 'xml' | 'csv' {
  return type === 'application/pdf' ? 'pdf' : type === 'text/plain' ? 'xml' : 'csv'
}

/** Le chemin d'un original : `<dossier>/imports/<lot>/<empreinte>.<extension>`, ou null si l'un d'eux n'a pas sa forme. */
export function cheminDUnOriginal(dossierId: string, lotId: string, sha256: string, type: (typeof TYPES_DES_ORIGINAUX_D_IMPORT)[number]): string | null {
  const chemin = `${dossierId}/imports/${lotId}/${sha256}.${extensionDeLOriginal(type)}`
  return FORME_CHEMIN_D_UN_ORIGINAL.test(chemin) ? chemin : null
}

/**
 * L'original d'une facture reprise (seau `ventes`, privé, A8d2a) : PDF, XML ou CSV, 20 Mio au plus, rendu dans un Blob
 * RÉÉTIQUETÉ du type que dit son contenu. Les quatre premiers Kio suffisent à le reconnaître (le prologue d'un XML, ses
 * commentaires, puis sa racine). Aucun écran ne l'appelle encore : le dépôt vient avec l'écran d'import (A8d2), après la
 * migration `originaux_des_imports` (`ORIGINAUX_DES_IMPORTS_PREVUS`).
 */
export async function preparerOriginalDImport(fichier: File): Promise<IssueDuDepot> {
  const type = typeDUnOriginal(fichier.name, new Uint8Array(await fichier.slice(0, 4096).arrayBuffer()))
  if (type === null) return { refus: refusDeFormat(ORIGINAL_D_IMPORT, fichier.size) }
  return borner(ORIGINAL_D_IMPORT, fichier, type)
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
  if (!(TYPES_ADMIS[seau] as readonly string[]).includes(typeSansParametres(type))) return { refus: refusDeFormat(genreDuSeau(seau), taille) }
  return borner(genreDuSeau(seau), contenu, type)
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
