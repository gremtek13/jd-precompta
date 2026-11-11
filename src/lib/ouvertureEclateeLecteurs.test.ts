import { describe, expect, it } from 'vitest'
import { banquesDuDossier, type BanquesDuDossier } from './banqueDuMouvement'
import { rendreLesBanquesAuFec } from './banquesAuFec'
import { OPERATIONS_DE_CAISSE_ABSENTES } from './controlesDeLaCaisse'
import { CHAMPS_BNC_NON_EXPORTES, formaterFec, genererFec, numeroterFec, referenceDeLOuvertureEclatee } from './fec'
import type { CompteDuReleve } from './importParCompte'
import {
  argumentsDeLEclatement, carteDeLEclatement, confirmationDeLEclatement, eclatementAFaire, phraseDeLEclatement,
  type LectureDuReleveDeLOuverture,
} from './ouvertureEclatee'
import { absenceFec, pisteAudit, rupturesPisteAudit } from './pisteAudit'
import { PLAN_PAR_DEFAUT } from './planComptable'
import type { EcritureBrouillon } from './types'
import { defautsDeNumerotation } from './validationExercice'
import { anomaliesDgfip, colonnes, desequilibresDgfip } from '../test/fecDgfip'
import { modeleDeTest } from '../test/modeles'
import { SANS_ECRITURE_DE_VENTE, SANS_VENTE_FACTUREE } from '../test/ventesFacturees'

// L'OUVERTURE DE LA BANQUE ÉCLATÉE ENTRE LES COMPTES BANCAIRES, CHEZ SES LECTEURS (ligne 26.6, MCB5, sixième partie, suite) :
// le FEC (une sorte de plus, au journal OD, les relevés au 31/12 pour pièce) sous ses deux rendus de la banque, la piste
// d'audit et ses détecteurs, la numérotation que la validation enverra, et l'état que la carte de l'onglet Écritures montre.
// Une écriture qui ne porte pas la source se lit comme hier. Données FICTIVES.

const LIBELLE = 'Ouverture du 512200 au relevé du 31/12/2025'
const ecriture = (o: Partial<EcritureBrouillon>): EcritureBrouillon => ({
  id: 'e', dossier_id: 'd1', piece_id: null, ligne_bancaire_id: null, date: '2026-01-01', libelle: LIBELLE, sens: 'debit',
  statut: 'proposee', compte: '512200', montant: 250, created_at: '2026-01-02T00:00:00Z', ...o,
} as EcritureBrouillon)
const PAIRE = [
  ecriture({ id: 'o1', compte: '512200', sens: 'debit', ouverture_compte_bancaire_id: 's' }),
  ecriture({ id: 'o2', compte: '512000', sens: 'credit', ouverture_compte_bancaire_id: 's' }),
]
// Une dotation au 31 décembre de l'exercice, autre opération diverse : la paire du 1er janvier se numérote avant elle.
const DOTATION = [
  ecriture({ id: 'd1', compte: '681100', date: '2026-12-31', libelle: 'Dotation', montant: 400, immobilisation_id: 'i1' }),
  ecriture({ id: 'd2', compte: '281830', date: '2026-12-31', libelle: 'Dotation', montant: 400, sens: 'credit', immobilisation_id: 'i1' }),
]
const compte = (c: Partial<CompteDuReleve> & Pick<CompteDuReleve, 'id'>): CompteDuReleve => ({
  libelle: 'Compte', principal: false, fin_d_identifiant: null, compte: null, compte_propre_depuis: null, ouvert_le: null, clos_le: null, ...c,
})
const P = compte({ id: 'p', libelle: 'Compte principal', principal: true })
const S = compte({ id: 's', libelle: 'Compte second fictif', compte: '512200', compte_propre_depuis: '2026-01-01', ouvert_le: '2024-06-01' })
const PAR_COMPTE = banquesDuDossier({ etat: 'lus', comptes: [P, S] }, PLAN_PAR_DEFAUT)
const ROLE: BanquesDuDossier = { cas: 'role', compte: PLAN_PAR_DEFAUT.banque }
const numeroter = (ecritures: EcritureBrouillon[]) => numeroterFec(ecritures, [], [], [], modeleDeTest('tresorerie'), [],
  SANS_ECRITURE_DE_VENTE, OPERATIONS_DE_CAISSE_ABSENTES, CHAMPS_BNC_NON_EXPORTES)

