import { estLeClient, type AccesDuDossier } from './auteursVentes'
import { ajouterJours, dateAParis } from './format'

// LE JOURNAL DES ÉVÈNEMENTS DE L'ESPACE CLIENT, RECONSTITUÉ (espace client, étape B9b ; la carte P10 de la Vue d'ensemble,
// « Espace client : ce qui a bougé depuis le … » ; conception : HISTORIQUE.md, « L'ESPACE CLIENT, LOGICIEL DE GESTION DU
// CLIENT : LE PREMIER GROUPE, LA PARITÉ, ET AU-DELÀ », §B.3, et MEG2-Q11).
//
// Il n'existe AUCUNE table d'évènements : le journal se RECONSTITUE des colonnes d'auteur que la base porte déjà, chacune
// avec son instant (un `…_par` et son `…_le`, ou `created_by` et `created_at`). Un évènement que la conception nomme sans
// colonne d'auteur en base n'existe pas ici — on ne le devine d'aucune autre trace.
//
// TROIS CHOSES QUE CE MODULE NE FAIT JAMAIS.
//  1. Dire « par le client » d'un compte qu'il ne reconnaît pas parmi les accès du dossier lus EN ENTIER
//     (lib/auteursVentes.ts, `estLeClient`) : un accès retiré depuis n'est plus reconnu, et ce qu'il a fait ne paraît pas.
//  2. Affirmer quoi que ce soit — ni une liste, ni « rien » — sur une lecture partielle : les accès, ou l'une des sources,
//     lus en partie ou refusés, et le journal est MUET, son motif seul dit.
//  3. Montrer ce qui n'a plus de trace : un brouillon supprimé, une modification écrasée par la suivante (seule la dernière
//     modification d'un article ou d'un contact garde son auteur). La limite se dit à l'écran (`LIMITE_DU_JOURNAL`).
//
// Pur : aucun accès à la base (la lecture est dans journalDeLEspaceClientLecture.ts), « maintenant » donné par l'appelant.

/** Les évènements, un par colonne d'auteur lue. L'ordre est celui des libellés : il départage deux instants égaux. */
export const GENRES_DU_JOURNAL = [
  'facture_creee', 'facture_validee', 'facture_transmise',
  'encaissement_enregistre', 'encaissement_retire', 'encaissement_declare',
  'statut_releve',
  'devis_emis', 'devis_repondu',
  'article_cree', 'article_modifie', 'article_retire',
  'contact_cree', 'contact_modifie', 'contact_retire', 'contact_efface',
  'parametres_changes', 'adresse_declaree',
  'justificatif_propose', 'justificatif_retire',
  'precision_mouvement', 'precision_piece',
  'piece_deposee', 'email_envoye',
  'caisse_saisie', 'caisse_retiree',
] as const

export type GenreDuJournal = typeof GENRES_DU_JOURNAL[number]

/**
 * Une ligne d'une source, réduite à ce que le journal dit : la ligne (`id`), l'auteur et l'instant de l'évènement, et une
 * référence facultative — le numéro d'une facture ou d'un devis, la réponse à un devis. Jamais un nom de tiers ni un montant.
 */
export interface LigneDuJournal {
  id: string
  auteur: string | null
  le: string | null
  reference?: string | null
}

export type LectureDUneSource =
  | { etat: 'lue'; lignes: readonly LigneDuJournal[] }
  | { etat: 'partielle'; motif: string }

/** Toutes les sources, une par genre : le `Record` fermé sur le genre oblige l'appelant à les donner TOUTES. */
export type SourcesDuJournal = Readonly<Record<GenreDuJournal, LectureDUneSource>>

export interface EvenementDuJournal {
  genre: GenreDuJournal
  id: string
  le: string
  libelle: string
}

export type JournalDeLEspaceClient =
  | { etat: 'en_cours' }
  | { etat: 'muet'; motif: string }
  | { etat: 'lu'; depuis: string; evenements: readonly EvenementDuJournal[]; total: number }

/** La fenêtre : les trente derniers jours, le jour de Paris donné compris. */
export const JOURS_DE_LA_FENETRE = 30

/** Le nombre d'évènements que la carte montre, les plus récents. */
export const PLAFOND_DU_JOURNAL = 20

/** Le premier jour de la fenêtre (AAAA-MM-JJ), d'après le jour de Paris que l'appelant donne. */
export function debutDeLaFenetre(aujourdhui: string): string {
  return ajouterJours(aujourdhui, -(JOURS_DE_LA_FENETRE - 1))
}

