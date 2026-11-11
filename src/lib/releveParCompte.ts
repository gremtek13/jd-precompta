import { compteDeBanqueDuMouvement } from './comptesBancaires'
import type { CompteDuReleve, LectureDesComptes } from './importParCompte'
import { premierReleveDeLaTenue, relevesAuTrenteEtUn, type RelevesAuTrenteEtUn, type SoldeDuReleve } from './releveAuTrenteEtUn'
import type { ExerciceAReclamer } from './resteAEnvoyer'
import { jonctionsDesReleves, type JonctionDesReleves, type MouvementDuReleve, type ReleveControle } from './suiteDesReleves'
import type { ControleReleveBancaire, LigneBancaire } from './types'

// LE RELEVÉ JUGÉ COMPTE PAR COMPTE (ligne 26.6, lot MCB4 ; MCB-Q1 à Q8, tranchées le 11/11/2026). Le récit : HISTORIQUE.md,
// « 11/11/2026 — LA SUITE DES SOLDES, LE 31 DÉCEMBRE, LA COUVERTURE ET LA VALIDATION PAR COMPTE BANCAIRE (MCB4) ». Un module
// PUR : il partage le relevé d'un dossier (ses mouvements et les contrôles de ses fichiers) entre ses comptes bancaires, et
// rejoue sur chaque part les règles écrites pour un seul compte — la suite des soldes (lib/suiteDesReleves.ts), le solde au
// 31 décembre (lib/releveAuTrenteEtUn.ts), le premier relevé de la tenue, les mois que le relevé couvre. Deux comptes ne
// se mêlent plus : le relevé de l'un ne « suit » plus celui de l'autre, deux relevés au 31 décembre de deux comptes ne sont
// plus « des soldes différents », un mois de l'un ne couvre plus le trou de l'autre.
//
// Derrière `COMPTES_BANCAIRES_PREVUS` (lib/comptesBancaires.ts), baissé : l'écran passe la lecture des comptes `sans_objet`,
// le relevé est UNE part, sans compte ni nom, et tout se calcule comme avant MCB, au caractère près. Un dossier qui ne tient
// qu'un compte aussi : sa part n'est jamais nommée. Le nom d'un compte (son libellé) ne se dit que dès deux comptes.

type AvecCompte = { compte_bancaire_id?: string | null }

/** Une part du relevé : les mouvements et les contrôles d'un compte bancaire, ou de tout le dossier (`compte` nul). */
export interface PartDuReleve<L extends AvecCompte, C extends AvecCompte> {
  /** Nul quand le drapeau est baissé, ou que le dossier ne tient encore aucun compte : tout le relevé, comme avant MCB. */
  compte: CompteDuReleve | null
  /** Le libellé à dire dans une phrase, dès deux comptes ; nul sinon — rien ne change pour un dossier à un compte. */
  nom: string | null
  lignes: L[]
  controles: C[]
}

/** Le relevé partagé entre les comptes, ou retenu : les comptes ne sont pas lus en entier, ou ne disent pas d'où vient une
 *  ligne — rien ne se juge alors par compte, et l'appelant se tait ou suspend ce qu'il commande. */
export type ReleveParCompte<L extends AvecCompte, C extends AvecCompte> =
  | { etat: 'parts'; parts: PartDuReleve<L, C>[] }
  | { etat: 'retenu'; raison: string }

/** « du compte « Livret » » : la mention d'une part nommée, vide pour une part qui ne l'est pas. */
export function duCompte(nom: string | null): string {
  return nom === null ? '' : ` du compte « ${nom} »`
}

/**
 * Le relevé partagé entre les comptes du dossier. `sans_objet` (le drapeau baissé) : une part, tout le relevé. Lus : une part
 * par compte, dans l'ordre de la lecture (le principal d'abord) ; un seul compte reçoit toutes les lignes (la base n'en
 * accepte pas d'autre), deux ou plus reçoivent chacun les leurs, et une ligne d'un compte que la lecture n'a pas rendu
 * — ou qui ne dit pas le sien — retient tout. En cours ou illisible : retenu.
 */
