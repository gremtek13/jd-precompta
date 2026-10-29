import { describe, expect, it } from 'vitest'
import {
  compteDeLApplication, compteDeLApplicationSelon, compteQueLApplicationEcrit, compteQueLApplicationEcritSelon, dateOuverture,
  ouvertureBanque, preparerANouveaux, preparerANouveauxSelon,
} from './aNouveaux'
import { CAISSE_EXPORTEE } from './caisse'
import type { LigneBalance } from './balanceImport'
import type { ANouveau } from './types'
import { A_NOUVEAU_NON_VALIDE } from '../test/ecritures'
import { PLAN_DECALE, PLAN_PAR_DEFAUT } from './planComptable'

const ligne = (compte: string, debit: number, credit: number, libelle = ''): LigneBalance => ({ compte, libelle, debit, credit })

// Une balance d'AVANT clôture, équilibrée, telle qu'un logiciel l'exporte au 31/12 : les comptes de
// bilan, et les charges et produits de l'année qui font un bénéfice de 15 000 €.
const BALANCE_2025: LigneBalance[] = [
  ligne('2183', 3000, 0, 'Matériel informatique'),
  ligne('28183', 0, 1200, 'Amortissements matériel informatique'),
  ligne('164', 0, 8000, 'Emprunts'),
  ligne('51210000', 10000, 4000, 'Banque Populaire'),
  ligne('108', 15200, 0, 'Compte de l’exploitant'),
  ligne('4456600', 150, 150, 'TVA déductible'),
  ligne('606100', 5000, 0, 'Achats'),
  ligne('706000', 0, 20000, 'Honoraires'),
]

describe('compteDeLApplication', () => {
  it('ramène tout compte de banque au compte banque de l’application', () => {
    for (const numero of ['512', '5120', '5121', '51210000', '512000', '5124']) {
      expect(compteDeLApplication(numero, PLAN_PAR_DEFAUT)).toBe('512000')
    }
  })

  it('reconnaît un compte de TVA écrit sur une autre longueur, et lui seul', () => {
    expect(compteDeLApplication('44566', PLAN_PAR_DEFAUT)).toBe('445660')
    expect(compteDeLApplication('4456600', PLAN_PAR_DEFAUT)).toBe('445660')
    expect(compteDeLApplication('44571000', PLAN_PAR_DEFAUT)).toBe('445710')
    // Mêmes premiers chiffres, autre compte : 4456 n'est pas 44566, 4457 n'est pas 44571.
    expect(compteDeLApplication('4456', PLAN_PAR_DEFAUT)).toBe('4456')
    expect(compteDeLApplication('4457', PLAN_PAR_DEFAUT)).toBe('4457')
  })

  it('laisse tout autre compte sous le numéro de la balance', () => {
    for (const numero of ['2183', '28183', '164', '108', '401000']) {
      expect(compteDeLApplication(numero, PLAN_PAR_DEFAUT)).toBe(numero)
    }
  })
})

