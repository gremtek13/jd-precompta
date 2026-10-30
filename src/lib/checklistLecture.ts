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
import { lireLesSourcesDesEcrituresDeVente, type LectureSourcesDesEcrituresDeVente } from './ecrituresVentesFactureesLecture'
import { facturesSourcesDe } from './facturesSources'
import { lireLesSoldesReportes } from './soldesReportesLecture'
import { lireLaCaisse, type LectureDeLaCaisse } from './caisseLecture'
import type {
  ANouveau, ControleReleveBancaire, Categorie, CotisationDeclaree, DeclarationTva, EcritureBrouillon, FactureEmise, Immobilisation,
  LigneBancaire, LettrageManuel, NatureImmobilisation, Piece, ReglementGroupe, VehiculeDossier, VentilationBancaire,
} from './types'

// CE QUE LA VUE D'ENSEMBLE LIT DU DOSSIER pour dire ses points (lib/pointsDeLaChecklist.ts) — sorti de
// pages/dossier/ChecklistTab.tsx, qui le lisait lui-même, pour que l'onglet de la révision (ligne 41, étape R3) range
// les mêmes points, tirés des mêmes lectures. Les requêtes sont celles de l'écran, dans le même ordre.

export interface LectureDeLaChecklist extends Omit<DonneesDeLaChecklist, 'relevesIncoherents' | 'doublonsTexte' | 'ventesFacturees' | 'caisse'> {
  // Nuls quand leur lecture a échoué — l'échec est journalisé. La Vue d'ensemble les lit alors comme vides, comme elle
  // l'a toujours fait (best-effort) ; la révision, elle, n'affirme rien d'une lecture qu'elle n'a pas.
  relevesIncoherents: ControleReleveBancaire[] | null
  doublonsTexte: DoublonDeTexte[] | null
  // Non nul quand l'une des collections dont dépend un point n'a pas pu être lue en entier : les points portent alors
  // sur une partie du dossier, et leur SILENCE ne prouve plus rien.
  lectureIncomplete: string | null
  // Le motif des seules PIÈCES (validées et à valider) quand leur lecture n'est pas entière : la section « Dossier permanent » de la
  // révision ne dépend que d'elles, des documents et de ses entrées — une autre collection tronquée ne doit pas la taire.
  piecesIncompletes: string | null
  // Exercices que le cabinet a marqués clos : une lecture refusée laisse la liste VIDE, donc on continue de réclamer.
  clotureInconnue: string | null
  // Le motif des seuls SOLDES REPORTÉS quand leur lecture n'est pas entière (O33-Q3) : À PART de `lectureIncomplete`, car seul le
  // point de l'ouverture confrontée à la clôture du précédent s'en passe — les autres portent sur tout ce qu'ils lisent —,
  // et son bandeau le dit. La révision y retrouve le motif de ses soldes, sans les relire.
  soldesReportesIncomplets: string | null
  // Les ventes facturées d'un dossier qui a basculé (ligne 28.65, étape VF5f) : la lecture de l'onglet Banque et de l'onglet
  // Écritures, tout ou rien, nulle et jamais faite pour un dossier qui n'a pas basculé. La révision en tire aussi les frais
  // d'un mouvement d'encaissements de sa revue analytique : une lecture que deux écrans comptent s'écrit une fois.
  ventesFacturees: LectureSourcesDesEcrituresDeVente | null
  // Son motif quand elle n'est pas entière : À PART de `lectureIncomplete` — seuls les deux points des ventes facturées se
  // taisent, et leur bandeau le dit ; les autres points portent sur tout ce qu'ils lisent.
  ventesIncompletes: string | null
  // La caisse du dossier (ligne 26.6, étape C3b ; lib/caisseLecture.ts), telle que lue : les points de la caisse s'en tirent,
  // et la révision en tire aussi les recettes de sa revue analytique — une lecture que deux écrans comptent s'écrit une fois.
  // Le drapeau baissé, rien n'est lu (sans appel au réseau) : la caisse est absente.
  caisse: LectureDeLaCaisse
  // Son motif quand elle est en base et n'est pas lue en entier : À PART de `lectureIncomplete` — seuls les points de la caisse
  // se taisent, et leur bandeau le dit. Nul pour une caisse absente.
  caisseIncomplete: string | null
}

