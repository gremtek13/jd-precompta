import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ecritureDeLaCotisation, refusRapprochementCotisation } from './cotisationRapprochee'
import { PLAN_DECALE, PLAN_PAR_DEFAUT, planDeLaReponse, type PlanComptable } from './planComptable'
import { ROLE_AUTRES_IMPOTS } from './autresImpotsDesCotisations'
import type { CotisationDeclaree, LigneBancaire, ModeComptable } from './types'
import { avecLePlanEtLaBanqueDuRole, blocDesBanques } from '../test/copieAuPlan'
import { LIBELLES_PAR_DEFAUT } from '../test/modeles'
import { ROLES_DE_LA_BASE } from '../test/rolesDeLaBase'

// L'ASSISTANT RECOPIE LA PART « AUTRES IMPÔTS » D'UNE ÉCHÉANCE (EXP58-Q6) : derrière sa constante
// `AUTRES_IMPOTS_DES_COTISATIONS_PREVUS` (en tête du bloc COTISATION), baissée comme le drapeau de src/lib. La garde
// d'agentComptableCotisation.test.ts compare la copie à src/lib dans l'état d'aujourd'hui ; celle-ci les compare dans les DEUX
// états — la constante réécrite dans le texte extrait, le drapeau de src/lib joué par un accesseur —, l'écriture attendue, les
// refus (des codes, pour l'assistant, à la même place) et la lecture du plan, qui exige le rôle la constante levée.
const drapeau = vi.hoisted(() => ({ leve: undefined as boolean | undefined }))
vi.mock('./autresImpotsDesCotisations', async (original) => {
  const vrai = await original<typeof import('./autresImpotsDesCotisations')>()
  const etat = () => drapeau.leve ?? vrai.AUTRES_IMPOTS_DES_COTISATIONS_PREVUS
  return {
    ...vrai,
    get AUTRES_IMPOTS_DES_COTISATIONS_PREVUS() { return etat() },
    partAutresImpots: (c: { montant_autres_impots?: number | null }) => vrai.partAutresImpotsSelon(etat(), c),
  }
})
afterEach(() => { drapeau.leve = undefined })

const SOURCE = readFileSync(new URL('../../supabase/functions/agent-comptable/index.ts', import.meta.url), 'utf8')
const CONSTANTE = 'const AUTRES_IMPOTS_DES_COTISATIONS_PREVUS = false'

function bornes(nom: string): string {
  const debut = SOURCE.indexOf(`// ── DÉBUT ${nom}`)
  const fin = SOURCE.indexOf(`// ── FIN ${nom}`)
  expect(debut, `bornes du bloc ${nom} introuvables`).toBeGreaterThan(-1)
  return SOURCE.slice(debut, fin)
}

interface Copie {
  refusRapprochementCotisation: (l: LigneBancaire, c: CotisationDeclaree, mode: ModeComptable) => string | null
  ecritureDeLaCotisation: (l: { montant: number }, c: CotisationDeclaree, mode: ModeComptable) => { compte: string; sens: string; montant: number }[]
}

