import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { definitionsSql, fichiersDuSchema, indiceSql } from '../test/schema'
import { codesSql, messagesSql } from '../test/raiseSql'
import { sansCommentaires } from '../test/blocsSql'
import {
  DRAPEAU_DU_SOUS_DOSSIER, REFUS_DU_SOUS_DOSSIER, refusDuDeplacement, refusDuRangement, refusDuRangementSelon,
  sousDossierDansSonDossierPrevu,
} from './sousDossierDansSonDossier'

// DOCF-Q1-B : LE SOUS-DOSSIER D'UN DOCUMENT OU D'UNE PIÈCE, TENU DANS SON DOSSIER. Le module redit les refus de la migration
// préparée `sous_dossier_dans_son_dossier`, confrontés à son texte ; ses deux déclencheurs de ligne tirent juste après la porte
// d'accès et avant toute garde BEFORE que l'export pose sur `documents_divers` et `pieces` ; la garde du sous-dossier reste
// aux droits de l'appelant (hors de la porte) ; ses empreintes et celles de son retour se tiennent ; le drapeau suit l'export ;
// l'essai attend les mots du module. Données FICTIVES.

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

const MIGRATION = leFichier(/^\d{14}_sous_dossier_dans_son_dossier\.sql$/, ['../../supabase/preparees/', '../../supabase/schema/'])
const RETOUR = leFichier(/^\d{14}_retour_sous_dossier_dans_son_dossier\.sql$/, ['../../supabase/preparees/retour/'])
const ESSAI = readFileSync(new URL('../../supabase/essais/sousDossierDansSonDossier.sql', import.meta.url), 'utf8')
const SCHEMA = fichiersDuSchema()
const EXPORTEE = SCHEMA.some((f) => /\d{14}_sous_dossier_dans_son_dossier\.sql$/.test(f.chemin))
const md5 = (texte: string) => createHash('md5').update(texte, 'utf8').digest('hex')

function definition(nom: string): string {
  const definitions = definitionsSql(nom, [{ chemin: 'migration', texte: MIGRATION }])
  expect(definitions).toHaveLength(1)
  return definitions[0].definition
}
const GARDE = () => definition('garder_sous_dossier_dans_son_dossier')
const OCCUPE = () => definition('garder_sous_dossier_occupe')
const corps = (d: string) => d.slice(d.indexOf('as $$') + 'as $$'.length)
const bloc = (texte: string, etiquette: string) => {
  const debut = texte.indexOf(`do $${etiquette}$`)
  return texte.slice(debut, texte.indexOf(`$${etiquette}$;`, debut))
}

/** Les déclencheurs BEFORE que l'export pose, par table : leurs noms, sans ceux qu'un fichier retire ensuite. */
function declencheursBeforeDeLExport(table: string): string[] {
  const noms = new Set<string>()
  for (const f of SCHEMA) {
    const texte = sansCommentaires(f.texte)
    for (const m of texte.matchAll(/create\s+(?:or\s+replace\s+)?trigger\s+(\w+)\s+before\s+[^;]*?\son\s+(?:public\.)?(\w+)\s/gi)) {
      if (m[2].toLowerCase() === table) noms.add(m[1].toLowerCase())
    }
    for (const m of texte.matchAll(/drop\s+trigger\s+(?:if\s+exists\s+)?(\w+)\s+on\s+(?:public\.)?(\w+)/gi)) {
      if (m[2].toLowerCase() === table) noms.delete(m[1].toLowerCase())
    }
  }
  return [...noms].sort()
}

/** Comparaison octet par octet, comme PostgreSQL range les noms des déclencheurs d'un même évènement. */
const avant = (a: string, b: string) => Buffer.compare(Buffer.from(a), Buffer.from(b)) < 0

const DRAPEAU_AU_CHARGEMENT = DRAPEAU_DU_SOUS_DOSSIER.SOUS_DOSSIER_DANS_SON_DOSSIER_PREVU
afterEach(() => {
  DRAPEAU_DU_SOUS_DOSSIER.SOUS_DOSSIER_DANS_SON_DOSSIER_PREVU = DRAPEAU_AU_CHARGEMENT
})