// `ventesParLesFactures` : le réglage du dossier, sans valeur par défaut — un dossier qui a basculé lit aussi ses ventes
// facturées (étape VF5f) ; un autre, rien de plus.
export async function lireLaChecklist(dossierId: string, ventesParLesFactures: boolean): Promise<LectureDeLaChecklist> {
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
    lectureReportes,
    ventesFacturees,
    lectureCaisse,
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
    // Avec la source de leur vente (étape VF6a) : l'exemplaire d'une facture source ne compte nulle part, et les points qui
    // jugent une pièce l'écartent. La même lecture que le pont : une lecture que deux points comptent s'écrit une fois. Et
    // leur montant (étape VF6e) : le symptôme d'une pièce déclarée à tort compare son TTC à celui d'une facture source.
    lireTout<FacturePourJumelle & Pick<FactureEmise, 'source_de_la_vente' | 'montant_ttc'>>((debut, fin) =>
      supabase.from('factures_emises').select('id, dossier_id, statut, type, numero, date_emission, emetteur_siret, superpdp_invoice_id, source_de_la_vente, montant_ttc', { count: 'exact' })
        .eq('dossier_id', dossierId).eq('statut', 'validee').order('id').range(debut, fin),
    ),
    lireTout<TransmissionPourJumelle & { id: string }>((debut, fin) =>
      supabase.from('transmissions_factures').select('id, facture_id, canal, hote, flux_id', { count: 'exact' })
        .eq('dossier_id', dossierId).order('id').range(debut, fin),
    ),
    // Les soldes reportés de chaque exercice validé : l'ouverture de l'exercice qui suit le dernier validé s'y lit, et se
    // confronte à la clôture du précédent (O33-Q3). La lecture de l'onglet Bilan, écrite une fois.
    lireLesSoldesReportes(dossierId),
    // Ne rejette jamais : refusée, partielle ou d'un autre dossier, elle revient « incomplète », avec son motif.
    ventesParLesFactures ? lireLesSourcesDesEcrituresDeVente(dossierId) : Promise.resolve(null),
    // Ne rejette jamais non plus ; le drapeau baissé, ne touche pas au réseau (la caisse absente).
    lireLaCaisse(dossierId),
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
    piecesIncompletes: (() => {
      const partielle = [lectureValidees, lectureAValider].find((l) => !l.complete)
      return partielle === undefined ? null : partielle.motif ?? 'lecture incomplète'
    })(),
    facturesEmises: lectureFacturesEmises.lignes,
    // Lues en partie, `lectureIncomplete` le dit : les points se signalent partiels, et la révision se tait.
    facturesSources: facturesSourcesDe(lectureFacturesEmises.lignes),
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
    soldesReportes: lectureReportes.lignes,
    soldesReportesIncomplets: lectureReportes.complete ? null : lectureReportes.motif ?? 'lecture incomplète',
    // Les six lectures dont la confrontation de l'ouverture ne se juge qu'entières : le brouillon, les catégories, les pièces
    // (leur tiers), la reprise et les soldes reportés. Une seule tronquée et un « aucun écart » ne prouverait rien : le point se
    // tait (jamais « pas d'écart » sur une lecture partielle), et les bandeaux de l'écran le disent.
    entreesDeLOuvertureIncompletes: (() => {
      const partielle = [
        lectureEcritures, lectureCategories, lectureValidees, lectureAValider, lectureANouveaux, lectureReportes,
      ].find((l) => !l.complete)
      return partielle === undefined ? null : partielle.motif ?? 'lecture incomplète'
    })(),
    ventesFacturees,
    ventesIncompletes: ventesFacturees?.etat === 'incomplete' ? ventesFacturees.motif : null,
    caisse: lectureCaisse,
    caisseIncomplete: lectureCaisse.enBase && !lectureCaisse.complete ? lectureCaisse.motif ?? 'lecture incomplète' : null,
    // Les lectures dont les points de la caisse ne se jugent qu'entières : ses opérations, le brouillon (leurs écritures), les
    // catégories (le compte d'une recette), le relevé (les versements, les mouvements classés sur la caisse), la reprise (son
    // ouverture) et les ventilations (un versement ventilé en recette). Une caisse absente n'en attend aucune.
    entreesDeLaCaisseIncompletes: !lectureCaisse.enBase ? null
      : !lectureCaisse.complete ? lectureCaisse.motif ?? 'lecture incomplète'
        : (() => {
          const partielle = [lectureEcritures, lectureCategories, lectureLignes, lectureANouveaux, lectureVentilations]
            .find((l) => !l.complete)
          return partielle === undefined ? null : partielle.motif ?? 'lecture incomplète'
        })(),
  }
}
