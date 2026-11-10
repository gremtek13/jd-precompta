import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccesDuDossier } from './auteursVentes'
import {
  REFUS_REPRISE_NON_LUE_ECRITURE, refusEcritureVenteFacturee, type ContexteEcritureVente, type MouvementPourEcriture,
} from './ecritureVenteFacturee'
import {
  LIBELLE_MOTIF_NON_ECRITE, ecrituresDesVentesFacturees, type EcritureVenteFacturee, type EntreesEcrituresVentes,
  type FactureDesVentesEcrites, type MouvementDesEncaissements,
} from './ecrituresVentesFacturees'
import type { LigneDeFacture } from './encaissementsFactures'
import { motDuDocument } from './facturesReprises'
import { carteDeVente, mouvementDeVente, type EncaissementDuMouvementLu } from './mouvementsDesVentes'
import { PLAN_PAR_DEFAUT } from './planComptable'
import { definitionApresLesPreparees, MIGRATIONS_DES_FACTURES_REPRISES } from '../test/schema'
import { LIBELLE_MOTIF_VENTE, MOTIFS_DU_MODULE_SEUL, type EncaissementVendu, type MotifVenteEcartee, type PartVendue, type RepriseVendue } from './ventesFacturees'
import { nomDuDocument } from './ventesFactureesDesExports'
import type { ModeComptable } from './types'

// LES ÉCRITURES, LE FEC ET LES MOUVEMENTS D'UNE FACTURE REPRISE (étape A8c2, ligne 51.5 ; la base depuis la migration
// `factures_reprises_encaissements`, A8b, préparée). Le drapeau `FACTURES_IMPORTEES_PREVUES` est joué dans ses deux états par
// un accesseur : baissé, chaque module rend ce qu'il rendait — une reprise ne s'écrit nulle part et se nomme « facture » ;
// levé, ses encaissements s'écrivent comme ceux d'une facture source, sur la règle du cumul de `calcul_vente_facturee`, sans
// document ni exigibilité de livraison ou de débits, et la pièce la cite « facture reprise ». Données FICTIVES.

const drapeau = vi.hoisted(() => ({ leve: false }))
vi.mock('./facturesImportees', () => ({ get FACTURES_IMPORTEES_PREVUES() { return drapeau.leve } }))

beforeEach(() => {
  drapeau.leve = false
})

const D = 'd1'
const P = PLAN_PAR_DEFAUT

const facture = (o: Partial<FactureDesVentesEcrites> & { statut?: string } = {}): FactureDesVentesEcrites => ({
  id: 'r1', dossier_id: D, statut: 'importee', type: 'facture', numero: 'FA-2026-118', date_emission: '2026-11-20',
  tiers_nom: 'Client fictif', tiers_siret: null, facture_origine_id: null, source_de_la_vente: true, nature_operation: 'services',
  option_debits: false, date_prestation: null, ...o,
} as FactureDesVentesEcrites)

// Comme ventesFactureesDesReprises.test.ts : trois lignes de 10,01 € à 20 % déclarées par taux (36,04 € TTC), un avoir
// repris de −6,01 € d'avant la reprise, 10 € encaissés avant elle ; le paiement qui solde (20,03 €) porte 3,34 € de TVA.
const LIGNES: LigneDeFacture[] = [
  ...[1, 2, 3].map((ordre) => ({ facture_id: 'r1', ordre, designation: 'Séance', quantite: 1, prix_unitaire_ht: 10.01, taux_tva: 20 })),
  ...[1, 2, 3].map((ordre) => ({ facture_id: 'ar1', ordre, designation: 'Geste', quantite: -1, prix_unitaire_ht: 1.67, taux_tva: 20 })),
  { facture_id: 'f1', ordre: 1, designation: 'Séance', quantite: 1, prix_unitaire_ht: 100, taux_tva: 20 },
]
const AVOIR_REPRIS = facture({ id: 'ar1', type: 'avoir', numero: 'AV-2026-7', date_emission: '2026-12-01' })
const FACTURE_DE_L_APPLICATION = facture({ id: 'f1', statut: 'validee', numero: 'F2027-0001', date_emission: '2027-01-10' })
const REPRISES: RepriseVendue[] = [
  { facture_id: 'r1', dossier_id: D, origine_id: null, encaisse_par_taux: [{ taux: 20, encaisse: 10 }], montant_tva: 6.01 },
  { facture_id: 'ar1', dossier_id: D, origine_id: 'r1', encaisse_par_taux: [], montant_tva: -1 },
]

