// Edge Function : envoi d'e-mails au client depuis l'app — facture ou devis par e-mail, relance pour
// obtenir des pièces. Utilise le même compte Resend et le même domaine que receive-email (réception),
// precompta.jdarnis.fr, déjà vérifié en envoi ET en réception (voir Dashboard Resend).
//
// Trois modèles (voir payload.type) :
// - "facture" : envoie le détail d'une facture déjà validée (lignes, montants, mentions légales) en
//   corps d'e-mail HTML. PAS de pièce jointe PDF pour l'instant — générer un vrai PDF côté serveur
//   est un chantier à part (voir FactureApercu, qui s'appuie sur l'impression navigateur) : à ajouter
//   si les cabinets réclament la pièce jointe une fois ce premier envoi en usage.
// - "devis" (espace client, étape P6c2) : le détail d'un devis ÉMIS, sur le patron de la facture — un brouillon n'est
//   pas une offre et ne part pas. L'e-mail n'en montre que ce que le devis imprime et qui se lit dans un e-mail (numéro,
//   dates d'émission et de validité, objet, lignes, totaux, conditions, mentions légales, émetteur figé) : jamais les
//   notes (partagées avec le client « Ventes », mais qui ne s'impriment pas), ni l'adresse électronique du client, ni la
//   réponse enregistrée — ces colonnes ne sont même pas lues. Rien ne s'écrit sur le devis : émis, il est figé par la
//   base (`garder_devis`), et l'adresse du destinataire ne s'y mémorise pas comme sur une facture. À DÉPLOYER APRÈS la
//   migration `envoi_des_devis` (supabase/schema/20261105070313_envoi_des_devis.sql, en production depuis le 05/11/2026), qui admet le type « devis » au journal et y pose
//   `devis_id` : avant elle, la ligne de journal d'un devis serait refusée par la base.
// - "relance_pieces" : simple rappel invitant le client à se connecter à son espace pour déposer ses
//   pièces — aucun lien magique/jeton, le client se connecte normalement, comme d'habitude.
// - "relance_facture" (espace client, étape C5 de la ligne 51.5) : le rappel d'une facture validée EN RETARD — son numéro,
//   son montant TTC et son échéance —, jamais ses pénalités, que l'écran calcule et montre (src/lib/relances.ts). Admis
//   seulement sous `RELANCES_EN_BASE` (plus bas) : la ligne de journal d'une relance demande la migration
//   `relances_des_factures`, en production depuis le 07/11/2026.
// - "relance_demande" (espace client, étape B3b de la ligne 51.5) : le rappel d'une demande du cabinet encore OUVERTE —
//   son objet et son échéance, que l'accès lit déjà dans « Mes demandes », jamais son détail, ni un message libre —, envoyé
//   à l'adresse que porte l'ACCÈS choisi (`memberships.email`), jamais à une adresse du corps de la requête. Le journal et
//   la relance au canal « email » s'inscrivent d'un seul tenant, après l'envoi (`journaliser_relance_de_demande`). Admis
//   seulement sous `RELANCES_DE_DEMANDES_EN_BASE` (plus bas), que la migration `relance_des_demandes_par_email` lève.
//
// Chaque envoi est journalisé (table emails_envoyes) : un cabinet doit toujours pouvoir retrouver qui
// a reçu quoi et quand, jamais un envoi "silencieux" qu'on ne peut plus vérifier après coup.
//
// Qui peut quoi (`QUI_PEUT_QUOI`, espace client, étapes P3 et P6c2) : la facture et le devis, le cabinet du dossier et
// le client dont l'accès porte la case « Ventes », de même la relance d'une facture en retard ; la relance de pièces, le
// cabinet seul. Les droits se lisent avec le jeton de
// l'appelant (bloc droitsDeLAppelant) avant toute autre lecture ; un client ne dépasse pas trente e-mails par dossier
// et par jour de Paris (`PLAFOND_CLIENT_PAR_JOUR`), comptés dans le journal avant l'envoi — le domaine d'envoi est
// celui du cabinet.

import { Resend } from "npm:resend@6"
import { createClient } from "npm:@supabase/supabase-js@2"

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

const DOMAINE_ENVOI = "precompta.jdarnis.fr"
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Un champ du corps qui se lit comme un texte : un texte, ou rien (absent, nul — « requis » le refuse ensuite). */
function texteOuAbsent(valeur: unknown): valeur is string | null | undefined {
  return valeur == null || typeof valeur === "string"
}

// QUI PEUT QUOI (conception de l'espace client, §3.5) : le droit que chaque modèle exige — « ventes », le cabinet du
// dossier ou un accès client qui porte la case « Ventes » ; « cabinet », le cabinet seul : la relance de pièces est
// celle que le cabinet adresse à son client. Le devis suit la facture (étape P6c2) : « Ventes » ouvre au client la création
// et l'émission de ses devis par la base, et leur envoi est le même geste que celui d'une facture. Un changement de
// décision est une ligne.
const QUI_PEUT_QUOI: Readonly<Record<string, DroitExige>> = {
  facture: "ventes",
  devis: "ventes",
  relance_pieces: "cabinet",
  relance_facture: "ventes",
  // La relance d'une demande du cabinet (étape B3b) : un geste du cabinet seul, comme la demande elle-même.
  relance_demande: "cabinet",
}

// LA RELANCE D'UNE FACTURE EN RETARD (étape C5 ; MEG3-Q3, « oui » du cabinet) : la base n'admet sa ligne de journal,
// `relance_facture`, qu'avec la migration `relances_des_factures`, en production depuis le 07/11/2026
// (supabase/schema/20261107163303_relances_des_factures.sql) : la constante est levée. Baissée — l'état d'avant, que
// `relancesHttp.test.ts` joue encore en mémoire —, elle refuse ce type comme un type inconnu (400, mot pour mot le refus
// d'hier), avant toute lecture et tout envoi : un e-mail parti dont la ligne serait refusée APRÈS l'envoi ne compterait
// pas dans le plafond d'un accès client. L'ordre : la migration, puis la constante levée et la fonction redéployée, puis
// `RELANCES_EXPORTEES` (src/lib/relances.ts) ; `relancesHttp.test.ts` refuse le drapeau levé sur une constante baissée.
const RELANCES_EN_BASE = true

// LA RELANCE D'UNE DEMANDE DU CABINET PAR E-MAIL (étape B3b) : la base n'admet sa ligne de journal, `relance_demande`, et
// n'inscrit la relance au canal « email » qu'avec la migration `relance_des_demandes_par_email` (supabase/preparees/
// 20261111239000, PRÉPARÉE ; après B1 et B2). Baissée, la constante refuse ce type comme un type inconnu (400, mot pour mot
// le refus d'hier), avant toute lecture et tout envoi : un e-mail parti dont l'inscription serait refusée APRÈS l'envoi
// laisserait la demande muette. L'ordre : la migration, puis la constante levée et la fonction redéployée, puis
// `RELANCE_DES_DEMANDES_PAR_EMAIL_PREVUE` (src/lib/documentsEtDemandes.ts) ; `relancesDeDemandesHttp.test.ts` refuse le
// drapeau levé sur une constante baissée.
const RELANCES_DE_DEMANDES_EN_BASE = false
const TYPES_ADMIS: readonly string[] = [
  ...(RELANCES_EN_BASE ? ["facture", "devis", "relance_pieces", "relance_facture"] : ["facture", "devis", "relance_pieces"]),
  ...(RELANCES_DE_DEMANDES_EN_BASE ? ["relance_demande"] : []),
]
const TYPES_EN_MOTS = TYPES_ADMIS.slice(0, -1).map((t) => `'${t}'`).join(", ") + ` ou '${TYPES_ADMIS[TYPES_ADMIS.length - 1]}'`

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// LE PLAFOND D'UN ACCÈS CLIENT (conception de l'espace client, §3.5 et §10) : un compte client qui enverrait en masse
// le ferait sous le domaine du cabinet. Trente e-mails par dossier et par jour de Paris, comptés dans le journal AVANT
// l'envoi. Le journal nomme le compte qui a envoyé (`envoye_par`), pas s'il était client ou cabinet : TOUS les e-mails
// du dossier ce jour-là comptent, ceux du cabinet compris — le côté fermé. Le cabinet, lui, n'est pas plafonné. Le
// plafond se LIT, il ne se réserve pas : deux envois partis ensemble le lisent avant que l'un ou l'autre ne soit
// journalisé, et peuvent le dépasser d'autant (une réservation tout ou rien demanderait une fonction SQL).
const PLAFOND_CLIENT_PAR_JOUR = 30

