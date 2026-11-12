import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ecritureDuMouvement, type MouvementBancaire } from './affectationBanque'
import { banqueDuMouvement, banquesDuDossier, modeleDuMouvement, planDuMouvement } from './banqueDuMouvement'
import { COMPTES_BANCAIRES_PREVUS } from './comptesBancaires'
import type { CompteDuReleve, LectureDesComptes } from './importParCompte'
import { PLAN_DECALE, PLAN_PAR_DEFAUT } from './planComptable'
import { modeleDeTest } from '../test/modeles'
import { motifDeDefinition } from '../test/schema'

// LA JAMBE DE BANQUE PAR COMPTE BANCAIRE (MCB5, première partie) : la banque où la composition d'un mouvement écrit sa
// jambe, et la migration qui la fait vérifier par les dix fonctions du relevé.

const RACINE = new URL('../../', import.meta.url)
const MIGRATION = readFileSync(new URL('supabase/schema/20261112140844_jambe_de_banque_par_compte.sql', RACINE), 'utf8')
const RETOUR = readFileSync(new URL('supabase/preparees/retour/20261111200100_retour_jambe_de_banque_par_compte.sql', RACINE), 'utf8')
const EXPORT = readdirSync(new URL('supabase/schema/', RACINE)).filter((f) => f.endsWith('.sql'))

const compte = (c: Partial<CompteDuReleve> & Pick<CompteDuReleve, 'id'>): CompteDuReleve => ({
  libelle: 'Compte', principal: false, fin_d_identifiant: null, compte: null, compte_propre_depuis: null, ouvert_le: null, clos_le: null, ...c,
})
const PRINCIPAL = compte({ id: 'P', libelle: 'Compte principal', principal: true })
const SECOND = compte({ id: 'S', libelle: 'Compte pro bis', compte: '512200', compte_propre_depuis: '2026-01-01' })
const DEUX: LectureDesComptes = { etat: 'lus', comptes: [PRINCIPAL, SECOND] }

const mouvement = (m: Partial<MouvementBancaire & { compte_bancaire_id: string | null }>): MouvementBancaire & { compte_bancaire_id: string | null } => ({
  id: 'm', date: '2026-03-03', libelle: 'PRLV ESSAI', montant: -40, statut: 'non_rapprochee', compte_bancaire_id: 'S', ...m,
} as MouvementBancaire & { compte_bancaire_id: string | null })

describe('les banques du dossier : drapeau baissé ou aucun 512 propre, le plan lui-même', () => {
  it('drapeau baissé (sans_objet) : la banque du rôle, et le même objet plan — l’écriture d’hier, à l’octet près', () => {
    const banques = banquesDuDossier({ etat: 'sans_objet' }, PLAN_DECALE)
    expect(banques).toEqual({ cas: 'role', compte: '512100' })
    const p = planDuMouvement(PLAN_DECALE, mouvement({}), banques)
    expect('plan' in p && p.plan).toBe(PLAN_DECALE)
    const t = modeleDeTest('tresorerie')
    const m = modeleDuMouvement(t, mouvement({}), banquesDuDossier({ etat: 'sans_objet' }, t.plan))
    expect('modele' in m && m.modele).toBe(t)
  })

  it('un seul compte, ou des comptes sans 512 propre : la banque du rôle, quel que soit le mouvement', () => {
    for (const lecture of [{ etat: 'lus', comptes: [PRINCIPAL] }, { etat: 'lus', comptes: [] },
      { etat: 'lus', comptes: [PRINCIPAL, compte({ id: 'X' })] }] as LectureDesComptes[]) {
      const banques = banquesDuDossier(lecture, PLAN_PAR_DEFAUT)
      expect(banques).toEqual({ cas: 'role', compte: '512000' })
      expect(banqueDuMouvement(mouvement({ compte_bancaire_id: null }), banques)).toEqual({ compte: '512000' })
    }
  })
})

