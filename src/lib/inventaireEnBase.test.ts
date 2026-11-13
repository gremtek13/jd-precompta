import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  composerRegularisation, composerRegularisationReprise, MOTS_DES_REFUS, NATURES_REPRISES, RACINES_DES_CHARGES_A_PAYER,
  RACINES_DES_FNP_HORS_ROLE, RACINES_DES_PRODUITS_A_RECEVOIR, RACINES_HORS_DE_L_INVENTAIRE, refusDuPlan, ROLES_D_INVENTAIRE,
  ROLES_DES_REGULARISATIONS, type ComptesDInventaire, type ContexteDeRegularisation, type RoleDInventaire, type SaisieDeRegularisation,
} from './inventaire'
import { ROLES_COMPTABLES } from './planComptable'
import type { OperationInventaire } from './types'

// INV2 (ligne 35) : LA BASE REDIT LE MODULE. La migration `operations_d_inventaire` (préparée) refuse ce que
// src/lib/inventaire.ts refuse, sous les mêmes mots, aux mêmes codes, dans le même ordre ; elle insère au catalogue les six
// rôles que le module déclare ; elle recompose ce que `composerRegularisation` propose, et son essai
// (supabase/essais/operationsDInventaire.sql, joué sur une réplique) écrit les mêmes écritures que le module compose ici.

const lire = (chemin: string) => readFileSync(new URL(`../../${chemin}`, import.meta.url), 'utf8')
const MIGRATION = lire('supabase/preparees/20261112190000_operations_d_inventaire.sql')
const RETOUR = lire('supabase/preparees/retour/20261112190100_retour_operations_d_inventaire.sql')
const ESSAI = lire('supabase/essais/operationsDInventaire.sql')
const ESSAI_DU_PLAN = lire('supabase/essais/planComptable.sql')
const RLS = lire('supabase/essais/rls.sql')

/** Le corps d'une fonction de la migration, ses littéraux concaténés recollés (`'…' || '…'` devient un seul littéral). */
function corps(nom: string): string {
  const debut = MIGRATION.search(new RegExp(`create function public\\.${nom}\\(`, 'i'))
  const fin = MIGRATION.indexOf('$fonction$;', debut)
  if (debut < 0 || fin < 0) throw new Error(`${nom} introuvable dans la migration`)
  return MIGRATION.slice(debut, fin).replace(/'\s*\|\|\s*'/g, '')
}
const ENREGISTRER = corps('enregistrer_operation_inventaire')
const RETIRER = corps('retirer_operation_inventaire')

const M = MOTS_DES_REFUS
const R = M.compteDeRegularisation
const MODELE_DU_PLAN = 'Le plan du dossier ne porte pas de compte « %s » sous le %s : le régler avant d’écrire l’inventaire.'

// L'ordre des contrôles du module (`refusDeLaRegularisation`), puis ceux que la base dit seule.
// La régularisation reprise (INV3-Q2 (A)) intercale ses quatre refus : la reprise lisible, sa place, sa nature, son compte.
const ORDRE: readonly string[] = [
  M.tresorerie, M.repriseIllisible, M.exercice, M.exerciceFige, M.exerciceAVenir, M.repriseHorsDeLOuverture, M.avantLOuverture,
  M.provisionParSonEvaluation, M.nature, M.natureReprise, MODELE_DU_PLAN, M.compteDeCharge, M.compteDeProduit, M.compteDeLaReprise,
  R.cca, R.pca, R.fnp, R.fae, R.charge_a_payer, R.produit_a_recevoir,
  M.montant, M.tvaIllisible, M.tvaHorsFacture, M.tvaNonAssujetti, M.objet, M.periode,
]

/** Le code que la base lève pour le message : le premier `using errcode` qui le suit. */
function codeApres(texte: string, message: string): string | undefined {
  const i = texte.indexOf(message)
  return i < 0 ? undefined : /using errcode = '(\w+)'/.exec(texte.slice(i))?.[1]
}