const encaissement = (o: Partial<EncaissementVendu> = {}): EncaissementVendu => ({
  id: 'e1', dossier_id: D, facture_id: 'r1', date_encaissement: '2027-02-10', montant: 20.03, moyen: 'virement',
  ligne_bancaire_id: 'm1', annule_id: null, cree_le: '2027-02-10T10:00:00Z', retire_le: null, ...o,
})
const PARTS: PartVendue[] = [{ encaissement_id: 'e1', dossier_id: D, taux: 20, montant: 20.03 }]
// Le crédit qui porte l'encaissement, deux jours après lui : l'encaissement passe au 511, que le mouvement solde.
const MOUVEMENT: MouvementDesEncaissements = {
  id: 'm1', dossier_id: D, date: '2027-02-12', montant: 20.03, libelle: 'VIR SEPA RECU DE MME FICTIVE', source_fichier: null,
  encaissements_de_factures: true,
}

function entrees(o: { mode?: ModeComptable; factures?: FactureDesVentesEcrites[]; reprises?: RepriseVendue[] | undefined } = {}): EntreesEcrituresVentes {
  return {
    sources: {
      dossierId: D, factures: o.factures ?? [facture(), AVOIR_REPRIS], lignes: LIGNES, encaissements: [encaissement()], parts: PARTS,
      reprises: 'reprises' in o ? o.reprises : REPRISES,
    },
    mouvements: [MOUVEMENT], comptesDeContrepartie: new Map(), exemplaires: [], mode: o.mode ?? 'tresorerie', plan: P,
  }
}

const enClair = (e: EcritureVenteFacturee) => ({
  genre: e.source.genre, date: e.date, journal: e.journal, pieceRef: e.pieceRef, pieceDate: e.pieceDate, libelle: e.libelle,
  lignes: e.lignes.map((l) => `${l.compte} ${l.sens} ${l.centimes}${l.ligneBancaireId ? `@${l.ligneBancaireId}` : ''}`),
})

describe('le texte en vigueur après les trois migrations : ce que la composition redit', () => {
  it('`ecriture_attendue_vente_facturee` : une reprise source compte le mouvement comme une facture validée source', () => {
    const sql = definitionApresLesPreparees('ecriture_attendue_vente_facturee', MIGRATIONS_DES_FACTURES_REPRISES)
    expect(sql.match(/f\.statut in \('validee', 'importee'\) and f\.source_de_la_vente/g)).toHaveLength(2)
    // Ses motifs sont ceux de la composition, et aucun n'est celui que le module oppose seul.
    const motifs = new Set([...sql.matchAll(/motif := '(\w+)'/g)].map((m) => m[1]))
    expect([...motifs].filter((m) => !(m in LIBELLE_MOTIF_NON_ECRITE))).toEqual([])
    expect(motifs.size).toBeGreaterThanOrEqual(6)
    expect(sql).not.toContain('reprise_illisible')
  })

  it('`ecritures_attendues_de_la_periode` : la même règle, recomposée d’un bloc — ni document ni exigibilité d’avant', () => {
    const sql = definitionApresLesPreparees('ecritures_attendues_de_la_periode', MIGRATIONS_DES_FACTURES_REPRISES)
    expect(sql).toContain("f.statut = 'importee' as reprise")
    expect(sql).toContain("f.statut in ('validee', 'importee') and f.source_de_la_vente")
    expect(sql).toMatch(/where not x\.reprise/)
  })

  it('`ecrire_vente_facturee`, que les préparées ne touchent pas : les motifs d’une facture écartée, sans ceux du module seul', () => {
    const sql = definitionApresLesPreparees('ecrire_vente_facturee', MIGRATIONS_DES_FACTURES_REPRISES)
    const libelles = Object.fromEntries([...sql.matchAll(/when '(\w+)' then '((?:[^']|'')*)'/g)].map((m) => [m[1], m[2].replace(/''/g, "'")]))
    const deLaBase = Object.fromEntries(Object.entries(LIBELLE_MOTIF_VENTE)
      .filter(([m]) => !MOTIFS_DU_MODULE_SEUL.includes(m as MotifVenteEcartee)))
    expect(libelles).toEqual(deLaBase)
    expect(sql).not.toContain(REFUS_REPRISE_NON_LUE_ECRITURE.modele.slice(0, 40))
  })
})

