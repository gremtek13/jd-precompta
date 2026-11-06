import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { lireTout, type TrancheLue } from './lectureComplete'
import { messageErreur } from './messageErreur'
import { ajouterJours } from './format'
import { ACCES_EN_COURS, type AccesDuDossier } from './auteursVentes'
import { lireLesAccesDuDossier } from './auteursVentesLecture'
import {
  debutDeLaFenetre, type GenreDuJournal, type LectureDUneSource, type LigneDuJournal, type SourcesDuJournal,
} from './journalDeLEspaceClient'

// LES SOURCES DU JOURNAL DE L'ESPACE CLIENT, LUES POUR LA CARTE P10 DE LA VUE D'ENSEMBLE (étape B9b ; la règle est dans
// lib/journalDeLEspaceClient.ts, pur). Le cabinet seul : chaque table lue ici lui est ouverte par `admin_du_dossier`, comme
// à ses onglets — aucune policy neuve, aucune écriture.
//
// Une lecture par colonne d'auteur, bornée à la fenêtre par son instant (`gte`), d'un jour plus large que la fenêtre : le
// module tranche au jour de Paris, la base ne lit qu'un sur-ensemble. Chaque collection passe par `lireTout` (tri TOTAL
// terminé par la clé primaire, `id` pour toutes) ; une lecture partielle, refusée ou qui LÈVE tombe du côté signalé, jamais
// une liste vide. La lecture ne rejette jamais, et elle est GARDÉE avec le dossier et le jour pour lesquels elle a été faite.

type Lue = Record<string, unknown>

const texteOuNul = (v: unknown): string | null => (typeof v === 'string' ? v : null)

/** Une source : la lecture entière, puis chaque ligne réduite à ce que le journal dit. */
async function lireUneSource(
  tranche: (debut: number, fin: number) => PromiseLike<TrancheLue<Lue>>,
  auteur: string, le: string, reference?: string,
): Promise<LectureDUneSource> {
  try {
    const lecture = await lireTout<Lue>(tranche)
    if (!lecture.complete) return { etat: 'partielle', motif: lecture.motif ?? 'lecture incomplète' }
    const lignes: LigneDuJournal[] = lecture.lignes.map((l) => ({
      id: String(l.id),
      auteur: texteOuNul(l[auteur]),
      le: texteOuNul(l[le]),
      reference: reference === undefined ? null : texteOuNul(l[reference]),
    }))
    return { etat: 'lue', lignes }
  } catch (e) {
    return { etat: 'partielle', motif: messageErreur(e, 'la lecture a échoué') }
  }
}

