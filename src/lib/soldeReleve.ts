import { libelleDeLigne, type ColumnMapping } from './csv'

// Lignes de solde d'un relevé bancaire, et contrôle de cohérence qui en découle.
//
// Un relevé ne contient pas que des opérations : il porte aussi le solde d'ouverture et le solde de
// clôture de la période. Importées comme des mouvements, ces deux lignes faussent tous les totaux
// bancaires — sur le premier relevé réel, 8 270,84 € et 20 023,55 € comptés comme des encaissements,
// soit 28 000 € de mouvements qui n'existent pas. Elles ne peuvent en plus jamais être rapprochées :
// aucune pièce ne leur correspondra jamais.
//
// **Mais elles valent mieux que d'être jetées.** Ensemble, elles permettent de vérifier le relevé
// lui-même : solde d'ouverture + somme des mouvements doit donner le solde de clôture. Quand ça ne
// tombe pas juste, le relevé est incomplet ou altéré — et c'est exactement ce qu'un cabinet doit
// savoir AVANT de bâtir une comptabilité dessus. Sur le premier relevé réel, le contrôle révèle un
// écart de 5 359,00 € que rien dans les données n'explique.

export type MotifSolde = 'ligne plus courte que les opérations' | 'libellé de solde'

export interface LigneDeSolde {
  // Index de la ligne dans le tableau fourni, pour que l'appelant la retrouve.
  index: number
  motif: MotifSolde
}

const LIBELLE_SOLDE = /\bsoldes?\b/i

// Repère les lignes qui décrivent un solde plutôt qu'une opération. Deux signaux, volontairement
// conservateurs — un mouvement pris pour un solde disparaîtrait de la comptabilité :
//
//   - le libellé dit « solde » (la plupart des banques françaises l'écrivent) ;
//   - la ligne a MOINS de colonnes que les opérations du même fichier. Une banque qui écrit un solde
//     n'a ni type d'opération ni libellé à mettre : elle produit un enregistrement plus court. C'est
//     le seul signal disponible sur le relevé réel, où les deux lignes de solde portent le numéro de
//     compte en guise de libellé, sans jamais écrire le mot « solde ».
//
// Rien n'est supprimé ici : la fonction rend des candidates, l'appelant décide.
export function lignesDeSolde(rows: string[][], mapping: ColumnMapping): LigneDeSolde[] {
  if (rows.length === 0) return []

  // Largeur habituelle d'une opération : la plus fréquente, pas la plus grande. Une seule ligne
  // anormalement longue ne doit pas faire passer toutes les autres pour des soldes.
  const frequences = new Map<number, number>()
  for (const row of rows) frequences.set(row.length, (frequences.get(row.length) ?? 0) + 1)
  const largeurHabituelle = [...frequences.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0]

  const trouvees: LigneDeSolde[] = []
  rows.forEach((row, index) => {
    if (LIBELLE_SOLDE.test(libelleDeLigne(row, mapping))) {
      trouvees.push({ index, motif: 'libellé de solde' })
      return
    }
    if (row.length < largeurHabituelle) {
      trouvees.push({ index, motif: 'ligne plus courte que les opérations' })
    }
  })
  return trouvees
}

export interface ControleSolde {
  soldeInitial: number
  soldeFinal: number
  sommeMouvements: number
  // Ce que le solde de clôture devrait valoir d'après les mouvements importés.
  attendu: number
  // attendu − soldeFinal. Positif : le relevé porte plus d'entrées que le solde ne le justifie,
  // donc il manque des sorties (ou des entrées sont en double).
  ecart: number
  coherent: boolean
}

// Un centime de tolérance : au-delà, ce n'est plus un arrondi mais un manquant.
const TOLERANCE = 0.01

// Le contrôle n'a de sens qu'avec DEUX soldes, un d'ouverture et un de clôture. Avec un seul, ou
// aucun, il n'y a rien à vérifier — et prétendre le contraire donnerait un faux résultat rassurant.
export function controlerSolde(
  soldes: { date: string; montant: number }[],
  mouvements: { montant: number }[],
): ControleSolde | null {
  if (soldes.length !== 2) return null

  const [ouverture, cloture] = [...soldes].sort((a, b) => a.date.localeCompare(b.date))
  const sommeMouvements = arrondi(mouvements.reduce((s, m) => s + m.montant, 0))
  const attendu = arrondi(ouverture.montant + sommeMouvements)
  const ecart = arrondi(attendu - cloture.montant)

  return {
    soldeInitial: ouverture.montant,
    soldeFinal: cloture.montant,
    sommeMouvements,
    attendu,
    ecart,
    coherent: Math.abs(ecart) <= TOLERANCE,
  }
}

function arrondi(n: number): number {
  return Number(n.toFixed(2))
}
