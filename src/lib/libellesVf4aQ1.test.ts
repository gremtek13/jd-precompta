import { describe, expect, it } from 'vitest'
import { LIBELLES_COMPTES, libelleCompteTenu } from './comptes'
import { libelleDuCompteDeBilan } from './compteDeBilan'
import { calculerBalance } from './ecritures'
import { genererFec, libelleCompte, numerotationValidee } from './fec'
import { titreDeLaLigne } from './revueAnalytiqueEcran'
import type { ANouveau, Categorie, EcritureBrouillon, Piece } from './types'
import { A_NOUVEAU_NON_VALIDE, NON_VALIDEE } from '../test/ecritures'
import { SANS_ECRITURE_DE_VENTE } from '../test/ventesFacturees'
import { OPERATIONS_DE_CAISSE_ABSENTES } from './controlesDeLaCaisse'

// LE 706000 ET LE 627000 PRENNENT LE NOM DU PLAN COMPTABLE GÉNÉRAL, POUR TOUT DOSSIER (décision du cabinet du 20/10/2026,
// VF4A-Q1 ; chantier EC-Q3, étape VF4c2 ; lib/comptes.ts). Ce sont les comptes par défaut de deux rôles de la vente
// facturée ET ceux de deux catégories communes, « Ventes / prestations » et « Frais bancaires » (`SUGGESTIONS_COMPTE_PAR_CODE`,
// lib/ecritures.ts) : dans la balance, le FEC et la revue analytique, leurs lignes portent désormais l'intitulé de la
// nomenclature — « prestations de services » (706) et « services bancaires et assimilés » (627), règlement ANC n° 2014-03
// consolidé au 1er janvier 2026, cité par la conception d'EC-Q3 (HISTORIQUE.md, § 3). LES QUATRE AUTRES COMPTES DE LA
// VENTE FACTURÉE les rejoignent à l'étape VF4c3 (VF4C2-Q1) : « ventes de marchandises » (707), « taxes sur le chiffre
// d'affaires à régulariser ou en attente » (4458), « valeurs à l'encaissement » (511), « caisse » (53). RIEN D'AUTRE NE
// CHANGE DE NOM : une autre catégorie, et le libellé qu'une écriture validée a figé. Données FICTIVES.

const categorie = (o: Partial<Categorie> & Pick<Categorie, 'id' | 'libelle' | 'compte_comptable'>): Categorie => ({
  dossier_id: null, code: o.id, ordre: 1, poste_2035: null, ...o,
} as Categorie)

// Les deux catégories communes, sous le nom qu'elles portent en base (relu le 19/10/2026, comptesEnDur.test.ts), une
// catégorie propre au dossier sur le même 706000, et deux témoins qui ne doivent pas bouger.
const CATEGORIES: Categorie[] = [
  categorie({ id: 'ventes_prestations', libelle: 'Ventes / prestations', compte_comptable: '706000' }),
  categorie({ id: 'frais_bancaires', libelle: 'Frais bancaires', compte_comptable: '627000' }),
  categorie({ id: 'fournitures', libelle: 'Fournitures de bureau', compte_comptable: '606400' }),
  categorie({ id: 'honoraires_retrocedes', libelle: 'Honoraires rétrocédés', compte_comptable: '622600' }),
]

let n = 0
const ligne = (compte: string, sens: 'debit' | 'credit', montant: number, o: Partial<EcritureBrouillon> = {}): EcritureBrouillon => ({
  id: `e${++n}`, dossier_id: 'd1', piece_id: 'p1', ligne_bancaire_id: null, date: '2026-03-10', compte, libelle: 'Ligne fictive',
  montant, sens, statut: 'proposee', created_at: '2026-03-10T09:00:00Z', immobilisation_id: null, vehicule_id: null,
  declaration_tva_id: null, cotisation_id: null, encaissement_id: null, facture_id: null, ...NON_VALIDEE, ...o,
})

const piece: Piece = {
  id: 'p1', dossier_id: 'd1', nom_fichier: 'piece-fictive.pdf', statut: 'validee', type_piece: 'achat', date_piece: '2026-03-10',
  montant_ttc: 100, tiers: null,
} as Piece

// Un brouillon qui touche les six comptes de la vente facturée et les deux témoins.
const BROUILLON = [
  ligne('706000', 'credit', 100), ligne('627000', 'debit', 4), ligne('606400', 'debit', 30), ligne('622600', 'debit', 20),
  ligne('707000', 'credit', 10), ligne('445800', 'credit', 2), ligne('511000', 'debit', 50), ligne('530000', 'debit', 38),
]

