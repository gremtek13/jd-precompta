import { sansBlancsAuxBords } from './articles'
import { poidsFaceALaBorne } from './bornesStockage'
import { TYPES_CLIENT_CONTACT, saisieQuiPart, type ContactEnvoye, type ContactPourSiret, type SaisieContact } from './contacts'
import { refusDesLignes, refusDuNombreDeLignes, type RefusImportContacts } from './contactsImport'
import { LIBELLES_TYPE_CONTACT } from './contactsVue'
import type { EspaceVentes } from './espaceVentes'
import type { ArticleExoneration, TypeClient } from './types'

// LE FICHIER D'UN IMPORT DE CLIENTS, LU DANS LE NAVIGATEUR (espace client, étape A4b3b ; conception : HISTORIQUE.md, « L'ESPACE
// CLIENT, LOGICIEL DE GESTION DU CLIENT : LE PREMIER GROUPE, LA PARITÉ, ET AU-DELÀ », §A.4, « L'usage » ; la base : « L'IMPORT
// D'UN FICHIER DE CLIENTS, EN BASE »). Un module PUR — il ne lit rien en base, n'appelle personne, ne lit pas l'horloge — que la
// fenêtre « Importer des clients » (`ContactsImportModal`) appelle : la borne du fichier, son encodage, son découpage, la
// correspondance de ses colonnes aux champs d'un contact, les lignes telles qu'elles partiront, et l'aperçu de ce que la base
// en refuserait.
//
// LE FICHIER NE PART NULLE PART : il est lu ici, dans le navigateur, et seules les lignes que le bouton envoie, une fois les
// colonnes choisies, atteignent la base par `importer_contacts` (RGPD.md : « Rien d'autre n'est gardé »). Ni stockage, ni
// journal, ni Edge Function.
//
// AUCUNE RÈGLE D'UN CONTACT N'EST RECOPIÉE ICI : les refus sont ceux de `lib/contactsImport.ts` (ceux de la base, dans son
// ordre et sous ses mots), les formes des valeurs celles de `saisieQuiPart`. Ce module ne dit que ce qui est PROPRE au
// fichier : sa borne, son encodage, ses guillemets, ses colonnes. Il ne devine rien d'autre : ni le nom d'une colonne de
// l'ancien logiciel (A4B3-Q6, ouverte), ni un encodage sans marque au-delà de la règle dite ci-dessous, ni un type de client.

// ── La borne du fichier (A4B3B-Q1) ──────────────────────────────────────────────────────────────────────────────────────
// Jugée AVANT toute lecture, sur la taille que le navigateur donne. Mille lignes dont chaque champ est à sa borne font une
// requête de 5,1 Mo (mesure d'A4b3a, sur une réplique) ; le même fichier enregistré en UTF-16 pèse le double de ses
// caractères : dix mébioctets le laissent passer, et rien de plus lourd n'a de raison d'être un fichier de mille clients. La
// borne ne protège pas la base (mille lignes au plus, chaque champ borné, la tiennent déjà) : elle épargne au navigateur la
// lecture d'un fichier qui n'est pas celui qu'on croit.
export const TAILLE_FICHIER_IMPORT_MAX = 10 * 1024 * 1024

/** Le refus d'un fichier trop lourd, poids et borne dits pour qu'on voie l'écart ; null sous la borne. */
export function refusDeLaTaille(octets: number, espace: EspaceVentes): string | null {
  if (octets <= TAILLE_FICHIER_IMPORT_MAX) return null
  const dits = poidsFaceALaBorne([octets], TAILLE_FICHIER_IMPORT_MAX)
  return `Ce fichier pèse ${dits.lus[0]}, au-delà des ${dits.borne} qu’un import de clients peut lire : un fichier de mille `
    + 'clients pèse bien moins. '
    + (espace === 'client'
      ? 'Vérifie que c’est le bon fichier, ou partage-le en plusieurs imports.'
      : 'Vérifier que c’est le bon fichier, ou le partager en plusieurs imports.')
}

// Ce qu'on fait d'un fichier que l'encodage refuse : le client tutoyé, le cabinet à l'infinitif.
const reenregistrer = (espace: EspaceVentes) => (espace === 'client'
  ? 'Enregistre-le de nouveau en CSV UTF-8 depuis ton tableur, puis reprends-le.'
  : 'Le réenregistrer en CSV UTF-8 depuis le tableur, puis le reprendre.')

