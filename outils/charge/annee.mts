// LE BANC DE CHARGE D'UNE ANNÉE — combien de temps prennent les calculs que les écrans refont à chaque affichage, sur une
// année FICTIVE à l'échelle d'un praticien de santé en BNC, avant que les données réelles du premier dossier entrent.
//
// Mode d'emploi, depuis la racine du dépôt (`tsx` n'est pas une dépendance : le lanceur passe par Vite, déjà installé) :
//
//     node outils/charge/lancer.mjs            # l'année N, puis 2N
//     node outils/charge/lancer.mjs 1 2 4      # d'autres facteurs de volume
//     node --cpu-prof --cpu-prof-dir=<dossier> outils/charge/lancer.mjs 1 --seul=piste   # une mesure, pour un profil
//
// (`npx tsx outils/charge/annee.mts` marche aussi là où `tsx` est installé.) Le banc n'entre pas dans `npm test` : un temps
// mesuré dans la CI serait instable. Il est type-vérifié par `npx tsc -b` (tsconfig.app.json l'inclut), pour que chaque
// moteur y soit appelé avec ses VRAIS paramètres obligatoires, comme l'écran qui l'appelle.
//
// L'année vient de src/test/anneeDeCharge.ts (ses volumes en tête : 1 500 pièces, 3 000 mouvements sur deux comptes, 300
// factures sources encaissées, une caisse, 100 journées de l'assurance maladie associées, des écritures libres) : les tests
// d'égalité des optimisations (src/lib/chargeEmpreintes.test.ts) rejouent la même. Chaque mesure est la médiane de cinq
// passes, en millisecondes, après une passe de chauffe. Le récit : HISTORIQUE.md, « LE BANC DE CHARGE D'UNE ANNÉE ».

