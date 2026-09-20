// Lire une collection ENTIÈRE, et savoir si on y est arrivé.
//
// Le client Supabase passe par PostgREST, qui plafonne le nombre de lignes rendues par requête
// (réglage « Max rows » du projet, 1 000 par défaut). Ce plafond ne se signale PAS : la réponse est
// une liste valide, simplement plus courte que la réalité. Un écran qui lit
// `.select('*').eq('dossier_id', …)` affiche donc un sous-ensemble sans le savoir — et ce qu'on en
// calcule derrière (une balance, un FEC, une piste d'audit) est faux sans qu'aucune alerte ne
// paraisse. C'est la version « transport » du piège que ce projet connaît déjà côté stockage, où
// `list()` plafonne à 100 entrées en silence.
//
// **Mesuré le 20/09/2026** : `lignes_bancaires` porte 954 lignes pour le cabinet, dont 385 sur le
// dossier vivant. Personne n'a encore franchi le plafond ; le prochain relevé importé peut le faire.
// C'est exactement la situation que décrit la règle du projet : un mécanisme dont la justesse dépend
// de la petitesse des données tombera le jour où elles grandissent.
//
// Trois décisions :
//
// 1. **On avance de ce qui a été RENDU, pas de la taille demandée.** Si le plafond du serveur est
//    plus petit que la tranche demandée, une tranche « courte » n'est pas la fin de la table — s'en
//    servir comme condition d'arrêt perdrait tout le reste. C'est la limite de la pagination du
//    socle de sauvegarde, qui s'arrête sur une tranche courte et se rattrape en REFUSANT (elle peut
//    se le permettre : une sauvegarde incomplète ne vaut rien). Un écran, lui, doit continuer.
//
// 2. **Le compte annoncé fait foi** (`count: 'exact'`, qui ne rapatrie aucune ligne). Il dit quand
//    s'arrêter, et surtout il dit si on a tout eu. Sans lui, « rien de plus à lire » et « le serveur
//    ne veut plus rien rendre » sont indiscernables.
//
// 3. **L'appelant reçoit `complete`, jamais une liste muette.** Un livrable fiscal (FEC, piste
//    d'audit) se refuse sur une lecture incomplète — le format est rigide, il ne peut pas porter
//    l'avertissement — et un écran de consultation l'affiche. C'est à l'appelant de trancher, mais
//    il ne peut plus l'ignorer par omission.
export interface TrancheLue<T> {
  data: T[] | null
  error: { message: string } | null
  count: number | null
}

export interface LectureComplete<T> {
  lignes: T[]
  complete: boolean
  // Ce qui a manqué, en clair, quand `complete` est faux. Null sinon.
  motif: string | null
}

export const TAILLE_TRANCHE = 500

export async function lireTout<T>(
  tranche: (debut: number, fin: number) => PromiseLike<TrancheLue<T>>,
  taille: number = TAILLE_TRANCHE,
): Promise<LectureComplete<T>> {
  const lignes: T[] = []
  let annonce: number | null = null

  for (;;) {
    const { data, error, count } = await tranche(lignes.length, lignes.length + taille - 1)
    if (error) {
      return {
        lignes,
        complete: false,
        motif: `lecture interrompue après ${lignes.length} ligne(s) : ${error.message}`,
      }
    }
    if (count != null) annonce = count
    const lot = data ?? []
    lignes.push(...lot)

    // Une tranche vide est le seul arrêt sûr quand le serveur ne rend plus rien : sans elle, un
    // compte annoncé trop grand ferait tourner la boucle indéfiniment.
    if (lot.length === 0) break
    if (annonce != null && lignes.length >= annonce) break
    // Sans compte annoncé, une tranche plus courte que demandée est le seul indice de fin — il est
    // faible (un plafond serveur plus bas la produirait aussi), d'où le `complete` ci-dessous qui ne
    // s'engage que sur un compte réellement annoncé.
    if (annonce == null && lot.length < taille) break
  }

  if (annonce == null) {
    return { lignes, complete: false, motif: `la base n'a pas annoncé de total : ${lignes.length} ligne(s) lue(s), sans garantie que ce soit tout` }
  }
  if (lignes.length !== annonce) {
    return {
      lignes,
      complete: false,
      motif: `${lignes.length} ligne(s) lue(s) sur ${annonce} annoncée(s)`,
    }
  }
  return { lignes, complete: true, motif: null }
}
