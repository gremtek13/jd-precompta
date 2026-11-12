import { supabase } from './supabase'
import { lireTout } from './lectureComplete'
import { messageErreur } from './messageErreur'
import { dateAParis } from './format'
import { sirenDuDossier } from './factureElectronique'
import { lireFichierDeReprise } from './lectureDesFacturesReprises'
import { cheminDUnOriginal, preparerOriginalDImport, typeSansParametres, TYPES_DES_ORIGINAUX_D_IMPORT } from './bornesStockage'
import { retirerFichiers } from './stockage'
import { sortDesOriginaux, type FactureDUnLot, type FichierLu, type LectureDeLImport, type LotLu, type LotPret } from './importDesFacturesVue'
import type { ModeComptable } from './types'

// CE QUE L'ÉCRAN D'IMPORT DES FACTURES REPRISES LIT ET ÉCRIT (ligne 51.5, étape A8d2b ; la règle : importDesFacturesVue.ts).
// Au cabinet seul : `imports_factures` et `factures_importees` ne s'ouvrent qu'à lui (une lecture que la RLS refuserait
// rendrait ZÉRO ligne sans erreur). La lecture ne REJETTE jamais : une requête qui lève ou qu'on refuse, une collection
// lue en partie ou d'un autre dossier, tombent du côté « illisible », avec leur motif — et l'écran n'offre aucun geste.
// Les gestes passent par les fonctions de la base seules (`importer_factures`, `retirer_import`,
// `fixer_reprise_des_factures`) et rendent le refus de la base, jamais une donnée de facture au journal.

export const COLONNES_DU_DOSSIER = 'id, siret, mode_comptable, ventes_par_les_factures, ventes_par_les_factures_depuis, reprise_des_factures_le'
export const COLONNES_DES_FACTURES = 'id, dossier_id, numero, statut, type, date_emission'
export const COLONNES_DES_LOTS = 'id, dossier_id, format, fichier_sha256, importe_le, nombre_factures'
export const COLONNES_DES_FACTURES_IMPORTEES = 'facture_id, dossier_id, import_id, rang, fichier_sha256, fichier_chemin'

interface FactureLue { id: string; dossier_id: string; numero: string | null; statut: string; type: string; date_emission: string | null }
interface LotBrut { id: string; dossier_id: string; format: string; fichier_sha256: string | null; importe_le: string; nombre_factures: number }
interface ImporteeLue { facture_id: string; dossier_id: string; import_id: string; rang: number; fichier_sha256: string | null; fichier_chemin: string | null }

