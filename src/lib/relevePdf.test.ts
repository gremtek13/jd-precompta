import { describe, expect, it } from 'vitest'
import { parseLignesFromPdf, seuilDeuxColonnes, soldesDuPdf } from './relevePdf'
import type { LignePdf } from './relevePdf'

// Un relevé PDF converti en lignes : une opération par ligne, date en tête, montant en queue.
// `xFin` (abscisse du montant) ne sert qu'au format à deux colonnes — sans lui, toutes les lignes
// sont réputées dans la même colonne.
const releve = (...textes: string[]): LignePdf[] => textes.map((texte) => ({ texte, xFin: 0 }))
const operations = (lignes: LignePdf[]) => parseLignesFromPdf(lignes)

describe('parseLignesFromPdf — lecture du montant', () => {
  it('lit un montant à quatre chiffres écrit sans séparateur de milliers', () => {
    // 144 des 569 lignes en base dépassent 1 000 €. L'expression régulière ne connaissait que la
    // forme groupée : faute de séparateur elle s'accrochait aux trois derniers chiffres avant la
    // virgule, et 20 846,47 € entrait en base à 846,47 € — sans le moindre signal.
    expect(operations(releve('05/01/2026 VIREMENT SALAIRE 1234,56')))
      .toEqual([{ date: '2026-01-05', libelle: 'VIREMENT SALAIRE', montant: 1234.56 }])
    expect(operations(releve('05/01/2026 GROS VIREMENT 20846,47'))[0].montant).toBe(20846.47)
  })

  it('perd le signe d’un débit écrit sans séparateur : non', () => {
    // Le pire des deux : le montant tronqué ET le sens inversé. 361 des 569 lignes sont des débits.
    expect(operations(releve('05/01/2026 PRELEVEMENT URSSAF -1500,00'))[0].montant).toBe(-1500)
  })

  it('accepte les trois séparateurs de milliers rencontrés selon la banque', () => {
    const montants = operations(releve(
      '05/01/2026 ESPACE 1 234,56 €',
      '06/01/2026 POINT 1.234,56 €',
      '07/01/2026 ANGLO 1,234.56 €',
    )).map((l) => l.montant)
    expect(montants).toEqual([1234.56, 1234.56, 1234.56])
  })

  it('résiste aux espaces doublés laissés par le recollage des fragments pdf.js', () => {
    // pdf.js rend des fragments positionnés, pas des lignes ; les recoller insère un espace là où il
    // y en avait déjà un. "1  234,56" ne ressemblait plus à un montant groupé.
    expect(operations(releve('05/01/2026 VIREMENT  1  234,56  €'))[0].montant).toBe(1234.56)
  })

  it('reconnaît le signe rejeté en fin et celui porté par des parenthèses', () => {
    const montants = operations(releve(
      '05/01/2026 FRAIS TENUE DE COMPTE 45,20-',
      '06/01/2026 COMMISSION (45,20)',
    )).map((l) => l.montant)
    expect(montants).toEqual([-45.2, -45.2])
  })

  it('accepte « € » comme « EUR », avec ou sans symbole', () => {
    const montants = operations(releve(
      '05/01/2026 CARTE DIFFEREE 45,20 EUR',
      '06/01/2026 ACHAT CB 45,20 €',
      '07/01/2026 ACHAT CB 45,20',
    )).map((l) => l.montant)
    expect(montants).toEqual([45.2, 45.2, 45.2])
  })

  it('ignore une ligne sans montant en fin plutôt que d’en inventer un', () => {
    expect(operations(releve('05/01/2026 LIBELLE QUI DEBORDE SUR LA LIGNE SUIVANTE'))).toEqual([])
  })
})

