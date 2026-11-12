import { describe, expect, it } from 'vitest'
import {
  CHOIX_RECOMMANDES,
  estDateCivile,
  exerciceCivil,
  exerciceDeLaDate,
  exerciceDuMillesime,
  exerciceSuivantPropose,
  joursEn360,
  libelleDeLExercice,
  libelleDesBornes,
  millesimeDe,
  refusDesExercices,
  refusDUnExercice,
  type ChoixDesExercices,
  type ExerciceDeclare,
  type RegimeDesExercices,
} from './exercices'

const declare = (e: Partial<ExerciceDeclare> & Pick<ExerciceDeclare, 'debut' | 'fin'>): ExerciceDeclare => ({
  nature: 'ordinaire', decision: null, decision_le: null, ...e,
})
const codes = (refus: { code: string }[]) => refus.map((r) => r.code)
const TRESORERIE: RegimeDesExercices = { mode: 'tresorerie' }
const engagement = (exercices: ExerciceDeclare[]): RegimeDesExercices => ({ mode: 'engagement', exercices })

// Ce que l'application suppose aujourd'hui partout : l'exercice EST l'année civile (`${annee}-01-01`,
// `${annee}-12-31`, son nom l'année). Le module doit le rendre à l'identique pour un dossier en trésorerie.
describe("un dossier en trésorerie rend exactement l'année civile", () => {
  const ANNEES = [1999, 2000, 2023, 2024, 2025, 2026, 2027, 2028, 2100, 2400]

  it.each(ANNEES)('%i : bornes, nom, libellé, durée, suite', (annee) => {
    const ex = exerciceDuMillesime(TRESORERIE, annee)
    expect(ex).toEqual({ debut: `${annee}-01-01`, fin: `${annee}-12-31`, nature: 'civil' })
    expect(exerciceCivil(annee)).toEqual(ex)
    expect(millesimeDe(ex!)).toBe(annee)
    expect(libelleDeLExercice(ex!)).toBe(String(annee))
    expect(libelleDesBornes(ex!)).toBe(`du 01/01/${annee} au 31/12/${annee}`)
    expect(joursEn360(ex!)).toBe(360)
    expect(exerciceSuivantPropose(ex!)).toEqual(exerciceCivil(annee + 1))
  })

  it.each(ANNEES)("%i : chaque jour bordant l'année tombe dans son année civile", (annee) => {
    const bissextile = (annee % 4 === 0 && annee % 100 !== 0) || annee % 400 === 0
    const jours = [`${annee}-01-01`, `${annee}-02-28`, `${annee}-03-01`, `${annee}-06-30`, `${annee}-12-31`]
    if (bissextile) jours.push(`${annee}-02-29`)
    for (const jour of jours) {
      expect(exerciceDeLaDate(TRESORERIE, jour)).toEqual({ statut: 'dans', exercice: exerciceCivil(annee) })
    }
    expect(estDateCivile(`${annee}-02-29`)).toBe(bissextile)
  })

  it('refuse toute ligne déclarée, civile ou non (EXD-Q2 (A))', () => {
    const refus = refusDesExercices('tresorerie', [
      declare({ debut: '2026-01-01', fin: '2026-12-31' }),
      declare({ debut: '2026-07-01', fin: '2027-06-30' }),
    ], CHOIX_RECOMMANDES)
    expect(codes(refus)).toEqual(['tresorerie-se-calcule', 'tresorerie-non-civile'])
    expect(refus[1].message).toContain('du 01/07/2026 au 30/06/2027')
    expect(refusDesExercices('tresorerie', [], CHOIX_RECOMMANDES)).toEqual([])
  })

  it("une année hors du calendrier lu par l'application lève", () => {
    expect(() => exerciceCivil(999)).toThrow(RangeError)
    expect(() => exerciceCivil(2026.5)).toThrow(RangeError)
  })
})

