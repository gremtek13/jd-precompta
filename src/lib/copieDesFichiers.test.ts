import { describe, expect, it } from 'vitest'
import {
  cheminDuDossier, compterLesLignes, confronterLeManifeste, COPIE_DES_FICHIERS_PREVUE, copieAAttester, inventaireDuDossier,
  manifesteDeLaCopie, MOTIF_HORS_DU_DOSSIER, nomDuZipDeLaCopie, rappelDeLaCopie, relireUnFichier, sha256Hex, unMoisApres,
  type FichierLu, type SourcesDuDossier,
} from './copieDesFichiers'

// LA COPIE DES FICHIERS SUR UN SUPPORT DU CABINET (INAL6) : l'inventaire et ses noms (jamais le nom déposé), la relecture
// de chaque fichier et LE manifeste de la copie (CFC-Q1 (B), un seul ZIP), sa confrontation quand le chef le recharge
// (CFC-Q2 (B)), le rappel, qui ne compte qu'une copie attestée.

const octets = (texte: string) => new TextEncoder().encode(texte)
const P1 = 'aaaaaaaa-0000-4000-8000-000000000001'
const P2 = 'bbbbbbbb-0000-4000-8000-000000000002'
const D1 = 'cccccccc-0000-4000-8000-000000000003'
const DOSSIER = 'dddddddd-0000-4000-8000-000000000004'

async function sources(): Promise<SourcesDuDossier> {
  return {
    dossierId: DOSSIER,
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
    const f = inventaireDuDossier({ dossierId: 'x', pieces: [{ ...p, id: P1 }, { ...p, id: P2 }], documents: [], originaux: [], documentsDuCabinet: [] })
    expect(f.map((x) => x.nom)).toEqual(['pieces/20260102-aaaaaaaa.pdf', 'pieces/20260102-aaaaaaaa-2.pdf'])
  })
})

// La relecture de sécurité du 12/11/2026 : la base laisse le client d'un dossier insérer une pièce ou un document dont le
// chemin désigne un AUTRE dossier (aucune contrainte ne lie le premier segment au dossier) ; la copie téléchargeait ce
// chemin avec les droits du chef, et le fichier d'un autre dossier entrait dans le ZIP de celui-ci, sous son nom.
describe('un chemin hors du dossier', () => {
  const AUTRE = 'eeeeeeee-0000-4000-8000-00000000000e'
  it('se reconnaît : le premier segment est le dossier, aucun segment vide, « . » ni « .. »', () => {
    expect(cheminDuDossier(`${DOSSIER}/1-a.pdf`, DOSSIER)).toBe(true)
    expect(cheminDuDossier(`${DOSSIER}/imports/lot/a.xml`, DOSSIER)).toBe(true)
    expect(cheminDuDossier(`${AUTRE}/1-a.pdf`, DOSSIER)).toBe(false)
    expect(cheminDuDossier(`${DOSSIER}/../${AUTRE}/1-a.pdf`, DOSSIER)).toBe(false)
    expect(cheminDuDossier(`${DOSSIER}//1-a.pdf`, DOSSIER)).toBe(false)
    expect(cheminDuDossier(`${DOSSIER}/./1-a.pdf`, DOSSIER)).toBe(false)
    expect(cheminDuDossier(DOSSIER, DOSSIER)).toBe(false)
    expect(cheminDuDossier(`/${DOSSIER}/1-a.pdf`, DOSSIER)).toBe(false)
  })
  it('est marqué à l’inventaire, la pièce, sa version lisible et le document', async () => {
    const s = await sources()
    const f = inventaireDuDossier({
      ...s,
      pieces: [{ ...s.pieces[0], storage_path: `${AUTRE}/1787-ailleurs.pdf`, lisible_path: `${AUTRE}/1788-ailleurs.jpg` }, s.pieces[1]],
      documents: [{ ...s.documents[0], storage_path: `${DOSSIER}/../${AUTRE}/1789-ailleurs.pdf` }],
    })
    expect(f.map((x) => [x.nature, x.horsDuDossier])).toEqual([
      ['piece', true], ['version_lisible', true], ['piece', false], ['document', true], ['original_repris', false], ['document_du_cabinet', false],
    ])
  })
  it('n’entre jamais dans le ZIP, même téléchargé : manquant, et le manifeste le dit sans son chemin', async () => {
    const s = await sources()
    const [ailleurs, , ici] = inventaireDuDossier({ ...s, pieces: [{ ...s.pieces[0], storage_path: `${AUTRE}/1787-Dupont Jeanne.pdf` }, s.pieces[1]] })
    const relu = await relireUnFichier(ESSAI, { fichier: ailleurs, octets: octets('le fichier d’un autre dossier') })
    expect(relu.octets).toBeNull()
    expect(relu.ligne).toMatchObject({ etat: 'MANQUANT', motif: MOTIF_HORS_DU_DOSSIER, taille: null })
    const autre = await relireUnFichier(ESSAI, { fichier: ici, octets: octets('ticket') })
    const manifeste = manifesteDeLaCopie({ copieId: COPIE, fabriqueLe: new Date('2026-11-12T10:00:00Z'), dossiers: [{ dossier: ESSAI, lignes: [relu.ligne, autre.ligne] }] })
    expect(manifeste).toContain(`MANQUANTS (1) — absents du ZIP\n${relu.ligne.nom}\t${MOTIF_HORS_DU_DOSSIER}`)
    expect(manifeste).not.toMatch(/Dupont|1787|eeeeeeee/)
  })
})

