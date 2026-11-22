import { beforeAll, describe, expect, it } from 'vitest'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { bordereauFictifEnPdf } from '../test/bordereauFictif'
import {
  BORDEREAUX_ECARTES_BAISSES, BORDEREAUX_ECARTES_LEVES, CONTRATS, jugerScenario, scenariosDesBordereauxBaisses,
  scenariosDesBordereauxLeves, type ContratFonction, type Contexte, type PdfDesBordereaux,
} from '../test/contratsFonctions'
import { muter, prechauffer, sourceDe } from '../test/fonctionsEdge'

// LE BORDEREAU DE TÉLÉTRANSMISSION ÉCARTÉ À LA RÉCEPTION PAR E-MAIL, LES APPELS HTTP (BOR6, seconde partie ; BOR-Q9 (A)).
// receive-email n'écarte un bordereau que sous `BORDEREAUX_ECARTES_A_LA_RECEPTION`, LEVÉE le 22/11/2026 (la migration
// `pieces_jointes_ecartees_bordereau` en production, l'essai d'un vrai bordereau fait, BOR6R-Q1) : servie, un PDF qui a la forme
// d'un bordereau s'écarte avant le stockage et Textract, une facture et un PDF illisible partent comme avant ; baissée en
// mémoire — l'état d'avant, éprouvé tant que son code existe —, la fonction dépose tout PDF comme avant. Les PDF sont FICTIFS
// (pdf-lib). Les contrôles qui valent partout (ni secret ni valeur sensible au journal — les noms du bordereau fictif compris —,
// aucun hôte non déclaré) s'appliquent à chacun.

const contexte: Contexte = { entetesDuNavigateur: [] }
const contrat: ContratFonction = (() => {
  const c = CONTRATS.find((x) => x.slug === 'receive-email')
  if (!c) throw new Error('aucun contrat pour receive-email')
  return c
})()
const servie = () => sourceDe('receive-email')
const baissee = () => muter(servie(), [[BORDEREAUX_ECARTES_LEVES, BORDEREAUX_ECARTES_BAISSES]])

async function factureFictive(): Promise<Uint8Array<ArrayBuffer>> {
  const doc = await PDFDocument.create()
  const police = await doc.embedFont(StandardFonts.Helvetica)
  const p = doc.addPage([595, 842])
  ;['FACTURE N° F-2026-0042', 'Fournitures Fictives SARL', 'Option : impression du bordereau de télétransmission 5,00', 'Total TTC 54,00']
    .forEach((l, i) => p.drawText(l, { x: 40, y: 800 - 14 * i, size: 9, font: police }))
  return new Uint8Array(await doc.save())
}

const pdf: PdfDesBordereaux = { bordereau: new Uint8Array(0), facture: new Uint8Array(0), illisible: new Uint8Array(0) }
beforeAll(async () => {
  pdf.bordereau = new Uint8Array(await bordereauFictifEnPdf({ pages: 2 }))
  pdf.facture = await factureFictive()
  // Un PDF qui ne se lit pas : sa signature, puis rien qui soit un objet.
  pdf.illisible = new Uint8Array(new TextEncoder().encode('%PDF-1.7\n%illisible du harnais\n'))
  prechauffer(servie())
  prechauffer(baissee())
})

describe('la constante de receive-email', () => {
  it('servie, la constante est levée, une fois exactement ; baissée en mémoire, rien d’autre ne change', () => {
    expect(servie().split(BORDEREAUX_ECARTES_LEVES)).toHaveLength(2)
    expect(servie().includes(BORDEREAUX_ECARTES_BAISSES)).toBe(false)
    expect(baissee().replace(BORDEREAUX_ECARTES_BAISSES, BORDEREAUX_ECARTES_LEVES)).toBe(servie())
  })

  it('baissée en mémoire : le scénario du bordereau écarté tombe — la constante baissée ne lit rien', async () => {
    expect(await jugerScenario(contrat, scenariosDesBordereauxLeves(pdf)[0], contexte, baissee())).not.toEqual([])
  })

  it('servie : le scénario de la constante baissée tombe — le bordereau ne se dépose plus', async () => {
    expect(await jugerScenario(contrat, scenariosDesBordereauxBaisses(pdf)[0], contexte, servie())).not.toEqual([])
  })
})

describe('receive-email servie (constante levée) : le bordereau écarté avant tout dépôt', () => {
  it.each([0, 1, 2, 3, 4, 5])('scénario %i', async (i) => {
    const s = scenariosDesBordereauxLeves(pdf)[i]
    expect(await jugerScenario(contrat, s, contexte, servie()), s.nom).toEqual([])
  })
})

describe('receive-email, constante baissée en mémoire : l’état d’avant, rien ne change', () => {
  it('le bordereau se dépose comme avant', async () => {
    const s = scenariosDesBordereauxBaisses(pdf)[0]
    expect(await jugerScenario(contrat, s, contexte, baissee()), s.nom).toEqual([])
  })
})
