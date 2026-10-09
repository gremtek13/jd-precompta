import { centimesExacts } from './encaissementsFactures'
import { decimal, numeroAdmis, sirenDe, sirenValide, siretValide, TAUX_ADMIS } from './factureCii'

// LE STATUT « ENCAISSÉE » (212) D'UNE FACTURE ÉMISE, ÉCRIT POUR UNE PLATEFORME AGRÉÉE (ligne 28.5 de la feuille de
// route, étape d5). Un encaissement du registre — ou sa contre-passation — devient le message de cycle de vie qu'une
// API déposera sur la plateforme qui a reçu la facture (étapes d6 et d8) : la syntaxe CDAR de l'UN/CEFACT,
// CrossDomainAcknowledgementAndResponse, version D22B. La DGFiP ne nomme pas la version du CDAR (« UN/CEFACT SCRDM CI
// Cross Domain Application Response message », dossier général v3.2, § 3.6.4, note 102) ; elle retient D22B pour le CII
// (§ 3.6.3, note 100), et les 311 chemins de l'annexe 2 existent tous dans le schéma CDAR D22B, à un attribut informatif
// près (MDT-111-1). outils/facturation/cdar/valider.mjs fait juger les exemples de ce module par ce schéma.
//
// LE MODULE EST PUR : il ne lit rien en base, n'appelle personne, ne lit pas l'horloge. L'appelant lui donne
// l'encaissement et ses parts tels que le registre les garde (`encaissements_factures`, `encaissements_factures_taux`),
// la facture et ses lignes, l'instant du message, et LES CHOIX QUE LES SOURCES PUBLIQUES NE TRANCHENT PAS. Il ne juge
// ni SI le statut se déclare (`obligationEncaissee`), ni OÙ (`plateformeDeLaDeclaration`), ni si la base l'accepterait
// (`refusDeclaration`) : il dit ce que le message porterait, et ce qui l'empêche d'être écrit (`refusMessageEncaissee`).
//
// SES SOURCES SONT PUBLIQUES : les spécifications externes de la DGFiP v3.2 — l'annexe 2 (« Format sémantique FE CDV —
// Flux 6 », v2.3, onglets « CDV FE - CI ARM » et « Statuts ») pour les chemins, l'annexe 7 (« Règles de gestion »,
// v1.9) pour les règles G et P citées élément par élément — et la documentation publique de Sovos pour un second
// profil. Les normes AFNOR XP Z12-012 et XP Z12-013 ne s'utilisent pas (décision du cabinet du 07/10/2026). Or ces
// annexes décrivent le message que la PLATEFORME envoie à la plateforme de l'administration ; celui du fournisseur vers
// sa plateforme relève de la norme exclue. Ce que l'annexe ne peut pas dire de ce message-là est donc un PARAMÈTRE
// explicite, sans valeur par défaut, que le premier essai réel tranchera (`ChoixCdar`) :
//   1. l'identifiant de profil (MDT-3) ;
//   2. les blocs émetteur, créateur et destinataire(s) du message (MDG-9, MDG-16, MDG-23) — l'annexe exige un
//      matricule de plateforme pour l'émetteur (G7.54), qu'un logiciel de fournisseur n'a pas ;
//   3. la donnée qui porte la date d'encaissement : l'annexe n'en nomme aucune ainsi ; MDT-110 (la date du détail de
//      statut) et MDT-219 (une date dans la caractéristique) sont les deux candidates ;
//   4. le fuseau des horodatages au format 204, qui ne porte pas de décalage.
// Une cinquième donnée est requise sans que son sens pour ce message soit public : MDT-95, la date de réception de
// l'objet (la facture). L'appelant la donne (`receptionFacture`) ; d6 y passera l'instant où la transmission acceptée de
// la facture est partie.
//
// UN STATUT PAR ENCAISSEMENT : un message porte un seul document de réponse (MDT-74 à « false », P1.14), un seul détail
// de statut, et une caractéristique « MEN » par taux (G7.12, G7.45, P1.18). Une contre-passation est le même statut,
// de montants négatifs, avec son motif d'annulation (P1.15, P1.17).