// ── DÉBUT JOUR DE PARIS ──────────────────────────────────────────────────────────────────────────────────────────────
// Le jour de Paris qui contient l'instant `ms`, en instants : de son minuit à celui du lendemain (23 ou 25 heures aux
// changements d'heure). La fonction tourne en UTC ; compté en UTC, le plafond repartirait à 1 h ou 2 h du matin.
// Minuit tombe à Paris la veille à 22 h ou 23 h UTC, et l'heure change à 1 h UTC : l'avance de Paris lue à minuit UTC
// d'un jour est donc celle de son minuit. `plafondEmails.test.ts` confronte ce bloc à `dateAParis` (src/lib/format.ts).
function jourDeParis(ms: number): { debut: string; fin: string } {
  const parties = (instant: number) => Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Paris", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(instant)).map((p) => [p.type, Number(p.value)]))
  const ici = parties(ms)
  const minuit = (jour: number) => {
    const t = Date.UTC(ici.year, ici.month - 1, jour)
    const p = parties(t)
    return t - (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - t)
  }
  return { debut: new Date(minuit(ici.day)).toISOString(), fin: new Date(minuit(ici.day + 1)).toISOString() }
}
// ── FIN JOUR DE PARIS ────────────────────────────────────────────────────────────────────────────────────────────────

// Le jour CIVIL de Paris de l'instant `ms`, « AAAA-MM-JJ » : une facture est en retard le lendemain de son échéance, au
// calendrier de Paris, pas à celui d'UTC où tourne la fonction (entre minuit et 1 h ou 2 h, ils diffèrent d'un jour).
function jourCivilDeParis(ms: number): string {
  const parties = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(ms))
  const partie = (type: string) => parties.find((p) => p.type === type)?.value ?? ""
  return `${partie("year")}-${partie("month")}-${partie("day")}`
}

interface FactureRow {
  id: string; numero: string | null; date_emission: string; date_echeance: string | null
  tiers_nom: string; montant_ht: number; montant_tva: number; montant_ttc: number
  mentions_legales: string | null; emetteur_nom: string | null; type: "facture" | "avoir"
}
interface LigneRow { designation: string; quantite: number; prix_unitaire_ht: number; taux_tva: number }

// L'ACOMPTE D'UN DEVIS (P5b4c) : l'e-mail d'une facture d'acompte dit « Facture d'acompte F… », et celui de l'avoir d'un
// acompte, qu'il crédite une facture d'acompte. La marque vit dans une colonne que la migration `acomptes_des_devis` pose,
// en production : la constante est levée, et la fonction la lit. Baissée, elle ne la nommerait dans aucune lecture,
// passerait SANS_ACOMPTE_EMAIL, et l'e-mail serait celui d'avant la migration au caractère près, que le harnais rejoue
// encore (`acomptesBaisses`, src/test/fonctionsEdge.ts). Cette constante suit `ACOMPTES_PREVUS` (src/lib/devis.ts) :
// `copiesFacturation.test.ts` les lie, comme dans superpdp-emit et plateforme-agreee.
const ACOMPTES_EN_BASE = true

interface AcompteDeLEmail {
  // La facture est une facture d'acompte.
  acompte: boolean
  // L'avoir crédite cette facture d'acompte ; nul hors de ce cas.
  origine: { numero: string } | null
}

/** Ni acompte ni avoir d'un acompte : ce que passe la fonction tant qu'elle ne lit pas la marque. */
const SANS_ACOMPTE_EMAIL: AcompteDeLEmail = Object.freeze({ acompte: false, origine: null })

// La marque d'acompte de la facture et, pour un avoir, celle de la facture qu'il corrige, relues par l'identifiant ET le
// dossier. Une lecture en erreur, une ligne non rendue ou une marque qui n'est pas un booléen sont ILLISIBLES, jamais un
// « non » : l'e-mail ne part pas (503) plutôt que de dire « Facture » d'une facture d'acompte — un e-mail parti ne se
// rattrape pas.
async function acompteDeLEmail(
  admin: ReturnType<typeof createClient>,
  dossierId: string,
  factureId: string,
): Promise<AcompteDeLEmail | { erreur: string }> {
  if (!ACOMPTES_EN_BASE) return SANS_ACOMPTE_EMAIL
  const { data: marque, error: erreurMarque } = await admin.from("factures_emises")
    .select("type, acompte, facture_origine_id").eq("id", factureId).eq("dossier_id", dossierId).maybeSingle()
  if (erreurMarque || !marque || typeof marque.acompte !== "boolean") {
    return { erreur: `La marque d'acompte de la facture n'a pas pu être lue${erreurMarque ? ` (${erreurMarque.message})` : ""}. L'e-mail n'a pas été envoyé. Réessaie dans un instant.` }
  }
  if (marque.type !== "avoir") return { acompte: marque.acompte, origine: null }
  if (marque.acompte) {
    return { erreur: "Un avoir n'est jamais une facture d'acompte : sa marque contredit son type. L'e-mail n'a pas été envoyé." }
  }
  if (typeof marque.facture_origine_id !== "string") return SANS_ACOMPTE_EMAIL
  const { data: origine, error: erreurOrigine } = await admin.from("factures_emises")
    .select("numero, acompte").eq("id", marque.facture_origine_id).eq("dossier_id", dossierId).maybeSingle()
  if (erreurOrigine || !origine || typeof origine.acompte !== "boolean" || (origine.acompte && typeof origine.numero !== "string")) {
    return { erreur: `La marque d'acompte de la facture que l'avoir corrige n'a pas pu être lue${erreurOrigine ? ` (${erreurOrigine.message})` : ""}. L'e-mail n'a pas été envoyé. Réessaie dans un instant.` }
  }
  return { acompte: false, origine: origine.acompte ? { numero: origine.numero as string } : null }
}

// Les colonnes d'un devis que l'e-mail montre, et elles seules (la lecture ne nomme qu'elles) : ni `notes`, ni
// `tiers_email`, ni `reponse`. `lignes` est un `jsonb`, de la forme d'une ligne de facture : sa forme se vérifie avant
// l'envoi (`lignesDuDevis`).
interface DevisRow {
  id: string; numero: string | null; statut: string; date_emission: string; date_validite: string
  objet: string | null; lignes: unknown; montant_ht: number; montant_tva: number; montant_ttc: number
  conditions: string | null; mentions_legales: string | null; emetteur_nom: string | null
}

function formaterMontant(n: number): string {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €"
}

// ── DÉBUT COPIE montantsFacture ──────────────────────────────────────────────────────────────────────────────────────
// Ce bloc est recopié AU CARACTÈRE PRÈS dans les Edge Functions qui transmettent une facture (superpdp-emit,
// plateforme-agreee) et dans celle qui l'envoie par e-mail (send-email) : elles sont auto-portées, et le générateur de la
// facture électronique, que les deux premières recopient aussi, en dépend. `copiesFacturation.test.ts` compare chaque
// copie à celui-ci et l'exécute seule.

export interface LigneCalculee {
  montant_ht: number
  montant_tva: number
  montant_ttc: number
}

