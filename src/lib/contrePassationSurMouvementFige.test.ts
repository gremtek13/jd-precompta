import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { correspondAuModele, etapesDeLEssai, refusExigesParLEssai, TEXTE_ESSAI_VENTES_FACTUREES } from '../test/essaiVentesFacturees'
import { codesSql, messagesSql } from '../test/raiseSql'
import { derniereDefinitionSql, fichiersDuSchema } from '../test/schema'
import { REFUS_CONTRE_PASSATION, REFUS_ENREGISTREMENT } from './encaissementsFactures'
import { ORDRE_RESTAURATION, ORDRE_RESTAURATION_PREVU, TABLES_AUTO_REFERENCEES, TABLES_AUTO_REFERENCEES_PAR_VAGUES } from './sauvegarde'

// LA CONTRE-PASSATION SANS MOUVEMENT SUR UN MOUVEMENT FIGÉ (chantier EC-Q3, ligne 28.65 ; VF5H2Q1-Q2, « La refuser
// (petite migration à part) », et VF5H2Q1Q2-Q1, écrite sur la recommandation, le 26/10/2026 ; migration
// `contre_passation_sur_mouvement_fige`, appliquée le 27/10/2026 sous la version 20261027055337). Les règles de
// VF5H2-Q1 excusent le super-administrateur — la restauration — à l'insertion ; la migration reprend la garde des
// encaissements (`garder_encaissement_facture`) telle qu'`insertion_des_encaissements` l'a laissée, et n'y fait qu'INSÉRER
// deux règles, pour un mouvement classé par ses encaissements et FIGÉ — daté au plus tard du 31 décembre du dernier
// exercice validé de son dossier —, le super-administrateur compris : il ne se cite plus par l'encaissement d'une facture
// qui n'est pas source (la facture d'avant d'un virement mixte ; pour une facture source, la garde de la frontière le
// refuse déjà) ; la contre-passation sans mouvement d'un encaissement qu'il compte ne s'insère plus, de toute facture. Ce
// garde les confronte à l'export, au caractère près ; dit que leur verrou est celui de la validation et leur frontière
// celle de `frontiere_validation` ; qu'aucune fonction n'atteint ces refus ; que la restauration les passe — elle n'écrit
// que dans un dossier qui n'existe pas, et réinsère ses exercices validés en DERNIER, après les mouvements et les
// encaissements, leurs contre-passations par vagues à leur rang ; et confronte l'essai (supabase/essais/ventesFacturees.sql
// : 146f à 146o, les mutations 198 à 198e, et le pas du jeu où la restauration pose ses contre-passations avant que
// l'exercice ne soit validé). Récit : HISTORIQUE.md, « LA CONTRE-PASSATION SANS MOUVEMENT SUR UN MOUVEMENT FIGÉ ». Données
// FICTIVES.

const MIGRATION = /\/\d{14}_contre_passation_sur_mouvement_fige\.sql$/
const texteDeLaMigration = () => fichiersDuSchema().find((f) => MIGRATION.test(f.chemin))?.texte ?? ''
const corps = (definition: string) => definition.slice(definition.indexOf('as $$') + 'as $$'.length)
const md5 = (texte: string) => createHash('md5').update(texte, 'utf8').digest('hex')
const GARDE = 'garder_encaissement_facture'

// La définition d'une fonction telle que la dernière migration AVANT celle-ci la laisse — celle que la production
// exécute aujourd'hui —, et le fichier qui la porte.
function avantLaMigration(nom: string): { chemin: string; definition: string } {
  const motif = new RegExp(`create (or replace )?function public\\.${nom}\\(`, 'g')
  const fichiers = fichiersDuSchema()
  const ici = fichiers.findIndex((f) => MIGRATION.test(f.chemin))
  expect(ici, 'la migration contre_passation_sur_mouvement_fige dans l’export').toBeGreaterThan(0)
  const avant = fichiers.slice(0, ici).filter((f) => new RegExp(motif.source).test(f.texte))
  const { chemin, texte } = avant[avant.length - 1]
  const positions = [...texte.matchAll(motif)].map((m) => m.index as number)
  const debut = positions[positions.length - 1]
  return { chemin, definition: texte.slice(debut, texte.indexOf('$$;', debut)) }
}

// Le fichier de l'export qui porte la DERNIÈRE définition d'une fonction : celle que la base exécutera.
function fichierDeLaDerniereDefinition(nom: string): string {
  const motif = new RegExp(`create (or replace )?function public\\.${nom}\\(`)
  const fichiers = fichiersDuSchema().filter((f) => motif.test(f.texte))
  return fichiers[fichiers.length - 1]?.chemin ?? ''
}

