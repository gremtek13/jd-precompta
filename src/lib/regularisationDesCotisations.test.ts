import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  NATURES, NATURES_A_PART, ORGANISMES, anneesPayables, descriptionDite, estimerLaRegularisation, lireLaDescription,
  saisieDeLaDescription, type EntreeRegularisation,
} from './regularisationDesCotisations'
import { derniereDefinitionSql } from '../test/schema'
import { estimerCotisationsUrssaf, type EstimationCotisations, type ResultatEstimation } from './voletSocialPamc'
import { formatMoney } from './format'
import type { CotisationDeclaree } from './types'

// Des montants construits à la main : les définitives sont un total posé, jamais recalculé ici (le calcul est celui de
// lib/voletSocialPamc.ts, éprouvé contre le moteur de l'Urssaf) ; les échéances, des appels ronds dont la somme se lit.
const MIGRATION = readFileSync(new URL('../../supabase/schema/20261107165415_regularisation_des_cotisations.sql', import.meta.url), 'utf8')
const RETOUR = readFileSync(new URL('../../supabase/preparees/retour/20261107170100_retour_regularisation_des_cotisations.sql', import.meta.url), 'utf8')
const ESSAI = readFileSync(new URL('../../supabase/essais/regularisationDesCotisations.sql', import.meta.url), 'utf8')
const md5 = (s: string) => createHash('md5').update(s, 'utf8').digest('hex')
// Le texte d'une définition de la fonction du gel, de son `create or replace` à son `$$;` ; et son corps, ce que `prosrc` garde.
const definitionDuGel = (texte: string) => {
  const debut = texte.indexOf('create or replace function public.garder_cotisation_valide()')
  return texte.slice(debut, texte.indexOf('$$;', debut) + 3)
}
const corps = (definition: string) => definition.slice(definition.indexOf('$$') + 2, definition.lastIndexOf('$$'))

const definitivesDe = (total: number): ResultatEstimation => ({
  disponible: true,
  estimation: {
    plafond: 0, plafondProratise: 0, acreAppliquee: false, abattement: 0, assiette: 0, csgCrdsDeductible: 0, csgCrdsNonDeductible: 0, maladie: 0, priseEnChargeMaladie: 0,
    priseEnChargeAllocationsFamiliales: 0, contributionAdditionnelle: 0, indemnitesJournalieres: 0, allocationsFamiliales: 0,
    curps: 0, formationProfessionnelle: 0, total,
  } satisfies EstimationCotisations,
})

let n = 0
const echeance = (e: Partial<CotisationDeclaree>): CotisationDeclaree => ({
  id: `c${String(++n).padStart(3, '0')}`, dossier_id: 'd', echeance: '2026-01-05', montant_appele: 0, montant_verse: null,
  montant_csg_crds: null, created_at: '2026-01-01T00:00:00Z', previsionnel: false, paiement_personnel_le: null,
  organisme: null, annee_payee: null, nature: null, part_regularisation: null, ...e,
})
// Douze provisionnelles de 400 € de l'Urssaf pour 2026 (4 800 €), le 5 de chaque mois.
const douzeProvisionnelles = () => Array.from({ length: 12 }, (_, i) => echeance({
  echeance: `2026-${String(i + 1).padStart(2, '0')}-05`, montant_appele: 400, organisme: 'urssaf', annee_payee: 2026, nature: 'provisionnelle',
}))
const entree = (e: Partial<EntreeRegularisation>): EntreeRegularisation => ({
  annee: 2026, definitives: definitivesDe(6000), echeances: douzeProvisionnelles(), exerciceValide: true, aujourdhui: '2027-02-15', ...e,
})
const estimee = (e: Partial<EntreeRegularisation>) => {
  const r = estimerLaRegularisation(entree(e))
  if (r.etat !== 'estimee') throw new Error(`attendue estimée : ${r.manques.join(' | ')}`)
  return r
}
const manques = (e: Partial<EntreeRegularisation>) => {
  const r = estimerLaRegularisation(entree(e))
  if (r.etat !== 'inconnue') throw new Error('attendue inconnue')
  return r.manques
}

