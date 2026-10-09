import { ajouterMois, anneeDe, dernierJourDuMois, jourDe, moisDe } from './format'
import type { ArticleExoneration, PeriodiciteTva, StatutTva } from './types'

// L'E-REPORTING D'UN DOSSIER : QUI Y EST TENU ET DE QUOI, À PARTIR DE QUAND, À QUELLE FRÉQUENCE ON LE PROPOSE, ET CHAQUE
// PÉRIODE AVEC SON ÉCHÉANCE (ligne 28.5, étape e, premier temps e1). Un module PUR : il ne lit rien en base, n'appelle
// personne et ne lit pas l'horloge — l'appelant lui passe le statut et le régime du dossier, et le jour à Paris. Toutes
// ses entrées sont obligatoires : une valeur par défaut serait une réponse qu'on n'a pas lue.
//
// L'e-reporting transmet à l'administration ce que la facture électronique ne porte pas : les ventes à un particulier
// (ou à tout non-assujetti) et à un client établi hors de France, les ACHATS à un fournisseur établi hors de France, et
// les paiements des prestations dont la TVA est due à l'encaissement. Les sources sont publiques : CGI, art. 290 et
// 290 A, et ann. II, art. 242 nonies O et P (au 01/01/2027, le CIBS les reprend aux art. L. 216-55 et L. 216-56 ; l'art.
// 290 reste en vigueur jusqu'aux mesures réglementaires qui le reprendront) ; BOI-TVA-DECLA-20-30-50 (§10, §20),
// -20-30-50-10 (§20, §50 à §100), -20-30-50-30 (§40 à §100), BOI-TVA-DECLA-20-30-60 (§1, §30, §170 à §210) et
// BOI-TVA-DECLA-20-10-20 (§20, §40), tous du 30/09/2026 sauf le dernier ; la fiche « Fréquences et délais de
// transmission » d'impots.gouv.fr (mise à jour d'août 2026) ; le tableau 13 des spécifications externes de la DGFiP
// (v3.2) ; l'actualité d'impots.gouv.fr du 22/09/2026 qui supprime le régime simplifié au 01/01/2027.
//
// CE QUI N'EST PAS ÉCRIT SE DIT « À CONFIRMER », JAMAIS AFFIRMÉ : la fréquence d'un dossier exonéré, que les textes ne
// donnent pas (celle du réel normal trimestriel est proposée), et l'absence de transmission des PAIEMENTS d'une période
// sans paiement (les textes ne l'écrivent que pour les transactions). Et QUAND LES SOURCES LAISSENT UN INTERVALLE OU
// DIVERGENT, l'échéance retenue est la PLUS PROCHE : le 25 pour « entre le 25 et la fin du mois », le 30 — ou le
// dernier jour de février — pour la deuxième décade. Une déclaration manquée coûte une amende par transmission (CGI,
// art. 1788 D) ; une déclaration faite cinq jours plus tôt ne coûte rien.

/** Le premier jour de l'obligation pour une PME ou une micro-entreprise, les dossiers de l'application (qui ne distingue
 * pas une ETI ni une grande entreprise, tenues depuis le 1er septembre 2026) : elle vise les factures émises — à défaut,
 * les opérations — à compter de ce jour (BOI-TVA-DECLA-20-30-50, §10 ; BOI-TVA-DECLA-20-30-60, §1). */
export const DEBUT_EREPORTING_PME = '2027-09-01'

/** La période d'une transmission : la décade (trois par mois), le mois, ou le bimestre civil. */
export type FrequenceEreporting = 'decade' | 'mois' | 'bimestre'

/** Ce qui se déclare. Les ventes et les achats sont des TRANSACTIONS : ils se déclarent à la même fréquence, celle du
 * régime du dossier « quelle que soit l'opération effectuée » (BOI-TVA-DECLA-20-30-50-30, §40). */
export type ObjetEreporting = 'ventes' | 'achats' | 'paiements'

