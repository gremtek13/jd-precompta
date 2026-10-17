import { TAILLE_MAX, TYPES_ADMIS, preparerLogoDeFacture, type DepotPret, type RefusDuDepot } from './bornesStockage'
import type { ParametresFacturation } from './types'

// LE LOGO DES FACTURES D'UN DOSSIER (espace client, étape A5c1 ; conception : HISTORIQUE.md, « L'ESPACE CLIENT, LOGICIEL DE
// GESTION DU CLIENT : LE PREMIER GROUPE, LA PARITÉ, ET AU-DELÀ », §A.5.2, « Le logo »). Un module PUR — il ne lit rien en
// base, n'appelle personne, ne lit pas l'horloge — : ce que l'écran du logo (étape A5c2) préparera avant de déposer, et ce
// que `enregistrer_parametres_facturation` refuserait du logo, dans SON ordre et sous SES mots.
//
// CE QU'EST LE LOGO. Une image PNG ou JPEG de 500 Kio au plus, jamais un SVG (il porte du script), rangée dans le seau
// PRIVÉ `ventes` sous `<dossier>/logos/<empreinte>.<png|jpg>` : l'empreinte est le SHA-256 du fichier tel qu'il part, et le
// nom du fichier. Une version des paramètres de facturation le désigne par son chemin et son empreinte ; une version ne
// s'écrase jamais — un autre logo est un autre fichier —, et une facture gardera celui qu'elle a imprimé (étape A7). Le
// client qui porte « Ventes » et le cabinet du dossier le lisent et le déposent ; seul le chef du cabinet supprime un
// fichier du seau, avec le dossier (src/lib/suppressionDossier.ts).

// ── Est-ce en base ? ──────────────────────────────────────────────────────────────────────────────────────────────────
// La migration `logo_des_factures` OUVRE au client qui porte la case « Ventes » la lecture et le dépôt d'un seau du
// stockage : présentée au cabinet, elle a été appliquée sur son accord (A5C-Q1), et l'export (supabase/schema) la porte. Ce
// drapeau est donc levé : le module juge le logo au huitième rang, comme la base ; la suppression d'un dossier vide aussi le
// seau des ventes ; le manifeste d'une sauvegarde dit le logo hors de son périmètre ; l'onglet Accès dit ce que la case
// « Ventes » ouvre de plus ; le formulaire des paramètres reprend le logo de la version qu'il remplace.
// logoDesFactures.test.ts confronte ce drapeau à l'export, et les refus ci-dessous à l'essai
// supabase/essais/logoDesFactures.sql et au texte même de la fonction. Un retour arrière de la migration ne viendrait
// qu'APRÈS le drapeau rebaissé en ligne : sinon chaque suppression de dossier dirait un inventaire incomplet (le seau
// absent), et le formulaire enverrait un logo que la fonction d'A5a refuserait comme un champ inconnu.
export const LOGO_DES_FACTURES_EXPORTE: boolean = true

// ── Le chemin et l'empreinte ─────────────────────────────────────────────────────────────────────────────────────────
/** Le seau du logo, et le dossier où il se range sous chaque dossier client. */
export const SEAU_DU_LOGO = 'ventes' as const
export const DOSSIER_DES_LOGOS = 'logos'

// Les formes que la migration exige, à la lettre : l'empreinte en minuscules ; le chemin, l'identifiant du dossier en
// minuscules (celui que rend la base), `logos/`, l'empreinte et l'extension du type.
export const FORME_EMPREINTE_DU_LOGO = /^[0-9a-f]{64}$/
export const FORME_CHEMIN_DU_LOGO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/logos\/[0-9a-f]{64}\.(png|jpg)$/

export type TypeDuLogo = (typeof TYPES_ADMIS)['ventes'][number]

/** L'extension du chemin d'un logo, tirée de son type — jamais du nom que portait le fichier. */
export function extensionDuLogoDeFacture(type: TypeDuLogo): 'png' | 'jpg' {
  return type === 'image/jpeg' ? 'jpg' : 'png'
}

/** Le type que dit le nom d'un chemin de logo : `.png` ou `.jpg` ; null pour un autre nom. */
export function typeDuNomDuLogo(chemin: string): TypeDuLogo | null {
  return chemin.endsWith('.png') ? 'image/png' : chemin.endsWith('.jpg') ? 'image/jpeg' : null
}

