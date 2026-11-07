// LE BANC DE CHARGE D'UNE ANNÉE — combien de temps prennent les calculs que les écrans refont à chaque affichage, sur une
// année FICTIVE à l'échelle d'un praticien BNC, avant que les données réelles du premier dossier entrent (MVP-D6).
//
// Mode d'emploi, depuis la racine du dépôt (`tsx` n'est pas une dépendance : le lanceur passe par Vite, déjà installé) :
//
//     node outils/charge/lancer.mjs            # l'année N, puis 2N
//     node outils/charge/lancer.mjs 1 2 4      # d'autres facteurs de volume
//
// (`npx tsx outils/charge/annee.mts` marche aussi là où `tsx` est installé.) Le banc n'entre pas dans `npm test` : un temps
// mesuré dans la CI serait instable. Il est type-vérifié par `npx tsc -b` (tsconfig.app.json l'inclut), pour que chaque
// moteur y soit appelé avec ses VRAIS paramètres obligatoires, comme l'écran qui l'appelle.
//
// Les données sont FICTIVES, tirées d'une graine fixe (mulberry32), sans aucun nom réel : « Fournisseur 17 », « Client 4 ».
// Volumes de l'année N : 600 pièces (85 % de dépenses, 15 % de ventes), 1 200 mouvements dont 900 rapprochés (pièces,
// cotisations, encaissements de factures, catégories), 150 factures sources et leurs encaissements (dossier basculé), une
// caisse tenue 250 jours (une recette par jour, 40 sorties dont 20 paiements de pièces), 60 échéances de cotisations,
// 10 immobilisations ; le brouillon est COMPOSÉ par les moteurs de l'application (pièces, caisse, ventes facturées), jamais
// inventé ligne à ligne. Chaque mesure est la médiane de cinq passes, en millisecondes, après une passe de chauffe.

import { analyserAppariements, candidatsPieces } from '../../src/lib/appariementBanque'
import { bilanDeLExercice } from '../../src/lib/bilan'
import { ecritureDeLOperation, soldesDeLaCaisse, premierJourNegatif, type EtatDeLaCaisse } from '../../src/lib/caisse'
import { caisseRejouee, type JourDeLaCaisseDuClient } from '../../src/lib/caisseClient'
import { cotisationsComptees } from '../../src/lib/cotisationRapprochee'
import { concordance2035 } from '../../src/lib/concordance2035'
import { calculerDeclaration2035 } from '../../src/lib/declaration2035'
import { mouvementsClassesParEncaissements } from '../../src/lib/ecrituresVentesFactureesEcran'
import { calculerCa3 } from '../../src/lib/declarationTva'
import { doublonsProbables, piecesRegleesPourLesDoublons } from '../../src/lib/doublonsProbables'
import { calculerBalance, ecrituresAGenerer, piecesAComptabiliser } from '../../src/lib/ecritures'
import { ecrituresDesVentesPourLa2035, type EncaissementDesEcritures, type FactureDesEcritures, type SourcesDesEcrituresDeVente } from '../../src/lib/ecrituresVentesFactureesEcran'
import type { LigneDeFacture } from '../../src/lib/encaissementsFactures'
import { CHAMPS_BNC_NON_EXPORTES, formaterFec, numeroterFec } from '../../src/lib/fec'
import { lettrages } from '../../src/lib/lettrage'
import { partsDuReleve } from '../../src/lib/partsDuReleve'
import { pisteAudit } from '../../src/lib/pisteAudit'
import { pointsDeLaChecklist } from '../../src/lib/pointsDeLaChecklist'
import { prealablesDeValidation } from '../../src/lib/prealablesValidation'
import { ventesDeLaChecklist } from '../../src/lib/ventesDeLaChecklist'
import { etatsDesVentesFacturees } from '../../src/lib/ecrituresVentesFactureesEcran'
import { paiementsDesPieces } from '../../src/lib/rattachement'
import { calculerSituationIntermediaire } from '../../src/lib/situationIntermediaire'
import type { Categorie, CotisationDeclaree, EcritureBrouillon, Immobilisation, LigneBancaire, OperationCaisse, Piece } from '../../src/lib/types'
import { SANS_ACOMPTE, ventesFacturees, type PartVendue } from '../../src/lib/ventesFacturees'
import { lignesAuBrouillon, ecrituresDesVentesFacturees } from '../../src/lib/ecrituresVentesFacturees'
import { recettesDeCaisseDuDossier, recettesPourLesMoteurs, type CaisseLue } from '../../src/lib/recettesDeCaisse'
import { operationsDeCaisseDuDossier, operationsPourLesControles } from '../../src/lib/controlesDeLaCaisse'
import { paiementsParLaCaisseDuDossier } from '../../src/lib/paiementParLaCaisse'
import { NON_VALIDEE } from '../../src/test/ecritures'
import { modeleDeTest } from '../../src/test/modeles'
import { factureVendue } from '../../src/test/ventesFacturees'

