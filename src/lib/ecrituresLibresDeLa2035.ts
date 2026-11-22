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
import { ECRITURES_LIBRES_PREVUES, classeDeResultat } from './ecritureLibre'
import {
  ECRITURES_LIBRES_ABSENTES, referenceDeLEcritureLibre, type EcritureLibreDesExports, type EcrituresLibresDesExports,
} from './ecrituresLibresDesExports'

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

/**
 * LE DÉFAUT DU CÔTÉ FERMÉ des moteurs qui reçoivent les écritures libres en dernier paramètre (la 2035, la situation
 * intermédiaire, l'estimation : plus de cent appels, la plupart dans les tests). Drapeau baissé, la table n'est pas en base :
 * l'absence est la vérité, et chaque moteur rend ce qu'il rendait hier. Drapeau levé (EL8), un appel qui les omet LÈVE : une
 * 2035 calculée sans les écritures de l'expert serait plausible et fausse, et rien ne le dirait. Aucun appelant de l'application
 * ne passe donc l'absence à la main : ils s'en remettent à ce défaut, qui lèvera chez celui que la lecture d'EL5 n'aura pas
 * rejoint ; les tests qui les omettent se rangent à EL8 (ecrituresLibresDeLa2035.test.ts joue les deux états).
 */
export function ecrituresLibresParDefaut(prevues: boolean = ECRITURES_LIBRES_PREVUES): EcrituresLibresDesExports {
  if (prevues) {
    throw new Error('Les écritures libres du dossier ne sont pas passées au calcul : la 2035 et ce qui s’en estime ne se calculent pas sans elles.')
  }
  return ECRITURES_LIBRES_ABSENTES
}
