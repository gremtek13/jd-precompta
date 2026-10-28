import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { NATURES_ARTICLE, UNITES_ARTICLE } from './articles'
import { numeroTvaImprime } from './factureCii'
import {
  MENTIONS_FIGEES_EXPORTEES, NATURES_DE_LIGNE, REFERENCE_DE_LIGNE_MAX, REFUS_DE_LA_PROVENANCE, REFUS_DE_LA_VALIDATION_FIGEE,
  UNITES_DE_LIGNE, mentionsAFiger, porteLaMentionEI, refusDeLaProvenance, refusDeLaValidationFigee,
  type EntreeDesMentions, type MentionsDeLOrigine, type VersionAFiger,
} from './mentionsFigees'
import type { StatutTva } from './types'
import { correspondAuModele } from '../test/essaiVentesFacturees'
import { derniereDefinitionSql, fichiersDuSchema } from '../test/schema'

// LA FACTURE FIGE SES MENTIONS (espace client, étape A7a, ligne 51.5 ; migration `mentions_figees`, PRÉPARÉE sous une
// version provisoire, pas encore en base), CONFRONTÉE AU TEXTE DE SA MIGRATION ET À SON ESSAI : chaque refus neuf du
// module est celui d'`enregistrer_facture` — même message, même rang, même code —, l'essai les exige tous, et le module
// rejoue chaque appel de l'essai à la fonction comme la base y a répondu ; le numéro de TVA et la mention d'un
// entrepreneur individuel se confrontent aux cas de l'essai, que la base a jugés (supabase/essais/mentionsFigees.sql).

const md5 = (texte: string) => createHash('md5').update(texte, 'utf8').digest('hex')
const chaineSql = (s: string) => s.replace(/''/g, "'")

const MIGRATIONS = fichiersDuSchema().filter((f) => /\/\d{14}_mentions_figees\.sql$/.test(f.chemin))
const MIGRATION = MIGRATIONS.length === 1 ? MIGRATIONS[0] : { chemin: '', texte: '' }
const ESSAI = readFileSync(new URL('../../supabase/essais/mentionsFigees.sql', import.meta.url), 'utf8')
const MODULE = readFileSync(new URL('./mentionsFigees.ts', import.meta.url), 'utf8')

// La définition d'une fonction dans le dernier fichier de l'export qui la pose AVANT la migration : celle que la
// production porte aujourd'hui, et que la garde de tête suppose.
function definitionDAvant(nom: string): { chemin: string; corps: string; texte: string } {
  const motif = new RegExp(`create (or replace )?function public\\.${nom}\\(`, 'g')
  const avant = fichiersDuSchema().filter((f) => f.chemin < MIGRATION.chemin && new RegExp(motif.source).test(f.texte))
  const fichier = avant[avant.length - 1]
  const debut = [...fichier.texte.matchAll(motif)].map((m) => m.index).pop() as number
  const ouverture = /\bas\s+(\$\w*\$)/.exec(fichier.texte.slice(debut)) as RegExpExecArray
  const corpsDebut = debut + ouverture.index + ouverture[0].length
  const corpsFin = fichier.texte.indexOf(ouverture[1], corpsDebut)
  return { chemin: fichier.chemin, corps: fichier.texte.slice(corpsDebut, corpsFin), texte: fichier.texte.slice(debut, corpsFin) }
}

// Les messages des `raise exception` d'un texte, dans son ordre, l'apostrophe doublée de SQL rendue simple ; leurs codes ;
// ce qui remplit leurs « % ».
const messagesSql = (sql: string) => [...sql.matchAll(/raise exception '((?:[^']|'')*)'/g)].map((m) => chaineSql(m[1]))
const codesSql = (sql: string) =>
  [...sql.matchAll(/raise exception '(?:[^']|'')*'[\s\S]*?using errcode = '([0-9A-Z]{5})'/g)].map((m) => m[1])
const valeursSql = (sql: string) =>
  [...sql.matchAll(/raise exception '(?:[^']|'')*'([\s\S]*?)using errcode/g)]
    .map((m) => m[1].replace(/\s+/g, ' ').trim().replace(/^,\s*/, '').trim())

const FONCTION = MIGRATION.texte === '' ? '' : derniereDefinitionSql('enregistrer_facture')
// Le texte entre deux bornes, la première comprise ; des bornes introuvables font échouer le test qui les cherche.
const entre = (texte: string, debut: string, fin: string) => {
  const i = texte.indexOf(debut)
  const j = i < 0 ? -1 : texte.indexOf(fin, i + debut.length)
  if (i < 0 || j < 0) throw new Error(`Bornes introuvables : « ${debut} » … « ${fin} »`)
  return texte.slice(i, j)
}
const PROVENANCE = () => entre(FONCTION, '-- A7. LA PROVENANCE', "if p_facture_id is null and p_facture->>'type' = 'avoir' then\n    insert")
const VALIDATION = () => entre(FONCTION, '-- A7. CE QUE LA VALIDATION FIGE', 'with recursive chaine')

