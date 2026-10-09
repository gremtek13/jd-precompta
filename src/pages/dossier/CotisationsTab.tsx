import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { lireTout } from '../../lib/lectureComplete'
import { anneeDe, aujourdHuiAParis, formatDate, formatMoney, slugify } from '../../lib/format'
import { extractPiece, fichierDejaPresent, hashFichier } from '../../lib/extraction'
import type { ANouveau, CotisationDeclaree, DocumentDivers, EcritureBrouillon, LigneBancaire } from '../../lib/types'
import BrouillonBanner from '../../components/BrouillonBanner'
import AnneeTabs, { type ValeurAnnee } from '../../components/AnneeTabs'
import BarreRecherche from '../../components/BarreRecherche'
import { correspondALaRecherche } from '../../lib/recherche'
import { messageErreur } from '../../lib/messageErreur'
// Les taux CSG-CRDS vivaient ici, en dur dans ce composant — donc hors de portée des tests, et
// invisibles pour le moteur de la 2035, qui déduisait la CSG-CRDS ENTIÈRE. Ils sont désormais au
// même endroit que le contrôle qui s'en sert (voir `partCsgNonDeductible`) : une règle recopiée
// deux fois n'attend pas de diverger, elle attend un troisième appelant.
import { csgDeductible as partDeductible } from '../../lib/declaration2035'
import {
  avertissementRetraitEcheance, cotisationsAEcrire, ecritureDeLaCotisation, montantDeLEcheance, rapprochementsCotisationRefuses,
  refusMontantsDuPaiementPersonnel,
} from '../../lib/cotisationRapprochee'
import {
  argumentsDeLaDeclaration, avertissementRetraitPaiementPersonnel, avertissementSuppressionEcheancePayee,
  paiementsPersonnelsAReprendre, refusPaiementPersonnel, refusRetraitPaiementPersonnel, RETRAIT_EXPORTE,
} from '../../lib/cotisationPersonnelle'
import type { ModeleComptable } from '../../lib/engagement'
import PaiementPersonnelModal from './PaiementPersonnelModal'
import { ouvrirApercu } from '../../lib/apercu'
import BandeauLecturePartielle from '../../components/BandeauLecturePartielle'
import { useExercicesValides } from '../../context/ExercicesValidesContext'
import { dateFigee } from '../../lib/validationExercice'

