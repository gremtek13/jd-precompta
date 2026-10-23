// Edge Function : réception des pièces envoyées par e-mail (Palier 4).
//
// Le client configure un transfert automatique de ses e-mails de prélèvement récurrent vers une
// adresse dédiée <code_dossier>@precompta.jdarnis.fr — sans jamais donner accès à sa messagerie.
// Resend reçoit ces e-mails et appelle cette fonction via un webhook "email.received" à chaque
// réception ; on récupère les pièces jointes, on les dépose dans le Storage du dossier correspondant,
// on les fait passer par la même extraction/classification que l'import manuel ou en masse (voir
// extract-piece), puis on crée une pièce ou un document "à valider" selon le résultat — exactement
// comme un dépôt manuel, rien n'est jamais validé automatiquement.
//
// Sécurité : cette fonction est publique (pas de vérification JWT Supabase, Resend n'en envoie pas) —
// la seule authentification est la signature du webhook (RESEND_WEBHOOK_SECRET), vérifiée avant tout
// traitement. Elle utilise la clé secrète Supabase pour écrire directement en base et au storage,
// sans passer par les policies RLS (il n'y a pas d'utilisateur authentifié dans ce flux) — et pour
// appeler extract-piece en tant que service (le client web l'appelle avec la session de l'utilisateur,
// ici il n'y en a pas).

import { Resend } from "npm:resend@6"
import { createClient } from "npm:@supabase/supabase-js@2"

function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9.]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
}

// Le "to" d'un e-mail reçu peut être un simple "code@domaine" ou "Nom <code@domaine>" selon le
// client mail d'origine du transfert — on isole l'adresse dans les deux cas.
function extractEmail(raw: string): string {
  const match = raw.match(/<([^>]+)>/)
  return (match ? match[1] : raw).trim().toLowerCase()
}

async function hashBytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("")
}

// Doit lister TOUTES les classifications que rend `extract-piece`, y compris celles ajoutées après
// coup : cette union était restée à quatre valeurs alors que la classification en rendait six, et un
// type qui ment ne protège de rien — c'est ce qui a laissé passer le défaut corrigé plus bas.
interface ExtractionPiece {
  classification: "releve_bancaire" | "cotisation" | "attestation" | "autre" | "facture" | "facture_vente"
  date_piece: string | null
  tiers: string | null
  montant_ht: number | null
  montant_tva: number | null
  montant_ttc: number | null
  confiance: "haute" | "moyenne" | "basse"
}

// Où va un document une fois classé, et sous quelle forme. Copie assumée de `orientationDe`
// (src/lib/extraction.ts) : cette fonction est auto-portée, elle ne peut rien importer de src/.
//
// **C'est la troisième copie de cette règle, et celle qui a été oubliée.** `depot.ts` et
// `importFichiers.ts` ont été unifiés derrière `orientationDe` quand les bordereaux de
// télétransmission sont devenus des recettes ; ce chemin-ci, lui, est resté sur son test binaire
// `classification === "facture"`. Conséquence en production : un bordereau reçu par e-mail tombait
// dans la branche « Documents » avec `categorie: "facture_vente"`, une valeur que le CHECK de
// `documents_divers` refuse — l'insertion échouait, la pièce jointe était perdue et le fichier restait
// orphelin dans le stockage. Le client envoyait son bordereau, rien n'arrivait, et seul un
// `console.error` en gardait trace.
//
// La leçon tient en une ligne : une règle dupliquée se corrige dans TOUTES ses copies le même jour.
// `receiveEmailOrientation.test.ts` lit désormais cette source-ci et la source de `src/lib` pour
// vérifier qu'elles rendent la même chose sur toutes les classifications.
type ClassificationDocument = ExtractionPiece["classification"]
type CategorieDocument = "releve_bancaire" | "cotisation" | "attestation" | "autre"
type Orientation =
  | { destination: "pieces"; type_piece: "achat" | "vente" }
  | { destination: "documents"; categorie: CategorieDocument }

function orientationDe(classification: ClassificationDocument): Orientation {
  if (classification === "facture") return { destination: "pieces", type_piece: "achat" }
  if (classification === "facture_vente") return { destination: "pieces", type_piece: "vente" }
  return { destination: "documents", categorie: classification }
}