// ── Le drapeau, la migration, sa garde de tête ─────────────────────────────────────────────────────────────────────
describe('le drapeau et la migration', () => {
  it('le drapeau reste faux dans ce lot : la migration est préparée, pas en base, et son commentaire le dit', () => {
    // Levé, l'étape A7b enverrait des clés qu'`enregistrer_facture` d'aujourd'hui ignorerait et lirait des colonnes absentes.
    expect(MENTIONS_FIGEES_EXPORTEES).toBe(false)
    const commentaire = entre(MODULE, "// LA MIGRATION N'EST PAS ENCORE EN BASE.", 'export const MENTIONS_FIGEES_EXPORTEES')
    expect(commentaire).toContain('La session le lèvera elle-même, la migration collée.')
  })

  it('la migration est dans l’export, une fois, et seule à définir les deux fonctions neuves', () => {
    expect(MIGRATIONS).toHaveLength(1)
    for (const nom of ['numero_tva_du_vendeur', 'porte_la_mention_ei']) {
      expect(fichiersDuSchema().filter((f) => new RegExp(`create (or replace )?function public\\.${nom}\\(`).test(f.texte))
        .map((f) => f.chemin), nom).toEqual([MIGRATION.chemin])
    }
    // Et la dernière définition d'`enregistrer_facture` est la sienne.
    expect(FONCTION).toContain('-- A7. LA PROVENANCE')
  })

  it('la garde de tête attend l’empreinte des corps d’hier, tels que l’export les porte (les retours chariot écartés)', () => {
    const attendues = [...MIGRATION.texte.matchAll(/\('(\w+)', '([0-9a-f]{32})'\)/g)].map((m) => [m[1], m[2]])
    expect(attendues.map(([nom]) => nom)).toEqual(['enregistrer_facture', 'garder_factures_validees', 'garder_lignes_facture_validee',
      'fixer_source_de_la_vente'])
    for (const [nom, empreinte] of attendues) expect(md5(definitionDAvant(nom).corps.replace(/\r/g, '')), nom).toBe(empreinte)
    // La borne : un caractère de plus dans un corps change son empreinte.
    expect(md5(`${definitionDAvant('enregistrer_facture').corps} `)).not.toBe(attendues[0][1])
  })

  it('la garde de tête nomme chaque colonne que la migration ajoute, et rien d’autre', () => {
    const garde = entre(MIGRATION.texte, 'do $garde$', '$garde$;')
    const gardees = [...garde.matchAll(/\('(\w+)', '(\w+)'\)/g)].filter((m) => !/^[0-9a-f]{32}$/.test(m[2])).map((m) => `${m[1]}.${m[2]}`)
    const ajoutees = [...MIGRATION.texte.matchAll(/alter table public\.(\w+)\s+((?:add column[\s\S]*?)(?=;\n))/g)]
      .flatMap((m) => [...m[2].matchAll(/add column (\w+)/g)].map((c) => `${m[1]}.${c[1]}`))
    expect(gardees.sort()).toEqual(ajoutees.sort())
    expect(ajoutees).toHaveLength(29)
  })
})