describe('le FEC : une écriture au journal OD, les relevés au 31/12 pour pièce', () => {
  it('la paire fait UNE écriture, numérotée avant la dotation, PieceDate le 31/12 qui précède', () => {
    const n = numeroter([...DOTATION, ...PAIRE])
    expect(n.horsFec).toEqual([])
    expect(n.lignes.map((l) => [l.ecriture.id, l.journal, l.numero, l.pieceRef, l.pieceDate])).toEqual([
      ['o1', 'OD', 1, 'Relevés au 31/12/2025', '2025-12-31'],
      ['o2', 'OD', 1, 'Relevés au 31/12/2025', '2025-12-31'],
      ['d1', 'OD', 2, "Tableau d'amortissement 2026", '2026-12-31'],
      ['d2', 'OD', 2, "Tableau d'amortissement 2026", '2026-12-31'],
    ])
    // Ce que la validation enverrait : rien qu'elle refuserait.
    expect(defautsDeNumerotation(n)).toEqual([])
    expect(referenceDeLOuvertureEclatee('2027-01-01')).toBe('Relevés au 31/12/2026')
  })

  it('le fichier passe les contrôles de la DGFiP : une date, un journal, équilibrée', () => {
    const fec = genererFec([...PAIRE], [], [], [], modeleDeTest('tresorerie'), [], new Map(), SANS_ECRITURE_DE_VENTE,
      OPERATIONS_DE_CAISSE_ABSENTES, CHAMPS_BNC_NON_EXPORTES)
    expect(colonnes(fec).slice(1).map((r) => [r[0], r[2], r[3], r[4], r[8], r[9], r[10], r[11], r[12]])).toEqual([
      ['OD', 'OD00001', '20260101', '512200', 'Relevés au 31/12/2025', '20251231', LIBELLE, '250,00', '0,00'],
      ['OD', 'OD00001', '20260101', '512000', 'Relevés au 31/12/2025', '20251231', LIBELLE, '0,00', '250,00'],
    ])
    expect(anomaliesDgfip(fec)).toEqual([])
    expect(desequilibresDgfip(fec)).toEqual([])
  })

  it('sans la source, la même paire reste hors du fichier, comme le reste d’une pièce supprimée (le défaut que la sorte corrige)', () => {
    const sansSource = PAIRE.map((e) => ({ ...e, ouverture_compte_bancaire_id: null }))
    expect(numeroter(sansSource).horsFec.map((e) => e.id)).toEqual(['o1', 'o2'])
    expect(absenceFec(sansSource, new Set()).nb).toBe(2)
  })

  it('les deux rendus de la banque : un 512 par compte, tel quel ; un seul 512, les deux lignes au rôle, sous le même numéro', () => {
    const n = numeroter([...DOTATION, ...PAIRE])
    expect(rendreLesBanquesAuFec(n, 'un_512_par_compte', PLAN_PAR_DEFAUT, PAR_COMPTE)).toBe(n)
    const rendu = rendreLesBanquesAuFec(n, 'un_seul_512', PLAN_PAR_DEFAUT, PAR_COMPTE)
    if ('refus' in rendu) throw new Error(rendu.refus)
    expect(rendu.lignes.filter((l) => l.ecriture.ouverture_compte_bancaire_id).map((l) => [l.ecriture.compte, l.ecriture.sens, l.numero, l.ecriture.libelle]))
      .toEqual([['512000', 'debit', 1, LIBELLE], ['512000', 'credit', 1, LIBELLE]])
    const fichier = formaterFec(rendu, new Map(), 'tresorerie')
    expect(fichier).not.toContain('\t512200\t')
    expect(desequilibresDgfip(fichier)).toEqual([])
  })
})

