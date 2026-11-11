import { dateDite, formuler, type RefusDeLaBase, type RefusDit } from './comptesBancaires'
import type { CompteDuReleve, LectureDesComptes } from './importParCompte'
import { relevesAuTrenteEtUn, type SoldeDuReleve } from './releveAuTrenteEtUn'
import { releveParCompte, tenuDansLExercice, type PartDuReleve } from './releveParCompte'
import type { ANouveau, ControleReleveBancaire, LigneBancaire, SensEcriture, SoldeReporte } from './types'

// L'OUVERTURE DE LA BANQUE ÉCLATÉE ENTRE LES COMPTES BANCAIRES (ligne 26.6, lot MCB5, sixième partie ; MCB-Q7, tranchée le
// 11/11/2026). Le récit : HISTORIQUE.md, « LA JAMBE DE BANQUE PAR COMPTE BANCAIRE : LES À-NOUVEAUX DE 2026 ÉCLATÉS (MCB5,
// SIXIÈME PARTIE) ». Le module pur de la migration `ouverture_eclatee_par_compte` (supabase/preparees/20261111235000_…,
// préparée, pas appliquée), qui écrit l'éclatement par `ecrire_ouverture_eclatee` après l'avoir RECOMPOSÉ en base
// (`ouverture_eclatee_attendue`) : ce module compose la même écriture, dit les mêmes refus dans le même ordre, et juge l'état
// de ce que le brouillon porte. ouvertureEclatee.test.ts le confronte au texte de la migration.
//
// 2025 se valide à un seul 512, celui du rôle `banque` ; un compte autre que le principal tient son 512 propre depuis le 1er
// janvier qu'il porte. L'ouverture de 2026 (soldes reportés, ou balance reprise) porte au 512 du rôle l'argent de tous les
// comptes : une écriture datée du 01/01/2026, une paire par compte qui en sort, passe son solde au relevé du 31/12/2025 à son
// 512, face au 512 du rôle. Les soldes reportés restent les soldes de clôture ; rien de ce qui les écrit ne change.
// Derrière `COMPTES_BANCAIRES_PREVUS` baissé, la lecture des comptes est `sans_objet` : une part sans compte, rien à
// éclater — l'écran d'hier, au caractère près. Un dossier à un seul compte : rien non plus.

/** Les refus de l'éclatement, dans l'ordre de `ouverture_eclatee_attendue` puis de `ecrire_ouverture_eclatee`. */
export const REFUS_DE_L_ECLATEMENT: readonly RefusDeLaBase[] = [
  { cle: 'en_attente', code: '23514',
    modele: "L'exercice % n'a pas encore d'ouverture : elle s'écrira à la validation de l'exercice %, et l'ouverture de la banque s'éclatera ensuite entre ses comptes." },
  { cle: 'inconnu', code: '23514',
    modele: "Le solde au % du compte bancaire « % » ne se lit sur aucun de ses relevés contrôlés : importer le relevé qui finit ce jour-là, ou celui qui le couvre, avant d'éclater l'ouverture de la banque." },
  { cle: 'plusieurs', code: '23514',
    modele: "Les relevés du compte bancaire « % » disent des soldes différents au % : l'un d'eux ne dit pas le bon, et l'ouverture de la banque ne s'éclate pas." },
  { cle: 'somme', code: '23514',
    modele: "Les soldes des relevés au % (% €) ne font pas l'ouverture du compte % (% €) : l'ouverture de la banque ne s'éclate pas entre ses comptes." },
]

/** Les refus du clic qui ne viennent pas de la recomposition, dans l'ordre de `ecrire_ouverture_eclatee`. */
export const REFUS_DU_CLIC: readonly RefusDeLaBase[] = [
  { cle: 'acces', code: '42501', modele: 'Accès refusé à ce dossier.' },
  { cle: 'exercice', code: '22023', modele: 'Exercice invalide.' },
  { cle: 'fige', code: '23514', modele: '% : son ouverture ne change plus.' },
  { cle: 'incomplet', code: '22023', modele: "L'éclatement proposé est incomplet." },
  { cle: 'non_conforme', code: '22023', modele: "L'éclatement proposé n'est pas celui que les relevés du % commandent : le recomposer." },
]

/** Le libellé des deux lignes d'une paire : le 512 du compte qui s'ouvre et le jour du relevé (jamais le libellé du compte,
 *  texte libre). Celui de la migration (`format('Ouverture du %s au relevé du %s', …)`). */
