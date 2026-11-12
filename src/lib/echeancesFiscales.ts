import type { ModeComptable } from './types'
import { SEUIL_ANNEXE_2035E, SEUIL_CVAE_A_PAYER } from './declaration2035E'
import { ajouterJours } from './format'
import {
  PREMIERE_CLOTURE_A_CONFIRMER, acomptesDeLExercice, calculerImpotSurLesSocietes, echeanceDuSolde, type EntreesImpot,
} from './impotSurLesSocietes'

// LE CALENDRIER DE LA CFE, DE LA CVAE ET DE LA LIASSE 2035 D'UN BNC (ligne 48 de la feuille de route), pour la Checklist.
// Des dates et ce qui est dû à chacune, AVEC SA CONDITION : la Checklist ne sait ni la CFE de l'an dernier (qui décide de
// l'acompte), ni la CVAE (qui décide des siens), ni si le dossier a créé un établissement — elle ne les invente pas, elle
// dit à qui chaque échéance s'adresse. Rien ici ne lit le dossier.
//
// Sources publiques :
//   [B1] BOI-IF-CFE-40-10 (25/09/2024) § 10 à 110 : acompte de CFE (CFE de l'année précédente d'au moins 3 000 €, sans
//        prélèvement mensuel), payable au 15 juin ; solde au 15 décembre ; avis en ligne seulement ; paiement dématérialisé ;
//   [B2] BOI-CVAE-DECLA-20 (19/11/2025) § 20 à 70 : acomptes de CVAE les 15 juin et 15 septembre si la CVAE de l'année
//        précédente dépasse 1 500 € ; liquidation (1329-DEF) au plus tard le deuxième jour ouvré suivant le 1er mai ;
//   [B3] BOI-CVAE-DECLA-10 (24/04/2024) § 5 : déclaration de la valeur ajoutée au deuxième jour ouvré suivant le 1er mai,
//        quinze jours de plus en ligne — la 2035-E en tient lieu pour un mono-établissement (§ 20) ;
//   [B4] brochure pratique Impôts locaux 2026 (DGFiP) : calendrier CVAE 2026 — 1329-DEF et 1330-CVAE le 5 mai 2026 ;
//        déclarations de CFE : 1447-C avant le 31 décembre de l'année de la création, 1447-M au deuxième jour ouvré suivant
//        le 1er mai de l'année précédant l'imposition ;
//   [A]  impots.gouv.fr, actualités de la CFE : un 15 tombant un samedi ou un dimanche reporte l'échéance au lundi —
//        17 juin 2024, 16 décembre 2024, 16 juin 2025 ;
//   [T]  code du travail, art. L. 3133-1 : les onze jours fériés.

export type Impot = 'CFE' | 'CVAE' | 'Liasse' | 'IS'

export interface EcheanceFiscale {
  id: string
  // AAAA-MM-JJ, sur le calendrier civil.
  date: string
  impot: Impot
  // Ce qui est dû, et sur quel formulaire.
  libelle: string
  // À qui l'échéance s'adresse : la Checklist ne le sait pas, elle le dit.
  condition: string
}

const deuxChiffres = (n: number) => String(n).padStart(2, '0')
const dateCivile = (annee: number, mois: number, jour: number) => `${annee}-${deuxChiffres(mois)}-${deuxChiffres(jour)}`

// Le dimanche de Pâques du calendrier grégorien (algorithme anonyme dit de Meeus, Jones et Butcher).
export function paques(annee: number): string {
  const a = annee % 19
  const b = Math.floor(annee / 100)
  const c = annee % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const mois = Math.floor((h + l - 7 * m + 114) / 31)
  const jour = ((h + l - 7 * m + 114) % 31) + 1
  return dateCivile(annee, mois, jour)
}

