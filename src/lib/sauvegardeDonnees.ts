import { supabase } from './supabase'
import {
  clePrimaire,
  comptesRequis,
  liensPerdus,
  parentsHorsPlan,
  planExportDossier,
  referencesExternes,
  tablesSansChemin,
  violationsOrdre,
  ORDRE_RESTAURATION,
  type CheminDossier,
  type ComptesRequis,
  type LienPerdu,
  type ReferenceExterne,
} from './sauvegarde'

// La lecture réelle d'un dossier, en face du socle de `sauvegarde.ts` qui, lui, ne parle jamais au
// réseau. La séparation n'est pas de la coquetterie : l'ordre des tables, la carte des chemins et les
// contrôles sont de la logique pure, donc rejoués à chaque exécution de la suite de tests. Ici il n'y
// a que l'accès à la base — et c'est la partie qui se trompe le moins.
//
// Ce que cette sauvegarde contient : les lignes de base d'un dossier. Ce qu'elle ne contient pas, et
// qui est dit en toutes lettres dans son manifeste : les fichiers du stockage (l'export de pack les
// couvre déjà), les comptes utilisateurs, et la ligne `cabinets` du cabinet propriétaire.

/** Nombre de lignes lues par aller-retour. Voir `lireToutesLesLignes` pour ce qui en dépend. */
export const TAILLE_PAGE = 500

// PostgREST passe les valeurs d'un `in` dans l'URL : une liste trop longue produit une requête que le
// serveur refuse. On la découpe donc, et les tranches se recollent — le découpage ne doit décider de
// rien, pas plus ici que pour la réinsertion.
const TAILLE_TRANCHE_IN = 200

/** Ce qui décrit la sauvegarde sans être la sauvegarde : de quoi la juger avant de la restaurer. */
export interface Manifeste {
  /** Le format de ce fichier. Une sauvegarde plus récente que le code qui la lit doit être refusée. */
  version: number
  dossierId: string
  dossierNom: string
  cabinetId: string
  /** L'instant de la lecture, en ISO — pas une date civile : c'est un instant, pas un jour. */
  faiteLe: string
  /** Le compte de lignes par table, tel que la base l'a annoncé et tel qu'on l'a relu. */
  lignesParTable: Record<string, number>
  comptes: ComptesRequis
  referencesExternes: ReferenceExterne[]
  liensPerdus: LienPerdu[]
  /** Ce que cette sauvegarde ne contient pas, dit plutôt que sous-entendu. */
  horsPerimetre: string[]
}

export interface SauvegardeDossier {
  manifeste: Manifeste
  contenu: Record<string, Record<string, unknown>[]>
}

/** Version du format. À incrémenter dès que la forme du fichier change. */
export const VERSION_SAUVEGARDE = 1

// Ce qu'une sauvegarde de données ne remplace pas. Écrit dans le manifeste, et pas seulement ici :
// une sauvegarde qu'on croit complète est pire qu'une sauvegarde qu'on sait partielle, parce qu'on
// ne prépare rien pour combler ce qu'on ignore.
const HORS_PERIMETRE = [
  'Les fichiers eux-mêmes (pièces, documents, packs) restent dans le stockage : ils sont couverts par l’export de pack, pas par celui-ci.',
  'Les comptes utilisateurs (auth.users) ne sont ni lus ni restaurés. Voir `comptes` : trois tables en exigent, et refusent NULL.',
  'La ligne du cabinet propriétaire n’est pas incluse : elle doit exister dans la base d’arrivée. Voir `referencesExternes`.',
]

type Ligne = Record<string, unknown>

// Lit une table entière, par tranches, et REFUSE de rendre un résultat qu'elle ne peut pas prouver
// complet.
//
// Deux pièges, tous deux muets :
//
// 1. Une lecture par tranches sans ordre total rend des doublons et des trous. Postgres n'est pas tenu
//    de rendre les lignes dans le même ordre d'une tranche à l'autre, et il ne s'en cache pas : rien
//    ne le signale. D'où le tri sur la clé primaire — la vraie, pas `id`, que six tables n'ont pas.
//
// 2. Le compte annoncé par la base et le nombre de lignes effectivement recollées doivent coïncider.
//    S'ils diffèrent, c'est qu'une écriture a eu lieu pendant la lecture : la sauvegarde serait alors
//    un instantané déchiré, cohérent nulle part. Mieux vaut la refuser et recommencer — une
//    sauvegarde qu'on ne peut pas dire complète ne vaut pas mieux qu'une absence de sauvegarde, à
//    ceci près qu'elle rassure.
async function lireToutesLesLignes(
  table: string,
  filtrer: (requete: ReturnType<typeof requeteDeBase>) => ReturnType<typeof requeteDeBase>,
): Promise<Ligne[]> {
  const tri = clePrimaire(table)
  const lignes: Ligne[] = []
  let annonce: number | null = null

  for (let debut = 0; ; debut += TAILLE_PAGE) {
    let requete = filtrer(requeteDeBase(table))
    for (const colonne of tri) requete = requete.order(colonne) as typeof requete
    const { data, error, count } = await requete.range(debut, debut + TAILLE_PAGE - 1)
    if (error) throw error
    if (count != null) annonce = count
    lignes.push(...((data ?? []) as Ligne[]))
    if (!data || data.length < TAILLE_PAGE) break
  }

  if (annonce != null && annonce !== lignes.length) {
    throw new Error(
      `Sauvegarde refusée : la table « ${table} » annonce ${annonce} lignes et ${lignes.length} ont été lues. ` +
        'Une écriture a eu lieu pendant la lecture — relancer la sauvegarde.',
    )
  }
  return lignes
}

