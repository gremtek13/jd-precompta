import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { beforeAll, describe, expect, it } from 'vitest'
import * as module from './relances'
import { resteAEncaisser, type EncaissementLu, type LigneDeFacture, type PartLue } from './encaissementsFactures'
import { dejaCredite } from './montantsFacture'
import { diagnosticsSepares, executerModule } from '../test/compilationSeparee'
import { entierTire, tirage } from '../test/encaissementsBatterie'

// LA COPIE DU BLOC resteDuDeLaFacture DANS send-email (C5-Q4, « oui, la fonction relit le reste dû », 08/11/2026). La
// relance d'une facture en retard relit elle-même ce qu'il en reste dû — ni encaissé ni crédité par un avoir — : une
// facture soldée ne se relance pas, et l'e-mail dit le reste dû et le total. La fonction est auto-portée : elle calcule
// par une COPIE du bloc de src/lib/relances.ts, qui lit `calculerLigne` du bloc montantsFacture, recopié lui aussi
// (copiesFacturation.test.ts). Cinq questions (CLAUDE.md, « Une Edge Function auto-portée duplique du code ») :
//   1. La copie est-elle AU CARACTÈRE PRÈS le bloc de src/lib ?
//   2. Le bloc se suffit-il, compilé avec le seul bloc montantsFacture ?
//   3. EXÉCUTÉE seule, rend-elle ce que rend le module, sur une batterie ?
//   4. Le module rend-il EXACTEMENT le reste de l'onglet Factures (`resteAEncaisser`, moins `dejaCredite`) ?
//   5. La fonction s'en SERT-elle, et le garde mord-il ?

const MODULE = readFileSync(new URL('./relances.ts', import.meta.url), 'utf8')
const MONTANTS = readFileSync(new URL('./montantsFacture.ts', import.meta.url), 'utf8')
const FONCTION = readFileSync(new URL('../../supabase/functions/send-email/index.ts', import.meta.url), 'utf8')

function blocDe(source: string, nom: string, ou: string): string {
  const debut = `// ── DÉBUT COPIE ${nom} `
  const fin = `// ── FIN COPIE ${nom} `
  const d = source.indexOf(debut)
  const f = source.indexOf(fin)
  expect(d, `bornes du bloc ${nom} introuvables dans ${ou}`).toBeGreaterThan(-1)
  expect(source.indexOf(debut, d + 1), `le bloc ${nom} est présent deux fois dans ${ou}`).toBe(-1)
  expect(f, `le bloc ${nom} n'est pas refermé dans ${ou}`).toBeGreaterThan(d)
  return source.slice(d, source.indexOf('\n', f) + 1)
}

const ORIGINE = blocDe(MODULE, 'resteDuDeLaFacture', 'relances.ts')
const BLOC_MONTANTS = blocDe(MONTANTS, 'montantsFacture', 'montantsFacture.ts')
const COPIE = blocDe(FONCTION, 'resteDuDeLaFacture', 'send-email')

type Copie = Pick<typeof module, 'resteDuDeLaFacture'>
const executer = (bloc: string) => executerModule<Copie>(BLOC_MONTANTS + bloc)

const COMPILES = {
  origine: BLOC_MONTANTS + ORIGINE,
  seul: ORIGINE + 'export {}\n',
  emprunte: BLOC_MONTANTS + ORIGINE.replace('calculerLigne(l.quantite', 'calculerLaLigne(l.quantite'),
}

// Une facture tirée : des lignes (des prix négatifs, une remise ; des quantités et des prix décimaux), un registre
// (des encaissements, des retirés, des contre-passations négatives) et des avoirs (TTC stockés négatifs).
interface Cas {
  lignes: { quantite: number; prix_unitaire_ht: number; taux_tva: number }[]
  encaissements: { montant: number; retire_le: string | null }[]
  avoirs: { montant_ttc: number }[]
}

