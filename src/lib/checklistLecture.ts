import { supabase } from './supabase'
import { lireTout } from './lectureComplete'
import { chargerRelevesIncoherents } from './controlesReleves'
import { chargerDoublonsDeTexte, type DoublonDeTexte } from './doublonsTexte'
import { lireAnneesCloturees } from './clotureExercice'
import { chargerInformationsDossier } from './informationsDossier'
import { ouvertureBanque } from './aNouveaux'
import type { Emprunt } from './emprunts'
import type { DonneesDeLaChecklist } from './pointsDeLaChecklist'
import type { FacturePourJumelle, TransmissionPourJumelle } from './ventesJumelles'
import type {
  ANouveau, ControleReleveBancaire, Categorie, CotisationDeclaree, DeclarationTva, EcritureBrouillon, Immobilisation,
  LigneBancaire, LettrageManuel, NatureImmobilisation, Piece, ReglementGroupe, VehiculeDossier, VentilationBancaire,
} from './types'

// CE QUE LA VUE D'ENSEMBLE LIT DU DOSSIER pour dire ses points (lib/pointsDeLaChecklist.ts) — sorti de
// pages/dossier/ChecklistTab.tsx, qui le lisait lui-même, pour que l'onglet de la révision (ligne 41, étape R3) range
// les mêmes points, tirés des mêmes lectures. Les requêtes sont celles de l'écran, dans le même ordre.

export interface LectureDeLaChecklist extends Omit<DonneesDeLaChecklist, 'relevesIncoherents' | 'doublonsTexte'> {
  // Nuls quand leur lecture a échoué — l'échec est journalisé. La Vue d'ensemble les lit alors comme vides, comme elle
  // l'a toujours fait (best-effort) ; la révision, elle, n'affirme rien d'une lecture qu'elle n'a pas.
  relevesIncoherents: ControleReleveBancaire[] | null
  doublonsTexte: DoublonDeTexte[] | null
  // Non nul quand l'une des collections dont dépend un point n'a pas pu être lue en entier : les points portent alors
  // sur une partie du dossier, et leur SILENCE ne prouve plus rien.
  lectureIncomplete: string | null
  // Exercices que le cabinet a marqués clos : une lecture refusée laisse la liste VIDE, donc on continue de réclamer.
  clotureInconnue: string | null
  // L'ouverture reprise d'un autre logiciel, telle que lue : la révision en tire l'ouverture de ses exercices.
  aNouveaux: ANouveau[]
}

