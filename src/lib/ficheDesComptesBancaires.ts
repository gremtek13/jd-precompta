import { dateDite, refusDuCompteBancaire, type CompteBancaire, type CompteDUnRole, type ContexteDUnCompte, type SaisieDUnCompte } from './comptesBancaires'
import type { CompteDuReleve } from './importParCompte'
import { ROLES_COMPTABLES, type PlanComptable } from './planComptable'

// LA FICHE DES COMPTES BANCAIRES D'UN DOSSIER (ligne 26.6, lot MCB6 ; MCB-Q1 à Q8, tranchées le 11/11/2026). Le récit :
// HISTORIQUE.md, « 11/11/2026 — LES ÉCRANS DU CABINET POUR PLUSIEURS COMPTES BANCAIRES (MCB6) ». Un module PUR : la carte
// « Comptes bancaires » de l'onglet Informations (pages/dossier/ComptesBancairesCard.tsx) lui demande, avant tout clic, ce que
// la saisie écrirait TELLE QU'ELLE PART, et le premier refus qu'elle rencontrerait — d'abord ceux de l'application, puis ceux
// de la base, redits par `refusDuCompteBancaire` (lib/comptesBancaires.ts, confronté au texte de la migration). Ce que la base
// permet, et que la fiche suit :
//   - le premier compte d'un dossier est son PRINCIPAL, qui suit le compte du rôle `banque` du plan (ni compte ni date à lui) ;
//     la base le crée d'elle-même au premier mouvement importé, la fiche aussi pour un dossier qui n'en a pas encore ;
//   - un autre compte tient son propre 512, six chiffres, qui n'est à aucun rôle du plan ni à un autre compte, DEPUIS un
//     1er janvier : l'application exige 2026 au plus tôt (MCB-Q7 : 2025 se valide avec un seul 512) ;
//   - le compte et cette date se figent au premier mouvement ou relevé du compte ; avant, ils se corrigent ;
//   - le libellé, que le client « Banque » lit (MCB-Q8), reste modifiable ; l'ouverture et la clôture aussi, tant qu'elles
//     encadrent les mouvements du compte ;
//   - la fin de l'identifiant (les quatre derniers caractères de l'ACCTID d'un OFX, MCB2) se corrige à la main, ou s'efface.
// L'application demande en plus la date d'ouverture à la création (MCB4-Q2, sur la recommandation : elle borne les mouvements
// et dit depuis quand le relevé du compte est attendu) et ne l'efface jamais une fois donnée. Aucun compte ne se retire d'ici.

/** Le premier exercice où un compte autre que le principal tient son propre 512 (MCB-Q7). */
export const PREMIERE_ANNEE_DU_COMPTE_PROPRE = 2026

/** Ce que la base porte sous un compte : ses mouvements (leur nombre, la première et la dernière date) et ses relevés. */
export interface UsageDUnCompte {
  mouvements: number
  releves: number
  premiere: string | null
  derniere: string | null
}

const SANS_USAGE: UsageDUnCompte = { mouvements: 0, releves: 0, premiere: null, derniere: null }

/** L'usage de chaque compte, tiré des mouvements et des contrôles du dossier lus EN ENTIER (la lecture le garantit). */
export function usageDesComptes(
  lignes: readonly { compte_bancaire_id: string | null; date: string }[],
  controles: readonly { compte_bancaire_id: string | null }[],
): ReadonlyMap<string, UsageDUnCompte> {
  const usages = new Map<string, UsageDUnCompte>()
  const de = (id: string) => usages.get(id) ?? { ...SANS_USAGE }
  for (const l of lignes) {
    if (l.compte_bancaire_id === null) continue
    const u = de(l.compte_bancaire_id)
    usages.set(l.compte_bancaire_id, {
      ...u, mouvements: u.mouvements + 1,
      premiere: u.premiere === null || l.date < u.premiere ? l.date : u.premiere,
      derniere: u.derniere === null || l.date > u.derniere ? l.date : u.derniere,
    })
  }
  for (const c of controles) {
    if (c.compte_bancaire_id === null) continue
    const u = de(c.compte_bancaire_id)
    usages.set(c.compte_bancaire_id, { ...u, releves: u.releves + 1 })
  }
  return usages
}