// Palier 5, brique 4 — suivi des cotisations sociales. Saisie manuelle des appels et versements
// URSSAF (montants connus tardivement, jamais déductibles d'un relevé bancaire seul) et calcul
// proposé de la répartition CSG déductible/non déductible — uniquement sur la part CSG-CRDS
// explicitement renseignée, jamais sur le montant appelé total qui cumule d'autres cotisations.
//
// LIGNE 26.6, ÉTAPE (b) : une échéance rapprochée d'un mouvement S'ÉCRIT (lib/cotisationRapprochee.ts).
// La colonne « Paiement » dit quel mouvement la paie et si son écriture est au brouillon ; « Écrire les
// N » écrit celles qu'un rapprochement d'avant le 01/10/2026 a laissées sans écriture. Le mode comptable
// décide de la CSG-CRDS : au 108000 en trésorerie, au 646000 avec le reste en engagement.
//
// UN EXERCICE VALIDÉ FIGE SES ÉCHÉANCES (ligne 26.6, étape d) : une échéance compte à la date du mouvement qui la paie,
// sinon à celle de son paiement depuis le compte personnel, sinon à son échéance, et c'est cette date qui dit si elle
// appartient à un exercice validé. Figée, elle ne change plus,
// ne se supprime plus et ne s'écrit plus ; et une échéance ne s'ajoute plus dans un exercice validé — les refus de la
// base (`garder_cotisation_valide`). L'écran le dit avant le clic, avec ses mots.
//
// UNE ÉCHÉANCE PAYÉE DEPUIS LE COMPTE PERSONNEL DE L'EXPLOITANT (ligne 26.6, phase C ; lib/cotisationPersonnelle.ts) : la
// colonne « Paiement » offre de la déclarer sur une échéance que rien ne paie, dans une fenêtre où la date n'est jamais
// proposée, et la dit ensuite payée, avec l'état de son écriture. Le modèle comptable ENTIER entre ici : en engagement,
// l'écriture se passe face au compte choisi pour le dirigeant (455, 108 ou 467). Son retrait attend sa fonction en base
// (`RETRAIT_EXPORTE`).
export default function CotisationsTab({ dossierId, modele }: { dossierId: string; modele: ModeleComptable }) {
  const modeComptable = modele.mode
  const [cotisations, setCotisations] = useState<CotisationDeclaree[]>([])
  // Les mouvements rapprochés d'une échéance, et les écritures sans pièce du dossier : ce qui dit quelle
  // échéance est payée, et si son paiement est écrit. Chacune son drapeau : leurs conséquences diffèrent.
  const [paiements, setPaiements] = useState<LigneBancaire[]>([])
  const [paiementsIncomplets, setPaiementsIncomplets] = useState<string | null>(null)
  const [ecritures, setEcritures] = useState<EcritureBrouillon[]>([])
  const [ecrituresIncompletes, setEcrituresIncompletes] = useState<string | null>(null)
  // UN verrou pour les deux gestes qui écrivent le relevé : « Écrire les N » et « Retirer ». Retirée pendant
  // que le lot tourne, une échéance serait réécrite par le lot, qui l'a prise avant. Un `useRef`, posé
  // avant le premier `await` (voir CLAUDE.md, « un verrou d'exécution »).
  const ecritureEnCours = useRef(false)
  const [enCours, setEnCours] = useState(false)
  const [lectureIncomplete, setLectureIncomplete] = useState<string | null>(null)
  // À part de `lectureIncomplete`, qui couvre aussi les justificatifs : ce sont les ÉCHÉANCES lues
  // qui dédoublonnent la création ci-dessous, et un justificatif manquant n'y change rien.
  const [cotisationsIncompletes, setCotisationsIncompletes] = useState<string | null>(null)
  const [documentsCotisation, setDocumentsCotisation] = useState<DocumentDivers[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [echeance, setEcheance] = useState('')
  const [montantAppele, setMontantAppele] = useState('')
  const [montantVerse, setMontantVerse] = useState('')
  const [montantCsgCrds, setMontantCsgCrds] = useState('')
  const [previsionnel, setPrevisionnel] = useState(false)
  // Verrou d'exécution de l'échéance saisie à la main, en `useRef` : `setSaving(true)` ne prend effet qu'au rendu suivant,
  // donc `disabled={saving}` laissait passer deux soumissions rapprochées (deux « Entrée » suffisent), et
  // `cotisations_declarees` n'a d'unique que son identifiant — une cotisation comptée deux fois en case BK de la 2035.
  const saisieEnCours = useRef(false)
  const [uploading, setUploading] = useState(false)
  // Celui du dépôt d'un avis : deux dépôts du même rendu envoyaient deux fichiers, créaient deux documents et payaient
  // deux lectures de l'avis — la vérification de l'empreinte en base ne voit pas un dépôt parti en même temps.
  const depotEnCours = useRef(false)
  // Distinct de "uploading" : celui-ci ne bloque plus rien (dépôt d'un autre fichier, navigation...),
  // juste un indicateur pendant que Textract analyse le document en arrière-plan.
  const [analyseEnCours, setAnalyseEnCours] = useState(false)
  const [echeancesProposees, setEcheancesProposees] = useState<{ date: string; montant: number; previsionnel: boolean }[]>([])
  const [diagCotisation, setDiagCotisation] = useState<string[] | undefined>(undefined)
  const [creantEcheances, setCreantEcheances] = useState(false)
  const creationEnCours = useRef(false)
  const [anneeFilter, setAnneeFilter] = useState<ValeurAnnee>('toutes')
  const [recherche, setRecherche] = useState('')
  const { frontiere, anneesValidees } = useExercicesValides()
  // L'ouverture d'un dossier repris (la plus ancienne date de ses à-nouveaux) : un paiement d'avant est dans les comptes
  // repris, et la base le refuse. `undefined` tant qu'elle n'a pas été lue EN ENTIER : le geste n'est pas offert.
  const [ouverture, setOuverture] = useState<string | null | undefined>(undefined)
  const [ouvertureIncomplete, setOuvertureIncomplete] = useState<string | null>(null)
  // L'échéance dont la fenêtre « Payée depuis le compte personnel » est ouverte : son IDENTIFIANT, relu dans la liste à
  // chaque rendu — une relecture qui la change ou la retire change ce que la fenêtre dit.
  const [paiementPersonnelDe, setPaiementPersonnelDe] = useState<string | null>(null)
  const [erreurPaiementPersonnel, setErreurPaiementPersonnel] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    const [lectureCotisations, lectureDocuments, lecturePaiements, lectureEcritures, lectureOuverture] = await Promise.all([
      // Tri TOTAL : `echeance` n'est pas unique, donc `id` départage — sans lui, deux tranches
      // se recouvrent ou sautent des lignes, et rien ne le signale.
      lireTout<CotisationDeclaree>((debut, fin) =>
        supabase.from('cotisations_declarees').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).order('echeance', { ascending: false }).order('id').range(debut, fin),
      ),
      // Uniquement les appels de cotisation classés dans l'archive Documents (voir DocumentsTab) — le
      // rattachement se fait ici, pas là-bas, pour rester à côté du montant qu'ils justifient.
      lireTout<DocumentDivers>((debut, fin) =>
        supabase.from('documents_divers').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).eq('categorie', 'cotisation').order('id').range(debut, fin),
      ),
      // Les mouvements qui paient une échéance : rapprochés, portant une échéance.
      lireTout<LigneBancaire>((debut, fin) =>
        supabase.from('lignes_bancaires').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).eq('statut', 'rapprochee').not('cotisation_id', 'is', null)
          .order('date', { ascending: false }).order('id').range(debut, fin),
      ),
      // Les écritures SANS PIÈCE du dossier : celles des mouvements écrits depuis le relevé, dont les
      // échéances payées. Lues pour savoir lesquelles ont la leur.
      lireTout<EcritureBrouillon>((debut, fin) =>
        supabase.from('ecritures_brouillon').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).is('piece_id', null)
          .order('id').range(debut, fin),
      ),
      // L'ouverture du dossier : la date de ses à-nouveaux, la plus ancienne en tête.
      lireTout<Pick<ANouveau, 'id' | 'date'>>((debut, fin) =>
        supabase.from('a_nouveaux').select('id, date', { count: 'exact' })
          .eq('dossier_id', dossierId).order('date').order('id').range(debut, fin),
      ),
    ])
    setCotisations(lectureCotisations.lignes)
    setCotisationsIncompletes(lectureCotisations.complete ? null : lectureCotisations.motif)
    setDocumentsCotisation(lectureDocuments.lignes)
    setPaiements(lecturePaiements.lignes)
    setPaiementsIncomplets(lecturePaiements.complete ? null : lecturePaiements.motif)
    setEcritures(lectureEcritures.lignes)
    setEcrituresIncompletes(lectureEcritures.complete ? null : lectureEcritures.motif)
    setOuverture(lectureOuverture.complete ? (lectureOuverture.lignes[0]?.date ?? null) : undefined)
    setOuvertureIncomplete(lectureOuverture.complete ? null : lectureOuverture.motif)
    setLectureIncomplete(
      [lectureCotisations, lectureDocuments, lecturePaiements]
        .find((l) => !l.complete)?.motif ?? null,
    )
    setLoading(false)
  }

  useEffect(() => { load() }, [dossierId])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    // Seconde ceinture : le bouton est grisé sur une échéance d'un exercice figé, et la raison déjà dite au-dessus.
    if (refusAjout) return
    // Posé avant le `try` : dedans, le `return` du deuxième envoi sortirait par le `finally` et relâcherait le verrou du
    // premier, encore en cours.
    if (saisieEnCours.current) return
    saisieEnCours.current = true
    setSaving(true)
    setError(null)
    try {
      const { error: insertError } = await supabase.from('cotisations_declarees').insert({
        dossier_id: dossierId,
        echeance,
        montant_appele: parseFloat(montantAppele),
        montant_verse: montantVerse ? parseFloat(montantVerse) : null,
        montant_csg_crds: montantCsgCrds ? parseFloat(montantCsgCrds) : null,
        previsionnel,
      })
      if (insertError) throw insertError
      setEcheance('')
      setMontantAppele('')
      setMontantVerse('')
      setMontantCsgCrds('')
      setPrevisionnel(false)
      // L'onglet reste ouvert sur ce qu'il écrit : le verrou attend la relecture, sans quoi un nouvel envoi partirait
      // pendant que la liste ne porte pas encore l'échéance qui vient d'être écrite.
      await load()
    } catch (err) {
      setError(messageErreur(err))
    } finally {
      saisieEnCours.current = false
      setSaving(false)
    }
  }

  // `lignes_bancaires.cotisation_id` est en `ON DELETE SET NULL` : une suppression directe laisserait le
  // prélèvement qui la paie « rapproché » sans plus rien qui le justifie, et son écriture au brouillon.
  // `supprimer_echeance_cotisation` remet ce mouvement à traiter et retire son écriture, puis l'échéance,
  // dans une transaction — et refuse sur une écriture validée. La confirmation NOMME le mouvement : une
  // confirmation nomme ce qu'on perd. Sous le verrou des écritures du relevé, et son refus se dit : un
  // retrait qui échoue sans un mot laisserait recliquer pour le même silence.
  async function supprimer(c: CotisationDeclaree) {
    if (ecritureEnCours.current) return
    // Seconde ceinture : le bouton d'une échéance figée n'est pas rendu.
    const figee = figeeDe(c)
    if (figee) {
      setError(`${figee} : cette échéance ne se supprime plus.`)
      return
    }
    // Payée depuis le compte personnel, elle emporte son paiement et son écriture (la clé est en cascade) : la
    // confirmation le nomme.
    const message = [avertissementRetraitEcheance(paiementDe.get(c.id) ?? null, paiementsIncomplets === null), avertissementSuppressionEcheancePayee(c)]
      .filter((m) => m !== null).join(' ')
    if (!window.confirm(`Retirer cette échéance ?\n\n${message}`)) return
    ecritureEnCours.current = true
    setEnCours(true)
    try {
      const { error: erreurRetrait } = await supabase.rpc('supprimer_echeance_cotisation', { p_cotisation_id: c.id })
      if (erreurRetrait) setError(`L’échéance n’a pas pu être retirée : ${messageErreur(erreurRetrait, 'raison inconnue')}`)
      await load()
    } finally {
      ecritureEnCours.current = false
      setEnCours(false)
    }
  }

  // Chaque échéance par la même fonction de la base que le rapprochement de l'onglet Banque : elle vérifie
  // l'écriture et l'écrit avec le rapprochement, et remplace celle qui ne correspond plus. Un échec
  // n'interrompt pas le lot, et se dit. Le verrou se relâche APRÈS la relecture : relâché avant, la liste
  // montrerait encore « Écrire les N » sur des échéances déjà écrites, le temps qu'elle revienne.
  async function ecrireLesEcheances() {
    if (ecritureEnCours.current || ecritureSuspendue || aEcrire.length === 0) return
    ecritureEnCours.current = true
    setEnCours(true)
    try {
      const echecs: string[] = []
      for (const { ligne, cotisation } of aEcrire) {
        const { error: erreurEcriture } = await supabase.rpc('rapprocher_cotisation', {
          p_ligne_bancaire_id: ligne.id,
          p_cotisation_id: cotisation.id,
          p_ecritures: ecritureDeLaCotisation(ligne, cotisation, modeComptable),
        })
        if (erreurEcriture) echecs.push(messageErreur(erreurEcriture, 'raison inconnue'))
      }
      if (echecs.length > 0) {
        window.alert(
          `${aEcrire.length - echecs.length} échéance(s) écrite(s) sur ${aEcrire.length}. `
          + `${echecs.length} n’ont pas pu l’être : ${echecs[0]}`,
        )
      }
      await load()
    } finally {
      ecritureEnCours.current = false
      setEnCours(false)
    }
  }

  // DÉCLARER UNE ÉCHÉANCE PAYÉE DEPUIS LE COMPTE PERSONNEL : la base vérifie l'écriture composée par le module et l'écrit
  // avec la date du paiement, d'un seul tenant. Sous le verrou des écritures du relevé : ces gestes écrivent le même
  // brouillon, et « Écrire les N » ou « Retirer » partis pendant celui-ci liraient une échéance qui change sous eux. Le
  // verrou se relâche APRÈS la relecture : relâché avant, la ligne offrirait encore de déclarer l'échéance déjà payée.
  async function declarerPaiementPersonnel(c: CotisationDeclaree, date: string) {
    if (ecritureEnCours.current) return
    // Seconde ceinture : le bouton est grisé sur un refus, et la raison dite au-dessus — la base reste juge.
    if (ecritureSuspendue || ouverture === undefined || loading) return
    if (refusPaiementPersonnel(c, date, contextePaiementPersonnel(c))) return
    ecritureEnCours.current = true
    setEnCours(true)
    setErreurPaiementPersonnel(null)
    try {
      const { error: erreurDeclaration } = await supabase.rpc(
        'enregistrer_paiement_personnel_cotisation', argumentsDeLaDeclaration(dossierId, c, date, modele),
      )
      if (erreurDeclaration) {
        setErreurPaiementPersonnel(`Le paiement n’a pas pu être déclaré : ${messageErreur(erreurDeclaration, 'raison inconnue')}`)
      } else {
        setPaiementPersonnelDe(null)
      }
      await load()
    } finally {
      ecritureEnCours.current = false
      setEnCours(false)
    }
  }

  // LE RETRAIT D'UN PAIEMENT PERSONNEL — offert seulement quand sa fonction est en base (`RETRAIT_EXPORTE`) : il défait
  // le paiement et son écriture ensemble, et l'échéance compte de nouveau à son échéance. Même verrou, même relecture.
  async function retirerPaiementPersonnel(c: CotisationDeclaree) {
    if (!RETRAIT_EXPORTE || ecritureEnCours.current) return
    const refus = refusRetraitPaiementPersonnel(c, anneesValidees)
    if (refus) {
      setError(refus.message)
      return
    }
    if (!window.confirm(`Retirer ce paiement ?\n\n${avertissementRetraitPaiementPersonnel(c, modele)}`)) return
    ecritureEnCours.current = true
    setEnCours(true)
    try {
      const { error: erreurRetrait } = await supabase.rpc('retirer_paiement_personnel_cotisation', {
        p_dossier_id: dossierId, p_cotisation_id: c.id,
      })
      if (erreurRetrait) setError(`Le paiement n’a pas pu être retiré : ${messageErreur(erreurRetrait, 'raison inconnue')}`)
      await load()
    } finally {
      ecritureEnCours.current = false
      setEnCours(false)
    }
  }

  async function attacherDocument(cotisationId: string, documentId: string) {
    if (!documentId) return
    // Refusé, le rattachement se DIT : la relecture laisse l'avis sans son document, et sans un mot on le croirait joint.
    const { error: erreurRattachement } = await supabase.from('documents_divers').update({ attached_to_cotisation_id: cotisationId }).eq('id', documentId)
    setError(erreurRattachement ? `Le document n’a pas pu être rattaché : ${messageErreur(erreurRattachement, 'refus de la base')}` : null)
    load()
  }

  async function detacherDocument(documentId: string) {
    const { error: erreurRattachement } = await supabase.from('documents_divers').update({ attached_to_cotisation_id: null }).eq('id', documentId)
    setError(erreurRattachement ? `Le document n’a pas pu être détaché : ${messageErreur(erreurRattachement, 'refus de la base')}` : null)
    load()
  }

  // Upload direct depuis cet onglet, sans passer par Documents — pratique pour les vieux appels de
  // cotisation (années précédentes) qu'on n'a pas forcément fait passer par un import en masse.
  // Catégorie forcée à "cotisation" (contexte de l'onglet). Le document est créé tout de suite ;
  // l'extraction (jusqu'à 50s sur un multi-pages) tourne ensuite en arrière-plan sans bloquer la suite
  // (un autre dépôt, changer d'onglet...) — un avis d'appel réel a un échéancier de plusieurs
  // mensualités (pas "un montant + une date"), proposées ci-dessous dès qu'elles arrivent, jamais
  // créées automatiquement sans confirmation.
  async function handleUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (depotEnCours.current) return
    depotEnCours.current = true
    setUploading(true)
    setError(null)
    setEcheancesProposees([])
    setDiagCotisation(undefined)
    try {
      const hash = await hashFichier(file)
      if (await fichierDejaPresent(dossierId, hash)) {
        setError('Ce fichier est déjà présent dans ce dossier (Pièces ou Documents) — pas réajouté.')
        return
      }
      const path = `${dossierId}/documents/${Date.now()}-${slugify(file.name)}`
      const { error: uploadError } = await supabase.storage.from('pieces').upload(path, file)
      if (uploadError) throw uploadError
      const { error: insertError } = await supabase.from('documents_divers').insert({
        dossier_id: dossierId,
        storage_path: path,
        storage_hash: hash,
        nom_fichier: file.name,
        categorie: 'cotisation',
      })
      if (insertError) throw insertError
      load()
      setAnalyseEnCours(true)

      extractPiece(file, file.name)
        .catch(() => null)
        .then((extraction) => {
          setEcheancesProposees(extraction?.lecture_cotisation.echeances ?? [])
          // Toujours affiché (pas seulement à zéro résultat) : un document peut manquer une partie de
          // ses échéances (ex. l'année suivante) alors que le reste a bien été trouvé — invisible
          // autrement.
          setDiagCotisation(extraction?.lecture_cotisation._diag_cotisation)
        })
        .finally(() => setAnalyseEnCours(false))
    } catch (err) {
      setError(messageErreur(err))
    } finally {
      // Relâché à la fin de l'ENVOI, pas de la lecture en arrière-plan : déposer un autre avis pendant qu'elle tourne
      // reste permis (voir `analyseEnCours`), et le même fichier, déjà en base, serait reconnu par son empreinte.
      depotEnCours.current = false
      setUploading(false)
      e.target.value = ''
    }
  }

  // Une échéance "prévisionnelle" (CARPIMKO, année suivante) déjà créée peut être re-proposée plus
  // tard par l'appel définitif, à la même date mais avec le vrai montant — on corrige alors la ligne
  // existante (montant + retrait du marqueur) plutôt que de créer un doublon. Une échéance déjà
  // définitive n'est en revanche jamais réécrite automatiquement (un montant déjà confirmé/vérifié ne
  // doit pas être silencieusement remplacé).
  //
  // UNE LECTURE PARTIELLE NE COMMANDE PAS D'ÉCRITURE : le dédoublonnage compare aux échéances LUES.
  // Sur une liste tronquée, une échéance déjà créée le serait une seconde fois, et la cotisation
  // compterait double dans la 2035 (case BK). La création se suspend donc, comme l'import d'un relevé.
  // Et le verrou est un `useRef` : `creantEcheances`, un état, laissait passer deux clics du même
  // rendu, qui créaient chacun tout l'échéancier.
  //
  // UNE LISTE PAS ENCORE REVENUE NE COMMANDE PAS D'ÉCRITURE NON PLUS : pendant la lecture (`loading`, à la première comme
  // à chaque relecture), `cotisations` est vide ou d'avant la dernière écriture — toutes les échéances proposées
  // paraîtraient nouvelles. La création attend la fin de la lecture, et le dit.
  async function creerEcheancesProposees() {
    if (proposeesOuvertes.length === 0 || cotisationsIncompletes !== null || loading || creationEnCours.current) return
    creationEnCours.current = true
    setCreantEcheances(true)
    setError(null)
    // L'insertion, puis les mises à jour une à une : un échec au milieu laisse en base ce qui est déjà écrit. Sans relecture,
    // la liste d'avant ne le porte pas, et un second clic RÉINSÉRERAIT les échéances créées — sans unicité (dossier,
    // échéance) en base, la cotisation compterait deux fois dans la 2035.
    let ecrit = false
    try {
      // Seules les échéances d'un exercice ouvert : une seule date figée ferait refuser toute l'insertion, qui est d'un
      // seul tenant — et une prévisionnelle figée ne se corrige plus.
      const aInserer = proposeesOuvertes
        .filter((e) => !cotisations.some((c) => c.echeance === e.date))
        .map((e) => ({ dossier_id: dossierId, echeance: e.date, montant_appele: e.montant, previsionnel: e.previsionnel }))

      // Une prévisionnelle que le document confirme prend son montant — sauf figée : payée dans un exercice validé, elle se
      // juge à la date de son paiement, et la base refuserait. Comptée alors avec les figées, pas « déjà à jour » : son
      // montant reste celui de la prévision.
      const aConfirmer = proposeesOuvertes
        .map((e) => ({ e, existante: cotisations.find((c) => c.echeance === e.date) }))
        .filter((x): x is { e: { date: string; montant: number; previsionnel: boolean }; existante: CotisationDeclaree } =>
          !!x.existante?.previsionnel && !x.e.previsionnel,
        )
      // Payée depuis le compte personnel, ses montants ne changent plus tant que le paiement tient (la base le refuse) :
      // écartée, et dite à part.
      const payeesPersonnellement = aConfirmer.filter((x) => !figeeDe(x.existante) && x.existante.paiement_personnel_le)
      const aMettreAJour = aConfirmer.filter((x) => !figeeDe(x.existante) && !x.existante.paiement_personnel_le)

      if (aInserer.length > 0) {
        const { error: insertError } = await supabase.from('cotisations_declarees').insert(aInserer)
        if (insertError) throw insertError
        ecrit = true
      }
      for (const { e, existante } of aMettreAJour) {
        const { error: updateError } = await supabase
          .from('cotisations_declarees')
          .update({ montant_appele: e.montant, previsionnel: false })
          .eq('id', existante.id)
        if (updateError) throw updateError
        ecrit = true
      }

      const figees = echeancesProposees.length - proposeesOuvertes.length + aConfirmer.length - aMettreAJour.length - payeesPersonnellement.length
      const ignorees = proposeesOuvertes.length - aInserer.length - aConfirmer.length
      setEcheancesProposees([])
      load()
      if (ignorees > 0 || figees > 0 || payeesPersonnellement.length > 0) {
        window.alert(
          `${aInserer.length + aMettreAJour.length} échéance(s) prise(s) en compte`
          + (ignorees > 0 ? `, ${ignorees} déjà à jour (ignorée(s))` : '')
          + (figees > 0 ? `, ${figees} d’un exercice validé (ignorée(s)) : une échéance ne s’y ajoute plus` : '')
          + (payeesPersonnellement.length > 0
            ? `, ${payeesPersonnellement.length} payée(s) depuis le compte personnel (ignorée(s)) : ses montants ne changent plus tant que ce paiement tient`
            : '')
          + '.',
        )
      }
    } catch (err) {
      setError(messageErreur(err))
      // Un échec PARTIEL : la liste se relit avant tout second geste, sous le verrou — relâché après elle.
      if (ecrit) await load()
    } finally {
      creationEnCours.current = false
      setCreantEcheances(false)
    }
  }

  async function voirDocument(storagePath: string) {
    const resultat = await ouvrirApercu('pieces', storagePath, 300)
    if (!resultat.ok) window.alert(resultat.message)
  }

  // Une cotisation sans ventilation saisie n'a pas « zéro » de CSG déductible : on ne sait pas.
  // D'où `null` plutôt que 0 — c'est ce que la colonne affiche en « — ».
  function csgDeductible(montantCsgCrds: number | null): number | null {
    return montantCsgCrds == null ? null : partDeductible(montantCsgCrds)
  }

  const documentsNonRattaches = documentsCotisation.filter((d) => !d.attached_to_cotisation_id)

  // Le mouvement qui paie chaque échéance — un au plus (contrainte `lignes_bancaires_cotisation_unique`).
  const paiementDe = new Map(paiements.flatMap((l) => (l.cotisation_id ? [[l.cotisation_id, l] as const] : [])))
  // L'exercice validé qui fige une échéance, dit avec les mots de la base : sa date est celle du mouvement qui la paie,
  // sinon celle de son paiement depuis le compte personnel, sinon son échéance (`garder_cotisation_valide`). Sur un relevé
  // lu en partie, un paiement non lu fait juger l'échéance à sa date à elle : la base reste juge, et son refus se dit.
  const figeeDe = (c: CotisationDeclaree) =>
    dateFigee(paiementDe.get(c.id)?.date ?? c.paiement_personnel_le ?? c.echeance, anneesValidees)
  // Ceux qu'on peut écrire : pas d'un exercice validé, où la base refuse d'écrire. La colonne « Paiement » dit pourtant
  // ce qu'il en est de CHAQUE échéance, figée comprise (`idsSansEcritureJuste`) : une échéance figée sans écriture
  // manque au FEC de son exercice, et le dire vaut mieux que de le taire — sans la compter dans un geste refusé.
  const aEcrire = cotisationsAEcrire(ecritures, paiements, cotisations, modeComptable, frontiere)
  const idsSansEcritureJuste = new Set(cotisationsAEcrire(ecritures, paiements, cotisations, modeComptable, null).map((r) => r.cotisation.id))
  const lignesEcrites = new Set(ecritures.map((e) => e.ligne_bancaire_id))
  // Un rapprochement qui ne PEUT pas s'écrire — un encaissement rapproché d'un appel : sa raison, montrée
  // sur la ligne. Le geste est d'annuler ce rapprochement dans l'onglet Banque. Lu sans la frontière : c'est un fait,
  // qui décide aussi du versé, et il se montre même figé — sans le conseil d'un geste que la base refuserait.
  const refuses = new Map(rapprochementsCotisationRefuses(paiements, cotisations, modeComptable, null).map((r) => [r.cotisation.id, r.raison]))
  // Une échéance saisie dans un exercice figé ne s'ajoute plus ; une proposée par un document non plus.
  const refusAjout = echeance && dateFigee(echeance, anneesValidees)
    ? `${dateFigee(echeance, anneesValidees)} : une échéance ne s’y ajoute plus.`
    : null
  const proposeesOuvertes = echeancesProposees.filter((e) => !dateFigee(e.date, anneesValidees))
  const prevuePayeePersonnellement = (date: string) =>
    cotisations.some((c) => c.echeance === date && c.previsionnel && !!c.paiement_personnel_le)
  // UNE LECTURE PARTIELLE NE COMMANDE PAS D'ÉCRITURE (voir CLAUDE.md) : une échéance dont le paiement ou
  // l'écriture n'a pas été lu paraîtrait à écrire, ou écrite ; et un échéancier lu à moitié en cacherait.
  const ecritureSuspendue = cotisationsIncompletes ?? paiementsIncomplets ?? ecrituresIncompletes

  // LES PAIEMENTS DEPUIS LE COMPTE PERSONNEL. Ce que l'écran sait du dossier pour juger une déclaration, lu en entier.
  const contextePaiementPersonnel = (c: CotisationDeclaree) => ({
    modele, mouvement: paiementDe.get(c.id) ?? null, anneesValidees, ouverture: ouverture ?? null, aujourdHui: aujourdHuiAParis(),
  })
  // Le geste n'est offert que sur ce que tout l'onglet a lu : une échéance que rien ne paie, ni mouvement ni compte
  // personnel, qui n'est pas figée — sur une lecture partielle, un paiement non lu la ferait paraître impayée.
  const declarationOfferte = (c: CotisationDeclaree) =>
    !ecritureSuspendue && ouverture !== undefined && !paiementDe.has(c.id) && !c.paiement_personnel_le && !figeeDe(c)
  // L'état de leur écriture : à reprendre (absente, différente, ou qui ne peut pas s'écrire), hors exercice figé ; et,
  // pour dire ce qu'il en est d'une échéance figée, le même contrôle sans la frontière.
  const aReprendre = new Map(paiementsPersonnelsAReprendre(ecritures, cotisations, modele, frontiere).map((p) => [p.cotisation.id, p.raison]))
  const aReprendreSansFrontiere = new Set(paiementsPersonnelsAReprendre(ecritures, cotisations, modele, null).map((p) => p.cotisation.id))
  const cotisationsEcrites = new Set(ecritures.flatMap((e) => (e.cotisation_id ? [e.cotisation_id] : [])))
  const echeanceDeLaFenetre = paiementPersonnelDe === null ? null : cotisations.find((c) => c.id === paiementPersonnelDe) ?? null

  // Le versé d'une échéance : le montant saisi, sinon celui du mouvement rapproché qui la paie, quand ce
  // rapprochement s'écrit. Une échéance prélevée sans versement saisi n'est plus « à verser » — le relevé
  // fait foi, comme dans la 2035 et l'échéancier des dettes de Financement.
  // Payée depuis le compte personnel, l'échéance est versée : son montant (`montantDeLEcheance`) — sauf si ses montants ne
  // peuvent pas s'écrire, ce que la colonne « Paiement » dit.
  function verseDe(c: CotisationDeclaree): number | null {
    if (c.montant_verse != null) return c.montant_verse
    if (c.paiement_personnel_le) return refusMontantsDuPaiementPersonnel(c, modeComptable) ? null : montantDeLEcheance(c)
    const paiement = paiementDe.get(c.id)
    return paiement && !refuses.has(c.id) ? -paiement.montant : null
  }

  const anneesDisponibles = [...new Set(cotisations.map((c) => anneeDe(c.echeance)))].sort((a, b) => b - a)
  const cotisationsFiltrees = anneeFilter === 'toutes' ? cotisations : cotisations.filter((c) => anneeDe(c.echeance) === anneeFilter)

  // La recherche ne filtre QUE les lignes affichées : les quatre totaux ci-dessous restent calculés
  // sur `cotisationsFiltrees`. Les brancher sur la recherche ferait varier le « reste à verser » et la
  // CSG déductible au fil de la frappe, alors que ce sont des montants d'exercice, pas des sous-totaux
  // de sélection.
  const cotisationsAffichees = cotisationsFiltrees.filter((c) =>
    correspondALaRecherche(
      [c.echeance, formatDate(c.echeance), c.montant_appele, c.montant_verse, c.montant_csg_crds,
        c.previsionnel ? 'prévisionnel' : null,
        paiementDe.has(c.id) ? formatDate(paiementDe.get(c.id)!.date) : null,
        c.paiement_personnel_le ? formatDate(c.paiement_personnel_le) : null,
        documentsCotisation.find((d) => d.attached_to_cotisation_id === c.id)?.nom_fichier],
      recherche,
    ),
  )

  const totalAppele = cotisationsFiltrees.reduce((sum, c) => sum + c.montant_appele, 0)
  const totalVerse = cotisationsFiltrees.reduce((sum, c) => sum + (verseDe(c) ?? 0), 0)
  const totalCsgDeductible = cotisationsFiltrees.reduce((sum, c) => sum + (csgDeductible(c.montant_csg_crds) ?? 0), 0)

  return (
    <>
      <BandeauLecturePartielle
        quoi="Les cotisations, leurs justificatifs et leurs paiements"
        accord="lus"
        motif={lectureIncomplete}
        consequence={
          'Les totaux appelé et versé ci-dessous portent donc sur une partie de l’exercice, un appel ' +
          'peut paraître sans justificatif ou sans paiement alors qu’il en a un, et l’écriture des ' +
          'échéances payées est suspendue.'
        }
      />
      <BandeauLecturePartielle
        quoi="Les écritures des échéances payées"
        accord="lues"
        motif={ecrituresIncompletes}
        consequence="Une échéance payée peut paraître sans écriture alors qu’elle en a une : leur écriture est suspendue."
      />
      <BandeauLecturePartielle
        quoi="L’ouverture du dossier"
        accord="lue"
        motif={ouvertureIncomplete}
        consequence="Une échéance payée depuis le compte personnel ne se déclare pas : un paiement d’avant l’ouverture, dans les comptes repris, ne serait pas dit avant le clic."
      />
      <BrouillonBanner />

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginTop: 0 }}>Ajouter une échéance</h3>
        <form onSubmit={handleSubmit}>
          <div className="field-row">
            <div className="field">
              <label htmlFor="echeance">Échéance</label>
              <input id="echeance" type="date" required value={echeance} onChange={(e) => setEcheance(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="appele">Montant appelé</label>
              <input id="appele" type="number" step="0.01" required value={montantAppele} onChange={(e) => setMontantAppele(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="verse">Montant versé</label>
              <input id="verse" type="number" step="0.01" value={montantVerse} onChange={(e) => setMontantVerse(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="csg">dont CSG-CRDS</label>
              <input id="csg" type="number" step="0.01" value={montantCsgCrds} onChange={(e) => setMontantCsgCrds(e.target.value)} />
            </div>
          </div>
          <p className="muted" style={{ marginTop: -8 }}>
            "dont CSG-CRDS" : uniquement la part CSG-CRDS visible sur le décompte Urssaf, pas le montant
            appelé total — c'est la seule part sur laquelle la déductibilité peut être calculée.
          </p>
          <div className="field">
            <label>
              <input type="checkbox" checked={previsionnel} onChange={(e) => setPrevisionnel(e.target.checked)} style={{ marginRight: 6 }} />
              Prévisionnel (estimation, pas encore un appel définitif)
            </label>
          </div>
          {refusAjout && <p className="error-text">{refusAjout}</p>}
          {error && <p className="error-text">{error}</p>}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn btn-primary btn-sm" type="submit" disabled={saving || refusAjout !== null}>
              {saving ? 'Enregistrement…' : 'Ajouter'}
            </button>
            <label className="btn btn-outline btn-sm" style={{ cursor: 'pointer' }}>
              {uploading ? 'Envoi…' : '+ Ajouter un appel de cotisation (PDF/JPG/PNG)'}
              <input type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ display: 'none' }} disabled={uploading} onChange={handleUpload} />
            </label>
            {analyseEnCours && <span className="badge badge-neutral">Analyse du document en cours…</span>}
          </div>
        </form>
        <p className="muted" style={{ marginTop: 10, marginBottom: 0 }}>
          Utile pour les papiers des années précédentes : dépose-le ici directement, l'appli essaie d'y
          reconnaître l'échéancier automatiquement — sinon il apparaît dans le sélecteur "Pièce jointe"
          ci-dessous pour l'attacher à une échéance saisie à la main.
        </p>
        {diagCotisation && diagCotisation.length > 0 && (
          <details style={{ marginTop: 10 }}>
            <summary className="muted" style={{ cursor: 'pointer' }}>
              Texte brut lu sur le document (diagnostic, temporaire) — utile si une échéance manque, clique pour copier
            </summary>
            <pre style={{ fontSize: '0.75rem', background: 'var(--color-bg)', padding: 8, borderRadius: 8, overflowX: 'auto', userSelect: 'all' }}>
              {diagCotisation.join('\n')}
            </pre>
          </details>
        )}
      </div>

      {echeancesProposees.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ marginTop: 0 }}>Échéances trouvées sur ce document ({echeancesProposees.length})</h3>
          <p className="muted" style={{ marginTop: -8 }}>
            Vérifie avant de créer — rien n'est encore enregistré. Une échéance "Prévisionnel" vient
            d'une section estimée du document (pas encore un appel définitif) — remplacée automatiquement
            si tu déposes plus tard l'appel définitif pour la même date.
          </p>
          <div className="table-scroll">
            <table>
              <thead><tr><th>Échéance</th><th>Montant appelé</th><th>Statut</th></tr></thead>
              <tbody>
                {echeancesProposees.map((e, i) => (
                  <tr key={i}>
                    <td>{formatDate(e.date)}</td>
                    <td>{formatMoney(e.montant)}</td>
                    <td>
                      {dateFigee(e.date, anneesValidees)
                        ? <span className="muted" title={`${dateFigee(e.date, anneesValidees)} : une échéance ne s’y ajoute plus.`}>Exercice validé</span>
                        : !e.previsionnel && prevuePayeePersonnellement(e.date)
                          // La prévisionnelle qu'il confirmerait est payée depuis le compte personnel : la base refuse d'en
                          // changer les montants tant que ce paiement tient. Dit avant le clic ; le clic l'écarte.
                          ? (
                            <span className="muted" title="Ses montants ne changent plus tant que ce paiement tient : elle ne sera pas mise à jour.">
                              Payée depuis le compte personnel
                            </span>
                          )
                          : e.previsionnel
                          ? <span className="badge badge-warning">Prévisionnel</span>
                          : <span className="badge badge-ok">Définitif</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
            <button
              className="btn btn-primary btn-sm"
              disabled={creantEcheances || cotisationsIncompletes !== null || loading || proposeesOuvertes.length === 0}
              onClick={creerEcheancesProposees}
            >
              {creantEcheances ? 'Création…' : `Créer ces ${proposeesOuvertes.length} échéance(s)`}
            </button>
            <button className="btn btn-outline btn-sm" onClick={() => setEcheancesProposees([])}>Ignorer</button>
          </div>
          {proposeesOuvertes.length < echeancesProposees.length && (
            <p className="muted" style={{ marginTop: 8, marginBottom: 0 }}>
              {echeancesProposees.length - proposeesOuvertes.length === 1
                ? '1 échéance est datée d’un exercice validé : elle ne s’y ajoute plus, et ne sera pas créée.'
                : `${echeancesProposees.length - proposeesOuvertes.length} échéances sont datées d’un exercice validé : elles ne s’y ajoutent plus, et ne seront pas créées.`}
            </p>
          )}
          {loading && (
            <p className="muted" style={{ marginTop: 8, marginBottom: 0 }}>
              Les échéances du dossier sont en cours de lecture : la création attend la fin de la lecture, pour ne pas
              créer deux fois une échéance déjà enregistrée.
            </p>
          )}
          {cotisationsIncompletes && (
            <p className="error-text" style={{ marginTop: 8, marginBottom: 0 }}>
              Création suspendue : les échéances déjà enregistrées n'ont pas pu être lues en entier
              ({cotisationsIncompletes}). Une échéance déjà créée le serait une seconde fois, et la
              cotisation compterait double sur la 2035. Recharge la page.
            </p>
          )}
        </div>
      )}

      {documentsNonRattaches.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ marginTop: 0 }}>Appels de cotisation non rattachés ({documentsNonRattaches.length})</h3>
          <p className="muted" style={{ marginTop: -8 }}>
            Déposés mais pas encore attachés à une échéance — crée ou choisis l'échéance correspondante
            dans le tableau ci-dessous, la colonne "Pièce jointe" les propose.
          </p>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {documentsNonRattaches.map((d) => (
              <li key={d.id}>
                <a href="#" className="nom-fichier" onClick={(e) => { e.preventDefault(); voirDocument(d.storage_path) }}>{d.nom_fichier}</a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {aEcrire.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <strong>
            {aEcrire.length === 1
              ? '1 échéance payée dont l’écriture manque ou n’est plus à jour'
              : `${aEcrire.length} échéances payées dont l’écriture manque ou n’est plus à jour`}
          </strong>
          <p className="muted" style={{ margin: '6px 0 10px' }}>
            Une échéance rapprochée de son prélèvement avant que ce rapprochement s’écrive n’a pas d’écriture :
            elle manque au FEC, et la trésorerie de l’application ne retrouve pas le relevé. Une CSG-CRDS saisie
            depuis change aussi l’écriture. Le bouton écrit chacune
            {modeComptable === 'tresorerie' ? ' au compte 646000, sa CSG-CRDS au 108000,' : ' au compte 646000,'} face à
            la banque.
          </p>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={enCours || !!ecritureSuspendue}
            onClick={ecrireLesEcheances}
          >
            {enCours ? 'Écriture…' : aEcrire.length === 1 ? 'Écrire cette échéance' : `Écrire les ${aEcrire.length}`}
          </button>
          {ecritureSuspendue && (
            <p className="muted" style={{ margin: '8px 0 0' }}>
              Suspendu : la lecture est partielle ({ecritureSuspendue}), et ce compte peut être faux. Recharge la page.
            </p>
          )}
        </div>
      )}

      <AnneeTabs annees={anneesDisponibles} valeur={anneeFilter} onChange={setAnneeFilter} />

      {cotisationsFiltrees.length > 0 && (
        <div className="card" style={{ marginBottom: 20, display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <div>
            <span className="muted" style={{ display: 'block' }}>Total appelé</span>
            <strong>{formatMoney(totalAppele)}</strong>
          </div>
          <div>
            <span className="muted" style={{ display: 'block' }}>Total versé</span>
            <strong>{formatMoney(totalVerse)}</strong>
          </div>
          <div>
            <span className="muted" style={{ display: 'block' }}>Reste à verser</span>
            <strong>{formatMoney(totalAppele - totalVerse)}</strong>
          </div>
          <div>
            <span className="muted" style={{ display: 'block' }}>CSG déductible (proposée)</span>
            <strong>{formatMoney(totalCsgDeductible)}</strong>
          </div>
        </div>
      )}

      <div style={{ marginBottom: 14 }}>
        <BarreRecherche
          valeur={recherche}
          onChange={setRecherche}
          placeholder="Rechercher une échéance, un montant…"
          affiches={cotisationsAffichees.length}
          total={cotisationsFiltrees.length}
        />
      </div>

      {/* Repliée en fiches sous 860 pixels de carte (08/10/2026) : huit colonnes, dont le paiement, la pièce jointe et le bouton
          « Retirer », ne tiennent ni dans un téléphone ni, volet de droite ouvert, dans le panneau central — « Retirer » passait derrière
          un défilement latéral que rien n'annonce, et le choix de la pièce jointe, large comme son nom de fichier, élargissait la ligne.
          `table-empilable-en-carte` rend aux fiches le jeu que la carte, sans marge, ne leur donne pas. */}
      <div className="card table-scroll" style={{ padding: 0 }}>
        {loading ? (
          <p className="muted" style={{ padding: 20 }}>Chargement…</p>
        ) : cotisationsAffichees.length === 0 ? (
          <div className="empty-state">
            {recherche.trim()
              ? `Aucune échéance ne correspond à « ${recherche.trim()} ».`
              : "Aucune échéance enregistrée pour l'instant."}
          </div>
        ) : (
          <div className="tableau-adaptable">
            <table className="table-empilable table-empilable-en-carte">
              <thead>
                <tr>
                  <th>Échéance</th>
                  <th>Appelé</th>
                  <th>Versé</th>
                  <th>dont CSG-CRDS</th>
                  <th>CSG déductible</th>
                  <th>Paiement</th>
                  <th>Pièce jointe</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {cotisationsAffichees.map((c) => {
                  const documentAttache = documentsCotisation.find((d) => d.attached_to_cotisation_id === c.id)
                  const documentsDisponibles = documentsNonRattaches
                  const paiement = paiementDe.get(c.id)
                  const refus = refuses.get(c.id)
                  const verse = verseDe(c)
                  const figee = figeeDe(c)
                  return (
                    <tr key={c.id}>
                      {/* Une `div` par cellule qui porte plusieurs éléments : repliée, la cellule est une rangée flex, et chaque
                          enfant direct y serait une pièce à part. */}
                      <td data-libelle="Échéance">
                        <div>
                          {formatDate(c.echeance)}
                          {c.previsionnel && <span className="badge badge-warning" style={{ marginLeft: 8 }}>Prévisionnel</span>}
                        </div>
                      </td>
                      <td data-libelle="Appelé">{formatMoney(c.montant_appele)}</td>
                      <td data-libelle="Versé">
                        <div>
                          {verse == null
                            ? '—'
                            : c.montant_verse != null
                              ? formatMoney(verse)
                              // Le montant du mouvement qui la paie, ou de l'échéance payée depuis le compte personnel, faute
                              // de versement saisi : dit d'où il vient.
                              : <>{formatMoney(verse)} <span className="muted">{c.paiement_personnel_le ? '(compte personnel)' : '(relevé)'}</span></>}
                        </div>
                      </td>
                      <td data-libelle="dont CSG-CRDS">{c.montant_csg_crds != null ? formatMoney(c.montant_csg_crds) : '—'}</td>
                      <td data-libelle="CSG déductible">{csgDeductible(c.montant_csg_crds) != null ? formatMoney(csgDeductible(c.montant_csg_crds)) : '—'}</td>
                      <td data-libelle="Paiement">
                        {/* Payée depuis le compte personnel : un fait de la ligne elle-même, dit même sur un relevé lu en
                            partie ; l'état de son écriture, seulement sur un brouillon lu en entier. */}
                        {c.paiement_personnel_le ? (
                          <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                            <span>Payée depuis le compte personnel le {formatDate(c.paiement_personnel_le)}</span>
                            {ecrituresIncompletes
                              ? null
                              : figee
                                // Figée : la base n'y écrit plus. Dit en clair, sans badge qui appellerait un geste.
                                ? aReprendreSansFrontiere.has(c.id)
                                  ? (
                                    <span className="muted" title={`${figee} : aucune écriture ne s’y passe plus.`}>
                                      {cotisationsEcrites.has(c.id) ? 'Écriture différente' : 'Sans écriture'}
                                    </span>
                                  )
                                  : <span className="badge badge-ok">Écrite</span>
                                : aReprendre.has(c.id)
                                  ? <span className="badge badge-warning" title={aReprendre.get(c.id)}>À reprendre</span>
                                  : <span className="badge badge-ok">Écrite</span>}
                            {!ecrituresIncompletes && !figee && aReprendre.has(c.id) && (
                              <span className="muted" style={{ flexBasis: '100%', fontSize: '0.85rem' }}>{aReprendre.get(c.id)}</span>
                            )}
                            {RETRAIT_EXPORTE && (() => {
                              const refusRetrait = refusRetraitPaiementPersonnel(c, anneesValidees)
                              return refusRetrait
                                ? <span className="muted" title={refusRetrait.message}>Ne se retire plus</span>
                                : (
                                  <button type="button" className="btn btn-outline btn-sm" disabled={enCours} onClick={() => retirerPaiementPersonnel(c)}>
                                    Retirer ce paiement
                                  </button>
                                )
                            })()}
                          </span>
                        ) : declarationOfferte(c) ? (
                          <button
                            type="button"
                            className="btn btn-outline btn-sm"
                            disabled={enCours}
                            onClick={() => { setErreurPaiementPersonnel(null); setPaiementPersonnelDe(c.id) }}
                          >
                            Payée depuis le compte personnel…
                          </button>
                        ) : paiementsIncomplets || !paiement
                          /* Sur une lecture partielle du relevé, on ne sait pas : on ne dit rien plutôt que
                             d'annoncer « — » sur une échéance dont le paiement n'a pas été lu. */
                          ? <span className="muted">—</span>
                          : (
                            <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                              <span>{paiement.montant > 0 ? 'Remboursée' : 'Prélevée'} le {formatDate(paiement.date)}</span>
                              {figee
                                // Figée : la base n'y écrit plus. Dit en clair, sans badge qui appellerait un geste.
                                ? refus
                                  ? <span className="muted" title={refus}>Ne s’écrit pas</span>
                                  : ecrituresIncompletes
                                    ? null
                                    : idsSansEcritureJuste.has(c.id)
                                      ? (
                                        <span className="muted" title={`${figee} : aucune écriture ne s’y passe plus.`}>
                                          {lignesEcrites.has(paiement.id) ? 'Écriture différente' : 'Sans écriture'}
                                        </span>
                                      )
                                      : <span className="badge badge-ok">Écrite</span>
                                : refus
                                  ? <span className="badge badge-danger" title={refus}>Ne s’écrit pas</span>
                                  : ecrituresIncompletes
                                    ? null
                                    : idsSansEcritureJuste.has(c.id)
                                      ? <span className="badge badge-warning">{lignesEcrites.has(paiement.id) ? 'À réécrire' : 'Sans écriture'}</span>
                                      : <span className="badge badge-ok">Écrite</span>}
                              {refus && !figee && <span className="muted" style={{ flexBasis: '100%', fontSize: '0.85rem' }}>{refus} Annule ce rapprochement dans l’onglet Banque.</span>}
                            </span>
                          )}
                      </td>
                      <td data-libelle="Pièce jointe" onClick={(e) => e.stopPropagation()}>
                        {documentAttache ? (
                          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <a href="#" className="nom-fichier" onClick={(e) => { e.preventDefault(); voirDocument(documentAttache.storage_path) }}>
                              {documentAttache.nom_fichier}
                            </a>
                            <button className="btn btn-outline btn-sm" onClick={() => detacherDocument(documentAttache.id)}>Détacher</button>
                          </span>
                        ) : documentsDisponibles.length > 0 ? (
                          <select
                            // 200 pixels au plus : un `select` prend la largeur de son option la plus longue — un nom de fichier de 53
                            // caractères, 480 pixels —, et le tableau, plus large que sa carte, passait « Retirer » hors de vue.
                            style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: '4px 6px', maxWidth: 200 }}
                            defaultValue=""
                            onChange={(e) => attacherDocument(c.id, e.target.value)}
                          >
                            <option value="" disabled>Attacher…</option>
                            {documentsDisponibles.map((d) => <option key={d.id} value={d.id}>{d.nom_fichier}</option>)}
                          </select>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td className="td-boutons" onClick={(e) => e.stopPropagation()}>
                        {figee
                          ? <span className="muted" title={`${figee} : cette échéance ne se supprime plus.`}>Figée</span>
                          : <button className="btn btn-danger btn-sm" disabled={enCours} onClick={() => supprimer(c)}>Retirer</button>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Hors de la carte du tableau, dont l'enveloppe est un conteneur de requêtes : voir PaiementPersonnelModal. */}
      {echeanceDeLaFenetre && (
        <PaiementPersonnelModal
          key={echeanceDeLaFenetre.id}
          cotisation={echeanceDeLaFenetre}
          contexte={{ modele, mouvement: paiementDe.get(echeanceDeLaFenetre.id) ?? null, anneesValidees, ouverture: ouverture ?? null }}
          enCours={enCours}
          attente={
            loading
              ? 'Les échéances du dossier sont en cours de lecture : la déclaration attend leur retour.'
              : ecritureSuspendue
                ? `Suspendu : la lecture est partielle (${ecritureSuspendue}). Recharge la page.`
                : ouverture === undefined
                  ? 'Suspendu : l’ouverture du dossier n’a pas pu être lue en entier. Recharge la page.'
                  : null
          }
          erreur={erreurPaiementPersonnel}
          onDeclarer={(date) => declarerPaiementPersonnel(echeanceDeLaFenetre, date)}
          onFermer={() => setPaiementPersonnelDe(null)}
        />
      )}
    </>
  )
}
