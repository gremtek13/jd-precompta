import { nomDansUnRefus, sansBlancsAuxBords } from './articles'
import { CATEGORIE_ENTREPRENEUR_INDIVIDUEL, categorieJuridique } from './categoriesJuridiques'
import { commeLaBaseLaRecoit } from './contacts'
import { MOYENS_ENCAISSEMENT, remplirModele } from './encaissementsFactures'
import { CHAMPS_DU_LOGO, LOGO_DES_FACTURES_EXPORTE, REFUS_DU_LOGO, refusDuLogo, type CleRefusDuLogo, type FichierDuSeau } from './logoDesFactures'
import type { EtatRib, MoyenEncaissement, ParametresFacturation } from './types'

// LES PARAMÈTRES DE FACTURATION D'UN DOSSIER (espace client, étape A5a ; conception : HISTORIQUE.md, « L'ESPACE CLIENT,
// LOGICIEL DE GESTION DU CLIENT : LE PREMIER GROUPE, LA PARITÉ, ET AU-DELÀ », §A.5.1 et §A.5.2). Un module PUR — il ne lit
// rien en base, n'appelle personne, ne lit pas l'horloge — que les écrans de l'étape A5b liront : ce que
// `enregistrer_parametres_facturation` et `confirmer_rib` refuseraient, dans LEUR ordre et sous LEURS mots, dit avant le
// clic ; la version COURANTE d'un dossier, déduite de la chaîne ; le RIB qu'une facture verrait ; ce qu'une version dit
// d'elle-même ; les mentions proposées (MEG1-Q13) ; ce que les contraintes de l'identité légale du dossier refuseraient.
//
// CE QU'UNE VERSION EST. Ce que les factures du dossier proposeront ou imprimeront de ses conditions — le délai de paiement,
// le moyen proposé, les conditions d'escompte, les pénalités de retard, des mentions complémentaires, un pied de page — et
// le RIB imprimé (IBAN, BIC, titulaire). Une saisie nouvelle REMPLACE la courante (`remplace_id`, une chaîne par dossier) ;
// rien ne se modifie, sauf le RIB PROPOSÉ de la courante, que le cabinet confirme. Depuis l'étape A7 (la base, A7a ; l'écran,
// A7b), la validation d'une facture fige la courante et le RIB confirmé en vigueur (lib/mentionsFigees.ts), et l'aperçu les
// imprime.

// ── Est-ce en base ? ──────────────────────────────────────────────────────────────────────────────────────────────────
// La migration `parametres_facturation` OUVRE au client qui porte la case « Ventes » la lecture d'une table et une
// fonction : présentée au cabinet, elle a été appliquée sur son accord, et l'export (supabase/schema) la porte. Ce drapeau
// est donc levé : le plan de sauvegarde compte la table (src/lib/sauvegarde.ts), la phrase de l'onglet Accès dit ce que la
// case « Ventes » ouvre de plus (src/lib/droitsAcces.ts) ; aucun écran ne la lit encore (l'étape A5b).
// parametresFacturation.test.ts confronte ce drapeau à l'export, et les refus ci-dessous au texte même des fonctions comme
// à l'essai supabase/essais/parametresFacturation.sql. Un retour arrière de la migration ne viendrait qu'APRÈS le drapeau
// rebaissé en ligne : sinon chaque sauvegarde lirait une table absente.
export const PARAMETRES_FACTURATION_EXPORTES: boolean = true

// ── Les hypothèses nommées (MEG1-Q12 à Q14) ─────────────────────────────────────────────────────────────────────────
// Les recommandations de la conception, prises en attendant la réponse du cabinet ; parametresFacturation.test.ts
// confronte chacune à l'essai et, le jour où l'export porte la migration, à son en-tête. Ce qui changerait si le cabinet
// répondait autrement est dit pour chacune.
export const HYPOTHESES_DES_PARAMETRES_FACTURATION = {
  // La parade à la fraude au faux RIB : un RIB posé ou changé par un client « Ventes » reste PROPOSÉ — les factures gardent
  // le RIB confirmé d'avant — et seul le cabinet le confirme ; posé par le cabinet, il est confirmé d'emblée. Autrement, la
  // fonction n'aurait plus d'état à déduire et `confirmer_rib` disparaîtrait. Que le changement soit DIT au cabinet et aux
  // accès « Ventes » et « Banque » est l'affaire des écrans (étape A5b).
  'MEG1-Q12': 'le client « Ventes » propose le RIB, le cabinet le confirme',
  // Les mentions proposées entre professionnels : ici seulement, jamais en base (`PROPOSITIONS_PAR_DEFAUT`).
  'MEG1-Q13': 'pénalités au taux de la BCE majoré de dix points, pas d’escompte, trente jours',
  // L'identité légale imprimée : réglée par le cabinet seul (la policy `dossiers_update`), rien d'imposé tant que la forme
  // juridique n'est pas connue. Autrement, une fonction ouverte au client « Ventes » l'écrirait.
  'MEG1-Q14': 'l’identité légale, réglée par le cabinet seul',
} as const

// ── Les valeurs de la base, confrontées à l'essai et au texte de la migration par le test ───────────────────────────
// Des bornes TECHNIQUES, sauf le délai et le titulaire : aucun texte ne borne un escompte, des pénalités, des mentions ou un
// pied de page.
export const ESCOMPTE_MAX = 300
export const PENALITES_MAX = 300
export const MENTIONS_MAX = 1000
export const PIED_DE_PAGE_MAX = 500
// Le nom du bénéficiaire d'un virement SEPA (EPC069-12 v3.0, AT-21) : soixante-dix caractères.
export const TITULAIRE_MAX = 70
// C. com., art. L441-10, I : soixante jours après l'émission de la facture — comme le délai d'un contact.
export const DELAI_MAX_JOURS = 60

