// supabase-js ne remplit JAMAIS `data` sur une réponse non-2xx d'une Edge Function (voir
// @supabase/functions-js, FunctionsClient : `if (!response.ok) throw new FunctionsHttpError(response)`
// se produit AVANT toute lecture du corps de la réponse) — contrairement à ce qu'un certain nombre
// d'écrans de cette app supposaient (`data?.error`, toujours undefined sur une erreur, quel que soit
// le message JSON réellement renvoyé par la fonction). Le vrai message se lit sur
// `error.context` (la Response brute, jamais consommée à ce stade) via `.json()`.
//
// Découvert en testant l'émission Super PDP en conditions réelles : le serveur renvoyait bien
// "Le SIRET de l'émetteur... est manquant" en JSON avec un statut 400, mais l'écran affichait le
// message générique de repli faute de lire error.context — un bug d'affichage silencieux, présent
// depuis le début sur tous les appels de fonctions Edge de l'app (voir les usages de
// `supabase.functions.invoke`), pas seulement sur Super PDP.
export async function extraireErreurFonction(error: unknown, repli = 'Une erreur est survenue.'): Promise<string> {
  if (error && typeof error === 'object' && 'context' in error) {
    const context = (error as { context?: unknown }).context
    if (context instanceof Response) {
      try {
        const body = await context.json()
        if (body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string') {
          return (body as { error: string }).error
        }
      } catch {
        // Corps non-JSON (ex. timeout de la plateforme, page d'erreur brute) — repli plus bas.
      }
    }
  }
  if (error instanceof Error && error.message) return error.message
  return repli
}

// LE CODE D'UN REFUS, À CÔTÉ DE SA PHRASE (BOR6, 27/11/2026) : une fonction qui veut qu'un appelant RECONNAISSE un refus, sans
// lire sa phrase, rend `{ error, code }` — `extract-piece` refuse ainsi (422, `bordereau`) la lecture d'un document qui a la
// forme d'un bordereau de télétransmission. Le corps se lit sur une COPIE (`clone`) : `extraireErreurFonction` peut encore lire
// la phrase après. Rend `null` sur tout le reste (pas de réponse, corps illisible, pas de code) : un appelant qui ne reconnaît
// rien traite le refus comme hier.
export async function codeDeLErreurFonction(error: unknown): Promise<string | null> {
  if (!error || typeof error !== 'object' || !('context' in error)) return null
  const context = (error as { context?: unknown }).context
  if (!(context instanceof Response)) return null
  try {
    const body: unknown = await context.clone().json()
    if (body && typeof body === 'object' && typeof (body as { code?: unknown }).code === 'string') {
      return (body as { code: string }).code
    }
  } catch {
    // Corps non-JSON, ou déjà lu : aucun code.
  }
  return null
}