describe('VF4A-Q1 — le 706000 et le 627000 portent le nom du plan comptable général', () => {
  it('dans la table des comptes que l’application tient', () => {
    expect(libelleCompteTenu('706000')).toBe('Prestations de services')
    expect(libelleCompteTenu('627000')).toBe('Services bancaires et assimilés')
  })

  it('dans la balance des comptes, avant le nom de la catégorie — et rien d’autre ne change de nom', () => {
    expect(calculerBalance(BROUILLON, CATEGORIES, []).map((l) => [l.compte, l.libelle])).toEqual([
      ['445800', "Taxes sur le chiffre d'affaires à régulariser ou en attente"],
      ['511000', "Valeurs à l'encaissement"],
      ['530000', 'Caisse'],
      ['606400', 'Fournitures de bureau'],
      ['622600', 'Honoraires rétrocédés'],
      ['627000', 'Services bancaires et assimilés'],
      ['706000', 'Prestations de services'],
      ['707000', 'Ventes de marchandises'],
    ])
  })

  it('dans le FEC, un même CompteNum sous un seul CompteLib — et rien d’autre ne change de nom', () => {
    expect(libelleCompte('706000', CATEGORIES)).toBe('Prestations de services')
    expect(libelleCompte('627000', CATEGORIES)).toBe('Services bancaires et assimilés')
    const parCompte = new Map(genererFec(BROUILLON, [piece], CATEGORIES, [], 'tresorerie', [], new Map(), SANS_ECRITURE_DE_VENTE, OPERATIONS_DE_CAISSE_ABSENTES)
      .split('\r\n').slice(1).map((r) => r.split('\t')).map((r) => [r[4], r[5]] as const))
    expect(Object.fromEntries(parCompte)).toEqual({
      '445800': "Taxes sur le chiffre d'affaires à régulariser ou en attente",
      '511000': "Valeurs à l'encaissement",
      '530000': 'Caisse',
      '606400': 'Fournitures de bureau',
      '622600': 'Honoraires rétrocédés',
      '627000': 'Services bancaires et assimilés',
      '706000': 'Prestations de services',
      '707000': 'Ventes de marchandises',
    })
  })

  it('dans la revue analytique', () => {
    expect(titreDeLaLigne({ objet_type: 'compte', objet: '706000', nature: null })).toBe('Compte 706000 — Prestations de services')
    expect(titreDeLaLigne({ objet_type: 'compte', objet: '627000', nature: null })).toBe('Compte 627000 — Services bancaires et assimilés')
    // Un compte de charges qu'aucune table ne nomme reste nommé par son numéro, comme hier.
    expect(titreDeLaLigne({ objet_type: 'compte', objet: '606400', nature: null })).toBe('Compte 606400')
  })

  it('jamais dans le FEC d’un exercice validé : le libellé figé avec l’écriture reste le sien', () => {
    const validee = ligne('706000', 'credit', 100, {
      statut: 'validee', valide_le: '2027-01-15T10:00:00Z', journal_code: 'VE', numero_ecriture: 1, piece_ref: 'piece-fictive.pdf',
      piece_date: '2026-03-10', compte_lib: 'Ventes / prestations',
    })
    expect(numerotationValidee([validee], [], '2027-01-15T10:00:00Z').lignes[0].compteLib).toBe('Ventes / prestations')
  })
})

describe('VF4C2-Q1 — le 707000, le 445800, le 511000 et le 530000 portent aussi le nom du plan comptable général', () => {
  const QUATRE: readonly (readonly [string, string])[] = [
    ['707000', 'Ventes de marchandises'],
    ['445800', "Taxes sur le chiffre d'affaires à régulariser ou en attente"],
    ['511000', "Valeurs à l'encaissement"],
    ['530000', 'Caisse'],
  ]

  it('dans la table des comptes que l’application tient, et sur un compte de bilan choisi', () => {
    for (const [compte, libelle] of QUATRE) {
      expect(libelleCompteTenu(compte), compte).toBe(libelle)
      expect(libelleDuCompteDeBilan(compte), compte).toBe(libelle)
    }
  })

  it('avant le nom d’une catégorie qui porte le même compte, dans la balance et dans le FEC', () => {
    const avecUneCategorie = [...CATEGORIES, categorie({ id: 'ventes_produits', libelle: 'Ventes de produits', compte_comptable: '707000' })]
    expect(calculerBalance(BROUILLON, avecUneCategorie, []).find((l) => l.compte === '707000')?.libelle).toBe('Ventes de marchandises')
    expect(libelleCompte('707000', avecUneCategorie)).toBe('Ventes de marchandises')
  })

  it('avant le nom qu’une balance reprise leur donnait, dans le FEC de l’exercice qu’elle ouvre', () => {
    const aNouveau = (o: Pick<ANouveau, 'id' | 'compte' | 'libelle' | 'sens'>): ANouveau => ({
      dossier_id: 'd1', date: '2026-01-01', compte_origine: o.compte, montant: 50, source_nom: 'balance-fictive.csv',
      source_empreinte: 'e'.repeat(64), created_at: '2026-01-02T09:00:00Z', ...A_NOUVEAU_NON_VALIDE, ...o,
    })
    const reprise = [
      aNouveau({ id: 'an1', compte: '511000', libelle: 'Chèques à encaisser', sens: 'debit' }),
      aNouveau({ id: 'an2', compte: '101000', libelle: 'Capital individuel', sens: 'credit' }),
    ]
    const lignes = genererFec([], [], CATEGORIES, reprise, 'tresorerie', [], new Map(), SANS_ECRITURE_DE_VENTE, OPERATIONS_DE_CAISSE_ABSENTES)
      .split('\r\n').slice(1).map((r) => r.split('\t'))
    expect(lignes.find((r) => r[4] === '511000')?.[5]).toBe("Valeurs à l'encaissement")
    // Un compte que l'application ne nomme pas garde le nom de la reprise, comme hier.
    expect(lignes.find((r) => r[4] === '101000')?.[5]).toBe('Capital individuel')
  })

  it('dans la revue analytique', () => {
    for (const [compte, libelle] of QUATRE) {
      expect(titreDeLaLigne({ objet_type: 'compte', objet: compte, nature: null })).toBe(`Compte ${compte} — ${libelle}`)
    }
  })

  it('et rien d’autre : des comptes voisins restent hors de la table, les témoins gardent leur nom', () => {
    expect(LIBELLES_COMPTES['512000']).toBe('Banque')
    expect(LIBELLES_COMPTES['445710']).toBe('TVA collectée')
    for (const voisin of ['701000', '706100', '707100', '445801', '511100', '531000', '606400']) {
      expect(libelleCompteTenu(voisin), voisin).toBeNull()
    }
  })
})
