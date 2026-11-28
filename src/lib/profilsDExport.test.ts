import { beforeAll, describe, expect, it } from 'vitest'
import { composerLeFecFictif, type FecFictif } from '../test/fecFictif'
import { ecriture } from '../test/revision'
import type { LigneFec, NumerotationFec } from './fec'
import {
  encoderWindows1252, EXPORT_VERS_UN_LOGICIEL_OFFERT, extensionDuType, horsDeWindows1252, journauxDuFec, justificatifsDeLExport,
  mettreEnFormePourAcd, nomDeLArchive, octetWindows1252, REFUS_NOMMES_AU_PLUS, REGLAGES_PROPOSES_ACD, type ReglagesDuProfil,
} from './profilsDExport'

// LE PROFIL « ACD » DE L'EXPORT VERS UN LOGICIEL COMPTABLE (EXP1). Ce que ces cas gardent : l'encodeur Windows-1252 relu par
// le décodeur de la plateforme (indépendant du nôtre) ; le fichier mis en forme depuis le FEC fictif (src/test/fecFictif.ts,
// celui que outils/fec/ écrit) qui ne change NI un montant, NI une date, NI une pièce, NI un libellé du FEC — seuls le code du
// journal, l'EcritureNum (continu), le compte (complété de zéros) et, sur choix, les quatre champs du BNC ; les refus avant
// tout fichier, chacun nommé par sa ligne ; les justificatifs sous la référence neutre de leur pièce.

const decoder = new TextDecoder('windows-1252')
// Le fichier finit par une fin de ligne (comme celui d'ACD) : la dernière, vide, n'est pas une ligne du fichier.
const colonnesDe = (texte: string) => texte.replace(/\r\n$/, '').split('\r\n').map((l) => l.split('\t'))
const reglages = (o: Partial<ReglagesDuProfil> = {}): ReglagesDuProfil => ({ ...REGLAGES_PROPOSES_ACD, ...o })

const ENTETE_18 = ['JournalCode', 'JournalLib', 'EcritureNum', 'EcritureDate', 'CompteNum', 'CompteLib', 'CompAuxNum', 'CompAuxLib',
  'PieceRef', 'PieceDate', 'EcritureLib', 'Debit', 'Credit', 'EcritureLet', 'DateLet', 'ValidDate', 'Montantdevise', 'Idevise']
const ligne18 = (o: { journal?: string; num?: string; compte?: string; libelle?: string; debit?: string; credit?: string } = {}) => [
  o.journal ?? 'BQ', o.journal === 'AN' ? 'À-nouveaux' : 'Banque', o.num ?? 'BQ00001', '20260105', o.compte ?? '512000', 'Banque', '', '',
  'REL-1', '20260105', o.libelle ?? 'Relevé du 05/01/2026', o.debit ?? '100,00', o.credit ?? '0,00', '', '', '20260105', '', '',
].join('\t')
const fec18 = (...lignes: string[]) => [ENTETE_18.join('\t'), ...lignes].join('\r\n')

describe('le drapeau', () => {
  it('est levé depuis le 17/11/2026, sur l’accord du cabinet : l’onglet Écritures offre l’export', () => {
    expect(EXPORT_VERS_UN_LOGICIEL_OFFERT).toBe(true)
  })
})

describe('l’encodeur Windows-1252', () => {
  it('écrit les caractères des libellés, relus à l’identique par le décodeur de la plateforme', () => {
    const texte = 'À-nouveaux — Dépense — Achats ; œuvre, l’été : 12 € ; « Ÿ » ; ½\t\r\n'
    expect(decoder.decode(encoderWindows1252(texte))).toBe(texte)
    expect([...encoderWindows1252('—€’œ')]).toEqual([0x97, 0x80, 0x92, 0x9c])
  })

  it('ne connaît ni les cinq octets vides de la page, ni ce qui n’y est pas, et lève plutôt que de remplacer', () => {
    for (const p of [0x81, 0x8d, 0x8f, 0x90, 0x9d, 0x80, 0x9f, 0x0103, 0x2260, 0x1f600]) expect(octetWindows1252(p)).toBeNull()
    expect(horsDeWindows1252('Patiente Ștefan')).toBe('Ș')
    expect(horsDeWindows1252('Dépense — Achats')).toBeNull()
    expect(() => encoderWindows1252('ă')).toThrow(/U\+0103/)
  })
})