describe('drapeau baissé : la composition d’hier', () => {
  it('une reprise ne s’écrit pas, ne se dit pas, et la composition est celle du dossier sans elle', () => {
    // En engagement, la facture de l'application a son écriture : la comparaison porte sur quelque chose.
    const avec = ecrituresDesVentesFacturees(entrees({ mode: 'engagement', factures: [facture(), AVOIR_REPRIS, FACTURE_DE_L_APPLICATION] }))
    const sans = ecrituresDesVentesFacturees({
      ...entrees({ mode: 'engagement' }),
      sources: { ...entrees().sources, factures: [FACTURE_DE_L_APPLICATION], encaissements: [], parts: [], reprises: [] },
      mouvements: [],
    })
    expect(avec.ecritures).toEqual(sans.ecritures)
    expect(avec.nonEcrites).toEqual([])
    expect(avec.ecritures.map((e) => e.libelle)).toEqual(['Facture F2027-0001'])
    expect([...avec.ventes.sources]).toEqual(['f1'])
  })

  it('le mot d’un document repris est « facture » ou « avoir », comme hier', () => {
    expect(motDuDocument(facture())).toBe('facture')
    expect(motDuDocument(AVOIR_REPRIS)).toBe('avoir')
    expect(nomDuDocument(facture())).toBe('Facture FA-2026-118')
    expect(nomDuDocument(AVOIR_REPRIS)).toBe('Avoir AV-2026-7')
  })
})