describe('DOCF-Q1-B — la migration, son retour et le module', () => {
  it('les deux gardes : leurs trois refus, au code 23514, dans l’ordre du module', () => {
    const sql = GARDE() + '\n' + OCCUPE()
    expect(messagesSql(sql)).toEqual(REFUS_DU_SOUS_DOSSIER.map((r) => r.modele))
    expect(codesSql(sql)).toEqual(REFUS_DU_SOUS_DOSSIER.map((r) => r.code))
  })

  it('un refus ne dit rien du sous-dossier : ni nom, ni dossier, ni identifiant', () => {
    for (const r of REFUS_DU_SOUS_DOSSIER) expect(r.modele, r.cle).not.toMatch(/%|«|»|\d/)
  })

  it('la garde de la ligne aux droits de son propriétaire, verrouillant le sous-dossier en partage ; celle du sous-dossier aux droits de l’appelant ; aucune exécutable par un rôle de session', () => {
    expect(GARDE()).toMatch(/returns trigger\nlanguage plpgsql\nsecurity definer\nset search_path = public\n/)
    expect(GARDE()).toContain('perform 1 from public.sous_dossiers s where s.id = new.sous_dossier_id and s.dossier_id = new.dossier_id for share;')
    expect(OCCUPE()).toMatch(/returns trigger\nlanguage plpgsql\nsecurity invoker\nset search_path = public\n/)
    for (const nom of ['garder_sous_dossier_dans_son_dossier', 'garder_sous_dossier_occupe']) {
      expect(MIGRATION).toContain(`revoke all on function public.${nom}() from public, anon, authenticated, service_role;`)
    }
  })

  it('ses trois déclencheurs BEFORE : la ligne qui a un sous-dossier, le sous-dossier qui change de dossier', () => {
    const declencheurs = [...MIGRATION.matchAll(/create trigger (\w+)\n {2}before ([^\n]+) on public\.(\w+)\n {2}for each row when \(([^\n]+)\)\n/gi)]
      .map((m) => ({ nom: m[1], evenements: m[2], table: m[3], quand: m[4] }))
    expect(declencheurs).toEqual([
      { nom: 'documents_divers_au_sous_dossier_de_leur_dossier', evenements: 'insert or update of sous_dossier_id, dossier_id', table: 'documents_divers', quand: 'new.sous_dossier_id is not null' },
      { nom: 'pieces_au_sous_dossier_de_leur_dossier', evenements: 'insert or update of sous_dossier_id, dossier_id', table: 'pieces', quand: 'new.sous_dossier_id is not null' },
      { nom: 'sous_dossiers_occupes_restent_dans_leur_dossier', evenements: 'update of dossier_id', table: 'sous_dossiers', quand: 'old.dossier_id is distinct from new.dossier_id' },
    ])
    for (const d of declencheurs) expect(bloc(MIGRATION, 'fin'), d.nom).toContain(`CREATE TRIGGER ${d.nom} BEFORE `)
  })

  it('leur rang : juste après la porte d’accès, avant toute garde BEFORE que l’export pose sur documents_divers et pieces', () => {
    for (const [table, nom, plancher] of [
      ['documents_divers', 'documents_divers_au_sous_dossier_de_leur_dossier', 'documents_divers_cites_en_revision'],
      ['pieces', 'pieces_au_sous_dossier_de_leur_dossier', 'pieces_figees_par_la_validation'],
    ]) {
      const autres = declencheursBeforeDeLExport(table).filter((t) => t !== nom)
      expect(autres, table).toContain('_acces_avant_les_gardes')
      expect(autres, table).toContain(plancher)
      for (const autre of autres) {
        if (autre === '_acces_avant_les_gardes') expect(avant(autre, nom), autre).toBe(true)
        else expect(avant(nom, autre), `${nom} avant ${autre}`).toBe(true)
      }
    }
  })

  it('le relevé de zéro ligne fautive porte sur les documents et les pièces, avant toute pose', () => {
    const tete = bloc(MIGRATION, 'garde')
    expect(tete).toContain('from public.documents_divers d join public.sous_dossiers s on s.id = d.sous_dossier_id')
    expect(tete).toContain('from public.pieces p join public.sous_dossiers s on s.id = p.sous_dossier_id')
    expect(tete.match(/where s\.dossier_id is distinct from [dp]\.dossier_id;/g)).toHaveLength(2)
    expect(MIGRATION.indexOf('do $garde$')).toBeLessThan(indiceSql(MIGRATION, 'create function public.garder_sous_dossier_dans_son_dossier'))
  })

  it('la garde de fin, le retour et les empreintes se tiennent ; le texte passe par l’outil ; le retour ne retire que ce qu’elle pose', () => {
    for (const d of [GARDE(), OCCUPE()]) {
      const empreinte = md5(corps(d))
      expect(bloc(MIGRATION, 'fin')).toContain(`is distinct from '${empreinte}'`)
      expect(bloc(RETOUR, 'garde')).toContain(`is distinct from '${empreinte}'`)
    }
    expect(MIGRATION).not.toMatch(/\b(drop|truncate|delete)\b/i)
    expect(MIGRATION).not.toMatch(/create or replace/i)
    expect(MIGRATION).not.toContain('\\')
    expect(RETOUR.split('\n').filter((l) => /^drop /.test(l))).toEqual([
      'drop trigger documents_divers_au_sous_dossier_de_leur_dossier on public.documents_divers;',
      'drop trigger pieces_au_sous_dossier_de_leur_dossier on public.pieces;',
      'drop trigger sous_dossiers_occupes_restent_dans_leur_dossier on public.sous_dossiers;',
      'drop function public.garder_sous_dossier_dans_son_dossier();',
      'drop function public.garder_sous_dossier_occupe();',
    ])
  })

  it('le drapeau suit l’export : baissé tant que la migration n’y est pas', () => {
    expect(DRAPEAU_AU_CHARGEMENT).toBe(EXPORTEE)
    expect(sousDossierDansSonDossierPrevu()).toBe(EXPORTEE)
  })

  it('l’essai attend les mots du module, et se dit EN ATTENTE sans la migration', () => {
    for (const r of REFUS_DU_SOUS_DOSSIER) expect(ESSAI, r.cle).toContain(`'${r.modele.replace(/'/g, "''")}'`)
    expect(ESSAI).toContain("to_regprocedure('public.garder_sous_dossier_dans_son_dossier()') is not null")
    expect(ESSAI).toContain('EN ATTENTE de la migration sous_dossier_dans_son_dossier')
    expect(ESSAI).not.toMatch(/delete from/i)
  })
})

