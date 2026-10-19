import { readFileSync } from 'node:fs'

// L'ESSAI DE LA VENTE FACTURÉE (supabase/essais/ventesFacturees.sql, chantier EC-Q3, étape VF2), LU : ses étapes, leurs
// macros remplacées — ce que la base y est tenue de répondre, code et mots, que les tests des modules
// (sourceDeLaVente.test.ts, encaissementsVenteFacturee.test.ts) confrontent à leurs listes de refus et au texte des
// fonctions.

export const TEXTE_ESSAI_VENTES_FACTUREES = readFileSync(new URL('../../supabase/essais/ventesFacturees.sql', import.meta.url), 'utf8')

/** Une étape de l'essai : {genre, contrôle, profil, requête, code attendu, message attendu (exact, ou motif LIKE) ou valeur}. */
export interface EtapeDeLEssai {
  genre: string
  controle: string
  profil: string
  requete: string
  code: string
  attendu: string
}

const chaineSql = (s: string) => s.replace(/''/g, "'")

export function etapesDeLEssai(texte: string = TEXTE_ESSAI_VENTES_FACTUREES): EtapeDeLEssai[] {
  const macros = new Map([...texte.matchAll(/'(\w+)', \$m\$([\s\S]*?)\$m\$/g)].map((m) => [m[1], m[2]]))
  const remplir = (s: string) => s.replace(/\{(\w+)\}/g, (tout, cle: string) => macros.get(cle) ?? tout)
  return [...texte.matchAll(/array\['(\w+)', '((?:[^']|'')*)', '(\w+)', \$q\$([\s\S]*?)\$q\$, '((?:[^']|'')*)',\s*'((?:[^']|'')*)'\]/g)]
    .map((m) => ({
      genre: m[1], controle: chaineSql(m[2]), profil: m[3], requete: remplir(m[4]), code: m[5], attendu: remplir(chaineSql(m[6])),
    }))
}

/** Les étapes qui exigent un refus de la base : un code SQLSTATE et ses mots. */
export function refusExigesParLEssai(texte: string = TEXTE_ESSAI_VENTES_FACTUREES): EtapeDeLEssai[] {
  return etapesDeLEssai(texte).filter((e) => e.code !== '' && e.code !== 'OK')
}

/**
 * Un message attendu par l'essai correspond-il à un modèle de refus (« % » : une valeur, « %% » : le signe) ? Exact,
 * chaque « % » du modèle valant une valeur ; un motif LIKE de l'essai, fini par « % », en est le début.
 */
export function correspondAuModele(modele: string, attendu: string): boolean {
  if (attendu.endsWith('%') && !attendu.slice(0, -1).includes('%')) return modele.startsWith(attendu.slice(0, -1))
  const echappe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const motif = modele.split('%%').map((morceau) => morceau.split('%').map(echappe).join('.+')).join('%')
  return new RegExp(`^${motif}$`).test(attendu)
}
