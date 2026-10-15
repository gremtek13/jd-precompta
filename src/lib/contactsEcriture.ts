import { supabase } from './supabase'
import type { ContactEnvoye } from './contacts'
import type { Contact } from './types'

// LES QUATRE GESTES D'UN CONTACT, PAR LA BASE SEULE (espace client, étape A4b1). Aucune policy n'écrit `contacts` (hors la
// restauration du super-administrateur) : seules `enregistrer_contact`, `retirer_contact`, `reprendre_contact` et
// `effacer_contact` le font, chacune avec son accès (`gere_les_ventes`, le cabinet ou le client « Ventes ») vérifié avant
// toute lecture. Chacune rend la LIGNE qu'elle a écrite : on vérifie ici qu'elle a bien rendu le contact visé, dans l'état
// attendu — comme `articlesEcriture.ts`. Un refus se lève sous les mots de la base (le message de l'erreur, que
// `messageErreur` rend tel quel).

/** Ce que la base a gardé : le contact visé (celui qui vient d'être créé, pour une création), dans l'état attendu — sinon on le dit. */
function ecrit(data: unknown, attendu: { id: string | null; retire: boolean; efface: boolean }): Contact {
  const ligne = data as Partial<Contact> | null
  if (ligne == null || typeof ligne !== 'object' || typeof ligne.id !== 'string'
    || (attendu.id != null && ligne.id !== attendu.id)
    || (ligne.retire_le != null) !== attendu.retire
    || (ligne.efface_le != null) !== attendu.efface) {
    throw new Error('La base n’a pas rendu le contact écrit : relis la liste avant de recommencer.')
  }
  return ligne as Contact
}

/** Crée le contact (`contactId` nul) ou le modifie, tous ses champs. Rend la ligne écrite ; lève le refus de la base. */
export async function enregistrerContact(dossierId: string, contactId: string | null, saisie: ContactEnvoye): Promise<Contact> {
  const { data, error } = await supabase.rpc('enregistrer_contact', {
    p_dossier_id: dossierId, p_contact_id: contactId, p_contact: saisie,
  })
  if (error) throw new Error(error.message)
  return ecrit(data, { id: contactId, retire: false, efface: false })
}

/** Retire le contact : il sort des choix et garde son SIRET. */
export async function retirerContact(dossierId: string, contactId: string): Promise<Contact> {
  const { data, error } = await supabase.rpc('retirer_contact', { p_dossier_id: dossierId, p_contact_id: contactId })
  if (error) throw new Error(error.message)
  return ecrit(data, { id: contactId, retire: true, efface: false })
}

/** Reprend un contact retiré : il revient dans les choix ; la reprise est sa dernière modification. */
export async function reprendreContact(dossierId: string, contactId: string): Promise<Contact> {
  const { data, error } = await supabase.rpc('reprendre_contact', { p_dossier_id: dossierId, p_contact_id: contactId })
  if (error) throw new Error(error.message)
  return ecrit(data, { id: contactId, retire: false, efface: false })
}

/** Efface le contact : ses données sont vidées, la ligne reste sous « Contact effacé le … ». Le geste ne se défait pas. */
export async function effacerContact(dossierId: string, contactId: string): Promise<Contact> {
  const { data, error } = await supabase.rpc('effacer_contact', { p_dossier_id: dossierId, p_contact_id: contactId })
  if (error) throw new Error(error.message)
  return ecrit(data, { id: contactId, retire: false, efface: true })
}
