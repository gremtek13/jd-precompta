import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { definitionsSql, fichiersDuSchema } from '../test/schema'
import { codesSql, messagesSql } from '../test/raiseSql'
import { MOTS_DU_CABINET } from './espaceVentes'
import {
  DRAPEAU_DES_ESPECES_DU_CLIENT, FONCTION_DES_PIECES_HORS_DE_LA_CAISSE, REFUS_DES_ESPECES_DU_CLIENT, especesDuClientHorsDesReprisesPrevues,
  especesRefuseesAvantLeClic, gestesDeLaCaisseOfferts, lireLesPiecesHorsDeLaCaisse, piecesHorsDeLaCaisseSelon,
} from './especesDuClientHorsDesReprises'

// A8Q5Q3Q2Q2-Q1 : LE CLIENT NE RÈGLE JAMAIS EN ESPÈCES L'ORIGINAL D'UNE FACTURE REPRISE. Le module redit le refus de la migration
// `especes_du_client_hors_des_reprises` (en production depuis le 16/11/2026), confronté à son texte ; le déclencheur tire après la garde de la table et
// avant celle des règlements d'une pièce reprise ; la lecture ouverte au client ne rend que des identifiants ; les empreintes
// et le retour se tiennent ; le drapeau suit l'export ; l'essai attend les mots du module. Données FICTIVES.

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

const MIGRATION = leFichier(/^\d{14}_especes_du_client_hors_des_reprises\.sql$/, ['../../supabase/preparees/', '../../supabase/schema/'])
const RETOUR = leFichier(/^\d{14}_retour_especes_du_client_hors_des_reprises\.sql$/, ['../../supabase/preparees/retour/'])
const ESSAI = readFileSync(new URL('../../supabase/essais/especesDuClientHorsDesReprises.sql', import.meta.url), 'utf8')
const SCHEMA = fichiersDuSchema()
const EXPORTEE = SCHEMA.some((f) => /\d{14}_especes_du_client_hors_des_reprises\.sql$/.test(f.chemin))
const md5 = (texte: string) => createHash('md5').update(texte, 'utf8').digest('hex')

const definition = (nom: string) => {
  const d = definitionsSql(nom, [{ chemin: 'migration', texte: MIGRATION }])
  expect(d, nom).toHaveLength(1)
  return d[0].definition
}
const corps = (d: string) => d.slice(d.indexOf('as $$') + 'as $$'.length)
const bloc = (texte: string, etiquette: string) => {
  const debut = texte.indexOf(`do $${etiquette}$`)
  return texte.slice(debut, texte.indexOf(`$${etiquette}$;`, debut))
}
const avant = (a: string, b: string) => Buffer.compare(Buffer.from(a), Buffer.from(b)) < 0
const P1 = 'a8580000-0000-4000-8000-0000000000b1'

// L'état du drapeau au chargement (levé depuis l'application du 16/11/2026) : chaque test qui le force le rend.
const DRAPEAU_AU_CHARGEMENT = DRAPEAU_DES_ESPECES_DU_CLIENT.ESPECES_DU_CLIENT_HORS_DES_REPRISES_PREVUES
afterEach(() => {
  DRAPEAU_DES_ESPECES_DU_CLIENT.ESPECES_DU_CLIENT_HORS_DES_REPRISES_PREVUES = DRAPEAU_AU_CHARGEMENT
})

