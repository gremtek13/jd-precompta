import { useEffect, useRef, useState, type FormEvent } from 'react'
import DeuxFacteursDesComptes from '../../components/DeuxFacteursDesComptes'
import { casesDesAcces } from '../../lib/deuxFacteursExiges'
import { supabase } from '../../lib/supabase'
import EnvoyerEmailModal from '../../components/EnvoyerEmailModal'
import BandeauLecturePartielle from '../../components/BandeauLecturePartielle'
import ConfirmationArticle from './ConfirmationArticle'
import { extraireErreurFonction } from '../../lib/invokeErreur'
import { messageErreur } from '../../lib/messageErreur'
import { lireTout } from '../../lib/lectureComplete'
import {
  ADRESSE_DE_RETOUR, LONGUEUR_MINIMALE_MOT_DE_PASSE, REGLE_DU_MOT_DE_PASSE, avisDuLienEnvoye, messageErreurDuLienEnvoye,
  questionDuLienEnvoye, refusDeLaRegle,
} from '../../lib/recuperationMotDePasse'
import {
  CASES_SANS_EFFET, ceQueDitLaCaseDocuments, ceQueDitLaCaseSansEffet,
  CE_QUE_DONNE_UN_ACCES, DOMAINES, ceQueDisentLesCasesDuDossier, ceQueDitLaCaseCaisse, ceQueDitLaCaseComptes, changementApplique,
  confirmationDeLaCaseCaisse, demandeDeChangement, droitsDeLaLigne, enumeration, gesteDeLaCase, libelleDeLaCase, messageDuRefus,
  refusDeLaCase, type Domaine,
} from '../../lib/droitsAcces'
import { lireLeReglageDuDossier, type LectureDuReglage } from '../../lib/reglageDuDossierLecture'
import {
  CE_QUE_FAIT_LA_NATURE, NATURE_NON_ENREGISTREE, categoriesDeLaNature, natureDite, phraseDeLaNature, refusDeLaNature,
} from '../../lib/natureDesRecettes'
import {
  fixerLaNatureDesRecettes, lireLesCategoriesDeLaNature, type LectureDesCategoriesDeLaNature,
} from '../../lib/natureDesRecettesLecture'
import {
  avisDeLAccesCree, compteDeLaReponse, confirmationDuRattachement, copieDuRefus, corpsDeLaCreation, refusARattacher,
} from '../../lib/creationDesComptes'
import { CE_QUE_DIT_LA_COLLECTE } from '../../lib/piecesJointesEcarteesClient'
import { adresseDeCollecte } from '../../lib/adresseCollecte'
import { useCopieDuTexte } from '../../lib/copieDuTexte'
import type { Membership } from '../../lib/types'
import { accesDeLaLecture } from '../../lib/auteursVentes'
import TraceDesDroitsDesAcces from './TraceDesDroitsDesAcces'
import { SITUATIONS_PUBLIEES_EXPORTEES } from '../../lib/situationsPubliees'
import { TROIS_CASES_EXPORTEES } from '../../lib/troisCasesDeLAcces'
import { DOSSIER_DU_CABINET_PREVU, etatDuFormulaireDAcces, type EtatDuFormulaireDAcces } from '../../lib/dossierDuCabinet'
import { useDesignationDuDossier } from '../../lib/dossierDuCabinetLecture'

// Les colonnes d'un accès. « Comptes » (étape C4b) n'est demandée qu'avec sa migration : avant, la colonne n'existe pas.
// Typée comme la forme la plus longue : drapeau baissé, `droit_comptes` manque à la ligne, et `droitsDeLaLigne` n'en
// accorde aucun.
const COLONNES_DES_ACCES = (TROIS_CASES_EXPORTEES
  ? 'id, user_id, email, droit_ventes, droit_banque, droit_caisse, droit_comptes, droit_achats, droit_frais, droit_documents'
  : SITUATIONS_PUBLIEES_EXPORTEES
    ? 'id, user_id, email, droit_ventes, droit_banque, droit_caisse, droit_comptes'
    : 'id, user_id, email, droit_ventes, droit_banque, droit_caisse'
) as 'id, user_id, email, droit_ventes, droit_banque, droit_caisse, droit_comptes, droit_achats, droit_frais, droit_documents'

// Un accès tel que l'onglet le lit : la personne, et ses trois droits (espace client, étape P1 ; « Caisse » depuis l'étape
// C11 de la ligne 26.6 — voir lib/droitsAcces.ts).
type AccesLu = Pick<Membership, 'id' | 'user_id' | 'email' | 'droit_ventes' | 'droit_banque' | 'droit_caisse' | 'droit_comptes'
  | 'droit_achats' | 'droit_frais' | 'droit_documents'>

