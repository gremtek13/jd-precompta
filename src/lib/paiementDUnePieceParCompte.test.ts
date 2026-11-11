import { describe, expect, it } from 'vitest'
import { SANS_EXEMPLAIRE } from '../test/ventesFacturees'
import { LIBELLES_PAR_DEFAUT, PREFIXES_PAR_DEFAUT } from '../test/modeles'
import { banquesDuDossier, comptesDeBanqueDuDossier, refusDesBanquesDesPaiements, type BanquesDuDossier } from './banqueDuMouvement'
import { analyserEcritures, ecrituresAGenerer, lignesPourPiece, type CibleComptable, type LigneAGenerer } from './ecritures'
import type { ModeleComptable } from './engagement'
import type { CompteDuReleve, LectureDesComptes } from './importParCompte'
import { PLAN_DECALE, PLAN_PAR_DEFAUT, type PlanComptable } from './planComptable'
import { paiementsDesPieces, type LignePayante } from './rattachement'
import type { EcritureBrouillon, Piece } from './types'

// LE PAIEMENT D'UNE PIÈCE AU 512 DU COMPTE DE SON MOUVEMENT (MCB5, quatrième partie ; lib/banqueDuMouvement.ts). Aucune
// fonction SQL ne vérifie la contrepartie d'une pièce : ce jeu en joue un mouvement de chaque compte — le principal au 512 du
// rôle, le second à son 512 propre —, par un rapprochement et par la part d'un règlement groupé, en trésorerie et en
// engagement, sous deux plans, et prouve qu'aucune écriture générée ne devient une rupture (sans contrepartie,
// déséquilibrée, « à régénérer »). Puis ce qui doit en être une : la banque d'hier au rôle pour un mouvement du second.
// Données FICTIVES.

const D = 'd1'
const ACHATS = '606100'
const compte = (c: Partial<CompteDuReleve> & Pick<CompteDuReleve, 'id'>): CompteDuReleve => ({
  libelle: 'Compte', principal: false, fin_d_identifiant: null, compte: null, compte_propre_depuis: null, ouvert_le: null, clos_le: null, ...c,
})
const PRINCIPAL = compte({ id: 'P', libelle: 'Compte principal', principal: true })
const SECOND = compte({ id: 'S', libelle: 'Compte bis fictif', compte: '512200', compte_propre_depuis: '2026-01-01' })
const LUS: LectureDesComptes = { etat: 'lus', comptes: [PRINCIPAL, SECOND] }

const modele = (plan: PlanComptable, mode: 'tresorerie' | 'engagement'): ModeleComptable => ({
  mode, compteNotesDeFrais: '455000', plan, libelles: LIBELLES_PAR_DEFAUT, prefixes: PREFIXES_PAR_DEFAUT,
})
const cible: CibleComptable = { compte: ACHATS, immobilisation: false }
const piece = (id: string, ttc: number): Piece => ({
  id, dossier_id: D, nom_fichier: `${id}.pdf`, statut: 'validee', type_piece: 'achat', date_piece: '2026-03-10',
  montant_ht: null, montant_tva: Math.round(ttc / 6 * 100) / 100, montant_ttc: ttc, tiers: null, categorie_id: 'c1',
  created_at: '2026-03-10T09:00:00Z',
} as Piece)
const ligne = (o: Partial<LignePayante> & Pick<LignePayante, 'id' | 'montant'>): LignePayante => ({
  piece_id: null, date: '2026-03-20', statut: 'rapprochee', reglement_groupe: false, encaissements_de_factures: false, ...o,
})

