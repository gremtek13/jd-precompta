import { createHash } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { CONTRATS, jouerScenario, type Contexte } from '../test/contratsFonctions'
import { ID, type Monde } from '../test/fonctionsEdge'
import { PLAN_DECALE, PLAN_PAR_DEFAUT, PREFIXES_DECALES, ROLES_COMPTABLES } from './planComptable'

// L'ASSISTANT LIT LE PLAN DU DOSSIER (ligne 43, étape PC3b). L'étape est NEUTRE : aucun plan ne se règle avant PC4, et
// sous le plan par défaut ce que l'assistant compose et envoie au modèle — la consigne, la description des outils, chaque
// résultat d'outil — et ce qu'il répond doivent rester identiques au caractère près. La preuve, sur le modèle de
// fecAuPlan.test.ts : chaque scénario du contrat HTTP de l'assistant (src/test/contratsFonctions.ts), joué pour deux
// dossiers fictifs — un BNC en trésorerie, une société en engagement —, sous une horloge figée, et l'empreinte SHA-256 de
// tout ce qu'il a rendu, relevée sur dd14890, AVANT toute modification de l'assistant. Puis le plan décalé : la consigne
// nomme les comptes du dossier, et aucun de ceux du catalogue qu'il a déplacés ; et un plan illisible ferme l'assistant.

const contexte: Contexte = { entetesDuNavigateur: [] }
const contrat = CONTRATS.find((c) => c.slug === 'agent-comptable')!
// Les scénarios de l'inventaire (INV7) posent leur propre mode, que `bnc` et `societe` écraseraient : le contrat et
// agentComptableInventaire.test.ts les jugent. Les autres rendent, le drapeau de l'inventaire baissé, ce qu'ils rendaient.
const SCENARIOS = contrat.scenarios.map((s) => s.nom).filter((nom) => !nom.endsWith('(INV7)'))

/** Le BNC en trésorerie : le dirigeant au compte de l'exploitant, exonéré. */
function bnc(m: Monde) {
  const d = m.base.dossiers!.find((x) => x.id === ID.dossier)!
  Object.assign(d, { mode_comptable: 'tresorerie', compte_notes_de_frais: '108000', assujetti_tva: false, statut_tva: 'exonere' })
}

/** La société en engagement : le dirigeant en compte courant d'associé, redevable de la TVA. */
function societe(m: Monde) {
  const d = m.base.dossiers!.find((x) => x.id === ID.dossier)!
  Object.assign(d, { mode_comptable: 'engagement', compte_notes_de_frais: '455000', assujetti_tva: true, statut_tva: 'redevable' })
}

/** Le plan décalé, réglé sur le dossier : chaque rôle sur un autre sous-compte, les préfixes des tiers aussi ; le compte du
 *  dirigeant suit son rôle (PC3-Q1 : la fonction qui réglera le plan le déplacera dans la même transaction). */
function decale(m: Monde) {
  const d = m.base.dossiers!.find((x) => x.id === ID.dossier)!
  d.compte_notes_de_frais = d.mode_comptable === 'engagement' ? PLAN_DECALE.associe : PLAN_DECALE.exploitant
  m.base.plan_comptable_dossier = ROLES_COMPTABLES.map((r) => ({
    dossier_id: ID.dossier, role: r.role, compte: PLAN_DECALE[r.role], libelle: null,
    prefixe_auxiliaire: (PREFIXES_DECALES as Record<string, string>)[r.role] ?? null, origine: 'cabinet',
  }))
}

async function rendu(nom: string, apres: (m: Monde) => void) {
  const scenario = contrat.scenarios.find((s) => s.nom === nom)!
  const { monde, r } = await jouerScenario(contrat, scenario, contexte, { apres })
  return { statut: r.statut, texte: r.texte, demandes: JSON.stringify(monde.notes.demandesAuModele ?? []) }
}

type Rendu = Awaited<ReturnType<typeof rendu>>
const sha = (texte: string) => createHash('sha256').update(texte).digest('hex')
const empreinte = (rendus: Record<string, Rendu>) => sha(JSON.stringify(SCENARIOS.map((nom) => [nom, rendus[nom]])))
const consigneDe = (x: Rendu) => {
  const demandes = JSON.parse(x.demandes) as { system?: unknown }[]
  return demandes.length > 0 ? String(demandes[0].system ?? '') : null
}

