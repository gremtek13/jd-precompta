import { describe, expect, it } from 'vitest'
import {
  DELAI_TELEDECLARATION_JOURS, deuxiemeJourOuvreApresLePremierMai, echeancesFiscales, estOuvre, joursFeries, paques,
  premierJourOuvreDesLe, prochainesEcheances,
} from './echeancesFiscales'

// LES DATES ATTENDUES SONT CELLES QUE LA DGFIP A PUBLIÉES, ou se vérifient sur un calendrier : jamais une sortie du module.
// Publiées : le 5 mai 2026 (brochure Impôts locaux 2026, calendrier de la CVAE) ; l'acompte de CFE au 17 juin 2024, au
// 16 juin 2025 et au 15 juin 2026, le solde au 16 décembre 2024 et au 15 décembre 2025 (actualités d'impots.gouv.fr).

describe('Pâques et les jours fériés', () => {
  it('place Pâques aux dates du calendrier grégorien', () => {
    expect(paques(2008)).toBe('2008-03-23')
    expect(paques(2024)).toBe('2024-03-31')
    expect(paques(2025)).toBe('2025-04-20')
    expect(paques(2026)).toBe('2026-04-05')
    expect(paques(2027)).toBe('2027-03-28')
    expect(paques(2035)).toBe('2035-03-25')
    expect(paques(2038)).toBe('2038-04-25')
  })

  it('compte les onze jours fériés, dont les trois qui suivent Pâques', () => {
    // 2026 : Pâques le 5 avril — lundi de Pâques le 6, Ascension le 14 mai, lundi de Pentecôte le 25 mai.
    expect([...joursFeries(2026)].sort()).toEqual([
      '2026-01-01', '2026-04-06', '2026-05-01', '2026-05-08', '2026-05-14', '2026-05-25',
      '2026-07-14', '2026-08-15', '2026-11-01', '2026-11-11', '2026-12-25',
    ])
  })

  it('tient pour ouvrés les jours de semaine qui ne sont pas fériés', () => {
    expect(estOuvre('2026-10-09')).toBe(true) // un vendredi
    expect(estOuvre('2026-10-10')).toBe(false) // un samedi
    expect(estOuvre('2026-10-11')).toBe(false) // un dimanche
    expect(estOuvre('2026-05-14')).toBe(false) // jeudi de l'Ascension
  })
})

describe('le deuxième jour ouvré suivant le 1er mai', () => {
  it('rend le 5 mai 2026, la date que publie la DGFiP', () => {
    // Le 1er mai 2026 est un vendredi : lundi 4, mardi 5.
    expect(deuxiemeJourOuvreApresLePremierMai(2026)).toBe('2026-05-05')
  })

  it('saute le week-end', () => {
    // 2024 : 1er mai un mercredi — jeudi 2, vendredi 3. 2025 : un jeudi — vendredi 2, lundi 5. 2027 : un samedi — lundi 3, mardi 4.
    expect(deuxiemeJourOuvreApresLePremierMai(2024)).toBe('2024-05-03')
    expect(deuxiemeJourOuvreApresLePremierMai(2025)).toBe('2025-05-05')
    expect(deuxiemeJourOuvreApresLePremierMai(2027)).toBe('2027-05-04')
  })

  it('saute un jeudi de l’Ascension', () => {
    // 2035 : Pâques le 25 mars, Ascension le jeudi 3 mai ; le 1er mai est un mardi — mercredi 2, puis vendredi 4.
    expect(deuxiemeJourOuvreApresLePremierMai(2035)).toBe('2035-05-04')
  })
})

describe('le report d’une échéance au premier jour ouvré', () => {
  it('reporte un samedi ou un dimanche au lundi, comme la DGFiP l’a fait pour la CFE', () => {
    expect(premierJourOuvreDesLe('2024-06-15')).toBe('2024-06-17') // samedi → lundi 17 juin 2024
    expect(premierJourOuvreDesLe('2024-12-15')).toBe('2024-12-16') // dimanche → lundi 16 décembre 2024
    expect(premierJourOuvreDesLe('2025-06-15')).toBe('2025-06-16') // dimanche → lundi 16 juin 2025
  })

  it('laisse un jour ouvré tel quel', () => {
    expect(premierJourOuvreDesLe('2026-06-15')).toBe('2026-06-15') // lundi
    expect(premierJourOuvreDesLe('2025-12-15')).toBe('2025-12-15') // lundi
  })
})

