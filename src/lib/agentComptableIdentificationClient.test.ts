import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { derniereDefinitionSql, fichiersPrepares } from '../test/schema'

// L'ASSISTANT NE LIT JAMAIS L'IDENTIFICATION DU CLIENT D'UNE ÉCRITURE VALIDÉE (lot FEC22c2 ; VF9C-Q1, « aucun client d'une
// pièce de vente au modèle »). La migration `champs_bnc_du_fec` (FEC22b) fige sur chaque ligne validée d'un BNC en trésorerie
// l'identification de son client (`ecritures_brouillon.identification_client` : le numéro d'une facture validée, ou le SIREN
// de son client figé). Ce n'est pas un nom, mais c'est ce qui désigne le client d'une vente ; VF9C-Q1 veut qu'aucune ne parte
// au modèle. `agent-comptable` ne la lit pas aujourd'hui : cette garde le PROUVE, sans toucher à la fonction, et le restera
// le jour où la colonne existe — une lecture `select('*')`, ou `select()`, la rendrait sans la nommer.
//
// CE QUE LA GARDE LIT, PARTIE DE TOUT LE FICHIER (la doctrine des scanners) : chaque appel `.select(` — son premier argument
// ne doit être fait que de chaînes littérales (une ternaire de deux listes comprise), aucune ne porte `*`, aucune ne nomme la
// colonne ; chaque appel `.rpc(` — son nom dans une liste fermée, chacun avec sa raison, et la table que rend une fonction
// qui en rend une, relue dans l'export, ne nomme pas la colonne ; et le nom de la colonne n'apparaît nulle part. Une forme
// non reconnue est une faute ; un plancher distingue « zéro faute » d'« aveugle ».

const SOURCE = readFileSync(new URL('../../supabase/functions/agent-comptable/index.ts', import.meta.url), 'utf8')
const COLONNE = 'identification_client'

// Les fonctions de la base que l'assistant appelle, chacune avec ce qu'elle rend.
const RPC_ADMISES: Readonly<Record<string, string>> = {
  admin_du_dossier: 'un booléen : le droit de l’appelant sur le dossier',
  ventes_facturees_de_l_exercice: 'une table fixe (source, source_id, jour, etat, motif, detail, nom), relue dans l’export',
}

// Le texte d'un appel, de sa parenthèse ouvrante à sa fermante, les chaînes sautées.
function argumentsDe(texte: string, ouvrante: number): string {
  let profondeur = 0
  for (let i = ouvrante; i < texte.length; i++) {
    const c = texte[i]
    if (c === '"' || c === "'" || c === '`') {
      const fin = texte.indexOf(c, i + 1)
      i = fin < 0 ? texte.length : fin
      continue
    }
    if (c === '(') profondeur++
    if (c === ')' && --profondeur === 0) return texte.slice(ouvrante + 1, i)
  }
  return texte.slice(ouvrante + 1)
}

// Le premier argument d'un appel : jusqu'à la première virgule de profondeur nulle.
function premierArgument(args: string): string {
  let profondeur = 0
  for (let i = 0; i < args.length; i++) {
    const c = args[i]
    if (c === '"' || c === "'" || c === '`') {
      const fin = args.indexOf(c, i + 1)
      i = fin < 0 ? args.length : fin
      continue
    }
    if ('([{'.includes(c)) profondeur++
    if (')]}'.includes(c)) profondeur--
    if (c === ',' && profondeur === 0) return args.slice(0, i)
  }
  return args
}

const LITTERAL = /"[^"\\]*"|'[^'\\]*'|`[^`$\\]*`/g

