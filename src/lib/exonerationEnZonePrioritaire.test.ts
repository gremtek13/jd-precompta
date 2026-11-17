import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { lireLesParametresDesCotisationsSelon } from './parametresDesCotisationsLecture'
import { definitionsSql, derniereDefinitionSql, fichiersDuSchema } from '../test/schema'
import { codesSql, messagesSql } from '../test/raiseSql'
import {
  EXERCICE_DE_L_EXONERATION, EXONERATION_EN_ZONE_PRIORITAIRE_PREVUE, REFUS_EXONERATION_HORS_DE_2025, REFUS_EXONERATION_SANS_LE_CUMUL,
  casesDuMedecinDeLExercice, lireParametresDUnExercice, memesValeurs, refusDeLExoneration, saisieDe, valeursLues, valeursSaisies,
  type LectureDesParametres,
} from './parametresDesCotisations'
import { EXERCICE_DE_L_EXONERATION_EN_ZONE_PRIORITAIRE } from './retraiteDesLiberaux'

// Un faux client qui note les colonnes demandées et rend une ligne de 2025 portant les trois cases du médecin.
const faux = vi.hoisted(() => ({ selects: [] as string[] }))
vi.mock('./supabase', () => {
  interface Requete { select: (c: string) => Requete; eq: () => Requete; order: () => Requete; range: () => Promise<unknown>; maybeSingle: () => Promise<unknown> }
  return {
    supabase: {
      from: (table: string): Requete => {
        const q: Requete = {
          select: (c: string) => { faux.selects.push(`${table}:${c}`); return q },
          eq: () => q,
          order: () => q,
          range: () => Promise.resolve({
            data: [{ id: 'p1', annee: 2025, acre: null, taux_dentiste: null, cumul_emploi_retraite: true, dispense_complementaire: null,
              exoneration_zone_prioritaire: true }],
            error: null, count: 1,
          }),
          maybeSingle: () => Promise.resolve({ data: { date_debut: '2010-01-01' }, error: null }),
        }
        return q
      },
    },
  }
})

// RET2-Q2 : L'EXONÉRATION DES COTISATIONS DE RETRAITE 2025 D'UN MÉDECIN EN CUMUL EXERÇANT EN ZONE D'INTERVENTION PRIORITAIRE.
// Le module redit la migration `exoneration_en_zone_prioritaire` (en production depuis le 17/11/2026, 236) : la forme à six clés, les deux contraintes, les
// deux refus neufs à leurs mots et à leur rang ; ses empreintes et celles de son retour se tiennent ; la lecture, les valeurs
// et la saisie sous les deux états du drapeau ; l'essai attend les mots du module. Données FICTIVES.

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

const MIGRATION = leFichier(/^\d{14}_exoneration_en_zone_prioritaire\.sql$/, ['../../supabase/schema/'])
// Le corps d'avant la migration (en production depuis le 17/11/2026, 236) : le dernier de l'export, elle exceptée.
const avantElle = (f: { chemin: string }) => !/\d{14}_exoneration_en_zone_prioritaire\.sql$/.test(f.chemin)
const RETOUR = leFichier(/^\d{14}_retour_exoneration_en_zone_prioritaire\.sql$/, ['../../supabase/preparees/retour/'])
const ESSAI = readFileSync(new URL('../../supabase/essais/parametresDesCotisations.sql', import.meta.url), 'utf8')
const EXPORTEE = fichiersDuSchema().some((f) => /\d{14}_exoneration_en_zone_prioritaire\.sql$/.test(f.chemin))
const md5 = (texte: string) => createHash('md5').update(texte, 'utf8').digest('hex')
const corps = (definition: string) => definition.slice(definition.indexOf('as $$') + 'as $$'.length)
const FONCTION = 'enregistrer_parametres_des_cotisations'
const fonction = (texte: string, chemin: string) => {
  const definitions = definitionsSql(FONCTION, [{ chemin, texte }])
  expect(definitions, chemin).toHaveLength(1)
  return definitions[0].definition
}
const bloc = (texte: string, etiquette: string) => {
  const debut = texte.indexOf(`do $${etiquette}$`)
  return texte.slice(debut, texte.indexOf(`$${etiquette}$;`, debut))
}

