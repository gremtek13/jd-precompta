import { describe, expect, it } from 'vitest'
import { ecritureDeLOperation } from './caisse'
import { arrondirPourFormulaire, repartirEnCases, valeursDesCases } from './cases2035'
import { concordance2035, LIBELLES_MOTIFS, ouAgir, phraseDeLEcart } from './concordance2035'
import { calculerDeclaration2035, type Declaration2035 } from './declaration2035'
import { calculerCa3, comparerDeclarations, type DonneesTva } from './declarationTva'
import { projectionAnnuelle, RECETTES_FACTUREES_NON_COMPTEES, totauxPourAnnee } from './estimation'
import { PLAN_PAR_DEFAUT } from './planComptable'
import { paiementsDesPieces } from './rattachement'
import {
  CAISSE_ABSENTE, centimesDesRecettesDeCaisse, libelleDeLaRecette, lignesDeLaCaissePourLePlan, motifDeLaCaisse,
  RECETTES_DE_CAISSE_NON_COMPTEES, recetteDeCaisse, type CaisseLue, recettesDe, recettesDeCaisseDuClient, recettesDeCaisseDuDossier,
  recettesPourLesMoteurs, recettesVivantes, SIMULATION_SANS_CAISSE, simulationDitNePasCompterLaCaisse, type RecettesDeCaisse,
} from './recettesDeCaisse'
import { declarationPourLaRevue, donneesDeLaRevueAnalytique } from './revueAnalytiqueEcran'
import { calculerSituationIntermediaire } from './situationIntermediaire'
import { instantane2035, lireInstantane2035, postesDeLInstantane } from './validationExercice'
import type { Categorie, EcritureBrouillon, OperationCaisse } from './types'
import { entierTire, tirage } from '../test/encaissementsBatterie'
import { ventesFactureesVides } from '../test/ventesFacturees'
import { categorie, ecriture } from '../test/revision'

// LES RECETTES DE CAISSE DANS LES MOTEURS (ligne 26.6, étape C3a). Ce que ces cas gardent : la forme — absente (le drapeau
// baissé), lue, et ce que l'écran tient d'une lecture pas revenue ou partielle ; ce qu'est une recette (une opération
// vivante de genre recette : ni l'apport, ni le prélèvement, ni le paiement d'une pièce, ni une retirée ou une remplacée) ;
// sa date, son poste, sa case, son hors taxe ; la concordance au centime avec l'écriture que la base compose ; la CA3 à son
// taux ; la situation, l'estimation, le plan de trésorerie, la revue ; l'instantané validé en version 3. Des jeux FICTIFS.

const DOSSIER = 'd-caisse'
const MODELE = { mode: 'tresorerie' as const, compteNotesDeFrais: '455000' as const, plan: PLAN_PAR_DEFAUT }

const HONORAIRES = categorie({
  id: 'k-hono', dossier_id: DOSSIER, code: 'honoraires', libelle: 'Honoraires', compte_comptable: '706000',
  poste_2035: 'Recettes encaissées y compris les remboursements de frais',
})
const PRODUITS_FINANCIERS = categorie({
  id: 'k-fin', dossier_id: DOSSIER, code: 'produits_financiers', libelle: 'Produits financiers', compte_comptable: '768000',
  poste_2035: 'Produits financiers',
})
const GAINS = categorie({ id: 'k-gains', dossier_id: null, code: 'gains', libelle: 'Gains divers', compte_comptable: '758000', poste_2035: 'Gains divers' })
const SANS_POSTE = categorie({ id: 'k-sans-poste', dossier_id: DOSSIER, code: 'sans_poste', libelle: 'Recettes à classer', compte_comptable: '708000', poste_2035: null })
// Une catégorie dont le compte a changé depuis la saisie : ce n'est plus un produit.
const DEVENUE_CHARGE = categorie({ id: 'k-charge', dossier_id: DOSSIER, code: 'charge', libelle: 'Devenue charge', compte_comptable: '606000', poste_2035: 'Achats' })
const CATEGORIES: Categorie[] = [HONORAIRES, PRODUITS_FINANCIERS, GAINS, SANS_POSTE, DEVENUE_CHARGE]

function operation(o: Partial<OperationCaisse>): OperationCaisse {
  return {
    id: 'o', dossier_id: DOSSIER, genre: 'recette', date: '2026-03-12', montant: 100, categorie_id: HONORAIRES.id, taux_tva: null,
    encaissements_du_jour: [], piece_id: null, origine: 'cabinet', remplace_id: null, cree_le: '2026-03-12T18:00:00Z',
    cree_par: 'u-chef', retire_le: null, retire_par: null, ...o,
  }
}

function lecture(operations: OperationCaisse[], o: Partial<CaisseLue> = {}): CaisseLue {
  return { dossierId: DOSSIER, enBase: true, lignes: operations, complete: true, motif: null, ...o }
}

