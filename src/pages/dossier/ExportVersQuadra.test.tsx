import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LigneFec, NumerotationFec } from '../../lib/fec'
import { ecriture } from '../../test/revision'

// LE PROFIL CEGID QUADRA À L'ÉCRAN (EXP3), le drapeau `PROFIL_QUADRA_OFFERT` joué par un accesseur : baissé (le vrai), le
// choix du logiciel ne l'offre pas ; levé, sa section prend la place de celle d'ACD — tout « à saisir », aucune lecture ni
// aucun enregistrement de réglages (la base n'en garde que pour ACD), le verrou (deux clics, un fichier), le fichier à largeur
// fixe tel qu'il part, et l'archive dont le fichier NOMME le justificatif que l'archive porte. La mise en forme est gardée par
// lib/profilQuadra.test.ts.

const faux = vi.hoisted(() => ({
  fichiers: [] as { nom: string; blob: Blob }[],
  telechargements: 0,
  stockage: new Map<string, Uint8Array | null>(),
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    storage: {
      from: () => ({
        download: async (chemin: string) => {
          const o = faux.stockage.get(chemin)
          return o ? { data: new Blob([o as Uint8Array<ArrayBuffer>]), error: null } : { data: null, error: { status: 404 } }
        },
        list: async (repertoire: string) => ({
          data: [...faux.stockage].filter(([c, o]) => o !== null && c.startsWith(`${repertoire}/`))
            .map(([c, o]) => ({ name: c.slice(repertoire.length + 1), metadata: { size: o!.length } })),
          error: null,
        }),
      }),
    },
  },
}))

const drapeau = vi.hoisted(() => ({ leve: undefined as undefined | boolean }))
vi.mock('../../lib/profilQuadra', async (original) => {
  const vrai = await original<typeof import('../../lib/profilQuadra')>()
  return { ...vrai, get PROFIL_QUADRA_OFFERT() { return drapeau.leve ?? vrai.PROFIL_QUADRA_OFFERT } }
})
const reglagesDuDossier = vi.hoisted(() => ({ lus: [] as string[], enregistres: 0 }))
vi.mock('../../lib/reglagesDExportLecture', () => ({
  lireLesReglagesDExport: async (dossierId: string, logiciel: string) => {
    reglagesDuDossier.lus.push(logiciel)
    return { dossierId, logiciel, etat: 'lus', gardes: null }
  },
  enregistrerLesReglagesDExport: async () => { reglagesDuDossier.enregistres++; return { ok: true, version: 1 } },
}))

import ExportVersUnLogiciel from './ExportVersUnLogiciel'

const ENTETE = 'JournalCode\tJournalLib\tEcritureNum\tEcritureDate\tCompteNum\tCompteLib\tCompAuxNum\tCompAuxLib\tPieceRef\tPieceDate\t'
  + 'EcritureLib\tDebit\tCredit\tEcritureLet\tDateLet\tValidDate\tMontantdevise\tIdevise'
const ligne = (num: string, compte: string, ref: string, libelle: string, debit: string, credit: string) =>
  ['AC', 'Achats', num, '20260105', compte, 'Compte', '', '', ref, '20260105', libelle, debit, credit, '', '', '20260105', '', ''].join('\t')
const REF = '20260105-0a1b2c3d'
const FEC = [ENTETE,
  ligne('AC00001', '606100', REF, 'Fournitures — été', '100,00', '0,00'),
  ligne('AC00001', '512000', REF, 'Fournitures — été', '0,00', '100,00'),
  ligne('AC00002', '626000', '20260106-eeeeeeee', 'Téléphone', '20,00', '0,00'),
  ligne('AC00002', '512000', '20260106-eeeeeeee', 'Téléphone', '0,00', '20,00'),
].join('\r\n')
const ligneFec = (numero: number, pieceId: string, pieceRef: string): LigneFec => ({
  ecriture: ecriture({ id: `e${numero}-${pieceId}`, piece_id: pieceId }), journal: 'AC', numero, pieceRef, pieceDate: '2026-01-05',
  compteLib: 'Compte', compAuxNum: null, compAuxLib: null, validDate: '2026-01-05', champsBnc: null,
})
const NUMEROTATION: NumerotationFec = {
  aNouveaux: [], champsBnc: 'non_calcules', horsFec: [],
  lignes: [ligneFec(1, 'p1', REF), ligneFec(2, 'p2', '20260106-eeeeeeee')],
}
const PIECES = [{ id: 'p1', storage_path: 'd1/1787-Facture Mme Dupont.pdf' }, { id: 'p2', storage_path: 'd1/1788-Telephone.pdf' }]
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37])
const decoder = new TextDecoder('windows-1252')

