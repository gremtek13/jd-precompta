import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  OUVERTURES_ATTESTEES_PREVUES, TABLES_DES_OUVERTURES_ATTESTEES, adresseDeLAuteurAtteste, equipeNommable, ouverturesDeLaLecture,
  type OuvertureAttesteeBrute,
} from './ouverturesAttestees'
import { lireLesOuverturesAttestees } from './traceDesDroitsLecture'
import { policiesDuSchema, vautPour } from '../test/policiesDuSchema'
import { fichiersDuSchema, fichiersPrepares } from '../test/schema'

// QUI A OUVERT UN ACCÈS CLIENT (P1TQ2-Q1) : la règle de l'écran, la lecture, et ce que la base dit de qui lit quoi. Ce que ces
// cas gardent : une attestation ne se range que sous la ligne de la trace qu'elle nomme ; un compte ne se nomme que par
// l'adresse que la SESSION de qui regarde lit dans l'équipe, jamais deviné ; une lecture partielle ou refusée se dit ; et la
// borne que la décision suppose — l'adresse d'un membre ne se lit que par le chef du cabinet, le super-administrateur et
// lui-même — est relue dans l'export, pour qu'un élargissement de la policy de l'équipe fasse tomber ce fichier.

const RACINE = resolve(process.cwd())
const lire = (chemin: string) => readFileSync(resolve(RACINE, chemin), 'utf8')
const MIGRATION = 'supabase/preparees/20261116120000_auteur_des_ouvertures_d_acces.sql'
const RETOUR = 'supabase/preparees/retour/20261116120100_retour_auteur_des_ouvertures_d_acces.sql'

const faux = vi.hoisted(() => ({
  attestations: [] as OuvertureAttesteeBrute[],
  equipe: [] as Record<string, unknown>[],
  /** Les comptes de l'équipe que la session lit (la policy `cabinet_admins_select`). */
  lisibles: new Set<string>(),
  pannes: new Set<string>(),
  demandes: [] as { table: string; colonnes: string; tri: string[] }[],
}))

vi.mock('./supabase', async () => {
  const { filtrer, predicatEq, predicatIn } = await import('../test/filtresPostgrest')
  return {
    supabase: {
      from: (table: string) => {
        const predicats: ((l: Record<string, unknown>) => boolean)[] = []
        const demande = { table, colonnes: '', tri: [] as string[] }
        faux.demandes.push(demande)
        let debut = 0
        let fin = Number.MAX_SAFE_INTEGER
        const c: Record<string, unknown> = {}
        Object.assign(c, {
          select: (colonnes: string) => { demande.colonnes = colonnes; return c },
          eq: (colonne: string, valeur: unknown) => { predicats.push(predicatEq(colonne, valeur)); return c },
          in: (colonne: string, valeurs: unknown[]) => { predicats.push(predicatIn(colonne, valeurs)); return c },
          order: (colonne: string) => { demande.tri.push(colonne); return c },
          range: (d: number, f: number) => { debut = d; fin = f; return c },
          then: (suite: (r: unknown) => unknown, echec?: (e: unknown) => unknown) => {
            if (faux.pannes.has(table)) return Promise.resolve({ data: null, error: { message: 'accès refusé' }, count: null }).then(suite, echec)
            const source: Record<string, unknown>[] = table === 'cabinet_admins'
              ? faux.equipe.filter((l) => faux.lisibles.has(String(l.user_id)))
              : faux.attestations.map((l) => ({ ...l }))
            const toutes = filtrer(source, predicats)
            return Promise.resolve({ data: toutes.slice(debut, fin + 1), error: null, count: toutes.length }).then(suite, echec)
          },
        })
        return c
      },
    },
  }
})

const attestation = (id: string, o: Partial<OuvertureAttesteeBrute> = {}): OuvertureAttesteeBrute => ({
  id, dossier_id: 'd1', acces_id: 'm1', trace_id: `t-${id}`, auteur_id: 'u-chef', atteste_le: '2026-11-16T10:00:00Z', ...o,
})

