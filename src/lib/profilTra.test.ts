import { beforeAll, describe, expect, it } from 'vitest'
import { composerLeFecFictif, type FecFictif } from '../test/fecFictif'
import { journauxDuFec } from './profilsDExport'
import {
  dateTra, enregistrementTra, JOURNAL_TRA_A_SAISIR, LONGUEUR_DE_L_ECRITURE, LONGUEUR_DE_L_EN_TETE, LONGUEUR_DU_DOCUMENT,
  LONGUEUR_DU_JOURNAL, mettreEnFormePourTra, montantTra, nomDeLArchiveTra, nomDuFichierTra, nomDuJustificatifTra, PROFIL_TRA_OFFERT,
  ZONES_DE_L_ECRITURE, ZONES_DE_L_EN_TETE, ZONES_DU_DOCUMENT, ZONES_DU_JOURNAL, type JournalTra, type ReglagesTra,
} from './profilTra'

// LE PROFIL « TRA » (EXP4). Ce que ces cas gardent : les zones de l'en-tête, du journal, de l'écriture et du document GED aux
// positions de la description publique de Cegid (version 11), contiguës, sans chevauchement, et celles de l'écriture
// identiques dans les versions 010 et 7 ; le FEC fictif (src/test/fecFictif.ts) relu zone par zone — le journal, la date
// JJMMAAAA, la nature du mouvement, le compte complété, la pièce et le libellé coupés à 35, le sens, le montant aligné à
// droite égal au débit ou au crédit du FEC, « N », « E-- », rien d'autre — ; chaque réglage à saisir, aucun préchoisi ; chaque
// refus avant tout fichier ; le document « G » après la dernière ligne de son écriture.

const decoder = new TextDecoder('windows-1252')
type ZonesQuelconques = Readonly<Record<string, readonly [number, number]>>
const zone = <Z extends ZonesQuelconques>(zones: Z, ligne: string, nom: keyof Z) => {
  const [position, longueur] = zones[nom]
  return ligne.slice(position - 1, position - 1 + longueur)
}
const ecr = (ligne: string, nom: keyof typeof ZONES_DE_L_ECRITURE) => zone(ZONES_DE_L_ECRITURE, ligne, nom)

const journal = (o: Partial<JournalTra> = {}): JournalTra => ({ code: 'HA', libelle: 'Achats', nature: 'ACH', typeDePiece: 'FF', contrepartie: '', ...o })
const JOURNAUX: Record<string, JournalTra> = {
  AC: journal(),
  VE: journal({ code: 'VT', libelle: 'Ventes', nature: 'VTE', typeDePiece: 'FC' }),
  BQ: journal({ code: 'BQ1', libelle: 'Banque', nature: 'BQE', typeDePiece: 'OD', contrepartie: '512' }),
  OD: journal({ code: 'OD', libelle: 'Opérations diverses', nature: 'OD', typeDePiece: 'OD' }),
  AN: journal({ code: 'AN', libelle: 'A nouveaux', nature: 'ANO', typeDePiece: 'OD' }),
}
const reglages = (o: Partial<ReglagesTra> = {}): ReglagesTra => ({
  encodage: 'windows-1252', finDEnregistrement: 'crlf', longueurDesComptes: 8, produit: 'S5', origine: 'CLI', nouvelleAnalytique: 'X',
  numeroDePiece: 'vide', journaux: JOURNAUX, sansANouveaux: false, cheminDesJustificatifs: null, ...o,
})
const SANS = { avecJustificatifs: false }

const ENTETE = ['JournalCode', 'JournalLib', 'EcritureNum', 'EcritureDate', 'CompteNum', 'CompteLib', 'CompAuxNum', 'CompAuxLib',
  'PieceRef', 'PieceDate', 'EcritureLib', 'Debit', 'Credit', 'EcritureLet', 'DateLet', 'ValidDate', 'Montantdevise', 'Idevise']
