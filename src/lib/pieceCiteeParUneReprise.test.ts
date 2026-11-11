import { readFileSync } from 'node:fs'
import { SANS_VENTE_FACTUREE } from '../test/ventesFacturees'
import { OPERATIONS_DE_CAISSE_ABSENTES } from './controlesDeLaCaisse'
import { pisteAudit } from './pisteAudit'
import { describe, expect, it, vi } from 'vitest'
import { calculerDeclaration2035 } from './declaration2035'
import { analyserEcritures, lignesChargeProduitPourPiece, piecesAComptabiliser } from './ecritures'
import type { ModeleComptable } from './engagement'
import { AUCUNE_FACTURE_SOURCE, AUCUNE_PIECE_CITEE, marquerLesPiecesCitees } from './facturesSources'
import { lireLesPiecesCitees } from './ventesFactureesLecture'
import { projectionAnnuelle, recettesFactureesDuDossier } from './estimation'
import type { LigneDeFacture } from './encaissementsFactures'
import { PLAN_PAR_DEFAUT } from './planComptable'
import { AUCUN_PAIEMENT_PAR_LA_CAISSE, paiementsDesPieces } from './rattachement'
import { CAISSE_ABSENTE } from './recettesDeCaisse'
import { avecLesPiecesCitees, lectureDesVentesDeLaSimulation, recettesDeLaSimulation } from './simulationVentesFacturees'
import { calculerSituationIntermediaire } from './situationIntermediaire'
import type { Categorie, EcritureBrouillon, Piece } from './types'
import {
  SANS_ACOMPTE, recettesFactureesParMois, ventesFacturees, type EncaissementVendu, type FactureVendue, type RepriseVendue,
} from './ventesFacturees'
import { derniereDefinitionSql } from '../test/schema'

// LA PIÈCE CITÉE PAR UNE FACTURE REPRISE NE COMPTE QUE SES PAIEMENTS (étape A8c4 ; HISTORIQUE.md, « A8C4 »). Le défaut, confirmé
// le 10/11/2026 : la pièce citée par une facture reprise (A8-Q5) comptait encore son reste impayé à sa date de pièce
// (`sans_paiement`), et le registre de la reprise comptait l'encaissement d'après la reprise — 200 € au lieu de 100 €. Données
// FICTIVES : un dossier basculé, BNC en trésorerie, exonéré ; une facture de l'ancien logiciel de 100 € (0 %), datée du
// 20/11/2026, rien encaissé avant la reprise (01/12/2026) ; son PDF, pièce de vente validée du même jour, citée par un lien
// actif ; payée 100 € le 15/12/2026, par le registre. Attendu : 100 € de recettes en 2026, partout côté cabinet.

// La lecture des liens, sur un faux client qui APPLIQUE le filtre du lien actif (`retire_le` nul) et celui du dossier.
const liens = vi.hoisted(() => ({ lignes: [] as { id: string; dossier_id: string; piece_id: string; retire_le: string | null }[] }))
vi.mock('./supabase', () => {
  const requete = (filtres: ((l: Record<string, unknown>) => boolean)[]) => ({
    select: () => requete(filtres),
    eq: (c: string, v: unknown) => requete([...filtres, (l) => l[c] === v]),
    is: (c: string, v: unknown) => requete([...filtres, (l) => l[c] === v]),
    order: () => requete(filtres),
    range: () => {
      const data = liens.lignes.filter((l) => filtres.every((f) => f(l)))
      return Promise.resolve({ data, error: null, count: data.length })
    },
  })
  return { supabase: { from: () => requete([]) } }
})