/** Écrite : les textes disent la fréquence de ce régime. À confirmer : ils ne la disent pas, elle est présumée. */
export type Certitude = 'ecrite' | 'a_confirmer'

export interface FrequenceProposee<F extends FrequenceEreporting = FrequenceEreporting> {
  frequence: F
  certitude: Certitude
  /** Pourquoi elle est à confirmer, en français ; nulle quand elle est écrite. */
  raison: string | null
}

// UNE FRÉQUENCE EST PROPOSÉE, JAMAIS DÉCIDÉE : le régime de TVA d'une entreprise est une donnée qu'elle communique à sa
// plateforme agréée (impots.gouv.fr, 22/09/2026), et le cabinet le confirmera dossier par dossier. Elle se propose
// depuis le statut de TVA du dossier et, pour un redevable, la périodicité de sa CA3 : le régime simplifié disparaît au
// 01/01/2027, avant l'obligation d'une PME, et il ne reste que le réel normal mensuel ou trimestriel. La périodicité d'un
// dossier qui n'est pas redevable ne dit rien : l'onglet TVA ne la montre qu'à un redevable.
const EXONERE_A_CONFIRMER = 'les textes ne la disent pas pour un dossier exonéré ; celle du réel normal trimestriel est '
  + 'proposée, à confirmer avec son service des impôts'

/**
 * La fréquence des TRANSACTIONS (ventes et achats) : par décade au réel normal mensuel (BOI-TVA-DECLA-20-30-50-30, §50),
 * chaque mois au réel normal trimestriel (§60), par bimestre civil en franchise en base (§70). Nulle pour un statut à
 * préciser.
 */
export function frequenceDesTransactions(statut: StatutTva | null, periodicite: PeriodiciteTva): FrequenceProposee | null {
  switch (statut) {
    case 'redevable': return { frequence: periodicite === 'mensuelle' ? 'decade' : 'mois', certitude: 'ecrite', raison: null }
    case 'franchise': return { frequence: 'bimestre', certitude: 'ecrite', raison: null }
    case 'exonere': return { frequence: 'mois', certitude: 'a_confirmer', raison: EXONERE_A_CONFIRMER }
    case null: return null
  }
}

/**
 * La fréquence des PAIEMENTS : chaque mois au réel normal, mensuel OU trimestriel (BOI-TVA-DECLA-20-30-60, §170), par
 * bimestre civil en franchise en base (§180). Elle ne dépend donc pas de la périodicité de la CA3. Nulle pour un statut à
 * préciser.
 */
export function frequenceDesPaiements(statut: StatutTva | null): FrequenceProposee<'mois' | 'bimestre'> | null {
  switch (statut) {
    case 'redevable': return { frequence: 'mois', certitude: 'ecrite', raison: null }
    case 'franchise': return { frequence: 'bimestre', certitude: 'ecrite', raison: null }
    case 'exonere': return { frequence: 'mois', certitude: 'a_confirmer', raison: EXONERE_A_CONFIRMER }
    case null: return null
  }
}

const RYTHME: Record<FrequenceEreporting, string> = { decade: 'par décade', mois: 'chaque mois', bimestre: 'tous les deux mois' }

/** « par décade », « chaque mois », « tous les deux mois » — et, à confirmer, le dit : en bref, ou avec sa raison. */
export function libelleFrequence(f: FrequenceProposee, avecLaRaison: boolean): string {
  if (f.certitude === 'ecrite') return RYTHME[f.frequence]
  return `${RYTHME[f.frequence]} (fréquence à confirmer${avecLaRaison && f.raison ? ` : ${f.raison}` : ''})`
}

// ── Qui y est tenu, et de quoi ──────────────────────────────────────────────────────────────────────────────────────

/** Due ; due pour une partie de l'activité ; due s'il a de telles opérations ; non due ; à préciser. */
export type EtatObligation = 'due' | 'en_partie' | 'le_cas_echeant' | 'non_due' | 'a_preciser'

