import { describe, expect, it } from 'vitest'
import { codeNafLu, phraseDeLaSectionAuCabinet, sectionAssuranceMaladie } from './sectionAssuranceMaladie'

// NOE4-Q1 (C) : la section des paiements de l'assurance maladie, et l'association de ses paiements au relevé, ne s'offrent que
// sur un code NAF lu de la division 86 (santé humaine, NAF rév. 2). Un code absent, illisible ou pas encore lu ne les offre
// pas ; la phrase du cabinet dit toujours pourquoi.

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
      expect(sectionAssuranceMaladie(code), code).toEqual({ offerte: true, raison: 'sante', code })
    }
  })

  it('hors de la division 86, pas offerte : le code dit, y compris une division voisine ou un « 86 » ailleurs', () => {
    for (const code of ['87.10A', '85.59A', '75.00Z', '47.73Z', '69.20Z', '68.86Z']) {
      expect(sectionAssuranceMaladie(code), code).toEqual({ offerte: false, raison: 'hors-sante', code })
    }
  })

  it('pas lu, absent, vide ou illisible : pas offerte, sans code', () => {
    expect(sectionAssuranceMaladie(undefined)).toEqual({ offerte: false, raison: 'non-lu', code: null })
    expect(sectionAssuranceMaladie(null)).toEqual({ offerte: false, raison: 'absent', code: null })
    expect(sectionAssuranceMaladie('  ')).toEqual({ offerte: false, raison: 'absent', code: null })
    expect(sectionAssuranceMaladie('86')).toEqual({ offerte: false, raison: 'illisible', code: null })
    expect(sectionAssuranceMaladie('Infirmier')).toEqual({ offerte: false, raison: 'illisible', code: null })
  })
})

describe('la phrase de l’onglet Informations', () => {
  it('une phrase pour chaque raison, jamais vide ; le code dit quand il est lisible, jamais une valeur illisible', () => {
    const cas = [undefined, null, 'x86.90D', '86.90D', '69.20Z'] as const
    const phrases = cas.map((c) => phraseDeLaSectionAuCabinet(sectionAssuranceMaladie(c)))
    for (const p of phrases) expect(p.length).toBeGreaterThan(40)
    expect(new Set(phrases).size).toBe(cas.length)
    expect(phrases[3]).toContain('est offerte')
    expect(phrases[3]).toContain('(86.90D)')
    expect(phrases[4]).toContain('n’est pas offerte')
    expect(phrases[4]).toContain('(69.20Z)')
    expect(phrases[2]).not.toContain('x86')
    expect(phrases[1]).toContain('pas de code NAF')
    expect(phrases[0]).toContain('n’a pas été lu')
  })
})
