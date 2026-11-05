import { supabase } from './supabase'
import { lireTout } from './lectureComplete'
import { messageErreur } from './messageErreur'
import { lireLesAcomptesDesDevis } from './acomptesDuDevisLecture'
import type { DevisDesFactures, LectureDesAcomptesDesFactures, LigneDeFinale } from './acomptesDesFactures'

// LES ACOMPTES DES FACTURES D'UN DOSSIER, LUS EN ENTIER (espace client, étape P5b5b ; lib/acomptesDesFactures.ts). Ce que
// l'onglet des factures juge avant d'offrir un geste sur une facture d'acompte ou une finale : la lecture de la vue « Devis »
// (lib/acomptesDuDevisLecture.ts : les liens et leur rôle, les factures et leur marque, les lignes des acomptes validés, le
// modèle comptable), puis les devis liés (leur numéro et leurs lignes), la date du versement des factures d'acompte, et les
// lignes des factures finales et de leurs avoirs (leurs reprises).
//
// LE DRAPEAU : baissé (lu À L'APPEL, par la lecture de la vue « Devis »), rien n'est lu (`etat: 'sans'`). Levé, chaque
// collection par `lireTout` ; une valeur qui n'a pas la forme de sa colonne rend la lecture ILLISIBLE, jamais un « non ». Elle
// ne rejette jamais, et se rend avec le dossier lu.

export const COLONNES_DEVIS_DES_FACTURES = 'id, dossier_id, numero, lignes'
export const COLONNES_VERSEMENTS = 'id, dossier_id, date_versement_acompte'
export const COLONNES_LIGNES_DES_FINALES = 'id, facture_id, ordre, quantite, prix_unitaire_ht, taux_tva, nature, reprise_facture_id'

type Brut = Record<string, unknown>
const texte = (v: unknown): v is string => typeof v === 'string'
const nombre = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

export async function lireLesAcomptesDesFactures(dossierId: string): Promise<LectureDesAcomptesDesFactures> {
  const base = await lireLesAcomptesDesDevis(dossierId)
  if (base.etat !== 'lue') return base
  const illisible = (motif: string): LectureDesAcomptesDesFactures => ({ dossierId, etat: 'illisible', motif })
  try {
    const devisIds = [...new Set(base.liens.map((l) => l.devis_id))]
    const finales = new Set(base.liens.filter((l) => l.role === 'finale').map((l) => l.facture_id))
    const finalesEtAvoirs = base.factures
      .filter((f) => finales.has(f.id) || (f.type === 'avoir' && f.facture_origine_id != null && finales.has(f.facture_origine_id)))
      .map((f) => f.id)
    const acomptes = base.factures.filter((f) => f.acompte).map((f) => f.id)
    const vide = { lignes: [] as Brut[], complete: true, motif: null as string | null }
    const [devis, versements, lignes] = await Promise.all([
      devisIds.length === 0 ? vide : lireTout<Brut>((debut, fin) =>
        supabase.from('devis').select(COLONNES_DEVIS_DES_FACTURES, { count: 'exact' })
          .eq('dossier_id', dossierId).in('id', devisIds).order('id').range(debut, fin),
      ),
      acomptes.length === 0 ? vide : lireTout<Brut>((debut, fin) =>
        supabase.from('factures_emises').select(COLONNES_VERSEMENTS, { count: 'exact' })
          .eq('dossier_id', dossierId).in('id', acomptes).order('id').range(debut, fin),
      ),
      finalesEtAvoirs.length === 0 ? vide : lireTout<Brut>((debut, fin) =>
        supabase.from('facture_lignes').select(COLONNES_LIGNES_DES_FINALES, { count: 'exact' })
          .in('facture_id', finalesEtAvoirs).order('facture_id').order('ordre').order('id').range(debut, fin),
      ),
    ])
    if (!devis.complete) return illisible(`les devis des factures n’ont pas été lus en entier (${devis.motif ?? 'lecture incomplète'})`)
    if (!versements.complete) return illisible(`la date du versement des acomptes n’a pas été lue en entier (${versements.motif ?? 'lecture incomplète'})`)
    if (!lignes.complete) return illisible(`les lignes des factures finales n’ont pas été lues en entier (${lignes.motif ?? 'lecture incomplète'})`)
    if ([...devis.lignes, ...versements.lignes].some((l) => l.dossier_id !== dossierId)) return illisible('une ligne rendue n’est pas de ce dossier')

    const devisLus: DevisDesFactures[] = []
    for (const d of devis.lignes) {
      const ls = d.lignes
      if (!texte(d.id) || (d.numero != null && !texte(d.numero)) || !Array.isArray(ls)
        || ls.some((l: Brut) => !texte(l?.designation) || !nombre(l.quantite) || !nombre(l.prix_unitaire_ht) || !nombre(l.taux_tva))) {
        return illisible('les lignes d’un devis n’ont pas pu être lues')
      }
      devisLus.push({
        id: d.id, numero: texte(d.numero) ? d.numero : null,
        lignes: (ls as Brut[]).map((l) => ({
          designation: l.designation as string, quantite: l.quantite as number, prix_unitaire_ht: l.prix_unitaire_ht as number, taux_tva: l.taux_tva as number,
        })),
      })
    }
    const versementsLus: { facture_id: string; date_versement_acompte: string | null }[] = []
    for (const v of versements.lignes) {
      if (!texte(v.id) || (v.date_versement_acompte !== null && !texte(v.date_versement_acompte))) return illisible('la date du versement d’un acompte n’a pas pu être lue')
      versementsLus.push({ facture_id: v.id, date_versement_acompte: v.date_versement_acompte as string | null })
    }
    const lignesLues: LigneDeFinale[] = []
    for (const l of lignes.lignes) {
      if (!texte(l.facture_id) || !nombre(l.ordre) || !nombre(l.quantite) || !nombre(l.prix_unitaire_ht) || !nombre(l.taux_tva)
        || (l.nature != null && l.nature !== 'biens' && l.nature !== 'services')
        || (l.reprise_facture_id !== null && !texte(l.reprise_facture_id))) {
        return illisible('une ligne d’une facture finale n’a pas pu être lue')
      }
      lignesLues.push({
        facture_id: l.facture_id, ordre: l.ordre, quantite: l.quantite, prix_unitaire_ht: l.prix_unitaire_ht, taux_tva: l.taux_tva,
        nature: (l.nature as LigneDeFinale['nature']) ?? null, reprise_facture_id: l.reprise_facture_id as string | null,
      })
    }
    return { ...base, devis: devisLus, versements: versementsLus, lignesDesFinales: lignesLues }
  } catch (e) {
    return illisible(messageErreur(e, 'les acomptes des factures n’ont pas pu être lus'))
  }
}
