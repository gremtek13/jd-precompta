import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import {
  ENTETE_DES_FICHIERS, NOM_DE_LA_DOCUMENTATION, NOM_DU_MANIFESTE, fabriquerLePaquet, nomDuPaquet, nomsDesOriginaux,
  piecesCiteesParLExercice, sha256Hex, type EntreesDuPaquet, type OriginalLu, type PieceDuPaquet,
} from './paquetDArchive'

const encodeur = new TextEncoder()

async function original(id: string, texte: string, chemin: string, datePiece: string | null): Promise<OriginalLu> {
  const octets = encodeur.encode(texte)
  const piece: PieceDuPaquet = {
    id, date_piece: datePiece, created_at: '2025-03-01T10:00:00Z', storage_path: chemin, storage_hash: await sha256Hex(octets),
  }
  return { piece, octets }
}

async function entrees(): Promise<EntreesDuPaquet> {
  const originaux = [
    // Un nom de fichier qui nomme un patient : il ne doit entrer nulle part dans le paquet.
    await original('a0000000-0000-4000-8000-000000000001', '%PDF facture A', 'd1/1700000000000-releve-patient-dupont.pdf', '2025-02-03'),
    await original('b0000000-0000-4000-8000-000000000002', 'image du ticket', 'd1/1700000000001-ticket-martin.JPG', null),
  ]
  return {
    exercice: {
      dossier_id: 'd1', annee: 2025, valide_le: '2026-01-15T09:30:00.000+00:00', empreinte: 'e'.repeat(64),
      empreinte_precedente: null, forme_empreinte: 2, nb_ecritures: 2, nb_lignes: 4, declaration: { AG: 1200, BR: 300 },
    },
    piecesCitees: originaux.map((o) => o.piece.id),
    originaux,
    fec: { nom: '123456789FEC20251231.txt', contenu: 'JournalCode\tJournalLib\r\nAC\tAchats' },
    documentation: '# Documentation des traitements\n',
    fabriqueLe: new Date('2026-11-10T23:30:00Z'),
  }
}