describe('les refus de enregistrer_operation_inventaire sont ceux du module', () => {
  it('chaque mot du module est dans la fonction, au caractère près, dans l’ordre des contrôles', () => {
    const positions = ORDRE.map((m) => ENREGISTRER.indexOf(m))
    positions.forEach((p, i) => expect(p, ORDRE[i]).toBeGreaterThan(-1))
    for (let i = 1; i < positions.length; i++) expect(positions[i], ORDRE[i]).toBeGreaterThan(positions[i - 1])
  })

  it('aux codes du module : 23514 l’exercice figé, 22023 toute autre saisie', () => {
    expect(codeApres(ENREGISTRER, M.exerciceFige)).toBe('23514')
    for (const m of ORDRE.filter((x) => x !== M.exerciceFige)) expect(codeApres(ENREGISTRER, m), m).toBe('22023')
    expect(codeApres(ENREGISTRER, 'Accès refusé à ce dossier.')).toBe('42501')
    expect(ENREGISTRER.indexOf('Accès refusé à ce dossier.')).toBeLessThan(ENREGISTRER.indexOf(M.tresorerie))
  })

  it('le refus du plan : le modèle de la base, rempli des noms et des racines du module, est `refusDuPlan`', () => {
    const roles: RoleDInventaire[] = ['charges_constatees_avance', 'produits_constates_avance', 'factures_a_etablir',
      'tva_factures_non_parvenues', 'tva_factures_a_etablir']
    for (const role of roles) {
      const { nom, racines } = ROLES_D_INVENTAIRE.find((r) => r.role === role)!
      expect(MODELE_DU_PLAN.replace('%s', nom).replace('%s', racines.join(', ')), role).toBe(refusDuPlan(role).message)
      expect(ENREGISTRER, role).toMatch(new RegExp(`(when '${role}' then|else) '${nom}'`))
    }
  })

  it('la TVA à la recommandation d’INV-Q3 (A) : la base ne dit jamais le refus « hors taxes »', () => {
    expect(ENREGISTRER).not.toContain(M.tvaHorsTaxes)
  })

  it('les listes fermées sont celles du module ; jamais le 467 ni le 468', () => {
    const liste = (r: readonly string[]) => `array[${r.map((x) => `'${x}'`).join(', ')}]`
    expect(ENREGISTRER).toContain(liste(RACINES_DES_CHARGES_A_PAYER))
    expect(ENREGISTRER).toContain(liste(RACINES_DES_PRODUITS_A_RECEVOIR))
    for (const r of RACINES_DES_FNP_HORS_ROLE) expect(ENREGISTRER).toContain(`starts_with(v_regul, '${r}')`)
    expect(ENREGISTRER).not.toMatch(/'46[78]/)
  })

  it('le retrait : l’accès, le mode, le gel, la version, sous les mêmes mots', () => {
    const ordre = ['Accès refusé à cette régularisation.', M.tresorerie, M.exerciceFige,
      'Cette régularisation a changé depuis sa lecture : relire l’inventaire avant de l’écrire.']
    const positions = ordre.map((m) => RETIRER.indexOf(m))
    positions.forEach((p, i) => expect(p, ordre[i]).toBeGreaterThan(-1))
    expect(codeApres(RETIRER, M.exerciceFige)).toBe('23514')
  })
})

describe('les deux fonctions et les gardes, sous les règles de la base', () => {
  it('security definer, search_path, l’accès avant toute lecture, l’exécution retirée à l’anonyme', () => {
    for (const [nom, signature] of [['enregistrer_operation_inventaire', 'uuid, jsonb, jsonb, integer'], ['retirer_operation_inventaire', 'uuid, integer']]) {
      const texte = corps(nom)
      expect(texte, nom).toMatch(/security definer\n set search_path = public/)
      expect(MIGRATION, nom).toContain(`revoke execute on function public.${nom}(${signature}) from public, anon;`)
      expect(MIGRATION, nom).toContain(`grant execute on function public.${nom}(${signature}) to authenticated;`)
    }
    expect(ENREGISTRER.indexOf('admin_du_dossier(p_dossier_id)')).toBeLessThan(ENREGISTRER.indexOf('from public.dossiers'))
    expect(ENREGISTRER.indexOf('pg_advisory_xact_lock_shared')).toBeLessThan(ENREGISTRER.indexOf('frontiere_validation'))
    for (const g of ['garder_operations_inventaire()', 'garder_ecriture_d_inventaire()', 'inventaire_entier(jsonb)', 'inventaire_rogne(text)']) {
      expect(MIGRATION, g).toContain(`revoke execute on function public.${g} from public, anon, authenticated;`)
    }
  })

  it('aucune destruction : ni drop ni truncate ; trois suppressions de lignes, dans les deux fonctions (elle se colle)', () => {
    expect(MIGRATION).not.toMatch(/\bdrop\b|\btruncate\b/i)
    expect(MIGRATION.match(/\bdelete from\b/gi)).toHaveLength(3)
    expect(MIGRATION).toMatch(/^-- .*À COLLER/m)
  })

  it('la table au catalogue : RLS, la lecture du cabinet, la porte de la restauration, aucune policy d’écriture', () => {
    expect(MIGRATION).toContain('alter table public.operations_inventaire enable row level security;')
    expect(MIGRATION).toContain('create policy operations_inventaire_lecture on public.operations_inventaire\n  for select to authenticated using (public.admin_du_dossier(dossier_id));')
    expect(MIGRATION).toContain('create policy operations_inventaire_restauration on public.operations_inventaire\n  for insert to authenticated with check (public.is_super_admin());')
    expect(MIGRATION.match(/create policy (?!deux_facteurs)/gi)).toHaveLength(2)
    expect(MIGRATION).toContain("if to_regprocedure('public.deux_facteurs_satisfaits()') is not null then")
  })

  it('le type décrit la table, colonne par colonne', () => {
    const colonnes: Record<keyof OperationInventaire, true> = {
      id: true, dossier_id: true, exercice: true, nature: true, compte_resultat: true, compte_regularisation: true,
      montant_centimes: true, tva_centimes: true, periode_debut: true, periode_fin: true, objet: true, piece_citee_id: true,
      version: true, cree_par: true, cree_le: true, modifie_par: true, modifie_le: true, provision_id: true, reprise: true,
    }
    const table = /create table public\.operations_inventaire \(([\s\S]*?)\n\);/i.exec(MIGRATION)![1]
    const enBase = [...table.matchAll(/^ {2}([a-z_]+) (?:uuid|integer|text|bigint|date|timestamptz|boolean)\b/gm)].map((x) => x[1])
    // La colonne qu'INV4 (`provisions`) ajoute à la table : l'évaluation d'une provision.
    const ajoutees = [...lire('supabase/preparees/20261112230000_provisions.sql')
      .matchAll(/alter table public\.operations_inventaire add column ([a-z_]+) (?:uuid|integer|text|bigint)\b/gi)].map((x) => x[1])
    expect(ajoutees).toEqual(['provision_id'])
    expect([...enBase, ...ajoutees].sort()).toEqual(Object.keys(colonnes).sort())
  })

  it('le retour défait tout ce que la migration pose', () => {
    for (const objet of ['drop function public.retirer_operation_inventaire(uuid, integer);',
      'drop function public.enregistrer_operation_inventaire(uuid, jsonb, jsonb, integer);',
      'drop trigger ecritures_brouillon_inventaire on public.ecritures_brouillon;', 'drop function public.garder_ecriture_d_inventaire();',
      'drop constraint ecritures_brouillon_inventaire_sans_autre_source;', 'drop column operation_inventaire_id;',
      'drop table public.operations_inventaire;', 'drop function public.garder_operations_inventaire();',
      'drop function public.inventaire_rogne(text);', 'drop function public.inventaire_entier(jsonb);']) {
      expect(RETOUR, objet).toContain(objet)
    }
    for (const r of ROLES_DES_REGULARISATIONS) expect(RETOUR, r.role).toContain(`'${r.role}'`)
  })
})

describe('les six rôles des régularisations au catalogue', () => {
  it('sont ceux que la migration insère, colonne par colonne', () => {
    const lignes = [...MIGRATION.matchAll(/\('(\w+)', array\[([^\]]*)\], '(\d+)', '((?:[^']|'')*)', null, (\d+)\)/g)]
      .map(([, role, racines, compte, libelle, ordre]) => ({
        role, racines: [...racines.matchAll(/'(\d+)'/g)].map((x) => x[1]), compteDefaut: compte, libelleDefaut: libelle.replace(/''/g, "'"),
        prefixeAuxiliaireDefaut: null, ordre: Number(ordre),
      }))
    expect(lignes).toEqual(ROLES_DES_REGULARISATIONS)
  })

  it('portent les racines que le module juge, et rien du catalogue de l’application ne les recouvre', () => {
    for (const r of ROLES_DES_REGULARISATIONS) {
      expect(r.racines, r.role).toEqual(ROLES_D_INVENTAIRE.find((x) => x.role === r.role)!.racines)
      expect(r.compteDefaut.startsWith(r.racines[0]), r.role).toBe(true)
      expect(ROLES_COMPTABLES.map((x) => x.role), r.role).not.toContain(r.role)
      for (const a of ROLES_COMPTABLES.flatMap((x) => x.racines)) for (const b of r.racines) {
        expect(a.startsWith(b) || b.startsWith(a), `${r.role} ${a} / ${b}`).toBe(false)
      }
    }
    expect(new Set(ROLES_DES_REGULARISATIONS.map((r) => r.ordre)).size).toBe(6)
    for (const r of ROLES_COMPTABLES) expect(r.ordre < 360 || r.ordre > 470, r.role).toBe(true)
  })

  it('leur empreinte est celle que planComptable.sql exige quand la migration est en base', () => {
    const texte = ROLES_DES_REGULARISATIONS.map((r) => [r.role, r.racines.join(','), r.compteDefaut, r.libelleDefaut ?? '',
      r.prefixeAuxiliaireDefaut ?? '', String(r.ordre)].join('|')).join('\n')
    const epinglee = /empreinte_roles_inventaire constant text := '([0-9a-f]{32})'/.exec(ESSAI_DU_PLAN)?.[1]
    expect(createHash('md5').update(texte, 'utf8').digest('hex')).toBe(epinglee)
    expect(ESSAI_DU_PLAN).toContain("m.name = 'operations_d_inventaire'")
  })
})

