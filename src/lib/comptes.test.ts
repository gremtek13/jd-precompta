import { describe, expect, it } from 'vitest'
import {
  COMPTE_ARRONDIS_CHARGE, COMPTE_ARRONDIS_PRODUIT, COMPTE_AUTRES_DEBITEURS_CREDITEURS, libelleCompteTenu, libelleDuPlanComptable,
} from './comptes'
import { compteAmortissement } from './amortissements'
import { COMPTES_NOTES_DE_FRAIS } from './engagement'

// LES INTITULÉS DU PLAN COMPTABLE DE 2026. Le CompteLib d'un compte du plan est « l'intitulé complet du compte tel qu'il
// est défini dans la nomenclature » (BOI-CF-IOR-60-40-20, §150) ; l'application écrivait encore, jusque dans le FEC, ceux
// du plan de 2019 pour quatre comptes. RECOPIÉS de la liste de l'art. 1121-1 du règlement ANC n° 2014-03 dans sa version
// consolidée au 1er janvier 2026 (PDF de l'ANC, empreinte SHA-256 55c824b2…, pages 140, 145 et 148), et non du module :
// un test qui relirait `comptes.ts` ne dirait rien de la nomenclature.
const NOMENCLATURE_2026 = {
  '467': 'Divers comptes débiteurs et produits à recevoir',
  '468': 'Divers comptes créditeurs et charges à payer',
  '658': 'Pénalités et autres charges',
  '758': 'Indemnités et autres produits',
} as const

// Ceux de 2019 (version consolidée au 1er janvier 2019), qui ne doivent plus paraître nulle part.
const NOMENCLATURE_2019 = [
  'Autres comptes débiteurs ou créditeurs',
  'Divers — charges à payer et produits à recevoir',
  'Charges diverses de gestion courante',
  'Produits divers de gestion courante',
]

describe('les comptes que l’application tient portent l’intitulé du plan comptable de 2026', () => {
  it('le 467 du dirigeant non associé, le 658 et le 758 de l’arrondi de la CA3', () => {
    expect(libelleCompteTenu(COMPTE_AUTRES_DEBITEURS_CREDITEURS)).toBe(NOMENCLATURE_2026['467'])
    expect(libelleCompteTenu(COMPTE_ARRONDIS_CHARGE)).toBe(NOMENCLATURE_2026['658'])
    expect(libelleCompteTenu(COMPTE_ARRONDIS_PRODUIT)).toBe(NOMENCLATURE_2026['758'])
  })

  it('le 467 et le 468 choisis comme compte de bilan, et leurs sous-comptes', () => {
    expect(libelleDuPlanComptable('467100')).toBe(NOMENCLATURE_2026['467'])
    expect(libelleDuPlanComptable('468000')).toBe(NOMENCLATURE_2026['468'])
    expect(libelleDuPlanComptable('4686')).toBe(NOMENCLATURE_2026['468'])
  })

  it('le choix du compte du dirigeant dit le même intitulé que la balance et le FEC', () => {
    const choix = COMPTES_NOTES_DE_FRAIS.find((c) => c.compte === COMPTE_AUTRES_DEBITEURS_CREDITEURS)
    expect(choix?.libelle).toBe(`467 – ${NOMENCLATURE_2026['467']}`)
  })

  it('aucun intitulé de 2019 ne reste', () => {
    const libelles = [
      ...['467000', '658000', '758000'].map(libelleCompteTenu),
      ...['467', '468'].map(libelleDuPlanComptable),
      ...COMPTES_NOTES_DE_FRAIS.map((c) => c.libelle),
    ]
    for (const ancien of NOMENCLATURE_2019) expect(libelles.join(' | ')).not.toContain(ancien)
  })
})

// LES COMPTES 28 QUE L'APPLICATION ÉCRIT portent un libellé, sur six chiffres comme sur sept : `compteAmortissement` en
// rend sept quand le sixième chiffre du compte du bien est significatif. Un 28 à sept chiffres terminé par un zéro ne vient
// jamais d'elle (elle écrirait le compte sur six) : le libellé que lui donne une balance reprise reste le sien.
describe('libelleCompteTenu — les comptes d’amortissement', () => {
  it('nomme le compte d’amortissement de toute nature, sixième chiffre significatif compris', () => {
    expect(libelleCompteTenu(compteAmortissement('218300'))).toBe('Amortissements du matériel de bureau et matériel informatique')
    expect(compteAmortissement('218311')).toBe('2818311')
    expect(libelleCompteTenu('2818311')).toBe('Amortissements des immobilisations corporelles')
    expect(libelleCompteTenu(compteAmortissement('205011'))).toBe('Amortissements des immobilisations incorporelles')
  })

  it('laisse à la balance reprise un compte que l’application n’écrit pas', () => {
    expect(libelleCompteTenu('2818300')).toBeNull()
    expect(libelleCompteTenu('28183')).toBeNull()
    expect(libelleCompteTenu('28183110')).toBeNull()
  })
})
