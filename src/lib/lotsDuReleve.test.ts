import { describe, expect, it } from 'vitest'
import { lotDesCertains, planRapprochementAutomatique, type Appariement } from './appariementBanque'
import { REFUS_GARDE_MOUVEMENTS, type FactureDuDossier } from './encaissementsFactures'
import { formatMoney } from './format'
import {
  AUCUN_HORS_DES_LOTS, comptesDuReleve, ecartDuLot, mouvementsHorsDesLots, retenueDuReleve, texteDesNonRapproches, ventesDuReleve,
  type EncaissementDuMouvementLu, type VentesDuReleve,
} from './mouvementsDesVentes'
import { mouvementATraiter, mouvementsCouverts, planAffectationParRegles } from './reglesAffectation'
import { ignoresParLaRegle, statutPourLibelle } from './reglesIgnorees'
import type { Categorie, LigneBancaire, Piece, RegleAffectationBancaire } from './types'

// LES LOTS DU RELEVÉ ÉCARTENT LES MOUVEMENTS DES VENTES FACTURÉES (ligne 28.65, chantier EC-Q3, étape VF5a2). Les mouvements
// qu'aucun lot ne prend se tirent ici de la VRAIE lecture du module (`ventesDuReleve`, `mouvementsHorsDesLots`), qui lit la
// garde G2 : un mouvement réservé à l'encaissement d'une facture source, un mouvement classé par ses encaissements. Puis
// chaque plan — le rapprochement automatique, « Valider et rapprocher », l'affectation par les règles, la règle
// d'ignorance — les reçoit, et aucun n'en prend un ; chacun dit ceux qu'il a écartés, et seulement ceux qu'il aurait pris.
// Données FICTIVES.

const D = 'd-bascule'

function ligne(o: Partial<LigneBancaire> & Pick<LigneBancaire, 'id'>): LigneBancaire {
  return {
    dossier_id: D, date: '2026-03-12', libelle: 'PRLV SEPA TRANSMEDICAL ECH/150325', montant: -38.4,
    statut: 'non_rapprochee', piece_id: null, cotisation_id: null, categorie_id: null, taux_tva: null, prelevement_personnel: false,
    emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false, reglement_groupe: false,
    compte_bilan: null, declaration_tva_id: null, id_externe: null, source_fichier: 'releve-2026.csv', libelle_brut: null,
    created_at: '2026-04-01T10:00:00Z', encaissements_de_factures: false, ...o,
  }
}

function piece(o: Partial<Piece> & Pick<Piece, 'id'>): Piece {
  return {
    dossier_id: D, uploaded_by: null, source: 'upload', storage_path: `${D}/p.pdf`, nom_fichier: 'facture.pdf', storage_hash: null,
    date_piece: '2026-03-10', tiers: 'Client fictif', montant_ht: 600, montant_tva: 0, montant_ttc: 600, devise: 'EUR',
    montant_devise: null, taux_change: null, conversion_source: null, categorie_id: null, sous_dossier_id: null, type_piece: 'vente',
    statut: 'validee', notes: null, confiance: null, superpdp_invoice_id: null, flux_hote: null, flux_id: null, lisible_path: null,
    identite_numero: null, identite_siren_vendeur: null, identite_date: null, identite_nature: null, facture_id: null,
    created_at: '2026-03-10T09:00:00Z', updated_at: '2026-03-10T09:00:00Z', ...o,
  }
}

const facture = (id: string, numero: string): FactureDuDossier => ({
  id, dossier_id: D, numero, type: 'facture', statut: 'validee', facture_origine_id: null, source_de_la_vente: true,
})

const encaissement = (
  o: Partial<EncaissementDuMouvementLu> & Pick<EncaissementDuMouvementLu, 'id' | 'facture_id' | 'montant'>,
): EncaissementDuMouvementLu => ({
  dossier_id: D, date_encaissement: '2026-03-10', moyen: 'virement', ligne_bancaire_id: null, annule_id: null,
  cree_le: '2026-03-10T10:00:00Z', retire_le: null, cree_par: 'u-cabinet', ...o,
})

// Un virement RÉSERVÉ à l'encaissement de F2026-0014 ; un virement CLASSÉ par celui de F2026-0015 ; un virement LIBRE, du
// même libellé et du même montant que le réservé ; des frais de tenue de compte, libres.
const RESERVE = ligne({ id: 'm-res', date: '2026-03-12', montant: 600, libelle: 'VIR SARL HORIZON F2026-0014' })
const CLASSE = ligne({
  id: 'm-cls', date: '2026-03-13', montant: 478.5, libelle: 'VIR SARL HORIZON F2026-0015', statut: 'rapprochee',
  encaissements_de_factures: true,
})
const LIBRE = ligne({ id: 'm-libre', date: '2026-03-20', montant: 600, libelle: 'VIR SARL HORIZON SOLDE' })
const FRAIS = ligne({ id: 'm-frais', date: '2026-03-31', montant: -8.5, libelle: 'FRAIS TENUE DE COMPTE' })
const RELEVE = [RESERVE, CLASSE, LIBRE, FRAIS]

