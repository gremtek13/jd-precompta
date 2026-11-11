// LES LETTRES DE MISSION (ligne 47, lot LM4 ; LM-Q2 à LM-Q6 et LM-Q10 du 11/11/2026). Le cabinet range ses modèles et
// les lettres de mission de ses clients dans son propre dossier (LM1) : un modèle ne se modifie pas, il se remplace ou se
// retire ; une lettre se rédige en brouillon, FIGE à sa proposition — ses missions, la répartition des tâches, ses
// honoraires, sa durée, son signataire, les clauses que ses missions exigent, l'identité du client lue de son dossier et
// celle du cabinet, et l'empreinte que la BASE calcule de ce contenu —, puis reçoit une réponse (acceptée sur un papier
// signé, ou refusée) et se retire ; une nouvelle version la remplace, jamais une réécriture. L'acceptation EN LIGNE est
// prévue par le schéma et fermée par la base tant que le droit de rétractation n'est pas tranché (LM-Q10).
// La base tient la règle (la migration `lettres_de_mission`, PRÉPARÉE le 11/11/2026, supabase/preparees/) ; ce module la
// redit, pur, pour l'écran de LM5 : le catalogue, les refus de chaque fonction dans leur ordre et à leurs mots, et ce qui
// se DÉDUIT (l'état d'une lettre, les lettres en vigueur d'un client à une date). Rien ne s'en lit tant que le drapeau
// est baissé. Récit : HISTORIQUE.md, « 11/11/2026 — LM4 ». Sources : décret n° 2012-432, art. 151 et 158 (Légifrance,
// relus le 11/11/2026) ; CGI, art. 289, I-2 ; RGPD, art. 28 ; C. civ., art. 1366 et 1367.

/** Levé le jour où la migration `lettres_de_mission` est en production (son fichier dans supabase/schema/). */
export const LETTRES_DE_MISSION_PREVUES: boolean = false

/** Le drapeau de la base, `acceptation_en_ligne_ouverte()` : faux jusqu'à la réponse sur le droit de rétractation. */
export const ACCEPTATION_EN_LIGNE_OUVERTE: boolean = false

/** Le catalogue fermé des missions (`missions_de_lettre`), dans son ordre. */
export const MISSIONS = [
  'tenue_comptable', 'presentation_des_comptes', 'declaration_2035', 'declarations_tva', 'volet_social',
  'facturation_au_nom_du_client', 'relances_des_clients',
] as const
export type Mission = (typeof MISSIONS)[number]

/** Les clauses qu'un modèle porte (`clauses_de_lettre`). */
export const CLAUSES = ['mandat_de_facturation', 'sous_traitance'] as const
export type Clause = (typeof CLAUSES)[number]

/** Les formes d'une ligne d'honoraires ; le temps passé, admis par la forme, refusé à la proposition jusqu'à LM9. */
export const FORMES_D_HONORAIRES = ['forfait', 'tache', 'temps'] as const
export const PERIODICITES = ['mois', 'trimestre', 'annee'] as const
export const LIVRABLES = ['declaration_2035', 'declaration_tva', 'bilan', 'autre'] as const

/**
 * Les clauses que les missions exigent (`clauses_requises`) — HYPOTHÈSE LM4-Q1 : la sous-traitance (RGPD, art. 28) de
 * toute lettre, le mandat de facturation (CGI, art. 289, I-2) de la mission qui facture au nom du client.
 */
export function clausesRequises(missions: readonly string[]): Clause[] {
  return missions.includes('facturation_au_nom_du_client') ? ['mandat_de_facturation', 'sous_traitance'] : ['sous_traitance']
}

interface Refus { cle: string; code: string; modele: string }

