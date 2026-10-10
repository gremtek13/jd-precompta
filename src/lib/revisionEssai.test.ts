import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ouvertureDeLExercice, soldesAReporter } from './reportDesSoldes'
import {
  refusDeJustifierSolde, refusDuRetraitDUneSource, type ArgumentsJustifierSolde, type ContexteDeJustification,
  type GesteSurUneSource, type RefusDeJustification,
} from './revision'
import { soldeDuCompteCentimes } from './revisionSoldes'
import type { ANouveau, EcritureBrouillon, RevisionJustification, SoldeReporte } from './types'
import { A_NOUVEAU_NON_VALIDE, NON_VALIDEE } from '../test/ecritures'

// L'ESSAI DE L'ÉTAPE R1, REJOUÉ SUR LE MODULE. supabase/essais/revisionSoldes.sql a joué `justifier_solde` en production
// le 09/10/2026 — 165 verdicts sur 165, le texte transmis identique au fichier — : chacun de ses appels attend un refus,
// sous son code et ses mots, ou l'écriture de la décision. Ce test LIT le fichier, rejoue son jeu (les dossiers, les
// pièces, les écritures, les reprises, les validations), puis chaque appel dans l'ordre, sous le rôle de l'essai, et exige
// du module la même réponse : `refusDeJustifierSolde` dit avant le clic ce que la base a répondu. Les décisions que
// l'essai écrit (« fait ») s'écrivent ici aussi, pour que la suite des refus voie la même chaîne ; un contrôle s'annule,
// comme dans l'essai. Un appel de l'anonyme ne passe pas la fonction — la base refuse de l'exécuter — : il se compte à
// part. Les lectures de `solde_du_compte` que l'essai vérifie se rejouent sur `soldeDuCompteCentimes`, et ses
// changements de dossier d'une pièce ou d'un document (contrôles 137 à 142) sur `refusDuRetraitDUneSource`, le refus de
// `garder_source_citee` dit avant le clic.

const ESSAI = readFileSync(new URL('../../supabase/essais/revisionSoldes.sql', import.meta.url), 'utf8')
const ANNEE_COURANTE = 2026

// ── Le petit lecteur de SQL de l'essai ────────────────────────────────────────────────────────────────────────────

// Les valeurs que l'essai écrit : un texte, un nombre, nul, un jsonb (enveloppé, pour ne pas le confondre avec un texte).
type Valeur = string | number | null | { json: unknown }

interface Monde {
  dossiers: Set<string>
  assignations: { dossier: string; utilisateur: string }[]
  pieces: { id: string; dossier: string }[]
  documents: { id: string; dossier: string }[]
  ecritures: EcritureBrouillon[]
  reprise: ANouveau[]
  reportes: SoldeReporte[]
  valides: { dossier: string; annee: number }[]
  decisions: RevisionJustification[]
  // Ce que chaque décision cite : celles du jeu, et celles des appels que l'essai écrit.
  preuves: { justification_id: string; piece_id: string | null; document_id: string | null }[]
}