const LUE: VentesDuReleve = ventesDuReleve(true, D, {
  dossierId: D,
  etat: 'lue',
  sources: {
    dossierId: D,
    factures: [facture('f1', 'F2026-0014'), facture('f2', 'F2026-0015')],
    encaissements: [
      encaissement({ id: 'e1', facture_id: 'f1', montant: 600, ligne_bancaire_id: 'm-res' }),
      encaissement({ id: 'e2', facture_id: 'f2', montant: 480, ligne_bancaire_id: 'm-cls' }),
    ],
    mouvements: RELEVE,
  },
}, { etat: 'lus', comptes: [] })
const HORS = mouvementsHorsDesLots(LUE)
const MOTS_DU_RESERVE = REFUS_GARDE_MOUVEMENTS[3].modele.replace('%', 'F2026-0014')
const MOTS_DU_CLASSE = REFUS_GARDE_MOUVEMENTS[2].modele

describe('mouvementsHorsDesLots : ceux qu’aucun lot ne prend, et pourquoi', () => {
  it('lue en entier : le réservé et le classé, chacun sous les mots de la garde ; jamais le libre', () => {
    expect([...HORS.entries()]).toEqual([['m-res', MOTS_DU_RESERVE], ['m-cls', MOTS_DU_CLASSE]])
  })

  it('un dossier qui n’a pas basculé : aucun', () => {
    expect(mouvementsHorsDesLots({ etat: 'sans_objet' })).toBe(AUCUN_HORS_DES_LOTS)
    expect(AUCUN_HORS_DES_LOTS.size).toBe(0)
  })

  it('pas encore revenue ou lue en partie : vide — et la retenue, alors, n’est jamais nulle', () => {
    for (const v of [{ etat: 'en_cours' }, { etat: 'incomplete', motif: 'refusée' }] as const) {
      expect(mouvementsHorsDesLots(v).size).toBe(0)
      expect(retenueDuReleve(v)).not.toBeNull()
    }
    // Et la retenue ne tombe que là où la liste est connue.
    expect(retenueDuReleve(LUE)).toBeNull()
    expect(retenueDuReleve({ etat: 'sans_objet' })).toBeNull()
  })
})

describe('ecartDuLot : ce qu’une carte de lot dit', () => {
  it('aucun écarté : rien à dire', () => {
    expect(ecartDuLot([], HORS)).toBeNull()
    // Un mouvement qui n'est pas hors des lots ne se dit jamais écarté par eux.
    expect(ecartDuLot([LIBRE], HORS)).toBeNull()
  })

  it('un : combien, au singulier, et la raison de la garde', () => {
    expect(ecartDuLot([RESERVE], HORS)).toEqual({
      resume: '1 mouvement écarté : il porte des encaissements de factures.',
      mouvements: [{ ligne: RESERVE, raison: MOTS_DU_RESERVE }],
    })
  })

  it('plusieurs : au pluriel, chacun sous ses mots, dans l’ordre du plan', () => {
    const ecart = ecartDuLot([CLASSE, LIBRE, RESERVE], HORS)
    expect(ecart?.resume).toBe('2 mouvements écartés : ils portent des encaissements de factures.')
    expect(ecart?.mouvements.map((e) => [e.ligne.id, e.raison])).toEqual([['m-cls', MOTS_DU_CLASSE], ['m-res', MOTS_DU_RESERVE]])
  })
})

describe('mouvementATraiter et mouvementsCouverts : un mouvement réservé n’est jamais à traiter', () => {
  it('le réservé, que tout le reste ferait « à traiter », ne l’est pas ; le libre l’est', () => {
    expect(mouvementATraiter(RESERVE, AUCUN_HORS_DES_LOTS)).toBe(true)
    expect(mouvementATraiter(RESERVE, HORS)).toBe(false)
    expect(mouvementATraiter(LIBRE, HORS)).toBe(true)
  })

  it('une règle nouvelle ne couvre pas le réservé : le compte de la fiche le tait', () => {
    expect(mouvementsCouverts('horizon', 'encaissement', RELEVE, AUCUN_HORS_DES_LOTS).map((l) => l.id)).toEqual(['m-res', 'm-libre'])
    expect(mouvementsCouverts('horizon', 'encaissement', RELEVE, HORS).map((l) => l.id)).toEqual(['m-libre'])
  })
})

