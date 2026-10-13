import { describe, expect, it } from 'vitest'
import {
  AIDE_DU_FILTRE_DES_REGLEMENTS, MOUVEMENT_HORS_ACCES, SANS_FILTRE, champsDeRecherche, clientsDesReglements,
  csvDesReglements, declarationEnMots, filtrerReglements, mouvementEnMots, nomFichierDesReglements,
  raisonDuFiltreDesReglements, reglementsDuDossier, totauxDesReglements,
  type EntreeReglements, type LigneReglement, type MouvementsDesReglements,
} from './reglements'
import { pastilleDeclaration } from './encaissementsAffichage'
import { ACCES_EN_COURS, ACCES_SANS_OBJET, type AccesDuDossier } from './auteursVentes'
import { correspondALaRecherche } from './recherche'
import { facture as factureCii } from '../test/facturesCii'
import type { EncaissementDesVentes, ListesDesVentes } from './tuilesVentes'
import type { FactureEmise, TransmissionFacture } from './types'
import type { DeclarationLue, PartLue } from './encaissementsFactures'

// LA LISTE DES RÈGLEMENTS (espace client, étape A3). Ce que ces cas gardent : une ligne par encaissement ou contre-passation,
// telle que la base la garde (la contre-passation NÉGATIVE, le retiré marqué) ; la déclaration de chacun dite par les modules
// de d3 et d4 — et, pour « À déclarer » et « Déclaration en retard », exactement ce que la pastille de sa facture dit ; le
// mouvement nommé, dit sans être nommé sans « Banque », ou absent ; chaque source lue en partie rend la liste MUETTE ;
// « par le client » sur des accès lus en entier seulement, jamais deviné ; chaque filtre ; les totaux sur les lignes
// données ; le CSV (BOM, champs, montants). Données FICTIVES.

const LIGNE = { ordre: 1, designation: 'Conseil', quantite: 1, prix_unitaire_ht: 1000, taux_tva: 20 }
const AUJOURDHUI = '2027-11-20'
const HOTE = 'flux.plateforme-fictive.fr'

// Des prestations de services à une entreprise, sans option pour les débits, émises après le 01/09/2027 : le statut
// « Encaissée » est DÛ.
const facture = (id: string, o: Partial<FactureEmise> = {}): FactureEmise => factureCii([LIGNE], {
  id, numero: `F-${id}`, date_emission: '2027-10-01', date_echeance: '2027-10-31', option_debits: false, ...o,
})
const transmission = (factureId: string): TransmissionFacture => ({
  id: `t-${factureId}`, dossier_id: 'd1', facture_id: factureId, canal: 'plateforme', hote: HOTE, flux_id: `flux-${factureId}`,
  sha256: 'e'.repeat(64), etat: 'accepte', detail: null, cree_le: '2027-10-02T09:00:00Z', maj_le: '2027-10-02T09:05:00Z',
})
const encaissement = (id: string, factureId: string, montant: number, date: string, o: Partial<EncaissementDesVentes> = {}): EncaissementDesVentes => ({
  id, dossier_id: 'd1', facture_id: factureId, date_encaissement: date, montant, moyen: 'virement', ligne_bancaire_id: null,
  annule_id: null, cree_par: null, cree_le: `${date}T09:00:00Z`, retire_le: null, ...o,
})
const part = (encaissementId: string, montant: number): PartLue => ({ encaissement_id: encaissementId, taux: 20, montant })
const declaration = (id: string, encaissementId: string, factureId: string, o: Partial<DeclarationLue> = {}): DeclarationLue => ({
  id, dossier_id: 'd1', encaissement_id: encaissementId, facture_id: factureId, canal: 'manuel', hote: HOTE, etat: 'depose', ...o,
})