const ligne = (o: Partial<Record<'journal' | 'num' | 'date' | 'compte' | 'aux' | 'ref' | 'lib' | 'debit' | 'credit' | 'let' | 'devise', string>> = {}) => [
  o.journal ?? 'AC', 'Achats', o.num ?? 'AC00001', o.date ?? '20260105', o.compte ?? '606100', 'Compte de Mme Dupont',
  o.aux ?? '', o.aux ? 'Mme Dupont' : '', o.ref ?? '20260105-0a1b2c3d', '20260105', o.lib ?? 'Fournitures — été', o.debit ?? '100,00',
  o.credit ?? '0,00', o.let ?? '', '', '20260105', '', o.devise ?? '',
].join('\t')
const fec = (...lignes: string[]) => [ENTETE.join('\t'), ...lignes].join('\r\n')
const DEUX = fec(ligne(), ligne({ compte: '512000', debit: '0,00', credit: '100,00' }))
const enregistrements = (texte: string) => texte.replace(/\r\n$/, '').split('\r\n')

describe('le drapeau', () => {
  it('est BAISSÉ : aucun essai d’import réel dans un logiciel Cegid ne l’a encore éprouvé', () => {
    expect(PROFIL_TRA_OFFERT).toBe(false)
  })
})

describe('les enregistrements de la description v11', () => {
  it('leurs zones se suivent sans trou ni chevauchement, aux longueurs dites', () => {
    const longueurs: [ZonesQuelconques, number][] = [
      [ZONES_DE_L_EN_TETE, LONGUEUR_DE_L_EN_TETE], [ZONES_DU_JOURNAL, LONGUEUR_DU_JOURNAL],
      [ZONES_DE_L_ECRITURE, LONGUEUR_DE_L_ECRITURE], [ZONES_DU_DOCUMENT, LONGUEUR_DU_DOCUMENT],
    ]
    for (const [zones, longueur] of longueurs) {
      let attendue = 1
      for (const [position, l] of Object.values(zones)) {
        expect(position).toBe(attendue)
        attendue = position + l
      }
      expect(attendue - 1).toBe(longueur)
      expect(enregistrementTra(zones, {})).toHaveLength(longueur)
    }
  })

  it('l’écriture et le document GED ont les positions des versions 010 et 7 (LD Système, Logilys)', () => {
    // Relevées dans les deux descriptions plus anciennes : les mêmes débuts, de JOURNAL à NUMECHE, et du document en 84.
    const debuts = [1, 4, 12, 14, 31, 32, 49, 84, 119, 122, 130, 131, 151, 152, 160, 163, 173, 176, 196, 216, 219, 221]
    expect(Object.values(ZONES_DE_L_ECRITURE).map(([p]) => p)).toEqual(debuts)
    expect(ZONES_DU_DOCUMENT.document).toEqual([84, 255])
    expect(ZONES_DE_L_EN_TETE.nouvelleAnalytique).toEqual([148, 1])
    expect(ZONES_DU_JOURNAL.compte).toEqual([54, 17])
  })

  it('une valeur plus longue que sa zone lève : elle se coupe ou se refuse avant, jamais ici', () => {
    expect(() => enregistrementTra(ZONES_DE_L_ECRITURE, { journal: 'ABCD' })).toThrow(/journal/)
  })

  it('le montant à virgule, aligné à droite sur vingt ; la date en JJMMAAAA ; un négatif ne se lit pas', () => {
    expect(montantTra('1234,56')).toEqual({ texte: '1234,56'.padStart(20, ' '), nul: false })
    expect(montantTra('0,00')).toEqual({ texte: '0,00'.padStart(20, ' '), nul: true })
    expect(montantTra('007,10')?.texte.trim()).toBe('7,10')
    for (const illisible of ['-12,00', '12.50', '12,5', '', '1 000,00', `${'9'.repeat(18)},00`]) expect(montantTra(illisible)).toBeNull()
    expect(dateTra('20261231')).toBe('31122026')
    expect(dateTra('2026-12-31')).toBeNull()
  })

  it('le justificatif garde la référence neutre de sa pièce, et rien d’autre ; le fichier finit en .TRA', () => {
    expect(nomDuJustificatifTra('20260105-0a1b2c3d', 'pdf')).toBe('20260105-0a1b2c3d.pdf')
    expect(nomDuJustificatifTra('Relevé du 05/01/2026', 'pdf')).toBeNull()
    expect(nomDuFichierTra('123456789FEC20261231.txt')).toBe('123456789TRA20261231.TRA')
    expect(nomDeLArchiveTra('123456789FEC20261231.txt')).toBe('123456789TRA20261231.zip')
  })
})