describe('les listes fermées, confrontées à la migration', () => {
  it('les douze organismes et les trois natures sont ceux des contraintes, dans leur ordre', () => {
    const liste = (nom: string) => {
      const m = new RegExp(`${nom} check \\((?:organisme|nature) in \\(([^)]*)\\)`).exec(MIGRATION)
      return m ? [...m[1].matchAll(/'([a-z]+)'/g)].map((x) => x[1]) : []
    }
    expect(liste('cotisations_declarees_organisme_liste')).toEqual([...ORGANISMES])
    expect(liste('cotisations_declarees_nature_liste')).toEqual([...NATURES])
    expect(MIGRATION).toContain('annee_payee >= extract(year from echeance)::integer - 5 and annee_payee <= extract(year from echeance)::integer + 1')
    expect(MIGRATION).toContain("nature is distinct from 'regularisation' or annee_payee is null or annee_payee <= extract(year from echeance)::integer")
    // Les bornes que le module applique, celles de ces deux contraintes.
    expect(anneesPayables('2026-03-05')).toEqual({ de: 2021, a: 2027 })
    expect(anneesPayables('2026-03-05', 'regularisation')).toEqual({ de: 2021, a: 2026 })
  })
  it('la part (TNS-Q2-B) : numeric, ses deux contraintes, les natures qui la portent', () => {
    expect(MIGRATION).toContain('add column part_regularisation numeric,')
    expect(MIGRATION).toContain("part_regularisation is null or (nature is not null and nature in ('provisionnelle', 'acompte') and annee_payee is not null)")
    expect(MIGRATION).toContain('part_regularisation is null or (part_regularisation <> 0 and abs(part_regularisation) <= abs(montant_appele))')
    expect([...NATURES_A_PART]).toEqual(['provisionnelle', 'acompte'])
    // Le retour la retire avec les trois autres, et sa garde les compte toutes les quatre.
    expect(RETOUR).toContain('drop column part_regularisation,')
    expect(RETOUR).toContain("and a.attname in ('organisme', 'annee_payee', 'nature', 'part_regularisation')) <> 4 then")
  })
})

describe('le gel : la description hors de sa comparaison, rien d’autre', () => {
  // La fonction d'avant la migration, telle que l'export la porte (paiement_personnel_des_cotisations), et le corps que la
  // production rendait le 07/11/2026 avant elle. Depuis que l'export porte la migration (07/11/2026), sa dernière
  // définition est celle de la migration : celle d'avant se lit dans l'export sans le fichier de la migration.
  const hier = `${derniereDefinitionSql('garder_cotisation_valide', (f) => !f.chemin.endsWith('_regularisation_des_cotisations.sql'))}$$;`
  it('l’export porte la migration : la dernière définition du gel est la sienne', () => {
    expect(`${derniereDefinitionSql('garder_cotisation_valide')}$$;`).toBe(definitionDuGel(MIGRATION))
  })
  it('la migration la remplace par le même texte, sa comparaison seule changée', () => {
    expect(md5(corps(hier))).toBe('dfa6faabda81af162016e620ea6375fe')
    const ligne = '      if to_jsonb(new) is distinct from to_jsonb(old) then\n'
    expect(hier.split(ligne)).toHaveLength(2)
    expect(definitionDuGel(MIGRATION)).toBe(hier.replace(ligne,
      "      if (to_jsonb(new) - 'organisme' - 'annee_payee' - 'nature' - 'part_regularisation')\n"
      + "         is distinct from (to_jsonb(old) - 'organisme' - 'annee_payee' - 'nature' - 'part_regularisation') then\n"))
  })
  it('la garde de tête exige le corps d’hier ; l’essai et la garde du retour, celui de la migration ; le retour remet celui d’hier', () => {
    const neuf = md5(corps(definitionDuGel(MIGRATION)))
    expect(MIGRATION).toContain(`is distinct from '${md5(corps(hier))}' then`)
    expect(ESSAI).toContain(`'OK', '${neuf}')`)
    expect(RETOUR).toContain(`is distinct from '${neuf}' then`)
    expect(definitionDuGel(RETOUR)).toBe(hier)
  })
  it('ni barre oblique inverse ni retour chariot, dans la migration, son retour ni son essai', () => {
    for (const texte of [MIGRATION, RETOUR, ESSAI]) expect(/[\\\r]/.test(texte)).toBe(false)
  })
})