const LIBELLES: Readonly<Record<GenreDuJournal, (reference: string | null) => string>> = {
  facture_creee: () => 'Facture créée (brouillon)',
  facture_validee: (r) => (r ? `Facture ${r} validée` : 'Facture validée'),
  facture_transmise: () => 'Facture transmise à la plateforme',
  encaissement_enregistre: () => 'Encaissement enregistré',
  encaissement_retire: () => 'Encaissement retiré',
  encaissement_declare: () => 'Encaissement déclaré à la plateforme',
  statut_releve: () => 'Statut d’une facture relevé',
  devis_emis: (r) => (r ? `Devis ${r} émis` : 'Devis émis'),
  devis_repondu: (r) => (r === 'acceptee' ? 'Devis noté accepté' : r === 'refusee' ? 'Devis noté refusé' : 'Réponse à un devis notée'),
  article_cree: () => 'Article créé',
  article_modifie: () => 'Article modifié',
  article_retire: () => 'Article retiré',
  contact_cree: () => 'Client ajouté',
  contact_modifie: () => 'Client modifié',
  contact_retire: () => 'Client retiré',
  contact_efface: () => 'Client effacé',
  parametres_changes: () => 'Paramètres de facturation changés',
  adresse_declaree: () => 'Adresse de réception déclarée',
  justificatif_propose: () => 'Justificatif proposé pour un mouvement',
  justificatif_retire: () => 'Proposition de justificatif retirée',
  precision_mouvement: () => 'Précision sur un mouvement',
  precision_piece: () => 'Précision sur une pièce',
  piece_deposee: () => 'Pièce déposée',
  email_envoye: () => 'E-mail envoyé',
  caisse_saisie: () => 'Opération de caisse saisie',
  caisse_retiree: () => 'Opération de caisse retirée',
}

/** Ce que dit une ligne du journal : le genre, et la référence quand elle en porte une. */
export function libelleDeLEvenement(genre: GenreDuJournal, reference: string | null | undefined): string {
  return LIBELLES[genre](typeof reference === 'string' && reference !== '' ? reference : null)
}

const instantValide = (le: string | null): le is string => typeof le === 'string' && !Number.isNaN(new Date(le).getTime())

/**
 * Le journal : les évènements du CLIENT, dans la fenêtre, du plus récent au plus ancien, plafonnés.
 * En cours tant que les accès ou une source ne sont pas revenus ; muet sur la moindre lecture partielle.
 */
export function journalDeLEspaceClient(entree: {
  acces: AccesDuDossier
  sources: SourcesDuJournal | null
  aujourdhui: string
  plafond?: number
}): JournalDeLEspaceClient {
  const { acces, sources, aujourdhui } = entree
  const plafond = entree.plafond ?? PLAFOND_DU_JOURNAL
  if (acces.etat === 'en_cours' || sources === null) return { etat: 'en_cours' }
  if (acces.etat === 'sans_objet') return { etat: 'muet', motif: 'Le journal de l’espace client est celui du cabinet.' }
  if (acces.etat === 'incomplets') {
    return { etat: 'muet', motif: `La liste des accès du dossier n’a pas été lue en entier (${acces.motif}).` }
  }
  const partielles = GENRES_DU_JOURNAL.flatMap((g) => {
    const s = sources[g]
    return s.etat === 'partielle' ? [`${libelleDeLEvenement(g, null)} : ${s.motif}`] : []
  })
  if (partielles.length > 0) {
    return { etat: 'muet', motif: `Une lecture n’a pas abouti en entier (${partielles.join(' ; ')}).` }
  }
  const depuis = debutDeLaFenetre(aujourdhui)
  const evenements: EvenementDuJournal[] = []
  for (const genre of GENRES_DU_JOURNAL) {
    const s = sources[genre]
    if (s.etat !== 'lue') continue
    for (const l of s.lignes) {
      if (!estLeClient(acces, l.auteur) || !instantValide(l.le)) continue
      // Le jour de PARIS de l'instant, jugé contre la fenêtre : la base lit un peu plus large, le module tranche.
      const jour = dateAParis(l.le)
      if (jour < depuis || jour > aujourdhui) continue
      evenements.push({ genre, id: l.id, le: l.le, libelle: libelleDeLEvenement(genre, l.reference) })
    }
  }
  const rang = (g: GenreDuJournal) => GENRES_DU_JOURNAL.indexOf(g)
  evenements.sort((a, b) => {
    const ecart = new Date(b.le).getTime() - new Date(a.le).getTime()
    if (ecart !== 0) return ecart
    if (a.genre !== b.genre) return rang(a.genre) - rang(b.genre)
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
  return { etat: 'lu', depuis, evenements: evenements.slice(0, plafond), total: evenements.length }
}

/** La limite du journal, dite sous la carte. */
export const LIMITE_DU_JOURNAL =
  'Reconstitué des traces que la base garde de chaque geste : ce qui se supprime sans trace (un brouillon de facture ou de '
  + 'devis, par exemple) n’y paraît pas, une modification d’article ou de client n’y paraît que pour la dernière, et ce '
  + 'qu’a fait un accès retiré depuis n’est plus reconnu.'

/** La phrase du compte : combien d'évènements, et combien sont montrés quand le plafond tombe. */
export function phraseDuCompte(journal: Extract<JournalDeLEspaceClient, { etat: 'lu' }>): string {
  const { total, evenements } = journal
  if (total === 0) return 'Aucun geste du client depuis son espace sur la période.'
  if (evenements.length < total) return `Les ${evenements.length} plus récents sur ${total} évènements.`
  return total === 1 ? '1 évènement.' : `${total} évènements.`
}
