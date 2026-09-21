import { supabase } from './supabase'
import { convertirMontants, deviseDuTexte, DEVISE_PIVOT, tauxApplicable, type Cotation } from './devises'
import { aujourdHuiSql } from './format'

// Accès aux taux de change : lecture du cache local (`taux_change_bce`), et appel à la BCE quand la
// date demandée n'y est pas encore. Séparé de lib/devises.ts, qui ne fait que du calcul et ne connaît
// ni la base ni le réseau — c'est ce qui rend la règle de conversion testable sans rien simuler.

// Le même recul que la fonction d'alimentation (voir supabase/functions/taux-change-bce) : la BCE ne
// cote ni les week-ends ni les jours fériés TARGET, donc chercher la cotation d'une date isolée
// reviendrait à conclure « pas de taux » un samedi sur deux. Dix jours couvrent le plus long trou de
// l'année, autour du 1er janvier.
const JOURS_DE_RECUL = 10

function dateMoinsJours(date: string, jours: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - jours)
  return d.toISOString().slice(0, 10)
}

async function lireCache(devise: string, date: string): Promise<Cotation[]> {
  const { data, error } = await supabase
    .from('taux_change_bce')
    .select('date, taux')
    .eq('devise', devise)
    .gte('date', dateMoinsJours(date, JOURS_DE_RECUL))
    .lte('date', date)
  // Lève plutôt que de rendre un tableau vide : un cache illisible est indiscernable d'un cache vide,
  // et la différence compte — le premier doit remonter comme une panne, le second déclenche seulement
  // un appel à la BCE. Confondre les deux ferait interroger la BCE à chaque pièce, en silence.
  if (error) throw new Error(`Taux de change illisibles : ${error.message}`)
  return (data ?? []) as Cotation[]
}

export interface TauxTrouve {
  taux: number
  /** Date de la cotation retenue — pas forcément celle de la pièce : week-ends et jours fériés. */
  date: string
}

// Rend le taux BCE applicable à une pièce : nombre d'unités de `devise` pour 1 EUR.
//
// Le cache d'abord, la BCE seulement s'il ne suffit pas. Un taux déjà publié ne change jamais, donc
// une cotation en base n'a aucune raison d'être redemandée — et la BCE n'a pas à être appelée une
// fois par pièce d'un lot de factures du même mois.
//
// Rend null plutôt que de lever quand la BCE ne répond pas ou ne cote pas la devise : l'appelant doit
// pouvoir enregistrer la pièce sans conversion et la laisser signalée (voir lib/controles.ts), plutôt
// que de perdre le dépôt. Une pièce non convertie se corrige ; une pièce refusée est perdue.
export async function tauxBce(devise: string, date: string): Promise<TauxTrouve | null> {
  if (devise === DEVISE_PIVOT) return null

  const enCache = tauxApplicable(await lireCache(devise, date), date)
  if (enCache) return { taux: enCache.taux, date: enCache.date }

  const { data, error } = await supabase.functions.invoke('taux-change-bce', {
    body: { devise, date },
  })
  if (error || !data || typeof data.taux !== 'number' || typeof data.date_du_taux !== 'string') {
    console.error('Taux BCE indisponible', { devise, date, error, data })
    return null
  }
  return { taux: data.taux, date: data.date_du_taux }
}

export interface MontantsPourPiece {
  montant_ht: number | null
  montant_tva: number | null
  montant_ttc: number | null
  devise: string
  montant_devise: number | null
  taux_change: number | null
  conversion_source: 'bce' | 'banque' | null
}

interface MontantsLus {
  montant_ht?: number | null
  montant_tva?: number | null
  montant_ttc?: number | null
  // Le texte lu sur le document. La devise s'y lit ici plutôt que d'être rendue par l'Edge Function
  // d'extraction : celle-ci est auto-portée et ne peut rien importer de src/, donc y mettre la règle
  // en ferait une DEUXIÈME copie à tenir synchronisée — le défaut qui a déjà coûté une régression sur
  // l'aiguillage des pièces. Le texte OCR arrive déjà jusqu'ici ; la règle reste donc à un seul
  // endroit, testé (voir lib/devises.ts).
  texte_ocr?: string | null
}

// Prépare les champs monétaires d'une pièce à partir de ce que l'extraction a lu : convertit en euros
// si le document est en devise étrangère, et conserve de quoi justifier la conversion.
//
// Partagé par les deux pipelines de dépôt (lib/depot.ts côté client, lib/importFichiers.ts côté
// cabinet) plutôt que dupliqué : c'est déjà la troisième copie d'une règle de dépôt qui a laissé
// passer une régression (voir orientationDe dans lib/extraction.ts), et une conversion qui ne
// s'applique qu'à la moitié des chemins d'entrée est pire que pas de conversion du tout.
//
// Quand le taux est introuvable — BCE injoignable, devise qu'elle ne cote pas — les montants en euros
// restent NULS, et seul le montant d'origine est conservé. Y écrire les montants étrangers tels quels
// mettrait des dollars dans une comptabilité en euros, sans rien pour les distinguer ; les laisser
// nuls rend la pièce visiblement incomplète, impossible à valider (le TTC est obligatoire) et
// signalée par le contrôle dédié (voir lib/controles.ts).
export async function montantsPourPiece(lus: MontantsLus, datePiece: string | null): Promise<MontantsPourPiece> {
  const devise = (deviseDuTexte(lus.texte_ocr) ?? DEVISE_PIVOT).toUpperCase()
  const montants = {
    montant_ht: lus.montant_ht ?? null,
    montant_tva: lus.montant_tva ?? null,
    montant_ttc: lus.montant_ttc ?? null,
  }

  if (devise === DEVISE_PIVOT || !/^[A-Z]{3}$/.test(devise)) {
    return { ...montants, devise: DEVISE_PIVOT, montant_devise: null, taux_change: null, conversion_source: null }
  }

  // Sans date lue sur le document, le taux du jour : c'est la meilleure approximation disponible, et
  // elle vaut mieux qu'une pièce laissée non convertie. La date sera corrigée à l'arbitrage, et la
  // conversion avec elle.
  //
  // « Aujourd'hui » au calendrier civil (`aujourdHuiSql`), jamais `toISOString().slice(0, 10)` qui
  // rend la date UTC : entre minuit et 2 h du matin à Paris, l'instant est encore hier en UTC, et la
  // pièce serait alors convertie au taux de la VEILLE. Le défaut est bien plus large qu'une fenêtre
  // de deux heures pour qui travaille à l'est de Greenwich — à Auckland, la date UTC est en retard
  // d'un jour pendant toute la matinée.
  const date = datePiece ?? aujourdHuiSql()
  const trouve = await tauxBce(devise, date)
  if (!trouve) {
    return {
      montant_ht: null, montant_tva: null, montant_ttc: null,
      devise, montant_devise: montants.montant_ttc, taux_change: null, conversion_source: null,
    }
  }

  return {
    ...convertirMontants(montants, trouve.taux),
    devise,
    montant_devise: montants.montant_ttc,
    taux_change: trouve.taux,
    // Provisoire, et marqué comme tel : le taux de référence ignore le spread que la banque
    // appliquera. Le montant définitif viendra du mouvement bancaire (voir lib/reglementDevise.ts).
    conversion_source: 'bce',
  }
}