export function usageDe(usages: ReadonlyMap<string, UsageDUnCompte>, id: string): UsageDUnCompte {
  return usages.get(id) ?? SANS_USAGE
}

const porte = (u: UsageDUnCompte) => u.mouvements > 0 || u.releves > 0

/** Les comptes des rôles du plan du dossier, dans l'ordre du catalogue — celui où la garde de la base les cherche. */
export function comptesDesRolesDuPlan(plan: PlanComptable): CompteDUnRole[] {
  return [...ROLES_COMPTABLES].sort((a, b) => a.ordre - b.ordre).map((r) => ({ role: r.role, compte: plan[r.role] }))
}

/** La saisie de la fiche, telle que les champs la tiennent : des textes. `depuis` : l'année du 1er janvier du compte propre. */
export interface SaisieDeLaFiche {
  libelle: string
  compte: string
  depuis: string
  ouvertLe: string
  closLe: string
  finDIdentifiant: string
}

/** Ce qui part vers la base, colonne par colonne. */
export type LigneDeLaFiche = Pick<CompteBancaire,
  'libelle' | 'principal' | 'compte' | 'compte_propre_depuis' | 'ouvert_le' | 'clos_le' | 'fin_d_identifiant'>

export type JugementDeLaFiche = { refus: string; ligne: null } | { refus: null; ligne: LigneDeLaFiche }

/** La saisie d'un compte existant, pour le corriger. */
export function saisieDuCompte(c: CompteDuReleve): SaisieDeLaFiche {
  return {
    libelle: c.libelle, compte: c.compte ?? '', depuis: c.compte_propre_depuis?.slice(0, 4) ?? '', ouvertLe: c.ouvert_le ?? '',
    closLe: c.clos_le ?? '', finDIdentifiant: c.fin_d_identifiant ?? '',
  }
}