// Les champs d'une version, dans l'ordre où `enregistrer_parametres_facturation` les admet ; aucun autre (une clé inconnue
// est REFUSÉE, nommée). Le type les tient tous : un champ de la saisie oublié ici ne compile pas.
const CHAMPS: Record<keyof ParametresEnvoyes, true> = {
  delai_paiement_jours: true, moyen_prefere: true, escompte: true, penalites: true, mentions_complementaires: true,
  pied_de_page: true, iban: true, bic: true, titulaire_compte: true,
}
export const CHAMPS_DES_PARAMETRES = Object.keys(CHAMPS) as readonly (keyof ParametresEnvoyes)[]

// Le moyen proposé : l'un des huit du registre des encaissements (`encaissements_factures_moyen`), dans son ordre.
export const MOYENS_PROPOSABLES: readonly MoyenEncaissement[] = MOYENS_ENCAISSEMENT.map((m) => m.moyen)

// L'IBAN sous sa forme électronique, celle du type `IBAN2007Identifier` de l'ISO 20022 (ISO 13616), les lettres en
// majuscules ; le BIC, celle du type `BICFIDec2014Identifier` (ISO 9362:2014). Les mêmes que la table et la fonction.
export const FORME_IBAN = /^[A-Z]{2}[0-9]{2}[A-Z0-9]{1,30}$/
export const FORME_BIC = /^[A-Z0-9]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/

/**
 * La clé d'un IBAN (ISO 13616, par l'ISO/IEC 7064 MOD 97-10) : les quatre premiers caractères passent à la fin, chaque
 * lettre devient deux chiffres (A = 10 … Z = 35), et le nombre, divisé par 97, laisse 1 — calculé de proche en proche, sans
 * jamais former le grand nombre. Faux pour un texte qui n'a pas la forme électronique.
 */
export function cleIbanValide(iban: string): boolean {
  if (!FORME_IBAN.test(iban)) return false
  let reste = 0
  for (const c of iban.slice(4) + iban.slice(0, 4)) {
    const chiffres = c <= '9' ? c : String(c.charCodeAt(0) - 55)
    for (const d of chiffres) reste = (reste * 10 + Number(d)) % 97
  }
  return reste === 1
}

// ── Un IBAN dans un texte libre (A7-Q3) ───────────────────────────────────────────────────────────────────────────
// La réponse (B) du cabinet du 28/10/2026 : un texte libre que la facture imprime sans confirmation et qui porte un IBAN
// VALIDE se refuse, en base et avant le clic, quel que soit son auteur — un IBAN ne s'imprime que par le RIB confirmé
// (MEG1-Q12), et un pied de page garderait l'ancien après un changement de RIB. La base le juge par `porte_un_iban`
// (migration `mentions_figees`), et ce module le redit au caractère près. Un IBAN se reconnaît à sa CLÉ (`cleIbanValide`),
// jamais à sa seule forme ; ce qu'on soumet à la clé, ce sont les CANDIDATS du texte, une fois ses vingt-six lettres
// minuscules passées en capitales (elles seules : une lettre accentuée, un chiffre d'une autre écriture séparent) et le
// texte découpé en MOTS, les suites de lettres latines et de chiffres :
//   - la forme électronique : un mot de quinze à trente-quatre caractères qui commence par deux lettres et deux chiffres
//     (quinze, l'IBAN le plus court du registre de l'ISO 13616, la Norvège ; trente-quatre, la borne de la norme) ;
//   - la forme papier, des groupes de quatre séparés d'un seul blanc, le dernier plus court (ISO 13616-1) : depuis un mot
//     de deux lettres et deux chiffres, chaque mot qui suit après UN blanc (`\s`) et qui n'a pas plus de quatre caractères
//     s'ajoute ; la suite est candidate à chaque groupe, de quinze à trente-quatre caractères, et un mot de moins de quatre
//     la clôt.
// Ne se lisent pas : un IBAN collé à un mot, ses groupes séparés de tirets, de deux blancs ou autrement qu'en quatre, un
// RIB à l'ancienne (sans code pays). Les lire ferait refuser des textes qui n'en portent pas. src/lib/parametresFacturationIban.test.ts
// confronte le module à la base sur les cas de supabase/essais/mentionsFigees.sql.
export const IBAN_LONGUEUR_MIN = 15
export const IBAN_LONGUEUR_MAX = 34
const SIGNE_D_IBAN = /^[A-Z0-9]$/
const DEBUT_D_IBAN = /^[A-Z]{2}[0-9]{2}/
const GROUPE_DE_TETE = /^[A-Z]{2}[0-9]{2}$/
const UN_BLANC = /^\s$/u

/** Ce que le texte soumet à la clé d'un IBAN, dans l'ordre où la base les essaie. */
export function candidatsIban(texte: string): string[] {
  const capitales = texte.replace(/[a-z]/g, (c) => c.toUpperCase())
  const mots: string[] = []
  // Ce qui sépare chaque mot du précédent (vide pour un mot en tête du texte).
  const avant: string[] = []
  let mot = ''
  let entre = ''
  for (const c of capitales) {
    if (SIGNE_D_IBAN.test(c)) {
      mot += c
    } else {
      if (mot !== '') {
        mots.push(mot)
        avant.push(entre)
        mot = ''
        entre = ''
      }
      entre += c
    }
  }
  if (mot !== '') {
    mots.push(mot)
    avant.push(entre)
  }
  const candidats: string[] = []
  for (let i = 0; i < mots.length; i++) {
    if (mots[i].length >= IBAN_LONGUEUR_MIN && mots[i].length <= IBAN_LONGUEUR_MAX && DEBUT_D_IBAN.test(mots[i])) candidats.push(mots[i])
    if (!GROUPE_DE_TETE.test(mots[i])) continue
    let candidat = mots[i]
    for (let j = i + 1; j < mots.length && Array.from(avant[j]).length === 1 && UN_BLANC.test(avant[j]) && mots[j].length <= 4; j++) {
      candidat += mots[j]
      if (candidat.length > IBAN_LONGUEUR_MAX) break
      if (candidat.length >= IBAN_LONGUEUR_MIN) candidats.push(candidat)
      if (mots[j].length < 4) break
    }
  }
  return candidats
}

