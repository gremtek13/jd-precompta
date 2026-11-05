import { supabase } from './supabase'
import { ACOMPTES_PREVUS } from './devis'
import { SANS_ACOMPTE_CII, acompteLu } from './factureCii'
import { lireTout } from './lectureComplete'
import { messageErreur } from './messageErreur'
import type { DevisCite, FactureCitee, LectureAcompte } from './acompteDeLaFactureVue'

export type { LectureAcompte } from './acompteDeLaFactureVue'

// L'ACOMPTE D'UNE FACTURE, LU PAR LE NAVIGATEUR (étape P5b4b ; conception : HISTORIQUE.md, « L'ACOMPTE D'UN DEVIS : LA
// CONCEPTION (P5B) »). Ce que l'aperçu imprime et ce que la fenêtre de transmission juge (`refusEmission`) d'une facture
// d'acompte, d'une facture finale et de l'avoir d'un acompte : la même lecture que `acompteDeLaFacture` de superpdp-emit,
// côté navigateur, plus le devis auquel la facture est liée (l'aperçu le cite) et le numéro et la date de la facture
// qu'un avoir corrige.
//
// LE DRAPEAU. Les colonnes que la migration `acomptes_des_devis` pose (`factures_emises.acompte`,
// `date_versement_acompte`, `facture_lignes.reprise_facture_id`) ne sont nommées que `ACOMPTES_PREVUS` levé : la
// production ne les a pas, et une lecture qui les nommerait échouerait. Baissé, la lecture rend `SANS_ACOMPTE_CII` sans
// rien lire — et l'aperçu comme la fenêtre sont ceux d'hier. Le drapeau se lit À L'APPEL, jamais au chargement du module.
//
// Levé : la marque et la date du versement, les reprises des lignes (lues en entier), les factures d'acompte qu'elles
// citent (en entier), la marque, le numéro et la date de la facture qu'un avoir corrige, et le devis lié (`devis_factures`
// puis `devis`). Tout passe par `acompteLu` : une valeur qui n'a pas la forme de sa colonne est ILLISIBLE, jamais un
// « non ». Une lecture refusée ou partielle rend `illisible` avec son motif ; la fonction ne rejette jamais. Le résultat
// porte l'identifiant de la facture lue : l'écran ne l'applique qu'à elle.

/** Ce que la facture lit d'elle-même pour savoir quoi demander. */
export type FactureALire = { id: string; dossier_id: string; type: 'facture' | 'avoir'; facture_origine_id: string | null }

/**
 * La lecture sans aucun appel, le drapeau baissé : ni acompte ni reprise. Levé, `null` — il faut lire. L'écran s'en sert
 * avant le retour de la lecture, pour que rien ne change d'hier tant que les colonnes n'existent pas.
 */
export function acompteSansLecture(factureId: string): LectureAcompte | null {
  return ACOMPTES_PREVUS ? null : { factureId, etat: 'lue', acompte: SANS_ACOMPTE_CII, origine: null, devis: null }
}

const date = (v: unknown): v is string => typeof v === 'string'