// Les onze jours fériés [T] : fixes, et ceux qui suivent Pâques (lundi de Pâques, Ascension, lundi de Pentecôte).
export function joursFeries(annee: number): Set<string> {
  const dimanche = paques(annee)
  return new Set([
    dateCivile(annee, 1, 1), ajouterJours(dimanche, 1), dateCivile(annee, 5, 1), dateCivile(annee, 5, 8),
    ajouterJours(dimanche, 39), ajouterJours(dimanche, 50), dateCivile(annee, 7, 14), dateCivile(annee, 8, 15),
    dateCivile(annee, 11, 1), dateCivile(annee, 11, 11), dateCivile(annee, 12, 25),
  ])
}

// Un jour ouvré : du lundi au vendredi, hors jour férié. Le jour de la semaine se lit en UTC sur la date civile, jamais
// en heure locale : aucun fuseau ne doit pouvoir décaler une échéance d'un jour.
export function estOuvre(date: string): boolean {
  const [annee, mois, jour] = date.split('-').map(Number)
  const semaine = new Date(Date.UTC(annee, mois - 1, jour)).getUTCDay()
  return semaine !== 0 && semaine !== 6 && !joursFeries(annee).has(date)
}

// « Au plus tard le deuxième jour ouvré suivant le 1er mai » [B2, B3] : le 5 mai 2026 (le 1er est un vendredi, férié ;
// lundi 4, mardi 5), date que la brochure de la DGFiP donne aussi [B4].
export function deuxiemeJourOuvreApresLePremierMai(annee: number): string {
  let date = dateCivile(annee, 5, 1)
  let ouvres = 0
  while (ouvres < 2) {
    date = ajouterJours(date, 1)
    if (estOuvre(date)) ouvres += 1
  }
  return date
}

// Une échéance de paiement qui tombe un samedi, un dimanche ou un jour férié passe au premier jour ouvré suivant — ce
// que la DGFiP fait pour la CFE [A].
export function premierJourOuvreDesLe(date: string): string {
  let jour = date
  while (!estOuvre(jour)) jour = ajouterJours(jour, 1)
  return jour
}

// Le délai supplémentaire de quinze jours calendaires d'une déclaration déposée en ligne [B3] — la seule voie pour une
// 2035, dont la télédéclaration est obligatoire.
export const DELAI_TELEDECLARATION_JOURS = 15

// Les seuils des conditions. Ceux de l'annexe et de la CVAE viennent du moteur de la 2035-E, pour ne vivre qu'à un
// endroit ; ceux des acomptes, du BOFiP [B1, B2].
export const SEUIL_ACOMPTE_CFE = 3_000
export const SEUIL_ACOMPTES_CVAE = 1_500

// Un montant ne se coupe pas en fin de ligne — la Checklist se lit aussi sur téléphone : espace fine insécable entre les
// milliers, insécable avant l'euro, comme `formatMoney`.
export function euros(montant: number): string {
  return `${String(montant).replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f')}\u00a0€`
}