describe('le profil ACD sur le FEC fictif', () => {
  let fictif: FecFictif
  beforeAll(() => { fictif = composerLeFecFictif({ sansReglement: 'vides' }) })

  it('à vingt-deux colonnes : ne change que le journal, le numéro et le compte — ni montant, ni date, ni pièce, ni libellé', () => {
    const r = mettreEnFormePourAcd(fictif.vingtDeux, reglages())
    if (!r.ok) throw new Error(r.refus.join(' '))
    expect(r.vingtDeux).toBe(true)
    expect(decoder.decode(r.octets)).toBe(r.texte)
    expect(r.texte).not.toMatch(/\r(?!\n)|(?<!\r)\n/)
    const avant = colonnesDe(fictif.vingtDeux)
    const apres = colonnesDe(r.texte)
    expect(apres[0]).toEqual(avant[0])
    expect(apres.length).toBe(avant.length)
    expect(r.lignes).toBe(avant.length - 1)
    const inchangees = [0, 1, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]
    for (let i = 1; i < avant.length; i++) {
      expect(apres[i].length).toBe(22)
      for (const k of inchangees) expect(apres[i][k]).toBe(avant[i][k])
      expect(apres[i][4]).toHaveLength(8)
      expect(apres[i][4]).toBe(avant[i][4].padEnd(8, '0'))
    }
    // L'EcritureNum : un entier continu sur tout le fichier, qui change exactement là où celui du FEC change.
    let attendu = 0
    for (let i = 1; i < avant.length; i++) {
      if (i === 1 || avant[i][2] !== avant[i - 1][2]) attendu++
      expect(apres[i][2]).toBe(String(attendu))
    }
    expect(r.ecritures).toBe(attendu)
    expect(r.ecritures).toBe(new Set(avant.slice(1).map((l) => l[2])).size)
  })

  it('les journaux traduits, deux des nôtres pouvant aller au même ; nos codes par défaut', () => {
    const codes = journauxDuFec(fictif.vingtDeux).map((j) => j.code)
    expect(codes[0]).toBe('AN')
    expect(codes).toContain('BQ')
    const r = mettreEnFormePourAcd(fictif.vingtDeux, reglages({ journaux: { BQ: 'CA1', OD: 'OD' } }))
    if (!r.ok) throw new Error(r.refus.join(' '))
    expect(colonnesDe(r.texte).slice(1).some((l) => l[0] === 'BQ')).toBe(false)
    expect(colonnesDe(r.texte).slice(1).filter((l) => l[0] === 'CA1').length)
      .toBe(colonnesDe(fictif.vingtDeux).slice(1).filter((l) => l[0] === 'BQ').length)
    expect(r.journaux.find((j) => j.nous === 'BQ')).toEqual({ nous: 'BQ', eux: 'CA1', libelle: 'Banque' })
    expect(r.journaux.find((j) => j.nous === 'AN')?.eux).toBe('AN')
  })

  it('les quatre champs du BNC selon EXP-Q5 : nos valeurs, NatOp et IdClient vides, ou les quatre vides', () => {
    const avant = colonnesDe(fictif.vingtDeux).slice(1)
    const b = mettreEnFormePourAcd(fictif.vingtDeux, reglages({ quatreChamps: 'sans_natop_ni_idclient' }))
    const c = mettreEnFormePourAcd(fictif.vingtDeux, reglages({ quatreChamps: 'vides' }))
    if (!b.ok || !c.ok) throw new Error('refusé')
    colonnesDe(b.texte).slice(1).forEach((l, i) => {
      expect(l.slice(18)).toEqual([avant[i][18], avant[i][19], '', ''])
    })
    colonnesDe(c.texte).slice(1).forEach((l) => expect(l.slice(18)).toEqual(['', '', '', '']))
    expect(avant.some((l) => l[20] !== '')).toBe(true)
  })

  it('sans le journal des à-nouveaux : aucune ligne AN, et la numérotation part de 1 sur la première écriture qui reste', () => {
    const r = mettreEnFormePourAcd(fictif.vingtDeux, reglages({ sansANouveaux: true }))
    if (!r.ok) throw new Error(r.refus.join(' '))
    const lignes = colonnesDe(r.texte).slice(1)
    expect(lignes.some((l) => l[0] === 'AN')).toBe(false)
    expect(lignes[0][2]).toBe('1')
    expect(lignes.length).toBe(colonnesDe(fictif.vingtDeux).length - 1 - fictif.aNouveaux)
  })

  it('la forme des comptes de tiers : nos auxiliaires tels quels, ou les deux colonnes vides — rien d’autre ne bouge', () => {
    const ENTETE = colonnesDe(fictif.dixHuit)[0].join('\t')
    const avecAux = (num: string, compte: string, aux: string, lib: string, debit: string, credit: string) =>
      ['VE', 'Ventes', num, '20260105', compte, 'Compte', aux, lib, 'F2026-1', '20260105', 'Facture F2026-1', debit, credit, 'A', '20260110', '20260105', '', ''].join('\t')
    const fec = [ENTETE, avecAux('VE00001', '411000', 'CDUPONT', 'Dupont SA', '100,00', '0,00'), avecAux('VE00001', '706000', '', '', '0,00', '100,00')].join('\r\n')
    const nos = mettreEnFormePourAcd(fec, reglages())
    const sans = mettreEnFormePourAcd(fec, reglages({ formeDesTiers: 'sans_auxiliaires' }))
    if (!nos.ok || !sans.ok) throw new Error('refusé')
    expect(colonnesDe(nos.texte)[1].slice(6, 8)).toEqual(['CDUPONT', 'Dupont SA'])
    expect(colonnesDe(sans.texte)[1].slice(6, 8)).toEqual(['', ''])
    colonnesDe(sans.texte).forEach((l, i) => {
      const n = colonnesDe(nos.texte)[i]
      expect([...l.slice(0, 6), ...l.slice(8)], String(i)).toEqual([...n.slice(0, 6), ...n.slice(8)])
    })
    // Sur le FEC fictif : chaque ligne qui portait un auxiliaire le perd, toute autre colonne et toute autre ligne restent.
    const a = mettreEnFormePourAcd(fictif.vingtDeux, reglages())
    const b = mettreEnFormePourAcd(fictif.vingtDeux, reglages({ formeDesTiers: 'sans_auxiliaires' }))
    if (!a.ok || !b.ok) throw new Error('refusé')
    const la = colonnesDe(a.texte)
    const lb = colonnesDe(b.texte)
    expect(lb.length).toBe(la.length)
    lb.slice(1).forEach((l, i) => {
      expect(l.slice(6, 8), String(i)).toEqual(['', ''])
      expect([...l.slice(0, 6), ...l.slice(8)], String(i)).toEqual([...la[i + 1].slice(0, 6), ...la[i + 1].slice(8)])
    })
  })

  it('à dix-huit colonnes : le fichier les garde, et le choix des quatre champs est sans objet', () => {
    const r = mettreEnFormePourAcd(fictif.dixHuit, reglages({ quatreChamps: 'vides' }))
    if (!r.ok) throw new Error(r.refus.join(' '))
    expect(r.vingtDeux).toBe(false)
    expect(colonnesDe(r.texte).every((l) => l.length === 18)).toBe(true)
  })
})

