import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { beforeAll, describe, expect, it } from 'vitest'
import * as module from './cdarRecu'
import type { FacturePourStatutRecu, StatutRecuLu } from './cdarRecu'
import { diagnosticsSepares, executerModule } from '../test/compilationSeparee'
import { ECHOS_RECUS, EXEMPLES_RECUS, SIREN_ACHETEUR_RECU, SIREN_VENDEUR_RECU, echoRecu, factureRecue, messageRecu } from '../test/cdarRecu'
import { tirage } from '../test/encaissementsBatterie'

// LA COPIE DE cdarRecu DANS plateforme-agreee (ligne 28.5, étape d7). La fonction est auto-portée : elle lit les statuts
// qu'elle télécharge par une COPIE du module, et un statut mal lu là-bas est un refus qu'on ne voit pas — ou un refus
// qu'on invente. Quatre questions, et aucune ne suffit seule (CLAUDE.md, « Une Edge Function auto-portée duplique du
// code ») :
//   1. La copie est-elle AU CARACTÈRE PRÈS le bloc de src/lib ?
//   2. Se suffit-elle, `sirenDe` excepté — qu'elle emprunte au bloc factureCii de la fonction, et à lui seul ?
//   3. EXÉCUTÉE, rend-elle ce que rend le module — une référence extérieure à la copie — sur les exemples, sur des
//      milliers de messages abîmés et sur une grille de rattachements ?
//   4. La fonction s'en SERT-elle ? Et le garde mord-il sur un défaut planté ?

const MODULE = readFileSync(new URL('./cdarRecu.ts', import.meta.url), 'utf8')
const SOURCE = readFileSync(new URL('../../supabase/functions/plateforme-agreee/index.ts', import.meta.url), 'utf8')
const DEBUT = '// ── DÉBUT COPIE cdarRecu '
const FIN = '// ── FIN COPIE cdarRecu '

function blocDe(source: string, ou: string): string {
  const d = source.indexOf(DEBUT)
  const f = source.indexOf(FIN)
  expect(d, `bornes du bloc cdarRecu introuvables dans ${ou}`).toBeGreaterThan(-1)
  expect(source.indexOf(DEBUT, d + 1), `le bloc cdarRecu est présent deux fois dans ${ou}`).toBe(-1)
  expect(f, `le bloc cdarRecu n'est pas refermé dans ${ou}`).toBeGreaterThan(d)
  return source.slice(d, source.indexOf('\n', f) + 1)
}

const ORIGINE = blocDe(MODULE, 'cdarRecu.ts')
const COPIE = blocDe(SOURCE, 'plateforme-agreee')

/** `sirenDe` tel que la fonction le porte, dans sa copie du générateur : la seule chose que le bloc emprunte. */
function sirenDeDeLaFonction(): string {
  const debut = SOURCE.indexOf('export function sirenDe(')
  expect(debut).toBeGreaterThan(SOURCE.indexOf('// ── DÉBUT COPIE factureCii '))
  expect(debut).toBeLessThan(SOURCE.indexOf('// ── FIN COPIE factureCii '))
  return SOURCE.slice(debut, SOURCE.indexOf('\n}\n', debut) + 3)
}

type Copie = typeof module

/** Le bloc SEUL, avec le `sirenDe` de la fonction, transpilé et exécuté : tout autre nom emprunté lèverait. */
function executer(bloc: string): Copie {
  return executerModule<Copie>(`${sirenDeDeLaFonction()}\n${bloc}`)
}

/**
 * Les diagnostics de chaque bloc compilé seul, `sirenDe` déclaré : un nom emprunté hors de lui s'y voit, même jamais
 * exécuté. Un seul programme pour tous (`compilationSeparee.ts`), bâti dans le `beforeAll` du garde qui les lit.
 */
function diagnostics<Cle extends string>(blocs: Record<Cle, string>): Record<Cle, string[]> {
  const declare = (bloc: string) => `declare function sirenDe(siret: string | null | undefined): string | null\n${bloc}`
  const sources = Object.fromEntries(Object.entries<string>(blocs).map(([cle, bloc]) => [cle, declare(bloc)]))
  return diagnosticsSepares(sources as Record<Cle, string>, {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, strict: true, noEmit: true, noUnusedLocals: true,
    noUnusedParameters: true, lib: ['lib.es2022.d.ts'], types: [],
  })
}

