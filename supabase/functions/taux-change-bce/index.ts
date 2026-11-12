import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

// Remplit `taux_change_bce` depuis le portail de données de la Banque centrale européenne, pour une
// devise et une date données, puis rend le taux applicable à cette date.
//
// Pourquoi la BCE et pas un convertisseur en ligne : le taux retenu pour convertir une facture doit
// pouvoir être REJOUÉ des années plus tard, à la même date, par quelqu'un d'autre — un contrôle, un
// repreneur de dossier. La BCE publie chaque jour ouvré, archive depuis 1999, et c'est la référence
// admise par l'administration.
//
// Alimentation à la demande plutôt qu'en masse : l'API du portail sert n'importe quelle période pour
// une devise, en quelques kilo-octets. Charger l'historique complet (1999 → aujourd'hui, une trentaine
// de devises) ferait des centaines de milliers de lignes dont ce cabinet n'utilisera jamais que
// quelques dizaines.
//
// Convention BCE conservée telle quelle : le taux est le nombre d'unités de devise pour 1 EUR
// (USD 1,1481 = 1 EUR vaut 1,1481 $). Convertir vers l'euro se fait en DIVISANT.

// La BCE ne publie pas les week-ends ni les jours fériés TARGET, et le fichier du jour ne paraît que
// vers 16h CET : une facture datée d'un samedi, ou de ce matin, n'a pas de taux à sa date. L'usage
// comptable est de retenir le dernier taux publié qui la précède. Dix jours couvrent le plus long
// trou de l'année (fin décembre) sans jamais remonter assez loin pour changer de mois de cotation.
const JOURS_DE_RECUL = 10

const RACINE_API = "https://data-api.ecb.europa.eu/service/data/EXR"

// LE NAVIGATEUR APPELLE CETTE FONCTION (`src/lib/tauxChange.ts`, `functions.invoke`), et d'une autre origine que la
// sienne : il demande d'abord la permission (le préflight, une requête OPTIONS), puis ne lit une réponse que si elle
// porte `Access-Control-Allow-Origin`. Jusqu'au 09/10/2026 la fonction ne répondait ni à l'un ni à l'autre — le
// préflight recevait un 400 nu, et le navigateur abandonnait l'appel avant même de le faire : un cours absent du cache
// ne se trouvait JAMAIS au dépôt d'une pièce, qui partait sans conversion. Le harnais HTTP des Edge Functions
// (`src/lib/edgeFunctionsHttp.test.ts`) le garde, avec les en-têtes que le SDK envoie réellement.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

interface Taux {
  date: string
  devise: string
  taux: number
}

// Le CSV du portail porte une trentaine de colonnes, dont certaines contiennent des virgules entre
// guillemets (les libellés, en fin de ligne). TIME_PERIOD et OBS_VALUE sont les colonnes 7 et 8,
// donc AVANT tout champ guillemeté : un découpage simple sur la virgule est sûr pour ces deux-là, et
// le rester ne dépend pas de ce que la BCE ajoutera après. Les lignes inexploitables sont ignorées
// plutôt que devinées.
export function lireCsvBce(csv: string, devise: string): Taux[] {
  const taux: Taux[] = []
  const lignes = csv.split(/\r?\n/)
  for (const ligne of lignes.slice(1)) {
    const champs = ligne.split(",")
    if (champs.length < 8) continue
    const date = champs[6]
    const valeur = Number.parseFloat(champs[7])
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
    if (!Number.isFinite(valeur) || valeur <= 0) continue
    taux.push({ date, devise, taux: valeur })
  }
  return taux
}

function dateMoinsJours(date: string, jours: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - jours)
  return d.toISOString().slice(0, 10)
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

