import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { BanquesDuDossier } from './banqueDuMouvement'
import { concordance2035 } from './concordance2035'
import { OPERATIONS_DE_CAISSE_ABSENTES } from './controlesDeLaCaisse'
import { calculerDeclaration2035 } from './declaration2035'
import { analyserEcritures, ecrituresSansObjet } from './ecritures'
import { AUCUNE_FACTURE_SOURCE } from './facturesSources'
import { CHAMPS_BNC_NON_EXPORTES, genererFec, numeroterFec } from './fec'
import { lettrages } from './lettrage'
import { absenceFec, pisteAudit, rupturesPisteAudit } from './pisteAudit'
import { PLAN_PAR_DEFAUT } from './planComptable'
import { paiementsDesPieces } from './rattachement'
import { CAISSE_ABSENTE } from './recettesDeCaisse'
import type { EcritureBrouillon } from './types'
import { defautsDeNumerotation } from './validationExercice'
import { anomaliesDgfip, colonnes, desequilibresDgfip } from '../test/fecDgfip'
import { modeleDeTest } from '../test/modeles'
import { SANS_ECRITURE_DE_VENTE, SANS_VENTE_FACTUREE, ventesFactureesVides } from '../test/ventesFacturees'

// LES RÉGULARISATIONS D'INVENTAIRE CHEZ LES LECTEURS DU BROUILLON (ligne 35, INV3 ; conception, § 5.3 et § 5.4) : le FEC (une
// sorte de plus, au journal OD, l'état d'inventaire pour pièce), la numérotation que la validation enverra et ses défauts, la
// piste d'audit et ses détecteurs, le lettrage (le 408 et le 418 par régularisation), et les contrôles « à régénérer » et
// « sans objet », qui ne lisent que les pièces. Les lignes sont celles que la base écrit (INV2 : la constatation au 31
// décembre, l'extourne au 1er janvier suivant, aucune autre source) ; une ligne qui ne cite pas sa régularisation se lit comme
// hier. Données FICTIVES.

const ligne = (o: Partial<EcritureBrouillon>): EcritureBrouillon => ({
  id: 'e', dossier_id: 'd1', piece_id: null, ligne_bancaire_id: null, date: '2025-12-31', libelle: 'Régularisation', sens: 'debit',
  statut: 'proposee', compte: '486000', montant: 1200, created_at: '2026-01-15T09:00:00Z', ...o,
} as EcritureBrouillon)

const CCA = 'CCA 31/12/2025 — Charges constatées d’avance — Assurance 2026'
const FNP = 'FNP 31/12/2025 — Fournisseurs - Factures non parvenues — Honoraires de décembre'
// Une charge constatée d'avance de 2025 et une facture non parvenue avec sa TVA d'attente, chacune avec son extourne.
const CONSTATATIONS = [
  ligne({ id: 'c1', compte: '486000', sens: 'debit', libelle: CCA, operation_inventaire_id: 'o-cca' }),
  ligne({ id: 'c2', compte: '616000', sens: 'credit', libelle: CCA, operation_inventaire_id: 'o-cca' }),
  ligne({ id: 'f1', compte: '622600', sens: 'debit', montant: 100, libelle: FNP, operation_inventaire_id: 'o-fnp' }),
  ligne({ id: 'f2', compte: '445860', sens: 'debit', montant: 20, libelle: FNP, operation_inventaire_id: 'o-fnp' }),
  ligne({ id: 'f3', compte: '408100', sens: 'credit', montant: 120, libelle: FNP, operation_inventaire_id: 'o-fnp' }),
]
const EXTOURNES = CONSTATATIONS.map((l) => ({
  ...l, id: `x${l.id}`, date: '2026-01-01', sens: l.sens === 'debit' ? 'credit' as const : 'debit' as const, libelle: `Extourne — ${l.libelle}`,
}))
const ROLE: BanquesDuDossier = { cas: 'role', compte: PLAN_PAR_DEFAUT.banque }
const ENGAGEMENT = modeleDeTest('engagement')
const numeroter = (ecritures: EcritureBrouillon[]) => numeroterFec(ecritures, [], [], [], ENGAGEMENT, [], SANS_ECRITURE_DE_VENTE,
  OPERATIONS_DE_CAISSE_ABSENTES, CHAMPS_BNC_NON_EXPORTES)
const sansSource = (lignes: EcritureBrouillon[]) => lignes.map((l) => ({ ...l, operation_inventaire_id: null }))