// Le bloc fidèle, et le même qui emprunte un nom hors de `sirenDe` : le garde doit voir l'emprunt.
const COMPILES = {
  origine: ORIGINE,
  emprunte: ORIGINE.replace('sirenDe(facture.emetteur_siret)', 'sirenDeLaFacture(facture.emetteur_siret)'),
}

// ── Les épreuves ──────────────────────────────────────────────────────────────────────────────────────────────────

const MESSAGES = [
  ...EXEMPLES_RECUS.map((e) => messageRecu(e.fichier)),
  ...ECHOS_RECUS.map((e) => echoRecu(e.fichier)),
]

/**
 * Des messages abîmés, tirés au sort mais toujours les mêmes : un morceau retiré, une ligne répétée, un chiffre changé,
 * une balise renommée, un caractère inséré. La plupart deviennent illisibles ; beaucoup restent lisibles et disent
 * autre chose — c'est là qu'une copie qui dérive se trahirait.
 */
function abimes(graine: number, combien: number): string[] {
  const suivant = tirage(graine)
  const entier = (n: number) => Math.floor(suivant() * n)
  const sortie: string[] = []
  const insertions = ['<', '>', '&', '&amp;', ' ', '\n', '"', "'", '0', '9', 'é', '<!DOCTYPE a>', '<![CDATA[x]]>', '\u0001', ':']
  for (let k = 0; k < combien; k++) {
    const m = MESSAGES[entier(MESSAGES.length)]
    const i = entier(m.length)
    switch (entier(6)) {
      case 0: sortie.push(m.slice(0, i) + m.slice(i + 1 + entier(40))); break
      case 1: {
        const lignes = m.split('\n')
        const l = entier(lignes.length)
        lignes.splice(l, 0, lignes[l])
        sortie.push(lignes.join('\n'))
        break
      }
      case 2: sortie.push(m.replace(/\d/g, (c) => (entier(25) === 0 ? String((Number(c) + 1 + entier(8)) % 10) : c))); break
      case 3: sortie.push(m.replace(/(<\/?ram:)(\w+)/g, (t, a: string, b: string) => (entier(30) === 0 ? `${a}${b}X` : t))); break
      case 4: sortie.push(m.slice(0, i) + insertions[entier(insertions.length)] + m.slice(i)); break
      default: sortie.push(m.replace(/xmlns:ram=/, 'xmlns:r=').replace(/ram:/g, 'r:')); break
    }
  }
  return sortie
}

const ABIMES = abimes(20271009, 4000)

const FACTURES: (FacturePourStatutRecu | null)[] = [
  null,
  factureRecue(),
  factureRecue({ id: 'facture-43', numero: 'F2027-0043' }),
  factureRecue({ id: 'facture-44', numero: 'F2027-0044', date_emission: '2027-10-05' }),
  factureRecue({ statut: 'brouillon' }),
  factureRecue({ type: 'avoir' }),
  factureRecue({ date_emission: '2026-12-31' }),
  factureRecue({ emetteur_siret: null }),
  factureRecue({ emetteur_siret: '98765432400017' }),
  factureRecue({ emetteur_siret: '123456782' }),
  factureRecue({ emetteur_siret: 'pas un siret' }),
]
const SIRENS = [null, SIREN_VENDEUR_RECU, SIREN_ACHETEUR_RECU, '111111118']

function lectures(m: Copie, messages: readonly string[]) {
  return messages.map((x) => m.lireStatutRecu(x))
}

function rattachements(m: Copie, lus: readonly StatutRecuLu[]) {
  return lus.flatMap((lu) => FACTURES.flatMap((f) => SIRENS.map((s) => m.rattacherStatutRecu(lu, f, s))))
}

const LUS: StatutRecuLu[] = [...EXEMPLES_RECUS, ...ECHOS_RECUS].map((e) => e.lu)