// Le dossier : f1 acceptée, un encaissement déclaré puis contre-passé (la contre-passation pas encore déclarée), un retiré ;
// f2 acceptée, un chèque d'octobre (échéance passée) et une carte de novembre (échéance à venir) ; f3 jamais transmise ;
// f4 d'août 2027 (facultative) ; f5 à un particulier (sans objet) ; f6 mixte (refusée).
function ventes(o: Partial<ListesDesVentes> = {}): ListesDesVentes {
  const factures = [
    facture('f1', { tiers_nom: 'Alpha SAS' }), facture('f2', { tiers_nom: 'Beta; et fils' }), facture('f3', { tiers_nom: 'Alpha SAS' }),
    facture('f4', { date_emission: '2027-08-01', tiers_nom: 'Gamma' }), facture('f5', { type_client: 'non_assujetti', tiers_nom: 'Gamma' }),
    facture('f6', { nature_operation: 'mixte', tiers_nom: 'Gamma' }),
  ]
  return {
    factures,
    facturesIncompletes: null,
    transmissions: ['f1', 'f2', 'f6'].map(transmission),
    transmissionsIncompletes: null,
    lignes: factures.map((f) => ({ ...LIGNE, facture_id: f.id })),
    encaissements: [
      encaissement('e1', 'f1', 600, '2027-10-03', { ligne_bancaire_id: 'm1', cree_par: 'u-client' }),
      encaissement('e1x', 'f1', -600, '2027-10-12', { annule_id: 'e1', cree_par: 'u-client', cree_le: '2027-10-12T10:00:00Z' }),
      encaissement('e1r', 'f1', 200, '2027-10-04', { moyen: 'cheque', retire_le: '2027-10-05T08:00:00Z', cree_par: 'u-ancien' }),
      encaissement('e2', 'f2', 300, '2027-10-05', { moyen: 'cheque' }),
      encaissement('e3', 'f2', 400, '2027-11-15', { moyen: 'carte', ligne_bancaire_id: 'm-disparu' }),
      encaissement('e4', 'f3', 1200, '2027-11-02'),
      encaissement('e5', 'f4', 1200, '2027-10-10', { moyen: 'especes' }),
      encaissement('e6', 'f5', 1200, '2027-10-11'),
      encaissement('e7', 'f6', 1200, '2027-10-12'),
    ],
    parts: [part('e1', 600), part('e1x', -600), part('e1r', 200), part('e2', 300), part('e3', 400), part('e4', 1200)],
    encaissementsIncomplets: null,
    declarations: [declaration('d1', 'e1', 'f1')],
    evenementsSuperpdp: [],
    declarationsIncompletes: null,
    statutsLus: [],
    statutsIncomplets: null,
    ...o,
  }
}

const RELEVE: MouvementsDesReglements = {
  etat: 'lus', lignes: [{ id: 'm1', date: '2027-10-03', libelle: 'VIR ALPHA SAS F-f1' }], complete: true, motif: null,
}
const ACCES_LUS: AccesDuDossier = { etat: 'lus', comptes: ['u-client'] }

function entree(o: Partial<EntreeReglements> = {}): EntreeReglements {
  return { dossierId: 'd1', ventes: ventes(), mouvements: RELEVE, statutTva: 'redevable', aujourdHui: AUJOURDHUI, acces: ACCES_LUS, ...o }
}

function lues(o: Partial<EntreeReglements> = {}): LigneReglement[] {
  const r = reglementsDuDossier(entree(o))
  if (r.etat !== 'lus') throw new Error(`liste muette : ${r.quoi} — ${r.motif}`)
  return r.lignes
}
const ligne = (lignes: readonly LigneReglement[], id: string) => lignes.find((l) => l.id === id) as LigneReglement

describe('reglementsDuDossier — une ligne par encaissement, telle que la base la garde', () => {
  it('chaque encaissement, contre-passation et retiré compris, du plus récent au plus ancien', () => {
    const l = lues()
    expect(l.map((x) => x.id)).toEqual(['e3', 'e4', 'e1x', 'e7', 'e6', 'e5', 'e2', 'e1r', 'e1'])
    expect(ligne(l, 'e1')).toMatchObject({
      factureId: 'f1', numero: 'F-f1', client: 'Alpha SAS', moyen: 'virement', centimes: 60000, date: '2027-10-03',
      contrePassation: false, contrePasse: true, etat: 'actif', retireLe: null,
    })
  })

  it('la contre-passation reste NÉGATIVE, comme la base la garde', () => {
    expect(ligne(lues(), 'e1x')).toMatchObject({ centimes: -60000, contrePassation: true, contrePasse: false, etat: 'actif' })
  })

  it('le retiré est marqué, sans déclaration ; il ne contre-passe rien', () => {
    expect(ligne(lues(), 'e1r')).toMatchObject({ etat: 'retire', retireLe: '2027-10-05T08:00:00Z', declaration: null, contrePasse: false })
  })

  it('une contre-passation retirée ne fait plus de son encaissement un contre-passé', () => {
    const v = ventes()
    v.encaissements = v.encaissements.map((e) => (e.id === 'e1x' ? { ...e, retire_le: '2027-10-13T08:00:00Z' } : e))
    expect(ligne(lues({ ventes: v }), 'e1').contrePasse).toBe(false)
  })
})

