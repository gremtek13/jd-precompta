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

Deno.serve(async (req: Request) => {
  try {
    const { devise, date } = await req.json().catch(() => ({}))

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

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    )
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
    headers: { "Content-Type": "application/json" },
  })
}