// Relevées sur dd14890 (l'assistant d'avant PC3b), sous l'horloge figée ci-dessous. Les deux premières relevées de nouveau
// le 11/11/2026 (A8C5B) : chaque scénario rejoué avant et après, et la seule différence est voulue — la description de
// resume_dossier, la phrase des factures reprises dans la consigne d'un dossier basculé, trois clés de resume_dossier à zéro
// sur un dossier basculé sans reprise, et trois scénarios neufs ; les deux consignes du plan par défaut sont inchangées.
// Les quatre relevées de nouveau le 19/11/2026 (EXP58-Q5, `CUMUL_REPRIS_PREVU` levé avec la migration collée) : la différence
// voulue est la lecture du registre (deux colonnes de plus, `cumul_repris` et `cumul_repris_au`) et la phrase de la consigne sur
// le plan continué ; les deux états de la constante se jouent dans agentComptableAmortissement.test.ts.
// Les quatre relevées de nouveau le même jour (EXP58-Q6, `AUTRES_IMPOTS_DES_COTISATIONS_PREVUS` levé avec la migration collée,
// 243) : chaque scénario rejoué sur deux copies hors du dépôt, la constante de l'assistant à `false` puis à `true`, le faux
// `plan_du_dossier` rendant déjà le rôle `autres_impots` (src/test/rolesDeLaBase.ts). À `false`, les quatre empreintes d'avant
// (d0f11fae…, f43b6f30…, 987deaac…, 3a1cf12f…), à l'identique : le rôle de plus dans la réponse ne change rien. À `true`, une
// seule différence, voulue, dans la consigne des 73 demandes au modèle de chaque dossier (40 des 63 scénarios), et nulle part
// ailleurs (aucun statut, aucun résultat d'outil, aucune réponse) : la phrase de l'échéance de cotisation s'allonge de « ; sa part « autres impôts » — la contribution à la formation
// professionnelle et la CURPS que l'Urssaf appelle avec elle —, quand elle est saisie, va au 637800 (autres impôts), en BS sur
// la 2035 et non en BK, en trésorerie comme en engagement, et de même quand l'échéance est payée depuis le compte personnel ».
// La lecture du plan (le rôle exigé) et la colonne `montant_autres_impots` lue ne changent aucun rendu : aucune échéance du
// monde fictif ne porte de part. Les deux états de la constante se jouent dans agentComptableAutresImpots.test.ts.
const EMPREINTES = {
  bnc: 'eec4bec7ce24fbb929f01f966c59de171a8e7456c74e4b5cbe73ed47023b69ef',
  societe: '0d1cecda7823107d9df961ad49a73a003cd54faf641bc90120b8f13c09675e18',
  consigneBnc: 'ac601d1bd397717202d3771933f86d2ca1ea017f144670aa20625e3680ac30ab',
  consigneSociete: '07f8093df2b47cafe09c065927d0af4d0d802de126a30942c749c2b8251c121a',
}

describe('agent-comptable ferme le dossier dont le plan ne se lit pas, avant toute dépense', () => {
  const nom = SCENARIOS.find((n) => n === 'chef : admis — une réponse du modèle')!
  const ferme = async (apres: (m: Monde) => void) => {
    const scenario = contrat.scenarios.find((s) => s.nom === nom)!
    const { monde, r } = await jouerScenario(contrat, scenario, contexte, { apres })
    return { r, modele: monde.journal.filter((e) => e.genre === 'modele' || e.genre === 'client-aws').length }
  }

  it('un plan incomplet : 503 qui le dit en français, et pas un client Bedrock', async () => {
    const { r, modele } = await ferme((m) => {
      bnc(m)
      m.base.plan_comptable_dossier = [{ dossier_id: ID.dossier, role: 'banque', compte: '445660', libelle: null, prefixe_auxiliaire: null, origine: 'cabinet' }]
    })
    expect(r.statut).toBe(503)
    expect(r.texte).toContain('Le plan comptable de ce dossier n’a pas pu être lu (plan comptable illisible : « 445660 » n’est pas un compte du rôle « banque »)')
    expect(modele).toBe(0)
  })

  it('le compte du dirigeant hors des trois rôles de son plan : 503, le refus de la page', async () => {
    const { r, modele } = await ferme((m) => { bnc(m); m.base.dossiers!.find((x) => x.id === ID.dossier)!.compte_notes_de_frais = '455100' })
    expect(r.statut).toBe(503)
    expect(r.texte).toContain('Le compte du dirigeant de ce dossier (455100) n’est le compte d’aucun des trois rôles que son plan comptable lui ouvre (455000, 108000, 467000).')
    expect(modele).toBe(0)
  })

  it('le plan refusé par la base : 503, le motif de la base', async () => {
    const { r, modele } = await ferme((m) => { bnc(m); m.pannes.push({ rpc: 'plan_du_dossier', erreur: { message: 'délai dépassé' } }) })
    expect(r.statut).toBe(503)
    expect(r.texte).toContain('plan comptable refusé : délai dépassé')
    expect(modele).toBe(0)
  })
})

