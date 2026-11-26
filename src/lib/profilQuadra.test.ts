import { beforeAll, describe, expect, it } from 'vitest'
import { composerLeFecFictif, type FecFictif } from '../test/fecFictif'
import { ecriture } from '../test/revision'
import type { LigneFec, NumerotationFec } from './fec'
import { journauxDuFec } from './profilsDExport'
import {
  dateQuadra, enregistrementM, justificatifsDeLExportQuadra, LONGUEUR_DE_L_ENREGISTREMENT_M, mettreEnFormePourQuadra, montantQuadra,
  nomDuFichierQuadra, nomDuJustificatifQuadra, PROFIL_QUADRA_OFFERT, ZONES_DE_L_ENREGISTREMENT_M, type ReglagesQuadra,
} from './profilQuadra'

// LE PROFIL « CEGID QUADRA » (EXP3). Ce que ces cas gardent : les zones de l'enregistrement `M` aux positions de la fiche
// publique de Cegid (KB0014530), contiguës, sans chevauchement ; le FEC fictif (src/test/fecFictif.ts) relu zone par zone —
// le compte complété, le journal en 10 et en 111, le folio, la date JJMMAA, le sens et le montant en centimes signés égaux au
// débit ou au crédit du FEC, l'euro, le libellé et la pièce coupés à leur largeur, rien d'autre — ; l'encodage et la fin
// d'enregistrement choisis, jamais préchoisis ; chaque refus avant tout fichier ; le justificatif nommé 8+3.

const decoder = new TextDecoder('windows-1252')
const zone = (ligne: string, nom: keyof typeof ZONES_DE_L_ENREGISTREMENT_M) => {
  const [position, longueur] = ZONES_DE_L_ENREGISTREMENT_M[nom]
  return ligne.slice(position - 1, position - 1 + longueur)
}

const JOURNAUX = { AC: 'HA', VE: 'VT', BQ: 'B1', OD: 'OD', AN: 'AN' }
const reglages = (o: Partial<ReglagesQuadra> = {}): ReglagesQuadra => ({
  encodage: 'windows-1252', finDEnregistrement: 'crlf', longueurDesComptes: 8, journaux: JOURNAUX, sansANouveaux: false, ...o,
})

const ENTETE = ['JournalCode', 'JournalLib', 'EcritureNum', 'EcritureDate', 'CompteNum', 'CompteLib', 'CompAuxNum', 'CompAuxLib',
  'PieceRef', 'PieceDate', 'EcritureLib', 'Debit', 'Credit', 'EcritureLet', 'DateLet', 'ValidDate', 'Montantdevise', 'Idevise']
const ligne = (o: Partial<Record<'journal' | 'num' | 'date' | 'compte' | 'compteLib' | 'aux' | 'ref' | 'lib' | 'debit' | 'credit' | 'let' | 'devise', string>> = {}) => [
  o.journal ?? 'AC', 'Achats', o.num ?? 'AC00001', o.date ?? '20260105', o.compte ?? '606100', o.compteLib ?? 'Compte de Mme Dupont',
  o.aux ?? '', o.aux ? 'Mme Dupont' : '', o.ref ?? '20260105-0a1b2c3d', '20260105', o.lib ?? 'Fournitures — été', o.debit ?? '100,00',
  o.credit ?? '0,00', o.let ?? '', '', '20260105', '', o.devise ?? '',
].join('\t')
const fec = (...lignes: string[]) => [ENTETE.join('\t'), ...lignes].join('\r\n')
const DEUX = fec(ligne(), ligne({ compte: '512000', debit: '0,00', credit: '100,00' }))

describe('le drapeau', () => {
  it('est BAISSÉ : aucun essai d’import réel chez un expert-comptable qui a Quadra ne l’a encore éprouvé', () => {
    expect(PROFIL_QUADRA_OFFERT).toBe(false)
  })
})

