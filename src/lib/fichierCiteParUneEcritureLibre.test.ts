import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { definitionsSql, derniereDefinitionSql, fichiersDuSchema, fichiersPrepares, migrationRangee } from '../test/schema'

// LE FICHIER D'UNE PIÈCE QU'UNE ÉCRITURE LIBRE CITE NE SE RETIRE PLUS DU STOCKAGE (relecture adverse du 25/11/2026 des migrations
// 251 à 253 ; la migration `fichier_cite_par_une_ecriture_libre`, appliquée par l'outil le 26/11/2026, 254, version d'historique
// 20261126065131 ; son retour et son essai). Ce test confronte son texte, rangé dans l'export, au corps de `fichier_fige` qu'elle
// a remplacé (INAL1, la définition de l'export d'avant elle) : le même au caractère près, plus UNE condition — la pièce qu'une
// écriture libre cite ; elle est désormais la définition de production (la dernière de l'export) ; sa garde de tête nomme le
// corps d'avant (REPET-Q2) et le sien, sa garde de fin le sien ; son retour rend le corps et le commentaire d'avant ; l'essai mute
// des fragments que portent son corps et celui d'INV3, qui le reprend. Rien ici ne touche la base : la preuve en base est l'essai,
// sur une réplique (supabase/essais/fichierCiteParUneEcritureLibre.sql).

const md5 = (texte: string) => createHash('md5').update(texte, 'utf8').digest('hex')
const RACINE = new URL('../../', import.meta.url).pathname
const lire = (chemin: string) => readFileSync(`${RACINE}${chemin}`, 'utf8')
const NOM = 'fichier_cite_par_une_ecriture_libre'

