import { beforeAll, describe, expect, it } from 'vitest'
import {
  CONTRATS, SCENARIOS_ACOMPTES_EN_BASE, ceQuiPart, jouerScenario, jugerScenario, type ContratFonction, type Contexte,
} from '../test/contratsFonctions'
import { ACOMPTES_BAISSES, acomptesEnBase, muter, prechauffer, sourceDe } from '../test/fonctionsEdge'

// L'ACOMPTE D'UN DEVIS, LES APPELS HTTP CONSTANTE LEVÉE (étape P5b4c). Les trois fonctions qui lisent la marque d'acompte
// (superpdp-emit et plateforme-agreee, le CII ; send-email, l'e-mail) ne la lisent que sous `ACOMPTES_EN_BASE`, baissée
// tant que la migration `acomptes_des_devis` n'est pas appliquée (copiesFacturation.test.ts la lie à `ACOMPTES_PREVUS`).
// Leurs contrats d'aujourd'hui (edgeFunctionsHttp.test.ts) jouent la source servie ; ceux-ci jouent la même source, la
// constante levée en mémoire (`acomptesEnBase`), devant la base de demain (`schemaPrepare`) : ce qui part d'une facture
// d'acompte, d'une finale et de l'avoir d'un acompte, les refus avant toute dépense, et — sans acompte — exactement ce qui
// part aujourd'hui. Les contrôles qui valent partout (ni secret ni valeur de pièce au journal, aucun hôte non déclaré)
// s'appliquent à chaque scénario, comme aux contrats d'aujourd'hui.

const contexte: Contexte = { entetesDuNavigateur: [] }
const SLUGS = Object.keys(SCENARIOS_ACOMPTES_EN_BASE) as (keyof typeof SCENARIOS_ACOMPTES_EN_BASE)[]
const contratDe = (slug: string): ContratFonction => {
  const contrat = CONTRATS.find((c) => c.slug === slug)
  if (!contrat) throw new Error(`aucun contrat pour ${slug}`)
  return contrat
}

beforeAll(() => {
  for (const slug of SLUGS) {
    prechauffer(sourceDe(slug))
    prechauffer(acomptesEnBase(sourceDe(slug)))
  }
})

describe('la réécriture du harnais : ACOMPTES_EN_BASE levée, en mémoire', () => {
  it.each(SLUGS)('%s : une occurrence exactement de la constante baissée, et rien d’autre ne change', (slug) => {
    const source = sourceDe(slug)
    expect(source.split(ACOMPTES_BAISSES)).toHaveLength(2)
    const levee = acomptesEnBase(source)
    expect(levee).not.toBe(source)
    expect(levee.replace('const ACOMPTES_EN_BASE = true', ACOMPTES_BAISSES)).toBe(source)
  })

  it('une source sans la constante, ou qui la pose deux fois, lève : la réécriture ne prouverait rien', () => {
    expect(() => acomptesEnBase(sourceDe('receive-email'))).toThrow(/ancre trouvée 0 fois/)
    expect(() => acomptesEnBase(`${ACOMPTES_BAISSES}\n${ACOMPTES_BAISSES}\n`)).toThrow(/ancre trouvée 2 fois/)
  })
})

describe.each(SLUGS)('%s, constante levée', (slug) => {
  const contrat = contratDe(slug)
  it.each(SCENARIOS_ACOMPTES_EN_BASE[slug].map((s) => [s.nom, s] as const))('%s', async (_nom, scenario) => {
    expect(await jugerScenario(contrat, scenario, contexte, acomptesEnBase(sourceDe(slug)))).toEqual([])
  })

  it('sans acompte, ce qui part est ce qui part aujourd’hui, au caractère près', async () => {
    const scenario = SCENARIOS_ACOMPTES_EN_BASE[slug][0]
    expect(scenario.nom).toMatch(/sans acompte/)
    const hier = await jouerScenario(contrat, scenario, contexte)
    const demain = await jouerScenario(contrat, scenario, contexte, { source: acomptesEnBase(sourceDe(slug)) })
    expect(hier.r.statut).toBe(200)
    expect(ceQuiPart(hier.monde)).toHaveLength(1)
    expect(ceQuiPart(demain.monde)).toEqual(ceQuiPart(hier.monde))
  })

  it('la constante baissée, une facture d’acompte part comme une facture d’hier : le scénario « acompte » tombe', async () => {
    const scenario = SCENARIOS_ACOMPTES_EN_BASE[slug][1]
    expect(scenario.nom).toMatch(/acompte/)
    expect(await jugerScenario(contrat, scenario, contexte, sourceDe(slug))).not.toEqual([])
  })
})

// Un défaut PLANTÉ dans la source levée : une marque illisible prise pour « pas un acompte » (le côté ouvert) ferait partir
// l'e-mail d'une facture d'acompte sous « Facture » — le juge le voit.
describe('les juges voient ce qu’ils gardent', () => {
  it('send-email : une marque illisible prise pour « pas un acompte » fait tomber le refus', async () => {
    const mutee = muter(acomptesEnBase(sourceDe('send-email')), [[
      '  if (erreurMarque || !marque || typeof marque.acompte !== "boolean") {',
      '  if (erreurMarque || !marque) {',
    ]])
    const scenario = SCENARIOS_ACOMPTES_EN_BASE['send-email'].find((s) => /illisible/.test(s.nom))
    expect(scenario).toBeDefined()
    expect(await jugerScenario(contratDe('send-email'), scenario!, contexte, mutee)).not.toEqual([])
  })
})
