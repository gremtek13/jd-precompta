import {
  GENRES_SAISIS, jugerLaSaisie, jugerLaSaisieDUnMois, jugerLeRemplacement, jugerLeRetrait, jourDit, quiEcritLaCaisse, refus,
  sansLOperation,
  type CategorieDeLaCaisse, type DossierDeLaCaisse, type EncaissementDeLaCaisse, type EtatDeLaCaisse, type RefusCaisse,
  type SaisieDeCaisse,
} from './caisse'
import { euros, lireLeMontantSaisi, MONTANT_ILLISIBLE, nomDeLOperation, soldeAuJour } from './caisseEcran'
import type { ModeleComptable } from './engagement'
import { pourLEspace } from './espaceVentes'
import { ROLES_COMPTABLES, type LibellesDuPlan, type PlanComptable, type PrefixesDuPlan } from './planComptable'
import type { Dossier, OperationCaisse } from './types'

// « MA CAISSE », CE QUE L'ÉCRAN DU PRATICIEN DIT ET ENVOIE (ligne 26.6, étape C12a ; MVP-D2, CAISSE-Q1, CAISSE2-Q1 à Q4). La
// conception : HISTORIQUE.md, « LA CAISSE : LA SAISIE DU PRATICIEN ET LA PIÈCE RÉGLÉE PAR LA CAISSE — LA CONCEPTION REPRISE
// (CAISSE-Q1 ET Q4) », § 4, 5 et 7 ; la base : la migration `caisse_du_client` (C10), en production depuis le 02/11/2026.
//
// CE MODULE NE RECOPIE AUCUNE RÈGLE. Les refus d'`enregistrer_operation_caisse`, de `retirer_operation_caisse` et de
// `remplacer_operation_caisse`, dans leur ordre et sous leurs mots — branche « client » comprise : la nature que le cabinet a
// fixée, aucune écriture envoyée, l'ensemble du jour sans numéro —, sont ceux de lib/caisse.ts (`jugerLaSaisie`,
// `jugerLeRetrait`, `jugerLeRemplacement`), et la caisse jamais négative y est rejouée comme `premier_jour_negatif_de_la_caisse`.
// Ce module ne fait que TRADUIRE ce que le client lit en ce que ces règles lisent :
//   - le client ne lit ni la reprise, ni le relevé, ni les encaissements, ni les exercices validés : il lit sa caisse jour par
//     jour, en totaux (`caisse_du_client`), et ses opérations (la policy `operations_caisse_lecture_caisse`). La caisse que le
//     module rejoue se compose donc de ces totaux — chaque jour, ce qui n'est pas une opération (le report des années d'avant,
//     l'ouverture, le relevé, les espèces des factures) en un flux, et les opérations lues une à une — puis se CONFRONTE à la
//     lecture : ses opérations, jour par jour, au total que la base a compté ; ses soldes au solde qu'elle rend. Un écart, et la
//     caisse ne se rejoue pas : l'écran le dit et n'offre aucun geste (`caisseRejouee`) ;
//   - le client ne lit pas le plan du dossier : sa branche ne le lit jamais (la base compose son écriture). Le modèle qu'il
//     passe porte un plan VIDE (`PLAN_QUE_LE_CLIENT_NE_LIT_PAS`), que `caisseClient.test.ts` rend piégé pour prouver qu'aucun
//     de ses jugements ne l'ouvre.
// La saisie d'un MOIS (C12A-Q1, le 04/11/2026, « L'ajouter maintenant ») suit la même voie : le tableau tel qu'il part à
// `enregistrer_operations_de_caisse`, jugé par `jugerLaSaisieDUnMois` de lib/caisse.ts sur la caisse rejouée, tout ou rien.
// Ce que le client ne peut pas savoir, la base le juge seule, et l'écran redit son refus après le clic : l'ouverture du
// dossier (la date de sa reprise, hors du compte de la caisse) ; et la frontière de la validation d'une année où sa caisse
// n'a aucun jour (`anneeFigee` rend nul). Une année que la lecture dit figée n'offre aucune saisie : l'écran le dit.
//
// PUR : aucun appel au réseau, aucun import du client Supabase.

// LA MIGRATION EST EN BASE (`caisse_du_client`, version 20261102081129, appliquée le 02/11/2026) : la fonction de lecture et la
// branche « client » des fonctions de la caisse existent. Le drapeau dit seulement que la route et l'entrée de « Ma caisse »
// peuvent s'offrir ; baissé, aucun accès « Caisse » ne les verrait (la base refuserait sa lecture).
export const CAISSE_DU_CLIENT_EXPORTEE = true

