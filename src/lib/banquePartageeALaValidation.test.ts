import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { CompteDuReleve } from './importParCompte'
import { REFUS_DE_L_ECLATEMENT, refusDeLaBanquePartagee, type EntreesDeLEclatement } from './ouvertureEclatee'
import { releveParCompte } from './releveParCompte'
import type { ControleReleveBancaire } from './types'
import { definitionsSql } from '../test/schema'

// LE 512 DU PRINCIPAL PARTAGÉ AU 31 DÉCEMBRE, À LA VALIDATION (MCBR2-Q2 (A), décision du cabinet du 27/11/2026). Le module
// (`refusDeLaBanquePartagee`, lib/ouvertureEclatee.ts) rejoué sur les cas de l'essai de sa migration
// (supabase/essais/banquePartageeALaValidation.sql) — les mêmes comptes, les mêmes relevés, les mêmes refus, que l'essai attend de
// la base mot pour mot —, et la migration préparée (supabase/preparees/20261127231000_banque_partagee_a_la_validation.sql)
// confrontée à son texte : ses mots, son déclencheur, son rang, sa garde de tête, son retour. Données FICTIVES.

const PREPAREE = readFileSync('supabase/preparees/20261127231000_banque_partagee_a_la_validation.sql', 'utf8')
const RETOUR = readFileSync('supabase/preparees/retour/20261127231100_retour_banque_partagee_a_la_validation.sql', 'utf8')
const RETOUR_OUVERTURE = readFileSync('supabase/preparees/retour/20261111235100_retour_ouverture_eclatee_par_compte.sql', 'utf8')
const RETOUR_SUIVANTE = readFileSync('supabase/preparees/retour/20261127190100_retour_ouverture_suivante_a_la_validation.sql', 'utf8')
const OUVERTURE_ECLATEE = readFileSync('supabase/schema/20261127055700_ouverture_eclatee_par_compte.sql', 'utf8')
const ESSAI = readFileSync('supabase/essais/banquePartageeALaValidation.sql', 'utf8')
const enSql = (texte: string) => texte.replace(/'/g, "''")

const P: CompteDuReleve = { id: 'p', libelle: 'Compte principal', principal: true, fin_d_identifiant: null, compte: null,
  compte_propre_depuis: null, ouvert_le: null, clos_le: null }
const S: CompteDuReleve = { id: 's', libelle: 'ESSAI MCBR2Q2 SECOND', principal: false, fin_d_identifiant: null, compte: '512200',
  compte_propre_depuis: '2027-01-01', ouvert_le: '2024-06-01', clos_le: null }

const decembre = (compte: string, fichier: string, solde: number): ControleReleveBancaire & { compte_bancaire_id: string } => ({
  id: `${compte}-${fichier}`, dossier_id: 'd', source_fichier: fichier, solde_initial: solde, solde_final: solde, somme_mouvements: 0,
  ecart: 0, coherent: true, periode_debut: '2025-12-01', periode_fin: '2025-12-31', created_at: '2026-01-02T00:00:00Z',
  compte_bancaire_id: compte,
})
const REPORT = { date: '2026-01-01', soldes: [{ compte: '101000', sens: 'credit' as const, montant: 1250 }, { compte: '512000', sens: 'debit' as const, montant: 1250 }] }

/** Le refus de la validation de 2025, ou rien : les comptes (le principal et le second, par défaut), leurs relevés de décembre. */
function dit(controles: ReturnType<typeof decembre>[], comptes: CompteDuReleve[] = [P, S]): string | null {
  const decoupe = releveParCompte({ etat: 'lus', comptes }, [], controles)
  if (decoupe.etat !== 'parts') throw new Error(decoupe.raison)
  const e: Pick<EntreesDeLEclatement, 'annee' | 'role' | 'parts' | 'reprise' | 'reportes'> =
    { annee: 2025, role: '512000', parts: decoupe.parts, reprise: [], reportes: [] }
  return refusDeLaBanquePartagee(e, REPORT)?.message ?? null
}

const RP = decembre('p', 'p.csv', 1000)
const RS = decembre('s', 's.csv', 250)
const MOTS = {
  inconnuS: 'Le solde au 31/12/2025 du compte bancaire « ESSAI MCBR2Q2 SECOND » ne se lit sur aucun de ses relevés contrôlés : importer le relevé qui finit ce jour-là, ou celui qui le couvre, avant d\'éclater l\'ouverture de la banque.',
  inconnuP: 'Le solde au 31/12/2025 du compte bancaire « Compte principal » ne se lit sur aucun de ses relevés contrôlés : importer le relevé qui finit ce jour-là, ou celui qui le couvre, avant d\'éclater l\'ouverture de la banque.',
  plusieursS: 'Les relevés du compte bancaire « ESSAI MCBR2Q2 SECOND » disent des soldes différents au 31/12/2025 : l\'un d\'eux ne dit pas le bon, et l\'ouverture de la banque ne s\'éclate pas.',
  somme: 'Les soldes des relevés au 31/12/2025 (1300,00 €) ne font pas l\'ouverture du compte 512000 (1250,00 €) : l\'ouverture de la banque ne s\'éclate pas entre ses comptes.',
  sommeZero: 'Les soldes des relevés au 31/12/2025 (1000,00 €) ne font pas l\'ouverture du compte 512000 (1250,00 €) : l\'ouverture de la banque ne s\'éclate pas entre ses comptes.',
}

describe('le 512 du principal partagé au 31 décembre, sur les cas de l’essai (MCBR2-Q2)', () => {
  it('BP-B1. les relevés (1 000 € + 250 €) font le 512000 reporté : rien', () => {
    expect(dit([RP, RS])).toBeNull()
  })

  it('BP-B2 à B7. les refus, aux mots de l’éclatement — et l’essai les attend de la base, mot pour mot', () => {
    const refus = [
      dit([RP]),
      dit([RP, RS, decembre('s', 's_bis.csv', 260)]),
      dit([RP, decembre('s', 's.csv', 300)]),
      dit([RS]),
      dit([RP, decembre('s', 's.csv', 0)]),
      dit([RP], [P, { ...S, compte_propre_depuis: '2099-01-01' }]),
    ]
    expect(refus).toEqual([MOTS.inconnuS, MOTS.plusieursS, MOTS.somme, MOTS.inconnuP, MOTS.sommeZero, MOTS.inconnuS])
    for (const m of new Set(refus)) expect(ESSAI).toContain(`'la fin de la transaction : 23514 ${enSql(m as string)}'`)
  })

  it('BP-C1 à C4. hors de ce cas, rien : un second compte clos en 2025, un seul compte, un 512 propre déjà tenu, un compte ouvert en 2026', () => {
    expect(dit([RP], [P, { ...S, clos_le: '2025-11-30' }])).toBeNull()
    expect(dit([decembre('p', 'p.csv', 900)], [P])).toBeNull()
    expect(dit([RP], [P, { ...S, ouvert_le: '2025-02-01', compte_propre_depuis: '2025-01-01' }])).toBeNull()
    expect(dit([RP], [P, { ...S, ouvert_le: '2026-02-01' }])).toBeNull()
  })

  it('le drapeau baissé : une part sans compte, rien', () => {
    const decoupe = releveParCompte({ etat: 'sans_objet' }, [], [RP, RS])
    expect(decoupe.etat === 'parts' && refusDeLaBanquePartagee({ annee: 2025, role: '512000', parts: decoupe.parts, reprise: [], reportes: [] }, REPORT))
      .toBeNull()
  })

  it('le report de la validation, jamais une lecture : un solde reporté du 01/01/2026 déjà lu ne compte pas', () => {
    const decoupe = releveParCompte({ etat: 'lus', comptes: [P, S] }, [], [RP, RS])
    if (decoupe.etat !== 'parts') throw new Error(decoupe.raison)
    const lu = [{ date: '2026-01-01', compte: '512000', sens: 'debit' as const, montant: 9999 }]
    expect(refusDeLaBanquePartagee({ annee: 2025, role: '512000', parts: decoupe.parts, reprise: [], reportes: lu }, REPORT)).toBeNull()
  })
})

describe('la migration, à son texte (MCBR2-Q2)', () => {
  const [{ definition: corps }] = definitionsSql('garder_banque_partagee_a_la_validation', [{ chemin: 'la préparée', texte: PREPAREE }])

  it('ses trois refus : ceux de l’éclatement, mot pour mot, sous leur code, dans l’ordre de la recomposition', () => {
    let position = 0
    for (const cle of ['inconnu', 'plusieurs', 'somme']) {
      const r = REFUS_DE_L_ECLATEMENT.find((x) => x.cle === cle)
      if (!r) throw new Error(cle)
      const morceaux = enSql(r.modele).split('%')
      const debut = corps.indexOf(morceaux[0], position)
      expect(debut, cle).toBeGreaterThan(position - 1)
      for (const m of morceaux) expect(corps.slice(debut), cle).toContain(m)
      expect(corps.slice(debut, debut + 700), cle).toContain(`errcode = '${r.code}'`)
      position = debut
    }
  })

  it('le groupe et le partage : le 512 du rôle au 31 décembre, un second compte pas clos ce jour-là ; l’ordre de la base', () => {
    expect(corps).toMatch(/where not s\.principal and s\.compte_propre_depuis > v_fin and s\.etat <> 'clos'\) then\n\s+return null;/)
    expect(corps).toMatch(/where s\.principal or s\.compte_propre_depuis > v_fin\n\s+order by s\.principal desc, s\.compte collate "C", s\.compte_bancaire_id/)
    // Le 512 reporté : la balance reprise et les soldes reportés du 1er janvier suivant, au compte du rôle.
    expect(corps).toContain("a.dossier_id = new.dossier_id and a.date = v_lendemain and a.compte = v_role")
    expect(corps).toContain("s.dossier_id = new.dossier_id and s.date = v_lendemain and s.compte = v_role")
    expect(corps).toMatch(/security definer\nset search_path = public/i)
    expect(corps).not.toMatch(/is_super_admin/i)
  })

  it('son déclencheur : de contrainte, différé, sa condition sur le rôle, et il tire après celui de l’ouverture suivante (261)', () => {
    expect(PREPAREE).toMatch(new RegExp('create constraint trigger exercices_valides_releves_de_la_banque_partagee\\n {2}after insert on public\\.exercices_valides\\n'
      + " {2}deferrable initially deferred\\n {2}for each row when \\(current_user <> 'authenticated'\\)\\n"
      + ' {2}execute function public\\.garder_banque_partagee_a_la_validation\\(\\);', 'i'))
    expect('exercices_valides_ouverture_suivante' < 'exercices_valides_releves_de_la_banque_partagee').toBe(true)
    expect(PREPAREE).toContain('revoke all on function public.garder_banque_partagee_a_la_validation() from public, anon, authenticated, service_role;')
    // Ni retrait ni vidage : par l'outil.
    expect(PREPAREE).not.toMatch(/\b(drop|delete|truncate)\b/i)
    expect(PREPAREE).not.toContain('\\')
  })

  it('sa garde de tête attend le corps de `soldes_des_comptes_au_trente_et_un` que porte l’export (258)', () => {
    const [{ definition }] = definitionsSql('soldes_des_comptes_au_trente_et_un', [{ chemin: '258', texte: OUVERTURE_ECLATEE }])
    const ouverture = /\$(\w*)\$/.exec(definition) as RegExpExecArray
    const empreinte = createHash('md5').update(definition.slice(ouverture.index + ouverture[0].length)).digest('hex')
    expect(PREPAREE).toContain(`is distinct from '${empreinte}' then`)
  })

  it('les retours : le sien retire le déclencheur et la fonction ; ceux de l’ouverture éclatée (258) et de l’ouverture suivante (261) l’attendent', () => {
    expect(RETOUR).toMatch(/drop trigger exercices_valides_releves_de_la_banque_partagee on public\.exercices_valides;/i)
    expect(RETOUR).toMatch(/drop function public\.garder_banque_partagee_a_la_validation\(\);/i)
    for (const retour of [RETOUR_OUVERTURE, RETOUR_SUIVANTE]) {
      expect(retour).toContain("if to_regprocedure('public.garder_banque_partagee_a_la_validation()') is not null then")
      expect(retour.indexOf('garder_banque_partagee_a_la_validation')).toBeLessThan(retour.search(/^drop /im))
    }
  })

  it('l’essai : de réplique seulement, EN ATTENTE sans la migration', () => {
    expect(ESSAI.split('\n').slice(0, 3).join(' ')).toMatch(/SUR UNE RÉPLIQUE SEULEMENT/)
    expect(ESSAI).toContain("if to_regprocedure('public.garder_banque_partagee_a_la_validation()') is null then")
    expect(ESSAI).toContain('EN ATTENTE de la migration banque_partagee_a_la_validation (MCBR2-Q2)')
  })
})