// La migration POSTÉRIEURE qui reprend la garde — la caisse, étape C6 : `especes_sans_mouvement`, préparée — et en portera
// la dernière définition le jour où elle entrera dans l'export ; especesSansMouvement.test.ts confronte la sienne à
// celle-ci. Ce garde-ci confronte donc la définition que CETTE migration pose, où que soit la dernière.
const REPRISE_DEPUIS = /\/\d{14}_especes_sans_mouvement\.sql$/

// Ce que cette migration a posé : la définition que son texte donne à la garde.
function definitionPosee(): string {
  const texte = texteDeLaMigration()
  const debut = texte.indexOf(`create or replace function public.${GARDE}(`)
  expect(debut).toBeGreaterThan(0)
  return texte.slice(debut, texte.indexOf('$$;', debut))
}

// Les deux règles de VF5H2-Q1 que les neuves suivent, et les neuves : leurs lignes de CODE au caractère près, précédées
// dans la garde de leurs lignes de commentaire (qui ne jugent rien). Chaque neuve : une condition, le verrou de la
// validation, puis la frontière.
const REGLE_DU_MOUVEMENT_DE_VF5H2_Q1 = [
  "    if not (tg_op = 'INSERT' and public.is_super_admin()) and exists (",
  '         select 1 from public.lignes_bancaires l',
  '          where l.id = v_ligne.ligne_bancaire_id and l.encaissements_de_factures) then',
  "      raise exception 'Un mouvement classé par ses encaissements ne se cite pas : ce qu''il justifie ne change plus — le cabinet retire d''abord ce classement.'",
  "        using errcode = '23514';",
  '    end if;',
]
const REGLE_DE_LA_CONTRE_PASSATION_DE_VF5H2_Q1 = [
  "      if new.ligne_bancaire_id is null and not public.is_super_admin() and exists (",
  '           select 1 from public.lignes_bancaires l',
  '            where l.id = v_cible.ligne_bancaire_id and l.encaissements_de_factures) then',
  "        raise exception 'Le mouvement de l''encaissement contre-passé est classé par ses encaissements : le cabinet retire d''abord ce classement.'",
  "          using errcode = '23514';",
  '      end if;',
]
const CLE_DE_LA_VALIDATION = "hashtextextended('jd.validation_exercice:' || p_dossier_id::text, 0)"
const VERROU = `perform pg_advisory_xact_lock_shared(${CLE_DE_LA_VALIDATION.replace('p_dossier_id', 'new.dossier_id')});`
const FRONTIERE = 'join public.exercices_valides v on v.dossier_id = l.dossier_id and l.date <= make_date(v.annee, 12, 31)'
const REGLE_DU_MOUVEMENT_FIGE = [
  '    if v_source is not true and exists (',
  '         select 1 from public.lignes_bancaires l',
  '          where l.id = v_ligne.ligne_bancaire_id and l.encaissements_de_factures) then',
  `      ${VERROU}`,
  '      if exists (select 1 from public.lignes_bancaires l',
  `                   ${FRONTIERE}`,
  '                  where l.id = v_ligne.ligne_bancaire_id) then',
  "        raise exception 'Un mouvement figé par la validation d''un exercice ne se cite plus : ce qu''il justifie ne change plus.'",
  "          using errcode = '23514';",
  '      end if;',
  '    end if;',
]
const REGLE_DE_LA_CONTRE_PASSATION_FIGEE = [
  '      if new.ligne_bancaire_id is null and exists (',
  '           select 1 from public.lignes_bancaires l',
  '            where l.id = v_cible.ligne_bancaire_id and l.encaissements_de_factures) then',
  `        ${VERROU}`,
  '        if exists (select 1 from public.lignes_bancaires l',
  `                     ${FRONTIERE}`,
  '                    where l.id = v_cible.ligne_bancaire_id) then',
  "          raise exception 'Le mouvement de l''encaissement contre-passé est figé par la validation d''un exercice : ce qu''il justifie ne change plus.'",
  "            using errcode = '23514';",
  '        end if;',
  '      end if;',
]
const NEUF_MOUVEMENT = "Un mouvement figé par la validation d'un exercice ne se cite plus : ce qu'il justifie ne change plus."
const NEUF_CONTRE_PASSATION = "Le mouvement de l'encaissement contre-passé est figé par la validation d'un exercice : ce qu'il justifie ne change plus."
const DE_VF5H2_Q1_MOUVEMENT = "Un mouvement classé par ses encaissements ne se cite pas : ce qu'il justifie ne change plus — le cabinet retire d'abord ce classement."
const DE_VF5H2_Q1_CONTRE_PASSATION = "Le mouvement de l'encaissement contre-passé est classé par ses encaissements : le cabinet retire d'abord ce classement."

