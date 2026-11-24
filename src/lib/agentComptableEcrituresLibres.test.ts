import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { referenceDeLEcritureLibre } from './ecrituresLibresDesExports'
import { lignesDeResultatLibres } from './ecrituresLibresDeLa2035'
import { ecritureLibreDeLaLigne } from './ecrituresLibresVue'
import {
  CONTRATS, MARQUEUR_DES_ECRITURES_LIBRES, SCENARIOS_DES_ECRITURES_LIBRES, jugerScenario, type Contexte,
} from '../test/contratsFonctions'
import { muter } from '../test/fonctionsEdge'

// LES ÉCRITURES LIBRES DE L'EXPERT-COMPTABLE DANS L'ASSISTANT (EL6 ; docs/conceptions/54-ecriture-libre-de-l-expert-comptable.md,
// § 5.9). `agent-comptable` est auto-portée : le bloc `── DÉBUT/FIN ÉCRITURES LIBRES` relit les écritures libres que l'outil
// `lister_ecritures_libres` lit au jeton de l'appelant, et écrit ce qui en part au modèle ; le bloc PIÈCES DE VENTE nomme leurs
// lignes au brouillon (agentComptablePiecesDeVente.test.ts). Ce garde :
//   1. exécute le bloc SEUL, le confronte à src/lib — le numéro (`referenceDeLEcritureLibre`), la forme d'une ligne que la base
//      écrit (`ecritureLibreDeLaLigne`), le poste et le « hors de la 2035 » d'une ligne de résultat (`lignesDeResultatLibres`) —,
//      et vérifie que rien de saisi n'en sort : ni libellé, ni motif, ni libellé d'un compte ;
//   2. plante une dérive par fonction dans la vraie source, et prouve qu'il sait encore échouer ;
//   3. joue l'assistant en HTTP sur les mondes du contrat (src/test/contratsFonctions.ts, « EL6 ») et sur des sources mutées : la
//      lecture au jeton du service, le libellé lu et rendu, le libellé d'un compte recopié, une lecture partielle crue — chacune
//      prise en faute.

function sourceDeployee(): string {
  return readFileSync(new URL('../../supabase/functions/agent-comptable/index.ts', import.meta.url), 'utf8')
}

function bornes(source: string): string {
  const debut = source.indexOf('// ── DÉBUT ÉCRITURES LIBRES')
  const fin = source.indexOf('// ── FIN ÉCRITURES LIBRES')
  expect(source.split('// ── DÉBUT ÉCRITURES LIBRES').length - 1, 'la borne de début, une fois').toBe(1)
  expect(source.split('// ── FIN ÉCRITURES LIBRES').length - 1, 'la borne de fin, une fois').toBe(1)
  expect(fin).toBeGreaterThan(debut)
  return source.slice(debut, fin)
}

interface LigneDuModele { compte: string; sens: 'debit' | 'credit'; centimes: number; poste_2035: string | null }
interface EcritureDuModele { id: string; exercice: number; numero: number; date: string; avec_extourne: boolean; piece_citee: boolean; lignes: LigneDuModele[] }
interface Copie {
  numeroDeLEcritureLibre: (exercice: number, numero: number) => string
  ligneLibreCrue: (v: unknown) => LigneDuModele | null
  ecrituresLibresCrues: (lues: readonly Record<string, unknown>[], dossierId: string) => EcritureDuModele[] | null
  ecrituresLibresVuesParLeModele: (e: readonly EcritureDuModele[], mode: 'tresorerie' | 'engagement', annee: number | null) => Record<string, unknown>
}
const NOMS = ['numeroDeLEcritureLibre', 'ligneLibreCrue', 'ecrituresLibresCrues', 'ecrituresLibresVuesParLeModele'] as const

