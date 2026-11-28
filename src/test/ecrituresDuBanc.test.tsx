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

// LA SECONDE PASSE (28/11/2026) : les fonctions de la vente, de la caisse, de l'onglet Informations et de l'assurance maladie, et ce
// que le levier sème (les comptes bancaires lus de leur table, `mentions_identite`, `mode_reglement`).
describe('la seconde passe du banc, sous le levier `banc-ecritures`', () => {
  const facture = async (id: string) => (await banc.from('factures_emises').select('*').eq('id', id).maybeSingle()).data as Ligne | null
  const lignesDe = async (id: string) => (await banc.from('facture_lignes').select('*').eq('facture_id', id)).data as Ligne[]

  it('valide une facture du cabinet dans la série du mandataire, fige ses mentions, et numérote son avoir dans la sienne', async () => {
    localStorage.setItem('banc-ecritures', '1')
    const entete = { tiers_nom: 'Client fictif', date_emission: '2026-11-02', montant_ht: 300, montant_tva: 60, montant_ttc: 360 }
    const ligne = { designation: 'Conseil fictif', quantite: 2, prix_unitaire_ht: 150, taux_tva: 20 }
    const brouillon = await banc.rpc('enregistrer_facture', { p_dossier_id: 'd7', p_facture_id: null, p_facture: entete, p_lignes: [ligne], p_valider: false })
    const [{ facture_id: id, numero }] = brouillon.data as { facture_id: string; numero: string | null }[]
    expect(numero).toBeNull()
    expect(await facture(id)).toEqual(expect.objectContaining({ statut: 'brouillon', numero: null, dossier_id: 'd7' }))
    expect(await lignesDe(id)).toEqual([expect.objectContaining({ designation: 'Conseil fictif', ordre: 1 })])
    const validee = await banc.rpc('enregistrer_facture', { p_dossier_id: 'd7', p_facture_id: id, p_facture: entete, p_lignes: [ligne], p_valider: true })
    expect((validee.data as { numero: string }[])[0].numero).toBe('M2026-0001')
    expect(await facture(id)).toEqual(expect.objectContaining({
      statut: 'validee', mentions_figees: true, statut_tva: 'redevable', denomination_imprimee: 'ATELIER BERNARD CONSEIL', mandataire_nom: 'JD Consult',
    }))
    expect(await lignesDe(id)).toHaveLength(1)
    const avoir = await banc.rpc('enregistrer_facture', {
      p_dossier_id: 'd7', p_facture_id: null, p_valider: true,
      p_facture: { type: 'avoir', facture_origine_id: id, date_emission: '2026-11-03', montant_ht: -300, montant_tva: -60, montant_ttc: -360 },
      p_lignes: [{ ...ligne, quantite: -2 }],
    })
    const [{ facture_id: idAvoir, numero: numeroAvoir }] = avoir.data as { facture_id: string; numero: string }[]
    expect(numeroAvoir).toBe('MA2026-0001')
    expect(await facture(idAvoir)).toEqual(expect.objectContaining({ type: 'avoir', facture_origine_id: id, tiers_nom: 'Client fictif' }))
  })

  it('contre-passe un encaissement montant pour montant, ses parts opposées, et le cite', async () => {
    localStorage.setItem('banc-ecritures', '1')
    const { data: id } = await banc.rpc('annuler_encaissement', { p_dossier_id: 'd7', p_encaissement_id: 'enc2', p_date: '2026-10-15', p_motif: 'Rendu' })
    const ecrit = (await banc.from('encaissements_factures').select('*').eq('id', id)).data as Ligne[]
    expect(ecrit[0]).toEqual(expect.objectContaining({ annule_id: 'enc2', montant: -1000, date_encaissement: '2026-10-15', motif: 'Rendu' }))
    const parts = (await banc.from('encaissements_factures_taux').select('*').eq('encaissement_id', id)).data as Ligne[]
    const partsDOrigine = (await banc.from('encaissements_factures_taux').select('*').eq('encaissement_id', 'enc2')).data as Ligne[]
    expect(parts.map((p) => p.montant)).toEqual(partsDOrigine.map((p) => -Number(p.montant)))
  })

  it('tire d’un devis accepté son acompte par le module de l’application, puis la finale qui reprend l’acompte validé', async () => {
    localStorage.setItem('banc-ecritures', '1')
    await banc.rpc('decider_devis', { p_dossier_id: 'd1', p_devis_id: 'dv-banc-1', p_reponse: 'acceptee', p_date: '2026-11-02', p_hors_validite: true })
    const { data: acompte } = await banc.rpc('facturer_acompte_devis', {
      p_dossier_id: 'd1', p_devis_id: 'dv-banc-1', p_demande: { mode: 'pourcentage', pourcentage: 30 }, p_date_versement: null,
    })
    expect(await facture(String(acompte))).toEqual(expect.objectContaining({ statut: 'brouillon', acompte: true, montant_ttc: 819 }))
    const liens = (await banc.from('devis_factures').select('*').eq('devis_id', 'dv-banc-1')).data as Ligne[]
    expect(liens).toEqual([expect.objectContaining({ role: 'acompte', facture_id: acompte, id: expect.any(String) })])
    await banc.rpc('enregistrer_facture', { p_dossier_id: 'd1', p_facture_id: acompte, p_facture: {}, p_lignes: await lignesDe(String(acompte)), p_valider: true })
    const { data: finale } = await banc.rpc('facturer_devis', { p_dossier_id: 'd1', p_devis_id: 'dv-banc-1' })
    const reprise = (await lignesDe(String(finale))).filter((l) => l.reprise_facture_id === acompte)
    expect(reprise).toEqual([expect.objectContaining({ quantite: -1, prix_unitaire_ht: 819 })])
  })

  it('sème les comptes bancaires dans leur table : un compte ajouté se relit, puis se retire', async () => {
    localStorage.setItem('banc-ecritures', '1')
    const comptes = async () => (await banc.from('comptes_bancaires').select('*').eq('dossier_id', 'd1')).data as Ligne[]
    expect((await comptes()).map((c) => c.id)).toEqual(['cb-d1-1'])
    const { data } = await banc.from('comptes_bancaires').insert({ dossier_id: 'd1', libelle: 'Livret fictif', principal: false }).select('id').maybeSingle()
    expect((await comptes()).map((c) => c.libelle)).toEqual(['Compte courant professionnel', 'Livret fictif'])
    await banc.from('comptes_bancaires').delete().eq('id', (data as Ligne).id).eq('dossier_id', 'd1')
    expect(await comptes()).toHaveLength(1)
    // Les colonnes que le banc ne servait pas, semées nulles ; d6 reste sans aucune colonne de l'identité.
    expect((await mouvement('l12'))?.mode_reglement).toBeNull()
    const d6 = (await banc.from('dossiers').select('*').eq('id', 'd6').maybeSingle()).data as Ligne
    expect('mentions_identite' in d6).toBe(false)
  })

  it('remplace une opération de caisse en retirant l’ancienne, et règle un seuil sans compter le seuil pour des lignes', async () => {
    localStorage.setItem('banc-ecritures', '1')
    const { data: neuve } = await banc.rpc('remplacer_operation_caisse', {
      p_dossier_id: 'd1', p_operation_id: 'oc7', p_genre: 'recette', p_date: '2026-09-19', p_montant: 61.5, p_categorie_id: 'c9', p_ecritures: [],
    })
    const operations = (await banc.from('operations_caisse').select('*').eq('dossier_id', 'd1')).data as Ligne[]
    expect(operations.find((o) => o.id === 'oc7')?.retire_le).toEqual(expect.any(String))
    expect(neuve).toEqual(expect.objectContaining({ remplace_id: 'oc7', montant: 61.5, retire_le: null }))
    expect((await banc.rpc('regler_seuil_du_chiffre_d_affaires', { p_dossier_id: 'd1', p_sens: 'hausse', p_seuil_lu: null, p_seuil: 20 })).data).toBe(20)
    expect(journal().at(-1)).toEqual(expect.objectContaining({ genre: 'rpc regler_seuil_du_chiffre_d_affaires', lignes: 1 }))
  })

  it('n’imite aucun envoi d’e-mail sans le levier, et joue son refus comme une fonction qui répond 400', async () => {
    const fonctions = (supabase as unknown as { functions: { invoke: (nom: string, o: object) => Promise<Rendu> } }).functions
    expect((await fonctions.invoke('send-email', { body: {} })).error).toEqual({ message: 'maquette' })
    localStorage.setItem('banc-ecritures', '1')
    expect((await fonctions.invoke('send-email', { body: {} })).data).toEqual({ ok: true })
    localStorage.setItem('banc-ecritures-refus', 'send-email')
    const refus = await fonctions.invoke('send-email', { body: {} })
    expect((refus.error as { context: Response }).context.status).toBe(400)
  })
})