describe('les dates civiles', () => {
  it('reconnaît les jours qui existent', () => {
    expect(estDateCivile('2026-02-28')).toBe(true)
    expect(estDateCivile('2026-02-30')).toBe(false)
    expect(estDateCivile('2026-04-31')).toBe(false)
    expect(estDateCivile('2026-13-01')).toBe(false)
    expect(estDateCivile('2026-00-10')).toBe(false)
    expect(estDateCivile('2026-1-01')).toBe(false)
    expect(estDateCivile('2026-01-01T00:00:00Z')).toBe(false)
    expect(estDateCivile('0099-01-01')).toBe(false)
    expect(estDateCivile('1900-02-29')).toBe(false)
  })
})

describe('le nom et le libellé (EXD-Q1 (A), EXD-Q7 (A))', () => {
  it("le millésime de la clôture, et la clôture dite quand l'exercice n'est pas une année civile", () => {
    const decale = { debut: '2026-07-01', fin: '2027-06-30' }
    expect(millesimeDe(decale)).toBe(2027)
    expect(libelleDeLExercice(decale)).toBe('2027 (clos le 30/06)')
    expect(libelleDesBornes(decale)).toBe('du 01/07/2026 au 30/06/2027')
    // Un premier exercice qui se clôt le 31 décembre sans couvrir l'année dit sa clôture.
    expect(libelleDeLExercice({ debut: '2026-03-15', fin: '2026-12-31' })).toBe('2026 (clos le 31/12)')
    // Une année civile déclarée en engagement garde le nom nu.
    expect(libelleDeLExercice({ debut: '2027-01-01', fin: '2027-12-31' })).toBe('2027')
  })
})

describe('la durée en 30/360 (EXD-Q5 (A))', () => {
  it('douze mois valent 360, dix-huit 540, la convention de la base aux fins de février', () => {
    expect(joursEn360({ debut: '2026-07-01', fin: '2027-06-30' })).toBe(360)
    expect(joursEn360({ debut: '2026-07-01', fin: '2027-12-31' })).toBe(540)
    expect(joursEn360({ debut: '2026-10-01', fin: '2026-12-31' })).toBe(90)
    expect(joursEn360({ debut: '2026-03-01', fin: '2027-02-28' })).toBe(360)
    // `rang_360` saute le 29 et le 30 février : la clôture au 29 février compte un jour de plus, la suivante un de moins.
    expect(joursEn360({ debut: '2027-03-01', fin: '2028-02-29' })).toBe(361)
    expect(joursEn360({ debut: '2028-03-01', fin: '2029-02-28' })).toBe(359)
    // Un exercice d'un jour.
    expect(joursEn360({ debut: '2026-06-30', fin: '2026-06-30' })).toBe(1)
  })
})

describe('les bornes et la date en engagement', () => {
  const liste = [
    declare({ debut: '2025-03-15', fin: '2026-06-30', nature: 'premier' }),
    declare({ debut: '2026-07-01', fin: '2027-06-30' }),
  ]

  it('rend l’exercice déclaré du millésime, ou rien', () => {
    expect(exerciceDuMillesime(engagement(liste), 2027)).toEqual({ debut: '2026-07-01', fin: '2027-06-30', nature: 'ordinaire' })
    expect(exerciceDuMillesime(engagement(liste), 2026)?.nature).toBe('premier')
    expect(exerciceDuMillesime(engagement(liste), 2025)).toBeNull()
    expect(exerciceDuMillesime(engagement([]), 2026)).toBeNull()
  })

  it("rend l'unique exercice qui contient la date, ou dit qu'elle est hors des exercices", () => {
    expect(exerciceDeLaDate(engagement(liste), '2026-06-30')).toMatchObject({ statut: 'dans', exercice: { fin: '2026-06-30' } })
    expect(exerciceDeLaDate(engagement(liste), '2026-07-01')).toMatchObject({ statut: 'dans', exercice: { fin: '2027-06-30' } })
    const hors = exerciceDeLaDate(engagement(liste), '2027-07-01')
    expect(hors).toEqual({
      statut: 'hors',
      motif: 'Le 01/07/2027 est hors des exercices déclarés : les exercices déclarés vont du 15/03/2025 au 30/06/2027.',
    })
    expect(exerciceDeLaDate(engagement([]), '2026-01-01')).toMatchObject({ statut: 'hors', motif: expect.stringContaining('aucun exercice') })
    expect(exerciceDeLaDate(engagement(liste), '2026-02-30')).toMatchObject({ statut: 'hors', motif: expect.stringContaining("n'existe pas") })
    expect(exerciceDeLaDate(TRESORERIE, '2026-02-30').statut).toBe('hors')
  })

  it("une date que deux exercices contiennent n'appartient à aucun", () => {
    const chevauchants = [declare({ debut: '2026-01-01', fin: '2026-12-31' }), declare({ debut: '2026-07-01', fin: '2027-06-30' })]
    expect(exerciceDeLaDate(engagement(chevauchants), '2026-08-01')).toMatchObject({ statut: 'hors', motif: expect.stringContaining('chevauchent') })
  })
})