// LES COMPTES QUE LA REPRISE NE RANGE PAS, alors que l'application écrit elle-même ce qu'ils portent : un 4455100 s'ouvre
// sous ce numéro quand le paiement de la TVA écrit au 445510, un 164100 garde le capital quand les échéances écrivent au
// 164000. Rien ne change de ce qui s'écrit : l'écran le DIT (BalanceCard), en attendant que la reprise range le plan
// (ligne 43). Les comptes sont fictifs, et leurs racines celles du plan comptable de 2026.
describe('compteQueLApplicationEcrit', () => {
  it('nomme le compte de l’application pour un compte de rôle sur une autre longueur', () => {
    for (const [balance, application] of [
      ['4455100', '445510'], ['445620000', '445620'], ['4456700', '445670'], ['44583', '445830'],
      ['4010000', '401000'], ['404', '404000'], ['41100000', '411000'], ['108', '108000'], ['4550000', '455000'],
      ['467', '467000'], ['164', '164000'], ['1640000', '164000'], ['1010000', '101000'], ['120', '120000'],
      ['1290000', '129000'], ['2750', '275000'], ['58', '580000'],
    ]) expect(compteQueLApplicationEcrit(balance, PLAN_PAR_DEFAUT), balance).toBe(application)
  })

  it('nomme le compte de l’application pour un autre sous-compte de la racine d’un rôle', () => {
    expect(compteQueLApplicationEcrit('164100', PLAN_PAR_DEFAUT)).toBe('164000')
    expect(compteQueLApplicationEcrit('445661', PLAN_PAR_DEFAUT)).toBe('445660')
    expect(compteQueLApplicationEcrit('445711', PLAN_PAR_DEFAUT)).toBe('445710')
    expect(compteQueLApplicationEcrit('401100', PLAN_PAR_DEFAUT)).toBe('401000')
    expect(compteQueLApplicationEcrit('1081', PLAN_PAR_DEFAUT)).toBe('108000')
  })

  // Le compte du bien et celui de son amortissement, sur six chiffres sans leurs zéros de fin — et un sixième chiffre
  // significatif qui se garde, comme `compteAmortissement` le garde.
  it('nomme la forme à six chiffres d’un compte de bien ou d’amortissement', () => {
    expect(compteQueLApplicationEcrit('2183', PLAN_PAR_DEFAUT)).toBe('218300')
    expect(compteQueLApplicationEcrit('2183000', PLAN_PAR_DEFAUT)).toBe('218300')
    expect(compteQueLApplicationEcrit('28183', PLAN_PAR_DEFAUT)).toBe('281830')
    expect(compteQueLApplicationEcrit('2818300', PLAN_PAR_DEFAUT)).toBe('281830')
    expect(compteQueLApplicationEcrit('2805', PLAN_PAR_DEFAUT)).toBe('280500')
  })

  it('se tait sur un compte que l’application écrit sous ce numéro, sur un compte rangé, et sur un autre compte', () => {
    for (const numero of [
      '445510', '401000', '108000', '164000', '120000', '275000', '580000', '218300', '281830', '2818311', '218311',
      // Rangés par la reprise elle-même : la banque, et la TVA déductible ou collectée à des zéros près.
      '512', '51210000', '44566', '4456600', '44571000',
      // Mêmes premiers chiffres, autre compte du plan : 4456 n'est pas 44566, 4457 n'est pas 44571, 12 n'est pas 120.
      '4456', '445700', '12',
      // Aucun rôle : l'application n'y écrit pas d'elle-même.
      '1681', '2611', '4386', '271000', '5300',
    ]) expect(compteQueLApplicationEcrit(numero, PLAN_PAR_DEFAUT), numero).toBeNull()
  })
})

