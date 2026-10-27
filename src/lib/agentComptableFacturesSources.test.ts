import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { beforeAll, describe, expect, it } from 'vitest'
import { reponseModele } from '../test/contratsFonctions'
import { entierTire, tirage } from '../test/encaissementsBatterie'
import { chargerFonction, ID, mondeDeReference, muter, prechauffer, requeteDe, sourceDe, type Monde } from '../test/fonctionsEdge'
import {
  exemplaireUnique, justifieSonMouvement, partsEncaissees, type EncaissementLu, type ExemplaireLu, type FactureDuDossier,
} from './encaissementsFactures'
import { exemplaireDUneSource, exemplairesDesSources, facturesSourcesDe, horsDesExemplairesDesSources } from './facturesSources'
import type { PartEncaissee } from './rattachement'
import type { FactureEmise, Piece } from './types'

// L'ASSISTANT ÉCARTE L'EXEMPLAIRE D'UNE FACTURE SOURCE, ET DATE CE QU'UN VIREMENT MIXTE PAIE (chantier EC-Q3, étape VF9b,
// ligne 28.65).
//
// `agent-comptable` est auto-portée : elle recopie, entre les bornes `── DÉBUT/FIN FACTURES SOURCES`, les quatre fonctions
// de src/lib/facturesSources.ts — l'exemplaire désigné d'une facture source ne compte nulle part —, et, entre les bornes
// `── DÉBUT/FIN VIREMENT MIXTE`, `partsEncaissees` et ce qu'elle appelle de src/lib/encaissementsFactures.ts — ce qu'un
// crédit classé par ses encaissements paie à l'exemplaire unique et validé d'une facture d'avant la bascule. Ce test garde
// les deux copies, de la forme de garde des autres blocs de l'assistant : extraire chaque bloc, le transpiler, l'exécuter
// SEUL (un nom qu'il emprunterait au reste du fichier lèverait), le confronter à src/lib sur une table de cas nommés et sur
// une batterie tirée d'une graine fixe, et planter dans la vraie source une dérive par fonction pour prouver qu'il sait
// encore échouer. `agentComptableAnalyse.test.ts` garde le générateur qui les reçoit ; ce fichier garde aussi, par le
// harnais HTTP, leur câblage dans `points_a_traiter` — derrière le refus de VF9a sous VF9b ; depuis VF9c, pour une source
// des ventes lue vraie, sans lui.
//
// CE QU'UNE DÉRIVE COÛTERAIT : sur un dossier basculé, l'assistant dirait « à régénérer » l'écriture juste de l'exemplaire
// qu'un virement mixte paie, réclamerait le compte de la catégorie ou la TVA de l'exemplaire d'une facture source — que sa
// facture compte —, et tairait le paiement en double d'une pièce, pendant que la Checklist dit le contraire.

function sourceDeployee(): string {
  return readFileSync(new URL('../../supabase/functions/agent-comptable/index.ts', import.meta.url), 'utf8')
}

type Bornes = readonly [debut: string, fin: string]
const FACTURES_SOURCES: Bornes = ['// ── DÉBUT FACTURES SOURCES', '// ── FIN FACTURES SOURCES']
const VIREMENT_MIXTE: Bornes = ['// ── DÉBUT VIREMENT MIXTE', '// ── FIN VIREMENT MIXTE']

/** Le texte d'un bloc, ses bornes exigées uniques : une borne en double ferait garder le mauvais morceau. */
function bloc(source: string, [debut, fin]: Bornes): string {
  expect(source.split(debut).length - 1, `« ${debut} » introuvable ou en double — garde-fou à remettre à jour`).toBe(1)
  expect(source.split(fin).length - 1, `« ${fin} » introuvable ou en double — garde-fou à remettre à jour`).toBe(1)
  const i = source.indexOf(debut)
  const j = source.indexOf(fin)
  expect(j, `« ${fin} » avant « ${debut} »`).toBeGreaterThan(i)
  return source.slice(i, j)
}

/** Un bloc transpilé puis exécuté SEUL, en mode strict : il ne voit rien du reste du fichier. */
function executer<T>(code: string, noms: readonly string[]): T {
  const js = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return new Function(`"use strict";\n${js}\nreturn { ${noms.join(', ')} }`)() as T
}

interface CopieSources {
  exemplaireDUneSource: typeof exemplaireDUneSource
  horsDesExemplairesDesSources: typeof horsDesExemplairesDesSources
  exemplairesDesSources: typeof exemplairesDesSources
  facturesSourcesDe: typeof facturesSourcesDe
}

// `compte`, `factureSource` et `ordreC` sont privées dans src/lib : elles se jugent par leurs effets sur les trois autres,
// et une dérive plantée dans chacune doit se voir là.
interface CopieMixte {
  justifieSonMouvement: typeof justifieSonMouvement
  exemplaireUnique: typeof exemplaireUnique
  partsEncaissees: typeof partsEncaissees
}

const NOMS_SOURCES = ['exemplaireDUneSource', 'horsDesExemplairesDesSources', 'exemplairesDesSources', 'facturesSourcesDe']
const NOMS_MIXTE = ['justifieSonMouvement', 'exemplaireUnique', 'partsEncaissees']

const copieSources = (source: string) => executer<CopieSources>(bloc(source, FACTURES_SOURCES), NOMS_SOURCES)
const copieMixte = (source: string) => executer<CopieMixte>(bloc(source, VIREMENT_MIXTE), NOMS_MIXTE)

const deployeeSources = copieSources(sourceDeployee())
const deployeeMixte = copieMixte(sourceDeployee())

// ── LES JEUX D'ESSAI ─────────────────────────────────────────────────────────────────────────────────────────────────

const D = 'dossier-a'
const AUTRE = 'dossier-b'

type FactureLue = Pick<FactureEmise, 'id' | 'statut' | 'source_de_la_vente'>
type PieceLue = Pick<Piece, 'id' | 'facture_id'>

