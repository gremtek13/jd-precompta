// Edge Function : envoi d'e-mails au client depuis l'app — facture par e-mail, relance pour obtenir
// des pièces. Utilise le même compte Resend et le même domaine que receive-email (réception),
// precompta.jdarnis.fr, déjà vérifié en envoi ET en réception (voir Dashboard Resend).
//
// Deux modèles pour l'instant (voir payload.type) :
// - "facture" : envoie le détail d'une facture déjà validée (lignes, montants, mentions légales) en
//   corps d'e-mail HTML. PAS de pièce jointe PDF pour l'instant — générer un vrai PDF côté serveur
//   est un chantier à part (voir FactureApercu, qui s'appuie sur l'impression navigateur) : à ajouter
//   si les cabinets réclament la pièce jointe une fois ce premier envoi en usage.
// - "relance_pieces" : simple rappel invitant le client à se connecter à son espace pour déposer ses
//   pièces — aucun lien magique/jeton, le client se connecte normalement, comme d'habitude.
//
// Chaque envoi est journalisé (table emails_envoyes) : un cabinet doit toujours pouvoir retrouver qui
// a reçu quoi et quand, jamais un envoi "silencieux" qu'on ne peut plus vérifier après coup.
//
// Qui peut quoi (`QUI_PEUT_QUOI`, espace client, étape P3) : la facture, le cabinet du dossier et le client dont
// l'accès porte la case « Ventes » ; la relance de pièces, le cabinet seul. Les droits se lisent avec le jeton de
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
// celle que le cabinet adresse à son client. Un changement de décision est une ligne ; le modèle « devis » viendra avec
// l'étape P6.
const QUI_PEUT_QUOI: Readonly<Record<string, DroitExige>> = {
  facture: "ventes",
  relance_pieces: "cabinet",
}

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

interface FactureRow {
  id: string; numero: string | null; date_emission: string; date_echeance: string | null
  tiers_nom: string; montant_ht: number; montant_tva: number; montant_ttc: number
  mentions_legales: string | null; emetteur_nom: string | null; type: "facture" | "avoir"
}
interface LigneRow { designation: string; quantite: number; prix_unitaire_ht: number; taux_tva: number }

function formaterMontant(n: number): string {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €"
}
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

function construireEmailFacture(facture: FactureRow, lignes: LigneRow[], messagePerso: string | null): { objet: string; html: string } {
  const emetteur = facture.emetteur_nom ?? "Le cabinet"
  const typeLabel = facture.type === "avoir" ? "Avoir" : "Facture"
  const lignesHtml = lignes.map((l) => {
    const ht = Math.round(l.quantite * l.prix_unitaire_ht * 100) / 100
    return `<tr><td style="padding:4px 8px;border-bottom:1px solid #eee;">${echapper(l.designation)}</td><td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right;">${l.quantite}</td><td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right;">${formaterMontant(ht)}</td></tr>`
  }).join("")
  const html = `
    <div style="font-family:sans-serif;color:#222;max-width:560px;">
      <p>Bonjour,</p>
      ${messagePerso ? `<p>${echapper(messagePerso)}</p>` : ""}
      <p>Veuillez trouver ci-dessous le détail de ${typeLabel === "Avoir" ? "l'avoir" : "la facture"} <strong>${echapper(facture.numero ?? "")}</strong>, émis${typeLabel === "Avoir" ? "" : "e"} le ${formaterDate(facture.date_emission)}${facture.date_echeance ? ` (échéance le ${formaterDate(facture.date_echeance)})` : ""}.</p>
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
  return { objet: `${typeLabel} ${facture.numero ?? ""} — ${emetteur}`, html }
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
  for (const champ of ["dossierId", "type", "destinataire", "message", "factureId"]) {
    if (!texteOuAbsent(payload[champ])) {
      return json({ error: `Corps de requête invalide : « ${champ} » doit être un texte.` }, 400)
    }
  }
  const texte = (champ: string) => (payload[champ] as string | null | undefined)?.trim()
  const dossierId = texte("dossierId")
  const type = payload.type
  const destinataire = texte("destinataire")
  const messagePerso = texte("message") || null
  if (!dossierId || (type !== "facture" && type !== "relance_pieces") || !destinataire) {
    return json({ error: "dossierId, type ('facture' ou 'relance_pieces') et destinataire sont requis." }, 400)
  }
  if (!EMAIL_REGEX.test(destinataire)) {
    return json({ error: "Adresse e-mail du destinataire invalide." }, 400)
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
    const construit = construireEmailFacture(factureData as FactureRow, (lignesData ?? []) as LigneRow[], messagePerso)
    objet = construit.objet
    html = construit.html
    nomExpediteur = factureData.emetteur_nom ?? dossierRow.nom
  } else {
    const construit = construireEmailRelance(dossierRow.nom, messagePerso)
    objet = construit.objet
    html = construit.html
  }

  // Le plafond d'un accès client, compté juste avant l'envoi : le dernier contrôle, une fois tout le reste jugé. Un
  // compte illisible refuse — l'e-mail parti ne se rattrape pas.
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
    to: destinataire,
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
  const { error: erreurJournal } = await admin.from("emails_envoyes").insert({
    dossier_id: dossierId, type, destinataire, objet,
    facture_id: factureId, resend_id: sent?.id ?? null, envoye_par: callerData.user.id,
  })
  if (erreurJournal) {
    console.error(`[send-email] e-mail ENVOYÉ (resend_id=${sent?.id ?? "?"}) mais non journalisé : ${erreurJournal.message}`)
  }

  if (type === "facture" && factureId) {
    const { error: erreurEmail } = await admin.from("factures_emises").update({ tiers_email: destinataire }).eq("id", factureId)
    if (erreurEmail) {
      console.error(`[send-email] adresse du destinataire non mémorisée sur la facture ${factureId} : ${erreurEmail.message}`)
    }
  }

  return json({ ok: true })
})
