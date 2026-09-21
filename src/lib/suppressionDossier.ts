import { supabase } from './supabase'
import { messageErreur } from './messageErreur'

// Retire tous les fichiers de stockage d'un dossier (pièces + packs) avant de supprimer sa ligne —
// la suppression de `dossiers` fait cascader toutes les autres tables (voir migration
// informations_dossier_cascade_suppression, la seule qui manquait), mais Storage n'est pas lié par une
// contrainte de base : sans ce nettoyage explicite, les fichiers resteraient orphelins indéfiniment.
//
// NON BLOQUANT, ET CE N'EST PAS LA MÊME CHOSE QUE MUET. Un échec ici n'empêche pas la suppression du
// dossier — un dossier supprimé sans ses pièces vaut mieux qu'un dossier qui refuse de se supprimer à
// cause d'un fichier récalcitrant. Mais ce qui n'a pas pu être retiré est RENDU, et l'écran le dit :
// jusqu'au 21/09/2026 ni `list()` ni `remove()` ne voyaient leur `{ error }` lu, et un `catch {}`
// avalait le reste. Rien ne recharge le stockage — aucun écran ne le relit jamais — donc l'échec
// n'avait strictement aucun témoin, sur l'action la plus irréversible de l'application.
//
// CE QUE ÇA COÛTE, ET POURQUOI ÇA COMPTE PLUS ICI QU'AILLEURS : les données de patients sont dans les
// FICHIERS, pas dans les tables (RGPD.md §4). « Supprimer un dossier » est le geste auquel se ramène
// une demande d'effacement ; s'il laisse les fichiers en place sans le dire, le cabinet croit avoir
// effacé ce qui est toujours là. Et la ligne `dossiers` venant d'être supprimée, plus aucun écran ne
// peut les retrouver ensuite.
//
// `list()` du client Storage plafonne à 100 entrées par défaut, sans le dire : au-delà, le reste
// serait resté en place indéfiniment. On pagine donc explicitement jusqu'à épuisement.
const TAILLE_PAGE = 100

export interface NettoyageStockage {
  /** Fichiers qu'on a su recenser et tenté de retirer. */
  demandes: number
  /** Fichiers que le stockage confirme avoir retirés. */
  retires: number
  /** Ce que le stockage a refusé de retirer, avec la raison — jamais un simple compte. */
  echecs: { chemin: string; raison: string }[]
  /**
   * L'inventaire lui-même est douteux : une lecture refusée, une exception. **On ne peut pas
   * recenser ce qu'on n'a pas lu** — même arbitrage que le pack, qui REFUSE plutôt que d'annoncer un
   * total bâti sur une lecture partielle. Ici on ne peut pas refuser (le dossier part quand même),
   * alors on dit qu'on ne sait pas.
   */
  inventaireIncomplet: boolean
}

function vide(): NettoyageStockage {
  return { demandes: 0, retires: 0, echecs: [], inventaireIncomplet: false }
}

function fusionner(a: NettoyageStockage, b: NettoyageStockage): NettoyageStockage {
  return {
    demandes: a.demandes + b.demandes,
    retires: a.retires + b.retires,
    echecs: [...a.echecs, ...b.echecs],
    inventaireIncomplet: a.inventaireIncomplet || b.inventaireIncomplet,
  }
}

/**
 * Liste un chemin en entier, et DIT si elle n'a pas pu.
 *
 * Une lecture refusée rend `data: null`, indiscernable d'un dossier vide : c'est la famille « une
 * lecture dont l'échec ressemble à un résultat vide ». Confondre les deux ferait retirer ZÉRO fichier
 * en annonçant que tout est propre.
 */
async function listerTout(
  bucket: 'pieces' | 'packs',
  chemin: string,
): Promise<{ entrees: { name: string; id: string | null }[]; complete: boolean }> {
  const tout: { name: string; id: string | null }[] = []
  for (let offset = 0; ; offset += TAILLE_PAGE) {
    const { data, error } = await supabase.storage.from(bucket).list(chemin, { limit: TAILLE_PAGE, offset })
    if (error) return { entrees: tout, complete: false }
    if (!data || data.length === 0) return { entrees: tout, complete: true }
    tout.push(...data)
    if (data.length < TAILLE_PAGE) return { entrees: tout, complete: true }
  }
}

