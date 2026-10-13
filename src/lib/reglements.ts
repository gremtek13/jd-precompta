import { pastilleDeclaration } from './encaissementsAffichage'
import {
  ETATS_DECLARANTS, MOYENS_ENCAISSEMENT, echeanceDeDeclaration, encaissementsDeclares, obligationEncaissee,
  plateformeDeLaDeclaration, refusDeclaration,
} from './encaissementsFactures'
import { estLeClient, etatDuFiltre, type AccesDuDossier } from './auteursVentes'
import { pourLEspace, type EspaceVentes } from './espaceVentes'
import { formatDate } from './format'
import { periodeDe } from './periodesEreporting'
import { champCsv } from './pisteAudit'
import type { ListesDesVentes } from './tuilesVentes'
import type { LigneBancaire, MoyenEncaissement, StatutTva } from './types'

// LES RÈGLEMENTS D'UN DOSSIER (espace client, étape A3 ; conception : HISTORIQUE.md, « L'ESPACE CLIENT, LOGICIEL DE GESTION
// DU CLIENT : LE PREMIER GROUPE, LA PARITÉ, ET AU-DELÀ », §A.2) : la LISTE de tous les encaissements du registre (ligne
// 28.5, d1 à d4), une ligne par encaissement ou contre-passation, telle que la base la garde — la contre-passation de
// montant négatif, le retiré marqué. Rien ne s'écrit d'ici : chaque ligne ouvre la fenêtre « Encaissements » de sa facture,
// qui fait tout sous ses refus et son verrou.
//
// RIEN N'Y EST JUGÉ À NOUVEAU. La déclaration du statut « Encaissée » d'un encaissement se dit par ce que les modules de d3
// et d4 décident déjà : `pastilleDeclaration` (encaissementsAffichage.ts), appelée sur CET encaissement seul — elle dit
// « À déclarer » ou « Déclaration en retard » exactement quand la pastille de sa facture le dirait à cause de lui —,
// `encaissementsDeclares`, `obligationEncaissee` et `refusDeclaration` (encaissementsFactures.ts) pour le reste. Aucune
// règle n'est recopiée : une règle changée là change ici.
//
// UNE LECTURE PARTIELLE NE DONNE RIEN. Une seule des sources lue en partie — les factures, leurs transmissions, le
// registre (lignes, encaissements, parts), les déclarations et l'historique de Super PDP, les statuts lus, le relevé —, et
// il n'y a ni ligne, ni total, ni export : son motif. Un encaissement absent fausserait un total ; une déclaration absente
// ferait dire « À déclarer » d'un encaissement déclaré.
//
// Pur : aucun accès à la base (la lecture est dans reglementsLecture.ts).

// ── Ce que la liste lit en plus des ventes : le relevé ──────────────────────────────────────────────────────────────────

/** Un mouvement du relevé, tel que la liste le nomme. */
export type MouvementDuReglement = Pick<LigneBancaire, 'id' | 'date' | 'libelle'>

/**
 * Le relevé, tel que la liste l'a lu. HORS DE L'ACCÈS pour le client qui ne porte pas « Banque » : la base le lui refuse,
 * une lecture refusée par la RLS rend ZÉRO ligne sans erreur, et la liste ne le demande donc pas (la fenêtre des
 * encaissements fait de même).
 */
export type MouvementsDesReglements =
  | { etat: 'hors_acces' }
  | { etat: 'lus'; lignes: readonly MouvementDuReglement[]; complete: boolean; motif: string | null }

// ── Une ligne ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Ce que la fenêtre des encaissements dit d'un mouvement désigné que l'accès ne montre pas, mot pour mot. */
export const MOUVEMENT_HORS_ACCES = 'Un mouvement du relevé, que ton accès ne montre pas'

export type MouvementDeLaLigne =
  // Aucun mouvement désigné (espèces, compensation, chèque saisi sans son relevé…).
  | { etat: 'aucun' }
  // Désigné, et l'accès ne montre pas le relevé : il se DIT, jamais « — », qui le nierait.
  | { etat: 'hors_acces' }
  | { etat: 'lu'; date: string; libelle: string }
  // Désigné, absent d'un relevé pourtant lu en entier.
  | { etat: 'introuvable' }

export type EtatDeclaration = 'declaree' | 'a_declarer' | 'en_retard' | 'non_due' | 'pas_d_ici'

