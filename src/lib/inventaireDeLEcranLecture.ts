import { INVENTAIRE_EXPORTE, ROLES_D_INVENTAIRE, type ComptesDInventaire, type RoleDInventaire } from './inventaire'
import type { DonneesDeLInventaire, LigneDuBrouillonDInventaire } from './inventaireEcran'
import { lireTout } from './lectureComplete'
import { messageErreur } from './messageErreur'
import { supabase } from './supabase'
import type { InventaireDeclare, OperationInventaire, Provision } from './types'

// CE QUE L'ONGLET INVENTAIRE LIT D'UN DOSSIER (ligne 35, INV5 ; modèle : lib/caisseDuDossierLecture.ts). Les trois tables de
// l'inventaire — régularisations, provisions, déclarations —, les lignes du brouillon que les régularisations citent (pour dire si
// leurs écritures sont à jour), les comptes du plan du dossier pour les douze rôles d'inventaire, et l'année de ses premiers
// à-nouveaux. Chaque collection EN ENTIER, par `lireTout`, sous un tri total terminé par la clé primaire. LE TOUT OU RIEN : une
// seule lecture partielle, refusée, rompue ou illisible, et l'état dit « incomplète » avec le motif de la première qui a manqué —
// l'écran n'offre alors AUCUN geste. GARDÉE AVEC LE DOSSIER : chaque ligne rendue est confrontée à celui qu'on a demandé, et le
// résultat se rend avec son identifiant (`DossierDetail` reste monté d'un dossier à l'autre). Ce module ne rejette jamais.
//
// LES COMPTES DU PLAN sont lus ICI, par `plan_du_dossier`, et non par la lecture générale du plan (lib/planComptable.ts) : les
// douze rôles de l'inventaire n'entrent pas dans `ROLES_COMPTABLES` — la lecture du plan les ignore, et un plan qui ne les porte
// pas reste lisible pour tous les autres onglets. Un rôle absent ou mal formé n'est pas un échec de lecture : il manque à
// `ComptesDInventaire`, et c'est le refus du plan (`refusDuPlan`) que l'écran dira avant le clic.
//
// LE DRAPEAU BAISSÉ (`INVENTAIRE_EXPORTE`), elle ne lit RIEN, et le dit : l'état est « absente », sans un appel au réseau.

export type LectureDeLInventaireDeLEcran =
  /** L'onglet n'est pas offert : rien n'a été lu, et rien ne pouvait l'être. */
  | { dossierId: string; etat: 'absente' }
  | { dossierId: string; etat: 'incomplete'; motif: string }
  | { dossierId: string; etat: 'lue'; donnees: DonneesDeLInventaire }

/** Le nom de chaque lecture, dans l'ordre : c'est lui que le motif d'un manque nomme. */
const NOMS = ['les régularisations', 'les provisions', 'les déclarations', 'les écritures des régularisations'] as const

// Les colonnes que le module lit, chaîne pour chaîne.
// Des littéraux d'un seul tenant : le client typé lit le type d'une colonne dans la chaîne, qu'une concaténation lui cacherait.
export const COLONNES_DES_OPERATIONS = 'id, dossier_id, exercice, nature, compte_resultat, compte_regularisation, montant_centimes, tva_centimes, periode_debut, periode_fin, objet, piece_citee_id, provision_id, version, cree_par, cree_le, modifie_par, modifie_le'
export const COLONNES_DES_PROVISIONS = 'id, dossier_id, genre, compte_provision, objet, facture_id, piece_citee_id, ouverte_en, reprise_centimes, version, cree_par, cree_le, modifie_par, modifie_le'
export const COLONNES_DES_DECLARATIONS = 'id, dossier_id, exercice, declare_par, declare_le, retire_par, retire_le'
export const COLONNES_DES_ECRITURES = 'id, dossier_id, date, compte, sens, montant, operation_inventaire_id'

const entier = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v)
const texte = (v: unknown): v is string => typeof v === 'string'
const texteOuNul = (v: unknown): v is string | null => v === null || typeof v === 'string'
const NATURES = new Set(['cca', 'pca', 'fnp', 'fae', 'charge_a_payer', 'produit_a_recevoir', 'provision'])
const GENRES = new Set(['risque', 'depreciation_creance'])

function operationCroyable(l: Record<string, unknown>): boolean {
  return texte(l.id) && texte(l.dossier_id) && entier(l.exercice) && texte(l.nature) && NATURES.has(l.nature) && texte(l.compte_resultat)
    && texte(l.compte_regularisation) && entier(l.montant_centimes) && entier(l.tva_centimes) && texte(l.objet) && entier(l.version)
    && texteOuNul(l.periode_debut) && texteOuNul(l.periode_fin) && texteOuNul(l.piece_citee_id) && texteOuNul(l.provision_id)
}

function provisionCroyable(l: Record<string, unknown>): boolean {
  return texte(l.id) && texte(l.dossier_id) && texte(l.genre) && GENRES.has(l.genre) && texte(l.compte_provision) && texte(l.objet)
    && entier(l.ouverte_en) && (l.reprise_centimes === null || entier(l.reprise_centimes)) && entier(l.version)
}

function declarationCroyable(l: Record<string, unknown>): boolean {
  return texte(l.id) && texte(l.dossier_id) && entier(l.exercice) && texte(l.declare_le) && texteOuNul(l.retire_le)
}

function ecritureCroyable(l: Record<string, unknown>): boolean {
  return texte(l.dossier_id) && texte(l.date) && texte(l.compte) && (l.sens === 'debit' || l.sens === 'credit')
    && typeof l.montant === 'number' && Number.isFinite(l.montant) && texte(l.operation_inventaire_id)
}