/**
 * « Ma caisse » s'offre-t-elle au client (sa route, App.tsx ; son entrée, Layout.tsx ; sa tuile, ClientHome.tsx) ? Avec la
 * case « Caisse » sur la société AFFICHÉE (`AuthContext`, `droitsParDossier`), et la migration en base. L'écran relit la case
 * à la base avant tout : une case retirée depuis la connexion ne laisse rien lire.
 */
export function maCaisseOuverte(caisseDuClientExportee: boolean, droitCaisse: boolean): boolean {
  return caisseDuClientExportee && droitCaisse
}

// ── Ce que l'écran lit ────────────────────────────────────────────────────────────────────────────────────────────────

/** Une ligne de `caisse_du_client` : un jour de l'année qui porte un flux (ou le 1er janvier d'un report non nul). */
export interface JourDeLaCaisseDuClient {
  jour: string
  /** Le solde des années d'avant, au 1er janvier seulement ; zéro ailleurs. */
  report: number
  /** Les à-nouveaux du compte de la caisse : les espèces en main au premier jour tenu. */
  ouverture: number
  /** Les opérations non retirées (un prélèvement en moins). */
  operations: number
  /** Le relevé : un versement en banque en moins, un retrait d'espèces pour la caisse en plus. */
  releve: number
  /** Les espèces des factures sources sans mouvement, et leurs contre-passations. */
  especes_des_factures: number
  /** Les identifiants qu'une recette de ce jour reconnaît, triés : jamais un numéro ni un client. */
  encaissements_du_jour: string[]
  /** La caisse à la fin du jour. */
  solde: number
  /** Le jour est-il figé par la validation d'un exercice (la frontière jugée par la base) ? */
  fige: boolean
}

/** Les colonnes de l'opération que l'écran lit, chaîne pour chaîne (le compilateur confronte chacune à son type). */
export const COLONNES_DES_OPERATIONS_DU_CLIENT =
  'id, dossier_id, genre, date, montant, categorie_id, taux_tva, encaissements_du_jour, piece_id, origine, remplace_id, cree_le, cree_par, retire_le'

export type OperationDuClient = Pick<OperationCaisse,
  'id' | 'dossier_id' | 'genre' | 'date' | 'montant' | 'categorie_id' | 'taux_tva' | 'encaissements_du_jour' | 'piece_id'
  | 'origine' | 'remplace_id' | 'cree_le' | 'cree_par' | 'retire_le'>

/** Ce que l'écran lit du dossier : ce que `qui_ecrit_la_caisse` et `enregistrer_operation_caisse` jugent. */
export const COLONNES_DU_DOSSIER_DU_CLIENT = 'id, statut_tva, mode_comptable, assujetti_tva, categorie_recettes_client'
export type DossierDuClient = Pick<Dossier, 'id' | 'statut_tva' | 'mode_comptable' | 'assujetti_tva' | 'categorie_recettes_client'>

/**
 * La nature des recettes que le cabinet a fixée, telle que l'écran la lit : son compte seulement — jamais son libellé, qu'un
 * écran du client ne montre pas (la règle d'écran, CAISSE2-Q2 (B)). `lue` nulle : aucune catégorie de ce nom n'est rendue.
 */
export const COLONNES_DE_LA_NATURE = 'id, dossier_id, compte_comptable'
export type CategorieDeLaNature = Pick<CategorieDeLaCaisse, 'id' | 'dossier_id' | 'compte_comptable'>
export type NatureDesRecettesLue = { etat: 'lue'; categorie: CategorieDeLaNature | null }
  | { etat: 'illisible'; motif: string }

/** Une ligne de `caisse_du_client` telle que la base la rend, jugée : nulle si un champ n'a pas sa forme. */
export function jourLu(x: unknown): JourDeLaCaisseDuClient | null {
  if (x === null || typeof x !== 'object' || Array.isArray(x)) return null
  const l = x as Record<string, unknown>
  const nombre = (v: unknown): number | null => {
    const n = typeof v === 'number' ? v : typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : NaN
    return Number.isFinite(n) ? n : null
  }
  const champs = ['report', 'ouverture', 'operations', 'releve', 'especes_des_factures', 'solde'] as const
  const valeurs = champs.map((c) => nombre(l[c]))
  if (valeurs.some((v) => v === null)) return null
  if (typeof l.jour !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(l.jour) || typeof l.fige !== 'boolean') return null
  if (!Array.isArray(l.encaissements_du_jour) || l.encaissements_du_jour.some((e) => typeof e !== 'string')) return null
  const [report, ouverture, operations, releve, especes, solde] = valeurs as number[]
  return {
    jour: l.jour, report, ouverture, operations, releve, especes_des_factures: especes,
    encaissements_du_jour: [...(l.encaissements_du_jour as string[])], solde, fige: l.fige,
  }
}