// LE CALCUL SE FAIT SUR LES DÉCIMAUX QUE LA BASE REÇOIT, EN ENTIERS. Une quantité, un prix et un taux partent en JSON,
// qui écrit d'un nombre son écriture décimale la plus courte (celle de `String`), et la base la garde EXACTEMENT, dans une
// colonne `numeric`. Le nombre binaire que tient le navigateur n'est pas ce décimal : 32,05 y vaut 32,04999999999999716…,
// si bien que 0,5 × 32,05 × 100 y faisait 1 602,4999… et que l'arrondi rendait 16,02 € d'une ligne de 16,025 €, quand le
// demi éloigné de zéro en fait 16,03 € (de même 0,5 × 2,01 et 1,5 × 0,15). La base refait ce calcul pour plafonner les
// encaissements (`centimes_ligne_facture`), en `numeric` depuis la correction de la facture (31/10/2026) : les deux côtés
// arrondissent le même décimal. Un nombre se lit donc comme un entier et une puissance de dix — « 32.05 », 3205 × 10⁻² ;
// « 1.5e-7 », 15 × 10⁻⁸ —, et le calcul se fait en entiers (BigInt), sans perte.
function enDecimal(x: number): [bigint, number] {
  const [mantisse, exposant = '0'] = String(x).split('e')
  const [entiere, fraction = ''] = mantisse.split('.')
  return [BigInt(entiere + fraction), Number(exposant) - fraction.length]
}

// `entier` × 10^`puissance`, à l'unité, le demi ÉLOIGNÉ DE ZÉRO dans les deux sens : la règle de `round` sur un `numeric`.
// Une ligne d'avoir à −0,125 € vaut −0,13 €, comme la même ligne d'une facture vaut 0,13 € : l'avoir, relu dans son sens
// par le générateur de la facture électronique (un avoir de la norme porte des montants positifs), retrouve les montants
// qu'on a enregistrés.
function aLUnite(entier: bigint, puissance: number): bigint {
  if (puissance >= 0) return entier * 10n ** BigInt(puissance)
  const diviseur = 10n ** BigInt(-puissance)
  const quotient = entier / diviseur
  const reste = entier % diviseur
  return 2n * (reste < 0n ? -reste : reste) >= diviseur ? quotient + (entier < 0n ? -1n : 1n) : quotient
}

// Chaque ligne est arrondie avant d'être sommée (comme le ferait n'importe quel logiciel de facturation), plutôt que de
// sommer des valeurs brutes puis d'arrondir le total : les deux méthodes peuvent différer d'un centime. Le HT au centime,
// puis la TVA sur ce HT, au centime ; le TTC, leur somme. Une valeur qui n'est pas un nombre fini ne fait pas un montant.
export function calculerLigne(quantite: number, prixUnitaireHt: number, tauxTva: number): LigneCalculee {
  if (!Number.isFinite(quantite) || !Number.isFinite(prixUnitaireHt) || !Number.isFinite(tauxTva)) {
    return { montant_ht: Number.NaN, montant_tva: Number.NaN, montant_ttc: Number.NaN }
  }
  const [q, puissanceQ] = enDecimal(quantite)
  const [p, puissanceP] = enDecimal(prixUnitaireHt)
  const [t, puissanceT] = enDecimal(tauxTva)
  const ht = aLUnite(q * p, puissanceQ + puissanceP + 2)
  const tva = aLUnite(ht * t, puissanceT - 2)
  return { montant_ht: Number(ht) / 100, montant_tva: Number(tva) / 100, montant_ttc: Number(ht + tva) / 100 }
}
// ── FIN COPIE montantsFacture ────────────────────────────────────────────────────────────────────────────────────────

// ── DÉBUT COPIE resteDuDeLaFacture ───────────────────────────────────────────────────────────────────────────────────
// Ce bloc est recopié AU CARACTÈRE PRÈS dans send-email, qui relit le reste dû avant de relancer (C5-Q4, « oui » du
// cabinet du 08/11/2026) : une facture soldée ne se relance pas, et l'e-mail dit ce qu'il en reste dû. Il lit
// `calculerLigne`, du bloc montantsFacture que send-email recopie aussi. resteDuDeLaFactureCopie.test.ts compare la
// copie à celui-ci, l'exécute seule avec ce bloc-là, et confronte les deux au calcul de l'onglet Factures
// (`resteAEncaisser`, moins `dejaCredite`), sur une batterie.
/** Une ligne de la facture, telle que la base la garde. */
export interface LigneDuReste {
  quantite: number
  prix_unitaire_ht: number
  taux_tva: number
}

/** Un encaissement du registre de la facture : les contre-passations y sont, en négatif. */
export interface EncaissementDuReste {
  montant: number
  retire_le: string | null
}

/** Un avoir validé qui cite la facture : son TTC est stocké négatif. */
export interface AvoirDuReste {
  montant_ttc: number
}

export interface ResteDuDeLaFacture {
  ttcCentimes: number
  resteCentimes: number
}

/**
 * Le TTC d'une facture et ce qu'il en reste dû — ni encaissé ni crédité par un avoir —, en centimes entiers : le TTC de
 * chaque ligne au centime (le HT, puis la TVA sur ce HT), moins les encaissements non retirés, NETS des contre-passations,
 * moins ce que les avoirs ont crédité. Null si une valeur n'est pas un nombre fini : rien ne s'en affirme.
 */
export function resteDuDeLaFacture(
  lignes: readonly LigneDuReste[],
  encaissements: readonly EncaissementDuReste[],
  avoirs: readonly AvoirDuReste[],
): ResteDuDeLaFacture | null {
  let ttcCentimes = 0
  for (const l of lignes) {
    const c = calculerLigne(l.quantite, l.prix_unitaire_ht, l.taux_tva)
    if (!Number.isFinite(c.montant_ht) || !Number.isFinite(c.montant_tva)) return null
    ttcCentimes += Math.round(c.montant_ht * 100) + Math.round(c.montant_tva * 100)
  }
  let encaisseCentimes = 0
  for (const e of encaissements) {
    if (e.retire_le != null) continue
    if (!Number.isFinite(e.montant)) return null
    encaisseCentimes += Math.round(e.montant * 100)
  }
  let crediteCentimes = 0
  for (const a of avoirs) {
    if (!Number.isFinite(a.montant_ttc)) return null
    crediteCentimes += Math.round(-a.montant_ttc * 100)
  }
  return { ttcCentimes, resteCentimes: ttcCentimes - encaisseCentimes - crediteCentimes }
}
// ── FIN COPIE resteDuDeLaFacture ─────────────────────────────────────────────────────────────────────────────────────

// `date_emission` et `date_echeance` sont des colonnes `date` de Postgres : une date CIVILE, qui n'a
// pas d'heure, donc pas de fuseau — son libellé est ce qu'il faut lire. Passer par `new Date(d)`
// l'interpréterait comme minuit UTC puis la replacerait dans le fuseau du runtime : juste tant que
// ce runtime est en UTC, et faux d'un jour le jour où il ne l'est plus, sur les dates d'une facture
// envoyée au client. Rien ne le dirait — l'e-mail est parti.
// Même correctif que `formatDate` dans src/lib/format.ts, où le défaut, lui, était VISIBLE : aux
// Antilles, en Guyane et en Polynésie, une pièce du 1er janvier s'affichait au 31 décembre.
function formaterDate(d: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(d)
    ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`
    : new Date(d).toLocaleDateString("fr-FR")
}
// Échappement minimal — designation/tiers_nom/message viennent d'une saisie du cabinet, pas d'un
// tiers non authentifié, mais un e-mail HTML reste un contexte où un "<" mal placé casse le rendu.
function echapper(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

// Les colonnes d'une facture que la relance lit, et elles seules : ni l'adresse de son client, ni ses mentions ; le
// montant est son TTC, tel que la facture le porte. Ses lignes ne se lisent que pour leurs montants, avec ses
// encaissements et ses avoirs (`lireLeResteDu`) : le reste dû que l'e-mail dit, et qui refuse une facture soldée.
interface FactureRelancee {
  id: string; numero: string | null; statut: string; type: string; date_echeance: string | null
  montant_ttc: number | null; emetteur_nom: string | null
}

// Ce qui retient la relance, dit avant tout envoi : une facture validée — ni un brouillon ni un avoir —, qui porte son
// numéro et son montant, et dont l'échéance est PASSÉE au jour de Paris (le lendemain de l'échéance est le premier jour
// de retard, C. com., art. L441-10, II). Qu'il en reste dû, la fonction le relit ensuite (`refusDuResteDu`, C5-Q4).
function refusDeLaRelance(f: FactureRelancee, aujourdHui: string): { statut: number; message: string } | null {
  if (f.statut !== "validee" || f.type !== "facture") {
    return { statut: 400, message: "Seule une facture validée se relance — jamais un brouillon ni un avoir." }
  }
  if (typeof f.numero !== "string" || f.numero.trim() === "" || typeof f.montant_ttc !== "number" || !Number.isFinite(f.montant_ttc)) {
    return { statut: 500, message: "Cette facture validée ne porte pas son numéro ou son montant : la relance n'est pas partie." }
  }
  if (f.date_echeance == null) {
    return { statut: 400, message: "Cette facture ne porte pas d'échéance : elle n'est jamais en retard, et ne se relance pas." }
  }
  if (f.date_echeance >= aujourdHui) {
    return { statut: 400, message: `Cette facture n'est pas encore en retard (échéance le ${formaterDate(f.date_echeance)}) : elle ne se relance pas.` }
  }
  return null
}

