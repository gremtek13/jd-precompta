import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { NumerosEntiers } from './NumerosEntiers'

// Le numéro d'une écriture libre ne se coupe pas à son trait d'union : chaque « EL2026-0002 » dans un `.numero-entier`, le texte
// rendu identique au texte du module.
describe('NumerosEntiers', () => {
  it('pose chaque numéro dans un span qui ne se coupe pas, le texte inchangé', () => {
    const texte = 'dont écritures libres n° EL2026-0001, EL2026-0002 (extourne) : 300,00 € au débit'
    const { container } = render(<p><NumerosEntiers texte={texte} /></p>)
    expect(container.textContent).toBe(texte)
    expect([...container.querySelectorAll('.numero-entier')].map((e) => e.textContent)).toEqual(['EL2026-0001', 'EL2026-0002'])
  })

  it('un texte sans numéro reste un texte seul', () => {
    const { container } = render(<p><NumerosEntiers texte="dont écriture libre (numéro non lu) : soldée" /></p>)
    expect(container.textContent).toBe('dont écriture libre (numéro non lu) : soldée')
    expect(container.querySelectorAll('.numero-entier')).toHaveLength(0)
  })
})
