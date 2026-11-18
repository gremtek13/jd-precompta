import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  CUMUL_REPRIS_PREVU, champsDuCumulRepris, cumulReprisSaisi, phraseDuCumulRepris, refusCumulRepris, refusDuCumulFige,
  type SaisieDuCumulRepris,
} from './cumulRepris'
import { derniereDefinitionSql, indiceSql } from '../test/schema'

// EXP58-Q5 : LE CUMUL REPRIS D'UN BIEN, À L'ÉCRAN. Ce que l'écran dit avant le clic — les refus des trois contraintes de la
// migration `cumul_repris_des_biens` et de sa garde —, ce qu'il écrit, et la migration confrontée à son retour, à son essai et à
// l'export ; le drapeau suit l'export. Données FICTIVES.

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

const MIGRATION = leFichier(/^\d{14}_cumul_repris_des_biens\.sql$/, ['../../supabase/preparees/', '../../supabase/schema/'])
const RETOUR = leFichier(/^\d{14}_retour_cumul_repris_des_biens\.sql$/, ['../../supabase/preparees/retour/'])
const ESSAI = readFileSync(new URL('../../supabase/essais/cumulReprisDesBiens.sql', import.meta.url), 'utf8')
const EXPORTEE = readdirSync(new URL('../../supabase/schema/', import.meta.url).pathname)
  .some((f) => /^\d{14}_cumul_repris_des_biens\.sql$/.test(f))
const md5 = (texte: string) => createHash('md5').update(texte, 'utf8').digest('hex')
/** Le corps d'une fonction tel que la base le garde (`prosrc`) : entre ses deux délimiteurs `$$` — ou jusqu'à la fin, pour
 *  une définition de l'export (`derniereDefinitionSql` en écarte le délimiteur fermant). */
const corps = (texte: string, signature: string) => {
  const remplacee = indiceSql(texte, `create or replace function public.${signature}`)
  const debut = remplacee >= 0 ? remplacee : indiceSql(texte, `create function public.${signature}`)
  expect(debut, signature).toBeGreaterThanOrEqual(0)
  const ouverture = texte.indexOf('$$', debut) + 2
  const fermeture = texte.indexOf('$$', ouverture)
  return texte.slice(ouverture, fermeture < 0 ? undefined : fermeture)
}

const OUVERTURE = '2025-01-01'
const saisie = (o: Partial<SaisieDuCumulRepris> = {}): SaisieDuCumulRepris => ({
  valeur: '4800', dateAcquisition: '2022-03-15', dateMiseEnService: '', duree: '5', cumulRepris: '2000', ...o,
})

describe('cumulReprisSaisi et champsDuCumulRepris — ce que le champ donne, ce que l’écran écrit', () => {
  it('vide : aucun cumul, les deux colonnes nulles ; sinon le montant au centime et le 31 décembre de la reprise', () => {
    expect(cumulReprisSaisi('  ')).toBeNull()
    expect(cumulReprisSaisi('2000,50')).toBe(2000.5)
    expect(cumulReprisSaisi('abc')).toBeNaN()
    expect(champsDuCumulRepris('', OUVERTURE)).toEqual({ cumul_repris: null, cumul_repris_au: null })
    expect(champsDuCumulRepris('2000,5', OUVERTURE)).toEqual({ cumul_repris: 2000.5, cumul_repris_au: '2024-12-31' })
    // Une ouverture qui n'est pas un 1er janvier : le 31 décembre qui précède son année.
    expect(champsDuCumulRepris('0', '2025-03-01')).toEqual({ cumul_repris: 0, cumul_repris_au: '2024-12-31' })
    // Sans ouverture, rien n'est daté : le refus le dit avant (`refusCumulRepris`).
    expect(champsDuCumulRepris('100', null)).toEqual({ cumul_repris: null, cumul_repris_au: null })
  })
})