beforeEach(() => {
  faux.attestations = [attestation('a1'), attestation('a2', { trace_id: 't-a2', auteur_id: 'u-membre' }), attestation('a3', { dossier_id: 'd2' })]
  faux.equipe = [
    { user_id: 'u-chef', email: 'chef@cabinet.example' },
    { user_id: 'u-membre', email: 'membre@cabinet.example' },
  ]
  faux.lisibles = new Set(['u-chef', 'u-membre'])
  faux.pannes = new Set()
  faux.demandes = []
})

describe('le drapeau et la migration préparée', () => {
  it('baissé tant que la migration n’est pas dans l’export ; elle est préparée, avec son retour', () => {
    expect(OUVERTURES_ATTESTEES_PREVUES).toBe(false)
    expect(readdirSync(resolve(RACINE, 'supabase/schema')).some((f) => f.endsWith('_auteur_des_ouvertures_d_acces.sql'))).toBe(false)
    expect(lire(MIGRATION)).toContain('create table public.auteurs_des_ouvertures (')
    expect(lire(RETOUR)).toContain('drop table public.auteurs_des_ouvertures;')
    expect(TABLES_DES_OUVERTURES_ATTESTEES).toEqual(['auteurs_des_ouvertures'])
  })

  it('la table ne s’ouvre qu’au cabinet du dossier, et ne garde qu’un identifiant de compte, jamais une adresse', () => {
    const texte = lire(MIGRATION)
    expect(texte).toContain('create policy auteurs_des_ouvertures_lecture on public.auteurs_des_ouvertures\n  for select to authenticated using (public.admin_du_dossier(dossier_id));')
    expect(texte).toContain('create policy auteurs_des_ouvertures_restauration on public.auteurs_des_ouvertures\n  for insert to authenticated with check (public.is_super_admin());')
    expect(texte.match(/create policy \w+ on public\.auteurs_des_ouvertures/gi)).toHaveLength(3)
    const colonnes = /create table public\.auteurs_des_ouvertures \(([\s\S]*?)\n\);/i.exec(texte)?.[1] ?? ''
    expect(colonnes).not.toMatch(/email|adresse/)
    // L'auteur, `auth.uid()` de la session, jamais un paramètre.
    expect(texte).toContain('create function public.attester_ouverture_d_acces(p_dossier_id uuid, p_acces_id uuid)')
    expect(texte).toContain('v_auteur uuid := auth.uid();')
  })

  it('la borne que l’écran suppose : l’adresse d’un membre ne se lit que par le chef, le super-administrateur et lui-même', () => {
    // Les policies de l'équipe telles que l'export ET les migrations préparées les laissent, rejouées instruction par
    // instruction : une seule ouvre la lecture (permissive, pour SELECT ou pour tout), et c'est celle-là.
    for (const releve of [policiesDuSchema(fichiersDuSchema()), policiesDuSchema([...fichiersDuSchema(), ...fichiersPrepares()])]) {
      const lecture = [...releve.policies.values()]
        .filter((p) => p.table === 'public.cabinet_admins' && p.permissive && vautPour(p, 'select'))
        .map((p) => `${p.nom} : ${p.using}`)
      expect(lecture).toEqual(['cabinet_admins_select : user_id = auth.uid() or is_super_admin() or est_chef_du_cabinet(cabinet_id)'])
    }
  })
})

