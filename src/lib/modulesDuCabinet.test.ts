import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  CE_QU_OUVRE_LE_MODULE,
  DEPENDANCES,
  DOSSIERS_NOMMES_AU_PLUS,
  EXTINCTIONS_GARDEES,
  LIBELLES_DES_MODULES,
  MODULE_DE_LA_CASE,
  MODULE_DE_LA_FONCTION,
  MODULE_DE_L_ONGLET,
  MODULES_OPTIONNELS,
  OPTIONS_DES_CABINETS_PREVUES,
  REFUS_DE_LA_LECTURE,
  REFUS_DU_REGLAGE,
  estOuvert,
  moduleDeLAppel,
  modulesAOuvrir,
  modulesEmployes,
  modulesLus,
  quiRetientLaFermeture,
  refusDExtinction,
  refusDeFermeture,
  type ModuleOptionnel,
} from './modulesDuCabinet'

// LES MODULES D'UN CABINET (conception 56, OPT2) : le module pur, et ce qu'il redit de la migration préparée d'OPT1
// (`options_des_cabinets`) — la liste fermée, les libellés, les dépendances, l'extinction gardée et ses mots, les refus du
// réglage et de la lecture —, confronté au TEXTE de la migration : un mot changé d'un côté seulement est une faute ici.
// Le jour où la migration entre dans l'export, ce test lira le fichier exporté (son nom de version change).

const MIGRATION = readFileSync(new URL('../../supabase/preparees/20261119120000_options_des_cabinets.sql', import.meta.url), 'utf8')
/** Une chaîne SQL entre apostrophes, rendue telle que la base la dit (`''` → `'`). */
const sql = (s: string) => s.replace(/''/g, "'")
/** Le corps d'une fonction de la migration. */
function corps(nom: string): string {
  const m = new RegExp(`create function public\\.${nom}\\([\\s\\S]*?\\n\\$\\$;\\n`).exec(MIGRATION)
  if (!m) throw new Error(`${nom} introuvable dans la migration`)
  return m[0]
}
/** Les éléments d'un `array[...]` de chaînes. */
const elements = (liste: string) => [...liste.matchAll(/'((?:[^']|'')*)'/g)].map((m) => sql(m[1]))
const REGLER = corps('regler_option_du_cabinet')
const MODULES = corps('modules_ouverts_du_dossier')

describe('la liste fermée et ses libellés, ceux de la migration', () => {
  it('le drapeau de la migration est baissé : rien ne lit la table avant elle', () => {
    expect(OPTIONS_DES_CABINETS_PREVUES).toBe(false)
  })

  it('la contrainte de la table, les deux fonctions et les lignes des cabinets existants disent les huit modules, dans le même ordre', () => {
    const contrainte = /constraint options_des_cabinets_module check \(module in \(([^)]*)\)\)/.exec(MIGRATION)?.[1] ?? ''
    expect(elements(contrainte)).toEqual([...MODULES_OPTIONNELS])
    for (const texte of [REGLER, MODULES]) {
      const liste = /c_modules constant text\[\] := array\[([^\]]*)\]/.exec(texte)?.[1] ?? ''
      expect(elements(liste)).toEqual([...MODULES_OPTIONNELS])
    }
    const lignes = /cross join unnest\(array\[([^\]]*)\]\) as m\(module\)/.exec(MIGRATION)?.[1] ?? ''
    expect(elements(lignes)).toEqual([...MODULES_OPTIONNELS])
    expect(MODULES_OPTIONNELS).toHaveLength(8)
  })

  it('les libellés de la fonction de réglage sont ceux du module, au même rang', () => {
    const liste = /c_libelles constant text\[\] := array\[([^\]]*)\]/.exec(REGLER)?.[1] ?? ''
    expect(elements(liste)).toEqual(MODULES_OPTIONNELS.map((m) => LIBELLES_DES_MODULES[m]))
  })

  it('chaque module, le socle compris, dit ce qu’il ouvre', () => {
    for (const m of ['socle', ...MODULES_OPTIONNELS] as const) {
      expect(LIBELLES_DES_MODULES[m].length, m).toBeGreaterThan(0)
      expect(CE_QU_OUVRE_LE_MODULE[m].length, m).toBeGreaterThan(20)
    }
  })
})

