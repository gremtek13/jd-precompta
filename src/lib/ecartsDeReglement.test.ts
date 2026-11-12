import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

// Le drapeau de la migration du change, joué dans ses deux états par un accesseur : baissé par défaut, levé dans les
// blocs qui le disent (CLAUDE.md, « Un drapeau d'export levé garde son état d'avant éprouvé »).
const etat = vi.hoisted(() => ({ leve: false }))
vi.mock('./rolesDuChange', async (original) => ({
  ...(await original<typeof import('./rolesDuChange')>()),
  get ECARTS_DE_REGLEMENT_PREVUS() { return etat.leve },
}))

import {
  autresPaiementsDesReglements, sansLesEcartsDeChange, ecartDuReglement, lignesEngagementAvecEcarts, reglementDuMouvementAvecEcart,
  seRegleSansReecriture,
} from './ecartsDeReglement'
import { lignesEngagementPourPiece } from './engagement'
import { analyserEcritures, calculerBalance, lignesPourPiece, type CibleComptable, type LigneAGenerer } from './ecritures'
import { banquesDuDossier } from './banqueDuMouvement'
import { libelleCompteTenu } from './comptes'
import { libelleCompte } from './fec'
import { racinesDuDirigeantNonAssocieSelon } from './dirigeantAu468'
import { ROLE_DU_PERSONNEL } from './notesDeFrais'
import { PLAN_PAR_DEFAUT, ROLES_COMPTABLES, planDeLaReponse, type PlanComptable } from './planComptable'
import { ROLES_DU_CHANGE } from './rolesDuChange'
import { estParLeReleve, type PaiementDePiece } from './rattachement'
import type { Categorie, EcritureBrouillon } from './types'
import type { ModeleComptable } from './engagement'
import type { Piece } from './types'
import { LIBELLES_PAR_DEFAUT, PREFIXES_PAR_DEFAUT } from '../test/modeles'

afterEach(() => { etat.leve = false })

const ACHATS = '606100'
const VENTES = '706000'
const cible = (compte: string): CibleComptable => ({ compte, immobilisation: false })
// Le plan d'un dossier une fois la migration en base : les trente-deux rôles et les deux du change, à leur défaut.
const PLAN: PlanComptable = { ...PLAN_PAR_DEFAUT, pertes_de_change: '656000', gains_de_change: '756000' }
const BANQUES = banquesDuDossier({ etat: 'sans_objet' }, PLAN)
const ENGAGEMENT: ModeleComptable = { mode: 'engagement', compteNotesDeFrais: '455000', plan: PLAN, libelles: LIBELLES_PAR_DEFAUT, prefixes: PREFIXES_PAR_DEFAUT }
const TRESORERIE: ModeleComptable = { ...ENGAGEMENT, mode: 'tresorerie' }

function piece(o: Partial<Piece> = {}): Piece {
  return {
    id: 'p1', dossier_id: 'd1', uploaded_by: null, source: 'upload', storage_path: 'd1/p1.pdf',
    nom_fichier: 'facture.pdf', storage_hash: null, date_piece: '2026-03-10', tiers: 'Transmedical',
    montant_ht: 100, montant_tva: 20, montant_ttc: 120, devise: 'EUR', montant_devise: null,
    taux_change: null, conversion_source: null, categorie_id: 'c1', sous_dossier_id: null,
    type_piece: 'achat', statut: 'validee', confiance: null, superpdp_invoice_id: null, flux_hote: null, flux_id: null, lisible_path: null,
    identite_numero: null, identite_siren_vendeur: null, identite_date: null, identite_nature: null, facture_id: null, vente_hors_des_factures: false,
    created_at: '2026-03-12T09:00:00Z', updated_at: '2026-03-12T09:00:00Z', ...o,
  }
}
const enDevise = (o: Partial<Piece> = {}) => piece({ devise: 'USD', montant_devise: 1000, taux_change: 0.9, conversion_source: 'bce', montant_ht: 900, montant_tva: 0, montant_ttc: 900, ...o })
const mvt = (id: string, date: string, montant: number) => ({ id, date, montant })
const releve = (...m: { id: string; date: string; montant: number }[]): PaiementDePiece[] => m.map((x) => ({ ...x, origine: 'rapprochement' as const }))

