import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import {
  bilanDesRefus, bornesDuSeauDesVentes, cheminDUnOriginal, extensionDuLogo, FORME_CHEMIN_D_UN_ORIGINAL, ORIGINAUX_DES_IMPORTS_PREVUS,
  poids, preparerContenu, preparerLogo, preparerLogoDeFacture, preparerOriginalDImport, preparerPiece, refusDUnePiece,
  refusDUnLogo, TAILLE_MAX, TAILLE_MAX_LOGO_DE_FACTURE, TAILLE_MAX_ORIGINAL_D_IMPORT, TAILLE_MAX_PIECE, TYPES_ADMIS,
  TYPES_DES_FICHIERS_DE_PIECE, TYPES_DES_LOGOS, TYPES_DES_LOGOS_DE_FACTURE, typeDUnePiece, typeDUnLogo, typeDUnLogoDeFacture,
  typeDUnOriginal, typeSansParametres, type IssueDuDepot, type Seau,
  cheminDUnDocumentDuCabinet, FORME_CHEMIN_D_UN_DOCUMENT_DU_CABINET, preparerDocumentDuCabinet, SEAU_DES_DOCUMENTS_DU_CABINET,
  TAILLE_MAX_DOCUMENT_DU_CABINET, TYPES_DES_DOCUMENTS_DU_CABINET, typeDUnDocumentDuCabinet,
} from './bornesStockage'
import { DOCUMENTS_ET_DEMANDES_PREVUS } from './documentsEtDemandes'
import { LOGO_DES_FACTURES_EXPORTE } from './logoDesFactures'
import {
  bornesDeLaMigration, bornesDeLEssai, fichierDeLaMigrationDuLogo, sansCommentairesSql, seauDeLaMigrationDuLogo, texteDeLaMigration,
  texteDeLEssai,
} from '../test/bornesStockage'

// LES BORNES DES TROIS SEAUX (ligne 22.6) : ce que l'application vérifie avant l'envoi, et ce qu'elle envoie.
//   1. Les frontières : une taille ÉGALE à la borne passe, un octet de plus est refusé — le stockage juge de même (la
//      limite de busboy tronque au-delà de `fileSize`, un corps brut est refusé quand sa longueur DÉPASSE la borne).
//   2. Chaque type admis passe, un type voisin est refusé — et le type envoyé est celui que l'application décide, jamais
//      celui que le navigateur a mis sur le fichier.
//   3. La borne écrite ici est celle de la migration et de l'essai, valeur par valeur.