// La relance ne lit le registre qu'en entier : au-delà de cette borne, une lecture rendrait une partie des lignes sans le
// dire (le plafond de PostgREST), et le reste dû serait faux. Le compte exact le vérifie ; une liste plus longue refuse.
const BORNE_DU_RESTE_DU = 1000

// Le reste dû de la facture relancée (C5-Q4) : ses lignes, ses encaissements (contre-passations comprises) et les avoirs
// VALIDÉS qui la citent — la somme que fait la base (`enregistrer_encaissement`) —, lus par le client admin, bornés à la
// facture et au dossier de la requête, chacun EN ENTIER. Une lecture en erreur n'est pas une facture soldée : 503, comme
// la lecture de la facture ; une lecture partielle, 500 ; le calcul est le bloc resteDuDeLaFacture, celui de l'écran.
async function lireLeResteDu(
  admin: ReturnType<typeof createClient>, dossierId: string, f: FactureRelancee & { montant_ttc: number },
): Promise<{ reste: ResteDuDeLaFacture } | { statut: number; message: string }> {
  const fin = BORNE_DU_RESTE_DU - 1
  const [lignes, encaissements, avoirs] = await Promise.all([
    admin.from("facture_lignes").select("quantite, prix_unitaire_ht, taux_tva", { count: "exact" })
      .eq("facture_id", f.id).order("id").range(0, fin),
    admin.from("encaissements_factures").select("montant, retire_le", { count: "exact" })
      .eq("dossier_id", dossierId).eq("facture_id", f.id).order("id").range(0, fin),
    admin.from("factures_emises").select("montant_ttc", { count: "exact" })
      .eq("dossier_id", dossierId).eq("facture_origine_id", f.id).eq("type", "avoir").eq("statut", "validee")
      .order("id").range(0, fin),
  ])
  const lectures = [
    ["Les lignes de la facture", lignes], ["Les encaissements de la facture", encaissements],
    ["Les avoirs de la facture", avoirs],
  ] as const
  for (const [quoi, lu] of lectures) {
    if (lu.error) {
      return { statut: 503, message: `${quoi} n'ont pas pu être lus (${lu.error.message}) : son reste dû ne se juge pas, et la relance n'est pas partie. Réessaie dans un instant.` }
    }
  }
  for (const [quoi, lu] of lectures) {
    if (!Array.isArray(lu.data) || lu.count !== lu.data.length) {
      return { statut: 500, message: `${quoi} ne se lisent pas en entier : son reste dû ne se juge pas, et la relance n'est pas partie.` }
    }
  }
  const reste = resteDuDeLaFacture(
    lignes.data as LigneDuReste[], encaissements.data as EncaissementDuReste[], avoirs.data as AvoirDuReste[],
  )
  if (reste === null || reste.ttcCentimes !== Math.round(f.montant_ttc * 100)) {
    return { statut: 500, message: "Le total de cette facture ne se retrouve pas dans ses lignes : la relance n'est pas partie." }
  }
  return { reste }
}

// Une facture soldée — encaissée, ou créditée par ses avoirs — ne se relance pas : 400, comme les autres états de la
// facture qui retiennent la relance (`refusDeLaRelance`).
function refusDuResteDu(reste: ResteDuDeLaFacture): { statut: number; message: string } | null {
  if (reste.resteCentimes <= 0) {
    return { statut: 400, message: "Il ne reste rien à régler sur cette facture — encaissée, ou créditée par un avoir : elle ne se relance pas." }
  }
  return null
}

function construireEmailRelanceFacture(
  f: FactureRelancee & { numero: string; montant_ttc: number; date_echeance: string }, reste: ResteDuDeLaFacture,
  messagePerso: string | null,
): { objet: string; html: string } {
  const emetteur = f.emetteur_nom ?? "Le cabinet"
  // Le reste dû ET le total : une facture payée en partie se relance pour ce qu'il en manque, et le client retrouve sa
  // facture à son total.
  const html = `
    <div style="font-family:sans-serif;color:#222;max-width:560px;">
      <p>Bonjour,</p>
      ${messagePerso ? `<p>${echapper(messagePerso)}</p>` : ""}
      <p>Sauf erreur de notre part, la facture <strong>${echapper(f.numero)}</strong>, d'un montant total de <strong>${formaterMontant(f.montant_ttc)}</strong> TTC, arrivée à échéance le ${formaterDate(f.date_echeance)}, n'a pas encore été entièrement réglée : il en reste <strong>${formaterMontant(reste.resteCentimes / 100)}</strong> à régler.</p>
      <p>Si le règlement est déjà parti, merci de ne pas tenir compte de ce message.</p>
      <p style="margin-top:24px;">Cordialement,<br>${echapper(emetteur)}</p>
    </div>`
  return { objet: `Relance — facture ${f.numero} — ${emetteur}`, html }
}

function construireEmailFacture(
  facture: FactureRow, lignes: LigneRow[], messagePerso: string | null, acompte: AcompteDeLEmail,
): { objet: string; html: string } {
  const emetteur = facture.emetteur_nom ?? "Le cabinet"
  const typeLabel = facture.type === "avoir" ? "Avoir" : "Facture"
  // L'acompte d'un devis : « Facture d'acompte », et l'avoir qui crédite une facture d'acompte la nomme. Sans acompte
  // (`SANS_ACOMPTE_EMAIL`), les trois textes sont vides et l'e-mail est celui d'hier.
  const dAcompte = typeLabel === "Facture" && acompte.acompte ? " d'acompte" : ""
  const surLAcompte = typeLabel === "Avoir" && acompte.origine ? ` sur la facture d'acompte ${acompte.origine.numero}` : ""
  const credite = typeLabel === "Avoir" && acompte.origine
    ? `, qui crédite la facture d'acompte <strong>${echapper(acompte.origine.numero)}</strong>`
    : ""
  const lignesHtml = lignes.map((l) => {
    // Le HT de la ligne tel que la facture le porte (le bloc `montantsFacture`, le calcul de l'application et de la base) :
    // calculé ici à part, en virgule flottante et le demi vers +∞, l'e-mail disait d'une ligne de 16,025 € qu'elle en
    // valait 16,02, et d'une ligne d'avoir à −0,125 € qu'elle en valait −0,12 : un centime d'écart avec la facture qu'il
    // détaille.
    const ht = calculerLigne(l.quantite, l.prix_unitaire_ht, l.taux_tva).montant_ht
    return `<tr><td style="padding:4px 8px;border-bottom:1px solid #eee;">${echapper(l.designation)}</td><td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right;">${l.quantite}</td><td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right;">${formaterMontant(ht)}</td></tr>`
  }).join("")
  const html = `
    <div style="font-family:sans-serif;color:#222;max-width:560px;">
      <p>Bonjour,</p>
      ${messagePerso ? `<p>${echapper(messagePerso)}</p>` : ""}
      <p>Veuillez trouver ci-dessous le détail de ${typeLabel === "Avoir" ? "l'avoir" : `la facture${dAcompte}`} <strong>${echapper(facture.numero ?? "")}</strong>, émis${typeLabel === "Avoir" ? "" : "e"} le ${formaterDate(facture.date_emission)}${facture.date_echeance ? ` (échéance le ${formaterDate(facture.date_echeance)})` : ""}${credite}.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;">
        <thead><tr><th style="text-align:left;padding:4px 8px;border-bottom:2px solid #ccc;">Désignation</th><th style="text-align:right;padding:4px 8px;border-bottom:2px solid #ccc;">Qté</th><th style="text-align:right;padding:4px 8px;border-bottom:2px solid #ccc;">Montant HT</th></tr></thead>
        <tbody>${lignesHtml}</tbody>
      </table>
      <p style="text-align:right;margin:4px 0;">Total HT : ${formaterMontant(facture.montant_ht)}</p>
      <p style="text-align:right;margin:4px 0;">Total TVA : ${formaterMontant(facture.montant_tva)}</p>
      <p style="text-align:right;margin:4px 0;font-weight:bold;">Total TTC : ${formaterMontant(facture.montant_ttc)}</p>
      ${facture.mentions_legales ? `<p style="font-size:0.8em;color:#666;white-space:pre-line;">${echapper(facture.mentions_legales)}</p>` : ""}
      <p style="margin-top:24px;">Cordialement,<br>${echapper(emetteur)}</p>
    </div>`
  return { objet: `${typeLabel}${dAcompte} ${facture.numero ?? ""}${surLAcompte} — ${emetteur}`, html }
}

