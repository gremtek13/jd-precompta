import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  compteQueLApplicationEcritSurLePlan,
  compteRangeSurLePlan,
  preparerANouveaux,
  preparerANouveauxSelon,
  preparerANouveauxSelonLesDrapeaux,
  preparerANouveauxSurLePlanSelon,
  refusDUnANouveau,
} from './aNouveaux'
import type { LigneBalance } from './balanceImport'
import { CAISSE_EXPORTEE } from './caisse'
import { PLAN_DECALE, PLAN_PAR_DEFAUT, ROLES_COMPTABLES, type CleRoleComptable, type PlanComptable } from './planComptable'
import {
  PLAN_DEPUIS_LA_BALANCE_PREVU,
  formeDUnCompteDeRole,
  planDepuisLaBalance,
  planRetenu,
  type PlanLu,
  type PropositionDuRole,
} from './planDepuisLaBalance'

// PC6 — la reprise propose le plan, et range ses à-nouveaux sur lui (ligne 43 ; HISTORIQUE.md, « 11/11/2026 — PC6 : LA
// REPRISE PROPOSE LE PLAN (PRÉPARÉE, PAS APPLIQUÉE) »). Des balances FICTIVES ; la base se rejoue par
// supabase/essais/planDepuisLaBalance.sql, et ce test confronte les mots et l'ordre des refus au texte de la migration.

const RACINE = new URL('../../', import.meta.url)
const lire = (chemin: string) => readFileSync(new URL(chemin, RACINE), 'utf8')
const MIGRATION = lire('supabase/preparees/20261111241000_plan_depuis_la_balance.sql')
const RETOUR = lire('supabase/preparees/retour/20261111241100_retour_plan_depuis_la_balance.sql')
const CREATION = lire('supabase/schema/20260926221456_creation_a_nouveaux.sql')

const ligne = (compte: string, libelle: string, debit: number, credit: number): LigneBalance => ({ compte, libelle, debit, credit })

const LIBELLES_DU_CATALOGUE = Object.fromEntries(ROLES_COMPTABLES.map((r) => [r.role, r.libelleDefaut])) as PlanLu['libelles']
const PREFIXES_DU_CATALOGUE = { fournisseurs: 'F', fournisseurs_immobilisations: 'FI', clients: 'C' } as const
const planLu = (plan: PlanComptable): PlanLu => ({ plan, libelles: LIBELLES_DU_CATALOGUE, prefixes: PREFIXES_DU_CATALOGUE })

const du = (propositions: PropositionDuRole[], role: CleRoleComptable) => propositions.find((p) => p.role === role)!

// Une balance d'avant clôture d'un BNC tenu ailleurs : deux banques, la TVA à décaisser sur sept chiffres, deux 401, un
// emprunt sur sept chiffres, des frais réels au 625100, une caisse en 531, le capital, un compte trop long.
const BALANCE: LigneBalance[] = [
  ligne('512100', 'Banque Populaire', 12000, 0),
  ligne('512200', 'Livret A', 3000, 0),
  ligne('4455100', 'TVA à décaisser', 0, 800),
  ligne('401100', 'Fournisseurs France', 0, 400),
  ligne('401200', 'Fournisseurs étrangers', 0, 100),
  ligne('1640000', 'Emprunt cabinet', 0, 9000),
  ligne('531', 'Caisse', 150, 0),
  ligne('101', 'Capital individuel', 0, 4850),
  ligne('4671234', 'Compte d’attente', 0, 0),
  ligne('625100', 'Voyages et déplacements', 1200, 0),
  ligne('706100', 'Honoraires', 0, 1200),
]

describe('formeDUnCompteDeRole', () => {
  it('ramène un numéro à six chiffres, à des zéros près', () => {
    expect(formeDUnCompteDeRole('4455100')).toBe('445510')
    expect(formeDUnCompteDeRole('512')).toBe('512000')
    expect(formeDUnCompteDeRole('44566000')).toBe('445660')
    expect(formeDUnCompteDeRole(' 401 ')).toBe('401000')
  })
  it('refuse plus de six chiffres significatifs, le vide et ce qui n’est pas un numéro', () => {
    for (const numero of ['4011234', '51210001', '0', '000', '', '40A1', '401.1']) expect(formeDUnCompteDeRole(numero), numero).toBeNull()
  })
})

