import { banquesDuDossier } from './banqueDuMouvement'
import { describe, expect, it } from 'vitest'
import type { MouvementBancaire } from './affectationBanque'
import type { LectureDesComptes } from './importParCompte'
import { ecartDuLot, type MouvementsHorsDesLots } from './mouvementsDesVentes'
import { PLAN_DECALE } from './planComptable'
import {
  compteDeLaFiche, ecritureDuVirementInterne, JOURS_DU_VIREMENT_INTERNE, messageDuVirementInacheve, plusieursComptes,
  RAISON_VIREMENT_INTERNE, virementPropose, virementsInternes, virementsInternesHorsDesLots, type MouvementDuVirement,
} from './virementsInternes'
import { modeleDecale, modeleDeTest } from '../test/modeles'
import { derniereDefinitionSql } from '../test/schema'

// LE RAPPROCHEMENT PAR COMPTE BANCAIRE ET LE VIREMENT ENTRE COMPTES (lot MCB3). Mouvements FICTIFS ; deux comptes, A et B.

function mouvement(o: Partial<MouvementDuVirement> = {}): MouvementDuVirement {
  return {
    id: 'l1', date: '2026-03-12', libelle: 'VIR VERS COMPTE B', libelle_brut: null, montant: -1500,
    statut: 'non_rapprochee', piece_id: null, cotisation_id: null, categorie_id: null, taux_tva: null, prelevement_personnel: false,
    source_fichier: null, emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null,
    ventilee: false, reglement_groupe: false, compte_bilan: null, declaration_tva_id: null, compte_bancaire_id: 'A',
    ...o,
  }
}

const LUS: LectureDesComptes = {
  etat: 'lus',
  comptes: [
    { id: 'A', libelle: 'Compte principal', principal: true, fin_d_identifiant: null, compte: null, compte_propre_depuis: null, ouvert_le: null, clos_le: null },
    { id: 'B', libelle: 'Compte pro bis', principal: false, fin_d_identifiant: null, compte: '512100', compte_propre_depuis: '2026-01-01', ouvert_le: null, clos_le: null },
  ],
}
const BAISSE: LectureDesComptes = { etat: 'sans_objet' }
const AUCUN: MouvementsHorsDesLots = new Map()
const T = modeleDeTest('tresorerie')
// Les banques d'hier : le drapeau des comptes bancaires baissé, la jambe de banque au compte du rôle.
const HIER = banquesDuDossier({ etat: 'sans_objet' }, T.plan)

const DEBIT = mouvement({ id: 'deb', date: '2026-03-12', montant: -1500, compte_bancaire_id: 'A' })
const CREDIT = mouvement({ id: 'cre', date: '2026-03-14', montant: 1500, libelle: 'VIR DE COMPTE A', compte_bancaire_id: 'B' })

const analyser = (lignes: MouvementDuVirement[], lecture: LectureDesComptes = LUS, ventes: MouvementsHorsDesLots = AUCUN, valides: number[] = []) =>
  virementsInternes(lignes, lecture, T.plan.virements_internes, ventes, valides)

