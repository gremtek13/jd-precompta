import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { codesSql, messagesSql } from '../test/raiseSql'
import { definitionsSql, fichiersDuSchema, indiceSql, migrationRangee } from '../test/schema'
import {
  CODES_DES_CLIENTS_PREVUS, FORME_DU_CODE_CLIENT, PLUS_GRAND_CODE_CLIENT, REFUS_DU_CODE_CLIENT, TABLES_DES_CODES_DES_CLIENTS,
  codeDuClientDeLaFacture, codeDuRang, codesDesFiches, estUnCodeClient, phraseDuCodeClient,
} from './codesDesClients'

// LE CODE OPAQUE D'UNE FICHE CLIENT (EXP58-Q2). Ce que ces cas gardent : le module redit la migration `codes_des_clients` —
// sa forme, sa borne, ses refus sous leurs mots et leurs codes — ; la migration ne remplace `valider_exercice` que par ses trois
// retouches, sur le corps de production que sa garde nomme ; son retour rend ce corps au caractère près et ne retire que ce
// qu'elle a posé ; ses essais (supabase/essais/codesDesClients.sql, les étapes 167 de validationExercice.sql) l'attendent et
// jouent ses refus ; aucun mot que l'outil d'application retient n'y est. Données FICTIVES.

const md5 = (texte: string) => createHash('md5').update(texte, 'utf8').digest('hex')
const racine = new URL('../../', import.meta.url).pathname
const NOM = /^\d{14}_codes_des_clients\.sql$/
const dans = (dossier: string) => readdirSync(racine + dossier).filter((n) => NOM.test(n)).map((n) => `${racine}${dossier}/${n}`)
const CHEMINS = [...dans('supabase/preparees'), ...dans('supabase/schema')]
const MIGRATION = readFileSync(CHEMINS[0], 'utf8')
const RETOUR = readFileSync(`${racine}supabase/preparees/retour/20261124170100_retour_codes_des_clients.sql`, 'utf8')
const ESSAI = readFileSync(`${racine}supabase/essais/codesDesClients.sql`, 'utf8')
const VALIDATION = readFileSync(`${racine}supabase/essais/validationExercice.sql`, 'utf8')

/** La définition de `valider_exercice` dans un texte (la seule qu'il donne), du `create` au délimiteur fermant compris. */
function laValidationDans(texte: string): string {
  const definitions = definitionsSql('valider_exercice', [{ chemin: 'texte', texte }])
  expect(definitions).toHaveLength(1)
  return `${definitions[0].definition}$$;`
}
const corpsDe = (definition: string) => definition.slice(definition.indexOf('as $$') + 'as $$'.length, definition.lastIndexOf('$$'))

/** La définition de production de `valider_exercice` : la dernière de l'export, cette migration écartée si elle y est rangée. */
const PRODUCTION = (() => {
  const definitions = definitionsSql('valider_exercice', fichiersDuSchema().filter((f) => !/_codes_des_clients\.sql$/.test(f.chemin)))
  return `${definitions[definitions.length - 1].definition}$$;`
})()

// Les trois retouches, défaites dans l'ordre inverse : la migration doit alors rendre le corps de production au caractère près.
const RETOUCHES: readonly [string, string][] = [
  [
    "  --     ses clés, comme `identificationDuClient` le lit. Aucun chemin n'y fait entrer un nom.\n",
    "  --     ses clés, comme `identificationDuClient` le lit. Aucun chemin n'y fait entrer un nom. Depuis EXP58-Q2\n"
      + "  --     (`codes_des_clients`), aussi par le code de la fiche d'où vient le client d'un tel document\n"
      + "  --     (`factures_emises.contact_id`, figé avec lui), cette fiche du dossier : un code que la base a posé à sa\n"
      + '  --     création, qui ne change plus et ne dit rien du client.\n',
  ],
  [
    "    -- Les factures et les avoirs validés du dossier : leur numéro, et le SIRET ou le SIREN que leur client figé porte.\n"
      + '    select f.numero, f.tiers_siret as siret from public.factures_emises f\n',
    "    -- Les factures et les avoirs validés du dossier : leur numéro, le SIRET ou le SIREN que leur client figé porte, et la\n"
      + "    -- fiche d'où vient ce client (EXP58-Q2).\n"
      + '    select f.numero, f.tiers_siret as siret, f.contact_id from public.factures_emises f\n',
  ],
  [
    "    -- Ce qui identifie un client : le numéro d'un document validé, ou le SIREN juste de son client figé.\n"
      + '    select numero from documents\n    union\n    select siren from cles where siren_juste and siret_juste\n',
    "    -- Ce qui identifie un client : le numéro d'un document validé, le SIREN juste de son client figé, ou le code de la\n"
      + "    -- fiche d'où vient ce client, une fiche du dossier (EXP58-Q2).\n"
      + '    select numero from documents\n    union\n    select siren from cles where siren_juste and siret_juste\n'
      + '    union\n'
      + '    select c.code_client from documents d join public.contacts c on c.id = d.contact_id and c.dossier_id = p_dossier_id\n',
  ],
]

