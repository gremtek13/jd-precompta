import { lireTout, type LectureComplete } from './lectureComplete'
import { messageErreur } from './messageErreur'
import { supabase } from './supabase'
import { PAIEMENTS_ASSURANCE_MALADIE_PREVUS } from './paiementsAssuranceMaladie'
import type { EspaceVentes } from './espaceVentes'
import type { ImportAssuranceMaladie, PaiementAssuranceMaladie } from './types'

// LES PAIEMENTS DE L'ASSURANCE MALADIE, CE QUE L'ÉCRAN LIT (conception 53, lot NOE4 ; le patron : lib/achatsClientLecture.ts).
// Aucune lecture ne rejette : une requête qui lève ou un refus tombent du côté signalé, avec leur motif — jamais une liste
// vide. Chacune se rend AVEC le dossier qu'elle a lu. Rien ne se lit sous `PAIEMENTS_ASSURANCE_MALADIE_PREVUS` baissé : avant
// la migration, les deux tables n'existent pas.
//
// CE QUI EST LU : les imports et les paiements du dossier — des dates, des entiers, une part ; aucune colonne de texte n'existe
// (la migration le tient). Ces lectures ne nourrissent aucun moteur : l'écran les montre, rien d'autre
// (paiementsAssuranceMaladieSansSortie.test.ts tient la liste des fichiers qui nomment les tables).

const COLONNES_IMPORT = 'id, dossier_id, periode_du, periode_au, nombre_de_rejets, montant_rejete_centimes, importe_par, importe_le'
const COLONNES_PAIEMENT = 'id, dossier_id, import_id, date_journee_comptable, regime, caisse, part, montant_centimes, regularisations_centimes, nombre_de_factures'

export type PaiementsLus =
  | { dossierId: string; etat: 'echec'; motif: string }
  | { dossierId: string; etat: 'sans_banque' }
  | {
    dossierId: string; etat: 'lus'
    imports: LectureComplete<ImportAssuranceMaladie>; paiements: LectureComplete<PaiementAssuranceMaladie>
  }

const echec = <T>(motif: string): LectureComplete<T> => ({ lignes: [], complete: false, motif })

/** Une lecture dont une ligne n'est pas du dossier demandé ne se croit pas. */
function duDossier<T extends { dossier_id: string }>(lecture: LectureComplete<T>, dossierId: string): LectureComplete<T> {
  if (!lecture.complete || lecture.lignes.every((l) => l.dossier_id === dossierId)) return lecture
  return echec(lecture.motif ?? 'une ligne rendue n’est pas de ce dossier')
}

/**
 * Les imports et les paiements du dossier. Côté client, la case « Banque » se relit À LA BASE dans la même vague
 * (`droits_sur_le_dossier`) : une case retirée entre-temps rendrait les deux tables VIDES sans erreur, et l'écran dirait
 * « aucun import » d'un dossier qui en a. Sans la case, rien de ce qui a été lu n'est rendu.
 */
export async function lireLesPaiementsAssuranceMaladie(dossierId: string, espace: EspaceVentes): Promise<PaiementsLus> {
  if (!PAIEMENTS_ASSURANCE_MALADIE_PREVUS) {
    return { dossierId, etat: 'echec', motif: 'les paiements de l’assurance maladie ne sont pas encore en base' }
  }
  try {
    const [droits, imports, paiements] = await Promise.all([
      espace === 'client' ? supabase.rpc('droits_sur_le_dossier', { p_dossier_id: dossierId }) : Promise.resolve(null),
      lireTout<ImportAssuranceMaladie>((debut, fin) =>
        supabase.from('imports_assurance_maladie').select(COLONNES_IMPORT, { count: 'exact' })
          .eq('dossier_id', dossierId).order('importe_le').order('id').range(debut, fin)),
      lireTout<PaiementAssuranceMaladie>((debut, fin) =>
        supabase.from('paiements_assurance_maladie').select(COLONNES_PAIEMENT, { count: 'exact' })
          .eq('dossier_id', dossierId).order('date_journee_comptable').order('id').range(debut, fin)),
    ])
    if (droits !== null) {
      if (droits.error) {
        return { dossierId, etat: 'echec', motif: `ton accès à ta banque n’a pas pu être vérifié (${messageErreur(droits.error, 'droits illisibles')})` }
      }
      const data: unknown = droits.data
      if (data === null || typeof data !== 'object' || Array.isArray(data)) {
        return { dossierId, etat: 'echec', motif: 'ton accès à ta banque n’a pas pu être vérifié (droits illisibles)' }
      }
      if ((data as Record<string, unknown>).banque !== true) return { dossierId, etat: 'sans_banque' }
    }
    return {
      dossierId, etat: 'lus',
      imports: imports.complete ? duDossier(imports, dossierId) : imports,
      paiements: paiements.complete ? duDossier(paiements, dossierId) : paiements,
    }
  } catch (erreur) {
    return {
      dossierId, etat: 'echec',
      motif: messageErreur(erreur, espace === 'client'
        ? 'tes paiements de l’assurance maladie n’ont pas pu être lus'
        : 'les paiements de l’assurance maladie n’ont pas pu être lus'),
    }
  }
}
