import { supabase } from './supabase'
import type { PieceCommentaire } from './types'

// Commentaires portés sur une pièce ou un document déposé.
//
// Le besoin qui les justifie : l'OCR lit « BOULANGER MARSEILLE, 199,99 € » et s'arrête là. Il ne dira
// jamais si c'est le four de la salle d'attente ou un cadeau — or c'est précisément ce « pourquoi »
// qui décide de la catégorie, parfois de la déductibilité. Le seul qui le sache est le client, à la
// seconde où il prend la photo ; deux mois plus tard, personne au cabinet ne peut le reconstituer.
//
// Trois règles portent la valeur de ce fil, et aucune n'est cosmétique :
//
//   1. **L'auteur et la date font partie du commentaire.** « Le client dit que c'est le four de la
//      salle d'attente » et « l'opérateur suppose que c'est du matériel » n'ont pas le même poids
//      devant un contrôle. Un champ texte unique perdrait les deux.
//   2. **On ajoute, on ne réécrit pas.** Aucune policy UPDATE n'existe en base : un commentaire est
//      une déclaration faite à un moment, la réécrire après coup lui retirerait toute valeur de
//      preuve. Une correction est un commentaire de plus.
//   3. **`origine` n'est pas déclarative.** Elle découle du droit de l'auteur sur le dossier, et la
//      policy d'insertion le vérifie : un client ne peut pas signer « cabinet ». Elle est figée à
//      l'écriture parce que le rôle d'un auteur peut changer, mais ce qu'il était quand il a écrit,
//      non.
//
// Et la limite, qui ne doit jamais s'effacer : un commentaire est une information, pas une décision.
// Le client peut se tromper ou arranger les choses ; l'arbitrage reste celui du cabinet — même
// contrat que partout ailleurs, « je préremplis, tu corriges ».

// Un commentaire porte sur une pièce OU un document, jamais sur les deux ni sur rien. Un relevé CSV
// atterrit en `documents_divers` : sans cette seconde branche, un « il manque octobre » déposé avec
// le fichier serait perdu en silence.
export type CibleCommentaire =
  | { type: 'piece'; id: string }
  | { type: 'document'; id: string }

export type OrigineCommentaire = PieceCommentaire['origine']

// Clé d'indexation d'une cible. Le type fait partie de la clé : rien ne garantit qu'une pièce et un
// document n'aient pas le même identifiant, et les confondre afficherait le commentaire de l'un sous
// l'autre.
export function cleCible(cible: CibleCommentaire): string {
  return `${cible.type}:${cible.id}`
}

export function cleDuCommentaire(c: PieceCommentaire): string {
  return c.piece_id ? `piece:${c.piece_id}` : `document:${c.document_id}`
}

// Un commentaire vide n'apprend rien et encombre le fil. Refusé ici plutôt que par la contrainte de
// la base, dont l'erreur serait illisible pour un client.
export function texteExploitable(texte: string): string | null {
  const propre = texte.trim()
  return propre.length > 0 ? propre : null
}

export async function chargerCommentaires(dossierId: string): Promise<PieceCommentaire[]> {
  const { data } = await supabase
    .from('piece_commentaires')
    .select('*')
    .eq('dossier_id', dossierId)
    .order('created_at')
  return data ?? []
}

// Fil de discussion par cible, du plus ancien au plus récent — l'ordre de lecture d'une conversation.
// Les commentaires arrivent déjà triés de la base ; le regroupement préserve cet ordre.
export function commentairesParCible(commentaires: PieceCommentaire[]): Map<string, PieceCommentaire[]> {
  const parCible = new Map<string, PieceCommentaire[]>()
  for (const c of commentaires) {
    const cle = cleDuCommentaire(c)
    parCible.set(cle, [...(parCible.get(cle) ?? []), c])
  }
  return parCible
}

// Le dernier mot du fil, celui qu'on montre sur la ligne d'arbitrage. C'est le plus récent qui
// compte : quand l'opérateur a rappelé le client, sa note vaut mieux que la précision initiale.
export function dernierCommentaire(fil: PieceCommentaire[]): PieceCommentaire | null {
  return fil.length > 0 ? fil[fil.length - 1] : null
}

export type ResultatAjout = { ok: true; commentaire: PieceCommentaire } | { ok: false; message: string }

// Écrit un commentaire. `origine` est déduite du droit de l'auteur et jamais reçue de l'appelant :
// un écran qui la passerait pourrait signer à la place d'un autre. La base le refuserait de toute
// façon, mais une application qui envoie ce qu'elle sait faux est une application qu'on finit par
// croire.
export async function ajouterCommentaire(params: {
  dossierId: string
  cible: CibleCommentaire
  texte: string
  estCabinet: boolean
}): Promise<ResultatAjout> {
  const texte = texteExploitable(params.texte)
  if (!texte) return { ok: false, message: 'Le commentaire est vide.' }

  const { data: userData } = await supabase.auth.getUser()
  const auteurId = userData.user?.id ?? null
  // L'auteur est obligatoire côté base (`auteur_id = auth.uid()`). Sans session, inutile d'écrire
  // pour se faire refuser par une erreur de policy que personne ne saura lire.
  if (!auteurId) return { ok: false, message: 'Session expirée — reconnecte-toi pour commenter.' }

  const { data, error } = await supabase
    .from('piece_commentaires')
    .insert({
      dossier_id: params.dossierId,
      piece_id: params.cible.type === 'piece' ? params.cible.id : null,
      document_id: params.cible.type === 'document' ? params.cible.id : null,
      auteur_id: auteurId,
      origine: params.estCabinet ? 'cabinet' : 'client',
      texte,
    })
    .select()
    .single()

  if (error || !data) return { ok: false, message: error?.message ?? "Le commentaire n'a pas été enregistré." }
  return { ok: true, commentaire: data }
}

export async function supprimerCommentaire(id: string): Promise<string | null> {
  const { error } = await supabase.from('piece_commentaires').delete().eq('id', id)
  return error?.message ?? null
}
