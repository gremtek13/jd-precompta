import { describe, expect, it } from 'vitest'
import type { EntreesDuBilan } from './bilan'
import type { ModeleComptable } from './engagement'
import { confronterLOuverture, type ConfrontationDeLOuverture } from './ouvertureConfrontee'
import type { ANouveau, EcritureBrouillon, Piece, SoldeReporte } from './types'
import { A_NOUVEAU_NON_VALIDE, NON_VALIDEE } from '../test/ecritures'

// LA CONFRONTATION SE JUGE SUR DES CLÔTURES CALCULÉES À LA MAIN : chaque cas pose les écritures de N−1, fait le calcul
// de sa clôture en commentaire, compte par compte, puis pose des soldes reportés — justes, ou faux d'une façon
// choisie — et attend les écarts écrits en toutes lettres, en centimes.

const SOCIETE: ModeleComptable = { mode: 'engagement', compteNotesDeFrais: '455000' }
const EXPLOITANT_BNC: ModeleComptable = { mode: 'tresorerie', compteNotesDeFrais: '455000' }

let numero = 0
type Ligne = [compte: string, sens: 'D' | 'C', euros: number]

function ecrire(date: string, lignes: Ligne[], piece_id: string | null = null): EcritureBrouillon[] {
  return lignes.map(([compte, sens, montant]) => {
    numero += 1
    return {
      id: `e${String(numero).padStart(5, '0')}`, dossier_id: 'd1', piece_id, ligne_bancaire_id: null, date, compte,
      libelle: 'Écriture d’essai', montant, sens: sens === 'D' ? 'debit' : 'credit', statut: 'proposee',
      created_at: `${date}T10:00:00Z`, immobilisation_id: null, vehicule_id: null, declaration_tva_id: null, cotisation_id: null,
      ...NON_VALIDEE,
    } satisfies EcritureBrouillon
  })
}

function reprise(date: string, lignes: Ligne[]): ANouveau[] {
  return lignes.map(([compte, sens, montant]) => {
    numero += 1
    return {
      id: `a${numero}`, dossier_id: 'd1', date, compte, compte_origine: compte, libelle: `Compte ${compte}`,
      sens: sens === 'D' ? 'debit' : 'credit', montant, source_nom: 'balance-fictive.csv', source_empreinte: 'empreinte-fictive',
      created_at: '2026-02-01T10:00:00Z', ...A_NOUVEAU_NON_VALIDE,
    } satisfies ANouveau
  })
}

function reportes(date: string, lignes: Ligne[]): SoldeReporte[] {
  return lignes.map(([compte, sens, montant]) => {
    numero += 1
    return {
      id: `s${numero}`, dossier_id: 'd1', date, compte, libelle: `Compte ${compte}`, sens: sens === 'D' ? 'debit' : 'credit',
      montant, source_nom: 'Exercice 2025 validé', source_empreinte: 'empreinte-2025', created_at: '2026-02-01T10:00:00Z',
      compte_lib: null, ecriture_lib: null,
    } satisfies SoldeReporte
  })
}

function entrees(o: Partial<EntreesDuBilan>): EntreesDuBilan {
  return {
    exercice: 2026, ecritures: [], categories: [], reprise: [], reportes: [], anneesValidees: [], pieces: [],
    modele: SOCIETE, aujourdHui: '2027-03-15', ...o,
  }
}

type Ecarts = Extract<ConfrontationDeLOuverture, { etat: 'ecarts' }>
function ecarts(c: ConfrontationDeLOuverture): Ecarts {
  if (c.etat !== 'ecarts') throw new Error(`attendu des écarts, reçu ${c.etat}`)
  return c
}

// UN EXPLOITANT EN TRÉSORERIE, premier exercice 2025 :
//   512 : 10 000 (apport) + 3 000 (recette) − 1 000 (achat) − 2 000 (prélèvement) = 10 000 D ;
//   108 : 10 000 C − 2 000 D = 8 000 C ; résultat : 3 000 − 1 000 = 2 000 (bénéfice).
// Le report réunit le 108 et le résultat au 101000 : 8 000 + 2 000 = 10 000 C.
const EXERCICE_2025_EXPLOITANT = [
  ...ecrire('2025-01-02', [['512000', 'D', 10_000], ['108000', 'C', 10_000]]),
  ...ecrire('2025-03-10', [['512000', 'D', 3_000], ['706000', 'C', 3_000]]),
  ...ecrire('2025-04-10', [['606000', 'D', 1_000], ['512000', 'C', 1_000]]),
  ...ecrire('2025-07-01', [['108000', 'D', 2_000], ['512000', 'C', 2_000]]),
]
// Des écritures de N, qui ne sont pas son ouverture : la confrontation ne les lit pas.
const EXERCICE_2026 = ecrire('2026-02-01', [['606000', 'D', 400], ['512000', 'C', 400]])