export function releveParCompte<L extends AvecCompte, C extends AvecCompte>(
  lecture: LectureDesComptes,
  lignes: readonly L[],
  controles: readonly C[],
): ReleveParCompte<L, C> {
  if (lecture.etat === 'sans_objet') return { etat: 'parts', parts: [{ compte: null, nom: null, lignes: [...lignes], controles: [...controles] }] }
  if (lecture.etat === 'en_cours') return { etat: 'retenu', raison: 'les comptes bancaires du dossier sont en cours de lecture' }
  if (lecture.etat === 'illisible') return { etat: 'retenu', raison: `les comptes bancaires du dossier n’ont pas été lus en entier (${lecture.motif})` }
  const { comptes } = lecture
  const connus = new Set(comptes.map((c) => c.id))
  const etranger = [...lignes, ...controles].find((l) => (l.compte_bancaire_id == null ? comptes.length > 1 : !connus.has(l.compte_bancaire_id)))
  if (etranger !== undefined) {
    return { etat: 'retenu', raison: 'un mouvement ou un relevé est d’un compte bancaire que la lecture des comptes n’a pas rendu : recharger la page' }
  }
  if (comptes.length === 0) return { etat: 'parts', parts: [{ compte: null, nom: null, lignes: [...lignes], controles: [...controles] }] }
  if (comptes.length === 1) return { etat: 'parts', parts: [{ compte: comptes[0], nom: null, lignes: [...lignes], controles: [...controles] }] }
  return {
    etat: 'parts',
    parts: comptes.map((compte) => ({
      compte, nom: compte.libelle,
      lignes: lignes.filter((l) => l.compte_bancaire_id === compte.id),
      controles: controles.filter((k) => k.compte_bancaire_id === compte.id),
    })),
  }
}

// ── La suite des soldes, compte par compte ─────────────────────────────────────────────────────────────────────────

/** Une jonction de deux relevés d'un même compte, et le nom de ce compte (nul pour un dossier à un compte). */
export type JonctionDUnCompte = JonctionDesReleves & { nomDuCompte: string | null }

/** Les jonctions de chaque compte, compte après compte : deux relevés de deux comptes ne se suivent jamais. */
export function jonctionsParCompte<L extends MouvementDuReleve & AvecCompte, C extends ReleveControle & AvecCompte>(
  parts: readonly PartDuReleve<L, C>[],
): JonctionDUnCompte[] {
  return parts.flatMap((p) => jonctionsDesReleves(p.controles, p.lignes).map((j) => ({ ...j, nomDuCompte: p.nom })))
}

// ── Les mois que le relevé couvre ──────────────────────────────────────────────────────────────────────────────────

const moisDe = (date: string) => date.slice(0, 7)

/**
 * Le compte attend-il un relevé du mois `mois` (AAAA-MM) ? La règle de `couverture_du_releve` (supabase/preparees/,
 * migration `couverture_du_releve_par_compte`), que releveParCompte.test.ts confronte à son texte : une part sans compte et le
 * principal, de leur ouverture (toujours, sans date) à leur clôture ; un autre compte, de son ouverture — ou, sans date, de son
 * premier mouvement — à sa clôture. Un compte qu'on n'a jamais vu bouger et qui ne dit pas son ouverture n'attend rien.
 */
export function compteAttenduLeMois(part: PartDuReleve<Pick<LigneBancaire, 'date'> & AvecCompte, AvecCompte>, mois: string): boolean {
  const c = part.compte
  if (c === null) return true
  if (c.clos_le !== null && moisDe(c.clos_le) < mois) return false
  const premier = part.lignes.reduce<string | null>((m, l) => (m === null || l.date < m ? l.date : m), null)
  const depuis = c.ouvert_le ?? (c.principal ? null : premier)
  if (depuis === null) return c.principal
  return moisDe(depuis) <= mois
}

/** Les mois manquants d'un exercice, et, dès deux comptes, ceux de chaque compte nommé. */
export interface MoisManquantsDuReleve {
  /** Les mois de l'exercice (1 à 12) que le relevé du dossier ne couvre pas : aucun mouvement, ou un compte attendu sans le sien. */
  mois: number[]
  /** Pour chaque mois manquant, les comptes nommés qui l'attendent sans mouvement (vide pour un dossier à un compte). */
  comptes: ReadonlyMap<number, readonly string[]>
}

/**
 * LES MOIS MANQUANTS, COMPTE PAR COMPTE : un mois attendu de l'exercice manque quand aucun mouvement du dossier n'y tombe
 * (la règle d'hier, `moisManquantsDe`), ou qu'un compte qui l'attend n'y a aucun mouvement. Une part, sans compte ou à un
 * seul compte : exactement `moisManquantsDe`. La négation, mois par mois, de ce que `couverture_du_releve` rend au client.
 */
export function moisManquantsParCompte(
  exercice: ExerciceAReclamer,
  parts: readonly PartDuReleve<Pick<LigneBancaire, 'date'> & AvecCompte, AvecCompte>[],
): MoisManquantsDuReleve {
  const mois: number[] = []
  const comptes = new Map<number, string[]>()
  for (const m of exercice.moisAttendus) {
    const cle = `${exercice.annee}-${String(m).padStart(2, '0')}`
    const bouge = (p: (typeof parts)[number]) => p.lignes.some((l) => moisDe(l.date) === cle)
    const sansLeSien = parts.filter((p) => compteAttenduLeMois(p, cle) && !bouge(p))
    if (!parts.some(bouge) || sansLeSien.length > 0) {
      mois.push(m)
      const noms = sansLeSien.flatMap((p) => (p.nom === null ? [] : [p.nom]))
      if (noms.length > 0) comptes.set(m, noms)
    }
  }
  return { mois, comptes }
}