describe('parseLignesFromPdf — choix de la date', () => {
  it('retient la date de début de ligne, pas celle rappelée dans le libellé', () => {
    // Une ligne de paiement par carte rappelle couramment la date d'achat. Sur les relevés où la
    // date d'opération est écrite en jour/mois, chercher une date complète n'importe où dans la
    // ligne faisait gagner celle du libellé : mauvaise date, et libellé amputé de son début.
    const texte = releve(
      'Relevé de votre compte au 31/01/23',
      '05/01 CB FACTURE DU 03/01/26 CARREFOUR 45,20',
    )
    expect(operations(texte))
      .toEqual([{ date: '2023-01-05', libelle: 'CB FACTURE DU 03/01/26 CARREFOUR', montant: 45.2 }])
  })

  it('se rabat sur une date trouvée ailleurs quand la ligne n’en porte pas au début', () => {
    // Mise en page qui fait précéder la date d'un code opération : mieux vaut une date tardive que
    // pas de ligne du tout.
    expect(operations(releve('OP 44 12/03/2026 VIREMENT 45,20'))[0].date).toBe('2026-03-12')
  })

  it('complète une date jour/mois avec l’année de la période du relevé', () => {
    const texte = releve(
      'Relevé de votre compte au 31/01/23',
      '05/01 ACHAT CB 45,20',
    )
    expect(operations(texte)[0].date).toBe('2023-01-05')
  })

  it('attribue à l’année précédente un mois postérieur à celui de la période', () => {
    // Un relevé de janvier commence souvent par des opérations de décembre.
    const texte = releve(
      'Relevé de votre compte au 31/01/23',
      '28/12 ACHAT CB 45,20',
    )
    expect(operations(texte)[0].date).toBe('2022-12-28')
  })

  it('ignore une date jour/mois faute de période : aucune année à lui attribuer', () => {
    expect(operations(releve('05/01 ACHAT CB 45,20'))).toEqual([])
  })

  it('ignore une date qui n’existe pas au calendrier', () => {
    // Laisser passer "2026-02-31" ferait échouer l'insertion de tout le lot, pas seulement de cette
    // ligne.
    expect(operations(releve('31/02/2026 ACHAT CB 45,20'))).toEqual([])
  })

  it('ne confond pas une date écrite en points avec le montant', () => {
    expect(operations(releve('05.01.2026 ACHAT CB 1234,56')))
      .toEqual([{ date: '2026-01-05', libelle: 'ACHAT CB', montant: 1234.56 }])
  })
})

describe('parseLignesFromPdf — lignes écartées et libellé', () => {
  it('écarte les lignes de solde, qui ne sont pas des opérations', () => {
    const texte = releve(
      'SOLDE PRECEDENT AU 31/12/2025 1 000,00',
      '05/01/2026 ACHAT CB 45,20',
      'SOLDE EN FIN DE PERIODE 954,80',
    )
    expect(operations(texte).map((l) => l.libelle)).toEqual(['ACHAT CB'])
  })

  it('donne un libellé de repli quand il ne reste rien entre la date et le montant', () => {
    expect(operations(releve('05/01/2026 45,20'))[0].libelle).toBe('Mouvement bancaire')
  })

  it('rend une liste vide sur un texte sans opération', () => {
    expect(operations([])).toEqual([])
    expect(operations(releve('BANQUE POPULAIRE', 'Relevé de compte', ''))).toEqual([])
  })
})

describe('seuilDeuxColonnes', () => {
  it('sépare deux colonnes au plus grand écart horizontal', () => {
    // Débits imprimés vers 400, crédits vers 500 : la frontière tombe entre les deux.
    expect(seuilDeuxColonnes([400, 402, 398, 500, 503])).toBe(451)
  })

  it('ne sépare rien quand tous les montants sont dans la même colonne', () => {
    // Le désalignement d'un relevé (symbole € présent sur certaines lignes seulement) ne doit pas
    // passer pour une seconde colonne. Rendre null plutôt que de couper au milieu du bruit : une
    // seule colonne occupée ne dit pas *laquelle*, et deviner inverserait une ligne sur deux.
    expect(seuilDeuxColonnes([400, 402, 398, 405])).toBeNull()
    expect(seuilDeuxColonnes([400])).toBeNull()
    expect(seuilDeuxColonnes([])).toBeNull()
  })
})

