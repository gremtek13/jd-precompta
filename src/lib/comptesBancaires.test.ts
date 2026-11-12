import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { definitionsSql } from '../test/schema'
import {
  COMPTES_BANCAIRES_EN_BASE, COMPTES_BANCAIRES_PREVUS, LIBELLE_DU_COMPTE_PRINCIPAL, REFUS_DE_LA_GARDE, REFUS_DU_MOUVEMENT, REFUS_DU_PLAN,
  REFUS_PRINCIPAL_ABSENT, TABLES_DES_COMPTES_BANCAIRES, compteDeBanqueDuMouvement, compteDUnArrivantSansLeSien, dateDite,
  estUnPremierJanvier, formuler, refusDuCompteBancaire, refusDuPlan, type ContexteDUnCompte, type SaisieDUnCompte,
} from './comptesBancaires'

// PLUSIEURS COMPTES BANCAIRES D'UN DOSSIER (ligne 26.6, lot MCB1) : le module redit les refus de la migration
// `comptes_bancaires` — préparée le 11/11/2026, dans l'export depuis son collage du 12/11/2026 — fonction par fonction, dans
// l'ordre, au code près ; la règle de la jambe de banque ; son retour retire tout ce qu'elle pose ; ses deux essais
// exercent chaque refus. La migration se cherche où qu'elle soit, une fois.

function leFichier(motif: RegExp, dossiers: readonly string[]): { chemin: string; texte: string } {
  const trouves: string[] = []
  for (const dossier of dossiers) {
    const chemin = new URL(dossier, import.meta.url).pathname
    if (!existsSync(chemin)) continue
    for (const nom of readdirSync(chemin)) if (motif.test(nom)) trouves.push(chemin + nom)
  }
  expect(trouves, String(motif)).toHaveLength(1)
  return { chemin: trouves[0], texte: readFileSync(trouves[0], 'utf8') }
}

const MIGRATION = leFichier(/^\d{14}_comptes_bancaires\.sql$/, ['../../supabase/preparees/', '../../supabase/schema/'])
const RETOUR = leFichier(/^\d{14}_retour_comptes_bancaires\.sql$/, ['../../supabase/preparees/retour/']).texte
const ESSAI = readFileSync(new URL('../../supabase/essais/comptesBancaires.sql', import.meta.url), 'utf8')
const ESSAI_SUPPRESSION = readFileSync(new URL('../../supabase/essais/comptesBancairesSuppression.sql', import.meta.url), 'utf8')

function fonction(nom: string): string {
  const definitions = definitionsSql(nom, [{ chemin: 'comptes_bancaires', texte: MIGRATION.texte }])
  expect(definitions, nom).toHaveLength(1)
  return definitions[0].definition
}

/** Les refus d'un texte SQL, dans l'ordre : leurs mots (les apostrophes doublées rendues) et leur code. */
const refusSql = (sql: string) =>
  [...sql.matchAll(/raise exception '((?:[^']|'')*)'[\s\S]*?using errcode = '([0-9A-Z]{5})'/g)]
    .map((m) => ({ code: m[2], modele: m[1].replace(/''/g, "'") }))
const duModule = (liste: readonly { code: string; modele: string }[]) => liste.map((r) => ({ code: r.code, modele: r.modele }))

