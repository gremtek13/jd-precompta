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

// Les mots qu'une banque met autour de « solde » sur une ligne de solde (« SOLDE CREDITEUR AU 28/02/2025 », « Nouveau
// solde », « Solde précédent », « SOLDE INTERMEDIAIRE A REPORTER », « SOLDE EN VOTRE FAVEUR », « Solde à ce jour »,
// « SOLDE AU 31 JANV 2025 », « Page 1/3 » d'une ligne PDF recollée), sans accents ni casse.
const MOTS_D_UN_SOLDE = new Set([
  'solde', 'soldes', 'ancien', 'nouveau', 'precedent', 'anterieur', 'crediteur', 'debiteur', 'initial', 'final', 'finale',
  'ouverture', 'cloture', 'credit', 'debit', 'cr', 'db', 'dr', 'depart', 'debut', 'fin', 'periode', 'comptable',
  'disponible', 'provisoire', 'intermediaire', 'reporte', 'report', 'reporter', 'courant', 'compte', 'releve', 'votre',
  'faveur', 'situation', 'arrete', 'date', 'mois', 'jour', 'veille', 'ce', 'apres', 'operation', 'valeur', 'total',
  'euros', 'euro', 'eur', 'page', 'sur',
  'a', 'au', 'aux', 'du', 'de', 'des', 'd', 'l', 'le', 'la', 'les', 'en', 'n', 'no',
  'janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre',
  'janv', 'fev', 'fevr', 'avr', 'juil', 'sept', 'oct', 'nov', 'dec',
])

// Les mots d'un texte, sans accents ni casse. Un « mot » qui porte un chiffre — une date, un montant, un numéro de compte
// comme « 073921S » — ne compte pas comme un mot : il ne dit rien de la nature de la ligne.
function motsDuTexte(texte: string): string[] {
  return texte.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().split(/[^a-z0-9]+/).filter((m) => m && !/\d/.test(m))
}

// Ce qu'un libellé dit d'une ligne :
//   - « solde » : il A LA FORME d'un solde — il dit « solde » et rien d'autre qu'un solde, ses mots tous de ceux qu'une
//     banque met autour (`MOTS_D_UN_SOLDE`) ;
//   - « à trancher » : il dit « solde » sans en avoir la forme. « VIR M DUPONT SOLDE NOTE HONORAIRES » est une recette ;
//     « SOLDE DU COMPTE » ou une formule de banque que la liste ne connaît pas est peut-être un solde. Ni l'un ni l'autre
//     ne se devine : pris pour un solde, une recette disparaît ; pris pour une opération, le solde du compte entre comme un
//     mouvement. Le cabinet tranche, ligne par ligne, avant l'import ;
//   - « operation » : le mot n'y est pas.
// L'ancienne règle, le seul mot « solde » n'importe où, prenait toute ligne qui le porte pour un solde, sans rien dire.
export type NatureDuLibelle = 'solde' | 'a trancher' | 'operation'

export function natureDuLibelle(texte: string): NatureDuLibelle {
  const mots = motsDuTexte(texte)
  if (!mots.some((m) => m === 'solde' || m === 'soldes')) return 'operation'
  return mots.every((m) => MOTS_D_UN_SOLDE.has(m)) ? 'solde' : 'a trancher'
}

export function aLaFormeDUnSolde(texte: string): boolean {
  return natureDuLibelle(texte) === 'solde'
}

// Ce que l'écran dit quand les lignes de solde reconnues ne sont pas exactement deux (ouverture et clôture) : le relevé
// s'importe, sans que son arithmétique soit vérifiée. Deux : rien à dire.
export function phraseDesSoldes(nombre: number): string | null {
  if (nombre === 2) return null
  if (nombre === 0) {
    return 'Aucune ligne de solde reconnue : le relevé s’importe sans vérification de son arithmétique (solde d’ouverture + '
      + 'mouvements = solde de clôture).'
  }
  return `${nombre} ligne${nombre > 1 ? 's' : ''} de solde reconnue${nombre > 1 ? 's' : ''}, alors qu’il en faut exactement deux `
    + '(ouverture et clôture) : le relevé s’importe sans vérification de son arithmétique. Ces lignes ne s’importent pas.'
}

// Repère les lignes qui décrivent un solde plutôt qu'une opération. Deux signaux, volontairement
// conservateurs — un mouvement pris pour un solde disparaîtrait de la comptabilité :
//
//   - le libellé a la forme d'un solde (`aLaFormeDUnSolde` : la plupart des banques françaises écrivent le mot, et rien
//     d'autre qu'un solde autour) ;
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
    if (aLaFormeDUnSolde(libelleDeLigne(row, mapping))) {
      trouvees.push({ index, motif: 'libellé de solde' })
      return
    }
    if (row.length < largeurHabituelle) {
      trouvees.push({ index, motif: 'ligne plus courte que les opérations' })
    }
  })
  return trouvees
}

// Les lignes « à trancher » (`natureDuLibelle`) que `lignesDeSolde` n'a pas déjà retenues comme soldes : le cabinet dit,
// pour chacune, si c'est un solde ou une opération, et l'import attend sa réponse.
export function lignesATrancher(rows: string[][], mapping: ColumnMapping): number[] {
  const soldes = new Set(lignesDeSolde(rows, mapping).map((l) => l.index))
  return rows.flatMap((row, index) => (!soldes.has(index) && natureDuLibelle(libelleDeLigne(row, mapping)) === 'a trancher' ? [index] : []))
}

export interface ControleSolde {
  soldeInitial: number
  soldeFinal: number
  // Dates des deux lignes de solde : c'est ce qui permet de dire QUEL relevé ne boucle pas, une fois
  // le contrôle conservé en base et relu des mois plus tard (voir lib/controlesReleves.ts).
  dateInitiale: string
  dateFinale: string
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
    dateInitiale: ouverture.date,
    dateFinale: cloture.date,
    sommeMouvements,
    attendu,
    ecart,
    coherent: Math.abs(ecart) <= TOLERANCE,
  }
}

function arrondi(n: number): number {
  return Number(n.toFixed(2))
}