describe('la suite proposée', () => {
  it('commence le lendemain et se clôt à la même date un an plus tard', () => {
    expect(exerciceSuivantPropose({ debut: '2026-07-01', fin: '2027-06-30', nature: 'ordinaire' }))
      .toEqual({ debut: '2027-07-01', fin: '2028-06-30', nature: 'ordinaire' })
    expect(exerciceSuivantPropose({ debut: '2025-03-15', fin: '2026-03-31', nature: 'premier' }))
      .toEqual({ debut: '2026-04-01', fin: '2027-03-31', nature: 'ordinaire' })
    expect(exerciceSuivantPropose({ debut: '2027-03-01', fin: '2028-02-29', nature: 'ordinaire' }))
      .toEqual({ debut: '2028-03-01', fin: '2029-02-28', nature: 'ordinaire' })
    // Un ordinaire calé sur l'année civile reste ordinaire : seule la trésorerie rend du civil.
    expect(exerciceSuivantPropose({ debut: '2026-01-01', fin: '2026-12-31', nature: 'ordinaire' }))
      .toEqual({ debut: '2027-01-01', fin: '2027-12-31', nature: 'ordinaire' })
  })

  it('la proposition est toujours recevable à la suite de son exercice', () => {
    for (const fin of ['2026-06-30', '2027-02-28', '2028-02-29', '2026-03-31', '2026-09-30', '2026-12-31']) {
      const avant = declare({ debut: ajouterUnJourAvant(fin), fin, nature: 'transition', decision: 'AGE', decision_le: '2026-01-15' })
      const suivant = exerciceSuivantPropose(avant)
      const refus = refusDesExercices('engagement', [avant, declare({ debut: suivant.debut, fin: suivant.fin })], CHOIX_RECOMMANDES)
      expect(refus, fin).toEqual([])
    }
  })
})

// Le premier jour d'une transition d'un mois qui se clôt à `fin` — pour fabriquer un prédécesseur recevable.
function ajouterUnJourAvant(fin: string): string {
  return `${fin.slice(0, 7)}-01`
}

