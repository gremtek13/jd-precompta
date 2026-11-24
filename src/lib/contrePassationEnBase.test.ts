import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  CODES_DE_LA_CONTRE_PASSATION, CODES_DE_LA_GARDE_DE_LA_CONTRE_PASSATION, CONTRE_PASSATION_DES_ECRITURES_LIBRES_PREVUE,
  composerLaContrePassation, contrePassationPourLaBase, libelleProposeDeLaContrePassation, MOTS_DE_LA_CONTRE_PASSATION,
  MOTS_DE_LA_GARDE_DE_LA_CONTRE_PASSATION, type EcritureContrePassable,
} from './contrePassationDesEcrituresLibres'
import { MOTS_DE_LA_BASE, MOTS_DES_REFUS } from './ecritureLibre'

// EL7 : LA BASE REDIT LE MODULE. La migration `contre_passation_des_ecritures_libres` (préparée) refuse ce que
// src/lib/contrePassationDesEcrituresLibres.ts refuse, sous les mêmes mots, aux mêmes codes, dans le même ordre ; ceux qu'elle
// partage avec `enregistrer_ecriture_libre` sont les siens (EL2) ; sa garde dit les mots du module ; son essai
// (supabase/essais/contrePassationDesEcrituresLibres.sql, joué sur une réplique) et le bloc XL de rls.sql attendent les mêmes, et
// le bloc envoie à la base ce que le module compose ; le retour défait tout ce qu'elle pose.

const lire = (chemin: string) => readFileSync(new URL(`../../${chemin}`, import.meta.url), 'utf8')
// La migration se lit là où elle est : préparée, ou rangée dans l'export sous la version que la production lui donnera.
const PREPAREE = 'supabase/preparees/20261124120000_contre_passation_des_ecritures_libres.sql'
const RANGEE = readdirSync(new URL('../../supabase/schema/', import.meta.url))
  .filter((f) => /^\d{14}_contre_passation_des_ecritures_libres\.sql$/.test(f)).map((f) => `supabase/schema/${f}`)
const MIGRATION = lire(RANGEE[0] ?? PREPAREE)
const RETOUR = lire('supabase/preparees/retour/20261124120100_retour_contre_passation_des_ecritures_libres.sql')
const ESSAI = lire('supabase/essais/contrePassationDesEcrituresLibres.sql')
const RLS = lire('supabase/essais/rls.sql')
const RESTAURATION = lire('supabase/essais/restauration.sql')
const EL2 = lire(readdirSync(new URL('../../supabase/schema/', import.meta.url)).filter((f) => /^\d{14}_ecritures_libres\.sql$/.test(f))
  .map((f) => `supabase/schema/${f}`)[0])

/** Le corps d'une fonction de la migration, ses littéraux concaténés recollés. */
function corps(nom: string, fin: string): string {
  const debut = MIGRATION.search(new RegExp(`create function public\\.${nom}\\(`, 'i'))
  const bout = MIGRATION.indexOf(fin, debut)
  if (debut < 0 || bout < 0) throw new Error(`${nom} introuvable dans la migration`)
  return MIGRATION.slice(debut, bout).replace(/'\s*\|\|\s*'/g, '')
}
const FONCTION = corps('contre_passer_ecriture_libre', '$fonction$;')
const GARDE = corps('garder_contre_passation_des_ecritures_libres', '$$;')

/** Le code que la base lève pour le message : le premier `using errcode` qui le suit. */
function codeApres(texte: string, message: string): string | undefined {
  const i = texte.indexOf(message)
  return i < 0 ? undefined : /using errcode = '(\w+)'/.exec(texte.slice(i))?.[1]
}