// ── L'encodage ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// Une marque d'ordre (UTF-8, UTF-16 LE ou BE) DÉCIDE : le fichier se lit dans l'encodage qu'elle annonce, en mode strict — des
// octets qui le démentent font refuser le fichier, jamais lire de travers. Sans marque : l'UTF-8 strict, qui LÈVE sur une
// séquence invalide, sinon windows-1252, l'encodage des logiciels français sous Windows, qui ne peut pas échouer. C'est la
// règle de `lib/decodageTexte.ts` (le jumeau, laissé tel quel), à laquelle s'ajoutent les marques : un tableur qui
// enregistre en « Unicode » écrit de l'UTF-16 avec sa marque.
export type EncodageDuFichier = 'utf-8-marque' | 'utf-16le' | 'utf-16be' | 'utf-8' | 'windows-1252'

export const LIBELLES_ENCODAGE: Readonly<Record<EncodageDuFichier, string>> = {
  'utf-8-marque': 'UTF-8, annoncé par sa marque d’ordre',
  'utf-16le': 'UTF-16 (petit-boutiste), annoncé par sa marque d’ordre',
  'utf-16be': 'UTF-16 (gros-boutiste), annoncé par sa marque d’ordre',
  'utf-8': 'UTF-8 (sans marque d’ordre : ses octets en sont)',
  'windows-1252': 'windows-1252 (sans marque d’ordre, et ses octets ne sont pas de l’UTF-8 : l’encodage des logiciels français '
    + 'sous Windows)',
}

const MARQUES: readonly { encodage: EncodageDuFichier; nom: string; decodeur: string; octets: readonly number[] }[] = [
  { encodage: 'utf-8-marque', nom: 'UTF-8', decodeur: 'utf-8', octets: [0xef, 0xbb, 0xbf] },
  { encodage: 'utf-16le', nom: 'UTF-16 (petit-boutiste)', decodeur: 'utf-16le', octets: [0xff, 0xfe] },
  { encodage: 'utf-16be', nom: 'UTF-16 (gros-boutiste)', decodeur: 'utf-16be', octets: [0xfe, 0xff] },
]

export type FichierDecode = { texte: string; encodage: EncodageDuFichier } | { refus: string }

// Le numéro de la ligne PHYSIQUE (depuis un) où tombe une position du texte : un CR seul, un LF seul ou un CRLF finit une ligne.
function ligneDeLaPosition(texte: string, position: number): number {
  let ligne = 1
  for (let i = 0; i < position; i++) {
    if (texte[i] === '\n' || (texte[i] === '\r' && texte[i + 1] !== '\n')) ligne++
  }
  return ligne
}

/**
 * Les octets du fichier en texte, avec l'encodage lu, ou le refus à dire : une marque d'ordre démentie par les octets, ou
 * un caractère nul (U+0000) — la base refuserait l'import ENTIER en anglais (22P05), et sa cause est presque toujours un
 * fichier en UTF-16 enregistré sans marque, ou un fichier qui n'est pas du texte. La marque elle-même ne fait pas partie du
 * texte ; une seconde marque, si le fichier en porte, reste où elle est (`ignoreBOM`).
 */
export function decoderLeFichier(octets: Uint8Array, espace: EspaceVentes): FichierDecode {
  const marque = MARQUES.find((m) => m.octets.every((o, i) => octets[i] === o))
  let texte: string
  let encodage: EncodageDuFichier
  if (marque) {
    try {
      texte = new TextDecoder(marque.decodeur, { fatal: true, ignoreBOM: true }).decode(octets.subarray(marque.octets.length))
    } catch {
      return {
        refus: `Ce fichier s’annonce en ${marque.nom} par sa marque d’ordre, mais ses octets n’en sont pas : il ne se lit pas `
          + `sans erreur. ${reenregistrer(espace)}`,
      }
    }
    encodage = marque.encodage
  } else {
    try {
      texte = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(octets)
      encodage = 'utf-8'
    } catch {
      texte = new TextDecoder('windows-1252').decode(octets)
      encodage = 'windows-1252'
    }
  }
  const nul = texte.indexOf('\u0000')
  if (nul >= 0) {
    return {
      refus: `Ce fichier porte un caractère nul (U+0000) à la ligne ${ligneDeLaPosition(texte, nul)} : il a sans doute été enregistré `
        + `en UTF-16 sans marque d’ordre, ou ce n’est pas un fichier texte. ${reenregistrer(espace)}`,
    }
  }
  return { texte, encodage }
}

