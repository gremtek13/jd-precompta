import { lireLaCaisse } from './caisseLecture'
import type { DonneesDeLaCaisse, EspecesLues, MouvementClasse } from './caisseEcran'
import type { EncaissementDeLaCaisse, FactureDeLaCaisse } from './caisse'
import { lireTout, type LectureComplete } from './lectureComplete'
import { messageErreur } from './messageErreur'
import { supabase } from './supabase'
import type { ANouveau, Categorie } from './types'

// CE QUE L'ONGLET CAISSE LIT D'UN DOSSIER (ligne 26.6, étape C4 ; modèle : lib/ecrituresVentesFactureesLecture.ts). La caisse se
// rejoue sur ce qui est lu (lib/caisse.ts) : ses opérations — retirées et remplacées comprises —, la reprise ENTIÈRE (l'ouverture
// du dossier, le 53 des à-nouveaux), les mouvements du relevé classés sur un compte de bilan (ceux de la caisse parmi eux), les
// catégories (du dossier et communes : les natures d'une recette), et — pour un dossier qui a basculé SEULEMENT — les espèces
// des factures sources : leurs encaissements et ces factures. Un dossier qui n'a pas basculé n'en compte aucune (la base garde
// qu'aucune de ses factures n'est source).
//
// Chaque collection EN ENTIER, par `lireTout`. LE TOUT OU RIEN : une seule lecture partielle, refusée ou rompue, et la caisse ne
// se rejoue pas — l'état le dit, avec le motif de la première qui a manqué, et l'écran n'offre AUCUN geste. GARDÉE AVEC LE DOSSIER :
// chaque ligne rendue qui porte un dossier est confrontée à celui qu'on a demandé, et le résultat se rend avec son identifiant
// (`DossierDetail` reste monté d'un dossier à l'autre). Ce module ne rejette jamais.
//
// LE DRAPEAU BAISSÉ (`CAISSE_EXPORTEE`), elle ne lit rien : `lireLaCaisse` n'a pas touché au réseau, et la caisse est ABSENTE.

export type LectureDeLaCaisseDuDossier =
  /** La table n'est pas en base : rien n'a été lu, et rien ne pouvait l'être. */
  | { dossierId: string; etat: 'absente' }
  | { dossierId: string; etat: 'incomplete'; motif: string }
  | { dossierId: string; etat: 'lue'; donnees: DonneesDeLaCaisse }

/** Le nom de chaque collection, dans l'ordre de la lecture : c'est lui que le motif d'un manque nomme. */
const NOMS = [
  'les catégories', 'la reprise (à-nouveaux)', 'les mouvements classés sur un compte de bilan', 'les factures sources',
  'les encaissements des factures',
] as const

// Les colonnes que le module lit, chaîne pour chaîne : le compilateur confronte chacune à son type.
export const COLONNES_MOUVEMENTS_DE_LA_CAISSE = 'id, dossier_id, date, montant, libelle, compte_bilan'
export const COLONNES_FACTURES_DE_LA_CAISSE = 'id, dossier_id, numero, source_de_la_vente'
export const COLONNES_ENCAISSEMENTS_DE_LA_CAISSE =
  'id, dossier_id, facture_id, date_encaissement, montant, moyen, ligne_bancaire_id, annule_id, retire_le'

type MouvementLu = MouvementClasse & { dossier_id: string }
type FactureLue = FactureDeLaCaisse & { dossier_id: string }
type EncaissementLu = EncaissementDeLaCaisse & { dossier_id: string }

function horsDuDossier<T extends { dossier_id: string | null }>(nom: string, lecture: LectureComplete<T>, dossierId: string): string | null {
  return lecture.lignes.every((l) => l.dossier_id === dossierId || l.dossier_id === null && nom === NOMS[0])
    ? null : `${nom} : une ligne rendue n'est pas de ce dossier`
}