// ── Qui saisit : le dossier, la case, la nature ───────────────────────────────────────────────────────────────────────

/**
 * La saisie du client s'ouvre-t-elle sur CE dossier ? Les refus que la base opposerait à TOUTE saisie, dans son ordre et
 * sous ses mots : l'accès « Caisse » d'un dossier ni exonéré ni en franchise (`qui_ecrit_la_caisse`), puis le dossier en
 * trésorerie ; puis la nature des recettes — absente, ou qui n'est plus une catégorie de produit du dossier. Fermée, l'écran
 * le dit et n'offre AUCUN geste : le praticien n'a que ses recettes à saisir, et une caisse sans elles n'a pas de sens ici.
 */
export function saisieDuClient(dossier: DossierDuClient, nature: NatureDesRecettesLue):
  { ouverte: true } | { ouverte: false; raison: string } {
  const qui = quiEcritLaCaisse({ cabinet: false, accesCaisse: true, statutTva: dossier.statut_tva })
  if (qui.refus) return { ouverte: false, raison: qui.refus.message }
  if (dossier.mode_comptable !== 'tresorerie') return { ouverte: false, raison: refus('tresorerie').message }
  if (nature.etat === 'illisible') {
    return { ouverte: false, raison: `La nature de tes recettes en espèces n’a pas pu être lue (${nature.motif}) : recharge la page.` }
  }
  if (dossier.categorie_recettes_client == null) return { ouverte: false, raison: refus('nature_absente').message }
  const c = nature.categorie
  const produit = c != null && c.id === dossier.categorie_recettes_client
    && (c.dossier_id == null || c.dossier_id === dossier.id) && c.compte_comptable != null && /^7[0-9]{2}/.test(c.compte_comptable)
  return produit ? { ouverte: true } : { ouverte: false, raison: refus('nature_sans_produit').message }
}

// ── La caisse rejouée sur ce que le client lit ────────────────────────────────────────────────────────────────────────

// Le compte de la caisse, tel que la caisse REJOUÉE le nomme : un nom, pas un numéro — le client ne lit pas le plan, et la
// caisse rejouée ne porte que ses propres flux (chaque flux qui n'est pas une opération y est une « ouverture » de ce compte).
const COMPTE_DE_LA_CAISSE_LUE = 'caisse lue'
// La facture des espèces d'un jour, telle que la caisse rejouée la nomme : les identifiants que `caisse_du_client` rend pour une
// recette du jour en sont les encaissements, sans montant (leur total est déjà dans le flux du jour) — c'est l'ensemble que la
// saisie passe, et que `jugerLaSaisie` attend.
const FACTURE_DES_ESPECES_LUES = 'espèces lues'

/** Le plan que le client ne lit pas : aucun compte. Sa branche ne le lit jamais (la base compose son écriture). */
export const PLAN_QUE_LE_CLIENT_NE_LIT_PAS: PlanComptable = Object.freeze(
  Object.fromEntries(ROLES_COMPTABLES.map((r) => [r.role, ''])) as Record<keyof PlanComptable, string>,
)

/** Ni libellé ni préfixe : le client ne lit pas le plan, et sa branche ne nomme aucun compte ni aucun auxiliaire. */
const LIBELLES_QUE_LE_CLIENT_NE_LIT_PAS: LibellesDuPlan = Object.freeze(
  Object.fromEntries(ROLES_COMPTABLES.map((r) => [r.role, null])) as LibellesDuPlan,
)
const PREFIXES_QUE_LE_CLIENT_NE_LIT_PAS: PrefixesDuPlan = Object.freeze({ fournisseurs: '', fournisseurs_immobilisations: '', clients: '' })

const centimes = (montant: number) => Math.round(montant * 100)

/**
 * La caisse que le module rejoue, composée de ce que le client lit, depuis le 1er janvier de `annee` : chaque jour, son flux
 * hors des opérations (le report — de la PREMIÈRE année lue seulement : celui d'une année suivante est le solde de la
 * précédente —, l'ouverture, le relevé, les espèces des factures), et les opérations lues, retirées comprises (elles ne
 * comptent pas). Puis CONFRONTÉE à la lecture : pour chaque jour, ses opérations non retirées au total que la base a compté,
 * et son solde à celui qu'elle rend — une opération qui ne se retrouve pas, une borne que la base pose et que le client ne
 * voit pas (une opération d'avant l'ouverture du compte de la caisse), une lecture faite entre deux écritures : la caisse ne
 * se rejoue pas, et le motif le dit.
 */
