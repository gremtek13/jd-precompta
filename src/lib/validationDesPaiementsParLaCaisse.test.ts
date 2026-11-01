import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { codesSql, messagesSql } from '../test/raiseSql'
import { fichiersDuSchema, fichiersPrepares } from '../test/schema'

// LE FILET DE LA BASE : LA VALIDATION D'UN EXERCICE DEVANT LE PAIEMENT D'UNE PIÈCE PAR LA CAISSE (ligne 26.6 ; la relecture du
// 01/11/2026, le défaut 1). La migration `validation_des_paiements_par_la_caisse` — préparée dans supabase/preparees/, à
// appliquer après `paiement_par_la_caisse` (C8) et `champs_bnc_du_fec` (FEC22b) — reprend `valider_exercice` telle que FEC22b
// la laisse et n'y ajoute qu'un refus, avant que la validation n'écrive. Ce garde la confronte à FEC22b au caractère près, ce
// qu'elle ajoute défait ; sa garde de tête aux corps qu'elle exige, recalculés depuis les textes qui les posent ; son retour
// arrière ; ses mots, dits une fois ; et son essai (supabase/essais/validationDesPaiementsParLaCaisse.sql), rejoué sur une
// réplique. Récit : HISTORIQUE.md, « LA CAISSE : LA RELECTURE DE C8 ET C9, ET SES CORRECTIONS ».

const md5 = (texte: string) => createHash('md5').update(texte, 'utf8').digest('hex')
const corps = (definition: string) => definition.slice(definition.indexOf('as $$') + 'as $$'.length)
const motifDe = (fonction: string) => new RegExp(`create (or replace )?function public\\.${fonction}\\(`, 'g')

// Une migration, où qu'elle soit : préparée aujourd'hui, dans l'export le jour de son application — jamais aux deux.
function laMigration(nom: string): { chemin: string; texte: string } {
  const motif = new RegExp(`/\\d{14}_${nom}\\.sql$`)
  const trouvees = [...fichiersPrepares(), ...fichiersDuSchema()].filter((x) => motif.test(x.chemin))
  expect(trouvees.map((f) => f.chemin), `la migration ${nom}, préparée OU dans l’export`).toHaveLength(1)
  return trouvees[0]
}

// La définition qu'un texte donne à une fonction (la seule qu'il en donne).
function definitionDans(texte: string, fonction: string): string {
  const positions = [...texte.matchAll(motifDe(fonction))].map((m) => m.index)
  expect(positions, fonction).toHaveLength(1)
  return texte.slice(positions[0], texte.indexOf('$$;', positions[0]))
}

// La dernière définition d'une fonction dans l'export, avant un nom de fichier.
function dansLExportAvant(fonction: string, nom: string): string {
  const avant = fichiersDuSchema().filter((f) => f.chemin.split('/').pop()! < nom && motifDe(fonction).test(f.texte))
  const texte = avant[avant.length - 1].texte
  const debut = [...texte.matchAll(motifDe(fonction))].pop()!.index
  return texte.slice(debut, texte.indexOf('$$;', debut))
}

// Le commentaire qu'un texte pose sur `valider_exercice`.
function commentaireDans(texte: string): string {
  const debut = texte.indexOf('comment on function public.valider_exercice(')
  expect(debut).toBeGreaterThan(0)
  return texte.slice(debut, texte.indexOf(';\n', debut) + 2)
}

function uneFois(texte: string, de: string, vers: string): string {
  expect(texte.split(de).length - 1, de.slice(0, 80)).toBe(1)
  return texte.replace(de, () => vers)
}

const FILET = () => laMigration('validation_des_paiements_par_la_caisse')
const FEC22B = () => laMigration('champs_bnc_du_fec')
const C8 = () => laMigration('paiement_par_la_caisse')

function leRetour(): string {
  const dossier = new URL('../../supabase/preparees/retour/', import.meta.url).pathname
  expect(existsSync(dossier), 'supabase/preparees/retour/').toBe(true)
  const nom = readdirSync(dossier).find((n) => /^\d{14}_retour_validation_des_paiements_par_la_caisse\.sql$/.test(n))
  expect(nom, 'le retour arrière de validation_des_paiements_par_la_caisse').toBeDefined()
  return readFileSync(dossier + nom, 'utf8')
}