// Les refus redisent les trois contraintes, sur les cas que l'essai de la base joue (étapes 3 à 3m) : le même jugement des
// deux côtés, aux mêmes bornes.
describe('refusCumulRepris — les contraintes de la base, dites avant le clic', () => {
  it('laisse passer un cumul de l’ancien tableau, nul ou égal à la valeur', () => {
    expect(refusCumulRepris(saisie(), OUVERTURE)).toBeNull()
    expect(refusCumulRepris(saisie({ cumulRepris: '' }), OUVERTURE)).toBeNull()
    expect(refusCumulRepris(saisie({ cumulRepris: '0' }), OUVERTURE)).toBeNull()
    expect(refusCumulRepris(saisie({ cumulRepris: '4800' }), OUVERTURE)).toBeNull()
  })

  it('refuse sans ouverture, un montant illisible ou négatif, un millième', () => {
    expect(refusCumulRepris(saisie(), null)).toMatch(/^Un cumul repris se saisit dans un dossier ouvert par une balance reprise/)
    expect(refusCumulRepris(saisie({ cumulRepris: 'abc' }), OUVERTURE)).toBe('Le cumul repris est un montant positif ou nul.')
    expect(refusCumulRepris(saisie({ cumulRepris: '-0,01' }), OUVERTURE)).toBe('Le cumul repris est un montant positif ou nul.')
    expect(refusCumulRepris(saisie({ cumulRepris: '100,005' }), OUVERTURE)).toBe('Le cumul repris se saisit au centime.')
  })

  it('un bien acquis après le 31 décembre de la reprise n’en porte pas (`immobilisations_cumul_repris_date`)', () => {
    expect(refusCumulRepris(saisie({ dateAcquisition: '2025-01-01', cumulRepris: '0' }), OUVERTURE))
      .toBe('Un cumul repris au 31/12/2024 est celui d’un bien acquis au plus tard ce jour-là : vide le champ.')
    expect(refusCumulRepris(saisie({ dateAcquisition: '2024-12-31', cumulRepris: '0' }), OUVERTURE)).toBeNull()
  })

  it('ne dépasse pas la valeur (`immobilisations_cumul_repris_borne`), jugée telle qu’elle part', () => {
    expect(refusCumulRepris(saisie({ cumulRepris: '4800,01' }), OUVERTURE)).toMatch(/^Le cumul repris ne dépasse pas la valeur du bien, 4\s800,00\s€/)
    expect(refusCumulRepris(saisie({ valeur: '1999,99' }), OUVERTURE)).toMatch(/^Le cumul repris ne dépasse pas la valeur du bien, 1\s999,99\s€/)
    // Une valeur illisible : `refusBien` le dit avant, rien ici.
    expect(refusCumulRepris(saisie({ valeur: '' }), OUVERTURE)).toBeNull()
  })

  it('un cumul positif suppose le bien en service ce jour-là ; nul, il passe (`immobilisations_cumul_repris_plan`)', () => {
    const tardif = { dateAcquisition: '2024-11-02', dateMiseEnService: '2025-01-01', valeur: '1200', duree: '4' }
    expect(refusCumulRepris(saisie({ ...tardif, cumulRepris: '10' }), OUVERTURE))
      .toMatch(/^Le bien est mis en service après le 31\/12\/2024 : rien n’en était amorti ce jour-là\./)
    expect(refusCumulRepris(saisie({ ...tardif, cumulRepris: '0' }), OUVERTURE)).toBeNull()
    // Mis en service le 31 décembre même : un jour d'amortissement, un cumul positif passe.
    expect(refusCumulRepris(saisie({ dateAcquisition: '2024-12-31', valeur: '1000', duree: '3', cumulRepris: '0,28' }), OUVERTURE)).toBeNull()
  })

  it('un cumul plus petit que la valeur suppose un plan qui court encore un jour après lui', () => {
    const fini = { valeur: '600', dateAcquisition: '2023-01-01', duree: '2' }
    expect(refusCumulRepris(saisie({ ...fini, cumulRepris: '599,99' }), OUVERTURE)).toMatch(
      /^Le plan du registre, 2 ans depuis le 01\/01\/2023, est fini au 31\/12\/2024 : le cumul repris vaut alors la valeur du bien, 600,00\s€/)
    expect(refusCumulRepris(saisie({ ...fini, cumulRepris: '600' }), OUVERTURE)).toBeNull()
    // Un jour de plus (mis en service le 2 janvier) : le plan finit le 1er janvier 2025, le cumul plus petit passe.
    expect(refusCumulRepris(saisie({ ...fini, dateAcquisition: '2023-01-02', cumulRepris: '599,99' }), OUVERTURE)).toBeNull()
    expect(refusCumulRepris(saisie({ valeur: '600', dateAcquisition: '2023-01-01', duree: '1', cumulRepris: '500' }), OUVERTURE))
      .toMatch(/^Le plan du registre, 1 an depuis le/)
  })
})

