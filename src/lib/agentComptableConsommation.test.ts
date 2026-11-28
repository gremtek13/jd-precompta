import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { CONTRATS, contratDeLAgentComptable, jouerScenario, jugerScenario, type Contexte, type Scenario } from '../test/contratsFonctions'
import { CONSOMMATION_TENUE_BAISSEE, CONSOMMATION_TENUE_LEVEE, consommationTenueLevee, muter, prechauffer, sourceDe } from '../test/fonctionsEdge'
import { BORNE_DES_TOKENS_DE_SORTIE, BORNE_DES_TOKENS_D_ENTREE, CONSOMMATION_TENUE_PAR_LA_FONCTION } from './consommationDeLAssistant'

// LE JOURNAL DE CONSOMMATION DE L'ASSISTANT, TENU PAR LA FONCTION (ASSIST-Q1 (A), tranchée par le cabinet le 27/11/2026). Le
// défaut connu `plafondTenuParLeNavigateur` (relecture adverse de sécurité des Edge Functions, 27/11/2026) : le plafond mensuel se
// comptait sur les lignes que le navigateur écrit. `agent-comptable` note désormais elle-même, sous la clé du service, ce que
// chaque appel au modèle consomme, dans le journal `consommations_de_l_assistant` (la migration préparée du même nom), et le
// plafond ne lit plus que lui — derrière `CONSOMMATION_TENUE_PAR_LA_FONCTION`, BAISSÉE tant que la migration n'est pas en base.
//
// Ce que ce fichier établit, sur la vraie source, servie et levée en mémoire (`consommationTenueLevee`) :
//   - servie, la constante est baissée, une fois, et le drapeau jumeau de l'application la redit ; levée, rien d'autre ne change ;
//   - baissée, la fonction d'hier : elle ne lit ni n'écrit le journal, même la table au schéma, et le défaut est toujours là ;
//   - levée, TOUT le contrat de la fonction passe (`contratDeLAgentComptable(true)`), les deux scénarios du défaut connu
//     compris, sans défaut connu, et ceux du journal (une ligne par appel, quelle que soit l'issue ; l'écriture qui échoue) ;
//   - levée, chaque scénario commun aux deux états rend la même chose qu'hier — statut, réponse, ce qui part au modèle — : la
//     constante ne change que le plafond ;
//   - des défauts plantés dans la source levée : les juges voient ce qu'ils gardent.

const contexte: Contexte = { entetesDuNavigateur: [] }
const servie = () => sourceDe('agent-comptable')
const levee = () => consommationTenueLevee(servie())
const baisse = contratDeLAgentComptable(false)
const leve = contratDeLAgentComptable(true)
const MIGRATION = readFileSync(
  new URL('../../supabase/preparees/20261127232000_consommations_de_l_assistant.sql', import.meta.url), 'utf8')
const propreALEtat = (nom: string) => nom.endsWith('(ASSIST-Q1)')

beforeAll(() => { prechauffer(servie()); prechauffer(levee()) })

describe('la constante de la fonction et son jumeau de l’application', () => {
  it('servie, la constante est baissée, une fois exactement ; levée en mémoire, rien d’autre ne change', () => {
    const source = servie()
    expect(source.split(CONSOMMATION_TENUE_BAISSEE)).toHaveLength(2)
    expect(source.includes(CONSOMMATION_TENUE_LEVEE)).toBe(false)
    expect(levee().replace(CONSOMMATION_TENUE_LEVEE, CONSOMMATION_TENUE_BAISSEE)).toBe(source)
  })

  it('le drapeau de l’application redit la constante servie : l’un ne se lève jamais sans l’autre', () => {
    expect(servie().includes(CONSOMMATION_TENUE_LEVEE)).toBe(CONSOMMATION_TENUE_PAR_LA_FONCTION)
  })

  it('les bornes que la fonction applique sont celles du module et des contraintes de la migration', () => {
    const source = servie()
    expect(source).toContain(`const BORNE_DES_TOKENS_D_ENTREE = ${BORNE_DES_TOKENS_D_ENTREE.toLocaleString('en-US').replace(/,/g, '_')}`)
    expect(source).toContain(`const BORNE_DES_TOKENS_DE_SORTIE = ${BORNE_DES_TOKENS_DE_SORTIE.toLocaleString('en-US').replace(/,/g, '_')}`)
    expect(MIGRATION).toContain(`check (tokens_entree between 0 and ${BORNE_DES_TOKENS_D_ENTREE})`)
    expect(MIGRATION).toContain(`check (tokens_sortie between 0 and ${BORNE_DES_TOKENS_DE_SORTIE})`)
  })

  it('le contrat servi est celui de l’état de la constante servie', () => {
    const servi = CONTRATS.find((c) => c.slug === 'agent-comptable')!
    const attendu = CONSOMMATION_TENUE_PAR_LA_FONCTION ? leve : baisse
    expect(servi.scenarios.map((s) => s.nom)).toEqual(attendu.scenarios.map((s) => s.nom))
  })

  it('les scénarios d’un seul état portent la marque que l’empreinte d’agentComptableAuPlan.test.ts écarte', () => {
    const noms = (c: typeof baisse) => new Set(c.scenarios.map((s) => s.nom))
    const enBaisse = noms(baisse)
    const enLeve = noms(leve)
    const dUnSeulEtat = [...enBaisse].filter((n) => !enLeve.has(n)).concat([...enLeve].filter((n) => !enBaisse.has(n)))
    expect(dUnSeulEtat.length).toBeGreaterThanOrEqual(10)
    expect(dUnSeulEtat.filter((n) => !propreALEtat(n))).toEqual([])
  })
})