describe('les refus de contre_passer_ecriture_libre sont ceux du module', () => {
  it('chaque mot du module est dans la fonction, au caractère près, dans l’ordre des contrôles, sous son code', () => {
    const mots = Object.entries(MOTS_DE_LA_CONTRE_PASSATION) as [keyof typeof MOTS_DE_LA_CONTRE_PASSATION, string][]
    const positions = mots.map(([, m]) => FONCTION.indexOf(m))
    positions.forEach((p, i) => expect(p, mots[i][0]).toBeGreaterThan(-1))
    for (let i = 1; i < positions.length; i++) expect(positions[i], mots[i][0]).toBeGreaterThan(positions[i - 1])
    for (const [cle, m] of mots) expect(codeApres(FONCTION, m), cle).toBe(CODES_DE_LA_CONTRE_PASSATION[cle])
  })

  it('ceux qu’elle partage avec enregistrer_ecriture_libre sont les siens, sous les mêmes codes (EL2)', () => {
    const partages = ['dateIllisible', 'dateFigee', 'avantLOuverture', 'dateAVenir', 'libelle', 'motif'] as const
    for (const cle of partages) {
      expect(MOTS_DE_LA_CONTRE_PASSATION[cle], cle).toBe(MOTS_DES_REFUS[cle])
      expect(EL2.replace(/'\s*\|\|\s*'/g, ''), cle).toContain(MOTS_DES_REFUS[cle])
      expect(codeApres(EL2, MOTS_DES_REFUS[cle]), cle).toBe(CODES_DE_LA_CONTRE_PASSATION[cle])
    }
    expect(MOTS_DE_LA_CONTRE_PASSATION.acces).toBe(MOTS_DE_LA_BASE.accesALEcriture)
    expect(MOTS_DE_LA_CONTRE_PASSATION.version).toBe(MOTS_DE_LA_BASE.version)
    expect(MOTS_DE_LA_CONTRE_PASSATION.ecritures).toBe(MOTS_DE_LA_BASE.ecritures)
  })

  it('l’accès, avant toute autre lecture : `admin_du_dossier` (EL-Q1), puis le verrou de la validation, puis l’écriture', () => {
    const acces = FONCTION.indexOf('not coalesce(public.admin_du_dossier(v_dossier_id), false)')
    expect(acces).toBeGreaterThan(-1)
    expect(acces).toBeLessThan(FONCTION.indexOf('pg_advisory_xact_lock_shared'))
    expect(acces).toBeLessThan(FONCTION.indexOf('from public.dossiers'))
    expect(acces).toBeLessThan(FONCTION.indexOf('for update'))
    expect(MIGRATION).not.toMatch(/est_chef_du_cabinet/)
    // L'auteur posé par la base, jamais par l'appelant ; le lien, la version 1, aucune extourne, aucune pièce.
    expect(FONCTION).toMatch(/p_id, 1, auth\.uid\(\)\)/)
    expect(FONCTION).toContain("v_lignes, false, null,")
  })

  it('les lignes : chacune au sens inverse, son poste ou nul hors de la 2035 ; la comparaison en multiensemble', () => {
    expect(FONCTION).toContain("'sens', case v_sens when 'debit' then 'credit' else 'debit' end")
    expect(FONCTION).toContain("'poste_2035', case when v_hors then null else v_poste end")
    expect(FONCTION).toContain('except all')
  })
})

describe('la garde de la colonne dit les mots du module', () => {
  it('chaque mot, sous son code', () => {
    for (const [cle, m] of Object.entries(MOTS_DE_LA_GARDE_DE_LA_CONTRE_PASSATION) as [keyof typeof MOTS_DE_LA_GARDE_DE_LA_CONTRE_PASSATION, string][]) {
      expect(GARDE, cle).toContain(m)
      expect(codeApres(GARDE, m), cle).toBe(CODES_DE_LA_GARDE_DE_LA_CONTRE_PASSATION[cle])
    }
  })

  it('elle tire après la garde de la table (l’ordre des noms), derrière la porte que la garde de tête exige', () => {
    expect(MIGRATION).toContain('create trigger ecritures_libres_garde_de_la_contre_passation before insert or update or delete on public.ecritures_libres')
    // Postgres tire les déclencheurs d'une table dans l'ordre de leurs noms : la porte, la garde de la table, puis celle-ci.
    const noms = ['ecritures_libres_garde_de_la_contre_passation', '_acces_avant_les_gardes', 'ecritures_libres_garde']
    expect([...noms].sort()).toEqual(['_acces_avant_les_gardes', 'ecritures_libres_garde', 'ecritures_libres_garde_de_la_contre_passation'])
    expect(MIGRATION).toMatch(/if not exists \(select 1 from pg_catalog\.pg_trigger t where t\.tgrelid = 'public\.ecritures_libres'::regclass and t\.tgname = '_acces_avant_les_gardes'\) then\s+raise exception/)
  })
})

