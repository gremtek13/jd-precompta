import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { REFUS_COTISATION_CLASSEE, refusRapprochementCotisationSelon } from './cotisationRapprochee'
import { REFUS_REGLE_EN_GROUPE } from './reglementGroupe'
import {
  CLE_D_HIER, CLE_DES_REGLES, CONTRAINTE_DU_SENS, motsDuSens, nomDeLaRegleSelon, REFUS_MOUVEMENT_IGNORE, REFUS_REGLE_SANS_SENS,
  refusDeLaRegleNeuveSelon, SENS_D_UNE_REGLE, SENS_DES_REGLES_IGNOREES_EXPORTE, sensDeLaRegleSelon, vautPourLeSens,
} from './sensDesReglesIgnorees'
import type { MouvementBancaire } from './affectationBanque'
import type { CotisationDeclaree, SensMouvementBancaire } from './types'
import { fichiersDuSchema, fichiersPrepares, indiceSql } from '../test/schema'

// LE SENS DES RÈGLES « TOUJOURS IGNORER » ET LA COTISATION D'UN MOUVEMENT IGNORÉ, CONFRONTÉS À LA BASE (REGLES-Q1). Trois
// juges : le TEXTE de la migration `sens_des_regles_ignorees`, où qu'elle soit (préparée aujourd'hui, dans l'export le jour
// de son application) — ses mots, son ordre, ses contraintes, le corps repris au caractère près, les empreintes que sa garde,
// son essai et son retour arrière épinglent ; son ESSAI (supabase/essais/sensDesReglesIgnorees.sql), ce que la base a
// répondu sur la réplique ; et le DRAPEAU, qui suit le fichier.

const ESSAI = readFileSync(new URL('../../supabase/essais/sensDesReglesIgnorees.sql', import.meta.url), 'utf8')
const RETOUR = readFileSync(new URL('../../supabase/preparees/retour/20261102120100_retour_sens_des_regles_ignorees.sql', import.meta.url), 'utf8')
const sansApostrophes = (s: string) => s.replace(/''/g, "'").replace(/’/g, "'")
const md5 = (s: string) => createHash('md5').update(s, 'utf8').digest('hex')

const nomDe = (chemin: string) => chemin.split('/').pop()!
const MIGRATIONS = [...fichiersDuSchema(), ...fichiersPrepares()]
  .filter((f) => /^\d{14}_/.test(nomDe(f.chemin)))
  .sort((a, b) => (nomDe(a.chemin) < nomDe(b.chemin) ? -1 : 1))
const MIGRATION = MIGRATIONS.find((f) => /\d{14}_sens_des_regles_ignorees\.sql$/.test(f.chemin))!

/** Le corps (`prosrc`) de la dernière définition d'une fonction dans un texte : entre `as $$` et `$$;`, sauts de ligne compris. */
function corps(texte: string, nom: string): string {
  const debuts = [...texte.matchAll(new RegExp(`create (?:or replace )?function public\\.${nom}\\(`, 'gi'))]
  if (debuts.length === 0) throw new Error(`${nom} absente`)
  const debut = texte.indexOf('as $$', debuts[debuts.length - 1].index) + 'as $$'.length
  return texte.slice(debut, texte.indexOf('\n$$;', debut) + 1)
}

/** La dernière définition d'une fonction AVANT la migration : celle qu'elle remplace. */
function corpsAvant(nom: string): string {
  const avant = MIGRATIONS.slice(0, MIGRATIONS.indexOf(MIGRATION))
    .filter((f) => new RegExp(`create (?:or replace )?function public\\.${nom}\\(`, 'i').test(f.texte))
  return corps(avant[avant.length - 1].texte, nom)
}

/** Les `raise exception` d'un corps, dans l'ordre du texte : « code mots ». */
function raises(texte: string): string[] {
  return [...texte.matchAll(/raise exception '((?:[^']|'')*)'([^;]*);/g)]
    .map((m) => `${/using errcode = '(\w+)'/.exec(m[2])?.[1] ?? ''} ${sansApostrophes(m[1].replace(/''/g, "'"))}`)
}