describe('drapeau levé : les écritures d’une reprise, celles que la base recompose', () => {
  beforeEach(() => {
    drapeau.leve = true
  })

  it('en trésorerie, des services : l’encaissement au 511, le produit et la TVA exigible ; le mouvement solde le 511', () => {
    const r = ecrituresDesVentesFacturees(entrees())
    expect(r.nonEcrites).toEqual([])
    expect(r.ecritures.map(enClair)).toEqual([
      {
        genre: 'encaissement', date: '2027-02-10', journal: 'VE', pieceRef: 'FA-2026-118', pieceDate: '2026-11-20',
        libelle: 'Encaissement, facture reprise FA-2026-118',
        lignes: [`${P.valeurs_a_l_encaissement} debit 2003`, `${P.tva_collectee} credit 334`, `${P.prestations_de_services} credit 1669`].sort(),
      },
      {
        genre: 'mouvement', date: '2027-02-12', journal: 'BQ', pieceRef: 'Relevé bancaire', pieceDate: '2027-02-12',
        // Jamais le libellé de la banque, qui nomme qui a payé (JJ1).
        libelle: 'Relevé du 12/02/2027 — FA-2026-118',
        lignes: [`${P.valeurs_a_l_encaissement} credit 2003@m1`, `${P.banque} debit 2003@m1`],
      },
    ])
    // Ni document ni avoir repris : sa créance et ses avoirs d'avant sont dans la reprise.
    expect(r.ecritures.some((e) => e.source.genre === 'facture' || e.source.genre === 'avoir')).toBe(false)
  })

  it('un bien : la TVA, que l’ancien logiciel a déclarée, solde le 411 — celui d’une balance reprise (A8e)', () => {
    const r = ecrituresDesVentesFacturees(entrees({ factures: [facture({ nature_operation: 'biens' }), AVOIR_REPRIS] }))
    expect(r.ecritures.find((e) => e.source.genre === 'encaissement')?.lignes.map((l) => `${l.compte} ${l.sens} ${l.centimes}`).sort())
      .toEqual([`${P.valeurs_a_l_encaissement} debit 2003`, `${P.clients} credit 334`, `${P.ventes_de_biens} credit 1669`].sort())
  })

  it('en engagement : l’encaissement solde le 411, sa TVA passe de l’attente au 44571 ; aucun document', () => {
    const r = ecrituresDesVentesFacturees(entrees({ mode: 'engagement' }))
    expect(r.ecritures.map((e) => e.source.genre)).toEqual(['encaissement', 'mouvement'])
    expect(r.ecritures[0].journal).toBe('BQ')
    expect(r.ecritures[0].lignes.map((l) => `${l.compte} ${l.sens} ${l.centimes}`).sort()).toEqual([
      `${P.valeurs_a_l_encaissement} debit 2003`, `${P.clients} credit 2003`, `${P.tva_collectee_en_attente} debit 334`,
      `${P.tva_collectee} credit 334`,
    ].sort())
  })

  it('l’avoir que l’application émet sur elle s’écrit, lui, à sa date', () => {
    const avoir = facture({ id: 'a1', statut: 'validee', type: 'avoir', numero: 'MA2027-0001', facture_origine_id: 'r1', date_emission: '2027-03-01' })
    const e = entrees({ mode: 'engagement', factures: [facture(), AVOIR_REPRIS, avoir] })
    const r = ecrituresDesVentesFacturees({
      ...e, sources: { ...e.sources, lignes: [...LIGNES, { facture_id: 'a1', ordre: 1, designation: 'Geste', quantite: -1, prix_unitaire_ht: 10, taux_tva: 20 }] },
    })
    const ecriture = r.ecritures.find((x) => x.source.genre === 'avoir')
    expect(ecriture && enClair(ecriture)).toMatchObject({ date: '2027-03-01', pieceRef: 'MA2027-0001', libelle: 'Avoir MA2027-0001' })
    expect(ecriture?.lignes.map((l) => `${l.compte} ${l.sens} ${l.centimes}`).sort()).toEqual([
      `${P.clients} credit 1200`, `${P.prestations_de_services} debit 1000`, `${P.tva_collectee_en_attente} debit 200`,
    ].sort())
  })
})

// ── Sans ce que la reprise porte : écartée, et le refus est celui de l'écran ──────────────────────────────────────────────

function contexte(composition: ReturnType<typeof ecrituresDesVentesFacturees>): ContexteEcritureVente {
  const mouvement: MouvementPourEcriture = {
    id: 'm1', dossier_id: D, statut: 'non_rapprochee', piece_id: null, cotisation_id: null, categorie_id: null, emprunt_id: null,
    compte_bilan: null, declaration_tva_id: null, ventilee: false, reglement_groupe: false, prelevement_personnel: false,
    encaissements_de_factures: true,
  }
  return {
    dossierId: D, ventesParLesFactures: true, anneesValidees: [], composition, plan: P, mouvements: [mouvement],
    factures: [facture(), AVOIR_REPRIS].map((f) => ({
      id: f.id, dossier_id: f.dossier_id, type: f.type, numero: f.numero, source_de_la_vente: f.source_de_la_vente,
      facture_origine_id: f.facture_origine_id, statut: f.statut,
    })),
    encaissements: [{ ...encaissement(), compte_contrepartie: null }],
  }
}