const factureLue = (o: Partial<FactureLue>): FactureLue => ({ id: 'fs', statut: 'validee', source_de_la_vente: true, ...o })
const pieceLue = (o: Partial<PieceLue>): PieceLue => ({ id: 'p', facture_id: null, ...o })
const facture = (o: Partial<FactureDuDossier>): FactureDuDossier => ({
  id: 'fa', dossier_id: D, numero: null, type: 'facture', statut: 'validee', facture_origine_id: null, source_de_la_vente: false, ...o,
})
const encaissement = (o: Partial<EncaissementLu>): EncaissementLu => ({
  id: 'e1', dossier_id: D, facture_id: 'fa', montant: 120, ligne_bancaire_id: 'm1', annule_id: null, retire_le: null, ...o,
})
const exemplaire = (o: Partial<ExemplaireLu>): ExemplaireLu => ({
  id: 'p1', dossier_id: D, facture_id: 'fa', statut: 'validee', type_piece: 'vente', ...o,
})

/** Une part sous une forme comparable, montant compris : deux parts qui ne diffèrent que par lui doivent se distinguer. */
const formeParts = (parts: readonly PartEncaissee[]) => parts.map((p) => `${p.ligne_bancaire_id}|${p.piece_id}|${p.montant}`)

// ── LES FACTURES SOURCES : UNE TABLE DE CAS NOMMÉS ───────────────────────────────────────────────────────────────────

// Chaque cas : les factures lues, les pièces lues.
const CAS_SOURCES: [string, FactureLue[], PieceLue[]][] = [
  ['un dossier sans facture : rien n’est source, rien n’est écarté', [], [pieceLue({ id: 'p1', facture_id: 'fs' })]],
  ['l’exemplaire d’une facture source validée est écarté', [factureLue({})], [pieceLue({ id: 'p1', facture_id: 'fs' }), pieceLue({ id: 'p2' })]],
  ['une pièce désignée à une facture qui n’est pas source compte comme hier',
    [factureLue({ id: 'fa', source_de_la_vente: false })], [pieceLue({ id: 'p1', facture_id: 'fa' })]],
  // La base refuse un brouillon source (`factures_emises_source_d_une_facture_validee`) ; le filtre est refait ici.
  ['un brouillon marqué source ne l’est pas', [factureLue({ statut: 'brouillon' })], [pieceLue({ id: 'p1', facture_id: 'fs' })]],
  ['une pièce désignée à une facture que la lecture n’a pas rendue compte comme hier',
    [factureLue({})], [pieceLue({ id: 'p1', facture_id: 'inconnue' })]],
  ['deux factures sources, deux exemplaires, une pièce libre, dans l’ordre reçu',
    [factureLue({ id: 'fs2' }), factureLue({ id: 'fa', source_de_la_vente: false }), factureLue({ id: 'fs1' })],
    [pieceLue({ id: 'p3', facture_id: 'fs1' }), pieceLue({ id: 'p1' }), pieceLue({ id: 'p2', facture_id: 'fs2' }), pieceLue({ id: 'p4', facture_id: 'fa' })]],
]

/** Ce que les quatre fonctions disent d'un cas, sous une forme comparable — l'ordre compris : ce sont des filtres. */
function ditSources(copie: CopieSources, factures: readonly FactureLue[], pieces: readonly PieceLue[]): string[] {
  const sources = copie.facturesSourcesDe(factures)
  const gardees = copie.horsDesExemplairesDesSources(pieces, sources)
  return [
    `sources ${[...sources].join(',')}`,
    `exemplaire ${pieces.map((p) => copie.exemplaireDUneSource(p, sources)).join(',')}`,
    `gardées ${gardees.map((p) => p.id).join(',')}`,
    // Un filtre rend les MÊMES objets : l'appelant y relit tout ce que la pièce porte.
    `mêmes objets ${gardees.every((p) => pieces.includes(p))}`,
    `exemplaires ${[...copie.exemplairesDesSources(pieces, sources)].join(',')}`,
  ]
}

const ICI_SOURCES: CopieSources = { exemplaireDUneSource, horsDesExemplairesDesSources, exemplairesDesSources, facturesSourcesDe }

// ── LES FACTURES SOURCES : UNE BATTERIE TIRÉE D'UNE GRAINE FIXE ──────────────────────────────────────────────────────

const POOL_FACTURES = ['fa', 'fb', 'fc', 'fs', 'ft'] as const

interface CasSourcesTire { factures: FactureLue[]; pieces: PieceLue[] }

function batterieSources(nombre: number, graine: number): CasSourcesTire[] {
  const suivant = tirage(graine)
  const parmi = <T,>(liste: readonly T[]): T => liste[entierTire(suivant, liste.length)]
  const souvent = (p: number) => suivant() < p
  return Array.from({ length: nombre }, () => ({
    factures: POOL_FACTURES.filter(() => souvent(0.7)).map((id) => factureLue({
      id, statut: souvent(0.8) ? 'validee' : 'brouillon', source_de_la_vente: souvent(0.5),
    })),
    pieces: ['p0', 'p1', 'p2', 'p3', 'p4', 'p5'].filter(() => souvent(0.7)).map((id) => pieceLue({
      id, facture_id: souvent(0.3) ? null : parmi([...POOL_FACTURES, 'inconnue']),
    })),
  }))
}

const BATTERIE_SOURCES = batterieSources(600, 20261027)

const ecartsSources = (copie: CopieSources) => BATTERIE_SOURCES.flatMap((c, i) => {
  const la = ditSources(copie, c.factures, c.pieces)
  const ici = ditSources(ICI_SOURCES, c.factures, c.pieces)
  return la.some((x, k) => x !== ici[k]) ? [`cas ${i}`] : []
})

// ── LE VIREMENT MIXTE : UNE TABLE DE CAS NOMMÉS ──────────────────────────────────────────────────────────────────────

interface CasMixte { encaissements: EncaissementLu[]; factures: FactureDuDossier[]; exemplaires: ExemplaireLu[] }

const SOURCE = facture({ id: 'fs', source_de_la_vente: true })
const AVANT = facture({ id: 'fa' })
const SON_EXEMPLAIRE = exemplaire({ id: 'p1', facture_id: 'fa' })