describe('refusDuCumulFige — la garde de la base, dite avant le clic', () => {
  const porte = { cumul_repris: 2000, cumul_repris_au: '2024-12-31' }

  it('se tait sur un cumul qui ne change pas, même figé', () => {
    expect(refusDuCumulFige(porte, { ...porte }, [2025])).toBeNull()
  })

  it('un exercice validé qui suit la date du cumul le fige : changé, retiré ou posé', () => {
    const fige = 'L\'exercice 2025 est validé : le cumul repris d’un bien ne change plus.'
    expect(refusDuCumulFige(porte, { cumul_repris: 2100, cumul_repris_au: '2024-12-31' }, [2025])).toBe(fige)
    expect(refusDuCumulFige(porte, { cumul_repris: null, cumul_repris_au: null }, [2025])).toBe(fige)
    expect(refusDuCumulFige({ cumul_repris: null, cumul_repris_au: null }, porte, [2025])).toBe(fige)
    // Une ligne d'avant la migration : les colonnes absentes valent nulles.
    expect(refusDuCumulFige({}, porte, [2025])).toBe(fige)
    expect(refusDuCumulFige(porte, { cumul_repris: 2100, cumul_repris_au: '2024-12-31' }, [2026]))
      .toBe('L\'exercice 2025 est figé par la validation de l\'exercice 2026 : le cumul repris d’un bien ne change plus.')
  })

  it('un exercice validé à la date même du cumul ne le fige pas, ni rien sans exercice validé', () => {
    expect(refusDuCumulFige(porte, { cumul_repris: 2100, cumul_repris_au: '2024-12-31' }, [2024])).toBeNull()
    expect(refusDuCumulFige(porte, { cumul_repris: 2100, cumul_repris_au: '2024-12-31' }, [])).toBeNull()
    expect(refusDuCumulFige(null, { cumul_repris: null, cumul_repris_au: null }, [2025])).toBeNull()
  })

  it('dit la phrase que la garde de la migration lève, sur l’exercice qui suit la date', () => {
    expect(MIGRATION).toContain("raise exception '% : le cumul repris d''un bien ne change plus.',\n"
      + '          public.exercice_fige(old.dossier_id, extract(year from old.cumul_repris_au)::integer + 1)')
    expect(MIGRATION).toContain('public.exercice_fige(new.dossier_id, extract(year from new.cumul_repris_au)::integer + 1)')
    expect(MIGRATION.match(/v_frontiere is not null and v_frontiere > (old|new)\.cumul_repris_au/g)).toHaveLength(2)
  })
})

describe('phraseDuCumulRepris', () => {
  it('dit la date du cumul et ce que le plan en fait', () => {
    expect(phraseDuCumulRepris(OUVERTURE)).toMatch(/^Les amortissements cumulés au 31\/12\/2024, ceux de l’ancien tableau : le plan continue/)
  })
})

