import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DIRIGEANT_AU_468_PREVU, racinesDuDirigeantNonAssocieSelon } from './dirigeantAu468'
import { definitionDuRole } from './planComptable'
import { fichiersDuSchema, fichiersPrepares } from '../test/schema'

// LE 468 DU DIRIGEANT NON ASSOCIÉ, CONFRONTÉ À SA MIGRATION (PC4-Q2). Le texte de `dirigeant_au_468`, où qu'il soit — ce
// qu'il retire (rien), la seule ligne qu'il change, ses gardes —, le drapeau qui suit le fichier, la copie du catalogue qui
// suit le drapeau, et les deux essais qui choisissent leur attendu par la ligne d'historique de la migration.

const nomDe = (chemin: string) => chemin.split('/').pop()!
const MIGRATIONS = [...fichiersDuSchema(), ...fichiersPrepares()].filter((f) => /^\d{14}_/.test(nomDe(f.chemin)))
const MIGRATION = MIGRATIONS.find((f) => /\d{14}_dirigeant_au_468\.sql$/.test(f.chemin))!
const lire = (chemin: string) => readFileSync(new URL(`../../${chemin}`, import.meta.url), 'utf8')
const RETOUR = lire('supabase/preparees/retour/20261111174100_retour_dirigeant_au_468.sql')
const sansCommentaires = (texte: string) => texte.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n')

describe('la migration dirigeant_au_468, où qu’elle soit', () => {
  it('est là une fois, préparée ou dans l’export, et le drapeau suit son fichier', () => {
    expect(MIGRATION).toBeDefined()
    expect(MIGRATIONS.filter((f) => /_dirigeant_au_468\.sql$/.test(f.chemin))).toHaveLength(1)
    expect(DIRIGEANT_AU_468_PREVU).toBe(fichiersDuSchema().some((f) => /\d{14}_dirigeant_au_468\.sql$/.test(f.chemin)))
  })

  it('ne retire rien et ne change qu’une ligne du catalogue : le dirigeant non associé sous 467 ou 468, son défaut au 467000', () => {
    expect(MIGRATION.texte).not.toMatch(/[\\\r]/)
    const sql = sansCommentaires(MIGRATION.texte)
    expect(sql).not.toMatch(/\bdrop\b|\btruncate\b|\bdelete\b|\balter\b|\bcreate\b/i)
    expect(sql.match(/\bupdate\b/gi)).toHaveLength(1)
    expect(sql).toContain("update public.roles_comptables\n   set racines = array['467', '468']\n where role = 'autres_debiteurs_crediteurs' and racines = array['467'];")
    // Ce que le module porte, son drapeau levé, est ce que la migration pose.
    expect(racinesDuDirigeantNonAssocieSelon(true)).toEqual(['467', '468'])
    expect(sql).toContain("r.compte_defaut = '467000'")
    expect(definitionDuRole('autres_debiteurs_crediteurs')?.compteDefaut).toBe('467000')
  })

  it('vient après PC4, refuse une seconde application et une racine qu’un autre rôle commencerait', () => {
    expect(MIGRATION.texte).toContain("to_regprocedure('public.regler_plan_du_dossier(uuid, jsonb)') is null")
    expect(MIGRATION.texte).toContain("'468' = any (r.racines)")
    expect(MIGRATION.texte).toContain("left('468', length(u.racine)) = u.racine")
    // Une racine de la copie du catalogue qui commencerait par 468, ou que 468 commencerait, hors de ce rôle : aucune.
    expect(definitionDuRole('associe')?.racines).toEqual(['455'])
  })

  it('les essais choisissent leur attendu par la ligne d’historique de la migration, et le retour se refuse sur un dossier au 468', () => {
    const nom = nomDe(MIGRATION.chemin).replace(/^\d{14}_/, '').replace(/\.sql$/, '')
    expect(nom).toBe('dirigeant_au_468')
    for (const essai of ['supabase/essais/planComptable.sql', 'supabase/essais/reglerLePlanDuDossier.sql']) {
      expect(lire(essai), essai).toContain(`au_468 constant boolean := exists (select 1 from supabase_migrations.schema_migrations m where m.name = '${nom}');`)
    }
    expect(RETOUR).toContain("set racines = array['467']")
    expect(RETOUR).toContain("p.role = 'autres_debiteurs_crediteurs' and left(p.compte, 3) = '468'")
  })
})