const CAS_MIXTE: [string, CasMixte][] = [
  ['l’encaissement d’une facture d’avant paie son exemplaire unique et validé',
    { encaissements: [encaissement({})], factures: [SOURCE, AVANT], exemplaires: [SON_EXEMPLAIRE] }],
  ['celui d’une facture source ne paie rien : sa facture compte sa vente',
    { encaissements: [encaissement({ facture_id: 'fs' })], factures: [SOURCE, AVANT], exemplaires: [exemplaire({ facture_id: 'fs' })] }],
  ['une facture que la lecture n’a pas rendue n’est pas source',
    { encaissements: [encaissement({ facture_id: 'fx' })], factures: [SOURCE], exemplaires: [exemplaire({ facture_id: 'fx' })] }],
  ['un encaissement retiré ne paie rien',
    { encaissements: [encaissement({ retire_le: '2026-05-04T10:00:00Z' })], factures: [AVANT], exemplaires: [SON_EXEMPLAIRE] }],
  ['un encaissement sans mouvement ne paie rien',
    { encaissements: [encaissement({ ligne_bancaire_id: null })], factures: [AVANT], exemplaires: [SON_EXEMPLAIRE] }],
  ['un encaissement d’un autre dossier ne paie rien',
    { encaissements: [encaissement({ dossier_id: AUTRE })], factures: [AVANT], exemplaires: [SON_EXEMPLAIRE, exemplaire({ id: 'p9', dossier_id: AUTRE })] }],
  ['une annulation ne paie rien, même citant un mouvement',
    { encaissements: [encaissement({ id: 'e2', montant: -120, annule_id: 'e9' })], factures: [AVANT], exemplaires: [SON_EXEMPLAIRE] }],
  ['une contre-passation vivante sans mouvement défait l’encaissement',
    { encaissements: [encaissement({}), encaissement({ id: 'e2', montant: -120, ligne_bancaire_id: null, annule_id: 'e1' })], factures: [AVANT], exemplaires: [SON_EXEMPLAIRE] }],
  ['une contre-passation retirée ne défait rien',
    { encaissements: [encaissement({}), encaissement({ id: 'e2', montant: -120, ligne_bancaire_id: null, annule_id: 'e1', retire_le: '2026-05-04T10:00:00Z' })], factures: [AVANT], exemplaires: [SON_EXEMPLAIRE] }],
  // Le chèque revenu impayé : l'argent est venu, puis reparti — l'encaissement reste justifié par son crédit.
  ['une contre-passation qui cite un débit laisse l’encaissement justifié',
    { encaissements: [encaissement({}), encaissement({ id: 'e2', montant: -120, ligne_bancaire_id: 'd1', annule_id: 'e1' })], factures: [AVANT], exemplaires: [SON_EXEMPLAIRE] }],
  ['une facture sans exemplaire ne paie rien', { encaissements: [encaissement({})], factures: [AVANT], exemplaires: [] }],
  ['une facture à deux exemplaires ne paie rien',
    { encaissements: [encaissement({})], factures: [AVANT], exemplaires: [SON_EXEMPLAIRE, exemplaire({ id: 'p2' })] }],
  ['un exemplaire à valider n’est pas l’exemplaire validé',
    { encaissements: [encaissement({})], factures: [AVANT], exemplaires: [exemplaire({ statut: 'a_valider' })] }],
  ['un exemplaire qui n’est pas une pièce de vente ne compte pas',
    { encaissements: [encaissement({})], factures: [AVANT], exemplaires: [exemplaire({ type_piece: 'achat' })] }],
  ['l’exemplaire d’un autre dossier ne compte pas, et ne fait pas un second exemplaire',
    { encaissements: [encaissement({})], factures: [AVANT], exemplaires: [SON_EXEMPLAIRE, exemplaire({ id: 'p9', dossier_id: AUTRE })] }],
  // L'ordre de la base : le mouvement, la pièce, puis l'encaissement, octet par octet — « M » avant « a » avant « é »,
  // ce que `localeCompare` range autrement.
  ['plusieurs parts, dans l’ordre du mouvement, de la pièce, puis de l’encaissement, octet par octet',
    {
      encaissements: [
        encaissement({ id: 'e5', ligne_bancaire_id: 'é1', montant: 10 }),
        encaissement({ id: 'e4', ligne_bancaire_id: 'a1', facture_id: 'fb', montant: 20 }),
        encaissement({ id: 'e3', ligne_bancaire_id: 'a1', montant: 30 }),
        encaissement({ id: 'E2', ligne_bancaire_id: 'M1', montant: 40 }),
        encaissement({ id: 'e1', ligne_bancaire_id: 'M1', montant: 50 }),
      ],
      factures: [AVANT, facture({ id: 'fb' })],
      exemplaires: [exemplaire({ id: 'pb', facture_id: 'fb' }), exemplaire({ id: 'Pa', facture_id: 'fa' })],
    }],
]

const partsDe = (copie: Pick<CopieMixte, 'partsEncaissees'>, c: CasMixte) =>
  formeParts(copie.partsEncaissees(D, c.encaissements, { factures: c.factures }, c.exemplaires))

// ── LE VIREMENT MIXTE : UNE BATTERIE TIRÉE D'UNE GRAINE FIXE ─────────────────────────────────────────────────────────
// Des identifiants qui départagent l'ordre de la base de celui de `localeCompare` (casse, ponctuation, accent), deux
// dossiers, des factures que la lecture ne rend pas, des contre-passations avec et sans mouvement, des retraits.

const POOL_MOUVEMENTS = ['M1', 'm1', 'M2', 'a-1', '_m', 'Z9', 'é2'] as const
const POOL_PIECES = ['P1', 'p1', 'p2', 'Q', 'é1', 'P3', 'p_4', 'q5', 'Ö6', 'p-7', 'R8'] as const
const POOL_ENCAISSEMENTS = ['e1', 'E2', 'e_3', 'e-4', 'É5', 'e6', 'E7', 'e8'] as const

