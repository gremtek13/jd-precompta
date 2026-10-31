import { libelleDeLigne, montantDeLigne, parseDateBancaire, type ColumnMapping, type ReglageDesMontants } from './csv'
import { formatDate } from './format'
import { lignesATrancher, lignesDeSolde } from './soldeReleve'

// L'IMPORT D'UN RELEVÉ BANCAIRE PAR FICHIER, ce qui se décide avant d'écrire : l'interprétation des lignes (opérations,
// soldes, lignes écartées et leur raison), le dédoublonnage contre le relevé déjà en base, le recouvrement d'une période
// déjà importée. Aucun écran ne supprime une ligne de `lignes_bancaires` : un import faux est définitif, et chaque règle
// d'ici tombe du côté sûr — refuser, ou dire, plutôt que deviner. Les montants et les dates se lisent par `csv.ts` seul ;
// l'aperçu et l'import passent par les mêmes fonctions, pour que ce qui est montré soit ce qui s'écrit.

// Le réglage des colonnes tel que l'écran le tient : celui que la détection propose (`detectColumnMapping`), corrigé par
// le cabinet. `colSolde` : la colonne du solde courant, qui n'est jamais un montant.
export interface ReglageDeLImport extends ReglageDesMontants {
  colDate: number
  colLibelle: number
  hasHeader: boolean
  colSolde: number | null
}

// Un réglage qui ne peut que faire entrer de faux montants se refuse avant l'import, et le dit.
export function refusDuReglage(r: ReglageDeLImport): string | null {
  const montants = r.format === 'signe' ? [r.colMontant] : [r.colDebit, r.colCredit]
  if (r.colSolde !== null && montants.includes(r.colSolde)) {
    return `La colonne ${r.colSolde + 1} est celle du solde courant du compte : prise pour un montant, chaque mouvement entrerait `
      + 'au solde du compte. Choisis la colonne des montants, ou retire la colonne du solde si la détection s’est trompée.'
  }
  if (r.format === 'debit_credit' && r.colDebit === r.colCredit) {
    return 'La colonne Débit et la colonne Crédit sont la même : choisis deux colonnes distinctes.'
  }
  return null
}

// Le mapping que lisent `libelleDeLigne` et `lignesDeSolde` : les colonnes de montants qui ne sont pas lues comme le
// montant (Débit, Crédit, solde courant) n'entrent pas dans un libellé reconstitué.
export function mappingDuReglage(r: ReglageDeLImport): ColumnMapping {
  const autres = [...(r.format === 'signe' ? [] : [r.colDebit, r.colCredit]), ...(r.colSolde === null ? [] : [r.colSolde])]
  return {
    colDate: r.colDate, colLibelle: r.colLibelle, hasHeader: r.hasHeader,
    colMontant: r.format === 'signe' ? r.colMontant : r.colDebit, autresMontants: autres,
  }
}

// Pourquoi une ligne du fichier ne s'importe pas. « montant nul » : une opération à 0,00 € n'est pas un mouvement (une
// ligne de solde, elle, peut valoir zéro).
export type RaisonDEcart = 'date illisible' | 'sans montant' | 'montant illisible' | 'débit et crédit à la fois' | 'montant nul'
const ORDRE_DES_RAISONS: readonly RaisonDEcart[] = ['date illisible', 'sans montant', 'montant illisible', 'débit et crédit à la fois', 'montant nul']

export type LigneInterpretee =
  | { index: number; nature: 'operation' | 'solde' | 'a trancher'; date: string; libelle: string; montant: number }
  | { index: number; nature: 'ecartee'; libelle: string; raison: RaisonDEcart }

export interface OperationDuFichier {
  date: string
  libelle: string
  montant: number
  // La ligne telle qu'elle est dans le fichier, gardée à part (`libelle_brut`) pour remonter à la source.
  brut: string
}

// Une ligne nommée à l'écran : un solde retenu, ou une ligne à trancher. `ligne` : la ligne du fichier elle-même, qui sert
// de clé à la décision du cabinet (elle survit à la case « en-tête », qui décale les indices).
export interface LigneNommee { ligne: readonly string[]; date: string; libelle: string; montant: number }