export function caisseRejouee(jours: readonly JourDeLaCaisseDuClient[], operations: readonly OperationDuClient[], annee: number):
  { etat: EtatDeLaCaisse; motif: null } | { etat: null; motif: string } {
  const debut = `${annee}-01-01`
  const tries = [...jours].sort((a, b) => a.jour.localeCompare(b.jour))
  const ouvertures: EtatDeLaCaisse['ouvertures'][number][] = [{ date: debut, compte: COMPTE_DE_LA_CAISSE_LUE, sens: 'debit', montant: 0 }]
  const encaissements: EncaissementDeLaCaisse[] = []
  for (const j of tries) {
    const report = j.jour.slice(0, 4) === String(annee) ? j.report : 0
    const flux = centimes(report) + centimes(j.ouverture) + centimes(j.releve) + centimes(j.especes_des_factures)
    if (flux !== 0) {
      ouvertures.push({ date: j.jour, compte: COMPTE_DE_LA_CAISSE_LUE, sens: flux > 0 ? 'debit' : 'credit', montant: Math.abs(flux) / 100 })
    }
    for (const id of j.encaissements_du_jour) {
      encaissements.push({
        id, facture_id: FACTURE_DES_ESPECES_LUES, date_encaissement: j.jour, montant: 0, moyen: 'especes',
        ligne_bancaire_id: null, annule_id: null, retire_le: null,
      })
    }
  }
  const etat: EtatDeLaCaisse = {
    compteCaisse: COMPTE_DE_LA_CAISSE_LUE,
    ouvertures,
    operations: operations.filter((o) => o.date >= debut),
    mouvements: [],
    encaissements,
    factures: [{ id: FACTURE_DES_ESPECES_LUES, numero: null, source_de_la_vente: true }],
  }
  // Les opérations, jour par jour, au total que la base a compté.
  const parJour = new Map<string, number>()
  for (const o of etat.operations) {
    if (o.retire_le != null) continue
    parJour.set(o.date, (parJour.get(o.date) ?? 0) + (o.genre === 'prelevement' ? -1 : 1) * centimes(o.montant))
  }
  const lus = new Map(tries.map((j) => [j.jour, j]))
  for (const [jour, total] of parJour) {
    if (total !== 0 && centimes(lus.get(jour)?.operations ?? 0) !== total) {
      return { etat: null, motif: `les opérations du ${jourDit(jour)} ne se retrouvent pas dans le total que la base a compté` }
    }
  }
  for (const j of tries) {
    if (centimes(j.operations) !== (parJour.get(j.jour) ?? 0)) {
      return { etat: null, motif: `le total des opérations du ${jourDit(j.jour)} ne se retrouve pas dans tes opérations lues` }
    }
  }
  for (const j of tries) {
    if (soldeAuJour(etat, j.jour) !== centimes(j.solde)) {
      return { etat: null, motif: `le solde du ${jourDit(j.jour)} ne se recompose pas` }
    }
  }
  return { etat, motif: null }
}

/**
 * L'année est-elle figée par la validation d'un exercice ? La frontière est un 31 décembre : un jour figé de l'année (ou d'une
 * année suivante) la fige entière ; un jour qui ne l'est pas la laisse ouverte. Nul quand la lecture ne le dit pas — aucun
 * jour lu de l'année, aucun jour figé après elle : la base en juge seule, après le clic.
 */
export function anneeFigee(jours: readonly JourDeLaCaisseDuClient[], annee: number): boolean | null {
  const de = (j: JourDeLaCaisseDuClient) => Number(j.jour.slice(0, 4))
  if (jours.some((j) => de(j) >= annee && j.fige)) return true
  if (jours.some((j) => de(j) === annee && !j.fige)) return false
  return null
}

// ── Le dossier, tel que les règles de lib/caisse.ts le lisent ─────────────────────────────────────────────────────────

/** Ce que l'écran passe aux règles : la lecture, le praticien, et le jour à Paris. */
export interface ContexteDuClient {
  dossier: DossierDuClient
  /** Le compte connecté : la base ne lui laisse corriger que ce qu'IL a saisi. */
  moi: string
  aujourdhui: string
}

