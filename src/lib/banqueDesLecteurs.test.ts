import { describe, expect, it } from 'vitest'
import { ouvertureBanque } from './aNouveaux'
import { banqueDesLecteurs, banquesDuDossier, estUneBanque, type BanquesDuDossier } from './banqueDuMouvement'
import { RENDU_DES_BANQUES_AU_FEC, rendreLesBanquesAuFec } from './banquesAuFec'
import { OPERATIONS_DE_CAISSE_ABSENTES } from './controlesDeLaCaisse'
import { formaterFec, type LigneFec, type NumerotationFec } from './fec'
import type { CompteDuReleve, LectureDesComptes } from './importParCompte'
import { pisteAudit, rupturesPisteAudit } from './pisteAudit'
import { PLAN_DECALE, PLAN_PAR_DEFAUT } from './planComptable'
import { calculerEvolutionMensuelle, soldesFinDeMois } from './tableauPilotage'
import type { ANouveau, EcritureBrouillon } from './types'
import { A_NOUVEAU_NON_VALIDE } from '../test/ecritures'
import { SANS_VENTE_FACTUREE } from '../test/ventesFacturees'

// LA JAMBE DE BANQUE PAR COMPTE BANCAIRE : LES LECTEURS (MCB5, quatrième partie). Chaque lecteur des écritures reconnaît le
// 512 propre de chaque compte bancaire comme de la banque ; drapeau baissé (la banque du rôle), la lecture d'hier.

const compte = (c: Partial<CompteDuReleve> & Pick<CompteDuReleve, 'id'>): CompteDuReleve => ({
  libelle: 'Compte', principal: false, fin_d_identifiant: null, compte: null, compte_propre_depuis: null, ouvert_le: null, clos_le: null, ...c,
})
const PRINCIPAL = compte({ id: 'P', libelle: 'Compte principal', principal: true })
const SECOND = compte({ id: 'S', libelle: 'Compte pro bis', compte: '512200', compte_propre_depuis: '2026-01-01' })
const CLOS = compte({ id: 'C', libelle: 'Ancien compte', compte: '512300', compte_propre_depuis: '2025-01-01', clos_le: '2025-12-31' })
const DEUX: LectureDesComptes = { etat: 'lus', comptes: [PRINCIPAL, SECOND, CLOS] }
const PAR_COMPTE = banquesDuDossier(DEUX, PLAN_PAR_DEFAUT)
const ROLE: BanquesDuDossier = { cas: 'role', compte: PLAN_PAR_DEFAUT.banque }
const RETENU = banquesDuDossier({ etat: 'illisible', motif: 'refusée' }, PLAN_PAR_DEFAUT)

const ecriture = (o: Partial<EcritureBrouillon>): EcritureBrouillon => ({
  id: `e-${o.compte}-${o.date ?? '2026-03-10'}`, dossier_id: 'd1', piece_id: 'p1', ligne_bancaire_id: null, date: '2026-03-10',
  libelle: 'Libellé', sens: 'debit', statut: 'proposee', compte: '606100', montant: 100, created_at: '2026-03-10T00:00:00Z', ...o,
} as EcritureBrouillon)
const aNouveau = (o: Partial<ANouveau>): ANouveau => ({
  id: 'a', dossier_id: 'd1', date: '2026-01-01', compte: '512000', compte_origine: '512', libelle: 'Banque',
  sens: 'debit', montant: 0, source_nom: 'balance.csv', source_empreinte: 'e'.repeat(64), ...A_NOUVEAU_NON_VALIDE,
  created_at: '2026-09-26T10:00:00Z', ...o,
})