class Lecteur {
  i = 0
  readonly texte: string
  readonly monde: Monde | null
  constructor(texte: string, monde: Monde | null) {
    this.texte = texte
    this.monde = monde
  }
  blancs() { while (this.i < this.texte.length && /\s/.test(this.texte[this.i])) this.i++ }
  voit(motif: string) { this.blancs(); return this.texte.startsWith(motif, this.i) }
  voitMot(mot: string) { this.blancs(); return new RegExp(`^${mot}\\b`, 'i').test(this.texte.slice(this.i)) }
  prend(motif: string) {
    if (!this.voit(motif)) throw new Error(`« ${motif} » attendu : ${this.texte.slice(this.i, this.i + 60)}`)
    this.i += motif.length
  }
  chaine(echappee: boolean): string {
    let out = ''
    for (;;) {
      const c = this.texte[this.i++]
      if (c === undefined) throw new Error('chaîne non fermée')
      if (c === "'") {
        if (this.texte[this.i] === "'") { out += "'"; this.i++; continue }
        return out
      }
      if (echappee && c === '\\') {
        const e = this.texte[this.i++]
        out += e === 'n' ? '\n' : e === 't' ? '\t' : e === 'r' ? '\r' : e
        continue
      }
      out += c
    }
  }
  // expr := terme ('||' terme)*
  expression(): Valeur {
    let v = this.terme()
    while (this.voit('||')) {
      this.prend('||')
      const w = this.terme()
      v = `${String(v)}${String(w)}`
    }
    return v
  }
  // terme := primaire ('::' type)*
  terme(): Valeur {
    let v = this.primaire()
    while (this.voit('::')) {
      this.prend('::')
      const type = /^\w+/.exec(this.texte.slice(this.i))![0]
      this.i += type.length
      if (type === 'jsonb') v = { json: JSON.parse(String(v)) }
      else if (type === 'numeric') v = Number(v)
      else if (type !== 'text' && type !== 'uuid') throw new Error(`conversion inconnue : ${type}`)
    }
    return v
  }
  primaire(): Valeur {
    this.blancs()
    if (this.voit("E'")) { this.i += 2; return this.chaine(true) }
    if (this.voit("'")) { this.i += 1; return this.chaine(false) }
    if (this.voit('(')) {
      this.prend('(')
      const v = this.voitMot('select') ? this.sousRequete() : this.expression()
      this.prend(')')
      return v
    }
    const nombre = /^-?\d+(?:\.\d+)?/.exec(this.texte.slice(this.i))
    if (nombre) { this.i += nombre[0].length; return Number(nombre[0]) }
    if (this.voitMot('null')) { this.i += 4; return null }
    const fonction = /^(\w+)\s*\(/.exec(this.texte.slice(this.i))
    if (fonction) {
      this.i += fonction[0].length
      const args = [this.expression()]
      while (this.voit(',')) { this.prend(','); args.push(this.expression()) }
      this.prend(')')
      if (fonction[1] === 'repeat') return String(args[0]).repeat(Number(args[1]))
      if (fonction[1] === 'upper') return String(args[0]).toUpperCase()
      throw new Error(`fonction inconnue : ${fonction[1]}`)
    }
    throw new Error(`valeur illisible : ${this.texte.slice(this.i, this.i + 60)}`)
  }
  // `(select id from revision_justifications where …)`, lue dans le monde de l'essai.
  sousRequete(): Valeur {
    const m = /^select id from revision_justifications where ([^)]*)/.exec(this.texte.slice(this.i))
    if (!m || !this.monde) throw new Error(`sous-requête inconnue : ${this.texte.slice(this.i, this.i + 80)}`)
    this.i += m[0].length
    const conditions = m[1].trim().split(/\s+and\s+/)
    const retenues = this.monde.decisions.filter((j) => conditions.every((c) => {
      let x = /^(dossier_id|compte) = '([^']*)'$/.exec(c)
      if (x) return (x[1] === 'dossier_id' ? j.dossier_id : j.compte) === x[2]
      x = /^annee = (\d+)$/.exec(c)
      if (x) return j.annee === Number(x[1])
      if (c === 'remplace_id is null') return j.remplace_id === null
      if (c === 'remplace_id is not null') return j.remplace_id !== null
      throw new Error(`condition inconnue : ${c}`)
    }))
    if (retenues.length > 1) throw new Error(`sous-requête à plusieurs lignes : ${m[1]}`)
    return retenues[0]?.id ?? null
  }
  // Une liste de valeurs entre parenthèses.
  uplet(): Valeur[] {
    this.prend('(')
    const valeurs = [this.expression()]
    while (this.voit(',')) { this.prend(','); valeurs.push(this.expression()) }
    this.prend(')')
    return valeurs
  }
}

// Les identifiants de l'essai : ceux qu'il écrit en clair, et ceux qu'il tire de la base, que l'on fixe ici.
function identifiants(): Map<string, string> {
  const bloc = /ids := ([\s\S]*?);\n/.exec(ESSAI)![1]
  const ids = new Map([...bloc.matchAll(/'([A-Z0-9]+)', '([0-9a-f-]{36})'/g)].map((m) => [m[1], m[2]]))
  ids.set('CAB', 'cab00000-0000-4000-8000-000000000001')
  ids.set('DC', 'dc000000-0000-4000-8000-000000000001')
  ids.set('CHEF', 'c4ef0000-0000-4000-8000-000000000001')
  ids.set('CLIENT', 'c1e40000-0000-4000-8000-000000000001')
  ids.set('AN', String(ANNEE_COURANTE))
  ids.set('MOTIF4000', 'm'.repeat(4000))
  ids.set('MOTIF4001', 'm'.repeat(4001))
  ids.set('PREC501', 'p'.repeat(501))
  ids.set('GROS', `{"lignes":"${'x'.repeat(65536)}"}`)
  return ids
}

