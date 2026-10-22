import { describe, expect, it } from 'vitest'
import type { AccesDuDossier } from './auteursVentes'
import {
  REFUS_CLASSEMENT, REFUS_RATTACHEMENT, REFUS_RETRAIT_CLASSEMENT, remplirModele, type LigneDeFacture, type MouvementClasse,
  type PartLue,
} from './encaissementsFactures'
import { formatMoney } from './format'
import {
  AUCUN_GESTE, gestesDuCredit, manqueDuCredit, montantSurLeCredit, ventesDuReleve,
  type EncaissementDuMouvementLu, type FactureDesGestes, type GestesDuCredit, type LectureDesGestes, type SourcesDesGestes,
} from './mouvementsDesVentes'
import { PLAN_DECALE, PLAN_PAR_DEFAUT } from './planComptable'

// LA FICHE D'UN CRÉDIT : « ENCAISSEMENT D'UNE FACTURE » (ligne 28.65, chantier EC-Q3, étape VF5c). Le module ne recopie aucune
// règle de la base : chaque refus est celui de `refusClassement`, `refusRetraitDuClassement` ou `refusRattachement`
// (lib/encaissementsFactures.ts, confrontés au texte des fonctions). Ces cas gardent ce que `gestesDuCredit` en tire — quel
// geste s'offre, sur quel mouvement, la sélection et l'ordre des candidats, les phrases et l'état d'après —, et la retenue
// de VF5a1 : rien ne s'offre sur des ventes facturées qui ne sont pas lues en entier. Données FICTIVES.

const D = 'd-bascule'
const ACCES: AccesDuDossier = { etat: 'lus', comptes: ['u-client'] }
const fm = (euros: number) => formatMoney(euros)

const facture = (o: Partial<FactureDesGestes> & Pick<FactureDesGestes, 'id' | 'numero'>): FactureDesGestes => ({
  dossier_id: D, type: 'facture', statut: 'validee', facture_origine_id: null, source_de_la_vente: true, tiers_nom: 'Client fictif',
  date_emission: '2026-03-01', montant_ttc: 600, ...o,
})

// Une ligne par facture, au taux de 20 % : le TTC vaut 1,2 × le hors-taxe. Celle d'un avoir, en quantité négative, comme
// l'écran de l'avoir l'enregistre.
const ligne = (factureId: string, ht: number, quantite = 1): LigneDeFacture => ({
  facture_id: factureId, ordre: 1, designation: 'Prestation fictive', quantite, prix_unitaire_ht: ht, taux_tva: 20,
})

const encaissement = (
  o: Partial<EncaissementDuMouvementLu> & Pick<EncaissementDuMouvementLu, 'id' | 'facture_id' | 'montant'>,
): EncaissementDuMouvementLu => ({
  dossier_id: D, date_encaissement: '2026-03-10', moyen: 'virement', ligne_bancaire_id: null, annule_id: null,
  cree_le: '2026-03-10T10:00:00Z', retire_le: null, cree_par: 'u-cabinet', ...o,
})

const mouvement = (o: Partial<MouvementClasse> & Pick<MouvementClasse, 'id'>): MouvementClasse => ({
  dossier_id: D, date: '2026-03-12', montant: 600, statut: 'non_rapprochee', piece_id: null, cotisation_id: null, categorie_id: null,
  emprunt_id: null, compte_bilan: null, declaration_tva_id: null, ventilee: false, reglement_groupe: false, prelevement_personnel: false,
  encaissements_de_factures: false, ...o,
})