// ── Les refus neufs, confrontés au texte de la fonction ────────────────────────────────────────────────────────────
describe('les refus neufs d’enregistrer_facture, confrontés à son texte', () => {
  const PROV = ['unite', 'reference', 'nature', 'contact', 'article'] as const
  const VALID = ['contact_garde', 'forme_a_regler', 'entrepreneur_individuel'] as const

  it('ceux d’hier d’abord, dans le même ordre et sous les mêmes mots, puis la provenance, puis la validation', () => {
    const hier = definitionDAvant('enregistrer_facture').texte
    expect(messagesSql(FONCTION)).toEqual([
      ...messagesSql(hier),
      ...REFUS_DE_LA_PROVENANCE.map((r) => r.modele),
      ...REFUS_DE_LA_VALIDATION_FIGEE.map((r) => r.modele),
    ])
    expect(codesSql(FONCTION)).toEqual([
      ...codesSql(hier), ...REFUS_DE_LA_PROVENANCE.map((r) => r.code), ...REFUS_DE_LA_VALIDATION_FIGEE.map((r) => r.code),
    ])
    expect(valeursSql(FONCTION).slice(0, messagesSql(hier).length)).toEqual(valeursSql(hier))
  })

  it('la provenance : les mêmes refus, dans l’ordre du module, la ligne en valeur', () => {
    expect(REFUS_DE_LA_PROVENANCE.map((r) => r.cle)).toEqual([...PROV])
    expect(messagesSql(PROVENANCE())).toEqual(REFUS_DE_LA_PROVENANCE.map((r) => r.modele))
    expect(codesSql(PROVENANCE())).toEqual(REFUS_DE_LA_PROVENANCE.map((r) => r.code))
    expect(valeursSql(PROVENANCE())).toEqual(['v_ligne.ord', 'v_ligne.ord', 'v_ligne.ord', '', 'v_ligne.ord'])
    REFUS_DE_LA_PROVENANCE.forEach((r, i) => expect(r.modele.split('%').length - 1, r.cle).toBe(valeursSql(PROVENANCE())[i] ? 1 : 0))
    // Le rang dit l'ordre des passes : les formes des lignes, le contact, les articles.
    expect(REFUS_DE_LA_PROVENANCE.map((r) => r.rang)).toEqual([1, 1, 1, 2, 3])
  })

  it('la validation : le contact gardé, la forme pour un accès « Ventes », l’entrepreneur individuel, avant la numérotation', () => {
    expect(REFUS_DE_LA_VALIDATION_FIGEE.map((r) => r.cle)).toEqual([...VALID])
    expect(messagesSql(VALIDATION())).toEqual(REFUS_DE_LA_VALIDATION_FIGEE.map((r) => r.modele))
    expect(codesSql(VALIDATION())).toEqual(REFUS_DE_LA_VALIDATION_FIGEE.map((r) => r.code))
    expect(valeursSql(VALIDATION())).toEqual(['', '', ''])
    expect(REFUS_DE_LA_VALIDATION_FIGEE.map((r) => r.rang)).toEqual([4, 5, 6])
    expect(FONCTION.indexOf('-- A7. CE QUE LA VALIDATION FIGE')).toBeLessThan(FONCTION.indexOf('v_numero := attribuer_numero_facture('))
    // Les conditions que le module rejoue, telles que la fonction les écrit : la forme jugée pour un accès « Ventes » seul,
    // hors d'un avoir qui reprend l'identité de sa facture ; le mandataire, le cabinet seul.
    expect(VALIDATION()).toContain('v_cabinet := public.admin_du_dossier(p_dossier_id);\n'
      + "    if v_forme_juridique is null and not v_cabinet and not (v_type = 'avoir' and v_origine.mentions_figees) then")
    expect(VALIDATION()).toContain("if v_forme_juridique = '1000' and not public.porte_la_mention_ei(v_denomination) then")
    expect(FONCTION).toContain('    if v_cabinet then\n      select c.nom into v_mandataire from cabinets c where c.id = v_dossier.cabinet_id;')
    // Le refus du contact gardé est, mot pour mot, celui de la provenance : l'écran le dit d'une seule phrase.
    expect(REFUS_DE_LA_VALIDATION_FIGEE[0].modele).toBe(REFUS_DE_LA_PROVENANCE[3].modele)
  })

  // LA BORNE DU HARNAIS : une confrontation qui ne saurait pas virer au rouge ne prouverait rien.
  it('vire au rouge sur une dérive plantée : un mot, deux refus permutés, un code changé', () => {
    const attendu = REFUS_DE_LA_PROVENANCE.map((r) => r.modele)
    const raise = (modele: string) => `raise exception '${modele.replace(/'/g, "''")}'`
    const [unite, nature] = [raise(REFUS_DE_LA_PROVENANCE[0].modele), raise(REFUS_DE_LA_PROVENANCE[2].modele)]
    const texte = PROVENANCE()
    expect(texte).toContain(unite)
    expect(texte).toContain(nature)
    expect(messagesSql(texte.replace(unite, `${unite.slice(0, -1)} !'`))).not.toEqual(attendu)
    expect(messagesSql(texte.replace(unite, '§').replace(nature, unite).replace('§', nature))).not.toEqual(attendu)
    expect(codesSql(texte.replace("using errcode = 'P0002'", "using errcode = '23514'")))
      .not.toEqual(REFUS_DE_LA_PROVENANCE.map((r) => r.code))
  })
})

// ── Les listes de la base ──────────────────────────────────────────────────────────────────────────────────────────
describe('les unités, les natures et la référence d’une ligne sont celles des articles', () => {
  const liste = (texte: string, motif: RegExp) => {
    const m = motif.exec(texte)
    expect(m, String(motif)).not.toBeNull()
    return [...(m as RegExpExecArray)[1].matchAll(/'(\w+)'/g)].map((x) => x[1])
  }
  const articles = fichiersDuSchema().find((f) => /_articles\.sql$/.test(f.chemin))?.texte ?? ''

  it('les unités : la liste du module, la contrainte des articles, celle des lignes, le refus de la fonction', () => {
    expect(UNITES_DE_LIGNE).toEqual(UNITES_ARTICLE.map((u) => u.code))
    expect(liste(articles, /constraint articles_unite_check\s+check \(unite in \(([^)]*)\)\)/)).toEqual(UNITES_DE_LIGNE)
    expect(liste(MIGRATION.texte, /constraint facture_lignes_unite_check\s+check \(unite in \(([^)]*)\)\)/)).toEqual(UNITES_DE_LIGNE)
    expect(liste(PROVENANCE(), /v_ligne\.valeur->>'unite' not in \(([^)]*)\)/)).toEqual(UNITES_DE_LIGNE)
  })

  it('les natures : biens ou services, partout', () => {
    expect(NATURES_DE_LIGNE).toEqual(NATURES_ARTICLE)
    expect(liste(articles, /constraint articles_nature_check check \(nature in \(([^)]*)\)\)/)).toEqual([...NATURES_DE_LIGNE])
    expect(liste(MIGRATION.texte, /constraint facture_lignes_nature_check check \(nature in \(([^)]*)\)\)/)).toEqual([...NATURES_DE_LIGNE])
    expect(liste(PROVENANCE(), /v_ligne\.valeur->>'nature' not in \(([^)]*)\)/)).toEqual([...NATURES_DE_LIGNE])
  })

  it('la référence : un à cent caractères, sans les quatre blancs aux bords, comme celle d’un article', () => {
    expect(REFERENCE_DE_LIGNE_MAX).toBe(100)
    const forme = "char_length(reference) between 1 and 100 and btrim(reference, E' \\t\\n\\r') = reference"
    expect(articles).toContain(`constraint articles_reference_forme\n      check (${forme})`)
    expect(MIGRATION.texte).toContain(`constraint facture_lignes_reference_forme\n      check (${forme})`)
    expect(PROVENANCE()).toContain("or char_length(v_ligne.valeur->>'reference') not between 1 and 100\n"
      + "            or btrim(v_ligne.valeur->>'reference', E' \\t\\n\\r') <> v_ligne.valeur->>'reference') then")
  })
})