// p1 payée par m1 (le principal), p2 par m2 (le second) ; p3 et p4 par les parts de m3, un virement groupé du second.
const PIECES = [piece('p1', 120), piece('p2', 60), piece('p3', 30), piece('p4', 90)]
const LIGNES: LignePayante[] = [
  ligne({ id: 'm1', montant: -120, piece_id: 'p1', compte_bancaire_id: 'P' }),
  ligne({ id: 'm2', montant: -60, piece_id: 'p2', compte_bancaire_id: 'S', date: '2026-03-21' }),
  ligne({ id: 'm3', montant: -120, reglement_groupe: true, compte_bancaire_id: 'S', date: '2026-03-22' }),
]
const PARTS = [{ ligne_bancaire_id: 'm3', piece_id: 'p3', montant: -30 }, { ligne_bancaire_id: 'm3', piece_id: 'p4', montant: -90 }]
const PAIEMENTS = paiementsDesPieces(LIGNES, PARTS, [], [])
const A_COMPTABILISER = PIECES.map((p) => ({ piece: p, ...cible }))

const enBase = (lignes: readonly LigneAGenerer[]): EcritureBrouillon[] => lignes.map((l, i) => ({
  id: `g${i}`, created_at: '2026-03-25T09:00:00Z', ligne_bancaire_id: null, ...l,
} as EcritureBrouillon))
const analyser = (ecritures: EcritureBrouillon[], m: ModeleComptable, banques: BanquesDuDossier) =>
  analyserEcritures(ecritures, A_COMPTABILISER, true, PAIEMENTS, m, null, SANS_EXEMPLAIRE, banques)
const sansRupture = { nbSansContrepartie: 0, piecesSansContrepartie: [], groupesDesequilibres: [], piecesDesynchronisees: [] }

describe('paiementsDesPieces : le compte du mouvement sur chaque paiement par le relevé', () => {
  it('porte le compte bancaire du mouvement pour un rapprochement ET pour la part d’un règlement groupé', () => {
    expect(PAIEMENTS.get('p2')).toEqual([expect.objectContaining({ id: 'm2', origine: 'rapprochement', compte_bancaire_id: 'S' })])
    expect(PAIEMENTS.get('p3')).toEqual([expect.objectContaining({ id: 'm3', origine: 'groupe', compte_bancaire_id: 'S' })])
  })

  it('ne porte rien quand la ligne ne le porte pas (drapeau baissé : la colonne n’est pas lue) — le paiement d’hier', () => {
    const hier = paiementsDesPieces(LIGNES.map(({ compte_bancaire_id: _c, ...l }) => l), PARTS, [], [])
    expect(hier.get('p3')).toEqual([{ id: 'm3', date: '2026-03-22', montant: -30, origine: 'groupe' }])
  })
})

describe.each([['le plan par défaut', PLAN_PAR_DEFAUT], ['un plan décalé', PLAN_DECALE]] as const)('sous %s', (_nom, plan) => {
  const parCompte = banquesDuDossier(LUS, plan)
  for (const mode of ['tresorerie', 'engagement'] as const) {
    const m = modele(plan, mode)
    it(`${mode} : chaque paiement s’écrit au 512 du compte de son mouvement, et rien n’est une rupture`, () => {
      const generation = ecrituresAGenerer(D, A_COMPTABILISER, [], true, PAIEMENTS, m, null, parCompte)
      expect(generation.banquesInconnues).toEqual([])
      expect(generation.lignes.filter((l) => l.piece_id === 'p1' && comptesDeBanqueDuDossier(plan, parCompte).has(l.compte)).map((l) => l.compte)).toEqual([plan.banque])
      for (const id of ['p2', 'p3', 'p4']) {
        expect(generation.lignes.filter((l) => l.piece_id === id && comptesDeBanqueDuDossier(plan, parCompte).has(l.compte)).map((l) => l.compte), id).toEqual(['512200'])
      }
      expect(analyser(enBase(generation.lignes), m, parCompte)).toEqual(sansRupture)
    })

    it(`${mode} : la banque d’hier, au rôle, pour un mouvement du second compte se dit « à régénérer »`, () => {
      const hier = ecrituresAGenerer(D, A_COMPTABILISER, [], true, PAIEMENTS, m, null, banquesDuDossier({ etat: 'sans_objet' }, plan))
      expect(hier.lignes.filter((l) => l.ligne_bancaire_id && l.compte.startsWith('512')).every((l) => l.compte === plan.banque)).toBe(true)
      expect(analyser(enBase(hier.lignes), m, parCompte).piecesDesynchronisees.map((p) => p.id)).toEqual(['p2', 'p3', 'p4'])
    })

    it(`${mode} : drapeau baissé, le jugement d’hier sur l’écriture d’hier`, () => {
      const role = banquesDuDossier({ etat: 'sans_objet' }, plan)
      const hier = ecrituresAGenerer(D, A_COMPTABILISER, [], true, PAIEMENTS, m, null, role)
      expect(analyser(enBase(hier.lignes), m, role)).toEqual(sansRupture)
    })
  }
})