// Les échéances d'une année civile, dans l'ordre des dates.
export function echeancesFiscales(annee: number): EcheanceFiscale[] {
  const premierMai = deuxiemeJourOuvreApresLePremierMai(annee)
  const echeances: EcheanceFiscale[] = [
    {
      id: `liasse-${annee}`, date: ajouterJours(premierMai, DELAI_TELEDECLARATION_JOURS), impot: 'Liasse',
      libelle: `Déclaration 2035 des revenus ${annee - 1}, avec son annexe 2035-E si elle est due`,
      condition: `Annexe due si le chiffre d’affaires hors taxes de ${annee - 1} dépasse ${euros(SEUIL_ANNEXE_2035E)} ; elle vaut déclaration de la valeur `
        + `ajoutée pour un mono-établissement, sinon la 1330-CVAE suit le même délai. Télédéclaration : le deuxième jour ouvré `
        + `suivant le 1er mai, plus quinze jours.`,
    },
    {
      id: `cvae-solde-${annee}`, date: premierMai, impot: 'CVAE',
      libelle: `Liquidation de la CVAE ${annee - 1} (1329-DEF) et paiement du solde`,
      condition: `Si le chiffre d’affaires de ${annee - 1} dépasse ${euros(SEUIL_CVAE_A_PAYER)} hors taxes ; en dessous, la CVAE est nulle.`,
    },
    {
      id: `cfe-1447m-${annee}`, date: premierMai, impot: 'CFE',
      libelle: `Déclaration modificative de CFE (1447-M-SD), pour la CFE ${annee + 1}`,
      condition: 'Si les locaux ont changé de surface ou de consistance, ou pour demander une exonération.',
    },
    {
      id: `cfe-acompte-${annee}`, date: premierJourOuvreDesLe(dateCivile(annee, 6, 15)), impot: 'CFE',
      libelle: `Acompte de CFE ${annee} : la moitié de la CFE ${annee - 1}, avis dans l’espace professionnel`,
      condition: `Si la CFE de ${annee - 1} atteignait ${euros(SEUIL_ACOMPTE_CFE)}, et sans prélèvement mensuel.`,
    },
    {
      id: `cvae-acompte-juin-${annee}`, date: dateCivile(annee, 6, 15), impot: 'CVAE',
      libelle: `Premier acompte de CVAE ${annee} (1329-AC)`,
      condition: `Si la CVAE de ${annee - 1} dépassait ${euros(SEUIL_ACOMPTES_CVAE)}.`,
    },
    {
      id: `cvae-acompte-septembre-${annee}`, date: dateCivile(annee, 9, 15), impot: 'CVAE',
      libelle: `Second acompte de CVAE ${annee} (1329-AC)`,
      condition: `Si la CVAE de ${annee - 1} dépassait ${euros(SEUIL_ACOMPTES_CVAE)}.`,
    },
    {
      id: `cfe-solde-${annee}`, date: premierJourOuvreDesLe(dateCivile(annee, 12, 15)), impot: 'CFE',
      libelle: `CFE ${annee} : avis dans l’espace professionnel, paiement en ligne ou par prélèvement`,
      condition: 'Due chaque année, sauf exonération, et sauf l’année de la création d’un établissement.',
    },
    {
      id: `cfe-1447c-${annee}`, date: dateCivile(annee, 12, 31), impot: 'CFE',
      libelle: `Déclaration initiale de CFE (1447-C-SD), base de la CFE ${annee + 1}`,
      condition: `Si un établissement a été créé ou repris en ${annee}.`,
    },
  ]
  return echeances.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
}

// Les échéances des douze mois à venir, à partir d'aujourd'hui (inclus) : l'année en cours et la suivante, pour qu'en
// décembre la Checklist annonce déjà la liasse de mai.
export function prochainesEcheances(aujourdHui: string): EcheanceFiscale[] {
  const annee = Number(aujourdHui.slice(0, 4))
  const limite = ajouterJours(aujourdHui, 365)
  return [...echeancesFiscales(annee), ...echeancesFiscales(annee + 1)]
    .filter((e) => e.date >= aujourdHui && e.date < limite)
}

// ─── L'IMPÔT SUR LES SOCIÉTÉS AU CALENDRIER (ligne 38, LIA8 ; conception 37, § 6.3 ; LIA-Q8 (A)) ───────────────────────
// Les quatre acomptes (relevé 2571-SD) aux 15 mars, 15 juin, 15 septembre et 15 décembre de l'exercice, et le solde
// (relevé 2572-SD) au 15 mai qui suit sa clôture, pour un exercice CIVIL ; les montants tirés de `lib/impotSurLesSocietes.ts`
// (LIA3) sur des entrées lues en entier, jamais stockés, jamais devinés, jamais 0 à la place d'un montant inconnu.
//
// Sources publiques (lues le 12/11/2026) :
//   [D20]  CGI art. 1668 ; BOI-IS-DECLA-20-10-20200610 (3558-PGP) § 40 à 70 : « Le paiement des acomptes d'IS doit être
//          effectué au plus tard les 15 mars, 15 juin, 15 septembre et 15 décembre de chaque année » ; le solde « au plus
//          tard le 15 du quatrième mois qui suit la clôture de l'exercice ou si aucun exercice n'est clos en cours d'année,
//          le 15 mai de l'année suivante ». Aucun report au jour ouvré n'y est écrit, ni dans BOI-IS-DECLA-20-30-20260121
//          (cas particuliers de paiement).
//   [R110] BOI-REC-PART-10-40-20200630 § 110 : le report au premier jour ouvrable d'une date limite tombant un samedi, un
//          dimanche ou un jour férié vise les « impôts sur rôle des particuliers » — pas l'IS, qui s'autoliquide.
// Aucun texte lu ne reporte une échéance d'IS : la date rendue est la DATE LÉGALE ; tombant un samedi, un dimanche ou un
// jour férié, l'échéance le DIT sans se déplacer (LIA8-Q1). La CFE garde son report, tiré de la pratique publiée [A].
//
// Hors de ce bloc, et dit : un exercice qui n'est pas l'année civile (ligne 42) ; la contribution sociale non calculée (le
// solde se dit alors sans montant) ; s'abstenir d'un acompte (art. 1668, 4 bis), un choix du cabinet.

