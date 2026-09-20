import { supabase } from './supabase'
import type { ControleSolde } from './soldeReleve'
import type { ControleReleveBancaire } from './types'
import { lireTout } from './lectureComplete'

// Conservation du contrôle de cohérence d'un relevé bancaire.
//
// Le contrôle (solde d'ouverture + mouvements = solde de clôture) existait déjà, mais son résultat
// vivait dans un `window.alert()` affiché à l'import : l'opérateur cliquait « OK » et l'information
// était détruite. Un relevé incomplet redevenait invisible dans la seconde — alors que c'est
// précisément ce qu'un cabinet doit savoir AVANT de bâtir une comptabilité dessus, et qu'il ne le
// saura plus jamais ensuite. Sur le dossier de test, un écart de 5 359,00 € était ainsi passé à la
// trappe : rien dans l'application ne disait que le relevé de 2025 ne bouclait pas.
//
// Le module parle à la base, donc il vit à part du calcul pur (`soldeReleve.ts`), qui reste
// testable sans client Supabase — même découpage que `comptes.ts` / `contrepartieBanque.ts`.

// Enregistre le résultat d'un contrôle. Best-effort et JAMAIS bloquant : un import réussi ne doit
// pas être annulé parce que son garde-fou n'a pas pu être écrit. L'échec est journalisé, jamais
// avalé en silence — c'est la règle du projet sur les écritures best-effort.
//
// `upsert` sur (dossier_id, source_fichier) : réimporter le même relevé remplace son contrôle au
// lieu d'en empiler un second. Un relevé sans nom de fichier s'ajoute librement, parce que deux NULL
// ne sont jamais égaux en SQL — la contrainte unique ne les rapproche donc jamais.
//
// **La contrainte est TOTALE, pas partielle, et ce n'est pas un détail.** Un index unique partiel ne
// peut pas être visé par `ON CONFLICT (dossier_id, source_fichier)` : Postgres exige alors de
// répéter sa clause WHERE, ce que le client Supabase ne sait pas produire. La première version de
// cette table portait un index partiel ; l'upsert aurait échoué à chaque import, en silence, exactement
// comme la règle tiers → catégorie de ce projet qui n'a rien écrit pendant des mois pour cette raison.
export async function enregistrerControleReleve(
  dossierId: string,
  sourceFichier: string | null,
  controle: ControleSolde,
): Promise<void> {
  const ligne = {
    dossier_id: dossierId,
    source_fichier: sourceFichier,
    solde_initial: controle.soldeInitial,
    solde_final: controle.soldeFinal,
    somme_mouvements: controle.sommeMouvements,
    ecart: controle.ecart,
    coherent: controle.coherent,
    periode_debut: controle.dateInitiale,
    periode_fin: controle.dateFinale,
  }

  const { error } = await supabase
    .from('controles_releves_bancaires')
    .upsert(ligne, { onConflict: 'dossier_id,source_fichier' })

  if (error) console.error('Enregistrement du contrôle de solde échoué:', error)
}

// Les relevés d'un dossier qui NE BOUCLENT PAS, du plus récent au plus ancien.
//
// Seuls les incohérents : un relevé qui boucle n'a rien à dire et encombrerait l'écran. La lecture
// lève plutôt que de rendre une liste vide en cas d'erreur — un `data` nul est indiscernable d'un
// « aucun écart », et c'est exactement ce genre de confusion qui a déjà fait passer une lecture
// refusée pour un résultat rassurant ailleurs dans ce projet.
export async function chargerRelevesIncoherents(dossierId: string): Promise<ControleReleveBancaire[]> {
  // Un relevé importé = une ligne, et un dossier en accumule autant qu'il a de mois d'historique.
  // Tri TOTAL (`id` en départage) : `periode_fin` n'est pas unique et peut être nulle.
  const lecture = await lireTout<ControleReleveBancaire>((debut, fin) =>
    supabase.from('controles_releves_bancaires').select('*', { count: 'exact' })
      .eq('dossier_id', dossierId).eq('coherent', false)
      .order('periode_fin', { ascending: false, nullsFirst: false }).order('id').range(debut, fin),
  )
  // Une lecture partielle se traite comme un refus : ce contrôle dit ce qui NE BOUCLE PAS, et un
  // relevé amputé qu'on ne voit pas est exactement le silence qu'il est fait pour rompre.
  if (!lecture.complete) throw new Error(`Lecture des contrôles de relevé incomplète : ${lecture.motif}`)
  return lecture.lignes
}
