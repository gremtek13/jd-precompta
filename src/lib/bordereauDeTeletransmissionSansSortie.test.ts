import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// LE BORDEREAU DE TÉLÉTRANSMISSION NE SORT PAS DU NAVIGATEUR (conception 59, § 5.1 et BOR1 ; le patron :
// paiementsAssuranceMaladieSansSortie.test.ts). Le fichier d'un praticien porte des noms de patients ; il se lit dans le
// navigateur, et seuls l'en-tête du lot et ses totaux en sortent, par le RETOUR des fonctions. Ce relevé lit le texte des
// deux modules, commentaires ôtés :
//   - le module pur n'a AUCUNE sortie (le réseau, un journal, le stockage, l'horloge, la fenêtre, un import dynamique) et
//     n'importe rien ;
//   - l'ouverture n'a aucune sortie non plus, n'importe que le module pur, et ses seuls imports dynamiques sont pdf.js et son
//     ouvrier servi par l'application ; pdf.js n'y reçoit que des octets (`getDocument({ data`), jamais une adresse, ni une
//     adresse de polices, de tables de caractères ou de wasm qu'il irait chercher.
//   - le facturé (BOR2) n'a aucune sortie et n'importe que la liste des régimes, elle-même sans sortie ni import ;
//   - l'import du facturé (BOR3), qui compose le corps de l'appel — les numéros des lots y passent, pour la base seule — et
//     redit les refus de la base, n'a aucune sortie et n'importe rien (le type du facturé seul).
// Éprouvé par des défauts plantés dans chacun.

const PUR = 'src/lib/bordereauDeTeletransmission.ts'
const LECTURE = 'src/lib/bordereauDeTeletransmissionLecture.ts'

const sansCommentaires = (texte: string) => texte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

const SORTIES: readonly [string, RegExp][] = [
  ['le client de la base', /supabase/i],
  ['le réseau', /\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon/],
  ['un journal', /\bconsole\s*\./],
  ['le stockage du navigateur', /localStorage|sessionStorage|indexedDB|document\.cookie|caches\./],
  ['l’horloge', /\bDate\b|performance\.now|\bsetTimeout\b|\bsetInterval\b/],
  ['une Edge Function ou le modèle', /functions\.invoke|\binvoke\s*\(|bedrock|textract/i],
  ['la fenêtre', /\bwindow\s*\.|\bnavigator\s*\.|\bpostMessage\b/],
  ['une adresse donnée à pdf.js', /\burl\s*:|standardFontDataUrl|cMapUrl|wasmUrl|iccUrl|https?:\/\//],
]

const IMPORTS_DYNAMIQUES_DE_LA_LECTURE = new Set(['pdfjs-dist', 'pdfjs-dist/build/pdf.worker.min.mjs?url'])

/** Les fautes d'un texte de module : une sortie, un import hors de la liste, un import dynamique hors de la liste. */
export function fautes(texte: string, importsPermis: ReadonlySet<string>, dynamiquesPermis: ReadonlySet<string>): string[] {
  const code = sansCommentaires(texte)
  const trouvees = SORTIES.filter(([, motif]) => motif.test(code)).map(([nom]) => nom)
  for (const m of code.matchAll(/^\s*import\s+(type\s+)?[\s\S]*?\sfrom\s+'([^']+)'/gm)) {
    if (!m[1] && !importsPermis.has(m[2])) trouvees.push(`l’import de ${m[2]}`)
  }
  for (const m of code.matchAll(/\bimport\s*\(\s*([^)]*)\)/g)) {
    const cible = /^'([^']+)'$/.exec(m[1].trim())
    if (cible === null || !dynamiquesPermis.has(cible[1])) trouvees.push(`l’import dynamique de ${m[1].trim()}`)
  }
  for (const m of code.matchAll(/getDocument\s*\(\s*([^)]*)\)/g)) {
    if (!/^\{\s*data\s*:\s*\w+\s*\}$/.test(m[1].trim())) trouvees.push('pdf.js ouvert autrement que sur des octets')
  }
  return trouvees
}

describe('le module pur n’a aucune sortie et n’importe rien', () => {
  const texte = readFileSync(resolve(process.cwd(), PUR), 'utf8')
  const juger = (t: string) => fautes(t, new Set(), new Set())

  it('aucune sortie, aucun import', () => {
    expect(juger(texte)).toEqual([])
  })

  it('trois défauts plantés se voient : un journal d’une ligne, le client de la base, l’horloge', () => {
    const journal = texte.replace('    const rangDansLeTableau = ', '    console.log(l.originale)\n    const rangDansLeTableau = ')
    expect(journal).not.toBe(texte)
    expect(juger(journal)).toEqual(['un journal'])
    expect(juger(`import { supabase } from './supabase'\n${texte}`)).toEqual(['le client de la base', 'l’import de ./supabase'])
    const horloge = texte.replace('function dateCivile(', 'const aujourdHui = new Date()\nfunction dateCivile(')
    expect(horloge).not.toBe(texte)
    expect(juger(horloge)).toEqual(['l’horloge'])
  })
})

// LE FACTURÉ (BOR2, lib/factureAssuranceMaladie.ts) : des bordereaux lus aux agrégats, et l'identification des lots rendue au
// seul appel d'import ; il n'a aucune sortie, n'importe que la liste des régimes (et des types), et cette liste n'a aucune
// sortie ni aucun import (une sortie là serait une sortie du facturé, à un saut).
const FACTURE = 'src/lib/factureAssuranceMaladie.ts'
const REGIMES = 'src/lib/regimesAssuranceMaladie.ts'

