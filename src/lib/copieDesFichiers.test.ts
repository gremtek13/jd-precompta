import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import {
  COPIE_DES_FICHIERS_PREVUE, fabriquerUnLot, fermerLeLotAvant, inventaireDuDossier, NOM_DU_MANIFESTE, nomDuZip,
  PLAFOND_D_UN_LOT, rappelDeLaCopie, sha256Hex, unMoisApres, type FichierLu, type SourcesDuDossier,
} from './copieDesFichiers'

// LA COPIE DES FICHIERS SUR UN SUPPORT DU CABINET (INAL6) : l'inventaire et ses noms (jamais le nom déposé), le lot et son
// manifeste (chaque fichier relu à son empreinte, l'écart et le manquant dits et comptés), la découpe, le rappel.

const octets = (texte: string) => new TextEncoder().encode(texte)
const P1 = 'aaaaaaaa-0000-4000-8000-000000000001'
const P2 = 'bbbbbbbb-0000-4000-8000-000000000002'
const D1 = 'cccccccc-0000-4000-8000-000000000003'
const DOSSIER = 'dddddddd-0000-4000-8000-000000000004'

async function sources(): Promise<SourcesDuDossier> {
  return {
    pieces: [
      { id: P1, date_piece: '2026-03-14', created_at: '2026-03-15T10:00:00Z', storage_path: `${DOSSIER}/1787769218050-Dupont Jeanne bordereau.PDF`,
        storage_hash: await sha256Hex(octets('pièce 1')), lisible_path: `${DOSSIER}/1787769218051-Dupont Jeanne bordereau.jpg` },
      { id: P2, date_piece: null, created_at: '2026-04-01T22:30:00Z', storage_path: `${DOSSIER}/1787-ticket.png`, storage_hash: null, lisible_path: null },
    ],
    documents: [{ id: D1, created_at: '2026-05-31T23:30:00Z', storage_path: `${DOSSIER}/1787929535733-Martin Paul.pdf`, storage_hash: 'illisible' }],
    originaux: [
      { id: 'eeeeeeee-0000-4000-8000-000000000005', fichier_chemin: `${DOSSIER}/imports/lot/${'f'.repeat(64)}.xml`, fichier_sha256: null },
      { id: 'ffffffff-0000-4000-8000-000000000006', fichier_chemin: `${DOSSIER}/imports/lot/${'f'.repeat(64)}.xml`, fichier_sha256: 'f'.repeat(64) },
      { id: '11111111-0000-4000-8000-000000000007', fichier_chemin: null, fichier_sha256: null },
    ],
    documentsDuCabinet: [{ id: '22222222-0000-4000-8000-000000000008', chemin: `${DOSSIER}/x/${'a'.repeat(64)}`, sha256: 'a'.repeat(64), type_mime: 'application/pdf' }],
  }
}

describe('l’inventaire d’un dossier', () => {
  it('nomme chaque fichier par sa référence, jamais par le nom déposé, et garde l’empreinte que la base tient', async () => {
    const f = inventaireDuDossier(await sources())
    expect(f.map((x) => [x.nature, x.nom, x.attendue === null ? null : 'h'])).toEqual([
      ['piece', expect.stringMatching(/^pieces\/20260314-[0-9a-f]{8}\.pdf$/), 'h'],
      ['version_lisible', expect.stringMatching(/^pieces\/20260314-[0-9a-f]{8}-lisible\.jpg$/), null],
      ['piece', 'pieces/20260402-bbbbbbbb.png', null],
      // La date de Paris de son dépôt (le 31 mai à 23 h 30 UTC est le 1er juin à Paris), une empreinte illisible tenue pour absente.
      ['document', 'documents/20260601-cccccccc.pdf', null],
      // Un original cité deux fois n'entre qu'une fois, sous l'empreinte lisible ; une ligne sans chemin, rien.
      ['original_repris', `factures_reprises/${'f'.repeat(16)}.xml`, 'h'],
      ['document_du_cabinet', 'documents_du_cabinet/22222222.pdf', 'h'],
    ])
    for (const x of f) expect(x.nom).not.toMatch(/Dupont|Martin|ticket|1787/)
  })

  it('deux pièces de même référence se distinguent par un rang', () => {
    const p = { date_piece: '2026-01-02', created_at: '2026-01-02T08:00:00Z', storage_path: 'x/a.pdf', storage_hash: 'a'.repeat(64), lisible_path: null }
    const f = inventaireDuDossier({ pieces: [{ ...p, id: P1 }, { ...p, id: P2 }], documents: [], originaux: [], documentsDuCabinet: [] })
    expect(f.map((x) => x.nom)).toEqual(['pieces/20260102-aaaaaaaa.pdf', 'pieces/20260102-aaaaaaaa-2.pdf'])
  })
})

