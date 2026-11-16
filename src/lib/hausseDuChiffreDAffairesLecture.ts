import { supabase } from './supabase'
import { lireTout } from './lectureComplete'
import { messageErreur } from './messageErreur'
import { lireLaCaisse } from './caisseLecture'
import { lireLesVentesFacturees } from './ventesFactureesLecture'
import {
  COLONNES_DES_VUES, COLONNES_DU_SEUIL, MARQUE_NON_ENREGISTREE, SEUIL_NON_ENREGISTRE, aUnSeuil, chiffreDAffairesDesSources,
  jugerLaHausse, seuilsDeLaLigne, type HausseVue, type LectureDeLaHausse, type SensDuSeuil, type SeuilDuDossier,
  type SeuilsDeLAlerte, type SourcesDuChiffreDAffaires, type Trimestre,
} from './hausseDuChiffreDAffaires'
import type { Categorie, Dossier, LigneBancaire, Piece, ReglementGroupe, VentilationBancaire } from './types'

// CE QUE L'ALERTE DU CHIFFRE D'AFFAIRES — À LA HAUSSE ET À LA BAISSE — LIT ET ÉCRIT EN BASE
// (docs/conceptions/52-alerte-hausse-du-chiffre-d-affaires.md). Le jugement est celui du module pur
// (lib/hausseDuChiffreDAffaires.ts) ; ici, les lectures — le réglage du dossier (ses deux seuils, sur une ligne, et ses
// marques), les entrées du chiffre d'affaires (celles de l'onglet Estimation), les seuils de tous les dossiers que le compte
// suit — et les deux écritures, chacune par sa fonction SQL, son erreur lue et dite : un seuil se règle à part, sens par sens.
//
// Aucune lecture ne REJETTE : refusée, partielle ou d'un autre dossier, elle revient « illisible », avec son motif, et rien ne
// se juge — jamais un « pas de hausse » ni un « pas de baisse » sur ce qu'on n'a pas lu en entier. Les entrées du chiffre
// d'affaires ne se lisent que pour un dossier qui a au moins un seuil : sans aucun, rien ne se calcule, et le dossier ne paie
// aucune lecture de plus.
//
// Drapeau `HAUSSE_DU_CHIFFRE_D_AFFAIRES_PREVUE` baissé, les écrans n'appellent rien d'ici : les tables n'existent pas.

export type LectureDuReglage =
  | { dossierId: string; etat: 'lu'; seuil: SeuilDuDossier | null; vues: HausseVue[] }
  | { dossierId: string; etat: 'illisible'; motif: string }

/** Les seuils du dossier et ses marques « vue avec le client », lus en entier ; ou « illisible ». */
export async function lireLeReglageDeLaHausse(dossierId: string): Promise<LectureDuReglage> {
  try {
    const [seuils, vues] = await Promise.all([
      lireTout<SeuilDuDossier & { id?: string }>((debut, fin) =>
        supabase.from('seuils_du_chiffre_d_affaires').select(`id, ${COLONNES_DU_SEUIL}`, { count: 'exact' })
          .eq('dossier_id', dossierId).order('id').range(debut, fin),
      ),
      lireTout<HausseVue & { id: string }>((debut, fin) =>
        supabase.from('hausses_vues_avec_le_client').select(COLONNES_DES_VUES, { count: 'exact' })
          .eq('dossier_id', dossierId).order('annee').order('trimestre').order('id').range(debut, fin),
      ),
    ])
    const partielle = [seuils, vues].find((l) => !l.complete)
    if (partielle) return { dossierId, etat: 'illisible', motif: partielle.motif ?? 'lecture incomplète' }
    if ([...seuils.lignes, ...vues.lignes].some((l) => l.dossier_id !== dossierId) || seuils.lignes.length > 1) {
      return { dossierId, etat: 'illisible', motif: 'une ligne rendue n’est pas celle de ce dossier' }
    }
    return { dossierId, etat: 'lu', seuil: seuils.lignes[0] ?? null, vues: vues.lignes }
  } catch (erreur) {
    return { dossierId, etat: 'illisible', motif: messageErreur(erreur, 'la lecture du seuil a échoué') }
  }
}