describe('l’enregistrement M de la fiche KB0014530', () => {
  it('ses zones se suivent sans trou ni chevauchement, de la position 1 à la 251', () => {
    let attendue = 1
    for (const [position, longueur] of Object.values(ZONES_DE_L_ENREGISTREMENT_M)) {
      expect(position).toBe(attendue)
      attendue = position + longueur
    }
    expect(LONGUEUR_DE_L_ENREGISTREMENT_M).toBe(251)
    expect(ZONES_DE_L_ENREGISTREMENT_M.pieceJointe).toEqual([182, 12])
    expect(ZONES_DE_L_ENREGISTREMENT_M.journal3).toEqual([111, 3])
    expect(enregistrementM({ type: 'M' })).toHaveLength(251)
  })

  it('une valeur plus longue que sa zone lève : elle se coupe ou se refuse avant, jamais ici', () => {
    expect(() => enregistrementM({ journal2: 'ABC' })).toThrow(/journal2/)
  })

  it('le montant en centimes, signé en tête, sur douze chiffres ; la date en JJMMAA', () => {
    expect(montantQuadra('1234,56')).toEqual({ signe: '+', chiffres: '000000123456', nul: false })
    expect(montantQuadra('-12,00')).toEqual({ signe: '-', chiffres: '000000001200', nul: false })
    expect(montantQuadra('-0,00')).toEqual({ signe: '+', chiffres: '000000000000', nul: true })
    expect(montantQuadra('9999999999,99')?.chiffres).toBe('999999999999')
    for (const illisible of ['10000000000,00', '12.50', '12,5', '', '1 000,00']) expect(montantQuadra(illisible)).toBeNull()
    expect(dateQuadra('20261231')).toBe('311226')
    expect(dateQuadra('2026-12-31')).toBeNull()
  })

  it('le justificatif en 8+3 : l’empreinte courte de la référence neutre, et rien d’autre', () => {
    expect(nomDuJustificatifQuadra('20260105-0a1b2c3d', 'pdf')).toBe('0a1b2c3d.pdf')
    expect(nomDuJustificatifQuadra('Relevé du 05/01/2026', 'pdf')).toBeNull()
    expect(nomDuJustificatifQuadra('20260105-0a1b2c3d', 'jpeg')).toBeNull()
    expect(nomDuFichierQuadra('123456789FEC20261231.txt')).toBe('123456789ASCII20261231.txt')
  })
})

describe('le FEC fictif mis en forme pour Quadra', () => {
  let fictif: FecFictif
  beforeAll(() => { fictif = composerLeFecFictif({ sansReglement: 'vides' }) })

  it('chaque ligne du FEC devient un M de 251 caractères qui redit son compte, sa date, son sens, son montant, sa pièce', () => {
    const journaux = Object.fromEntries(journauxDuFec(fictif.vingtDeux).map((j) => [j.code, j.code]))
    const r = mettreEnFormePourQuadra(fictif.vingtDeux, reglages({ journaux }))
    if (!r.ok) throw new Error(r.refus.join(' '))
    expect(decoder.decode(r.octets)).toBe(r.texte)
    const source = fictif.vingtDeux.split('\r\n').slice(1).filter((l) => l !== '').map((l) => l.split('\t'))
    const sortie = r.texte.replace(/\r\n$/, '').split('\r\n')
    expect(sortie).toHaveLength(source.length)
    expect(r.lignes).toBe(source.length)
    expect(r.ecritures).toBe(new Set(source.map((c) => c[2])).size)
    sortie.forEach((m, k) => {
      const c = source[k]
      expect(m).toHaveLength(251)
      expect(zone(m, 'type')).toBe('M')
      expect(zone(m, 'compte')).toBe(c[4].padEnd(8, '0'))
      expect(zone(m, 'journal2')).toBe(c[0])
      expect(zone(m, 'journal3')).toBe(`${c[0]} `)
      expect(zone(m, 'folio')).toBe('000')
      expect(zone(m, 'date')).toBe(`${c[3].slice(6, 8)}${c[3].slice(4, 6)}${c[3].slice(2, 4)}`)
      const debit = c[11] !== '0,00'
      expect(zone(m, 'sens')).toBe(debit ? 'D' : 'C')
      expect(zone(m, 'montant')).toBe(`+${(debit ? c[11] : c[12]).replace(',', '').padStart(12, '0')}`)
      expect(zone(m, 'devise')).toBe('EUR')
      expect(zone(m, 'libelle').trimEnd()).toBe([...c[10]].slice(0, 30).join('').trimEnd())
      expect(zone(m, 'libelleLibre')).toBe(' '.repeat(20))
      expect(zone(m, 'piece').trimEnd()).toBe([...c[8]].slice(0, 20).join('').trimEnd())
      expect(zone(m, 'pieceJointe')).toBe(' '.repeat(12))
    })
    // Ni le libellé d'un compte ni celui d'un tiers : rien de plus que les libellés d'écriture et les pièces du FEC.
    for (const c of source) if (c[5] && !source.some((d) => d[10].includes(c[5]) || d[8].includes(c[5]))) expect(r.texte).not.toContain(c[5])
  })

  it('le FEC lu n’est pas touché : la mise en forme le relit, et le relit de même deux fois', () => {
    const avant = fictif.vingtDeux
    const journaux = Object.fromEntries(journauxDuFec(avant).map((j) => [j.code, j.code]))
    const a = mettreEnFormePourQuadra(avant, reglages({ journaux }))
    const b = mettreEnFormePourQuadra(avant, reglages({ journaux }))
    expect(fictif.vingtDeux).toBe(avant)
    expect(a.ok && b.ok && a.texte === b.texte).toBe(true)
  })
})

