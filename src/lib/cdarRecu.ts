import { sirenDe } from './factureCii'

// UN STATUT DU CYCLE DE VIE D'UNE FACTURE ÉMISE, REÇU DE LA PLATEFORME DU CLIENT (ligne 28.5 de la feuille de route,
// étape d7). L'acheteur refuse une facture (210), une plateforme la rejette (213), il l'approuve ou la conteste (205 à
// 208), dit l'avoir payée (211) ; la plateforme de l'administration rejette un statut (601). Ces messages arrivent au
// vendeur par la plateforme qui a reçu sa facture, dans la syntaxe CDAR de l'UN/CEFACT (CrossDomainAcknowledgementAndResponse,
// D22B) : banqup les type `CustomerInvoiceLC` (« a lifecycle (CDAR) related to a customer invoice », description OpenAPI
// publique de son connecteur « afnor », v1.15.0). Ce module LIT un tel message et dit ce qu'il porte, puis s'il se
// rattache à une facture du dossier. La fonction plateforme-agreee le recopie pour lire ce qu'elle télécharge.
//
// SES SOURCES SONT PUBLIQUES : les spécifications externes de la DGFiP v3.2 — le dossier général (§ 3.6.4, tableau 8 :
// les statuts d'une facture ; § 3.6.8, tableau 10 : le 601), l'annexe 2 v2.3 (onglet « CDV FE - CI ARM » : les chemins
// MDT-…) et l'annexe 7 v1.9 (les règles G et P citées élément par élément). Les normes AFNOR XP Z12-012 et XP Z12-013 ne
// s'utilisent pas (décision du cabinet du 07/10/2026).
//
// SANS JAMAIS DEVINER : un message qu'on ne sait pas lire, ou qui dit deux choses, est dit tel (`refus`) ; une donnée
// DÉCISIVE (l'objet, le code, le numéro, le SIREN, l'année, le type) mal formée rend le message illisible ; une donnée
// INFORMATIVE mal formée (l'horodatage, le rôle, les motifs, le commentaire, les montants) est écartée seule, et
// l'avertissement le dit — un refus dont l'horodatage est faux reste un refus.
//
// LE MODULE EST PUR : il ne lit rien en base, n'appelle personne, ne lit pas l'horloge. Il n'emploie pas DOMParser,
// qu'une Edge Function (Deno) n'a pas : son analyseur XML est le sien, strict — un document mal formé, une DTD, une
// entité inconnue, un préfixe non déclaré, plusieurs racines le font refuser — et résout les espaces de noms : un
// message dont les préfixes ne sont pas rsm, ram, udt et qdt se lit de même.

// ── DÉBUT COPIE cdarRecu ─────────────────────────────────────────────────────────────────────────────────────────────
// Ce bloc est recopié AU CARACTÈRE PRÈS dans plateforme-agreee, après le bloc factureCii, dont il emprunte `sirenDe`, et
// rien d'autre. Ses noms portent la marque « Recu » : la fonction a ses `el`, `NS`, `echapper`, et recevra à l'étape d6
// le bloc cdarEncaissee. cdarRecuCopie.test.ts compare la copie à ce bloc, la compile et l'exécute seule.

// Les statuts d'une FACTURE (dossier général, § 3.6.4, tableau 8) : 200, 210, 212 et 213 obligatoires, les autres
// facultatifs. Un autre code, pour une facture, n'est pas lu : aucune source publique ne le définit.
export const CODES_STATUT_RECU = [
  '200', '201', '202', '203', '204', '205', '206', '207', '208', '209', '210', '211', '212', '213',
] as const
export type CodeStatutRecu = (typeof CODES_STATUT_RECU)[number]

// Sur quoi porte un message : une facture, un statut (le « CDV de CDV », dont le 601), un flux, ou autre chose (données
// réglementaires, e-reporting, annuaire).
export type ObjetStatutRecu = 'facture' | 'statut' | 'flux' | 'autre'

// MDT-97, le code type de référence (G7.14), et l'objet qu'il désigne.
const REFERENCES_STATUT_RECU: Record<string, ObjetStatutRecu> = {
  'urn.cpro.gouv.fr:1p0:CDV:einvoicingF2': 'facture',
  'urn.cpro.gouv.fr:1p0:CDV:messageCDV': 'statut',
  'urn.cpro.gouv.fr:1p0:CDV:flux': 'flux',
  'urn.cpro.gouv.fr:1p0:CDV:einvoicingF1': 'autre',
  'urn.cpro.gouv.fr:1p0:CDV:ereportingF10': 'autre',
  'urn.cpro.gouv.fr:1p0:CDV:annuaire': 'autre',
}

// MDT-91, le code type de l'objet (G7.15) : 303 un flux, 304 une transmission ou des données réglementaires, 305 un
// statut, 306 l'annuaire ; pour une facture, le type de la facture (G1.01).
export const TYPES_FACTURE_STATUT_RECU = [
  '380', '389', '393', '501', '386', '500', '384', '471', '472', '473', '261', '381', '396', '502', '503',
] as const
const TYPES_OBJET_STATUT_RECU: Record<string, ObjetStatutRecu> = { 303: 'flux', 304: 'autre', 305: 'statut', 306: 'autre' }

// Les deux seuls types que l'application émet : une facture commerciale (380), un avoir (381).
const TYPE_EMIS_STATUT_RECU = { facture: '380', avoir: '381' } as const

