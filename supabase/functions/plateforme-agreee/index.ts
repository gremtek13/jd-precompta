// Edge Function : la réception et l'émission des factures électroniques par la plateforme agréée du client (ligne 28.5
// de la feuille de route, étapes b et c).
//
// Depuis le 1er septembre 2026, toute entreprise reçoit ses factures par une plateforme agréée — la sienne, qu'elle
// a choisie. Le cabinet a décidé (07/10/2026) de se brancher sur la plateforme de CHAQUE client plutôt que d'en
// imposer une, par l'API de flux que publient les plateformes, dite « API AFNOR » — Super PDP, banqup et Generix la
// documentent, et un logiciel qui s'y branche une fois doit pouvoir rejoindre toute plateforme qui la propose
// (Super PDP, 12/03/2026) —, et l'entreprise ouvre au cabinet une identité OAuth2 (« client credentials ») sur la
// sienne. Ce que la fonction attend d'une plateforme (routes, champs, pagination, erreurs) est tiré de ces
// documentations PUBLIQUES et de leurs clients publiés, jamais de la norme AFNOR elle-même, dont l'éditeur interdit
// l'exploitation par une IA (décision du cabinet du 07/10/2026). Cette fonction est le
// SEUL point de contact avec ces plateformes, et la seule à lire ou écrire `connexions_plateformes` (RLS sans aucune
// policy : refus total côté navigateur, voir supabase/essais/receptionPlateforme.sql). Le secret ne quitte jamais
// le serveur : il ouvre toutes les factures de l'entreprise, reçues comme émises.
//
// Dix actions, toutes demandées par un membre du cabinet qui a accès au dossier — `admin_du_dossier`, vérifié
// AVANT toute lecture de la connexion et tout appel à la plateforme :
//   - statut       la connexion du dossier, SANS appel extérieur : c'est le seul appel que l'écran fait en s'ouvrant ;
//   - enregistrer  les adresses, l'identifiant, le secret, l'organisation et la portée — vérifiés ici, pas seulement
//                  par la base : la fonction y envoie un secret ;
//   - retirer      supprime la connexion (rien n'est à refermer chez la plateforme : c'est l'entreprise qui retire
//                  l'accès qu'elle a ouvert, et l'écran le lui fait dire) ;
//   - tester       obtient un jeton, interroge `GET /v1/healthcheck` et fait une recherche qui ne rend rien ;
//   - lister       les factures mises à jour depuis le point de reprise, RENDUES au navigateur : rien n'est écrit
//                  ici — c'est l'écran qui importe, sur le clic, par le chemin d'un dépôt ;
//   - telecharger  un document d'UNE facture : l'original, ou la version lisible d'un original XML ;
//   - retenir      avance le point de reprise une fois l'import fait, jamais au-delà de ce qui est sûr ;
//   - repartir     remet le point de reprise au début, sur le clic du cabinet : après un SIRET du dossier corrigé,
//                  une facture écartée comme destinée à une autre entreprise, ou une pièce supprimée par erreur. Les
//                  factures déjà importées sont reconnues à leur flux et ne reviennent pas en double ;
//   - deposer      transmet une facture VALIDÉE du dossier : la fonction la relit en base, la juge (`refusEmission`) AVANT
//                  tout appel, l'écrit en CII par le générateur que src/lib fait juger au validateur officiel de la norme,
//                  réserve sa transmission (une seule active par facture) et la dépose ;
//   - suivre       relit chez la plateforme l'accusé d'un dépôt — ou le retrouve par son identifiant de suivi quand la
//                  réponse au dépôt s'est perdue — et l'enregistre.
//
// UNE connexion par dossier (la clé primaire de la table est le dossier) : un dossier est UNE entreprise, qui a UNE
// plateforme de réception.
//
// LE POINT DE REPRISE N'EST QU'UNE ÉCONOMIE, JAMAIS UNE GARANTIE : ce qui empêche une facture d'entrer deux fois,
// c'est son flux (`pieces_flux_unique` : le dossier, l'hôte de la plateforme et l'identifiant du flux). Une recherche
// qui repart trop tôt relit des factures déjà importées, que l'écran écarte ; une recherche qui repartirait trop tard
// en perdrait. D'où les règles du bloc CURSEUR : il n'avance que sur ce que l'écran a réellement traité, jamais à
// moins d'une heure de maintenant, et ne recule jamais.
//
// CE QUI SORT VERS LE NAVIGATEUR EST BORNÉ : ni le secret, ni le jeton, ni une réponse brute de la plateforme — des
// champs lus et vérifiés, et pour un document, des octets dont la nature (PDF ou XML) est contrôlée. L'adresse est
// saisie par le cabinet, donc la fonction refuse de l'envoyer ailleurs que vers un nom de domaine public en https
// (bloc ADRESSES), ne suit aucune redirection sauf pour un fichier, et sans jamais porter le jeton chez un autre hôte.
// Les journaux ne portent que des nombres et des codes de retour, jamais une adresse, un nom ou un identifiant.

import { createClient } from "npm:@supabase/supabase-js@2"

const DELAI_APPEL_MS = 25_000
// La plateforme coupe une fonction à 150 s, sans un mot et en perdant tout (voir extract-piece). La recherche page à
// page s'arrête bien avant, et le DIT.
const BUDGET_RECHERCHE_MS = 100_000
const MAX_PAGES = 20
// Une page de 100 résultats au plus : le maximum que publie banqup (25 par défaut), et celui que le client pyfrctc
// demande à Super PDP.
const TAILLE_PAGE = 100
// Ce que l'écran importe en une fois : chaque facture coûte deux téléchargements et un dépôt. Au-delà, la liste se dit
// incomplète, l'écran importe ce lot, retient son point de reprise, et la récupération suivante continue.
const MAX_FLUX = 100
const MAX_JSON_OCTETS = 2 * 1024 * 1024
// Le plafond de la lecture d'une pièce (`extract-piece`) : une facture plus lourde se récupère sur la plateforme.
const MAX_FICHIER_OCTETS = 10 * 1024 * 1024
const MAX_REDIRECTIONS = 3

const ACTIONS = ["statut", "enregistrer", "retirer", "tester", "lister", "telecharger", "retenir", "repartir", "deposer", "suivre"]
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const COLONNES = "dossier_id, nom, url_flux, url_jeton, client_id, client_secret, organisation_id, portee, " +
  "recherche_depuis, derniere_recuperation, created_at, updated_at"
// Une facture à transmettre, telle que le générateur la lit, avec l'émetteur qu'elle a figé et la facture qu'un avoir
// corrige.
const COLONNES_FACTURE = "id, numero, statut, type, facture_origine_id, date_emission, date_echeance, tiers_nom, tiers_adresse, " +
  "tiers_siret, montant_ht, montant_tva, montant_ttc, mentions_legales, notes, type_client, tiers_siren, " +
  "tiers_adresse_electronique, code_service, numero_engagement, nature_operation, date_prestation, periode_debut, " +
  "periode_fin, livraison_adresse, livraison_code_postal, livraison_ville, livraison_pays, option_debits, emetteur_nom, " +
  "emetteur_siret, emetteur_adresse, superpdp_invoice_id"
const COLONNES_TRANSMISSION = "id, facture_id, canal, hote, flux_id, sha256, etat, detail, cree_le, maj_le"
// Les factures, dans les deux sens : celles que l'entreprise reçoit (SupplierInvoice, un achat) et celles qu'elle émet
// (CustomerInvoice, une vente). Le TYPE dit qui est le fournisseur, quel que soit le sens du flux — banqup les définit
// ainsi : CustomerInvoice est une facture émise, ou une autofacture reçue ; SupplierInvoice une facture reçue, ou une
// autofacture émise. Les cycles de vie et l'e-reporting ne sont pas des pièces.
const TYPES_RECHERCHES = ["SupplierInvoice", "CustomerInvoice"]

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  })
}

// ── DÉBUT ADRESSES ──────────────────────────────────────────────────────────────────────────────────
// Où la fonction envoie un secret : l'adresse du service des flux et celle des jetons, SAISIES par le cabinet. Elles
// doivent désigner un service public : en https, vers un nom de domaine dont le dernier segment commence par une
// lettre — ni adresse IP, ni « localhost » —, sans port, sans identifiants, sans paramètres ni ancre. Ce sont les
// règles de la base (contraintes `connexions_plateformes_url_*`), refaites ici pour dire POURQUOI avant d'écrire, plus
// deux que la base ne peut pas tenir seule : les suffixes des réseaux internes, et les noms de domaine qui EMBARQUENT
// une adresse IP (« 10.0.0.1.nip.io » se résout vers 10.0.0.1). Ce qui reste hors d'atteinte, dit plutôt que promis :
// un nom ordinaire dont l'enregistrement DNS pointerait vers une adresse interne. Le réseau de la plateforme Supabase
// est alors la dernière barrière, et ce que la fonction rend (des champs lus, des octets PDF ou XML vérifiés) borne ce
// qu'une telle requête pourrait rapporter.
const HOTE_PUBLIC = /^([a-z0-9-]+\.)+[a-z][a-z0-9-]*$/
const ADRESSE_EN_BASE = /^https:\/\/([a-z0-9-]+\.)+[a-z][a-z0-9-]*(\/[^\s?#]*)?$/
const SUFFIXES_INTERNES = [
  ".local", ".localhost", ".localdomain", ".internal", ".intranet", ".lan", ".home", ".corp", ".private",
  ".test", ".example", ".invalid", ".arpa",
]

/** Pourquoi un nom d'hôte est refusé, ou null s'il désigne un service public. */
function hoteRefuse(hote: string): string | null {
  if (hote.length > 253 || !HOTE_PUBLIC.test(hote) || /(^|\.)-|-(\.|$)/.test(hote)) {
    return "n'est pas un nom de domaine public"
  }
  if (SUFFIXES_INTERNES.some((suffixe) => hote.endsWith(suffixe))) return "désigne un réseau interne"
  if (/(^|\.)(\d{1,3}\.){3}\d{1,3}(\.|$)/.test(hote) || /(^|[.-])\d{1,3}-\d{1,3}-\d{1,3}-\d{1,3}([.-]|$)/.test(hote)) {
    return "embarque une adresse IP"
  }
  return null
}

/**
 * Une adresse saisie, ramenée à la forme que la base garde — l'hôte en minuscules, sans barre finale — ou la raison
 * de son refus. Pour le service des flux, un « /v1 » final est retiré : les plateformes publient leurs routes sous leur
 * adresse suivie de « /v1 » (banqup, Generix, Super PDP), et une adresse collée avec lui ferait appeler
 * « …/v1/v1/flows ».
 */
function adresseNettoyee(
  saisie: unknown, libelle: string, retirerVersion: boolean,
): { url: string; hote: string } | { refus: string } {
  if (typeof saisie !== "string" || saisie.trim() === "") return { refus: `${libelle} est vide.` }
  const texte = saisie.trim()
  if (texte.length > 500) return { refus: `${libelle} est trop longue (500 caractères au plus).` }
  if (!/^https:\/\//i.test(texte)) {
    return { refus: `${libelle} doit commencer par https:// — la fonction y envoie un secret.` }
  }
  let u: URL
  try {
    u = new URL(texte)
  } catch {
    return { refus: `${libelle} n'est pas une adresse lisible.` }
  }
  if (u.username !== "" || u.password !== "") return { refus: `${libelle} ne doit pas porter d'identifiants.` }
  if (u.port !== "") return { refus: `${libelle} ne doit pas préciser de port.` }
  if (u.search !== "" || u.hash !== "" || /[?#]/.test(texte)) {
    return { refus: `${libelle} ne doit porter ni paramètres (« ? ») ni ancre (« # »).` }
  }
  const refus = hoteRefuse(u.hostname)
  if (refus) return { refus: `${libelle} : « ${u.hostname} » ${refus}.` }
  let chemin = u.pathname.replace(/\/+$/, "")
  if (retirerVersion) chemin = chemin.replace(/\/v1(\/(healthcheck|flows(\/search)?))?$/i, "")
  const url = `https://${u.hostname}${chemin}`
  if (url.length > 500 || !ADRESSE_EN_BASE.test(url)) return { refus: `${libelle} n'a pas une forme admise.` }
  return { url, hote: u.hostname }
}

/**
 * Où mène une redirection rencontrée en téléchargeant un fichier — une plateforme peut renvoyer vers son stockage, par
 * une adresse signée. Les mêmes règles d'hôte, des paramètres admis (la signature y vit), et rien d'autre ; l'appelant
 * ne porte le jeton que chez l'hôte d'origine.
 */
function cibleRedirection(location: string | null, depuis: string): { url: string } | { refus: string } {
  if (!location) return { refus: "redirection sans adresse" }
  let u: URL
  try {
    u = new URL(location, depuis)
  } catch {
    return { refus: "redirection illisible" }
  }
  if (u.protocol !== "https:" || u.username !== "" || u.password !== "" || u.port !== "") {
    return { refus: "redirection vers une adresse non admise" }
  }
  const refus = hoteRefuse(u.hostname)
  if (refus) return { refus: `redirection vers un hôte qui ${refus}` }
  return { url: u.toString() }
}
// ── FIN ADRESSES ────────────────────────────────────────────────────────────────────────────────────

// ── DÉBUT CONNEXION ─────────────────────────────────────────────────────────────────────────────────
// Ce que le cabinet enregistre, et ce que l'écran en voit. Les règles sont celles des contraintes de la base, dites ici
// en français ; un secret laissé vide à la modification garde celui qui est enregistré — il ne s'affiche jamais, donc
// le cabinet ne peut pas le retaper.
interface ConnexionLue {
  dossier_id: string
  nom: string
  url_flux: string
  url_jeton: string
  client_id: string
  client_secret: string
  organisation_id: string | null
  portee: string | null
  recherche_depuis: string | null
  derniere_recuperation: string | null
  created_at: string
  updated_at: string
}

interface ValeursConnexion {
  nom: string
  url_flux: string
  url_jeton: string
  client_id: string
  client_secret: string
  organisation_id: string | null
  portee: string | null
}

// Les caractères de commande (Unicode Cc : les codes 0 à 31 et 127 à 159) — invisibles à l'écran, refusés en en-tête.
const CONTROLE = /\p{Cc}/u

function saisieDeConnexion(
  payload: Record<string, unknown>, existante: ConnexionLue | null,
): { valeurs: ValeursConnexion; reinitialiser: boolean } | { refus: string } {
  const nom = typeof payload.nom === "string" ? payload.nom.replace(/\s+/g, " ").trim() : ""
  if (nom === "" || nom.length > 80) return { refus: "Donnez à la plateforme un nom de 1 à 80 caractères." }
  if (CONTROLE.test(nom)) return { refus: "Le nom de la plateforme porte un caractère invisible." }

  const flux = adresseNettoyee(payload.url_flux, "L'adresse du service des flux", true)
  if ("refus" in flux) return flux
  const jeton = adresseNettoyee(payload.url_jeton, "L'adresse des jetons", false)
  if ("refus" in jeton) return jeton

  const clientId = typeof payload.client_id === "string" ? payload.client_id.trim() : ""
  if (clientId === "" || clientId.length > 500 || CONTROLE.test(clientId)) {
    return { refus: "L'identifiant du cabinet chez la plateforme est vide, trop long ou porte un caractère invisible." }
  }

  const secretSaisi = typeof payload.client_secret === "string" ? payload.client_secret.trim() : ""
  let secret: string
  if (secretSaisi === "") {
    if (!existante) return { refus: "Le secret est requis pour une première connexion." }
    secret = existante.client_secret
  } else {
    if (secretSaisi.length > 2000 || CONTROLE.test(secretSaisi)) {
      return { refus: "Le secret est trop long ou porte un caractère invisible." }
    }
    secret = secretSaisi
  }

  const organisationSaisie = typeof payload.organisation_id === "string" ? payload.organisation_id.trim() : ""
  const organisation = organisationSaisie === "" ? null : organisationSaisie
  if (organisation !== null && !/^[!-~]{1,200}$/.test(organisation)) {
    return { refus: "L'organisation s'écrit sans espace ni accent (200 caractères au plus) : c'est une valeur d'en-tête." }
  }

  const porteeSaisie = typeof payload.portee === "string" ? payload.portee.replace(/\s+/g, " ").trim() : ""
  const portee = porteeSaisie === "" ? null : porteeSaisie
  if (portee !== null && (portee.length > 500 || !/^[!-~]+( [!-~]+)*$/.test(portee))) {
    return { refus: "La portée s'écrit en mots sans accent séparés d'une espace (500 caractères au plus)." }
  }

  // Une autre plateforme, une autre identité ou une autre entreprise : la recherche ne reprend pas où l'ancienne
  // s'était arrêtée — ses flux ne sont pas les mêmes.
  const reinitialiser = existante === null || existante.url_flux !== flux.url || existante.client_id !== clientId ||
    (existante.organisation_id ?? null) !== organisation
  return {
    valeurs: {
      nom, url_flux: flux.url, url_jeton: jeton.url, client_id: clientId, client_secret: secret,
      organisation_id: organisation, portee,
    },
    reinitialiser,
  }
}

/** La connexion telle que l'écran la voit : jamais le secret. `version` désigne la configuration lue. */
function vuePublique(c: ConnexionLue | null) {
  if (!c) return null
  let hote: string | null = null
  try {
    hote = new URL(c.url_flux).hostname
  } catch {
    hote = null
  }
  return {
    nom: c.nom,
    url_flux: c.url_flux,
    url_jeton: c.url_jeton,
    hote,
    client_id: c.client_id,
    organisation_id: c.organisation_id,
    portee: c.portee,
    recherche_depuis: c.recherche_depuis,
    derniere_recuperation: c.derniere_recuperation,
    created_at: c.created_at,
    version: c.updated_at,
  }
}
// ── FIN CONNEXION ───────────────────────────────────────────────────────────────────────────────────

// ── DÉBUT JETON ─────────────────────────────────────────────────────────────────────────────────────
// OAuth2, accès « client credentials » (RFC 6749, §4.4), celui que publient les plateformes (banqup, Super PDP).
// L'identité se présente d'abord par l'en-tête Basic, la forme que la RFC recommande (§2.3.1 : chaque partie encodée
// comme un formulaire) ; une plateforme qui ne l'accepte pas refuse en 400 ou 401, et la demande repart avec l'identité
// dans le corps, la forme que la RFC admet aussi. Le jeton rendu doit être un jeton « Bearer » (RFC 6750) : c'est celui
// que les plateformes demandent sur chaque appel.
interface IdentiteJeton {
  url_jeton: string
  client_id: string
  client_secret: string
  portee: string | null
}

function encodageFormulaire(texte: string): string {
  return new URLSearchParams({ x: texte }).toString().slice(2)
}

function requeteJeton(
  identite: IdentiteJeton, mode: "basic" | "corps",
): { url: string; init: { method: string; headers: Record<string, string>; body: string } } {
  const corps = new URLSearchParams({ grant_type: "client_credentials" })
  if (identite.portee) corps.set("scope", identite.portee)
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  }
  if (mode === "basic") {
    headers.Authorization =
      `Basic ${btoa(`${encodageFormulaire(identite.client_id)}:${encodageFormulaire(identite.client_secret)}`)}`
  } else {
    corps.set("client_id", identite.client_id)
    corps.set("client_secret", identite.client_secret)
  }
  return { url: identite.url_jeton, init: { method: "POST", headers, body: corps.toString() } }
}

const ERREURS_OAUTH: Record<string, string> = {
  invalid_client: "La plateforme refuse l'identifiant ou le secret.",
  unauthorized_client: "La plateforme n'autorise pas cet identifiant à obtenir un jeton de cette façon.",
  invalid_grant: "La plateforme refuse l'accès demandé.",
  invalid_scope: "La plateforme refuse la portée demandée : vérifiez-la, ou laissez-la vide.",
  unsupported_grant_type: "La plateforme n'accepte pas l'accès « client credentials » à cette adresse : vérifiez " +
    "l'adresse des jetons.",
  invalid_request: "La plateforme juge la demande de jeton incomplète : vérifiez l'adresse des jetons et la portée.",
}

/**
 * Le jeton d'une réponse de la plateforme, ou la raison du refus dite en français. Le texte libre de la plateforme
 * (`error_description`) n'est PAS repris : seul un code de la liste fermée de la RFC l'est, avec le statut.
 */
function jetonDeLaReponse(statut: number, donnees: unknown): { jeton: string } | { refus: string; identifiants: boolean } {
  if (statut >= 200 && statut < 300) {
    const d = (donnees ?? {}) as { access_token?: unknown; token_type?: unknown }
    if (typeof d.access_token !== "string" || !/^[!-~]{1,8192}$/.test(d.access_token)) {
      return { refus: "La plateforme a délivré un jeton illisible.", identifiants: false }
    }
    if (d.token_type !== undefined && (typeof d.token_type !== "string" || d.token_type.toLowerCase() !== "bearer")) {
      return {
        refus: "La plateforme a délivré un jeton d'un autre type que Bearer, le seul que la fonction sache présenter.",
        identifiants: false,
      }
    }
    return { jeton: d.access_token }
  }
  const code = (donnees as { error?: unknown } | null)?.error
  if (typeof code === "string" && Object.hasOwn(ERREURS_OAUTH, code)) {
    return {
      refus: `${ERREURS_OAUTH[code]} (${code}, ${statut})`,
      identifiants: code === "invalid_client" || code === "unauthorized_client",
    }
  }
  if (statut === 401) return { refus: `La plateforme refuse l'identifiant ou le secret (${statut}).`, identifiants: true }
  if (statut === 404) {
    return { refus: "La plateforme ne connaît pas l'adresse des jetons (404) : vérifiez-la.", identifiants: false }
  }
  return { refus: `La plateforme des jetons a répondu ${statut}.`, identifiants: false }
}
// ── FIN JETON ───────────────────────────────────────────────────────────────────────────────────────

// ── DÉBUT FLUX ──────────────────────────────────────────────────────────────────────────────────────
// Ce qu'un flux de la plateforme devient pour l'écran : une facture d'achat ou de vente, dans un format qu'on sait lire,
// prête ou non. Tout le reste est écarté et COMPTÉ, jamais deviné : un cycle de vie ou un e-reporting n'est pas une
// pièce ; une facture sans identifiant ou sans date de mise à jour lisible ne peut ni se dédoublonner ni se retrouver ;
// un statut de traitement inconnu ne se lit pas comme « prête ».
const TYPES_FACTURE: Record<string, "achat" | "vente"> = { SupplierInvoice: "achat", CustomerInvoice: "vente" }
const SYNTAXES_FACTURE = ["CII", "UBL", "Factur-X"]
const INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,9})?(Z|[+-](\d{2}):(\d{2}))$/

