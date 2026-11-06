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
  // Qui a parlé, tel que la BASE l'a déduit à l'écriture (`origine`, sur une pièce commentée, un justificatif proposé, une
  // précision d'un mouvement) ; absent ailleurs. Le journal du client s'en sert pour dire « par ton cabinet » sans nom.
  origine?: 'client' | 'cabinet' | null
}

export type LectureDUneSource =
  | { etat: 'lue'; lignes: readonly LigneDuJournal[] }
  | { etat: 'partielle'; motif: string }
  // Côté client seulement : une source qu'aucune case de l'accès n'ouvre, donc jamais demandée à la base.
  | { etat: 'fermee' }

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
    // Le cabinet lit toutes les sources : une source « fermée » ici serait une source qui n'a pas été lue.
    return s.etat === 'partielle' ? [`${libelleDeLEvenement(g, null)} : ${s.motif}`]
      : s.etat === 'fermee' ? [`${libelleDeLEvenement(g, null)} : non lue`] : []
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

// ── LE JOURNAL CÔTÉ CLIENT : « Ce qui a bougé », dans « Mon analyse » (étape B9c) ──────────────────────────────────────
// Le même journal, montré au CLIENT de la société, sur la même fenêtre et au même plafond, avec trois différences.
//  1. Chaque évènement ne paraît que si une case de l'accès ouvre son DOMAINE (`DOMAINE_DU_GENRE`), sur les cases relues à
//     la base : les ventes sous « Ventes », la banque sous « Banque », la caisse sous « Caisse », les pièces à tout accès.
//     Le module filtre lui-même, même une source que l'appelant aurait lue : la lecture n'est pas la seule barrière.
//  2. Il montre TOUS les évènements du domaine, pas seulement ceux du client — mais il ne dit jamais QUI : « par toi » quand
//     l'auteur est le compte connecté, « par ton cabinet » ou « par un autre accès de ta société » quand la base a gardé
//     l'origine de l'écriture (`origine`), et rien sinon. Le client ne lit ni les accès des autres ni l'équipe du cabinet
//     (`memberships_select`, `cabinet_admins_select`) : sans origine gardée, on ne devine pas.
//  3. Ses mots tutoient et ne nomment aucun onglet (lib/espaceVentes.ts, `MOTS_DU_CABINET`).

export type DomaineDuJournal = 'ventes' | 'banque' | 'caisse' | 'tout_acces'

/** Le domaine de chaque genre : la case qui doit l'ouvrir au client, ou aucune (`tout_acces`). */
export const DOMAINE_DU_GENRE: Readonly<Record<GenreDuJournal, DomaineDuJournal>> = {
  facture_creee: 'ventes', facture_validee: 'ventes', facture_transmise: 'ventes',
  encaissement_enregistre: 'ventes', encaissement_retire: 'ventes', encaissement_declare: 'ventes',
  statut_releve: 'ventes',
  devis_emis: 'ventes', devis_repondu: 'ventes',
  article_cree: 'ventes', article_modifie: 'ventes', article_retire: 'ventes',
  contact_cree: 'ventes', contact_modifie: 'ventes', contact_retire: 'ventes', contact_efface: 'ventes',
  parametres_changes: 'ventes', adresse_declaree: 'ventes',
  justificatif_propose: 'banque', justificatif_retire: 'banque', precision_mouvement: 'banque',
  precision_piece: 'tout_acces', piece_deposee: 'tout_acces',
  email_envoye: 'ventes',
  caisse_saisie: 'caisse', caisse_retiree: 'caisse',
}

/** Les cases de l'accès, telles que la base les voit (et que l'écran ouvre). */
export interface CasesDuJournal { ventes: boolean; banque: boolean; caisse: boolean }

/** Un genre est-il ouvert au client par ces cases ? Seul `true` ouvre. */
export function genreOuvert(genre: GenreDuJournal, cases: CasesDuJournal): boolean {
  const domaine = DOMAINE_DU_GENRE[genre]
  return domaine === 'tout_acces' || cases[domaine] === true
}

/** Les e-mails que le client lit (`emails_envoyes_lecture_ventes`) : ceux d'une facture ou d'un devis, jamais une relance. */
export const TYPES_D_EMAIL_DU_CLIENT: readonly string[] = ['facture', 'devis']

export const PAR_TOI = 'par toi'
export const PAR_TON_CABINET = 'par ton cabinet'
export const PAR_UN_AUTRE_ACCES = 'par un autre accès de ta société'