describe('reglementsDuDossier — la déclaration, par les modules de d3 et d4', () => {
  it('chaque état : déclarée, en retard, à déclarer, pas d’ici, non due', () => {
    const l = lues()
    expect(ligne(l, 'e1').declaration).toEqual({ etat: 'declaree', detail: `sur ${HOTE}` })
    // Le chèque d'octobre : l'échéance du 10 novembre est passée au 20.
    expect(ligne(l, 'e2').declaration).toEqual({ etat: 'en_retard', detail: `sur ${HOTE}, au plus tard le 10/11/2027` })
    // La carte de novembre : à déclarer avant le 10 décembre.
    expect(ligne(l, 'e3').declaration).toEqual({ etat: 'a_declarer', detail: `sur ${HOTE}, au plus tard le 10/12/2027` })
    // La contre-passation d'un encaissement déclaré, pas encore déclarée : elle se déclare sur la même plateforme.
    expect(ligne(l, 'e1x').declaration?.etat).toBe('en_retard')
    // Due, mais jamais acceptée par une plateforme : la base ne l'inscrirait pas d'ici, sous ses mots.
    expect(ligne(l, 'e4').declaration).toEqual({
      etat: 'pas_d_ici',
      detail: 'Aucune transmission de cette facture par l\'application n\'a été acceptée par une plateforme : son statut « Encaissée » ne se déclare d\'ici qu\'après.',
    })
    expect(ligne(l, 'e5').declaration?.etat).toBe('non_due')
    expect(ligne(l, 'e5').declaration?.detail).toMatch(/^Facultative : /)
    expect(ligne(l, 'e6').declaration?.etat).toBe('non_due')
    expect(ligne(l, 'e6').declaration?.detail).toMatch(/^Sans objet : la facture est adressée à un particulier/)
    expect(ligne(l, 'e7').declaration?.etat).toBe('pas_d_ici')
    expect(ligne(l, 'e7').declaration?.detail).toMatch(/^Refusée : la facture mêle biens et services/)
  })

  it('« issue inconnue » se dit d’une déclaration partie sans réponse', () => {
    const v = ventes({ declarations: [declaration('d1', 'e1', 'f1', { etat: 'envoi' })] })
    expect(ligne(lues({ ventes: v }), 'e1').declaration).toEqual({ etat: 'declaree', detail: `sur ${HOTE} — issue inconnue` })
  })

  it('une déclaration échouée ne déclare pas : l’encaissement est à déclarer de nouveau', () => {
    const v = ventes({ declarations: [declaration('d1', 'e1', 'f1', { etat: 'echec' })] })
    expect(ligne(lues({ ventes: v }), 'e1').declaration?.etat).toBe('en_retard')
  })

  it('un statut de TVA à préciser : pas d’ici, sous la raison de l’obligation', () => {
    expect(ligne(lues({ statutTva: null }), 'e2').declaration).toEqual({
      etat: 'pas_d_ici',
      detail: 'À préciser : le statut de TVA du dossier, dont l’obligation dépend, n’est pas encore choisi (onglet TVA du dossier).',
    })
  })

  it('« À déclarer » et « Déclaration en retard » : exactement ce que la pastille de la facture dit', () => {
    const v = ventes()
    const l = lues({ ventes: v })
    for (const f of v.factures) {
      const pastille = pastilleDeclaration('d1', f, v.lignes, v.encaissements, v.declarations, v.transmissions, v.evenementsSuperpdp, v.statutsLus, 'redevable', AUJOURDHUI)
      const siennes = l.filter((x) => x.factureId === f.id).map((x) => x.declaration?.etat)
      const attendu = siennes.includes('en_retard') ? 'Déclaration en retard' : siennes.includes('a_declarer') ? 'À déclarer' : undefined
      expect(pastille?.libelle, f.id).toBe(attendu)
    }
  })
})

