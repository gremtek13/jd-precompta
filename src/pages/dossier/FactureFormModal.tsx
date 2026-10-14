import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { calculerLigne, calculerTotaux, enregistrerFacture, lignesSaisies, mentionsLegalesParDefaut } from '../../lib/factures'
import { aujourdHuiSql, formatMoney, formaterPrixUnitaire } from '../../lib/format'
import type { Article, ArticleExoneration, FactureEmise, FactureLigne, StatutTva } from '../../lib/types'
import { messageErreur } from '../../lib/messageErreur'
import { LIBELLE_NOTES_FACTURE, LIBELLE_NOTES_FACTURE_CLIENT } from '../../lib/droitsAcces'
import { pourLEspace, pourLEspaceSiTexte } from '../../lib/espaceVentes'
import { MENTION_FRANCHISE, exonerationDe, manqueMentionTva, mentionTva, refusTauxPositif } from '../../lib/statutTva'
import { ARTICLES_EXPORTES, nomDansUnRefus } from '../../lib/articles'
import { lireLesArticles, type LectureDesArticles } from '../../lib/articlesLecture'
import { enregistrerArticle } from '../../lib/articlesEcriture'
import { refusDeLaSaisie, saisieEnvoyee, type SaisieArticle } from '../../lib/articlesVue'
import {
  avecProvenance, ceQueLeChoixRemplace, choixDArticle, enumeration, gestePrixDeLArticle, peutEnregistrerCommeArticle, saisieDeLaLigne,
  garderProvenance, type Provenance,
} from '../../lib/articlesFacture'
import BandeauLecturePartielle from '../../components/BandeauLecturePartielle'
import ArticleChoixModal from './ArticleChoixModal'
import ArticleSaisieModal from './ArticleSaisieModal'
import ConfirmationArticle from './ConfirmationArticle'
import {
  apercuDeTransmission, livraisonOuverte, mentionsAEnregistrer, refusDesMentions, saisieDesMentions, sirenDuSiret, sirenOuvert,
  siretAEnregistrer, versEntreprise, type ApercuTransmission, type SaisieMentions,
} from '../../lib/mentionsFacture'

interface LigneEdit {
  id?: string // absent = ligne pas encore enregistrée
  // L'identité de la ligne DANS CE FORMULAIRE, stable tant qu'elle existe : c'est la clé de sa provenance (l'article qui l'a
  // remplie) et celle de son rendu. Ni l'indice, que le retrait d'une autre ligne déplace, ni `id`, que les lignes neuves n'ont pas.
  cle: string
  designation: string
  quantite: string
  prix_unitaire_ht: string
  taux_tva: string
}

// La lecture des articles, gardée avec le dossier pour lequel elle a été faite : lue, ou ratée avec son motif.
type LectureArticles = { cle: string; lu: LectureDesArticles } | { cle: string; echec: string }

// La fenêtre d'article ouverte, une seule à la fois : le choix, la saisie d'un article neuf tiré d'une ligne, et les deux
// confirmations (remplacer une ligne déjà saisie, mettre l'article à ce prix).
type FenetreArticle =
  | { genre: 'choix'; cle: string }
  | { genre: 'saisie'; cle: string; depart: SaisieArticle }
  | { genre: 'remplacer'; cle: string; article: Article; remplace: string[] }
  | { genre: 'prix'; cle: string }

const CONSEQUENCE_ARTICLES_PARTIELS = 'Aucun article ne peut donc être choisi ni enregistré d’ici : une liste tronquée dirait « libre » '
  + 'une référence déjà prise.'

// Le taux d'une ligne neuve suit le statut de TVA du dossier : 20 % pour un redevable, qui facture la TVA, 0 % pour
// les autres. Une ligne d'un redevable à 0 % par défaut partait chez la plateforme avec le motif de la franchise.
function ligneVide(statut: StatutTva | null, cle: string): LigneEdit {
  return { cle, designation: '', quantite: '1', prix_unitaire_ht: '', taux_tva: statut === 'redevable' ? '20' : '0' }
}

// QUI RÉDIGE LA FACTURE (espace client, étape P4a) : le cabinet, qui peut aussi enregistrer l'adresse de l'émetteur comme
// celle du dossier, ou le client « Ventes », qui ne le peut pas — l'adresse du dossier, c'est le cabinet qui la renseigne.
// Le reste est le même formulaire, par la même fonction (`enregistrer_facture`, ouverte au client par P2).
type QuiRedige =
  | { espace: 'cabinet'; onAdresseUpdated: (adresse: string) => void }
  | { espace: 'client' }

type Props = QuiRedige & {
  dossierId: string
  dossierNom: string
  dossierSiret: string | null
  dossierAdresse: string | null
  // Le statut de TVA du dossier (lib/statutTva.ts), qui décide de la mention proposée et des taux admis.
  statutTva: StatutTva | null
  articleExoneration: ArticleExoneration | null
  // Un dossier en franchise ou exonéré qui a un numéro de TVA (la case de l'onglet TVA) : ses factures sans TVA partent.
  numeroTvaAttribue: boolean
  // L'option du dossier pour le paiement de la TVA d'après les débits : la validation la fige sur la facture.
  tvaSurDebits: boolean
  facture: FactureEmise | null // null = nouvelle facture ; jamais une facture déjà validée (voir FacturesTab)
  onClose: () => void
  onSaved: () => void
}

