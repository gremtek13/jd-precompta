import type { EspaceVentes } from './espaceVentes'
import { formatDate, formatMoney } from './format'
import {
  LIBELLES_DES_ECARTS,
  type ColonnesDUnePart, type GenreDUneColonne, type ImportAEnvoyer, type LectureDesPaiements, type PartDUneLigne,
  type PartDuPaiement, type ReglageDesColonnes,
} from './paiementsAssuranceMaladie'
import type { ImportAssuranceMaladie, PaiementAssuranceMaladie } from './types'

// LES MOTS ET LES RÈGLES DE L'ÉCRAN D'IMPORT DES PAIEMENTS DE L'ASSURANCE MALADIE (conception 53, lot NOE4 ; la lecture du
// fichier et les refus de la base : lib/paiementsAssuranceMaladie.ts ; la lecture en base : lib/paiementsAssuranceMaladieLecture.ts).
// Un module PUR : ni base, ni horloge, ni fichier. L'écran (`components/PaiementsAssuranceMaladie.tsx`) sert les deux espaces —
// le cabinet du dossier, le praticien sous « Banque » (NOE-Q1) — et chaque phrase a ses deux formes : le client tutoyé, le
// cabinet à l'infinitif.
//
// RIEN N'EST DEVINÉ (NOE1-Q1 : « faire l'écran d'abord, l'en-tête ensuite ») : le réglage des colonnes part VIDE, chaque
// colonne se choisit à la main sur son en-tête et son genre, jamais un exemple de valeur (conception 53, §3) ; tant qu'une
// colonne obligatoire manque, l'aperçu le dit et rien ne part.

/** La borne du fichier, jugée avant toute lecture sur la taille que le navigateur donne : un export de paiements d'une année
 *  tient en bien moins ; au-delà, ce n'est sans doute pas le bon fichier. */
export const TAILLE_FICHIER_PAIEMENTS_MAX = 10 * 1024 * 1024

export function refusDeLaTailleDesPaiements(octets: number, espace: EspaceVentes): string | null {
  if (octets <= TAILLE_FICHIER_PAIEMENTS_MAX) return null
  return espace === 'client'
    ? 'Ce fichier pèse plus de 10 Mo : un export de paiements pèse bien moins. Vérifie que c’est le bon fichier.'
    : 'Ce fichier pèse plus de 10 Mo : un export de paiements pèse bien moins. Vérifier que c’est le bon fichier.'
}

export const LIBELLES_DES_PARTS: Readonly<Record<PartDuPaiement, string>> = {
  obligatoire: 'Part obligatoire',
  complementaire: 'Part complémentaire',
  forfait: 'Forfait',
}

/** L'organisme d'un paiement : deux codes, ou rien de dit. Jamais une personne. */
export function organismeDit(regime: number | null, caisse: number | null): string {
  if (regime === null && caisse === null) return 'non dit'
  return [regime === null ? null : `régime ${regime}`, caisse === null ? null : `caisse ${caisse}`].filter(Boolean).join(', ')
}

/** L'organisme d'un paiement, son organisme complémentaire compris quand il est dit (la part complémentaire, BOR-Q5 (B)) : des
 *  codes, jamais une personne. */
export function organismeDuPaiementDit(p: { regime: number | null; caisse: number | null; organisme_complementaire: number | null }): string {
  const caisse = organismeDit(p.regime, p.caisse)
  if (p.organisme_complementaire === null) return caisse
  const complementaire = `organisme complémentaire ${p.organisme_complementaire}`
  return p.regime === null && p.caisse === null ? complementaire : `${caisse}, ${complementaire}`
}

export const montantDit = (centimes: number) => formatMoney(centimes / 100)

/** Le genre d'une colonne, en mots : ce que toutes ses cellules non vides sont. « texte » quand ce n'est ni une date, ni un
 *  montant, ni un code, ni un statut — une colonne de noms se lit ainsi, et ne se choisit pas comme montant sans qu'on le voie. */
