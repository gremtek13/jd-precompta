import { useEffect, useRef, useState } from 'react'
import BandeauLecturePartielle from '../../components/BandeauLecturePartielle'
import { lireLaBalanceRepriseDuDossier, type LectureDeLaBalanceReprise } from '../../lib/balanceRepriseDeLInventaireLecture'
import { useAnnee } from '../../context/AnneeContext'
import { useExercicesValides } from '../../context/ExercicesValidesContext'
import { telechargerUnPdf } from '../../lib/apercu'
import type { ModeleComptable } from '../../lib/engagement'
import { telechargerTexte } from '../../lib/fec'
import { aujourdHuiAParis, dateAParis, formatDate } from '../../lib/format'
import { GENRES_DE_PROVISION, type GenreDeProvision, type NatureAExtourner } from '../../lib/inventaire'
import { lireLInventaireDuDossier, type LectureDeLInventaireDeLEcran } from '../../lib/inventaireDeLEcranLecture'
import {
  compteDeProvisionPropose, compteDeRegularisationPropose, confirmationDeLaDeclaration, confirmationDuRetrait,
  confirmationDuRetraitDeLaDeclaration, confirmationDuRetraitDeLaProvision, declarationEnVigueur, ecrituresAJour, euros,
  evaluationDeLExercice, formulaireDeLaProvision, formulaireDeLOperation, formulaireDeProvisionVide, formulaireVide, LIBELLES_DES_GENRES, LIBELLES_DES_NATURES,
  natureAvecTvaDAttente, NATURES_SAISIES, propositionDuProrata, provisionsDeLExercice, refusDeLaDeclarationALEcran,
  refusDuRetraitDeLaDeclarationALEcran, refusDuRetraitDeLaProvision, refusDuRetraitDeLOperation, regularisationsDeLExercice,
  texteDesCentimes, verdictDeLEvaluation, verdictDeLaProvision, verdictDeLaRegularisation, type ContexteDeLInventaire,
  type FormulaireDeProvision, type FormulaireDeRegularisation,
} from '../../lib/inventaireEcran'
import { csvDeLEtat, etatDInventaire, nomDuFichierDeLEtat, pdfDeLEtat } from '../../lib/inventaireEtat'
import {
  citablesParUneProvision, optionCitee, optionsDeCitation, piecesCitablesParUneRegularisation, type Citation, type JustificatifsDuDossier,
} from '../../lib/justificatifsDeLInventaire'
import { lireLesJustificatifsDuDossier, type LectureDesJustificatifs } from '../../lib/justificatifsDeLInventaireLecture'
import { messageErreur } from '../../lib/messageErreur'
import { supabase } from '../../lib/supabase'
import type { OperationInventaire, Provision } from '../../lib/types'
import ChoixDuJustificatif from './ChoixDuJustificatif'
import RegularisationsReprises, { type RepriseAEnregistrer } from './RegularisationsReprises'

// L'ONGLET INVENTAIRE, CÔTÉ CABINET (ligne 35, lot INV5 ; docs/conceptions/35-inventaire.md, § 5.7). En comptabilité d'ENGAGEMENT
// seulement (DossierDetail ne le monte pas autrement), le drapeau `INVENTAIRE_EXPORTE` levé. Le cabinet y saisit, exercice par
// exercice, les régularisations que l'inventaire impose — charges et produits constatés d'avance, factures non parvenues et à
// établir, charges à payer, produits à recevoir —, ouvre et évalue ses provisions, DÉCLARE l'inventaire fait (la validation de
// l'exercice l'attend), et tire l'état d'inventaire — la pièce « Inventaire AAAA » des écritures — en PDF et en CSV.
//
// RIEN DE LA LOGIQUE N'EST ICI. Les refus des fonctions de la base, la composition des écritures (la constatation au 31 décembre
// et son extourne, l'écriture d'une provision par différence), le prorata proposé, l'état sont ceux de lib/inventaire.ts (INV1),
// lib/inventaireDeLaValidation.ts (INV3), lib/inventaireEcran.ts et lib/inventaireEtat.ts ; l'écran appelle, affiche, et pose les
// verrous. Il ne passe que par les fonctions de la base : `enregistrer_operation_inventaire`, `retirer_operation_inventaire`,
// `enregistrer_provision`, `retirer_provision`, `enregistrer_evaluation_provision`, `declarer_inventaire`,
// `retirer_declaration_inventaire`.
//
// LES RÈGLES DES ÉCRANS QUI S'APPLIQUENT : rien avant le retour de la lecture ; l'inventaire lu EN ENTIER — lu en partie, refusé ou
// rompu, l'écran le dit (`BandeauLecturePartielle`) et n'offre AUCUN geste ; la lecture gardée avec l'identifiant du dossier
// (`DossierDetail` reste monté d'un dossier à l'autre : le composant est clé par dossier) ; l'exercice est celui du sélecteur de
// l'en-tête (`useAnnee`), jamais choisi à la place du cabinet ; un geste passe la fonction SQL seule, sous UN verrou `useRef` posé
// avant l'appel et relâché dans un `finally` APRÈS la relecture ; chaque refus se dit AVANT le clic, sur la saisie telle qu'elle
// part ; une saisie RETIENT la version qu'elle remplace ; une confirmation NOMME ce qui part.
//
// LA PIÈCE CITÉE (INV5-Q1 (B)) : la pièce qui fonde une régularisation, et la pièce ou la facture émise d'une provision, se
// CHOISISSENT ici (`ChoixDuJustificatif`), dans les pièces et factures du dossier lues EN ENTIER à part
// (lib/justificatifsDeLInventaireLecture.ts) et filtrées selon ce que la base acceptera (lib/justificatifsDeLInventaire.ts) ; une
// saisie qui remplace propose la pièce déjà citée ; le choix part avec l'écriture, par la fonction de la base, sous le verrou.
//
// LA RÉGULARISATION REPRISE D'UNE BALANCE (INV3-Q2 (A)) : sur le premier exercice du dossier, celui qu'ouvre sa balance reprise, une
// section à part (`RegularisationsReprises`, lib/regularisationRepriseEcran.ts) reprend les anciennes CCA, PCA, FNP et FAE de la
// balance — leur seule extourne au 1er janvier — et dit ce que la validation retiendra. La balance se lit EN ENTIER à part
// (lib/balanceRepriseDeLInventaireLecture.ts) ; ses gestes passent par le verrou de l'onglet, comme tous les autres.