function copieDe(source: string): Copie {
  const js = ts.transpileModule(bornes(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return new Function(`"use strict";\n${js}\nreturn { ${NOMS.join(', ')} }`)() as Copie
}

const SAISI = 'Patient fictif Hautecœur'
const D = 'd1'
const enBase = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'el-3', dossier_id: D, exercice: 2026, numero: 3, date: '2026-12-31', libelle: `Écart — ${SAISI}`, motif: `Motif — ${SAISI}`,
  avec_extourne: true, piece_citee_id: 'p-citee', version: 1, cree_par: 'u', cree_le: '2027-01-10T10:00:00Z', modifie_par: null, modifie_le: null,
  lignes: [
    { compte: '622600', sens: 'debit', centimes: 30000, poste_2035: 'Honoraires rétrocédés', compte_lib: null },
    { compte: '658900', sens: 'debit', centimes: 1000, poste_2035: null, compte_lib: `Compte de ${SAISI}` },
    { compte: '471900', sens: 'credit', centimes: 31000, poste_2035: null, compte_lib: null },
  ],
  ...o,
})
// Les formes qu'une ligne de la colonne peut prendre : celle que la base écrit, et chaque écart d'un champ.
const LIGNES: readonly unknown[] = [
  { compte: '622600', sens: 'debit', centimes: 100, poste_2035: 'Achats', compte_lib: null },
  { compte: '622600', sens: 'credit', centimes: 100, poste_2035: null },
  { compte: '4719001234', sens: 'debit', centimes: 1, compte_lib: 'x' },
  { compte: '822600', sens: 'debit', centimes: 100 }, { compte: '62260', sens: 'debit', centimes: 100 }, { compte: 622600, sens: 'debit', centimes: 100 },
  { compte: '622600', sens: 'D', centimes: 100 }, { compte: '622600', sens: 'debit', centimes: 0 }, { compte: '622600', sens: 'debit', centimes: 1.5 },
  { compte: '622600', sens: 'debit', centimes: '100' }, { compte: '622600', sens: 'debit', centimes: 100, poste_2035: '' },
  { compte: '622600', sens: 'debit', centimes: 100, compte_lib: 3 }, null, [], 'ligne',
]