describe('preparerANouveaux', () => {
  it('dit les comptes repris sous leur numéro alors que l’application écrit sous un autre, sans rien changer à ce qui s’écrit', () => {
    const p = preparerANouveaux([
      ligne('51210000', 3000, 0, 'Banque'),
      ligne('4455100', 0, 400, 'TVA à décaisser'),
      ligne('164100', 0, 2000, 'Emprunt'),
      ligne('44566', 100, 0, 'TVA déductible'),
      ligne('401000', 0, 700, 'Fournisseurs'),
    ], 2026, PLAN_PAR_DEFAUT)
    expect(p.refus).toBeNull()
    expect(p.nonRanges).toEqual([
      { compteOrigine: '4455100', libelle: 'TVA à décaisser', compte: '445510' },
      { compteOrigine: '164100', libelle: 'Emprunt', compte: '164000' },
    ])
    // Les rangés restent à leur place, et les à-nouveaux gardent le numéro de la balance.
    expect(p.rapproches.map((r) => r.compteOrigine)).toEqual(['51210000', '44566'])
    expect(p.lignes.map((l) => l.compte)).toEqual(['512000', '4455100', '164100', '445660', '401000'])
  })

  it('ne dit rien d’une balance tenue sur les comptes de l’application', () => {
    const p = preparerANouveaux([ligne('512000', 900, 0), ligne('445510', 0, 200), ligne('108000', 0, 700)], 2026, PLAN_PAR_DEFAUT)
    expect(p.nonRanges).toEqual([])
  })

  it('ouvre les seuls comptes de bilan, et reprend le résultat en 120 en attente d’affectation', () => {
    const p = preparerANouveaux(BALANCE_2025, 2026, PLAN_PAR_DEFAUT)
    expect(p.refus).toBeNull()
    expect(p.lignes.map((l) => [l.compte, l.compteOrigine, l.sens, l.montant])).toEqual([
      ['2183', '2183', 'debit', 3000],
      ['28183', '28183', 'credit', 1200],
      ['164', '164', 'credit', 8000],
      ['512000', '51210000', 'debit', 6000],
      ['108', '108', 'debit', 15200],
      ['120000', null, 'credit', 15000],
    ])
    expect(p.resultat?.libelle).toBe('Résultat de l’exercice 2025 (bénéfice), en attente d’affectation')
    expect(p.totalDebit).toBe(24200)
    expect(p.totalCredit).toBe(24200)
  })

  it('n’ouvre JAMAIS une charge ni un produit : ils appartiennent à l’exercice qui les a portés', () => {
    const comptes = preparerANouveaux(BALANCE_2025, 2026, PLAN_PAR_DEFAUT).lignes.map((l) => l.compte)
    expect(comptes.some((c) => c.startsWith('6') || c.startsWith('7'))).toBe(false)
  })

  it('reprend une perte en 129, au débit', () => {
    const p = preparerANouveaux([
      ligne('512', 1000, 0, 'Banque'),
      ligne('108', 0, 6000, 'Compte de l’exploitant'),
      ligne('606100', 9000, 0), ligne('706000', 0, 4000),
    ], 2026, PLAN_PAR_DEFAUT)
    expect(p.refus).toBeNull()
    expect(p.resultat).toEqual({
      compte: '129000', compteOrigine: null, sens: 'debit', montant: 5000,
      libelle: 'Résultat de l’exercice 2025 (perte), en attente d’affectation',
    })
  })

  it('n’ajoute aucun résultat sur une balance d’après clôture, et garde le 120 qu’elle porte', () => {
    const p = preparerANouveaux([
      ligne('512', 4000, 0, 'Banque'),
      ligne('120000', 0, 4000, 'Résultat de l’exercice'),
    ], 2026, PLAN_PAR_DEFAUT)
    expect(p.resultat).toBeNull()
    expect(p.lignes).toEqual([
      { compte: '512000', compteOrigine: '512', libelle: 'Banque', sens: 'debit', montant: 4000 },
      { compte: '120000', compteOrigine: '120000', libelle: 'Résultat de l’exercice', sens: 'credit', montant: 4000 },
    ])
  })

  it('compte les comptes soldés sans les ouvrir', () => {
    expect(preparerANouveaux(BALANCE_2025, 2026, PLAN_PAR_DEFAUT).soldes).toBe(1)
  })

  it('dit quels comptes changent de numéro, et garde une ligne par compte de la balance', () => {
    // L'application ne tient qu'un compte banque : deux banques de la balance y sont réunies, et
    // l'écran doit pouvoir le dire. Une ligne chacune, pour garder d'où vient chaque montant.
    const p = preparerANouveaux([
      ligne('51210000', 3000, 0, 'Banque Populaire'),
      ligne('51220000', 500, 0, 'Crédit Agricole'),
      ligne('44566', 200, 0, 'TVA déductible'),
      ligne('108', 0, 3700, 'Compte de l’exploitant'),
    ], 2026, PLAN_PAR_DEFAUT)
    expect(p.refus).toBeNull()
    expect(p.rapproches).toEqual([
      { compteOrigine: '51210000', libelle: 'Banque Populaire', compte: '512000' },
      { compteOrigine: '51220000', libelle: 'Crédit Agricole', compte: '512000' },
      { compteOrigine: '44566', libelle: 'TVA déductible', compte: '445660' },
    ])
    expect(p.lignes.filter((l) => l.compte === '512000').map((l) => l.montant)).toEqual([3000, 500])
  })

  it('écarte une classe 8 soldée, et le dit', () => {
    const p = preparerANouveaux([...BALANCE_2025, ligne('801', 100, 0), ligne('802', 0, 100)], 2026, PLAN_PAR_DEFAUT)
    expect(p.refus).toBeNull()
    expect(p.classe8).toBe(2)
    expect(p.lignes.some((l) => l.compte.startsWith('8'))).toBe(false)
  })

  it('REFUSE une classe 8 non soldée : ce sont des écritures de clôture', () => {
    // Une balance où 891 « bilan de clôture » solde les comptes de bilan : ouvrir ce qui reste ferait
    // des à-nouveaux déséquilibrés du montant de tout le bilan.
    const p = preparerANouveaux([
      ligne('512', 5000, 0), ligne('108', 0, 5000),
      ligne('891', 5000, 5000), ligne('890', 0, 700), ligne('512100', 700, 0),
    ], 2026, PLAN_PAR_DEFAUT)
    expect(p.refus).toMatch(/classe 8 de cette balance ne sont pas soldés \(700,00\s€\)/)
  })

  it('REFUSE un écart d’un centime, que la lecture de la balance tolère', () => {
    const p = preparerANouveaux([ligne('512', 100.01, 0), ligne('108', 0, 100)], 2026, PLAN_PAR_DEFAUT)
    expect(p.refus).toMatch(/ne s’équilibrent pas au centime \(écart de 0,01\s€\)/)
  })

  it('compte en centimes : 0,10 + 0,20 font bien 0,30', () => {
    const p = preparerANouveaux([ligne('2183', 0.1, 0), ligne('2184', 0.2, 0), ligne('108', 0, 0.3)], 2026, PLAN_PAR_DEFAUT)
    expect(p.refus).toBeNull()
    expect(p.totalDebit).toBe(0.3)
  })

  it('dit qu’il n’y a rien à reprendre plutôt que d’enregistrer zéro ligne', () => {
    const p = preparerANouveaux([ligne('512', 100, 100), ligne('108', 50, 50)], 2026, PLAN_PAR_DEFAUT)
    expect(p.lignes).toEqual([])
    expect(p.refus).toBe('Aucun solde à reprendre : tous les comptes de bilan de cette balance sont soldés.')
  })
})