type Ecart = "autre_flux" | "illisible" | "format" | "statut_inconnu"

interface FluxVu {
  id: string
  sens: "achat" | "vente"
  syntaxe: string
  direction: "In" | "Out" | null
  nom: string | null
  recu_le: string | null
  mis_a_jour: string
  etat: "pret" | "en_attente" | "en_erreur"
}

/**
 * Un instant de la plateforme, en millisecondes, TRONQUÉ à la milliseconde — jamais arrondi : un point de reprise
 * arrondi vers le haut sauterait un flux mis à jour dans la même milliseconde. Une date de calendrier impossible
 * (un 30 février, que `Date.parse` décale au 2 mars) est illisible.
 */
function instantMs(valeur: unknown): number | null {
  if (typeof valeur !== "string") return null
  const m = INSTANT.exec(valeur)
  if (!m) return null
  const [an, mois, jour, heure, minute, seconde] = [m[1], m[2], m[3], m[4], m[5], m[6]].map(Number)
  const civil = new Date(Date.UTC(an, mois - 1, jour))
  if (civil.getUTCFullYear() !== an || civil.getUTCMonth() !== mois - 1 || civil.getUTCDate() !== jour) return null
  if (heure > 23 || minute > 59 || seconde > 59) return null
  if (m[9] !== undefined && (Number(m[9]) > 23 || Number(m[10]) > 59)) return null
  const ms = Date.parse(valeur.replace(/(\.\d{3})\d+/, "$1"))
  return Number.isFinite(ms) ? ms : null
}

function isoMs(ms: number): string {
  return new Date(ms).toISOString()
}

function texteCourt(valeur: unknown, max: number): string | null {
  if (typeof valeur !== "string") return null
  const net = valeur.replace(/\p{Cc}/gu, " ").replace(/\s+/g, " ").trim()
  return net === "" ? null : net.slice(0, max)
}

function fluxDeLaListe(brut: unknown): { flux: FluxVu } | { ecarte: Ecart; misAJour: number | null } {
  const f = (brut !== null && typeof brut === "object" ? brut : {}) as Record<string, unknown>
  const misAJour = instantMs(f.updatedAt)
  const sens = typeof f.flowType === "string" && Object.hasOwn(TYPES_FACTURE, f.flowType) ? TYPES_FACTURE[f.flowType] : null
  if (sens === null) return { ecarte: "autre_flux", misAJour }
  const id = typeof f.flowId === "string" && /^[!-~]{1,200}$/.test(f.flowId) ? f.flowId : null
  if (id === null || misAJour === null) return { ecarte: "illisible", misAJour }
  const syntaxe = typeof f.flowSyntax === "string" && SYNTAXES_FACTURE.includes(f.flowSyntax) ? f.flowSyntax : null
  if (syntaxe === null) return { ecarte: "format", misAJour }
  const accuse = f.acknowledgement !== null && typeof f.acknowledgement === "object"
    ? (f.acknowledgement as { status?: unknown }).status : undefined
  const etat = accuse === "Ok" ? "pret" : accuse === "Pending" ? "en_attente" : accuse === "Error" ? "en_erreur" : null
  if (etat === null) return { ecarte: "statut_inconnu", misAJour }
  const recu = instantMs(f.submittedAt)
  return {
    flux: {
      id,
      sens,
      syntaxe,
      direction: f.flowDirection === "In" || f.flowDirection === "Out" ? f.flowDirection : null,
      nom: texteCourt(f.name, 255),
      recu_le: recu === null ? null : isoMs(recu),
      mis_a_jour: isoMs(misAJour),
      etat,
    },
  }
}
// ── FIN FLUX ────────────────────────────────────────────────────────────────────────────────────────

// ── DÉBUT RECHERCHE ─────────────────────────────────────────────────────────────────────────────────
// La recherche page à page (`POST /v1/flows/search`). Les plateformes publient deux façons de paginer, et les deux sont
// suivies : banqup documente un curseur opaque (`cursor` dans la demande, `nextCursor` dans la réponse, absent à la
// dernière page) ET la date (« Pagination works with the updatedAfter property », la comparaison étant stricte :
// updatedAt > updatedAfter) ; le client pyfrctc, écrit pour Super PDP, pagine par la date. D'où :
//   - un `nextCursor` mène à la page suivante — un curseur déjà servi rend la lecture INCOMPLÈTE au lieu de tourner ;
//   - sans curseur, une page plus courte que demandée est la dernière ;
//   - sans curseur, une page PLEINE repart de la date : la comparaison étant stricte (updatedAt > updatedAfter), elle
//     repart de la plus grande date de la page STRICTEMENT inférieure à la dernière — des flux de même date peuvent
//     être à cheval sur deux pages —, et les flux relus s'écartent par leur identifiant. Une page entière à la même
//     date ne laisse aucun moyen d'avancer : la lecture le dit incomplète.
// Trois bornes encore, et chacune rend la lecture incomplète en le disant : le nombre de pages, le temps (la plateforme
// Supabase coupe à 150 s et perd tout), et le nombre de factures qu'un import traite d'un coup.
//
// `jusqua` est le point de reprise que la lecture rend POSSIBLE si l'écran traite toutes les factures listées : la plus
// grande date lue quand la lecture est complète ; quand elle ne l'est pas, la plus grande date STRICTEMENT inférieure à
// la dernière (des flux non lus peuvent la partager) — et rien du tout si la plateforme n'a pas rendu ses flux dans
// l'ordre croissant de leur date : un flux non lu pourrait alors être plus ancien. Cet ordre, la pagination par la date
// le SUPPOSE sans qu'aucune documentation publique l'écrive en toutes lettres : le code le vérifie, et une page pleine
// dans le désordre ne fait pas repartir de la date — elle arrête la lecture en le disant.
interface PageFlux {
  results?: unknown
  nextCursor?: unknown
}

interface DemandeDePage {
  updatedAfter: string | null
  cursor: string | null
}

interface Ecartes {
  autre_flux: number
  illisible: number
  format: number
  statut_inconnu: number
  doublons: number
}

interface Recherche {
  flux: FluxVu[]
  ecartes: Ecartes
  pages: number
  complete: boolean
  motif: string | null
  jusqua: string | null
}

async function rechercherFlux(
  page: (demande: DemandeDePage) => Promise<PageFlux>,
  depuis: string | null,
  bornes: { taillePage: number; maxFlux: number; maxPages: number; echeance: number; maintenant: () => number },
): Promise<Recherche> {
  const flux: FluxVu[] = []
  const ecartes: Ecartes = { autre_flux: 0, illisible: 0, format: 0, statut_inconnu: 0, doublons: 0 }
  const vus = new Set<string>()
  const curseursServis = new Set<string>()
  const instants: number[] = []
  let ordonne = true
  let demande: DemandeDePage = { updatedAfter: depuis, cursor: null }

  const fin = (pages: number, complete: boolean, motif: string | null): Recherche => {
    let jusqua: string | null = null
    if (instants.length > 0) {
      const dernier = Math.max(...instants)
      if (complete) {
        jusqua = isoMs(dernier)
      } else if (ordonne) {
        const avant = instants.filter((i) => i < dernier)
        jusqua = avant.length > 0 ? isoMs(Math.max(...avant)) : null
      }
    }
    return { flux, ecartes, pages, complete, motif, jusqua }
  }

  for (let n = 0; n < bornes.maxPages; n++) {
    if (n > 0 && bornes.maintenant() > bornes.echeance) {
      return fin(n, false, "la plateforme met trop de temps à rendre ses pages : relancez la récupération")
    }
    const reponse = await page(demande)
    const resultats = reponse !== null && typeof reponse === "object" ? reponse.results : undefined
    if (!Array.isArray(resultats)) return fin(n + 1, false, "la plateforme a rendu une page illisible")
    const instantsPage: number[] = []
    for (const brut of resultats) {
      const lu = fluxDeLaListe(brut)
      const instant = "flux" in lu ? instantMs(lu.flux.mis_a_jour) : lu.misAJour
      if (instant !== null) {
        if (instants.length > 0 && instant < instants[instants.length - 1]) ordonne = false
        instants.push(instant)
        instantsPage.push(instant)
      }
      if ("ecarte" in lu) {
        ecartes[lu.ecarte]++
        continue
      }
      if (vus.has(lu.flux.id)) {
        ecartes.doublons++
        continue
      }
      vus.add(lu.flux.id)
      flux.push(lu.flux)
    }
    const suite = typeof reponse.nextCursor === "string" && reponse.nextCursor !== "" ? reponse.nextCursor : null
    if (suite === null && resultats.length < bornes.taillePage) return fin(n + 1, true, null)
    if (flux.length >= bornes.maxFlux) {
      return fin(n + 1, false, `plus de ${bornes.maxFlux} factures à la fois : importez celles-ci, puis relancez la ` +
        "récupération pour la suite")
    }
    if (suite !== null) {
      if (curseursServis.has(suite)) return fin(n + 1, false, "la plateforme a renvoyé deux fois la même page")
      curseursServis.add(suite)
      demande = { updatedAfter: demande.updatedAfter, cursor: suite }
      continue
    }
    // Page pleine sans curseur : la pagination par date.
    const dernier = instantsPage.length > 0 ? Math.max(...instantsPage) : null
    const avant = instantsPage.filter((i) => dernier !== null && i < dernier)
    if (dernier === null || avant.length === 0) {
      return fin(n + 1, false, "une page entière porte la même date de mise à jour : la plateforme ne permet pas " +
        "d'aller plus loin")
    }
    const reprise = Math.max(...avant)
    const actuelle = instantMs(demande.updatedAfter)
    if (actuelle !== null && reprise <= actuelle) return fin(n + 1, false, "la plateforme n'avance plus d'une page à l'autre")
    // Repartir de la date sauterait, chez une plateforme qui rend ses flux dans le désordre, ceux qu'elle n'a pas encore
    // rendus et qui sont plus anciens que la reprise — en silence, et pour toujours si elle rend toujours les mêmes.
    if (!ordonne) {
      return fin(n + 1, false, "la plateforme ne rend pas ses factures dans l'ordre de leur date : la recherche ne peut " +
        "pas aller plus loin sans risquer d'en sauter")
    }
    demande = { updatedAfter: isoMs(reprise), cursor: null }
  }
  return fin(bornes.maxPages, false, `plus de ${bornes.maxPages} pages : relancez la récupération pour la suite`)
}
// ── FIN RECHERCHE ───────────────────────────────────────────────────────────────────────────────────

