import {
  jugerLaSaisie, jugerLaSaisieDUnMois, jugerLeRemplacement, jugerLeRetrait, premierJourNegatif, texteCaisseNegative,
  type DossierDeLaCaisse, type EtatDeLaCaisse, type OperationDeLaCaisse, type RefusCaisse, type SaisieDeCaisse,
} from '../lib/caisse'
import { refusCompteDeBilanAuPlanSelon } from '../lib/compteDeBilan'
import { PLAN_PAR_DEFAUT, type CleRoleComptable, type PlanComptable } from '../lib/planComptable'
import type { OrigineOperationCaisse } from '../lib/types'

// L'ESSAI DE LA CAISSE REJOUÉ PAR LE MODULE (ligne 26.6, étape C2). `supabase/essais/caisse.sql` joue, étape après étape,
// les fonctions de la caisse sur des dossiers jetables ; ce banc rejoue les MÊMES étapes, dans le même ordre, sur un état
// tenu en mémoire, en demandant chaque verdict à lib/caisse.ts : ce que la base a répondu (le code, et le message ou son
// motif LIKE) doit être ce que le module dit. Ce que le module ne porte pas — les droits d'exécution d'un rôle de l'API,
// la RLS, les gardes et les contraintes jouées en direct, une lecture du catalogue, une instruction que ce banc ne sait
// pas lire — se COMPTE à part, jamais en silence : une étape qui écrit et qu'on ne sait pas rejouer met hors jeu les
// dossiers qu'elle nomme, et toute étape qui suit sur eux est comptée « hors jeu ».
//
// La fin de la transaction est rejouée comme la base la juge : les déclencheurs DIFFÉRÉS de la caisse (`garder_la_caisse`),
// un par ligne écrite, dans l'ordre des écritures, chacun avec sa condition (ce qu'il apportait à la caisse avant et
// après, à son jour) et les mots de son geste.

export interface EtapeDeLEssai {
  genre: string
  titre: string
  profil: string
  sql: string
  code: string
  attendu: string
}

const GENRES = /\n {4}array\['((?:jeu|controle|fait|valeur|capture)2?)', /g

/** Les littéraux SQL qui suivent, joints : `'a' || 'b'` rend `ab` ; l'apostrophe doublée rendue simple. */
function litteraux(texte: string): string[] {
  return [...texte.matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'"))
}

/** Les étapes de l'essai, dans l'ordre, chacune lue dans son propre morceau de texte. */
export function etapesDeLEssai(essai: string): EtapeDeLEssai[] {
  const debuts = [...essai.matchAll(GENRES)].map((m) => m.index!)
  return debuts.map((debut, i) => {
    const morceau = essai.slice(debut, debuts[i + 1] ?? essai.length)
    const genre = /array\['(\w+)'/.exec(morceau)![1]
    const ouverture = morceau.indexOf('$q$')
    const fermeture = morceau.indexOf('$q$', ouverture + 3)
    const tete = litteraux(morceau.slice(0, ouverture))
    const queue = morceau.slice(fermeture + 3, morceau.lastIndexOf(']'))
    const [code, ...reste] = litteraux(queue)
    return { genre, titre: tete[1], profil: tete[2], sql: morceau.slice(ouverture + 3, fermeture), code, attendu: reste.join('') }
  })
}

/** Les identifiants fixes de l'essai (`ids := jsonb_build_object('T', '…', …)`), par leur nom. */
export function identifiantsDeLEssai(essai: string): Map<string, string> {
  const ids = new Map<string, string>()
  const debut = essai.indexOf('ids := jsonb_build_object(')
  const fin = essai.indexOf(';', debut)
  for (const m of essai.slice(debut, fin).matchAll(/'(\w+)', '([0-9a-f-]{36})'/g)) ids.set(m[1], m[2])
  return ids
}

// ── Le découpage du SQL ──────────────────────────────────────────────────────────────────────────────────────────────

/** Coupe sur un séparateur de premier niveau, hors chaînes et hors parenthèses. */
function couper(texte: string, separateur: string): string[] {
  const parts: string[] = []
  let profondeur = 0
  let chaine = false
  let courant = ''
  for (const car of texte) {
    if (car === "'") chaine = !chaine
    if (!chaine && (car === '(' || car === '[')) profondeur++
    if (!chaine && (car === ')' || car === ']')) profondeur--
    if (!chaine && profondeur === 0 && car === separateur) {
      parts.push(courant)
      courant = ''
    } else courant += car
  }
  parts.push(courant)
  return parts.map((p) => p.trim()).filter((p) => p !== '')
}

type Valeur = string | number | boolean | null | { tableau: (string | null)[] } | { opaque: string }

/** Une valeur littérale SQL : une chaîne, un nombre, nul, un booléen, un tableau d'identifiants ; sinon opaque. */
function valeur(texte: string): Valeur {
  const t = texte.trim()
  if (/^null$/i.test(t)) return null
  if (/^(true|false)$/i.test(t)) return t.toLowerCase() === 'true'
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t)
  const chaine = /^'((?:[^']|'')*)'$/.exec(t)
  if (chaine) return chaine[1].replace(/''/g, "'")
  const tableau = /^array\[(.*)\]::uuid\[\]$/s.exec(t)
  if (tableau) return { tableau: couper(tableau[1], ',').map((x) => valeur(x) as string | null) }
  return { opaque: t }
}