describe('RET2-Q2 — la migration, son retour et le module', () => {
  it('la fonction : les refus d’hier, et les deux neufs à leur rang (l’exercice avant le verrou, le cumul après la lecture)', () => {
    const hier = derniereDefinitionSql(FONCTION, avantElle)
    expect(derniereDefinitionSql(FONCTION)).toBe(fonction(MIGRATION, 'migration'))
    const neuve = fonction(MIGRATION, 'migration')
    const avant = messagesSql(hier)
    const apres = messagesSql(neuve)
    expect(apres).toHaveLength(avant.length + 2)
    const rangExercice = apres.indexOf(REFUS_EXONERATION_HORS_DE_2025)
    const rangCumul = apres.indexOf(REFUS_EXONERATION_SANS_LE_CUMUL)
    expect(apres[rangExercice - 1]).toBe('Le début d\'activité n\'est pas une date du calendrier.')
    expect(apres[rangCumul - 1]).toMatch(/^Les paramètres des cotisations de l'exercice % ont changé depuis leur lecture/)
    expect(apres.filter((_m, i) => i !== rangExercice && i !== rangCumul)).toEqual(avant)
    expect(codesSql(neuve)[rangExercice]).toBe('23514')
    expect(codesSql(neuve)[rangCumul]).toBe('23514')
    expect(neuve.indexOf(REFUS_EXONERATION_HORS_DE_2025.replace(/'/g, "''"))).toBeLessThan(neuve.indexOf('perform pg_advisory_xact_lock('))
  })

  it('six clés, celles que la fonction attend, dans l’ordre de son tableau ; les formes d’hier gardées', () => {
    const neuve = fonction(MIGRATION, 'migration')
    const cles = (nom: string) => /constant text\[\] := array\[([^\]]*)\];/.exec(neuve.slice(neuve.indexOf(`${nom} constant`)))![1]
      .split(',').map((c) => c.trim().replace(/'/g, ''))
    expect(cles('v_cles')).toEqual(['acre', 'debut_activite', 'taux_dentiste'])
    expect(cles('v_cles_du_medecin')).toEqual(['acre', 'cumul_emploi_retraite', 'debut_activite', 'dispense_complementaire', 'taux_dentiste'])
    const six = cles('v_cles_de_l_exoneration')
    expect(six).toEqual([...cles('v_cles_du_medecin'), 'exoneration_zone_prioritaire'].sort())
    const lecture: Extract<LectureDesParametres, { etat: 'lus' }> = {
      dossierId: 'd', etat: 'lus', debutActivite: null,
      parExercice: new Map([[2025, { acre: null, tauxDentiste: null, medecin: { cumulEmploiRetraite: true, dispenseComplementaire: null, exonerationZonePrioritaire: true } }]]),
    }
    const lues = valeursLues(lecture, 2025, true, true)
    expect(Object.keys(lues).sort()).toEqual(six)
    const saisies = valeursSaisies(saisieDe(lues), true, true).valeurs!
    expect(Object.keys(saisies).sort()).toEqual(six)
    expect(memesValeurs(saisies, lues)).toBe(true)
    expect(memesValeurs({ ...saisies, exoneration_zone_prioritaire: false }, lues)).toBe(false)
    // Le drapeau baissé (l'état d'avant, gardé tant que son code existe) : les cinq clés de RET-Q2.
    expect(Object.keys(valeursLues(lecture, 2025, true, false)).sort()).toEqual(cles('v_cles_du_medecin'))
    expect(Object.keys(valeursSaisies(saisieDe(lues), true, false).valeurs!).sort()).toEqual(cles('v_cles_du_medecin'))
  })

  it('les deux contraintes, et l’exercice que le module et l’estimation lisent', () => {
    expect(MIGRATION).toContain('add constraint parametres_des_cotisations_exoneration_de_2025 check (exoneration_zone_prioritaire is null or annee = 2025)')
    expect(MIGRATION).toContain('add constraint parametres_des_cotisations_exoneration_en_cumul check (exoneration_zone_prioritaire is not true or cumul_emploi_retraite is true)')
    expect(EXERCICE_DE_L_EXONERATION).toBe(2025)
    expect(EXERCICE_DE_L_EXONERATION_EN_ZONE_PRIORITAIRE).toBe(EXERCICE_DE_L_EXONERATION)
    expect(MIGRATION).toContain('and p_annee <> 2025 then')
  })

  it('la garde de tête lit le corps de la production, la garde de fin celui qu’elle pose ; le retour rend celui de la production', () => {
    const production = md5(corps(derniereDefinitionSql(FONCTION, avantElle)))
    const neuve = md5(corps(fonction(MIGRATION, 'migration')))
    expect(bloc(MIGRATION, 'garde')).toContain(`<> '${production}'`)
    expect(bloc(MIGRATION, 'fin')).toContain(`<> '${neuve}'`)
    expect(bloc(RETOUR, 'garde')).toContain(`<> '${neuve}'`)
    expect(md5(corps(fonction(RETOUR, 'retour')))).toBe(production)
    expect(MIGRATION).not.toMatch(/\b(drop|truncate)\b|delete from/i)
    expect(MIGRATION).not.toContain('\\')
    expect(RETOUR.split('\n').filter((l) => /^\s*drop /i.test(l))).toEqual([
      '  drop constraint parametres_des_cotisations_exoneration_en_cumul,',
      '  drop constraint parametres_des_cotisations_exoneration_de_2025,',
      '  drop column exoneration_zone_prioritaire;',
    ])
  })

  it('le drapeau suit l’export : levé, la migration y est (236, 17/11/2026)', () => {
    expect(EXPORTEE).toBe(true)
    expect(EXONERATION_EN_ZONE_PRIORITAIRE_PREVUE).toBe(EXPORTEE)
  })

  it('l’essai attend les mots du module', () => {
    expect(ESSAI).toContain(`'${REFUS_EXONERATION_HORS_DE_2025.replace('%', '2026').replace(/'/g, "''")}'`)
    expect(ESSAI).toContain(`'${REFUS_EXONERATION_SANS_LE_CUMUL.replace(/'/g, "''")}'`)
  })
})

describe('RET2-Q2 — la lecture d’une ligne, l’exercice, la saisie', () => {
  const ligne = (annee: number, cumul: unknown, exoneration: unknown) =>
    ({ annee, acre: null, taux_dentiste: null, cumul_emploi_retraite: cumul, dispense_complementaire: null, exoneration_zone_prioritaire: exoneration })

  it('levé : l’exonération lue, booléenne ou nulle ; d’une autre forme, hors de 2025 ou sans le cumul, la ligne ne se croit pas', () => {
    expect(lireParametresDUnExercice(ligne(2025, true, true), true, true)?.medecin)
      .toEqual({ cumulEmploiRetraite: true, dispenseComplementaire: null, exonerationZonePrioritaire: true })
    expect(lireParametresDUnExercice(ligne(2026, true, null), true, true)?.medecin?.exonerationZonePrioritaire).toBeNull()
    expect(lireParametresDUnExercice(ligne(2025, true, 'oui'), true, true)).toBeNull()
    expect(lireParametresDUnExercice(ligne(2026, true, false), true, true)).toBeNull()
    expect(lireParametresDUnExercice(ligne(2025, false, true), true, true)).toBeNull()
    expect(lireParametresDUnExercice({ annee: 2025, acre: null, taux_dentiste: null, cumul_emploi_retraite: null, dispense_complementaire: null }, true, true))
      .toBeNull()
    // Baissé : les cinq colonnes de RET-Q2, l'exonération ni lue ni rendue.
    expect(lireParametresDUnExercice(ligne(2025, true, true), true, false)?.medecin).toEqual({ cumulEmploiRetraite: true, dispenseComplementaire: null })
  })

  it('ce que l’estimation reçoit de l’exercice : l’exonération telle que lue, nulle sans ligne ; baissé, absente', () => {
    const lecture: LectureDesParametres = {
      dossierId: 'd', etat: 'lus', debutActivite: null,
      parExercice: new Map([[2025, { acre: null, tauxDentiste: null, medecin: { cumulEmploiRetraite: true, dispenseComplementaire: null, exonerationZonePrioritaire: true } }]]),
    }
    expect(casesDuMedecinDeLExercice(lecture, 2025, true)?.exonerationZonePrioritaire).toBe(true)
    expect(casesDuMedecinDeLExercice(lecture, 2026, true)).toEqual({ cumulEmploiRetraite: null, dispenseComplementaire: null, exonerationZonePrioritaire: null })
    expect(casesDuMedecinDeLExercice(lecture, 2025, false)).toEqual({ cumulEmploiRetraite: true, dispenseComplementaire: null })
  })

  it('les refus de la base redits avant le clic, sur la saisie telle qu’elle part', () => {
    const six = { debut_activite: null, acre: null, taux_dentiste: null, cumul_emploi_retraite: true, dispense_complementaire: null }
    expect(refusDeLExoneration({ ...six, exoneration_zone_prioritaire: true }, 2025)).toBeNull()
    expect(refusDeLExoneration({ ...six, exoneration_zone_prioritaire: false }, 2026)).toBe(REFUS_EXONERATION_HORS_DE_2025.replace('%', '2026'))
    expect(refusDeLExoneration({ ...six, exoneration_zone_prioritaire: null }, 2026)).toBeNull()
    expect(refusDeLExoneration({ ...six, cumul_emploi_retraite: null, exoneration_zone_prioritaire: true }, 2025)).toBe(REFUS_EXONERATION_SANS_LE_CUMUL)
    expect(refusDeLExoneration({ ...six, cumul_emploi_retraite: false, exoneration_zone_prioritaire: false }, 2025)).toBeNull()
    // Sous la forme à cinq clés, rien à redire : la carte ne l'envoie qu'avec le drapeau baissé.
    expect(refusDeLExoneration(six, 2026)).toBeNull()
  })
})

describe('RET2-Q2 — la lecture des paramètres d’un dossier, sous les deux états du drapeau', () => {
  it('levé : la colonne nommée, l’exonération lue avec les deux cases', async () => {
    faux.selects = []
    const lecture = await lireLesParametresDesCotisationsSelon('d', true, true, true)
    expect(faux.selects).toContain('parametres_des_cotisations:id, annee, acre, taux_dentiste, cumul_emploi_retraite, dispense_complementaire, exoneration_zone_prioritaire')
    expect(lecture.etat === 'lus' && lecture.parExercice.get(2025)?.medecin)
      .toEqual({ cumulEmploiRetraite: true, dispenseComplementaire: null, exonerationZonePrioritaire: true })
  })
  it('baissé (l’état servi) : les colonnes de RET-Q2, l’exonération ni demandée ni rendue', async () => {
    faux.selects = []
    const lecture = await lireLesParametresDesCotisationsSelon('d', true, true, false)
    expect(faux.selects).toContain('parametres_des_cotisations:id, annee, acre, taux_dentiste, cumul_emploi_retraite, dispense_complementaire')
    expect(lecture.etat === 'lus' && lecture.parExercice.get(2025)?.medecin).toEqual({ cumulEmploiRetraite: true, dispenseComplementaire: null })
  })
})