// ── Le découpage ───────────────────────────────────────────────────────────────────────────────────────────────────────
// `parseCsv` (lib/csv.ts) choisit le point-virgule dès qu'il en voit un dans les 2 000 premiers caractères, guillemets compris :
// une adresse « 3, rue … ; bâtiment B » dans un fichier à virgules le tromperait, et il ne connaît pas la tabulation. Il
// ignore aussi un guillemet jamais fermé (le reste du fichier devient un champ). Le découpage d'un import a donc sa propre
// fonction, ici, sans toucher à `parseCsv` ni à ses appelants : le séparateur est PROPOSÉ d'après la première ligne, hors
// guillemets, et l'écran le dit et le laisse changer ; un guillemet jamais fermé refuse le fichier.
export type Separateur = ';' | ',' | '\t'

// Dans l'ordre où une égalité se tranche : le point-virgule des tableurs français, puis la tabulation, puis la virgule.
export const SEPARATEURS: readonly Separateur[] = [';', '\t', ',']

export const LIBELLES_SEPARATEUR: Readonly<Record<Separateur, string>> = {
  ';': 'le point-virgule',
  '\t': 'la tabulation',
  ',': 'la virgule',
}

/**
 * Le séparateur proposé : celui que la première ligne porte le plus souvent HORS guillemets (une virgule d'adresse entre
 * guillemets ne compte pas), à égalité dans l'ordre de `SEPARATEURS` ; sans aucun, le point-virgule (une seule colonne : le
 * choix ne change rien).
 */
export function separateurPropose(texte: string): Separateur {
  const comptes = new Map<Separateur, number>(SEPARATEURS.map((s) => [s, 0]))
  let entreGuillemets = false
  for (let i = 0; i < texte.length; i++) {
    const c = texte[i]
    if (c === '"') entreGuillemets = !entreGuillemets
    else if (!entreGuillemets && (c === '\n' || c === '\r')) break
    else if (!entreGuillemets && comptes.has(c as Separateur)) comptes.set(c as Separateur, (comptes.get(c as Separateur) as number) + 1)
  }
  let retenu: Separateur = ';'
  let plus = 0
  for (const s of SEPARATEURS) {
    const n = comptes.get(s) as number
    if (n > plus) { retenu = s; plus = n }
  }
  return retenu
}

/** Une ligne du fichier : ses cellules, et la ligne PHYSIQUE (depuis un) où elle commence — un champ peut porter un retour à la ligne. */
export interface EnregistrementDuFichier {
  ligne: number
  cellules: string[]
}

export type FichierDecoupe = { enregistrements: EnregistrementDuFichier[]; vides: number } | { refus: string }

const toutBlanc = (cellules: readonly string[]) => cellules.every((c) => sansBlancsAuxBords(c) === '')

/**
 * Le texte en lignes et en cellules, au séparateur donné : les guillemets entourent une cellule qui porte le séparateur, un
 * guillemet (doublé) ou un retour à la ligne ; CRLF, LF et CR finissent une ligne. Une ligne dont toutes les cellules sont
 * blanches ne fait pas un client : elle est COMPTÉE (`vides`), et l'écran le dit. Un guillemet jamais fermé refuse le
 * fichier, en nommant la ligne où il s'ouvre : lu jusqu'au bout, il ferait du reste du fichier une seule cellule.
 * Un guillemet au milieu d'une cellule qui n'en commence pas par un reste un caractère de la cellule.
 */
export function decouperLeFichier(texte: string, separateur: Separateur, espace: EspaceVentes): FichierDecoupe {
  const enregistrements: EnregistrementDuFichier[] = []
  let vides = 0
  let cellules: string[] = []
  let cellule = ''
  let entreGuillemets = false
  let debutDeCellule = true
  let ligne = 1
  let debutDeLigne = 1
  let ouverture = 0
  const finir = () => {
    cellules.push(cellule)
    if (toutBlanc(cellules)) vides++
    else enregistrements.push({ ligne: debutDeLigne, cellules })
    cellules = []
    cellule = ''
    debutDeCellule = true
  }
  for (let i = 0; i < texte.length; i++) {
    const c = texte[i]
    if (entreGuillemets) {
      if (c === '"') {
        if (texte[i + 1] === '"') { cellule += '"'; i++ } else entreGuillemets = false
      } else {
        if (c === '\n' || (c === '\r' && texte[i + 1] !== '\n')) ligne++
        cellule += c
      }
      continue
    }
    if (c === '"' && debutDeCellule) {
      entreGuillemets = true
      ouverture = ligne
      debutDeCellule = false
    } else if (c === separateur) {
      cellules.push(cellule)
      cellule = ''
      debutDeCellule = true
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && texte[i + 1] === '\n') i++
      finir()
      ligne++
      debutDeLigne = ligne
    } else {
      cellule += c
      debutDeCellule = false
    }
  }
  if (entreGuillemets) {
    return {
      refus: `Un guillemet ouvert à la ligne ${ouverture} du fichier n’est jamais fermé : le reste du fichier se lirait comme une `
        + (espace === 'client' ? 'seule cellule. Vérifie le fichier, ou choisis un autre séparateur.'
          : 'seule cellule. Vérifier le fichier, ou choisir un autre séparateur.'),
    }
  }
  // La dernière ligne, quand le fichier ne finit pas par un retour à la ligne.
  if (cellule !== '' || cellules.length > 0 || !debutDeCellule) finir()
  return { enregistrements, vides }
}

