import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { codesSql, messagesSql } from '../test/raiseSql'
import { derniereDefinitionSql, fichiersDuSchema } from '../test/schema'
import { REFUS_ECRITURE_VENTE } from './ecritureVenteFacturee'
import { REFUS_CLASSEMENT } from './encaissementsFactures'

// LE VIREMENT MIXTE, EN BASE (chantier EC-Q3, ligne 28.65, étape VF5h ; VF2-Q2, selon VF5-Q2 : la manière A ; migration
// `virement_mixte`, dans l'export à sa version provisoire). La migration reprend quatre fonctions d'hier —
// `classer_mouvement_par_encaissements`, `ecriture_attendue_vente_facturee`, `ecrire_vente_facturee` et la garde G5 —, et
// ne change que ce que voici : ce garde la confronte à l'export, fonction par fonction, au caractère près. Une migration
// qui reprendrait l'une d'elles depuis un autre corps, ou y changerait une ligne de plus, vire au rouge ici avant d'être
// collée ; la garde que la migration porte (son bloc 0) refuse en base un corps qui n'est plus celui d'hier.
//
// Ce que le virement mixte fait, ses refus et ses écritures, d'autres le gardent : encaissementsFactures.test.ts (les onze
// refus du classement, confrontés au texte), encaissementsVenteFacturee.test.ts (le rang 7), ecritureVenteFacturee.test.ts
// (le seizième refus d'écrire, et l'essai des écritures confronté au module), ecrituresVentesFacturees.test.ts (la
// composition du mouvement), rattachement.test.ts (le paiement qu'il fait à l'exemplaire).

const MIGRATION = /\/\d{14}_virement_mixte\.sql$/
const texteDeLaMigration = () => fichiersDuSchema().find((f) => MIGRATION.test(f.chemin))?.texte ?? ''

// La définition d'une fonction telle que la dernière migration AVANT celle-ci la laisse : celle que la production
// exécute aujourd'hui.
function definitionAvantLaMigration(nom: string): string {
  const motif = new RegExp(`create (or replace )?function public\\.${nom}\\(`, 'g')
  const fichiers = fichiersDuSchema()
  const ici = fichiers.findIndex((f) => MIGRATION.test(f.chemin))
  expect(ici, 'la migration virement_mixte dans l’export').toBeGreaterThan(0)
  const avant = fichiers.slice(0, ici).filter((f) => new RegExp(motif.source).test(f.texte))
  expect(avant.length, nom).toBeGreaterThan(0)
  const texte = avant[avant.length - 1].texte
  const positions = [...texte.matchAll(motif)].map((m) => m.index as number)
  const debut = positions[positions.length - 1]
  return texte.slice(debut, texte.indexOf('$$;', debut))
}

// Le fichier de l'export qui porte la DERNIÈRE définition d'une fonction : celle que la base exécutera.
function fichierDeLaDerniereDefinition(nom: string): string {
  const motif = new RegExp(`create (or replace )?function public\\.${nom}\\(`)
  const fichiers = fichiersDuSchema().filter((f) => motif.test(f.texte))
  return fichiers[fichiers.length - 1]?.chemin ?? ''
}

const corps = (definition: string) => definition.slice(definition.indexOf('as $$') + 'as $$'.length)
const md5 = (texte: string) => createHash('md5').update(texte, 'utf8').digest('hex')

// Les quatre fonctions reprises : l'empreinte de leur corps d'hier (celle que la production portait le 23/10/2026, relevée
// par catalogue), et la migration qui l'a écrit.
const REPRISES = [
  ['classer_mouvement_par_encaissements', '02d897a772064bfcf64313356c5a3db9', 'encaissements_de_la_vente_facturee'],
  ['ecriture_attendue_vente_facturee', 'f050e941c3d41dc97f0734c36ced5524', 'ecritures_de_la_vente_facturee'],
  ['ecrire_vente_facturee', '134a517449cfbf20d22c613a2b74afba', 'ecritures_de_la_vente_facturee'],
  ['garder_lignes_de_la_vente_facturee', '6538f24104e70581df4bca9038b61c7c', 'ecritures_de_la_vente_facturee'],
] as const