const NEUF = corps(MIGRATION.texte, 'rapprocher_cotisation')
const HIER = corpsAvant('rapprocher_cotisation')
const LE_REFUS = `${REFUS_MOUVEMENT_IGNORE.code} ${sansApostrophes(REFUS_MOUVEMENT_IGNORE.message)}`

describe('la migration, où qu’elle soit', () => {
  it('est là une fois, préparée ou dans l’export, et le drapeau suit son fichier', () => {
    expect(MIGRATION).toBeDefined()
    expect(MIGRATIONS.filter((f) => /_sens_des_regles_ignorees\.sql$/.test(f.chemin))).toHaveLength(1)
    expect(SENS_DES_REGLES_IGNOREES_EXPORTE).toBe(fichiersDuSchema().some((f) => /\d{14}_sens_des_regles_ignorees\.sql$/.test(f.chemin)))
  })

  it('ni barre oblique inverse, ni retour chariot ; une seule suppression d’objet — la clé d’hier —, qu’elle dit', () => {
    expect(MIGRATION.texte).not.toMatch(/[\\\r]/)
    const sansCommentaires = MIGRATION.texte.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n')
    expect([...sansCommentaires.matchAll(/\bdrop\b[^;]*;/gi)].map((m) => m[0])).toEqual([`drop constraint ${CLE_D_HIER};`])
    expect(sansCommentaires).not.toMatch(/\btruncate\b|\bdrop table\b|\bdrop column\b/i)
    // Le corps de la fonction supprime des écritures, comme hier : le texte se colle, et l'en-tête le dit.
    expect((sansCommentaires.match(/\bdelete from\b/gi) ?? []).length).toBe((HIER.match(/\bdelete from\b/gi) ?? []).length)
    expect(MIGRATION.texte).toContain('Le texte SE COLLE donc\n-- dans l\'éditeur SQL de Supabase, dans une transaction, avec sa ligne d\'historique.')
  })
})

describe('rapprocher_cotisation : le corps d’hier, au caractère près, plus le refus d’un mouvement ignoré', () => {
  const ANCRE = '  if v_ligne.montant = 0 then'

  it('rien d’autre ne change : le corps neuf est celui d’hier, le bloc du refus inséré juste avant le zéro', () => {
    const [avantAncre, apresAncre] = [HIER.slice(0, HIER.indexOf(ANCRE)), HIER.slice(HIER.indexOf(ANCRE))]
    expect(NEUF.startsWith(avantAncre)).toBe(true)
    expect(NEUF.endsWith(apresAncre)).toBe(true)
    const bloc = NEUF.slice(avantAncre.length, NEUF.length - apresAncre.length)
    expect(bloc).toMatch(new RegExp(
      "^(  --[^\\n]*\\n)+  if v_ligne\\.statut = 'ignoree' then\\n"
      + "    raise exception 'Ce mouvement est ignoré : remets-le d''abord à traiter\\.' using errcode = '22023';\\n  end if;\\n$"))
  })

  it('le refus neuf : son code et ses mots, après celui d’un mouvement classé, avant celui du zéro', () => {
    const tous = raises(NEUF)
    expect(tous.filter((r) => r === LE_REFUS)).toHaveLength(1)
    const i = tous.indexOf(LE_REFUS)
    expect(tous[i - 1]).toBe(`22023 ${sansApostrophes(REFUS_COTISATION_CLASSEE)}`)
    expect(tous[i + 1]).toBe('22023 Un mouvement de zéro euro n\'a rien à écrire.')
    // Hors de lui, les refus d'hier, dans le même ordre, sous les mêmes mots.
    expect(tous.filter((r) => r !== LE_REFUS)).toEqual(raises(HIER))
  })

  it('le module dit les mêmes refus, dans le même ordre, le drapeau levé', () => {
    const mouvement = (o: Partial<MouvementBancaire>): MouvementBancaire => ({
      id: 'l1', date: '2026-03-05', libelle: 'PRLV URSSAF', libelle_brut: null, montant: -100, statut: 'non_rapprochee',
      piece_id: null, cotisation_id: null, categorie_id: null, taux_tva: null, prelevement_personnel: false, source_fichier: 'r.csv',
      emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false,
      reglement_groupe: false, compte_bilan: null, declaration_tva_id: null, ...o,
    })
    const echeance: CotisationDeclaree = {
      id: 'c1', dossier_id: 'd1', echeance: '2026-03-05', montant_appele: 100, montant_verse: null, montant_csg_crds: null,
      previsionnel: false, created_at: '2026-03-01T10:00:00Z', paiement_personnel_le: null,
    }
    const cas: [Partial<MouvementBancaire>, string][] = [
      [{ reglement_groupe: true, statut: 'ignoree' }, REFUS_REGLE_EN_GROUPE],
      [{ prelevement_personnel: true, statut: 'ignoree' }, REFUS_COTISATION_CLASSEE],
      [{ statut: 'ignoree', montant: 0 }, REFUS_MOUVEMENT_IGNORE.message],
      [{ montant: 0 }, 'Un mouvement de zéro euro n’a rien à écrire.'],
    ]
    const sql = sansApostrophes(NEUF)
    let position = -1
    for (const [o, attendu] of cas) {
      expect(refusRapprochementCotisationSelon(true, mouvement(o), echeance, 'tresorerie')).toBe(attendu)
      const ici = sql.indexOf(sansApostrophes(attendu))
      expect(ici, attendu).toBeGreaterThan(position)
      position = ici
    }
  })

  it('les empreintes : la garde exige le corps d’hier ; l’essai et le retour arrière épinglent le corps neuf', () => {
    expect(MIGRATION.texte).toContain(`v_empreinte is distinct from '${md5(HIER)}'`)
    // La jambe de banque par compte (MCB5) remplacera ce corps : l'essai attend celui-ci tant qu'elle n'est pas en base.
    expect(ESSAI).toContain(`else '${md5(NEUF)}' end`)
    expect(RETOUR).toContain(`v_empreinte is distinct from '${md5(NEUF)}'`)
    // Et le retour rend le corps d'hier, au caractère près.
    expect(corps(RETOUR, 'rapprocher_cotisation')).toBe(HIER)
  })
})

