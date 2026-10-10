import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { octetsJsonb } from './revisionPreuves'
import {
  REFUS_CONCLURE_CYCLE, REFUS_NOTER_REVISION, REFUS_REVOIR_CYCLE, refusDeConclureCycle, refusDeNoterRevision, refusDeRevoirCycle,
  type ArgumentsConclureCycle, type ArgumentsNoterRevision, type ArgumentsRevoirCycle, type ContexteDesCycles,
} from './revisionRevue'
import type { RevisionConclusion, RevisionRevue } from './types'

// L'ESSAI DE L'ÉTAPE R4, REJOUÉ SUR LE MODULE. supabase/essais/revisionCycles.sql joue `conclure_cycle`,
// `noter_revision` et `revoir_cycle` sous six profils : chacun de ses appels attend un refus, sous son code et ses mots,
// ou l'écriture. Ce test LIT le fichier, rejoue son jeu (les dossiers, les cabinets, les rôles, les affectations, les
// conclusions et les revues posées par le propriétaire), puis chaque appel dans l'ordre, sous le profil de l'essai, et
// exige du module la même réponse : les refus que l'écran dira avant le clic sont ceux que la base a dits. Ce que
// l'essai écrit (« fait ») s'écrit ici aussi, pour que la suite des refus voie la même chaîne ; un contrôle s'annule.
// Les appels de l'anonyme ne passent pas la fonction — la base refuse de l'exécuter — : ils se comptent à part ; ceux
// qu'un bloc `do` enveloppe vérifient ce que la fonction rend, pas ses refus : ils se comptent à part aussi.

const ESSAI = readFileSync(new URL('../../supabase/essais/revisionCycles.sql', import.meta.url), 'utf8')
const ANNEE_COURANTE = 2026
const CHEF = 'c4ef0000-0000-4000-8000-000000000001'
const CLIENT = 'c1e40000-0000-4000-8000-000000000001'

// ── Les identifiants et les valeurs de l'essai ────────────────────────────────────────────────────────────────────