describe('les dépendances (§ 1.4)', () => {
  it('les paires de la migration (à l’ouverture comme à la fermeture) sont celles du module : les honoraires supposent la facturation', () => {
    const paires = [...REGLER.matchAll(/with recursive suppose\(module, suppose\) as \(values ([^)]*\))\)/g)]
      .map((m) => [...m[1].matchAll(/\('(\w+)', '(\w+)'\)/g)].map((p) => `${p[1]}>${p[2]}`))
    expect(paires).toHaveLength(2)
    const attendues = MODULES_OPTIONNELS.flatMap((m) => DEPENDANCES[m].map((d) => `${m}>${d}`))
    for (const p of paires) expect(p).toEqual(attendues)
    expect(attendues).toEqual(['honoraires>facturation'])
  })

  it('ouvrir un module ouvre ce qu’il suppose, dans l’ordre de la liste', () => {
    expect(modulesAOuvrir('honoraires')).toEqual(['facturation', 'honoraires'])
    expect(modulesAOuvrir('facture_electronique')).toEqual(['facture_electronique'])
    for (const m of MODULES_OPTIONNELS) expect(modulesAOuvrir(m)).toContain(m)
  })

  it('fermer un module qu’un module ouvert suppose se refuse, aux mots de la base ; sans lui, rien ne retient', () => {
    expect(quiRetientLaFermeture('facturation', ['facturation', 'honoraires'])).toEqual(['honoraires'])
    expect(quiRetientLaFermeture('facturation', ['facturation'])).toEqual([])
    expect(quiRetientLaFermeture('honoraires', ['facturation', 'honoraires'])).toEqual([])
    expect(refusDeFermeture('facturation', ['honoraires', 'facturation']))
      .toBe('Le module « Facturation » ne se ferme pas tant qu\'un module qui le suppose est ouvert : « Honoraires du cabinet ».')
    expect(refusDeFermeture('tenue', [...MODULES_OPTIONNELS])).toBeNull()
    // La phrase de la base, reconstituée de son format.
    const format = /raise exception '(Le module « % » ne se ferme pas tant qu''un module qui le suppose est ouvert : %\.)'/.exec(REGLER)?.[1]
    expect(format).toBeDefined()
    expect(sql(format!).replace('%', 'Facturation').replace('%', '« Honoraires du cabinet »'))
      .toBe(refusDeFermeture('facturation', ['honoraires']))
  })

  it('le socle est toujours ouvert ; un module optionnel l’est s’il est lu ouvert', () => {
    expect(estOuvert('socle', [])).toBe(true)
    expect(estOuvert('tenue', [])).toBe(false)
    expect(estOuvert('tenue', ['tenue'])).toBe(true)
  })
})

describe('l’extinction gardée (OPT-Q2 (A)), aux mots de la base', () => {
  it('la liste fermée de la base est celle du module, raison pour raison', () => {
    const raisons = /v_raison := case p_module([\s\S]*?)\n    end;/.exec(REGLER)?.[1] ?? ''
    const lues = Object.fromEntries([...raisons.matchAll(/when '(\w+)' then '((?:[^']|'')*)'/g)].map((m) => [m[1], sql(m[2])]))
    expect(lues).toEqual(EXTINCTIONS_GARDEES)
    expect(Object.keys(lues)).toEqual(['facturation', 'facture_electronique', 'assurance_maladie'])
  })

  it('cinq dossiers nommés au plus, les autres comptés, comme la base', () => {
    expect(/c_nommes_au_plus constant integer := (\d+);/.exec(REGLER)?.[1]).toBe(String(DOSSIERS_NOMMES_AU_PLUS))
    expect(refusDExtinction('facturation', ['Martin']))
      .toBe('Le module « Facturation » ne se ferme pas : les ventes de ces dossiers passent par leurs factures, irréversiblement : « Martin ».')
    expect(refusDExtinction('facture_electronique', ['A', 'B', 'C', 'D', 'E', 'F', 'G']))
      .toBe('Le module « Facture électronique » ne se ferme pas : une facture ou une déclaration d\'encaissement de ces dossiers est '
        + 'partie vers une plateforme sans issue connue : « A », « B », « C », « D », « E » et 2 autre(s).')
    expect(refusDExtinction('assistant', ['A'])).toBeNull()
    expect(refusDExtinction('facturation', [])).toBeNull()
    const format = /raise exception '(Le module « % » ne se ferme pas : % : %\.)',/.exec(REGLER)?.[1]
    expect(format).toBe('Le module « % » ne se ferme pas : % : %.')
    expect(REGLER).toContain("then ' et ' || (cardinality(v_dossiers) - c_nommes_au_plus) || ' autre(s)'")
  })
})