/** Vrai quand le texte porte un IBAN valide (`porte_un_iban`) ; faux pour un texte absent. */
export function porteUnIban(texte: string | null | undefined): boolean {
  return texte != null && candidatsIban(texte).some(cleIbanValide)
}

// Le refus, le même dans `enregistrer_parametres_facturation` et dans `enregistrer_facture` : « % » nomme le texte.
export const MODELE_IBAN_DANS_UN_TEXTE = "Un IBAN figure dans % : sur une facture, un IBAN ne s'imprime que dans le RIB des "
  + 'paramètres de facturation, confirmé par le cabinet.'

// ── Les refus de la base, dans son ordre et sous ses mots ───────────────────────────────────────────────────────────
// La liste des `raise exception` de chaque fonction, dans l'ordre de son texte, avec son code (le test la confronte aux
// messages que l'essai exige de la base, et au texte exporté quand `PARAMETRES_FACTURATION_EXPORTES` est levé). Sept RANGS
// pour l'enregistrement, dix-sept messages : l'ordre de la conception — l'accès, la version remplacée encore courante, les
// longueurs, le délai, l'IBAN et le BIC —, et ce que l'état réel y ajoute à sa place (la saisie, un objet aux champs d'une
// version ; le moyen de paiement ; le titulaire). Le refus d'accès, seule la base le juge : l'écran n'existe que pour qui
// lit le dossier.
export const REFUS_ENREGISTREMENT_PARAMETRES = [
  { cle: 'acces', rang: 1, code: '42501', modele: 'Accès refusé à ce dossier.' },
  {
    cle: 'remplacee_d_un_autre_dossier', rang: 2, code: '22023',
    modele: "La version à remplacer n'est pas une version des paramètres de facturation de ce dossier.",
  },
  {
    cle: 'remplacee_pas_courante', rang: 2, code: '22023',
    modele: "D'autres paramètres de facturation ont été enregistrés entre-temps (le %) : relire avant d'enregistrer.",
  },
  { cle: 'saisie_pas_un_objet', rang: 3, code: '22023', modele: 'Les paramètres de facturation se donnent en un objet JSON, un champ par paramètre.' },
  { cle: 'champ_inconnu', rang: 3, code: '22023', modele: "Le champ « % » n'est pas un paramètre de facturation." },
  {
    cle: 'escompte', rang: 4, code: '22023',
    modele: "Les conditions d'escompte sont un texte de trois cents caractères au plus, qui ne soit pas vide.",
  },
  { cle: 'penalites', rang: 4, code: '22023', modele: 'Les pénalités de retard sont un texte de trois cents caractères au plus, qui ne soit pas vide.' },
  {
    cle: 'mentions_complementaires', rang: 4, code: '22023',
    modele: 'Les mentions complémentaires sont un texte de mille caractères au plus, qui ne soit pas vide.',
  },
  { cle: 'pied_de_page', rang: 4, code: '22023', modele: 'Le pied de page est un texte de cinq cents caractères au plus, qui ne soit pas vide.' },
  { cle: 'delai', rang: 5, code: '22023', modele: 'Le délai de paiement est un nombre entier de jours, de 0 à 60.' },
  { cle: 'moyen', rang: 6, code: '22023', modele: "Le moyen de paiement proposé est l'un des huit du registre des encaissements." },
  {
    cle: 'iban_forme', rang: 7, code: '22023',
    modele: "L'IBAN s'écrit sans espace, en majuscules : les deux lettres du pays, deux chiffres de contrôle, puis d'un à "
      + 'trente lettres ou chiffres.',
  },
  { cle: 'iban_cle', rang: 7, code: '22023', modele: "L'IBAN ne passe pas sa clé de contrôle : une erreur de saisie, sans doute." },
  { cle: 'bic_sans_iban', rang: 7, code: '22023', modele: "Un BIC se donne avec l'IBAN du compte." },
  {
    cle: 'bic_forme', rang: 7, code: '22023',
    modele: "Le BIC s'écrit en huit ou onze caractères, sans espace, en majuscules : quatre lettres ou chiffres, les deux "
      + 'lettres du pays, deux lettres ou chiffres, puis trois facultatifs.',
  },
  { cle: 'titulaire_sans_iban', rang: 7, code: '22023', modele: 'Le titulaire du compte se donne avec son IBAN.' },
  {
    cle: 'titulaire', rang: 7, code: '22023',
    modele: 'Le titulaire du compte est un texte de soixante-dix caractères au plus, qui ne soit pas vide.',
  },
] as const

// `confirmer_rib` : le cabinet du dossier seul ; puis la version, dans ce dossier ; la courante ; un RIB ; pas déjà confirmé.
export const REFUS_CONFIRMATION_RIB = [
  { cle: 'acces', rang: 1, code: '42501', modele: 'Accès refusé à ce dossier.' },
  { cle: 'introuvable', rang: 2, code: 'P0002', modele: 'Version des paramètres de facturation introuvable dans ce dossier.' },
  {
    cle: 'pas_courante', rang: 3, code: '22023',
    modele: "D'autres paramètres de facturation ont été enregistrés entre-temps (le %) : relire avant de confirmer le RIB.",
  },
  { cle: 'sans_rib', rang: 4, code: '22023', modele: "Cette version n'a pas de RIB à confirmer." },
  { cle: 'deja_confirme', rang: 5, code: '22023', modele: 'Le RIB de cette version est déjà confirmé.' },
] as const