const estOpaque = (v: Valeur): v is { opaque: string } => typeof v === 'object' && v !== null && 'opaque' in v

/** Un tableau d'identifiants tel que l'appel le passe : `'{}'`, `'{a,b}'`, `array[…]::uuid[]`, nul. */
function identifiants(v: Valeur): (string | null)[] | null | undefined {
  if (v === null) return null
  if (typeof v === 'string') {
    const m = /^\{(.*)\}$/.exec(v)
    if (!m) return undefined
    return m[1] === '' ? [] : m[1].split(',').map((x) => (x === 'NULL' ? null : x))
  }
  if (typeof v === 'object' && 'tableau' in v) return v.tableau
  return undefined
}

// ── L'état ───────────────────────────────────────────────────────────────────────────────────────────────────────────

interface DossierSimule {
  id: string
  cabinet: string
  mode: 'tresorerie' | 'engagement'
  notesDeFrais: string
  assujetti: boolean
  source: boolean
  plan: Partial<Record<CleRoleComptable, string>>
}

interface Etat {
  dossiers: Map<string, DossierSimule>
  categories: { id: string; dossier_id: string | null; libelle: string; compte_comptable: string | null }[]
  ouvertures: { id: string; dossier_id: string; date: string; compte: string; sens: 'debit' | 'credit'; montant: number }[]
  operations: (OperationDeLaCaisse & { dossier_id: string })[]
  mouvements: { id: string; dossier_id: string; date: string; montant: number; compte_bilan: string | null }[]
  validees: { dossier_id: string; annee: number }[]
  pieces: { id: string; dossier_id: string }[]
  horsJeu: Set<string>
}

const copier = (e: Etat): Etat => ({
  dossiers: new Map(e.dossiers), categories: [...e.categories], ouvertures: e.ouvertures.map((x) => ({ ...x })),
  operations: e.operations.map((x) => ({ ...x })), mouvements: e.mouvements.map((x) => ({ ...x })), validees: [...e.validees],
  horsJeu: new Set(e.horsJeu), pieces: [...e.pieces],
})

function planDe(e: Etat, dossierId: string): PlanComptable {
  return { ...PLAN_PAR_DEFAUT, ...(e.dossiers.get(dossierId)?.plan ?? {}) }
}

function caisseDe(e: Etat, dossierId: string): EtatDeLaCaisse {
  return {
    compteCaisse: planDe(e, dossierId).caisse,
    ouvertures: e.ouvertures.filter((a) => a.dossier_id === dossierId),
    operations: e.operations.filter((o) => o.dossier_id === dossierId),
    mouvements: e.mouvements.filter((l) => l.dossier_id === dossierId),
    // Le registre des encaissements ne se rejoue pas ici : une étape qui l'écrit met son dossier hors jeu.
    encaissements: [],
    factures: [],
  }
}

/** Le dossier tel que les fonctions de la caisse le lisent, sous un profil de l'essai. */
function dossierLu(e: Etat, dossierId: string, quiEcrit: OrigineOperationCaisse | null, aujourdhui: string): DossierDeLaCaisse {
  const d = e.dossiers.get(dossierId)!
  const ouvertures = e.ouvertures.filter((a) => a.dossier_id === dossierId).map((a) => a.date).sort()
  return {
    quiEcrit, utilisateur: 'chef', aujourdhui,
    modele: { mode: d.mode, compteNotesDeFrais: d.notesDeFrais, plan: planDe(e, dossierId) },
    assujetti: d.assujetti, ouverture: ouvertures[0] ?? null,
    anneesValidees: e.validees.filter((v) => v.dossier_id === dossierId).map((v) => v.annee),
    categories: e.categories.filter((c) => c.dossier_id == null || c.dossier_id === dossierId),
    caisse: caisseDe(e, dossierId),
  }
}