// Trois factures sources (600 €, 600 €, 300 €), une d'avant la bascule, un avoir validé de 120 € sur la deuxième (son TTC
// net vaut 480 €), un brouillon.
const FACTURES = [
  facture({ id: 'f1', numero: 'F2026-0014', tiers_nom: 'SARL Horizon' }),
  facture({ id: 'f2', numero: 'F2026-0015', tiers_nom: 'Cabinet Durand' }),
  facture({ id: 'f3', numero: 'F2026-0016', tiers_nom: 'Atelier Martin', montant_ttc: 300 }),
  facture({ id: 'f0', numero: 'F2025-0099', source_de_la_vente: false }),
  facture({ id: 'a2', numero: 'A2026-0001', type: 'avoir', facture_origine_id: 'f2', montant_ttc: -120 }),
  facture({ id: 'fb', numero: null, statut: 'brouillon' }),
]
const LIGNES = [ligne('f1', 500), ligne('f2', 500), ligne('f3', 250), ligne('f0', 500), ligne('a2', 100, -1), ligne('fb', 500)]

function sources(o: Partial<SourcesDesGestes> = {}): SourcesDesGestes {
  return { dossierId: D, factures: FACTURES, lignes: LIGNES, encaissements: [], parts: [], mouvements: [], ...o }
}

// Les parts d'un encaissement, à un seul taux : ce que le reste d'une facture lit.
const partsDe = (encaissements: readonly EncaissementDuMouvementLu[]): PartLue[] =>
  encaissements.map((e) => ({ encaissement_id: e.id, taux: 20, montant: e.montant }))

const lue = (s: SourcesDesGestes): LectureDesGestes => ({ dossierId: D, etat: 'lue', sources: s })

// La fiche telle que l'onglet la calcule : l'état du relevé tiré de la MÊME lecture.
function gestes(s: SourcesDesGestes, id: string, annees: readonly number[] = [], plan = PLAN_PAR_DEFAUT): GestesDuCredit {
  return gestesDuCredit(ventesDuReleve(true, D, lue(s), ACCES), lue(s), { id, dossier_id: D }, annees, plan)
}

function refus(liste: readonly { cle: string; modele: string }[], cle: string, ...valeurs: string[]): string {
  return remplirModele((liste.find((r) => r.cle === cle) as { modele: string }).modele, valeurs)
}

describe('gestesDuCredit : la retenue de VF5a1 — rien ne s’offre sans des ventes lues en entier', () => {
  const s = sources({
    mouvements: [mouvement({ id: 'm1' })],
    encaissements: [encaissement({ id: 'e1', facture_id: 'f1', montant: 600, ligne_bancaire_id: 'm1' })],
  })
  const ici = { id: 'm1', dossier_id: D }

  it('un dossier qui n’a pas basculé, des ventes pas encore revenues ou lues en partie : aucun geste', () => {
    expect(gestesDuCredit({ etat: 'sans_objet' }, lue(s), ici, [], PLAN_PAR_DEFAUT)).toEqual(AUCUN_GESTE)
    expect(gestesDuCredit({ etat: 'en_cours' }, lue(s), ici, [], PLAN_PAR_DEFAUT)).toEqual(AUCUN_GESTE)
    expect(gestesDuCredit({ etat: 'incomplete', motif: 'refusée' }, lue(s), ici, [], PLAN_PAR_DEFAUT)).toEqual(AUCUN_GESTE)
  })

  it('une lecture absente, incomplète ou d’un autre dossier : aucun geste, même si le relevé se dit lu', () => {
    const v = ventesDuReleve(true, D, lue(s), ACCES)
    expect(gestes(s, 'm1').etat).toBe('reserve')
    expect(gestesDuCredit(v, null, ici, [], PLAN_PAR_DEFAUT)).toEqual(AUCUN_GESTE)
    expect(gestesDuCredit(v, { dossierId: D, etat: 'incomplete', motif: 'refusée' }, ici, [], PLAN_PAR_DEFAUT)).toEqual(AUCUN_GESTE)
    expect(gestesDuCredit(v, { ...lue(s), dossierId: 'autre' }, ici, [], PLAN_PAR_DEFAUT)).toEqual(AUCUN_GESTE)
    expect(gestesDuCredit(v, lue({ ...s, dossierId: 'autre' }), ici, [], PLAN_PAR_DEFAUT)).toEqual(AUCUN_GESTE)
    expect(gestesDuCredit(v, lue(s), { id: 'm1', dossier_id: 'autre' }, [], PLAN_PAR_DEFAUT)).toEqual(AUCUN_GESTE)
  })

  it('un mouvement que la lecture des ventes n’a pas rendu, ou d’un autre dossier : aucun geste', () => {
    expect(gestes(s, 'm-absent')).toEqual(AUCUN_GESTE)
    expect(gestes({ ...s, mouvements: [mouvement({ id: 'm1', dossier_id: 'autre' })] }, 'm1')).toEqual(AUCUN_GESTE)
  })

  it('un débit — réservé, classé ou libre — n’a rien de VF5c (VF5d) ; un crédit classé autrement non plus', () => {
    const debits = sources({
      mouvements: [mouvement({ id: 'd1', montant: -600 }), mouvement({ id: 'd2', montant: -600, statut: 'rapprochee', encaissements_de_factures: true }), mouvement({ id: 'd3', montant: -50 })],
      encaissements: [
        encaissement({ id: 'e1', facture_id: 'f1', montant: 600 }),
        encaissement({ id: 'c1', facture_id: 'f1', montant: -600, annule_id: 'e1', ligne_bancaire_id: 'd1' }),
        encaissement({ id: 'e9', facture_id: 'f2', montant: 50 }),
      ],
    })
    for (const id of ['d1', 'd2', 'd3']) expect(gestes(debits, id), id).toEqual(AUCUN_GESTE)
    expect(gestes(sources({ mouvements: [mouvement({ id: 'm', statut: 'rapprochee', piece_id: 'p1' })] }), 'm')).toEqual(AUCUN_GESTE)
    // Un crédit nul n'est pas un crédit.
    expect(gestes(sources({ mouvements: [mouvement({ id: 'm', montant: 0 })], encaissements: [encaissement({ id: 'e', facture_id: 'f1', montant: 600 })] }), 'm')).toEqual(AUCUN_GESTE)
  })
})

