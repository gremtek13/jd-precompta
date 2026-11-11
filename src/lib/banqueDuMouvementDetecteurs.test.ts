import { describe, expect, it } from 'vitest'
import type { MouvementBancaire } from './affectationBanque'
import { banquesDuDossier, modelePourJuger, planPourJuger } from './banqueDuMouvement'
import { ecritureDuCompteDeBilan, mouvementsSurUnCompteDeBilanDesynchronises } from './compteDeBilan'
import { COMPTE_VIREMENTS_INTERNES } from './comptes'
import { ecritureDuPaiementTva, paiementsTvaDesynchronises } from './liquidationTva'
import { ecritureDuVirementPersonnel, virementsPersonnelsAEcrire } from './virementPersonnel'
import type { CompteDuReleve, LectureDesComptes } from './importParCompte'
import { PLAN_DECALE, PLAN_PAR_DEFAUT, type PlanComptable } from './planComptable'
import type { EcritureBrouillon } from './types'
import { NON_VALIDEE } from '../test/ecritures'
import { modeleDeTest } from '../test/modeles'

// LES DÉTECTEURS DE DÉSYNCHRONISATION SOUS PLUSIEURS COMPTES BANCAIRES (MCB5, seconde partie) : une écriture composée au
// 512 du compte de son mouvement est conforme, la même au 512 du rôle ne l'est plus ; une banque qui ne se sait pas ne se
// juge pas ; drapeau baissé (`sans_objet`), le jugement d'hier.

const compte = (c: Partial<CompteDuReleve> & Pick<CompteDuReleve, 'id'>): CompteDuReleve => ({
  libelle: 'Compte', principal: false, fin_d_identifiant: null, compte: null, compte_propre_depuis: null, ouvert_le: null, clos_le: null, ...c,
})
const DEUX: LectureDesComptes = { etat: 'lus', comptes: [
  compte({ id: 'P', principal: true }), compte({ id: 'S', compte: '512200', compte_propre_depuis: '2026-01-01' }),
] }

type Mouvement = MouvementBancaire & { compte_bancaire_id: string }
function mouvement(o: Partial<Mouvement> = {}): Mouvement {
  return {
    id: 'l1', date: '2026-03-12', libelle: 'VIR', libelle_brut: null, montant: -2000, compte_bancaire_id: 'S',
    statut: 'rapprochee', piece_id: null, cotisation_id: null, categorie_id: null, taux_tva: null, prelevement_personnel: false,
    source_fichier: null, emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null,
    ventilee: false, reglement_groupe: false, compte_bilan: null, declaration_tva_id: null,
    ...o,
  }
}
const ecritures = (l: Pick<MouvementBancaire, 'id' | 'date'>, lignes: readonly { compte: string; sens: 'debit' | 'credit'; montant: number }[]): EcritureBrouillon[] =>
  lignes.map((x, i) => ({
    id: `e${i}`, dossier_id: 'd1', piece_id: null, ligne_bancaire_id: l.id, date: l.date, compte: x.compte, libelle: 'VIR',
    montant: x.montant, sens: x.sens, statut: 'proposee', immobilisation_id: null, vehicule_id: null, declaration_tva_id: null,
    cotisation_id: null, ...NON_VALIDEE, created_at: '2026-03-12T10:00:00Z', encaissement_id: null, facture_id: null,
  }))