function batterieMixte(nombre: number, graine: number): CasMixte[] {
  const suivant = tirage(graine)
  const entier = (n: number) => entierTire(suivant, n)
  const parmi = <T,>(liste: readonly T[]): T => liste[entier(liste.length)]
  const souvent = (p: number) => suivant() < p
  return Array.from({ length: nombre }, () => {
    const factures = POOL_FACTURES.filter(() => souvent(0.8)).map((id) => facture({ id, source_de_la_vente: souvent(0.35) }))
    // Pour chaque facture, aucun exemplaire, un seul ou deux — chacun le plus souvent validé, de vente et du dossier —, et
    // parfois une pièce désignée à rien : l'exemplaire unique doit sortir souvent, et ses contraires aussi.
    const libres: string[] = [...POOL_PIECES]
    const piece = () => libres.splice(entier(libres.length), 1)[0]
    const exemplaires: ExemplaireLu[] = []
    for (const f of POOL_FACTURES) {
      const combien = parmi([0, 1, 1, 1, 2])
      for (let k = 0; k < combien; k++) {
        exemplaires.push(exemplaire({
          id: piece(),
          dossier_id: souvent(0.9) ? D : AUTRE,
          facture_id: f,
          statut: souvent(0.85) ? 'validee' : 'a_valider',
          type_piece: souvent(0.85) ? 'vente' : 'achat',
        }))
      }
    }
    if (souvent(0.3)) exemplaires.push(exemplaire({ id: piece(), facture_id: null }))
    // Deux ou trois mouvements par registre : deux encaissements d'une même facture s'y retrouvent souvent sur le même.
    const mouvements = [parmi(POOL_MOUVEMENTS), parmi(POOL_MOUVEMENTS), parmi(POOL_MOUVEMENTS)]
    const encaissements: EncaissementLu[] = []
    const n = entier(POOL_ENCAISSEMENTS.length + 1)
    for (let i = 0; i < n; i++) {
      const annulation = i > 0 && souvent(0.25)
      const montant = (1 + entier(50000)) / 100
      encaissements.push(encaissement({
        id: POOL_ENCAISSEMENTS[i],
        dossier_id: souvent(0.92) ? D : AUTRE,
        facture_id: parmi(POOL_FACTURES),
        montant: annulation ? -montant : montant,
        ligne_bancaire_id: annulation ? (souvent(0.5) ? null : parmi(mouvements)) : (souvent(0.85) ? parmi(mouvements) : null),
        annule_id: annulation ? encaissements[entier(encaissements.length)].id : null,
        retire_le: souvent(0.12) ? '2026-05-04T10:00:00Z' : null,
      }))
    }
    return { encaissements, factures, exemplaires }
  })
}

const BATTERIE_MIXTE = batterieMixte(1500, 20261028)

/** Les cas où la copie dit autre chose que src/lib : les parts, chaque encaissement justifié ou non, chaque exemplaire unique. */
function ecartsMixte(copie: CopieMixte, cas: readonly CasMixte[] = BATTERIE_MIXTE): string[] {
  return cas.flatMap((c, i) => {
    const ecarts: string[] = []
    if (JSON.stringify(partsDe(copie, c)) !== JSON.stringify(partsDe({ partsEncaissees }, c))) ecarts.push(`cas ${i} : les parts`)
    for (const e of c.encaissements) {
      if (copie.justifieSonMouvement(e, c.encaissements) !== justifieSonMouvement(e, c.encaissements)) ecarts.push(`cas ${i} : ${e.id} justifié`)
    }
    for (const dossier of [D, AUTRE]) {
      for (const f of POOL_FACTURES) {
        if (copie.exemplaireUnique(dossier, f, c.exemplaires) !== exemplaireUnique(dossier, f, c.exemplaires)) ecarts.push(`cas ${i} : exemplaire de ${f}`)
      }
    }
    return ecarts
  })
}

describe('agent-comptable / bloc FACTURES SOURCES (copie déployée, étape VF9b)', () => {
  it('n’est pas src/lib elle-même, et s’exécute seul : il n’emprunte rien au reste du fichier', () => {
    expect(deployeeSources.facturesSourcesDe).not.toBe(facturesSourcesDe)
    expect(deployeeSources.horsDesExemplairesDesSources).not.toBe(horsDesExemplairesDesSources)
    // Exécuté seul : chaque fonction appelée sur un cas qui la parcourt entière.
    const sources = deployeeSources.facturesSourcesDe([factureLue({})])
    expect(deployeeSources.exemplairesDesSources([pieceLue({ id: 'p1', facture_id: 'fs' })], sources)).toEqual(new Set(['p1']))
  })

  it('dit, sur chaque cas nommé, les mêmes sources, exemplaires et pièces qui comptent que src/lib', () => {
    for (const [cas, factures, pieces] of CAS_SOURCES) {
      expect(ditSources(deployeeSources, factures, pieces), cas).toEqual(ditSources(ICI_SOURCES, factures, pieces))
    }
  })

  it('la table exerce ce qui décide', () => {
    // Sans ces résultats attendus, deux copies muettes seraient « d'accord » sur des listes vides.
    expect(CAS_SOURCES.map(([, factures, pieces]) => ditSources(ICI_SOURCES, factures, pieces)[2])).toEqual([
      'gardées p1', 'gardées p2', 'gardées p1', 'gardées p1', 'gardées p1', 'gardées p1,p4',
    ])
    expect(ditSources(ICI_SOURCES, CAS_SOURCES[5][1], CAS_SOURCES[5][2])[0]).toBe('sources fs2,fs1')
    expect(ditSources(ICI_SOURCES, CAS_SOURCES[5][1], CAS_SOURCES[5][2])[4]).toBe('exemplaires p3,p2')
  })

  it('dit la même chose que src/lib sur une batterie de 600 dossiers tirés d’une graine fixe', () => {
    expect(ecartsSources(deployeeSources)).toEqual([])
  })

  it('la batterie exerce ce qui décide', () => {
    let ecartees = 0, designeesQuiComptent = 0, brouillonsMarques = 0, sansSource = 0
    for (const c of BATTERIE_SOURCES) {
      const sources = facturesSourcesDe(c.factures)
      if (sources.size === 0) sansSource++
      ecartees += c.pieces.length - horsDesExemplairesDesSources(c.pieces, sources).length
      designeesQuiComptent += c.pieces.filter((p) => p.facture_id != null && !exemplaireDUneSource(p, sources)).length
      // Un brouillon marqué source dont une pièce est désignée : seul le filtre du statut l'écarte des sources.
      brouillonsMarques += c.factures.filter((f) => f.statut === 'brouillon' && f.source_de_la_vente
        && c.pieces.some((p) => p.facture_id === f.id)).length
    }
    expect(ecartees).toBeGreaterThan(200)
    expect(designeesQuiComptent).toBeGreaterThan(400)
    expect(brouillonsMarques).toBeGreaterThan(50)
    expect(sansSource).toBeGreaterThan(30)
  })
})