/**
 * Le dossier tel que `jugerLaSaisie`, `jugerLeRetrait` et `jugerLeRemplacement` le lisent, sous le profil du CLIENT : la
 * nature que le cabinet a fixée, le modèle sans plan, aucune ouverture ni aucun exercice validé connus (la base les juge),
 * la caisse rejouée.
 */
export function dossierDuClient(ctx: ContexteDuClient, nature: NatureDesRecettesLue, caisse: EtatDeLaCaisse): DossierDeLaCaisse {
  const modele: ModeleComptable = {
    mode: ctx.dossier.mode_comptable, compteNotesDeFrais: '', plan: PLAN_QUE_LE_CLIENT_NE_LIT_PAS,
    libelles: LIBELLES_QUE_LE_CLIENT_NE_LIT_PAS, prefixes: PREFIXES_QUE_LE_CLIENT_NE_LIT_PAS,
  }
  const categorie = nature.etat === 'lue' ? nature.categorie : null
  return {
    quiEcrit: 'client',
    utilisateur: ctx.moi,
    modele,
    assujetti: ctx.dossier.assujetti_tva,
    aujourdhui: ctx.aujourdhui,
    ouverture: null,
    anneesValidees: [],
    categories: categorie ? [{ ...categorie, libelle: '' }] : [],
    caisse,
    natureDesRecettesDuClient: ctx.dossier.categorie_recettes_client,
  }
}

// ── Le formulaire, et ce qui en part ──────────────────────────────────────────────────────────────────────────────────

export type GenreDuClient = 'recette' | 'apport' | 'prelevement'

/** Les genres que le client saisit — ceux d'`enregistrer_operation_caisse`, sous ses mots à lui. */
export const GENRES_DU_CLIENT: readonly { genre: GenreDuClient; libelle: string }[] = GENRES_SAISIS.map((genre) => ({
  genre: genre as GenreDuClient,
  libelle: genre === 'recette' ? 'Recettes en espèces du jour' : genre === 'apport' ? 'Apport de ta poche' : 'Prélèvement pour toi',
}))

/** Ce que le praticien a tapé, tel quel. */
export interface FormulaireDuClient { genre: GenreDuClient; date: string; montant: string }

/**
 * La saisie telle qu'elle PART à `enregistrer_operation_caisse` ou `remplacer_operation_caisse` : aucune catégorie, aucun
 * taux, aucune écriture (la base les pose) ; pour une recette, l'ensemble du jour que la lecture a rendu, vide sans jour lu.
 */
export function saisieDuFormulaire(f: FormulaireDuClient, jours: readonly JourDeLaCaisseDuClient[]): SaisieDeCaisse {
  const lu = lireLeMontantSaisi(f.montant)
  return {
    genre: f.genre,
    date: f.date === '' ? null : f.date,
    montant: typeof lu === 'number' ? lu : null,
    categorie_id: null,
    taux_tva: null,
    encaissements_du_jour: f.genre === 'recette' ? [...(jours.find((j) => j.jour === f.date)?.encaissements_du_jour ?? [])] : null,
    ecritures: null,
  }
}

export type VerdictDuClient =
  | { etat: 'vide' }
  | { etat: 'illisible'; message: string }
  | { etat: 'refuse'; message: string; saisie: SaisieDeCaisse }
  | { etat: 'permis'; saisie: SaisieDeCaisse; soldeApres: number }

/** Une date hors de l'année affichée : la lecture ne porte que celle-là (l'ensemble du jour, la caisse). */
export function horsDeLAnnee(annee: number): string {
  return `Choisis une date de ${annee} : la caisse affichée est celle de ${annee}. Pour une autre année, change l’année en haut.`
}

/**
 * Le verdict du formulaire, avant le clic : le refus de la base sur la saisie TELLE QU'ELLE PART — celui
 * d'`enregistrer_operation_caisse`, ou, pour une correction (`remplace`), celui de `remplacer_operation_caisse` —, aux mots
 * du client ; permis, avec la caisse du jour après la saisie (pour la confirmation).
 */
export function verdictDuFormulaire(
  f: FormulaireDuClient, annee: number, jours: readonly JourDeLaCaisseDuClient[], dossier: DossierDeLaCaisse, remplace: string | null,
): VerdictDuClient {
  if (f.date === '' || f.montant.trim() === '') return { etat: 'vide' }
  if (lireLeMontantSaisi(f.montant) === 'illisible') return { etat: 'illisible', message: MONTANT_ILLISIBLE }
  const saisie = saisieDuFormulaire(f, jours)
  if (f.date.slice(0, 4) !== String(annee) || !/^\d{4}-\d{2}-\d{2}$/.test(f.date)) {
    return { etat: 'refuse', message: horsDeLAnnee(annee), saisie }
  }
  const juge = remplace == null
    ? jugerLaSaisie(saisie, dossier, false, 'saisie')
    : jugerLeRemplacement(remplace, saisie, dossier, 'maintenant', 'saisie')
  if (juge.refus) return { etat: 'refuse', message: pourLEspace('client', juge.refus.message), saisie }
  return { etat: 'permis', saisie, soldeApres: soldeAuJour(juge.caisse, f.date) }
}