/**
 * Les lignes d'un devis, lues dans son `jsonb` : un tableau non vide de lignes dont chaque champ a son type, sinon `null`.
 * La base les vérifie à l'enregistrement (`enregistrer_devis` : une ligne au moins) ; une forme inattendue ici refuse
 * l'envoi plutôt que de faire partir un devis au détail faux ou vide — un e-mail parti ne se rattrape pas.
 */
function lignesDuDevis(brut: unknown): LigneRow[] | null {
  if (!Array.isArray(brut) || brut.length === 0) return null
  const lignes: LigneRow[] = []
  for (const l of brut) {
    if (l === null || typeof l !== "object" || Array.isArray(l)) return null
    const { designation, quantite, prix_unitaire_ht, taux_tva } = l as Record<string, unknown>
    if (typeof designation !== "string" || typeof quantite !== "number" || typeof prix_unitaire_ht !== "number"
      || typeof taux_tva !== "number" || ![quantite, prix_unitaire_ht, taux_tva].every(Number.isFinite)) {
      return null
    }
    lignes.push({ designation, quantite, prix_unitaire_ht, taux_tva })
  }
  return lignes
}

// Le devis, sur le patron de la facture : les mêmes lignes (le HT de chacune par le bloc `montantsFacture`, celui de
// l'aperçu du devis, src/lib/devis.ts), les mêmes totaux, et la validité dite avec la date, comme l'aperçu l'imprime
// (`LIBELLE_VALIDITE`). L'émetteur est celui que le devis a figé à son émission, jamais relu du dossier.
function construireEmailDevis(
  devis: DevisRow & { numero: string; emetteur_nom: string }, lignes: LigneRow[], messagePerso: string | null,
): { objet: string; html: string } {
  const lignesHtml = lignes.map((l) => {
    const ht = calculerLigne(l.quantite, l.prix_unitaire_ht, l.taux_tva).montant_ht
    return `<tr><td style="padding:4px 8px;border-bottom:1px solid #eee;">${echapper(l.designation)}</td><td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right;">${l.quantite}</td><td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right;">${formaterMontant(ht)}</td></tr>`
  }).join("")
  const objetDuDevis = devis.objet != null && devis.objet.trim() !== "" ? devis.objet : null
  const conditions = devis.conditions != null && devis.conditions.trim() !== "" ? devis.conditions : null
  const html = `
    <div style="font-family:sans-serif;color:#222;max-width:560px;">
      <p>Bonjour,</p>
      ${messagePerso ? `<p>${echapper(messagePerso)}</p>` : ""}
      <p>Veuillez trouver ci-dessous le détail du devis <strong>${echapper(devis.numero)}</strong>, émis le ${formaterDate(devis.date_emission)} et valable jusqu'au ${formaterDate(devis.date_validite)}.</p>
      ${objetDuDevis ? `<p>Objet : ${echapper(objetDuDevis)}</p>` : ""}
      <table style="width:100%;border-collapse:collapse;margin:16px 0;">
        <thead><tr><th style="text-align:left;padding:4px 8px;border-bottom:2px solid #ccc;">Désignation</th><th style="text-align:right;padding:4px 8px;border-bottom:2px solid #ccc;">Qté</th><th style="text-align:right;padding:4px 8px;border-bottom:2px solid #ccc;">Montant HT</th></tr></thead>
        <tbody>${lignesHtml}</tbody>
      </table>
      <p style="text-align:right;margin:4px 0;">Total HT : ${formaterMontant(devis.montant_ht)}</p>
      <p style="text-align:right;margin:4px 0;">Total TVA : ${formaterMontant(devis.montant_tva)}</p>
      <p style="text-align:right;margin:4px 0;font-weight:bold;">Total TTC : ${formaterMontant(devis.montant_ttc)}</p>
      ${conditions ? `<p style="white-space:pre-line;">${echapper(conditions)}</p>` : ""}
      ${devis.mentions_legales ? `<p style="font-size:0.8em;color:#666;white-space:pre-line;">${echapper(devis.mentions_legales)}</p>` : ""}
      <p style="margin-top:24px;">Cordialement,<br>${echapper(devis.emetteur_nom)}</p>
    </div>`
  return { objet: `Devis ${devis.numero} — ${devis.emetteur_nom}`, html }
}

// La demande que la relance lit, et elle seule : ni son détail (un texte libre, qui reste dans l'espace où l'accès le lit
// sous sa session), ni ses réponses, ni son auteur.
interface DemandeRelancee { id: string; objet: string; echeance: string | null; close_le: string | null }

// L'e-mail d'une relance de demande : un texte fixe, l'objet et l'échéance de la demande, et le chemin habituel — aucun
// lien porteur d'un jeton, aucun message libre. L'objet ne paraît que dans le corps, jamais dans le sujet (que l'aperçu
// d'une messagerie montre sans l'ouvrir).
function construireEmailRelanceDemande(demande: DemandeRelancee): { objet: string; html: string } {
  const html = `
    <div style="font-family:sans-serif;color:#222;max-width:560px;">
      <p>Bonjour,</p>
      <p>Votre cabinet attend encore votre réponse à sa demande « <strong>${echapper(demande.objet)}</strong> »${demande.echeance ? `, attendue pour le ${formaterDate(demande.echeance)}` : ""}.</p>
      <p>Merci de vous connecter à votre espace habituel, rubrique « Mes demandes », pour y répondre ou y déposer ce qui est demandé.</p>
      <p style="margin-top:24px;">Cordialement,<br>Votre cabinet comptable</p>
    </div>`
  return { objet: "Une demande de votre cabinet attend votre réponse", html }
}