// Baissé : aucun écran ne montre l'IS, le calendrier rendu est celui d'hier à l'octet (`echeancesFiscales.test.ts`). Il se
// lève avec la liasse (LIA10), quand le régime d'un exercice se lira en base (`fiscalite_des_exercices`, LIA4).
export const CALENDRIER_IS_EXPORTE = false

// Ce que le calendrier reçoit pour les acomptes : les entrées de `acomptesDeLExercice`, l'année et le premier exercice
// posés ici, depuis l'exercice.
export type EntreesDesAcomptes = Omit<Parameters<typeof acomptesDeLExercice>[0], 'annee' | 'premierExercice'>

// Une lecture faite EN ENTIER donne ses entrées ; sinon le montant se tait.
export type EntreesLues<T> = { lecture: 'entiere'; entrees: T } | { lecture: 'incomplete' }

export interface ExerciceALImpotSurLesSocietes {
  annee: number
  imposition: 'is'
  debut: string
  fin: string
  // Le premier exercice soumis à l'IS : aucun acompte (CGI art. 1668, 1).
  premierExercice: boolean
  acomptes: EntreesLues<EntreesDesAcomptes>
  // Le solde : l'IS de l'exercice, une fois sa liasse établie (« a-venir » avant).
  impot: EntreesLues<EntreesImpot> | { lecture: 'a-venir' }
}

// Le régime d'un exercice, tel que le cabinet l'a dit (LIA-Q1 : par exercice).
export type ImpositionDeLExercice = { annee: number; imposition: 'ir' } | ExerciceALImpotSurLesSocietes

export type ImpotDuDossier =
  // Un BNC en trésorerie, un BIC à l'IR : ni acompte ni solde d'IS. Ce que tous les écrans passent tant que le régime ne
  // se lit pas en base (LIA4).
  | { regime: 'sans-impot-sur-les-societes' }
  | { regime: 'par-exercice'; exercices: readonly ImpositionDeLExercice[] }

export const SANS_IMPOT_SUR_LES_SOCIETES: ImpotDuDossier = { regime: 'sans-impot-sur-les-societes' }

export type MontantDeLEcheanceIs =
  // À payer, en centimes.
  | { etat: 'du'; centimes: number }
  // Rien à payer : premier exercice, dispense, deuxième acompte réduit à zéro, solde nul ou excédent (en centimes) restitué.
  | { etat: 'rien-a-payer'; raison: string; excedent: number }
  // Ne se dit pas : lecture incomplète, référence à saisir, liasse pas encore établie, calcul refusé.
  | { etat: 'sans-montant'; raison: string }

export interface EcheanceDeLImpot extends EcheanceFiscale {
  impot: 'IS'
  formulaire: '2571' | '2572'
  // 1 à 4 pour un acompte, nul pour le solde.
  numero: 1 | 2 | 3 | 4 | null
  // L'exercice au titre duquel l'échéance est due.
  exercice: number
  montant: MontantDeLEcheanceIs
  // Vrai quand la date légale tombe un samedi, un dimanche ou un jour férié : dit, jamais reportée [R110].
  jourNonOuvre: boolean
}

