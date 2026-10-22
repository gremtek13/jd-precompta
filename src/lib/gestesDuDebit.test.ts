import { describe, expect, it } from 'vitest'
import type { AccesDuDossier } from './auteursVentes'
import {
  REFUS_CLASSEMENT, REFUS_RETRAIT_CLASSEMENT, remplirModele, type DeclarationLue, type LigneDeFacture, type MouvementClasse,
} from './encaissementsFactures'
import { formatMoney } from './format'
import {
  AUCUN_GESTE, gestesDuCredit, gestesDuDebit, manqueDuDebit, ventesDuReleve,
  type EncaissementDuMouvementLu, type FactureDesGestes, type GestesDuDebit, type LectureDuDebit, type SourcesDuDebit,
} from './mouvementsDesVentes'
import { PLAN_DECALE, PLAN_PAR_DEFAUT } from './planComptable'

// LA FICHE D'UN DÉBIT : L'IMPAYÉ ET LA SOMME RENDUE (ligne 28.65, chantier EC-Q3, étape VF5d). Le module ne recopie
// aucune règle de la base : chaque candidat est choisi par `refusRattachement` ou `refusContrePassationVente`, chaque
// refus est celui de `refusClassement` ou de `refusRetraitDuClassement` (lib/encaissementsFactures.ts, confrontés au
// texte des fonctions). Ces cas gardent ce que `gestesDuDebit` en tire — quel geste s'offre, sur quel débit, la
// sélection et l'ordre des candidats, les phrases et l'état d'après —, et la retenue de VF5a1. Données FICTIVES.

const D = 'd-bascule'
const ACCES: AccesDuDossier = { etat: 'lus', comptes: ['u-client'] }
const AUJOURDHUI = '2026-10-22'
const fm = (euros: number) => formatMoney(euros)

const facture = (o: Partial<FactureDesGestes> & Pick<FactureDesGestes, 'id' | 'numero'>): FactureDesGestes => ({
  dossier_id: D, type: 'facture', statut: 'validee', facture_origine_id: null, source_de_la_vente: true, tiers_nom: 'Client fictif',
  date_emission: '2026-03-01', montant_ttc: 600, ...o,
})

const ligne = (factureId: string, ht: number): LigneDeFacture => ({
  facture_id: factureId, ordre: 1, designation: 'Prestation fictive', quantite: 1, prix_unitaire_ht: ht, taux_tva: 20,
})

const encaissement = (
  o: Partial<EncaissementDuMouvementLu> & Pick<EncaissementDuMouvementLu, 'id' | 'facture_id' | 'montant'>,
): EncaissementDuMouvementLu => ({
  dossier_id: D, date_encaissement: '2026-03-10', moyen: 'cheque', ligne_bancaire_id: null, annule_id: null,
  cree_le: '2026-03-10T10:00:00Z', retire_le: null, cree_par: 'u-cabinet', ...o,
})

const mouvement = (o: Partial<MouvementClasse> & Pick<MouvementClasse, 'id'>): MouvementClasse => ({
  dossier_id: D, date: '2026-03-20', montant: -600, statut: 'non_rapprochee', piece_id: null, cotisation_id: null, categorie_id: null,
  emprunt_id: null, compte_bilan: null, declaration_tva_id: null, ventilee: false, reglement_groupe: false, prelevement_personnel: false,
  encaissements_de_factures: false, ...o,
})

const declare = (encaissementId: string, etat: DeclarationLue['etat'] = 'accepte') => ({ encaissement_id: encaissementId, etat })

// Trois factures sources (600 €, 600 €, 300 €) et une d'avant la bascule.
const FACTURES = [
  facture({ id: 'f1', numero: 'F2026-0014', tiers_nom: 'SARL Horizon' }),
  facture({ id: 'f2', numero: 'F2026-0015', tiers_nom: 'Cabinet Durand' }),
  facture({ id: 'f3', numero: 'F2026-0016', tiers_nom: 'Atelier Martin', montant_ttc: 300 }),
  facture({ id: 'f0', numero: 'F2025-0099', source_de_la_vente: false }),
]
const LIGNES = [ligne('f1', 500), ligne('f2', 500), ligne('f3', 250), ligne('f0', 500)]