function copie(levee: boolean, plan: PlanComptable): Copie {
  expect(SOURCE.split(CONSTANTE).length - 1, 'la constante de l’assistant, baissée, une fois').toBe(1)
  const bloc = `${bornes('VALIDATION')}\n${blocDesBanques(SOURCE)}\n${bornes('AFFECTATION')}\n${bornes('COTISATION')}`
    .replace(CONSTANTE, `const AUTRES_IMPOTS_DES_COTISATIONS_PREVUS = ${levee}`)
  const js = ts.transpileModule(bloc, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return avecLePlanEtLaBanqueDuRole(new Function(`${js}\nreturn { refusRapprochementCotisation, ecritureDeLaCotisation }`)(), plan) as Copie
}

function planDeLaCopie(levee: boolean): (r: { data: unknown; error: unknown }) => { plan: PlanComptable | null; motif: string | null } {
  const bloc = `const ECARTS_DE_REGLEMENT_PREVUS = true\nconst AUTRES_IMPOTS_DES_COTISATIONS_PREVUS = ${levee}\n${bornes('PLAN DU DOSSIER')}`
  const js = ts.transpileModule(bloc, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return new Function(`${js}\nreturn planDeLaReponse`)()
}

const ligne = (o: Partial<LigneBancaire> = {}): LigneBancaire => ({
  id: 'l', dossier_id: 'd', date: '2026-03-05', libelle: 'PRLV URSSAF', montant: -500, statut: 'rapprochee', libelle_brut: null,
  piece_id: null, cotisation_id: 'c', categorie_id: null, taux_tva: null, prelevement_personnel: false, source_fichier: null,
  emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false, reglement_groupe: false,
  compte_bilan: null, declaration_tva_id: null, id_externe: null, created_at: '2026-03-06T09:00:00Z', encaissements_de_factures: false, ...o,
})
const cotisation = (o: Partial<CotisationDeclaree> = {}): CotisationDeclaree => ({
  id: 'c', dossier_id: 'd', echeance: '2026-03-05', montant_appele: 500, montant_verse: null, montant_csg_crds: 60,
  montant_autres_impots: 20, previsionnel: false, created_at: '2026-01-02T09:00:00Z', paiement_personnel_le: null, ...o,
})

// La batterie : des parts nulles, au centime, au millième, qui dépassent avec ou sans CSG-CRDS ; des appels et des remboursements.
const CAS: { l: LigneBancaire; c: CotisationDeclaree }[] = [
  { l: ligne(), c: cotisation() },
  { l: ligne(), c: cotisation({ montant_autres_impots: null }) },
  { l: ligne(), c: cotisation({ montant_autres_impots: 20.005 }) },
  { l: ligne(), c: cotisation({ montant_autres_impots: 440 }) },
  { l: ligne(), c: cotisation({ montant_autres_impots: 441 }) },
  { l: ligne(), c: cotisation({ montant_csg_crds: null, montant_autres_impots: 501 }) },
  { l: ligne({ montant: 300 }), c: cotisation({ montant_appele: -300, montant_csg_crds: 30, montant_autres_impots: 10 }) },
  { l: ligne({ montant: -80 }), c: cotisation({ montant_appele: 80 }) },
]
// L'assistant dit un code, l'écran une phrase : ils se répondent, refus par refus.
const CODES: Record<string, RegExp> = {
  part_autres_impots_pas_au_centime: /^La part « autres impôts » de cette échéance n’est pas au centime\.$/,
  part_autres_impots_au_dela_du_mouvement: /^La (CSG-CRDS et la )?part « autres impôts » de cette échéance \(.*\) dépasse(nt)? le mouvement/,
}
const sansLibelle = (e: readonly { compte: string; sens: string; montant: number }[]) => e.map(({ compte, sens, montant }) => `${compte}:${sens}:${montant}`).sort()

describe('l’assistant et la part « autres impôts » (EXP58-Q6), dans les deux états', () => {
  for (const levee of [false, true]) {
    for (const mode of ['tresorerie', 'engagement'] as const) {
      it(`${levee ? 'levés' : 'baissés'}, en ${mode} : la même écriture et les mêmes refus que src/lib`, () => {
        drapeau.leve = levee
        for (const plan of [{ ...PLAN_PAR_DEFAUT, autres_impots: '637800' }, { ...PLAN_DECALE, autres_impots: '635800' }]) {
          const c = copie(levee, plan)
          for (const { l, c: k } of CAS) {
            const attendu = refusRapprochementCotisation(l, k, mode)
            const code = c.refusRapprochementCotisation(l, k, mode)
            if (attendu === null || code === null) {
              expect(code, `${l.montant} / ${JSON.stringify(k)}`).toBeNull()
              expect(attendu).toBeNull()
              expect(sansLibelle(c.ecritureDeLaCotisation(l, k, mode))).toEqual(sansLibelle(ecritureDeLaCotisation(l, k, mode, plan)))
            } else {
              expect(CODES[code] ?? null, `${code} pour « ${attendu} »`).not.toBeNull()
              expect(attendu).toMatch(CODES[code])
            }
          }
        }
      })
    }
  }

  it('la lecture du plan de la copie exige le rôle la constante levée, et l’ignore baissée — comme src/lib', () => {
    const lignes = [...ROLES_DE_LA_BASE, ROLE_AUTRES_IMPOTS].map((r) => ({
      role: r.role, compte: r.compteDefaut, libelle: LIBELLES_PAR_DEFAUT[r.role as keyof typeof LIBELLES_PAR_DEFAUT] ?? r.libelleDefaut,
      prefixe_auxiliaire: r.prefixeAuxiliaireDefaut, origine: 'application',
    }))
    const sans = lignes.filter((l) => l.role !== 'autres_impots')
    for (const levee of [false, true]) {
      drapeau.leve = levee
      const lire = planDeLaCopie(levee)
      expect(lire({ data: lignes, error: null }).plan?.autres_impots).toBe(planDeLaReponse({ data: lignes, error: null }).plan?.autres_impots)
      expect(lire({ data: sans, error: null }).motif).toBe(planDeLaReponse({ data: sans, error: null }).motif)
    }
  })

  it('la garde sait échouer : une copie qui garde la part au compte des cotisations dérive, constante levée', () => {
    drapeau.leve = true
    const fausse = SOURCE.replace('(total - csg - impots) / 100', '(total - csg) / 100')
    expect(fausse).not.toBe(SOURCE)
    const bloc = `${bornes('VALIDATION')}\n${blocDesBanques(fausse)}\n${bornes('AFFECTATION')}\n${fausse.slice(fausse.indexOf('// ── DÉBUT COTISATION'), fausse.indexOf('// ── FIN COTISATION'))}`
      .replace(CONSTANTE, 'const AUTRES_IMPOTS_DES_COTISATIONS_PREVUS = true')
    const js = ts.transpileModule(bloc, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
    const plan = { ...PLAN_PAR_DEFAUT, autres_impots: '637800' }
    const c = avecLePlanEtLaBanqueDuRole(new Function(`${js}\nreturn { ecritureDeLaCotisation }`)(), plan) as Pick<Copie, 'ecritureDeLaCotisation'>
    expect(sansLibelle(c.ecritureDeLaCotisation(ligne(), cotisation(), 'tresorerie')))
      .not.toEqual(sansLibelle(ecritureDeLaCotisation(ligne(), cotisation(), 'tresorerie', plan)))
  })
})
