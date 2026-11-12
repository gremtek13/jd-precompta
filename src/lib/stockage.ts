import { supabase } from './supabase'
import { messageErreur } from './messageErreur'
import { cheminDuDossier } from './cheminDuDossier'

// Retirer un fichier du stockage, sans jamais le faire en silence.
//
// POURQUOI UN SEUL ENDROIT. Six écrans retiraient un fichier après avoir supprimé sa ligne, tous en
// `.remove([...]).catch(() => {})` — c'est-à-dire la façon la plus explicite possible de dire « je ne
// veux pas savoir ». Le balayage du 20/09/2026 sur les écritures non vérifiées avait posé la bonne
// question — *quelque chose recharge-t-il derrière ?* — mais il l'avait posée des TABLES : là, un
// `load()` suit presque toujours, donc l'échec se voit, la ligne supprimée réapparaît.
// **Pour le STOCKAGE la réponse est toujours non.** Aucun écran de l'application ne relit jamais un
// seau ; un retrait raté n'a donc strictement aucun témoin.
//
// CE QUE ÇA COÛTE ICI, ET POURQUOI CE N'EST PAS LA SUPPRESSION D'UN DOSSIER. Le résidu est un fichier
// qu'aucun écran ne montre — mais il reste sous `dossierId/`, donc la suppression du dossier finira
// par le ramasser (voir suppressionDossier.ts, où l'enjeu est tout autre : la ligne `dossiers` part
// aussi, et plus rien ne peut retrouver les fichiers ensuite). Le geste de l'utilisateur, lui, est
// bien accompli et visible : la ligne a disparu de l'écran. D'où l'arbitrage — on JOURNALISE au lieu
// de bâtir un message par écran, comme `tauxChange.tauxBce` le fait déjà pour un best-effort.
//
// Le `catch` est nécessaire : `remove()` rend `{ error }` sur un refus du serveur, mais REJETTE sur
// une coupure réseau. Les deux laissent le même fichier en place.
export async function retirerFichiers(
  bucket: 'pieces' | 'packs' | 'cabinet-logos' | 'ventes',
  chemins: string[],
  contexte: string,
  racine: string,
): Promise<void> {
  // LA RACINE EST EXIGÉE (CFCS-Q1, 12/11/2026) : le dossier — ou, pour `cabinet-logos`, le cabinet — que chaque chemin
  // doit avoir pour premier segment. Un chemin lu d'une ligne que le client peut écrire (`pieces.storage_path`,
  // `lisible_path`, `documents_divers.storage_path`) peut nommer un autre dossier, que la base ne refuse pas : aux droits
  // du cabinet, le retrait supprimerait le fichier de cet autre dossier. Il n'est pas retiré, et le journal le compte sans
  // le recopier.
  const horsDeLaRacine = chemins.filter((c) => !cheminDuDossier(c, racine)).length
  if (horsDeLaRacine > 0) {
    console.error(`[${contexte}] ${horsDeLaRacine} chemin(s) hors du dossier, non retiré(s) de ${bucket} : à signaler`)
  }
  const aRetirer = chemins.filter((c) => cheminDuDossier(c, racine))
  if (aRetirer.length === 0) return
  try {
    const { error } = await supabase.storage.from(bucket).remove(aRetirer)
    if (error) {
      console.error(
        `[${contexte}] fichier(s) ORPHELIN(S) laissé(s) dans ${bucket} : ${aRetirer.join(', ')}`,
        messageErreur(error, 'retrait refusé par le stockage'),
      )
    }
  } catch (err) {
    console.error(
      `[${contexte}] fichier(s) ORPHELIN(S) laissé(s) dans ${bucket} : ${aRetirer.join(', ')}`,
      messageErreur(err, 'retrait interrompu'),
    )
  }
}