function fautesDeLAssistant(source: string): { fautes: string[]; selects: number; rpcs: number } {
  const fautes: string[] = []
  if (source.includes(COLONNE)) fautes.push(`la colonne ${COLONNE} est nommée`)
  let selects = 0
  for (const m of source.matchAll(/\.select\(/g)) {
    selects++
    const premier = premierArgument(argumentsDe(source, m.index + m[0].length - 1)).trim()
    if (premier === '') {
      fautes.push(`select() sans colonnes (toutes, ${COLONNE} comprise), à ${m.index}`)
      continue
    }
    const litteraux = premier.match(LITTERAL) ?? []
    // Ce qui reste hors des chaînes : rien, ou la condition d'une ternaire (un identifiant, un accès, une comparaison).
    const reste = premier.replace(LITTERAL, '').replace(/\s+/g, '')
    if (litteraux.length === 0 || !/^([\w.?!=:]*)$/.test(reste) || (reste !== '' && !reste.includes('?'))) {
      fautes.push(`select(${premier.slice(0, 40)}) : une forme que la garde ne lit pas`)
      continue
    }
    for (const l of litteraux) {
      if (l.includes('*')) fautes.push(`select(${l.slice(0, 40)}) : toutes les colonnes`)
    }
  }
  let rpcs = 0
  for (const m of source.matchAll(/\.rpc\(\s*("([^"]*)"|'([^']*)'|`([^`]*)`|[^)\s,]*)/g)) {
    rpcs++
    const nom = m[2] ?? m[3] ?? m[4]
    if (nom === undefined || !(nom in RPC_ADMISES)) fautes.push(`rpc(${m[1]}) : une fonction hors de la liste fermée`)
  }
  return { fautes, selects, rpcs }
}

describe('agent-comptable ne lit jamais l’identification du client d’une écriture (FEC22c2, VF9C-Q1)', () => {
  it('aucune faute, sur toutes les lectures du fichier — le plancher : 40 lectures et 2 appels de fonction au moins', () => {
    const r = fautesDeLAssistant(SOURCE)
    expect(r.fautes).toEqual([])
    expect(r.selects).toBeGreaterThanOrEqual(40)
    expect(r.rpcs).toBeGreaterThanOrEqual(2)
  })

  it('la table que rend ventes_facturees_de_l_exercice, relue dans l’export, ne porte pas la colonne', () => {
    // Aucune migration préparée ne la redéfinit : celle de l'export est celle du jour de l'application.
    expect(fichiersPrepares().some((f) => /function public\.ventes_facturees_de_l_exercice\(/.test(f.texte))).toBe(false)
    const def = derniereDefinitionSql('ventes_facturees_de_l_exercice')
    const rend = /returns table \(([^)]*)\)/.exec(def)
    expect(rend?.[1]).toBe('source text, source_id uuid, jour date, etat text, motif text, detail text, nom text')
    expect(def).not.toContain(COLONNE)
  })

  it('chaque défaut planté se voit : la colonne nommée, toutes les colonnes, une lecture sans colonnes, une forme inconnue, une fonction de plus', () => {
    const lecture = '.select("date, compte, sens, montant", { count: "exact" })'
    expect(SOURCE).toContain(lecture)
    const planter = (par: string) => fautesDeLAssistant(SOURCE.replace(lecture, par)).fautes
    expect(planter('.select("date, compte, identification_client", { count: "exact" })')).toEqual([`la colonne ${COLONNE} est nommée`])
    expect(planter('.select("*", { count: "exact" })')).toEqual(['select("*") : toutes les colonnes'])
    expect(planter('.select("date, ecritures_brouillon(*)", { count: "exact" })')).toEqual(['select("date, ecritures_brouillon(*)") : toutes les colonnes'])
    expect(planter('.select()')[0]).toMatch(/^select\(\) sans colonnes/)
    expect(planter('.select(colonnes, { count: "exact" })')).toEqual(['select(colonnes) : une forme que la garde ne lit pas'])
    expect(planter('.select(`date, ${autre}`, { count: "exact" })')[0]).toMatch(/une forme que la garde ne lit pas/)
    expect(fautesDeLAssistant(`${SOURCE}\nadmin.rpc("champs_du_fec", {})`).fautes).toEqual(['rpc("champs_du_fec") : une fonction hors de la liste fermée'])
  })
})
