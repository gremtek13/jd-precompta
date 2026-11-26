import {
  FRONTIERE_DE_LA_TENUE_PREVUE,
  phrasesDeLaFermetureDeLaTenue,
  CE_QU_OUVRE_LE_MODULE,
  DEPENDANCES,
  EXTINCTIONS_GARDEES,
  LIBELLES_DES_MODULES,
  MODULES_OPTIONNELS,
  modulesAOuvrir,
  refusDExtinction,
  refusDeFermeture,
  type ModuleOptionnel,
} from './modulesDuCabinet'

// L'ÉCRAN DU SUPER-ADMINISTRATEUR QUI OUVRE ET FERME LES MODULES D'UN CABINET (conception 56, § 2.5, lot OPT4). Module PUR :
// ni base, ni écran, ni horloge. Ce que `regler_option_du_cabinet` jugera, l'écran le dit AVANT le clic, aux mots de la base,
// que lib/modulesDuCabinet.ts porte déjà (`refusDeFermeture`, `refusDExtinction`) : ce fichier ne les recopie pas, il les
// applique à un cabinet et à ses lignes lues. Il porte en plus :
//   - l'état des options d'un cabinet, lu de ses lignes : une ligne absente est un module FERMÉ (OPT-Q3 (B) : un cabinet neuf
//     n'a que le socle), une ligne d'une forme inconnue ou rendue deux fois rend le cabinet ILLISIBLE (aucun geste) ;
//   - les dossiers qui retiennent une extinction, sur le critère de la base pour les trois modules qu'elle garde (la
//     facturation d'un dossier basculé ; la facture électronique d'un envoi parti sans issue connue, `etat = 'envoi'` ;
//     l'assurance maladie d'un paiement associé à un crédit du relevé, la table de NOE5, en production depuis le
//     20/11/2026), confronté au texte de la migration par optionsDuCabinetVue.test.ts. Sans la lecture des associations
//     (son drapeau baissé, l'état d'avant), l'écran ne juge pas l'assurance maladie : la base seule, et la confirmation le dit ;
//   - les mots de la confirmation, qui NOMMENT le cabinet, le module et ce qui disparaît des écrans.
// Une option ne change ni qui lit quoi ni aucun chiffre (§ 3.1, § 4) : la confirmation le dit.

/** Une ligne de `options_des_cabinets` telle que la lecture la rend (des valeurs non jugées). */
export type LigneDOptionLue = { readonly cabinet_id: unknown; readonly module: unknown; readonly ouverte: unknown }

/** Les options d'un cabinet, lues. `neuf` : aucune ligne — le socle seul, que l'écran dit. */
export type OptionsDUnCabinet =
  | { readonly etat: 'lues'; readonly ouverts: readonly ModuleOptionnel[]; readonly neuf: boolean }
  | { readonly etat: 'illisibles'; readonly motif: string }

const rang = (m: ModuleOptionnel) => MODULES_OPTIONNELS.indexOf(m)

/**
 * Les options de chaque cabinet de la liste, de ses lignes lues EN ENTIER (l'appelant ne l'appelle que sur une lecture
 * complète). Une ligne d'un cabinet hors de la liste est ignorée : la liste des cabinets fait foi.
 */
export function optionsDesCabinets(
  cabinetIds: readonly string[],
  lignes: readonly LigneDOptionLue[],
): Map<string, OptionsDUnCabinet> {
  const connus = MODULES_OPTIONNELS as readonly unknown[]
  const parCabinet = new Map<string, LigneDOptionLue[]>(cabinetIds.map((id) => [id, []]))
  for (const l of lignes) {
    if (typeof l.cabinet_id === 'string') parCabinet.get(l.cabinet_id)?.push(l)
  }
  const sortie = new Map<string, OptionsDUnCabinet>()
  for (const [id, siennes] of parCabinet) {
    if (siennes.some((l) => !connus.includes(l.module) || typeof l.ouverte !== 'boolean')) {
      sortie.set(id, { etat: 'illisibles', motif: 'une option rendue n’est pas lisible' })
      continue
    }
    const modules = siennes.map((l) => l.module as ModuleOptionnel)
    if (new Set(modules).size !== modules.length) {
      sortie.set(id, { etat: 'illisibles', motif: 'un module est rendu deux fois' })
      continue
    }
    const ouverts = siennes.filter((l) => l.ouverte === true).map((l) => l.module as ModuleOptionnel).sort((a, b) => rang(a) - rang(b))
    sortie.set(id, { etat: 'lues', ouverts, neuf: siennes.length === 0 })
  }
  return sortie
}

