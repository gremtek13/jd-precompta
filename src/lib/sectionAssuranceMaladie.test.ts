import { describe, expect, it } from 'vitest'
import {
  CODES_HORS_DE_LA_DIVISION, codeNafLu, importsDeLaLecture, phraseDeLaSectionAuCabinet, sectionAssuranceMaladie,
} from './sectionAssuranceMaladie'

// NOE4-Q1 (C) : la section des paiements de l'assurance maladie, et l'association de ses paiements au relevé, ne s'offrent que
// sur un code NAF lu de la division 86 (santé humaine, NAF rév. 2). Un code absent, illisible ou pas encore lu ne les offre
// pas ; la phrase du cabinet dit toujours pourquoi. NOE4Q1-Q1 (B) : une liste fermée de quatre codes hors de la division 86
// l'offre aussi (pharmacie, matériel médical, optique, taxi).

describe('le code NAF lu', () => {
  it('la forme de SIRENE, ou la même sans le point ; les bords et la casse de la lettre, rien d’autre', () => {
    expect(codeNafLu('86.90D')).toBe('86.90D')
    expect(codeNafLu(' 8690d ')).toBe('86.90D')
    expect(codeNafLu('86.21Z')).toBe('86.21Z')
    for (const illisible of ['86', '86.9D', '86.90', '8690DD', '86-90D', 'Q86.90D', '86.90 D', 'santé', '']) {
      expect(codeNafLu(illisible), illisible).toBeNull()
    }
  })
})

describe('la section offerte sur un code NAF de santé (86…), et seulement là', () => {
  it('toute la division 86 l’offre : hôpital, médecine, dentaire, paramédical, ambulances, laboratoires', () => {
    for (const code of ['86.10Z', '86.21Z', '86.22A', '86.22B', '86.22C', '86.23Z', '86.90A', '86.90B', '86.90C', '86.90D',
      '86.90E', '86.90F']) {
      expect(sectionAssuranceMaladie(code, 'inconnu'), code).toEqual({ offerte: true, raison: 'sante', raisonDuCode: 'sante', code })
    }
  })

  it('la liste fermée l’offre aussi, ses quatre codes et eux seuls, avec ou sans le point', () => {
    expect(CODES_HORS_DE_LA_DIVISION).toEqual(['47.73Z', '47.74Z', '47.78A', '49.32Z'])
    for (const code of CODES_HORS_DE_LA_DIVISION) {
      expect(sectionAssuranceMaladie(code, 'inconnu'), code).toEqual({ offerte: true, raison: 'liste', raisonDuCode: 'liste', code })
    }
    expect(sectionAssuranceMaladie('4773z', 'inconnu')).toEqual({ offerte: true, raison: 'liste', raisonDuCode: 'liste', code: '47.73Z' })
  })

  it('hors de la division 86 et de la liste, pas offerte : le code dit, y compris une sous-classe voisine de la liste', () => {
    for (const code of ['87.10A', '85.59A', '75.00Z', '47.78B', '47.75Z', '49.31Z', '49.39A', '69.20Z', '68.86Z']) {
      expect(sectionAssuranceMaladie(code, 'inconnu'), code).toEqual({ offerte: false, raison: 'hors-sante', raisonDuCode: 'hors-sante', code })
    }
  })

  it('pas lu, absent, vide ou illisible : pas offerte, sans code', () => {
    expect(sectionAssuranceMaladie(undefined, 'inconnu')).toEqual({ offerte: false, raison: 'non-lu', raisonDuCode: 'non-lu', code: null })
    expect(sectionAssuranceMaladie(null, 'inconnu')).toEqual({ offerte: false, raison: 'absent', raisonDuCode: 'absent', code: null })
    expect(sectionAssuranceMaladie('  ', 'inconnu')).toEqual({ offerte: false, raison: 'absent', raisonDuCode: 'absent', code: null })
    expect(sectionAssuranceMaladie('86', 'inconnu')).toEqual({ offerte: false, raison: 'illisible', raisonDuCode: 'illisible', code: null })
    expect(sectionAssuranceMaladie('Infirmier', 'inconnu')).toEqual({ offerte: false, raison: 'illisible', raisonDuCode: 'illisible', code: null })
  })
})