// Le neuvième rang (A7-Q3, migration `iban_hors_des_parametres`) : un texte libre qui porte un IBAN, pour tout auteur, les
// quatre textes dans l'ordre du quatrième rang, chacun nommé dans le refus.
export const REFUS_DE_L_IBAN_DES_PARAMETRES = [
  { cle: 'iban_dans_un_texte', rang: 9, code: '22023', modele: MODELE_IBAN_DANS_UN_TEXTE },
] as const
export const TEXTES_SANS_IBAN: readonly { champ: 'escompte' | 'penalites' | 'mentions_complementaires' | 'pied_de_page'; libelle: string }[] = [
  { champ: 'escompte', libelle: "les conditions d'escompte" },
  { champ: 'penalites', libelle: 'les pénalités de retard' },
  { champ: 'mentions_complementaires', libelle: 'les mentions complémentaires' },
  { champ: 'pied_de_page', libelle: 'le pied de page' },
]

export type CleRefusEnregistrementParametres = (typeof REFUS_ENREGISTREMENT_PARAMETRES)[number]['cle'] | CleRefusDuLogo
  | (typeof REFUS_DE_L_IBAN_DES_PARAMETRES)[number]['cle']

/**
 * Les refus d'`enregistrer_parametres_facturation` dans l'ordre de son texte, selon que la base porte la migration du logo
 * (étape A5c1, `LOGO_DES_FACTURES_EXPORTE`) : sans elle, les dix-sept d'A5a ; avec elle, les mêmes puis les huit du logo, au
 * huitième rang (src/lib/logoDesFactures.ts), puis celui d'un IBAN dans un texte libre, au neuvième (A7-Q3 : la migration
 * `iban_hors_des_parametres`, qui suppose celle du logo). Une fonction, et non une constante : le test juge les deux états.
 */
export function refusDeLEnregistrement(logo: boolean): readonly { cle: CleRefusEnregistrementParametres; rang: number; code: string; modele: string }[] {
  return logo ? [...REFUS_ENREGISTREMENT_PARAMETRES, ...REFUS_DU_LOGO, ...REFUS_DE_L_IBAN_DES_PARAMETRES] : REFUS_ENREGISTREMENT_PARAMETRES
}

/** Les champs qu'admet la fonction : ceux d'une version, puis, la migration du logo en base, son chemin et son empreinte. */
export function champsAdmisParLaBase(logo: boolean): readonly string[] {
  return logo ? [...CHAMPS_DES_PARAMETRES, ...CHAMPS_DU_LOGO] : CHAMPS_DES_PARAMETRES
}
export type CleRefusConfirmationRib = (typeof REFUS_CONFIRMATION_RIB)[number]['cle']

export interface RefusParametres<C extends string> {
  cle: C
  message: string
}

function refusDe<C extends string>(liste: readonly { cle: C; modele: string }[], cle: C, valeurs: string[]): RefusParametres<C> {
  const { modele } = liste.find((r) => r.cle === cle) as { cle: C; modele: string }
  return { cle, message: remplirModele(modele, valeurs) }
}

// ── La chaîne des versions ──────────────────────────────────────────────────────────────────────────────────────────
/**
 * Ce qu'il faut d'une version pour suivre la chaîne de son dossier — et son logo, quand la lecture l'a rendu : un logo
 * inchangé ne se rejuge pas (src/lib/logoDesFactures.ts).
 */
export type VersionDeLaChaine = Pick<ParametresFacturation, 'id' | 'dossier_id' | 'remplace_id' | 'cree_le' | 'logo_chemin' | 'logo_sha256'>

/**
 * La version COURANTE des paramètres d'un dossier — celle qu'aucune ne remplace —, nulle quand le dossier n'en a aucune,
 * `rompue` quand les versions lues ne font pas UNE chaîne (une seule première, chaque version remplacée au plus une fois,
 * toutes atteintes depuis la première) : la base l'interdit, et une lecture partielle seule le produirait ; l'appelant ne
 * dit alors rien, ni courante, ni RIB.
 */
export function versionCourante<V extends VersionDeLaChaine>(versions: readonly V[], dossierId: string): V | null | 'rompue' {
  const duDossier = versions.filter((v) => v.dossier_id === dossierId)
  if (duDossier.length === 0) return null
  const parId = new Map(duDossier.map((v) => [v.id, v]))
  const premieres = duDossier.filter((v) => v.remplace_id === null)
  const suites = new Map<string, V>()
  for (const v of duDossier) {
    if (v.remplace_id === null) continue
    if (!parId.has(v.remplace_id) || suites.has(v.remplace_id)) return 'rompue'
    suites.set(v.remplace_id, v)
  }
  if (premieres.length !== 1 || parId.size !== duDossier.length) return 'rompue'
  // De la première, suite après suite : toutes les versions doivent être atteintes, une fois.
  let courante = premieres[0]
  let vues = 1
  for (let suite = suites.get(courante.id); suite; suite = suites.get(courante.id)) {
    courante = suite
    vues += 1
    if (vues > duDossier.length) return 'rompue'
  }
  return vues === duDossier.length ? courante : 'rompue'
}

// Le jour et l'heure À PARIS d'un instant, comme la base les écrit dans un refus (`to_char(… at time zone 'Europe/Paris',
// 'DD/MM/YYYY "à" HH24:MI')`), quel que soit le fuseau de qui regarde.
export function jourEtHeureAParis(instant: string): string {
  const parties = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(instant))
  const partie = (type: string) => parties.find((p) => p.type === type)?.value ?? ''
  return `${partie('day')}/${partie('month')}/${partie('year')} à ${partie('hour')}:${partie('minute')}`
}

