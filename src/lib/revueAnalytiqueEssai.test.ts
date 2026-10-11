import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  centimesDeLa2035Validee, centimesDuNavigateur, centimesDuRepereAnnuel, REFUS_EXPLIQUER_VARIATION, REFUS_FIXER_SEUIL,
  refusDExpliquerVariation, refusDeFixerSeuil, sourceDuPrecedent, type ArgumentsExpliquerVariation, type ArgumentsFixerSeuil,
  type CleDeLigne, type ContexteDeLExplication, type ContexteDuSeuil, type ReperesAnnuels,
} from './revueAnalytique'
import type { EcritureBrouillon, ObjetExplicationRevue } from './types'
import { ecriture } from '../test/revision'

// L'ESSAI DE L'ÉTAPE R5, REJOUÉ SUR LE MODULE. supabase/essais/revueAnalytique.sql joue `fixer_seuil_de_signification` et
// `expliquer_variation` sous six profils : chacun de ses appels attend un refus, sous son code et ses mots, ou
// l'écriture. Ce test LIT le fichier, rejoue son jeu (les dossiers, les écritures, les exercices validés et leur 2035, les
// repères, les rôles, les seuils et les explications posés par le propriétaire), puis chaque appel dans l'ordre, sous le
// profil de l'essai, et exige du module la même réponse : les refus que l'écran dira avant le clic sont ceux que la base a
// dits. Ce que l'essai écrit (« fait ») s'écrit ici aussi ; un contrôle s'annule. Les appels de l'anonyme ne passent pas
// la fonction — la base refuse de l'exécuter — : ils se comptent à part. Les quatre lectures des fonctions internes
// (contrôles 203 à 206) se rejouent sur leurs jumeaux, valeur par valeur.

const ESSAI = readFileSync(new URL('../../supabase/essais/revueAnalytique.sql', import.meta.url), 'utf8')
const ANNEE_COURANTE = 2026
const CHEF = 'c4ef0000-0000-4000-8000-000000000001'
const CLIENT = 'c1e40000-0000-4000-8000-000000000001'

// ── Les identifiants et les valeurs de l'essai ────────────────────────────────────────────────────────────────────

function identifiants(): Map<string, string> {
  const bloc = /ids := ([\s\S]*?);\n\n/.exec(ESSAI)![1]
  const ids = new Map([...bloc.matchAll(/'([A-Z0-9]+)', '([0-9a-f]{8}-[0-9a-f-]{27})'/g)].map((m) => [m[1], m[2]]))
  const valeurs: Record<string, string> = {
    CAB: 'cab00000-0000-4000-8000-000000000001', DC: 'dc000000-0000-4000-8000-000000000001', CHEF, CLIENT, AN: String(ANNEE_COURANTE),
    BLANCS: ' \t\n\r', NBSP: ' ', E4000: 'e'.repeat(4000), E4001: 'e'.repeat(4001), M4000: 'm'.repeat(4000), M4001: 'm'.repeat(4001),
    P500: 'p'.repeat(500), P501: 'p'.repeat(501),
  }
  for (const [cle, valeur] of Object.entries(valeurs)) ids.set(cle, valeur)
  return ids
}

interface Etape { genre: string; nom: string; qui: string; requete: string; code: string; attendu: string }

function etapes(texte: string, ids: Map<string, string>): Etape[] {
  const remplacer = (s: string) => [...ids].reduce((acc, [cle, valeur]) => acc.split(`{${cle}}`).join(valeur), s)
  const sql = (s: string) => s.replace(/''/g, "'")
  return [...texte.matchAll(/array\['(jeu|controle|fait|valeur)', '((?:[^']|'')*)', '(\w+)', \$q\$([\s\S]*?)\$q\$, '((?:[^']|'')*)',\s*'((?:[^']|'')*)'\]/g)]
    .map((m) => ({ genre: m[1], nom: sql(m[2]), qui: m[3], requete: remplacer(m[4]).trim(), code: sql(m[5]), attendu: remplacer(sql(m[6])) }))
}

// ── Le monde de l'essai ───────────────────────────────────────────────────────────────────────────────────────────