function requeteDeBase(table: string) {
  return supabase.from(table).select('*', { count: 'exact' })
}

// Lit les lignes d'une table selon le chemin déclaré pour elle. Le `switch` est exhaustif par
// construction : un accès ajouté à `CheminDossier` sans être traité ici ne compile pas, plutôt que de
// rendre zéro ligne en silence.
async function lireSelonChemin(
  table: string,
  chemin: CheminDossier,
  dossierId: string,
  contenu: Record<string, Ligne[]>,
): Promise<Ligne[]> {
  switch (chemin.acces) {
    case 'le_dossier':
      return lireToutesLesLignes(table, (r) => r.eq('id', dossierId))

    case 'direct':
      return lireToutesLesLignes(table, (r) => r.eq('dossier_id', dossierId))

    case 'partage':
      // Les lignes du dossier ET celles partagées par tout le cabinet (`dossier_id` nul). Un `eq`
      // seul écarterait les secondes sans le dire — c'est ce qui rendait zéro catégorie sur les
      // données réelles, alors que toutes les pièces catégorisées en pointaient une.
      return lireToutesLesLignes(table, (r) => r.or(`dossier_id.eq.${dossierId},dossier_id.is.null`))

    case 'par_parent': {
      // Les identifiants sont ceux du parent DÉJÀ LU : le plan garantit qu'il l'a été avant (voir
      // `tablesSansChemin`, motif `parent_lu_trop_tard`).
      const identifiants = (contenu[chemin.parent] ?? []).map((l) => String(l.id))
      // Pas de garde sur la liste vide : la boucle ci-dessous ne s'exécute alors pas, donc aucune
      // requête ne part — un `in ()` que PostgREST refuserait n'est jamais formé. Un `if` de plus
      // aurait dit la même chose sans rien changer, et aucun test n'aurait pu l'en distinguer.
      const lignes: Ligne[] = []
      for (let i = 0; i < identifiants.length; i += TAILLE_TRANCHE_IN) {
        const tranche = identifiants.slice(i, i + TAILLE_TRANCHE_IN)
        lignes.push(...(await lireToutesLesLignes(table, (r) => r.in(chemin.colonne, tranche))))
      }
      return lignes
    }

    case 'cabinet':
    case 'global':
      // Hors du périmètre d'un dossier — `planExportDossier` ne les propose pas. Le cas est traité
      // pour que le `switch` reste exhaustif, non parce qu'il peut survenir.
      return []
  }
}

// Lit tout un dossier et rend une sauvegarde accompagnée de son verdict.
//
// L'ordre des contrôles compte : ceux qui portent sur le PLAN (l'ordre des tables, la carte des
// chemins, les parents hors plan) sont vérifiés AVANT de lire quoi que ce soit. Ils ne dépendent pas
// des données, donc les laisser pour la fin ferait payer une lecture complète avant d'apprendre que
// le plan lui-même était faux.
export async function exporterDossier(
  dossierId: string,
  onProgression?: (fait: number, total: number, table: string) => void,
): Promise<SauvegardeDossier> {
  const defautsDuPlan = [
    ...violationsOrdre(ORDRE_RESTAURATION).map((v) => `${v.enfant} → ${v.parent} (${v.motif})`),
    ...tablesSansChemin().map((t) => `${t.table} (${t.motif})`),
    ...parentsHorsPlan()
      .filter((p) => p.parent !== 'cabinets')
      .map((p) => `${p.parent}, pointée par ${p.pointeePar.join(', ')}, est hors du plan`),
  ]
  if (defautsDuPlan.length > 0) {
    throw new Error(`Sauvegarde refusée, le plan lui-même est en faute :\n${defautsDuPlan.join('\n')}`)
  }

  const { data: dossier, error: erreurDossier } = await supabase
    .from('dossiers')
    .select('id, nom, cabinet_id')
    .eq('id', dossierId)
    .maybeSingle()
  if (erreurDossier) throw erreurDossier
  // Une lecture refusée par RLS rend `null` sans erreur, exactement comme un dossier inexistant :
  // sans ce test, l'export produirait un fichier vide en se disant réussi.
  if (!dossier) throw new Error(`Dossier introuvable ou inaccessible : ${dossierId}`)

  const plan = planExportDossier()
  const contenu: Record<string, Ligne[]> = {}
  const lignesParTable: Record<string, number> = {}

  let fait = 0
  for (const etape of plan) {
    onProgression?.(fait, plan.length, etape.table)
    const lignes = await lireSelonChemin(etape.table, etape.chemin, dossierId, contenu)
    contenu[etape.table] = lignes
    lignesParTable[etape.table] = lignes.length
    fait += 1
  }
  onProgression?.(fait, plan.length, '')

  return {
    manifeste: {
      version: VERSION_SAUVEGARDE,
      dossierId,
      dossierNom: String((dossier as { nom?: unknown }).nom ?? ''),
      cabinetId: String((dossier as { cabinet_id?: unknown }).cabinet_id ?? ''),
      // Un instant, pas une date civile : deux sauvegardes du même jour doivent pouvoir se départager.
      faiteLe: new Date().toISOString(),
      lignesParTable,
      comptes: comptesRequis(contenu),
      referencesExternes: referencesExternes(contenu),
      liensPerdus: liensPerdus(contenu),
      horsPerimetre: HORS_PERIMETRE,
    },
    contenu,
  }
}
