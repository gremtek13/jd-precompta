import { describe, expect, it } from 'vitest'
import { lotDesCertains, planRapprochementAutomatique, type Appariement } from './appariementBanque'
import type { AccesDuDossier } from './auteursVentes'
import { REFUS_GARDE_MOUVEMENTS, type LigneDeFacture, type PartLue } from './encaissementsFactures'
import {
  AUCUN_CANDIDAT, AUCUN_HORS_DES_LOTS, candidatsDeLaVente, candidatsDuMouvement, ecartDuLot, gestesDuCredit, gestesDuDebit,
  horsDesLotsAvecLesCandidats, JUSTIFICATIF_CONTRE_PASSATION, JUSTIFICATIF_ENCAISSEMENT, JUSTIFICATIF_FACTURE,
  justificatifDeLaVente, mouvementsHorsDesLots, SIGNAL_MONTANT_CREDIT, SIGNAL_MONTANT_DEBIT, signalDuClient, ventesDuReleve,
  type CandidatsDeLaVente, type EncaissementDuMouvementLu, type FactureDesGestes, type LectureDesGestes, type SourcesDesGestes,
} from './mouvementsDesVentes'
import { PLAN_PAR_DEFAUT } from './planComptable'
import { justificatifPossible, planAffectationParRegles } from './reglesAffectation'
import { AUCUNE_FACTURE_SOURCE } from './facturesSources'
import { AUCUN_REFUS_DE_VALIDATION } from './lotsDeLaJumelleInversee'
import { ignoresParLaRegle } from './reglesIgnorees'
import type { Categorie, LigneBancaire, Piece, RegleAffectationBancaire } from './types'

// LES CANDIDATS DU RELEVÉ (ligne 28.65, chantier EC-Q3, étape VF5e). Ce qu'une vente facturée propose pour un mouvement
// LIBRE d'un dossier basculé — une facture source ouverte ou un encaissement enregistré sans mouvement pour un crédit, une
// contre-passation enregistrée sans mouvement pour un débit —, accepté par le jugement du module qui redit la base
// (`refusRattachement`), désigné par son montant (`refusClassement` sur l'état d'après : l'écart des frais, `min(2 %, 5 €)`)
// ou par son client cité au libellé. Puis ce qu'en font le lot des règles (« à rapprocher »), les trois autres lots (le
// mouvement écarté, jamais écrit) et la fiche (en tête). Données FICTIVES.

const D = 'd-bascule'
const ACCES: AccesDuDossier = { etat: 'lus', comptes: [] }

const facture = (o: Partial<FactureDesGestes> & Pick<FactureDesGestes, 'id' | 'numero'>): FactureDesGestes => ({
  dossier_id: D, type: 'facture', statut: 'validee', facture_origine_id: null, source_de_la_vente: true, tiers_nom: 'Client fictif',
  date_emission: '2026-03-01', montant_ttc: 600, ...o,
})

// Une ligne au taux de 20 % : le TTC vaut 1,2 × le hors-taxe ; celle d'un avoir en quantité négative.
const ligneDeFacture = (factureId: string, ht: number, quantite = 1): LigneDeFacture => ({
  facture_id: factureId, ordre: 1, designation: 'Prestation fictive', quantite, prix_unitaire_ht: ht, taux_tva: 20,
})

const encaissement = (
  o: Partial<EncaissementDuMouvementLu> & Pick<EncaissementDuMouvementLu, 'id' | 'facture_id' | 'montant'>,
): EncaissementDuMouvementLu => ({
  dossier_id: D, date_encaissement: '2026-03-10', moyen: 'virement', ligne_bancaire_id: null, annule_id: null,
  cree_le: '2026-03-10T10:00:00Z', retire_le: null, cree_par: 'u-cabinet', ...o,
})

// Un mouvement du relevé, tel que l'onglet le lit — et la lecture des ventes en porte la même ligne.
function mouvement(o: Partial<LigneBancaire> & Pick<LigneBancaire, 'id'>): LigneBancaire {
  return {
    dossier_id: D, date: '2026-03-12', libelle: 'VIR SEPA RECU /DE PARTICULIER', montant: 600,
    statut: 'non_rapprochee', piece_id: null, cotisation_id: null, categorie_id: null, taux_tva: null, prelevement_personnel: false,
    emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false, reglement_groupe: false,
    compte_bilan: null, declaration_tva_id: null, id_externe: null, source_fichier: 'releve-2026.csv', libelle_brut: null,
    created_at: '2026-04-01T10:00:00Z', encaissements_de_factures: false, ...o,
  }
}

function piece(o: Partial<Piece> & Pick<Piece, 'id'>): Piece {
  return {
    dossier_id: D, uploaded_by: null, source: 'upload', storage_path: `${D}/p.pdf`, nom_fichier: 'facture.pdf', storage_hash: null,
    date_piece: '2026-03-10', tiers: 'Exemplaire fictif', montant_ht: 500, montant_tva: 100, montant_ttc: 600, devise: 'EUR',
    montant_devise: null, taux_change: null, conversion_source: null, categorie_id: null, sous_dossier_id: null, type_piece: 'vente',
    statut: 'validee', notes: null, confiance: null, superpdp_invoice_id: null, flux_hote: null, flux_id: null, lisible_path: null,
    identite_numero: null, identite_siren_vendeur: null, identite_date: null, identite_nature: null, facture_id: null, vente_hors_des_factures: false,
    created_at: '2026-03-10T09:00:00Z', updated_at: '2026-03-10T09:00:00Z', ...o,
  }
}

