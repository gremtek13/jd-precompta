import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { definitionsSql, derniereDefinitionSql, fichiersDuSchema } from '../test/schema'
import {
  auteurDeChaqueSeuilPrevu, auteursDesSeuils, DRAPEAU_DE_L_AUTEUR_DE_CHAQUE_SEUIL,
  phrasesDesSeuilsEtDeLeurReglage, phraseDuSeuilEtDeSonReglage, quiARegle, REFUS_DE_LA_BASE, SEUILS_VIDES, type SeuilDuDossier,
} from './hausseDuChiffreDAffaires'

// CA2-Q1 : L'AUTEUR ET L'INSTANT DE CHAQUE SEUIL. La migration `auteur_de_chaque_seuil`, en production depuis le 17/11/2026
// (235, dans l'export) : ses gardes nomment les corps qu'elle a remplacés (les derniers de l'export AVANT elle) et ceux qu'elle
// pose, son retour rend les premiers au caractère près, elle passe par l'outil ; l'essai l'attend ; le drapeau suit l'export,
// levé ; les mots de la carte, dans ses deux états. Données FICTIVES.

function leFichier(motif: RegExp, dossiers: readonly string[]): string {
  const trouves: string[] = []
  for (const dossier of dossiers) {
    const chemin = new URL(dossier, import.meta.url).pathname
    if (!existsSync(chemin)) continue
    for (const nom of readdirSync(chemin)) if (motif.test(nom)) trouves.push(chemin + nom)
  }
  expect(trouves, String(motif)).toHaveLength(1)
  return readFileSync(trouves[0], 'utf8')
}

const MIGRATION = leFichier(/^\d{14}_auteur_de_chaque_seuil\.sql$/, ['../../supabase/schema/'])
const RETOUR = leFichier(/^\d{14}_retour_auteur_de_chaque_seuil\.sql$/, ['../../supabase/preparees/retour/'])
const ESSAI = readFileSync(new URL('../../supabase/essais/auteurDeChaqueSeuil.sql', import.meta.url), 'utf8')
const ESSAI_D_HIER = readFileSync(new URL('../../supabase/essais/hausseDuChiffreDAffaires.sql', import.meta.url), 'utf8')
const EXPORTEE = fichiersDuSchema().some((f) => /\d{14}_auteur_de_chaque_seuil\.sql$/.test(f.chemin))
const md5 = (texte: string) => createHash('md5').update(texte, 'utf8').digest('hex')
const definition = (texte: string, nom: string) => {
  const d = definitionsSql(nom, [{ chemin: 'f', texte }])
  expect(d.length, nom).toBeGreaterThan(0)
  return d[d.length - 1].definition
}
const corps = (d: string) => d.slice(d.indexOf('as $$') + 'as $$'.length)
const bloc = (texte: string, etiquette: string) => {
  const debut = texte.indexOf(`do $${etiquette}$`)
  return texte.slice(debut, texte.indexOf(`$${etiquette}$;`, debut))
}
const FONCTIONS = ['garder_seuil_du_chiffre_d_affaires', 'regler_seuil_du_chiffre_d_affaires'] as const

afterEach(() => {
  DRAPEAU_DE_L_AUTEUR_DE_CHAQUE_SEUIL.AUTEUR_DE_CHAQUE_SEUIL_PREVU = true
})
// Les corps d'avant la migration : les derniers de l'export, elle exceptée.
const avantElle = (f: { chemin: string }) => !/\d{14}_auteur_de_chaque_seuil\.sql$/.test(f.chemin)