// ── Le premier relevé de la tenue, compte par compte ──────────────────────────────────────────────────────────────

/** Le premier relevé de la tenue de chaque compte (`premierReleveDeLaTenue`), pour les parts qui en ont un. */
export function premiersRelevesParCompte<L extends AvecCompte, C extends ControleReleveBancaire>(
  parts: readonly PartDuReleve<L, C>[],
  reprise: string | null,
): { part: PartDuReleve<L, C>; premier: C }[] {
  return parts.flatMap((part) => {
    const premier = premierReleveDeLaTenue(part.controles, reprise) as C | undefined
    return premier === undefined ? [] : [{ part, premier }]
  })
}

// ── Le solde de la banque au 31 décembre, par compte du plan ──────────────────────────────────────────────────────

/** Ce qu'un compte bancaire dit de son solde au 31 décembre. */
export type SoldeDUnCompteAuTrenteEtUn<L extends AvecCompte, C extends ControleReleveBancaire> =
  // Ses relevés qui bouclent disent tous ce solde (plusieurs relevés d'un même compte au 31 décembre ne s'additionnent pas).
  | { part: PartDuReleve<L, C>; etat: 'connu'; centimes: number; lu: Extract<SoldeDuReleve, { centimes: number }> }
  // Clos au plus tard le 31 décembre : son solde est nul, sans relevé.
  | { part: PartDuReleve<L, C>; etat: 'clos'; centimes: 0; closLe: string }
  // Ses relevés disent des soldes différents : l'un d'eux ne dit pas le bon.
  | { part: PartDuReleve<L, C>; etat: 'plusieurs'; lus: Extract<SoldeDuReleve, { centimes: number }>[] }
  // Aucun relevé ne le dit : ce que la règle a regardé, et pourquoi rien ne s'en tire.
  | { part: PartDuReleve<L, C>; etat: 'inconnu'; releves: RelevesAuTrenteEtUn }

/** Un compte du plan (un 512) et les comptes bancaires dont la banque s'y écrit dans l'exercice. */
export interface BanqueDUnCompteDuPlan<L extends AvecCompte, C extends ControleReleveBancaire> {
  compte: string
  soldes: SoldeDUnCompteAuTrenteEtUn<L, C>[]
  /** La somme des soldes au 31 décembre, quand chaque compte dit le sien ; nulle sinon. */
  centimes: number | null
}

/** Le compte bancaire prend-il part à l'exercice ? Une part sans compte et le principal toujours, sauf clos avant l'exercice
 *  ou ouvert après ; un autre compte s'il s'ouvre au plus tard le 31 décembre, ou que l'un de ses mouvements ou de ses
 *  relevés y commence au plus tard — un compte dont rien ne touche l'exercice n'y a pas de banque. */
export function tenuDansLExercice(part: PartDuReleve<Pick<LigneBancaire, 'date'> & AvecCompte, Pick<ControleReleveBancaire, 'periode_debut'> & AvecCompte>, annee: number): boolean {
  const c = part.compte
  if (c === null) return true
  const debut = `${annee}-01-01`
  const fin = `${annee}-12-31`
  if (c.clos_le !== null && c.clos_le < debut) return false
  if (c.ouvert_le !== null) return c.ouvert_le <= fin
  return c.principal || part.lignes.some((l) => l.date <= fin) || part.controles.some((k) => k.periode_debut !== null && k.periode_debut <= fin)
}

/**
 * LE 512 DE CHAQUE COMPTE BANCAIRE, ET CE QUE SES RELEVÉS EN DISENT AU 31 DÉCEMBRE (MCB-Q7). Le compte du plan où s'écrit la
 * banque d'un compte bancaire dans l'exercice se lit comme la base le lit pour un mouvement (`compte_de_banque_du_mouvement`,
 * migration `comptes_bancaires`) : `compteDeBanqueDuMouvement(compte, '<annee>-12-31', compteDuRoleBanque)` — le principal et
 * un autre compte avant son 1er janvier au compte du rôle `banque`, un autre compte depuis ce jour au sien. Sa date de départ
 * étant un 1er janvier, tout l'exercice s'écrit au même 512. Les comptes qui partagent un 512 s'additionnent ; chacun dit son
 * solde par ses seuls relevés (lib/releveAuTrenteEtUn.ts) ; un compte clos dans l'exercice compte pour zéro.
 */