function batterie(graine: number, n: number): Cas[] {
  const suivant = tirage(graine)
  const centimes = (max: number) => entierTire(suivant, max) / 100
  const QUANTITES = [1, 2, 0.5, 1.5, 3, 0.25, 7, -1]
  const PRIX = [100, 32.05, 2.01, 0.15, 16.025, 1234.567891, -20, 0.333333]
  const TAUX = [20, 10, 5.5, 2.1, 0, 8.5]
  const cas: Cas[] = []
  for (let i = 0; i < n; i++) {
    const lignes = Array.from({ length: 1 + entierTire(suivant, 4) }, () => ({
      quantite: QUANTITES[entierTire(suivant, QUANTITES.length)],
      prix_unitaire_ht: PRIX[entierTire(suivant, PRIX.length)],
      taux_tva: TAUX[entierTire(suivant, TAUX.length)],
    }))
    const encaissements = Array.from({ length: entierTire(suivant, 4) }, () => ({
      montant: (entierTire(suivant, 5) === 0 ? -1 : 1) * centimes(20_000),
      retire_le: entierTire(suivant, 4) === 0 ? '2026-10-20T09:00:00Z' : null,
    }))
    const avoirs = Array.from({ length: entierTire(suivant, 3) }, () => ({ montant_ttc: -centimes(20_000) }))
    cas.push({ lignes, encaissements, avoirs })
  }
  return cas
}

const CAS = batterie(20261108, 400)

const rendus = (m: Copie) => CAS.map((c) => m.resteDuDeLaFacture(c.lignes, c.encaissements, c.avoirs))

// Le reste de l'onglet Factures (FacturesTab.tsx, `retardDe`), sur le même cas : le registre et ses lignes, ceux de la
// facture et d'une voisine, que le module filtre lui-même.
function resteDeLEcran(c: Cas): number {
  const facture = { id: 'f1', type: 'facture' as const, source_de_la_vente: false }
  const lignes: LigneDeFacture[] = [
    ...c.lignes.map((l, i) => ({ facture_id: 'f1', ordre: i + 1, designation: 'Prestation fictive', ...l })),
    { facture_id: 'f2', ordre: 1, designation: 'Voisine', quantite: 1, prix_unitaire_ht: 999, taux_tva: 20 },
  ]
  const encaissements: EncaissementLu[] = [
    ...c.encaissements.map((e, i) => ({
      id: `e${i}`, dossier_id: 'd1', facture_id: 'f1', montant: e.montant, ligne_bancaire_id: null,
      annule_id: e.montant < 0 ? 'e0' : null, retire_le: e.retire_le,
    })),
    { id: 'ev', dossier_id: 'd1', facture_id: 'f2', montant: 50, ligne_bancaire_id: null, annule_id: null, retire_le: null },
  ]
  const parts: PartLue[] = []
  const factures = [
    ...c.avoirs.map((a) => ({ type: 'avoir' as const, facture_origine_id: 'f1', montant_ttc: a.montant_ttc })),
    { type: 'avoir' as const, facture_origine_id: 'f2', montant_ttc: -30 },
    { type: 'facture' as const, facture_origine_id: null, montant_ttc: 120 },
  ]
  return resteAEncaisser({ facture, lignes, encaissements, parts }).resteCentimes - Math.round(dejaCredite('f1', factures) * 100)
}

