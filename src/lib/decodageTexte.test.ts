import { describe, expect, it } from 'vitest'
import { decoderUtf8OuWindows1252, decoderWindows1252 } from './decodageTexte'

// L'oracle est écrit à la main, point de code par point de code (l'index windows-1252 de la norme Encoding du WHATWG),
// jamais demandé à `TextDecoder` : c'est lui que le module ne croit plus (Node 22.22 lit 0x80–0x9F comme du latin-1).
const ATTENDUS_DE_80_A_9F: readonly number[] = [
  0x20ac, 0x0081, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x008d, 0x017d, 0x008f,
  0x0090, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x009d, 0x017e, 0x0178,
]

function attendu(octet: number): number {
  return octet >= 0x80 && octet <= 0x9f ? ATTENDUS_DE_80_A_9F[octet - 0x80] : octet
}

describe('decoderWindows1252', () => {
  it('rend chacun des 256 octets selon l’index du WHATWG', () => {
    const tous = Uint8Array.from({ length: 256 }, (_, i) => i)
    const texte = decoderWindows1252(tous)
    expect(texte.length).toBe(256)
    for (let i = 0; i < 256; i++) expect(texte.codePointAt(i)).toBe(attendu(i))
  })

  it('lit le symbole euro, l’apostrophe typographique et le « œ » d’un export français', () => {
    // « -12,50 € » puis « l’œil », tels qu’un logiciel sous Windows les écrit.
    const octets = Uint8Array.from([0x2d, 0x31, 0x32, 0x2c, 0x35, 0x30, 0x20, 0x80, 0x3b, 0x6c, 0x92, 0x9c, 0x69, 0x6c])
    expect(decoderWindows1252(octets)).toBe('-12,50 ' + String.fromCodePoint(0x20ac) + ';l' + String.fromCodePoint(0x2019, 0x0153) + 'il')
  })

  it('franchit les tranches sans perdre ni décaler un octet, et accepte un ArrayBuffer', () => {
    const octets = Uint8Array.from({ length: 8192 * 2 + 37 }, (_, i) => (i * 7) % 256)
    const texte = decoderWindows1252(octets.buffer)
    expect(texte.length).toBe(octets.length)
    for (const i of [0, 8191, 8192, 8193, 16383, 16384, octets.length - 1]) expect(texte.codePointAt(i)).toBe(attendu(octets[i]))
  })

  it('rend le texte vide pour un fichier vide', () => {
    expect(decoderWindows1252(new Uint8Array(0))).toBe('')
  })
})

describe('decoderUtf8OuWindows1252', () => {
  it('garde l’UTF-8 valide', () => {
    const octets = new TextEncoder().encode('-12,50 ' + String.fromCodePoint(0x20ac))
    expect(decoderUtf8OuWindows1252(octets)).toEqual({ texte: '-12,50 ' + String.fromCodePoint(0x20ac), encodage: 'utf-8' })
  })

  it('retombe sur windows-1252, décodé par le module, quand les octets ne sont pas de l’UTF-8', () => {
    expect(decoderUtf8OuWindows1252(Uint8Array.from([0x80, 0x20, 0xe9]))).toEqual({
      texte: String.fromCodePoint(0x20ac) + ' ' + String.fromCodePoint(0xe9),
      encodage: 'windows-1252',
    })
  })
})