// Ce que la migration change, et RIEN D'AUTRE : [fonction, texte d'hier, texte de demain], chacun présent une fois. Le
// classement : la variable du numéro, le rang 7 neuf et le total de tous les encaissements ; la composition : le motif
// d'une facture qui n'est pas source sans son exemplaire unique et validé, qui nomme la facture, puis la banque et le 511
// de la seule part des factures sources ; écrire : le rang 16 sous ses mots neufs ; G5 : une ligne qui porte une pièce
// n'est pas du troisième genre, avant comme après.
const CHANGEMENTS: readonly (readonly [string, string, string])[] = [
  [
    "classer_mouvement_par_encaissements",
    "  v_ecart numeric;\nbegin\n",
    "  v_ecart numeric;\n  v_numero text;\nbegin\n",
  ],
  [
    "classer_mouvement_par_encaissements",
    "  select coalesce(sum(e.montant), 0) into v_porte\n    from public.encaissements_factures e\n    join public.factures_emises f on f.id = e.facture_id\n   where e.ligne_bancaire_id = p_ligne_bancaire_id and e.retire_le is null and f.source_de_la_vente\n     and public.encaissement_justifie_son_mouvement(e.id);\n",
    "  -- Le virement mixte (VF2-Q2, selon VF5-Q2 : la manière A). L'encaissement vivant d'une facture qui n'est pas source de\n  -- sa vente, cité sur ce mouvement, compte aussi : sa vente se compte par la pièce de cette facture, que ce mouvement\n  -- date — un paiement de son exemplaire (src/lib/rattachement.ts). Il faut donc que la facture ait exactement un\n  -- exemplaire désigné, une pièce de vente validée de ce dossier (VF1) ; sinon celle de ces factures qui a le plus\n  -- petit numéro est nommée.\n  select f.numero into v_numero\n    from public.encaissements_factures e\n    join public.factures_emises f on f.id = e.facture_id\n   where e.ligne_bancaire_id = p_ligne_bancaire_id and e.retire_le is null and not f.source_de_la_vente\n     and public.encaissement_justifie_son_mouvement(e.id)\n     and (select count(*) from public.pieces p\n           where p.facture_id = f.id and p.dossier_id = p_dossier_id and p.statut = 'validee' and p.type_piece = 'vente') <> 1\n   order by f.numero collate \"C\", f.id\n   limit 1;\n  if found then\n    raise exception 'Désignez d''abord l''exemplaire de la facture % : ce mouvement porte aussi son encaissement, et cette facture, qui n''est pas la source de sa vente, se compte par une seule pièce validée.',\n      v_numero using errcode = '22023';\n  end if;\n  select coalesce(sum(e.montant), 0) into v_porte\n    from public.encaissements_factures e\n   where e.ligne_bancaire_id = p_ligne_bancaire_id and e.retire_le is null\n     and public.encaissement_justifie_son_mouvement(e.id);\n",
  ],
  [
    "ecriture_attendue_vente_facturee",
    "    if exists (select 1 from public.encaissements_factures e\n                 join public.factures_emises f on f.id = e.facture_id\n                where e.ligne_bancaire_id = p_source_id and e.dossier_id = p_dossier_id and e.retire_le is null\n                  and not (f.statut = 'validee' and f.source_de_la_vente) and public.encaissement_justifie_son_mouvement(e.id)) then\n      motif := 'mouvement_facture_non_source';\n      return;\n    end if;\n",
    "    -- Le virement mixte (VF2-Q2, selon VF5-Q2 : la manière A) : l'encaissement d'une facture qui n'est pas source de sa\n    -- vente ne retient plus le mouvement quand cette facture a exactement un exemplaire désigné, une pièce de vente\n    -- validée de ce dossier (VF1) — c'est cette pièce qui compte la vente, et qui écrit elle-même sa banque sur ce\n    -- mouvement, à sa date (src/lib/contrepartieBanque.ts). Sans lui, ou avec plusieurs, le refus d'hier, la facture\n    -- nommée : celle qui a le plus petit numéro, comme le classement la nomme.\n    select f.numero into detail\n      from public.encaissements_factures e\n      join public.factures_emises f on f.id = e.facture_id\n     where e.ligne_bancaire_id = p_source_id and e.dossier_id = p_dossier_id and e.retire_le is null\n       and not (f.statut = 'validee' and f.source_de_la_vente) and public.encaissement_justifie_son_mouvement(e.id)\n       and (select count(*) from public.pieces p\n             where p.facture_id = f.id and p.dossier_id = p_dossier_id and p.statut = 'validee' and p.type_piece = 'vente') <> 1\n     order by f.numero collate \"C\", f.id\n     limit 1;\n    if found then\n      motif := 'mouvement_facture_non_source';\n      return;\n    end if;\n",
  ],
  [
    "ecriture_attendue_vente_facturee",
    "    v_montant := (v_m.montant * 100)::bigint;\n    select coalesce(sum((e.montant * 100)::bigint), 0),\n           coalesce(sum((e.montant * 100)::bigint) filter (where e.date_encaissement = v_m.date), 0)\n      into v_total, v_meme_jour\n      from public.encaissements_factures e\n     where e.ligne_bancaire_id = p_source_id and e.dossier_id = p_dossier_id and e.retire_le is null\n       and public.encaissement_justifie_son_mouvement(e.id);\n    -- Ceux du même jour ont porté la banque eux-mêmes ; ceux d'un autre jour sont passés au 511 (au 53 pour des\n    -- espèces), que le mouvement solde.\n    v_soldes := coalesce((\n      select jsonb_agg(jsonb_build_object('d', v_m.date, 'c', case when e.moyen = 'especes' then v_caisse else v_valeurs end,\n                                          'l', v_m.id, 'm', -((e.montant * 100)::bigint)))\n        from public.encaissements_factures e\n       where e.ligne_bancaire_id = p_source_id and e.dossier_id = p_dossier_id and e.retire_le is null\n         and public.encaissement_justifie_son_mouvement(e.id) and e.date_encaissement <> v_m.date), '[]');\n",
    "    v_montant := (v_m.montant * 100)::bigint;\n    select coalesce(sum((e.montant * 100)::bigint), 0),\n           coalesce(sum((e.montant * 100)::bigint) filter (where e.date_encaissement = v_m.date or not f.source_de_la_vente), 0)\n      into v_total, v_meme_jour\n      from public.encaissements_factures e\n      join public.factures_emises f on f.id = e.facture_id\n     where e.ligne_bancaire_id = p_source_id and e.dossier_id = p_dossier_id and e.retire_le is null\n       and public.encaissement_justifie_son_mouvement(e.id);\n    -- Ceux du même jour ont porté la banque eux-mêmes ; ceux d'un autre jour sont passés au 511 (au 53 pour des\n    -- espèces), que le mouvement solde. La pièce d'une facture qui n'est pas source porte elle-même sa banque sur ce\n    -- mouvement, quel que soit le jour de son encaissement : comme un encaissement du même jour. Les frais sont ceux\n    -- du tout.\n    v_soldes := coalesce((\n      select jsonb_agg(jsonb_build_object('d', v_m.date, 'c', case when e.moyen = 'especes' then v_caisse else v_valeurs end,\n                                          'l', v_m.id, 'm', -((e.montant * 100)::bigint)))\n        from public.encaissements_factures e\n        join public.factures_emises f on f.id = e.facture_id\n       where e.ligne_bancaire_id = p_source_id and e.dossier_id = p_dossier_id and e.retire_le is null\n         and public.encaissement_justifie_son_mouvement(e.id) and e.date_encaissement <> v_m.date\n         and f.source_de_la_vente), '[]');\n",
  ],
  [
    "ecrire_vente_facturee",
    "  if v_motif = 'mouvement_facture_non_source' then\n    raise exception 'Ce mouvement porte aussi l''encaissement d''une facture qui n''est pas la source de sa vente : son écriture n''est pas encore conçue.'\n      using errcode = '22023';\n  end if;\n",
    "  if v_motif = 'mouvement_facture_non_source' then\n    raise exception 'Désignez d''abord l''exemplaire de la facture % : ce mouvement porte aussi son encaissement, et cette facture, qui n''est pas la source de sa vente, se compte par une seule pièce validée.',\n      v_detail using errcode = '22023';\n  end if;\n",
  ],
  [
    "garder_lignes_de_la_vente_facturee",
    "    v_apres := coalesce(new.encaissement_id, new.facture_id)::text;\n    if v_apres is null and exists (select 1 from public.lignes_bancaires l\n                                    where l.id = new.ligne_bancaire_id and l.encaissements_de_factures) then\n",
    "    v_apres := coalesce(new.encaissement_id, new.facture_id)::text;\n    -- Une ligne qui porte une pièce n'est pas du troisième genre : c'est l'écriture de cette pièce — la banque de\n    -- l'exemplaire d'une facture qui n'est pas source, que ce mouvement paie (le virement mixte, VF5h).\n    if v_apres is null and new.piece_id is null and exists (select 1 from public.lignes_bancaires l\n                                    where l.id = new.ligne_bancaire_id and l.encaissements_de_factures) then\n",
  ],
  [
    "garder_lignes_de_la_vente_facturee",
    "  v_avant := coalesce(old.encaissement_id, old.facture_id)::text;\n  if v_avant is null and exists (select 1 from public.lignes_bancaires l\n",
    "  v_avant := coalesce(old.encaissement_id, old.facture_id)::text;\n  if v_avant is null and old.piece_id is null and exists (select 1 from public.lignes_bancaires l\n",
  ],
]

