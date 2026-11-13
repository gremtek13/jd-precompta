import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { contientSql, definitionsSql, derniereDefinitionSql, dernierIndiceSql, fichiersDuSchema, fichiersPrepares } from '../test/schema'

// LE FICHIER D'UNE PIÈCE FIGÉE DANS LE STOCKAGE (ligne 44, INAL1, sur INAL-Q5). La migration `piece_figee_dans_le_stockage`
// — préparée dans supabase/preparees/, dans l'export sous la version de sa ligne d'historique le jour de son application,
// texte inchangé — resserre `pieces_storage_delete` : son prédicat d'hier, plus « le fichier n'est pas figé »
// (`fichier_fige`). Ce garde la confronte au prédicat que l'export pose (`storage_pieces_packs_isolation_cabinet`) ; sa
// garde de tête aux corps des fonctions qu'elle appelle ou dont elle redit la règle, recalculés des textes qui les posent ;
// sa garde de fin, son retour et le bloc PF de rls.sql au même prédicat ; et son essai
// (supabase/essais/pieceFigeeDansLeStockage.sql) aux fragments que ses mutations altèrent. Le second passage de la
// suppression d'un dossier, qui la suit, est gardé par suppressionDossier.test.ts. Récit : HISTORIQUE.md, « 10/11/2026 —
// INAL1 ET INAL2 ».

const md5 = (texte: string) => createHash('md5').update(texte, 'utf8').digest('hex')
const RACINE = new URL('../../', import.meta.url).pathname
const NOM = 'piece_figee_dans_le_stockage'
const lire = (chemin: string) => readFileSync(`${RACINE}${chemin}`, 'utf8')

function laMigration(): { chemin: string; texte: string } {
  const motif = new RegExp(`/\\d{14}_${NOM}\\.sql$`)
  const trouvees = [...fichiersPrepares(), ...fichiersDuSchema()].filter((x) => motif.test(x.chemin))
  expect(trouvees.map((f) => f.chemin), `la migration ${NOM}, préparée OU dans l’export`).toHaveLength(1)
  return trouvees[0]
}
let lue: { chemin: string; texte: string } | undefined
const MIGRATION = () => (lue ??= laMigration())
const RETOUR = () => lire(`supabase/preparees/retour/20261110120050_retour_${NOM}.sql`)

const corps = (definition: string) => definition.slice(definition.indexOf('as $$') + 'as $$'.length)
// Les empreintes auxquelles un essai admet fichier_fige : `= '<md5>'` ou `in ('<md5>', …)`, en un seul endroit ; une autre
// forme, ou une seconde admission, échoue.
function empreintesAdmises(texte: string, essai: string): string[] {
  const motif = /proname = 'fichier_fige' and md5\(replace\(prosrc, chr\(13\), ''\)\) (?:= '([0-9a-f]{32})'|in \(('[0-9a-f]{32}'(?:, '[0-9a-f]{32}')*)\))/g
  const trouvees = [...texte.matchAll(motif)]
  expect(trouvees, `${essai} : une admission de fichier_fige, sous une forme reconnue`).toHaveLength(1)
  expect(texte.split(`proname = 'fichier_fige'`).length - 1, `${essai} : une seule mention`).toBe(1)
  const [, une, liste] = trouvees[0]
  return une ? [une] : [...liste.matchAll(/'([0-9a-f]{32})'/g)].map((m) => m[1])
}
const blocEntre = (texte: string, debut: string, fin: string) => texte.slice(texte.indexOf(debut), texte.indexOf(fin, texte.indexOf(debut)))
const espaces = (texte: string) => texte.replace(/\s+/g, ' ').trim()

// Le prédicat d'hier, tel que l'export le pose : la dernière `create policy pieces_storage_delete`, son `using (…)`.
function predicatDHier(): string {
  const avec = fichiersDuSchema().filter((f) => !f.chemin.includes(NOM) && contientSql(f.texte, 'create policy pieces_storage_delete'))
  const texte = avec[avec.length - 1].texte
  const debut = dernierIndiceSql(texte, 'create policy pieces_storage_delete')
  const using = texte.indexOf('using (', debut) + 'using ('.length
  return espaces(texte.slice(using, texte.indexOf(');', using)))
}

// La forme que pg_get_expr rend du prédicat posé, lue sous un chemin vide (relevée sur la réplique le 10/11/2026).
const PREDICAT_RENDU = "((bucket_id = ''pieces''::text) AND public.admin_du_dossier(((storage.foldername(name))[1])::uuid) AND (NOT public.fichier_fige(name)))"