describe('banqueDesLecteurs et estUneBanque', () => {
  it('le rôle seul drapeau baissé ; le rôle puis chaque 512 propre, clos compris ; nul sur des comptes qui ne se savent pas', () => {
    expect([...banqueDesLecteurs(PLAN_PAR_DEFAUT, ROLE)!]).toEqual(['512000'])
    expect([...banqueDesLecteurs(PLAN_DECALE, { cas: 'role', compte: PLAN_DECALE.banque })!]).toEqual([PLAN_DECALE.banque])
    expect([...banqueDesLecteurs(PLAN_PAR_DEFAUT, PAR_COMPTE)!].sort()).toEqual(['512000', '512200', '512300'])
    expect(banqueDesLecteurs(PLAN_PAR_DEFAUT, RETENU)).toBeNull()
  })
  it('le rôle est toujours une banque ; un 512 propre selon les comptes ; nul quand ils ne se savent pas', () => {
    expect(estUneBanque('512000', PLAN_PAR_DEFAUT, RETENU)).toBe(true)
    expect(estUneBanque('512200', PLAN_PAR_DEFAUT, RETENU)).toBeNull()
    expect(estUneBanque('512200', PLAN_PAR_DEFAUT, PAR_COMPTE)).toBe(true)
    expect(estUneBanque('512200', PLAN_PAR_DEFAUT, ROLE)).toBe(false)
    expect(estUneBanque('606100', PLAN_PAR_DEFAUT, PAR_COMPTE)).toBe(false)
  })
})

describe('la piste d’audit', () => {
  const sansMouvement = ecriture({ compte: '512200', sens: 'credit' })
  it('la ligne d’un 512 propre sans mouvement rompt la piste ; drapeau baissé, comme hier, non', () => {
    expect(rupturesPisteAudit([sansMouvement], new Set(), PLAN_PAR_DEFAUT, PAR_COMPTE).map((r) => r.motif)).toEqual(['sans_mouvement'])
    expect(rupturesPisteAudit([sansMouvement], new Set(), PLAN_PAR_DEFAUT, ROLE)).toEqual([])
    // Des comptes qui ne se savent pas : seul le rôle se juge.
    expect(rupturesPisteAudit([sansMouvement], new Set(), PLAN_PAR_DEFAUT, RETENU)).toEqual([])
    expect(rupturesPisteAudit([ecriture({ compte: '512000' })], new Set(), PLAN_PAR_DEFAUT, RETENU).map((r) => r.motif)).toEqual(['sans_mouvement'])
  })
  it('la ligne d’un 512 propre sans mouvement manque de son mouvement bancaire', () => {
    const registre = (banques: BanquesDuDossier) => ({
      immobilisations: [], factures: [], vehicules: [], ventes: SANS_VENTE_FACTUREE, caisse: OPERATIONS_DE_CAISSE_ABSENTES, plan: PLAN_PAR_DEFAUT, banques,
    })
    expect(pisteAudit([sansMouvement], [], [], [], registre(PAR_COMPTE))[0].manque).toContain('mouvement bancaire')
    expect(pisteAudit([sansMouvement], [], [], [], registre(ROLE))[0].manque).not.toContain('mouvement bancaire')
  })
})

describe('le pilotage et l’ouverture de la banque', () => {
  const ecritures = [
    ecriture({ compte: '512000', date: '2026-01-05', sens: 'debit', montant: 1000 }),
    ecriture({ compte: '512200', date: '2026-01-06', sens: 'debit', montant: 300 }),
    ecriture({ compte: '512200', date: '2026-02-06', sens: 'credit', montant: 50 }),
  ]
  it('la trésorerie est la somme des comptes ; drapeau baissé, le rôle seul', () => {
    const tous = banqueDesLecteurs(PLAN_PAR_DEFAUT, PAR_COMPTE)!
    expect(soldesFinDeMois(ecritures, 12, null, tous)).toEqual([{ mois: '2026-01', solde: 1300 }, { mois: '2026-02', solde: 1250 }])
    expect(soldesFinDeMois(ecritures, 12, null, banqueDesLecteurs(PLAN_PAR_DEFAUT, ROLE)!)).toEqual([{ mois: '2026-01', solde: 1000 }])
    expect(calculerEvolutionMensuelle(ecritures, 12, tous)).toEqual([
      { mois: '2026-01', encaissements: 1300, decaissements: 0 }, { mois: '2026-02', encaissements: 0, decaissements: 50 },
    ])
  })
  it('l’ouverture de la banque additionne les à-nouveaux de ses comptes', () => {
    const ouverture = [aNouveau({ id: 'a', montant: 800 }), aNouveau({ id: 'b', compte: '512200', montant: 200 }), aNouveau({ id: 'c', compte: '101000', sens: 'credit', montant: 1000 })]
    expect(ouvertureBanque(ouverture, banqueDesLecteurs(PLAN_PAR_DEFAUT, PAR_COMPTE)!)).toEqual({ date: '2026-01-01', solde: 1000 })
    expect(ouvertureBanque(ouverture, banqueDesLecteurs(PLAN_PAR_DEFAUT, ROLE)!)).toEqual({ date: '2026-01-01', solde: 800 })
  })
})