// Où commence une règle dans les lignes d'une définition : la première de ses lignes de code, puis, en remontant, ses
// lignes de commentaire à la même indentation. Rend [début, fin) ; null si le code n'y est pas une fois, exactement.
function bornes(lignes: string[], code: string[]): [number, number] | null {
  const departs = lignes.map((_, i) => i).filter((i) => code.every((l, k) => lignes[i + k] === l))
  if (departs.length !== 1) return null
  const retrait = code[0].match(/^ */)?.[0] ?? ''
  let debut = departs[0]
  while (debut > 0 && lignes[debut - 1].startsWith(`${retrait}-- `)) debut--
  return [debut, departs[0] + code.length]
}

// La définition sans les deux règles insérées ; null si l'une n'y est pas exactement une fois.
function sansLesRegles(definition: string): string | null {
  const lignes = definition.split('\n')
  const a = bornes(lignes, REGLE_DU_MOUVEMENT_FIGE)
  const b = bornes(lignes, REGLE_DE_LA_CONTRE_PASSATION_FIGEE)
  if (!a || !b) return null
  return lignes.filter((_, i) => !((i >= a[0] && i < a[1]) || (i >= b[0] && i < b[1]))).join('\n')
}

describe('la migration contre_passation_sur_mouvement_fige reprend la garde des encaissements, et n’y fait qu’insérer deux règles', () => {
  it('sa garde de tête exige, avant toute définition, le corps qu’insertion_des_encaissements a posé, celui de l’export', () => {
    const texte = texteDeLaMigration()
    expect(texte).not.toBe('')
    const premiereDefinition = texte.indexOf('create or replace function')
    const hier = avantLaMigration(GARDE)
    expect(hier.chemin).toMatch(/\/20261026150044_insertion_des_encaissements\.sql$/)
    expect(md5(corps(hier.definition))).toBe('922c8559fd54ddfc8f8a82ab0402c18e')
    expect(texte.indexOf("<> '922c8559fd54ddfc8f8a82ab0402c18e' then")).toBeGreaterThan(0)
    expect(texte.indexOf("<> '922c8559fd54ddfc8f8a82ab0402c18e' then")).toBeLessThan(premiereDefinition)
    // Le corps lu en base, les retours chariot d'un collage écartés ; une fonction absente refuse aussi.
    expect(texte).toContain("if to_regprocedure('public.garder_encaissement_facture()') is null")
    expect(texte).toContain("where p.oid = to_regprocedure('public.garder_encaissement_facture()')), chr(13), ''))")
  })

  it('la garde qu’elle pose : celle d’insertion_des_encaissements au caractère près, deux règles en plus ; la dernière, ou reprise depuis', () => {
    const derniere = fichierDeLaDerniereDefinition(GARDE)
    expect(MIGRATION.test(derniere) || REPRISE_DEPUIS.test(derniere), derniere).toBe(true)
    expect(sansLesRegles(definitionPosee())).toBe(avantLaMigration(GARDE).definition)
    // Tant qu'elle est la dernière, la base exécute ce qu'elle pose.
    if (MIGRATION.test(derniere)) expect(derniereDefinitionSql(GARDE)).toBe(definitionPosee())
  })

  it('chacune suit la règle de VF5H2-Q1 de son bloc : le mouvement cité, puis l’annulation, avant le `return`', () => {
    const lignes = definitionPosee().split('\n')
    const [, finA] = bornes(lignes, REGLE_DU_MOUVEMENT_DE_VF5H2_Q1) as [number, number]
    const [debutA, finNeuveA] = bornes(lignes, REGLE_DU_MOUVEMENT_FIGE) as [number, number]
    const [, finB] = bornes(lignes, REGLE_DE_LA_CONTRE_PASSATION_DE_VF5H2_Q1) as [number, number]
    const [debutB, finNeuveB] = bornes(lignes, REGLE_DE_LA_CONTRE_PASSATION_FIGEE) as [number, number]
    // Le mouvement cité : à la fin de son bloc, que la garde ne joue qu'à l'insertion et au rattachement.
    expect(debutA).toBe(finA)
    expect(lignes[debutA]).toMatch(/^ {4}-- Ni le super-administrateur, /)
    expect(lignes[finNeuveA]).toBe('  end if;')
    // L'annulation : à la fin de son bloc, avant le `return` de l'insertion.
    expect(debutB).toBe(finB)
    expect(lignes[debutB]).toMatch(/^ {6}-- Ni le super-administrateur, /)
    expect(lignes[finNeuveB]).toBe('    end if;')
    expect(lignes[finNeuveB + 1]).toBe('    return new;')
    const sql = lignes.join('\n')
    expect(sql.indexOf(REGLE_DU_MOUVEMENT_FIGE[0])).toBeGreaterThan(sql.indexOf('  if v_ligne.ligne_bancaire_id is not null then'))
    expect(sql.indexOf(REGLE_DE_LA_CONTRE_PASSATION_FIGEE[0]))
      .toBeGreaterThan(sql.indexOf("  if tg_op = 'INSERT' then\n    if new.annule_id is not null then\n"))
    expect(debutA).toBeLessThan(debutB)
  })

  it('elles ne jugent que ce que les règles de VF5H2-Q1 laissent passer : le super-administrateur, à l’insertion', () => {
    // L'annulation : la condition de VF5H2-Q1, sans son exception.
    expect(REGLE_DE_LA_CONTRE_PASSATION_FIGEE[0]).toBe(REGLE_DE_LA_CONTRE_PASSATION_DE_VF5H2_Q1[0].replace(' and not public.is_super_admin()', ''))
    expect(REGLE_DE_LA_CONTRE_PASSATION_FIGEE.slice(1, 3)).toEqual(REGLE_DE_LA_CONTRE_PASSATION_DE_VF5H2_Q1.slice(1, 3))
    // Le mouvement cité : celui que la règle de VF5H2-Q1 juge, pour une facture qui n'est pas source — `is not true`, du
    // côté fermé ; `v_source` est la facture de l'encaissement, lue à l'insertion.
    expect(REGLE_DU_MOUVEMENT_FIGE.slice(1, 3)).toEqual(REGLE_DU_MOUVEMENT_DE_VF5H2_Q1.slice(1, 3))
    const sql = definitionPosee()
    expect(sql).toContain("  if tg_op = 'INSERT' then\n    select f.source_de_la_vente into v_source from public.factures_emises f\n     where f.id = new.facture_id")
    // Aucune exception : ni le super-administrateur, ni un réglage de session.
    expect([...REGLE_DU_MOUVEMENT_FIGE, ...REGLE_DE_LA_CONTRE_PASSATION_FIGEE].join('\n')).not.toMatch(/is_super_admin|current_setting/)
  })

  it('pour une facture source, la garde de la frontière refuse déjà, à tous, un mouvement figé cité ; elle rend la main sur une autre', () => {
    const frontiere = derniereDefinitionSql('garder_frontiere_des_encaissements')
    expect(frontiere).toContain("  if not coalesce(v_source, false) then\n    return public.retour_declencheur(tg_op, old, new);\n  end if;")
    expect(frontiere).toContain("raise exception '% : ce mouvement ne se cite plus.'")
    expect(frontiere).not.toMatch(/is_super_admin/)
  })

  it('le verrou est celui de la validation, écrit en ligne, avant la frontière ; la frontière, celle de `frontiere_validation`', () => {
    // La clé de `cle_validation`, que la validation prend en exclusif ; écrite en ligne parce que l'appelant ne
    // l'exécute pas (la garde n'est pas `security definer`).
    expect(derniereDefinitionSql('cle_validation')).toContain(`  select ${CLE_DE_LA_VALIDATION}\n`)
    expect(derniereDefinitionSql('valider_exercice')).toContain('perform pg_advisory_xact_lock(public.cle_validation(p_dossier_id));')
    const export_ = fichiersDuSchema().map((f) => f.texte).join('\n')
    expect(export_).toContain('revoke execute on function public.cle_validation(uuid) from public, anon, authenticated;')
    expect(export_).toContain('revoke execute on function public.frontiere_validation(uuid) from public, anon, authenticated;')
    expect(export_).not.toMatch(/grant execute on function public\.(cle_validation|frontiere_validation)\(/)
    const demain = definitionPosee()
    expect(demain).not.toMatch(/security definer/i)
    for (const regle of [REGLE_DU_MOUVEMENT_FIGE, REGLE_DE_LA_CONTRE_PASSATION_FIGEE]) {
      const debut = demain.indexOf(regle.join('\n'))
      expect(debut).toBeGreaterThan(0)
      expect(demain.indexOf(VERROU, debut)).toBeLessThan(demain.indexOf(FRONTIERE, debut))
    }
    expect(demain.split(VERROU)).toHaveLength(3)
    // La frontière : le 31 décembre du dernier exercice validé du dossier. Un mouvement daté au plus tard d'un
    // 31 décembre validé l'est au plus tard du dernier : la même date que `frontiere_validation`, sans la fonction.
    expect(derniereDefinitionSql('frontiere_validation'))
      .toContain('select make_date(max(annee), 12, 31) from public.exercices_valides where dossier_id = p_dossier_id')
  })

  it('les refus : deux de plus, chacun après celui de VF5H2-Q1 de son bloc, en 23514 — rien d’autre ne bouge', () => {
    const hier = avantLaMigration(GARDE).definition
    const demain = definitionPosee()
    const messages = messagesSql(demain)
    const i = messages.indexOf(NEUF_MOUVEMENT)
    const j = messages.indexOf(NEUF_CONTRE_PASSATION)
    expect(messages.filter((m) => m === NEUF_MOUVEMENT)).toHaveLength(1)
    expect(messages.filter((m) => m === NEUF_CONTRE_PASSATION)).toHaveLength(1)
    expect(messages.toSpliced(j, 1).toSpliced(i, 1)).toEqual(messagesSql(hier))
    expect(codesSql(demain).toSpliced(j, 1).toSpliced(i, 1)).toEqual(codesSql(hier))
    expect([codesSql(demain)[i], codesSql(demain)[j]]).toEqual(['23514', '23514'])
    expect(messages[i - 1]).toBe(DE_VF5H2_Q1_MOUVEMENT)
    expect(messages[i + 1]).toBe('Une annulation contre-passe un encaissement de la même facture.')
    expect(messages[j - 1]).toBe(DE_VF5H2_Q1_CONTRE_PASSATION)
    expect(messages[j + 1]).toBe("Un encaissement déclaré ne se retire pas : il se contre-passe, et l'annulation se déclare à son tour.")
  })

  it('le texte : une seule définition, ni droits rejoués ni objet retiré, aucune barre oblique inverse ni retour chariot', () => {
    const texte = texteDeLaMigration()
    expect(texte.match(/create (or replace )?function/g)).toHaveLength(1)
    expect(texte).toContain('create or replace function public.garder_encaissement_facture() returns trigger')
    expect(texte).not.toMatch(/\b(grant|revoke|drop|truncate|alter)\b/i)
    expect(texte).not.toMatch(/\b(create|drop)\s+(table|policy|trigger|index|view)\b/i)
    expect(texte).not.toMatch(/\bcomment on\b/i)
    expect(texte).not.toMatch(/\bdelete from\b/i)
    // Le mot « delete » n'y vient que de la garde reprise, qui nomme l'opération qu'elle refuse, comme hier.
    const hier = avantLaMigration(GARDE).definition
    expect(texte.match(/delete/gi)?.length ?? 0).toBe(hier.match(/delete/gi)?.length ?? 0)
    expect(texte).not.toContain('\\')
    expect(texte).not.toContain('\r')
  })

  it('vire au rouge sur une dérive plantée : un mot de la garde hors des règles, une règle changée', () => {
    const demain = definitionPosee()
    const hier = avantLaMigration(GARDE).definition
    const mot = demain.replace("'Un encaissement ne se supprime pas", "'Un encaissement ne se retire pas")
    expect(mot).not.toBe(demain)
    expect(sansLesRegles(mot)).not.toBe(hier)
    const frontiere = demain.replace('l.date <= make_date(v.annee, 12, 31)', 'l.date < make_date(v.annee, 12, 31)')
    expect(frontiere).not.toBe(demain)
    expect(sansLesRegles(frontiere)).toBeNull()
    const source = demain.replace('    if v_source is not true and exists (', '    if exists (')
    expect(source).not.toBe(demain)
    expect(sansLesRegles(source)).toBeNull()
  })
})

describe('aucune fonction n’atteint ces refus, et la restauration les passe : elle réinsère les exercices validés en dernier', () => {
  it('enregistrer refuse avant d’insérer, pour tous, le mouvement classé par ses encaissements (rangs 17 et 18)', () => {
    const sql = derniereDefinitionSql('enregistrer_encaissement')
    const insertion = sql.indexOf('insert into public.encaissements_factures (')
    const rang18 = sql.indexOf('if v_facture.source_de_la_vente is not true and v_mouvement.encaissements_de_factures then')
    expect(rang18).toBeGreaterThan(0)
    expect(insertion).toBeGreaterThan(rang18)
    expect(sql).not.toContain('is_super_admin')
    expect(REFUS_ENREGISTREMENT.map((r) => r.cle).slice(16, 18)).toEqual(['mouvement_classe', 'mouvement_classe_facture_d_avant'])
  })

  it('contre-passer refuse avant d’insérer, pour tous, la contre-passation sans débit d’un encaissement au mouvement classé', () => {
    const sql = derniereDefinitionSql('annuler_encaissement')
    const insertion = sql.indexOf('insert into public.encaissements_factures (')
    const rangs20et21 = [...sql.matchAll(/select l\.encaissements_de_factures into v_classe from public\.lignes_bancaires l\n\s+where l\.id = v_encaissement\.ligne_bancaire_id for share;\n\s+if v_classe then\n\s+raise exception/g)]
    expect(rangs20et21).toHaveLength(2)
    expect(insertion).toBeGreaterThan(rangs20et21[1].index as number)
    // Sans exception du super-administrateur : la fonction ne le nomme pas.
    expect(sql).not.toContain('is_super_admin')
    expect(REFUS_CONTRE_PASSATION.map((r) => r.cle).slice(19, 21)).toEqual(['mouvement_encaissement_classe', 'mouvement_encaissement_classe_facture_d_avant'])
  })

  it('l’ordre : les mouvements, puis les encaissements — leurs contre-passations par vagues, à leur rang —, les exercices validés en dernier', () => {
    for (const ordre of [ORDRE_RESTAURATION_PREVU, ORDRE_RESTAURATION]) {
      expect(ordre.indexOf('lignes_bancaires')).toBeGreaterThan(-1)
      expect(ordre.indexOf('lignes_bancaires')).toBeLessThan(ordre.indexOf('encaissements_factures'))
      expect(ordre.indexOf('encaissements_factures')).toBeLessThan(ordre.indexOf('exercices_valides'))
      expect(ordre[ordre.length - 1]).toBe('exercices_valides')
    }
    // Une contre-passation part dans une vague de sa table, à son rang ; la seconde passe, qui suit les exercices validés,
    // ne fait que des mises à jour (le test d'après), et jamais sur les encaissements : aucun ne s'insère après eux.
    expect(TABLES_AUTO_REFERENCEES_PAR_VAGUES).toContainEqual({ table: 'encaissements_factures', colonne: 'annule_id' })
    expect(TABLES_AUTO_REFERENCEES.map((t) => t.table)).not.toContain('encaissements_factures')
  })

  it('la restauration n’écrit que dans un dossier qui n’existe pas : refusée avant sa première écriture', () => {
    // Le refus est joué par sauvegardeDonnees.test.ts ; ici, sa place : avant la première écriture des tables.
    const source = readFileSync(new URL('./sauvegardeDonnees.ts', import.meta.url), 'utf8')
    const refus = source.indexOf("existe déjà dans cette base. La restauration n'écrase jamais.")
    const leve = source.indexOf('if (refus.length > 0) {', refus)
    const ecrit = source.indexOf('await ecrireParLots(etape.table, aEcrire)')
    expect(refus).toBeGreaterThan(0)
    expect(leve).toBeGreaterThan(refus)
    expect(ecrit).toBeGreaterThan(leve)
    // La seconde passe, après toutes les tables : une mise à jour par lien, aucune insertion.
    const seconde = source.indexOf('for (const passe of plan.secondePasse) {')
    const finSeconde = source.indexOf('\n  }\n', seconde)
    expect(seconde).toBeGreaterThan(ecrit)
    expect(source.slice(seconde, finSeconde)).toContain('.update({ [passe.colonne]: valeur })')
    expect(source.slice(seconde, finSeconde)).not.toContain('.insert(')
    expect(readFileSync(new URL('./sauvegardeDonnees.test.ts', import.meta.url), 'utf8'))
      .toContain('await expect(restaurerSauvegarde(s)).rejects.toThrow(/existe déjà/)')
  })

  it('l’essai de restauration (`_ordre`, restauration.sql) réinsère dans cet ordre, les exercices validés au dernier rang', () => {
    const essai = readFileSync(new URL('../../supabase/essais/restauration.sql', import.meta.url), 'utf8')
    const bloc = essai.slice(essai.indexOf('insert into essai_restauration._ordre (rang, table_nom) values'))
    const rangs = new Map([...bloc.slice(0, bloc.indexOf(';')).matchAll(/\((\d+),'(\w+)'\)/g)].map((m) => [m[2], Number(m[1])]))
    expect(rangs.get('lignes_bancaires')).toBe(48)
    expect(rangs.get('encaissements_factures')).toBe(51)
    expect(rangs.get('exercices_valides')).toBe(Math.max(...rangs.values()))
    // Une table que la base porte s'insère juste AVANT les exercices validés, qui reculent d'un rang : jamais après.
    // restaurationEssai.test.ts confronte cet ordre, dans chacun de ses états, à ORDRE_RESTAURATION.
    const reculs = [...essai.matchAll(/update essai_restauration\._ordre set rang = rang \+ 1 where table_nom = '(\w+)';/g)]
    const insertions = [...essai.matchAll(/select o\.rang - 1, '\w+' from essai_restauration\._ordre o where o\.table_nom = '(\w+)';/g)]
    expect(reculs.length).toBeGreaterThan(3)
    expect(insertions).toHaveLength(reculs.length)
    expect([...reculs, ...insertions].every((m) => m[1] === 'exercices_valides')).toBe(true)
  })
})

describe('l’essai exige les refus neufs du super-administrateur et du rôle des Edge Functions, après le pas de la restauration', () => {
  const etapes = etapesDeLEssai()
  const refusNeufs = (modele: string, texte?: string) =>
    refusExigesParLEssai(texte).filter((e) => e.code === '23514' && correspondAuModele(modele, e.attendu))
  const etape = (numero: string) => etapes.find((e) => e.controle.startsWith(`${numero}. `))
  const rang = (numero: string) => etapes.findIndex((e) => e.controle.startsWith(`${numero}. `))
  const POSE_LA_CONTRE_PASSATION = "('{CP7}', '{R}', '{FR}', '2026-01-08', -7, 'cheque', null, '{ER7}', 'ESSAI')"
  const VALIDE = "insert into exercices_valides (dossier_id, annee, valide_le, valide_par, mode_comptable, nb_lignes, nb_ecritures, total_debit, total_credit, empreinte, declaration) values ('{R}', 2025,"
  const VALIDE_T = VALIDE.replace("('{R}', 2025,", "('{T}', 2026,")
  const CLASSE = 'classer_mouvement_par_encaissements('
  const ENC_FP_MV = "('{T}', '{FP}', '2026-03-16', 1, 'virement', '{MV}', null, null)"

  it('la contre-passation : le super-administrateur, et le rôle des Edge Functions sous sa session — 146f, 146g, 146i', () => {
    expect(refusNeufs(NEUF_CONTRE_PASSATION).map((e) => [e.controle.split('.')[0], e.profil])).toEqual([['146f', 'chef'], ['146g', 'service'], ['146i', 'chef']])
    expect(etape('146g')?.requete).toMatch(/^select set_config\('request\.jwt\.claims', json_build_object\('sub', '\{CHEF\}', 'role', 'authenticated'\)/)
    // Les autres butent d'abord sur la règle de VF5H2-Q1 : le propriétaire, sa session retirée avant la contre-passation.
    expect(etape('146h')).toMatchObject({ profil: 'postgres', code: '23514', attendu: DE_VF5H2_Q1_CONTRE_PASSATION })
    expect(etape('146h')?.requete).toContain(`select set_config('request.jwt.claims', '', true); `)
  })

  it('l’encaissement de la facture d’avant : le super-administrateur et le rôle des Edge Functions — 146k, 146l, 146o', () => {
    expect(refusNeufs(NEUF_MOUVEMENT).map((e) => [e.controle.split('.')[0], e.profil])).toEqual([['146k', 'chef'], ['146l', 'service'], ['146o', 'chef']])
    expect(etape('146l')?.requete).toMatch(/^select set_config\('request\.jwt\.claims', json_build_object\('sub', '\{CHEF\}', 'role', 'authenticated'\)/)
    expect(etape('146m')).toMatchObject({ profil: 'postgres', code: '23514', attendu: DE_VF5H2_Q1_MOUVEMENT })
    expect(etape('146m')?.requete).toContain(`select set_config('request.jwt.claims', '', true); `)
    for (const n of ['146k', '146l', '146m']) {
      const requete = etape(n)?.requete ?? ''
      expect(requete.indexOf(VALIDE_T), n).toBeGreaterThan(-1)
      expect(requete.indexOf(VALIDE_T), n).toBeLessThan(requete.indexOf(ENC_FP_MV))
    }
    // Au 31 décembre de l'exercice validé : MX, né classé par ses encaissements (la restauration), rapproché.
    expect(etape('146o')?.requete).toContain("('{MX}', '{T}', '2026-12-31', 'ESSAI', 1, 'rapprochee', true)")
    expect(etape('146o')?.requete).toContain("('{T}', '{FP}', '2026-12-31', 1, 'virement', '{MX}', null, null)")
    // Une facture source : la garde de la frontière, sous ses mots.
    expect(etape('146n')).toMatchObject({ profil: 'chef', code: '23514', attendu: "L'exercice 2026 est validé : un encaissement de cette facture ne s'y date plus." })
    expect(etape('146n')?.requete).toContain("('{T}', '{F1}', '2026-03-16', 1, 'virement', '{MV}', null, null)")
    // MV : le virement mixte du jeu, que le cabinet classe par ses encaissements avant ces contrôles.
    expect(etapes.findIndex((e) => e.genre === 'fait' && e.controle === '0. le jeu (VF5h2) : MV classé par ses encaissements')).toBeLessThan(rang('146k'))
  })

  it('pas la contre-passation qui cite un débit : 146j passe, sur le même mouvement figé', () => {
    expect(etape('146j')).toMatchObject({ profil: 'chef', code: 'OK' })
    const requete = etape('146j')?.requete ?? ''
    const cp = requete.indexOf("('{CP7}', '{R}', '{FR}', '2026-01-08', -7, 'cheque', '{MD7}', '{ER7}', 'ESSAI')")
    expect(cp).toBeGreaterThan(0)
    for (const avant of [CLASSE, VALIDE, "values ('{MD7}', '{R}', '2026-01-08', 'ESSAI', -7, 'non_rapprochee')"]) {
      expect(requete.indexOf(avant), avant).toBeGreaterThan(-1)
      expect(requete.indexOf(avant), avant).toBeLessThan(cp)
    }
  })

  it('chacun pose le mouvement, son encaissement, le classement et la validation AVANT la contre-passation, sans débit', () => {
    for (const n of ['146f', '146g', '146h']) {
      const requete = etape(n)?.requete ?? ''
      const cp = requete.lastIndexOf(POSE_LA_CONTRE_PASSATION)
      expect(cp, n).toBeGreaterThan(0)
      for (const avant of ["values ('{MR7}', '{R}', '2025-12-31', 'ESSAI', 7, 'non_rapprochee')", "('{ER7}', '{R}', '{FR}', '2025-12-31', 7, 'cheque', '{MR7}', null, null)", CLASSE, VALIDE]) {
        expect(requete.indexOf(avant), `${n} : ${avant}`).toBeGreaterThan(-1)
        expect(requete.indexOf(avant), `${n} : ${avant}`).toBeLessThan(cp)
      }
    }
  })

  it('les mutations mordent : l’exercice pas encore validé (l’ordre de la restauration), un autre mouvement, un autre dossier', () => {
    for (const n of ['198', '198b', '198c', '198d', '198e']) {
      expect(etape(n), n).toMatchObject({ profil: 'chef', code: 'OK' })
      expect(etape(n)?.controle, n).toContain('MUTATION')
    }
    expect(etape('198')?.requete).not.toContain('insert into exercices_valides')
    expect(etape('198')?.requete).toContain(CLASSE)
    expect(etape('198b')?.requete).toContain(VALIDE)
    expect(etape('198b')?.requete).not.toContain(CLASSE)
    // L'encaissement de la facture d'avant sur MV, 2026 pas encore validé : l'ordre de la restauration.
    expect(etape('198c')?.requete).toBe(`insert into encaissements_factures (dossier_id, facture_id, date_encaissement, montant, moyen, ligne_bancaire_id, annule_id, motif) values ${ENC_FP_MV}`)
    // M4, classé autrement, figé ; puis 2026 validé dans R, pas dans T.
    expect(etape('198d')?.requete).toContain(`${VALIDE_T}`)
    expect(etape('198d')?.requete).toContain("('{T}', '{FP}', '2026-03-04', 1, 'virement', '{M4}', null, null)")
    expect(etape('198e')?.requete).toContain(VALIDE.replace("('{R}', 2025,", "('{R}', 2026,"))
    expect(etape('198e')?.requete).not.toContain(VALIDE_T)
    expect(etape('198e')?.requete).toContain(ENC_FP_MV)
  })

  it('le pas où la restauration pose ses contre-passations sans mouvement passe avant la validation de 2025, et ces contrôles entre les deux', () => {
    const restauration = etapes.findIndex((e) => e.genre === 'fait' && e.controle.startsWith('0. le jeu (VF7a) : la restauration pose CP5 et CP6'))
    const validation = etapes.findIndex((e) => e.genre === 'jeu' && e.controle === "VF7a : l'exercice 2025 validé dans R")
    expect(etapes[restauration]).toMatchObject({ profil: 'chef', code: 'OK' })
    expect(etapes[restauration - 1].controle).toBe('0. le jeu (VF7a) : le cabinet classe MR4 par ER5')
    expect(restauration).toBeGreaterThan(0)
    expect(validation).toBeGreaterThan(restauration)
    for (const n of ['146f', '146g', '146h', '146i', '146j', '146k', '146l', '146m', '146n', '146o', '198', '198b', '198c', '198d', '198e']) {
      expect(rang(n), n).toBeGreaterThan(restauration)
      expect(rang(n), n).toBeLessThan(validation)
    }
  })

  it('vire au rouge sur une dérive plantée : un refus que l’essai n’exige plus', () => {
    const plante = TEXTE_ESSAI_VENTES_FACTUREES
      .replace("'IFG', $m$Le mouvement de l'encaissement contre-passé est figé", "'IFG', $m$Le mouvement de l'encaissement contre-passé est gelé")
      .replace("'IFC', $m$Un mouvement figé par la validation", "'IFC', $m$Un mouvement gelé par la validation")
    expect(plante).not.toBe(TEXTE_ESSAI_VENTES_FACTUREES)
    expect(refusNeufs(NEUF_CONTRE_PASSATION, plante)).toHaveLength(0)
    expect(refusNeufs(NEUF_MOUVEMENT, plante)).toHaveLength(0)
  })
})