describe('dateOuverture', () => {
  it('ouvre l’exercice à son 1er janvier', () => {
    expect(dateOuverture(2026)).toBe('2026-01-01')
  })
})

describe('ouvertureBanque', () => {
  const aNouveau = (o: Partial<ANouveau>): ANouveau => ({
    id: 'a', dossier_id: 'd', date: '2026-01-01', compte: '512000', compte_origine: '512', libelle: 'Banque',
    sens: 'debit', montant: 0, source_nom: 'balance.csv', source_empreinte: 'e'.repeat(64), ...A_NOUVEAU_NON_VALIDE,
    created_at: '2026-09-26T10:00:00Z', ...o,
  })

  it('rend null quand rien n’ouvre le dossier', () => {
    expect(ouvertureBanque([])).toBeNull()
  })

  it('somme les lignes du compte banque, dans leur sens', () => {
    expect(ouvertureBanque([
      aNouveau({ id: 'a', montant: 6000 }),
      aNouveau({ id: 'b', montant: 499.9, sens: 'credit' }),
      aNouveau({ id: 'c', compte: '108', compte_origine: '108', montant: 5500.1, sens: 'credit' }),
    ])).toEqual({ date: '2026-01-01', solde: 5500.1 })
  })

  it('rend un solde NUL, pas null, quand la reprise ne porte aucune banque', () => {
    // La banque était soldée à la reprise : un zéro connu, que la trésorerie doit afficher sans
    // mise en garde.
    expect(ouvertureBanque([aNouveau({ compte: '2183', compte_origine: '2183', montant: 3000 })]))
      .toEqual({ date: '2026-01-01', solde: 0 })
  })
})