const DA = 'd0cf0000-0000-4000-8000-0000000000d1'
const DB = 'd0cf0000-0000-4000-8000-0000000000d2'

describe('DOCF-Q1-B — le jugement, comme la base', () => {
  it('le rangement : un sous-dossier de son dossier passe ; d’un autre dossier, ou inconnu, non ; sans sous-dossier, rien', () => {
    for (const table of ['documents_divers', 'pieces'] as const) {
      const cle = table === 'documents_divers' ? 'document_hors_du_dossier' : 'piece_hors_du_dossier'
      expect(refusDuRangement({ table, dossierId: DA, sousDossierId: 's', dossierDuSousDossier: DA })).toBeNull()
      expect(refusDuRangement({ table, dossierId: DA, sousDossierId: 's', dossierDuSousDossier: DB })?.cle).toBe(cle)
      expect(refusDuRangement({ table, dossierId: DA, sousDossierId: 's', dossierDuSousDossier: null })?.cle).toBe(cle)
      expect(refusDuRangement({ table, dossierId: DA, sousDossierId: null, dossierDuSousDossier: null })).toBeNull()
    }
  })
  it('le déplacement : occupé, refusé ; vide, ou sans changer de dossier, rien', () => {
    expect(refusDuDeplacement({ dossierId: DA, nouveauDossierId: DB, occupe: true })?.message).toBe(REFUS_DU_SOUS_DOSSIER[2].modele)
    expect(refusDuDeplacement({ dossierId: DA, nouveauDossierId: DB, occupe: false })).toBeNull()
    expect(refusDuDeplacement({ dossierId: DA, nouveauDossierId: DA, occupe: true })).toBeNull()
  })
  it('selon l’état de la base : baissé, rien ; levé, le refus', () => {
    const fautif = { table: 'pieces' as const, dossierId: DA, sousDossierId: 's', dossierDuSousDossier: DB }
    expect(refusDuRangementSelon(false, fautif)).toBeNull()
    expect(refusDuRangementSelon(true, fautif)?.message).toBe(REFUS_DU_SOUS_DOSSIER[1].modele)
    DRAPEAU_DU_SOUS_DOSSIER.SOUS_DOSSIER_DANS_SON_DOSSIER_PREVU = true
    expect(sousDossierDansSonDossierPrevu()).toBe(true)
  })
})