describe('la phrase de l’onglet Informations', () => {
  it('une phrase pour chaque raison, jamais vide ; le code dit quand il est lisible, jamais une valeur illisible', () => {
    const cas = [undefined, null, 'x86.90D', '86.90D', '69.20Z', '49.32Z'] as const
    const phrases = cas.map((c) => phraseDeLaSectionAuCabinet(sectionAssuranceMaladie(c, 'inconnu')))
    for (const p of phrases) expect(p.length).toBeGreaterThan(40)
    expect(new Set(phrases).size).toBe(cas.length)
    expect(phrases[3]).toContain('est offerte')
    expect(phrases[3]).toContain('(86.90D)')
    expect(phrases[4]).toContain('n’est pas offerte')
    expect(phrases[4]).toContain('(69.20Z)')
    expect(phrases[4]).toContain('ni de la liste fermée')
    expect(phrases[5]).toContain('est offerte')
    expect(phrases[5]).toContain('(49.32Z) est de la liste fermée')
    expect(phrases[2]).not.toContain('x86')
    expect(phrases[1]).toContain('pas de code NAF')
    expect(phrases[0]).toContain('n’a pas été lu')
  })
})

// NOE4Q1-Q2 (A) : dès qu'un import existe, la section reste offerte, quel que soit le code ; une lecture qui ne prouve rien
// laisse la règle du code seule. Données FICTIVES.
describe('la section offerte dès qu’un import existe (NOE4Q1-Q2)', () => {
  it('un import l’emporte sur un code hors santé, absent, illisible ou pas lu, et la raison du code reste dite', () => {
    expect(sectionAssuranceMaladie('69.20Z', 'au-moins-un')).toEqual({ offerte: true, raison: 'imports', raisonDuCode: 'hors-sante', code: '69.20Z' })
    expect(sectionAssuranceMaladie(null, 'au-moins-un')).toMatchObject({ offerte: true, raison: 'imports', raisonDuCode: 'absent' })
    expect(sectionAssuranceMaladie('Infirmier', 'au-moins-un')).toMatchObject({ offerte: true, raison: 'imports', raisonDuCode: 'illisible' })
    expect(sectionAssuranceMaladie(undefined, 'au-moins-un')).toMatchObject({ offerte: true, raison: 'imports', raisonDuCode: 'non-lu' })
  })

  it('sur un code qui l’offre, la raison reste celle du code ; sans import sûr, la règle du code seule', () => {
    expect(sectionAssuranceMaladie('86.90D', 'au-moins-un')).toMatchObject({ offerte: true, raison: 'sante' })
    expect(sectionAssuranceMaladie('49.32Z', 'aucun')).toMatchObject({ offerte: true, raison: 'liste' })
    for (const imports of ['aucun', 'inconnu'] as const) {
      expect(sectionAssuranceMaladie('69.20Z', imports), imports).toMatchObject({ offerte: false, raison: 'hors-sante' })
    }
  })

  it('une lecture ne dit « au moins un » que d’une ligne lue du dossier, « aucun » que lue en entier', () => {
    const lus = (lignes: unknown[], complete: boolean, dossierId = 'd1') => ({ dossierId, etat: 'lus', imports: { lignes, complete } })
    expect(importsDeLaLecture(lus([{ id: 'i1' }], true), 'd1')).toBe('au-moins-un')
    expect(importsDeLaLecture(lus([{ id: 'i1' }], false), 'd1')).toBe('au-moins-un')
    expect(importsDeLaLecture(lus([], true), 'd1')).toBe('aucun')
    expect(importsDeLaLecture(lus([], false), 'd1')).toBe('inconnu')
    expect(importsDeLaLecture(lus([{ id: 'i1' }], true, 'd2'), 'd1')).toBe('inconnu')
    expect(importsDeLaLecture(null, 'd1')).toBe('inconnu')
    expect(importsDeLaLecture({ dossierId: 'd1', etat: 'echec' }, 'd1')).toBe('inconnu')
    expect(importsDeLaLecture({ dossierId: 'd1', etat: 'sans_banque' }, 'd1')).toBe('inconnu')
  })

  it('la phrase du cabinet dit que la section reste offerte, et ce que le code seul dirait', () => {
    const hors = phraseDeLaSectionAuCabinet(sectionAssuranceMaladie('69.20Z', 'au-moins-un'))
    expect(hors).toContain('reste offerte : des paiements ont déjà été importés pour ce dossier')
    expect(hors).toContain('(69.20Z) n’est ni celui d’une activité de santé humaine')
    expect(phraseDeLaSectionAuCabinet(sectionAssuranceMaladie(null, 'au-moins-un'))).toContain('le dossier n’a pas de code NAF')
    expect(phraseDeLaSectionAuCabinet(sectionAssuranceMaladie(undefined, 'au-moins-un'))).toContain('n’a pas été lu')
    expect(phraseDeLaSectionAuCabinet(sectionAssuranceMaladie('x86', 'au-moins-un'))).not.toContain('x86')
  })
})
