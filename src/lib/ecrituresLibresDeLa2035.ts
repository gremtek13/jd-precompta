// L'ÉCRITURE LIBRE DANS LES MOTEURS (EL4 ; conception docs/conceptions/54-ecriture-libre-de-l-expert-comptable.md, § 5.1 à
// § 5.4). Pur, sans réseau et sans import de `supabase.ts` : ce que la 2035 (lib/declaration2035.ts), la concordance
// (lib/concordance2035.ts), la situation intermédiaire (lib/situationIntermediaire.ts) et l'estimation (lib/estimation.ts)
// lisent d'une écriture libre. La CA3 n'en lit RIEN (§ 5.4 : elle se calcule des sources, l'exigibilité à l'encaissement ou au
// paiement) — `ecrituresLibresHorsDeLaCa3.test.ts` le garde.
//
// Les écritures arrivent telles qu'EL3 les a typées (`EcrituresLibresDesExports`, sans le motif), LUES EN ENTIER, ou absentes :
// le drapeau `ECRITURES_LIBRES_PREVUES` baissé, la table n'est pas en base, et chaque moteur rend, au caractère près, ce qu'il
// rendait hier.
//
// LA RÈGLE D'UNE LIGNE (§ 5.1, EL-Q2 (A)) : en trésorerie, une ligne de classe 6 ou 7 porte le poste de la 2035 sous lequel elle
// compte, ou nul — « hors de la 2035 ». Le poste vient de la SAISIE de l'expert, jamais d'une catégorie (le poste proposé n'est
// qu'une proposition de l'écran, EL5) ; la base l'a jugé contre la liste fermée de sa classe et le refuse en engagement. Une
// ligne de bilan ne touche pas le résultat : elle n'entre nulle part ici.
//
// LE SIGNE est celui que la 2035 compte : une dépense au débit d'un 6, une recette au crédit d'un 7, en positif ; au sens
// inverse, la ligne diminue son poste (une correction). L'EXTOURNE du 1er janvier qui suit (§ 5.1, EL-Q3 (A)) porte chaque ligne
// au sens inverse, à sa date, dans l'exercice suivant : elle compte, ou reste hors de la 2035, comme la ligne qu'elle extourne —
// sans quoi la 2035 de l'année suivante compterait deux fois ce qu'elle reprend. Depuis EXP58-Q3 (A), une charge ou un produit
// RATTACHÉ ne se compte plus (la base le refuse, `estRattacheeComptee`) : son extourne reste donc hors de la 2035 avec lui.
import { classeDeResultat } from './ecritureLibre'
import { referenceDeLEcritureLibre, type EcritureLibreDesExports, type EcrituresLibresDesExports } from './ecrituresLibresDesExports'

/** Une ligne de résultat d'une écriture libre, à sa date : la constatation, ou son extourne au 1er janvier suivant. */
export interface LigneDeResultatLibre {
  ecriture: EcritureLibreDesExports
  extourne: boolean
  date: string
  compte: string
  nature: 'recette' | 'depense'
  // Le poste de la 2035 saisi, ou nul : hors de la 2035.
  poste: string | null
  // En centimes, signé comme la ligne agit sur son poste (voir l'en-tête).
  centimes: number
}

/** Le 1er janvier qui suit la date d'une écriture (l'extourne n'existe que derrière un 31 décembre, la base l'impose). */
export function dateDeLExtourne(date: string): string {
  return `${Number(date.slice(0, 4)) + 1}-01-01`
}

/**
 * Les lignes de résultat des écritures libres lues, constatations et extournes, dans l'ordre des écritures (exercice, numéro)
 * puis de leurs lignes ; aucune quand elles sont absentes.
 */
export function lignesDeResultatLibres(e: EcrituresLibresDesExports): LigneDeResultatLibre[] {
  if (e.etat !== 'lues') return []
  const ordonnees = [...e.ecritures].sort((a, b) => a.exercice - b.exercice || a.numero - b.numero || a.id.localeCompare(b.id))
  const lignes: LigneDeResultatLibre[] = []
  for (const ecriture of ordonnees) {
    for (const extourne of ecriture.avec_extourne ? [false, true] : [false]) {
      for (const l of ecriture.lignes) {
        const classe = classeDeResultat(l.compte)
        if (classe === null) continue
        const nature = classe === 7 ? 'recette' : 'depense'
        // Une dépense au débit, une recette au crédit : positive ; l'extourne retourne le sens.
        const dansSonSens = nature === 'depense' ? l.sens === 'debit' : l.sens === 'credit'
        const positif = extourne ? !dansSonSens : dansSonSens
        lignes.push({
          ecriture, extourne, date: extourne ? dateDeLExtourne(ecriture.date) : ecriture.date, compte: l.compte, nature,
          poste: l.poste_2035, centimes: positif ? l.centimes : -l.centimes,
        })
      }
    }
  }
  return lignes
}

/** Les lignes de résultat d'une période (bornes comprises). */
export function lignesDeResultatLibresDeLaPeriode(e: EcrituresLibresDesExports, debut: string, fin: string): LigneDeResultatLibre[] {
  return lignesDeResultatLibres(e).filter((l) => l.date >= debut && l.date <= fin)
}

/**
 * Les recettes que les écritures libres COMPTENT dans une période, en centimes signés : les lignes de classe 7 sous un poste de
 * la 2035 — ce que l'estimation ajoute au chiffre d'affaires, comme elle y ajoute les recettes affectées du relevé. Une ligne
 * hors de la 2035 n'y entre pas : l'expert l'a sortie de la déclaration, elle sort de ce qui s'en estime.
 */
export function recettesComptees(e: EcrituresLibresDesExports, debut: string, fin: string): number {
  return lignesDeResultatLibresDeLaPeriode(e, debut, fin)
    .filter((l) => l.nature === 'recette' && l.poste !== null)
    .reduce((s, l) => s + l.centimes, 0)
}

/** Le nom d'une écriture libre tel que la carte de la concordance le dit : sa référence et son libellé, l'extourne nommée. */
export function nomDeLEcritureLibre(l: Pick<LigneDeResultatLibre, 'ecriture' | 'extourne'>): string {
  return `Écriture libre ${referenceDeLEcritureLibre(l.ecriture)}${l.extourne ? ' (extourne)' : ''} — ${l.ecriture.libelle}`
}

// LE DÉFAUT DU CÔTÉ FERMÉ que la 2035, la situation intermédiaire, l'estimation, la revue analytique et l'alerte du chiffre
// d'affaires donnaient aux écritures libres (EL4 : l'absence drapeau baissé, un refus à l'exécution levé) n'existe plus depuis
// EL8 (22/11/2026) : le paramètre est OBLIGATOIRE, comme toutes leurs autres sources — un appel qui l'omet ne compile pas
// (ecrituresLibresDeLa2035.test.ts le garde par `@ts-expect-error`), et chaque appel, de l'application comme des tests et de
// leurs fabriques, dit ce qu'il passe : la lecture (EL5), ou l'absence (`ECRITURES_LIBRES_ABSENTES`). Un refus à l'exécution
// ne se serait vu qu'en appelant, le jour du drapeau levé ; le compilateur le voit avant.
