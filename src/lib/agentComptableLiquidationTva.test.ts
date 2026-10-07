import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { periodesDeLAnnee } from './declarationTva'
import {
  ecritureDeLaLiquidation, ecritureDuPaiementTva, liquidationsDesynchronisees, paiementsTvaDesynchronises, periodesEnRetard,
} from './liquidationTva'
import type { DeclarationTva, EcritureBrouillon, LigneBancaire, PeriodiciteTva } from './types'
import { NON_VALIDEE } from '../test/ecritures'

// L'ASSISTANT RECOPIE CE QUE LA CHECKLIST DIT DE LA TVA LIQUIDÉE ET PAYÉE (06/10/2026, ligne 26.8).
//
// Une déclaration de TVA enregistrée s'écrit au dernier jour de sa période — sa LIQUIDATION, au journal des opérations
// diverses —, et son prélèvement ou le remboursement d'un crédit s'écrit face à la banque. La Checklist compte la
// liquidation qui ne suit plus sa déclaration, le paiement dont l'écriture ne suit plus son mouvement, et les périodes
// dont la déclaration n'est pas enregistrée une fois son échéance passée. `agent-comptable` est auto-portée : elle
// recopie ces fonctions entre les bornes `── DÉBUT/FIN LIQUIDATION TVA`, et ce test les compare à `src/lib` sur une
// batterie commune — la forme des gardes des autres blocs : extraire, transpiler, exécuter, comparer à une référence
// EXTÉRIEURE à la copie, et planter des dérives dans la vraie source pour prouver qu'il sait encore échouer.
//
// CE QU'UNE DÉRIVE COÛTERAIT : l'assistant prendrait la liquidation — des écritures sans pièce ni mouvement sur six
// comptes de TVA — pour une anomalie, ou répondrait « rien à signaler » sur un dossier dont une période n'est pas
// déclarée et dont la TVA reste aux comptes 4457 et 4456, en français, à un comptable qui n'ira pas vérifier.

function sourceDeployee(): string {
  return readFileSync(new URL('../../supabase/functions/agent-comptable/index.ts', import.meta.url), 'utf8')
}

type Ecriture = { compte: string; sens: string; montant: number }
type Periode = { debut: string; fin: string; libelle: string }
type Liquidable = Pick<DeclarationTva, 'periode_debut' | 'periode_fin' | 'cases' | 'tva_collectee' | 'tva_deductible' | 'tva_deductible_immobilisations'>
interface Copie {
  ecritureDeLaLiquidation: (d: Liquidable) => Ecriture[]
  ecritureDuPaiementTva: (l: { montant: number }) => Ecriture[]
  liquidationsDesynchronisees: (e: EcritureBrouillon[], d: DeclarationTva[], frontiere: string | null) => { id: string }[]
  paiementsTvaDesynchronises: (e: EcritureBrouillon[], l: LigneBancaire[], frontiere: string | null) => { id: string }[]
  periodesDeLAnnee: (annee: number, periodicite: PeriodiciteTva) => Periode[]
  periodesEnRetard: (
    d: Pick<DeclarationTva, 'periode_debut' | 'periode_fin'>[], periodicite: PeriodiciteTva, anneesActives: number[],
    premierJourDuMois: string, ouverture: string | null, frontiere: string | null,
  ) => Periode[]
}

