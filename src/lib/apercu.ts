import { supabase } from './supabase'
import { messageErreur } from './messageErreur'

// POINT UNIQUE D'OUVERTURE D'UN FICHIER DU STOCKAGE, dans un nouvel onglet, via une URL signée
// temporaire (aucun des trois seaux n'est public).
//
// Il existait en CINQ copies — `depot.ts::ouvrirJustificatif`, `CotisationsTab.voirDocument`,
// `DocumentsTab.voir`, `PacksTab.download`, `InformationsTab` — et elles avaient divergé sur les
// trois points qui comptent :
//
// 1. **La raison de l'échec.** Trois disaient « Aperçu indisponible » sans jamais passer par
//    `messageErreur`, donc sans dire s'il fallait corriger, réessayer ou appeler l'administrateur.
//    `PacksTab.download` faisait pire : il LISAIT son erreur puis faisait `return` — le bouton de
//    téléchargement d'un pack ne faisait alors visiblement RIEN, sur le livrable qu'on envoie au
//    comptable. C'est mot pour mot le défaut corrigé la veille sur l'export d'`InformationsTab`,
//    resté entier sur l'autre chemin de téléchargement du MÊME fichier.
// 2. **`noopener`.** Une seule des cinq le passait.
// 3. **Le bloqueur de fenêtres.** AUCUNE ne lisait le retour de `window.open`. Or un `window.open`
//    appelé APRÈS un `await` sort de la fenêtre d'activation transitoire du navigateur : il est
//    alors bloqué, il rend `null`, et il ne se passe rien — ni onglet, ni message. Les cinq sites
//    sont dans ce cas, puisque tous ouvrent une URL signée qu'ils viennent d'attendre.
//
// ET C'EST `noopener` QUI RENDAIT LE POINT 3 INDÉTECTABLE, ce qui est le piège à retenir :
// `window.open(url, '_blank', 'noopener')` rend `null` **même quand il réussit** (la spécification
// HTML refuse de donner une référence à l'ouvrant). Succès et blocage y sont donc indiscernables.
// On ouvre sans le mot-clé, on teste le retour, PUIS on coupe la référence par `opener = null` —
// qui protège autant et laisse le blocage visible.
export interface ApercuOuvert { ok: true }
export interface ApercuRefuse { ok: false; message: string }
export type ResultatApercu = ApercuOuvert | ApercuRefuse

// `validiteSecondes` est EXIGÉ, sans valeur par défaut : les appelants ne veulent pas la même chose
// (300 s pour consulter un justificatif à l'écran, 60 s pour un téléchargement immédiat), et un
// paramètre par défaut est un angle mort des tests que ce dépôt a déjà payé.
export async function ouvrirApercu(seau: string, chemin: string, validiteSecondes: number): Promise<ResultatApercu> {
  const { data, error } = await supabase.storage.from(seau).createSignedUrl(chemin, validiteSecondes)
  if (error || !data) {
    return {
      ok: false,
      message: `Le lien d'ouverture n'a pas pu être créé (${messageErreur(error, 'raison inconnue')}).`,
    }
  }

  const onglet = window.open(data.signedUrl, '_blank')
  if (!onglet) {
    // Le message nomme la cause ET la sortie : sans elle, « bloqué par le navigateur » laisse
    // l'opérateur devant un bouton qui ne marche pas, sur un fichier qui existe pourtant.
    return {
      ok: false,
      message: "L'ouverture a été bloquée par le navigateur (fenêtre surgissante refusée). "
        + 'Autorise les fenêtres surgissantes pour ce site, puis réessaie — le fichier, lui, est bien là.',
    }
  }
  // Coupe la référence de la page ouverte vers celle-ci. Équivaut à `noopener`, sans en avoir
  // l'effet de bord qui masquerait le blocage (voir l'en-tête).
  onglet.opener = null
  return { ok: true }
}