describe('parseLignesFromPdf — relevé à deux colonnes Débit / Crédit', () => {
  // Mise en page la plus répandue sur les relevés français : le sens ne se lit pas dans le montant,
  // qui est toujours imprimé positif, mais dans la colonne qui le porte. C'est ce qui manquait à
  // l'import PDF, et pourquoi 84 lignes d'un relevé de test sont en base sans un seul débit.
  const deuxColonnes: LignePdf[] = [
    { texte: '05/01/2026 PRLV URSSAF 1517,00', xFin: 400 },
    { texte: '08/01/2026 VIR SEPA CLIENT 1000,00', xFin: 500 },
    { texte: '09/01/2026 CB CARREFOUR 43,10', xFin: 400 },
  ]

  it('signe d’après la colonne : à gauche le débit, à droite le crédit', () => {
    expect(parseLignesFromPdf(deuxColonnes, 'debit_credit').map((l) => l.montant))
      .toEqual([-1517, 1000, -43.1])
  })

  it('laisse le montant tel quel dans le format à une colonne', () => {
    // Le même relevé lu en « montant signé » : la position est ignorée, tout reste positif — c'est
    // exactement le comportement qui a produit les 84 lignes sans débit.
    expect(parseLignesFromPdf(deuxColonnes, 'signe').map((l) => l.montant))
      .toEqual([1517, 1000, 43.1])
  })

  it('ignore le signe imprimé, qui ne veut plus rien dire à deux colonnes', () => {
    const avecSignes: LignePdf[] = [
      { texte: '05/01/2026 PRLV URSSAF -1517,00', xFin: 400 },
      { texte: '08/01/2026 VIR SEPA CLIENT -1000,00', xFin: 500 },
    ]
    expect(parseLignesFromPdf(avecSignes, 'debit_credit').map((l) => l.montant)).toEqual([-1517, 1000])
  })

  it('passe tout en débit quand une seule colonne est occupée', () => {
    // Faute de savoir laquelle, le débit est le choix le moins faux : c'est le cas le plus fréquent,
    // et la prévisualisation reste modifiable. L'écran le dit à l'utilisateur.
    const uneSeule: LignePdf[] = [
      { texte: '05/01/2026 PRLV URSSAF 1517,00', xFin: 400 },
      { texte: '09/01/2026 CB CARREFOUR 43,10', xFin: 402 },
    ]
    expect(parseLignesFromPdf(uneSeule, 'debit_credit').map((l) => l.montant)).toEqual([-1517, -43.1])
  })

  it('choisit le format « signé » par défaut, comportement d’avant', () => {
    expect(parseLignesFromPdf(deuxColonnes).map((l) => l.montant)).toEqual([1517, 1000, 43.1])
  })
})