/** Le chemin d'un logo : `<dossier>/logos/<empreinte>.<png|jpg>`. */
export function cheminDuLogo(dossierId: string, empreinte: string, type: TypeDuLogo): string {
  return `${dossierId}/${DOSSIER_DES_LOGOS}/${empreinte}.${extensionDuLogoDeFacture(type)}`
}

/**
 * Le SHA-256 d'un fichier, en soixante-quatre chiffres hexadécimaux minuscules (WebCrypto). Le jumeau de `hashFichier`
 * (src/lib/extraction.ts), écrit ici parce que ce module n'importe pas le client de la base ; le test confronte l'un et
 * l'autre au calcul de Node, une référence extérieure aux deux.
 */
export async function empreinteSha256(corps: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await corps.arrayBuffer())
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

// ── Le fichier d'un logo, relu dans le seau ─────────────────────────────────────────────────────────────────────────────
/**
 * Ce que la lecture du fichier qu'une version désigne a rendu (src/lib/logoDesFacturesLecture.ts) : le fichier, dont
 * l'empreinte recalculée est celle que la version porte ; ou la raison pour laquelle l'écran n'en montre rien. « Autre
 * empreinte » n'est jamais une image à montrer : ce n'est pas le fichier que la version désigne.
 */
export type LogoLu =
  | { etat: 'verifie'; corps: Blob; type: TypeDuLogo; taille: number }
  | { etat: 'absent' }
  | { etat: 'refuse'; motif: string }
  | { etat: 'illisible' }
  | { etat: 'autre_empreinte' }

// ── Un fichier déjà là ───────────────────────────────────────────────────────────────────────────────────────────────
// Le nom d'un logo est son empreinte : le reposer, c'est viser un fichier qui existe peut-être déjà, et le seau n'admet
// aucune mise à jour — le second dépôt bute sur l'unicité (seau, nom). Le stockage le dit d'une façon que seul le SDK
// installé (storage-js 2.112.4, `handleError`) permet de lire : l'erreur est une `StorageApiError` dont `status` est celui
// de la réponse HTTP (409, ou 400 pour les versions du service qui rendent le doublon ainsi) et `statusCode` celui du CORPS
// (`{ statusCode: '409', error: 'Duplicate', message: 'The resource already exists' }`) ; un corps sans `message` fait de son
// `error` le message. `code` n'est là que si le corps le porte. bornesStockageClient.test.ts joue chaque forme contre ce SDK.
const CODES_D_UN_DOUBLON: readonly string[] = ['Duplicate', 'ResourceAlreadyExists', 'KeyAlreadyExists']

/**
 * L'erreur d'un dépôt dit-elle « ce nom existe déjà » ? Lu sur ce que la valeur PORTE (`__isStorageError`, posé par le
 * constructeur du SDK), jamais sur sa classe — comme `messageErreur` —, et jamais sur la phrase anglaise du service seule.
 * Un autre refus (413, 415, 401…), ou un objet qui ne vient pas du stockage, n'est pas un doublon.
 */
export function estUnDoublonDuStockage(erreur: unknown): boolean {
  if (erreur === null || typeof erreur !== 'object') return false
  const e = erreur as { __isStorageError?: unknown; status?: unknown; statusCode?: unknown; code?: unknown; message?: unknown }
  if (e.__isStorageError !== true) return false
  return e.status === 409 || e.statusCode === '409' || e.statusCode === 409
    || (typeof e.code === 'string' && CODES_D_UN_DOUBLON.includes(e.code)) || e.message === 'Duplicate'
}

/** Le logo prêt à déposer : le corps réétiqueté, son type et sa taille, son empreinte et son chemin. */
export interface LogoPret extends DepotPret {
  type: TypeDuLogo
  empreinte: string
  chemin: string
}

/**
 * Ce que l'écran du logo dépose (étape A5c2a, src/lib/logoDesFacturesEcriture.ts) : le fichier jugé et réétiqueté par `preparerLogoDeFacture` (le type à sa signature,
 * la borne du seau), puis son empreinte, calculée sur le corps TEL QU'IL PART, et son chemin. Le refus du seau sinon,
 * dit comme celui d'un dépôt.
 */
export async function logoPret(dossierId: string, fichier: Blob): Promise<LogoPret | { refus: RefusDuDepot }> {
  const issue = await preparerLogoDeFacture(fichier)
  if ('refus' in issue) return issue
  const type = issue.type as TypeDuLogo
  const empreinte = await empreinteSha256(issue.corps)
  return { ...issue, type, empreinte, chemin: cheminDuLogo(dossierId, empreinte, type) }
}