// Le solde d'une écriture (débit − crédit, en centimes) et ce qu'elle porte à un compte.
const solde = (lignes: readonly LigneAGenerer[]) => lignes.reduce((s, l) => s + Math.round(l.montant * 100) * (l.sens === 'debit' ? 1 : -1), 0)
const au = (lignes: readonly LigneAGenerer[], compte: string) => solde(lignes.filter((l) => l.compte === compte))
const du = (lignes: readonly LigneAGenerer[], id: string) => lignes.filter((l) => l.ligne_bancaire_id === id)

describe('ecartDuReglement — ce que le règlement qui solde une facture écrit à part', () => {
  it('en euros, un achat payé plus, sous le seuil : un frais bancaire, sur le dernier paiement', () => {
    expect(ecartDuReglement(piece(), [mvt('l1', '2026-04-05', -120.5)])).toEqual({ mouvementId: 'l1', centimes: 50, nature: 'frais_bancaires' })
    expect(ecartDuReglement(piece({ type_piece: 'vente' }), [mvt('l2', '2026-04-06', 60), mvt('l1', '2026-04-05', 59.8)]))
      .toEqual({ mouvementId: 'l2', centimes: 20, nature: 'frais_bancaires' })
  })
  it('en euros, rien à part : au-delà du seuil (un paiement partiel), en faveur de l’entreprise, sans écart', () => {
    expect(ecartDuReglement(piece(), [mvt('l1', '2026-04-05', -60)])).toBeNull()
    expect(ecartDuReglement(piece(), [mvt('l1', '2026-04-05', -122.41)])).toBeNull() // 2,41 € > min(2 % de 120, 5) = 2,40 €
    expect(ecartDuReglement(piece(), [mvt('l1', '2026-04-05', -122.4)])?.centimes).toBe(240)
    expect(ecartDuReglement(piece(), [mvt('l1', '2026-04-05', -119.5)])).toBeNull()
    expect(ecartDuReglement(piece({ type_piece: 'vente' }), [mvt('l1', '2026-04-05', 120.3)])).toBeNull()
    expect(ecartDuReglement(piece(), [mvt('l1', '2026-04-05', -120)])).toBeNull()
  })
  it('en devise, tout l’écart est de change, sans seuil : une perte au débit, un gain au crédit', () => {
    expect(ecartDuReglement(enDevise(), [mvt('l1', '2026-04-05', -910)])).toEqual({ mouvementId: 'l1', centimes: 1000, nature: 'perte_de_change' })
    expect(ecartDuReglement(enDevise(), [mvt('l1', '2026-04-05', -870)])).toEqual({ mouvementId: 'l1', centimes: -3000, nature: 'gain_de_change' })
    expect(ecartDuReglement(enDevise({ type_piece: 'vente' }), [mvt('l1', '2026-04-05', 920)])).toEqual({ mouvementId: 'l1', centimes: -2000, nature: 'gain_de_change' })
    expect(ecartDuReglement(enDevise({ type_piece: 'vente' }), [mvt('l1', '2026-04-05', 880)])).toEqual({ mouvementId: 'l1', centimes: 2000, nature: 'perte_de_change' })
  })
  it('ni une note de frais, ni une pièce « autre », ni un rejet qui défait tout, ni un paiement dans l’autre sens', () => {
    expect(ecartDuReglement(enDevise({ type_piece: 'note_frais' }), [mvt('l1', '2026-04-05', -910)])).toBeNull()
    expect(ecartDuReglement(enDevise({ type_piece: 'autre' }), [mvt('l1', '2026-04-05', -910)])).toBeNull()
    expect(ecartDuReglement(enDevise(), [mvt('l1', '2026-04-05', -910), mvt('l2', '2026-04-09', 910)])).toBeNull()
    expect(ecartDuReglement(enDevise(), [mvt('l1', '2026-04-05', 910)])).toBeNull()
    // Le rejet puis la reprise : l'écart sur la reprise, le dernier.
    expect(ecartDuReglement(enDevise(), [mvt('l1', '2026-04-05', -910), mvt('l2', '2026-04-09', 910), mvt('l3', '2026-04-20', -905)]))
      .toEqual({ mouvementId: 'l3', centimes: 500, nature: 'perte_de_change' })
  })
})