describe('le FEC fictif mis en forme en TRA', () => {
  let fictif: FecFictif
  beforeAll(() => { fictif = composerLeFecFictif({ sansReglement: 'vides' }) })

  it('l’en-tête, un JAL par journal, puis une écriture de 222 par ligne du FEC, qui redit chacune sa ligne', () => {
    const codes = journauxDuFec(fictif.vingtDeux)
    const journaux = Object.fromEntries(codes.map((j, k) => [j.code, journal({ code: `J${k}`, libelle: `Journal ${k}`, nature: 'OD', typeDePiece: 'OD' })]))
    const r = mettreEnFormePourTra(fictif.vingtDeux, reglages({ journaux }), SANS)
    if (!r.ok) throw new Error(r.refus.join(' '))
    expect(decoder.decode(r.octets)).toBe(r.texte)
    const source = fictif.vingtDeux.split('\r\n').slice(1).filter((l) => l !== '').map((l) => l.split('\t'))
    const sortie = enregistrements(r.texte)
    expect(sortie).toHaveLength(1 + codes.length + source.length)
    const [enTete, ...reste] = sortie
    expect(enTete).toBe('***S5CLIJRLSTD   0101190001011900011' + ' '.repeat(100) + '01011900001X-' + ' '.repeat(16))
    const jal = reste.slice(0, codes.length)
    jal.forEach((j, k) => {
      expect(j).toHaveLength(517)
      expect(j.slice(0, 47)).toBe(`***JALJ${k} ${`Journal ${k}`.padEnd(35, ' ')}OD `)
      expect(j.slice(47).trim()).toBe('')
    })
    const lignes = reste.slice(codes.length)
    expect(r.lignes).toBe(source.length)
    expect(r.ecritures).toBe(new Set(source.map((c) => c[2])).size)
    lignes.forEach((m, k) => {
      const c = source[k]
      expect(m).toHaveLength(222)
      expect(ecr(m, 'journal')).toBe(`J${codes.findIndex((j) => j.code === c[0])} `)
      expect(ecr(m, 'date')).toBe(`${c[3].slice(6, 8)}${c[3].slice(4, 6)}${c[3].slice(0, 4)}`)
      expect(ecr(m, 'typePiece')).toBe('OD')
      expect(ecr(m, 'general')).toBe(c[4].padEnd(8, '0').padEnd(17, ' '))
      expect(ecr(m, 'typeCompte')).toBe(' ')
      expect(ecr(m, 'auxiliaire')).toBe(' '.repeat(17))
      expect(ecr(m, 'refInterne').trimEnd()).toBe([...c[8]].slice(0, 35).join('').trimEnd())
      expect(ecr(m, 'libelle').trimEnd()).toBe([...c[10]].slice(0, 35).join('').trimEnd())
      const debit = c[11] !== '0,00'
      expect(ecr(m, 'sens')).toBe(debit ? 'D' : 'C')
      expect(ecr(m, 'montant1')).toBe((debit ? c[11] : c[12]).padStart(20, ' '))
      expect(ecr(m, 'typeEcriture')).toBe('N')
      expect(ecr(m, 'numeroPiece')).toBe(' '.repeat(8))
      expect(ecr(m, 'devise')).toBe('   ')
      expect(ecr(m, 'codeMontant')).toBe('E--')
      expect(m.slice(175)).toBe(' '.repeat(47))
    })
    // Ni le libellé d'un compte ni celui d'un tiers : rien de plus que les libellés d'écriture et les pièces du FEC.
    for (const c of source) if (c[5] && !source.some((d) => d[10].includes(c[5]) || d[8].includes(c[5]))) expect(r.texte).not.toContain(c[5])
  })

  it('le FEC lu n’est pas touché : la mise en forme le relit, et le relit de même deux fois', () => {
    const avant = fictif.vingtDeux
    const journaux = Object.fromEntries(journauxDuFec(avant).map((j) => [j.code, journal({ code: j.code, nature: 'OD', typeDePiece: 'OD' })]))
    const a = mettreEnFormePourTra(avant, reglages({ journaux }), SANS)
    const b = mettreEnFormePourTra(avant, reglages({ journaux }), SANS)
    expect(fictif.vingtDeux).toBe(avant)
    expect(a.ok && b.ok && a.texte === b.texte).toBe(true)
  })
})