type Message = { genre: 'ok' | 'erreur'; texte: string }

const COMPTE_EN_PLAN: Record<NatureAExtourner, string> = {
  cca: 'Le compte des charges constatées d’avance du plan du dossier.',
  pca: 'Le compte des produits constatés d’avance du plan du dossier.',
  fnp: 'Le compte des factures non parvenues du plan, ou un compte sous le 4088 pour des intérêts courus.',
  fae: 'Le compte des factures à établir du plan du dossier.',
  charge_a_payer: 'Un compte sous le 4282, 4286, 4382, 4386, 44812, 1688 ou 518 — jamais le 467 ni le 468.',
  produit_a_recevoir: 'Un compte sous le 4482 ou le 439 — jamais le 467 ni le 468.',
}

export default function InventaireTab(props: {
  dossierId: string
  dossierNom: string
  modele: ModeleComptable
  assujettiTva: boolean
}) {
  // Une clé par dossier : les formulaires, les cibles saisies et la lecture ne passent pas d'un dossier à l'autre.
  return <InventaireDuDossier key={props.dossierId} {...props} />
}

function InventaireDuDossier({ dossierId, dossierNom, modele, assujettiTva }: {
  dossierId: string
  dossierNom: string
  modele: ModeleComptable
  assujettiTva: boolean
}) {
  const { annee } = useAnnee()
  const { anneesValidees } = useExercicesValides()
  const [lecture, setLecture] = useState<LectureDeLInventaireDeLEcran | null>(null)
  // Les pièces et factures à citer : une lecture à part, qui ne retire que le choix d'une pièce quand elle manque.
  const [lectureDesJustificatifs, setLectureDesJustificatifs] = useState<LectureDesJustificatifs | null>(null)
  // La balance reprise, pour les régularisations reprises : une lecture à part, qui ne retire que leur section quand elle manque.
  const [lectureDeLaBalance, setLectureDeLaBalance] = useState<LectureDeLaBalanceReprise | null>(null)
  const [saisie, setSaisie] = useState<FormulaireDeRegularisation>(() => formulaireVide('cca', {}))
  // Le compte de régularisation tel que le cabinet l'a tapé ; nul tant qu'il n'a rien tapé : celui du plan se propose alors,
  // dérivé au rendu (jamais posé par un effet) — le plan ne se lit qu'avec la lecture.
  const [compteRegul, setCompteRegul] = useState<string | null>(null)
  // La régularisation que le formulaire remplace, ou nulle : il saisit une régularisation neuve.
  const [remplace, setRemplace] = useState<OperationInventaire | null>(null)
  const [saisieProvision, setSaisieProvision] = useState<FormulaireDeProvision>(() => formulaireDeProvisionVide('risque', {}))
  const [compteProv, setCompteProv] = useState<string | null>(null)
  // La provision ouverte que le formulaire remplace (tant qu'elle n'est pas évaluée), ou nulle : il en ouvre une neuve.
  const [remplaceProvision, setRemplaceProvision] = useState<Provision | null>(null)
  // La cible saisie pour chaque provision, au 31 décembre de l'exercice affiché.
  const [cibles, setCibles] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<Message | null>(null)
  // UN verrou pour tous les gestes qui écrivent : deux gestes qui se croisent jugeraient l'inventaire sur deux lectures différentes.
  // Un `useRef`, posé avant le premier `await` : un état React laisse passer deux clics du même rendu. Relâché dans un `finally`,
  // APRÈS la relecture — sinon la liste montrerait encore ce qui vient de partir, le temps qu'elle revienne.
  const ecritureEnCours = useRef(false)
  const [enCours, setEnCours] = useState(false)
  // L'état se TIRE et se télécharge, rien ne s'écrit : son verrou à lui, qui ne retient aucun geste de la base.
  const tirageEnCours = useRef(false)
  const [tirage, setTirage] = useState(false)

  async function relire() {
    setLecture(await lireLInventaireDuDossier(dossierId))
  }

  useEffect(() => {
    let annule = false
    lireLInventaireDuDossier(dossierId).then((l) => { if (!annule) setLecture(l) })
    lireLesJustificatifsDuDossier(dossierId).then((l) => { if (!annule) setLectureDesJustificatifs(l) })
    lireLaBalanceRepriseDuDossier(dossierId).then((l) => { if (!annule) setLectureDeLaBalance(l) })
    return () => { annule = true }
  }, [dossierId])

  const donnees = lecture !== null && lecture.dossierId === dossierId && lecture.etat === 'lue' ? lecture.donnees : null

  const comptes = donnees?.comptes ?? null
  const lectureDesJustificatifsDuDossier = lectureDesJustificatifs !== null && lectureDesJustificatifs.dossierId === dossierId ? lectureDesJustificatifs : null
  const justificatifs = lectureDesJustificatifsDuDossier?.etat === 'lue' ? lectureDesJustificatifsDuDossier.justificatifs : null
  const lectureDeLaBalanceDuDossier = lectureDeLaBalance !== null && lectureDeLaBalance.dossierId === dossierId ? lectureDeLaBalance : null
  const formulaire: FormulaireDeRegularisation = { ...saisie, compteRegularisation: compteRegul ?? compteDeRegularisationPropose(saisie.nature, comptes ?? {}) }
  const provision: FormulaireDeProvision = { ...saisieProvision, compte: compteProv ?? compteDeProvisionPropose(saisieProvision.genre, comptes ?? {}) }

  const exercice = typeof annee === 'number' ? annee : null
  // Le jour à Paris, relu à chaque rendu : « maintenant » ne se lit jamais au chargement d'un module.
  const ctx: ContexteDeLInventaire | null = exercice === null ? null
    : { mode: modele.mode, assujettiTva, exercice, anneesValidees, aujourdhui: aujourdHuiAParis() }

  // ── Les gestes ───────────────────────────────────────────────────────────

  // Un geste : le verrou, l'appel, la relecture (même sur un refus : la base répond souvent « relire l'inventaire »), le message.
  // `appel` rend le refus de la base en clair, ou rien quand elle a écrit.
  async function agir(appel: () => Promise<string | null>, reussite: string, echec: string, apres?: () => void) {
    // Le verrou est lu ET posé ici, avant le premier `await` : l'enveloppe de tous les gestes, qui n'ont chacun que leur refus.
    if (ecritureEnCours.current) return
    ecritureEnCours.current = true
    setEnCours(true)
    setMessage(null)
    try {
      const refus = await appel()
      if (refus !== null) {
        setMessage({ genre: 'erreur', texte: `${echec} : ${refus}` })
      } else {
        apres?.()
        setMessage({ genre: 'ok', texte: reussite })
      }
      await relire()
    } finally {
      ecritureEnCours.current = false
      setEnCours(false)
    }
  }

  // Chaque fonction de la base par son propre appel, son `{ error }` lu et rendu : jamais une écriture supposée réussie.
  async function appelerEnregistrerLOperation(operation: Record<string, unknown>, ecritures: unknown[], versionLue: number | null) {
    const { error } = await supabase.rpc('enregistrer_operation_inventaire', {
      p_dossier_id: dossierId, p_operation: operation, p_ecritures: ecritures, p_version_lue: versionLue,
    })
    return error ? messageErreur(error, 'raison inconnue') : null
  }

  async function appelerRetirerLOperation(id: string, versionLue: number) {
    const { error } = await supabase.rpc('retirer_operation_inventaire', { p_id: id, p_version_lue: versionLue })
    return error ? messageErreur(error, 'raison inconnue') : null
  }

  async function appelerEnregistrerLaProvision(laProvision: Record<string, unknown>, versionLue: number | null) {
    const { error } = await supabase.rpc('enregistrer_provision', { p_dossier_id: dossierId, p_provision: laProvision, p_version_lue: versionLue })
    return error ? messageErreur(error, 'raison inconnue') : null
  }

  async function appelerRetirerLaProvision(id: string, versionLue: number) {
    const { error } = await supabase.rpc('retirer_provision', { p_dossier_id: dossierId, p_id: id, p_version_lue: versionLue })
    return error ? messageErreur(error, 'raison inconnue') : null
  }

  async function appelerEvaluer(evaluation: Record<string, unknown>, ecritures: unknown[], versionLue: number | null) {
    const { error } = await supabase.rpc('enregistrer_evaluation_provision', {
      p_dossier_id: dossierId, p_evaluation: evaluation, p_ecritures: ecritures, p_version_lue: versionLue,
    })
    return error ? messageErreur(error, 'raison inconnue') : null
  }

  async function appelerDeclarer(exerciceDeclare: number) {
    const { error } = await supabase.rpc('declarer_inventaire', { p_dossier_id: dossierId, p_exercice: exerciceDeclare })
    return error ? messageErreur(error, 'raison inconnue') : null
  }

  async function appelerRetirerLaDeclaration(id: string) {
    const { error } = await supabase.rpc('retirer_declaration_inventaire', { p_id: id })
    return error ? messageErreur(error, 'raison inconnue') : null
  }

  function remettreLeFormulaire() {
    setSaisie((f) => formulaireVide(f.nature, {}))
    setCompteRegul(null)
    setRemplace(null)
  }

  function champ<K extends keyof FormulaireDeRegularisation>(cle: K, valeur: FormulaireDeRegularisation[K]) {
    if (cle === 'compteRegularisation') setCompteRegul(valeur as string)
    else setSaisie((f) => ({ ...f, [cle]: valeur }))
  }

  function changerLaNature(nature: NatureAExtourner) {
    // Une autre nature, un autre compte de régularisation : celui du plan quand la nature a son rôle, vide sinon (la saisie libre).
    setSaisie((f) => ({ ...f, nature, tva: '' }))
    setCompteRegul(null)
  }

  function preparerLeRemplacement(o: OperationInventaire) {
    if (ecritureEnCours.current) return
    setRemplace(o)
    setMessage(null)
    const f = formulaireDeLOperation(o)
    setSaisie(f)
    setCompteRegul(f.compteRegularisation)
  }

  // Les verdicts, calculés sur la saisie TELLE QU'ELLE PART : un refus se dit avant le clic.
  const verdict = donnees !== null && ctx !== null ? verdictDeLaRegularisation(formulaire, ctx, donnees, remplace, justificatifs) : null
  const verdictDeLaProvisionSaisie = donnees !== null && ctx !== null && provision.objet.trim() !== ''
    ? verdictDeLaProvision(provision, ctx, donnees, justificatifs, remplaceProvision) : null

  async function enregistrer() {
    if (ecritureEnCours.current || verdict === null || verdict.etat !== 'permis') return
    // La confirmation nomme la paire d'écritures qui part ; un refus ne pose aucun verrou.
    if (!window.confirm(verdict.confirmation)) return
    const { operation, ecritures, versionLue } = verdict.appel
    await agir(
      () => appelerEnregistrerLOperation(operation, ecritures, versionLue),
      `${remplace === null ? 'Régularisation enregistrée' : 'Régularisation remplacée'} : ${formulaire.objet.trim()}.`,
      remplace === null ? 'La régularisation n’a pas été enregistrée' : 'La régularisation n’a pas été remplacée',
      () => remettreLeFormulaire(),
    )
  }

  // La régularisation reprise d'une balance (INV3-Q2 (A)) : la section la compose et la juge, l'onglet l'écrit sous son verrou.
  async function enregistrerLaReprise(v: RepriseAEnregistrer, remplaceReprise: OperationInventaire | null, apres: () => void) {
    if (ecritureEnCours.current) return
    // La confirmation nomme la seule extourne qui part, sa pièce « Inventaire N−1 » et la pièce citée.
    if (!window.confirm(v.confirmation)) return
    const { operation, ecritures, versionLue } = v.appel
    await agir(
      () => appelerEnregistrerLOperation(operation, ecritures, versionLue),
      `${remplaceReprise === null ? 'Régularisation reprise enregistrée' : 'Régularisation reprise remplacée'} : ${String(operation.objet)}.`,
      remplaceReprise === null ? 'La régularisation reprise n’a pas été enregistrée' : 'La régularisation reprise n’a pas été remplacée',
      apres,
    )
  }

  async function retirerLaReprise(o: OperationInventaire, apres: () => void) {
    if (ecritureEnCours.current) return
    if (!window.confirm(confirmationDuRetrait(o))) return
    await agir(() => appelerRetirerLOperation(o.id, o.version), `Retiré : ${o.objet}.`, 'La régularisation reprise n’a pas été retirée', apres)
  }

  async function retirer(o: OperationInventaire) {
    if (ecritureEnCours.current) return
    if (!window.confirm(confirmationDuRetrait(o))) return
    await agir(
      () => appelerRetirerLOperation(o.id, o.version),
      `Retiré : ${o.objet}.`,
      o.nature === 'provision' ? 'L’évaluation n’a pas été retirée' : 'La régularisation n’a pas été retirée',
      () => { if (remplace?.id === o.id) remettreLeFormulaire() },
    )
  }

  async function ouvrirLaProvision() {
    if (ecritureEnCours.current || verdictDeLaProvisionSaisie === null || verdictDeLaProvisionSaisie.etat !== 'permis') return
    if (!window.confirm(verdictDeLaProvisionSaisie.confirmation)) return
    const { provision: laProvision, versionLue } = verdictDeLaProvisionSaisie
    await agir(
      () => appelerEnregistrerLaProvision(laProvision, versionLue),
      `${remplaceProvision === null ? 'Provision ouverte' : 'Provision remplacée'} : ${provision.objet.trim()}.`,
      remplaceProvision === null ? 'La provision n’a pas été ouverte' : 'La provision n’a pas été remplacée',
      () => remettreLaProvision(),
    )
  }

  function remettreLaProvision() {
    setSaisieProvision((p) => formulaireDeProvisionVide(p.genre, {}))
    setCompteProv(null)
    setRemplaceProvision(null)
  }

  function preparerLeRemplacementDeLaProvision(p: Provision) {
    if (ecritureEnCours.current) return
    setRemplaceProvision(p)
    setMessage(null)
    const f = formulaireDeLaProvision(p)
    setSaisieProvision(f)
    setCompteProv(f.compte)
  }

  async function retirerLaProvision(p: Provision) {
    if (ecritureEnCours.current) return
    if (!window.confirm(confirmationDuRetraitDeLaProvision(p))) return
    await agir(
      () => appelerRetirerLaProvision(p.id, p.version), `Provision retirée : ${p.objet}.`, 'La provision n’a pas été retirée',
      () => { if (remplaceProvision?.id === p.id) remettreLaProvision() },
    )
  }

  async function evaluer(p: Provision) {
    if (ecritureEnCours.current || donnees === null || ctx === null) return
    const v = verdictDeLEvaluation(p, cibles[p.id] ?? '', ctx, donnees)
    if (v.etat !== 'permis') return
    if (!window.confirm(v.confirmation)) return
    const { evaluation, ecritures, versionLue } = v.appel
    await agir(
      () => appelerEvaluer(evaluation, ecritures, versionLue),
      `Provision évaluée : ${p.objet}.`,
      'La provision n’a pas été évaluée',
      () => setCibles((c) => ({ ...c, [p.id]: '' })),
    )
  }

  async function declarer() {
    if (ecritureEnCours.current || donnees === null || ctx === null) return
    if (refusDeLaDeclarationALEcran(ctx, donnees) !== null) return
    const nbRegularisations = regularisationsDeLExercice(donnees.operations, ctx.exercice).length
    const nbProvisions = provisionsDeLExercice(donnees.provisions, ctx.exercice).length
    if (!window.confirm(confirmationDeLaDeclaration(ctx.exercice, nbRegularisations, nbProvisions))) return
    await agir(() => appelerDeclarer(ctx.exercice), `Inventaire de l’exercice ${ctx.exercice} déclaré.`, 'L’inventaire n’a pas été déclaré')
  }

  async function retirerLaDeclaration() {
    if (ecritureEnCours.current || donnees === null || ctx === null) return
    const declaration = declarationEnVigueur(donnees.declarations, ctx.exercice)
    if (declaration === null || refusDuRetraitDeLaDeclarationALEcran(declaration, ctx) !== null) return
    if (!window.confirm(confirmationDuRetraitDeLaDeclaration(ctx.exercice))) return
    await agir(
      () => appelerRetirerLaDeclaration(declaration.id), `Déclaration retirée pour l’exercice ${ctx.exercice}.`, 'La déclaration n’a pas été retirée',
    )
  }

  // L'état d'inventaire se tire de ce qui est lu, sous son verrou : un clic, un fichier, rien d'écrit.
  async function tirerLEtat(format: 'pdf' | 'csv') {
    if (tirageEnCours.current || donnees === null || exercice === null) return
    tirageEnCours.current = true
    setTirage(true)
    setMessage(null)
    try {
      const etat = etatDInventaire(donnees, exercice, dossierNom)
      if (format === 'csv') {
        telechargerTexte(nomDuFichierDeLEtat(etat, 'csv'), csvDeLEtat(etat))
      } else {
        const resultat = telechargerUnPdf(await pdfDeLEtat(etat), nomDuFichierDeLEtat(etat, 'pdf'))
        if (!resultat.ok) setMessage({ genre: 'erreur', texte: resultat.message })
      }
    } catch (e) {
      setMessage({ genre: 'erreur', texte: `L’état n’a pas pu être tiré : ${messageErreur(e, 'raison inconnue')}` })
    } finally {
      tirageEnCours.current = false
      setTirage(false)
    }
  }

  // ── Ce qui s'affiche ─────────────────────────────────────────────────────────

  if (lecture === null || lecture.dossierId !== dossierId) return <p className="muted">Chargement…</p>

  if (lecture.etat === 'absente') {
    return <p className="muted">L’inventaire n’est pas encore en base : ses migrations attendent leur application.</p>
  }

  if (lecture.etat === 'incomplete' || donnees === null) {
    return (
      <BandeauLecturePartielle
        quoi="L’inventaire du dossier"
        accord="lu"
        motif={lecture.etat === 'incomplete' ? lecture.motif : 'lecture incomplète'}
        consequence="Aucune régularisation ni provision ne s’affiche, et rien ne s’écrit d’ici : recharge la page."
      />
    )
  }

  if (ctx === null || exercice === null) {
    return (
      <p className="muted">
        L’inventaire se passe exercice par exercice : choisis un exercice dans le sélecteur de l’en-tête. L’écran n’en choisit pas à ta place.
      </p>
    )
  }

  const regularisations = regularisationsDeLExercice(donnees.operations, exercice)
  const provisions = provisionsDeLExercice(donnees.provisions, exercice)
  const declaration = declarationEnVigueur(donnees.declarations, exercice)
  const refusDeclarer = refusDeLaDeclarationALEcran(ctx, donnees)
  const refusRetirerLaDeclaration = declaration === null ? null : refusDuRetraitDeLaDeclarationALEcran(declaration, ctx)
  const prorata = formulaire.nature === 'cca' || formulaire.nature === 'pca' ? propositionDuProrata(formulaire, ctx) : null
  const avecTva = natureAvecTvaDAttente(formulaire.nature, assujettiTva)
  // La part reprise se juge sur l'exercice d'ouverture de la provision : celui qu'un remplacement garde.
  const premierExerciceDeLaProvision = donnees.premierExercice === (remplaceProvision?.ouverte_en ?? exercice)
  // Ce qui se propose à chaque formulaire, selon ce que la base acceptera ; vide tant que les pièces ne sont pas lues.
  const optionsDeLaRegularisation = justificatifs === null ? [] : optionsDeCitation({ pieces: piecesCitablesParUneRegularisation(justificatifs), factures: [] })
  const optionsDeLaProvision = justificatifs === null ? [] : optionsDeCitation(citablesParUneProvision(provision.genre, justificatifs))
  const pieceDeLaRegularisation: Citation | null = formulaire.pieceCitee === null ? null : { genre: 'piece', id: formulaire.pieceCitee }

  return (
    <>
      <p className="muted" style={{ marginTop: -8, marginBottom: 20 }}>
        L’inventaire de l’exercice {exercice} : les régularisations que la clôture impose (constatées d’avance, factures non parvenues
        ou à établir, charges à payer, produits à recevoir) et les provisions. Rien n’est deviné : chaque ligne est ta décision, avec
        ses montants et son objet — qui part au FEC. Chaque régularisation s’écrit au 31 décembre, au journal des opérations diverses,
        avec son extourne au 1er janvier suivant ; une provision s’écrit par différence et ne s’extourne pas. L’exercice se choisit
        dans le sélecteur de l’en-tête.
      </p>

      {message && (
        <p className={message.genre === 'erreur' ? 'error-text' : 'muted'} role={message.genre === 'erreur' ? 'alert' : 'status'}>
          {message.texte}
        </p>
      )}

      <div className="card" style={{ marginBottom: 20 }}>
        <strong>Inventaire de l’exercice {exercice}</strong>
        {declaration === null ? (
          <p className="muted" style={{ margin: '6px 0 8px' }}>
            Non déclaré. La validation de l’exercice l’attend, même sans aucune régularisation : le déclarer dit que tu as regardé.
          </p>
        ) : (
          <p className="muted" style={{ margin: '6px 0 8px' }}>
            Déclaré fait le {formatDate(dateAParis(declaration.declare_le))}. Il se retire tant que l’exercice n’est pas validé.
          </p>
        )}
        <div className="fiche-mouvement-boutons" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          {declaration === null ? (
            <button
              type="button" className="btn btn-primary btn-sm" disabled={enCours || refusDeclarer !== null}
              title={refusDeclarer ?? undefined} onClick={() => void declarer()}
            >
              Déclarer l’inventaire fait
            </button>
          ) : (
            <button
              type="button" className="btn btn-outline btn-sm" disabled={enCours || refusRetirerLaDeclaration !== null}
              title={refusRetirerLaDeclaration ?? undefined} onClick={() => void retirerLaDeclaration()}
            >
              Retirer la déclaration
            </button>
          )}
          {declaration === null && refusDeclarer !== null && <span className="muted">{refusDeclarer}</span>}
          {declaration !== null && refusRetirerLaDeclaration !== null && <span className="muted">{refusRetirerLaDeclaration}</span>}
        </div>
      </div>

      {/* Un vrai formulaire : « Entrée » dans un champ l'envoie, et son nom le distingue des gestes de la liste. */}
      <form
        className="card" style={{ marginBottom: 20 }} aria-label="Saisie d’une régularisation"
        onSubmit={(e) => { e.preventDefault(); void enregistrer() }}
      >
        <strong>{remplace === null ? 'Saisir une régularisation' : `Remplacer « ${remplace.objet} »`}</strong>
        <div className="field-row aligne-bas" style={{ marginTop: 10 }}>
          <div className="field">
            <label htmlFor="inv-nature">Nature</label>
            <select id="inv-nature" value={formulaire.nature} disabled={remplace !== null} onChange={(e) => changerLaNature(e.target.value as NatureAExtourner)}>
              {NATURES_SAISIES.map((n) => <option key={n} value={n}>{LIBELLES_DES_NATURES[n]}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="inv-resultat">{formulaire.nature === 'pca' || formulaire.nature === 'fae' || formulaire.nature === 'produit_a_recevoir' ? 'Compte de produit (classe 7)' : 'Compte de charge (classe 6)'}</label>
            <input id="inv-resultat" type="text" inputMode="numeric" autoComplete="off" placeholder="ex. 616000" value={formulaire.compteResultat} onChange={(e) => champ('compteResultat', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="inv-regul">Compte de régularisation</label>
            <input id="inv-regul" type="text" inputMode="numeric" autoComplete="off" value={formulaire.compteRegularisation} onChange={(e) => champ('compteRegularisation', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="inv-montant">{assujettiTva ? 'Montant hors taxes' : 'Montant toutes taxes comprises'}</label>
            <input id="inv-montant" type="text" inputMode="decimal" autoComplete="off" placeholder="ex. 1 200,00" value={formulaire.montant} onChange={(e) => champ('montant', e.target.value)} />
          </div>
          {avecTva && (
            <div className="field">
              <label htmlFor="inv-tva">TVA d’attente</label>
              <input id="inv-tva" type="text" inputMode="decimal" autoComplete="off" placeholder="ex. 240,00" value={formulaire.tva} onChange={(e) => champ('tva', e.target.value)} />
            </div>
          )}
        </div>
        <p className="muted" style={{ margin: '0 0 8px' }}>{COMPTE_EN_PLAN[formulaire.nature]}</p>
        <div className="field-row aligne-bas">
          <div className="field">
            <label htmlFor="inv-objet">Objet (il part au FEC, dans le libellé de l’écriture)</label>
            <input id="inv-objet" type="text" autoComplete="off" maxLength={200} placeholder="ex. Assurance du local, 2e semestre" value={formulaire.objet} onChange={(e) => champ('objet', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="inv-debut">Période couverte, du</label>
            <input id="inv-debut" type="date" value={formulaire.periodeDebut} onChange={(e) => champ('periodeDebut', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="inv-fin">au</label>
            <input id="inv-fin" type="date" value={formulaire.periodeFin} onChange={(e) => champ('periodeFin', e.target.value)} />
          </div>
          {(formulaire.nature === 'cca' || formulaire.nature === 'pca') && (
            <div className="field">
              <label htmlFor="inv-piece">Montant de la pièce pour toute la période</label>
              <input id="inv-piece" type="text" inputMode="decimal" autoComplete="off" placeholder="ex. 2 400,00" value={formulaire.montantDeLaPiece} onChange={(e) => champ('montantDeLaPiece', e.target.value)} />
            </div>
          )}
        </div>
        {prorata !== null && (
          prorata.etat === 'proposee' ? (
            <p className="muted" style={{ margin: '0 0 8px' }}>
              {prorata.phrase}{' '}
              <button type="button" className="btn btn-outline btn-sm" disabled={enCours} onClick={() => champ('montant', texteDesCentimes(prorata.centimes))}>
                Reprendre ce montant
              </button>
              {' '}Le montant écrit reste celui que tu confirmes.
            </p>
          ) : (
            <p className="error-text" role="alert">{prorata.message}</p>
          )
        )}
        <ChoixDuJustificatif
          id="inv-justificatif" lecture={lectureDesJustificatifsDuDossier} options={optionsDeLaRegularisation}
          citee={pieceDeLaRegularisation} optionCitee={optionCitee(pieceDeLaRegularisation, justificatifs)} quoi="une pièce"
          desactive={enCours} onChoisir={(c) => champ('pieceCitee', c === null ? null : c.id)}
        />
        {verdict !== null && verdict.etat === 'refuse' && formulaire.objet.trim() !== '' && (
          <ul className="error-text" role="alert" style={{ margin: '0 0 8px', paddingLeft: 18 }}>
            {verdict.refus.map((r) => <li key={r}>{r}</li>)}
          </ul>
        )}
        <div className="fiche-mouvement-boutons" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <button
            type="submit" className="btn btn-primary btn-sm"
            disabled={enCours || verdict === null || verdict.etat !== 'permis'}
            title={verdict !== null && verdict.etat === 'refuse' ? verdict.refus[0] : undefined}
          >
            {enCours ? 'Écriture…' : remplace === null ? 'Enregistrer' : 'Remplacer'}
          </button>
          {remplace !== null && (
            <button type="button" className="btn btn-outline btn-sm" disabled={enCours} onClick={() => remettreLeFormulaire()}>
              Annuler le remplacement
            </button>
          )}
        </div>
      </form>

      <div className="card table-scroll" style={{ padding: 0, marginBottom: 20 }}>
        {regularisations.length === 0 ? (
          <div className="empty-state"><p>Aucune régularisation saisie sur l’exercice {exercice}.</p></div>
        ) : (
          <div className="tableau-adaptable">
            <table className="table-empilable-etroite table-empilable">
              <caption className="muted" style={{ textAlign: 'left', padding: '10px 12px' }}>Régularisations de l’exercice {exercice}</caption>
              <thead>
                <tr><th>Nature</th><th>Objet</th><th>Comptes</th><th>Montant</th><th>Période</th><th>Écritures</th><th></th></tr>
              </thead>
              <tbody>
                {regularisations.map((o) => {
                  const refusRetrait = refusDuRetraitDeLOperation(o, ctx, donnees.operations)
                  return (
                    <tr key={o.id}>
                      <td data-libelle="Nature">{LIBELLES_DES_NATURES[o.nature]}</td>
                      <td data-libelle="Objet">
                        {o.objet}
                        <CiteeDansLaListe citation={o.piece_citee_id === null ? null : { genre: 'piece', id: o.piece_citee_id }} justificatifs={justificatifs} />
                      </td>
                      <td data-libelle="Comptes">{o.compte_resultat} / {o.compte_regularisation}</td>
                      <td data-libelle="Montant">
                        {euros(o.montant_centimes)}
                        {o.tva_centimes > 0 && <span className="muted"> + {euros(o.tva_centimes)} de TVA d’attente</span>}
                      </td>
                      <td data-libelle="Période">
                        {o.periode_debut !== null && o.periode_fin !== null ? `${formatDate(o.periode_debut)} → ${formatDate(o.periode_fin)}` : '—'}
                      </td>
                      <td data-libelle="Écritures">
                        {ecrituresAJour(o, donnees)
                          ? <span className="badge badge-neutral">À jour</span>
                          : <span className="badge badge-neutral" title="Les écritures ne sont plus celles que la régularisation commande : l’enregistrer de nouveau avant la validation.">À recomposer</span>}
                      </td>
                      <td className="td-boutons">
                        <button type="button" className="btn btn-outline btn-sm" disabled={enCours || refusRetrait !== null} title={refusRetrait ?? undefined} onClick={() => preparerLeRemplacement(o)}>
                          Remplacer
                        </button>
                        <button type="button" className="btn btn-outline btn-sm" disabled={enCours || refusRetrait !== null} title={refusRetrait ?? undefined} onClick={() => void retirer(o)}>
                          Retirer
                        </button>
                        {refusRetrait !== null && <span className="muted">{refusRetrait}</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {donnees.premierExercice === exercice && (
        <RegularisationsReprises
          exercice={exercice} ctx={ctx} donnees={donnees} balance={lectureDeLaBalanceDuDossier}
          lectureDesJustificatifs={lectureDesJustificatifsDuDossier} justificatifs={justificatifs} enCours={enCours}
          onEnregistrer={enregistrerLaReprise} onRetirer={retirerLaReprise}
        />
      )}

      <form
        className="card" style={{ marginBottom: 20 }} aria-label="Ouverture d’une provision"
        onSubmit={(e) => { e.preventDefault(); void ouvrirLaProvision() }}
      >
        <strong>{remplaceProvision === null ? 'Ouvrir une provision' : `Remplacer la provision « ${remplaceProvision.objet} » (ouverte en ${remplaceProvision.ouverte_en})`}</strong>
        <p className="muted" style={{ margin: '6px 0 0' }}>
          Une provision pour risques (litige) ou la dépréciation d’une créance, suivie d’un exercice à l’autre : elle s’évalue chaque
          31 décembre, la dotation ou la reprise se calcule par différence avec l’exercice précédent.
        </p>
        <div className="field-row aligne-bas" style={{ marginTop: 10 }}>
          <div className="field">
            <label htmlFor="prov-genre">Genre</label>
            <select
              id="prov-genre" value={provision.genre}
              onChange={(e) => { setSaisieProvision((p) => ({ ...p, genre: e.target.value as GenreDeProvision })); setCompteProv(null) }}
            >
              {GENRES_DE_PROVISION.map((g) => <option key={g} value={g}>{LIBELLES_DES_GENRES[g]}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="prov-compte">Compte de la provision</label>
            <input id="prov-compte" type="text" inputMode="numeric" autoComplete="off" value={provision.compte} onChange={(e) => setCompteProv(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="prov-objet">Objet (il part au FEC)</label>
            <input id="prov-objet" type="text" autoComplete="off" maxLength={200} placeholder="ex. Litige avec un fournisseur" value={provision.objet} onChange={(e) => setSaisieProvision((p) => ({ ...p, objet: e.target.value }))} />
          </div>
          {premierExerciceDeLaProvision && (
            <div className="field">
              <label htmlFor="prov-reprise">Part du solde repris de son compte</label>
              <input id="prov-reprise" type="text" inputMode="decimal" autoComplete="off" placeholder="vide : née ici" value={provision.reprise} onChange={(e) => setSaisieProvision((p) => ({ ...p, reprise: e.target.value }))} />
            </div>
          )}
        </div>
        <ChoixDuJustificatif
          id="prov-justificatif" lecture={lectureDesJustificatifsDuDossier} options={optionsDeLaProvision}
          citee={provision.citation} optionCitee={optionCitee(provision.citation, justificatifs)}
          quoi={provision.genre === 'risque' ? 'une pièce' : 'une facture ou une pièce de vente'}
          desactive={enCours} onChoisir={(c) => setSaisieProvision((p) => ({ ...p, citation: c }))}
        />
        {verdictDeLaProvisionSaisie !== null && verdictDeLaProvisionSaisie.etat === 'refuse' && (
          <ul className="error-text" role="alert" style={{ margin: '0 0 8px', paddingLeft: 18 }}>
            {verdictDeLaProvisionSaisie.refus.map((r) => <li key={r}>{r}</li>)}
          </ul>
        )}
        <div className="fiche-mouvement-boutons" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <button
            type="submit" className="btn btn-primary btn-sm"
            disabled={enCours || verdictDeLaProvisionSaisie === null || verdictDeLaProvisionSaisie.etat !== 'permis'}
          >
            {remplaceProvision === null ? 'Ouvrir la provision' : 'Remplacer la provision'}
          </button>
          {remplaceProvision !== null && (
            <button type="button" className="btn btn-outline btn-sm" disabled={enCours} onClick={() => remettreLaProvision()}>
              Annuler le remplacement de la provision
            </button>
          )}
        </div>
      </form>

      <div className="card table-scroll" style={{ padding: 0, marginBottom: 20 }}>
        {provisions.length === 0 ? (
          <div className="empty-state"><p>Aucune provision ouverte à l’exercice {exercice}.</p></div>
        ) : (
          <div className="tableau-adaptable">
            <table className="table-empilable-etroite table-empilable">
              <caption className="muted" style={{ textAlign: 'left', padding: '10px 12px' }}>Provisions au 31/12/{exercice}</caption>
              <thead>
                <tr><th>Provision</th><th>Compte</th><th>Évaluation au 31/12/{exercice}</th><th></th></tr>
              </thead>
              <tbody>
                {provisions.map((p) => {
                  const evaluation = evaluationDeLExercice(p, donnees.operations, exercice)
                  const saisie = cibles[p.id] ?? ''
                  const v = saisie.trim() === '' ? null : verdictDeLEvaluation(p, saisie, ctx, donnees)
                  const refusRetirerLaProvision = refusDuRetraitDeLaProvision(p, ctx, donnees.operations)
                  const refusRetirerLEvaluation = evaluation === null ? null : refusDuRetraitDeLOperation(evaluation, ctx, donnees.operations)
                  return (
                    <tr key={p.id}>
                      <td data-libelle="Provision">
                        {LIBELLES_DES_GENRES[p.genre]} — {p.objet}
                        <span className="muted"> (ouverte en {p.ouverte_en})</span>
                        <CiteeDansLaListe
                          citation={p.facture_id != null ? { genre: 'facture', id: p.facture_id } : p.piece_citee_id != null ? { genre: 'piece', id: p.piece_citee_id } : null}
                          justificatifs={justificatifs}
                        />
                      </td>
                      <td data-libelle="Compte">{p.compte_provision}</td>
                      <td data-libelle="Évaluation">
                        {evaluation !== null && (
                          <div>
                            Évaluée à {euros(evaluation.montant_centimes)}{' '}
                            {ecrituresAJour(evaluation, donnees)
                              ? <span className="badge badge-neutral">À jour</span>
                              : <span className="badge badge-neutral">À recomposer</span>}
                          </div>
                        )}
                        <input
                          type="text" inputMode="decimal" autoComplete="off" placeholder="Cible, ex. 5 000,00" aria-label={`Cible de « ${p.objet} » au 31/12/${exercice}`}
                          value={saisie} onChange={(e) => setCibles((c) => ({ ...c, [p.id]: e.target.value }))}
                        />
                        {v !== null && v.etat === 'permis' && (
                          <p className="muted" style={{ margin: '4px 0 0' }}>
                            {euros(v.precedente)} au 31/12/{exercice - 1} : {v.ecart === 0 ? 'aucune écriture' : `${v.ecart > 0 ? 'dotation' : 'reprise'} de ${euros(Math.abs(v.ecart))}`}.
                          </p>
                        )}
                        {v !== null && v.etat === 'refuse' && (
                          <ul className="error-text" role="alert" style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                            {v.refus.map((r) => <li key={r}>{r}</li>)}
                          </ul>
                        )}
                      </td>
                      <td className="td-boutons">
                        <button type="button" className="btn btn-primary btn-sm" disabled={enCours || v === null || v.etat !== 'permis'} onClick={() => void evaluer(p)}>
                          {evaluation === null ? 'Évaluer' : 'Remplacer l’évaluation'}
                        </button>
                        {evaluation !== null && (
                          <button type="button" className="btn btn-outline btn-sm" disabled={enCours || refusRetirerLEvaluation !== null} title={refusRetirerLEvaluation ?? undefined} onClick={() => void retirer(evaluation)}>
                            Retirer l’évaluation
                          </button>
                        )}
                        {/* Remplacer et retirer ont les mêmes refus : le mode, le gel de son exercice, une évaluation qui la fige. */}
                        <button type="button" className="btn btn-outline btn-sm" disabled={enCours || refusRetirerLaProvision !== null} title={refusRetirerLaProvision ?? undefined} onClick={() => preparerLeRemplacementDeLaProvision(p)}>
                          Remplacer
                        </button>
                        <button type="button" className="btn btn-outline btn-sm" disabled={enCours || refusRetirerLaProvision !== null} title={refusRetirerLaProvision ?? undefined} onClick={() => void retirerLaProvision(p)}>
                          Retirer la provision
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <strong>L’état d’inventaire de l’exercice {exercice}</strong>
        <p className="muted" style={{ margin: '6px 0 8px' }}>
          La pièce justificative des écritures d’inventaire (« Inventaire {exercice} ») : une ligne par régularisation ou provision,
          son calcul, sa justification et sa date de saisie. Il se tire de ce qui est enregistré ci-dessus, et ne valide rien.
        </p>
        <div className="fiche-mouvement-boutons" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <button type="button" className="btn btn-outline btn-sm" disabled={tirage} onClick={() => void tirerLEtat('pdf')}>
            Télécharger l’état (PDF)
          </button>
          <button type="button" className="btn btn-outline btn-sm" disabled={tirage} onClick={() => void tirerLEtat('csv')}>
            Télécharger l’état (CSV)
          </button>
        </div>
      </div>
    </>
  )
}

/** Ce qu'une ligne de la liste cite : le titre lu (un nom de fichier sous `.nom-fichier`), ou, les pièces pas lues, qu'elle en cite. */
function CiteeDansLaListe({ citation, justificatifs }: { citation: Citation | null; justificatifs: JustificatifsDuDossier | null }) {
  if (citation === null) return null
  const o = optionCitee(citation, justificatifs)
  return (
    <div className="muted" style={{ fontSize: '0.85rem' }}>
      {o === null
        ? (citation.genre === 'facture' ? 'Cite une facture du dossier.' : 'Cite une pièce du dossier.')
        : <>{citation.genre === 'facture' ? 'Cite la ' : 'Cite '}{o.fichier ? <span className="nom-fichier">{o.titre}</span> : o.titre.replace(/^Facture/, 'facture')}</>}
    </div>
  )
}
