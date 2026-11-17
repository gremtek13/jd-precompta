import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  ECRITURES_LIBRES_PREVUES, MOTS_DE_LA_BASE, MOTS_DES_REFUS, POSTES_DES_DEPENSES, POSTES_DES_RECETTES, RACINES_DE_RATTACHEMENT,
} from './ecritureLibre'

// EL2 : LA BASE REDIT LE MODULE. La migration `ecritures_libres` (préparée) refuse ce que src/lib/ecritureLibre.ts refuse,
// sous les mêmes mots, aux mêmes codes, dans le même ordre ; ses listes fermées (les postes de la 2035, les comptes de
// rattachement) sont celles du module et, pour les postes, celles de la contrainte `ecritures_brouillon_champs_bnc_du_fec` de
// l'export ; son essai (supabase/essais/ecrituresLibres.sql, joué sur une réplique) attend les mêmes mots.

const lire = (chemin: string) => readFileSync(new URL(`../../${chemin}`, import.meta.url), 'utf8')
const CHEMIN = 'supabase/preparees/20261117120000_ecritures_libres.sql'
const MIGRATION = lire(CHEMIN)
const RETOUR = lire('supabase/preparees/retour/20261117120100_retour_ecritures_libres.sql')
const ESSAI = lire('supabase/essais/ecrituresLibres.sql')
const CHAMPS_BNC = lire('supabase/schema/20261102080337_champs_bnc_du_fec.sql')

/** Le corps d'une fonction de la migration, ses littéraux concaténés recollés (`'…' || '…'` devient un seul littéral). */
function corps(nom: string): string {
  const debut = MIGRATION.search(new RegExp(`create function public\\.${nom}\\(`, 'i'))
  const fin = MIGRATION.indexOf('$fonction$;', debut)
  if (debut < 0 || fin < 0) throw new Error(`${nom} introuvable dans la migration`)
  return MIGRATION.slice(debut, fin).replace(/'\s*\|\|\s*'/g, '')
}
const ENREGISTRER = corps('enregistrer_ecriture_libre')
const RETIRER = corps('retirer_ecriture_libre')

/** Le code que la base lève pour le message : le premier `using errcode` qui le suit. */
function codeApres(texte: string, message: string): string | undefined {
  const i = texte.indexOf(message)
  return i < 0 ? undefined : /using errcode = '(\w+)'/.exec(texte.slice(i))?.[1]
}

/** Les littéraux d'un `array[...]` SQL, les apostrophes doublées rendues. */
const litteraux = (texte: string) => [...texte.matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, '\''))

describe('les refus de enregistrer_ecriture_libre sont ceux du module', () => {
  it('chaque mot du module est dans la fonction, au caractère près, dans l’ordre des contrôles, sous son code', () => {
    const mots = Object.entries(MOTS_DES_REFUS)
    const positions = mots.map(([, m]) => ENREGISTRER.indexOf(m))
    positions.forEach((p, i) => expect(p, mots[i][0]).toBeGreaterThan(-1))
    // `contreLaRegleExigee` et `contreLaRegleSansObjet` suivent la désignation illisible : l'ordre du module.
    for (let i = 1; i < positions.length; i++) expect(positions[i], mots[i][0]).toBeGreaterThan(positions[i - 1])
    for (const [cle, m] of mots) expect(codeApres(ENREGISTRER, m), cle).toBe(cle === 'dateFigee' ? '23514' : '22023')
  })

  it('ceux que la base dit seule, après ceux du module ; ceux de ses gardes et du retrait', () => {
    const dernier = ENREGISTRER.indexOf(MOTS_DES_REFUS.contreLaRegleSansObjet)
    for (const m of [MOTS_DE_LA_BASE.piece, MOTS_DE_LA_BASE.version, MOTS_DE_LA_BASE.nouvelle, MOTS_DE_LA_BASE.ecritures]) {
      expect(ENREGISTRER.indexOf(m), m).toBeGreaterThan(dernier)
    }
    expect(codeApres(ENREGISTRER, MOTS_DE_LA_BASE.version)).toBe('40001')
    expect(codeApres(ENREGISTRER, MOTS_DE_LA_BASE.acces)).toBe('42501')
    expect(codeApres(RETIRER, MOTS_DE_LA_BASE.accesALEcriture)).toBe('42501')
    expect(codeApres(RETIRER, MOTS_DES_REFUS.dateFigee)).toBe('23514')
    expect(codeApres(MIGRATION, MOTS_DE_LA_BASE.garde)).toBe('42501')
    expect(codeApres(MIGRATION, MOTS_DE_LA_BASE.gardeDesLignes)).toBe('42501')
  })

  it('l’accès, avant toute lecture : `admin_du_dossier` (EL-Q1, tout compte du cabinet qui suit le dossier), jamais le chef seul', () => {
    const acces = ENREGISTRER.indexOf('not coalesce(public.admin_du_dossier(p_dossier_id), false)')
    expect(acces).toBeGreaterThan(-1)
    expect(acces).toBeLessThan(ENREGISTRER.indexOf('pg_advisory_xact_lock_shared'))
    expect(acces).toBeLessThan(ENREGISTRER.indexOf('from public.dossiers'))
    expect(MIGRATION).not.toMatch(/est_chef_du_cabinet/)
  })
})

