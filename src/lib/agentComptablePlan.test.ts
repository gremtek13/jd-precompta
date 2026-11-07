import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { modeleDuDossier, type ModeleDuDossier } from './engagement'
import {
  PLAN_DECALE, PLAN_PAR_DEFAUT, PREFIXES_DECALES, ROLES_COMPTABLES, planDeLaReponse, type LectureDuPlan, type PlanComptable,
} from './planComptable'
import type { ModeComptable } from './types'
import { LIBELLES_PAR_DEFAUT, planLuDe } from '../test/modeles'

// L'ASSISTANT LIT LE PLAN DU DOSSIER (ligne 43, étape PC3b). `agent-comptable` est auto-portée : elle recopie entre les
// bornes `── DÉBUT/FIN PLAN DU DOSSIER` le catalogue des rôles (la clé, les racines, le rôle de tiers — jamais un compte
// par défaut), `planDeLaReponse` et `modeleDuDossier` avec son refus. Ce test extrait le bloc, le transpile, l'exécute, et
// le compare à src/lib/planComptable.ts et src/lib/engagement.ts sur une batterie de réponses de `plan_du_dossier` — juste,
// décalée, refusée, illisible, incomplète, d'un compte hors de son rôle, d'un préfixe faux — et de dirigeants.
//
// CE QU'UNE DÉRIVE COÛTERAIT : l'assistant répondrait sur un plan que la page refuse (un compte deviné), ou se fermerait sur
// un plan que la page lit. Des dérives plantées dans la vraie source prouvent que la garde sait encore échouer.

interface Copie {
  ROLES_DU_PLAN: readonly { role: string; racines: readonly string[]; deTiers: boolean }[]
  planDeLaReponse: (r: { data: unknown; error: unknown }) => LectureDuPlan
  modeleDuDossier: (d: { mode_comptable: ModeComptable; compte_notes_de_frais: string }, planLu: LectureDuPlan) => ModeleDuDossier
}

function sourceDeployee(): string {
  return readFileSync(new URL('../../supabase/functions/agent-comptable/index.ts', import.meta.url), 'utf8')
}

