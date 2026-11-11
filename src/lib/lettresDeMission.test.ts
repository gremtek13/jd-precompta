import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { definitionsSql } from '../test/schema'
import {
  ACCEPTATION_EN_LIGNE_OUVERTE, CLAUSES, FORMES_D_HONORAIRES, LETTRES_DE_MISSION_PREVUES, LIVRABLES, MISSIONS, PERIODICITES,
  REFUS_DE_LA_PROPOSITION, REFUS_DE_LA_REPONSE, REFUS_DU_BROUILLON, REFUS_DU_MODELE, REFUS_DU_RETRAIT,
  REFUS_DU_RETRAIT_DU_MODELE, clausesRequises, etatDeLaLettre, lettresEnVigueur, motsDuRefus, type LettreLue,
} from './lettresDeMission'

// LES LETTRES DE MISSION (ligne 47, LM4) : le module redit la migration `lettres_de_mission` — préparée le 11/11/2026, dans
// l'export le jour de son application — : son catalogue, les refus de ses six fonctions dans leur ordre, à leurs mots (les
// apostrophes typographiques du module rendues droites) et à leur code, le drapeau de l'acceptation en ligne ; son retour
// retire tout ce qu'elle crée ; l'essai et rls.sql l'attendent.

function leFichier(motif: RegExp, dossiers: readonly string[]): string {
  const trouves: string[] = []
  for (const dossier of dossiers) {
    const chemin = new URL(dossier, import.meta.url).pathname
    if (!existsSync(chemin)) continue
    for (const nom of readdirSync(chemin)) if (motif.test(nom)) trouves.push(chemin + nom)
  }
  expect(trouves, String(motif)).toHaveLength(1)
  return readFileSync(trouves[0], 'utf8')
}

const MIGRATION = leFichier(/^\d{14}_lettres_de_mission\.sql$/, ['../../supabase/preparees/', '../../supabase/schema/'])
const RETOUR = leFichier(/^\d{14}_retour_lettres_de_mission\.sql$/, ['../../supabase/preparees/retour/'])
const ESSAI = readFileSync(new URL('../../supabase/essais/lettresDeMission.sql', import.meta.url), 'utf8')
const RLS = readFileSync(new URL('../../supabase/essais/rls.sql', import.meta.url), 'utf8')

const droit = (s: string) => s.replace(/’/g, "'")
function fonction(nom: string): string {
  const definitions = definitionsSql(nom, [{ chemin: 'lettres_de_mission', texte: MIGRATION }])
  expect(definitions, nom).not.toHaveLength(0)
  return definitions[definitions.length - 1].definition
}
const refusSql = (sql: string) =>
  [...sql.matchAll(/raise exception '((?:[^']|'')*)'[\s\S]*?using errcode = '([0-9A-Z]{5})'/g)]
    .map((m) => ({ code: m[2], modele: m[1].replace(/''/g, "'") }))
const attendus = (liste: readonly { code: string; modele: string }[]) => liste.map((r) => ({ code: r.code, modele: droit(r.modele) }))
/** Les littéraux d'un `array[...]` de la fonction nommée, dans l'ordre. */
const tableauSql = (nom: string) => [...fonction(nom).match(/array\[([^\]]*)\]/)![1].matchAll(/'([^']*)'/g)].map((m) => m[1])

const lettre = (p: Partial<LettreLue>): LettreLue => ({
  id: 'l1', remplace_id: null, dossier_client_id: 'c', date_effet: '2027-01-01', fin_initiale: '2027-12-31',
  reconduction_tacite: true, proposee_le: '2026-12-01T10:00:00Z', acceptee_le: '2026-12-02T10:00:00Z', refusee_le: null,
  retiree_le: null, fin_au: null, ...p,
})