// Trois factures sources — SARL Horizon (600 €), Atelier Martin (600 €, un avoir validé de 120 € : 480 € net), Librairie
// Rocher (300 €) —, une facture d'avant la bascule, un brouillon.
const FACTURES = [
  facture({ id: 'f1', numero: 'F2026-0014', tiers_nom: 'SARL Horizon' }),
  facture({ id: 'f2', numero: 'F2026-0015', tiers_nom: 'Atelier Martin' }),
  facture({ id: 'a2', numero: 'A2026-0001', type: 'avoir', facture_origine_id: 'f2', montant_ttc: -120, tiers_nom: 'Atelier Martin' }),
  facture({ id: 'f3', numero: 'F2026-0016', tiers_nom: 'Librairie Rocher', montant_ttc: 300 }),
  facture({ id: 'f0', numero: 'F2025-0099', source_de_la_vente: false, tiers_nom: 'Ancien Client Dupuis' }),
  facture({ id: 'fb', numero: null, statut: 'brouillon', tiers_nom: 'Brouillon Lefebvre' }),
]
const LIGNES = [
  ligneDeFacture('f1', 500), ligneDeFacture('f2', 500), ligneDeFacture('a2', 100, -1), ligneDeFacture('f3', 250),
  ligneDeFacture('f0', 500), ligneDeFacture('fb', 500),
]
const partsDe = (encaissements: readonly EncaissementDuMouvementLu[]): PartLue[] =>
  encaissements.filter((e) => e.annule_id == null).map((e) => ({ encaissement_id: e.id, taux: 20, montant: e.montant }))

function sources(mouvements: readonly LigneBancaire[], encaissements: readonly EncaissementDuMouvementLu[] = []): SourcesDesGestes {
  return { dossierId: D, factures: FACTURES, lignes: LIGNES, encaissements, parts: partsDe(encaissements), mouvements, exemplaires: [] }
}
const lue = (s: SourcesDesGestes): LectureDesGestes => ({ dossierId: D, etat: 'lue', sources: s })
const candidatsDe = (s: SourcesDesGestes, annees: readonly number[] = []): CandidatsDeLaVente =>
  candidatsDeLaVente(ventesDuReleve(true, D, lue(s), ACCES), lue(s), annees)

// Un crédit seul face aux factures sources ouvertes, et ses candidats.
function surLeCredit(m: LigneBancaire, encaissements: readonly EncaissementDuMouvementLu[] = []) {
  const c = candidatsDe(sources([m], encaissements))
  return candidatsDuMouvement(c, m)
}

describe('candidatsDeLaVente : les deux listes, et la retenue de VF5a1', () => {
  it('les factures sources ouvertes, leur reste net de leurs avoirs ; jamais une facture d’avant, un avoir, un brouillon', () => {
    const c = candidatsDe(sources([]))
    expect(c.facturesSourcesOuvertes.map((o) => [o.facture.id, o.resteCentimes])).toEqual([['f1', 60000], ['f2', 48000], ['f3', 30000]])
  })

  it('une facture soldée n’est plus ouverte ; payée en partie, son reste', () => {
    const c = candidatsDe(sources([], [
      encaissement({ id: 'e1', facture_id: 'f1', montant: 600, ligne_bancaire_id: 'm-ailleurs', moyen: 'especes' }),
      encaissement({ id: 'e3', facture_id: 'f3', montant: 100, moyen: 'especes' }),
    ]))
    expect(c.facturesSourcesOuvertes.map((o) => [o.facture.id, o.resteCentimes])).toEqual([['f2', 48000], ['f3', 20000]])
  })

  it('les encaissements sans mouvement : ni retirés, ni rattachés, ni d’une facture qui n’est pas source, ni « n’ayant pas eu lieu »', () => {
    const c = candidatsDe(sources([], [
      encaissement({ id: 'ok', facture_id: 'f1', montant: 200 }),
      encaissement({ id: 'retire', facture_id: 'f1', montant: 200, retire_le: '2026-03-11T09:00:00Z' }),
      encaissement({ id: 'rattache', facture_id: 'f1', montant: 100, ligne_bancaire_id: 'm-x' }),
      encaissement({ id: 'avant', facture_id: 'f0', montant: 600 }),
      encaissement({ id: 'annule', facture_id: 'f3', montant: 100 }),
      encaissement({ id: 'cp-annule', facture_id: 'f3', montant: -100, annule_id: 'annule' }),
      encaissement({ id: 'ailleurs', facture_id: 'f1', montant: 100, dossier_id: 'autre' }),
    ]))
    // La contre-passation sans mouvement est elle-même sans mouvement : un débit l'attend.
    expect(c.encaissementsSansMouvement.map((e) => e.id)).toEqual(['ok', 'cp-annule'])
  })

  it('pas de candidat sans des ventes lues en entier, du même dossier, ni sur un dossier qui n’a pas basculé', () => {
    const s = sources([])
    expect(candidatsDeLaVente({ etat: 'sans_objet' }, lue(s), [])).toBe(AUCUN_CANDIDAT)
    expect(candidatsDeLaVente({ etat: 'en_cours' }, lue(s), [])).toBe(AUCUN_CANDIDAT)
    expect(candidatsDeLaVente({ etat: 'incomplete', motif: 'refusée' }, lue(s), [])).toBe(AUCUN_CANDIDAT)
    const v = ventesDuReleve(true, D, lue(s), ACCES)
    expect(candidatsDeLaVente(v, null, [])).toBe(AUCUN_CANDIDAT)
    expect(candidatsDeLaVente(v, { dossierId: D, etat: 'incomplete', motif: 'refusée' }, [])).toBe(AUCUN_CANDIDAT)
    expect(candidatsDeLaVente(v, { ...lue(s), dossierId: 'autre' }, [])).toBe(AUCUN_CANDIDAT)
    expect(AUCUN_CANDIDAT).toEqual({ facturesSourcesOuvertes: [], encaissementsSansMouvement: [], juge: null })
  })

  it('un mouvement que la lecture rend d’un autre dossier n’a pas de candidat, même désigné sous l’identifiant attendu', () => {
    // La facture f1 (600 €) que le crédit solderait : sous le dossier de la lecture, elle se propose ; la même ligne lue
    // d'un autre dossier n'est pas un mouvement du dossier, et rien ne se propose.
    const m = mouvement({ id: 'm', montant: 600 })
    expect(candidatsDuMouvement(candidatsDe(sources([m])), m).map((x) => x.id)).toEqual(['f1'])
    expect(candidatsDuMouvement(candidatsDe(sources([{ ...m, dossier_id: 'autre' }])), m)).toEqual([])
  })
})