// ── DÉBUT COPIE cdarEncaissee ────────────────────────────────────────────────────────────────────────────────────────
// Ce bloc sera recopié AU CARACTÈRE PRÈS dans les Edge Functions qui déposeront le statut (plateforme-agreee en d6,
// Super PDP en d8), APRÈS ceux de montantsFacture.ts, de statutTva.ts et de factureCii.ts, et après le bloc
// `centimesExacts` d'encaissementsFactures.ts : il ne nomme hors de lui que six exports du bloc factureCii (decimal,
// numeroAdmis, sirenDe, sirenValide, siretValide, TAUX_ADMIS) et `centimesExacts`, et rien du DOM ni de Node — Intl et
// les chaînes suffisent, et Deno les a. Ses noms privés portent la marque « Cdar » : la fonction qui le recevra a déjà
// ses `el`, `echapper`, `serialiser`, `NS`. cdarEncaisseeCopie.test.ts compile et exécute le bloc derrière ces quatre-là,
// et confronte ses noms à ceux des deux fonctions qui transmettent déjà une facture.

// Le statut et ce qui le désigne (annexe 2, onglet « Statuts » : 212 « Encaissée », objet « facture (Flux 2) » ;
// G7.09, G7.44).
export const CODE_STATUT_ENCAISSEE = '212'
export const LIBELLE_STATUT_ENCAISSEE = 'Encaissée'

// Le code du montant d'une caractéristique (MDT-207, G7.12 : « MEN : Montant encaissé (TTC) »).
export const CODE_MONTANT_ENCAISSE = 'MEN'

// Le type du document référencé (MDT-91) : « Pour un CDV sur facture e-invoicing (Flux 2), le code correspond à celui
// du type de la facture » (G7.15), et une facture de l'application est une facture commerciale (380, G1.01).
export const TYPE_FACTURE_CDAR = '380'

// Le code type de référence (MDT-97) d'un cycle de vie « sur une facture (e-invoicing) » (G7.14). Il ne suit pas le
// profil choisi : G7.14 le rattache à l'objet dont le message parle, et c'est la seule source publique qui en dise
// quelque chose.
export const REFERENCE_CDV_FACTURE = 'urn.cpro.gouv.fr:1p0:CDV:einvoicingF2'

// Le motif d'une contre-passation (MDT-126) : 2 000 caractères au plus, comme le registre le garde.
export const LONGUEUR_MAX_MOTIF_CDAR = 2000

// ── Les choix que les sources publiques ne tranchent pas ───────────────────────────────────────────────────────────

// 1. L'identifiant de profil (MDT-3), parmi ceux qu'une source publique nomme.
export const PROFILS_CDAR = [
  {
    identifiant: 'urn.cpro.gouv.fr:1p0:CDV:einvoicingF2',
    source: 'DGFiP, spécifications externes v3.2, annexe 7 v1.9, règle S1.06 (et G7.14) : le cycle de vie sur une '
      + 'facture, tel que la plateforme de l’administration le reçoit.',
  },
  {
    identifiant: 'urn:cpro.gouv.fr:1p0:CDV:invoice',
    source: 'Sovos, documentation publique « Lifecycle and use cases » (France), mise à jour du 31/08/2026 : le profil '
      + 'de son entrée.',
  },
] as const
export type ProfilCdar = (typeof PROFILS_CDAR)[number]['identifiant']

// 2. Une partie du message : son identifiant (MDT-19, MDT-38, MDT-57), le schéma de cet identifiant (MDT-18, MDT-37,
// MDT-56 ; ICD 6523, G1.73 : 0002 un SIREN, 0009 un SIRET, 0238 le matricule d'une plateforme), sa raison sociale
// (MDT-20, MDT-39, MDT-58) et son rôle (MDT-21, MDT-40, MDT-59 ; UNCL 3035, G7.01 : SE le vendeur, WK une plateforme
// ou une solution compatible, DFH la plateforme de l'administration). Les autres schémas et rôles de G1.73 et G7.01 ne
// désignent personne dans le statut d'un fournisseur.
export const SCHEMAS_PARTIE_CDAR = ['0002', '0009', '0238'] as const
export type SchemaPartieCdar = (typeof SCHEMAS_PARTIE_CDAR)[number]
export const ROLES_PARTIE_CDAR = ['SE', 'WK', 'DFH'] as const
export type RolePartieCdar = (typeof ROLES_PARTIE_CDAR)[number]

export interface PartieCdar {
  identifiant: string
  schema: SchemaPartieCdar
  // Obligatoire, sauf pour une plateforme (WK) ou celle de l'administration (DFH) (G7.46).
  nom: string | null
  role: RolePartieCdar
}

// 3. La donnée qui porte la date d'encaissement : la date du détail de statut (MDT-110, format 204), une date dans
// chaque caractéristique (MDT-219, format 102, MDT-220), ou les deux.
export const PORTEURS_DATE_ENCAISSEMENT = ['MDT-110', 'MDT-219', 'MDT-110 et MDT-219'] as const
export type PorteurDateEncaissement = (typeof PORTEURS_DATE_ENCAISSEMENT)[number]

