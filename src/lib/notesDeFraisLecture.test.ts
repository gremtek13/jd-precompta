import { afterEach, describe, expect, it, vi } from 'vitest'
import { lireLesNotesDeFraisDuDossier, lireMesNotesDeFrais } from './notesDeFraisLecture'

// Ce que « Mes notes de frais » lit (étape B8) : RIEN, drapeau baissé (la table n'existe pas avant B7) ; levé, les cases
// « Notes de frais » et « Achats » relues à la base, seul `true` accorde. B8-Q1 (12/11/2026) : « Achats » SEUL ouvre la
// lecture (les décisions), et la lecture rend `frais` faux pour que l'écran taise la saisie ; ni l'une ni l'autre, `sans_frais`.

const faux = vi.hoisted(() => ({
  drapeau: true,
  droits: { data: { frais: true, achats: false } as unknown, error: null as unknown },
  lues: [] as string[],
  colonnes: [] as string[],
  refuser: null as string | null,
  lever: null as string | null,
}))

vi.mock('./notesDeFrais', async (original) => ({
  ...await original<typeof import('./notesDeFrais')>(),
  get NOTES_DE_FRAIS_PREVUES() { return faux.drapeau },
}))
vi.mock('./supabase', () => {
  const requete = (table: string) => {
    const r = {
      select: (c: string) => { faux.colonnes.push(`${table}: ${c}`); return r }, order: () => r, eq: () => r, in: () => r,
      range: () => {
        faux.lues.push(table)
        if (faux.lever === table) throw new Error('requête rompue')
        return Promise.resolve(faux.refuser === table
          ? { data: null, error: { message: 'refus fictif' }, count: null }
          : { data: [], error: null, count: 0 })
      },
    }
    return r
  }
  return { supabase: { from: requete, rpc: (nom: string) => { faux.lues.push(`rpc:${nom}`); return Promise.resolve(faux.droits) } } }
})

afterEach(() => {
  faux.drapeau = true; faux.droits = { data: { frais: true, achats: false }, error: null }; faux.lues = []; faux.colonnes = []
  faux.refuser = null; faux.lever = null
})

// Lot L3 : la section du cabinet lit aussi les accès du dossier et leur case « Achats » — à part : refusée, elle ne fait tomber
// ni les notes ni leurs justificatifs —, et le type de chaque justificatif.
describe('les notes de frais du dossier, côté cabinet : les accès et leur case « Achats » (lot L3)', () => {
  it('drapeau baissé : rien ne se lit, les trois lectures en échec', async () => {
    faux.drapeau = false
    const l = await lireLesNotesDeFraisDuDossier('d1')
    expect([l.lesNotes.complete, l.justificatifs.complete, l.acces.complete]).toEqual([false, false, false])
    expect(faux.lues).toEqual([])
  })

  it('levé : les accès avec leur case « Achats » ; leur refus ne fait tomber que leur lecture', async () => {
    const l = await lireLesNotesDeFraisDuDossier('d1')
    expect(faux.colonnes).toContain('memberships: id, dossier_id, user_id, droit_achats')
    expect([l.lesNotes.complete, l.justificatifs.complete, l.acces.complete]).toEqual([true, true, true])
    faux.refuser = 'memberships'
    const refusee = await lireLesNotesDeFraisDuDossier('d1')
    expect([refusee.lesNotes.complete, refusee.justificatifs.complete, refusee.acces.complete]).toEqual([true, true, false])
    // Une requête qui LÈVE ne fait pas rejeter la lecture : elle tombe du côté signalé, avec son motif.
    faux.refuser = null
    faux.lever = 'memberships'
    const rompue = await lireLesNotesDeFraisDuDossier('d1')
    expect([rompue.lesNotes.complete, rompue.acces.complete, rompue.acces.motif]).toEqual([true, false, 'requête rompue'])
  })
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