// Formulaire de brouillon de facture — jamais ouvert sur une facture déjà validée (voir FacturesTab,
// qui ouvre FactureApercu à la place dans ce cas) : toute la logique ici suppose qu'on peut encore
// tout modifier librement. "Valider" attribue le numéro définitif (voir lib/factures.ts) et ferme la
// possibilité de reéditer — geste volontairement séparé d'un simple enregistrement de brouillon.
export default function FactureFormModal(props: Props) {
  const { dossierId, dossierNom, dossierSiret, dossierAdresse, statutTva, articleExoneration, numeroTvaAttribue, tvaSurDebits, facture, onClose, onSaved } = props
  const { espace } = props
  // Le geste du cabinet seul : retenir l'adresse de l'émetteur comme celle du dossier. Nul pour le client.
  const onAdresseUpdated = props.espace === 'cabinet' ? props.onAdresseUpdated : null
  const [tiersNom, setTiersNom] = useState(facture?.tiers_nom ?? '')
  const [tiersAdresse, setTiersAdresse] = useState(facture?.tiers_adresse ?? '')
  const [tiersSiret, setTiersSiret] = useState(facture?.tiers_siret ?? '')
  const [dateEmission, setDateEmission] = useState(facture?.date_emission ?? aujourdHuiSql())
  const [dateEcheance, setDateEcheance] = useState(facture?.date_echeance ?? '')
  const [notes, setNotes] = useState(facture?.notes ?? '')
  const [mentionsLegales, setMentionsLegales] = useState(facture?.mentions_legales ?? mentionsLegalesParDefaut(statutTva, articleExoneration))
  const [emetteurAdresse, setEmetteurAdresse] = useState(facture?.emetteur_adresse ?? dossierAdresse ?? '')
  const [enregistrerAdresseDossier, setEnregistrerAdresseDossier] = useState(false)
  // Les mentions de la facture électronique (lib/mentionsFacture.ts), reprises du brouillon.
  const [mentions, setMentions] = useState<SaisieMentions>(() => saisieDesMentions(facture))
  // Le compteur des clés de ligne : `l0` est celle de la première ligne.
  const compteurLignes = useRef(1)
  const nouvelleCle = () => `l${compteurLignes.current++}`
  const [lignes, setLignes] = useState<LigneEdit[]>([ligneVide(statutTva, 'l0')])
  const [chargementLignes, setChargementLignes] = useState(!!facture)
  // Non nul = on ne SAIT PAS ce que cette facture porte comme lignes. Voir l'effet ci-dessous :
  // ce n'est pas la même chose que « elle n'en a aucune », et le formulaire ne doit pas le confondre.
  const [lignesIllisibles, setLignesIllisibles] = useState<string | null>(null)
  const [saving, setSaving] = useState<'brouillon' | 'validation' | null>(null)
  const [error, setError] = useState<string | null>(null)
  // L'article qui a rempli chaque ligne (clé de la ligne → identifiant), EN MÉMOIRE seulement : rien ne s'enregistre avant A7.
  // Une facture rouverte n'en a sur aucune de ses lignes.
  const [provenanceBrute, setProvenance] = useState<Provenance>({})
  // Une ligne retirée perd sa provenance : celle qu'on LIT ne garde que les lignes qui existent, et la clé d'une ligne retirée ne revient jamais.
  const provenance = garderProvenance(provenanceBrute, lignes.map((l) => l.cle))
  // Les articles du dossier, lus EN ENTIER à l'ouverture et relus après chaque écriture ; gardés AVEC le dossier lu.
  const [lectureArticles, setLectureArticles] = useState<LectureArticles | null>(null)
  const dossierAffiche = useRef(dossierId)

  // UNE LECTURE REFUSÉE NE DOIT PAS PASSER POUR « CETTE FACTURE N'A AUCUNE LIGNE ».
  //
  // L'erreur était jetée et `data ?? []` rendait alors une ligne vide, c'est-à-dire exactement le
  // formulaire d'une facture neuve — avec un total à 0,00 € sous un en-tête qui, lui, porte de
  // vrais montants. Or `enregistrerFacture` REMPLACE le jeu de lignes : le seul geste que cet
  // écran propose alors (les retaper) détruit celles qu'on n'a pas su lire, et recalcule l'en-tête
  // sur ce qu'on vient d'inventer.
  //
  // On refuse donc d'ouvrir le formulaire plutôt que d'écraser ce qu'on n'a pas lu — même posture
  // que `packGenerator` sur une lecture partielle. Ce que ça n'attrape pas, et c'est dit plutôt que
  // laissé croire : un refus RLS rend zéro ligne SANS erreur (mesuré, voir lib/informationsDossier).
  useEffect(() => {
    if (!facture) return
    supabase.from('facture_lignes').select('*').eq('facture_id', facture.id).order('ordre').then(({ data, error: lectureError }) => {
      if (lectureError) {
        setLignesIllisibles(messageErreur(lectureError, "Les lignes de cette facture n'ont pas pu être lues."))
        setChargementLignes(false)
        return
      }
      const l = (data ?? []) as FactureLigne[]
      setLignes(l.length > 0
        ? l.map((x) => ({ id: x.id, cle: x.id, designation: x.designation, quantite: String(x.quantite), prix_unitaire_ht: String(x.prix_unitaire_ht), taux_tva: String(x.taux_tva) }))
        : [ligneVide(statutTva, nouvelleCle())])
      setChargementLignes(false)
    })
  }, [facture, statutTva])

  // Les articles : lus à l'ouverture, jamais avant que l'espace les ouvre (`ARTICLES_EXPORTES`). Une réponse arrivée après un
  // changement de dossier ne s'inscrit pas (`annule`).
  useEffect(() => {
    if (!ARTICLES_EXPORTES) return
    let annule = false
    dossierAffiche.current = dossierId
    lireLesArticles(dossierId).then(
      (lu) => { if (!annule) setLectureArticles({ cle: dossierId, lu }) },
      (e: unknown) => { if (!annule) setLectureArticles({ cle: dossierId, echec: messageErreur(e, 'les articles n’ont pas pu être lus') }) },
    )
    return () => { annule = true }
  }, [dossierId])

  function majLigne(index: number, patch: Partial<LigneEdit>) {
    setLignes((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)))
  }
  function ajouterLigne() {
    const cle = nouvelleCle()
    setLignes((prev) => [...prev, ligneVide(statutTva, cle)])
  }
  function retirerLigne(index: number) {
    setLignes((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev))
  }

  const lignesNumeriques = lignes.map((l) => ({
    designation: l.designation,
    quantite: parseFloat(l.quantite) || 0,
    prix_unitaire_ht: parseFloat(l.prix_unitaire_ht) || 0,
    taux_tva: parseFloat(l.taux_tva) || 0,
  }))
  // Une ligne sans désignation ou sans quantité positive ne part pas (lib/factures.ts:lignesSaisies). Les TOTAUX sont
  // donc ceux des lignes qui partent, et d'aucun autre jeu : la base stocke l'en-tête tel qu'il est envoyé, et un total
  // qui comptait une ligne écartée — une remise saisie en quantité négative, une ligne dont on a oublié la désignation —
  // faisait une facture dont l'en-tête contredit les lignes, à l'aperçu comme à la plateforme qui la reçoit.
  const { valides: lignesValides, ecartees: lignesEcartees } = lignesSaisies(lignesNumeriques)
  const totaux = calculerTotaux(lignesValides)

  // CE QUE LE STATUT DE TVA DU DOSSIER DIT DE CETTE FACTURE, avant le clic (lib/statutTva.ts).
  // Une ligne taxée sur un dossier qui ne facture pas de TVA la rend due du seul fait de l'avoir facturée (CGI,
  // art. 283, 3) : la validation se refuse — une facture validée ne se corrige que par un avoir. Le brouillon reste
  // enregistrable, pour le temps de changer le statut si c'est lui qui est en retard.
  const refusTaxe = lignesValides.map((l) => refusTauxPositif(statutTva, l.taux_tva)).find((r) => r != null) ?? null
  // La mention de TVA que la facture doit porter : celle du statut, ou — pour un redevable — celle de l'article de
  // son exonération dès qu'une ligne est à 0 %. Absente du texte (effacée, ou un brouillon d'avant), elle se propose.
  const ligneAZero = lignesValides.some((l) => l.taux_tva === 0)
  const mentionAttendue = statutTva === 'redevable'
    ? (ligneAZero ? exonerationDe(articleExoneration)?.mention ?? null : null)
    : mentionTva(statutTva, articleExoneration)
  const mentionAbsente = mentionAttendue != null && !mentionsLegales.includes(mentionAttendue) ? mentionAttendue : null
  // Un redevable sans article dont une ligne est à 0 % : on ne sait pas quelle exonération la justifie.
  const zeroSansArticle = statutTva === 'redevable' && ligneAZero && exonerationDe(articleExoneration) == null
  // La mention de la franchise sur un dossier qui n'y est pas : celle que l'application proposait à tout dossier non
  // assujetti, donc à un dossier de soins exonérés.
  const franchiseHorsStatut = statutTva !== 'franchise' && mentionsLegales.includes('293 B')
  const manqueMention = manqueMentionTva(statutTva, articleExoneration)

  function ajouterMention(mention: string) {
    setMentionsLegales((m) => (m.trim() ? `${mention}\n${m}` : mention))
  }

  // LES MENTIONS DE LA FACTURE ÉLECTRONIQUE (ligne 28.5, étape c4 ; lib/mentionsFacture.ts).
  function majMentions(patch: Partial<SaisieMentions>) {
    setMentions((m) => ({ ...m, ...patch }))
  }
  // Le SIREN qu'un SIRET porte s'applique sans attendre un clic, tant qu'on n'en a pas saisi un autre.
  function changerSiret(valeur: string) {
    const siren = sirenDuSiret(valeur)
    if (siren && (mentions.siren.trim() === '' || mentions.siren === sirenDuSiret(tiersSiret))) majMentions({ siren })
    setTiersSiret(valeur)
  }

  // L'en-tête tel qu'il s'enregistre, et tel que l'aperçu de la transmission le juge : un seul assemblage pour les deux.
  const entete = {
    tiers_nom: tiersNom.trim(),
    tiers_adresse: tiersAdresse.trim() || null,
    tiers_siret: siretAEnregistrer(tiersSiret),
    date_emission: dateEmission,
    date_echeance: dateEcheance || null,
    notes: notes.trim() || null,
    mentions_legales: mentionsLegales.trim() || null,
    emetteur_nom: dossierNom || null,
    emetteur_siret: dossierSiret || null,
    emetteur_adresse: emetteurAdresse.trim() || null,
    montant_ht: totaux.montant_ht,
    montant_tva: totaux.montant_tva,
    montant_ttc: totaux.montant_ttc,
    ...mentionsAEnregistrer(mentions),
  }
  // Ce que la base refuserait des mentions : ni le brouillon ni la validation ne partent, et l'écran dit pourquoi.
  const refusMentions = refusDesMentions(mentions, tiersSiret)
  // L'option pour les débits ne vise que des prestations de services (CGI, ann. II, art. 242 nonies A, I, 11° bis).
  const optionDebits = statutTva === 'redevable' && tvaSurDebits
  const debitsImprimes = optionDebits && (mentions.nature === 'services' || mentions.nature === 'mixte')
  // UNE FACTURE VALIDÉE NE SE CORRIGE PLUS QUE PAR UN AVOIR : ce qui l'empêcherait de partir par une plateforme agréée se
  // dit AVANT la validation, avec le jugement même des fonctions qui la transmettent. Pas tant que la base refuserait la
  // saisie : il y a d'abord cela à corriger, et le redire ici le dirait deux fois.
  const apercu: ApercuTransmission | null = refusMentions.length > 0 ? null : apercuDeTransmission({
    facture: { type: 'facture', ...entete },
    lignes: lignesValides,
    statutTva,
    articleExoneration,
    numeroTvaAttribue,
    optionDebits,
    aujourdHui: aujourdHuiSql(),
  })
  const nonTransmissible = apercu?.cas === 'a_completer' && versEntreprise(mentions.typeClient) ? apercu : null

  // Verrou en `useRef`, et POSÉ AVANT LE `try` : `saving` est un état React, donc `disabled={!!saving}`
  // ne prend effet qu'au rendu SUIVANT et laisse passer deux envois rapprochés (CLAUDE.md). Dans le
  // `try`, le `return` du deuxième sortirait par le `finally`, qui relâcherait le verrou du PREMIER,
  // encore en cours — il faut trois envois pour le voir, et deux suffisent à croire la version
  // fautive correcte.
  //
  // Le doublon ne coûte pas une ligne de trop. Sur une facture NEUVE, `p_facture_id` vaut `null` aux
  // deux appels : `enregistrer_facture` prend sa branche INSERT deux fois, et chacune consomme son
  // propre numéro de la suite annuelle. Ce sont DEUX factures validées, identiques, immuables — la
  // suppression n'est offerte que sur un brouillon, et la seule sortie légale est un avoir.
  // Sur un brouillon existant, la base rattrape (le `select … for update` sérialise, et le second
  // appel se fait refuser) ; c'est la création qui n'a aucun filet.
  //
  // ET LE FORMULAIRE EST LE PIRE DÉCLENCHEUR : « Enregistrer le brouillon » est un `type="submit"`,
  // donc deux « Entrée » rapprochés suffisent, geste plus banal que deux clics.
  const enregistrementEnCours = useRef(false)

  // ── UN ARTICLE DANS LA FACTURE (espace client, étape A2b ; lib/articlesFacture.ts, conception : HISTORIQUE.md, §A.1) ──────────
  // « Choisir un article » remplit la ligne (la désignation, la quantité 1, le prix et le taux du statut de TVA du jour) ; la
  // ligne reste LIBRE, et la changer n'écrit jamais rien dans l'article. Deux gestes à part, jamais faits en passant : « Mettre
  // l'article à ce prix » et « Enregistrer comme article », par `enregistrer_article` seule. Rien n'est offert avant la lecture
  // des articles, ni sur une lecture partielle ou refusée (l'unicité d'une référence ne se juge pas sur une liste tronquée).
  //
  // LA MENTION DE TVA : le formulaire la propose déjà (`mentionAbsente`, « Ajouter la mention », d'après le statut et les taux
  // des lignes — la même que `mention` de `choixDArticle`, confrontée par FactureFormModalArticles.test.tsx) ; le choix n'en ajoute
  // pas une seconde.
  const courante = lectureArticles?.cle === dossierId ? lectureArticles : null
  const articlesLus = courante != null && 'lu' in courante ? courante.lu : null
  const articlesEntiers: readonly Article[] | null = articlesLus?.complete ? articlesLus.lignes : null
  const articlesEnCours = articlesEntiers?.filter((a) => a.retire_le == null) ?? []

  const [fenetreArticle, setFenetreArticle] = useState<FenetreArticle | null>(null)
  const [articleOccupe, setArticleOccupe] = useState(false)
  const [erreurArticle, setErreurArticle] = useState<string | null>(null)
  const [messageArticle, setMessageArticle] = useState<string | null>(null)

  // Le verrou des gestes d'article, en `useRef` et POSÉ AVANT LE `try` : relâché dans le `finally`, APRÈS la relecture des
  // articles (un second clic pendant qu'elle court écrirait sur ce que la liste montrait avant), relue aussi sur un refus. Il
  // s'efface devant l'enregistrement de la facture, et l'enregistrement devant lui : aucun geste d'article pendant l'un, ni
  // l'inverse.
  const gesteArticleEnCours = useRef(false)

  async function relireArticles() {
    try {
      const lu = await lireLesArticles(dossierId)
      if (dossierAffiche.current === dossierId) setLectureArticles({ cle: dossierId, lu })
    } catch (e) {
      if (dossierAffiche.current === dossierId) {
        setLectureArticles({ cle: dossierId, echec: messageErreur(e, 'les articles n’ont pas pu être lus') })
      }
    }
  }

  async function sousVerrou<T>(repli: string, ecrire: () => Promise<T>, message: (ecrit: T) => string): Promise<T | null> {
    if (gesteArticleEnCours.current || enregistrementEnCours.current) return null
    gesteArticleEnCours.current = true
    setArticleOccupe(true)
    setErreurArticle(null)
    setMessageArticle(null)
    let resultat: T | null = null
    try {
      const ecrit = await ecrire()
      setMessageArticle(message(ecrit))
      resultat = ecrit
    } catch (e) {
      setErreurArticle(messageErreur(e, repli))
    } finally {
      await relireArticles()
      gesteArticleEnCours.current = false
      setArticleOccupe(false)
    }
    return resultat
  }

  // Aucun geste pendant l'enregistrement de la facture, ni pendant un geste d'article (le temps de sa relecture compris).
  const gesteBloque = articleOccupe || !!saving

  function ouvrirFenetre(fenetre: FenetreArticle) {
    setErreurArticle(null)
    setMessageArticle(null)
    setFenetreArticle(fenetre)
  }

  function appliquerChoix(cle: string, article: Article) {
    const { ligne } = choixDArticle(article, statutTva, articleExoneration)
    setLignes((prev) => prev.map((l) => (l.cle === cle ? { ...l, ...ligne } : l)))
    // Remplie par cet article, la ligne n'a plus la provenance qu'elle avait.
    setProvenance((p) => avecProvenance(p, cle, article.id))
  }

  // Une ligne déjà saisie ne se remplace qu'après une confirmation qui nomme ce qui sera remplacé (A2B-Q1).
  function choisir(cle: string, article: Article) {
    const ligne = lignes.find((l) => l.cle === cle)
    if (!ligne) { setFenetreArticle(null); return }
    const remplace = ceQueLeChoixRemplace(ligne, choixDArticle(article, statutTva, articleExoneration).ligne)
    if (remplace.length > 0) { setFenetreArticle({ genre: 'remplacer', cle, article, remplace }); return }
    appliquerChoix(cle, article)
    setFenetreArticle(null)
  }

  // « Mettre l'article à ce prix » d'une ligne : l'article de sa provenance TEL QUE LA LISTE LUE LE PORTE, et ce que le geste
  // enverrait (tous ses champs, le prix de la ligne seul changé) avec le refus que la base opposerait, dit avant le clic.
  function prixDeLaLigne(cle: string) {
    const ligne = lignes.find((l) => l.cle === cle)
    const idArticle = provenance[cle]
    if (!ligne || idArticle == null || articlesEntiers == null) return null
    const article = articlesEntiers.find((a) => a.id === idArticle) ?? null
    return { ligne, article, geste: gestePrixDeLArticle(dossierId, article, ligne.prix_unitaire_ht, articlesEntiers) }
  }

  async function mettreAuPrix(cle: string) {
    const lu = prixDeLaLigne(cle)
    // Seconde ceinture : le bouton est déjà grisé sous ce refus.
    if (lu == null || lu.geste.etat !== 'offert') return
    if (lu.geste.refus != null || lu.article == null) {
      setErreurArticle(lu.geste.refus)
      return
    }
    const { id } = lu.article
    const { saisie } = lu.geste
    const ecrit = await sousVerrou(
      'Le prix de l’article n’a pas pu être mis à jour.',
      () => enregistrerArticle(dossierId, id, saisieEnvoyee(saisie)),
      (a) => `Article « ${nomDansUnRefus(a.designation)} » : prix mis à jour.`,
    )
    if (ecrit) setFenetreArticle(null)
  }

  async function enregistrerCommeArticle(cle: string, saisie: SaisieArticle) {
    if (articlesEntiers == null) return
    // Seconde ceinture : le bouton est déjà grisé sous ce refus.
    const refus = refusDeLaSaisie(dossierId, { nouveau: true }, saisie, articlesEntiers)
    if (refus) {
      setErreurArticle(refus.message)
      return
    }
    const ecrit = await sousVerrou(
      'L’article n’a pas pu être enregistré.',
      () => enregistrerArticle(dossierId, null, saisieEnvoyee(saisie)),
      (a) => `Article « ${nomDansUnRefus(a.designation)} » enregistré.`,
    )
    if (ecrit) {
      // La ligne prend le nouvel article pour provenance : elle est désormais celle d'un article du catalogue.
      setProvenance((p) => avecProvenance(p, cle, ecrit.id))
      setFenetreArticle(null)
    }
  }

  // Ce que la ligne `i` offre : l'article de sa provenance, ses trois gestes, l'avertissement du choix.
  function articleDeLaLigne(l: LigneEdit, i: number) {
    if (!ARTICLES_EXPORTES || articlesEntiers == null) return null
    const lu = prixDeLaLigne(l.cle)
    const sansProvenanceConnue = provenance[l.cle] == null
    // L'avertissement du choix se dit tant que la ligne porte le taux que l'article lui a donné : un taux retouché à la main
    // n'est plus celui dont il parle.
    const apporte = lu?.article ? choixDArticle(lu.article, statutTva, articleExoneration) : null
    const avertissement = apporte?.avertissement != null && Number(l.taux_tva) === Number(apporte.ligne.taux_tva) ? apporte.avertissement : null
    return (
      <>
        {lu?.article && (
          <span className="muted" style={{ fontSize: '0.78rem' }}>
            Article : {lu.article.reference ? `${lu.article.reference} — ` : ''}{nomDansUnRefus(lu.article.designation)}
          </span>
        )}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {articlesEnCours.length > 0 && (
            <button
              type="button" className="btn btn-outline btn-sm" disabled={gesteBloque}
              aria-label={`Choisir un article, ligne ${i + 1}`} onClick={() => ouvrirFenetre({ genre: 'choix', cle: l.cle })}
            >
              Choisir un article
            </button>
          )}
          {lu?.geste.etat === 'offert' && (
            <button
              type="button" className="btn btn-outline btn-sm" disabled={gesteBloque || lu.geste.refus != null} title={lu.geste.refus ?? undefined}
              aria-label={`Mettre l’article à ce prix, ligne ${i + 1}`} onClick={() => ouvrirFenetre({ genre: 'prix', cle: l.cle })}
            >
              Mettre l’article à ce prix
            </button>
          )}
          {sansProvenanceConnue && peutEnregistrerCommeArticle(l) && (
            <button
              type="button" className="btn btn-outline btn-sm" disabled={gesteBloque}
              aria-label={`Enregistrer comme article, ligne ${i + 1}`}
              onClick={() => ouvrirFenetre({ genre: 'saisie', cle: l.cle, depart: saisieDeLaLigne(l, statutTva) })}
            >
              Enregistrer comme article
            </button>
          )}
        </div>
        {/* Le refus du geste se lit aussi sous la ligne : une infobulle ne se voit pas au doigt. */}
        {lu?.geste.etat === 'offert' && lu.geste.refus != null && (
          <span className="muted" style={{ fontSize: '0.78rem' }}>{lu.geste.refus}</span>
        )}
        {avertissement && <span className="alerte-tva" style={{ fontSize: '0.8rem' }}>{pourLEspace(espace, avertissement)}</span>}
      </>
    )
  }

  async function enregistrer(statutCible: 'brouillon' | 'validee') {
    if (!tiersNom.trim()) {
      setError('Le nom du client est obligatoire.')
      return
    }
    if (lignesValides.length === 0) {
      setError('Ajoute au moins une ligne avec une désignation et une quantité.')
      return
    }
    // Seconde ceinture : le bouton de validation est déjà grisé sur ce refus.
    if (statutCible === 'validee' && refusTaxe) {
      setError(refusTaxe)
      return
    }
    // Les boutons sont déjà grisés : la base refuserait la saisie, et son message ne dirait pas quel champ corriger.
    if (refusMentions.length > 0) {
      setError(refusMentions[0])
      return
    }
    if (enregistrementEnCours.current || gesteArticleEnCours.current) return
    // Une facture adressée à une entreprise ou à un organisme public, que rien ne pourrait plus transmettre une fois
    // validée : la validation se confirme, et la confirmation dit ce qu'on perd.
    if (statutCible === 'validee' && nonTransmissible) {
      const premier = pourLEspace(espace, nonTransmissible.refus[0] ?? 'régler la TVA, comme le formulaire le signale.')
      const n = nonTransmissible.refus.length + nonTransmissible.ailleurs
      const points = n === 1 ? 'un point à compléter :' : `${n} points à compléter, dont :`
      if (!window.confirm(`Validée ainsi, cette facture ne pourra pas partir par une plateforme agréée — ${points} ${premier}\n\n`
        + 'Une facture validée ne se corrige plus que par un avoir. La valider quand même ?')) return
    }
    enregistrementEnCours.current = true
    setSaving(statutCible === 'validee' ? 'validation' : 'brouillon')
    setError(null)
    try {
      // En-tête, remplacement complet des lignes et, le cas échéant, numéro et validation : un seul
      // appel, une seule transaction côté base (voir la migration enregistrer_facture_transactionnel).
      // C'étaient auparavant trois à cinq écritures indépendantes, dont chacune pouvait échouer seule
      // et laisser la facture à mi-chemin — lignes doublées, ou numéro consommé sans être posé sur la
      // facture, c'est-à-dire un trou dans une suite annuelle qui ne doit pas en avoir.
      //
      // Le remplacement complet des lignes reste préféré à un diff ligne à ligne : une facture en a
      // rarement plus de quelques-unes.
      await enregistrerFacture(dossierId, facture?.id ?? null, entete, lignesValides, statutCible === 'validee')

      // Hors transaction à dessein : mémoriser l'adresse sur le dossier est un confort, sans rapport
      // avec l'intégrité de la facture, et son échec ne doit pas la remettre en cause.
      if (onAdresseUpdated && enregistrerAdresseDossier && emetteurAdresse.trim()) {
        const { error: adresseError } = await supabase.from('dossiers').update({ adresse: emetteurAdresse.trim() }).eq('id', dossierId)
        if (!adresseError) onAdresseUpdated(emetteurAdresse.trim())
      }

      onSaved()
      onClose()
    } catch (err) {
      setError(messageErreur(err))
    } finally {
      enregistrementEnCours.current = false
      setSaving(null)
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    enregistrer('brouillon')
  }

  return (
    <div style={overlayStyle}>
      <div className="card" style={{ width: 'min(680px, 95vw)', maxHeight: '92vh', overflowY: 'auto' }}>
        <h2 style={{ marginTop: 0 }}>{facture ? 'Modifier le brouillon' : 'Nouvelle facture'}</h2>
        {chargementLignes ? (
          <p className="muted">Chargement…</p>
        ) : lignesIllisibles ? (
          <>
            <p className="error-text">
              {lignesIllisibles} Le formulaire reste fermé : l'enregistrement remplace les lignes de
              la facture, donc ouvrir ce brouillon sans les avoir lues reviendrait à les effacer.
              Réessaie — la facture, elle, n'est pas touchée.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-outline" onClick={onClose}>Fermer</button>
            </div>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="field">
              <label htmlFor="emetteur-adresse">Adresse de l'émetteur ({dossierNom}{dossierSiret ? ` — SIRET ${dossierSiret}` : ''})</label>
              <textarea id="emetteur-adresse" rows={2} value={emetteurAdresse} onChange={(e) => setEmetteurAdresse(e.target.value)} placeholder="Numéro, rue, code postal, ville" />
              {onAdresseUpdated ? (
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, fontWeight: 400 }}>
                  <input type="checkbox" checked={enregistrerAdresseDossier} onChange={(e) => setEnregistrerAdresseDossier(e.target.checked)} />
                  <span className="muted" style={{ fontSize: '0.8rem' }}>Enregistrer comme adresse du dossier (proposée par défaut la prochaine fois)</span>
                </label>
              ) : !dossierAdresse?.trim() && (
                <span className="muted" style={{ fontSize: '0.8rem' }}>
                  Ton cabinet n’a pas encore enregistré l’adresse de ta société : saisis-la ici pour cette facture, et
                  demande-lui de l’enregistrer pour les suivantes.
                </span>
              )}
            </div>

            <div className="field-row">
              <div className="field">
                <label htmlFor="tiers-nom">Client</label>
                <input id="tiers-nom" required value={tiersNom} onChange={(e) => setTiersNom(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="type-client">Le client est</label>
                <select id="type-client" value={mentions.typeClient} onChange={(e) => majMentions({ typeClient: e.target.value as SaisieMentions['typeClient'] })}>
                  <option value="">— à préciser —</option>
                  <option value="assujetti">une entreprise établie en France</option>
                  <option value="organisme_public">un organisme public (Chorus Pro)</option>
                  <option value="non_assujetti">un particulier, ou un autre non-assujetti</option>
                  <option value="etranger">établi hors de France</option>
                </select>
              </div>
            </div>
            <div className="field-row">
              {sirenOuvert(mentions.typeClient) && (
                <div className="field">
                  <label htmlFor="tiers-siren">SIREN du client{versEntreprise(mentions.typeClient) ? '' : ' (s’il en a un)'}</label>
                  <input id="tiers-siren" inputMode="numeric" value={mentions.siren} onChange={(e) => majMentions({ siren: e.target.value })} />
                </div>
              )}
              <div className="field">
                <label htmlFor="tiers-siret">
                  SIRET du client{mentions.typeClient === 'organisme_public' ? ' (celui du service destinataire)' : ' (optionnel)'}
                </label>
                <input id="tiers-siret" value={tiersSiret} onChange={(e) => changerSiret(e.target.value)} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="tiers-adresse">Adresse du client</label>
              <textarea id="tiers-adresse" rows={2} value={tiersAdresse} onChange={(e) => setTiersAdresse(e.target.value)} />
            </div>
            {versEntreprise(mentions.typeClient) && (
              <div className="field">
                <label htmlFor="tiers-adresse-electronique">Adresse de facturation électronique (optionnel)</label>
                <input
                  id="tiers-adresse-electronique"
                  value={mentions.adresseElectronique}
                  onChange={(e) => majMentions({ adresseElectronique: e.target.value })}
                  placeholder="SIREN, SIREN_SIRET ou SIREN_suffixe"
                />
                <span className="muted" style={{ fontSize: '0.78rem' }}>
                  Telle que l’annuaire de la facturation électronique la publie ; sans elle, la facture part à l’adresse de son SIREN.
                </span>
              </div>
            )}
            {mentions.typeClient === 'organisme_public' && (
              <div className="field-row">
                <div className="field">
                  <label htmlFor="code-service">Code service (s’il le demande)</label>
                  <input id="code-service" value={mentions.codeService} onChange={(e) => majMentions({ codeService: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor="numero-engagement">Numéro d’engagement (s’il le demande)</label>
                  <input id="numero-engagement" value={mentions.numeroEngagement} onChange={(e) => majMentions({ numeroEngagement: e.target.value })} />
                </div>
              </div>
            )}

            <div className="field-row">
              <div className="field">
                <label htmlFor="date-emission">Date d'émission</label>
                <input id="date-emission" type="date" required value={dateEmission} onChange={(e) => setDateEmission(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="date-echeance">Date d'échéance{versEntreprise(mentions.typeClient) ? '' : ' (optionnel)'}</label>
                <input id="date-echeance" type="date" value={dateEcheance} onChange={(e) => setDateEcheance(e.target.value)} />
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label htmlFor="nature-operation">La facture porte sur</label>
                <select id="nature-operation" value={mentions.nature} onChange={(e) => majMentions({ nature: e.target.value as SaisieMentions['nature'] })}>
                  <option value="">— à préciser —</option>
                  <option value="services">des prestations de services</option>
                  <option value="biens">des livraisons de biens</option>
                  <option value="mixte">des biens et des services</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="prestation">Date de la livraison ou de la prestation</label>
                <select id="prestation" value={mentions.prestation} onChange={(e) => majMentions({ prestation: e.target.value as SaisieMentions['prestation'] })}>
                  <option value="facture">celle de la facture</option>
                  <option value="date">un autre jour</option>
                  <option value="periode">une période</option>
                </select>
              </div>
            </div>
            {mentions.prestation === 'date' && (
              <div className="field">
                <label htmlFor="date-prestation">Livrée ou achevée le</label>
                <input id="date-prestation" type="date" value={mentions.datePrestation} onChange={(e) => majMentions({ datePrestation: e.target.value })} />
              </div>
            )}
            {mentions.prestation === 'periode' && (
              <div className="field-row">
                <div className="field">
                  <label htmlFor="periode-debut">Du</label>
                  <input id="periode-debut" type="date" value={mentions.periodeDebut} onChange={(e) => majMentions({ periodeDebut: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor="periode-fin">Au</label>
                  <input id="periode-fin" type="date" value={mentions.periodeFin} onChange={(e) => majMentions({ periodeFin: e.target.value })} />
                </div>
              </div>
            )}
            {livraisonOuverte(mentions.nature) && (
              <div className="field">
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 400 }}>
                  <input
                    id="livraison-ailleurs"
                    type="checkbox"
                    checked={mentions.livraisonAilleurs}
                    onChange={(e) => majMentions({ livraisonAilleurs: e.target.checked })}
                  />
                  Les biens sont livrés ailleurs qu’à l’adresse du client
                </label>
                {mentions.livraisonAilleurs && (
                  <>
                    <div className="field" style={{ marginTop: 8 }}>
                      <label htmlFor="livraison-adresse">Adresse de livraison</label>
                      <input id="livraison-adresse" value={mentions.livraisonAdresse} onChange={(e) => majMentions({ livraisonAdresse: e.target.value })} />
                    </div>
                    <div className="field-row">
                      <div className="field">
                        <label htmlFor="livraison-code-postal">Code postal</label>
                        <input id="livraison-code-postal" value={mentions.livraisonCodePostal} onChange={(e) => majMentions({ livraisonCodePostal: e.target.value })} />
                      </div>
                      <div className="field">
                        <label htmlFor="livraison-ville">Ville</label>
                        <input id="livraison-ville" value={mentions.livraisonVille} onChange={(e) => majMentions({ livraisonVille: e.target.value })} />
                      </div>
                      <div className="field">
                        <label htmlFor="livraison-pays">Pays (deux lettres)</label>
                        <input id="livraison-pays" maxLength={2} value={mentions.livraisonPays} onChange={(e) => majMentions({ livraisonPays: e.target.value })} />
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
            {refusMentions.length > 0 && (
              <div className="error-text" role="alert">
                {refusMentions.map((r) => <p key={r} style={{ margin: '0 0 4px' }}>{pourLEspace(espace, r)}</p>)}
              </div>
            )}

            <div className="field">
              <label>Lignes</label>
              {/* Repliée en fiches sous 860 pixels d'enveloppe (08/10/2026), donc toujours : la fenêtre n'a jamais plus de 680 pixels.
                  La quantité, le prix, le taux et le bouton de retrait passaient derrière un défilement latéral — sur téléphone,
                  mais aussi à l'ordinateur, où « ✕ » sortait de 48 pixels —, et la ligne se remplissait à l'aveugle. Le cadre
                  entoure les fiches, qui gardent leur jeu (`table-empilable-en-carte`). */}
              <div className="table-scroll tableau-adaptable" style={{ border: '1px solid var(--color-border)', borderRadius: 8 }}>
                <table className="table-empilable table-empilable-en-carte">
                  <thead>
                    <tr><th>Désignation</th><th>Qté</th><th>PU HT</th><th>TVA %</th><th>Montant TTC</th><th></th></tr>
                  </thead>
                  <tbody>
                    {lignes.map((l, i) => {
                      const c = calculerLigne(parseFloat(l.quantite) || 0, parseFloat(l.prix_unitaire_ht) || 0, parseFloat(l.taux_tva) || 0)
                      return (
                        <tr key={l.cle}>
                          {/* UN SEUL enfant : en fiche (téléphone), les enfants d'une cellule se rangent côte à côte de son libellé. Il prend la
                              place qu'avait le champ (`flex`, 62 % : index.css, « Un champ dans une fiche »), et le champ, que cette règle borne
                              aussi — à 62 % de SON parent —, remplit son enveloppe. */}
                          <td data-libelle="Désignation">
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: '1 1 auto', minWidth: 0, maxWidth: '62%' }}>
                              <input value={l.designation} onChange={(e) => majLigne(i, { designation: e.target.value })} style={{ minWidth: 160, maxWidth: 'none', width: '100%' }} />
                              {articleDeLaLigne(l, i)}
                            </div>
                          </td>
                          <td data-libelle="Qté"><input type="number" step="0.01" value={l.quantite} onChange={(e) => majLigne(i, { quantite: e.target.value })} style={{ width: 65 }} /></td>
                          <td data-libelle="PU HT"><input type="number" step="any" value={l.prix_unitaire_ht} onChange={(e) => majLigne(i, { prix_unitaire_ht: e.target.value })} style={{ width: 85 }} /></td>
                          <td data-libelle="TVA %"><input type="number" step="0.1" value={l.taux_tva} onChange={(e) => majLigne(i, { taux_tva: e.target.value })} style={{ width: 65 }} /></td>
                          <td data-libelle="Montant TTC">{formatMoney(c.montant_ttc)}</td>
                          <td className="td-boutons"><button type="button" className="btn btn-outline btn-sm" onClick={() => retirerLigne(i)} disabled={lignes.length === 1}>✕</button></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <button type="button" className="btn btn-outline btn-sm" style={{ marginTop: 8 }} onClick={ajouterLigne}>+ Ligne</button>
              {lignesEcartees > 0 && (
                <p className="muted" style={{ marginTop: 8 }}>
                  {lignesEcartees === 1
                    ? 'Une ligne ne partira pas avec la facture, et n’entre pas dans ses totaux'
                    : `${lignesEcartees} lignes ne partiront pas avec la facture, et n’entrent pas dans ses totaux`} :
                  une ligne porte une désignation et une quantité positive.
                </p>
              )}
              {ARTICLES_EXPORTES && (courante == null
                ? <p className="muted" style={{ marginTop: 8 }}>Articles : Chargement…</p>
                : 'echec' in courante
                  ? (
                    <p className="error-text" style={{ marginTop: 8 }}>
                      {espace === 'client' ? 'Tes articles ne se lisent pas' : 'Les articles ne se lisent pas'} : {courante.echec}. Aucun
                      article ne peut être choisi ni enregistré d’ici ; rouvre la facture pour les relire.
                    </p>
                  )
                  : (
                    <>
                      <BandeauLecturePartielle
                        quoi={espace === 'client' ? 'Tes articles' : 'Les articles du dossier'} accord="lus"
                        motif={courante.lu.complete ? null : (courante.lu.motif ?? 'lecture incomplète')}
                        consequence={CONSEQUENCE_ARTICLES_PARTIELS} technique={espace === 'cabinet'}
                      />
                      {articlesEntiers != null && articlesEnCours.length === 0 && (
                        <p className="muted" style={{ marginTop: 8 }}>
                          {espace === 'client' ? 'Tu n’as encore aucun article en cours' : 'Le catalogue du dossier n’a encore aucun article en cours'}
                          {' : « Enregistrer comme article », sous une ligne saisie, en crée un.'}
                        </p>
                      )}
                    </>
                  ))}
              {messageArticle && <p role="status" style={{ marginTop: 8 }}>{messageArticle}</p>}
              {erreurArticle && !fenetreArticle && <p className="error-text" role="alert" style={{ marginTop: 8 }}>{erreurArticle}</p>}
              {refusTaxe && <p className="error-text">{pourLEspace(espace, refusTaxe)}</p>}
              {zeroSansArticle && (
                <p className="alerte-tva" style={{ marginTop: 8 }}>
                  {espace === 'client'
                    ? 'Une ligne à 0 % : pour une société redevable, l’exonération se justifie par son article. Ton cabinet '
                      + 'doit le préciser, ou corrige le taux — sans lui, la facture ne peut pas être transmise à une plateforme.'
                    : 'Une ligne à 0 % : sur un dossier redevable, l’exonération se justifie par son article. Choisis-le dans '
                      + 'l’onglet TVA du dossier, ou corrige le taux — sans lui, la facture ne peut pas être transmise à une '
                      + 'plateforme.'}
                </p>
              )}
            </div>

            <div style={{ display: 'flex', gap: 24, marginTop: 12, marginBottom: 12, flexWrap: 'wrap' }}>
              <div><span className="muted" style={{ display: 'block' }}>Total HT</span><strong>{formatMoney(totaux.montant_ht)}</strong></div>
              <div><span className="muted" style={{ display: 'block' }}>Total TVA</span><strong>{formatMoney(totaux.montant_tva)}</strong></div>
              <div><span className="muted" style={{ display: 'block' }}>Total TTC</span><strong>{formatMoney(totaux.montant_ttc)}</strong></div>
            </div>

            <div className="field">
              <label htmlFor="mentions">Mentions légales</label>
              <textarea id="mentions" rows={3} value={mentionsLegales} onChange={(e) => setMentionsLegales(e.target.value)} />
              <span className="muted" style={{ fontSize: '0.78rem' }}>
                Proposées par défaut selon le statut de TVA du dossier — à vérifier et ajuster, ce n'est pas une garantie de conformité complète.
              </span>
              {manqueMention && <p className="alerte-tva" style={{ marginTop: 8 }}>{pourLEspace(espace, manqueMention)}</p>}
              {mentionAbsente && (
                <p className="alerte-tva" style={{ marginTop: 8 }}>
                  La mention « {mentionAbsente} » manque aux mentions légales.{' '}
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => ajouterMention(mentionAbsente)}>
                    Ajouter la mention
                  </button>
                </p>
              )}
              {franchiseHorsStatut && (
                <p className="alerte-tva" style={{ marginTop: 8 }}>
                  Les mentions citent la franchise en base (« {MENTION_FRANCHISE} »), qui n’est pas le statut de TVA du
                  dossier : retire-la.
                </p>
              )}
            </div>

            {/* Le client qui porte la case « Ventes » lit les notes (migration ventes_du_client) : le libellé le dit
                au-dessus du champ, condition du cabinet à son accord (lib/droitsAcces.ts). */}
            <div className="field">
              <label htmlFor="notes">{espace === 'client' ? LIBELLE_NOTES_FACTURE_CLIENT : LIBELLE_NOTES_FACTURE}</label>
              <textarea id="notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>

            {debitsImprimes && (
              <p className="muted">
                {espace === 'client'
                  ? 'La facture portera l’option pour le paiement de la TVA d’après les débits, que ta société a prise (ton '
                    + 'cabinet l’a enregistrée) : la validation la fige.'
                  : 'La facture portera l’option pour le paiement de la TVA d’après les débits, que le dossier a prise (onglet '
                    + 'TVA) : la validation la fige.'}
              </p>
            )}
            {apercu?.cas === 'hors_plateforme' && <p className="muted">{pourLEspace(espace, apercu.message)}</p>}
            {apercu?.cas === 'transmissible' && (
              <p className="muted">Rien n’empêchera cette facture, une fois validée, de partir par une plateforme agréée.</p>
            )}
            {apercu?.cas === 'a_completer' && (
              <div className="alerte-tva" style={{ marginTop: 8 }}>
                <strong>Pour partir par une plateforme agréée</strong>, cette facture devra encore :
                <ul style={{ margin: '4px 0', paddingLeft: 18 }}>
                  {apercu.refus.map((r) => <li key={r}>{pourLEspace(espace, r)}</li>)}
                  {apercu.ailleurs > 0 && <li>régler la TVA, comme le formulaire le signale plus haut.</li>}
                </ul>
                Une facture validée ne se corrige plus que par un avoir : complète-la avant de la valider si elle doit partir ainsi.
              </div>
            )}

            {error && <p className="error-text">{pourLEspaceSiTexte(espace, error)}</p>}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 10, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-outline" onClick={onClose} disabled={!!saving}>Annuler</button>
              <button type="submit" className="btn btn-outline" disabled={!!saving || articleOccupe || refusMentions.length > 0}>
                {saving === 'brouillon' ? 'Enregistrement…' : 'Enregistrer le brouillon'}
              </button>
              <button type="button" className="btn btn-primary" disabled={!!saving || articleOccupe || refusTaxe != null || refusMentions.length > 0} onClick={() => enregistrer('validee')} title="Attribue un numéro définitif — la facture ne sera plus modifiable ensuite">
                {saving === 'validation' ? 'Validation…' : 'Valider la facture'}
              </button>
            </div>
          </form>
        )}
      </div>
      {fenetreArticle?.genre === 'choix' && articlesEntiers != null && (
        <ArticleChoixModal
          espace={espace} articles={articlesEntiers}
          onChoisir={(a) => choisir(fenetreArticle.cle, a)} onClose={() => setFenetreArticle(null)}
        />
      )}
      {fenetreArticle?.genre === 'saisie' && articlesEntiers != null && (
        <ArticleSaisieModal
          dossierId={dossierId} espace={espace} article={null} saisieDeDepart={fenetreArticle.depart} articles={articlesEntiers}
          occupe={articleOccupe} erreur={erreurArticle}
          onEnregistrer={(saisie) => enregistrerCommeArticle(fenetreArticle.cle, saisie)} onClose={() => setFenetreArticle(null)}
        />
      )}
      {fenetreArticle?.genre === 'remplacer' && (
        <ConfirmationArticle
          titre="Remplacer le contenu de la ligne ?" boutonLabel="Remplacer" occupe={false} refus={null} erreur={null}
          onConfirmer={() => { appliquerChoix(fenetreArticle.cle, fenetreArticle.article); setFenetreArticle(null) }}
          onAnnuler={() => setFenetreArticle(null)}
        >
          <p>
            Choisir l’article « {nomDansUnRefus(fenetreArticle.article.designation)} » remplace {enumeration(fenetreArticle.remplace)} de
            cette ligne.
          </p>
          <p className="muted">La ligne reste libre : la modifier ensuite ne change pas l’article.</p>
        </ConfirmationArticle>
      )}
      {fenetreArticle?.genre === 'prix' && (() => {
        const lu = prixDeLaLigne(fenetreArticle.cle)
        if (lu == null || lu.geste.etat !== 'offert') return null
        const { geste, article } = lu
        return (
          <ConfirmationArticle
            titre="Mettre l’article à ce prix ?" boutonLabel="Mettre à ce prix" occupe={articleOccupe} refus={geste.refus} erreur={erreurArticle}
            onConfirmer={() => mettreAuPrix(fenetreArticle.cle)} onAnnuler={() => setFenetreArticle(null)}
          >
            {article != null && geste.nouveau != null && geste.ancien != null && (
              <p>
                L’article « {nomDansUnRefus(article.designation)} » passe de {formaterPrixUnitaire(geste.ancien)} à {formaterPrixUnitaire(geste.nouveau)}.
              </p>
            )}
            <p className="muted">
              {espace === 'client'
                ? 'Tes prochaines factures qui choisiront cet article prendront ce prix'
                : 'Les prochaines factures de ce dossier qui choisiront cet article prendront ce prix'}
              {' ; aucune facture déjà rédigée ne change, et rien d’autre de l’article ne bouge.'}
            </p>
          </ConfirmationArticle>
        )
      })()}
    </div>
  )
}

const overlayStyle: CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20,
}