// ── Les colonnes ───────────────────────────────────────────────────────────────────────────────────────────────────────
export interface TableauDuFichier {
  // Le nom de chaque colonne : celui de l'en-tête (blancs des bords retirés), sinon « Colonne N ».
  colonnes: string[]
  // Les lignes de clients, l'en-tête ôté.
  lignes: EnregistrementDuFichier[]
}

/**
 * Les colonnes et les lignes de clients. Avec en-tête, la première ligne nomme les colonnes et n'est pas un client ; une
 * colonne que l'en-tête ne nomme pas (cellule vide, ou ligne plus longue que l'en-tête) s'appelle « Colonne N ». Le nombre de
 * colonnes est celui de la ligne la plus longue : une ligne plus courte a ses dernières cellules vides.
 */
export function tableauDuFichier(enregistrements: readonly EnregistrementDuFichier[], enTete: boolean): TableauDuFichier {
  const entete = enTete ? enregistrements[0] : undefined
  const lignes = enTete ? enregistrements.slice(1) : [...enregistrements]
  const largeur = Math.max(0, ...enregistrements.map((e) => e.cellules.length))
  const colonnes = Array.from({ length: largeur }, (_, i) => {
    const nom = entete ? sansBlancsAuxBords(entete.cellules[i] ?? '') : ''
    return nom === '' ? `Colonne ${i + 1}` : nom
  })
  return { colonnes, lignes }
}

// ── La correspondance des colonnes aux champs d'un contact ────────────────────────────────────────────────────────────────
export type ChampDUnContact = keyof ContactEnvoye
// Le choix d'une colonne : un champ, « Ne pas importer » (explicitement), ou rien encore (à choisir).
export type ChoixDeColonne = ChampDUnContact | 'ne_pas_importer' | null

// Les champs dans l'ordre de la fenêtre de saisie, sous ses libellés (sans la phrase de qui les lit, que la fenêtre ajoute).
export const CHAMPS_DANS_L_ORDRE: readonly ChampDUnContact[] = [
  'nom', 'type_client', 'adresse', 'siren', 'siret', 'adresse_electronique', 'code_service', 'email', 'delai_paiement_jours', 'observations',
]

export const LIBELLES_DES_CHAMPS: Readonly<Record<ChampDUnContact, string>> = {
  nom: 'Nom ou raison sociale',
  type_client: 'Type',
  adresse: 'Adresse',
  siren: 'SIREN',
  siret: 'SIRET',
  adresse_electronique: 'Adresse de facturation électronique',
  code_service: 'Code service',
  email: 'E-mail',
  delai_paiement_jours: 'Délai de paiement (jours)',
  observations: 'Observations',
}

// Les noms qu'une colonne peut porter pour qu'un champ lui soit PROPOSÉ : les libellés de l'application seulement — ceux de
// la fenêtre de saisie et des en-têtes de la liste. Aucun nom de l'ancien logiciel n'est supposé (A4B3-Q6).
const NOMS_PROPOSES: Readonly<Record<ChampDUnContact, readonly string[]>> = {
  nom: ['Nom ou raison sociale', 'Nom'],
  type_client: ['Type'],
  adresse: ['Adresse'],
  siren: ['SIREN'],
  siret: ['SIRET'],
  adresse_electronique: ['Adresse de facturation électronique'],
  code_service: ['Code service'],
  email: ['E-mail'],
  delai_paiement_jours: ['Délai de paiement', 'Délai de paiement (jours)', 'Délai'],
  observations: ['Observations'],
}