describe('lignesEngagementAvecEcarts — la facture garde son montant, le tiers se solde, l’écart à part', () => {
  const composer = (p: Piece, m: { id: string; date: string; montant: number }[], plan: PlanComptable = PLAN) =>
    lignesEngagementAvecEcarts('d1', p, cible(p.type_piece === 'vente' ? VENTES : ACHATS), true, '455000', m, plan, BANQUES)

  it('un achat en devise payé 910 € pour 900 € : le 401 soldé à 900, 10 € au 656, la banque à 910', () => {
    const lignes = composer(enDevise(), [mvt('l1', '2026-04-05', -910)])
    expect(du(lignes, 'l1').map((l) => [l.compte, l.sens, l.montant])).toEqual([
      ['401000', 'debit', 900], ['512000', 'credit', 910], ['656000', 'debit', 10],
    ])
    expect(au(lignes, '401000')).toBe(0)
    expect(solde(du(lignes, 'l1'))).toBe(0)
    // La facture : celle d'hier, au cours d'origine.
    expect(lignes.filter((l) => !l.ligne_bancaire_id)).toEqual(lignesEngagementPourPiece('d1', enDevise(), cible(ACHATS), true, '455000', [], PLAN, BANQUES))
  })
  it('une vente en devise reçue 920 € pour 900 € : 20 € au 756 ; en deux paiements, l’écart sur le dernier seul', () => {
    const vente = enDevise({ type_piece: 'vente' })
    expect(du(composer(vente, [mvt('l1', '2026-04-05', 920)]), 'l1').map((l) => [l.compte, l.sens, l.montant]))
      .toEqual([['411000', 'credit', 900], ['512000', 'debit', 920], ['756000', 'credit', 20]])
    const deux = composer(vente, [mvt('l2', '2026-05-02', 470), mvt('l1', '2026-04-05', 450)])
    expect(du(deux, 'l1').map((l) => l.compte)).toEqual(['411000', '512000'])
    expect(du(deux, 'l2').map((l) => [l.compte, l.sens, l.montant])).toEqual([['411000', 'credit', 450], ['512000', 'debit', 470], ['756000', 'credit', 20]])
    expect(au(deux, '411000')).toBe(0)
  })
  it('un achat en euros payé 0,50 € de plus : 627 ; un paiement partiel reste au 401, comme hier', () => {
    expect(du(composer(piece(), [mvt('l1', '2026-04-05', -120.5)]), 'l1').map((l) => [l.compte, l.sens, l.montant]))
      .toEqual([['401000', 'debit', 120], ['512000', 'credit', 120.5], ['627000', 'debit', 0.5]])
    const partiel = [mvt('l1', '2026-04-05', -60)]
    expect(composer(piece(), partiel)).toEqual(lignesEngagementPourPiece('d1', piece(), cible(ACHATS), true, '455000', partiel, PLAN, BANQUES))
  })
  it('un compte du change que le plan ne porte pas retient la pièce entière ; le frais, lui, a son rôle depuis VF2', () => {
    expect(composer(enDevise(), [mvt('l1', '2026-04-05', -910)], PLAN_PAR_DEFAUT)).toEqual([])
    expect(composer(piece(), [mvt('l1', '2026-04-05', -120.5)], PLAN_PAR_DEFAUT).some((l) => l.compte === '627000')).toBe(true)
  })
  it('le règlement d’un mouvement écrit au rapprochement : l’écart s’il est le dernier, lu aux banques des autres', () => {
    const autres = autresPaiementsDesReglements([
      { compte: '512000', ligne_bancaire_id: 'l1', sens: 'credit', montant: 450, date: '2026-04-05' },
      { compte: '401000', ligne_bancaire_id: 'l1', sens: 'debit', montant: 450, date: '2026-04-05' },
      { compte: '606100', ligne_bancaire_id: null, sens: 'debit', montant: 900, date: '2026-03-10' },
    ], new Set(['512000']), 'l2')
    expect(autres).toEqual([{ id: 'l1', date: '2026-04-05', montant: -450 }])
    const l2 = reglementDuMouvementAvecEcart('d1', enDevise(), mvt('l2', '2026-05-02', -460), autres, '455000', false, PLAN)
    expect(l2.map((l) => [l.compte, l.sens, l.montant])).toEqual([['401000', 'debit', 450], ['512000', 'credit', 460], ['656000', 'debit', 10]])
    const avant = reglementDuMouvementAvecEcart('d1', enDevise(), mvt('l0', '2026-03-30', -460), autres, '455000', false, PLAN)
    expect(avant.map((l) => l.compte)).toEqual(['401000', '512000'])
  })
})

