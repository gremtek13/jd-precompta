import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { definitionsSql, derniereDefinitionSql, fichiersPrepares } from '../test/schema'

// LE FICHIER D'UNE PIÈCE QU'UNE ÉCRITURE LIBRE CITE NE SE RETIRE PLUS DU STOCKAGE (relecture adverse du 25/11/2026 des migrations
// 251 à 253 ; la migration PRÉPARÉE `fichier_cite_par_une_ecriture_libre`, son retour et son essai). Ce test confronte son texte
// au corps de production de `fichier_fige` (INAL1, la dernière définition de l'export) : le même au caractère près, plus UNE
// condition — la pièce qu'une écriture libre cite ; sa garde de tête nomme ce corps (REPET-Q2) et le sien, sa garde de fin le
// sien ; son retour rend le corps et le commentaire d'hier ; l'essai mute des fragments que le corps porte. Rien ici ne touche la
// base : la preuve en base est l'essai, sur une réplique (supabase/essais/fichierCiteParUneEcritureLibre.sql).

const md5 = (texte: string) => createHash('md5').update(texte, 'utf8').digest('hex')
const RACINE = new URL('../../', import.meta.url).pathname
const lire = (chemin: string) => readFileSync(`${RACINE}${chemin}`, 'utf8')
const NOM = 'fichier_cite_par_une_ecriture_libre'

function laPreparee(): { chemin: string; texte: string } {
  const trouvees = fichiersPrepares().filter((f) => f.chemin.endsWith(`_${NOM}.sql`))
  expect(trouvees.map((f) => f.chemin), `la migration ${NOM}, préparée`).toHaveLength(1)
  return trouvees[0]
}
const RETOUR = () => lire(`supabase/preparees/retour/20261125200100_retour_${NOM}.sql`)
const ESSAI = () => lire('supabase/essais/fichierCiteParUneEcritureLibre.sql')

/** Le corps tel que la base le garde (`prosrc`) : ce qui suit le délimiteur ouvrant. */
function corps(definition: string): string {
  const ouverture = /\$(\w*)\$/.exec(definition)!
  return definition.slice(ouverture.index + ouverture[0].length)
}
const corpsDans = (fichier: { chemin: string; texte: string }) => {
  const definitions = definitionsSql('fichier_fige', [fichier])
  expect(definitions, `${fichier.chemin} : une définition de fichier_fige`).toHaveLength(1)
  return corps(definitions[0].definition)
}
const blocEntre = (texte: string, debut: string, fin: string) => texte.slice(texte.indexOf(debut), texte.indexOf(fin, texte.indexOf(debut)))
/** Le texte d'un commentaire de fonction, ses apostrophes doublées gardées. */
const commentaire = (texte: string) => /comment on function public\.fichier_fige\(text\) is\n {2}'((?:[^']|'')*)';/i.exec(texte)?.[1] ?? null

const CLAUSE = '\n                or exists (select 1 from public.ecritures_libres e where e.piece_citee_id = p.id)'
const PRODUCTION = '5372f8d248432f0932598a6efca24ca2'