describe('la garde de tête, l’en-tête, le retour', () => {
  it('la garde de tête : EL2 en base, pas deux fois, les corps qu’elle suit à leur empreinte', () => {
    const tete = MIGRATION.slice(MIGRATION.indexOf('do $garde$'), MIGRATION.indexOf('$garde$;'))
    expect(tete).toContain("ne s''applique pas deux fois")
    for (const f of ['enregistrer_ecriture_libre(uuid, jsonb, jsonb, integer)', 'retirer_ecriture_libre(uuid, integer)',
      'garder_ecritures_libres()', 'garder_ecriture_libre_du_brouillon()', 'admin_du_dossier(uuid)', 'frontiere_validation(uuid)']) {
      expect(tete, f).toMatch(new RegExp(`\\('${f.replace(/[()]/g, '\\$&')}', '[0-9a-f]{32}'\\)`))
    }
  })

  it('l’en-tête dit le socle et l’inventaire du jour de l’application, mesurés', () => {
    expect(MIGRATION).toContain('le socle reste 84')
    expect(MIGRATION).toMatch(/3 468 `4a6d01f1…`, puis 3 475 `[0-9a-f]{8}…`/)
    expect(MIGRATION).not.toContain('@@')
  })

  it('aucune instruction de suppression — ni `delete from`, ni `drop`, ni `truncate` — : l’outil peut l’appliquer', () => {
    // Le mot du déclencheur (`or delete on`, `tg_op = 'DELETE'`) n'en est pas une : `previsions_publiees` le portait, appliquée
    // par l'outil le 18/11/2026.
    const code = MIGRATION.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n')
    expect(code).not.toMatch(/\bdelete\s+from\b|\bdrop\s+\w+|\btruncate\b/i)
    expect(code).toMatch(/or delete on public\.ecritures_libres/)
  })

  it('le retour défait tout ce que la migration pose, et se refuse tant qu’une contre-passation existe', () => {
    for (const objet of ['function public.contre_passer_ecriture_libre(uuid, integer, jsonb, jsonb)',
      'trigger ecritures_libres_garde_de_la_contre_passation', 'function public.garder_contre_passation_des_ecritures_libres()',
      'constraint ecritures_libres_contre_passation_sans_extourne', 'constraint ecritures_libres_une_contre_passation',
      'constraint ecritures_libres_contre_passe_id_fkey', 'column contre_passe_id']) {
      expect(RETOUR, objet).toContain(`drop ${objet}`)
    }
    expect(RETOUR).toContain('des contre-passations existent')
  })
})

describe('l’essai, rls.sql, restauration.sql, le drapeau', () => {
  it('l’essai attend les mots du module et de la garde, et se joue sur une réplique en une transaction qui s’annule', () => {
    for (const [cle, m] of [...Object.entries(MOTS_DE_LA_CONTRE_PASSATION), ...Object.entries(MOTS_DE_LA_GARDE_DE_LA_CONTRE_PASSATION)]) {
      expect(ESSAI, cle).toContain(`'${m}'`)
    }
    expect(ESSAI.trimEnd().endsWith('rollback;')).toBe(true)
    expect(ESSAI).toMatch(/^begin;$/m)
    expect(ESSAI).toContain('SUR UNE RÉPLIQUE SEULEMENT')
  })

  it('rls.sql porte son bloc XL, qui attend la migration, et envoie à la base ce que le module compose', () => {
    expect(RLS).toContain('do $xl$')
    expect(RLS).toContain('EN ATTENTE de la migration contre_passation_des_ecritures_libres')
    // L'écriture du bloc LI, figée pour le module, et sa contre-passation telle que le module la compose et la donne.
    const ecriture: EcritureContrePassable = {
      id: 'e', exercice: 2025, numero: 1, date: '2025-06-30', libelle: 'Essai de la RLS', avec_extourne: false, version: 1,
      lignes: [
        { compte: '606400', sens: 'debit', centimes: 100, poste_2035: 'Fournitures de bureau', compte_lib: null },
        { compte: '606300', sens: 'credit', centimes: 100, poste_2035: 'Petit outillage', compte_lib: null },
      ],
    }
    const saisie = { date: '2026-01-01', libelle: libelleProposeDeLaContrePassation(ecriture), motif: 'Essai de la RLS.', horsDeLa2035: true }
    const proposee = composerLaContrePassation(ecriture, saisie, { mode: 'tresorerie', frontiere: '2025-12-31', ouverture: null, aujourdhui: '2026-11-24' }, [ecriture])
    expect(proposee).not.toBeNull()
    expect(RLS).toContain(`  contre_passation jsonb := '${JSON.stringify(contrePassationPourLaBase(saisie))}';`)
    expect(RLS).toContain(`  proposee jsonb := '${JSON.stringify(proposee)}';`)
    expect(RLS).toContain(`non_figee constant text := '${CODES_DE_LA_CONTRE_PASSATION.nonFigee} ${MOTS_DE_LA_CONTRE_PASSATION.nonFigee}';`)
    expect(RLS).toContain(`du_client = '42501 ${MOTS_DE_LA_CONTRE_PASSATION.acces}'`)
  })

  it('restauration.sql porte la vague de la colonne, conditionnée par elle', () => {
    expect(RESTAURATION).toContain("insert into essai_restauration._vagues (table_nom, colonne) values ('ecritures_libres','contre_passe_id');")
  })

  it('préparée ou rangée, à un seul endroit ; le drapeau levé si et seulement si elle est dans l’export', () => {
    const preparee = existsSync(new URL(`../../${PREPAREE}`, import.meta.url))
    expect(RANGEE.length + (preparee ? 1 : 0)).toBe(1)
    expect(CONTRE_PASSATION_DES_ECRITURES_LIBRES_PREVUE).toBe(RANGEE.length === 1)
  })
})
