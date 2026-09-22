// Les DEUX seules globales Deno que ce dépôt utilise (mesuré : 52 `Deno.env`, 13 `Deno.serve`).
// Déclarées à la main plutôt que tirées des types Deno complets : la surface est minuscule, et une
// dépendance de plus pour type-vérifier serait payée par tout le monde à chaque `npm ci`.
declare namespace Deno {
  const env: { get(cle: string): string | undefined; set(cle: string, valeur: string): void }
  function serve(gestionnaire: (requete: Request) => Response | Promise<Response>): unknown
}
