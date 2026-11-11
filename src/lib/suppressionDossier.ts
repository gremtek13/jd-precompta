import { supabase } from './supabase'
import { messageErreur } from './messageErreur'
import { LOGO_DES_FACTURES_EXPORTE } from './logoDesFactures'
import { refusDeLaSuppression } from './dossierDuCabinet'
import { estDesigneCommeDossierDuCabinet } from './dossierDuCabinetLecture'

// Retire tous les fichiers de stockage d'un dossier (pièces + packs, et le logo de ses factures dans le seau `ventes` dès
// que sa migration est en base, étape A5c1, comme l'original d'une facture reprise, sous `imports/<lot>/`, A8d2c) avant
// de supprimer sa ligne —
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
// Les seaux qu'un dossier occupe sous `<dossier>/`. Le seau `ventes` (le logo des factures, `<dossier>/logos/…`) n'en est
// que sa migration en base (`LOGO_DES_FACTURES_EXPORTE`) : avant, le lister rendrait une erreur — un seau absent —, et
// chaque suppression dirait un inventaire incomplet. Seul le chef du cabinet du dossier y supprime un fichier — celui qui
// seul supprime un dossier (`dossiers_delete`) : c'est ce geste-ci qui le vide.
type SeauDuDossier = 'pieces' | 'packs' | 'ventes'

