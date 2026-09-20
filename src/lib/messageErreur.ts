// Le pendant Postgrest de `invokeErreur.ts`, et il répare le même genre de panne : un vrai message
// d'erreur remplacé par un repli plausible, sur tout un pan de l'application, sans que rien ne le
// signale.
//
// LE FAIT QUI DÉCIDE, et qu'aucune relecture ne donne — il est dans la source de
// @supabase/postgrest-js, pas dans la documentation : sur le chemin NON levant (celui qu'utilise
// toute cette application, `const { error } = await supabase…`), la bibliothèque fait
// `error = JSON.parse(body)`. Ce qu'on reçoit est donc un OBJET NU `{ message, details, hint, code }`,
// jamais une instance d'`Error`. La classe `PostgrestError extends Error` existe bien, mais elle
// n'est construite que sur les branches `shouldThrowOnError`, que ce dépôt n'active nulle part.
//
// Conséquence, et c'est le défaut : le réflexe `catch (err) { err instanceof Error ? err.message :
// repli }` est FAUX dès que l'erreur vient de la base. Le test échoue, le repli s'affiche, et la
// raison — « new row violates row-level security policy », « duplicate key value violates unique
// constraint », « violates foreign key constraint » — est jetée. L'opérateur lit « Une erreur est
// survenue. » et n'a aucun moyen de savoir s'il doit rappeler l'administrateur, corriger une
// saisie, ou simplement réessayer. Quarante-six sites le faisaient.
//
// Trois choix dans l'implémentation :
//
//   - **Une seule branche pour les deux formes.** `message` est une propriété PROPRE d'une instance
//     d'`Error` comme d'un objet nu : les distinguer par `instanceof` est précisément l'erreur
//     qu'on corrige. On regarde ce que la valeur PORTE, pas ce dont elle hérite.
//   - **Le type est vérifié.** `{ message: 42 }` retombe sur le repli plutôt que d'afficher « 42 » :
//     une valeur d'un autre type ne vient pas de Postgres, et l'afficher serait pire que le repli.
//   - **`details` et `hint` ne sont PAS repris.** Ils sont souvent plus précis (« Key (a,b)=(1,2)
//     already exists »), et souvent longs et internes. Le titre suffit à décider quoi faire ;
//     l'appelant qui voudra le détail le lira dans la console. Une décision à rouvrir si un message
//     de contrainte se révèle indéchiffrable sans lui, pas avant.
export function messageErreur(erreur: unknown, repli = 'Une erreur est survenue.'): string {
  // Un `throw 'texte'` est rare mais légal, et son texte vaut mieux que n'importe quel repli.
  if (typeof erreur === 'string') return erreur.trim() ? erreur : repli
  if (erreur && typeof erreur === 'object') {
    const message = (erreur as { message?: unknown }).message
    // Un message vide n'apprend rien et laisse l'écran sans explication : le repli, lui, en donne
    // au moins une. Même garde que dans `extraireErreurFonction`.
    if (typeof message === 'string' && message.trim()) return message
  }
  return repli
}