describe('agent-comptable / bloc VIREMENT MIXTE (copie déployée, étape VF9b)', () => {
  it('n’est pas src/lib elle-même, et s’exécute seul : il n’emprunte rien au reste du fichier', () => {
    expect(deployeeMixte.partsEncaissees).not.toBe(partsEncaissees)
    expect(deployeeMixte.exemplaireUnique).not.toBe(exemplaireUnique)
    expect(partsDe(deployeeMixte, CAS_MIXTE[0][1])).toEqual(['m1|p1|120'])
  })

  it('dit, sur chaque cas nommé, les mêmes parts que src/lib', () => {
    for (const [cas, c] of CAS_MIXTE) expect(partsDe(deployeeMixte, c), cas).toEqual(partsDe({ partsEncaissees }, c))
  })

  it('la table exerce ce qui décide', () => {
    const attendu: Record<string, string[]> = {
      'l’encaissement d’une facture d’avant paie son exemplaire unique et validé': ['m1|p1|120'],
      'une facture que la lecture n’a pas rendue n’est pas source': ['m1|p1|120'],
      'une contre-passation retirée ne défait rien': ['m1|p1|120'],
      'une contre-passation qui cite un débit laisse l’encaissement justifié': ['m1|p1|120'],
      'l’exemplaire d’un autre dossier ne compte pas, et ne fait pas un second exemplaire': ['m1|p1|120'],
      'plusieurs parts, dans l’ordre du mouvement, de la pièce, puis de l’encaissement, octet par octet':
        ['M1|Pa|40', 'M1|Pa|50', 'a1|Pa|30', 'a1|pb|20', 'é1|Pa|10'],
    }
    for (const [cas, c] of CAS_MIXTE) expect(partsDe({ partsEncaissees }, c), cas).toEqual(attendu[cas] ?? [])
  })

  it('dit la même chose que src/lib sur une batterie de 1 500 registres tirés d’une graine fixe', () => {
    expect(ecartsMixte(deployeeMixte)).toEqual([])
  })

  it('la batterie exerce chaque filtre là où il décide seul, et l’ordre de la base', () => {
    // Pour chaque encaissement, ce qui l'écarte, jugé par src/lib : un filtre « décide seul » quand il est le seul à
    // l'écarter. Un filtre qui ne décide jamais seul ne serait pas gardé par la batterie.
    const seul: Record<string, number> = {
      'autre dossier': 0, 'sans mouvement': 0, annulation: 0, retiré: 0, source: 0, 'non justifié': 0, 'sans exemplaire unique': 0,
    }
    let parts = 0, ordreSensible = 0, memePaire = 0, exemplairesUniques = 0, exemplairesMultiples = 0
    const localeCompare = (a: string, b: string) => a.localeCompare(b)
    for (const c of BATTERIE_MIXTE) {
      for (const e of c.encaissements) {
        const raisons = Object.entries({
          'autre dossier': e.dossier_id !== D,
          'sans mouvement': e.ligne_bancaire_id == null,
          annulation: e.annule_id != null,
          retiré: e.retire_le != null,
          source: c.factures.some((f) => f.id === e.facture_id && f.source_de_la_vente),
          'non justifié': !justifieSonMouvement(e, c.encaissements),
          'sans exemplaire unique': exemplaireUnique(D, e.facture_id, c.exemplaires) === null,
        }).filter(([, vrai]) => vrai).map(([raison]) => raison)
        if (raisons.length === 1) seul[raisons[0]]++
      }
      const rendues = partsEncaissees(D, c.encaissements, { factures: c.factures }, c.exemplaires)
      parts += rendues.length
      const selonLaLocale = [...rendues].sort((a, b) => localeCompare(a.ligne_bancaire_id, b.ligne_bancaire_id) || localeCompare(a.piece_id, b.piece_id))
      if (JSON.stringify(selonLaLocale) !== JSON.stringify(rendues)) ordreSensible++
      if (new Set(rendues.map((p) => `${p.ligne_bancaire_id}|${p.piece_id}`)).size < rendues.length) memePaire++
      for (const f of POOL_FACTURES) {
        if (exemplaireUnique(D, f, c.exemplaires) !== null) exemplairesUniques++
        else if (c.exemplaires.filter((p) => p.facture_id === f).length > 1) exemplairesMultiples++
      }
    }
    // Des planchers, à la moitié environ de ce que la graine donne (relevé le 27/10/2026) : une batterie qui s'appauvrirait
    // en silence tomberait ici avant de laisser passer une dérive.
    for (const [raison, n] of Object.entries(seul)) expect(n, `le filtre « ${raison} » ne décide jamais seul`).toBeGreaterThan(40)
    expect(parts).toBeGreaterThan(500)
    expect(ordreSensible).toBeGreaterThan(60)
    expect(memePaire).toBeGreaterThan(40)
    expect(exemplairesUniques).toBeGreaterThan(1500)
    expect(exemplairesMultiples).toBeGreaterThan(400)
  })
})