async function listerTout(
  bucket: SeauDuDossier,
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

// Retire des chemins par lots et rend ceux que le stockage n'a PAS confirmés retirés — refusés avec une erreur, ou acceptés
// sans être rendus (une policy écarte une ligne sans rien lever) —, ainsi que les échecs nommés. Lu par les deux passages.
async function retirerParLots(
  bucket: SeauDuDossier,
  chemins: string[],
): Promise<{ retires: number; restants: string[]; echecs: { chemin: string; raison: string }[] }> {
  let retires = 0
  const restants: string[] = []
  const echecs: { chemin: string; raison: string }[] = []
  // Suppression par lots, pour la même raison que la lecture : une liste trop longue passée d'un
  // coup peut être refusée côté serveur. Un lot qui échoue ne fait pas abandonner les suivants —
  // retirer les neuf dixièmes vaut mieux que rien, à condition de nommer le dixième restant.
  for (let i = 0; i < chemins.length; i += TAILLE_PAGE) {
    const lot = chemins.slice(i, i + TAILLE_PAGE)
    const { data, error } = await supabase.storage.from(bucket).remove(lot)
    if (error) {
      const raison = messageErreur(error, 'retrait refusé par le stockage')
      for (const chemin of lot) echecs.push({ chemin, raison })
      restants.push(...lot)
      continue
    }
    // Le stockage rend les objets qu'il a retirés, sous leur nom complet : ce qu'il ne rend pas est resté.
    const rendus = new Set((data ?? []).map((objet) => objet.name))
    retires += lot.filter((chemin) => rendus.has(chemin)).length
    restants.push(...lot.filter((chemin) => !rendus.has(chemin)))
  }
  return { retires, restants, echecs }
}

// Un chemin compte au plus `PROFONDEUR_MAX` segments sous `<dossier>/`, le fichier compris : une pièce en a un, un pack
// deux (`<période>/<fichier>`), un logo deux (`logos/<fichier>`), l'original d'une facture reprise trois
// (`imports/<lot>/<fichier>`, A8d2a). Elle suit tout sous-dossier que le stockage
// rend, jusqu'au fichier, quel que soit le seau et quel que soit le drapeau d'une migration : jusqu'au 11/11/2026 elle ne
// descendait que d'un niveau, et `imports/<lot>/<fichier>` serait resté en place, le lot compté pour un fichier (A8d2c).
// Plus bas que cette borne, rien de ce que l'application range : un sous-dossier plus profond ne se suit pas, il se DIT
// (inventaire incomplet), comme une lecture refusée.
export const PROFONDEUR_MAX = 6

// Les fichiers sous `chemin`, en profondeur et dans l'ordre que le stockage rend. Un id null signale un sous-dossier
// (convention Supabase Storage) — un pack range son ZIP/Excel sous `dossierId/période-timestamp/` (packGenerator.ts), un
// logo de facture sous `dossierId/logos/` (logoDesFactures.ts), l'original d'une facture reprise sous
// `dossierId/imports/<lot>/` (bornesStockage.ts, `cheminDUnOriginal`) ; une pièce, elle, est un fichier direct.
async function recenser(
  bucket: SeauDuDossier,
  chemin: string,
  profondeur: number,
  resultat: NettoyageStockage,
): Promise<string[]> {
  const { entrees, complete } = await listerTout(bucket, chemin)
  if (!complete) resultat.inventaireIncomplet = true
  const chemins: string[] = []
  for (const entree of entrees) {
    const complet = `${chemin}/${entree.name}`
    if (entree.id !== null) {
      chemins.push(complet)
    } else if (profondeur + 1 >= PROFONDEUR_MAX) {
      resultat.inventaireIncomplet = true
    } else {
      chemins.push(...(await recenser(bucket, complet, profondeur + 1, resultat)))
    }
  }
  return chemins
}

// Le premier passage, avant la ligne du dossier : il rend aussi ce qui est resté, que le second passage reprend.
async function viderDossierDuStockage(
  bucket: SeauDuDossier,
  dossierId: string,
): Promise<NettoyageStockage & { restants: string[] }> {
  const resultat = { ...vide(), restants: [] as string[] }
  try {
    const chemins = await recenser(bucket, dossierId, 0, resultat)
    if (chemins.length === 0) return resultat
    resultat.demandes = chemins.length

    const { retires, restants, echecs } = await retirerParLots(bucket, chemins)
    resultat.retires = retires
    resultat.restants = restants
    resultat.echecs.push(...echecs)
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
 *
 * LE DOSSIER DU CABINET (ligne 47, LM2) ne se supprime que par le super-administrateur (la garde de la migration
 * `dossier_du_cabinet`, LM1-Q1). La base ne refuse que la LIGNE, et le stockage se vide AVANT elle : sans ce contrôle, un chef
 * qui le supprimerait perdrait les fichiers de ses pièces, puis se verrait refuser la ligne. La désignation se lit donc
 * D'ABORD, et un refus — ou une lecture qui échoue — lève avant tout retrait. `qui` est obligatoire : un appelant qui
 * l'oublierait ne compile pas.
 */
export async function supprimerDossierDefinitivement(
  dossierId: string, qui: { superAdministrateur: boolean },
): Promise<NettoyageStockage> {
  const refus = refusDeLaSuppression({
    estLeDossierDuCabinet: await estDesigneCommeDossierDuCabinet(dossierId), superAdministrateur: qui.superAdministrateur,
  })
  if (refus !== null) throw new Error(refus)
  const seaux: SeauDuDossier[] = LOGO_DES_FACTURES_EXPORTE ? ['pieces', 'packs', 'ventes'] : ['pieces', 'packs']
  const premiers = await Promise.all(seaux.map((seau) => viderDossierDuStockage(seau, dossierId)))
  const { error } = await supabase.from('dossiers').delete().eq('id', dossierId)
  if (error) throw error
  // LE SECOND PASSAGE (ligne 44, INAL1 : la migration `piece_figee_dans_le_stockage`). Le stockage garde le fichier d'une
  // pièce figée — une écriture validée la cite, ou son bien — et d'une source que la révision cite, tant que sa ligne
  // existe : le premier passage les laisse, sans erreur. La ligne du dossier partie, ses pièces sont parties avec elle, et
  // plus rien ne fige ces fichiers : on les reprend, et seulement eux. Le premier passage reste AVANT la ligne : la lecture
  // et la suppression d'un fichier passent par `admin_du_dossier`, qui lit la ligne du dossier — sans elle, le chef du
  // cabinet ne voit plus rien du dossier ; seul le super-administrateur les atteint encore. Pour un chef qui ne l'est pas,
  // ce second passage ne retire rien, et le bilan compte ce qui reste (question INAL12-Q1). Un fichier qu'une pièce figée
  // d'un AUTRE dossier désigne reste, lui, gardé.
  // LES ORIGINAUX DES FACTURES REPRISES (ligne 51.5, A8D2A-Q1 : la migration `originaux_retenus_par_leur_import`, préparée).
  // Le seau `ventes` retient l'original d'un import qui existe : le premier passage le laisse, sans erreur. Mais là, le
  // second passage n'attend pas le super-administrateur : la ligne du dossier partie, la base a rendu ses originaux au
  // cabinet du dossier (`originaux_liberes`, un déclencheur de la suppression), et la lecture et la suppression du seau les
  // ouvrent à son chef (`original_libere`) — tout chef retire donc le dossier entier d'un seul geste, ce code inchangé.
  // Un second passage qui échoue (le réseau) laisse la libération en base : le bilan le compte, comme tout reste.
  const bilans = await Promise.all(
    premiers.map(async ({ restants, ...premier }, i) => {
      if (restants.length === 0) return premier
      try {
        const second = await retirerParLots(seaux[i], restants)
        const reprises = new Set(restants)
        return {
          ...premier,
          retires: premier.retires + second.retires,
          // Un échec du premier passage que le second a levé n'en est plus un ; ce qui reste porte la raison la plus récente.
          echecs: [...premier.echecs.filter((e) => !reprises.has(e.chemin)), ...second.echecs],
        }
      } catch (err) {
        return { ...premier, inventaireIncomplet: true, echecs: [...premier.echecs, { chemin: `${seaux[i]}/${dossierId}`, raison: messageErreur(err, 'nettoyage interrompu') }] }
      }
    }),
  )
  return bilans.reduce(fusionner, vide())
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