describe('agent-comptable / bloc ÉCRITURES LIBRES : exécuté seul, confronté à src/lib', () => {
  const copie = copieDe(sourceDeployee())

  it('ne définit que ce que ce test confronte', () => {
    const declares = [...bornes(sourceDeployee()).matchAll(/^(?:function|const|interface|type)\s+(\w+)/gm)].map((m) => m[1]).sort()
    expect(declares).toEqual([...NOMS, 'EcritureLibreDuModele', 'LigneLibreDuModele'].sort())
  })

  it('le numéro : celui de referenceDeLEcritureLibre', () => {
    for (const [exercice, numero] of [[2026, 1], [2026, 42], [2025, 9999], [2027, 10000]] as const) {
      expect(copie.numeroDeLEcritureLibre(exercice, numero)).toBe(referenceDeLEcritureLibre({ exercice, numero }))
    }
  })

  it('une ligne se croit comme src/lib la croit, et seuls son compte, son sens, ses centimes et son poste en sortent', () => {
    for (const l of LIGNES) {
      const src = ecritureLibreDeLaLigne(enBase({ lignes: [l, { compte: '471900', sens: 'credit', centimes: 100 }] }), D)
      const crue = copie.ligneLibreCrue(l)
      expect(crue === null, JSON.stringify(l)).toBe(src === null)
      if (crue !== null) expect(Object.keys(crue)).toEqual(['compte', 'sens', 'centimes', 'poste_2035'])
    }
  })

  it('une écriture se croit comme src/lib la croit, sur les champs que le bloc lit', () => {
    const ecarts: Record<string, unknown>[] = [
      enBase(), enBase({ numero: 0 }), enBase({ numero: 2.5 }), enBase({ exercice: '2026' }), enBase({ date: '2025-12-31' }),
      enBase({ date: '2026-12-31T00:00:00Z' }), enBase({ avec_extourne: 'oui' }), enBase({ piece_citee_id: '' }), enBase({ piece_citee_id: 7 }),
      enBase({ lignes: [] }), enBase({ lignes: [LIGNES[0]] }), enBase({ lignes: 'x' }), enBase({ dossier_id: 'autre' }), enBase({ id: '' }),
    ]
    for (const e of ecarts) {
      expect(copie.ecrituresLibresCrues([e], D) === null, JSON.stringify(e).slice(0, 120)).toBe(ecritureLibreDeLaLigne(e, D) === null)
    }
    // Une seule écriture illisible rend toute la lecture illisible.
    expect(copie.ecrituresLibresCrues([enBase(), enBase({ id: 'el-4', numero: 0 })], D)).toBeNull()
    expect(copie.ecrituresLibresCrues([], D)).toEqual([])
  })

  it('ce qui part au modèle : le numéro, les dates, les comptes, les montants, les postes — jamais rien de saisi', () => {
    const crues = copie.ecrituresLibresCrues([enBase({ id: 'el-9', numero: 9, avec_extourne: false, piece_citee_id: null }), enBase()], D)!
    expect(crues.map((e) => e.numero)).toEqual([3, 9])
    const vue = copie.ecrituresLibresVuesParLeModele(crues, 'tresorerie', null)
    expect(JSON.stringify(vue)).not.toContain(SAISI)
    expect(JSON.stringify(vue)).not.toContain('compte_lib')
    expect(vue).toEqual({
      nombre: 2,
      ecritures: [3, 9].map((numero) => ({
        numero: `EL2026-000${numero}`, exercice: 2026, date: '2026-12-31', extourne_au: numero === 3 ? '2027-01-01' : null, piece_citee: numero === 3,
        lignes: [
          { compte: '622600', sens: 'debit', montant: 300, poste_2035: 'Honoraires rétrocédés' },
          { compte: '658900', sens: 'debit', montant: 10, poste_2035: 'hors de la 2035' },
          { compte: '471900', sens: 'credit', montant: 310 },
        ],
      })),
      lignes_de_resultat_hors_de_la_2035: 2,
    })
    // En engagement, aucun poste ; un exercice demandé ne garde que les siennes.
    const engagement = copie.ecrituresLibresVuesParLeModele(crues, 'engagement', 2026)
    expect(JSON.stringify(engagement)).not.toContain('poste_2035')
    expect(engagement).not.toHaveProperty('lignes_de_resultat_hors_de_la_2035')
    expect(copie.ecrituresLibresVuesParLeModele(crues, 'tresorerie', 2025)).toEqual({ nombre: 0, ecritures: [], lignes_de_resultat_hors_de_la_2035: 0 })
  })

  it('le « hors de la 2035 » est celui des moteurs de l’application : une ligne de résultat sans poste', () => {
    const src = ecritureLibreDeLaLigne(enBase(), D)!
    const resultat = lignesDeResultatLibres({ etat: 'lues', ecritures: [src], auteurs: new Map() }).filter((l) => !l.extourne)
    const vue = copie.ecrituresLibresVuesParLeModele(copie.ecrituresLibresCrues([enBase()], D)!, 'tresorerie', null) as { ecritures: { lignes: { compte: string; poste_2035?: string }[] }[] }
    for (const l of resultat) {
      expect(vue.ecritures[0].lignes.find((x) => x.compte === l.compte)?.poste_2035).toBe(l.poste ?? 'hors de la 2035')
    }
    expect(vue.ecritures[0].lignes.filter((x) => x.poste_2035 !== undefined)).toHaveLength(resultat.length)
  })
})