// ── DÉBUT CURSEUR ───────────────────────────────────────────────────────────────────────────────────
// Le point de reprise que l'écran demande à retenir après un import — celui que la liste rendait possible, ramené
// avant la première facture qu'il n'a pas pu importer. La fonction le borne encore : jamais à moins d'une heure de
// maintenant, et jamais en arrière — un autre onglet a pu aller plus loin, et reculer ferait seulement relire.
// L'HEURE EST NOTRE CHOIX, aucune documentation publique ne donnant ce délai, et elle est large exprès : relire ne
// coûte rien — chaque facture est reconnue à son flux et ne revient pas —, en perdre une coûte une facture. Elle couvre
// l'écart entre l'horloge de la plateforme et celle de la fonction, et un flux qu'une plateforme daterait de son arrivée
// mais ne rendrait visible qu'après l'avoir traité.
const MARGE_DE_REPRISE_MS = 60 * 60_000

function curseurRetenu(actuel: string | null, demande: unknown, maintenantMs: number): { curseur: string | null } | { refus: string } {
  if (demande === null) return { curseur: actuel }
  const ms = instantMs(demande)
  if (ms === null) return { refus: "Le point de reprise demandé n'est pas une date lisible." }
  const retenu = Math.min(ms, maintenantMs - MARGE_DE_REPRISE_MS)
  const avant = instantMs(actuel)
  if (avant !== null && avant >= retenu) return { curseur: actuel }
  return { curseur: isoMs(retenu) }
}
// ── FIN CURSEUR ─────────────────────────────────────────────────────────────────────────────────────

// ── DÉBUT FICHIER ───────────────────────────────────────────────────────────────────────────────────
// Un document téléchargé : lu par morceaux et jamais au-delà de son plafond (l'en-tête de longueur ne fait pas foi,
// il peut manquer ou mentir), puis reconnu à ses premiers octets. Une facture électronique est un PDF (Factur-X, une
// version lisible) ou un XML (CII, UBL) en UTF-8 ; un XML qui déclare une DTD est refusé — aucune facture n'en a
// besoin, et ses entités sont la porte des attaques par expansion. Rendu en base64, par tranches d'un multiple de trois
// octets : sans rembourrage au milieu, leur concaténation est le base64 du tout.
async function lireCorps(reponse: Response, max: number): Promise<{ octets: Uint8Array } | { tropLourd: true }> {
  const annonce = Number(reponse.headers.get("content-length") ?? "")
  if (Number.isFinite(annonce) && annonce > max) {
    await abandonner(reponse)
    return { tropLourd: true }
  }
  if (!reponse.body) return { octets: new Uint8Array(0) }
  const lecteur = reponse.body.getReader()
  const morceaux: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await lecteur.read()
    if (done) break
    total += value.length
    if (total > max) {
      try {
        await lecteur.cancel()
      } catch {
        // Un flux déjà interrompu ne retient rien : le plafond est dit à l'appelant de toute façon.
      }
      return { tropLourd: true }
    }
    morceaux.push(value)
  }
  const octets = new Uint8Array(total)
  let position = 0
  for (const morceau of morceaux) {
    octets.set(morceau, position)
    position += morceau.length
  }
  return { octets }
}

async function abandonner(reponse: Response): Promise<void> {
  try {
    await reponse.body?.cancel()
  } catch {
    // Un corps déjà fermé ne retient rien : il n'y a rien d'autre à faire.
  }
}

function natureFichier(octets: Uint8Array): "pdf" | "xml" | null {
  const debut = new TextDecoder("latin1").decode(octets.subarray(0, 1024))
  if (/^%PDF-\d/.test(debut)) return "pdf"
  const texte = (debut.startsWith("ï»¿") ? debut.slice(3) : debut).replace(/^\s+/, "")
  if (!/^<\?xml[\s?]/.test(texte) && !/^<!--/.test(texte) && !/^<[A-Za-z_][\w.:-]*[\s>/]/.test(texte)) return null
  if (/<!DOCTYPE|<!ENTITY/i.test(new TextDecoder("latin1").decode(octets))) return null
  return "xml"
}

function base64De(octets: Uint8Array): string {
  const tranches: string[] = []
  for (let i = 0; i < octets.length; i += 0x6000) {
    tranches.push(btoa(String.fromCharCode(...octets.subarray(i, i + 0x6000))))
  }
  return tranches.join("")
}
// ── FIN FICHIER ─────────────────────────────────────────────────────────────────────────────────────

// ── DÉBUT HTTP ──────────────────────────────────────────────────────────────────────────────────────
// Le client d'UNE plateforme, pour la durée d'un appel : un jeton obtenu une fois, puis des appels au service des flux.
// Chaque appel est borné dans le temps ; aucune redirection n'est suivie sur le jeton ni sur une route JSON — une
// adresse qui renvoie ailleurs est mal configurée, et la suivre porterait le jeton chez un autre. Un FICHIER peut être
// redirigé, trois fois au plus, vers un hôte public, et le jeton ne part que chez l'hôte d'origine. `recuperer` est
// le `fetch` de l'environnement : le test lui en substitue un, qui joue la plateforme.
interface ConfigPlateforme extends IdentiteJeton {
  url_flux: string
  organisation_id: string | null
}

interface ReponseJson {
  statut: number
  donnees: unknown
  redirection: boolean
}

interface ReponseFichier {
  statut: number
  octets: Uint8Array | null
  tropLourd: boolean
  redirectionRefusee: boolean
}

function estRedirection(reponse: Response): boolean {
  return reponse.type === "opaqueredirect" || (reponse.status >= 300 && reponse.status < 400)
}

async function lireJson(reponse: Response, max: number): Promise<unknown> {
  const lu = await lireCorps(reponse, max)
  if (!("octets" in lu) || lu.octets.length === 0) return null
  try {
    return JSON.parse(new TextDecoder().decode(lu.octets))
  } catch {
    return null
  }
}

function clientPlateforme(
  config: ConfigPlateforme,
  recuperer: (url: string, init: RequestInit) => Promise<Response>,
  options: { delaiMs: number; maxJson: number; maxFichier: number; maxRedirections: number },
) {
  let jetonObtenu: string | null = null
  // L'organisation, quand une identité sert plusieurs entreprises : banqup publie l'en-tête « Organization-Id ». C'est
  // le seul qu'une documentation publique nomme, et le seul qui part.
  const organisation: Record<string, string> = config.organisation_id
    ? { "Organization-Id": config.organisation_id }
    : {}

  async function envoyer(url: string, init: RequestInit): Promise<Response | null> {
    try {
      return await recuperer(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(options.delaiMs) })
    } catch {
      return null
    }
  }

  async function jeton(): Promise<{ jeton: string } | { refus: string; identifiants: boolean; statut: number }> {
    if (jetonObtenu) return { jeton: jetonObtenu }
    let dernier: { refus: string; identifiants: boolean; statut: number } = {
      refus: "La plateforme n'a pas délivré de jeton.", identifiants: false, statut: 0,
    }
    for (const mode of ["basic", "corps"] as const) {
      const { url, init } = requeteJeton(config, mode)
      const reponse = await envoyer(url, init)
      if (!reponse) return { refus: "La plateforme n'a pas répondu à la demande de jeton.", identifiants: false, statut: 0 }
      if (estRedirection(reponse)) {
        await abandonner(reponse)
        return {
          refus: "L'adresse des jetons renvoie vers une autre adresse : vérifiez-la.", identifiants: false,
          statut: reponse.status,
        }
      }
      let donnees: unknown = null
      try {
        donnees = await lireJson(reponse, options.maxJson)
      } catch {
        return { refus: "La réponse de la plateforme s'est interrompue.", identifiants: false, statut: 0 }
      }
      const lu = jetonDeLaReponse(reponse.status, donnees)
      if ("jeton" in lu) {
        jetonObtenu = lu.jeton
        return lu
      }
      dernier = { ...lu, statut: reponse.status }
      if (mode === "basic" && (reponse.status === 400 || reponse.status === 401)) continue
      return dernier
    }
    return dernier
  }

  function enTetes(accepte: string): Record<string, string> {
    return {
      Authorization: `Bearer ${jetonObtenu ?? ""}`,
      Accept: accepte,
      "Request-Id": crypto.randomUUID(),
      ...organisation,
    }
  }

  async function reponseJson(reponse: Response | null): Promise<ReponseJson> {
    if (!reponse) return { statut: 0, donnees: null, redirection: false }
    if (estRedirection(reponse)) {
      await abandonner(reponse)
      return { statut: reponse.status, donnees: null, redirection: true }
    }
    try {
      return { statut: reponse.status, donnees: await lireJson(reponse, options.maxJson), redirection: false }
    } catch {
      return { statut: 0, donnees: null, redirection: false }
    }
  }

  async function appelJson(methode: "GET" | "POST", chemin: string, corps?: unknown): Promise<ReponseJson> {
    return reponseJson(await envoyer(`${config.url_flux}${chemin}`, {
      method: methode,
      headers: corps === undefined
        ? enTetes("application/json")
        : { ...enTetes("application/json"), "Content-Type": "application/json" },
      body: corps === undefined ? undefined : JSON.stringify(corps),
    }))
  }

  // Le dépôt d'un corps déjà composé (bloc DEPOT) : comme une route JSON, il ne suit aucune redirection — elle porterait
  // le fichier et le jeton chez un autre.
  async function deposer(chemin: string, corps: Uint8Array<ArrayBuffer>, typeContenu: string): Promise<ReponseJson> {
    return reponseJson(await envoyer(`${config.url_flux}${chemin}`, {
      method: "POST",
      headers: { ...enTetes("application/json"), "Content-Type": typeContenu },
      body: corps,
    }))
  }

  async function fichier(chemin: string): Promise<ReponseFichier> {
    const origine = `${config.url_flux}${chemin}`
    const hoteOrigine = new URL(origine).hostname
    let url = origine
    for (let saut = 0; saut <= options.maxRedirections; saut++) {
      const chezLaPlateforme = new URL(url).hostname === hoteOrigine
      const reponse = await envoyer(url, { method: "GET", headers: chezLaPlateforme ? enTetes("*/*") : { Accept: "*/*" } })
      if (!reponse) return { statut: 0, octets: null, tropLourd: false, redirectionRefusee: false }
      if (estRedirection(reponse)) {
        await abandonner(reponse)
        const cible = cibleRedirection(reponse.headers.get("location"), url)
        if ("refus" in cible) return { statut: reponse.status, octets: null, tropLourd: false, redirectionRefusee: true }
        url = cible.url
        continue
      }
      if (reponse.status < 200 || reponse.status >= 300) {
        await abandonner(reponse)
        return { statut: reponse.status, octets: null, tropLourd: false, redirectionRefusee: false }
      }
      try {
        const lu = await lireCorps(reponse, options.maxFichier)
        if ("tropLourd" in lu) return { statut: reponse.status, octets: null, tropLourd: true, redirectionRefusee: false }
        return { statut: reponse.status, octets: lu.octets, tropLourd: false, redirectionRefusee: false }
      } catch {
        return { statut: 0, octets: null, tropLourd: false, redirectionRefusee: false }
      }
    }
    return { statut: 310, octets: null, tropLourd: false, redirectionRefusee: true }
  }

  return { jeton, appelJson, deposer, fichier }
}
// ── FIN HTTP ────────────────────────────────────────────────────────────────────────────────────────

// ── DÉBUT ERREURS ───────────────────────────────────────────────────────────────────────────────────
// Ce que dit une plateforme qui refuse, dit en français. Une erreur porte un `errorCode` — banqup publie MISSING_TOKEN,
// FORBIDDEN_ACCESS… — et un `errorMessage` libre (banqup, pyfrctc) : seul le CODE est repris, et seulement s'il a la
// forme d'un code — un texte libre rendu tel quel serait l'écho d'une réponse que personne n'a vérifiée.
function codeDErreur(donnees: unknown): string | null {
  const code = (donnees as { errorCode?: unknown } | null)?.errorCode
  return typeof code === "string" && /^[A-Z][A-Z0-9_]{1,59}$/.test(code) ? code : null
}

function erreurPlateforme(
  etape: string, reponse: ReponseJson, droits = "de lecture des flux",
): { message: string; statut: number; acces: boolean } {
  const code = codeDErreur(reponse.donnees)
  const suffixe = code ? ` (${code})` : ""
  if (reponse.statut === 0) {
    return { message: `La plateforme n'a pas répondu à temps (${etape}). Réessayez dans un instant.`, statut: 504, acces: false }
  }
  if (reponse.redirection) {
    return {
      message: `L'adresse du service des flux renvoie vers une autre adresse (${etape}) : vérifiez-la — elle s'arrête ` +
        "avant « /v1 ».",
      statut: 502,
      acces: false,
    }
  }
  if (reponse.statut === 401 || reponse.statut === 403) {
    return {
      message: `La plateforme refuse l'accès (${etape}, ${reponse.statut})${suffixe} : l'identité ouverte au cabinet n'a ` +
        `pas les droits ${droits} de cette entreprise, ou l'organisation est à préciser.`,
      statut: 502,
      acces: true,
    }
  }
  if (reponse.statut === 404) {
    return {
      message: `La plateforme ne connaît pas cette route (${etape}, 404)${suffixe} : vérifiez l'adresse du service des ` +
        "flux, qui s'arrête avant « /v1 ».",
      statut: 502,
      acces: false,
    }
  }
  if (reponse.statut === 429) {
    return { message: `La plateforme limite le nombre d'appels (${etape}) : réessayez dans un instant.`, statut: 503, acces: false }
  }
  return { message: `La plateforme a répondu ${reponse.statut} (${etape})${suffixe}.`, statut: 502, acces: false }
}
// ── FIN ERREURS ─────────────────────────────────────────────────────────────────────────────────────

// ── DÉBUT DEPOT ─────────────────────────────────────────────────────────────────────────────────────
// Le dépôt d'une facture émise (ligne 28.5, étape c) et son suivi, tels que banqup les publie dans la description
// OpenAPI de son connecteur « afnor » : `POST /v1/flows` reçoit un corps multipart de deux parties — `flowInfo`, un objet
// JSON, et `file`, le fichier — et répond 202 avec la description du flux créé, dont son identifiant (`flowId`) ; la
// description d'un flux (`GET /v1/flows/{flowId}`) porte ensuite l'accusé de son traitement (`acknowledgement` :
// Pending, Ok ou Error, et une raison par détail) ; la recherche admet l'identifiant de suivi (`trackingId`). Le client
// pyfrctc, écrit pour Super PDP, nomme les mêmes parties.
//
// `flowInfo` ne porte que ce qui est sûr : la syntaxe — CII, le seul format que l'application produit —, le nom du
// fichier, son empreinte SHA-256 — la plateforme la vérifie à réception — et l'identifiant de suivi, qui est celui de la
// transmission en base. Ni profil ni règle de traitement : les deux sont facultatifs, la plateforme les tire de la
// facture et de l'annuaire, et pyfrctc note que Super PDP n'accepte pas encore la règle de traitement.
//
// `flowInfo` EST UN CHAMP, PAS UN FICHIER : sans nom de fichier, de type application/json — banqup le déclare ainsi, et
// un serveur qui lit les champs d'un formulaire le lit comme un texte. D'où un corps composé ici, octet par octet, et non
// par FormData, qui donnerait un nom de fichier à une partie JSON.
//
// CE QU'UNE RÉPONSE AU DÉPÔT PERMET DE DIRE : un 2xx qui rend un identifiant lisible est un dépôt ; un refus (3xx, 4xx)
// n'a rien créé, et la facture peut repartir ; tout le reste — pas de réponse, une réponse coupée, un 5xx, un 2xx sans
// identifiant — laisse l'issue INCONNUE. La transmission reste alors « envoi », et c'est le suivi qui dira, par
// l'identifiant de suivi, si la plateforme l'a reçue : repartir sur une issue inconnue pourrait la transmettre deux fois.
const SYNTAXE_DEPOSEE = "CII"
const IDENTIFIANT_FLUX = /^[!-~]{1,200}$/
const CODE_DE_RAISON = /^[A-Za-z][A-Za-z0-9_.-]{0,59}$/
// Au-delà, un dépôt que la plateforme ne connaît pas est tenu pour perdu, et la facture peut repartir. NOTRE CHOIX, aucune
// documentation publique n'en donnant : le dépôt part sous 25 secondes, et une plateforme répond de ce qu'elle a reçu
// bien avant ; le délai est large exprès, une facture transmise deux fois coûtant plus qu'une attente.
const DELAI_AVANT_ABANDON_MS = 15 * 60_000

