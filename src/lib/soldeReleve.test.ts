import { describe, expect, it } from 'vitest'
import { controlerSolde, lignesDeSolde } from './soldeReleve'
import type { ColumnMapping } from './csv'

const mapping: ColumnMapping = { colDate: 0, colMontant: 1, colLibelle: 4, hasHeader: false }

// Extrait fidèle du premier relevé réel : les opérations ont huit colonnes, les deux lignes de solde
// quatre, et elles portent le numéro de compte en guise de libellé — le mot « solde » n'apparaît
// nulle part.
const releveReel = [
  ['01/01/2025', '8270,84', '', '02871 073921S'],
  ['06/01/2025', '-38,4', 'Virement', '', 'PRLV SEPA TRANSMEDICAL', '', '', ''],
  ['05/02/2025', '-198', 'Virement', '', 'PRLV SEPA TRANSMEDICAL', '', '', ''],
  ['27/08/2025', '60', 'Virement', '', '', 'ASSISTANCE PUBLIQUE', '', ''],
  ['31/12/2025', '20023,55', '', '02871 073921S'],
]

describe('lignesDeSolde', () => {
  it('repère les lignes de solde qui n’écrivent jamais le mot « solde »', () => {
    // Le cas réel : rien dans le texte ne les distingue, mais la banque produit un enregistrement
    // plus court parce qu'elle n'a ni type d'opération ni libellé à y mettre.
    const trouvees = lignesDeSolde(releveReel, mapping)
    expect(trouvees.map((l) => l.index)).toEqual([0, 4])
    expect(trouvees.every((l) => l.motif === 'ligne plus courte que les opérations')).toBe(true)
  })

  it('repère aussi celles qui le disent', () => {
    const trouvees = lignesDeSolde([
      ['01/01/2025', '1000', 'x', '', 'SOLDE AU 01/01/2025', ''],
      ['06/01/2025', '-38,4', 'Virement', '', 'PRLV SEPA TRANSMEDICAL', ''],
      ['31/12/2025', '961,6', 'x', '', 'Nouveau solde', ''],
    ], mapping)
    expect(trouvees.map((l) => l.index)).toEqual([0, 2])
    expect(trouvees.every((l) => l.motif === 'libellé de solde')).toBe(true)
  })

  it('ne prend pas « soldes » dans un nom de commerçant pour un solde', () => {
    // « SOLDERIE » ou « LES SOLDES DU PORT » ne doivent pas faire disparaître une vraie dépense :
    // la limite de mot évite ça pour le premier, et le second reste un vrai risque assumé — c'est
    // pour ça que l'appelant propose au lieu d'exclure tout seul.
    const trouvees = lignesDeSolde([
      ['06/01/2025', '-38,4', 'Carte', '', 'CB SOLDERIE DU PORT', ''],
      ['07/01/2025', '-12', 'Carte', '', 'CB BOULANGERIE', ''],
    ], mapping)
    expect(trouvees).toEqual([])
  })

  it('prend la largeur la PLUS FRÉQUENTE, pas la plus grande', () => {
    // Une seule ligne anormalement longue ne doit pas faire passer toutes les autres pour des soldes.
    const trouvees = lignesDeSolde([
      ['06/01/2025', '-38,4', 'Virement', '', 'A', ''],
      ['07/01/2025', '-12', 'Carte', '', 'B', ''],
      ['08/01/2025', '-15', 'Carte', '', 'C', ''],
      ['09/01/2025', '-15', 'Carte', '', 'D', '', 'colonne en trop'],
    ], mapping)
    expect(trouvees).toEqual([])
  })

  it('ne trouve rien sur un relevé homogène', () => {
    expect(lignesDeSolde([
      ['06/01/2025', '-38,4', 'Virement', '', 'A', ''],
      ['07/01/2025', '-12', 'Carte', '', 'B', ''],
    ], mapping)).toEqual([])
  })

  it('tient un tableau vide', () => {
    expect(lignesDeSolde([], mapping)).toEqual([])
  })
})