/** Les entrées du chiffre d'affaires du dossier, lues en entier (les collections de l'onglet Estimation) ; ou le motif. */
export async function lireLesSourcesDuChiffreDAffaires(dossierId: string):
  Promise<{ etat: 'lues'; sources: SourcesDuChiffreDAffaires } | { etat: 'incomplete'; motif: string }> {
  try {
    const [pieces, lignes, ventilations, reglements, categories, ventes, caisse] = await Promise.all([
      lireTout<Piece>((debut, fin) =>
        supabase.from('pieces').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).eq('statut', 'validee').eq('type_piece', 'vente').order('id').range(debut, fin),
      ),
      lireTout<LigneBancaire>((debut, fin) =>
        supabase.from('lignes_bancaires').select('*', { count: 'exact' }).eq('dossier_id', dossierId).order('id').range(debut, fin),
      ),
      lireTout<VentilationBancaire>((debut, fin) =>
        supabase.from('ventilations_bancaires').select('*', { count: 'exact' }).eq('dossier_id', dossierId).order('id').range(debut, fin),
      ),
      lireTout<ReglementGroupe>((debut, fin) =>
        supabase.from('reglements_groupes').select('*', { count: 'exact' }).eq('dossier_id', dossierId).order('id').range(debut, fin),
      ),
      lireTout<Categorie>((debut, fin) =>
        supabase.from('categories').select('*', { count: 'exact' })
          .or(`dossier_id.eq.${dossierId},dossier_id.is.null`).order('id').range(debut, fin),
      ),
      // Ne rejettent jamais : refusées ou partielles, elles reviennent incomplètes, avec leur motif.
      lireLesVentesFacturees(dossierId),
      lireLaCaisse(dossierId),
    ])
    const partielle = [pieces, lignes, ventilations, reglements, categories].find((l) => !l.complete)
    if (partielle) return { etat: 'incomplete', motif: partielle.motif ?? 'lecture incomplète' }
    if (ventes.dossierId !== dossierId) return { etat: 'incomplete', motif: 'les ventes facturées d’un autre dossier' }
    if (ventes.etat !== 'lue') return { etat: 'incomplete', motif: ventes.motif }
    if (caisse.dossierId !== dossierId) return { etat: 'incomplete', motif: 'la caisse d’un autre dossier' }
    return {
      etat: 'lues',
      sources: {
        dossierId, piecesDeVente: pieces.lignes, lignes: lignes.lignes, ventilations: ventilations.lignes,
        reglements: reglements.lignes, categories: categories.lignes, ventesFacturees: ventes.ventes, encaissees: ventes.encaissees,
        caisse,
      },
    }
  } catch (erreur) {
    return { etat: 'incomplete', motif: messageErreur(erreur, 'la lecture du chiffre d’affaires a échoué') }
  }
}

export type DossierDeLaHausse = Pick<Dossier, 'id' | 'assujetti_tva' | 'mode_comptable'>

/**
 * L'alerte d'un dossier, au jour donné (à Paris) : le réglage d'abord ; sans seuil, rien de plus ne se lit ; avec lui, les
 * entrées du chiffre d'affaires, puis le jugement. Ne rejette jamais.
 */
export async function lireLaHausseDuDossier(dossier: DossierDeLaHausse, aujourdHui: string):
  Promise<{ dossierId: string; reglage: LectureDuReglage; lecture: Exclude<LectureDeLaHausse, { etat: 'sans_objet' | 'en_cours' }> }> {
  const reglage = await lireLeReglageDeLaHausse(dossier.id)
  if (reglage.etat === 'illisible') return { dossierId: dossier.id, reglage, lecture: { etat: 'illisible', motif: reglage.motif } }
  const seuils = seuilsDeLaLigne(reglage.seuil)
  if (!aUnSeuil(seuils)) {
    return { dossierId: dossier.id, reglage, lecture: { etat: 'lue', hausse: { etat: 'sans_seuil' } } }
  }
  const sources = await lireLesSourcesDuChiffreDAffaires(dossier.id)
  if (sources.etat === 'incomplete') return { dossierId: dossier.id, reglage, lecture: { etat: 'illisible', motif: sources.motif } }
  const chiffre = chiffreDAffairesDesSources(sources.sources, dossier.assujetti_tva, dossier.mode_comptable)
  if (!chiffre.ok) return { dossierId: dossier.id, reglage, lecture: { etat: 'illisible', motif: chiffre.motif } }
  return {
    dossierId: dossier.id,
    reglage,
    lecture: {
      etat: 'lue',
      hausse: jugerLaHausse({
        seuils, aujourdHui, releve: sources.sources.lignes, chiffreDAffaires: chiffre.chiffreDAffaires, vues: reglage.vues,
      }),
    },
  }
}