export async function lireLaChecklist(dossierId: string): Promise<LectureDeLaChecklist> {
  const [
    lectureValidees,
    lectureAValider,
    lectureCotisations,
    lectureLignes,
    lectureImmobilisations,
    lectureNatures,
    lectureCategories,
    lectureEcritures,
    lectureInfos,
    clotures,
    lectureANouveaux,
    lectureEmprunts,
    lectureVentilations,
    lectureReglements,
    lectureVehicules,
    lectureLettrages,
    lectureDeclarations,
    lectureFacturesEmises,
    lectureTransmissions,
  ] = await Promise.all([
    // Les quatre grosses collections sont lues par tranches, triées sur un ordre TOTAL : le
    // plafond de PostgREST ne se signale pas (voir lib/lectureComplete.ts), et cet écran est
    // précisément celui qui prétend dire ce qui MANQUE. Un contrôle qui ne voit qu'une partie du
    // dossier se tait sur le reste — et se taire est exactement ce qu'on attend de lui quand tout
    // va bien : la panne est indiscernable du succès.
    lireTout<Piece>((debut, fin) =>
      supabase.from('pieces').select('*', { count: 'exact' })
        .eq('dossier_id', dossierId).eq('statut', 'validee').order('id').range(debut, fin),
    ),
    lireTout<Piece>((debut, fin) =>
      supabase.from('pieces').select('*', { count: 'exact' })
        .eq('dossier_id', dossierId).eq('statut', 'a_valider').order('id').range(debut, fin),
    ),
    lireTout<CotisationDeclaree>((debut, fin) =>
      supabase.from('cotisations_declarees').select('*', { count: 'exact' })
        .eq('dossier_id', dossierId).order('id').range(debut, fin),
    ),
    lireTout<LigneBancaire>((debut, fin) =>
      supabase.from('lignes_bancaires').select('*', { count: 'exact' })
        .eq('dossier_id', dossierId).order('id').range(debut, fin),
    ),
    lireTout<Immobilisation>((debut, fin) =>
      supabase.from('immobilisations').select('*', { count: 'exact' })
        .eq('dossier_id', dossierId).order('id').range(debut, fin),
    ),
    lireTout<NatureImmobilisation>((debut, fin) =>
      supabase.from('natures_immobilisation').select('*', { count: 'exact' })
        .or(`dossier_id.eq.${dossierId},dossier_id.is.null`).order('id').range(debut, fin),
    ),
    lireTout<Categorie>((debut, fin) =>
      supabase.from('categories').select('*', { count: 'exact' })
        .or(`dossier_id.eq.${dossierId},dossier_id.is.null`).order('id').range(debut, fin),
    ),
    lireTout<EcritureBrouillon>((debut, fin) =>
      supabase.from('ecritures_brouillon').select('*', { count: 'exact' })
        .eq('dossier_id', dossierId).order('id').range(debut, fin),
    ),
    // Par le module partagé, qui REND son erreur : c'est la troisième copie de cette lecture
    // (InformationsTab et ClientInformations sont les deux autres), et la seule qui la jetait
    // encore — parce qu'une entrée de `Promise.all` s'écrit sans `await`, donc hors de portée du
    // scanner qui a corrigé les deux premières.
    chargerInformationsDossier(dossierId),
    lireAnneesCloturees(dossierId),
    lireTout<ANouveau>((debut, fin) =>
      supabase.from('a_nouveaux').select('*', { count: 'exact' })
        .eq('dossier_id', dossierId).order('compte').order('id').range(debut, fin),
    ),
    lireTout<Emprunt>((debut, fin) =>
      supabase.from('emprunts').select('*', { count: 'exact' })
        .eq('dossier_id', dossierId).order('date_debut').order('id').range(debut, fin),
    ),
    lireTout<VentilationBancaire>((debut, fin) =>
      supabase.from('ventilations_bancaires').select('*', { count: 'exact' })
        .eq('dossier_id', dossierId).order('id').range(debut, fin),
    ),
    lireTout<ReglementGroupe>((debut, fin) =>
      supabase.from('reglements_groupes').select('*', { count: 'exact' })
        .eq('dossier_id', dossierId).order('id').range(debut, fin),
    ),
    lireTout<VehiculeDossier>((debut, fin) =>
      supabase.from('vehicules').select('*', { count: 'exact' })
        .eq('dossier_id', dossierId).order('annee').order('id').range(debut, fin),
    ),
    lireTout<LettrageManuel>((debut, fin) =>
      supabase.from('lettrages_manuels').select('*', { count: 'exact' })
        .eq('dossier_id', dossierId).order('id').range(debut, fin),
    ),
    lireTout<DeclarationTva>((debut, fin) =>
      supabase.from('declarations_tva').select('*', { count: 'exact' })
        .eq('dossier_id', dossierId).order('periode_debut').order('id').range(debut, fin),
    ),
    lireTout<FacturePourJumelle>((debut, fin) =>
      supabase.from('factures_emises').select('id, dossier_id, statut, type, numero, date_emission, emetteur_siret, superpdp_invoice_id', { count: 'exact' })
        .eq('dossier_id', dossierId).eq('statut', 'validee').order('id').range(debut, fin),
    ),
    lireTout<TransmissionPourJumelle & { id: string }>((debut, fin) =>
      supabase.from('transmissions_factures').select('id, facture_id, canal, hote, flux_id', { count: 'exact' })
        .eq('dossier_id', dossierId).order('id').range(debut, fin),
    ),
  ])
  // Best-effort, comme dans BanqueTab : l'échec est journalisé, et rendu NUL — jamais lu ici comme « aucun écart ».
  const relevesIncoherents = await chargerRelevesIncoherents(dossierId).catch((err) => {
    console.error(err)
    return null
  })
  // Même posture : journalisé, rendu nul.
  const doublonsTexte = await chargerDoublonsDeTexte(dossierId).catch((err) => {
    console.error(err)
    return null
  })
  return {
    piecesValidees: lectureValidees.lignes,
    piecesAValider: lectureAValider.lignes,
    cotisations: lectureCotisations.lignes,
    lignes: lectureLignes.lignes,
    relevesIncoherents,
    doublonsTexte,
    // TOUTES les collections dont dépend un point de cette liste, pas seulement les quatre grosses.
    // `categoriesSansCompte` et `categoriesSansPoste` partent des CATÉGORIES, `ecrituresSansObjet` des
    // IMMOBILISATIONS : une seule tronquée et le point
    // correspondant se TAIT — or se taire est exactement ce que cet écran fait quand tout va bien.
    // C'est le défaut de `ClotureTab`, qui refusait la 2035 « en n'ayant vérifié QUE les pièces ».
    lectureIncomplete: [
      lectureValidees, lectureAValider, lectureCotisations, lectureLignes, lectureImmobilisations,
      lectureNatures, lectureCategories, lectureEcritures, lectureEmprunts, lectureVentilations, lectureReglements,
      lectureVehicules, lectureLettrages, lectureDeclarations, lectureFacturesEmises, lectureTransmissions,
    ].find((l) => !l.complete)?.motif ?? null,
    facturesEmises: lectureFacturesEmises.lignes,
    transmissions: lectureTransmissions.lignes,
    jumellesPartielles: [lectureValidees, lectureAValider, lectureFacturesEmises, lectureTransmissions].some((l) => !l.complete),
    declarationsTva: lectureDeclarations.lignes,
    declarationsPartielles: !lectureDeclarations.complete,
    lettragesManuels: lectureLettrages.lignes,
    vehicules: lectureVehicules.lignes,
    reglements: lectureReglements.lignes,
    reglementsPartiels: !lectureReglements.complete,
    paiementsPartiels: !lectureLignes.complete || !lectureReglements.complete,
    emprunts: lectureEmprunts.lignes,
    ventilations: lectureVentilations.lignes,
    ventilationsPartielles: !lectureVentilations.complete,
    immobilisations: lectureImmobilisations.lignes,
    natures: lectureNatures.lignes,
    categories: lectureCategories.lignes,
    ecritures: lectureEcritures.lignes,
    info: lectureInfos.informations,
    infoInconnue: lectureInfos.erreur,
    anneesCloturees: clotures.annees,
    clotureInconnue: clotures.erreur,
    // Une ouverture lue à moitié donnerait un solde de départ faux : on n'en tire rien.
    ouverture: lectureANouveaux.complete ? ouvertureBanque(lectureANouveaux.lignes) : null,
    ouvertureIncomplete: lectureANouveaux.motif,
    aNouveaux: lectureANouveaux.lignes,
  }
}