export async function lireLEtatDeLImport(dossierId: string): Promise<LectureDeLImport> {
  const illisible = (motif: string): LectureDeLImport => ({ etat: 'illisible', dossierId, motif })
  try {
    const { data, error } = await supabase.from('dossiers').select(COLONNES_DU_DOSSIER).eq('id', dossierId).maybeSingle()
    if (error) return illisible(messageErreur(error, 'le dossier n’a pas pu être lu'))
    if (!data) return illisible('le dossier n’a pas été trouvé')
    const d = data as unknown as Record<string, unknown>
    const mode = d.mode_comptable
    if (mode !== 'tresorerie' && mode !== 'engagement') return illisible('le mode comptable du dossier n’a pas été rendu')
    if (typeof d.ventes_par_les_factures !== 'boolean') return illisible('la source des ventes du dossier n’a pas été rendue')
    const depuis = d.ventes_par_les_factures_depuis
    const reprise = d.reprise_des_factures_le
    if ((depuis !== null && typeof depuis !== 'string') || (reprise !== null && typeof reprise !== 'string')) {
      return illisible('la bascule ou la date de reprise du dossier n’a pas été rendue')
    }
    const siret = typeof d.siret === 'string' ? d.siret : null

    const [factures, lots, importees] = await Promise.all([
      lireTout<FactureLue>((debut, fin) => supabase.from('factures_emises').select(COLONNES_DES_FACTURES, { count: 'exact' })
        .eq('dossier_id', dossierId).order('id').range(debut, fin)),
      lireTout<LotBrut>((debut, fin) => supabase.from('imports_factures').select(COLONNES_DES_LOTS, { count: 'exact' })
        .eq('dossier_id', dossierId).order('importe_le').order('id').range(debut, fin)),
      lireTout<ImporteeLue>((debut, fin) => supabase.from('factures_importees').select(COLONNES_DES_FACTURES_IMPORTEES, { count: 'exact' })
        .eq('dossier_id', dossierId).order('facture_id').range(debut, fin)),
    ])
    if (!factures.complete) return illisible(`les factures du dossier : ${factures.motif ?? 'lecture incomplète'}`)
    if (!lots.complete) return illisible(`les imports du dossier : ${lots.motif ?? 'lecture incomplète'}`)
    if (!importees.complete) return illisible(`les factures reprises : ${importees.motif ?? 'lecture incomplète'}`)
    if ([...factures.lignes, ...lots.lignes, ...importees.lignes].some((l) => l.dossier_id !== dossierId)) {
      return illisible('une ligne rendue n’est pas de ce dossier')
    }
    const parId = new Map(factures.lignes.map((f) => [f.id, f]))
    const facturesDesLots = new Map<string, FactureDUnLot[]>()
    for (const i of importees.lignes) {
      const f = parId.get(i.facture_id)
      if (!f || f.numero === null) return illisible('les factures reprises : une facture citée n’a pas été rendue')
      const liste = facturesDesLots.get(i.import_id) ?? []
      liste.push({ facture_id: i.facture_id, numero: f.numero, rang: i.rang, fichier_chemin: i.fichier_chemin })
      facturesDesLots.set(i.import_id, liste)
    }
    const lotsLus: LotLu[] = lots.lignes.map((l) => ({
      id: l.id, format: l.format, importe_le: l.importe_le, nombre_factures: l.nombre_factures,
      factures: (facturesDesLots.get(l.id) ?? []).sort((a, b) => a.rang - b.rang),
    }))
    if (lotsLus.some((l) => l.factures.length !== l.nombre_factures)) return illisible('un import n’a pas rendu toutes ses factures')
    return {
      etat: 'lue',
      lue: {
        dossierId,
        modeComptable: mode as ModeComptable,
        bascule: d.ventes_par_les_factures,
        basculeLe: d.ventes_par_les_factures && typeof depuis === 'string' ? dateAParis(depuis) : null,
        repriseLe: reprise as string | null,
        siren: sirenDuDossier(siret),
        numeros: factures.lignes.flatMap((f) => (f.numero === null ? [] : [f.numero])),
        reprises: factures.lignes
          .filter((f) => f.statut === 'importee' && f.numero !== null && f.date_emission !== null && (f.type === 'facture' || f.type === 'avoir'))
          .map((f) => ({ numero: f.numero as string, type: f.type as 'facture' | 'avoir', date_emission: f.date_emission as string })),
        empreintes: [...lots.lignes, ...importees.lignes].flatMap((l) => (l.fichier_sha256 ? [l.fichier_sha256] : [])),
        lots: lotsLus,
      },
    }
  } catch (e) {
    return illisible(messageErreur(e, 'l’état de l’import n’a pas pu être lu'))
  }
}

/**
 * Lit les fichiers déposés : leur empreinte, leur facture (A8d1), leur original prêt au dépôt quand les originaux se
 * déposent. Ne rejette jamais : un fichier illisible se refuse, nommé.
 */
