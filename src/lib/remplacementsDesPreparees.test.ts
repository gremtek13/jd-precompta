import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { sansCommentaires } from '../test/blocsSql'
import { definitionsSql, fichiersDuSchema, fichiersPrepares } from '../test/schema'

// UNE MIGRATION PRÉPARÉE QUI REMPLACE UNE FONCTION PART DU CORPS EN PRODUCTION LE JOUR DE SON COLLAGE (CLAUDE.md, « Cinq
// chantiers préparés remplacent valider_exercice : chacun part du corps EN PRODUCTION le jour de son collage » ; REPET-Q2 (A),
// réponse du cabinet du 15/11/2026). Sa garde de tête — son bloc `do $garde$` — nomme l'empreinte md5 du corps de chaque
// fonction qu'elle remplace (`create or replace`), tel que la base le porte aujourd'hui : la dernière définition de l'export,
// les retours chariot d'un collage écartés. Un autre remplaçant collé avant elle change ce corps : elle se refuse au lieu de
// l'écraser, et se reprend sur le corps du jour. La garde de la migration de l'inventaire (`validation_de_l_inventaire`, INV3)
// le faisait déjà pour `valider_exercice` (923cfa1b…, son corps de production), ce que la répétition du 14/11/2026 avait cru
// absent ; une mutation d'un caractère de ce corps la fait refuser sur une copie de la réplique.
//
// Le scanner part de TOUTES les préparées (supabase/preparees) ; une exception porte sa raison et se compte ; un plancher
// distingue « zéro faute » d'« aveugle » ; des défauts plantés prouvent qu'il voit (une garde sans l'empreinte, l'empreinte
// en commentaire seulement, l'empreinte d'un corps d'hier).

const md5 = (texte: string) => createHash('md5').update(texte, 'utf8').digest('hex')
type Fichier = { chemin: string; texte: string }

/** Le corps tel que la base le garde (`prosrc`) : ce qui suit le délimiteur ouvrant, les retours chariot écartés. */
function corps(definition: string): string {
  const ouverture = /\$(\w*)\$/.exec(definition)!
  return definition.slice(ouverture.index + ouverture[0].length).replace(/\r\n/g, '\n')
}

/** Le bloc `do $garde$ … $garde$` d'une migration, sans ses commentaires ; vide sans garde. */
function garde(texte: string): string {
  return /\bdo\s+\$garde\$([\s\S]*?)\$garde\$/.exec(sansCommentaires(texte))?.[1] ?? ''
}

interface Remplacement {
  migration: string
  fonction: string
  /** L'empreinte du corps en production : la dernière définition de l'export ; nulle pour une fonction que l'export n'a pas. */
  production: string | null
  /** Vrai quand la garde de tête nomme cette empreinte. */
  verifiee: boolean
}

function remplacements(preparees: Fichier[], schema: Fichier[]): Remplacement[] {
  return preparees.flatMap((p) => {
    const noms = [...new Set([...sansCommentaires(p.texte).matchAll(/create\s+or\s+replace\s+function\s+public\.(\w+)\s*\(/gi)].map((m) => m[1].toLowerCase()))]
    const g = garde(p.texte)
    return noms.map((fonction) => {
      const definitions = definitionsSql(fonction, schema)
      const production = definitions.length === 0 ? null : md5(corps(definitions[definitions.length - 1].definition))
      const migration = p.chemin.replace(/^.*\/\d{14}_/, '').replace(/\.sql$/, '')
      // L'empreinte comme un mot entier du texte de la garde : seule (`'<md5>'`) ou dans une liste (`'f=<md5>,'`).
      return { migration, fonction, production, verifiee: production !== null && new RegExp(`\\b${production}\\b`).test(g) }
    })
  })
}

// Les remplacements dont la garde ne nomme pas le corps en production, chacun avec sa raison : il refuse au collage, et se
// reprend sur le corps du jour (rien ne s'écrase en silence).
const EXCEPTIONS: Record<string, string> = {
  'facture_internationale:enregistrer_facture': 'e7a part du corps d’enregistrer_facture d’acomptes_des_devis (6dc9348c…), repris depuis '
    + 'par A8a puis LM1 : sa garde nomme ce corps d’hier et la migration refuse au collage — à rebaser sur celui du jour (REPET-Q1)',
}

describe('une migration préparée qui remplace une fonction en vérifie le corps en production (REPET-Q2)', () => {
  const liste = remplacements(fichiersPrepares(), fichiersDuSchema())

  it('chaque remplacement : la garde de tête nomme l’empreinte du corps que l’export porte, sauf les exceptions nommées', () => {
    const fautes = liste.filter((r) => !r.verifiee).map((r) => `${r.migration}:${r.fonction}`)
    expect(fautes.sort()).toEqual(Object.keys(EXCEPTIONS).sort())
    for (const raison of Object.values(EXCEPTIONS)) expect(raison.length).toBeGreaterThan(60)
  })

  it('le plancher : il lit les remplacements des préparées, dont les trois d’INV3, valider_exercice au corps de production', () => {
    expect(liste.length).toBeGreaterThanOrEqual(8)
    const inv3 = liste.filter((r) => r.migration === 'validation_de_l_inventaire').map((r) => `${r.fonction}:${r.verifiee}`).sort()
    expect(inv3).toEqual(['empreinte_exercice_forme_2:true', 'fichier_fige:true', 'valider_exercice:true'])
    expect(liste.find((r) => r.migration === 'validation_de_l_inventaire' && r.fonction === 'valider_exercice')?.production)
      .toBe('923cfa1b57037146070ca1430f163495')
    // Aucune préparée ne remplace une fonction que l'export n'a pas : un `create or replace` d'une fonction neuve se lirait ici.
    expect(liste.filter((r) => r.production === null)).toEqual([])
  })

  it('le scanner voit un défaut planté : sans l’empreinte, en commentaire seulement, ou celle d’un corps d’hier', () => {
    const schema: Fichier[] = [
      { chemin: 'supabase/schema/20260101000000_f.sql', texte: 'create function public.f() returns int language sql as $$ select 1 $$;' },
      { chemin: 'supabase/schema/20260102000000_f2.sql', texte: 'create or replace function public.f() returns int language sql as $$ select 2 $$;' },
    ]
    const aujourdhui = md5(' select 2 ')
    const hier = md5(' select 1 ')
    const preparee = (g: string): Fichier => ({
      chemin: 'supabase/preparees/20260103000000_plantee.sql',
      texte: `do $garde$\nbegin\n${g}\nend\n$garde$;\ncreate or replace function public.f() returns int language sql as $$ select 3 $$;`,
    })
    const verdict = (g: string) => remplacements([preparee(g)], schema)[0].verifiee
    expect(verdict(`  if md5(x) is distinct from '${aujourdhui}' then raise exception 'non'; end if;`)).toBe(true)
    expect(verdict('  perform 1;')).toBe(false)
    expect(verdict(`  -- '${aujourdhui}'\n  perform 1;`)).toBe(false)
    expect(verdict(`  if md5(x) is distinct from '${hier}' then raise exception 'non'; end if;`)).toBe(false)
    // L'empreinte hors de la garde de tête (dans la garde de fin) ne compte pas.
    const ailleurs: Fichier = { ...preparee('  perform 1;'), texte: `${preparee('  perform 1;').texte}\ndo $fin$ begin perform '${aujourdhui}'; end $fin$;` }
    expect(remplacements([ailleurs], schema)[0].verifiee).toBe(false)
  })
})
