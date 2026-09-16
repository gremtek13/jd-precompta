import { describe, expect, it } from 'vitest'
import { categorieParMotCle, grouperParTiers, piecesSansTiers } from './suggestionTiers'
import type { Categorie, Piece, TiersCategorie, TiersCategorieCabinet } from './types'

const categories = [
  { id: 'cat-assurance', code: 'assurance', libelle: 'Assurance' },
  { id: 'cat-banque', code: 'frais_bancaires', libelle: 'Frais bancaires' },
  { id: 'cat-loyer', code: 'loyer', libelle: 'Loyer' },
  { id: 'cat-deplacements', code: 'carburant_deplacements', libelle: 'Carburant / déplacements' },
  { id: 'cat-honoraires', code: 'honoraires', libelle: 'Honoraires' },
  { id: 'cat-achats', code: 'achats_fournisseurs', libelle: 'Achats fournisseurs' },
] as Categorie[]

const piece = (o: Partial<Piece>): Piece =>
  ({ id: 'p', tiers: null, categorie_id: null, montant_ttc: null, ...o }) as Piece

describe('categorieParMotCle', () => {
  it('reconnaît une famille sur un mot du nom du fournisseur', () => {
    expect(categorieParMotCle('MACSF', categories)).toBe('cat-assurance')
    expect(categorieParMotCle('Abeille Assurances', categories)).toBe('cat-assurance')
    expect(categorieParMotCle('ULYS', categories)).toBe('cat-deplacements')
  })

  it('ignore les accents et la casse', () => {
    // L'OCR rend « prévoyance » ou « prevoyance » selon la qualité du scan : les deux doivent
    // tomber sur la même famille, sinon la suggestion dépend de la netteté du papier.
    //
    // Aucun nom de marque ici : « SwissLife Prévoyance » aurait matché sur « swisslife », qui n'a
    // pas d'accent, et le test aurait passé sans jamais exercer le retrait des accents. Seul
    // « prevoyance » peut faire correspondre celui-ci.
    expect(categorieParMotCle('Prévoyance Santé du Sud', categories)).toBe('cat-assurance')
    expect(categorieParMotCle('PREVOYANCE SANTE DU SUD', categories)).toBe('cat-assurance')
    // Et la casse seule, sur un mot déjà sans accent.
    expect(categorieParMotCle('SWISSLIFE', categories)).toBe('cat-assurance')
  })

  it('traverse les retours à la ligne laissés par l’OCR', () => {
    // Cas réel : Textract a rendu « caisse\nd'epargne\ncepac » en capturant trois lignes du logo.
    // `normalizeTiers` ramène les sauts de ligne à des espaces, donc le mot-clé « caisse d epargne »
    // doit matcher malgré l'apostrophe — d'où le mot-clé écrit sans elle.
    expect(categorieParMotCle("caisse\nd epargne\ncepac", categories)).toBe('cat-banque')
  })

  it('ne propose rien plutôt que de deviner sur un nom inconnu', () => {
    // Le cœur de la prudence : une case vide saute aux yeux, une mauvaise suggestion validée
    // distraitement ne se voit plus jamais.
    expect(categorieParMotCle('Transmedical', categories)).toBeNull()
    expect(categorieParMotCle('Villa Estello', categories)).toBeNull()
    expect(categorieParMotCle('', categories)).toBeNull()
  })

  it('ne propose rien si la catégorie correspondante n’existe pas dans ce dossier', () => {
    // Un cabinet peut avoir supprimé ou renommé une catégorie : le code ne doit pas rendre un id
    // qui ne correspond à rien, sinon l'écriture échouerait sur une clé étrangère inconnue.
    expect(categorieParMotCle('MACSF', [{ id: 'x', code: 'autre' } as Categorie])).toBeNull()
  })
})