/** Qui, dit au client sans nom : le compte connecté, ou l'origine que la base a gardée ; sinon rien. */
export function parQui(ligne: LigneDuJournal, soi: string | null): string | null {
  if (typeof soi === 'string' && soi !== '' && ligne.auteur === soi) return PAR_TOI
  if (ligne.origine === 'cabinet') return PAR_TON_CABINET
  if (ligne.origine === 'client') return PAR_UN_AUTRE_ACCES
  return null
}

/** Un évènement dit au client : jamais l'identifiant de l'auteur, seulement `par`. */
export interface EvenementDuClient extends EvenementDuJournal {
  par: string | null
}

export type JournalDuClient =
  | { etat: 'en_cours' }
  | { etat: 'muet'; motif: string }
  | { etat: 'lu'; depuis: string; evenements: readonly EvenementDuClient[]; total: number }

/**
 * Le journal du client : les évènements des domaines que ses cases ouvrent, dans la fenêtre, du plus récent au plus ancien,
 * plafonnés, chacun sans nom d'auteur. En cours tant que les sources ne sont pas revenues ; muet sur la moindre lecture
 * partielle d'une source ouverte, ou sur une source ouverte que l'appelant n'a pas lue.
 */
export function journalDuClient(entree: {
  soi: string | null
  cases: CasesDuJournal
  sources: SourcesDuJournal | null
  aujourdhui: string
  plafond?: number
}): JournalDuClient {
  const { soi, cases, sources, aujourdhui } = entree
  const plafond = entree.plafond ?? PLAFOND_DU_JOURNAL
  if (sources === null) return { etat: 'en_cours' }
  const ouverts = GENRES_DU_JOURNAL.filter((g) => genreOuvert(g, cases))
  const partielles = ouverts.flatMap((g) => {
    const s = sources[g]
    return s.etat === 'partielle' ? [`${libelleDeLEvenement(g, null)} : ${s.motif}`]
      : s.etat === 'fermee' ? [`${libelleDeLEvenement(g, null)} : non lue`] : []
  })
  if (partielles.length > 0) {
    return { etat: 'muet', motif: `Une lecture n’a pas abouti en entier (${partielles.join(' ; ')}).` }
  }
  const depuis = debutDeLaFenetre(aujourdhui)
  const evenements: EvenementDuClient[] = []
  for (const genre of ouverts) {
    const s = sources[genre]
    if (s.etat !== 'lue') continue
    for (const l of s.lignes) {
      if (!instantValide(l.le)) continue
      const jour = dateAParis(l.le)
      if (jour < depuis || jour > aujourdhui) continue
      evenements.push({ genre, id: l.id, le: l.le, libelle: libelleDeLEvenement(genre, l.reference), par: parQui(l, soi) })
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

/** La phrase du compte, dite au client. */
export function phraseDuCompteDuClient(journal: Extract<JournalDuClient, { etat: 'lu' }>): string {
  const { total, evenements } = journal
  if (total === 0) return 'Rien n’a bougé sur la période.'
  if (evenements.length < total) return `Les ${evenements.length} plus récents sur ${total} évènements.`
  return total === 1 ? '1 évènement.' : `${total} évènements.`
}

/** Ce que le journal ne montre pas faute de case, dit au client ; `null` quand ses cases ouvrent tout. */
export function ceQueTesCasesNeMontrentPas(cases: CasesDuJournal): string | null {
  const fermes = [
    ...(cases.ventes ? [] : ['tes ventes']),
    ...(cases.banque ? [] : ['ta banque']),
    ...(cases.caisse ? [] : ['ta caisse']),
  ]
  if (fermes.length === 0) return null
  const ouvre = fermes.length === 1 ? `n’ouvre pas ${fermes[0]}` : `n’ouvre ni ${fermes.join(' ni ')}`
  return `Ton accès ${ouvre} : ce qui s’y fait n’y paraît pas.`
}

/** Ce que dit la section quand une lecture n'est pas revenue en entier : rien d'autre, le motif en infobulle. */
export const JOURNAL_MUET_DU_CLIENT = 'Ce qui a bougé ne s’affiche pas : une partie n’a pas pu être lue. Recharge la page.'

/** La limite du journal, dite au client sous la section. */
export const LIMITE_DU_JOURNAL_DU_CLIENT =
  'Reconstitué des traces que la base garde de chaque geste : ce qui se supprime sans trace (un brouillon de facture ou de '
  + 'devis, par exemple) n’y paraît pas, une modification d’article ou de client n’y paraît que pour la dernière, et seuls '
  + 'les e-mails de tes factures et de tes devis y figurent. Personne n’y est nommé : un geste est dit « par toi », « par ton '
  + 'cabinet » ou « par un autre accès de ta société » quand la base le sait, et sans auteur sinon.'