// Le bloc du filet : de son commentaire au commentaire d'hier qui le suit.
const DEBUT_DU_FILET = "  -- LE PAIEMENT D'UNE PIÈCE PAR LA CAISSE SANS SA CONTREPARTIE (relecture de C8 et C9, le 01/11/2026 ; le défaut 1 ; un filet,"
const APRES_LE_FILET = "  -- Les déclencheurs d'intangibilité ne laissent passer « validée »"
function leFilet(posee: string): string {
  const i = posee.indexOf(DEBUT_DU_FILET)
  const j = posee.indexOf(APRES_LE_FILET)
  expect(i).toBeGreaterThan(0)
  expect(j).toBeGreaterThan(i)
  return posee.slice(i, j)
}
const MODELE_DU_REFUS = "L'exercice % porte le paiement en espèces du % d'une pièce (% €) sans sa contrepartie entière au compte de la caisse : valider sa pièce et générer ses écritures, ou les régénérer, avant la validation — ou retirer ce paiement."
const PHRASE_DU_COMMENTAIRE = " Refuse aussi un paiement d''une pièce par la caisse de l''exercice dont la contrepartie entière au compte de la caisse n''est pas au brouillon (relecture du 01/11/2026)."

describe('le filet reprend la validation de FEC22b, et n’y ajoute qu’un refus', () => {
  it('se range après C8 et FEC22b, dans l’ordre des versions', () => {
    const nom = (f: { chemin: string }) => f.chemin.split('/').pop()!
    expect(nom(FILET()) > nom(FEC22B())).toBe(true)
    expect(nom(FILET()) > nom(C8())).toBe(true)
  })

  it('la validation : celle de FEC22b au caractère près, sa variable et son bloc défaits', () => {
    const posee = definitionDans(FILET().texte, 'valider_exercice')
    let defaite = uneFois(posee, '  v_vente record;\n  v_champs text;\n  v_paiement record;\n', '  v_vente record;\n  v_champs text;\n')
    defaite = uneFois(defaite, leFilet(posee), '')
    expect(defaite).toBe(definitionDans(FEC22B().texte, 'valider_exercice'))
  })

  // Les refus qui suivent l'écriture — une ligne restée non validée, des soldes qui ne se reportent pas — sont des contrôles de ce
  // qu'elle vient d'écrire, dans la même transaction : le filet vient avant elle, et après tout ce qui la précède.
  it('le bloc vient après tous les refus d’avant l’écriture, juste avant elle ; il ne lit que la caisse et le brouillon', () => {
    const posee = definitionDans(FILET().texte, 'valider_exercice')
    const i = posee.indexOf(DEBUT_DU_FILET)
    const ecrit = posee.indexOf("perform set_config('jd.validation_exercice', p_dossier_id::text, true);")
    expect(ecrit).toBeGreaterThan(i)
    const avantDEcrire = [...posee.matchAll(/raise exception/g)].map((m) => m.index).filter((x) => x < ecrit)
    expect(avantDEcrire.filter((x) => x > i), 'seul le refus du filet entre lui et l’écriture').toHaveLength(1)
    expect(avantDEcrire.filter((x) => x < i).length).toBe(avantDEcrire.length - 1)
    const bloc = leFilet(posee)
    expect(bloc).not.toMatch(/\b(insert|update|delete)\b/i)
    expect([...new Set([...bloc.matchAll(/public\.(\w+)/g)].map((m) => m[1]))].sort()).toEqual(['compte_du_role', 'ecritures_brouillon', 'operations_caisse'])
    expect(bloc).toContain("where o.dossier_id = p_dossier_id and o.genre = 'paiement' and o.retire_le is null and o.piece_id is not null")
    expect(bloc).toContain('and o.date between v_debut and v_fin')
    expect(bloc).toContain("and b.compte = public.compte_du_role(p_dossier_id, 'caisse')")
    expect(bloc).toContain("and b.sens = case when o.montant > 0 then 'debit' else 'credit' end), 0)")
  })

  it('un refus de plus, sous ses mots et le code 23514 ; les refus d’hier, mot pour mot et dans leur ordre', () => {
    const posee = definitionDans(FILET().texte, 'valider_exercice')
    const fec = definitionDans(FEC22B().texte, 'valider_exercice')
    const i = messagesSql(posee).indexOf(MODELE_DU_REFUS)
    expect(i).toBeGreaterThanOrEqual(0)
    expect(messagesSql(posee).toSpliced(i, 1)).toEqual(messagesSql(fec))
    expect(codesSql(posee)[i]).toBe('23514')
    expect(codesSql(posee).toSpliced(i, 1)).toEqual(codesSql(fec))
    // Dit une fois, dans ce texte, et nulle part ailleurs dans le schéma ni les migrations préparées.
    const ailleurs = [...fichiersDuSchema(), ...fichiersPrepares()].filter((f) => f.chemin !== FILET().chemin)
      .filter((f) => f.texte.includes('sans sa contrepartie entière au compte de la caisse'))
    expect(ailleurs.map((f) => f.chemin)).toEqual([])
  })

  it('le commentaire de FEC22b, et une phrase', () => {
    expect(commentaireDans(FILET().texte)).toBe(uneFois(commentaireDans(FEC22B().texte), " Chef du cabinet seul.';", `${PHRASE_DU_COMMENTAIRE} Chef du cabinet seul.';`))
  })
})