const exploitant = (reportesDe2026: SoldeReporte[]) => entrees({
  modele: EXPLOITANT_BNC, ecritures: [...EXERCICE_2025_EXPLOITANT, ...EXERCICE_2026], anneesValidees: [2025],
  reportes: reportesDe2026,
})

describe('confronterLOuverture — rien à confronter, et pourquoi', () => {
  it('sur une lecture partielle, rien ne se juge, même là où tout concorde', () => {
    const d = exploitant(reportes('2026-01-01', [['512000', 'D', 10_000], ['101000', 'C', 10_000]]))
    expect(confronterLOuverture(d, 'complete').etat).toBe('concordante')
    const c = confronterLOuverture(d, 'partielle')
    expect(c.etat).toBe('illisible')
  })

  it('le premier exercice du dossier : rien ne le précède', () => {
    const c = confronterLOuverture(entrees({ ecritures: EXERCICE_2026 }), 'complete')
    expect(c).toMatchObject({ etat: 'sans-objet', code: 'premier-exercice', exercice: 2026 })
  })

  it('l’ouverture de N attend la validation de N−1', () => {
    const c = confronterLOuverture(entrees({ modele: EXPLOITANT_BNC, ecritures: [...EXERCICE_2025_EXPLOITANT, ...EXERCICE_2026] }), 'complete')
    expect(c).toMatchObject({ etat: 'sans-objet', code: 'ouverture-en-attente' })
    if (c.etat === 'sans-objet') expect(c.texte).toContain('validation de l’exercice 2025')
  })

  it('N s’ouvre par une balance reprise : N−1 précède la reprise', () => {
    const c = confronterLOuverture(entrees({
      exercice: 2026, reprise: reprise('2026-01-01', [['512000', 'D', 500], ['101000', 'C', 500]]), ecritures: EXERCICE_2026,
    }), 'complete')
    expect(c).toMatchObject({ etat: 'sans-objet', code: 'avant-la-reprise' })
    if (c.etat === 'sans-objet') expect(c.texte).toContain('logiciel précédent')
  })

  it('N précède lui-même la reprise du dossier', () => {
    const c = confronterLOuverture(entrees({
      exercice: 2025, reprise: reprise('2026-01-01', [['512000', 'D', 500], ['101000', 'C', 500]]),
    }), 'complete')
    expect(c).toMatchObject({ etat: 'sans-objet', code: 'avant-la-reprise' })
    if (c.etat === 'sans-objet') expect(c.texte).toContain('précède la reprise')
  })

  it('N−1 ne s’établit pas : son ouverture attend la validation de N−2', () => {
    const c = confronterLOuverture(entrees({
      modele: EXPLOITANT_BNC, anneesValidees: [2025],
      ecritures: [...ecrire('2024-05-01', [['512000', 'D', 100], ['108000', 'C', 100]]), ...EXERCICE_2025_EXPLOITANT],
      reportes: reportes('2026-01-01', [['512000', 'D', 10_000], ['101000', 'C', 10_000]]),
    }), 'complete')
    expect(c).toMatchObject({ etat: 'sans-objet', code: 'precedent-non-etabli' })
    if (c.etat === 'sans-objet') expect(c.texte).toContain('Le bilan de l’exercice 2025 ne s’établit pas')
  })
})