describe('le drapeau baissé, rien ne change ; levé, l’engagement seul change', () => {
  const devise = enDevise()
  const payee = releve(mvt('l1', '2026-04-05', -910))
  it('la trésorerie compose la même écriture dans les deux états', () => {
    const baisse = lignesPourPiece('d1', devise, cible(ACHATS), true, payee, TRESORERIE, BANQUES)
    etat.leve = true
    expect(lignesPourPiece('d1', devise, cible(ACHATS), true, payee, TRESORERIE, BANQUES)).toEqual(baisse)
    expect(seRegleSansReecriture(devise, 'tresorerie')).toBe(false)
  })
  it('l’engagement : hier drapeau baissé, l’écart à part drapeau levé ; la pièce ne se règle plus sur la banque', () => {
    expect(lignesPourPiece('d1', devise, cible(ACHATS), true, payee, ENGAGEMENT, BANQUES))
      .toEqual(lignesEngagementPourPiece('d1', devise, cible(ACHATS), true, '455000', payee.filter(estParLeReleve), PLAN, BANQUES))
    expect(seRegleSansReecriture(devise, 'engagement')).toBe(false)
    etat.leve = true
    expect(lignesPourPiece('d1', devise, cible(ACHATS), true, payee, ENGAGEMENT, BANQUES).some((l) => l.compte === '656000')).toBe(true)
    expect(seRegleSansReecriture(devise, 'engagement')).toBe(true)
    expect(seRegleSansReecriture({ type_piece: 'note_frais' }, 'engagement')).toBe(false)
  })
  it('le contrôle « à régénérer » se tait sur la composition, et dit un écart resté sur un règlement qui ne solde plus', () => {
    etat.leve = true
    const enBase = (lignes: readonly LigneAGenerer[]): EcritureBrouillon[] => lignes.map((l, i) => ({
      id: `g${i}`, dossier_id: l.dossier_id, piece_id: l.piece_id, ligne_bancaire_id: l.ligne_bancaire_id ?? null, date: l.date,
      compte: l.compte, libelle: l.libelle, montant: l.montant, sens: l.sens, statut: 'proposee', created_at: '2026-05-03T09:00:00Z',
      immobilisation_id: null, vehicule_id: null, declaration_tva_id: null, cotisation_id: null, encaissement_id: null,
      facture_id: null, valide_le: null, journal_code: null, numero_ecriture: null, piece_ref: null, piece_date: null,
      compte_lib: null, comp_aux_num: null, comp_aux_lib: null, operation_caisse_id: null,
      date_reglement: null, mode_reglement: null, nature_operation: null, poste_rattache: null, identification_client: null,
    }))
    const analyser = (lignes: EcritureBrouillon[], paiements: PaiementDePiece[]) => analyserEcritures(lignes,
      [{ piece: devise, compte: ACHATS, immobilisation: false }], true, new Map([[devise.id, paiements]]), ENGAGEMENT, null,
      new Set(), BANQUES).piecesDesynchronisees
    expect(analyser(enBase(lignesPourPiece('d1', devise, cible(ACHATS), true, payee, ENGAGEMENT, BANQUES)), payee)).toEqual([])
    // Écrit quand l1 soldait la pièce ; un second paiement, plus récent, est venu depuis : à régénérer.
    const deux = releve(mvt('l1', '2026-04-05', -450), mvt('l2', '2026-05-02', -460))
    const ancien = lignesEngagementAvecEcarts('d1', devise, cible(ACHATS), true, '455000', [mvt('l1', '2026-04-05', -450)], PLAN, BANQUES)
    const l2 = reglementDuMouvementAvecEcart('d1', devise, mvt('l2', '2026-05-02', -460), [mvt('l1', '2026-04-05', -450)], '455000', false, PLAN)
    expect(analyser(enBase([...ancien, ...l2]), deux)).toEqual([devise])
    expect(analyser(enBase(lignesPourPiece('d1', devise, cible(ACHATS), true, deux, ENGAGEMENT, BANQUES)), deux)).toEqual([])
  })
})