const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const WEBP = [0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]
const GIF = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]
const TIFF = [0x49, 0x49, 0x2a, 0]
const SVG = [...new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')]
// L'en-tête d'une photo HEIC d'iPhone : une boîte ISO « ftyp » de marque « heic ».
const HEIC = [0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]

/** Un fichier fictif : son contenu, son nom, et le type que le navigateur lui aurait mis. */
const fichier = (nom: string, octets: number[] = [], typeDuNavigateur = '') =>
  new File([new Uint8Array(octets)], nom, { type: typeDuNavigateur })

/** Le même fichier, d'un poids annoncé : les frontières se jouent sans allouer 50 Mio. */
function pesant<T extends Blob>(f: T, taille: number): T {
  Object.defineProperty(f, 'size', { value: taille })
  return f
}

function corpsDe(issue: IssueDuDepot) {
  if ('refus' in issue) throw new Error(`refusé : ${issue.refus.message}`)
  return issue
}

describe('les frontières de la taille', () => {
  it.each(['pieces', 'packs', 'cabinet-logos'] as const)('%s : la taille égale à la borne passe, un octet de plus est refusé', async (seau) => {
    const type = TYPES_ADMIS[seau][0]
    expect('refus' in preparerContenu(seau, pesant(new Blob(['x']), TAILLE_MAX[seau]), type)).toBe(false)
    const refuse = preparerContenu(seau, pesant(new Blob(['x']), TAILLE_MAX[seau] + 1), type)
    expect('refus' in refuse && refuse.refus).toEqual(expect.objectContaining({ raison: 'taille', taille: TAILLE_MAX[seau] + 1 }))
  })

  it('une pièce : à la borne elle passe, un octet de plus non — sur un VRAI fichier de 20 Mio', async () => {
    const juste = new File([new Uint8Array(TAILLE_MAX_PIECE)], 'scan.pdf')
    expect(corpsDe(await preparerPiece(juste)).taille).toBe(TAILLE_MAX_PIECE)
    const trop = new File([new Uint8Array(TAILLE_MAX_PIECE + 1)], 'scan.pdf')
    expect(await refusDUnePiece(trop)).toEqual(expect.objectContaining({ raison: 'taille', taille: TAILLE_MAX_PIECE + 1 }))
  })

  it('un logo : 500 Kio passent, un octet de plus non', async () => {
    expect(await refusDUnLogo(pesant(fichier('logo.png', PNG), 512_000))).toBeNull()
    expect(await refusDUnLogo(pesant(fichier('logo.png', PNG), 512_001))).toEqual(expect.objectContaining({ raison: 'taille' }))
  })

  it('le refus dit ce que pèse le fichier et la borne — à l’octet quand une décimale les confondrait', async () => {
    expect((await refusDUnePiece(pesant(fichier('scan.pdf'), 23_500_000)))?.message)
      .toBe('il pèse 22,4 Mo, au-delà des 20 Mo qu’une pièce peut peser')
    expect((await refusDUnePiece(pesant(fichier('scan.pdf'), TAILLE_MAX_PIECE + 1)))?.message)
      .toBe('il pèse 20 971 521 octets, au-delà des 20 971 520 octets qu’une pièce peut peser')
    expect((await refusDUnLogo(pesant(fichier('l.png', PNG), 2 * 1024 * 1024)))?.message)
      .toBe('il pèse 2 Mo, au-delà des 500 Ko qu’un logo peut peser')
  })
})

describe('les types d’une pièce', () => {
  it.each([
    ['facture.pdf', 'application/pdf'], ['photo.jpg', 'image/jpeg'], ['photo.jpeg', 'image/jpeg'], ['capture.png', 'image/png'],
    ['releve.csv', 'text/csv'], ['FACTURE.PDF', 'application/pdf'], ['Releve.CSV', 'text/csv'], ['.csv', 'text/csv'],
  ])('%s se dépose en %s, quel que soit son contenu', (nom, type) => {
    expect(typeDUnePiece(nom, new Uint8Array([1, 2, 3]))).toBe(type)
  })

  it.each([
    ['scan_sans_extension', PDF, 'application/pdf'], ['photo', JPEG, 'image/jpeg'], ['capture', PNG, 'image/png'],
    ['facture.pdf.part', PDF, 'application/pdf'], ['facture.', PDF, 'application/pdf'],
  ])('%s, sans extension connue, se reconnaît à sa signature', (nom, octets, type) => {
    expect(typeDUnePiece(nom, new Uint8Array(octets))).toBe(type)
  })

  it.each([
    ['photo.heic', HEIC], ['photo.heic', JPEG.slice(0, 2)], ['scan.tif', TIFF], ['scan.tiff', TIFF], ['dessin.svg', SVG], ['note.txt', [0x61]],
    ['facture.xml', [0x3c, 0x3f]], ['tableur.xlsx', [0x50, 0x4b]], ['animation.gif', GIF], ['image.webp', WEBP],
    ['sans_extension', [0x25, 0x50, 0x44]], ['sans_extension', [0x89, 0x50, 0x4e, 0x48]], ['sans_extension', []],
    ['x.constructor', []], ['x.__proto__', []], ['x.toString', []],
  ])('%s est refusé : ni une extension admise, ni une signature', (nom, octets) => {
    expect(typeDUnePiece(nom, new Uint8Array(octets))).toBeNull()
  })

  it('le type du navigateur ne compte pas : un CSV étiqueté par Excel part en text/csv', async () => {
    for (const typeDuNavigateur of ['application/vnd.ms-excel', 'text/comma-separated-values', '', 'application/octet-stream']) {
      const pret = corpsDe(await preparerPiece(fichier('releve.csv', [0x64, 0x61], typeDuNavigateur)))
      expect(pret.type).toBe('text/csv')
      expect(pret.corps.type).toBe('text/csv')
    }
    // Et un fichier qu'un navigateur dirait SVG, nommé .png, n'est jugé qu'à son extension : c'est une image PNG du seau
    // PRIVÉ des pièces — jamais servie publiquement, et la règle de l'import depuis toujours.
    expect(corpsDe(await preparerPiece(fichier('x.png', PNG, 'image/svg+xml'))).corps.type).toBe('image/png')
    expect(await refusDUnePiece(fichier('x.heic', HEIC, 'image/heic'))).toEqual(expect.objectContaining({ raison: 'format' }))
    // Un JPEG que son nom dit HEIC reste un JPEG : l'extension inconnue laisse la signature décider, comme à l'import.
    expect(corpsDe(await preparerPiece(fichier('x.heic', JPEG, 'image/heic'))).corps.type).toBe('image/jpeg')
  })

  it('le corps envoyé est le fichier lui-même, octet pour octet', async () => {
    const pret = corpsDe(await preparerPiece(fichier('facture.pdf', PDF)))
    expect([...new Uint8Array(await pret.corps.arrayBuffer())]).toEqual(PDF)
    expect(pret.taille).toBe(PDF.length)
  })

  it('le format se juge avant la taille : un fichier lourd d’un format refusé est dit pour son format', async () => {
    expect((await refusDUnePiece(pesant(fichier('photo.heic'), 40 * 1024 * 1024)))?.raison).toBe('format')
    expect((await refusDUnePiece(fichier('photo.heic')))?.message).toBe('format non pris en charge (une pièce se dépose en PDF, JPEG, PNG ou CSV)')
  })

  it('ce que typeDUnePiece rend, sur toute la grille, est exactement TYPES_DES_FICHIERS_DE_PIECE — et le seau l’admet', () => {
    const noms = ['a.pdf', 'a.jpg', 'a.jpeg', 'a.png', 'a.csv', 'a', 'a.tif', 'a.heic', 'a.svg', 'a.txt']
    const debuts = [PDF, JPEG, PNG, WEBP, GIF, TIFF, SVG, []]
    const rendus = new Set(noms.flatMap((nom) => debuts.map((d) => typeDUnePiece(nom, new Uint8Array(d)))).filter((t) => t !== null))
    expect([...rendus].sort()).toEqual([...TYPES_DES_FICHIERS_DE_PIECE].sort())
    for (const type of TYPES_DES_FICHIERS_DE_PIECE) expect(TYPES_ADMIS.pieces).toContain(type)
  })
})

describe('les types d’un logo', () => {
  it.each([[PNG, 'image/png'], [JPEG, 'image/jpeg'], [WEBP, 'image/webp']])('la signature %j est un logo %s', (octets, type) => {
    expect(typeDUnLogo(new Uint8Array(octets))).toBe(type)
  })

  it.each([
    ['un SVG', SVG], ['un GIF', GIF], ['un TIFF', TIFF], ['un PNG à sept octets justes', [...PNG.slice(0, 7), 0]],
    ['un RIFF qui n’est pas un WebP (WAVE)', [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]],
    ['un JPEG à deux octets', [0xff, 0xd8]], ['un PDF', PDF], ['rien', []],
  ])('%s n’est pas un logo', (_quoi, octets) => {
    expect(typeDUnLogo(new Uint8Array(octets))).toBeNull()
  })

  it('le nom ne compte pas : un SVG nommé .png est refusé, un PNG nommé .svg part en PNG, sous un chemin .png', async () => {
    expect(await refusDUnLogo(fichier('logo.png', SVG, 'image/png'))).toEqual(expect.objectContaining({
      raison: 'format', message: 'format non pris en charge (un logo se dépose en PNG, JPEG ou WebP)',
    }))
    const pret = corpsDe(await preparerLogo(fichier('logo.svg', PNG, 'image/svg+xml')))
    expect(pret.corps.type).toBe('image/png')
    expect(extensionDuLogo(pret.type)).toBe('png')
    expect(extensionDuLogo('image/jpeg')).toBe('jpg')
    expect(extensionDuLogo('image/webp')).toBe('webp')
  })

  it('TYPES_DES_LOGOS est la liste du seau des logos, et ce que typeDUnLogo rend', () => {
    expect([...TYPES_DES_LOGOS].sort()).toEqual([...TYPES_ADMIS['cabinet-logos']].sort())
    const rendus = [PNG, JPEG, WEBP, GIF, SVG, PDF].map((o) => typeDUnLogo(new Uint8Array(o))).filter((t) => t !== null)
    expect([...new Set(rendus)].sort()).toEqual([...TYPES_DES_LOGOS].sort())
  })
})

describe('ce que l’application construit elle-même', () => {
  it.each((Object.keys(TYPES_ADMIS) as Seau[]).flatMap((seau) => TYPES_ADMIS[seau].map((type) => [seau, type] as const)))(
    '%s admet %s, et le corps en porte le type', (seau, type) => {
      expect(corpsDe(preparerContenu(seau, new Uint8Array([1, 2]), type as never)).corps.type).toBe(type)
    },
  )

  it('un type à paramètres se juge sur type/sous-type, et part tel quel', () => {
    const pret = corpsDe(preparerContenu('pieces', new Uint8Array([0x3c]), 'text/plain; charset=utf-8'))
    expect(pret.corps.type).toBe('text/plain; charset=utf-8')
    expect(typeSansParametres(' TEXT/Plain ;charset=UTF-8')).toBe('text/plain')
  })

  it.each([
    ['pieces', 'text/html'], ['pieces', 'application/xml'], ['pieces', 'image/tiff'], ['packs', 'application/x-zip-compressed'],
    ['packs', 'application/vnd.ms-excel'], ['cabinet-logos', 'image/svg+xml'], ['cabinet-logos', 'image/gif'], ['pieces', ''],
  ] as const)('%s refuse un type voisin : %s', (seau, type) => {
    const issue = preparerContenu(seau, new Uint8Array([1]), type as never)
    expect('refus' in issue && issue.refus.raison).toBe('format')
  })
})

describe('le bilan d’un lot, sans nom de fichier', () => {
  it('compte le format et le poids de chacun, face à la borne', async () => {
    const refus = await Promise.all([
      refusDUnePiece(fichier('a.heic')), refusDUnePiece(pesant(fichier('b.pdf'), 23_500_000)),
      refusDUnePiece(fichier('c.docx')), refusDUnePiece(pesant(fichier('d.pdf'), 31 * 1024 * 1024)),
    ])
    expect(bilanDesRefus('pieces', refus.filter((r) => r !== null)))
      .toBe('4 ignoré(s) : 2 au format non pris en charge ; 2 au-delà de 20 Mo (22,4 Mo, 31 Mo)')
    expect(bilanDesRefus('pieces', [])).toBe('')
    expect(bilanDesRefus('pieces', [(await refusDUnePiece(pesant(fichier('e.pdf'), TAILLE_MAX_PIECE + 1)))!]))
      .toBe('1 ignoré(s) : 1 au-delà de 20 971 520 octets (20 971 521 octets)')
  })

  it('dit un poids en octets, en Ko ou en Mo, sans coupure', () => {
    expect([1, 1023, 1536, 512_000, 20 * 1024 * 1024, 52_428_800].map(poids))
      .toEqual(['1 octet', '1023 octets', '1,5 Ko', '500 Ko', '20 Mo', '50 Mo'])
  })
})

describe('la borne écrite ici est celle de la migration et de l’essai', () => {
  const migration = bornesDeLaMigration(texteDeLaMigration())
  const essai = bornesDeLEssai(texteDeLEssai())

  it('la migration pose les trois seaux, et eux seuls', () => {
    expect(migration.map((b) => b.seau).sort()).toEqual(['cabinet-logos', 'packs', 'pieces'])
  })

  it.each(['pieces', 'packs', 'cabinet-logos'] as const)('%s : même taille, mêmes types, dans le module, la migration et l’essai', (seau) => {
    const lue = migration.find((b) => b.seau === seau)!
    const attendue = essai.find((b) => b.seau === seau)!
    expect(lue.taille).toBe(TAILLE_MAX[seau])
    expect(attendue.taille).toBe(TAILLE_MAX[seau])
    expect([...lue.types].sort()).toEqual([...TYPES_ADMIS[seau]].sort())
    expect([...attendue.types].sort()).toEqual([...TYPES_ADMIS[seau]].sort())
    expect(new Set(lue.types).size).toBe(lue.types.length)
  })

  it('l’essai garde le seau des logos public, les autres privés — celui des ventes (A5c1) et celui des documents (B2) compris', () => {
    expect(Object.fromEntries(essai.map((b) => [b.seau, b.publique])))
      .toEqual({ pieces: false, packs: false, 'cabinet-logos': true, ventes: false, 'documents-cabinet': false })
  })

  it('la migration ne fait rien d’autre : ni suppression, ni policy, ni accès public, et elle exige les trois seaux', () => {
    const code = sansCommentairesSql(texteDeLaMigration())
    expect(code).not.toMatch(/\b(delete|drop|truncate|insert|policy|grant|revoke|alter)\b/i)
    expect(code).not.toMatch(/\bpublic\s*=/i)
    expect(code).toMatch(/count\(\*\)\s+from\s+storage\.buckets\s+where\s+id\s+in\s+\('pieces',\s*'packs',\s*'cabinet-logos'\)\)\s*<>\s*3/i)
  })

  it('le garde mord : une taille changée dans la migration, ou un type de plus, se voit', () => {
    const texte = texteDeLaMigration()
    const autreTaille = bornesDeLaMigration(texte.replace('file_size_limit = 20971520', 'file_size_limit = 20971521'))
    expect(autreTaille.find((b) => b.seau === 'pieces')!.taille).not.toBe(TAILLE_MAX.pieces)
    const svg = bornesDeLaMigration(texte.replace("array['image/png', 'image/jpeg', 'image/webp']", "array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']"))
    expect([...svg.find((b) => b.seau === 'cabinet-logos')!.types].sort()).not.toEqual([...TYPES_ADMIS['cabinet-logos']].sort())
    expect(() => bornesDeLaMigration(`${texte}\nupdate storage.buckets set public = true where id = 'pieces';`)).toThrow(/forme attendue/)
  })
})