function construireEmailRelance(dossierNom: string, messagePerso: string | null): { objet: string; html: string } {
  const html = `
    <div style="font-family:sans-serif;color:#222;max-width:560px;">
      <p>Bonjour,</p>
      ${messagePerso ? `<p>${echapper(messagePerso)}</p>` : `<p>Petit rappel : il nous manque encore des pièces (factures, relevés, justificatifs) pour continuer le suivi comptable de <strong>${echapper(dossierNom)}</strong>.</p>`}
      <p>Merci de vous connecter à votre espace habituel pour les déposer.</p>
      <p style="margin-top:24px;">Cordialement,<br>Votre cabinet comptable</p>
    </div>`
  return { objet: `Pièces à transmettre — ${dossierNom}`, html }
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

// ── DÉBUT COPIE droitsDeLAppelant ────────────────────────────────────────────────────────────────────────────────────
// Ce que l'appelant peut faire sur ce dossier (espace client, étape P3). Ses droits se lisent par
// `droits_sur_le_dossier` (migration `droits_des_acces_clients`, étape P1) avec SON jeton — sous la clé de service,
// `auth.uid()` serait nul —, avant toute lecture d'un secret et tout appel extérieur. Seul `true` accorde : une erreur,
// une exception, ou une réponse sans ses quatre cases booléennes rendent `illisible`, le côté fermé ; une case de plus
// (un domaine neuf, que la fonction SQL ajoute sans changer de signature) ne ferme rien. Le droit qu'une action exige
// est une DONNÉE de chaque fonction, sa table « qui peut quoi » : « cabinet » (`admin_du_dossier`), ou « ventes »
// (`gere_les_ventes` : le cabinet, ou un accès client qui porte la case « Ventes ») ; une action hors de la table n'est
// permise à personne. Copié à l'identique dans plateforme-agreee, superpdp-emit, superpdp-credentials et send-email :
// `droitsDeLAppelantCopie.test.ts` exécute chaque copie contre sa propre grille.
type DroitExige = "cabinet" | "ventes"
interface Droits { cabinet: boolean; membre: boolean; ventes: boolean; banque: boolean }

async function droitsDeLAppelant(
  appelant: { rpc: (nom: string, args: { p_dossier_id: string }) => PromiseLike<{ data: unknown; error: unknown }> },
  dossierId: string,
): Promise<{ droits: Droits } | { illisible: string }> {
  let lu: unknown
  try {
    const reponse = await appelant.rpc("droits_sur_le_dossier", { p_dossier_id: dossierId })
    if (reponse.error != null) {
      const message = (reponse.error as { message?: unknown }).message
      return { illisible: typeof message === "string" && message !== "" ? message : "erreur de la base" }
    }
    lu = reponse.data
  } catch {
    return { illisible: "la base n'a pas répondu" }
  }
  if (lu === null || typeof lu !== "object" || Array.isArray(lu)) return { illisible: "réponse d'une autre forme" }
  const cases = lu as Record<string, unknown>
  if (!["cabinet", "membre", "ventes", "banque"].every((c) => typeof cases[c] === "boolean")) {
    return { illisible: "réponse d'une autre forme" }
  }
  const { cabinet, membre, ventes, banque } = cases as unknown as Droits
  return { droits: { cabinet, membre, ventes, banque } }
}

/** L'appelant porte-t-il le droit que la table exige pour cette action ? */
function actionPermise(table: Readonly<Record<string, DroitExige>>, action: string, droits: Droits): boolean {
  const exige = Object.prototype.hasOwnProperty.call(table, action) ? table[action] : null
  return exige === "cabinet" ? droits.cabinet : exige === "ventes" ? droits.ventes : false
}
// ── FIN COPIE droitsDeLAppelant ──────────────────────────────────────────────────────────────────────────────────────

// ── DÉBUT DEUX FACTEURS ──────────────────────────────────────────────────────────────────────────────────────────────
// La double authentification exigée d'un compte (C7, second temps ; migration `deux_facteurs_exiges`, PRÉPARÉE). Une
// fonction qui lit avec la clé secrète contourne la RLS et la pré-requête de PostgREST : elle refuse donc elle-même, en
// 403 et avant toute dépense, un jeton `aal1` d'un compte que le cabinet a exigé, et tout jeton émis avant le retrait du
// second facteur du compte (l'appareil perdu, `aal2` compris). La base le dit, lue au jeton de l'appelant
// (`deux_facteurs_satisfaits`, que la pré-requête laisse passer) ; une réponse illisible rend 503 (le côté fermé). Le
// drapeau reste baissé tant que la migration n'est pas en base : la fonction SQL n'existerait pas, et chaque appel
// tomberait en 503. Bloc identique dans chaque fonction qui agit pour un compte (edgeFunctionsDeuxFacteurs.test.ts).
const DEUX_FACTEURS_EXIGES_EN_BASE = false

interface AppelantDesDeuxFacteurs {
  rpc: (fonction: "deux_facteurs_satisfaits") => PromiseLike<{ data: unknown; error: unknown }>
}

async function refusDesDeuxFacteurs(appelant: AppelantDesDeuxFacteurs): Promise<Response | null> {
  if (!DEUX_FACTEURS_EXIGES_EN_BASE) return null
  let satisfaite: unknown = null
  try {
    const { data, error } = await appelant.rpc("deux_facteurs_satisfaits")
    satisfaite = error ? null : data
  } catch {
    satisfaite = null
  }
  if (satisfaite === true) return null
  if (satisfaite === false) {
    return json({
      error: "Cette session ne satisfait pas la double authentification de ce compte : donner le code de l'application d'authentification, ou se reconnecter si le second facteur a été retiré, avant de recommencer.",
    }, 403)
  }
  return json({ error: "La double authentification de ce compte n'a pas pu être vérifiée : recommencer dans un instant." }, 503)
}
// ── FIN DEUX FACTEURS ────────────────────────────────────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
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
  const resendApiKey = Deno.env.get("RESEND_API_KEY")
  if (!resendApiKey) {
    return json({ error: "RESEND_API_KEY non configuré côté serveur." }, 500)
  }

  const supabaseAsCaller = createClient(supabaseUrl, clePublique, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: callerData, error: callerError } = await supabaseAsCaller.auth.getUser()
  if (callerError || !callerData.user) {
    return json({ error: "Non authentifié." }, 401)
  }
  // La double authentification exigée (bloc DEUX FACTEURS) : refusée avant toute autre lecture.
  const refusDeuxFacteurs = await refusDesDeuxFacteurs(supabaseAsCaller)
  if (refusDeuxFacteurs) return refusDeuxFacteurs

  const admin = createClient(supabaseUrl, cleSecrete)

  let corps: unknown
  try {
    corps = await req.json()
  } catch {
    return json({ error: "Corps de requête invalide." }, 400)
  }
  // Un JSON lisible n'est pas encore un objet : lire un champ de `null` levait, et `Deno.serve` rendait alors un 500 en
  // texte brut, sans en-tête CORS, que la page ne pouvait pas lire ; un champ reçu en nombre faisait lever `.trim()`
  // (défauts connus des Edge Functions, corrigés ici comme dans create-cabinet). Absent ou nul, un champ tombe sur le
  // refus « requis » qui suit.
  if (corps === null || typeof corps !== "object" || Array.isArray(corps)) {
    return json({ error: "Corps de requête invalide : un objet JSON est attendu." }, 400)
  }
  const payload = corps as Record<string, unknown>
  for (const champ of ["dossierId", "type", "destinataire", "message", "factureId", "devisId", "demandeId", "accesId"]) {
    if (!texteOuAbsent(payload[champ])) {
      return json({ error: `Corps de requête invalide : « ${champ} » doit être un texte.` }, 400)
    }
  }
  const texte = (champ: string) => (payload[champ] as string | null | undefined)?.trim()
  const dossierId = texte("dossierId")
  const type = payload.type
  const destinataire = texte("destinataire")
  const messagePerso = texte("message") || null
  // La relance d'une demande (étape B3b) n'a pas de destinataire dans le corps : son adresse est celle de l'accès choisi.
  const relanceDeDemande = type === "relance_demande" && TYPES_ADMIS.includes(type)
  if (!dossierId || typeof type !== "string" || !TYPES_ADMIS.includes(type) || (!destinataire && !relanceDeDemande)) {
    return json({ error: `dossierId, type (${TYPES_EN_MOTS}) et destinataire sont requis.` }, 400)
  }
  const demandeId = relanceDeDemande ? texte("demandeId") ?? null : null
  const accesId = relanceDeDemande ? texte("accesId") ?? null : null
  if (relanceDeDemande) {
    if (destinataire) {
      return json({ error: "L'adresse d'une relance de demande est celle de l'accès choisi, lue en base : le corps de la requête ne la porte pas." }, 400)
    }
    if (messagePerso) {
      return json({ error: "Une relance de demande part sous son texte : elle ne porte pas de message libre." }, 400)
    }
    if (!demandeId || !UUID_REGEX.test(demandeId) || !accesId || !UUID_REGEX.test(accesId)) {
      return json({ error: "demandeId et accesId, les identifiants de la demande et de l'accès, sont requis pour le modèle 'relance_demande'." }, 400)
    }
  } else if (!destinataire || !EMAIL_REGEX.test(destinataire)) {
    return json({ error: "Adresse e-mail du destinataire invalide." }, 400)
  }
  // Le devis se désigne par son identifiant, de la forme d'un UUID, jugée ici avec le reste du corps : une demande mal
  // formée est refusée de même pour tous, avant les droits, et un texte quelconque ne part jamais dans une requête à la
  // base (où le cast lèverait, et se lirait comme une panne).
  const devisId = type === "devis" ? texte("devisId") ?? null : null
  if (type === "devis" && (!devisId || !UUID_REGEX.test(devisId))) {
    return json({ error: "devisId, l'identifiant du devis, est requis pour le modèle 'devis'." }, 400)
  }
  // La facture relancée, de même : un UUID, jugé avec le corps.
  const factureRelanceeId = type === "relance_facture" ? texte("factureId") ?? null : null
  if (type === "relance_facture" && (!factureRelanceeId || !UUID_REGEX.test(factureRelanceeId))) {
    return json({ error: "factureId, l'identifiant de la facture, est requis pour le modèle 'relance_facture'." }, 400)
  }

  // Les droits de l'appelant, avec SON jeton, avant toute autre lecture. Sans le droit que le modèle exige, la réponse
  // d'avant l'espace client, mot pour mot : elle ne dit pas si le dossier existe.
  const lus = await droitsDeLAppelant(supabaseAsCaller, dossierId)
  if ("illisible" in lus) {
    return json({ error: `L'accès à ce dossier n'a pas pu être vérifié (${lus.illisible}).` }, 503)
  }
  if (!actionPermise(QUI_PEUT_QUOI, type, lus.droits)) {
    return json({ error: "Dossier introuvable." }, 404)
  }

  const { data: dossierRow } = await admin.from("dossiers").select("nom").eq("id", dossierId).maybeSingle()
  if (!dossierRow) {
    return json({ error: "Dossier introuvable." }, 404)
  }

  let objet: string, html: string
  let factureId: string | null = null
  // L'adresse où part l'e-mail : celle du corps, sauf pour la relance d'une demande (l'accès choisi, lu en base).
  let adresse: string = destinataire ?? ""
  // Nom affiché comme expéditeur — celui de la facture (recopié à l'émission, voir types.ts) quand il
  // y en a un, sinon celui du dossier (cas "relance_pieces", qui n'a pas de facture associée).
  let nomExpediteur = dossierRow.nom

  if (type === "facture") {
    factureId = texte("factureId") ?? null
    if (!factureId) {
      return json({ error: "factureId est requis pour le modèle 'facture'." }, 400)
    }
    const { data: factureData, error: factureError } = await admin
      .from("factures_emises")
      .select("id, numero, statut, type, date_emission, date_echeance, tiers_nom, montant_ht, montant_tva, montant_ttc, mentions_legales, emetteur_nom")
      .eq("id", factureId).eq("dossier_id", dossierId).maybeSingle()
    if (factureError || !factureData) {
      return json({ error: "Facture introuvable." }, 404)
    }
    if (factureData.statut !== "validee") {
      return json({ error: "Seule une facture validée peut être envoyée par e-mail." }, 400)
    }
    // SA JUMELLE SIX LIGNES PLUS HAUT LIT SON ERREUR, PAS ELLE. `(lignesData ?? [])` sur une lecture
    // refusée construisait une facture au bon en-tête et au bon total, SANS AUCUNE LIGNE, et
    // l'envoyait au client — un e-mail parti ne se rattrape pas, et le cabinet n'en saurait rien
    // puisque la fonction répond « ok ». On refuse d'envoyer : c'est le seul moment où c'est encore
    // possible.
    const { data: lignesData, error: lignesError } = await admin
      .from("facture_lignes")
      .select("designation, quantite, prix_unitaire_ht, taux_tva")
      .eq("facture_id", factureId)
      .order("ordre")
    if (lignesError) {
      return json({ error: `Les lignes de la facture n'ont pas pu être lues (${lignesError.message}). L'e-mail n'a pas été envoyé : il serait parti sans son détail. Réessaie dans un instant.` }, 503)
    }
    // La marque d'acompte, lue seulement sous sa constante (rien de lu tant qu'elle est baissée) : illisible, rien ne part.
    const acompte = await acompteDeLEmail(admin, dossierId, factureId)
    if ("erreur" in acompte) {
      return json({ error: acompte.erreur }, 503)
    }
    const construit = construireEmailFacture(factureData as FactureRow, (lignesData ?? []) as LigneRow[], messagePerso, acompte)
    objet = construit.objet
    html = construit.html
    nomExpediteur = factureData.emetteur_nom ?? dossierRow.nom
  } else if (type === "devis" && devisId) {
    // Le devis, par son identifiant ET le dossier de la requête : un devis d'un autre dossier n'existe pas pour cet appel,
    // sous le même mot qu'un devis inconnu — les droits ne valent que pour CE dossier. Seules les colonnes que l'e-mail
    // montre sont lues. Une lecture en erreur n'est pas un devis absent : elle se dit (503), et rien ne part.
    const { data: devisData, error: devisError } = await admin
      .from("devis")
      .select("id, numero, statut, date_emission, date_validite, objet, lignes, montant_ht, montant_tva, montant_ttc, conditions, mentions_legales, emetteur_nom")
      .eq("id", devisId).eq("dossier_id", dossierId).maybeSingle()
    if (devisError) {
      return json({ error: `Le devis n'a pas pu être lu (${devisError.message}). L'e-mail n'a pas été envoyé. Réessaie dans un instant.` }, 503)
    }
    if (!devisData) {
      return json({ error: "Devis introuvable." }, 404)
    }
    const devis = devisData as DevisRow
    // Un brouillon n'est pas une offre : il n'a ni numéro ni émetteur figé, et peut encore changer. Même statut que la
    // facture non validée.
    if (devis.statut !== "emis") {
      return json({ error: "Seul un devis émis s'envoie par e-mail : un brouillon n'est pas encore une offre." }, 400)
    }
    // Émis, la base lui a posé son numéro et son émetteur ; un devis qui ne les porte pas, ou dont les lignes n'ont pas
    // leur forme, ne part pas — l'aperçu le dit de même illisible (`ceQueLeDevisImprime`).
    const lignesDevis = lignesDuDevis(devis.lignes)
    const numero = devis.numero?.trim() ? devis.numero : null
    const emetteur = devis.emetteur_nom?.trim() ? devis.emetteur_nom : null
    if (numero === null || emetteur === null || lignesDevis === null) {
      return json({ error: "Ce devis émis ne porte pas son numéro, son émetteur ou des lignes lisibles : l'e-mail n'a pas été envoyé." }, 500)
    }
    const construit = construireEmailDevis({ ...devis, numero, emetteur_nom: emetteur }, lignesDevis, messagePerso)
    objet = construit.objet
    html = construit.html
    nomExpediteur = emetteur
  } else if (type === "relance_facture" && factureRelanceeId) {
    // La facture, par son identifiant ET le dossier de la requête ; une lecture en erreur n'est pas une facture absente.
    const { data: relancee, error: erreurRelancee } = await admin
      .from("factures_emises")
      .select("id, numero, statut, type, date_echeance, montant_ttc, emetteur_nom")
      .eq("id", factureRelanceeId).eq("dossier_id", dossierId).maybeSingle()
    if (erreurRelancee) {
      return json({ error: `La facture n'a pas pu être lue (${erreurRelancee.message}). La relance n'est pas partie. Réessaie dans un instant.` }, 503)
    }
    if (!relancee) {
      return json({ error: "Facture introuvable." }, 404)
    }
    const facture = relancee as FactureRelancee
    const refus = refusDeLaRelance(facture, jourCivilDeParis(Date.now()))
    if (refus) {
      return json({ error: refus.message }, refus.statut)
    }
    const relue = facture as FactureRelancee & { numero: string; montant_ttc: number; date_echeance: string }
    // Le reste dû, relu ici avant tout envoi (C5-Q4) : l'écran le juge, mais une facture soldée entre-temps, ou une
    // demande qui ne vient pas de l'écran, ne relance pas un client qui ne doit plus rien.
    const lu = await lireLeResteDu(admin, dossierId, relue)
    if ("statut" in lu) {
      return json({ error: lu.message }, lu.statut)
    }
    const solde = refusDuResteDu(lu.reste)
    if (solde) {
      return json({ error: solde.message }, solde.statut)
    }
    const construit = construireEmailRelanceFacture(relue, lu.reste, messagePerso)
    objet = construit.objet
    html = construit.html
    // Le journal cite la facture relancée : « Relancée le … » s'en déduit, rien d'autre ne se stocke.
    factureId = factureRelanceeId
    nomExpediteur = facture.emetteur_nom ?? dossierRow.nom
  } else if (relanceDeDemande && demandeId && accesId) {
    // La demande, par son identifiant ET le dossier de la requête ; une lecture en erreur n'est pas une demande absente.
    const { data: demandeLue, error: erreurDemande } = await admin.from("demandes_cabinet")
      .select("id, objet, echeance, close_le").eq("id", demandeId).eq("dossier_id", dossierId).maybeSingle()
    if (erreurDemande) {
      return json({ error: `La demande n'a pas pu être lue (${erreurDemande.message}). La relance n'est pas partie. Réessaie dans un instant.` }, 503)
    }
    if (!demandeLue) {
      return json({ error: "Demande introuvable." }, 404)
    }
    const demande = demandeLue as DemandeRelancee
    if (demande.close_le !== null) {
      return json({ error: "Cette demande est close : elle ne se relance plus." }, 400)
    }
    // L'adresse de l'accès, lue sur l'accès de CE dossier : jamais celle d'un compte qui n'y a pas d'accès.
    const { data: accesLu, error: erreurAcces } = await admin.from("memberships")
      .select("email").eq("dossier_id", dossierId).eq("user_id", accesId).maybeSingle()
    if (erreurAcces) {
      return json({ error: `L'accès n'a pas pu être lu (${erreurAcces.message}). La relance n'est pas partie. Réessaie dans un instant.` }, 503)
    }
    if (!accesLu) {
      return json({ error: "Cet accès n'est pas un accès de ce dossier : la relance n'est pas partie." }, 404)
    }
    const adresseDeLAcces = typeof accesLu.email === "string" ? accesLu.email.trim() : ""
    if (!EMAIL_REGEX.test(adresseDeLAcces)) {
      return json({ error: "Cet accès ne porte pas d'adresse électronique lisible : la relance n'est pas partie." }, 400)
    }
    adresse = adresseDeLAcces
    const construit = construireEmailRelanceDemande(demande)
    objet = construit.objet
    html = construit.html
    nomExpediteur = "Votre cabinet comptable"
  } else {
    const construit = construireEmailRelance(dossierRow.nom, messagePerso)
    objet = construit.objet
    html = construit.html
  }

  // Le plafond d'un accès client, compté juste avant l'envoi : le dernier contrôle, une fois tout le reste jugé. Un
  // compte illisible refuse — l'e-mail parti ne se rattrape pas. Il compte tout le journal du dossier ce jour-là, quel
  // qu'en soit le type : les devis comme les factures et les relances.
  if (!lus.droits.cabinet) {
    const jour = jourDeParis(Date.now())
    const { count: envoyes, error: erreurCompte } = await admin.from("emails_envoyes")
      .select("id", { count: "exact", head: true })
      .eq("dossier_id", dossierId).gte("created_at", jour.debut).lt("created_at", jour.fin)
    if (erreurCompte || typeof envoyes !== "number") {
      const raison = erreurCompte?.message ?? "aucun compte rendu"
      return json({
        error: `Les e-mails envoyés aujourd'hui pour ce dossier n'ont pas pu être comptés (${raison}) : ` +
          "l'e-mail n'est pas parti. Réessaie dans un instant.",
      }, 503)
    }
    if (envoyes >= PLAFOND_CLIENT_PAR_JOUR) {
      return json({
        error: `Ce dossier a déjà envoyé ${PLAFOND_CLIENT_PAR_JOUR} e-mails aujourd'hui, le plafond d'un accès ` +
          "client : celui-ci n'est pas parti. Il pourra partir demain, ou ton cabinet peut l'envoyer.",
      }, 429)
    }
  }

  const resend = new Resend(resendApiKey)

  const { data: sent, error: sendError } = await resend.emails.send({
    from: `${nomExpediteur} <contact@${DOMAINE_ENVOI}>`,
    to: adresse,
    replyTo: callerData.user.email ?? undefined,
    subject: objet,
    html,
  })
  if (sendError) {
    return json({ error: `Échec de l'envoi : ${sendError.message}` }, 502)
  }

  // L'E-MAIL EST DÉJÀ PARTI À CE STADE, donc ces deux écritures ne peuvent plus rien annuler : elles
  // ne bloquent pas la réponse. Mais une écriture best-effort se JOURNALISE — sans quoi un journal
  // d'envoi muet est indiscernable d'un envoi qui n'a pas eu lieu, et c'est précisément ce que cette
  // table existe pour empêcher (voir l'en-tête : « un cabinet doit toujours pouvoir retrouver qui »).
  // L'appelant, lui, reçoit `ok: true` et n'apprendrait rien.
  // La ligne d'un devis nomme son devis (`devis_id`), jamais une facture ; celle d'une facture ou d'une relance ne nomme
  // pas la colonne du tout — elle s'écrit ainsi même si la fonction partait avant la migration `envoi_des_devis`.
  // La relance d'une demande s'inscrit d'un seul tenant — le journal et la relance au canal « email » —, par la fonction
  // que le rôle du service est seul à exécuter ; ce qui a pu changer depuis le contrôle (une demande close) ne la refuse
  // pas : ce qui est parti s'inscrit. Échouée, l'appelant l'apprend (`relanceInscrite`) : la demande ne la dira pas.
  if (relanceDeDemande) {
    const { error: erreurInscription } = await admin.rpc("journaliser_relance_de_demande", {
      p_dossier_id: dossierId, p_demande_id: demandeId, p_destinataire: adresse, p_objet: objet,
      p_resend_id: sent?.id ?? null, p_envoye_par: callerData.user.id,
    })
    if (erreurInscription) {
      console.error(`[send-email] relance de demande ENVOYÉE (resend_id=${sent?.id ?? "?"}) mais ni journalisée ni inscrite : ${erreurInscription.message}`)
    }
    return json({ ok: true, relanceInscrite: !erreurInscription })
  }

  const { error: erreurJournal } = await admin.from("emails_envoyes").insert({
    dossier_id: dossierId, type, destinataire, objet,
    facture_id: factureId, resend_id: sent?.id ?? null, envoye_par: callerData.user.id,
    ...(type === "devis" ? { devis_id: devisId } : {}),
  })
  if (erreurJournal) {
    console.error(`[send-email] e-mail ENVOYÉ (resend_id=${sent?.id ?? "?"}) mais non journalisé : ${erreurJournal.message}`)
  }

  // La facture mémorise l'adresse à laquelle elle est partie ; le devis, figé dès son émission, n'en reçoit rien.
  if (type === "facture" && factureId) {
    const { error: erreurEmail } = await admin.from("factures_emises").update({ tiers_email: destinataire }).eq("id", factureId)
    if (erreurEmail) {
      console.error(`[send-email] adresse du destinataire non mémorisée sur la facture ${factureId} : ${erreurEmail.message}`)
    }
  }

  return json({ ok: true })
})