// 4. Le fuseau dans lequel un INSTANT s'écrit au format 204 (AAAAMMJJHHMMSS, G7.06), qui ne dit pas le sien. Une
// date civile — celle de la facture, celle de l'encaissement — ne dépend d'aucun fuseau : elle s'écrit telle quelle.
export const FUSEAUX_CDAR = ['Europe/Paris', 'UTC'] as const
export type FuseauCdar = (typeof FUSEAUX_CDAR)[number]

export interface ChoixCdar {
  profil: ProfilCdar
  // MDG-9 : qui émet le message.
  emetteur: PartieCdar
  // MDG-16 : qui l'a créé.
  createur: PartieCdar
  // MDG-23 : à qui il est destiné ; un au moins.
  destinataires: readonly PartieCdar[]
  dateEncaissement: PorteurDateEncaissement
  fuseau: FuseauCdar
}

// ── Ce que le module lit ───────────────────────────────────────────────────────────────────────────────────────────

// Les colonnes que le message lit, sous leurs noms et leurs types en base : une ligne lue par une Edge Function s'y
// passe telle quelle. cdarEncaissee.test.ts vérifie, par le compilateur, que les types de types.ts s'y lisent.
export interface FacturePourCdar {
  id: string
  statut: 'brouillon' | 'validee'
  type: 'facture' | 'avoir'
  numero: string | null
  date_emission: string
  // Le SIRET de l'émetteur, figé par la facture à sa validation : son SIREN est celui que la facture a transmis.
  emetteur_siret: string | null
}

export interface LignePourCdar {
  facture_id: string
  taux_tva: number
}

export interface EncaissementPourCdar {
  id: string
  facture_id: string
  // AAAA-MM-JJ : la date de l'encaissement effectif, ou, pour une contre-passation, celle du décaissement.
  date_encaissement: string
  // En euros, au centime ; négatif pour une contre-passation, et pour elle seule.
  montant: number
  annule_id: string | null
  motif: string | null
  retire_le: string | null
}

export interface PartPourCdar {
  encaissement_id: string
  taux: number
  montant: number
}

export interface DonneesCdar {
  facture: FacturePourCdar
  // Les lignes de la facture, ou celles du dossier : le module ne garde que celles de SA facture.
  lignes: readonly LignePourCdar[]
  encaissement: EncaissementPourCdar
  // Les parts de l'encaissement, ou celles du dossier : le module ne garde que les siennes.
  parts: readonly PartPourCdar[]
  // MDT-4 : l'identifiant du message — celui de la déclaration réservée avant l'envoi.
  identifiant: string
  // MDT-8 et MDT-78 : l'instant où le message est créé, qui est celui où le statut est posé.
  maintenant: Date
  // MDT-95 : l'instant où la plateforme a reçu la facture.
  receptionFacture: Date
  choix: ChoixCdar
}

export type ResultatCdar = { xml: string; refus: [] } | { xml: null; refus: string[] }

// ── Les écritures du format ────────────────────────────────────────────────────────────────────────────────────────

