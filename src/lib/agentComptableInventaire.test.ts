import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { INVENTAIRE_EXPORTE } from './inventaire'
import * as validation from './inventaireDeLaValidation'
import * as controles from './inventaireDesControles'
import type { NatureOperationInventaire } from './types'
import {
  CONTRATS, MARQUEUR_DE_L_INVENTAIRE, TABLES_DE_L_INVENTAIRE, ceQueLeModeleARecuDeLInventaire, jouerScenario, scenarioDeLInventaire,
  type Contexte,
} from '../test/contratsFonctions'
import type { Monde } from '../test/fonctionsEdge'

// L'INVENTAIRE DANS L'ASSISTANT (ligne 35, lot INV7 ; docs/conceptions/35-inventaire.md, § 5.6).
//
// `agent-comptable` est auto-portée : elle recopie entre les bornes `── DÉBUT/FIN INVENTAIRE` les juges de l'inventaire
// (src/lib/inventaireDeLaValidation.ts) et les trois points de la Vue d'ensemble (src/lib/inventaireDesControles.ts), et redit
// le drapeau `INVENTAIRE_EXPORTE` de src/lib/inventaire.ts. Ce garde :
//   1. confronte le drapeau de la copie à celui de src/lib, et la copie à src/lib sur une batterie de régularisations — toutes
//      les natures, reprises ou non, avec ou sans TVA, des provisions, leurs écritures justes ou dérivées d'un centime, d'une
//      ligne, d'un jour, d'un sens, la TVA sur un sous-compte —, puis plante des dérives dans la vraie source pour prouver
//      qu'il sait encore échouer ;
//   2. joue l'assistant en HTTP, LEVÉ (la source au drapeau levé, la base des migrations préparées) : en engagement, l'outil
//      offert, ses lectures au jeton de l'appelant, ses points, et jamais l'objet d'une régularisation ni d'une provision au
//      modèle ; en trésorerie, rien de lu ni de dit ; illisible, rien de compté. Baissé, les deux scénarios du contrat
//      (src/test/contratsFonctions.ts, « INV7 ») tiennent l'assistant d'hier.
//
// CE QU'UNE DÉRIVE COÛTERAIT : l'assistant dirait « à jour » une régularisation que la validation refusera, ou « à recomposer »
// une écriture juste, à un comptable qui n'ira pas vérifier ; ou il dirait au modèle le nom d'un client qu'un objet porte.

function sourceDeployee(): string {
  return readFileSync(new URL('../../supabase/functions/agent-comptable/index.ts', import.meta.url), 'utf8')
}

function bornes(source: string, nom: string): string {
  const debut = source.indexOf(`// ── DÉBUT ${nom}`)
  const fin = source.indexOf(`// ── FIN ${nom}`)
  expect(debut, `bornes du bloc ${nom} introuvables`).toBeGreaterThan(-1)
  expect(fin).toBeGreaterThan(debut)
  return source.slice(debut, fin)
}

type Operation = validation.OperationDeLaValidation & { piece_citee_id: string | null }
type Ligne = { date: string; compte: string; sens: 'debit' | 'credit'; montant: number; operation_inventaire_id: string | null }
type Provision = validation.ProvisionDeLaValidation & { genre: string }
type Lu = { etat: 'lu'; operations: Operation[]; declarations: validation.DeclarationDeLaValidation[]; provisions: Provision[]; lignes: Ligne[] }

interface Copie {
  INVENTAIRE_EXPORTE: boolean
  ciblePrecedente: typeof validation.ciblePrecedente
  lignesCommandees: typeof validation.lignesCommandees
  regularisationAJour: (o: Operation, b: readonly Ligne[], c: number | null) => boolean
  extourneEntiere: (o: Operation, b: readonly Ligne[]) => boolean
  pointsDeLInventaire: (i: Lu, validees: readonly number[], annee: number, premier: number | null) => controles.PointsDeLInventaire
  premierExerciceDuDossier: typeof controles.premierExerciceDuDossier
  cleDeLInventaire: (i: Lu | { etat: 'sans_objet' } | { etat: 'illisible'; motif: string }, v: readonly number[], a: number, p: number | null) => unknown
  inventaireVuParLeModele: (i: Lu, v: readonly number[], annee: number | null) => Record<string, unknown>
}