const SOURCES = [
  { genre: 'facture', factureId: 'r1' }, { genre: 'encaissement', encaissementId: 'e1', factureId: 'r1' },
  { genre: 'mouvement', ligneBancaireId: 'm1' },
] as const

describe('une reprise dont la reprise n’est pas lue', () => {
  it('drapeau levé : écartée et dite ; la base, qui lit `factures_importees`, ne refuserait pas ainsi — l’écran le dit', () => {
    drapeau.leve = true
    const composition = ecrituresDesVentesFacturees(entrees({ reprises: undefined }))
    expect(composition.ecritures).toEqual([])
    expect(composition.nonEcrites.map((n) => [n.source.genre, n.motif])).toEqual([['facture', 'vente_ecartee'], ['mouvement', 'mouvement_vente_ecartee']])
    expect(composition.nonEcrites[0].detail).toContain(LIBELLE_MOTIF_VENTE.reprise_illisible)
    const message = "Ce que la facture reprise FA-2026-118 portait encaissé avant la reprise n'est pas lu : ses écritures ne se composent pas d'ici."
    for (const source of SOURCES) {
      expect(refusEcritureVenteFacturee(source, contexte(composition)), source.genre).toEqual({ cle: 'reprise_non_lue', message })
    }
  })

  it('drapeau baissé, les mêmes lectures : les refus d’hier, ceux de la base', () => {
    const composition = ecrituresDesVentesFacturees(entrees({ reprises: undefined }))
    expect(composition.nonEcrites).toEqual([])
    for (const source of SOURCES) expect(refusEcritureVenteFacturee(source, contexte(composition))?.cle, source.genre).toBe('rien_a_ecrire')
  })
})

// ── Le FEC, la piste d'audit et le lettrage ; la fiche d'un mouvement ─────────────────────────────────────────────────────

describe('la pièce cite la facture reprise', () => {
  it('drapeau levé : « Facture reprise », « Avoir repris » ; une facture de l’application, comme hier', () => {
    drapeau.leve = true
    expect(nomDuDocument(facture())).toBe('Facture reprise FA-2026-118')
    expect(nomDuDocument(AVOIR_REPRIS)).toBe('Avoir repris AV-2026-7')
    expect(nomDuDocument(FACTURE_DE_L_APPLICATION)).toBe('Facture F2027-0001')
    expect(nomDuDocument({ ...facture(), numero: null })).toBe('Facture reprise r1')
  })
})

describe('un mouvement classé par les encaissements d’une reprise se lit comme celui d’une facture source', () => {
  const ACCES: AccesDuDossier = { etat: 'lus', comptes: [] }
  const e: EncaissementDuMouvementLu = { ...encaissement(), cree_par: 'u-cabinet' }
  const lu = () => mouvementDeVente(
    { ...MOUVEMENT, statut: 'non_rapprochee', piece_id: null, cotisation_id: null, categorie_id: null, emprunt_id: null, compte_bilan: null,
      declaration_tva_id: null, ventilee: false, reglement_groupe: false, prelevement_personnel: false },
    { factures: [facture(), AVOIR_REPRIS], encaissements: [e], exemplaires: [] }, ACCES,
  )

  for (const leve of [false, true]) {
    it(`drapeau ${leve ? 'levé' : 'baissé'} : classé, sa facture source, jamais « hors des ventes facturées »`, () => {
      drapeau.leve = leve
      const m = lu()
      expect(m?.etat).toBe('classe')
      expect(m?.encaissements.map((x) => [x.numero, x.horsDesVentesFacturees])).toEqual([['FA-2026-118', null]])
      expect(carteDeVente(m!, ACCES).lignes.map((l) => l.libelle))
        .toEqual([`${leve ? 'Facture reprise' : 'Facture'} FA-2026-118 — virement du 10/02/2027`])
    })
  }
})