export default function AccesTab({ dossierId, dossierNom, codeEmail }: { dossierId: string; dossierNom: string; codeEmail: string | null }) {
  const [rows, setRows] = useState<AccesLu[]>([])
  // Le dossier du cabinet ne reçoit aucun accès client (ligne 47, LM2) : la désignation, lue pour CE dossier (une lecture qui ne
  // rejette jamais, gardée avec l'identifiant), juge le formulaire AVANT le clic. Drapeau baissé, rien ne se lit et le
  // formulaire est offert comme hier ; levé, jamais « offert » sur une désignation pas encore revenue ou illisible.
  const designation = useDesignationDuDossier(dossierId, 0)
  const formulaire: EtatDuFormulaireDAcces = DOSSIER_DU_CABINET_PREVU
    ? etatDuFormulaireDAcces(designation, dossierId)
    : { etat: 'offert' }
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  // Ce que la dernière création a fait du compte (décision du cabinet du 10/10/2026 : un compte qui existe déjà garde son
  // mot de passe) — sans cet avis, le cabinet communiquerait au client un mot de passe qui n'a pas été posé.
  const [avisCreation, setAvisCreation] = useState<string | null>(null)
  const [inviting, setInviting] = useState(false)
  // Le rattachement d'un compte que ce cabinet ne connaît pas, ou plus (23-Q2, décision du cabinet du 18/10/2026) : la
  // fonction a refusé la création en disant qu'une confirmation est possible. L'adresse et le mot de passe sont gardés
  // TELS QU'ILS SONT PARTIS : la fenêtre nomme l'adresse que le second appel enverra, quoi qu'il arrive ensuite au champ.
  const [aRattacher, setARattacher] = useState<{ email: string; password: string } | null>(null)
  const [relanceDe, setRelanceDe] = useState<AccesLu | null>(null)
  // « Aucun accès client pour ce dossier » est une AFFIRMATION, pas un écran vide : une lecture
  // refusée rendait la même liste vide, et le cabinet en concluait qu'il ne restait aucun accès.
  // C'est le pire sens pour ce geste-là — on coupe l'accès d'un client qui part, et on croit l'avoir
  // fait. Même famille que la suppression d'un dossier : une lecture dont l'échec ressemble à un
  // résultat vide se vérifie comme une écriture.
  const [erreurLecture, setErreurLecture] = useState<string | null>(null)
  // La liste lue en partie (des accès revenus, d'autres non) : elle se montre, avec sa raison, mais n'offre AUCUNE case —
  // un droit ne se change pas depuis une liste dont on sait qu'elle est incomplète.
  const [lecturePartielle, setLecturePartielle] = useState<string | null>(null)
  // Vrai tant que la PREMIÈRE lecture n'est pas revenue : avant elle, la liste est vide faute d'avoir été lue, et l'écran
  // disait « Aucun accès client pour ce dossier. » au premier rendu, y compris pour un dossier qui en a un. Il ne vaut que
  // pour la première lecture : `load()` repart après une création ou un retrait, et la liste déjà lue reste sous les yeux
  // jusqu'à la relecture. Un autre dossier remonte l'onglet (`AnneeProvider key`), donc repart à vrai.
  const [chargement, setChargement] = useState(true)
  // Une RELECTURE en vol : la liste reste sous les yeux, mais ses cases attendent qu'elle revienne, et l'écran le dit.
  const [relecture, setRelecture] = useState(false)
  // Le numéro de la dernière lecture partie : une lecture plus lente qu'une suivante (une création puis un retrait
  // rapprochés) ne réécrit pas la liste après elle.
  const derniereLecture = useRef(0)
  // Le numéro de la dernière lecture REVENUE de la liste : la trace des droits (« Droits changés ») se relit avec elle, car une
  // case cochée ou un accès créé en a écrit une ligne.
  const [lectureNo, setLectureNo] = useState(0)
  // Le réglage du dossier (`ventes_par_les_factures`, chantier EC-Q3, étape VF8d), lu avec la liste, dans la même vague :
  // la case « Ventes » ne se coche que sur un dossier basculé, ne se change pas sur un réglage illisible
  // (lib/droitsAcces.ts, `gesteDeLaCase`). Gardé AVEC le dossier lu : une réponse pour un autre dossier ne juge pas celui-ci.
  // Rien ne s'offre avant son retour : ni case, ni phrase des cases.
  // Depuis l'étape C11, la même ligne porte le statut de TVA, qui ouvre la case « Caisse » (exonéré ou en franchise en base),
  // et la nature des recettes en espèces du client, que le cabinet fixe sous la liste ; depuis C11-Q2, le mode comptable : la
  // case ne se coche pas sur un dossier tenu en engagement (l'écran plus strict que la base, lib/droitsAcces.ts).
  const [reglageLu, setReglageLu] = useState<LectureDuReglage | null>(null)
  // Les catégories que la nature peut prendre (celles du dossier et les communes), lues EN ENTIER dans la même vague, gardées
  // avec le dossier lu : lues en partie, la carte de la nature n'offre aucun geste, et le dit.
  const [categoriesLues, setCategoriesLues] = useState<LectureDesCategoriesDeLaNature | null>(null)
  // La case « Caisse » qu'un clic veut cocher : elle attend la confirmation, qui nomme la personne, ce que la case ouvre et la
  // condition que le cabinet déclare (la conception reprise, § 3). Décocher ne se confirme pas, comme les deux autres cases.
  const [caisseAConfirmer, setCaisseAConfirmer] = useState<AccesLu | null>(null)
  // La nature choisie dans la liste, avant « Enregistrer » ; nulle tant que rien n'a été choisi (la liste montre la nature lue).
  const [natureChoisie, setNatureChoisie] = useState<string | null>(null)
  // Le verrou de l'écriture de la nature : un `useRef` posé avant l'appel, relâché dans un `finally` APRÈS la relecture.
  const ecritureNatureEnCours = useRef(false)
  const [natureEnCours, setNatureEnCours] = useState(false)
  const [avisNature, setAvisNature] = useState<{ ok: boolean; texte: string } | null>(null)

  // Verrou d'exécution en `useRef`, pas en état React : `setInviting(true)` ne prend effet qu'au
  // rendu suivant, donc `disabled={inviting}` laisse passer deux soumissions rapprochées — sur un
  // FORMULAIRE le déclencheur n'est même pas le double clic mais deux « Entrée » (CLAUDE.md, motif
  // déjà vu sur EnvoyerEmailModal, FactureAvoirModal et consorts). Posé AVANT le `try` : dedans, le
  // `return` du deuxième clic sortirait par le `finally`, qui relâcherait le verrou du PREMIER,
  // encore en cours.
  //
  // Le doublon ne crée pas qu'une ligne en trop : create-client-access appelle
  // `auth.admin.createUser` deux fois pour la même adresse, une course entre les deux appels que la
  // fonction ne peut pas fermer elle-même (elle ne voit rien de la seconde requête pendant que la
  // première est en vol) — au mieux un message d'erreur incompréhensible pour un accès qui vient
  // pourtant d'être créé, au pire deux appels admin facturés pour rien.
  const creationEnCours = useRef(false)

  // Le verrou des cases, en `useRef` comme celui de la création, posé avant le `try`. C'est la SECONDE barrière : une case
  // est une entrée contrôlée, React rend donc toutes les cases grisées avant la fin de l'événement qui en coche une, et un
  // second clic n'atteint pas `changerDroit`. Le verrou tient le jour où une case resterait libre pendant l'écriture — deux
  // écritures partiraient, la seconde calculée sur la liste d'avant la première. Relâché APRÈS la relecture : la case
  // montre alors ce que la base a gardé, et le clic suivant part de cet état-là.
  const ecritureDroitsEnCours = useRef(false)
  // La case cliquée, le temps de son écriture : elle montre la valeur demandée, et toutes les cases attendent.
  const [droitEnCours, setDroitEnCours] = useState<{ id: string; domaine: Domaine; valeur: boolean } | null>(null)
  const [erreurDroits, setErreurDroits] = useState<string | null>(null)

  // Le verrou de l'envoi d'un lien de réinitialisation, en `useRef` et posé avant le `try` comme les deux autres : chaque
  // envoi part en e-mail dans la boîte du client et compte dans le débit du service, qui refuserait le second en « trop de
  // demandes » — le cabinet lirait un refus sur un lien pourtant parti. Un seul envoi à la fois, tous accès confondus.
  const envoiLienEnCours = useRef(false)
  // L'accès dont le lien part : son bouton le dit, et tous les boutons de lien attendent.
  const [lienEnCours, setLienEnCours] = useState<string | null>(null)
  // Ce que le dernier envoi a donné, avec l'adresse VISÉE au clic (pas celle d'une ligne relue depuis).
  const [avisLien, setAvisLien] = useState<{ envoye: boolean; texte: string } | null>(null)

  async function load() {
    const numero = ++derniereLecture.current
    setRelecture(true)
    // Par `lireTout`, qui dit si la liste est COMPLÈTE : une poignée de personnes aujourd'hui, mais ses cases écrivent
    // depuis elle, et « Aucun accès » est une affirmation.
    // Le réglage, dans la même vague : la lecture ne rejette jamais (un échec le rend illisible, avec son motif). Les catégories
    // de la nature aussi (étape C11).
    const [lecture, reglageRelu, categoriesRelues] = await Promise.all([
      lireTout<AccesLu>((debut, fin) => supabase
        .from('memberships')
        .select(COLONNES_DES_ACCES, { count: 'exact' })
        .eq('dossier_id', dossierId)
        .order('created_at')
        .order('id')
        .range(debut, fin)),
      lireLeReglageDuDossier(dossierId),
      lireLesCategoriesDeLaNature(dossierId),
    ])
    if (numero !== derniereLecture.current) return
    setReglageLu(reglageRelu)
    setCategoriesLues(categoriesRelues)
    setNatureChoisie(null)
    const rien = !lecture.complete && lecture.lignes.length === 0
    setErreurLecture(rien ? `La liste des accès n'a pas pu être lue (${lecture.motif ?? 'raison inconnue'}).` : null)
    setLecturePartielle(!lecture.complete && !rien ? lecture.motif : null)
    setRows(lecture.lignes)
    setLectureNo(numero)
    setChargement(false)
    setRelecture(false)
  }

  useEffect(() => { load() }, [dossierId])

  async function handleCreateAccess(e: FormEvent) {
    e.preventDefault()
    if (creationEnCours.current) return
    // Ce que l'écran n'offre pas ne part pas non plus : la base et la fonction refuseraient (409), mais rien n'est tenté.
    if (formulaire.etat !== 'offert') return
    // La règle des mots de passe du projet, dite sous le champ, jugée avant tout appel : le service la ferait respecter de
    // toute façon (lib/recuperationMotDePasse.ts, un reflet de son réglage). Rien ne part, ni compte ni accès.
    const refusRegle = refusDeLaRegle(password)
    if (refusRegle !== null) {
      setError(refusRegle)
      setAvisCreation(null)
      return
    }
    creationEnCours.current = true
    setInviting(true)
    setError(null)
    // L'avis de la création précédente s'efface : rien ne dit « créé » d'un accès encore en vol. Une confirmation restée
    // ouverte cède aussi : elle nommait l'adresse d'un envoi précédent.
    setAvisCreation(null)
    setARattacher(null)
    try {
      await envoyerLaCreation(email, password, false)
    } catch (err) {
      setError(messageErreur(err))
    } finally {
      creationEnCours.current = false
      setInviting(false)
    }
  }

  // « Rattacher ce compte » (23-Q2) : le second appel, confirmé, sous le MÊME verrou que la création — posé avant le `try`,
  // relâché dans le `finally`, après la relecture de la liste —, avec l'adresse et le mot de passe du premier. La fenêtre
  // reste ouverte pendant l'appel, ses deux boutons en attente, puis se ferme : un refus se dit sous le formulaire, comme
  // celui d'une création.
  async function confirmerLeRattachement() {
    if (creationEnCours.current) return
    const demande = aRattacher
    if (demande === null) return
    creationEnCours.current = true
    setInviting(true)
    setError(null)
    try {
      await envoyerLaCreation(demande.email, demande.password, true)
    } catch (err) {
      setError(messageErreur(err))
    } finally {
      setARattacher(null)
      creationEnCours.current = false
      setInviting(false)
    }
  }

  // L'appel de create-client-access, toujours sous le verrou de son appelant : la création (`confirme` faux), ou le
  // rattachement confirmé d'un compte que ce cabinet ne connaît pas (`confirme` vrai, 23-Q2). L'adresse et le mot de
  // passe sont ceux qui PARTENT : l'avis nomme l'adresse envoyée, le champ se vide après. Lève sur un refus, qui se dit.
  async function envoyerLaCreation(adresse: string, motDePasse: string, confirme: boolean) {
    // Passe par une fonction Edge (clé de service) plutôt qu'un signUp() classique côté navigateur :
    // retirer un accès (bouton "Retirer" ci-dessous) ne supprime que la ligne memberships, jamais le
    // compte Auth sous-jacent — un signUp() sur la même adresse pour un autre dossier échouerait donc
    // en "déjà inscrit". La fonction réutilise le compte existant le cas échéant. L'accès qu'elle crée n'a
    // aucun droit (les deux cases sont fausses par défaut en base) : le cabinet les coche ensuite.
    const { data, error: invokeError } = await supabase.functions.invoke<{ ok?: true; compte?: string; error?: string }>(
      'create-client-access',
      { body: corpsDeLaCreation(dossierId, adresse, motDePasse, confirme) },
    )
    // Sur un statut non-2xx, supabase-js jette systématiquement un FunctionsHttpError générique
    // ("Edge Function returned a non-2xx status code") dans invokeError SANS jamais remplir data
    // (voir lib/invokeErreur.ts) — le message précis qu'on renvoie nous-mêmes (403/409/500...) se
    // lit sur invokeError.context, jamais sur data.error (toujours undefined dans ce cas).
    if (data?.error) throw new Error(data.error)
    if (invokeError) {
      // Le corps d'un refus ne se lit qu'une fois : sa copie pour le marqueur, l'original à `extraireErreurFonction`.
      const copie = copieDuRefus(invokeError)
      const message = await extraireErreurFonction(invokeError)
      // Le marqueur ne vaut qu'au PREMIER appel : un appel déjà confirmé qui le rendrait encore ne rouvre pas la fenêtre
      // (aucune boucle), il se dit comme tout refus.
      if (!confirme && await refusARattacher(copie)) {
        setARattacher({ email: adresse, password: motDePasse })
        return
      }
      throw new Error(message)
    }
    if (!data?.ok) throw new Error("La création de l'accès n'a rien retourné.")

    setAvisCreation(avisDeLAccesCree(adresse, compteDeLaReponse(data)))
    setEmail('')
    setPassword('')
    // Attendue : le verrou de l'appelant ne se relâche qu'une fois la liste relue.
    await load()
  }

  // Une case cochée ou décochée : `changer_droits_acces`, la seule écriture des droits — `memberships` n'a aucune policy de
  // mise à jour, et un `update` direct ne toucherait aucune ligne sans rien dire. N'envoie que le droit cliqué
  // (`demandeDeChangement`) : l'autre reste tel qu'en base. Refusé, le refus se dit avec la personne et le droit visés ;
  // la relecture remet la case comme la base l'a gardée.
  //
  // La case grisée ne s'offre pas (étape VF8d) ; si un geste arrivait quand même jusqu'ici, le refus du module se dit, avec la
  // personne et le droit, et rien ne part — un réglage pas encore lu, ou lu pour un autre dossier, ne juge rien.
  //
  // COCHER « CAISSE » SE CONFIRME (étape C11) : le clic ouvre la fenêtre, et rien ne part avant « Cocher « Caisse » » ; le refus
  // du module se dit AVANT de l'ouvrir — sur un dossier ni exonéré ni en franchise, aux mots de `garder_droit_caisse`.
  function changerDroit(acces: AccesLu, domaine: Domaine, valeur: boolean) {
    if (ecritureDroitsEnCours.current) return
    const personne = acces.email ?? acces.user_id
    const refusAvant = refusAvantLeClic(domaine, valeur)
    if (refusAvant !== null) {
      setErreurDroits(messageDuRefus(domaine, personne, refusAvant))
      return
    }
    if (domaine === 'caisse' && valeur) {
      setErreurDroits(null)
      setCaisseAConfirmer(acces)
      return
    }
    void ecrireLeDroit(acces, domaine, valeur)
  }

  // Le refus d'une case, dit avant tout appel : la ligne du dossier pas encore lue, ou lue pour un autre, ne juge rien.
  function refusAvantLeClic(domaine: Domaine, valeur: boolean): string | null {
    return reglage === null || caisse === null
      ? 'la ligne du dossier (sa source des ventes, son statut de TVA, son mode comptable) n’est pas encore lue.'
      : refusDeLaCase(domaine, valeur, reglage, caisse)
  }

  // « Cocher « Caisse » », dans la fenêtre : le refus se rejuge sur la ligne du dossier d'AUJOURD'HUI (une relecture a pu passer
  // pendant que la fenêtre était ouverte), puis l'écriture, sous le verrou des cases ; la fenêtre se ferme après la relecture,
  // et un refus de la base se dit sous la liste, avec la personne et le droit.
  async function confirmerLaCaisse() {
    const acces = caisseAConfirmer
    if (acces === null || ecritureDroitsEnCours.current) return
    const refusAvant = refusAvantLeClic('caisse', true)
    if (refusAvant !== null) {
      setErreurDroits(messageDuRefus('caisse', acces.email ?? acces.user_id, refusAvant))
      setCaisseAConfirmer(null)
      return
    }
    try {
      await ecrireLeDroit(acces, 'caisse', true)
    } finally {
      setCaisseAConfirmer(null)
    }
  }

  async function ecrireLeDroit(acces: AccesLu, domaine: Domaine, valeur: boolean) {
    if (ecritureDroitsEnCours.current) return
    const personne = acces.email ?? acces.user_id
    ecritureDroitsEnCours.current = true
    setDroitEnCours({ id: acces.id, domaine, valeur })
    setErreurDroits(null)
    try {
      const { data, error: erreurEcriture } = await supabase.rpc('changer_droits_acces', demandeDeChangement(acces.id, domaine, valeur))
      if (erreurEcriture) {
        setErreurDroits(messageDuRefus(domaine, personne, messageErreur(erreurEcriture, 'refus de la base.')))
      } else if (!changementApplique(data, domaine, valeur)) {
        setErreurDroits(messageDuRefus(domaine, personne, 'la base n’a pas rendu le droit demandé ; la liste relue fait foi.'))
      }
      await load()
    } finally {
      ecritureDroitsEnCours.current = false
      setDroitEnCours(null)
    }
  }

  // « Enregistrer la nature » (étape C11 ; CAISSE2-Q2, (B)) : `dossiers.categorie_recettes_client`, sous la garde de la base,
  // dont le refus se dit AVANT le clic, à ses mots (`refusDeLaNature`) ; la base rend la ligne écrite, et une ligne qu'elle ne
  // rend pas se dit. Sous son verrou, relâché après la relecture : la carte montre alors la nature que la base a gardée.
  async function enregistrerLaNature(categorieId: string | null) {
    if (ecritureNatureEnCours.current) return
    if (categories === null || nature === null) return
    const refus = refusDeLaNature(categorieId, dossierId, categories)
    if (refus !== null) {
      setAvisNature({ ok: false, texte: `La nature n’a pas été enregistrée : ${refus}` })
      return
    }
    ecritureNatureEnCours.current = true
    setNatureEnCours(true)
    setAvisNature(null)
    try {
      const ecrite = await fixerLaNatureDesRecettes(dossierId, categorieId)
      setAvisNature(ecrite.ecrite
        ? { ok: true, texte: ecrite.categorieId === null ? 'La nature des recettes du client est retirée.' : 'La nature des recettes du client est enregistrée.' }
        : { ok: false, texte: `La nature n’a pas été enregistrée : ${ecrite.refus ?? NATURE_NON_ENREGISTREE}` })
      await load()
    } finally {
      ecritureNatureEnCours.current = false
      setNatureEnCours(false)
    }
  }

  // « Envoyer un lien de réinitialisation » (décision du cabinet du 10/10/2026) : le même lien que « Mot de passe oublié »,
  // par le même appel (`lib/recuperationMotDePasse.ts`), vers l'adresse de l'accès. Le client y choisit lui-même son
  // nouveau mot de passe ; le cabinet n'en pose aucun. Rien n'est écrit en base : aucune relecture ne suit.
  async function envoyerLien(acces: AccesLu) {
    const adresse = acces.email
    if (!adresse) return
    if (formulaire.etat === 'refuse') return
    if (envoiLienEnCours.current) return
    // `window.confirm` bloque : rien ne part avant la réponse, et un refus ne pose aucun verrou.
    if (!window.confirm(questionDuLienEnvoye(adresse))) return
    envoiLienEnCours.current = true
    setLienEnCours(acces.id)
    setAvisLien(null)
    try {
      const { error: erreurLien } = await supabase.auth.resetPasswordForEmail(adresse, { redirectTo: ADRESSE_DE_RETOUR })
      setAvisLien(erreurLien
        ? { envoye: false, texte: messageErreurDuLienEnvoye(adresse, erreurLien) }
        : { envoye: true, texte: avisDuLienEnvoye(adresse) })
    } catch (x) {
      // auth-js relance ce qui n'est pas une erreur d'authentification : il se dit aussi, jamais en erreur non gérée.
      setAvisLien({ envoye: false, texte: messageErreurDuLienEnvoye(adresse, x) })
    } finally {
      envoiLienEnCours.current = false
      setLienEnCours(null)
    }
  }

  async function revoke(row: AccesLu) {
    // Couper l'accès d'un client ne se défait pas d'un clic : il faut recréer l'accès, qui reprend le même compte avec
    // son mot de passe (décision du cabinet du 10/10/2026) — et que `create-client-access` ne rattache plus que sur une
    // confirmation quand c'était le dernier lien de ce compte avec le cabinet (23-Q2). C'était le seul geste destructeur
    // de cet écran à partir sans rien demander, dans une colonne d'actions où il voisine « Relancer ». Ses droits partent
    // avec lui : un accès recréé n'en a aucun, la confirmation le nomme.
    const droits = droitsDeLaLigne(row)
    const droitsTenus = DOMAINES.filter((d) => droits[d.domaine]).map((d) => `« ${d.libelle} »`)
    if (!window.confirm(
      `Retirer l'accès de ${row.email ?? 'ce compte'} au dossier ? Le client ne pourra plus déposer `
      + 'de pièces tant qu\'un nouvel accès ne lui aura pas été créé.'
      + (droitsTenus.length > 0
        ? ` Ses droits ${enumeration(droitsTenus)} partent avec lui : un nouvel accès n'en a pas, il faudra les recocher.`
        : ''),
    )) return
    // Le `load()` qui suit montre normalement l'échec (la ligne réapparaît) — sauf quand il échoue
    // pour la MÊME raison, et la liste se vide alors au lieu de garder sa ligne : l'écran dirait
    // « aucun accès » précisément quand l'accès est toujours là.
    const { error: deleteError } = await supabase.from('memberships').delete().eq('id', row.id)
    if (deleteError) {
      setError(messageErreur(deleteError, "L'accès n'a pas pu être retiré."))
      return
    }
    setError(null)
    load()
  }

  const adresseCollecte = adresseDeCollecte(codeEmail)
  // Le « Copié ✓ » et son minuteur : lib/copieDuTexte.ts, le même que « Mes pièces » du client.
  const { copie, refusee: copieRefusee, copier: copierAdresse } = useCopieDuTexte(adresseCollecte)

  // Les cases ne s'offrent que sur une liste lue EN ENTIER ; lue en partie, chaque droit se lit, sans se changer. Le lien
  // de réinitialisation suit la même règle : il part vers l'adresse d'une ligne, et une liste tronquée ou pas encore
  // revenue n'en est pas une que le cabinet a pu vérifier.
  // Et sur le réglage du dossier revenu, lu pour CE dossier : avant lui, la case « Ventes » ne se jugerait pas.
  const reglage = reglageLu !== null && reglageLu.dossierId === dossierId ? reglageLu.reglage : null
  // Le statut de TVA (étape C11), de la même ligne, lu pour CE dossier : avant lui, la case « Caisse » ne se jugerait pas.
  const caisse = reglageLu !== null && reglageLu.dossierId === dossierId ? reglageLu.caisse : null
  const casesOffertes = !chargement && erreurLecture === null && lecturePartielle === null && reglage !== null && caisse !== null

  // La nature des recettes du client (étape C11) : la colonne lue avec la ligne du dossier, ses catégories lues en entier, l'une
  // et l'autre pour CE dossier. Sinon rien ne s'offre, et la carte dit pourquoi.
  const nature = reglageLu !== null && reglageLu.dossierId === dossierId ? reglageLu.nature : null
  const categories = categoriesLues !== null && categoriesLues.dossierId === dossierId && categoriesLues.etat === 'lues'
    ? categoriesLues.categories : null
  const natureLue = nature === null ? null : natureDite(nature.etat === 'lue' ? nature.categorieId : undefined, dossierId, categories)
  const natureAffichee = natureChoisie ?? (nature?.etat === 'lue' ? nature.categorieId ?? '' : '')
  const refusDeLaNatureChoisie = categories === null ? null : refusDeLaNature(natureAffichee === '' ? null : natureAffichee, dossierId, categories)
  const natureModifiee = nature?.etat === 'lue' && natureChoisie !== null && natureChoisie !== (nature.categorieId ?? '')
  const motifDeLaNature = nature === null || categoriesLues === null || categoriesLues.dossierId !== dossierId
    ? null
    : nature.etat === 'illisible' ? nature.motif : categoriesLues.etat === 'incompletes' ? `les catégories : ${categoriesLues.motif}` : null

  return (
    <>
      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginTop: 0 }}>Collecte automatique par e-mail</h3>
        <p className="muted" style={{ marginTop: -8 }}>
          Le client transfère ses e-mails de prélèvement récurrent (assurance, cotisations…) vers cette adresse —
          un simple réglage de transfert automatique dans sa boîte, sans jamais donner accès à sa messagerie.
          {' '}{CE_QUE_DIT_LA_COLLECTE}
        </p>
        {adresseCollecte ? (
          <div className="field-row" style={{ alignItems: 'center' }}>
            <code style={{ background: 'var(--surface-2, #f4f4f4)', padding: '6px 10px', borderRadius: 6 }}>
              {adresseCollecte}
            </code>
            <button type="button" className="btn btn-outline btn-sm" onClick={copierAdresse}>
              {copie ? 'Copié ✓' : 'Copier'}
            </button>
            {copieRefusee && <span className="muted" role="status">Le navigateur a refusé la copie : sélectionne l'adresse pour la copier.</span>}
          </div>
        ) : (
          <p className="muted">Adresse en cours de génération — recharge la page si elle n'apparaît pas.</p>
        )}
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginTop: 0 }}>Donner un accès client</h3>
        <p className="muted" style={{ marginTop: -8 }}>{CE_QUE_DONNE_UN_ACCES}</p>
        {formulaire.etat !== 'offert' && (
          // Le refus du dossier du cabinet se dit avant le clic, aux mots de la garde ; une désignation pas lue ou illisible
          // retient le formulaire et le dit : aucun champ, aucun bouton.
          <p role={formulaire.etat === 'attend' ? 'status' : 'alert'} className={formulaire.etat === 'attend' ? 'muted' : 'error-text'}>
            {formulaire.phrase}
          </p>
        )}
        {formulaire.etat === 'offert' && (
          <form onSubmit={handleCreateAccess}>
            <div className="field-row">
              <div className="field">
                <label htmlFor="email">Email du client</label>
                <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="password">Mot de passe initial</label>
                {/* `new-password` : un champ de mot de passe après un champ d'adresse a la forme d'une connexion, et le navigateur
                    pouvait y remplir l'adresse et le mot de passe du cabinet, qu'il connaît pour ce site. */}
                <input
                  id="password" type="password" required minLength={LONGUEUR_MINIMALE_MOT_DE_PASSE} autoComplete="new-password"
                  aria-describedby="password-regle" value={password} onChange={(e) => setPassword(e.target.value)}
                />
                <span className="muted" id="password-regle">{REGLE_DU_MOT_DE_PASSE}</span>
                <span className="muted">C'est toi qui le choisis et le communiques au client, pas lui. Il ne sert qu'à un compte neuf : un client qui a déjà un compte garde le sien.</span>
              </div>
            </div>
            {error && <p className="error-text">{error}</p>}
            {avisCreation && <p role="status">{avisCreation}</p>}
            <button className="btn btn-primary" type="submit" disabled={inviting || aRattacher !== null}>
              {inviting ? 'Création…' : 'Créer l\'accès'}
            </button>
          </form>
        )}
      </div>

      {/* Les cases de chaque accès, pour la recommandation de SEC-Q2 : d'une liste lue EN ENTIER seulement ; avant son retour,
          lue en partie ou illisible, aucune (le composant ne recommande alors rien à un accès client). */}
      <DeuxFacteursDesComptes perimetre={{ genre: 'acces', dossierId }}
        cases={!chargement && erreurLecture === null && lecturePartielle === null ? casesDesAcces(rows) : undefined} />
      <h3>Accès actuels</h3>
      {reglage !== null && (
        <p className="muted" id="ce-que-disent-les-cases" style={{ marginTop: -8 }}>{ceQueDisentLesCasesDuDossier(reglage)}</p>
      )}
      {/* La troisième case (étape C11) : ce que la base ouvre au client qui la porte, et ce qu'elle devient sur CE dossier. */}
      {caisse !== null && (
        <p className="muted" id="ce-que-dit-la-case-caisse">{ceQueDitLaCaseCaisse(caisse)}</p>
      )}
      {/* La quatrième case (étape C4b), avec sa migration seulement : ce que la base ouvre au client qui la porte. */}
      {SITUATIONS_PUBLIEES_EXPORTEES && (
        <p className="muted" id="ce-que-dit-la-case-comptes">{ceQueDitLaCaseComptes()}</p>
      )}
      {TROIS_CASES_EXPORTEES && CASES_SANS_EFFET.map((d) => (
        <p className="muted" id={`ce-que-dit-la-case-${d}`} key={d}>{ceQueDitLaCaseSansEffet(d)}</p>
      ))}
      {/* « Documents », avec sa migration (étape B3a) : ce que la base ouvre au client qui la porte. */}
      {TROIS_CASES_EXPORTEES && !CASES_SANS_EFFET.includes('documents') && (
        <p className="muted" id="ce-que-dit-la-case-documents">{ceQueDitLaCaseDocuments()}</p>
      )}
      {rows.length > 0 && (
        <BandeauLecturePartielle
          quoi="La liste des accès" accord="lue" motif={lecturePartielle}
          consequence="Les droits ne se changent pas depuis une liste incomplète, et un accès qu'on ne voit pas ne se retire pas : recharge la page."
        />
      )}
      {relecture && !chargement && <p className="muted" role="status">Relecture de la liste des accès : les cases attendent son retour.</p>}
      {erreurDroits && <p className="error-text" role="alert">{erreurDroits}</p>}
      {avisLien && (avisLien.envoye
        ? <p role="status">{avisLien.texte}</p>
        : <p className="error-text" role="alert">{avisLien.texte}</p>)}
      {/* Repliée en fiches sous 860 pixels de carte, comme l'équipe du cabinet : les deux cases et les boutons d'un accès
          passeraient sinon derrière un défilement latéral que rien n'annonce. */}
      <div className="card table-scroll tableau-adaptable" style={{ padding: 0 }}>
        {chargement ? (
          // Ni la liste ni « Aucun accès… » : tant que rien n'a été lu, ni l'une ni l'autre ne serait vraie.
          <p className="muted" style={{ padding: 20 }}>Chargement…</p>
        ) : erreurLecture === null && rows.length > 0 ? (
          <table className="table-empilable table-empilable-en-carte">
            <thead>
              <tr>
                <th>Utilisateur</th>
                {DOMAINES.map((d) => <th key={d.domaine}>{d.libelle}</th>)}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const personne = r.email ?? r.user_id
                const droits = droitsDeLaLigne(r)
                return (
                  <tr key={r.id}>
                    <td data-libelle="Utilisateur">{personne}</td>
                    {DOMAINES.map((d) => {
                      // Le geste que le réglage laisse à CETTE case, dans son état lu : une case « Ventes » cochée d'un
                      // dossier non basculé se décoche, décochée elle est grisée ; illisible, grisée dans les deux états. Sa
                      // raison est dans la phrase au-dessus de la liste, que la case désigne. « Caisse » (étape C11) suit le statut
                      // de TVA de la même façon, et désigne sa propre phrase.
                      const geste = reglage === null || caisse === null ? null : gesteDeLaCase(d.domaine, reglage, caisse)
                      const offert = geste !== null && (droits[d.domaine] ? geste.decocher : geste.cocher)
                      return (
                        <td key={d.domaine} data-libelle={d.libelle}>
                          {casesOffertes ? (
                            <input
                              type="checkbox"
                              aria-label={libelleDeLaCase(d.domaine, personne)}
                              aria-describedby={offert ? undefined : d.domaine === 'caisse' ? 'ce-que-dit-la-case-caisse' : 'ce-que-disent-les-cases'}
                              title={offert ? undefined : geste?.raison ?? undefined}
                              checked={droitEnCours?.id === r.id && droitEnCours.domaine === d.domaine ? droitEnCours.valeur : droits[d.domaine]}
                              disabled={droitEnCours !== null || relecture || caisseAConfirmer !== null || !offert}
                              onChange={(e) => changerDroit(r, d.domaine, e.target.checked)}
                            />
                          ) : (
                            <span>{droits[d.domaine] ? 'Oui' : 'Non'}</span>
                          )}
                        </td>
                      )
                    })}
                    <td className="td-actions">
                      {r.email && (
                        <button className="btn btn-outline btn-sm" onClick={() => setRelanceDe(r)}>Relancer</button>
                      )}
                      {r.email && casesOffertes && formulaire.etat !== 'refuse' && (
                        <button
                          type="button"
                          className="btn btn-outline btn-sm"
                          disabled={lienEnCours !== null || relecture}
                          onClick={() => envoyerLien(r)}
                        >
                          {lienEnCours === r.id ? 'Envoi du lien…' : 'Envoyer un lien de réinitialisation'}
                        </button>
                      )}
                      <button className="btn btn-danger btn-sm" onClick={() => revoke(r)}>Retirer</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        ) : erreurLecture ? (
          <div className="empty-state error-text">
            {erreurLecture} On ne peut donc pas dire qui a accès à ce dossier — surtout ne pas en
            conclure que personne ne l'a. Recharge la page.
          </div>
        ) : (
          <div className="empty-state">Aucun accès client pour ce dossier.</div>
        )}
      </div>

      {/* LA TRACE DES DROITS (étape P1-trace) : qui a coché ou décoché quelle case, un volet par accès. Rien avant le retour de la
          liste des accès ; « retiré » ne se dit que d'une liste lue en entier, et le client n'est reconnu que sur elle. */}
      {!chargement && (
        <TraceDesDroitsDesAcces
          dossierId={dossierId}
          acces={rows.map((r) => ({ id: r.id, email: r.email }))}
          listeLue={erreurLecture === null && lecturePartielle === null}
          accesDuDossier={erreurLecture === null && lecturePartielle === null
            ? accesDeLaLecture({ lignes: rows, complete: true, motif: null })
            : { etat: 'incomplets', motif: erreurLecture ?? lecturePartielle ?? 'lecture incomplète' }}
          lectureNo={lectureNo}
        />
      )}

      {/* LA NATURE DES RECETTES EN ESPÈCES DU CLIENT (étape C11 ; CAISSE2-Q2, (B)) : le cabinet la fixe pour le dossier, sous la
          liste, à côté de la case qu'elle sert. Rien ne s'offre avant le retour de la ligne du dossier et de ses catégories, ni
          sur une lecture partielle, refusée ou rompue : la carte le dit. Le refus de la base se dit avant le clic. */}
      <div className="card" style={{ marginTop: 20 }}>
        <h3 style={{ marginTop: 0 }}>Recettes en espèces saisies par le client</h3>
        <p className="muted" style={{ marginTop: -8 }}>{CE_QUE_FAIT_LA_NATURE}</p>
        {nature === null || categoriesLues === null || categoriesLues.dossierId !== dossierId ? (
          <p className="muted">Chargement de la nature des recettes…</p>
        ) : motifDeLaNature !== null || natureLue === null || categories === null ? (
          <BandeauLecturePartielle
            quoi="La nature des recettes du client" accord="lue" motif={motifDeLaNature ?? 'lecture incomplète'}
            consequence="Elle ne se change pas d’ici : recharge la page."
          />
        ) : (
          <>
            <p style={{ margin: '0 0 10px' }}>{phraseDeLaNature(natureLue)}</p>
            <div className="field-row aligne-bas">
              <div className="field">
                <label htmlFor="nature-recettes-client">Nature (une catégorie de produit du dossier, ou commune)</label>
                <select
                  id="nature-recettes-client"
                  value={natureAffichee}
                  disabled={natureEnCours || relecture}
                  onChange={(e) => { setNatureChoisie(e.target.value); setAvisNature(null) }}
                >
                  <option value="">Aucune — ses recettes se refusent</option>
                  {categoriesDeLaNature(categories, dossierId).map((c) => <option key={c.id} value={c.id}>{c.libelle}</option>)}
                  {/* Une nature fixée qui n'est plus une catégorie de produit reste montrée, pour qu'on la voie et la corrige. */}
                  {natureLue.etat === 'hors_produit' && nature.etat === 'lue' && nature.categorieId !== null && (
                    <option value={nature.categorieId} disabled>N’est plus une catégorie de produit</option>
                  )}
                </select>
              </div>
              <button
                type="button" className="btn btn-primary btn-sm"
                disabled={!natureModifiee || natureEnCours || relecture || refusDeLaNatureChoisie !== null}
                onClick={() => { void enregistrerLaNature(natureAffichee === '' ? null : natureAffichee) }}
              >
                {natureEnCours ? 'Enregistrement…' : 'Enregistrer la nature'}
              </button>
            </div>
            {natureModifiee && refusDeLaNatureChoisie !== null && <p className="error-text" role="alert">{refusDeLaNatureChoisie}</p>}
          </>
        )}
        {avisNature && <p className={avisNature.ok ? 'muted' : 'error-text'} role={avisNature.ok ? 'status' : 'alert'}>{avisNature.texte}</p>}
      </div>

      {/* La confirmation de la case « Caisse » (étape C11) : une fenêtre de la page, qui nomme la personne, ce que la case ouvre,
          la condition que le cabinet déclare selon le statut LU, ce qu'elle retient et la nature des recettes. « Annuler »
          n'envoie rien ; le refus du module, rejugé sur la ligne du dossier d'aujourd'hui, grise le bouton. */}
      {caisseAConfirmer && (() => {
        const personne = caisseAConfirmer.email ?? caisseAConfirmer.user_id
        // Le statut a changé depuis le clic (une relecture) : la fenêtre ne dit plus de condition, seulement le refus.
        if (caisse === null || caisse.etat !== 'exclu') {
          return (
            <ConfirmationArticle
              titre="Ouvrir sa caisse à ce client ?" boutonLabel="Cocher « Caisse »" occupe={droitEnCours !== null}
              refus={refusAvantLeClic('caisse', true)} erreur={null}
              onConfirmer={() => { void confirmerLaCaisse() }}
              onAnnuler={() => setCaisseAConfirmer(null)}
            >
              <p>La case « Caisse » de <strong className="courriel">{personne}</strong> ne se coche plus sur ce dossier.</p>
            </ConfirmationArticle>
          )
        }
        const confirmation = confirmationDeLaCaseCaisse(personne, caisse.statut, natureLue ?? { etat: 'illisible' })
        return (
          <ConfirmationArticle
            titre={confirmation.titre} boutonLabel={confirmation.bouton} occupe={droitEnCours !== null}
            refus={refusAvantLeClic('caisse', true)} erreur={null}
            onConfirmer={() => { void confirmerLaCaisse() }}
            onAnnuler={() => setCaisseAConfirmer(null)}
          >
            <p>
              {confirmation.personne.avant}<strong className="courriel">{confirmation.personne.personne}</strong>{confirmation.personne.apres}
            </p>
            {confirmation.paragraphes.map((p) => <p key={p}>{p}</p>)}
          </ConfirmationArticle>
        )
      })()}

      {/* La confirmation du rattachement (23-Q2) : une fenêtre de la page, jamais `window.confirm` — elle nomme l'adresse
          telle qu'elle partira, le dossier et ce que l'accès ouvre. « Annuler » n'envoie rien. */}
      {aRattacher && (() => {
        const confirmation = confirmationDuRattachement(aRattacher.email, dossierNom)
        return (
          <ConfirmationArticle
            titre={confirmation.titre} boutonLabel={confirmation.bouton} occupe={inviting} refus={null} erreur={null}
            onConfirmer={() => { void confirmerLeRattachement() }}
            onAnnuler={() => setARattacher(null)}
          >
            <p>
              {confirmation.adresse.avant}<strong className="courriel">{confirmation.adresse.adresse}</strong>{confirmation.adresse.apres}
            </p>
            {confirmation.paragraphes.map((p) => <p key={p}>{p}</p>)}
          </ConfirmationArticle>
        )
      })()}

      {relanceDe?.email && (
        <EnvoyerEmailModal
          dossierId={dossierId}
          type="relance_pieces"
          destinataireInitial={relanceDe.email}
          titre="Relancer pour obtenir des pièces"
          description={`Un e-mail invitant à se connecter pour déposer ses pièces sur "${dossierNom}".`}
          onClose={() => setRelanceDe(null)}
        />
      )}
    </>
  )
}