describe('la saisie des quatre champs', () => {
  const lire = (organisme: string, annee: string, nature: string, date = '2026-03-05', part = '', appele: number | null = 800) =>
    lireLaDescription({ organisme, annee, nature, part }, date, appele)
  it('rien de dit : trois nuls, une échéance d’hier', () => {
    expect(lire('', '', '')).toEqual({ valeurs: { organisme: null, annee_payee: null, nature: null, part_regularisation: null } })
    expect(saisieDeLaDescription({})).toEqual({ organisme: '', annee: '', nature: '', part: '' })
    expect(saisieDeLaDescription({ part_regularisation: -150.5 }).part).toBe('-150.5')
  })
  it('les bornes de l’année payée : cinq ans avant, un an après', () => {
    expect(lire('urssaf', '2021', 'regularisation')).toEqual({ valeurs: { organisme: 'urssaf', annee_payee: 2021, nature: 'regularisation', part_regularisation: null } })
    expect(lire('carmf', '2027', 'provisionnelle')).toEqual({ valeurs: { organisme: 'carmf', annee_payee: 2027, nature: 'provisionnelle', part_regularisation: null } })
    expect(lire('urssaf', '2020', '')).toEqual({ refus: 'L’année payée d’une échéance de 2026 va de 2021 à 2027.' })
    expect(lire('urssaf', '2028', '')).toEqual({ refus: 'L’année payée d’une échéance de 2026 va de 2021 à 2027.' })
    expect(lire('urssaf', '26', '')).toEqual({ refus: 'L’année payée s’écrit en quatre chiffres.' })
    // Sans date lisible, les bornes attendent la date (la saisie la refuse d'elle-même).
    expect(lire('urssaf', '2020', '', '')).toEqual({ valeurs: { organisme: 'urssaf', annee_payee: 2020, nature: null, part_regularisation: null } })
  })
  it('une régularisation suit son année ; la même année se dit (une cessation)', () => {
    expect(lire('urssaf', '2027', 'regularisation')).toEqual({ refus: 'Une régularisation de 2027 ne s’appelle pas en 2026 : elle suit son année.' })
    expect(lire('urssaf', '2026', 'regularisation')).toEqual({ valeurs: { organisme: 'urssaf', annee_payee: 2026, nature: 'regularisation', part_regularisation: null } })
  })
  it('hors des listes, refusé ; la casse compte, comme en base', () => {
    expect(lire('URSSAF', '', '')).toEqual({ refus: 'L’organisme n’est pas de la liste.' })
    expect(lire('', '', 'definitive')).toEqual({ refus: 'La nature n’est pas de la liste.' })
  })
  it('la description dite en mots', () => {
    expect(descriptionDite({ organisme: 'carpimko', annee_payee: 2026, nature: 'provisionnelle' })).toBe('CARPIMKO, provisionnelle, 2026')
    expect(descriptionDite({ organisme: null, annee_payee: null, nature: null })).toBe('non décrite')
    expect(descriptionDite({ organisme: 'urssaf', annee_payee: 2026, nature: 'provisionnelle', part_regularisation: 150 }))
      .toBe(`Urssaf, provisionnelle, 2026, dont ${formatMoney(150)} de régularisation de 2025`)
    expect(descriptionDite({ organisme: 'urssaf', annee_payee: 2026, nature: 'provisionnelle', part_regularisation: -150 }))
      .toBe(`Urssaf, provisionnelle, 2026, après ${formatMoney(150)} de trop-versé de 2025 imputé`)
  })
})