const D = 'd1'
const REPRISE: FactureVendue = {
  id: 'r1', dossier_id: D, statut: 'importee' as FactureVendue['statut'], type: 'facture', numero: 'FA-2026-050',
  date_emission: '2026-11-20', tiers_nom: 'Client fictif', facture_origine_id: null, source_de_la_vente: true,
  nature_operation: 'services', option_debits: false, date_prestation: null,
} as FactureVendue
const LIGNES: LigneDeFacture[] = [{ facture_id: 'r1', ordre: 1, designation: 'Séance', quantite: 1, prix_unitaire_ht: 100, taux_tva: 0 }]
const REPRISES: RepriseVendue[] = [{ facture_id: 'r1', dossier_id: D, origine_id: null, encaisse_par_taux: [], montant_tva: 0 }]
const ENCAISSEMENT: EncaissementVendu = {
  id: 'e1', dossier_id: D, facture_id: 'r1', date_encaissement: '2026-12-15', montant: 100, moyen: 'virement',
  ligne_bancaire_id: null, annule_id: null, cree_le: '2026-12-15T10:00:00Z', retire_le: null,
}
const ventes = ventesFacturees({
  dossierId: D, factures: [REPRISE], lignes: LIGNES, encaissements: [ENCAISSEMENT],
  parts: [{ encaissement_id: 'e1', dossier_id: D, taux: 0, montant: 100 }], acomptes: SANS_ACOMPTE, reprises: REPRISES,
  piecesCitees: new Set(['p1']),
})
// La pièce citée : `facture_id` nul (la garde refuse toute désignation tant que le lien vit), aucun paiement (la garde des
// règlements refuse tout rapprochement daté du 01/12/2026 ou d'après).
const PIECE_CITEE = {
  id: 'p1', dossier_id: D, statut: 'validee', type_piece: 'vente', date_piece: '2026-11-20', montant_ht: 100,
  montant_ttc: 100, categorie_id: 'c-recettes', facture_id: null, created_at: '2026-11-21T09:00:00Z', storage_hash: 'abc',
} as Piece
const CATEGORIES = [{ id: 'c-recettes', poste_2035: 'Recettes', compte_comptable: '706000' }] as Categorie[]
const AUCUN_PAIEMENT = paiementsDesPieces([], [], [], AUCUN_PAIEMENT_PAR_LA_CAISSE)