const ACCES: Refus = { cle: 'acces', code: '42501', modele: 'Accès refusé à ce dossier.' }
const CABINET: Refus = { cle: 'horsDuDossierDuCabinet', code: '23514', modele: 'Les lettres de mission se rédigent dans le dossier du cabinet.' }
const INTROUVABLE: Refus = { cle: 'introuvable', code: 'P0002', modele: 'Lettre introuvable dans ce dossier.' }
const RETIREE: Refus = { cle: 'retiree', code: '22023', modele: 'Cette lettre est retirée.' }
const CLIENT_DU_CABINET: Refus = {
  cle: 'clientHorsDuCabinet', code: '22023', modele: 'Le client est un dossier de ce cabinet, autre que le dossier du cabinet.',
}
const MEME_CLIENT = 'Une nouvelle version garde le client de la lettre qu’elle remplace.'

/** Les refus de `enregistrer_modele_de_lettre`, dans l'ordre de la fonction, à ses mots et à son code. */
export const REFUS_DU_MODELE: readonly Refus[] = [
  ACCES, CABINET,
  { cle: 'titre', code: '22023', modele: 'Un modèle porte un titre de 200 caractères au plus.' },
  { cle: 'conditions', code: '22023', modele: 'Un modèle porte ses conditions générales, en 100 000 caractères au plus.' },
  { cle: 'missions', code: '22023', modele: 'Un modèle décrit au moins une mission du catalogue, chacune en 4 000 caractères au plus.' },
  { cle: 'clauses', code: '22023', modele: 'Une clause d’un modèle est le mandat de facturation ou la sous-traitance, en 8 000 caractères au plus.' },
  { cle: 'remplaceHorsDuDossier', code: '22023', modele: 'Le modèle à remplacer n’est pas un modèle de ce dossier.' },
  { cle: 'remplaceDepuis', code: '22023', modele: 'Ce modèle a été remplacé depuis : relire avant de le remplacer.' },
  { cle: 'remplaceRetire', code: '22023', modele: 'Ce modèle est retiré : il ne se remplace plus.' },
]

/** Les refus de `retirer_modele_de_lettre`. */
export const REFUS_DU_RETRAIT_DU_MODELE: readonly Refus[] = [
  ACCES, CABINET,
  { cle: 'introuvable', code: 'P0002', modele: 'Modèle introuvable dans ce dossier.' },
  { cle: 'remplaceDepuis', code: '22023', modele: 'Ce modèle a été remplacé depuis : relire avant de le retirer.' },
  { cle: 'dejaRetire', code: '22023', modele: 'Ce modèle est déjà retiré.' },
]

/** Les refus de `enregistrer_brouillon_de_lettre` : le contenu, puis une lettre nouvelle, puis une lettre réécrite. */
export const REFUS_DU_BROUILLON: readonly Refus[] = [
  ACCES, CABINET,
  { cle: 'contenu', code: '22023', modele: 'Le contenu de la lettre est illisible : un objet aux seules clés de la lettre.' },
  { cle: 'missions', code: '22023', modele: 'Une mission de la lettre n’est pas du catalogue, ou y figure deux fois.' },
  { cle: 'repartition', code: '22023', modele: 'La répartition des tâches est illisible : des tâches de 500 caractères au plus, au cabinet ou au client.' },
  {
    cle: 'honoraires', code: '22023',
    modele: 'Les honoraires sont illisibles : un forfait périodique, un prix par tâche ou un taux horaire, hors taxes, au centime.',
  },
  {
    cle: 'dates', code: '22023',
    modele: 'Les dates de la lettre sont entre 2000 et 2100, et sa première période ne finit pas avant sa date d’effet.',
  },
  { cle: 'preavis', code: '22023', modele: 'Le préavis tient en douze mois au plus.' },
  { cle: 'signataire', code: '22023', modele: 'Le nom et la qualité du signataire tiennent en 200 caractères chacun.' },
  CLIENT_DU_CABINET,
  { cle: 'modeleHorsDuDossier', code: '22023', modele: 'Ce modèle n’est pas un modèle de ce dossier.' },
  { cle: 'remplaceeNonProposee', code: '22023', modele: 'La lettre à remplacer n’est pas une lettre proposée de ce dossier.' },
  { cle: 'memeClient', code: '22023', modele: MEME_CLIENT },
  { cle: 'suiteVivante', code: '22023', modele: 'Cette lettre a déjà une nouvelle version en cours : la reprendre, ou la retirer d’abord.' },
  INTROUVABLE,
  { cle: 'proposee', code: '22023', modele: 'Cette lettre est proposée : elle ne se modifie plus, une nouvelle version la remplace.' },
  RETIREE,
  { cle: 'versionLue', code: '22023', modele: 'La lettre a changé depuis sa lecture : relire avant de l’enregistrer.' },
  { cle: 'remplacementChange', code: '22023', modele: 'Une lettre garde la lettre qu’elle remplace : en remplacer une autre est une nouvelle lettre.' },
  { cle: 'memeClientReecrit', code: '22023', modele: MEME_CLIENT },
]

