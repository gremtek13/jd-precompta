import type { ReponseDeLaBase } from './couvertureReleve'
import {
  RECETTES_FACTUREES_NON_COMPTEES, simulationDitNePasCompterLesVentesFacturees, type RecettesFacturees,
} from './estimation'
import { messageErreur } from './messageErreur'

// « MA SIMULATION » REÇOIT SES VENTES FACTURÉES (ligne 28.65, chantier EC-Q3, étape VF8e ; VF8-Q2 ; HISTORIQUE.md,
// « VF8, LA BASCULE : LA CONCEPTION », § 3 (e), et « « MA SIMULATION » REÇOIT SES VENTES FACTURÉES »).
//
// La session d'un client « Banque » ne lit pas les factures — sans « Ventes », aucune. Depuis VF3b3, sa simulation ne les
// comptait donc pas, et le disait d'un dossier basculé : elle comptait l'exemplaire d'une facture source comme une pièce,
// faute de savoir lequel l'était, et la vente d'une facture sans pièce pas du tout. La fonction de la base
// `ventes_facturees_de_la_simulation` (migration `simulation_des_ventes_facturees`) lui rend, d'un dossier basculé et pour
// une année, exactement la forme « comptées » de `RecettesFacturees` (lib/estimation.ts) : le total hors taxe de chaque
// mois, la règle de `recettesFactureesParMois` refaite en base par la règle du cumul (`calcul_vente_facturee`), et les
// identifiants des factures et avoirs sources, de quoi ignorer leur exemplaire (`pieces.facture_id`, que sa session lit
// avec ses pièces) ; rien d'autre. D'un dossier qui n'a pas basculé, rien : les deux clés, vides. Le même calcul que
// l'Estimation du cabinet, en entiers (supabase/essais/simulationDesVentesFacturees.sql le confronte au module).
//
// CE MODULE EST LA LECTURE, PURE : il n'importe pas `supabase.ts`. L'écran appelle la base et passe la REQUÊTE telle quelle
// à `lireLesVentesDeLaSimulation`, qui l'attend (le patron de lib/couvertureReleve.ts) et ne rejette jamais : un refus, une
// valeur d'une autre forme ou une requête qui lève rendent une lecture INCOMPLÈTE, avec son motif — jamais des recettes
// nulles, qui feraient une simulation plausible et basse. Aucun type nouveau pour les recettes : la lecture rend la forme
// « comptées » de `RecettesFacturees`, gardée avec le dossier ET l'année pour lesquels elle a été lue
// (`lectureDeLaSimulation`) : une réponse tardive d'un dossier quitté, ou d'une année passée, ne vaut pas.

// LA FONCTION N'EST PAS ENCORE EN BASE. Sa migration est PRÉPARÉE, présentée au cabinet (VF8-Q2 l'a voulue, sa lecture neuve
// se présente avant d'être appliquée), et pas appliquée : l'écran ne l'appelle pas tant que ce drapeau est faux, et dit ce
// qu'il disait avant VF8e. La session le lèvera elle-même, la migration appliquée. Chaque fonction de ce module qui en
// dépend reçoit le drapeau en paramètre : ses deux états s'éprouvent sans toucher à cette constante.
export const SIMULATION_VENTES_FACTUREES_EXPORTEE: boolean = false

/** Les ventes facturées que « Ma simulation » a lues, pour un dossier et une année ; ou le motif de leur manque. */
export type LectureDeLaSimulation =
  | { dossierId: string; annee: number; etat: 'lue'; recettes: RecettesFacturees }
  | { dossierId: string; annee: number; etat: 'incomplete'; motif: string }

const MOIS = /^(\d{4})-(0[1-9]|1[0-2])$/
const IDENTIFIANT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const ordreC = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

const objetSimple = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)

/**
 * La valeur que rend `ventes_facturees_de_la_simulation`, pour l'année demandée, sous la forme « comptées » : un objet à deux
 * clés, et elles seules — `par_mois` (« AAAA-MM » de CETTE année → des centimes entiers) et `sources` (des identifiants, sans
 * doublon). Toute autre forme rend `null` : une valeur qu'on ne sait pas lire ne passe ni pour des recettes nulles, ni pour
 * une liste de sources vide.
 */