describe('les gardes des blocs FACTURES SOURCES et VIREMENT MIXTE savent encore échouer', () => {
  // Une ancre qui figurerait deux fois ferait planter la dérive au mauvais endroit : `muter` l'exige unique.
  const planter = (avant: string, apres: string) => muter(sourceDeployee(), [[avant, apres]])

  const DERIVES_SOURCES: [string, string, string][] = [
    ['exemplaireDUneSource : toute pièce désignée passe pour l’exemplaire d’une source',
      '  return piece.facture_id != null && sources.has(piece.facture_id)\n', '  return piece.facture_id != null\n'],
    ['horsDesExemplairesDesSources : n’écarte plus rien',
      '  return pieces.filter((p) => !exemplaireDUneSource(p, sources))\n', '  return [...pieces]\n'],
    ['exemplairesDesSources : toute pièce désignée',
      '  return new Set(pieces.filter((p) => exemplaireDUneSource(p, sources)).map((p) => p.id))\n',
      '  return new Set(pieces.filter((p) => p.facture_id != null).map((p) => p.id))\n'],
    ['facturesSourcesDe : un brouillon marqué source l’est',
      'factures.filter((f) => f.statut === "validee" && f.source_de_la_vente === true)', 'factures.filter((f) => f.source_de_la_vente === true)'],
  ]
  for (const [quoi, avant, apres] of DERIVES_SOURCES) {
    it(`attrape ${quoi}`, () => {
      expect(ecartsSources(copieSources(planter(avant, apres))).length).toBeGreaterThan(0)
    })
  }

  const DERIVES_MIXTE: [string, string, string][] = [
    ['compte : un encaissement retiré compte',
      'const compte = (e: Pick<EncaissementRow, "retire_le">) => e.retire_le == null\n', 'const compte = (e: Pick<EncaissementRow, "retire_le">) => true\n'],
    ['justifieSonMouvement : une contre-passation qui cite un débit défait l’encaissement',
      'c.annule_id === e.id && compte(c) && c.ligne_bancaire_id == null)', 'c.annule_id === e.id && compte(c))'],
    ['factureSource : toute facture lue passe pour source',
      'vente.factures.some((f) => f.id === factureId && f.source_de_la_vente)', 'vente.factures.some((f) => f.id === factureId)'],
    ['ordreC : l’ordre de la locale au lieu de celui de la base',
      '  return a < b ? -1 : a > b ? 1 : 0\n', '  return a.localeCompare(b)\n'],
    ['exemplaireUnique : le premier de plusieurs exemplaires',
      'return siens.length === 1 ? siens[0].id : null', 'return siens.length >= 1 ? siens[0].id : null'],
    ['exemplaireUnique : l’exemplaire d’un autre dossier',
      'p.facture_id === factureId && p.dossier_id === dossierId && p.statut === "validee"', 'p.facture_id === factureId && p.statut === "validee"'],
    ['exemplaireUnique : un exemplaire à valider', ' && p.statut === "validee"\n    && p.type_piece === "vente")', '\n    && p.type_piece === "vente")'],
    ['exemplaireUnique : une pièce qui n’est pas de vente', '\n    && p.type_piece === "vente")', ')'],
    ['partsEncaissees : l’encaissement d’une facture source paie son exemplaire',
      '      || factureSource(e.facture_id, vente) || !justifieSonMouvement(e, encaissements)) continue',
      '      || !justifieSonMouvement(e, encaissements)) continue'],
    ['partsEncaissees : l’encaissement d’un autre dossier', 'if (e.dossier_id !== dossierId || e.ligne_bancaire_id == null', 'if (e.ligne_bancaire_id == null'],
    ['partsEncaissees : une annulation paie', '|| e.ligne_bancaire_id == null || e.annule_id != null || !compte(e)', '|| e.ligne_bancaire_id == null || !compte(e)'],
    ['partsEncaissees : un encaissement que sa contre-passation défait paie encore',
      '      || factureSource(e.facture_id, vente) || !justifieSonMouvement(e, encaissements)) continue',
      '      || factureSource(e.facture_id, vente)) continue'],
    ['partsEncaissees : l’ordre du registre au lieu de celui de la base',
      '    .sort((a, b) => ordreC(a.part.ligne_bancaire_id, b.part.ligne_bancaire_id) || ordreC(a.part.piece_id, b.part.piece_id)\n      || ordreC(a.encaissement, b.encaissement))\n',
      ''],
    ['partsEncaissees : deux encaissements d’une même pièce sur un même mouvement dans l’ordre reçu',
      '\n      || ordreC(a.encaissement, b.encaissement))\n', ')\n'],
  ]
  for (const [quoi, avant, apres] of DERIVES_MIXTE) {
    it(`attrape ${quoi}`, () => {
      expect(ecartsMixte(copieMixte(planter(avant, apres))).length).toBeGreaterThan(0)
    })
  }

  it('chaque fonction des deux blocs porte au moins une dérive plantée', () => {
    const visees = [...DERIVES_SOURCES, ...DERIVES_MIXTE].map(([quoi]) => quoi.split(' : ')[0])
    for (const nom of [...NOMS_SOURCES, ...NOMS_MIXTE, 'compte', 'factureSource', 'ordreC']) expect(visees, nom).toContain(nom)
  })
})

// ── LE CÂBLAGE DANS `points_a_traiter`, PAR LE HARNAIS HTTP ───────────────────────────────────────────────────────────
// La vraie source, chargée devant un monde factice (src/test/fonctionsEdge.ts) : le modèle, factice aussi, appelle
// `points_a_traiter`, puis répond. Un dossier qui n'a pas basculé ne lit rien de plus qu'hier. Sous VF9b, un dossier basculé
// était refusé avant toute lecture (VF9a), et ce que VF9b câblait derrière ce refus se jouait sur une copie EN MÉMOIRE dont
// le refus était levé ; VF9c l'a levé dans le fichier servi pour une source des ventes LUE vraie : ces cas se jouent sur la
// vraie source, et le refus, qui ne vaut plus que pour une source illisible, s'y juge à part.

const QUESTION = { dossierId: ID.dossier, message: 'Quels points restent à traiter ?' }
const MARQUEUR_CLIENT = 'Marqueur fictif du client des factures'

const N = {
  sansCompte: 'ca000000-0000-4000-8000-000000000001',
  ventes: 'ca000000-0000-4000-8000-000000000002',
  e1: 'b1000000-0000-4000-8000-000000000001',
  e2: 'b1000000-0000-4000-8000-000000000002',
  v: 'b1000000-0000-4000-8000-000000000003',
  v2: 'b1000000-0000-4000-8000-000000000004',
  fs1: 'f5000000-0000-4000-8000-000000000001',
  fs2: 'f5000000-0000-4000-8000-000000000002',
  fa: 'fa000000-0000-4000-8000-000000000001',
  fb: 'fa000000-0000-4000-8000-000000000002',
  brouillon: 'fa000000-0000-4000-8000-000000000003',
  mixte: 'ab000000-0000-4000-8000-000000000001',
  acompte: 'ab000000-0000-4000-8000-000000000002',
} as const

/**
 * Un dossier en trésorerie, assujetti, dont deux pièces de vente sont les exemplaires de factures SOURCES — l'une rangée
 * dans une catégorie sans compte ni poste, sans TVA lue —, et deux les exemplaires uniques de factures d'AVANT que paie un
 * virement mixte — un crédit classé par ses encaissements : la première écrite à la date du mouvement, la seconde déjà
 * payée par un acompte rapproché. Le registre porte aussi ce qui ne paie rien : un encaissement retiré, un autre
 * contre-passé sans mouvement. Et chaque exemplaire d'une source porte une écriture — sans banque ; déséquilibrée, sans
 * sa TVA — que la base refuse depuis VF6b (G4, `garder_exemplaire_d_une_source`) : l'assistant l'écarte sans la juger,
 * comme src/lib, et ce monde le prouve.
 */
