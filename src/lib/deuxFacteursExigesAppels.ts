// LES APPELS DE LA DOUBLE AUTHENTIFICATION EXIGÉE (C7, second temps), à part de leur règle (lib/deuxFacteursExiges.ts) :
// chacun rend une issue, ne lève jamais, et n'est appelé que le drapeau levé (`DEUX_FACTEURS_EXIGES_EXPORTE`).

import { supabase } from './supabase'
import { messageErreur } from './messageErreur'
import { compteLu, monExigenceLue, type CompteDeuxFacteurs, type GesteDesDeuxFacteurs, type MonExigence } from './deuxFacteursExiges'

export type Issue<T> = { ok: true; valeur: T } | { ok: false; message: string }

export type PerimetreDesComptes = { genre: 'equipe'; cabinetId: string } | { genre: 'acces'; dossierId: string }

/** Les comptes du périmètre, lus EN ENTIER : une ligne d'une autre forme rend toute la liste illisible. */
export async function lireLesComptes(perimetre: PerimetreDesComptes): Promise<Issue<CompteDeuxFacteurs[]>> {
  try {
    const { data, error } = await supabase.rpc('deux_facteurs_des_comptes', {
      p_cabinet_id: perimetre.genre === 'equipe' ? perimetre.cabinetId : null,
      p_dossier_id: perimetre.genre === 'acces' ? perimetre.dossierId : null,
    })
    if (error || !Array.isArray(data)) return { ok: false, message: messageErreur(error, 'la lecture n’a pas abouti.') }
    const comptes = data.map(compteLu)
    if (comptes.some((c) => c === null)) return { ok: false, message: 'la base a rendu une ligne d’une autre forme.' }
    return { ok: true, valeur: comptes as CompteDeuxFacteurs[] }
  } catch (e) {
    return { ok: false, message: messageErreur(e, 'la lecture n’a pas abouti.') }
  }
}

const FONCTION_DU_GESTE: Readonly<Record<GesteDesDeuxFacteurs, string>> = {
  exiger: 'exiger_deux_facteurs', lever: 'lever_deux_facteurs', retirer: 'retirer_second_facteur',
}

export async function agirSurLeCompte(geste: GesteDesDeuxFacteurs, userId: string): Promise<Issue<null>> {
  try {
    const { error } = await supabase.rpc(FONCTION_DU_GESTE[geste], { p_compte: userId })
    return error ? { ok: false, message: messageErreur(error, 'refus de la base.') } : { ok: true, valeur: null }
  } catch (e) {
    return { ok: false, message: messageErreur(e, 'refus de la base.') }
  }
}

/** Ce que la porte lit du compte connecté, à aal1 comme à aal2 (la pré-requête la laisse passer). */
export async function lireMonExigence(): Promise<Issue<MonExigence>> {
  try {
    const { data, error } = await supabase.rpc('ma_double_authentification')
    const lue = error ? null : monExigenceLue(data)
    return lue ? { ok: true, valeur: lue } : { ok: false, message: messageErreur(error, 'la lecture n’a pas abouti.') }
  } catch (e) {
    return { ok: false, message: messageErreur(e, 'la lecture n’a pas abouti.') }
  }
}
