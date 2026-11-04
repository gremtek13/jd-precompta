import { Fragment, useEffect, useRef, useState, type DragEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { deposerFichier } from '../lib/depot'
import { conseilPdfTropLourd, pdfTropLourdPourEtreLu } from '../lib/extraction'
import { avisDeLectureClient, DEPOTS_LUS_A_LA_FOIS, pieceNonLue } from '../lib/lectureDesPieces'
import { creerReservoir } from '../lib/reservoir'
import { anneeDe, anneeLocaleDe, anneeEtMoisEcoules, aujourdHuiAParis, formatDate } from '../lib/format'
import { lireAnneesCloturees } from '../lib/clotureExercice'
import { exercicesAReclamer, moisManquantsDe, pointsUtiles, reserveCloturesInconnues } from '../lib/resteAEnvoyer'
import type { CotisationDeclaree, DocumentDivers, LigneBancaire, Piece, PieceCommentaire } from '../lib/types'
import BarreRecherche from '../components/BarreRecherche'
import { correspondALaRecherche } from '../lib/recherche'
import FilCommentaires from '../components/FilCommentaires'
import BandeauLecturePartielle from '../components/BandeauLecturePartielle'
import { chargerCommentaires, cleCible, commentairesParCible } from '../lib/commentaires'
import type { CibleCommentaire } from '../lib/commentaires'
import { lireTout } from '../lib/lectureComplete'
import { COUVERTURE_EXPORTEE, lireLaCouverture, type MoisCouvert } from '../lib/couvertureReleve'
import { poids, TAILLE_MAX_PIECE } from '../lib/bornesStockage'
import { ECARTEES_DU_CLIENT_EXPORTEES } from '../lib/piecesJointesEcarteesClient'
import { useEcarteesDuClient } from '../lib/piecesJointesEcarteesClientLecture'
import {
  ADRESSE_COPIEE, ADRESSE_ILLISIBLE, ceQueAccepteLAdresse, COPIE_REFUSEE, COPIER_L_ADRESSE, ENVOI_PAR_EMAIL, lireLAdresseDeCollecte,
  type LectureAdresseCollecte,
} from '../lib/adresseCollecte'
import { useCopieDuTexte } from '../lib/copieDuTexte'
import PiecesJointesEcarteesClient from './PiecesJointesEcarteesClient'
import PaiementParMaCaisse from './PaiementParMaCaisse'
import { droitsSur } from '../lib/droitsAcces'
import { CAISSE_DU_CLIENT_EXPORTEE, maCaisseOuverte } from '../lib/caisseClient'
import { lireLaCaisseDuClient, type LectureDeLaCaisseDuClient } from '../lib/caisseClientLecture'
import { pourLEspace } from '../lib/espaceVentes'
import { messageErreur } from '../lib/messageErreur'
import type { SaisieDuReglement } from '../lib/paiementParLaCaisse'
import {
  caisseDeMesPieces, libelleDuGeste, paiementDit, paiementsDeLaPiece, payableParLaCaisse, pieceVueParLeClient, premiereAnneeLue,
} from '../lib/paiementDeMesPieces'

const NOMS_MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
const LABEL_CATEGORIE: Record<DocumentDivers['categorie'], string> = {
  releve_bancaire: 'Relevé bancaire',
  cotisation: 'Appel de cotisation',
  attestation: 'Attestation / certificat',
  autre: 'Document',
}

// Une ligne de "Mes dépôts" fusionne pieces (factures/reçus) et documents_divers (relevés, cotisations,
// attestations) — le client dépose un fichier, peu importe où il finit rangé en base ; ce qui compte
// pour lui c'est de voir que chaque envoi est bien arrivé et a été reconnu.
interface Depot {
  id: string
  nomFichier: string
  createdAt: string
  label: string
  traite: boolean
  // Ce sur quoi une précision se rattache. Null tant que le fichier est en cours d'analyse : aucune
  // ligne n'existe encore en base, il n'y a rien à commenter.
  cible: CibleCommentaire | null
  // La pièce elle-même, pour le paiement par la caisse (étape C12b) ; nulle pour un document ou un envoi en cours.
  piece: Piece | null
}

export default function ClientUpload() {
  const { dossierActifId, droitsParDossier, session } = useAuth()
  const dossierId = dossierActifId
  const moi = session?.user.id ?? null
  const [pieces, setPieces] = useState<Piece[]>([])
  const [documents, setDocuments] = useState<DocumentDivers[]>([])
  // Les mois où le relevé porte un mouvement : l'accueil les lit de la même façon (voir ClientHome) — par
  // `couverture_du_releve` depuis l'étape P7, les mouvements eux-mêmes n'étant plus lus qu'avec la case « Banque ».
  const [lignes, setLignes] = useState<MoisCouvert[]>([])
  const [cotisations, setCotisations] = useState<CotisationDeclaree[]>([])
  // Vrai tant que la PREMIÈRE lecture n'est pas revenue. Avant elle les listes sont vides faute d'avoir été lues, pas
  // faute d'envois : « ce qu'il reste à envoyer » se calculait sur ce vide, réclamait « Relevés bancaires 2026 — Mois
  // manquants : janvier, … » et disait « Aucun dépôt pour l'instant. », puis changeait d'avis. Il ne vaut QUE pour la
  // première lecture : `load()` est rappelé après chaque dépôt, et le remettre à vrai à chaque appel — comme le fait
  // `ClientHome`, qui ne relit pas après une action — ferait disparaître la liste au moment où le client vient d'envoyer.
  const [chargement, setChargement] = useState(true)
  // Non nul quand la liste des envois ou des relevés n'a pas pu être lue en entier. Dit au client,
  // dans sa langue : sans ça l'écran pourrait lui réclamer un document qu'il a déjà envoyé.
  const [lectureIncomplete, setLectureIncomplete] = useState<string | null>(null)
  // À part, et plus étroit : ce qui fait la liste « Mes dépôts » (pièces et documents). Vide faute de
  // lecture, elle ne peut pas dire « aucun dépôt » — le client croirait ses envois perdus. Une lecture
  // ratée des relevés, elle, laisse cette phrase vraie.
  const [depotsIncomplets, setDepotsIncomplets] = useState(false)
  // À part de `lectureIncomplete` : un fil de précisions tronqué n'a pas la même conséquence qu'une
  // liste d'envois tronquée, et le bandeau ne sert qu'à dire CE QUI est devenu faux.
  const [precisionsIncompletes, setPrecisionsIncompletes] = useState<string | null>(null)
  // Fichiers en cours d'envoi/analyse — état purement local (pas encore une ligne en base) : le temps
  // que Textract réponde (jusqu'à 50s sur un document multi-pages), aucune ligne n'existe encore, donc
  // rien à corriger après coup. Voir handleFiles.
  // `enAttente` : le fichier attend sa place dans le réservoir des lectures (trois à la fois, voir handleFiles).
  const [enCours, setEnCours] = useState<{ id: string; nomFichier: string; enAttente: boolean }[]>([])
  // Le réservoir des dépôts de l'écran : trois lectures à la fois, partagé entre les lots (relecture du 04/11/2026, D6).
  const lectures = useRef(creerReservoir(DEPOTS_LUS_A_LA_FOIS))
  // Les fichiers du dernier lot déposés sans que la lecture ait rendu leur date ou leur montant (D5) : dit au praticien,
  // au lieu d'un dépôt muet.
  const [avisDeLecture, setAvisDeLecture] = useState<string | null>(null)
  // Les empreintes des fichiers EN VOL, de tous les lots de l'écran (lib/depot.ts) : un `useRef`, car deux lots lancés
  // coup sur coup — le même fichier glissé puis choisi, deux gestes avant la fin du premier — se croisent avant que
  // l'écran ait pu se redessiner. Un Set neuf par lot les laissait passer tous deux le contrôle anti-doublon en base avant
  // que l'un ait écrit sa ligne. Le dépôt y réserve l'empreinte avant toute attente et la libère à sa fin, réussi ou non.
  const empreintesEnVol = useRef(new Set<string>())
  const [dragOver, setDragOver] = useState(false)
  const [recherche, setRecherche] = useState('')
  const [error, setError] = useState<string | null>(null)
  // Les précisions du dossier, chargées en une fois. Une requête par ligne de la liste en produirait
  // autant que de dépôts, pour un écran que le client ouvre sur son téléphone.
  const [commentaires, setCommentaires] = useState<PieceCommentaire[]>([])
  // Exercices que le cabinet a marqués clos : c'est ce qui arrête la réclamation de l'exercice
  // précédent. Une lecture refusée laisse la liste VIDE, donc on continue de réclamer — jamais
  // l'inverse, qui ferait cesser de demander sur une panne (voir lib/resteAEnvoyer.ts).
  const [anneesCloturees, setAnneesCloturees] = useState<number[]>([])
  const [clotureInconnue, setClotureInconnue] = useState<string | null>(null)
  // Le dépôt dont la zone de précision est ouverte. Amorcé par la photo prise depuis l'accueil, qui
  // navigue ici en désignant la ligne qu'elle vient de créer (voir ClientHome).
  const cibleDepuisAccueil = (useLocation().state as { preciser?: CibleCommentaire } | null)?.preciser
  const [filOuvert, setFilOuvert] = useState<string | null>(
    cibleDepuisAccueil ? cleCible(cibleDepuisAccueil) : null,
  )
  // Les pièces jointes que la réception par e-mail n'a pas déposées (ligne 22.9), lues À PART de « ce qu'il reste à
  // envoyer » : leur lecture ratée ne rend aucune autre liste fausse, et elle a son propre bandeau. La lecture est celle de
  // l'accueil, écrite une fois (lib/piecesJointesEcarteesClientLecture.ts, ligne 22.94) : gardée avec la société, annulée à
  // son changement, nulle tant qu'elle n'est pas revenue ; rien ne se lit tant que la fonction n'est pas en base.
  const ecartees = useEcarteesDuClient(dossierId)

  // LE PAIEMENT D'UNE PIÈCE PAR LA CAISSE (étape C12b ; CAISSE2-Q4, (A)) : avec la case « Caisse » sur la société affichée
  // (lue à la connexion), la caisse se lit — et la case se RELIT à la base avec elle (lib/caisseClientLecture.ts) — depuis
  // l'année d'avant. Sans la case, rien ne se lit et « Mes pièces » est celle d'hier. Gardée avec la société et l'année lues :
  // une réponse d'une autre société ne s'affiche pas (`caisseDeMesPieces`).
  const caisseOuverte = moi !== null && maCaisseOuverte(CAISSE_DU_CLIENT_EXPORTEE, droitsSur(droitsParDossier ?? {}, dossierId).caisse)
  const aujourdhui = aujourdHuiAParis()
  const anneeEnCours = Number(aujourdhui.slice(0, 4))
  const [caisseLue, setCaisseLue] = useState<LectureDeLaCaisseDuClient | null>(null)
  // Les pièces lues EN ENTIER : sans elles, aucun paiement ne s'offre (la base refuserait une pièce qu'elles ne portent pas).
  const [piecesEntieres, setPiecesEntieres] = useState(false)
  // Le paiement ouvert sous une pièce : une seule à la fois.
  const [paiementOuvert, setPaiementOuvert] = useState<string | null>(null)
  useEffect(() => {
    if (!dossierId || !caisseOuverte) return
    let annule = false
    lireLaCaisseDuClient(dossierId, premiereAnneeLue(anneeEnCours), anneeEnCours).then((l) => { if (!annule) setCaisseLue(l) })
    return () => { annule = true }
  }, [dossierId, caisseOuverte, anneeEnCours])
  async function relireLaCaisse() {
    if (!dossierId) return
    setCaisseLue(await lireLaCaisseDuClient(dossierId, premiereAnneeLue(anneeEnCours), anneeEnCours))
  }
  // UN verrou pour tout geste d'écriture sur la caisse (payer, retirer), de « Mes pièces » entière et non d'un formulaire :
  // celui d'une pièce disparaît quand on en ouvre une autre, et deux paiements partiraient sur une caisse pas encore relue.
  // Posé avant le premier `await`, relâché après la relecture ; l'état n'est que l'affichage (il ne prend effet qu'au rendu
  // suivant), d'où le verrou aussi sur les boutons qui ouvrent ou ferment un formulaire.
  const paiementCaisseEnCours = useRef(false)
  const [paiementCaisseEnVol, setPaiementCaisseEnVol] = useState(false)
  // `appel` rend le refus de la base aux mots du client, ou rien quand elle a écrit ; `surIssue` le dit à l'écran du formulaire
  // AVANT la relecture (même sur un refus : la base a peut-être vu ce que l'écran n'avait pas lu).
  async function agirSurLaCaisse(appel: () => Promise<string | null>, surIssue: (refus: string | null) => void) {
    if (paiementCaisseEnCours.current) return
    paiementCaisseEnCours.current = true
    setPaiementCaisseEnVol(true)
    try {
      surIssue(await appel())
      await relireLaCaisse()
    } finally {
      paiementCaisseEnCours.current = false
      setPaiementCaisseEnVol(false)
    }
  }
  async function payerParLaCaisse(saisie: SaisieDuReglement, surIssue: (refus: string | null) => void) {
    if (!dossierId) return
    await agirSurLaCaisse(async () => {
      const { error } = await supabase.rpc('regler_piece_par_la_caisse', {
        p_dossier_id: dossierId, p_piece_id: saisie.piece_id, p_date: saisie.date, p_montant: saisie.montant,
      })
      return error ? pourLEspace('client', messageErreur(error, 'raison inconnue')) : null
    }, surIssue)
  }
  async function retirerDeLaCaisse(operationId: string, surIssue: (refus: string | null) => void) {
    if (!dossierId) return
    await agirSurLaCaisse(async () => {
      const { error } = await supabase.rpc('retirer_operation_caisse', { p_dossier_id: dossierId, p_operation_id: operationId })
      return error ? pourLEspace('client', messageErreur(error, 'raison inconnue')) : null
    }, surIssue)
  }

  // L'adresse e-mail de collecte du dossier (ligne 22.93), lue À PART : sa lecture ratée ne rend aucune autre liste fausse, et
  // elle ne dit que l'adresse. Gardée AVEC le dossier pour lequel elle a été faite — nulle tant qu'elle n'est pas revenue :
  // avant son retour rien n'est affirmé, et l'adresse d'une société ne s'affiche jamais sous une autre. Une lecture ratée,
  // ou un dossier sans code : pas d'adresse, et la carte retombe sur « la même adresse » — jamais une adresse devinée.
  const [adresseLue, setAdresseLue] = useState<{ dossierId: string; lecture: LectureAdresseCollecte } | null>(null)
  const lectureAdresse = adresseLue !== null && adresseLue.dossierId === dossierId ? adresseLue.lecture : null
  const adresseCollecte = lectureAdresse?.adresse ?? null
  const { copie: adresseCopiee, refusee: copieRefusee, copier: copierAdresse } = useCopieDuTexte(adresseCollecte)

  // Une lecture plus lente que le changement de société n'écrit pas : le drapeau d'annulation.
  useEffect(() => {
    if (!dossierId) return
    let annule = false
    lireLAdresseDeCollecte(supabase.from('dossiers').select('code_email').eq('id', dossierId).maybeSingle())
      .then((lecture) => { if (!annule) setAdresseLue({ dossierId, lecture }) })
    return () => { annule = true }
  }, [dossierId])

  // UNE LECTURE PLUS LENTE N'ÉCRIT PLUS EN DERNIER (relecture du 04/11/2026, D8) : deux lots finis coup sur coup, ou un
  // lot fini pendant le changement de société, relancent chacun une lecture ; seule la DERNIÈRE lancée écrit. Le numéro
  // se compare avant la première écriture.
  const chargementNo = useRef(0)
  async function load() {
    if (!dossierId) return
    const no = ++chargementNo.current
    const [lecturePieces, lectureDocuments, lectureLignes, lectureCotisations, commentairesData, clotures] = await Promise.all([
      // Lues par tranches : le plafond de PostgREST ne se signale pas (voir lib/lectureComplete.ts),
      // et c'est sur ces deux collections que repose « ce qu'il reste à envoyer ». Tronquées, elles
      // demanderaient au client des documents qu'il a déjà envoyés.
      lireTout<Piece>((debut, fin) =>
        supabase.from('pieces').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).order('created_at', { ascending: false }).order('id').range(debut, fin),
      ),
      lireTout<DocumentDivers>((debut, fin) =>
        supabase.from('documents_divers').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).order('created_at', { ascending: false }).order('id').range(debut, fin),
      ),
      COUVERTURE_EXPORTEE
        ? lireLaCouverture(supabase.rpc('couverture_du_releve', { p_dossier_id: dossierId }))
        : lireTout<LigneBancaire>((debut, fin) =>
          supabase.from('lignes_bancaires').select('*', { count: 'exact' })
            .eq('dossier_id', dossierId).order('id').range(debut, fin),
        ),
      lireTout<CotisationDeclaree>((debut, fin) =>
        supabase.from('cotisations_declarees').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).order('id').range(debut, fin),
      ),
      chargerCommentaires(dossierId),
      lireAnneesCloturees(dossierId),
    ])
    if (no !== chargementNo.current) return
    setPieces(lecturePieces.lignes)
    setDocuments(lectureDocuments.lignes)
    setLignes(lectureLignes.lignes)
    // Les QUATRE collections de « ce qu'il reste à envoyer », pas seulement deux : les documents et
    // les cotisations comptent autant que les pièces et les relevés. Tronquée, l'une d'elles fait
    // réclamer un document déjà envoyé — c'est exactement ce que le bandeau ci-dessous annonce.
    setLectureIncomplete(
      [lecturePieces, lectureDocuments, lectureLignes, lectureCotisations]
        .find((l) => !l.complete)?.motif ?? null,
    )
    setDepotsIncomplets(!lecturePieces.complete || !lectureDocuments.complete)
    setPiecesEntieres(lecturePieces.complete)
    setCotisations(lectureCotisations.lignes)
    setCommentaires(commentairesData.commentaires)
    setPrecisionsIncompletes(commentairesData.motif)
    setAnneesCloturees(clotures.annees)
    setClotureInconnue(clotures.erreur)
    // En dernier, après toutes les listes : le rendu qui lève le drapeau les trouve toutes en place.
    setChargement(false)
  }

  useEffect(() => { load() }, [dossierId])

  // Chaque fichier suit son propre chemin — hash-check anti-doublon, upload storage, extraction automatique, classement
  // Pièces/Documents — via deposerFichier (lib/depot.ts), partagé avec la prise de photo directe sur l'accueil
  // (ClientHome). Ici on ajoute le suivi local (« En attente… », puis « Analyse en cours… »), l'agrégation des erreurs et
  // ce que la lecture n'a pas rendu.
  //
  // TROIS À LA FOIS, JAMAIS LE LOT ENTIER (relecture du 04/11/2026, D6 ; PIECES-Q4, sur la recommandation) : un
  // `Promise.all` lançait autant de lectures que de fichiers — quarante photos, quarante appels à Textract et au modèle au
  // même instant, au-delà de leurs quotas, et des pièces arrivées sans montant. Le réservoir (`lectures`) est celui de
  // l'écran, partagé entre les lots comme les empreintes en vol.
  //
  // UN SEUL RECHARGEMENT, À LA FIN DU LOT (D8) : chaque fichier relançait la lecture des quatre listes, N lectures
  // parallèles que rien n'ordonnait.
  async function handleFiles(fileList: FileList | File[]) {
    let files = Array.from(fileList)
    if (files.length === 0 || !dossierId) return
    // UN PDF DE PLUS DE 10 MO SE DIT AVANT L'ENVOI (D5) : la lecture le refuse, et il arrivait sans date ni montant comme
    // un dépôt réussi. Le praticien choisit : le déposer quand même (le cabinet le complétera), ou le garder pour le scinder.
    // Au-delà de la borne du seau (20 Mo), le dépôt le refuse de lui-même, et le dit : rien à demander.
    const tropLourds = files.filter((f) => pdfTropLourdPourEtreLu(f) && f.size <= TAILLE_MAX_PIECE)
    if (tropLourds.length > 0 && !window.confirm(
      `${tropLourds.map(conseilPdfTropLourd).join('\n\n')}\n\nLe déposer quand même ? (Annuler le garde de côté, pour le scinder.)`,
    )) {
      files = files.filter((f) => !tropLourds.includes(f))
      if (files.length === 0) return
    }
    setError(null)
    setAvisDeLecture(null)
    const erreurs: string[] = []
    const nonAboutis: string[] = []
    // Les branches d'un lot partent ensemble — trois lues à la fois —, et les lots entre eux aussi : le MÊME ensemble
    // d'empreintes en vol sert à tous (voir `empreintesEnVol`), sans quoi deux fichiers de contenu identique passeraient
    // tous deux la vérification anti-doublon en base avant que l'un ait écrit sa ligne (voir deposerFichier).
    const hashsEnVol = empreintesEnVol.current

    await Promise.all(files.map(async (file) => {
      const localId = `${Date.now()}-${Math.random()}-${file.name}`
      setEnCours((prev) => [...prev, { id: localId, nomFichier: file.name, enAttente: true }])
      const resultat = await lectures.current.executer(() => {
        setEnCours((prev) => prev.map((f) => (f.id === localId ? { ...f, enAttente: false } : f)))
        return deposerFichier(dossierId, file, hashsEnVol)
      })
      if (resultat.statut === 'doublon') erreurs.push(`${file.name} : déjà déposé, pas réenvoyé.`)
      else if (resultat.statut === 'erreur') erreurs.push(`${file.name} : ${resultat.message}.`)
      else {
        if (resultat.lectureNonAboutie) nonAboutis.push(file.name)
        // Un seul fichier déposé : on ouvre sa zone de précision, tant que le client se souvient de ce
        // qu'il vient d'envoyer. Sur un lot, on ne devine pas lequel mériterait un mot — en ouvrir un
        // au hasard ferait écrire la précision sous la mauvaise pièce.
        if (files.length === 1) setFilOuvert(cleCible(resultat.cible))
      }
      setEnCours((prev) => prev.filter((f) => f.id !== localId))
    }))

    await load()
    if (erreurs.length > 0) setError(erreurs.join(' '))
    setAvisDeLecture(avisDeLectureClient(nonAboutis))
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragOver(false)
    if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files)
  }

  if (!dossierId) {
    return <p className="muted">Aucun dossier ne t'est encore rattaché — contacte ton cabinet comptable.</p>
  }

  const depots: Depot[] = [
    ...pieces.map((p): Depot => ({
      id: `piece-${p.id}`,
      nomFichier: p.nom_fichier,
      createdAt: p.created_at,
      // Une pièce que la lecture n'a pas lue le dit, sans montant (D5) : le praticien sait que son cabinet la complétera.
      label: p.statut === 'validee'
        ? 'Facture — traitée'
        : pieceNonLue(p) ? 'Facture — lecture non aboutie, ton cabinet la complétera' : 'Facture — en attente de traitement',
      traite: p.statut === 'validee',
      cible: { type: 'piece', id: p.id },
      piece: p,
    })),
    ...documents.map((d): Depot => ({
      id: `doc-${d.id}`,
      nomFichier: d.nom_fichier,
      createdAt: d.created_at,
      label: LABEL_CATEGORIE[d.categorie],
      traite: true,
      cible: { type: 'document', id: d.id },
      piece: null,
    })),
    ...enCours.map((f): Depot => ({
      id: f.id, nomFichier: f.nomFichier, createdAt: new Date().toISOString(),
      label: f.enAttente ? 'En attente…' : 'Analyse en cours…', traite: false,
      cible: null,
      piece: null,
    })),
  ].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))

  const parCible = commentairesParCible(commentaires)

  const caisse = caisseDeMesPieces({
    ouverte: caisseOuverte, lecture: caisseLue, dossierId, anneeEnCours, moi: moi ?? '', aujourdhui,
    piecesLuesEnEntier: !chargement && piecesEntieres,
  })

  // La recherche porte aussi sur les précisions : « salle d'attente » est souvent tout ce dont le
  // client se souvient d'un dépôt, bien plus sûrement que le nom du fichier que son téléphone a
  // choisi tout seul.
  const depotsAffiches = depots.filter((d) => {
    const fil = d.cible ? parCible.get(cleCible(d.cible)) ?? [] : []
    return correspondALaRecherche(
      [d.nomFichier, d.label, d.createdAt, formatDate(d.createdAt), ...fil.map((c) => c.texte)],
      recherche,
    )
  })

  // "Ce qu'il manque" — les 3 signaux communs à tous les dossiers (mêmes que le Dashboard cabinet),
  // pour que le client sache ce qu'il reste à envoyer sans avoir à demander. Volontairement limité à
  // ces trois-là : le reste (véhicule, tickets restaurant...) dépend d'une configuration par dossier
  // que le client ne voit pas ici.
  // Mois entièrement terminés, pas mois entamés (voir lib/format) — cet écran comptait le mois en
  // cours comme dû, et réclamait donc au client un relevé qui n'existe pas encore, en contradiction
  // avec l'accueil et la Checklist du cabinet, qui lisent tous deux ce même calcul. Lus à chaque
  // rendu : figés au chargement du module, ils faisaient diverger ces trois écrans au passage d'une
  // année, alors qu'ils doivent dire la même chose au même moment.
  const { annee: ANNEE_COURANTE, moisEcoules: MOIS_ECOULES } = anneeEtMoisEcoules()

  // L'ARITHMÉTIQUE D'EXERCICE VIT DANS `lib/resteAEnvoyer.ts`, partagée avec l'accueil et la
  // Checklist du cabinet : elle était écrite trois fois ici et avait déjà divergé deux fois. Ce qui
  // reste propre à cet écran est le CRITÈRE — on compte les DÉPÔTS (« ai-je envoyé quelque
  // chose ? »), là où le cabinet compte les pièces DATÉES de l'exercice.
  const exercices = exercicesAReclamer(ANNEE_COURANTE, MOIS_ECOULES, anneesCloturees)
  const items = pointsUtiles(exercices.flatMap((ex) => {
    const manquants = moisManquantsDe(ex, lignes)
    const cotisationsEx = cotisations.filter((c) => anneeDe(c.echeance) === ex.annee)
    const depotsEx = depots.filter((d) => anneeLocaleDe(d.createdAt) === ex.annee)
    return [
      {
        annee: ex.annee,
        id: `banque-${ex.annee}`,
        label: `Relevés bancaires ${ex.annee}`,
        ok: manquants.length === 0,
        detail: ex.moisAttendus.length === 0
          ? "Aucun mois encore terminé cette année"
          : manquants.length > 0
            ? `Mois manquants : ${manquants.map((m) => NOMS_MOIS[m - 1]).join(', ')}`
            : `${ex.moisAttendus.length}/${ex.moisAttendus.length} mois reçus`,
      },
      {
        annee: ex.annee,
        id: `cotisations-${ex.annee}`,
        label: `Appels de cotisation ${ex.annee}`,
        ok: cotisationsEx.length > 0,
        detail: cotisationsEx.length > 0 ? `${cotisationsEx.length} échéance(s) reçue(s)` : "Aucun appel reçu pour l'instant",
      },
      {
        annee: ex.annee,
        id: `depots-${ex.annee}`,
        label: `Factures et documents ${ex.annee}`,
        ok: depotsEx.length > 0,
        detail: `${depotsEx.length} déposé(s)`,
      },
    ]
  }), ANNEE_COURANTE)

  return (
    <>
      <div className="topbar"><h1>Mes pièces</h1></div>

      <BandeauLecturePartielle
        quoi="Tes envois"
        accord="lus"
        motif={lectureIncomplete}
        technique={false}
        consequence="Recharge la page : cette liste peut te demander un document que tu as déjà envoyé."
      />
      <BandeauLecturePartielle
        quoi="Tes précisions"
        motif={precisionsIncompletes}
        technique={false}
        consequence="Recharge la page : il manque peut-être des messages sous tes documents."
      />

      {ECARTEES_DU_CLIENT_EXPORTEES && <PiecesJointesEcarteesClient lecture={ecartees} adresse={adresseCollecte} />}

      <h3>Ce qu'il reste à envoyer</h3>
      <div className="card" style={{ padding: 0, marginBottom: 20 }}>
        {chargement ? (
          <p className="muted" style={{ padding: 20 }}>Chargement…</p>
        ) : items.map((item) => (
          <div key={item.id} className="checklist-item">
            <span
              className="pastille"
              style={{
                width: 14, height: 14, borderRadius: '50%', flexShrink: 0,
                background: item.ok ? 'var(--color-primary)' : 'var(--color-danger)',
              }}
            />
            <div className="checklist-item-body">
              <div style={{ fontWeight: 600 }}>{item.label}</div>
              <div className="muted" style={{ fontSize: '0.82rem' }}>{item.detail}</div>
            </div>
          </div>
        ))}
      </div>
      {reserveCloturesInconnues(clotureInconnue, ANNEE_COURANTE, { technique: false }) && (
        <p className="muted" style={{ fontSize: '0.82rem', marginTop: -12, marginBottom: 20 }}>
          {reserveCloturesInconnues(clotureInconnue, ANNEE_COURANTE, { technique: false })}
        </p>
      )}

      <h3>Déposer des fichiers</h3>
      <div
        className="card"
        style={{
          marginBottom: 20, textAlign: 'center', cursor: 'pointer',
          border: dragOver ? '2px dashed var(--color-primary)' : '2px dashed var(--color-border)',
          background: dragOver ? 'var(--color-primary-light)' : 'var(--color-surface)',
        }}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        <p style={{ margin: '8px 0', fontWeight: 600 }}>Glisse tes fichiers ici</p>
        <p className="muted" style={{ margin: '0 0 14px' }}>
          Factures, reçus, notes de frais, relevés bancaires (CSV), appels de cotisation — plusieurs fichiers à la fois,
          {' '}{poids(TAILLE_MAX_PIECE)} au plus chacun.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          <label className="btn btn-primary" style={{ cursor: 'pointer' }} onClick={(e) => e.stopPropagation()}>
            Choisir des fichiers
            <input
              type="file"
              multiple
              accept=".pdf,.jpg,.jpeg,.png,.csv"
              style={{ display: 'none' }}
              onChange={(e) => { if (e.target.files) handleFiles(e.target.files); e.target.value = '' }}
            />
          </label>
          {/* capture="environment" ouvre directement l'appareil photo arrière sur mobile (au lieu de la
              galerie) — le fichier qui en sort est un File comme un autre, donc handleFiles s'en occupe
              sans rien savoir de sa provenance : même hash-check, même upload, même extraction automatique. */}
          <label className="btn btn-outline" style={{ cursor: 'pointer' }} onClick={(e) => e.stopPropagation()}>
            📷 Prendre une photo
            <input
              type="file"
              accept="image/*"
              capture="environment"
              style={{ display: 'none' }}
              onChange={(e) => { if (e.target.files) handleFiles(e.target.files); e.target.value = '' }}
            />
          </label>
        </div>
        {adresseCollecte && (
          <div className="adresse-collecte-client">
            <p className="muted">{ENVOI_PAR_EMAIL}</p>
            <div className="adresse-collecte-ligne">
              <code className="adresse-collecte">{adresseCollecte}</code>
              <button type="button" className="btn btn-outline btn-sm" onClick={copierAdresse}>
                {adresseCopiee ? ADRESSE_COPIEE : COPIER_L_ADRESSE}
              </button>
            </div>
            {copieRefusee && <p className="muted" role="status">{COPIE_REFUSEE}</p>}
            <p className="muted">{ceQueAccepteLAdresse()}</p>
          </div>
        )}
      </div>
      {lectureAdresse !== null && lectureAdresse.adresse === null && lectureAdresse.motif !== null && (
        <p className="error-text" title={lectureAdresse.motif} style={{ marginTop: -8, marginBottom: 14 }}>{ADRESSE_ILLISIBLE}</p>
      )}

      {error && <p className="error-text" style={{ marginBottom: 14 }}>{error}</p>}
      {avisDeLecture && <p className="muted" role="status" style={{ marginBottom: 14 }}>{avisDeLecture}</p>}

      <h3>Mes dépôts</h3>
      {caisse.etat === 'muette' && <p className="error-text" style={{ marginBottom: 14 }}>{caisse.texte}</p>}
      {caisse.etat === 'lue' && caisse.raison !== null && <p className="muted" style={{ marginBottom: 14 }}>{caisse.raison}</p>}
      <div style={{ marginBottom: 14 }}>
        <BarreRecherche
          valeur={recherche}
          onChange={setRecherche}
          placeholder="Rechercher un fichier…"
          affiches={depotsAffiches.length}
          total={depots.length}
        />
      </div>
      {/* Repliée en fiches sous 860 pixels de carte (08/10/2026) : c'est l'écran du client, sur son téléphone — mais aussi sur un
          ordinateur de 1 024 pixels, où le bouton « Préciser » de chaque dépôt passait derrière un défilement latéral. Le statut
          de chaque dépôt aussi, et le nom d'un fichier sans espace, qui n'a rien à couper, allongeait la page de trois cents
          pixels. `table-empilable-en-carte` rend aux fiches le jeu que la carte, sans marge, ne leur donne pas. */}
      <div className="card table-scroll" style={{ padding: 0 }}>
        {chargement ? (
          // Ni la table ni « Aucun dépôt… » : tant que rien n'a été lu, ni l'une ni l'autre ne serait vraie.
          <p className="muted" style={{ padding: 20 }}>Chargement…</p>
        ) : depotsAffiches.length === 0 ? (
          <div className="empty-state">
            {recherche.trim()
              ? `Aucun dépôt ne correspond à « ${recherche.trim()} ».`
              : depotsIncomplets
                ? "Tes envois n'ont pas pu être affichés — recharge la page."
                : "Aucun dépôt pour l'instant."}
          </div>
        ) : (
          <div className="tableau-adaptable">
            <table className="table-empilable table-empilable-en-carte">
              <thead><tr><th>Fichier</th><th>Déposé le</th><th>Statut</th><th>{caisseOuverte ? 'Gestes' : 'Précisions'}</th></tr></thead>
              <tbody>
                {depotsAffiches.map((d) => {
                  const cle = d.cible ? cleCible(d.cible) : null
                  const fil = cle ? parCible.get(cle) ?? [] : []
                  const ouvert = cle !== null && filOuvert === cle
                  // La caisse lue en entier : les paiements de la pièce, et le geste quand la caisse le permet.
                  const paiements = caisse.etat === 'lue' && d.piece ? paiementsDeLaPiece(d.piece.id, caisse.operations) : []
                  const especes = caisse.etat === 'lue' && caisse.dossier !== null && d.piece !== null
                    && (payableParLaCaisse(d.piece) || paiements.length > 0) ? d.piece : null
                  const especesOuvertes = especes !== null && paiementOuvert === especes.id
                  return (
                    <Fragment key={d.id}>
                      <tr>
                        <td data-libelle="Fichier">{d.nomFichier}</td>
                        <td data-libelle="Déposé le">{formatDate(d.createdAt)}</td>
                        <td data-libelle="Statut">
                          {!d.traite && d.label === 'Analyse en cours…'
                            ? <span className="badge badge-neutral">Analyse en cours…</span>
                            : d.traite
                              ? <span className="badge badge-ok">{d.label}</span>
                              : <span className="badge badge-neutral">{d.label}</span>}
                          {paiements.map((o) => (
                            <span key={o.id} className="muted" style={{ display: 'block', fontSize: '0.82rem' }}>{paiementDit(o, moi ?? '')}</span>
                          ))}
                        </td>
                        <td className="td-boutons">
                          {/* Rien à commenter tant que l'analyse tourne : la ligne n'existe pas encore. */}
                          {d.cible === null ? (
                            <span className="muted">—</span>
                          ) : (
                            <button
                              type="button"
                              className="btn btn-outline btn-sm"
                              onClick={() => setFilOuvert(ouvert ? null : cle)}
                            >
                              {fil.length > 0 ? `💬 ${fil.length}` : '+ Préciser'}
                            </button>
                          )}
                          {especes !== null && (
                            <button
                              type="button"
                              className="btn btn-outline btn-sm"
                              aria-expanded={especesOuvertes}
                              disabled={paiementCaisseEnVol}
                              onClick={() => {
                                // Le clic peut précéder le rendu qui désactive le bouton : le verrou, lui, est déjà posé.
                                if (paiementCaisseEnCours.current) return
                                setPaiementOuvert(especesOuvertes ? null : especes.id)
                              }}
                            >
                              {paiements.length > 0 || !payableParLaCaisse(especes) ? 'Espèces de ta caisse' : libelleDuGeste(pieceVueParLeClient(especes))}
                            </button>
                          )}
                        </td>
                      </tr>
                      {especesOuvertes && especes !== null && caisse.etat === 'lue' && caisse.dossier !== null && dossierId && moi && (
                        <tr>
                          <td colSpan={4} style={{ background: 'var(--color-surface-2)' }}>
                            <PaiementParMaCaisse
                              piece={especes}
                              dossier={caisse.dossier}
                              operations={caisse.operations}
                              jours={caisse.jours}
                              moi={moi}
                              anneeEnCours={anneeEnCours}
                              aujourdhui={aujourdhui}
                              payer={payerParLaCaisse}
                              retirer={retirerDeLaCaisse}
                              verrou={paiementCaisseEnCours}
                              enVol={paiementCaisseEnVol}
                            />
                          </td>
                        </tr>
                      )}
                      {ouvert && d.cible && dossierId && (
                        <tr>
                          <td colSpan={4} style={{ background: 'var(--color-surface-2)' }}>
                            <FilCommentaires
                              dossierId={dossierId}
                              cible={d.cible}
                              commentaires={fil}
                              estCabinet={false}
                              autoFocus
                              onAjout={(c) => setCommentaires((prev) => [...prev, c])}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