describe('la part qui régularise l’année d’avant (TNS-Q2-B), sous les deux contraintes de la base', () => {
  const lire = (part: string, appele: number | null, nature = 'provisionnelle', annee = '2026') =>
    lireLaDescription({ organisme: 'urssaf', annee, nature, part }, '2026-01-05', appele)
  it('un prélèvement mixte de janvier : 550 appelés dont 150 de régularisation de 2025 ; la virgule admise', () => {
    expect(lire('150', 550)).toEqual({ valeurs: { organisme: 'urssaf', annee_payee: 2026, nature: 'provisionnelle', part_regularisation: 150 } })
    expect(lire('150,25', 550)).toMatchObject({ valeurs: { part_regularisation: 150.25 } })
    expect(lire('50', 500, 'acompte')).toMatchObject({ valeurs: { nature: 'acompte', part_regularisation: 50 } })
  })
  it('un trop-versé de 2025 imputé : une part négative, admise', () => {
    expect(lire('-150', 250)).toMatchObject({ valeurs: { part_regularisation: -150 } })
  })
  it('au plus le montant appelé, en valeur absolue (`…_part_regularisation_bornee`) : égal admis, un centime de plus refusé', () => {
    expect(lire('550', 550)).toMatchObject({ valeurs: { part_regularisation: 550 } })
    expect(lire('550.01', 550)).toEqual({
      refus: `La part de régularisation (${formatMoney(550.01)}) dépasse le montant appelé (${formatMoney(550)}) : elle n’en est qu’une part.`,
    })
    expect(lire('-300', 250)).toEqual({
      refus: `Le trop-versé imputé (${formatMoney(300)}) dépasse le montant appelé (${formatMoney(250)}) : un crédit plus fort que l’appel se dit par le versé — l’appelé de la provisionnelle, et le versé de ce que le prélèvement a payé.`,
    })
    expect(lire('0', 550)).toEqual({ refus: 'Une part de régularisation de zéro ne se dit pas : laisse le champ vide.' })
    expect(lire('-0.00', 550)).toEqual({ refus: 'Une part de régularisation de zéro ne se dit pas : laisse le champ vide.' })
    // Sans montant appelé lisible, la borne attend : la saisie se refuse d'elle-même.
    expect(lire('900', null)).toMatchObject({ valeurs: { part_regularisation: 900 } })
  })
  it('dite d’une provisionnelle ou d’un acompte et de son année seulement (`…_part_regularisation_nature`)', () => {
    const nature = 'La part de régularisation ne se dit que d’une provisionnelle ou d’un acompte : choisis sa nature.'
    expect(lire('10', 250, 'regularisation', '2025')).toEqual({ refus: nature })
    expect(lire('10', 250, '')).toEqual({ refus: nature })
    expect(lire('10', 250, 'provisionnelle', '')).toEqual({ refus: 'La part de régularisation régularise l’année d’avant l’année payée : dis l’année payée.' })
  })
  it('un montant, au centime', () => {
    expect(lire('150.555', 550)).toEqual({ refus: 'La part de régularisation n’est pas au centime.' })
    expect(lire('cent', 550)).toEqual({ refus: 'La part de régularisation n’est pas un montant.' })
    expect(lire('1e2', 550)).toEqual({ refus: 'La part de régularisation n’est pas un montant.' })
  })
})