describe('candidatsDuMouvement : un CRÉDIT libre', () => {
  it('une facture ouverte que le crédit solde aux frais près : candidate par son montant', () => {
    const m = mouvement({ id: 'm', montant: 598.5 })
    const [premier, ...autres] = surLeCredit(m)
    expect(premier).toMatchObject({
      genre: 'facture', id: 'f1', montantCentimes: 60000, ecartCentimes: 150, parLeMontant: true, parLeClient: false,
      signaux: [SIGNAL_MONTANT_CREDIT], titre: 'Facture à encaisser',
    })
    expect(premier.libelle).toMatch(/^F2026-0014 — SARL Horizon, du 01\/03\/2026 — reste 600,00/)
    // F2026-0015 (480 € net) : le crédit la dépasse — ni par le montant ni par le nom.
    expect(autres).toEqual([])
    expect(justificatifDeLaVente(candidatsDe(sources([m])), m)).toBe(JUSTIFICATIF_FACTURE)
  })

  it('l’écart des frais est celui de la base : 5 € au plus, 2 % au plus', () => {
    // 600 € : 5 € de frais passent, 5,01 € non.
    expect(surLeCredit(mouvement({ id: 'm', montant: 595 })).map((x) => x.id)).toEqual(['f1'])
    expect(surLeCredit(mouvement({ id: 'm', montant: 594.99 }))).toEqual([])
    // 300 € : 2 % — 6 € — dépassent 5 € ; 300 € à 294,99 € non plus, mais 295 € oui.
    expect(surLeCredit(mouvement({ id: 'm', montant: 295 })).map((x) => x.id)).toEqual(['f3'])
    // La banque crédite un peu moins, jamais plus : 600,01 € ne solde aucune facture de 600 €.
    expect(surLeCredit(mouvement({ id: 'm', montant: 600.01 }))).toEqual([])
  })

  it('le reste NET des avoirs : 480 €, pas 600 €', () => {
    expect(surLeCredit(mouvement({ id: 'm', montant: 480 })).map((x) => [x.id, x.parLeMontant])).toEqual([['f2', true]])
  })

  it('le client cité au libellé désigne aussi une facture que le crédit ne solde pas (un paiement en deux fois)', () => {
    const m = mouvement({ id: 'm', montant: 250, libelle: 'VIR SEPA RECU /DE LIBRAIRIE ROCHER ACOMPTE' })
    expect(surLeCredit(m)).toMatchObject([{
      genre: 'facture', id: 'f3', montantCentimes: 30000, ecartCentimes: 5000, parLeMontant: false, parLeClient: true,
      signaux: [signalDuClient('Librairie Rocher')],
    }])
    // Le même crédit sans le nom : rien.
    expect(surLeCredit({ ...m, libelle: 'VIR SEPA RECU /DE PARTICULIER' })).toEqual([])
    // Le libellé générique cède au libellé brut, comme partout (`libelleExploitable`).
    expect(surLeCredit({ ...m, libelle: '', libelle_brut: 'VIR LIBRAIRIE ROCHER' }).map((x) => x.id)).toEqual(['f3'])
  })

  it('le montant ET le client : les deux signaux, dans cet ordre', () => {
    const m = mouvement({ id: 'm', montant: 600, libelle: 'VIR SARL HORIZON' })
    expect(surLeCredit(m)[0]).toMatchObject({ id: 'f1', signaux: [SIGNAL_MONTANT_CREDIT, signalDuClient('SARL Horizon')] })
  })

  it('un encaissement sans mouvement que le crédit fait aux frais près ; un encaissement passe avant la facture', () => {
    const m = mouvement({ id: 'm', montant: 299 })
    const e = encaissement({ id: 'e3', facture_id: 'f3', montant: 300, moyen: 'cheque' })
    const c = surLeCredit(m, [e])
    expect(c.map((x) => [x.genre, x.id, x.parLeMontant])).toEqual([['encaissement', 'e3', true]])
    expect(c[0]).toMatchObject({ titre: 'Encaissement enregistré sans mouvement', montantCentimes: 30000, ecartCentimes: 100 })
    expect(c[0].libelle).toBe('Facture F2026-0016 (Librairie Rocher) — chèque du 10/03/2026')
    // F2026-0016 n'est plus ouverte : l'encaissement la solde déjà. Sans lui, c'est elle.
    expect(surLeCredit(m).map((x) => x.id)).toEqual(['f3'])
    expect(justificatifDeLaVente(candidatsDe(sources([m], [e])), m)).toBe(JUSTIFICATIF_ENCAISSEMENT)
  })

  it('à écart égal, l’encaissement d’abord ; puis le client cité, la date et l’identifiant', () => {
    const m = mouvement({ id: 'm', montant: 600 })
    const e = encaissement({ id: 'e1', facture_id: 'f1', montant: 600 })
    const c = surLeCredit(m, [e, encaissement({ id: 'e2', facture_id: 'f2', montant: 300 })])
    expect(c.map((x) => x.id)).toEqual(['e1'])
    // Deux encaissements du même montant, l'un dont le client est cité : il passe devant.
    const deux = [
      encaissement({ id: 'ea', facture_id: 'f1', montant: 300, date_encaissement: '2026-03-01' }),
      encaissement({ id: 'eb', facture_id: 'f3', montant: 300, date_encaissement: '2026-03-05' }),
    ]
    const ici = mouvement({ id: 'm', montant: 300, libelle: 'REMISE CHEQUE LIBRAIRIE ROCHER' })
    // F2026-0016 est soldée par « eb » ; F2026-0014, à qui « ea » laisse 300 €, que le crédit solde, vient après eux.
    expect(surLeCredit(ici, deux).map((x) => x.id)).toEqual(['eb', 'ea', 'f1'])
    // Sans le nom : la date, puis l'identifiant.
    const sansNom = { ...ici, libelle: 'REMISE CHEQUE 0001234' }
    expect(surLeCredit(sansNom, deux).map((x) => x.id)).toEqual(['ea', 'eb', 'f1'])
    const memeJour = deux.map((x) => ({ ...x, date_encaissement: '2026-03-01' }))
    expect(surLeCredit(sansNom, [memeJour[1], memeJour[0]]).map((x) => x.id)).toEqual(['ea', 'eb', 'f1'])
    // La date avant l'identifiant : « ez », plus ancien, passe devant « ea ».
    const inverses = [{ ...deux[0], id: 'ez' }, { ...deux[1], id: 'ea' }]
    expect(surLeCredit(sansNom, inverses).map((x) => x.id)).toEqual(['ez', 'ea', 'f1'])
  })

  it('un encaissement ET une facture : le lot des règles dit l’encaissement', () => {
    const m = mouvement({ id: 'm', montant: 600, libelle: 'VIR LIBRAIRIE ROCHER' })
    const e = encaissement({ id: 'e3', facture_id: 'f3', montant: 200 })
    const c = candidatsDe(sources([m], [e]))
    expect(candidatsDuMouvement(c, m).map((x) => x.genre)).toEqual(['facture', 'encaissement', 'facture'])
    expect(justificatifDeLaVente(c, m)).toBe(JUSTIFICATIF_ENCAISSEMENT)
  })

  it('jamais une facture que la base refuserait d’encaisser sur ce crédit, du montant que la fenêtre proposerait', () => {
    // Le crédit justifie déjà 500 € de la facture d'avant la bascule : encaisser 600 € de F2026-0014 le dépasserait.
    const m = mouvement({ id: 'm', montant: 600, libelle: 'VIR SARL HORIZON' })
    const avant = encaissement({ id: 'e0', facture_id: 'f0', montant: 500, ligne_bancaire_id: 'm' })
    expect(surLeCredit(m, [avant])).toEqual([])
    expect(surLeCredit(m).map((x) => x.id)).toEqual(['f1'])
  })

  it('un mouvement figé n’a pas de candidat, même un encaissement daté d’après la frontière', () => {
    const m = mouvement({ id: 'm', montant: 300, date: '2025-12-30', libelle: 'REMISE CHEQUE LIBRAIRIE ROCHER' })
    const e = encaissement({ id: 'e3', facture_id: 'f3', montant: 300, date_encaissement: '2026-01-02' })
    expect(candidatsDuMouvement(candidatsDe(sources([m], [e]), [2025]), m)).toEqual([])
    expect(candidatsDuMouvement(candidatsDe(sources([m], [e]), []), m).map((x) => x.id)).toEqual(['e3'])
  })

  it('un encaissement figé reste candidat d’un crédit libre d’après, sauf par compensation ou par un autre moyen (VF7a)', () => {
    // Le chèque remis le 30 décembre d'un exercice validé, crédité en janvier : la base le rattache, son écriture inchangée.
    const m = mouvement({ id: 'm', montant: 300, date: '2026-01-05', libelle: 'REMISE CHEQUE LIBRAIRIE ROCHER' })
    const cheque = encaissement({ id: 'e3', facture_id: 'f3', montant: 300, moyen: 'cheque', date_encaissement: '2025-12-30' })
    expect(candidatsDuMouvement(candidatsDe(sources([m], [cheque]), [2025]), m).map((x) => [x.id, x.genre]))
      .toEqual([['e3', 'encaissement']])
    // Par un autre moyen, il s'écrit sur son compte de contrepartie, que le rattachement lui ferait quitter : la base le
    // refuse, et il n'est pas proposé — il le serait le lendemain de la frontière.
    const autre = { ...cheque, moyen: 'autre' as const }
    expect(candidatsDuMouvement(candidatsDe(sources([m], [autre]), [2025]), m).filter((x) => x.genre === 'encaissement')).toEqual([])
    expect(candidatsDuMouvement(candidatsDe(sources([m], [autre]), []), m).filter((x) => x.genre === 'encaissement')
      .map((x) => x.id)).toEqual(['e3'])
  })

  it('le plus petit écart d’abord, quel que soit le genre', () => {
    const m = mouvement({ id: 'm', montant: 297, libelle: 'VIR LIBRAIRIE ROCHER HORIZON' })
    // F2026-0016 (300 €) à 3 € ; un encaissement de F2026-0014 de 200 € à 97 €, désigné par le nom ; le reste de
    // F2026-0014, 400 €, à 103 €.
    const c = surLeCredit(m, [encaissement({ id: 'e1', facture_id: 'f1', montant: 200 })])
    expect(c.map((x) => [x.id, x.ecartCentimes])).toEqual([['f3', 300], ['e1', 9700], ['f1', 10300]])
  })

  it('jamais un encaissement que la base ne rattacherait pas : plus grand que le crédit au-delà des frais', () => {
    const m = mouvement({ id: 'm', montant: 590, libelle: 'VIR SARL HORIZON' })
    // 600 € sur 590 € : 10 € d'écart, au-delà des frais — même le nom du client cité n'y change rien.
    expect(surLeCredit(m, [encaissement({ id: 'e1', facture_id: 'f1', montant: 600 })]).filter((x) => x.genre === 'encaissement'))
      .toEqual([])
  })

  it('une facture soldée, un encaissement retiré ou déjà rattaché, un avoir, une facture d’avant : jamais candidats', () => {
    const m = mouvement({ id: 'm', montant: 600, libelle: 'VIR SARL HORIZON DUPUIS LEFEBVRE MARTIN' })
    const solde = encaissement({ id: 'e-solde', facture_id: 'f1', montant: 600, ligne_bancaire_id: 'm-ailleurs' })
    const retire = encaissement({ id: 'e-retire', facture_id: 'f3', montant: 300, retire_le: '2026-03-11T09:00:00Z' })
    const rattache = encaissement({ id: 'e-rattache', facture_id: 'f2', montant: 100, ligne_bancaire_id: 'm-autre' })
    const avant = encaissement({ id: 'e-avant', facture_id: 'f0', montant: 600 })
    const c = surLeCredit(m, [solde, retire, rattache, avant])
    // Reste F2026-0015, désignée par le nom de son client (Atelier Martin) ; jamais F2026-0014 soldée, l'avoir, l'ancienne
    // facture de Dupuis, le brouillon de Lefebvre, ni les trois encaissements.
    expect(c.map((x) => x.id)).toEqual(['f2'])
  })

  it('rien sur un mouvement qui n’est pas libre, réservé, figé, ni sur un débit pour une facture', () => {
    const e = encaissement({ id: 'e1', facture_id: 'f1', montant: 600 })
    const classe = mouvement({ id: 'm', statut: 'rapprochee', piece_id: 'p1' })
    expect(surLeCredit(classe, [e])).toEqual([])
    const reserve = mouvement({ id: 'm', montant: 900 })
    expect(surLeCredit(reserve, [e, encaissement({ id: 'e3', facture_id: 'f3', montant: 300, ligne_bancaire_id: 'm' })])).toEqual([])
    const m = mouvement({ id: 'm', montant: 600 })
    expect(candidatsDuMouvement(candidatsDe(sources([m], [e]), [2026]), m)).toEqual([])
    expect(candidatsDuMouvement(candidatsDe(sources([m], [e]), [2025]), m).map((x) => x.id)).toEqual(['e1'])
    expect(surLeCredit(mouvement({ id: 'm', montant: 0 }), [e])).toEqual([])
    // Un mouvement que la lecture des ventes n'a pas rendu, ou d'un autre dossier.
    expect(candidatsDuMouvement(candidatsDe(sources([m], [e])), { ...m, id: 'absent' })).toEqual([])
    expect(candidatsDuMouvement(candidatsDe(sources([m], [e])), { ...m, dossier_id: 'autre' })).toEqual([])
    expect(candidatsDuMouvement(AUCUN_CANDIDAT, m)).toEqual([])
  })
})