describe('les refus d’un exercice', () => {
  it('une date qui n’existe pas, une fin avant le début', () => {
    expect(codes(refusDUnExercice(declare({ debut: '2026-03-01', fin: '2027-02-30' }), CHOIX_RECOMMANDES))).toEqual(['date-invalide'])
    const refus = refusDUnExercice(declare({ debut: '2026-07-01', fin: '2026-06-30' }), CHOIX_RECOMMANDES)
    expect(refus).toEqual([{ code: 'fin-avant-debut', message: "L'exercice se clôt le 30/06/2026, avant son début, le 01/07/2026." }])
  })

  it('une nature inconnue', () => {
    const ex = { ...declare({ debut: '2026-01-01', fin: '2026-12-31' }), nature: 'civil' } as unknown as ExerciceDeclare
    expect(codes(refusDUnExercice(ex, CHOIX_RECOMMANDES))).toEqual(['nature-inconnue'])
  })

  describe('le premier exercice (EXD-Q3)', () => {
    const A: ChoixDesExercices = { ...CHOIX_RECOMMANDES, premierExercice: 'jusqu-au-31-decembre-de-l-annee-suivante' }
    const B: ChoixDesExercices = { ...CHOIX_RECOMMANDES, premierExercice: 'vingt-quatre-mois-au-plus' }

    it('(A) au plus tard le 31 décembre de l’année qui suit son début, sans minimum', () => {
      expect(refusDUnExercice(declare({ debut: '2026-03-15', fin: '2027-12-31', nature: 'premier' }), A)).toEqual([])
      expect(refusDUnExercice(declare({ debut: '2026-03-15', fin: '2026-03-15', nature: 'premier' }), A)).toEqual([])
      const refus = refusDUnExercice(declare({ debut: '2026-03-15', fin: '2028-01-31', nature: 'premier' }), A)
      expect(refus).toEqual([{
        code: 'premier-trop-long',
        message: "Le premier exercice (du 15/03/2026 au 31/01/2028) se clôt au plus tard le 31 décembre de l'année qui suit son début, soit le 31/12/2027.",
      }])
    })

    it('(B) vingt-quatre mois au plus', () => {
      expect(refusDUnExercice(declare({ debut: '2026-03-15', fin: '2028-03-14', nature: 'premier' }), B)).toEqual([])
      expect(codes(refusDUnExercice(declare({ debut: '2026-03-15', fin: '2028-03-15', nature: 'premier' }), B))).toEqual(['premier-trop-long'])
    })
  })

  it('un ordinaire dure douze mois, une fin de février au 28 ou au 29', () => {
    expect(refusDUnExercice(declare({ debut: '2026-07-01', fin: '2027-06-30' }), CHOIX_RECOMMANDES)).toEqual([])
    expect(refusDUnExercice(declare({ debut: '2027-03-01', fin: '2028-02-29' }), CHOIX_RECOMMANDES)).toEqual([])
    expect(refusDUnExercice(declare({ debut: '2027-03-01', fin: '2028-02-28' }), CHOIX_RECOMMANDES)).toEqual([])
    expect(refusDUnExercice(declare({ debut: '2028-03-01', fin: '2029-02-28' }), CHOIX_RECOMMANDES)).toEqual([])
    expect(refusDUnExercice(declare({ debut: '2026-04-01', fin: '2027-03-31' }), CHOIX_RECOMMANDES)).toEqual([])
    const refus = refusDUnExercice(declare({ debut: '2026-07-01', fin: '2027-12-31' }), CHOIX_RECOMMANDES)
    expect(codes(refus)).toEqual(['ordinaire-pas-douze-mois'])
    expect(refus[0].message).toContain('il se clôt le 30/06/2027')
    expect(codes(refusDUnExercice(declare({ debut: '2026-07-01', fin: '2027-06-29' }), CHOIX_RECOMMANDES))).toEqual(['ordinaire-pas-douze-mois'])
  })

  describe("l'exercice de transition (EXD-Q4)", () => {
    const decision = { decision: 'Assemblée générale extraordinaire', decision_le: '2026-05-20' }
    const B: ChoixDesExercices = { ...CHOIX_RECOMMANDES, transition: 'douze-mois-au-plus' }

    it('(A) d’un jour à vingt-trois mois, la décision datée', () => {
      expect(refusDUnExercice(declare({ debut: '2026-01-01', fin: '2026-01-01', nature: 'transition', ...decision }), CHOIX_RECOMMANDES)).toEqual([])
      expect(refusDUnExercice(declare({ debut: '2026-01-01', fin: '2027-11-30', nature: 'transition', ...decision }), CHOIX_RECOMMANDES)).toEqual([])
      const refus = refusDUnExercice(declare({ debut: '2026-01-01', fin: '2027-12-31', nature: 'transition', ...decision }), CHOIX_RECOMMANDES)
      expect(refus).toEqual([{
        code: 'transition-trop-longue',
        message: "Un exercice de transition dure d'un jour à vingt-trois mois : commencé le 01/01/2026, il se clôt au plus tard le 30/11/2027.",
      }])
    })

    it('(B) douze mois au plus', () => {
      expect(refusDUnExercice(declare({ debut: '2026-01-01', fin: '2026-12-31', nature: 'transition', ...decision }), B)).toEqual([])
      expect(codes(refusDUnExercice(declare({ debut: '2026-01-01', fin: '2027-01-31', nature: 'transition', ...decision }), B))).toEqual(['transition-trop-longue'])
    })

    it('sans décision, sans sa date, ou une date qui n’existe pas', () => {
      for (const manque of [
        { decision: null, decision_le: '2026-05-20' },
        { decision: '   ', decision_le: '2026-05-20' },
        { decision: 'AGE', decision_le: null },
        { decision: 'AGE', decision_le: '2026-02-30' },
      ]) {
        expect(codes(refusDUnExercice(declare({ debut: '2026-01-01', fin: '2026-06-30', nature: 'transition', ...manque }), CHOIX_RECOMMANDES))).toEqual(['transition-sans-decision'])
      }
    })

    it('une décision ne se cite que sur une transition', () => {
      expect(codes(refusDUnExercice(declare({ debut: '2026-07-01', fin: '2027-06-30', ...decision }), CHOIX_RECOMMANDES))).toEqual(['decision-hors-transition'])
      expect(codes(refusDUnExercice(declare({ debut: '2026-07-01', fin: '2027-06-30', decision: null, decision_le: '2026-05-20' }), CHOIX_RECOMMANDES))).toEqual(['decision-hors-transition'])
    })
  })
})

