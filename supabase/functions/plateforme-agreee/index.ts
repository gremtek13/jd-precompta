// Edge Function : la réception des factures électroniques par la plateforme agréée du client (ligne 28.5 de la
// feuille de route, étape b).
//
// Depuis le 1er septembre 2026, toute entreprise reçoit ses factures par une plateforme agréée — la sienne, qu'elle
// a choisie. Le cabinet a décidé (07/10/2026) de se brancher sur la plateforme de CHAQUE client plutôt que d'en
// imposer une : toutes publient l'API que la norme AFNOR XP Z12-013 leur impose (le « Flow Service »), et
// l'entreprise ouvre au cabinet une identité OAuth2 (« client credentials ») sur la sienne. Cette fonction est le
// SEUL point de contact avec ces plateformes, et la seule à lire ou écrire `connexions_plateformes` (RLS sans aucune
// policy : refus total côté navigateur, voir supabase/essais/receptionPlateforme.sql). Le secret ne quitte jamais
// le serveur : il ouvre toutes les factures de l'entreprise, reçues comme émises.
//
// Huit actions, toutes demandées par un membre du cabinet qui a accès au dossier — `admin_du_dossier`, vérifié
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
//                  factures déjà importées sont reconnues à leur flux et ne reviennent pas en double.
//
// UNE connexion par dossier (la clé primaire de la table est le dossier) : un dossier est UNE entreprise, qui a UNE
// plateforme de réception.
//
// LE POINT DE REPRISE N'EST QU'UNE ÉCONOMIE, JAMAIS UNE GARANTIE : ce qui empêche une facture d'entrer deux fois,
// c'est son flux (`pieces_flux_unique` : le dossier, l'hôte de la plateforme et l'identifiant du flux). Une recherche
// qui repart trop tôt relit des factures déjà importées, que l'écran écarte ; une recherche qui repartirait trop tard
// en perdrait. D'où les règles du bloc CURSEUR : il n'avance que sur ce que l'écran a réellement traité, jamais à
// moins de quinze minutes de maintenant (la marge que la norme donne en exemple pour qu'un flux en cours d'écriture
// chez la plateforme devienne visible, §5.3.2), et ne recule jamais.
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
// La norme impose aux plateformes d'accepter une page de 100 résultats au plus (§4.3).
const TAILLE_PAGE = 100
// Ce que l'écran importe en une fois : chaque facture coûte deux téléchargements et un dépôt. Au-delà, la liste se dit
// incomplète, l'écran importe ce lot, retient son point de reprise, et la récupération suivante continue.
const MAX_FLUX = 100
const MAX_JSON_OCTETS = 2 * 1024 * 1024
// Le plafond de la lecture d'une pièce (`extract-piece`) : une facture plus lourde se récupère sur la plateforme.
const MAX_FICHIER_OCTETS = 10 * 1024 * 1024
const MAX_REDIRECTIONS = 3

const ACTIONS = ["statut", "enregistrer", "retirer", "tester", "lister", "telecharger", "retenir", "repartir"]
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const COLONNES = "dossier_id, nom, url_flux, url_jeton, client_id, client_secret, organisation_id, portee, " +
  "recherche_depuis, derniere_recuperation, created_at, updated_at"
// Les factures, dans les deux sens : celles que l'entreprise reçoit (SupplierInvoice, un achat) et celles qu'elle émet
// (CustomerInvoice, une vente). Le TYPE dit qui est le fournisseur, quel que soit le sens du flux — une facture
// d'autofacturation reçue est une vente (norme, §5.2.5). Les cycles de vie et l'e-reporting ne sont pas des pièces.
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
 * de son refus. Pour le service des flux, un « /v1 » final est retiré : la norme versionne ses routes sous l'adresse
 * de la plateforme, et une adresse collée avec lui ferait appeler « …/v1/v1/flows ».
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
// OAuth2, accès « client credentials » (RFC 6749, §4.4), comme la norme l'impose (§4.2). L'identité se présente d'abord
// par l'en-tête Basic, la forme que la RFC recommande (§2.3.1 : chaque partie encodée comme un formulaire) ; une
// plateforme qui ne l'accepte pas refuse en 400 ou 401, et la demande repart avec l'identité dans le corps, la forme
// que la RFC admet aussi. Le jeton rendu doit être un jeton « Bearer » (RFC 6750) : c'est celui que la norme emploie.
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
        refus: "La plateforme a délivré un jeton d'un type que la norme n'emploie pas (attendu : Bearer).",
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
// La recherche page à page (`POST /v1/flows/search`). La norme de 2026 pagine par un curseur opaque (`cursor` dans la
// demande, `nextCursor` dans la réponse, absent à la dernière page) ; ses versions précédentes paginaient par la date
// (`updatedAfter` = la dernière date lue), et une plateforme peut en être restée là. Les deux sont suivies :
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
// l'ordre des dates que la norme impose (§5.3.2) : un flux non lu pourrait alors être plus ancien.
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
    demande = { updatedAfter: isoMs(reprise), cursor: null }
  }
  return fin(bornes.maxPages, false, `plus de ${bornes.maxPages} pages : relancez la récupération pour la suite`)
}
// ── FIN RECHERCHE ───────────────────────────────────────────────────────────────────────────────────