function sources(o: Partial<SourcesDuDebit> = {}): SourcesDuDebit {
  return { dossierId: D, factures: FACTURES, lignes: LIGNES, encaissements: [], parts: [], mouvements: [], declarations: [], ...o }
}

const lue = (s: SourcesDuDebit): LectureDuDebit => ({ dossierId: D, etat: 'lue', sources: s })

// La fiche telle que l'onglet la calcule : l'état du relevé tiré de la MÊME lecture.
function gestes(s: SourcesDuDebit, id: string, annees: readonly number[] = [], plan = PLAN_PAR_DEFAUT, aujourdHui = AUJOURDHUI): GestesDuDebit {
  return gestesDuDebit(ventesDuReleve(true, D, lue(s), ACCES), lue(s), { id, dossier_id: D }, annees, plan, aujourdHui)
}

function refus(liste: readonly { cle: string; modele: string }[], cle: string, ...valeurs: string[]): string {
  return remplirModele((liste.find((r) => r.cle === cle) as { modele: string }).modele, valeurs)
}

const complementDe = (g: GestesDuDebit) => (g.etat === 'libre' || g.etat === 'reserve' ? g.complement : null)

describe('gestesDuDebit : la retenue de VF5a1 — rien ne s’offre sans des ventes lues en entier', () => {
  const s = sources({
    mouvements: [mouvement({ id: 'd1' })],
    encaissements: [encaissement({ id: 'e1', facture_id: 'f1', montant: 600 })],
    declarations: [declare('e1')],
  })
  const ici = { id: 'd1', dossier_id: D }

  it('un dossier qui n’a pas basculé, des ventes pas encore revenues ou lues en partie : aucun geste', () => {
    expect(gestes(s, 'd1').etat).toBe('libre')
    expect(gestesDuDebit({ etat: 'sans_objet' }, lue(s), ici, [], PLAN_PAR_DEFAUT, AUJOURDHUI)).toEqual(AUCUN_GESTE)
    expect(gestesDuDebit({ etat: 'en_cours' }, lue(s), ici, [], PLAN_PAR_DEFAUT, AUJOURDHUI)).toEqual(AUCUN_GESTE)
    expect(gestesDuDebit({ etat: 'incomplete', motif: 'refusée' }, lue(s), ici, [], PLAN_PAR_DEFAUT, AUJOURDHUI)).toEqual(AUCUN_GESTE)
  })

  it('une lecture absente, incomplète ou d’un autre dossier : aucun geste, même si le relevé se dit lu', () => {
    const v = ventesDuReleve(true, D, lue(s), ACCES)
    expect(gestesDuDebit(v, null, ici, [], PLAN_PAR_DEFAUT, AUJOURDHUI)).toEqual(AUCUN_GESTE)
    expect(gestesDuDebit(v, { dossierId: D, etat: 'incomplete', motif: 'les déclarations des encaissements : refusée' }, ici, [], PLAN_PAR_DEFAUT, AUJOURDHUI))
      .toEqual(AUCUN_GESTE)
    expect(gestesDuDebit(v, { ...lue(s), dossierId: 'autre' }, ici, [], PLAN_PAR_DEFAUT, AUJOURDHUI)).toEqual(AUCUN_GESTE)
    expect(gestesDuDebit(v, lue({ ...s, dossierId: 'autre' }), ici, [], PLAN_PAR_DEFAUT, AUJOURDHUI)).toEqual(AUCUN_GESTE)
    expect(gestesDuDebit(v, lue(s), { id: 'd1', dossier_id: 'autre' }, [], PLAN_PAR_DEFAUT, AUJOURDHUI)).toEqual(AUCUN_GESTE)
  })

  it('un débit que la lecture n’a pas rendu, ou d’un autre dossier : aucun geste', () => {
    expect(gestes(s, 'd-absent')).toEqual(AUCUN_GESTE)
    expect(gestes({ ...s, mouvements: [mouvement({ id: 'd1', dossier_id: 'autre' })] }, 'd1')).toEqual(AUCUN_GESTE)
  })

  it('un crédit n’a rien de VF5d, un débit nul non plus ; un débit classé autrement non plus', () => {
    expect(gestes({ ...s, mouvements: [mouvement({ id: 'd1', montant: 600 })] }, 'd1')).toEqual(AUCUN_GESTE)
    expect(gestes({ ...s, mouvements: [mouvement({ id: 'd1', montant: 0 })] }, 'd1')).toEqual(AUCUN_GESTE)
    expect(gestes({ ...s, mouvements: [mouvement({ id: 'd1', statut: 'rapprochee', piece_id: 'p1' })] }, 'd1')).toEqual(AUCUN_GESTE)
    expect(gestes({ ...s, mouvements: [mouvement({ id: 'd1', categorie_id: 'cat', statut: 'rapprochee' })] }, 'd1')).toEqual(AUCUN_GESTE)
  })

  it('et la fiche d’un crédit ne change pas : un débit y reste sans geste', () => {
    expect(gestesDuCredit(ventesDuReleve(true, D, lue(s), ACCES), lue(s), ici, [], PLAN_PAR_DEFAUT)).toEqual(AUCUN_GESTE)
  })
})