// Le bloc LIQUIDATION TVA lit `ecrituresSansPieceParMouvement` et `ecritureConforme` du bloc AFFECTATION, `estFigee`
// du bloc VALIDATION, et les comptes déclarés plus haut dans la fonction : tous repris de la MÊME source, pour qu'une
// dérive de l'un d'eux morde ici aussi.
function extraire(source: string): Copie {
  const bornes = (nom: string) => {
    const debut = source.indexOf(`// ── DÉBUT ${nom}`)
    const fin = source.indexOf(`// ── FIN ${nom}`)
    expect(debut, `bornes du bloc ${nom} introuvables — garde-fou à remettre à jour`).toBeGreaterThan(-1)
    expect(fin).toBeGreaterThan(debut)
    return source.slice(debut, fin)
  }
  const compte = (nom: string) => {
    const trouve = new RegExp(`const ${nom} = "(\\d+)"`).exec(source)
    expect(trouve, `\`${nom}\` introuvable dans la source`).not.toBeNull()
    return `const ${nom} = "${trouve![1]}"\n`
  }
  const bloc = compte('COMPTE_BANQUE') + compte('COMPTE_EXPLOITANT') + compte('COMPTE_TVA_COLLECTEE')
    + compte('COMPTE_TVA_DEDUCTIBLE') + compte('COMPTE_TVA_IMMOBILISATIONS')
    + `${bornes('VALIDATION')}\n${bornes('AFFECTATION')}\n${bornes('LIQUIDATION TVA')}`
  const js = ts.transpileModule(bloc, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return new Function(`${js}\nreturn { ecritureDeLaLiquidation, ecritureDuPaiementTva, liquidationsDesynchronisees, paiementsTvaDesynchronises, periodesDeLAnnee, periodesEnRetard }`)() as Copie
}

const deployee = extraire(sourceDeployee())

const FRONTIERES = [null, '2026-03-30', '2026-03-31', '2026-06-30', '2026-12-31'] as const

const declaration = (o: Partial<DeclarationTva>): DeclarationTva => ({
  id: 'q1', dossier_id: 'd', periode_debut: '2026-01-01', periode_fin: '2026-03-31', tva_declaree: 79, credit_anterieur: 0,
  remboursement_demande: 0, date_declaration: '2026-04-15', notes: null, created_at: '2026-04-15T10:00:00Z',
  cases: null, tva_collectee: null, tva_deductible: null, tva_deductible_immobilisations: null, ...o,
})

const ligne = (o: Partial<LigneBancaire>): LigneBancaire => ({
  id: 'l', dossier_id: 'd', date: '2026-04-20', libelle: 'PRLV DGFIP TVA', montant: -79, statut: 'rapprochee',
  piece_id: null, cotisation_id: null, categorie_id: null, taux_tva: null, prelevement_personnel: false,
  emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false, reglement_groupe: false,
  compte_bilan: null, declaration_tva_id: 'q1', id_externe: null, source_fichier: null, libelle_brut: null, created_at: '2026-04-21T09:00:00Z', ...o,
})

const ecriture = (o: Partial<EcritureBrouillon>): EcritureBrouillon => ({
  id: 'e', dossier_id: 'd', piece_id: null, ligne_bancaire_id: null, date: '2026-03-31', compte: '445710',
  libelle: 'CA3', sens: 'debit', montant: 0, statut: 'proposee', immobilisation_id: null, vehicule_id: null, declaration_tva_id: null,
  ...NON_VALIDEE, created_at: '2026-04-15T10:00:00Z', ...o,
})

// Les déclarations de l'essai de production (supabase/essais/liquidationTva.sql) et leurs voisines : une période à
// payer avec un arrondi au 758000, une période en crédit en partie remboursée, une période qui reçoit un crédit, un
// arrondi qui fait payer plus que les comptes (658000), une TVA collectée négative avec de la TVA sur immobilisations,
// une période néant, et une déclaration saisie à la main.
const Q1 = declaration({
  id: 'q1', tva_collectee: 100.40, tva_deductible: 20.60, tva_deductible_immobilisations: 0,
  cases: { l16: 100, l19: 0, l20: 21, l21: 0, l22: 0, l23: 21, l25: 0, l26: 0, l27: 0, l28: 79, l32: 79 },
})
const Q2 = declaration({
  id: 'q2', periode_debut: '2026-04-01', periode_fin: '2026-06-30', tva_collectee: 50.20, tva_deductible: 399.70,
  tva_deductible_immobilisations: 0, remboursement_demande: 300,
  cases: { l16: 50, l19: 0, l20: 400, l21: 0, l22: 0, l23: 400, l25: 350, l26: 300, l27: 50, l28: 0, l32: 0 },
})
const Q3 = declaration({
  id: 'q3', periode_debut: '2026-07-01', periode_fin: '2026-09-30', tva_collectee: 100.40, tva_deductible: 20.60,
  tva_deductible_immobilisations: 0,
  cases: { l16: 100, l19: 0, l20: 21, l21: 0, l22: 50, l23: 71, l25: 0, l26: 0, l27: 0, l28: 29, l32: 29 },
})
const CHARGE = declaration({ id: 'charge', tva_collectee: 99.20, tva_deductible: 20.60, tva_deductible_immobilisations: 0, cases: Q1.cases })
const IMMO = declaration({
  id: 'immo', periode_debut: '2026-01-01', periode_fin: '2026-01-31', tva_collectee: -20, tva_deductible: 0, tva_deductible_immobilisations: 40.10,
  cases: { l16: 0, l19: 40, l20: 0, l21: 20, l22: 0, l23: 60, l25: 60, l26: 0, l27: 60, l28: 0, l32: 0 },
})
const NEANT = declaration({
  id: 'neant', periode_debut: '2026-10-01', periode_fin: '2026-12-31', tva_collectee: 0, tva_deductible: 0, tva_deductible_immobilisations: 0,
  cases: { l16: 0, l19: 0, l20: 0, l21: 0, l22: 0, l23: 0, l25: 0, l26: 0, l27: 0, l28: 0, l32: 0 },
})
const A_LA_MAIN = declaration({ id: 'main', periode_debut: '2025-10-01', periode_fin: '2025-12-31' })

const sansLibelle = (e: readonly Ecriture[]) => e.map(({ compte, sens, montant }) => ({ compte, sens, montant }))
const ids = (a: { id: string }[]) => a.map((l) => l.id)

// L'écriture juste d'une liquidation ou d'un paiement, telle que src/lib la compose.
const liquidation = (d: DeclarationTva, date = d.periode_fin, id = d.id): EcritureBrouillon[] =>
  ecritureDeLaLiquidation(d).map((e, i) => ecriture({ id: `${id}-${i}`, declaration_tva_id: id, date, compte: e.compte, sens: e.sens, montant: e.montant }))
const paiement = (l: LigneBancaire, date = l.date): EcritureBrouillon[] =>
  ecritureDuPaiementTva(l).map((e, i) => ecriture({ id: `${l.id}-${i}`, ligne_bancaire_id: l.id, date, compte: e.compte, sens: e.sens, montant: e.montant }))

// Des liquidations — juste, absente, d'un autre montant, à une autre date, avec une ligne de trop, posée sur une
// déclaration saisie à la main — et ce qui n'en est pas : la période néant, qui n'a rien à écrire, et les écritures
// d'un paiement, qui ne désignent pas la déclaration.
const D_JUSTE = Q1
const D_ABSENTE = { ...Q2, id: 'absente' }
const D_MONTANT = { ...Q3, id: 'montant' }
const D_DATE = { ...CHARGE, id: 'date' }
const D_TROP = { ...IMMO, id: 'trop' }
const D_MAIN_AVEC = { ...A_LA_MAIN, id: 'main-avec' }
const D_MAIN_SANS = { ...A_LA_MAIN, id: 'main-sans' }
const D_APRES = { ...Q3, id: 'apres' }
const DECLARATIONS: DeclarationTva[] = [D_JUSTE, D_ABSENTE, D_MONTANT, D_DATE, D_TROP, D_MAIN_AVEC, D_MAIN_SANS, NEANT, D_APRES]
const ECRITURES_LIQUIDATIONS: EcritureBrouillon[] = [
  ...liquidation(D_JUSTE),
  ...liquidation(D_MONTANT).map((e, i) => (i === 0 ? { ...e, montant: e.montant + 1 } : e)),
  ...liquidation(D_DATE, '2026-03-30'),
  ...liquidation(D_TROP),
  ecriture({ id: 'trop-x', declaration_tva_id: 'trop', date: D_TROP.periode_fin, compte: '658000', sens: 'debit', montant: 0.01 }),
  // Une liquidation sur une déclaration saisie à la main : elle n'en a pas, celle-ci est de trop.
  ...liquidation(Q1, A_LA_MAIN.periode_fin, 'main-avec'),
  // Les écritures d'un PAIEMENT ne désignent pas la déclaration : elles ne comptent pas pour sa liquidation.
  ecriture({ id: 'pay', ligne_bancaire_id: 'l-x', date: '2026-07-20', compte: '445510', sens: 'debit', montant: 29 }),
]

// Des paiements et des remboursements — justes, absents, d'un autre montant, d'un autre sens, sur un autre compte, à une
// autre date — et ce qui n'en est pas : un mouvement qui ne paie aucune déclaration, un mouvement qui n'est plus
// rapproché, et les écritures d'une PIÈCE qui désignent le même mouvement.
const L_JUSTE = ligne({ id: 'juste' })
const L_REMBOURSEMENT = ligne({ id: 'remboursement', montant: 300, date: '2026-08-10', declaration_tva_id: 'q2' })
const L_ABSENTE = ligne({ id: 'absente' })
const L_MONTANT = ligne({ id: 'montant' })
const L_SENS = ligne({ id: 'sens', montant: 79 })
const L_COMPTE = ligne({ id: 'compte' })
const L_DATE = ligne({ id: 'date' })
const L_SANS = ligne({ id: 'sans-declaration', declaration_tva_id: null })
const L_NON = ligne({ id: 'non-rapproche', statut: 'non_rapprochee' })
const L_PIECE = ligne({ id: 'piece' })
const L_APRES = ligne({ id: 'apres', date: '2026-07-20', montant: -29, declaration_tva_id: 'q3' })
const LIGNES: LigneBancaire[] = [L_JUSTE, L_REMBOURSEMENT, L_ABSENTE, L_MONTANT, L_SENS, L_COMPTE, L_DATE, L_SANS, L_NON, L_PIECE, L_APRES]
const ECRITURES_PAIEMENTS: EcritureBrouillon[] = [
  ...paiement(L_JUSTE),
  ...paiement(L_REMBOURSEMENT),
  ...paiement(L_MONTANT).map((e) => ({ ...e, montant: 80 })),
  // Écrite comme un prélèvement alors que le mouvement est un encaissement.
  ...paiement(ligne({ id: 'sens', montant: -79 })),
  ...paiement(L_COMPTE).map((e) => (e.compte === '445510' ? { ...e, compte: '445670' } : e)),
  ...paiement(L_DATE, '2026-04-21'),
  // Ni le mouvement sans déclaration ni celui qui n'est plus rapproché n'ont d'écriture : une copie qui les jugerait les
  // réclamerait.
  ecriture({ id: 'p1', piece_id: 'p1', ligne_bancaire_id: 'piece', date: L_PIECE.date, compte: '606100', sens: 'debit', montant: 79 }),
  ecriture({ id: 'p2', piece_id: 'p1', ligne_bancaire_id: 'piece', date: L_PIECE.date, compte: '512000', sens: 'credit', montant: 79 }),
]

// Des déclarations pour les périodes en retard : aucune, un trimestre déclaré, deux trimestres, un mois seul d'un
// trimestre — qui n'en couvre pas le reste —, une année entière en mensuel, et une déclaration de l'année précédente.
const JEUX_DECLARATIONS: Pick<DeclarationTva, 'periode_debut' | 'periode_fin'>[][] = [
  [],
  [{ periode_debut: '2026-01-01', periode_fin: '2026-03-31' }],
  [{ periode_debut: '2026-01-01', periode_fin: '2026-03-31' }, { periode_debut: '2026-04-01', periode_fin: '2026-06-30' }],
  [{ periode_debut: '2026-04-01', periode_fin: '2026-04-30' }],
  Array.from({ length: 12 }, (_, i) => ({
    periode_debut: `2025-${String(i + 1).padStart(2, '0')}-01`,
    periode_fin: periodesDeLAnnee(2025, 'mensuelle')[i].fin,
  })),
  [{ periode_debut: '2025-10-01', periode_fin: '2025-12-31' }],
]
const ANNEES_ACTIVES: number[][] = [[], [2026], [2026, 2025, 2026], [2027], [2024, 2025]]
const PREMIERS_JOURS = ['2026-01-01', '2026-05-01', '2026-07-01', '2026-08-01', '2027-02-01'] as const
const OUVERTURES = [null, '2026-01-01', '2026-07-01'] as const
const FRONTIERES_PERIODES = [null, '2025-12-31', '2026-06-30'] as const
const PERIODICITES: PeriodiciteTva[] = ['trimestrielle', 'mensuelle']

describe('agent-comptable / bloc LIQUIDATION TVA (copie déployée)', () => {
  it('n’est pas la fonction de src/lib elle-même', () => {
    expect(deployee.liquidationsDesynchronisees).not.toBe(liquidationsDesynchronisees)
    expect(deployee.periodesEnRetard).not.toBe(periodesEnRetard)
  })

  it('compose la même liquidation, ligne à ligne', () => {
    for (const d of [Q1, Q2, Q3, CHARGE, IMMO, NEANT, A_LA_MAIN]) {
      expect(deployee.ecritureDeLaLiquidation(d), d.id).toEqual(sansLibelle(ecritureDeLaLiquidation(d)))
    }
    // La batterie exerce bien chaque compte : la TVA collectée des deux côtés, les deux déductibles, le crédit reporté
    // des deux côtés, la TVA à payer, le remboursement demandé, et l'arrondi au 658000 comme au 758000.
    const comptes = new Set([Q1, Q2, Q3, CHARGE, IMMO].flatMap((d) => ecritureDeLaLiquidation(d).map((e) => `${e.compte}:${e.sens}`)))
    expect([...comptes].sort()).toEqual([
      '445510:credit', '445620:credit', '445660:credit', '445670:credit', '445670:debit', '445710:credit', '445710:debit',
      '445830:debit', '658000:debit', '758000:credit',
    ])
    // Rien pour une période néant ni pour une déclaration saisie à la main.
    expect(ecritureDeLaLiquidation(NEANT)).toEqual([])
    expect(ecritureDeLaLiquidation(A_LA_MAIN)).toEqual([])
  })

  it('compose le même paiement et le même remboursement', () => {
    for (const montant of [-79, 300, -0.07, -1234.56, 0.3]) {
      expect(deployee.ecritureDuPaiementTva({ montant }), String(montant)).toEqual(sansLibelle(ecritureDuPaiementTva(ligne({ montant }))))
    }
    expect(sansLibelle(ecritureDuPaiementTva(ligne({ montant: -79 })))).toEqual([
      { compte: '512000', sens: 'credit', montant: 79 }, { compte: '445510', sens: 'debit', montant: 79 },
    ])
    expect(sansLibelle(ecritureDuPaiementTva(ligne({ montant: 300 })))).toEqual([
      { compte: '512000', sens: 'debit', montant: 300 }, { compte: '445830', sens: 'credit', montant: 300 },
    ])
  })

  it('rend les mêmes liquidations à réécrire, sous chaque frontière', () => {
    for (const f of FRONTIERES) {
      expect(ids(deployee.liquidationsDesynchronisees(ECRITURES_LIQUIDATIONS, DECLARATIONS, f)), `frontière ${f}`)
        .toEqual(ids(liquidationsDesynchronisees(ECRITURES_LIQUIDATIONS, DECLARATIONS, f)))
    }
    // La batterie exerce bien ce qui décide : la liquidation absente, un autre montant, une autre date, une ligne de
    // trop, une liquidation posée sur une déclaration saisie à la main — et ce qui n'est pas à réécrire. Et la
    // frontière : le dernier jour de la période la fige, la veille non.
    expect(ids(liquidationsDesynchronisees(ECRITURES_LIQUIDATIONS, DECLARATIONS, null)))
      .toEqual(['absente', 'montant', 'date', 'trop', 'main-avec', 'apres'])
    expect(ids(liquidationsDesynchronisees(ECRITURES_LIQUIDATIONS, DECLARATIONS, '2026-03-30'))).toEqual(['absente', 'montant', 'date', 'apres'])
    expect(ids(liquidationsDesynchronisees(ECRITURES_LIQUIDATIONS, DECLARATIONS, '2026-03-31'))).toEqual(['absente', 'montant', 'apres'])
  })

  it('rend les mêmes paiements à réécrire, sous chaque frontière', () => {
    for (const f of FRONTIERES) {
      expect(ids(deployee.paiementsTvaDesynchronises(ECRITURES_PAIEMENTS, LIGNES, f)), `frontière ${f}`)
        .toEqual(ids(paiementsTvaDesynchronises(ECRITURES_PAIEMENTS, LIGNES, f)))
    }
    expect(ids(paiementsTvaDesynchronises(ECRITURES_PAIEMENTS, LIGNES, null)))
      .toEqual(['absente', 'montant', 'sens', 'compte', 'date', 'piece', 'apres'])
    expect(ids(paiementsTvaDesynchronises(ECRITURES_PAIEMENTS, LIGNES, '2026-06-30'))).toEqual(['apres'])
  })

  it('découpe l’année en les mêmes périodes, avec le même nom', () => {
    for (const annee of [2024, 2025, 2026, 2027]) {
      for (const periodicite of PERIODICITES) {
        expect(deployee.periodesDeLAnnee(annee, periodicite), `${annee} / ${periodicite}`).toEqual(periodesDeLAnnee(annee, periodicite))
      }
    }
    // Le 29 février d'une année bissextile, et le nom d'un trimestre.
    expect(periodesDeLAnnee(2024, 'mensuelle')[1]).toEqual({ debut: '2024-02-01', fin: '2024-02-29', libelle: 'février 2024' })
    expect(periodesDeLAnnee(2026, 'trimestrielle')[0].libelle).toBe('1er trimestre 2026')
  })

  it('rend les mêmes périodes en retard, sous chaque combinaison', () => {
    let nonVides = 0
    for (const declarations of JEUX_DECLARATIONS) {
      for (const periodicite of PERIODICITES) {
        for (const annees of ANNEES_ACTIVES) {
          for (const premier of PREMIERS_JOURS) {
            for (const ouverture of OUVERTURES) {
              for (const f of FRONTIERES_PERIODES) {
                const attendu = periodesEnRetard(declarations, periodicite, annees, premier, ouverture, f)
                if (attendu.length > 0) nonVides++
                expect(deployee.periodesEnRetard(declarations, periodicite, annees, premier, ouverture, f),
                  `${JSON.stringify(declarations)} / ${periodicite} / ${annees} / ${premier} / ${ouverture} / ${f}`).toEqual(attendu)
              }
            }
          }
        }
      }
    }
    expect(nonVides).toBeGreaterThan(0)
    // La batterie exerce bien ce qui décide : le trimestre qui vient de finir n'est pas encore en retard, un mois déclaré
    // ne couvre pas son trimestre, l'ouverture écarte ce qui la précède, la frontière ce qu'elle fige, et les années
    // sont rendues dans l'ordre.
    const libelles = (p: Periode[]) => p.map((x) => x.libelle)
    expect(libelles(periodesEnRetard([], 'trimestrielle', [2026], '2026-07-01', null, null))).toEqual(['1er trimestre 2026'])
    expect(libelles(periodesEnRetard([], 'trimestrielle', [2026], '2026-08-01', null, null))).toEqual(['1er trimestre 2026', '2e trimestre 2026'])
    expect(libelles(periodesEnRetard(JEUX_DECLARATIONS[3], 'trimestrielle', [2026], '2026-08-01', null, null)))
      .toEqual(['1er trimestre 2026', '2e trimestre 2026'])
    expect(libelles(periodesEnRetard([], 'trimestrielle', [2026], '2027-02-01', '2026-07-01', null))).toEqual(['3e trimestre 2026', '4e trimestre 2026'])
    expect(libelles(periodesEnRetard([], 'trimestrielle', [2026], '2026-08-01', null, '2026-06-30'))).toEqual([])
    expect(libelles(periodesEnRetard([], 'trimestrielle', [2026, 2025, 2026], '2026-05-01', null, null)))
      .toEqual(['1er trimestre 2025', '2e trimestre 2025', '3e trimestre 2025', '4e trimestre 2025', '1er trimestre 2026'])
    expect(libelles(periodesEnRetard([], 'mensuelle', [2026], '2026-01-01', null, null))).toEqual([])
  })
})

describe('agent-comptable / points_a_traiter lit les déclarations de TVA', () => {
  const source = sourceDeployee()
  const corps = source.slice(source.indexOf('if (nom === "points_a_traiter")'), source.indexOf('return { erreur: `Outil inconnu'))

  it('lit les déclarations, la liquidation des écritures et ce que le relevé paie, sous le même refus de lecture partielle', () => {
    expect(corps).toMatch(/lireTout<DeclarationTvaRow>\(\(d, f\) =>\s*admin\.from\("declarations_tva"\)\.select\("id, periode_debut, periode_fin, cases, tva_collectee, tva_deductible, tva_deductible_immobilisations", \{ count: "exact" \}\)\.eq\("dossier_id", dossierId\)\.order\("periode_debut"\)\.order\("id"\)/)
    expect(corps).toMatch(/lireTout<[^>]*EcritureLiquidationRow>\(\(d, f\) =>\s*admin\.from\("ecritures_brouillon"\)\.select\("[^"]*\bdeclaration_tva_id"/)
    expect(corps).toMatch(/lireTout<[^>]*MouvementTvaRow>\(\(d, f\) =>\s*admin\.from\("lignes_bancaires"\)\.select\("id, date, montant, statut, [^"]*\bdeclaration_tva_id"[^)]*\)\.eq\("dossier_id", dossierId\)\.order\("id"\)/)
    expect(corps).toMatch(/rValides, rLettrages, rDeclarations\] = await Promise\.all/)
    expect(corps).toMatch(/rValides, rLettrages, rDeclarations\]\s*\.filter\(\(r\) => !r\.complete\)/)
  })

  it('rend les trois points de la Checklist, la frontière, l’ouverture et l’assujettissement compris', () => {
    expect(corps).toContain('const liquidationsPerimees = liquidationsDesynchronisees(ecrituresTyped, rDeclarations.lignes, frontiere)')
    expect(corps).toContain('const paiementsTvaPerimes = paiementsTvaDesynchronises(ecrituresTyped, rReleve.lignes, frontiere)')
    expect(corps).toMatch(/const anneesActives = \[\s*\.\.\.rReleve\.lignes\.map\(\(l\) => Number\(l\.date\.slice\(0, 4\)\)\),\s*\.\.\.piecesTyped\.flatMap\(\(p\) => \(p\.date_piece \? \[Number\(p\.date_piece\.slice\(0, 4\)\)\] : \[\]\)\),\s*\]/)
    expect(corps).toContain('const periodesTvaEnRetard = dossier.assujetti_tva\n      ? periodesEnRetard(rDeclarations.lignes, dossier.tva_periodicite, anneesActives, `${aujourdHuiCabinet().slice(0, 7)}-01`, ouverture, frontiere)\n      : []')
    expect(corps).toContain('declarations_de_tva_dont_l_ecriture_de_liquidation_manque_ou_ne_suit_plus_la_declaration: liquidationsPerimees.length,')
    expect(corps).toContain('paiements_ou_remboursements_de_tva_dont_l_ecriture_ne_suit_plus_le_mouvement: paiementsTvaPerimes.length,')
    expect(corps).toContain('periodes_de_tva_dont_la_declaration_n_est_pas_enregistree: periodesTvaEnRetard.map((p) => p.libelle),')
    // Les pièces lues sont les VALIDÉES : une pièce à valider ne fait pas d'un exercice une année d'activité.
    expect(corps).toMatch(/admin\.from\("pieces"\)\.select\("id, date_piece, [^"]*"[^)]*\)\.eq\("dossier_id", dossierId\)\.eq\("statut", "validee"\)/)
  })

  it('lit la périodicité de la TVA du dossier et la passe aux outils', () => {
    expect(source).toMatch(/\.from\("dossiers"\)\s*\.select\("[^"]*\btva_periodicite\b[^"]*"\)/)
    expect(source).toContain('      tva_periodicite: dossierRow.tva_periodicite,\n')
  })

  it('dit au modèle que la liquidation et le paiement ne sont pas des anomalies, et qu’une période non déclarée en est une', () => {
    expect(source).toMatch(/Une DÉCLARATION DE TVA enregistrée s'écrit au dernier jour de sa période, sans pièce ni mouvement, au journal des opérations diverses[^\n]*445510[^\n]*445670[^\n]*445830[^\n]*658000 ou au 758000\. Son PRÉLÈVEMENT[^\n]*rien de cela n'est une anomalie\. Une période terminée dont la déclaration n'est pas enregistrée garde sa TVA aux comptes 4457 et 4456 : c'est un point à traiter\./)
    // Et la description de l'outil les annonce, pour que le modèle sache les demander.
    expect(source).toMatch(/déclarations de TVA dont l'écriture de liquidation manque ou ne suit plus la déclaration, paiements ou remboursements de TVA dont l'écriture ne suit plus le mouvement, périodes de TVA dont la déclaration n'est pas enregistrée \(dossier assujetti\)/)
  })
})

describe('le garde-fou du bloc LIQUIDATION TVA sait encore échouer', () => {
  const planter = (...remplacements: [string, string][]) => {
    let source = sourceDeployee()
    for (const [avant, apres] of remplacements) {
      expect(source.split(avant).length - 1, `motif à planter introuvable ou ambigu : ${avant}`).toBe(1)
      source = source.replace(avant, apres)
    }
    return extraire(source)
  }
  // Une dérive doit faire échouer une ASSERTION, pas lever pour une autre raison (voir le bloc EMPRUNT).
  const echoue = (f: () => void) => {
    let erreur: unknown = null
    try { f() } catch (e) { erreur = e }
    expect((erreur as Error | null)?.name, `la dérive n'a pas fait échouer une assertion : ${String(erreur)}`).toBe('AssertionError')
  }
  const memesLiquidations = (copie: Copie) => {
    for (const d of [Q1, Q2, Q3, CHARGE, IMMO, NEANT, A_LA_MAIN]) {
      expect(copie.ecritureDeLaLiquidation(d)).toEqual(sansLibelle(ecritureDeLaLiquidation(d)))
    }
  }
  const memesLiquidationsAReecrire = (copie: Copie) => {
    for (const f of FRONTIERES) {
      expect(ids(copie.liquidationsDesynchronisees(ECRITURES_LIQUIDATIONS, DECLARATIONS, f)))
        .toEqual(ids(liquidationsDesynchronisees(ECRITURES_LIQUIDATIONS, DECLARATIONS, f)))
    }
  }
  const memesPaiements = (copie: Copie) => {
    for (const f of FRONTIERES) {
      expect(ids(copie.paiementsTvaDesynchronises(ECRITURES_PAIEMENTS, LIGNES, f)))
        .toEqual(ids(paiementsTvaDesynchronises(ECRITURES_PAIEMENTS, LIGNES, f)))
    }
  }
  const memesPeriodes = (copie: Copie) => {
    for (const declarations of JEUX_DECLARATIONS) {
      for (const periodicite of PERIODICITES) {
        for (const annees of ANNEES_ACTIVES) {
          for (const premier of PREMIERS_JOURS) {
            for (const ouverture of OUVERTURES) {
              for (const f of FRONTIERES_PERIODES) {
                expect(copie.periodesEnRetard(declarations, periodicite, annees, premier, ouverture, f))
                  .toEqual(periodesEnRetard(declarations, periodicite, annees, premier, ouverture, f))
              }
            }
          }
        }
      }
    }
  }

  it('attrape un arrondi porté au mauvais compte', () => {
    echoue(() => memesLiquidations(planter(['[arrondi > 0 ? COMPTE_ARRONDIS_CHARGE : COMPTE_ARRONDIS_PRODUIT, arrondi]', '[arrondi > 0 ? COMPTE_ARRONDIS_PRODUIT : COMPTE_ARRONDIS_CHARGE, arrondi]'])))
  })

  it('attrape un crédit reporté pris à l’envers', () => {
    echoue(() => memesLiquidations(planter(['[COMPTE_CREDIT_TVA_A_REPORTER, ligne("l27") - ligne("l22")]', '[COMPTE_CREDIT_TVA_A_REPORTER, ligne("l22") - ligne("l27")]'])))
  })

  it('attrape une TVA sur immobilisations oubliée', () => {
    echoue(() => memesLiquidations(planter(['    [COMPTE_TVA_IMMOBILISATIONS, -centimesTva(d.tva_deductible_immobilisations)],\n', ''])))
  })

  it('attrape un remboursement demandé oublié', () => {
    echoue(() => memesLiquidations(planter(['    [COMPTE_REMBOURSEMENT_TVA_DEMANDE, ligne("l26")],\n', ''])))
  })

  it('attrape une TVA à payer portée au débit', () => {
    echoue(() => memesLiquidations(planter(['    [COMPTE_TVA_A_DECAISSER, -ligne("l28")],', '    [COMPTE_TVA_A_DECAISSER, ligne("l28")],'])))
  })

  it('attrape une TVA déductible prise dans le mauvais sens', () => {
    echoue(() => memesLiquidations(planter(['    [COMPTE_TVA_DEDUCTIBLE, -centimesTva(d.tva_deductible)],', '    [COMPTE_TVA_DEDUCTIBLE, centimesTva(d.tva_deductible)],'])))
  })

  it('attrape une liquidation jugée à une autre date que la fin de sa période', () => {
    echoue(() => memesLiquidationsAReecrire(planter(['ecritureDeLaLiquidation(d), d.periode_fin))', 'ecritureDeLaLiquidation(d), d.periode_debut))'])))
  })

  it('attrape une copie qui réclame la liquidation d’un exercice validé', () => {
    echoue(() => memesLiquidationsAReecrire(planter(['    !estFigee(d.periode_fin, frontiere)\n    && !ecritureConforme(parDeclaration', '    !ecritureConforme(parDeclaration'])))
  })

  it('attrape un prélèvement écrit dans le sens d’un remboursement', () => {
    const derivee = planter(['    { compte: COMPTE_BANQUE, sens: entree ? "debit" : "credit", montant },\n    { compte: entree ? COMPTE_REMBOURSEMENT_TVA_DEMANDE', '    { compte: COMPTE_BANQUE, sens: entree ? "credit" : "debit", montant },\n    { compte: entree ? COMPTE_REMBOURSEMENT_TVA_DEMANDE'])
    echoue(() => expect(derivee.ecritureDuPaiementTva({ montant: -79 })).toEqual(sansLibelle(ecritureDuPaiementTva(ligne({ montant: -79 })))))
  })

  it('attrape une copie qui juge un mouvement qui n’est plus rapproché', () => {
    echoue(() => memesPaiements(planter(['    !!l.declaration_tva_id\n    && l.statut === "rapprochee"\n', '    !!l.declaration_tva_id\n'])))
  })

  it('attrape une copie qui juge un mouvement qui ne paie aucune déclaration', () => {
    echoue(() => memesPaiements(planter(['    !!l.declaration_tva_id\n    && l.statut === "rapprochee"\n', '    l.statut === "rapprochee"\n'])))
  })

  it('attrape une copie qui réclame le paiement d’un exercice validé', () => {
    echoue(() => memesPaiements(planter(['    && l.statut === "rapprochee"\n    && !estFigee(l.date, frontiere)\n    && !ecritureConforme(parLigne.get(l.id) ?? [], ecritureDuPaiementTva(l), l.date))', '    && l.statut === "rapprochee"\n    && !ecritureConforme(parLigne.get(l.id) ?? [], ecritureDuPaiementTva(l), l.date))'])))
  })

  it('attrape un trimestre mal nommé, ou mal borné', () => {
    echoue(() => expect(planter(['`${trimestre === 1 ? "1er" : `${trimestre}e`} trimestre ${annee}`', '`${trimestre}e trimestre ${annee}`']).periodesDeLAnnee(2026, 'trimestrielle'))
      .toEqual(periodesDeLAnnee(2026, 'trimestrielle')))
    echoue(() => expect(planter(['    fin: finDuMoisTva(annee, trimestre * 3),\n', '    fin: finDuMoisTva(annee, trimestre * 3 - 1),\n']).periodesDeLAnnee(2026, 'trimestrielle'))
      .toEqual(periodesDeLAnnee(2026, 'trimestrielle')))
  })

  it('attrape une période réclamée avant son échéance', () => {
    echoue(() => memesPeriodes(planter(['  const limite = mois === 1 ? `${annee - 1}-12-01` : `${annee}-${String(mois - 1).padStart(2, "0")}-01`\n', '  const limite = premierJourDuMois\n'])))
  })

  it('attrape une copie qui oublie l’ouverture d’un dossier repris', () => {
    echoue(() => memesPeriodes(planter(['    && (ouverture === null || p.debut >= ouverture)\n', ''])))
  })

  it('attrape une copie qui réclame une période d’un exercice validé', () => {
    echoue(() => memesPeriodes(planter(['    .filter((p) => !estFigee(p.fin, frontiere))\n}', '}'])))
  })

  it('attrape un mois déclaré qui couvrirait tout son trimestre', () => {
    echoue(() => memesPeriodes(planter(['    && moisDeLaPeriode(p).some((m) => !moisDeclares.has(m)))', '    && moisDeLaPeriode(p).every((m) => !moisDeclares.has(m)))'])))
  })

  it('attrape des années rendues hors de leur ordre', () => {
    echoue(() => memesPeriodes(planter(['  return [...new Set(anneesActives)].sort((a, b) => a - b)\n', '  return [...new Set(anneesActives)]\n'])))
  })
})