// ── L'essai, lu ────────────────────────────────────────────────────────────────────────────────────────────────────
interface EtapeDeLEssai { numero: string; genre: string; requete: string; code: string; attendu: string | null }
const ETAPES: EtapeDeLEssai[] = [...ESSAI.matchAll(
  /\('(\w+)', '(\w+)', '(?:[^']|'')*', '\w+', (?:null|'\w+'),\s*\$q\$([\s\S]*?)\$q\$,\s*'(\w+)',\s*(null|'(?:[^']|'')*'),\s*(?:null|'\w+')\)/g,
)].map((m) => ({ numero: m[1], genre: m[2], requete: m[3], code: m[4], attendu: m[5] === 'null' ? null : chaineSql(m[5].slice(1, -1)) }))

// Les identifiants de l'essai ; l'inconnu (tiré au hasard) prend ici un identifiant qu'aucun jeu ne pose.
const IDS = new Map([...entre(ESSAI, 'ids := jsonb_build_object(', ';\n').matchAll(/'(\w+)', '([0-9a-f-]{36})'/g)].map((m) => [m[1], m[2]]))
IDS.set('INCONNUE', 'a7a00000-0000-4000-8000-00000000ffff')
const macro = (texte: string) => texte.replace(/\{(\w+)\}/g, (tout, cle: string) => IDS.get(cle) ?? tout)

describe('l’essai exige chaque refus neuf, et le module rejoue ses appels comme la base y a répondu', () => {
  it('chaque refus du module est exigé par au moins un contrôle de l’essai, sous son code et ses mots', () => {
    expect(ETAPES.length).toBeGreaterThan(90)
    for (const r of [...REFUS_DE_LA_PROVENANCE, ...REFUS_DE_LA_VALIDATION_FIGEE]) {
      expect(ETAPES.some((e) => e.genre === 'controle' && e.code === r.code && e.attendu !== null && correspondAuModele(r.modele, e.attendu)),
        r.cle).toBe(true)
    }
  })

  // Les contacts et les articles de chaque dossier de l'essai, tels que son jeu `j3` les pose.
  const j3 = ETAPES.find((e) => e.numero === 'j3') as EtapeDeLEssai
  const duDossier = (prefixe: string) => {
    const paires = [...j3.requete.matchAll(new RegExp(`\\('\\{(${prefixe}\\w)\\}', '\\{(D\\w)\\}'`, 'g'))]
    return (dossier: string) => paires.filter((p) => p[2] === dossier).map((p) => IDS.get(p[1]) as string)
  }
  const contactsDe = duDossier('K')
  const articlesDe = duDossier('A')

  it('les appels de l’essai à enregistrer_facture, rejoués par le module : le même refus, ou aucun', () => {
    const APPEL = /enregistrer_facture\('\{(\w+)\}', (null|'\{\w+\}'), '((?:[^']|'')*)'::jsonb,\s*'((?:[^']|'')*)'::jsonb, (true|false)\)/
    const neufs = [...REFUS_DE_LA_PROVENANCE, ...REFUS_DE_LA_VALIDATION_FIGEE]
    let rejoues = 0
    const vus = new Set<string>()
    for (const e of ETAPES) {
      const appel = APPEL.exec(e.requete.split('§§')[0])
      if (!appel) continue
      const facture = JSON.parse(macro(chaineSql(appel[3])))
      const lignes = JSON.parse(macro(chaineSql(appel[4])))
      const rendu = refusDeLaProvenance({
        avoir: appel[2] === 'null' && facture.type === 'avoir', facture, lignes,
        contactsDuDossier: contactsDe(appel[1]), articlesDuDossier: articlesDe(appel[1]),
      })
      const attendu = e.code === 'OK' ? null : neufs.find((r) => r.code === e.code && e.attendu !== null && correspondAuModele(r.modele, e.attendu))
      // Un refus d'hier (l'accès, l'avoir, la facture validée, une contrainte) passe avant le module : rien à rejouer.
      if (attendu === undefined) continue
      rejoues += 1
      if (attendu === null || REFUS_DE_LA_VALIDATION_FIGEE.some((r) => r.cle === attendu.cle)) {
        expect(rendu, `étape ${e.numero}`).toBeNull()
      } else {
        expect(rendu && { cle: rendu.cle, code: rendu.code, message: rendu.message }, `étape ${e.numero}`)
          .toEqual({ cle: attendu.cle, code: attendu.code, message: e.attendu })
        vus.add(attendu.cle)
      }
    }
    // Le plancher : l'essai ne s'est pas vidé, et chaque refus de la provenance y a été rejoué au moins une fois — la
    // référence de cent un caractères (l'étape 44, composée en SQL) l'est par le test qui suit.
    expect(rejoues).toBeGreaterThanOrEqual(25)
    expect([...vus].sort()).toEqual(['article', 'contact', 'nature', 'reference', 'unite'])
  })
})