interface Etape { genre: string; nom: string; qui: string; requete: string; code: string; attendu: string }

function etapes(texte: string, ids: Map<string, string>): Etape[] {
  const remplacer = (s: string) => [...ids].reduce((acc, [cle, valeur]) => acc.split(`{${cle}}`).join(valeur), s)
  const sql = (s: string) => s.replace(/''/g, "'")
  return [...texte.matchAll(/array\['(jeu|controle|fait|valeur)', '((?:[^']|'')*)', '(\w+)', \$q\$([\s\S]*?)\$q\$, '((?:[^']|'')*)',\s*'((?:[^']|'')*)'\]/g)]
    .map((m) => ({ genre: m[1], nom: sql(m[2]), qui: m[3], requete: remplacer(m[4]), code: sql(m[5]), attendu: remplacer(sql(m[6])) }))
}

// ── Le monde de l'essai ───────────────────────────────────────────────────────────────────────────────────────────

let rang = 0
const nouvelId = () => `f0000000-0000-4000-8000-${String(++rang).padStart(12, '0')}`

function inserer(monde: Monde, requete: string): void {
  const entete = /^\s*insert into (\w+) \(([^)]*)\) values/.exec(requete)
  if (!entete) throw new Error(`instruction du jeu inconnue : ${requete.slice(0, 80)}`)
  const [table, colonnesTexte] = [entete[1], entete[2]]
  const colonnes = colonnesTexte.split(',').map((c) => c.trim())
  const lecteur = new Lecteur(requete.slice(entete[0].length), monde)
  const lignes: Record<string, Valeur>[] = []
  for (;;) {
    const valeurs = lecteur.uplet()
    lignes.push(Object.fromEntries(colonnes.map((c, i) => [c, valeurs[i]])))
    if (!lecteur.voit(',')) break
    lecteur.prend(',')
  }
  const s = (v: Valeur) => v as string
  for (const l of lignes) {
    switch (table) {
      case 'dossiers': monde.dossiers.add(s(l.id)); break
      case 'pieces': monde.pieces.push({ id: s(l.id), dossier: s(l.dossier_id) }); break
      case 'documents_divers': monde.documents.push({ id: s(l.id), dossier: s(l.dossier_id) }); break
      case 'ecritures_brouillon':
        monde.ecritures.push({
          id: s(l.id ?? nouvelId()), dossier_id: s(l.dossier_id), piece_id: null, ligne_bancaire_id: null, date: s(l.date),
          compte: s(l.compte), libelle: s(l.libelle), montant: Number(l.montant), sens: l.sens === 'debit' ? 'debit' : 'credit',
          statut: 'proposee', created_at: '2026-10-09T10:00:00Z', immobilisation_id: null, vehicule_id: null, declaration_tva_id: null,
          cotisation_id: null, ...NON_VALIDEE,
        })
        break
      case 'a_nouveaux':
        monde.reprise.push({
          id: nouvelId(), dossier_id: s(l.dossier_id), date: s(l.date), compte: s(l.compte), compte_origine: null, libelle: s(l.libelle),
          sens: l.sens === 'debit' ? 'debit' : 'credit', montant: Number(l.montant), source_nom: s(l.source_nom),
          source_empreinte: s(l.source_empreinte), created_at: '2026-10-09T10:00:00Z', ...A_NOUVEAU_NON_VALIDE,
        })
        break
      case 'revision_justifications':
        monde.decisions.push({
          id: s(l.id), dossier_id: s(l.dossier_id), annee: Number(l.annee), compte: s(l.compte), solde: Number(l.solde),
          etat: l.etat === 'accepte' ? 'accepte' : l.etat === 'anomalie' ? 'anomalie' : 'justifie', motif: l.motif as string | null,
          portee: l.portee === 'permanente' ? 'permanente' : 'exercice', preuve_application: null, remplace_id: null, reprise_de: null,
          auteur: s(l.auteur), cree_le: '2026-10-09T10:00:00Z',
        })
        break
      case 'dossier_assignations': monde.assignations.push({ dossier: s(l.dossier_id), utilisateur: s(l.user_id) }); break
      case 'revision_preuves':
        monde.preuves.push({ justification_id: s(l.justification_id), piece_id: (l.piece_id ?? null) as string | null, document_id: (l.document_id ?? null) as string | null })
        break
      case 'cabinets': case 'cabinet_admins': break
      default: throw new Error(`table du jeu inconnue : ${table}`)
    }
  }
}