// Ce que le cabinet a tranché pour une ligne dont le libellé dit « solde » sans en avoir la forme.
export type DecisionDeSolde = 'solde' | 'operation'
export const AUCUNE_DECISION: ReadonlyMap<readonly string[], DecisionDeSolde> = new Map()

export interface ReleveInterprete {
  lignes: LigneInterpretee[]
  operations: OperationDuFichier[]
  soldes: { date: string; montant: number }[]
  // Les soldes NOMMÉS, pour que le cabinet voie ce qui ne s'importera pas (« SOLDE DU COMPTE » pris pour un solde serait
  // une opération perdue) ; et les lignes à trancher, chacune avec la décision du cabinet (`null` : pas encore tranchée,
  // ce qui retient l'import) — toutes, tranchées ou non, pour que le choix reste visible et se change.
  soldesNommes: LigneNommee[]
  aTrancher: (LigneNommee & { decision: DecisionDeSolde | null })[]
  ecartees: { raison: RaisonDEcart; nombre: number }[]
}

// Les lignes du fichier (en-tête retiré), une à une : une opération, un solde, une ligne à trancher, ou une ligne écartée
// avec sa raison — jamais un montant deviné. Une ligne écartée se COMPTE, et l'écran le dit avant comme après l'import.
// `decisions` : ce que le cabinet a tranché des lignes à trancher (`AUCUNE_DECISION` avant tout choix).
export function interpreterReleve(
  dataRows: readonly string[][], reglage: ReglageDeLImport, decisions: ReadonlyMap<readonly string[], DecisionDeSolde>,
): ReleveInterprete {
  const mapping = mappingDuReglage(reglage)
  const indicesSolde = new Set(lignesDeSolde([...dataRows], mapping).map((l) => l.index))
  const indicesATrancher = new Set(lignesATrancher([...dataRows], mapping))
  const lignes: LigneInterpretee[] = []
  const operations: OperationDuFichier[] = []
  const soldes: { date: string; montant: number }[] = []
  const soldesNommes: LigneNommee[] = []
  const aTrancher: ReleveInterprete['aTrancher'] = []
  const compte = new Map<RaisonDEcart, number>()
  const ecarter = (index: number, libelle: string, raison: RaisonDEcart) => {
    lignes.push({ index, nature: 'ecartee', libelle, raison })
    compte.set(raison, (compte.get(raison) ?? 0) + 1)
  }
  for (const [index, row] of dataRows.entries()) {
    const date = parseDateBancaire(row[reglage.colDate] ?? '')
    // Certaines banques laissent la colonne Libellé vide sur une partie des lignes : `libelleDeLigne` reconstitue alors le
    // texte depuis les autres colonnes (hors date et montants) ; le générique ne sert que si rien d'autre ne dit la ligne.
    const libelle = libelleDeLigne(row, mapping) || 'Mouvement bancaire'
    const lecture = montantDeLigne(row, reglage)
    if (!date) { ecarter(index, libelle, 'date illisible'); continue }
    if ('ecart' in lecture) {
      ecarter(index, libelle, lecture.ecart === 'absent' ? 'sans montant' : lecture.ecart === 'illisible' ? 'montant illisible' : 'débit et crédit à la fois')
      continue
    }
    const montant = lecture.montant
    const decision = indicesATrancher.has(index) ? (decisions.get(row) ?? null) : undefined
    if (decision !== undefined) aTrancher.push({ ligne: row, date, libelle, montant, decision })
    if (decision === null) {
      lignes.push({ index, nature: 'a trancher', date, libelle, montant })
      continue
    }
    if (indicesSolde.has(index) || decision === 'solde') {
      lignes.push({ index, nature: 'solde', date, libelle, montant })
      soldes.push({ date, montant })
      soldesNommes.push({ ligne: row, date, libelle, montant })
      continue
    }
    if (montant === 0) { ecarter(index, libelle, 'montant nul'); continue }
    lignes.push({ index, nature: 'operation', date, libelle, montant })
    operations.push({ date, libelle, montant, brut: row.join(' | ') })
  }
  const ecartees = ORDRE_DES_RAISONS.filter((r) => compte.has(r)).map((raison) => ({ raison, nombre: compte.get(raison)! }))
  return { lignes, operations, soldes, soldesNommes, aTrancher, ecartees }
}