describe('la lecture du plan et les deux rôles du change', () => {
  const ligne = (role: string, compte: string, libelle: string | null = 'x', prefixe: string | null = null) =>
    ({ role, compte, libelle, prefixe_auxiliaire: prefixe })
  const catalogue = ROLES_COMPTABLES.map((r) => ligne(r.role, r.compteDefaut, r.libelleDefaut, r.prefixeAuxiliaireDefaut))
  const avecChange = (pertes = '656000', gains = '756000') => [...catalogue, ligne('pertes_de_change', pertes), ligne('gains_de_change', gains)]

  it('drapeau baissé : ignorés, présents ou non — la lecture d’hier', () => {
    const hier = planDeLaReponse({ data: catalogue, error: null })
    expect(hier.motif).toBeNull()
    expect(planDeLaReponse({ data: avecChange(), error: null })).toEqual(hier)
  })
  it('drapeau levé : exigés, sous une de leurs racines (656 ou 666, 756 ou 766), sans préfixe', () => {
    etat.leve = true
    expect(planDeLaReponse({ data: catalogue, error: null }).motif)
      .toBe('plan comptable incomplet : 2 rôle(s) du change absent(s) (pertes_de_change, gains_de_change)')
    expect(planDeLaReponse({ data: avecChange('666100', '766100'), error: null }).plan).toMatchObject({ pertes_de_change: '666100', gains_de_change: '766100' })
    expect(planDeLaReponse({ data: avecChange('657000'), error: null }).motif).toBe('plan comptable illisible : « 657000 » n’est pas un compte du rôle « pertes_de_change »')
    expect(planDeLaReponse({ data: [...catalogue, ligne('pertes_de_change', '656000', 'x', 'PC'), ligne('gains_de_change', '756000')], error: null }).motif)
      .toBe('plan comptable illisible : « PC » n’est pas un préfixe d’auxiliaire du rôle « pertes_de_change »')
  })
  it('la migration préparée porte les deux rôles tels que l’application les lit', () => {
    const migration = readFileSync(new URL('../../supabase/preparees/20261112170000_ecarts_de_reglement.sql', import.meta.url), 'utf8')
    for (const r of ROLES_DU_CHANGE) {
      expect(migration).toContain(`('${r.role}', array['${r.racines.join("', '")}'], '${r.compteDefaut}', '${r.libelleDefaut}', null, ${r.ordre})`)
    }
  })
})

// supabase/essais/planComptable.sql compte les rôles du catalogue et en prend l'empreinte : la migration appliquée, deux rôles
// de plus, et quatre empreintes de plus (avec ou sans le 468 de PC4-Q2, avec ou sans le personnel de B7), que l'essai épingle
// et que ce test recalcule de `ROLES_COMPTABLES`, `ROLE_DU_PERSONNEL` et `ROLES_DU_CHANGE`, à la recette du contrôle 1.
describe('l’essai du plan comptable, la migration du change appliquée', () => {
  const ESSAI_DU_PLAN = readFileSync(new URL('../../supabase/essais/planComptable.sql', import.meta.url), 'utf8')
  const ligne = (r: { role: string; racines: readonly string[]; compteDefaut: string; libelleDefaut: string | null; prefixeAuxiliaireDefaut: string | null; ordre: number }, au468: boolean) =>
    [r.role, (r.role === 'autres_debiteurs_crediteurs' ? racinesDuDirigeantNonAssocieSelon(au468) : r.racines).join(','), r.compteDefaut,
      r.libelleDefaut ?? '', r.prefixeAuxiliaireDefaut ?? '', String(r.ordre)].join('|')

  it('épingle les quatre empreintes du catalogue qui porte les deux rôles du change', () => {
    for (const [au468, personnel, nom] of [
      [false, false, 'empreinte_catalogue_change'], [false, true, 'empreinte_catalogue_personnel_change'],
      [true, false, 'empreinte_catalogue_468_change'], [true, true, 'empreinte_catalogue_468_personnel_change'],
    ] as const) {
      const epinglee = new RegExp(`${nom} constant text := '([0-9a-f]{32})'`).exec(ESSAI_DU_PLAN)?.[1]
      const roles = [...ROLES_COMPTABLES, ...(personnel ? [ROLE_DU_PERSONNEL] : []), ...ROLES_DU_CHANGE]
      expect(createHash('md5').update(roles.map((r) => ligne(r, au468)).join('\n'), 'utf8').digest('hex'), nom).toBe(epinglee)
    }
  })
  it('lit l’historique de la migration, compte deux rôles de plus, et donne leurs comptes décalés au plan entier', () => {
    expect(ESSAI_DU_PLAN).toContain("m.name = 'ecarts_de_reglement'")
    expect(ESSAI_DU_PLAN).toContain('roles_du_catalogue constant int := 32 + case when au_personnel then 1 else 0 end + case when au_change then 2 else 0 end;')
    expect(ESSAI_DU_PLAN).toContain("values (dossier_libre, 'pertes_de_change', '656100', null), (dossier_libre, 'gains_de_change', '756100', null);")
  })
})