// ── Le numéro de TVA et la mention de l'entrepreneur individuel, sur les cas que la base a jugés ─────────────────────
// Une expression SQL de l'essai : NULL, un booléen, ou des chaînes et des `chr(n)` joints par `||`.
function valeurSql(expression: string): string | boolean | null {
  const e = expression.trim()
  if (e === 'null') return null
  if (e === 'true' || e === 'false') return e === 'true'
  return [...e.matchAll(/'((?:[^']|'')*)'|chr\((\d+)\)/g)].map((m) => (m[2] ? String.fromCodePoint(Number(m[2])) : chaineSql(m[1]))).join('')
}
// Les arguments d'une ligne `(…)` de VALUES, coupés aux virgules hors des chaînes et des parenthèses.
function argumentsSql(ligne: string): string[] {
  const out: string[] = []
  let courant = ''
  let profondeur = 0
  let chaine = false
  for (const c of ligne) {
    if (c === "'") chaine = !chaine
    if (!chaine && c === '(') profondeur += 1
    if (!chaine && c === ')') profondeur -= 1
    if (!chaine && profondeur === 0 && c === ',') { out.push(courant); courant = '' } else courant += c
  }
  out.push(courant)
  return out.map((a) => a.trim())
}
function casDeLEssai(nom: string): { cas: (string | boolean | null)[][]; attendus: Map<string, string> } {
  const bloc = entre(ESSAI, `-- ── DÉBUT DES CAS ${nom} ──`, `-- ── FIN DES CAS ${nom} ──`)
  const cas = [...bloc.matchAll(new RegExp(`^\\s*\\(('${nom}-\\d+', .*)\\),?$`, 'gm'))].map((m) => argumentsSql(m[1]).map(valeurSql))
  const resultat = new RegExp(`'OK', '((?:${nom}-\\d+=\\S+ ?)+)'`).exec(bloc) as RegExpExecArray
  return { cas, attendus: new Map(resultat[1].split(' ').map((paire) => paire.split('=') as [string, string])) }
}

describe('le numéro de TVA : le module et la base, cas par cas', () => {
  const { cas, attendus } = casDeLEssai('TVA')

  it('chaque cas de l’essai, jugé par la base, est rendu tel quel par `numeroTvaImprime`', () => {
    expect(cas).toHaveLength(20)
    expect(attendus.size).toBe(20)
    for (const [nom, statut, attribue, siret] of cas) {
      // `numero_tva_du_vendeur` lit une case nulle comme fausse (`coalesce`), comme le module lit `!null`.
      const rendu = numeroTvaImprime({ emetteur_siret: siret as string | null },
        { statut_tva: statut as StatutTva | null, article_exoneration: null, numero_tva_attribue: (attribue as boolean | null) ?? false })
      expect(rendu ?? '-', String(nom)).toBe(attendus.get(String(nom)))
    }
    // Le plancher : des numéros rendus ET des refus.
    expect([...attendus.values()].filter((v) => v !== '-').length).toBeGreaterThanOrEqual(8)
    expect([...attendus.values()].filter((v) => v === '-').length).toBeGreaterThanOrEqual(8)
  })

  it('les blancs que la base retire du SIRET sont ceux que `\\s` désigne en JavaScript, un par un', () => {
    const declaration = entre(MIGRATION.texte, 'v_blancs constant text :=', ';\n')
    const enBase = [...declaration.matchAll(/chr\((\d+)\)/g)].map((m) => Number(m[1]))
    const enJs: number[] = []
    for (let c = 0; c <= 0xffff; c++) if (/\s/.test(String.fromCharCode(c))) enJs.push(c)
    expect(enBase).toEqual(enJs)
  })
})

describe('la mention d’un entrepreneur individuel : le module et la base, cas par cas', () => {
  const { cas, attendus } = casDeLEssai('EI')

  it('chaque cas de l’essai, jugé par la base, est rendu tel quel par `porteLaMentionEI`', () => {
    expect(cas).toHaveLength(20)
    for (const [nom, denomination] of cas) {
      expect(String(porteLaMentionEI(denomination as string | null)), String(nom)).toBe(attendus.get(String(nom)))
    }
    expect([...attendus.values()].filter((v) => v === 'true').length).toBeGreaterThanOrEqual(8)
    expect([...attendus.values()].filter((v) => v === 'false').length).toBeGreaterThanOrEqual(8)
  })

  it('les deux motifs du module sont ceux de la base, lus dans sa fonction', () => {
    const fonction = entre(MIGRATION.texte, 'create function public.porte_la_mention_ei(', '$$;')
    expect(fonction).toContain("p_denomination ~ '(^|[^[:alpha:]])E[.]?I[.]?($|[^[:alpha:]])'")
    expect(fonction).toContain("p_denomination ~* '(^|[^[:alpha:]])entrepreneure?[[:space:]]+individuel(le)?($|[^[:alpha:]])'")
    expect(MODULE).toContain('const INITIALES_EI = /(^|[^\\p{L}])E\\.?I\\.?($|[^\\p{L}])/u')
    expect(MODULE).toContain('const MOTS_EI = /(^|[^\\p{L}])entrepreneure?\\s+individuel(le)?($|[^\\p{L}])/iu')
  })
})