describe('les listes fermées de la base', () => {
  it('les postes de la 2035 : ceux du module, ceux de la contrainte de l’export, classe par classe', () => {
    const [recettes, depenses] = [...ENREGISTRER.matchAll(/v_poste = any \(array\[([\s\S]*?)\]\)/g)].map((m) => litteraux(m[1]))
    expect(recettes).toEqual([...POSTES_DES_RECETTES])
    expect(depenses).toEqual([...POSTES_DES_DEPENSES])
    const contrainte = CHAMPS_BNC.slice(CHAMPS_BNC.indexOf('add constraint ecritures_brouillon_champs_bnc_du_fec'))
    const sept = /compte ~ '\^7\[0-9\]\{2\}' and poste_rattache in \(([\s\S]*?)\)\)/.exec(contrainte)?.[1] ?? ''
    const six = /compte ~ '\^6\[0-9\]\{2\}' and poste_rattache in \(([\s\S]*?)\)\)/.exec(contrainte)?.[1] ?? ''
    expect(litteraux(sept)).toEqual([...POSTES_DES_RECETTES])
    expect(litteraux(six)).toEqual([...POSTES_DES_DEPENSES])
  })

  it('les comptes de rattachement : ceux du module ; la banque, la caisse et le résultat refusés par leurs racines', () => {
    const racines = /from unnest\(array\[([^\]]*)\]\) r\(racine\) where starts_with\(v_compte, r\.racine\)/.exec(ENREGISTRER)?.[1] ?? ''
    expect(litteraux(racines)).toEqual([...RACINES_DE_RATTACHEMENT])
    for (const r of ["starts_with(v_compte, '512')", "starts_with(v_compte, '53')", "starts_with(v_compte, '120')",
      "starts_with(v_compte, '129')"]) expect(ENREGISTRER).toContain(r)
  })
})

describe('l’essai, le retour, le drapeau', () => {
  it('l’essai attend les mots du module, et se joue sur une réplique en une transaction qui s’annule', () => {
    for (const [cle, m] of [...Object.entries(MOTS_DES_REFUS), ...Object.entries(MOTS_DE_LA_BASE)]) {
      expect(ESSAI, cle).toContain(`'${m}'`)
    }
    expect(ESSAI.trimEnd().endsWith('rollback;')).toBe(true)
    expect(ESSAI).toMatch(/^begin;$/m)
  })

  it('le retour défait tout ce que la migration pose, les quatre paires comprises', () => {
    for (const objet of ['function public.retirer_ecriture_libre(uuid, integer)', 'function public.enregistrer_ecriture_libre(uuid, jsonb, jsonb, integer)',
      'trigger ecritures_brouillon_libre', 'function public.garder_ecriture_libre_du_brouillon()', 'column ecriture_libre_id',
      'table public.ecritures_libres', 'function public.garder_ecritures_libres()', 'function public.ecriture_libre_rogne(text)',
      'function public.ecriture_libre_entier(jsonb)', 'constraint ecritures_brouillon_libre_sans_autre_source']) {
      expect(RETOUR, objet).toContain(`drop ${objet}`)
    }
    for (const paire of ['ouverture', 'inventaire', 'affectation']) {
      expect(RETOUR).toContain(`drop constraint if exists ecritures_brouillon_libre_hors_de_l_${paire};`)
    }
    expect(RETOUR).toContain('drop constraint if exists ecritures_brouillon_libre_hors_des_stocks;')
  })

  it('préparée, pas appliquée : hors de l’export, le drapeau baissé', () => {
    expect(existsSync(new URL(`../../${CHEMIN}`, import.meta.url))).toBe(true)
    expect(readdirSync(new URL('../../supabase/schema/', import.meta.url)).some((f) => /_ecritures_libres\.sql$/.test(f))).toBe(false)
    expect(ECRITURES_LIBRES_PREVUES).toBe(false)
  })
})
