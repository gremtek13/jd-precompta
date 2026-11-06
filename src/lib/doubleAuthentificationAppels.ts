// LES APPELS DU SECOND FACTEUR (ligne 51.5, étape C7), à part de leur règle (lib/doubleAuthentification.ts) : chacun rend
// une issue — la valeur, ou un message déjà dit par `messageDuService` —, jamais une erreur nue, et ne lève jamais. Rien
// n'est journalisé ici : la clé d'un appareil (`totp.secret`, et l'adresse `otpauth://` qui la porte) ne quitte l'appel que
// vers l'écran qui l'affiche, et un refus du service ne la contient pas.

import { supabase } from './supabase'
import { codeSaisi, facteurDe, messageDuService, type Facteur, type Niveau, type Niveaux, type Registre } from './doubleAuthentification'

export type Issue<T> = { ok: true; valeur: T } | { ok: false; message: string }

export interface SecuriteLue { facteurs: Facteur[]; niveaux: Niveaux }

/** Un appareil dont l'inscription vient de commencer : la clé et son code QR, que l'écran montre une fois. */
export interface InscriptionCommencee { id: string; qrCode: string; secret: string }

function niveauLu(valeur: unknown): Niveau | null {
  return valeur === 'aal1' || valeur === 'aal2' ? valeur : null
}

/**
 * Les appareils du compte, lus au service (`listFactors` relit l'utilisateur), et les niveaux de la session gardée
 * (`getAuthenticatorAssuranceLevel`, sans appel) : leur désaccord est le « jeton à rafraîchir ».
 */
export async function lireLaSecurite(registre: Registre): Promise<Issue<SecuriteLue>> {
  try {
    const { data: liste, error: erreurListe } = await supabase.auth.mfa.listFactors()
    if (erreurListe || !liste || !Array.isArray(liste.all)) return { ok: false, message: messageDuService('lecture', erreurListe, registre) }
    const { data: niveaux, error: erreurNiveaux } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    if (erreurNiveaux || !niveaux) return { ok: false, message: messageDuService('lecture', erreurNiveaux, registre) }
    return {
      ok: true,
      valeur: { facteurs: liste.all.map(facteurDe), niveaux: { actuel: niveauLu(niveaux.currentLevel), suivant: niveauLu(niveaux.nextLevel) } },
    }
  } catch (e) {
    return { ok: false, message: messageDuService('lecture', e, registre) }
  }
}

/** Commence l'inscription d'une application d'authentification : un facteur inachevé, sa clé et son code QR. */
export async function inscrireUnAppareil(nom: string, registre: Registre): Promise<Issue<InscriptionCommencee>> {
  try {
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: nom.trim() })
    if (error || !data || data.type !== 'totp' || !data.totp?.secret) return { ok: false, message: messageDuService('inscription', error, registre) }
    return { ok: true, valeur: { id: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret } }
  } catch (e) {
    return { ok: false, message: messageDuService('inscription', e, registre) }
  }
}

/**
 * Le code d'un appareil : un défi, puis sa vérification. Réussie, auth-js garde la session élevée (`aal2`) et l'annonce
 * (« MFA_CHALLENGE_VERIFIED ») avant de rendre la main : la porte de l'application la relit (App.tsx). C'est aussi ce qui
 * achève une inscription — et ferme alors les autres sessions du compte.
 */
export async function verifierLeCode(facteurId: string, saisie: string, registre: Registre): Promise<Issue<null>> {
  try {
    const { data: defi, error: erreurDefi } = await supabase.auth.mfa.challenge({ factorId: facteurId })
    if (erreurDefi || !defi) return { ok: false, message: messageDuService('verification', erreurDefi, registre) }
    const { error } = await supabase.auth.mfa.verify({ factorId: facteurId, challengeId: defi.id, code: codeSaisi(saisie) })
    if (error) return { ok: false, message: messageDuService('verification', error, registre) }
    return { ok: true, valeur: null }
  } catch (e) {
    return { ok: false, message: messageDuService('verification', e, registre) }
  }
}

/** Renouvelle la session : son jeton redit ce que le service sait (un facteur retiré la ramène à `aal1`). */
export async function actualiserLaSession(registre: Registre): Promise<Issue<null>> {
  try {
    const { error } = await supabase.auth.refreshSession()
    if (error) return { ok: false, message: messageDuService('actualisation', error, registre) }
    return { ok: true, valeur: null }
  } catch (e) {
    return { ok: false, message: messageDuService('actualisation', e, registre) }
  }
}

/**
 * Retire un appareil (un facteur vérifié demande une session `aal2`), puis renouvelle la session, sans quoi elle garderait
 * son niveau jusqu'au renouvellement de son jeton (documentation de Supabase). `sessionActualisee` dit si ce second temps a
 * eu lieu : le retrait, lui, est fait.
 */
export async function retirerUnAppareil(facteurId: string, registre: Registre): Promise<Issue<{ sessionActualisee: boolean }>> {
  try {
    const { error } = await supabase.auth.mfa.unenroll({ factorId: facteurId })
    if (error) return { ok: false, message: messageDuService('retrait', error, registre) }
  } catch (e) {
    return { ok: false, message: messageDuService('retrait', e, registre) }
  }
  const actualisation = await actualiserLaSession(registre)
  return { ok: true, valeur: { sessionActualisee: actualisation.ok } }
}