export function libelleDeLEclatement(compte: string, veille: string): string {
  return `Ouverture du ${compte} au relevé du ${dateDite(veille)}`
}

/** Des centimes dits en euros comme la base les dit (`to_char(…, 'FM999999999990.00')`, la virgule) : « 1250,00 ». */
export function eurosDeLaBase(centimes: number): string {
  return (centimes / 100).toFixed(2).replace('.', ',')
}

type AvecCompte = { compte_bancaire_id?: string | null }
type LigneDuReleve = Pick<LigneBancaire, 'source_fichier' | 'montant' | 'date'> & AvecCompte
type ControleDuReleve = ControleReleveBancaire & AvecCompte

/** Ce qu'un compte bancaire tenu dans l'exercice dit de son solde au 31 décembre (`soldes_des_comptes_au_trente_et_un`). */
export interface SoldeDUnCompte {
  compte: CompteDuReleve
  etat: 'connu' | 'clos' | 'plusieurs' | 'inconnu'
  /** En centimes ; zéro pour un compte clos ; nul quand le solde ne se sait pas. */
  centimes: number | null
}

// L'ordre de la base : le principal, puis le 512 de chaque compte (unique dans le dossier), puis l'identifiant.
// L'ordre du texte (`collate "C"`), jamais celui d'une langue.
const parTexte = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
const ordreDeLaBase = (a: CompteDuReleve, b: CompteDuReleve) =>
  Number(b.principal) - Number(a.principal) || parTexte(a.compte ?? '', b.compte ?? '') || parTexte(a.id, b.id)

/** Le solde au 31 décembre de chaque compte tenu dans l'exercice, lu sur ses SEULS relevés (la règle de
 *  lib/releveAuTrenteEtUn.ts) ; un compte clos au plus tard ce jour vaut zéro. Une part sans compte (le drapeau baissé)
 *  n'est pas rendue. */
export function soldesDesComptesAuTrenteEtUn(
  parts: readonly PartDuReleve<LigneDuReleve, ControleDuReleve>[], annee: number,
): SoldeDUnCompte[] {
  const fin = `${annee}-12-31`
  return parts
    .filter((p): p is PartDuReleve<LigneDuReleve, ControleDuReleve> & { compte: CompteDuReleve } => p.compte !== null && tenuDansLExercice(p, annee))
    .map((p): SoldeDUnCompte => {
      if (p.compte.clos_le !== null && p.compte.clos_le <= fin) return { compte: p.compte, etat: 'clos', centimes: 0 }
      const lus = relevesAuTrenteEtUn(p.controles, p.lignes, annee).soldes
        .filter((l): l is Extract<SoldeDuReleve, { centimes: number }> => l.lu !== null)
      const distincts = [...new Set(lus.map((l) => l.centimes))]
      return distincts.length === 1 ? { compte: p.compte, etat: 'connu', centimes: distincts[0] }
        : { compte: p.compte, etat: distincts.length > 1 ? 'plusieurs' : 'inconnu', centimes: null }
    })
    .sort((a, b) => ordreDeLaBase(a.compte, b.compte))
}

/** Ce que l'éclatement lit. Sans défaut : l'appelant dit ce qu'il a lu, en entier. */
export interface EntreesDeLEclatement {
  /** L'exercice qui s'ouvre. */
  annee: number
  /** Le compte du rôle `banque` du plan du dossier. */
  role: string
  /** Le relevé partagé entre les comptes (`releveParCompte`, état `parts`). */
  parts: readonly PartDuReleve<LigneDuReleve, ControleDuReleve>[]
  /** Toute la balance reprise du dossier, et tous ses soldes reportés. */
  reprise: readonly Pick<ANouveau, 'date' | 'compte' | 'sens' | 'montant'>[]
  reportes: readonly Pick<SoldeReporte, 'date' | 'compte' | 'sens' | 'montant'>[]
  anneesValidees: readonly number[]
  /** Les dates de tout le brouillon et de tout le relevé du dossier : une activité d'avant attend son ouverture. */
  datesDesEcritures: readonly string[]
  datesDesMouvements: readonly string[]
}

/** Une ligne de l'éclatement, telle qu'elle part à `ecrire_ouverture_eclatee`. */
export interface LigneDeLEclatement {
  compte_bancaire_id: string
  compte: string
  sens: SensEcriture
  /** En euros, au centime. */
  montant: number
  libelle: string
}

