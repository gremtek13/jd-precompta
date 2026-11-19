import { lireTout } from './lectureComplete'
import { messageErreur } from './messageErreur'
import { optionsDesCabinets, type DossierDuParc, type LigneDOptionLue, type OptionsDUnCabinet } from './optionsDuCabinetVue'
import { supabase } from './supabase'

// LA LECTURE DE L'ÉCRAN DES OPTIONS DES CABINETS (conception 56, § 2.5, lot OPT4), au super-administrateur, qui lit tout le
// parc : les cabinets, leurs options (`options_des_cabinets`, la policy `admin_du_cabinet` comprend le super-administrateur),
// et ce qui retient une extinction avant le clic — les dossiers (leur nom, leur bascule des ventes) et les transmissions
// parties sans issue connue (`etat = 'envoi'`, des deux tables). Chaque collection EN ENTIER (`lireTout`, compte annoncé,
// tri total terminé par la clé primaire). Elle ne rejette jamais : une lecture partielle, refusée ou rompue rend
// `partielle`, et l'écran n'offre alors AUCUN geste. Appelée seulement le drapeau `OPTIONS_DES_CABINETS_PREVUES` levé :
// l'écran ne se monte pas avant.

export type CabinetDuParc = { readonly id: string; readonly nom: string }

export type OptionsDuParcLues =
  | {
      readonly etat: 'lues'
      readonly cabinets: readonly CabinetDuParc[]
      readonly options: Map<string, OptionsDUnCabinet>
      readonly dossiers: readonly DossierDuParc[]
      readonly dossiersEnEnvoi: ReadonlySet<string>
    }
  | { readonly etat: 'partielle'; readonly motif: string }

export async function lireLesOptionsDuParc(): Promise<OptionsDuParcLues> {
  try {
    const [cabinets, options, dossiers, envoisFactures, envoisEncaissements] = await Promise.all([
      lireTout<CabinetDuParc>((debut, fin) =>
        supabase.from('cabinets').select('id, nom', { count: 'exact' }).order('nom').order('id').range(debut, fin)),
      lireTout<LigneDOptionLue>((debut, fin) =>
        supabase.from('options_des_cabinets').select('cabinet_id, module, ouverte', { count: 'exact' })
          .order('cabinet_id').order('module').range(debut, fin)),
      lireTout<DossierDuParc>((debut, fin) =>
        supabase.from('dossiers').select('id, cabinet_id, nom, ventes_par_les_factures', { count: 'exact' })
          .order('id').range(debut, fin)),
      lireTout<{ dossier_id: string }>((debut, fin) =>
        supabase.from('transmissions_factures').select('dossier_id, id', { count: 'exact' })
          .eq('etat', 'envoi').order('id').range(debut, fin)),
      lireTout<{ dossier_id: string }>((debut, fin) =>
        supabase.from('transmissions_encaissements').select('dossier_id, id', { count: 'exact' })
          .eq('etat', 'envoi').order('id').range(debut, fin)),
    ])
    const incomplete = [cabinets, options, dossiers, envoisFactures, envoisEncaissements].find((l) => !l.complete)
    if (incomplete) return { etat: 'partielle', motif: incomplete.motif ?? 'lecture incomplète' }
    return {
      etat: 'lues',
      cabinets: cabinets.lignes,
      options: optionsDesCabinets(cabinets.lignes.map((c) => c.id), options.lignes),
      dossiers: dossiers.lignes,
      dossiersEnEnvoi: new Set([...envoisFactures.lignes, ...envoisEncaissements.lignes].map((t) => t.dossier_id)),
    }
  } catch (e) {
    return { etat: 'partielle', motif: messageErreur(e, 'la lecture des options des cabinets a échoué') }
  }
}

/** Ouvre ou ferme un module d'un cabinet par `regler_option_du_cabinet` seule : nul sur un succès, sinon le refus de la
 *  base (ses mots, P0001, 42501, 22023). Ne rejette jamais. */
export async function reglerOptionDuCabinet(cabinetId: string, module: string, ouverte: boolean): Promise<string | null> {
  try {
    const { error } = await supabase.rpc('regler_option_du_cabinet', { p_cabinet_id: cabinetId, p_module: module, p_ouverte: ouverte })
    return error ? messageErreur(error, 'Le réglage du module a échoué.') : null
  } catch (e) {
    return messageErreur(e, 'Le réglage du module a échoué.')
  }
}