describe('le bloc ÉCRITURES LIBRES sait encore échouer', () => {
  const crues = (c: Copie) => c.ecrituresLibresCrues([enBase()], D)
  const juge = (c: Copie): string[] => {
    const fautes: string[] = []
    try {
      if (c.numeroDeLEcritureLibre(2026, 3) !== 'EL2026-0003') fautes.push('numéro')
      if (c.ligneLibreCrue({ compte: '822600', sens: 'debit', centimes: 1 }) !== null) fautes.push('classe 8')
      if (c.ligneLibreCrue({ compte: '622600', sens: 'debit', centimes: 0 }) !== null) fautes.push('centimes nuls')
      if (c.ecrituresLibresCrues([enBase({ dossier_id: 'autre' })], D) !== null) fautes.push('autre dossier')
      if (c.ecrituresLibresCrues([enBase({ date: '2025-12-31' })], D) !== null) fautes.push('autre exercice')
      const vue = JSON.stringify(c.ecrituresLibresVuesParLeModele(crues(c) ?? [], 'tresorerie', null))
      if (JSON.stringify(crues(c)).includes(SAISI)) fautes.push('relue avec un texte saisi')
      if (vue.includes(SAISI) || !vue.includes('"hors de la 2035"') || !vue.includes('"extourne_au":"2027-01-01"') || !/"montant":300[,}]/.test(vue)) fautes.push('vue')
      if (JSON.stringify(c.ecrituresLibresVuesParLeModele(crues(c) ?? [], 'tresorerie', 2025)).includes('EL2026')) fautes.push('exercice')
    } catch {
      fautes.push('lève')
    }
    return fautes
  }
  it('la vraie source ne rend aucune faute', () => expect(juge(copieDe(sourceDeployee()))).toEqual([]))
  const DERIVES: readonly (readonly [string, string, string])[] = [
    ['numeroDeLEcritureLibre : trois chiffres', '  return `EL${exercice}-${String(numero).padStart(4, "0")}`\n}\n\n// Une ligne de la colonne',
      '  return `EL${exercice}-${String(numero).padStart(3, "0")}`\n}\n\n// Une ligne de la colonne'],
    ['ligneLibreCrue : toute classe acceptée', '!/^[1-7][0-9]{5,9}$/.test(l.compte)) return null\n  if (l.sens !== "debit" && l.sens !== "credit") return null\n  if (typeof l.centimes',
      '!/^[0-9]{6,10}$/.test(l.compte)) return null\n  if (l.sens !== "debit" && l.sens !== "credit") return null\n  if (typeof l.centimes'],
    ['ligneLibreCrue : des centimes nuls acceptés', ' || l.centimes <= 0) return null', ' || l.centimes < 0) return null'],
    ['ligneLibreCrue : le libellé du compte recopié', '  return { compte: l.compte, sens: l.sens, centimes: l.centimes, poste_2035: poste as string | null }',
      '  return { compte: l.compte, sens: l.sens, centimes: l.centimes, poste_2035: poste as string | null, compte_lib: lib } as LigneLibreDuModele'],
    ['ecrituresLibresCrues : une écriture d’un autre dossier crue', ' || r.dossier_id !== dossierId) return null', ') return null'],
    ['ecrituresLibresCrues : une date d’un autre exercice crue', ' || Number(r.date.slice(0, 4)) !== r.exercice) return null\n    if (typeof r.avec_extourne', ') return null\n    if (typeof r.avec_extourne'],
    ['ecrituresLibresVuesParLeModele : le poste nul tu', '{ poste_2035: l.poste_2035 ?? "hors de la 2035" }', '{ poste_2035: l.poste_2035 }'],
    ['ecrituresLibresVuesParLeModele : l’extourne oubliée', 'extourne_au: e.avec_extourne ? `${e.exercice + 1}-01-01` : null', 'extourne_au: null'],
    ['ecrituresLibresVuesParLeModele : le montant en centimes', 'montant: l.centimes / 100,', 'montant: l.centimes,'],
    ['ecrituresLibresVuesParLeModele : l’exercice demandé ignoré', '  const retenues = annee === null ? ecritures : ecritures.filter((e) => e.exercice === annee)', '  const retenues = ecritures'],
  ]
  for (const [quoi, avant, apres] of DERIVES) {
    it(`attrape ${quoi}`, () => {
      const source = sourceDeployee()
      const bloc = bornes(source)
      expect(bloc.split(avant).length - 1, `ancre : ${avant.slice(0, 60)}`).toBe(1)
      expect(juge(copieDe(source.replace(bloc, bloc.replace(avant, apres)))).length).toBeGreaterThan(0)
    })
  }
  it('chaque fonction du bloc porte au moins une dérive plantée', () => {
    for (const nom of NOMS) expect(DERIVES.map(([q]) => q.split(' : ')[0]), nom).toContain(nom)
  })
})