export type EclatementAttendu =
  | { etat: 'rien' }
  | { etat: 'refus'; refus: RefusDit }
  | { etat: 'lignes'; lignes: LigneDeLEclatement[] }

const refus = (cle: string, ...valeurs: string[]): EclatementAttendu =>
  ({ etat: 'refus', refus: formuler(REFUS_DE_L_ECLATEMENT.find((r) => r.cle === cle) as RefusDeLaBase, ...valeurs) })

/** L'éclatement que l'ouverture de l'exercice commande, ou le refus que la base opposerait, dans son ordre. */
export function ouvertureEclateeAttendue(e: EntreesDeLEclatement): EclatementAttendu {
  const debut = `${e.annee}-01-01`
  const veille = `${e.annee - 1}-12-31`
  if (e.reprise.some((a) => a.date > debut)) return { etat: 'rien' }
  const reprise = e.reprise.some((a) => a.date === debut)
  const comptes = soldesDesComptesAuTrenteEtUn(e.parts, e.annee - 1)
  const dansLeGroupe = (s: SoldeDUnCompte) => reprise || s.compte.principal || (s.compte.compte_propre_depuis ?? '') >= debut
  const sort = (s: SoldeDUnCompte) => !s.compte.principal && s.compte.compte_propre_depuis !== null
    && s.compte.compte_propre_depuis <= debut && (reprise || s.compte.compte_propre_depuis === debut)
  if (!comptes.some(sort)) return { etat: 'rien' }
  if (!reprise && !e.anneesValidees.includes(e.annee - 1)) {
    const avant = e.reprise.some((a) => a.date < debut) || e.anneesValidees.some((a) => a < e.annee)
      || e.datesDesEcritures.some((d) => d < debut) || e.datesDesMouvements.some((d) => d < debut)
    return avant ? refus('en_attente', String(e.annee), String(e.annee - 1)) : { etat: 'rien' }
  }
  const groupe = comptes.filter(dansLeGroupe)
  let somme = 0
  let nonNul = false
  let reste = false
  for (const s of [...groupe.filter(sort), ...groupe.filter((g) => !sort(g))]) {
    if (!reste && !sort(s)) {
      reste = true
      if (!nonNul) return { etat: 'rien' }
    }
    if (s.etat === 'inconnu') return refus('inconnu', dateDite(veille), s.compte.libelle)
    if (s.etat === 'plusieurs') return refus('plusieurs', s.compte.libelle, dateDite(veille))
    somme += s.centimes as number
    nonNul = nonNul || s.centimes !== 0
  }
  if (!nonNul) return { etat: 'rien' }
  const ouverture = [...e.reprise, ...e.reportes]
    .filter((a) => a.date === debut && a.compte === e.role)
    .reduce((t, a) => t + (a.sens === 'debit' ? 1 : -1) * Math.round(a.montant * 100), 0)
  if (somme !== ouverture) return refus('somme', dateDite(veille), eurosDeLaBase(somme), e.role, eurosDeLaBase(ouverture))
  const lignes = comptes.filter((s) => sort(s) && s.centimes !== 0).flatMap((s): LigneDeLEclatement[] => {
    const centimes = s.centimes as number
    const libelle = libelleDeLEclatement(s.compte.compte as string, veille)
    const montant = Math.abs(centimes) / 100
    return [
      { compte_bancaire_id: s.compte.id, compte: s.compte.compte as string, sens: centimes > 0 ? 'debit' : 'credit', montant, libelle },
      { compte_bancaire_id: s.compte.id, compte: e.role, sens: centimes > 0 ? 'credit' : 'debit', montant, libelle },
    ]
  })
  return { etat: 'lignes', lignes }
}

/** Une ligne du brouillon, telle que l'état de l'éclatement la lit. */
export interface LigneEcriteDeLEclatement {
  date: string
  compte: string
  sens: SensEcriture
  montant: number
  libelle: string
  ouverture_compte_bancaire_id?: string | null
}

export type EtatDeLEclatement =
  | { etat: 'sans_objet' }
  | { etat: 'a_ecrire' | 'a_jour' | 'a_reecrire'; lignes: LigneDeLEclatement[] }
  | { etat: 'a_retirer' }
  | { etat: 'retenu'; refus: RefusDit }

const cle = (l: { compte_bancaire_id: string; compte: string; sens: string; montant: number; libelle: string }) =>
  `${l.compte_bancaire_id}|${l.compte}|${l.sens}|${Math.round(l.montant * 100)}|${l.libelle}`