function caisseDe(operations: OperationCaisse[], assujetti = false, categories: Categorie[] = CATEGORIES): RecettesDeCaisse {
  const r = recettesPourLesMoteurs(recettesDeCaisseDuDossier(lecture(operations), DOSSIER, categories, assujetti))
  if (r === null) throw new Error('la caisse devait être lue')
  return r
}

function declaration2035(annee: number, caisse: RecettesDeCaisse, assujetti = false, categories: Categorie[] = CATEGORIES): Declaration2035 {
  return calculerDeclaration2035(
    annee, [], categories, [], [], [], assujetti, paiementsDesPieces([], [], []), [], [], PLAN_PAR_DEFAUT, ventesFactureesVides(DOSSIER),
    { etat: 'sans_bascule' }, caisse,
  )
}

// L'écriture que la base compose pour une opération, telle qu'elle arrive au brouillon : ses lignes, chacune désignant
// l'opération (`operation_caisse_id`), à sa date.
function brouillonDe(o: OperationCaisse, categories: Categorie[] = CATEGORIES, assujetti = false): EcritureBrouillon[] {
  const cat = categories.find((c) => c.id === o.categorie_id) ?? null
  return ecritureDeLOperation({
    genre: o.genre as 'recette', date: o.date, montant: o.montant, taux_tva: assujetti ? o.taux_tva : null,
    categorie: cat ? { libelle: cat.libelle, compte_comptable: cat.compte_comptable } : null,
  }, MODELE).map((l, i) => ecriture({
    id: `${o.id}-${i}`, date: o.date, compte: l.compte, sens: l.sens, montant: l.montant, libelle: l.libelle, operation_caisse_id: o.id,
  }))
}

const CONTEXTE = { piecesValidees: new Set<string>(), piecesImmobilisees: new Set<string>(), mouvementsDesVentesFacturees: new Set<string>() }

describe('ce qu’est une recette de caisse', () => {
  it('une opération vivante de genre recette : ni l’apport, ni le prélèvement, ni le paiement d’une pièce, ni une retirée ou une remplacée', () => {
    const ops = [
      operation({ id: 'r1' }),
      operation({ id: 'a1', genre: 'apport', categorie_id: null, encaissements_du_jour: null }),
      operation({ id: 'p1', genre: 'prelevement', categorie_id: null, encaissements_du_jour: null }),
      operation({ id: 'q1', genre: 'paiement', montant: -30, categorie_id: null, encaissements_du_jour: null, piece_id: 'piece' }),
      operation({ id: 'r2', retire_le: '2026-03-13T08:00:00Z' }),
      // r3 remplacée par r4 : la base la retire ; elle reste écartée même si une lecture la rendait vivante.
      operation({ id: 'r3' }),
      operation({ id: 'r4', remplace_id: 'r3', montant: 110 }),
    ]
    expect(recettesVivantes(ops).map((o) => o.id)).toEqual(['r1', 'r4'])
    expect(recettesDe(caisseDe(ops)).map((r) => r.operationId)).toEqual(['r1', 'r4'])
  })

  it('résolue au statut de TVA d’aujourd’hui, comme une recette du relevé : le hors taxe d’un assujetti, le total sinon', () => {
    const op = operation({ montant: 120, taux_tva: 20 })
    expect(recetteDeCaisse(op, CATEGORIES, true)).toMatchObject({
      poste: HONORAIRES.poste_2035, nature: 'recette', compte: '706000', taux: 20, centimes: 12000, htCentimes: 10000, tvaCentimes: 2000,
    })
    // Le taux ne s'applique qu'à un dossier assujetti.
    expect(recetteDeCaisse(op, CATEGORIES, false)).toMatchObject({ taux: null, centimes: 12000, htCentimes: 12000, tvaCentimes: 0 })
    // Des espèces rendues : tout est signé comme elles.
    expect(recetteDeCaisse(operation({ montant: -60, taux_tva: 20 }), CATEGORIES, true)).toMatchObject({ centimes: -6000, htCentimes: -5000, tvaCentimes: -1000 })
    // Une catégorie qui n'est plus un produit, ou qu'on n'a pas lue : ni nature ni taux.
    expect(recetteDeCaisse(operation({ categorie_id: DEVENUE_CHARGE.id, taux_tva: 20 }), CATEGORIES, true)).toMatchObject({ nature: 'depense', taux: null })
    expect(recetteDeCaisse(operation({ categorie_id: 'k-inconnue' }), CATEGORIES, false)).toMatchObject({ nature: null, poste: null, libelleCategorie: null })
    // Une catégorie commune (`dossier_id` nul) se résout comme une autre.
    expect(recetteDeCaisse(operation({ categorie_id: GAINS.id }), CATEGORIES, false)).toMatchObject({ poste: 'Gains divers', compte: '758000' })
  })

  it('le libellé est celui que la base compose pour l’écriture, sans nom', () => {
    expect(libelleDeLaRecette(recetteDeCaisse(operation({}), CATEGORIES, false))).toBe('Recettes en espèces du 12/03/2026 — Honoraires')
    expect(libelleDeLaRecette(recetteDeCaisse(operation({ montant: -5 }), CATEGORIES, false))).toBe('Espèces rendues le 12/03/2026 — Honoraires')
    expect(libelleDeLaRecette(recetteDeCaisse(operation({}), CATEGORIES, false))).toBe(brouillonDe(operation({}))[0].libelle)
  })
})

