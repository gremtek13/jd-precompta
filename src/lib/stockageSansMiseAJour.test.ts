import { readFileSync, readdirSync, statSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { FormeInconnue, fichiersDuSchema, fichiersPrepares } from '../test/schema'
import { policiesDuSchema, vautPour, type ReleveDesPolicies } from '../test/policiesDuSchema'

// AUCUN SEAU N'OUVRE LA MISE À JOUR D'UN OBJET DU STOCKAGE (relecture de sécurité du 13/11/2026, SECU3-Q1). Un fichier
// déposé ne se réécrit, ne s'écrase ni ne se déplace : l'application dépose un fichier neuf et retire l'ancien. La règle,
// en base : aucune policy PERMISSIVE de storage.objects ne vaut pour la mise à jour (UPDATE, ou « pour tout ») — une
// policy restrictive n'ouvre rien.
//
// Le scanner part de TOUT : chaque policy de l'export (supabase/schema, le socle compris), rejouée instruction par
// instruction (src/test/policiesDuSchema.ts, qui lève sur une forme qu'il ne sait pas rejouer), puis les migrations
// préparées (supabase/preparees). Deux états :
//   - l'export seul, la production : les deux policies d'aujourd'hui sont des EXCEPTIONS nommées, chacune avec sa raison,
//     et comptées ; le jour où la migration `stockage_sans_mise_a_jour` entre dans l'export, ce test tombe, et la liste se
//     vide ;
//   - l'export et les préparées, la base de demain : aucune exception.
// Un plancher distingue « zéro faute » d'« aveugle » ; des défauts plantés prouvent qu'il voit. Le reste de ce fichier
// confronte la migration, son retour, le retour d'INAL1 et le bloc SM de rls.sql au même prédicat. Récit : HISTORIQUE.md,
// « 13/11/2026 — SECU3-Q1 ET SECU3-Q2 ».

const RACINE = new URL('../../', import.meta.url).pathname
const lire = (chemin: string) => readFileSync(`${RACINE}${chemin}`, 'utf8')
const MIGRATION = 'supabase/preparees/20261113193000_stockage_sans_mise_a_jour.sql'
const RETOUR = 'supabase/preparees/retour/20261113193100_retour_stockage_sans_mise_a_jour.sql'
const RETOUR_INAL1 = 'supabase/preparees/retour/20261110120050_retour_piece_figee_dans_le_stockage.sql'

// Les policies d'aujourd'hui qui ouvrent la mise à jour d'un objet, chacune avec sa raison. Elles tombent quand la
// migration préparée entre dans l'export.
const EXCEPTIONS: Record<string, string> = {
  cabinet_logos_maj_chef: 'la mise à jour d\'un logo par le chef du cabinet (charte_graphique_cabinet, 08/09/2026) : rien ne s\'en sert, SECU3-Q1 la retire',
  packs_storage_all: 'la policy « pour tout » du seau des packs (storage_pieces_packs_isolation_cabinet, 08/09/2026) : SECU3-Q1 la remplace par la lecture, le dépôt et la suppression',
}

/** Les policies permissives de storage.objects qui valent pour la mise à jour. */
function ouvrentLaMiseAJour(releve: ReleveDesPolicies): string[] {
  return [...releve.policies.values()]
    .filter((p) => p.table === 'storage.objects' && p.permissive && vautPour(p, 'update'))
    .map((p) => p.nom)
    .sort()
}

const EXPORT = () => policiesDuSchema(fichiersDuSchema())
const DEMAIN = () => policiesDuSchema([...fichiersDuSchema(), ...fichiersPrepares()])
const sansSchema = (expression: string | null) => (expression ?? '').replace(/\bpublic\./g, '')

describe('aucun seau n’ouvre la mise à jour d’un objet du stockage', () => {
  it('dans l’export (la production), les seules policies qui l’ouvrent sont les deux exceptions nommées, et comptées', () => {
    expect(Object.keys(EXCEPTIONS)).toHaveLength(2)
    for (const raison of Object.values(EXCEPTIONS)) expect(raison.length).toBeGreaterThan(40)
    expect(ouvrentLaMiseAJour(EXPORT())).toEqual(Object.keys(EXCEPTIONS).sort())
  })

  it('avec les migrations préparées (la base de demain), aucune', () => {
    expect(ouvrentLaMiseAJour(DEMAIN())).toEqual([])
  })

  it('le plancher : il lit toutes les policies du stockage, et celles de tout le schéma', () => {
    const export_ = EXPORT()
    const stockage = [...export_.policies.values()].filter((p) => p.table === 'storage.objects')
    // Relevés le 13/11/2026, export à 218 migrations : 12 policies du stockage (celles de la réplique, une à une), 381
    // instructions de policy, 6 policies deux_facteurs écrites dans une chaîne, 105 tables (signature.sql : 105) ; avec
    // les préparées, 431 instructions, 17 chaînes, 17 policies du stockage.
    expect(stockage.length, 'les policies de storage.objects dans l’export').toBeGreaterThanOrEqual(12)
    expect(export_.instructions, 'les instructions de policy lues dans l’export').toBeGreaterThanOrEqual(381)
    expect(export_.dynamiques, 'les policies restrictives deux_facteurs écrites dans une chaîne').toBeGreaterThanOrEqual(6)
    expect(export_.tables.size, 'les tables créées').toBeGreaterThanOrEqual(105)
    const demain = DEMAIN()
    expect(demain.instructions).toBeGreaterThanOrEqual(431)
    expect([...demain.policies.values()].filter((p) => p.table === 'storage.objects').length).toBeGreaterThanOrEqual(17)
  })

  it('un défaut planté se voit : une policy de mise à jour, ou « pour tout », sur un seau ; une restrictive n’ouvre rien', () => {
    const plante = (sql: string) => ouvrentLaMiseAJour(policiesDuSchema([...fichiersDuSchema(), { chemin: 'supabase/preparees/99999999999999_plante.sql', texte: sql }]))
    const aujourdhui = Object.keys(EXCEPTIONS).sort()
    expect(plante(`create policy essai_maj on storage.objects for update to authenticated using (bucket_id = 'pieces');`))
      .toEqual([...aujourdhui, 'essai_maj'].sort())
    expect(plante(`create policy "essai pour tout" on storage.objects to authenticated using (true) with check (true);`))
      .toEqual([...aujourdhui, 'essai pour tout'].sort())
    expect(plante(`alter policy pieces_storage_select on storage.objects using (true);`)).toEqual(aujourdhui)
    expect(plante(`create policy essai_restrictive on storage.objects as restrictive for update to authenticated using (false);`)).toEqual(aujourdhui)
    expect(plante(`drop policy packs_storage_all on storage.objects;`)).toEqual(['cabinet_logos_maj_chef'])
    expect(plante(`do $$ begin create policy essai_corps on storage.objects for all using (false); end $$;`))
      .toEqual([...aujourdhui, 'essai_corps'].sort())
  })

  it('une forme qu’il ne sait pas rejouer lève au lieu d’être devinée', () => {
    const plante = (sql: string) => () => policiesDuSchema([...fichiersDuSchema(), { chemin: 'supabase/preparees/99999999999999_plante.sql', texte: sql }])
    expect(plante(`alter policy pieces_storage_select on storage.objects rename to autre;`)).toThrow(FormeInconnue)
    expect(plante(`do $$ begin execute 'create policy x on storage.objects for update using (true)'; end $$;`)).toThrow(FormeInconnue)
    expect(plante(`create policy x on storage.objects for update using (true) with nonsense;`)).toThrow(FormeInconnue)
    expect(plante(`alter policy jamais_posee on storage.objects using (true);`)).toThrow(FormeInconnue)
    expect(plante(`drop policy jamais_posee on storage.objects;`)).toThrow(FormeInconnue)
    expect(plante(`create policy packs_storage_all on storage.objects using (true);`)).toThrow(FormeInconnue)
  })
})

describe('la migration stockage_sans_mise_a_jour, son retour et ce qui la redit', () => {
  const avant = EXPORT().policies
  const packs = avant.get('storage.objects.packs_storage_all')!
  const logos = avant.get('storage.objects.cabinet_logos_maj_chef')!

  it('les trois policies des packs portent le prédicat d’hier, à authenticated seul ; les deux d’hier partent', () => {
    expect(packs.using).toBe(packs.withCheck)
    const apres = policiesDuSchema([...fichiersDuSchema(), { chemin: MIGRATION, texte: lire(MIGRATION) }]).policies
    for (const [nom, commande, using, withCheck] of [
      ['packs_storage_lecture', 'select', packs.using, null], ['packs_storage_depot', 'insert', null, packs.using],
      ['packs_storage_suppression', 'delete', packs.using, null]] as const) {
      const p = apres.get(`storage.objects.${nom}`)!
      expect(p, nom).toBeDefined()
      expect([p.permissive, p.commande, p.roles]).toEqual([true, commande, ['authenticated']])
      expect([sansSchema(p.using), sansSchema(p.withCheck)]).toEqual([sansSchema(using), sansSchema(withCheck)])
    }
    expect(apres.has('storage.objects.packs_storage_all')).toBe(false)
    expect(apres.has('storage.objects.cabinet_logos_maj_chef')).toBe(false)
    // Les trois policies des logos qui restent, inchangées.
    for (const nom of ['cabinet_logos_lecture_publique', 'cabinet_logos_ecriture_chef', 'cabinet_logos_suppression_chef']) {
      expect(apres.get(`storage.objects.${nom}`), nom).toEqual(avant.get(`storage.objects.${nom}`))
    }
  })

  it('son retour rend les deux policies d’hier, mot pour mot, et retire les trois posées', () => {
    const migree = [...fichiersDuSchema(), { chemin: MIGRATION, texte: lire(MIGRATION) }]
    const rendue = policiesDuSchema([...migree, { chemin: RETOUR, texte: lire(RETOUR) }]).policies
    for (const p of [packs, logos]) {
      const q = rendue.get(`${p.table}.${p.nom}`)!
      expect([q.permissive, q.commande, q.roles, sansSchema(q.using), sansSchema(q.withCheck)])
        .toEqual([p.permissive, p.commande, p.roles, sansSchema(p.using), sansSchema(p.withCheck)])
    }
    expect([...rendue.keys()].filter((k) => k.startsWith('storage.objects.packs_storage_')).sort()).toEqual(['storage.objects.packs_storage_all'])
  })

  it('la voie : la migration et son retour retirent des policies, ils se collent, et le disent', () => {
    expect(lire(MIGRATION)).toMatch(/À COLLER dans\s+(--\s+)?l'éditeur SQL/)
    expect(lire(MIGRATION)).toMatch(/^drop policy packs_storage_all on storage\.objects;$/im)
    expect(lire(MIGRATION)).toMatch(/^drop policy cabinet_logos_maj_chef on storage\.objects;$/im)
    expect(lire(RETOUR)).toMatch(/Il se COLLE dans l'éditeur SQL/)
    for (const chemin of [MIGRATION, RETOUR]) expect(lire(chemin), chemin).not.toMatch(/[\r\\]/)
  })

  it('le retour d’INAL1 admet la surface de suppression avant et après elle, au même prédicat des packs', () => {
    const fin = lire(RETOUR_INAL1).slice(lire(RETOUR_INAL1).indexOf('do $fin$'))
    const admises = [...fin.matchAll(/'(cabinet_logos_suppression_chef:d:[^']+)'/g)].map((m) => m[1])
    expect(admises).toHaveLength(4)
    const empreinte = /packs_storage_all:\*:([0-9a-f]{32})/.exec(admises[0])![1]
    expect(admises.filter((a) => a.includes(`packs_storage_all:*:${empreinte}`))).toHaveLength(2)
    expect(admises.filter((a) => a.includes(`packs_storage_suppression:d:${empreinte}`))).toHaveLength(2)
    // Chaque état d'après est un état d'avant où seule la suppression des packs a changé de nom et de commande.
    for (const a of admises.filter((x) => x.includes('packs_storage_suppression'))) {
      expect(admises).toContain(a.replace(`packs_storage_suppression:d:${empreinte}`, `packs_storage_all:*:${empreinte}`))
    }
  })

  it('le bloc SM de rls.sql attend les prédicats que la migration pose', () => {
    const rls = lire('supabase/essais/rls.sql')
    const bloc = rls.slice(rls.indexOf('do $sm$'), rls.indexOf('end $sm$;'))
    const constante = (texte: string, nom: string) => new RegExp(String.raw`${nom} constant text := ('(?:[^']|'')*');`).exec(texte)?.[1]
    const garde = lire(MIGRATION).slice(lire(MIGRATION).indexOf('do $fin$'))
    expect(constante(bloc, 'packs')).toBeDefined()
    expect(constante(bloc, 'packs')).toBe(constante(garde, 'v_packs'))
    expect(constante(bloc, 'logos')).toBe(constante(garde, 'v_logos'))
  })
})

// LA MÊME RÈGLE CÔTÉ APPLICATION : aucun appel du stockage ne réécrit, ne déplace ni n'écrase un objet — la base le
// refuserait sous la RLS. Il part de TOUTE la source (le navigateur, hors tests, et les Edge Functions) et lit l'ARBRE de
// chaque appel `<…>.storage.from(…).<méthode>(…)` : `update`, `move` et `copy` sont des fautes ; un `upload` dont les options
// portent `upsert: true` écrase — une exception nommée, comptée par fichier, avec sa raison ; une option qui n'est ni
// absente, ni un littéral objet, ni `upsert: false` ou `true` est une forme inconnue, donc une faute.
// (depotsDansLesSeaux.test.ts juge le seau et le type de chaque dépôt ; il ne regarde pas l'écrasement.)
const ECRASEMENTS_ADMIS: Record<string, { nombre: number; raison: string }> = {
  'supabase/functions/superpdp-sync/index.ts': {
    nombre: 1,
    raison: 'le texte d\'une facture reçue, déposé dans le seau des pièces par la clé secrète, hors de la RLS : aucun seau sous la RLS n\'est écrasé',
  },
}

function lister(dossier: string, garder: (chemin: string) => boolean): string[] {
  return (readdirSync(`${RACINE}${dossier}`, { recursive: true }) as string[])
    .map((n) => `${dossier}/${n}`)
    .filter((c) => garder(c) && statSync(`${RACINE}${c}`).isFile())
    .sort()
}

interface Releve { fichiers: number; depots: number; ecrasent: Map<string, number>; fautes: string[] }

function appelsDuStockage(sources: { chemin: string; texte: string }[]): Releve {
  const r: Releve = { fichiers: sources.length, depots: 0, ecrasent: new Map(), fautes: [] }
  for (const { chemin, texte } of sources) {
    if (!texte.includes('storage')) continue
    const arbre = ts.createSourceFile(chemin, texte, ts.ScriptTarget.Latest, true, chemin.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    const ligne = (n: ts.Node) => `${chemin}:${arbre.getLineAndCharacterOfPosition(n.getStart()).line + 1}`
    const visiter = (n: ts.Node): void => {
      // `<…>.storage.from(…).<méthode>(…)`
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && ts.isCallExpression(n.expression.expression)
          && ts.isPropertyAccessExpression(n.expression.expression.expression) && n.expression.expression.expression.name.text === 'from'
          && ts.isPropertyAccessExpression(n.expression.expression.expression.expression)
          && n.expression.expression.expression.expression.name.text === 'storage') {
        const methode = n.expression.name.text
        if (['update', 'move', 'copy'].includes(methode)) r.fautes.push(`${ligne(n)} : ${methode}`)
        if (methode === 'upload') {
          r.depots++
          const options = n.arguments[2]
          if (options && !ts.isObjectLiteralExpression(options)) r.fautes.push(`${ligne(n)} : des options qu'on ne sait pas lire`)
          for (const p of options && ts.isObjectLiteralExpression(options) ? options.properties : []) {
            if (!ts.isPropertyAssignment(p)) {
              if (!ts.isShorthandPropertyAssignment(p) || p.name.text === 'upsert') r.fautes.push(`${ligne(n)} : une option qu'on ne sait pas lire`)
              continue
            }
            const nom = ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : null
            if (nom === null) r.fautes.push(`${ligne(n)} : une option au nom calculé`)
            if (nom !== 'upsert') continue
            if (p.initializer.kind === ts.SyntaxKind.TrueKeyword) r.ecrasent.set(chemin, (r.ecrasent.get(chemin) ?? 0) + 1)
            else if (p.initializer.kind !== ts.SyntaxKind.FalseKeyword) r.fautes.push(`${ligne(n)} : upsert qui n'est ni true ni false`)
          }
        }
      }
      ts.forEachChild(n, visiter)
    }
    visiter(arbre)
  }
  return r
}

const SOURCES = () => [
  ...lister('src', (c) => /\.tsx?$/.test(c) && !/\.test\.tsx?$/.test(c) && !c.startsWith('src/test/')),
  ...lister('supabase/functions', (c) => /\.tsx?$/.test(c)),
].map((chemin) => ({ chemin, texte: lire(chemin) }))

describe('aucun appel du stockage ne réécrit, ne déplace ni n’écrase un objet', () => {
  it('ni update, ni move, ni copy ; un seul dépôt qui écrase, hors de la RLS, nommé et compté', () => {
    const r = appelsDuStockage(SOURCES())
    expect(r.fautes).toEqual([])
    expect(Object.fromEntries(r.ecrasent)).toEqual(Object.fromEntries(Object.entries(ECRASEMENTS_ADMIS).map(([c, e]) => [c, e.nombre])))
    for (const e of Object.values(ECRASEMENTS_ADMIS)) expect(e.raison.length).toBeGreaterThan(40)
  })

  it('le plancher : toute la source lue (655 fichiers le 13/11/2026), ses dépôts comptés (17)', () => {
    const r = appelsDuStockage(SOURCES())
    expect(r.fichiers).toBeGreaterThanOrEqual(655)
    expect(r.depots).toBeGreaterThanOrEqual(17)
  })

  it('un défaut planté se voit : un dépôt qui écrase, une mise à jour, un déplacement, une option illisible', () => {
    const plante = (texte: string) => appelsDuStockage([{ chemin: 'src/lib/plante.ts', texte }])
    expect(plante(`await supabase.storage.from('packs').upload(chemin, corps, { upsert: true })`).ecrasent).toEqual(new Map([['src/lib/plante.ts', 1]]))
    expect(plante(`await supabase.storage.from('packs').upload(chemin, corps, { 'upsert': true })`).ecrasent.size).toBe(1)
    expect(plante(`await supabase.storage.from('packs').upload(chemin, corps, { upsert: false })`)).toMatchObject({ depots: 1, fautes: [] })
    expect(plante(`await supabase.storage.from('packs').upload(chemin, corps)`)).toMatchObject({ depots: 1, fautes: [], ecrasent: new Map() })
    for (const appel of [`.update(chemin, corps)`, `.move(a, b)`, `.copy(a, b)`, `.upload(chemin, corps, options)`,
      `.upload(chemin, corps, { upsert })`, `.upload(chemin, corps, { upsert: !ecrire })`, `.upload(chemin, corps, { ...options })`]) {
      expect(plante(`await supabase.storage.from('cabinet-logos')${appel}`).fautes, appel).toHaveLength(1)
    }
  })
})