/** Ce que le brouillon porte de l'éclatement de l'exercice, au regard de ce que l'ouverture commande : les lignes datées de
 *  son 1er janvier qui portent la source, comparées en multiensemble à l'éclatement attendu. */
export function etatDeLEclatement(attendu: EclatementAttendu, brouillon: readonly LigneEcriteDeLEclatement[], annee: number): EtatDeLEclatement {
  const ecrites = brouillon.filter((l) => l.ouverture_compte_bancaire_id != null && l.date === `${annee}-01-01`)
  if (attendu.etat === 'refus') return { etat: 'retenu', refus: attendu.refus }
  if (attendu.etat === 'rien') return ecrites.length === 0 ? { etat: 'sans_objet' } : { etat: 'a_retirer' }
  if (ecrites.length === 0) return { etat: 'a_ecrire', lignes: attendu.lignes }
  const a = attendu.lignes.map(cle).sort()
  const b = ecrites.map((l) => cle({ ...l, compte_bancaire_id: l.ouverture_compte_bancaire_id as string })).sort()
  const egal = a.length === b.length && a.every((k, i) => k === b[i])
  return { etat: egal ? 'a_jour' : 'a_reecrire', lignes: attendu.lignes }
}

// ── Ce que l'écran et la validation en disent (MCB5, sixième partie, suite) ─────────────────────────────────────────────
// La carte de l'onglet Écritures (pages/dossier/OuvertureEclateeCarte.tsx) et le préalable `ouverture-a-eclater` de la
// validation (lib/prealablesValidation.ts) lisent les mêmes mots, tirés du même état.

/** L'état de l'éclatement de l'exercice, sur ses entrées lues en entier et TOUT le brouillon du dossier. */
export function eclatementDeLExercice(e: EntreesDeLEclatement, brouillon: readonly LigneEcriteDeLEclatement[]): EtatDeLEclatement {
  return etatDeLEclatement(ouvertureEclateeAttendue(e), brouillon, e.annee)
}

export const LIBELLE_ETAT_ECLATEMENT: Readonly<Record<Exclude<EtatDeLEclatement['etat'], 'sans_objet'>, string>> = {
  a_ecrire: 'à écrire',
  a_jour: 'à jour',
  a_reecrire: 'à réécrire',
  a_retirer: 'à retirer',
  retenu: 'retenue',
}

/** Les états qui appellent un clic : écrire, réécrire, retirer. */
export type EclatementAFaire = { etat: 'a_ecrire' | 'a_reecrire'; lignes: LigneDeLEclatement[] } | { etat: 'a_retirer' }
export const eclatementAFaire = (e: EtatDeLEclatement): e is EclatementAFaire =>
  e.etat === 'a_ecrire' || e.etat === 'a_reecrire' || e.etat === 'a_retirer'

/** Ce que l'état dit, en une phrase qui se lit seule ; rien pour un éclatement sans objet. */
export function phraseDeLEclatement(etat: EtatDeLEclatement, annee: number): string | null {
  const jour = `01/01/${annee}`
  const veille = `31/12/${annee - 1}`
  switch (etat.etat) {
    case 'sans_objet': return null
    case 'a_ecrire':
      return `L’ouverture du ${jour} porte au compte de banque du rôle l’argent de tous les comptes bancaires : l’écriture qui passe `
        + `le solde de chaque compte à son 512, d’après ses relevés du ${veille}, n’est pas écrite.`
    case 'a_jour': return `L’ouverture de la banque au ${jour} est éclatée entre les comptes bancaires, d’après leurs relevés du ${veille}.`
    case 'a_reecrire':
      return `L’écriture qui éclate l’ouverture de la banque au ${jour} n’est plus celle que les relevés du ${veille} commandent : la réécrire.`
    case 'a_retirer':
      return `Une écriture éclate l’ouverture de la banque au ${jour}, alors que plus rien n’est à éclater : la retirer.`
    case 'retenu': return etat.refus.message
  }
}