// ── Le module, sur ses propres cas ─────────────────────────────────────────────────────────────────────────────────
describe('refusDeLaProvenance', () => {
  const K = 'a7a00000-0000-4000-8000-0000000001a1'
  const A = 'a7a00000-0000-4000-8000-0000000002a1'
  const juger = (facture: unknown, lignes: unknown, avoir = false) =>
    refusDeLaProvenance({ avoir, facture, lignes, contactsDuDossier: [K], articlesDuDossier: [A] })
  const ligne = (champs: Record<string, unknown> = {}) => ({ designation: 'x', quantite: 1, prix_unitaire_ht: 1, taux_tva: 20, ...champs })

  it('accepte une ligne sans provenance, ou avec la sienne', () => {
    expect(juger({}, [ligne()])).toBeNull()
    expect(juger({ contact_id: K }, [ligne({ unite: 'HUR', reference: 'A7-1', article_id: A, nature: 'services' })])).toBeNull()
    // Nulle ou absente, une clé ne dit rien ; `undefined` et NaN disparaissent ou deviennent nuls à l'envoi.
    expect(juger({ contact_id: null }, [ligne({ unite: null, reference: undefined, article_id: Number.NaN, nature: null })])).toBeNull()
  })

  it('refuse la forme d’une ligne, ligne par ligne, l’unité, puis la référence, puis la nature', () => {
    expect(juger({}, [ligne(), ligne({ unite: 'XYZ' })])).toEqual({ cle: 'unite', code: '22023',
      message: "Ligne 2 : l'unité n'est pas de la liste des unités admises." })
    expect(juger({}, [ligne({ unite: 5 })])?.cle).toBe('unite')
    expect(juger({}, [ligne({ unite: 'XYZ', reference: '' })])?.cle).toBe('unite')
    expect(juger({}, [ligne({ reference: ' A7', nature: 'mixte' })])?.cle).toBe('reference')
    expect(juger({}, [ligne({ nature: 'mixte' }), ligne({ unite: 'XYZ' })])).toEqual({ cle: 'nature', code: '22023',
      message: "Ligne 1 : la nature d'une ligne est « biens » ou « services »." })
  })

  it('la référence : un à cent caractères comptés comme la base les compte, sans blanc aux bords', () => {
    expect(juger({}, [ligne({ reference: '' })])?.cle).toBe('reference')
    expect(juger({}, [ligne({ reference: 'A7\t' })])?.cle).toBe('reference')
    expect(juger({}, [ligne({ reference: 12 })])?.cle).toBe('reference')
    expect(juger({}, [ligne({ reference: 'é'.repeat(101) })])).toEqual({ cle: 'reference', code: '22023',
      message: 'Ligne 1 : la référence tient en un à cent caractères, sans blanc au début ni à la fin.' })
    expect(juger({}, [ligne({ reference: 'é'.repeat(100) })])).toBeNull()
    // Un caractère hors du plan de base compte pour un, comme `char_length` : deux unités de code JavaScript.
    expect(juger({}, [ligne({ reference: '𝔸'.repeat(100) })])).toBeNull()
    expect(juger({}, [ligne({ reference: '𝔸'.repeat(101) })])?.cle).toBe('reference')
    // Une espace insécable n'est pas un des quatre blancs de `btrim` : la base la garde, le module aussi.
    expect(juger({}, [ligne({ reference: `${String.fromCharCode(160)}A7` })])).toBeNull()
  })

  it('le contact après les formes, les articles après le contact', () => {
    expect(juger({ contact_id: 'a7a00000-0000-4000-8000-0000000001b1' }, [ligne({ unite: 'XYZ' })])?.cle).toBe('unite')
    expect(juger({ contact_id: 'a7a00000-0000-4000-8000-0000000001b1' }, [ligne({ article_id: 'abc' })])).toEqual({ cle: 'contact',
      code: 'P0002', message: "Le contact d'où vient le client de la facture est introuvable dans ce dossier." })
    expect(juger({ contact_id: 5 }, [ligne()])?.cle).toBe('contact')
    expect(juger({ contact_id: K.toUpperCase() }, [ligne()])?.cle).toBe('contact')
    expect(juger({}, [ligne(), ligne({ article_id: 'abc' })])).toEqual({ cle: 'article', code: 'P0002',
      message: "Ligne 2 : l'article d'où elle vient est introuvable dans ce dossier." })
    expect(juger({}, [ligne({ article_id: {} })])?.cle).toBe('article')
  })

  it('un avoir prend le contact de sa facture : celui de la saisie ne se juge pas, ses lignes si', () => {
    expect(juger({ type: 'avoir', contact_id: 'inconnu' }, [ligne({ quantite: -1 })], true)).toBeNull()
    expect(juger({ type: 'avoir' }, [ligne({ quantite: -1, article_id: 'abc' })], true)?.cle).toBe('article')
  })

  it('une saisie qui n’est pas un objet, ou des lignes qui ne sont pas une liste, ne disent rien de neuf', () => {
    expect(juger(null, [ligne()])).toBeNull()
    expect(juger([], 'pas une liste')).toBeNull()
    expect(juger({}, [5, null, 'x'])).toBeNull()
  })
})

