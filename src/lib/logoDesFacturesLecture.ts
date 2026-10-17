import { supabase } from './supabase'
import { messageErreur } from './messageErreur'
import { TAILLE_MAX, typeDUnLogoDeFacture } from './bornesStockage'
import { empreinteSha256, typeDuNomDuLogo, type LogoLu } from './logoDesFactures'

// LE FICHIER DU LOGO QU'UNE VERSION DÉSIGNE, RELU DANS LE SEAU `ventes` POUR L'ÉCRAN (espace client, étape A5c2a ; modèle :
// lib/adressesReceptionLecture.ts). Une version des paramètres ne porte que le chemin et l'empreinte du logo : l'image,
// elle, est dans le stockage, et rien ne dit qu'elle y soit encore, ni qu'elle soit celle que la version désigne — un
// fichier posé sous un nom d'empreinte reste sous ce nom, mais le seau n'est protégé que par ses policies. L'écran ne
// montre donc une image qu'APRÈS avoir recalculé son SHA-256 et l'avoir trouvé égal à celui de la version : une image qui
// ne serait pas celle que la version désigne se TAIT, et l'écran dit pourquoi (`LogoLu`, src/lib/logoDesFactures.ts).
//
// Elle ne REJETTE jamais : une lecture qui échoue tombe du côté signalé, avec sa raison, jamais en une image absente qu'on
// croirait retirée. C'est l'écran qui la garde AVEC le dossier et le chemin pour lesquels elle a été faite.

// Le stockage rend « introuvable » de plusieurs façons selon la version du service : le statut de la réponse, ou celui du
// corps (`{ statusCode: '404', error: 'not_found', message: 'Object not found' }` sous un statut 400). Une policy qui ne
// laisse pas lire un objet le dit de la même façon : « absent » veut dire « pas rendu », pas « supprimé ».
function estIntrouvable(erreur: unknown): boolean {
  if (erreur === null || typeof erreur !== 'object') return false
  const e = erreur as { status?: unknown; statusCode?: unknown; message?: unknown }
  return e.status === 404 || e.statusCode === '404' || e.statusCode === 404
    || (typeof e.message === 'string' && /\bnot found\b/i.test(e.message))
}

/**
 * Le fichier du logo qu'une version désigne (`logo`), dans le seau des ventes : téléchargé, son SHA-256 recalculé sur les
 * octets reçus, comparé à celui de la version, et son type relu à sa signature — celui que dit son nom. Le dossier n'est pas
 * redemandé : la table n'admet pour une version que le chemin d'un logo de SON dossier (la contrainte
 * `parametres_facturation_logo_chemin_forme`, qui vaut aussi pour une ligne restaurée), les policies du seau n'ouvrent que les
 * dossiers de l'appelant, et l'empreinte prouve que le fichier rendu est celui que la version désigne.
 */
export async function lireLeLogo(logo: { chemin: string; empreinte: string }): Promise<LogoLu> {
  let reponse
  try {
    reponse = await supabase.storage.from('ventes').download(logo.chemin)
  } catch (e) {
    return { etat: 'refuse', motif: messageErreur(e, 'le stockage n’a pas répondu') }
  }
  const { data, error } = reponse
  if (error) return estIntrouvable(error) ? { etat: 'absent' } : { etat: 'refuse', motif: messageErreur(error, 'le stockage n’a pas rendu le fichier') }
  try {
    // Ce qui n'est pas un fichier (une réponse d'une autre forme), un fichier vide ou plus gros que la borne du seau : pas un logo.
    if (data == null || typeof data.arrayBuffer !== 'function' || typeof data.size !== 'number') return { etat: 'illisible' }
    if (data.size === 0 || data.size > TAILLE_MAX.ventes) return { etat: 'illisible' }
    if (await empreinteSha256(data) !== logo.empreinte) return { etat: 'autre_empreinte' }
    // L'empreinte juste, le type se relit pourtant : à la signature, jamais au type que le service déclare, et il doit être
    // celui que dit le nom du chemin (la base le refuse autrement).
    const type = typeDUnLogoDeFacture(new Uint8Array(await data.slice(0, 16).arrayBuffer()))
    if (type === null || type !== typeDuNomDuLogo(logo.chemin)) return { etat: 'illisible' }
    // Le corps est réétiqueté : le navigateur affiche l'image sous le type que prouve sa signature.
    return { etat: 'verifie', corps: new Blob([data], { type }), type, taille: data.size }
  } catch {
    return { etat: 'illisible' }
  }
}