// LA CAISSE REPRISE (ligne 26.6, étape C2). La caisse en base, tout compte 53 de la balance se range sur la caisse du PLAN :
// c'est le seul compte de caisse que la base lit pour juger la caisse (`premier_jour_negatif_de_la_caisse`). Une caisse
// reprise au crédit se refuse avant le clic, sous les mots de la base. Le drapeau baissé, la reprise d'hier : un 53 reste
// sous son numéro.
describe('la caisse reprise, selon que la caisse est en base', () => {
  it('en base : tout 53 sur la caisse du plan, réunis, et l’écran le dit ; sinon, sous son numéro', () => {
    for (const plan of [PLAN_PAR_DEFAUT, PLAN_DECALE]) {
      for (const numero of ['53', '530', '5300', '5310000', plan.caisse]) {
        expect(compteDeLApplicationSelon(numero, plan, true), numero).toBe(plan.caisse)
        expect(compteDeLApplicationSelon(numero, plan, false), numero).toBe(numero)
        expect(compteQueLApplicationEcritSelon(numero, plan, true), numero).toBeNull()
      }
    }
    const balance = [ligne('5300', 30, 0, 'Caisse'), ligne('5310', 20, 0, 'Caisse secondaire'), ligne('101', 0, 50, 'Capital')]
    const avec = preparerANouveauxSelon(balance, 2026, PLAN_PAR_DEFAUT, true)
    expect(avec.refus).toBeNull()
    expect(avec.lignes.filter((l) => l.compte === '530000').map((l) => `${l.compteOrigine} ${l.montant}`)).toEqual(['5300 30', '5310 20'])
    expect(avec.rapproches.map((r) => `${r.compteOrigine} ${r.compte}`)).toEqual(['5300 530000', '5310 530000'])
    const sans = preparerANouveauxSelon(balance, 2026, PLAN_PAR_DEFAUT, false)
    expect(sans.lignes.map((l) => l.compte)).toEqual(['5300', '5310', '101'])
  })

  it('en base : une caisse reprise au crédit se refuse, sous les mots de la base ; un crédit qu’un débit couvre passe', () => {
    const credit = [ligne('530', 0, 40, 'Caisse'), ligne('101', 40, 0, 'Capital')]
    expect(preparerANouveauxSelon(credit, 2026, PLAN_PAR_DEFAUT, true).refus)
      .toBe('Une ouverture de la caisse au crédit, 40,00 €, la rendrait négative le 01/01/2026 (−40,00 €) : le solde d\'une caisse est débiteur ou nul.')
    expect(preparerANouveauxSelon(credit, 2026, PLAN_PAR_DEFAUT, false).refus).toBeNull()
    const couvert = [ligne('5300', 0, 10, 'Caisse'), ligne('5310', 25, 0, 'Caisse secondaire'), ligne('101', 0, 15, 'Capital')]
    expect(preparerANouveauxSelon(couvert, 2026, PLAN_PAR_DEFAUT, true).refus).toBeNull()
    const decouvert = [ligne('5300', 0, 30, 'Caisse'), ligne('5310', 25, 0, 'Caisse secondaire'), ligne('101', 5, 0, 'Capital')]
    expect(preparerANouveauxSelon(decouvert, 2026, PLAN_PAR_DEFAUT, true).refus)
      .toBe('Une ouverture de la caisse au crédit, 30,00 €, la rendrait négative le 01/01/2026 (−5,00 €) : le solde d\'une caisse est débiteur ou nul.')
  })

  it('le module chargé normalement suit son drapeau', () => {
    expect(compteDeLApplication('5300', PLAN_PAR_DEFAUT)).toBe(CAISSE_EXPORTEE ? '530000' : '5300')
    expect(preparerANouveaux([ligne('530', 0, 40), ligne('101', 40, 0)], 2026, PLAN_PAR_DEFAUT).refus === null).toBe(!CAISSE_EXPORTEE)
  })
})
