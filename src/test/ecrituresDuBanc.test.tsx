// LES ÉCRITURES TENUES EN MÉMOIRE DU BANC (outils/captures/fauxSupabase.ts, levier `banc-ecritures`, 28/11/2026) : sans le levier, le
// faux répond comme hier — une écriture ne change rien, les visites de debordements.mjs mesurent les mêmes écrans ; sous lui,
// `insert`, `update`, `upsert` et `delete` s'appliquent aux lignes servies et rendent ce qu'ils ont écrit, les fonctions des gestes
// imitent leur effet, un refus joué rend son erreur sans rien écrire, et un filtre que le banc ne tient pas se nomme au journal.
// Dans le projet « écrans » : le faux lit ses leviers dans `localStorage`, que jsdom porte.
import { afterEach, describe, expect, it } from 'vitest'
import { supabase } from '../../outils/captures/fauxSupabase'

type Rendu = { data: unknown; error: unknown; count?: number | null }
interface Requete extends PromiseLike<Rendu> {
  select(colonnes?: string, options?: object): Requete
  insert(valeurs: unknown, options?: object): Requete
  update(valeurs: unknown, options?: object): Requete
  upsert(valeurs: unknown, options?: object): Requete
  delete(options?: object): Requete
  eq(colonne: string, valeur: unknown): Requete
  in(colonne: string, valeurs: unknown[]): Requete
  or(filtre: string): Requete
  maybeSingle(): Requete
}
const banc = supabase as unknown as { from: (table: string) => Requete; rpc: (nom: string, args: object) => Promise<Rendu> }
type Ligne = Record<string, unknown>
const journal = () => (window as unknown as { __ecrituresDuBanc: { genre: string; table: string; lignes: number; filtresNonTenus: string[] }[] }).__ecrituresDuBanc

const mouvement = async (id: string) => (await banc.from('lignes_bancaires').select('*').eq('id', id).maybeSingle()).data as Ligne | null

afterEach(() => localStorage.clear())

describe('le faux Supabase du banc, sans le levier `banc-ecritures`', () => {
  it('ne change rien sur une écriture, et la chaîne rend ce que la lecture rendrait (les visites d’hier)', async () => {
    const avant = await mouvement('l11')
    expect(avant?.statut).toBe('non_rapprochee')
    const rendu = await banc.from('lignes_bancaires').update({ statut: 'ignoree' }).eq('id', 'l11').select('id').maybeSingle()
    expect((rendu.data as Ligne | null)?.id).toBe('l11')
    expect((await mouvement('l11'))?.statut).toBe('non_rapprochee')
    expect((await banc.rpc('affecter_mouvement_bancaire', { p_ligne_bancaire_id: 'l11', p_categorie_id: 'c10', p_ecritures: [] })).data).toBe(false)
  })
})

describe('le faux Supabase du banc, sous le levier `banc-ecritures`', () => {
  it('applique une mise à jour, rend la ligne écrite et son compte, et la relecture la voit', async () => {
    localStorage.setItem('banc-ecritures', '1')
    const rendu = await banc.from('lignes_bancaires').update({ statut: 'ignoree', piece_id: null }, { count: 'exact' })
      .eq('id', 'l12').eq('statut', 'non_rapprochee')
    expect(rendu.count).toBe(1)
    expect((await mouvement('l12'))?.statut).toBe('ignoree')
    // La même mise à jour rejouée ne trouve plus la ligne « à traiter » : zéro ligne, comme la base.
    const encore = await banc.from('lignes_bancaires').update({ statut: 'ignoree' }).eq('id', 'l12').eq('statut', 'non_rapprochee').select('id').maybeSingle()
    expect(encore.data).toBeNull()
  })

  it('insère une ligne à la forme de la table, et un upsert remplace sur sa clé de conflit au lieu de doubler', async () => {
    localStorage.setItem('banc-ecritures', '1')
    const inseree = await banc.from('lignes_bancaires').insert({ dossier_id: 'd1', date: '2026-10-02', libelle: 'VIR ESSAI DU BANC', montant: 12, statut: 'non_rapprochee' }).select('*').maybeSingle()
    const ligne = inseree.data as Ligne
    expect(typeof ligne.id).toBe('string')
    expect(ligne.prelevement_personnel).toBe(false)
    expect(ligne.compte_bancaire_id).toBe('cb-d1-1')
    const controle = { dossier_id: 'd1', source_fichier: 'essai.csv', solde_initial: 1, solde_final: 2, coherent: false }
    await banc.from('controles_releves_bancaires').upsert(controle, { onConflict: 'dossier_id,source_fichier' })
    await banc.from('controles_releves_bancaires').upsert({ ...controle, coherent: true }, { onConflict: 'dossier_id,source_fichier' })
    const lus = (await banc.from('controles_releves_bancaires').select('*').eq('source_fichier', 'essai.csv')).data as Ligne[]
    expect(lus).toHaveLength(1)
    expect(lus[0].coherent).toBe(true)
    await banc.from('lignes_bancaires').delete().eq('id', ligne.id)
    expect(await mouvement(String(ligne.id))).toBeNull()
  })

  it('imite l’effet d’« Affecter » et de son retrait : le mouvement rapproché, son brouillon propre remplacé puis retiré', async () => {
    localStorage.setItem('banc-ecritures', '1')
    const ecritures = [{ compte: '512000', sens: 'debit', montant: 15, libelle: 'x' }, { compte: '706000', sens: 'credit', montant: 15, libelle: 'x' }]
    expect((await banc.rpc('affecter_mouvement_bancaire', { p_ligne_bancaire_id: 'l11', p_categorie_id: 'c10', p_ecritures: ecritures, p_taux_tva: null })).data).toBe(2)
    expect(await mouvement('l11')).toEqual(expect.objectContaining({ statut: 'rapprochee', categorie_id: 'c10' }))
    const brouillon = async () => (await banc.from('ecritures_brouillon').select('*').eq('ligne_bancaire_id', 'l11')).data as Ligne[]
    expect(await brouillon()).toHaveLength(2)
    await banc.rpc('retirer_affectation_mouvement_bancaire', { p_ligne_bancaire_id: 'l11' })
    expect(await mouvement('l11')).toEqual(expect.objectContaining({ statut: 'non_rapprochee', categorie_id: null }))
    expect(await brouillon()).toHaveLength(0)
  })

  it('joue un refus sans rien écrire, et nomme au journal un filtre qu’il ne sait pas appliquer', async () => {
    localStorage.setItem('banc-ecritures', '1')
    localStorage.setItem('banc-ecritures-refus', 'lignes_bancaires,affecter_mouvement_bancaire')
    const refus = await banc.from('lignes_bancaires').update({ statut: 'ignoree' }).eq('id', 'l1')
    expect((refus.error as { code: string }).code).toBe('P0001')
    expect((await mouvement('l1'))?.statut).toBe('non_rapprochee')
    expect((await banc.rpc('affecter_mouvement_bancaire', { p_ligne_bancaire_id: 'l1', p_categorie_id: 'c10', p_ecritures: [] })).error).toBeTruthy()
    localStorage.removeItem('banc-ecritures-refus')
    await banc.from('pieces').update({ statut: 'validee' }).or('id.eq.p1,id.eq.p2')
    expect(journal().at(-1)).toEqual(expect.objectContaining({ genre: 'update', table: 'pieces', filtresNonTenus: ['or("id.eq.p1,id.eq.p2")'] }))
  })
})