function laMigration(): { chemin: string; texte: string } {
  const motif = new RegExp(`/\\d{14}_${NOM}\\.sql$`)
  const trouvees = [...fichiersPrepares(), ...fichiersDuSchema()].filter((f) => motif.test(f.chemin))
  expect(trouvees.map((f) => f.chemin), `la migration ${NOM}, préparée OU dans l’export`).toHaveLength(1)
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
/** Le corps d'avant elle : celui d'INAL1, la dernière définition de l'export hors d'elle. */
const AVANT = '5372f8d248432f0932598a6efca24ca2'
/** Le sien, celui de la production depuis le 26/11/2026. */
const POSE = '5e7016c08bcdda1190d6e56202661113'
const corpsDAvant = () => corps(derniereDefinitionSql('fichier_fige', (f) => !f.chemin.includes(NOM)))

describe('la migration fichier_cite_par_une_ecriture_libre, en production (254)', () => {
  it('rangée dans l’export sous la version de sa ligne d’historique, son texte celui de l’historique', () => {
    expect(migrationRangee(NOM)).toBe(true)
    const m = laMigration()
    expect(m.chemin).toBe(`supabase/schema/20261126065131_${NOM}.sql`)
    // L'empreinte de la ligne d'historique (10 251 caractères, sans le saut de ligne final) : le texte n'a pas bougé.
    expect(m.texte.endsWith('\n') && !m.texte.endsWith('\n\n')).toBe(true)
    expect(md5(m.texte.slice(0, -1))).toBe('66c3fcea6815eaa1c5cda9549c50771e')
    expect(m.texte.slice(0, -1)).toHaveLength(10251)
  })

  it('le corps d’avant au caractère près, plus la seule condition des écritures libres ; il est le corps de production', () => {
    const avant = corpsDAvant()
    expect(md5(avant), 'le corps d’avant, celui d’INAL1').toBe(AVANT)
    const pose = corpsDans(laMigration())
    expect(md5(pose)).toBe(POSE)
    // Retirer la clause rend exactement le corps d'avant : rien d'autre n'a bougé.
    expect(pose.split(CLAUSE)).toHaveLength(2)
    expect(pose.replace(CLAUSE, '')).toBe(avant)
    // Elle se range parmi les pièces, après le dossier permanent, et ne touche pas aux documents divers.
    expect(pose.indexOf(CLAUSE)).toBeGreaterThan(pose.indexOf('from public.dossier_permanent d where d.piece_id = p.id'))
    expect(pose.indexOf(CLAUSE)).toBeLessThan(pose.indexOf('from public.documents_divers dd'))
    // La dernière définition de l'export : la production d'aujourd'hui.
    expect(md5(corps(derniereDefinitionSql('fichier_fige')))).toBe(POSE)
  })

  it('sa garde de tête nomme le corps qu’elle remplace et le sien ; sa garde de fin, le sien', () => {
    const texte = laMigration().texte
    const garde = blocEntre(texte, 'do $garde$', '$garde$;')
    expect(garde).toContain(`'${AVANT}'`)
    expect(garde).toContain(`'${POSE}'`)
    const fin = blocEntre(texte, 'do $fin$', '$fin$;')
    expect(fin).toContain(`'${POSE}'`)
    // La forme et les droits gardés par `create or replace` se revérifient : definer, stable, son chemin ; ni anon ni PUBLIC.
    for (const fragment of ["p.prosecdef and p.provolatile = 's'", "has_function_privilege('anon'", "has_function_privilege('authenticated'",
      'a.grantee = 0']) {
      expect(fin).toContain(fragment)
    }
  })

  it('par l’outil : aucun mot qui retire, ni barre oblique inverse ni retour chariot', () => {
    const texte = laMigration().texte
    expect(texte).not.toMatch(/\bdelete\b|\bdrop\b|\btruncate\b/i)
    expect(texte).not.toContain('\\')
    expect(texte).not.toContain('\r')
  })

  it('son commentaire dit les écritures libres, sans le nom de la policy (que l’outil retiendrait)', () => {
    const c = commentaire(laMigration().texte)
    expect(c).not.toBeNull()
    expect(c).toContain('ou une écriture libre la cite')
    expect(c).toContain('La policy de suppression du seau des pièces refuse')
  })
})

describe('son retour', () => {
  it('rend le corps d’avant et son commentaire, sous la garde du corps posé', () => {
    const retour = { chemin: 'retour', texte: RETOUR() }
    expect(md5(corpsDans(retour))).toBe(AVANT)
    expect(corpsDans(retour)).toBe(corpsDAvant())
    const inal1 = lire('supabase/schema/20261110125435_piece_figee_dans_le_stockage.sql')
    expect(definitionsSql('fichier_fige', [{ chemin: 'inal1', texte: inal1 }])).toHaveLength(1)
    expect(commentaire(RETOUR())).toBe(commentaire(inal1))
    expect(blocEntre(RETOUR(), 'do $garde$', '$garde$;')).toContain(`'${POSE}'`)
    expect(blocEntre(RETOUR(), 'do $fin$', '$fin$;')).toContain(`'${AVANT}'`)
    // Son en-tête nomme la migration à son chemin dans l'export.
    expect(RETOUR()).toContain(`supabase/schema/20261126065131_${NOM}.sql`)
  })
})

describe('son essai', () => {
  it('se joue sur une réplique seulement, garde sa ligne EN ATTENTE, et mute des fragments que porte une fois chaque corps posé', () => {
    const essai = ESSAI()
    const premierParagraphe = essai.slice(0, essai.indexOf('\n--\n'))
    expect(premierParagraphe.replace(/\n-- /g, ' ')).toMatch(/SUR UNE RÉPLIQUE SEULEMENT/)
    expect(essai).toContain('0. EN ATTENTE de la migration fichier_cite_par_une_ecriture_libre')
    // M-FC1 retire la clause (sa forme dans l'essai : chr(10) puis la ligne, sans ce qui la suit) ; M-FC2 la rend toujours fausse.
    expect(essai).toContain("clause constant text := chr(10) || '                or exists (select 1 from public.ecritures_libres e where e.piece_citee_id = p.id)';")
    expect(essai).toContain("perform pg_temp.muter(fn, clause, '');")
    expect(essai).toContain("perform pg_temp.muter(fn, 'e.piece_citee_id = p.id)', 'e.piece_citee_id = p.id and false)');")
    // Les corps où l'essai se joue : le sien (la production) et celui de chaque préparée qui le reprend (INV3) — chacun porte
    // chaque fragment une fois, et la clause retirée du sien rend le corps d'avant.
    const preparees = definitionsSql('fichier_fige', fichiersPrepares()).map((d) => corps(d.definition))
    expect(preparees.length, 'INV3 reprend fichier_fige').toBeGreaterThanOrEqual(1)
    for (const c of [corpsDans(laMigration()), ...preparees]) {
      expect(c.split(CLAUSE), md5(c)).toHaveLength(2)
      expect(c.split('e.piece_citee_id = p.id)'), md5(c)).toHaveLength(2)
    }
    expect(corpsDans(laMigration()).replace(CLAUSE, '')).toBe(corpsDAvant())
  })

  it('les essais qui admettent fichier_fige à son empreinte admettent celle du corps posé', () => {
    for (const essai of ['dossierPermanent', 'exemplairesDesFactures']) {
      expect(lire(`supabase/essais/${essai}.sql`), essai).toContain(`'${POSE}'`)
    }
  })
})