describe('les refus, avant tout fichier', () => {
  it('une longueur de comptes hors de 6 à 12, ou qui n’est pas un nombre entier', () => {
    for (const n of [5, 13, Number.NaN, 7.5]) {
      const r = mettreEnFormePourAcd(fec18(ligne18()), reglages({ longueurDesComptes: n }))
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.refus[0]).toMatch(/de 6 à 12/)
    }
    for (const n of [6, 12]) expect(mettreEnFormePourAcd(fec18(ligne18()), reglages({ longueurDesComptes: n })).ok).toBe(true)
  })

  it('un compte plus long que la longueur choisie : nommé par sa ligne, jamais tronqué', () => {
    const r = mettreEnFormePourAcd(fec18(ligne18(), ligne18({ compte: '4011234567', debit: '0,00', credit: '100,00' })), reglages())
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.refus).toEqual([expect.stringMatching(/^Ligne 3 du fichier \(écriture BQ00001\) : le compte 4011234567 a 10 caractères/)])
  })

  it('un caractère hors de Windows-1252 : nommé par sa ligne, son écriture et sa colonne, jamais remplacé', () => {
    const r = mettreEnFormePourAcd(fec18(ligne18(), ligne18({ num: 'BQ00002', libelle: 'Achat ≠ facture' })), reglages())
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.refus).toHaveLength(1)
      expect(r.refus[0]).toMatch(/^Ligne 3 du fichier \(écriture BQ00002, colonne EcritureLib\) : le caractère « ≠ » \(U\+2260\)/)
    }
  })

  it('un code de journal du logiciel vide ou avec une espace', () => {
    for (const code of ['', 'B Q', 'BQ\t']) {
      const r = mettreEnFormePourAcd(fec18(ligne18()), reglages({ journaux: { BQ: code } }))
      expect(r.ok).toBe(false)
    }
  })

  it('les refus d’un même genre se nomment jusqu’à un plafond, puis se comptent', () => {
    const lignes = Array.from({ length: REFUS_NOMMES_AU_PLUS + 3 }, (_, i) => ligne18({ num: `BQ${String(i + 1).padStart(5, '0')}`, libelle: `n° ${i} ă` }))
    const r = mettreEnFormePourAcd(fec18(...lignes), reglages())
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.refus).toHaveLength(REFUS_NOMMES_AU_PLUS + 1)
      expect(r.refus.at(-1)).toBe('… et 3 autre(s) du même genre.')
    }
  })

  it('deux comptes distincts du FEC que le bourrage de zéros rendrait égaux : nommés, jamais réunis en silence (28/11/2026)', () => {
    // « 512 » (un à-nouveau repris d'une balance à trois chiffres) et « 512000 » (la banque du plan) deviennent tous deux
    // « 51200000 » à huit : un seul compte du logiciel, sous deux CompteLib — et deux postes de la 2035 pour « 6064 » et « 606400 ».
    const r = mettreEnFormePourAcd(fec18(
      ligne18({ journal: 'AN', num: 'AN00001', compte: '512' }), ligne18({ journal: 'AN', num: 'AN00001', compte: '101000', debit: '0,00', credit: '100,00' }),
      ligne18(), ligne18({ compte: '6064', debit: '0,00', credit: '100,00' }),
      ligne18({ num: 'BQ00002', compte: '606400' }), ligne18({ num: 'BQ00002', debit: '0,00', credit: '100,00' }),
    ), reglages())
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.refus).toEqual([
        expect.stringMatching(/^Les comptes 512 et 512000 du FEC deviendraient tous deux 51200000 dans le fichier/),
        expect.stringMatching(/^Les comptes 6064 et 606400 du FEC deviendraient tous deux 60640000 dans le fichier/),
      ])
    }
    // Sans les à-nouveaux, le « 512 » ne part pas : seul le second couple se refuse.
    const sans = mettreEnFormePourAcd(fec18(ligne18({ journal: 'AN', num: 'AN00001', compte: '512' }), ligne18()), reglages({ sansANouveaux: true }))
    expect(sans.ok).toBe(true)
  })

  it('un FEC sans ses colonnes ou sans écriture', () => {
    expect(mettreEnFormePourAcd('n’importe quoi', reglages()).ok).toBe(false)
    expect(mettreEnFormePourAcd(fec18(ligne18({ journal: 'AN', num: 'AN00001' })), reglages({ sansANouveaux: true })))
      .toEqual({ ok: false, refus: ['Aucune écriture à exporter.'] })
  })
})

