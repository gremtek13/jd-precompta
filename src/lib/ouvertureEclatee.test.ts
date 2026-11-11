import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { COMPTES_BANCAIRES_PREVUS } from './comptesBancaires'
import type { CompteDuReleve } from './importParCompte'
import {
  REFUS_DE_LA_VALIDATION, REFUS_DE_L_ECLATEMENT, REFUS_DU_CLIC, eclatementsAFaire, etatDeLEclatement, eurosDeLaBase, libelleDeLEclatement,
  ouvertureEclateeAttendue, phraseDeLEclatement, refusALaValidation, type EntreesDeLEclatement,
} from './ouvertureEclatee'
import { releveParCompte } from './releveParCompte'
import type { ControleReleveBancaire } from './types'

// Le module confronté au texte de la migration `ouverture_eclatee_par_compte`, et rejoué sur les cas de son essai
// (supabase/essais/ouvertureEclatee.sql) : les mêmes comptes, les mêmes relevés, les mêmes lignes et les mêmes refus.
const MIGRATION = readFileSync('supabase/preparees/20261111235000_ouverture_eclatee_par_compte.sql', 'utf8')
const enSql = (modele: string) => modele.replace(/'/g, "''")

const P: CompteDuReleve = { id: 'p', libelle: 'Compte principal', principal: true, fin_d_identifiant: null, compte: null,
  compte_propre_depuis: null, ouvert_le: null, clos_le: null }
const S: CompteDuReleve = { id: 's', libelle: 'ESSAI SECOND', principal: false, fin_d_identifiant: null, compte: '512200',
  compte_propre_depuis: '2026-01-01', ouvert_le: '2024-06-01', clos_le: null }

const controle = (compte: string, fichier: string, debut: string, fin: string, initial: number, final: number, somme: number,
  coherent = true): ControleReleveBancaire & { compte_bancaire_id: string } => ({
  id: `${compte}-${fichier}`, dossier_id: 'd', source_fichier: fichier, solde_initial: initial, solde_final: final,
  somme_mouvements: somme, ecart: 0, coherent, periode_debut: debut, periode_fin: fin, created_at: '2026-01-02T00:00:00Z',
  compte_bancaire_id: compte,
})
const ligne = (compte: string, fichier: string, date: string, montant: number) =>
  ({ compte_bancaire_id: compte, source_fichier: fichier, date, montant })

const RELEVE_P = { lignes: [ligne('p', 'p_dec.csv', '2025-12-15', 100)], controles: [controle('p', 'p_dec.csv', '2025-12-01', '2025-12-31', 900, 1000, 100)] }
const RELEVE_S = { lignes: [ligne('s', 's_dec.csv', '2025-12-10', 50)], controles: [controle('s', 's_dec.csv', '2025-12-01', '2025-12-31', 200, 250, 50)] }
const report = (montant: number) => [{ date: '2026-01-01', compte: '512000', sens: 'debit' as const, montant },
  { date: '2026-01-01', compte: '101000', sens: 'credit' as const, montant }]

function entrees(o: { comptes?: CompteDuReleve[]; releves?: { lignes: ReturnType<typeof ligne>[]; controles: ReturnType<typeof controle>[] }[];
  reprise?: EntreesDeLEclatement['reprise']; reportes?: EntreesDeLEclatement['reportes']; validees?: number[] } = {}): EntreesDeLEclatement {
  const releves = o.releves ?? [RELEVE_P, RELEVE_S]
  const lignes = releves.flatMap((r) => r.lignes)
  const decoupe = releveParCompte({ etat: 'lus', comptes: o.comptes ?? [P, S] }, lignes, releves.flatMap((r) => r.controles))
  if (decoupe.etat !== 'parts') throw new Error(decoupe.raison)
  return { annee: 2026, role: '512000', parts: decoupe.parts, reprise: o.reprise ?? [], reportes: o.reportes ?? report(1250),
    anneesValidees: o.validees ?? [2025], datesDesEcritures: [], datesDesMouvements: lignes.map((l) => l.date) }
}
const LIBELLE = 'Ouverture du 512200 au relevé du 31/12/2025'
const BONNE = [
  { compte_bancaire_id: 's', compte: '512200', sens: 'debit', montant: 250, libelle: LIBELLE },
  { compte_bancaire_id: 's', compte: '512000', sens: 'credit', montant: 250, libelle: LIBELLE },
]
const message = (r: ReturnType<typeof ouvertureEclateeAttendue>) => (r.etat === 'refus' ? r.refus.message : r.etat)

describe("l'éclatement de l'ouverture, au texte de la migration", () => {
  it('chaque refus, son code et ses mots, dans l’ordre des fonctions', () => {
    let position = 0
    for (const r of [...REFUS_DE_L_ECLATEMENT, ...REFUS_DU_CLIC]) {
      const morceaux = enSql(r.modele).split('%')
      const debut = MIGRATION.indexOf(morceaux[0], position)
      expect(debut, r.cle).toBeGreaterThan(-1)
      for (const m of morceaux) expect(MIGRATION.slice(debut).includes(m), r.cle).toBe(true)
      expect(MIGRATION.slice(debut, debut + 900)).toContain(`errcode = '${r.code}'`)
      if (r.cle !== 'acces' && r.cle !== 'exercice') position = debut
    }
  })
  it('le libellé de la paire et les euros sont ceux de la base', () => {
    expect(MIGRATION).toContain("format('Ouverture du %s au relevé du %s', v_compte.compte, to_char(v_veille, 'DD/MM/YYYY'))")
    expect(libelleDeLEclatement('512200', '2025-12-31')).toBe(LIBELLE)
    expect(MIGRATION).toContain("replace(to_char(v_somme / 100.0, 'FM999999999990.00'), '.', ',')")
    expect([eurosDeLaBase(125000), eurosDeLaBase(-3000), eurosDeLaBase(5)]).toEqual(['1250,00', '-30,00', '0,05'])
  })
  it('le drapeau ne se lève qu’avec la migration dans l’export', () => {
    const exportee = readdirSync('supabase/schema').some((f) => f.endsWith('_ouverture_eclatee_par_compte.sql'))
    if (COMPTES_BANCAIRES_PREVUS) expect(exportee).toBe(true)
    else expect(exportee).toBe(false)
  })
})

describe("l'éclatement attendu, sur les cas de l'essai", () => {
  it('10. le solde du second compte au 31/12/2025 passe au 512200, face au 512000', () => {
    expect(ouvertureEclateeAttendue(entrees())).toEqual({ etat: 'lignes', lignes: BONNE })
  })
  it('17 à 20. les refus, à leurs mots', () => {
    expect(message(ouvertureEclateeAttendue(entrees({ releves: [RELEVE_P] })))).toBe('Le solde au 31/12/2025 du compte bancaire « ESSAI SECOND » ne se lit sur aucun de ses relevés contrôlés : importer le relevé qui finit ce jour-là, ou celui qui le couvre, avant d\'éclater l\'ouverture de la banque.')
    expect(message(ouvertureEclateeAttendue(entrees({ releves: [RELEVE_P, { lignes: RELEVE_S.lignes,
      controles: [...RELEVE_S.controles, controle('s', 's_annuel.csv', '2025-01-01', '2025-12-31', 0, 260, 260)] }] })))).toBe(
      'Les relevés du compte bancaire « ESSAI SECOND » disent des soldes différents au 31/12/2025 : l\'un d\'eux ne dit pas le bon, et l\'ouverture de la banque ne s\'éclate pas.')
    expect(message(ouvertureEclateeAttendue(entrees({ reportes: report(1300) })))).toBe(
      'Les soldes des relevés au 31/12/2025 (1250,00 €) ne font pas l\'ouverture du compte 512000 (1300,00 €) : l\'ouverture de la banque ne s\'éclate pas entre ses comptes.')
    expect(message(ouvertureEclateeAttendue(entrees({ releves: [RELEVE_S] })))).toContain('« Compte principal »')
  })
  it('21 à 23. le relevé qui couvre le 31/12, celui de janvier, un compte à découvert', () => {
    const couvre = { lignes: [ligne('s', 's_cov.csv', '2025-12-20', 40), ligne('s', 's_cov.csv', '2026-01-05', 30)],
      controles: [controle('s', 's_cov.csv', '2025-12-15', '2026-01-15', 210, 280, 70)] }
    expect(ouvertureEclateeAttendue(entrees({ releves: [RELEVE_P, couvre] }))).toEqual({ etat: 'lignes', lignes: BONNE })
    const janvier = { lignes: [ligne('s', 's_jan.csv', '2026-01-10', 50)], controles: [controle('s', 's_jan.csv', '2026-01-01', '2026-01-31', 250, 300, 50)] }
    expect(ouvertureEclateeAttendue(entrees({ releves: [RELEVE_P, janvier] }))).toEqual({ etat: 'lignes', lignes: BONNE })
    const decouvert = { lignes: [ligne('s', 's_dec.csv', '2025-12-10', -50)], controles: [controle('s', 's_dec.csv', '2025-12-01', '2025-12-31', 20, -30, -50)] }
    const r = ouvertureEclateeAttendue(entrees({ releves: [RELEVE_P, decouvert], reportes: report(970) }))
    expect(r.etat === 'lignes' && r.lignes.map((l) => `${l.compte}:${l.sens}:${l.montant}`)).toEqual(['512200:credit:30', '512000:debit:30'])
  })
  it('24 à 29. rien à éclater : clos, ouvert après, un seul compte, premier exercice ; la reprise de même ; l’ouverture attendue', () => {
    expect(ouvertureEclateeAttendue(entrees({ comptes: [P, { ...S, clos_le: '2025-11-30' }], releves: [] }))).toEqual({ etat: 'rien' })
    expect(ouvertureEclateeAttendue(entrees({ comptes: [P, { ...S, ouvert_le: '2026-02-01' }], releves: [RELEVE_P], reportes: report(1000) }))).toEqual({ etat: 'rien' })
    expect(ouvertureEclateeAttendue(entrees({ comptes: [P], releves: [RELEVE_P], reportes: report(1000) }))).toEqual({ etat: 'rien' })
    expect(ouvertureEclateeAttendue(entrees({ releves: [], reportes: [], validees: [] }))).toEqual({ etat: 'rien' })
    expect(ouvertureEclateeAttendue(entrees({ reportes: [], validees: [], reprise: report(1250) }))).toEqual({ etat: 'lignes', lignes: BONNE })
    expect(message(ouvertureEclateeAttendue(entrees({ reportes: [], validees: [] })))).toBe(
      'L\'exercice 2026 n\'a pas encore d\'ouverture : elle s\'écrira à la validation de l\'exercice 2025, et l\'ouverture de la banque s\'éclatera ensuite entre ses comptes.')
  })
  it('le drapeau baissé : une part sans compte, rien à éclater, comme hier', () => {
    const decoupe = releveParCompte({ etat: 'sans_objet' }, [...RELEVE_P.lignes, ...RELEVE_S.lignes], [...RELEVE_P.controles, ...RELEVE_S.controles])
    expect(decoupe.etat === 'parts' && ouvertureEclateeAttendue({ ...entrees(), parts: decoupe.parts })).toEqual({ etat: 'rien' })
  })
})

describe("l'état de l'éclatement dans le brouillon", () => {
  const ecrite = (l: (typeof BONNE)[number]) => ({ date: '2026-01-01', compte: l.compte, sens: l.sens as 'debit' | 'credit',
    montant: l.montant, libelle: l.libelle, ouverture_compte_bancaire_id: l.compte_bancaire_id })
  const attendu = ouvertureEclateeAttendue(entrees())
  it('à écrire, à jour, à réécrire, à retirer, sans objet, retenu', () => {
    expect(etatDeLEclatement(attendu, [], 2026).etat).toBe('a_ecrire')
    expect(etatDeLEclatement(attendu, BONNE.map(ecrite), 2026).etat).toBe('a_jour')
    expect(etatDeLEclatement(attendu, [ecrite({ ...BONNE[0], montant: 249.99 }), ecrite(BONNE[1])], 2026).etat).toBe('a_reecrire')
    expect(etatDeLEclatement({ etat: 'rien' }, BONNE.map(ecrite), 2026).etat).toBe('a_retirer')
    expect(etatDeLEclatement({ etat: 'rien' }, [{ ...ecrite(BONNE[0]), ouverture_compte_bancaire_id: null }], 2026).etat).toBe('sans_objet')
    expect(etatDeLEclatement(ouvertureEclateeAttendue(entrees({ reportes: report(1300) })), [], 2026).etat).toBe('retenu')
  })
})

// ── Le filet de la validation (MCB5G-Q2) ─────────────────────────────────────────────────────────────────────────────────
// La migration `ouverture_eclatee_a_la_validation` (préparée) : un déclencheur sur `exercices_valides` qui refuse la validation
// d'un exercice dont l'écriture qui éclate l'ouverture manque, n'est plus à jour ou n'a plus rien à éclater — aux mots du
// préalable `ouverture-a-eclater`. Son essai : les contrôles 40 à 51 de supabase/essais/ouvertureEclatee.sql.
describe('le filet de la validation, au texte de sa migration', () => {
  const FILET = readFileSync('supabase/preparees/20261111235500_ouverture_eclatee_a_la_validation.sql', 'utf8')
  const RETOUR_FILET = readFileSync('supabase/preparees/retour/20261111235600_retour_ouverture_eclatee_a_la_validation.sql', 'utf8')
  const RETOUR_OUVERTURE = readFileSync('supabase/preparees/retour/20261111235100_retour_ouverture_eclatee_par_compte.sql', 'utf8')
  const ESSAI = readFileSync('supabase/essais/ouvertureEclatee.sql', 'utf8')
  const DEPART = readFileSync('supabase/preparees/20261111191000_depart_du_client.sql', 'utf8')
  const attendu = ouvertureEclateeAttendue(entrees())
  const ecrite = (l: (typeof BONNE)[number]) => ({ date: '2026-01-01', compte: l.compte, sens: l.sens as 'debit' | 'credit',
    montant: l.montant, libelle: l.libelle, ouverture_compte_bancaire_id: l.compte_bancaire_id })
  const ETATS = {
    a_ecrire: etatDeLEclatement(attendu, [], 2026),
    a_reecrire: etatDeLEclatement(attendu, [ecrite({ ...BONNE[0], montant: 200 }), ecrite({ ...BONNE[1], montant: 200 })], 2026),
    a_retirer: etatDeLEclatement({ etat: 'rien' }, BONNE.map(ecrite), 2026),
  }

  it('chaque refus, son code et ses mots, dans l’ordre du corps du déclencheur', () => {
    let position = 0
    for (const r of REFUS_DE_LA_VALIDATION) {
      const morceaux = r.modele.split('%')
      const debut = FILET.indexOf(`raise exception '${morceaux[0]}`, position)
      expect(debut, r.cle).toBeGreaterThan(position)
      const raise = FILET.slice(debut, FILET.indexOf(';', debut))
      for (const m of morceaux) expect(raise, r.cle).toContain(m)
      expect(raise).toContain(`errcode = '${r.code}'`)
      expect(raise.match(/to_char\(v_(debut|veille), 'DD\/MM\/YYYY'\)/g)?.length, r.cle).toBe(morceaux.length - 1)
      position = debut
    }
  })

  it('le préalable, la carte et la base disent les mêmes mots ; à jour et sans objet, rien', () => {
    for (const [cle, etat] of Object.entries(ETATS)) {
      expect(etat.etat).toBe(cle)
      const refus = refusALaValidation(etat, 2026)
      expect(refus?.code).toBe('23514')
      expect(phraseDeLEclatement(etat, 2026)).toBe(refus?.message)
    }
    const retenu = etatDeLEclatement(ouvertureEclateeAttendue(entrees({ reportes: report(1300) })), [], 2026)
    expect(refusALaValidation(retenu, 2026)).toEqual(retenu.etat === 'retenu' ? retenu.refus : null)
    expect(refusALaValidation(etatDeLEclatement(attendu, BONNE.map(ecrite), 2026), 2026)).toBeNull()
    expect(refusALaValidation({ etat: 'sans_objet' }, 2026)).toBeNull()
  })

  it('l’essai attend ces mots, de 2026 et de 2025 (valider_exercice, de bout en bout)', () => {
    for (const etat of Object.values(ETATS)) expect(ESSAI).toContain(`'23514|${refusALaValidation(etat, 2026)?.message}'`)
    expect(ESSAI).toContain(`'23514|${refusALaValidation(ETATS.a_ecrire, 2025)?.message}'`)
    expect(refusALaValidation(ETATS.a_ecrire, 2025)?.message).toContain('relevés du 31/12/2024')
  })

  it('jugée sous le propriétaire, jamais sous le rôle de l’API ; ni definer, ni exemption du super-administrateur', () => {
    const corps = FILET.slice(FILET.search(/create function public\.garder_ouverture_eclatee_a_la_validation\(\)/i), FILET.indexOf('$$;'))
    expect(corps).toContain("if current_user = 'authenticated' then\n    return new;")
    expect(corps).not.toMatch(/security definer|is_super_admin/i)
    expect(FILET).toContain("'public.valider_exercice(uuid, integer, jsonb, jsonb, jsonb)'::regprocedure\n                  and prosecdef")
    expect(FILET).not.toMatch(/\b(drop|delete|truncate)\b/i)
  })

  it('le déclencheur suit celui de la conservation d’un dossier qui part (l’ordre des noms)', () => {
    const noms = [...FILET.matchAll(/create trigger (\w+)\n  before insert on public\.exercices_valides/gi),
      ...DEPART.matchAll(/create trigger (\w+)\n  before insert on public\.exercices_valides/gi)].map((m) => m[1])
    expect(noms).toEqual(['exercices_valides_ouverture_eclatee', 'exercices_valides_dossier_conserve'])
    expect([...noms].sort()).toEqual(['exercices_valides_dossier_conserve', 'exercices_valides_ouverture_eclatee'])
  })

  it('les retours : le sien retire le déclencheur et sa fonction ; celui de l’ouverture éclatée l’attend', () => {
    expect(RETOUR_FILET).toMatch(/drop trigger exercices_valides_ouverture_eclatee on public\.exercices_valides;/i)
    expect(RETOUR_FILET).toMatch(/drop function public\.garder_ouverture_eclatee_a_la_validation\(\);/i)
    expect(RETOUR_OUVERTURE).toContain("if to_regprocedure('public.garder_ouverture_eclatee_a_la_validation()') is not null then")
    expect(RETOUR_OUVERTURE.indexOf('garder_ouverture_eclatee_a_la_validation')).toBeLessThan(RETOUR_OUVERTURE.search(/^drop /im))
  })
})

// ── Les exercices dont l'éclatement appelle un clic (MCB5g ; le point `ouverture-a-eclater` de la Vue d'ensemble) ─────────
describe('les exercices dont l’éclatement appelle un clic', () => {
  const { annee: _annee, ...sansAnnee } = entrees()
  const ecrite = (l: (typeof BONNE)[number], date = '2026-01-01') => ({ date, compte: l.compte, sens: l.sens as 'debit' | 'credit',
    montant: l.montant, libelle: l.libelle, ouverture_compte_bancaire_id: l.compte_bancaire_id })
  const A_ECRIRE = { annee: 2026, etat: 'a_ecrire', phrase: phraseDeLEclatement({ etat: 'a_ecrire', lignes: [] }, 2026) }

  it('l’exercice qu’un compte ouvre, et celui d’une ligne de la source ; jamais un exercice validé', () => {
    expect(eclatementsAFaire(sansAnnee, [])).toEqual([A_ECRIRE])
    expect(eclatementsAFaire(sansAnnee, BONNE.map((l) => ecrite(l)))).toEqual([])
    // Une ligne de la source au 01/01/2025, exercice validé : figée avec lui, elle ne se dit pas.
    expect(eclatementsAFaire(sansAnnee, [ecrite(BONNE[0], '2025-01-01')])).toEqual([A_ECRIRE])
    // Une ligne au 01/01/2027, où rien n'est à éclater : à retirer, après 2026.
    expect(eclatementsAFaire(sansAnnee, [ecrite(BONNE[0], '2027-01-01')]).map((x) => [x.annee, x.etat])).toEqual([[2026, 'a_ecrire'], [2027, 'a_retirer']])
    expect(eclatementsAFaire({ ...sansAnnee, anneesValidees: [2025, 2026] }, [])).toEqual([])
  })

  it('sous une balance reprise au 01/01/2026, un compte propre depuis 2025 : l’exercice de la reprise', () => {
    const { annee: _a, ...repris } = entrees({ comptes: [P, { ...S, compte_propre_depuis: '2025-01-01' }], reprise: report(1250), reportes: [], validees: [] })
    expect(eclatementsAFaire(repris, []).map((x) => [x.annee, x.etat])).toEqual([[2026, 'a_ecrire']])
  })

  it('une ouverture retenue ne se dit pas : rien ne s’y écrit d’un clic', () => {
    const { annee: _a, ...retenue } = entrees({ reportes: report(1300) })
    expect(eclatementsAFaire(retenue, [])).toEqual([])
  })
})
