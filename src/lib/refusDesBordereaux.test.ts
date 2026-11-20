import { describe, expect, it } from 'vitest'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { bordereauFictifEnPdf } from '../test/bordereauFictif'
import { porteLaFormeDUnBordereau, type PageDeTexte } from './bordereauDeTeletransmission'
import type { OuvrirLeBordereau, TacheDeTextePdfJs } from './bordereauDeTeletransmissionLecture'
import { REFUS_D_UN_BORDEREAU, REFUS_D_UN_BORDEREAU_AU_CLIENT, REFUS_DES_BORDEREAUX_PREVU } from './refusDesBordereaux'
import { bordereauDansLeFichier } from './refusDesBordereauxLecture'

// LA FORME D'UN BORDEREAU DE TÉLÉTRANSMISSION, AU DÉPÔT (conception 59, BOR6, première partie). La reconnaissance est celle de
// BOR1 (le titre en ligne entière, l'en-tête des colonnes) ; ce fichier mesure qu'elle refuse le bordereau fictif sous ses
// formes, et AUCUN des textes ordinaires d'un dossier fabriqués ici — tous FICTIFS : aucun nom, aucune valeur d'un document réel.

const page = (...lignes: string[]): PageDeTexte => ({ lignes })

const TITRE = 'Bordereau de Teletransmission'
const ENTETE = 'Facture Date prescription Numéro Assuré Nom Bénéficiaire Naissance Total Caisse Mutuelle Assuré'

// Des textes ordinaires d'un dossier de praticien, fictifs, dont plusieurs nomment l'assurance maladie, un bénéficiaire, un
// numéro d'assuré, ou même le bordereau : aucun ne doit se refuser.
const TEXTES_ORDINAIRES: readonly [string, PageDeTexte[]][] = [
  ['une facture d’achat', [page('FACTURE N° F-2026-0042', 'Fournitures Fictives SARL', 'Date : 12/10/2026', 'Désignation Quantité PU HT Total HT', 'Compresses stériles 10 4,50 45,00', 'Total TTC 54,00')]],
  ['une note d’honoraires', [page('NOTE D’HONORAIRES', 'Cabinet Fictif', 'Prestation de remplacement octobre 2026', 'Total dû 1 200,00')]],
  ['un relevé bancaire', [page('RELEVÉ DE COMPTE', 'Banque Fictive', 'Date Libellé Débit Crédit', '05/10 VIR CPAM VILLE FICTIVE 1 234,56', 'Solde au 31/10/2026 4 321,00')]],
  ['la facture du logiciel de télétransmission', [page('FACTURE', 'Éditeur Fictif de logiciels', 'Abonnement mensuel 25,00', 'Option : impression du bordereau de télétransmission 5,00', 'Bordereau de télétransmission (module) 2,00', 'Total TTC 38,40')]],
  ['un titre de bordereau au milieu d’une phrase', [page('Merci de joindre le bordereau de teletransmission à votre envoi', 'Total 0,00')]],
  ['un décompte de mutuelle', [page('DÉCOMPTE DE REMBOURSEMENT', 'Mutuelle Fictive', 'Bénéficiaire : ASSURÉ FICTIF', 'Numéro assuré : 0000000000000', 'Date des soins Acte Dépense Remboursé', '01/10/2026 Consultation 30,00 9,00')]],
  ['un relevé d’activité de l’assurance maladie', [page('RELEVÉ INDIVIDUEL D’ACTIVITÉ ET DE PRESCRIPTIONS', 'Année 2025', 'Honoraires sans dépassement 98 765,00', 'Nombre d’actes 4 321')]],
  ['un appel de cotisations', [page('URSSAF', 'Échéancier 2026', 'Cotisations d’allocations familiales 123,00', 'CSG-CRDS 456,00')]],
  ['une facture de téléphone', [page('Opérateur Fictif', 'Facture du mois d’octobre', 'Forfait mobile 19,99', 'Total à payer 19,99')]],
  ['une quittance de loyer', [page('QUITTANCE DE LOYER', 'Local professionnel', 'Loyer octobre 2026 800,00')]],
  ['un bordereau de remise de chèques', [page('BORDEREAU DE REMISE DE CHÈQUES', 'Banque Fictive', 'Nombre de chèques 3', 'Montant total 150,00')]],
  ['un en-tête de colonnes incomplet', [page('Facture Date prescription Numéro Assuré Total Caisse Mutuelle', '900000001 01/10/2026 0 654,00')]],
  ['une page vide', [page()]],
]

describe('porteLaFormeDUnBordereau : le bordereau sous ses formes', () => {
  it('le titre en ligne entière, sous les accents, la casse et les espaces que pdf.js rend', () => {
    expect(porteLaFormeDUnBordereau([page(TITRE)])).toBe(true)
    expect(porteLaFormeDUnBordereau([page('  BORDEREAU DE TÉLÉTRANSMISSION ')])).toBe(true)
    expect(porteLaFormeDUnBordereau([page('bordereau  de télétransmission')])).toBe(true)
  })

  it('l’en-tête des colonnes, même collé à un autre texte de sa ligne, même sans le titre', () => {
    expect(porteLaFormeDUnBordereau([page(ENTETE)])).toBe(true)
    expect(porteLaFormeDUnBordereau([page(`Page 2 ${ENTETE} suite`)])).toBe(true)
  })

  it('sur n’importe quelle page : un bordereau ajouté au bout d’une facture', () => {
    expect(porteLaFormeDUnBordereau([...TEXTES_ORDINAIRES[0][1], page('PRATICIEN FICTIF', TITRE)])).toBe(true)
  })

  it('sous la forme des fragments positionnés que pdf.js rend', () => {
    expect(porteLaFormeDUnBordereau([{ fragments: [
      { texte: 'Bordereau de', x: 240, y: 800, largeur: 40 }, { texte: 'Teletransmission', x: 281, y: 800, largeur: 60 },
    ] }])).toBe(true)
  })
})