describe('un crédit RÉSERVÉ : classer par ses encaissements', () => {
  it('ses encaissements font exactement le crédit : la phrase, aucun refus, la confirmation nomme la facture et le montant', () => {
    const s = sources({
      mouvements: [mouvement({ id: 'm1', montant: 600, date: '2026-03-12' })],
      encaissements: [encaissement({ id: 'e1', facture_id: 'f1', montant: 600, ligne_bancaire_id: 'm1' })],
    })
    const g = gestes(s, 'm1')
    if (g.etat !== 'reserve') throw new Error(g.etat)
    expect(g.ensemble).toBe(`Ses encaissements font exactement le crédit, ${fm(600)}.`)
    expect(g.classement.refus).toBeNull()
    expect(g.classement.confirmation).toBe(
      `Classer ce crédit du 12/03/2026 de ${fm(600)} par ses encaissements ?\n\n`
      + `— Facture F2026-0014 (SARL Horizon) — virement du 10/03/2026 : ${fm(600)}\n\n`
      + 'Aucun frais bancaire : ses encaissements font exactement le crédit. Il sera rapproché par eux, et ne recevra plus aucun '
      + 'autre classement ; ses écritures se passent ensuite dans l’onglet Écritures, section « Ventes facturées ».',
    )
    // Plus rien à faire du crédit : ni rattachement ni facture à encaisser.
    expect(g.complement).toBeNull()
  })

  it('à l’écart des frais : la phrase et la confirmation portent les frais au compte des services bancaires du PLAN', () => {
    const s = sources({
      mouvements: [mouvement({ id: 'm1', montant: 1198.5 })],
      encaissements: [
        encaissement({ id: 'e2', facture_id: 'f2', montant: 600, ligne_bancaire_id: 'm1', cree_le: '2026-03-10T11:00:00Z', moyen: 'cheque' }),
        encaissement({ id: 'e1', facture_id: 'f1', montant: 600, ligne_bancaire_id: 'm1' }),
      ],
    })
    const g = gestes(s, 'm1', [], PLAN_DECALE)
    if (g.etat !== 'reserve') throw new Error(g.etat)
    expect(g.ensemble).toBe(
      `Ses encaissements font ${fm(1200)} pour un crédit de ${fm(1198.5)} : l’écart, ${fm(1.5)}, est celui des frais bancaires, `
      + `que ses écritures porteront au ${PLAN_DECALE.services_bancaires}.`,
    )
    expect(g.classement.refus).toBeNull()
    // Les factures dans l'ordre de la garde (la création), chacune avec son moyen, sa date et son montant.
    expect(g.classement.confirmation).toContain(
      `— Facture F2026-0014 (SARL Horizon) — virement du 10/03/2026 : ${fm(600)}\n`
      + `— Facture F2026-0015 (Cabinet Durand) — chèque du 10/03/2026 : ${fm(600)}\n\n`
      + `Les frais bancaires, ${fm(1.5)}, seront portés au ${PLAN_DECALE.services_bancaires} par ses écritures.`,
    )
    expect(PLAN_DECALE.services_bancaires).not.toBe(PLAN_PAR_DEFAUT.services_bancaires)
  })

  it('un écart que des frais n’expliquent pas : la phrase le dit, le refus de la base aussi, et rien à compléter', () => {
    const s = sources({
      mouvements: [mouvement({ id: 'm1', montant: 500 })],
      encaissements: [encaissement({ id: 'e1', facture_id: 'f1', montant: 600, ligne_bancaire_id: 'm1' })],
    })
    const g = gestes(s, 'm1')
    if (g.etat !== 'reserve') throw new Error(g.etat)
    expect(g.ensemble).toBe(`Ses encaissements font ${fm(600)} pour un crédit de ${fm(500)} : l’écart, ${fm(100)}, dépasse ce que des frais bancaires expliquent.`)
    expect(g.classement.refus).toBe(refus(REFUS_CLASSEMENT, 'credit_ecart', '600,00', '500,00'))
    expect(g.complement).toBeNull()
  })

  it('une remise de chèques pas encore faite : ce qui reste, le refus du classement, et de quoi la compléter', () => {
    const portes = [encaissement({ id: 'e1', facture_id: 'f1', montant: 600, ligne_bancaire_id: 'm1', moyen: 'cheque' })]
    const s = sources({
      mouvements: [mouvement({ id: 'm1', montant: 900 })],
      encaissements: [...portes, encaissement({ id: 'e3', facture_id: 'f3', montant: 300, moyen: 'cheque', date_encaissement: '2026-03-09' })],
    })
    const g = gestes(s, 'm1')
    if (g.etat !== 'reserve') throw new Error(g.etat)
    expect(g.ensemble).toBe(
      `Ses encaissements font ${fm(600)} pour un crédit de ${fm(900)} : il reste ${fm(300)} à rattacher ou à enregistrer pour `
      + 'faire le crédit, et son classement attend qu’il soit fait.',
    )
    expect(g.classement.refus).toBe(refus(REFUS_CLASSEMENT, 'credit_non_fait', '600,00', '900,00'))
    expect(g.complement?.manqueCentimes).toBe(30000)
    expect(g.complement?.rattachables.map((e) => [e.id, e.refus])).toEqual([['e3', null]])
    // L'état d'après : le chèque fait le crédit, qui reste à classer.
    expect(g.complement?.rattachables[0].confirmation).toBe(
      `Rattacher à ce crédit du 12/03/2026 de ${fm(900)} l’encaissement suivant ?\n\n`
      + `— Facture F2026-0016 (Atelier Martin) — chèque du 09/03/2026 : ${fm(300)}\n\n`
      + 'Un encaissement ne se rattache qu’une fois : il citera ce mouvement, que la base réserve alors à ses encaissements. '
      + 'Ses encaissements feront alors le crédit : il restera à le classer par eux.',
    )
  })

  it('daté d’un exercice validé : le refus de la base, et rien à compléter', () => {
    const s = sources({
      mouvements: [mouvement({ id: 'm1', montant: 900 })],
      encaissements: [
        encaissement({ id: 'e1', facture_id: 'f1', montant: 600, ligne_bancaire_id: 'm1' }),
        encaissement({ id: 'e3', facture_id: 'f3', montant: 300 }),
      ],
    })
    const g = gestes(s, 'm1', [2026])
    if (g.etat !== 'reserve') throw new Error(g.etat)
    expect(g.classement.refus).toBe(refus(REFUS_CLASSEMENT, 'frontiere', 'L\'exercice 2026 est validé'))
    expect(g.complement).toBeNull()
    // Un exercice d'avant ne fige rien : le complément revient.
    expect((gestes(s, 'm1', [2025]) as Extract<GestesDuCredit, { etat: 'reserve' }>).complement?.rattachables.map((e) => e.id)).toEqual(['e3'])
  })

  it('un encaissement d’une facture d’avant la bascule sur le crédit ne le réserve pas, et ne se compte pas', () => {
    const s = sources({
      mouvements: [mouvement({ id: 'm1', montant: 600 })],
      encaissements: [encaissement({ id: 'e0', facture_id: 'f0', montant: 600, ligne_bancaire_id: 'm1' })],
    })
    // Libre pour la garde : ce qui reste du crédit, c'est le crédit entier.
    const g = gestes(s, 'm1')
    expect(g.etat).toBe('libre')
    expect(manqueDuCredit(mouvement({ id: 'm1', montant: 600 }), s.encaissements, { factures: FACTURES })).toBe(60000)
  })
})