describe('reglementsDuDossier — le mouvement', () => {
  it('nommé quand le relevé est lu ; « — » sans mouvement ; introuvable, « — »', () => {
    const l = lues()
    expect(ligne(l, 'e1').mouvement).toEqual({ etat: 'lu', date: '2027-10-03', libelle: 'VIR ALPHA SAS F-f1' })
    expect(mouvementEnMots(ligne(l, 'e1').mouvement)).toBe('03/10/2027 · VIR ALPHA SAS F-f1')
    expect(ligne(l, 'e2').mouvement).toEqual({ etat: 'aucun' })
    expect(ligne(l, 'e3').mouvement).toEqual({ etat: 'introuvable' })
    expect(mouvementEnMots(ligne(l, 'e3').mouvement)).toBe('—')
  })

  it('sans « Banque » : le mouvement désigné se DIT, sans être nommé, sous les mots de la fenêtre', () => {
    const l = lues({ mouvements: { etat: 'hors_acces' }, acces: ACCES_SANS_OBJET })
    expect(ligne(l, 'e1').mouvement).toEqual({ etat: 'hors_acces' })
    expect(mouvementEnMots(ligne(l, 'e1').mouvement)).toBe('Un mouvement du relevé, que ton accès ne montre pas')
    expect(ligne(l, 'e2').mouvement).toEqual({ etat: 'aucun' })
  })
})

describe('reglementsDuDossier — une source lue en partie : ni ligne, ni total, ni export', () => {
  it.each([
    ['facturesIncompletes', 'Les factures du dossier'],
    ['transmissionsIncompletes', 'Les transmissions des factures'],
    ['encaissementsIncomplets', 'Les encaissements, leur répartition ou les lignes des factures'],
    ['declarationsIncompletes', 'Les déclarations des encaissements ou l’historique de Super PDP'],
    ['statutsIncomplets', 'Les statuts lus sur la plateforme du client'],
  ] as const)('%s', (cle, quoi) => {
    const r = reglementsDuDossier(entree({ ventes: ventes({ [cle]: '1 ligne(s) lue(s) sur 2 annoncée(s)' }) }))
    expect(r).toEqual({ etat: 'partiels', quoi, accord: expect.any(String), motif: '1 ligne(s) lue(s) sur 2 annoncée(s)' })
  })

  it('le relevé lu en partie', () => {
    const r = reglementsDuDossier(entree({ mouvements: { etat: 'lus', lignes: [], complete: false, motif: 'lecture interrompue' } }))
    expect(r).toEqual({ etat: 'partiels', quoi: 'Les mouvements du relevé', accord: 'lus', motif: 'lecture interrompue' })
  })

  it('le relevé hors de l’accès n’est pas une lecture partielle', () => {
    expect(reglementsDuDossier(entree({ mouvements: { etat: 'hors_acces' } })).etat).toBe('lus')
  })

  it('un encaissement dont la facture n’a pas été rendue dit des lectures qui ne s’accordent pas', () => {
    const v = ventes()
    v.factures = v.factures.filter((f) => f.id !== 'f3')
    expect(reglementsDuDossier(entree({ ventes: v }))).toMatchObject({ etat: 'partiels', quoi: 'Les factures du dossier' })
  })

  it('un registre vide, lu en entier, est une liste vide', () => {
    expect(reglementsDuDossier(entree({ ventes: ventes({ encaissements: [], parts: [], declarations: [] }) }))).toEqual({ etat: 'lus', lignes: [] })
  })
})