/** L'acompte de la facture, lu en base le drapeau levé ; `SANS_ACOMPTE_CII` sans lecture sinon. Ne rejette jamais. */
export async function lireLAcompteDeLaFacture(facture: FactureALire): Promise<LectureAcompte> {
  const factureId = facture.id
  const sans = acompteSansLecture(factureId)
  if (sans !== null) return sans
  const illisible = (motif: string): LectureAcompte => ({ factureId, etat: 'illisible', motif })
  try {
    const dossierId = facture.dossier_id
    const marque = await supabase.from('factures_emises').select('acompte, date_versement_acompte')
      .eq('id', factureId).eq('dossier_id', dossierId).maybeSingle()
    if (marque.error) return illisible(`La marque d’acompte de la facture n’a pas pu être lue (${messageErreur(marque.error, 'refus de la base')}).`)
    if (!marque.data) return illisible('La marque d’acompte de la facture n’a pas pu être lue : la facture n’est pas rendue.')

    const lignes = await lireTout<{ id: string; ordre: number; reprise_facture_id?: unknown }>((debut, fin) =>
      supabase.from('facture_lignes').select('id, ordre, reprise_facture_id', { count: 'exact' })
        .eq('facture_id', factureId).order('ordre').order('id').range(debut, fin),
    )
    if (!lignes.complete) return illisible(`Les reprises d’acompte de la facture n’ont pas pu être lues en entier (${lignes.motif ?? 'lecture incomplète'}).`)

    // La facture qu'un avoir corrige : rendue absente, sa marque est illisible (un objet vide), jamais « pas un acompte ».
    let origineLue: { acompte?: unknown } | null = null
    let origine: FactureCitee | null = null
    if (facture.type === 'avoir' && facture.facture_origine_id) {
      const lue = await supabase.from('factures_emises').select('acompte, numero, date_emission')
        .eq('id', facture.facture_origine_id).eq('dossier_id', dossierId).maybeSingle()
      if (lue.error) return illisible(`La facture que l’avoir corrige n’a pas pu être lue (${messageErreur(lue.error, 'refus de la base')}).`)
      origineLue = lue.data ?? {}
      if (lue.data && date(lue.data.date_emission)) {
        origine = { numero: typeof lue.data.numero === 'string' ? lue.data.numero : null, date_emission: lue.data.date_emission }
      }
    }

    // Les factures d'acompte que les reprises citent, en entier : une citée et pas rendue, `refusEmission` le dit.
    const ids = [...new Set(lignes.lignes.map((l) => l.reprise_facture_id).filter((v): v is string => typeof v === 'string'))]
    let repris: { id: string; numero: string | null; date_emission: string; acompte?: unknown }[] = []
    if (ids.length > 0) {
      const lus = await lireTout<{ id: string; numero: string | null; date_emission: string; acompte?: unknown }>((debut, fin) =>
        supabase.from('factures_emises').select('id, numero, date_emission, acompte', { count: 'exact' })
          .eq('dossier_id', dossierId).in('id', ids).order('id').range(debut, fin),
      )
      if (!lus.complete) return illisible(`Les factures d’acompte reprises n’ont pas pu être lues en entier (${lus.motif ?? 'lecture incomplète'}).`)
      repris = lus.lignes
    }

    // Le devis lié : aucune ligne de lien, la facture n'est tirée d'aucun devis ; un lien rendu dont le devis ne l'est pas,
    // ou sans numéro ni date, est illisible.
    let devis: DevisCite | null = null
    const lien = await supabase.from('devis_factures').select('devis_id')
      .eq('facture_id', factureId).eq('dossier_id', dossierId).maybeSingle()
    if (lien.error) return illisible(`Le devis dont la facture est tirée n’a pas pu être lu (${messageErreur(lien.error, 'refus de la base')}).`)
    if (lien.data) {
      if (typeof lien.data.devis_id !== 'string') return illisible('Le devis dont la facture est tirée n’a pas pu être lu.')
      const lu = await supabase.from('devis').select('numero, date_emission')
        .eq('id', lien.data.devis_id).eq('dossier_id', dossierId).maybeSingle()
      if (lu.error) return illisible(`Le devis dont la facture est tirée n’a pas pu être lu (${messageErreur(lu.error, 'refus de la base')}).`)
      if (!lu.data || typeof lu.data.numero !== 'string' || !date(lu.data.date_emission)) {
        return illisible('Le devis dont la facture est tirée n’a pas pu être lu : son numéro ou sa date manque.')
      }
      devis = { numero: lu.data.numero, date_emission: lu.data.date_emission }
    }

    return {
      factureId,
      etat: 'lue',
      acompte: acompteLu(marque.data, lignes.lignes, origineLue, repris),
      origine,
      devis,
    }
  } catch (erreur) {
    return illisible(`L’acompte de la facture n’a pas pu être lu (${messageErreur(erreur, 'erreur inattendue')}).`)
  }
}