describe('planDepuisLaBalance', () => {
  const propositions = planDepuisLaBalance(BALANCE, planLu(PLAN_PAR_DEFAUT), ['625100', '606000'])

  it('un seul compte sous les racines du rôle : proposé, avec le libellé de la balance (le même que le plan : rien ne change)', () => {
    expect(du(propositions, 'tva_a_decaisser')).toEqual({
      role: 'tva_a_decaisser', etat: 'propose', change: false, ecartes: [],
      candidat: { compte: '445510', comptesOrigine: ['4455100'], libelle: 'TVA à décaisser' },
    })
    expect(du(propositions, 'emprunt')).toMatchObject({ etat: 'propose', candidat: { compte: '164000', libelle: 'Emprunt cabinet' } })
    expect(du(propositions, 'caisse')).toMatchObject({ etat: 'propose', change: true, candidat: { compte: '531000' } })
    expect(du(propositions, 'prestations_de_services')).toMatchObject({ etat: 'propose', candidat: { compte: '706100', libelle: 'Honoraires' } })
  })

  it('plusieurs : au choix — deux banques, deux fournisseurs', () => {
    const banque = du(propositions, 'banque')
    expect(banque.etat).toBe('au_choix')
    expect(banque.etat === 'au_choix' && banque.candidats.map((c) => c.compte)).toEqual(['512100', '512200'])
    const fournisseurs = du(propositions, 'fournisseurs')
    expect(fournisseurs.etat === 'au_choix' && fournisseurs.candidats.map((c) => c.compte)).toEqual(['401100', '401200'])
  })

  it('aucun : le plan reste', () => {
    for (const role of ['clients', 'associe', 'tva_deductible', 'resultat_benefice'] as const) expect(du(propositions, role).etat, role).toBe('reste')
  })

  it('un compte de plus de six chiffres est écarté et dit ; un rôle sans autre compte reste', () => {
    expect(du(propositions, 'autres_debiteurs_crediteurs')).toEqual({
      role: 'autres_debiteurs_crediteurs', etat: 'reste',
      ecartes: [{ compteOrigine: '4671234', libelle: 'Compte d’attente', motif: 'hors_forme', categorie: null }],
    })
  })

  it('le compte d’une catégorie n’est pas proposé aux indemnités kilométriques (refus 10 de regler_plan_du_dossier)', () => {
    expect(du(propositions, 'indemnites_kilometriques')).toEqual({
      role: 'indemnites_kilometriques', etat: 'reste',
      ecartes: [{ compteOrigine: '625100', libelle: 'Voyages et déplacements', motif: 'compte_d_une_categorie', categorie: '625100' }],
    })
    // Ni à un rôle du bilan (refus 9) ; mais un rôle de charge autre que le barème le prend, et le compte du catalogue passe.
    const bilan = planDepuisLaBalance([ligne('4011', 'Fournisseurs', 0, 1)], planLu(PLAN_PAR_DEFAUT), ['401100'])
    expect(du(bilan, 'fournisseurs')).toMatchObject({ etat: 'reste', ecartes: [{ motif: 'compte_d_une_categorie', categorie: '401100' }] })
    const charge = planDepuisLaBalance([ligne('616', 'Assurances', 1, 0)], planLu(PLAN_PAR_DEFAUT), ['616000'])
    expect(du(charge, 'assurance_emprunt')).toMatchObject({ etat: 'propose', candidat: { compte: '616000' } })
    const defaut = planDepuisLaBalance([ligne('62511', 'IK', 1, 0)], planLu(PLAN_PAR_DEFAUT), ['625110'])
    expect(du(defaut, 'indemnites_kilometriques')).toMatchObject({ etat: 'propose', change: true, candidat: { compte: '625110', libelle: 'IK' } })
  })

  it('deux numéros du même compte à des zéros près font un candidat ; le capital ne prend pas de libellé', () => {
    const p = planDepuisLaBalance([ligne('44551', '', 0, 1), ligne('4455100', 'TVA due', 0, 1), ligne('1010000', 'Capital', 0, 2)],
      planLu(PLAN_PAR_DEFAUT), [])
    expect(du(p, 'tva_a_decaisser')).toMatchObject({ etat: 'propose', candidat: { compte: '445510', comptesOrigine: ['44551', '4455100'], libelle: 'TVA due' } })
    expect(du(p, 'capital_individuel')).toMatchObject({ etat: 'propose', change: false, candidat: { compte: '101000', libelle: null } })
  })

  it('un libellé que le plan refuserait laisse celui du catalogue, jamais tronqué', () => {
    const p = planDepuisLaBalance([ligne('411', 'x'.repeat(201), 1, 0), ligne('164', 'Emprunt\u0007', 0, 1)], planLu(PLAN_PAR_DEFAUT), [])
    expect(du(p, 'clients')).toMatchObject({ etat: 'propose', change: false, candidat: { libelle: null } })
    expect(du(p, 'emprunt')).toMatchObject({ candidat: { libelle: null } })
  })
})