const D = 'd-charge'
const ANNEE = 2026
const MODELE = modeleDeTest('tresorerie')
const PLAN = MODELE.plan

// ── Le tirage, d'une graine fixe ─────────────────────────────────────────────────────────────────────────────────────
function mulberry32(graine: number): () => number {
  let a = graine >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const deux = (n: number) => String(n).padStart(2, '0')
const centimes = (x: number) => Math.round(x * 100) / 100
const uuid = (genre: number, n: number) => `00000000-0000-4000-8${deux(genre % 100).padStart(3, '0')}-${String(n).padStart(12, '0')}`

function jourDeLAnnee(rang: number): string {
  const d = new Date(Date.UTC(ANNEE, 0, 1 + rang))
  return `${d.getUTCFullYear()}-${deux(d.getUTCMonth() + 1)}-${deux(d.getUTCDate())}`
}

// ── Les catégories, neutres ──────────────────────────────────────────────────────────────────────────────────────────
const CATEGORIES: Categorie[] = [
  ['achats', 'Achats', '606100', 'Achats'],
  ['fournitures', 'Fournitures de bureau', '606400', 'Fournitures de bureau'],
  ['loyers', 'Loyers', '613200', 'Loyers et charges locatives'],
  ['honoraires', 'Honoraires', '622600', 'Honoraires ne constituant pas des rétrocessions'],
  ['telecom', 'Télécommunications', '626000', 'Frais postaux et de télécommunications'],
  ['frais_fin', 'Frais bancaires', '627000', 'Frais financiers'],
  ['divers', 'Divers', '618000', 'Autres frais divers de gestion'],
  ['recettes', 'Recettes', '706000', 'Recettes'],
].map(([code, libelle, compte, poste], i): Categorie => ({
  id: `cat-${code}`, dossier_id: null, code, libelle, ordre: i, compte_comptable: compte, poste_2035: poste,
}))
const DEPENSES = CATEGORIES.filter((c) => c.code !== 'recettes')
const RECETTES = CATEGORIES.find((c) => c.code === 'recettes')!

// ── Une année, au facteur de volume `k` ──────────────────────────────────────────────────────────────────────────────
interface Annee {
  pieces: Piece[]
  lignes: LigneBancaire[]
  cotisations: CotisationDeclaree[]
  immobilisations: Immobilisation[]
  operations: OperationCaisse[]
  factures: FactureDesEcritures[]
  lignesDeFacture: LigneDeFacture[]
  encaissements: EncaissementDesEcritures[]
  parts: PartVendue[]
}

function piece(o: Partial<Piece> & Pick<Piece, 'id'>): Piece {
  return {
    dossier_id: D, uploaded_by: null, source: 'upload', storage_path: `${D}/${o.id}.pdf`, nom_fichier: 'piece.pdf', storage_hash: null,
    date_piece: `${ANNEE}-01-01`, tiers: null, montant_ht: 0, montant_tva: 0, montant_ttc: 0, devise: 'EUR',
    montant_devise: null, taux_change: null, conversion_source: null, categorie_id: null, sous_dossier_id: null, type_piece: 'achat',
    statut: 'validee', confiance: 'haute', superpdp_invoice_id: null, flux_hote: null, flux_id: null, lisible_path: null,
    identite_numero: null, identite_siren_vendeur: null, identite_date: null, identite_nature: null, facture_id: null, vente_hors_des_factures: false, updated_at: `${ANNEE}-01-01T10:00:00Z`,
    created_at: `${ANNEE}-01-01T10:00:00Z`, ...o,
  }
}

function mouvement(o: Partial<LigneBancaire> & Pick<LigneBancaire, 'id'>): LigneBancaire {
  return {
    dossier_id: D, date: `${ANNEE}-01-01`, libelle: 'OPERATION', montant: 0,
    statut: 'non_rapprochee', piece_id: null, cotisation_id: null, categorie_id: null, taux_tva: null, prelevement_personnel: false,
    emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false, reglement_groupe: false,
    compte_bilan: null, declaration_tva_id: null, id_externe: null, source_fichier: 'releve.csv', libelle_brut: null,
    created_at: `${ANNEE}-12-31T10:00:00Z`, encaissements_de_factures: false, ...o,
  }
}

function genererAnnee(k: number, assujetti: boolean): Annee {
  const hasard = mulberry32(20261107 + k)
  const entre = (a: number, b: number) => a + Math.floor(hasard() * (b - a + 1))
  const montant = (a: number, b: number) => centimes(a + hasard() * (b - a))
  const nbPieces = 600 * k
  const pieces: Piece[] = []
  for (let i = 0; i < nbPieces; i++) {
    const vente = i % 20 < 3 // 15 %
    const ttc = vente ? montant(40, 900) : montant(5, 1500)
    const taux = assujetti ? 0.2 : 0
    const ht = centimes(ttc / (1 + taux))
    const categorie = vente ? RECETTES : DEPENSES[entre(0, DEPENSES.length - 1)]
    pieces.push(piece({
      id: uuid(1, i), date_piece: jourDeLAnnee(entre(0, 360)), tiers: vente ? `Client ${entre(1, 80 * k)}` : `Fournisseur ${entre(1, 120 * k)}`,
      montant_ttc: ttc, montant_ht: ht, montant_tva: centimes(ttc - ht), categorie_id: categorie.id, type_piece: vente ? 'vente' : 'achat',
    }))
  }

  // Les mouvements : 900 rapprochés sur 1 200, au facteur près.
  const lignes: LigneBancaire[] = []
  let n = 0
  const parCaisse = new Set(pieces.slice(0, 20 * k).map((p) => p.id)) // les 20 sorties de caisse qui paient une pièce
  const payees = pieces.filter((p) => !parCaisse.has(p.id)).slice(0, 540 * k)
  for (const p of payees) {
    const signe = p.type_piece === 'vente' ? 1 : -1
    const jour = Math.min(364, entre(0, 6) + Number(new Date(`${p.date_piece}T00:00:00Z`).getTime() - Date.UTC(ANNEE, 0, 1)) / 86_400_000)
    lignes.push(mouvement({
      id: uuid(2, n++), date: jourDeLAnnee(jour), montant: signe * (p.montant_ttc ?? 0), libelle: `CB ${p.tiers?.toUpperCase()}`,
      statut: 'rapprochee', piece_id: p.id,
    }))
  }
  const cotisations: CotisationDeclaree[] = []
  for (let i = 0; i < 60 * k; i++) {
    const appele = montant(150, 900)
    const echeance = jourDeLAnnee(Math.floor((i % 60) * 6) + 2)
    cotisations.push({
      id: uuid(3, i), dossier_id: D, echeance, montant_appele: appele, montant_verse: appele, montant_csg_crds: centimes(appele * 0.3),
      previsionnel: false, created_at: `${ANNEE}-01-01T10:00:00Z`, paiement_personnel_le: null,
    })
    lignes.push(mouvement({ id: uuid(2, n++), date: echeance, montant: -appele, libelle: 'PRLV ORGANISME SOCIAL', statut: 'rapprochee', cotisation_id: uuid(3, i) }))
  }
  // Les factures sources et leurs encaissements, chacune réglée par un virement classé par ses encaissements.
  const factures: Annee['factures'] = []
  const lignesDeFacture: LigneDeFacture[] = []
  const encaissements: EncaissementDesEcritures[] = []
  const parts: PartVendue[] = []
  for (let i = 0; i < 150 * k; i++) {
    const id = uuid(4, i)
    const emission = jourDeLAnnee(Math.floor((i / (150 * k)) * 330))
    const ht = montant(60, 1200)
    const taux = assujetti ? 20 : 0
    const ttc = centimes(ht * (1 + taux / 100))
    factures.push({
      ...factureVendue({ id, dossier_id: D, numero: `F${ANNEE}-${String(i + 1).padStart(4, '0')}`, date_emission: emission, tiers_nom: `Client ${i % 80}` }),
      montant_ttc: ttc,
    })
    lignesDeFacture.push({ facture_id: id, ordre: 1, designation: 'Prestation', quantite: 1, prix_unitaire_ht: ht, taux_tva: taux })
    const ligneId = uuid(2, n++)
    const date = jourDeLAnnee(Math.min(364, Math.floor((i / (150 * k)) * 330) + entre(5, 30)))
    lignes.push(mouvement({ id: ligneId, date, montant: ttc, libelle: 'VIR RECU', statut: 'rapprochee', encaissements_de_factures: true }))
    const enc: EncaissementDesEcritures = {
      id: uuid(5, i), dossier_id: D, facture_id: id, date_encaissement: date, montant: ttc, moyen: 'virement', ligne_bancaire_id: ligneId,
      annule_id: null, cree_le: `${date}T10:00:00Z`, retire_le: null, cree_par: null, compte_contrepartie: null,
    }
    encaissements.push(enc)
    parts.push({ encaissement_id: enc.id, dossier_id: D, taux, montant: ttc })
  }
  // Les mouvements classés par une catégorie (frais bancaires, recettes sans pièce), puis les mouvements libres.
  while (lignes.length < 900 * k) {
    const recette = hasard() < 0.4
    lignes.push(mouvement({
      id: uuid(2, n++), date: jourDeLAnnee(entre(0, 364)), montant: recette ? montant(20, 300) : -montant(1, 40),
      libelle: recette ? 'VIR ORGANISME' : 'FRAIS TENUE DE COMPTE', statut: 'rapprochee',
      categorie_id: recette ? RECETTES.id : 'cat-frais_fin', taux_tva: assujetti && recette ? 20 : null,
    }))
  }
  // Les mouvements libres : d'abord ceux d'une pièce que rien ne paie encore (son montant, quelques jours après), comme sur
  // un vrai relevé, puis des mouvements sans pièce.
  const payeesIds = new Set([...payees.map((p) => p.id), ...parCaisse])
  for (const p of pieces.filter((x) => !payeesIds.has(x.id))) {
    const jour = Math.min(364, entre(0, 6) + (Date.parse(`${p.date_piece}T00:00:00Z`) - Date.UTC(ANNEE, 0, 1)) / 86_400_000)
    lignes.push(mouvement({ id: uuid(2, n++), date: jourDeLAnnee(jour), montant: (p.type_piece === 'vente' ? 1 : -1) * (p.montant_ttc ?? 0), libelle: `CB ${p.tiers?.toUpperCase()}` }))
  }
  while (lignes.length < 1200 * k) {
    const credit = hasard() < 0.3
    lignes.push(mouvement({
      id: uuid(2, n++), date: jourDeLAnnee(entre(0, 364)), montant: credit ? montant(10, 800) : -montant(5, 1500),
      libelle: credit ? `VIR RECU ${entre(1, 500)}` : `CB MAGASIN ${entre(1, 500)}`,
    }))
  }

  // La caisse : une recette par jour tenu (250), 40 sorties dont 20 paiements de pièces.
  const operations: OperationCaisse[] = []
  let o = 0
  const operation = (x: Partial<OperationCaisse> & Pick<OperationCaisse, 'genre' | 'date' | 'montant'>): OperationCaisse => ({
    id: uuid(6, o++), dossier_id: D, categorie_id: null, taux_tva: null, encaissements_du_jour: null, piece_id: null,
    origine: 'cabinet', remplace_id: null, cree_le: `${x.date}T18:00:00Z`, cree_par: null, retire_le: null, retire_par: null, ...x,
  })
  for (let r = 0; r < 250 * k; r++) {
    operations.push(operation({ genre: 'recette', date: jourDeLAnnee(Math.floor(r * 364 / (250 * k))), montant: montant(30, 200), categorie_id: RECETTES.id, taux_tva: assujetti ? 20 : null, encaissements_du_jour: [] }))
  }
  for (const id of parCaisse) {
    const p = pieces.find((x) => x.id === id)!
    operations.push(operation({ genre: 'paiement', date: p.date_piece ?? `${ANNEE}-06-01`, montant: p.montant_ttc ?? 0, piece_id: id }))
  }
  for (let s = 0; s < 20 * k; s++) operations.push(operation({ genre: 'prelevement', date: jourDeLAnnee(10 + s * Math.floor(17 / k)), montant: montant(20, 80) }))

  const immobilisations: Immobilisation[] = []
  for (let i = 0; i < 10 * k; i++) {
    const p = pieces[30 + i]
    immobilisations.push({
      id: uuid(7, i), dossier_id: D, piece_id: p.id, nature_id: null, libelle: `Bien ${i + 1}`, valeur: p.montant_ttc ?? 0,
      date_acquisition: p.date_piece ?? `${ANNEE}-01-01`, date_mise_en_service: p.date_piece, duree_annees: 5, created_at: `${ANNEE}-01-01T10:00:00Z`,
    })
  }
  return { pieces, lignes, cotisations, immobilisations, operations, factures, lignesDeFacture, encaissements, parts }
}

// ── La mesure ────────────────────────────────────────────────────────────────────────────────────────────────────────
function mediane<R>(passes: number, f: () => R): { ms: number; rendu: R } {
  const rendu = f() // la chauffe, dont le rendu se résume : une mesure ne doit pas être celle d'un retour anticipé
  const temps: number[] = []
  for (let i = 0; i < passes; i++) {
    const debut = performance.now()
    f()
    temps.push(performance.now() - debut)
  }
  temps.sort((a, b) => a - b)
  return { ms: temps[Math.floor(passes / 2)], rendu }
}

// Ce que rend un moteur, en quelques mots : une liste sa longueur, un texte ses lignes, un état son nom.
function resumer(r: unknown): string {
  if (Array.isArray(r)) return `${r.length} éléments`
  if (r instanceof Map || r instanceof Set) return `${r.size} entrées`
  if (typeof r === 'string') return `${r.split('\n').length} lignes`
  if (r !== null && typeof r === 'object' && 'etat' in r) return `état ${String(r.etat)}`
  return `${JSON.stringify(r)?.length ?? 0} octets`
}

function mesurer(k: number): Map<string, number | string> {
  const resultats = new Map<string, number | string>()
  const t = <R,>(nom: string, f: () => R, resume: (r: R) => string = resumer) => {
    const { ms, rendu } = mediane(5, f)
    resultats.set(nom, Math.round(ms * 10) / 10)
    resultats.set(`  rendu — ${nom}`, resume(rendu))
  }

  for (const assujetti of [false, true]) {
    const a = genererAnnee(k, assujetti)
    // La chaîne de l'onglet Clôture (pages/dossier/ClotureTab.tsx), dans son ordre, sur des lectures faites en entier.
    const caisseLue: CaisseLue = { dossierId: D, enBase: true, lignes: a.operations, complete: true, motif: null }
    const recettesDeCaisse = recettesPourLesMoteurs(recettesDeCaisseDuDossier(caisseLue, D, CATEGORIES, assujetti))
    const operationsDeCaisse = operationsPourLesControles(operationsDeCaisseDuDossier(caisseLue, D))
    const paiementsDeLaCaisse = paiementsParLaCaisseDuDossier(caisseLue, D)
    if (recettesDeCaisse === null || operationsDeCaisse === null || paiementsDeLaCaisse === null) throw new Error('La caisse fictive ne se lit pas.')
    const paiements = paiementsDesPieces(a.lignes, [], [], paiementsDeLaCaisse)
    const parts = partsDuReleve(a.lignes, CATEGORIES, [], assujetti)
    const comptees = cotisationsComptees(a.cotisations, a.lignes, MODELE.mode)
    const sourcesVentes = { dossierId: D, factures: a.factures, lignes: a.lignesDeFacture, encaissements: a.encaissements, parts: a.parts, acomptes: SANS_ACOMPTE }
    const ventes = ventesFacturees(sourcesVentes)
    const mouvementsDesEncaissements = a.lignes.filter((l) => l.encaissements_de_factures)
    const sourcesEcritures: SourcesDesEcrituresDeVente = {
      dossierId: D, factures: a.factures, lignes: a.lignesDeFacture, encaissements: a.encaissements, parts: a.parts,
      mouvements: mouvementsDesEncaissements, exemplaires: [],
    }
    const pourLa2035 = ecrituresDesVentesPourLa2035({
      dossierId: D, ventesParLesFactures: true, facturesSources: ventes.sources, lecture: { dossierId: D, etat: 'lue', sources: sourcesEcritures },
      mode: MODELE.mode, plan: PLAN,
    })
    if (pourLa2035.etat !== 'pret') throw new Error(`Les écritures des ventes ne sont pas prêtes : ${pourLa2035.etat}`)

    // Le brouillon, composé par les moteurs : les pièces (leur paiement par le relevé ou la caisse compris), les recettes,
    // apports et prélèvements de la caisse, les ventes facturées.
    const aComptabiliser = piecesAComptabiliser(a.pieces, CATEGORIES, new Map(), ventes.sources)
    const generation = ecrituresAGenerer(D, aComptabiliser, [], assujetti, paiements, MODELE, null)
    let e = 0
    const ecriture = (x: Pick<EcritureBrouillon, 'dossier_id' | 'date' | 'compte' | 'libelle' | 'montant' | 'sens'> & Partial<EcritureBrouillon>): EcritureBrouillon => ({
      ...NON_VALIDEE, id: uuid(8, e++), statut: 'proposee', created_at: `${ANNEE}-12-31T10:00:00Z`, piece_id: null, ligne_bancaire_id: null,
      immobilisation_id: null, vehicule_id: null, declaration_tva_id: null, cotisation_id: null, encaissement_id: null, facture_id: null,
      operation_caisse_id: null, ...x,
    })
    const brouillon: EcritureBrouillon[] = generation.lignes.map((l) => ecriture(l))
    for (const op of a.operations) {
      if (op.genre === 'paiement') continue
      const aEcrire = { genre: op.genre, date: op.date, montant: op.montant, taux_tva: op.taux_tva, categorie: op.genre === 'recette' ? RECETTES : null }
      for (const l of ecritureDeLOperation(aEcrire, MODELE)) brouillon.push(ecriture({ dossier_id: D, date: op.date, ...l, operation_caisse_id: op.id }))
    }
    const composition = ecrituresDesVentesFacturees({
      sources: { dossierId: D, factures: a.factures, lignes: a.lignesDeFacture, encaissements: a.encaissements, parts: a.parts },
      mouvements: mouvementsDesEncaissements, comptesDeContrepartie: new Map(), exemplaires: [], mode: MODELE.mode, plan: PLAN,
    })
    for (const v of composition.ecritures) for (const l of lignesAuBrouillon(D, v)) brouillon.push(ecriture(l))
    resultats.set(`brouillon (${assujetti ? 'assujetti' : 'exonéré'})`, `${brouillon.length} lignes`)

    if (!assujetti) {
      const d2035 = () => calculerDeclaration2035(ANNEE, a.pieces, CATEGORIES, a.immobilisations, comptees, [], assujetti, paiements, parts, [], PLAN, ventes, pourLa2035.ecritures, recettesDeCaisse)
      t('2035 complète', d2035, (r) => `recettes ${r.totalRecettes}, dépenses ${r.totalDepenses}, exclusions ${JSON.stringify(r.exclusions).length} octets`)
      // La concordance que l'onglet Clôture calcule et que les préalables reçoivent (ClotureTab, `concordances`).
      const declaration = d2035()
      const contexteConcordance = {
        piecesValidees: new Set(a.pieces.map((p) => p.id)), piecesImmobilisees: new Set(a.immobilisations.map((i) => i.piece_id ?? '')),
        mouvementsDesVentesFacturees: mouvementsClassesParEncaissements(a.lignes),
      }
      t('concordance 2035 ↔ écritures', () => concordance2035(declaration, brouillon, contexteConcordance, null))
      const concordance = concordance2035(declaration, brouillon, contexteConcordance, null)
      t('paiementsDesPieces', () => paiementsDesPieces(a.lignes, [], [], paiementsDeLaCaisse))
      const libres = a.lignes.filter((l) => l.statut === 'non_rapprochee')
      const validees = a.pieces.filter((p) => p.statut === 'validee')
      const rapprochees = new Set(paiements.keys())
      t('candidats de chaque mouvement (candidatsPieces)', () => libres.map((l) => candidatsPieces(l, validees, rapprochees, ventes.sources)[0] ?? null), (r) => `${r.filter(Boolean).length} proposées sur ${r.length}`)
      t('analyserAppariements (le lot)', () => analyserAppariements(validees.filter((p) => !rapprochees.has(p.id)), a.lignes, ventes.sources))
      t('FEC (numérotation et format)', () => formaterFec(numeroterFec(brouillon, a.pieces, CATEGORIES, [], MODELE, a.lignes, composition.ecritures, operationsDeCaisse, CHAMPS_BNC_NON_EXPORTES), new Map(), MODELE.mode))
      t('piste d\'audit', () => pisteAudit(brouillon, a.pieces, a.lignes, [], {
        immobilisations: a.immobilisations, factures: a.pieces, vehicules: [], caisse: operationsDeCaisse, plan: PLAN,
        ventes: { ecritures: composition.ecritures, factures: a.factures, encaissements: a.encaissements, exemplaires: [], transmissions: [] },
      }))
      t('balance', () => calculerBalance(brouillon, CATEGORIES, []))
      t('bilan', () => bilanDeLExercice({ exercice: ANNEE, ecritures: brouillon, categories: CATEGORIES, reprise: [], reportes: [], anneesValidees: [], pieces: a.pieces, modele: MODELE, aujourdHui: `${ANNEE}-11-07` }))
      t('lettrage', () => lettrages(brouillon, a.pieces, [], MODELE, { factures: a.factures, encaissements: a.encaissements, ecritures: composition.ecritures }))
      t('doublons probables', () => doublonsProbables(a.pieces, assujetti, piecesRegleesPourLesDoublons(paiements)))
      t('ventes facturées', () => ventesFacturees(sourcesVentes), (r) => `${r.parts.length} parts, ${r.ecartees.length} écartées`)
      t('situation intermédiaire', () => calculerSituationIntermediaire(a.pieces, CATEGORIES, a.immobilisations, comptees, `${ANNEE}-01-01`, `${ANNEE}-10-31`, assujetti, paiements, MODELE.mode, parts, ventes, PLAN, pourLa2035.ecritures, recettesDeCaisse))
      // La Vue d'ensemble (pages/dossier/ChecklistTab.tsx, par lib/checklistLecture.ts) et les préalables de la validation
      // (ClotureTab) : les lectures du dossier fictif en entier ; ce que le dossier n'a pas (emprunts, véhicules, reprise,
      // déclarations de TVA, factures transmises) est une liste vide, lue, jamais un « partiel ».
      const lectureDesSources = { dossierId: D, etat: 'lue' as const, sources: sourcesEcritures }
      const lectureDuReleve = { dossierId: D, etat: 'lue' as const, sources: sourcesEcritures }
      const facturesEmises = a.factures.map((f) => ({ ...f, emetteur_siret: null, superpdp_invoice_id: null }))
      t('points de la Checklist', () => pointsDeLaChecklist({
        piecesValidees: a.pieces, piecesAValider: [], cotisations: a.cotisations, lignes: a.lignes, relevesIncoherents: [], doublonsTexte: [],
        immobilisations: a.immobilisations, natures: [], categories: CATEGORIES, ecritures: brouillon, emprunts: [], ventilations: [],
        ventilationsPartielles: false, reglements: [], reglementsPartiels: false, paiementsPartiels: false, lettragesManuels: [], vehicules: [],
        declarationsTva: [], declarationsPartielles: false, facturesEmises, transmissions: [], jumellesPartielles: false,
        facturesSources: ventes.sources, info: null, infoInconnue: null, anneesCloturees: [], ouverture: null, ouvertureIncomplete: null,
        aNouveaux: [], soldesReportes: [], entreesDeLOuvertureIncompletes: null, ventesFacturees: lectureDuReleve, caisse: caisseLue,
        entreesDeLaCaisseIncompletes: null, entreesDeLaRepriseDesBiensIncompletes: null,
      }, {
        assujettiTva: assujetti, periodiciteTva: 'mensuelle', statutTva: null, modele: MODELE, frontiere: null, anneesValidees: [],
        aujourdHui: `${ANNEE}-11-07`, anneeCourante: ANNEE, moisEcoules: 10, premierJourDuMois: `${ANNEE}-11-01`,
      }), (r) => `${r.tousLesPointsATraiter.length} points : ${r.tousLesPointsATraiter.map((x) => x.id).join(', ')}`)
      t('préalables de la validation', () => prealablesDeValidation({
        annee: ANNEE, anneeCourante: ANNEE + 1, aujourdHui: `${ANNEE + 1}-01-15`, modele: MODELE, assujettiTva: assujetti, anneesValidees: [],
        lectureIncomplete: null, piecesValidees: a.pieces, piecesAValider: [], categories: CATEGORIES, immobilisations: a.immobilisations,
        natures: [], ecritures: brouillon, lignes: a.lignes, ventilations: [], reglements: [], encaissees: [], cotisations: a.cotisations,
        vehicules: [], emprunts: [], aNouveaux: [], soldesReportes: [], declarationsTva: [], periodiciteTva: 'mensuelle',
        controlesReleves: [], doublonsTexte: [], facturesEmises, transmissions: [], facturesSources: ventes.sources,
        etatsDesVentes: etatsDesVentesFacturees({ sources: sourcesEcritures, brouillon, mode: MODELE.mode, plan: PLAN, anneesValidees: [], ventesParLesFactures: true }),
        ventesDeLaChecklist: ventesDeLaChecklist(lectureDesSources, null), operationsDeCaisse, champsBnc: CHAMPS_BNC_NON_EXPORTES,
        declaration, concordance,
      }), (r) => JSON.stringify(r).slice(0, 200))
      const etat: EtatDeLaCaisse = {
        compteCaisse: PLAN.caisse, ouvertures: [{ date: `${ANNEE}-01-01`, compte: PLAN.caisse, sens: 'debit', montant: 200 }],
        operations: a.operations, mouvements: [], encaissements: [], factures: [],
      }
      t('caisse (soldes et premier jour négatif)', () => [soldesDeLaCaisse(etat), premierJourNegatif(etat)])
      const jours = joursDuClient(a.operations)
      t('caisse rejouée (« Ma caisse »)', () => caisseRejouee(jours, a.operations, ANNEE), (r) => r.motif ?? 'rejouée')
    } else {
      t('CA3 (année, assujetti)', () => calculerCa3({
        pieces: a.pieces, paiements, pieceIdsImmobilisees: new Set(a.immobilisations.map((i) => i.piece_id ?? '')), releve: parts,
        ventesFacturees: ventes, caisse: recettesDeCaisse,
      }, { debut: `${ANNEE}-01-01`, fin: `${ANNEE}-12-31` }, false, 0, 0), (r) => `${r.retenues.length} pièces retenues, ${r.ecartees.length} écartées`)
    }
  }
  return resultats
}

// Les jours que la base rend au client (`caisse_du_client`), refaits des opérations : ce que `caisseRejouee` confronte.
function joursDuClient(operations: readonly OperationCaisse[]): JourDeLaCaisseDuClient[] {
  const parJour = new Map<string, number>()
  for (const o of operations) {
    if (o.retire_le) continue
    parJour.set(o.date, (parJour.get(o.date) ?? 0) + Math.round((o.genre === 'prelevement' ? -1 : 1) * o.montant * 100))
  }
  let solde = 0
  return [...parJour.keys()].sort().map((jour) => {
    const c = parJour.get(jour)!
    solde += c
    return { jour, report: 0, ouverture: 0, operations: c / 100, releve: 0, especes_des_factures: 0, encaissements_du_jour: [], solde: solde / 100, fige: false }
  })
}

// Le banc ne tire pas les types de Node (tsconfig.app.json, celui de src/) : ce qu'il en lit, et rien d'autre.
declare const process: { argv: string[]; version: string; platform: string; arch: string }

const facteurs = process.argv.slice(2).map(Number).filter((x) => x > 0)
const liste = facteurs.length > 0 ? facteurs : [1, 2]
const colonnes = liste.map((k) => ({ k, r: mesurer(k) }))
console.log(`Node ${process.version}, ${process.platform}/${process.arch} — médiane de 5 passes, en ms`)
console.log(['mesure', ...colonnes.map((c) => `${c.k}N`)].join(' | '))
for (const nom of colonnes[0].r.keys()) console.log([nom, ...colonnes.map((c) => String(c.r.get(nom)))].join(' | '))
