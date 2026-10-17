import { supabase } from './supabase'
import { messageErreur } from './messageErreur'
import { estUnDoublonDuStockage, logoPret, type LogoPret } from './logoDesFactures'
import { lireLeLogo } from './logoDesFacturesLecture'

// LE DÉPÔT DU FICHIER D'UN LOGO DE FACTURE, DANS LE SEAU `ventes` (espace client, étape A5c2a). Le premier geste d'un logo
// posé ou changé ; le second, la version des paramètres qui le désigne (`enregistrerParametresFacturation`), est à l'écran,
// sous le même verrou. Les deux ne font pas une transaction : un fichier déposé dont la version est refusée RESTE dans le
// seau (A5C-Q3 : un logo qu'aucune version ne désigne plus reste là jusqu'à la suppression du dossier), et l'écran le dit.
//
// Le fichier est REJUGÉ ici, à l'instant du dépôt, par `logoPret` — le même juge que l'écran a consulté au choix : c'est lui
// qui rend le corps réétiqueté que le stockage jugera, et le nom du fichier est son empreinte. L'empreinte qu'on attend est
// celle que l'écran a montrée ; un fichier qui n'a plus la même ne part pas.
//
// Un NOM DÉJÀ PRIS n'est pas une faute : le nom d'un logo est son empreinte, reposer le même fichier bute sur l'unicité du
// seau (aucune mise à jour n'existe). Le fichier qui y est est alors RELU, son SHA-256 recalculé : le même, il est désigné
// sans nouveau dépôt ; autre chose, ou illisible, rien n'est enregistré. Tout refus se lève sous des mots neutres — le
// cabinet et le client les lisent —, et `messageErreur` dit celui du stockage.

export interface DepotDuLogo {
  pret: LogoPret
  // Le fichier était déjà dans le seau (même empreinte, relue) : rien n'a été déposé.
  dejaLa: boolean
}

export async function deposerLeLogo(dossierId: string, fichier: Blob, empreinteAttendue: string): Promise<DepotDuLogo> {
  const pret = await logoPret(dossierId, fichier)
  if ('refus' in pret) throw new Error(`Ce logo n’est pas pris : ${pret.refus.message}.`)
  if (pret.empreinte !== empreinteAttendue) throw new Error('Le fichier choisi a changé depuis son choix : il faut le choisir de nouveau.')
  const { error } = await supabase.storage.from('ventes').upload(pret.chemin, pret.corps, { upsert: false })
  if (!error) return { pret, dejaLa: false }
  if (!estUnDoublonDuStockage(error)) throw new Error(messageErreur(error, 'Le logo n’a pas pu être déposé.'))
  const present = await lireLeLogo({ chemin: pret.chemin, empreinte: pret.empreinte })
  if (present.etat === 'verifie') return { pret, dejaLa: true }
  const raison = present.etat === 'autre_empreinte'
    ? 'ce n’est pas ce logo (son empreinte diffère)'
    : present.etat === 'refuse' ? `le stockage refuse de le rendre (${present.motif})` : 'il n’a pas pu être relu pour le vérifier'
  throw new Error(`Un fichier de ce nom est déjà dans l’espace du dossier, mais ${raison} : rien n’est enregistré.`)
}
