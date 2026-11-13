import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { derniereDefinitionSql, finDuCorps, motifDeDefinition } from '../test/schema'

// INV3-Q1 (A) : L'EMPREINTE D'UN EXERCICE VALIDÉ SCELLE AUSSI SON INVENTAIRE, SANS FORME NOUVELLE. La migration préparée
// `validation_de_l_inventaire` reprend `empreinte_exercice_forme_2` et `fichier_fige` telles que la production les porte
// (l'export) et n'y AJOUTE que l'inventaire : un exercice sans régularisation garde son texte d'hier, octet pour octet — ce
// que son essai (supabase/essais/validationDeLInventaire.sql, VI-S2) et celui d'INAL2 (empreinteDesExercices.sql, qui la
// recalcule par sa formule d'hier) rejouent sur la réplique, et que sa garde de fin exige sur toute la base. Ce garde-ci
// tient les textes : chaque fonction au caractère près hors de ses ajouts, chaque empreinte épinglée par une garde (la
// sienne, celle d'INV4, celle de son retour) recalculée du texte qui pose la fonction, et les essais qui admettent
// `fichier_fige` à son empreinte. Récit : HISTORIQUE.md, « 13/11/2026 — INV3-Q1 ET INV3-Q2 ».

const md5 = (texte: string) => createHash('md5').update(texte, 'utf8').digest('hex')
const lire = (chemin: string) => readFileSync(new URL(`../../${chemin}`, import.meta.url), 'utf8')
const INV2 = lire('supabase/preparees/20261112190000_operations_d_inventaire.sql')
const INV4 = lire('supabase/preparees/20261112230000_provisions.sql')
const INV3 = lire('supabase/preparees/20261112235000_validation_de_l_inventaire.sql')
const RETOUR = lire('supabase/preparees/retour/20261112235100_retour_validation_de_l_inventaire.sql')
const SIGNATURE_FORME_2 = 'empreinte_exercice_forme_2(uuid, integer, text, timestamp with time zone, uuid, text, integer, integer, numeric, numeric, jsonb)'

// La définition qu'un texte donne à une fonction (la seule qu'il en donne), de `create` au délimiteur fermant exclu.
function definitionDans(texte: string, fonction: string): string {
  const positions = [...texte.matchAll(motifDeDefinition(fonction))].map((m) => m.index)
  expect(positions, fonction).toHaveLength(1)
  return texte.slice(positions[0], finDuCorps(texte, positions[0], fonction))
}
// Le corps, tel que la base le garde (`prosrc`) : ce qui suit le délimiteur ouvrant.
function corps(definition: string): string {
  const ouverture = /\$(\w*)\$/.exec(definition)!
  return definition.slice(ouverture.index + ouverture[0].length)
}
const empreinteDans = (texte: string, fonction: string) => md5(corps(definitionDans(texte, fonction)))
const enProduction = (fonction: string) => derniereDefinitionSql(fonction)
const remplacee = (definition: string) => definition.replace(/^create\s+function/i, 'create or replace function')

function uneFois(texte: string, de: string, vers: string): string {
  expect(texte.split(de).length - 1, de.slice(0, 80)).toBe(1)
  return texte.replace(de, () => vers)
}