export const LIBELLES_DECLARATION: Record<EtatDeclaration, string> = {
  declaree: 'Déclarée',
  a_declarer: 'À déclarer',
  en_retard: 'Déclaration en retard',
  non_due: 'Non due',
  pas_d_ici: 'Ne se déclare pas d’ici',
}

export interface DeclarationDeLaLigne {
  etat: EtatDeclaration
  /** Où, avant quand, ou pourquoi — tel que les modules de d3 et d4 le disent. */
  detail: string | null
}

export interface LigneReglement {
  id: string
  factureId: string
  /** La date de l'encaissement, civile (AAAA-MM-JJ) ; celle du décaissement pour une contre-passation. */
  date: string
  numero: string | null
  /** Le client de la facture : son acheteur (`tiers_nom`). */
  client: string
  moyen: MoyenEncaissement
  /** En centimes, tel que la base le garde : NÉGATIF pour une contre-passation. */
  centimes: number
  contrePassation: boolean
  /** Un encaissement qu'une contre-passation non retirée annule. */
  contrePasse: boolean
  mouvement: MouvementDeLaLigne
  /** Nulle pour un retiré : il n'a jamais été déclaré, et ne se déclare plus. */
  declaration: DeclarationDeLaLigne | null
  etat: 'actif' | 'retire'
  retireLe: string | null
  /** Enregistré par un compte qui porte un accès client du dossier, sur des accès lus en entier (cabinet seul). */
  parLeClient: boolean
}

export type ReglementsDuDossier =
  // `accord` : le participe de `quoi`, tel que le bandeau d'une lecture partielle l'accorde.
  | { etat: 'partiels'; quoi: string; accord: 'lues' | 'lus'; motif: string }
  | { etat: 'lus'; lignes: LigneReglement[] }

export interface EntreeReglements {
  dossierId: string
  ventes: ListesDesVentes
  mouvements: MouvementsDesReglements
  /** Le statut de TVA du dossier aujourd'hui : l'obligation et l'échéance en dépendent. */
  statutTva: StatutTva | null
  /** Le jour À PARIS, lu au rendu : un retard l'est au jour de la base. */
  aujourdHui: string
  /** Les accès du dossier (cabinet) ; `ACCES_SANS_OBJET` dans l'espace du client, où rien n'est dit « par le client ». */
  acces: AccesDuDossier
}

const centimes = (euros: number) => Math.round(euros * 100)

/** La première source lue en partie, avec ce qu'elle est ; null quand tout est lu en entier. */
function premiereSourcePartielle(e: EntreeReglements): { quoi: string; accord: 'lues' | 'lus'; motif: string } | null {
  const v = e.ventes
  const sources: [string, 'lues' | 'lus', string | null][] = [
    ['Les factures du dossier', 'lues', v.facturesIncompletes],
    ['Les transmissions des factures', 'lues', v.transmissionsIncompletes],
    ['Les encaissements, leur répartition ou les lignes des factures', 'lus', v.encaissementsIncomplets],
    ['Les déclarations des encaissements ou l’historique de Super PDP', 'lues', v.declarationsIncompletes],
    ['Les statuts lus sur la plateforme du client', 'lus', v.statutsIncomplets],
    ['Les mouvements du relevé', 'lus', e.mouvements.etat === 'lus' && !e.mouvements.complete ? e.mouvements.motif ?? 'lecture incomplète' : null],
  ]
  const partielle = sources.find(([, , motif]) => motif != null)
  return partielle ? { quoi: partielle[0], accord: partielle[1], motif: partielle[2] as string } : null
}

/**
 * Les règlements du dossier : une ligne par encaissement ou contre-passation, retirés compris, du plus récent au plus
 * ancien (la date, puis l'enregistrement, puis l'identifiant : un ordre TOTAL). Partiels, avec le premier motif, dès
 * qu'une source n'est pas lue en entier.
 */
