import { supabase } from './supabase'
import { messageErreur } from './messageErreur'

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
  bucket: 'pieces' | 'packs' | 'cabinet-logos',
  chemins: string[],
  contexte: string,
): Promise<void> {
  if (chemins.length === 0) return
  try {
    const { error } = await supabase.storage.from(bucket).remove(chemins)
    if (error) {
      console.error(
        `[${contexte}] fichier(s) ORPHELIN(S) laissé(s) dans ${bucket} : ${chemins.join(', ')}`,
        messageErreur(error, 'retrait refusé par le stockage'),
      )
    }
  } catch (err) {
    console.error(
      `[${contexte}] fichier(s) ORPHELIN(S) laissé(s) dans ${bucket} : ${chemins.join(', ')}`,
      messageErreur(err, 'retrait interrompu'),
    )
  }
}