describe('la copie de cdarRecu dans plateforme-agreee', () => {
  // La compilation se paye UNE fois par fichier, ici : elle relit et vérifie la bibliothèque standard, et refaite dans
  // chaque test elle approchait les 5 s de Vitest sous la charge de la barrière. Son délai est déclaré pour elle seule,
  // comme celui du garde du code mort des Edge Functions ; celui des tests ne change pas.
  let compiles: Record<keyof typeof COMPILES, string[]>
  beforeAll(() => {
    compiles = diagnostics(COMPILES)
  }, 60_000)

  it('est au caractère près le bloc de src/lib/cdarRecu.ts', () => {
    expect(COPIE).toBe(ORIGINE)
    // Le bloc commence à sa borne et finit à la sienne : rien de ce que le module importe n'y entre.
    expect(ORIGINE.startsWith(DEBUT)).toBe(true)
    expect(ORIGINE).not.toMatch(/^import /m)
  })

  it('suit la copie du générateur, dont elle emprunte `sirenDe` — et rien d’autre', () => {
    expect(SOURCE.indexOf(DEBUT)).toBeGreaterThan(SOURCE.indexOf('// ── FIN COPIE factureCii '))
    expect(compiles.origine).toEqual([])
    // Le garde voit un emprunt : sans `sirenDe` déclaré, la compilation tombe.
    expect(compiles.emprunte.join('\n')).toMatch(/sirenDeLaFacture/)
  })

  it('exécutée seule, lit les exemples comme le module, champ par champ', () => {
    const copie = executer(COPIE)
    expect(lectures(copie, MESSAGES)).toEqual(lectures(module, MESSAGES))
    expect(lectures(copie, MESSAGES).map((l) => ('lu' in l ? l.lu : l))).toEqual(LUS)
  })

  it('exécutée seule, lit 4 000 messages abîmés comme le module — lisibles ou non', () => {
    const copie = executer(COPIE)
    const attendus = lectures(module, ABIMES)
    expect(lectures(copie, ABIMES)).toEqual(attendus)
    // Le tirage abîme pour de bon, sans tout rendre illisible : une épreuve qui ne lirait plus rien ne prouverait rien.
    const lisibles = attendus.filter((l) => 'lu' in l).length
    expect(lisibles).toBeGreaterThan(400)
    expect(lisibles).toBeLessThan(3600)
    expect(new Set(attendus.map((l) => ('refus' in l ? l.refus : 'lu')))).toEqual(new Set(['lu', 'illisible', 'ambigu']))
  })

  it('exécutée seule, rattache comme le module sur une grille de factures et de SIREN', () => {
    const copie = executer(COPIE)
    const lus = [...LUS, ...lectures(module, ABIMES).flatMap((l) => ('lu' in l ? [l.lu] : [])).slice(0, 300)]
    const attendus = rattachements(module, lus)
    expect(rattachements(copie, lus)).toEqual(attendus)
    expect(new Set(attendus.map((r) => ('ecart' in r ? r.ecart : 'rattache')))).toEqual(new Set([
      'rattache', 'autre_objet', 'statut_inconnu', 'illisible', 'autre_vendeur', 'facture_inconnue', 'incoherent',
    ]))
  })

  it('la fonction s’en sert : le relevé lit par `lireStatutRecu` et rattache par `rattacherStatutRecu`, définis une seule fois', () => {
    const horsCopie = SOURCE.replace(COPIE, '')
    const cycle = SOURCE.slice(SOURCE.indexOf('// ── DÉBUT CYCLE DE VIE '), SOURCE.indexOf('// ── FIN CYCLE DE VIE '))
    expect(cycle).toContain('const lecture = lireStatutRecu(xml)')
    expect(cycle).toContain('const rattachement = rattacherStatutRecu(lu, facture, sirenDuDossier)')
    expect(cycle).toContain('(CODES_STATUT_RECU as readonly string[]).includes(lu.code)')
    for (const nom of ['lireStatutRecu', 'rattacherStatutRecu', 'analyserXmlRecu', 'CODES_STATUT_RECU']) {
      expect(horsCopie, nom).not.toMatch(new RegExp(`(?:function|const|let|var) ${nom}\\b`))
    }
  })

  it('le garde mord : un caractère changé dans la copie, ou un code de plus, se voit', () => {
    const derivee = COPIE.replace("'200', '201', '202'", "'200', '201', '202', '214'")
    expect(derivee).not.toBe(ORIGINE)
    // Exécutée, la dérive change un rattachement : un 214 se garderait.
    const statut214 = { ...LUS[0], code: '214' }
    expect(executer(derivee).rattacherStatutRecu(statut214, factureRecue(), SIREN_VENDEUR_RECU))
      .not.toEqual(module.rattacherStatutRecu(statut214, factureRecue(), SIREN_VENDEUR_RECU))
    // Une dérive de l'analyseur — une entité de plus — change une lecture abîmée.
    const analyseur = COPIE.replace("apos: \"'\", quot: '\"' }", "apos: \"'\", quot: '\"', nbsp: ' ' }")
    expect(analyseur).not.toBe(COPIE)
    const avecEntite = MESSAGES[0].replace('Montant de la facture erroné', 'Montant&nbsp;erroné')
    expect(lectures(executer(analyseur), [avecEntite])).not.toEqual(lectures(module, [avecEntite]))
  })
})