// Les paires (fonction, empreinte) d'une garde : `('[public.]f(args)', '<md5>'`.
function empreintesDe(bloc: string): Map<string, string> {
  return new Map([...bloc.matchAll(/\('(?:public\.)?(\w+)\([^']*\)',\s*'([0-9a-f]{32})'/g)].map((m) => [m[1], m[2]]))
}
const blocEntre = (texte: string, debut: string, fin: string) => texte.slice(texte.indexOf(debut), texte.indexOf(fin, texte.indexOf(debut)))

describe('l’empreinte étendue (INV3-Q1 (A)) : la production, et l’inventaire seul en plus', () => {
  it('empreinte_exercice_forme_2 : celle de la production au caractère près, hors des pièces de l’inventaire et du bloc des régularisations', () => {
    let attendue = remplacee(enProduction('empreinte_exercice_forme_2'))
    attendue = uneFois(attendue,
      "    -- Les fichiers des pièces que les écritures validées de l'exercice citent, directement ou par leur bien.\n",
      "    -- Les fichiers des pièces que les écritures validées de l'exercice citent, directement ou par leur bien, et de celles\n"
      + "    -- que ses régularisations d'inventaire citent (INV3-Q1).\n")
    attendue = uneFois(attendue,
      "            and e.date between make_date(p_annee, 1, 1) and make_date(p_annee, 12, 31))), '')\n",
      "            and e.date between make_date(p_annee, 1, 1) and make_date(p_annee, 12, 31)\n"
      + '         union\n'
      + "         select s.piece_id from public.pieces_scellees_par_l_inventaire(p_dossier_id, p_annee) as s(piece_id))), '')\n")
    attendue = uneFois(attendue,
      "    || chr(29) || coalesce(p_declaration::text, ''),\n",
      "    || chr(29) || coalesce(p_declaration::text, '')\n"
      + "    -- Les régularisations d'inventaire que l'exercice scelle (INV3-Q1) : un bloc présent seulement quand il y en a.\n"
      + "    || coalesce(chr(29) || public.regularisations_scellees(p_dossier_id, p_annee), ''),\n")
    expect(definitionDans(INV3, 'empreinte_exercice_forme_2')).toBe(attendue)
  })

  it('le bloc des régularisations n’existe que quand l’exercice en scelle : nul, il ne laisse aucun séparateur', () => {
    const posee = corps(definitionDans(INV3, 'empreinte_exercice_forme_2'))
    expect(posee).toContain("|| coalesce(chr(29) || public.regularisations_scellees(p_dossier_id, p_annee), '')")
    expect(posee).not.toMatch(/chr\(29\) \|\| coalesce\(public\.regularisations_scellees/)
    // Les deux aides rendent nul, ou rien, pour un exercice qui ne scelle aucune régularisation : `string_agg` d'aucune ligne.
    expect(corps(definitionDans(INV3, 'regularisations_scellees'))).toMatch(/select string_agg\(/)
  })

  it('fichier_fige : celle de la production au caractère près, plus la pièce que l’inventaire d’un exercice validé scelle', () => {
    const attendue = uneFois(remplacee(enProduction('fichier_fige')),
      '                or exists (select 1 from public.dossier_permanent d where d.piece_id = p.id)))\n',
      '                or exists (select 1 from public.dossier_permanent d where d.piece_id = p.id)\n'
      + '                or public.exercice_scellant_la_piece_citee(p.id) is not null))\n')
    expect(definitionDans(INV3, 'fichier_fige')).toBe(attendue)
  })

  it('chaque régularisation est scellée une fois, par l’exercice qui la porte : la reprise par celui de son extourne', () => {
    for (const f of ['regularisations_scellees', 'pieces_scellees_par_l_inventaire']) {
      expect(corps(definitionDans(INV3, f)), f).toContain('(case when o.reprise then o.exercice + 1 else o.exercice end) = p_annee')
    }
    expect(corps(definitionDans(INV3, 'exercice_scellant_la_piece_citee')))
      .toContain('(case when o.reprise then o.exercice + 1 else o.exercice end) <= extract(year from public.frontiere_validation(o.dossier_id))')
  })
})

describe('les empreintes épinglées, recalculées des textes qui posent les fonctions', () => {
  it('la garde de tête d’INV3 : les fonctions de la production à leur corps de l’export, celles d’INV2 à leur corps préparé', () => {
    const tete = empreintesDe(blocEntre(INV3, 'do $garde$', '$garde$;'))
    const deLaProduction = ['valider_exercice', 'empreinte_exercice_forme_2', 'verifier_exercice_valide', 'fichier_fige',
      'exercice_figeant_la_piece', 'admin_du_dossier', 'is_super_admin', 'cle_validation', 'frontiere_validation', 'retour_declencheur']
    for (const f of deLaProduction) expect(tete.get(f), f).toBe(md5(corps(enProduction(f))))
    for (const f of ['garder_operations_inventaire', 'garder_ecriture_d_inventaire', 'enregistrer_operation_inventaire', 'retirer_operation_inventaire']) {
      expect(tete.get(f), f).toBe(empreinteDans(INV2, f))
    }
    expect([...tete.keys()].sort()).toEqual([...deLaProduction, 'garder_operations_inventaire', 'garder_ecriture_d_inventaire',
      'enregistrer_operation_inventaire', 'retirer_operation_inventaire'].sort())
  })

  it('la garde de tête d’INV4 : les fonctions d’INV2 à leur corps préparé', () => {
    const tete = empreintesDe(blocEntre(INV4, 'do $garde$', '$garde$;'))
    for (const f of ['garder_operations_inventaire', 'garder_ecriture_d_inventaire', 'enregistrer_operation_inventaire',
      'retirer_operation_inventaire', 'inventaire_entier', 'inventaire_rogne']) {
      expect(tete.get(f), f).toBe(empreinteDans(INV2, f))
    }
  })

  it('la garde de fin d’INV3 : chaque fonction qu’elle pose, à son corps', () => {
    const fin = empreintesDe(blocEntre(INV3, 'do $fin$', '$fin$;'))
    expect([...fin.keys()].sort()).toEqual(['declarer_inventaire', 'empreinte_exercice_forme_2', 'exercice_scellant_la_piece_citee',
      'fichier_fige', 'garder_fichier_scelle_par_l_inventaire', 'garder_inventaires_declares', 'inventaire_a_jour',
      'inventaire_extourne_entiere', 'pieces_scellees_par_l_inventaire', 'regularisations_scellees', 'retirer_declaration_inventaire',
      'valider_exercice'])
    for (const [f, empreinte] of fin) expect(empreinte, f).toBe(empreinteDans(INV3, f))
  })

  it('la garde de fin d’INV3 rejoue la vérification de tout exercice validé, sous l’empreinte d’hier puis l’étendue', () => {
    expect(blocEntre(INV3, 'do $garde$', '$garde$;')).toContain("perform set_config('jd.inventaire_exercices_verifies', (")
    expect(blocEntre(INV3, 'do $fin$', '$fin$;'))
      .toContain("current_setting('jd.inventaire_exercices_verifies', true) is distinct from (")
  })

  it('le retour rend l’empreinte et fichier_fige de la production, leur commentaire aussi, et sa garde exige les corps d’INV3', () => {
    expect(definitionDans(RETOUR, 'empreinte_exercice_forme_2')).toBe(remplacee(enProduction('empreinte_exercice_forme_2')))
    expect(definitionDans(RETOUR, 'fichier_fige')).toBe(remplacee(enProduction('fichier_fige')))
    const garde = blocEntre(RETOUR, 'do $garde$', '$garde$;')
    for (const f of ['valider_exercice', 'empreinte_exercice_forme_2', 'fichier_fige']) expect(garde, f).toContain(`'${empreinteDans(INV3, f)}'`)
    const fin = blocEntre(RETOUR, 'do $fin$', '$fin$;')
    expect(fin).toContain(`'${md5(corps(enProduction('empreinte_exercice_forme_2')))}'`)
    expect(fin).toContain(`'${md5(corps(enProduction('fichier_fige')))}'`)
    for (const objet of ['drop trigger pieces_fichier_scelle_par_l_inventaire on public.pieces;',
      'drop function public.garder_fichier_scelle_par_l_inventaire();', 'drop function public.exercice_scellant_la_piece_citee(uuid);',
      'drop function public.pieces_scellees_par_l_inventaire(uuid, integer);', 'drop function public.regularisations_scellees(uuid, integer);']) {
      expect(RETOUR, objet).toContain(objet)
    }
    // Se refuse tant qu'un exercice validé scelle l'inventaire : l'empreinte d'hier ne le verrait plus.
    expect(garde).toContain('public.regularisations_scellees(ev.dossier_id, ev.annee) is not null')
  })

  it('les essais qui admettent fichier_fige à son empreinte admettent celle de la production et celle d’INV3', () => {
    for (const essai of ['supabase/essais/dossierPermanent.sql', 'supabase/essais/exemplairesDesFactures.sql']) {
      expect(lire(essai), essai).toContain(`md5(replace(prosrc, chr(13), '')) in ('${md5(corps(enProduction('fichier_fige')))}', '${empreinteDans(INV3, 'fichier_fige')}')`)
    }
    expect(lire('supabase/essais/validationExercice.sql'))
      .toContain("'pieces.pieces_fichier_scelle_par_l_inventaire:garder_fichier_scelle_par_l_inventaire:dossier:O'")
  })
})

describe('la voie et les droits', () => {
  it('INV3 passe toujours par l’outil : ni suppression, ni destruction, ni barre oblique inverse', () => {
    expect(INV3).not.toMatch(/\bdelete\s+from\b|\bdrop\s|\btruncate\b/i)
    expect(INV3).not.toContain('\\')
    expect(INV3).not.toContain('\r')
  })

  it('les aides de l’empreinte sont aux droits de l’appelant (l’empreinte se lit sous sa RLS) ; les autres, privées', () => {
    for (const f of ['regularisations_scellees(uuid, integer)', 'pieces_scellees_par_l_inventaire(uuid, integer)']) {
      expect(INV3, f).toContain(`grant execute on function public.${f} to authenticated;`)
      expect(definitionDans(INV3, f.slice(0, f.indexOf('(')))).not.toMatch(/security definer/)
    }
    expect(INV3).toContain('revoke execute on function public.exercice_scellant_la_piece_citee(uuid) from public, anon, authenticated;')
    expect(INV3).toContain('revoke execute on function public.garder_fichier_scelle_par_l_inventaire() from public, anon, authenticated;')
    expect(definitionDans(INV3, 'garder_fichier_scelle_par_l_inventaire')).toMatch(/security definer set search_path = public/)
    expect(INV3).toContain(`comment on function public.${SIGNATURE_FORME_2} is`)
  })

  it('la garde du fichier ne regarde que lui : ses quatre colonnes à la mise à jour, et la suppression', () => {
    expect(INV3).toContain('  before update of storage_path, storage_hash, lisible_path, dossier_id or delete\n  on public.pieces for each row')
    // Le départ du dossier l'emporte, comme pour toute garde (validationExercice.sql, contrôle 141).
    expect(corps(definitionDans(INV3, 'garder_fichier_scelle_par_l_inventaire')))
      .toContain('if not exists (select 1 from public.dossiers where id = old.dossier_id) then')
  })
})
