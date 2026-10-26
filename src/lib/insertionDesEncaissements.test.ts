import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { correspondAuModele, etapesDeLEssai, refusExigesParLEssai, TEXTE_ESSAI_VENTES_FACTUREES } from '../test/essaiVentesFacturees'
import { codesSql, messagesSql } from '../test/raiseSql'
import { derniereDefinitionSql, fichiersDuSchema } from '../test/schema'
import { REFUS_CONTRE_PASSATION, REFUS_ENREGISTREMENT } from './encaissementsFactures'

// L'INSERTION DIRECTE D'UN ENCAISSEMENT SUR UN MOUVEMENT CLASSÉ PAR SES ENCAISSEMENTS (chantier EC-Q3, ligne 28.65 ;
// VF5H2-Q1, « Oui, la fermer » ; VF5H2Q1-Q1, écrite sur la recommandation le 26/10/2026 : la même règle au rattachement ;
// migration `insertion_des_encaissements`, PRÉPARÉE sous une version provisoire, pas appliquée). La migration reprend la
// garde des encaissements (`garder_encaissement_facture`) telle que la migration `registre_virement_mixte` l'a laissée, et
// n'y fait qu'INSÉRER deux règles : un mouvement classé par ses encaissements ne se cite pas — à l'insertion, pour qui n'est
// pas le super-administrateur, et au rattachement, pour tous (la condition de la règle de la facture source) ; la
// contre-passation sans mouvement d'un encaissement qui cite un tel mouvement ne s'insère pas, pour qui n'est pas le
// super-administrateur. Ce garde la confronte à l'export, au caractère près ; dit qu'aucune fonction n'atteint ces refus —
// les deux qui insèrent un encaissement et celle qui le rattache refusent avant d'écrire, sous leurs mots, que le module
// redit déjà —, si bien qu'aucun module ne redit cette garde ; et confronte l'essai (supabase/essais/ventesFacturees.sql :
// 64b, 68 à 69d, 110b, 143c, 143e à 143g, et les mutations 192 à 197), qui exige chaque refus neuf de la base par le
// propriétaire ET par le rôle des Edge Functions, l'admet à l'insertion pour le super-administrateur (la restauration), et
// l'exige au rattachement sous sa session aussi. Récit : HISTORIQUE.md, « L'INSERTION DIRECTE D'UN ENCAISSEMENT SUR UN
// MOUVEMENT CLASSÉ PAR SES ENCAISSEMENTS ». Données FICTIVES.

const MIGRATION = /\/\d{14}_insertion_des_encaissements\.sql$/
const texteDeLaMigration = () => fichiersDuSchema().find((f) => MIGRATION.test(f.chemin))?.texte ?? ''
const corps = (definition: string) => definition.slice(definition.indexOf('as $$') + 'as $$'.length)
const md5 = (texte: string) => createHash('md5').update(texte, 'utf8').digest('hex')

// La définition d'une fonction telle que la dernière migration AVANT celle-ci la laisse — celle que la production
// exécute aujourd'hui —, et le fichier qui la porte.
function avantLaMigration(nom: string): { chemin: string; definition: string } {
  const motif = new RegExp(`create (or replace )?function public\\.${nom}\\(`, 'g')
  const fichiers = fichiersDuSchema()
  const ici = fichiers.findIndex((f) => MIGRATION.test(f.chemin))
  expect(ici, 'la migration insertion_des_encaissements dans l’export').toBeGreaterThan(0)
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

// Les deux règles neuves, leurs lignes de CODE au caractère près ; chacune précédée, dans la garde, de ses lignes de
// commentaire (qui ne jugent rien). La première prend la condition de la règle de la facture source (CONDITION_DE_LA_SOURCE) :
// à l'insertion, le super-administrateur la passe (la restauration) ; au rattachement, personne.
const CONDITION_DE_LA_SOURCE = "not (tg_op = 'INSERT' and public.is_super_admin())"
const REGLE_DU_MOUVEMENT = [
  `    if ${CONDITION_DE_LA_SOURCE} and exists (`,
  '         select 1 from public.lignes_bancaires l',
  '          where l.id = v_ligne.ligne_bancaire_id and l.encaissements_de_factures) then',
  "      raise exception 'Un mouvement classé par ses encaissements ne se cite pas : ce qu''il justifie ne change plus — le cabinet retire d''abord ce classement.'",
  "        using errcode = '23514';",
  '    end if;',
]
const REGLE_DE_LA_CONTRE_PASSATION = [
  "      if new.ligne_bancaire_id is null and not public.is_super_admin() and exists (",
  '           select 1 from public.lignes_bancaires l',
  '            where l.id = v_cible.ligne_bancaire_id and l.encaissements_de_factures) then',
  "        raise exception 'Le mouvement de l''encaissement contre-passé est classé par ses encaissements : le cabinet retire d''abord ce classement.'",
  "          using errcode = '23514';",
  '      end if;',
]
const NEUF_MOUVEMENT = "Un mouvement classé par ses encaissements ne se cite pas : ce qu'il justifie ne change plus — le cabinet retire d'abord ce classement."
const NEUF_CONTRE_PASSATION = "Le mouvement de l'encaissement contre-passé est classé par ses encaissements : le cabinet retire d'abord ce classement."

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
  const a = bornes(lignes, REGLE_DU_MOUVEMENT)
  const b = bornes(lignes, REGLE_DE_LA_CONTRE_PASSATION)
  if (!a || !b) return null
  return lignes.filter((_, i) => !((i >= a[0] && i < a[1]) || (i >= b[0] && i < b[1]))).join('\n')
}