async function sha256Hex(octets: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', octets as Uint8Array<ArrayBuffer>)
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function lireLesFichiers(fichiers: readonly File[], siren: string | null, originauxPrevus: boolean, prefixe: string): Promise<FichierLu[]> {
  return Promise.all(fichiers.map(async (f, i): Promise<FichierLu> => {
    const base = { cle: `${prefixe}-${i}`, nom: f.name, taille: f.size, fichier: f }
    try {
      const octets = new Uint8Array(await f.arrayBuffer())
      const [sha256, lecture, original] = await Promise.all([
        sha256Hex(octets).catch(() => null),
        lireFichierDeReprise(octets, siren),
        originauxPrevus ? preparerOriginalDImport(f) : Promise.resolve(null),
      ])
      return { ...base, sha256, lecture, original }
    } catch (e) {
      return { ...base, sha256: null, lecture: { refus: [messageErreur(e, 'Le fichier n’a pas pu être lu.')] }, original: null }
    }
  }))
}

export type IssueDUnGeste = { ok: true; message: string } | { ok: false; erreur: string }

/**
 * Importe le lot par `importer_factures` seule (tout ou rien). Originaux prévus : chaque original se dépose d'abord sous
 * `<dossier>/imports/<lot>/<empreinte>.<ext>` (jamais écrasé), et ce qui a été déposé se retire si l'import échoue.
 * Un import qui a réussi en base sans que sa réponse revienne (le réseau) garde ses originaux : depuis A8D2A-Q1 (la
 * migration `originaux_retenus_par_leur_import`, préparée), le seau refuse le retrait de l'original d'un import qui
 * existe, et `retirerFichiers` le consigne sans lever — l'écran dit de relire la liste, qui montre le lot.
 */
export async function importerLeLot(dossierId: string, pret: LotPret, fichiers: readonly FichierLu[], originauxPrevus: boolean): Promise<IssueDUnGeste> {
  const deposes: string[] = []
  const echec = async (erreur: string): Promise<IssueDUnGeste> => {
    await retirerFichiers('ventes', deposes, 'import des factures', dossierId)
    return { ok: false, erreur }
  }
  try {
    const lotId = originauxPrevus ? crypto.randomUUID() : null
    const factures = []
    for (const { cle, facture } of pret.factures) {
      if (!originauxPrevus) { factures.push(facture); continue }
      const f = fichiers.find((x) => x.cle === cle)
      if (!f || !f.sha256) return echec('L’original d’un fichier n’est pas prêt : rien n’a été importé.')
      // Préparé de nouveau ici, du fichier lui-même : le corps déposé vient d'un préparateur des bornes (depotsDansLesSeaux).
      const original = await preparerOriginalDImport(f.fichier)
      if (!('corps' in original)) return echec(`L’original de ${f.nom} ne se dépose pas : ${original.refus.message}. Rien n’a été importé.`)
      const type = typeSansParametres(original.type)
      if (!(TYPES_DES_ORIGINAUX_D_IMPORT as readonly string[]).includes(type)) return echec('Le type d’un original n’est pas admis : rien n’a été importé.')
      const chemin = cheminDUnOriginal(dossierId, lotId as string, f.sha256, type as (typeof TYPES_DES_ORIGINAUX_D_IMPORT)[number])
      if (!chemin) return echec('Le chemin d’un original n’a pas sa forme : rien n’a été importé.')
      if (!deposes.includes(chemin)) {
        const { error } = await supabase.storage.from('ventes').upload(chemin, original.corps, { contentType: original.type, upsert: false })
        if (error) return echec(`Un original n’a pas pu se déposer (${messageErreur(error, 'refus du stockage')}) : rien n’a été importé.`)
        deposes.push(chemin)
      }
      factures.push({ ...facture, fichier_sha256: f.sha256, fichier_chemin: chemin })
    }
    const lot = lotId ? { id: lotId, format: pret.format } : { format: pret.format }
    const { data, error } = await supabase.rpc('importer_factures', { p_dossier_id: dossierId, p_lot: lot, p_factures: factures })
    if (error) return echec(messageErreur(error, 'L’import a été refusé : rien n’a été importé.'))
    if (typeof data !== 'string') return echec('La base n’a pas rendu l’import : relis la liste avant de recommencer.')
    return { ok: true, message: `${factures.length} document${factures.length > 1 ? 's' : ''} repris de l’ancien logiciel.` }
  } catch (e) {
    return echec(messageErreur(e, 'L’import a été interrompu : relis la liste avant de recommencer.'))
  }
}

/**
 * Retire un lot par `retirer_import` seule (les LIGNES), puis, retrait réussi, ses originaux du stockage par
 * `retirerFichiers` (qui journalise et ne lève jamais) — ceux seulement que `sortDesOriginaux` dit à retirer. Le message
 * dit ce que deviennent les originaux. Cet ordre est le seul que la base admet depuis A8D2A-Q1 (la migration
 * `originaux_retenus_par_leur_import`, préparée) : tant que l'import existe, son original ne se retire pas.
 */
export async function retirerLImport(dossierId: string, lot: LotLu, originauxPrevus: boolean, chefDuCabinet: boolean): Promise<IssueDUnGeste> {
  try {
    const { data, error } = await supabase.rpc('retirer_import', { p_dossier_id: dossierId, p_import_id: lot.id })
    if (error) return { ok: false, erreur: messageErreur(error, 'Le retrait de l’import a été refusé.') }
    if (typeof data !== 'number') return { ok: false, erreur: 'La base n’a pas rendu le retrait : relis la liste.' }
    const originaux = sortDesOriginaux(lot, originauxPrevus, chefDuCabinet)
    await retirerFichiers('ventes', originaux.retirer, 'retrait d’un import de factures', dossierId)
    const fait = `Import retiré : ${data} document${data > 1 ? 's' : ''} quitte${data > 1 ? 'nt' : ''} le dossier.`
    return { ok: true, message: originaux.phrase ? `${fait} ${originaux.phrase}` : fait }
  } catch (e) {
    return { ok: false, erreur: messageErreur(e, 'Le retrait de l’import a été interrompu : relis la liste.') }
  }
}

export async function fixerLaDateDeReprise(dossierId: string, jour: string): Promise<IssueDUnGeste> {
  try {
    const { data, error } = await supabase.rpc('fixer_reprise_des_factures', { p_dossier_id: dossierId, p_reprise_le: jour })
    if (error) return { ok: false, erreur: messageErreur(error, 'La date de reprise a été refusée.') }
    if (data !== jour) return { ok: false, erreur: 'La base n’a pas rendu la date de reprise : relis l’état du dossier.' }
    return { ok: true, message: 'Date de reprise posée.' }
  } catch (e) {
    return { ok: false, erreur: messageErreur(e, 'La date de reprise n’a pas pu être posée.') }
  }
}