// ── La saisie d'un mois (C12A-Q1) ─────────────────────────────────────────────────────────────────────────────────────
// Comme l'onglet Caisse du cabinet (lib/caisseEcran.ts, `verdictDuMois`), en plusieurs lignes, tout ou rien : la base écrit
// toutes les opérations ou aucune, et la caisse jamais négative se juge à la FIN de la saisie (un jour qui retire avant
// qu'un autre ajoute passe). Les lignes du client sont celles du formulaire d'un jour : le genre, le jour, le montant.

/** Une ligne du mois entièrement vide : rien de tapé, rien à envoyer. */
export function ligneVideDuClient(l: FormulaireDuClient): boolean {
  return l.date === '' && l.montant.trim() === ''
}

/**
 * Une opération telle qu'elle PART dans le tableau d'`enregistrer_operations_de_caisse` : le genre, le jour, le montant —
 * aucune catégorie, aucun taux, aucune écriture (la base les pose) ; pour une recette seulement, l'ensemble du jour que la
 * lecture a rendu (vide sans jour lu), que la base EXIGE d'une recette (« une liste d'identifiants, vide s'il n'y en a
 * aucun ») ; un apport ou un prélèvement n'en porte pas.
 */
export function operationDuMois(l: FormulaireDuClient, jours: readonly JourDeLaCaisseDuClient[]): Record<string, unknown> {
  const s = saisieDuFormulaire(l, jours)
  const operation: Record<string, unknown> = { genre: s.genre, date: s.date, montant: s.montant }
  if (s.genre === 'recette') operation.encaissements_du_jour = s.encaissements_du_jour
  return operation
}

/** Ce que la confirmation d'un mois nomme : combien, ce qui entre et sort, et la caisse du dernier jour saisi, après. */
export interface ResumeDuMois { nombre: number; entree: number; sortie: number; dernierJour: string; soldeApres: number }

export type VerdictDuMoisDuClient =
  | { etat: 'vide' }
  | { etat: 'illisible'; message: string }
  | { etat: 'refuse'; message: string; operations: Record<string, unknown>[] }
  | { etat: 'permis'; operations: Record<string, unknown>[]; resume: ResumeDuMois }

/**
 * Le verdict de la saisie d'un mois, avant le clic : le tableau TEL QU'IL PART (les lignes vides EN FIN écartées — une ligne
 * vide au milieu est une ligne, que son rang nomme), jugé par `jugerLaSaisieDUnMois` sur le dossier du client et sa caisse
 * rejouée, aux mots du client ; permis, avec ce que la confirmation nomme. La seule règle propre à l'écran est celle du
 * formulaire d'un jour : un jour hors de l'année affichée (la lecture ne porte que celle-là), nommé par son rang et son jour.
 */
export function verdictDuMoisDuClient(
  lignes: readonly FormulaireDuClient[], annee: number, jours: readonly JourDeLaCaisseDuClient[], dossier: DossierDeLaCaisse,
): VerdictDuMoisDuClient {
  let n = lignes.length
  while (n > 0 && ligneVideDuClient(lignes[n - 1])) n--
  if (n === 0) return { etat: 'vide' }
  const operations: Record<string, unknown>[] = []
  for (let i = 0; i < n; i++) {
    if (lireLeMontantSaisi(lignes[i].montant) === 'illisible') return { etat: 'illisible', message: `Opération n° ${i + 1} : ${MONTANT_ILLISIBLE}` }
    operations.push(operationDuMois(lignes[i], jours))
  }
  for (let i = 0; i < n; i++) {
    const date = lignes[i].date
    if (date !== '' && (date.slice(0, 4) !== String(annee) || !/^\d{4}-\d{2}-\d{2}$/.test(date))) {
      return { etat: 'refuse', message: `Opération n° ${i + 1}, du ${jourDit(date)} : ${horsDeLAnnee(annee)}`, operations }
    }
  }
  const juge = jugerLaSaisieDUnMois(operations, dossier)
  if (juge.refus) return { etat: 'refuse', message: pourLEspace('client', juge.refus.message), operations }
  const parSens = (sortie: boolean) => operations.reduce((total, o) => {
    const c = centimes(o.montant as number)
    const sort = o.genre === 'prelevement' || c < 0
    return sort === sortie ? total + Math.abs(c) : total
  }, 0)
  const dernierJour = operations.map((o) => o.date as string).sort().at(-1)!
  return {
    etat: 'permis', operations,
    resume: { nombre: operations.length, entree: parSens(false), sortie: parSens(true), dernierJour, soldeApres: soldeAuJour(juge.caisse, dernierJour) },
  }
}