export function banquesAuTrenteEtUn<L extends Pick<LigneBancaire, 'source_fichier' | 'montant' | 'date'> & AvecCompte, C extends ControleReleveBancaire>(
  parts: readonly PartDuReleve<L, C>[],
  annee: number,
  compteDuRoleBanque: string,
): BanqueDUnCompteDuPlan<L, C>[] {
  const fin = `${annee}-12-31`
  const groupes = new Map<string, SoldeDUnCompteAuTrenteEtUn<L, C>[]>()
  for (const part of parts) {
    if (!tenuDansLExercice(part, annee)) continue
    const compte = part.compte === null ? compteDuRoleBanque : compteDeBanqueDuMouvement(part.compte, fin, compteDuRoleBanque)
    const soldes = groupes.get(compte) ?? []
    groupes.set(compte, soldes)
    if (part.compte !== null && part.compte.clos_le !== null && part.compte.clos_le <= fin) {
      soldes.push({ part, etat: 'clos', centimes: 0, closLe: part.compte.clos_le })
      continue
    }
    const releves = relevesAuTrenteEtUn(part.controles, part.lignes, annee)
    const lus = releves.soldes.filter((l): l is Extract<SoldeDuReleve, { centimes: number }> => l.lu !== null)
    const distincts = [...new Set(lus.map((l) => l.centimes))]
    soldes.push(distincts.length === 1 ? { part, etat: 'connu', centimes: distincts[0], lu: lus[0] }
      : distincts.length > 1 ? { part, etat: 'plusieurs', lus } : { part, etat: 'inconnu', releves })
  }
  return [...groupes.entries()].map(([compte, soldes]) => ({
    compte, soldes,
    centimes: soldes.every((s) => s.etat === 'connu' || s.etat === 'clos')
      ? soldes.reduce((t, s) => t + (s.etat === 'connu' || s.etat === 'clos' ? s.centimes : 0), 0) : null,
  }))
}

// ── Le relevé de janvier suivant, compte par compte ─────────────────────────────────────────────────────────────────

// LE RELEVÉ SUIVANT, AVANT LA VALIDATION (MVPD7-Q4, D4 de la relecture du 03/11/2026, sur la recommandation). En trésorerie,
// une pièce payée après le 31 décembre compte à la date de son paiement : tant que ce paiement n'est pas rapproché, la 2035
// de l'exercice la compte à sa date de facture, et la validation se retient (son écriture attend sa banque). Le relevé de
// janvier suivant s'importe et se rapproche donc AVANT la validation. Et une échéance de cotisation qu'aucun paiement ne date se
// fige, à la validation, à son échéance (`garder_cotisation_valide`) : son paiement depuis le compte personnel se déclare avant.
// La carte « Pièces comptées à leur date de facture » de Clôture le dit (pages/dossier/ClotureTab.tsx).
// Les exercices de la carte, nommés un à un ; et, dès deux comptes bancaires (MCB4), chacun d'eux : le relevé de janvier de
// l'un ne date pas les paiements faits depuis l'autre.
export function rappelDuReleveSuivant(annees: readonly number[], comptes: readonly string[]): string {
  const exercices = [...new Set(annees)].sort((a, b) => a - b)
  const deChaque = comptes.length > 1
    ? ` de chacun des comptes ${comptes.slice(0, -1).map((c) => `« ${c} »`).join(', ')} et « ${comptes[comptes.length - 1]} »` : ''
  const releves = exercices.map((a, i) => `${i === 0 ? 'le relevé' : 'celui'} de janvier ${a + 1}${i === 0 ? deChaque : ''} avant de valider ${a}`)
  const liste = releves.length > 1 ? `${releves.slice(0, -1).join(', ')} et ${releves[releves.length - 1]}` : releves[0]
  return `Une pièce payée après le 31 décembre compte à la date de son paiement, dans l'exercice suivant : importer et rapprocher ${liste}. `
    + "Tant que son paiement n'est pas rapproché, elle compte ici à sa date de facture, et retient la validation. De même, déclarer "
    + `dans l'onglet Cotisations le paiement depuis le compte personnel d'une échéance de ${exercices.join(' ou ')} avant la `
    + 'validation, qui fige ensuite l’échéance à sa date.'
}

/** Les libellés des comptes bancaires que le rappel du relevé de janvier nomme : dès deux comptes lus ; aucun sinon. */
export function nomsDesComptes(lecture: LectureDesComptes): string[] {
  return lecture.etat === 'lus' && lecture.comptes.length > 1 ? lecture.comptes.map((c) => c.libelle) : []
}
