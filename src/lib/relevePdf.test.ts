import { describe, expect, it } from 'vitest'
import { parseLignesFromPdfText } from './relevePdf'

// Un relevé PDF converti en texte : une opération par ligne, date en tête, montant en queue.
const releve = (...lignes: string[]) => lignes.join('\n')

describe('parseLignesFromPdfText — lecture du montant', () => {
  it('lit un montant à quatre chiffres écrit sans séparateur de milliers', () => {
    // 144 des 569 lignes en base dépassent 1 000 €. L'expression régulière ne connaissait que la
    // forme groupée : faute de séparateur elle s'accrochait aux trois derniers chiffres avant la
    // virgule, et 20 846,47 € entrait en base à 846,47 € — sans le moindre signal.
    expect(parseLignesFromPdfText(releve('05/01/2026 VIREMENT SALAIRE 1234,56')))
      .toEqual([{ date: '2026-01-05', libelle: 'VIREMENT SALAIRE', montant: 1234.56 }])
    expect(parseLignesFromPdfText(releve('05/01/2026 GROS VIREMENT 20846,47'))[0].montant).toBe(20846.47)
  })

  it('perd le signe d’un débit écrit sans séparateur : non', () => {
    // Le pire des deux : le montant tronqué ET le sens inversé. 361 des 569 lignes sont des débits.
    expect(parseLignesFromPdfText(releve('05/01/2026 PRELEVEMENT URSSAF -1500,00'))[0].montant).toBe(-1500)
  })

  it('accepte les trois séparateurs de milliers rencontrés selon la banque', () => {
    const montants = parseLignesFromPdfText(releve(
      '05/01/2026 ESPACE 1 234,56 €',
      '06/01/2026 POINT 1.234,56 €',
      '07/01/2026 ANGLO 1,234.56 €',
    )).map((l) => l.montant)
    expect(montants).toEqual([1234.56, 1234.56, 1234.56])
  })

  it('résiste aux espaces doublés laissés par le recollage des fragments pdf.js', () => {
    // pdf.js rend des fragments positionnés, pas des lignes ; les recoller insère un espace là où il
    // y en avait déjà un. "1  234,56" ne ressemblait plus à un montant groupé.
    expect(parseLignesFromPdfText(releve('05/01/2026 VIREMENT  1  234,56  €'))[0].montant).toBe(1234.56)
  })

  it('reconnaît le signe rejeté en fin et celui porté par des parenthèses', () => {
    const montants = parseLignesFromPdfText(releve(
      '05/01/2026 FRAIS TENUE DE COMPTE 45,20-',
      '06/01/2026 COMMISSION (45,20)',
    )).map((l) => l.montant)
    expect(montants).toEqual([-45.2, -45.2])
  })

  it('accepte « € » comme « EUR », avec ou sans symbole', () => {
    const montants = parseLignesFromPdfText(releve(
      '05/01/2026 CARTE DIFFEREE 45,20 EUR',
      '06/01/2026 ACHAT CB 45,20 €',
      '07/01/2026 ACHAT CB 45,20',
    )).map((l) => l.montant)
    expect(montants).toEqual([45.2, 45.2, 45.2])
  })

  it('ignore une ligne sans montant en fin plutôt que d’en inventer un', () => {
    expect(parseLignesFromPdfText(releve('05/01/2026 LIBELLE QUI DEBORDE SUR LA LIGNE SUIVANTE'))).toEqual([])
  })
})

describe('parseLignesFromPdfText — choix de la date', () => {
  it('retient la date de début de ligne, pas celle rappelée dans le libellé', () => {
    // Une ligne de paiement par carte rappelle couramment la date d'achat. Sur les relevés où la
    // date d'opération est écrite en jour/mois, chercher une date complète n'importe où dans la
    // ligne faisait gagner celle du libellé : mauvaise date, et libellé amputé de son début.
    const texte = releve(
      'Relevé de votre compte au 31/01/23',
      '05/01 CB FACTURE DU 03/01/26 CARREFOUR 45,20',
    )
    expect(parseLignesFromPdfText(texte))
      .toEqual([{ date: '2023-01-05', libelle: 'CB FACTURE DU 03/01/26 CARREFOUR', montant: 45.2 }])
  })

  it('se rabat sur une date trouvée ailleurs quand la ligne n’en porte pas au début', () => {
    // Mise en page qui fait précéder la date d'un code opération : mieux vaut une date tardive que
    // pas de ligne du tout.
    expect(parseLignesFromPdfText(releve('OP 44 12/03/2026 VIREMENT 45,20'))[0].date).toBe('2026-03-12')
  })

  it('complète une date jour/mois avec l’année de la période du relevé', () => {
    const texte = releve(
      'Relevé de votre compte au 31/01/23',
      '05/01 ACHAT CB 45,20',
    )
    expect(parseLignesFromPdfText(texte)[0].date).toBe('2023-01-05')
  })

  it('attribue à l’année précédente un mois postérieur à celui de la période', () => {
    // Un relevé de janvier commence souvent par des opérations de décembre.
    const texte = releve(
      'Relevé de votre compte au 31/01/23',
      '28/12 ACHAT CB 45,20',
    )
    expect(parseLignesFromPdfText(texte)[0].date).toBe('2022-12-28')
  })

  it('ignore une date jour/mois faute de période : aucune année à lui attribuer', () => {
    expect(parseLignesFromPdfText(releve('05/01 ACHAT CB 45,20'))).toEqual([])
  })

  it('ignore une date qui n’existe pas au calendrier', () => {
    // Laisser passer "2026-02-31" ferait échouer l'insertion de tout le lot, pas seulement de cette
    // ligne.
    expect(parseLignesFromPdfText(releve('31/02/2026 ACHAT CB 45,20'))).toEqual([])
  })

  it('ne confond pas une date écrite en points avec le montant', () => {
    expect(parseLignesFromPdfText(releve('05.01.2026 ACHAT CB 1234,56')))
      .toEqual([{ date: '2026-01-05', libelle: 'ACHAT CB', montant: 1234.56 }])
  })
})

describe('parseLignesFromPdfText — lignes écartées et libellé', () => {
  it('écarte les lignes de solde, qui ne sont pas des opérations', () => {
    const texte = releve(
      'SOLDE PRECEDENT AU 31/12/2025 1 000,00',
      '05/01/2026 ACHAT CB 45,20',
      'SOLDE EN FIN DE PERIODE 954,80',
    )
    expect(parseLignesFromPdfText(texte).map((l) => l.libelle)).toEqual(['ACHAT CB'])
  })

  it('donne un libellé de repli quand il ne reste rien entre la date et le montant', () => {
    expect(parseLignesFromPdfText(releve('05/01/2026 45,20'))[0].libelle).toBe('Mouvement bancaire')
  })

  it('rend une liste vide sur un texte sans opération', () => {
    expect(parseLignesFromPdfText('')).toEqual([])
    expect(parseLignesFromPdfText(releve('BANQUE POPULAIRE', 'Relevé de compte', ''))).toEqual([])
  })
})