describe('les virements entre deux comptes du dossier se reconnaissent au relevé', () => {
  it('drapeau baissé : aucune paire, aucun mouvement de plus hors des lots, la même instance', () => {
    const analyse = analyser([DEBIT, CREDIT], BAISSE)
    expect(analyse.candidats.size).toBe(0)
    const hors: MouvementsHorsDesLots = new Map([['x', 'raison']])
    expect(virementsInternesHorsDesLots(hors, analyse)).toBe(hors)
  })

  it('drapeau levé : un débit et le crédit du même montant sur l’autre compte, à trois jours, se proposent l’un à l’autre', () => {
    const analyse = analyser([DEBIT, CREDIT])
    expect(virementPropose(analyse, 'deb')?.autre.id).toBe('cre')
    expect(virementPropose(analyse, 'cre')?.autre.id).toBe('deb')
    const hors = virementsInternesHorsDesLots(AUCUN, analyse)
    expect([...hors]).toEqual([['deb', RAISON_VIREMENT_INTERNE], ['cre', RAISON_VIREMENT_INTERNE]])
  })

  it('le même compte, un autre montant, le même sens ou au-delà de la fenêtre : aucune paire', () => {
    expect(analyser([DEBIT, { ...CREDIT, compte_bancaire_id: 'A' }]).candidats.size).toBe(0)
    expect(analyser([DEBIT, { ...CREDIT, montant: 1500.01 }]).candidats.size).toBe(0)
    expect(analyser([DEBIT, { ...CREDIT, montant: -1500 }]).candidats.size).toBe(0)
    expect(JOURS_DU_VIREMENT_INTERNE).toBe(3)
    expect(analyser([DEBIT, { ...CREDIT, date: '2026-03-15' }]).candidats.size).toBe(2)
    expect(analyser([DEBIT, { ...CREDIT, date: '2026-03-16' }]).candidats.size).toBe(0)
    // Le crédit peut aussi précéder le débit d'un jour (deux banques, deux heures de passage).
    expect(analyser([DEBIT, { ...CREDIT, date: '2026-03-11' }]).candidats.size).toBe(2)
  })

  it('un mouvement sans compte (une lecture d’avant la migration) n’entre dans aucune paire', () => {
    expect(analyser([DEBIT, { ...CREDIT, compte_bancaire_id: undefined }]).candidats.size).toBe(0)
  })

  it('un mouvement déjà classé, personnel, réservé par les ventes ou figé n’est pas libre', () => {
    for (const autre of [
      { ...CREDIT, statut: 'rapprochee' as const, categorie_id: 'cat' },
      { ...CREDIT, statut: 'ignoree' as const },
      { ...CREDIT, prelevement_personnel: true },
      { ...CREDIT, statut: 'rapprochee' as const, piece_id: 'p1' },
    ]) {
      expect(analyser([DEBIT, autre]).candidats.size).toBe(0)
    }
    expect(analyser([DEBIT, CREDIT], LUS, new Map([['cre', 'réservé']])).candidats.size).toBe(0)
    expect(analyser([DEBIT, CREDIT], LUS, AUCUN, [2026]).candidats.size).toBe(0)
  })

  it('deux crédits en face d’un débit : tous candidats, hors des lots, aucun proposé', () => {
    const autre = { ...CREDIT, id: 'cre2', date: '2026-03-13' }
    const analyse = analyser([DEBIT, CREDIT, autre])
    expect(analyse.candidats.get('deb')?.map((c) => c.autre.id)).toEqual(['cre', 'cre2'])
    expect(virementPropose(analyse, 'deb')).toBeNull()
    // Chaque crédit n'a qu'un candidat, mais ce débit en a deux : aucun sens ne propose.
    expect(virementPropose(analyse, 'cre')).toBeNull()
    expect(virementsInternesHorsDesLots(AUCUN, analyse).size).toBe(3)
  })

  it('la moitié déjà écrite au 580 se complète ; les deux moitiés écrites ne se proposent plus', () => {
    const ecrit = { ...DEBIT, statut: 'rapprochee' as const, compte_bilan: '580000' }
    const analyse = analyser([ecrit, CREDIT])
    expect(analyse.candidats.has('deb')).toBe(false)
    expect(virementPropose(analyse, 'cre')).toEqual({ autre: ecrit, dejaAuCompte: true })
    expect(analyser([ecrit, { ...CREDIT, statut: 'rapprochee', compte_bilan: '580000' }]).candidats.size).toBe(0)
    // Écrit à un autre compte de bilan, ce n'est pas l'autre moitié d'un virement interne.
    expect(analyser([{ ...ecrit, compte_bilan: '275000' }, CREDIT]).candidats.size).toBe(0)
  })

  it('le compte des virements internes est celui du plan du dossier', () => {
    const decale = modeleDecale('tresorerie')
    const ecrit = { ...DEBIT, statut: 'rapprochee' as const, compte_bilan: PLAN_DECALE.virements_internes }
    expect(virementsInternes([ecrit, CREDIT], LUS, decale.plan.virements_internes, AUCUN, []).candidats.has('cre')).toBe(true)
    expect(virementsInternes([ecrit, CREDIT], LUS, '580000', AUCUN, []).candidats.has('cre')).toBe(PLAN_DECALE.virements_internes === '580000')
  })
})