interface Monde {
  // Les dossiers que le jeu crée, et leur cabinet.
  dossiers: Map<string, string>
  roles: { utilisateur: string; cabinet: string; role: string }[]
  affectations: { dossier: string; utilisateur: string }[]
  ecritures: EcritureBrouillon[]
  valides: { dossier: string; annee: number; declaration: unknown }[]
  annuels: { dossier: string; annee: number; chiffre_affaires: number | null; resultat_net: number | null }[]
  postes: { dossier: string; annee: number; poste: string; montant: number }[]
  seuils: { id: string; dossier: string; annee: number; remplace_id: string | null; motif: string }[]
  explications: {
    id: string; dossier: string; annee: number; objet_type: ObjetExplicationRevue; objet: string; nature: 'recette' | 'depense' | null
    remplace_id: string | null; explication: string
  }[]
}

type Valeur = string | number | null | { json: unknown }
const json = (v: Valeur) => (v !== null && typeof v === 'object' ? v.json : v)
const texte = (v: Valeur) => (v === null ? null : String(v))
const nombre = (v: Valeur) => (v === null ? null : Number(v))

// Le petit lecteur des valeurs de l'essai : un texte, un nombre, nul, `now()`, `repeat(…)`, une conversion, et les deux
// sous-requêtes qui désignent un seuil par son motif et une explication par son texte.
function lireValeurs(source: string, monde: Monde): Valeur[] {
  let i = 0
  const blancs = () => { while (/\s/.test(source[i] ?? '')) i++ }
  const chaine = (): string => {
    let out = ''
    for (;;) {
      const c = source[i++]
      if (c === undefined) throw new Error('chaîne non fermée')
      if (c === "'") {
        if (source[i] === "'") { out += "'"; i++; continue }
        return out
      }
      out += c
    }
  }
  const SOUS_REQUETES: [string, (t: string) => string | null][] = [
    ['(select id from revision_seuils where motif = ', (t) => monde.seuils.find((s) => s.motif === t)?.id ?? null],
    ['(select id from revision_explications where explication = ', (t) => monde.explications.find((e) => e.explication === t)?.id ?? null],
  ]
  const valeur = (): Valeur => {
    blancs()
    let v: Valeur
    const sous = SOUS_REQUETES.find(([debut]) => source.startsWith(debut, i))
    if (source[i] === "'") { i++; v = chaine() }
    else if (sous !== undefined) {
      i += sous[0].length + 1
      const vise = chaine()
      if (source[i] !== ')') throw new Error(`sous-requête illisible : ${source.slice(i, i + 40)}`)
      i++
      v = sous[1](vise)
    } else if (source.startsWith('null', i)) { i += 4; v = null }
    else if (source.startsWith('now()', i)) { i += 5; v = '2026-03-01T10:00:00Z' }
    else if (source.startsWith('repeat(', i)) {
      i += 7
      const [motif, fois] = [valeur(), (blancs(), source[i] === ',' ? (i++, valeur()) : null)]
      blancs()
      if (source[i] !== ')') throw new Error('repeat illisible')
      i++
      v = String(motif).repeat(Number(fois))
    } else {
      const n = /^-?\d+(?:\.\d+)?/.exec(source.slice(i))
      if (!n) throw new Error(`valeur illisible : ${source.slice(i, i + 40)}`)
      i += n[0].length
      v = Number(n[0])
    }
    for (;;) {
      if (source.startsWith('::jsonb', i)) { i += 7; v = { json: JSON.parse(String(v)) }; continue }
      if (source.startsWith('::numeric', i)) { i += 9; v = Number(v); continue }
      break
    }
    return v
  }
  const valeurs = [valeur()]
  for (;;) {
    blancs()
    if (source[i] === ',') { i++; valeurs.push(valeur()); continue }
    break
  }
  if (i !== source.length) throw new Error(`reste illisible : ${source.slice(i, i + 40)}`)
  return valeurs
}

// Une liste d'uplets entre parenthèses, séparés de virgules : `(…), (…)`.
function uplets(source: string, monde: Monde): Valeur[][] {
  const out: Valeur[][] = []
  let profondeur = 0
  let chaineOuverte = false
  let debut = -1
  for (let i = 0; i < source.length; i++) {
    const c = source[i]
    if (c === "'") chaineOuverte = !chaineOuverte
    if (chaineOuverte) continue
    if (c === '(') { if (profondeur === 0) debut = i + 1; profondeur++ }
    if (c === ')') { profondeur--; if (profondeur === 0) out.push(lireValeurs(source.slice(debut, i), monde)) }
  }
  return out
}