describe('candidatsDuMouvement : un DÉBIT libre — la contre-passation seule', () => {
  // L'encaissement d'origine sans mouvement : rattachée à un débit, sa contre-passation ne fait rien justifier de plus
  // (une origine classée, la base la refuserait — `origine_classee`).
  const ORIGINE = encaissement({ id: 'o1', facture_id: 'f1', montant: 600 })
  const CREDIT = mouvement({ id: 'm-credit', montant: 75, libelle: 'VIR CPAM' })
  const CP = encaissement({ id: 'cp1', facture_id: 'f1', montant: -600, annule_id: 'o1', date_encaissement: '2026-03-20' })
  const surLeDebit = (d: LigneBancaire, encaissements = [ORIGINE, CP]) => {
    const c = candidatsDe(sources([CREDIT, d], encaissements))
    return { liste: candidatsDuMouvement(c, d), justificatif: justificatifDeLaVente(c, d) }
  }

  it('une contre-passation sans mouvement que le débit fait aux frais près (la banque débite un peu plus)', () => {
    const r = surLeDebit(mouvement({ id: 'd', montant: -601.5, libelle: 'IMPAYE CHQ 0001234' }))
    expect(r.liste).toMatchObject([{
      genre: 'contre_passation', id: 'cp1', montantCentimes: 60000, ecartCentimes: 150, parLeMontant: true, parLeClient: false,
      signaux: [SIGNAL_MONTANT_DEBIT], titre: 'Contre-passation enregistrée sans mouvement',
    }])
    expect(r.justificatif).toBe(JUSTIFICATIF_CONTRE_PASSATION)
  })

  it('le client seul ne désigne pas un impayé : la contre-passation se dit, le lot n’en apprend rien', () => {
    const r = surLeDebit(mouvement({ id: 'd', montant: -900, libelle: 'IMPAYE SARL HORIZON' }))
    expect(r.liste.map((x) => [x.id, x.parLeMontant, x.parLeClient])).toEqual([['cp1', false, true]])
    expect(r.justificatif).toBeNull()
  })

  it('jamais un encaissement ni une facture pour un débit ; jamais une contre-passation pour un crédit', () => {
    const d = mouvement({ id: 'd', montant: -600 })
    const r = surLeDebit(d, [ORIGINE, CP, encaissement({ id: 'e3', facture_id: 'f3', montant: 300 })])
    expect(r.liste.map((x) => x.id)).toEqual(['cp1'])
    const credit = mouvement({ id: 'c', montant: 600 })
    expect(candidatsDuMouvement(candidatsDe(sources([CREDIT, credit], [ORIGINE, CP])), credit).map((x) => x.genre))
      .not.toContain('contre_passation')
  })

  it('une contre-passation que la base ne rattacherait pas (le débit plus petit au-delà des frais) : rien', () => {
    expect(surLeDebit(mouvement({ id: 'd', montant: -500, libelle: 'IMPAYE SARL HORIZON' })).liste).toEqual([])
  })

  it('une contre-passation figée reste candidate d’un débit libre d’après, sauf par compensation ou par un autre moyen (VF7a)', () => {
    // Le chèque remis le 30 décembre d'un exercice validé, revenu impayé en janvier : sa contre-passation sans mouvement,
    // datée du 31 décembre, se rattache au débit de janvier — elle défait le chèque au 511, et y reste.
    const origine = encaissement({ id: 'o1', facture_id: 'f1', montant: 600, moyen: 'cheque', date_encaissement: '2025-12-30' })
    const cp = encaissement({
      id: 'cp1', facture_id: 'f1', montant: -600, moyen: 'cheque', annule_id: 'o1', date_encaissement: '2025-12-31',
    })
    const d = mouvement({ id: 'd', montant: -600, date: '2026-01-07', libelle: 'IMPAYE CHQ 0001234' })
    expect(candidatsDuMouvement(candidatsDe(sources([CREDIT, d], [origine, cp]), [2025]), d).map((x) => [x.id, x.genre]))
      .toEqual([['cp1', 'contre_passation']])
    // Par un autre moyen, elle défait son encaissement sur son compte de contrepartie, que le rattachement lui ferait
    // quitter : la base le refuse, et elle n'est pas proposée — elle le serait le lendemain de la frontière.
    const autres = [{ ...origine, moyen: 'autre' as const }, { ...cp, moyen: 'autre' as const }]
    expect(candidatsDuMouvement(candidatsDe(sources([CREDIT, d], autres), [2025]), d)).toEqual([])
    expect(candidatsDuMouvement(candidatsDe(sources([CREDIT, d], autres), []), d).map((x) => x.id)).toEqual(['cp1'])
  })
})

