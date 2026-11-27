import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LigneFec, NumerotationFec } from '../../lib/fec'
import { ecriture } from '../../test/revision'

// LE PROFIL TRA À L'ÉCRAN (EXP4), le drapeau `PROFIL_TRA_OFFERT` joué par un accesseur : baissé (le vrai), le choix du logiciel
// ne l'offre pas ; levé, sa section prend la place de celle d'ACD — tout « à saisir », aucune lecture ni aucun enregistrement
// de réglages (la base n'en garde que pour ACD), le verrou (deux clics, un fichier), le fichier à largeur fixe tel qu'il part,
// et l'archive dont le fichier NOMME, dans un enregistrement « G », le justificatif que l'archive porte. La mise en forme est
// gardée par lib/profilTra.test.ts.

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
vi.mock('../../lib/profilTra', async (original) => {
  const vrai = await original<typeof import('../../lib/profilTra')>()
  return { ...vrai, get PROFIL_TRA_OFFERT() { return drapeau.leve ?? vrai.PROFIL_TRA_OFFERT } }
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

async function monterSurTra() {
  render(
    <ExportVersUnLogiciel dossierId="d1" nomDuFec="123456789FEC20261231.txt" pieces={PIECES} indisponible={null}
      fec={() => ({ contenu: FEC, numerotation: NUMEROTATION })} />,
  )
  fireEvent.click(screen.getByRole('button', { name: /Exporter vers un logiciel comptable/ }))
  const logiciel = await screen.findByRole('combobox', { name: 'Logiciel' })
  fireEvent.change(logiciel, { target: { value: 'tra' } })
}

function regler() {
  fireEvent.click(screen.getByRole('radio', { name: /Windows-1252/ }))
  fireEvent.click(screen.getByRole('radio', { name: /CR LF/ }))
  fireEvent.click(screen.getByRole('radio', { name: /Vide pour tout le fichier/ }))
  fireEvent.change(screen.getByRole('spinbutton', { name: /Longueur des comptes/ }), { target: { value: '8' } })
  fireEvent.change(screen.getByRole('combobox', { name: 'Produit qui génère le fichier' }), { target: { value: 'S5' } })
  fireEvent.change(screen.getByRole('combobox', { name: 'Origine du fichier' }), { target: { value: 'CLI' } })
  fireEvent.change(screen.getByRole('combobox', { name: 'Gestion de l’analytique du dossier' }), { target: { value: 'X' } })
  fireEvent.change(screen.getByRole('textbox', { name: 'Code du journal AC dans le dossier Cegid' }), { target: { value: 'HA' } })
  fireEvent.change(screen.getByRole('textbox', { name: 'Libellé du journal AC dans le dossier Cegid' }), { target: { value: 'Achats' } })
  fireEvent.change(screen.getByRole('combobox', { name: 'Nature du journal AC dans le dossier Cegid' }), { target: { value: 'ACH' } })
  fireEvent.change(screen.getByRole('combobox', { name: 'Nature du mouvement des écritures du journal AC' }), { target: { value: 'FF' } })
}

const octetsDe = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer())

describe('le profil TRA, à l’écran', () => {
  it('le drapeau baissé : le choix du logiciel ne l’offre pas', async () => {
    drapeau.leve = false
    render(<ExportVersUnLogiciel dossierId="d1" nomDuFec="x.txt" pieces={PIECES} indisponible={null}
      fec={() => ({ contenu: FEC, numerotation: NUMEROTATION })} />)
    fireEvent.click(screen.getByRole('button', { name: /Exporter vers un logiciel comptable/ }))
    const logiciel = await screen.findByRole('combobox', { name: 'Logiciel' })
    expect([...(logiciel as HTMLSelectElement).options].map((o) => o.value)).not.toContain('tra')
  })

  it('levé : tout est à saisir, rien n’est préchoisi, rien ne part ; aucun réglage TRA ne se lit ni ne s’enregistre', async () => {
    await monterSurTra()
    const refus = screen.getByRole('alert').textContent ?? ''
    for (const m of ['L’encodage du fichier : à saisir.', 'La fin d’enregistrement : à saisir.', 'La longueur des comptes dans le dossier Cegid : à saisir.',
      'Le produit qui génère le fichier (en-tête, position 4) : à saisir.', 'Le numéro de pièce des écritures : à saisir.',
      'Le journal AC (Achats) : sa nature dans le dossier Cegid, à saisir.']) expect(refus).toContain(m)
    expect(screen.getAllByRole('radio').some((r) => (r as HTMLInputElement).checked)).toBe(false)
    for (const nom of ['Produit qui génère le fichier', 'Origine du fichier', 'Nature du journal AC dans le dossier Cegid']) {
      expect((screen.getByRole('combobox', { name: nom }) as HTMLSelectElement).value).toBe('')
    }
    expect((screen.getByRole('button', { name: 'Télécharger le fichier' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: 'Enregistrer ces réglages' })).toBeNull()
    expect(reglagesDuDossier.lus).toEqual(['acd'])
    expect(reglagesDuDossier.enregistres).toBe(0)
  })

  it('une nature BQE demande son compte de contrepartie, que l’écran offre alors', async () => {
    await monterSurTra()
    regler()
    expect(screen.queryByRole('textbox', { name: 'Compte de contrepartie du journal AC' })).toBeNull()
    fireEvent.change(screen.getByRole('combobox', { name: 'Nature du journal AC dans le dossier Cegid' }), { target: { value: 'BQE' } })
    expect(screen.getByRole('alert').textContent).toContain('Le journal AC (Achats) : une nature BQE demande son compte de contrepartie, à saisir.')
    fireEvent.change(screen.getByRole('textbox', { name: 'Compte de contrepartie du journal AC' }), { target: { value: '512' } })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('réglé : l’aperçu dit ce qui part ; deux clics, un seul fichier à largeur fixe, en Windows-1252', async () => {
    await monterSurTra()
    regler()
    expect(screen.getByText(/2 écriture\(s\), 4 ligne\(s\), à largeur fixe, en Windows-1252/)).toBeDefined()
    expect(screen.getByText(/0 libellé\(s\) coupé\(s\) à trente-cinq caractères/)).toBeDefined()
    expect(screen.getByText('60610000')).toBeDefined()
    const bouton = screen.getByRole('button', { name: 'Télécharger le fichier' })
    await act(async () => {
      fireEvent.click(bouton)
      fireEvent.click(bouton)
    })
    await waitFor(() => expect(faux.telechargements).toBe(1))
    expect(faux.fichiers[0].nom).toBe('123456789TRA20261231.TRA')
    const octets = await octetsDe(faux.fichiers[0].blob)
    expect([...octets]).toContain(0x97)
    const enregistrements = decoder.decode(octets).replace(/\r\n$/, '').split('\r\n')
    expect(enregistrements.map((m) => m.length)).toEqual([165, 517, 222, 222, 222, 222])
    expect(enregistrements[0].slice(0, 14)).toBe('***S5CLIJRLSTD')
    expect(enregistrements[1].slice(0, 47)).toBe(`***JALHA ${'Achats'.padEnd(35, ' ')}ACH`)
    // Positions 1 à 175 de la première écriture : le journal, la date, la nature, le compte, la pièce, le libellé, le sens,
    // le montant aligné à droite, « N », le numéro de pièce et la devise à blanc, « E-- ».
    expect(enregistrements[2].slice(0, 175)).toBe(`HA 05012026FF${'60610000'.padEnd(17, ' ')} ${' '.repeat(17)}${REF.padEnd(35, ' ')}`
      + `${'Fournitures — été'.padEnd(35, ' ')}${' '.repeat(11)}D${'100,00'.padStart(20, ' ')}N${' '.repeat(21)}E--`)
    expect(screen.getByRole('status').textContent).toMatch(/Fichier téléchargé : 2 écriture\(s\), 4 ligne\(s\)\./)
  })

  it('avec les justificatifs : le chemin se demande ; le fichier nomme celui que l’archive porte ; celui qui manque n’est pas nommé', async () => {
    await monterSurTra()
    regler()
    await act(async () => { fireEvent.click(screen.getByRole('checkbox', { name: /Avec les justificatifs/ })) })
    expect(screen.getByRole('alert').textContent).toContain('Le chemin des justificatifs dans le fichier : à saisir.')
    fireEvent.click(screen.getByRole('radio', { name: /Le nom du fichier seul/ }))
    await screen.findByText(/2 justificatif\(s\) partent à côté du fichier/)
    const bouton = screen.getByRole('button', { name: 'Télécharger l’archive' })
    await act(async () => {
      fireEvent.click(bouton)
      fireEvent.click(bouton)
    })
    await waitFor(() => expect(faux.telechargements).toBe(1))
    expect(faux.fichiers[0].nom).toBe('123456789TRA20261231.zip')
    const zip = decoder.decode(await octetsDe(faux.fichiers[0].blob))
    expect(zip).toContain('123456789TRA20261231.TRA')
    const documents = zip.match(/HA 05012026FF[0-9]{8} {9}G[^\r]{307}/g) ?? []
    expect(documents).toHaveLength(1)
    expect(documents[0]?.slice(83).trimEnd()).toBe(`${REF}.pdf`)
    expect(zip).not.toContain('Dupont')
    expect(zip).not.toContain('20260106-eeeeeeee.pdf')
    expect(screen.getByRole('status').textContent)
      .toMatch(/le fichier d’écritures et 1 justificatif\(s\), chacun nommé dans le fichier — 1 justificatif\(s\) n’y sont PAS : 20260106-eeeeeeee : le stockage ne l’a pas rendu\./)
  })
})