describe('un débit LIBRE : contre-passer l’encaissement déclaré d’une facture', () => {
  // Le débit de 600 € du 20/03/2026 — le chèque revenu impayé. Candidats : e1 et e2 (600 €, à égale distance : la
  // date), e3 (300 €). Écartés, chacun par le jugement de la base : jamais déclaré, déclaration échouée ou rejetée,
  // issue inconnue, d'une facture d'avant la bascule, retiré, déjà contre-passé, au-delà des frais, postérieur au
  // débit, une contre-passation elle-même, d'un autre dossier.
  const ENCAISSEMENTS = [
    encaissement({ id: 'e2', facture_id: 'f2', montant: 600, moyen: 'virement', date_encaissement: '2026-03-11' }),
    encaissement({ id: 'e1', facture_id: 'f1', montant: 600, ligne_bancaire_id: 'c1' }),
    encaissement({ id: 'e3', facture_id: 'f3', montant: 300, date_encaissement: '2026-03-09' }),
    encaissement({ id: 'x-non-declare', facture_id: 'f1', montant: 600 }),
    encaissement({ id: 'x-echec', facture_id: 'f2', montant: 600 }),
    encaissement({ id: 'x-rejete', facture_id: 'f2', montant: 600 }),
    encaissement({ id: 'x-envoi', facture_id: 'f2', montant: 600 }),
    encaissement({ id: 'x-avant', facture_id: 'f0', montant: 600 }),
    encaissement({ id: 'x-retire', facture_id: 'f3', montant: 300, retire_le: '2026-03-15T00:00:00Z' }),
    encaissement({ id: 'x-deja', facture_id: 'f3', montant: 100 }),
    encaissement({ id: 'x-cp-deja', facture_id: 'f3', montant: -100, annule_id: 'x-deja', ligne_bancaire_id: 'd-autre' }),
    encaissement({ id: 'x-trop', facture_id: 'f2', montant: 700 }),
    encaissement({ id: 'x-apres', facture_id: 'f1', montant: 600, date_encaissement: '2026-03-25' }),
    encaissement({ id: 'x-ailleurs', facture_id: 'f1', montant: 600, dossier_id: 'autre' }),
  ]
  const s = sources({
    mouvements: [mouvement({ id: 'd1' }), mouvement({ id: 'c1', montant: 600, date: '2026-03-12' }), mouvement({ id: 'd-autre', montant: -100 })],
    encaissements: ENCAISSEMENTS,
    declarations: [
      declare('e1'), declare('e2', 'depose'), declare('e3'), declare('x-echec', 'echec'), declare('x-rejete', 'rejete'),
      declare('x-envoi', 'envoi'), declare('x-avant'), declare('x-retire'), declare('x-deja'), declare('x-cp-deja'), declare('x-trop'),
      declare('x-apres'), declare('x-ailleurs'),
    ],
  })

  it('les candidats : déclarés, acceptés avec ce débit à sa date ; le plus proche de ce qui reste d’abord, puis la date', () => {
    const g = gestes(s, 'd1')
    if (g.etat !== 'libre') throw new Error(g.etat)
    expect(g.complement.manqueCentimes).toBe(60000)
    expect(g.complement.aContrePasser.map((e) => e.id)).toEqual(['e1', 'e2', 'e3'])
    expect(g.complement.aContrePasser[0]).toMatchObject({
      libelle: 'Facture F2026-0014 (SARL Horizon) — chèque du 10/03/2026', montant: 600, facture: FACTURES[0],
    })
    expect(g.complement.note).toBeNull()
  })

  it('l’état d’après : la contre-passation fait le débit, ou il restera à faire', () => {
    const g = gestes(s, 'd1')
    if (g.etat !== 'libre') throw new Error(g.etat)
    const par = new Map(g.complement.aContrePasser.map((e) => [e.id, e]))
    expect(par.get('e1')?.apres).toBe('Ses contre-passations feront alors le débit : il restera à le classer par elles.')
    expect(par.get('e3')?.apres).toBe(`Il restera ${fm(300)} pour faire le débit : son classement attendra qu’il soit fait.`)
  })

  it('la date du débit est celle que la contre-passation reçoit : dans l’avenir, ou avant l’encaissement, rien', () => {
    // Le jour à Paris avant le débit : la base refuserait une contre-passation datée de demain.
    expect(complementDe(gestes(s, 'd1', [], PLAN_PAR_DEFAUT, '2026-03-19'))).toBeNull()
    expect(complementDe(gestes(s, 'd1', [], PLAN_PAR_DEFAUT, '2026-03-20'))?.aContrePasser.map((e) => e.id)).toEqual(['e1', 'e2', 'e3'])
    // Un débit daté du 10/03 : seuls les encaissements de ce jour ou d'avant.
    const tot = { ...s, mouvements: [mouvement({ id: 'd1', date: '2026-03-10' })] }
    expect(complementDe(gestes(tot, 'd1'))?.aContrePasser.map((e) => e.id)).toEqual(['e1', 'e3'])
  })

  it('à égale distance et à la même date, l’identifiant départage', () => {
    const egaux = sources({
      mouvements: [mouvement({ id: 'd1' })],
      encaissements: [
        encaissement({ id: 'eb', facture_id: 'f1', montant: 600 }), encaissement({ id: 'ea', facture_id: 'f2', montant: 600 }),
        encaissement({ id: 'ec', facture_id: 'f3', montant: 600, date_encaissement: '2026-03-05' }),
      ],
      declarations: [declare('eb'), declare('ea'), declare('ec')],
    })
    expect(complementDe(gestes(egaux, 'd1'))?.aContrePasser.map((e) => e.id)).toEqual(['ec', 'ea', 'eb'])
  })

  it('un encaissement que le débit ne fait qu’aux frais près — la base l’admet, le classement le refusera : la phrase le dit', () => {
    const g = gestes(sources({
      mouvements: [mouvement({ id: 'd1', montant: -120 })],
      encaissements: [encaissement({ id: 'e1', facture_id: 'f1', montant: 120.5 })],
      declarations: [declare('e1')],
    }), 'd1')
    if (g.etat !== 'libre') throw new Error(g.etat)
    expect(g.complement.aContrePasser.map((e) => [e.id, e.apres])).toEqual([[
      'e1', `Il ne pourra pas se classer par ses contre-passations : « ${refus(REFUS_CLASSEMENT, 'debit_depasse', '120,50', '120,00')} »`,
    ]])
  })

  it('rien à contre-passer ni à rattacher : aucun geste — c’est une dépense', () => {
    expect(gestes(sources({ mouvements: [mouvement({ id: 'd1' })], encaissements: [encaissement({ id: 'e', facture_id: 'f1', montant: 600 })] }), 'd1'))
      .toEqual(AUCUN_GESTE)
  })

  it('daté d’un exercice validé : aucun geste', () => {
    expect(gestes(s, 'd1', [2026])).toEqual(AUCUN_GESTE)
    expect(gestes(s, 'd1', [2025]).etat).toBe('libre')
  })
})