describe('la migration cumul_repris_des_biens, son retour et son essai', () => {
  it('pose deux colonnes nullables sans défaut et trois contraintes de la ligne, sans fonction dans les contraintes', () => {
    expect(MIGRATION).toContain('alter table public.immobilisations add column cumul_repris numeric;')
    expect(MIGRATION).toContain('alter table public.immobilisations add column cumul_repris_au date;')
    const contraintes = [...MIGRATION.matchAll(/add constraint (immobilisations_cumul_repris_\w+)\n\s+check \(([\s\S]*?)\);\n/g)]
    expect(contraintes.map((m) => m[1])).toEqual(['immobilisations_cumul_repris_date', 'immobilisations_cumul_repris_borne', 'immobilisations_cumul_repris_plan'])
    // Le socle se rejoue avant les fonctions : aucune contrainte ne les appelle.
    for (const [, , texte] of contraintes) expect(texte).not.toMatch(/public\.|rang_360/)
    // Les définitions que le catalogue rend, que l'essai attend.
    expect(ESSAI).toContain('immobilisations_cumul_repris_borne CHECK (((cumul_repris IS NULL) OR ((cumul_repris = round(cumul_repris, 2)) AND (cumul_repris >= (0)::numeric) AND (cumul_repris <= valeur))))')
  })

  it('remplace ecrire_dotation_amortissement depuis le corps exporté, et ne change que la dotation attendue', () => {
    const avant = corps(derniereDefinitionSql('ecrire_dotation_amortissement'), 'ecrire_dotation_amortissement(')
    const apres = corps(MIGRATION, 'ecrire_dotation_amortissement(')
    // La garde de tête nomme le corps exporté ; le retour le rend, et sa garde de fin le vérifie.
    expect(MIGRATION).toContain(`'${md5(avant)}'`)
    expect(RETOUR).toContain(`'${md5(avant)}'`)
    expect(corps(RETOUR, 'ecrire_dotation_amortissement(')).toBe(avant)
    // Le corps neuf : celui que la garde de fin, l'essai et le retour nomment.
    for (const texte of [MIGRATION, RETOUR, ESSAI]) expect(texte).toContain(md5(apres))
    // Hors de la dotation attendue, le corps d'hier au caractère près : ses deux bouts, avant et après le bloc neuf.
    const coupure = avant.indexOf('  else\n    v_montant := public.dotation_amortissement(')
    expect(coupure).toBeGreaterThan(0)
    expect(apres.startsWith(avant.slice(0, coupure))).toBe(true)
    const suite = avant.slice(avant.indexOf('  end if;\n\n  if v_montant > 0 then'))
    expect(apres.endsWith(suite)).toBe(true)
  })

  it('le retour se colle par le cabinet, refuse dès qu’un bien porte un cumul, et défait tout dans l’ordre', () => {
    expect(RETOUR).toMatch(/À COLLER par le\n-- cabinet/)
    expect(RETOUR).toContain('where cumul_repris is not null or cumul_repris_au is not null')
    const ordre = ['drop trigger immobilisations_garde_du_cumul_repris', 'drop function public.garder_cumul_repris()',
      'create or replace function public.ecrire_dotation_amortissement(', 'drop function public.dotation_amortissement_continue(',
      'drop function public.amortissement_cumule_continue_centimes(', 'drop constraint immobilisations_cumul_repris_plan',
      'drop column cumul_repris_au;', 'drop column cumul_repris;']
    const positions = ordre.map((m) => RETOUR.indexOf(m))
    expect(positions.every((p) => p > 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  })

  it('se colle par le cabinet : son corps retire l’écriture qu’il remplace', () => {
    expect(MIGRATION).toMatch(/COLLÉE PAR LE CABINET/)
    expect(MIGRATION).toMatch(/\bdelete from public\.ecritures_brouillon where immobilisation_id = p_immobilisation_id and date = v_date;/)
    expect(MIGRATION).not.toMatch(/\b(drop|truncate)\b/i)
    expect(MIGRATION).not.toContain('\\')
  })

  it('l’essai se dit EN ATTENTE sans elle, et se joue d’un seul appel', () => {
    expect(ESSAI).toContain("'etape', '0. EN ATTENTE de la migration cumul_repris_des_biens (EXP58-Q5)'")
    expect(ESSAI).not.toMatch(/^\s*(delete|truncate|drop)\b/im)
  })

  it('le drapeau suit l’export : baissé tant que la migration n’y est pas, levé le jour où elle y entre', () => {
    expect(CUMUL_REPRIS_PREVU).toBe(EXPORTEE)
  })
})