describe('les refus de la migration, aux mots et au code de la base', () => {
  it('garder_comptes_bancaires', () => {
    expect(refusSql(fonction('garder_comptes_bancaires'))).toEqual(duModule(REFUS_DE_LA_GARDE))
  })
  it('garder_compte_principal_present', () => {
    expect(refusSql(fonction('garder_compte_principal_present'))).toEqual(duModule([REFUS_PRINCIPAL_ABSENT]))
  })
  it('poser_compte_bancaire : le mouvement, puis le contrôle', () => {
    expect(refusSql(fonction('poser_compte_bancaire'))).toEqual(duModule(REFUS_DU_MOUVEMENT))
  })
  it('garder_plan_hors_des_comptes_bancaires', () => {
    expect(refusSql(fonction('garder_plan_hors_des_comptes_bancaires'))).toEqual(duModule([REFUS_DU_PLAN]))
  })
  it('la forme d’un compte propre et le libellé du principal sont ceux de la base', () => {
    expect(MIGRATION.texte.split("'^512[0-9]{3}$'")).toHaveLength(3)
    expect(MIGRATION.texte.split(`'${LIBELLE_DU_COMPTE_PRINCIPAL}'`)).toHaveLength(3)
    expect(MIGRATION.texte).toContain('length(libelle) <= 80')
  })
})

describe('chaque refus est exercé par un essai', () => {
  const essais = (ESSAI + ESSAI_SUPPRESSION).replace(/''/g, "'")
  const motif = (modele: string) => new RegExp(modele.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '[^\']+?'))
  for (const refus of [...REFUS_DE_LA_GARDE, REFUS_PRINCIPAL_ABSENT, ...REFUS_DU_MOUVEMENT, REFUS_DU_PLAN]) {
    it(refus.cle, () => {
      expect(essais).toMatch(motif(refus.modele))
    })
  }
  it('l’essai joué en production ne supprime rien ; celui des suppressions se joue sur une réplique', () => {
    expect(ESSAI).not.toMatch(/\bdelete\s+from\b/i)
    expect(ESSAI_SUPPRESSION).toMatch(/SUR UNE RÉPLIQUE SEULEMENT/)
  })
})

describe('la migration et son retour', () => {
  it('la migration ne supprime rien : l’outil l’applique sans confirmation', () => {
    expect(MIGRATION.texte).not.toMatch(/\b(delete\s+from|drop|truncate)\b/i)
  })
  it('le retour retire tout ce que la migration pose (les déclencheurs de la table partent avec elle)', () => {
    const poses = [
      ...[...MIGRATION.texte.matchAll(/create function public\.(\w+)/gi)].map((m) => m[1]),
      ...[...MIGRATION.texte.matchAll(/create (?:constraint )?trigger (\w+)\s+(?:before|after)[^;]*? on public\.(\w+)/gi)]
        .filter((m) => m[2] !== 'comptes_bancaires').map((m) => m[1]),
      ...[...MIGRATION.texte.matchAll(/create index (\w+)/gi)].map((m) => m[1]),
      ...[...MIGRATION.texte.matchAll(/add column (\w+)/gi)].map((m) => m[1]),
      ...TABLES_DES_COMPTES_BANCAIRES,
    ]
    expect(poses.length).toBeGreaterThanOrEqual(12)
    for (const nom of poses) expect(RETOUR, nom).toMatch(new RegExp(`drop (?:function|trigger|index|column|table) (?:public\\.)?${nom}\\b`, "i"))
  })
  it('la table entre au plan de sauvegarde avec la migration dans l’export ; les écrans, avec l’ouverture éclatée seulement', () => {
    const exportee = MIGRATION.chemin.includes('/supabase/schema/')
    expect(COMPTES_BANCAIRES_EN_BASE).toBe(exportee)
    // « MCB5G : l'appliquer après MCB1, avec ses écrans » : levés, les écrans ouvriraient un second compte dont l'ouverture ne
    // s'éclaterait pas, et liraient la colonne de l'ouverture éclatée — ses deux migrations doivent être dans l'export.
    const schema = readdirSync(new URL('../../supabase/schema/', import.meta.url))
    const ouverture = ['ouverture_eclatee_par_compte', 'ouverture_eclatee_a_la_validation']
      .every((nom) => schema.some((f) => new RegExp(`^\\d{14}_${nom}\\.sql$`).test(f)))
    expect(COMPTES_BANCAIRES_PREVUS).toBe(exportee && ouverture)
  })
  it('la jambe de banque de la base : le rôle pour le principal et avant le 1er janvier du compte, le sien ensuite', () => {
    const corps = fonction('compte_de_banque_du_mouvement')
    expect(corps).toContain('case when c.principal or l.date < c.compte_propre_depuis')
    expect(corps).toContain("then public.compte_du_role(l.dossier_id, 'banque')")
    expect(corps).toContain('else c.compte end')
  })
})