beforeEach(() => {
  drapeau.leve = true
  reglagesDuDossier.lus = []
  reglagesDuDossier.enregistres = 0
  faux.fichiers = []
  faux.telechargements = 0
  faux.stockage = new Map([['d1/1787-Facture Mme Dupont.pdf', PDF], ['d1/1788-Telephone.pdf', null]])
  URL.createObjectURL = (b: Blob | MediaSource) => { faux.fichiers.push({ nom: '', blob: b as Blob }); return 'blob:export' }
  URL.revokeObjectURL = () => {}
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    faux.telechargements++
    faux.fichiers[faux.fichiers.length - 1].nom = this.download
  }
  if (typeof Blob.prototype.arrayBuffer !== 'function') {
    Blob.prototype.arrayBuffer = function (this: Blob) {
      return new Promise<ArrayBuffer>((resoudre) => {
        const lecteur = new FileReader()
        lecteur.onload = () => resoudre(lecteur.result as ArrayBuffer)
        lecteur.readAsArrayBuffer(this)
      })
    }
  }
})

async function monterSurQuadra() {
  render(
    <ExportVersUnLogiciel dossierId="d1" nomDuFec="123456789FEC20261231.txt" pieces={PIECES} indisponible={null}
      fec={() => ({ contenu: FEC, numerotation: NUMEROTATION })} />,
  )
  fireEvent.click(screen.getByRole('button', { name: /Exporter vers un logiciel comptable/ }))
  const logiciel = await screen.findByRole('combobox', { name: 'Logiciel' })
  fireEvent.change(logiciel, { target: { value: 'quadra' } })
}

function regler() {
  fireEvent.click(screen.getByRole('radio', { name: /Windows-1252/ }))
  fireEvent.click(screen.getByRole('radio', { name: /CR LF/ }))
  fireEvent.change(screen.getByRole('spinbutton', { name: /Longueur des comptes/ }), { target: { value: '8' } })
  fireEvent.change(screen.getByRole('textbox', { name: 'Code du journal AC dans le dossier Quadra' }), { target: { value: 'HA' } })
}

const octetsDe = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer())