describe('porteLaMentionEI et refusDeLaValidationFigee', () => {
  it('la mention, détachée des lettres voisines, en capitales pour les initiales', () => {
    expect(porteLaMentionEI('ESSAI DUPONT EI')).toBe(true)
    expect(porteLaMentionEI('ESSAI DUPONT ei')).toBe(false)
    expect(porteLaMentionEI('ESSAI DUPONT, Entrepreneure individuelle')).toBe(true)
    expect(porteLaMentionEI('ESSAI DEI')).toBe(false)
    expect(porteLaMentionEI('ESSAI DUPONT EIÉ')).toBe(false)
    expect(porteLaMentionEI(null)).toBe(false)
    expect(porteLaMentionEI(undefined)).toBe(false)
  })

  it('le contact gardé d’abord, puis la forme pour un accès « Ventes », puis la dénomination d’un entrepreneur individuel', () => {
    const K = 'a7a00000-0000-4000-8000-0000000001a1'
    const base = { contactGarde: null, contactsDuDossier: [K], formeJuridique: '1000', denomination: 'ESSAI DUPONT EI', cabinet: false,
      reprise: false }
    expect(refusDeLaValidationFigee(base)).toBeNull()
    expect(refusDeLaValidationFigee({ ...base, contactGarde: K })).toBeNull()
    expect(refusDeLaValidationFigee({ ...base, contactGarde: 'autre', formeJuridique: null })).toEqual({ cle: 'contact_garde',
      code: 'P0002', message: "Le contact d'où vient le client de la facture est introuvable dans ce dossier." })
    expect(refusDeLaValidationFigee({ ...base, denomination: 'ESSAI DUPONT' })?.cle).toBe('entrepreneur_individuel')
    expect(refusDeLaValidationFigee({ ...base, denomination: null, cabinet: true })?.code).toBe('22023')
    // Sans forme : un accès « Ventes » ne valide pas ; le cabinet, si ; un avoir qui reprend l'identité de sa facture, si.
    expect(refusDeLaValidationFigee({ ...base, formeJuridique: null, denomination: null })).toEqual({ cle: 'forme_a_regler', code: '22023',
      message: "La forme juridique du dossier n'est pas renseignée : l'identité légale qu'une facture imprime est à régler par le "
        + "cabinet avant qu'une facture se valide depuis l'espace client." })
    expect(refusDeLaValidationFigee({ ...base, formeJuridique: undefined })?.cle).toBe('forme_a_regler')
    expect(refusDeLaValidationFigee({ ...base, formeJuridique: null, cabinet: true })).toBeNull()
    expect(refusDeLaValidationFigee({ ...base, formeJuridique: null, reprise: true })).toBeNull()
    expect(refusDeLaValidationFigee({ ...base, formeJuridique: '5710', denomination: null })).toBeNull()
  })
})