describe('la régularisation estimée de 2026', () => {
  it('définitives moins les provisionnelles de l’Urssaf pour 2026 : due en 2027', () => {
    const r = estimee({})
    expect([r.definitives, r.appelees, r.regularisation, r.sens, r.payableEn, r.comptees.length]).toEqual([6000, 4800, 1200, 'due', 2027, 12])
    expect(r.reserves).toEqual([])
  })
  it('la régularisation de 2025 appelée en 2026, une caisse de retraite, une autre année : rien de compté', () => {
    const r = estimee({
      echeances: [
        ...douzeProvisionnelles(),
        echeance({ echeance: '2026-10-05', montant_appele: 300, organisme: 'urssaf', annee_payee: 2025, nature: 'regularisation' }),
        echeance({ echeance: '2026-04-05', montant_appele: 900, organisme: 'carpimko' }),
        echeance({ echeance: '2026-12-20', montant_appele: 410, organisme: 'urssaf', annee_payee: 2027, nature: 'provisionnelle' }),
        echeance({ echeance: '2025-12-05', montant_appele: 380, organisme: 'urssaf', annee_payee: 2025, nature: 'provisionnelle' }),
      ],
    })
    expect([r.appelees, r.regularisation]).toEqual([4800, 1200])
  })
  it('un acompte à valoir sur 2026 la paie aussi ; une provisionnelle de 2026 appelée en 2027 se compte', () => {
    const r = estimee({
      echeances: [
        ...douzeProvisionnelles(),
        echeance({ echeance: '2026-06-15', montant_appele: 500, organisme: 'urssaf', annee_payee: 2026, nature: 'acompte' }),
        echeance({ echeance: '2027-01-05', montant_appele: 100, organisme: 'urssaf', annee_payee: 2026, nature: 'provisionnelle' }),
      ],
    })
    expect([r.appelees, r.regularisation, r.sens]).toEqual([5400, 600, 'due'])
  })
  it('appelé au-delà des définitives : remboursée ; à égalité : nulle ; au centime', () => {
    expect([estimee({ definitives: definitivesDe(4000) }).regularisation, estimee({ definitives: definitivesDe(4000) }).sens]).toEqual([-800, 'remboursee'])
    expect(estimee({ definitives: definitivesDe(4800) }).sens).toBe('nulle')
    const auCentime = estimee({ echeances: [echeance({ echeance: '2026-02-05', montant_appele: 0.1, organisme: 'urssaf', annee_payee: 2026, nature: 'provisionnelle' }),
      echeance({ echeance: '2026-05-05', montant_appele: 0.2, organisme: 'urssaf', annee_payee: 2026, nature: 'provisionnelle' })] })
    expect([auCentime.appelees, auCentime.regularisation]).toEqual([0.3, 5999.7])
  })
  it('les montants APPELÉS, pas les versés', () => {
    const verse = douzeProvisionnelles().map((c) => ({ ...c, montant_verse: 1 }))
    expect(estimee({ echeances: verse }).appelees).toBe(4800)
  })
  it('les définitives sont le total du moteur, tel quel', () => {
    const definitives = estimerCotisationsUrssaf({
      annee: 2026, profession: 'auxiliaire_medical', remplacant: false, revenuBrutSocial: 60_000, revenuProfessionnelPositif: true,
      recettesBrutes: 90_000, honorairesConventionnes: 85_000, depassements: 0, parametres: { tenus: false },
    })
    if (!definitives.disponible) throw new Error(definitives.motif)
    expect(estimee({ definitives }).definitives).toBe(definitives.estimation.total)
  })
  it('ce qui peut bouger se dit à côté du chiffre : la 2035 pas validée, la régularisation déjà appelée', () => {
    expect(estimee({ exerciceValide: false }).reserves).toEqual(['La 2035 de 2026 n’est pas validée : l’estimation suit ses chiffres d’aujourd’hui.'])
    const r = estimee({ echeances: [...douzeProvisionnelles(),
      echeance({ echeance: '2027-10-05', montant_appele: 900, organisme: 'urssaf', annee_payee: 2026, nature: 'regularisation' })] })
    expect([r.appelees, r.dejaAppelee]).toEqual([4800, 900])
    expect(r.reserves).toEqual([`L’Urssaf a déjà appelé ${formatMoney(900)} de régularisation de 2026 : son avis l’emporte sur l’estimation.`])
  })
})