describe('la piste d’audit et ses détecteurs', () => {
  const registre = (banques: BanquesDuDossier) => ({
    immobilisations: [], factures: [], vehicules: [], ventes: SANS_VENTE_FACTUREE, caisse: OPERATIONS_DE_CAISSE_ABSENTES, plan: PLAN_PAR_DEFAUT, banques,
  })

  it('ni sans justificatif, ni sans mouvement, sous les deux banques ; hors de la source, les deux ruptures d’hier', () => {
    expect(rupturesPisteAudit(PAIRE, new Set(), PLAN_PAR_DEFAUT, PAR_COMPTE)).toEqual([])
    expect(rupturesPisteAudit(PAIRE, new Set(), PLAN_PAR_DEFAUT, ROLE)).toEqual([])
    expect(absenceFec(PAIRE, new Set()).nb).toBe(0)
    const sansSource = PAIRE.map((e) => ({ ...e, ouverture_compte_bancaire_id: null }))
    expect(rupturesPisteAudit(sansSource, new Set(), PLAN_PAR_DEFAUT, PAR_COMPTE).map((r) => r.motif))
      .toEqual(['sans_justificatif', 'sans_mouvement', 'sans_justificatif', 'sans_mouvement'])
  })

  it('chaque ligne cite le relevé au 31/12 du compte qu’elle ouvre, par son 512, rien ne lui manque', () => {
    const lignes = pisteAudit(PAIRE, [], [], [], registre(PAR_COMPTE))
    expect(lignes.map((l) => [l.compte, l.pieceDate, l.pieceFichier, l.pieceEmpreinte, l.mouvementLibelle, l.manque])).toEqual([
      ['512000', '2025-12-31', 'Relevé au 31/12/2025 du compte bancaire du 512200 (Relevés au 31/12/2025)', null, null, []],
      ['512200', '2025-12-31', 'Relevé au 31/12/2025 du compte bancaire du 512200 (Relevés au 31/12/2025)', null, null, []],
    ])
    // Jamais le libellé d'un compte bancaire, texte libre.
    expect(JSON.stringify(lignes)).not.toContain('Compte second fictif')
  })
})