describe('la migration, préparée ou rangée, et le drapeau', () => {
  it('elle est à un seul endroit ; rangée dans l’export, le drapeau est levé ; préparée, il est baissé', () => {
    expect(CHEMINS).toHaveLength(1)
    expect(CODES_DES_CLIENTS_PREVUS).toBe(migrationRangee('codes_des_clients'))
    expect(TABLES_DES_CODES_DES_CLIENTS).toEqual(['contacts_numerotation'])
  })

  it('aucun mot que l’outil d’application retient : ni suppression, ni retrait d’objet ; la clé du compteur seule cascade avec son dossier', () => {
    expect(MIGRATION).not.toMatch(/\b(drop|truncate)\b/i)
    expect(MIGRATION).not.toMatch(/\bdelete\s+from\b/i)
    expect([...MIGRATION.matchAll(/\bdelete\b/gi)]).toHaveLength(1)
    expect(MIGRATION).toContain('dossier_id uuid primary key references public.dossiers (id) on delete cascade,')
    // Ni retour chariot ni échappement que les outils décoderaient.
    expect(MIGRATION).not.toMatch(/\r|\\u[0-9a-f]{4}/i)
  })
})

describe('la forme du code et sa borne, celles de la base', () => {
  it('la forme : celle de la contrainte, jamais C00000 — et la garde la compose ainsi', () => {
    expect(MIGRATION).toContain("add constraint contacts_code_client_forme check (code_client ~ '^C[0-9]{5}$' and code_client <> 'C00000'),")
    expect(FORME_DU_CODE_CLIENT.source).toBe('^C[0-9]{5}$')
    expect(MIGRATION).toContain("new.code_client := 'C' || lpad(v_numero::text, 5, '0');")
    expect(MIGRATION).toContain("set code_client = 'C' || lpad(r.rang::text, 5, '0')")
    for (const [rang, code] of [[1, 'C00001'], [42, 'C00042'], [99999, 'C99999']] as const) expect(codeDuRang(rang)).toBe(code)
    for (const faux of [0, 100000, 1.5, -1]) expect(() => codeDuRang(faux)).toThrow(RangeError)
    for (const oui of ['C00001', 'C99999']) expect(estUnCodeClient(oui)).toBe(true)
    for (const non of ['C00000', 'c00001', 'C0001', 'C000001', ' C00001', 'X12345', 123, null]) expect(estUnCodeClient(non)).toBe(false)
  })

  it('la borne : 99 999 codes par dossier, le compteur et la garde la tiennent', () => {
    expect(PLUS_GRAND_CODE_CLIENT).toBe(99999)
    expect(MIGRATION).toContain('dernier_numero integer not null check (dernier_numero between 1 and 99999)')
    expect(MIGRATION).toContain('on conflict (dossier_id) do update set dernier_numero = n.dernier_numero + 1 where n.dernier_numero < 99999')
  })

  it('les fiches d’avant reçoivent le leur dans l’ordre de leur création, dossier par dossier ; la colonne devient NOT NULL, unique dans le dossier', () => {
    expect(MIGRATION).toContain('row_number() over (partition by x.dossier_id order by x.cree_le, x.id) as rang')
    expect(MIGRATION).toContain('alter column code_client set not null,')
    expect(MIGRATION).toContain('add constraint contacts_code_client_unique unique (dossier_id, code_client);')
    // Le remplissage précède la garde, qui refuserait de changer un code.
    expect(indiceSql(MIGRATION, 'update public.contacts c')).toBeLessThan(indiceSql(MIGRATION, 'create trigger contacts_code_client'))
  })
})