// ── Le quatrième seau, `ventes` : le logo des factures (étape A5c1) ──────────────────────────────────────────────────
// Sa migration, `logo_des_factures`, est PRÉPARÉE : tant que l'export ne la porte pas, la borne se confronte à l'essai
// (supabase/essais/bornesStockage.sql, qui l'attend « EN ATTENTE ») ; le jour où il la porte, à elle aussi.
describe('le seau des ventes et le logo des factures', () => {
  const essai = bornesDeLEssai(texteDeLEssai())
  const fichier = fichierDeLaMigrationDuLogo()

  it('la migration du logo est dans l’export si et seulement si son drapeau est levé', () => {
    expect(fichier !== null).toBe(LOGO_DES_FACTURES_EXPORTE)
  })

  // Depuis A8d2a (`originaux_des_imports`, en production le 11/11/2026), le seau du module est l'union : la migration du
  // logo et la première ligne de l'essai disent le seau d'AVANT, `bornesDuSeauDesVentes(false)`.
  it('même taille, mêmes types, dans le module et l’essai — et dans la migration quand l’export la porte : privé', () => {
    const attendue = essai.find((b) => b.seau === 'ventes')!
    const avant = bornesDuSeauDesVentes(false)
    expect(attendue).toEqual({ seau: 'ventes', publique: false, taille: avant.taille, types: [...avant.types] })
    expect(avant.taille).toBe(512_000)
    expect([...avant.types]).toEqual(['image/png', 'image/jpeg'])
    const duModule = bornesDuSeauDesVentes(ORIGINAUX_DES_IMPORTS_PREVUS)
    expect({ taille: TAILLE_MAX.ventes, types: [...TYPES_ADMIS.ventes] }).toEqual({ taille: duModule.taille, types: [...duModule.types] })
    if (fichier === null) return
    expect(seauDeLaMigrationDuLogo(readFileSync(fichier, 'utf8'))).toEqual(attendue)
  })

  it('le lecteur du seau de la migration mord : une autre forme, un second seau, un seau retouché, un autre nom — il lève', () => {
    const juste = "insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)\nvalues ('ventes', 'ventes', false, 512000, array['image/png', 'image/jpeg']);"
    expect(seauDeLaMigrationDuLogo(juste)).toEqual({ seau: 'ventes', publique: false, taille: 512000, types: ['image/png', 'image/jpeg'] })
    expect(seauDeLaMigrationDuLogo(`-- insert into storage.buckets (commentaire)\n${juste}`).seau).toBe('ventes')
    expect(() => seauDeLaMigrationDuLogo(juste.replace('512000, ', ''))).toThrow(/forme attendue/)
    expect(() => seauDeLaMigrationDuLogo(`${juste}\n${juste}`)).toThrow(/2 insert/)
    expect(() => seauDeLaMigrationDuLogo(`${juste}\nupdate storage.buckets set public = true where id = 'ventes';`)).toThrow(/1 update/)
    expect(() => seauDeLaMigrationDuLogo(juste.replace("('ventes', 'ventes'", "('ventes', 'logos'"))).toThrow(/autre nom/)
    expect(seauDeLaMigrationDuLogo(juste.replace('false', 'true')).publique).toBe(true)
  })

  it('la taille égale à la borne passe, un octet de plus est refusé', () => {
    expect('refus' in preparerContenu('ventes', pesant(new Blob(['x']), TAILLE_MAX.ventes), 'image/png')).toBe(false)
    const refuse = preparerContenu('ventes', pesant(new Blob(['x']), TAILLE_MAX.ventes + 1), 'image/png')
    expect('refus' in refuse && refuse.refus).toEqual(expect.objectContaining({ raison: 'taille', taille: TAILLE_MAX.ventes + 1 }))
  })

  it('un logo de facture se reconnaît à sa SIGNATURE : PNG ou JPEG ; ni WebP, ni GIF, ni SVG, ni HEIC, ni PDF', () => {
    expect(typeDUnLogoDeFacture(new Uint8Array(PNG))).toBe('image/png')
    expect(typeDUnLogoDeFacture(new Uint8Array(JPEG))).toBe('image/jpeg')
    for (const octets of [WEBP, GIF, SVG, HEIC, PDF, TIFF, []]) expect(typeDUnLogoDeFacture(new Uint8Array(octets)), String(octets.slice(0, 4))).toBeNull()
    const rendus = [PNG, JPEG, WEBP, GIF, SVG, PDF].map((o) => typeDUnLogoDeFacture(new Uint8Array(o))).filter((t) => t !== null)
    expect([...new Set(rendus)].sort()).toEqual([...TYPES_DES_LOGOS_DE_FACTURE].sort())
  })

  it('le nom et le type du navigateur ne comptent pas : un SVG nommé .png est refusé, un PNG nommé .svg part RÉÉTIQUETÉ en PNG', async () => {
    const refus = await preparerLogoDeFacture(fichier_('logo.png', SVG, 'image/png'))
    expect('refus' in refus && refus.refus).toEqual(expect.objectContaining({
      raison: 'format', message: 'format non pris en charge (un logo de facture se dépose en PNG ou en JPEG)',
    }))
    const webp = await preparerLogoDeFacture(fichier_('logo.webp', WEBP, 'image/webp'))
    expect('refus' in webp && webp.refus.raison).toBe('format')
    const pret = corpsDe(await preparerLogoDeFacture(fichier_('logo.svg', PNG, 'image/svg+xml')))
    expect([pret.type, pret.corps.type, pret.taille]).toEqual(['image/png', 'image/png', PNG.length])
    expect([...new Uint8Array(await pret.corps.arrayBuffer())]).toEqual(PNG)
    const jpeg = corpsDe(await preparerLogoDeFacture(fichier_('photo', JPEG, '')))
    expect(jpeg.corps.type).toBe('image/jpeg')
  })

  it('le format se juge avant la taille, et la borne se dit à l’octet quand une décimale la confondrait', async () => {
    const lourd = await preparerLogoDeFacture(pesant(fichier_('logo.gif', GIF), 2 * 1024 * 1024))
    expect('refus' in lourd && lourd.refus.raison).toBe('format')
    const trop = await preparerLogoDeFacture(pesant(fichier_('logo.png', PNG), TAILLE_MAX_LOGO_DE_FACTURE + 1))
    expect('refus' in trop && trop.refus.message).toBe('il pèse 512\u202f001\u00a0octets, au-delà des 512\u202f000\u00a0octets qu’un logo de facture peut peser')
    expect('refus' in (await preparerLogoDeFacture(pesant(fichier_('logo.png', PNG), TAILLE_MAX_LOGO_DE_FACTURE)))).toBe(false)
  })
})