describe('les refus d’une liste en engagement', () => {
  const premier = declare({ debut: '2025-03-15', fin: '2026-06-30', nature: 'premier' })
  const suivant = declare({ debut: '2026-07-01', fin: '2027-06-30' })

  it('une suite contiguë est recevable, dans n’importe quel ordre', () => {
    expect(refusDesExercices('engagement', [suivant, premier], CHOIX_RECOMMANDES)).toEqual([])
    expect(refusDesExercices('engagement', [], CHOIX_RECOMMANDES)).toEqual([])
  })

  it('un chevauchement, un trou', () => {
    const chevauche = refusDesExercices('engagement', [premier, declare({ debut: '2026-06-01', fin: '2027-05-31' })], CHOIX_RECOMMANDES)
    expect(codes(chevauche)).toEqual(['chevauchement'])
    expect(chevauche[0].message).toBe("Les exercices du 15/03/2025 au 30/06/2026 et du 01/06/2026 au 31/05/2027 se chevauchent : un jour n'appartient qu'à un exercice.")
    const trou = refusDesExercices('engagement', [premier, declare({ debut: '2026-08-01', fin: '2027-07-31' })], CHOIX_RECOMMANDES)
    expect(trou).toEqual([{
      code: 'trou',
      message: "Entre l'exercice du 15/03/2025 au 30/06/2026 et l'exercice du 01/08/2026 au 31/07/2027, les jours du 01/07/2026 au 31/07/2026 n'appartiennent à aucun exercice.",
    }])
  })

  it('un premier exercice ailleurs qu’en tête', () => {
    const refus = refusDesExercices('engagement', [premier, { ...suivant, nature: 'premier' }], CHOIX_RECOMMANDES)
    expect(codes(refus)).toEqual(['premier-hors-de-tete'])
  })

  it('deux clôtures la même année : la transition courte qui avance la clôture se refuse (EXD-Q1 (A))', () => {
    const avant = declare({ debut: '2025-04-01', fin: '2026-03-31' })
    const courte = declare({ debut: '2026-04-01', fin: '2026-12-31', nature: 'transition', decision: 'AGE', decision_le: '2026-02-10' })
    const refus = refusDesExercices('engagement', [avant, courte], CHOIX_RECOMMANDES)
    expect(codes(refus)).toEqual(['meme-millesime'])
    expect(refus[0].message).toContain('2 exercices se clôturent en 2026 (du 01/04/2025 au 31/03/2026 ; du 01/04/2026 au 31/12/2026)')
    expect(refus[0].message).toContain("s'allonge jusqu'à la nouvelle date de l'année suivante")
    // L'issue : la transition longue, jusqu'au 31 décembre de l'année suivante.
    const longue = { ...courte, fin: '2027-12-31' }
    expect(refusDesExercices('engagement', [avant, longue], CHOIX_RECOMMANDES)).toEqual([])
    expect(exerciceDuMillesime(engagement([avant, courte]), 2026)).toBeNull()
  })

  it('une date fausse se refuse sans fausser le jugement de la suite', () => {
    const refus = refusDesExercices('engagement', [premier, declare({ debut: '2026-07-01', fin: '2027-02-30' })], CHOIX_RECOMMANDES)
    expect(codes(refus)).toEqual(['date-invalide'])
  })
})