describe('justificatifPossible apprend les candidats de la vente', () => {
  const aucun = {
    pieces: [], piecesRapprochees: new Set<string>(), restesARegler: new Map<string, number>(), cotisations: [],
    cotisationsRapprochees: new Set<string>(), facturesSources: AUCUNE_FACTURE_SOURCE,
  }

  it('une facture, un encaissement : les mots de la conception ; sans candidat, rien', () => {
    const m = mouvement({ id: 'm', montant: 600 })
    expect(justificatifPossible(m, { ...aucun, ventes: candidatsDe(sources([m])) })).toBe(JUSTIFICATIF_FACTURE)
    expect(JUSTIFICATIF_FACTURE).toBe('Une facture de l’application attend son encaissement : ce crédit la règle peut-être.')
    const e = encaissement({ id: 'e1', facture_id: 'f1', montant: 600 })
    expect(justificatifPossible(m, { ...aucun, ventes: candidatsDe(sources([m], [e])) })).toBe(JUSTIFICATIF_ENCAISSEMENT)
    expect(JUSTIFICATIF_ENCAISSEMENT).toBe('Un encaissement enregistré attend son mouvement.')
    expect(JUSTIFICATIF_CONTRE_PASSATION).toBe('Une contre-passation enregistrée attend son mouvement.')
    expect(justificatifPossible(m, { ...aucun, ventes: AUCUN_CANDIDAT })).toBeNull()
    const autre = mouvement({ id: 'm', montant: 123.45 })
    expect(justificatifPossible(autre, { ...aucun, ventes: candidatsDe(sources([autre])) })).toBeNull()
  })

  it('une pièce du même montant se dit d’abord, comme hier', () => {
    const m = mouvement({ id: 'm', montant: 600 })
    expect(justificatifPossible(m, { ...aucun, pieces: [piece({ id: 'p1' })], ventes: candidatsDe(sources([m])) }))
      .toBe('Une pièce du même montant attend un rapprochement.')
  })

  // L'EXEMPLAIRE D'UNE FACTURE SOURCE (étape VF6d) n'est le justificatif d'aucun mouvement (G4) : du même montant, il ne se dit
  // plus — c'est sa facture, qui attend son encaissement, que le lot des règles et la fiche disent.
  it('l’exemplaire d’une facture source du même montant ne se dit pas : sa facture, si', () => {
    const m = mouvement({ id: 'm', montant: 600 })
    const exemplaire = piece({ id: 'p-ex', facture_id: 'f1' })
    const avec = { ...aucun, pieces: [exemplaire], ventes: candidatsDe(sources([m])), facturesSources: new Set(['f1', 'f2', 'f3']) }
    expect(justificatifPossible(m, avec)).toBe(JUSTIFICATIF_FACTURE)
    expect(justificatifPossible(m, { ...avec, facturesSources: AUCUNE_FACTURE_SOURCE })).toBe('Une pièce du même montant attend un rapprochement.')
  })
})