describe('l’essai écrit ce que le module compose', () => {
  const comptes: ComptesDInventaire = Object.fromEntries(ROLES_DES_REGULARISATIONS.map((r) => [r.role, r.compteDefaut]))
  const contexte: ContexteDeRegularisation = {
    modeComptable: 'engagement', assujettiTva: true, comptes, tvaDesFacturesAttendues: 'ttc_avec_tva_d_attente',
    exercice: { exercice: 2025, valide: false, anneeEnCours: 2026, premierExercice: null },
  }
  const enLignes = (lignes: { compte: string; sens: string; centimes: number }[]) =>
    JSON.stringify(lignes.map((l) => [l.compte, l.sens, l.centimes]))

  it('la CCA de l’essai : son libellé, ses lignes, son extourne', () => {
    const saisie: SaisieDeRegularisation = {
      nature: 'cca', compteResultat: '616000', libelleCompteResultat: "Primes d'assurance", compteRegularisation: '486000',
      montantCentimes: 120000, tvaCentimes: 0, objet: 'Assurance du local, 2026',
    }
    const c = composerRegularisation(saisie, contexte)
    if (!c.ok) throw new Error('refusée')
    expect(ESSAI).toContain(`lib_cca text := '${c.constatation.libelle.replace(/'/g, "''")}';`)
    expect(ESSAI).toContain(`'${enLignes(c.constatation.lignes).replace(/,/g, ',')}'`)
    expect(c.extourne).toEqual({ date: '2026-01-01', journal: 'OD', libelle: `Extourne — ${c.constatation.libelle}`,
      lignes: [{ compte: '486000', sens: 'credit', centimes: 120000 }, { compte: '616000', sens: 'debit', centimes: 120000 }] })
  })

  it('la FNP toutes taxes comprises de l’essai : la charge et la TVA d’attente au débit, le 408 au crédit', () => {
    const saisie: SaisieDeRegularisation = {
      nature: 'fnp', compteResultat: '622600', libelleCompteResultat: null, compteRegularisation: '408100',
      montantCentimes: 50000, tvaCentimes: 10000, objet: 'Honoraires de décembre',
    }
    const c = composerRegularisation(saisie, contexte)
    if (!c.ok) throw new Error('refusée')
    expect(ESSAI).toContain(`lib_fnp text := '${c.constatation.libelle}';`)
    expect(ESSAI).toContain(`'${enLignes(c.constatation.lignes)}'`)
  })

  it('l’essai et rls.sql attendent les mots du module, et rls.sql porte son bloc IV', () => {
    for (const m of ORDRE.filter((x) => x !== MODELE_DU_PLAN && x !== R.pca && x !== R.fae)) expect(ESSAI, m).toContain(m)
    expect(RLS).toContain('do $iv$')
    expect(RLS).toContain("EN ATTENTE de la migration operations_d_inventaire")
  })
})