describe('la garde : ses refus, son déclencheur, sa place', () => {
  const garde = definitionsSql('poser_code_client', [{ chemin: 'migration', texte: MIGRATION }])[0].definition

  it('ses deux refus, sous les mots et les codes du module, dans l’ordre', () => {
    expect(messagesSql(garde)).toEqual([REFUS_DU_CODE_CLIENT.change.message, REFUS_DU_CODE_CLIENT.borne.message])
    expect(codesSql(garde)).toEqual([REFUS_DU_CODE_CLIENT.change.code, REFUS_DU_CODE_CLIENT.borne.code])
  })

  it('aux droits du propriétaire, à son chemin, qu’aucun rôle n’exécute ; avant l’insertion et la mise à jour, après la porte', () => {
    expect(garde).toMatch(/language plpgsql\nsecurity definer\nset search_path = public\nas \$\$/)
    expect(MIGRATION).toContain('revoke execute on function public.poser_code_client() from public, anon, authenticated;')
    expect(MIGRATION).toContain('create trigger contacts_code_client before insert or update on public.contacts\n  for each row execute function public.poser_code_client();')
    // Les déclencheurs BEFORE d'une table tirent dans l'ordre de leurs noms : la porte d'abord, puis la garde du code, puis celle
    // des fiches liées (LM3), qui n'en lit rien.
    expect(['contacts_fiche_liee', 'contacts_code_client', '_acces_avant_les_gardes'].sort()).toEqual(
      ['_acces_avant_les_gardes', 'contacts_code_client', 'contacts_fiche_liee'])
    // Un code donné — la restauration — est gardé, et le compteur repris au plus haut, jamais en arrière.
    expect(garde).toContain('on conflict (dossier_id) do update set dernier_numero = greatest(n.dernier_numero, excluded.dernier_numero);')
  })

  it('le compteur : sous RLS, sans aucune policy permissive ; la restrictive de la double authentification sous condition', () => {
    expect(MIGRATION).toContain('alter table public.contacts_numerotation enable row level security;')
    expect([...MIGRATION.matchAll(/create policy (\w+) on public\.(\w+)/gi)].map((m) => `${m[1]}:${m[2]}`)).toEqual(['deux_facteurs:contacts_numerotation'])
    expect(MIGRATION).toContain("if to_regprocedure('public.deux_facteurs_satisfaits()') is not null then")
  })
})

describe('la validation : le corps de production, et trois retouches seulement', () => {
  const posee = laValidationDans(MIGRATION)

  it('la garde de tête nomme l’empreinte du corps de production', () => {
    expect(md5(corpsDe(PRODUCTION))).toBe('923cfa1b57037146070ca1430f163495')
    expect(MIGRATION).toContain("('valider_exercice(uuid, integer, jsonb, jsonb, jsonb)', '923cfa1b57037146070ca1430f163495'),")
  })

  it('ses retouches défaites, elle rend la définition de production au caractère près', () => {
    let defaite = posee
    for (const [avant, apres] of [...RETOUCHES].reverse()) {
      expect(defaite.split(apres).length - 1, apres.slice(0, 60)).toBe(1)
      defaite = defaite.replace(apres, avant)
    }
    expect(defaite).toBe(PRODUCTION)
  })

  it('le message du refus « client_inconnu » est celui d’hier : le module et les essais d’hier le relisent tel quel', () => {
    const message = "Une ligne de la numérotation proposée identifie le client autrement que par le numéro d''une facture validée du dossier ou par le SIREN qu''elle porte."
    expect(posee).toContain(message)
    expect(PRODUCTION).toContain(message)
  })

  it('le retour rend la définition de production, et sa garde nomme l’empreinte du corps que la migration pose', () => {
    expect(laValidationDans(RETOUR)).toBe(PRODUCTION)
    expect(RETOUR).toContain(`is distinct from '${md5(corpsDe(posee))}' then`)
  })
})

