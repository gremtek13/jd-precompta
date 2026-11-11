import { supabase } from './supabase'
import { lireTout } from './lectureComplete'
import { messageErreur } from './messageErreur'
import { estUneFactureReprise } from './facturesReprises'
import type { LectureDeLaRepriseDeLOrigine } from './avoirDUneFactureReprise'
import type { EspaceVentes } from './espaceVentes'

// CE QUE L'AVOIR D'UNE FACTURE REPRISE DEMANDE DE LIRE (étape A8c6 ; lib/avoirDUneFactureReprise.ts) : la date de reprise des
// factures du dossier (`dossiers.reprise_des_factures_le`, que la base compare à la date de l'avoir) et, au cabinet seul, ce
// que les avoirs REPRIS qui citent la facture ont déjà crédité (`factures_importees.origine_id`, puis leurs montants dans
// `factures_emises`) — `factures_importees` ne s'ouvre qu'au cabinet du dossier, et une lecture que la RLS refuse rendrait
// ZÉRO ligne sans erreur : pour le client, rien n'est lu, et la base juge seule du plafond.
//
// Elle ne REJETTE jamais : une requête qui lève ou qu'on refuse, une colonne qui ne revient pas, une collection lue en partie
// ou d'un autre dossier, un avoir cité introuvable, tombent du côté « illisible », avec leur motif — et l'avoir est retenu.

export const COLONNES_DU_DOSSIER = 'id, reprise_des_factures_le'
export const COLONNES_DES_LIENS = 'facture_id, dossier_id, origine_id'
export const COLONNES_DES_AVOIRS_REPRIS = 'id, dossier_id, type, statut, montant_ttc'

interface LienLu { facture_id: string; dossier_id: string; origine_id: string | null }
interface AvoirReprisLu { id: string; dossier_id: string; type: string; statut: string; montant_ttc: number }

export async function lireCeQueLAvoirDUneRepriseDemande(
  dossierId: string,
  origineId: string,
  espace: EspaceVentes,
): Promise<LectureDeLaRepriseDeLOrigine> {
  const illisible = (motif: string): LectureDeLaRepriseDeLOrigine => ({ etat: 'illisible', factureId: origineId, motif })
  try {
    const { data, error } = await supabase.from('dossiers').select(COLONNES_DU_DOSSIER).eq('id', dossierId).maybeSingle()
    if (error) return illisible(messageErreur(error, 'le dossier n’a pas pu être lu'))
    if (!data) return illisible('le dossier n’a pas été trouvé')
    const repriseLe = (data as unknown as Record<string, unknown>).reprise_des_factures_le
    if (repriseLe !== null && typeof repriseLe !== 'string') return illisible('la date de reprise des factures du dossier n’a pas été rendue')
    if (espace !== 'cabinet') return { etat: 'lue', factureId: origineId, repriseLe, crediteParLesRepris: null }

    const liens = await lireTout<LienLu>((debut, fin) =>
      supabase.from('factures_importees').select(COLONNES_DES_LIENS, { count: 'exact' })
        .eq('dossier_id', dossierId).eq('origine_id', origineId).order('facture_id').range(debut, fin),
    )
    if (!liens.complete) return illisible(`les avoirs repris : ${liens.motif ?? 'lecture incomplète'}`)
    if (liens.lignes.some((l) => l.dossier_id !== dossierId || l.origine_id !== origineId)) {
      return illisible('les avoirs repris : une ligne rendue n’est pas de cette facture')
    }
    const ids = liens.lignes.map((l) => l.facture_id)
    if (ids.length === 0) return { etat: 'lue', factureId: origineId, repriseLe, crediteParLesRepris: 0 }
    const avoirs = await lireTout<AvoirReprisLu>((debut, fin) =>
      supabase.from('factures_emises').select(COLONNES_DES_AVOIRS_REPRIS, { count: 'exact' })
        .eq('dossier_id', dossierId).in('id', ids).order('id').range(debut, fin),
    )
    if (!avoirs.complete) return illisible(`les montants des avoirs repris : ${avoirs.motif ?? 'lecture incomplète'}`)
    let centimes = 0
    for (const id of ids) {
      const a = avoirs.lignes.find((x) => x.id === id)
      if (!a || a.dossier_id !== dossierId || !estUneFactureReprise(a) || typeof a.montant_ttc !== 'number') {
        return illisible('les montants des avoirs repris : un avoir cité n’a pas été rendu')
      }
      // La base ne somme que les AVOIRS (`a.type = 'avoir'`) : une facture qui citerait une origine n'en est pas un.
      if (a.type === 'avoir') centimes += Math.round(-a.montant_ttc * 100)
    }
    return { etat: 'lue', factureId: origineId, repriseLe, crediteParLesRepris: centimes / 100 }
  } catch (e) {
    return illisible(messageErreur(e, 'ce que l’avoir demande n’a pas pu être lu'))
  }
}