describe('le FEC et la numérotation : une écriture par régularisation et par date, au journal OD, sous « Inventaire AAAA »', () => {
  it('l’exercice de la constatation : deux écritures, la pièce « Inventaire 2025 » du 31/12/2025', () => {
    const n = numeroter([...CONSTATATIONS])
    expect(n.horsFec).toEqual([])
    // L'ordre des lignes d'une écriture est celui du fichier (`ordonnerLignes`) : comparées par écriture, puis par identifiant.
    expect(n.lignes.map((l) => [l.ecriture.id, l.journal, l.numero, l.pieceRef, l.pieceDate] as const)
      .sort((x, y) => x[2] - y[2] || x[0].localeCompare(y[0]))).toEqual([
      ['c1', 'OD', 1, 'Inventaire 2025', '2025-12-31'], ['c2', 'OD', 1, 'Inventaire 2025', '2025-12-31'],
      ['f1', 'OD', 2, 'Inventaire 2025', '2025-12-31'], ['f2', 'OD', 2, 'Inventaire 2025', '2025-12-31'],
      ['f3', 'OD', 2, 'Inventaire 2025', '2025-12-31'],
    ])
    expect(defautsDeNumerotation(n)).toEqual([])
  })

  it('l’exercice suivant : l’extourne du 1er janvier garde la pièce de sa régularisation, l’état d’inventaire de 2025', () => {
    const n = numeroter([...EXTOURNES])
    expect(new Set(n.lignes.map((l) => `${l.journal}|${l.pieceRef}|${l.pieceDate}`))).toEqual(new Set(['OD|Inventaire 2025|2025-12-31']))
    expect(new Set(n.lignes.map((l) => l.numero))).toEqual(new Set([1, 2]))
    expect(defautsDeNumerotation(n)).toEqual([])
  })

  it('le fichier passe les contrôles de la DGFiP : une date, un journal, équilibrée ; EcritureLib, le libellé composé', () => {
    const fec = genererFec([...CONSTATATIONS], [], [], [], ENGAGEMENT, [], new Map(), SANS_ECRITURE_DE_VENTE,
      OPERATIONS_DE_CAISSE_ABSENTES, CHAMPS_BNC_NON_EXPORTES)
    expect(colonnes(fec).slice(1).map((r) => [r[0], r[2], r[3], r[4], r[8], r[9], r[10]])
      .sort((x, y) => x[1].localeCompare(y[1]) || x[3].localeCompare(y[3]))).toEqual([
      ['OD', 'OD00001', '20251231', '486000', 'Inventaire 2025', '20251231', CCA],
      ['OD', 'OD00001', '20251231', '616000', 'Inventaire 2025', '20251231', CCA],
      ['OD', 'OD00002', '20251231', '408100', 'Inventaire 2025', '20251231', FNP],
      ['OD', 'OD00002', '20251231', '445860', 'Inventaire 2025', '20251231', FNP],
      ['OD', 'OD00002', '20251231', '622600', 'Inventaire 2025', '20251231', FNP],
    ])
    expect(anomaliesDgfip(fec)).toEqual([])
    expect(desequilibresDgfip(fec)).toEqual([])
  })

  it('sans la source, les mêmes lignes restent hors du fichier, comme le reste d’une pièce supprimée (ce que la sorte corrige)', () => {
    expect(numeroter(sansSource(CONSTATATIONS)).horsFec.map((e) => e.id)).toEqual(['c1', 'c2', 'f1', 'f2', 'f3'])
  })

  it('le défaut que la base refuse : une ligne hors de sa pièce, deux régularisations sous un numéro, une autre ligne mêlée', () => {
    const n = numeroter([...CONSTATATIONS])
    const autrePiece = { ...n, lignes: n.lignes.map((l) => (l.ecriture.id === 'c1' ? { ...l, pieceRef: 'Inventaire 2024' } : l)) }
    expect(defautsDeNumerotation(autrePiece)).toContainEqual({ type: 'inventaire', journal: 'OD', numero: 1 })
    const reunies = { ...n, lignes: n.lignes.map((l) => ({ ...l, numero: 1 })) }
    expect(defautsDeNumerotation(reunies)).toContainEqual({ type: 'inventaire', journal: 'OD', numero: 1 })
    const melee = { ...n, lignes: n.lignes.map((l) => (l.ecriture.id === 'c2' ? { ...l, ecriture: { ...l.ecriture, operation_inventaire_id: null } } : l)) }
    expect(defautsDeNumerotation(melee)).toContainEqual({ type: 'inventaire', journal: 'OD', numero: 1 })
    const auxAchats = { ...n, lignes: n.lignes.map((l) => (l.numero === 2 ? { ...l, journal: 'AC' as const, numero: 1 } : l)) }
    expect(defautsDeNumerotation(auxAchats)).toContainEqual({ type: 'inventaire', journal: 'AC', numero: 1 })
  })
})

describe('la piste d’audit : l’état d’inventaire pour justificatif, aucune rupture', () => {
  const registre = {
    immobilisations: [], factures: [], vehicules: [], ventes: SANS_VENTE_FACTUREE, caisse: OPERATIONS_DE_CAISSE_ABSENTES,
    plan: PLAN_PAR_DEFAUT, banques: ROLE,
  }

  it('ni rupture ni absence du FEC ; chaque ligne cite l’état d’inventaire de l’exercice de sa régularisation, extourne comprise', () => {
    const toutes = [...CONSTATATIONS, ...EXTOURNES]
    expect(rupturesPisteAudit(toutes, new Set(), PLAN_PAR_DEFAUT, ROLE)).toEqual([])
    expect(absenceFec(toutes, new Set()).nb).toBe(0)
    const piste = pisteAudit(toutes, [], [], [], registre)
    expect(new Set(piste.map((l) => `${l.pieceFichier}|${l.pieceDate}|${l.manque.join(',')}`)))
      .toEqual(new Set(['État d\'inventaire au 31/12/2025 (Inventaire 2025)|2025-12-31|']))
    expect(piste.find((l) => l.ecritureId === 'xc1')?.libelle).toBe(`Extourne — ${CCA}`)
  })

  it('sans la source, une rupture et une absence, comme hier', () => {
    expect(rupturesPisteAudit(sansSource(CONSTATATIONS), new Set(), PLAN_PAR_DEFAUT, ROLE)).toHaveLength(5)
    expect(absenceFec(sansSource(CONSTATATIONS), new Set()).nb).toBe(5)
  })
})