/** La confirmation du clic : chaque compte ouvert et son montant, et ce que l'écriture remplace ; ou le retrait. */
export function confirmationDeLEclatement(etat: EclatementAFaire, annee: number): string {
  if (etat.etat === 'a_retirer') {
    return `Retirer l’écriture qui éclate l’ouverture de la banque au 01/01/${annee} ? Plus rien n’est à éclater : le compte de banque `
      + 'du rôle garde toute l’ouverture.'
  }
  // Une paire par compte : sa ligne au 512 du compte d'abord, puis sa contrepartie au 512 du rôle (`ouvertureEclateeAttendue`).
  const paires = etat.lignes.filter((_, i) => i % 2 === 0)
  const dits = paires.map((l) => `${l.compte} : ${l.sens === 'debit' ? '' : '−'}${eurosDeLaBase(Math.round(l.montant * 100))} €`)
  const role = etat.lignes[1]?.compte ?? ''
  return `${etat.etat === 'a_reecrire' ? 'Réécrire' : 'Écrire'} l’écriture du 01/01/${annee} qui ouvre `
    + `${paires.length > 1 ? 'ces comptes au solde de leurs relevés' : 'ce compte au solde de son relevé'} du 31/12/${annee - 1}, `
    + `face au ${role} ?\n\n${dits.join('\n')}${etat.etat === 'a_reecrire' ? '\n\nElle remplace celle qui est au brouillon.' : ''}`
}

/** Ce que lib/ouvertureEclateeLecture.ts rend, gardé avec le dossier pour lequel il a été lu. */
export type LectureDuReleveDeLOuverture =
  | { dossierId: string; etat: 'sans_objet' }
  | { dossierId: string; etat: 'illisible'; motif: string }
  | { dossierId: string; etat: 'lue'; comptes: Extract<LectureDesComptes, { etat: 'lus' }>; lignes: readonly LigneDuReleve[]; controles: readonly ControleDuReleve[] }

/** Ce que la carte de l'onglet Écritures montre. */
export type CarteDeLEclatement =
  | { etat: 'masquee' }
  | { etat: 'chargement' }
  | { etat: 'illisible'; motif: string }
  | { etat: 'lue'; eclatement: Exclude<EtatDeLEclatement, { etat: 'sans_objet' }>; fige: boolean }

/**
 * La carte de l'exercice affiché : rien sur « toutes les années », drapeau baissé (`sans_objet`) ou sans rien à éclater ;
 * « Chargement… » tant qu'une lecture n'est pas revenue pour CE dossier ; illisible sur une lecture partielle ou refusée
 * (le motif de la première) — aucun geste alors ; sinon l'état, et s'il est figé par un exercice validé (aucun geste non
 * plus : la base le refuserait). Sans défaut : l'appelant dit tout ce qu'il a lu.
 */
export function carteDeLEclatement(c: {
  dossierId: string
  annee: number | string
  lecture: LectureDuReleveDeLOuverture | null
  /** Les motifs des lectures de l'onglet qui comptent ici (le brouillon, la reprise, les soldes reportés), nuls si entières. */
  motifs: readonly (string | null)[]
  role: string
  reprise: EntreesDeLEclatement['reprise']
  reportes: EntreesDeLEclatement['reportes']
  anneesValidees: readonly number[]
  brouillon: readonly LigneEcriteDeLEclatement[]
}): CarteDeLEclatement {
  if (typeof c.annee !== 'number') return { etat: 'masquee' }
  if (c.lecture === null || c.lecture.dossierId !== c.dossierId) return { etat: 'chargement' }
  if (c.lecture.etat === 'sans_objet') return { etat: 'masquee' }
  if (c.lecture.etat === 'illisible') return { etat: 'illisible', motif: c.lecture.motif }
  const motif = c.motifs.find((m) => m !== null)
  if (motif != null) return { etat: 'illisible', motif }
  const releve = releveParCompte(c.lecture.comptes, c.lecture.lignes, c.lecture.controles)
  if (releve.etat === 'retenu') return { etat: 'illisible', motif: releve.raison }
  const eclatement = eclatementDeLExercice({
    annee: c.annee, role: c.role, parts: releve.parts, reprise: c.reprise, reportes: c.reportes, anneesValidees: c.anneesValidees,
    datesDesEcritures: c.brouillon.map((e) => e.date), datesDesMouvements: c.lecture.lignes.map((l) => l.date),
  }, c.brouillon)
  if (eclatement.etat === 'sans_objet') return { etat: 'masquee' }
  return { etat: 'lue', eclatement, fige: c.anneesValidees.some((a) => a >= (c.annee as number)) }
}

/** Ce que le clic envoie à `ecrire_ouverture_eclatee` : la composition, vide pour un retrait. */
export function argumentsDeLEclatement(dossierId: string, annee: number, etat: EclatementAFaire) {
  return { p_dossier_id: dossierId, p_annee: annee, p_ecritures: etat.etat === 'a_retirer' ? [] : etat.lignes }
}