describe('CA2-Q1 — la migration, son retour et son essai', () => {
  it('la garde de tête nomme les deux corps de production qu’elle remplace ; la garde de fin et le retour, ceux qu’elle pose', () => {
    for (const nom of FONCTIONS) {
      const production = md5(corps(derniereDefinitionSql(nom, avantElle)))
      // Et l'export, après elle, porte le corps qu'elle pose.
      expect(md5(corps(derniereDefinitionSql(nom))), nom).toBe(md5(corps(definition(MIGRATION, nom))))
      const posee = md5(corps(definition(MIGRATION, nom)))
      expect(bloc(MIGRATION, 'garde'), nom).toContain(`${nom}=${production}`)
      expect(bloc(MIGRATION, 'fin'), nom).toContain(`${nom}=${posee}`)
      expect(bloc(RETOUR, 'garde'), nom).toContain(`${nom}=${posee}`)
      // Le retour rend le corps de production au caractère près, et sa garde de fin le vérifie.
      expect(md5(corps(definition(RETOUR, nom))), nom).toBe(production)
      expect(bloc(RETOUR, 'fin'), nom).toContain(`${nom}=${production}`)
      expect(posee).not.toBe(production)
    }
  })

  it('la fonction redit les refus d’hier, aux mêmes mots, dans le même ordre ; un réglage inchangé n’écrit rien', () => {
    const neuve = corps(definition(MIGRATION, 'regler_seuil_du_chiffre_d_affaires'))
    const hier = corps(derniereDefinitionSql('regler_seuil_du_chiffre_d_affaires', avantElle))
    const refus = (sql: string) => [...sql.matchAll(/raise exception '((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'"))
    expect(refus(neuve)).toEqual(refus(hier))
    expect(refus(neuve)).toEqual([REFUS_DE_LA_BASE.seuilParLeCabinet, REFUS_DE_LA_BASE.sensInconnu, REFUS_DE_LA_BASE.seuilDeHausseHorsBornes,
      REFUS_DE_LA_BASE.seuilDeBaisseHorsBornes, REFUS_DE_LA_BASE.seuilDeHausseChange, REFUS_DE_LA_BASE.seuilDeBaisseChange])
    expect(neuve.match(/if p_seuil is not distinct from v_actuel then\n {6}return v_actuel;\n {4}end if;/g)).toHaveLength(2)
    // La garde, aux droits de l'appelant ; le compte et l'instant d'un seuil, ceux de l'écriture qui le change.
    const garde = definition(MIGRATION, 'garder_seuil_du_chiffre_d_affaires')
    expect(garde).not.toMatch(/security\s+definer/i)
    expect(garde).toContain('if new.seuil_de_hausse is distinct from old.seuil_de_hausse then')
    expect(garde).toContain('new.seuil_de_baisse_regle_par := old.seuil_de_baisse_regle_par;')
  })

  it('elle passe par l’outil : ni retrait, ni vidage, ni barre oblique inverse, ni retour chariot ; la recopie, garde suspendue puis remise', () => {
    expect(MIGRATION).not.toMatch(/\b(drop|truncate)\b|delete\s+from/i)
    expect(MIGRATION).not.toContain('\\')
    expect(MIGRATION).not.toContain('\r')
    const suspendue = MIGRATION.search(/alter table public\.seuils_du_chiffre_d_affaires disable trigger seuils_du_chiffre_d_affaires_garde;/i)
    const remise = MIGRATION.search(/alter table public\.seuils_du_chiffre_d_affaires enable trigger seuils_du_chiffre_d_affaires_garde;/i)
    expect(suspendue).toBeGreaterThan(0)
    expect(remise).toBeGreaterThan(suspendue)
    expect(MIGRATION.slice(suspendue, remise).match(/;\n/g)).toHaveLength(2)
    expect(RETOUR.split('\n').filter((l) => /^\s*drop /i.test(l))).toEqual([
      '  drop constraint seuils_du_chiffre_d_affaires_reglage_de_hausse,', '  drop constraint seuils_du_chiffre_d_affaires_reglage_de_baisse;',
      '  drop column seuil_de_hausse_regle_par,', '  drop column seuil_de_hausse_regle_le,', '  drop column seuil_de_baisse_regle_par,',
      '  drop column seuil_de_baisse_regle_le;',
    ])
  })

  it('l’essai l’attend (EN ATTENTE sans elle), sans suppression ; celui d’hier se joue avant comme après elle', () => {
    expect(ESSAI).toContain('EN ATTENTE de la migration auteur_de_chaque_seuil')
    expect(ESSAI).not.toMatch(/delete\s+from/i)
    expect(ESSAI).not.toContain('\\')
    for (const c of ['seuils_du_chiffre_d_affaires_reglage_de_hausse', 'seuils_du_chiffre_d_affaires_reglage_de_baisse']) {
      expect(ESSAI, c).toContain(c)
      expect(ESSAI_D_HIER, c).toContain(c)
    }
    expect(ESSAI_D_HIER).toContain("and a.attname not in ('seuil_de_hausse_regle_par', 'seuil_de_hausse_regle_le', 'seuil_de_baisse_regle_par', 'seuil_de_baisse_regle_le')")
  })

  it('le drapeau suit l’export : levé, la migration y est (235, 17/11/2026)', () => {
    expect(EXPORTEE).toBe(true)
    expect(auteurDeChaqueSeuilPrevu()).toBe(EXPORTEE)
  })
})

const CHEF = 'abcdef12-0000-4000-8000-000000000001'
const MEMBRE = 'abcdef12-0000-4000-8000-000000000002'
const PARTI = 'abcdef12-0000-4000-8000-000000000003'
const ligne = (l: Partial<SeuilDuDossier>): SeuilDuDossier => ({
  dossier_id: 'd1', seuil_de_hausse: 20, seuil_de_baisse: null, regle_par: CHEF, regle_le: '2026-11-16T09:00:00Z',
  seuil_de_hausse_regle_par: MEMBRE, seuil_de_hausse_regle_le: '2026-11-15T09:00:00Z', seuil_de_baisse_regle_par: null,
  seuil_de_baisse_regle_le: null, ...l,
})
const NB = String.fromCharCode(160)

describe('CA2-Q1 — la carte dit l’auteur de chaque seuil', () => {
  it('le drapeau se bascule et se remet : les tests jouent ses deux états', () => {
    expect(auteurDeChaqueSeuilPrevu()).toBe(true)
    DRAPEAU_DE_L_AUTEUR_DE_CHAQUE_SEUIL.AUTEUR_DE_CHAQUE_SEUIL_PREVU = false
    expect(auteurDeChaqueSeuilPrevu()).toBe(false)
  })

  it('qui a réglé : « toi », l’adresse que la session lit dans l’équipe, sinon « le cabinet » — jamais un identifiant', () => {
    const equipe = new Map([[MEMBRE, 'membre@cabinet.example']])
    expect(quiARegle(CHEF, CHEF, equipe)).toBe('toi')
    expect(quiARegle(MEMBRE, CHEF, equipe)).toBe('membre@cabinet.example')
    expect(quiARegle(PARTI, CHEF, equipe)).toBe('le cabinet')
    expect(quiARegle(MEMBRE, null, new Map())).toBe('le cabinet')
    expect(auteursDesSeuils(ligne({ seuil_de_baisse: 10, seuil_de_baisse_regle_par: MEMBRE, seuil_de_baisse_regle_le: '2026-11-16T10:00:00Z' })))
      .toEqual([MEMBRE])
    expect(auteursDesSeuils(null)).toEqual([])
  })

  it('chaque seuil : réglé, retiré, jamais réglé, ou sans réglage connu ; sans ligne, aucun seuil', () => {
    const equipe = new Map([[MEMBRE, 'membre@cabinet.example']])
    const l = ligne({ seuil_de_baisse_regle_par: CHEF, seuil_de_baisse_regle_le: '2026-11-16T10:00:00Z' })
    expect(phrasesDesSeuilsEtDeLeurReglage(l, CHEF, equipe)).toEqual([
      `Hausse : 20${NB}%, réglé le 15/11/2026 par membre@cabinet.example.`,
      'Baisse : aucun seuil, retiré le 16/11/2026 par toi.',
    ])
    expect(phrasesDesSeuilsEtDeLeurReglage(l, PARTI, new Map())).toEqual([
      `Hausse : 20${NB}%, réglé le 15/11/2026 par le cabinet.`, 'Baisse : aucun seuil, retiré le 16/11/2026 par le cabinet.',
    ])
    expect(phraseDuSeuilEtDeSonReglage(ligne({}), 'baisse', CHEF, equipe)).toBe('Baisse : aucun seuil.')
    expect(phraseDuSeuilEtDeSonReglage(ligne({ seuil_de_hausse_regle_par: null, seuil_de_hausse_regle_le: null }), 'hausse', CHEF, equipe))
      .toBe(`Hausse : 20${NB}%, son réglage n’est pas connu.`)
    expect(phrasesDesSeuilsEtDeLeurReglage(null, CHEF, equipe)).toEqual([SEUILS_VIDES])
    for (const p of phrasesDesSeuilsEtDeLeurReglage(l, PARTI, equipe)) expect(p).not.toMatch(/abcdef12/)
  })
})