// ── Les refus de la fonction sur le logo (le huitième rang) ──────────────────────────────────────────────────────────
// La liste des `raise exception` du huitième rang d'`enregistrer_parametres_facturation`, dans l'ordre de son texte, avec
// leur code : le chemin et l'empreinte ensemble ; l'empreinte, puis le chemin, à leur forme ; le chemin dans CE dossier ;
// le nom, son empreinte ; puis — pour un logo qui n'est pas celui de la version remplacée — le fichier dans le seau, son
// type, son poids, tels que le catalogue du stockage les dit. src/lib/parametresFacturation.ts les place après les sept
// rangs d'A5a ; logoDesFactures.test.ts les confronte à l'essai, puis au texte exporté de la fonction.
export const REFUS_DU_LOGO = [
  { cle: 'logo_ensemble', rang: 8, code: '22023', modele: 'Le logo se donne par son chemin et son empreinte, ensemble.' },
  {
    cle: 'logo_empreinte', rang: 8, code: '22023',
    modele: "L'empreinte du logo est son SHA-256 : soixante-quatre chiffres hexadécimaux, en minuscules.",
  },
  {
    cle: 'logo_chemin', rang: 8, code: '22023',
    modele: "Le chemin du logo s'écrit « dossier/logos/empreinte.png » ou « .jpg » : l'identifiant du dossier, puis l'empreinte "
      + 'du fichier, en minuscules.',
  },
  { cle: 'logo_autre_dossier', rang: 8, code: '22023', modele: "Le logo est un fichier d'un autre dossier." },
  { cle: 'logo_nom', rang: 8, code: '22023', modele: "Le nom du fichier du logo n'est pas son empreinte." },
  { cle: 'logo_absent', rang: 8, code: '22023', modele: "Le logo n'est pas dans le seau des ventes du dossier : le déposer d'abord." },
  { cle: 'logo_type', rang: 8, code: '22023', modele: "Le fichier du logo n'est pas une image PNG ou JPEG du type que dit son nom." },
  { cle: 'logo_poids', rang: 8, code: '22023', modele: 'Le fichier du logo pèse plus que les % octets que le seau des ventes admet.' },
] as const

export type CleRefusDuLogo = (typeof REFUS_DU_LOGO)[number]['cle']

/** Les deux champs d'une version qui portent le logo, dans l'ordre où la fonction les admet, après ceux d'A5a. */
export const CHAMPS_DU_LOGO = ['logo_chemin', 'logo_sha256'] as const

/**
 * Un fichier du seau des ventes, tel que l'écran le connaît — celui qu'il vient de déposer : son chemin, son type et son
 * poids tels que le stockage les range (`metadata.mimetype`, `metadata.size`) ; nuls quand on ne les sait pas.
 */
export interface FichierDuSeau {
  chemin: string
  type: string | null
  taille: number | null
}

/** Ce qu'il faut de la version remplacée : son logo, s'il a été lu. */
export type LogoDeLaVersionRemplacee = Pick<ParametresFacturation, 'logo_chemin' | 'logo_sha256'>

const absent = (v: unknown) => v === undefined || v === null
// Le type rangé, comme la fonction le lit : sans ses paramètres (`;`), sans les ESPACES de ses bords (`btrim` n'ôte que
// l'espace), en minuscules.
const typeRange = (type: string) => type.split(';')[0].replace(/^ +| +$/g, '').toLowerCase()

/**
 * Le premier refus du huitième rang sur la saisie TELLE QUE LA BASE LA REÇOIT (`recue`, après l'aller-retour JSON), ou
 * null : `remplacee` est la version remplacée (nulle pour une première) ; `fichiers`, ceux du seau que l'appelant connaît.
 * Un logo inchangé — le chemin et l'empreinte de la version remplacée — ne se rejuge pas : la base ne relit pas son
 * fichier. Rend la clé et les valeurs du modèle (la borne du seau pour le poids).
 */
