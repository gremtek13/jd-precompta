import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { derniereDefinitionSql, fichiersDuSchema, fichiersPrepares } from '../test/schema'

// L'EMPREINTE D'UN EXERCICE VALIDÉ EN FORME 2 (ligne 44, INAL2, sur INAL-Q1). La migration `empreinte_des_exercices_forme_2`
// — préparée dans supabase/preparees/, dans l'export sous la version de sa ligne d'historique le jour de son application,
// texte inchangé — reprend `valider_exercice` telle que `validation_des_paiements_par_la_caisse` la laisse et
// `verifier_exercice_valide` telle que `validation_des_exercices` la pose. Ce garde la confronte à l'export au caractère
// près, hors des deux fragments qu'elle change ; sa garde de tête aux corps qu'elle exige, recalculés des textes qui les
// posent ; sa garde de fin aux corps qu'elle pose ; son retour aux définitions d'hier ; et son essai
// (supabase/essais/empreinteDesExercices.sql), qui recalcule la forme 2 par une formule écrite à part, à la même
// étiquette. Récit : HISTORIQUE.md, « 10/11/2026 — INAL1 ET INAL2 ».

const md5 = (texte: string) => createHash('md5').update(texte, 'utf8').digest('hex')
const RACINE = new URL('../../', import.meta.url).pathname
const NOM = 'empreinte_des_exercices_forme_2'

// Une migration, où qu'elle soit : préparée aujourd'hui, dans l'export le jour de son application — jamais aux deux.
function laMigration(): { chemin: string; texte: string } {
  const motif = new RegExp(`/\\d{14}_${NOM}\\.sql$`)
  const trouvees = [...fichiersPrepares(), ...fichiersDuSchema()].filter((x) => motif.test(x.chemin))
  expect(trouvees.map((f) => f.chemin), `la migration ${NOM}, préparée OU dans l’export`).toHaveLength(1)
  return trouvees[0]
}
let lue: { chemin: string; texte: string } | undefined
const MIGRATION = () => (lue ??= laMigration())
const RETOUR = () => readFileSync(`${RACINE}supabase/preparees/retour/20261110120150_retour_${NOM}.sql`, 'utf8')

// La définition d'AVANT la migration, dans l'export : la dernière, hors du fichier de la migration elle-même.
const avant = (fonction: string) => derniereDefinitionSql(fonction, (f) => !f.chemin.includes(NOM))

// La définition qu'un texte donne à une fonction (la seule qu'il en donne), de `create` au `$$;` exclu.
function definitionDans(texte: string, fonction: string): string {
  const motif = new RegExp(`create (or replace )?function public\\.${fonction}\\(`, 'g')
  const positions = [...texte.matchAll(motif)].map((m) => m.index)
  expect(positions, fonction).toHaveLength(1)
  return texte.slice(positions[0], texte.indexOf('$$;', positions[0]))
}

// Le corps, tel que la base le garde (`prosrc`) : ce qui suit l'ouverture `as $$`.
const corps = (definition: string) => definition.slice(definition.indexOf('as $$') + 'as $$'.length)

function uneFois(texte: string, de: string, vers: string): string {
  expect(texte.split(de).length - 1, de.slice(0, 80)).toBe(1)
  return texte.replace(de, () => vers)
}