describe('confronterLOuverture — une entreprise individuelle : le report de l’exploitant et du résultat', () => {
  it('concordante : le 108 et le résultat de N−1 réunis au 101000', () => {
    const c = confronterLOuverture(exploitant(reportes('2026-01-01', [['512000', 'D', 10_000], ['101000', 'C', 10_000]])), 'complete')
    expect(c).toMatchObject({ etat: 'concordante', exercice: 2026, precedent: 2025, comptes: 2 })
    if (c.etat === 'concordante') {
      expect(c.regle).toContain('101000')
      expect(c.regle).toContain('1211-10')
      expect(c.texte).toContain('L123-19')
    }
  })

  it('un écart d’un centime se dit, compte par compte et rubrique par rubrique', () => {
    const c = ecarts(confronterLOuverture(exploitant(reportes('2026-01-01', [['512000', 'D', 10_000.01], ['101000', 'C', 10_000.01]])), 'complete'))
    expect(c.comptes).toEqual([
      {
        compte: '101000', libelle: 'Compte 101000', ouverture: -1_000_001, cloture: -1_000_000, difference: -1,
        cause: 'montants-differents', report: { comptes: ['108000'], resultat: 200_000 },
      },
      {
        compte: '512000', libelle: 'Compte 512000', ouverture: 1_000_001, cloture: 1_000_000, difference: 1,
        cause: 'montants-differents', report: null,
      },
    ])
    // Le capital de la clôture : le 108 (8 000 C) et le résultat (2 000) qui le rejoint.
    expect(c.rubriques).toEqual([
      { cote: 'actif', id: 'disponibilites', libelle: expect.any(String), ouverture: 1_000_001, cloture: 1_000_000, difference: 1, comptes: ['512000'] },
      { cote: 'passif', id: 'capital', libelle: expect.any(String), ouverture: 1_000_001, cloture: 1_000_000, difference: 1, comptes: ['101000'] },
    ])
    expect(c.texte).toContain('2 comptes et 2 rubriques du bilan en écart')
  })

  it('le 101000 déjà ouvert à la clôture : le report y réunit les AUTRES comptes, pas lui-même', () => {
    // 2025 porte aussi un capital de 500 au 101000 : la clôture du 101000 vaut 500 + 8 000 + 2 000 = 10 500 C.
    const d = exploitant(reportes('2026-01-01', [['512000', 'D', 10_500], ['101000', 'C', 10_499]]))
    const c = ecarts(confronterLOuverture({
      ...d, ecritures: [...d.ecritures, ...ecrire('2025-01-03', [['512000', 'D', 500], ['101000', 'C', 500]])],
    }, 'complete'))
    expect(c.comptes.map((e) => [e.compte, e.ouverture, e.cloture, e.report])).toEqual([
      ['101000', -1_049_900, -1_050_000, { comptes: ['108000'], resultat: 200_000 }],
    ])
    // L'ouverture ne s'équilibre pas (un euro manque au crédit) : le capital s'écarte, la banque concorde.
    expect(c.rubriques.map((r) => [r.id, r.difference, r.comptes])).toEqual([['capital', -100, ['101000']]])
  })

  it('le 108 reporté tel quel : deux comptes en écart, le capital concorde', () => {
    // Le report aurait dû verser le 108 au 101000 : 101000 ne porte que 2 000, le 108 n'existe qu'à l'ouverture. La
    // rubrique « capital » réunit les deux pour une entreprise individuelle, et se tait.
    const c = ecarts(confronterLOuverture(exploitant(reportes('2026-01-01', [
      ['512000', 'D', 10_000], ['108000', 'C', 8_000], ['101000', 'C', 2_000],
    ])), 'complete'))
    expect(c.comptes.map((e) => [e.compte, e.ouverture, e.cloture, e.cause])).toEqual([
      ['101000', -200_000, -1_000_000, 'montants-differents'],
      ['108000', -800_000, 0, 'absent-de-la-cloture'],
    ])
    expect(c.rubriques).toEqual([])
    expect(c.texte).toContain('2 comptes en écart')
  })
})

// UNE SOCIÉTÉ EN ENGAGEMENT, premier exercice 2025 :
//   512 : 10 000 + 700 − 500 = 10 200 D ; 411 : 1 200 − 700 = 500 D ; 445710 : 200 C ; 101000 : 10 000 C ;
//   résultat : 1 000 − 500 = 500 (bénéfice), reporté au 120000.
const EXERCICE_2025_SOCIETE = [
  ...ecrire('2025-01-02', [['512000', 'D', 10_000], ['101000', 'C', 10_000]]),
  ...ecrire('2025-02-10', [['411000', 'D', 1_200], ['706000', 'C', 1_000], ['445710', 'C', 200]], 'p1'),
  ...ecrire('2025-03-15', [['512000', 'D', 700], ['411000', 'C', 700]], 'p1'),
  ...ecrire('2025-03-20', [['606000', 'D', 500], ['512000', 'C', 500]]),
]
const REPORT_SOCIETE: Ligne[] = [
  ['101000', 'C', 10_000], ['120000', 'C', 500], ['411000', 'D', 500], ['445710', 'C', 200], ['512000', 'D', 10_200],
]
const societe = (lignes: Ligne[]) => entrees({
  modele: SOCIETE, ecritures: [...EXERCICE_2025_SOCIETE, ...EXERCICE_2026], anneesValidees: [2025],
  pieces: [{ id: 'p1', tiers: 'Client Fictif' }], reportes: reportes('2026-01-01', lignes),
})

