import { describe, expect, it } from 'vitest'
import { convertirMontants, deviseDuTexte, enEuros, libelleConversion, tauxApplicable } from './devises'

// Les taux utilisés ici sont les vrais taux BCE des dates concernées, relevés sur le portail de la
// banque : USD 1,1698 au 09/07/2025, 1,1648 au 08/08/2025. Les factures OpenAI du dossier portent
// d'ailleurs leur propre équivalent en euros — « $4.00 ... (€3.42) » — ce qui donne 1,1696 et confirme
// la valeur de façon indépendante.

describe('deviseDuTexte', () => {
  it('reconnaît le dollar sur une facture américaine', () => {
    expect(deviseDuTexte('$24.00 USD due July 9, 2025')).toBe('USD')
    expect(deviseDuTexte('Total $20.00')).toBe('USD')
  })

  it('fait primer l’euro sur tout autre symbole présent', () => {
    // Le piège : une facture en euros émise par un prestataire américain, qui rappelle ses tarifs en
    // dollars ou porte simplement une adresse à San Francisco. La lire en USD retrancherait un
    // sixième du montant sans que rien ne le signale.
    expect(deviseDuTexte('OpenAI, LLC, San Francisco — Total 24,00 € (tarif public $24.00)')).toBe('EUR')
    expect(deviseDuTexte('Montant TTC 1 863,79 EUR')).toBe('EUR')
  })

  it('ne devine rien plutôt que de deviner mal', () => {
    expect(deviseDuTexte('Facture n° LI00180789 du 01/10/2025')).toBeNull()
    expect(deviseDuTexte('')).toBeNull()
    expect(deviseDuTexte(null)).toBeNull()
  })

  it('ne prend pas un dollar isolé pour une devise sans montant derrière', () => {
    // « $ » seul, dans une référence ou un identifiant, ne dit pas que la facture est en dollars.
    expect(deviseDuTexte('Référence A$B interne')).toBeNull()
  })
})

describe('tauxApplicable', () => {
  const cotations = [
    { date: '2025-08-06', taux: 1.1662 },
    { date: '2025-08-07', taux: 1.1657 },
    { date: '2025-08-08', taux: 1.1648 },
  ]

  it('retient la cotation du jour quand elle existe', () => {
    expect(tauxApplicable(cotations, '2025-08-07')).toEqual({ date: '2025-08-07', taux: 1.1657 })
  })

  it('recule au dernier jour coté pour un samedi', () => {
    // Cas réel : la facture OpenAI d'août est datée du 9, un samedi. La BCE ne cote pas le week-end,
    // le taux applicable est celui du vendredi 8.
    expect(tauxApplicable(cotations, '2025-08-09')).toEqual({ date: '2025-08-08', taux: 1.1648 })
  })

  it('ne suppose aucun ordre dans les cotations reçues', () => {
    // La fonction ne trie pas ce qu'on lui donne, et rien ne garantit l'ordre des lignes rendues par
    // la base sans ORDER BY explicite. Prendre « la dernière vue » au lieu de « la plus récente »
    // passe inaperçu sur un jeu déjà trié, et donne un taux d'un autre jour sur un jeu qui ne l'est
    // pas — donc un montant faux, sans rien pour le signaler.
    const desordre = [
      { date: '2025-08-08', taux: 1.1648 },
      { date: '2025-08-06', taux: 1.1662 },
      { date: '2025-08-07', taux: 1.1657 },
    ]
    expect(tauxApplicable(desordre, '2025-08-09')).toEqual({ date: '2025-08-08', taux: 1.1648 })
    expect(tauxApplicable(desordre, '2025-08-07')).toEqual({ date: '2025-08-07', taux: 1.1657 })
  })

  it('ne prend JAMAIS une cotation postérieure à la pièce', () => {
    // Convertir avec un cours qui n'existait pas encore le jour de la facture est indéfendable
    // devant un contrôle, même quand l'écart est minime.
    expect(tauxApplicable(cotations, '2025-08-05')).toBeNull()
  })
})

describe('enEuros', () => {
  it('divise par le taux BCE, jamais ne multiplie', () => {
    // L'erreur qui ne se voit pas : multiplier donne 28,08 au lieu de 20,52 — un montant plausible,
    // faux de 37 %.
    expect(enEuros(24, 1.1698)).toBe(20.52)
    expect(enEuros(4, 1.1698)).toBe(3.42)
  })

  it('arrondit au centime', () => {
    expect(enEuros(20, 1.1698)).toBe(17.10)
  })
})

describe('convertirMontants', () => {
  it('convertit une facture OpenAI réelle', () => {
    expect(convertirMontants({ montant_ht: 20, montant_tva: 4, montant_ttc: 24 }, 1.1698))
      .toEqual({ montant_ht: 17.10, montant_tva: 3.42, montant_ttc: 20.52 })
  })

  it('déduit le TTC de la somme, et ne le convertit pas pour lui-même', () => {
    // Trois arrondis indépendants peuvent casser l'identité HT + TVA = TTC : à un taux de 3,
    // 0,05 + 0,05 = 0,10 donne 0,02 + 0,02 d'un côté et 0,03 de l'autre. La pièce serait alors
    // signalée par le contrôle de TVA impossible alors que seule la conversion est en cause.
    const converti = convertirMontants({ montant_ht: 0.05, montant_tva: 0.05, montant_ttc: 0.10 }, 3)
    expect(converti).toEqual({ montant_ht: 0.02, montant_tva: 0.02, montant_ttc: 0.04 })
    expect(converti.montant_ht! + converti.montant_tva!).toBeCloseTo(converti.montant_ttc!, 10)
  })

  it('convertit le TTC directement quand il n’y a rien à additionner', () => {
    // Sans HT ni TVA lus, refuser de convertir laisserait un montant en devise étrangère dans une
    // comptabilité tenue en euros — pire que l'approximation d'un centime.
    expect(convertirMontants({ montant_ht: null, montant_tva: null, montant_ttc: 24 }, 1.1698))
      .toEqual({ montant_ht: null, montant_tva: null, montant_ttc: 20.52 })
    expect(convertirMontants({ montant_ht: 20, montant_tva: null, montant_ttc: 24 }, 1.1698))
      .toEqual({ montant_ht: 17.10, montant_tva: null, montant_ttc: 20.52 })
  })

  it('laisse les montants absents absents', () => {
    expect(convertirMontants({ montant_ht: null, montant_tva: null, montant_ttc: null }, 1.1698))
      .toEqual({ montant_ht: null, montant_tva: null, montant_ttc: null })
  })

  it('traite un avoir comme une facture', () => {
    expect(convertirMontants({ montant_ht: -20, montant_tva: -4, montant_ttc: -24 }, 1.1698))
      .toEqual({ montant_ht: -17.10, montant_tva: -3.42, montant_ttc: -20.52 })
  })
})

describe('libelleConversion', () => {
  it('dit tout ce qu’il faut pour refaire le calcul', () => {
    expect(libelleConversion(24, 'USD', 1.1698, '2025-07-09'))
      .toBe('24,00 USD au taux BCE du 09/07/2025 (1 EUR = 1,1698 USD)')
  })
})