describe('la confirmation écrit chaque moitié au 580, face à la banque d’aujourd’hui', () => {
  it('les deux mouvements, ce mouvement-ci d’abord, et le 580 revient à zéro', () => {
    const analyse = analyser([DEBIT, CREDIT])
    const plan = ecritureDuVirementInterne(DEBIT, virementPropose(analyse, 'deb')!, T, HIER)
    if (plan.cas !== 'ecrire') throw new Error(plan.refus)
    expect(plan.mouvements.map((m) => m.ligne.id)).toEqual(['deb', 'cre'])
    const lignes = plan.mouvements.flatMap((m) => m.ecriture)
    const solde = (compte: string) => lignes.filter((l) => l.compte === compte)
      .reduce((s, l) => s + (l.sens === 'debit' ? l.montant : -l.montant), 0)
    expect(solde(T.plan.virements_internes)).toBe(0)
    // Drapeau baissé (les banques « d'hier ») : la jambe de banque est le compte du rôle `banque`, les deux s'y annulent.
    expect(solde(T.plan.banque)).toBe(0)
    expect(new Set(lignes.map((l) => l.compte))).toEqual(new Set([T.plan.virements_internes, T.plan.banque]))
  })

  it('MCB5 : chaque moitié s’écrit face à la banque de SON compte — le principal au rôle, le second à son 512 propre', () => {
    const plan = ecritureDuVirementInterne(DEBIT, virementPropose(analyser([DEBIT, CREDIT]), 'deb')!, T, banquesDuDossier(LUS, T.plan))
    if (plan.cas !== 'ecrire') throw new Error(plan.refus)
    expect(plan.mouvements.map((m) => m.ecriture.map((l) => `${l.compte} ${l.sens} ${l.montant}`).sort())).toEqual([
      ['512000 credit 1500', `${T.plan.virements_internes} debit 1500`],
      ['512100 debit 1500', `${T.plan.virements_internes} credit 1500`],
    ])
  })

  it('MCB5 : des comptes illisibles retiennent l’écriture des deux moitiés, le mouvement nommé', () => {
    const plan = ecritureDuVirementInterne(DEBIT, virementPropose(analyser([DEBIT, CREDIT]), 'deb')!, T,
      banquesDuDossier({ etat: 'illisible', motif: 'coupure' }, T.plan))
    expect(plan.cas === 'refus' && plan.refus).toMatch(/^Le mouvement du 12\/03\/2026 .* lus en entier \(coupure\)/)
  })

  it('la moitié qui reste : ce mouvement seul', () => {
    const ecrit = { ...DEBIT, statut: 'rapprochee' as const, compte_bilan: '580000' }
    const plan = ecritureDuVirementInterne(CREDIT, { autre: ecrit, dejaAuCompte: true }, T, HIER)
    expect(plan.cas === 'ecrire' && plan.mouvements.map((m) => m.ligne.id)).toEqual(['cre'])
  })

  it('un refus de la base, dit avant tout appel, nomme le mouvement', () => {
    const plan = ecritureDuVirementInterne(DEBIT, { autre: { ...CREDIT, reglement_groupe: true }, dejaAuCompte: false }, T, HIER)
    expect(plan.cas).toBe('refus')
    expect(plan.cas === 'refus' && plan.refus).toMatch(/^Le mouvement du 14\/03\/2026 \(1\s500,00\s€\) : /)
  })

  it('le virement inachevé se dit', () => {
    expect(messageDuVirementInacheve(DEBIT, CREDIT, 'refus')).toMatch(/inachevé : le mouvement du 12\/03\/2026 .* celui du 14\/03\/2026 .* \(refus\)/)
  })

  it('la base accepte le compte des virements internes, et y écrit face au compte du rôle « banque »', () => {
    const refus = derniereDefinitionSql('refus_compte_de_bilan')
    expect(refus).toContain('second compte bancaire) s\'\'écrit au 580000, virements internes')
    const ecrire = derniereDefinitionSql('ecrire_mouvement_compte_bilan')
    expect(ecrire).toContain("v_banque := public.compte_du_role(v_ligne.dossier_id, 'banque');")
    expect(ecrire).toContain('select v_banque as compte, v_sens_banque as sens, abs(v_ligne.montant) as montant')
  })
})

describe('la fiche dit le compte du mouvement quand il y en a plusieurs', () => {
  it('drapeau baissé, comptes en cours ou un seul compte : rien, la fiche d’hier', () => {
    const analyse = analyser([DEBIT, CREDIT])
    expect(compteDeLaFiche(DEBIT, BAISSE, analyse)).toEqual({ etat: 'absent' })
    expect(compteDeLaFiche(DEBIT, { etat: 'en_cours' }, analyse)).toEqual({ etat: 'absent' })
    const un: LectureDesComptes = { etat: 'lus', comptes: [LUS.etat === 'lus' ? LUS.comptes[0] : (null as never)] }
    expect(plusieursComptes(un)).toBe(false)
    expect(compteDeLaFiche(DEBIT, un, analyse)).toEqual({ etat: 'absent' })
  })

  it('illisible : une ligne discrète', () => {
    expect(compteDeLaFiche(DEBIT, { etat: 'illisible', motif: 'refusée' }, analyser([]))).toEqual({ etat: 'illisible', motif: 'refusée' })
  })

  it('deux comptes : son libellé, et ses candidats sous le libellé du leur', () => {
    expect(compteDeLaFiche(DEBIT, LUS, analyser([DEBIT, CREDIT]))).toEqual({
      etat: 'compte',
      libelle: 'Compte principal',
      candidats: [{ ligneId: 'cre', date: '2026-03-14', montant: 1500, compte: 'Compte pro bis', dejaAuCompte: false, propose: true }],
    })
    expect(compteDeLaFiche({ ...DEBIT, compte_bancaire_id: 'Z' }, LUS, analyser([]))).toMatchObject({
      etat: 'compte', libelle: 'un compte que la lecture des comptes ne rend pas', candidats: [],
    })
  })
})

describe('la carte d’un lot dit les virements écartés', () => {
  const l = (id: string) => ({ id }) as Pick<MouvementBancaire, 'id'>
  it('seuls, puis avec d’autres', () => {
    const hors: MouvementsHorsDesLots = new Map([['a', RAISON_VIREMENT_INTERNE], ['b', 'Les mots de la garde G2.']])
    expect(ecartDuLot([l('a')], hors)?.resume).toBe('1 mouvement écarté : 1 a en face un mouvement du montant opposé sur un '
      + 'autre compte bancaire — peut-être un virement entre comptes, à confirmer depuis sa fiche.')
    expect(ecartDuLot([l('a'), l('b')], hors)?.resume).toMatch(/^2 mouvements écartés : 1 a en face .* ; 1 autre pour la raison que dit sa ligne\.$/)
    // Sans virement, la phrase d'hier.
    expect(ecartDuLot([l('b')], hors)?.resume).toBe('1 mouvement écarté : il porte des encaissements de factures.')
  })
})
