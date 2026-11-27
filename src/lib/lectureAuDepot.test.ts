import { beforeEach, describe, expect, it, vi } from 'vitest'

// LA LECTURE AU DÉPÔT (BOR6, troisième partie, 27/11/2026) : de la réponse d'extract-piece à ce que lisent les deux chemins du
// dépôt, par le vrai `extractPiece` et le vrai `codeDeLErreurFonction`, sur un faux client dont `invoke` rend ce que rend
// supabase-js — une erreur dont `context` est la Response brute, jamais lue (lib/invokeErreur.ts).

const etat = { reponse: null as Response | null, donnees: null as unknown, panne: false }

vi.mock('./supabase', () => ({
  supabase: {
    functions: {
      invoke: async () => {
        if (etat.panne) throw new Error('réseau coupé')
        if (etat.reponse) return { data: null, error: Object.assign(new Error('Edge Function returned a non-2xx status code'), { context: etat.reponse }) }
        return { data: etat.donnees, error: null }
      },
    },
  },
}))

const { lireAuDepot } = await import('./lectureAuDepot')
const { extractPiece, CODE_D_UN_BORDEREAU_LU } = await import('./extraction')

const PHRASE = "Ce document a la forme d'un bordereau de télétransmission : il porte des noms de patients."
const pdf = () => new File(['%PDF-1.4'], 'scan.pdf', { type: 'application/pdf' })

beforeEach(() => {
  etat.reponse = null
  etat.donnees = { classification: 'facture', date_piece: '2026-03-10', tiers: 'EDF', montant_ttc: 120, confiance: 'haute' }
  etat.panne = false
})

describe('lireAuDepot', () => {
  it('le code d’extract-piece est celui que lit le navigateur', () => {
    expect(CODE_D_UN_BORDEREAU_LU).toBe('bordereau')
  })

  it('une lecture rendue : « lue », avec ce qu’elle a lu', async () => {
    expect(await lireAuDepot(pdf(), 'scan.pdf')).toEqual({ etat: 'lue', extraction: etat.donnees })
  })

  it('un 422 qui porte le code `bordereau` : « bordereau », et la phrase reste lisible par les autres appelants', async () => {
    etat.reponse = Response.json({ error: PHRASE, code: 'bordereau' }, { status: 422 })
    expect(await lireAuDepot(pdf(), 'scan.pdf')).toEqual({ etat: 'bordereau' })
    etat.reponse = Response.json({ error: PHRASE, code: 'bordereau' }, { status: 422 })
    await expect(extractPiece(pdf(), 'scan.pdf')).rejects.toMatchObject({ message: PHRASE, code: 'bordereau' })
  })

  it('tout autre refus, un corps sans code, un corps illisible ou une panne : « ratee », jamais « bordereau »', async () => {
    etat.reponse = Response.json({ error: 'Fichier vide.' }, { status: 400 })
    expect(await lireAuDepot(pdf(), 'scan.pdf')).toEqual({ etat: 'ratee' })
    etat.reponse = Response.json({ error: PHRASE, code: 'autre' }, { status: 422 })
    expect(await lireAuDepot(pdf(), 'scan.pdf')).toEqual({ etat: 'ratee' })
    etat.reponse = new Response('<html>délai</html>', { status: 504 })
    expect(await lireAuDepot(pdf(), 'scan.pdf')).toEqual({ etat: 'ratee' })
    etat.reponse = null
    etat.panne = true
    expect(await lireAuDepot(pdf(), 'scan.pdf')).toEqual({ etat: 'ratee' })
    etat.panne = false
    etat.donnees = { error: 'illisible' }
    expect(await lireAuDepot(pdf(), 'scan.pdf')).toEqual({ etat: 'ratee' })
  })
})