// `valider_exercice` réussie, telle que l'essai l'attend : l'exercice validé, et l'ouverture du suivant écrite par le
// jumeau du report (lib/reportDesSoldes.ts), confronté à la base par ses propres tests.
function valider(monde: Monde, requete: string): void {
  const m = /^select valider_exercice\('([^']*)', (\d+),/.exec(requete.trim())!
  const [dossier, annee] = [m[1], Number(m[2])]
  const lignes = [
    ...monde.ecritures.filter((e) => e.dossier_id === dossier && e.date >= `${annee}-01-01` && e.date <= `${annee}-12-31`)
      .map((e) => ({ compte: e.compte, compteLib: e.compte, sens: e.sens, montant: e.montant })),
    ...ouvertureDeLExercice(monde.reprise.filter((a) => a.dossier_id === dossier), monde.reportes.filter((s) => s.dossier_id === dossier), annee)
      .map((a) => ({ compte: a.compte, compteLib: a.compte, sens: a.sens, montant: a.montant })),
  ]
  const report = soldesAReporter(lignes, { mode: 'tresorerie', compteNotesDeFrais: '108000' }, annee)
  for (const s of report.soldes) {
    monde.reportes.push({
      id: nouvelId(), dossier_id: dossier, date: report.date, compte: s.compte, libelle: s.libelle, sens: s.sens, montant: s.montant,
      source_nom: report.source, source_empreinte: 'e'.repeat(64), created_at: '2026-10-09T10:00:00Z', compte_lib: null, ecriture_lib: null,
    })
  }
  monde.valides.push({ dossier, annee })
}

function argumentsDeLAppel(requete: string, monde: Monde): ArgumentsJustifierSolde {
  const lecteur = new Lecteur(requete.trim(), monde)
  lecteur.prend('select justifier_solde')
  const v = lecteur.uplet()
  if (v.length !== 11) throw new Error(`${v.length} arguments : ${requete.slice(0, 80)}`)
  const json = (x: Valeur) => (x !== null && typeof x === 'object' ? x.json : x)
  const texte = (x: Valeur) => (x === null ? null : String(x))
  return {
    p_dossier_id: String(v[0]), p_annee: v[1] === null ? null : Number(v[1]), p_compte: texte(v[2]),
    p_solde: v[3] === null ? null : Number(v[3]), p_etat: texte(v[4]), p_motif: texte(v[5]), p_portee: texte(v[6]),
    p_preuves: json(v[7]), p_preuve_application: json(v[8]), p_remplace_id: texte(v[9]), p_reprise_de: texte(v[10]),
  }
}

function contexteDe(monde: Monde, a: ArgumentsJustifierSolde, qui: string, ids: Map<string, string>): ContexteDeJustification {
  const dossier = a.p_dossier_id
  const acces = qui === 'chef' ? monde.dossiers.has(dossier)
    : qui === 'collaborateur' ? monde.assignations.some((x) => x.dossier === dossier && x.utilisateur === ids.get('CLIENT'))
      : false
  return {
    accesAuDossier: acces, anneeCourante: ANNEE_COURANTE,
    reprise: monde.reprise.filter((x) => x.dossier_id === dossier), reportes: monde.reportes.filter((x) => x.dossier_id === dossier),
    anneesValidees: monde.valides.filter((x) => x.dossier === dossier).map((x) => x.annee),
    ecritures: monde.ecritures.filter((x) => x.dossier_id === dossier),
    decisions: monde.decisions.filter((x) => x.dossier_id === dossier),
    pieces: monde.pieces.filter((x) => x.dossier === dossier), documents: monde.documents.filter((x) => x.dossier === dossier),
  }
}

// Le numeric que la base écrit d'un solde (`::text` d'un numeric au centime) : « 1034.25 », « -12.34 », « 0.00 ».
const numericAuCentime = (c: number) => `${c < 0 ? '-' : ''}${Math.floor(Math.abs(c) / 100)}.${String(Math.abs(c) % 100).padStart(2, '0')}`

interface Verdict { nom: string; attendu: string; obtenu: string }

type Refuseur = (a: ArgumentsJustifierSolde, c: ContexteDeJustification) => RefusDeJustification | null

// Le geste que la garde des sources juge : celui qu'un `update … set dossier_id` fait. Paramètre du rejeu, pour qu'une
// dérive plantée (le mauvais geste) se voie.
interface Rejeu { verdicts: Verdict[]; appels: number; anonymes: number; soldes: number; deplacements: number; autres: number }