/** La confirmation d'un mois : combien d'opérations, ce qui entre et sort, la caisse du dernier jour après — tout ou rien. */
export function confirmationDuMois(r: ResumeDuMois): string {
  const operations = `${r.nombre} opération${r.nombre > 1 ? 's' : ''}`
  return `Enregistrer ${operations} d’un coup ? Elle${r.nombre > 1 ? 's font' : ' fait'} entrer ${euros(r.entree)} dans ta caisse `
    + `et en sortir ${euros(r.sortie)} ; ta caisse du ${jourDit(r.dernierJour)} passera à ${euros(r.soldeApres)}. Tout part `
    + `ensemble, ou rien. Ton cabinet ${r.nombre > 1 ? 'les' : 'la'} voit aussitôt.`
}

/** Le refus de la base pour le retrait de cette opération, aux mots du client ; ou rien. */
export function refusDuRetraitDuClient(operationId: string, dossier: DossierDeLaCaisse): string | null {
  const r: RefusCaisse | null = jugerLeRetrait(operationId, dossier, 'maintenant').refus
  return r ? pourLEspace('client', r.message) : null
}

// ── Les mots ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Une opération nommée pour le client : son genre, son jour, son montant — jamais sa nature ni une pièce. */
export function nomPourLeClient(o: Pick<OperationCaisse, 'genre' | 'date' | 'montant'>, article: 'le' | 'un' = 'le'): string {
  return nomDeLOperation({ ...o, categorie_id: null }, [], article)
}

/** La confirmation d'une saisie : elle nomme ce qui part, et ce que devient la caisse de ce jour-là. */
export function confirmationDeLaSaisie(saisie: SaisieDeCaisse, soldeApres: number): string {
  const op = { genre: saisie.genre as OperationCaisse['genre'], date: saisie.date ?? '', montant: saisie.montant ?? 0 }
  return `Enregistrer ${nomPourLeClient(op, 'un')} ? Ta caisse du ${jourDit(op.date)} passera à ${euros(soldeApres)}. `
    + 'Ton cabinet la voit aussitôt.'
}

/** La confirmation d'une correction : l'ancienne saisie, retirée, et la nouvelle, à sa place. */
export function confirmationDeLaCorrection(ancienne: OperationDuClient, saisie: SaisieDeCaisse, soldeApres: number): string {
  const nouvelle = { genre: saisie.genre as OperationCaisse['genre'], date: saisie.date ?? '', montant: saisie.montant ?? 0 }
  return `Remplacer ${nomPourLeClient(ancienne)} par ${nomPourLeClient(nouvelle, 'un')} ? L’ancienne reste dans l’historique `
    + `de ta caisse, retirée. Ta caisse du ${jourDit(nouvelle.date)} passera à ${euros(soldeApres)}.`
}

/** La confirmation d'un retrait : ce qui part, et ce que devient la caisse de ce jour-là. */
export function confirmationDuRetrait(o: OperationDuClient, caisse: EtatDeLaCaisse): string {
  const apres = soldeAuJour(sansLOperation(caisse, o.id, 'maintenant'), o.date)
  return `Retirer ${nomPourLeClient(o)} ? Elle reste dans l’historique de ta caisse, retirée. Ta caisse du ${jourDit(o.date)} `
    + `passera à ${euros(apres)}.`
}

/** Qui a saisi une opération, pour le client. */
export function auteurPourLeClient(o: Pick<OperationDuClient, 'origine' | 'cree_par'>, moi: string): string {
  if (o.origine === 'cabinet') return 'saisie par ton cabinet'
  return o.cree_par === moi ? 'saisie par toi' : 'saisie depuis un autre accès'
}

/** La correction d'une opération s'offre-t-elle ? Les siennes seulement, ni retirées ni payant une pièce. */
export function corrigeableParLeClient(o: OperationDuClient, moi: string): boolean {
  return o.origine === 'client' && o.cree_par === moi && o.retire_le == null && (GENRES_SAISIS as readonly string[]).includes(o.genre)
}