describe('« par le client » : sur des accès lus en entier, jamais deviné', () => {
  it('le compte d’un accès client du dossier ; ni un accès retiré, ni un auteur nul', () => {
    const l = lues()
    expect(ligne(l, 'e1').parLeClient).toBe(true)
    expect(ligne(l, 'e1x').parLeClient).toBe(true)
    // L'auteur du retiré n'a plus d'accès : on ne le devine pas.
    expect(ligne(l, 'e1r').parLeClient).toBe(false)
    expect(ligne(l, 'e2').parLeClient).toBe(false)
  })

  it.each([
    ['en cours', ACCES_EN_COURS], ['incomplets', { etat: 'incomplets', motif: 'refusée' } as AccesDuDossier], ['sans objet', ACCES_SANS_OBJET],
  ] as const)('accès %s : personne n’est le client', (_nom, acces) => {
    expect(lues({ acces }).filter((x) => x.parLeClient)).toEqual([])
  })

  it('le filtre ne retient que le client, et ne filtre plus sur des accès qui ne sont pas lus en entier', () => {
    const l = lues()
    expect(filtrerReglements(l, { ...SANS_FILTRE, parLeClient: true }, ACCES_LUS).map((x) => x.id)).toEqual(['e1x', 'e1'])
    expect(filtrerReglements(l, { ...SANS_FILTRE, parLeClient: true }, ACCES_EN_COURS)).toHaveLength(l.length)
  })

  it('la raison de la case grisée, dite des règlements ; aucune sur des accès lus', () => {
    expect(raisonDuFiltreDesReglements(ACCES_LUS)).toBeNull()
    expect(raisonDuFiltreDesReglements({ etat: 'incomplets', motif: '3 ligne(s) lue(s) sur 4 annoncée(s)' })).toBe(
      'La liste des accès du dossier n’a pas été lue en entier (3 ligne(s) lue(s) sur 4 annoncée(s)) : on ne peut pas dire quels règlements sont du client.',
    )
    expect(raisonDuFiltreDesReglements(ACCES_EN_COURS)).toBe('Les accès du dossier sont en cours de lecture.')
    expect(AIDE_DU_FILTRE_DES_REGLEMENTS).toMatch(/Un accès retiré depuis n’est plus reconnu/)
  })
})

describe('filtrerReglements — chaque filtre', () => {
  const l = lues()
  const ids = (f: Partial<typeof SANS_FILTRE>) => filtrerReglements(l, { ...SANS_FILTRE, ...f }, ACCES_LUS).map((x) => x.id)

  it('sans filtre, toutes', () => expect(ids({})).toHaveLength(9))
  it('la période, bornes comprises', () => {
    expect(ids({ du: '2027-10-05', au: '2027-10-12' })).toEqual(['e1x', 'e7', 'e6', 'e5', 'e2'])
    expect(ids({ du: '2027-11-02' })).toEqual(['e3', 'e4'])
    expect(ids({ au: '2027-10-03' })).toEqual(['e1'])
  })
  it('le moyen', () => expect(ids({ moyen: 'cheque' })).toEqual(['e2', 'e1r']))
  it('le client', () => expect(ids({ client: 'Alpha SAS' })).toEqual(['e4', 'e1x', 'e1r', 'e1']))
  it('l’état', () => {
    expect(ids({ etat: 'retire' })).toEqual(['e1r'])
    expect(ids({ etat: 'actif' })).toHaveLength(8)
  })
  it('la déclaration', () => {
    expect(ids({ declaration: 'declaree' })).toEqual(['e1'])
    expect(ids({ declaration: 'en_retard' })).toEqual(['e1x', 'e2'])
    expect(ids({ declaration: 'a_declarer' })).toEqual(['e3'])
    expect(ids({ declaration: 'non_due' })).toEqual(['e6', 'e5'])
    expect(ids({ declaration: 'pas_d_ici' })).toEqual(['e4', 'e7'])
  })
  it('les clients du filtre, une fois chacun, dans l’ordre alphabétique', () => {
    expect(clientsDesReglements(l)).toEqual(['Alpha SAS', 'Beta; et fils', 'Gamma'])
  })
})