/** Un nom comparé sans sa casse, ses accents ni ce qui n'est ni lettre ni chiffre (« E-mail », « email », « E mail »). */
export function nomCompare(texte: string): string {
  return texte.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

/**
 * Le champ PROPOSÉ pour chaque colonne, d'après son nom : celui dont un libellé de l'application est le même nom (casse,
 * accents et ponctuation ignorés), sinon rien — la colonne reste à choisir. Un champ ne se propose qu'une fois, à la
 * première colonne qui porte son nom.
 */
export function colonnesProposees(colonnes: readonly string[]): ChoixDeColonne[] {
  const pris = new Set<ChampDUnContact>()
  return colonnes.map((nom) => {
    const cle = nomCompare(nom)
    const champ = CHAMPS_DANS_L_ORDRE.find((c) => !pris.has(c) && NOMS_PROPOSES[c].some((n) => nomCompare(n) === cle))
    if (champ === undefined) return null
    pris.add(champ)
    return champ
  })
}

/** Change le choix d'une colonne ; le champ qu'elle prend est retiré à la colonne qui l'avait (un champ ne sert qu'une fois). */
export function choisirPourLaColonne(choix: readonly ChoixDeColonne[], index: number, valeur: ChoixDeColonne): ChoixDeColonne[] {
  return choix.map((c, i) => {
    if (i === index) return valeur
    if (valeur !== null && valeur !== 'ne_pas_importer' && c === valeur) return null
    return c
  })
}

// ── Le type d'un client ───────────────────────────────────────────────────────────────────────────────────────────────────
// Deux formes (A4B3B-Q2) : une colonne choisie pour « Type » — chacune de ses valeurs se fait correspondre à l'un des quatre
// types, ou reste « non reconnue » et refuse SA ligne —, ou, sans colonne pour le type, un type unique choisi pour tout le
// fichier. Rien n'est choisi d'office : sans colonne, le type unique est à choisir.
export type CorrespondanceDuType = Readonly<Record<string, TypeClient | null>>

/** La valeur d'une cellule « Type », blancs des bords retirés : la clé de sa correspondance. */
export const valeurDuType = (cellule: string | undefined) => sansBlancsAuxBords(cellule ?? '')

/** Les valeurs distinctes de la colonne du type, dans l'ordre où elles paraissent (la valeur vide comprise). */
export function valeursDuType(lignes: readonly EnregistrementDuFichier[], colonne: number): string[] {
  return [...new Set(lignes.map((l) => valeurDuType(l.cellules[colonne])))]
}

/**
 * Le type PROPOSÉ pour une valeur : celui dont le libellé de l'application (les mots du formulaire de la facture) ou la valeur
 * que la base range est le même nom, casse, accents et ponctuation ignorés ; sinon rien — la valeur reste « non reconnue ».
 */
export function typePropose(valeur: string): TypeClient | null {
  const cle = nomCompare(valeur)
  if (cle === '') return null
  return TYPES_CLIENT_CONTACT.find((t) => nomCompare(LIBELLES_TYPE_CONTACT[t]) === cle || nomCompare(t) === cle) ?? null
}

export function typesProposes(valeurs: readonly string[]): Record<string, TypeClient | null> {
  return Object.fromEntries(valeurs.map((v) => [v, typePropose(v)]))
}

// ── Ce qui manque avant l'aperçu ──────────────────────────────────────────────────────────────────────────────────────────
export interface CorrespondanceDuFichier {
  choix: readonly ChoixDeColonne[]
  // La correspondance des valeurs, quand une colonne donne le type ; le type unique, sinon (null : à choisir).
  valeursDuType: CorrespondanceDuType
  typeUnique: TypeClient | null
}

export interface EtatDeLaCorrespondance {
  // Les colonnes encore à choisir, par leur nom : l'aperçu attend.
  aChoisir: string[]
  // Sans colonne pour le type, le type unique n'est pas choisi : l'aperçu attend.
  typeAChoisir: boolean
  // Les colonnes « Ne pas importer », par leur nom : l'aperçu les nomme.
  nonImportees: string[]
  // L'index de la colonne qui donne le type, ou null.
  colonneDuType: number | null
}

export function etatDeLaCorrespondance(colonnes: readonly string[], c: CorrespondanceDuFichier): EtatDeLaCorrespondance {
  const index = c.choix.indexOf('type_client')
  return {
    aChoisir: colonnes.filter((_, i) => c.choix[i] == null),
    typeAChoisir: index < 0 && c.typeUnique == null,
    nonImportees: colonnes.filter((_, i) => c.choix[i] === 'ne_pas_importer'),
    colonneDuType: index < 0 ? null : index,
  }
}

// ── Les lignes telles qu'elles partent ─────────────────────────────────────────────────────────────────────────────────────
// La saisie d'une ligne : la cellule de chaque champ choisi, le type de sa correspondance ; les autres champs vides. Les
// valeurs prennent la forme que leur donne `saisieQuiPart` — les blancs des bords retirés, tous ceux d'un identifiant (le
// SIREN « 123 456 782 »), un champ vide envoyé nul, un délai écrit en chiffres envoyé en nombre — et RIEN de plus. Une seule
// chose diffère de la saisie à la main : un champ que le type n'ouvre pas (un SIREN pour un client établi hors de France…)
// n'est pas écarté. La fenêtre de saisie le CACHE, et qui tape le voit disparaître ; ici, l'écarter perdrait en silence une
// cellule du fichier (A4B3-Q2). Il part donc tel quel, et le refus du module le dit sur sa ligne (A4B3B-Q3). Pour cela, les
// formes se calculent sous le type qui ouvre TOUS les champs (un organisme public : SIREN, SIRET, adresse électronique et code
// service), puis la ligne reprend son propre type.
const TYPE_QUI_OUVRE_TOUT: TypeClient = 'organisme_public'

export interface LigneAImporter {
  // Le rang dans l'import (depuis un) : celui des refus de la base, « Ligne N : ».
  numero: number
  // La ligne du fichier où commence ce client.
  ligneDuFichier: number
  envoyee: ContactEnvoye
  // La valeur de la colonne « Type » que la correspondance laisse non reconnue, quand c'est le cas : l'aperçu la nomme.
  typeNonReconnu: string | null
}

export function lignesAImporter(
  tableau: TableauDuFichier, c: CorrespondanceDuFichier,
): LigneAImporter[] {
  const index = c.choix.indexOf('type_client')
  return tableau.lignes.map((l, i) => {
    const cellule = (champ: ChampDUnContact) => {
      const colonne = c.choix.indexOf(champ)
      return colonne < 0 ? '' : (l.cellules[colonne] ?? '')
    }
    const valeur = index < 0 ? null : valeurDuType(l.cellules[index])
    const type = valeur == null ? c.typeUnique : (Object.hasOwn(c.valeursDuType, valeur) ? c.valeursDuType[valeur] : null)
    const saisie: SaisieContact = {
      nom: cellule('nom'), typeClient: TYPE_QUI_OUVRE_TOUT, adresse: cellule('adresse'), siren: cellule('siren'),
      siret: cellule('siret'), adresseElectronique: cellule('adresse_electronique'), codeService: cellule('code_service'),
      email: cellule('email'), delai: cellule('delai_paiement_jours'), observations: cellule('observations'),
    }
    return {
      numero: i + 1,
      ligneDuFichier: l.ligne,
      envoyee: { ...saisieQuiPart(saisie), type_client: type },
      typeNonReconnu: valeur != null && type == null ? valeur : null,
    }
  })
}

// ── L'aperçu ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface ApercuDeLImport {
  // Le refus de l'import ENTIER (aucune ligne ; plus de mille) : il passe avant tout, et l'aperçu ligne par ligne n'existe pas.
  refusDuFichier: RefusImportContacts | null
  lignes: { ligne: LigneAImporter; refus: RefusImportContacts | null }[]
  refusees: number
}

/**
 * L'aperçu, contre la liste des contacts LUE EN ENTIER (l'appelant ne demande rien sur une lecture partielle) : d'abord le
 * nombre de lignes (le refus du module : aucune, ou plus de mille), puis chaque ligne avec le refus que la base lui
 * opposerait (`refusDesLignes` : comme si les lignes refusées avant elle étaient ôtées). « Importer » ne s'offre que sans
 * aucun refus : la base range tout, ou rien.
 */
export function apercuDeLImport(
  dossierId: string,
  articleExoneration: ArticleExoneration | null,
  lignes: readonly LigneAImporter[],
  contactsDuDossier: readonly ContactPourSiret[],
): ApercuDeLImport {
  const refusDuFichier = refusDuNombreDeLignes(lignes.length)
  if (refusDuFichier) return { refusDuFichier, lignes: [], refusees: 0 }
  const refus = refusDesLignes(dossierId, articleExoneration, lignes.map((l) => l.envoyee), contactsDuDossier)
  return {
    refusDuFichier: null,
    lignes: lignes.map((ligne, i) => ({ ligne, refus: refus[i] })),
    refusees: refus.filter((r) => r != null).length,
  }
}
