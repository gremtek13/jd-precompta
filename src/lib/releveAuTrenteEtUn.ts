import type { ControleReleveBancaire, LigneBancaire } from './types'

// LE SOLDE DE LA BANQUE AU 31 DÉCEMBRE, LU SUR LES RELEVÉS CONTRÔLÉS (`controles_releves_bancaires`). Un module PUR, écrit une
// fois pour les deux écrans qui le comptent : la preuve du relevé de la Révision (lib/revisionPreuves.ts, `preuveDuReleve`) et
// la confrontation du compte de banque au relevé avant la validation (lib/prealablesValidation.ts, MVPD7-Q2). Deux règles qui
// diraient deux soldes différents du même relevé se contrediraient à l'écran.
//
// LA RÈGLE (conception de la révision, § 3.6) : le relevé dont la période finit le 31 décembre (son solde final), sinon
// celui qui couvre la FIN de ce jour — sa période commence au plus tard le 1er janvier suivant et finit après le 31 décembre :
// son solde initial, s'il commence le 1er janvier, sinon son solde initial et ceux de ses mouvements datés au plus tard du 31.
// Les dates d'un contrôle sont celles de ses deux lignes de solde (lib/soldeReleve.ts). Seul un relevé qui BOUCLE donne un
// solde ; celui qui ne boucle pas se regarde (il se dit) sans rien prouver.
//
// Les montants sont en CENTIMES ENTIERS, Math.round(montant × 100), jamais une somme de flottants.

const centimes = (montant: number) => Math.round(montant * 100)

/** L'ordre des relevés : par début de période, puis par identifiant — un ordre total. */
export function parPeriode(a: ControleReleveBancaire, b: ControleReleveBancaire): number {
  return (a.periode_debut ?? '').localeCompare(b.periode_debut ?? '') || a.id.localeCompare(b.id)
}

/** Ce qu'un relevé qui boucle dit du solde au 31 décembre, ou pourquoi il ne le dit pas. */
export type SoldeDuReleve =
  // Il finit le 31 décembre : son solde final. `mouvementsModifies` : ses mouvements, retrouvés par le nom du fichier
  // importé, ne font plus la somme contrôlée à l'import — le solde final reste celui du relevé.
  | { controle: ControleReleveBancaire; lu: 'solde_final'; centimes: number; mouvementsModifies: boolean }
  // Il commence le 1er janvier suivant : son solde initial est celui de la fin du 31 décembre.
  | { controle: ControleReleveBancaire; lu: 'solde_initial'; centimes: number }
  // Il couvre le 31 décembre : son solde initial et ses mouvements datés au plus tard de ce jour.
  | { controle: ControleReleveBancaire; lu: 'corrige'; centimes: number }
  // Il couvre le 31 décembre, mais ses mouvements ne se retrouvent pas (aucun nom de fichier), ou ne font plus la somme
  // contrôlée à l'import : son solde de ce jour ne se calcule pas.
  | { controle: ControleReleveBancaire; lu: null; raison: 'sans_fichier' | 'mouvements_modifies' }

export interface RelevesAuTrenteEtUn {
  /** Les relevés dont la période finit le 31 décembre, dans l'ordre des périodes. */
  finissent: ControleReleveBancaire[]
  /** Ceux qui couvrent la fin du 31 décembre, dans l'ordre des périodes. */
  couvrent: ControleReleveBancaire[]
  /** Ceux qu'on a regardés : ceux qui finissent le 31 décembre, et, faute de l'un d'eux qui boucle, ceux qui couvrent ce jour. */
  regardes: ControleReleveBancaire[]
  /** Ce que dit chaque relevé retenu — qui boucle —, dans l'ordre des périodes. */
  soldes: SoldeDuReleve[]
}

/** Les relevés qui disent le solde de la banque au 31 décembre de `annee`, et ce que chacun en dit. */
export function relevesAuTrenteEtUn(
  controles: readonly ControleReleveBancaire[],
  lignes: readonly Pick<LigneBancaire, 'source_fichier' | 'montant' | 'date'>[],
  annee: number,
): RelevesAuTrenteEtUn {
  const fin = `${annee}-12-31`
  const lendemain = `${annee + 1}-01-01`
  const finissent = controles.filter((c) => c.periode_fin === fin).sort(parPeriode)
  const couvrent = controles
    .filter((c) => c.periode_debut !== null && c.periode_fin !== null && c.periode_debut <= lendemain && c.periode_fin > fin)
    .sort(parPeriode)
  const bouclentEtFinissent = finissent.filter((c) => c.coherent)
  const candidats = bouclentEtFinissent.length > 0 ? bouclentEtFinissent : couvrent.filter((c) => c.coherent)
  const regardes = bouclentEtFinissent.length > 0 ? finissent : [...finissent, ...couvrent]

  const soldes: SoldeDuReleve[] = candidats.map((c) => {
    // Les mouvements du relevé, retrouvés par le nom du fichier importé : ils doivent faire encore la somme que le contrôle a
    // mesurée à l'import, sinon le relevé ne boucle plus avec ce que la base en garde.
    const duFichier = c.source_fichier === null ? null : lignes.filter((l) => l.source_fichier === c.source_fichier)
    const intact = duFichier !== null && duFichier.reduce((s, l) => s + centimes(l.montant), 0) === centimes(c.somme_mouvements)
    if (c.periode_fin === fin) {
      return { controle: c, lu: 'solde_final', centimes: centimes(c.solde_final), mouvementsModifies: duFichier !== null && !intact }
    }
    if ((c.periode_debut as string) > fin) return { controle: c, lu: 'solde_initial', centimes: centimes(c.solde_initial) }
    if (duFichier === null) return { controle: c, lu: null, raison: 'sans_fichier' }
    if (!intact) return { controle: c, lu: null, raison: 'mouvements_modifies' }
    return {
      controle: c, lu: 'corrige',
      centimes: centimes(c.solde_initial) + duFichier.filter((l) => l.date <= fin).reduce((s, l) => s + centimes(l.montant), 0),
    }
  })
  return { finissent, couvrent, regardes, soldes }
}

/**
 * LE PREMIER RELEVÉ DE LA TENUE DU DOSSIER : celui qui commence au plus tôt parmi ceux qui finissent APRÈS le jour de la
 * reprise (`reprise`, nulle sans balance reprise). Un relevé plus ancien est dans les comptes repris, et son solde initial ne
 * dit rien de l'ouverture ; celui qui finit le jour même aussi : son solde de clôture, daté de ce jour, est l'ouverture.
 */
export function premierReleveDeLaTenue(
  controles: readonly ControleReleveBancaire[],
  reprise: string | null,
): ControleReleveBancaire | undefined {
  return controles
    .filter((c) => c.periode_debut !== null && (reprise === null || c.periode_fin === null || c.periode_fin > reprise))
    .sort(parPeriode)[0]
}