// Les paires (fonction, empreinte) d'une garde : `('public.f(args)', '<md5>')`.
function empreintesDe(bloc: string): Map<string, string> {
  return new Map([...bloc.matchAll(/\('public\.(\w+)\([^']*\)', '([0-9a-f]{32})'/g)].map((m) => [m[1], m[2]]))
}
const blocEntre = (texte: string, debut: string, fin: string) => texte.slice(texte.indexOf(debut), texte.indexOf(fin, texte.indexOf(debut)))

describe('la migration de la forme 2 de l’empreinte', () => {
  it('reprend valider_exercice d’hier au caractère près, hors de l’auteur, de l’appel de la forme 2 et de la colonne qu’elle écrit', () => {
    let attendue = avant('valider_exercice')
    attendue = uneFois(attendue, '  v_paiement record;\nbegin\n', '  v_paiement record;\n  v_auteur uuid;\nbegin\n')
    attendue = uneFois(attendue,
      '  v_empreinte := public.empreinte_exercice(p_dossier_id, p_annee, v_precedente);\n',
      "  -- L'empreinte en forme 2 (INAL2, ligne 44) : celle d'hier — les écritures validées, les à-nouveaux et les soldes\n"
      + "  -- reportés, chaînés à l'exercice précédent — enveloppée de l'en-tête que la ligne de l'exercice garde, des fichiers des\n"
      + "  -- pièces que ses écritures citent et de la 2035 validée, chacun tel que la ligne l'enregistre.\n"
      + '  v_auteur := auth.uid();\n'
      + '  v_empreinte := public.empreinte_exercice_forme_2(p_dossier_id, p_annee, v_precedente, v_maintenant, v_auteur, v_mode,\n'
      + "    v_lignes, v_ecritures, v_debit, v_credit, case when v_mode = 'tresorerie' then p_declaration end);\n")
    attendue = uneFois(attendue, '    total_debit, total_credit, empreinte_precedente, empreinte, declaration)\n',
      '    total_debit, total_credit, empreinte_precedente, empreinte, declaration, forme_empreinte)\n')
    attendue = uneFois(attendue, '  values (p_dossier_id, p_annee, v_maintenant, auth.uid(), v_mode,',
      '  values (p_dossier_id, p_annee, v_maintenant, v_auteur, v_mode,')
    attendue = uneFois(attendue, "    v_precedente, v_empreinte, case when v_mode = 'tresorerie' then p_declaration end);\n",
      "    v_precedente, v_empreinte, case when v_mode = 'tresorerie' then p_declaration end, 2);\n")
    expect(definitionDans(MIGRATION().texte, 'valider_exercice')).toBe(attendue)
  })

  it('l’auteur qu’elle compte est celui qu’elle enregistre, et l’empreinte qu’elle rend celle qu’elle enregistre', () => {
    const posee = corps(definitionDans(MIGRATION().texte, 'valider_exercice'))
    expect(posee.match(/auth\.uid\(\)/g)).toHaveLength(1)
    expect(posee).toContain('v_maintenant, v_auteur, v_mode,\n    v_lignes, v_ecritures, v_debit, v_credit')
    expect(posee).toContain("'empreinte', v_empreinte")
  })

  it('sa garde de tête exige les corps d’hier, tels que l’export les pose', () => {
    const tete = empreintesDe(blocEntre(MIGRATION().texte, 'do $garde$', '$garde$;'))
    expect([...tete.keys()].sort()).toEqual(['empreinte_exercice', 'exercice_figeant_la_piece', 'garder_piece_validee', 'valider_exercice', 'verifier_exercice_valide'])
    for (const [fonction, empreinte] of tete) expect(md5(corps(avant(fonction))), fonction).toBe(empreinte)
  })

  it('sa garde de fin dit les corps qu’elle pose, et la forme 1 inchangée', () => {
    const texte = MIGRATION().texte
    const fin = blocEntre(texte, 'do $fin$', '$fin$;')
    const attendues: [string, string][] = [
      ['valider_exercice', md5(corps(definitionDans(texte, 'valider_exercice')))],
      ['verifier_exercice_valide', md5(corps(definitionDans(texte, 'verifier_exercice_valide')))],
      ['empreinte_exercice_forme_2', md5(corps(definitionDans(texte, 'empreinte_exercice_forme_2')))],
      ['empreinte_exercice', md5(corps(avant('empreinte_exercice')))],
    ]
    expect([...empreintesDe(fin).entries()].sort()).toEqual(attendues.sort())
    expect(texte).not.toMatch(/function public\.empreinte_exercice\(/)
  })

  it('la vérification lit chaque ligne dans sa forme, la forme 1 par la fonction d’hier, et une forme inconnue est fausse', () => {
    const verifier = corps(definitionDans(MIGRATION().texte, 'verifier_exercice_valide'))
    expect(verifier).toContain('case v.forme_empreinte')
    expect(verifier).toContain('when 1 then v.empreinte = public.empreinte_exercice(v.dossier_id, v.annee, v.empreinte_precedente)')
    expect(verifier).toContain('when 2 then v.empreinte = public.empreinte_exercice_forme_2(')
    expect(verifier).toContain('else false')
    // Le maillon, comme hier.
    expect(verifier).toContain(corps(avant('verifier_exercice_valide')).slice(corps(avant('verifier_exercice_valide')).indexOf('    and v.empreinte_precedente is not distinct from')))
  })

  it('la colonne est de forme 1 par défaut : une ligne d’avant, ou restaurée d’une sauvegarde d’avant, l’est', () => {
    expect(MIGRATION().texte).toContain('alter table public.exercices_valides add column forme_empreinte smallint not null default 1;')
    expect(MIGRATION().texte).toContain('check (forme_empreinte in (1, 2))')
  })

  it('son retour rend les définitions d’hier au caractère près, et sa garde exige celles que la migration pose', () => {
    const retour = RETOUR()
    expect(definitionDans(retour, 'valider_exercice')).toBe(avant('valider_exercice'))
    expect(definitionDans(retour, 'verifier_exercice_valide'))
      .toBe(avant('verifier_exercice_valide').replace('create function public.verifier_exercice_valide(', 'create or replace function public.verifier_exercice_valide('))
    const garde = empreintesDe(blocEntre(retour, 'do $garde$', '$garde$;'))
    const texte = MIGRATION().texte
    expect(garde).toEqual(new Map([
      ['valider_exercice', md5(corps(definitionDans(texte, 'valider_exercice')))],
      ['verifier_exercice_valide', md5(corps(definitionDans(texte, 'verifier_exercice_valide')))],
      ['empreinte_exercice_forme_2', md5(corps(definitionDans(texte, 'empreinte_exercice_forme_2')))],
    ]))
    expect(retour).toContain('if exists (select 1 from public.exercices_valides where forme_empreinte <> 1) then')
  })

  it('la voie : la migration passe par l’outil (aucun mot qu’il retient), le retour se colle', () => {
    const texte = MIGRATION().texte
    expect(texte).not.toMatch(/\b(drop|delete|truncate)\b/i)
    expect(texte).not.toMatch(/[\r\\]/)
    expect(RETOUR()).toMatch(/\bdrop\b/)
  })

  it('l’essai recalcule la forme 2 sous la même étiquette, par une formule écrite à part', () => {
    const essai = readFileSync(`${RACINE}supabase/essais/empreinteDesExercices.sql`, 'utf8')
    const etiquette = "'jd-precompta/exercice-valide/forme-2'"
    expect(corps(definitionDans(MIGRATION().texte, 'empreinte_exercice_forme_2'))).toContain(etiquette)
    expect(essai).toContain(etiquette)
    expect(essai).not.toContain('= empreinte_exercice_forme_2(x.')
  })
})