/** Les vingt-six sources du journal, pour le dossier, depuis `borne` (AAAA-MM-JJ, un jour avant la fenêtre). */
export async function lireLesSourcesDuJournal(dossierId: string, borne: string): Promise<SourcesDuJournal> {
  const d = dossierId
  const lectures: Record<GenreDuJournal, Promise<LectureDUneSource>> = {
    facture_creee: lireUneSource((debut, fin) => supabase.from('factures_emises')
      .select('id, created_by, created_at', { count: 'exact' }).eq('dossier_id', d).gte('created_at', borne)
      .order('created_at').order('id').range(debut, fin), 'created_by', 'created_at'),
    facture_validee: lireUneSource((debut, fin) => supabase.from('factures_emises')
      .select('id, numero, valide_par, validated_at', { count: 'exact' }).eq('dossier_id', d).gte('validated_at', borne)
      .order('validated_at').order('id').range(debut, fin), 'valide_par', 'validated_at', 'numero'),
    facture_transmise: lireUneSource((debut, fin) => supabase.from('transmissions_factures')
      .select('id, cree_par, cree_le', { count: 'exact' }).eq('dossier_id', d).gte('cree_le', borne)
      .order('cree_le').order('id').range(debut, fin), 'cree_par', 'cree_le'),
    encaissement_enregistre: lireUneSource((debut, fin) => supabase.from('encaissements_factures')
      .select('id, cree_par, cree_le', { count: 'exact' }).eq('dossier_id', d).gte('cree_le', borne)
      .order('cree_le').order('id').range(debut, fin), 'cree_par', 'cree_le'),
    encaissement_retire: lireUneSource((debut, fin) => supabase.from('encaissements_factures')
      .select('id, retire_par, retire_le', { count: 'exact' }).eq('dossier_id', d).gte('retire_le', borne)
      .order('retire_le').order('id').range(debut, fin), 'retire_par', 'retire_le'),
    encaissement_declare: lireUneSource((debut, fin) => supabase.from('transmissions_encaissements')
      .select('id, cree_par, cree_le', { count: 'exact' }).eq('dossier_id', d).gte('cree_le', borne)
      .order('cree_le').order('id').range(debut, fin), 'cree_par', 'cree_le'),
    statut_releve: lireUneSource((debut, fin) => supabase.from('statuts_factures_recus')
      .select('id, lu_par, lu_le', { count: 'exact' }).eq('dossier_id', d).gte('lu_le', borne)
      .order('lu_le').order('id').range(debut, fin), 'lu_par', 'lu_le'),
    devis_emis: lireUneSource((debut, fin) => supabase.from('devis')
      .select('id, numero, emis_par, emis_le', { count: 'exact' }).eq('dossier_id', d).gte('emis_le', borne)
      .order('emis_le').order('id').range(debut, fin), 'emis_par', 'emis_le', 'numero'),
    devis_repondu: lireUneSource((debut, fin) => supabase.from('devis')
      .select('id, reponse, decide_par, decide_le', { count: 'exact' }).eq('dossier_id', d).gte('decide_le', borne)
      .order('decide_le').order('id').range(debut, fin), 'decide_par', 'decide_le', 'reponse'),
    article_cree: lireUneSource((debut, fin) => supabase.from('articles')
      .select('id, cree_par, cree_le', { count: 'exact' }).eq('dossier_id', d).gte('cree_le', borne)
      .order('cree_le').order('id').range(debut, fin), 'cree_par', 'cree_le'),
    article_modifie: lireUneSource((debut, fin) => supabase.from('articles')
      .select('id, modifie_par, modifie_le', { count: 'exact' }).eq('dossier_id', d).gte('modifie_le', borne)
      .order('modifie_le').order('id').range(debut, fin), 'modifie_par', 'modifie_le'),
    article_retire: lireUneSource((debut, fin) => supabase.from('articles')
      .select('id, retire_par, retire_le', { count: 'exact' }).eq('dossier_id', d).gte('retire_le', borne)
      .order('retire_le').order('id').range(debut, fin), 'retire_par', 'retire_le'),
    contact_cree: lireUneSource((debut, fin) => supabase.from('contacts')
      .select('id, cree_par, cree_le', { count: 'exact' }).eq('dossier_id', d).gte('cree_le', borne)
      .order('cree_le').order('id').range(debut, fin), 'cree_par', 'cree_le'),
    contact_modifie: lireUneSource((debut, fin) => supabase.from('contacts')
      .select('id, modifie_par, modifie_le', { count: 'exact' }).eq('dossier_id', d).gte('modifie_le', borne)
      .order('modifie_le').order('id').range(debut, fin), 'modifie_par', 'modifie_le'),
    contact_retire: lireUneSource((debut, fin) => supabase.from('contacts')
      .select('id, retire_par, retire_le', { count: 'exact' }).eq('dossier_id', d).gte('retire_le', borne)
      .order('retire_le').order('id').range(debut, fin), 'retire_par', 'retire_le'),
    contact_efface: lireUneSource((debut, fin) => supabase.from('contacts')
      .select('id, efface_par, efface_le', { count: 'exact' }).eq('dossier_id', d).gte('efface_le', borne)
      .order('efface_le').order('id').range(debut, fin), 'efface_par', 'efface_le'),
    parametres_changes: lireUneSource((debut, fin) => supabase.from('parametres_facturation')
      .select('id, auteur, cree_le', { count: 'exact' }).eq('dossier_id', d).gte('cree_le', borne)
      .order('cree_le').order('id').range(debut, fin), 'auteur', 'cree_le'),
    adresse_declaree: lireUneSource((debut, fin) => supabase.from('adresses_reception')
      .select('id, auteur, cree_le', { count: 'exact' }).eq('dossier_id', d).gte('cree_le', borne)
      .order('cree_le').order('id').range(debut, fin), 'auteur', 'cree_le'),
    justificatif_propose: lireUneSource((debut, fin) => supabase.from('justificatifs_proposes')
      .select('id, auteur_id, created_at', { count: 'exact' }).eq('dossier_id', d).gte('created_at', borne)
      .order('created_at').order('id').range(debut, fin), 'auteur_id', 'created_at'),
    justificatif_retire: lireUneSource((debut, fin) => supabase.from('justificatifs_proposes')
      .select('id, retire_par, retire_le', { count: 'exact' }).eq('dossier_id', d).gte('retire_le', borne)
      .order('retire_le').order('id').range(debut, fin), 'retire_par', 'retire_le'),
    precision_mouvement: lireUneSource((debut, fin) => supabase.from('precisions_mouvements')
      .select('id, auteur_id, created_at', { count: 'exact' }).eq('dossier_id', d).gte('created_at', borne)
      .order('created_at').order('id').range(debut, fin), 'auteur_id', 'created_at'),
    precision_piece: lireUneSource((debut, fin) => supabase.from('piece_commentaires')
      .select('id, auteur_id, created_at', { count: 'exact' }).eq('dossier_id', d).gte('created_at', borne)
      .order('created_at').order('id').range(debut, fin), 'auteur_id', 'created_at'),
    piece_deposee: lireUneSource((debut, fin) => supabase.from('pieces')
      .select('id, uploaded_by, created_at', { count: 'exact' }).eq('dossier_id', d).gte('created_at', borne)
      .order('created_at').order('id').range(debut, fin), 'uploaded_by', 'created_at'),
    email_envoye: lireUneSource((debut, fin) => supabase.from('emails_envoyes')
      .select('id, envoye_par, created_at', { count: 'exact' }).eq('dossier_id', d).gte('created_at', borne)
      .order('created_at').order('id').range(debut, fin), 'envoye_par', 'created_at'),
    caisse_saisie: lireUneSource((debut, fin) => supabase.from('operations_caisse')
      .select('id, cree_par, cree_le', { count: 'exact' }).eq('dossier_id', d).gte('cree_le', borne)
      .order('cree_le').order('id').range(debut, fin), 'cree_par', 'cree_le'),
    caisse_retiree: lireUneSource((debut, fin) => supabase.from('operations_caisse')
      .select('id, retire_par, retire_le', { count: 'exact' }).eq('dossier_id', d).gte('retire_le', borne)
      .order('retire_le').order('id').range(debut, fin), 'retire_par', 'retire_le'),
  }
  const genres = Object.keys(lectures) as GenreDuJournal[]
  const lues = await Promise.all(genres.map((g) => lectures[g]))
  return Object.fromEntries(genres.map((g, i) => [g, lues[i]])) as Record<GenreDuJournal, LectureDUneSource>
}

export interface LectureDuJournal {
  acces: AccesDuDossier
  sources: SourcesDuJournal | null
}

/** Les accès et les sources du dossier, lus pour le jour de Paris `aujourdhui` : « en cours » tant qu'ils ne sont pas revenus POUR CE dossier et CE jour. */
export function useJournalDeLEspaceClient(dossierId: string, aujourdhui: string): LectureDuJournal {
  const cle = `${dossierId}|${aujourdhui}`
  const [lue, setLue] = useState<{ cle: string; lecture: LectureDuJournal } | null>(null)

  useEffect(() => {
    let annule = false
    const borne = ajouterJours(debutDeLaFenetre(aujourdhui), -1)
    // Ne rejette jamais : les accès (`lireLesAccesDuDossier`) et chaque source rattrapent leur propre panne.
    Promise.all([lireLesAccesDuDossier(dossierId), lireLesSourcesDuJournal(dossierId, borne)])
      .then(([acces, sources]) => { if (!annule) setLue({ cle: `${dossierId}|${aujourdhui}`, lecture: { acces, sources } }) })
    return () => { annule = true }
  }, [dossierId, aujourdhui])

  return lue !== null && lue.cle === cle ? lue.lecture : { acces: ACCES_EN_COURS, sources: null }
}