/** Les refus de `proposer_lettre_de_mission`, dans l'ordre de la fonction. */
export const REFUS_DE_LA_PROPOSITION: readonly Refus[] = [
  ACCES, CABINET, INTROUVABLE,
  { cle: 'dejaProposee', code: '22023', modele: 'Cette lettre est déjà proposée.' },
  RETIREE,
  { cle: 'versionLue', code: '22023', modele: 'La lettre a changé depuis sa lecture : relire avant de la proposer.' },
  { cle: 'sansClient', code: '22023', modele: 'La lettre désigne le dossier de son client.' },
  CLIENT_DU_CABINET,
  { cle: 'adresseDuClient', code: '22023', modele: 'L’adresse du client manque à son dossier : la renseigner avant de proposer la lettre.' },
  { cle: 'sansModele', code: '22023', modele: 'La lettre suit un modèle du cabinet.' },
  { cle: 'modeleNonCourant', code: '22023', modele: 'Le modèle de la lettre a été remplacé ou retiré : choisir sa version courante.' },
  { cle: 'sansMission', code: '22023', modele: 'La lettre définit au moins une mission.' },
  { cle: 'missionNonDecrite', code: '22023', modele: 'Une mission de la lettre n’est pas décrite par son modèle.' },
  { cle: 'clauseSansTexte', code: '22023', modele: 'Le modèle ne porte pas le texte d’une clause que les missions de la lettre exigent.' },
  { cle: 'sansRepartition', code: '22023', modele: 'La lettre répartit les tâches entre le cabinet et le client.' },
  { cle: 'sansHonoraires', code: '22023', modele: 'La lettre fixe ses honoraires.' },
  { cle: 'tempsPasse', code: '22023', modele: 'Le temps passé ne se facture pas encore : un forfait périodique ou un prix par tâche.' },
  { cle: 'duree', code: '22023', modele: 'La lettre dit sa date d’effet, son premier exercice et la fin de sa première période.' },
  { cle: 'sansSignataire', code: '22023', modele: 'La lettre désigne son signataire.' },
  { cle: 'compteDuSignataire', code: '22023', modele: 'Le compte du signataire n’est pas un accès du dossier du client.' },
  {
    cle: 'identiteDuCabinet', code: '22023',
    modele: 'L’identité du dossier du cabinet manque : son SIRET et son adresse, avant de proposer la lettre.',
  },
]

/** Les refus de `enregistrer_reponse_a_la_lettre` (le papier signé, ou le refus, enregistrés par le cabinet). */
export const REFUS_DE_LA_REPONSE: readonly Refus[] = [
  ACCES, CABINET,
  { cle: 'reponse', code: '22023', modele: 'La réponse est une acceptation sur papier signé, ou un refus.' },
  INTROUVABLE,
  { cle: 'nonProposee', code: '22023', modele: 'Cette lettre n’est pas proposée : un brouillon ne s’accepte ni ne se refuse.' },
  RETIREE,
  { cle: 'dejaRepondue', code: '22023', modele: 'Cette lettre a déjà sa réponse.' },
  { cle: 'suiteVivante', code: '22023', modele: 'Cette lettre a une nouvelle version en cours : c’est elle qui reçoit la réponse.' },
  { cle: 'papierHorsDuDossier', code: '22023', modele: 'Le papier signé est un document du dossier du cabinet.' },
  { cle: 'papierSansEmpreinte', code: '22023', modele: 'Le papier signé se cite par son empreinte : le déposer de nouveau.' },
  { cle: 'dateDeSignature', code: '22023', modele: 'La date de signature suit la proposition et ne dépasse pas aujourd’hui.' },
  { cle: 'refusCitant', code: '22023', modele: 'Un refus ne cite ni papier signé ni date de signature.' },
]