const ROLES = new Set<string>(ROLES_D_INVENTAIRE.map((r) => r.role))

/** Les comptes des douze rôles, tels que `plan_du_dossier` les rend ; nul : la réponse n'est pas une liste de lignes lisibles. */
function comptesDuPlan(data: unknown): ComptesDInventaire | null {
  if (!Array.isArray(data)) return null
  const comptes: Partial<Record<RoleDInventaire, string>> = {}
  for (const ligne of data as unknown[]) {
    if (ligne === null || typeof ligne !== 'object') return null
    const { role, compte } = ligne as Record<string, unknown>
    if (typeof role !== 'string' || typeof compte !== 'string') return null
    if (ROLES.has(role)) comptes[role as RoleDInventaire] = compte
  }
  return comptes
}

const horsDuDossier = (lignes: readonly { dossier_id?: unknown }[], dossierId: string) => lignes.some((l) => l.dossier_id !== dossierId)

/** L'inventaire du dossier et ce que son écran en rejoue, lus en entier ; ou « incomplète », avec le motif. Ne rejette jamais. */
export async function lireLInventaireDuDossier(dossierId: string): Promise<LectureDeLInventaireDeLEcran> {
  return lireLInventaireDuDossierSelon(dossierId, INVENTAIRE_EXPORTE)
}

/** La même lecture, selon que l'onglet est offert : les deux états du drapeau, que les tests jouent. */
export async function lireLInventaireDuDossierSelon(dossierId: string, offert: boolean): Promise<LectureDeLInventaireDeLEcran> {
  if (!offert) return { dossierId, etat: 'absente' }
  try {
    const [operations, provisions, declarations, ecritures] = await Promise.all([
      lireTout<Record<string, unknown>>((debut, fin) =>
        supabase.from('operations_inventaire').select(COLONNES_DES_OPERATIONS, { count: 'exact' })
          .eq('dossier_id', dossierId).order('exercice').order('id').range(debut, fin)),
      lireTout<Record<string, unknown>>((debut, fin) =>
        supabase.from('provisions').select(COLONNES_DES_PROVISIONS, { count: 'exact' })
          .eq('dossier_id', dossierId).order('ouverte_en').order('id').range(debut, fin)),
      lireTout<Record<string, unknown>>((debut, fin) =>
        supabase.from('inventaires_declares').select(COLONNES_DES_DECLARATIONS, { count: 'exact' })
          .eq('dossier_id', dossierId).order('exercice').order('id').range(debut, fin)),
      lireTout<Record<string, unknown>>((debut, fin) =>
        supabase.from('ecritures_brouillon').select(COLONNES_DES_ECRITURES, { count: 'exact' })
          .eq('dossier_id', dossierId).not('operation_inventaire_id', 'is', null).order('date').order('id').range(debut, fin)),
    ])
    const manque = [operations, provisions, declarations, ecritures]
      .map((l, i) => (l.complete ? null : `${NOMS[i]} : ${l.motif ?? 'lecture incomplète'}`)).find((m) => m !== null)
    if (manque) return { dossierId, etat: 'incomplete', motif: manque }
    // Le plan et l'ouverture : deux lectures d'une ligne ou d'une réponse, chacune gardée ENTIÈRE pour que son erreur se lise.
    const plan = await supabase.rpc('plan_du_dossier', { p_dossier_id: dossierId })
    const ouverture = await supabase.from('a_nouveaux').select('date').eq('dossier_id', dossierId).order('date').order('id').limit(1).maybeSingle()
    if (plan.error) return { dossierId, etat: 'incomplete', motif: `le plan du dossier : ${messageErreur(plan.error, 'lecture refusée')}` }
    if (ouverture.error) return { dossierId, etat: 'incomplete', motif: `l’ouverture du dossier : ${messageErreur(ouverture.error, 'lecture refusée')}` }
    const comptes = comptesDuPlan(plan.data)
    if (comptes === null) return { dossierId, etat: 'incomplete', motif: 'le plan du dossier : réponse illisible' }
    for (const [i, l] of [operations, provisions, declarations, ecritures].entries()) {
      if (horsDuDossier(l.lignes, dossierId)) return { dossierId, etat: 'incomplete', motif: `${NOMS[i]} : une ligne rendue n’est pas de ce dossier` }
    }
    if (!operations.lignes.every(operationCroyable) || !provisions.lignes.every(provisionCroyable)
      || !declarations.lignes.every(declarationCroyable) || !ecritures.lignes.every(ecritureCroyable)) {
      return { dossierId, etat: 'incomplete', motif: 'une ligne de l’inventaire lue ne se croit pas' }
    }
    const date = (ouverture.data as { date?: unknown } | null)?.date
    if (date !== undefined && !(typeof date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(date))) {
      return { dossierId, etat: 'incomplete', motif: 'l’ouverture du dossier : une date illisible' }
    }
    return {
      dossierId, etat: 'lue',
      donnees: {
        operations: operations.lignes as unknown as OperationInventaire[],
        provisions: provisions.lignes as unknown as Provision[],
        declarations: declarations.lignes as unknown as InventaireDeclare[],
        lignes: ecritures.lignes as unknown as LigneDuBrouillonDInventaire[],
        comptes,
        premierExercice: typeof date === 'string' ? Number(date.slice(0, 4)) : null,
      },
    }
  } catch (e) {
    return { dossierId, etat: 'incomplete', motif: messageErreur(e, 'la lecture de l’inventaire a échoué') }
  }
}