// ── Les déclencheurs différés de la caisse ───────────────────────────────────────────────────────────────────────────

/** Une ligne écrite, telle que `garder_la_caisse` la reçoit : la table, son dossier et sa caisse avant et après. */
interface Evenement {
  table: 'operations_caisse' | 'lignes_bancaires' | 'a_nouveaux'
  op: 'INSERT' | 'UPDATE'
  dossierAvant: string | null
  dossierApres: string
  // Ce que la ligne apportait à la caisse avant, et ce qu'elle y apporte après, en centimes, à son jour.
  avant: number
  apres: number
  jourAvant: string | null
  jourApres: string
  geste: string | null
  montant: number
}

const centimes = (m: number) => Math.round(m * 100)

function judgerALaFin(e: Etat, evenements: readonly Evenement[]): RefusCaisse | null {
  for (const ev of evenements) {
    if (ev.avant === 0 && ev.apres === 0) continue
    let dossiers: string[]
    if (ev.op === 'UPDATE' && ev.dossierAvant !== ev.dossierApres) {
      dossiers = [ev.avant > 0 ? ev.dossierAvant : null, ev.apres < 0 ? ev.dossierApres : null]
        .filter((x): x is string => x != null).sort()
    } else {
      const jAvant = ev.op === 'INSERT' ? ev.jourApres : ev.jourAvant ?? ev.jourApres
      const jApres = ev.jourApres
      if (ev.apres >= ev.avant && (jApres >= jAvant || ev.apres >= 0) && (jAvant >= jApres || ev.avant <= 0)) continue
      dossiers = [ev.dossierApres]
    }
    for (const d of dossiers) {
      if (!e.dossiers.has(d)) continue
      const negatif = premierJourNegatif(caisseDe(e, d))
      if (negatif) return { code: '23514', message: texteCaisseNegative(ev.geste ?? 'autre', ev.montant, negatif.jour, negatif.centimes) }
    }
  }
  return null
}

const apportDe = (o: { genre: string; montant: number; retire_le: string | null }) =>
  o.retire_le != null ? 0 : (o.genre === 'prelevement' ? -1 : 1) * centimes(o.montant)

// ── Le rejeu ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export type Issue =
  | { genre: 'jugee'; etape: EtapeDeLEssai; recu: RefusCaisse | null; juste: boolean }
  | { genre: 'hors_module'; etape: EtapeDeLEssai; raison: string }
  | { genre: 'hors_jeu'; etape: EtapeDeLEssai; raison: string }

class NonRejouable extends Error {}

/** Un motif LIKE de l'essai : « % » pour toute suite, « _ » pour un caractère. */
export function commeLike(motif: string, texte: string): boolean {
  const regex = motif.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '[\\s\\S]*').replace(/_/g, '.')
  return new RegExp(`^${regex}$`).test(texte)
}

/**
 * Rejoue l'essai : chaque étape, sous son profil, sur l'état qu'ont laissé les jeux et les faits d'avant ; un contrôle se
 * joue sur une copie, jetée ensuite, comme sa sous-transaction annulée. `aujourdhui` est le jour à Paris où l'essai se
 * joue ; « demain » le suit.
 */