const ESSAI = { id: DOSSIER, nom: 'Cabinet du Dr Essai', siret: '123 456 789 00012' }
const VIDE = { id: 'ffffffff-0000-4000-8000-00000000000f', nom: 'Vide', siret: null }
const COPIE = '0b0b0b0b-0000-4000-8000-0000000000aa'

async function lignesDEssai() {
  const [piece, lisible, ticket, document] = inventaireDuDossier(await sources())
  const lus: FichierLu[] = [
    { fichier: piece, octets: octets('pièce 1') },
    { fichier: lisible, octets: octets('lisible') },
    { fichier: { ...ticket, attendue: 'c'.repeat(64) }, octets: octets('changé') },
    { fichier: document, octets: null, motif: 'le stockage ne l’a pas rendu (404)' },
  ]
  return Promise.all(lus.map(async (lu) => (await relireUnFichier(ESSAI, lu)).ligne))
}

describe('la relecture d’un fichier et LE manifeste de la copie (CFC-Q1 (B) : un seul ZIP)', () => {
  it('chaque fichier relu : vérifié, écart (copié et dit), sans empreinte, manquant ; le chemin dans le ZIP sous son dossier', async () => {
    const lignes = await lignesDEssai()
    expect(lignes.map((l) => [l.nom.split('/')[0], l.etat])).toEqual([
      ['123456789-dddddddd', 'vérifié'], ['123456789-dddddddd', 'non vérifié'], ['123456789-dddddddd', 'ÉCART'], ['123456789-dddddddd', 'MANQUANT'],
    ])
    expect(compterLesLignes(lignes)).toEqual({ fichiers: 4, verifies: 1, ecarts: 1, nonVerifies: 1, manquants: 1, octets: octets('pièce 1').length + octets('lisible').length + octets('changé').length })
  })

  it('un manifeste pour tout le cabinet : l’identifiant, la date de Paris, les comptes, une section par dossier, la liste et la fin', async () => {
    const lignes = await lignesDEssai()
    const m = manifesteDeLaCopie({ copieId: COPIE, fabriqueLe: new Date('2026-11-30T23:30:00Z'), dossiers: [{ dossier: ESSAI, lignes }, { dossier: VIDE, lignes: [] }] })
    expect(m.startsWith('COPIE DES FICHIERS DES DOSSIERS DU CABINET\n')).toBe(true)
    expect(m).toContain(`Identifiant de la copie : ${COPIE}\nFabriquée le : 2026-12-01 (date de Paris)\nDossiers : 2 ; fichiers : 4 ;`)
    expect(m).toContain('DOSSIER 123456789-dddddddd/ : Cabinet du Dr Essai')
    expect(m).toContain('DOSSIER SANS_SIREN-ffffffff/ : Vide')
    expect(m).toContain('(aucun fichier : le dossier n’en porte pas)')
    expect(m).toContain(`123456789-dddddddd/pieces/20260402-bbbbbbbb.png\tattendue ${'c'.repeat(64)}\trelue ${await sha256Hex(octets('changé'))}`)
    expect(m).toContain('MANQUANTS (1) — absents du ZIP\n123456789-dddddddd/documents/20260601-cccccccc.pdf\tle stockage ne l’a pas rendu (404)')
    expect(m).toContain(`${lignes[0].nom}\t${octets('pièce 1').length}\t${await sha256Hex(octets('pièce 1'))}\tvérifié`)
    expect(m.endsWith('FIN DU MANIFESTE — 4 fichier(s), dont 3 dans le ZIP\n')).toBe(true)
    expect(m).not.toMatch(/Dupont|Martin|1787/)
    expect(nomDuZipDeLaCopie(new Date('2026-11-30T23:30:00Z'))).toBe('copie-des-fichiers-2026-12-01.zip')
  })
})