describe('les réglages, sans défaut', () => {
  it('rien de dit : chaque réglage et chaque zone du journal sont à saisir, et rien ne part', () => {
    const r = mettreEnFormePourTra(DEUX, {
      encodage: null, finDEnregistrement: null, longueurDesComptes: null, produit: null, origine: null, nouvelleAnalytique: null,
      numeroDePiece: null, journaux: {}, sansANouveaux: false, cheminDesJustificatifs: null,
    }, { avecJustificatifs: true })
    expect(r).toEqual({
      ok: false, refus: [
        'L’encodage du fichier : à saisir.', 'La fin d’enregistrement : à saisir.', 'La longueur des comptes dans le dossier Cegid : à saisir.',
        'Le produit qui génère le fichier (en-tête, position 4) : à saisir.', 'L’origine du fichier, CLI ou EXP (en-tête, position 6) : à saisir.',
        'La gestion de l’analytique du dossier, X ou - (en-tête, position 148) : à saisir.', 'Le numéro de pièce des écritures : à saisir.',
        'Le chemin des justificatifs dans le fichier : à saisir.',
        'Le journal AC (Achats) : son code dans le dossier Cegid, à saisir.', 'Le journal AC (Achats) : son libellé dans le dossier Cegid, à saisir.',
        'Le journal AC (Achats) : sa nature dans le dossier Cegid, à saisir.',
        'Le journal AC (Achats) : la nature du mouvement de ses écritures (TYPE PIECE), à saisir.',
      ],
    })
    expect(JOURNAL_TRA_A_SAISIR).toEqual({ code: '', libelle: '', nature: null, typeDePiece: null, contrepartie: '' })
  })

  it('un code de quatre caractères, deux journaux sous un même code, une nature BQE sans contrepartie, une nature analytique, une longueur hors de 6 à 17', () => {
    const r = mettreEnFormePourTra(fec(ligne(), ligne({ journal: 'BQ', num: 'BQ00001' }), ligne({ journal: 'OD', num: 'OD00001' })), reglages({
      longueurDesComptes: 18,
      journaux: { AC: journal({ code: 'ACHA' }), BQ: journal({ code: 'OD', nature: 'BQE' }), OD: journal({ code: 'OD', nature: 'ODA' }) },
    }), SANS)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.refus).toEqual([
      'La longueur des comptes va de 6 à 17 caractères.',
      'Le journal AC (Achats) : son code tient en une à trois lettres ou chiffres (« ACHA »).',
      'Le journal BQ (Achats) : une nature BQE demande son compte de contrepartie, à saisir.',
      'Le journal OD (Achats) : le code « OD » est déjà celui du journal BQ.',
      'Le journal OD (Achats) : la nature ODA demande un axe analytique, que ce fichier n’écrit pas.',
    ])
  })

  it('le journal : sa contrepartie complétée à la longueur, « - » en mode de saisie d’un journal ANO, ses autres zones à blanc', () => {
    const r = mettreEnFormePourTra(fec(ligne({ journal: 'BQ', num: 'BQ00001' }), ligne({ journal: 'AN', num: 'AN00001', compte: '512000', debit: '0,00', credit: '100,00' })),
      reglages(), SANS)
    if (!r.ok) throw new Error(r.refus.join(' '))
    const [, bq, an] = enregistrements(r.texte)
    expect(zone(ZONES_DU_JOURNAL, bq, 'compte')).toBe('51200000'.padEnd(17, ' '))
    expect(zone(ZONES_DU_JOURNAL, bq, 'modeSaisie')).toBe('   ')
    expect(zone(ZONES_DU_JOURNAL, an, 'nature')).toBe('ANO')
    expect(zone(ZONES_DU_JOURNAL, an, 'modeSaisie')).toBe('-  ')
    expect(zone(ZONES_DU_JOURNAL, an, 'compte')).toBe(' '.repeat(17))
  })

  it('l’encodage choisi : Windows-1252 écrit « é » et « — » en un octet ; l’ASCII strict les refuse, nommés par leur ligne', () => {
    const w = mettreEnFormePourTra(DEUX, reglages(), SANS)
    if (!w.ok) throw new Error(w.refus.join(' '))
    expect([...w.octets]).toContain(0x97)
    expect([...w.octets]).toContain(0xe9)
    expect(w.octets.length).toBe(165 + 2 + 517 + 2 + 2 * (222 + 2))
    const a = mettreEnFormePourTra(DEUX, reglages({ encodage: 'ascii', journaux: { AC: journal({ libelle: 'Achats été' }) } }), SANS)
    expect(a.ok).toBe(false)
    if (!a.ok) {
      expect(a.refus).toEqual([
        'Le journal AC, son libellé : le caractère « é » (U+00E9) n’existe pas en ASCII strict — corrige-le dans l’application.',
        'Ligne 1 des écritures (écriture AC00001), son libellé : le caractère « — » (U+2014) n’existe pas en ASCII strict — corrige-le dans l’application.',
        'Ligne 2 des écritures (écriture AC00001), son libellé : le caractère « — » (U+2014) n’existe pas en ASCII strict — corrige-le dans l’application.',
      ])
    }
    const ascii = mettreEnFormePourTra(DEUX.replaceAll('Fournitures — été', 'Fournitures'), reglages({ encodage: 'ascii' }), SANS)
    expect(ascii.ok && ascii.octets.every((o) => o < 0x80)).toBe(true)
  })

  it('la fin d’enregistrement choisie : CR LF, LF ou CR seul, après chaque enregistrement, le dernier compris', () => {
    for (const [fin, separateur] of [['crlf', '\r\n'], ['lf', '\n'], ['cr', '\r']] as const) {
      const r = mettreEnFormePourTra(DEUX, reglages({ finDEnregistrement: fin }), SANS)
      if (!r.ok) throw new Error(r.refus.join(' '))
      expect(r.texte.endsWith(separateur)).toBe(true)
      expect(r.texte.split(separateur)).toHaveLength(5)
      if (fin !== 'crlf') expect(r.texte).not.toContain(fin === 'lf' ? '\r' : '\n')
    }
  })

  it('le numéro de pièce continu : huit chiffres, le même pour les lignes d’une écriture ; sans les à-nouveaux, leurs lignes ne partent pas', () => {
    const avecAn = fec(ligne({ journal: 'AN', num: 'AN00001', compte: '512000' }), ligne({ journal: 'AN', num: 'AN00001', compte: '101000', debit: '0,00', credit: '100,00' }),
      ...DEUX.split('\r\n').slice(1), ligne({ num: 'AC00002' }), ligne({ num: 'AC00002', compte: '512000', debit: '0,00', credit: '100,00' }))
    const r = mettreEnFormePourTra(avecAn, reglages({ numeroDePiece: 'continu', sansANouveaux: true, journaux: { AC: journal() } }), SANS)
    if (!r.ok) throw new Error(r.refus.join(' '))
    const ecritures = enregistrements(r.texte).slice(2)
    expect(ecritures.map((m) => ecr(m, 'numeroPiece'))).toEqual(['00000001', '00000001', '00000002', '00000002'])
    expect(r.journaux.map((j) => j.nous)).toEqual(['AC'])
  })
})

