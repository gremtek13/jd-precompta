import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  composerEvaluation, MOTS_DES_REFUS, refusDuPlan, ROLES_D_INVENTAIRE, ROLES_DES_PROVISIONS, ROLES_DES_REGULARISATIONS,
  TABLES_DE_L_INVENTAIRE, TABLES_DES_DECLARATIONS, TABLES_DES_PROVISIONS, type ContexteDEvaluation, type RoleDInventaire,
  type SaisieDEvaluation,
} from './inventaire'
import { ROLES_COMPTABLES } from './planComptable'
import { CHEMINS_DOSSIER_PREVUS, ORDRE_RESTAURATION_PREVU, RELATIONS_PREVUES } from './sauvegarde'
import type { Provision } from './types'

// INV4 (ligne 35) : LA BASE REDIT LE MODULE. La migration `provisions` (préparée, après `operations_d_inventaire`) refuse ce
// que src/lib/inventaire.ts refuse, sous les mêmes mots, aux mêmes codes, dans le même ordre ; elle insère au catalogue les six
// rôles que le module déclare ; elle recompose, par différence, ce que `composerEvaluation` propose, et son essai
// (supabase/essais/provisions.sql, joué sur une réplique) attend les écritures que le module compose ici.

const lire = (chemin: string) => readFileSync(new URL(`../../${chemin}`, import.meta.url), 'utf8')
const MIGRATION = lire('supabase/preparees/20261112230000_provisions.sql')
const RETOUR = lire('supabase/preparees/retour/20261112230100_retour_provisions.sql')
const ESSAI = lire('supabase/essais/provisions.sql')
const ESSAI_DU_PLAN = lire('supabase/essais/planComptable.sql')
const RLS = lire('supabase/essais/rls.sql')

/** Le corps d'une fonction de la migration, ses littéraux concaténés recollés (`'…' || '…'` devient un seul littéral). */
function corps(nom: string): string {
  const debut = MIGRATION.search(new RegExp(`create function public\\.${nom}\\(`, 'i'))
  const fin = MIGRATION.indexOf('$fonction$;', debut)
  if (debut < 0 || fin < 0) throw new Error(`${nom} introuvable dans la migration`)
  return MIGRATION.slice(debut, fin).replace(/'\s*\|\|\s*'/g, '')
}
const PROVISION = corps('enregistrer_provision')
const RETRAIT = corps('retirer_provision')
const EVALUATION = corps('enregistrer_evaluation_provision')

const M = MOTS_DES_REFUS
const MODELE_DU_PLAN = 'Le plan du dossier ne porte pas de compte « %s » sous le %s : le régler avant d’écrire l’inventaire.'
const EXERCICE = [M.tresorerie, M.exercice, M.exerciceFige, M.exerciceAVenir, M.avantLOuverture]

/** Le code que la base lève pour le message : le premier `using errcode` qui le suit. */
function codeApres(texte: string, message: string): string | undefined {
  const i = texte.indexOf(message)
  return i < 0 ? undefined : /using errcode = '(\w+)'/.exec(texte.slice(i))?.[1]
}

function dansLOrdre(texte: string, ordre: readonly string[]) {
  const positions = ordre.map((m) => texte.indexOf(m))
  positions.forEach((p, i) => expect(p, ordre[i]).toBeGreaterThan(-1))
  for (let i = 1; i < positions.length; i++) expect(positions[i], ordre[i]).toBeGreaterThan(positions[i - 1])
}