// Hier, depuis demain : les remplacements défaits, du dernier au premier.
function hierDepuisDemain(nom: string, demain: string): string {
  let texte = demain.replace(`create or replace function public.${nom}(`, `create function public.${nom}(`)
  for (const [fonction, hier, apres] of [...CHANGEMENTS].reverse()) {
    if (fonction !== nom) continue
    expect(texte.split(apres).length - 1, `${nom} : ${apres.slice(0, 60)}`).toBe(1)
    texte = texte.replace(apres, hier)
  }
  return texte
}

describe('la migration du virement mixte reprend quatre fonctions d’hier, et n’y change que ce qu’elle dit', () => {
  it('sa garde exige le corps d’hier de chacune, celui que l’export porte avant elle', () => {
    const texte = texteDeLaMigration()
    expect(texte).not.toBe('')
    for (const [nom, empreinte, migration] of REPRISES) {
      expect(md5(corps(definitionAvantLaMigration(nom))), nom).toBe(empreinte)
      expect(texte, nom).toContain(`, '${empreinte}', '${migration}')`)
      // Avant toute définition : un corps qui n'est plus celui d'hier ne se remplace pas.
      expect(texte.indexOf(`'${empreinte}'`), nom).toBeLessThan(texte.indexOf('create or replace function'))
    }
    expect(texte).toContain("md5(replace((select p.prosrc from pg_proc p where p.oid = to_regprocedure(v.fonction)), chr(13), '')) <> v.empreinte then")
  })

  it('chacune est sa dernière définition, et redevient celle d’hier au caractère près quand ses remplacements se défont', () => {
    for (const [nom] of REPRISES) {
      expect(fichierDeLaDerniereDefinition(nom), nom).toMatch(MIGRATION)
      const demain = derniereDefinitionSql(nom)
      expect(demain.startsWith(`create or replace function public.${nom}(`), nom).toBe(true)
      expect(hierDepuisDemain(nom, demain), nom).toBe(definitionAvantLaMigration(nom))
    }
    // Sept remplacements, chacun dans sa fonction.
    expect(CHANGEMENTS.map(([f]) => f)).toEqual([
      'classer_mouvement_par_encaissements', 'classer_mouvement_par_encaissements', 'ecriture_attendue_vente_facturee',
      'ecriture_attendue_vente_facturee', 'ecrire_vente_facturee', 'garder_lignes_de_la_vente_facturee',
      'garder_lignes_de_la_vente_facturee',
    ])
  })

  it('vire au rouge sur une dérive plantée : un mot de plus hors des remplacements', () => {
    const demain = derniereDefinitionSql('ecrire_vente_facturee')
    const derive = demain.replace("raise exception 'Accès refusé à ce dossier.'", "raise exception 'Accès refusé à ce dossier !'")
    expect(derive).not.toBe(demain)
    expect(hierDepuisDemain('ecrire_vente_facturee', derive)).not.toBe(definitionAvantLaMigration('ecrire_vente_facturee'))
  })

  it('les refus : le classement gagne son rang 7, écrire change les mots de son seizième, les deux autres n’en ont pas de neufs', () => {
    const avantClasser = definitionAvantLaMigration('classer_mouvement_par_encaissements')
    const classer = derniereDefinitionSql('classer_mouvement_par_encaissements')
    const neuf = REFUS_CLASSEMENT.find((r) => r.cle === 'exemplaire_a_designer')?.modele ?? ''
    expect(messagesSql(classer)).toEqual([...messagesSql(avantClasser).slice(0, 6), neuf, ...messagesSql(avantClasser).slice(6)])
    expect(codesSql(classer)).toEqual([...codesSql(avantClasser).slice(0, 6), '22023', ...codesSql(avantClasser).slice(6)])
    const avantEcrire = messagesSql(definitionAvantLaMigration('ecrire_vente_facturee'))
    const ecrire = messagesSql(derniereDefinitionSql('ecrire_vente_facturee'))
    expect(ecrire).toHaveLength(avantEcrire.length)
    expect(ecrire.filter((m, i) => m !== avantEcrire[i])).toEqual([neuf])
    expect(ecrire.indexOf(neuf)).toBe(REFUS_ECRITURE_VENTE.findIndex((r) => r.cle === 'mouvement_facture_non_source'))
    for (const nom of ['ecriture_attendue_vente_facturee', 'garder_lignes_de_la_vente_facturee']) {
      expect(messagesSql(derniereDefinitionSql(nom)), nom).toEqual(messagesSql(definitionAvantLaMigration(nom)))
      expect(codesSql(derniereDefinitionSql(nom)), nom).toEqual(codesSql(definitionAvantLaMigration(nom)))
    }
  })

  it('la même règle dans le classement et dans la composition : l’exemplaire unique et validé, la facture au plus petit numéro', () => {
    const condition = /\(select count\(\*\) from public\.pieces p\s+where p\.facture_id = f\.id and p\.dossier_id = p_dossier_id and p\.statut = 'validee' and p\.type_piece = 'vente'\) <> 1\s+order by f\.numero collate "C", f\.id\s+limit 1;/
    for (const nom of ['classer_mouvement_par_encaissements', 'ecriture_attendue_vente_facturee']) {
      expect(derniereDefinitionSql(nom), nom).toMatch(condition)
    }
  })

  it('le texte : une seule définition de chacune, ni droits rejoués ni objet retiré, aucune barre oblique inverse', () => {
    const texte = texteDeLaMigration()
    for (const [nom] of REPRISES) {
      expect(texte.match(new RegExp(`create or replace function public\\.${nom}\\(`, 'g')), nom).toHaveLength(1)
    }
    expect(texte.match(/create (or replace )?function/g)).toHaveLength(4)
    expect(texte).not.toMatch(/\b(grant|revoke|drop|truncate|alter)\b/i)
    expect(texte).not.toMatch(/\b(create|drop)\s+(table|policy|trigger|index)\b/i)
    // La seule suppression : celle qu'`ecrire_vente_facturee` faisait déjà, des écritures proposées de la source qu'elle
    // remplace — trois instructions, comme hier ; le détecteur d'`apply_migration` la retiendra, d'où le collage.
    const suppressions = (t: string) => t.match(/\bdelete from\b/gi)?.length ?? 0
    expect(suppressions(texte)).toBe(3)
    expect(suppressions(definitionAvantLaMigration('ecrire_vente_facturee'))).toBe(3)
    expect(texte).not.toContain('\\')
    expect(texte).not.toContain('\r')
  })

  it('les commentaires du classement et de G5 disent ce qu’ils font désormais', () => {
    const texte = texteDeLaMigration()
    const commentaire = (signature: string) => {
      const m = new RegExp(`comment on function public\\.${signature.replace(/[()]/g, '\\$&')} is\\n {2}'((?:[^']|'')*)';`).exec(texte)
      return m ? m[1].replace(/''/g, "'") : ''
    }
    expect(commentaire('classer_mouvement_par_encaissements(uuid, uuid)')).toContain('exactement un exemplaire désigné')
    expect(commentaire('garder_lignes_de_la_vente_facturee()')).toContain('la banque d\'une pièce que ce mouvement paie reste l\'écriture de cette pièce')
  })
})
