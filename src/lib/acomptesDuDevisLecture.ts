import { supabase } from './supabase'
import { ACOMPTES_PREVUS } from './devis'
import { lireTout } from './lectureComplete'
import { messageErreur } from './messageErreur'
import type { AcomptesLus, FactureDuDevis, LienDuDevis, LigneDAcompte } from './acomptesDuDevis'

// LES ACOMPTES DES DEVIS D'UN DOSSIER, LUS EN ENTIER (espace client, étape P5b5a ; conception : HISTORIQUE.md, « L'ACOMPTE
// D'UN DEVIS : LA CONCEPTION (P5B) »). Ce que la vue « Devis » juge avant d'offrir « Facturer un acompte » et « Facturer le
// solde » (lib/acomptesDuDevis.ts) : les liens des devis avec leur RÔLE, les factures et avoirs du dossier avec la MARQUE
// d'acompte (l'état de chaque facture tirée : brouillon, validée, créditée en entier), les lignes des factures d'acompte
// validées, et le modèle comptable du dossier (P5B-Q3).
//
// LE DRAPEAU. `devis_factures.role` et `factures_emises.acompte` sont posés par la migration `acomptes_des_devis`,
// PRÉPARÉE et pas appliquée : la production ne les a pas, et une lecture qui les nommerait échouerait. Baissé (lu À
// L'APPEL, jamais au chargement du module), rien n'est lu (`etat: 'sans'`), et la vue est celle d'hier au caractère près.
//
// Levé : chaque collection par `lireTout` (tri TOTAL terminé par la clé primaire, compte annoncé), le dossier par sa clé.
// Une valeur qui n'a pas la forme de sa colonne (un rôle inconnu, une marque qui n'est pas un booléen, un modèle comptable
// inconnu) rend la lecture ILLISIBLE, jamais un « non » ; une ligne d'un autre dossier aussi. Elle ne rejette jamais, et se
// rend avec le dossier lu : la page d'un dossier reste montée quand on passe à un autre.

export type LectureDesAcomptes =
  | { dossierId: string; etat: 'sans' }
  | ({ dossierId: string; etat: 'lue' } & AcomptesLus)
  | { dossierId: string; etat: 'illisible'; motif: string }

export const COLONNES_LIENS_ACOMPTES = 'id, dossier_id, devis_id, facture_id, cree_le, role'
export const COLONNES_FACTURES_ACOMPTES =
  'id, dossier_id, numero, statut, type, date_emission, montant_ttc, acompte, facture_origine_id'
export const COLONNES_LIGNES_ACOMPTES = 'id, facture_id, ordre, quantite, prix_unitaire_ht, taux_tva, nature'

type Brut = Record<string, unknown>

const texte = (v: unknown): v is string => typeof v === 'string'
const nombre = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

export async function lireLesAcomptesDesDevis(dossierId: string): Promise<LectureDesAcomptes> {
  if (!ACOMPTES_PREVUS) return { dossierId, etat: 'sans' }
  const illisible = (motif: string): LectureDesAcomptes => ({ dossierId, etat: 'illisible', motif })
  try {
    const [liens, factures, dossier] = await Promise.all([
      lireTout<Brut>((debut, fin) =>
        supabase.from('devis_factures').select(COLONNES_LIENS_ACOMPTES, { count: 'exact' })
          .eq('dossier_id', dossierId).order('cree_le').order('id').range(debut, fin),
      ),
      lireTout<Brut>((debut, fin) =>
        supabase.from('factures_emises').select(COLONNES_FACTURES_ACOMPTES, { count: 'exact' })
          .eq('dossier_id', dossierId).order('id').range(debut, fin),
      ),
      // Une seule ligne, par sa clé : `maybeSingle` (une collection passerait par `lireTout`, lecturesPaginees.test.ts).
      supabase.from('dossiers').select('mode_comptable').eq('id', dossierId).maybeSingle(),
    ])
    if (!liens.complete) return illisible(`les liens des devis à leurs factures n’ont pas été lus en entier (${liens.motif ?? 'lecture incomplète'})`)
    if (!factures.complete) return illisible(`les factures du dossier n’ont pas été lues en entier (${factures.motif ?? 'lecture incomplète'})`)
    if (dossier.error) return illisible(`le modèle comptable du dossier n’a pas pu être lu (${messageErreur(dossier.error, 'refus de la base')})`)
    const mode = (dossier.data as Brut | null)?.mode_comptable
    if (mode !== 'tresorerie' && mode !== 'engagement') return illisible('le modèle comptable du dossier n’a pas pu être lu')
    if ([...liens.lignes, ...factures.lignes].some((l) => l.dossier_id !== dossierId)) {
      return illisible('une ligne rendue n’est pas de ce dossier')
    }

    const liensLus: LienDuDevis[] = []
    for (const l of liens.lignes) {
      if (!texte(l.id) || !texte(l.devis_id) || !texte(l.facture_id) || !texte(l.cree_le) || (l.role !== 'acompte' && l.role !== 'finale')) {
        return illisible('le rôle du lien d’un devis à sa facture n’a pas pu être lu')
      }
      liensLus.push({ id: l.id, devis_id: l.devis_id, facture_id: l.facture_id, cree_le: l.cree_le, role: l.role })
    }
    const facturesLues: FactureDuDevis[] = []
    for (const f of factures.lignes) {
      if (!texte(f.id) || !texte(f.date_emission) || !nombre(f.montant_ttc) || typeof f.acompte !== 'boolean'
        || (f.statut !== 'brouillon' && f.statut !== 'validee') || (f.type !== 'facture' && f.type !== 'avoir')) {
        return illisible('la marque d’acompte d’une facture n’a pas pu être lue')
      }
      facturesLues.push({
        id: f.id, numero: texte(f.numero) ? f.numero : null, statut: f.statut, type: f.type, date_emission: f.date_emission,
        montant_ttc: f.montant_ttc, acompte: f.acompte, facture_origine_id: texte(f.facture_origine_id) ? f.facture_origine_id : null,
      })
    }

    // Les lignes des factures d'acompte validées, en entier : ce que la finale reprend et le reste de chaque devis.
    const ids = facturesLues.filter((f) => f.acompte && f.statut === 'validee').map((f) => f.id)
    const lignesLues: LigneDAcompte[] = []
    if (ids.length > 0) {
      const lignes = await lireTout<Brut>((debut, fin) =>
        supabase.from('facture_lignes').select(COLONNES_LIGNES_ACOMPTES, { count: 'exact' })
          .in('facture_id', ids).order('facture_id').order('ordre').order('id').range(debut, fin),
      )
      if (!lignes.complete) return illisible(`les lignes des acomptes n’ont pas été lues en entier (${lignes.motif ?? 'lecture incomplète'})`)
      for (const l of lignes.lignes) {
        if (!texte(l.facture_id) || !nombre(l.ordre) || !nombre(l.quantite) || !nombre(l.prix_unitaire_ht) || !nombre(l.taux_tva)
          || (l.nature != null && l.nature !== 'biens' && l.nature !== 'services')) {
          return illisible('une ligne d’acompte n’a pas pu être lue')
        }
        lignesLues.push({
          facture_id: l.facture_id, ordre: l.ordre, quantite: l.quantite, prix_unitaire_ht: l.prix_unitaire_ht, taux_tva: l.taux_tva,
          nature: l.nature ?? null,
        })
      }
    }
    return { dossierId, etat: 'lue', liens: liensLus, factures: facturesLues, lignes: lignesLues, mode }
  } catch (e) {
    return illisible(messageErreur(e, 'les acomptes des devis n’ont pas pu être lus'))
  }
}