describe('planRetenu', () => {
  const lu = planLu(PLAN_PAR_DEFAUT)
  const propositions = planDepuisLaBalance(BALANCE, lu, ['625100'])

  it('le plan entier : les propositions retenues et les choix, seuls les rôles qui diffèrent du catalogue', () => {
    const retenu = planRetenu(propositions, { banque: '512100', fournisseurs: '401100' }, lu)
    expect(retenu.refus).toBeNull()
    expect(retenu.comptes).toEqual([
      { role: 'banque', compte: '512100', libelle: 'Banque Populaire', prefixe_auxiliaire: null },
      { role: 'fournisseurs', compte: '401100', libelle: 'Fournisseurs France', prefixe_auxiliaire: null },
      { role: 'emprunt', compte: '164000', libelle: 'Emprunt cabinet', prefixe_auxiliaire: null },
      { role: 'prestations_de_services', compte: '706100', libelle: 'Honoraires', prefixe_auxiliaire: null },
      { role: 'caisse', compte: '531000', libelle: null, prefixe_auxiliaire: null },
    ])
  })

  it('un rôle au choix sans choix et une proposition refusée gardent le plan du dossier', () => {
    const retenu = planRetenu(propositions, { tva_a_decaisser: null, emprunt: null, caisse: null, prestations_de_services: null }, lu)
    expect(retenu.comptes).toEqual([])
  })

  it('un choix hors des candidats se refuse, jamais un plan deviné', () => {
    expect(planRetenu(propositions, { banque: '512300' }, lu).refus).toMatch(/512300/)
    expect(planRetenu(propositions, { tva_a_decaisser: '445511' }, lu).refus).toMatch(/445511/)
    expect(planRetenu(propositions, { clients: '411100' }, lu).refus).toMatch(/aucun compte/)
  })

  it('le plan d’un dossier déjà réglé reste pour les rôles que la balance ne touche pas, préfixes compris', () => {
    const regle: PlanLu = { plan: PLAN_DECALE, libelles: { ...LIBELLES_DU_CATALOGUE, clients: 'Clients du cabinet' },
      prefixes: { fournisseurs: 'FO', fournisseurs_immobilisations: 'IM', clients: 'CL' } }
    const retenu = planRetenu(planDepuisLaBalance([], regle, []), {}, regle)
    expect(retenu.comptes?.find((c) => c.role === 'clients')).toEqual({ role: 'clients', compte: PLAN_DECALE.clients, libelle: 'Clients du cabinet', prefixe_auxiliaire: 'CL' })
    expect(retenu.comptes?.find((c) => c.role === 'banque')).toEqual({ role: 'banque', compte: '512100', libelle: null, prefixe_auxiliaire: null })
  })
})