describe('les lettres de mission, confrontées à leur migration', () => {
  it('le drapeau est baissé tant que la migration n’est pas dans l’export ; l’acceptation en ligne est fermée en base', () => {
    expect(LETTRES_DE_MISSION_PREVUES).toBe(false)
    expect(ACCEPTATION_EN_LIGNE_OUVERTE).toBe(false)
    expect(fonction('acceptation_en_ligne_ouverte')).toMatch(/select false/)
    expect(fonction('acceptation_en_ligne_ouverte')).not.toMatch(/select true/)
  })

  it('le catalogue du module est celui de la base', () => {
    expect(tableauSql('missions_de_lettre')).toEqual([...MISSIONS])
    expect(tableauSql('clauses_de_lettre')).toEqual([...CLAUSES])
    const honoraires = fonction('honoraires_valides')
    for (const v of [...FORMES_D_HONORAIRES, ...PERIODICITES, ...LIVRABLES]) expect(honoraires, v).toContain(`'${v}'`)
    expect(fonction('clauses_requises')).toContain("'facturation_au_nom_du_client'")
    expect(clausesRequises(['tenue_comptable'])).toEqual(['sous_traitance'])
    expect(clausesRequises(['tenue_comptable', 'facturation_au_nom_du_client'])).toEqual(['mandat_de_facturation', 'sous_traitance'])
  })

  it('chaque fonction refuse dans l’ordre du module, à ses mots et à ses codes', () => {
    expect(refusSql(fonction('enregistrer_modele_de_lettre'))).toEqual(attendus(REFUS_DU_MODELE))
    expect(refusSql(fonction('retirer_modele_de_lettre'))).toEqual(attendus(REFUS_DU_RETRAIT_DU_MODELE))
    expect(refusSql(fonction('enregistrer_brouillon_de_lettre'))).toEqual(attendus(REFUS_DU_BROUILLON))
    expect(refusSql(fonction('proposer_lettre_de_mission'))).toEqual(attendus(REFUS_DE_LA_PROPOSITION))
    expect(refusSql(fonction('enregistrer_reponse_a_la_lettre'))).toEqual(attendus(REFUS_DE_LA_REPONSE))
    expect(refusSql(fonction('retirer_lettre_de_mission'))).toEqual(attendus(REFUS_DU_RETRAIT))
  })

  it('chaque fonction qui écrit vérifie l’accès, puis le dossier du cabinet, avant toute lecture', () => {
    for (const nom of ['enregistrer_modele_de_lettre', 'retirer_modele_de_lettre', 'enregistrer_brouillon_de_lettre',
      'proposer_lettre_de_mission', 'enregistrer_reponse_a_la_lettre', 'retirer_lettre_de_mission']) {
      const corps = fonction(nom)
      expect(corps, nom).toMatch(/security definer/)
      const acces = corps.indexOf('public.admin_du_dossier(p_dossier_id)')
      expect(acces, nom).toBeGreaterThan(0)
      expect(corps.indexOf('public.est_dossier_du_cabinet(p_dossier_id)'), nom).toBeGreaterThan(acces)
      expect(corps.slice(0, acces), nom).not.toMatch(/\bfrom public\./)
      expect(MIGRATION, nom).toMatch(new RegExp(`revoke execute on function public\\.${nom}\\([^)]*\\) from public, anon;`))
    }
  })

  it('le retour retire tout ce que la migration crée, et se refuse tant qu’une lettre existe', () => {
    const creees = [...MIGRATION.matchAll(/^create function public\.([a-z_]+)\(/gim)].map((m) => m[1])
    expect(creees.length).toBe(19)
    for (const nom of creees) expect(RETOUR, nom).toMatch(new RegExp(`drop function public\\.${nom}\\(`, 'i'))
    expect(RETOUR).toMatch(/drop table public\.lettres_de_mission;/i)
    expect(RETOUR).toMatch(/drop table public\.modeles_lettre_de_mission;/i)
    expect(RETOUR).toMatch(/drop trigger cabinets_designation_des_lettres on public\.cabinets;/i)
    expect(RETOUR).toMatch(/exists \(select 1 from public\.lettres_de_mission\)/)
  })

  it('l’essai et rls.sql attendent la migration, et disent les mots du module', () => {
    expect(ESSAI).toContain('LM. les lettres de mission : EN ATTENTE de la migration lettres_de_mission')
    expect(ESSAI).toContain('ESSAI_HORS_REPLIQUE')
    expect(RLS).toContain('LM. les lettres de mission : EN ATTENTE de la migration lettres_de_mission')
    for (const cle of ['acces', 'horsDuDossierDuCabinet']) expect(droit(ESSAI)).toContain(droit(motsDuRefus(REFUS_DU_MODELE, cle)).replace(/'/g, "''"))
    expect(ESSAI).toContain(motsDuRefus(REFUS_DE_LA_PROPOSITION, 'tempsPasse').split(' :')[0])
  })
})

describe('ce qui se déduit d’une lettre', () => {
  it('l’état suit l’histoire : brouillon, proposée, acceptée, échue, refusée, retirée, résiliée', () => {
    const jour = '2027-03-01'
    expect(etatDeLaLettre(lettre({ proposee_le: null, acceptee_le: null }), jour)).toBe('brouillon')
    expect(etatDeLaLettre(lettre({ acceptee_le: null }), jour)).toBe('proposee')
    expect(etatDeLaLettre(lettre({}), jour)).toBe('acceptee')
    expect(etatDeLaLettre(lettre({ reconduction_tacite: false }), '2028-01-01')).toBe('echue')
    expect(etatDeLaLettre(lettre({ reconduction_tacite: false }), '2027-12-31')).toBe('acceptee')
    expect(etatDeLaLettre(lettre({ reconduction_tacite: true }), '2030-01-01')).toBe('acceptee')
    expect(etatDeLaLettre(lettre({ acceptee_le: null, refusee_le: '2026-12-03T10:00:00Z' }), jour)).toBe('refusee')
    expect(etatDeLaLettre(lettre({ acceptee_le: null, retiree_le: '2026-12-03T10:00:00Z' }), jour)).toBe('retiree')
    expect(etatDeLaLettre(lettre({ retiree_le: '2027-06-01T10:00:00Z', fin_au: '2027-06-30' }), jour)).toBe('resiliee')
  })

  it('en vigueur : acceptée, d’effet atteint, ni résiliée, ni échue, ni remplacée par un avenant accepté d’effet atteint', () => {
    const l1 = lettre({})
    const avenant = lettre({ id: 'l2', remplace_id: 'l1', date_effet: '2027-07-01' })
    expect(lettresEnVigueur([l1], 'c', '2026-12-31').map((l) => l.id)).toEqual([])
    expect(lettresEnVigueur([l1], 'c', '2027-01-01').map((l) => l.id)).toEqual(['l1'])
    expect(lettresEnVigueur([l1], 'autre', '2027-01-01')).toEqual([])
    expect(lettresEnVigueur([l1, avenant], 'c', '2027-06-30').map((l) => l.id)).toEqual(['l1'])
    expect(lettresEnVigueur([l1, avenant], 'c', '2027-07-01').map((l) => l.id)).toEqual(['l2'])
    // Un avenant proposé, refusé ou retiré ne remplace rien.
    expect(lettresEnVigueur([l1, { ...avenant, acceptee_le: null }], 'c', '2027-08-01').map((l) => l.id)).toEqual(['l1'])
    // Résiliée au 30/06 : en vigueur ce jour-là, plus le lendemain.
    const resiliee = lettre({ retiree_le: '2027-05-01T10:00:00Z', fin_au: '2027-06-30' })
    expect(lettresEnVigueur([resiliee], 'c', '2027-06-30').map((l) => l.id)).toEqual(['l1'])
    expect(lettresEnVigueur([resiliee], 'c', '2027-07-01')).toEqual([])
    // Sans reconduction, échue après sa première période.
    expect(lettresEnVigueur([lettre({ reconduction_tacite: false })], 'c', '2028-01-01')).toEqual([])
  })

  it('un refus inconnu se dit', () => {
    expect(() => motsDuRefus(REFUS_DU_RETRAIT, 'inconnu')).toThrow('Refus inconnu')
  })
})