// LE DOUBLE COMPTE DU RELEVÉ : un crédit libre qu'une facture source pourrait régler, sur un relevé où un virement est
// réservé à l'encaissement d'une autre facture.
describe('les lots sur un crédit qu’une facture source pourrait régler', () => {
  const RESERVE = mouvement({ id: 'm-res', montant: 300, libelle: 'VIR LIBRAIRIE ROCHER' })
  const CANDIDAT = mouvement({ id: 'm-cand', montant: 598.5, libelle: 'VIR SARL HORIZON' })
  const LIBRE = mouvement({ id: 'm-libre', montant: 75, libelle: 'VIR CPAM REMBOURSEMENT' })
  const RELEVE = [RESERVE, CANDIDAT, LIBRE]
  const s = sources(RELEVE, [encaissement({ id: 'e3', facture_id: 'f3', montant: 300, ligne_bancaire_id: 'm-res' })])
  const VENTES = ventesDuReleve(true, D, lue(s), ACCES)
  const CANDIDATS = candidatsDeLaVente(VENTES, lue(s), [])
  const HORS = mouvementsHorsDesLots(VENTES)
  const AVEC = horsDesLotsAvecLesCandidats(HORS, CANDIDATS, RELEVE)
  const MOTS_DU_RESERVE = REFUS_GARDE_MOUVEMENTS[3].modele.replace('%', 'F2026-0016')

  it('la liste des trois autres lots : le réservé sous les mots de la garde, le candidat sous sa phrase, jamais le libre', () => {
    expect([...AVEC.entries()]).toEqual([['m-res', MOTS_DU_RESERVE], ['m-cand', JUSTIFICATIF_FACTURE]])
    // Sans candidat, la même liste, telle quelle.
    expect(horsDesLotsAvecLesCandidats(HORS, AUCUN_CANDIDAT, RELEVE)).toBe(HORS)
    expect(horsDesLotsAvecLesCandidats(AUCUN_HORS_DES_LOTS, AUCUN_CANDIDAT, RELEVE)).toBe(AUCUN_HORS_DES_LOTS)
  })

  it('le lot des règles : le candidat « à rapprocher », sous sa phrase ; ni proposé, ni dit porté par des encaissements', () => {
    const RECETTES: Categorie = {
      id: 'cat-recettes', dossier_id: null, code: 'ventes_prestations', libelle: 'Ventes / prestations', ordre: 80,
      compte_comptable: '706000', poste_2035: 'Recettes',
    }
    const regle: RegleAffectationBancaire = {
      id: 'r1', dossier_id: D, motif: 'vir', sens: 'encaissement', categorie_id: 'cat-recettes', taux_tva: null,
      created_at: '2026-01-01T00:00:00Z',
    }
    // « vir » ne passe pas `refusMotif`, mais le plan ne juge pas le motif : il désigne ici tout le relevé.
    const justificatifs = {
      pieces: [], piecesRapprochees: new Set<string>(), restesARegler: new Map<string, number>(), cotisations: [],
      cotisationsRapprochees: new Set<string>(), ventes: CANDIDATS, facturesSources: AUCUNE_FACTURE_SOURCE,
    }
    const plan = planAffectationParRegles(RELEVE, [regle], [RECETTES], false, (l) => justificatifPossible(l, justificatifs), HORS)
    expect(plan.propositions.map((p) => p.ligne.id)).toEqual(['m-libre'])
    expect(plan.aRapprocher.map((r) => [r.ligne.id, r.raison])).toEqual([['m-cand', JUSTIFICATIF_FACTURE]])
    expect(plan.ecartesParLesVentes.map((l) => l.id)).toEqual(['m-res'])
    // Sans les candidats — hier —, le lot l'affectait en recette, à côté de l'encaissement que la facture attend.
    const hier = planAffectationParRegles(RELEVE, [regle], [RECETTES], false,
      (l) => justificatifPossible(l, { ...justificatifs, ventes: AUCUN_CANDIDAT }), HORS)
    expect(hier.propositions.map((p) => p.ligne.id)).toEqual(['m-cand', 'm-libre'])
  })

  it('le rapprochement automatique ne rapproche pas le candidat de l’exemplaire de sa facture ; il le dit', () => {
    const vide = { pieces: new Set<string>(), cotisations: new Set<string>() }
    const exemplaire = piece({ id: 'p-ex', montant_ttc: 598.5, facture_id: 'f1' })
    const p = planRapprochementAutomatique([CANDIDAT, LIBRE], [exemplaire], [], vide, AVEC, AUCUNE_FACTURE_SOURCE)
    expect(p).toEqual({ retenus: [], ecartesPourAmbiguite: 0, ecartesParLesVentes: [CANDIDAT] })
    expect(planRapprochementAutomatique([CANDIDAT, LIBRE], [exemplaire], [], vide, HORS, AUCUNE_FACTURE_SOURCE).retenus)
      .toEqual([{ ligneId: 'm-cand', pieceId: 'p-ex' }])
  })

  it('« Valider et rapprocher » ne valide ni ne rapproche la pièce du candidat ; la règle d’ignorance ne l’ignore pas', () => {
    const paire = (l: LigneBancaire, id: string): Appariement => ({ piece: piece({ id, statut: 'a_valider' }), ligne: l, ecartJours: 2 })
    const lot = lotDesCertains([paire(CANDIDAT, 'p1'), paire(LIBRE, 'p2')], AVEC, AUCUN_REFUS_DE_VALIDATION)
    expect(lot.aEcrire.map((a) => a.piece.id)).toEqual(['p2'])
    expect(lot.ecartesParLesVentes.map((a) => a.ligne.id)).toEqual(['m-cand'])
    // Un motif par tiers : « vir », qui les reconnaissait tous trois, est un motif trop commun, inopérant depuis le
    // 31/10/2026 (lib/reglesIgnorees.ts).
    expect(ignoresParLaRegle(RELEVE, 'rocher', AVEC)).toEqual({ aIgnorer: [], ecartesParLesVentes: [RESERVE] })
    expect(ignoresParLaRegle(RELEVE, 'horizon', AVEC)).toEqual({ aIgnorer: [], ecartesParLesVentes: [CANDIDAT] })
    expect(ignoresParLaRegle(RELEVE, 'cpam', AVEC)).toEqual({ aIgnorer: [LIBRE], ecartesParLesVentes: [] })
  })

  it('ce que la carte d’un lot en dit : les candidats autrement que les mouvements portés', () => {
    expect(ecartDuLot([CANDIDAT], AVEC)?.resume)
      .toBe('1 mouvement écarté : une vente facturée le justifie peut-être — il reste à rapprocher depuis sa fiche.')
    const deux = mouvement({ ...CANDIDAT, id: 'm-cand2' })
    const avecDeux = new Map([...AVEC, ['m-cand2', JUSTIFICATIF_ENCAISSEMENT]])
    expect(ecartDuLot([CANDIDAT, deux], avecDeux)?.resume)
      .toBe('2 mouvements écartés : une vente facturée les justifie peut-être — ils restent à rapprocher depuis leur fiche.')
    expect(ecartDuLot([RESERVE, CANDIDAT], AVEC)?.resume)
      .toBe('2 mouvements écartés : 1 porte des encaissements de factures, 1 est peut-être justifié par une vente facturée, à '
        + 'rapprocher depuis sa fiche.')
    expect(ecartDuLot([RESERVE, CANDIDAT, deux], avecDeux)?.resume)
      .toBe('3 mouvements écartés : 1 porte des encaissements de factures, 2 sont peut-être justifiés par une vente facturée, à '
        + 'rapprocher depuis leur fiche.')
    expect(ecartDuLot([RESERVE], AVEC)?.resume).toBe('1 mouvement écarté : il porte des encaissements de factures.')
  })
})