function rejouer(texte: string, refuseur: Refuseur, geste: GesteSurUneSource): Rejeu {
  rang = 0
  const ids = identifiants()
  const monde: Monde = { dossiers: new Set(), assignations: [], pieces: [], documents: [], ecritures: [], reprise: [], reportes: [], valides: [], decisions: [], preuves: [] }
  const verdicts: Verdict[] = []
  let appels = 0
  let anonymes = 0
  let soldes = 0
  let deplacements = 0
  let autres = 0
  for (const e of etapes(texte, ids)) {
    const requete = e.requete.trim()
    if (e.genre === 'jeu') { inserer(monde, requete); continue }
    if (e.genre === 'fait' && requete.startsWith('select valider_exercice(')) { valider(monde, requete); continue }
    if (e.genre === 'valeur' && /^select solde_du_compte\(/.test(requete)) {
      soldes++
      const obtenu = [...requete.matchAll(/solde_du_compte\('([^']*)', (\d+), '(\d+)'\)/g)].map((m) => {
        const dossier = m[1]
        return numericAuCentime(soldeDuCompteCentimes(m[3], Number(m[2]), {
          ecritures: monde.ecritures.filter((x) => x.dossier_id === dossier), reprise: monde.reprise.filter((x) => x.dossier_id === dossier),
          reportes: monde.reportes.filter((x) => x.dossier_id === dossier),
        }))
      }).join('/')
      verdicts.push({ nom: e.nom, attendu: e.attendu, obtenu })
      continue
    }
    // Une pièce ou un document qui change de dossier : `garder_source_citee` le refuse s'il est cité, en nommant la
    // première décision qui le cite ; un `update` qui laisse le dossier tel quel ne la réveille pas.
    const deplacement = /^update (pieces|documents_divers) set (.+) where id = '([^']+)'$/.exec(requete)
    if (deplacement) {
      const [, table, affectations, id] = deplacement
      const vers = /\bdossier_id = '([^']+)'/.exec(affectations)?.[1]
      const source = (table === 'pieces' ? monde.pieces : monde.documents).find((x) => x.id === id)
      if (vers === undefined || source === undefined) throw new Error(`changement de dossier illisible : ${e.nom}`)
      deplacements++
      const refus = vers === source.dossier ? null
        : refusDuRetraitDUneSource(table === 'pieces' ? { pieceId: id } : { documentId: id }, geste, monde.decisions, monde.preuves)
      verdicts.push({ nom: e.nom, attendu: e.code === 'OK' ? 'OK' : `${e.code} ${e.attendu}`, obtenu: refus === null ? 'OK' : `23514 ${refus}` })
      continue
    }
    if (!/^select justifier_solde\(/.test(requete)) { autres++; continue }
    if (e.qui === 'anon') {
      // La base refuse à l'anonyme d'exécuter la fonction : aucun de ses refus n'est en jeu.
      anonymes++
      if (e.attendu !== 'permission denied for function justifier_solde') throw new Error(`appel anonyme inattendu : ${e.nom}`)
      continue
    }
    appels++
    const a = argumentsDeLAppel(requete, monde)
    const refus = refuseur(a, contexteDe(monde, a, e.qui, ids))
    verdicts.push({ nom: e.nom, attendu: e.code === 'OK' ? 'OK' : `${e.code} ${e.attendu}`, obtenu: refus === null ? 'OK' : `${refus.code} ${refus.message}` })
    if (e.genre === 'fait' && refus === null) {
      const id = nouvelId()
      for (const p of (Array.isArray(a.p_preuves) ? a.p_preuves : []) as { piece_id?: string; document_id?: string }[]) {
        monde.preuves.push({ justification_id: id, piece_id: p.piece_id ?? null, document_id: p.document_id ?? null })
      }
      monde.decisions.push({
        id, dossier_id: a.p_dossier_id, annee: a.p_annee as number, compte: a.p_compte as string,
        solde: soldeDuCompteCentimes(a.p_compte as string, a.p_annee as number, contexteDe(monde, a, e.qui, ids)) / 100,
        etat: a.p_etat === 'accepte' ? 'accepte' : a.p_etat === 'anomalie' ? 'anomalie' : 'justifie', motif: a.p_motif,
        portee: a.p_portee === 'permanente' ? 'permanente' : 'exercice', preuve_application: null,
        remplace_id: a.p_remplace_id, reprise_de: a.p_reprise_de, auteur: 'essai', cree_le: '2026-10-09T10:00:00Z',
      })
    }
  }
  return { verdicts, appels, anonymes, soldes, deplacements, autres }
}