// LE LIBELLÉ DES COMPTES DU CHANGE dans la balance, le FEC (CompteLib), la révision et le lettrage (`libelleCompteTenu`) : le
// drapeau levé, tenus comme les comptes des autres rôles — l'intitulé du PCG ; baissé, rien ne change, et une catégorie qui
// porterait l'un d'eux garde son nom. La piste d'audit ne nomme pas les comptes.
describe('le libellé des comptes du change', () => {
  const PERTES = 'Pertes de change sur créances et dettes commerciales'
  const categorie = { id: 'c1', libelle: 'Écarts divers', compte_comptable: '656000', poste_2035: null } as Categorie
  const ligne = (compte: string, sens: 'debit' | 'credit') =>
    ({ id: `e-${compte}`, piece_id: 'p1', date: '2025-04-02', compte, libelle: 'x', sens, montant: 3.45, statut: 'proposee', ligne_bancaire_id: 'l1' }) as EcritureBrouillon
  const libellesDeLaBalance = () => Object.fromEntries(calculerBalance([ligne('656000', 'debit'), ligne('512000', 'credit')], [categorie], [])
    .map((l) => [l.compte, l.libelle]))

  it('drapeau baissé : aucun libellé tenu, la catégorie nomme le 656000, comme hier', () => {
    for (const compte of ['656000', '756000', '666000', '766000']) expect(libelleCompteTenu(compte), compte).toBeNull()
    expect(libelleCompte('656000', [categorie])).toBe('Écarts divers')
    expect(libelleCompte('756000', [])).toBe('756000')
    expect(libellesDeLaBalance()['656000']).toBe('Écarts divers')
  })
  it('drapeau levé : l’intitulé du PCG, devant la catégorie, dans la balance et le FEC', () => {
    etat.leve = true
    expect(libelleCompteTenu('656000')).toBe(PERTES)
    expect(libelleCompteTenu('756000')).toBe('Gains de change sur créances et dettes commerciales')
    expect(libelleCompteTenu('666000')).toBe('Pertes de change financières')
    expect(libelleCompteTenu('766000')).toBe('Gains de change financiers')
    expect(libelleCompteTenu('656100')).toBeNull()
    expect(libelleCompte('656000', [categorie])).toBe(PERTES)
    expect(libellesDeLaBalance()['656000']).toBe(PERTES)
    // Le libellé du catalogue, celui que la migration insère : un seul texte.
    expect(ROLES_DU_CHANGE.map((r) => libelleCompteTenu(r.compteDefaut))).toEqual(ROLES_DU_CHANGE.map((r) => r.libelleDefaut))
  })
})

// LA CHECKLIST, LES PRÉALABLES ET BANQUE (« pièce payée plus que son montant ») : le drapeau levé, une facture en devise
// d'un dossier en engagement garde son montant, et l'excédent que le change explique n'est pas un paiement en double.
describe('sansLesEcartsDeChange — la pièce « payée en trop » que le change explique', () => {
  const enTrop = (o: Partial<Piece>, montant: number) => ({ piece: piece(o), paye: 0, enTrop: montant })
  const liste = [
    enTrop({ id: 'usd', devise: 'USD', montant_ttc: 120 }, 5),
    enTrop({ id: 'usd-double', devise: 'USD', montant_ttc: 120 }, 120),
    enTrop({ id: 'eur', montant_ttc: 120 }, 5),
    enTrop({ id: 'note', devise: 'USD', type_piece: 'note_frais', montant_ttc: 120 }, 5),
  ]
  it('drapeau baissé : la liste telle quelle, dans les deux modèles', () => {
    expect(sansLesEcartsDeChange(liste, 'engagement')).toEqual(liste)
    expect(sansLesEcartsDeChange(liste, 'tresorerie')).toEqual(liste)
  })
  it('drapeau levé : en engagement, la facture en devise sous 5 % se retire ; le double, l’euro, la note restent ; la trésorerie ne change pas', () => {
    etat.leve = true
    expect(sansLesEcartsDeChange(liste, 'engagement').map((x) => x.piece.id)).toEqual(['usd-double', 'eur', 'note'])
    expect(sansLesEcartsDeChange([enTrop({ id: 'borne', devise: 'USD', montant_ttc: 120 }, 6)], 'engagement')).toHaveLength(0)
    expect(sansLesEcartsDeChange([enTrop({ id: 'borne', devise: 'USD', montant_ttc: 120 }, 6.01)], 'engagement')).toHaveLength(1)
    expect(sansLesEcartsDeChange([enTrop({ id: 'borne', devise: 'USD', montant_ttc: 120 }, 5.99)], 'engagement')).toHaveLength(0)
    expect(sansLesEcartsDeChange(liste, 'tresorerie')).toEqual(liste)
  })
})