/** Un fichier fictif pour le seau des ventes (le nom `fichier` y est pris par la migration lue). */
const fichier_ = (nom: string, octets: number[] = [], typeDuNavigateur = '') => new File([new Uint8Array(octets)], nom, { type: typeDuNavigateur })

// ── A8d2a : l'original d'une facture reprise dans le seau des ventes ─────────────────────────────────────────────────
// La migration `originaux_des_imports` est EN PRODUCTION depuis le 11/11/2026 (supabase/schema/, version 20261111131855) :
// `ORIGINAUX_DES_IMPORTS_PREVUS` est levé, et le seau porte l'union. Ses deux états se jouent encore par
// `bornesDuSeauDesVentes`, confrontés au texte de la migration et aux deux lignes de l'essai (bornesStockage.sql :
// `attendu_d_avant`, `attendu_depuis_a8d2a`).
describe('A8d2a : l’original d’une facture reprise, dans le seau des ventes', () => {
  const dossier = (d: string) => new URL(`../../supabase/${d}/`, import.meta.url)
  const nommees = (d: string) => readdirSync(dossier(d)).filter((nom) => /^\d{14}_originaux_des_imports\.sql$/.test(nom))
  const migration = readFileSync(new URL(nommees('schema')[0], dossier('schema')), 'utf8')
  const retour = readFileSync(new URL('20261111120100_retour_originaux_des_imports.sql', dossier('preparees/retour')), 'utf8')
  const ventesDeLEssai = bornesDeLEssai(texteDeLEssai()).filter((b) => b.seau === 'ventes')
  const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
  const octets = (c: string | readonly number[]) => (typeof c === 'string' ? new TextEncoder().encode(c) : new Uint8Array(c))
  const fichierDe = (nom: string, contenu: string | readonly number[], typeDuNavigateur = '') =>
    new File([octets(contenu)], nom, { type: typeDuNavigateur })
  const CII = '\uFEFF<?xml version="1.0" encoding="UTF-8"?>\n<!-- export -->\n<rsm:CrossIndustryInvoice xmlns:rsm="urn:x">'

  it('le drapeau est levé : la migration est dans l’export, une seule fois, et n’est plus préparée', () => {
    expect(ORIGINAUX_DES_IMPORTS_PREVUS).toBe(true)
    expect(nommees('schema')).toEqual(['20261111131855_originaux_des_imports.sql'])
    expect(nommees('preparees')).toHaveLength(0)
    // Le seau du code suit le drapeau : l'union, celle de la migration.
    expect({ types: [...TYPES_ADMIS.ventes], taille: TAILLE_MAX.ventes })
      .toEqual({ types: [...bornesDuSeauDesVentes(true).types], taille: bornesDuSeauDesVentes(true).taille })
  })

  it('l’état d’avant : le seau aux bornes du logo, celles que l’essai attend d’une base sans la migration', () => {
    expect(bornesDuSeauDesVentes(false)).toEqual({ types: ['image/png', 'image/jpeg'], taille: 512_000 })
    expect(ventesDeLEssai).toHaveLength(2)
    expect(ventesDeLEssai[0]).toEqual({ seau: 'ventes', publique: false, taille: 512_000, types: ['image/png', 'image/jpeg'] })
  })

  it('l’état d’après : l’union, 20 Mio — celle que la migration pose et que l’essai attend depuis elle', () => {
    const apres = bornesDuSeauDesVentes(true)
    expect(apres).toEqual({ types: ['image/png', 'image/jpeg', 'application/pdf', 'text/plain', 'text/csv'], taille: TAILLE_MAX_PIECE })
    expect(bornesDeLaMigration(migration)).toEqual([{ seau: 'ventes', taille: apres.taille, types: [...apres.types] }])
    expect(ventesDeLEssai[1]).toEqual({ seau: 'ventes', publique: false, taille: apres.taille, types: [...apres.types] })
    // Ni SVG, ni HTML, ni type XML : un original se lit, il ne s'exécute pas.
    for (const type of apres.types) expect(type).not.toMatch(/svg|html|xml/)
  })

  it('le logo garde SES bornes dans les deux états : 500 Kio, PNG ou JPEG — la fonction des paramètres les tient', () => {
    expect(TAILLE_MAX_LOGO_DE_FACTURE).toBe(512_000)
    expect([...TYPES_DES_LOGOS_DE_FACTURE]).toEqual(['image/png', 'image/jpeg'])
    expect(sansCommentairesSql(migration)).toContain(`v_borne := least(v_borne, ${TAILLE_MAX_LOGO_DE_FACTURE});`)
    expect(sansCommentairesSql(migration).match(/least\(/g)).toHaveLength(1)
  })

  it('la forme du chemin d’un original est celle de la policy de dépôt, et la lecture d’un original va au cabinet seul', () => {
    const code = sansCommentairesSql(migration)
    const depot = /create policy ventes_depot_d_un_original on storage\.objects\s+for insert to authenticated\s+with check \(\s*bucket_id = 'ventes'\s+and case\s+when name ~ '([^']+)' then public\.admin_du_dossier\(\(storage\.foldername\(name\)\)\[1\]::uuid\)\s+else false\s+end\s*\);/i.exec(code)
    expect(depot?.[1]).toBe(FORME_CHEMIN_D_UN_ORIGINAL.source.replace(/\\\//g, '/'))
    expect(code).toContain(`when name ~ '^${UUID}/imports/' then public.admin_du_dossier((storage.foldername(name))[1]::uuid)\n      when name ~ '^${UUID}/' then public.gere_les_ventes(`)
    // Par l'outil : aucun mot de retrait ; le retour, lui, retire une policy — il se colle.
    expect(migration).not.toMatch(/\b(delete|drop|truncate)\b/i)
    expect(sansCommentairesSql(retour)).toMatch(/^drop policy ventes_depot_d_un_original on storage\.objects;$/im)
  })

  it('le format se décide au contenu : PDF à sa signature, XML à sa racine de facture, CSV à son extension', () => {
    const type = (nom: string, contenu: string | readonly number[]) => typeDUnOriginal(nom, octets(contenu))
    expect(type('F2025-001.csv', PDF)).toBe('application/pdf')
    expect(type('facture', CII)).toBe('text/plain')
    expect(type('f.xml', '<Invoice xmlns="urn:oasis">')).toBe('text/plain')
    expect(type('f.xml', '  <ubl:CreditNote>')).toBe('text/plain')
    expect(type('export.CSV', 'numero;date\nF1;2025-01-02')).toBe('text/csv')
    const refuses: [string, string | readonly number[]][] = [['f.xml', SVG], ['f.csv', '<svg onload="x">'],
      ['f.xml', '<html><script>x</script>'], ['f.xml', '<?xml version="1.0"?><Invoices>'], ['f.txt', 'numero;date'], ['f.png', PNG]]
    for (const [nom, contenu] of refuses) expect(type(nom, contenu), nom).toBeNull()
  })

  it('préparé : réétiqueté du type décidé, borné à 20 Mio — et le refus le dit', async () => {
    const pret = corpsDe(await preparerOriginalDImport(fichierDe('Facture Dupont.pdf', CII, 'application/pdf')))
    expect([pret.type, pret.corps.type]).toEqual(['text/plain', 'text/plain'])
    expect('refus' in (await preparerOriginalDImport(pesant(fichierDe('f.pdf', PDF), TAILLE_MAX_ORIGINAL_D_IMPORT)))).toBe(false)
    const trop = await preparerOriginalDImport(pesant(fichierDe('f.pdf', PDF), TAILLE_MAX_ORIGINAL_D_IMPORT + 1))
    expect('refus' in trop && trop.refus.message)
      .toBe('il pèse 20\u202f971\u202f521\u00a0octets, au-delà des 20\u202f971\u202f520\u00a0octets qu’un original de facture reprise peut peser')
    const svg = await preparerOriginalDImport(fichierDe('f.xml', SVG, 'text/xml'))
    expect('refus' in svg && svg.refus).toEqual(expect.objectContaining({
      raison: 'format', message: 'format non pris en charge (un original de facture reprise se dépose en PDF (Factur-X), en XML (CII ou UBL) ou en CSV)',
    }))
  })

  it('le chemin : le dossier, le lot, l’empreinte et l’extension du type — jamais le nom d’origine', () => {
    const [d, l, h] = ['a8d20000-0000-4000-8000-0000000000a1', 'a8d20000-0000-4000-8000-00000000017a', 'b'.repeat(64)]
    expect(cheminDUnOriginal(d, l, h, 'text/plain')).toBe(`${d}/imports/${l}/${h}.xml`)
    expect(cheminDUnOriginal(d, l, h, 'application/pdf')).toBe(`${d}/imports/${l}/${h}.pdf`)
    expect(cheminDUnOriginal(d.toUpperCase(), l, h, 'text/csv')).toBeNull()
    expect(cheminDUnOriginal(d, 'lot-1', h, 'text/csv')).toBeNull()
    expect(cheminDUnOriginal(d, l, 'B'.repeat(64), 'text/csv')).toBeNull()
  })
})

// ── Le cinquième seau, `documents-cabinet` : les documents que le cabinet met à disposition (B2) ────────────────────────
// Sa migration, `documents_et_demandes`, est PRÉPARÉE : la borne se confronte à son texte (supabase/preparees/) et à
// l'essai (qui l'attend « EN ATTENTE ») ; le jour où l'export la porte, `DOCUMENTS_ET_DEMANDES_PREVUS` se lève.
describe('B2 : le seau des documents du cabinet', () => {
  const preparees = new URL('../../supabase/preparees/', import.meta.url).pathname
  const migration = readFileSync(preparees + readdirSync(preparees).find((n) => /^\d{14}_documents_et_demandes\.sql$/.test(n))!, 'utf8')
  const essai = bornesDeLEssai(texteDeLEssai())

  it('même seau, même taille, mêmes types, dans le module, la migration et l’essai : privé', () => {
    const attendu = { seau: SEAU_DES_DOCUMENTS_DU_CABINET, publique: false, taille: TAILLE_MAX_DOCUMENT_DU_CABINET, types: [...TYPES_DES_DOCUMENTS_DU_CABINET] }
    expect(seauDeLaMigrationDuLogo(migration)).toEqual(attendu)
    expect(essai.find((b) => b.seau === SEAU_DES_DOCUMENTS_DU_CABINET)).toEqual(attendu)
    expect(TAILLE_MAX_DOCUMENT_DU_CABINET).toBe(20 * 1024 * 1024)
    expect(DOCUMENTS_ET_DEMANDES_PREVUS).toBe(false)
  })

  it('la forme du chemin est celle de la policy de dépôt et de la fonction de publication', () => {
    const forme = FORME_CHEMIN_D_UN_DOCUMENT_DU_CABINET.source.replace(/\\\//g, '/')
    const code = sansCommentairesSql(migration)
    expect(code.split(`name ~ '${forme}'`)).toHaveLength(2)
    expect(code.split(`p_chemin !~ '${forme}'`)).toHaveLength(2)
  })

  it('le type se décide à la signature : PDF, JPEG, PNG ; ni WebP, ni GIF, ni SVG, ni HEIC', () => {
    expect(typeDUnDocumentDuCabinet(new Uint8Array(PDF))).toBe('application/pdf')
    expect(typeDUnDocumentDuCabinet(new Uint8Array(JPEG))).toBe('image/jpeg')
    expect(typeDUnDocumentDuCabinet(new Uint8Array(PNG))).toBe('image/png')
    for (const autre of [WEBP, GIF, SVG, HEIC, TIFF]) expect(typeDUnDocumentDuCabinet(new Uint8Array(autre))).toBeNull()
  })

  it('préparé : réétiqueté du type de sa signature, borné à 20 Mio — un octet de plus, refusé ; le nom ne compte pas', async () => {
    const pret = corpsDe(await preparerDocumentDuCabinet(pesant(fichier('liasse.png', PDF, 'image/png'), TAILLE_MAX_DOCUMENT_DU_CABINET)))
    expect(pret.type).toBe('application/pdf')
    expect(pret.corps.type).toBe('application/pdf')
    const lourd = await preparerDocumentDuCabinet(pesant(fichier('liasse.pdf', PDF), TAILLE_MAX_DOCUMENT_DU_CABINET + 1))
    expect('refus' in lourd && lourd.refus.raison).toBe('taille')
    const svg = await preparerDocumentDuCabinet(fichier('liasse.pdf', SVG, 'application/pdf'))
    expect('refus' in svg && svg.refus.message).toBe('format non pris en charge (un document mis à disposition se dépose en PDF, JPEG ou PNG)')
  })

  it('le chemin : le dossier, le document, l’empreinte et l’extension du type — jamais le nom d’origine', () => {
    const dossier = '11111111-2222-4333-8444-555555555555'
    const document = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
    expect(cheminDUnDocumentDuCabinet(dossier, document, 'c'.repeat(64), 'image/jpeg')).toBe(`${dossier}/${document}/${'c'.repeat(64)}.jpg`)
    expect(cheminDUnDocumentDuCabinet(dossier, document, 'C'.repeat(64), 'application/pdf')).toBeNull()
    expect(cheminDUnDocumentDuCabinet(dossier, 'liasse', 'c'.repeat(64), 'application/pdf')).toBeNull()
  })
})