describe('l’essai de l’étape R1, rejoué sur le module', () => {
  const resultat = rejouer(ESSAI, refusDeJustifierSolde, 'changement-de-dossier')

  it('chaque appel de justifier_solde reçoit du module la réponse que la base a donnée', () => {
    expect(resultat.verdicts.filter((v) => v.obtenu !== v.attendu)).toEqual([])
  })

  it('rejoue tout l’essai — le plancher qui distingue « aucun écart » d’« aveugle »', () => {
    // Les 93 appels de la fonction que l'essai écrit, moins celui de l'anonyme.
    expect(resultat.appels).toBe((ESSAI.match(/select justifier_solde\(/g) ?? []).length - 1)
    expect(resultat.appels).toBeGreaterThanOrEqual(92)
    expect(resultat.anonymes).toBe(1)
    expect(resultat.soldes).toBe(7)
    // Les six changements de dossier d'une source (contrôles 137 à 142) : quatre refusés, deux acceptés.
    expect(resultat.deplacements).toBe(6)
    expect(resultat.verdicts.filter((v) => /^1(3[7-9]|4[0-2])\./.test(v.nom)).map((v) => v.obtenu.slice(0, 5))).toEqual(['23514', '23514', '23514', '23514', 'OK', 'OK'])
    const refus = resultat.verdicts.filter((v) => v.attendu !== 'OK' && !/^\d+\.\d\d/.test(v.attendu))
    // Chaque refus de la fonction est rencontré au moins une fois par l'essai.
    for (const motif of ['Accès refusé', 'Exercice invalide', 'pas terminé', 'compte de bilan', 'précède la reprise',
      'pas encore définitifs', 'Une décision dit', 'Une décision vaut', 'Une anomalie se motive', 'accepté sans pièce',
      'que de blancs : le laisser', '4 000 caractères', 'pas un montant au centime', 'a changé', 'décision à remplacer',
      'Une autre décision', 'Une reprise vise', 'Seule une justification permanente', 'remplacée depuis : relire avant de la reprendre',
      'Les preuves citées sont illisibles', 'Une précision ne se compose', '500 caractères', 'citée deux fois',
      'pas de ce dossier', 'La preuve de l\'application est illisible', 'Un solde justifié cite']) {
      expect(refus.some((v) => v.attendu.includes(motif)), motif).toBe(true)
    }
  })

  // LA BORNE DU HARNAIS : le rejeu doit virer au rouge sur un mot changé dans l'essai, sur un refus que le module
  // oublierait, sur deux refus qu'il permuterait.
  it('vire au rouge sur un écart planté dans l’essai ou dans le module', () => {
    const motChange = ESSAI.replaceAll("'22023', 'Une anomalie se motive.'", "'22023', 'Une anomalie se justifie.'")
    expect(motChange).not.toBe(ESSAI)
    expect(rejouer(motChange, refusDeJustifierSolde, 'changement-de-dossier').verdicts.filter((v) => v.obtenu !== v.attendu)).toHaveLength(2)
    const oublie: Refuseur = (a, c) => {
      const r = refusDeJustifierSolde(a, c)
      return r?.cle === 'source_en_double' ? null : r
    }
    expect(rejouer(ESSAI, oublie, 'changement-de-dossier').verdicts.some((v) => v.obtenu !== v.attendu)).toBe(true)
    // L'état avant la portée : un module qui jugerait la portée d'abord répondrait autre chose au contrôle 39.
    const permute: Refuseur = (a, c) => {
      if (a.p_portee === null && c.accesAuDossier) {
        const r = refusDeJustifierSolde({ ...a, p_etat: 'accepte' }, c)
        if (r?.cle === 'portee_invalide') return r
      }
      return refusDeJustifierSolde(a, c)
    }
    expect(rejouer(ESSAI, permute, 'changement-de-dossier').verdicts.filter((v) => v.obtenu !== v.attendu).map((v) => v.nom)).toEqual(['39. refus 8 : l\'état avant la portée'])
    // Le refus de la garde des sources : le mauvais geste change les mots des quatre refus.
    expect(rejouer(ESSAI, refusDeJustifierSolde, 'suppression').verdicts.filter((v) => v.obtenu !== v.attendu).map((v) => v.nom.slice(0, 4)))
      .toEqual(['137.', '138.', '139.', '140.'])
  })
})