export interface ObligationEreporting {
  objet: ObjetEreporting
  etat: EtatObligation
  /** Le premier jour de l'obligation ; nul quand rien n'est dû, ou qu'on ne le sait pas. */
  depuis: string | null
  /** La fréquence proposée ; nulle quand rien n'est dû, ou que le statut est à préciser. */
  frequence: FrequenceProposee | null
}

/**
 * Ce que le dossier déclare par l'e-reporting.
 *
 * - SES ACHATS à un fournisseur établi hors de France — un service acheté à un prestataire non établi, qu'il autoliquide,
 *   ou une acquisition intracommunautaire taxable en France (celle d'un franchisé ou d'un exonéré sous le seuil du régime
 *   dérogatoire ne l'est peut-être pas : point non relu de la conception) : TOUT assujetti établi en France, quel que soit
 *   son statut de TVA, exonéré et franchisé compris (CGI, art. 290, I-3° ; BOI-TVA-DECLA-20-30-50-10, §60 ; le tableau
 *   des opérations dans le champ d'impots.gouv.fr : un achat de formation à un assujetti allemand se déclare « par le
 *   destinataire assujetti établi en France »). C'est l'obligation que l'application taisait à un dossier exonéré.
 * - SES VENTES à un particulier (ou à tout non-assujetti) et à un client établi hors de France (I-1° et 2° ; §50 à
 *   §100) : les opérations exonérées par les art. 261 à 261 E en sortent (§20), les soins au premier rang. Un franchisé y
 *   est tenu (BOI-TVA-DECLA-20-30-50, §20) ; un redevable en partie exonéré, pour ses opérations taxables ; un dossier
 *   exonéré, s'il a aussi des opérations taxables — un acte sans finalité thérapeutique, une expertise, des locaux
 *   aménagés loués, même à des confrères (BOI-TVA-CHAMP-30-10-20-10, §20 à §80) —, que son statut ne dit pas encore.
 * - SES PAIEMENTS, ceux des prestations de services dont la TVA est due à l'encaissement (art. 290 A ;
 *   BOI-TVA-DECLA-20-30-60, §1) : comme ses ventes, sauf sur option pour les débits, où ils ne sont pas attendus (§30 et
 *   sa tolérance ; FAQ « J'approfondis » d'impots.gouv.fr, §4.1) — l'option ne regarde pas un franchisé, qui ne facture
 *   pas de TVA.
 *
 * Toutes commencent au 1er septembre 2027 (`DEBUT_EREPORTING_PME`), et aucune ne demande rien sur une période sans
 * opération (`transmissionAttendue`).
 */
export function obligationsEreporting(
  statut: StatutTva | null, article: ArticleExoneration | null, periodicite: PeriodiciteTva, surDebits: boolean,
): Record<ObjetEreporting, ObligationEreporting> {
  const transactions = frequenceDesTransactions(statut, periodicite)
  const paiements = frequenceDesPaiements(statut)
  const tenu = (objet: ObjetEreporting, etat: EtatObligation, frequence: FrequenceProposee | null): ObligationEreporting =>
    ({ objet, etat, depuis: DEBUT_EREPORTING_PME, frequence })
  const pasTenu = (objet: ObjetEreporting, etat: EtatObligation): ObligationEreporting => ({ objet, etat, depuis: null, frequence: null })

  // Les achats ne dépendent pas du statut : seule leur fréquence en dépend, inconnue tant qu'il est à préciser.
  const achats = tenu('achats', 'due', transactions)
  if (statut == null) return { ventes: pasTenu('ventes', 'a_preciser'), achats, paiements: pasTenu('paiements', 'a_preciser') }
  if (statut === 'exonere') {
    return { ventes: tenu('ventes', 'le_cas_echeant', transactions), achats, paiements: tenu('paiements', 'le_cas_echeant', paiements) }
  }
  const etat: EtatObligation = statut === 'redevable' && article != null ? 'en_partie' : 'due'
  return {
    ventes: tenu('ventes', etat, transactions),
    achats,
    paiements: statut === 'redevable' && surDebits ? pasTenu('paiements', 'non_due') : tenu('paiements', etat, paiements),
  }
}