export function genreDit(genre: GenreDUneColonne): string {
  if (genre.vide) return 'vide'
  const genres = [
    genre.date ? 'date' : null, genre.montant ? 'montant' : null, genre.code ? 'code en chiffres' : null,
    genre.statut ? 'statut' : null,
  ].filter((g): g is string => g !== null)
  return genres.length === 0 ? 'texte' : genres.join(' ou ')
}

// ── Le réglage des colonnes, tel que l'écran le tient ──────────────────────────────────────────────────────────────────
export type UsageDUneColonne = 'journee' | 'montant' | 'statut' | 'regime' | 'caisse'

export const USAGES: readonly { usage: UsageDUneColonne; libelle: string; obligatoire: boolean }[] = [
  { usage: 'journee', libelle: 'Journée comptable', obligatoire: true },
  { usage: 'montant', libelle: 'Montant payé', obligatoire: true },
  { usage: 'statut', libelle: 'Statut (au choix)', obligatoire: false },
  { usage: 'regime', libelle: 'Code du régime (au choix)', obligatoire: false },
  { usage: 'caisse', libelle: 'Numéro de la caisse (au choix)', obligatoire: false },
]

export interface ReglageDUnePartALEcran {
  part: PartDUneLigne
  retenue: boolean
  colonnes: Readonly<Record<UsageDUneColonne, number | null>>
}

export const PARTS_DE_L_ECRAN: readonly PartDUneLigne[] = ['obligatoire', 'complementaire']

/** Le réglage de départ : aucune part retenue, aucune colonne choisie. */
export function reglageVide(): ReglageDUnePartALEcran[] {
  return PARTS_DE_L_ECRAN.map((part) => ({
    part, retenue: false, colonnes: { journee: null, montant: null, statut: null, regime: null, caisse: null },
  }))
}

/**
 * Le réglage qui partira au module, ou ce qui manque, en mots : une part au moins retenue, et pour chaque part retenue sa
 * journée comptable et son montant. Le reste des refus (une colonne hors du fichier, une colonne à deux usages) est celui du
 * module, `refusDuReglage`, que l'écran dit ensuite.
 */
export function reglageChoisi(parts: readonly ReglageDUnePartALEcran[], espace: EspaceVentes):
  { reglage: ReglageDesColonnes; manque: null } | { reglage: null; manque: string } {
  const retenues = parts.filter((p) => p.retenue)
  if (retenues.length === 0) {
    return {
      reglage: null,
      manque: espace === 'client'
        ? 'Coche la part obligatoire, la part complémentaire, ou les deux, selon ce que ton fichier porte.'
        : 'Cocher la part obligatoire, la part complémentaire, ou les deux, selon ce que le fichier porte.',
    }
  }
  for (const p of retenues) {
    for (const u of USAGES.filter((x) => x.obligatoire)) {
      if (p.colonnes[u.usage] === null) {
        const quoi = `la colonne « ${u.libelle} » de la ${LIBELLES_DES_PARTS[p.part].toLowerCase()}`
        return { reglage: null, manque: espace === 'client' ? `Choisis ${quoi}.` : `Choisir ${quoi}.` }
      }
    }
  }
  const reglage: ReglageDesColonnes = {
    parts: retenues.map((p): ColonnesDUnePart => ({
      part: p.part, journee: p.colonnes.journee as number, montant: p.colonnes.montant as number,
      statut: p.colonnes.statut, regime: p.colonnes.regime, caisse: p.colonnes.caisse,
    })),
  }
  return { reglage, manque: null }
}

// ── L'aperçu ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const pluriel = (n: number, mot: string, marque = 's') => `${n} ${mot}${n > 1 ? marque : ''}`

/** Ce que la lecture a laissé de côté, compté : les parts écartées par raison (jamais la valeur), puis les lignes qui les
 *  portent, vingt au plus. */