describe('le facturé n’a aucune sortie, et n’importe que la liste des régimes', () => {
  const texte = readFileSync(resolve(process.cwd(), FACTURE), 'utf8')
  const regimes = readFileSync(resolve(process.cwd(), REGIMES), 'utf8')
  const juger = (t: string) => fautes(t, new Set(['./regimesAssuranceMaladie']), new Set())

  it('aucune sortie ; les régimes seuls importés en valeur, BOR1 en type seulement ; la liste des régimes, ni sortie ni import', () => {
    expect(juger(texte)).toEqual([])
    expect(texte).toContain('import type { BordereauLu } from \'./bordereauDeTeletransmission\'')
    expect(texte).toContain('from \'./regimesAssuranceMaladie\'')
    expect(fautes(regimes, new Set(), new Set())).toEqual([])
  })

  it('quatre défauts plantés se voient : un journal des lots, le client de la base, l’horloge, BOR1 importé en valeur', () => {
    const lots = '  const identificationDesLots: IdentificationDesLots = '
    expect(texte).toContain(lots)
    expect(juger(texte.replace(lots, `  console.info(lots)\n${lots}`))).toEqual(['un journal'])
    expect(juger(`import { supabase } from './supabase'\n${texte}`)).toEqual(['le client de la base', 'l’import de ./supabase'])
    const jour = '  const { aujourdHui, regimesChoisis } = parametres'
    expect(texte).toContain(jour)
    expect(juger(texte.replace(jour, '  const aujourdHui = new Date().toISOString().slice(0, 10)\n  const { regimesChoisis } = parametres'))).toEqual(['l’horloge'])
    expect(juger(texte.replace('import type { BordereauLu }', 'import { type BordereauLu, lireBordereauxDeTeletransmission }')))
      .toEqual(['l’import de ./bordereauDeTeletransmission'])
    expect(fautes(`${regimes}\nfetch('https://exemple.invalid')`, new Set(), new Set())).toEqual(['le réseau', 'une adresse donnée à pdf.js'])
  })
})

describe('l’ouverture n’a aucune sortie, et pdf.js n’y reçoit que des octets', () => {
  const texte = readFileSync(resolve(process.cwd(), LECTURE), 'utf8')
  const juger = (t: string) => fautes(t, new Set(['./bordereauDeTeletransmission']), IMPORTS_DYNAMIQUES_DE_LA_LECTURE)

  it('aucune sortie ; le module pur seul importé ; pdf.js et son ouvrier seuls chargés ; `getDocument({ data: … })`', () => {
    expect(juger(texte)).toEqual([])
    expect(texte).toContain('getDocument({ data: octets })')
  })

  it('quatre défauts plantés se voient : une adresse, une police distante, un journal de l’erreur, un autre module chargé', () => {
    const ouvert = 'pdfjsLib.getDocument({ data: octets })'
    expect(texte).toContain(ouvert)
    expect(juger(texte.replace(ouvert, 'pdfjsLib.getDocument({ url: adresse })'))).toEqual(['une adresse donnée à pdf.js', 'pdf.js ouvert autrement que sur des octets'])
    expect(juger(texte.replace(ouvert, 'pdfjsLib.getDocument({ data: octets, standardFontDataUrl: polices })')))
      .toEqual(['une adresse donnée à pdf.js', 'pdf.js ouvert autrement que sur des octets'])
    const journal = texte.replace('  } catch {\n    return { etat: \'refuse\', raison: \'le bordereau n’a pas pu être lu\' }',
      '  } catch (e) {\n    console.error(e)\n    return { etat: \'refuse\', raison: \'le bordereau n’a pas pu être lu\' }')
    expect(journal).not.toBe(texte)
    expect(juger(journal)).toEqual(['un journal'])
    expect(juger(texte.replace("await import('pdfjs-dist')", "await import('./supabase')"))).toEqual(['le client de la base', 'l’import dynamique de \'./supabase\''])
  })
})

// L'IMPORT DU FACTURÉ (BOR3, lib/importDuFactureAssuranceMaladie.ts) : le corps de l'appel porte les numéros des lots, que la
// base seule transforme en empreintes ; il se compose à l'appel et ne sort que par son retour. Le module n'a aucune sortie et
// n'importe rien (le type du facturé seul).
const IMPORT_DU_FACTURE = 'src/lib/importDuFactureAssuranceMaladie.ts'

describe('l’import du facturé n’a aucune sortie, et n’importe que le type du facturé', () => {
  const texte = readFileSync(resolve(process.cwd(), IMPORT_DU_FACTURE), 'utf8')
  const juger = (t: string) => fautes(t, new Set(), new Set())

  it('aucune sortie, aucun import en valeur ; BOR2 en type seulement', () => {
    expect(juger(texte)).toEqual([])
    expect(texte).toContain('import type { FactureDesBordereaux } from \'./factureAssuranceMaladie\'')
  })

  it('quatre défauts plantés se voient : un journal du corps, le client de la base, l’horloge, BOR2 importé en valeur', () => {
    const corps = '  return {\n    version: 1,\n    lots: facture.identificationDesLots.pourLAppelDImport()'
    expect(texte).toContain(corps)
    expect(juger(texte.replace(corps, `  console.debug(facture)\n${corps}`))).toEqual(['un journal'])
    expect(juger(`import { supabase } from './supabase'\n${texte}`)).toEqual(['le client de la base', 'l’import de ./supabase'])
    const jour = '  if (!estUneDateDeLot(jour)) return R.aVenir'
    expect(texte).toContain(jour)
    expect(juger(texte.replace(jour, `  const maintenant = Date.now()\n${jour}`))).toEqual(['l’horloge'])
    expect(juger(texte.replace('import type { FactureDesBordereaux }', 'import { type FactureDesBordereaux, factureDesBordereaux }')))
      .toEqual(['l’import de ./factureAssuranceMaladie'])
  })
})
