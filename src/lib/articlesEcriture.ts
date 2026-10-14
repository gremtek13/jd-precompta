import { supabase } from './supabase'
import type { SaisieEnvoyee } from './articlesVue'
import type { Article } from './types'

// LES TROIS GESTES D'UN ARTICLE, PAR LA BASE SEULE (espace client, étape A2a). Aucune policy n'écrit `articles` : seules
// `enregistrer_article`, `retirer_article` et `reprendre_article` le font, chacune avec son accès (`gere_les_ventes`, le
// cabinet ou le client « Ventes ») vérifié avant toute lecture. Chacune rend la LIGNE qu'elle a écrite : ce que la base a
// gardé, que l'écran relit de toute façon — on vérifie ici qu'elle a bien rendu l'article visé, comme `supprimerBrouillon`.
// Un refus se lève sous les mots de la base (le message de l'erreur, que `messageErreur` rend tel quel).

/** Ce que la base a gardé : l'article visé (celui qui vient d'être créé, pour une création) — sinon on le dit. */
function ecrit(data: unknown, attendu: { id: string | null; retire: boolean | null }): Article {
  const ligne = data as Partial<Article> | null
  if (ligne == null || typeof ligne !== 'object' || typeof ligne.id !== 'string'
    || (attendu.id != null && ligne.id !== attendu.id)
    || (attendu.retire != null && (ligne.retire_le != null) !== attendu.retire)) {
    throw new Error('La base n’a pas rendu l’article écrit : relis la liste avant de recommencer.')
  }
  return ligne as Article
}

/** Crée l'article (`articleId` nul) ou le modifie, tous ses champs. Rend la ligne écrite ; lève le refus de la base. */
export async function enregistrerArticle(dossierId: string, articleId: string | null, saisie: SaisieEnvoyee): Promise<Article> {
  const { data, error } = await supabase.rpc('enregistrer_article', {
    p_dossier_id: dossierId, p_article_id: articleId, p_article: saisie,
  })
  if (error) throw new Error(error.message)
  return ecrit(data, { id: articleId, retire: false })
}

/** Retire l'article : il sort des choix et garde sa référence. */
export async function retirerArticle(dossierId: string, articleId: string): Promise<Article> {
  const { data, error } = await supabase.rpc('retirer_article', { p_dossier_id: dossierId, p_article_id: articleId })
  if (error) throw new Error(error.message)
  return ecrit(data, { id: articleId, retire: true })
}

/** Reprend un article retiré : il revient dans les choix ; la reprise est sa dernière modification. */
export async function reprendreArticle(dossierId: string, articleId: string): Promise<Article> {
  const { data, error } = await supabase.rpc('reprendre_article', { p_dossier_id: dossierId, p_article_id: articleId })
  if (error) throw new Error(error.message)
  return ecrit(data, { id: articleId, retire: false })
}