describe('le prélèvement qui paie la provisionnelle de N et la régularisation de N − 1 (TNS-Q2-B)', () => {
  // Le prélèvement de janvier 2026 : 550 €, la provisionnelle de 2026 (400 €) et 150 € de régularisation de 2025.
  const mixteDeJanvier = () => douzeProvisionnelles().map((c, i) => (i === 0 ? { ...c, montant_appele: 550, part_regularisation: 150 } : c))
  it('la part se retire de la provisionnelle de 2026 : l’appelé reste 4 800 €', () => {
    const r = estimee({ echeances: mixteDeJanvier() })
    expect([r.appelees, r.partsDeLAnneeDAvant, r.regularisation, r.comptees.length]).toEqual([4800, 150, 1200, 12])
    expect(r.reserves).toEqual([])
  })
  it('… et compte dans la régularisation de 2025, déjà appelée, à côté du chiffre de 2025', () => {
    const provisionnelles2025 = Array.from({ length: 12 }, (_, i) => echeance({
      echeance: `2025-${String(i + 1).padStart(2, '0')}-05`, montant_appele: 350, organisme: 'urssaf', annee_payee: 2025, nature: 'provisionnelle',
    }))
    const r = estimee({ annee: 2025, echeances: [...provisionnelles2025, ...mixteDeJanvier()] })
    expect([r.appelees, r.dejaAppelee, r.regularisation]).toEqual([4200, 150, 1800])
    expect(r.reserves).toEqual([`L’Urssaf a déjà appelé ${formatMoney(150)} de régularisation de 2025 : son avis l’emporte sur l’estimation.`])
    // Avec une échéance « régularisation de 2025 » de plus : les deux s'additionnent.
    const avecAvis = estimee({ annee: 2025, echeances: [...provisionnelles2025, ...mixteDeJanvier(),
      echeance({ echeance: '2026-10-05', montant_appele: 60, organisme: 'urssaf', annee_payee: 2025, nature: 'regularisation' })] })
    expect(avecAvis.dejaAppelee).toBe(210)
  })
  it('un trop-versé de 2025 imputé sur l’appel d’octobre : la provisionnelle de 2026 reste entière, 2025 se dit remboursée', () => {
    const imputee = douzeProvisionnelles().map((c, i) => (i === 9 ? { ...c, montant_appele: 250, part_regularisation: -150 } : c))
    const r = estimee({ echeances: imputee })
    expect([r.appelees, r.partsDeLAnneeDAvant, r.regularisation]).toEqual([4800, -150, 1200])
    const provisionnelles2025 = Array.from({ length: 12 }, (_, i) => echeance({
      echeance: `2025-${String(i + 1).padStart(2, '0')}-05`, montant_appele: 350, organisme: 'urssaf', annee_payee: 2025, nature: 'provisionnelle',
    }))
    expect(estimee({ annee: 2025, echeances: [...provisionnelles2025, ...imputee] }).reserves)
      .toEqual([`L’Urssaf a déjà remboursé ou imputé ${formatMoney(150)} de trop-versé de 2025 : son avis l’emporte sur l’estimation.`])
  })
  it('une part d’une caisse de retraite, ou d’une échéance sans organisme, ne compte pas pour l’Urssaf', () => {
    const r = estimee({ annee: 2025, echeances: [
      ...Array.from({ length: 2 }, (_, i) => echeance({ echeance: `2025-0${i + 1}-05`, montant_appele: 2100, organisme: 'urssaf', annee_payee: 2025, nature: 'provisionnelle' })),
      echeance({ echeance: '2026-01-05', montant_appele: 900, organisme: 'carpimko', annee_payee: 2026, nature: 'provisionnelle', part_regularisation: 300 }),
      echeance({ echeance: '2026-02-05', montant_appele: 400, annee_payee: 2026, nature: 'provisionnelle', part_regularisation: 100 }),
    ] })
    expect(r.dejaAppelee).toBeNull()
  })
  it('une échéance non décrite fait toujours taire l’estimation, en disant pourquoi', () => {
    const avecUneNonDecrite = [...mixteDeJanvier(), echeance({ echeance: '2026-02-20', montant_appele: 812 })]
    expect(manques({ echeances: avecUneNonDecrite })).toEqual([
      `L’échéance du 20/02/2026 (${formatMoney(812)}) ne dit pas qui l’appelle : décris-la dans l’onglet Cotisations.`,
    ])
    // Pour 2025 aussi : une échéance de 2026 sans année dite pourrait payer 2025.
    expect(estimerLaRegularisation(entree({ annee: 2025, echeances: avecUneNonDecrite }))).toMatchObject({
      etat: 'inconnue', manques: expect.arrayContaining([expect.stringContaining('L’échéance du 20/02/2026')]),
    })
  })
})