describe('la jambe de banque d’un mouvement', () => {
  const principal = { principal: true, compte: null, compte_propre_depuis: null }
  const second = { principal: false, compte: '512100', compte_propre_depuis: '2026-01-01' }
  it('le principal suit le compte du rôle banque, quel qu’il soit', () => {
    expect(compteDeBanqueDuMouvement(principal, '2026-03-04', '512000')).toBe('512000')
    expect(compteDeBanqueDuMouvement(principal, '2026-03-04', '512200')).toBe('512200')
  })
  it('un autre compte : le principal avant son 1er janvier (MCB-Q7), le sien dès ce jour', () => {
    expect(compteDeBanqueDuMouvement(second, '2025-12-31', '512000')).toBe('512000')
    expect(compteDeBanqueDuMouvement(second, '2026-01-01', '512000')).toBe('512100')
    expect(compteDeBanqueDuMouvement(second, '2026-01-02T00:00:00', '512000')).toBe('512100')
  })
})

describe('le compte d’un mouvement arrivé sans le sien', () => {
  it('aucun compte : le principal à créer ; un : lui ; deux : le refus de la base', () => {
    expect(compteDUnArrivantSansLeSien([])).toEqual({ cas: 'principal_a_creer' })
    expect(compteDUnArrivantSansLeSien([{ id: 'p' }])).toEqual({ cas: 'compte', id: 'p' })
    expect(compteDUnArrivantSansLeSien([{ id: 'p' }, { id: 's' }])).toEqual({ cas: 'refus', refus: {
      cle: 'plusieurs_comptes', code: '23502', message: 'Ce dossier tient plusieurs comptes bancaires : un mouvement ou un relevé dit le sien.' } })
  })
})