// Même appel que celui que fait le navigateur (lib/extraction.ts côté client) mais depuis le serveur —
// pas de session utilisateur ici, donc la clé secrète sert d'autorisation. Elle part dans l'en-tête
// `apikey` et nulle part ailleurs : ce n'est pas un jeton, et la plateforme refuse une clé de cette
// forme en `Authorization` (voir `appelantAutorise` dans extract-piece). Best-effort : un échec
// (Textract, format refusé...) ne doit pas bloquer l'import, juste laisser les champs vides à compléter
// à la main, comme pour un dépôt manuel dont l'extraction aurait échoué. Mais un refus se JOURNALISE :
// muet, un changement de contrat entre les deux fonctions ferait arriver chaque pièce jointe sans
// lecture, et rien ne le dirait.
async function classifierEtExtraire(bytes: Uint8Array, supabaseUrl: string, cleSecrete: string): Promise<ExtractionPiece | null> {
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/extract-piece`, {
      method: "POST",
      headers: { apikey: cleSecrete },
      body: bytes,
    })
    if (!res.ok) {
      console.error(`[receive-email] extract-piece a répondu ${res.status} : pièce jointe déposée sans lecture`)
      return null
    }
    const result = await res.json()
    return result.error ? null : result
  } catch (err) {
    console.error("Appel extract-piece échoué:", err)
    return null
  }
}

// LA TRACE D'UNE PIÈCE JOINTE ÉCARTÉE (ligne 22.7 ; décision du cabinet du 13/10/2026, S226-Q3). Écartée sans trace,
// elle manquait à tout le monde : le client croyait l'avoir envoyée, le cabinet n'en savait rien — le journal de la
// fonction ne se garde qu'un temps et ne s'ouvre pas depuis l'application. Une ligne par pièce jointe dans
// `pieces_jointes_ecartees`, que l'onglet Justificatifs du cabinet lit : le dossier, la raison, le poids — jamais le nom
// du fichier, son extension, l'expéditeur ni l'objet. Resend rejoue le webhook quand la fonction échoue en cours de
// route : la clé — le dossier, et l'EMPREINTE des deux identifiants que Resend donne à la pièce jointe, jamais ces
// identifiants eux-mêmes, qui désigneraient un e-mail qu'on peut relire chez Resend — fait qu'un rejeu n'écrit rien de
// plus (`on conflict do nothing`). L'erreur se lit et se journalise sans lever — ce qui lèverait en chemin aussi : rien
// ne recharge derrière, et la pièce jointe suivante se traite.
//
// LE DÉPÔT QUI A ÉCHOUÉ (ligne 22.8 ; décision du cabinet du 13/10/2026, S227-Q3). Les autres pertes d'une pièce jointe
// — Resend ne la rend pas, son téléchargement échoue, la recherche de doublon tombe, le stockage ou l'insertion refusent,
// une exception — n'avaient, elles aussi, que le journal : la fonction répond 200, et Resend ne rejoue pas. Elles
// s'écrivent sous la raison `depot`, avec le poids de la pièce jointe s'il a été lu, INCONNU (null) sinon — jamais
// deviné : la migration `pieces_jointes_ecartees_depot` ne l'admet que pour cette raison. Une pièce jointe déjà au
// dossier (même empreinte) n'est pas une perte : rien ne s'écrit.
//
// LA PIÈCE JOINTE ARRIVÉE VIDE (ligne 22.91 ; décision du cabinet du 13/10/2026, S228-Q2). Une pièce jointe de 0 octet
// n'était que sautée : elle s'écrit sous la raison `vide`, au poids ZÉRO — la migration `pieces_jointes_ecartees_vide`
// n'admet zéro que pour elle, et ne l'admet pas d'un autre poids.
async function noterLaPieceJointeEcartee(
  supabase: ReturnType<typeof createClient>, dossierId: string, emailId: string, pieceJointeId: string,
  raison: "format" | "taille" | "depot" | "vide", octets: number | null,
): Promise<void> {
  let erreur: string | null
  try {
    const empreinte = await hashBytes(new TextEncoder().encode(JSON.stringify([emailId, pieceJointeId])))
    const { error } = await supabase
      .from("pieces_jointes_ecartees")
      .upsert({ dossier_id: dossierId, raison, octets, empreinte }, { onConflict: "dossier_id,empreinte", ignoreDuplicates: true })
    erreur = error ? error.message : null
  } catch (err) {
    erreur = String(err)
  }
  if (erreur !== null) {
    console.error(`[receive-email] pièce jointe écartée NON consignée (${raison}, ${octets === null ? "poids inconnu" : `${octets} octets`}) : ${erreur}`)
  }
}

// LES ÉLÉMENTS DE L'E-MAIL QUI NE SONT PAS DES PIÈCES JOINTES, COMPTÉS AU JOURNAL (ligne 22.92 ; décision du cabinet du
// 13/10/2026, S228-Q4). Resend range dans `attachments` tout fichier que porte l'e-mail, chacun avec sa disposition et
// son type DÉCLARÉ (documentation publique de l'événement `email.received` : resend.com/docs/webhooks/emails/received,
// dont l'exemple porte une image « inline ») ; la boucle de dépôt ne prend que
// les vraies pièces jointes (`"attachment"`), et les autres partaient sans aucune trace — or un PDF « inline » peut être
// une facture que le client croit avoir envoyée. Avant de décider, le cabinet veut les COMPTER sur les e-mails réels :
// leur nombre, par disposition (inline, une autre, aucune) et par famille de type DÉCLARÉ (PDF, image, autre). Ce type
// n'est ici qu'un compte, jamais une décision de dépôt — celle-ci se prend sur le nom et les octets (bornes des seaux,
// ligne 22.6). Rien n'est lu chez Resend, téléchargé, déposé ni écrit en base pour eux ; et la ligne ne porte ni leur
// nom, ni leur identifiant, ni leur disposition ou leur type tels quels — un en-tête MIME peut porter le nom du fichier
// (`name=`, `filename=`) — : des comptes seulement.
type DispositionComptee = "inline" | "autre" | "aucune"
type FamilleComptee = "pdf" | "image" | "autre"

function dispositionComptee(brute: unknown): DispositionComptee {
  if (brute === undefined || brute === null || brute === "") return "aucune"
  if (typeof brute !== "string") return "autre"
  return brute.split(";")[0].trim().toLowerCase() === "inline" ? "inline" : "autre"
}

function familleComptee(brut: unknown): FamilleComptee {
  if (typeof brut !== "string") return "autre"
  const type = brut.split(";")[0].trim().toLowerCase()
  if (type === "application/pdf") return "pdf"
  return type.startsWith("image/") ? "image" : "autre"
}

/** Ce que le journal dit des éléments de `attachments` qui ne sont pas des pièces jointes : des comptes, sans nom. */
function compteDesElementsIntegres(elements: readonly unknown[]): string {
  const comptes: Record<DispositionComptee, Record<FamilleComptee, number>> = {
    inline: { pdf: 0, image: 0, autre: 0 }, autre: { pdf: 0, image: 0, autre: 0 }, aucune: { pdf: 0, image: 0, autre: 0 },
  }
  let total = 0
  for (const element of elements) {
    const e = (element !== null && typeof element === "object" ? element : {}) as Record<string, unknown>
    // Le complément EXACT du filtre des pièces jointes : tout ce qui n'est pas `"attachment"`, l'absence comprise.
    if (e.content_disposition === "attachment") continue
    comptes[dispositionComptee(e.content_disposition)][familleComptee(e.content_type)] += 1
    total += 1
  }
  const dits = (d: DispositionComptee) => {
    const c = comptes[d]
    return `${c.pdf + c.image + c.autre} (PDF ${c.pdf}, image ${c.image}, autre ${c.autre})`
  }
  return `${total} élément(s) de l'e-mail hors pièces jointes, non déposé(s) — inline ${dits("inline")} ; `
    + `autre disposition ${dits("autre")} ; sans disposition ${dits("aucune")}`
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

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 })
  }

  const resendApiKey = Deno.env.get("RESEND_API_KEY")
  const webhookSecret = Deno.env.get("RESEND_WEBHOOK_SECRET")
  if (!resendApiKey || !webhookSecret) {
    console.error("RESEND_API_KEY ou RESEND_WEBHOOK_SECRET manquant")
    return new Response("Configuration serveur incomplète", { status: 500 })
  }

  // Le corps brut (texte, pas encore parsé) est nécessaire à la vérification de signature.
  const rawBody = await req.text()
  const svixId = req.headers.get("svix-id")
  const svixTimestamp = req.headers.get("svix-timestamp")
  const svixSignature = req.headers.get("svix-signature")
  if (!svixId || !svixTimestamp || !svixSignature) {
    return new Response("En-têtes de signature manquants", { status: 400 })
  }

  const resend = new Resend(resendApiKey)

  let event
  try {
    event = resend.webhooks.verify({
      payload: rawBody,
      headers: { id: svixId, timestamp: svixTimestamp, signature: svixSignature },
      webhookSecret,
    })
  } catch (err) {
    console.error("Signature webhook invalide:", err)
    return new Response("Signature invalide", { status: 401 })
  }

  if (event.type !== "email.received") {
    // On ne s'abonne qu'à cet événement côté Resend, mais on répond calmement si un autre arrive.
    return new Response("ok", { status: 200 })
  }

  // `from` et `subject` ne se lisent pas : rien de cette fonction n'en a besoin, et ne pas les nommer garantit qu'aucune
  // ligne de journal ne les recopie.
  const { email_id, to, attachments } = event.data

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!
  const cleSecrete = cleSupabase("SUPABASE_SECRET_KEYS", Deno.env.get("SUPABASE_SECRET_KEYS"))
  const supabase = createClient(supabaseUrl, cleSecrete)

  // LE JOURNAL NE PORTE QUE DES COMPTES (ligne 23-journalEmail ; décision du cabinet du 18/10/2026) : ni l'adresse d'un
  // destinataire, ni son code de collecte, ni l'expéditeur, ni l'objet — un objet peut nommer un patient, une adresse
  // désigne une personne, et le journal de la fonction se garde et se lit ailleurs que dans l'application. Chaque ligne
  // ci-dessous dit COMBIEN (de destinataires, de pièces jointes, de pièces importées), jamais DE QUI ni DE QUOI ;
  // l'identifiant que Resend donne à l'e-mail reste, opaque : c'est lui qui retrouve l'e-mail chez Resend, où seul le
  // cabinet peut le lire.
  const codeEmail = to.map(extractEmail).map((addr) => addr.split("@")[0]).find((c) => !!c)
  if (!codeEmail) {
    console.error(`[receive-email] aucun destinataire exploitable : ${to.length} destinataire(s) reçu(s), e-mail ${email_id}`)
    return new Response("ok", { status: 200 })
  }

  const { data: dossier, error: dossierError } = await supabase
    .from("dossiers")
    .select("id")
    .eq("code_email", codeEmail)
    .maybeSingle()

  if (dossierError) {
    // Le code et le message de PostgREST, jamais son détail ni l'objet entier : le journal ne recopie rien de la requête.
    console.error(`[receive-email] lecture du dossier refusée (${dossierError.code || "sans code"} ${dossierError.message})`)
    return new Response("Erreur base de données", { status: 500 })
  }
  if (!dossier) {
    // Adresse inconnue (faute de frappe côté client, ancien transfert...) — on ignore silencieusement
    // plutôt que de renvoyer une erreur, ce qui ferait retenter Resend inutilement. Le journal dit qu'elle est
    // inconnue et combien l'e-mail portait de destinataires et de fichiers : ni l'adresse, ni son code, ni l'expéditeur,
    // ni l'objet — l'identifiant de l'e-mail suffit à le retrouver chez Resend.
    console.warn(`[receive-email] adresse de collecte inconnue : e-mail ${email_id}, ${to.length} destinataire(s), ${(attachments ?? []).length} fichier(s) joint(s)`)
    return new Response("ok", { status: 200 })
  }

  // Seules les vraies pièces jointes nous intéressent — pas les images intégrées à une signature
  // (logo...), qui arrivent avec content_disposition "inline".
  const fichiers = (attachments ?? []).filter((a) => a.content_disposition === "attachment")
  // Les autres se COMPTENT, sans nom (ligne 22.92), avant toute pièce jointe : le compte reste au journal même si la
  // boucle s'arrête en route.
  console.log(`[receive-email] dossier ${dossier.id} : ${compteDesElementsIntegres(attachments ?? [])}`)

  let nbImportees = 0
  for (const fichier of fichiers) {
    // Le poids de la pièce jointe, une fois téléchargée : inconnu (null) tant que rien n'a été lu — Resend ne l'a pas
    // rendue, son téléchargement a échoué, une exception est venue avant —, et dit tel quel au cabinet, jamais deviné.
    let octets: number | null = null
    try {
      const { data: detail, error: attachError } = await resend.emails.receiving.attachments.get({
        emailId: email_id,
        id: fichier.id,
      })
      if (attachError || !detail) {
        console.error("Récupération pièce jointe échouée:", fichier.id, attachError)
        await noterLaPieceJointeEcartee(supabase, dossier.id, email_id, fichier.id, "depot", null)
        continue
      }

      const res = await fetch(detail.download_url)
      if (!res.ok) {
        console.error("Téléchargement pièce jointe échoué:", fichier.id, res.status)
        await noterLaPieceJointeEcartee(supabase, dossier.id, email_id, fichier.id, "depot", null)
        continue
      }
      const bytes = new Uint8Array(await res.arrayBuffer())
      octets = bytes.byteLength
      // UNE PIÈCE JOINTE ARRIVÉE VIDE (0 octet ; ligne 22.91) : il n'y a rien à déposer ni à lire — ni le stockage ni
      // extract-piece ne la voient —, mais le client croit l'avoir envoyée. Elle se consigne pour le cabinet sous sa
      // raison, au poids zéro, une fois (la clé de toute pièce jointe écartée), et se journalise sans son nom. Ni « son
      // format et son poids allaient » ni « renvoie-la telle quelle » ne sont vrais d'elle : l'écran demande au client de
      // vérifier son fichier.
      if (bytes.byteLength === 0) {
        console.warn(`Pièce jointe écartée, arrivée vide (0 octet) : ${fichier.id}`)
        await noterLaPieceJointeEcartee(supabase, dossier.id, email_id, fichier.id, "vide", 0)
        continue
      }
      // LES BORNES DU SEAU DES PIÈCES (ligne 22.6), celles que l'application applique à tout dépôt : le type se décide
      // sur le nom et les premiers octets — jamais sur celui que DÉCLARE l'expéditeur, qui partait tel quel au stockage
      // —, et une pièce jointe hors des bornes est écartée avant tout envoi, journalisée sans son nom, et consignée pour
      // le cabinet (ligne 22.7).
      const nomFichier = fichier.filename || `piece-${fichier.id}`
      const type = typeDUnePiece(nomFichier, bytes.subarray(0, 16))
      if (type === null) {
        console.warn(`Pièce jointe écartée, format non pris en charge (PDF, JPEG, PNG ou CSV) : ${fichier.id}`)
        await noterLaPieceJointeEcartee(supabase, dossier.id, email_id, fichier.id, "format", bytes.byteLength)
        continue
      }
      if (bytes.byteLength > TAILLE_MAX_PIECE) {
        console.warn(`Pièce jointe écartée, ${bytes.byteLength} octets au-delà de la borne de ${TAILLE_MAX_PIECE} : ${fichier.id}`)
        await noterLaPieceJointeEcartee(supabase, dossier.id, email_id, fichier.id, "taille", bytes.byteLength)
        continue
      }

      // Même détection de doublon que les autres points d'entrée (import manuel, en masse) — un
      // transfert automatique peut renvoyer plusieurs fois le même e-mail (relance client, règle de
      // transfert mal configurée...).
      const hash = await hashBytes(bytes)
      const [pieces, documents] = await Promise.all([
        supabase.from("pieces").select("id", { count: "exact", head: true }).eq("dossier_id", dossier.id).eq("storage_hash", hash),
        supabase.from("documents_divers").select("id", { count: "exact", head: true }).eq("dossier_id", dossier.id).eq("storage_hash", hash),
      ])
      // UN `count` NUL EST INDISCERNABLE D'UN « AUCUN DOUBLON TROUVÉ ». C'est mot pour mot le défaut
      // que `fichierDejaPresent` (src/lib/extraction.ts) a été corrigé pour ne plus avoir, resté
      // entier sur cette troisième copie — que la fonction soit auto-portée n'y change rien, et le
      // commentaire ci-dessus promettait justement « la même détection que les autres points
      // d'entrée ».
      //
      // ON SAUTE LA PIÈCE JOINTE plutôt que de la déposer : un doublon est PERMANENT et compte la
      // même charge deux fois en 2035 comme en balance, alors qu'une pièce jointe non déposée laisse
      // la trace que laisse déjà tout échec de cette fonction — et le dossier continue de réclamer
      // le document sur les trois écrans « ce qu'il reste à envoyer », donc le manque se voit.
      // Le twin de `src/` LÈVE ; ici il n'y a aucun opérateur pour recevoir une exception.
      const erreurDoublon = pieces.error ?? documents.error
      if (erreurDoublon) {
        console.error(`Détection de doublon impossible, pièce jointe ignorée: ${fichier.id} (${erreurDoublon.message})`)
        await noterLaPieceJointeEcartee(supabase, dossier.id, email_id, fichier.id, "depot", octets)
        continue
      }
      // Déjà au dossier : ce n'est pas une perte, rien ne s'écrit pour le cabinet.
      if ((pieces.count ?? 0) > 0 || (documents.count ?? 0) > 0) {
        console.log(`Pièce jointe déjà présente (hash identique), ignorée: ${fichier.id}`)
        continue
      }

      // L'horodatage à part : le journal d'un fichier orphelin le cite sans le nom que porte le chemin.
      const horodatage = Date.now()
      const path = `${dossier.id}/${horodatage}-${slugify(nomFichier)}`

      // Un Blob du type décidé ci-dessus : c'est lui que le stockage juge (supabase-js envoie un Blob en multipart, la
      // partie portant son type).
      const { error: uploadError } = await supabase.storage
        .from("pieces")
        .upload(path, new Blob([bytes], { type }))
      if (uploadError) {
        console.error("Upload storage échoué:", fichier.id, uploadError)
        await noterLaPieceJointeEcartee(supabase, dossier.id, email_id, fichier.id, "depot", octets)
        continue
      }

      // Un CSV n'est jamais envoyé à Textract (relevés/factures en PDF ou image uniquement) — classé
      // directement en relevé bancaire sur son extension, comme les autres points d'entrée. Les autres
      // formats passent par la même extraction/classification que l'import manuel ou en masse.
      const estCsv = nomFichier.toLowerCase().endsWith(".csv")
      const extraction = estCsv ? null : await classifierEtExtraire(bytes, supabaseUrl, cleSecrete)
      const classification = estCsv ? "releve_bancaire" : (extraction?.classification ?? "facture")
      const orientation = orientationDe(classification)

      const insertError = orientation.destination === "pieces"
        ? (await supabase.from("pieces").insert({
            dossier_id: dossier.id,
            source: "email",
            storage_path: path,
            storage_hash: hash,
            nom_fichier: nomFichier,
            type_piece: orientation.type_piece,
            statut: "a_valider",
            date_piece: extraction?.date_piece ?? null,
            tiers: extraction?.tiers ?? null,
            montant_ht: extraction?.montant_ht ?? null,
            montant_tva: extraction?.montant_tva ?? null,
            montant_ttc: extraction?.montant_ttc ?? null,
            confiance: extraction?.confiance ?? null,
          })).error
        : (await supabase.from("documents_divers").insert({
            dossier_id: dossier.id,
            storage_path: path,
            storage_hash: hash,
            nom_fichier: nomFichier,
            categorie: orientation.categorie,
          })).error

      if (insertError) {
        // Le fichier est dans le stockage mais rien ne pointe dessus : on le retire avant de passer à
        // la pièce jointe suivante. Sans ça il y reste orphelin, invisible de tout écran, et seule la
        // suppression du dossier entier l'aurait nettoyé — même règle que `depot.ts` et
        // `importFichiers.ts`, qui la portent depuis longtemps.
        // Et une compensation dont on jette le résultat laisse exactement l'orphelin qu'elle existe
        // pour éviter — même défaut que les deux `delete` de create-cabinet. Rien ne recharge
        // derrière : personne ne relit le seau, donc le fichier resterait là sans qu'aucun écran ni
        // aucun compte ne puisse le montrer.
        // Le code et le message de PostgREST, jamais son détail : il recopie la ligne refusée — le nom du fichier, le
        // tiers et les montants lus.
        console.error(`Insertion échouée: ${fichier.id} (${insertError.code || "sans code"} ${insertError.message})`)
        const { error: erreurRetrait } = await supabase.storage.from("pieces").remove([path])
        if (erreurRetrait) {
          // Le dossier et l'horodatage le retrouvent dans le seau ; le reste du chemin est le nom du fichier.
          console.error(`[receive-email] fichier ORPHELIN laissé dans le stockage : ${dossier.id}/${horodatage}-… (${erreurRetrait.message})`)
        }
        await noterLaPieceJointeEcartee(supabase, dossier.id, email_id, fichier.id, "depot", octets)
        continue
      }

      nbImportees++
    } catch (err) {
      console.error("Erreur traitement pièce jointe:", fichier.id, err)
      await noterLaPieceJointeEcartee(supabase, dossier.id, email_id, fichier.id, "depot", octets)
    }
  }

  console.log(`E-mail ${email_id} → dossier ${dossier.id} : ${nbImportees}/${fichiers.length} pièce(s) importée(s)`)
  return new Response("ok", { status: 200 })
})