describe('la carte de l’onglet Écritures et ses mots', () => {
  const ligne = (compte: string, fichier: string, date: string, montant: number) => ({ id: `${compte}-${date}`, compte_bancaire_id: compte, source_fichier: fichier, date, montant })
  const controle = (id: string, compte: string, fichier: string, initial: number, final: number) => ({
    id, dossier_id: 'd1', compte_bancaire_id: compte, source_fichier: fichier, solde_initial: initial, solde_final: final,
    somme_mouvements: final - initial, ecart: 0, coherent: true, periode_debut: '2025-12-01', periode_fin: '2025-12-31', created_at: '2026-01-02T00:00:00Z',
  })
  const LUE: LectureDuReleveDeLOuverture = {
    dossierId: 'd1', etat: 'lue', comptes: { etat: 'lus', comptes: [P, S] },
    lignes: [ligne('p', 'p.csv', '2025-12-15', 100), ligne('s', 's.csv', '2025-12-10', 50)],
    controles: [controle('cp', 'p', 'p.csv', 900, 1000), controle('cs', 's', 's.csv', 200, 250)],
  }
  const reportes = [{ date: '2026-01-01', compte: '512000', sens: 'debit' as const, montant: 1250 },
    { date: '2026-01-01', compte: '101000', sens: 'credit' as const, montant: 1250 }]
  const carte = (o: Partial<Parameters<typeof carteDeLEclatement>[0]> = {}) => carteDeLEclatement({
    dossierId: 'd1', annee: 2026, lecture: LUE, motifs: [null, null, null], role: '512000', reprise: [], reportes,
    anneesValidees: [2025], brouillon: [], ...o,
  })

  it('masquée sur « toutes les années », drapeau baissé, ou sans rien à éclater ; « Chargement… » avant la lecture de CE dossier', () => {
    expect(carte({ annee: 'toutes' }).etat).toBe('masquee')
    expect(carte({ lecture: { dossierId: 'd1', etat: 'sans_objet' } }).etat).toBe('masquee')
    expect(carte({ annee: 2025 }).etat).toBe('masquee')
    expect(carte({ lecture: null }).etat).toBe('chargement')
    expect(carte({ lecture: { ...LUE, dossierId: 'autre' } }).etat).toBe('chargement')
  })

  it('illisible sur une lecture refusée, partielle, ou un relevé d’un compte que la lecture n’a pas rendu', () => {
    expect(carte({ lecture: { dossierId: 'd1', etat: 'illisible', motif: 'refusée' } })).toEqual({ etat: 'illisible', motif: 'refusée' })
    expect(carte({ motifs: [null, 'à-nouveaux : 10 sur 12', null] })).toEqual({ etat: 'illisible', motif: 'à-nouveaux : 10 sur 12' })
    expect(carte({ lecture: { ...LUE, lignes: [...LUE.lignes, ligne('x', 'x.csv', '2025-12-01', 1)] } }).etat).toBe('illisible')
  })

  it('à écrire, puis à jour, à réécrire, à retirer ; figée par la validation de l’exercice', () => {
    const aEcrire = carte()
    if (aEcrire.etat !== 'lue' || !eclatementAFaire(aEcrire.eclatement)) throw new Error(aEcrire.etat)
    expect(aEcrire.eclatement.etat).toBe('a_ecrire')
    expect(aEcrire.fige).toBe(false)
    expect(argumentsDeLEclatement('d1', 2026, aEcrire.eclatement)).toEqual({ p_dossier_id: 'd1', p_annee: 2026, p_ecritures: [
      { compte_bancaire_id: 's', compte: '512200', sens: 'debit', montant: 250, libelle: LIBELLE },
      { compte_bancaire_id: 's', compte: '512000', sens: 'credit', montant: 250, libelle: LIBELLE },
    ] })
    expect(confirmationDeLEclatement(aEcrire.eclatement, 2026))
      .toBe('Écrire l’écriture du 01/01/2026 qui ouvre ce compte au solde de son relevé du 31/12/2025, face au 512000 ?\n\n512200 : 250,00 €')
    expect(carte({ brouillon: PAIRE })).toMatchObject({ etat: 'lue', eclatement: { etat: 'a_jour' } })
    const autre = PAIRE.map((e) => ({ ...e, montant: 200 }))
    expect(carte({ brouillon: autre })).toMatchObject({ etat: 'lue', eclatement: { etat: 'a_reecrire' } })
    // Le second compte ne tient plus son 512 propre depuis ce 1er janvier : plus rien à éclater.
    const sansCompteQuiSort = { ...LUE, comptes: { etat: 'lus' as const, comptes: [P, { ...S, compte_propre_depuis: null }] } }
    const aRetirer = carte({ brouillon: PAIRE, lecture: sansCompteQuiSort })
    expect(aRetirer).toMatchObject({ etat: 'lue', eclatement: { etat: 'a_retirer' } })
    if (aRetirer.etat === 'lue' && eclatementAFaire(aRetirer.eclatement)) {
      expect(argumentsDeLEclatement('d1', 2026, aRetirer.eclatement).p_ecritures).toEqual([])
    }
    expect(carte({ anneesValidees: [2025, 2026] })).toMatchObject({ etat: 'lue', fige: true })
  })

  it('retenue, avec les mots de la base, quand un relevé du 31/12 manque', () => {
    const retenue = carte({ lecture: { ...LUE, controles: [LUE.controles[0]], lignes: [LUE.lignes[0]] } })
    if (retenue.etat !== 'lue') throw new Error(retenue.etat)
    expect(retenue.eclatement.etat).toBe('retenu')
    expect(phraseDeLEclatement(retenue.eclatement, 2026)).toBe(
      'Le solde au 31/12/2025 du compte bancaire « Compte second fictif » ne se lit sur aucun de ses relevés contrôlés : importer le relevé qui finit ce jour-là, ou celui qui le couvre, avant d\'éclater l\'ouverture de la banque.')
  })
})