describe('un crédit CLASSÉ par ses encaissements : retirer ce classement', () => {
  const s = sources({
    mouvements: [mouvement({ id: 'm1', montant: 1198.5, statut: 'rapprochee', encaissements_de_factures: true })],
    encaissements: [
      encaissement({ id: 'e1', facture_id: 'f1', montant: 600, ligne_bancaire_id: 'm1' }),
      encaissement({ id: 'e2', facture_id: 'f2', montant: 600, ligne_bancaire_id: 'm1', cree_le: '2026-03-10T11:00:00Z' }),
      encaissement({ id: 'e2b', facture_id: 'f2', montant: 10, ligne_bancaire_id: 'm1', cree_le: '2026-03-10T12:00:00Z', retire_le: '2026-03-11T00:00:00Z' }),
    ],
  })

  it('la confirmation nomme les factures et dit que ses écritures deviennent « à retirer » dans l’onglet Écritures', () => {
    expect(gestes(s, 'm1')).toEqual({
      etat: 'classe',
      retrait: {
        refus: null,
        confirmation: `Retirer le classement de ce crédit du 12/03/2026 de ${fm(1198.5)} par ses encaissements (factures `
          + 'F2026-0014, F2026-0015) ?\n\nIl redevient à traiter, toujours réservé à ses encaissements : il ne reçoit aucun '
          + 'autre classement tant qu’ils le citent. Ses écritures, s’il en a été passé, deviennent « à retirer » dans '
          + 'l’onglet Écritures, section « Ventes facturées » : elles se retirent là.',
      },
    })
  })

  it('une seule facture : « facture », au singulier', () => {
    const une = { ...s, encaissements: s.encaissements.filter((e) => e.facture_id === 'f1') }
    const g = gestes(une, 'm1')
    expect(g.etat === 'classe' && g.retrait.confirmation).toContain('par ses encaissements (facture F2026-0014) ?')
  })

  it('daté d’un exercice validé : le refus de la base, avant le clic', () => {
    const g = gestes(s, 'm1', [2027])
    expect(g.etat === 'classe' && g.retrait.refus).toBe(
      refus(REFUS_RETRAIT_CLASSEMENT, 'frontiere', 'L\'exercice 2026 est figé par la validation de l\'exercice 2027'),
    )
  })
})