// ── Lire la saisie comme la fonction la lit ─────────────────────────────────────────────────────────────────────────
// La saisie part en JSON : une clé `undefined` disparaît, NaN et l'infini deviennent `null` (`commeLaBaseLaRecoit`, le
// module des contacts). La fonction lit chaque champ par son TYPE JSON d'abord — un nombre n'est pas un texte, un texte
// n'est pas un nombre —, tient pour absent un champ nul, compte les caractères comme `char_length` (par point de code) et
// ne retire aux bords que les quatre blancs de `BLANCS`.
const estObjet = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const absent = (v: unknown) => v === undefined || v === null
const caracteres = (texte: string) => Array.from(texte).length
const texteJuste = (v: unknown, max: number) => typeof v === 'string' && sansBlancsAuxBords(v) !== '' && caracteres(v) <= max
const CHAMPS_ADMIS: ReadonlySet<string> = new Set(champsAdmisParLaBase(LOGO_DES_FACTURES_EXPORTE))

// L'ordre des OCTETS de la base (`collate "C"`, en UTF-8) est celui des POINTS DE CODE : une comparaison de chaînes
// JavaScript, qui compare des unités UTF-16, rangerait un caractère hors du plan de base avant U+E000 à U+FFFF. Le jumeau
// de `avantEnPointsDeCode` (src/lib/contactsImport.ts), que le test confronte à celui-ci.
export function avantEnPointsDeCode(a: string, b: string): number {
  const x = Array.from(a)
  const y = Array.from(b)
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const ecart = (x[i].codePointAt(0) as number) - (y[i].codePointAt(0) as number)
    if (ecart !== 0) return ecart
  }
  return x.length - y.length
}

/**
 * Ce qu'`enregistrer_parametres_facturation` refuserait : le PREMIER refus, dans l'ordre de la base et sous son message ;
 * null quand elle l'accepterait ; `rompue` quand les versions lues ne font pas une chaîne (le module ne dit alors rien).
 * `remplaceId` : la version que la saisie remplace — la courante, que l'écran a lue — ou null pour une première ;
 * `versionsDuDossier` : les versions du dossier LUES EN ENTIER — la courante s'y juge ; sur une lecture partielle,
 * l'appelant ne demande rien à ce module ; `fichiersDuSeau` : les fichiers du seau des ventes que l'appelant connaît
 * (celui qu'il vient de déposer), où la base cherche le logo — vide pour une saisie sans logo. La saisie est jugée telle
 * que la base la reçoit, après l'aller-retour JSON ; le logo, au huitième rang, seulement la migration du logo en base ; un
 * IBAN dans un texte libre, au neuvième (A7-Q3).
 */
export function refusEnregistrementParametres(
  dossierId: string,
  remplaceId: string | null,
  saisie: unknown,
  versionsDuDossier: readonly VersionDeLaChaine[],
  fichiersDuSeau: readonly FichierDuSeau[],
): RefusParametres<CleRefusEnregistrementParametres> | null | 'rompue' {
  const refus = (cle: CleRefusEnregistrementParametres, ...valeurs: string[]) => refusDe(refusDeLEnregistrement(true), cle, valeurs)
  // 2. La version remplacée : une version de ce dossier, et la courante — sinon la saisie passée entre-temps se nomme.
  const duDossier = versionsDuDossier.filter((v) => v.dossier_id === dossierId)
  if (remplaceId !== null && !duDossier.some((v) => v.id === remplaceId)) return refus('remplacee_d_un_autre_dossier')
  const courante = versionCourante(duDossier, dossierId)
  if (courante === 'rompue') return 'rompue'
  if (remplaceId !== (courante?.id ?? null)) {
    // Toujours une courante ici : une version remplacée nommée est du dossier, et une première manquée suppose la sienne.
    return refus('remplacee_pas_courante', jourEtHeureAParis((courante as VersionDeLaChaine).cree_le))
  }
  // 3. La saisie : un objet JSON, aux seuls champs d'une version — la première clé inconnue dans l'ordre des octets,
  // nommée, coupée comme un nom dans un refus.
  const recue = commeLaBaseLaRecoit(saisie)
  if (!estObjet(recue)) return refus('saisie_pas_un_objet')
  const inconnue = Object.keys(recue).filter((k) => !CHAMPS_ADMIS.has(k)).sort(avantEnPointsDeCode)[0]
  if (inconnue !== undefined) return refus('champ_inconnu', nomDansUnRefus(inconnue))
  // 4. Les textes, chacun s'il est donné.
  const textes: [CleRefusEnregistrementParametres, keyof ParametresEnvoyes, number][] = [
    ['escompte', 'escompte', ESCOMPTE_MAX], ['penalites', 'penalites', PENALITES_MAX],
    ['mentions_complementaires', 'mentions_complementaires', MENTIONS_MAX], ['pied_de_page', 'pied_de_page', PIED_DE_PAGE_MAX],
  ]
  for (const [cle, champ, max] of textes) if (!absent(recue[champ]) && !texteJuste(recue[champ], max)) return refus(cle)
  // 5. Le délai : un nombre entier de jours, de 0 à 60 ; 6. le moyen, l'un des huit.
  const delai = recue.delai_paiement_jours
  if (!absent(delai) && (typeof delai !== 'number' || !Number.isInteger(delai) || delai < 0 || delai > DELAI_MAX_JOURS)) {
    return refus('delai')
  }
  const moyen = recue.moyen_prefere
  if (!absent(moyen) && (typeof moyen !== 'string' || !(MOYENS_PROPOSABLES as readonly string[]).includes(moyen))) return refus('moyen')
  // 7. Le RIB : l'IBAN — sa forme, puis sa clé —, puis le BIC et le titulaire, qui ne se donnent qu'avec lui.
  const iban = recue.iban
  if (!absent(iban)) {
    if (typeof iban !== 'string' || !FORME_IBAN.test(iban)) return refus('iban_forme')
    if (!cleIbanValide(iban)) return refus('iban_cle')
  }
  const bic = recue.bic
  if (!absent(bic)) {
    if (absent(iban)) return refus('bic_sans_iban')
    if (typeof bic !== 'string' || !FORME_BIC.test(bic)) return refus('bic_forme')
  }
  const titulaire = recue.titulaire_compte
  if (!absent(titulaire)) {
    if (absent(iban)) return refus('titulaire_sans_iban')
    if (!texteJuste(titulaire, TITULAIRE_MAX)) return refus('titulaire')
  }
  // 8. Le logo (étape A5c1), la migration en base : sans elle, ses deux champs sont déjà refusés au rang 3.
  if (LOGO_DES_FACTURES_EXPORTE) {
    const logo = refusDuLogo(dossierId, courante, recue, fichiersDuSeau)
    if (logo) return refus(logo.cle, ...logo.valeurs)
  }
  // 9. Un IBAN dans un texte libre (A7-Q3), les quatre dans l'ordre du quatrième rang — chacun, s'il est donné, est ici un
  // texte que la base a accepté plus haut. Le module le dit avant le clic dès aujourd'hui, la décision du cabinet étant
  // prise ; la base le refusera la migration `iban_hors_des_parametres` appliquée : rien de neuf ne s'écrit ni ne se lit.
  for (const { champ, libelle } of TEXTES_SANS_IBAN) {
    const texte = recue[champ]
    if (typeof texte === 'string' && porteUnIban(texte)) return refus('iban_dans_un_texte', libelle)
  }
  return null
}