// ── Le mois, jour par jour ────────────────────────────────────────────────────────────────────────────────────────────

/** Une ligne d'un jour, pour le client. */
export type LigneDuJourDuClient =
  | { nature: 'report'; centimes: number }
  | { nature: 'ouverture'; centimes: number }
  | { nature: 'operation'; centimes: number; operation: OperationDuClient }
  | { nature: 'releve'; centimes: number }
  | { nature: 'especes'; centimes: number }

export interface JourDuMois { jour: string; lignes: LigneDuJourDuClient[]; solde: number; fige: boolean }

/** Les mots d'une ligne qui n'est pas une opération. */
export function libelleDeLaLigne(l: Exclude<LigneDuJourDuClient, { nature: 'operation' }>, jour: string): string {
  switch (l.nature) {
    case 'report': return `Ta caisse au 31/12/${Number(jour.slice(0, 4)) - 1}, reportée`
    case 'ouverture': return 'Ouverture de ta caisse (reprise par ton cabinet)'
    case 'releve': return l.centimes < 0 ? 'Versé à ta banque' : 'Retiré de ta banque pour ta caisse'
    case 'especes': return l.centimes < 0 ? 'Espèces de tes factures, rendues' : 'Espèces de tes factures, déjà dans ta caisse'
  }
}

/**
 * Les jours d'un mois (`mois` : AAAA-MM) que la lecture porte, du plus ancien au plus récent : chaque flux du jour — le report,
 * l'ouverture, les opérations non retirées une à une (dans l'ordre de leur saisie), le relevé, les espèces des factures — et
 * le solde LU à la fin du jour.
 */
export function joursDuMois(jours: readonly JourDeLaCaisseDuClient[], operations: readonly OperationDuClient[], mois: string): JourDuMois[] {
  return jours.filter((j) => j.jour.startsWith(mois)).sort((a, b) => a.jour.localeCompare(b.jour)).map((j) => {
    const lignes: LigneDuJourDuClient[] = []
    if (centimes(j.report) !== 0) lignes.push({ nature: 'report', centimes: centimes(j.report) })
    if (centimes(j.ouverture) !== 0) lignes.push({ nature: 'ouverture', centimes: centimes(j.ouverture) })
    for (const o of operations.filter((x) => x.date === j.jour && x.retire_le == null)
      .sort((a, b) => a.cree_le.localeCompare(b.cree_le) || a.id.localeCompare(b.id))) {
      lignes.push({ nature: 'operation', centimes: (o.genre === 'prelevement' ? -1 : 1) * centimes(o.montant), operation: o })
    }
    if (centimes(j.releve) !== 0) lignes.push({ nature: 'releve', centimes: centimes(j.releve) })
    if (centimes(j.especes_des_factures) !== 0) lignes.push({ nature: 'especes', centimes: centimes(j.especes_des_factures) })
    return { jour: j.jour, lignes, solde: centimes(j.solde), fige: j.fige }
  })
}

/** Le solde LU à la fin d'un jour : celui du dernier jour lu au plus tard ce jour-là (zéro avant le premier). */
export function soldeLuAu(jours: readonly JourDeLaCaisseDuClient[], jour: string): number {
  let solde = 0
  for (const j of [...jours].sort((a, b) => a.jour.localeCompare(b.jour))) {
    if (j.jour > jour) break
    solde = centimes(j.solde)
  }
  return solde
}

/** Les opérations retirées ou remplacées d'un mois, de la plus récemment retirée à la plus ancienne. */
export function retireesDuMois(operations: readonly OperationDuClient[], mois: string): OperationDuClient[] {
  return operations.filter((o) => o.retire_le != null && o.date.startsWith(mois))
    .sort((a, b) => (b.retire_le ?? '').localeCompare(a.retire_le ?? '') || a.id.localeCompare(b.id))
}

/** Ce que devient une opération retirée : remplacée (par la version qui la suit), ou retirée. */
export function devenirDeLaRetiree(o: OperationDuClient, operations: readonly OperationDuClient[]): string {
  const suivante = operations.find((x) => x.remplace_id === o.id)
  return suivante ? `remplacée par ${nomPourLeClient(suivante, 'un')}` : 'retirée'
}

// LE RAPPEL FIXE de la conception (§ 7) : le brouillard reste chez le praticien, et aucun nom n'entre ici.
export const RAPPEL_DU_BROUILLARD = 'Garde ton brouillard : le détail, recette par recette, reste chez toi. Aucun nom ici.'

export const MOIS_DE_L_ANNEE = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
] as const