describe('un lot et son manifeste', () => {
  it('relit chaque fichier : vérifié, écart (copié et dit), sans empreinte, manquant (dit, absent du ZIP)', async () => {
    const [piece, lisible, ticket, document] = inventaireDuDossier(await sources())
    const lus: FichierLu[] = [
      { fichier: piece, octets: octets('pièce 1') },
      { fichier: lisible, octets: octets('lisible') },
      { fichier: { ...ticket, attendue: 'c'.repeat(64) }, octets: octets('changé') },
      { fichier: document, octets: null, motif: 'Object not found' },
    ]
    const fabriqueLe = new Date('2026-11-30T23:30:00Z')
    const lot = await fabriquerUnLot({ dossier: { id: DOSSIER, nom: 'Cabinet du Dr Essai', siret: '123 456 789 00012' }, rang: 1, dernier: true, fichiers: lus, fabriqueLe })
    expect(lot.comptes).toEqual({ fichiers: 4, verifies: 1, ecarts: 1, nonVerifies: 1, manquants: 1, octets: octets('pièce 1').length + octets('lisible').length + octets('changé').length })
    expect(lot.nomDuZip).toBe('copie-2026-12-01-123456789-dddddddd-lot1.zip')
    expect(lot.manifeste).toContain('Fabriqué le : 2026-12-01 (date de Paris)')
    expect(lot.manifeste).toContain(`ÉCARTS (1)`)
    expect(lot.manifeste).toContain(`pieces/20260402-bbbbbbbb.png\tattendue ${'c'.repeat(64)}\trelue ${await sha256Hex(octets('changé'))}`)
    expect(lot.manifeste).toContain('MANQUANTS (1) — absents de ce ZIP\ndocuments/20260601-cccccccc.pdf\tObject not found')
    expect(lot.manifeste).toContain(`${piece.nom}\t${octets('pièce 1').length}\t${await sha256Hex(octets('pièce 1'))}\tvérifié`)
    expect(lot.manifeste).not.toMatch(/Dupont|Martin|1787/)
    const zip = await JSZip.loadAsync(lot.zip)
    expect(Object.keys(zip.files).filter((n) => !zip.files[n].dir).sort()).toEqual([
      NOM_DU_MANIFESTE, piece.nom, lisible.nom, 'pieces/20260402-bbbbbbbb.png'].sort())
    expect(await zip.file(NOM_DU_MANIFESTE)!.async('string')).toBe(lot.manifeste)
    expect(lot.empreinteDuManifeste).toBe(await sha256Hex(octets(lot.manifeste)))
  })

  it('un dossier sans fichier a son ZIP, que son manifeste dit vide', async () => {
    const lot = await fabriquerUnLot({ dossier: { id: DOSSIER, nom: 'Vide', siret: null }, rang: 1, dernier: true, fichiers: [], fabriqueLe: new Date('2026-11-12T10:00:00Z') })
    expect(lot.manifeste).toContain('(aucun fichier : le dossier n’en porte pas)')
    expect(nomDuZip({ id: DOSSIER, nom: 'Vide', siret: null }, 2, new Date('2026-11-12T10:00:00Z'))).toBe('copie-2026-11-12-SANS_SIREN-dddddddd-lot2.zip')
  })
})

describe('la découpe', () => {
  it('ferme le lot avant un fichier qui passerait le plafond, jamais un lot vide', () => {
    expect(fermerLeLotAvant(0, 0, PLAFOND_D_UN_LOT * 2)).toBe(false)
    expect(fermerLeLotAvant(PLAFOND_D_UN_LOT - 10, 3, 10)).toBe(false)
    expect(fermerLeLotAvant(PLAFOND_D_UN_LOT - 10, 3, 11)).toBe(true)
    expect(PLAFOND_D_UN_LOT).toBe(100 * 1024 * 1024)
  })
})

describe('le rappel', () => {
  it('un mois civil plus tard, la fin de mois ramenée', () => {
    expect(unMoisApres('2026-01-31')).toBe('2026-02-28')
    expect(unMoisApres('2028-01-31')).toBe('2028-02-29')
    expect(unMoisApres('2026-12-15')).toBe('2027-01-15')
  })

  it('rien sans lecture ; jamais faite, ou plus d’un mois : un rappel ; illisible : dit ; sinon à jour', () => {
    expect(rappelDeLaCopie(null, '2026-11-12').genre).toBe('rien')
    expect(rappelDeLaCopie({ lue: false, motif: 'refus' }, '2026-11-12')).toMatchObject({ genre: 'illisible', motif: 'refus' })
    expect(rappelDeLaCopie({ lue: true, derniere: null, derniereComplete: null }, '2026-11-12').genre).toBe('rappel')
    const complete = { faite_le: '2026-10-11T22:30:00Z', nb_ecarts: 0, nb_manquants: 0 } // le 12/10 à Paris
    expect(rappelDeLaCopie({ lue: true, derniere: complete, derniereComplete: complete }, '2026-11-12'))
      .toEqual({ genre: 'a_jour', phrase: 'Dernière copie complète des fichiers : le 12/10/2026.' })
    expect(rappelDeLaCopie({ lue: true, derniere: complete, derniereComplete: complete }, '2026-11-13').genre).toBe('rappel')
    const ratee = { faite_le: '2026-11-01T10:00:00Z', nb_ecarts: 2, nb_manquants: 1 }
    expect(rappelDeLaCopie({ lue: true, derniere: ratee, derniereComplete: complete }, '2026-11-12'))
      .toMatchObject({ genre: 'a_jour', phrase: expect.stringContaining('La dernière tentative, le 01/11/2026, avait 2 écart(s) et 1 fichier(s) manquant(s).') })
  })

  it('le drapeau de la migration est baissé', () => {
    expect(COPIE_DES_FICHIERS_PREVUE).toBe(false)
  })
})