export function reglementsDuDossier(e: EntreeReglements): ReglementsDuDossier {
  const partielle = premiereSourcePartielle(e)
  if (partielle) return { etat: 'partiels', ...partielle }
  const v = e.ventes
  const declares = encaissementsDeclares(v.declarations)
  const lignes: LigneReglement[] = []
  for (const enc of v.encaissements) {
    const facture = v.factures.find((f) => f.id === enc.facture_id)
    // Les factures sont lues en entier : un encaissement dont la facture manque dit des lectures qui ne s'accordent pas.
    if (!facture) {
      return {
        etat: 'partiels', quoi: 'Les factures du dossier', accord: 'lues',
        motif: 'un encaissement désigne une facture que la lecture n’a pas rendue',
      }
    }
    const retire = enc.retire_le != null
    lignes.push({
      id: enc.id,
      factureId: facture.id,
      date: enc.date_encaissement,
      numero: facture.numero,
      client: facture.tiers_nom,
      moyen: enc.moyen,
      centimes: centimes(enc.montant),
      contrePassation: enc.annule_id != null,
      contrePasse: v.encaissements.some((a) => a.annule_id === enc.id && a.retire_le == null),
      mouvement: mouvementDe(enc.ligne_bancaire_id, e.mouvements),
      declaration: retire ? null : declarationDe(e, facture, enc, declares),
      etat: retire ? 'retire' : 'actif',
      retireLe: enc.retire_le,
      parLeClient: estLeClient(e.acces, enc.cree_par),
    })
  }
  const creeLe = new Map(v.encaissements.map((x) => [x.id, x.cree_le]))
  lignes.sort((a, b) => b.date.localeCompare(a.date)
    || (creeLe.get(b.id) ?? '').localeCompare(creeLe.get(a.id) ?? '')
    || a.id.localeCompare(b.id))
  return { etat: 'lus', lignes }
}

function mouvementDe(id: string | null, mouvements: MouvementsDesReglements): MouvementDeLaLigne {
  if (id == null) return { etat: 'aucun' }
  if (mouvements.etat === 'hors_acces') return { etat: 'hors_acces' }
  const m = mouvements.lignes.find((x) => x.id === id)
  return m ? { etat: 'lu', date: m.date, libelle: m.libelle } : { etat: 'introuvable' }
}

function declarationDe(
  e: EntreeReglements,
  facture: ListesDesVentes['factures'][number],
  enc: ListesDesVentes['encaissements'][number],
  declares: ReadonlySet<string>,
): DeclarationDeLaLigne {
  const v = e.ventes
  if (declares.has(enc.id)) {
    const d = v.declarations.find((x) => x.encaissement_id === enc.id && ETATS_DECLARANTS.includes(x.etat))
    return { etat: 'declaree', detail: d ? `sur ${d.hote}${d.etat === 'envoi' ? ' — issue inconnue' : ''}` : null }
  }
  // La pastille de la facture, sur CET encaissement seul : « À déclarer » ou « Déclaration en retard » exactement quand
  // elle le dirait à cause de lui.
  const pastille = pastilleDeclaration(
    e.dossierId, facture, v.lignes, [enc], v.declarations, v.transmissions, v.evenementsSuperpdp, v.statutsLus, e.statutTva,
    e.aujourdHui,
  )
  if (pastille) {
    const hote = plateformeDeLaDeclaration(enc, v.declarations, v.transmissions, v.evenementsSuperpdp)
    const echeance = echeanceDeDeclaration(enc.date_encaissement, e.statutTva)
    const ou = [hote ? `sur ${hote}` : null, echeance ? `au plus tard le ${formatDate(echeance.date)}` : null].filter(Boolean)
    return {
      etat: pastille.libelle === 'Déclaration en retard' ? 'en_retard' : 'a_declarer',
      detail: ou.length > 0 ? ou.join(', ') : null,
    }
  }
  const obligation = obligationEncaissee(facture, v.lignes, e.statutTva)
  // Sans objet ou facultative : l'administration ne l'attend pas (la fenêtre dit ce qui se déclare quand même).
  if (obligation.etat === 'sans_objet' || obligation.etat === 'facultative') return { etat: 'non_due', detail: obligation.raison }
  // Due, mais la base ne l'inscrirait pas d'ici (facture rejetée, aucune transmission acceptée) ; ou à préciser, ou refusée.
  const refus = obligation.etat === 'due'
    ? refusDeclaration(e.dossierId, enc.id, v.encaissements, v.declarations, v.transmissions, v.evenementsSuperpdp, v.statutsLus, null)
    : null
  return { etat: 'pas_d_ici', detail: refus?.message ?? obligation.raison }
}

// ── Les filtres ──────────────────────────────────────────────────────────────────────────────────────────────────────