describe('la migration insertion_des_encaissements reprend la garde des encaissements, et n’y fait qu’insérer deux règles', () => {
  it('sa garde de tête exige, avant toute définition, le corps que registre_virement_mixte a posé, celui de l’export', () => {
    const texte = texteDeLaMigration()
    expect(texte).not.toBe('')
    const premiereDefinition = texte.indexOf('create or replace function')
    const hier = avantLaMigration('garder_encaissement_facture')
    expect(hier.chemin).toMatch(/\/20261026000145_registre_virement_mixte\.sql$/)
    expect(md5(corps(hier.definition))).toBe('21c11ef2275292a9c70570eed2aebd9e')
    expect(texte.indexOf("<> '21c11ef2275292a9c70570eed2aebd9e' then")).toBeGreaterThan(0)
    expect(texte.indexOf("<> '21c11ef2275292a9c70570eed2aebd9e' then")).toBeLessThan(premiereDefinition)
    // Le corps lu en base, les retours chariot d'un collage écartés ; une fonction absente refuse aussi.
    expect(texte).toContain("if to_regprocedure('public.garder_encaissement_facture()') is null")
    expect(texte).toContain("where p.oid = to_regprocedure('public.garder_encaissement_facture()')), chr(13), ''))")
  })

  it('la garde est sa dernière définition : celle de registre_virement_mixte au caractère près, deux règles en plus', () => {
    expect(fichierDeLaDerniereDefinition('garder_encaissement_facture')).toMatch(MIGRATION)
    const demain = derniereDefinitionSql('garder_encaissement_facture')
    expect(sansLesRegles(demain)).toBe(avantLaMigration('garder_encaissement_facture').definition)
  })

  it('chacune après les règles d’hier de son bloc : le mouvement cité, puis la contre-passation', () => {
    const lignes = derniereDefinitionSql('garder_encaissement_facture').split('\n')
    const [debutA, finA] = bornes(lignes, REGLE_DU_MOUVEMENT) as [number, number]
    const [debutB, finB] = bornes(lignes, REGLE_DE_LA_CONTRE_PASSATION) as [number, number]
    // Le mouvement cité : après la règle de la facture source, à la fin du bloc du mouvement cité.
    expect(lignes[debutA - 3]).toContain("raise exception 'Un mouvement déjà classé ne se cite pas")
    expect(lignes[debutA - 1]).toBe('    end if;')
    expect(lignes[finA]).toBe('  end if;')
    // La contre-passation : après la dernière règle d'hier de l'annulation, à la fin de son bloc, avant le `return`.
    expect(lignes[debutB - 2]).toContain("raise exception 'Un encaissement retiré ne s''annule pas")
    expect(lignes[finB]).toBe('    end if;')
    expect(lignes[finB + 1]).toBe('    return new;')
    expect(debutA).toBeLessThan(debutB)
  })

  it('la première juge à l’insertion comme au rattachement, sous la condition de la règle de la facture source', () => {
    const sql = derniereDefinitionSql('garder_encaissement_facture')
    // La règle de la facture source, juste avant, porte la même condition (VF5H2Q1-Q1) : personne ne la passe au
    // rattachement, le super-administrateur la passe à l'insertion.
    expect(sql).toContain(`    if coalesce(v_source, false) and ${CONDITION_DE_LA_SOURCE} and exists (`)
    // Le bloc du mouvement cité ne lit que `v_ligne`, que la garde remplit à l'insertion, et au rattachement sous son
    // réglage seulement : une autre modification ne l'atteint pas.
    expect(sql.match(/v_ligne := new;/g)).toHaveLength(2)
    const insertion = sql.indexOf("  if tg_op = 'INSERT' then\n    select f.source_de_la_vente into v_source")
    const rattachement = sql.indexOf('    if v_rattachement then')
    const bloc = sql.indexOf('  if v_ligne.ligne_bancaire_id is not null then')
    expect(insertion).toBeGreaterThan(0)
    expect(sql.indexOf('v_ligne := new;', insertion)).toBeLessThan(rattachement)
    expect(sql.indexOf('v_ligne := new;', rattachement)).toBeLessThan(bloc)
    expect(sql.indexOf(REGLE_DU_MOUVEMENT[0])).toBeGreaterThan(bloc)
    // La contre-passation sans mouvement, elle, ne naît qu'à l'insertion.
    expect(REGLE_DE_LA_CONTRE_PASSATION[0]).toBe('      if new.ligne_bancaire_id is null and not public.is_super_admin() and exists (')
  })

  it('les refus : deux de plus, à leur place, en 23514 — rien d’autre ne bouge', () => {
    const hier = avantLaMigration('garder_encaissement_facture').definition
    const demain = derniereDefinitionSql('garder_encaissement_facture')
    const messages = messagesSql(demain)
    const i = messages.indexOf(NEUF_MOUVEMENT)
    const j = messages.indexOf(NEUF_CONTRE_PASSATION)
    expect(messages.filter((m) => m === NEUF_MOUVEMENT)).toHaveLength(1)
    expect(messages.filter((m) => m === NEUF_CONTRE_PASSATION)).toHaveLength(1)
    expect(messages.toSpliced(j, 1).toSpliced(i, 1)).toEqual(messagesSql(hier))
    expect(codesSql(demain).toSpliced(j, 1).toSpliced(i, 1)).toEqual(codesSql(hier))
    expect([codesSql(demain)[i], codesSql(demain)[j]]).toEqual(['23514', '23514'])
    expect(messages[i - 1]).toBe("Un mouvement déjà classé ne se cite pas : l'encaissement d'une facture source de sa vente ne cite qu'un mouvement que rien d'autre ne classe.")
    expect(messages[i + 1]).toBe('Une annulation contre-passe un encaissement de la même facture.')
    expect(messages[j - 1]).toBe("Un encaissement retiré ne s'annule pas : il n'a jamais été déclaré.")
    expect(messages[j + 1]).toBe("Un encaissement déclaré ne se retire pas : il se contre-passe, et l'annulation se déclare à son tour.")
    // La contre-passation, sous les mots du rang 21 d'`annuler_encaissement` (le module les redit déjà).
    const rang21 = REFUS_CONTRE_PASSATION.find((r) => r.cle === 'mouvement_encaissement_classe_facture_d_avant')
    expect(rang21?.modele).toBe(NEUF_CONTRE_PASSATION)
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
    const hier = avantLaMigration('garder_encaissement_facture').definition
    expect(texte.match(/delete/gi)?.length ?? 0).toBe(hier.match(/delete/gi)?.length ?? 0)
    expect(texte).not.toContain('\\')
    expect(texte).not.toContain('\r')
  })
})