describe('agent-comptable servie (constante baissée) : la fonction d’hier', () => {
  const admis = baisse.scenarios.find((s) => s.nom === 'chef : admis — une réponse du modèle')!

  it('elle ne lit ni n’écrit le journal, même la table au schéma des préparées', async () => {
    const { monde, r } = await jouerScenario(baisse, admis, contexte, { source: servie(), apres: (m) => { m.schemaPrepare = true } })
    expect(r.statut).toBe(200)
    expect(monde.journal.filter((e) => (e.genre === 'lecture' || e.genre === 'ecriture') && e.table === 'consommations_de_l_assistant')).toEqual([])
  })

  it('le défaut est toujours là : sans sa marque, les deux scénarios du compteur tombent', async () => {
    const defauts = baisse.scenarios.filter((s) => s.defautConnu === 'plafondTenuParLeNavigateur')
    expect(defauts).toHaveLength(2)
    for (const s of defauts) {
      const sansMarque: Scenario = { ...s, defautConnu: undefined }
      expect(await jugerScenario(baisse, sansMarque, contexte, servie()), s.nom).not.toEqual([])
    }
  })
})

describe('agent-comptable, constante levée en mémoire : tout son contrat', () => {
  it('aucun défaut connu, et les scénarios du journal sont là', () => {
    expect(leve.scenarios.filter((s) => s.defautConnu)).toEqual([])
    expect(leve.scenarios.filter((s) => propreALEtat(s.nom)).length).toBeGreaterThanOrEqual(15)
  })

  it.each(leve.scenarios.map((s) => [s.nom, s] as const))('%s', async (_nom, scenario) => {
    expect(await jugerScenario(leve, scenario, contexte, levee())).toEqual([])
  })
})

describe('levée, la constante ne change que le plafond : chaque scénario commun rend ce qu’il rendait', () => {
  const communs = baisse.scenarios.filter((s) => !propreALEtat(s.nom))
  const rendu = async (contrat: typeof baisse, nom: string, source: string) => {
    const scenario = contrat.scenarios.find((s) => s.nom === nom)!
    const { monde, r } = await jouerScenario(contrat, scenario, contexte, { source })
    return { statut: r.statut, texte: r.texte, demandes: JSON.stringify(monde.notes.demandesAuModele ?? []) }
  }

  it('la preuve n’est pas vide', () => {
    expect(communs.length).toBeGreaterThanOrEqual(50)
  })

  it.each(communs.map((s) => [s.nom] as const))('%s', async (nom) => {
    expect(await rendu(leve, nom, levee())).toEqual(await rendu(baisse, nom, servie()))
  })
})