describe('les refus avant tout fichier', () => {
  it('un compte trop long, un débit ET un crédit, une ligne à zéro, une devise, un montant illisible, un montant négatif', () => {
    const r = mettreEnFormePourTra(fec(
      ligne({ compte: '6061000' }),
      ligne({ debit: '10,00', credit: '10,00' }),
      ligne({ debit: '0,00', credit: '0,00' }),
      ligne({ devise: 'USD' }),
      ligne({ debit: '12.00' }),
      ligne({ debit: '-25,10' }),
    ), reglages({ longueurDesComptes: 6 }), SANS)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.refus).toEqual([
      'Ligne 1 des écritures (écriture AC00001) : le compte 6061000 a 7 caractères, plus que la longueur choisie (6) — il ne se tronque pas.',
      'Ligne 2 des écritures (écriture AC00001) : la ligne porte un débit ET un crédit — le sens ne se devine pas.',
      'Ligne 3 des écritures (écriture AC00001) : la ligne est à zéro — le sens ne se devine pas.',
      'Ligne 4 des écritures (écriture AC00001) : un montant en devise (USD) — ce profil n’écrit que l’euro.',
      'Ligne 5 des écritures (écriture AC00001) : un montant ne se lit pas, ou passe vingt caractères.',
      'Ligne 6 des écritures (écriture AC00001) : un montant négatif — la description du TRA ne dit pas comment s’écrit son signe.',
    ])
  })

  it('une pièce de trente-cinq caractères, intacte, que la coupe d’une autre rendrait égale : refusée aussi (28/11/2026)', () => {
    const trenteCinq = 'Compte personnel de l’exploitant du'
    expect([...trenteCinq]).toHaveLength(35)
    for (const ordre of [[trenteCinq, `${trenteCinq} 31/12/2025`], [`${trenteCinq} 31/12/2025`, trenteCinq]]) {
      const r = mettreEnFormePourTra(fec(ligne({ ref: ordre[0] }), ligne({ num: 'AC00002', ref: ordre[1] })), reglages(), SANS)
      expect(r.ok, ordre.join(' / ')).toBe(false)
      if (!r.ok) expect(r.refus).toEqual([expect.stringMatching(/coupées à trente-cinq caractères, les pièces/)])
    }
  })

  it('deux comptes distincts que le bourrage de zéros rendrait égaux : refusés, nommés (28/11/2026)', () => {
    const r = mettreEnFormePourTra(fec(ligne({ compte: '6064' }), ligne({ compte: '606400', num: 'AC00002' }),
      ligne({ compte: '512000', debit: '0,00', credit: '200,00' })), reglages(), SANS)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.refus).toEqual([expect.stringMatching(/^Les comptes 6064 et 606400 du FEC deviendraient tous deux 60640000/)])
  })

  it('deux pièces que la coupe à trente-cinq confondrait se refusent ; un libellé long se coupe et se compte, sans auxiliaire ni lettrage', () => {
    const longue = 'Compte personnel de l’exploitant du 31/12/2025'
    const r = mettreEnFormePourTra(fec(ligne({ ref: longue }), ligne({ num: 'AC00002', ref: longue.replace('31/12', '30/12') })), reglages(), SANS)
    expect(r.ok).toBe(false)
    const seul = mettreEnFormePourTra(fec(ligne({ ref: longue, lib: 'Un libellé de bien plus de trente-cinq caractères', aux: 'FDUPONT', let: 'AA' })), reglages(), SANS)
    if (!seul.ok) throw new Error(seul.refus.join(' '))
    expect(seul).toMatchObject({ libellesCoupes: 1, piecesCoupees: 1, auxiliairesNonRepris: 1, lettragesNonRepris: 1 })
    const m = enregistrements(seul.texte)[2]
    expect(ecr(m, 'refInterne')).toBe([...longue].slice(0, 35).join(''))
    expect(ecr(m, 'libelle')).toBe('Un libellé de bien plus de trente-c')
    expect(seul.texte).not.toContain('Dupont')
    expect(seul.texte).not.toContain('FDUPONT')
  })
})