export function rejouerLEssai(essai: string, aujourdhui: string): Issue[] {
  const ids = identifiantsDeLEssai(essai)
  const demain = new Date(`${aujourdhui}T12:00:00Z`)
  demain.setUTCDate(demain.getUTCDate() + 1)
  ids.set('CAB', 'cabinet-du-dossier-test').set('DC', 'dossier-du-client').set('CHEF', 'chef')
    .set('DEMAIN', demain.toISOString().slice(0, 10))
  const captures = new Set<string>()
  let etat: Etat = {
    dossiers: new Map(), categories: [], ouvertures: [], operations: [], mouvements: [], validees: [], pieces: [],
    // Le dossier du client vit en production : sa caisse s'y lit, pas ici.
    horsJeu: new Set(['dossier-du-client']),
  }
  let compteur = 0
  const issues: Issue[] = []

  for (const etape of etapesDeLEssai(essai)) {
    let sql = etape.sql
    for (const [cle, v] of ids) sql = sql.split(`{${cle}}`).join(v)
    const genre = etape.genre.replace(/2$/, '')
    const nommes = [...etat.dossiers.keys(), 'dossier-du-client'].filter((d) => sql.includes(d))

    if (genre === 'valeur') { issues.push({ genre: 'hors_module', etape, raison: 'une lecture : la base, pas le module' }); continue }
    if (genre === 'capture') {
      // Les conditions d'une capture : le dossier, le genre, le signe du montant, la date, l'opération remplacée.
      const m = /^select o\.id::text from operations_caisse o where (.*)$/.exec(sql.trim())
      const conditions = m ? m[1].split(' and ').map((c) => {
        const egal = /^o\.(dossier_id|genre|date|remplace_id) = '([^']+)'$/.exec(c)
        if (egal) return (o: OperationDeLaCaisse & { dossier_id: string }) => String(o[egal[1] as 'genre']) === egal[2]
        const signe = /^o\.montant ([<>]) 0$/.exec(c)
        if (signe) return (o: OperationDeLaCaisse) => (signe[1] === '>' ? o.montant > 0 : o.montant < 0)
        return null
      }) : [null]
      const lisible = conditions.every((c) => c != null)
      const trouvees = lisible ? etat.operations.filter((o) => conditions.every((c) => c!(o))) : []
      if (trouvees.length === 1) {
        ids.set(etape.code, trouvees[0].id)
        captures.add(etape.code)
      }
      issues.push({ genre: 'hors_module', etape, raison: trouvees.length === 1 ? 'capturée' : 'capture illisible' })
      continue
    }
    if (/\{[A-Z0-9]+\}/.test(sql)) { issues.push({ genre: 'hors_jeu', etape, raison: 'une capture manque' }); continue }
    if (etape.profil === 'anon') { issues.push({ genre: 'hors_module', etape, raison: 'le droit d’exécution d’un rôle de l’API' }); continue }

    const sur = genre === 'controle' ? copier(etat) : etat
    const evenements: Evenement[] = []
    const pas = { restauration: false }
    const quiEcrit = (dossierId: string): OrigineOperationCaisse | null => {
      const d = sur.dossiers.get(dossierId) ?? (dossierId === 'dossier-du-client' ? { cabinet: 'cabinet-du-dossier-test' } : null)
      if (!d) return null
      if (etape.profil === 'chef') return d.cabinet === 'cabinet-du-dossier-test' ? 'cabinet' : null
      if (etape.profil === 'autre') return d.cabinet === ids.get('AUTRE') ? 'cabinet' : null
      return null
    }
    let recu: RefusCaisse | null = null
    try {
      if (nommes.some((d) => etat.horsJeu.has(d)) && !(etape.profil !== 'chef' && etape.profil !== 'autre')) {
        throw new NonRejouable('un dossier hors jeu')
      }
      for (const instruction of couper(sql, ';')) {
        recu = rejouer(instruction, sur, evenements, etape.profil, quiEcrit, aujourdhui, () => `simulee-${++compteur}`, pas)
        if (recu) break
      }
      if (!recu) recu = judgerALaFin(sur, evenements)
    } catch (x) {
      if (!(x instanceof NonRejouable)) throw x
      if (genre === 'fait' || genre === 'jeu') for (const d of nommes) etat.horsJeu.add(d)
      issues.push({ genre: nommes.some((d) => etat.horsJeu.has(d)) ? 'hors_jeu' : 'hors_module', etape, raison: x.message })
      continue
    }
    if (genre === 'jeu') {
      if (recu) throw new Error(`le jeu « ${etape.titre} » est refusé : ${recu.message}`)
      issues.push({ genre: 'hors_module', etape, raison: 'le jeu, posé' })
      continue
    }
    const juste = etape.code === 'OK'
      ? recu == null
      : recu != null && recu.code === etape.code && commeLike(etape.attendu.replace(/’/g, "'"), recu.message.replace(/’/g, "'"))
    issues.push({ genre: 'jugee', etape, recu, juste })
    if (genre === 'fait' && recu) {
      for (const d of nommes) etat.horsJeu.add(d)
    }
  }
  return issues
}

function insertions(instruction: string): { table: string; lignes: Record<string, Valeur>[] } | null {
  const m = /^insert into (\w+) \(([^)]*)\)\s+values\s*([\s\S]*)$/i.exec(instruction)
  if (!m) return null
  const colonnes = m[2].split(',').map((c) => c.trim())
  const tuples = couper(m[3], ',').map((t) => {
    const n = /^\(([\s\S]*)\)$/.exec(t)
    if (!n) throw new NonRejouable('des valeurs illisibles')
    return couper(n[1], ',').map(valeur)
  })
  return { table: m[1], lignes: tuples.map((t) => Object.fromEntries(colonnes.map((c, i) => [c, t[i]]))) }
}

const texte = (v: Valeur | undefined): string => {
  if (typeof v !== 'string') throw new NonRejouable('une valeur attendue en texte')
  return v
}
const nombre = (v: Valeur | undefined): number => {
  if (typeof v !== 'number') throw new NonRejouable('une valeur attendue en nombre')
  return v
}

