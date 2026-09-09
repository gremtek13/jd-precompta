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
