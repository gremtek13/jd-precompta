import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { crc32, dateDos, EcrivainZip, FICHIERS_AU_PLUS, PLAFOND_DU_ZIP } from './zipEnFlux'

// LE ZIP ÉCRIT EN FLUX (INAL6, CFC-Q1 (B)) : relu par JSZip, CRC vérifiés (`checkCRC32`), noms en UTF-8 ; chaque fichier
// écrit dès qu'il est donné (la sortie reçoit ses morceaux avant la fermeture) ; les bornes sans ZIP64 refusées avant
// d'écrire.

const octets = (texte: string) => new TextEncoder().encode(texte)

function sortie() {
  const morceaux: Uint8Array[] = []
  return {
    morceaux,
    ecrire: async (m: Uint8Array) => { morceaux.push(new Uint8Array(m)) },
    tout: () => {
      const n = morceaux.reduce((s, m) => s + m.length, 0)
      const t = new Uint8Array(n)
      let p = 0
      for (const m of morceaux) { t.set(m, p); p += m.length }
      return t
    },
  }
}

describe('le ZIP écrit en flux', () => {
  it('le CRC-32 du vecteur de référence (« 123456789 » → CBF43926)', () => {
    expect(crc32(octets('123456789'))).toBe(0xcbf43926)
    expect(crc32(new Uint8Array())).toBe(0)
  })

  it('JSZip le relit, CRC vérifiés : les noms accentués, un fichier vide, des octets quelconques', async () => {
    const s = sortie()
    const z = new EcrivainZip(s, new Date('2026-11-12T10:00:00Z'))
    const binaire = Uint8Array.from({ length: 70_000 }, (_, i) => (i * 31) % 256)
    await z.ajouter('123456789-dddddddd/pieces/20260102-aaaaaaaa.pdf', binaire)
    // Le fichier est déjà dans la sortie avant la fermeture : rien ne s'accumule dans l'écrivain.
    expect(s.morceaux.reduce((n, m) => n + m.length, 0)).toBeGreaterThan(binaire.length)
    await z.ajouter('dossier/vide.txt', new Uint8Array())
    await z.ajouter('MANIFESTE.txt', octets('Fabriquée le : 2026-11-12 — « é »'))
    await z.fermer()
    expect(z.octetsEcrits).toBe(s.tout().length)
    const lu = await JSZip.loadAsync(s.tout(), { checkCRC32: true })
    expect(Object.keys(lu.files).sort()).toEqual(['123456789-dddddddd/pieces/20260102-aaaaaaaa.pdf', 'MANIFESTE.txt', 'dossier/vide.txt'])
    expect(await lu.file('123456789-dddddddd/pieces/20260102-aaaaaaaa.pdf')!.async('uint8array')).toEqual(binaire)
    expect(await lu.file('MANIFESTE.txt')!.async('string')).toBe('Fabriquée le : 2026-11-12 — « é »')
    expect(await lu.file('dossier/vide.txt')!.async('uint8array')).toEqual(new Uint8Array())
  })

  it('un ZIP sans fichier se relit', async () => {
    const s = sortie()
    const z = new EcrivainZip(s, new Date('2026-11-12T10:00:00Z'))
    await z.fermer()
    expect(s.tout().length).toBe(22)
    expect(Object.keys((await JSZip.loadAsync(s.tout())).files)).toEqual([])
  })

  it('la date MS-DOS est celle de Paris', () => {
    // 12/11/2026 à 10 h 00 UTC = 11 h 00 à Paris.
    expect(dateDos(new Date('2026-11-12T10:00:00Z'))).toEqual({ date: ((2026 - 1980) << 9) | (11 << 5) | 12, heure: 11 << 11 })
  })

  it('les bornes sans ZIP64 : un fichier qui passerait le plafond se refuse avant d’être écrit', async () => {
    const s = sortie()
    const z = new EcrivainZip(s, new Date('2026-11-12T10:00:00Z'))
    expect(z.depasserait('a', 10, 1000)).toBe(false)
    expect(z.depasserait('a', 1000, 1000)).toBe(true)
    expect(z.depasserait('a', PLAFOND_DU_ZIP)).toBe(true)
    expect(FICHIERS_AU_PLUS).toBe(65_535)
    await expect(z.ajouter('a', new Uint8Array(0))).resolves.toBeUndefined()
    await z.fermer()
    await expect(z.ajouter('b', new Uint8Array(0))).rejects.toThrow('déjà fermé')
  })

  it('65 535 fichiers s’écrivent en un temps linéaire, et le 65 536e se refuse (relecture adverse du 27/11/2026)', async () => {
    // Le répertoire central se recomptait EN ENTIER à chaque `depasserait` — deux fois par fichier dans la copie des
    // fichiers (le plafond de la sortie, puis `ajouter`) : un temps carré, quelque quatre milliards de pas pour un ZIP au
    // nombre de fichiers que le format admet, l'onglet figé pendant des minutes. Tenu au fil des ajouts, il ne coûte plus
    // rien. La sortie ne garde rien : seule la mesure compte ici.
    const z = new EcrivainZip({ ecrire: async () => {} }, new Date('2026-11-12T10:00:00Z'))
    const debut = performance.now()
    for (let i = 0; i < FICHIERS_AU_PLUS; i++) {
      const nom = `d/${i}.pdf`
      expect(z.depasserait(nom, 0)).toBe(false)
      await z.ajouter(nom, new Uint8Array(0))
    }
    expect(z.nombreDeFichiers).toBe(FICHIERS_AU_PLUS)
    expect(z.depasserait('d/de-trop.pdf', 0)).toBe(true)
    await expect(z.ajouter('d/de-trop.pdf', new Uint8Array(0))).rejects.toThrow('65 535 fichiers')
    expect(performance.now() - debut).toBeLessThan(4000)
  }, 20_000)

  it('la borne d’octets compte le répertoire central déjà tenu : un ZIP qui tient tout juste, puis un octet de trop', async () => {
    const z = new EcrivainZip({ ecrire: async () => {} }, new Date('2026-11-12T10:00:00Z'))
    await z.ajouter('a', new Uint8Array(10))
    // Écrit : 30 + 1 + 10 = 41 ; le central de « a » et de « b » : 2 × (46 + 1) = 94 ; la fin : 22 ; « b » : 30 + 1 + taille.
    const plafond = 41 + 31 + 5 + 94 + 22
    expect(z.depasserait('b', 5, plafond)).toBe(false)
    expect(z.depasserait('b', 6, plafond)).toBe(true)
  })
})