describe('ce que l’écran tient de la caisse', () => {
  it('pas encore revenue, ou celle d’un autre dossier : en attente — aucun moteur', () => {
    expect(recettesDeCaisseDuDossier(null, DOSSIER, CATEGORIES, false)).toEqual({ etat: 'en_attente' })
    expect(recettesDeCaisseDuDossier(lecture([], { dossierId: 'autre' }), DOSSIER, CATEGORIES, false)).toEqual({ etat: 'en_attente' })
    expect(recettesPourLesMoteurs({ etat: 'en_attente' })).toBeNull()
  })

  it('le drapeau baissé : ABSENTE, qui ne se dit pas et ne retient rien — pas une caisse lue en partie', () => {
    const absente = recettesDeCaisseDuDossier(lecture([], { enBase: false, complete: false, motif: 'pas en base' }), DOSSIER, CATEGORIES, false)
    expect(absente).toBe(CAISSE_ABSENTE)
    expect(recettesPourLesMoteurs(absente)).toBe(CAISSE_ABSENTE)
    expect(motifDeLaCaisse(absente)).toBeNull()
    expect(recettesDe(CAISSE_ABSENTE)).toEqual([])
  })

  it('lue en partie : incomplète, son motif dit, aucun moteur', () => {
    const partielle = recettesDeCaisseDuDossier(lecture([operation({})], { complete: false, motif: 'coupée' }), DOSSIER, CATEGORIES, false)
    expect(partielle).toEqual({ etat: 'incomplete', motif: 'coupée' })
    expect(recettesPourLesMoteurs(partielle)).toBeNull()
    expect(motifDeLaCaisse(partielle)).toBe('coupée')
    expect(motifDeLaCaisse(recettesDeCaisseDuDossier(lecture([], { complete: false }), DOSSIER, CATEGORIES, false))).toBe('la lecture de la caisse est incomplète')
  })

  it('lue en entier : ses recettes, avec le dossier', () => {
    expect(recettesDeCaisseDuDossier(lecture([operation({ id: 'r1' })]), DOSSIER, CATEGORIES, false)).toMatchObject({
      etat: 'lue', dossierId: DOSSIER, recettes: [{ operationId: 'r1' }],
    })
  })
})