describe('la règle : la colonne, sa contrainte, la clé remplacée', () => {
  it('la colonne est nulle et sans valeur par défaut : une règle d’avant, et une sauvegarde d’avant, restent nulles', () => {
    expect(MIGRATION.texte).toContain('alter table public.regles_bancaires_ignorees\n  add column sens text;\n')
  })

  it('le sens se tient aux deux mots du module, ceux des règles d’affectation', () => {
    const m = new RegExp(`add constraint ${CONTRAINTE_DU_SENS} check \\(sens is null or sens in \\(([^)]*)\\)\\);`).exec(MIGRATION.texte)
    expect(m).not.toBeNull()
    expect(m![1].split(',').map((s) => s.trim().replace(/'/g, ''))).toEqual([...SENS_D_UNE_REGLE])
    const affectation = fichiersDuSchema().map((f) => f.texte).join('\n')
    expect(affectation).toContain("constraint regles_affectation_bancaire_sens check (sens in ('encaissement', 'decaissement'))")
  })

  it('la clé : une règle par motif ET par sens, deux nuls égaux ; la clé d’hier, celle que la garde attend, retirée', () => {
    expect(MIGRATION.texte).toContain(`add constraint ${CLE_DES_REGLES} unique nulls not distinct (dossier_id, motif, sens);`)
    expect(MIGRATION.texte).toContain(`c.conname = '${CLE_D_HIER}' and c.contype = 'u'\n                  and pg_get_constraintdef(c.oid) = 'UNIQUE (dossier_id, motif)'`)
    // La nouvelle avant le retrait de l'ancienne.
    expect(MIGRATION.texte.indexOf(`add constraint ${CLE_DES_REGLES}`)).toBeLessThan(indiceSql(MIGRATION.texte, `drop constraint ${CLE_D_HIER}`))
    // Le retour arrière la rend, sous son nom, et retire ce que la migration a posé.
    for (const morceau of [
      `add constraint ${CLE_D_HIER} unique (dossier_id, motif);`, `drop constraint ${CLE_DES_REGLES};`,
      `drop constraint ${CONTRAINTE_DU_SENS};`, 'drop column sens;',
    ]) expect(RETOUR, morceau).toContain(morceau)
  })
})

describe('l’essai redit ce que le module dit', () => {
  it('les mots du refus, ses deux rangs, les deux contraintes, et la ligne d’attente sans la migration', () => {
    const essai = sansApostrophes(ESSAI)
    expect(essai).toContain(`'22023', '${sansApostrophes(REFUS_MOUVEMENT_IGNORE.message)}'`)
    expect(essai).toContain(`'22023', '${sansApostrophes(REFUS_COTISATION_CLASSEE)}'`)
    expect(essai).toContain(`'23505', '%${CLE_DES_REGLES}%'`)
    expect(essai).toContain(`'23514', '%${CONTRAINTE_DU_SENS}%'`)
    expect(essai).toContain('EN ATTENTE de la migration sens_des_regles_ignorees')
    // La forme des essais joués en production : un bloc annulé, les verdicts dans un réglage local, aucune suppression.
    expect(ESSAI).toContain("raise exception 'ANNULATION_ESSAI_GLOBALE';")
    expect(ESSAI).toContain("perform set_config('essai.regles', verdicts::text, true);")
    expect(ESSAI.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n')).not.toMatch(/\bdelete\b|\btruncate\b|\bdrop\b/i)
  })
})

describe('le sens d’une règle, et la règle qu’on crée', () => {
  it('nul vaut pour les deux sens et pour un mouvement de zéro euro ; un sens, pour lui seul', () => {
    const sens: (SensMouvementBancaire | null)[] = ['encaissement', 'decaissement', null]
    for (const mouvement of sens) {
      expect(vautPourLeSens(null, mouvement)).toBe(true)
      for (const regle of SENS_D_UNE_REGLE) expect(vautPourLeSens(regle, mouvement)).toBe(regle === mouvement)
    }
  })

  it('baissé, le sens lu ne compte pas ; levé, il compte, et une colonne absente vaut nul', () => {
    expect(sensDeLaRegleSelon(false, { sens: 'decaissement' })).toBeNull()
    expect(sensDeLaRegleSelon(true, { sens: 'decaissement' })).toBe('decaissement')
    expect(sensDeLaRegleSelon(true, { sens: null })).toBeNull()
    expect(sensDeLaRegleSelon(true, {})).toBeNull()
  })

  it('les mots du sens, et le nom d’une règle : celui d’hier baissé', () => {
    expect([motsDuSens('decaissement'), motsDuSens('encaissement'), motsDuSens(null)]).toEqual(['paiements', 'encaissements', 'les deux sens'])
    expect(nomDeLaRegleSelon(false, { motif: 'cpam', sens: 'decaissement' })).toBe('« cpam »')
    expect(nomDeLaRegleSelon(true, { motif: 'cpam', sens: 'decaissement' })).toBe('« cpam » (paiements)')
    expect(nomDeLaRegleSelon(true, { motif: 'cpam' })).toBe('« cpam » (les deux sens)')
  })

  it('la règle neuve : rien baissé ; levé, un mouvement sans sens, puis la même règle — même motif, même sens', () => {
    const regles = [{ motif: 'cpam', sens: 'decaissement' as const }, { motif: 'macsf', sens: null }]
    expect(refusDeLaRegleNeuveSelon(false, null, 'cpam', regles)).toBeNull()
    expect(refusDeLaRegleNeuveSelon(false, 'decaissement', 'cpam', regles)).toBeNull()
    expect(refusDeLaRegleNeuveSelon(true, null, 'cpam', regles)).toBe(REFUS_REGLE_SANS_SENS)
    expect(refusDeLaRegleNeuveSelon(true, 'decaissement', 'cpam', regles)).toBe('La règle « cpam » (paiements) existe déjà.')
    expect(refusDeLaRegleNeuveSelon(true, 'encaissement', 'cpam', regles)).toBeNull()
    // Une règle des deux sens du même motif ne la retient pas : la clé admet (macsf, nul) et (macsf, decaissement).
    expect(refusDeLaRegleNeuveSelon(true, 'decaissement', 'macsf', regles)).toBeNull()
    expect(refusDeLaRegleNeuveSelon(true, 'decaissement', 'dupont', regles)).toBeNull()
  })
})