// Les espaces de noms du message (annexe 2 ; schéma CDAR D22B).
const NS_RSM_RECU = 'urn:un:unece:uncefact:data:standard:CrossDomainAcknowledgementAndResponse:100'
const NS_RAM_RECU = 'urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100'
const NS_UDT_RECU = 'urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100'
const NS_QDT_RECU = 'urn:un:unece:uncefact:data:standard:QualifiedDataType:100'
const NS_XML_RECU = 'http://www.w3.org/XML/1998/namespace'

// Ce que l'analyseur accepte au plus : un statut tient en quelques kilo-octets.
const MAX_CARACTERES_RECU = 1_000_000
const MAX_PROFONDEUR_RECU = 64
const MAX_ELEMENTS_RECU = 20_000
// Les longueurs que la base garde (migration cycle_de_vie_des_factures_emises).
export const LONGUEUR_MAX_TEXTE_RECU = 2000
const LONGUEUR_MAX_IDENTIFIANT_RECU = 200

// ── L'analyseur ──────────────────────────────────────────────────────────────────────────────────────────────────────

export interface ElementRecu {
  /** L'espace de noms résolu ; vide quand l'élément n'en a pas. */
  ns: string
  nom: string
  attributs: { ns: string; nom: string; valeur: string }[]
  enfants: ElementRecu[]
  /** Les données textuelles DIRECTES de l'élément, sections CDATA comprises, entités décodées. */
  texte: string
}

export type AnalyseXmlRecu = { racine: ElementRecu } | { refus: string }