describe('soldesDuPdf', () => {
  it('rend les soldes d’ouverture et de clôture, et eux seuls', () => {
    // Ils étaient jusqu'ici jetés au parsing : le chemin PDF n'avait donc aucun moyen de vérifier
    // que le relevé bouclait. Les voici rendus à part, pour `controlerSolde`.
    const lignes = releve(
      'SOLDE AU 01/01/2025 8270,84',
      '15/01/2025 VIR SEPA CPAM MARSEILLE 5675,02',
      '20/01/2025 PRLV URSSAF -1200,00',
      'SOLDE AU 31/12/2025 20023,55',
    )
    expect(soldesDuPdf(lignes)).toEqual([
      { date: '2025-01-01', montant: 8270.84 },
      { date: '2025-12-31', montant: 20023.55 },
    ])
  })

  it('n’emporte aucune opération avec lui', () => {
    // Le miroir du test précédent : ce que `soldesDuPdf` prend, `parseLignesFromPdf` ne doit pas le
    // rendre, et réciproquement. Une ligne comptée des deux côtés fausserait le contrôle.
    const lignes = releve(
      'SOLDE AU 01/01/2025 8270,84',
      '15/01/2025 VIR SEPA CPAM MARSEILLE 5675,02',
      'SOLDE AU 31/12/2025 20023,55',
    )
    expect(parseLignesFromPdf(lignes).map((l) => l.libelle)).toEqual(['VIR SEPA CPAM MARSEILLE'])
    expect(soldesDuPdf(lignes)).toHaveLength(2)
  })

  it('ne reconnaît PAS un solde qui n’écrit pas le mot — limite assumée', () => {
    // Sur le relevé réel du dossier de test, les deux lignes de solde portent le NUMÉRO DE COMPTE en
    // guise de libellé. Le chemin CSV les attrape par un signal structurel (moins de colonnes que les
    // opérations) qui ne survit pas au recollage de pdf.js.
    //
    // Une heuristique textuelle — « aucun mot d'au moins trois lettres » — a été essayée et ÉCARTÉE :
    // confrontée aux données réelles elle attrapait 32 vrais encaissements CPAM, dont un à 14 812 €,
    // pour 2 lignes de solde. Ce test fige le comportement actuel ET la raison de ne pas l'« améliorer »
    // à l'aveugle : mieux vaut un contrôle qui ne tourne pas qu'un import qui perd des recettes.
    const lignes = releve(
      '01/01/2025 02871 073921S 8270,84',
      '25/03/2025 0000001366072490830101250325 14812,01',
      '31/12/2025 02871 073921S 20023,55',
    )
    expect(soldesDuPdf(lignes)).toEqual([])
    // Les trois restent donc des opérations — y compris le vrai encaissement de 14 812,01 €, que
    // l'heuristique écartée aurait supprimé.
    expect(parseLignesFromPdf(lignes).map((l) => l.montant)).toEqual([8270.84, 14812.01, 20023.55])
  })
})

describe('parseLignesFromPdf — mode « tous » (aperçu d’import)', () => {
  it('rend toutes les lignes en marquant celles qui sont des soldes', () => {
    // L'aperçu montre TOUT : c'est ce qui permet à l'opérateur de cocher lui-même les soldes que sa
    // banque n'a pas nommés. Rien n'est caché, rien n'est jeté avant qu'il ait vu.
    const lignes = releve(
      'SOLDE AU 01/01/2025 8270,84',
      '15/01/2025 VIR SEPA CPAM MARSEILLE 5675,02',
      'SOLDE AU 31/12/2025 20023,55',
    )
    // Le drapeau et le montant, pas le libellé : celui-ci se lit ENTRE la date et le montant, or
    // « SOLDE AU » est écrit avant la date — il ne survit donc pas au découpage, et c'est sans
    // importance puisque la ligne ne s'importe pas.
    expect(parseLignesFromPdf(lignes, 'signe', 'tous').map((l) => [l.montant, l.estSolde])).toEqual([
      [8270.84, true],
      [5675.02, false],
      [20023.55, true],
    ])
  })

  it('marque « false » un solde que la banque n’a pas nommé — à l’opérateur de cocher', () => {
    // Le relevé réel du dossier de test : les lignes de solde portent le numéro de compte. Aucune
    // heuristique fiable ne les distingue d'un encaissement CPAM (voir soldesDuPdf), donc elles
    // arrivent décochées et l'écran demande explicitement de les désigner.
    const lignes = releve(
      '01/01/2025 02871 073921S 8270,84',
      '25/03/2025 0000001366072490830101250325 14812,01',
    )
    expect(parseLignesFromPdf(lignes, 'signe', 'tous').every((l) => l.estSolde === false)).toBe(true)
  })

  it('ne pose le drapeau que dans ce mode', () => {
    // En mode 'operations', `estSolde` n'a aucun sens : les soldes ont déjà été retirés. Le laisser
    // traîner à `false` inviterait à s'y fier là où il ne veut rien dire.
    const lignes = releve('15/01/2025 VIR SEPA CPAM 5675,02')
    expect(parseLignesFromPdf(lignes).every((l) => l.estSolde === undefined)).toBe(true)
  })
})