describe('un débit LIBRE : rattacher une contre-passation enregistrée sans mouvement', () => {
  // Le débit de 300 € ; candidates : cp1 (300 €, la plus proche ; son encaissement cite le crédit c1), cp2 (120 €).
  // Écartées par le jugement de la base : d'une facture d'avant la bascule, retirée, déjà rattachée, au-delà des frais,
  // dont le crédit d'origine est classé, un encaissement (un crédit), d'un autre dossier.
  const ENCAISSEMENTS = [
    encaissement({ id: 'o1', facture_id: 'f1', montant: 300, ligne_bancaire_id: 'c1' }),
    encaissement({ id: 'cp1', facture_id: 'f1', montant: -300, annule_id: 'o1', date_encaissement: '2026-03-18' }),
    encaissement({ id: 'o2', facture_id: 'f2', montant: 120, moyen: 'virement' }),
    encaissement({ id: 'cp2', facture_id: 'f2', montant: -120, annule_id: 'o2', moyen: 'virement', date_encaissement: '2026-03-15' }),
    encaissement({ id: 'o3', facture_id: 'f0', montant: 50 }),
    encaissement({ id: 'x-avant', facture_id: 'f0', montant: -50, annule_id: 'o3' }),
    encaissement({ id: 'o4', facture_id: 'f3', montant: 50 }),
    encaissement({ id: 'x-retiree', facture_id: 'f3', montant: -50, annule_id: 'o4', retire_le: '2026-03-16T00:00:00Z' }),
    encaissement({ id: 'o5', facture_id: 'f3', montant: 40 }),
    encaissement({ id: 'x-citee', facture_id: 'f3', montant: -40, annule_id: 'o5', ligne_bancaire_id: 'd-autre' }),
    encaissement({ id: 'o6', facture_id: 'f2', montant: 400 }),
    encaissement({ id: 'x-trop', facture_id: 'f2', montant: -400, annule_id: 'o6' }),
    encaissement({ id: 'o7', facture_id: 'f1', montant: 60, ligne_bancaire_id: 'c7' }),
    encaissement({ id: 'x-origine-classee', facture_id: 'f1', montant: -60, annule_id: 'o7' }),
    encaissement({ id: 'x-credit', facture_id: 'f1', montant: 100 }),
    encaissement({ id: 'x-ailleurs', facture_id: 'f1', montant: -30, annule_id: 'o1', dossier_id: 'autre' }),
  ]
  const s = sources({
    mouvements: [
      mouvement({ id: 'd1', montant: -300 }), mouvement({ id: 'c1', montant: 300, date: '2026-03-12' }),
      mouvement({ id: 'c7', montant: 60, statut: 'rapprochee', encaissements_de_factures: true }), mouvement({ id: 'd-autre', montant: -40 }),
    ],
    encaissements: ENCAISSEMENTS,
  })

  it('les rattachables : celles que la base rattacherait, la plus proche de ce qui reste d’abord, chacune sans refus', () => {
    const g = gestes(s, 'd1')
    if (g.etat !== 'libre') throw new Error(g.etat)
    expect(g.complement.rattachables.map((e) => [e.id, e.refus])).toEqual([['cp1', null], ['cp2', null]])
    expect(g.complement.rattachables[1]).toMatchObject({
      libelle: 'Contre-passation, facture F2026-0015 (Cabinet Durand) — virement du 15/03/2026', montant: -120,
    })
    expect(g.complement.aContrePasser).toEqual([])
  })

  it('la confirmation nomme la contre-passation, dit ce qu’elle rend à son encaissement et l’état d’après', () => {
    const g = gestes(s, 'd1')
    if (g.etat !== 'libre') throw new Error(g.etat)
    const [cp1, cp2] = g.complement.rattachables
    expect(cp1.confirmation).toBe(
      `Rattacher à ce débit du 20/03/2026 de ${fm(-300)} la contre-passation suivante ?\n\n`
      + `— Contre-passation, facture F2026-0014 (SARL Horizon) — chèque du 18/03/2026 : ${fm(-300)}\n\n`
      + 'Une contre-passation ne se rattache qu’une fois : elle citera ce débit, que la base réserve alors à ses '
      + 'contre-passations. L’encaissement qu’elle annule justifie alors de nouveau le crédit du 12/03/2026 qu’il cite : '
      + 'l’argent est venu, puis reparti par ce débit. Ses contre-passations feront alors le débit : il restera à le classer '
      + 'par elles.',
    )
    // Un encaissement sans mouvement : rien à en dire ; il restera 180 € pour faire le débit.
    expect(cp2.confirmation).toBe(
      `Rattacher à ce débit du 20/03/2026 de ${fm(-300)} la contre-passation suivante ?\n\n`
      + `— Contre-passation, facture F2026-0015 (Cabinet Durand) — virement du 15/03/2026 : ${fm(-120)}\n\n`
      + 'Une contre-passation ne se rattache qu’une fois : elle citera ce débit, que la base réserve alors à ses '
      + `contre-passations. Il restera ${fm(180)} pour faire le débit : son classement attendra qu’il soit fait.`,
    )
  })

  it('un crédit d’origine que la lecture n’a pas rendu se dit « le mouvement »', () => {
    const g = gestes({ ...s, mouvements: s.mouvements.filter((m) => m.id !== 'c1') }, 'd1')
    expect(complementDe(g)?.rattachables[0].confirmation).toContain('justifie alors de nouveau le mouvement qu’il cite')
  })

  it('à égale distance, la date puis l’identifiant départagent', () => {
    const egales = sources({
      mouvements: [mouvement({ id: 'd1', montant: -100 })],
      encaissements: [
        encaissement({ id: 'ob', facture_id: 'f1', montant: 100 }), encaissement({ id: 'cpb', facture_id: 'f1', montant: -100, annule_id: 'ob' }),
        encaissement({ id: 'oa', facture_id: 'f2', montant: 100 }), encaissement({ id: 'cpa', facture_id: 'f2', montant: -100, annule_id: 'oa' }),
        encaissement({ id: 'oc', facture_id: 'f3', montant: 100 }),
        encaissement({ id: 'cpc', facture_id: 'f3', montant: -100, annule_id: 'oc', date_encaissement: '2026-03-01' }),
      ],
    })
    expect(complementDe(gestes(egales, 'd1'))?.rattachables.map((e) => e.id)).toEqual(['cpc', 'cpa', 'cpb'])
  })
})

