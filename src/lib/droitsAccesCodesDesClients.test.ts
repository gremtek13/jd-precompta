import { describe, expect, it, vi } from 'vitest'
import type { ReglageDuDossier } from './droitsAcces'

// LE CODE DE CHAQUE FICHE DANS CE QUE DISENT LES CASES (EXP58-Q2). Le client « Ventes » lit toute la fiche de ses clients
// (`contacts_lecture_ventes`) : la migration `codes_des_clients` lui fait lire aussi le code que la base donne à chacune. La
// phrase de l'onglet Accès le dit sous le drapeau de la migration — baissé, elle reste celle d'hier, au caractère près. Le
// drapeau est joué par un accesseur ; le reste de la phrase a ses tests (droitsAcces.test.ts). Données FICTIVES.

const drapeau = vi.hoisted(() => ({ codes: false }))
vi.mock('./codesDesClients', async (original) => ({
  ...(await original<typeof import('./codesDesClients')>()),
  get CODES_DES_CLIENTS_PREVUS() { return drapeau.codes },
}))

const { ceQueDisentLesCases } = await import('./droitsAcces')
const { CODE_DANS_LA_PHRASE_DES_CASES } = await import('./codesDesClients')

const BASCULE: ReglageDuDossier = { etat: 'bascule' }
const phrase = (contacts: boolean) =>
  ceQueDisentLesCases(false, true, false, false, contacts, false, false, false, false, BASCULE, false, false)

describe('le code de chaque fiche, dans la phrase des cases (EXP58-Q2)', () => {
  it('baissé : la phrase d’hier, sans un mot du code', () => {
    drapeau.codes = false
    expect(phrase(true)).not.toContain(CODE_DANS_LA_PHRASE_DES_CASES)
  })

  it('levé : le code parmi ce qu’il lit, après les observations et avant les auteurs ; rien d’autre ne change', () => {
    drapeau.codes = false
    const hier = phrase(true)
    drapeau.codes = true
    const demain = phrase(true)
    expect(demain).toContain(`observations, ${CODE_DANS_LA_PHRASE_DES_CASES}, et qui a créé, changé, retiré ou effacé chaque contact`)
    expect(demain.replace(`${CODE_DANS_LA_PHRASE_DES_CASES}, `, '')).toBe(hier)
  })

  it('sans les contacts ouverts, le drapeau ne change rien : la phrase ne parle pas de leur fichier', () => {
    drapeau.codes = false
    const hier = phrase(false)
    drapeau.codes = true
    expect(phrase(false)).toBe(hier)
  })
})