/** Ce qu'il faut d'une version pour juger la confirmation de son RIB. */
export type VersionAConfirmer = VersionDeLaChaine & Pick<ParametresFacturation, 'iban' | 'rib_etat'>

/**
 * Ce que `confirmer_rib` refuserait au cabinet ; null quand elle confirmerait le RIB de la version ; `rompue` sur une
 * chaîne qui n'en est pas une. Le client ne confirme jamais : la base lui rend « Accès refusé », et l'écran ne lui offre
 * pas le geste.
 */
export function refusConfirmationRib(
  dossierId: string,
  versionId: string,
  versionsDuDossier: readonly VersionAConfirmer[],
): RefusParametres<CleRefusConfirmationRib> | null | 'rompue' {
  const refus = (cle: CleRefusConfirmationRib, ...valeurs: string[]) => refusDe(REFUS_CONFIRMATION_RIB, cle, valeurs)
  const duDossier = versionsDuDossier.filter((v) => v.dossier_id === dossierId)
  const version = duDossier.find((v) => v.id === versionId)
  if (!version) return refus('introuvable')
  const courante = versionCourante(duDossier, dossierId)
  if (courante === 'rompue') return 'rompue'
  if (courante?.id !== version.id) return refus('pas_courante', jourEtHeureAParis((courante as VersionAConfirmer).cree_le))
  if (version.iban === null) return refus('sans_rib')
  if (version.rib_etat === 'confirme') return refus('deja_confirme')
  return null
}

// ── L'état du RIB (MEG1-Q12, hypothèse) ─────────────────────────────────────────────────────────────────────────────
/** Ce qu'il faut d'une version pour dire son RIB. */
export type VersionDuRib = VersionDeLaChaine
  & Pick<ParametresFacturation, 'iban' | 'bic' | 'titulaire_compte' | 'rib_etat' | 'rib_confirme_par' | 'rib_confirme_le' | 'auteur'>

/**
 * L'état que la base donnera au RIB d'une saisie qu'elle accepte, enregistrée sur la courante (nulle pour une première) :
 * `aucun` sans IBAN ; `inchange` quand l'IBAN, le BIC et le titulaire sont ceux de la courante — le RIB garde alors son
 * état ET sa confirmation, même quand le cabinet réenregistre : un RIB proposé ne se confirme jamais en passant ;
 * `confirme` quand le cabinet du dossier (`admin_du_dossier`) le pose ou le change ; `propose` quand un client « Ventes »
 * le pose ou le change — les factures gardent alors le RIB confirmé d'avant. `etat` est celui qu'aura la version écrite.
 */
export function etatDuRibEnregistre(
  courante: Pick<ParametresFacturation, 'iban' | 'bic' | 'titulaire_compte' | 'rib_etat'> | null,
  saisieAcceptee: unknown,
  cabinet: boolean,
): { quoi: 'aucun' | 'inchange' | 'confirme' | 'propose'; etat: EtatRib | null } {
  const recue = commeLaBaseLaRecoit(saisieAcceptee)
  const valeur = (cle: string) => {
    const v = estObjet(recue) ? recue[cle] : undefined
    return typeof v === 'string' ? v : null
  }
  const iban = valeur('iban')
  if (iban === null) return { quoi: 'aucun', etat: null }
  if (courante && iban === courante.iban && valeur('bic') === courante.bic && valeur('titulaire_compte') === courante.titulaire_compte) {
    return { quoi: 'inchange', etat: courante.rib_etat }
  }
  return cabinet ? { quoi: 'confirme', etat: 'confirme' } : { quoi: 'propose', etat: 'propose' }
}

/** Le RIB qu'une facture verrait : celui d'une version, avec son état confirmé. */
export interface RibEnVigueur {
  iban: string
  bic: string | null
  titulaire_compte: string | null
  // La version qui le porte, et qui l'a confirmé et quand.
  version: string
  rib_confirme_par: string | null
  rib_confirme_le: string | null
}

/**
 * Le RIB qu'une facture verrait (l'étape A7, qui le figera sur chaque facture validée, le lira de même) : celui de la
 * version courante s'il est confirmé ; sinon, en remontant la chaîne au-delà des versions où il n'est que PROPOSÉ, celui de
 * la première version qui en a un confirmé — ou aucun, quand cette version n'en a pas, ou quand toute la chaîne n'est que
 * proposée. `rompue` sur une chaîne qui n'en est pas une : l'appelant ne dit alors aucun RIB.
 */
