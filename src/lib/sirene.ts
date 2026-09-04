export interface InfosNaf {
  codeNaf: string
  libelleNaf: string | null
}

// Recherche du code NAF/APE (et son libellé quand l'API le fournit) à partir d'un SIRET, via l'API
// publique "Recherche d'entreprises" (api.gouv.fr, basée sur la base SIRENE de l'INSEE) — gratuite,
// sans clé, appelable directement depuis le navigateur. Best-effort à dessein : un réseau indisponible,
// un SIRET invalide/introuvable ou une réponse inattendue ne renvoient jamais d'erreur bloquante, juste
// `null` — ça ne doit jamais empêcher la création ou la consultation d'un dossier. Le libellé n'est
// affiché que si l'API le renvoie réellement (plusieurs noms de champ possibles selon la version de
// l'API, jamais deviné) ; à défaut, seul le code brut est montré, à charge du cabinet de vérifier ce
// qu'il recouvre — un même code NAF (86.90D notamment) regroupe souvent plusieurs professions
// paramédicales différentes, ce n'est pas une identification fiable à 100 %.
export async function rechercherCodeNaf(siret: string): Promise<InfosNaf | null> {
  const siretPropre = siret.replace(/\D/g, '')
  if (siretPropre.length !== 14) return null
  try {
    const res = await fetch(`https://recherche-entreprises.api.gouv.fr/search?q=${siretPropre}&per_page=1`)
    if (!res.ok) return null
    const data = await res.json()
    const resultat = data.results?.[0]
    if (!resultat) return null
    const codeNaf: string | undefined = resultat.activite_principale ?? resultat.siege?.activite_principale
    if (!codeNaf) return null
    const libelleNaf: string | null =
      resultat.libelle_activite_principale
      ?? resultat.activite_principale_libelle
      ?? resultat.siege?.libelle_activite_principale
      ?? null
    return { codeNaf, libelleNaf }
  } catch {
    return null
  }
}
