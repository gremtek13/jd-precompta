import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lireLesAcomptesDesDevis } from './acomptesDuDevisLecture'
import { fauxTables, poserLesTables, tablesDuDossier } from '../test/acomptesFactures'

// LA LECTURE DES ACOMPTES DES DEVIS (lib/acomptesDuDevisLecture.ts, étape P5b5a). Le drapeau `ACOMPTES_PREVUS`
// (src/lib/devis.ts) se joue dans ses deux états : baissé, rien n'est lu ; levé, les liens avec leur rôle, les factures avec
// leur marque, les lignes des acomptes validés et le modèle comptable — une valeur qui n'a pas la forme de sa colonne est
// illisible, jamais un « non ». Le faux client APPLIQUE les filtres et ne rend que les colonnes demandées
// (src/test/acomptesFactures.ts). Données FICTIVES.
const drapeau = vi.hoisted(() => ({ acomptes: false }))
vi.mock('./devis', async (importOriginal) => {
  const vrai = await importOriginal<typeof import('./devis')>()
  return { ...vrai, get ACOMPTES_PREVUS() { return drapeau.acomptes } }
})
vi.mock('./supabase', async () => ({ supabase: (await import('../test/acomptesFactures')).fauxClient }))

function tables() {
  const t = tablesDuDossier()
  t.factures_emises = t.factures_emises.map((f) => ({ montant_ttc: f.type === 'avoir' ? -360 : 360, ...f }))
  t.devis_factures = t.devis_factures.map((l, i) => ({ cree_le: `2026-10-0${i + 1}T08:00:00Z`, ...l }))
  t.facture_lignes = t.facture_lignes.map((l) => ({ nature: null, ...l }))
  t.dossiers = [{ id: 'd1', mode_comptable: 'tresorerie' }]
  return t
}

beforeEach(() => {
  drapeau.acomptes = false
  poserLesTables(tables())
})

describe('lireLesAcomptesDesDevis', () => {
  it('le drapeau baissé : rien n’est lu', async () => {
    expect(await lireLesAcomptesDesDevis('d1')).toEqual({ dossierId: 'd1', etat: 'sans' })
    expect(fauxTables.demandes).toEqual([])
  })

  it('le drapeau levé, lu à l’appel : les liens et leur rôle, les factures et leur marque, les lignes des seuls acomptes validés', async () => {
    drapeau.acomptes = true
    const lu = await lireLesAcomptesDesDevis('d1')
    if (lu.etat !== 'lue') throw new Error(lu.etat === 'illisible' ? lu.motif : 'sans')
    expect(lu.mode).toBe('tresorerie')
    expect(lu.liens.map((l) => [l.facture_id, l.role])).toEqual([['a1', 'acompte'], ['a2', 'acompte'], ['fin', 'finale']])
    expect(lu.factures.find((f) => f.id === 'a1')).toMatchObject({ acompte: true, statut: 'validee', numero: 'F2026-0003' })
    expect([...new Set(lu.lignes.map((l) => l.facture_id))].sort()).toEqual(['a1', 'a2'])
    expect(fauxTables.demandes).toContain('devis_factures: id, dossier_id, devis_id, facture_id, cree_le, role')
  })

  it.each([
    ['un rôle inconnu', (t: ReturnType<typeof tables>) => { t.devis_factures[0].role = 'autre' }, 'le rôle du lien'],
    ['un rôle absent (la colonne inconnue)', (t: ReturnType<typeof tables>) => { delete t.devis_factures[0].role }, 'le rôle du lien'],
    ['une marque qui n’est pas un booléen', (t: ReturnType<typeof tables>) => { t.factures_emises[0].acompte = null }, 'la marque d’acompte'],
    ['un modèle comptable inconnu', (t: ReturnType<typeof tables>) => { t.dossiers[0].mode_comptable = null }, 'le modèle comptable'],
  ])('%s : illisible, jamais un « non »', async (_nom, abimer, motif) => {
    drapeau.acomptes = true
    const t = tables()
    abimer(t)
    poserLesTables(t)
    const lu = await lireLesAcomptesDesDevis('d1')
    expect(lu.etat).toBe('illisible')
    expect(lu.etat === 'illisible' && lu.motif).toContain(motif)
  })

  it('une table refusée (la colonne de la marque inconnue) : illisible avec son motif, jamais rejetée', async () => {
    drapeau.acomptes = true
    poserLesTables(tables(), { factures_emises: 'column acompte does not exist' })
    const refus = await lireLesAcomptesDesDevis('d1')
    expect(refus).toMatchObject({ etat: 'illisible' })
    expect(refus.etat === 'illisible' && refus.motif).toContain('column acompte does not exist')
  })
})