export function recettesDeLaSimulation(rendu: unknown, annee: number): RecettesFacturees | null {
  if (!objetSimple(rendu)) return null
  const cles = Object.keys(rendu).sort(ordreC)
  if (cles.length !== 2 || cles[0] !== 'par_mois' || cles[1] !== 'sources') return null
  const parMoisLu = rendu.par_mois
  const sourcesLues = rendu.sources
  if (!objetSimple(parMoisLu) || !Array.isArray(sourcesLues)) return null
  const parMois = new Map<string, number>()
  for (const mois of Object.keys(parMoisLu).sort(ordreC)) {
    const centimes = parMoisLu[mois]
    const m = MOIS.exec(mois)
    if (!m || Number(m[1]) !== annee || typeof centimes !== 'number' || !Number.isSafeInteger(centimes)) return null
    parMois.set(mois, centimes)
  }
  const sources = new Set<string>()
  for (const id of sourcesLues) {
    if (typeof id !== 'string' || !IDENTIFIANT.test(id) || sources.has(id)) return null
    sources.add(id)
  }
  return { etat: 'comptees', parMois, sources }
}

/** La réponse de la base, attendue, en lecture : les recettes « comptées », ou le motif de leur manque. */
export function lectureDesVentesDeLaSimulation(dossierId: string, annee: number, reponse: ReponseDeLaBase): LectureDeLaSimulation {
  if (reponse.error) {
    return { dossierId, annee, etat: 'incomplete', motif: `ventes facturées refusées : ${messageErreur(reponse.error, 'raison inconnue')}` }
  }
  const recettes = recettesDeLaSimulation(reponse.data, annee)
  if (!recettes) return { dossierId, annee, etat: 'incomplete', motif: 'ventes facturées illisibles' }
  return { dossierId, annee, etat: 'lue', recettes }
}

/**
 * La lecture telle que l'écran la fait : `lireLesVentesDeLaSimulation(dossierId, annee,
 * supabase.rpc('ventes_facturees_de_la_simulation', { p_dossier_id: dossierId, p_annee: annee }))`. La requête est ATTENDUE
 * ici et son erreur lue (ecrituresVerifiees.test.ts nomme ce consommateur) ; une requête qui lève tombe du côté signalé,
 * comme un refus. Ne rejette jamais.
 */
export async function lireLesVentesDeLaSimulation(
  dossierId: string, annee: number, requete: PromiseLike<ReponseDeLaBase>,
): Promise<LectureDeLaSimulation> {
  try {
    return lectureDesVentesDeLaSimulation(dossierId, annee, await requete)
  } catch (erreur) {
    return lectureDesVentesDeLaSimulation(dossierId, annee, { data: null, error: erreur })
  }
}

/**
 * La lecture qui vaut pour le dossier ouvert et l'année de la projection : celle qu'ils ont demandée, ou rien — « en
 * cours » — tant qu'elle n'est pas revenue. Une lecture faite pour un autre dossier, ou pour une autre année (l'écran resté
 * ouvert au passage d'une année), ne vaut jamais, quel que soit l'ordre des réponses.
 */
export function lectureDeLaSimulation(
  lecture: LectureDeLaSimulation | null, dossierId: string, annee: number,
): LectureDeLaSimulation | null {
  return lecture !== null && lecture.dossierId === dossierId && lecture.annee === annee ? lecture : null
}

/**
 * Ce que « Ma simulation » fait des ventes facturées. Drapeau baissé : ce qu'elle faisait avant VF8e — ne pas les compter, et
 * le dire d'un dossier basculé ou dont le réglage n'a pas été lu (`simulationDitNePasCompterLesVentesFacturees`). Drapeau
 * levé : les compter quand la lecture est revenue ENTIÈRE — la phrase se tait, l'exemplaire d'une facture source ne compte
 * plus comme une pièce ; sinon, aucune projection, le motif pour le bandeau, et la phrase d'aujourd'hui. Null : la lecture
 * n'est pas revenue — l'écran attend.
 */
export function ventesDeLaSimulation(
  drapeau: boolean, lecture: LectureDeLaSimulation | null, ventesParLesFactures: boolean | null | undefined,
): { recettes: RecettesFacturees; phrase: boolean; motif: null } | { recettes: null; phrase: true; motif: string } | null {
  if (!drapeau) {
    return { recettes: RECETTES_FACTUREES_NON_COMPTEES, phrase: simulationDitNePasCompterLesVentesFacturees(ventesParLesFactures), motif: null }
  }
  if (lecture === null) return null
  return lecture.etat === 'lue'
    ? { recettes: lecture.recettes, phrase: false, motif: null }
    : { recettes: null, phrase: true, motif: lecture.motif }
}

/** Le bandeau de « Ma simulation » quand ses ventes facturées n'ont pas été lues en entier : ce qui manque, et pourquoi elle
 * ne projette rien. Au tutoiement de l'espace client. */
export const QUOI_DES_VENTES_DE_LA_SIMULATION = 'Tes factures validées dans l’application'
export const SANS_PROJECTION = 'Recharge la page : ta projection ne s’affiche pas sans elles.'