function arguments_(appel: string, fonction: string): Valeur[] {
  const m = new RegExp(`^select ${fonction}\\(([\\s\\S]*)\\)$`).exec(appel)
  if (!m) throw new NonRejouable(`un appel illisible de ${fonction}`)
  const args = couper(m[1], ',').map(valeur)
  if (args.some(estOpaque)) throw new NonRejouable('un argument calculé en base')
  return args
}

function saisieDe(args: readonly Valeur[]): SaisieDeCaisse {
  const encaissements = identifiants(args[5])
  if (encaissements === undefined) throw new NonRejouable('un ensemble du jour illisible')
  return {
    genre: args[0] as string | null, date: args[1] as string | null, montant: args[2] as number | null,
    categorie_id: args[3] as string | null, taux_tva: args[4] as number | null, encaissements_du_jour: encaissements,
    ecritures: typeof args[6] === 'string' ? JSON.parse(args[6]) : args[6],
  }
}

// Une instruction de l'étape, rejouée sur l'état : son refus, ou rien (et l'état avancé, les lignes écrites notées).
function rejouer(instruction: string, e: Etat, evenements: Evenement[], profil: string,
  quiEcrit: (d: string) => OrigineOperationCaisse | null, aujourdhui: string, nouvelId: () => string,
  pas: { restauration: boolean }): RefusCaisse | null {
  const appel = instruction.replace(/\s+/g, ' ').trim()
  if (/^select set_config\('request\.jwt\.claims'/.test(appel)) return null
  const lues = insertions(instruction.trim())
  if (lues) {
    // LA RESTAURATION : le super-administrateur réinsère une opération avec l'instant de création qu'elle avait,
    // antérieur à la transaction — la porte de la garde et des déclencheurs —, puis les écritures qui la citent.
    if (lues.table === 'operations_caisse' && profil === 'chef' && lues.lignes.every((l) => l.cree_le !== undefined)) {
      for (const l of lues.lignes) {
        const refus = reinserer(e, l)
        if (refus) return refus
      }
      pas.restauration = true
      return null
    }
    if (lues.table === 'ecritures_brouillon' && pas.restauration) {
      // La garde de l'écriture (`garder_ecriture_de_caisse`) : elle suit son opération — son dossier, son jour, une
      // opération non retirée, et la pièce d'un paiement seulement.
      for (const l of lues.lignes) {
        const o = e.operations.find((x) => x.id === l.operation_caisse_id)
        const piece = (l.piece_id ?? null) as string | null
        if (!o || o.dossier_id !== l.dossier_id || o.date !== l.date || o.retire_le != null || (piece != null && piece !== o.piece_id)) {
          return { code: '23514', message: 'Cette écriture ne suit pas son opération de caisse : son dossier, sa date, ou sa pièce.' }
        }
      }
      return null
    }
    if (profil !== 'postgres' && !['lignes_bancaires', 'a_nouveaux'].includes(lues.table)) throw new NonRejouable('une écriture directe')
    for (const l of lues.lignes) inserer(e, lues.table, l, evenements)
    return null
  }
  const maj = /^update (lignes_bancaires|a_nouveaux) set (.*) where id = '([^']+)'$/.exec(appel)
  if (maj) {
    mettreAJour(e, maj[1] as 'lignes_bancaires' | 'a_nouveaux', maj[3], couper(maj[2], ','), evenements)
    return null
  }
  if (profil === 'postgres') throw new NonRejouable('un appel du propriétaire')
  if (appel.startsWith('select enregistrer_operation_caisse(')) {
    const args = arguments_(appel, 'enregistrer_operation_caisse')
    const d = texte(args[0])
    if (!e.dossiers.has(d) && quiEcrit(d) != null) throw new NonRejouable('un dossier hors jeu')
    const qui = quiEcrit(d)
    if (qui == null) return { code: '42501', message: 'Accès refusé à ce dossier.' }
    const id = nouvelId()
    const jugee = jugerLaSaisie(saisieDe(args.slice(1)), dossierLu(e, d, qui, aujourdhui), false, id)
    if (jugee.refus) return jugee.refus
    ajouter(e, d, jugee.operation, evenements)
    return null
  }
  if (appel.startsWith('select enregistrer_operations_de_caisse(')) {
    const args = arguments_(appel, 'enregistrer_operations_de_caisse')
    const d = texte(args[0])
    const qui = quiEcrit(d)
    if (qui == null) return { code: '42501', message: 'Accès refusé à ce dossier.' }
    if (!e.dossiers.has(d)) throw new NonRejouable('un dossier hors jeu')
    const jugee = jugerLaSaisieDUnMois(JSON.parse(texte(args[1])), dossierLu(e, d, qui, aujourdhui))
    if (jugee.refus) return jugee.refus
    for (const o of jugee.caisse.operations.filter((x) => jugee.ids.includes(x.id))) ajouter(e, d, { ...o, id: nouvelId() }, evenements)
    return null
  }
  if (appel.startsWith('select retirer_operation_caisse(')) {
    const args = arguments_(appel, 'retirer_operation_caisse')
    const d = texte(args[0])
    const qui = quiEcrit(d)
    if (qui == null) return { code: '42501', message: 'Accès refusé à ce dossier.' }
    if (!e.dossiers.has(d)) throw new NonRejouable('un dossier hors jeu')
    const jugee = jugerLeRetrait(args[1] as string | null, dossierLu(e, d, qui, aujourdhui), 'maintenant')
    if (jugee.refus) return jugee.refus
    retirer(e, args[1] as string, evenements)
    return null
  }
  if (appel.startsWith('select remplacer_operation_caisse(')) {
    const args = arguments_(appel, 'remplacer_operation_caisse')
    const d = texte(args[0])
    const qui = quiEcrit(d)
    if (qui == null) return { code: '42501', message: 'Accès refusé à ce dossier.' }
    if (!e.dossiers.has(d)) throw new NonRejouable('un dossier hors jeu')
    const id = nouvelId()
    const jugee = jugerLeRemplacement(args[1] as string | null, saisieDe(args.slice(2)), dossierLu(e, d, qui, aujourdhui), 'maintenant', id)
    if (jugee.refus) return jugee.refus
    retirer(e, args[1] as string, evenements)
    ajouter(e, d, jugee.operation, evenements)
    return null
  }
  if (appel.startsWith('select ecrire_mouvement_compte_bilan(')) {
    const args = arguments_(appel, 'ecrire_mouvement_compte_bilan')
    const ligne = e.mouvements.find((l) => l.id === texte(args[0]))
    if (!ligne || !e.dossiers.has(ligne.dossier_id)) throw new NonRejouable('un mouvement hors jeu')
    const d = e.dossiers.get(ligne.dossier_id)!
    if (quiEcrit(ligne.dossier_id) == null) return { code: '42501', message: 'Accès refusé à ce mouvement.' }
    const compte = texte(args[1])
    const plan = planDe(e, ligne.dossier_id)
    const refus = refusCompteDeBilanAuPlanSelon(compte, d.mode, d.mode === 'engagement' ? d.notesDeFrais : plan.exploitant, plan, true)
    if (refus) return { code: '22023', message: refus }
    // L'écriture attendue, comme la fonction la compare : la banque du plan au montant et dans le sens du mouvement, le
    // compte choisi en face, en multiensemble (lib/compteDeBilan.ts, `ecritureDuCompteDeBilan`, la compose ainsi).
    const sens = ligne.montant > 0 ? ['debit', 'credit'] : ['credit', 'debit']
    const attendues = [`${plan.banque} ${sens[0]} ${centimes(Math.abs(ligne.montant))}`, `${compte} ${sens[1]} ${centimes(Math.abs(ligne.montant))}`].sort()
    const recues = (JSON.parse(texte(args[2])) as { compte: string; sens: string; montant: number }[])
      .map((l) => `${l.compte} ${l.sens} ${centimes(l.montant)}`).sort()
    if (recues.join('|') !== attendues.join('|')) {
      return { code: '22023', message: 'L’écriture proposée ne correspond pas à ce mouvement et à ce compte.' }
    }
    mettreAJour(e, 'lignes_bancaires', ligne.id, [`compte_bilan = '${compte}'`], evenements)
    return null
  }
  throw new NonRejouable('une instruction que ce banc ne rejoue pas')
}