export function estEcheanceDeLImpot(e: EcheanceFiscale): e is EcheanceDeLImpot {
  return e.impot === 'IS'
}

const NOMS_DES_JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']
const NOMS_DES_MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']

// « dimanche 15 mars 2026 », « jour férié, vendredi 1 mai… » — le jour de la semaine lu en UTC sur la date civile.
export function jourDit(date: string): string {
  const [annee, mois, jour] = date.split('-').map(Number)
  const semaine = new Date(Date.UTC(annee, mois - 1, jour)).getUTCDay()
  const ferie = semaine !== 0 && semaine !== 6 && joursFeries(annee).has(date)
  return `${ferie ? 'jour férié, ' : ''}${NOMS_DES_JOURS[semaine]} ${jour} ${NOMS_DES_MOIS[mois - 1]} ${annee}`
}

export const AVIS_JOUR_NON_OUVRE_IS = 'Aucun texte ne reporte une échéance d’impôt sur les sociétés au jour ouvré suivant (le '
  + 'report du BOFiP vise les impôts sur rôle des particuliers, BOI-REC-PART-10-40 § 110) : la date légale est dite telle quelle.'

const MOTIF_LECTURE_INCOMPLETE = 'Les données de l’exercice ne sont pas toutes lues : le montant ne se dit pas.'
const BAREME_A_CONFIRMER = ' Barème de l’article 219 en vigueur au 12/11/2026, à confirmer par la loi de finances pour 2027.'
const ORDINAUX = ['Premier', 'Deuxième', 'Troisième', 'Quatrième']
const JOURS_DES_ACOMPTES = ['03-15', '06-15', '09-15', '12-15']

// Couvert : un exercice clos le 31 décembre de son année et ouvert le 1er janvier — ou le premier, ouvert en cours de route.
function exerciceCouvert(e: ExerciceALImpotSurLesSocietes): boolean {
  return e.fin === `${e.annee}-12-31` && (e.debut === `${e.annee}-01-01` || (e.premierExercice && e.debut < e.fin))
}

function avecLeJour(condition: string, date: string): { condition: string; jourNonOuvre: boolean } {
  if (estOuvre(date)) return { condition, jourNonOuvre: false }
  return { condition: `${condition} Le ${jourDit(date)} n’est pas un jour ouvré. ${AVIS_JOUR_NON_OUVRE_IS}`, jourNonOuvre: true }
}

function montantsDesAcomptes(e: ExerciceALImpotSurLesSocietes): MontantDeLEcheanceIs[] {
  if (e.acomptes.lecture !== 'entiere') return JOURS_DES_ACOMPTES.map(() => ({ etat: 'sans-montant', raison: MOTIF_LECTURE_INCOMPLETE }))
  const calcul = acomptesDeLExercice({ ...e.acomptes.entrees, annee: e.annee, premierExercice: e.premierExercice })
  if ('refus' in calcul) return JOURS_DES_ACOMPTES.map(() => ({ etat: 'sans-montant', raison: calcul.refus }))
  return calcul.acomptes.map((a): MontantDeLEcheanceIs => {
    if (a.etat === 'du') {
      return a.montant > 0
        ? { etat: 'du', centimes: a.montant }
        : { etat: 'rien-a-payer', excedent: 0, raison: 'Le premier acompte couvre déjà la moitié de l’impôt de référence : rien à ce deuxième acompte (CGI art. 1668, 1).' }
    }
    if (a.etat === 'non-calculable') return { etat: 'sans-montant', raison: a.raison }
    return { etat: 'rien-a-payer', excedent: 0, raison: a.raison }
  })
}