describe('mentionsAFiger', () => {
  const D = 'a7a00000-0000-4000-8000-0000000000a1'
  const version = (v: Partial<VersionAFiger>): VersionAFiger => ({
    id: 'v1', dossier_id: D, remplace_id: null, cree_le: '2026-10-01T10:00:00Z', logo_chemin: null, logo_sha256: null,
    iban: null, bic: null, titulaire_compte: null, rib_etat: null, rib_confirme_par: null, rib_confirme_le: null, auteur: 'c',
    moyen_prefere: null, escompte: null, penalites: null, mentions_complementaires: null, pied_de_page: null, ...v,
  })
  const V1 = version({ id: 'v1', moyen_prefere: 'virement', escompte: 'E1', iban: 'FR9399999000010000000000100', bic: 'ESSAFR10',
    titulaire_compte: 'T1', rib_etat: 'confirme', rib_confirme_par: 'c', rib_confirme_le: '2026-10-01T10:00:00Z',
    logo_chemin: `${D}/logos/${'a7'.repeat(32)}.png`, logo_sha256: 'a7'.repeat(32) })
  const V2 = version({ id: 'v2', remplace_id: 'v1', moyen_prefere: 'virement', escompte: 'E2', penalites: 'P2',
    mentions_complementaires: 'M2', pied_de_page: 'PP2', iban: 'FR9299999000010000000000700', bic: 'ESSAFR10', titulaire_compte: 'T2',
    rib_etat: 'propose', logo_chemin: V1.logo_chemin, logo_sha256: V1.logo_sha256 })
  const dossier: EntreeDesMentions['dossier'] = {
    statut_tva: 'redevable', article_exoneration: null, numero_tva_attribue: false, denomination_imprimee: 'ESSAI DUPONT EI',
    forme_juridique: '1000', capital: null, rcs_ville: null, mentions_identite: 'ESSAI RÉPERTOIRE DES MÉTIERS',
  }
  const entree = (e: Partial<EntreeDesMentions> = {}): EntreeDesMentions => ({
    dossierId: D, emetteurSiret: '12345678200010', origine: null, dossier, versions: [V1, V2], mandataire: null, ...e,
  })

  it('une facture : le jour, la version courante, le RIB confirmé — jamais le proposé —, le numéro du SIRET figé', () => {
    expect(mentionsAFiger(entree())).toEqual({
      mentions_figees: true, statut_tva: 'redevable', article_exoneration: null, numero_tva_attribue: false,
      numero_tva_imprime: 'FR11123456782', denomination_imprimee: 'ESSAI DUPONT EI', forme_juridique: '1000', capital: null,
      rcs_ville: null, mentions_identite: 'ESSAI RÉPERTOIRE DES MÉTIERS', parametres_id: 'v2', moyen_prefere: 'virement',
      escompte: 'E2', penalites: 'P2', mentions_complementaires: 'M2', pied_de_page: 'PP2', logo_chemin: V1.logo_chemin,
      logo_sha256: V1.logo_sha256, iban_imprime: 'FR9399999000010000000000100', bic_imprime: 'ESSAFR10', titulaire_imprime: 'T1',
      rib_parametres_id: 'v1', mandataire_nom: null,
    })
  })

  it('le RIB proposé, une fois confirmé, est celui de la facture ; le cabinet qui valide en est le mandataire', () => {
    const confirme = { ...V2, rib_etat: 'confirme' as const, rib_confirme_par: 'c', rib_confirme_le: '2026-10-02T10:00:00Z' }
    const m = mentionsAFiger(entree({ versions: [V1, confirme], mandataire: 'ESSAI CABINET' }))
    expect(m !== 'rompue' && [m.iban_imprime, m.rib_parametres_id, m.mandataire_nom]).toEqual(['FR9299999000010000000000700', 'v2', 'ESSAI CABINET'])
  })

  it('sans paramètres, rien des paramètres ; une franchise sans la case, aucun numéro ; une chaîne rompue ne dit rien', () => {
    const m = mentionsAFiger(entree({ versions: [], dossier: { ...dossier, statut_tva: 'franchise' } }))
    expect(m !== 'rompue' && [m.parametres_id, m.iban_imprime, m.logo_chemin, m.numero_tva_imprime, m.statut_tva])
      .toEqual([null, null, null, null, 'franchise'])
    expect(mentionsAFiger(entree({ versions: [V1, { ...V2, remplace_id: null }] }))).toBe('rompue')
  })

  it('un avoir reprend la TVA et l’identité de sa facture quand elle les a figées ; d’une facture d’avant, celles du jour', () => {
    const origine: MentionsDeLOrigine = {
      mentions_figees: true, statut_tva: 'redevable', article_exoneration: null, numero_tva_attribue: false,
      numero_tva_imprime: 'FR11123456782', denomination_imprimee: 'ESSAI DUPONT EI', forme_juridique: '1000', capital: null,
      rcs_ville: null, mentions_identite: 'ESSAI RÉPERTOIRE DES MÉTIERS',
    }
    const change = { ...dossier, statut_tva: 'franchise' as const, denomination_imprimee: 'ESSAI DURAND EI', mentions_identite: null }
    const avoir = mentionsAFiger(entree({ origine, dossier: change }))
    expect(avoir !== 'rompue' && [avoir.statut_tva, avoir.numero_tva_imprime, avoir.denomination_imprimee, avoir.mentions_identite,
      avoir.parametres_id]).toEqual(['redevable', 'FR11123456782', 'ESSAI DUPONT EI', 'ESSAI RÉPERTOIRE DES MÉTIERS', 'v2'])
    const dAvant = mentionsAFiger(entree({ origine: { mentions_figees: false }, dossier: change }))
    expect(dAvant !== 'rompue' && [dAvant.statut_tva, dAvant.numero_tva_imprime, dAvant.denomination_imprimee])
      .toEqual(['franchise', null, 'ESSAI DURAND EI'])
  })

  it('rend exactement les colonnes que la validation écrit, et la migration les ajoute toutes, le contact en plus', () => {
    const ecrites = entre(FONCTION, "set statut = 'validee', numero = v_numero, validated_at = now(), option_debits = v_option_debits,",
      'where id = v_id;')
    const colonnes = [...ecrites.matchAll(/(\w+) = /g)].map((m) => m[1]).filter((c) => !['statut', 'numero', 'validated_at',
      'option_debits', 'valide_par'].includes(c))
    const m = mentionsAFiger(entree())
    expect(Object.keys(m).sort()).toEqual([...colonnes].sort())
    const ajoutees = [...entre(MIGRATION.texte, 'alter table public.factures_emises\n  add column mentions_figees', ';\n')
      .matchAll(/add column (\w+)/g)].map((x) => x[1])
    expect([...ajoutees].sort()).toEqual([...colonnes, 'contact_id'].sort())
  })
})