// Une opération réinsérée par la restauration, sous la garde de la table (`garder_operation_caisse`) : la porte ne
// s'ouvre que dans un dossier sans exercice validé ; la catégorie, la pièce et l'opération remplacée sont de son dossier.
// Aucun déclencheur ne la juge : son instant de création précède la transaction.
function reinserer(e: Etat, l: Record<string, Valeur>): RefusCaisse | null {
  const dossierId = texte(l.dossier_id)
  if (!e.dossiers.has(dossierId)) throw new NonRejouable('un dossier hors jeu')
  if (e.validees.some((v) => v.dossier_id === dossierId)) {
    return { code: '42501', message: 'Une opération de caisse ne s\'écrit que par les fonctions de la caisse, avec son écriture.' }
  }
  const categorie = (l.categorie_id ?? null) as string | null
  if (categorie != null && !e.categories.some((c) => c.id === categorie && (c.dossier_id == null || c.dossier_id === dossierId))) {
    return { code: '23514', message: 'La catégorie d\'une opération de caisse est une catégorie de son dossier, ou commune.' }
  }
  const piece = (l.piece_id ?? null) as string | null
  if (piece != null && !e.pieces.some((p) => p.id === piece && p.dossier_id === dossierId)) {
    return { code: '23514', message: 'La pièce d\'un paiement par la caisse est une pièce de son dossier.' }
  }
  const remplace = (l.remplace_id ?? null) as string | null
  if (remplace != null && !e.operations.some((o) => o.id === remplace && o.dossier_id === dossierId)) {
    return { code: '23514', message: 'Une opération de caisse ne remplace qu\'une opération de son dossier.' }
  }
  const encaissements = identifiants(l.encaissements_du_jour ?? null)
  e.operations.push({
    id: texte(l.id), dossier_id: dossierId, genre: texte(l.genre) as OperationDeLaCaisse['genre'], date: texte(l.date),
    montant: nombre(l.montant), categorie_id: categorie, taux_tva: (l.taux_tva ?? null) as number | null,
    encaissements_du_jour: encaissements === undefined ? null : (encaissements as string[] | null), piece_id: piece,
    origine: texte(l.origine) as OrigineOperationCaisse, remplace_id: remplace, cree_par: 'chef',
    retire_le: (l.retire_le ?? null) as string | null,
  })
  return null
}