type EtatTransmission = "envoi" | "echec" | "depose" | "accepte" | "rejete"

interface TransmissionLue {
  id: string
  facture_id: string
  canal: "plateforme" | "superpdp"
  hote: string
  flux_id: string | null
  sha256: string
  etat: EtatTransmission
  detail: string | null
  cree_le: string
  maj_le: string
}

interface InfoDepot {
  flowSyntax: string
  name: string
  sha256: string
  trackingId: string
}

// L'accusé que la description d'un flux porte : Ok, la plateforme l'a accepté ; Error, elle l'a rejeté ; tout autre
// statut, ou aucun, ne tranche rien — le flux est déposé, son verdict n'est pas rendu.
interface Accuse {
  fluxId: string
  etat: "depose" | "accepte" | "rejete"
  detail: string | null
}

type Constat = { accuse: Accuse } | { absent: true } | { indecis: string }

/** Le jour à Paris : une facture ne se date pas dans l'avenir, et la fonction tourne en UTC. */
function dateDeParis(ms: number): string {
  const parties = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(ms))
  const partie = (type: string) => parties.find((p) => p.type === type)?.value ?? ""
  return `${partie("year")}-${partie("month")}-${partie("day")}`
}

function nomDuFichier(numero: string): string {
  return `${numero.replace(/[^A-Za-z0-9._-]/g, "_")}.xml`
}

async function empreinteSha256(octets: Uint8Array<ArrayBuffer>): Promise<string> {
  const condensat = new Uint8Array(await crypto.subtle.digest("SHA-256", octets))
  return [...condensat].map((o) => o.toString(16).padStart(2, "0")).join("")
}

function corpsDuDepot(
  info: InfoDepot, fichier: Uint8Array, frontiere: string,
): { typeContenu: string; corps: Uint8Array<ArrayBuffer> } {
  if (new TextDecoder().decode(fichier).includes(frontiere)) throw new Error("La frontière du corps figure dans le fichier.")
  const texte = (s: string) => new TextEncoder().encode(s)
  const avant = texte(
    `--${frontiere}\r\nContent-Disposition: form-data; name="flowInfo"\r\nContent-Type: application/json\r\n\r\n` +
      `${JSON.stringify(info)}\r\n` +
      `--${frontiere}\r\nContent-Disposition: form-data; name="file"; filename="${info.name}"\r\n` +
      "Content-Type: application/xml\r\n\r\n",
  )
  const apres = texte(`\r\n--${frontiere}--\r\n`)
  const corps = new Uint8Array(avant.length + fichier.length + apres.length)
  corps.set(avant)
  corps.set(fichier, avant.length)
  corps.set(apres, avant.length + fichier.length)
  return { typeContenu: `multipart/form-data; boundary=${frontiere}`, corps }
}

/**
 * Ce que la réponse au dépôt permet de dire (voir l'en-tête du bloc). Le détail est une phrase en français, gardée sur
 * la transmission : seul le CODE de la plateforme y entre, jamais son texte libre.
 */
function issueDuDepot(reponse: ReponseJson):
  | { etat: "depose"; fluxId: string; detail: null }
  | { etat: "echec" | "envoi"; detail: string } {
  const code = codeDErreur(reponse.donnees)
  const suffixe = code ? `, ${code}` : ""
  if (reponse.redirection) {
    return { etat: "echec", detail: `Refusé : l'adresse du service des flux renvoie ailleurs (${reponse.statut}).` }
  }
  if (reponse.statut >= 200 && reponse.statut < 300) {
    const id = (reponse.donnees as { flowId?: unknown } | null)?.flowId
    if (typeof id === "string" && IDENTIFIANT_FLUX.test(id)) return { etat: "depose", fluxId: id, detail: null }
    return { etat: "envoi", detail: `La plateforme a répondu ${reponse.statut} sans identifiant de flux lisible : le suivi dira si elle a reçu la facture.` }
  }
  if (reponse.statut >= 400 && reponse.statut < 500) {
    return { etat: "echec", detail: `Refusé par la plateforme (${reponse.statut}${suffixe}) : rien n'a été déposé.` }
  }
  return {
    etat: "envoi",
    detail: reponse.statut === 0
      ? "La plateforme n'a pas répondu à temps : le suivi dira si elle a reçu la facture."
      : `La plateforme a répondu ${reponse.statut}${suffixe} : le suivi dira si elle a reçu la facture.`,
  }
}

/**
 * Les raisons d'un accusé : leur code, et le message de la plateforme, nettoyé et borné. La raison d'un rejet est ce que
 * le cabinet doit corriger, et seule la plateforme la connaît : l'écran la présente comme la sienne, jamais comme celle
 * de l'application. Les journaux, eux, n'en portent rien.
 */
function detailDeLAccuse(details: unknown): string | null {
  if (!Array.isArray(details)) return null
  const raisons: string[] = []
  for (const brut of details.slice(0, 5)) {
    const d = (brut !== null && typeof brut === "object" ? brut : {}) as Record<string, unknown>
    const code = typeof d.reasonCode === "string" && CODE_DE_RAISON.test(d.reasonCode) ? d.reasonCode : null
    const message = texteCourt(d.reasonMessage, 300)
    if (!code && !message) continue
    raisons.push(`${[code, message].filter((x) => x !== null).join(" : ")}${d.level === "Warning" ? " (avertissement)" : ""}`)
  }
  return raisons.length > 0 ? raisons.join(" ; ").slice(0, 2000) : null
}

function accuseDuFlux(brut: unknown): Accuse | null {
  const f = (brut !== null && typeof brut === "object" ? brut : {}) as Record<string, unknown>
  if (typeof f.flowId !== "string" || !IDENTIFIANT_FLUX.test(f.flowId)) return null
  const accuse = (f.acknowledgement !== null && typeof f.acknowledgement === "object" ? f.acknowledgement : {}) as
    Record<string, unknown>
  const etat = accuse.status === "Ok" ? "accepte" : accuse.status === "Error" ? "rejete" : "depose"
  return { fluxId: f.flowId, etat, detail: detailDeLAccuse(accuse.details) }
}

/**
 * Le dépôt retrouvé par son identifiant de suivi. Une plateforme qui ignorerait ce critère rendrait d'autres flux : on
 * ne conclut alors rien — surtout pas qu'il est absent, ce qui laisserait repartir une facture peut-être reçue.
 */
function constatDeRecherche(donnees: unknown, suivi: string): Constat {
  const resultats = (donnees as { results?: unknown } | null)?.results
  if (!Array.isArray(resultats)) return { indecis: "la plateforme a rendu une recherche illisible" }
  const portentLeSuivi = (r: unknown) => r !== null && typeof r === "object" && (r as { trackingId?: unknown }).trackingId === suivi
  if (!resultats.every(portentLeSuivi)) {
    return { indecis: "la plateforme ne retrouve pas un dépôt par son identifiant de suivi" }
  }
  if (resultats.length === 0) return { absent: true }
  if (resultats.length > 1) return { indecis: "plusieurs flux portent l'identifiant de suivi de ce dépôt" }
  const accuse = accuseDuFlux(resultats[0])
  return accuse ? { accuse } : { indecis: "la plateforme décrit ce dépôt sans identifiant de flux lisible" }
}

/** Ce que le suivi change à la transmission — `maj` nul : rien —, et ce qu'il dit au cabinet. */
function suiteDuSuivi(t: Pick<TransmissionLue, "etat" | "flux_id" | "detail" | "cree_le">, constat: Constat, maintenantMs: number): {
  maj: { etat: EtatTransmission; flux_id: string | null; detail: string | null } | null
  message: string | null
} {
  if ("accuse" in constat) {
    const a = constat.accuse
    if (t.flux_id !== null && a.fluxId !== t.flux_id) {
      return { maj: null, message: "La plateforme décrit un autre flux que celui de ce dépôt : rien n'est changé." }
    }
    if (a.etat === t.etat && a.fluxId === t.flux_id && a.detail === t.detail) return { maj: null, message: null }
    return { maj: { etat: a.etat, flux_id: a.fluxId, detail: a.detail }, message: null }
  }
  if ("indecis" in constat) return { maj: null, message: `Le suivi ne peut pas conclure : ${constat.indecis}.` }
  if (t.etat !== "envoi") {
    return { maj: null, message: "La plateforme ne retrouve plus ce flux : elle seule peut dire ce qu'il est devenu." }
  }
  const cree = instantMs(t.cree_le)
  if (cree !== null && maintenantMs - cree > DELAI_AVANT_ABANDON_MS) {
    return {
      maj: { etat: "echec", flux_id: null, detail: "La plateforme ne connaît pas ce dépôt : il n'a pas abouti, et la facture peut repartir." },
      message: null,
    }
  }
  return { maj: null, message: "La plateforme ne connaît pas encore ce dépôt : réessayez dans quelques minutes." }
}
// ── FIN DEPOT ───────────────────────────────────────────────────────────────────────────────────────

// Les trois types que les blocs du générateur nomment, déclarés comme src/lib/types.ts les déclare
// (copiesFacturation.test.ts le vérifie).
type StatutTva = 'redevable' | 'franchise' | 'exonere'
type ArticleExoneration = 'cgi_261_4_1' | 'cgi_261_4_4_a' | 'cgi_261_4_4_b' | 'cgi_261_c_2'
type NatureOperation = 'biens' | 'services' | 'mixte'

// ── DÉBUT COPIE montantsFacture ──────────────────────────────────────────────────────────────────────────────────────
// Ce bloc est recopié AU CARACTÈRE PRÈS dans les Edge Functions qui transmettent une facture (superpdp-emit,
// plateforme-agreee) : elles sont auto-portées, et le générateur de la facture électronique, qu'elles recopient aussi,
// en dépend. `copiesFacturation.test.ts` compare chaque copie à celui-ci et l'exécute seule.

export interface LigneCalculee {
  montant_ht: number
  montant_tva: number
  montant_ttc: number
}

// Au centime, le demi ÉLOIGNÉ DE ZÉRO, dans les deux sens. `Math.round` arrondit le demi vers +∞ : une ligne d'avoir
// à -0,125 € valait -0,12 € quand la même ligne d'une facture vaut 0,13 €. L'avoir, relu dans son sens par le
// générateur de la facture électronique (un avoir de la norme porte des montants positifs), ne retrouvait plus les
// montants qu'on avait enregistrés, et ne se transmettait pas. Un montant positif s'arrondit exactement comme avant.
function auCentime(x: number): number {
  const c = Math.round(Math.abs(x) * 100) / 100
  return c === 0 ? 0 : x < 0 ? -c : c
}

// Arrondi à 2 décimales systématique — chaque ligne est arrondie avant d'être sommée (comme le ferait
// n'importe quel logiciel de facturation), plutôt que de sommer des valeurs flottantes brutes puis
// arrondir le total : les deux méthodes peuvent différer d'un centime sur certains taux de TVA.
export function calculerLigne(quantite: number, prixUnitaireHt: number, tauxTva: number): LigneCalculee {
  const ht = auCentime(quantite * prixUnitaireHt)
  const tva = auCentime(ht * (tauxTva / 100))
  return { montant_ht: ht, montant_tva: tva, montant_ttc: auCentime(ht + tva) }
}
// ── FIN COPIE montantsFacture ────────────────────────────────────────────────────────────────────────────────────────

// ── DÉBUT COPIE statutTva ────────────────────────────────────────────────────────────────────────────────────────────
// Ce bloc est recopié AU CARACTÈRE PRÈS dans les Edge Functions qui transmettent une facture (superpdp-emit,
// plateforme-agreee) : le générateur de la facture électronique, qu'elles recopient aussi, en tire le motif d'une
// ligne à 0 % et le refus d'une ligne taxée. `copiesFacturation.test.ts` compare chaque copie à celui-ci et l'exécute.

export interface Exoneration {
  code: ArticleExoneration
  // Ce que l'article exonère, pour la liste de choix.
  objet: string
  // La disposition, telle qu'une facture la cite.
  reference: string
  // La mention de la facture : la référence de la disposition qui exonère (CGI, ann. II, art. 242 nonies A).
  mention: string
  // Le code du motif d'exonération (BT-121 de la norme EN 16931), dans la liste VATEX que la France a complétée. La
  // facture électronique (factureCii.ts) transmet le code ET le texte, et le validateur officiel de la norme les accepte.
  vatex: string
}

// La liste fermée de la base (`dossiers_article_exoneration_check`) : `statutTva.test.ts` la confronte à la
// migration exportée. Un article qui n'y est pas se saisit à la main sur la facture.
export const EXONERATIONS: readonly Exoneration[] = [
  {
    code: 'cgi_261_4_1',
    objet: 'Soins dispensés par les professions médicales et paramédicales',
    reference: 'art. 261, 4, 1° du CGI',
    mention: 'Exonération de TVA, art. 261, 4, 1° du CGI.',
    vatex: 'VATEX-FR-CGI261-4',
  },
  {
    code: 'cgi_261_4_4_a',
    objet: 'Enseignement scolaire ou universitaire, formation professionnelle continue',
    reference: 'art. 261, 4, 4° a du CGI',
    mention: 'Exonération de TVA, art. 261, 4, 4° a du CGI.',
    vatex: 'VATEX-FR-CGI261-4',
  },
  {
    code: 'cgi_261_4_4_b',
    objet: 'Cours particuliers donnés par une personne physique à ses élèves',
    reference: 'art. 261, 4, 4° b du CGI',
    mention: 'Exonération de TVA, art. 261, 4, 4° b du CGI.',
    vatex: 'VATEX-FR-CGI261-4',
  },
  {
    code: 'cgi_261_c_2',
    objet: 'Assurance et réassurance, courtage et intermédiation en assurance',
    reference: 'art. 261 C, 2° du CGI',
    mention: 'Exonération de TVA, art. 261 C, 2° du CGI.',
    vatex: 'VATEX-FR-CGI261C-2',
  },
]

export function exonerationDe(article: ArticleExoneration | null): Exoneration | null {
  return article == null ? null : EXONERATIONS.find((e) => e.code === article) ?? null
}

export const MENTION_FRANCHISE = 'TVA non applicable, art. 293 B du CGI.'
export const VATEX_FRANCHISE = 'VATEX-FR-FRANCHISE'

export interface MotifExoneration {
  // La catégorie de TVA de la ligne (BT-151) : E, exonérée — la franchise en base comprise, dans la norme.
  categorie: 'E'
  code: string
  texte: string
}

// Le motif d'une ligne à 0 % qu'on transmet à une plateforme (BT-120, BT-121), ou la raison de ne pas la
// transmettre : un motif faux part dans une facture que l'administration reçoit, et ne se reprend que par un avoir.
export function motifExoneration(
  statut: StatutTva | null, article: ArticleExoneration | null,
): { motif: MotifExoneration; refus: null } | { motif: null; refus: string } {
  if (statut == null) {
    return { motif: null, refus: 'Le statut de TVA du dossier est à préciser : choisis-le dans l’onglet TVA du dossier avant de transmettre une facture.' }
  }
  if (statut === 'franchise') {
    return { motif: { categorie: 'E', code: VATEX_FRANCHISE, texte: MENTION_FRANCHISE }, refus: null }
  }
  const exoneration = exonerationDe(article)
  if (exoneration) {
    return { motif: { categorie: 'E', code: exoneration.vatex, texte: exoneration.mention }, refus: null }
  }
  return {
    motif: null,
    refus: statut === 'exonere'
      ? 'Le dossier est exonéré sans article d’exonération : choisis-le dans l’onglet TVA du dossier avant de transmettre une facture à 0 %.'
      : 'Une ligne à 0 % d’un dossier redevable demande l’article de son exonération : choisis-le dans l’onglet TVA du dossier, ou corrige le taux.',
  }
}