describe('un débit RÉSERVÉ : classer par ses contre-passations', () => {
  const portee = (montant: number, o: Partial<EncaissementDuMouvementLu> = {}) => [
    encaissement({ id: 'e1', facture_id: 'f1', montant: -montant, ligne_bancaire_id: 'c1' }),
    encaissement({ id: 'cp1', facture_id: 'f1', montant, annule_id: 'e1', ligne_bancaire_id: 'd1', date_encaissement: '2026-03-20', ...o }),
  ]

  it('ses contre-passations font exactement le débit : la phrase, aucun refus, la confirmation, rien à compléter', () => {
    const s = sources({ mouvements: [mouvement({ id: 'd1' }), mouvement({ id: 'c1', montant: 600 })], encaissements: portee(-600) })
    const g = gestes(s, 'd1')
    if (g.etat !== 'reserve') throw new Error(g.etat)
    expect(g.ensemble).toBe(`Ses contre-passations font exactement le débit, ${fm(600)}.`)
    expect(g.classement.refus).toBeNull()
    expect(g.classement.confirmation).toBe(
      `Classer ce débit du 20/03/2026 de ${fm(-600)} par ses contre-passations ?\n\n`
      + `— Contre-passation, facture F2026-0014 (SARL Horizon) — chèque du 20/03/2026 : ${fm(-600)}\n\n`
      + 'Aucun frais bancaire : ses contre-passations font exactement le débit. Il sera rapproché par elles, et ne recevra '
      + 'plus aucun autre classement ; ses écritures se passent ensuite dans l’onglet Écritures, section « Ventes facturées ».',
    )
    expect(g.complement).toBeNull()
  })

  it('la banque débite un peu plus — l’écart des frais : porté au compte des services bancaires du PLAN', () => {
    const s = sources({
      mouvements: [mouvement({ id: 'd1', montant: -601.5 }), mouvement({ id: 'c1', montant: 600 })], encaissements: portee(-600),
    })
    const g = gestes(s, 'd1', [], PLAN_DECALE)
    if (g.etat !== 'reserve') throw new Error(g.etat)
    expect(g.ensemble).toBe(
      `Ses contre-passations font ${fm(600)} pour un débit de ${fm(601.5)} : l’écart, ${fm(1.5)}, est celui des frais `
      + `bancaires, que ses écritures porteront au ${PLAN_DECALE.services_bancaires}.`,
    )
    expect(g.classement.refus).toBeNull()
    expect(g.classement.confirmation).toContain(`Les frais bancaires, ${fm(1.5)}, seront portés au ${PLAN_DECALE.services_bancaires} par ses écritures.`)
    expect(PLAN_DECALE.services_bancaires).not.toBe(PLAN_PAR_DEFAUT.services_bancaires)
    // Fait aux frais près : rien à compléter.
    expect(g.complement).toBeNull()
  })

  it('des contre-passations qui dépassent le débit, fût-ce de quelques frais : la phrase, le refus de la base, rien à compléter', () => {
    const s = sources({
      mouvements: [mouvement({ id: 'd1', montant: -120 }), mouvement({ id: 'c1', montant: 120.5 })], encaissements: portee(-120.5),
    })
    const g = gestes(s, 'd1')
    if (g.etat !== 'reserve') throw new Error(g.etat)
    expect(g.ensemble).toBe(
      `Ses contre-passations font ${fm(120.5)} pour un débit de ${fm(120)} : elles le dépassent de ${fm(0.5)}. La base ne `
      + 'classe un débit que si ses contre-passations le font, ou qu’il les dépasse de quelques frais — jamais l’inverse.',
    )
    expect(g.classement.refus).toBe(refus(REFUS_CLASSEMENT, 'debit_depasse', '120,50', '120,00'))
    expect(g.complement).toBeNull()
  })

  it('deux chèques revenus ensemble, un seul contre-passé : ce qui reste, le refus du classement, et de quoi le compléter', () => {
    const s = sources({
      mouvements: [mouvement({ id: 'd1', montant: -900 }), mouvement({ id: 'c1', montant: 600 })],
      encaissements: [
        ...portee(-600),
        encaissement({ id: 'e3', facture_id: 'f3', montant: 300 }),
        encaissement({ id: 'o2', facture_id: 'f2', montant: 300 }),
        encaissement({ id: 'cp2', facture_id: 'f2', montant: -300, annule_id: 'o2', date_encaissement: '2026-03-19' }),
      ],
      declarations: [declare('e1'), declare('e3')],
    })
    const g = gestes(s, 'd1')
    if (g.etat !== 'reserve') throw new Error(g.etat)
    expect(g.ensemble).toBe(
      `Ses contre-passations font ${fm(600)} pour un débit de ${fm(900)} : il reste ${fm(300)} à rattacher ou à contre-passer `
      + 'pour faire le débit, et son classement attend qu’il soit fait.',
    )
    expect(g.classement.refus).toBe(refus(REFUS_CLASSEMENT, 'debit_ecart', '600,00', '900,00'))
    expect(g.complement?.manqueCentimes).toBe(30000)
    expect(g.complement?.rattachables.map((e) => e.id)).toEqual(['cp2'])
    expect(g.complement?.rattachables[0].confirmation).toContain('Ses contre-passations feront alors le débit : il restera à le classer par elles.')
    // e1 est déjà contre-passé par cp1 : seul e3 se contre-passe encore.
    expect(g.complement?.aContrePasser.map((e) => [e.id, e.apres])).toEqual([
      ['e3', 'Ses contre-passations feront alors le débit : il restera à le classer par elles.'],
    ])
  })

  it('réservé sans rien pour le compléter : la note le dit', () => {
    const s = sources({ mouvements: [mouvement({ id: 'd1', montant: -900 }), mouvement({ id: 'c1', montant: 600 })], encaissements: portee(-600) })
    const g = gestes(s, 'd1')
    if (g.etat !== 'reserve') throw new Error(g.etat)
    expect(g.complement).toEqual({
      manqueCentimes: 30000, rattachables: [], aContrePasser: [],
      note: 'Aucune contre-passation de facture source n’attend son mouvement, et aucun encaissement déclaré ne se contre-passe '
        + 'sur ce débit : rien ne se rattache ni ne se contre-passe ici.',
    })
  })

  it('daté d’un exercice validé : le refus de la base, et rien à compléter', () => {
    const s = sources({
      mouvements: [mouvement({ id: 'd1', montant: -900 }), mouvement({ id: 'c1', montant: 600 })],
      encaissements: [...portee(-600), encaissement({ id: 'e3', facture_id: 'f3', montant: 300 })],
      declarations: [declare('e3')],
    })
    const g = gestes(s, 'd1', [2026])
    if (g.etat !== 'reserve') throw new Error(g.etat)
    expect(g.classement.refus).toBe(refus(REFUS_CLASSEMENT, 'frontiere', 'L\'exercice 2026 est validé'))
    expect(g.complement).toBeNull()
  })
})