describe('les à-nouveaux rangés sur le plan (PC6)', () => {
  it('tout compte de rôle à des zéros près prend le numéro du plan ; tout 512… et tout 53… sont réunis', () => {
    for (const [numero, compte] of [['4455100', '445510'], ['1640000', '164000'], ['4010', '401000'], ['5121', '512000'],
      ['512200', '512000'], ['531', '530000'], ['44566', '445660'], ['4011', '4011'], ['164200', '164200'], ['2183', '2183']]) {
      expect(compteRangeSurLePlan(numero, PLAN_PAR_DEFAUT), numero).toBe(compte)
    }
    expect(compteRangeSurLePlan('4455110', PLAN_DECALE)).toBe('445511')
    expect(compteRangeSurLePlan('512000', PLAN_DECALE)).toBe('512100')
    expect(compteRangeSurLePlan('530000', PLAN_DECALE)).toBe('531000')
  })

  it('un autre sous-compte sous la racine d’un rôle est dit : l’application n’y écrira pas', () => {
    expect(compteQueLApplicationEcritSurLePlan('4011', PLAN_PAR_DEFAUT)).toBe('401000')
    expect(compteQueLApplicationEcritSurLePlan('164200', PLAN_PAR_DEFAUT)).toBe('164000')
    expect(compteQueLApplicationEcritSurLePlan('445800', PLAN_DECALE)).toBe(PLAN_DECALE.tva_collectee_en_attente)
    expect(compteQueLApplicationEcritSurLePlan('2183', PLAN_PAR_DEFAUT)).toBe('218300')
    for (const numero of ['4455100', '512200', '401000', '275', '1061']) expect(compteQueLApplicationEcritSurLePlan(numero, PLAN_PAR_DEFAUT), numero).toBeNull()
  })

  it('la préparation : deux banques réunies et dites, la TVA et l’emprunt rangés, un second 401 dit', () => {
    const p = preparerANouveauxSurLePlanSelon(BALANCE, 2026, PLAN_PAR_DEFAUT, true)
    expect(p.refus).toBeNull()
    expect(p.lignes.filter((l) => l.compte === '512000').map((l) => l.compteOrigine)).toEqual(['512100', '512200'])
    expect(p.rapproches.map((r) => `${r.compteOrigine}→${r.compte}`)).toEqual(
      ['512100→512000', '512200→512000', '4455100→445510', '1640000→164000', '531→530000', '101→101000'])
    // Le 4671234, soldé, ne s'ouvre pas.
    expect(p.nonRanges.map((r) => `${r.compteOrigine}→${r.compte}`)).toEqual(['401100→401000', '401200→401000'])
  })

  it('le rangement de PC6 ne produit jamais ce que la base refuse ; celui d’hier, si', () => {
    const plans = [PLAN_PAR_DEFAUT, PLAN_DECALE]
    const numeros = ['512', '5121', '512100', '512999', '53', '531', '5300', '44551', '4455100', '445511', '4011', '401',
      '4010000', '164', '1641', '164100', '108', '1080000', '455', '4550', '467', '4670', '275', '2750', '58', '580',
      '511', '5111', '445800', '44574', '120', '129', '1061', '2183', '28183', '4456']
    for (const plan of plans) {
      const balance = numeros.map((n, i) => ligne(n, `Compte ${n}`, i % 2 ? 0 : 10, i % 2 ? 10 : 0))
      const surLePlan = preparerANouveauxSurLePlanSelon(balance, 2026, plan, true)
      expect(surLePlan.lignes.map((l) => refusDUnANouveau(l.compte, plan)).filter((r) => r !== null)).toEqual([])
      const hier = preparerANouveauxSelon(balance, 2026, plan, true)
      expect(hier.lignes.some((l) => refusDUnANouveau(l.compte, plan) !== null)).toBe(true)
    }
  })

  it('le drapeau baissé : la reprise d’hier, tant pour la préparation que pour l’écran', () => {
    expect(PLAN_DEPUIS_LA_BALANCE_PREVU).toBe(false)
    expect(preparerANouveaux(BALANCE, 2026, PLAN_PAR_DEFAUT)).toEqual(preparerANouveauxSelon(BALANCE, 2026, PLAN_PAR_DEFAUT, CAISSE_EXPORTEE))
    expect(preparerANouveauxSelonLesDrapeaux(BALANCE, 2026, PLAN_PAR_DEFAUT, true, true))
      .toEqual(preparerANouveauxSurLePlanSelon(BALANCE, 2026, PLAN_PAR_DEFAUT, true))
    expect(preparerANouveauxSelonLesDrapeaux(BALANCE, 2026, PLAN_PAR_DEFAUT, true, false))
      .toEqual(preparerANouveauxSelon(BALANCE, 2026, PLAN_PAR_DEFAUT, true))
    // Un seul écran appelle le module, la carte de la balance, et seulement derrière le drapeau (son second temps, PC6) :
    // baissé, elle ne lit pas les catégories et prépare comme hier (BalanceCardPlan.test.tsx le joue).
    const ecrans = ['src/pages', 'src/pages/dossier', 'src/components'].flatMap((d) =>
      readdirSync(new URL(d, RACINE)).filter((n) => n.endsWith('.tsx') && !n.endsWith('.test.tsx'))
        .map((n) => ({ chemin: `${d}/${n}`, texte: lire(`${d}/${n}`) })))
    const appelants = ecrans.filter((e) => e.texte.includes('planDepuisLaBalance'))
    expect(appelants.map((e) => e.chemin)).toEqual(['src/pages/dossier/BalanceCard.tsx'])
    expect(appelants[0].texte).toMatch(/if \(!PLAN_DEPUIS_LA_BALANCE_PREVU\) return/)
  })
})

