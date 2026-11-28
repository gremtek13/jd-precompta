import { Fragment, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { anneeDe, formatMoney, formatDate } from '../../lib/format'
import { doublonsProbables, phraseDuDoublon, piecesRegleesPourLesDoublons } from '../../lib/doublonsProbables'
import { SUGGESTIONS_COMPTE_PAR_CODE } from '../../lib/ecritures'
import { montantRetenu } from '../../lib/montantRetenu'
import {
  type FraisSansPoste } from '../../lib/declaration2035'
import { amortissementsSousLeBareme } from '../../lib/forfaitKilometrique'
import {
  CASES_2035, PREMIER_EXERCICE_REVENU_BRUT_SOCIAL, arrondirPourFormulaire } from '../../lib/cases2035'
import {
  POSTES_PROPOSABLES } from '../../lib/cases2035'
import { formaterMontant } from '../../lib/gabarit2035'
import { remplir2035 } from '../../lib/remplir2035'
import { cadre7DeLExercice } from '../../lib/cadre7'
import type { Cadre7DeLExercice } from '../../lib/cadre7'
import { avertissementDuFormulaire } from '../../lib/modeles2035'
import { FORMULAIRE_2035_SD_OFFERT, avertissementDuFormulaire2035SD } from '../../lib/modeles2035SD'
import {
  avisDuTableauDesImmobilisations, calculer2035SD, debutDeLaProfession, type Declaration2035SD } from '../../lib/declaration2035SD'
import { lireLesParametresDesCotisations } from '../../lib/parametresDesCotisationsLecture'
import { SAISIES_2035E_ABSENTES, calculer2035E, forfaitKilometriqueDesPostes, type Annexe2035E } from '../../lib/declaration2035E'
import { cloturerExercice } from '../../lib/clotureExercice'
import { compteeASonEcheance } from '../../lib/cotisationRapprochee'
import { previsionnellesSansPaiement } from '../../lib/previsionnelles'
import type { ModeleComptable } from '../../lib/engagement'
import type { DossierTab } from '../../lib/ongletsDossier'
import { nomsDesComptes, rappelDuReleveSuivant } from '../../lib/releveParCompte'
import {
  casesDeLInstantane, casesQuiDifferent, exerciceQuiFige, frontiereDeValidation, lireInstantane2035,
  postesDeLInstantane, type Instantane2035, type PosteRelu } from '../../lib/validationExercice'
import type {
  Categorie, CotisationDeclaree,
  PeriodiciteTva, Piece } from '../../lib/types'
import BrouillonBanner from '../../components/BrouillonBanner'
import BandeauLecturePartielle from '../../components/BandeauLecturePartielle'
import { useClotureDuDossier } from './useClotureDuDossier'
import { messageErreur } from '../../lib/messageErreur'
import { CATEGORIE_NON_MODIFIEE, categorieCommuneNonReglable, categorieReglableIci } from '../../lib/categoriesCommunes'
import VoletSocialCard from './VoletSocialCard'
import Annexe2035ECard from './Annexe2035ECard'
import ConcordanceCard from './ConcordanceCard'
import ValidationExerciceCard from './ValidationExerciceCard'
import { SAISIES_2035_EXPORTEES, saisiesDeLExercice } from '../../lib/saisies2035'
import { INVENTAIRE_EXPORTE } from '../../lib/inventaire'
import { etatDeLaCarteDeLInventaire } from '../../lib/inventaireDesControles'
import InventaireDeLaClotureCard from './InventaireDeLaClotureCard'
import {
  annexe2035EAvecSaisie, avisAvantLeTelechargement2035E, motifDesSaisies2035E, SAISIES_2035E_EXPORTEES, saisie2035EDeLExercice } from '../../lib/saisies2035E'
import type { Annexe2035ESaisie } from '../../lib/saisies2035E'
import Saisies2035ECard from './Saisies2035ECard'
import SaisiesDuCabinet2035Card from './SaisiesDuCabinet2035Card'
import AffectationDuResultatCard from './AffectationDuResultatCard'
import { AFFECTATION_EXPORTEE } from '../../lib/affectationDuResultat'
import {
  libelleDeLaRecette, type RecetteDeCaisse } from '../../lib/recettesDeCaisse'

// Palier 5, briques 5 et 6 réunies — postes de la 2035 et clôture brouillon. Regroupe et totalise
// par poste (recettes, achats, charges sociales, amortissements...) sans jamais calculer d'impôt.
// Chaque pièce rejoint l'exercice de son PAIEMENT quand le rapprochement bancaire le connaît, sa date
// de facture sinon — et l'écran liste celles qui comptent ainsi faute de paiement (voir
// lib/rattachement.ts) : c'est la règle BNC des recettes encaissées et des dépenses payées.
// `modele` : un dossier tenu en ENGAGEMENT (BIC, IS) ne produit pas de 2035 — elle déclare des
// bénéfices non commerciaux, tenus en trésorerie. L'écran le dit, et n'y garde que la clôture de
// l'exercice, qui ne dépend pas de la déclaration (purge du texte lu, fin des relances), et sa
// validation. Le modèle ENTIER, pas seulement son mode : la validation juge l'écriture d'un virement
// personnel et d'un forfait sur le compte du dirigeant qu'il désigne (lib/prealablesValidation.ts).
//
// LA VALIDATION D'UN EXERCICE (ligne 26.6, étape d) vit ici, sous la déclaration qu'elle fige : une carte
// par exercice dit ce qui l'empêche, valide, puis montre l'exercice validé (ValidationExerciceCard). Un
// exercice validé en trésorerie montre la 2035 TELLE QU'ELLE A ÉTÉ VALIDÉE — l'instantané gardé par la
// base —, pas un calcul d'aujourd'hui, et dit les cases où un nouveau calcul ne la retrouverait plus.
export default function ClotureTab({ dossierId, assujettiTva, periodiciteTva, modele, ventesParLesFactures, onNavigate }: {
  dossierId: string
  assujettiTva: boolean
  // La périodicité des déclarations de TVA : la validation d'un exercice dit les périodes qu'aucune ne couvre.
  periodiciteTva: PeriodiciteTva
  modele: ModeleComptable
  // Le réglage du dossier (`ventes_par_les_factures`) : basculé, la 2035 compte les frais d'un mouvement d'encaissements
  // tels que la composition de ses ventes facturées les écrit (VF4C3-Q1), et l'onglet lit ces sources. Sans valeur par défaut.
  ventesParLesFactures: boolean
  onNavigate?: (tab: DossierTab) => void
}) {
  const {
    modeComptable, estChef, isSuperAdmin, categories, piecesValidees,
    lectureIncomplete, lectureDesSaisies, saisiesIncompletes,
    relireLesSaisies, lectureDeLInventaire,
    lectureDesSaisies2035E, relireLesSaisies2035E, immobilisations, cotisations,
    vehicules, toutesLesLignes,

    empruntsIncomplets, natures, naturesIncompletes, ecritures,

    ouverture, piecesAValider,
    lectureDesComptes,


    ecrituresIncompletes,
    loading, error, setError, postesEdit, setPostesEdit, dossier, genere, setGenere,
    cloturesConnues, setCloturesConnues, cloturesInconnues, clotureMessage, setClotureMessage,
    anneeFilter, setAnnee, apresValidation, load,
    piecesSansCategorie, categoriesSansPosteDesSources,
    ventesFacturees, ventesIncompletes, recettesDeCaisse, caisseIncomplete,
    paiements, comptees, anneeCourante, anneesValidees,
    anneesDisponibles, exercices,
    formulaires, ouvert, declarationsOuvertes, postesSansCase,
    categoriesSansCase, piecesAContresens, incoherences, bkSansNature, doublonsVehicules, carburantsSousBareme,
    csgSansVentilation, amortissementsSansJustificatif, echeancesManquantes, interetsManquants,
    amortissementsVehicules, vehiculesNonCalcules, concordances,
    negatives,
    entete, validationDe } = useClotureDuDossier({ dossierId, assujettiTva, periodiciteTva, modele, ventesParLesFactures })

  // Valeur affichée tant que le cabinet n'a rien tapé : la suggestion connue pour ce code de
  // catégorie, sinon vide — jamais enregistrée avant le clic explicite sur "Enregistrer".
  function posteAffiche(c: Categorie): string {
    return postesEdit[c.id] ?? SUGGESTIONS_COMPTE_PAR_CODE[c.code]?.poste2035 ?? ''
  }

  // `suggestion` : enregistrer la suggestion affichée quand rien n'a été tapé (« Postes manquants ») ; sans elle, seul ce
  // qui a été tapé s'enregistre (« Postes sans case », où le poste actuel est justement celui qu'on remplace).
  async function savePoste(categorieId: string, suggestion = true) {
    const categorie = categories.find((c) => c.id === categorieId)
    const repli = suggestion && categorie ? SUGGESTIONS_COMPTE_PAR_CODE[categorie.code]?.poste2035 : undefined
    const valeur = (postesEdit[categorieId] ?? repli ?? '').trim()
    if (!valeur) return
    // Seconde ceinture : le champ d'une catégorie commune n'est pas rendu à qui ne peut pas la régler.
    if (categorie && !categorieReglableIci(categorie, isSuperAdmin)) {
      setError(categorieCommuneNonReglable('poste'))
      return
    }
    // Lue avec la ligne modifiée : une policy qui écarte la ligne ne lève rien, et PostgREST rend un succès sur zéro ligne.
    const { data: modifiee, error: saveError } = await supabase.from('categories').update({ poste_2035: valeur }).eq('id', categorieId)
      .select('id').maybeSingle()
    if (saveError) {
      setError(messageErreur(saveError, 'Le poste n’a pas pu être enregistré.'))
      return
    }
    if (!modifiee) {
      setError(CATEGORIE_NON_MODIFIEE)
      return
    }
    load()
  }
  // Verrou posé avant tout `await` — c'est ce qui le rend effectif contre un double clic, là où un
  // `disabled` piloté par un état React laisse passer le second clic (voir ImportDossierModal).
  const generationEnCours = useRef(false)

  // `instantane` : la 2035 d'un exercice VALIDÉ, remplie telle qu'elle a été validée — ses cases à l'euro et son
  // déclarant — plutôt que recalculée. `annexe` : la 2035-E de l'exercice, portée en page 3 quand elle est due — celle
  // que l'écran montre, tirée des mêmes cases.
  async function telechargerFormulaire(
    annee: number, valeurs: Map<string, number>, instantane: Instantane2035 | null, annexe: Annexe2035E,
    annexeSaisie: Annexe2035ESaisie | null,
    // Le cadre 7 de la 2035-B (lib/cadre7.ts), tiré de la 2035 montrée : le total A est la part de BJ venue du barème.
    cadre7: Cadre7DeLExercice,
  ) {
    // Sans le millésime de l'exercice, le PDF s'imprime sur le dernier livré (2035S-Q5, (B)) : la carte l'a dit avant le clic.
    // Drapeau levé, une annexe due sans sa saisie lue en entier retomberait sur des zéros supposés : le bouton est retenu.
    if (generationEnCours.current || lectureIncomplete) return
    if (SAISIES_2035E_EXPORTEES && annexe.obligatoire && annexeSaisie === null) return
    generationEnCours.current = true
    setError(null)
    try {
      const declarant = instantane ? instantane.entete : entete
      // Arrondi à l'euro AVANT le dessin : le formulaire dit « ne pas porter les centimes », et les
      // totaux sont recalculés depuis les cases arrondies pour que la colonne s'additionne.
      const remplissage = await remplir2035(
        instantane ? casesDeLInstantane(instantane.formulaire) : arrondirPourFormulaire(valeurs, annee),
        declarant,
        // L'adresse est celle d'aujourd'hui, même pour un exercice validé : l'instantané ne la garde pas.
        // Drapeau levé, une ligne « à saisir » porte ces mots sur le papier et la page 3 les nomme ; baissé, le PDF d'avant.
        annexe.obligatoire
          ? {
            valeurs: annexeSaisie ? annexeSaisie.lignes : annexe.lignes,
            aSaisir: annexeSaisie ? annexeSaisie.aSaisir : [],
            cadre: annexeSaisie ? annexeSaisie.cadre : null,
            entete: { nom: declarant.nom, siret: declarant.siret, adresse: dossier?.adresse ?? null, annee } }
          : null,
        annee,
        cadre7.cadre,
      )
      const manquantes = [
        ...remplissage.codesSansAncrage,
        ...remplissage.codesSansAncrage2035E.map((code) => `${code} (2035-E)`),
      ]
      // Ce que le cadre 7 n'a pas pu porter se dit comme une case sans ancrage : rien ne se tasse, rien ne se tait.
      const avisDuCadre7 = [
        ...(cadre7.ecart ? [`Cadre 7 : les indemnités recalculées (${formatMoney(cadre7.ecart.calculeCentimes / 100)}) ne retrouvent pas `
          + `celles de la 2035 montrée (${formatMoney(cadre7.ecart.attenduCentimes / 100)}) — leurs montants et le total A sont laissés vides.`] : []),
        ...(!remplissage.cadre7Repere ? ['Cadre 7 non repéré sur le formulaire — ses véhicules manquent sur le PDF.']
          : remplissage.vehiculesSansLigne.length > 0
            ? [`Cadre 7 : le formulaire n’offre pas de ligne pour ${remplissage.vehiculesSansLigne.join(', ')} — à porter sur un état annexe.`]
            : []),
        ...(remplissage.ligne23Reperee ? []
          : ['Ligne 23 de la 2035-A non repérée sur le formulaire — la case « évaluation forfaitaire » et son montant manquent sur le PDF.']),
      ]
      if (manquantes.length > 0 || avisDuCadre7.length > 0) {
        setError([
          ...(manquantes.length > 0 ? [`Cases non placées sur le formulaire : ${manquantes.join(', ')} — leur montant manque sur le PDF.`] : []),
          ...avisDuCadre7,
        ].join(' '))
      }
      const url = URL.createObjectURL(new Blob([remplissage.pdf as BlobPart], { type: 'application/pdf' }))
      const lien = document.createElement('a')
      lien.href = url
      lien.download = `2035-${annee}-${((instantane ? instantane.entete.nom : null) ?? dossier?.nom ?? 'dossier').replace(/[^\w-]+/g, '-')}.pdf`
      lien.click()
      URL.revokeObjectURL(url)
      setGenere(annee)
    } catch (e) {
      setError(messageErreur(e, 'Génération du formulaire impossible'))
    } finally {
      generationEnCours.current = false
    }
  }

  // LA DÉCLARATION PRINCIPALE N° 2035-SD (docs/conceptions/55-formulaire-2035-sd.md) : l'identité, la ligne 1 et le tableau
  // des immobilisations, tirés de la 2035 telle que l'écran la montre — l'instantané d'un exercice validé, sinon le calcul — et
  // du registre lu en entier. Un verrou à elle, posé avant tout `await` : les deux PDF ne se retiennent pas l'un l'autre.
  const generation2035SDEnCours = useRef(false)
  async function telechargerDeclaration2035SD(declaration: Declaration2035SD, instantane: Instantane2035 | null) {
    if (generation2035SDEnCours.current || lectureIncomplete || naturesIncompletes) return
    generation2035SDEnCours.current = true
    setError(null)
    try {
      const declarant = instantane ? instantane.entete : entete
      // Chargé au clic : pdf.js touche au navigateur dès son import, et l'écran n'en a besoin qu'ici.
      const { remplir2035SD } = await import('../../lib/remplir2035SD')
      // 2035SD-Q1 (A) : la date de début de la profession reprend le début d'activité de l'onglet Cotisations, lu au clic
      // (la lecture ne rejette jamais). Illisible, la case reste vide, et c'est dit.
      const parametres = await lireLesParametresDesCotisations(dossierId)
      const debutLu = parametres.etat === 'lus' ? parametres.debutActivite : null
      const { pdf, libellesSansAncrage } = await remplir2035SD(declaration, {
        nom: declarant.nom, activite: declarant.activite, siret: declarant.siret,
        // L'adresse est celle d'aujourd'hui, même pour un exercice validé : l'instantané ne la garde pas (comme la 2035-E).
        adresse: dossier?.adresse ?? null,
        debutDeLaProfession: debutDeLaProfession(debutLu, declaration.annee) })
      const avis = [
        ...(libellesSansAncrage.length > 0
          ? [`Valeurs non placées sur la déclaration 2035-SD : ${libellesSansAncrage.join(', ')} — elles manquent sur le PDF.`] : []),
        ...(parametres.etat === 'incomplets'
          ? [`Le début d’activité de l’onglet Cotisations n’a pas pu être lu (${parametres.motif}) : la date de début de la profession reste vide sur la 2035-SD.`]
          : []),
      ]
      if (avis.length > 0) setError(avis.join(' '))
      const url = URL.createObjectURL(new Blob([pdf as BlobPart], { type: 'application/pdf' }))
      const lien = document.createElement('a')
      lien.href = url
      lien.download = `2035-SD-${declaration.annee}-${(declarant.nom ?? 'dossier').replace(/[^\w-]+/g, '-')}.pdf`
      lien.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setError(messageErreur(e, 'Génération de la déclaration 2035-SD impossible'))
    } finally {
      generation2035SDEnCours.current = false
    }
  }

  // Verrou par exercice, posé avant le `try` — un `disabled` piloté par un état React laisse passer
  // un second clic dans le même rendu (voir ImportDossierModal, FactureAvoirModal et les autres
  // porteurs de ce motif recensés dans CLAUDE.md).
  const cloturesEnCours = useRef<Set<number>>(new Set())

  async function handleCloturer(annee: number) {
    if (cloturesEnCours.current.has(annee)) return
    cloturesEnCours.current.add(annee)
    setError(null)
    setClotureMessage(null)
    const dejaCloture = cloturesConnues.has(annee)
    // LA CONFIRMATION NOMME LES DEUX CONSÉQUENCES, et c'est une correction du 22/09/2026 : la marque
    // de clôture en commande désormais une SECONDE, l'arrêt des réclamations de documents pour cet
    // exercice sur les trois écrans « ce qu'il reste à envoyer » (voir lib/resteAEnvoyer.ts). Un
    // message qui n'en nomme qu'une laisse cocher pour l'une et subir l'autre — et celle qu'il
    // taisait est justement celle qui fait qu'on vient cliquer ici.
    //
    // Même règle que les quatorze autres confirmations du projet : on NOMME ce qu'on perd
    // (« et tous ses mouvements », « La pièce redevient une charge courante ordinaire »).
    // « Êtes-vous sûr ? » se ferme d'un clic aussi distrait que le premier.
    const confirmation = dejaCloture
      ? `Relancer la purge des pièces sensibles de l'exercice ${annee} ? Cet exercice est déjà clôturé — cette action rattrape seulement les pièces validées depuis.`
      : `Clôturer l'exercice ${annee} ? Cette action est irréversible, et elle fait DEUX choses.\n\n`
        + `1. Le texte OCR déjà lu des justificatifs de recette (bordereaux de télétransmission) de `
        + `cet exercice sera supprimé définitivement. Les fichiers déposés, eux, ne sont pas touchés.\n\n`
        + `2. On cesse de réclamer les documents de ${annee} : ni la checklist du dossier, ni l'espace `
        + `du client ne les redemanderont.`
    if (!window.confirm(confirmation)) {
      cloturesEnCours.current.delete(annee)
      return
    }
    try {
      const resultat = await cloturerExercice(dossierId, annee)
      setCloturesConnues((prev) => new Set(prev).add(annee))
      setClotureMessage(
        resultat.piecesPurgees > 0
          ? `Exercice ${annee} clôturé — texte OCR supprimé pour ${resultat.piecesPurgees} pièce(s) sensible(s).`
          : `Exercice ${annee} clôturé — aucune pièce sensible à purger pour l'instant.`,
      )
    } catch (e) {
      setError(messageErreur(e, "Impossible de clôturer l'exercice."))
    } finally {
      cloturesEnCours.current.delete(annee)
    }
  }

  // Ce que le calcul a écarté, tous exercices affichés confondus. Une pièce validée qui n'entre dans
  // aucun total était jusqu'ici retirée par un `continue` muet : sur une base fiscale, c'est un
  // manquant que personne ne voit. Dédoublonné par id, une même pièce pouvant sortir d'un exercice
  // à l'autre pour la même raison.
  const exclues = new Map<string, { piece: Piece; raison: string }>()
  for (const d of declarationsOuvertes) {
    for (const p of d.exclusions.sansPoste) exclues.set(p.id, { piece: p, raison: 'catégorie sans poste 2035' })
    for (const p of d.exclusions.sansDate) exclues.set(p.id, { piece: p, raison: 'aucune date' })
    for (const p of d.exclusions.sansMontant) exclues.set(p.id, { piece: p, raison: 'aucun montant lisible' })
  }
  const piecesExclues = [...exclues.values()]
  // Même chose côté relevé : un mouvement affecté que la déclaration n'a pas pu compter. Un mouvement ne
  // compte que dans l'exercice de sa date, donc il ne peut sortir que d'une seule déclaration.
  const mouvementsExclus = declarationsOuvertes.flatMap((d) => [
    ...d.exclusions.mouvementsSansPoste.map((m) => ({ mouvement: m, raison: 'catégorie sans poste 2035' })),
    ...d.exclusions.mouvementsHorsResultat.map((m) => ({ mouvement: m, raison: 'compte de la catégorie hors charges et produits' })),
  ])
  // Et côté caisse (étape C3a) : une recette en espèces que la 2035 n'a pas pu compter. Elle ne compte que dans l'exercice de
  // sa date. Vide tant que la caisse est absente.
  const recettesDeCaisseExclues: { recette: RecetteDeCaisse; raison: string }[] = declarationsOuvertes.flatMap((d) => [
    ...d.exclusions.recettesDeCaisseSansPoste.map((r) => ({ recette: r, raison: 'catégorie sans poste 2035' })),
    ...d.exclusions.recettesDeCaisseSansProduit.map((r) => ({
      recette: r, raison: r.libelleCategorie === null ? 'catégorie inconnue' : 'catégorie qui n’est plus un produit' })),
  ])
  // La catégorie d'une recette sans poste rejoint « Postes manquants », où son poste se règle.
  const categoriesDesRecettesSansPoste = categories.filter((c) => recettesDeCaisseExclues.some((x) =>
    x.recette.categorieId === c.id && x.raison === 'catégorie sans poste 2035'))

  // LES FRAIS D'UN MOUVEMENT D'ENCAISSEMENTS QUE LA 2035 NE RANGE SUR AUCUNE LIGNE (VF4C3-Q1) : la catégorie « Frais
  // bancaires » du dossier manque, ou n'a pas de poste. Un mouvement ne compte que dans l'exercice de sa date.
  const fraisExclus: FraisSansPoste[] = declarationsOuvertes.flatMap((d) => d.exclusions.fraisSansPoste)
  // Sa catégorie, quand elle existe sans poste, rejoint « Postes manquants » : c'est là que son poste se règle — ou que la
  // carte dit qu'une catégorie commune ne se règle que par l'administrateur de l'application.
  const categorieDesFraisExclus = fraisExclus.find((f) => f.categorie !== null)?.categorie ?? null
  const categoriesSansPosteHorsCaisse = categorieDesFraisExclus === null || categoriesSansPosteDesSources.some((c) => c.id === categorieDesFraisExclus.id)
    ? categoriesSansPosteDesSources : [...categoriesSansPosteDesSources, categorieDesFraisExclus]
  const categoriesSansPoste = categoriesDesRecettesSansPoste.length === 0 ? categoriesSansPosteHorsCaisse : [
    ...categoriesSansPosteHorsCaisse,
    ...categoriesDesRecettesSansPoste.filter((c) => !categoriesSansPosteHorsCaisse.some((x) => x.id === c.id)),
  ]

  // CE QUE LES VENTES FACTURÉES ONT D'ÉCARTÉ OU DE TROP (lib/ventesFacturees.ts), et les exemplaires qu'elles retirent du
  // compte des pièces. Les écartées et les excédents sont ceux du DOSSIER — le module ne date pas une facture qu'il écarte —,
  // portés à l'identique par chaque déclaration : ils se lisent sur la première ouverte, et se disent une fois. Les
  // exemplaires, ceux des exercices ouverts affichés, dédoublonnés comme les pièces exclues. Une ligne discrète chacun, et
  // seulement quand il y en a.
  const ventesEcartees = declarationsOuvertes[0]?.exclusions.ventesFactureesEcartees ?? []
  const ventesEnExcedent = declarationsOuvertes[0]?.ventesFactureesEnExcedent ?? []
  const exemplaires = new Map<string, Piece>()
  for (const d of declarationsOuvertes) for (const p of d.exclusions.exemplairesDeFacturesSources) exemplaires.set(p.id, p)
  const exemplairesNonComptes = [...exemplaires.values()]
  const nomDeLaFacture = (v: { numero: string | null; tiers: string }) => `${v.numero ?? 'sans numéro'} (${v.tiers})`

  // Ce qui compte à sa DATE DE FACTURE faute de paiement rapproché, exercice par exercice : une
  // supposition, pas une lecture — la pièce a peut-être été payée une autre année. Dite ici, sur
  // l'écran qui remplit la 2035, parce que c'est la seule chose qui distingue « payée en décembre » de
  // « facturée en décembre et payée on ne sait quand ».
  const sansPaiement = declarationsOuvertes.flatMap((d) => d.sansPaiementConnu.map((s) => ({ annee: d.annee, ...s })))
  // LE DOUBLON PROBABLE (relecture du 04/11/2026, D1 ; lib/doublonsProbables.ts) : la pièce comptée à sa date de facture est
  // souvent le PDF dont la photo, elle, a été rapprochée — la même charge comptée deux fois. La ligne le dit, et nomme l'autre
  // pièce ; la supprimer se fait dans Justificatifs. Sur les deux piles et les paiements que la 2035 lit.
  const doublonsDeCloture = doublonsProbables([...piecesValidees, ...piecesAValider], assujettiTva, piecesRegleesPourLesDoublons(paiements))
  const nbSansPaiementEnDoublon = sansPaiement.filter((s) => doublonsDeCloture.parPiece.has(s.piece.id)).length
  // Les échéances de cotisation qu'aucun paiement connu ne date — ni un prélèvement rapproché, ni un paiement depuis le
  // compte personnel (lib/cotisationPersonnelle.ts) : elles comptent à leur échéance, pour le versement saisi ou l'appel —
  // une SUPPOSITION, dite comme celle des pièces ci-dessus (lib/cotisationRapprochee.ts). Seulement celles des exercices
  // affichés.
  const echeancesSansPaiement = comptees
    .filter((c) => compteeASonEcheance(c) && exercices.includes(anneeDe(c.date)) && ouvert(anneeDe(c.date)))
    .sort((x, y) => x.date.localeCompare(y.date))
  // Parmi elles, LES PRÉVISIONNELLES QU'AUCUN PRÉLÈVEMENT NE PAIE ALORS QUE LE RELEVÉ COUVRE LEUR DATE (étape 2035S2,
  // lib/previsionnelles.ts) : l'appel définitif d'une autre date l'a peut-être remplacée, et les deux comptent en BK. En
  // attention, comme la Checklist, sans retenir la validation (2035S-Q4, (A)). Sur une lecture partielle, rien : un
  // prélèvement non lu la ferait paraître impayée.
  const previsionnellesImpayees = lectureIncomplete !== null ? [] : previsionnellesSansPaiement(
    cotisations, toutesLesLignes, modeComptable, frontiereDeValidation(anneesValidees),
  ).filter((c) => exercices.includes(anneeDe(c.echeance)) && ouvert(anneeDe(c.echeance)))

  // LA CARTE DES POSTES MANQUANTS VIT DANS LES DEUX MODÈLES. En engagement la 2035 n'est pas produite,
  // mais le poste regroupe encore les recettes et les charges de la situation intermédiaire (onglet
  // Financement) et du détail par poste de l'estimation, qui écartent une pièce sans poste — et c'est
  // ici que la Checklist envoie le compléter. Masquée avec le reste de la 2035, elle laissait le point
  // de la Checklist renvoyer vers un écran qui ne montre rien.
  const cartePostesManquants = categoriesSansPoste.length > 0 && (
    <div className="card" style={{ marginBottom: 20 }}>
      <h3 style={{ marginTop: 0 }}>Postes manquants</h3>
      <p className="muted" style={{ marginTop: -8 }}>
        {modeComptable === 'engagement'
          ? 'Ces catégories sont utilisées par des pièces validées ou des mouvements affectés mais n\'ont pas encore de poste associé. '
            + 'Ce dossier ne produit pas de 2035, mais le poste regroupe encore les recettes et les charges de '
            + 'la situation intermédiaire (onglet Financement) et du détail par poste de l\'estimation : leurs '
            + 'montants n\'y sont pas comptés tant que ce n\'est pas fait.'
          : 'Ces catégories sont utilisées par des pièces validées ou des mouvements affectés'
            + (categorieDesFraisExclus !== null ? ', ou reçoivent les frais d’un mouvement d’encaissements,' : '')
            + ' mais n\'ont pas encore de poste 2035 '
            + 'associé — leurs montants ne sont pas comptés dans le récapitulatif tant que ce n\'est pas fait.'}
        {' '}Un poste déjà renseigné est une suggestion à vérifier, pas une valeur figée.
      </p>
      {/* Repliée en fiches sous 860 pixels de carte (08/10/2026) : le champ du poste et « Enregistrer » ne tenaient pas dans un
          téléphone ni, volet de droite ouvert, dans le panneau central, et le bouton passait derrière un défilement latéral que
          rien n'annonce. Les cartes d'anomalie qui suivent ne se replient que sous 520 pixels de carte, quand leur montant, la
          colonne qui dit l'écart, dépassait la carte (mouvements absents, pièces comptées à leur date de facture, amortissements
          sans justificatif, frais de véhicule, cases « dont », case négative) : aucune n'a de commande ; les autres tiennent, mais
          ont leur enveloppe de défilement : un nom de pièce sans espace les élargirait au-delà de la carte. */}
      <div className="table-scroll tableau-adaptable">
        <table className="table-empilable">
          <thead><tr><th>Catégorie</th><th>Poste 2035</th><th></th></tr></thead>
          <tbody>
            {categoriesSansPoste.map((c) => (
              <tr key={c.id}>
                <td data-libelle="Catégorie">{c.libelle}</td>
                {categorieReglableIci(c, isSuperAdmin) ? (
                  <>
                    <td data-libelle="Poste 2035" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input
                        style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: '5px 8px', width: 220 }}
                        placeholder="ex. Achats, Loyers, Recettes..."
                        value={posteAffiche(c)}
                        onChange={(e) => setPostesEdit((prev) => ({ ...prev, [c.id]: e.target.value }))}
                      />
                      {!postesEdit[c.id] && SUGGESTIONS_COMPTE_PAR_CODE[c.code] && (
                        <span className="badge badge-neutral">suggestion</span>
                      )}
                    </td>
                    <td className="td-boutons">
                      <button className="btn btn-outline btn-sm" onClick={() => savePoste(c.id)}>Enregistrer</button>
                    </td>
                  </>
                ) : (
                  // Commune à tous les cabinets : la base n'en laisserait rien écrire, et le clic se perdait sans un mot. Une cellule
                  // fusionnée, sans libellé : repliée en fiche, elle porte un bloc (index.css, `tbody td[colspan]`).
                  <td colSpan={2} className="muted">{categorieCommuneNonReglable('poste')}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )

  if (modeComptable === 'engagement') {
    const exercicesACloturer = typeof anneeFilter === 'number' ? [anneeFilter] : anneesDisponibles
    return (
      <>
        <BrouillonBanner />
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ marginTop: 0 }}>La 2035 n’est pas produite pour ce dossier</h3>
          <p className="muted" style={{ margin: 0 }}>
            Ce dossier est tenu en comptabilité d’engagement (BIC, IS). La 2035 déclare des bénéfices
            non commerciaux, déterminés sur les recettes encaissées et les dépenses payées : elle ne se
            tire pas d’une comptabilité d’engagement, pas plus que le volet social qui en découle. La
            liasse d’un tel dossier (2033 ou 2050) n’est pas encore préparée par l’application ; ses
            livrables sont le FEC et la balance des comptes, depuis l’onglet Écritures.
          </p>
        </div>
        {cloturesInconnues && (
          <p className="error-text">
            {cloturesInconnues} On ne sait donc pas quels exercices sont déjà clôturés : le bouton
            ci-dessous propose « Clôturer » même si ça a déjà été fait. Le rejouer ne pose pas de
            seconde clôture — il rattrape seulement les pièces validées depuis.
          </p>
        )}
        {error && <p className="error-text">{error}</p>}
        {clotureMessage && <p className="muted">{clotureMessage}</p>}
        {cartePostesManquants}
        {loading ? (
          <div className="card"><p className="muted" style={{ margin: 0 }}>Chargement…</p></div>
        ) : exercicesACloturer.length === 0 ? (
          <div className="card"><div className="empty-state">Aucun exercice à clôturer pour l'instant.</div></div>
        ) : (
          exercicesACloturer.map((annee) => (
            <Fragment key={annee}>
              <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
                <strong>Exercice {annee}</strong>
                <BoutonCloture cloture={cloturesConnues.has(annee)} onCloturer={() => handleCloturer(annee)} />
              </div>
              {/* L'inventaire de l'exercice (ligne 35, INV6) : derrière `INVENTAIRE_EXPORTE` — baissé, aucune carte, la Clôture d'hier.
                  Il se lit avec la validation (`lectureDeLInventaire`, la même lecture que les contrôles) et se juge sur le brouillon. */}
              <InventaireDeLaClotureCard
                exercice={annee} onNavigate={onNavigate}
                etat={etatDeLaCarteDeLInventaire({
                  exporte: INVENTAIRE_EXPORTE, mode: modeComptable, lecture: lectureDeLInventaire === null ? null
                    : lectureDeLInventaire.etat === 'lu' ? lectureDeLInventaire.inventaire : lectureDeLInventaire,
                  brouillonEnCours: loading, brouillonIncomplet: ecrituresIncompletes, brouillon: ecritures, exercice: annee, anneeCourante })}
              />
              <ValidationExerciceCard
                dossierId={dossierId} annee={annee} {...validationDe(annee)} plan={modele.plan} estChef={estChef} onValide={apresValidation} onNavigate={onNavigate}
                onChoisirExercice={setAnnee}
              />
              {/* L'approbation des comptes et l'affectation du résultat de l'exercice (ligne 45, AFF4) : une société en engagement,
                  derrière son drapeau — la carte lit ses propres tables, jamais avant la migration. */}
              {AFFECTATION_EXPORTEE && <AffectationDuResultatCard key={`${dossierId}:${annee}`} dossierId={dossierId} annee={annee} modele={modele} />}
            </Fragment>
          ))
        )}
      </>
    )
  }

  return (
    <>
      <BrouillonBanner />
      <p className="muted" style={{ marginTop: -8, marginBottom: 20 }}>
        Regroupement par poste de la 2035 des pièces validées et des mouvements du relevé affectés à
        une catégorie, complété par les amortissements et les cotisations sociales versées. Un simple
        total par poste — pas un résultat ni un calcul d'impôt, ce travail reste celui de
        l'expert-comptable.
      </p>

      {anneeFilter === 'toutes' && anneesDisponibles.length > 1 && (
        <p className="muted" style={{ marginTop: -4, marginBottom: 20, color: 'var(--color-warning)' }}>
          ⚠ Plusieurs exercices ({anneesDisponibles.join(', ')}) sont mélangés dans ce total — choisis
          un exercice dans le sélecteur en en-tête du dossier pour un vrai total de clôture.
        </p>
      )}

      {piecesSansCategorie.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            Pièces validées sans catégorie <span className="badge badge-danger">à traiter</span>
          </h3>
          <p className="muted" style={{ marginTop: -8 }}>
            {piecesSansCategorie.length === 1 ? 'Cette pièce validée n\'a' : `Ces ${piecesSansCategorie.length} pièces validées n'ont`} aucune catégorie : {piecesSansCategorie.length === 1 ? 'son montant n\'entre' : 'leurs montants n\'entrent'} dans aucun total ci-dessous, ni dans la 2035. Le récapitulatif est donc incomplet de {formatMoney(piecesSansCategorie.reduce((s, p) => s + (p.montant_ttc ?? 0), 0))} tant que la catégorie n'est pas donnée depuis l'onglet Justificatifs.
          </p>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {piecesSansCategorie.map((p) => (
              <li key={p.id}>{p.tiers ?? p.nom_fichier} — {formatMoney(p.montant_ttc)}{p.date_piece ? ` (${p.date_piece})` : ''}</li>
            ))}
          </ul>
        </div>
      )}

      {cartePostesManquants}

      {piecesExclues.length > 0 && (
        <div className="card" style={{ marginBottom: 20, borderLeft: '3px solid var(--color-warning)' }}>
          <h3 style={{ marginTop: 0 }}>Pièces validées absentes du récapitulatif ({piecesExclues.length})</h3>
          <p className="muted" style={{ marginTop: -8 }}>
            Ces pièces sont validées mais n'entrent dans aucun total : leur montant manquera dans la
            déclaration tant que la cause n'est pas levée.
          </p>
          <div className="table-scroll">
            <table>
              <thead><tr><th>Pièce</th><th>Motif</th><th style={{ textAlign: 'right' }}>Montant</th></tr></thead>
              <tbody>
                {piecesExclues.map(({ piece: p, raison }) => (
                  <tr key={p.id}>
                    <td>{p.tiers ?? p.nom_fichier}</td>
                    <td className="muted">{raison}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {formatMoney(montantRetenu(p, assujettiTva))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {mouvementsExclus.length > 0 && (
        <div className="card" style={{ marginBottom: 20, borderLeft: '3px solid var(--color-warning)' }}>
          <h3 style={{ marginTop: 0 }}>Mouvements affectés absents du récapitulatif ({mouvementsExclus.length})</h3>
          <p className="muted" style={{ marginTop: -8 }}>
            Ces mouvements du relevé — ou ces parts d'un mouvement ventilé — sont affectés à une
            catégorie mais n'entrent dans aucun total : leur montant manquera dans la déclaration tant
            que la catégorie n'a pas de poste 2035, ou tant qu'elle n'est pas revenue sur un compte de
            charge ou de produit.
          </p>
          <div className="table-scroll tableau-adaptable">
            <table className="table-empilable-etroite table-empilable-sans-jeu">
              <thead><tr><th>Date</th><th>Mouvement</th><th>Catégorie</th><th>Motif</th><th style={{ textAlign: 'right' }}>Montant</th></tr></thead>
              <tbody>
                {mouvementsExclus.map(({ mouvement: m, raison }) => (
                  <tr key={`${m.origine}|${m.ligne.id}|${m.libelle}`}>
                    <td data-libelle="Date">{formatDate(m.ligne.date)}</td>
                    <td data-libelle="Mouvement">{m.ligne.libelle}</td>
                    <td data-libelle="Catégorie">{m.libelle}</td>
                    <td data-libelle="Motif" className="muted">{raison}</td>
                    <td data-libelle="Montant" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatMoney(m.montantReleve)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {recettesDeCaisseExclues.length > 0 && (
        <div className="card" style={{ marginBottom: 20, borderLeft: '3px solid var(--color-warning)' }}>
          <h3 style={{ marginTop: 0 }}>Recettes de caisse absentes du récapitulatif ({recettesDeCaisseExclues.length})</h3>
          <p className="muted" style={{ marginTop: -8 }}>
            Ces recettes en espèces sont dans la caisse, et leur écriture est passée, mais elles n’entrent dans aucun total :
            leur montant manquera dans la déclaration tant que leur catégorie n’a pas de poste 2035 (carte « Postes
            manquants »). Une catégorie qui n’est plus un produit ne se corrige pas ici : l’opération se retire et se saisit de
            nouveau sous une catégorie de produit.
          </p>
          <div className="table-scroll tableau-adaptable">
            <table className="table-empilable-etroite table-empilable-sans-jeu">
              <thead><tr><th>Date</th><th>Recette</th><th>Motif</th><th style={{ textAlign: 'right' }}>Montant</th></tr></thead>
              <tbody>
                {recettesDeCaisseExclues.map(({ recette: r, raison }) => (
                  <tr key={r.operationId}>
                    <td data-libelle="Date">{formatDate(r.date)}</td>
                    <td data-libelle="Recette">{libelleDeLaRecette(r)}</td>
                    <td data-libelle="Motif" className="muted">{raison}</td>
                    <td data-libelle="Montant" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatMoney(r.centimes / 100)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {fraisExclus.length > 0 && (
        <div className="card" style={{ marginBottom: 20, borderLeft: '3px solid var(--color-warning)' }}>
          <h3 style={{ marginTop: 0 }}>Frais d’encaissements absents du récapitulatif ({fraisExclus.length})</h3>
          <p className="muted" style={{ marginTop: -8 }}>
            La banque a retenu ces frais sur des mouvements que leurs encaissements de factures classent, et l’écriture de
            chaque mouvement les porte. La 2035 les compte sous le poste de la catégorie « Frais bancaires » du dossier
            {fraisExclus.some((f) => f.categorie === null)
              ? ', que le dossier n’a pas : ils manqueront dans la déclaration tant qu’aucune catégorie de code « frais_bancaires » n’existe.'
              : ', qui n’a pas de poste 2035 : ils manqueront dans la déclaration tant que ce poste n’est pas donné (carte « Postes manquants »).'}
            {categorieDesFraisExclus !== null && !categorieReglableIci(categorieDesFraisExclus, isSuperAdmin)
              ? ` ${categorieCommuneNonReglable('poste')}` : ''}
          </p>
          <div className="table-scroll tableau-adaptable">
            <table className="table-empilable-etroite table-empilable-sans-jeu">
              <thead><tr><th>Date</th><th>Mouvement</th><th style={{ textAlign: 'right' }}>Frais</th></tr></thead>
              <tbody>
                {fraisExclus.map(({ frais: f }) => (
                  <tr key={f.ligneBancaireId}>
                    <td data-libelle="Date">{formatDate(f.date)}</td>
                    <td data-libelle="Mouvement">{f.libelle}</td>
                    <td data-libelle="Frais" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatMoney(f.centimes / 100)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {ventesEcartees.length > 0 && (
        <p className="muted" style={{ marginTop: 0, marginBottom: 12 }}>
          Ventes facturées que la 2035 ne compte pas ({ventesEcartees.length}) :{' '}
          {ventesEcartees.map((v) => `${nomDeLaFacture(v)} — ${v.detail}`).join(' ; ')}.
        </p>
      )}
      {ventesEnExcedent.length > 0 && (
        <p className="muted" style={{ marginTop: 0, marginBottom: 12 }}>
          Ventes facturées encaissées au-delà de la facture nette de ses avoirs ({ventesEnExcedent.length}) :{' '}
          {ventesEnExcedent.map((v) => `${nomDeLaFacture(v)} à ${String(v.taux).replace('.', ',')} %, ${formatMoney(v.excedentCentimes / 100)} de trop`).join(' ; ')}
          {' '}— comptés dans la 2035, l’argent ayant été reçu ; le trop-perçu reste à rembourser ou à régulariser.
        </p>
      )}
      {exemplairesNonComptes.length > 0 && (
        <p className="muted" style={{ marginTop: 0, marginBottom: 12 }}>
          Exemplaires d’une facture source, que la 2035 ne compte pas — la vente l’est par les encaissements de sa facture
          ({exemplairesNonComptes.length}) : {exemplairesNonComptes.map((p) => p.tiers ?? p.nom_fichier).join(', ')}.
        </p>
      )}

      <BandeauLecturePartielle
        quoi="Les emprunts"
        accord="lus"
        motif={empruntsIncomplets}
        consequence={
          'Des échéances d’emprunt que rien ne paie peuvent donc manquer à la liste de cet écran : leurs ' +
          'intérêts manqueraient à la 2035 sans que rien le dise. Recharge la page.'
        }
      />

      {echeancesManquantes.length > 0 && (
        <div className="card" style={{ marginBottom: 20, borderLeft: '3px solid var(--color-warning)' }}>
          <h3 style={{ marginTop: 0 }}>Échéances d’emprunt non rapprochées ({echeancesManquantes.length})</h3>
          <p className="muted" style={{ marginTop: -8 }}>
            L’échéancier prévoit ces échéances et aucun mouvement du relevé ne les paie : leurs intérêts —
            {' '}{formatMoney(interetsManquants)} selon l’échéancier — et leur assurance ne comptent pas dans la
            2035. Rapproche chaque prélèvement de son échéance dans l’onglet Banque ; si le relevé de ces
            mois n’est pas encore importé, c’est par là qu’il faut commencer.
          </p>
          <details>
            <summary>Voir les échéances</summary>
            {/* Repliée en fiches sous 520 pixels d'enveloppe (08/10/2026) : sur téléphone, les intérêts prévus — ce que la 2035
                ne compte pas — sortaient de la vue. La carte a sa marge : les fiches n'ont pas de jeu. */}
            <div className="table-scroll tableau-adaptable">
              <table className="table-empilable-etroite table-empilable-sans-jeu">
                <thead><tr><th>Exercice</th><th>Emprunt</th><th>Échéance</th><th>Date prévue</th><th style={{ textAlign: 'right' }}>Intérêts prévus</th></tr></thead>
                <tbody>
                  {echeancesManquantes.map(({ annee, emprunt, echeance }) => (
                    <tr key={`${annee}-${emprunt.id}-${echeance.numero}`}>
                      <td data-libelle="Exercice">{annee}</td>
                      <td data-libelle="Emprunt">{emprunt.nom}</td>
                      <td data-libelle="Échéance">n° {echeance.numero}</td>
                      <td data-libelle="Date prévue">{formatDate(echeance.date)}</td>
                      <td data-libelle="Intérêts prévus" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatMoney(echeance.interets)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      )}

      {sansPaiement.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ marginTop: 0 }}>Pièces comptées à leur date de facture ({sansPaiement.length})</h3>
          <p className="muted" style={{ marginTop: -8 }}>
            Aucun paiement rapproché ne date ces pièces : elles comptent dans l'exercice de leur
            facture. Une recette se déclare l'année de son encaissement, une dépense l'année de son
            paiement — si l'une a été réglée une autre année, la rapprocher de son mouvement dans
            l'onglet Banque la fera changer d'exercice.
          </p>
          <p className="muted">{rappelDuReleveSuivant(sansPaiement.map((s) => s.annee), nomsDesComptes(lectureDesComptes, sansPaiement.map((s) => s.annee)))}</p>
          {nbSansPaiementEnDoublon > 0 && (
            <p style={{ marginTop: 0 }}>
              <span className="badge badge-warning">Doublon probable</span>{' '}
              {nbSansPaiementEnDoublon === 1 ? 'Une de ces pièces a' : `${nbSansPaiementEnDoublon} de ces pièces ont`} le
              montant, le fournisseur et presque la date d’une autre pièce : le même achat entré deux fois ? Si c’est le cas,
              supprime la pièce en trop dans l’onglet Justificatifs — sa charge est comptée deux fois.
            </p>
          )}
          <details>
            <summary>Voir les pièces</summary>
            <div className="table-scroll tableau-adaptable">
              <table className="table-empilable-etroite table-empilable-sans-jeu">
                <thead><tr><th>Exercice</th><th>Pièce</th><th>Date de facture</th><th style={{ textAlign: 'right' }}>Montant compté</th></tr></thead>
                <tbody>
                  {sansPaiement.map(({ annee, piece: p, montant }) => (
                    <tr key={`${annee}-${p.id}`}>
                      <td data-libelle="Exercice">{annee}</td>
                      <td data-libelle="Pièce">
                        {p.tiers ?? p.nom_fichier}
                        {doublonsDeCloture.parPiece.has(p.id) && (
                          <div className="nom-fichier" style={{ marginTop: 4, fontSize: '0.8rem' }}>
                            <span className="badge badge-warning" style={{ fontSize: '0.7rem' }}>Doublon probable</span>{' '}
                            <span className="muted">{phraseDuDoublon(doublonsDeCloture.parPiece.get(p.id)!, assujettiTva)}</span>
                          </div>
                        )}
                      </td>
                      <td data-libelle="Date de facture">{formatDate(p.date_piece)}</td>
                      <td data-libelle="Montant compté" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatMoney(montant)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      )}

      {previsionnellesImpayees.length > 0 && (
        <div className="card" style={{ marginBottom: 20, borderLeft: '3px solid var(--color-warning)' }}>
          <h3 style={{ marginTop: 0 }}>Prévisionnelles qu’aucun prélèvement ne paie ({previsionnellesImpayees.length})</h3>
          <p className="muted" style={{ marginTop: -8 }}>
            Le relevé couvre leur date et ne porte pas leur prélèvement : l’appel définitif, à une autre date, les a
            peut-être remplacées — comptées à leur échéance, elles s’ajoutent alors à lui en BK. Retire-les dans l’onglet
            Cotisations, ou rapproche-les de leur prélèvement dans l’onglet Banque.
          </p>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {previsionnellesImpayees.map((c) => (
              <li key={c.id}>Prévisionnelle du {formatDate(c.echeance)} : {formatMoney(c.montant_verse ?? c.montant_appele)}</li>
            ))}
          </ul>
        </div>
      )}

      {echeancesSansPaiement.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ marginTop: 0 }}>Cotisations comptées à leur échéance ({echeancesSansPaiement.length})</h3>
          <p className="muted" style={{ marginTop: -8 }}>
            Aucun prélèvement rapproché ne paie ces échéances : elles comptent dans l'exercice de leur
            échéance, pour le versement saisi ou l'appel. Une cotisation se déduit l'année où elle est
            payée — rapprocher l'échéance de son prélèvement dans l'onglet Banque la compte à la date et
            au montant du relevé, et l'écrit. Le plus souvent, c'est une échéance de décembre prélevée en
            janvier dont le relevé n'est pas encore importé : importer le relevé suivant, puis rapprocher
            l'échéance de son prélèvement, la comptera à la date de son paiement. Payée depuis le compte
            personnel, déclarer ce paiement dans l'onglet Cotisations. Dans les deux cas avant la validation
            de l'exercice : une fois validé, l'échéance est figée.
          </p>
          <details>
            <summary>Voir les échéances</summary>
            <div className="table-scroll">
              <table>
                <thead><tr><th>Exercice</th><th>Échéance</th><th style={{ textAlign: 'right' }}>Montant compté</th></tr></thead>
                <tbody>
                  {echeancesSansPaiement.map((c) => (
                    <tr key={c.cotisation.id}>
                      <td>{anneeDe(c.date)}</td>
                      <td>{formatDate(c.date)}{c.cotisation.previsionnel ? ' (prévisionnelle)' : ''}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatMoney(c.montant)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      )}

      {postesSansCase.length > 0 && (
        <div className="card" style={{ marginBottom: 20, borderLeft: '3px solid var(--color-warning)' }}>
          <h3 style={{ marginTop: 0 }}>Postes sans case du formulaire ({postesSansCase.length})</h3>
          <p className="muted" style={{ marginTop: -8 }}>
            Ces postes ont bien un total, mais le rattachement ne sait pas dans quelle case du
            formulaire les porter — leur montant n'apparaîtra nulle part sur la 2035, et l'exercice ne se
            valide pas tant que c'est le cas. Donnez à leur catégorie un poste du formulaire : la liste
            propose ses libellés.
          </p>
          <div className="table-scroll">
            <table>
              <thead><tr><th>Poste</th><th>Motif</th><th style={{ textAlign: 'right' }}>Montant</th></tr></thead>
              <tbody>
                {postesSansCase.map((p) => (
                  <tr key={`${p.ligne.nature}:${p.ligne.poste}`}>
                    <td>{p.ligne.poste}</td>
                    <td className="muted">
                      {p.raison === 'case du mauvais sens'
                        ? `case ${p.codeRefuse} incompatible avec une ${p.ligne.nature}`
                        : p.raison}
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {formatMoney(p.ligne.montant)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {categoriesSansCase.length > 0 && (
            <div className="table-scroll tableau-adaptable" style={{ marginTop: 14 }}>
              <table className="table-formulaire table-empilable">
                <thead><tr><th>Catégorie</th><th>Poste actuel</th><th>Nouveau poste</th><th></th></tr></thead>
                <tbody>
                  {categoriesSansCase.map((c) => (
                    <tr key={c.id}>
                      <td data-libelle="Catégorie">{c.libelle}</td>
                      <td data-libelle="Poste actuel">{c.poste_2035}</td>
                      {categorieReglableIci(c, isSuperAdmin) ? (
                        <>
                          <td data-libelle="Nouveau poste">
                            <input
                              list="postes-du-formulaire"
                              aria-label={`Nouveau poste de la catégorie ${c.libelle}`}
                              placeholder="ex. Achats, Loyers et charges locatives…"
                              value={postesEdit[c.id] ?? ''}
                              onChange={(e) => setPostesEdit((prev) => ({ ...prev, [c.id]: e.target.value }))}
                            />
                          </td>
                          <td>
                            <button
                              className="btn btn-outline btn-sm"
                              disabled={!(postesEdit[c.id] ?? '').trim()}
                              onClick={() => savePoste(c.id, false)}
                            >
                              Enregistrer
                            </button>
                          </td>
                        </>
                      ) : (
                        // Le refus de la validation renvoie ici : sans cette phrase, il restait sans issue et sans raison. Une cellule
                        // fusionnée, sans libellé : repliée en fiche, elle porte un bloc (index.css, `tbody td[colspan]`).
                        <td colSpan={2} className="muted">{categorieCommuneNonReglable('poste')}</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              <datalist id="postes-du-formulaire">
                {POSTES_PROPOSABLES.map((poste) => <option key={poste} value={poste} />)}
              </datalist>
            </div>
          )}
          {piecesAContresens.size > 0 && (
            <>
              <p className="muted" style={{ marginTop: 14 }}>
                {piecesAContresens.size === 1 ? 'Une pièce est rangée' : `${piecesAContresens.size} pièces sont rangées`} dans
                une catégorie de l'autre sens — une vente dans une catégorie de dépense, ou un achat dans une catégorie de
                recette : c'est la pièce qui change de catégorie, dans les justificatifs. Renommer la catégorie ferait
                perdre leur case à ses autres pièces.
              </p>
              <div className="table-scroll">
                <table>
                  <thead><tr><th>Pièce</th><th>Type</th><th>Catégorie</th><th style={{ textAlign: 'right' }}>Montant</th></tr></thead>
                  <tbody>
                    {[...piecesAContresens.values()].map((p) => (
                      <tr key={p.id}>
                        <td>{p.tiers ?? p.nom_fichier}</td>
                        <td className="muted">{p.type_piece === 'vente' ? 'Vente' : 'Achat'}</td>
                        <td>{categories.find((c) => c.id === p.categorie_id)?.libelle ?? '—'}</td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          {formatMoney(montantRetenu(p, assujettiTva))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {onNavigate && (
                <button className="btn btn-outline btn-sm" style={{ marginTop: 10 }} onClick={() => onNavigate('pieces')}>
                  Ouvrir les justificatifs
                </button>
              )}
            </>
          )}
        </div>
      )}

      {csgSansVentilation.length > 0 && (
        <div className="card" style={{ marginBottom: 20, borderLeft: '3px solid var(--color-warning)' }}>
          <h3 style={{ marginTop: 0 }}>Cotisations dont la CSG-CRDS n’est pas saisie</h3>
          <p className="muted" style={{ marginTop: -8 }}>
            Quand le montant « dont CSG-CRDS » est renseigné, la déclaration l’extrait de la ligne 25
            et porte ses 6,8 points déductibles en case BV (ligne 14) — la part non déductible ne
            figure alors nulle part, et il n’y a rien à réintégrer. <strong>Les cotisations listées
            ci-dessous n’ont pas ce montant</strong> : elles restent portées en entier ligne 25, donc
            leur part non déductible part en déduction, et aucun calcul ne peut la retrouver — le
            taux ne s’applique pas au montant total d’un appel. Saisissez-la dans Cotisations
            (« dont CSG-CRDS »).
          </p>
          {/* Une colonne porte une phrase : dans une carte étroite — volet de droite ouvert —, le tableau se replie en
              fiches plutôt que de sortir de la carte (voir `.tableau-adaptable` dans index.css). */}
          <div className="table-scroll tableau-adaptable">
            <table className="table-empilable">
              <thead>
                <tr>
                  <th>Exercice</th>
                  <th style={{ textAlign: 'right' }}>CSG-CRDS saisie</th>
                  <th style={{ textAlign: 'right' }}>dont déductible, portée en BV</th>
                  <th style={{ textAlign: 'right' }}>sortie du résultat</th>
                  <th>Cotisations sans CSG-CRDS saisie</th>
                </tr>
              </thead>
              <tbody>
                {csgSansVentilation.map(({ annee, part }) => (
                  <tr key={annee}>
                    <td data-libelle="Exercice">{annee}</td>
                    <td data-libelle="CSG-CRDS saisie" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatMoney(part.totalCsgCrds)}</td>
                    <td data-libelle="dont déductible, portée en BV" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatMoney(part.csgDeductible)}</td>
                    <td data-libelle="sortie du résultat" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {formatMoney(part.csgNonDeductible)}
                    </td>
                    <td data-libelle="Cotisations sans CSG-CRDS saisie" style={{ color: 'var(--color-danger)' }}>
                      {`${part.nbSansVentilation} — part non déductible non chiffrable, à saisir dans Cotisations (« dont CSG-CRDS »)`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {amortissementsSansJustificatif.length > 0 && (
        <div className="card" style={{ marginBottom: 20, borderLeft: '3px solid var(--color-danger)' }}>
          <h3 style={{ marginTop: 0 }}>
            Amortissement(s) sans justificatif ({amortissementsSansJustificatif.length})
          </h3>
          <p className="muted" style={{ marginTop: -8 }}>
            La pièce qui justifiait ce bien a été supprimée : le lien est défait en silence et la dotation
            part quand même en case CH. Retrouve le justificatif, ou retire l’immobilisation depuis
            l’onglet Immobilisations avant de déposer cette déclaration.
          </p>
          <div className="table-scroll tableau-adaptable">
            <table className="table-empilable-etroite table-empilable-sans-jeu">
              <thead>
                <tr>
                  <th>Exercice</th>
                  <th>Bien</th>
                  <th>Acquisition</th>
                  <th style={{ textAlign: 'right' }}>Dotation comptée</th>
                </tr>
              </thead>
              <tbody>
                {amortissementsSansJustificatif.map(({ annee, immo, dotation }) => (
                  <tr key={`${annee}-${immo.id}`}>
                    <td data-libelle="Exercice">{annee}</td>
                    <td data-libelle="Bien">{immo.libelle}</td>
                    <td data-libelle="Acquisition">{formatDate(immo.date_acquisition)}</td>
                    <td data-libelle="Dotation comptée" style={{ textAlign: 'right' }}>{formatMoney(dotation)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {doublonsVehicules.length > 0 && (
        <div className="card" style={{ marginBottom: 20, borderLeft: '3px solid var(--color-danger)' }}>
          <h3 style={{ marginTop: 0 }}>Frais de véhicule comptés deux fois ({doublonsVehicules.length})</h3>
          <p className="muted" style={{ marginTop: -8 }}>
            Le barème kilométrique et des frais de véhicule au réel arrivent tous les deux dans la
            case BJ. La notice (renvoi 12) est explicite : l'option pour le forfait vaut pour l'année
            entière et pour tous les véhicules, et les dépenses qu'il couvre ne doivent alors figurer
            à aucun poste de charges. Il faut retirer l'un des deux — le choix vous revient, il engage
            l'exercice entier.
          </p>
          <div className="table-scroll tableau-adaptable">
            <table className="table-empilable-etroite table-empilable-sans-jeu">
              <thead>
                <tr>
                  <th>Exercice</th>
                  <th>Poste au réel</th>
                  <th style={{ textAlign: 'right' }}>Montant au réel</th>
                  <th style={{ textAlign: 'right' }}>Barème kilométrique</th>
                </tr>
              </thead>
              <tbody>
                {doublonsVehicules.map(({ annee, doublon }) => (
                  <tr key={annee}>
                    <td data-libelle="Exercice">{annee}</td>
                    <td data-libelle="Poste au réel">{doublon.postes.map((p) => p.poste).join(', ')}</td>
                    <td data-libelle="Montant au réel" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--color-danger)' }}>
                      {formatMoney(doublon.totalPostes)}
                    </td>
                    <td data-libelle="Barème kilométrique" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {formatMoney(doublon.montantIndemnites)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {carburantsSousBareme.length > 0 && (
        <div className="card" style={{ marginBottom: 20, borderLeft: '3px solid var(--color-warning)' }}>
          <h3 style={{ marginTop: 0 }}>Carburant sous le barème kilométrique ({carburantsSousBareme.length})</h3>
          <p className="muted" style={{ marginTop: -8 }}>
            Le barème kilométrique couvre le carburant, l’entretien, les pneus, l’assurance et les réparations du véhicule
            (BOI-BNC-BASE-40-60-40-20, § 120) : sous le barème, ces dépenses ne figurent à aucun poste de charges (notice de la
            2035, renvoi 12). La catégorie commune « Carburant / déplacements » compte pourtant ces dépenses en case BJ, à côté du
            barème. Reclassez en prélèvement de l’exploitant ce que le barème couvre ; les péages, le stationnement et les
            autres déplacements restent déductibles. L’application ne tranche pas : la catégorie mêle les deux.
          </p>
          <div className="table-scroll tableau-adaptable">
            <table className="table-empilable-etroite table-empilable-sans-jeu" aria-label="Carburant sous le barème kilométrique">
              <thead>
                <tr>
                  <th>Exercice</th>
                  <th>Date</th>
                  <th>Catégorie</th>
                  <th style={{ textAlign: 'right' }}>Montant compté</th>
                </tr>
              </thead>
              <tbody>
                {carburantsSousBareme.flatMap(({ annee, carburant }) => carburant.depenses.map((d, i) => (
                  <tr key={`${annee}-${i}`}>
                    <td data-libelle="Exercice">{annee}</td>
                    <td data-libelle="Date">{formatDate(d.date)}</td>
                    <td data-libelle="Catégorie">{d.categorie}</td>
                    <td data-libelle="Montant compté" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatMoney(d.montant)}</td>
                  </tr>
                )))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <BandeauLecturePartielle
        quoi="Les natures d’immobilisation"
        motif={naturesIncompletes}
        consequence="Un véhicule du registre amorti l’année où le barème kilométrique est retenu peut donc ne pas être signalé ci-dessous."
      />

      {amortissementsVehicules.length > 0 && (
        <div className="card" style={{ marginBottom: 20, borderLeft: '3px solid var(--color-danger)' }}>
          <h3 style={{ marginTop: 0 }}>Amortissement d’un véhicule déduit avec le barème ({amortissementsVehicules.length})</h3>
          <p className="muted" style={{ marginTop: -8 }}>
            Le barème kilométrique couvre déjà l’amortissement du véhicule. La notice de la 2035 le dit au tableau des
            immobilisations : en cas d’option pour le barème, « les amortissements afférents à ces véhicules doivent être
            réintégrés au cadre B du tableau des immobilisations et des amortissements ». La case CH compte pourtant la
            dotation de ce matériel de transport : réintégrez-la sur la déclaration, ou retirez le bien du registre s’il
            n’est pas le véhicule du cadre 7. L’application ne le fait pas à votre place.
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Exercice</th><th>Bien</th><th style={{ textAlign: 'right' }}>Dotation comptée en CH</th>
                </tr>
              </thead>
              <tbody>
                {amortissementsVehicules.map(({ annee, immobilisation, dotation }) => (
                  <tr key={`${annee}-${immobilisation.id}`}>
                    <td>{annee}</td>
                    <td>{immobilisation.libelle}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--color-danger)' }}>
                      {formatMoney(dotation)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {vehiculesNonCalcules.length > 0 && (
        <div className="card" style={{ marginBottom: 20, borderLeft: '3px solid var(--color-warning)' }}>
          <h3 style={{ marginTop: 0 }}>Véhicules absents de la case BJ ({vehiculesNonCalcules.length})</h3>
          <p className="muted" style={{ marginTop: -8 }}>
            Ces véhicules sont déclarés et leurs kilomètres saisis, mais l'indemnité n'a pas pu être
            calculée : leur déduction manque ligne 23 du formulaire, et rien sur le PDF ne le dirait.
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Exercice</th><th>Véhicule</th><th style={{ textAlign: 'right' }}>Km pro</th><th>Motif</th>
                </tr>
              </thead>
              <tbody>
                {vehiculesNonCalcules.map((n, i) => (
                  <tr key={`${n.annee}-${i}`}>
                    <td>{n.annee}</td>
                    <td>
                      {n.vehicule.type}
                      {n.vehicule.type !== 'cyclomoteur' && ` ${n.vehicule.puissanceFiscale} CV`}
                      {n.vehicule.electrique && ' électrique'}
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {n.vehicule.kmProfessionnel.toLocaleString('fr-FR')}
                    </td>
                    <td className="muted">{n.motif}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {incoherences.length > 0 && (
        <div className="card" style={{ marginBottom: 20, borderLeft: '3px solid var(--color-danger)' }}>
          <h3 style={{ marginTop: 0 }}>Cases « dont » incohérentes ({incoherences.length})</h3>
          <p className="muted" style={{ marginTop: -8 }}>
            Une case « dont » est une part de sa case porteuse : son montant y est déjà compté, il ne
            peut donc pas la dépasser. Les deux cases sont éloignées sur le formulaire, c'est le genre
            d'écart qu'une relecture ne rapproche pas toute seule.
          </p>
          <div className="table-scroll tableau-adaptable">
            <table className="table-empilable-etroite table-empilable-sans-jeu">
              <thead>
                <tr>
                  <th>Case porteuse</th>
                  <th>Cases « dont »</th>
                  <th style={{ textAlign: 'right' }}>Total « dont »</th>
                  <th style={{ textAlign: 'right' }}>Porteuse</th>
                </tr>
              </thead>
              <tbody>
                {incoherences.map((i) => (
                  <tr key={i.porteuse.code}>
                    <td data-libelle="Case porteuse">
                      <div>
                        <span style={{ fontFamily: 'monospace' }}>{i.porteuse.code}</span>
                        <span className="muted" style={{ marginLeft: 8 }}>{i.porteuse.libelle}</span>
                      </div>
                    </td>
                    <td data-libelle="Cases « dont »" style={{ fontFamily: 'monospace' }}>{i.sousCases.map((c) => c.code).join(' + ')}</td>
                    <td data-libelle="Total « dont »" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--color-danger)' }}>
                      {formatMoney(i.totalSousCases)}
                    </td>
                    <td data-libelle="Porteuse" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {formatMoney(i.montantPorteuse)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {bkSansNature.length > 0 && (
        <div className="card" style={{ marginBottom: 20, borderLeft: '3px solid var(--color-warning)' }}>
          <h3 style={{ marginTop: 0 }}>Charges sociales personnelles sans nature dite ({bkSansNature.length})</h3>
          <p className="muted" style={{ marginTop: -8 }}>
            La ligne 25 du formulaire détaille BK en charges obligatoires (BT), cotisations facultatives Madelin (BZ) et plans
            d’épargne retraite (BU). BT ne compte que les échéances de l’onglet Cotisations : une catégorie au poste
            « Charges sociales personnelles » ne dit pas si sa charge est obligatoire ou facultative, et l’application ne le
            devine pas. Range-la sous « Cotisations facultatives Madelin » ou « Plan d’épargne retraite » quand c’en est ;
            sinon, la part de BK reste à dire sur le formulaire.
          </p>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {bkSansNature.map((x) => (
              <li key={x.annee}>
                Exercice {x.annee} : BK porte {formatMoney(x.montant)} dont la nature, obligatoire ou facultative, n’est pas dite
                (sur {formatMoney(x.bk)}).
              </li>
            ))}
          </ul>
        </div>
      )}

      {negatives.length > 0 && (
        <div className="card" style={{ marginBottom: 20, borderLeft: '3px solid var(--color-danger)' }}>
          <h3 style={{ marginTop: 0 }}>Case négative ({negatives.length})</h3>
          <p className="muted" style={{ marginTop: -8 }}>
            Les avoirs et les remboursements de l’exercice y dépassent ce que la case compte. Le formulaire
            n’admet pas de montant négatif : un remboursement reçu une année sans dépense du même poste se
            rattache le plus souvent à une dépense d’un exercice antérieur, et sa place est à arbitrer avant de
            signer. Le calcul ne le retourne plus en dépense — il le laissait compter deux fois à l’envers.
          </p>
          <div className="table-scroll tableau-adaptable">
            <table className="table-empilable-etroite table-empilable-sans-jeu">
              <thead><tr><th>Exercice</th><th>Case</th><th>Postes</th><th style={{ textAlign: 'right' }}>Montant</th></tr></thead>
              <tbody>
                {negatives.map((n) => (
                  <tr key={`${n.annee}-${n.case.code}`}>
                    <td data-libelle="Exercice">{n.annee}</td>
                    <td data-libelle="Case">
                      <div>
                        <span style={{ fontFamily: 'monospace' }}>{n.case.code}</span>
                        <span className="muted" style={{ marginLeft: 8 }}>{n.case.libelle}</span>
                      </div>
                    </td>
                    <td data-libelle="Postes">{n.postes.join(', ')}</td>
                    <td data-libelle="Montant" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--color-danger)' }}>{formatMoney(n.montant)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {cloturesInconnues && (
        <p className="error-text">
          {cloturesInconnues} On ne sait donc pas quels exercices sont déjà clôturés : le bouton
          ci-dessous propose « Clôturer » même si ça a déjà été fait. Le rejouer ne pose pas de
          seconde clôture — il rattrape seulement les pièces validées depuis.
        </p>
      )}

      {lectureIncomplete && (
        <p className="error-text">
          Une des entrées dont dépend la déclaration n'a pas pu être lue en entier
          ({lectureIncomplete}) — pièces, catégories, immobilisations, cotisations, véhicules,
          mouvements du relevé et leurs ventilations, déclarations de TVA, ou l'identité du dossier. Les
          montants ci-dessous portent donc sur une partie du dossier, et le remplissage du
          formulaire est bloqué : une 2035 calculée sur une lecture partielle est plausible, fausse,
          et signée.
        </p>
      )}

      {error && <p className="error-text">{error}</p>}
      {clotureMessage && <p className="muted">{clotureMessage}</p>}

      {loading ? (
        <div className="card"><p className="muted" style={{ margin: 0 }}>Chargement…</p></div>
      ) : caisseIncomplete !== null ? (
        // La caisse de ce dossier n'est pas revenue entière (étape C3a) : rien ne se calcule, et rien ne s'offre.
        <BandeauLecturePartielle
          quoi="La caisse du dossier"
          accord="lue"
          motif={caisseIncomplete}
          consequence={
            'La 2035 ne se calcule pas sans elle : ni ses montants, ni son formulaire, ni la validation de l’exercice ne '
            + 's’affichent. Recharge la page.'
          }
        />
      ) : ventesFacturees === null || recettesDeCaisse === null ? (
        // Les ventes facturées de ce dossier ne sont pas revenues entières : rien ne se calcule, et rien ne s'offre.
        ventesIncompletes ? (
          <BandeauLecturePartielle
            quoi="Les ventes facturées du dossier"
            accord="lues"
            motif={ventesIncompletes}
            consequence={
              'La 2035 ne se calcule pas sans elles : ni ses montants, ni son formulaire, ni la validation de l’exercice ne '
              + 's’affichent. Recharge la page.'
            }
          />
        ) : (
          <div className="card"><p className="muted" style={{ margin: 0 }}>Chargement…</p></div>
        )
      ) : formulaires.length === 0 ? (
        <div className="card"><div className="empty-state">Rien à regrouper pour l'instant.</div></div>
      ) : (
        formulaires.map((f) => {
          const annee = f.declaration.annee
          const validation = validationDe(annee, f)
          // La 2035 d'un exercice validé est celle que la base garde, pas un calcul d'aujourd'hui. Illisible, elle ne
          // s'affiche pas : montrer le calcul d'aujourd'hui à sa place laisserait signer autre chose que ce qui a été
          // validé.
          const instantane = validation.valide ? lireInstantane2035(validation.valide.declaration) : null
          // L'ANNEXE 2035-E DE L'EXERCICE, tirée de la 2035 telle qu'elle est montrée : celle que la base garde pour un
          // exercice validé — ses cases et ses postes —, sinon celle du calcul. Les saisies du cabinet n'ont pas de table :
          // l'annexe dit ce qu'elle suppose (Annexe2035ECard).
          const postes = instantane ? instantane.postes : [...f.declaration.recettes, ...f.declaration.depenses]
          const entreeAnnexe = {
            annee,
            cases: instantane ? casesDeLInstantane(instantane.cases) : f.valeurs,
            formulaire: instantane ? casesDeLInstantane(instantane.formulaire) : arrondirPourFormulaire(f.valeurs, annee),
            forfaitKilometrique: forfaitKilometriqueDesPostes(postes) }
          // Drapeau levé et la saisie de l'exercice lue en entier : l'annexe la reçoit, muette sur ce qui reste à saisir.
          const saisieAnnexe = saisie2035EDeLExercice(lectureDesSaisies2035E, annee)
          const annexeSaisie: Annexe2035ESaisie | null = SAISIES_2035E_EXPORTEES && saisieAnnexe
            ? annexe2035EAvecSaisie(entreeAnnexe, saisieAnnexe) : null
          const annexe = annexeSaisie ? annexeSaisie.annexe : calculer2035E({ ...entreeAnnexe, saisies: SAISIES_2035E_ABSENTES })
          // Une annexe due ne se remplit pas avant que sa saisie soit lue en entier (drapeau levé) : sinon, des zéros supposés.
          const saisiesAnnexeIncompletes = annexe.obligatoire
            ? motifDesSaisies2035E(lectureDesSaisies2035E, SAISIES_2035E_EXPORTEES) : null
          // Le cadre 7 de la 2035-B, tiré de la 2035 montrée : le total A est la part de BJ venue du barème ; le total B, les
          // amortissements à réintégrer que la carte Véhicules dit (CADRE7-Q2), « à saisir » tant qu'ils ne le sont pas tous.
          const cadre7 = cadre7DeLExercice(
            vehicules, annee, Math.round(forfaitKilometriqueDesPostes(postes) * 100),
            amortissementsSousLeBareme(immobilisations, natures, vehicules, annee).length > 0,
          )
          // LA DÉCLARATION 2035-SD de l'exercice, sur les MÊMES cases que le PDF de la 2035-A/B (`entreeAnnexe.formulaire`) et le
          // registre ; sa ligne (B) est le total B du MÊME cadre 7.
          const totalB = cadre7.cadre?.totalB ?? null
          const declaration2035SD = FORMULAIRE_2035_SD_OFFERT
            ? calculer2035SD({
              annee, formulaire: entreeAnnexe.formulaire, immobilisations, assujettiTva,
              vehiculesSousLeBareme: totalB === null ? 0 : totalB })
            : null
          return (
            <Fragment key={annee}>
              {validation.valide && !instantane ? (
                <div className="card" style={{ marginBottom: 20 }}>
                  <strong>Exercice {annee}</strong>
                  <p className="error-text" style={{ marginBottom: 0 }}>
                    La 2035 validée de {annee} n'a pas pu être relue : elle ne s'affiche pas, plutôt que de montrer à
                    sa place un calcul d'aujourd'hui qui n'est pas celui qui a été validé.
                  </p>
                </div>
              ) : (
                <FormulaireAnnuel
                  dossierId={dossierId}
                  annee={annee}
                  valeurs={instantane ? casesDeLInstantane(instantane.cases) : f.valeurs}
                  formulaire={instantane ? casesDeLInstantane(instantane.formulaire) : undefined}
                  validee={validation.valide && instantane
                    ? {
                      le: validation.valide.valide_le, casesDifferentes: casesQuiDifferent(instantane, f.valeurs),
                      postes: postesDeLInstantane(instantane), version: instantane.version }
                    : undefined}
                  genere={genere === annee}
                  onTelecharger={() => telechargerFormulaire(annee, f.valeurs, instantane, annexe, annexeSaisie, cadre7)}
                  declaration2035SD={declaration2035SD === null ? null : {
                    avis: [
                      ...(avertissementDuFormulaire2035SD(annee) === null ? [] : [avertissementDuFormulaire2035SD(annee)!]),
                      ...avisDuTableauDesImmobilisations(declaration2035SD.immobilisations),
                    ],
                    // Le registre et les véhicules sont dans `lectureIncomplete` ; les natures disent quel bien est un véhicule.
                    blocage: lectureIncomplete ?? naturesIncompletes,
                    onTelecharger: () => telechargerDeclaration2035SD(declaration2035SD, instantane) }}
                  annexe2035E={annexe}
                  annexeSaisie={annexeSaisie}
                  lectureAnnexe={instantane ? null : lectureIncomplete ?? saisiesIncompletes}
                  blocage={lectureIncomplete ?? saisiesIncompletes}
                  blocageDeLAnnexe={saisiesAnnexeIncompletes}
                  cotisations={cotisations}
                  exerciceValide={anneesValidees.includes(annee)}
                  avertissement={avertissementDuFormulaire(annee)}
                  cloture={cloturesConnues.has(annee)}
                  onCloturer={() => handleCloturer(annee)}
                />
              )}
              {SAISIES_2035_EXPORTEES && (
                <SaisiesDuCabinet2035Card
                  key={`${annee}:${JSON.stringify(saisiesDeLExercice(lectureDesSaisies, annee))}`}
                  dossierId={dossierId} annee={annee} lecture={lectureDesSaisies}
                  fige={exerciceQuiFige(annee, anneesValidees) !== null} onRelire={relireLesSaisies} />
              )}
              {SAISIES_2035E_EXPORTEES && (
                <Saisies2035ECard
                  key={`${annee}:${JSON.stringify(saisieAnnexe)}`}
                  dossierId={dossierId} annee={annee} lecture={lectureDesSaisies2035E}
                  fige={exerciceQuiFige(annee, anneesValidees) !== null} onRelire={relireLesSaisies2035E} />
              )}
              <ConcordanceCard
                concordance={concordances.get(annee)!.concordance}
                comptesPartages={concordances.get(annee)!.comptesPartages}
                lectureIncomplete={lectureIncomplete ?? ecrituresIncompletes}
                ouverture={ouverture}
                figePar={exerciceQuiFige(annee, anneesValidees)}
                plan={modele.plan}
              />
              <ValidationExerciceCard
                dossierId={dossierId} annee={annee} {...validation} plan={modele.plan} estChef={estChef} onValide={apresValidation} onNavigate={onNavigate}
                onChoisirExercice={setAnnee}
              />
            </Fragment>
          )
        })
      )}
    </>
  )
}

// La clôture d'un exercice, écrite une fois pour les deux modèles : en engagement elle reste offerte
// alors que la 2035 ne l'est pas — elle ne dépend pas de la déclaration.
function BoutonCloture({ cloture, onCloturer }: { cloture: boolean; onCloturer: () => void }) {
  return (
    <>
      {cloture && <span className="badge badge-neutral">exercice clôturé</span>}
      <button
        className="btn btn-outline btn-sm"
        onClick={onCloturer}
        title={cloture
          ? "Rattraper la purge du texte OCR pour les pièces sensibles validées depuis la clôture."
          : "Marque l'exercice comme clôturé et supprime définitivement le texte OCR déjà lu des justificatifs de recette (bordereaux de télétransmission) de cet exercice."}
      >
        {cloture ? '↻ Rattraper la purge' : '🔒 Clôturer l’exercice'}
      </button>
    </>
  )
}

// Un exercice rendu dans la forme du formulaire : une ligne par case, dans l'ordre imprimé, avec son
// code et son libellé officiels. C'est ce qui permet à l'expert-comptable de relire case par case
// plutôt que de retraduire des « postes » maison — et c'est la même structure qui alimentera le PDF.
function FormulaireAnnuel({
  dossierId, annee, valeurs, formulaire, validee, genere, onTelecharger, annexe2035E, annexeSaisie, lectureAnnexe, blocage, blocageDeLAnnexe,
  cotisations, exerciceValide, avertissement, cloture, onCloturer, declaration2035SD }: {
  dossierId: string
  annee: number
  valeurs: Map<string, number>
  // Les cases à l'euro d'une 2035 VALIDÉE, telles que la base les garde ; sinon calculées depuis `valeurs`.
  formulaire?: Map<string, number>
  // Une 2035 validée : quand, les cases qu'un calcul d'aujourd'hui ne retrouverait plus, et ses postes tels qu'elle les
  // garde, avec ce que chacun compte (étape VF7d) — `version` dit si elle portait déjà les encaissements.
  validee?: { le: string; casesDifferentes: string[]; postes: PosteRelu[]; version: 1 | 2 | 3 }
  genere: boolean
  onTelecharger: () => void
  // L'annexe 2035-E de l'exercice (lib/declaration2035E.ts) : due ou non, le formulaire la porte quand elle l'est.
  annexe2035E: Annexe2035E
  // La même avec la saisie de l'exercice (ligne 48), drapeau levé ; nul, l'annexe d'hier.
  annexeSaisie: Annexe2035ESaisie | null
  // Non nul quand l'annexe se calcule depuis une lecture partielle : son obligation ne se juge pas (Annexe2035ECard). Nul
  // pour un exercice validé, dont l'annexe se tire de la 2035 que la base garde.
  lectureAnnexe: string | null
  // Non nul quand la lecture des pièces n'a pas pu se dire complète : le bouton est alors grisé et
  // dit pourquoi, plutôt que de produire un formulaire qu'on croirait complet.
  blocage: string | null
  // Non nul quand l'annexe est due et que sa saisie n'est pas lue en entier (`motifDesSaisies2035E`) : le bouton seul est
  // retenu — le volet social, qui n'en dépend pas, reste montré.
  blocageDeLAnnexe: string | null
  // Les échéances du dossier (toutes années) et l'exercice validé ou non : la régularisation estimée du volet social (TNS-Q2),
  // que la carte ne montre que sur des lectures entières (`blocage` nul) et sous son drapeau.
  cotisations: readonly CotisationDeclaree[]
  exerciceValide: boolean
  // Non nul quand l'application n'a pas le millésime du formulaire de cet exercice (étape 2035S6, lib/modeles2035.ts) : le
  // bouton est retenu, et la phrase le dit sous l'en-tête — jamais un PDF sous l'en-tête d'une autre année.
  avertissement: string | null
  // Vrai si le cabinet a déjà demandé la clôture de cet exercice — le bouton change de libellé mais
  // reste actif, pour rattraper une pièce sensible validée après coup (voir clotureExercice.ts).
  cloture: boolean
  onCloturer: () => void
  // La déclaration principale n° 2035-SD (`FORMULAIRE_2035_SD_OFFERT`) : ce qu'elle dira avant le clic, ce qui la retient, et
  // son geste ; null, drapeau baissé : rien ne s'affiche. Sans valeur par défaut.
  declaration2035SD: { avis: string[]; blocage: string | null; onTelecharger: () => void } | null
}) {
  // Une case à zéro que personne n'a alimentée n'apprend rien et noie le reste : on ne montre que
  // les cases qui portent un montant, plus les totaux, toujours affichés parce que c'est sur eux que
  // se fait la relecture. Sauf une case que le formulaire de cet exercice ne porte pas encore (le
  // cadre 8 avant les revenus 2025) : l'afficher à zéro ferait chercher sur la déclaration une case
  // qui n'y est pas.
  const visibles = CASES_2035.filter((c) =>
    (c.depuisExercice ?? annee) <= annee && ((valeurs.get(c.code) ?? 0) !== 0 || c.calculee))

  return (
    <div className="card" style={{ padding: 0, marginBottom: 20 }}>
      {/* `wrap` aux DEUX rangées : sur téléphone, « Clôturer l'exercice » et « Remplir le formulaire officiel » côte à côte
          mesurent plus que la carte (109 px de trop, vus au banc). Les boutons passent donc à la ligne entre eux, et le titre
          de l'exercice aussi, au lieu d'être réduit à un mot par ligne à côté d'eux. */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, padding: '14px 16px' }}>
        <div>
          <strong>Exercice {annee}</strong>
          <span className="muted" style={{ marginLeft: 10, fontSize: '0.9em' }}>
            {lectureAnnexe !== null
              ? '2035-A-SD et 2035-B-SD, la 2035-E-SD restant à juger'
              : annexe2035E.obligatoire ? '2035-A-SD, 2035-B-SD et 2035-E-SD' : '2035-A-SD et 2035-B-SD'} — à relire case par case avant dépôt
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <BoutonCloture cloture={cloture} onCloturer={onCloturer} />
          <button
            className="btn btn-primary btn-sm"
            onClick={onTelecharger}
            disabled={blocage !== null || blocageDeLAnnexe !== null}
            title={blocage ? `Lecture partielle d'une des collections de la déclaration (${blocage}) — le formulaire ne peut pas dire qu'il est amputé.`
              : blocageDeLAnnexe ? `Annexe 2035-E : ${blocageDeLAnnexe} — sans elles, le PDF supposerait des zéros au lieu de dire « à saisir ».`
              : undefined}
          >
            {genere ? '↻ Regénérer le formulaire' : '⬇ Remplir le formulaire officiel'}
          </button>
          {declaration2035SD && (
            <button
              className="btn btn-outline btn-sm"
              onClick={declaration2035SD.onTelecharger}
              disabled={declaration2035SD.blocage !== null}
              title={declaration2035SD.blocage
                ? `Lecture partielle d'une des collections de la déclaration (${declaration2035SD.blocage}) — le tableau des immobilisations ne peut pas dire qu'il est amputé.`
                : 'La déclaration principale n° 2035-SD : identité, résultat fiscal (ligne 1) et tableau des immobilisations ; le reste à compléter.'}
            >
              ⬇ Déclaration 2035-SD
            </button>
          )}
        </div>
      </div>
      {avertissement !== null && (
        <p role="note" style={{ margin: 0, padding: '0 16px 12px', color: 'var(--color-warning)' }}>{avertissement}</p>
      )}
      {/* CE QUE LA DÉCLARATION 2035-SD PORTERA « À SAISIR » OU NE REDIRA PAS, dit avant le clic, sur des lectures entières. */}
      {declaration2035SD && declaration2035SD.blocage === null && declaration2035SD.avis.map((avis) => (
        <p key={avis} role="note" style={{ margin: 0, padding: '0 16px 12px', color: 'var(--color-warning)' }}>2035-SD : {avis}</p>
      ))}
      {/* CE QUE LE PDF PORTERA « À SAISIR », dit avant le clic (ligne 48) : sur une annexe due, jugée sur une lecture entière. */}
      {lectureAnnexe === null && annexe2035E.obligatoire && annexeSaisie !== null
        && avisAvantLeTelechargement2035E(annexeSaisie).map((avis) => (
          <p key={avis} role="note" style={{ margin: 0, padding: '0 16px 12px', color: 'var(--color-warning)' }}>{avis}</p>
        ))}
      {validee && (
        <div style={{ padding: '0 16px 12px' }}>
          <p className="muted" style={{ margin: 0 }}>
            2035 validée le {formatDate(validee.le)} : elle est relue telle qu'elle a été validée, pas recalculée.
          </p>
          {validee.casesDifferentes.length > 0 && (
            <p className="error-text" style={{ margin: '6px 0 0' }}>
              Recalculée aujourd'hui, elle diffère sur {validee.casesDifferentes.length > 1 ? 'les cases' : 'la case'}
              {' '}{validee.casesDifferentes.join(', ')} : une catégorie a changé de poste depuis, ou le calcul de
              l'application a évolué. C'est la 2035 validée qui fait foi.
            </p>
          )}
          <RecapitulatifValide postes={validee.postes} version={validee.version} />
        </div>
      )}
      <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th style={{ width: 60 }}>Case</th>
            <th style={{ width: 80 }}>Ligne</th>
            <th>Libellé du formulaire</th>
            <th style={{ textAlign: 'right' }}>Montant</th>
          </tr>
        </thead>
        <tbody>
          {visibles.map((c) => (
            <tr key={c.code} style={c.calculee ? { fontWeight: 600 } : undefined}>
              <td style={{ fontFamily: 'monospace' }}>{c.code}</td>
              <td className="muted">{c.ligne}</td>
              <td>
                {c.libelle}
                <span className="muted" style={{ marginLeft: 8, fontSize: '0.85em' }}>
                  {c.formulaire}{c.calculee ? ` — ${c.calculee}` : ''}
                </span>
              </td>
              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {formatMoney(valeurs.get(c.code) ?? 0)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      <Annexe2035ECard annexe={annexe2035E} saisie={annexeSaisie} lectureIncomplete={lectureAnnexe} />
      {annee >= PREMIER_EXERCICE_REVENU_BRUT_SOCIAL && <ReportDeclarationRevenus annee={annee} valeurs={valeurs} formulaire={formulaire} />}
      {annee >= PREMIER_EXERCICE_REVENU_BRUT_SOCIAL && (
        <VoletSocialCard dossierId={dossierId} annee={annee} valeurs={valeurs} blocage={blocage}
          cotisations={blocage === null ? cotisations : null} exerciceValide={exerciceValide} />
      )}
    </div>
  )
}

// LE RÉCAPITULATIF D'UNE 2035 VALIDÉE (étape VF7d, ligne 28.65) : poste par poste, ce qu'elle compte — ses pièces, ses
// mouvements du relevé sans pièce, ses encaissements de factures —, tel que l'instantané le garde, rien recalculé. Une 2035
// validée en version 1 ne portait pas les encaissements : « — », et la phrase le dit ; jamais un zéro, qui affirmerait
// qu'aucun encaissement n'a compté.
// La version 3 (étape C3a) porte aussi les opérations de caisse de chaque poste : une colonne de plus, pour elle seule — le
// récapitulatif d'une 1 ou d'une 2 reste celui d'hier.
function RecapitulatifValide({ postes, version }: { postes: PosteRelu[]; version: 1 | 2 | 3 }) {
  const nombre = (n: number | null) => (n === null ? '—' : String(n))
  return (
    <details style={{ marginTop: 8 }}>
      <summary>Ce que compte la 2035 validée, poste par poste</summary>
      {version === 1 && (
        <p className="muted" style={{ margin: '6px 0' }}>
          Validée avant que l’application compte les encaissements de factures, elle se relit telle quelle : « — » dit un
          nombre qu’elle ne porte pas, pas un zéro.
        </p>
      )}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Poste</th>
              <th style={{ textAlign: 'right' }}>Montant</th>
              <th style={{ textAlign: 'right' }}>Pièces</th>
              <th style={{ textAlign: 'right' }}>Mouvements du relevé</th>
              <th style={{ textAlign: 'right' }}>Encaissements de factures</th>
              {version === 3 && <th style={{ textAlign: 'right' }}>Opérations de caisse</th>}
            </tr>
          </thead>
          <tbody>
            {postes.map((p, i) => (
              <tr key={`${p.nature}:${p.poste}:${i}`}>
                <td>{p.poste}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatMoney(p.montant)}</td>
                <td style={{ textAlign: 'right' }}>{nombre(p.nbPieces)}</td>
                <td style={{ textAlign: 'right' }}>{nombre(p.nbMouvements)}</td>
                <td style={{ textAlign: 'right' }}>{nombre(p.nbEncaissements)}</td>
                {version === 3 && <td style={{ textAlign: 'right' }}>{nombre(p.nbOperationsDeCaisse ?? null)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}

// Où vont les deux résultats de la 2035 sur la déclaration de revenus de l'exploitant. Le cadre 8
// n'a pas d'autre destination que le volet social : c'est de là que l'Urssaf tire l'assiette des
// cotisations et de la CSG-CRDS. L'administration le préremplit depuis la liasse, encore faut-il
// savoir quelle rubrique relire — et qu'aucun abattement ne doit y être retranché, puisque l'Urssaf
// applique le sien (notices 2041-DRI, rubrique « Revenu brut social »).
//
// Les codes des deux déclarants sont donnés ensemble : l'application ne sait pas lequel des deux
// l'exploitant est sur la déclaration du foyer.
//
// LES MONTANTS SONT CEUX DU FORMULAIRE, pas ceux du tableau : à l'euro, totaux recalculés sur les
// cases arrondies. C'est ce que l'administration reprend de la liasse, donc ce que le cabinet
// retrouvera prérempli — et ils peuvent différer d'un euro des montants au centime du tableau
// (120,60 € d'achats s'impriment 121, 5 000,40 € de recettes 5 000, et le bénéfice 4 279,80 €
// devient 4 279). Annoncer l'un pour l'autre ferait chercher un écart qui n'existe pas.
function ReportDeclarationRevenus({ annee, valeurs, formulaire: fige }: {
  annee: number
  valeurs: Map<string, number>
  // Les cases à l'euro d'une 2035 validée : le report dit ce qui a été validé, pas un nouvel arrondi.
  formulaire?: Map<string, number>
}) {
  const formulaire = fige ?? arrondirPourFormulaire(valeurs, annee)
  // Un montant ne se coupe pas en fin de ligne : `formaterMontant` est fait pour le PDF et sépare tout par des espaces
  // ordinaires. À l'écran, comme `formatMoney` mais à l'euro : espaces fines insécables entre les milliers, insécable avant l'euro.
  const montant = (code: string) => `${formaterMontant(formulaire.get(code) ?? 0).replace(/ /g, '\u202f')}\u00a0€`
  const deficit = formulaire.get('CR') ?? 0
  const brutNegatif = formulaire.get('DC') ?? 0
  return (
    <div style={{ padding: '12px 16px 14px', borderTop: '1px solid var(--color-border)', fontSize: '0.9rem' }}>
      <strong>Report sur la déclaration des revenus {annee}</strong>
      <span className="muted" style={{ marginLeft: 8 }}>montants à l'euro, tels que le formulaire les porte</span>
      <ul style={{ margin: '8px 0', paddingLeft: 20 }}>
        <li>
          {deficit > 0
            ? <>Déficit de {montant('CR')} : case 5QE de la déclaration 2042-C-PRO (5RE pour le second déclarant).</>
            : <>Bénéfice de {montant('CP')} : case 5QC de la déclaration 2042-C-PRO (5RC pour le second déclarant).</>}
        </li>
        <li>
          {brutNegatif > 0
            ? <>Revenu brut social négatif de {montant('DC')} (case DC) : rubrique DSDG du volet social (DSDH pour le second déclarant).</>
            : <>Revenu brut social de {montant('DD')} (case DD) : rubrique DSDE du volet social (DSDF pour le second déclarant).</>}
          {' '}Prérempli quand l'exploitant n'a déposé que cette 2035. Avec plusieurs liasses, on cumule
          leurs revenus bruts sociaux. L'Urssaf applique elle-même l'abattement de 26 % : ne pas le
          retrancher.
        </li>
      </ul>
      <p className="muted" style={{ margin: 0, fontSize: '0.9em' }}>
        Revenu brut social calculé comme le résultat, plus les charges sociales personnelles (BK) et
        la CSG déductible (BV), moins les indemnités journalières rangées sous leur poste en gains divers
        (DB). L'application ne connaît pas le reste du renvoi (26) de la notice : les exonérations de la
        ligne 43 (zones franches, zones déficitaires en offre de soins, déductions des médecins de
        secteur I…), les sommes à réintégrer (DE : plus-values à court terme exonérées, intéressement de
        l'exploitant, bénéfices non professionnels) et le reste des sommes à déduire (DB : indemnités
        journalières rangées sous un autre poste, déficits non professionnels). Si le dossier en porte,
        le revenu brut social est à reprendre.
      </p>
    </div>
  )
}