// Une ligne qui porte de la TVA sur la facture d'un dossier qui n'en facture pas. Toute personne qui mentionne la
// TVA sur une facture en devient redevable du seul fait de l'avoir facturée (CGI, art. 283, 3) : c'est une
// facture à corriger par un avoir, pas à transmettre.
export function refusTauxPositif(statut: StatutTva | null, taux: number): string | null {
  if (taux <= 0) return null
  const tauxLu = `${String(taux).replace('.', ',')}\u00a0%`
  if (statut === 'franchise') {
    return `Un dossier en franchise en base ne facture pas de TVA : une ligne à ${tauxLu} la rendrait due (art. 283, 3 du CGI). `
      + 'S’il a dépassé les seuils de la franchise, il est redevable : change son statut de TVA.'
  }
  if (statut === 'exonere') {
    return `Un dossier exonéré ne facture pas de TVA : une ligne à ${tauxLu} la rendrait due (art. 283, 3 du CGI). `
      + 'Si une partie de son activité est taxable, il est redevable, avec l’article de son exonération.'
  }
  return null
}
// ── FIN COPIE statutTva ──────────────────────────────────────────────────────────────────────────────────────────────

// ── DÉBUT COPIE factureCii ───────────────────────────────────────────────────────────────────────────────────────────
// Ce bloc est recopié AU CARACTÈRE PRÈS dans les Edge Functions qui transmettent une facture (superpdp-emit,
// plateforme-agreee), après ceux de montantsFacture.ts et de statutTva.ts : elles sont auto-portées, et ce qu'elles
// transmettent doit être le fichier que les tests de ce module ont passé au validateur officiel. Il ne nomme rien
// d'autre hors de lui que trois types, que chaque fonction déclare comme types.ts les déclare (StatutTva,
// ArticleExoneration, NatureOperation). `copiesFacturation.test.ts` compare chaque copie à celui-ci et l'exécute.

export const PROFIL_EN16931 = 'urn:cen.eu:en16931:2017'

// L'unité « pièce » de la recommandation 20 de la CEE-ONU : l'application ne distingue pas encore les unités par ligne
// (une heure, un kilogramme), et la règle BR-23 en exige une sur chaque ligne.
export const UNITE_GENERIQUE = 'C62'

// Les taux que la DGFiP admet (règle G1.24), en pour cent.
export const TAUX_ADMIS: readonly number[] = [0, 0.9, 1.05, 1.75, 2.1, 5.5, 7, 8.5, 9.2, 9.6, 10, 13, 19.6, 20, 20.6]

// L'adresse électronique d'une partie dans l'annuaire de la facturation électronique : le schéma « FRCTC electronic
// address » (0225 de la liste ISO 6523, que l'annexe 7 de la DGFiP ajoute), dont la valeur est le SIREN, puis au besoin
// le SIRET, un code de routage ou un suffixe, séparés par « _ » (règles G1.93, G1.95 et G1.115).
export const SCHEMA_ADRESSE_ELECTRONIQUE = '0225'
const SCHEMA_SIREN = '0002'
const SCHEMA_SIRET = '0009'

const NS = {
  rsm: 'urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100',
  qdt: 'urn:un:unece:uncefact:data:standard:QualifiedDataType:100',
  ram: 'urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100',
  udt: 'urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100',
} as const

export interface VendeurCii {
  // L'identité de l'émetteur, telle que la facture l'a figée à sa validation (emetteur_nom, emetteur_siret,
  // emetteur_adresse) — jamais celle d'aujourd'hui.
  nom: string | null
  siret: string | null
  adresse: string | null
  // Le numéro de TVA intracommunautaire du dossier (BT-31). Celui d'un dossier redevable se calcule sur son SIREN
  // (`numeroTvaFrancais`) ; un dossier en franchise ou exonéré n'en a pas toujours un, et le module ne l'invente pas.
  numeroTva: string | null
  statutTva: StatutTva | null
  articleExoneration: ArticleExoneration | null
}

export interface OrigineCii {
  numero: string | null
  date_emission: string
}

// Une ligne de la facture (`facture_lignes`), telle que le générateur la lit.
export interface LigneCii {
  ordre: number
  designation: string
  quantite: number
  prix_unitaire_ht: number
  taux_tva: number
}

// La facture (`factures_emises`), telle que le générateur la lit : les colonnes dont il se sert, sous leurs types en
// base. FactureEmise (types.ts) en porte d'autres, et le compilateur vérifie qu'elle se lit comme celle-ci
// (copiesFacturation.test.ts) : une valeur ajoutée à l'une de ses listes fermées ne passerait pas ici en silence.
export interface FactureCii {
  numero: string | null
  statut: 'brouillon' | 'validee'
  type: 'facture' | 'avoir'
  date_emission: string
  date_echeance: string | null
  tiers_nom: string
  tiers_adresse: string | null
  tiers_siret: string | null
  montant_ht: number
  montant_tva: number
  montant_ttc: number
  mentions_legales: string | null
  notes: string | null
  type_client: 'assujetti' | 'organisme_public' | 'non_assujetti' | 'etranger' | null
  tiers_siren: string | null
  tiers_adresse_electronique: string | null
  code_service: string | null
  numero_engagement: string | null
  nature_operation: NatureOperation | null
  date_prestation: string | null
  periode_debut: string | null
  periode_fin: string | null
  livraison_adresse: string | null
  livraison_code_postal: string | null
  livraison_ville: string | null
  livraison_pays: string | null
  option_debits: boolean | null
}

export interface DonneesCii {
  facture: FactureCii
  lignes: LigneCii[]
  vendeur: VendeurCii
  // La facture qu'un avoir corrige (règles BR-55 et G1.31 : son numéro, et sa date).
  origine: OrigineCii | null
  // AAAA-MM-JJ : une facture ne se date pas dans l'avenir (règle G1.07).
  aujourdHui: string
}

// ── Identifiants ───────────────────────────────────────────────────────────────────────────────────────────────────

// La clé de Luhn : le dernier chiffre d'un SIREN ou d'un SIRET contrôle les autres (INSEE). Elle attrape la faute de
// frappe que l'annuaire refuserait — après la transmission, et sans dire laquelle.
function luhn(chiffres: string): boolean {
  let somme = 0
  for (let i = 0; i < chiffres.length; i++) {
    let d = Number(chiffres[chiffres.length - 1 - i])
    if (i % 2 === 1) {
      d *= 2
      if (d > 9) d -= 9
    }
    somme += d
  }
  return somme % 10 === 0
}

export function sirenValide(siren: string | null | undefined): siren is string {
  return siren != null && /^\d{9}$/.test(siren) && luhn(siren)
}

// Les établissements de La Poste (SIREN 356000000), trop nombreux pour la clé de Luhn, ont un SIRET dont la somme des
// chiffres est un multiple de 5 (INSEE) ; son siège (35600000000048) garde la clé de Luhn.
const SIEGE_DE_LA_POSTE = '35600000000048'

export function siretValide(siret: string | null | undefined): siret is string {
  if (siret == null || !/^\d{14}$/.test(siret)) return false
  if (siret.startsWith('356000000') && siret !== SIEGE_DE_LA_POSTE) {
    return [...siret].reduce((s, c) => s + Number(c), 0) % 5 === 0
  }
  return luhn(siret)
}

export function sirenDe(siret: string | null | undefined): string | null {
  const chiffres = (siret ?? '').replace(/\s/g, '')
  return /^\d{9}(\d{5})?$/.test(chiffres) ? chiffres.slice(0, 9) : null
}

// Le numéro de TVA intracommunautaire français d'une entreprise : FR, une clé de deux chiffres, le SIREN (CGI, art. 286
// ter ; clé = (12 + 3 × (SIREN modulo 97)) modulo 97).
export function numeroTvaFrancais(siren: string): string {
  const cle = (12 + 3 * (Number(siren) % 97)) % 97
  return `FR${String(cle).padStart(2, '0')}${siren}`
}

// ── Adresse ────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface AdresseStructuree {
  lignes: string[]
  codePostal: string | null
  ville: string | null
}

// Une adresse saisie en texte libre, rangée dans les champs de la norme (BT-35 à BT-38) : la ligne qui commence par un
// code postal français de cinq chiffres donne le code postal et la ville, les autres sont les lignes de l'adresse.
// Une adresse sur une seule ligne qui finit par « , 75001 Paris » se lit de même. Rien d'autre n'est interprété : sans
// code postal reconnu, tout reste dans les lignes, telles qu'écrites.
export function adresseStructuree(texte: string | null): AdresseStructuree {
  let lignes = (texte ?? '').split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter((l) => l !== '')
  if (lignes.length === 1) {
    const m = /^(.+?),\s*(\d{5}\s+\S.*)$/.exec(lignes[0])
    if (m) lignes = [m[1].trim(), m[2].trim()]
  }
  for (let i = lignes.length - 1; i >= 0; i--) {
    const m = /^(\d{5})\s+(\S.*)$/.exec(lignes[i])
    if (m) return { lignes: lignes.filter((_, j) => j !== i), codePostal: m[1], ville: m[2] }
  }
  return { lignes, codePostal: null, ville: null }
}

// ── Lignes et montants ─────────────────────────────────────────────────────────────────────────────────────────────

export type CategorieTva = 'S' | 'E'

export interface LigneDocument {
  numero: number
  libelle: string
  // Dans le sens du document : positives sur une facture comme sur un avoir, sauf une remise, négative.
  quantite: number
  prix: number
  taux: number
  categorie: CategorieTva
  htCentimes: number
  tvaCentimes: number
}

export interface GroupeTva {
  categorie: CategorieTva
  taux: number
  baseCentimes: number
  tvaCentimes: number
  codeMotif: string | null
  motif: string | null
}

export interface MontantsDocument {
  lignes: LigneDocument[]
  groupes: GroupeTva[]
  htCentimes: number
  tvaCentimes: number
  ttcCentimes: number
}

const centimes = (euros: number) => Math.round(euros * 100)

// La ligne dans le sens du document. Le prix d'une ligne de la norme n'est jamais négatif (règle BR-27, G1.16) : une
// remise saisie avec un prix négatif se transmet avec une quantité négative, au même produit — donc au même montant,
// au bit près, puisque le produit de deux flottants ne dépend pas de leurs signes.
export function montantsDuDocument(facture: Pick<FactureCii, 'type'>, lignes: LigneCii[], motif: { code: string; texte: string } | null): MontantsDocument {
  const sens = facture.type === 'avoir' ? -1 : 1
  const triees = [...lignes].sort((a, b) => a.ordre - b.ordre)
  const doc: LigneDocument[] = triees.map((l, i) => {
    let quantite = l.quantite * sens
    let prix = l.prix_unitaire_ht
    if (prix < 0) {
      quantite = -quantite
      prix = -prix
    }
    const c = calculerLigne(quantite, prix, l.taux_tva)
    return {
      numero: i + 1,
      libelle: l.designation,
      quantite: quantite === 0 ? 0 : quantite,
      prix,
      taux: l.taux_tva,
      categorie: l.taux_tva > 0 ? 'S' : 'E',
      htCentimes: centimes(c.montant_ht),
      tvaCentimes: centimes(c.montant_tva),
    }
  })
  const groupes: GroupeTva[] = []
  for (const l of doc) {
    let g = groupes.find((x) => x.categorie === l.categorie && x.taux === l.taux)
    if (!g) {
      g = {
        categorie: l.categorie,
        taux: l.taux,
        baseCentimes: 0,
        tvaCentimes: 0,
        codeMotif: l.categorie === 'E' ? motif?.code ?? null : null,
        motif: l.categorie === 'E' ? motif?.texte ?? null : null,
      }
      groupes.push(g)
    }
    g.baseCentimes += l.htCentimes
    g.tvaCentimes += l.tvaCentimes
  }
  // Dans un ordre qui ne dépend pas de la saisie : les taux du plus fort au plus faible.
  groupes.sort((a, b) => b.taux - a.taux)
  const htCentimes = doc.reduce((s, l) => s + l.htCentimes, 0)
  const tvaCentimes = doc.reduce((s, l) => s + l.tvaCentimes, 0)
  return { lignes: doc, groupes, htCentimes, tvaCentimes, ttcCentimes: htCentimes + tvaCentimes }
}

// ── Ce qui empêche de transmettre ──────────────────────────────────────────────────────────────────────────────────

// Un nombre décimal écrit sans exposant, avec au plus `decimales` chiffres après le point ; null s'il en porte plus, ou
// s'il ne s'écrit pas exactement — infini, ou au-delà de 2^53 unités de sa dernière décimale, où un nombre à virgule
// flottante ne dit plus ses derniers chiffres : `Number.isSafeInteger` écarte les deux. Les quantités admettent quatre
// décimales (G1.15), les prix six (G1.16).
export function decimal(x: number, decimales: number): string | null {
  const f = 10 ** decimales
  const entier = Math.round(x * f)
  if (!Number.isSafeInteger(entier) || Math.abs(x * f - entier) > 1e-6) return null
  const a = Math.abs(entier)
  const fraction = String(a % f).padStart(decimales, '0').replace(/0+$/, '')
  return `${entier < 0 ? '-' : ''}${Math.floor(a / f)}${fraction ? `.${fraction}` : ''}`
}

// Une date AAAA-MM-JJ écrite JJ/MM/AAAA, comme l'écrit formatDate (format.ts), que le bloc ne peut pas nommer ;
// une valeur d'une autre forme est rendue telle quelle.
function dateLisible(iso: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : iso
}

const NUMERO_ADMIS = /^[A-Za-z0-9 +_/-]{1,35}$/
const BORNES = '(années 2000 à 2099)'

// Le numéro d'une facture (G1.05) : 35 caractères au plus, chiffres, lettres, espace, « - », « + », « _ » et « / »,
// sans espace en tête, en fin ni doublé.
export function numeroAdmis(numero: string): boolean {
  return NUMERO_ADMIS.test(numero) && numero.trim() === numero && !numero.includes('  ')
}

const ADRESSE_ELECTRONIQUE = /^\d{9}(_[A-Za-z0-9._-]+(_[A-Za-z0-9_-]+)?)?$/

// Une année de 2000 à 2099, dans toute date que la facture transmet (règle G1.36).
function anneeAdmise(date: string): boolean {
  const annee = Number(date.slice(0, 4))
  return annee >= 2000 && annee <= 2099
}

// Les codes d'exonération qui sortent une facture entre entreprises de la facturation électronique (règle G2.32) :
// une facture qui ne porte QUE des opérations exonérées par les articles 261 à 261 E ne se transmet pas — sauf à un
// organisme public, que la règle excepte. La règle en énumère dix-neuf, et ce sont exactement les codes de la liste
// VATEX qui commencent ainsi (artefacts de validation 1.3.16) : le préfixe ne désigne rien d'autre.
function exonerationHorsChamp(code: string | null): boolean {
  return code != null && code.startsWith('VATEX-FR-CGI261')
}