// Ceux qu'il écrit en clair, et ceux qu'il tire de la base ou fabrique en SQL, que l'on refait ici — les programmes
// à la taille près, par `octetsJsonb`, qui écrit le texte d'un jsonb comme la base l'écrit.
function identifiants(): Map<string, string> {
  const bloc = /ids := ([\s\S]*?);\n\n/.exec(ESSAI)![1]
  const ids = new Map([...bloc.matchAll(/'([A-Z0-9]+)', '([0-9a-f]{8}-[0-9a-f-]{27})'/g)].map((m) => [m[1], m[2]]))
  const taches = (n: number, f: (g: number) => Record<string, unknown>) => JSON.stringify(Array.from({ length: n }, (_, i) => f(i + 1)))
  const base = Array.from({ length: 32 }, () => ({ travail: 'T', fait: true, note: 'n'.repeat(1980) }))
  const complete = (taille: number) => JSON.stringify([...base, { travail: 'T', fait: true, note: 'n'.repeat(taille - octetsJsonb(base) - 44) }])
  const valeurs: Record<string, string> = {
    CAB: 'cab00000-0000-4000-8000-000000000001', DC: 'dc000000-0000-4000-8000-000000000001', CHEF, CLIENT, AN: String(ANNEE_COURANTE),
    BLANCS: ' \t\n\r', NBSP: ' ', C8000: 'c'.repeat(8000), C8001: 'c'.repeat(8001), S4000: 's'.repeat(4000), S4001: 's'.repeat(4001),
    N4000: 'n'.repeat(4000), N4001: 'n'.repeat(4001), O4000: 'o'.repeat(4000), O4001: 'o'.repeat(4001), L500: 'l'.repeat(500),
    L501: 'l'.repeat(501), M2000: 'm'.repeat(2000), M2001: 'm'.repeat(2001), CODE64: `c${'x'.repeat(63)}`, CODE65: `c${'x'.repeat(64)}`,
    T100: taches(100, (g) => ({ travail: `T${g}`, fait: false })), T101: taches(101, (g) => ({ travail: `T${g}`, fait: false })),
    T101V: taches(101, (g) => ({ travail: g === 1 ? '' : `T${g}`, fait: false })),
    T101X: taches(101, (g) => ({ travail: `T${g}`, fait: g === 1 ? 'x' : false })),
    GROS: taches(40, (g) => ({ travail: `T${g}`, fait: true, note: 'n'.repeat(2000) })),
    TROPGROS: JSON.stringify(['x'.repeat(65536)]), P65536: complete(65536), P65537: complete(65537),
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

// ── Le petit lecteur des appels ───────────────────────────────────────────────────────────────────────────────────

type Valeur = string | number | null | { json: unknown }

interface Monde {
  dossiers: Map<string, string>
  roles: { utilisateur: string; cabinet: string; role: string }[]
  affectations: { dossier: string; utilisateur: string }[]
  conclusions: RevisionConclusion[]
  revues: RevisionRevue[]
}

function lireValeurs(texte: string, monde: Monde): Valeur[] {
  let i = 0
  const blancs = () => { while (/\s/.test(texte[i] ?? '')) i++ }
  const chaine = (): string => {
    let out = ''
    for (;;) {
      const c = texte[i++]
      if (c === undefined) throw new Error('chaîne non fermée')
      if (c === "'") {
        if (texte[i] === "'") { out += "'"; i++; continue }
        return out
      }
      out += c
    }
  }
  const valeur = (): Valeur => {
    blancs()
    let v: Valeur
    if (texte[i] === "'") { i++; v = chaine() }
    else if (texte.startsWith('(select id from revision_conclusions where conclusion = ', i)) {
      i += '(select id from revision_conclusions where conclusion = '.length + 1
      const visee = chaine()
      if (texte[i] !== ')') throw new Error(`sous-requête illisible : ${texte.slice(i, i + 40)}`)
      i++
      const trouvees = monde.conclusions.filter((c) => c.conclusion === visee)
      if (trouvees.length > 1) throw new Error(`sous-requête à plusieurs lignes : ${visee}`)
      v = trouvees[0]?.id ?? null
    } else if (texte.startsWith('null', i)) { i += 4; v = null }
    else {
      const n = /^-?\d+/.exec(texte.slice(i))
      if (!n) throw new Error(`valeur illisible : ${texte.slice(i, i + 40)}`)
      i += n[0].length
      v = Number(n[0])
    }
    if (texte.startsWith('::jsonb', i)) { i += 7; v = { json: JSON.parse(String(v)) } }
    return v
  }
  const valeurs = [valeur()]
  for (;;) {
    blancs()
    if (texte[i] === ',') { i++; valeurs.push(valeur()); continue }
    break
  }
  if (i !== texte.length) throw new Error(`reste illisible : ${texte.slice(i, i + 40)}`)
  return valeurs
}

const json = (v: Valeur) => (v !== null && typeof v === 'object' ? v.json : v)
const texte = (v: Valeur) => (v === null ? null : String(v))

// ── Le jeu ────────────────────────────────────────────────────────────────────────────────────────────────────────

let rang = 0
const instant = () => `2026-03-01T10:00:${String(rang).padStart(2, '0')}.${String(rang++).padStart(3, '0')}Z`
const nouvelId = () => `f0000000-0000-4000-8000-${String(rang + 1000).padStart(12, '0')}`

function jouerLeJeu(monde: Monde, requete: string): void {
  let m = /^insert into dossiers \(id, nom, cabinet_id\) values (.*)$/s.exec(requete)
  if (m) {
    for (const x of m[1].matchAll(/\('([^']+)', '[^']*', '([^']+)'\)/g)) monde.dossiers.set(x[1], x[2])
    return
  }
  if (/^insert into (cabinets|revision_notes) /.test(requete)) return
  m = /^insert into cabinet_admins \(user_id, cabinet_id, role\) values \('([^']+)', '([^']+)', '(\w+)'\)$/.exec(requete)
  if (m) { monde.roles.push({ utilisateur: m[1], cabinet: m[2], role: m[3] }); return }
  m = /^insert into dossier_assignations \(dossier_id, user_id\) values \('([^']+)', '([^']+)'\)$/.exec(requete)
  if (m) { monde.affectations.push({ dossier: m[1], utilisateur: m[2] }); return }
  m = /^update cabinet_admins set role = '(\w+)' where user_id = '([^']+)' and cabinet_id = '([^']+)'$/.exec(requete)
  if (m) {
    for (const r of monde.roles) if (r.utilisateur === m[2] && r.cabinet === m[3]) r.role = m[1]
    return
  }
  m = /^insert into revision_conclusions \(id, dossier_id, annee, cycle, etat, travaux, conclusion, auteur\) values \((.*)\)$/s.exec(requete)
  if (m) {
    const [id, dossier, annee, cycle, etat, travaux, conclusion, auteur] = lireValeurs(m[1], monde)
    monde.conclusions.push({
      id: String(id), dossier_id: String(dossier), annee: Number(annee), cycle: String(cycle), etat: etat === 'anomalie' ? 'anomalie' : 'revise',
      travaux: json(travaux), conclusion: String(conclusion), a_suivre: null, remplace_id: null, auteur: String(auteur), cree_le: instant(),
    })
    return
  }
  m = /^insert into revision_revues \(dossier_id, annee, conclusion_id, avis, revu_par\) values \((.*)\)$/s.exec(requete)
  if (m) {
    const [dossier, annee, conclusion, avis, par] = lireValeurs(m[1], monde)
    monde.revues.push({
      id: nouvelId(), dossier_id: String(dossier), annee: Number(annee), conclusion_id: String(conclusion),
      avis: avis === 'a_reprendre' ? 'a_reprendre' : 'approuve', observation: null, revu_par: String(par), revu_le: instant(),
    })
    return
  }
  throw new Error(`instruction du jeu inconnue : ${requete.slice(0, 80)}`)
}

// ── Les profils ───────────────────────────────────────────────────────────────────────────────────────────────────

// Ce que la base décide de qui appelle, dans le monde de l'essai : le chef est super-administrateur ; le client, et le
// même compte devenu membre puis chef du cabinet jetable, n'ont que ce que leurs rôles et leurs affectations disent.
function contexteDe(monde: Monde, qui: string, dossier: string): ContexteDesCycles {
  const existe = monde.dossiers.has(dossier)
  const cabinet = monde.dossiers.get(dossier)
  const role = monde.roles.find((r) => r.utilisateur === CLIENT && r.cabinet === cabinet)?.role
  const compte = qui === 'collaborateur' || qui === 'chefj'
  const chef = existe && (qui === 'chef' || (compte && role === 'comptable_en_chef'))
  const acces = chef || (existe && compte && role !== undefined && monde.affectations.some((a) => a.dossier === dossier && a.utilisateur === CLIENT))
  return {
    accesAuDossier: acces, chefDuCabinet: chef, anneeCourante: ANNEE_COURANTE,
    conclusions: monde.conclusions.filter((c) => c.dossier_id === dossier), revues: monde.revues.filter((r) => r.dossier_id === dossier),
  }
}

// ── Le rejeu ──────────────────────────────────────────────────────────────────────────────────────────────────────

interface Verdict { nom: string; attendu: string; obtenu: string }
interface Refuseurs {
  conclure: typeof refusDeConclureCycle
  noter: typeof refusDeNoterRevision
  revoir: typeof refusDeRevoirCycle
}
const MODULE: Refuseurs = { conclure: refusDeConclureCycle, noter: refusDeNoterRevision, revoir: refusDeRevoirCycle }

interface Rejeu { verdicts: Verdict[]; appels: Record<string, number>; anonymes: number; enveloppes: number; autres: number }

function rejouer(texteDeLEssai: string, refuseurs: Refuseurs): Rejeu {
  rang = 0
  const monde: Monde = { dossiers: new Map(), roles: [], affectations: [], conclusions: [], revues: [] }
  const verdicts: Verdict[] = []
  const appels: Record<string, number> = { conclure_cycle: 0, noter_revision: 0, revoir_cycle: 0 }
  let anonymes = 0
  let enveloppes = 0
  let autres = 0
  for (const e of etapes(texteDeLEssai, identifiants())) {
    if (e.genre === 'jeu') { jouerLeJeu(monde, e.requete); continue }
    const appel = /^select (conclure_cycle|noter_revision|revoir_cycle)\((.*)\)$/s.exec(e.requete)
    if (appel === null) {
      if (/(conclure_cycle|noter_revision|revoir_cycle)\(/.test(e.requete)) enveloppes++
      else autres++
      continue
    }
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
    const auteur = e.qui === 'chef' ? CHEF : CLIENT
    let refus: { code: string; message: string } | null
    if (fonction === 'conclure_cycle') {
      if (v.length !== 8) throw new Error(`${v.length} arguments : ${e.nom}`)
      const a: ArgumentsConclureCycle = {
        p_dossier_id: String(v[0]), p_annee: v[1] === null ? null : Number(v[1]), p_cycle: texte(v[2]), p_etat: texte(v[3]),
        p_travaux: json(v[4]), p_conclusion: texte(v[5]), p_a_suivre: texte(v[6]), p_remplace_id: texte(v[7]),
      }
      refus = refuseurs.conclure(a, contexteDe(monde, e.qui, a.p_dossier_id))
      if (e.genre === 'fait' && refus === null) {
        monde.conclusions.push({
          id: nouvelId(), dossier_id: a.p_dossier_id, annee: a.p_annee as number, cycle: a.p_cycle as string,
          etat: a.p_etat === 'anomalie' ? 'anomalie' : 'revise', travaux: a.p_travaux, conclusion: a.p_conclusion as string,
          a_suivre: a.p_a_suivre, remplace_id: a.p_remplace_id, auteur, cree_le: instant(),
        })
      }
    } else if (fonction === 'noter_revision') {
      if (v.length !== 5) throw new Error(`${v.length} arguments : ${e.nom}`)
      const a: ArgumentsNoterRevision = {
        p_dossier_id: String(v[0]), p_annee: v[1] === null ? null : Number(v[1]), p_cycle: texte(v[2]), p_nature: texte(v[3]), p_texte: texte(v[4]),
      }
      refus = refuseurs.noter(a, contexteDe(monde, e.qui, a.p_dossier_id))
    } else {
      if (v.length !== 5) throw new Error(`${v.length} arguments : ${e.nom}`)
      const a: ArgumentsRevoirCycle = {
        p_dossier_id: String(v[0]), p_annee: v[1] === null ? null : Number(v[1]), p_conclusion_id: texte(v[2]), p_avis: texte(v[3]),
        p_observation: texte(v[4]),
      }
      refus = refuseurs.revoir(a, contexteDe(monde, e.qui, a.p_dossier_id))
      if (e.genre === 'fait' && refus === null) {
        monde.revues.push({
          id: nouvelId(), dossier_id: a.p_dossier_id, annee: a.p_annee as number, conclusion_id: a.p_conclusion_id as string,
          avis: a.p_avis === 'a_reprendre' ? 'a_reprendre' : 'approuve', observation: a.p_observation, revu_par: auteur, revu_le: instant(),
        })
      }
    }
    verdicts.push({ nom: e.nom, attendu, obtenu: refus === null ? 'OK' : `${refus.code} ${refus.message}` })
  }
  return { verdicts, appels, anonymes, enveloppes, autres }
}

describe('l’essai de l’étape R4, rejoué sur le module', () => {
  const resultat = rejouer(ESSAI, MODULE)

  it('chaque appel des trois fonctions reçoit du module la réponse que la base a donnée', () => {
    expect(resultat.verdicts.filter((v) => v.obtenu !== v.attendu)).toEqual([])
  })

  it('rejoue tout l’essai — le plancher qui distingue « aucun écart » d’« aveugle »', () => {
    // Chaque appel écrit en clair de chaque fonction, moins ceux de l'anonyme et ceux qu'un bloc `do` enveloppe.
    for (const f of ['conclure_cycle', 'noter_revision', 'revoir_cycle']) {
      const enClair = (ESSAI.match(new RegExp(`\\$q\\$select ${f}\\(`, 'g')) ?? []).length
      const anonymes = (ESSAI.match(new RegExp(`'anon', \\$q\\$select ${f}\\(`, 'g')) ?? []).length
      expect(resultat.appels[f], f).toBe(enClair - anonymes)
    }
    expect(resultat.appels.conclure_cycle).toBeGreaterThanOrEqual(85)
    expect(resultat.appels.noter_revision).toBeGreaterThanOrEqual(20)
    expect(resultat.appels.revoir_cycle).toBeGreaterThanOrEqual(35)
    expect(resultat.anonymes).toBe(3)
    expect(resultat.enveloppes).toBe(3)
    // Chaque refus de chaque fonction est rencontré au moins une fois par l'essai.
    const refuses = resultat.verdicts.filter((v) => v.attendu !== 'OK').map((v) => v.attendu)
    for (const r of [...REFUS_CONCLURE_CYCLE, ...REFUS_NOTER_REVISION, ...REFUS_REVOIR_CYCLE]) {
      const motif = new RegExp(`^(42501|22023) ${r.modele.split('%').map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\d+')}$`)
      expect(refuses.some((x) => motif.test(x)), r.modele).toBe(true)
    }
  })

  // LA BORNE DU HARNAIS : le rejeu doit virer au rouge sur un mot changé dans l'essai, sur un refus que le module
  // oublierait, sur deux refus qu'il permuterait.
  it('vire au rouge sur un écart planté dans l’essai ou dans le module', () => {
    const motChange = ESSAI.replaceAll("'22023', 'Un cycle renvoyé à reprendre se motive.'", "'22023', 'Un cycle renvoyé à reprendre se justifie.'")
    expect(motChange).not.toBe(ESSAI)
    expect(rejouer(motChange, MODULE).verdicts.filter((v) => v.obtenu !== v.attendu).length).toBeGreaterThanOrEqual(4)
    const oublie: Refuseurs = { ...MODULE, revoir: (a, c) => { const r = refusDeRevoirCycle(a, c); return r?.cle === 'deja_revue' ? null : r } }
    expect(rejouer(ESSAI, oublie).verdicts.filter((v) => v.obtenu !== v.attendu).map((v) => v.nom)).toEqual(['147. revoir, refus 9 : une conclusion déjà revue'])
    // Le cycle avant l'état : un module qui jugerait l'état d'abord répondrait autre chose au contrôle 37.
    const permute: Refuseurs = {
      ...MODULE,
      conclure: (a, c) => {
        const r = refusDeConclureCycle({ ...a, p_cycle: 'tresorerie' }, c)
        return r?.cle === 'etat_invalide' ? r : refusDeConclureCycle(a, c)
      },
    }
    expect(rejouer(ESSAI, permute).verdicts.filter((v) => v.obtenu !== v.attendu).map((v) => v.nom))
      .toEqual(['37. refus 5 avant 6 : un cycle et un état inconnus'])
    // Le chef seul revoit : un module qui laisserait revoir tout membre affecté se trompe sur le collaborateur.
    const toutMembre: Refuseurs = { ...MODULE, revoir: (a, c) => refusDeRevoirCycle(a, { ...c, chefDuCabinet: c.chefDuCabinet || c.accesAuDossier }) }
    expect(rejouer(ESSAI, toutMembre).verdicts.some((v) => v.nom.startsWith('160.') && v.obtenu !== v.attendu)).toBe(true)
  })
})
