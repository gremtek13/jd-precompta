import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LigneFec, NumerotationFec } from '../../lib/fec'
import { ecriture } from '../../test/revision'

// L'ÉCRAN DE L'EXPORT VERS UN LOGICIEL COMPTABLE (EXP1) : le refus d'un caractère hors de Windows-1252 dit avant le clic, le
// verrou (deux clics, un export), le fichier relu tel qu'il part — décodé en Windows-1252 —, la correspondance d'un journal,
// et l'archive avec ses justificatifs : chacun sous la référence de sa pièce, ce qui manque dit dans le bilan. La mise en
// forme est gardée par lib/profilsDExport.test.ts ; le drapeau, par EcrituresTab.test.tsx.

const faux = vi.hoisted(() => ({
  fichiers: [] as { nom: string; type: string; blob: Blob }[],
  telechargements: 0,
  stockage: new Map<string, Uint8Array | null>(),
  demandes: [] as string[],
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    storage: {
      from: () => ({
        download: async (chemin: string) => {
          faux.demandes.push(chemin)
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
  faux.fichiers = []
  faux.telechargements = 0
  faux.demandes = []
  faux.stockage = new Map([['d1/1787-Facture Mme Dupont.pdf', PDF], ['d1/1788-Telephone.pdf', null]])
  URL.createObjectURL = (b: Blob | MediaSource) => {
    const blob = b as Blob
    faux.fichiers.push({ nom: '', type: blob.type, blob })
    return 'blob:export'
  }
  URL.revokeObjectURL = () => {}
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    faux.telechargements++
    faux.fichiers[faux.fichiers.length - 1].nom = this.download
  }
  // jsdom ne fournit pas toujours `arrayBuffer()` sur un Blob : on le pose, en gardant les OCTETS (comme BalanceCard.test.tsx).
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

function monter(fec: string = FEC) {
  render(
    <ExportVersUnLogiciel dossierId="d1" nomDuFec="123456789FEC20261231.txt" pieces={PIECES} indisponible={null}
      fec={() => ({ contenu: fec, numerotation: NUMEROTATION })} />,
  )
  fireEvent.click(screen.getByRole('button', { name: /Exporter vers un logiciel comptable/ }))
}

const octetsDe = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer())

describe('l’export vers un logiciel comptable, à l’écran', () => {
  it('indisponible : le bouton le dit et ne s’ouvre pas', () => {
    render(<ExportVersUnLogiciel dossierId="d1" nomDuFec="x.txt" pieces={[]} indisponible="brouillon lu en partie" fec={() => null} />)
    const bouton = screen.getByRole('button', { name: /Exporter vers un logiciel comptable/ }) as HTMLButtonElement
    expect(bouton.disabled).toBe(true)
    expect(bouton.title).toBe('brouillon lu en partie')
  })

  it('un caractère hors de Windows-1252 se refuse AVANT le clic, nommé par sa ligne ; rien ne part', () => {
    monter(FEC.replace('Téléphone', 'Téléphone ă'))
    expect(screen.getByRole('alert').textContent).toMatch(/Ligne 4 du fichier \(écriture AC00002, colonne EcritureLib\) : le caractère « ă » \(U\+0103\)/)
    expect((screen.getByRole('button', { name: 'Télécharger le fichier' }) as HTMLButtonElement).disabled).toBe(true)
    expect(faux.telechargements).toBe(0)
  })

  it('l’aperçu dit les comptes et les journaux tels qu’ils partiront, et les deux avertissements', () => {
    monter()
    expect(screen.getByText('60610000')).toBeDefined()
    expect(screen.getByText(/2 écriture\(s\), 4 ligne\(s\), dix-huit colonnes, en Windows-1252/)).toBeDefined()
    expect(screen.getByText(/importé deux fois double les écritures/)).toBeDefined()
    expect(screen.getByText(/peuvent doubler ceux que le logiciel tient déjà/)).toBeDefined()
    fireEvent.change(screen.getByRole('textbox', { name: 'Code du journal AC dans le logiciel' }), { target: { value: 'HA' } })
    const journaux = screen.getByRole('table', { name: /Les journaux/ })
    expect(journaux.textContent).toContain('HA')
    fireEvent.change(screen.getByRole('spinbutton', { name: /Longueur des comptes/ }), { target: { value: '13' } })
    expect(screen.getByRole('alert').textContent).toMatch(/de 6 à 12/)
  })

  it('deux clics dans le même act : un seul fichier, relu en Windows-1252 tel que l’aperçu l’a montré', async () => {
    monter()
    fireEvent.change(screen.getByRole('textbox', { name: 'Code du journal AC dans le logiciel' }), { target: { value: 'HA' } })
    const bouton = screen.getByRole('button', { name: 'Télécharger le fichier' })
    await act(async () => {
      fireEvent.click(bouton)
      fireEvent.click(bouton)
    })
    await waitFor(() => expect(faux.telechargements).toBe(1))
    expect(faux.fichiers).toHaveLength(1)
    expect(faux.fichiers[0].nom).toBe('123456789FEC20261231.txt')
    const octets = await octetsDe(faux.fichiers[0].blob)
    // Le tiret cadratin et le « é » sont chacun UN octet : du Windows-1252, pas de l'UTF-8.
    expect([...octets]).toContain(0x97)
    expect([...octets]).toContain(0xe9)
    const texte = decoder.decode(octets)
    expect(texte.endsWith('\r\n')).toBe(true)
    const lignes = texte.replace(/\r\n$/, '').split('\r\n').map((l) => l.split('\t'))
    expect(lignes[0].join('\t')).toBe(ENTETE)
    expect(lignes.slice(1).map((l) => [l[0], l[2], l[4], l[8], l[11]])).toEqual([
      ['HA', '1', '60610000', REF, '100,00'],
      ['HA', '1', '51200000', REF, '0,00'],
      ['HA', '2', '62600000', '20260106-eeeeeeee', '20,00'],
      ['HA', '2', '51200000', '20260106-eeeeeeee', '0,00'],
    ])
    expect(lignes[1][10]).toBe('Fournitures — été')
    expect(screen.getByRole('status').textContent).toMatch(/Fichier téléchargé : 2 écriture\(s\), 4 ligne\(s\)/)
  })

  it('avec les justificatifs : combien partent, pèsent combien ; l’archive les porte sous leur référence, ce qui manque se dit', async () => {
    monter()
    await act(async () => { fireEvent.click(screen.getByRole('checkbox', { name: /Avec les justificatifs/ })) })
    await screen.findByText(/2 justificatif\(s\) partent/)
    expect(screen.getByText(/0 écriture\(s\) n’en ont pas/).textContent).toMatch(/0 Mio, plus 1 fichier\(s\) de taille inconnue/)
    const bouton = screen.getByRole('button', { name: 'Télécharger l’archive' })
    await act(async () => {
      fireEvent.click(bouton)
      fireEvent.click(bouton)
    })
    await waitFor(() => expect(faux.telechargements).toBe(1))
    expect(faux.fichiers[0].nom).toBe('123456789FEC20261231.zip')
    expect(faux.demandes).toEqual(['d1/1787-Facture Mme Dupont.pdf', 'd1/1788-Telephone.pdf'])
    const zip = decoder.decode(await octetsDe(faux.fichiers[0].blob))
    expect(zip).toContain('123456789FEC20261231.txt')
    expect(zip).toContain(`${REF}.pdf`)
    expect(zip).not.toContain('Dupont')
    expect(zip).not.toContain('20260106-eeeeeeee.pdf')
    expect(screen.getByRole('status').textContent)
      .toMatch(/le fichier d’écritures et 1 justificatif\(s\) — 1 justificatif\(s\) n’y sont PAS : 20260106-eeeeeeee : le stockage ne l’a pas rendu\./)
  })
})