function ajouter(e: Etat, dossierId: string, o: OperationDeLaCaisse, evenements: Evenement[]): void {
  e.operations.push({ ...o, dossier_id: dossierId })
  const apres = apportDe(o)
  evenements.push({
    table: 'operations_caisse', op: 'INSERT', dossierAvant: null, dossierApres: dossierId, avant: 0, apres, jourAvant: null,
    jourApres: o.date, montant: centimes(o.montant),
    geste: o.genre === 'prelevement' ? 'prelevement' : o.genre === 'recette' ? 'especes_rendues' : o.genre === 'paiement' ? 'paiement' : null,
  })
}

function retirer(e: Etat, operationId: string, evenements: Evenement[]): void {
  const o = e.operations.find((x) => x.id === operationId)!
  const avant = apportDe(o)
  o.retire_le = 'maintenant'
  evenements.push({
    table: 'operations_caisse', op: 'UPDATE', dossierAvant: o.dossier_id, dossierApres: o.dossier_id, avant, apres: 0,
    jourAvant: o.date, jourApres: o.date, montant: centimes(o.montant),
    geste: o.genre === 'recette' ? 'retrait_recette' : o.genre === 'apport' ? 'retrait_apport' : o.genre === 'paiement' ? 'retrait_paiement' : null,
  })
}

function inserer(e: Etat, table: string, l: Record<string, Valeur>, evenements: Evenement[]): void {
  if (table === 'dossiers') {
    e.dossiers.set(texte(l.id), {
      id: texte(l.id), cabinet: texte(l.cabinet_id), mode: (l.mode_comptable ?? 'tresorerie') as DossierSimule['mode'],
      notesDeFrais: (l.compte_notes_de_frais ?? '455000') as string, assujetti: l.statut_tva === 'redevable' || l.assujetti_tva === true,
      source: l.ventes_par_les_factures === true, plan: {},
    })
  } else if (table === 'categories') {
    e.categories.push({ id: texte(l.id), dossier_id: l.dossier_id as string | null, libelle: texte(l.libelle), compte_comptable: l.compte_comptable as string | null })
  } else if (table === 'lignes_bancaires') {
    if (l.created_at !== undefined) throw new NonRejouable('un mouvement réinséré par la restauration')
    const ligne = { id: texte(l.id), dossier_id: texte(l.dossier_id), date: texte(l.date), montant: nombre(l.montant), compte_bilan: (l.compte_bilan ?? null) as string | null }
    e.mouvements.push(ligne)
    if (ligne.compte_bilan?.startsWith('53')) {
      const apres = ligne.compte_bilan === planDe(e, ligne.dossier_id).caisse ? -centimes(ligne.montant) : 0
      evenements.push({ table: 'lignes_bancaires', op: 'INSERT', dossierAvant: null, dossierApres: ligne.dossier_id, avant: 0, apres,
        jourAvant: null, jourApres: ligne.date, montant: apres, geste: apres < 0 ? 'versement' : 'mouvement_change' })
    }
  } else if (table === 'a_nouveaux') {
    if (l.created_at !== undefined) throw new NonRejouable('une ouverture réinsérée par la restauration')
    const a = { id: texte(l.id), dossier_id: texte(l.dossier_id), date: texte(l.date), compte: texte(l.compte), sens: texte(l.sens) as 'debit' | 'credit', montant: nombre(l.montant) }
    e.ouvertures.push(a)
    if (a.compte.startsWith('53')) {
      const apres = a.compte === planDe(e, a.dossier_id).caisse ? (a.sens === 'debit' ? 1 : -1) * centimes(a.montant) : 0
      evenements.push({ table: 'a_nouveaux', op: 'INSERT', dossierAvant: null, dossierApres: a.dossier_id, avant: 0, apres,
        jourAvant: null, jourApres: a.date, montant: apres, geste: apres < 0 ? 'ouverture_au_credit' : 'ouverture_change' })
    }
  } else if (table === 'plan_comptable_dossier') {
    const d = e.dossiers.get(texte(l.dossier_id))
    if (!d) throw new NonRejouable('le plan d’un dossier hors jeu')
    d.plan = { ...d.plan, [texte(l.role)]: texte(l.compte) }
  } else if (table === 'exercices_valides') {
    e.validees.push({ dossier_id: texte(l.dossier_id), annee: nombre(l.annee) })
  } else if (table === 'pieces') {
    e.pieces.push({ id: texte(l.id), dossier_id: texte(l.dossier_id) })
  } else if (!['cabinets', 'cabinet_admins'].includes(table)) {
    throw new NonRejouable(`une insertion dans ${table}`)
  }
}