describe('confronterLOuverture — une société : le résultat avant répartition', () => {
  it('concordante : le bénéfice de N−1 au 120000', () => {
    const c = confronterLOuverture(societe(REPORT_SOCIETE), 'complete')
    expect(c).toMatchObject({ etat: 'concordante', comptes: 5 })
    if (c.etat === 'concordante') expect(c.regle).toContain('120000')
  })

  it('un compte présent d’un seul côté, de chaque côté', () => {
    // La TVA collectée manque à l'ouverture ; un compte courant n'y est que d'elle.
    const lignes = REPORT_SOCIETE.filter(([compte]) => compte !== '445710').concat([['455000', 'C', 50]])
    const c = ecarts(confronterLOuverture(societe(lignes), 'complete'))
    expect(c.comptes.map((e) => [e.compte, e.ouverture, e.cloture, e.difference, e.cause, e.report])).toEqual([
      ['445710', 0, -20_000, 20_000, 'absent-de-l-ouverture', null],
      ['455000', -5_000, 0, -5_000, 'absent-de-la-cloture', null],
    ])
    expect(c.rubriques.map((r) => [r.id, r.ouverture, r.cloture, r.difference, r.comptes])).toEqual([
      ['dettes-fiscales-sociales', 0, 20_000, -20_000, ['445710']],
      ['comptes-courants', 5_000, 0, 5_000, ['455000']],
    ])
  })

  it('le bénéfice reporté au 129000 : la rubrique se tait, les deux comptes parlent', () => {
    const lignes = REPORT_SOCIETE.map(([compte, sens, montant]): Ligne => [compte === '120000' ? '129000' : compte, sens, montant])
    const c = ecarts(confronterLOuverture(societe(lignes), 'complete'))
    expect(c.comptes.map((e) => [e.compte, e.ouverture, e.cloture, e.cause, e.report])).toEqual([
      ['120000', 0, -50_000, 'absent-de-l-ouverture', { comptes: [], resultat: 50_000 }],
      ['129000', -50_000, 0, 'absent-de-la-cloture', null],
    ])
    expect(c.rubriques).toEqual([])
  })

  it('une perte de N−1 au 129000, rangée dans les résultats en attente', () => {
    // 512 : 1 000 − 300 = 700 D ; 101000 : 1 000 C ; perte de 300 au 129000 (débit).
    const d = entrees({
      modele: SOCIETE, anneesValidees: [2025],
      ecritures: [
        ...ecrire('2025-01-02', [['512000', 'D', 1_000], ['101000', 'C', 1_000]]),
        ...ecrire('2025-05-02', [['606000', 'D', 300], ['512000', 'C', 300]]),
      ],
      reportes: reportes('2026-01-01', [['101000', 'C', 1_000], ['129000', 'D', 300], ['512000', 'D', 701]]),
    })
    const c = ecarts(confronterLOuverture(d, 'complete'))
    expect(c.comptes.map((e) => [e.compte, e.difference])).toEqual([['512000', 100]])
    expect(c.rubriques.map((r) => [r.id, r.difference])).toEqual([['disponibilites', 100]])
    // Juste, la même ouverture concorde : la perte quitte « résultat » pour « résultats en attente d'affectation ».
    const juste = confronterLOuverture({ ...d, reportes: reportes('2026-01-01', [['101000', 'C', 1_000], ['129000', 'D', 300], ['512000', 'D', 700]]) }, 'complete')
    expect(juste.etat).toBe('concordante')
  })

  it('un fournisseur partagé entre l’actif et le passif ne fait pas d’écart de rubrique', () => {
    // 401 : Alpha payé 150 pour 100 (50 D, une créance), Beta 300 non payé (300 C) : 250 C au total.
    // 512 : 1 000 − 150 = 850 D ; perte : 100 + 300 = 400, au 129000.
    const d = entrees({
      modele: SOCIETE, anneesValidees: [2025],
      pieces: [{ id: 'pa', tiers: 'Alpha Essai' }, { id: 'pb', tiers: 'Beta Essai' }] satisfies Pick<Piece, 'id' | 'tiers'>[],
      ecritures: [
        ...ecrire('2025-01-02', [['512000', 'D', 1_000], ['101000', 'C', 1_000]]),
        ...ecrire('2025-02-01', [['606000', 'D', 100], ['401000', 'C', 100]], 'pa'),
        ...ecrire('2025-02-15', [['401000', 'D', 150], ['512000', 'C', 150]], 'pa'),
        ...ecrire('2025-03-01', [['606000', 'D', 300], ['401000', 'C', 300]], 'pb'),
      ],
      reportes: reportes('2026-01-01', [['101000', 'C', 1_000], ['129000', 'D', 400], ['401000', 'C', 250], ['512000', 'D', 850]]),
    })
    expect(confronterLOuverture(d, 'complete')).toMatchObject({ etat: 'concordante', comptes: 4 })
  })

  it('N−1 ouvert par une balance reprise : sa clôture part de la reprise', () => {
    const d = entrees({
      modele: SOCIETE, anneesValidees: [2025],
      reprise: reprise('2025-01-01', [['512000', 'D', 2_000], ['101000', 'C', 2_000]]),
      ecritures: ecrire('2025-06-01', [['606000', 'D', 500], ['512000', 'C', 500]]),
      reportes: reportes('2026-01-01', [['101000', 'C', 2_000], ['129000', 'D', 500], ['512000', 'D', 1_500]]),
    })
    expect(confronterLOuverture(d, 'complete')).toMatchObject({ etat: 'concordante', comptes: 3 })
  })
})