describe('le paquet d’archive d’un exercice validé', () => {
  it('le manifeste rejoue les SHA-256 du contenu du ZIP relu, fichier par fichier', async () => {
    const paquet = await fabriquerLePaquet(await entrees())
    if (!paquet.ok) throw new Error(paquet.message)
    const zip = await JSZip.loadAsync(paquet.zip)
    const noms = Object.keys(zip.files).filter((n) => !zip.files[n].dir).sort()

    const manifeste = await zip.file(NOM_DU_MANIFESTE)!.async('string')
    expect(manifeste).toBe(paquet.manifeste)
    expect(await sha256Hex(encodeur.encode(manifeste))).toBe(paquet.empreinteDuManifeste)
    const section = manifeste.split('\n')
    const debut = section.indexOf(ENTETE_DES_FICHIERS)
    const listes = section.slice(debut + 1, section.indexOf('', debut)).map((l) => l.split('\t'))
    expect(listes.map(([chemin]) => chemin).sort()).toEqual(noms.filter((n) => n !== NOM_DU_MANIFESTE))
    for (const [chemin, taille, sha] of listes) {
      const octets = await zip.file(chemin)!.async('uint8array')
      expect(octets.length).toBe(Number(taille))
      expect(await sha256Hex(octets)).toBe(sha)
    }
    expect(noms.filter((n) => !n.startsWith('pieces/'))).toEqual(
      ['123456789FEC20251231.txt', '2035-2025.json', NOM_DE_LA_DOCUMENTATION, NOM_DU_MANIFESTE])
    const originaux = noms.filter((n) => n.startsWith('pieces/'))
    expect(originaux).toHaveLength(2)
    expect(originaux[0]).toMatch(/^pieces\/20250203-[0-9a-f]{8}\.pdf$/)
    expect(originaux[1]).toMatch(/^pieces\/20250301-[0-9a-f]{8}\.jpg$/)
    expect(manifeste).toContain(`Empreinte de l'exercice : ${'e'.repeat(64)}`)
    expect(manifeste).toContain('aucune (premier exercice validé du dossier)')
    // La date de Paris de la fabrication : 23 h 30 UTC le 10, minuit et demi le 11 à Paris.
    expect(manifeste).toContain('Fabriqué le : 2026-11-11 (date de Paris)')
    expect(JSON.parse(await zip.file('2035-2025.json')!.async('string'))).toEqual({ AG: 1200, BR: 300 })
  })

  it('aucun nom de fichier d’origine n’entre dans le paquet', async () => {
    const paquet = await fabriquerLePaquet(await entrees())
    if (!paquet.ok) throw new Error(paquet.message)
    const zip = await JSZip.loadAsync(paquet.zip)
    const tout = [...Object.keys(zip.files), paquet.manifeste].join('\n')
    expect(tout).not.toMatch(/dupont|martin|releve|ticket/i)
  })

  it('un original altéré refuse TOUT le paquet, et le dit', async () => {
    const e = await entrees()
    const altere = { ...e.originaux[1], octets: encodeur.encode('image du ticket, retouchée') }
    const paquet = await fabriquerLePaquet({ ...e, originaux: [e.originaux[0], altere] })
    expect(paquet.ok).toBe(false)
    if (paquet.ok) return
    expect(paquet.message).toMatch(/^Aucun paquet d’archive : l’original de la pièce 20250301-[0-9a-f]{8} ne correspond plus/)
    expect(paquet).not.toHaveProperty('zip')
  })

  it('une pièce sans empreinte de dépôt refuse le paquet', async () => {
    const e = await entrees()
    const sans = { ...e.originaux[0], piece: { ...e.originaux[0].piece, storage_hash: null } }
    const paquet = await fabriquerLePaquet({ ...e, originaux: [sans, e.originaux[1]] })
    expect(paquet).toMatchObject({ ok: false, message: expect.stringContaining('n’a pas d’empreinte de dépôt') })
  })

  it('une pièce citée sans original, ou un original que l’exercice ne cite pas, refuse le paquet', async () => {
    const e = await entrees()
    expect(await fabriquerLePaquet({ ...e, originaux: [e.originaux[0]] }))
      .toMatchObject({ ok: false, message: expect.stringContaining('1 pièce(s) citée(s)') })
    expect(await fabriquerLePaquet({ ...e, piecesCitees: [e.originaux[0].piece.id] }))
      .toMatchObject({ ok: false, message: expect.stringContaining('ne cite pas') })
  })

  it('un FEC vide refuse le paquet', async () => {
    const e = await entrees()
    expect(await fabriquerLePaquet({ ...e, fec: { ...e.fec, contenu: ' ' } })).toMatchObject({ ok: false })
  })

  it('les pièces citées : directement ou par leur bien, uniques et triées', () => {
    expect(piecesCiteesParLExercice(
      [
        { piece_id: 'p2', immobilisation_id: null }, { piece_id: null, immobilisation_id: 'i1' },
        { piece_id: 'p2', immobilisation_id: null }, { piece_id: null, immobilisation_id: 'i2' },
      ],
      [{ id: 'i1', piece_id: 'p1' }, { id: 'i2', piece_id: null }, { id: 'i3', piece_id: 'p9' }],
    )).toEqual(['p1', 'p2'])
  })

  it('deux originaux de même référence se distinguent par un rang', () => {
    const p = (id: string): PieceDuPaquet => ({ id, date_piece: '2025-01-02', created_at: '2025-01-02T00:00:00Z', storage_path: 'd/x.pdf', storage_hash: 'ab'.repeat(32) })
    expect([...nomsDesOriginaux([p('b'), p('a')]).entries()])
      .toEqual([['a', 'pieces/20250102-abababab.pdf'], ['b', 'pieces/20250102-abababab-2.pdf']])
  })

  it('le nom du paquet porte le SIREN, jamais le nom du dossier', () => {
    expect(nomDuPaquet('123 456 789 00012', 2025)).toBe('123456789-exercice-2025-archive.zip')
    expect(nomDuPaquet(null, 2025)).toBe('A_COMPLETER-exercice-2025-archive.zip')
  })
})
