// La clé que l'application sert au navigateur, vérifiée avant qu'elle serve.
//
// Depuis le 30/09/2026 c'est la clé PUBLISHABLE du projet (`sb_publishable_…`) : la clé historique
// `anon`, un jeton signé, cesse de fonctionner à la fin de 2026 (ligne 25.5 de la feuille de route).
// Ce contrôle refuse de démarrer sur autre chose, et le dit — plutôt qu'une application qui marche
// jusqu'au jour de la coupure, puis plus du tout, sans qu'aucun écran ne dise pourquoi.
//
// Une clé SECRÈTE est refusée à part : servie au navigateur, elle donnerait à n'importe quel visiteur
// un accès à toute la base, la RLS contournée. Le build l'aurait déjà écrite dans l'application, donc
// ce refus arrive tard ; ce qui l'empêche d'entrer est `clesSupabase.test.ts`, qui refuse toute clé
// secrète dans un fichier du dépôt. Ici, c'est la seconde ceinture. Aucun message ne cite la clé.

export function verifierClePublique(cle: string | undefined): string {
  if (!cle) throw new Error('VITE_SUPABASE_PUBLISHABLE_KEY doit être définie (voir .env.example).')
  if (cle.startsWith('sb_secret_')) {
    throw new Error(
      'VITE_SUPABASE_PUBLISHABLE_KEY porte une clé SECRÈTE, qui ne doit jamais être servie au navigateur : '
      + 'mettre la clé publishable du projet (sb_publishable_…).',
    )
  }
  if (!cle.startsWith('sb_publishable_') || cle.length === 'sb_publishable_'.length) {
    throw new Error(
      "VITE_SUPABASE_PUBLISHABLE_KEY n'est pas une clé publishable (sb_publishable_…). La clé historique "
      + '« anon » cesse de fonctionner à la fin de 2026 : prendre la clé publishable du projet, '
      + 'dans Settings → API Keys.',
    )
  }
  return cle
}