describe('planAffectationParRegles : le lot des règles', () => {
  const RECETTES: Categorie = {
    id: 'cat-recettes', dossier_id: null, code: 'ventes_prestations', libelle: 'Ventes / prestations', ordre: 80,
    compte_comptable: '706000', poste_2035: 'Recettes',
  }
  const FRAIS_BANCAIRES: Categorie = { ...RECETTES, id: 'cat-frais', code: 'frais_bancaires', libelle: 'Frais bancaires', compte_comptable: '627000', poste_2035: 'Frais financiers' }
  const regle = (o: Partial<RegleAffectationBancaire>): RegleAffectationBancaire => ({
    id: 'r1', dossier_id: D, motif: 'horizon', sens: 'encaissement', categorie_id: 'cat-recettes', taux_tva: null,
    created_at: '2026-01-01T00:00:00Z', ...o,
  })
  const REGLES = [regle({}), regle({ id: 'r2', motif: 'frais tenue', sens: 'decaissement', categorie_id: 'cat-frais' })]
  const plan = (hors = HORS, lignes = RELEVE, regles = REGLES) =>
    planAffectationParRegles(lignes, regles, [RECETTES, FRAIS_BANCAIRES], false, () => null, hors)

  it('le réservé, qu’une règle désigne, n’est ni proposé, ni à rapprocher, ni refusé, ni en conflit : écarté, et dit', () => {
    const p = plan()
    expect(p.propositions.map((x) => x.ligne.id)).toEqual(['m-libre', 'm-frais'])
    expect([p.aRapprocher, p.refus, p.conflits]).toEqual([[], [], []])
    expect(p.ecartesParLesVentes.map((l) => l.id)).toEqual(['m-res'])
  })

  it('sans les ventes facturées, le même relevé le proposait : c’est bien elles qui l’écartent', () => {
    const p = plan(AUCUN_HORS_DES_LOTS)
    expect(p.propositions.map((x) => x.ligne.id)).toEqual(['m-res', 'm-libre', 'm-frais'])
    expect(p.ecartesParLesVentes).toEqual([])
  })

  it('n’est dit écarté que ce que le lot aurait pris : ni le classé (déjà rapproché), ni un réservé qu’aucune règle ne désigne', () => {
    expect(plan(HORS, RELEVE, [REGLES[1]]).ecartesParLesVentes).toEqual([])
    // Un réservé que tout le reste écarterait déjà (zéro euro) ne se dit pas écarté par ses encaissements.
    const zero = ligne({ id: 'm-res', montant: 0, libelle: 'VIR SARL HORIZON' })
    expect(plan(HORS, [zero], REGLES).ecartesParLesVentes).toEqual([])
    // Un réservé en conflit de règles se dit écarté, lui aussi : le lot ne le prendrait pas, et le conflit ne compte pas.
    const conflit = [...REGLES, regle({ id: 'r3', motif: 'sarl', categorie_id: 'cat-frais' })]
    const p = plan(HORS, RELEVE, conflit)
    expect(p.ecartesParLesVentes.map((l) => l.id)).toEqual(['m-res'])
    expect(p.conflits.map((c) => c.ligne.id)).toEqual(['m-libre'])
  })
})

describe('planRapprochementAutomatique : le rapprochement automatique', () => {
  const vide = { pieces: new Set<string>(), cotisations: new Set<string>() }

  it('le réservé n’est jamais retenu, même avec une seule pièce possible ; il se compte à part, jamais parmi les ambigus', () => {
    const p = planRapprochementAutomatique([RESERVE], [piece({ id: 'p1', date_piece: '2026-03-10' })], [], vide, HORS)
    expect(p).toEqual({ retenus: [], ecartesPourAmbiguite: 0, ecartesParLesVentes: [RESERVE] })
    // Sans les ventes facturées, le même plan le rapprochait.
    expect(planRapprochementAutomatique([RESERVE], [piece({ id: 'p1', date_piece: '2026-03-10' })], [], vide, AUCUN_HORS_DES_LOTS).retenus)
      .toEqual([{ ligneId: 'm-res', pieceId: 'p1' }])
  })

  it('un réservé sans candidate ne se dit pas écarté', () => {
    expect(planRapprochementAutomatique([RESERVE], [], [], vide, HORS).ecartesParLesVentes).toEqual([])
  })

  it('il reste un CONCURRENT : une pièce qu’il pourrait payer aussi n’est pas rapprochée seule du mouvement libre', () => {
    const p = planRapprochementAutomatique(
      [RESERVE, ligne({ ...LIBRE, date: '2026-03-13' })], [piece({ id: 'p1', date_piece: '2026-03-12' })], [], vide, HORS)
    expect(p.retenus).toEqual([])
    expect(p.ecartesPourAmbiguite).toBe(1)
    expect(p.ecartesParLesVentes.map((l) => l.id)).toEqual(['m-res'])
  })
})