describe('totauxDesReglements — sur les lignes données', () => {
  it('le retiré n’y compte pas ; la contre-passation vient en moins, dans son moyen', () => {
    const t = totauxDesReglements(lues())
    expect(t.centimes).toBe(600_00 - 600_00 + 300_00 + 400_00 + 1200_00 * 4)
    expect(t.nombre).toBe(8)
    expect(t.retires).toBe(1)
    expect(t.parMoyen).toEqual([
      { moyen: 'virement', libelle: 'Virement', nombre: 5, centimes: 600_00 - 600_00 + 1200_00 * 3 },
      { moyen: 'cheque', libelle: 'Chèque', nombre: 1, centimes: 300_00 },
      { moyen: 'carte', libelle: 'Carte bancaire', nombre: 1, centimes: 400_00 },
      { moyen: 'especes', libelle: 'Espèces', nombre: 1, centimes: 1200_00 },
    ])
    expect(t.parMois).toEqual([
      { mois: '2027-10', libelle: 'octobre 2027', nombre: 6, centimes: 600_00 - 600_00 + 300_00 + 1200_00 * 3 },
      { mois: '2027-11', libelle: 'novembre 2027', nombre: 2, centimes: 400_00 + 1200_00 },
    ])
  })

  it('d’autres lignes, d’autres totaux : ils suivent les filtres', () => {
    const t = totauxDesReglements(filtrerReglements(lues(), { ...SANS_FILTRE, moyen: 'cheque' }, ACCES_LUS))
    expect(t).toMatchObject({ centimes: 300_00, nombre: 1, retires: 1 })
  })

  it('une recherche ne fait pas partie des filtres : ses champs disent ce qui s’affiche', () => {
    const l = lues()
    const trouvees = l.filter((x) => correspondALaRecherche(champsDeRecherche(x, 'cabinet'), 'beta'))
    expect(trouvees.map((x) => x.id)).toEqual(['e3', 'e2'])
    expect(l.filter((x) => correspondALaRecherche(champsDeRecherche(x, 'cabinet'), '1200,00')).map((x) => x.id)).toEqual(['e4', 'e7', 'e6', 'e5'])
    expect(l.filter((x) => correspondALaRecherche(champsDeRecherche(x, 'cabinet'), 'retard')).map((x) => x.id)).toEqual(['e1x', 'e2'])
  })
})

describe('les mots de la déclaration, pour l’espace qui regarde', () => {
  it('le client ne lit aucun onglet', () => {
    const d = ligne(lues({ statutTva: null }), 'e2').declaration
    expect(declarationEnMots(d, 'cabinet')).toMatch(/onglet TVA du dossier/)
    expect(declarationEnMots(d, 'client')).toBe(
      'Ne se déclare pas d’ici — À préciser : ton statut de TVA, dont l’obligation dépend, n’est pas encore précisé par ton cabinet.',
    )
    expect(declarationEnMots(null, 'client')).toBe('—')
  })
})

describe('csvDesReglements — les lignes données, en CSV', () => {
  it('BOM UTF-8, point-virgule, champs par champCsv, montants à virgule, contre-passation négative', () => {
    const l = lues()
    const csv = csvDesReglements(l, 'cabinet')
    expect(csv.startsWith('\uFEFF')).toBe(true)
    const rangs = csv.slice(1).split('\r\n')
    expect(rangs[0]).toBe('Date;Facture;Client;Nature;Moyen;Montant;Mouvement;Déclaration;État')
    expect(rangs).toHaveLength(10)
    expect(rangs[rangs.length - 1]).toBe(`2027-10-03;F-f1;Alpha SAS;Encaissement;Virement;600,00;2027-10-03 VIR ALPHA SAS F-f1;Déclarée — sur ${HOTE};Actif`)
    expect(rangs).toContain(`2027-10-12;F-f1;Alpha SAS;Contre-passation;Virement;-600,00;;Déclaration en retard — sur ${HOTE}, au plus tard le 10/11/2027;Actif`)
    // Un point-virgule dans un nom : entre guillemets.
    expect(rangs).toContain(`2027-10-05;F-f2;"Beta; et fils";Encaissement;Chèque;300,00;;Déclaration en retard — sur ${HOTE}, au plus tard le 10/11/2027;Actif`)
    expect(rangs).toContain('2027-10-04;F-f1;Alpha SAS;Encaissement;Chèque;200,00;;;Retiré')
  })

  it('sans « Banque », le mouvement se dit sans être nommé ; et l’export suit les lignes qu’on lui donne', () => {
    const l = lues({ mouvements: { etat: 'hors_acces' }, acces: ACCES_SANS_OBJET })
    const csv = csvDesReglements(l.filter((x) => x.id === 'e1'), 'client')
    expect(csv.slice(1).split('\r\n')[1]).toBe(`2027-10-03;F-f1;Alpha SAS;Encaissement;Virement;600,00;${MOUVEMENT_HORS_ACCES};Déclarée — sur ${HOTE};Actif`)
    expect(csv.slice(1).split('\r\n')).toHaveLength(2)
  })

  it('le nom du fichier : le jour de l’export, jamais le nom du dossier', () => {
    expect(nomFichierDesReglements('2027-11-20')).toBe('reglements-2027-11-20.csv')
  })
})