const NOM_XML_RECU = /[A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?/y
const BLANCS_RECU = /[ \t\n]*/y
// Un caractère que XML 1.0 n'admet pas (§ 2.2), une fois les fins de ligne ramenées à « \n » (§ 2.11).
const INTERDIT_RECU = /[^\t\n -\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/u
const DECLARATION_RECU =
  /^<\?xml[ \t\n]+version[ \t\n]*=[ \t\n]*(["'])1\.[0-9]+\1(?:[ \t\n]+encoding[ \t\n]*=[ \t\n]*(["'])([A-Za-z][A-Za-z0-9._-]*)\2)?(?:[ \t\n]+standalone[ \t\n]*=[ \t\n]*(["'])(?:yes|no)\4)?[ \t\n]*\?>/

function caractereAdmisRecu(code: number): boolean {
  return code === 0x9 || code === 0xa || code === 0xd || (code >= 0x20 && code <= 0xd7ff)
    || (code >= 0xe000 && code <= 0xfffd) || (code >= 0x10000 && code <= 0x10ffff)
}

const ENTITES_RECU: Record<string, string> = { lt: '<', gt: '>', amp: '&', apos: "'", quot: '"' }

/** Les références d'entités d'un texte décodées : les cinq prédéfinies et les références numériques, rien d'autre. */
function decoderEntitesRecu(texte: string): string | null {
  if (!texte.includes('&')) return texte
  let sortie = ''
  let i = 0
  for (;;) {
    const amp = texte.indexOf('&', i)
    if (amp < 0) return sortie + texte.slice(i)
    sortie += texte.slice(i, amp)
    const fin = texte.indexOf(';', amp + 1)
    if (fin < 0) return null
    const nom = texte.slice(amp + 1, fin)
    if (Object.hasOwn(ENTITES_RECU, nom)) sortie += ENTITES_RECU[nom]
    else {
      const m = /^#(?:x([0-9A-Fa-f]{1,6})|([0-9]{1,7}))$/.exec(nom)
      if (!m) return null
      const code = m[1] !== undefined ? parseInt(m[1], 16) : parseInt(m[2], 10)
      if (!caractereAdmisRecu(code)) return null
      sortie += String.fromCodePoint(code)
    }
    i = fin + 1
  }
}

/**
 * Un document XML analysé, ou la raison de son refus. Strict : déclaration en tête et en UTF-8 seulement, aucune DTD ni
 * déclaration (`<!…`), une seule racine, des balises appariées, des attributs uniques, des entités prédéfinies ou
 * numériques, des préfixes déclarés. La profondeur, le nombre d'éléments et la longueur sont bornés.
 */
export function analyserXmlRecu(source: string): AnalyseXmlRecu {
  if (source.length > MAX_CARACTERES_RECU) return { refus: 'le message dépasse la taille d’un statut' }
  let s = source.replace(/\r\n?/g, '\n')
  if (s.startsWith('\uFEFF')) s = s.slice(1)
  if (INTERDIT_RECU.test(s)) return { refus: 'le message porte un caractère que XML n’admet pas' }
  let i = 0
  if (s.startsWith('<?xml') && /[ \t\n?]/.test(s[5] ?? '')) {
    const m = DECLARATION_RECU.exec(s)
    if (!m) return { refus: 'la déclaration XML est illisible' }
    if (m[3] !== undefined && m[3].toLowerCase() !== 'utf-8') return { refus: `le message est encodé en ${m[3]}, et seul l’UTF-8 se lit` }
    i = m[0].length
  }
  const pile: { el: ElementRecu; qualifie: string; portee: Map<string, string> }[] = []
  let racine: ElementRecu | null = null
  let elements = 0
  const lireNom = (position: number): string | null => {
    NOM_XML_RECU.lastIndex = position
    return NOM_XML_RECU.exec(s)?.[0] ?? null
  }
  const sauterBlancs = (position: number): number => {
    BLANCS_RECU.lastIndex = position
    BLANCS_RECU.exec(s)
    return BLANCS_RECU.lastIndex
  }
  while (i < s.length) {
    if (s.startsWith('<!--', i)) {
      const fin = s.indexOf('-->', i + 4)
      if (fin < 0 || s.slice(i + 4, fin).includes('--') || s[fin - 1] === '-') return { refus: 'un commentaire est mal formé' }
      i = fin + 3
      continue
    }
    if (s.startsWith('<![CDATA[', i)) {
      const fin = s.indexOf(']]>', i + 9)
      if (fin < 0 || pile.length === 0) return { refus: 'une section CDATA est mal placée' }
      pile[pile.length - 1].el.texte += s.slice(i + 9, fin)
      i = fin + 3
      continue
    }
    if (s.startsWith('<!', i)) return { refus: 'le message déclare une DTD ou une entité, qu’aucun statut n’emploie' }
    if (s.startsWith('<?', i)) {
      const fin = s.indexOf('?>', i + 2)
      const cible = lireNom(i + 2)
      if (fin < 0 || cible === null || cible.toLowerCase() === 'xml') return { refus: 'une instruction de traitement est mal formée' }
      i = fin + 2
      continue
    }
    if (s.startsWith('</', i)) {
      const nom = lireNom(i + 2)
      const apres = nom === null ? -1 : sauterBlancs(i + 2 + nom.length)
      if (nom === null || s[apres] !== '>' || pile.length === 0 || pile[pile.length - 1].qualifie !== nom) {
        return { refus: 'une balise fermante ne ferme pas la balise ouverte' }
      }
      pile.pop()
      i = apres + 1
      continue
    }
    if (s[i] === '<') {
      if (racine !== null && pile.length === 0) return { refus: 'le message a plusieurs racines' }
      if (pile.length >= MAX_PROFONDEUR_RECU || ++elements > MAX_ELEMENTS_RECU) return { refus: 'le message est trop profond ou trop long' }
      const qualifie = lireNom(i + 1)
      if (qualifie === null) return { refus: 'un nom de balise est illisible' }
      let p = i + 1 + qualifie.length
      const bruts: { qualifie: string; valeur: string }[] = []
      let fermee = false
      for (;;) {
        const apres = sauterBlancs(p)
        if (s.startsWith('/>', apres)) { fermee = true; p = apres + 2; break }
        if (s[apres] === '>') { p = apres + 1; break }
        if (apres === p) return { refus: 'les attributs d’une balise sont mal séparés' }
        const nom = lireNom(apres)
        if (nom === null) return { refus: 'un attribut est illisible' }
        const egal = sauterBlancs(apres + nom.length)
        if (s[egal] !== '=') return { refus: 'un attribut n’a pas de valeur' }
        const ouverture = sauterBlancs(egal + 1)
        const guillemet = s[ouverture]
        if (guillemet !== '"' && guillemet !== "'") return { refus: 'une valeur d’attribut n’est pas entre guillemets' }
        const fin = s.indexOf(guillemet, ouverture + 1)
        if (fin < 0) return { refus: 'une valeur d’attribut n’est pas refermée' }
        const brute = s.slice(ouverture + 1, fin)
        const valeur = brute.includes('<') ? null : decoderEntitesRecu(brute)
        if (valeur === null) return { refus: 'une valeur d’attribut est mal formée' }
        if (bruts.some((a) => a.qualifie === nom)) return { refus: 'un attribut est répété' }
        // La normalisation d'une valeur d'attribut (§ 3.3.3) : chaque blanc devient une espace.
        bruts.push({ qualifie: nom, valeur: valeur.replace(/[\t\n]/g, ' ') })
        p = fin + 1
      }
      const parent = pile.length > 0 ? pile[pile.length - 1].portee : new Map<string, string>([['xml', NS_XML_RECU]])
      let portee = parent
      for (const a of bruts) {
        if (a.qualifie !== 'xmlns' && !a.qualifie.startsWith('xmlns:')) continue
        if (portee === parent) portee = new Map(parent)
        const prefixe = a.qualifie === 'xmlns' ? '' : a.qualifie.slice(6)
        // Namespaces in XML 1.0, § 3 : « xmlns » ne se déclare pas, « xml » n'a qu'un espace et nul autre ne le prend,
        // un préfixe ne se « dé-déclare » pas ; l'espace par défaut, lui, peut revenir à aucun.
        if (prefixe === 'xmlns' || (prefixe !== '' && a.valeur === '') || (prefixe === 'xml') !== (a.valeur === NS_XML_RECU)) {
          return { refus: 'un espace de noms est mal déclaré' }
        }
        portee.set(prefixe, a.valeur)
      }
      const resoudre = (nomQualifie: string, defaut: boolean): { ns: string; nom: string } | null => {
        const deux = nomQualifie.indexOf(':')
        if (deux < 0) return { ns: defaut ? (portee.get('') ?? '') : '', nom: nomQualifie }
        const ns = portee.get(nomQualifie.slice(0, deux))
        return ns === undefined || ns === '' ? null : { ns, nom: nomQualifie.slice(deux + 1) }
      }
      const nomResolu = resoudre(qualifie, true)
      if (nomResolu === null || qualifie.startsWith('xmlns:') || qualifie.startsWith('xml:')) return { refus: 'une balise emploie un préfixe non déclaré' }
      const attributs: ElementRecu['attributs'] = []
      for (const a of bruts) {
        if (a.qualifie === 'xmlns' || a.qualifie.startsWith('xmlns:')) continue
        const r = resoudre(a.qualifie, false)
        if (r === null) return { refus: 'un attribut emploie un préfixe non déclaré' }
        if (attributs.some((x) => x.ns === r.ns && x.nom === r.nom)) return { refus: 'un attribut est répété' }
        attributs.push({ ...r, valeur: a.valeur })
      }
      const el: ElementRecu = { ...nomResolu, attributs, enfants: [], texte: '' }
      if (pile.length > 0) pile[pile.length - 1].el.enfants.push(el)
      else racine = el
      if (!fermee) pile.push({ el, qualifie, portee })
      i = p
      continue
    }
    const suivant = s.indexOf('<', i)
    const fin = suivant < 0 ? s.length : suivant
    const texte = s.slice(i, fin)
    if (pile.length === 0) {
      if (!/^[ \t\n]*$/.test(texte)) return { refus: 'du texte se trouve hors de la racine' }
    } else {
      const decode = texte.includes(']]>') ? null : decoderEntitesRecu(texte)
      if (decode === null) return { refus: 'un texte porte une entité inconnue ou mal formée' }
      pile[pile.length - 1].el.texte += decode
    }
    i = fin
  }
  if (racine === null || pile.length > 0) return { refus: 'le message est incomplet' }
  return { racine }
}

// ── La lecture du message ────────────────────────────────────────────────────────────────────────────────────────────

/** Un montant d'une caractéristique (MDG-43), tel qu'écrit : jamais converti. */
export interface MontantRecu {
  /** MDT-207 : MEN encaissé, MPA payé, RAP reste à payer… (G7.12). */
  code: string | null
  /** MDT-215, la forme de G7.07 : le point décimal, 19 chiffres et 6 décimales au plus. */
  montant: string
  /** MDT-216. */
  devise: string | null
  /** MDT-224. */
  taux: string | null
  /** MDT-219, AAAA-MM-JJ. */
  date: string | null
}

export interface StatutRecuLu {
  objet: ObjetStatutRecu
  /** MDT-105. */
  code: string
  /** MDT-87 : le numéro de la facture, l'identifiant du message rejeté ou du flux (G7.23). */
  reference: string
  /** MDT-91. */
  typeObjet: string | null
  /** MDT-129 de schéma 0002 : le SIREN du vendeur (G7.17). */
  siren: string | null
  /** MDT-100, AAAA-MM-JJ : la date d'émission de la facture (G7.31). */
  dateObjet: string | null
  /** MDT-4. */
  messageId: string | null
  /** MDT-78, l'horodatage du statut, TEL QU'ÉCRIT (AAAAMMJJHHMMSS) : son fuseau n'est pas dit. */
  emisLe: string | null
  /** MDT-40 : qui a créé le message (BY l'acheteur, SE le vendeur, WK une plateforme, DFH l'administration…). */
  createurRole: string | null
  /** MDT-110, AAAA-MM-JJ. */
  dateStatut: string | null
  /** MDT-113 et MDT-114, « code : libellé ; … ». */
  motifs: string | null
  /** MDT-125, MDT-126 et MDT-127. */
  commentaire: string | null
  montants: MontantRecu[]
  /** Les données informatives écartées, et pourquoi. */
  avertissements: string[]
}

export type LectureStatutRecu = { lu: StatutRecuLu } | { refus: 'illisible' | 'ambigu'; raison: string }

const jetonRecu = (texte: string) => texte.replace(/[ \t\n]+/g, ' ').trim()
// Les caractères de commande (Unicode Cc : de U+0000 à U+001F et de U+007F à U+009F), invisibles à l'écran.
const uneLigneRecu = (texte: string) => texte.replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim()
const caracteresRecu = (texte: string) => [...texte].length

function enfantsRecu(el: ElementRecu, ns: string, nom: string): ElementRecu[] {
  return el.enfants.filter((e) => e.ns === ns && e.nom === nom)
}

/** Le texte d'un élément à contenu simple ; null quand il porte des éléments. */
function texteSimpleRecu(el: ElementRecu): string | null {
  return el.enfants.length > 0 ? null : el.texte
}

function attributRecu(el: ElementRecu, nom: string): string | null {
  return el.attributs.find((a) => a.ns === '' && a.nom === nom)?.valeur ?? null
}

/** Une date civile AAAAMMJJ qui existe, rendue AAAA-MM-JJ. */
function dateCivileRecu(chiffres: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(chiffres)
  if (!m) return null
  const [annee, mois, jour] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const bissextile = (annee % 4 === 0 && annee % 100 !== 0) || annee % 400 === 0
  const jours = [31, bissextile ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return jour >= 1 && jour <= (jours[mois - 1] ?? 0) ? `${m[1]}-${m[2]}-${m[3]}` : null
}

/**
 * La date d'un élément date-heure (`…/DateTimeString`, espace de noms udt ou qdt) selon son format : 204
 * (AAAAMMJJHHMMSS, G7.06) ou 102 (AAAAMMJJ). `absente` quand il n'y en a pas ; `faute` quand elle est mal formée.
 */
function dateDeRecu(conteneur: ElementRecu | undefined, espaces: readonly string[]): { date: string | null; horodatage: string | null } | 'absente' | 'faute' {
  if (conteneur === undefined) return 'absente'
  const chaines = conteneur.enfants.filter((e) => espaces.includes(e.ns) && e.nom === 'DateTimeString')
  if (chaines.length !== 1 || conteneur.enfants.length !== 1) return 'faute'
  const texte = texteSimpleRecu(chaines[0])
  const format = attributRecu(chaines[0], 'format')
  if (texte === null || format === null) return 'faute'
  const valeur = jetonRecu(texte)
  const formatJeton = jetonRecu(format)
  if (formatJeton === '102') {
    const date = dateCivileRecu(valeur)
    return date === null ? 'faute' : { date, horodatage: null }
  }
  if (formatJeton === '204') {
    const m = /^(\d{8})(\d{2})(\d{2})(\d{2})$/.exec(valeur)
    const date = m ? dateCivileRecu(m[1]) : null
    if (!m || date === null || Number(m[2]) > 23 || Number(m[3]) > 59 || Number(m[4]) > 59) return 'faute'
    return { date, horodatage: valeur }
  }
  return 'faute'
}

/** Un texte informatif, sur une ligne, borné aux 2 000 caractères que la base garde. */
function borneRecu(morceaux: string[], separateur: string, quoi: string, avertissements: string[]): string | null {
  const texte = morceaux.filter((m) => m !== '').join(separateur)
  if (texte === '') return null
  if (caracteresRecu(texte) <= LONGUEUR_MAX_TEXTE_RECU) return texte
  avertissements.push(`${quoi} dépasse ${LONGUEUR_MAX_TEXTE_RECU} caractères : il est coupé.`)
  return `${[...texte].slice(0, LONGUEUR_MAX_TEXTE_RECU - 1).join('')}…`
}

const MONTANT_G707_RECU = /^-?(\d+)(?:\.(\d{1,6}))?$/

/**
 * Ce que porte un message de cycle de vie reçu, ou pourquoi il ne se lit pas. Un seul document de réponse (MDB-03),
 * une seule référence (MDG-32), un seul code (MDT-105), un seul numéro (MDT-87), un seul SIREN de schéma 0002 (G7.17) :
 * le message porte sur UN objet (P1.14), et plusieurs valeurs le rendent ambigu.
 */
export function lireStatutRecu(xml: string): LectureStatutRecu {
  const analyse = analyserXmlRecu(xml)
  if ('refus' in analyse) return { refus: 'illisible', raison: `Le message n’est pas un XML lisible : ${analyse.refus}.` }
  const racine = analyse.racine
  if (racine.ns !== NS_RSM_RECU || racine.nom !== 'CrossDomainAcknowledgementAndResponse') {
    return { refus: 'illisible', raison: 'Le message n’est pas un cycle de vie CDAR (CrossDomainAcknowledgementAndResponse).' }
  }
  const illisible = (raison: string): LectureStatutRecu => ({ refus: 'illisible', raison })
  const ambigu = (raison: string): LectureStatutRecu => ({ refus: 'ambigu', raison })
  const avertissements: string[] = []

  const reponses = enfantsRecu(racine, NS_RSM_RECU, 'AcknowledgementDocument')
  if (reponses.length === 0) return illisible('Le message n’a pas de document de réponse (MDB-03).')
  if (reponses.length > 1) return ambigu('Le message porte plusieurs documents de réponse : il devrait porter sur un seul objet (P1.14).')
  const reponse = reponses[0]
  const indicateurs = enfantsRecu(reponse, NS_RAM_RECU, 'MultipleReferencesIndicator')
  if (indicateurs.length > 1) return ambigu('Le message répète l’indicateur de références multiples (MDT-74).')
  if (indicateurs.length === 1) {
    const valeurs = enfantsRecu(indicateurs[0], NS_UDT_RECU, 'Indicator').map(texteSimpleRecu)
    const valeur = valeurs.length === 1 && valeurs[0] !== null ? jetonRecu(valeurs[0]) : null
    if (valeur === 'true' || valeur === '1') return ambigu('Le message se dit relatif à plusieurs objets (MDT-74) : P1.14 n’en admet qu’un.')
    if (valeur !== 'false' && valeur !== '0') return illisible('L’indicateur de références multiples (MDT-74) est illisible.')
  }
  const references = enfantsRecu(reponse, NS_RAM_RECU, 'ReferenceReferencedDocument')
  if (references.length === 0) return illisible('Le message ne désigne aucun objet (MDG-32).')
  if (references.length > 1) return ambigu('Le message désigne plusieurs objets (MDG-32).')
  const ref = references[0]

  // Les données décisives.
  const unique = (ns: string, nom: string, mdt: string): { valeur: string | null } | LectureStatutRecu => {
    const trouves = enfantsRecu(ref, ns, nom)
    if (trouves.length > 1) return ambigu(`Le message porte plusieurs ${mdt}.`)
    if (trouves.length === 0) return { valeur: null }
    const texte = texteSimpleRecu(trouves[0])
    if (texte === null) return illisible(`${mdt} n’est pas une valeur simple.`)
    return { valeur: jetonRecu(texte) }
  }
  const codeLu = unique(NS_RAM_RECU, 'ProcessConditionCode', 'codes de statut (MDT-105)')
  if (!('valeur' in codeLu)) return codeLu
  if (codeLu.valeur === null || !/^\d{3}$/.test(codeLu.valeur)) return illisible('Le code du statut (MDT-105) manque ou n’a pas trois chiffres.')
  const referenceLue = unique(NS_RAM_RECU, 'IssuerAssignedID', 'identifiants d’objet (MDT-87)')
  if (!('valeur' in referenceLue)) return referenceLue
  if (referenceLue.valeur === null || referenceLue.valeur === '' || caracteresRecu(referenceLue.valeur) > LONGUEUR_MAX_IDENTIFIANT_RECU
    || /\p{Cc}/u.test(referenceLue.valeur)) {
    return illisible('L’identifiant de l’objet (MDT-87) manque ou est illisible.')
  }
  const typeLu = unique(NS_RAM_RECU, 'TypeCode', 'codes type d’objet (MDT-91)')
  if (!('valeur' in typeLu)) return typeLu
  if (typeLu.valeur !== null && !/^\d{3}$/.test(typeLu.valeur)) return illisible('Le code type de l’objet (MDT-91) n’a pas trois chiffres.')
  const urnLue = unique(NS_RAM_RECU, 'ReferenceTypeCode', 'codes type de référence (MDT-97)')
  if (!('valeur' in urnLue)) return urnLue

  // L'objet : par MDT-97, par MDT-91 ; s'ils se contredisent, le message est ambigu.
  const parUrn = urnLue.valeur === null ? null : (Object.hasOwn(REFERENCES_STATUT_RECU, urnLue.valeur) ? REFERENCES_STATUT_RECU[urnLue.valeur] : 'inconnu')
  const parType = typeLu.valeur === null ? null
    : (TYPES_FACTURE_STATUT_RECU as readonly string[]).includes(typeLu.valeur) ? 'facture'
    : Object.hasOwn(TYPES_OBJET_STATUT_RECU, typeLu.valeur) ? TYPES_OBJET_STATUT_RECU[typeLu.valeur] : 'inconnu'
  if (parUrn === null && parType === null) return illisible('Le message ne dit pas sur quoi il porte (MDT-91, MDT-97).')
  const connus = [parUrn, parType].filter((o): o is ObjetStatutRecu => o !== null && o !== 'inconnu')
  if (connus.length === 2 && connus[0] !== connus[1]) return ambigu('Le type de l’objet (MDT-91) et le type de référence (MDT-97) se contredisent.')
  const objet: ObjetStatutRecu = connus[0] ?? 'autre'

  // Le vendeur : MDT-129 de schéma 0002, un seul (G7.17).
  const emetteurs = enfantsRecu(ref, NS_RAM_RECU, 'IssuerTradeParty')
  if (emetteurs.length > 1) return ambigu('Le message désigne plusieurs émetteurs de l’objet (MDG-40).')
  const sirens = new Set<string>()
  for (const id of emetteurs.length === 1 ? enfantsRecu(emetteurs[0], NS_RAM_RECU, 'GlobalID') : []) {
    const schema = attributRecu(id, 'schemeID')
    const texte = texteSimpleRecu(id)
    if (schema === null || jetonRecu(schema) !== '0002') continue
    if (texte === null) return illisible('Le SIREN du vendeur (MDT-129) n’est pas une valeur simple.')
    sirens.add(jetonRecu(texte))
  }
  if (sirens.size > 1) return ambigu('Le message désigne plusieurs SIREN de vendeur (MDT-129) : G7.17 n’en admet qu’un.')
  const siren = sirens.size === 1 ? [...sirens][0] : null
  if (siren !== null && !/^\d{9}$/.test(siren)) return illisible('Le SIREN du vendeur (MDT-129) n’a pas neuf chiffres.')

  // La date de l'objet (MDT-100) : son année désigne la facture (G1.42).
  const dates = enfantsRecu(ref, NS_RAM_RECU, 'FormattedIssueDateTime')
  if (dates.length > 1) return ambigu('Le message porte plusieurs dates d’objet (MDT-100).')
  const dateObjet = dateDeRecu(dates[0], [NS_QDT_RECU, NS_UDT_RECU])
  if (dateObjet === 'faute') return illisible('La date de l’objet (MDT-100) est illisible.')

  // Les données informatives.
  const document = enfantsRecu(racine, NS_RSM_RECU, 'ExchangedDocument')
  let messageId: string | null = null
  let createurRole: string | null = null
  if (document.length === 1) {
    const ids = enfantsRecu(document[0], NS_RAM_RECU, 'ID').map(texteSimpleRecu)
    const id = ids.length === 1 && ids[0] !== null ? jetonRecu(ids[0]) : null
    if (id !== null && id !== '' && caracteresRecu(id) <= LONGUEUR_MAX_IDENTIFIANT_RECU && !/\p{Cc}/u.test(id)) messageId = id
    else if (ids.length > 0) avertissements.push('L’identifiant du message (MDT-4) est illisible : il est écarté.')
    const createurs = enfantsRecu(document[0], NS_RAM_RECU, 'IssuerTradeParty')
    const roles = createurs.length === 1 ? enfantsRecu(createurs[0], NS_RAM_RECU, 'RoleCode').map(texteSimpleRecu) : []
    const role = roles.length === 1 && roles[0] !== null ? jetonRecu(roles[0]) : null
    if (role !== null && /^[A-Z0-9]{1,3}$/.test(role)) createurRole = role
    else if (roles.length > 0 || createurs.length > 1) avertissements.push('Le rôle du créateur du message (MDT-40) est illisible : il est écarté.')
  } else if (document.length > 1) avertissements.push('Le message répète son document d’échange : son identifiant et son créateur sont écartés.')

  const horodatages = enfantsRecu(reponse, NS_RAM_RECU, 'IssueDateTime')
  const horodatage = horodatages.length === 1 ? dateDeRecu(horodatages[0], [NS_UDT_RECU]) : horodatages.length === 0 ? 'absente' : 'faute'
  let emisLe: string | null = null
  if (horodatage !== 'absente') {
    if (horodatage !== 'faute' && horodatage.horodatage !== null) emisLe = horodatage.horodatage
    else avertissements.push('L’horodatage du statut (MDT-78) est illisible : il est écarté.')
  }

  const motifs: string[] = []
  const commentaires: string[] = []
  const montants: MontantRecu[] = []
  const datesStatut = new Set<string>()
  for (const detail of enfantsRecu(ref, NS_RAM_RECU, 'SpecifiedDocumentStatus')) {
    const codes = enfantsRecu(detail, NS_RAM_RECU, 'ReasonCode').map(texteSimpleRecu)
    const code = codes.length === 1 && codes[0] !== null ? jetonRecu(codes[0]) : null
    const codeAdmis = code !== null && /^[A-Za-z0-9_.-]{1,50}$/.test(code) ? code : null
    if (codes.length > 0 && codeAdmis === null) avertissements.push('Un code de motif (MDT-113) est illisible : il est écarté.')
    const libelles = enfantsRecu(detail, NS_RAM_RECU, 'Reason').map((e) => uneLigneRecu(texteSimpleRecu(e) ?? '')).filter((t) => t !== '')
    if (codeAdmis !== null || libelles.length > 0) motifs.push([codeAdmis, libelles.join(' ')].filter((x) => x !== null && x !== '').join(' : '))
    for (const note of enfantsRecu(detail, NS_RAM_RECU, 'IncludedNote')) {
      const regle = enfantsRecu(note, NS_RAM_RECU, 'ContentCode').map((e) => uneLigneRecu(texteSimpleRecu(e) ?? '')).filter((t) => t !== '')
      const contenu = enfantsRecu(note, NS_RAM_RECU, 'Content').map((e) => uneLigneRecu(texteSimpleRecu(e) ?? '')).filter((t) => t !== '')
      const sujet = enfantsRecu(note, NS_RAM_RECU, 'SubjectCode').map((e) => uneLigneRecu(texteSimpleRecu(e) ?? '')).filter((t) => t !== '')
      const morceau = [regle.length > 0 ? `[${regle.join(', ')}]` : '', contenu.join(' '), sujet.length > 0 ? `(${sujet.join(', ')})` : '']
        .filter((x) => x !== '').join(' ')
      if (morceau !== '') commentaires.push(morceau)
    }
    const dateDetail = dateDeRecu(enfantsRecu(detail, NS_RAM_RECU, 'ReferenceDateTime')[0], [NS_UDT_RECU])
    if (dateDetail === 'faute' || enfantsRecu(detail, NS_RAM_RECU, 'ReferenceDateTime').length > 1) {
      avertissements.push('Une date de statut (MDT-110) est illisible : elle est écartée.')
    } else if (dateDetail !== 'absente' && dateDetail.date !== null) datesStatut.add(dateDetail.date)
    for (const c of enfantsRecu(detail, NS_RAM_RECU, 'SpecifiedDocumentCharacteristic')) {
      const valeurs = enfantsRecu(c, NS_RAM_RECU, 'ValueAmount')
      if (valeurs.length === 0) continue
      const brut = valeurs.length === 1 ? texteSimpleRecu(valeurs[0]) : null
      const montant = brut === null ? null : jetonRecu(brut)
      const m = montant === null ? null : MONTANT_G707_RECU.exec(montant)
      if (montant === null || m === null || m[1].length + (m[2]?.length ?? 0) > 19) {
        avertissements.push('Un montant (MDT-215) est illisible : il est écarté.')
        continue
      }
      const devise = attributRecu(valeurs[0], 'currencyID')
      const types = enfantsRecu(c, NS_RAM_RECU, 'TypeCode').map(texteSimpleRecu)
      const type = types.length === 1 && types[0] !== null ? jetonRecu(types[0]) : null
      const tauxBruts = enfantsRecu(c, NS_RAM_RECU, 'ValuePercent').map(texteSimpleRecu)
      const taux = tauxBruts.length === 1 && tauxBruts[0] !== null ? jetonRecu(tauxBruts[0]) : null
      const dateMontant = dateDeRecu(enfantsRecu(c, NS_RAM_RECU, 'ValueDateTime')[0], [NS_UDT_RECU])
      montants.push({
        code: type !== null && /^[A-Z]{3}$/.test(type) ? type : null,
        montant,
        devise: devise !== null && /^[A-Z]{3}$/.test(jetonRecu(devise)) ? jetonRecu(devise) : null,
        taux: taux !== null && /^-?\d+(?:\.\d+)?$/.test(taux) ? taux : null,
        date: dateMontant !== 'absente' && dateMontant !== 'faute' ? dateMontant.date : null,
      })
    }
  }
  if (datesStatut.size > 1) avertissements.push('Les dates de statut (MDT-110) se contredisent : elles sont écartées.')

  return {
    lu: {
      objet,
      code: codeLu.valeur,
      reference: referenceLue.valeur,
      typeObjet: typeLu.valeur,
      siren,
      dateObjet: dateObjet === 'absente' ? null : dateObjet.date,
      messageId,
      emisLe,
      createurRole,
      dateStatut: datesStatut.size === 1 ? [...datesStatut][0] : null,
      motifs: borneRecu(motifs, ' ; ', 'Le motif', avertissements),
      commentaire: borneRecu(commentaires, ' — ', 'Le commentaire', avertissements),
      montants,
      avertissements,
    },
  }
}

// ── Le rattachement à une facture du dossier ─────────────────────────────────────────────────────────────────────────

/** La facture du dossier qui porte le numéro du message, telle que le rattachement la lit (colonnes de `factures_emises`). */
export interface FacturePourStatutRecu {
  id: string
  numero: string | null
  statut: 'brouillon' | 'validee'
  type: 'facture' | 'avoir'
  date_emission: string
  emetteur_siret: string | null
}

// Pourquoi un message ne se rattache pas : il ne se garde pas, il se dit.
export type EcartStatutRecu =
  | 'illisible' | 'ambigu' | 'autre_objet' | 'statut_inconnu' | 'autre_vendeur' | 'facture_inconnue' | 'incoherent'

export type RattachementRecu = { factureId: string } | { ecart: EcartStatutRecu; raison: string }

/**
 * Le rattachement d'un message lu à une facture du dossier. L'identité d'une facture pour l'administration est son
 * numéro, l'année de sa date d'émission et le SIREN de son fournisseur (G1.42) : le message se rattache quand il porte
 * sur une facture (MDT-97, MDT-91), dit un statut du tableau 8, désigne le vendeur par son SIREN (G7.17), et que
 * `facture` — la facture VALIDÉE du dossier qui porte son numéro MDT-87, cherchée par l'appelant, ou null — a FIGÉ ce
 * SIREN à sa validation, a cette année d'émission (MDT-100, quand il est là) et ce type (MDT-91, quand il est là).
 * `sirenDuDossier` ne sert qu'à dire si un message sans facture est celui d'une autre entreprise.
 */
export function rattacherStatutRecu(
  lu: StatutRecuLu,
  facture: FacturePourStatutRecu | null,
  sirenDuDossier: string | null,
): RattachementRecu {
  if (lu.objet !== 'facture') {
    return {
      ecart: 'autre_objet',
      raison: lu.objet === 'statut'
        ? `Un statut ${lu.code} porte sur un autre statut (un cycle de vie rejeté) : il ne désigne pas une facture.`
        : `Un statut ${lu.code} porte sur un ${lu.objet === 'flux' ? 'flux' : 'objet'} qui n’est pas une facture.`,
    }
  }
  if (!(CODES_STATUT_RECU as readonly string[]).includes(lu.code)) {
    return { ecart: 'statut_inconnu', raison: `Le statut ${lu.code} n’est pas un statut de facture que les spécifications de la DGFiP définissent.` }
  }
  if (lu.siren === null) {
    return { ecart: 'illisible', raison: 'Le message ne désigne pas le vendeur par son SIREN (règle G7.17).' }
  }
  if (facture === null || facture.statut !== 'validee' || facture.numero !== lu.reference) {
    // Sans SIREN au dossier, rien ne dit que le message vise une autre entreprise : il se dit sans facture.
    return sirenDuDossier !== null && lu.siren !== sirenDuDossier
      ? { ecart: 'autre_vendeur', raison: 'Le message concerne la facture d’une autre entreprise que le dossier.' }
      : { ecart: 'facture_inconnue', raison: `Aucune facture validée du dossier ne porte le numéro ${lu.reference}.` }
  }
  const sirenFige = sirenDe(facture.emetteur_siret)
  if (sirenFige === null) {
    return { ecart: 'incoherent', raison: `La facture ${facture.numero} ne porte pas le SIREN qu’elle aurait transmis.` }
  }
  if (sirenFige !== lu.siren) {
    return lu.siren === sirenDuDossier
      ? { ecart: 'incoherent', raison: `La facture ${facture.numero} a été émise sous un autre SIREN que celui que le message désigne.` }
      : { ecart: 'autre_vendeur', raison: 'Le message concerne la facture d’une autre entreprise que le dossier.' }
  }
  if (lu.dateObjet !== null && lu.dateObjet.slice(0, 4) !== facture.date_emission.slice(0, 4)) {
    return { ecart: 'incoherent', raison: `Le message désigne une facture ${lu.reference} de ${lu.dateObjet.slice(0, 4)} : celle du dossier est de ${facture.date_emission.slice(0, 4)}.` }
  }
  if (lu.typeObjet !== null && lu.typeObjet !== TYPE_EMIS_STATUT_RECU[facture.type]) {
    return { ecart: 'incoherent', raison: `Le message désigne un document de type ${lu.typeObjet} : ${facture.numero} est ${facture.type === 'facture' ? 'une facture (380)' : 'un avoir (381)'}.` }
  }
  return { factureId: facture.id }
}
// ── FIN COPIE cdarRecu ───────────────────────────────────────────────────────────────────────────────────────────────