describe('agent-comptable en HTTP : les écritures libres (EL6)', () => {
  const contrat = CONTRATS.find((c) => c.slug === 'agent-comptable')!
  const contexte: Contexte = { entetesDuNavigateur: [] }

  it('les scénarios du contrat sont dans le contrat de l’assistant', () => {
    expect(SCENARIOS_DES_ECRITURES_LIBRES.length).toBe(4)
    for (const s of SCENARIOS_DES_ECRITURES_LIBRES) expect(contrat.scenarios).toContain(s)
  })

  for (const scenario of SCENARIOS_DES_ECRITURES_LIBRES) {
    it(scenario.nom, async () => {
      expect(await jugerScenario(contrat, scenario, contexte)).toEqual([])
    })
  }

  // Les fautes que les mondes doivent attraper, plantées dans la vraie source.
  const [tresorerie, , partielle] = SCENARIOS_DES_ECRITURES_LIBRES
  const LECTURE = 'ctx.appelant.from("ecritures_libres").select("id, dossier_id, exercice, numero, date, lignes, avec_extourne, piece_citee_id"'
  const MUTATIONS: readonly (readonly [string, typeof tresorerie, readonly (readonly [string, string])[]])[] = [
    ['la lecture au jeton du service', tresorerie, [[LECTURE, LECTURE.replace('ctx.appelant.', 'admin.')]]],
    ['le libellé lu et rendu au modèle', tresorerie, [
      [LECTURE, LECTURE.replace('numero, date,', 'numero, date, libelle,')],
      ['    return { ecritures_libres: "lues", ...ecrituresLibresVuesParLeModele(crues, ctx.modele.mode, annee) }',
        '    return { ecritures_libres: "lues", libelles: r.lignes.map((l) => l.libelle), ...ecrituresLibresVuesParLeModele(crues, ctx.modele.mode, annee) }'],
    ]],
    ['les lignes lues rendues telles quelles (le libellé d’un compte)', tresorerie, [[
      '    return { ecritures_libres: "lues", ...ecrituresLibresVuesParLeModele(crues, ctx.modele.mode, annee) }',
      '    return { ecritures_libres: "lues", ...ecrituresLibresVuesParLeModele(crues, ctx.modele.mode, annee), brutes: r.lignes.map((l) => l.lignes) }']]],
    ['une lecture partielle crue', partielle, [['    const crues = r.complete ? ecrituresLibresCrues(r.lignes, dossierId) : null', '    const crues = ecrituresLibresCrues(r.lignes, dossierId)']]],
    ['la ligne d’une écriture libre nommée par son libellé', tresorerie, [[
      '{ libelle: libelleDUneLigneLibre(ligne), source: "ecriture_libre" }', '{ libelle: libelleDuBrouillon(ligne), source: "ecriture_libre" }']]],
  ]
  for (const [quoi, scenario, remplacements] of MUTATIONS) {
    it(`attrape ${quoi}`, async () => {
      expect((await jugerScenario(contrat, scenario, contexte, muter(sourceDeployee(), remplacements))).length).toBeGreaterThan(0)
    })
  }

  it('le marqueur est bien planté dans le monde : sans le passage, il parviendrait au modèle', () => {
    expect(MARQUEUR_DES_ECRITURES_LIBRES.length).toBeGreaterThan(5)
  })
})
