import { supabase } from './supabase'
import { extraireErreurFonction } from './invokeErreur'

// L'ENVOI D'UN DEVIS ÉMIS PAR E-MAIL (espace client, étape P6c3 ; modèle : components/EnvoyerEmailModal.tsx pour la facture).
// `send-email`, modèle « devis » : le cabinet du dossier ou un accès « Ventes » ; elle n'envoie qu'un devis émis du dossier, et
// refuse en 400 (corps, brouillon), 404 (dossier ou devis introuvable), 429 (plafond d'un accès client), 503 ou 500. `invoke()`
// lève avant de lire le corps : le message de la fonction se lit par `extraireErreurFonction`, jamais sur `data`. Rien ne se
// dit envoyé sans le `ok: true` de la fonction. L'écran tient le verrou et la confirmation (DevisVue.tsx).

/**
 * Envoie le devis : `send-email` seule. Lève la raison de la fonction (sous ses mots), ou un refus à dire si elle n'a pas
 * confirmé l'envoi. `message` vide : le message par défaut de l'e-mail.
 */
export async function envoyerDevisParEmail(dossierId: string, devisId: string, destinataire: string, message: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke<{ ok?: unknown; error?: unknown }>('send-email', {
    body: { dossierId, type: 'devis', devisId, destinataire: destinataire.trim(), message: message.trim() || undefined },
  })
  if (error) throw new Error(await extraireErreurFonction(error, 'Le devis n’a pas pu être envoyé.'))
  if (data?.ok !== true) {
    throw new Error(typeof data?.error === 'string' && data.error.trim() !== '' ? data.error
      : 'La fonction n’a pas confirmé l’envoi du devis : vérifie auprès du destinataire avant de recommencer.')
  }
}