// Le refus de l'import tant qu'une ligne à trancher ne l'est pas, dit avant le clic.
export function refusDesLignesATrancher(aTrancher: ReleveInterprete['aTrancher']): string | null {
  const restent = aTrancher.filter((l) => l.decision === null).length
  if (restent === 0) return null
  return `${restent === 1 ? 'Une ligne dit' : `${restent} lignes disent`} « solde » sans en avoir la forme : `
    + 'dis pour chacune si c’est un solde ou une opération avant d’importer. Prise pour un solde, une recette disparaîtrait ; '
    + 'prise pour une opération, le solde du compte entrerait comme un mouvement.'
}

// « 3 ignorée(s) (1 date illisible, 2 montant illisible) », ou rien.
export function phraseDesEcartees(ecartees: ReleveInterprete['ecartees']): string | null {
  const total = ecartees.reduce((s, e) => s + e.nombre, 0)
  if (total === 0) return null
  return `${total} ignorée(s) (${ecartees.map((e) => `${e.nombre} ${e.raison}`).join(', ')})`
}

// Ce que l'aperçu dit d'un sens qui ne se vérifie pas : en montant signé, un relevé sans aucun débit est presque toujours un
// export à deux colonnes lu comme une seule — chaque débit entrerait comme un encaissement.
export function douteDuSens(r: Pick<ReglageDeLImport, 'format'>, operations: readonly { montant: number }[]): string | null {
  if (r.format !== 'signe' || operations.length < 3 || operations.some((o) => o.montant < 0)) return null
  return `Aucun débit parmi les ${operations.length} opérations lues : si la banque écrit ses débits en positif dans une colonne à `
    + 'part, choisis « Deux colonnes (Débit / Crédit séparées) » — sinon chaque débit entrerait comme un encaissement.'
}

// ── Le dédoublonnage ─────────────────────────────────────────────────────────────────────────────────────────────────────
// Deux mouvements sont « le même » quand ils ont même date, même libellé et même montant au centime.
export interface MouvementSigne { date: string; libelle: string; montant: number }

export function signatureMouvement(l: MouvementSigne): string {
  return `${l.date}|${l.libelle}|${l.montant.toFixed(2)}`
}

// Par MULTIPLICITÉ : une signature présente n fois dans le fichier et m fois au relevé en base fait importer n − m lignes
// (aucune si m ≥ n), jamais dédoublonnée à l'intérieur du fichier. Deux passages à la même pharmacie le même jour pour le
// même montant sont deux opérations ; l'ancienne règle prenait la seconde pour un doublon de la première, et le contrôle de
// solde, qui somme toutes les lignes du fichier, enregistrait cohérent un relevé auquel il manquait ce montant. Un relevé
// redéposé, lui, retrouve en base chacune de ses lignes autant de fois qu'il les porte : rien ne s'importe deux fois.
export function partagerParMultiplicite<T extends MouvementSigne>(
  fichier: readonly T[], existantes: readonly MouvementSigne[],
): { nouvelles: T[]; dejaPresentes: number } {
  const enBase = new Map<string, number>()
  for (const l of existantes) {
    const s = signatureMouvement(l)
    enBase.set(s, (enBase.get(s) ?? 0) + 1)
  }
  const nouvelles: T[] = []
  let dejaPresentes = 0
  for (const l of fichier) {
    const s = signatureMouvement(l)
    const reste = enBase.get(s) ?? 0
    if (reste > 0) { enBase.set(s, reste - 1); dejaPresentes++; continue }
    nouvelles.push(l)
  }
  return { nouvelles, dejaPresentes }
}