describe('les échéances d’une année', () => {
  it('donne les huit échéances de 2026, à leurs dates, dans l’ordre', () => {
    expect(echeancesFiscales(2026).map((e) => [e.id, e.date])).toEqual([
      ['cfe-1447m-2026', '2026-05-05'],
      ['cvae-solde-2026', '2026-05-05'],
      ['liasse-2026', '2026-05-20'],
      ['cfe-acompte-2026', '2026-06-15'],
      ['cvae-acompte-juin-2026', '2026-06-15'],
      ['cvae-acompte-septembre-2026', '2026-09-15'],
      ['cfe-solde-2026', '2026-12-15'],
      ['cfe-1447c-2026', '2026-12-31'],
    ])
  })

  it('accorde quinze jours de plus à la liasse déposée en ligne', () => {
    expect(DELAI_TELEDECLARATION_JOURS).toBe(15)
    // 3 mai 2024 + 15 = 18 mai ; 5 mai 2025 + 15 = 20 mai.
    expect(echeancesFiscales(2024).find((e) => e.impot === 'Liasse')?.date).toBe('2024-05-18')
    expect(echeancesFiscales(2025).find((e) => e.impot === 'Liasse')?.date).toBe('2025-05-20')
  })

  it('reporte l’acompte et le solde de la CFE aux dates qu’a publiées la DGFiP', () => {
    const date = (annee: number, id: string) => echeancesFiscales(annee).find((e) => e.id === `${id}-${annee}`)?.date
    expect(date(2024, 'cfe-acompte')).toBe('2024-06-17')
    expect(date(2025, 'cfe-acompte')).toBe('2025-06-16')
    expect(date(2026, 'cfe-acompte')).toBe('2026-06-15')
    expect(date(2024, 'cfe-solde')).toBe('2024-12-16')
    expect(date(2025, 'cfe-solde')).toBe('2025-12-15')
  })

  it('nomme l’exercice et la condition de chaque échéance, sans rien supposer du dossier', () => {
    const parId = new Map(echeancesFiscales(2026).map((e) => [e.id, e]))
    expect(parId.get('liasse-2026')?.libelle).toMatch(/2035 des revenus 2025/)
    expect(parId.get('liasse-2026')?.condition).toMatch(/chiffre d’affaires hors taxes de 2025 dépasse 152\u202f500\u00a0€/)
    expect(parId.get('cvae-solde-2026')?.condition).toMatch(/dépasse 500\u202f000\u00a0€/)
    expect(parId.get('cfe-acompte-2026')?.condition).toMatch(/CFE de 2025 atteignait 3\u202f000\u00a0€/)
    expect(parId.get('cvae-acompte-juin-2026')?.condition).toMatch(/CVAE de 2025 dépassait 1\u202f500\u00a0€/)
    expect(parId.get('cfe-1447m-2026')?.libelle).toMatch(/pour la CFE 2027/)
  })
})

describe('les douze prochains mois', () => {
  it('part d’aujourd’hui, inclus, et va jusqu’à l’année suivante', () => {
    expect(prochainesEcheances('2026-10-09').map((e) => e.id)).toEqual([
      'cfe-solde-2026', 'cfe-1447c-2026',
      'cfe-1447m-2027', 'cvae-solde-2027', 'liasse-2027', 'cfe-acompte-2027', 'cvae-acompte-juin-2027', 'cvae-acompte-septembre-2027',
    ])
    expect(prochainesEcheances('2026-12-15')[0].id).toBe('cfe-solde-2026')
    expect(prochainesEcheances('2026-12-16')[0].id).toBe('cfe-1447c-2026')
  })

  it('s’arrête avant le même jour de l’année suivante', () => {
    // Le 15 septembre 2026 : le second acompte de CVAE 2026 en est (aujourd'hui, inclus), celui de 2027 non (le 15
    // septembre 2027, 365 jours plus tard, est exclu).
    const ids = prochainesEcheances('2026-09-15').map((e) => e.id)
    expect(ids[0]).toBe('cvae-acompte-septembre-2026')
    expect(ids).not.toContain('cvae-acompte-septembre-2027')
    expect(ids).toContain('cfe-acompte-2027')
  })
})
