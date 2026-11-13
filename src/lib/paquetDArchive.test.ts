import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import {
  ENTETE_DES_FICHIERS, ENTETE_DU_PDF_2035, INVENTAIRE_DU_PAQUET_SANS_OBJET, MARQUE_NON_VERIFIEE, NOM_DE_LA_DOCUMENTATION, NOM_DU_MANIFESTE, fabriquerLePaquet, nomDuPaquet,
  nomsDesOriginaux, piecesCiteesParLExercice, piecesSansEmpreinte, sha256Hex, type EntreesDuPaquet, type OriginalLu, type PieceDuPaquet,
} from './paquetDArchive'
import { genererPisteAuditCsv } from './pisteAudit'

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
    // La piste d'audit telle que le générateur de l'onglet Écritures la produit (BOM, en-tête), plus une ligne.
    pisteAudit: { etat: 'produite', contenu: `${genererPisteAuditCsv([])}\r\n2025-02-03;606100;Pièce du 03/02/2025;12,00` },
    pdf2035: { etat: 'rempli', octets: encodeur.encode('%PDF-1.7 2035 remplie'), casesNonPlacees: [], avertissement: null },
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
      ['123456789FEC20251231.txt', '2035-2025.json', '2035-2025.pdf', NOM_DE_LA_DOCUMENTATION, NOM_DU_MANIFESTE, 'piste-audit-2025.csv'])
    const originaux = noms.filter((n) => n.startsWith('pieces/'))
    expect(originaux).toHaveLength(2)
    expect(originaux[0]).toMatch(/^pieces\/20250203-[0-9a-f]{8}\.pdf$/)
    expect(originaux[1]).toMatch(/^pieces\/20250301-[0-9a-f]{8}\.jpg$/)
    expect(manifeste).toContain(`Empreinte de l'exercice : ${'e'.repeat(64)}`)
    expect(manifeste).toContain('aucune (premier exercice validé du dossier)')
    // La date de Paris de la fabrication : 23 h 30 UTC le 10, minuit et demi le 11 à Paris.
    expect(manifeste).toContain('Fabriqué le : 2026-11-11 (date de Paris)')
    expect(JSON.parse(await zip.file('2035-2025.json')!.async('string'))).toEqual({ AG: 1200, BR: 300 })
    // La piste d'audit et le PDF de la 2035 (INAL3c) : leurs octets tels que reçus, le BOM de la piste compris.
    const piste = await zip.file('piste-audit-2025.csv')!.async('uint8array')
    expect([...piste.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    expect(new TextDecoder().decode(piste)).toContain('Pièce du 03/02/2025')
    expect(await zip.file('2035-2025.pdf')!.async('string')).toBe('%PDF-1.7 2035 remplie')
    expect(manifeste).toContain(`${ENTETE_DU_PDF_2035} : 2035-2025.pdf, les pages 2035-A et 2035-B`)
    expect(manifeste).not.toMatch(/AVERTISSEMENT|NON PLACÉES|NON PRODUIT/)
    expect(paquet.avisDuPdf2035).toBeNull()
  })

  it('une piste d’audit refusée (lue en partie) ou vide refuse TOUT le paquet (INAL3c)', async () => {
    const e = await entrees()
    const motif = 'Les mouvements bancaires n’ont pas pu être lus en entier (3 ligne(s) lue(s) sur 4 annoncée(s)).'
    const refuse = await fabriquerLePaquet({ ...e, pisteAudit: { etat: 'refusee', motif } })
    expect(refuse).toEqual({ ok: false, message: `Aucun paquet d’archive : la piste d’audit de l’exercice n’a pas pu se produire (${motif}).` })
    expect(await fabriquerLePaquet({ ...e, pisteAudit: { etat: 'produite', contenu: '\uFEFF ' } }))
      .toMatchObject({ ok: false, message: expect.stringContaining('la piste d’audit de l’exercice 2025 est vide') })
  })

  it('un PDF de la 2035 qui ne se remplit pas : le paquet part sans lui, et le manifeste le dit (INAL3c)', async () => {
    const e = await entrees()
    const paquet = await fabriquerLePaquet({ ...e, pdf2035: { etat: 'impossible', motif: 'Formulaire 2035 introuvable (404)' } })
    if (!paquet.ok) throw new Error(paquet.message)
    expect(paquet.fichiers.map((f) => f.chemin)).not.toContain('2035-2025.pdf')
    expect(paquet.fichiers.map((f) => f.chemin)).toContain('2035-2025.json')
    expect(paquet.manifeste).toContain(`${ENTETE_DU_PDF_2035} : NON PRODUIT — Formulaire 2035 introuvable (404)`)
    expect(paquet.avisDuPdf2035).toContain('le PDF de la 2035 n’est pas dans le paquet (Formulaire 2035 introuvable (404))')
  })

  it('un PDF rempli sur un millésime substitué, ou à cases non placées, le dit au manifeste (2035S-Q5)', async () => {
    const e = await entrees()
    const paquet = await fabriquerLePaquet({
      ...e, pdf2035: { etat: 'rempli', octets: encodeur.encode('%PDF'), casesNonPlacees: ['BT', 'CC'], avertissement: 'millésime absent' },
    })
    if (!paquet.ok) throw new Error(paquet.message)
    expect(paquet.manifeste).toContain('AVERTISSEMENT : millésime absent')
    expect(paquet.manifeste).toContain('CASES NON PLACÉES SUR LE PDF (leur montant y manque) : BT, CC')
    expect(paquet.avisDuPdf2035).toContain('BT, CC')
  })

  it('sans 2035 validée : aucun PDF, et le manifeste le dit ; un PDF venu d’ailleurs se refuse', async () => {
    const e = await entrees()
    const sans = { ...e, exercice: { ...e.exercice, declaration: null } }
    const paquet = await fabriquerLePaquet({ ...sans, pdf2035: { etat: 'impossible', motif: 'aucune' } })
    if (!paquet.ok) throw new Error(paquet.message)
    expect(paquet.fichiers.map((f) => f.chemin).filter((c) => c.startsWith('2035-'))).toEqual([])
    expect(paquet.manifeste).toContain(`${ENTETE_DU_PDF_2035} : aucun — la validation de cet exercice n’a figé aucune 2035.`)
    expect(paquet.avisDuPdf2035).toBeNull()
    expect(await fabriquerLePaquet(sans)).toMatchObject({ ok: false, message: expect.stringContaining('sans 2035 validée') })
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

  it('une pièce sans empreinte de dépôt entre, marquée « non vérifiée » au manifeste (INAL3-Q1)', async () => {
    const e = await entrees()
    for (const absente of [null, '', '   ']) {
      // Ses octets ne sont relus contre rien : même retouchés, ils entrent, et le manifeste dit qu'ils ne sont pas vérifiés.
      const sans = { piece: { ...e.originaux[0].piece, storage_hash: absente }, octets: encodeur.encode('%PDF facture A, retouchée') }
      const paquet = await fabriquerLePaquet({ ...e, originaux: [sans, e.originaux[1]] })
      if (!paquet.ok) throw new Error(paquet.message)
      expect(paquet.nonVerifiees).toBe(1)
      const zip = await JSZip.loadAsync(paquet.zip)
      const nom = Object.keys(zip.files).find((n) => n.startsWith('pieces/20250203-'))!
      expect(await zip.file(nom)!.async('string')).toBe('%PDF facture A, retouchée')
      const lignes = paquet.manifeste.split('\n')
      expect(lignes).toContain(`${nom}\t${sans.piece.id}\t${MARQUE_NON_VERIFIEE}`)
      expect(MARQUE_NON_VERIFIEE).toBe('non vérifiée (aucune empreinte de dépôt)')
      expect(paquet.manifeste).toMatch(/^PIÈCES NON VÉRIFIÉES : 1\./m)
      // L'autre pièce garde son empreinte de dépôt.
      expect(lignes).toContain(`${Object.keys(zip.files).find((n) => n.startsWith('pieces/20250301-'))}\t${e.originaux[1].piece.id}\t${e.originaux[1].piece.storage_hash}`)
    }
  })

  it('sans pièce à vérifier en moins, le manifeste ne dit rien de non vérifié', async () => {
    const paquet = await fabriquerLePaquet(await entrees())
    if (!paquet.ok) throw new Error(paquet.message)
    expect(paquet.nonVerifiees).toBe(0)
    expect(paquet.manifeste).not.toMatch(/non vérifiée|NON VÉRIFIÉES/)
  })

  it('une empreinte de dépôt présente mais illisible refuse le paquet : ce n’est pas une absence', async () => {
    const e = await entrees()
    const illisible = { ...e.originaux[0], piece: { ...e.originaux[0].piece, storage_hash: 'pas-une-empreinte' } }
    const paquet = await fabriquerLePaquet({ ...e, originaux: [illisible, e.originaux[1]] })
    expect(paquet).toMatchObject({ ok: false, message: expect.stringMatching(/^Aucun paquet d’archive : l’empreinte de dépôt de la pièce 20250203-[0-9a-f]{8} est illisible/) })
  })

  it('les pièces citées sans empreinte, que l’écran dit avant le clic : citées seulement, nulle ou vide', () => {
    const p = (id: string, storage_hash: string | null) => ({ id, storage_hash })
    expect(piecesSansEmpreinte([p('c', null), p('a', ''), p('b', 'ab'.repeat(32)), p('z', null), p('d', '  ')], ['a', 'b', 'c', 'd']))
      .toEqual(['a', 'c', 'd'])
    expect(piecesSansEmpreinte([p('a', null)], [])).toEqual([])
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
      INVENTAIRE_DU_PAQUET_SANS_OBJET,
    )).toEqual(['p1', 'p2'])
  })

  // INV3-Q1 (A) : la règle de `pieces_scellees_par_l_inventaire` (migration `validation_de_l_inventaire`), cas par cas.
  it('l’inventaire lu : les pièces des régularisations qu’il scelle et de la provision qu’il évalue, la reprise par l’exercice de son extourne', () => {
    const op = (o: { exercice: number; reprise?: boolean; piece_citee_id?: string | null; provision_id?: string | null }) =>
      ({ reprise: false, piece_citee_id: null, provision_id: null, ...o })
    const inventaire = {
      etat: 'lu' as const, annee: 2025,
      operations: [
        op({ exercice: 2025, piece_citee_id: 'r25' }),                     // constatée en 2025 : scellée par 2025
        op({ exercice: 2024, piece_citee_id: 'r24' }),                     // constatée en 2024 : pas par 2025
        op({ exercice: 2024, reprise: true, piece_citee_id: 'rep' }),      // reprise de 2024 : son extourne est en 2025
        op({ exercice: 2025, reprise: true, piece_citee_id: 'rep26' }),    // reprise de 2025 : scellée par 2026
        op({ exercice: 2025, provision_id: 'pv1' }),                       // l'évaluation 2025 d'une provision qui cite une pièce
        op({ exercice: 2024, provision_id: 'pv2' }),                       // une évaluation 2024 : pas par 2025
        op({ exercice: 2025, provision_id: 'pv3' }),                       // une provision qui ne cite aucune pièce
      ],
      provisions: [{ id: 'pv1', piece_citee_id: 'prov' }, { id: 'pv2', piece_citee_id: 'prov24' }, { id: 'pv3', piece_citee_id: null }],
    }
    expect(piecesCiteesParLExercice([{ piece_id: 'p1', immobilisation_id: null }, { piece_id: 'r25', immobilisation_id: null }], [], inventaire))
      .toEqual(['p1', 'prov', 'r25', 'rep'])
    // Sans objet (le drapeau `INVENTAIRE_PREVU` baissé) : l'ensemble d'hier, au caractère près.
    expect(piecesCiteesParLExercice([{ piece_id: 'p1', immobilisation_id: null }], [], INVENTAIRE_DU_PAQUET_SANS_OBJET)).toEqual(['p1'])
    // L'exercice 2026 ne prend que la reprise de 2025.
    expect(piecesCiteesParLExercice([], [], { ...inventaire, annee: 2026 })).toEqual(['rep26'])
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
