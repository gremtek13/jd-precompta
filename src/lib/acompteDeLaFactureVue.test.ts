import { describe, expect, it } from 'vitest'
import { SANS_ACOMPTE_CII, type AcompteCii } from './factureCii'
import { ACOMPTE_EN_LECTURE, ceQueLAcompteImprime, type DevisCite, type FactureCitee, type LectureAcompte } from './acompteDeLaFactureVue'

// CE QUE L'APERÇU IMPRIME DE L'ACOMPTE D'UN DEVIS (lib/acompteDeLaFactureVue.ts, étape P5b4b) : le titre, les références
// sous lui, et quand l'impression attend. Données FICTIVES.
const facture = { type: 'facture' as const, date_emission: '2026-10-01' }
const avoir = { type: 'avoir' as const, date_emission: '2026-10-20' }
const DEVIS = { numero: 'D2026-0002', date_emission: '2026-09-20' }

function lue(a: Partial<AcompteCii>, o: { origine?: FactureCitee; devis?: DevisCite } = {}): LectureAcompte {
  return { factureId: 'f', etat: 'lue', acompte: { ...SANS_ACOMPTE_CII, ...a }, origine: o.origine ?? null, devis: o.devis ?? null }
}
const repris = (id: string, numero: string, date_emission: string, acompte: boolean | null = true) => ({ id, numero, date_emission, acompte })

describe('ceQueLAcompteImprime', () => {
  it('sans acompte, ni pour une facture ni pour un avoir : rien ne change', () => {
    expect(ceQueLAcompteImprime(facture, lue({}))).toEqual({ etat: 'sans' })
    expect(ceQueLAcompteImprime(avoir, lue({}))).toEqual({ etat: 'sans' })
  })

  it('la facture d’acompte : son titre, le devis cité, la date du versement autre que la sienne', () => {
    expect(ceQueLAcompteImprime(facture, lue({ acompte: true, dateVersement: '2026-09-25' }, { devis: DEVIS }))).toEqual({
      etat: 'imprime', titre: 'FACTURE D’ACOMPTE', referenceDOrigine: true,
      references: ['Acompte sur le devis D2026-0002 du 20/09/2026', 'Acompte versé le 25/09/2026'],
    })
    // Le jour même (la base ne le garde pas, mais l'écran ne le redit pas), ou inconnue : rien de la date.
    const memeJour = ceQueLAcompteImprime(facture, lue({ acompte: true, dateVersement: '2026-10-01' }, { devis: DEVIS }))
    expect(memeJour.etat === 'imprime' && memeJour.references).toEqual(['Acompte sur le devis D2026-0002 du 20/09/2026'])
  })

  it('la finale : « FACTURE », et la phrase qui cite chaque acompte repris, par date', () => {
    const un = ceQueLAcompteImprime(facture, lue({ reprises: [{ ordre: 2, factureId: 'a1' }], acomptesRepris: [repris('a1', 'F2026-0003', '2026-10-01')] }))
    expect(un).toEqual({ etat: 'imprime', titre: 'FACTURE', referenceDOrigine: true, references: ['Facture définitive après l’acompte F2026-0003 du 01/10/2026, repris en déduction'] })
    const deux = ceQueLAcompteImprime(facture, lue({
      reprises: [{ ordre: 2, factureId: 'a2' }, { ordre: 3, factureId: 'a1' }, { ordre: 4, factureId: 'a2' }],
      acomptesRepris: [repris('a2', 'F2026-0005', '2026-10-15'), repris('a1', 'F2026-0003', '2026-10-01')],
    }))
    expect(deux.etat === 'imprime' && deux.references).toEqual([
      'Facture définitive après les acomptes F2026-0003 du 01/10/2026 et F2026-0005 du 15/10/2026, repris en déduction',
    ])
  })

  it('l’avoir d’un acompte : « AVOIR » et la facture d’acompte qu’il corrige, à la place de la référence d’hier', () => {
    expect(ceQueLAcompteImprime(avoir, lue({ origineAcompte: true }, { origine: { numero: 'F2026-0003', date_emission: '2026-10-01' } }))).toEqual({
      etat: 'imprime', titre: 'AVOIR', referenceDOrigine: false, references: ['Avoir sur la facture d’acompte F2026-0003 du 01/10/2026'],
    })
  })

  it('pas encore lu, illisible, ou un acompte cité qui manque : l’impression attend, et l’écran dit pourquoi', () => {
    expect(ceQueLAcompteImprime(facture, null)).toEqual({ etat: 'retenu', avis: ACOMPTE_EN_LECTURE })
    const cas: [typeof facture | typeof avoir, LectureAcompte][] = [
      [facture, { factureId: 'f', etat: 'illisible', motif: 'Refusé.' }],
      [facture, lue({ acompte: null })],
      [avoir, lue({ origineAcompte: null })],
      [avoir, lue({ origineAcompte: true })],
      [facture, lue({ reprises: [{ ordre: 2, factureId: null }] })],
      [facture, lue({ reprises: [{ ordre: 2, factureId: 'a1' }] })],
      [facture, lue({ reprises: [{ ordre: 2, factureId: 'a1' }], acomptesRepris: [repris('a1', 'F2026-0003', '2026-10-01', false)] })],
    ]
    for (const [f, l] of cas) expect(ceQueLAcompteImprime(f, l).etat, JSON.stringify(l)).toBe('retenu')
  })
})