describe('la 2035', () => {
  it('compte une recette à SA date, dans le poste de sa catégorie, et la ligne compte ses opérations', () => {
    const caisse = caisseDe([
      operation({ id: 'r1', date: '2025-12-31', montant: 80 }),
      operation({ id: 'r2', date: '2026-01-02', montant: 45.5 }),
      operation({ id: 'r3', date: '2026-01-03', montant: 30 }),
      operation({ id: 'r4', date: '2026-02-01', montant: 12, categorie_id: PRODUITS_FINANCIERS.id }),
      operation({ id: 'r5', date: '2026-02-02', montant: 7, categorie_id: GAINS.id }),
      operation({ id: 'a1', genre: 'apport', montant: 500, categorie_id: null, encaissements_du_jour: null }),
      operation({ id: 'p1', genre: 'prelevement', montant: 20, categorie_id: null, encaissements_du_jour: null }),
    ])
    const d2025 = declaration2035(2025, caisse)
    expect(d2025.recettes).toEqual([{
      poste: HONORAIRES.poste_2035, nature: 'recette', montant: 80, nbPieces: 0, nbMouvements: 0, nbEncaissements: 0, nbOperationsDeCaisse: 1,
    }])
    const d = declaration2035(2026, caisse)
    expect(d.recettes).toEqual([
      { poste: HONORAIRES.poste_2035, nature: 'recette', montant: 75.5, nbPieces: 0, nbMouvements: 0, nbEncaissements: 0, nbOperationsDeCaisse: 2 },
      { poste: 'Produits financiers', nature: 'recette', montant: 12, nbPieces: 0, nbMouvements: 0, nbEncaissements: 0, nbOperationsDeCaisse: 1 },
      { poste: 'Gains divers', nature: 'recette', montant: 7, nbPieces: 0, nbMouvements: 0, nbEncaissements: 0, nbOperationsDeCaisse: 1 },
    ])
    // L'apport et le prélèvement n'y sont pas.
    expect(d.totalRecettes).toBe(94.5)
    expect(d.totalDepenses).toBe(0)
    expect(d.contributions.map((c) => [c.source.type, c.source.type === 'caisse' ? c.source.id : null, c.compte, c.centimes]))
      .toEqual([['caisse', 'r2', '706000', 4550], ['caisse', 'r3', '706000', 3000], ['caisse', 'r4', '768000', 1200], ['caisse', 'r5', '758000', 700]])
    // Les cases : AA, donc AD que le volet social reprend ; AE ; AF.
    const { valeurs } = valeursDesCases(d)
    expect([valeurs.get('AA'), valeurs.get('AD'), valeurs.get('AE'), valeurs.get('AF'), valeurs.get('AG')]).toEqual([75.5, 75.5, 12, 7, 94.5])
    expect(repartirEnCases(d).cases.map((c) => [c.case.code, c.nbOperationsDeCaisse])).toEqual([['AA', 2], ['AE', 1], ['AF', 1]])
  })

  it('au hors taxe sur un dossier assujetti, au total sinon ; des espèces rendues diminuent le poste', () => {
    const ops = [operation({ id: 'r1', montant: 120, taux_tva: 20 }), operation({ id: 'r2', montant: -24, taux_tva: 20 })]
    expect(declaration2035(2026, caisseDe(ops, true), true).recettes[0]).toMatchObject({ montant: 80, nbOperationsDeCaisse: 2 })
    expect(declaration2035(2026, caisseDe(ops, false), false).recettes[0]).toMatchObject({ montant: 96, nbOperationsDeCaisse: 2 })
  })

  it('dit ce qu’elle ne compte pas : une catégorie sans poste, une catégorie qui n’est plus un produit, une inconnue', () => {
    const d = declaration2035(2026, caisseDe([
      operation({ id: 'r1', categorie_id: SANS_POSTE.id }),
      operation({ id: 'r2', categorie_id: DEVENUE_CHARGE.id }),
      operation({ id: 'r3', categorie_id: 'k-inconnue' }),
    ]))
    expect(d.recettes).toEqual([])
    expect(d.depenses).toEqual([])
    expect(d.exclusions.recettesDeCaisseSansPoste.map((r) => r.operationId)).toEqual(['r1'])
    expect(d.exclusions.recettesDeCaisseSansProduit.map((r) => r.operationId)).toEqual(['r2', 'r3'])
  })

  it('la caisse ABSENTE ne change rien : aucune contribution, aucune exclusion, et les lignes n’ont pas de compte de caisse', () => {
    const d = declaration2035(2026, CAISSE_ABSENTE)
    expect(d.contributions).toEqual([])
    expect(d.exclusions.recettesDeCaisseSansPoste).toEqual([])
    expect(d.exclusions.recettesDeCaisseSansProduit).toEqual([])
    // Une ligne d'une autre source, sans le champ : elle est celle d'avant la caisse.
    const avecPiece = calculerDeclaration2035(
      2026, [{ ...piecePayee(), categorie_id: HONORAIRES.id }], CATEGORIES, [], [], [], false, paiementsDesPieces([], [], []), [], [],
      PLAN_PAR_DEFAUT, ventesFactureesVides(DOSSIER), { etat: 'sans_bascule' }, CAISSE_ABSENTE,
    )
    expect(Object.keys(avecPiece.recettes[0])).toEqual(['poste', 'nature', 'montant', 'nbPieces', 'nbMouvements', 'nbEncaissements'])
    // Lue et vide : le compte est là, à zéro.
    const lueVide = calculerDeclaration2035(
      2026, [{ ...piecePayee(), categorie_id: HONORAIRES.id }], CATEGORIES, [], [], [], false, paiementsDesPieces([], [], []), [], [],
      PLAN_PAR_DEFAUT, ventesFactureesVides(DOSSIER), { etat: 'sans_bascule' }, caisseDe([]),
    )
    expect(lueVide.recettes[0]).toEqual({ ...avecPiece.recettes[0], nbOperationsDeCaisse: 0 })
  })
})

function piecePayee() {
  return {
    id: 'p1', dossier_id: DOSSIER, type_piece: 'vente', statut: 'validee', date_piece: '2026-03-01', montant_ht: 50, montant_tva: 0, montant_ttc: 50,
    devise: 'EUR', categorie_id: null, tiers: 'Client fictif', nom_fichier: 'fictif.pdf', created_at: '2026-03-01T10:00:00Z',
  } as unknown as Parameters<typeof calculerDeclaration2035>[1][number]
}