function mondeDesVentes(bascule: boolean): Monde {
  const m = mondeDeReference()
  const D_ = ID.dossier
  const dossier = (m.base.dossiers ?? []).find((d) => d.id === D_)
  if (!dossier) throw new Error('le dossier du monde de référence a disparu')
  Object.assign(dossier, {
    mode_comptable: 'tresorerie', compte_notes_de_frais: '108000', assujetti_tva: true, statut_tva: 'redevable',
    article_exoneration: null, tva_periodicite: 'trimestrielle', ventes_par_les_factures: bascule,
    ventes_par_les_factures_depuis: bascule ? '2026-01-05T09:00:00+00:00' : null,
  })
  m.base.categories = [
    { id: N.sansCompte, dossier_id: D_, code: 'sans-compte', libelle: 'Catégorie fictive sans compte', compte_comptable: null, poste_2035: null },
    { id: N.ventes, dossier_id: D_, code: 'ventes', libelle: 'Ventes fictives', compte_comptable: '706000', poste_2035: 'AA' },
  ]
  const piece = (id: string, factureId: string, categorie: string, date: string, ht: number, tva: number | null) => ({
    id, dossier_id: D_, statut: 'validee', type_piece: 'vente', tiers: 'Client fictif', nom_fichier: `${id}.pdf`, date_piece: date,
    montant_ht: ht, montant_tva: tva, montant_ttc: ht + (tva ?? 20), categorie_id: categorie, facture_id: factureId,
    created_at: `${date}T08:00:00Z`,
  })
  m.base.pieces = [
    piece(N.e1, N.fs1, N.sansCompte, '2026-03-01', 100, null),
    piece(N.e2, N.fs2, N.ventes, '2026-03-05', 200, 40),
    piece(N.v, N.fa, N.ventes, '2026-02-10', 100, 20),
    piece(N.v2, N.fb, N.ventes, '2026-02-12', 50, 10),
  ]
  const ecriture = (pieceId: string, date: string, compte: string, sens: 'debit' | 'credit', montant: number, ligne: string | null = null) => ({
    id: `${pieceId.slice(0, 8)}-${compte}-${sens}`, dossier_id: D_, date, compte, libelle: 'Vente fictive', sens, montant,
    piece_id: pieceId, ligne_bancaire_id: ligne,
  })
  m.base.ecritures_brouillon = [
    ecriture(N.e1, '2026-03-01', '706000', 'credit', 120),
    ecriture(N.e2, '2026-03-05', '706000', 'credit', 240),
    ecriture(N.e2, '2026-03-05', '512000', 'debit', 200),
    ecriture(N.v, '2026-04-02', '706000', 'credit', 100),
    ecriture(N.v, '2026-04-02', '445710', 'credit', 20),
    ecriture(N.v, '2026-04-02', '512000', 'debit', 120, N.mixte),
  ].map((e, i) => ({ ...e, id: `ec000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}` }))
  const mouvement = (id: string, date: string, montant: number, o: Record<string, unknown>) => ({
    id, dossier_id: D_, date, libelle: 'VIR CLIENTS FICTIFS', montant, statut: 'rapprochee', piece_id: null, reglement_groupe: false,
    cotisation_id: null, categorie_id: null, compte_bilan: null, prelevement_personnel: false, emprunt_id: null, ventilee: false,
    encaissements_de_factures: false, declaration_tva_id: null, ...o,
  })
  m.base.lignes_bancaires = [
    mouvement(N.mixte, '2026-04-02', 420, { encaissements_de_factures: true }),
    mouvement(N.acompte, '2026-02-25', 60, { piece_id: N.v2 }),
  ]
  const factureEmise = (id: string, source: boolean, statut = 'validee') => ({
    id, dossier_id: D_, statut, type: 'facture', numero: statut === 'validee' ? `F-${id.slice(0, 4)}` : null, source_de_la_vente: source,
    facture_origine_id: null, tiers_nom: MARQUEUR_CLIENT,
  })
  m.base.factures_emises = [
    factureEmise(N.fs1, true), factureEmise(N.fs2, true), factureEmise(N.fa, false), factureEmise(N.fb, false),
    factureEmise(N.brouillon, false, 'brouillon'),
  ]
  const encaissementDe = (n: number, factureId: string, montant: number, o: Record<string, unknown> = {}) => ({
    id: `ef000000-0000-4000-8000-${String(n).padStart(12, '0')}`, dossier_id: D_, facture_id: factureId, montant,
    moyen: 'virement', date_encaissement: '2026-04-02', ligne_bancaire_id: N.mixte, annule_id: null, retire_le: null,
    cree_le: `2026-04-03T09:0${n}:00Z`, ...o,
  })
  m.base.encaissements_factures = [
    encaissementDe(1, N.fs2, 240),
    encaissementDe(2, N.fa, 120),
    encaissementDe(3, N.fb, 60),
    // Retiré : il ne paie rien.
    encaissementDe(4, N.fa, 999, { retire_le: '2026-04-04T09:00:00Z' }),
    // Contre-passé SANS mouvement avant le classement — une somme jamais reçue : il ne justifie plus le crédit, et ne paie
    // rien.
    encaissementDe(5, N.fa, 50),
    encaissementDe(6, N.fa, -50, { ligne_bancaire_id: null, annule_id: 'ef000000-0000-4000-8000-000000000005' }),
  ]
  return m
}

interface Partie {
  points: Record<string, unknown>
  demandes: unknown[]
  lues: { table: string; filtres: string[] }[]
}

/** Le modèle appelle `points_a_traiter`, puis répond ; ce que l'outil lui a rendu, ce qu'il a reçu, ce qui a été lu. */
async function jouer(monde: Monde, source: string): Promise<Partie> {
  const demandes: unknown[] = []
  let tour = 0
  monde.modele = (demande) => {
    demandes.push(demande)
    tour += 1
    if (tour > 1) return reponseModele('Voici les points.')
    return {
      content: [{ type: 'tool_use', id: 'points', name: 'points_a_traiter', input: {} }],
      stop_reason: 'tool_use', usage: { input_tokens: 10, output_tokens: 10 },
    }
  }
  const resultat = await chargerFonction('agent-comptable', monde, { source }).appeler(requeteDe('agent-comptable', { personne: 'chef', corps: QUESTION }))
  expect(resultat.statut, resultat.texte.slice(0, 300)).toBe(200)
  const blocs = (demandes[1] as { messages?: { content?: unknown }[] } | undefined)?.messages?.at(-1)?.content
  const rendu = Array.isArray(blocs) ? (blocs as { tool_use_id?: unknown; content?: unknown }[]).find((b) => b.tool_use_id === 'points') : undefined
  expect(typeof rendu?.content, 'points_a_traiter n’a rien rendu au modèle').toBe('string')
  return {
    points: JSON.parse(rendu?.content as string) as Record<string, unknown>,
    demandes,
    lues: monde.journal.flatMap((e) => (e.genre === 'lecture' ? [{ table: e.table, filtres: e.filtres }] : [])),
  }
}

