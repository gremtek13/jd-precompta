import { SEUIL_ANNEXE_2035E, SEUIL_CVAE_A_PAYER } from './declaration2035E'
import { ajouterJours } from './format'

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

export type Impot = 'CFE' | 'CVAE' | 'Liasse'

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
const SEUIL_ACOMPTE_CFE = 3_000
const SEUIL_ACOMPTES_CVAE = 1_500

// Un montant ne se coupe pas en fin de ligne — la Checklist se lit aussi sur téléphone : espace fine insécable entre les
// milliers, insécable avant l'euro, comme `formatMoney`.
function euros(montant: number): string {
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