function acomptesAuCalendrier(e: ExerciceALImpotSurLesSocietes): EcheanceDeLImpot[] {
  const confirmer = e.fin >= PREMIERE_CLOTURE_A_CONFIRMER ? BAREME_A_CONFIRMER : ''
  return montantsDesAcomptes(e).map((m, i) => {
    const date = `${e.annee}-${JOURS_DES_ACOMPTES[i]}`
    const base = m.etat === 'du' ? `Calculé sur l’impôt de référence (CGI art. 1668 ; ann. III art. 359).${confirmer}`
      : m.etat === 'sans-montant' ? `${m.raison}${confirmer}` : m.raison
    const { condition, jourNonOuvre } = avecLeJour(base, date)
    return {
      id: `is-acompte-${i + 1}-${e.annee}`, date, impot: 'IS', formulaire: '2571', numero: (i + 1) as 1 | 2 | 3 | 4,
      exercice: e.annee, montant: m, jourNonOuvre,
      libelle: `${ORDINAUX[i]} acompte d’impôt sur les sociétés ${e.annee} (relevé 2571-SD)`, condition,
    }
  })
}

function montantDuSolde(e: ExerciceALImpotSurLesSocietes): MontantDeLEcheanceIs {
  if (e.impot.lecture === 'a-venir') return { etat: 'sans-montant', raison: 'Le solde se calcule sur la liasse de l’exercice, pas encore établie.' }
  if (e.impot.lecture !== 'entiere') return { etat: 'sans-montant', raison: MOTIF_LECTURE_INCOMPLETE }
  if (e.impot.entrees.debut !== e.debut || e.impot.entrees.fin !== e.fin) {
    return { etat: 'sans-montant', raison: 'Le calcul reçu n’est pas celui de cet exercice : le montant ne se dit pas.' }
  }
  const calcul = calculerImpotSurLesSocietes(e.impot.entrees)
  if ('refus' in calcul) return { etat: 'sans-montant', raison: calcul.refus.join(' ') }
  const { solde, contributionSociale } = calcul.impot
  if (contributionSociale.etat === 'non-calculee') {
    return { etat: 'sans-montant', raison: `${contributionSociale.raison} Le solde ne se dit pas sans elle.` }
  }
  if (solde > 0) return { etat: 'du', centimes: solde }
  if (solde === 0) return { etat: 'rien-a-payer', excedent: 0, raison: 'Les acomptes versés couvrent l’impôt : rien à payer au solde.' }
  return {
    etat: 'rien-a-payer', excedent: -solde,
    raison: 'Les acomptes versés dépassent l’impôt : l’excédent se restitue dans les trente jours (CGI art. 1668, 2).',
  }
}

function soldeAuCalendrier(e: ExerciceALImpotSurLesSocietes): EcheanceDeLImpot {
  // Couvert, l'exercice se clôt au 31 décembre : son solde a une date.
  const date = echeanceDuSolde(e.fin) as string
  const m = montantDuSolde(e)
  const base = m.etat === 'du' ? 'L’impôt de l’exercice, moins les acomptes versés (CGI art. 1668, 2).' : m.raison
  const { condition, jourNonOuvre } = avecLeJour(base, date)
  return {
    id: `is-solde-${e.annee + 1}`, date, impot: 'IS', formulaire: '2572', numero: null, exercice: e.annee, montant: m,
    jourNonOuvre, libelle: `Solde de l’impôt sur les sociétés de l’exercice ${e.annee} (relevé 2572-SD)`, condition,
  }
}

interface AvisDuCalendrier {
  texte: string
  // Les dates que l'avis tait : il ne se dit que si l'une tombe dans la fenêtre.
  dates: string[]
}