describe('la concordance', () => {
  it('retrouve chaque recette dans le brouillon par son opération, au centime', () => {
    const ops = [
      operation({ id: 'r1', montant: 120, taux_tva: 20 }), operation({ id: 'r2', montant: -24, taux_tva: 20 }),
      operation({ id: 'r3', montant: 33.33, taux_tva: 5.5, categorie_id: PRODUITS_FINANCIERS.id }),
    ]
    const d = declaration2035(2026, caisseDe(ops, true), true)
    const c = concordance2035(d, ops.flatMap((o) => brouillonDe(o, CATEGORIES, true)), CONTEXTE, null)
    expect(c.ecarts).toEqual([])
    expect(c.concorde).toBe(true)
    expect(c.ecritures.resultat).toBe(d.resultat)
  })

  it('une écriture qui manque ou qui ne suit plus l’opération : à reprendre, dans la caisse', () => {
    const op = operation({ id: 'r1', montant: 100 })
    const d = declaration2035(2026, caisseDe([op]))
    const manque = concordance2035(d, [], CONTEXTE, null).ecarts
    expect(manque.map((e) => [e.cle, e.motif, e.reference])).toEqual([['caisse:r1', 'caisse_a_reprendre', { type: 'caisse', id: 'r1' }]])
    expect(phraseDeLEcart(manque[0])).toMatch(/aucune écriture de l’exercice ne la porte : son écriture s’écrit avec l’opération/)
    expect(ouAgir(manque[0])).toBe('Caisse')
    expect(manque[0].libelle).toBe('Recettes en espèces du 12/03/2026 — Honoraires')
    // Sur un autre compte (la catégorie a changé de compte de produit depuis) : à reprendre aussi, jamais « régénérer ».
    const autreCompte = brouillonDe(op).map((e) => (e.compte === '706000' ? { ...e, compte: '708000' } : e))
    const ecart = concordance2035(d, autreCompte, CONTEXTE, null).ecarts
    expect(ecart.map((e) => e.motif)).toEqual(['caisse_a_reprendre'])
    expect(phraseDeLEcart(ecart[0])).toMatch(/n’est plus celle de l’opération/)
    expect(LIBELLES_MOTIFS.caisse_a_reprendre).toBe('recette de caisse à reprendre')
  })

  it('une recette écrite que la 2035 ne compte pas : sans poste, la catégorie se règle ; plus un produit, à reprendre', () => {
    const sansPoste = operation({ id: 'r1', categorie_id: SANS_POSTE.id })
    const devenue = operation({ id: 'r2', categorie_id: HONORAIRES.id })
    const categoriesDApres = CATEGORIES.map((c) => (c.id === HONORAIRES.id ? { ...c, compte_comptable: '604000' } : c))
    const d = declaration2035(2026, caisseDe([sansPoste, devenue], false, categoriesDApres), false, categoriesDApres)
    const ecarts = concordance2035(d, [...brouillonDe(sansPoste), ...brouillonDe(devenue)], CONTEXTE, null).ecarts
    expect(Object.fromEntries(ecarts.map((e) => [e.cle, e.motif]))).toEqual({ 'caisse:r1': 'sans_poste', 'caisse:r2': 'caisse_a_reprendre' })
    const r2 = ecarts.find((e) => e.cle === 'caisse:r2')!
    expect(phraseDeLEcart(r2)).toMatch(/que la 2035 ne compte pas : sa catégorie n’est plus une catégorie de produit/)
    expect(ouAgir(ecarts.find((e) => e.cle === 'caisse:r1')!)).toBe('Clôture — Postes manquants')
  })

  it('la ligne d’une pièce que la caisse paie appartient à la pièce, jamais à l’opération', () => {
    // Une contrepartie au 530000 désigne la pièce et l'opération : hors résultat, elle ne touche pas la concordance.
    const c = concordance2035(declaration2035(2026, caisseDe([])), [
      ecriture({ id: 'x', piece_id: 'p1', operation_caisse_id: 'q1', compte: '530000', sens: 'credit', montant: 30, date: '2026-03-01' }),
    ], CONTEXTE, null)
    expect(c.ecarts).toEqual([])
  })
})