/** La caisse du dossier et ce que son écran en rejoue, lus en entier ; ou « incomplète », avec le motif. Ne rejette jamais. */
export async function lireLaCaisseDuDossier(dossierId: string, ventesParLesFactures: boolean): Promise<LectureDeLaCaisseDuDossier> {
  const caisse = await lireLaCaisse(dossierId)
  if (!caisse.enBase) return { dossierId, etat: 'absente' }
  if (!caisse.complete) return { dossierId, etat: 'incomplete', motif: `les opérations de la caisse : ${caisse.motif ?? 'lecture incomplète'}` }
  if (caisse.dossierId !== dossierId || caisse.lignes.some((o) => o.dossier_id !== dossierId)) {
    return { dossierId, etat: 'incomplete', motif: 'les opérations de la caisse : une ligne rendue n’est pas de ce dossier' }
  }
  try {
    const [categories, ouvertures, mouvements, factures, encaissements] = await Promise.all([
      // Celles du dossier ET celles du cabinet (`dossier_id` nul), comme les autres onglets : un filtre sur le seul dossier les
      // écarterait presque toutes, et aucune recette n'aurait de nature.
      lireTout<Categorie>((debut, fin) =>
        supabase.from('categories').select('*', { count: 'exact' })
          .or(`dossier_id.eq.${dossierId},dossier_id.is.null`).order('ordre').order('id').range(debut, fin),
      ),
      lireTout<ANouveau>((debut, fin) =>
        supabase.from('a_nouveaux').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).order('compte').order('id').range(debut, fin),
      ),
      lireTout<MouvementLu>((debut, fin) =>
        supabase.from('lignes_bancaires').select(COLONNES_MOUVEMENTS_DE_LA_CAISSE, { count: 'exact' })
          .eq('dossier_id', dossierId).not('compte_bilan', 'is', null).order('date').order('id').range(debut, fin),
      ),
      // Les factures SOURCES seulement : l'espèce d'une facture qui n'est pas source ne s'écrit pas (VF2-Q2), la caisse ne la
      // compte pas. Aucune lecture pour un dossier qui n'a pas basculé.
      ventesParLesFactures
        ? lireTout<FactureLue>((debut, fin) =>
          supabase.from('factures_emises').select(COLONNES_FACTURES_DE_LA_CAISSE, { count: 'exact' })
            .eq('dossier_id', dossierId).eq('source_de_la_vente', true).order('id').range(debut, fin),
        )
        : Promise.resolve<LectureComplete<FactureLue>>({ lignes: [], complete: true, motif: null }),
      ventesParLesFactures
        ? lireTout<EncaissementLu>((debut, fin) =>
          supabase.from('encaissements_factures').select(COLONNES_ENCAISSEMENTS_DE_LA_CAISSE, { count: 'exact' })
            .eq('dossier_id', dossierId).order('id').range(debut, fin),
        )
        : Promise.resolve<LectureComplete<EncaissementLu>>({ lignes: [], complete: true, motif: null }),
    ])
    const manque = [categories, ouvertures, mouvements, factures, encaissements]
      .map((l, i) => (l.complete ? null : `${NOMS[i]} : ${l.motif ?? 'lecture incomplète'}`))
      .find((m) => m !== null)
    if (manque != null) return { dossierId, etat: 'incomplete', motif: manque }
    const etranger = horsDuDossier(NOMS[0], categories, dossierId) ?? horsDuDossier(NOMS[1], ouvertures, dossierId)
      ?? horsDuDossier(NOMS[2], mouvements, dossierId) ?? horsDuDossier(NOMS[3], factures, dossierId)
      ?? horsDuDossier(NOMS[4], encaissements, dossierId)
    if (etranger !== null) return { dossierId, etat: 'incomplete', motif: etranger }
    const especes: EspecesLues = ventesParLesFactures
      ? {
        etat: 'lues',
        encaissements: encaissements.lignes.map(({ id, facture_id, date_encaissement, montant, moyen, ligne_bancaire_id, annule_id, retire_le }) =>
          ({ id, facture_id, date_encaissement, montant, moyen, ligne_bancaire_id, annule_id, retire_le })),
        factures: factures.lignes.map(({ id, numero, source_de_la_vente }) => ({ id, numero, source_de_la_vente })),
      }
      : { etat: 'sans_objet' }
    return {
      dossierId,
      etat: 'lue',
      donnees: {
        operations: caisse.lignes,
        ouvertures: ouvertures.lignes,
        mouvements: mouvements.lignes.map(({ id, date, montant, libelle, compte_bilan }) => ({ id, date, montant, libelle, compte_bilan })),
        especes,
        categories: categories.lignes,
      },
    }
  } catch (erreur) {
    return { dossierId, etat: 'incomplete', motif: messageErreur(erreur, 'la lecture de la caisse a échoué') }
  }
}

/** La reprise d'un dossier, lue en entier, pour l'onglet Banque (ligne 26.6, C4) ; le drapeau baissé, aucun appel au réseau. */
export interface LectureDeLaReprise {
  dossierId: string
  lignes: ANouveau[]
  complete: boolean
  motif: string | null
}

/** Elle ne rejette jamais ; la caisse hors de la base, elle ne lit rien (`null`) : la reprise n'y sert à rien. */
export async function lireLaRepriseDeLaCaisse(dossierId: string, caisseEnBase: boolean): Promise<LectureDeLaReprise | null> {
  if (!caisseEnBase) return null
  try {
    const lecture = await lireTout<ANouveau>((debut, fin) =>
      supabase.from('a_nouveaux').select('*', { count: 'exact' }).eq('dossier_id', dossierId).order('compte').order('id').range(debut, fin),
    )
    const etranger = lecture.lignes.some((l) => l.dossier_id !== dossierId)
    return {
      dossierId,
      lignes: lecture.lignes,
      complete: lecture.complete && !etranger,
      motif: etranger ? 'une ligne rendue n’est pas de ce dossier' : lecture.motif,
    }
  } catch (erreur) {
    return { dossierId, lignes: [], complete: false, motif: messageErreur(erreur, 'la lecture de la reprise a échoué') }
  }
}