describe('la migration plan_depuis_la_balance', () => {
  // Le texte SQL d'un message : l'apostrophe doublée dans la chaîne, typographique dans l'application.
  const enSql = (message: string) => message.replaceAll('’', "''")
  const motif = (message: string) => enSql(message).replace(/« [^»]* »/g, '« % »')

  it('dit les trois refus aux mots de refusDUnANouveau, dans le même ordre', () => {
    const banque = refusDUnANouveau('512100', PLAN_PAR_DEFAUT)!
    const caisse = refusDUnANouveau('531000', PLAN_PAR_DEFAUT)!
    const equivalent = refusDUnANouveau('4455100', PLAN_PAR_DEFAUT)!
    const positions = [banque, caisse, equivalent].map((m) => MIGRATION.indexOf(motif(m)))
    expect(positions.every((p) => p > 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
    expect(MIGRATION.indexOf(motif(equivalent))).toBeLessThan(MIGRATION.indexOf('À-nouveaux déséquilibrés'))
    expect(refusDUnANouveau('6611', PLAN_PAR_DEFAUT)).toBeNull()
  })

  // Le corps qu'une fonction garde (`prosrc`) : le texte entre ses deux `$$`.
  const corps = (texte: string, debut: string) => {
    const ouvre = texte.indexOf('as $$', texte.indexOf(debut)) + 'as $$'.length
    return texte.slice(ouvre, texte.indexOf('$$;', ouvre))
  }
  const md5 = (texte: string) => createHash('md5').update(texte).digest('hex')

  it('la garde de tête reconnaît le corps exporté, celle du retour le corps posé ; le retour le remet à l’octet', () => {
    const exporte = corps(CREATION, 'function public.enregistrer_a_nouveaux(')
    const pose = corps(MIGRATION, 'function public.enregistrer_a_nouveaux(')
    expect(MIGRATION).toContain(`is distinct from '${md5(exporte)}'`)
    expect(RETOUR).toContain(`is distinct from '${md5(pose)}'`)
    expect(corps(RETOUR, 'function public.enregistrer_a_nouveaux(')).toBe(exporte)
    expect(pose).toContain('delete from public.a_nouveaux where dossier_id = p_dossier_id;')
  })
})