describe('la CA3', () => {
  const T1 = { debut: '2026-01-01', fin: '2026-03-31' }
  const donnees = (caisse: RecettesDeCaisse): DonneesTva => ({
    pieces: [], paiements: paiementsDesPieces([], [], []), pieceIdsImmobilisees: new Set(), releve: [], ventesFacturees: ventesFactureesVides(DOSSIER), caisse,
  })

  it('une recette d’un dossier assujetti à sa date et à son taux ; exonérée en E2 ; des espèces rendues comme un avoir', () => {
    const caisse = caisseDe([
      operation({ id: 'r1', date: '2026-01-15', montant: 120, taux_tva: 20 }),
      operation({ id: 'r2', date: '2026-02-15', montant: 105.5, taux_tva: 5.5 }),
      operation({ id: 'r3', date: '2026-03-01', montant: 300, taux_tva: 0 }),
      operation({ id: 'r4', date: '2026-03-02', montant: -60, taux_tva: 20 }),
      operation({ id: 'r5', date: '2026-04-01', montant: 1000, taux_tva: 20 }),
      operation({ id: 'a1', genre: 'apport', montant: 500, categorie_id: null, encaissements_du_jour: null, date: '2026-01-02' }),
    ], true)
    const ca3 = calculerCa3(donnees(caisse), T1, false, 0, 0)
    expect(ca3.caisseRetenues.map((r) => [r.recette.operationId, r.ligne])).toEqual([['r1', '08'], ['r2', '09'], ['r3', 'E2'], ['r4', 'B5']])
    expect(ca3.caisseEcartees).toEqual([])
    expect([ca3.cases.A1, ca3.cases.base08, ca3.cases.taxe08, ca3.cases.base09, ca3.cases.taxe09, ca3.cases.E2, ca3.cases.B5, ca3.cases.l21])
      .toEqual([200, 100, 20, 100, 6, 300, 50, 10])
    // La TVA des comptes : celle des écritures des opérations (20 + 5,50 − 10).
    expect(ca3.tvaDesComptes.collectee).toBe(15.5)
  })

  it('écarte, sous les motifs du relevé, une recette sans taux et toute recette sur option pour les débits', () => {
    const caisse = caisseDe([operation({ id: 'r1', date: '2026-01-15', montant: 120, taux_tva: null })], true)
    expect(calculerCa3(donnees(caisse), T1, false, 0, 0).caisseEcartees.map((e) => [e.recette.operationId, e.motif])).toEqual([['r1', 'sans_taux']])
    const taxee = caisseDe([operation({ id: 'r1', date: '2026-01-15', montant: 120, taux_tva: 20 })], true)
    const surDebits = calculerCa3(donnees(taxee), T1, true, 0, 0)
    expect(surDebits.caisseEcartees.map((e) => e.motif)).toEqual(['sur_debits'])
    expect(surDebits.cases.A1).toBe(0)
  })

  it('le recalcul d’une déclaration déposée lit la caisse ; absente, la CA3 d’hier', () => {
    const caisse = caisseDe([operation({ id: 'r1', date: '2026-01-15', montant: 120, taux_tva: 20 })], true)
    const declaration = { id: 'dt', periode_debut: T1.debut, periode_fin: T1.fin, tva_declaree: 0, credit_anterieur: 0, remboursement_demande: 0 }
    expect(comparerDeclarations([declaration as never], donnees(caisse), false)[0]).toMatchObject({ recalcul: 20, ecart: -20, enEcart: true })
    const absente = calculerCa3(donnees(CAISSE_ABSENTE), T1, false, 0, 0)
    expect([absente.caisseRetenues, absente.caisseEcartees, absente.neant]).toEqual([[], [], true])
  })
})