describe('la copie du bloc resteDuDeLaFacture dans send-email', () => {
  let compiles: Record<keyof typeof COMPILES, string[]>
  beforeAll(() => {
    compiles = diagnosticsSepares(COMPILES, {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, strict: true, noEmit: true, noUnusedLocals: true,
      noUnusedParameters: true, lib: ['lib.es2022.d.ts'], types: [],
    })
  }, 60_000)

  it('send-email : au caractère près le bloc de src/lib/relances.ts, et le bloc des montants aussi', () => {
    expect(COPIE).toBe(ORIGINE)
    expect(blocDe(FONCTION, 'montantsFacture', 'send-email')).toBe(BLOC_MONTANTS)
  })

  it('se compile avec le seul bloc montantsFacture — seul, il lui manque `calculerLigne` ; un emprunt se voit', () => {
    expect(compiles.origine).toEqual([])
    expect(compiles.seul.join('\n')).toMatch(/calculerLigne/)
    expect(compiles.emprunte.join('\n')).toMatch(/calculerLaLigne/)
  })

  it('exécutée seule, la copie rend ce que rend le module, sur la batterie', () => {
    expect(rendus(executer(COPIE))).toEqual(rendus(module))
  })

  it('le module rend EXACTEMENT le reste de l’onglet Factures, et la batterie voit les trois termes', () => {
    for (const c of CAS) {
      const r = module.resteDuDeLaFacture(c.lignes, c.encaissements, c.avoirs)
      expect(r?.resteCentimes, JSON.stringify(c)).toBe(resteDeLEcran(c))
    }
    // La batterie n'est pas aveugle : des soldées et des dues, des retirés, des contre-passations, des avoirs.
    const restes = CAS.map((c) => module.resteDuDeLaFacture(c.lignes, c.encaissements, c.avoirs)?.resteCentimes ?? 0)
    expect(restes.filter((r) => r <= 0).length).toBeGreaterThan(20)
    expect(restes.filter((r) => r > 0).length).toBeGreaterThan(20)
    expect(CAS.filter((c) => c.encaissements.some((e) => e.retire_le != null)).length).toBeGreaterThan(20)
    expect(CAS.filter((c) => c.encaissements.some((e) => e.montant < 0)).length).toBeGreaterThan(20)
    expect(CAS.filter((c) => c.avoirs.length > 0).length).toBeGreaterThan(20)
  })

  it('le TTC est celui de la facture : 0,5 × 32,05 € à 20 %, le HT à 16,03 € et la TVA à 3,21 €', () => {
    expect(module.resteDuDeLaFacture([{ quantite: 0.5, prix_unitaire_ht: 32.05, taux_tva: 20 }], [], [])).toEqual({ ttcCentimes: 1924, resteCentimes: 1924 })
    expect(module.resteDuDeLaFacture([{ quantite: 1, prix_unitaire_ht: 100, taux_tva: 20 }], [{ montant: 50, retire_le: null }], [{ montant_ttc: -70 }]))
      .toEqual({ ttcCentimes: 12000, resteCentimes: 0 })
    expect(module.resteDuDeLaFacture([{ quantite: 1, prix_unitaire_ht: Number.NaN, taux_tva: 20 }], [], [])).toBeNull()
    expect(module.resteDuDeLaFacture([], [{ montant: Number.POSITIVE_INFINITY, retire_le: null }], [])).toBeNull()
    expect(module.resteDuDeLaFacture([], [], [{ montant_ttc: Number.NaN }])).toBeNull()
  })

  it('send-email relit le reste dû par la copie, refuse une facture soldée, et ne redéfinit rien hors du bloc', () => {
    const horsBloc = FONCTION.replace(COPIE, '')
    expect(horsBloc).toMatch(/const reste = resteDuDeLaFacture\(/)
    expect(horsBloc).toMatch(/if \(reste\.resteCentimes <= 0\) \{/)
    expect(horsBloc).not.toMatch(/function resteDuDeLaFacture\b/)
  })

  it('le garde mord : la copie qui oublie les avoirs, ou les encaissements retirés, rend autre chose', () => {
    const sansAvoirs = COPIE.replace('ttcCentimes - encaisseCentimes - crediteCentimes', 'ttcCentimes - encaisseCentimes')
    const avecRetires = COPIE.replace('    if (e.retire_le != null) continue\n', '')
    for (const mutee of [sansAvoirs, avecRetires]) {
      expect(mutee).not.toBe(COPIE)
      expect(rendus(executer(mutee))).not.toEqual(rendus(module))
    }
  })
})