export function ribEnVigueur(versions: readonly VersionDuRib[], dossierId: string): RibEnVigueur | null | 'rompue' {
  const duDossier = versions.filter((v) => v.dossier_id === dossierId)
  const courante = versionCourante(duDossier, dossierId)
  if (courante === 'rompue') return 'rompue'
  const parId = new Map(duDossier.map((v) => [v.id, v]))
  for (let v: VersionDuRib | undefined = courante ?? undefined; v; v = v.remplace_id === null ? undefined : parId.get(v.remplace_id)) {
    if (v.rib_etat === 'propose') continue
    if (v.iban === null || v.rib_etat !== 'confirme') return null
    return {
      iban: v.iban, bic: v.bic, titulaire_compte: v.titulaire_compte, version: v.id, rib_confirme_par: v.rib_confirme_par,
      rib_confirme_le: v.rib_confirme_le,
    }
  }
  return null
}

/** Qui a fait un geste, et quand : un identifiant de compte et un instant, tels que la base les a écrits. */
export interface Geste {
  parQui: string
  le: string
}

/** Ce qu'une version dit de son RIB : aucun ; proposé, et par quel geste ; confirmé, et par quels gestes. */
export type CeQueDitLeRib =
  | { rib: 'aucun' }
  | { rib: 'propose'; pose: Geste }
  // `dUnMemeGeste` : posé et confirmé d'un même geste — le cabinet qui l'a posé ; sinon, confirmé ensuite (`confirmer_rib`).
  | { rib: 'confirme'; pose: Geste; confirme: Geste; dUnMemeGeste: boolean }

/**
 * Ce qu'une version dit de son RIB, sans rien deviner, d'après les versions du dossier LUES EN ENTIER. Le RIB a été POSÉ
 * par la première version de la suite ininterrompue qui le porte tel quel (IBAN, BIC et titulaire) — les suivantes l'ont
 * repris, avec son état et sa confirmation, même enregistrées par un autre : l'auteur d'une version n'est donc pas
 * toujours celui qui a posé son RIB. La confirmation dit qui et quand ; d'un même geste quand elle est datée de l'instant
 * où le RIB a été posé, par son auteur. `rompue` sur une chaîne qui n'en est pas une ; null pour une version absente. Dire
 * si un compte est le cabinet ou le client est l'affaire de l'écran, sur des accès lus en entier (le patron de « par le
 * client »).
 */
export function ceQueDitLeRib(versions: readonly VersionDuRib[], dossierId: string, versionId: string): CeQueDitLeRib | null | 'rompue' {
  const duDossier = versions.filter((v) => v.dossier_id === dossierId)
  if (versionCourante(duDossier, dossierId) === 'rompue') return 'rompue'
  const parId = new Map(duDossier.map((v) => [v.id, v]))
  const version = parId.get(versionId)
  if (!version) return null
  if (version.iban === null || version.rib_etat === null) return { rib: 'aucun' }
  const memeRib = (a: VersionDuRib) => a.iban === version.iban && a.bic === version.bic && a.titulaire_compte === version.titulaire_compte
  const precedente = (v: VersionDuRib) => (v.remplace_id === null ? undefined : parId.get(v.remplace_id))
  let posee = version
  for (let p = precedente(posee); p && memeRib(p); p = precedente(p)) posee = p
  const pose = { parQui: posee.auteur, le: posee.cree_le }
  if (version.rib_etat === 'propose' || version.rib_confirme_par === null || version.rib_confirme_le === null) return { rib: 'propose', pose }
  const confirme = { parQui: version.rib_confirme_par, le: version.rib_confirme_le }
  return { rib: 'confirme', pose, confirme, dUnMemeGeste: confirme.le === pose.le && confirme.parQui === pose.parQui }
}

// ── Les mentions proposées (MEG1-Q13, hypothèse) ────────────────────────────────────────────────────────────────────
// Entre professionnels, la facture mentionne la date de règlement, les conditions d'escompte et le taux des pénalités de
// retard (C. com., art. L441-9, I) ; sauf stipulation contraire, les pénalités valent le taux de la Banque centrale
// européenne à son opération de refinancement la plus récente majoré de dix points de pourcentage (art. L441-10, II ;
// version au 01/01/2027 NON VÉRIFIÉE). Ce que l'écran PROPOSERA (étape A5b), jamais ce qu'une version porte d'office :
// chacune est une saisie que la base accepte (le test le vérifie). L'indemnité forfaitaire de 40 € (art. D441-5) est un
// montant que la loi fixe : aucun paramètre, l'étape A7 l'imprimera.
export const PROPOSITIONS_PAR_DEFAUT = {
  delai_paiement_jours: 30,
  escompte: "Pas d'escompte pour paiement anticipé.",
  penalites: "Pénalités de retard : taux d'intérêt appliqué par la Banque centrale européenne à son opération de "
    + 'refinancement la plus récente, majoré de 10 points de pourcentage (C. com., art. L441-10, II).',
} as const

// ── La saisie telle qu'elle part ────────────────────────────────────────────────────────────────────────────────────
/** Ce que le formulaire des paramètres (étape A5b) saisit, chaque champ en texte, le moyen choisi ou non. */
export interface SaisieParametresFacturation {
  delai: string
  moyen: MoyenEncaissement | ''
  escompte: string
  penalites: string
  mentions: string
  piedDePage: string
  iban: string
  bic: string
  titulaire: string
}

/** La saisie telle que la base la reçoit (`p_parametres`). */
export interface ParametresEnvoyes {
  // Un nombre lu tel qu'écrit ; le texte tel quel quand il n'en est pas un — la base le refuse alors, et le module avec elle.
  delai_paiement_jours: number | string | null
  moyen_prefere: MoyenEncaissement | null
  escompte: string | null
  penalites: string | null
  mentions_complementaires: string | null
  pied_de_page: string | null
  iban: string | null
  bic: string | null
  titulaire_compte: string | null
}

const sansAucunBlanc = (texte: string) => texte.replace(/\s/g, '')
const texteOuNul = (texte: string) => {
  const t = sansBlancsAuxBords(texte)
  return t === '' ? null : t
}
const identifiantOuNul = (texte: string) => sansAucunBlanc(texte).toUpperCase() || null