describe('la fiche : les candidats en tête d’un crédit libre ; l’ordre et le client cité d’un débit', () => {
  it('un crédit libre : `proposes`, chacun aussi dans sa liste ; un crédit réservé, aucun', () => {
    const m = mouvement({ id: 'm', montant: 299, libelle: 'REMISE CHEQUE LIBRAIRIE ROCHER' })
    const e = encaissement({ id: 'e3', facture_id: 'f3', montant: 300, moyen: 'cheque' })
    const s = sources([m], [e])
    const g = gestesDuCredit(ventesDuReleve(true, D, lue(s), ACCES), lue(s), m, [], PLAN_PAR_DEFAUT)
    if (g.etat !== 'libre') throw new Error(g.etat)
    expect(g.complement.proposes.map((x) => x.id)).toEqual(['e3'])
    expect(g.complement.rattachables.map((x) => [x.id, x.clientCite])).toEqual([['e3', true]])
    // À écart égal, la liste d'un crédit fait passer devant le client cité au libellé, puis la date.
    const deux = [
      encaissement({ id: 'ea', facture_id: 'f1', montant: 300, date_encaissement: '2026-03-01' }),
      encaissement({ id: 'eb', facture_id: 'f3', montant: 300, date_encaissement: '2026-03-05' }),
    ]
    const remise = mouvement({ id: 'm', montant: 300, libelle: 'REMISE CHEQUE LIBRAIRIE ROCHER' })
    const sr = sources([remise], deux)
    const gl = gestesDuCredit(ventesDuReleve(true, D, lue(sr), ACCES), lue(sr), remise, [], PLAN_PAR_DEFAUT)
    if (gl.etat !== 'libre') throw new Error(gl.etat)
    expect(gl.complement.rattachables.map((x) => x.id)).toEqual(['eb', 'ea'])
    // Un crédit réservé dont il reste à faire : le complément, sans candidat en tête.
    const reserve = mouvement({ id: 'm', montant: 900 })
    const r = sources([reserve], [encaissement({ id: 'e1', facture_id: 'f1', montant: 600, ligne_bancaire_id: 'm' }), e])
    const gr = gestesDuCredit(ventesDuReleve(true, D, lue(r), ACCES), lue(r), reserve, [], PLAN_PAR_DEFAUT)
    if (gr.etat !== 'reserve') throw new Error(gr.etat)
    expect(gr.complement?.proposes).toEqual([])
    expect(gr.complement?.rattachables.map((x) => x.id)).toEqual(['e3'])
  })

  it('un débit : la liste reste entière, l’écart d’abord, puis le client cité au libellé, qu’elle dit', () => {
    const credit = mouvement({ id: 'm-credit', montant: 75, libelle: 'VIR CPAM' })
    const encaissements = [
      encaissement({ id: 'o1', facture_id: 'f1', montant: 300 }),
      encaissement({ id: 'o3', facture_id: 'f3', montant: 300 }),
      encaissement({ id: 'o2', facture_id: 'f2', montant: 300 }),
      encaissement({ id: 'cpa', facture_id: 'f1', montant: -300, annule_id: 'o1', date_encaissement: '2026-03-20' }),
      encaissement({ id: 'cpb', facture_id: 'f3', montant: -300, annule_id: 'o3', date_encaissement: '2026-03-21' }),
    ]
    const d = mouvement({ id: 'd', montant: -300, date: '2026-03-25', libelle: 'IMPAYE LIBRAIRIE ROCHER' })
    const s = { ...sources([credit, d], encaissements), declarations: [] }
    const g = gestesDuDebit(ventesDuReleve(true, D, lue(s), ACCES), { dossierId: D, etat: 'lue', sources: s }, d, [], PLAN_PAR_DEFAUT, '2026-04-01')
    if (g.etat !== 'libre') throw new Error(g.etat)
    expect(g.complement.rattachables.map((x) => [x.id, x.clientCite])).toEqual([['cpb', true], ['cpa', false]])
    // Le même débit sans le nom : la date départage, comme hier.
    const sansNom = { ...d, libelle: 'IMPAYE CHQ 0001234' }
    const h = gestesDuDebit(ventesDuReleve(true, D, lue(s), ACCES), { dossierId: D, etat: 'lue', sources: s }, sansNom, [], PLAN_PAR_DEFAUT, '2026-04-01')
    if (h.etat !== 'libre') throw new Error(h.etat)
    expect(h.complement.rattachables.map((x) => [x.id, x.clientCite])).toEqual([['cpa', false], ['cpb', false]])
  })
})