// Un instant au format 204 (AAAAMMJJHHMMSS, G7.06), dans le fuseau choisi ; null s'il n'en est pas un, ou si le
// fuseau n'est pas l'un des deux (Intl lèverait sur un nom inconnu). Le calendrier et l'heure d'été sont ceux d'Intl,
// qui connaît le fuseau.
export function horodatage204(instant: Date, fuseau: FuseauCdar): string | null {
  if (!(FUSEAUX_CDAR as readonly string[]).includes(fuseau)) return null
  if (!(instant instanceof Date) || !Number.isFinite(instant.getTime())) return null
  const parties = new Intl.DateTimeFormat('en-CA', {
    timeZone: fuseau, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(instant)
  const partie = (type: string) => parties.find((p) => p.type === type)?.value ?? ''
  const texte = `${partie('year')}${partie('month')}${partie('day')}${partie('hour')}${partie('minute')}${partie('second')}`
  return /^\d{14}$/.test(texte) ? texte : null
}

// Une date civile AAAA-MM-JJ qui existe au calendrier, sans passer par une Date : elle n'a pas de fuseau.
function dateCivileCdar(iso: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return false
  const annee = Number(m[1])
  const mois = Number(m[2])
  const jour = Number(m[3])
  const bissextile = (annee % 4 === 0 && annee % 100 !== 0) || annee % 400 === 0
  const jours = [31, bissextile ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  // Un mois hors de 1 à 12 n'a pas d'entrée : `jour <= undefined` est faux.
  return jour >= 1 && jour <= jours[mois - 1]
}

// Une date civile au format 102 (AAAAMMJJ, MDT-220) ou 204, à minuit — la forme même que la plateforme de
// l'administration donne à une date sans heure en 204 (G1.114 : « MDT-100 : 19000101000000 »).
const date102Cdar = (iso: string) => iso.replace(/-/g, '')
const date204Cdar = (iso: string) => `${date102Cdar(iso)}000000`

// Pour les messages d'erreur : une date civile déjà vérifiée en JJ/MM/AAAA, un montant « 1200,50 € », un taux « 5,5 % ».
const jourLisibleCdar = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
const eurosLisiblesCdar = (centimes: number) => `${(centimes / 100).toFixed(2).replace('.', ',')} €`
const tauxLisibleCdar = (taux: number) => `${String(taux).replace('.', ',')} %`

// Des CARACTÈRES, comme la base les compte, pas des unités UTF-16 : un emoji en vaut deux pour String.length.
const caracteresCdar = (texte: string) => [...texte].length
// Vide pour la base : `btrim` sans second argument n'ôte que des espaces (U+0020).
const videCdar = (texte: string) => /^ *$/.test(texte)
const uneLigneCdar = (texte: string) => texte.replace(/\s+/g, ' ').trim()

// L'identifiant du message (MDT-4) : 50 caractères au plus. Sa forme n'a pas de règle publique ; on lui tient celle
// des identifiants de la DGFiP (G1.104) — lettres, chiffres, espace, « - », « + », « _ », « / » —, sans espace en tête,
// en fin ni doublé : un identifiant de déclaration (un UUID) la respecte toujours.
const IDENTIFIANT_MESSAGE_CDAR = /^[A-Za-z0-9 +_/-]{1,50}$/
function identifiantMessageAdmis(id: string): boolean {
  return IDENTIFIANT_MESSAGE_CDAR.test(id) && id.trim() === id && !id.includes('  ')
}

const LIBELLES_PARTIE_CDAR = {
  emetteur: { qui: 'L’émetteur du message', de: 'de l’émetteur du message' },
  createur: { qui: 'Le créateur du message', de: 'du créateur du message' },
  destinataire: { qui: 'Le destinataire du message', de: 'du destinataire du message' },
}

// Ce qui ne va pas dans une partie du message, d'après les règles de l'annexe 7. Une partie absente — un choix lu d'un
// JSON incomplet — se refuse : elle ne se devine pas.
function refusPartieCdar(p: PartieCdar | null | undefined, quelle: keyof typeof LIBELLES_PARTIE_CDAR): string[] {
  const { qui, de } = LIBELLES_PARTIE_CDAR[quelle]
  if (p == null) return [`${qui} manque.`]
  const refus: string[] = []
  if (!(SCHEMAS_PARTIE_CDAR as readonly string[]).includes(p.schema)) {
    refus.push(`${qui} a un schéma d’identifiant inconnu (${p.schema}) : 0002 (SIREN), 0009 (SIRET) ou 0238 (matricule d’une plateforme).`)
  } else if (p.schema === '0002' && !sirenValide(p.identifiant)) {
    refus.push(`${qui} est désigné par un SIREN qui n’en est pas un (neuf chiffres et leur clé).`)
  } else if (p.schema === '0009' && !siretValide(p.identifiant)) {
    refus.push(`${qui} est désigné par un SIRET qui n’en est pas un (quatorze chiffres et leur clé).`)
  } else if (p.schema === '0238' && !/^\d{4}$/.test(p.identifiant)) {
    refus.push(`${qui} est désigné par un matricule de plateforme qui n’a pas quatre chiffres.`)
  }
  if (!(ROLES_PARTIE_CDAR as readonly string[]).includes(p.role)) {
    refus.push(`${qui} a un rôle inconnu (${p.role}) : SE (le vendeur), WK (une plateforme) ou DFH (celle de l’administration).`)
  }
  const nom = p.nom == null ? '' : uneLigneCdar(p.nom)
  if (nom === '' && p.role !== 'WK' && p.role !== 'DFH') refus.push(`${qui} n’a pas de raison sociale : seule une plateforme peut s’en passer.`)
  if (caracteresCdar(nom) > 150) refus.push(`La raison sociale ${de} dépasse 150 caractères.`)
  return refus
}

/**
 * La partie du message qui désigne le vendeur de la facture : son SIREN (0002) ou son SIRET (0009), tirés de
 * l'émetteur que la facture a figé, sa raison sociale, et le rôle SE. Pour la plateforme de l'administration, le
 * créateur d'un statut est désigné par son SIREN quand la facture va à une entreprise, par son SIRET quand elle va à
 * un organisme public (G6.26) : le schéma reste un choix de l'appelant.
 */
export function partieVendeur(
  facture: { emetteur_nom: string | null; emetteur_siret: string | null },
  schema: '0002' | '0009',
): PartieCdar {
  const siret = (facture.emetteur_siret ?? '').replace(/\s/g, '')
  return {
    identifiant: schema === '0002' ? sirenDe(siret) ?? siret : siret,
    schema,
    nom: facture.emetteur_nom,
    role: 'SE',
  }
}

// ── Ce qui empêche d'écrire le message ─────────────────────────────────────────────────────────────────────────────

// Tout ce qui empêche d'écrire le message, une faute par refus, dans l'ordre où l'écran le dit ; vide quand il peut
// l'être.
export function refusMessageEncaissee(d: DonneesCdar): string[] {
  const { facture: f, encaissement: e, choix: c } = d
  const refus: string[] = []

  // L'encaissement et sa facture.
  if (e.retire_le != null) refus.push('Cet encaissement est retiré : il n’a jamais été déclaré, et ne se déclare plus.')
  if (e.facture_id !== f.id) refus.push('Cet encaissement n’est pas un encaissement de cette facture.')
  if (f.statut !== 'validee' || !f.numero) refus.push('Seul l’encaissement d’une facture validée se déclare.')
  else if (!numeroAdmis(f.numero)) {
    // G1.05, que MDT-87 suit.
    refus.push(`Le numéro ${f.numero} ne peut pas désigner la facture : 35 caractères au plus — chiffres, lettres, espace, « - », « + », « _ » et « / ».`)
  }
  if (f.type !== 'facture') refus.push('Un avoir ne reçoit pas le statut « Encaissée » : seule une facture le reçoit.')
  if (!dateCivileCdar(f.date_emission)) refus.push(`La date d’émission de la facture (${f.date_emission}) n’est pas une date.`)

  // Le vendeur, qui a émis la facture (MDT-129, G7.17).
  if (!sirenValide(sirenDe(f.emetteur_siret))) {
    refus.push('Le SIRET du dossier, figé sur la facture, ne donne pas un SIREN valide (neuf chiffres et leur clé).')
  }

  // Le montant, son signe et son motif (P1.15, P1.17). Il se lit sur son écriture (`centimesExacts`), jamais par
  // `decimal` : multiplié par cent en virgule flottante, un montant au centime s'en écarte, à partir de 2²⁷ ≈ 134
  // millions d'euros, de plus que sa tolérance fixe, et `decimal` en refusait à tort un sur dix (mesuré par décade
  // jusqu'à dix mille milliards).
  const montant = centimesExacts(e.montant)
  const contrePassation = e.annule_id != null
  if (montant == null) refus.push('Le montant de l’encaissement ne s’écrit pas au centime.')
  else if (montant === 0) refus.push('Un encaissement nul ne se déclare pas.')
  else if ((montant < 0) !== contrePassation) {
    refus.push('Le registre se contredit : un encaissement est positif, et seule une contre-passation est négative.')
  }
  if (contrePassation) {
    if (e.motif == null || videCdar(e.motif)) refus.push('Une contre-passation porte son motif d’annulation : il manque.')
    else if (caracteresCdar(e.motif) > LONGUEUR_MAX_MOTIF_CDAR) refus.push('Le motif de la contre-passation dépasse 2 000 caractères.')
  } else if (e.motif != null) {
    refus.push('Le registre se contredit : un encaissement ne porte pas de motif, seule une contre-passation en a un.')
  }

  // La date de l'encaissement : une date civile, déjà arrivée à Paris quand le message part.
  const parisMaintenant = horodatage204(d.maintenant, 'Europe/Paris')
  if (!dateCivileCdar(e.date_encaissement)) refus.push('La date de l’encaissement n’est pas une date.')
  else if (parisMaintenant != null && date102Cdar(e.date_encaissement) > parisMaintenant.slice(0, 8)) {
    refus.push(`L’encaissement est daté du ${jourLisibleCdar(e.date_encaissement)}, qui n’est pas encore arrivé quand le message part.`)
  }

  // La répartition par taux (G7.45, G1.24, P1.18) : les parts de CET encaissement, chacune à un taux admis et de la
  // facture, une seule fois, au centime, du signe de l'encaissement ; leur somme fait le montant.
  const parts = d.parts.filter((p) => p.encaissement_id === e.id)
  const lignes = d.lignes.filter((l) => l.facture_id === f.id)
  if (parts.length === 0) refus.push('L’encaissement n’a pas de répartition par taux : la plateforme de l’administration rejetterait le statut.')
  let somme = 0
  let sommeLisible = true
  parts.forEach((p, i) => {
    const taux = tauxLisibleCdar(p.taux)
    if (!TAUX_ADMIS.includes(p.taux)) refus.push(`La part à ${taux} : ce taux n’est pas un taux de TVA admis.`)
    else if (!lignes.some((l) => l.taux_tva === p.taux)) refus.push(`La part à ${taux} : ce taux n’est pas un taux de la facture.`)
    if (parts.slice(0, i).some((q) => q.taux === p.taux)) refus.push(`Le taux de ${taux} figure deux fois dans la répartition.`)
    const part = centimesExacts(p.montant)
    if (part == null) {
      refus.push(`La part à ${taux} ne s’écrit pas au centime.`)
      sommeLisible = false
    } else {
      if (part === 0) refus.push(`La part à ${taux} est nulle.`)
      else if (montant != null && montant !== 0 && (part < 0) !== (montant < 0)) refus.push(`La part à ${taux} n’est pas du signe de l’encaissement.`)
      somme += part
    }
  })
  // Une répartition d'un encaissement nul ne fait rien : sa faute est déjà dite.
  if (parts.length > 0 && sommeLisible && montant != null && montant !== 0 && somme !== montant) {
    refus.push(`La répartition (${eurosLisiblesCdar(somme)}) ne fait pas le montant de l’encaissement (${eurosLisiblesCdar(montant)}).`)
  }

  // Le message : son identifiant, et deux instants qui s'écrivent dans le fuseau choisi et se comparent à Paris.
  if (!identifiantMessageAdmis(d.identifiant)) {
    refus.push('L’identifiant du message est vide, dépasse 50 caractères ou porte un caractère que la plateforme n’admettrait pas.')
  }
  const fuseauConnu = (FUSEAUX_CDAR as readonly string[]).includes(c.fuseau)
  const instant = (x: Date) => horodatage204(x, 'Europe/Paris') != null && (!fuseauConnu || horodatage204(x, c.fuseau) != null)
  const maintenantValide = instant(d.maintenant)
  if (!maintenantValide) refus.push('L’instant du message n’est pas un instant.')
  if (!instant(d.receptionFacture)) refus.push('La réception de la facture par la plateforme n’est pas un instant.')
  else {
    if (maintenantValide && d.receptionFacture.getTime() > d.maintenant.getTime()) {
      refus.push('La plateforme aurait reçu la facture après le message de son statut.')
    }
    const parisReception = horodatage204(d.receptionFacture, 'Europe/Paris') as string
    if (dateCivileCdar(f.date_emission) && parisReception.slice(0, 8) < date102Cdar(f.date_emission)) {
      refus.push('La plateforme aurait reçu la facture avant sa date d’émission.')
    }
  }

  // Les choix (ChoixCdar) : chacun parmi ceux que le module connaît.
  if (!PROFILS_CDAR.some((p) => p.identifiant === c.profil)) refus.push(`Le profil ${c.profil} n’est pas l’un de ceux que les sources publiques nomment.`)
  if (!(PORTEURS_DATE_ENCAISSEMENT as readonly string[]).includes(c.dateEncaissement)) {
    refus.push(`La donnée qui porterait la date de l’encaissement (${c.dateEncaissement}) n’est ni MDT-110 ni MDT-219.`)
  }
  if (!fuseauConnu) refus.push(`Le fuseau ${c.fuseau} n’est ni Europe/Paris ni UTC.`)
  refus.push(...refusPartieCdar(c.emetteur, 'emetteur'), ...refusPartieCdar(c.createur, 'createur'))
  const destinataires = Array.isArray(c.destinataires) ? c.destinataires : []
  if (destinataires.length === 0) refus.push('Le message n’a pas de destinataire.')
  for (const p of destinataires) refus.push(...refusPartieCdar(p, 'destinataire'))

  return refus
}

// ── Écriture ───────────────────────────────────────────────────────────────────────────────────────────────────────

const NS_CDAR = {
  rsm: 'urn:un:unece:uncefact:data:standard:CrossDomainAcknowledgementAndResponse:100',
  qdt: 'urn:un:unece:uncefact:data:standard:QualifiedDataType:100',
  ram: 'urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100',
  udt: 'urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100',
} as const

interface NoeudCdar {
  nom: string
  attributs?: Record<string, string>
  texte?: string
  enfants?: (NoeudCdar | null)[]
}

// Les caractères que XML 1.0 n'admet pas sont retirés, les autres échappés. factureCii.ts a le sien, privé à son bloc :
// l'exporter changerait un bloc que deux fonctions déployées recopient au caractère près.
function echapperCdar(t: string): string {
  return t
    .replace(/[^\t\n\r\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function elCdar(nom: string, contenu: string | (NoeudCdar | null)[], attributs?: Record<string, string>): NoeudCdar {
  return typeof contenu === 'string' ? { nom, attributs, texte: contenu } : { nom, attributs, enfants: contenu }
}

function serialiserCdar(n: NoeudCdar, profondeur: number): string {
  const retrait = '  '.repeat(profondeur)
  const attributs = Object.entries(n.attributs ?? {}).map(([k, v]) => ` ${k}="${echapperCdar(v)}"`).join('')
  if (n.texte !== undefined) return `${retrait}<${n.nom}${attributs}>${echapperCdar(n.texte)}</${n.nom}>`
  const enfants = (n.enfants ?? []).filter((e): e is NoeudCdar => e !== null)
  return [`${retrait}<${n.nom}${attributs}>`, ...enfants.map((e) => serialiserCdar(e, profondeur + 1)), `${retrait}</${n.nom}>`].join('\n')
}

// Une date-heure : son texte et son format (UNTDID 2379), dans l'espace de noms que l'annexe 2 lui donne.
function dateHeureCdar(nom: string, prefixe: 'udt' | 'qdt', texte: string, format: '102' | '204'): NoeudCdar {
  return elCdar(nom, [elCdar(`${prefixe}:DateTimeString`, texte, { format })])
}

// Une partie : son identifiant global et son schéma, sa raison sociale, son rôle — dans l'ordre du schéma D22B
// (TradePartyType : ID, GlobalID, Name, RoleCode…).
function partieXmlCdar(nom: string, p: PartieCdar): NoeudCdar {
  const raison = p.nom == null ? '' : uneLigneCdar(p.nom)
  return elCdar(nom, [
    elCdar('ram:GlobalID', p.identifiant, { schemeID: p.schema }),
    raison ? elCdar('ram:Name', raison) : null,
    elCdar('ram:RoleCode', p.role),
  ])
}

// Le message, ou ce qui l'empêche d'être écrit. Les éléments suivent l'ordre du schéma CDAR D22B ; chacun cite la
// donnée de l'annexe 2 et la règle de l'annexe 7 qui le fondent.
export function messageEncaissee(d: DonneesCdar): ResultatCdar {
  const refus = refusMessageEncaissee(d)
  if (refus.length > 0) return { xml: null, refus }
  const { facture: f, encaissement: e, choix: c } = d
  const contrePassation = e.annule_id != null
  const parts = d.parts.filter((p) => p.encaissement_id === e.id).sort((a, b) => b.taux - a.taux)
  const maintenant = horodatage204(d.maintenant, c.fuseau) as string
  const dansLeStatut = c.dateEncaissement !== 'MDT-219'
  const dansLesCaracteristiques = c.dateEncaissement !== 'MDT-110'
  const numero = f.numero as string
  const nom = `${contrePassation ? 'Contre-passation du statut' : 'Statut'} ${LIBELLE_STATUT_ENCAISSEE} de la facture ${numero}`

  const document = elCdar('rsm:CrossDomainAcknowledgementAndResponse', [
    elCdar('rsm:ExchangedDocumentContext', [
      // MDT-3 : le profil (S1.06) — choix 1.
      elCdar('ram:GuidelineSpecifiedDocumentContextParameter', [elCdar('ram:ID', c.profil)]),
    ]),
    elCdar('rsm:ExchangedDocument', [
      // MDT-4, MDT-5 : l'identifiant et le nom du message, requis.
      elCdar('ram:ID', d.identifiant),
      elCdar('ram:Name', nom),
      // MDT-8 : la création du message, au format 204 (G7.06) — choix 4.
      dateHeureCdar('ram:IssueDateTime', 'udt', maintenant, '204'),
      // MDG-9, MDG-16, MDG-23 : l'émetteur, le créateur, les destinataires (G1.73, G7.01, G7.32, G7.46) — choix 2.
      partieXmlCdar('ram:SenderTradeParty', c.emetteur),
      partieXmlCdar('ram:IssuerTradeParty', c.createur),
      ...c.destinataires.map((p) => partieXmlCdar('ram:RecipientTradeParty', p)),
    ]),
    elCdar('rsm:AcknowledgementDocument', [
      // MDT-74 : un seul objet (P1.14). L'annexe écrit « False », que le schéma refuse : `udt:Indicator` est un
      // xsd:boolean, dont les seules formes sont true, false, 1 et 0.
      elCdar('ram:MultipleReferencesIndicator', [elCdar('udt:Indicator', 'false')]),
      // MDT-78 : la date et l'heure du statut (G7.06) — l'instant du message.
      dateHeureCdar('ram:IssueDateTime', 'udt', maintenant, '204'),
      elCdar('ram:ReferenceReferencedDocument', [
        // MDT-87 : le numéro de la facture (G7.23, G1.05).
        elCdar('ram:IssuerAssignedID', numero),
        // MDT-91 : son type (G7.15, G1.01).
        elCdar('ram:TypeCode', TYPE_FACTURE_CDAR),
        // MDT-95 : sa réception par la plateforme, requise (G7.06).
        dateHeureCdar('ram:ReceiptDateTime', 'udt', horodatage204(d.receptionFacture, c.fuseau) as string, '204'),
        // MDT-97 : le code type de référence d'un cycle de vie sur une facture (G7.14).
        elCdar('ram:ReferenceTypeCode', REFERENCE_CDV_FACTURE),
        // MDT-100 : la date d'émission de la facture (G7.31), au format 204 de MDT-100-1, à minuit.
        dateHeureCdar('ram:FormattedIssueDateTime', 'qdt', date204Cdar(f.date_emission), '204'),
        // MDT-105, MDT-106 : le statut et son libellé (G7.09, G7.44).
        elCdar('ram:ProcessConditionCode', CODE_STATUT_ENCAISSEE),
        elCdar('ram:ProcessCondition', LIBELLE_STATUT_ENCAISSEE),
        // MDT-129, MDT-130 : le vendeur, par son SIREN et lui seul (G7.17).
        elCdar('ram:IssuerTradeParty', [elCdar('ram:GlobalID', sirenDe(f.emetteur_siret) as string, { schemeID: '0002' })]),
        elCdar('ram:SpecifiedDocumentStatus', [
          // MDT-110 : la date du détail de statut — choix 3.
          dansLeStatut ? dateHeureCdar('ram:ReferenceDateTime', 'udt', date204Cdar(e.date_encaissement), '204') : null,
          // MDT-124-2 : le numéro du détail de statut, requis ; il n'y en a qu'un.
          elCdar('ram:SequenceNumeric', '1'),
          // MDT-126 : le motif d'une contre-passation (P1.17).
          contrePassation ? elCdar('ram:IncludedNote', [elCdar('ram:Content', e.motif as string)]) : null,
          // MDG-43 : une caractéristique par taux, du plus fort au plus faible — MDT-207 « MEN » (G7.12), MDT-215 le
          // montant et MDT-216 sa devise, l'euro (P1.15), MDT-219 la date — choix 3 —, MDT-224 le taux (G1.24, P1.18,
          // G7.45). Négatifs pour une contre-passation (P1.15, P1.17). Le montant s'écrit comme le registre l'a rendu :
          // `centimesExacts` l'a lu au centime sur cette écriture même, qui est celle de G7.07 — le point décimal, deux
          // décimales au plus, le signe en tête, jamais d'exposant entre un centime et dix mille milliards d'euros.
          ...parts.map((p) => elCdar('ram:SpecifiedDocumentCharacteristic', [
            elCdar('ram:TypeCode', CODE_MONTANT_ENCAISSE),
            elCdar('ram:ValueAmount', String(p.montant), { currencyID: 'EUR' }),
            dansLesCaracteristiques ? dateHeureCdar('ram:ValueDateTime', 'udt', date102Cdar(e.date_encaissement), '102') : null,
            elCdar('ram:ValuePercent', decimal(p.taux, 2) as string),
          ])),
        ]),
      ]),
    ]),
  ], { 'xmlns:rsm': NS_CDAR.rsm, 'xmlns:qdt': NS_CDAR.qdt, 'xmlns:ram': NS_CDAR.ram, 'xmlns:udt': NS_CDAR.udt })

  return { xml: `<?xml version="1.0" encoding="UTF-8"?>\n${serialiserCdar(document, 0)}\n`, refus: [] }
}
// ── FIN COPIE cdarEncaissee ──────────────────────────────────────────────────────────────────────────────────────────