describe('un compte qui tient son 512 propre : la banque de chaque mouvement', () => {
  const banques = banquesDuDossier(DEUX, PLAN_DECALE)

  it('le principal au rôle, le second avant son 1er janvier au rôle (MCB-Q7), puis à son 512', () => {
    expect(banqueDuMouvement(mouvement({ compte_bancaire_id: 'P' }), banques)).toEqual({ compte: '512100' })
    expect(banqueDuMouvement(mouvement({ date: '2025-12-31' }), banques)).toEqual({ compte: '512100' })
    expect(banqueDuMouvement(mouvement({ date: '2026-01-01' }), banques)).toEqual({ compte: '512200' })
  })

  it('le plan du mouvement : le même objet au rôle, une copie figée dont seule la banque change au 512 propre', () => {
    const auRole = planDuMouvement(PLAN_DECALE, mouvement({ compte_bancaire_id: 'P' }), banques)
    expect('plan' in auRole && auRole.plan).toBe(PLAN_DECALE)
    const propre = planDuMouvement(PLAN_DECALE, mouvement({}), banques)
    if (!('plan' in propre)) throw new Error(propre.refus)
    expect(propre.plan).toEqual({ ...PLAN_DECALE, banque: '512200' })
    expect(Object.isFrozen(propre.plan)).toBe(true)
  })

  it('une composition écrit sa jambe à la banque du mouvement, et rien d’autre ne bouge', () => {
    const propre = planDuMouvement(PLAN_DECALE, mouvement({}), banques)
    if (!('plan' in propre)) throw new Error(propre.refus)
    const hier = ecritureDuMouvement(mouvement({}), '627000', null, PLAN_DECALE)
    expect(ecritureDuMouvement(mouvement({}), '627000', null, propre.plan))
      .toEqual(hier.map((l) => (l.compte === PLAN_DECALE.banque ? { ...l, compte: '512200' } : l)))
  })

  it('un mouvement sans compte, ou d’un compte que la lecture ne rend pas : refusé, aucun geste', () => {
    expect(banqueDuMouvement(mouvement({ compte_bancaire_id: null }), banques)).toHaveProperty('refus')
    expect(banqueDuMouvement(mouvement({ compte_bancaire_id: 'Z' }), banques)).toHaveProperty('refus')
  })

  it('des comptes en cours de lecture ou illisibles retiennent toute écriture', () => {
    for (const lecture of [{ etat: 'en_cours' }, { etat: 'illisible', motif: 'coupure' }] as LectureDesComptes[]) {
      const b = banquesDuDossier(lecture, PLAN_DECALE)
      expect(b.cas).toBe('retenu')
      expect(planDuMouvement(PLAN_DECALE, mouvement({ compte_bancaire_id: 'P' }), b)).toHaveProperty('refus')
    }
  })
})

describe('la migration jambe_de_banque_par_compte (en production depuis le 12/11/2026), confrontée à son texte', () => {
  const debutDe = (nom: string): number => {
    const debut = [...MIGRATION.matchAll(motifDeDefinition(nom))].map((m) => m.index)
    expect(debut).toHaveLength(1)
    return debut[0]
  }
  const corps = (nom: string): string => {
    const debut = debutDe(nom)
    return MIGRATION.slice(debut, MIGRATION.indexOf('$function$\n;', debut))
  }

  it('les sept qui classent un mouvement lisent sa banque par compte_de_banque_du_mouvement, sans le rôle', () => {
    for (const f of ['affecter_mouvement_bancaire', 'classer_virement_personnel', 'ecrire_mouvement_compte_bilan', 'rapprocher_cotisation',
      'rapprocher_declaration_tva', 'rapprocher_echeance_emprunt', 'ventiler_mouvement_bancaire']) {
      expect(corps(f).match(/v_banque := public\.compte_de_banque_du_mouvement\(v_ligne\.id\);/g)).toHaveLength(1)
      expect(corps(f)).not.toContain("'banque'")
    }
  })

  it('les deux recompositions d’une vente facturée prennent la banque du mouvement, deux fois chacune', () => {
    for (const f of ['ecriture_attendue_vente_facturee', 'ecritures_attendues_de_la_periode']) {
      expect(corps(f).match(/public\.compte_de_banque_du_mouvement\((v_m|m|j)\.id\)/g)).toHaveLength(2)
      expect(corps(f)).not.toMatch(/'banque'|v_banque|o\.banque/)
    }
  })

  it('la contrepartie refuse le 512 propre d’un compte bancaire du dossier, aux mots d’hier', () => {
    expect(corps('refus_compte_de_contrepartie')).toContain(
      'or exists (select 1 from public.comptes_bancaires c where c.dossier_id = p_dossier_id and c.compte = p_compte) then')
  })

  it('le retour garde les corps que l’aller pose, et l’aller ceux de la production', () => {
    const empreintes = (texte: string) => new Map([...texte.matchAll(/\('([a-z_]+)', '([0-9a-f]{32})'\)/g)].map((m) => [m[1], m[2]]))
    const duRetour = empreintes(RETOUR)
    expect(duRetour.size).toBe(10)
    for (const [nom, empreinte] of duRetour) {
      const debut = debutDe(nom)
      const texte = MIGRATION.slice(MIGRATION.indexOf('AS $function$', debut) + 'AS $function$'.length, MIGRATION.indexOf('$function$\n;', debut))
      expect(createHash('md5').update(texte).digest('hex'), nom).toBe(empreinte)
    }
    expect(empreintes(MIGRATION).size).toBe(10)
  })

  it('COMPTES_BANCAIRES_PREVUS ne se lève qu’avec la migration en base (dans l’export)', () => {
    const exportee = EXPORT.some((f) => f.endsWith('_jambe_de_banque_par_compte.sql'))
    expect(COMPTES_BANCAIRES_PREVUS ? exportee : true).toBe(true)
  })
})