describe('la pièce citée par une facture reprise ne compte que ses paiements (A8c4)', () => {
  it('le registre compte 100 € en décembre (le module, la règle de la base)', () => {
    expect([...recettesFactureesParMois(ventes, 'tresorerie')]).toEqual([['2026-12', 10000]])
  })

  it('en production, la simulation du client lit les reprises et ne rend que les mois et les factures VALIDÉES', () => {
    const sql = derniereDefinitionSql('ventes_facturees_de_la_simulation')
    expect(sql).toContain("f.statut in ('validee', 'importee')")
    expect(sql).toContain("jsonb_build_object('par_mois', v_par_mois, 'sources', v_sources)")
    expect(sql).not.toMatch(/pieces_des_factures_reprises/i)
    const migration = readFileSync('supabase/schema/20261110143243_piece_d_une_facture_reprise.sql', 'utf8')
    expect(migration).toContain('for select to authenticated using (public.admin_du_dossier(dossier_id));')
  })

  it('le drapeau `REPRISES_AU_CLIENT_PREVUES` baissé (A8Q5-Q2) : « Ma simulation » du client « Banque », qui ne lit pas les liens, compte encore 200 €', () => {
    // Exactement ce que rend `ventes_facturees_de_la_simulation` pour ce dossier et 2026.
    const recettes = recettesDeLaSimulation({ par_mois: { '2026-12': 10000 }, sources: [] }, 2026)
    expect(recettes).not.toBeNull()
    const p = projectionAnnuelle([PIECE_CITEE], [], '2026-12-31', false, AUCUN_PAIEMENT, 'tresorerie', [], recettes!, CAISSE_ABSENTE)
    expect(p.ca).toBe(200)
  })

  it('A8Q5-Q2, le drapeau `REPRISES_AU_CLIENT_PREVUES` levé : les pièces citées que rend `pieces_citees_de_la_simulation`, jointes à ses ventes, font 100 €', () => {
    const lue = lectureDesVentesDeLaSimulation(D, 2026, { data: { par_mois: { '2026-12': 10000 }, sources: [] }, error: null })
    const jointe = avecLesPiecesCitees(lue, { etat: 'lues', piecesCitees: new Set([PIECE_CITEE.id]) })
    expect(jointe.etat).toBe('lue')
    if (jointe.etat !== 'lue') return
    const p = projectionAnnuelle([PIECE_CITEE], [], '2026-12-31', false, AUCUN_PAIEMENT, 'tresorerie', [], jointe.recettes, CAISSE_ABSENTE)
    expect(p.ca).toBe(100)
    // Baissé, rien n'est demandé (`null`) : la lecture d'hier, et ses 200 €.
    expect(avecLesPiecesCitees(lue, null)).toBe(lue)
  })

  it('l’Estimation du cabinet : 100 €', () => {
    const p = projectionAnnuelle(
      [PIECE_CITEE], [], '2026-12-31', false, AUCUN_PAIEMENT, 'tresorerie', [], recettesFactureesDuDossier(ventes, 'tresorerie'),
      CAISSE_ABSENTE,
    )
    expect(p.ca).toBe(100)
  })

  it('la 2035 du cabinet : 100 € de recettes, la pièce jamais dite « sans paiement connu »', () => {
    const d = calculerDeclaration2035(
      2026, [PIECE_CITEE], CATEGORIES, [], [], [], false, AUCUN_PAIEMENT, [], [], PLAN_PAR_DEFAUT, ventes,
      { etat: 'composees', composition: { dossierId: D, ecritures: [] } }, CAISSE_ABSENTE,
    )
    expect(d.totalRecettes).toBe(100)
    expect(d.sansPaiementConnu).toEqual([])
  })

  it('témoin : chacune des deux sources seule compte 100 € ; une pièce que rien ne cite s’écrit au 706, à sa date', () => {
    const sansPiece = calculerDeclaration2035(
      2026, [], CATEGORIES, [], [], [], false, AUCUN_PAIEMENT, [], [], PLAN_PAR_DEFAUT, ventes,
      { etat: 'composees', composition: { dossierId: D, ecritures: [] } }, CAISSE_ABSENTE,
    )
    expect(sansPiece.totalRecettes).toBe(100)
    const sansReprise = projectionAnnuelle(
      [PIECE_CITEE], [], '2026-12-31', false, AUCUN_PAIEMENT, 'tresorerie', [],
      recettesDeLaSimulation({ par_mois: {}, sources: [] }, 2026)!, CAISSE_ABSENTE,
    )
    expect(sansReprise.ca).toBe(100)
    const lignes = lignesChargeProduitPourPiece(D, PIECE_CITEE, { compte: '706000', immobilisation: false }, false, [], PLAN_PAR_DEFAUT)
    expect(lignes.filter((l) => l.compte === '706000').map((l) => [l.date, l.montant])).toEqual([['2026-11-20', 100]])
  })

  it('la situation intermédiaire du cabinet : 100 €', () => {
    const s = calculerSituationIntermediaire(
      [PIECE_CITEE], CATEGORIES, [], [], '2026-01-01', '2026-12-31', false, AUCUN_PAIEMENT, 'tresorerie', [], ventes,
      PLAN_PAR_DEFAUT, { etat: 'composees', composition: { dossierId: D, ecritures: [] } }, CAISSE_ABSENTE,
    )
    expect(s.recettes).toBe(100)
  })

  it('le brouillon (donc le FEC) : la pièce citée et jamais payée ne s’écrit pas ; payée 40 € avant la reprise, 40 € à sa date de paiement', () => {
    const cible = marquerLesPiecesCitees(piecesAComptabiliser([PIECE_CITEE], CATEGORIES, new Map(), AUCUNE_FACTURE_SOURCE), ventes.piecesCitees)[0]
    expect(cible.paiementsSeuls).toBe(true)
    expect(lignesChargeProduitPourPiece(D, PIECE_CITEE, cible, false, [], PLAN_PAR_DEFAUT)).toEqual([])
    const avant = paiementsDesPieces([{ id: 'm1', date: '2026-11-25', montant: 40, piece_id: 'p1', statut: 'rapprochee' }] as never, [], [], AUCUN_PAIEMENT_PAR_LA_CAISSE)
    const lignes = lignesChargeProduitPourPiece(D, PIECE_CITEE, cible, false, avant.get('p1') ?? [], PLAN_PAR_DEFAUT)
    expect(lignes.map((l) => [l.compte, l.date, l.montant])).toEqual([['706000', '2026-11-25', 40]])
    const d = calculerDeclaration2035(
      2026, [PIECE_CITEE], CATEGORIES, [], [], [], false, avant, [], [], PLAN_PAR_DEFAUT, ventes,
      { etat: 'composees', composition: { dossierId: D, ecritures: [] } }, CAISSE_ABSENTE,
    )
    expect(d.totalRecettes).toBe(140)
  })

  // Trouvé le 11/11/2026 en alignant l'assistant : le contrôle du brouillon comparait le total et la TVA de l'écriture à la
  // pièce ENTIÈRE, et disait « à régénérer », pour toujours, l'écriture juste d'une pièce citée payée en partie avant la
  // reprise (« Régénérer » réécrivait la même). Il les compare à ce que la génération écrit (`attenduDeLaPiece`).
  it('les contrôles du brouillon : la pièce payée en partie avant la reprise, écrite à ses paiements, est juste ; écrite entière à sa date, à régénérer', () => {
    const cible = marquerLesPiecesCitees(piecesAComptabiliser([PIECE_CITEE], CATEGORIES, new Map(), AUCUNE_FACTURE_SOURCE), ventes.piecesCitees)
    const avant = paiementsDesPieces([{ id: 'm1', date: '2026-11-25', montant: 40, piece_id: 'p1', statut: 'rapprochee' }] as never, [], [], AUCUN_PAIEMENT_PAR_LA_CAISSE)
    const modele = { mode: 'tresorerie', compteNotesDeFrais: '108000', plan: PLAN_PAR_DEFAUT } as ModeleComptable
    const ligne = (n: number, date: string, compte: string, sens: 'debit' | 'credit', montant: number, mvt: string | null = null) =>
      ({ id: `e${n}`, dossier_id: D, piece_id: 'p1', date, compte, sens, montant, ligne_bancaire_id: mvt }) as EcritureBrouillon
    const juste = [ligne(1, '2026-11-25', '706000', 'credit', 40), ligne(2, '2026-11-25', '512000', 'debit', 40, 'm1')]
    const entiere = [ligne(1, '2026-11-20', '706000', 'credit', 60), ...juste]
    const desynchronisees = (e: EcritureBrouillon[], a: typeof cible) =>
      analyserEcritures(e, a, false, avant, modele, null, new Set()).piecesDesynchronisees.map((p) => p.id)
    expect(desynchronisees(juste, cible)).toEqual([])
    expect(desynchronisees(entiere, cible)).toEqual(['p1'])
    // Témoin : non citée, la pièce doit ses 100 € — l'écriture à ses seuls paiements est à régénérer, l'entière juste.
    const nonCitee = piecesAComptabiliser([PIECE_CITEE], CATEGORIES, new Map(), AUCUNE_FACTURE_SOURCE)
    expect(desynchronisees(juste, nonCitee)).toEqual(['p1'])
    expect(desynchronisees(entiere, nonCitee)).toEqual([])
  })

  it('la piste d’audit ne dit pas « écriture manquante » de la pièce citée et jamais payée ; non citée, si', () => {
    const piste = (piecesCitees: ReadonlySet<string>) => pisteAudit([], [PIECE_CITEE], [], [], {
      immobilisations: [], factures: [], vehicules: [], ventes: { ...SANS_VENTE_FACTUREE, piecesCitees },
      caisse: OPERATIONS_DE_CAISSE_ABSENTES, plan: PLAN_PAR_DEFAUT,
    }).filter((l) => l.pieceId === 'p1').map((l) => l.manque)
    expect(piste(ventes.piecesCitees)).toEqual([[]])
    expect(piste(AUCUNE_PIECE_CITEE)).toEqual([['écriture']])
  })

  it('une pièce que rien ne cite (AUCUNE_PIECE_CITEE) ne reçoit aucune marque', () => {
    const cible = marquerLesPiecesCitees(piecesAComptabiliser([PIECE_CITEE], CATEGORIES, new Map(), AUCUNE_FACTURE_SOURCE), AUCUNE_PIECE_CITEE)[0]
    expect(cible.paiementsSeuls).toBeUndefined()
  })

  it('la lecture ne rend que les liens ACTIFS du dossier : un lien retiré ne cite plus sa pièce', async () => {
    liens.lignes = [
      { id: 'l1', dossier_id: D, piece_id: 'p1', retire_le: null },
      { id: 'l2', dossier_id: D, piece_id: 'p2', retire_le: '2026-12-02T10:00:00Z' },
      { id: 'l3', dossier_id: 'autre', piece_id: 'p3', retire_le: null },
    ]
    const lu = await lireLesPiecesCitees(D)
    expect(lu.etat === 'lues' && [...lu.citees]).toEqual(['p1'])
  })
})