/** Ce que l'écran dit d'un cabinet neuf (aucune ligne). */
export const CABINET_NEUF =
  'Aucune option n’est enregistrée pour ce cabinet : seul le socle (la précomptabilité) lui est ouvert. Coche les modules de son offre.'

// ── Les dossiers qui retiennent une extinction ─────────────────────────────────────────────────────────────────────────

/** Un dossier du parc, tel que l'écran le lit pour juger l'extinction gardée. */
export type DossierDuParc = {
  readonly id: string
  readonly cabinet_id: string
  readonly nom: string
  readonly ventes_par_les_factures: boolean
}

/** Ordre `collate "C"` de la base : les points de code, puis l'identifiant. */
function ordreDeLaBase(a: { nom: string; id: string }, b: { nom: string; id: string }): number {
  const pa = Array.from(a.nom, (c) => c.codePointAt(0)!)
  const pb = Array.from(b.nom, (c) => c.codePointAt(0)!)
  for (let i = 0; i < Math.min(pa.length, pb.length); i++) if (pa[i] !== pb[i]) return pa[i] - pb[i]
  if (pa.length !== pb.length) return pa.length - pb.length
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * Les dossiers du cabinet qui retiennent la fermeture du module, dans l'ordre que la base leur donne (leur nom en
 * `collate "C"`, puis leur identifiant) : la facturation, les dossiers basculés ; la facture électronique, ceux dont une
 * facture ou une déclaration d'encaissement est partie sans issue connue (`dossiersEnEnvoi`, lus des deux tables de
 * transmissions à l'état `envoi`) ; l'assurance maladie, ceux dont un paiement est associé à un crédit du relevé
 * (`dossiersAssocies`, lus de la table de l’association, NOE5). Nul quand l'écran ne peut pas le savoir : les
 * associations non lues (`dossiersAssocies` nul), la base seule les juge. Vide pour un module que rien ne retient.
 */
export function dossiersQuiRetiennent(
  module: ModuleOptionnel,
  cabinetId: string,
  dossiers: readonly DossierDuParc[],
  dossiersEnEnvoi: ReadonlySet<string>,
  dossiersAssocies: ReadonlySet<string> | null,
): string[] | null {
  if (EXTINCTIONS_GARDEES[module] === undefined) return []
  const siens = dossiers.filter((d) => d.cabinet_id === cabinetId)
  let retenants: DossierDuParc[]
  if (module === 'facturation') retenants = siens.filter((d) => d.ventes_par_les_factures)
  else if (module === 'facture_electronique') retenants = siens.filter((d) => dossiersEnEnvoi.has(d.id))
  else if (module === 'assurance_maladie' && dossiersAssocies !== null) retenants = siens.filter((d) => dossiersAssocies.has(d.id))
  else return null
  return [...retenants].sort(ordreDeLaBase).map((d) => d.nom)
}

// ── Les cases ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export type CaseDUnModule = {
  readonly module: ModuleOptionnel
  readonly libelle: string
  readonly ouverte: boolean
  /** Le geste que le clic propose. */
  readonly geste: 'ouvrir' | 'fermer'
  /** Le refus de ce geste, dit avant le clic aux mots de la base ; la case ne s'offre pas. */
  readonly refus: string | null
  /** Ouvrir : les modules fermés que l'ouverture ouvre AUSSI (ce qu'il suppose, de proche en proche). */
  readonly ouvreAussi: readonly ModuleOptionnel[]
  /** Ce que le module suppose, dit sous la case. */
  readonly suppose: readonly ModuleOptionnel[]
  /** Les dossiers qui retiennent l'extinction n'ont pas pu être jugés par l'écran (`retenants` nul) : la base seule. */
  readonly jugeParLaBaseSeule: boolean
}

/**
 * Les huit cases d'un cabinet, dans l'ordre de la liste fermée. Fermer se refuse d'abord sous un module ouvert qui le
 * suppose, puis sous un dossier qui en dépend — l'ordre de `regler_option_du_cabinet`. `retenants` : les dossiers qui
 * retiennent l'extinction d'un module (`dossiersQuiRetiennent`), nul quand l'écran ne le sait pas.
 */