describe('agent-comptable lit le plan du dossier (PC3b) : neutre sous le plan par défaut', () => {
  const rendus: Record<'bnc' | 'societe' | 'bncDecale' | 'societeDecale', Record<string, Rendu>> = {
    bnc: {}, societe: {}, bncDecale: {}, societeDecale: {},
  }
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-07T10:00:00Z'))
    for (const nom of SCENARIOS) {
      rendus.bnc[nom] = await rendu(nom, bnc)
      rendus.societe[nom] = await rendu(nom, societe)
      rendus.bncDecale[nom] = await rendu(nom, (m) => { bnc(m); decale(m) })
      rendus.societeDecale[nom] = await rendu(nom, (m) => { societe(m); decale(m) })
    }
  }, 900_000)
  afterAll(() => { vi.useRealTimers() })

  const consigneDu = (cle: keyof typeof rendus) => {
    const nom = SCENARIOS.find((n) => rendus[cle][n].statut === 200 && consigneDe(rendus[cle][n]))
    expect(nom, 'aucun scénario n’atteint le modèle : la preuve serait vide').toBeDefined()
    return consigneDe(rendus[cle][nom!])!
  }

  it('la preuve n’est pas vide : des dizaines de scénarios, dont des dizaines où le modèle reçoit des résultats d’outils', () => {
    expect(SCENARIOS.length).toBeGreaterThanOrEqual(50)
    for (const cle of ['bnc', 'societe'] as const) {
      expect(SCENARIOS.filter((n) => rendus[cle][n].demandes.includes('tool_use_id')).length).toBeGreaterThanOrEqual(25)
    }
    expect(consigneDu('bnc')).toContain('trésorerie (BNC, 2035)')
    expect(consigneDu('societe')).toContain('engagement (BIC, IS)')
  })

  it('sous le plan par défaut, tout ce que l’assistant rend et envoie au modèle est celui d’avant, au caractère près', () => {
    expect({
      bnc: empreinte(rendus.bnc), societe: empreinte(rendus.societe),
      consigneBnc: sha(consigneDu('bnc')), consigneSociete: sha(consigneDu('societe')),
    }).toEqual(EMPREINTES)
  })

  it('sous le plan décalé, la consigne nomme les comptes du dossier, et aucun compte du catalogue qu’il a déplacés', () => {
    for (const cle of ['bncDecale', 'societeDecale'] as const) {
      const texte = consigneDu(cle)
      for (const compte of ['512100', '445711', '445661', '445621', '164100', '661110', '616810', '646100', '681110', '625111', '580100', '275100']) {
        expect(texte, `${cle} : ${compte}`).toContain(compte)
      }
      const defauts = new Set(Object.values(PLAN_PAR_DEFAUT))
      expect([...texte.matchAll(/(?<!\d)\d{6}(?!\d)/g)].map((m) => m[0]).filter((n) => defauts.has(n))).toEqual([])
    }
    expect(consigneDu('bncDecale')).toContain('108100')
    expect(consigneDu('societeDecale')).toContain('401100')
  })

  it('sous le plan décalé, les résultats d’outils changent : le plan se lit jusque dans les contrôles', () => {
    expect(SCENARIOS.filter((n) => rendus.bncDecale[n].demandes !== rendus.bnc[n].demandes).length).toBeGreaterThan(0)
  })
})