describe('ce qu’elle ne sait pas, elle le dit, sans chiffre', () => {
  it('l’année pas finie : le revenu n’est pas arrêté', () => {
    expect(manques({ aujourdhui: '2026-12-31' })).toEqual(['L’année 2026 n’est pas finie : ni son revenu ni les appels de l’Urssaf pour 2026 ne sont arrêtés.'])
    expect(estimerLaRegularisation(entree({ aujourdhui: '2027-01-01' })).etat).toBe('estimee')
  })
  it('les définitives indisponibles : le motif du moteur', () => {
    expect(manques({ definitives: { disponible: false, motif: 'Choisissez la profession pour estimer les cotisations.' } }))
      .toEqual(['Les cotisations définitives ne s’estiment pas : Choisissez la profession pour estimer les cotisations.'])
  })
  it('une échéance qui pourrait payer 2026 à l’Urssaf sans les trois champs : nommée, et pas de chiffre', () => {
    const avec = (e: Partial<CotisationDeclaree>) => manques({ echeances: [...douzeProvisionnelles(), echeance({ montant_appele: 812, ...e })] })
    expect(avec({ echeance: '2026-10-05' })).toEqual([`L’échéance du 05/10/2026 (${formatMoney(812)}) ne dit pas qui l’appelle : décris-la dans l’onglet Cotisations.`])
    expect(avec({ echeance: '2027-01-05', annee_payee: 2026, nature: 'provisionnelle' })).toEqual([`L’échéance du 05/01/2027 (${formatMoney(812)}) ne dit pas qui l’appelle : décris-la dans l’onglet Cotisations.`])
    expect(avec({ echeance: '2026-10-05', organisme: 'urssaf' })).toEqual([`L’échéance du 05/10/2026 (${formatMoney(812)}) ne dit pas l’année qu’elle paie : décris-la dans l’onglet Cotisations.`])
    expect(avec({ echeance: '2026-10-05', organisme: 'urssaf', annee_payee: 2026 })).toEqual([`L’échéance du 05/10/2026 (${formatMoney(812)}) ne dit pas sa nature : décris-la dans l’onglet Cotisations.`])
  })
  it('sans année dite, une échéance que la base laisserait payer 2026 se nomme, de 2025 à 2031 ; au-delà, elle ne se lit pas', () => {
    const avec = (e: Partial<CotisationDeclaree>) => estimerLaRegularisation(entree({ echeances: [...douzeProvisionnelles(), echeance({ montant_appele: 812, ...e })] }))
    // Un appel de janvier 2027 (la régularisation de 2026, ou une provisionnelle en retard), un appel de décembre 2025 qui
    // ouvre 2026, et tout ce que les bornes de la base admettent : de cinq ans avant l'année payée à un an après.
    for (const date of ['2027-01-05', '2025-12-05', '2025-03-05', '2031-06-05']) {
      const r = avec({ echeance: date })
      expect(r.etat === 'inconnue' && r.manques).toEqual([expect.stringContaining('ne dit pas qui l’appelle : décris-la dans l’onglet Cotisations.')])
    }
    expect(avec({ echeance: '2027-10-05', organisme: 'urssaf', nature: 'regularisation' })).toMatchObject({
      etat: 'inconnue', manques: [`L’échéance du 05/10/2027 (${formatMoney(812)}) ne dit pas l’année qu’elle paie : décris-la dans l’onglet Cotisations.`],
    })
    // Ce que les bornes écartent de 2026 ne se lit pas : deux ans avant, six ans après, une régularisation de l'année d'avant.
    for (const e of [{ echeance: '2024-12-05' }, { echeance: '2032-01-05' }, { echeance: '2025-10-05', organisme: 'urssaf' as const, nature: 'regularisation' as const }]) {
      expect(avec(e).etat).toBe('estimee')
    }
  })
  it('un appel manque : aucune provisionnelle, ou une encore prévisionnelle', () => {
    expect(manques({ echeances: [] })).toEqual(['Aucune provisionnelle de l’Urssaf n’est saisie pour 2026 : l’appelé manque.'])
    const prevue = douzeProvisionnelles().map((c, i) => (i === 11 ? { ...c, previsionnel: true } : c))
    expect(manques({ echeances: prevue })).toEqual(['L’échéance du 05/12/2026 est encore prévisionnelle : l’appel de l’Urssaf n’est pas là.'])
  })
  it('une échéance lue sans les colonnes (la migration pas appliquée) se dit non décrite, jamais comptée', () => {
    const sansColonnes = douzeProvisionnelles().map(({ organisme: _o, annee_payee: _a, nature: _n, part_regularisation: _p, ...reste }) => reste as CotisationDeclaree)
    expect(manques({ echeances: sansColonnes })).toHaveLength(12)
  })
})