export interface FiltresReglements {
  /** La période, bornes comprises (AAAA-MM-JJ) ; null : ouverte de ce côté. */
  du: string | null
  au: string | null
  moyen: MoyenEncaissement | null
  client: string | null
  etat: 'actif' | 'retire' | null
  declaration: EtatDeclaration | null
  /** Le cabinet seul : ce que le client a enregistré, sur des accès lus en entier. */
  parLeClient: boolean
}

export const SANS_FILTRE: FiltresReglements = {
  du: null, au: null, moyen: null, client: null, etat: null, declaration: null, parLeClient: false,
}

/**
 * Les lignes que les filtres retiennent. « Par le client » ne filtre que sur des accès lus EN ENTIER (`etatDuFiltre`) :
 * sinon la case est grisée, et cochée elle ne filtre plus — un accès retiré n'est jamais deviné, un auteur nul n'est
 * personne (lib/auteursVentes.ts).
 */
export function filtrerReglements(
  lignes: readonly LigneReglement[], f: FiltresReglements, acces: AccesDuDossier,
): LigneReglement[] {
  const parLeClient = f.parLeClient && etatDuFiltre(acces).disponible
  return lignes.filter((l) => (f.du == null || l.date >= f.du)
    && (f.au == null || l.date <= f.au)
    && (f.moyen == null || l.moyen === f.moyen)
    && (f.client == null || l.client === f.client)
    && (f.etat == null || l.etat === f.etat)
    && (f.declaration == null || l.declaration?.etat === f.declaration)
    && (!parLeClient || l.parLeClient))
}

/** Ce que la case « Enregistrés par le client » retient, et ce qu'elle ne reconnaît pas : un accès retiré n'est pas deviné. */
export const AIDE_DU_FILTRE_DES_REGLEMENTS =
  'Les encaissements et contre-passations enregistrés par un compte qui porte aujourd’hui un accès client du dossier. Un '
  + 'accès retiré depuis n’est plus reconnu : ce qu’il a enregistré n’y figure pas, et rien n’est dit « par le client » de lui.'

/** Pourquoi la case est grisée, dite des règlements ; null quand elle filtre (des accès lus en entier). */
export function raisonDuFiltreDesReglements(acces: AccesDuDossier): string | null {
  const filtre = etatDuFiltre(acces)
  if (filtre.disponible) return null
  return acces.etat === 'incomplets'
    ? `La liste des accès du dossier n’a pas été lue en entier (${acces.motif}) : on ne peut pas dire quels règlements sont du client.`
    : filtre.raison
}

/** Les clients (acheteurs) des lignes, une fois chacun, dans l'ordre alphabétique : les choix du filtre. */
export function clientsDesReglements(lignes: readonly LigneReglement[]): string[] {
  return [...new Set(lignes.map((l) => l.client))].sort((a, b) => a.localeCompare(b, 'fr'))
}

// ── Les mots ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export const libelleMoyen = (moyen: MoyenEncaissement): string =>
  MOYENS_ENCAISSEMENT.find((m) => m.moyen === moyen)?.libelle ?? moyen

/** Le mouvement en mots, tel que la fenêtre des encaissements le dit : « 15/10/2026 · libellé », la phrase de l'accès, ou « — ». */
export function mouvementEnMots(m: MouvementDeLaLigne): string {
  switch (m.etat) {
    case 'lu': return `${formatDate(m.date)} · ${m.libelle}`
    case 'hors_acces': return MOUVEMENT_HORS_ACCES
    case 'aucun':
    case 'introuvable': return '—'
  }
}

/** La déclaration en mots : son libellé, puis son détail ; « — » pour un retiré. */
export function declarationEnMots(d: DeclarationDeLaLigne | null, espace: EspaceVentes): string {
  if (d == null) return '—'
  return d.detail ? `${LIBELLES_DECLARATION[d.etat]} — ${pourLEspace(espace, d.detail)}` : LIBELLES_DECLARATION[d.etat]
}

/** Ce que la recherche lit d'une ligne : ce qui s'y affiche. Une recherche filtre l'AFFICHAGE, jamais un total ni l'export. */
export function champsDeRecherche(l: LigneReglement, espace: EspaceVentes): (string | number | null)[] {
  return [
    l.numero, l.client, libelleMoyen(l.moyen), l.date, formatDate(l.date), l.centimes / 100, mouvementEnMots(l.mouvement),
    declarationEnMots(l.declaration, espace), l.contrePassation ? 'Contre-passation' : 'Encaissement',
    l.etat === 'retire' ? 'Retiré' : 'Actif',
  ]
}