/** La facture — à défaut, l'opération — de ce jour entre-t-elle dans l'obligation d'une PME ? Pour un paiement, c'est la
 * date de SA FACTURE qui décide, pas celle de l'encaissement (BOI-TVA-DECLA-20-30-60, §1). Faux pour une date qui n'en
 * est pas une. */
export function dansLObligation(dateFactureOuOperation: string): boolean {
  return dateCivile(dateFactureOuOperation) && dateFactureOuOperation >= DEBUT_EREPORTING_PME
}

// ── Aucune transmission « à blanc » ───────────────────────────────────────────────────────────────────────────────────

export interface TransmissionAttendue {
  attendue: boolean
  certitude: Certitude
  raison: string
}

/**
 * Une transmission est-elle attendue pour une période qui compte `nombreOperations` opérations ? Jamais pour une période
 * sans opération : « En l'absence d'opérations réalisées sur une période concernée, aucune transmission n'est attendue »
 * (BOI-TVA-DECLA-20-30-50-30, §80 ; CGI, ann. II, art. 242 nonies O). Les textes ne l'écrivent que pour les
 * TRANSACTIONS : pour les paiements, l'application ne propose rien non plus, et le dit à confirmer. Ce module ne dit que
 * cette règle : qu'un dossier soit tenu de quoi que ce soit vient d'`obligationsEreporting`.
 *
 * LE VIDE EST UNE AFFIRMATION : zéro ne se passe ici que pour une période dont TOUTES les sources ont été lues en entier.
 * Un compte qui n'est pas un entier positif ou nul n'est pas un compte : null.
 */
export function transmissionAttendue(objet: ObjetEreporting, nombreOperations: number): TransmissionAttendue | null {
  if (!Number.isInteger(nombreOperations) || nombreOperations < 0) return null
  if (nombreOperations > 0) {
    return { attendue: true, certitude: 'ecrite', raison: 'Des opérations sur la période : leur transmission est attendue.' }
  }
  if (objet === 'paiements') {
    return {
      attendue: false, certitude: 'a_confirmer',
      raison: 'Aucun paiement sur la période : rien à transmettre — à confirmer, les textes ne le disant que des transactions.',
    }
  }
  return { attendue: false, certitude: 'ecrite', raison: 'Aucune opération sur la période : aucune transmission n’est attendue.' }
}

// ── Les périodes et leurs échéances ───────────────────────────────────────────────────────────────────────────────────

export interface PeriodeEreporting {
  frequence: FrequenceEreporting
  /** Bornes comprises, AAAA-MM-JJ. */
  debut: string
  fin: string
  /** Au plus tard ce jour-là, AAAA-MM-JJ : la date limite de dépôt sur la plateforme, la plus proche que les sources
   * laissent. */
  echeance: string
  /** Pourquoi l'échéance est une borne retenue entre plusieurs, en français ; nulle quand les sources s'accordent. */
  prudence: string | null
  /** « septembre 2027 », « septembre et octobre 2027 », « du 1er au 10 septembre 2027 ». */
  libelle: string
  /** Le même précédé de sa préposition : « de septembre 2027 », « d’octobre 2027 », « du 1er au 10 septembre 2027 ». */
  libelleDe: string
}

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
const nomDuMois = (mois: number) => MOIS[mois - 1]
const deMois = (mois: number) => (/^[aeiouy]/.test(nomDuMois(mois)) ? `d’${nomDuMois(mois)}` : `de ${nomDuMois(mois)}`)