describe('grouperParTiers', () => {
  const regles: TiersCategorie[] = [
    { tiers_normalise: 'transmedical', categorie_id: 'cat-achats' } as TiersCategorie,
  ]

  it('regroupe les graphies qui ne diffèrent que par la casse ou les espaces', () => {
    const groupes = grouperParTiers(
      [
        piece({ id: 'a', tiers: 'Transmedical', montant_ttc: 38.4 }),
        piece({ id: 'b', tiers: '  TRANSMEDICAL  ', montant_ttc: 38.4 }),
        piece({ id: 'c', tiers: 'Trans  medical', montant_ttc: 10 }),
      ],
      categories, regles, [],
    )
    const transmedical = groupes.find((g) => g.tiersNormalise === 'transmedical')!
    expect(transmedical.pieceIds).toEqual(['a', 'b'])
    expect(transmedical.totalTtc).toBeCloseTo(76.8, 2)
    // « Trans medical » reste un groupe distinct : rapprocher deux noms voisins serait deviner.
    expect(groupes).toHaveLength(2)
  })

  it('préfère une règle apprise à un mot-clé, et le dit', () => {
    // MACSF tomberait sur « assurance » par mot-clé ; une règle apprise doit primer, parce qu'elle
    // vient d'un choix que le cabinet a réellement fait.
    const groupes = grouperParTiers(
      [piece({ id: 'a', tiers: 'MACSF' })],
      categories,
      [{ tiers_normalise: 'macsf', categorie_id: 'cat-honoraires' } as TiersCategorie],
      [],
    )
    expect(groupes[0].categorieProposee).toBe('cat-honoraires')
    expect(groupes[0].origine).toBe('regle')
  })

  it('retombe sur la règle cabinet quand le dossier n’en a pas', () => {
    const groupes = grouperParTiers(
      [piece({ id: 'a', tiers: 'Truc Inconnu' })],
      categories, [],
      [{ tiers_normalise: 'truc inconnu', categorie_id: 'cat-achats' } as TiersCategorieCabinet],
    )
    expect(groupes[0].categorieProposee).toBe('cat-achats')
    expect(groupes[0].origine).toBe('regle')
  })

  it('marque « motcle » une proposition devinée, pour qu’elle se vérifie', () => {
    const groupes = grouperParTiers([piece({ id: 'a', tiers: 'MACSF' })], categories, [], [])
    expect(groupes[0].categorieProposee).toBe('cat-assurance')
    expect(groupes[0].origine).toBe('motcle')
  })

  it('marque « aucune » et ne propose rien quand rien n’est connu', () => {
    const groupes = grouperParTiers([piece({ id: 'a', tiers: 'Villa Estello' })], categories, [], [])
    expect(groupes[0].categorieProposee).toBeNull()
    expect(groupes[0].origine).toBe('aucune')
  })

  it('écarte les pièces déjà catégorisées et celles sans tiers', () => {
    const groupes = grouperParTiers(
      [
        piece({ id: 'a', tiers: 'MACSF', categorie_id: 'cat-honoraires' }),
        piece({ id: 'b', tiers: null }),
        piece({ id: 'c', tiers: '   ' }),
        piece({ id: 'd', tiers: 'Villa Estello' }),
      ],
      categories, [], [],
    )
    expect(groupes).toHaveLength(1)
    expect(groupes[0].pieceIds).toEqual(['d'])
  })

  it('classe le plus gros volume en premier, puis le plus gros montant', () => {
    // L'ordre porte une intention : arbitrer d'abord ce qui libère le plus de pièces, et mettre en
    // haut les fournisseurs récurrents dont la règle resservira le plus longtemps.
    const groupes = grouperParTiers(
      [
        piece({ id: 'a', tiers: 'Petit', montant_ttc: 5000 }),
        piece({ id: 'b', tiers: 'Gros', montant_ttc: 10 }),
        piece({ id: 'c', tiers: 'Gros', montant_ttc: 10 }),
      ],
      categories, [], [],
    )
    expect(groupes.map((g) => g.libelle)).toEqual(['Gros', 'Petit'])
  })

  it('laisse totalTtc à null quand aucune pièce du groupe n’a de montant', () => {
    // Distinguer « zéro euro » de « montant non lu » : afficher 0,00 € sur une pièce dont le montant
    // n'a pas été extrait ferait croire à une facture à zéro.
    const groupes = grouperParTiers([piece({ id: 'a', tiers: 'Sans Montant' })], categories, [], [])
    expect(groupes[0].totalTtc).toBeNull()
  })
})

describe('piecesSansTiers', () => {
  it('compte les pièces hors de portée du regroupement', () => {
    const liste = [
      piece({ id: 'a', tiers: null }),
      piece({ id: 'b', tiers: '  ' }),
      piece({ id: 'c', tiers: 'MACSF' }),
      piece({ id: 'd', tiers: null, categorie_id: 'cat-achats' }),
    ]
    expect(piecesSansTiers(liste).map((p) => p.id)).toEqual(['a', 'b'])
  })
})