export function refusDuLogo(
  dossierId: string,
  remplacee: LogoDeLaVersionRemplacee | null,
  recue: Record<string, unknown>,
  fichiers: readonly FichierDuSeau[],
): { cle: CleRefusDuLogo; valeurs: string[] } | null {
  const refus = (cle: CleRefusDuLogo, ...valeurs: string[]) => ({ cle, valeurs })
  const chemin = recue.logo_chemin
  const empreinte = recue.logo_sha256
  if (absent(chemin) && absent(empreinte)) return null
  if (absent(chemin) || absent(empreinte)) return refus('logo_ensemble')
  if (typeof empreinte !== 'string' || !FORME_EMPREINTE_DU_LOGO.test(empreinte)) return refus('logo_empreinte')
  if (typeof chemin !== 'string' || !FORME_CHEMIN_DU_LOGO.test(chemin)) return refus('logo_chemin')
  const [dossier, , nom] = chemin.split('/')
  if (dossier !== dossierId) return refus('logo_autre_dossier')
  if (nom.split('.')[0] !== empreinte) return refus('logo_nom')
  if (remplacee !== null && chemin === (remplacee.logo_chemin ?? null) && empreinte === (remplacee.logo_sha256 ?? null)) return null
  const fichier = fichiers.find((f) => f.chemin === chemin)
  if (!fichier) return refus('logo_absent')
  const type = fichier.type === null ? null : typeRange(fichier.type)
  if (type === null || type !== typeDuNomDuLogo(chemin) || !(TYPES_ADMIS.ventes as readonly string[]).includes(type)) return refus('logo_type')
  const borne = TAILLE_MAX.ventes
  if (fichier.taille === null || !Number.isSafeInteger(fichier.taille) || fichier.taille < 0 || fichier.taille > borne) {
    return refus('logo_poids', String(borne))
  }
  return null
}

// ── Ce qu'une version dit de son logo ────────────────────────────────────────────────────────────────────────────────
/** Le logo d'une version : non lu (les colonnes absentes de la lecture), aucun, ou le fichier qu'elle désigne. */
export type LogoDeLaVersion = 'non lu' | null | { chemin: string; empreinte: string; type: TypeDuLogo }

/**
 * Le logo d'une version, sans rien deviner : « non lu » quand la lecture n'a pas rendu ses colonnes (la migration n'est pas
 * en base) — une colonne absente n'est pas un logo retiré ; null sans logo ; sinon son chemin, son empreinte et le type que
 * dit son nom. Un chemin qui n'a pas la forme d'un logo se dit « non lu » : la base ne le range pas, et rien n'en est dit.
 */
export function logoDeLaVersion(v: LogoDeLaVersionRemplacee): LogoDeLaVersion {
  if (v.logo_chemin === undefined || v.logo_sha256 === undefined) return 'non lu'
  if (v.logo_chemin === null && v.logo_sha256 === null) return null
  const type = v.logo_chemin === null ? null : typeDuNomDuLogo(v.logo_chemin)
  if (v.logo_chemin === null || v.logo_sha256 === null || type === null || !FORME_CHEMIN_DU_LOGO.test(v.logo_chemin)) return 'non lu'
  return { chemin: v.logo_chemin, empreinte: v.logo_sha256, type }
}

/**
 * Ce qu'une version a fait du logo de celle qu'elle remplace : posé, changé, retiré, ou rien ; null quand l'une des deux
 * n'a pas son logo lu (rien ne s'en dit). L'historique des paramètres le nomme (src/lib/parametresFacturationVue.ts).
 */
export function changementDuLogo(v: LogoDeLaVersionRemplacee, remplacee: LogoDeLaVersionRemplacee): 'pose' | 'change' | 'retire' | 'aucun' | null {
  const apres = logoDeLaVersion(v)
  const avant = logoDeLaVersion(remplacee)
  if (apres === 'non lu' || avant === 'non lu') return null
  if (avant === null) return apres === null ? 'aucun' : 'pose'
  if (apres === null) return 'retire'
  return apres.chemin === avant.chemin && apres.empreinte === avant.empreinte ? 'aucun' : 'change'
}

/** Ce qu'une saisie envoie du logo : son chemin et son empreinte, ensemble, ou rien (une version sans logo). */
export interface LogoEnvoye {
  logo_chemin?: string
  logo_sha256?: string
}

/**
 * Le logo qu'une saisie REPREND de la version qu'elle remplace : la saisie part EN ENTIER, et une clé absente vaut « aucun
 * logo » — une version qui ne le porte pas le RETIRE. Le formulaire des paramètres (étape A5c2) le joint à ce qu'il envoie
 * pour garder le logo ; rien quand la migration n'est pas en base, que la version n'a pas de logo ou qu'il n'a pas été lu.
 */
export function logoRepris(remplacee: LogoDeLaVersionRemplacee | null, exporte: boolean): LogoEnvoye {
  if (!exporte || remplacee === null) return {}
  const logo = logoDeLaVersion(remplacee)
  return logo === null || logo === 'non lu' ? {} : { logo_chemin: logo.chemin, logo_sha256: logo.empreinte }
}