describe('les deux rendus de la banque au FEC (MCB-Q4)', () => {
  const ligne = (e: EcritureBrouillon, numero: number, compteLib: string): LigneFec => ({
    ecriture: e, journal: 'BQ', numero, pieceRef: `R${numero}`, pieceDate: e.date, compteLib, compAuxNum: null, compAuxLib: null,
    validDate: e.date, champsBnc: null,
  })
  const NUMEROTATION: NumerotationFec = {
    aNouveaux: [
      { aNouveau: aNouveau({ id: 'a', montant: 800 }), compteLib: 'Banque', ecritureLib: 'À-nouveau Banque', validDate: '2026-01-01', champsBnc: null },
      { aNouveau: aNouveau({ id: 'b', compte: '512200', montant: 200 }), compteLib: 'Banques, établissements financiers et assimilés', ecritureLib: 'À-nouveau Banque', validDate: '2026-01-01', champsBnc: null },
    ],
    lignes: [
      ligne(ecriture({ id: 'l1', compte: '512200', sens: 'debit', montant: 300, ligne_bancaire_id: 'm1' }), 1, 'Banques, établissements financiers et assimilés'),
      ligne(ecriture({ id: 'l2', compte: '706000', sens: 'credit', montant: 300, ligne_bancaire_id: 'm1' }), 1, 'Prestations de services'),
    ],
    champsBnc: 'non_calcules',
    horsFec: [],
  }
  it('le rendu retenu est un 512 par compte, la numérotation telle quelle', () => {
    expect(RENDU_DES_BANQUES_AU_FEC).toBe('un_512_par_compte')
    expect(rendreLesBanquesAuFec(NUMEROTATION, 'un_512_par_compte', PLAN_PAR_DEFAUT, PAR_COMPTE)).toBe(NUMEROTATION)
    expect(rendreLesBanquesAuFec(NUMEROTATION, 'un_512_par_compte', PLAN_PAR_DEFAUT, RETENU)).toBe(NUMEROTATION)
  })
  it('un seul 512 : chaque 512 propre passe au rôle sous son CompteLib, le reste intact', () => {
    const rendu = rendreLesBanquesAuFec(NUMEROTATION, 'un_seul_512', PLAN_PAR_DEFAUT, PAR_COMPTE)
    if ('refus' in rendu) throw new Error(rendu.refus)
    expect(rendu.aNouveaux.map((a) => [a.aNouveau.compte, a.compteLib, a.aNouveau.montant])).toEqual([['512000', 'Banque', 800], ['512000', 'Banque', 200]])
    expect(rendu.lignes.map((l) => [l.ecriture.compte, l.compteLib, l.numero, l.ecriture.libelle])).toEqual([
      ['512000', 'Banque', 1, 'Libellé'], ['706000', 'Prestations de services', 1, 'Libellé'],
    ])
    const fichier = formaterFec(rendu, new Map(), 'tresorerie')
    expect(fichier).not.toContain('512200')
    expect(fichier.split('\r\n').filter((l) => l.split('\t')[4] === '512000').every((l) => l.split('\t')[5] === 'Banque')).toBe(true)
  })
  it('un seul 512, drapeau baissé : le même objet ; des comptes qui ne se savent pas : un refus', () => {
    expect(rendreLesBanquesAuFec(NUMEROTATION, 'un_seul_512', PLAN_PAR_DEFAUT, ROLE)).toBe(NUMEROTATION)
    expect(rendreLesBanquesAuFec(NUMEROTATION, 'un_seul_512', PLAN_PAR_DEFAUT, RETENU)).toEqual({ refus: (RETENU as { raison: string }).raison })
  })
})