/** Les clés que les factures sources et les virements mixtes changent, dans l'ordre où le tableau les compare. */
const clesDesVentes = (p: Record<string, unknown>) => ({
  ecritures_en_attente_de_rapprochement_bancaire: p.ecritures_en_attente_de_rapprochement_bancaire,
  ecritures_desequilibrees: p.ecritures_desequilibrees,
  ecritures_a_regenerer_pieces_modifiees: p.ecritures_a_regenerer_pieces_modifiees,
  categories_sans_compte_comptable: p.categories_sans_compte_comptable,
  categories_sans_poste_2035: p.categories_sans_poste_2035,
  pieces_validees_sans_tva_renseignee: p.pieces_validees_sans_tva_renseignee,
  pieces_payees_plus_que_leur_montant: p.pieces_payees_plus_que_leur_montant,
})

const LES_VENTES = ['factures_emises', 'encaissements_factures']

// Sous VF9b : « points_a_traiter, derrière le refus de VF9a (étape VF9b, par le harnais HTTP) ».
describe('points_a_traiter, les ventes d’un dossier basculé lues (étapes VF9b et VF9c, par le harnais HTTP)', () => {
  const sourceReelle = sourceDe('agent-comptable')
  beforeAll(() => {
    prechauffer(sourceReelle)
  }, 60_000)

  it('un dossier qui n’a pas basculé ne lit ni ses factures ni le registre, et ses contrôles jugent comme hier', async () => {
    const { points, lues } = await jouer(mondeDesVentes(false), sourceReelle)
    expect(lues.filter((l) => LES_VENTES.includes(l.table))).toEqual([])
    // Le témoin : sans facture lue, les deux exemplaires des factures sources comptent, et le virement mixte ne paie rien
    // — l'écriture de la pièce qu'il paie se dit « à régénérer ». Le monde exerce donc chaque clé que VF9b change.
    expect(clesDesVentes(points)).toEqual({
      ecritures_en_attente_de_rapprochement_bancaire: 1,
      ecritures_desequilibrees: 1,
      ecritures_a_regenerer_pieces_modifiees: 2,
      categories_sans_compte_comptable: ['Catégorie fictive sans compte'],
      categories_sans_poste_2035: ['Catégorie fictive sans compte'],
      pieces_validees_sans_tva_renseignee: 1,
      pieces_payees_plus_que_leur_montant: 0,
    })
  })

  // Sous VF9b : « un dossier basculé est refusé avant toute lecture, ses ventes comprises (VF9a tient) ». Depuis VF9c, le
  // refus ne vaut plus que pour une source des ventes qui ne se lit pas — le côté fermé de VF9a.
  it('une source des ventes illisible est refusée avant toute lecture, ses ventes comprises (le côté fermé de VF9a)', async () => {
    const monde = mondeDesVentes(true)
    const dossier = (monde.base.dossiers ?? []).find((d) => d.id === ID.dossier)
    if (!dossier) throw new Error('le dossier du monde de référence a disparu')
    delete dossier.ventes_par_les_factures
    const { points, lues } = await jouer(monde, sourceReelle)
    expect(Object.keys(points)).toEqual(['erreur'])
    expect(String(points.erreur)).toMatch(/^La source des ventes de ce dossier n'a pas pu être lue : ses ventes se comptent peut-être par ses factures\. L'assistant ne lit pas encore/)
    expect(lues.filter((l) => [...LES_VENTES, 'declarations_tva', 'lignes_bancaires'].includes(l.table))).toEqual([])
  })

  // Sous VF9b : « le refus levé, … » sur une copie en mémoire ; depuis VF9c, la vraie source.
  it('un dossier basculé lit ses factures et son registre en entier, et juge comme la Checklist', async () => {
    const { points, lues, demandes } = await jouer(mondeDesVentes(true), sourceReelle)
    expect(lues.filter((l) => LES_VENTES.includes(l.table))).toEqual([
      { table: 'factures_emises', filtres: [`eq dossier_id ${ID.dossier}`] },
      { table: 'encaissements_factures', filtres: [`eq dossier_id ${ID.dossier}`] },
    ])
    // Les exemplaires des factures sources ne comptent plus nulle part ; le virement mixte paie la pièce qu'il date — son
    // écriture est juste — et paie en double celle qu'un acompte avait déjà réglée.
    expect(clesDesVentes(points)).toEqual({
      ecritures_en_attente_de_rapprochement_bancaire: 0,
      ecritures_desequilibrees: 0,
      ecritures_a_regenerer_pieces_modifiees: 0,
      categories_sans_compte_comptable: [],
      categories_sans_poste_2035: [],
      pieces_validees_sans_tva_renseignee: 0,
      pieces_payees_plus_que_leur_montant: 1,
    })
    // Le client d'une facture (`tiers_nom`) ne se lit pas : il ne parvient jamais au modèle.
    expect(JSON.stringify(demandes)).not.toContain(MARQUEUR_CLIENT)
  })

  for (const table of LES_VENTES) {
    // Sous VF9b : « le refus levé, … » sur une copie en mémoire ; depuis VF9c, la vraie source.
    it(`un dossier basculé, ${table} lue en partie : la lecture partielle se dit, aucun contrôle ne se rend`, async () => {
      const monde = mondeDesVentes(true)
      monde.pannes.push({ table, operation: 'select', erreur: { message: 'panne fictive' } })
      const { points } = await jouer(monde, sourceReelle)
      expect(Object.keys(points)).toEqual(['erreur'])
      expect(String(points.erreur)).toMatch(/^Lecture partielle : lecture interrompue après 0 ligne\(s\) : panne fictive — ne tire aucune conclusion/)
    })
  }
})