export function casesDuCabinet(
  ouverts: readonly ModuleOptionnel[],
  retenants: (module: ModuleOptionnel) => readonly string[] | null,
): CaseDUnModule[] {
  return MODULES_OPTIONNELS.map((module) => {
    const ouverte = ouverts.includes(module)
    const retenus = retenants(module)
    const refus = ouverte ? (refusDeFermeture(module, ouverts) ?? refusDExtinction(module, retenus ?? [])) : null
    return {
      module,
      libelle: LIBELLES_DES_MODULES[module],
      ouverte,
      geste: ouverte ? 'fermer' : 'ouvrir',
      refus,
      ouvreAussi: ouverte ? [] : modulesAOuvrir(module).filter((m) => m !== module && !ouverts.includes(m)),
      suppose: DEPENDANCES[module],
      jugeParLaBaseSeule: retenus === null,
    }
  })
}

/** « Suppose « Facturation » », sous la case d'un module qui en suppose un autre ; nul sinon. */
export function phraseDeLaDependance(c: CaseDUnModule): string | null {
  if (c.suppose.length === 0) return null
  return `Suppose ${c.suppose.map((m) => `« ${LIBELLES_DES_MODULES[m]} »`).join(', ')}.`
}

// ── La confirmation ────────────────────────────────────────────────────────────────────────────────────────────────────

export type MotsDeLaConfirmation = {
  readonly titre: string
  readonly phrases: readonly string[]
  readonly bouton: string
}

/** Ce qu'une fermeture ne fait PAS (§ 3.3, § 4) : rien n'est supprimé, rien ne change dans les chiffres. */
export const RIEN_N_EST_SUPPRIME =
  'Rien n’est supprimé : les données déjà saisies restent en base, comptées dans les chiffres et exportées (sauvegarde, pack, FEC) ; '
  + 'les cases d’accès client déjà cochées le restent, et rouvrir le module rend les écrans tels qu’ils étaient.'

/**
 * La phrase sur les encaissements à déclarer, avant de fermer la facture électronique (OPT1-Q1 (A), recommandée, pas
 * confirmée) : l'écran ne les compte pas ici — le calcul (`pastilleDeclaration`) demande, par dossier, ses factures, leurs
 * lignes, encaissements, déclarations, transmissions et statuts —, et la base ne refuse pas sur eux.
 */
export const ENCAISSEMENTS_A_DECLARER =
  'Avant de fermer, vérifie qu’aucun encaissement des dossiers de ce cabinet ne reste à déclarer sur une plateforme : '
  + 'cet écran ne les compte pas, et la fermeture ne les retient pas.'

/** Ce que la base juge seule, avant de fermer les paiements de l'assurance maladie, quand l'écran n'a pas lu les associations. */
export const ASSURANCE_MALADIE_JUGEE_PAR_LA_BASE =
  'Si un paiement de l’assurance maladie d’un dossier de ce cabinet est associé à un crédit du relevé, la fermeture sera refusée, '
  + 'et le refus nommera les dossiers.'

/** Les mots de la confirmation d'un geste : le cabinet, le module, ce qui s'ouvre ou disparaît des écrans. */
export function motsDeLaConfirmation(cabinet: string, c: CaseDUnModule): MotsDeLaConfirmation {
  const module = `« ${c.libelle} »`
  if (c.geste === 'ouvrir') {
    const phrases = [`Ce qui s’ouvre aux écrans du cabinet « ${cabinet} » : ${CE_QU_OUVRE_LE_MODULE[c.module]}`]
    if (c.ouvreAussi.length > 0) {
      phrases.push(`S’ouvre aussi, que ce module suppose : ${c.ouvreAussi.map((m) => `« ${LIBELLES_DES_MODULES[m]} »`).join(', ')}.`)
    }
    return { titre: `Ouvrir le module ${module} au cabinet « ${cabinet} » ?`, phrases, bouton: 'Ouvrir le module' }
  }
  const phrases = [
    `Ce qui disparaît des écrans du cabinet « ${cabinet} » et de ses clients : ${CE_QU_OUVRE_LE_MODULE[c.module]}`,
    RIEN_N_EST_SUPPRIME,
  ]
  if (c.module === 'facture_electronique') phrases.push(ENCAISSEMENTS_A_DECLARER)
  if (c.module === 'assurance_maladie' && c.jugeParLaBaseSeule) phrases.push(ASSURANCE_MALADIE_JUGEE_PAR_LA_BASE)
  if (c.module === 'tenue') phrases.push(...phrasesDeLaFermetureDeLaTenue(FRONTIERE_DE_LA_TENUE_PREVUE))
  return { titre: `Fermer le module ${module} au cabinet « ${cabinet} » ?`, phrases, bouton: 'Fermer le module' }
}