describe('A8Q5Q3Q2Q2-Q1 — la migration, son retour et le module', () => {
  it('la garde : son seul refus, au code 42501, aux mots du module', () => {
    const sql = definition('garder_especes_du_client_hors_des_reprises')
    expect(messagesSql(sql)).toEqual([REFUS_DES_ESPECES_DU_CLIENT.modele])
    expect(codesSql(sql)).toEqual([REFUS_DES_ESPECES_DU_CLIENT.code])
  })

  it('le refus est neutre : ni montant, ni nom de fichier, ni facture, ni encaissements ; aux mots du client', () => {
    expect(REFUS_DES_ESPECES_DU_CLIENT.modele).not.toMatch(/%|€|«|»|\d|factur|\bregistre\b|encaiss|repris/i)
    for (const m of MOTS_DU_CABINET) expect(REFUS_DES_ESPECES_DU_CLIENT.modele, m.nom).not.toMatch(m.motif)
    expect(REFUS_DES_ESPECES_DU_CLIENT.modele).toContain('ton cabinet')
  })

  it('elle ne juge que le paiement d’un accès client écrit par les fonctions de la caisse ; la restauration passe', () => {
    const sql = definition('garder_especes_du_client_hors_des_reprises')
    expect(sql).toMatch(/returns trigger\nlanguage plpgsql\nsecurity definer\nset search_path = public\n/)
    expect(sql).toContain("if coalesce(current_setting('jd.caisse', true), '') is distinct from new.id::text then\n    return new;")
    expect(sql).toContain('where r.piece_id = new.piece_id and r.retire_le is null) then')
    expect(MIGRATION).toContain("create trigger operations_caisse_hors_des_reprises\n  before insert on public.operations_caisse\n"
      + "  for each row when (new.origine = 'client' and new.genre = 'paiement' and new.piece_id is not null)\n"
      + '  execute function public.garder_especes_du_client_hors_des_reprises();')
    expect(MIGRATION).toContain('revoke all on function public.garder_especes_du_client_hors_des_reprises() from public, anon, authenticated, service_role;')
  })

  it('son rang : après la garde de la table, avant celle des règlements d’une pièce reprise (qui nomme la pièce et la facture)', () => {
    expect(avant('operations_caisse_gardes', 'operations_caisse_hors_des_reprises')).toBe(true)
    expect(avant('operations_caisse_hors_des_reprises', 'operations_caisse_piece_d_une_facture_reprise')).toBe(true)
    // Les deux gardes qu'elle encadre sont dans l'export, sur cette table, BEFORE INSERT.
    const export_ = SCHEMA.map((f) => f.texte).join('\n')
    expect(export_).toMatch(/create trigger operations_caisse_gardes\s+before insert or update or delete on public\.operations_caisse/i)
    expect(export_).toMatch(/create trigger operations_caisse_piece_d_une_facture_reprise\s+before insert or update of piece_id, date on public\.operations_caisse/i)
    expect(bloc(MIGRATION, 'fin')).toContain("'operations_caisse_hors_des_reprises' collate \"C\" < 'operations_caisse_piece_d_une_facture_reprise' collate \"C\"")
  })

  it('la lecture ouverte au client « Caisse » : l’accès avant toute lecture, les seuls identifiants des liens actifs, une valeur', () => {
    const sql = definition(FONCTION_DES_PIECES_HORS_DE_LA_CAISSE)
    expect(sql).toMatch(/returns jsonb\nlanguage plpgsql\nstable\nsecurity definer\nset search_path = public\n/)
    const acces = sql.indexOf("or not (public.admin_du_dossier(p_dossier_id) or public.client_du_dossier(p_dossier_id, 'caisse'))")
    const lecture = sql.indexOf('from public.pieces_des_factures_reprises r')
    expect(acces).toBeGreaterThan(0)
    expect(lecture).toBeGreaterThan(acces)
    expect(sql).toContain("return coalesce((select jsonb_agg(r.piece_id order by r.piece_id)")
    expect(sql).toContain('where r.dossier_id = p_dossier_id and r.retire_le is null), \'[]\'::jsonb);')
    expect(messagesSql(sql)).toEqual(['Accès refusé à ce dossier.'])
    expect(MIGRATION).toContain(`revoke execute on function public.${FONCTION_DES_PIECES_HORS_DE_LA_CAISSE}(uuid) from public, anon;`)
    expect(MIGRATION).toContain(`grant execute on function public.${FONCTION_DES_PIECES_HORS_DE_LA_CAISSE}(uuid) to authenticated;`)
    // Elle se présente au cabinet avant d'être appliquée : l'en-tête le dit.
    expect(MIGRATION).toContain('ELLE OUVRE AU CLIENT UNE LECTURE QU\'IL N\'A PAS')
  })

  it('« Mes pièces » appelle la fonction de la migration, sous son nom, pour la société affichée', () => {
    const ecran = readFileSync(new URL('../pages/ClientUpload.tsx', import.meta.url), 'utf8')
    expect(ecran).toContain(`supabase.rpc('${FONCTION_DES_PIECES_HORS_DE_LA_CAISSE}', { p_dossier_id: id })`)
    expect(MIGRATION).toContain(`create function public.${FONCTION_DES_PIECES_HORS_DE_LA_CAISSE}(p_dossier_id uuid)`)
  })

  it('la garde de fin, le retour et les empreintes se tiennent ; le retour ne retire que ce qu’elle pose', () => {
    const empreintes = ['garder_especes_du_client_hors_des_reprises', FONCTION_DES_PIECES_HORS_DE_LA_CAISSE]
      .map((nom) => `${nom}=${md5(corps(definition(nom)))}`)
    for (const e of empreintes) {
      expect(bloc(MIGRATION, 'fin'), e).toContain(e)
      expect(bloc(RETOUR, 'garde'), e).toContain(e)
    }
    expect(MIGRATION).not.toMatch(/\b(drop|truncate)\b|delete from/i)
    expect(MIGRATION).not.toMatch(/create or replace/i)
    expect(MIGRATION).not.toContain('\\')
    expect(RETOUR.split('\n').filter((l) => /^drop /.test(l))).toEqual([
      'drop trigger operations_caisse_hors_des_reprises on public.operations_caisse;',
      'drop function public.garder_especes_du_client_hors_des_reprises();',
      `drop function public.${FONCTION_DES_PIECES_HORS_DE_LA_CAISSE}(uuid);`,
    ])
  })

  it('le drapeau suit l’export : levé depuis que la migration y est (appliquée le 16/11/2026)', () => {
    expect(EXPORTEE).toBe(true)
    expect(DRAPEAU_AU_CHARGEMENT).toBe(EXPORTEE)
    expect(especesDuClientHorsDesReprisesPrevues()).toBe(EXPORTEE)
  })

  it('l’essai attend les mots du module, et se dit EN ATTENTE sans la migration', () => {
    expect(ESSAI).toContain(`'${REFUS_DES_ESPECES_DU_CLIENT.modele.replace(/'/g, "''")}'`)
    expect(ESSAI).toContain("to_regprocedure('public.garder_especes_du_client_hors_des_reprises()') is not null")
    expect(ESSAI).toContain('EN ATTENTE de la migration especes_du_client_hors_des_reprises')
    expect(ESSAI).not.toMatch(/delete from/i)
  })
})