describe('les refus des fonctions sont ceux du module', () => {
  it('enregistrer_provision : le mode, l’exercice, le genre, le compte, l’objet (l’ordre du module), puis la part reprise et la ventilation', () => {
    dansLOrdre(PROVISION, [...EXERCICE, M.genre, M.compteDeProvision.risque, M.compteDeProvision.depreciation_creance, M.objet,
      M.ciblePrecedente, M.ventilation])
    expect(codeApres(PROVISION, M.exerciceFige)).toBe('23514')
    for (const m of [M.tresorerie, M.exercice, M.exerciceAVenir, M.avantLOuverture, M.genre, M.objet, M.ciblePrecedente, M.ventilation]) {
      expect(codeApres(PROVISION, m), m).toBe('22023')
    }
  })

  it('enregistrer_evaluation_provision : le mode, l’exercice, le plan, la cible, puis la ventilation', () => {
    dansLOrdre(EVALUATION, [...EXERCICE, MODELE_DU_PLAN, M.cible, M.ventilation])
    expect(codeApres(EVALUATION, M.exerciceFige)).toBe('23514')
    for (const m of [M.tresorerie, M.exercice, M.cible, M.ventilation]) expect(codeApres(EVALUATION, m), m).toBe('22023')
  })

  it('le refus du plan : les dotations et les reprises des deux genres, aux noms et aux racines du module (`refusDuPlan`)', () => {
    const roles: RoleDInventaire[] = ['dotations_provisions_exploitation', 'reprises_provisions_exploitation',
      'dotations_depreciations_actif_circulant', 'reprises_depreciations_actif_circulant']
    for (const role of roles) {
      const { nom, racines } = ROLES_D_INVENTAIRE.find((r) => r.role === role)!
      expect(EVALUATION, role).toMatch(new RegExp(`(?:when '${role}' then|else) '${nom}'`))
      expect(MODELE_DU_PLAN.replace('%s', nom).replace('%s', racines.join(', '))).toBe(refusDuPlan(role).message)
    }
  })

  it('le retrait : l’accès, le mode, le gel, la version, sous les mêmes mots', () => {
    dansLOrdre(RETRAIT, ['Accès refusé à ce dossier.', M.tresorerie, M.exerciceFige])
    expect(codeApres(RETRAIT, M.exerciceFige)).toBe('23514')
  })
})

describe('l’évaluation par différence : la base compose ce que compose le module (INV-Q4 (A))', () => {
  const comptes = { dotations_provisions_exploitation: '681500', reprises_provisions_exploitation: '781500',
    dotations_depreciations_actif_circulant: '681700', reprises_depreciations_actif_circulant: '781700' }
  const contexte = (exercice: number, precedente: number): ContexteDEvaluation => ({
    modeComptable: 'engagement', comptes, ciblePrecedenteCentimes: precedente, reajustement: 'par_difference',
    exercice: { exercice, valide: false, anneeEnCours: 2026, premierExercice: null },
  })
  const litige: SaisieDEvaluation = { genre: 'risque', compteProvision: '151100', cibleCentimes: 500000, objet: 'Litige prud’homal' }

  it('la dotation de l’essai : 681500 au débit, la provision au crédit, sous le libellé composé', () => {
    const c = composerEvaluation(litige, contexte(2025, 0))
    if (!c.ok || !c.ecriture) throw new Error('composition refusée')
    expect(c.ecriture.libelle).toBe('Dotation 31/12/2025 — Provision pour risques — Litige prud’homal')
    expect(c.ecriture.lignes).toEqual([{ compte: '681500', sens: 'debit', centimes: 500000 }, { compte: '151100', sens: 'credit', centimes: 500000 }])
    expect(ESSAI).toContain(`lib25 text := '${c.ecriture.libelle}'`)
    expect(ESSAI).toContain('[["681500","debit",500000],["151100","credit",500000]]')
  })

  it('la reprise de l’essai : la provision au débit, 781500 au crédit ; un écart nul, aucune écriture', () => {
    const c = composerEvaluation({ ...litige, cibleCentimes: 300000 }, contexte(2026, 500000))
    if (!c.ok || !c.ecriture) throw new Error('composition refusée')
    expect(c.ecriture.libelle).toBe('Reprise 31/12/2026 — Provision pour risques — Litige prud’homal')
    expect(c.ecriture.lignes).toEqual([{ compte: '151100', sens: 'debit', centimes: 200000 }, { compte: '781500', sens: 'credit', centimes: 200000 }])
    expect(ESSAI).toContain(`lib26 text := '${c.ecriture.libelle}'`)
    expect(ESSAI).toContain('[["151100","debit",200000],["781500","credit",200000]]')
    const nul = composerEvaluation(litige, contexte(2026, 500000))
    expect(nul.ok && nul.ecriture).toBe(null)
  })

  it('les deux genres se nomment dans la base comme dans le module', () => {
    for (const genre of ['risque', 'depreciation_creance'] as const) {
      const c = composerEvaluation({ genre, compteProvision: genre === 'risque' ? '151100' : '491000', cibleCentimes: 1, objet: 'x' }, contexte(2025, 0))
      if (!c.ok || !c.ecriture) throw new Error('composition refusée')
      const nom = c.ecriture.libelle.split(' — ')[1]
      expect(EVALUATION, genre).toContain(`'${nom}'`)
    }
    expect(EVALUATION).toContain("case when v_ecart > 0 then 'Dotation' else 'Reprise' end || ' 31/12/' || v_exercice || ' — '")
  })
})