export const PRUDENCE_FIN_DE_MOIS = 'du 25 à la fin du mois selon l’entreprise ; l’application retient le 25'
export const PRUDENCE_DEUXIEME_DECADE = 'dix jours après la décade ou le dernier jour du mois, selon les sources ; l’application '
  + 'retient le plus tôt'

// Une date civile AAAA-MM-JJ qui existe. Sur le calendrier civil, sans `Date` : le fuseau de qui regarde n'y change rien.
function dateCivile(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  const mois = moisDe(date)
  return mois >= 1 && mois <= 12 && jourDe(date) >= 1 && date <= dernierJourDuMois(date)
}

/**
 * La période d'une fréquence qui contient ce jour, et son échéance — sur le seul calendrier : qu'une date soit avant le
 * 1er septembre 2027 n'y change rien (le statut « Encaissée » d'une facture antérieure se déclare, facultatif, au même
 * rythme) ; c'est `calendrierEreporting` qui commence à l'obligation. Null pour une date qui n'en est pas une.
 *
 * Les échéances (date limite de DÉPÔT sur la plateforme, qui transmet ensuite à l'administration) :
 * - la DÉCADE (réel normal mensuel) : « dans un délai de dix jours suivant la fin de la période »
 *   (BOI-TVA-DECLA-20-30-50-30, §90) — le 20 pour la première, le 10 du mois suivant pour la troisième, comme le disent
 *   la fiche d'impots.gouv.fr et le tableau 13 des spécifications. Pour la DEUXIÈME, les sources divergent : le 30 pour
 *   la doctrine et la fiche (« sauf mois de février »), le dernier jour du mois pour le tableau 13 ; le plus tôt des deux
 *   est retenu — le 30, et le dernier jour de février ;
 * - le MOIS (réel normal trimestriel, et les paiements au réel) : le 10 du mois suivant (§90 ; BOI-TVA-DECLA-20-30-60,
 *   §190 ; tableau 13). La fiche écrit « Avant le 10 du mois suivant », mais dit aussi « 10 jours après la fin de la
 *   période, soit […] 10 du mois suivant » : le 10 est le dernier des dix jours ;
 * - le BIMESTRE CIVIL (franchise en base) : « entre le 25 et la fin du mois suivant la fin de la période » (§100 ;
 *   BOI-TVA-DECLA-20-30-60, §210), à un jour propre à l'entreprise que l'application ne connaît pas : le 25 est retenu.
 *   Le délai du régime simplifié, mensuel « entre le 25 et la fin du mois suivant » (§100 et §200), disparaît avec lui
 *   au 01/01/2027, avant l'obligation d'une PME.
 */