export function ecartsDits(lecture: LectureDesPaiements): string[] {
  const phrases: string[] = []
  const parRaison = new Map<string, number[]>()
  for (const e of lecture.ecartees) {
    const lignes = parRaison.get(e.raison) ?? []
    lignes.push(e.ligne)
    parRaison.set(e.raison, lignes)
  }
  for (const [raison, lignes] of parRaison) {
    const uniques = [...new Set(lignes)]
    const montrees = uniques.slice(0, 20).join(', ')
    const reste = uniques.length > 20 ? ` et ${uniques.length - 20} autres` : ''
    phrases.push(`${pluriel(lignes.length, 'part')} ${lignes.length > 1 ? 'écartées' : 'écartée'} — `
      + `${LIBELLES_DES_ECARTS[raison as keyof typeof LIBELLES_DES_ECARTS]} (ligne${uniques.length > 1 ? 's' : ''} ${montrees}${reste} du fichier).`)
  }
  if (lecture.sansMontant > 0) {
    phrases.push(`${pluriel(lecture.sansMontant, 'part')} sans montant : ${lecture.sansMontant > 1 ? 'ce ne sont pas des paiements' : 'ce n’est pas un paiement'}.`)
  }
  if (lecture.enAttente > 0) {
    phrases.push(`${pluriel(lecture.enAttente, 'part')} en attente : pas encore ${lecture.enAttente > 1 ? 'des paiements' : 'un paiement'}.`)
  }
  return phrases
}

export function rejetsDits(rejets: ImportAEnvoyer['rejets'] | { nombre: number | null; montant_centimes: number | null }): string {
  if (rejets === null || rejets.nombre === null || rejets.montant_centimes === null) return 'les rejets ne sont pas dits par le fichier'
  if (rejets.nombre === 0) return 'aucun rejet'
  return `${pluriel(rejets.nombre, 'rejet')}, ${montantDit(rejets.montant_centimes)}`
}

/** Le total net d'un ensemble de paiements, en centimes. */
export const totalDesPaiements = (paiements: readonly { montant_centimes: number }[]) =>
  paiements.reduce((s, p) => s + p.montant_centimes, 0)

/**
 * La confirmation, qui NOMME ce qui part et ce qui reste dans le fichier (conception 53, §7, NOE4) : les paiements, leur
 * période, leur total, ceux déjà importés aux mêmes chiffres (passés), les rejets ; puis ce qui ne part pas.
 */
export function confirmationDeLImport(imp: ImportAEnvoyer, dejaImportes: number, espace: EspaceVentes): string {
  const journees = imp.paiements.map((p) => p.date_journee_comptable).sort()
  const nouveaux = imp.paiements.length - dejaImportes
  const partent = `${pluriel(nouveaux, 'paiement')} de l’assurance maladie ${nouveaux > 1 ? 'partent' : 'part'} en base, `
    + `journées comptables du ${formatDate(journees[0])} au ${formatDate(journees[journees.length - 1])}, `
    + `pour ${montantDit(totalDesPaiements(imp.paiements))} au total ; ${rejetsDits(imp.rejets)}.`
  const passes = dejaImportes > 0
    ? ` ${pluriel(dejaImportes, 'paiement')} déjà ${dejaImportes > 1 ? 'importés' : 'importé'} aux mêmes chiffres ${dejaImportes > 1 ? 'sont passés' : 'est passé'}.`
    : ''
  const reste = espace === 'client'
    ? ' Rien d’autre ne part : les noms, les numéros de sécurité sociale, les actes, les numéros de facture et de lot restent '
      + 'dans ton fichier, sur ton ordinateur. Tout ou rien : si la base refuse un paiement, rien ne s’importe.'
    : ' Rien d’autre ne part : les noms, les numéros de sécurité sociale, les actes, les numéros de facture et de lot restent '
      + 'dans le fichier, sur cet ordinateur. Tout ou rien : si la base refuse un paiement, rien ne s’importe.'
  return partent + passes + reste
}