describe('la migration sous les règles de la base', () => {
  it('trois fonctions security definer, l’accès avant toute lecture, l’exécution retirée à l’anonyme ; les aides privées', () => {
    for (const [nom, signature, texte] of [['enregistrer_provision', '(uuid, jsonb, integer)', PROVISION],
      ['retirer_provision', '(uuid, uuid, integer)', RETRAIT],
      ['enregistrer_evaluation_provision', '(uuid, jsonb, jsonb, integer)', EVALUATION]] as const) {
      expect(texte, nom).toMatch(/ security definer\n set search_path = public\n/)
      const avant = texte.slice(texte.indexOf('\nbegin\n'), texte.indexOf('Accès refusé à ce dossier.'))
      expect(avant, nom).not.toMatch(/\bselect\b|\bfrom\b/)
      expect(MIGRATION, nom).toContain(`revoke execute on function public.${nom}${signature} from public, anon;`)
      expect(MIGRATION, nom).toContain(`grant execute on function public.${nom}${signature} to authenticated;`)
    }
    for (const prive of ['provision_cible_precedente(uuid, integer)', 'garder_provisions()', 'garder_evaluations_de_provision()']) {
      expect(MIGRATION, prive).toContain(`revoke execute on function public.${prive} from public, anon, authenticated;`)
    }
  })

  it('aucune destruction : ni drop ni truncate ; deux suppressions de lignes, dans ses fonctions (elle se colle)', () => {
    expect(MIGRATION).not.toMatch(/\bdrop\b|\btruncate\b/i)
    expect([...MIGRATION.matchAll(/\bdelete from\b/g)]).toHaveLength(2)
    expect(MIGRATION).toContain('PAS APPLIQUÉE. À COLLER')
  })

  it('elle exige INV2 et en épingle les fonctions ; ses rangs et ses racines sont libres', () => {
    expect(MIGRATION).toContain("if to_regclass('public.operations_inventaire') is null then")
    for (const f of ['inventaire_entier(jsonb)', 'inventaire_rogne(text)', 'garder_operations_inventaire()', 'garder_ecriture_d_inventaire()',
      'enregistrer_operation_inventaire(uuid, jsonb, jsonb, integer)', 'retirer_operation_inventaire(uuid, integer)']) {
      expect(MIGRATION, f).toMatch(new RegExp(`\\('${f.replace(/[()]/g, '\\$&')}', '[0-9a-f]{32}'\\)`))
    }
    expect(MIGRATION).toContain('r.ordre >= 420 and r.ordre <= 470')
  })

  it('la table : RLS, une seule policy à authenticated sur le cabinet du dossier, la garde ; le type la décrit', () => {
    expect(MIGRATION).toContain('alter table public.provisions enable row level security;')
    expect(MIGRATION).toContain('create policy provisions_cabinet on public.provisions\n  for all to authenticated using (public.admin_du_dossier(dossier_id)) with check (public.admin_du_dossier(dossier_id));')
    expect([...MIGRATION.matchAll(/create policy (\w+) on public\.provisions/gi)].map((m) => m[1])).toEqual(['provisions_cabinet', 'deux_facteurs'])
    const colonnes: Record<keyof Provision, true> = {
      id: true, dossier_id: true, genre: true, compte_provision: true, objet: true, facture_id: true, piece_citee_id: true,
      ouverte_en: true, reprise_centimes: true, version: true, cree_par: true, cree_le: true, modifie_par: true, modifie_le: true,
    }
    const table = /create table public\.provisions \(([\s\S]*?)\n\);/i.exec(MIGRATION)![1]
    const enBase = [...table.matchAll(/^ {2}([a-z_]+) (?:uuid|integer|text|bigint|date|timestamptz)\b/gm)].map((x) => x[1])
    expect(enBase.sort()).toEqual(Object.keys(colonnes).sort())
  })

  it('le plan de sauvegarde : ses relations sont les clés de la migration, sa table avant les opérations qui la citent', () => {
    const table = /create table public\.provisions \(([\s\S]*?)\n\);/i.exec(MIGRATION)![1]
    const cles = [...table.matchAll(/^\s+([a-z_]+) uuid[^,\n]* references public\.([a-z_]+)\(id\)( on delete (cascade|set null))?/gm)]
      .map(([, colonne, parent, , action]) => `${colonne} → ${parent} (${action === 'cascade' ? 'cascade' : 'bloque'})`).sort()
    expect(RELATIONS_PREVUES.filter((r) => r.enfant === 'provisions').map((r) => `${r.colonne} → ${r.parent} (${r.aLaSuppression})`).sort())
      .toEqual(cles)
    expect(cles).toEqual(['dossier_id → dossiers (cascade)', 'facture_id → factures_emises (bloque)', 'piece_citee_id → pieces (bloque)'])
    expect(TABLES_DE_L_INVENTAIRE).toEqual([...TABLES_DES_PROVISIONS, 'operations_inventaire', ...TABLES_DES_DECLARATIONS])
    expect(CHEMINS_DOSSIER_PREVUS.provisions).toEqual({ acces: 'direct' })
    expect(ORDRE_RESTAURATION_PREVU.indexOf('provisions') + 1).toBe(ORDRE_RESTAURATION_PREVU.indexOf('operations_inventaire'))
  })

  it('le retour défait tout ce que la migration pose', () => {
    for (const objet of ['drop function public.enregistrer_evaluation_provision(uuid, jsonb, jsonb, integer);',
      'drop function public.retirer_provision(uuid, uuid, integer);', 'drop function public.enregistrer_provision(uuid, jsonb, integer);',
      'drop trigger operations_inventaire_evaluation on public.operations_inventaire;',
      'drop function public.garder_evaluations_de_provision();', 'drop function public.provision_cible_precedente(uuid, integer);',
      'drop constraint operations_inventaire_une_evaluation_par_exercice;', 'drop constraint operations_inventaire_evaluation;',
      'drop column provision_id;', 'drop table public.provisions;', 'drop function public.garder_provisions();']) {
      expect(RETOUR, objet).toContain(objet)
    }
    for (const r of ROLES_DES_PROVISIONS) expect(RETOUR, r.role).toContain(`'${r.role}'`)
  })
})