function copieDe(source: string): Copie {
  const js = ts.transpileModule(bornes(source, 'INVENTAIRE'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return new Function(`${js}\nreturn { INVENTAIRE_EXPORTE, ciblePrecedente, lignesCommandees, regularisationAJour, extourneEntiere, `
    + 'pointsDeLInventaire, premierExerciceDuDossier, cleDeLInventaire, inventaireVuParLeModele }')() as Copie
}

/** Une dérive plantée dans la vraie source : l'ancre doit y être une seule fois, et DANS le bloc. */
function planter(source: string, avant: string, apres: string): string {
  const bloc = bornes(source, 'INVENTAIRE')
  expect(bloc.split(avant).length - 1, `ancre à planter introuvable ou ambiguë dans le bloc : ${avant}`).toBe(1)
  return source.replace(bloc, bloc.replace(avant, apres))
}

// ── La batterie ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const COMPTES: Readonly<Record<NatureOperationInventaire, [string, string]>> = {
  cca: ['616000', '486000'], pca: ['706000', '487000'], fnp: ['604000', '408100'], fae: ['706000', '418100'],
  charge_a_payer: ['641200', '428200'], produit_a_recevoir: ['758000', '448200'], provision: ['681500', '151100'],
}
const NATURES = Object.keys(COMPTES) as NatureOperationInventaire[]
const PROVISION = 'f0000000-0000-4000-8000-0000000000a1'

function operation(i: number, nature: NatureOperationInventaire, o: Partial<Operation> = {}): Operation {
  const [compte_resultat, compte_regularisation] = COMPTES[nature]
  return {
    id: `f0000000-0000-4000-8000-${String(i).padStart(12, '0')}`, exercice: 2025, nature, compte_resultat, compte_regularisation,
    montant_centimes: 12345 + i, tva_centimes: nature === 'fnp' || nature === 'fae' ? 2469 : 0, objet: 'objet de la batterie',
    reprise: false, provision_id: nature === 'provision' ? PROVISION : null, piece_citee_id: null, ...o,
  }
}

/** Les lignes justes d'une régularisation (src/lib), puis leurs dérives : chacune jugée par la copie comme par src/lib. */
function brouillonsDe(o: Operation, cible: number | null): Ligne[][] {
  const justes = (validation.lignesCommandees(o, cible) ?? []).map((l): Ligne => ({
    date: l.date, compte: l.compte, sens: l.sens, montant: l.centimes / 100, operation_inventaire_id: o.id,
  }))
  const variantes: Ligne[][] = [justes, [], justes.slice(1), [...justes, justes[0]].filter(Boolean)]
  justes.forEach((l, k) => {
    const avec = (x: Partial<Ligne>) => justes.map((y, j) => (j === k ? { ...y, ...x } : y))
    variantes.push(avec({ montant: l.montant + 0.01 }), avec({ date: '2025-12-30' }), avec({ sens: l.sens === 'debit' ? 'credit' : 'debit' }))
    if (/^4458[67]/.test(l.compte)) variantes.push(avec({ compte: `${l.compte.slice(0, 5)}1` }))
    variantes.push(avec({ operation_inventaire_id: 'f0000000-0000-4000-8000-ffffffffffff' }))
  })
  return variantes
}

function operationsDeLaBatterie(): Operation[] {
  let i = 0
  const ops: Operation[] = []
  for (const nature of NATURES) {
    ops.push(operation(++i, nature))
    if (nature !== 'provision') ops.push(operation(++i, nature, { reprise: true }))
    if (nature === 'fnp' || nature === 'fae') ops.push(operation(++i, nature, { tva_centimes: 0 }))
  }
  // Une provision évaluée deux années de suite : la seconde s'écrit à l'écart de la première, vers le haut puis le bas.
  ops.push(operation(++i, 'provision', { exercice: 2026, montant_centimes: 20000 }), operation(++i, 'provision', { exercice: 2027, montant_centimes: 20000 }))
  return ops
}

const PROVISIONS: Provision[] = [{ id: PROVISION, genre: 'risque', compte_provision: '151100', reprise_centimes: 5000 }]

/** Les écarts entre la copie d'une source et src/lib, sur toute la batterie. */
function ecarts(source: string): string[] {
  const c = copieDe(source)
  const sortie: string[] = []
  const ops = operationsDeLaBatterie()
  for (const o of ops) {
    for (const provisions of [PROVISIONS, [] as Provision[]]) {
      const cible = validation.ciblePrecedente(o, ops, provisions)
      if (c.ciblePrecedente(o, ops, provisions) !== cible) sortie.push(`ciblePrecedente ${o.id}`)
      if (JSON.stringify(c.lignesCommandees(o, cible)) !== JSON.stringify(validation.lignesCommandees(o, cible))) sortie.push(`lignesCommandees ${o.id}`)
      for (const [k, b] of brouillonsDe(o, cible).entries()) {
        if (c.regularisationAJour(o, b, cible) !== validation.regularisationAJour(o, b, cible)) sortie.push(`regularisationAJour ${o.id} #${k}`)
        if (c.extourneEntiere(o, b) !== validation.extourneEntiere(o, b)) sortie.push(`extourneEntiere ${o.id} #${k}`)
      }
    }
  }
  // Les points : sur des exercices validés, des déclarations et des brouillons différents.
  const lignesJustes = ops.flatMap((o) => brouillonsDe(o, validation.ciblePrecedente(o, ops, PROVISIONS))[0])
  const brouillons: Ligne[][] = [lignesJustes, [], lignesJustes.filter((l) => l.date !== '2026-01-01'), lignesJustes.slice(3)]
  const declarations: validation.DeclarationDeLaValidation[][] = [
    [], [{ id: 'd1', exercice: 2025, retire_le: null }], [{ id: 'd1', exercice: 2025, retire_le: '2026-02-01T10:00:00Z' }, { id: 'd2', exercice: 2024, retire_le: null }],
  ]
  for (const lignes of brouillons) {
    for (const decl of declarations) {
      for (const validees of [[], [2025], [2024, 2025], [2026]]) {
        for (const premier of [null, 2023, 2025]) {
          for (const annee of [2025, 2026, 2028]) {
            const lu: Lu = { etat: 'lu', operations: ops, declarations: decl, provisions: PROVISIONS, lignes }
            const attendu = controles.pointsDeLInventaire({ inventaire: lu, brouillon: lignes, anneesValidees: validees, anneeCourante: annee, premierExercice: premier })
            if (JSON.stringify(c.pointsDeLInventaire(lu, validees, annee, premier)) !== JSON.stringify(attendu)) {
              sortie.push(`pointsDeLInventaire ${JSON.stringify({ validees, premier, annee, d: decl.length, l: lignes.length })}`)
            }
          }
        }
      }
    }
  }
  for (const [a, b] of [[[], []], [[{ date: '2024-01-01' }], [{ date: '2023-05-01' }]], [[], [{ date: '2026-03-01' }, { date: '2025-12-31' }]]] as const) {
    if (c.premierExerciceDuDossier(a, b) !== controles.premierExerciceDuDossier(a, b)) sortie.push('premierExerciceDuDossier')
  }
  return sortie
}

describe('agent-comptable : la copie de l’inventaire (bloc INVENTAIRE, INV7)', () => {
  it('le drapeau de la copie est celui de src/lib/inventaire.ts', () => {
    expect(copieDe(sourceDeployee()).INVENTAIRE_EXPORTE).toBe(INVENTAIRE_EXPORTE)
    expect(sourceDeployee().match(/^const INVENTAIRE_EXPORTE = (true|false)$/gm)).toHaveLength(1)
  })

  it('juge comme src/lib chaque régularisation de la batterie, ses écritures justes ou dérivées, et les trois points', () => {
    expect(ecarts(sourceDeployee())).toEqual([])
  })

  it('la batterie n’est pas vide : chaque nature, des écritures à jour et d’autres non, des points dits', () => {
    const ops = operationsDeLaBatterie()
    expect(new Set(ops.map((o) => o.nature)).size).toBe(7)
    const jugements = ops.flatMap((o) => brouillonsDe(o, validation.ciblePrecedente(o, ops, PROVISIONS))
      .map((b) => validation.regularisationAJour(o, b, validation.ciblePrecedente(o, ops, PROVISIONS))))
    expect(jugements.filter(Boolean).length).toBeGreaterThanOrEqual(15)
    expect(jugements.filter((x) => !x).length).toBeGreaterThanOrEqual(100)
  })

  it.each([
    ['la racine de la TVA d’attente d’une facture non parvenue', 'fnp: "44586"', 'fnp: "44585"'],
    ['l’extourne d’une provision écrite', '    ...(o.nature === "provision" ? []\n', '    ...(false ? []\n'],
    ['la reprise qui écrit aussi sa constatation', '    ...(o.reprise ? [] : constatees', '    ...(false ? [] : constatees'],
    ['un centime arrondi autrement', 'Math.round(montant * 100)', 'Math.floor(montant * 100)'],
    ['l’exercice en cours compté comme clos', 'exercice < anneeCourante; exercice++', 'exercice <= anneeCourante; exercice++'],
    ['une déclaration retirée comptée', 'd.exercice === exercice && d.retire_le === null', 'd.exercice === exercice'],
    ['la cible précédente prise sur le même exercice', 'o.exercice < operation.exercice', 'o.exercice <= operation.exercice'],
  ])('sait encore échouer : %s', (_quoi, avant, apres) => {
    expect(ecarts(planter(sourceDeployee(), avant, apres)).length).toBeGreaterThan(0)
  })
})

describe('agent-comptable : ce que le modèle reçoit de l’inventaire (inventaireVuParLeModele, cleDeLInventaire)', () => {
  const c = copieDe(sourceDeployee())
  const ops = operationsDeLaBatterie()
  const lu: Lu = { etat: 'lu', operations: ops, declarations: [{ id: 'd1', exercice: 2025, retire_le: null }], provisions: PROVISIONS, lignes: [] }

  it('ni l’objet ni un identifiant : la nature, les comptes, les montants en euros, et le numéro d’une provision', () => {
    const vue = JSON.stringify(c.inventaireVuParLeModele(lu, [2025], null))
    expect(vue).not.toContain('objet de la batterie')
    expect(vue).not.toMatch(/f0000000-/)
    expect(vue).toContain('"montant":123.46')
    expect(vue).toContain('"provision":1')
    expect(vue).toContain('"inventaire_declare":true')
    expect(vue).toContain('"exercice_valide":true')
  })

  it('un seul exercice demandé, un seul rendu', () => {
    const vue = c.inventaireVuParLeModele(lu, [], 2026) as { exercices: { exercice: number }[] }
    expect(vue.exercices.map((e) => e.exercice)).toEqual([2026])
  })

  it('sans objet, aucune clé ; illisible, « indisponible : … » et rien de compté', () => {
    expect(c.cleDeLInventaire({ etat: 'sans_objet' }, [], 2026, 2025)).toBeNull()
    expect(c.cleDeLInventaire({ etat: 'illisible', motif: 'les provisions : coupée' }, [], 2026, 2025)).toBe('indisponible : les provisions : coupée')
    expect(c.cleDeLInventaire(lu, [], 2027, 2025)).toEqual({
      exercices_clos_dont_l_inventaire_n_est_pas_declare: [2026],
      // Sans aucune écriture, toutes sont à recomposer, sauf l'évaluation de 2027 : sa cible égale celle de 2026, aucun écart à écrire.
      regularisations_dont_les_ecritures_ne_sont_plus_a_jour: { nombre: ops.length - 1, exercices: [2025, 2026] },
      regularisations_d_un_exercice_valide_sans_leur_extourne_entiere: { nombre: 0, exercices: [] },
    })
  })
})

// ── L'assistant en HTTP, le drapeau levé ────────────────────────────────────────────────────────────────────────────────

const contexte: Contexte = { entetesDuNavigateur: [] }
const contrat = CONTRATS.find((x) => x.slug === 'agent-comptable')!
const SOURCE_LEVEE = sourceDeployee().replace(/^const INVENTAIRE_EXPORTE = false$/m, 'const INVENTAIRE_EXPORTE = true')

async function levee(mode: 'engagement' | 'tresorerie', apres?: (m: Monde) => void) {
  const scenario = scenarioDeLInventaire('levé', mode, () => [])
  const { monde, r } = await jouerScenario(contrat, scenario, contexte, {
    source: SOURCE_LEVEE, apres: (m) => { m.schemaPrepare = true; apres?.(m) },
  })
  const lues = monde.journal.filter((e): e is Extract<typeof e, { genre: 'lecture' }> => e.genre === 'lecture')
  return { r, monde, recu: ceQueLeModeleARecuDeLInventaire(monde), lues }
}

describe('agent-comptable en HTTP, le drapeau de l’inventaire levé (INV7)', () => {
  it('la source levée diffère de la vraie par le seul drapeau', () => {
    expect(SOURCE_LEVEE).not.toBe(sourceDeployee())
    expect(SOURCE_LEVEE.replace('const INVENTAIRE_EXPORTE = true', 'const INVENTAIRE_EXPORTE = false')).toBe(sourceDeployee())
  })

  it('en engagement : l’outil offert, l’inventaire du dossier rendu sans objet, ses points dits', async () => {
    const { r, recu } = await levee('engagement')
    expect(r.statut).toBe(200)
    expect(recu.offerts).toContain('lister_inventaire')
    const inventaire = recu.resultats.inventaire as { inventaire: string; exercices: { exercice: number; inventaire_declare: boolean; regularisations: Record<string, unknown>[] }[]; provisions: unknown[] }
    expect(inventaire.inventaire).toBe('lu')
    expect(inventaire.exercices.map((e) => [e.exercice, e.inventaire_declare])).toEqual([[2024, true], [2025, false]])
    const de2025 = inventaire.exercices[1].regularisations
    expect(de2025.map((o) => [o.nature, o.a_jour, o.piece_citee])).toEqual([['cca', true, true], ['fnp', false, false], ['provision', true, false]])
    expect(de2025[1]).toMatchObject({ compte_resultat: '604000', compte_regularisation: '408100', montant: 500, tva_d_attente: 100 })
    expect(inventaire.provisions).toEqual([{ numero: 1, genre: 'risque', compte_provision: '151100', part_reprise_d_une_balance: null }])
    const points = recu.resultats.points as { inventaire: Record<string, unknown> }
    expect(points.inventaire).toMatchObject({
      regularisations_dont_les_ecritures_ne_sont_plus_a_jour: { nombre: 1, exercices: [2025] },
      regularisations_d_un_exercice_valide_sans_leur_extourne_entiere: { nombre: 0, exercices: [] },
    })
    expect(points.inventaire.exercices_clos_dont_l_inventaire_n_est_pas_declare).toContain(2025)
  }, 60_000)

  it('ni l’objet d’une régularisation, ni celui d’une provision, ni le libellé de leurs écritures, ni le dossier voisin au modèle', async () => {
    const { recu } = await levee('engagement')
    expect(recu.demandes).not.toContain(MARQUEUR_DE_L_INVENTAIRE)
    expect(recu.demandes).not.toContain('999') // la régularisation du dossier voisin (999,00 €)
    // La ligne d'une écriture d'inventaire part sans libellé, et la description le dit.
    const ecritures = (recu.resultats.ecritures as { ecritures: { libelle: unknown; compte: string }[] }).ecritures
    expect(ecritures.filter((e) => e.compte === '486000').map((e) => e.libelle)).toEqual([null, null])
    expect(recu.demandes).toContain('Une ligne d\'une écriture d\'inventaire (journal OD')
  }, 60_000)

  it('les trois tables et les écritures d’inventaire se lisent au jeton de l’appelant, jamais par la clé du service', async () => {
    const { lues } = await levee('engagement')
    for (const table of TABLES_DE_L_INVENTAIRE) {
      const siennes = lues.filter((e) => e.table === table)
      expect(siennes.length, table).toBeGreaterThan(0)
      expect(siennes.every((e) => e.role === 'authentifie'), table).toBe(true)
    }
    expect(lues.some((e) => e.table === 'ecritures_brouillon' && e.role === 'authentifie')).toBe(true)
  }, 60_000)

  it('en trésorerie : rien de lu, l’outil dit « sans objet », points_a_traiter n’a pas la clé', async () => {
    const { r, recu, lues } = await levee('tresorerie')
    expect(r.statut).toBe(200)
    expect(lues.filter((e) => (TABLES_DE_L_INVENTAIRE as readonly string[]).includes(e.table))).toEqual([])
    expect(lues.some((e) => e.table === 'ecritures_brouillon' && e.role === 'authentifie')).toBe(false)
    expect(recu.resultats.inventaire).toEqual({ inventaire: 'sans_objet', raison: 'Ce dossier tient sa comptabilité en trésorerie : il n\'a pas d\'écritures d\'inventaire.' })
    expect('inventaire' in recu.resultats.points).toBe(false)
  }, 60_000)

  it('une ligne que les juges ne croiraient pas : l’outil refuse, la clé dit « indisponible », rien n’est compté', async () => {
    const { recu } = await levee('engagement', (m) => { (m.base.operations_inventaire![0] as Record<string, unknown>).montant_centimes = '120000' })
    expect(String((recu.resultats.inventaire as { erreur?: string }).erreur)).toContain('n\'a pas pu être lu en entier')
    expect((recu.resultats.points as { inventaire: unknown }).inventaire).toBe('indisponible : une ligne de l\'inventaire lue ne se croit pas')
  }, 60_000)

  it('une table coupée par une panne : « indisponible », jamais un inventaire vide', async () => {
    const { recu } = await levee('engagement', (m) => { m.pannes.push({ table: 'inventaires_declares', operation: 'select', fois: 10, erreur: { message: 'délai dépassé' } }) })
    expect((recu.resultats.points as { inventaire: unknown }).inventaire).toMatch(/^indisponible : les déclarations : .*délai dépassé$/)
    expect(String((recu.resultats.inventaire as { erreur?: string }).erreur)).toMatch(/\(les déclarations : .*délai dépassé\)/)
  }, 60_000)
})