// Des défauts PLANTÉS dans la source levée, en mémoire : chacun, la forme exacte d'une régression que ce journal craint.
describe('les juges voient ce qu’ils gardent', () => {
  const scenario = (motif: string) => {
    const s = leve.scenarios.find((x) => x.nom.startsWith(motif))
    if (!s) throw new Error(`aucun scénario « ${motif} »`)
    return s
  }
  const tombe = async (remplacements: [string, string][], motif: string) => {
    const mutee = muter(levee(), remplacements)
    expect(await jugerScenario(leve, scenario(motif), contexte, mutee)).not.toEqual([])
  }
  const NOTE = 'const consommationNotee = CONSOMMATION_TENUE_PAR_LA_FONCTION ? await noterConsommation(admin, consommateur, response.usage) : true'

  it('la consommation jamais notée : la question suivante passe le plafond', async () => {
    await tombe([[NOTE, 'const consommationNotee = true']], 'le plafond de blocage : une réponse rendue (200)')
    await tombe([[NOTE, 'const consommationNotee = true']], 'le plafond de blocage : une réponse coupée (502)')
  })

  it('notée seulement à la réponse rendue : un refus du modèle ne se compte plus', async () => {
    await tombe([
      [NOTE, 'const consommationNotee = toolUseBlocksDe(response).length === 0 && response.stop_reason === "end_turn" ? await noterConsommation(admin, consommateur, response.usage) : true'],
      ['async function noterConsommation(', 'function toolUseBlocksDe(r: { content: { type: string }[] }) { return r.content.filter((b) => b.type === "tool_use") }\n\nasync function noterConsommation('],
    ], 'un refus du modèle (502)')
  })

  it('le plafond relit les lignes du navigateur', async () => {
    const branche = '  if (CONSOMMATION_TENUE_PAR_LA_FONCTION) {\n    // LE JOURNAL QUE LA FONCTION ÉCRIT'
    await tombe([[branche, '  if (false) {\n    // LE JOURNAL QUE LA FONCTION ÉCRIT']], 'les lignes que le navigateur écrit ne comptent plus')
    await tombe([[branche, '  if (false) {\n    // LE JOURNAL QUE LA FONCTION ÉCRIT']], 'le journal ne se lit qu’au cabinet du dossier')
  })

  it('le journal lu sans son cabinet, ou sans son mois', async () => {
    await tombe([['        .eq("cabinet_id", cabinetId)\n        .gte("consommee_le", debutMois)\n', '        .gte("consommee_le", debutMois)\n']],
      'la consommation d’un autre cabinet ne compte pas')
    await tombe([['        .eq("cabinet_id", cabinetId)\n        .gte("consommee_le", debutMois)\n', '        .eq("cabinet_id", cabinetId)\n']],
      'la consommation du mois passé ne compte pas')
  })

  it('le journal tronqué pris pour un journal entier', async () => {
    await tombe([['    if (!lectureJournal.complete) {\n', '    if (false) {\n']], 'le journal du mois lu en partie')
  })

  it('l’écriture refusée fait échouer la réponse déjà payée, ou la tait', async () => {
    const marque = '          ...(consommationNonNotee ? { consommation_non_notee: true } : {}),\n'
    await tombe([[marque, '']], 'la consommation de la réponse non notée')
    await tombe([['      if (!consommationNotee) consommationNonNotee = true\n',
      '      if (!consommationNotee) return json({ error: REFUS_CONSOMMATION_NON_NOTEE }, 503)\n']], 'la consommation de la réponse non notée')
  })

  it('un appel de plus malgré l’écriture refusée', async () => {
    await tombe([['      // Un tour d\'outils appelle le modèle une fois de plus : jamais quand cet appel-ci n\'a pas pu être noté.\n      if (!consommationNotee) return json({ error: REFUS_CONSOMMATION_NON_NOTEE }, 503)\n', '']],
      'la consommation d’un tour d’outils non notée')
  })

  it('le dossier retiré pendant la question fait perdre la consommation', async () => {
    await tombe([['    if (erreur && codeDeLErreur(erreur) === "23503") {', '    if (false) {']], 'le dossier retiré pendant la question')
  })

  it('les tokens notés sans leurs bornes', async () => {
    await tombe([['  return Math.min(Math.floor(valeur), borne)\n', '  return valeur\n'],
      ['  if (typeof valeur !== "number" || !Number.isFinite(valeur) || valeur <= 0) return 0\n', '  if (typeof valeur !== "number") return 0\n']],
    'une consommation hors des bornes')
  })

  it('le message de la base recopié au journal de la fonction', async () => {
    await tombe([['n\'a pas pu être notée (${codeDeLErreur(erreur)})', 'n\'a pas pu être notée (${codeDeLErreur(erreur)}) ${JSON.stringify(erreur)}']],
      'la consommation de la réponse non notée')
  })

  it('la consommation notée sous un autre compte que celui de la session', async () => {
    await tombe([['compte: callerData.user.id }', 'compte: PERSONNE_DU_CABINET }'],
      ['const REFUS_CONSOMMATION_NON_NOTEE =', 'const PERSONNE_DU_CABINET = "a1000000-0000-4000-8000-000000000001"\nconst REFUS_CONSOMMATION_NON_NOTEE =']],
    'le membre assigné : sa consommation notée à son compte')
  })
})