describe('la régularisation reprise d’une balance (INV3-Q2 (A)), en base comme dans le module', () => {
  const tableau = (racines: readonly string[]) => `array[${racines.map((x) => `'${x}'`).join(', ')}]`

  it('ses natures, dans la contrainte de la table et dans la fonction : celles du module', () => {
    expect(MIGRATION).toContain(`constraint operations_inventaire_reprise check (not reprise or nature = any (${tableau(NATURES_REPRISES)}))`)
    expect(ENREGISTRER).toContain(`if v_reprise and not (v_nature = any (${tableau(NATURES_REPRISES)})) then`)
  })

  it('son compte : sous la racine de sa nature, lue au catalogue du module, hors du 4084', () => {
    const racine = (role: RoleDInventaire) => ROLES_D_INVENTAIRE.find((r) => r.role === role)!.racines[0]
    expect(ENREGISTRER).toContain(`case v_nature when 'cca' then '${racine('charges_constatees_avance')}' when 'pca' then '${racine('produits_constates_avance')}' `
      + `when 'fnp' then '${racine('factures_non_parvenues')}' else '${racine('factures_a_etablir')}' end) then`)
    expect(RACINES_HORS_DE_L_INVENTAIRE).toEqual(['4084'])
    expect(ENREGISTRER).toContain(`or starts_with(v_regul, '${RACINES_HORS_DE_L_INVENTAIRE[0]}')`)
    // Le plan d'une reprise ne fournit que la TVA d'attente.
    expect(ENREGISTRER).toContain("where not (v_reprise and r.role = any (array['charges_constatees_avance', 'produits_constates_avance', 'factures_a_etablir']))")
  })

  it('sa seule extourne : la recomposition sans la constatation, et une seule écriture reçue', () => {
    expect(ENREGISTRER).toContain('where (l.v ->> 2)::bigint > 0 and not v_reprise')
    expect(ENREGISTRER).toContain("jsonb_array_length(p_ecritures) = case when v_reprise then 1 else 2 end")
    expect(MIGRATION).toContain("and ((new.date = make_date(o.exercice, 12, 31) and not o.reprise)\n                           or new.date = make_date(o.exercice + 1, 1, 1))")
  })

  it('l’essai écrit la reprise que le module compose', () => {
    const comptes: ComptesDInventaire = Object.fromEntries(ROLES_DES_REGULARISATIONS.map((r) => [r.role, r.compteDefaut]))
    const c = composerRegularisationReprise({
      nature: 'cca', compteResultat: '616000', libelleCompteResultat: null, compteRegularisation: '486000', montantCentimes: 30000,
      tvaCentimes: 0, objet: 'Assurance 2025 reprise',
    }, {
      modeComptable: 'engagement', assujettiTva: true, comptes, tvaDesFacturesAttendues: 'ttc_avec_tva_d_attente',
      exercice: { exercice: 2024, valide: false, anneeEnCours: 2026, ouverture: '2025-01-01' },
    })
    if (!c.ok) throw new Error('refusée')
    expect(ESSAI).toContain(`lib_rep text := '${c.extourne.libelle.replace('Extourne — ', '')}';`)
    expect(c.extourne.lignes).toEqual([{ compte: '486000', sens: 'credit', centimes: 30000 }, { compte: '616000', sens: 'debit', centimes: 30000 }])
    expect(ESSAI).toContain("'[[\"486000\",\"debit\",30000],[\"616000\",\"credit\",30000]]'")
  })
})
