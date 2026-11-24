// LA CONTRE-PASSATION D'UNE ÉCRITURE LIBRE, À L'ÉCRAN (EL7 ; conception 54, § 3.7, § 6). Pur, sans réseau : ce que la section
// « Écritures de l'expert-comptable » de l'onglet Écritures dit d'une contre-passation — la mention d'une écriture contre-passée ou
// qui contre-passe, la confirmation qui NOMME ce qui part (chaque ligne au sens inverse, les totaux, l'effet sur la 2035 de
// l'exercice ouvert, la 2035 validée qui ne change pas, le motif), et celle du retrait d'une contre-passation. Les règles et les
// mots de la base : lib/contrePassationDesEcrituresLibres.ts.
import { classeDeResultat, type ModeComptableDeLEcriture, type SaisieDEcritureLibre } from './ecritureLibre'
import { referenceDeLEcritureLibre, type EcritureLibreDesExports } from './ecrituresLibresDesExports'
import { confirmationDuRetrait, effetSurLa2035, equilibreDeLaSaisie, euros } from './ecrituresLibresVue'
import {
  contrePassationDe, lignesDeLaContrePassation, origineDe, type EcritureContrePassable, type SaisieDeContrePassation,
} from './contrePassationDesEcrituresLibres'

const dateCourte = (date: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}` : date

/** La contre-passation telle qu'une écriture libre la dirait : ses lignes au sens inverse, ses postes ou aucun — pour les totaux
 *  et l'effet sur la 2035 que l'écran calcule déjà d'une saisie (lib/ecrituresLibresVue.ts). */
export function saisieDeLaContrePassation(e: EcritureContrePassable, saisie: SaisieDeContrePassation): SaisieDEcritureLibre {
  return {
    date: saisie.date, libelle: saisie.libelle, motif: saisie.motif, avecExtourne: false,
    lignes: lignesDeLaContrePassation(e, saisie.horsDeLa2035).map((l) => ({
      compte: l.compte, sens: l.sens, centimes: l.centimes, poste2035: l.poste_2035, compteLib: l.compte_lib,
    })),
  }
}

/** Ce que la liste dit d'une écriture sous le drapeau levé : la contre-passation qu'elle est, celle qui la contre-passe, ou rien. */
export function mentionDeLaContrePassation(
  e: EcritureContrePassable, toutes: readonly EcritureContrePassable[],
): string | null {
  const mentions: string[] = []
  if ((e.contre_passe_id ?? null) !== null) {
    const o = origineDe(e, toutes)
    mentions.push(o === null ? 'Contre-passe une écriture libre qui n’est pas dans la lecture.'
      : `Contre-passe ${referenceDeLEcritureLibre(o)} du ${dateCourte(o.date)}.`)
  }
  const c = contrePassationDe(e, toutes)
  if (c !== null) mentions.push(`Contre-passée par ${referenceDeLEcritureLibre(c)} du ${dateCourte(c.date)}.`)
  return mentions.length === 0 ? null : mentions.join(' ')
}

/**
 * La confirmation, qui NOMME ce qui part : l'écriture contre-passée, l'écriture neuve (sa date, son journal, son libellé), chaque
 * ligne au sens inverse et son effet sur la 2035, les totaux, l'effet sur la 2035 de l'exercice de la contre-passation, la 2035
 * validée qui ne change pas, le motif, et ce qu'une contre-passation devient ensuite.
 */
export function confirmationDeLaContrePassation(
  e: EcritureContrePassable, saisie: SaisieDeContrePassation, mode: ModeComptableDeLEcriture,
): string {
  const s = saisieDeLaContrePassation(e, saisie)
  const { debit, credit } = equilibreDeLaSaisie(s)
  const lignes = s.lignes.map((l) => {
    const effet = mode !== 'tresorerie' || classeDeResultat(l.compte) === null ? '' : ` — 2035 : ${l.poste2035 ?? 'hors de la 2035'}`
    return `• ${l.compte}${l.compteLib ? ` ${l.compteLib.trim()}` : ''} : ${l.sens === 'debit' ? 'débit' : 'crédit'} ${euros(l.centimes)}${effet}`
  })
  const annee = saisie.date.slice(0, 4)
  const x = effetSurLa2035(s, mode)
  const effet = mode !== 'tresorerie' ? 'En comptabilité d’engagement, aucune 2035 : la contre-passation change les comptes seuls.'
    : `Effet sur la 2035 de ${annee} : dépenses ${euros(x.depensesComptees)}, recettes ${euros(x.recettesComptees)}`
      + (x.depensesHors !== 0 || x.recettesHors !== 0
        ? ` ; hors de la 2035, un écart déclaré de ${euros(x.depensesHors)} de dépenses et ${euros(x.recettesHors)} de recettes.`
        : '.')
  return [
    `Contre-passer l’écriture libre ${referenceDeLEcritureLibre(e)} du ${dateCourte(e.date)} : « ${e.libelle} » ?`,
    `Une écriture libre neuve, du ${dateCourte(saisie.date)}, au journal OD : « ${saisie.libelle.trim()} », porte ses lignes au sens inverse :`,
    ...lignes,
    `Total : débit ${euros(debit)}, crédit ${euros(credit)}.`,
    effet,
    ...(mode === 'tresorerie'
      ? [`La 2035 de ${e.exercice}, validée, ne change pas : si elle était fausse, elle se rectifie à part (l’opération découverte après coup).`]
      : []),
    `Motif : ${saisie.motif.trim()}`,
    'Une contre-passation ne se modifie pas : tant que son exercice est ouvert, elle se retire ; figée, elle se contre-passe à son tour.',
  ].join('\n')
}

/** La confirmation du retrait d'une contre-passation : celle de tout retrait, et l'écriture qu'elle contre-passe, qui redevient à
 *  contre-passer. */
export function confirmationDuRetraitDUneContrePassation(
  c: EcritureLibreDesExports & { contre_passe_id?: string | null }, toutes: readonly EcritureContrePassable[],
): string {
  const o = origineDe(c, toutes)
  return `${confirmationDuRetrait(c)} ${o === null ? 'L’écriture qu’elle contre-passe redevient à contre-passer.'
    : `L’écriture ${referenceDeLEcritureLibre(o)} qu’elle contre-passe redevient à contre-passer.`}`
}
