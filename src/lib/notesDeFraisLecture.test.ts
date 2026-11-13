import { afterEach, describe, expect, it, vi } from 'vitest'
import { lireMesNotesDeFrais } from './notesDeFraisLecture'

// Ce que « Mes notes de frais » lit (étape B8) : RIEN, drapeau baissé (la table n'existe pas avant B7) ; levé, les cases
// « Notes de frais » et « Achats » relues à la base, seul `true` accorde. B8-Q1 (12/11/2026) : « Achats » SEUL ouvre la
// lecture (les décisions), et la lecture rend `frais` faux pour que l'écran taise la saisie ; ni l'une ni l'autre, `sans_frais`.

const faux = vi.hoisted(() => ({
  drapeau: true,
  droits: { data: { frais: true, achats: false } as unknown, error: null as unknown },
  lues: [] as string[],
}))

vi.mock('./notesDeFrais', async (original) => ({
  ...await original<typeof import('./notesDeFrais')>(),
  get NOTES_DE_FRAIS_PREVUES() { return faux.drapeau },
}))
vi.mock('./supabase', () => {
  const requete = (table: string) => {
    const r = {
      select: () => r, order: () => r, eq: () => r,
      range: () => { faux.lues.push(table); return Promise.resolve({ data: [], error: null, count: 0 }) },
    }
    return r
  }
  return { supabase: { from: requete, rpc: (nom: string) => { faux.lues.push(`rpc:${nom}`); return Promise.resolve(faux.droits) } } }
})

afterEach(() => {
  faux.drapeau = true; faux.droits = { data: { frais: true, achats: false }, error: null }; faux.lues = []
})

describe('« Mes notes de frais » : les cases relues à la base', () => {
  it('drapeau baissé : rien ne se lit, et l’échec se dit', async () => {
    faux.drapeau = false
    expect((await lireMesNotesDeFrais('d1', 'u1')).etat).toBe('echec')
    expect(faux.lues).toEqual([])
  })

  it('« Notes de frais » : la saisie ; « Achats » seul : les décisions sans la saisie (B8-Q1) ; aucune des deux : sans_frais', async () => {
    const avecFrais = await lireMesNotesDeFrais('d1', 'u1')
    expect(avecFrais.etat === 'lues' && [avecFrais.frais, avecFrais.achats]).toEqual([true, false])
    faux.droits = { data: { frais: false, achats: true }, error: null }
    const achatsSeul = await lireMesNotesDeFrais('d1', 'u1')
    expect(achatsSeul.etat === 'lues' && [achatsSeul.frais, achatsSeul.achats, achatsSeul.lesNotes.complete]).toEqual([false, true, true])
    // Seul `true` accorde : une chaîne n'est pas une case cochée.
    faux.droits = { data: { frais: 'true', achats: 'true' }, error: null }
    expect(await lireMesNotesDeFrais('d1', 'u1')).toEqual({ dossierId: 'd1', etat: 'sans_frais' })
    faux.droits = { data: { frais: false, achats: false }, error: null }
    expect(await lireMesNotesDeFrais('d1', 'u1')).toEqual({ dossierId: 'd1', etat: 'sans_frais' })
  })
})