let rang = 0
const nouvelId = () => `f0000000-0000-4000-8000-${String(++rang).padStart(12, '0')}`

function jouerLeJeu(monde: Monde, requete: string): void {
  const insertion = /^insert into (\w+) \(([^)]*)\) values([\s\S]*)$/.exec(requete)
  if (insertion) {
    const [, table, colonnesTexte, reste] = insertion
    const colonnes = colonnesTexte.split(',').map((c) => c.trim())
    for (const valeurs of uplets(reste, monde)) {
      const l = Object.fromEntries(colonnes.map((c, i) => [c, valeurs[i]])) as Record<string, Valeur>
      switch (table) {
        case 'dossiers': monde.dossiers.set(String(l.id), String(l.cabinet_id)); break
        case 'cabinets': break
        case 'cabinet_admins': monde.roles.push({ utilisateur: String(l.user_id), cabinet: String(l.cabinet_id), role: String(l.role) }); break
        case 'dossier_assignations': monde.affectations.push({ dossier: String(l.dossier_id), utilisateur: String(l.user_id) }); break
        case 'ecritures_brouillon':
          monde.ecritures.push(ecriture({
            id: nouvelId(), dossier_id: String(l.dossier_id), date: String(l.date), compte: String(l.compte), montant: Number(l.montant),
            sens: l.sens === 'debit' ? 'debit' : 'credit',
          }))
          break
        case 'exercices_valides':
          monde.valides.push({ dossier: String(l.dossier_id), annee: Number(l.annee), declaration: json(l.declaration) ?? null })
          break
        case 'references_annuelles':
          monde.annuels.push({ dossier: String(l.dossier_id), annee: Number(l.annee), chiffre_affaires: nombre(l.chiffre_affaires), resultat_net: nombre(l.resultat_net) })
          break
        case 'references_postes_annuels':
          monde.postes.push({ dossier: String(l.dossier_id), annee: Number(l.annee), poste: String(l.poste), montant: Number(l.montant) })
          break
        case 'revision_seuils':
          monde.seuils.push({ id: String(l.id), dossier: String(l.dossier_id), annee: Number(l.annee), remplace_id: null, motif: String(l.motif) })
          break
        case 'revision_explications':
          monde.explications.push({
            id: String(l.id), dossier: String(l.dossier_id), annee: Number(l.annee), objet_type: String(l.objet_type) as ObjetExplicationRevue,
            objet: String(l.objet), nature: (texte(l.nature) as 'recette' | 'depense' | null), remplace_id: null, explication: String(l.explication),
          })
          break
        default: throw new Error(`table du jeu inconnue : ${table}`)
      }
    }
    return
  }
  const m = /^update cabinet_admins set role = '(\w+)' where user_id = '([^']+)' and cabinet_id = '([^']+)'$/.exec(requete)
  if (m) {
    for (const r of monde.roles) if (r.utilisateur === m[2] && r.cabinet === m[3]) r.role = m[1]
    return
  }
  throw new Error(`instruction du jeu inconnue : ${requete.slice(0, 80)}`)
}

// ── Les profils et le contexte ────────────────────────────────────────────────────────────────────────────────────

// Ce que la base décide de qui appelle, dans le monde de l'essai : le chef est super-administrateur ; le client, et le
// même compte devenu membre puis chef du cabinet jetable, n'ont que ce que leurs rôles et leurs affectations disent.
function accesAuDossier(monde: Monde, qui: string, dossier: string): boolean {
  const existe = monde.dossiers.has(dossier)
  const cabinet = monde.dossiers.get(dossier)
  const role = monde.roles.find((r) => r.utilisateur === CLIENT && r.cabinet === cabinet)?.role
  const compte = qui === 'collaborateur' || qui === 'chefj'
  if (!existe) return false
  if (qui === 'chef') return true
  if (!compte || role === undefined) return false
  return role === 'comptable_en_chef' || monde.affectations.some((a) => a.dossier === dossier && a.utilisateur === CLIENT)
}

const reperesDe = (monde: Monde, dossier: string): ReperesAnnuels => ({
  annuels: monde.annuels.filter((r) => r.dossier === dossier), postes: monde.postes.filter((r) => r.dossier === dossier),
})

function contexteDuSeuil(monde: Monde, qui: string, dossier: string): ContexteDuSeuil {
  return { accesAuDossier: accesAuDossier(monde, qui, dossier), anneeCourante: ANNEE_COURANTE, seuils: monde.seuils.filter((s) => s.dossier === dossier) }
}

function contexteDeLExplication(monde: Monde, qui: string, dossier: string): ContexteDeLExplication {
  return {
    accesAuDossier: accesAuDossier(monde, qui, dossier), anneeCourante: ANNEE_COURANTE,
    exercicesValides: monde.valides.filter((v) => v.dossier === dossier) as ContexteDeLExplication['exercicesValides'],
    reperes: reperesDe(monde, dossier), ecritures: monde.ecritures.filter((e) => e.dossier_id === dossier), reprise: [], reportes: [],
    explications: monde.explications.filter((e) => e.dossier === dossier),
  }
}

// ── Les lectures des fonctions internes (contrôles 203 à 206) ─────────────────────────────────────────────────────

const nul = (c: number | null) => (c === null ? 'nul' : String(c))

function lecture(monde: Monde, requete: string): string | null {
  if (/^select string_agg\(coalesce\(centimes_du_navigateur\(/.test(requete)) {
    const liste = /unnest\(array\[([^\]]*)\]::numeric\[\]\)/.exec(requete)![1]
    return [...liste.matchAll(/'([^']*)'/g)].map((m) => nul(centimesDuNavigateur(Number(m[1])))).join('/')
  }
  const valeurs = /from \(values([\s\S]*)\) as v\(/.exec(requete)?.[1]
  if (/^select string_agg\(coalesce\(centimes_de_la_2035_validee\(/.test(requete)) {
    return uplets(valeurs as string, monde).map(([, j, t, o, n]) =>
      nul(centimesDeLa2035Validee(JSON.parse(String(j)), { objet_type: t as ObjetExplicationRevue, objet: String(o), nature: texte(n) as CleDeLigne['nature'] }))).join('/')
  }
  if (/^select string_agg\(coalesce\(centimes_du_repere_annuel\(/.test(requete)) {
    return uplets(valeurs as string, monde).map(([, d, a, t, o, n]) =>
      nul(centimesDuRepereAnnuel(reperesDe(monde, String(d)), Number(a), { objet_type: t as ObjetExplicationRevue, objet: String(o), nature: texte(n) as CleDeLigne['nature'] }))).join('/')
  }
  if (/^select string_agg\(source_du_precedent\(/.test(requete)) {
    return uplets(valeurs as string, monde).map(([, d, a, t, o, n]) => sourceDuPrecedent(Number(a),
      { objet_type: t as ObjetExplicationRevue, objet: String(o), nature: texte(n) as CleDeLigne['nature'] },
      { exercicesValides: monde.valides.filter((v) => v.dossier === String(d)) as ContexteDeLExplication['exercicesValides'], reperes: reperesDe(monde, String(d)) })).join('/')
  }
  return null
}

// ── Le rejeu ──────────────────────────────────────────────────────────────────────────────────────────────────────

interface Verdict { nom: string; attendu: string; obtenu: string }
interface Refuseurs {
  seuil: typeof refusDeFixerSeuil
  expliquer: typeof refusDExpliquerVariation
}
const MODULE: Refuseurs = { seuil: refusDeFixerSeuil, expliquer: refusDExpliquerVariation }

interface Rejeu { verdicts: Verdict[]; appels: Record<string, number>; anonymes: number; lectures: number; autres: number }

function rejouer(texteDeLEssai: string, refuseurs: Refuseurs): Rejeu {
  rang = 0
  const ids = identifiants()
  const monde: Monde = { dossiers: new Map(), roles: [], affectations: [], ecritures: [], valides: [], annuels: [], postes: [], seuils: [], explications: [] }
  // Le dossier du client existe avant l'essai, dans un cabinet où le compte de l'essai n'a aucun rôle.
  monde.dossiers.set(ids.get('DC') as string, 'cabinet du dossier du client')
  const verdicts: Verdict[] = []
  const appels: Record<string, number> = { fixer_seuil_de_signification: 0, expliquer_variation: 0 }
  let anonymes = 0
  let lectures = 0
  let autres = 0
  for (const e of etapes(texteDeLEssai, ids)) {
    if (e.genre === 'jeu') { jouerLeJeu(monde, e.requete); continue }
    if (e.genre === 'valeur') {
      const obtenu = lecture(monde, e.requete)
      if (obtenu === null) { autres++; continue }
      lectures++
      verdicts.push({ nom: e.nom, attendu: e.attendu, obtenu })
      continue
    }
    const appel = /^select (fixer_seuil_de_signification|expliquer_variation)\(([\s\S]*)\)$/.exec(e.requete)
    if (appel === null) { autres++; continue }
    const fonction = appel[1]
    if (e.qui === 'anon') {
      // La base refuse à l'anonyme d'exécuter la fonction : aucun de ses refus n'est en jeu.
      anonymes++
      if (e.attendu !== `permission denied for function ${fonction}`) throw new Error(`appel anonyme inattendu : ${e.nom}`)
      continue
    }
    appels[fonction]++
    const v = lireValeurs(appel[2], monde)
    const attendu = e.code === 'OK' ? 'OK' : `${e.code} ${e.attendu}`
    let refus: { code: string; message: string } | null
    if (fonction === 'fixer_seuil_de_signification') {
      if (v.length !== 5) throw new Error(`${v.length} arguments : ${e.nom}`)
      const a: ArgumentsFixerSeuil = {
        p_dossier_id: String(v[0]), p_annee: nombre(v[1]), p_seuil: nombre(v[2]), p_motif: texte(v[3]), p_remplace_id: texte(v[4]),
      }
      refus = refuseurs.seuil(a, contexteDuSeuil(monde, e.qui, a.p_dossier_id))
      if (e.genre === 'fait' && refus === null) {
        monde.seuils.push({ id: nouvelId(), dossier: a.p_dossier_id, annee: a.p_annee as number, remplace_id: a.p_remplace_id, motif: a.p_motif as string })
      }
    } else {
      if (v.length !== 10) throw new Error(`${v.length} arguments : ${e.nom}`)
      const a: ArgumentsExpliquerVariation = {
        p_dossier_id: String(v[0]), p_annee: nombre(v[1]), p_objet_type: texte(v[2]), p_objet: texte(v[3]), p_nature: texte(v[4]),
        p_montant: nombre(v[5]), p_montant_precedent: nombre(v[6]), p_source_precedent: texte(v[7]), p_explication: texte(v[8]),
        p_remplace_id: texte(v[9]),
      }
      refus = refuseurs.expliquer(a, contexteDeLExplication(monde, e.qui, a.p_dossier_id))
      if (e.genre === 'fait' && refus === null) {
        monde.explications.push({
          id: nouvelId(), dossier: a.p_dossier_id, annee: a.p_annee as number, objet_type: a.p_objet_type as ObjetExplicationRevue,
          objet: a.p_objet as string, nature: a.p_nature as 'recette' | 'depense' | null, remplace_id: a.p_remplace_id,
          explication: a.p_explication as string,
        })
      }
    }
    verdicts.push({ nom: e.nom, attendu, obtenu: refus === null ? 'OK' : `${refus.code} ${refus.message}` })
  }
  return { verdicts, appels, anonymes, lectures, autres }
}

describe('l’essai de l’étape R5, rejoué sur le module', () => {
  const resultat = rejouer(ESSAI, MODULE)

  it('chaque appel des deux fonctions, et chaque lecture des fonctions internes, reçoit du module la réponse de la base', () => {
    expect(resultat.verdicts.filter((v) => v.obtenu !== v.attendu)).toEqual([])
  })

  it('rejoue tout l’essai — le plancher qui distingue « aucun écart » d’« aveugle »', () => {
    // Chaque appel écrit en clair de chaque fonction, moins ceux de l'anonyme.
    for (const f of ['fixer_seuil_de_signification', 'expliquer_variation']) {
      const enClair = (ESSAI.match(new RegExp(`\\$q\\$select ${f}\\(`, 'g')) ?? []).length
      const anonymes = (ESSAI.match(new RegExp(`'anon', \\$q\\$select ${f}\\(`, 'g')) ?? []).length
      expect(resultat.appels[f], f).toBe(enClair - anonymes)
    }
    expect(resultat.appels.fixer_seuil_de_signification).toBeGreaterThanOrEqual(35)
    expect(resultat.appels.expliquer_variation).toBeGreaterThanOrEqual(100)
    expect(resultat.anonymes).toBe(2)
    expect(resultat.lectures).toBe(4)
    // Chaque refus de chaque fonction est rencontré au moins une fois par l'essai.
    const refuses = resultat.verdicts.filter((v) => v.attendu !== 'OK').map((v) => v.attendu)
    for (const r of [...REFUS_FIXER_SEUIL, ...REFUS_EXPLIQUER_VARIATION]) {
      const motif = new RegExp(`^(42501|22023) ${r.modele.split('%').map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.+')}$`)
      expect(refuses.some((x) => motif.test(x)), r.modele).toBe(true)
    }
  })

  // LA BORNE DU HARNAIS : le rejeu doit virer au rouge sur un mot changé dans l'essai, sur un refus que le module
  // oublierait, sur deux refus qu'il permuterait, sur une source ou une 2035 mal relues.
  it('vire au rouge sur un écart planté dans l’essai ou dans le module', () => {
    const motChange = ESSAI.replaceAll("'22023', 'Un seuil de signification se motive.'", "'22023', 'Un seuil de signification se justifie.'")
    expect(motChange).not.toBe(ESSAI)
    expect(rejouer(motChange, MODULE).verdicts.filter((v) => v.obtenu !== v.attendu).length).toBe(3)
    const valeurChangee = ESSAI.replace("'100/13/268/-267/", "'100/13/267/-267/")
    expect(rejouer(valeurChangee, MODULE).verdicts.filter((v) => v.obtenu !== v.attendu).map((v) => v.nom.slice(0, 4))).toEqual(['203.'])
    const oublie: Refuseurs = { ...MODULE, expliquer: (a, c) => { const r = refusDExpliquerVariation(a, c); return r?.cle === 'source_reference' ? null : r } }
    expect(rejouer(ESSAI, oublie).verdicts.some((v) => v.obtenu !== v.attendu)).toBe(true)
    // Deux refus voisins permutés : l'explication jugée avant la source (refus 7 avant 6, contrôle 90), le motif avant
    // le montant du seuil (refus 6 avant 5, contrôle 36).
    const permute: Refuseurs = {
      seuil: (a, c) => {
        const r = refusDeFixerSeuil(a, c)
        return r !== null && r.refus === 5 && a.p_motif === null
          ? { cle: 'motif_absent', refus: 6, code: '22023', message: 'Un seuil de signification se motive.' }
          : r
      },
      expliquer: (a, c) => {
        const r = refusDExpliquerVariation(a, c)
        return r !== null && r.refus === 6 && a.p_explication === null
          ? { cle: 'explication_vide', refus: 7, code: '22023', message: 'Une explication se rédige : elle ne peut pas être vide.' }
          : r
      },
    }
    expect(rejouer(ESSAI, permute).verdicts.filter((v) => v.obtenu !== v.attendu).map((v) => v.nom.slice(0, 3))).toEqual(['36.', '90.'])
    // Une 2035 validée illisible prise pour une 2035 sans poste : le module se tairait là où la base refuse.
    const lueAZero: Refuseurs = {
      ...MODULE,
      expliquer: (a, c) => refusDExpliquerVariation(a, { ...c, exercicesValides: c.exercicesValides.map((v) => ({ ...v, declaration: v.declaration === null ? null : { postes: [], totalRecettes: 0, totalDepenses: 0, resultat: 0, ...(v.declaration as object) } })) }),
    }
    expect(rejouer(ESSAI, lueAZero).verdicts.filter((v) => v.obtenu !== v.attendu).map((v) => v.nom.slice(0, 4))).toEqual(expect.arrayContaining(['132.', '133.']))
  })
})