/** La phrase d'après l'import (NOE3-Q1, réponse du cabinet du 17/11/2026) : seuls les chiffres ont été gardés, et le conseil
 *  de supprimer le fichier source. */
export function phraseApresLImport(espace: EspaceVentes): string {
  return espace === 'client'
    ? 'Importé. Seuls les chiffres ont été gardés — par journée comptable, organisme et part, le montant et le nombre de '
      + 'factures — ; aucune ligne de ton fichier n’a quitté ton navigateur. Tu peux maintenant supprimer ce fichier de ton '
      + 'ordinateur : il porte les données de tes patients, et il n’est plus utile ici.'
    : 'Importé. Seuls les chiffres ont été gardés — par journée comptable, organisme et part, le montant et le nombre de '
      + 'factures — ; aucune ligne du fichier n’a quitté ce navigateur. Le fichier peut maintenant être supprimé de cet '
      + 'ordinateur : il porte les données des patients du praticien, et il n’est plus utile ici.'
}

/** Ce que l'écran du cabinet rappelle (conception 53, §4) : le praticien ne transmet pas ses retours ; s'il a choisi de remettre
 *  son fichier, il se lit ici, dans ce navigateur, et ne part nulle part. */
export const RAPPEL_AU_CABINET = 'Le praticien n’a pas à transmettre ses retours de l’assurance maladie : ils portent les données '
  + 'de ses patients. Il peut importer lui-même ses paiements depuis son espace, sous « Banque ». S’il a choisi de vous remettre '
  + 'son fichier, il se lit ici, dans ce navigateur : il ne part nulle part, et seuls des chiffres en sortent.'

export const PRESENTATION_AU_CLIENT = 'L’export des paiements de ton logiciel de facturation (un fichier CSV) se lit ici, dans ton '
  + 'navigateur : il ne part nulle part. Tu choisis ses colonnes, tu vois les paiements qu’il donne par journée comptable, '
  + 'organisme et part, puis tu importes : seuls ces chiffres partent, jamais un nom ni un numéro. Ils servent à ton cabinet à '
  + 'contrôler les virements de l’assurance maladie sur ton relevé ; ils ne comptent pas dans tes recettes une seconde fois.'

export const PRESENTATION_AU_CABINET = 'L’export des paiements du logiciel de facturation du praticien (un fichier CSV) se lit ici : '
  + 'ses colonnes se choisissent, l’aperçu donne les paiements par journée comptable, organisme et part, puis l’import ne fait '
  + 'partir que ces chiffres. Ils justifient et contrôlent les crédits du relevé ; ils ne comptent dans aucun calcul (ni 2035, '
  + 'ni CA3, ni FEC). L’association au relevé viendra ensuite.'

/** La confirmation d'un retrait, qui nomme ce qui part. */
export function confirmationDuRetrait(imp: ImportAssuranceMaladie, paiements: readonly PaiementAssuranceMaladie[], espace: EspaceVentes): string {
  const siens = paiements.filter((p) => p.import_id === imp.id)
  return `Retirer l’import des journées du ${formatDate(imp.periode_du)} au ${formatDate(imp.periode_au)} : `
    + `${pluriel(siens.length, 'paiement')}, ${montantDit(totalDesPaiements(siens))} au total, `
    + `${siens.length > 1 ? 'partent' : 'part'} avec lui. `
    + (espace === 'client'
      ? 'Tu pourras importer de nouveau le même fichier.'
      : 'Le même fichier pourra s’importer de nouveau.')
}

export const VIDE_DIT: Readonly<Record<EspaceVentes, string>> = {
  client: 'Tu n’as encore importé aucun paiement de l’assurance maladie.',
  cabinet: 'Aucun paiement de l’assurance maladie n’a encore été importé pour ce dossier.',
}

export const SANS_LA_CASE_BANQUE = 'Ton accès ne porte plus « Banque » sur cette société : l’import de tes paiements de '
  + 'l’assurance maladie ne s’affiche pas ici. Demande à ton cabinet d’ajouter « Banque » à ton accès.'