/**
 * La saisie telle qu'elle part : les blancs des bords retirés (ceux de la base, `BLANCS`), un champ vide envoyé nul ; un
 * IBAN et un BIC se tapent avec leurs espaces et en minuscules (« fr76 3000 … ») — ils partent sans aucun blanc et en
 * majuscules, leur forme électronique, la seule que la base range : un même RIB s'écrit ainsi d'une seule façon, ce que
 * la comparaison d'une version à la précédente exige. Le délai part en nombre quand il en est un, écrit en chiffres ;
 * sinon tel quel, et la base le refuse.
 */
export function saisieQuiPart(s: SaisieParametresFacturation): ParametresEnvoyes {
  const delai = sansBlancsAuxBords(s.delai)
  return {
    delai_paiement_jours: delai === '' ? null : /^\d+$/.test(delai) ? Number(delai) : delai,
    moyen_prefere: s.moyen === '' ? null : s.moyen,
    escompte: texteOuNul(s.escompte),
    penalites: texteOuNul(s.penalites),
    mentions_complementaires: texteOuNul(s.mentions),
    pied_de_page: texteOuNul(s.piedDePage),
    iban: identifiantOuNul(s.iban),
    bic: identifiantOuNul(s.bic),
    titulaire_compte: texteOuNul(s.titulaire),
  }
}

// ── L'identité légale du dossier (MEG1-Q14, hypothèse) ──────────────────────────────────────────────────────────────
// Quatre colonnes de `dossiers`, que le cabinet écrit comme les autres (la policy `dossiers_update`) : aucune fonction ne
// les juge, ce sont les CONTRAINTES de la table qui refusent (23514, sous leur nom), dans l'ordre où Postgres les vérifie
// — celui de leurs noms. Le module redit chacune avant le clic, sous des mots à lui, et nomme la contrainte.
export const DENOMINATION_MAX = 200
export const RCS_VILLE_MAX = 100
// Le capital : strictement positif, au centime, sous une borne TECHNIQUE (dix mille milliards d'euros, exclus).
export const CAPITAL_BORNE = 10_000_000_000_000

export const REFUS_IDENTITE_LEGALE = [
  {
    cle: 'capital_d_un_entrepreneur_individuel', contrainte: 'dossiers_capital_d_une_societe',
    message: "Un entrepreneur individuel n'a pas de capital social.",
  },
  {
    cle: 'capital', contrainte: 'dossiers_capital_forme',
    message: 'Le capital est un montant en euros, au centime, strictement positif.',
  },
  {
    cle: 'denomination', contrainte: 'dossiers_denomination_imprimee_forme',
    message: 'La dénomination imprimée est un texte de deux cents caractères au plus, qui ne soit pas vide.',
  },
  {
    cle: 'forme_juridique', contrainte: 'dossiers_forme_juridique_insee',
    message: "La forme juridique est une catégorie juridique de l'INSEE, à quatre chiffres.",
  },
  {
    cle: 'rcs_ville', contrainte: 'dossiers_rcs_ville_forme',
    message: 'La ville du greffe est un texte de cent caractères au plus, qui ne soit pas vide.',
  },
] as const

export type CleRefusIdentiteLegale = (typeof REFUS_IDENTITE_LEGALE)[number]['cle']

/** L'identité légale telle qu'elle part vers `dossiers` (chaque colonne nulle quand elle n'est pas donnée). */
export interface IdentiteLegale {
  denomination_imprimee: string | null
  rcs_ville: string | null
  forme_juridique: string | null
  capital: number | null
}

// Un montant au centime : deux décimales au plus, lues sur son écriture décimale (jamais par un calcul flottant).
const auCentime = (n: number) => /^\d+(\.\d{1,2})?$/.test(String(n))

/** Ce que les contraintes de `dossiers` refuseraient de cette identité : le premier refus, dans leur ordre, ou null. */
export function refusIdentiteLegale(identite: IdentiteLegale): { cle: CleRefusIdentiteLegale; contrainte: string; message: string } | null {
  const fautes = new Set<CleRefusIdentiteLegale>()
  const { denomination_imprimee: denomination, rcs_ville: ville, forme_juridique: forme, capital } = identite
  if (capital !== null && forme === CATEGORIE_ENTREPRENEUR_INDIVIDUEL) fautes.add('capital_d_un_entrepreneur_individuel')
  if (capital !== null && !(Number.isFinite(capital) && capital > 0 && capital < CAPITAL_BORNE && auCentime(capital))) fautes.add('capital')
  if (denomination !== null && !texteJuste(denomination, DENOMINATION_MAX)) fautes.add('denomination')
  if (forme !== null && categorieJuridique(forme) === null) fautes.add('forme_juridique')
  if (ville !== null && !texteJuste(ville, RCS_VILLE_MAX)) fautes.add('rcs_ville')
  const premiere = REFUS_IDENTITE_LEGALE.find((r) => fautes.has(r.cle))
  return premiere ? { cle: premiere.cle, contrainte: premiere.contrainte, message: premiere.message } : null
}

/**
 * La dénomination que l'écran PROPOSERA à un entrepreneur individuel : son nom suivi des initiales « EI » (C. com.,
 * art. R526-27 : précédé ou suivi immédiatement des mots « entrepreneur individuel » ou des initiales « EI ») — une
 * proposition, jamais une contrainte ; null pour une autre forme, ou un nom vide.
 */
export function denominationProposee(nom: string, forme: string | null): string | null {
  const t = sansBlancsAuxBords(nom)
  if (forme !== CATEGORIE_ENTREPRENEUR_INDIVIDUEL || t === '') return null
  return /(^|\s)EI$/.test(t) || /entrepreneur individuel$/i.test(t) ? t : `${t} EI`
}