describe('la garde d’un compte, avant le clic', () => {
  const plan = [{ role: 'banque', compte: '512000' }, { role: 'caisse', compte: '530000' }]
  const dossier: ContexteDUnCompte['comptesDuDossier'] = [{ id: 'p', principal: true, compte: null }]
  const contexte = (avant: ContexteDUnCompte['avant'] = null, comptes = dossier): ContexteDUnCompte =>
    ({ comptesDuDossier: comptes, comptesDesRoles: plan, avant })
  const second: SaisieDUnCompte = { libelle: 'Banque pro 2', principal: false, compte: '512100', compte_propre_depuis: '2026-01-01', ouvert_le: null, clos_le: null }
  const cle = (s: SaisieDUnCompte, c: ContexteDUnCompte) => refusDuCompteBancaire(s, c)?.cle ?? null

  it('un second compte juste passe ; le refus de chaque règle, à ses mots', () => {
    expect(cle(second, contexte())).toBeNull()
    expect(cle({ ...second, libelle: ' \t' }, contexte())).toBe('libelle')
    expect(cle({ ...second, libelle: 'x'.repeat(81) }, contexte())).toBe('libelle')
    expect(cle({ ...second, compte: '5121' }, contexte())).toBe('forme_du_compte')
    expect(refusDuCompteBancaire({ ...second, compte: '411000' }, contexte())?.message)
      .toBe("Un compte bancaire autre que le principal tient son propre compte du plan, six chiffres qui commencent par 512 : « 411000 » n'en est pas un.")
    expect(refusDuCompteBancaire({ ...second, compte_propre_depuis: '2026-03-01' }, contexte())?.message)
      .toBe("Un compte bancaire tient son propre compte depuis le premier jour d'un exercice, un 1er janvier : « 01/03/2026 » n'en est pas un.")
    expect(refusDuCompteBancaire({ ...second, compte: '512000' }, contexte())?.message)
      .toBe("Le compte 512000 est celui du rôle « banque » du plan comptable du dossier : un compte bancaire tient un compte qui n'est qu'à lui.")
    expect(cle(second, contexte(null, [...dossier, { id: 's', principal: false, compte: '512100' }]))).toBe('compte_d_un_autre')
    expect(cle({ ...second, ouvert_le: '2026-02-01', clos_le: '2026-01-31' }, contexte())).toBe('periode')
  })

  it('le principal : ni compte ni date, et un seul par dossier', () => {
    const principal: SaisieDUnCompte = { ...second, principal: true, compte: null, compte_propre_depuis: null }
    expect(cle(principal, contexte(null, []))).toBeNull()
    expect(cle(principal, contexte())).toBe('second_principal')
    expect(cle({ ...principal, compte: '512100' }, contexte(null, []))).toBe('principal_sans_compte')
  })

  it('une modification : le rang jamais, le compte et la date figés au premier mouvement, la période autour des mouvements', () => {
    const avant = { id: 's', libelle: 'Banque pro 2', principal: false, compte: '512100', compte_propre_depuis: '2026-01-01',
      ouvert_le: null, clos_le: null, porteDesMouvementsOuDesReleves: true, datesDesMouvements: ['2026-01-05'] }
    const comptes = [...dossier, { id: 's', principal: false, compte: '512100' }]
    expect(cle(second, contexte(avant, comptes))).toBeNull()
    expect(cle({ ...second, libelle: 'Renommé' }, contexte(avant, comptes))).toBeNull()
    expect(cle({ ...second, principal: true }, contexte(avant, comptes))).toBe('rang')
    expect(refusDuCompteBancaire({ ...second, compte: '512200' }, contexte(avant, comptes))?.message)
      .toBe('Le compte bancaire « Banque pro 2 » porte déjà des mouvements ou des relevés : son compte du plan et la date depuis laquelle il le tient ne changent plus.')
    expect(cle({ ...second, compte: '512200' }, contexte({ ...avant, porteDesMouvementsOuDesReleves: false }, comptes))).toBeNull()
    expect(cle({ ...second, clos_le: '2026-01-04' }, contexte(avant, comptes))).toBe('periode_des_mouvements')
    expect(cle({ ...second, ouvert_le: '2026-01-06' }, contexte(avant, comptes))).toBe('periode_des_mouvements')
    expect(cle({ ...second, clos_le: '2026-01-05' }, contexte(avant, comptes))).toBeNull()
  })
})

describe('le plan, les mots, les dates', () => {
  it('un rôle ne prend pas le compte d’un compte bancaire', () => {
    const comptes = [{ libelle: 'Banque pro 2', compte: '512100' }, { libelle: 'Compte principal', compte: null }]
    expect(refusDuPlan(comptes, 'banque', '512100')?.message)
      .toBe('Le compte 512100 tient le compte bancaire « Banque pro 2 » du dossier : le rôle « banque » du plan ne le prend pas.')
    expect(refusDuPlan(comptes, 'banque', '512200')).toBeNull()
  })
  it('formuler pose les valeurs dans l’ordre ; une date se dit JJ/MM/AAAA ; un 1er janvier se reconnaît', () => {
    expect(formuler(REFUS_DU_MOUVEMENT.find((r) => r.cle === 'hors_periode')!, '30/12/2025', 'X').message)
      .toBe("Le mouvement du 30/12/2025 tombe hors de la période du compte bancaire « X » : ses dates d'ouverture et de clôture l'encadrent.")
    expect(dateDite('2026-03-01')).toBe('01/03/2026')
    expect(estUnPremierJanvier('2026-01-01')).toBe(true)
    expect(estUnPremierJanvier('2026-01-02')).toBe(false)
  })
})