describe('controlerSolde', () => {
  it('confirme un relevé qui boucle', () => {
    const c = controlerSolde(
      [{ date: '2025-01-01', montant: 1000 }, { date: '2025-12-31', montant: 1200 }],
      [{ montant: 500 }, { montant: -300 }],
    )
    expect(c).toMatchObject({ attendu: 1200, ecart: 0, coherent: true })
  })

  it('chiffre l’écart d’un relevé qui ne boucle pas', () => {
    // Le cas réel : le relevé porte plus d'entrées que le solde de clôture ne le justifie, donc il
    // manque des sorties. C'est ce qu'un cabinet doit savoir avant de bâtir une comptabilité dessus.
    const c = controlerSolde(
      [{ date: '2025-01-01', montant: 8270.84 }, { date: '2025-12-31', montant: 20023.55 }],
      [{ montant: 17111.71 }],
    )
    expect(c).toMatchObject({ attendu: 25382.55, ecart: 5359, coherent: false })
  })

  it('remet les soldes dans l’ordre des dates, quel que soit l’ordre du fichier', () => {
    const c = controlerSolde(
      [{ date: '2025-12-31', montant: 1200 }, { date: '2025-01-01', montant: 1000 }],
      [{ montant: 200 }],
    )
    expect(c).toMatchObject({ soldeInitial: 1000, soldeFinal: 1200, coherent: true })
  })

  it('tolère le centime d’arrondi, pas l’euro', () => {
    const arrondi = controlerSolde(
      [{ date: '2025-01-01', montant: 1000 }, { date: '2025-12-31', montant: 1200.01 }],
      [{ montant: 200 }],
    )
    expect(arrondi?.coherent).toBe(true)

    const manquant = controlerSolde(
      [{ date: '2025-01-01', montant: 1000 }, { date: '2025-12-31', montant: 1199 }],
      [{ montant: 200 }],
    )
    expect(manquant?.coherent).toBe(false)
  })

  it('refuse de conclure sans les deux soldes', () => {
    // Un seul solde ne permet aucun contrôle. Rendre « cohérent » serait un faux résultat rassurant.
    expect(controlerSolde([{ date: '2025-01-01', montant: 1000 }], [{ montant: 200 }])).toBeNull()
    expect(controlerSolde([], [{ montant: 200 }])).toBeNull()
    expect(controlerSolde(
      [{ date: '2025-01-01', montant: 1 }, { date: '2025-06-30', montant: 2 }, { date: '2025-12-31', montant: 3 }],
      [],
    )).toBeNull()
  })

  it('gère l’accumulation flottante sans faire apparaître un faux écart', () => {
    // 0,1 + 0,2 ≠ 0,3 en flottant : sans arrondi, un relevé qui boucle serait signalé incohérent.
    const c = controlerSolde(
      [{ date: '2025-01-01', montant: 0 }, { date: '2025-12-31', montant: 0.3 }],
      [{ montant: 0.1 }, { montant: 0.2 }],
    )
    expect(c?.coherent).toBe(true)
    expect(c?.ecart).toBe(0)
  })
})

describe('controlerSolde — dates des soldes', () => {
  it('rend les dates d’ouverture et de clôture, dans l’ordre chronologique', () => {
    // C'est ce qui permet de dire QUEL relevé ne boucle pas, une fois le contrôle conservé en base
    // et relu des mois plus tard : sans elles, l'écran n'aurait qu'un montant sans période.
    // Les soldes sont fournis à l'envers exprès — la fonction les trie, elle ne suppose pas l'ordre.
    const c = controlerSolde(
      [{ date: '2025-12-31', montant: 20023.55 }, { date: '2025-01-01', montant: 8270.84 }],
      [{ montant: 100 }],
    )
    expect(c?.dateInitiale).toBe('2025-01-01')
    expect(c?.dateFinale).toBe('2025-12-31')
  })
})