describe('les justificatifs', () => {
  const JOINTS = new Map([['20260105-0a1b2c3d', '20260105-0a1b2c3d.pdf']])

  it('cochés, le chemin se demande ; un dossier sans séparateur final se refuse', () => {
    const sansChemin = mettreEnFormePourTra(DEUX, reglages(), { avecJustificatifs: true })
    expect(sansChemin).toEqual({ ok: false, refus: ['Le chemin des justificatifs dans le fichier : à saisir.'] })
    const sansSeparateur = mettreEnFormePourTra(DEUX, reglages({ cheminDesJustificatifs: { mode: 'dossier', dossier: 'C:\\Import' } }), { avecJustificatifs: true })
    expect(sansSeparateur).toEqual({ ok: false, refus: ['Le dossier des justificatifs se termine par son séparateur, « \\ » ou « / ».'] })
  })

  it('un enregistrement G après la DERNIÈRE ligne de l’écriture, sous son journal, sa date, sa nature, le compte et la pièce de sa première ligne', () => {
    const deuxEcritures = fec(ligne(), ligne({ compte: '512000', debit: '0,00', credit: '100,00' }),
      ligne({ num: 'AC00002', ref: '20260106-eeeeeeee' }), ligne({ num: 'AC00002', ref: '20260106-eeeeeeee', compte: '512000', debit: '0,00', credit: '100,00' }))
    const r = mettreEnFormePourTra(deuxEcritures, reglages({ cheminDesJustificatifs: { mode: 'dossier', dossier: 'C:\\Import\\' } }),
      { avecJustificatifs: true, joints: JOINTS })
    if (!r.ok) throw new Error(r.refus.join(' '))
    const sortie = enregistrements(r.texte)
    expect(sortie.map((m) => m.length)).toEqual([165, 517, 222, 222, 338, 222, 222])
    const g = sortie[4]
    expect(g.slice(0, 83)).toBe(`HA 05012026FF${'60610000'.padEnd(17, ' ')}G${' '.repeat(17)}${'20260105-0a1b2c3d'.padEnd(35, ' ')}`)
    expect(zone(ZONES_DU_DOCUMENT, g, 'document').trimEnd()).toBe('C:\\Import\\20260105-0a1b2c3d.pdf')
    expect(r.justificatifsNommes).toBe(1)
  })

  it('le nom seul ; et sans la case, aucun G même si des noms sont donnés', () => {
    const r = mettreEnFormePourTra(DEUX, reglages({ cheminDesJustificatifs: { mode: 'nom_seul' } }), { avecJustificatifs: true, joints: JOINTS })
    if (!r.ok) throw new Error(r.refus.join(' '))
    expect(zone(ZONES_DU_DOCUMENT, enregistrements(r.texte)[4], 'document').trimEnd()).toBe('20260105-0a1b2c3d.pdf')
    const sans = mettreEnFormePourTra(DEUX, reglages(), { avecJustificatifs: false, joints: JOINTS })
    expect(sans.ok && enregistrements(sans.texte).length === 4 && sans.justificatifsNommes === 0).toBe(true)
  })
})