describe('sa garde de tête exige, avant toute définition, les corps que C8 et FEC22b posent', () => {
  it('la validation de FEC22b, le paiement et la garde de C8, le compte du plan de l’export : leurs empreintes recalculées', () => {
    const texte = FILET().texte
    const premiereDefinition = texte.indexOf('create or replace function')
    const attendues: [string, string][] = [
      ['valider_exercice', md5(corps(definitionDans(FEC22B().texte, 'valider_exercice')))],
      ['regler_piece_par_la_caisse', md5(corps(definitionDans(C8().texte, 'regler_piece_par_la_caisse')))],
      ['garder_ecriture_de_caisse', md5(corps(definitionDans(C8().texte, 'garder_ecriture_de_caisse')))],
      ['compte_du_role', md5(corps(dansLExportAvant('compte_du_role', FILET().chemin.split('/').pop()!)))],
    ]
    for (const [fonction, empreinte] of attendues) {
      const position = texte.indexOf(`'${empreinte}'`)
      expect(position, fonction).toBeGreaterThan(0)
      expect(position, fonction).toBeLessThan(premiereDefinition)
    }
    // FEC22b ne la retouche plus : sa propre définition est la dernière avant ce filet.
    expect(attendues[0][1]).toBe('a7844d5c918ce82b510c5dc448a3452c')
  })
})

describe('son retour arrière rend la validation de FEC22b', () => {
  it('sa garde exige le corps que le filet pose ; il rend la définition et le commentaire de FEC22b, au caractère près', () => {
    const retour = leRetour()
    const premiereDefinition = retour.indexOf('create or replace function')
    const filet = md5(corps(definitionDans(FILET().texte, 'valider_exercice')))
    expect(retour.indexOf(`'${filet}'`)).toBeGreaterThan(0)
    expect(retour.indexOf(`'${filet}'`)).toBeLessThan(premiereDefinition)
    expect(definitionDans(retour, 'valider_exercice')).toBe(definitionDans(FEC22B().texte, 'valider_exercice'))
    expect(commentaireDans(retour)).toBe(commentaireDans(FEC22B().texte))
  })
})

describe('les deux textes ne retirent rien, et s’appliquent par l’outil', () => {
  it('une définition, un commentaire ; ni droit, ni objet, ni donnée retirés ; ni barre oblique inverse ni retour chariot', () => {
    for (const texte of [FILET().texte, leRetour()]) {
      expect(texte.match(/create (or replace )?function/g)).toHaveLength(1)
      expect(texte.match(/comment on function/g)).toHaveLength(1)
      expect(texte).not.toMatch(/\b(grant|revoke|drop|truncate|alter)\b/i)
      expect(texte).not.toMatch(/\bdelete\b/i)
      expect(texte).not.toMatch(/\b(create)\s+(table|policy|trigger|index|view)\b/i)
      expect(texte).not.toContain('\\')
      expect(texte).not.toContain('\r')
    }
  })
})

describe('son essai', () => {
  const ESSAI = readFileSync(new URL('../../supabase/essais/validationDesPaiementsParLaCaisse.sql', import.meta.url), 'utf8')

  it('attend les deux migrations, sans rien écrire, et le dit', () => {
    expect(ESSAI).toContain("prosrc like '%sans sa contrepartie entière au compte de la caisse%'")
    expect(ESSAI).toContain('0. EN ATTENTE des migrations paiement_par_la_caisse et validation_des_paiements_par_la_caisse')
  })

  it('exige le refus sous son code et ses mots, et la validation du chemin juste', () => {
    expect(ESSAI).toContain(`'23514', '${MODELE_DU_REFUS.replace(/'/g, "''").replace('%', '2025').replace('%', '05/01/2025').replace('%', '80,00')}')`)
    expect(ESSAI).toContain("'22023', 'Une écriture n''est pas équilibrée au centime.'")
  })

  it('une transaction annulée, aucune suppression, toute mise à jour sous son `where`', () => {
    expect(ESSAI).toMatch(/^begin;$/m)
    expect(ESSAI.trimEnd()).toMatch(/\nrollback;$/)
    expect(ESSAI).not.toMatch(/\b(delete from|truncate|drop table)\b/i)
    for (const m of ESSAI.matchAll(/\bupdate public\.\w+ set [^;]*;/gi)) expect(m[0], m[0]).toMatch(/\bwhere\b/i)
  })
})
