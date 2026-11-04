import { supabase } from './supabase'
import { lireTout } from './lectureComplete'
import { messageErreur } from './messageErreur'
import { titreDeFacture } from './titreDeFacture'

// LES FACTURES PROBABLES DE L'ONGLET DOCUMENTS (relecture du 04/11/2026, D4 ; PIECES-Q3). La lecture range un document
// dans Documents sur son texte ; jusqu'au 04/11/2026, un mot croisé (« attestation jointe », « solde précédent »,
// « URSSAF » citée) y envoyait de vraies factures, hors de la 2035 et sans justificatif pour le débit qui les paie — et
// rien ne poussait le cabinet à y regarder. `extract-piece` ne s'y trompe plus ; les documents déjà rangés restent. Celui
// dont le texte lu se donne pour une facture, par la MÊME règle que la lecture (`titreDeFacture`), le dit à sa ligne, à
// côté du geste qui le reprend, « C'est une facture ».
//
// Une lecture À PART, et best-effort : elle ne lit que les textes des documents qui portent « factur » ou « honoraires »
// (la base filtre, le navigateur ne rapatrie pas le texte de chaque relevé), puis juge chacun. Ratée ou partielle, elle ne
// marque rien — un signal qui n'a pas été lu ne s'affirme pas — et son motif se dit sous la liste ; le reste de l'onglet
// n'en dépend pas. Ne rejette jamais.

export interface LectureDesFacturesProbables {
  /** Les documents dont le texte lu se donne pour une facture. */
  documents: ReadonlySet<string>
  /** Non nul quand les textes n'ont pas pu être lus en entier : aucune marque n'est alors posée. */
  motif: string | null
}

export async function lireLesFacturesProbables(dossierId: string): Promise<LectureDesFacturesProbables> {
  try {
    const lecture = await lireTout<{ document_id: string | null; texte: string | null }>((debut, fin) =>
      supabase.from('piece_textes_ocr').select('document_id, texte', { count: 'exact' })
        .eq('dossier_id', dossierId)
        .not('document_id', 'is', null)
        .or('texte.ilike.*factur*,texte.ilike.*honoraires*')
        .order('id').range(debut, fin),
    )
    if (!lecture.complete) return { documents: new Set(), motif: lecture.motif }
    return { documents: facturesProbables(lecture.lignes), motif: null }
  } catch (err) {
    return { documents: new Set(), motif: messageErreur(err, 'lecture impossible') }
  }
}

/** Les documents dont le texte lu se donne pour une facture — la règle pure, testée sans base. */
export function facturesProbables(textes: readonly { document_id: string | null; texte: string | null }[]): Set<string> {
  const documents = new Set<string>()
  for (const { document_id, texte } of textes) {
    if (document_id && texte && titreDeFacture(texte.split('\n'))) documents.add(document_id)
  }
  return documents
}

/** Ce que dit la marque, en infobulle : pourquoi, et le geste. */
export const PHRASE_FACTURE_PROBABLE = 'Le texte lu de ce document se donne pour une facture (« Facture » ou « Note d’honoraires » '
  + 'en titre, et un montant). Rangé ici par la lecture, il n’entre pas dans la 2035 et ne justifie aucun débit : '
  + '« C’est une facture » le reprend dans Justificatifs.'