function calendrierDeLAnnee(annee: number, impot: ImpotDuDossier): { echeances: EcheanceDeLImpot[]; avis: AvisDuCalendrier[] } {
  if (impot.regime === 'sans-impot-sur-les-societes') return { echeances: [], avis: [] }
  const echeances: EcheanceDeLImpot[] = []
  const avis: AvisDuCalendrier[] = []
  // Le solde de l'exercice précédent (15 mai), puis les acomptes de l'exercice de l'année.
  for (const [a, quoi] of [[annee - 1, 'solde'], [annee, 'acomptes']] as const) {
    const dates = quoi === 'solde' ? [`${annee}-05-15`] : JOURS_DES_ACOMPTES.map((md) => `${annee}-${md}`)
    const e = impot.exercices.find((x) => x.annee === a)
    if (!e) {
      avis.push({
        dates,
        texte: quoi === 'solde'
          ? `Le régime d’imposition de l’exercice ${a} n’est pas dit : le solde de son impôt sur les sociétés ne figure pas ici.`
          : `Le régime d’imposition de l’exercice ${a} n’est pas dit : ses acomptes d’impôt sur les sociétés ne figurent pas ici.`,
      })
    } else if (e.imposition === 'is') {
      if (!exerciceCouvert(e)) {
        avis.push({
          dates,
          texte: `L’exercice ${a} (du ${e.debut} au ${e.fin}) n’est pas l’année civile : ses échéances d’impôt sur les sociétés ne se `
            + 'calculent pas encore ici (exercices décalés, ligne 42).',
        })
      } else if (quoi === 'solde') {
        echeances.push(soldeAuCalendrier(e))
      } else {
        echeances.push(...acomptesAuCalendrier(e))
      }
    }
  }
  return { echeances, avis }
}

export interface CalendrierDeLImpot {
  echeances: EcheanceDeLImpot[]
  // Ce que le calendrier ne couvre pas, dit au lieu d'être deviné.
  avis: string[]
}

// Les échéances d'IS d'une année civile : le solde de l'exercice `annee - 1` (15 mai), les acomptes de l'exercice `annee`.
export function echeancesDeLImpotSurLesSocietes(annee: number, impot: ImpotDuDossier): CalendrierDeLImpot {
  const c = calendrierDeLAnnee(annee, impot)
  return { echeances: c.echeances, avis: c.avis.map((a) => a.texte) }
}

export interface CalendrierDuDossier {
  echeances: (EcheanceFiscale | EcheanceDeLImpot)[]
  avis: string[]
}

// Les douze mois à venir d'un dossier : le calendrier d'hier, plus l'IS quand le drapeau est levé et que le dossier le
// paie. Drapeau baissé ou dossier sans IS : exactement `prochainesEcheances(aujourdHui)`, sans avis.
export function prochainesEcheancesDuDossier(
  aujourdHui: string, impot: ImpotDuDossier, exporte: boolean = CALENDRIER_IS_EXPORTE,
): CalendrierDuDossier {
  const communes = prochainesEcheances(aujourdHui)
  if (!exporte || impot.regime === 'sans-impot-sur-les-societes') return { echeances: communes, avis: [] }
  const annee = Number(aujourdHui.slice(0, 4))
  const limite = ajouterJours(aujourdHui, 365)
  const dansLaFenetre = (date: string) => date >= aujourdHui && date < limite
  const echeances: EcheanceDeLImpot[] = []
  const avis: string[] = []
  for (const a of [annee, annee + 1]) {
    const c = calendrierDeLAnnee(a, impot)
    echeances.push(...c.echeances.filter((e) => dansLaFenetre(e.date)))
    for (const x of c.avis) if (x.dates.some(dansLaFenetre) && !avis.includes(x.texte)) avis.push(x.texte)
  }
  return {
    echeances: [...communes, ...echeances].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)),
    avis,
  }
}

/**
 * La règle que la Checklist du cabinet et « Mon échéancier » du client se partagent : la 2035 n'est pas la liasse d'un
 * dossier tenu en engagement (BIC, IS), son échéance n'y figure pas ; celles de la CFE, de la CVAE et de l'IS si. Le mode
 * est obligatoire : un mode qu'on n'a pas lu ne passe pas par ici (voir `echeancierClient.ts`).
 */
export function echeanceDuModeComptable(e: Pick<EcheanceFiscale, 'impot'>, mode: ModeComptable): boolean {
  return mode !== 'engagement' || e.impot !== 'Liasse'
}