/** La saisie proposée pour un compte neuf : le premier 512x00 libre, depuis 2026 ; le principal si le dossier n'en a aucun. */
export function saisieNeuve(comptes: readonly CompteDuReleve[], comptesDesRoles: readonly CompteDUnRole[]): SaisieDeLaFiche {
  const pris = new Set([...comptes.map((c) => c.compte), ...comptesDesRoles.map((r) => r.compte)])
  const libre = comptes.length === 0 ? '' : ['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((n) => `512${n}00`).find((c) => !pris.has(c)) ?? ''
  return {
    libelle: comptes.length === 0 ? 'Compte principal' : '', compte: libre,
    depuis: comptes.length === 0 ? '' : String(PREMIERE_ANNEE_DU_COMPTE_PROPRE), ouvertLe: '', closLe: '', finDIdentifiant: '',
  }
}

// Une date civile AAAA-MM-JJ qui existe au calendrier ; le champ vide est nul.
function dateLue(texte: string): string | null | 'invalide' {
  const t = texte.trim()
  if (t === '') return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return 'invalide'
  const [a, m, j] = t.split('-').map(Number)
  const d = new Date(Date.UTC(a, m - 1, j))
  return d.getUTCFullYear() === a && d.getUTCMonth() === m - 1 && d.getUTCDate() === j ? t : 'invalide'
}

export const REFUS_OUVERTURE_A_LA_CREATION =
  'La date d’ouverture du compte se donne à sa création : elle borne les dates de ses mouvements, et dit depuis quand son relevé est attendu.'
export const REFUS_OUVERTURE_EFFACEE = 'La date d’ouverture du compte ne s’efface pas : elle se corrige.'
export const REFUS_DATE = (quoi: string) => `La date ${quoi} n’est pas une date du calendrier (JJ/MM/AAAA).`
export const REFUS_ANNEE_DU_COMPTE_PROPRE =
  `Un compte bancaire tient son propre compte du plan depuis le 1er janvier ${PREMIERE_ANNEE_DU_COMPTE_PROPRE} au plus tôt : `
  + `l’exercice ${PREMIERE_ANNEE_DU_COMPTE_PROPRE - 1} se valide avec un seul compte de banque, celui du compte principal.`
export const REFUS_FIN_D_IDENTIFIANT =
  'La fin de l’identifiant du compte est faite de ses quatre derniers caractères, chiffres ou lettres, tels que son relevé OFX les porte (« 4567 »).'

// Le premier refus de l'application, puis la ligne et le premier refus de la base (`refusDuCompteBancaire`).
function juger(saisie: SaisieDeLaFiche, principal: boolean, contexte: ContexteDUnCompte): JugementDeLaFiche {
  const avant = contexte.avant
  const ouvertLe = dateLue(saisie.ouvertLe)
  const closLe = dateLue(saisie.closLe)
  if (ouvertLe === 'invalide') return { refus: REFUS_DATE('d’ouverture'), ligne: null }
  if (closLe === 'invalide') return { refus: REFUS_DATE('de clôture'), ligne: null }
  if (ouvertLe === null) {
    if (avant === null) return { refus: REFUS_OUVERTURE_A_LA_CREATION, ligne: null }
    if (avant.ouvert_le !== null) return { refus: REFUS_OUVERTURE_EFFACEE, ligne: null }
  }
  const fin = saisie.finDIdentifiant.trim().toUpperCase()
  if (fin !== '' && !/^[0-9A-Z]{4}$/.test(fin)) return { refus: REFUS_FIN_D_IDENTIFIANT, ligne: null }
  let compte: string | null = null
  let depuis: string | null = null
  if (!principal) {
    compte = saisie.compte.trim()
    const annee = saisie.depuis.trim()
    // Une date figée par la base se garde telle qu'elle est lue : seule une saisie neuve se juge à l'aune de 2026.
    const inchangee = avant !== null && avant.compte_propre_depuis !== null && annee === avant.compte_propre_depuis.slice(0, 4)
    if (!inchangee && (!/^\d{4}$/.test(annee) || Number(annee) < PREMIERE_ANNEE_DU_COMPTE_PROPRE || Number(annee) > 2099)) {
      return { refus: REFUS_ANNEE_DU_COMPTE_PROPRE, ligne: null }
    }
    depuis = inchangee && avant ? avant.compte_propre_depuis : `${annee}-01-01`
  }
  const base: SaisieDUnCompte = { libelle: saisie.libelle, principal, compte, compte_propre_depuis: depuis, ouvert_le: ouvertLe, clos_le: closLe }
  const refus = refusDuCompteBancaire(base, contexte)
  if (refus !== null) return { refus: refus.message, ligne: null }
  return { refus: null, ligne: { ...base, fin_d_identifiant: fin === '' ? null : fin } }
}

/** Le jugement d'un compte neuf : le principal quand le dossier n'en tient aucun, un compte qui tient son 512 sinon. */
export function jugerLaCreation(
  saisie: SaisieDeLaFiche,
  comptes: readonly CompteDuReleve[],
  comptesDesRoles: readonly CompteDUnRole[],
): JugementDeLaFiche {
  return juger(saisie, comptes.length === 0, { comptesDuDossier: comptes, comptesDesRoles, avant: null })
}

/** Le jugement d'une correction : le compte d'avant, ce que la base porte sous lui. */
export function jugerLaModification(
  avant: CompteDuReleve,
  saisie: SaisieDeLaFiche,
  comptes: readonly CompteDuReleve[],
  comptesDesRoles: readonly CompteDUnRole[],
  usage: UsageDUnCompte,
): JugementDeLaFiche {
  return juger(saisie, avant.principal, {
    comptesDuDossier: comptes, comptesDesRoles,
    avant: {
      ...avant, porteDesMouvementsOuDesReleves: porte(usage),
      datesDesMouvements: [usage.premiere, usage.derniere].filter((d): d is string => d !== null),
    },
  })
}

/** Ce que la saisie change, colonne par colonne : rien, et le bouton reste éteint. */
export function changements(avant: CompteDuReleve, ligne: LigneDeLaFiche): (keyof LigneDeLaFiche)[] {
  return (['libelle', 'compte', 'compte_propre_depuis', 'ouvert_le', 'clos_le', 'fin_d_identifiant'] as const)
    .filter((k) => ligne[k] !== avant[k])
}

/** Le compte du plan où s'écrit la banque d'un compte, en mots. */
export function compteDuPlanDit(c: Pick<CompteDuReleve, 'principal' | 'compte' | 'compte_propre_depuis'>, banque: string): string {
  if (c.principal || c.compte === null || c.compte_propre_depuis === null) return `au ${banque}, le compte de banque du plan`
  return `au ${c.compte} depuis le ${dateDite(c.compte_propre_depuis)} (avant, au ${banque} du compte principal)`
}

/** Ce que la base permet encore de changer d'un compte, dit sous sa ligne. */
export function ceQuiResteModifiable(c: Pick<CompteDuReleve, 'principal'>, usage: UsageDUnCompte): string {
  const encadre = usage.premiere !== null && usage.derniere !== null
    ? ` (elles encadrent ses mouvements, du ${dateDite(usage.premiere)} au ${dateDite(usage.derniere)})` : ''
  if (c.principal) {
    return `Le compte principal suit le compte de banque du plan : son nom, ses dates d’ouverture et de clôture${encadre} et la fin de son identifiant se corrigent.`
  }
  if (porte(usage)) {
    return 'Ce compte porte des mouvements ou des relevés : son compte du plan et la date depuis laquelle il le tient ne changent plus ; '
      + `son nom, ses dates d’ouverture et de clôture${encadre} et la fin de son identifiant se corrigent.`
  }
  return 'Ce compte ne porte encore ni mouvement ni relevé : tout se corrige ; son compte du plan et la date depuis laquelle il le tient '
    + 'se figeront à son premier mouvement ou relevé.'
}

/** La confirmation d'une création : elle nomme ce qui se figera. */
export function confirmationDeLaCreation(ligne: LigneDeLaFiche, banque: string): string {
  const ouvert = ligne.ouvert_le === null ? '' : `, ouvert le ${dateDite(ligne.ouvert_le)}`
  if (ligne.principal) {
    return `Créer le compte principal « ${ligne.libelle} »${ouvert} ? Il suit le compte de banque du plan (${banque}) ; son nom, que le `
      + 'client « Banque » lit, reste modifiable.'
  }
  return `Créer le compte bancaire « ${ligne.libelle} »${ouvert} ? Ses mouvements s’écriront ${compteDuPlanDit(ligne, banque)}. `
    + 'Son compte du plan et cette date se figeront à son premier mouvement ou relevé ; son nom, que le client « Banque » lit, reste '
    + 'modifiable. Un relevé de ce compte s’importe ensuite sous lui, dans l’onglet Banque.'
}

const NOMS_DES_COLONNES: Record<keyof LigneDeLaFiche, string> = {
  libelle: 'le nom', principal: 'le rang', compte: 'le compte du plan', compte_propre_depuis: 'la date depuis laquelle il le tient',
  ouvert_le: 'la date d’ouverture', clos_le: 'la date de clôture', fin_d_identifiant: 'la fin de l’identifiant',
}

/** La confirmation d'une correction : ce qui change, et ce qui se figera. */
export function confirmationDeLaModification(avant: CompteDuReleve, ligne: LigneDeLaFiche, usage: UsageDUnCompte): string {
  const noms = changements(avant, ligne).map((k) => NOMS_DES_COLONNES[k])
  const liste = noms.length > 1 ? `${noms.slice(0, -1).join(', ')} et ${noms[noms.length - 1]}` : noms[0] ?? 'rien'
  const fige = !avant.principal && !porte(usage) && (ligne.compte !== avant.compte || ligne.compte_propre_depuis !== avant.compte_propre_depuis)
    ? ' Son compte du plan et cette date se figeront à son premier mouvement ou relevé.' : ''
  const cloture = ligne.clos_le !== null && ligne.clos_le !== avant.clos_le
    ? ` Clos le ${dateDite(ligne.clos_le)}, il ne reçoit plus de mouvement daté après, et son solde compte pour zéro à la fin de l’exercice.` : ''
  return `Corriger ${liste} du compte « ${avant.libelle} » ?${fige}${cloture}`
}