// Tout ce qui empêche de transmettre la facture, dans l'ordre où l'écran le dit ; vide quand elle peut partir.
export function refusEmission(d: DonneesCii): string[] {
  const { facture: f, vendeur: v } = d
  const refus: string[] = []

  if (f.statut !== 'validee' || !f.numero) return ['Seule une facture validée se transmet.']
  if (!numeroAdmis(f.numero)) {
    refus.push(`Le numéro ${f.numero} ne peut pas être transmis : 35 caractères au plus — chiffres, lettres, espace, « - », « + », « _ » et « / ».`)
  }
  if (!anneeAdmise(f.date_emission)) refus.push(`La date d’émission (${dateLisible(f.date_emission)}) n’est pas une date admise ${BORNES}.`)
  else if (f.date_emission > d.aujourdHui) refus.push(`La facture est datée du ${dateLisible(f.date_emission)}, qui n’est pas encore arrivé.`)

  // Le destinataire. Un particulier et un client établi hors de France ne reçoivent pas de facture électronique :
  // l'opération se déclare par l'e-reporting.
  switch (f.type_client) {
    case null:
      refus.push('Dis à qui la facture est adressée : une entreprise assujettie, ou un organisme public.')
      break
    case 'non_assujetti':
      refus.push('Une facture à un particulier ne passe pas par la plateforme : l’opération se déclare par l’e-reporting.')
      break
    case 'etranger':
      refus.push('Une facture à un client établi hors de France ne passe pas par la plateforme : l’opération se déclare par l’e-reporting.')
      break
  }
  const versEntreprise = f.type_client === 'assujetti' || f.type_client === 'organisme_public'

  if (f.nature_operation == null) {
    refus.push('Dis si la facture porte sur des livraisons de biens, des prestations de services, ou les deux.')
  }

  // Le vendeur.
  const sirenVendeur = sirenDe(v.siret)
  if (!v.nom?.trim()) refus.push('Le nom du dossier manque à la facture.')
  if (!sirenValide(sirenVendeur)) refus.push('Le SIRET du dossier, figé sur la facture, ne donne pas un SIREN valide (neuf chiffres et leur clé).')
  if (!v.adresse?.trim()) refus.push('L’adresse du dossier manque à la facture.')

  // Le client.
  if (versEntreprise) {
    if (!f.tiers_nom.trim()) refus.push('Le nom du client manque.')
    if (!sirenValide(f.tiers_siren)) refus.push('Le SIREN du client manque ou ne passe pas sa clé de contrôle.')
    if (!f.tiers_adresse?.trim()) refus.push('L’adresse du client manque.')
    const siret = f.tiers_siret?.replace(/\s/g, '') ?? null
    if (f.type_client === 'organisme_public' && !siret) {
      refus.push('Un organisme public se désigne par son SIRET (Chorus Pro) : indique celui du service destinataire.')
    }
    // Ce qui découle du SIREN ne se juge que sur un SIREN valide : son refus est déjà dit, et le redire sous une autre
    // forme ferait chercher deux fautes là où il n'y en a qu'une.
    if (siret) {
      if (!siretValide(siret)) refus.push('Le SIRET du client ne passe pas sa clé de contrôle.')
      else if (sirenValide(f.tiers_siren) && !siret.startsWith(f.tiers_siren)) refus.push('Le SIRET du client ne commence pas par son SIREN.')
    }
    const adresse = f.tiers_adresse_electronique
    if (adresse != null && !ADRESSE_ELECTRONIQUE.test(adresse)) {
      refus.push('L’adresse de facturation électronique du client n’a pas la forme que l’annuaire publie : SIREN, SIREN_SIRET ou SIREN_suffixe.')
    } else if (adresse != null && sirenValide(f.tiers_siren) && !adresse.startsWith(f.tiers_siren)) {
      refus.push('L’adresse de facturation électronique du client ne commence pas par son SIREN.')
    }
  }

  // La TVA, ligne par ligne.
  const motifConnu = motifExoneration(v.statutTva, v.articleExoneration)
  if (v.statutTva == null && motifConnu.refus) refus.push(motifConnu.refus)
  const triees = [...d.lignes].sort((a, b) => a.ordre - b.ordre)
  if (triees.length === 0) refus.push('La facture n’a aucune ligne.')
  const motifs = new Set<string>()
  triees.forEach((l, i) => {
    const n = i + 1
    if (!l.designation.trim()) refus.push(`Ligne ${n} : sa désignation manque.`)
    if (decimal(l.quantite, 4) == null) refus.push(`Ligne ${n} : la quantité ne s’écrit pas avec quatre décimales au plus.`)
    if (decimal(Math.abs(l.prix_unitaire_ht), 6) == null) refus.push(`Ligne ${n} : le prix ne s’écrit pas avec six décimales au plus.`)
    if (!TAUX_ADMIS.includes(l.taux_tva)) {
      refus.push(`Ligne ${n} : le taux de ${String(l.taux_tva).replace('.', ',')} % n’est pas un taux de TVA admis.`)
    } else if (l.taux_tva > 0) {
      const r = refusTauxPositif(v.statutTva, l.taux_tva)
      if (r) refus.push(`Ligne ${n} : ${r}`)
    } else if (v.statutTva != null && motifConnu.refus) {
      motifs.add(motifConnu.refus)
    }
  })
  for (const m of motifs) refus.push(m)

  const motif = motifConnu.motif ? { code: motifConnu.motif.code, texte: motifConnu.motif.texte } : null
  const m = montantsDuDocument(f, triees, motif)
  const sens = f.type === 'avoir' ? -1 : 1
  if (triees.length > 0) {
    if (m.ttcCentimes <= 0) {
      refus.push(f.type === 'avoir'
        ? 'Un avoir crédite un montant : son total doit être positif.'
        : 'Le total de la facture n’est pas positif : un montant à rendre au client se fait par un avoir.')
    }
    if (centimes(sens * f.montant_ht) !== m.htCentimes || centimes(sens * f.montant_tva) !== m.tvaCentimes
      || centimes(sens * f.montant_ttc) !== m.ttcCentimes) {
      refus.push('Les montants enregistrés de la facture ne se retrouvent pas dans ses lignes : elle ne peut pas être transmise telle quelle.')
    }
  }

  // Entre entreprises, une facture qui ne porte que des opérations exonérées par l'article 261 sort du champ (G2.32) :
  // c'est alors tout ce qu'il y a à dire, et réclamer le numéro de TVA du dossier laisserait croire qu'il suffirait.
  const horsChamp = f.type_client === 'assujetti' && m.groupes.length > 0
    && m.groupes.every((g) => g.categorie === 'E' && exonerationHorsChamp(g.codeMotif))
  if (horsChamp) {
    refus.push('Une facture dont toutes les opérations sont exonérées par les articles 261 à 261 E du CGI n’entre pas dans la facturation électronique entre entreprises.')
  }

  // Une ligne à 0 % ou au taux normal demande le numéro de TVA du vendeur (règles BR-S-02, BR-E-02, G1.47). Celui d'un
  // dossier redevable découle de son SIREN, et un statut à préciser se dit déjà : un numéro absent ne se réclame que
  // s'il ne découle pas d'une faute déjà dite.
  if (triees.length > 0 && !horsChamp) {
    if (!v.numeroTva) {
      if (v.statutTva === 'franchise' || v.statutTva === 'exonere') {
        refus.push('Le numéro de TVA intracommunautaire du dossier est nécessaire à une facture sans TVA (règle G1.47 de la DGFiP) : '
          + 'l’application ne le connaît pas pour un dossier en franchise ou exonéré.')
      } else if (v.statutTva === 'redevable' && sirenValide(sirenVendeur)) {
        refus.push('Le numéro de TVA intracommunautaire du dossier manque.')
      }
    } else if (sirenValide(sirenVendeur) && v.numeroTva !== numeroTvaFrancais(sirenVendeur)) {
      refus.push('Le numéro de TVA intracommunautaire du dossier ne correspond pas à son SIREN.')
    }
  }

  // Ce que la facture doit dire du paiement et de l'opération.
  if (f.type === 'facture' && !f.date_echeance) {
    refus.push('Indique la date d’échéance : la facture porte la date à laquelle le règlement doit intervenir (art. L441-9 du code de commerce).')
  }
  if (f.type === 'facture' && f.date_echeance && !anneeAdmise(f.date_echeance)) refus.push(`La date d’échéance n’est pas une date admise ${BORNES}.`)
  if (f.type === 'avoir') {
    if (!d.origine || !d.origine.numero) refus.push('L’avoir doit citer la facture qu’il corrige.')
    else {
      // La facture corrigée se transmet par son numéro et sa date (BT-25, BT-26) : les mêmes règles que les siens.
      if (!numeroAdmis(d.origine.numero)) refus.push(`Le numéro de la facture corrigée (${d.origine.numero}) ne peut pas être transmis.`)
      if (!anneeAdmise(d.origine.date_emission)) refus.push(`La date de la facture corrigée n’est pas une date admise ${BORNES}.`)
    }
  }
  if (f.periode_debut && f.periode_fin) {
    if (!anneeAdmise(f.periode_debut) || !anneeAdmise(f.periode_fin)) refus.push(`La période de la prestation porte une date qui n’est pas admise ${BORNES}.`)
    else if (f.periode_fin < f.periode_debut) refus.push('La période de la prestation finit avant de commencer.')
  }
  if (f.date_prestation && !anneeAdmise(f.date_prestation)) refus.push(`La date de la livraison ou de la prestation n’est pas une date admise ${BORNES}.`)

  return refus
}

// ── Écriture ───────────────────────────────────────────────────────────────────────────────────────────────────────

interface Noeud {
  nom: string
  attributs?: Record<string, string>
  texte?: string
  enfants?: (Noeud | null)[]
}