describe('les six rôles des provisions au catalogue', () => {
  it('sont ceux que la migration insère, colonne par colonne', () => {
    const lignes = [...MIGRATION.matchAll(/\('(\w+)', array\[([^\]]*)\], '(\d+)', '((?:[^']|'')*)', null, (\d+)\)/g)]
      .map(([, role, racines, compte, libelle, ordre]) => ({
        role, racines: [...racines.matchAll(/'(\d+)'/g)].map((x) => x[1]), compteDefaut: compte, libelleDefaut: libelle.replace(/''/g, "'"),
        prefixeAuxiliaireDefaut: null, ordre: Number(ordre),
      }))
    expect(lignes).toEqual(ROLES_DES_PROVISIONS)
  })

  it('portent les racines que le module juge, aux rangs 420 à 470, et rien du catalogue ne les recouvre', () => {
    for (const r of ROLES_DES_PROVISIONS) {
      expect(r.racines, r.role).toEqual(ROLES_D_INVENTAIRE.find((x) => x.role === r.role)!.racines)
      expect(r.compteDefaut.startsWith(r.racines[0]), r.role).toBe(true)
      expect(r.ordre >= 420 && r.ordre <= 470, r.role).toBe(true)
      for (const a of [...ROLES_COMPTABLES, ...ROLES_DES_REGULARISATIONS].flatMap((x) => x.racines)) for (const b of r.racines) {
        expect(a.startsWith(b) || b.startsWith(a), `${r.role} ${a} / ${b}`).toBe(false)
      }
    }
    expect(new Set(ROLES_DES_PROVISIONS.map((r) => r.ordre)).size).toBe(6)
  })

  it('leur empreinte est celle que planComptable.sql exige quand la migration est en base', () => {
    const texte = ROLES_DES_PROVISIONS.map((r) => [r.role, r.racines.join(','), r.compteDefaut, r.libelleDefaut ?? '',
      r.prefixeAuxiliaireDefaut ?? '', String(r.ordre)].join('|')).join('\n')
    const epinglee = /empreinte_roles_provisions constant text := '([0-9a-f]{32})'/.exec(ESSAI_DU_PLAN)?.[1]
    expect(createHash('md5').update(texte, 'utf8').digest('hex')).toBe(epinglee)
    expect(ESSAI_DU_PLAN).toContain("m.name = 'provisions'")
  })
})

describe('les essais attendent les mots du module', () => {
  it('provisions.sql et rls.sql (le bloc PV)', () => {
    for (const m of [...EXERCICE, M.genre, M.compteDeProvision.risque, M.compteDeProvision.depreciation_creance, M.objet, M.cible,
      M.ciblePrecedente, M.ventilation]) {
      expect(ESSAI, m).toContain(`'${m.replace(/'/g, "''")}'`)
    }
    expect(RLS).toContain('-- ══ PV. Les provisions (ligne 35, INV4')
    expect(RLS).toContain("en_direct = '42501 Une provision ne s’écrit que par enregistrer_provision et retirer_provision.'")
    expect(MIGRATION).toContain("'Une provision ne s’écrit que par enregistrer_provision et retirer_provision.' using errcode = '42501'")
  })
})