describe('le profil Quadra, à l’écran', () => {
  it('le drapeau baissé : le choix du logiciel ne l’offre pas', async () => {
    drapeau.leve = false
    render(<ExportVersUnLogiciel dossierId="d1" nomDuFec="x.txt" pieces={PIECES} indisponible={null}
      fec={() => ({ contenu: FEC, numerotation: NUMEROTATION })} />)
    fireEvent.click(screen.getByRole('button', { name: /Exporter vers un logiciel comptable/ }))
    const logiciel = await screen.findByRole('combobox', { name: 'Logiciel' })
    expect([...(logiciel as HTMLSelectElement).options].map((o) => o.value)).toEqual(['acd'])
  })

  it('levé : tout est à saisir, rien n’est préchoisi, rien ne part ; aucun réglage Quadra ne se lit ni ne s’enregistre', async () => {
    await monterSurQuadra()
    const refus = screen.getByRole('alert').textContent ?? ''
    for (const m of ['L’encodage du fichier : à saisir.', 'La fin d’enregistrement : à saisir.', 'La longueur des comptes dans le dossier Quadra : à saisir.',
      'Le code du journal AC (Achats) dans le dossier Quadra : à saisir.']) expect(refus).toContain(m)
    expect(screen.getAllByRole('radio').some((r) => (r as HTMLInputElement).checked)).toBe(false)
    expect((screen.getByRole('button', { name: 'Télécharger le fichier' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: 'Enregistrer ces réglages' })).toBeNull()
    expect(reglagesDuDossier.lus).toEqual(['acd'])
    expect(reglagesDuDossier.enregistres).toBe(0)
  })

  it('réglé : l’aperçu dit ce qui part et ce qui se coupe ; deux clics, un seul fichier à largeur fixe, en Windows-1252', async () => {
    await monterSurQuadra()
    regler()
    expect(screen.getByText(/2 écriture\(s\), 4 ligne\(s\), à largeur fixe, en Windows-1252/)).toBeDefined()
    expect(screen.getByText(/0 libellé\(s\) coupé\(s\) à trente caractères/)).toBeDefined()
    expect(screen.getByText('60610000')).toBeDefined()
    const bouton = screen.getByRole('button', { name: 'Télécharger le fichier' })
    await act(async () => {
      fireEvent.click(bouton)
      fireEvent.click(bouton)
    })
    await waitFor(() => expect(faux.telechargements).toBe(1))
    expect(faux.fichiers[0].nom).toBe('123456789ASCII20261231.txt')
    const octets = await octetsDe(faux.fichiers[0].blob)
    expect([...octets]).toContain(0x97)
    const enregistrements = decoder.decode(octets).replace(/\r\n$/, '').split('\r\n')
    expect(enregistrements).toHaveLength(4)
    expect(enregistrements.every((m) => m.length === 251)).toBe(true)
    // Positions 1 à 55 : le type, le compte, le journal, le folio, la date, le code et le libellé libre à blanc, le sens, le montant.
    expect(enregistrements[0].slice(0, 55)).toBe('M60610000HA000050126' + ' '.repeat(21) + 'D+000000010000')
    expect(enregistrements[0].slice(107, 113)).toBe('EURHA ')
    expect(enregistrements[0].slice(231)).toBe(REF.padEnd(20, ' '))
    expect(screen.getByRole('status').textContent).toMatch(/Fichier téléchargé : 2 écriture\(s\), 4 ligne\(s\)\./)
  })

  it('avec les justificatifs : le fichier nomme celui que l’archive porte, à côté de lui ; celui qui manque n’est pas nommé', async () => {
    await monterSurQuadra()
    regler()
    await act(async () => { fireEvent.click(screen.getByRole('checkbox', { name: /Avec les justificatifs/ })) })
    await screen.findByText(/2 justificatif\(s\) partent à côté du fichier/)
    const bouton = screen.getByRole('button', { name: 'Télécharger l’archive' })
    await act(async () => {
      fireEvent.click(bouton)
      fireEvent.click(bouton)
    })
    await waitFor(() => expect(faux.telechargements).toBe(1))
    expect(faux.fichiers[0].nom).toBe('123456789ASCII20261231.zip')
    const zip = decoder.decode(await octetsDe(faux.fichiers[0].blob))
    expect(zip).toContain('123456789ASCII20261231.txt')
    const enregistrements = zip.match(/M[0-9]{8}HA000050126[^\r]{230}/g) ?? []
    expect(enregistrements).toHaveLength(4)
    expect(enregistrements.map((m) => m.slice(181, 193))).toEqual(['0a1b2c3d.pdf', ' '.repeat(12), ' '.repeat(12), ' '.repeat(12)])
    expect(zip).not.toContain('Dupont')
    expect(zip).not.toContain('eeeeeeee.pdf')
    expect(screen.getByRole('status').textContent)
      .toMatch(/le fichier d’écritures et 1 justificatif\(s\), chacun nommé dans le fichier — 1 justificatif\(s\) n’y sont PAS : 20260106-eeeeeeee : le stockage ne l’a pas rendu\./)
  })
})