describe('le manifeste rechargé (CFC-Q2 (B))', () => {
  async function copieEtManifeste() {
    const texte = manifesteDeLaCopie({ copieId: COPIE, fabriqueLe: new Date('2026-11-12T10:00:00Z'), dossiers: [{ dossier: ESSAI, lignes: await lignesDEssai() }] })
    const copie = { id: COPIE, faite_le: '2026-11-12T10:05:00Z', nb_fichiers: 4, empreinte_du_manifeste: await sha256Hex(octets(texte)) }
    return { texte, copie }
  }

  it('tel quel : reconnu', async () => {
    const { texte, copie } = await copieEtManifeste()
    expect(await confronterLeManifeste(texte, copie)).toEqual({ ok: true })
    // Une copie qui passe minuit : le manifeste porte la veille de l'enregistrement.
    expect(await confronterLeManifeste(texte, { ...copie, faite_le: '2026-11-12T23:10:00Z' })).toEqual({ ok: true })
  })

  it('d’une autre copie, retouché, tronqué, à une autre date, ou qui n’est pas un manifeste : refusé, et la raison dite', async () => {
    const { texte, copie } = await copieEtManifeste()
    const raison = async (t: string) => { const c = await confronterLeManifeste(t, copie); return c.ok ? 'ok' : c.raison }
    expect(await raison(texte.replace(COPIE, '0c0c0c0c-0000-4000-8000-0000000000bb'))).toBe('autre_copie')
    expect(await raison(texte.replace('\tvérifié', '\tVÉRIFIÉ'))).toBe('retouche')
    expect(await raison(texte.replace('fichiers : 4 ;', 'fichiers : 5 ;'))).toBe('retouche')
    expect(await raison(texte.replace('\r', '').replace(/\n/g, '\r\n'))).not.toBe('ok')
    expect(await raison(texte.slice(0, texte.indexOf('FIN DU MANIFESTE')))).toBe('incomplet')
    const sansDerniereLigne = texte.split('\n').filter((l) => !l.endsWith('\tnon vérifié')).join('\n')
    expect(await raison(sansDerniereLigne)).toBe('incomplet')
    expect(await raison(texte.replace('Fabriquée le : 2026-11-12', 'Fabriquée le : 2026-11-02'))).toBe('date')
    expect(await raison('bonjour')).toBe('illisible')
    const refus = await confronterLeManifeste(texte.replace(COPIE, '0c0c0c0c-0000-4000-8000-0000000000bb'), copie)
    expect(refus).toMatchObject({ ok: false, phrase: expect.stringContaining('la copie du 12/11/2026') })
  })
})

describe('le rappel', () => {
  it('un mois civil plus tard, la fin de mois ramenée', () => {
    expect(unMoisApres('2026-01-31')).toBe('2026-02-28')
    expect(unMoisApres('2028-01-31')).toBe('2028-02-29')
    expect(unMoisApres('2026-12-15')).toBe('2027-01-15')
  })

  const copie = (faite_le: string, rangee: boolean, nb_ecarts = 0, nb_manquants = 0) => ({
    id: COPIE, faite_le, nb_fichiers: 3, empreinte_du_manifeste: 'a'.repeat(64), nb_ecarts, nb_manquants, rangee_le: rangee ? faite_le : null,
  })

  it('rien sans lecture ; jamais faite, ou plus d’un mois : un rappel ; illisible : dit ; sinon à jour', () => {
    expect(rappelDeLaCopie(null, '2026-11-12').genre).toBe('rien')
    expect(rappelDeLaCopie({ lue: false, motif: 'refus' }, '2026-11-12')).toMatchObject({ genre: 'illisible', motif: 'refus' })
    expect(rappelDeLaCopie({ lue: true, derniere: null, derniereComplete: null }, '2026-11-12').genre).toBe('rappel')
    const complete = copie('2026-10-11T22:30:00Z', true) // le 12/10 à Paris
    expect(rappelDeLaCopie({ lue: true, derniere: complete, derniereComplete: complete }, '2026-11-12'))
      .toEqual({ genre: 'a_jour', phrase: 'Dernière copie complète des fichiers : le 12/10/2026.' })
    expect(rappelDeLaCopie({ lue: true, derniere: complete, derniereComplete: complete }, '2026-11-13').genre).toBe('rappel')
    const ratee = copie('2026-11-01T10:00:00Z', true, 2, 1)
    expect(rappelDeLaCopie({ lue: true, derniere: ratee, derniereComplete: complete }, '2026-11-12'))
      .toMatchObject({ genre: 'a_jour', phrase: expect.stringContaining('La dernière copie, le 01/11/2026, avait 2 écart(s) et 1 fichier(s) manquant(s).') })
  })

  it('une copie qui attend son manifeste ne compte pas, et le rappel le dit', () => {
    const enAttente = copie('2026-11-10T10:00:00Z', false)
    const lecture = { lue: true as const, derniere: enAttente, derniereComplete: null }
    expect(rappelDeLaCopie(lecture, '2026-11-12')).toEqual({ genre: 'rappel', phrase:
      'Aucune copie complète des fichiers des dossiers n’a encore été faite sur un support du cabinet. La copie du 10/11/2026 attend son manifeste : le recharger pour qu’elle compte.' })
    expect(copieAAttester(lecture)).toBe(enAttente)
    expect(copieAAttester({ lue: true, derniere: copie('2026-11-10T10:00:00Z', true), derniereComplete: null })).toBeNull()
  })

  it('le drapeau de la migration est levé (en production depuis le 12/11/2026)', () => {
    expect(COPIE_DES_FICHIERS_PREVUE).toBe(true)
  })
})