function mettreAJour(e: Etat, table: 'lignes_bancaires' | 'a_nouveaux', id: string, affectations: readonly string[], evenements: Evenement[]): void {
  const changements = Object.fromEntries(affectations.map((a) => {
    const m = /^(\w+) = (.*)$/.exec(a.trim())
    if (!m) throw new NonRejouable('une affectation illisible')
    return [m[1], valeur(m[2])]
  }))
  if (table === 'lignes_bancaires') {
    const l = e.mouvements.find((x) => x.id === id)
    if (!l) throw new NonRejouable('un mouvement inconnu')
    const avant = { ...l }
    for (const [c, v] of Object.entries(changements)) {
      if (c === 'compte_bilan') l.compte_bilan = v as string | null
      else if (c === 'date') l.date = texte(v)
      else if (c === 'dossier_id') l.dossier_id = texte(v)
      else if (c !== 'statut' && c !== 'libelle') throw new NonRejouable(`la colonne ${c} d’un mouvement`)
    }
    if (!avant.compte_bilan?.startsWith('53') && !l.compte_bilan?.startsWith('53')) return
    const apport = (x: typeof l) => (x.compte_bilan === planDe(e, x.dossier_id).caisse ? -centimes(x.montant) : 0)
    const va = apport(avant)
    const vp = apport(l)
    evenements.push({
      table: 'lignes_bancaires', op: 'UPDATE', dossierAvant: avant.dossier_id, dossierApres: l.dossier_id, avant: va, apres: vp,
      jourAvant: avant.date, jourApres: l.date,
      geste: vp < 0 ? 'versement' : va > 0 && vp === 0 ? 'retrait_d_especes_retire' : 'mouvement_change',
      montant: vp < 0 ? vp : va > 0 && vp === 0 ? va : vp,
    })
    return
  }
  const a = e.ouvertures.find((x) => x.id === id)
  if (!a) throw new NonRejouable('une ouverture inconnue')
  const avant = { ...a }
  for (const [c, v] of Object.entries(changements)) {
    if (c === 'montant') a.montant = nombre(v)
    else if (c === 'compte') a.compte = texte(v)
    else if (c === 'sens') a.sens = texte(v) as 'debit' | 'credit'
    else throw new NonRejouable(`la colonne ${c} d’une ouverture`)
  }
  const apport = (x: typeof a) => (x.compte === planDe(e, x.dossier_id).caisse ? (x.sens === 'debit' ? 1 : -1) * centimes(x.montant) : 0)
  const va = apport(avant)
  const vp = apport(a)
  evenements.push({
    table: 'a_nouveaux', op: 'UPDATE', dossierAvant: avant.dossier_id, dossierApres: a.dossier_id, avant: va, apres: vp,
    jourAvant: avant.date, jourApres: a.date,
    geste: vp < 0 ? 'ouverture_au_credit' : va > 0 && vp === 0 ? 'retrait_ouverture' : 'ouverture_change',
    montant: vp < 0 ? vp : va > 0 && vp === 0 ? va : vp,
  })
}