// ── Les lignes d'un relevé PDF ───────────────────────────────────────────────────────────────────────────────────────────
// L'aperçu PDF se corrige à la main : un montant effacé y devient 0, une date effacée une chaîne vide. Une opération nulle
// n'est pas un mouvement, une date absente ne s'écrit pas : elles s'écartent et se COMPTENT, comme dans un CSV. Les lignes
// cochées « solde » ne s'importent pas et servent au contrôle.
export function operationsDuPdf<T extends MouvementSigne & { estSolde?: boolean }>(lignes: readonly T[]): {
  operations: T[]; soldes: { date: string; montant: number }[]; nulles: number; sansDate: number
} {
  const operations: T[] = []
  const soldes: { date: string; montant: number }[] = []
  let nulles = 0
  let sansDate = 0
  for (const l of lignes) {
    if (l.estSolde) { soldes.push({ date: l.date, montant: l.montant }); continue }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(l.date)) { sansDate++; continue }
    if (!Number.isFinite(l.montant) || l.montant === 0) { nulles++; continue }
    operations.push(l)
  }
  return { operations, soldes, nulles, sansDate }
}

// ── Le recouvrement d'une période déjà importée ──────────────────────────────────────────────────────────────────────────
// Le dédoublonnage ne reconnaît que les mêmes date, libellé et montant : le même mois importé une fois en PDF puis en CSV
// (deux libellés pour chaque mouvement), ou récupéré par la connexion bancaire puis importé, entrerait deux fois. Le relevé
// déjà en base dit, fichier par fichier, quelle période il couvre — un relevé importé laisse toujours ses lignes, là où un
// contrôle de solde (`controles_releves_bancaires`) n'existe que pour un fichier qui porte ses deux soldes. Recouvrir une
// période se dit avant l'import et se confirme, sans se refuser : un fichier qui complète un import partiel est légitime.
export interface Recouvrement {
  // Le fichier d'origine des mouvements recouverts ; `null` : des mouvements sans fichier (connexion bancaire, import
  // ancien).
  source: string | null
  du: string
  au: string
  mouvements: number
}

// Les fichiers du relevé dont la période recouvre celle des mouvements à importer, bornes COMPRISES : janvier importé en
// PDF (du 02/01 au 31/01) puis un CSV du 31/01 au 28/02 partagent le 31 janvier, et les mouvements de ce jour entreraient
// deux fois. Les dates comparées sont celles des opérations seules (jamais des soldes) ; `dates` ne porte que les
// mouvements qui restent à importer APRÈS le dédoublonnage — un relevé redéposé tel quel ne recouvre donc rien. Le même nom
// de fichier ne protège de rien : le dédoublonnage dépend du libellé, qu'un autre réglage des colonnes reconstitue
// autrement, et ses mouvements entreraient deux fois.
export function recouvrements(
  dates: readonly string[], existantes: readonly { date: string; source_fichier: string | null }[],
): Recouvrement[] {
  if (dates.length === 0) return []
  const du = dates.reduce((a, b) => (b < a ? b : a))
  const au = dates.reduce((a, b) => (b > a ? b : a))
  const parSource = new Map<string | null, Recouvrement>()
  for (const l of existantes) {
    const g = parSource.get(l.source_fichier)
    if (!g) parSource.set(l.source_fichier, { source: l.source_fichier, du: l.date, au: l.date, mouvements: 1 })
    else {
      g.mouvements++
      if (l.date < g.du) g.du = l.date
      if (l.date > g.au) g.au = l.date
    }
  }
  return [...parSource.values()]
    .filter((g) => du <= g.au && au >= g.du)
    .sort((a, b) => a.du.localeCompare(b.du) || (a.source ?? '').localeCompare(b.source ?? ''))
}

export function phraseDesRecouvrements(liste: readonly Recouvrement[]): string | null {
  if (liste.length === 0) return null
  const noms = liste.map((r) => `${r.source === null ? 'des mouvements sans fichier d’origine (connexion bancaire, import ancien)' : `« ${r.source} »`}`
    + ` — ${r.mouvements} mouvement(s) du ${formatDate(r.du)} au ${formatDate(r.au)}`)
  return `La période de ce relevé recouvre celle d’un relevé déjà importé : ${noms.join(' ; ')}. Si c’est le même relevé sous un `
    + 'autre format (PDF puis CSV, par exemple), ses mouvements entreraient deux fois : le dédoublonnage ne reconnaît que les '
    + 'mêmes date, libellé et montant, et aucun écran ne retire un mouvement importé.'
}
