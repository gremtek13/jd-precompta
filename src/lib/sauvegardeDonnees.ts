import { supabase } from './supabase'
import {
  clePrimaire,
  comptesRequis,
  estLignePartagee,
  identiteLigne,
  liensPerdus,
  parentsHorsPlan,
  planExportDossier,
  planReinsertion,
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

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// La restauration.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Nombre de lignes écrites par aller-retour. Voir la double passe : ce nombre ne décide de rien. */
export const TAILLE_LOT_ECRITURE = 200

export interface ResultatRestauration {
  lignesParTable: Record<string, number>
  /** Lignes partagées trouvées déjà en base, laissées telles quelles plutôt que réécrites. */
  partageesConservees: number
  /** Liens auto-référencés reposés au second passage (les avoirs vers leur facture d'origine). */
  liensReposes: number
}

/** Un écart entre ce que la sauvegarde contenait et ce que la base contient après restauration. */
export interface EcartRestauration {
  table: string
  motif: 'ligne_absente' | 'ligne_en_trop' | 'lien_non_repose'
  identite: string
}

async function ecrireParLots(table: string, lignes: Ligne[]): Promise<void> {
  for (let i = 0; i < lignes.length; i += TAILLE_LOT_ECRITURE) {
    const { error } = await supabase.from(table).insert(lignes.slice(i, i + TAILLE_LOT_ECRITURE))
    // Jamais un `await` sans destructuration : `supabase.from(...)` ne lève pas, l'erreur se lit dans
    // `{ error }`. Une restauration qui avale ses erreurs est une restauration qui rend une base
    // amputée en se disant réussie — c'est précisément ce contre quoi tout ce chantier existe.
    if (error) throw new Error(`Restauration interrompue sur « ${table} » : ${error.message}`)
  }
}

// Remet une sauvegarde en base.
//
// Tout ce qui peut être refusé l'est AVANT la première écriture, et c'est le cœur du dessin. Une
// restauration n'est pas atomique : quarante tables, des milliers de lignes, aucune transaction
// englobante possible depuis un client REST. Un refus à mi-chemin laisse une base à moitié peuplée
// qu'il faut vider à la main, de nuit, sans savoir ce qui est passé. Chaque contrôle déplacé en
// amont est une nuit en moins.
//
// Ce qui n'est JAMAIS fait : écraser une ligne existante, et effacer un lien perdu pour que ça
// passe. Les deux feraient aboutir la restauration, et les deux détruiraient du travail sans le dire.
export async function restaurerSauvegarde(
  sauvegarde: SauvegardeDossier,
  onProgression?: (fait: number, total: number, table: string) => void,
): Promise<ResultatRestauration> {
  const { manifeste, contenu } = sauvegarde
  const refus: string[] = []

  if (manifeste.version > VERSION_SAUVEGARDE) {
    refus.push(
      `Cette sauvegarde est au format ${manifeste.version}, ce code n'en connaît que ${VERSION_SAUVEGARDE}. ` +
        'Elle contient peut-être des tables que cette version ne saurait pas réinsérer.',
    )
  }

  const plan = planReinsertion(contenu)
  for (const table of plan.tablesIgnorees) {
    refus.push(`La table « ${table} » est dans la sauvegarde mais pas dans l'ordre de restauration : elle ne serait écrite nulle part.`)
  }

  // Le refus qui compte le plus. Un lien perdu sur une colonne nullable peut être « corrigé » en y
  // mettant NULL, et la restauration aboutit — en ayant défait le rapprochement bancaire ou orphelin
  // les écritures, sans une alerte. On ne le fait pas, et on ne le propose pas.
  for (const perdu of liensPerdus(contenu)) {
    refus.push(
      `${perdu.table}.${perdu.colonne} pointe ${perdu.parent} « ${perdu.valeur} », absent de la sauvegarde` +
        (perdu.effacable ? ' (le lien pourrait être effacé pour passer — on ne le fera pas).' : '.'),
    )
  }

  // Les lignes que la base d'arrivée doit déjà porter : on va VOIR si elles y sont, plutôt que de
  // l'espérer. Sans cette lecture, l'absence du cabinet se découvrirait sur la première écriture.
  for (const externe of referencesExternes(contenu)) {
    const cle = clePrimaire(externe.parent)
    if (cle.length !== 1) continue
    // Par le même chemin paginé que tout le reste, et pas par un `select` nu : une lecture non
    // paginée est plafonnée par PostgREST sans le dire. Ici le plafond ferait refuser une
    // restauration parfaitement valide — l'erreur va du bon côté, mais un refus qu'on ne s'explique
    // pas finit par être contourné, et c'est alors le contrôle entier qu'on perd.
    const presentes = await lireToutesLesLignes(externe.parent, (r) => r.in(cle[0], externe.valeurs))
    const presents = new Set(presentes.map((l) => String(l[cle[0]])))
    for (const attendu of externe.valeurs) {
      if (!presents.has(attendu)) {
        refus.push(`${externe.parent} « ${attendu} » doit exister dans la base d'arrivée (pointé par ${externe.table}.${externe.colonne}) et n'y est pas.`)
      }
    }
  }

  // Ne jamais restaurer par-dessus. Un dossier déjà présent signifie soit qu'on se trompe de base,
  // soit que quelqu'un a recréé le dossier entre-temps : dans les deux cas, écrire dessus détruirait
  // ce qui existe, et c'est irréversible.
  const { data: dejaLa, error: erreurDeja } = await supabase
    .from('dossiers').select('id').eq('id', manifeste.dossierId).maybeSingle()
  if (erreurDeja) throw erreurDeja
  if (dejaLa) refus.push(`Le dossier « ${manifeste.dossierId} » existe déjà dans cette base. La restauration n'écrase jamais.`)

  if (refus.length > 0) {
    throw new Error(`Restauration refusée, rien n'a été écrit :\n- ${refus.join('\n- ')}`)
  }

  const resultat: ResultatRestauration = { lignesParTable: {}, partageesConservees: 0, liensReposes: 0 }
  let fait = 0

  for (const etape of plan.etapes) {
    onProgression?.(fait, plan.etapes.length, etape.table)

    // Une ligne partagée appartient à tout le cabinet : si elle est déjà là, on la laisse. Une
    // catégorie renommée depuis la sauvegarde, ou dont le compte comptable a été corrigé, sert tous
    // les dossiers — restaurer un client n'est pas une raison de la ramener en arrière pour eux.
    const partagees = etape.lignes.filter((l) => estLignePartagee(etape.table, l))
    let aEcrire = etape.lignes
    if (partagees.length > 0) {
      const dejaEnBase = await lireToutesLesLignes(etape.table, (r) => r.is('dossier_id', null))
      const presentes = new Set(dejaEnBase.map((l) => identiteLigne(etape.table, l)))
      const conservees = partagees.filter((l) => presentes.has(identiteLigne(etape.table, l)))
      resultat.partageesConservees += conservees.length
      aEcrire = etape.lignes.filter((l) => !presentes.has(identiteLigne(etape.table, l)))
    }

    await ecrireParLots(etape.table, aEcrire)
    resultat.lignesParTable[etape.table] = aEcrire.length
    fait += 1
  }

  // La seconde passe : les liens auto-référencés, reposés une fois toutes les lignes en place. Une
  // mise à jour par ligne, et c'est assez — ces liens sont des avoirs, il y en a un par facture
  // corrigée, pas un par facture.
  for (const passe of plan.secondePasse) {
    for (const { id, valeur } of passe.valeurs) {
      const { error } = await supabase.from(passe.table).update({ [passe.colonne]: valeur }).eq('id', id)
      if (error) throw new Error(`Seconde passe interrompue sur ${passe.table}.${passe.colonne} : ${error.message}`)
      resultat.liensReposes += 1
    }
  }

  onProgression?.(fait, plan.etapes.length, '')
  return resultat
}

// Le verdict, et il n'est pas rendu par la restauration elle-même : on relit le dossier avec l'export,
// puis on compare à la sauvegarde d'origine.
//
// Pourquoi ce détour plutôt qu'un compteur tenu pendant l'écriture : un compteur ne peut mesurer que
// ce que le code croit avoir fait. Relire par le chemin d'export mesure ce que la base contient — et
// c'est la même lecture qui servira à la prochaine sauvegarde, donc si elle se trompe, elle se
// trompera là aussi et le dira.
//
// Le lien auto-référencé est comparé à part : c'est le seul que la première passe écrit à NULL, donc
// le seul qu'une seconde passe oubliée laisserait vide sans que le compte de lignes bouge d'un iota.
export async function verifierRestauration(
  sauvegarde: SauvegardeDossier,
): Promise<EcartRestauration[]> {
  const relu = await exporterDossier(sauvegarde.manifeste.dossierId)
  const ecarts: EcartRestauration[] = []
  const auto = planReinsertion(sauvegarde.contenu).secondePasse

  for (const table of Object.keys(sauvegarde.contenu)) {
    const attendues = new Map(sauvegarde.contenu[table].map((l) => [identiteLigne(table, l), l]))
    const trouvees = new Map((relu.contenu[table] ?? []).map((l) => [identiteLigne(table, l), l]))

    for (const identite of attendues.keys()) {
      if (!trouvees.has(identite)) ecarts.push({ table, motif: 'ligne_absente', identite })
    }
    for (const identite of trouvees.keys()) {
      if (!attendues.has(identite)) ecarts.push({ table, motif: 'ligne_en_trop', identite })
    }
    for (const passe of auto.filter((p) => p.table === table)) {
      for (const { id, valeur } of passe.valeurs) {
        const ligne = trouvees.get(identiteLigne(table, { id }))
        if (ligne && ligne[passe.colonne] !== valeur) {
          ecarts.push({ table, motif: 'lien_non_repose', identite: id })
        }
      }
    }
  }
  return ecarts
}
