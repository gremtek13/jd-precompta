import { normalizeTiers } from './format'
import { suggererCategorie } from './tiersCategories'
import type { Categorie, Piece, TiersCategorie, TiersCategorieCabinet } from './types'

// Catégorisation en masse par tiers — pensée pour un cabinet qui veut arbitrer une fois par
// fournisseur plutôt qu'une fois par pièce. Sur un import réel, 58 pièces à catégoriser ne
// portaient que 28 tiers distincts : c'est ce rapport-là qu'on exploite.
//
// Le principe qui tient tout : **on pré-remplit, on ne décide pas**. Chaque ligne arrive avec une
// catégorie proposée et l'origine de cette proposition, pour que le cabinet voie d'un coup d'œil ce
// qui est sûr et ce qui demande un regard. Rien n'est écrit sans son clic.

// D'où vient la catégorie proposée, par ordre de fiabilité décroissante.
//   regle   : correspondance déjà apprise pour ce tiers (dossier, puis cabinet). Fiable — c'est un
//             choix que le cabinet a lui-même fait sur une pièce précédente.
//   motcle  : deviné d'après un mot du nom du tiers (voir MOTS_CLES). À vérifier : "assurance" dans
//             un nom désigne presque toujours une prime, mais ça reste une heuristique sur du texte
//             sorti d'un OCR.
//   aucune  : rien de connu, le cabinet choisit.
export type OrigineSuggestion = 'regle' | 'motcle' | 'aucune'

// Mots-clés → code de catégorie. Indexé sur le `code` stable, jamais sur le libellé (modifiable).
// Volontairement court : chaque entrée doit être un mot qui, dans un nom de fournisseur, ne laisse
// guère de doute. Un mot ambigu ferait plus de mal qu'il n'en évite — une mauvaise suggestion validée
// distraitement coûte plus cher qu'une case laissée vide, qui, elle, saute aux yeux.
//
// L'ordre compte : la première entrée dont un mot-clé apparaît dans le nom gagne. Les familles les
// plus spécifiques sont donc placées avant les plus générales.
const MOTS_CLES: { code: string; mots: string[] }[] = [
  { code: 'assurance', mots: ['assurance', 'assurances', 'mutuelle', 'prevoyance', 'macsf', 'swisslife', 'axa', 'allianz', 'maaf', 'matmut', 'groupama'] },
  { code: 'frais_bancaires', mots: ['banque', 'banqu', 'caisse d epargne', 'credit agricole', 'bnp', 'societe generale', 'lcl', 'qonto', 'revolut'] },
  { code: 'loyer', mots: ['loyer', 'bail', 'sci ', 'foncier', 'immobilier'] },
  { code: 'carburant_deplacements', mots: ['total', 'esso', 'avia', 'bp ', 'shell', 'sncf', 'ulys', 'vinci autoroute', 'peage', 'taxi', 'uber'] },
  { code: 'honoraires', mots: ['avocat', 'notaire', 'expert comptable', 'comptable', 'conseil', 'huissier'] },
]

// Normalisation dédiée à la comparaison par mot-clé : accents retirés en plus de ce que fait
// `normalizeTiers`, parce qu'un OCR rend "prévoyance" ou "prevoyance" selon la qualité du scan.
function sansAccents(texte: string): string {
  return texte.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

export function categorieParMotCle(tiers: string, categories: Categorie[]): string | null {
  const nom = sansAccents(normalizeTiers(tiers))
  if (!nom) return null
  for (const { code, mots } of MOTS_CLES) {
    if (!mots.some((mot) => nom.includes(mot))) continue
    const categorie = categories.find((c) => c.code === code)
    if (categorie) return categorie.id
  }
  return null
}

// Une ligne de l'écran de catégorisation : un tiers, ce qu'il représente, et ce qu'on propose.
export interface GroupeTiers {
  // Clé de correspondance — c'est elle qui sera écrite dans `tiers_categories`.
  tiersNormalise: string
  // Le libellé tel qu'il apparaît sur les pièces, pour que le cabinet reconnaisse le fournisseur.
  // La première graphie rencontrée : elles ne diffèrent que par la casse ou les espaces, par
  // construction de `normalizeTiers`.
  libelle: string
  pieceIds: string[]
  // Montant cumulé, pour trancher en connaissance de cause : une ligne à 5 000 € mérite plus
  // d'attention qu'une à 12 €. Null si aucune pièce du groupe n'a de montant lu.
  totalTtc: number | null
  categorieProposee: string | null
  origine: OrigineSuggestion
}

// Regroupe les pièces sans catégorie par tiers, avec la proposition et son origine.
//
// Les pièces sans tiers exploitable sont écartées : elles n'ont rien sur quoi grouper, et les
// rassembler sous un faux groupe « (sans tiers) » ferait appliquer une même catégorie à des pièces
// qui n'ont rien à voir entre elles. Elles restent à traiter pièce par pièce — l'appelant le dit.
export function grouperParTiers(
  pieces: Piece[],
  categories: Categorie[],
  reglesDossier: TiersCategorie[],
  reglesCabinet: TiersCategorieCabinet[],
): GroupeTiers[] {
  const groupes = new Map<string, GroupeTiers>()

  for (const piece of pieces) {
    if (piece.categorie_id) continue
    if (!piece.tiers || !piece.tiers.trim()) continue

    const cle = normalizeTiers(piece.tiers)
    let groupe = groupes.get(cle)
    if (!groupe) {
      const parRegle = suggererCategorie(piece.tiers, reglesDossier, reglesCabinet)
      const parMotCle = parRegle ? null : categorieParMotCle(piece.tiers, categories)
      groupe = {
        tiersNormalise: cle,
        libelle: piece.tiers.trim(),
        pieceIds: [],
        totalTtc: null,
        categorieProposee: parRegle ?? parMotCle,
        origine: parRegle ? 'regle' : parMotCle ? 'motcle' : 'aucune',
      }
      groupes.set(cle, groupe)
    }
    groupe.pieceIds.push(piece.id)
    if (piece.montant_ttc != null) groupe.totalTtc = (groupe.totalTtc ?? 0) + piece.montant_ttc
  }

  // Le plus gros volume d'abord : c'est là que le temps gagné est le plus grand, et ça met les
  // fournisseurs récurrents — ceux dont la règle servira le plus longtemps — en haut de l'écran.
  return [...groupes.values()].sort(
    (a, b) => b.pieceIds.length - a.pieceIds.length || Math.abs(b.totalTtc ?? 0) - Math.abs(a.totalTtc ?? 0),
  )
}

// Pièces sans catégorie ET sans tiers : hors de portée de cet écran, à compter pour le dire
// franchement plutôt que de les laisser disparaître du décompte.
export function piecesSansTiers(pieces: Piece[]): Piece[] {
  return pieces.filter((p) => !p.categorie_id && (!p.tiers || !p.tiers.trim()))
}
