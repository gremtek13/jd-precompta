import { describe, expect, it } from 'vitest'
import { ACCES_EN_COURS, type AccesDuDossier } from './auteursVentes'
import { REFUS_GARDE_MOUVEMENTS, type FactureDuDossier, type MouvementClasse } from './encaissementsFactures'
import {
  carteDeVente, mouvementDeVente, pastilleDeVente, retenueDuReleve, venteDuMouvement, ventesDuReleve,
  type EncaissementDuMouvementLu, type LectureDesVentesDuReleve, type MouvementDeVente, type SourcesDuReleve, type VentesDuReleve,
} from './mouvementsDesVentes'

// LE RELEVÉ RECONNAÎT LES MOUVEMENTS DES VENTES FACTURÉES (ligne 28.65, étape VF5a1). Le module ne recopie aucune règle : il
// lit la garde G2 (`refusDuClassementDuReleve`) et le filtre des encaissements qu'elle regarde. Ces cas gardent ce qu'il en
// tire — classé, réservé, ou rien —, l'ordre et l'auteur des encaissements portés, les mots de la liste et de la fiche, et
// le tout ou rien de la lecture. Données FICTIVES.

const D = 'd-bascule'

const facture = (o: Partial<FactureDuDossier> & Pick<FactureDuDossier, 'id'>): FactureDuDossier => ({
  dossier_id: D, numero: `F-${o.id}`, type: 'facture', statut: 'validee', facture_origine_id: null, source_de_la_vente: true, ...o,
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

const ACCES: AccesDuDossier = { etat: 'lus', comptes: ['u-client'] }

const FACTURES = [
  facture({ id: 'f1', numero: 'F2026-0014' }),
  facture({ id: 'f2', numero: 'F2026-0015' }),
  // D'avant la bascule : ses encaissements ne réservent rien.
  facture({ id: 'f0', numero: 'F2025-0099', source_de_la_vente: false }),
]

function sources(o: Partial<SourcesDuReleve> = {}): SourcesDuReleve {
  return { dossierId: D, factures: FACTURES, encaissements: [], mouvements: [], ...o }
}

const lue = (s: SourcesDuReleve): LectureDesVentesDuReleve => ({ dossierId: D, etat: 'lue', sources: s })

function porte(v: VentesDuReleve, id: string): MouvementDeVente | undefined {
  if (v.etat !== 'lue') throw new Error(`lecture ${v.etat}`)
  return v.mouvements.get(id)
}

describe('ventesDuReleve : le tout ou rien de la lecture', () => {
  const s = sources({
    mouvements: [mouvement({ id: 'm1' })],
    encaissements: [encaissement({ id: 'e1', facture_id: 'f1', montant: 600, ligne_bancaire_id: 'm1' })],
  })

  it('un dossier qui n’a pas basculé : sans objet, quoi qu’on lui passe', () => {
    expect(ventesDuReleve(false, D, lue(s), ACCES)).toEqual({ etat: 'sans_objet' })
    expect(ventesDuReleve(false, D, null, ACCES)).toEqual({ etat: 'sans_objet' })
  })

  it('basculé, pas encore revenue, ou d’un autre dossier : en cours — rien ne s’en décide', () => {
    expect(ventesDuReleve(true, D, null, ACCES)).toEqual({ etat: 'en_cours' })
    expect(ventesDuReleve(true, D, { ...lue(s), dossierId: 'autre' }, ACCES)).toEqual({ etat: 'en_cours' })
    expect(ventesDuReleve(true, D, lue({ ...s, dossierId: 'autre' }), ACCES)).toEqual({ etat: 'en_cours' })
  })

  it('basculé, incomplète : le motif', () => {
    expect(ventesDuReleve(true, D, { dossierId: D, etat: 'incomplete', motif: 'les encaissements : 3 lignes sur 5' }, ACCES))
      .toEqual({ etat: 'incomplete', motif: 'les encaissements : 3 lignes sur 5' })
  })

  it('basculé, lue : les mouvements classés ou réservés, et eux seuls', () => {
    const v = ventesDuReleve(true, D, lue({ ...s, mouvements: [...s.mouvements, mouvement({ id: 'm-libre' })] }), ACCES)
    expect(v.etat === 'lue' && [...v.mouvements.keys()]).toEqual(['m1'])
  })

  it('un mouvement d’un autre dossier, rendu par erreur, n’est jamais dit', () => {
    const v = ventesDuReleve(true, D, lue({ ...s, mouvements: [mouvement({ id: 'm1', dossier_id: 'autre' })] }), ACCES)
    expect(v.etat === 'lue' && v.mouvements.size).toBe(0)
  })

  it('retenueDuReleve : ce qui retient les gestes et les lots, et rien quand la lecture est entière ou sans objet', () => {
    expect(retenueDuReleve({ etat: 'sans_objet' })).toBeNull()
    expect(retenueDuReleve({ etat: 'lue', mouvements: new Map() })).toBeNull()
    expect(retenueDuReleve({ etat: 'en_cours' })).toBe('les ventes facturées du dossier ne sont pas encore lues')
    expect(retenueDuReleve({ etat: 'incomplete', motif: 'refusée' })).toBe('les ventes facturées du dossier : refusée')
  })
})

describe('mouvementDeVente : classé, réservé, ou rien — par la garde G2', () => {
  it('classé par ses encaissements : ses encaissements de factures sources, et les mots de la garde', () => {
    const m = mouvement({ id: 'm1', statut: 'rapprochee', montant: 598.5, encaissements_de_factures: true })
    const v = mouvementDeVente(m, sources({
      encaissements: [encaissement({ id: 'e1', facture_id: 'f1', montant: 600, ligne_bancaire_id: 'm1' })],
    }), ACCES)
    expect(v).toMatchObject({ id: 'm1', etat: 'classe', montant: 598.5, factures: ['F2026-0014'] })
    expect(v?.refus).toEqual({ cle: 'classe_par_ses_encaissements', message: REFUS_GARDE_MOUVEMENTS[2].modele })
  })

  it('réservé : un encaissement vivant d’une facture source le cite et le justifie ; la garde nomme la facture du premier', () => {
    const v = mouvementDeVente(mouvement({ id: 'm1' }), sources({
      encaissements: [
        encaissement({ id: 'e2', facture_id: 'f2', montant: 200, ligne_bancaire_id: 'm1', cree_le: '2026-03-11T08:00:00Z' }),
        encaissement({ id: 'e1', facture_id: 'f1', montant: 400, ligne_bancaire_id: 'm1', cree_le: '2026-03-10T08:00:00Z' }),
      ],
    }), ACCES)
    expect(v?.etat).toBe('reserve')
    // L'ordre de la garde : la création, puis l'identifiant — pas celui de la liste reçue.
    expect(v?.encaissements.map((e) => e.id)).toEqual(['e1', 'e2'])
    expect(v?.factures).toEqual(['F2026-0014', 'F2026-0015'])
    expect(v?.refus.message).toBe(
      'Ce mouvement justifie un encaissement de la facture F2026-0014, source de sa vente : il se classe par ses encaissements, et par rien d\'autre.',
    )
  })

  it('à égalité de création, l’identifiant départage, octet par octet', () => {
    const v = mouvementDeVente(mouvement({ id: 'm1' }), sources({
      encaissements: [
        encaissement({ id: 'eb', facture_id: 'f2', montant: 300, ligne_bancaire_id: 'm1' }),
        encaissement({ id: 'eB', facture_id: 'f1', montant: 300, ligne_bancaire_id: 'm1' }),
      ],
    }), ACCES)
    expect(v?.encaissements.map((e) => e.id)).toEqual(['eB', 'eb'])
  })

  it('rien : l’encaissement d’une facture qui n’est pas source, un encaissement retiré, un encaissement qu’une contre-passation sans mouvement annule', () => {
    const cas: EncaissementDuMouvementLu[][] = [
      [encaissement({ id: 'e0', facture_id: 'f0', montant: 600, ligne_bancaire_id: 'm1' })],
      [encaissement({ id: 'e1', facture_id: 'f1', montant: 600, ligne_bancaire_id: 'm1', retire_le: '2026-03-15T10:00:00Z' })],
      [
        encaissement({ id: 'e1', facture_id: 'f1', montant: 600, ligne_bancaire_id: 'm1' }),
        encaissement({ id: 'c1', facture_id: 'f1', montant: -600, annule_id: 'e1' }),
      ],
      // Un encaissement d'un autre mouvement.
      [encaissement({ id: 'e1', facture_id: 'f1', montant: 600, ligne_bancaire_id: 'm2' })],
    ]
    for (const encaissements of cas) {
      expect(mouvementDeVente(mouvement({ id: 'm1' }), sources({ encaissements }), ACCES), encaissements.map((e) => e.id).join(',')).toBeNull()
    }
  })

  it('une contre-passation qui cite un débit le réserve aussi, et se dit contre-passation', () => {
    const v = mouvementDeVente(mouvement({ id: 'd1', montant: -600 }), sources({
      encaissements: [
        encaissement({ id: 'e1', facture_id: 'f1', montant: 600, ligne_bancaire_id: 'm1' }),
        encaissement({ id: 'c1', facture_id: 'f1', montant: -600, annule_id: 'e1', ligne_bancaire_id: 'd1', moyen: 'cheque' }),
      ],
    }), ACCES)
    expect(v).toMatchObject({ etat: 'reserve', factures: ['F2026-0014'] })
    expect(v?.encaissements).toEqual([expect.objectContaining({ id: 'c1', contrePassation: true, montant: -600, moyen: 'Chèque' })])
  })

  it('l’auteur : le client sur des accès lus en entier ; jamais sur des accès lus en partie ou pas encore revenus', () => {
    const s = sources({ encaissements: [encaissement({ id: 'e1', facture_id: 'f1', montant: 600, ligne_bancaire_id: 'm1', cree_par: 'u-client' })] })
    expect(mouvementDeVente(mouvement({ id: 'm1' }), s, ACCES)).toMatchObject({ parLeClient: true, encaissements: [{ parLeClient: true }] })
    for (const acces of [ACCES_EN_COURS, { etat: 'incomplets', motif: 'refusée' } as const, { etat: 'sans_objet' } as const]) {
      expect(mouvementDeVente(mouvement({ id: 'm1' }), s, acces), acces.etat).toMatchObject({ parLeClient: false, encaissements: [{ parLeClient: false }] })
    }
    // Un auteur nul n'est personne.
    const sansAuteur = sources({ encaissements: [encaissement({ id: 'e1', facture_id: 'f1', montant: 600, ligne_bancaire_id: 'm1', cree_par: null })] })
    expect(mouvementDeVente(mouvement({ id: 'm1' }), sansAuteur, ACCES)?.parLeClient).toBe(false)
  })

  it('l’auteur : « proposé par le client » seulement si CHACUN de ses encaissements est du client', () => {
    const v = mouvementDeVente(mouvement({ id: 'm1' }), sources({
      encaissements: [
        encaissement({ id: 'e1', facture_id: 'f1', montant: 400, ligne_bancaire_id: 'm1', cree_par: 'u-client' }),
        encaissement({ id: 'e2', facture_id: 'f2', montant: 200, ligne_bancaire_id: 'm1', cree_le: '2026-03-11T10:00:00Z' }),
      ],
    }), ACCES)
    expect(v?.parLeClient).toBe(false)
    expect(v?.encaissements.map((e) => e.parLeClient)).toEqual([true, false])
  })

  it('classé sans encaissement lu : classé quand même (la ligne le dit), et personne n’est « le client »', () => {
    const v = mouvementDeVente(mouvement({ id: 'm1', statut: 'rapprochee', encaissements_de_factures: true }), sources(), ACCES)
    expect(v).toMatchObject({ etat: 'classe', encaissements: [], factures: [], parLeClient: false })
  })

  it('une facture introuvable ne fait pas un numéro deviné', () => {
    const v = mouvementDeVente(mouvement({ id: 'm1', statut: 'rapprochee', encaissements_de_factures: true }), sources({
      factures: [facture({ id: 'f1', numero: null })],
      encaissements: [encaissement({ id: 'e1', facture_id: 'f1', montant: 600, ligne_bancaire_id: 'm1' })],
    }), ACCES)
    expect(v?.factures).toEqual(['sans numéro'])
  })
})

describe('pastilleDeVente : les mots de la liste', () => {
  const vente = (o: Partial<MouvementDeVente>): MouvementDeVente => ({
    id: 'm1', etat: 'reserve', montant: 600, encaissements: [], factures: ['F2026-0014'], parLeClient: false,
    refus: { cle: 'reserve', message: '' }, ...o,
  })

  it('classé : verte, ses factures', () => {
    expect(pastilleDeVente(vente({ etat: 'classe', factures: ['F2026-0014', 'F2026-0015'] })))
      .toEqual({ texte: 'Encaissements de factures — F2026-0014, F2026-0015', ton: 'ok', titre: null })
    expect(pastilleDeVente(vente({ etat: 'classe', factures: [] })).texte).toBe('Encaissements de factures')
  })

  it('réservé : attention, sa facture ou ses factures, encaissement ou contre-passation', () => {
    expect(pastilleDeVente(vente({}))).toEqual({ texte: 'Réservé à l’encaissement de la facture F2026-0014', ton: 'attention', titre: null })
    expect(pastilleDeVente(vente({ factures: ['F2026-0014', 'F2026-0015'] })).texte)
      .toBe('Réservé aux encaissements des factures F2026-0014, F2026-0015')
    expect(pastilleDeVente(vente({ montant: -600 })).texte).toBe('Réservé à la contre-passation de la facture F2026-0014')
    expect(pastilleDeVente(vente({ montant: -600, factures: ['F1', 'F2'] })).texte).toBe('Réservé aux contre-passations des factures F1, F2')
  })

  it('réservé par le client : « proposé par le client », et son survol', () => {
    expect(pastilleDeVente(vente({ parLeClient: true }))).toEqual({
      texte: 'Réservé à l’encaissement de la facture F2026-0014 — proposé par le client', ton: 'attention',
      titre: 'Encaissement enregistré par le client',
    })
    expect(pastilleDeVente(vente({ parLeClient: true, montant: -600 })).titre).toBe('Contre-passation enregistrée par le client')
    // Classé, la mention ne se dit pas : c'est le cabinet qui l'a classé.
    expect(pastilleDeVente(vente({ etat: 'classe', parLeClient: true })).texte).toBe('Encaissements de factures — F2026-0014')
  })
})

describe('venteDuMouvement et carteDeVente : la fiche', () => {
  const s = sources({
    mouvements: [mouvement({ id: 'm1', montant: 598.5 })],
    encaissements: [
      encaissement({ id: 'e1', facture_id: 'f1', montant: 400, ligne_bancaire_id: 'm1', cree_par: 'u-client', date_encaissement: '2026-03-09' }),
      encaissement({ id: 'e2', facture_id: 'f2', montant: 200, ligne_bancaire_id: 'm1', moyen: 'cheque', cree_le: '2026-03-11T10:00:00Z' }),
    ],
  })
  const v = ventesDuReleve(true, D, lue(s), ACCES)

  it('porté : la carte ; libre : la fiche d’hier', () => {
    expect(venteDuMouvement(v, mouvement({ id: 'm1' })).etat).toBe('porte')
    expect(venteDuMouvement(v, mouvement({ id: 'autre' }))).toEqual({ etat: 'libre' })
    expect(venteDuMouvement({ etat: 'sans_objet' }, mouvement({ id: 'm1' }))).toEqual({ etat: 'libre' })
  })

  it('pas encore lues, ou en partie : retenu, et la note le dit', () => {
    const enCours = venteDuMouvement({ etat: 'en_cours' }, mouvement({ id: 'm1' }))
    expect(enCours).toEqual({ etat: 'retenu', note: expect.stringMatching(/^Les ventes facturées du dossier sont en cours de lecture/) })
    const partielle = venteDuMouvement({ etat: 'incomplete', motif: 'les encaissements : refusée' }, mouvement({ id: 'm1' }))
    expect(partielle).toEqual({
      etat: 'retenu',
      note: 'Les ventes facturées du dossier n’ont pas pu être lues en entier (les encaissements : refusée) : ce mouvement porte '
        + 'peut-être l’encaissement d’une facture, et rien ne s’offre. Recharge la page.',
    })
  })

  it('classé, la ligne le dit d’elle-même : retenu sous les mots de la garde, même sans lecture', () => {
    const classe = mouvement({ id: 'm9', statut: 'rapprochee', encaissements_de_factures: true })
    expect(venteDuMouvement({ etat: 'sans_objet' }, classe)).toEqual({ etat: 'retenu', note: REFUS_GARDE_MOUVEMENTS[2].modele })
    expect(venteDuMouvement({ etat: 'lue', mouvements: new Map() }, classe)).toEqual({ etat: 'retenu', note: REFUS_GARDE_MOUVEMENTS[2].modele })
    const enCours = venteDuMouvement({ etat: 'en_cours' }, classe)
    expect(enCours.etat === 'retenu' && enCours.note.startsWith(`${REFUS_GARDE_MOUVEMENTS[2].modele} Les ventes facturées`)).toBe(true)
  })

  it('la carte d’un mouvement réservé : ses encaissements, leur auteur, l’ensemble, la garde, la suite', () => {
    const m = porte(v, 'm1') as MouvementDeVente
    const carte = carteDeVente(m, ACCES)
    expect(carte.titre).toBe('Réservé à des encaissements de factures')
    expect(carte.lignes.map((l) => [l.libelle, l.montant])).toEqual([
      ['Facture F2026-0014 — virement du 09/03/2026', 400],
      ['Facture F2026-0015 — chèque du 10/03/2026', 200],
    ])
    expect(carte.lignes.map((l) => l.parLeClient)).toEqual([{ libelle: 'par le client', titre: 'Encaissement enregistré par le client' }, null])
    expect(carte.ensemble?.replace(/\s/g, ' ')).toBe('Ensemble : 600,00 € ; le mouvement : 598,50 €.')
    expect(carte.pourquoi).toBe(m.refus.message)
    expect(carte.suite).toMatch(/^Tant qu’il n’est pas classé par ses encaissements/)
    expect(carte.noteDesAuteurs).toBeNull()
  })

  it('la carte d’un mouvement classé, d’un seul encaissement de son montant : pas d’ensemble ; des accès lus en partie : dit', () => {
    const m = mouvementDeVente(mouvement({ id: 'm1', statut: 'rapprochee', encaissements_de_factures: true }), sources({
      encaissements: [encaissement({ id: 'e1', facture_id: 'f1', montant: 600, ligne_bancaire_id: 'm1', annule_id: null })],
    }), ACCES) as MouvementDeVente
    const carte = carteDeVente(m, { etat: 'incomplets', motif: 'refusée' })
    expect(carte.titre).toBe('Classé par ses encaissements de factures')
    expect(carte.ensemble).toBeNull()
    expect(carte.suite).toBe('Ses écritures se passent dans l’onglet Écritures, section « Ventes facturées ».')
    expect(carte.noteDesAuteurs).toBe(
      'Les accès du dossier n’ont pas été lus en entier (refusée) : on ne peut pas dire quels encaissements le client a enregistrés.',
    )
  })

  it('la carte d’une contre-passation', () => {
    const m = mouvementDeVente(mouvement({ id: 'd1', montant: -600 }), sources({
      encaissements: [
        encaissement({ id: 'e1', facture_id: 'f1', montant: 600, ligne_bancaire_id: 'm1' }),
        encaissement({ id: 'c1', facture_id: 'f1', montant: -600, annule_id: 'e1', ligne_bancaire_id: 'd1', cree_par: 'u-client' }),
      ],
    }), ACCES) as MouvementDeVente
    const carte = carteDeVente(m, ACCES)
    expect([carte.lignes[0].libelle, carte.lignes[0].montant]).toEqual(['Contre-passation, facture F2026-0014 — virement du 10/03/2026', -600])
    expect(carte.lignes[0].parLeClient?.titre).toBe('Contre-passation enregistrée par le client')
    expect(carte.ensemble).toBeNull()
  })
})