// ── Les totaux ───────────────────────────────────────────────────────────────────────────────────────────────────────

export interface TotalDuMoyen { moyen: MoyenEncaissement; libelle: string; nombre: number; centimes: number }
export interface TotalDuMois { mois: string; libelle: string; nombre: number; centimes: number }

export interface TotauxReglements {
  /** Le total des lignes qui COMPTENT : les retirés n'en sont pas, une contre-passation y vient en moins. */
  centimes: number
  nombre: number
  /** Les retirés de la liste, écartés des totaux. */
  retires: number
  parMoyen: TotalDuMoyen[]
  parMois: TotalDuMois[]
}

/**
 * Les totaux par moyen (dans l'ordre des moyens de paiement) et par mois (du plus ancien au plus récent), sur les lignes
 * DONNÉES — celles que les filtres retiennent, jamais celles de la recherche. Un retiré ne compte pas (il est au registre,
 * comme s'il n'avait pas été) ; une contre-passation compte, négative, dans le moyen de l'encaissement qu'elle annule.
 */
export function totauxDesReglements(lignes: readonly LigneReglement[]): TotauxReglements {
  const comptees = lignes.filter((l) => l.etat === 'actif')
  const parMoyen = MOYENS_ENCAISSEMENT
    .map(({ moyen, libelle }) => {
      const siennes = comptees.filter((l) => l.moyen === moyen)
      return { moyen, libelle, nombre: siennes.length, centimes: siennes.reduce((s, l) => s + l.centimes, 0) }
    })
    .filter((t) => t.nombre > 0)
  const mois = [...new Set(comptees.map((l) => l.date.slice(0, 7)))].sort()
  const parMois = mois.map((m) => {
    const siennes = comptees.filter((l) => l.date.slice(0, 7) === m)
    return {
      mois: m,
      libelle: periodeDe(`${m}-01`, 'mois')?.libelle ?? m,
      nombre: siennes.length,
      centimes: siennes.reduce((s, l) => s + l.centimes, 0),
    }
  })
  return {
    centimes: comptees.reduce((s, l) => s + l.centimes, 0),
    nombre: comptees.length,
    retires: lignes.length - comptees.length,
    parMoyen,
    parMois,
  }
}

// ── L'export ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const COLONNES_CSV = ['Date', 'Facture', 'Client', 'Nature', 'Moyen', 'Montant', 'Mouvement', 'Déclaration', 'État']

// Comme les autres exports de l'application (piste d'audit, détail de l'e-reporting) : point-virgule, virgule décimale,
// des montants sans symbole ni espace insécable qu'un tableur lit comme des nombres, des dates AAAA-MM-JJ.
const montantCsv = (c: number): string => (c / 100).toFixed(2).replace('.', ',')

/**
 * Les lignes DONNÉES en CSV — celles que les filtres retiennent, jamais celles de la recherche — : BOM UTF-8 (sans lui,
 * Excel en français lit les accents de travers), chaque champ par `champCsv`, une contre-passation en montant négatif.
 */
export function csvDesReglements(lignes: readonly LigneReglement[], espace: EspaceVentes): string {
  const corps = lignes.map((l) => [
    l.date, l.numero ?? '', l.client, l.contrePassation ? 'Contre-passation' : 'Encaissement', libelleMoyen(l.moyen),
    montantCsv(l.centimes), l.mouvement.etat === 'lu' ? `${l.mouvement.date} ${l.mouvement.libelle}` : l.mouvement.etat === 'hors_acces' ? MOUVEMENT_HORS_ACCES : '',
    l.declaration == null ? '' : declarationEnMots(l.declaration, espace), l.etat === 'retire' ? 'Retiré' : 'Actif',
  ])
  return '\uFEFF' + [COLONNES_CSV, ...corps].map((c) => c.map(champCsv).join(';')).join('\r\n')
}

/** « reglements-2026-10-13.csv » : le jour de l'export, jamais le nom du dossier. */
export function nomFichierDesReglements(aujourdHui: string): string {
  return `reglements-${aujourdHui}.csv`
}