/** Les refus de `retirer_lettre_de_mission`. */
export const REFUS_DU_RETRAIT: readonly Refus[] = [
  ACCES, CABINET, INTROUVABLE,
  { cle: 'dejaRetiree', code: '22023', modele: 'Cette lettre est déjà retirée.' },
  { cle: 'refusee', code: '22023', modele: 'Cette lettre est refusée : elle a pris fin, rien ne se retire.' },
  { cle: 'suiteVivante', code: '22023', modele: 'Cette lettre a une nouvelle version en cours : la retirer d’abord.' },
  { cle: 'resiliationSansDate', code: '22023', modele: 'Une lettre acceptée se résilie à une date, au plus tôt sa date d’effet.' },
  {
    cle: 'dateSansAcceptation', code: '22023',
    modele: 'Seule une lettre acceptée se résilie à une date : un brouillon ou une proposition se retire sans date.',
  },
]

/** Ce que l'écran lit d'une lettre (les colonnes de `lettres_de_mission` qui disent son histoire). Dates civiles AAAA-MM-JJ. */
export interface LettreLue {
  id: string
  remplace_id: string | null
  dossier_client_id: string | null
  date_effet: string | null
  fin_initiale: string | null
  reconduction_tacite: boolean
  proposee_le: string | null
  acceptee_le: string | null
  refusee_le: string | null
  retiree_le: string | null
  fin_au: string | null
}

export type EtatDeLaLettre = 'brouillon' | 'proposee' | 'acceptee' | 'echue' | 'refusee' | 'retiree' | 'resiliee'

/**
 * L'état d'une lettre, DÉDUIT de son histoire, jamais stocké : refusée ; retirée (un brouillon ou une proposition) ou
 * résiliée (une lettre acceptée, à sa date de fin) ; acceptée, ou échue — sans reconduction tacite, passé la fin de sa
 * première période ; proposée ; brouillon. `aujourdhui` est une date civile, que l'appelant lit (jamais au chargement).
 */
export function etatDeLaLettre(l: LettreLue, aujourdhui: string): EtatDeLaLettre {
  if (l.refusee_le !== null) return 'refusee'
  if (l.retiree_le !== null) return l.acceptee_le !== null ? 'resiliee' : 'retiree'
  if (l.acceptee_le !== null) {
    return !l.reconduction_tacite && l.fin_initiale !== null && l.fin_initiale < aujourdhui ? 'echue' : 'acceptee'
  }
  return l.proposee_le !== null ? 'proposee' : 'brouillon'
}

/**
 * Les lettres EN VIGUEUR d'un client à une date : acceptées, d'effet atteint, ni résiliées avant cette date, ni échues,
 * ni remplacées par une version ACCEPTÉE d'effet atteint (un avenant). Plusieurs lettres peuvent valoir ensemble (deux
 * chaînes : deux missions séparées). Sur des lettres lues EN ENTIER : une lecture partielle ne dit rien d'ici.
 */
export function lettresEnVigueur(lettres: readonly LettreLue[], dossierClientId: string, date: string): LettreLue[] {
  const effective = (l: LettreLue) => l.acceptee_le !== null && l.date_effet !== null && l.date_effet <= date
  return lettres.filter((l) => l.dossier_client_id === dossierClientId && effective(l)
    && !(l.fin_au !== null && l.fin_au < date)
    && !(!l.reconduction_tacite && l.fin_initiale !== null && l.fin_initiale < date)
    && !lettres.some((s) => s.remplace_id === l.id && s.refusee_le === null && effective(s)))
}

/** Les mots d'un refus de la base, par sa clé, dans une liste de refus du module. */
export function motsDuRefus(liste: readonly Refus[], cle: string): string {
  const refus = liste.find((r) => r.cle === cle)
  if (!refus) throw new Error(`Refus inconnu : ${cle}`)
  return refus.modele
}