describe('la situation, l’estimation, le plan de trésorerie, la revue', () => {
  it('la situation compte la recette dans son poste, dans la période de sa date, et dit celle qu’aucune ligne ne porte', () => {
    const caisse = caisseDe([
      operation({ id: 'r1', date: '2026-01-15', montant: 120 }), operation({ id: 'r2', date: '2026-06-15', montant: 50 }),
      operation({ id: 'r3', date: '2026-01-20', montant: 9, categorie_id: SANS_POSTE.id }),
    ])
    const s = calculerSituationIntermediaire([], CATEGORIES, [], [], '2026-01-01', '2026-03-31', false, paiementsDesPieces([], [], []), 'tresorerie', [],
      ventesFactureesVides(DOSSIER), PLAN_PAR_DEFAUT, { etat: 'sans_bascule' }, caisse)
    expect(s.totauxParPoste).toEqual([[HONORAIRES.poste_2035, 120]])
    expect([s.recettes, s.resultat]).toEqual([120, 120])
    expect(s.recettesDeCaisseSansPoste.map((r) => r.operationId)).toEqual(['r3'])
    const absente = calculerSituationIntermediaire([], CATEGORIES, [], [], '2026-01-01', '2026-03-31', false, paiementsDesPieces([], [], []), 'tresorerie', [],
      ventesFactureesVides(DOSSIER), PLAN_PAR_DEFAUT, { etat: 'sans_bascule' }, CAISSE_ABSENTE)
    expect([absente.totauxParPoste, absente.recettesDeCaisseSansPoste]).toEqual([[], []])
  })

  it('l’estimation compte les recettes de produit au chiffre d’affaires ; non comptées ou absentes, rien', () => {
    const caisse = caisseDe([
      operation({ id: 'r1', date: '2026-01-15', montant: 120, taux_tva: 20 }), operation({ id: 'r2', date: '2025-12-15', montant: 50 }),
      operation({ id: 'r3', date: '2026-01-20', montant: 9, categorie_id: DEVENUE_CHARGE.id }),
    ], true)
    const totaux = (c: Parameters<typeof totauxPourAnnee>[8]) =>
      totauxPourAnnee([], [], 2026, true, paiementsDesPieces([], [], []), 'tresorerie', [], RECETTES_FACTUREES_NON_COMPTEES, c).ca
    expect(totaux(caisse)).toBe(100)
    expect(totaux(RECETTES_DE_CAISSE_NON_COMPTEES)).toBe(0)
    expect(totaux(CAISSE_ABSENTE)).toBe(0)
    expect(centimesDesRecettesDeCaisse(caisse, '2025-01-01', '2025-12-31')).toBe(5000)
    expect(projectionAnnuelle([], [], '2026-02-01', true, paiementsDesPieces([], [], []), 'tresorerie', [], RECETTES_FACTUREES_NON_COMPTEES, caisse).ca).toBe(100)
  })

  it('la simulation du client ne lit pas la caisse : absente le drapeau baissé, non comptée et dite levé, en trésorerie seulement', () => {
    expect(recettesDeCaisseDuClient(false)).toBe(CAISSE_ABSENTE)
    expect(recettesDeCaisseDuClient(true)).toBe(RECETTES_DE_CAISSE_NON_COMPTEES)
    expect(simulationDitNePasCompterLaCaisse(recettesDeCaisseDuClient(false), 'tresorerie')).toBe(false)
    expect(simulationDitNePasCompterLaCaisse(recettesDeCaisseDuClient(true), 'tresorerie')).toBe(true)
    expect(simulationDitNePasCompterLaCaisse(recettesDeCaisseDuClient(true), 'engagement')).toBe(false)
    expect(SIMULATION_SANS_CAISSE).not.toMatch(/onglet|vous/i)
  })

  it('le plan de trésorerie reçoit les espèces reçues comme des encaissements, des espèces rendues comme un décaissement', () => {
    const caisse = caisseDe([
      operation({ id: 'r1', date: '2026-01-15', montant: 120, taux_tva: 20 }), operation({ id: 'r2', date: '2026-01-16', montant: -20 }),
      operation({ id: 'a1', genre: 'apport', montant: 500, categorie_id: null, encaissements_du_jour: null }),
    ], true)
    expect(lignesDeLaCaissePourLePlan(caisse)).toEqual([
      { date: '2026-01-15', sens: 'debit', montant: 120 }, { date: '2026-01-16', sens: 'credit', montant: 20 },
    ])
    expect(lignesDeLaCaissePourLePlan(CAISSE_ABSENTE)).toEqual([])
  })

  it('la revue compare la 2035 de Clôture, caisse comprise, et n’en a pas sans elle', () => {
    const caisse = caisseDe([operation({ id: 'r1', date: '2025-06-15', montant: 70 })])
    const lectures = {
      piecesValidees: [], categories: CATEGORIES, immobilisations: [], cotisations: [], vehicules: [], lignes: [], ventilations: [],
      reglements: [], declarationsTva: [], ecritures: [],
    }
    const avec = declarationPourLaRevue(2025, MODELE, false, lectures, ventesFactureesVides(DOSSIER), { etat: 'sans_bascule' }, [], caisse)
    expect(avec?.totalRecettes).toBe(70)
    const sources = {
      dossier: lectures, reprise: [], reportes: [], exercicesValides: [], reperes: { annuels: [], postes: [] }, seuils: [], explications: [],
      ventesFacturees: ventesFactureesVides(DOSSIER), encaissees: [], ecrituresDesVentes: { etat: 'sans_bascule' as const },
    }
    expect(donneesDeLaRevueAnalytique(2025, 2026, MODELE, false, { ...sources, recettesDeCaisse: caisse }).declaration).toEqual(avec)
    expect(donneesDeLaRevueAnalytique(2025, 2026, MODELE, false, { ...sources, recettesDeCaisse: null }).declaration).toBeNull()
  })
})

describe('l’instantané validé', () => {
  const entete = { nom: 'Cabinet fictif', activite: 'Soins fictifs', siret: null }
  const instantaneDe = (d: Declaration2035) => {
    const { valeurs } = valeursDesCases(d)
    return instantane2035(d, valeurs, arrondirPourFormulaire(valeurs, d.annee), entete)
  }

  it('d’une 2035 qui a lu la caisse : la version 3, chaque poste avec ses opérations de caisse, relue telle quelle', () => {
    const i = instantaneDe(declaration2035(2026, caisseDe([operation({ id: 'r1' }), operation({ id: 'r2', montant: 5 })])))
    expect(i.version).toBe(3)
    expect(i.postes).toEqual([{ poste: HONORAIRES.poste_2035, nature: 'recette', montant: 105, nbPieces: 0, nbMouvements: 0, nbEncaissements: 0, nbOperationsDeCaisse: 2 }])
    const relu = lireInstantane2035(JSON.parse(JSON.stringify(i)))
    expect(relu).toEqual(i)
    expect(postesDeLInstantane(relu!)).toEqual([
      { poste: HONORAIRES.poste_2035, nature: 'recette', montant: 105, nbPieces: 0, nbMouvements: 0, nbEncaissements: 0, nbOperationsDeCaisse: 2 },
    ])
    // Sans son compte de caisse, ou un compte qui n'en est pas un, la version 3 se refuse.
    const sans = {
      ...i,
      postes: (i.postes as unknown as Record<string, unknown>[]).map((p) => Object.fromEntries(Object.entries(p).filter(([cle]) => cle !== 'nbOperationsDeCaisse'))),
    }
    expect(lireInstantane2035(JSON.parse(JSON.stringify(sans)))).toBeNull()
    expect(lireInstantane2035({ ...i, postes: [{ ...i.postes[0], nbOperationsDeCaisse: -1 }] })).toBeNull()
    expect(lireInstantane2035({ ...i, postes: [{ ...i.postes[0], nbOperationsDeCaisse: 1.5 }] })).toBeNull()
    expect(lireInstantane2035({ ...i, version: 4 })).toBeNull()
  })

  it('d’une caisse absente : la version 2 d’hier, au caractère près, et une version 2 relue ne dit pas d’opérations de caisse', () => {
    const d = calculerDeclaration2035(
      2026, [{ ...piecePayee(), categorie_id: HONORAIRES.id }], CATEGORIES, [], [], [], false, paiementsDesPieces([], [], []), [], [],
      PLAN_PAR_DEFAUT, ventesFactureesVides(DOSSIER), { etat: 'sans_bascule' }, CAISSE_ABSENTE,
    )
    const i = instantaneDe(d)
    expect(i.version).toBe(2)
    expect(JSON.stringify(i.postes)).toBe(JSON.stringify([
      { poste: HONORAIRES.poste_2035, nature: 'recette', montant: 50, nbPieces: 1, nbMouvements: 0, nbEncaissements: 0 },
    ]))
    expect(postesDeLInstantane(lireInstantane2035(i)!)[0]).not.toHaveProperty('nbOperationsDeCaisse')
    // Une 2035 sans aucune ligne s'écrit en version 2 : elle n'a rien à compter.
    expect(instantaneDe(declaration2035(2026, caisseDe([]))).version).toBe(2)
  })
})