describe('les réglages, sans défaut', () => {
  it('rien de dit : l’encodage, la fin d’enregistrement, la longueur et chaque journal sont à saisir, et rien ne part', () => {
    const r = mettreEnFormePourQuadra(DEUX, { encodage: null, finDEnregistrement: null, longueurDesComptes: null, journaux: {}, sansANouveaux: false })
    expect(r).toEqual({
      ok: false, refus: [
        'L’encodage du fichier : à saisir.', 'La fin d’enregistrement : à saisir.',
        'La longueur des comptes dans le dossier Quadra : à saisir.', 'Le code du journal AC (Achats) dans le dossier Quadra : à saisir.',
      ],
    })
  })

  it('un code de journal de trois caractères ne tient pas en position 10 : refusé, pas coupé ; une longueur hors de 6 à 8 aussi', () => {
    const r = mettreEnFormePourQuadra(DEUX, reglages({ journaux: { AC: 'ACH' }, longueurDesComptes: 9 }))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.refus.join(' ')).toMatch(/de 6 à 8 caractères/)
    expect(r.refus).toContain('Le code du journal qui remplace « AC » tient en une ou deux lettres ou chiffres (« ACH »).')
  })

  it('l’encodage choisi : Windows-1252 écrit « é » et « — » en un octet ; l’ASCII strict les refuse, nommés par leur ligne', () => {
    const w = mettreEnFormePourQuadra(DEUX, reglages())
    if (!w.ok) throw new Error(w.refus.join(' '))
    expect([...w.octets]).toContain(0x97)
    expect([...w.octets]).toContain(0xe9)
    expect(w.octets.length).toBe(2 * (251 + 2))
    const a = mettreEnFormePourQuadra(DEUX, reglages({ encodage: 'ascii' }))
    expect(a.ok).toBe(false)
    if (!a.ok) expect(a.refus[0]).toBe('Ligne 1 du fichier (écriture AC00001), son libellé : le caractère « — » (U+2014) n’existe pas en ASCII strict — corrige-le dans l’application.')
    const ascii = mettreEnFormePourQuadra(DEUX.replaceAll('Fournitures — été', 'Fournitures'), reglages({ encodage: 'ascii' }))
    expect(ascii.ok && ascii.octets.every((o) => o < 0x80)).toBe(true)
  })

  it('la fin d’enregistrement choisie : CR LF, ou CR seul, après chaque M, le dernier compris', () => {
    const cr = mettreEnFormePourQuadra(DEUX, reglages({ finDEnregistrement: 'cr' }))
    if (!cr.ok) throw new Error(cr.refus.join(' '))
    expect(cr.texte).not.toContain('\n')
    expect(cr.texte.split('\r')).toHaveLength(3)
    const crlf = mettreEnFormePourQuadra(DEUX, reglages())
    expect(crlf.ok && crlf.texte.endsWith('\r\n') && crlf.texte.split('\r\n').length === 3).toBe(true)
  })

  it('sans les à-nouveaux : leurs lignes ne partent pas, et leur journal n’est pas à saisir', () => {
    const avecAn = fec(ligne({ journal: 'AN', num: 'AN00001', compte: '512000' }), ligne({ journal: 'AN', num: 'AN00001', compte: '101000', debit: '0,00', credit: '100,00' }), ...DEUX.split('\r\n').slice(1))
    const r = mettreEnFormePourQuadra(avecAn, reglages({ journaux: { AC: 'HA' }, sansANouveaux: true }))
    if (!r.ok) throw new Error(r.refus.join(' '))
    expect(r.lignes).toBe(2)
    expect(r.journaux.map((j) => j.nous)).toEqual(['AC'])
  })
})