// ── DÉBUT APPELANT ──────────────────────────────────────────────────────────────────────────────
// QUI APPELLE ? Jusqu'au 12/11/2026, rien ne le demandait ici : la passerelle (`verify_jwt = true`) ne refuse qu'un
// appel sans jeton SIGNÉ du projet, et la clé `anon` historique en est un — servie à tout visiteur avec l'ancien code du
// site, valable tant que le cabinet n'a pas désactivé les clés historiques. Elle suffisait à faire interroger la BCE et
// écrire `taux_change_bce` à la clé secrète, sans être personne ; une session d'un compte inscrit seul aussi, tant que
// l'inscription publique était ouverte (ligne 23.4, le défaut connu `tauxSansControle`, refermé ici).
// Un seul appelant légitime : une SESSION de l'application — le dépôt d'une pièce, sa relecture, l'import d'un fichier,
// la réception par la plateforme du client (`src/lib/tauxChange.ts`) —, d'un compte RATTACHÉ : chef ou membre d'une
// équipe, client d'un dossier (le dépôt de « Mes pièces »), super-administrateur. Le contrôle est celui
// d'`extract-piece` (« réservée à un compte RATTACHÉ »), posé de même avant de lire le corps, et le code qui suit est le
// sien à l'octet près : `extractPieceAppelant.test.ts` exécute les deux copies, les compare, et y passe
// `sessionRattachee` en paramètre pour les jouer sans réseau. La clé secrète en `apikey` y ouvre une porte que rien
// n'emprunte ici — aucune fonction n'appelle celle-ci de serveur à serveur, et la passerelle exige de toute façon un
// jeton — : qui la détient détient déjà toute la base. Refuser à tort ne coûte qu'une pièce non convertie, signalée
// (`tauxBce` rend null) ; accepter à tort ouvre la BCE et une écriture à la clé secrète à qui n'est personne.
async function appelantAutorise(
  autorisation: string | null,
  apikey: string | null,
  cleSecrete: string,
  sessionRattachee: (jeton: string) => Promise<boolean>,
): Promise<boolean> {
  if (apikey && cleSecrete && egaliteConstante(apikey, cleSecrete)) return true
  const jeton = /^Bearer\s+(\S+)\s*$/i.exec(autorisation ?? "")?.[1]
  if (!jeton) return false
  return await sessionRattachee(jeton)
}

// Deux chaînes comparées sans s'arrêter à la première différence : le temps de réponse ne dit pas
// combien de caractères d'une clé devinée sont justes. Leur longueur, elle, n'est pas un secret.
function egaliteConstante(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a)
  const y = new TextEncoder().encode(b)
  if (x.length !== y.length) return false
  let difference = 0
  for (let i = 0; i < x.length; i++) difference |= x[i] ^ y[i]
  return difference === 0
}