// UN TIRAGE (src/test/encaissementsBatterie.ts) : des recettes au hasard — montants, signes, taux, dates, catégories —, et
// à chaque fois la 2035 compte au poste ce que l'écriture composée par la base porte au produit, la concordance est nulle,
// et la CA3 retrouve base et taxe du total des espèces.
describe('au hasard', () => {
  it('300 caisses tirées : la 2035, la concordance et la CA3 tiennent au centime', () => {
    const suivant = tirage(20261030)
    const TAUX = [0, 5.5, 8.5, 10, 20]
    const PRODUITS = [HONORAIRES, PRODUITS_FINANCIERS, GAINS]
    for (let cas = 0; cas < 300; cas++) {
      const assujetti = suivant() < 0.5
      const ops: OperationCaisse[] = []
      const n = 1 + entierTire(suivant, 12)
      for (let i = 0; i < n; i++) {
        const centimes = (1 + entierTire(suivant, 500_000)) * (suivant() < 0.15 ? -1 : 1)
        ops.push(operation({
          id: `c${cas}-r${i}`, date: `2026-0${1 + entierTire(suivant, 3)}-${String(1 + entierTire(suivant, 28)).padStart(2, '0')}`,
          montant: centimes / 100, categorie_id: PRODUITS[entierTire(suivant, PRODUITS.length)].id,
          taux_tva: assujetti ? TAUX[entierTire(suivant, TAUX.length)] : null,
        }))
      }
      const caisse = caisseDe(ops, assujetti)
      const d = declaration2035(2026, caisse, assujetti)
      const brouillon = ops.flatMap((o) => brouillonDe(o, CATEGORIES, assujetti))
      // Le produit de chaque écriture, signé comme l'effet sur le résultat.
      const produitEcrit = brouillon.filter((e) => e.compte.startsWith('7'))
        .reduce((s, e) => s + (e.sens === 'credit' ? 1 : -1) * Math.round(e.montant * 100), 0)
      const contribue = d.contributions.reduce((s, c) => s + c.centimes, 0)
      if (contribue !== produitEcrit) throw new Error(`cas ${cas} : la 2035 compte ${contribue}, les écritures ${produitEcrit}`)
      const c = concordance2035(d, brouillon, CONTEXTE, null)
      if (!c.concorde) throw new Error(`cas ${cas} : ${JSON.stringify(c.ecarts.map((e) => [e.cle, e.motif]))}`)
      if (assujetti) {
        const ca3 = calculerCa3({
          pieces: [], paiements: paiementsDesPieces([], [], []), pieceIdsImmobilisees: new Set(), releve: [], ventesFacturees: ventesFactureesVides(DOSSIER), caisse,
        }, { debut: '2026-01-01', fin: '2026-03-31' }, false, 0, 0)
        // La TVA des comptes est exactement celle que les écritures portent au 445710.
        const tvaEcrite = brouillon.filter((e) => e.compte === PLAN_PAR_DEFAUT.tva_collectee)
          .reduce((s, e) => s + (e.sens === 'credit' ? 1 : -1) * Math.round(e.montant * 100), 0)
        if (Math.round(ca3.tvaDesComptes.collectee * 100) !== tvaEcrite) throw new Error(`cas ${cas} : TVA ${ca3.tvaDesComptes.collectee} contre ${tvaEcrite}`)
        if (ca3.caisseRetenues.length !== ops.length) throw new Error(`cas ${cas} : ${ca3.caisseRetenues.length} retenues sur ${ops.length}`)
      }
    }
  })
})
