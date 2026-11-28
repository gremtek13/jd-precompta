import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { bordereauFictifEnPdf } from '../test/bordereauFictif'
import type { OuvrirLeBordereau, TacheDeTextePdfJs } from './bordereauDeTeletransmissionLecture'

// LE REFUS D'UN BORDEREAU DANS LES PRÉPARATEURS DU DÉPÔT (BOR6, première partie), ses deux états joués par un accesseur
// (`get REFUS_DES_BORDEREAUX_PREVU()`) : baissé, l'état d'avant, rien n'est lu et le bordereau part ; levé, le PDF est lu par
// pdf.js (la version hors navigateur, par le même code) et le bordereau se refuse, à chacun des quatre préparateurs d'un
// fichier choisi, et au dépôt du client (lib/depot.ts) avant tout appel au stockage, aux mots du client.

const drapeau = { leve: false }
const lectures = { n: 0 }

vi.mock('./refusDesBordereaux', async (importOriginal) => {
  const vrai = await importOriginal<typeof import('./refusDesBordereaux')>()
  return { ...vrai, get REFUS_DES_BORDEREAUX_PREVU() { return drapeau.leve } }
})

const ouvrirHorsNavigateur: OuvrirLeBordereau = (octets) => pdfjs.getDocument({ data: octets }) as unknown as TacheDeTextePdfJs

vi.mock('./refusDesBordereauxLecture', async (importOriginal) => {
  const vrai = await importOriginal<typeof import('./refusDesBordereauxLecture')>()
  return {
    ...vrai,
    bordereauDansLeFichier: (fichier: Blob) => { lectures.n++; return vrai.bordereauDansLeFichier(fichier, ouvrirHorsNavigateur) },
  }
})

// Le dépôt du client ne doit toucher ni la base ni le stockage : tout accès au client lève.
const acces = { n: 0 }
vi.mock('./supabase', () => ({
  supabase: new Proxy({}, { get: () => { acces.n++; throw new Error('le client de la base ne devait pas être appelé') } }),
}))

const {
  bilanDesRefus, preparerDocumentDuCabinet, preparerOriginalDImport, preparerPiece, preparerProcesVerbal, refusDUnePiece,
  TAILLE_MAX_PIECE,
} = await import('./bornesStockage')
const { REFUS_D_UN_BORDEREAU, REFUS_D_UN_BORDEREAU_AU_CLIENT } = await import('./refusDesBordereaux')
const { deposerFichier } = await import('./depot')

async function factureFictive(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const police = await doc.embedFont(StandardFonts.Helvetica)
  const p = doc.addPage([595, 842])
  ;['FACTURE N° F-2026-0042', 'Fournitures Fictives SARL', 'Total TTC 54,00'].forEach((l, i) => p.drawText(l, { x: 40, y: 800 - 14 * i, size: 9, font: police }))
  return doc.save()
}

const fichier = (octets: Uint8Array, nom: string) => new File([octets.slice(0)], nom, { type: 'application/pdf' })

beforeEach(() => {
  drapeau.leve = false
  lectures.n = 0
  acces.n = 0
})

const PREPARATEURS: readonly [string, (f: File) => Promise<unknown>][] = [
  ['preparerPiece', preparerPiece],
  ['preparerDocumentDuCabinet', preparerDocumentDuCabinet],
  ['preparerOriginalDImport', preparerOriginalDImport],
  ['preparerProcesVerbal', preparerProcesVerbal],
]

describe('drapeau baissé : l’état d’avant', () => {
  it('le bordereau part, et aucun PDF n’est lu', async () => {
    const bordereau = await bordereauFictifEnPdf()
    for (const [nom, preparer] of PREPARATEURS) {
      const issue = await preparer(fichier(bordereau, 'lot.pdf'))
      expect([nom, 'corps' in (issue as object)]).toEqual([nom, true])
    }
    expect(lectures.n).toBe(0)
  })
})

describe('drapeau levé : le bordereau se refuse avant tout envoi', () => {
  it('à chacun des quatre préparateurs d’un fichier choisi, sous la raison « bordereau » et la phrase du cabinet', async () => {
    drapeau.leve = true
    const bordereau = await bordereauFictifEnPdf({ pages: 2 })
    for (const [nom, preparer] of PREPARATEURS) {
      const issue = await preparer(fichier(bordereau, 'lot.pdf'))
      expect([nom, issue]).toEqual([nom, { refus: { raison: 'bordereau', taille: bordereau.byteLength, message: REFUS_D_UN_BORDEREAU } }])
    }
    expect(lectures.n).toBe(PREPARATEURS.length)
  })

  // UNE EXTENSION QUI MENT (relecture adverse du chemin d'une pièce, 28/11/2026) : un bordereau renommé « .csv » ou « .jpg »
  // partait sous le type de son extension, sans être lu — et sous « .csv », rien d'autre ne le lisait.
  it('un bordereau renommé « .csv » ou « .jpg » se reconnaît à ses premiers octets, et se refuse', async () => {
    drapeau.leve = true
    const bordereau = await bordereauFictifEnPdf()
    for (const nom of ['releve.csv', 'photo.jpg', 'scan.png']) {
      const issue = await preparerPiece(new File([bordereau.slice(0)], nom, { type: '' }))
      expect([nom, 'refus' in issue && issue.refus.raison]).toEqual([nom, 'bordereau'])
    }
    expect(lectures.n).toBe(3)
  })

  it('une facture ordinaire part ; une image et un CSV partent sans être lus ; un PDF trop lourd se refuse sur son poids, sans lecture', async () => {
    drapeau.leve = true
    expect('corps' in await preparerPiece(fichier(await factureFictive(), 'facture.pdf'))).toBe(true)
    expect(lectures.n).toBe(1)
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0])
    expect('corps' in await preparerPiece(new File([png], 'photo.png'))).toBe(true)
    expect('corps' in await preparerPiece(new File(['Date;Libellé;Montant\n'], 'releve.csv'))).toBe(true)
    expect(lectures.n).toBe(1)
    const lourd = new Uint8Array(TAILLE_MAX_PIECE + 1)
    lourd.set([0x25, 0x50, 0x44, 0x46])
    const issue = await preparerPiece(new File([lourd], 'gros.pdf'))
    expect('refus' in issue && issue.refus.raison).toBe('taille')
    expect(lectures.n).toBe(1)
  })

  it('le refus se dit dès le choix du fichier, et le bilan d’un lot le compte à part', async () => {
    drapeau.leve = true
    const refus = await refusDUnePiece(fichier(await bordereauFictifEnPdf(), 'lot.pdf'))
    expect(refus?.raison).toBe('bordereau')
    expect(bilanDesRefus('pieces', [refus!])).toBe('1 ignoré(s) : 1 à la forme d’un bordereau de télétransmission (ses totaux s’importent dans la banque, section « Facturé à l’assurance maladie »)')
  })

  it('le dépôt du client le refuse aux mots du client, sans toucher ni la base ni le stockage', async () => {
    drapeau.leve = true
    const resultat = await deposerFichier('00000000-0000-4000-8000-000000000001', fichier(await bordereauFictifEnPdf(), 'lot.pdf'), new Set())
    expect(resultat).toEqual({ statut: 'erreur', message: REFUS_D_UN_BORDEREAU_AU_CLIENT })
    expect(acces.n).toBe(0)
  })
})