describe('planPourJuger et modelePourJuger', () => {
  it('drapeau baissé : le plan et le modèle eux-mêmes (le même objet)', () => {
    const b = banquesDuDossier({ etat: 'sans_objet' }, PLAN_DECALE)
    expect(planPourJuger(PLAN_DECALE, mouvement(), b)).toBe(PLAN_DECALE)
    const t = modeleDeTest('tresorerie')
    expect(modelePourJuger(t, mouvement(), banquesDuDossier({ etat: 'sans_objet' }, t.plan))).toBe(t)
  })
  it('un compte qui tient son 512 : le plan du mouvement ; une banque qui ne se sait pas : nul', () => {
    expect(planPourJuger(PLAN_PAR_DEFAUT, mouvement(), banquesDuDossier(DEUX, PLAN_PAR_DEFAUT))?.banque).toBe('512200')
    expect(planPourJuger(PLAN_PAR_DEFAUT, mouvement({ compte_bancaire_id: 'P' }), banquesDuDossier(DEUX, PLAN_PAR_DEFAUT))).toBe(PLAN_PAR_DEFAUT)
    for (const l of [{ etat: 'en_cours' }, { etat: 'illisible', motif: 'coupée' }] as LectureDesComptes[]) {
      expect(planPourJuger(PLAN_PAR_DEFAUT, mouvement(), banquesDuDossier(l, PLAN_PAR_DEFAUT))).toBeNull()
    }
  })
})

describe('les détecteurs jugent au 512 du compte du mouvement', () => {
  const auPlan = (plan: PlanComptable) => ({ ...plan, banque: '512200' })
  const cas: { nom: string; ligne: Mouvement; ecrite: (p: PlanComptable) => EcritureBrouillon[]; juger: (e: EcritureBrouillon[], l: LectureDesComptes) => unknown[] }[] = [
    {
      nom: 'compte de bilan',
      ligne: mouvement({ compte_bilan: COMPTE_VIREMENTS_INTERNES }),
      ecrite: (p) => ecritures(mouvement(), ecritureDuCompteDeBilan(mouvement(), COMPTE_VIREMENTS_INTERNES, p)),
      juger: (e, l) => mouvementsSurUnCompteDeBilanDesynchronises(e, [mouvement({ compte_bilan: COMPTE_VIREMENTS_INTERNES })], null, PLAN_PAR_DEFAUT,
        banquesDuDossier(l, PLAN_PAR_DEFAUT)),
    },
    {
      nom: 'paiement de TVA',
      ligne: mouvement({ declaration_tva_id: 'decl' }),
      ecrite: (p) => ecritures(mouvement(), ecritureDuPaiementTva(mouvement(), p)),
      juger: (e, l) => paiementsTvaDesynchronises(e, [mouvement({ declaration_tva_id: 'decl' })], null, PLAN_PAR_DEFAUT, banquesDuDossier(l, PLAN_PAR_DEFAUT)),
    },
    {
      nom: 'virement personnel',
      ligne: mouvement({ prelevement_personnel: true, statut: 'non_rapprochee' }),
      ecrite: (p) => ecritures(mouvement(), ecritureDuVirementPersonnel(mouvement(), { ...modeleDeTest('tresorerie'), plan: p })),
      juger: (e, l) => virementsPersonnelsAEcrire(e, [mouvement({ prelevement_personnel: true, statut: 'non_rapprochee' })], modeleDeTest('tresorerie'), null,
        banquesDuDossier(l, PLAN_PAR_DEFAUT)),
    },
  ]
  for (const c of cas) {
    it(`${c.nom} : conforme au 512 propre, désynchronisé au rôle ; drapeau baissé, le jugement d’hier`, () => {
      const auPropre = c.ecrite(auPlan(PLAN_PAR_DEFAUT))
      const auRole = c.ecrite(PLAN_PAR_DEFAUT)
      expect(c.juger(auPropre, DEUX)).toHaveLength(0)
      expect(c.juger(auRole, DEUX)).toHaveLength(1)
      expect(c.juger(auRole, { etat: 'sans_objet' })).toHaveLength(0)
      expect(c.juger(auPropre, { etat: 'sans_objet' })).toHaveLength(1)
    })
    it(`${c.nom} : des comptes illisibles — le mouvement n’est pas jugé`, () => {
      expect(c.juger([], { etat: 'illisible', motif: 'coupée' })).toHaveLength(0)
      expect(c.juger([], { etat: 'sans_objet' })).toHaveLength(1)
    })
  }
})