describe('les refus du réglage et de la lecture, aux mots de la base', () => {
  it('chaque refus du module se lit dans la migration, sous son code', () => {
    for (const [message, code] of [
      [REFUS_DU_REGLAGE.pasSuperAdministrateur, '42501'],
      [REFUS_DU_REGLAGE.moduleInconnu, '22023'],
      [REFUS_DU_REGLAGE.sensInconnu, '22023'],
      [REFUS_DU_REGLAGE.cabinetInconnu, '22023'],
    ] as const) {
      const echappe = message.replace(/'/g, "''")
      const i = REGLER.indexOf(`'${echappe}'`)
      expect(i, message).toBeGreaterThan(0)
      expect(REGLER.slice(i, i + echappe.length + 80), message).toMatch(new RegExp(`using errcode = '${code}'`))
    }
    expect(MODULES).toContain(`raise exception '${REFUS_DE_LA_LECTURE}' using errcode = '42501'`)
  })
})

describe('la lecture tombe du côté fermé', () => {
  it('une liste de modules connus, chacun une fois, rendue dans l’ordre de la liste fermée', () => {
    expect(modulesLus([])).toEqual([])
    expect(modulesLus(['honoraires', 'facturation'])).toEqual(['facturation', 'honoraires'])
    expect(modulesLus([...MODULES_OPTIONNELS])).toEqual([...MODULES_OPTIONNELS])
  })
  it('toute autre forme est nulle : rien ne s’ouvre qu’on n’a pas su lire', () => {
    for (const v of [null, undefined, 'tenue', {}, ['socle'], ['tenue', 'tenue'], ['inconnu'], [1], ['tenue', null]]) {
      expect(modulesLus(v), JSON.stringify(v)).toBeNull()
    }
  })
})

describe('les tables d’appartenance', () => {
  it('le brouillon et son FEC sont la précomptabilité ; ce qui arrête ou déclare, la tenue (OPT-Q4 (A))', () => {
    for (const t of ['ecritures', 'statistiques', 'banque', 'caisse', 'cotisations', 'financement', 'virements', 'tva'] as const) {
      expect(MODULE_DE_L_ONGLET[t], t).toBe('socle')
    }
    for (const t of ['cloture', 'bilan', 'revision', 'inventaire', 'immobilisations', 'estimation', 'supplements'] as const) {
      expect(MODULE_DE_L_ONGLET[t], t).toBe('tenue')
    }
    expect(MODULE_DE_L_ONGLET.factures).toBe('facturation')
  })

  it('les cases : « Ventes » à la facturation, « Comptes » à la tenue, « Caisse » au socle, les quatre autres à l’espace client', () => {
    expect(MODULE_DE_LA_CASE).toEqual({
      ventes: 'facturation', banque: 'espace_client', caisse: 'socle', comptes: 'tenue', achats: 'espace_client',
      frais: 'espace_client', documents: 'espace_client',
    })
  })

  it('send-email juge l’usage ; un usage inconnu, comme une fonction hors des modules, n’exige rien', () => {
    expect(moduleDeLAppel('send-email', 'relance_pieces')).toBe('socle')
    expect(moduleDeLAppel('send-email', 'facture')).toBe('facturation')
    expect(moduleDeLAppel('send-email', 'relance_demande')).toBe('espace_client')
    expect(moduleDeLAppel('send-email', 'inconnu')).toBeNull()
    expect(moduleDeLAppel('send-email')).toBeNull()
    expect(moduleDeLAppel('evaluer-extraction')).toBeNull()
    expect(moduleDeLAppel('agent-comptable')).toBe('assistant')
    expect(MODULE_DE_LA_FONCTION['superpdp-emit']).toEqual({ module: 'facture_electronique' })
  })

  it('chaque module a un écran, une case ou une fonction — sauf les paiements de l’assurance maladie, qui vivent dans des sections (OPT3)', () => {
    const sansEntree: ModuleOptionnel[] = MODULES_OPTIONNELS.filter((m) => !modulesEmployes().includes(m))
    expect(sansEntree).toEqual(['assurance_maladie'])
  })
})