describe('un crédit LIBRE : rattacher un encaissement, ou enregistrer celui d’une facture', () => {
  // Le crédit de 300 € ; les candidats : e3 (300 €, la plus proche), e5 (310 € : au-delà des frais), e4 (120 €, deux dates).
  const ENCAISSEMENTS = [
    encaissement({ id: 'e4b', facture_id: 'f1', montant: 120, date_encaissement: '2026-03-08', moyen: 'cheque' }),
    encaissement({ id: 'e4a', facture_id: 'f1', montant: 120, date_encaissement: '2026-03-08', moyen: 'cheque' }),
    encaissement({ id: 'e4', facture_id: 'f1', montant: 120, date_encaissement: '2026-03-02', moyen: 'especes' }),
    encaissement({ id: 'e5', facture_id: 'f2', montant: 310 }),
    encaissement({ id: 'e3', facture_id: 'f3', montant: 300, moyen: 'cheque' }),
    // Écartés : retiré, déjà rattaché, une contre-passation, d'une facture d'avant la bascule, annulé par une
    // contre-passation sans mouvement, d'un autre dossier.
    encaissement({ id: 'x-retire', facture_id: 'f1', montant: 300, retire_le: '2026-03-11T00:00:00Z' }),
    encaissement({ id: 'x-cite', facture_id: 'f3', montant: 300, ligne_bancaire_id: 'm-autre' }),
    encaissement({ id: 'x-cp', facture_id: 'f3', montant: -50, annule_id: 'x-cite', ligne_bancaire_id: 'm-debit' }),
    encaissement({ id: 'x-avant', facture_id: 'f0', montant: 300 }),
    encaissement({ id: 'x-annule', facture_id: 'f1', montant: 300 }),
    encaissement({ id: 'x-cp2', facture_id: 'f1', montant: -300, annule_id: 'x-annule' }),
    encaissement({ id: 'x-ailleurs', facture_id: 'f-ailleurs', montant: 300, dossier_id: 'autre' }),
  ]
  const s = sources({
    mouvements: [mouvement({ id: 'm1', montant: 300 }), mouvement({ id: 'm-autre', montant: 300 })],
    encaissements: ENCAISSEMENTS,
    parts: partsDe(ENCAISSEMENTS.filter((e) => e.dossier_id === D)),
  })

  it('les rattachables : la sélection, le plus proche de ce qui reste d’abord, puis la date, puis l’identifiant', () => {
    const g = gestes(s, 'm1')
    if (g.etat !== 'libre') throw new Error(g.etat)
    expect(g.complement.manqueCentimes).toBe(30000)
    expect(g.complement.rattachables.map((e) => e.id)).toEqual(['e3', 'e5', 'e4', 'e4a', 'e4b'])
    expect(g.complement.rattachables[0]).toMatchObject({ libelle: 'Facture F2026-0016 (Atelier Martin) — chèque du 10/03/2026', montant: 300 })
    expect(g.complement.note).toBeNull()
  })

  it('chacun jugé par `refusRattachement`, sous ses mots ; l’état d’après dit ce qui restera', () => {
    const g = gestes(s, 'm1')
    if (g.etat !== 'libre') throw new Error(g.etat)
    const par = new Map(g.complement.rattachables.map((e) => [e.id, e]))
    expect(par.get('e3')?.refus).toBeNull()
    expect(par.get('e5')?.refus).toBe(refus(REFUS_RATTACHEMENT, 'mouvement_depasse', '300,00', '310,00'))
    expect(par.get('e4')?.refus).toBeNull()
    expect(par.get('e4')?.confirmation).toContain(`Il restera ${fm(180)} pour faire le crédit : son classement attendra qu’il soit fait.`)
    expect(par.get('e4')?.confirmation).toContain(`— Facture F2026-0014 (SARL Horizon) — espèces du 02/03/2026 : ${fm(120)}`)
  })

  it('le crédit porte déjà l’encaissement d’une facture d’avant la bascule : le rattachement le compte, le classement non', () => {
    const avecAvant = {
      ...s,
      encaissements: [...s.encaissements, encaissement({ id: 'e0', facture_id: 'f0', montant: 100, ligne_bancaire_id: 'm1' })],
    }
    const g = gestes(avecAvant, 'm1')
    if (g.etat !== 'libre') throw new Error(g.etat)
    const par = new Map(g.complement.rattachables.map((e) => [e.id, e]))
    // e3 (300 €) : le crédit justifierait 400 € — au-delà des frais, la base refuse.
    expect(par.get('e3')?.refus).toBe(refus(REFUS_RATTACHEMENT, 'mouvement_depasse', '300,00', '400,00'))
    // e4 (120 €) : admis ; le classement, lui, ne compterait que les 120 € de la facture source (VF2-Q2, VF5h).
    expect(par.get('e4')?.refus).toBeNull()
    expect(par.get('e4')?.confirmation).toContain(`Il restera ${fm(180)} pour faire le crédit`)
  })

  it('les factures à encaisser : sources, validées, des factures, un reste net de leurs avoirs ; la plus proche d’abord', () => {
    const g = gestes(s, 'm1')
    if (g.etat !== 'libre') throw new Error(g.etat)
    // f1 : 600 − 3 × 120 = 240 ; f2 : 600 − 120 (l'avoir) − 310 = 170 ; f3 : 300 − 300 = 0, soldée ; f0 d'avant la bascule,
    // a2 un avoir, fb un brouillon : jamais.
    expect(g.complement.factures.map((f) => [f.facture.id, f.resteCentimes])).toEqual([['f1', 24000], ['f2', 17000]])
    expect(g.complement.factures[0].libelle).toBe(`F2026-0014 — SARL Horizon, du 01/03/2026 — reste ${fm(240)}`)
  })

  it('à égale distance, les factures se départagent par leur numéro, puis leur identifiant', () => {
    // Les identifiants rangés à rebours des numéros : l'ordre dit lequel des deux départage d'abord.
    const egales = sources({
      factures: [facture({ id: 'fa', numero: 'F2026-0002' }), facture({ id: 'fc', numero: 'F2026-0001' }), facture({ id: 'fb', numero: 'F2026-0001' })],
      lignes: [ligne('fa', 500), ligne('fc', 500), ligne('fb', 500)],
      mouvements: [mouvement({ id: 'm1', montant: 100 })],
    })
    const g = gestes(egales, 'm1')
    expect(g.etat === 'libre' && g.complement.factures.map((f) => f.facture.id)).toEqual(['fb', 'fc', 'fa'])
  })

  it('un encaissement d’un autre dossier, rendu par erreur, n’est jamais candidat — même d’une facture de ce dossier', () => {
    const g = gestes(sources({
      mouvements: [mouvement({ id: 'm1', montant: 120 })],
      encaissements: [encaissement({ id: 'e-ailleurs', facture_id: 'f3', montant: 120, dossier_id: 'autre' })],
    }), 'm1')
    if (g.etat !== 'libre') throw new Error(g.etat)
    expect(g.complement.rattachables).toEqual([])
  })

  it('un second encaissement de la même facture sur un crédit qui en porte un : la base le refuse, le module le dit', () => {
    const remise = sources({
      mouvements: [mouvement({ id: 'm1', montant: 500 })],
      encaissements: [
        encaissement({ id: 'e1', facture_id: 'f1', montant: 300, ligne_bancaire_id: 'm1', moyen: 'cheque' }),
        encaissement({ id: 'e1b', facture_id: 'f1', montant: 200, moyen: 'cheque' }),
      ],
    })
    const g = gestes(remise, 'm1')
    if (g.etat !== 'reserve') throw new Error(g.etat)
    expect(g.complement?.rattachables.map((e) => [e.id, e.refus])).toEqual([['e1b', refus(REFUS_RATTACHEMENT, 'mouvement_deja_pris')]])
  })

  it('une facture source d’un autre dossier, rendue par erreur, n’est jamais candidate — ni ses encaissements', () => {
    const ailleurs = facture({ id: 'fz', numero: 'F2026-0099', dossier_id: 'autre' })
    const g = gestes(sources({
      factures: [...FACTURES, ailleurs], lignes: [...LIGNES, ligne('fz', 100)],
      mouvements: [mouvement({ id: 'm1', montant: 120 })],
      encaissements: [encaissement({ id: 'ez', facture_id: 'fz', montant: 120 })],
    }), 'm1')
    if (g.etat !== 'libre') throw new Error(g.etat)
    expect(g.complement.rattachables.map((e) => e.id)).toEqual([])
    expect(g.complement.factures.map((f) => f.facture.id)).not.toContain('fz')
  })

  it('rien à rattacher ni à encaisser : aucun geste sur un crédit libre — c’est une recette sans facture', () => {
    expect(gestes(sources({ mouvements: [mouvement({ id: 'm1' })], factures: [FACTURES[3]] }), 'm1')).toEqual(AUCUN_GESTE)
  })

  it('daté d’un exercice validé : aucun geste', () => {
    expect(gestes(s, 'm1', [2026])).toEqual(AUCUN_GESTE)
  })

  it('réservé sans rien pour le compléter : la note le dit', () => {
    const seul = sources({
      factures: [FACTURES[0]],
      mouvements: [mouvement({ id: 'm1', montant: 900 })],
      encaissements: [encaissement({ id: 'e1', facture_id: 'f1', montant: 600, ligne_bancaire_id: 'm1' })],
      parts: partsDe([encaissement({ id: 'e1', facture_id: 'f1', montant: 600 })]),
    })
    const g = gestes(seul, 'm1')
    if (g.etat !== 'reserve') throw new Error(g.etat)
    expect(g.complement).toEqual({
      manqueCentimes: 30000, rattachables: [], factures: [],
      note: 'Aucun encaissement de facture source n’attend son mouvement, et aucune facture source ne reste à encaisser : rien ne '
        + 'se rattache ni ne s’enregistre ici.',
    })
  })
})