describe('la migration préparée fichier_cite_par_une_ecriture_libre', () => {
  it('le corps de production de fichier_fige au caractère près, plus la seule condition des écritures libres', () => {
    const production = corps(derniereDefinitionSql('fichier_fige'))
    expect(md5(production), 'le corps de production, celui d’INAL1').toBe(PRODUCTION)
    const pose = corpsDans(laPreparee())
    // Retirer la clause rend exactement le corps d'hier : rien d'autre n'a bougé.
    expect(pose.split(CLAUSE)).toHaveLength(2)
    expect(pose.replace(CLAUSE, '')).toBe(production)
    // Elle se range parmi les pièces, après le dossier permanent, et ne touche pas aux documents divers.
    expect(pose.indexOf(CLAUSE)).toBeGreaterThan(pose.indexOf('from public.dossier_permanent d where d.piece_id = p.id'))
    expect(pose.indexOf(CLAUSE)).toBeLessThan(pose.indexOf('from public.documents_divers dd'))
  })

  it('sa garde de tête nomme le corps qu’elle remplace et le sien ; sa garde de fin, le sien', () => {
    const texte = laPreparee().texte
    const pose = md5(corpsDans(laPreparee()))
    const garde = blocEntre(texte, 'do $garde$', '$garde$;')
    expect(garde).toContain(`'${PRODUCTION}'`)
    expect(garde).toContain(`'${pose}'`)
    const fin = blocEntre(texte, 'do $fin$', '$fin$;')
    expect(fin).toContain(`'${pose}'`)
    // La forme et les droits gardés par `create or replace` se revérifient : definer, stable, son chemin ; ni anon ni PUBLIC.
    for (const fragment of ["p.prosecdef and p.provolatile = 's'", "has_function_privilege('anon'", "has_function_privilege('authenticated'",
      'a.grantee = 0']) {
      expect(fin).toContain(fragment)
    }
  })

  it('par l’outil : aucun mot qui retire, ni barre oblique inverse ni retour chariot', () => {
    const texte = laPreparee().texte
    expect(texte).not.toMatch(/\bdelete\b|\bdrop\b|\btruncate\b/i)
    expect(texte).not.toContain('\\')
    expect(texte).not.toContain('\r')
  })

  it('son commentaire dit les écritures libres, sans le nom de la policy (que l’outil retiendrait)', () => {
    const c = commentaire(laPreparee().texte)
    expect(c).not.toBeNull()
    expect(c).toContain('ou une écriture libre la cite')
    expect(c).toContain('La policy de suppression du seau des pièces refuse')
  })
})

describe('son retour', () => {
  it('rend le corps de production et son commentaire d’hier, sous la garde du corps posé', () => {
    const retour = { chemin: 'retour', texte: RETOUR() }
    expect(md5(corpsDans(retour))).toBe(PRODUCTION)
    expect(corpsDans(retour)).toBe(corps(derniereDefinitionSql('fichier_fige')))
    const enProduction = definitionsSql('fichier_fige', [{ chemin: 'inal1', texte: lire('supabase/schema/20261110125435_piece_figee_dans_le_stockage.sql') }])
    expect(enProduction).toHaveLength(1)
    expect(commentaire(RETOUR())).toBe(commentaire(lire('supabase/schema/20261110125435_piece_figee_dans_le_stockage.sql')))
    const pose = md5(corpsDans(laPreparee()))
    expect(blocEntre(RETOUR(), 'do $garde$', '$garde$;')).toContain(`'${pose}'`)
    expect(blocEntre(RETOUR(), 'do $fin$', '$fin$;')).toContain(`'${PRODUCTION}'`)
  })
})

describe('son essai', () => {
  it('se joue sur une réplique seulement, dit EN ATTENTE sans la migration, et mute des fragments que le corps porte une fois', () => {
    const essai = ESSAI()
    const premierParagraphe = essai.slice(0, essai.indexOf('\n--\n'))
    expect(premierParagraphe.replace(/\n-- /g, ' ')).toMatch(/SUR UNE RÉPLIQUE SEULEMENT/)
    expect(essai).toContain('0. EN ATTENTE de la migration fichier_cite_par_une_ecriture_libre')
    const pose = corpsDans(laPreparee())
    // M-FC1 retire la clause (sa forme dans l'essai : chr(10) puis la ligne) ; M-FC2 la rend toujours fausse.
    expect(essai).toContain("clause constant text := chr(10) || '                or exists (select 1 from public.ecritures_libres e where e.piece_citee_id = p.id)))'")
    expect(pose.split(`${CLAUSE}))`)).toHaveLength(2)
    expect(pose.split('e.piece_citee_id = p.id)))')).toHaveLength(2)
  })

  it('les essais qui admettent fichier_fige à son empreinte admettent aussi celle du corps posé', () => {
    const pose = md5(corpsDans(laPreparee()))
    for (const essai of ['dossierPermanent', 'exemplairesDesFactures']) {
      expect(lire(`supabase/essais/${essai}.sql`), essai).toContain(`'${pose}'`)
    }
  })
})