function extraire(source: string): Copie {
  const debut = source.indexOf('// ── DÉBUT PLAN DU DOSSIER')
  const fin = source.indexOf('// ── FIN PLAN DU DOSSIER')
  expect(debut, 'bornes du bloc PLAN DU DOSSIER introuvables — garde-fou à remettre à jour').toBeGreaterThan(-1)
  expect(fin).toBeGreaterThan(debut)
  const js = ts.transpileModule(source.slice(debut, fin), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return new Function(`${js}\nreturn { ROLES_DU_PLAN, planDeLaReponse, modeleDuDossier }`)() as Copie
}

const deployee = extraire(sourceDeployee())

/** La réponse de `plan_du_dossier` pour un plan : une ligne par rôle du catalogue, dans son ordre, comme la base la rend. */
function reponse(plan: PlanComptable, prefixes: Readonly<Record<string, string>>): { data: unknown; error: unknown } {
  return {
    data: ROLES_COMPTABLES.map((r) => ({
      role: r.role, compte: plan[r.role], libelle: r.libelleDefaut,
      prefixe_auxiliaire: r.prefixeAuxiliaireDefaut === null ? null : prefixes[r.role], origine: 'application',
    })),
    error: null,
  }
}
const PREFIXES_DU_CATALOGUE = Object.fromEntries(ROLES_COMPTABLES.flatMap((r) => (r.prefixeAuxiliaireDefaut ? [[r.role, r.prefixeAuxiliaireDefaut]] : [])))
const JUSTE = reponse(PLAN_PAR_DEFAUT, PREFIXES_DU_CATALOGUE)
const DECALEE = reponse(PLAN_DECALE, PREFIXES_DECALES)
const lignes = (r: { data: unknown }) => r.data as Record<string, unknown>[]
const avec = (r: { data: unknown }, f: (l: Record<string, unknown>[]) => unknown[]) => ({ data: f(lignes(r).map((l) => ({ ...l }))), error: null })
const changer = (role: string, champs: Record<string, unknown>) => (ls: Record<string, unknown>[]) =>
  ls.map((l) => (l.role === role ? { ...l, ...champs } : l))

const REPONSES: [string, { data: unknown; error: unknown }][] = [
  ['le plan par défaut', JUSTE],
  ['le plan décalé', DECALEE],
  ['un refus de la base', { data: null, error: { code: '42501', message: 'Accès refusé à ce dossier.' } }],
  ['un refus sans message', { data: null, error: { code: '42501' } }],
  ['une réponse qui n’est pas une liste', { data: { role: 'banque' }, error: null }],
  ['une réponse vide', { data: [], error: null }],
  ['une ligne nulle', avec(JUSTE, (ls) => [...ls, null])],
  ['un rôle sans compte', avec(JUSTE, changer('banque', { compte: null }))],
  ['un rôle absent', avec(JUSTE, (ls) => ls.filter((l) => l.role !== 'caisse'))],
  ['un rôle deux fois', avec(JUSTE, (ls) => [...ls, { ...ls[0] }])],
  ['un compte de cinq chiffres', avec(JUSTE, changer('banque', { compte: '51210' }))],
  ['un compte hors des racines du rôle', avec(JUSTE, changer('banque', { compte: '445660' }))],
  ['un compte sous la seconde racine de son rôle', avec(JUSTE, changer('ventes_de_biens', { compte: '701000' }))],
  ['un libellé absent de la ligne', avec(JUSTE, (ls) => ls.map((l) => (l.role === 'clients' ? { role: l.role, compte: l.compte, prefixe_auxiliaire: 'C' } : l)))],
  ['un libellé qui n’est pas un texte', avec(JUSTE, changer('clients', { libelle: 3 }))],
  ['un rôle de tiers sans préfixe', avec(JUSTE, changer('fournisseurs', { prefixe_auxiliaire: null }))],
  ['un préfixe sur un rôle qui n’est pas de tiers', avec(JUSTE, changer('banque', { prefixe_auxiliaire: 'B' }))],
  ['un préfixe en minuscules', avec(JUSTE, changer('clients', { prefixe_auxiliaire: 'c' }))],
  ['deux rôles de tiers au même préfixe', avec(JUSTE, changer('clients', { prefixe_auxiliaire: 'F' }))],
  ['un rôle que l’application ignore', avec(JUSTE, (ls) => [...ls, { role: 'nouveau_role', compte: '999999', libelle: null, prefixe_auxiliaire: null, origine: 'application' }])],
  ['un libellé réglé par le dossier', avec(JUSTE, changer('banque', { libelle: 'Banque populaire' }))],
]

describe('agent-comptable / bloc PLAN DU DOSSIER (copie déployée)', () => {
  it('n’est pas la fonction de src/lib elle-même', () => {
    expect(deployee.planDeLaReponse).not.toBe(planDeLaReponse)
    expect(deployee.modeleDuDossier).not.toBe(modeleDuDossier)
  })

  it('tient le catalogue des rôles de src/lib : chaque rôle, dans l’ordre, ses racines, et s’il est de tiers — sans compte par défaut', () => {
    expect(deployee.ROLES_DU_PLAN.map((r) => ({ ...r, racines: [...r.racines] })))
      .toEqual(ROLES_COMPTABLES.map((r) => ({ role: r.role, racines: [...r.racines], deTiers: r.prefixeAuxiliaireDefaut !== null })))
    expect(JSON.stringify(deployee.ROLES_DU_PLAN)).not.toMatch(/\d{6}/)
  })

  it('lit chaque réponse comme src/lib : le même plan, ou le même motif', () => {
    for (const [nom, r] of REPONSES) expect(deployee.planDeLaReponse(r), nom).toEqual(planDeLaReponse(r))
  })

  it('la batterie exerce bien ce qui décide : deux plans lus, et un motif par réponse fautive', () => {
    const lus = REPONSES.map(([, r]) => planDeLaReponse(r))
    expect(lus.filter((l) => l.plan !== null).length).toBe(5)
    expect(planDeLaReponse(DECALEE).plan).toEqual(PLAN_DECALE)
    expect(lus.filter((l) => l.motif !== null).length).toBe(REPONSES.length - 5)
    // Treize motifs distincts : « illisible » nu en couvre plusieurs (une liste qui n'en est pas une, une ligne nulle…).
    expect(new Set(lus.flatMap((l) => (l.motif === null ? [] : [l.motif]))).size).toBe(13)
  })

  it('juge le compte du dirigeant comme src/lib, sous chaque plan, dans chaque modèle', () => {
    for (const plan of [PLAN_PAR_DEFAUT, PLAN_DECALE]) {
      const lu = plan === PLAN_PAR_DEFAUT ? planDeLaReponse(JUSTE) : planDeLaReponse(DECALEE)
      expect(lu.plan).toEqual(plan)
      for (const mode of ['tresorerie', 'engagement'] as const) {
        for (const compte of [plan.associe, plan.exploitant, plan.autres_debiteurs_crediteurs, plan.banque, '455000', '108000', '467000']) {
          const dossier = { mode_comptable: mode, compte_notes_de_frais: compte }
          const attendu = modeleDuDossier(dossier, lu.plan === null ? planLuDe(plan) : lu)
          expect(deployee.modeleDuDossier(dossier, lu), `${mode}, ${compte}`).toEqual(attendu)
        }
      }
    }
    // La batterie voit un refus et un modèle sous chaque plan.
    const refus = modeleDuDossier({ mode_comptable: 'engagement', compte_notes_de_frais: '455000' }, planLuDe(PLAN_DECALE))
    expect(refus.refus).toContain('(455000)')
    expect(modeleDuDossier({ mode_comptable: 'engagement', compte_notes_de_frais: PLAN_DECALE.associe }, planLuDe(PLAN_DECALE)).modele?.libelles)
      .toEqual(LIBELLES_PAR_DEFAUT)
  })
})

describe('le garde-fou du bloc PLAN DU DOSSIER sait encore échouer', () => {
  function planter(avant: string, apres: string): Copie {
    const source = sourceDeployee()
    expect(source.split(avant).length - 1, `motif à planter introuvable ou ambigu : ${avant}`).toBe(1)
    return extraire(source.replace(avant, apres))
  }
  const memesLectures = (copie: Copie) => {
    for (const [nom, r] of REPONSES) expect(copie.planDeLaReponse(r), nom).toEqual(planDeLaReponse(r))
  }
  const memesModeles = (copie: Copie) => {
    for (const r of [JUSTE, DECALEE]) {
      const lu = planDeLaReponse(r)
      for (const compte of ['455000', '455100', '108000', '512000']) {
        const dossier = { mode_comptable: 'engagement' as const, compte_notes_de_frais: compte }
        expect(copie.modeleDuDossier(dossier, lu)).toEqual(modeleDuDossier(dossier, lu as Exclude<LectureDuPlan, { plan: null }>))
      }
    }
  }
  const echoue = (f: () => void) => expect(f).toThrowError(/expected/)

  it('attrape un rôle oublié du catalogue', () => {
    echoue(() => memesLectures(planter('  { role: "caisse", racines: ["53"], deTiers: false },\n', '')))
  })

  it('attrape une racine mal recopiée', () => {
    echoue(() => memesLectures(planter('{ role: "ventes_de_biens", racines: ["701", "707"]', '{ role: "ventes_de_biens", racines: ["707"]')))
  })

  it('attrape un rôle de tiers qui ne l’est plus', () => {
    echoue(() => memesLectures(planter('const ROLES_DE_TIERS: readonly RoleDeTiers[] = ["fournisseurs", "fournisseurs_immobilisations", "clients"]',
      'const ROLES_DE_TIERS: readonly RoleDeTiers[] = ["fournisseurs", "clients"]')))
  })

  it('attrape une lecture qui admet un rôle deux fois', () => {
    echoue(() => memesLectures(planter('    if (lus.has(role)) return { plan: null, motif: `plan comptable illisible : le rôle « ${role} » y paraît deux fois` }\n', '')))
  })

  it('attrape une lecture qui ne juge plus la racine du compte', () => {
    echoue(() => memesLectures(planter('if (!FORME_COMPTE_DE_ROLE.test(compte) || !sousUneRacineDuRole(role, compte)) {', 'if (!FORME_COMPTE_DE_ROLE.test(compte)) {')))
  })

  it('attrape une lecture qui admet deux tiers au même préfixe', () => {
    echoue(() => memesLectures(planter('  if (new Set(Object.values(prefixes)).size !== ROLES_DE_TIERS.length) {', '  if (false) {')))
  })

  it('attrape un dirigeant jugé sur deux rôles seulement', () => {
    echoue(() => memesModeles(planter('const ROLES_DU_DIRIGEANT = ["associe", "exploitant", "autres_debiteurs_crediteurs"] as const',
      'const ROLES_DU_DIRIGEANT = ["associe", "exploitant"] as const')))
  })

  it('attrape un modèle qui ne juge plus le compte du dirigeant', () => {
    echoue(() => memesModeles(planter('  if (roleDuDirigeant(plan, dossier.compte_notes_de_frais) === null) {', '  if (false) {')))
  })

  it('et il ne crie PAS au loup sur la copie réellement déployée', () => {
    memesLectures(deployee)
    memesModeles(deployee)
  })
})