export function periodeDe(date: string, frequence: FrequenceEreporting): PeriodeEreporting | null {
  if (!dateCivile(date)) return null
  const annee = anneeDe(date)
  const mois = moisDe(date)
  const premier = `${date.slice(0, 7)}-01`
  const dernier = dernierJourDuMois(premier)
  const leDixDuMoisSuivant = `${ajouterMois(premier, 1).slice(0, 7)}-10`

  if (frequence === 'mois') {
    return {
      frequence, debut: premier, fin: dernier, echeance: leDixDuMoisSuivant, prudence: null,
      libelle: `${nomDuMois(mois)} ${annee}`, libelleDe: `${deMois(mois)} ${annee}`,
    }
  }

  if (frequence === 'bimestre') {
    // Les bimestres civils : janvier-février, mars-avril… (§70, remarque) — ils commencent un mois impair.
    const moisDuDebut = mois % 2 === 1 ? mois : mois - 1
    const debut = `${annee}-${String(moisDuDebut).padStart(2, '0')}-01`
    return {
      frequence, debut, fin: dernierJourDuMois(ajouterMois(debut, 1)),
      echeance: `${ajouterMois(debut, 2).slice(0, 7)}-25`, prudence: PRUDENCE_FIN_DE_MOIS,
      libelle: `${nomDuMois(moisDuDebut)} et ${nomDuMois(moisDuDebut + 1)} ${annee}`,
      libelleDe: `${deMois(moisDuDebut)} et ${nomDuMois(moisDuDebut + 1)} ${annee}`,
    }
  }

  // Trois décades : du 1er au 10, du 11 au 20, du 21 à la fin du mois (BOI-TVA-DECLA-20-30-50-30, §50).
  const jour = jourDe(date)
  const duMois = `${nomDuMois(mois)} ${annee}`
  const leJour = (j: number) => `${date.slice(0, 8)}${String(j).padStart(2, '0')}`
  const decade = (debut: number, fin: string, echeance: string, prudence: string | null): PeriodeEreporting => {
    const libelle = `du ${debut === 1 ? '1er' : debut} au ${jourDe(fin)} ${duMois}`
    return { frequence, debut: leJour(debut), fin, echeance, prudence, libelle, libelleDe: libelle }
  }
  if (jour <= 10) return decade(1, leJour(10), leJour(20), null)
  if (jour <= 20) {
    // Le 30 n'existe pas en février : le dernier jour du mois vient alors avant les dix jours de la doctrine.
    const echeance = dernier < leJour(30) ? dernier : leJour(30)
    return decade(11, leJour(20), echeance, echeance === dernier && echeance === leJour(30) ? null : PRUDENCE_DEUXIEME_DECADE)
  }
  return decade(21, dernier, leDixDuMoisSuivant, null)
}

// ── Le calendrier d'un dossier ────────────────────────────────────────────────────────────────────────────────────────

/** En cours : la période n'est pas finie, elle ne se déclare pas encore. Close : elle se déclare jusqu'à son échéance.
 * Échéance passée : au-delà. Ce que le dossier y a déclaré, et s'il avait de quoi, ne se lit pas ici. */
export type EtatDuCalendrier = 'en_cours' | 'close' | 'echeance_passee'

export interface PeriodeDuCalendrier extends PeriodeEreporting {
  etat: EtatDuCalendrier
}

/**
 * Les périodes d'une fréquence depuis le 1er septembre 2027 jusqu'à celle qui contient `aujourdhui` (le jour à Paris),
 * dans l'ordre, chacune avec son état au calendrier. Aucune avant le 1er septembre 2027 : avant, rien ne se déclare, et
 * la liste est vide — le 1er septembre ouvre une décade, un mois et un bimestre civil (septembre-octobre). Null pour un
 * jour qui n'en est pas un.
 */
export function calendrierEreporting(frequence: FrequenceEreporting, aujourdhui: string): PeriodeDuCalendrier[] | null {
  if (!dateCivile(aujourdhui)) return null
  const periodes: PeriodeDuCalendrier[] = []
  // MOIS APRÈS MOIS, et dans chaque mois les 1er, 11 et 21 : toute décade, tout mois, tout bimestre civil contient l'un
  // de ces jours. La boucle avance d'un mois à chaque tour, quoi que rende `periodeDe` : une période qui n'avancerait
  // pas — un défaut à venir — ne la ferait jamais tourner sans fin, et l'écran qui la lira ne gèlerait pas. Avancer de
  // la fin d'une période au début de la suivante, comme d'abord écrit, bouclait sur un bimestre d'un seul mois.
  for (let premier = DEBUT_EREPORTING_PME; premier <= aujourdhui; premier = ajouterMois(premier, 1)) {
    for (const jour of ['01', '11', '21']) {
      const date = `${premier.slice(0, 8)}${jour}`
      const p = date <= aujourdhui ? periodeDe(date, frequence) : null
      if (p == null || p.debut === periodes.at(-1)?.debut) continue
      const etat: EtatDuCalendrier = aujourdhui <= p.fin ? 'en_cours' : aujourdhui <= p.echeance ? 'close' : 'echeance_passee'
      periodes.push({ ...p, etat })
    }
  }
  return periodes
}