import { analyseDeMaBanque, anneeDeMaBanque } from '../../src/lib/analyseDeMaBanque'
import { analyserAppariements, candidatsPieces, piecesMontantIntrouvableEnBanque, planRapprochementAutomatique } from '../../src/lib/appariementBanque'
import { rapprochementDeLOnglet, associesPourLesVentes } from '../../src/lib/associationsAssuranceMaladieVue'
import { ACCES_SANS_OBJET } from '../../src/lib/auteursVentes'
import { bilanDeLExercice } from '../../src/lib/bilan'
import { soldesDeLaCaisse, premierJourNegatif, type EtatDeLaCaisse } from '../../src/lib/caisse'
import { caisseRejouee, type JourDeLaCaisseDuClient } from '../../src/lib/caisseClient'
import { repriseEtReleveDeBanque } from '../../src/lib/caisseEcran'
import { concordance2035 } from '../../src/lib/concordance2035'
import { controlesDeLAssuranceMaladie, retenusDeLaChecklist, type LectureDesControles } from '../../src/lib/controlesAssuranceMaladie'
import { operationsDeCaisseDuDossier, operationsPourLesControles, versementsDEspecesHorsDesLots } from '../../src/lib/controlesDeLaCaisse'
import { cotisationsComptees } from '../../src/lib/cotisationRapprochee'
import { calculerDeclaration2035 } from '../../src/lib/declaration2035'
import { calculerCa3 } from '../../src/lib/declarationTva'
import { doublonsProbables, piecesRegleesPourLesDoublons } from '../../src/lib/doublonsProbables'
import { duContrePaye } from '../../src/lib/duContrePaye'
import { calculerBalance } from '../../src/lib/ecritures'
import { ecrituresDesVentesPourLa2035, etatsDesVentesFacturees, mouvementsClassesParEncaissements } from '../../src/lib/ecrituresVentesFactureesEcran'
import { AUCUNE_PIECE_CITEE } from '../../src/lib/facturesSources'
import { CHAMPS_BNC_NON_EXPORTES, formaterFec, numeroterFec } from '../../src/lib/fec'
import { INVENTAIRE_DES_CONTROLES_SANS_OBJET } from '../../src/lib/inventaireDesControles'
import { INVENTAIRE_SANS_OBJET } from '../../src/lib/inventaireDeLaValidation'
import { lettrages } from '../../src/lib/lettrage'
import { candidatsDeLaVente, horsDesLotsAvecLesCandidats, mouvementsHorsDesLots, ventesDuReleve } from '../../src/lib/mouvementsDesVentes'
import { horsDesNotesDeLExploitant, notesRembourseesPeutEtre, RAISON_REMBOURSEMENT_D_UNE_NOTE } from '../../src/lib/noteDeFraisEnTresorerie'
import { paiementsParLaCaisseDuDossier } from '../../src/lib/paiementParLaCaisse'
import { partsDuReleve } from '../../src/lib/partsDuReleve'
import { pisteAudit } from '../../src/lib/pisteAudit'
import { pointsDeLaChecklist } from '../../src/lib/pointsDeLaChecklist'
import { prealablesDeValidation } from '../../src/lib/prealablesValidation'
import { paiementsDesPieces, piecesPayees } from '../../src/lib/rattachement'
import { recettesDeCaisseDuDossier, recettesPourLesMoteurs } from '../../src/lib/recettesDeCaisse'
import { justificatifPossible, planAffectationParRegles } from '../../src/lib/reglesAffectation'
import { jonctionsParCompte, releveParCompte } from '../../src/lib/releveParCompte'
import { AUCUNE_SAISIE_2035 } from '../../src/lib/saisies2035'
import { calculerSituationIntermediaire } from '../../src/lib/situationIntermediaire'
import { rupturesDesReleves } from '../../src/lib/suiteDesReleves'
import type { OperationCaisse } from '../../src/lib/types'
import { SANS_ACOMPTE, ventesFacturees } from '../../src/lib/ventesFacturees'
import { ventesDeLaChecklist } from '../../src/lib/ventesDeLaChecklist'
import { virementsInternes, virementsInternesHorsDesLots } from '../../src/lib/virementsInternes'
import { ANNEE, BANQUES, CATEGORIES, D, genererAnnee, LECTURE_DES_COMPTES, MODELE, PLAN } from '../../src/test/anneeDeCharge'

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
    if (SEUL !== null && !nom.includes(SEUL)) return
    const { ms, rendu } = mediane(SEUL === null ? 5 : 30, f)
    resultats.set(nom, Math.round(ms * 10) / 10)
    resultats.set(`  rendu — ${nom}`, resume(rendu))
  }

  for (const assujetti of [false, true]) {
    const a = genererAnnee(k, assujetti)
    resultats.set(`volumes (${assujetti ? 'assujetti' : 'exonéré'})`, `${a.pieces.length} pièces, ${a.lignes.length} mouvements, ${a.brouillon.length} lignes au brouillon, `
      + `${a.factures.length} factures, ${a.paiementsAm.length} paiements AM`)
    const brouillon = a.brouillon
    // La chaîne de l'onglet Clôture (pages/dossier/ClotureTab.tsx), dans son ordre, sur des lectures faites en entier.
    const recettesDeCaisse = recettesPourLesMoteurs(recettesDeCaisseDuDossier(a.caisseLue, D, CATEGORIES, assujetti))
    const etatDeLaCaisse = operationsDeCaisseDuDossier(a.caisseLue, D)
    const operationsDeCaisse = operationsPourLesControles(etatDeLaCaisse)
    const paiementsDeLaCaisse = paiementsParLaCaisseDuDossier(a.caisseLue, D)
    if (recettesDeCaisse === null || operationsDeCaisse === null || paiementsDeLaCaisse === null) throw new Error('La caisse fictive ne se lit pas.')
    const paiements = paiementsDesPieces(a.lignes, [], [], paiementsDeLaCaisse)
    const parts = partsDuReleve(a.lignes, CATEGORIES, [], assujetti)
    const comptees = cotisationsComptees(a.cotisations, a.lignes, MODELE.mode)
    const sourcesVentes = { dossierId: D, factures: a.factures, lignes: a.lignesDeFacture, encaissements: a.encaissements, parts: a.parts, acomptes: SANS_ACOMPTE, piecesCitees: AUCUNE_PIECE_CITEE }
    const ventes = ventesFacturees(sourcesVentes)
    const sourcesEcritures = a.sourcesEcritures
    const pourLa2035 = ecrituresDesVentesPourLa2035({
      dossierId: D, ventesParLesFactures: true, facturesSources: ventes.sources, lecture: { dossierId: D, etat: 'lue', sources: sourcesEcritures },
      mode: MODELE.mode, plan: PLAN, banques: BANQUES,
    })
    if (pourLa2035.etat !== 'pret') throw new Error(`Les écritures des ventes ne sont pas prêtes : ${pourLa2035.etat}`)

    if (assujetti) {
      t('CA3 (année, assujetti)', () => calculerCa3({
        pieces: a.pieces, paiements, pieceIdsImmobilisees: new Set(a.immobilisations.map((i) => i.piece_id ?? '')), releve: parts,
        ventesFacturees: ventes, caisse: recettesDeCaisse,
      }, { debut: `${ANNEE}-01-01`, fin: `${ANNEE}-12-31` }, false, 0, 0), (r) => `${r.retenues.length} pièces retenues, ${r.ecartees.length} écartées`)
      continue
    }

    // ── L'onglet Banque (pages/dossier/BanqueTab.tsx), dans l'ordre de ses `useMemo` ─────────────────────────────────
    const lectureDuReleve = { dossierId: D, etat: 'lue' as const, sources: sourcesEcritures }
    t('Banque — ventes du relevé', () => ventesDuReleve(true, D, lectureDuReleve, ACCES_SANS_OBJET))
    const ventesReleve = ventesDuReleve(true, D, lectureDuReleve, ACCES_SANS_OBJET)
    const anneesValidees: number[] = []
    t('Banque — virements internes', () => virementsInternes(a.lignes, LECTURE_DES_COMPTES, PLAN.virements_internes, mouvementsHorsDesLots(ventesReleve), anneesValidees),
      (r) => `${r.candidats.size} candidats`)
    const virements = virementsInternes(a.lignes, LECTURE_DES_COMPTES, PLAN.virements_internes, mouvementsHorsDesLots(ventesReleve), anneesValidees)
    const especes = { etat: 'lues' as const, encaissements: sourcesEcritures.encaissements, factures: sourcesEcritures.factures }
    const repriseEtReleve = repriseEtReleveDeBanque({ dossierId: D, ouvertures: null, releve: a.lignes, releveIncomplet: null, modele: MODELE })
    const horsDesLots = virementsInternesHorsDesLots(
      versementsDEspecesHorsDesLots(mouvementsHorsDesLots(ventesReleve), etatDeLaCaisse, especes, repriseEtReleve, a.lignes), virements)
    t('Banque — ruptures de la suite des soldes, par compte', () => {
      const releve = releveParCompte(LECTURE_DES_COMPTES, a.lignes, a.controles)
      return releve.etat === 'parts' ? rupturesDesReleves(jonctionsParCompte(releve.parts)) : []
    })
    const luAm = {
      etat: 'lus' as const,
      paiements: { lignes: a.paiementsAm, complete: true, motif: null },
      associations: { lignes: a.associationsAm, complete: true, motif: null },
    }
    t('Banque — rapprochement de l\'assurance maladie', () => rapprochementDeLOnglet(true, luAm, { lignes: a.lignes, complet: true }, ventesReleve, anneesValidees, `${ANNEE}-12-15`),
      (r) => (r?.etat === 'calcule' ? `${r.concordances.length} concordances, ${r.controles.length} contrôles` : String(r?.etat)))
    const associes = associesPourLesVentes(true, luAm)
    t('Banque — candidats des ventes', () => candidatsDeLaVente(ventesReleve, lectureDuReleve, anneesValidees, associes))
    const candidats = candidatsDeLaVente(ventesReleve, lectureDuReleve, anneesValidees, associes)
    t('Banque — hors des lots avec les candidats', () => horsDesLotsAvecLesCandidats(horsDesLots, candidats, a.lignes))
    const horsDesLotsEtCandidats = horsDesLotsAvecLesCandidats(horsDesLots, candidats, a.lignes)
    t('paiementsDesPieces', () => paiementsDesPieces(a.lignes, [], [], paiementsDeLaCaisse))
    const piecesValidees = a.pieces.filter((p) => p.statut === 'validee')
    const justificatifs = horsDesNotesDeLExploitant(piecesValidees, MODELE.mode)
    const piecesRapprochees = piecesPayees(paiements)
    const libres = a.lignes.filter((l) => l.statut === 'non_rapprochee')
    t('Banque — la pièce proposée de chaque mouvement (candidatsPieces)', () => libres.map((l) => candidatsPieces(l, justificatifs, piecesRapprochees, ventes.sources)[0] ?? null),
      (r) => `${r.filter(Boolean).length} proposées sur ${r.length}`)
    const cotisationsRapprochees = new Set(a.lignes.map((l) => l.cotisation_id).filter((id): id is string => id != null))
    t('Banque — lot du rapprochement automatique', () => planRapprochementAutomatique(libres, justificatifs, a.cotisations, {
      pieces: piecesRapprochees, cotisations: cotisationsRapprochees,
    }, horsDesLotsEtCandidats, ventes.sources), (r) => `${r.retenus.length} retenus`)
    t('Banque — lot « Valider et rapprocher » (analyserAppariements)', () => analyserAppariements(
      horsDesNotesDeLExploitant(a.pieces, MODELE.mode).filter((p) => !piecesRapprochees.has(p.id)), a.lignes, ventes.sources),
    (r) => `${r.certains.length} certains, ${r.aArbitrer.length} à arbitrer`)
    const sansMouvement = piecesValidees.filter((p) => !piecesRapprochees.has(p.id))
    t('Banque — montants introuvables en banque', () => piecesMontantIntrouvableEnBanque(sansMouvement, a.lignes))
    t('Banque — lot des règles d\'affectation', () => {
      const j = {
        pieces: justificatifs, piecesRapprochees, restesARegler: new Map<string, number>(), paiements, cotisations: a.cotisations,
        cotisationsRapprochees, ventes: candidats, facturesSources: ventes.sources,
      }
      return planAffectationParRegles(a.lignes, a.regles, CATEGORIES, assujetti, (l) => {
        const justificatif = justificatifPossible(l, j)
        if (justificatif) return justificatif
        if (notesRembourseesPeutEtre(l, a.pieces, piecesRapprochees, ventes.sources, MODELE.mode).length > 0) return RAISON_REMBOURSEMENT_D_UNE_NOTE
        return null
      }, horsDesLots)
    }, (r) => `${r.propositions.length} propositions, ${r.aRapprocher.length} à rapprocher`)

    // ── La 2035, sa concordance, les exports ──────────────────────────────────────────────────────────────────────────
    const d2035 = () => calculerDeclaration2035(ANNEE, a.pieces, CATEGORIES, a.immobilisations, comptees, [], assujetti, paiements, parts, [], PLAN, ventes, pourLa2035.ecritures, recettesDeCaisse, a.libres)
    t('2035 complète', d2035, (r) => `recettes ${r.totalRecettes}, dépenses ${r.totalDepenses}`)
    const declaration = d2035()
    const contexteConcordance = {
      piecesValidees: new Set(a.pieces.map((p) => p.id)), piecesImmobilisees: new Set(a.immobilisations.map((i) => i.piece_id ?? '')),
      mouvementsDesVentesFacturees: mouvementsClassesParEncaissements(a.lignes),
    }
    t('concordance 2035 ↔ écritures', () => concordance2035(declaration, brouillon, contexteConcordance, null))
    const concordance = concordance2035(declaration, brouillon, contexteConcordance, null)
    t('situation intermédiaire', () => calculerSituationIntermediaire(a.pieces, CATEGORIES, a.immobilisations, comptees, `${ANNEE}-01-01`, `${ANNEE}-10-31`, assujetti, paiements, MODELE.mode, parts, ventes, PLAN, pourLa2035.ecritures, recettesDeCaisse, a.libres))
    t('ventes facturées', () => ventesFacturees(sourcesVentes), (r) => `${r.parts.length} parts, ${r.ecartees.length} écartées`)
    const etatsDesVentes = () => etatsDesVentesFacturees({ sources: sourcesEcritures, brouillon, mode: MODELE.mode, plan: PLAN, banques: BANQUES, anneesValidees: [], ventesParLesFactures: true })
    t('états des ventes facturées (onglet Écritures)', etatsDesVentes)
    const etatsCalcules = etatsDesVentes()
    t('FEC (numérotation et format)', () => formaterFec(numeroterFec(brouillon, a.pieces, CATEGORIES, [], MODELE, a.lignes, a.compositionDesVentes, operationsDeCaisse, CHAMPS_BNC_NON_EXPORTES, a.libres), new Map(), MODELE.mode))
    t('piste d\'audit', () => pisteAudit(brouillon, a.pieces, a.lignes, [], {
      immobilisations: a.immobilisations, factures: a.pieces, vehicules: [], caisse: operationsDeCaisse, plan: PLAN, banques: BANQUES,
      ventes: { ecritures: a.compositionDesVentes, factures: a.factures, encaissements: a.encaissements, exemplaires: [], transmissions: [], piecesCitees: AUCUNE_PIECE_CITEE },
      ecrituresLibres: a.libres,
    }))
    t('balance', () => calculerBalance(brouillon, CATEGORIES, []))
    t('bilan', () => bilanDeLExercice({ exercice: ANNEE, ecritures: brouillon, categories: CATEGORIES, reprise: [], reportes: [], anneesValidees: [], pieces: a.pieces, modele: MODELE, aujourdHui: `${ANNEE}-11-07`, inventaire: INVENTAIRE_DES_CONTROLES_SANS_OBJET }))
    t('lettrage', () => lettrages(brouillon, a.pieces, [], MODELE, { factures: a.factures, encaissements: a.encaissements, ecritures: a.compositionDesVentes }))
    t('doublons probables', () => doublonsProbables(a.pieces, assujetti, piecesRegleesPourLesDoublons(paiements)))

    // ── L'assurance maladie : les contrôles, le dû contre le payé ──────────────────────────────────────────────────────
    const luControles: LectureDesControles = {
      etat: 'lus', imports: { lignes: a.importsAm, complete: true, motif: null },
      paiements: { lignes: a.paiementsAm, complete: true, motif: null }, associations: { lignes: a.associationsAm, complete: true, motif: null },
    }
    const offre = { codeNaf: '86.22C', moduleOuvert: true }
    t('contrôles de l\'assurance maladie', () => controlesDeLAssuranceMaladie({
      drapeau: true, offre, lu: luControles, releve: { lignes: a.lignes, complete: true }, retenusParLesVentes: retenusDeLaChecklist(lectureDuReleve),
      categories: CATEGORIES, ventilations: { lignes: [], complete: true }, anneesValidees: [], jour: `${ANNEE}-12-15`,
    }))
    t('dû contre payé', () => duContrePaye({
      facture: { imports: { lignes: a.importsFactureAm, complete: true }, totaux: { lignes: a.facturesAm, complete: true } },
      paye: { imports: { lignes: a.importsAm, complete: true }, paiements: { lignes: a.paiementsAm, complete: true } },
      fenetre: { du: `${ANNEE}-01-01`, au: `${ANNEE}-12-31` }, aujourdHui: `${ANNEE + 1}-01-15`,
    }))

    // ── « Ma banque » : l'analyse de l'année, compte par compte ────────────────────────────────────────────────────────
    const comptesDuClient = { etat: 'lus' as const, comptes: LECTURE_DES_COMPTES.etat === 'lus' ? LECTURE_DES_COMPTES.comptes : [] }
    t('« Ma banque » — analyse de l\'année', () => {
      const analyse = analyseDeMaBanque({
        mouvements: { lignes: a.lignes, complete: true, motif: null }, controles: { lignes: a.controles, complete: true, motif: null },
        comptes: comptesDuClient, aujourdHui: `${ANNEE}-12-15`,
      })
      return analyse.etat === 'comptes' ? analyse.comptes.map((c) => (c.source.etat === 'lue' ? anneeDeMaBanque(c.source, ANNEE, `${ANNEE}-12-15`) : null)) : analyse
    })

    // ── La Vue d'ensemble et les préalables de la validation ───────────────────────────────────────────────────────────
    const facturesEmises = a.factures.map((f) => ({ ...f, emetteur_siret: null, superpdp_invoice_id: null }))
    t('points de la Checklist (Vue d\'ensemble)', () => pointsDeLaChecklist({
      notesDeFrais: { etat: 'sans_objet' as const },
      piecesValidees: a.pieces, piecesAValider: [], cotisations: a.cotisations, lignes: a.lignes, relevesIncoherents: [], controlesReleves: a.controles,
      comptesBancaires: LECTURE_DES_COMPTES, doublonsTexte: [],
      immobilisations: a.immobilisations, natures: [], categories: CATEGORIES, ecritures: brouillon, emprunts: [], ventilations: [],
      ventilationsPartielles: false, reglements: [], reglementsPartiels: false, paiementsPartiels: false, lettragesManuels: [], vehicules: [],
      declarationsTva: [], declarationsPartielles: false, facturesEmises, transmissions: [], jumellesPartielles: false,
      facturesSources: ventes.sources, info: null, infoInconnue: null, anneesCloturees: [], ouverture: null, ouvertureIncomplete: null,
      aNouveaux: [], soldesReportes: [], entreesDeLOuvertureIncompletes: null, ventesFacturees: lectureDuReleve, caisse: a.caisseLue,
      entreesDeLaCaisseIncompletes: null, entreesDeLaRepriseDesBiensIncompletes: null, inventaire: { etat: 'sans_objet' },
      assuranceMaladie: { lu: luControles, releveComplet: true },
    }, {
      assujettiTva: assujetti, periodiciteTva: 'mensuelle', statutTva: null, modele: MODELE, frontiere: null, anneesValidees: [],
      aujourdHui: `${ANNEE}-12-31`, anneeCourante: ANNEE, moisEcoules: 11, premierJourDuMois: `${ANNEE}-12-01`, offreAssuranceMaladie: offre,
    }), (r) => `${r.tousLesPointsATraiter.filter((x) => (x.nb ?? 0) > 0).map((x) => x.id).join(', ')}`)
    t('préalables de la validation', () => prealablesDeValidation({
      notesDeFrais: { etat: 'sans_objet' as const },
      annee: ANNEE, anneeCourante: ANNEE + 1, aujourdHui: `${ANNEE + 1}-01-15`, modele: MODELE, assujettiTva: assujetti, anneesValidees: [],
      lectureIncomplete: null, ecrituresLibres: a.libres, piecesValidees: a.pieces, piecesAValider: [], categories: CATEGORIES, immobilisations: a.immobilisations,
      natures: [], ecritures: brouillon, lignes: a.lignes, ventilations: [], reglements: [], encaissees: [], cotisations: a.cotisations,
      vehicules: [], emprunts: [], aNouveaux: [], soldesReportes: [], declarationsTva: [], periodiciteTva: 'mensuelle',
      controlesReleves: a.controles, comptesBancaires: LECTURE_DES_COMPTES, doublonsTexte: [], facturesEmises, transmissions: [], facturesSources: ventes.sources, piecesCitees: ventes.piecesCitees,
      etatsDesVentes: etatsCalcules, // un calcul à part de l’écran (mesuré plus haut)
      ventesDeLaChecklist: ventesDeLaChecklist(lectureDuReleve, null), operationsDeCaisse, champsBnc: CHAMPS_BNC_NON_EXPORTES,
      declaration, saisies2035: AUCUNE_SAISIE_2035, inventaire: INVENTAIRE_SANS_OBJET, concordance,
    }), (r) => r.prealables.map((x) => x.id).join(', '))

    // ── La caisse ──────────────────────────────────────────────────────────────────────────────────────────────────────
    const etat: EtatDeLaCaisse = {
      compteCaisse: PLAN.caisse, ouvertures: [{ date: `${ANNEE}-01-01`, compte: PLAN.caisse, sens: 'debit', montant: 200 }],
      operations: a.operations, mouvements: [], encaissements: [], factures: [],
    }
    t('caisse (soldes et premier jour négatif)', () => [soldesDeLaCaisse(etat), premierJourNegatif(etat)])
    const jours = joursDuClient(a.operations)
    t('caisse rejouée (« Ma caisse »)', () => caisseRejouee(jours, a.operations, ANNEE), (r) => r.motif ?? 'rejouée')
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

// `--seul=<motif>` : les seules mesures dont le nom le contient, trente passes chacune — pour un profil (`node --cpu-prof`).
const SEUL = process.argv.find((x) => x.startsWith('--seul='))?.slice('--seul='.length) ?? null
const facteurs = process.argv.slice(2).map(Number).filter((x) => x > 0)
const liste = facteurs.length > 0 ? facteurs : [1, 2]
const colonnes = liste.map((k) => ({ k, r: mesurer(k) }))
console.log(`Node ${process.version}, ${process.platform}/${process.arch} — médiane de 5 passes, en ms`)
console.log(['mesure', ...colonnes.map((c) => `${c.k}N`)].join(' | '))
for (const nom of colonnes[0].r.keys()) console.log([nom, ...colonnes.map((c) => String(c.r.get(nom)))].join(' | '))