describe('les justificatifs', () => {
  const ligne = (o: Partial<LigneFec>): LigneFec => ({
    ecriture: ecriture({}), journal: 'BQ', numero: 1, pieceRef: 'REL', pieceDate: '2026-01-05', compteLib: 'Banque',
    compAuxNum: null, compAuxLib: null, validDate: '2026-01-05', champsBnc: null, ...o,
  })
  const numerotation = (lignes: LigneFec[]): NumerotationFec => ({ aNouveaux: [], lignes, champsBnc: 'non_calcules', horsFec: [] })
  const pieces = [
    { id: 'p1', storage_path: 'd/1-Ordonnance de Mme X.pdf' },
    { id: 'p2', storage_path: 'd/2.pdf' },
    { id: 'p3', storage_path: 'd/3.pdf' },
    { id: 'p4', storage_path: 'd/4.pdf' },
    { id: 'p5', storage_path: 'autre/5.pdf' },
  ]

  it('une pièce une fois, sous sa référence neutre ; ce qui ne se joint pas, dit sans nom de fichier', () => {
    const n = numerotation([
      ligne({ ecriture: ecriture({ id: 'a', piece_id: 'p1' }), numero: 1, pieceRef: '20260105-0a1b2c3d' }),
      ligne({ ecriture: ecriture({ id: 'b', piece_id: 'p1' }), numero: 2, pieceRef: '20260105-0a1b2c3d' }),
      ligne({ ecriture: ecriture({ id: 'c', piece_id: 'p2' }), numero: 3, pieceRef: 'Ordonnance de Mme X.pdf' }),
      ligne({ ecriture: ecriture({ id: 'd', piece_id: 'absente' }), numero: 4, pieceRef: '20260106-aaaaaaaa' }),
      ligne({ ecriture: ecriture({ id: 'e', piece_id: 'p3' }), numero: 5, pieceRef: '20260105-0a1b2c3d' }),
      ligne({ ecriture: ecriture({ id: 'f', piece_id: null }), numero: 6 }),
      ligne({ ecriture: ecriture({ id: 'h', piece_id: 'p5' }), numero: 8, pieceRef: '20260108-cccccccc' }),
      ligne({ ecriture: ecriture({ id: 'g', piece_id: 'p4' }), numero: 7, pieceRef: '20260107-bbbbbbbb' }),
    ])
    // L'écriture 7 ne part pas (les à-nouveaux écartés, par exemple) : son fichier non plus.
    const numeros = new Map(['BQ00001', 'BQ00002', 'BQ00003', 'BQ00004', 'BQ00005', 'BQ00006', 'BQ00008'].map((k, i) => [k, i + 1]))
    const j = justificatifsDeLExport('d', n, pieces, numeros)
    expect(j.aJoindre).toEqual([{ pieceId: 'p1', reference: '20260105-0a1b2c3d', chemin: 'd/1-Ordonnance de Mme X.pdf' }])
    expect(j.ecartes).toHaveLength(4)
    expect(j.ecartes.at(-1)).toMatch(/^Écriture BQ00008 : son chemin de stockage n’est pas dans ce dossier/)
    expect(j.ecartes.join(' ')).not.toMatch(/Ordonnance|Mme|autre\//)
    expect(j.ecrituresSansJustificatif).toBe(5)
  })

  it('une écriture dont la pièce est écartée reste sans justificatif, sur chacune de ses lignes et dans toute autre écriture qui la cite (28/11/2026)', () => {
    const n = numerotation([
      ligne({ ecriture: ecriture({ id: 'a', piece_id: 'p2' }), numero: 1, pieceRef: 'Ordonnance de Mme X.pdf' }),
      ligne({ ecriture: ecriture({ id: 'b', piece_id: 'p2' }), numero: 1, pieceRef: 'Ordonnance de Mme X.pdf' }),
      ligne({ ecriture: ecriture({ id: 'c', piece_id: 'p2' }), numero: 2, pieceRef: 'Ordonnance de Mme X.pdf' }),
      ligne({ ecriture: ecriture({ id: 'd', piece_id: 'p4' }), numero: 3, pieceRef: '20260107-bbbbbbbb' }),
      ligne({ ecriture: ecriture({ id: 'e', piece_id: 'p4' }), numero: 3, pieceRef: '20260107-bbbbbbbb' }),
    ])
    const numeros = new Map(['BQ00001', 'BQ00002', 'BQ00003'].map((k, i) => [k, i + 1]))
    const j = justificatifsDeLExport('d', n, pieces, numeros)
    expect(j.aJoindre.map((x) => x.pieceId)).toEqual(['p4'])
    expect(j.ecartes).toHaveLength(1)
    expect(j.ecrituresSansJustificatif).toBe(2)
  })

  it('l’extension d’après le type que l’application décide, et le nom de l’archive', () => {
    expect(extensionDuType('application/pdf')).toBe('pdf')
    expect(extensionDuType('image/jpeg')).toBe('jpg')
    expect(extensionDuType('image/png')).toBe('png')
    expect(extensionDuType('text/csv')).toBe('csv')
    expect(extensionDuType('image/svg+xml')).toBeNull()
    expect(extensionDuType(null)).toBeNull()
    expect(nomDeLArchive('123456789FEC20261231.txt')).toBe('123456789FEC20261231.zip')
  })
})