// UNE SESSION VALIDE NE PROUVE PAS QU'ON EST UN UTILISATEUR DE L'APPLICATION, et c'est mesuré :
// l'inscription publique est OUVERTE sur ce projet (`disable_signup: false`, relu le 26/09/2026 sur
// `/auth/v1/settings`), donc n'importe qui obtient une vraie session avec la clé publique et une
// adresse jetable. Ce qui distingue un compte de l'application est d'être RATTACHÉ : une ligne
// `cabinet_admins` (chef ou membre d'équipe), `memberships` (client d'un dossier) ou `super_admins`.
// Un compte inscrit seul ne peut pas se la donner : `cabinet_admins` et `super_admins` n'ont aucune
// policy d'insertion, et `memberships` exige `admin_du_dossier` (relu dans `pg_policies` le même jour).
// Chaque entrée est le résultat d'un comptage `head: true`. Un rattachement LU suffit, même si une
// autre lecture a échoué ; sans rattachement lu, une lecture en échec LÈVE plutôt que de refuser en
// silence — ne pas savoir n'autorise pas une dépense, mais un refus muet ferait passer une panne pour
// un compte inconnu.
function estRattache(comptes: { count: number | null; error: { message: string } | null }[]): boolean {
  if (comptes.some((c) => !c.error && (c.count ?? 0) > 0)) return true
  const erreur = comptes.find((c) => c.error)?.error
  if (erreur) throw new Error(`Rattachement de l'appelant invérifiable : ${erreur.message}`)
  return false
}
// ── FIN APPELANT ────────────────────────────────────────────────────────────────────────────────

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
  try {
    // AVANT de lire le corps : un appelant refusé ne coûte rien — ni la BCE, ni une écriture à la clé secrète. Voir
    // `appelantAutorise`.
    const cleSecrete = cleSupabase("SUPABASE_SECRET_KEYS", Deno.env.get("SUPABASE_SECRET_KEYS"))
    const autorise = await appelantAutorise(
      req.headers.get("Authorization"),
      req.headers.get("apikey"),
      cleSecrete,
      async (jeton) => {
        const url = Deno.env.get("SUPABASE_URL")!
        const verificateur = createClient(url, cleSupabase("SUPABASE_PUBLISHABLE_KEYS", Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")))
        const { data, error } = await verificateur.auth.getUser(jeton)
        if (error || !data.user) return false
        // Le rattachement se lit à la clé secrète : la réponse ne doit pas dépendre de ce que le
        // jeton de l'appelant a le droit de voir, et un compte inscrit seul n'en voit rien.
        const admin = createClient(url, cleSecrete)
        const id = data.user.id
        const [chefs, clients, superAdmins] = await Promise.all([
          admin.from("cabinet_admins").select("user_id", { count: "exact", head: true }).eq("user_id", id),
          admin.from("memberships").select("user_id", { count: "exact", head: true }).eq("user_id", id),
          admin.from("super_admins").select("user_id", { count: "exact", head: true }).eq("user_id", id),
        ])
        return estRattache([chefs, clients, superAdmins])
      },
    )
    if (!autorise) {
      return json({ erreur: "Le cours d'une devise demande d'être connecté à l'application." }, 401)
    }

    // La double authentification exigée (bloc DEUX FACTEURS) : pour un compte, jamais pour la clé secrète.
    const jetonDeLAppelant = /^Bearer\s+(\S+)\s*$/i.exec(req.headers.get("Authorization") ?? "")?.[1]
    if (DEUX_FACTEURS_EXIGES_EN_BASE && jetonDeLAppelant && !egaliteConstante(req.headers.get("apikey") ?? "", cleSecrete)) {
      const refusDeuxFacteurs = await refusDesDeuxFacteurs(createClient(Deno.env.get("SUPABASE_URL")!,
        cleSupabase("SUPABASE_PUBLISHABLE_KEYS", Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")),
        { global: { headers: { Authorization: `Bearer ${jetonDeLAppelant}` } } }))
      if (refusDeuxFacteurs) return refusDeuxFacteurs
    }

    // Un corps illisible, ou qui n'est pas un objet (`null`), se lit comme un corps vide : la devise manque, et le refus
    // le dit en français plutôt que par le message du moteur.
    const { devise, date } = (await req.json().catch(() => null)) ?? {}

    if (typeof devise !== "string" || !/^[A-Z]{3}$/.test(devise)) {
      return json({ erreur: "devise attendue au format ISO 4217, par exemple USD" }, 400)
    }
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return json({ erreur: "date attendue au format AAAA-MM-JJ" }, 400)
    }
    if (devise === "EUR") {
      return json({ erreur: "EUR n'a pas de taux de change vers lui-même" }, 400)
    }

    const debut = dateMoinsJours(date, JOURS_DE_RECUL)
    const url = `${RACINE_API}/D.${devise}.EUR.SP00.A?startPeriod=${debut}&endPeriod=${date}&format=csvdata`
    const reponse = await fetch(url, { headers: { accept: "text/csv" } })

    // 404 sur ce portail veut dire « aucune observation sur la période », pas « service en panne » :
    // c'est le cas d'une devise que la BCE ne cote pas. À distinguer d'une vraie panne, sinon on
    // réessaierait indéfiniment une devise qui n'existera jamais.
    if (reponse.status === 404) {
      return json({ erreur: `La BCE ne cote pas ${devise}, ou pas sur cette période`, devise, date }, 404)
    }
    if (!reponse.ok) {
      return json({ erreur: `La BCE a répondu ${reponse.status}`, devise, date }, 502)
    }

    const taux = lireCsvBce(await reponse.text(), devise)
    if (taux.length === 0) {
      // Zéro ligne n'est pas un succès : soit le format a changé, soit la réponse n'est pas celle
      // qu'on croit. Rendre « pas de taux » ferait enregistrer une pièce non convertie comme si
      // c'était normal.
      return json({ erreur: "Réponse de la BCE illisible ou sans cotation", devise, date }, 502)
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, cleSecrete)
    const { error } = await supabase.from("taux_change_bce").upsert(taux, { onConflict: "date,devise" })
    if (error) {
      return json({ erreur: `Enregistrement refusé : ${error.message}` }, 500)
    }

    // Le dernier taux publié à la date demandée ou avant — jamais après, sinon on convertirait une
    // facture avec un cours qui n'existait pas encore le jour où elle a été émise.
    const applicable = taux
      .filter((t) => t.date <= date)
      .sort((a, b) => a.date.localeCompare(b.date))
      .at(-1)

    return json({
      devise,
      date_demandee: date,
      date_du_taux: applicable?.date ?? null,
      taux: applicable?.taux ?? null,
      cotations_enregistrees: taux.length,
    })
  } catch (err) {
    return json({ erreur: err instanceof Error ? err.message : String(err) }, 500)
  }
})

function json(corps: unknown, status = 200): Response {
  return new Response(JSON.stringify(corps), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  })
}