describe('le retour : ce que la migration a posé, rien d’autre, refusé dès qu’un exercice validé cite un code', () => {
  it('il retire le déclencheur, la garde, le compteur, les deux contraintes et la colonne — en dernier, après la validation d’hier', () => {
    const retraits = [...RETOUR.matchAll(/^(drop \w+ [^;]+|alter table public\.contacts drop [^;]+);$/gim)].map((m) => m[1])
    expect(retraits).toEqual([
      'drop trigger contacts_code_client on public.contacts', 'drop function public.poser_code_client()',
      'drop table public.contacts_numerotation', 'alter table public.contacts drop constraint contacts_code_client_unique',
      'alter table public.contacts drop constraint contacts_code_client_forme', 'alter table public.contacts drop column code_client',
    ])
    expect(indiceSql(RETOUR, 'create or replace function public.valider_exercice(')).toBeLessThan(indiceSql(RETOUR, 'drop trigger'))
  })

  it('sa garde : les objets de la migration, puis aucune écriture validée qui identifie son client par le code d’une fiche', () => {
    expect(RETOUR).toContain('join public.contacts c on c.dossier_id = e.dossier_id and c.code_client = e.identification_client')
    expect(RETOUR).toContain("where e.statut = 'validee';")
    expect(indiceSql(RETOUR, 'do $garde$')).toBeLessThan(indiceSql(RETOUR, 'create or replace function'))
  })
})

describe('les essais l’attendent, et jouent ses refus', () => {
  it('codesDesClients.sql : EN ATTENTE sans la colonne ; chaque refus de la garde sous ses mots ; ses mutations ; rien qui retire une ligne', () => {
    expect(ESSAI).toContain("c.table_schema = 'public' and c.table_name = 'contacts' and c.column_name = 'code_client'")
    expect(ESSAI).toContain("'0. EN ATTENTE de la migration codes_des_clients (EXP58-Q2)'")
    expect(ESSAI).toContain(`change constant text := '${REFUS_DU_CODE_CLIENT.change.message.replace(/'/g, "''")}';`)
    expect(ESSAI).toContain(`borne constant text := '${REFUS_DU_CODE_CLIENT.borne.message.replace(/'/g, "''")}';`)
    expect([...ESSAI.matchAll(/'\d+[a-z]?\. MUTATION de /g)].length).toBeGreaterThanOrEqual(4)
    expect(ESSAI).not.toMatch(/\bdelete\b|\btruncate\b|\bdrop\b/i)
  })

  it('validationExercice.sql : les étapes « …k » attendent la migration ; le code d’une fiche d’un document validé passe, les autres non', () => {
    expect(VALIDATION).toContain("codes boolean := exists (select 1 from information_schema.columns c")
    expect(VALIDATION).toContain("'167. EN ATTENTE de la migration codes_des_clients (EXP58-Q2) : '")
    for (const etape of ['167. le code de la fiche', '167b. le code d', '167c. … ni celui d', '167d. … ni un code', '167e. MUTATION de 167b']) {
      expect(VALIDATION, etape).toContain(etape)
    }
  })
})

describe('ce que la lecture du FEC tire des fiches', () => {
  const fiches = [
    { id: 'k1', dossier_id: 'd1', code_client: 'C00001' }, { id: 'k2', dossier_id: 'd1', code_client: 'C00002' },
    { id: 'kx', dossier_id: 'd2', code_client: 'C00001' },
  ]

  it('le code de chaque fiche du dossier ; une fiche d’un autre dossier n’y entre pas', () => {
    expect([...codesDesFiches(fiches, 'd1')]).toEqual([['k1', 'C00001'], ['k2', 'C00002']])
  })

  it('une facture : le code de la fiche d’où vient son client, sinon nul — sans provenance, une provenance inconnue, ou d’ailleurs', () => {
    const codes = codesDesFiches(fiches, 'd1')
    expect(codeDuClientDeLaFacture({ contact_id: 'k2' }, codes)).toBe('C00002')
    expect(codeDuClientDeLaFacture({ contact_id: null }, codes)).toBeNull()
    expect(codeDuClientDeLaFacture({}, codes)).toBeNull()
    expect(codeDuClientDeLaFacture({ contact_id: 'kx' }, codes)).toBeNull()
    expect(codeDuClientDeLaFacture({ contact_id: 'k-inconnu' }, codes)).toBeNull()
  })
})

describe('les mots des écrans', () => {
  it('au client : tutoiement, aucun mot du cabinet ; au cabinet, ce que le code désigne et qu’il ne change plus', () => {
    expect(phraseDuCodeClient('client')).toMatch(/\btes clients\b/)
    expect(phraseDuCodeClient('client')).not.toMatch(/cabinet|FEC|onglet|vous/i)
    expect(phraseDuCodeClient('cabinet')).toContain('ne change plus, même effacé')
    expect(phraseDuCodeClient('cabinet')).toContain('FEC')
  })
})