// ── DÉBUT CURSEUR ───────────────────────────────────────────────────────────────────────────────────
// Le point de reprise que l'écran demande à retenir après un import — celui que la liste rendait possible, ramené
// avant la première facture qu'il n'a pas pu importer. La fonction le borne encore : jamais à moins de quinze minutes
// de maintenant (un flux en cours d'écriture chez la plateforme peut apparaître avec une date déjà passée, §5.3.2), et
// jamais en arrière — un autre onglet a pu aller plus loin, et reculer ferait seulement relire.
const MARGE_EXHAUSTIVITE_MS = 15 * 60_000

function curseurRetenu(actuel: string | null, demande: unknown, maintenantMs: number): { curseur: string | null } | { refus: string } {
  if (demande === null) return { curseur: actuel }
  const ms = instantMs(demande)
  if (ms === null) return { refus: "Le point de reprise demandé n'est pas une date lisible." }
  const retenu = Math.min(ms, maintenantMs - MARGE_EXHAUSTIVITE_MS)
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
  // La norme écrit « Organisation-Id » (§4.2) ; des plateformes publient « Organization-Id ». Les deux partent.
  const organisation: Record<string, string> = config.organisation_id
    ? { "Organisation-Id": config.organisation_id, "Organization-Id": config.organisation_id }
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

  async function appelJson(methode: "GET" | "POST", chemin: string, corps?: unknown): Promise<ReponseJson> {
    const reponse = await envoyer(`${config.url_flux}${chemin}`, {
      method: methode,
      headers: corps === undefined
        ? enTetes("application/json")
        : { ...enTetes("application/json"), "Content-Type": "application/json" },
      body: corps === undefined ? undefined : JSON.stringify(corps),
    })
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

  return { jeton, appelJson, fichier }
}
// ── FIN HTTP ────────────────────────────────────────────────────────────────────────────────────────

// ── DÉBUT ERREURS ───────────────────────────────────────────────────────────────────────────────────
// Ce que dit une plateforme qui refuse, dit en français. Une erreur de la norme porte un `errorCode` (MISSING_TOKEN,
// FORBIDDEN_ACCESS…) et un `errorMessage` libre : seul le CODE est repris, et seulement s'il a la forme d'un code —
// un texte libre rendu tel quel serait l'écho d'une réponse que personne n'a vérifiée.
function codeAfnor(donnees: unknown): string | null {
  const code = (donnees as { errorCode?: unknown } | null)?.errorCode
  return typeof code === "string" && /^[A-Z][A-Z0-9_]{1,59}$/.test(code) ? code : null
}

function erreurPlateforme(etape: string, reponse: ReponseJson): { message: string; statut: number; acces: boolean } {
  const code = codeAfnor(reponse.donnees)
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
        "pas les droits de lecture des flux de cette entreprise, ou l'organisation est à préciser.",
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

  // Les cinq dernières actions supposent une connexion.
  if (!connexion) return json({ error: "Aucune plateforme n'est configurée pour ce dossier." }, 409)
  const hote = new URL(connexion.url_flux).hostname
  // Une configuration modifiée entre la liste et l'import désigne peut-être une autre plateforme ou une autre
  // entreprise : un flux listé chez l'une ne se télécharge pas chez l'autre, et son point de reprise ne vaut pas pour
  // elle.
  const versionPerimee = (action === "telecharger" || action === "retenir" || action === "repartir") &&
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

  const plateforme = clientPlateforme(connexion, (url, init) => fetch(url, init), {
    delaiMs: DELAI_APPEL_MS, maxJson: MAX_JSON_OCTETS, maxFichier: MAX_FICHIER_OCTETS, maxRedirections: MAX_REDIRECTIONS,
  })
  const acces = await plateforme.jeton()
  if ("refus" in acces) {
    console.error(`[plateforme-agreee] ${action} : jeton refusé (${acces.statut})`)
    return json({ error: acces.refus, identifiants_refuses: acces.identifiants }, acces.statut === 0 ? 504 : 502)
  }

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
        ? { message: "La plateforme répond à la recherche des flux, mais pas sous la forme de la norme AFNOR XP Z12-013.", statut: 502, acces: false }
        : erreurPlateforme("recherche des flux", essai)
      console.error(`[plateforme-agreee] tester : recherche ${essai.statut}`)
      return json({ error: e.message, acces_refuse: e.acces }, e.statut)
    }
    console.log("[plateforme-agreee] tester : jeton, santé et recherche acceptés")
    return json({ ok: true })
  }

  if (action === "lister") {
    // Le point de reprise part sous la forme que la norme montre (« …Z », à la milliseconde) : il est enregistré
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