describe('un débit CLASSÉ par ses contre-passations : retirer ce classement', () => {
  const s = sources({
    mouvements: [mouvement({ id: 'd1', montant: -1200, statut: 'rapprochee', encaissements_de_factures: true })],
    encaissements: [
      encaissement({ id: 'e1', facture_id: 'f1', montant: 600 }),
      encaissement({ id: 'cp1', facture_id: 'f1', montant: -600, annule_id: 'e1', ligne_bancaire_id: 'd1' }),
      encaissement({ id: 'e2', facture_id: 'f2', montant: 600 }),
      encaissement({ id: 'cp2', facture_id: 'f2', montant: -600, annule_id: 'e2', ligne_bancaire_id: 'd1', cree_le: '2026-03-10T11:00:00Z' }),
    ],
  })

  it('la confirmation nomme les factures et dit que ses écritures deviennent « à retirer »', () => {
    expect(gestes(s, 'd1')).toEqual({
      etat: 'classe',
      retrait: {
        refus: null,
        confirmation: `Retirer le classement de ce débit du 20/03/2026 de ${fm(-1200)} par ses contre-passations (factures `
          + 'F2026-0014, F2026-0015) ?\n\nIl redevient à traiter, toujours réservé à ses contre-passations : il ne reçoit aucun '
          + 'autre classement tant qu’elles le citent. Ses écritures, s’il en a été passé, deviennent « à retirer » dans '
          + 'l’onglet Écritures, section « Ventes facturées » : elles se retirent là.',
      },
    })
  })

  it('une seule facture, au singulier ; daté d’un exercice validé, le refus de la base', () => {
    const une = { ...s, encaissements: s.encaissements.filter((e) => e.facture_id === 'f1') }
    const g = gestes(une, 'd1')
    expect(g.etat === 'classe' && g.retrait.confirmation).toContain('par ses contre-passations (facture F2026-0014) ?')
    const fige = gestes(s, 'd1', [2027])
    expect(fige.etat === 'classe' && fige.retrait.refus).toBe(
      refus(REFUS_RETRAIT_CLASSEMENT, 'frontiere', 'L\'exercice 2026 est figé par la validation de l\'exercice 2027'),
    )
  })
})

describe('manqueDuDebit', () => {
  it('ce qui reste du débit, en valeur absolue : par les seules contre-passations de factures sources qui le citent', () => {
    const d = mouvement({ id: 'd1', montant: -1000 })
    const registre = [
      encaissement({ id: 'a', facture_id: 'f1', montant: -300, annule_id: 'x', ligne_bancaire_id: 'd1' }),
      encaissement({ id: 'b', facture_id: 'f0', montant: -200, annule_id: 'y', ligne_bancaire_id: 'd1' }),
      encaissement({ id: 'c', facture_id: 'f2', montant: -100, annule_id: 'z', ligne_bancaire_id: 'd1', retire_le: '2026-03-21T00:00:00Z' }),
      encaissement({ id: 'e', facture_id: 'f3', montant: -40, annule_id: 'w', ligne_bancaire_id: 'd-autre' }),
    ]
    expect(manqueDuDebit(d, registre, { factures: FACTURES })).toBe(70000)
    expect(manqueDuDebit(mouvement({ id: 'd1', montant: -250 }), registre, { factures: FACTURES })).toBe(-5000)
  })
})
