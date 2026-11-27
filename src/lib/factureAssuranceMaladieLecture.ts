import { lireTout, type LectureComplete } from './lectureComplete'
import { messageErreur } from './messageErreur'
import { supabase } from './supabase'
import { FACTURES_ASSURANCE_MALADIE_PREVUES } from './importDuFactureAssuranceMaladie'
import type { EspaceVentes } from './espaceVentes'
import type { FactureAssuranceMaladie, ImportFacturesAssuranceMaladie } from './types'

// LE FACTURÉ À L'ASSURANCE MALADIE, CE QUE L'ÉCRAN LIT (conception 59, lot BOR4 ; le patron : lib/paiementsAssuranceMaladieLecture.ts).
// Aucune lecture ne rejette : une requête qui lève ou un refus tombent du côté signalé, avec leur motif — jamais une liste vide.
// Chacune se rend AVEC le dossier qu'elle a lu. Rien ne se lit sous `FACTURES_ASSURANCE_MALADIE_PREVUES` baissé.
//
// CE QUI EST LU : les imports du facturé et leurs totaux — des dates, des entiers, une part ; aucune colonne de texte n'existe
// (la migration le tient). Le registre des lots et la clé du dossier ne se lisent pas : aucune policy ne les ouvre. Ces lectures
// ne nourrissent aucun moteur : l'écran les montre, rien d'autre (paiementsAssuranceMaladieSansSortie.test.ts tient la liste
// des fichiers qui nomment les tables).

const COLONNES_IMPORT = 'id, dossier_id, premier_lot_le, dernier_lot_le, nombre_de_lots, nombre_de_factures, importe_par, importe_le'
const COLONNES_TOTAL = 'id, dossier_id, import_id, date_creation_lot, part, regime, caisse, organisme_complementaire, montant_centimes, nombre_de_lots, nombre_de_factures'

export type FactureLu =
  | { dossierId: string; etat: 'echec'; motif: string }
  | { dossierId: string; etat: 'sans_banque' }
  | {
    dossierId: string; etat: 'lus'
    imports: LectureComplete<ImportFacturesAssuranceMaladie>; totaux: LectureComplete<FactureAssuranceMaladie>
  }

const echec = <T>(motif: string): LectureComplete<T> => ({ lignes: [], complete: false, motif })

/** Une lecture dont une ligne n'est pas du dossier demandé ne se croit pas. */
function duDossier<T extends { dossier_id: string }>(lecture: LectureComplete<T>, dossierId: string): LectureComplete<T> {
  if (!lecture.complete || lecture.lignes.every((l) => l.dossier_id === dossierId)) return lecture
  return echec(lecture.motif ?? 'une ligne rendue n’est pas de ce dossier')
}

/**
 * Les imports du facturé du dossier et leurs totaux. Côté client, la case « Banque » se relit À LA BASE dans la même vague
 * (`droits_sur_le_dossier`) : une case retirée entre-temps rendrait les deux tables VIDES sans erreur, et l'écran dirait
 * « aucun import » d'un dossier qui en a. Sans la case, rien de ce qui a été lu n'est rendu.
 */
export async function lireLeFactureAssuranceMaladie(dossierId: string, espace: EspaceVentes): Promise<FactureLu> {
  if (!FACTURES_ASSURANCE_MALADIE_PREVUES) {
    return { dossierId, etat: 'echec', motif: 'le facturé à l’assurance maladie ne s’affiche pas encore' }
  }
  try {
    const [droits, imports, totaux] = await Promise.all([
      espace === 'client' ? supabase.rpc('droits_sur_le_dossier', { p_dossier_id: dossierId }) : Promise.resolve(null),
      lireTout<ImportFacturesAssuranceMaladie>((debut, fin) =>
        supabase.from('imports_factures_assurance_maladie').select(COLONNES_IMPORT, { count: 'exact' })
          .eq('dossier_id', dossierId).order('importe_le').order('id').range(debut, fin)),
      lireTout<FactureAssuranceMaladie>((debut, fin) =>
        supabase.from('factures_assurance_maladie').select(COLONNES_TOTAL, { count: 'exact' })
          .eq('dossier_id', dossierId).order('date_creation_lot').order('id').range(debut, fin)),
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
      totaux: totaux.complete ? duDossier(totaux, dossierId) : totaux,
    }
  } catch (erreur) {
    return {
      dossierId, etat: 'echec',
      motif: messageErreur(erreur, espace === 'client'
        ? 'tes bordereaux importés n’ont pas pu être lus'
        : 'les bordereaux importés n’ont pas pu être lus'),
    }
  }
}

/**
 * UN IMPORT DU FACTURÉ EXISTE-T-IL ? (BOR6TQ1-Q1 (A) : la ligne de « Mes pièces », lib/consigneDuBordereau.ts.) Une ligne de
 * l'import, lue pour le dossier demandé, le prouve : vrai. Tout le reste est faux — pas « aucun » : une lecture refusée, en
 * échec, ou que la RLS rend vide (un client sans « Banque » ne lit pas la table) ne dit pas qu'il n'y en a pas ; l'appelant ne
 * s'en sert que pour OFFRIR une ligne, jamais pour affirmer l'absence. Une ligne seule, voulue (`limit(1)`). Ne rejette jamais.
 */
export async function unImportDuFactureLu(dossierId: string): Promise<boolean> {
  if (!FACTURES_ASSURANCE_MALADIE_PREVUES) return false
  try {
    const { data, error } = await supabase.from('imports_factures_assurance_maladie').select('id, dossier_id')
      .eq('dossier_id', dossierId).limit(1).maybeSingle()
    return !error && data !== null && (data as { dossier_id?: unknown }).dossier_id === dossierId
  } catch {
    return false
  }
}