/**
 * Les seuils de tous les dossiers que la base ouvre au compte (la RLS : le cabinet du dossier), lus en entier — une ligne par
 * dossier au plus ; seuls ceux qui ont au moins un seuil se gardent (une ligne aux deux seuils vidés n'alerte de rien).
 */
export async function lireLesSeuilsDesDossiers():
  Promise<{ etat: 'lus'; seuils: ReadonlyMap<string, SeuilsDeLAlerte> } | { etat: 'illisible'; motif: string }> {
  try {
    const lecture = await lireTout<Pick<SeuilDuDossier, 'dossier_id' | 'seuil_de_hausse' | 'seuil_de_baisse'>>((debut, fin) =>
      supabase.from('seuils_du_chiffre_d_affaires').select('id, dossier_id, seuil_de_hausse, seuil_de_baisse', { count: 'exact' })
        .order('dossier_id').order('id').range(debut, fin),
    )
    if (!lecture.complete) return { etat: 'illisible', motif: lecture.motif ?? 'lecture incomplète' }
    return {
      etat: 'lus',
      seuils: new Map(lecture.lignes.flatMap((l) => {
        const seuils = seuilsDeLaLigne(l)
        return aUnSeuil(seuils) ? [[l.dossier_id, seuils] as const] : []
      })),
    }
  } catch (erreur) {
    return { etat: 'illisible', motif: messageErreur(erreur, 'la lecture des seuils a échoué') }
  }
}

/**
 * Le seuil d'un sens, contre la valeur lue qu'il remplace (`regler_seuil_du_chiffre_d_affaires`) : l'autre seuil n'en est pas
 * touché. Ne rejette jamais.
 */
export async function reglerLeSeuil(dossierId: string, sens: SensDuSeuil, lu: number | null, seuil: number | null):
  Promise<{ ok: true; seuil: number | null } | { ok: false; erreur: string }> {
  try {
    const { data, error } = await supabase.rpc('regler_seuil_du_chiffre_d_affaires', {
      p_dossier_id: dossierId, p_sens: sens, p_seuil_lu: lu, p_seuil: seuil,
    })
    if (error) return { ok: false, erreur: messageErreur(error, SEUIL_NON_ENREGISTRE) }
    if (data !== null && typeof data !== 'number') return { ok: false, erreur: SEUIL_NON_ENREGISTRE }
    if (data !== seuil) return { ok: false, erreur: SEUIL_NON_ENREGISTRE }
    return { ok: true, seuil: data }
  } catch (erreur) {
    return { ok: false, erreur: messageErreur(erreur, SEUIL_NON_ENREGISTRE) }
  }
}

/** La marque « vue avec le client » d'un trimestre clos (`marquer_hausse_vue_avec_le_client`). Ne rejette jamais. */
export async function marquerLaHausseVue(dossierId: string, t: Trimestre): Promise<{ ok: true } | { ok: false; erreur: string }> {
  try {
    const { data, error } = await supabase.rpc('marquer_hausse_vue_avec_le_client', {
      p_dossier_id: dossierId, p_annee: t.annee, p_trimestre: t.trimestre,
    })
    if (error) return { ok: false, erreur: messageErreur(error, MARQUE_NON_ENREGISTREE) }
    if (typeof data !== 'string' || data === '') return { ok: false, erreur: MARQUE_NON_ENREGISTREE }
    return { ok: true }
  } catch (erreur) {
    return { ok: false, erreur: messageErreur(erreur, MARQUE_NON_ENREGISTREE) }
  }
}
