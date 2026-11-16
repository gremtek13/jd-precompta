import { describe, expect, it } from 'vitest'
import { genreDApercu } from './genreDApercu'

// La règle que la fiche d'une pièce tenait seule, partagée depuis le 16/11/2026 avec la fiche d'un document.
describe('genreDApercu', () => {
  it('une image et un PDF se montrent, quelle que soit la casse de l’extension', () => {
    for (const nom of ['photo.jpg', 'scan.JPEG', 'logo.png', 'anim.gif', 'image.webp']) expect(genreDApercu(nom)).toBe('image')
    expect(genreDApercu('Releve.PDF')).toBe('pdf')
  })

  it('le reste ne se prévisualise pas : un CSV, un XML, un nom sans extension', () => {
    expect(genreDApercu('releve.csv')).toBe('autre')
    expect(genreDApercu('facture.xml')).toBe('autre')
    expect(genreDApercu('sans-extension')).toBe('autre')
    // Le dernier point seul compte : « .pdf » au milieu du nom ne fait pas un PDF.
    expect(genreDApercu('releve.pdf.csv')).toBe('autre')
  })
})