describe('la migration du fichier d’une pièce figée', () => {
  it('pose le prédicat d’hier, plus « le fichier n’est pas figé », à authenticated', () => {
    const alter = blocEntre(MIGRATION().texte, 'alter policy pieces_storage_delete on storage.objects', ';\n')
    expect(espaces(alter)).toBe(espaces(`alter policy pieces_storage_delete on storage.objects to authenticated
      using (${predicatDHier()} and not public.fichier_fige(name))`))
  })

  it('sa garde de tête exige les corps d’hier des fonctions qu’elle appelle et des deux gardes dont elle redit la règle', () => {
    const garde = blocEntre(MIGRATION().texte, 'do $garde$', '$garde$;')
    const paires = [...garde.matchAll(/\('public\.(\w+)\([^']*\)', '([0-9a-f]{32})'\)/g)].map((m) => [m[1], m[2]])
    expect(paires.map(([f]) => f).sort()).toEqual(['admin_du_dossier', 'exercice_figeant_la_piece', 'garder_piece_validee', 'garder_source_citee', 'is_super_admin'])
    for (const [fonction, empreinte] of paires) {
      const avant = derniereDefinitionSql(fonction, (f) => !f.chemin.includes(NOM))
      expect(md5(corps(avant)), fonction).toBe(empreinte)
    }
  })

  it('la fonction redit la règle des deux gardes : l’écriture validée (par le bien compris), les preuves et le dossier permanent', () => {
    const fonction = corps(blocEntre(MIGRATION().texte, 'create function public.fichier_fige(', '$$;\n'))
    const valide = corps(derniereDefinitionSql('garder_piece_validee'))
    const citee = corps(derniereDefinitionSql('garder_source_citee'))
    // La pièce figée : `exercice_figeant_la_piece`, le calcul même de `garder_piece_validee`.
    expect(fonction).toContain('public.exercice_figeant_la_piece(p.id) is not null')
    expect(valide).toContain("e.statut = 'validee'")
    expect(valide).toContain('e.immobilisation_id in (select i.id from public.immobilisations i where i.piece_id = old.id)')
    // La source citée : les deux tables que `garder_source_citee` lit, pour une pièce et pour un document.
    for (const table of ['revision_preuves', 'dossier_permanent']) {
      expect(citee).toContain(`from public.${table}`)
      expect(fonction).toContain(`from public.${table}`)
    }
    expect(fonction).toContain('(p.storage_path = p_chemin or p.lisible_path = p_chemin)')
    expect(fonction).toContain('where dd.storage_path = p_chemin')
    // Elle ne répond qu'à qui administre le dossier du chemin, après en avoir lu la forme.
    expect(fonction.indexOf('then null\n    when not public.admin_du_dossier(')).toBeGreaterThan(fonction.indexOf("p_chemin !~* '^[0-9a-f]{8}-"))
  })

  it('la garde de fin, le retour et le bloc PF de rls.sql lisent le même prédicat posé', () => {
    const fin = blocEntre(MIGRATION().texte, 'do $fin$', '$fin$;')
    expect(fin).toContain(`= '${PREDICAT_RENDU}'`)
    expect(RETOUR()).toContain(`= '${PREDICAT_RENDU}'`)
    expect(lire('supabase/essais/rls.sql')).toContain(`attendu_predicat constant text := '${PREDICAT_RENDU}'`)
  })

  it('son retour rend le prédicat et le rôle d’hier, et retire ce qu’elle a posé', () => {
    const alter = blocEntre(RETOUR(), 'alter policy pieces_storage_delete on storage.objects', ';\n')
    expect(espaces(alter)).toBe(espaces(`alter policy pieces_storage_delete on storage.objects to public using (${predicatDHier()})`))
    const corpsPose = corps(blocEntre(MIGRATION().texte, 'create function public.fichier_fige(', '$$;\n'))
    expect(RETOUR()).toContain(`is distinct from '${md5(corpsPose)}'`)
    for (const objet of ['drop function public.fichier_fige(text);', 'drop index public.pieces_storage_path_idx;',
      'drop index public.pieces_lisible_path_idx;', 'drop index public.documents_divers_storage_path_idx;']) {
      expect(RETOUR()).toContain(objet)
    }
  })

  // Les essais admettent le corps en production (la dernière définition de l'export, celle d'INAL1 tant qu'aucune autre
  // ne la remplace) ET celui de chaque migration préparée qui le remplace — INV3, `validation_de_l_inventaire` (ligne 35,
  // INV3-Q1) : ils doivent passer aujourd'hui comme après son collage. Aucune autre empreinte : un corps que le dépôt ne
  // pose nulle part tombe ici.
  it('les essais qui énumèrent le catalogue n’admettent fichier_fige qu’aux empreintes des corps que le dépôt pose', () => {
    const corpsPose = corps(blocEntre(MIGRATION().texte, 'create function public.fichier_fige(', '$$;\n'))
    const enProduction = md5(corps(derniereDefinitionSql('fichier_fige')))
    const preparees = definitionsSql('fichier_fige', fichiersPrepares()).map((d) => md5(corps(d.definition)))
    const posees = new Set(definitionsSql('fichier_fige', [...fichiersDuSchema(), ...fichiersPrepares()]).map((d) => md5(corps(d.definition))))
    expect(posees.has(md5(corpsPose)), 'le corps d’INAL1, parmi les corps posés').toBe(true)
    for (const essai of ['dossierPermanent', 'exemplairesDesFactures']) {
      const admises = empreintesAdmises(lire(`supabase/essais/${essai}.sql`), essai)
      for (const attendue of [enProduction, ...preparees]) expect(admises, `${essai} admet ${attendue}`).toContain(attendue)
      for (const admise of admises) expect(posees.has(admise), `${essai} : ${admise}, le corps d’aucune définition`).toBe(true)
    }
  })

  it('les mutations de l’essai altèrent des fragments que la fonction porte', () => {
    const fonction = corps(blocEntre(MIGRATION().texte, 'create function public.fichier_fige(', '$$;\n'))
    const essai = lire('supabase/essais/pieceFigeeDansLeStockage.sql')
    const fragments = [...essai.matchAll(/pg_temp\.muter\('((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'"))
    expect(fragments.length).toBe(8)
    for (const fragment of fragments) expect(fonction, fragment).toContain(fragment)
  })

  it('la voie : le mot « delete » y paraît (le nom de la policy), aucun retrait ; elle se colle', () => {
    const texte = MIGRATION().texte
    expect(texte).toMatch(/\bpieces_storage_delete\b/)
    expect(texte).not.toMatch(/\b(drop|truncate)\b/i)
    expect(texte).not.toMatch(/\bdelete\s+from\b/i)
    expect(texte).not.toMatch(/[\r\\]/)
  })
})