describe('A8Q5Q3Q2Q2-Q1 — la lecture et ce que « Mes pièces » en fait', () => {
  it('un tableau d’identifiants sans doublon : lue ; une erreur, une autre forme : illisible, jamais un vide deviné', async () => {
    expect(await lireLesPiecesHorsDeLaCaisse(Promise.resolve({ data: [P1], error: null })))
      .toEqual({ etat: 'lues', pieces: new Set([P1]) })
    expect(await lireLesPiecesHorsDeLaCaisse(Promise.resolve({ data: [], error: null }))).toEqual({ etat: 'lues', pieces: new Set() })
    expect((await lireLesPiecesHorsDeLaCaisse(Promise.resolve({ data: null, error: { message: 'Accès refusé à ce dossier.' } }))).etat)
      .toBe('illisibles')
    expect((await lireLesPiecesHorsDeLaCaisse(Promise.resolve({ data: [P1, P1], error: null }))).etat).toBe('illisibles')
    expect((await lireLesPiecesHorsDeLaCaisse(Promise.resolve({ data: { pieces: [P1] }, error: null }))).etat).toBe('illisibles')
    expect((await lireLesPiecesHorsDeLaCaisse(Promise.reject(new Error('réseau')))).etat).toBe('illisibles')
  })

  it('l’état : sans le drapeau, sans objet ; avant le retour, ou d’une autre société, en attente ; ratée, la phrase', () => {
    const lues = { dossierId: 'd1', lecture: { etat: 'lues' as const, pieces: new Set([P1]) } }
    expect(piecesHorsDeLaCaisseSelon(false, lues, 'd1')).toEqual({ etat: 'sans_objet' })
    expect(piecesHorsDeLaCaisseSelon(true, null, 'd1')).toEqual({ etat: 'attente' })
    expect(piecesHorsDeLaCaisseSelon(true, lues, 'd2')).toEqual({ etat: 'attente' })
    expect(piecesHorsDeLaCaisseSelon(true, lues, 'd1')).toEqual({ etat: 'lues', pieces: new Set([P1]) })
    const ratee = piecesHorsDeLaCaisseSelon(true, { dossierId: 'd1', lecture: { etat: 'illisibles', motif: 'liste illisible' } }, 'd1')
    expect(ratee.etat).toBe('illisibles')
    if (ratee.etat === 'illisibles') for (const m of MOTS_DU_CABINET) expect(ratee.texte, m.nom).not.toMatch(m.motif)
  })

  it('les gestes : offerts sans objet ou la liste lue ; ni en attente ni illisible, et la phrase alors', () => {
    expect(gestesDeLaCaisseOfferts({ etat: 'sans_objet' })).toEqual({ offerts: true, raison: null })
    expect(gestesDeLaCaisseOfferts({ etat: 'lues', pieces: new Set() })).toEqual({ offerts: true, raison: null })
    expect(gestesDeLaCaisseOfferts({ etat: 'attente' })).toEqual({ offerts: false, raison: null })
    expect(gestesDeLaCaisseOfferts({ etat: 'illisibles', texte: 'phrase' })).toEqual({ offerts: false, raison: 'phrase' })
  })

  it('avant le clic : les mots de la base sur une pièce de la liste, rien sur une autre, rien sans le drapeau', () => {
    expect(especesRefuseesAvantLeClic(P1, { etat: 'lues', pieces: new Set([P1]) })).toBe(REFUS_DES_ESPECES_DU_CLIENT.modele)
    expect(especesRefuseesAvantLeClic('autre', { etat: 'lues', pieces: new Set([P1]) })).toBeNull()
    expect(especesRefuseesAvantLeClic(P1, { etat: 'sans_objet' })).toBeNull()
    DRAPEAU_DES_ESPECES_DU_CLIENT.ESPECES_DU_CLIENT_HORS_DES_REPRISES_PREVUES = false
    expect(especesDuClientHorsDesReprisesPrevues()).toBe(false)
    DRAPEAU_DES_ESPECES_DU_CLIENT.ESPECES_DU_CLIENT_HORS_DES_REPRISES_PREVUES = true
    expect(especesDuClientHorsDesReprisesPrevues()).toBe(true)
  })
})