async function viderDossierDuStockage(bucket: 'pieces' | 'packs', dossierId: string): Promise<NettoyageStockage> {
  const resultat = vide()
  try {
    const { entrees, complete } = await listerTout(bucket, dossierId)
    if (!complete) resultat.inventaireIncomplet = true
    if (entrees.length === 0) return resultat

    const chemins: string[] = []
    for (const entree of entrees) {
      // Un id null signale un sous-dossier (convention Supabase Storage) — un pack range son
      // ZIP/Excel sous `dossierId/période-timestamp/`, jamais directement sous `dossierId/` (voir
      // packGenerator.ts) ; une pièce, elle, est toujours un fichier direct.
      if (entree.id === null) {
        const sous = await listerTout(bucket, `${dossierId}/${entree.name}`)
        if (!sous.complete) resultat.inventaireIncomplet = true
        for (const sousEntree of sous.entrees) chemins.push(`${dossierId}/${entree.name}/${sousEntree.name}`)
      } else {
        chemins.push(`${dossierId}/${entree.name}`)
      }
    }
    resultat.demandes = chemins.length

    // Suppression par lots, pour la même raison que la lecture : une liste trop longue passée d'un
    // coup peut être refusée côté serveur. Un lot qui échoue ne fait pas abandonner les suivants —
    // retirer les neuf dixièmes vaut mieux que rien, à condition de nommer le dixième restant.
    for (let i = 0; i < chemins.length; i += TAILLE_PAGE) {
      const lot = chemins.slice(i, i + TAILLE_PAGE)
      const { data, error } = await supabase.storage.from(bucket).remove(lot)
      if (error) {
        const raison = messageErreur(error, 'retrait refusé par le stockage')
        for (const chemin of lot) resultat.echecs.push({ chemin, raison })
        continue
      }
      resultat.retires += data?.length ?? 0
    }
  } catch (err) {
    // Une exception (réseau coupé, etc.) laisse forcément l'inventaire dans le flou : on ne sait plus
    // ce qui a été retiré ni ce qui reste. Elle ne fait pas échouer la suppression du dossier, mais
    // elle ne se tait pas non plus.
    resultat.inventaireIncomplet = true
    resultat.echecs.push({ chemin: `${bucket}/${dossierId}`, raison: messageErreur(err, 'nettoyage interrompu') })
  }
  return resultat
}

/**
 * Supprime définitivement un dossier et tout ce qui lui est rattaché — pièces, écritures,
 * immobilisations, accès clients, factures, etc. (cascade en base) — plus ses fichiers de stockage.
 *
 * Irréversible : voir ConfirmationSuppression, qui impose de taper le nom du dossier avant d'appeler
 * cette fonction. La ligne `dossiers` elle-même reste protégée par RLS (dossiers_delete =
 * est_chef_du_cabinet) : un appelant qui n'est pas chef du cabinet propriétaire reçoit une erreur ici,
 * jamais une suppression partielle.
 *
 * REND le bilan du nettoyage de stockage. L'appelant doit le montrer quand il n'est pas propre — voir
 * `nettoyageAMontrer`.
 */
export async function supprimerDossierDefinitivement(dossierId: string): Promise<NettoyageStockage> {
  const [pieces, packs] = await Promise.all([
    viderDossierDuStockage('pieces', dossierId),
    viderDossierDuStockage('packs', dossierId),
  ])
  const { error } = await supabase.from('dossiers').delete().eq('id', dossierId)
  if (error) throw error
  return fusionner(pieces, packs)
}

/**
 * Le bilan mérite-t-il d'être montré ?
 *
 * Fonction pure, à part de l'écran, pour la même raison que `detailPiecesSansDate` : un avertissement
 * permanent cesse d'être lu et emporte ses voisins dans son discrédit. Celui-ci ne paraît que quand
 * il apprend quelque chose — un fichier resté en place, ou un inventaire dont on ne sait rien.
 */
export function nettoyageAMontrer(bilan: NettoyageStockage): boolean {
  return bilan.inventaireIncomplet || bilan.echecs.length > 0 || bilan.retires < bilan.demandes
}

/**
 * Ce qu'on dit au cabinet, en clair. Rendu vide quand il n'y a rien à dire.
 *
 * Nomme la CONSÉQUENCE et pas seulement le fait : « des fichiers sont restés » ne dit pas qu'ils ne
 * sont plus rattachés à rien, ni que c'est le geste d'effacement qui vient d'être incomplet.
 */
export function messageNettoyage(bilan: NettoyageStockage): string {
  if (!nettoyageAMontrer(bilan)) return ''
  const restes = bilan.demandes - bilan.retires
  // L'accord suit le compte, et quand on ne SAIT PAS il reste au générique : « 1 fichier … ces
  // fichiers » se lit comme une phrase mal relue, et on n'écoute pas longtemps un avertissement mal
  // relu.
  const pluriel = bilan.inventaireIncomplet || restes > 1
  const debut = bilan.inventaireIncomplet
    ? "Le dossier est supprimé, mais le stockage n'a pas pu être inventorié en entier : on ne sait pas combien de fichiers y restent"
    : `Le dossier est supprimé, mais ${restes} fichier${restes > 1 ? 's' : ''} n'${restes > 1 ? 'ont' : 'a'} pas pu être retiré${restes > 1 ? 's' : ''} du stockage`
  const raisons = [...new Set(bilan.echecs.map((e) => e.raison))].slice(0, 3)
  const detail = raisons.length > 0 ? ` (${raisons.join(' ; ')})` : ''
  const suite = pluriel
    ? "Ces fichiers ne sont plus rattachés à aucun dossier et aucun écran ne peut les montrer"
    : "Ce fichier n'est plus rattaché à aucun dossier et aucun écran ne peut le montrer"
  return `${debut}${detail}. ${suite} — préviens l'administrateur pour qu'il ${pluriel ? 'les retire' : 'le retire'} à la main.`
}