describe('lotDesCertains : « Valider et rapprocher »', () => {
  const paire = (l: LigneBancaire, id: string): Appariement => ({ piece: piece({ id, statut: 'a_valider' }), ligne: l, ecartJours: 2 })

  it('la paire du réservé ne part pas ; celle du libre, si ; chacune dans l’ordre reçu', () => {
    const lot = lotDesCertains([paire(LIBRE, 'p2'), paire(RESERVE, 'p1'), paire(FRAIS, 'p3')], HORS)
    expect(lot.aEcrire.map((a) => a.piece.id)).toEqual(['p2', 'p3'])
    expect(lot.ecartesParLesVentes.map((a) => a.ligne.id)).toEqual(['m-res'])
    expect(lotDesCertains([paire(RESERVE, 'p1')], AUCUN_HORS_DES_LOTS).aEcrire.map((a) => a.piece.id)).toEqual(['p1'])
  })
})

describe('ignoresParLaRegle : la règle « toujours ignorer », sur les mouvements déjà importés', () => {
  it('ne fait pas ignorer le réservé qu’elle reconnaît : écarté, et dit ; le libre, si', () => {
    expect(ignoresParLaRegle(RELEVE, 'horizon', HORS)).toEqual({ aIgnorer: [LIBRE], ecartesParLesVentes: [RESERVE] })
    expect(ignoresParLaRegle(RELEVE, 'horizon', AUCUN_HORS_DES_LOTS)).toEqual({ aIgnorer: [RESERVE, LIBRE], ecartesParLesVentes: [] })
  })

  it('le jugement de l’import, et rien d’autre : à traiter, et le libellé qui contient le motif', () => {
    expect(ignoresParLaRegle(RELEVE, 'frais tenue', HORS)).toEqual({ aIgnorer: [FRAIS], ecartesParLesVentes: [] })
    expect(ignoresParLaRegle([ligne({ id: 'x', libelle: 'VIR SARL HORIZON', statut: 'ignoree' })], 'horizon', HORS).aIgnorer).toEqual([])
    for (const l of RELEVE) {
      const pris = ignoresParLaRegle([l], 'horizon', AUCUN_HORS_DES_LOTS).aIgnorer.length === 1
      expect(pris, l.id).toBe(l.statut === 'non_rapprochee' && statutPourLibelle(l.libelle, [{ motif: 'horizon' }]) === 'ignoree')
    }
  })
})

describe('comptesDuReleve et texteDesNonRapproches : le réservé se compte à part', () => {
  const NON_RAPPROCHEES = RELEVE.filter((l) => l.statut === 'non_rapprochee')

  it('un dossier qui n’a pas basculé : la phrase d’hier, au mot près', () => {
    const c = comptesDuReleve(NON_RAPPROCHEES, { etat: 'sans_objet' })
    expect(c).toEqual({ etat: 'connus', aRapprocher: { nombre: 3, total: 1191.5 }, reserves: { nombre: 0, total: 0 } })
    // Ce que l'écran écrivait, tel quel : `{n} mouvement(s) bancaire(s) non rapproché(s) ({formatMoney(total)})`.
    expect(texteDesNonRapproches(c)).toBe(`3 mouvement(s) bancaire(s) non rapproché(s) (${formatMoney(1191.5)})`)
  })

  it('lues en entier : le réservé ne se fait pas passer pour un mouvement à rapprocher, et ne disparaît pas', () => {
    const c = comptesDuReleve(NON_RAPPROCHEES, LUE)
    expect(c).toEqual({ etat: 'connus', aRapprocher: { nombre: 2, total: 591.5 }, reserves: { nombre: 1, total: 600 } })
    expect(texteDesNonRapproches(c).replace(/\s/g, ' ')).toBe(
      '2 mouvement(s) bancaire(s) non rapproché(s) (591,50 €) · 1 mouvement(s) réservé(s) à des encaissements de factures, à '
      + 'classer par eux (600,00 €)',
    )
  })

  it('pas encore revenues ou lues en partie : le compte d’hier, et ce qu’on ne sait pas', () => {
    for (const v of [{ etat: 'en_cours' }, { etat: 'incomplete', motif: 'refusée' }] as const) {
      const c = comptesDuReleve(NON_RAPPROCHEES, v)
      expect(c).toEqual({ etat: 'incertains', nonRapproches: { nombre: 3, total: 1191.5 } })
      expect(texteDesNonRapproches(c).replace(/\s/g, ' ')).toBe(
        '3 mouvement(s) bancaire(s) non rapproché(s) (1 191,50 €), dont peut-être des mouvements réservés à des encaissements '
        + 'de factures : les ventes facturées du dossier ne sont pas lues en entier',
      )
    }
  })
})