describe('aucune fonction n’atteint ces refus : seule une écriture directe les rencontre', () => {
  // Un scanner, pas une liste tenue à la main : la dernière définition de chaque fonction de l'export.
  const noms = [...new Set(fichiersDuSchema().flatMap((f) => [...f.texte.matchAll(/create (?:or replace )?function public\.(\w+)\(/g)].map((m) => m[1])))]
  // Chaque dernière définition lue une fois : la relire par test coûterait plusieurs secondes.
  const definitions = new Map(noms.map((n) => [n, derniereDefinitionSql(n)]))
  const inserent = noms.filter((n) => /insert\s+into\s+(?:public\.)?encaissements_factures\s*\(/i.test(definitions.get(n) ?? '')).sort()

  it('deux fonctions insèrent un encaissement : enregistrer et contre-passer', () => {
    expect(noms.length).toBeGreaterThan(150)
    expect(inserent).toEqual(['annuler_encaissement', 'enregistrer_encaissement'])
  })

  it('enregistrer refuse avant d’insérer un mouvement classé par ses encaissements : rangs 17 et 18', () => {
    const sql = derniereDefinitionSql('enregistrer_encaissement')
    const insertion = sql.indexOf('insert into public.encaissements_factures (')
    const rang17 = sql.indexOf('if v_facture.source_de_la_vente and not public.mouvement_libre(v_mouvement) then')
    const rang18 = sql.indexOf('if v_facture.source_de_la_vente is not true and v_mouvement.encaissements_de_factures then')
    expect(rang17).toBeGreaterThan(0)
    expect(rang18).toBeGreaterThan(rang17)
    expect(insertion).toBeGreaterThan(rang18)
    // Un mouvement classé par ses encaissements n'est pas libre.
    expect(derniereDefinitionSql('mouvement_libre')).toContain('nullif(p_ligne.encaissements_de_factures, false)')
    expect(REFUS_ENREGISTREMENT.map((r) => r.cle).slice(16, 18)).toEqual(['mouvement_classe', 'mouvement_classe_facture_d_avant'])
  })

  it('rattacher refuse avant d’écrire un mouvement qui n’est pas libre (11), lu sous son verrou ; seule elle pose le réglage', () => {
    const sql = derniereDefinitionSql('rattacher_mouvement_encaissement')
    const lecture = sql.indexOf('select * into v_mouvement from public.lignes_bancaires l\n   where l.id = p_ligne_bancaire_id and l.dossier_id = p_dossier_id\n   for no key update;')
    const rang11 = sql.indexOf('if not public.mouvement_libre(v_mouvement) then')
    const reglage = sql.indexOf("perform set_config('jd.rattachement_encaissement', p_encaissement_id::text, true);")
    const ecriture = sql.indexOf('update public.encaissements_factures\n     set ligne_bancaire_id = p_ligne_bancaire_id')
    expect(lecture).toBeGreaterThan(0)
    expect(rang11).toBeGreaterThan(lecture)
    expect(reglage).toBeGreaterThan(rang11)
    expect(ecriture).toBeGreaterThan(reglage)
    // Un mouvement classé par ses encaissements n'est pas libre : la fonction le refuse sous ses mots, et la garde ne le
    // voit jamais ; le verrou du mouvement tient jusqu'à l'écriture (un classement concurrent attend).
    expect(derniereDefinitionSql('mouvement_libre')).toContain('nullif(p_ligne.encaissements_de_factures, false)')
    // Seule cette fonction pose le réglage du rattachement ; la garde le lit.
    const posent = noms.filter((n) => /set_config\('jd\.rattachement_encaissement', p_\w+::text, true\)/.test(definitions.get(n) ?? ''))
    const lisent = noms.filter((n) => (definitions.get(n) ?? '').includes("current_setting('jd.rattachement_encaissement', true)"))
    expect(posent).toEqual(['rattacher_mouvement_encaissement'])
    expect(lisent).toEqual(['garder_encaissement_facture'])
  })

  it('contre-passer refuse avant d’insérer : le débit cité qui n’est pas libre (18), le mouvement classé sans débit (20, 21)', () => {
    const sql = derniereDefinitionSql('annuler_encaissement')
    const insertion = sql.indexOf('insert into public.encaissements_factures (')
    const rang18 = sql.indexOf('if not public.mouvement_libre(v_mouvement) then')
    const rangs20et21 = [...sql.matchAll(/select l\.encaissements_de_factures into v_classe from public\.lignes_bancaires l\n\s+where l\.id = v_encaissement\.ligne_bancaire_id for share;\n\s+if v_classe then/g)]
    expect(rang18).toBeGreaterThan(0)
    expect(rangs20et21).toHaveLength(2)
    expect(insertion).toBeGreaterThan(rangs20et21[1].index as number)
    expect(REFUS_CONTRE_PASSATION.map((r) => r.cle).slice(17, 21))
      .toEqual(['mouvement_classe', 'mouvement_depasse', 'mouvement_encaissement_classe', 'mouvement_encaissement_classe_facture_d_avant'])
  })
})

describe('l’essai exige chaque refus neuf de la base, sans les fonctions, et l’admet pour le super-administrateur', () => {
  const etapes = etapesDeLEssai()
  const refusParLaGarde = (modele: string) =>
    refusExigesParLEssai().filter((e) => e.code === '23514' && correspondAuModele(modele, e.attendu))
  const profils = (modele: string) => [...new Set(refusParLaGarde(modele).map((e) => e.profil))].sort()
  const etape = (numero: string) => etapes.find((e) => e.controle.startsWith(`${numero}. `))

  it('le mouvement cité : par le propriétaire et par le rôle des Edge Functions, pour toute facture, pour un débit, au rattachement', () => {
    expect(profils(NEUF_MOUVEMENT)).toEqual(['postgres', 'service'])
    expect(refusParLaGarde(NEUF_MOUVEMENT).map((e) => e.controle.split('.')[0]).sort())
      .toEqual(['64b', '68', '68b', '68c', '68d', '68e', '68g', '68i', '68j'])
    // Au rattachement (VF5H2Q1-Q1), sous son réglage : le rôle des Edge Functions, le propriétaire, et la session du
    // super-administrateur, que la restauration n'excuse pas ici.
    for (const n of ['68g', '68i', '68j']) {
      expect(etape(n)?.requete, n).toContain("set_config('jd.rattachement_encaissement', '{ES}', true); update encaissements_factures set ligne_bancaire_id = '{M1}'")
    }
    expect(etape('68j')?.requete).toMatch(/^select set_config\('request\.jwt\.claims', json_build_object\('sub', '\{CHEF\}'/)
  })

  it('la contre-passation sans mouvement : par le propriétaire et par le rôle des Edge Functions, source ou non', () => {
    expect(profils(NEUF_CONTRE_PASSATION)).toEqual(['postgres', 'service'])
    expect(refusParLaGarde(NEUF_CONTRE_PASSATION).map((e) => e.controle.split('.')[0]).sort())
      .toEqual(['143e', '143f', '69', '69b'])
  })

  it('la restauration du super-administrateur les réinsère ; les règles d’hier se disent d’abord ; les mutations mordent', () => {
    for (const n of ['68f', '69c', '143g']) expect(etape(n), n).toMatchObject({ profil: 'chef', code: 'OK' })
    expect(etape('68h')).toMatchObject({ profil: 'postgres', code: '23514', attendu: 'Un encaissement se justifie par un crédit de son dossier.' })
    expect(etape('69d')).toMatchObject({ profil: 'postgres', code: '23514', attendu: "Une annulation contre-passe l'encaissement montant pour montant." })
    // Au rattachement par la fonction du cabinet, son refus d'hier, sous ses mots, avant que la garde ne voie rien.
    expect(etape('110b')).toMatchObject({ profil: 'chef', code: '22023', requete: "select rattacher_mouvement_encaissement('{T}', '{ES2}', '{M1}')" })
    expect(messagesSql(derniereDefinitionSql('rattacher_mouvement_encaissement'))).toContain(etape('110b')?.attendu)
    expect(etape('110b')?.attendu).toMatch(/^Ce mouvement est déjà classé : /)
    for (const n of ['192', '193', '194', '195', '196', '197']) {
      expect(etape(n)?.controle, n).toContain('MUTATION')
      expect(etape(n)?.code, n).toBe('OK')
      expect(['postgres', 'service'], n).toContain(etape(n)?.profil)
    }
  })

  it('vire au rouge sur une dérive plantée : un mot de la garde hors des règles, une règle changée, un refus que l’essai n’exige plus', () => {
    const demain = derniereDefinitionSql('garder_encaissement_facture')
    const hier = avantLaMigration('garder_encaissement_facture').definition
    const mot = demain.replace("'Un encaissement ne se supprime pas", "'Un encaissement ne se retire pas")
    expect(mot).not.toBe(demain)
    expect(sansLesRegles(mot)).not.toBe(hier)
    const regle = demain.replace(`if ${CONDITION_DE_LA_SOURCE} and exists (`, "if tg_op = 'INSERT' and not public.is_super_admin() and exists (")
    expect(regle).not.toBe(demain)
    expect(sansLesRegles(regle)).toBeNull()
    const plante = TEXTE_ESSAI_VENTES_FACTUREES.replace("'ICL', $m$Un mouvement classé par ses encaissements ne se cite pas :", "'ICL', $m$Un mouvement classé par ses encaissements ne se cite plus :")
    expect(plante).not.toBe(TEXTE_ESSAI_VENTES_FACTUREES)
    expect(refusExigesParLEssai(plante).some((e) => e.code === '23514' && correspondAuModele(NEUF_MOUVEMENT, e.attendu))).toBe(false)
  })
})