describe('la règle de l’écran', () => {
  it('range chaque attestation sous la ligne de la trace qu’elle nomme ; une illisible ou en double se compte', () => {
    const lues = ouverturesDeLaLecture({
      lignes: [attestation('a1'), attestation('a2', { trace_id: 't-a1' }), attestation('a3', { auteur_id: '' })], complete: true, motif: null,
    })
    expect([...lues.parTrace]).toEqual([['t-a1', 'u-chef']])
    expect(lues.motif).toBe('2 attestation(s) d’ouverture illisible(s)')
    expect(ouverturesDeLaLecture({ lignes: [], complete: false, motif: 'coupée' }).motif).toBe('coupée')
    expect(ouverturesDeLaLecture({ lignes: [attestation('a1')], complete: true, motif: null }).motif).toBeNull()
  })

  it('l’équipe nommable : ce que la session lit, une adresse vide ne nomme personne', () => {
    expect([...equipeNommable([{ user_id: 'u1', email: ' x@cabinet.example ' }, { user_id: 'u2', email: '' }, { user_id: 'u3', email: null }])])
      .toEqual([['u1', 'x@cabinet.example']])
  })

  it('l’auteur attesté : son adresse si la session la lit, sinon nulle ; sans attestation, rien d’attesté', () => {
    const ouvertures = ouverturesDeLaLecture({ lignes: [attestation('a1')], complete: true, motif: null })
    expect(adresseDeLAuteurAtteste('t-a1', ouvertures, new Map([['u-chef', 'chef@cabinet.example']])))
      .toEqual({ atteste: true, adresse: 'chef@cabinet.example' })
    expect(adresseDeLAuteurAtteste('t-a1', ouvertures, new Map())).toEqual({ atteste: true, adresse: null })
    expect(adresseDeLAuteurAtteste('t-a1', ouvertures, null)).toEqual({ atteste: true, adresse: null })
    expect(adresseDeLAuteurAtteste('t-autre', ouvertures, null)).toEqual({ atteste: false, adresse: null })
    expect(adresseDeLAuteurAtteste('t-a1', null, null)).toEqual({ atteste: false, adresse: null })
  })
})

describe('lireLesOuverturesAttestees', () => {
  it('les attestations de CE dossier, sous un tri total ; puis les seuls comptes attestés dans l’équipe', async () => {
    const lue = await lireLesOuverturesAttestees('d1')
    expect(lue.dossierId).toBe('d1')
    expect([...lue.parTrace]).toEqual([['t-a1', 'u-chef'], ['t-a2', 'u-membre']])
    expect([...lue.equipe]).toEqual([['u-chef', 'chef@cabinet.example'], ['u-membre', 'membre@cabinet.example']])
    expect(lue.motif).toBeNull()
    expect(faux.demandes.map((d) => [d.table, d.colonnes, d.tri.join(',')])).toEqual([
      ['auteurs_des_ouvertures', 'id, dossier_id, acces_id, trace_id, auteur_id, atteste_le', 'atteste_le,id'],
      ['cabinet_admins', 'user_id, email', 'user_id'],
    ])
  })

  it('un membre ne lit que sa ligne : l’autre compte reste sans adresse, sans que la lecture soit partielle', async () => {
    faux.lisibles = new Set(['u-membre'])
    const lue = await lireLesOuverturesAttestees('d1')
    expect([...lue.equipe]).toEqual([['u-membre', 'membre@cabinet.example']])
    expect(lue.motif).toBeNull()
  })

  it('sans attestation, l’équipe ne se lit pas', async () => {
    const lue = await lireLesOuverturesAttestees('d3')
    expect(lue.parTrace.size).toBe(0)
    expect(faux.demandes.map((d) => d.table)).toEqual(['auteurs_des_ouvertures'])
  })

  it('une lecture refusée se dit : des attestations, ou de l’équipe', async () => {
    faux.pannes = new Set(['cabinet_admins'])
    const sansEquipe = await lireLesOuverturesAttestees('d1')
    expect(sansEquipe.parTrace.size).toBe(2)
    expect(sansEquipe.equipe.size).toBe(0)
    expect(sansEquipe.motif).toMatch(/^l’équipe : /)
    faux.pannes = new Set(['auteurs_des_ouvertures'])
    const sansRien = await lireLesOuverturesAttestees('d1')
    expect(sansRien.parTrace.size).toBe(0)
    expect(sansRien.motif).not.toBeNull()
  })
})