describe('une banque qui ne se sait pas retient la pièce', () => {
  const m = modele(PLAN_PAR_DEFAUT, 'tresorerie')
  for (const [quoi, banques] of [
    ['des comptes en cours de lecture', banquesDuDossier({ etat: 'en_cours' }, PLAN_PAR_DEFAUT)],
    ['des comptes illisibles', banquesDuDossier({ etat: 'illisible', motif: 'lecture refusée' }, PLAN_PAR_DEFAUT)],
    ['une lecture qui ne rend pas le second compte', banquesDuDossier({ etat: 'lus', comptes: [PRINCIPAL, compte({ id: 'X', compte: '512300', compte_propre_depuis: '2026-01-01' })] }, PLAN_PAR_DEFAUT)],
  ] as const) {
    it(`${quoi} : rien ne s’écrit d’elle, la génération la nomme, et l’analyse ne la juge pas`, () => {
      expect(refusDesBanquesDesPaiements(PAIEMENTS.get('p2')!, banques)).not.toBeNull()
      expect(lignesPourPiece(D, PIECES[1], cible, true, PAIEMENTS.get('p2')!, m, banques)).toEqual([])
      const generation = ecrituresAGenerer(D, A_COMPTABILISER, [], true, PAIEMENTS, m, null, banques)
      expect(generation.banquesInconnues.map((x) => x.piece.id)).toEqual(
        quoi === 'une lecture qui ne rend pas le second compte' ? ['p2', 'p3', 'p4'] : ['p1', 'p2', 'p3', 'p4'])
      // Un brouillon d'hier (au rôle partout) n'y est pas dit « à régénérer » : sa banque ne se sait pas.
      const hier = ecrituresAGenerer(D, A_COMPTABILISER, [], true, PAIEMENTS, m, null, banquesDuDossier({ etat: 'sans_objet' }, PLAN_PAR_DEFAUT))
      expect(analyser(enBase(hier.lignes), m, banques).piecesDesynchronisees).toEqual([])
    })
  }

  it('un paiement par la caisse n’a pas de banque : il ne retient rien', () => {
    const caisse = paiementsDesPieces([], [], [], [{ operation_caisse_id: 'oc1', piece_id: 'p1', date: '2026-03-10', montant: -10 }])
    expect(refusDesBanquesDesPaiements(caisse.get('p1')!, banquesDuDossier({ etat: 'en_cours' }, PLAN_PAR_DEFAUT))).toBeNull()
  })
})

describe('comptesDeBanqueDuDossier', () => {
  it('le rôle seul drapeau baissé ou sans comptes lus ; le rôle et chaque 512 propre sinon', () => {
    expect([...comptesDeBanqueDuDossier(PLAN_PAR_DEFAUT, banquesDuDossier({ etat: 'sans_objet' }, PLAN_PAR_DEFAUT))]).toEqual([PLAN_PAR_DEFAUT.banque])
    expect([...comptesDeBanqueDuDossier(PLAN_PAR_DEFAUT, banquesDuDossier({ etat: 'en_cours' }, PLAN_PAR_DEFAUT))]).toEqual([PLAN_PAR_DEFAUT.banque])
    expect([...comptesDeBanqueDuDossier(PLAN_DECALE, banquesDuDossier(LUS, PLAN_DECALE))].sort()).toEqual([PLAN_DECALE.banque, '512200'].sort())
  })
})