describe('porteLaFormeDUnBordereau : les faux positifs, mesurés', () => {
  it(`aucun des ${TEXTES_ORDINAIRES.length} textes ordinaires ne se refuse`, () => {
    const refuses = TEXTES_ORDINAIRES.filter(([, pages]) => porteLaFormeDUnBordereau(pages)).map(([nom]) => nom)
    expect(refuses).toEqual([])
    // Un plancher : la mesure porte sur ce nombre de textes, pas sur une liste vidée par mégarde.
    expect(TEXTES_ORDINAIRES.length).toBeGreaterThanOrEqual(13)
  })
})

describe('les deux phrases du refus', () => {
  it('disent pourquoi et où importer, sans majuscule ni point final ; le client est tutoyé', () => {
    for (const phrase of [REFUS_D_UN_BORDEREAU, REFUS_D_UN_BORDEREAU_AU_CLIENT]) {
      expect(phrase).toMatch(/^[a-zé]/)
      expect(phrase).not.toMatch(/[.]$/)
      expect(phrase).toContain('noms de patients')
      expect(phrase).toContain('« Facturé à l’assurance maladie »')
    }
    expect(REFUS_D_UN_BORDEREAU).toContain('onglet Banque')
    expect(REFUS_D_UN_BORDEREAU_AU_CLIENT).toContain('« Ma banque »')
    expect(REFUS_D_UN_BORDEREAU_AU_CLIENT).toMatch(/\bouvre\b.*\bton\b/)
    expect(REFUS_D_UN_BORDEREAU).not.toMatch(/\b(tu|ton|ta|tes)\b/)
  })

  it('le drapeau est baissé, jusqu’à l’essai sur un vrai poste', () => {
    expect(REFUS_DES_BORDEREAUX_PREVU).toBe(false)
  })
})

// ── La lecture au dépôt, par la version de pdf.js qui tourne hors navigateur, sur des PDF fictifs. ──

const ouvrirHorsNavigateur: OuvrirLeBordereau = (octets) => pdfjs.getDocument({ data: octets }) as unknown as TacheDeTextePdfJs

/** Un PDF fictif d'une ou plusieurs pages de lignes de texte (aucune ligne : une page sans texte, comme un PDF numérisé). */
async function pdfDeLignes(pages: readonly (readonly string[])[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const police = await doc.embedFont(StandardFonts.Helvetica)
  for (const lignes of pages) {
    const p = doc.addPage([595, 842])
    lignes.forEach((l, i) => p.drawText(l, { x: 40, y: 800 - 14 * i, size: 9, font: police }))
  }
  return doc.save()
}

const blob = (octets: Uint8Array) => new Blob([octets.slice(0)])

describe('bordereauDansLeFichier, par pdf.js, sur des PDF fictifs', () => {
  it('le bordereau fictif, sur une et sur deux pages', async () => {
    expect(await bordereauDansLeFichier(blob(await bordereauFictifEnPdf()), ouvrirHorsNavigateur)).toBe(true)
    expect(await bordereauDansLeFichier(blob(await bordereauFictifEnPdf({ pages: 2 })), ouvrirHorsNavigateur)).toBe(true)
  })

  it('un bordereau en troisième page, après deux pages de facture', async () => {
    const facture = ['FACTURE N° F-2026-0042', 'Total TTC 54,00']
    expect(await bordereauDansLeFichier(blob(await pdfDeLignes([facture, facture, ['PRATICIEN FICTIF', TITRE]])), ouvrirHorsNavigateur)).toBe(true)
  })

  it('les textes ordinaires, mis en PDF, ne se refusent pas', async () => {
    for (const [nom, pages] of TEXTES_ORDINAIRES) {
      const lignes = pages.map((p) => ('lignes' in p ? p.lignes : []).map((l) => l.replace(/[’]/g, '\'').replace(/[^\x20-\x7e -ÿ]/g, '')))
      expect([nom, await bordereauDansLeFichier(blob(await pdfDeLignes(lignes)), ouvrirHorsNavigateur)]).toEqual([nom, false])
    }
  })

  it('ce qui ne se lit pas ne se reconnaît pas : un PDF sans texte, un fichier qui n’est pas un PDF, une ouverture qui lève', async () => {
    expect(await bordereauDansLeFichier(blob(await pdfDeLignes([[]])), ouvrirHorsNavigateur)).toBe(false)
    expect(await bordereauDansLeFichier(new Blob(['ceci n’est pas un PDF']), ouvrirHorsNavigateur)).toBe(false)
    expect(await bordereauDansLeFichier(new Blob(['x']), () => { throw new Error('illisible') })).toBe(false)
  })

  it('une page qui ne se lit pas est sautée, les autres lues ; la lecture s’arrête à la première page qui a la forme', async () => {
    const lues: number[] = []
    let detruite = false
    const ouvrir: OuvrirLeBordereau = () => ({
      promise: Promise.resolve({
        numPages: 4,
        getPage: async (n: number) => {
          lues.push(n)
          if (n === 1) throw new Error('page abîmée')
          const str = n === 3 ? TITRE : 'Total 12,00'
          return { getTextContent: async () => ({ items: [{ str, transform: [1, 0, 0, 1, 40, 800], width: 100, height: 9 }] }) }
        },
      }),
      destroy: async () => { detruite = true },
    })
    expect(await bordereauDansLeFichier(new Blob(['x']), ouvrir)).toBe(true)
    expect(lues).toEqual([1, 2, 3])
    expect(detruite).toBe(true)
  })
})