describe('les refus avant tout fichier', () => {
  it('un compte plus long que la longueur dite, un débit ET un crédit, une ligne à zéro, une devise, un montant illisible', () => {
    const r = mettreEnFormePourQuadra(fec(
      ligne({ compte: '6061000' }),
      ligne({ debit: '10,00', credit: '10,00' }),
      ligne({ debit: '0,00', credit: '0,00' }),
      ligne({ devise: 'USD' }),
      ligne({ debit: '12.00' }),
    ), reglages({ longueurDesComptes: 6 }))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.refus).toEqual([
      'Ligne 1 du fichier (écriture AC00001) : le compte 6061000 a 7 caractères, plus que la longueur choisie (6) — il ne se tronque pas.',
      'Ligne 2 du fichier (écriture AC00001) : la ligne porte un débit ET un crédit — le sens ne se devine pas.',
      'Ligne 3 du fichier (écriture AC00001) : la ligne est à zéro — le sens ne se devine pas.',
      'Ligne 4 du fichier (écriture AC00001) : un montant en devise (USD) — ce profil n’écrit que l’euro.',
      'Ligne 5 du fichier (écriture AC00001) : un montant ne se lit pas, ou passe douze chiffres en centimes.',
    ])
  })

  it('un montant négatif du FEC garde son signe ; le compte de six chiffres se complète à la longueur dite, puis de blancs', () => {
    const r = mettreEnFormePourQuadra(fec(ligne({ debit: '-25,10' })), reglages({ longueurDesComptes: 6 }))
    if (!r.ok) throw new Error(r.refus.join(' '))
    expect(zone(r.texte, 'montant')).toBe('-000000002510')
    expect(zone(r.texte, 'compte')).toBe('606100  ')
  })

  it('deux numéros de pièce que la coupe à vingt confondrait se refusent ; un libellé long se coupe et se compte', () => {
    const r = mettreEnFormePourQuadra(fec(
      ligne({ ref: 'Compte personnel du 31/12/2025', lib: 'Un libellé de bien plus de trente caractères' }),
      ligne({ num: 'AC00002', ref: 'Compte personnel du 30/12/2025' }),
    ), reglages())
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.refus).toEqual(['Ligne 2 du fichier (écriture AC00002) : coupés à vingt caractères, les numéros de pièce « Compte personnel du 31/12/2025 » et « Compte personnel du 30/12/2025 » se confondraient.'])
    const seul = mettreEnFormePourQuadra(fec(ligne({ ref: 'Compte personnel du 31/12/2025', lib: 'Un libellé de bien plus de trente caractères', aux: 'FDUPONT', let: 'AA' })), reglages())
    if (!seul.ok) throw new Error(seul.refus.join(' '))
    expect(seul).toMatchObject({ libellesCoupes: 1, piecesCoupees: 1, auxiliairesNonRepris: 1, lettragesNonRepris: 1 })
    expect(zone(seul.texte, 'piece')).toBe('Compte personnel du ')
    expect(zone(seul.texte, 'libelle')).toBe('Un libellé de bien plus de tre')
    expect(seul.texte).not.toContain('Dupont')
    expect(seul.texte).not.toContain('FDUPONT')
  })
})

describe('les justificatifs', () => {
  const ligneFec = (numero: number, pieceId: string, pieceRef: string): LigneFec => ({
    ecriture: ecriture({ id: `e${numero}-${pieceId}`, piece_id: pieceId }), journal: 'AC', numero, pieceRef, pieceDate: '2026-01-05',
    compteLib: 'Compte', compAuxNum: null, compAuxLib: null, validDate: '2026-01-05', champsBnc: null,
  })

  it('le nom 8+3 s’écrit en 182 sur la PREMIÈRE ligne de l’écriture seulement', () => {
    const r = mettreEnFormePourQuadra(DEUX, reglages(), new Map([['20260105-0a1b2c3d', '0a1b2c3d.pdf']]))
    if (!r.ok) throw new Error(r.refus.join(' '))
    const [premiere, seconde] = r.texte.split('\r\n')
    expect(zone(premiere, 'pieceJointe')).toBe('0a1b2c3d.pdf')
    expect(zone(seconde, 'pieceJointe')).toBe(' '.repeat(12))
    expect(r.justificatifsNommes).toBe(1)
  })

  it('deux pièces de même empreinte courte : un seul fichier part, l’autre se dit écartée, son écriture comptée sans justificatif', () => {
    const numerotation: NumerotationFec = {
      aNouveaux: [], champsBnc: 'non_calcules', horsFec: [],
      lignes: [ligneFec(1, 'p1', '20260105-0a1b2c3d'), ligneFec(2, 'p2', '20260106-0a1b2c3d')],
    }
    const pieces = [{ id: 'p1', storage_path: 'd1/a.pdf' }, { id: 'p2', storage_path: 'd1/b.pdf' }]
    const j = justificatifsDeLExportQuadra('d1', numerotation, pieces, new Map([['AC00001', 1], ['AC00002', 2]]))
    expect(j.aJoindre.map((x) => x.reference)).toEqual(['20260105-0a1b2c3d'])
    expect(j.ecartes).toEqual(['La pièce 20260106-0a1b2c3d a la même empreinte courte que 20260105-0a1b2c3d : un seul fichier « 0a1b2c3d » part, le sien non.'])
    expect(j.ecrituresSansJustificatif).toBe(1)
  })
})