describe('le lettrage : le 408 par régularisation, la constatation contre son extourne', () => {
  it('le 408 de la facture non parvenue se lettre ; ni le 486, ni la TVA d’attente, ni la charge', () => {
    const l = lettrages([...CONSTATATIONS, ...EXTOURNES], [], [], ENGAGEMENT, SANS_VENTE_FACTUREE)
    expect([...l.keys()].sort()).toEqual(['f3', 'xf3'])
    expect(l.get('f3')).toEqual(l.get('xf3'))
    expect(l.get('f3')?.code).toBe('A')
  })

  it('sans son extourne, rien ne se lettre ; en trésorerie, rien ; sans la source, rien', () => {
    expect(lettrages([...CONSTATATIONS], [], [], ENGAGEMENT, SANS_VENTE_FACTUREE).size).toBe(0)
    expect(lettrages([...CONSTATATIONS, ...EXTOURNES], [], [], modeleDeTest('tresorerie'), SANS_VENTE_FACTUREE).size).toBe(0)
    expect(lettrages(sansSource([...CONSTATATIONS, ...EXTOURNES]), [], [], ENGAGEMENT, SANS_VENTE_FACTUREE).size).toBe(0)
  })
})

describe('« à régénérer » et « sans objet » ne lisent que les pièces : une régularisation n’y est jamais un écart', () => {
  it('ni sans contrepartie, ni déséquilibrée, ni désynchronisée, ni sans objet', () => {
    const toutes = [...CONSTATATIONS, ...EXTOURNES]
    expect(analyserEcritures(toutes, [], true, paiementsDesPieces([], [], [], []), ENGAGEMENT, null, new Set(), ROLE)).toEqual({
      nbSansContrepartie: 0, piecesSansContrepartie: [], groupesDesequilibres: [], piecesDesynchronisees: [],
    })
    expect(ecrituresSansObjet(toutes, [], [], new Map(), null, PLAN_PAR_DEFAUT, AUCUNE_FACTURE_SOURCE)).toEqual([])
  })

  it('« Régénérer » et les gestes de la banque ne retirent ni ne changent que des lignes d’une pièce ou d’un mouvement, colonnes qu’une ligne d’inventaire ne porte jamais', () => {
    // Le relevé de TOUTES les écritures du navigateur sur le brouillon : `delete` et `update` filtrent sur `piece_id` ou
    // `ligne_bancaire_id` (la contrainte `ecritures_brouillon_inventaire_sans_autre_source` les tient nuls sur une ligne
    // d'inventaire, et sa garde refuse toute écriture hors de ses fonctions).
    const racine = new URL('../', import.meta.url)
    const fichiers = ['lib', 'pages/dossier'].flatMap((d) => readdirSync(new URL(d, racine), { recursive: true, encoding: 'utf8' })
      .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f)).map((f) => `${d}/${f}`))
    const gestes: string[] = []
    for (const f of fichiers) {
      const texte = readFileSync(new URL(f, racine), 'utf8')
      for (const m of texte.matchAll(/from\('ecritures_brouillon'\)\s*\.(delete|update)\(([\s\S]{0,200})/g)) gestes.push(`${f}: ${m[1]}${m[2].split('\n')[0]}`)
    }
    expect(gestes.length).toBeGreaterThanOrEqual(5)
    for (const g of gestes) expect(g, g).toMatch(/\.eq\('(piece_id|ligne_bancaire_id)'/)
  })
})

describe('la concordance de la 2035 ne se calcule qu’en trésorerie, où la base refuse toute régularisation', () => {
  it('une ligne d’inventaire impossible y resterait un écart, jamais écartée en silence : la validation tomberait du côté fermé', () => {
    const declaration = calculerDeclaration2035(2025, [], [], [], [], [], false, paiementsDesPieces([], [], [], []), [], [],
      PLAN_PAR_DEFAUT, ventesFactureesVides('d1'), { etat: 'sans_bascule' }, CAISSE_ABSENTE)
    const c = concordance2035(declaration, [...CONSTATATIONS], {
      piecesValidees: new Set(), piecesImmobilisees: new Set(), mouvementsDesVentesFacturees: new Set(),
    }, null)
    expect(c.concorde).toBe(false)
    expect(c.ecarts.length).toBeGreaterThan(0)
  })
})