// Les caractères que XML 1.0 n'admet pas sont retirés, les autres échappés.
function echapper(t: string): string {
  return t
    .replace(/[^\t\n\r\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const uneLigne = (t: string) => t.replace(/\s+/g, ' ').trim()

function el(nom: string, contenu: string | (Noeud | null)[], attributs?: Record<string, string>): Noeud {
  return typeof contenu === 'string' ? { nom, attributs, texte: contenu } : { nom, attributs, enfants: contenu }
}

function serialiser(n: Noeud, profondeur: number): string {
  const retrait = '  '.repeat(profondeur)
  const attributs = Object.entries(n.attributs ?? {}).map(([k, v]) => ` ${k}="${echapper(v)}"`).join('')
  if (n.texte !== undefined) return `${retrait}<${n.nom}${attributs}>${echapper(n.texte)}</${n.nom}>`
  const enfants = (n.enfants ?? []).filter((e): e is Noeud => e !== null)
  if (enfants.length === 0) return `${retrait}<${n.nom}${attributs}/>`
  return [`${retrait}<${n.nom}${attributs}>`, ...enfants.map((e) => serialiser(e, profondeur + 1)), `${retrait}</${n.nom}>`].join('\n')
}

const date102 = (iso: string) => iso.slice(0, 10).replace(/-/g, '')

function dateCii(nom: string, iso: string, prefixe: 'udt' | 'qdt' = 'udt'): Noeud {
  return el(nom, [el(`${prefixe}:DateTimeString`, date102(iso), { format: '102' })])
}

function montant(c: number): string {
  const a = Math.abs(c)
  return `${c < 0 ? '-' : ''}${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`
}

function adresseCii(nom: string, adresse: AdresseStructuree, pays: string): Noeud {
  const lignes = adresse.lignes.length > 3 ? [...adresse.lignes.slice(0, 2), adresse.lignes.slice(2).join(', ')] : adresse.lignes
  return el(nom, [
    adresse.codePostal ? el('ram:PostcodeCode', adresse.codePostal) : null,
    lignes[0] ? el('ram:LineOne', lignes[0]) : null,
    lignes[1] ? el('ram:LineTwo', lignes[1]) : null,
    lignes[2] ? el('ram:LineThree', lignes[2]) : null,
    adresse.ville ? el('ram:CityName', adresse.ville) : null,
    el('ram:CountryID', pays),
  ])
}

const CADRES: Record<NatureOperation, string> = { biens: 'B1', services: 'S1', mixte: 'M1' }

// Le cadre de facturation (BT-23, règle G1.02) : le dépôt d'une facture de biens, de services, ou des deux. Les cadres
// « déjà payée », « définitive après acompte », de sous-traitance ou de cotraitance ne sont pas modélisés.
export function cadreDeFacturation(nature: NatureOperation): string {
  return CADRES[nature]
}

// L'option pour la TVA sur les débits ne vise que les prestations de services : sur une facture de biens seuls, elle
// ne dit rien (règle G1.43).
function optionDebitsApplicable(f: Pick<FactureCii, 'option_debits' | 'nature_operation'>): boolean {
  return f.option_debits === true && (f.nature_operation === 'services' || f.nature_operation === 'mixte')
}

export type ResultatCii = { xml: string; refus: [] } | { xml: null; refus: string[] }

// La facture en CII, ou ce qui l'empêche de l'être.
export function factureCii(d: DonneesCii): ResultatCii {
  const refus = refusEmission(d)
  if (refus.length > 0) return { xml: null, refus }
  const { facture: f, vendeur: v } = d
  const motifConnu = motifExoneration(v.statutTva, v.articleExoneration).motif
  const motif = motifConnu ? { code: motifConnu.code, texte: motifConnu.texte } : null
  const m = montantsDuDocument(f, d.lignes, motif)
  const sirenVendeur = sirenDe(v.siret) as string
  const siretClient = f.tiers_siret?.replace(/\s/g, '') || null
  // L'option pour les débits se dit dans chaque ventilation de TVA (règle G1.43, et S1.13 des spécifications : la même
  // valeur partout), dès que le prestataire a opté — comme la mention imprimée (11° bis), qui ne regarde pas les lignes.
  const debits = optionDebitsApplicable(f)
  // L'adresse de livraison n'existe que sur une facture de biens ou mixte : la base le garantit
  // (factures_emises_livraison_de_biens), et ses quatre champs vont ensemble (factures_emises_livraison_complete).
  const livraison = f.livraison_adresse && f.livraison_code_postal && f.livraison_ville && f.livraison_pays
    ? { lignes: [uneLigne(f.livraison_adresse)], codePostal: f.livraison_code_postal, ville: f.livraison_ville, pays: f.livraison_pays }
    : null

  const notes = [f.notes, f.mentions_legales].filter((t): t is string => !!t && t.trim() !== '')

  const lignes = m.lignes.map((l) => el('ram:IncludedSupplyChainTradeLineItem', [
    el('ram:AssociatedDocumentLineDocument', [el('ram:LineID', String(l.numero))]),
    el('ram:SpecifiedTradeProduct', [el('ram:Name', uneLigne(l.libelle))]),
    el('ram:SpecifiedLineTradeAgreement', [
      el('ram:NetPriceProductTradePrice', [el('ram:ChargeAmount', decimal(l.prix, 6) as string)]),
    ]),
    el('ram:SpecifiedLineTradeDelivery', [el('ram:BilledQuantity', decimal(l.quantite, 4) as string, { unitCode: UNITE_GENERIQUE })]),
    el('ram:SpecifiedLineTradeSettlement', [
      el('ram:ApplicableTradeTax', [
        el('ram:TypeCode', 'VAT'),
        el('ram:CategoryCode', l.categorie),
        el('ram:RateApplicablePercent', decimal(l.taux, 2) as string),
      ]),
      el('ram:SpecifiedTradeSettlementLineMonetarySummation', [el('ram:LineTotalAmount', montant(l.htCentimes))]),
    ]),
  ]))

  const document = el('rsm:CrossIndustryInvoice', [
    el('rsm:ExchangedDocumentContext', [
      el('ram:BusinessProcessSpecifiedDocumentContextParameter', [el('ram:ID', cadreDeFacturation(f.nature_operation as NatureOperation))]),
      el('ram:GuidelineSpecifiedDocumentContextParameter', [el('ram:ID', PROFIL_EN16931)]),
    ]),
    el('rsm:ExchangedDocument', [
      el('ram:ID', f.numero as string),
      el('ram:TypeCode', f.type === 'avoir' ? '381' : '380'),
      dateCii('ram:IssueDateTime', f.date_emission),
      ...notes.map((t) => el('ram:IncludedNote', [el('ram:Content', t.trim())])),
    ]),
    el('rsm:SupplyChainTradeTransaction', [
      ...lignes,
      el('ram:ApplicableHeaderTradeAgreement', [
        f.type_client === 'organisme_public' && f.code_service ? el('ram:BuyerReference', uneLigne(f.code_service)) : null,
        el('ram:SellerTradeParty', [
          el('ram:Name', uneLigne(v.nom as string)),
          el('ram:SpecifiedLegalOrganization', [el('ram:ID', sirenVendeur, { schemeID: SCHEMA_SIREN })]),
          adresseCii('ram:PostalTradeAddress', adresseStructuree(v.adresse), 'FR'),
          el('ram:URIUniversalCommunication', [el('ram:URIID', sirenVendeur, { schemeID: SCHEMA_ADRESSE_ELECTRONIQUE })]),
          el('ram:SpecifiedTaxRegistration', [el('ram:ID', v.numeroTva as string, { schemeID: 'VA' })]),
        ]),
        el('ram:BuyerTradeParty', [
          siretClient ? el('ram:GlobalID', siretClient, { schemeID: SCHEMA_SIRET }) : null,
          el('ram:Name', uneLigne(f.tiers_nom)),
          el('ram:SpecifiedLegalOrganization', [el('ram:ID', f.tiers_siren as string, { schemeID: SCHEMA_SIREN })]),
          adresseCii('ram:PostalTradeAddress', adresseStructuree(f.tiers_adresse), 'FR'),
          el('ram:URIUniversalCommunication', [
            el('ram:URIID', f.tiers_adresse_electronique ?? (f.tiers_siren as string), { schemeID: SCHEMA_ADRESSE_ELECTRONIQUE }),
          ]),
        ]),
        f.type_client === 'organisme_public' && f.numero_engagement
          ? el('ram:BuyerOrderReferencedDocument', [el('ram:IssuerAssignedID', uneLigne(f.numero_engagement))])
          : null,
      ]),
      el('ram:ApplicableHeaderTradeDelivery', [
        livraison
          ? el('ram:ShipToTradeParty', [adresseCii('ram:PostalTradeAddress', livraison, livraison.pays)])
          : null,
        f.date_prestation
          ? el('ram:ActualDeliverySupplyChainEvent', [dateCii('ram:OccurrenceDateTime', f.date_prestation)])
          : null,
      ]),
      el('ram:ApplicableHeaderTradeSettlement', [
        el('ram:InvoiceCurrencyCode', 'EUR'),
        ...m.groupes.map((g) => el('ram:ApplicableTradeTax', [
          el('ram:CalculatedAmount', montant(g.tvaCentimes)),
          el('ram:TypeCode', 'VAT'),
          g.motif ? el('ram:ExemptionReason', g.motif) : null,
          el('ram:BasisAmount', montant(g.baseCentimes)),
          el('ram:CategoryCode', g.categorie),
          g.codeMotif ? el('ram:ExemptionReasonCode', g.codeMotif) : null,
          debits ? el('ram:DueDateTypeCode', '5') : null,
          el('ram:RateApplicablePercent', decimal(g.taux, 2) as string),
        ])),
        f.periode_debut && f.periode_fin
          ? el('ram:BillingSpecifiedPeriod', [dateCii('ram:StartDateTime', f.periode_debut), dateCii('ram:EndDateTime', f.periode_fin)])
          : null,
        el('ram:SpecifiedTradePaymentTerms', [
          f.type === 'avoir' && d.origine?.numero
            ? el('ram:Description', `Avoir sur la facture ${d.origine.numero} du ${dateLisible(d.origine.date_emission)}.`)
            : null,
          f.type === 'facture' && f.date_echeance ? dateCii('ram:DueDateDateTime', f.date_echeance) : null,
        ]),
        el('ram:SpecifiedTradeSettlementHeaderMonetarySummation', [
          el('ram:LineTotalAmount', montant(m.htCentimes)),
          el('ram:TaxBasisTotalAmount', montant(m.htCentimes)),
          el('ram:TaxTotalAmount', montant(m.tvaCentimes), { currencyID: 'EUR' }),
          el('ram:GrandTotalAmount', montant(m.ttcCentimes)),
          el('ram:DuePayableAmount', montant(m.ttcCentimes)),
        ]),
        f.type === 'avoir' && d.origine?.numero
          ? el('ram:InvoiceReferencedDocument', [
            el('ram:IssuerAssignedID', d.origine.numero),
            dateCii('ram:FormattedIssueDateTime', d.origine.date_emission, 'qdt'),
          ])
          : null,
      ]),
    ]),
  ], { 'xmlns:rsm': NS.rsm, 'xmlns:qdt': NS.qdt, 'xmlns:ram': NS.ram, 'xmlns:udt': NS.udt })

  return { xml: `<?xml version="1.0" encoding="UTF-8"?>\n${serialiser(document, 0)}\n`, refus: [] }
}
// La facture telle que la base la garde, avec l'émetteur qu'elle a figé à sa validation.
export interface FactureEnBase extends FactureCii {
  emetteur_nom: string | null
  emetteur_siret: string | null
  emetteur_adresse: string | null
}

// Ce que le générateur reçoit, assemblé depuis la base — le même assemblage pour l'écran qui dit les refus avant le clic
// et pour les fonctions qui transmettent. Le vendeur est l'émetteur que la facture a figé ; le statut de TVA est celui du
// dossier aujourd'hui, que la facture ne fige pas ; le numéro de TVA se calcule sur le SIREN figé. Celui d'un dossier en
// franchise ou exonéré n'est pas inventé : l'application ne le connaît pas, et `refusEmission` le réclame.
export function donneesDeLaFacture(
  facture: FactureEnBase,
  lignes: LigneCii[],
  dossier: { statut_tva: StatutTva | null; article_exoneration: ArticleExoneration | null },
  origine: OrigineCii | null,
  aujourdHui: string,
): DonneesCii {
  const siren = sirenDe(facture.emetteur_siret)
  const sansNumero = dossier.statut_tva === 'franchise' || dossier.statut_tva === 'exonere'
  return {
    facture,
    lignes,
    vendeur: {
      nom: facture.emetteur_nom,
      siret: facture.emetteur_siret,
      adresse: facture.emetteur_adresse,
      numeroTva: !sansNumero && sirenValide(siren) ? numeroTvaFrancais(siren) : null,
      statutTva: dossier.statut_tva,
      articleExoneration: dossier.article_exoneration,
    },
    origine,
    aujourdHui,
  }
}
// ── FIN COPIE factureCii ─────────────────────────────────────────────────────────────────────────────────────────────

class ErreurDePage extends Error {
  constructor(readonly reponse: ReponseJson) {
    super(`la plateforme a répondu ${reponse.statut}`)
  }
}

// ── DÉBUT CLÉS SUPABASE ─────────────────────────────────────────────────────────────────────────
// Les clés d'API de Supabase, lues dans les variables que la plateforme pose elle-même. Les clés
// historiques (`anon`, `service_role`) étaient des jetons signés du projet, et Supabase les coupe à la
// fin de 2026 ; les nouvelles arrivent dans deux objets JSON « nom → clé », `SUPABASE_PUBLISHABLE_KEYS`
// et `SUPABASE_SECRET_KEYS`, et ce projet se sert de la clé nommée `default`. Une variable absente,
// illisible ou sans clé `default` de la bonne forme LÈVE : une clé vide ferait refuser chaque requête
// pour une raison que personne ne lirait. Le message ne cite jamais la clé.
// Bloc copié à l'identique dans chaque fonction qui parle à la base : `clesSupabase.test.ts` compare
// les copies et exécute celle-ci.
function cleSupabase(variable: "SUPABASE_PUBLISHABLE_KEYS" | "SUPABASE_SECRET_KEYS", brut: string | undefined): string {
  const prefixe = variable === "SUPABASE_SECRET_KEYS" ? "sb_secret_" : "sb_publishable_"
  if (!brut) throw new Error(`${variable} est absente de l'environnement de la fonction.`)
  let cles: unknown
  try {
    cles = JSON.parse(brut)
  } catch {
    throw new Error(`${variable} n'est pas un objet JSON lisible.`)
  }
  const cle = cles !== null && typeof cles === "object" ? (cles as Record<string, unknown>).default : undefined
  if (typeof cle !== "string" || !cle.startsWith(prefixe) || cle.length === prefixe.length) {
    throw new Error(`${variable} ne porte pas de clé « default » de la forme ${prefixe}…`)
  }
  return cle
}
// ── FIN CLÉS SUPABASE ───────────────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const debut = Date.now()
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }
  if (req.method !== "POST") {
    return json({ error: "Méthode non autorisée." }, 405)
  }

  const authHeader = req.headers.get("Authorization")
  if (!authHeader) {
    return json({ error: "Non authentifié." }, 401)
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!
  const clePublique = cleSupabase("SUPABASE_PUBLISHABLE_KEYS", Deno.env.get("SUPABASE_PUBLISHABLE_KEYS"))
  const cleSecrete = cleSupabase("SUPABASE_SECRET_KEYS", Deno.env.get("SUPABASE_SECRET_KEYS"))

  const supabaseAsCaller = createClient(supabaseUrl, clePublique, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: callerData, error: callerError } = await supabaseAsCaller.auth.getUser()
  if (callerError || !callerData?.user) {
    return json({ error: "Non authentifié." }, 401)
  }
  const utilisateur: string = callerData.user.id

  const admin = createClient(supabaseUrl, cleSecrete)

  let payload: Record<string, unknown>
  try {
    payload = await req.json()
  } catch {
    return json({ error: "Corps de requête invalide." }, 400)
  }
  const action = typeof payload?.action === "string" ? payload.action : ""
  if (!ACTIONS.includes(action)) {
    return json({ error: `Action inconnue (attendu : ${ACTIONS.join(", ")}).` }, 400)
  }
  const dossierId = typeof payload.dossierId === "string" ? payload.dossierId.trim() : ""
  if (!UUID.test(dossierId)) return json({ error: "dossierId est requis." }, 400)

  // Avec le jeton de l'APPELANT : la même fonction que les règles de la base (super-admin, chef du cabinet, ou membre
  // d'équipe assigné à ce dossier). Rien n'est lu de la connexion, et rien ne part chez la plateforme, avant elle.
  const { data: aAcces, error: erreurAcces } = await supabaseAsCaller.rpc("admin_du_dossier", { p_dossier_id: dossierId })
  if (erreurAcces) return json({ error: `L'accès à ce dossier n'a pas pu être vérifié (${erreurAcces.message}).` }, 503)
  if (!aAcces) return json({ error: "Dossier introuvable." }, 404)

  const { data: lue, error: erreurLecture } = await admin
    .from("connexions_plateformes").select(COLONNES).eq("dossier_id", dossierId).maybeSingle()
  // « Aucune plateforme configurée » est une AFFIRMATION : une lecture refusée ne doit pas la produire.
  if (erreurLecture) {
    return json({ error: `La connexion à la plateforme n'a pas pu être lue (${erreurLecture.message}).` }, 503)
  }
  const connexion = (lue ?? null) as ConnexionLue | null

  if (action === "statut") {
    return json({ connexion: vuePublique(connexion) })
  }

  if (action === "retirer") {
    if (!connexion) return json({ ok: true })
    const { error } = await admin.from("connexions_plateformes").delete().eq("dossier_id", dossierId)
    if (error) return json({ error: `La connexion n'a pas pu être retirée (${error.message}).` }, 500)
    return json({ ok: true })
  }

  if (action === "enregistrer") {
    const saisie = saisieDeConnexion(payload, connexion)
    if ("refus" in saisie) return json({ error: saisie.refus }, 400)
    if (connexion) {
      const { data, error } = await admin.from("connexions_plateformes")
        .update({
          ...saisie.valeurs,
          updated_at: new Date().toISOString(),
          ...(saisie.reinitialiser ? { recherche_depuis: null, derniere_recuperation: null } : {}),
        })
        .eq("dossier_id", dossierId).select(COLONNES).maybeSingle()
      if (error) return json({ error: `La connexion n'a pas pu être enregistrée (${error.message}).` }, 500)
      if (!data) return json({ error: "La connexion a été retirée entre-temps : recharge la page." }, 409)
      return json({ connexion: vuePublique(data as ConnexionLue) })
    }
    const { data, error } = await admin.from("connexions_plateformes")
      .insert({ dossier_id: dossierId, ...saisie.valeurs, created_by: utilisateur })
      .select(COLONNES).maybeSingle()
    if (error?.code === "23505") {
      return json({ error: "Une connexion vient d'être enregistrée pour ce dossier : recharge la page." }, 409)
    }
    if (error) return json({ error: `La connexion n'a pas pu être enregistrée (${error.message}).` }, 500)
    return json({ connexion: vuePublique((data ?? null) as ConnexionLue | null) })
  }

  // Les sept dernières actions supposent une connexion.
  if (!connexion) return json({ error: "Aucune plateforme n'est configurée pour ce dossier." }, 409)
  const hote = new URL(connexion.url_flux).hostname
  // Une configuration modifiée entre la liste et l'import désigne peut-être une autre plateforme ou une autre
  // entreprise : un flux listé chez l'une ne se télécharge pas chez l'autre, et son point de reprise ne vaut pas pour
  // elle. Une facture ne part pas non plus chez une autre plateforme que celle que l'écran montrait.
  const versionPerimee = (action === "telecharger" || action === "retenir" || action === "repartir" || action === "deposer") &&
    payload.version !== connexion.updated_at
  if (versionPerimee) {
    return json({ error: "La connexion à la plateforme a changé entre-temps : relancez la récupération.", perimee: true }, 409)
  }

  if (action === "repartir") {
    // Le seul chemin qui RECULE le point de reprise, et il ne touche que lui : la date de la dernière récupération reste
    // ce qu'elle est, et la connexion garde sa version — ce n'est pas une autre configuration.
    const { data, error } = await admin.from("connexions_plateformes")
      .update({ recherche_depuis: null })
      .eq("dossier_id", dossierId).eq("updated_at", connexion.updated_at).select("dossier_id").maybeSingle()
    if (error) return json({ error: `Le point de reprise n'a pas pu être remis au début (${error.message}).` }, 500)
    if (!data) return json({ error: "La connexion à la plateforme a changé entre-temps : relancez la récupération.", perimee: true }, 409)
    return json({ recherche_depuis: null })
  }

  if (action === "retenir") {
    const retenu = curseurRetenu(connexion.recherche_depuis, payload.jusqua ?? null, Date.now())
    if ("refus" in retenu) return json({ error: retenu.refus }, 400)
    const derniereRecuperation = new Date().toISOString()
    const { data, error } = await admin.from("connexions_plateformes")
      .update({ recherche_depuis: retenu.curseur, derniere_recuperation: derniereRecuperation })
      .eq("dossier_id", dossierId).eq("updated_at", connexion.updated_at).select("dossier_id").maybeSingle()
    if (error) return json({ error: `Le point de reprise n'a pas pu être enregistré (${error.message}).` }, 500)
    if (!data) return json({ error: "La connexion à la plateforme a changé entre-temps : relancez la récupération.", perimee: true }, 409)
    return json({ recherche_depuis: retenu.curseur, derniere_recuperation: derniereRecuperation })
  }

  // La plateforme, ouverte pour la durée de l'appel : tout le réseau passe par ce client, et le jeton s'obtient une fois.
  const ouvrirPlateforme = () => clientPlateforme(connexion, (url, init) => fetch(url, init), {
    delaiMs: DELAI_APPEL_MS, maxJson: MAX_JSON_OCTETS, maxFichier: MAX_FICHIER_OCTETS, maxRedirections: MAX_REDIRECTIONS,
  })
  const refusDuJeton = (refus: { refus: string; identifiants: boolean; statut: number }) => {
    console.error(`[plateforme-agreee] ${action} : jeton refusé (${refus.statut})`)
    return json({ error: refus.refus, identifiants_refuses: refus.identifiants }, refus.statut === 0 ? 504 : 502)
  }

  if (action === "deposer") {
    const factureId = typeof payload.factureId === "string" ? payload.factureId.trim() : ""
    if (!UUID.test(factureId)) return json({ error: "factureId est requis." }, 400)

    // La facture, ses lignes, le statut de TVA du dossier et, pour un avoir, la facture qu'il corrige : relus ici, jamais
    // pris dans ce que le navigateur annonce. Ce qui empêche de la transmettre se dit AVANT tout appel à la plateforme.
    const { data: factureLue, error: erreurFacture } = await admin.from("factures_emises")
      .select(COLONNES_FACTURE).eq("id", factureId).eq("dossier_id", dossierId).maybeSingle()
    if (erreurFacture) return json({ error: `La facture n'a pas pu être lue (${erreurFacture.message}).` }, 503)
    if (!factureLue) return json({ error: "Facture introuvable." }, 404)
    const facture = factureLue as FactureEnBase & { facture_origine_id: string | null; superpdp_invoice_id: number | null }
    // Partie par l'ancien chemin de Super PDP, avant que chaque envoi ne laisse sa transmission : elle ne repart pas.
    if (facture.superpdp_invoice_id !== null) {
      return json({ error: "Cette facture a déjà été transmise par Super PDP.", deja: true }, 409)
    }
    const { data: lignesLues, error: erreurLignes } = await admin.from("facture_lignes")
      .select("ordre, designation, quantite, prix_unitaire_ht, taux_tva").eq("facture_id", factureId).order("ordre")
    if (erreurLignes) return json({ error: `Les lignes de la facture n'ont pas pu être lues (${erreurLignes.message}).` }, 503)
    const { data: dossierLu, error: erreurDossier } = await admin.from("dossiers")
      .select("statut_tva, article_exoneration").eq("id", dossierId).maybeSingle()
    if (erreurDossier || !dossierLu) {
      return json({ error: `Le statut de TVA du dossier n'a pas pu être lu (${erreurDossier?.message ?? "dossier introuvable"}).` }, 503)
    }
    let origine: OrigineCii | null = null
    if (facture.type === "avoir" && facture.facture_origine_id) {
      const { data: origineLue, error: erreurOrigine } = await admin.from("factures_emises")
        .select("numero, date_emission").eq("id", facture.facture_origine_id).eq("dossier_id", dossierId).maybeSingle()
      if (erreurOrigine) return json({ error: `La facture que l'avoir corrige n'a pas pu être lue (${erreurOrigine.message}).` }, 503)
      origine = origineLue ? { numero: origineLue.numero, date_emission: origineLue.date_emission } : null
    }
    const donnees = donneesDeLaFacture(facture, (lignesLues ?? []) as LigneCii[], dossierLu, origine, dateDeParis(Date.now()))
    const refus = refusEmission(donnees)
    if (refus.length > 0) return json({ error: `Cette facture ne peut pas être transmise telle quelle : ${refus.join(" ")}`, refus }, 422)
    const cii = factureCii(donnees)
    if (cii.xml === null) {
      return json({ error: `Cette facture ne peut pas être transmise telle quelle : ${cii.refus.join(" ")}`, refus: cii.refus }, 422)
    }
    const fichier = new TextEncoder().encode(cii.xml)
    const sha256 = await empreinteSha256(fichier)

    const plateforme = ouvrirPlateforme()
    const acces = await plateforme.jeton()
    if ("refus" in acces) return refusDuJeton(acces)

    // La transmission se RÉSERVE avant de partir : une seule active par facture, tous canaux confondus (index unique),
    // si bien que deux clics, deux onglets ou un envoi par Super PDP ne la transmettent pas deux fois. Son identifiant est
    // l'identifiant de suivi du dépôt : c'est lui qui retrouve le flux quand la réponse se perd.
    const { data: reservee, error: erreurReservation } = await admin.from("transmissions_factures")
      .insert({ dossier_id: dossierId, facture_id: factureId, canal: "plateforme", hote, sha256 })
      .select(COLONNES_TRANSMISSION).maybeSingle()
    if (erreurReservation?.code === "23505") {
      return json({ error: "Cette facture a déjà une transmission en cours ou faite : suivez-la plutôt que de la renvoyer.", deja: true }, 409)
    }
    if (erreurReservation || !reservee) {
      return json({ error: `La transmission n'a pas pu être réservée (${erreurReservation?.message ?? "aucune ligne rendue"}).` }, 500)
    }
    const transmission = reservee as TransmissionLue
    const depot = corpsDuDepot(
      { flowSyntax: SYNTAXE_DEPOSEE, name: nomDuFichier(facture.numero as string), sha256, trackingId: transmission.id },
      fichier, `jd-precompta-${crypto.randomUUID()}`)
    const reponseDepot = await plateforme.deposer("/v1/flows", depot.corps, depot.typeContenu)
    const issue = issueDuDepot(reponseDepot)
    console.log(`[plateforme-agreee] deposer : ${reponseDepot.statut}, ${issue.etat}`)
    const suivi = issue.etat === "depose"
      ? { etat: issue.etat, flux_id: issue.fluxId, detail: issue.detail }
      : issue.etat === "echec" ? { etat: issue.etat, detail: issue.detail } : { detail: issue.detail }
    const { data: apres, error: erreurSuivi } = await admin.from("transmissions_factures")
      .update(suivi).eq("id", transmission.id).eq("etat", "envoi").select(COLONNES_TRANSMISSION).maybeSingle()
    if (erreurSuivi || !apres) {
      console.error(`[plateforme-agreee] deposer : issue non enregistrée (${reponseDepot.statut})`)
      return json({
        error: "La facture est partie, mais l'issue du dépôt n'a pas pu être enregistrée : « Suivre » la retrouvera.",
        transmission,
      }, 500)
    }
    if (issue.etat === "echec") {
      const e = erreurPlateforme("dépôt de la facture", reponseDepot, "de dépôt des flux")
      return json({ error: e.message, acces_refuse: e.acces, transmission: apres }, e.statut)
    }
    return json({ transmission: apres })
  }

  if (action === "suivre") {
    const transmissionId = typeof payload.transmissionId === "string" ? payload.transmissionId.trim() : ""
    if (!UUID.test(transmissionId)) return json({ error: "transmissionId est requis." }, 400)
    const { data: transmissionLue, error: erreurTransmission } = await admin.from("transmissions_factures")
      .select(COLONNES_TRANSMISSION).eq("id", transmissionId).eq("dossier_id", dossierId).maybeSingle()
    if (erreurTransmission) return json({ error: `La transmission n'a pas pu être lue (${erreurTransmission.message}).` }, 503)
    if (!transmissionLue) return json({ error: "Transmission introuvable." }, 404)
    const transmission = transmissionLue as TransmissionLue
    if (transmission.canal !== "plateforme") {
      return json({ error: "Cette facture est partie par Super PDP : son suivi se fait depuis la facture." }, 409)
    }
    if (transmission.hote !== hote) {
      return json({ error: "Cette facture a été déposée chez une autre plateforme que celle que le dossier désigne aujourd'hui : son suivi ne se fait plus d'ici." }, 409)
    }
    if (transmission.etat !== "envoi" && transmission.etat !== "depose") return json({ transmission })

    const plateforme = ouvrirPlateforme()
    const acces = await plateforme.jeton()
    if ("refus" in acces) return refusDuJeton(acces)
    let constat: Constat
    if (transmission.etat === "envoi") {
      // L'issue du dépôt est inconnue : on le cherche par son identifiant de suivi.
      const recherche = await plateforme.appelJson("POST", "/v1/flows/search", { where: { trackingId: transmission.id }, limit: 10 })
      if (recherche.statut < 200 || recherche.statut >= 300 || recherche.redirection) {
        const e = erreurPlateforme("recherche du dépôt", recherche)
        console.error(`[plateforme-agreee] suivre : recherche ${recherche.statut}`)
        return json({ error: e.message, acces_refuse: e.acces }, e.statut)
      }
      constat = constatDeRecherche(recherche.donnees, transmission.id)
    } else {
      const description = await plateforme.appelJson("GET", `/v1/flows/${encodeURIComponent(transmission.flux_id ?? "")}?docType=Metadata`)
      if (description.statut === 404 && !description.redirection) {
        constat = { absent: true }
      } else if (description.statut < 200 || description.statut >= 300 || description.redirection) {
        const e = erreurPlateforme("description du flux", description)
        console.error(`[plateforme-agreee] suivre : description ${description.statut}`)
        return json({ error: e.message, acces_refuse: e.acces }, e.statut)
      } else {
        const accuse = accuseDuFlux(description.donnees)
        constat = accuse ? { accuse } : { indecis: "la plateforme décrit ce flux sans identifiant lisible" }
      }
    }
    const suite = suiteDuSuivi(transmission, constat, Date.now())
    if (!suite.maj) return json({ transmission, message: suite.message })
    // Seulement si personne ne l'a changée entre-temps : un dépôt encore en cours, ou un autre onglet, a pu la faire
    // avancer, et le déclencheur refuse de toute façon un retour en arrière.
    const { data: apres, error: erreurMaj } = await admin.from("transmissions_factures")
      .update(suite.maj).eq("id", transmission.id).eq("etat", transmission.etat).select(COLONNES_TRANSMISSION).maybeSingle()
    if (erreurMaj) return json({ error: `Le suivi n'a pas pu être enregistré (${erreurMaj.message}).` }, 500)
    if (!apres) return json({ error: "La transmission a changé entre-temps : rechargez la page.", perimee: true }, 409)
    console.log(`[plateforme-agreee] suivre : ${transmission.etat} → ${suite.maj.etat}`)
    return json({ transmission: apres, message: suite.message })
  }

  const plateforme = ouvrirPlateforme()
  const acces = await plateforme.jeton()
  if ("refus" in acces) return refusDuJeton(acces)

  if (action === "tester") {
    const sante = await plateforme.appelJson("GET", "/v1/healthcheck")
    if (sante.statut < 200 || sante.statut >= 300 || sante.redirection) {
      const e = erreurPlateforme("état du service", sante)
      console.error(`[plateforme-agreee] tester : santé ${sante.statut}`)
      return json({ error: e.message, acces_refuse: e.acces }, e.statut)
    }
    // Une recherche qui ne peut rien rendre — mise à jour après maintenant — éprouve les droits de lecture des flux
    // sans rien lire.
    const essai = await plateforme.appelJson("POST", "/v1/flows/search", {
      where: { flowType: TYPES_RECHERCHES, updatedAfter: isoMs(Date.now()) }, limit: 1,
    })
    const resultats = (essai.donnees as { results?: unknown } | null)?.results
    if (essai.statut < 200 || essai.statut >= 300 || essai.redirection || !Array.isArray(resultats)) {
      const e = essai.statut >= 200 && essai.statut < 300 && !essai.redirection
        ? { message: "La plateforme répond à la recherche des flux, mais pas sous la forme attendue (une liste « results »).", statut: 502, acces: false }
        : erreurPlateforme("recherche des flux", essai)
      console.error(`[plateforme-agreee] tester : recherche ${essai.statut}`)
      return json({ error: e.message, acces_refuse: e.acces }, e.statut)
    }
    console.log("[plateforme-agreee] tester : jeton, santé et recherche acceptés")
    return json({ ok: true })
  }

  if (action === "lister") {
    // Le point de reprise part sous la forme que montrent les plateformes — une date UTC en « …Z », à la milliseconde
    // (pyfrctc l'exige de Super PDP ; le curseur d'exemple de banqup porte « …T03:37:35.687Z ») : il est enregistré
    // tronqué à la milliseconde, donc rien ne se perd.
    const depuis = instantMs(connexion.recherche_depuis)
    let recherche: Recherche
    try {
      recherche = await rechercherFlux(async (demande) => {
        const corps = {
          where: { flowType: TYPES_RECHERCHES, ...(demande.updatedAfter ? { updatedAfter: demande.updatedAfter } : {}) },
          limit: TAILLE_PAGE,
          ...(demande.cursor ? { cursor: demande.cursor } : {}),
        }
        const r = await plateforme.appelJson("POST", "/v1/flows/search", corps)
        if (r.statut < 200 || r.statut >= 300 || r.redirection) throw new ErreurDePage(r)
        return (r.donnees ?? {}) as PageFlux
      }, depuis === null ? null : isoMs(depuis), {
        taillePage: TAILLE_PAGE, maxFlux: MAX_FLUX, maxPages: MAX_PAGES, echeance: debut + BUDGET_RECHERCHE_MS,
        maintenant: () => Date.now(),
      })
    } catch (e) {
      if (e instanceof ErreurDePage) {
        const erreur = erreurPlateforme("recherche des flux", e.reponse)
        console.error(`[plateforme-agreee] lister : la plateforme a répondu ${e.reponse.statut}`)
        return json({ error: erreur.message, acces_refuse: erreur.acces }, erreur.statut)
      }
      console.error(`[plateforme-agreee] lister : lecture interrompue (${(e as { name?: unknown })?.name ?? "?"})`)
      return json({ error: "La recherche des factures s'est interrompue : réessayez." }, 500)
    }
    console.log(`[plateforme-agreee] lister : ${recherche.pages} page(s), ${recherche.flux.length} facture(s), ` +
      `${Object.values(recherche.ecartes).reduce((a, b) => a + b, 0)} écartée(s), ` +
      `${recherche.complete ? "complet" : "incomplet"}`)
    return json({
      hote,
      version: connexion.updated_at,
      depuis: connexion.recherche_depuis,
      flux: recherche.flux,
      ecartes: recherche.ecartes,
      complete: recherche.complete,
      motif: recherche.motif,
      jusqua: recherche.jusqua,
    })
  }

  // action === "telecharger"
  const flowId = typeof payload.flowId === "string" ? payload.flowId : ""
  if (!/^[!-~]{1,200}$/.test(flowId)) return json({ error: "Identifiant de flux illisible." }, 400)
  const document = payload.document === "original" || payload.document === "lisible" ? payload.document : null
  if (!document) return json({ error: "Document inconnu (attendu : original ou lisible)." }, 400)
  const chemin = `/v1/flows/${encodeURIComponent(flowId)}`

  // Ce que la facture EST se relit chez la plateforme, jamais dans ce que le navigateur annonce : son type, son format
  // et son statut décident de ce qu'on télécharge et de la façon de le lire.
  const meta = await plateforme.appelJson("GET", `${chemin}?docType=Metadata`)
  if (meta.statut === 404 && !meta.redirection) {
    return json({ error: "Cette facture n'existe plus chez la plateforme.", definitif: true, raison: "introuvable" }, 404)
  }
  if (meta.statut < 200 || meta.statut >= 300 || meta.redirection) {
    const e = erreurPlateforme("description du flux", meta)
    console.error(`[plateforme-agreee] telecharger : description ${meta.statut}`)
    return json({ error: e.message, acces_refuse: e.acces }, e.statut)
  }
  const lu = fluxDeLaListe(meta.donnees)
  if ("ecarte" in lu || lu.flux.id !== flowId) {
    const raison = "ecarte" in lu ? lu.ecarte : "illisible"
    return json({ error: "La plateforme ne décrit pas ce flux comme une facture qu'on sait lire.", definitif: true, raison }, 422)
  }
  if (lu.flux.etat !== "pret") {
    return json({
      error: lu.flux.etat === "en_attente"
        ? "La plateforme n'a pas fini de traiter cette facture : elle reviendra à une prochaine récupération."
        : "La plateforme a rejeté cette facture : elle ne s'importe pas.",
      definitif: lu.flux.etat === "en_erreur",
      raison: lu.flux.etat,
    }, 409)
  }
  if (document === "lisible" && lu.flux.syntaxe === "Factur-X") {
    return json({ error: "Une facture Factur-X se lit telle quelle : elle n'a pas de version lisible à part." }, 400)
  }

  const telechargement = await plateforme.fichier(`${chemin}?docType=${document === "original" ? "Original" : "ReadableView"}`)
  if (telechargement.redirectionRefusee) {
    console.error(`[plateforme-agreee] telecharger : redirection refusée (${telechargement.statut})`)
    return json({ error: "La plateforme renvoie ce document vers une adresse que la fonction ne suit pas.", raison: "redirection" }, 502)
  }
  if (telechargement.tropLourd) {
    return json({
      error: `Ce document dépasse ${MAX_FICHIER_OCTETS / (1024 * 1024)} Mo : récupérez-le sur la plateforme.`,
      definitif: true, raison: "trop_lourd",
    }, 413)
  }
  if (!telechargement.octets) {
    if (telechargement.statut === 404) {
      return json({
        error: document === "original"
          ? "La plateforme ne rend pas l'original de cette facture."
          : "La plateforme ne rend pas de version lisible de cette facture.",
        definitif: true, raison: "introuvable",
      }, 404)
    }
    const e = erreurPlateforme(document === "original" ? "original" : "version lisible",
      { statut: telechargement.statut, donnees: null, redirection: false })
    console.error(`[plateforme-agreee] telecharger : document ${telechargement.statut}`)
    return json({ error: e.message, acces_refuse: e.acces }, e.statut)
  }
  const nature = natureFichier(telechargement.octets)
  const attendue = document === "lisible" || lu.flux.syntaxe === "Factur-X" ? "pdf" : "xml"
  if (nature !== attendue) {
    return json({
      error: document === "original"
        ? `L'original rendu n'est pas un ${attendue === "pdf" ? "PDF" : "XML"} comme son format l'annonce.`
        : "La version lisible rendue n'est pas un PDF.",
      definitif: true, raison: "format_inattendu",
    }, 422)
  }
  console.log(`[plateforme-agreee] telecharger : ${document}, ${telechargement.octets.length} octet(s)`)
  return json({
    hote,
    flux: lu.flux,
    document,
    nature,
    octets: telechargement.octets.length,
    contenu: base64De(telechargement.octets),
  })
})