describe('montantSurLeCredit et manqueDuCredit : la saisie de la fenêtre sur un crédit imposé', () => {
  it('le reste entier quand ce qui reste du crédit le fait à l’écart des frais ; sinon le plus petit des deux', () => {
    expect(montantSurLeCredit(60000, 60000)).toBe(60000)
    expect(montantSurLeCredit(60000, 59850)).toBe(60000)
    // 2 % de 600 € : 12 €, mais 5 € au plus — 5 € tout juste passe, 5,01 € non.
    expect(montantSurLeCredit(60000, 59500)).toBe(60000)
    expect(montantSurLeCredit(60000, 59499)).toBe(59499)
    // 2 % de 100 € : 2 € tout juste passe, 2,01 € non.
    expect(montantSurLeCredit(10000, 9800)).toBe(10000)
    expect(montantSurLeCredit(10000, 9799)).toBe(9799)
    // Une remise : le crédit dépasse la facture.
    expect(montantSurLeCredit(30000, 90000)).toBe(30000)
    // Rien ne reste du crédit : le reste de la facture, que la base jugera.
    expect(montantSurLeCredit(30000, 0)).toBe(30000)
    expect(montantSurLeCredit(30000, -150)).toBe(30000)
  })

  it('ce qui reste du crédit ne compte que les encaissements de factures sources qui le justifient, non retirés', () => {
    const m = mouvement({ id: 'm1', montant: 1000 })
    const registre = [
      encaissement({ id: 'a', facture_id: 'f1', montant: 300, ligne_bancaire_id: 'm1' }),
      encaissement({ id: 'b', facture_id: 'f0', montant: 200, ligne_bancaire_id: 'm1' }),
      encaissement({ id: 'c', facture_id: 'f2', montant: 100, ligne_bancaire_id: 'm1', retire_le: '2026-03-11T00:00:00Z' }),
      encaissement({ id: 'd', facture_id: 'f3', montant: 50, ligne_bancaire_id: 'm1' }),
      encaissement({ id: 'd-cp', facture_id: 'f3', montant: -50, annule_id: 'd' }),
      encaissement({ id: 'e', facture_id: 'f2', montant: 40, ligne_bancaire_id: 'm-autre' }),
    ]
    expect(manqueDuCredit(m, registre, { factures: FACTURES })).toBe(70000)
  })
})
