import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  ARTICLES_EXPORTES,
  BLANCS,
  BORNE_PRIX_ARTICLE_EUROS,
  DECIMALES_PRIX_ARTICLE,
  DESCRIPTION_MAX,
  DESIGNATION_MAX,
  designationDeLaLigne,
  libelleUnite,
  ligneDepuisArticle,
  NATURES_ARTICLE,
  NOM_DANS_UN_REFUS_MAX,
  nomDansUnRefus,
  PREDICAT_DES_GESTES,
  QUI_TIENT_LE_CATALOGUE,
  REFERENCE_MAX,
  REFUS_ENREGISTREMENT_ARTICLE,
  REFUS_REPRISE_ARTICLE,
  REFUS_RETRAIT_ARTICLE,
  refusEnregistrementArticle,
  refusRepriseArticle,
  refusRetraitArticle,
  sansBlancsAuxBords,
  UNITE_PAR_DEFAUT,
  UNITES_ARTICLE,
  type ArticlePourReference,
  type CibleArticle,
} from './articles'
import { TAUX_ADMIS, UNITE_GENERIQUE } from './factureCii'
import { EXONERATIONS, MENTION_FRANCHISE } from './statutTva'
import type { Article } from './types'
import { derniereDefinitionSql, fichiersDuSchema } from '../test/schema'

// LE MODULE DES ARTICLES, CONFRONTÉ À LA BASE (espace client, étape A1). La migration, appliquée sur l'accord du cabinet,
// est dans l'export (supabase/schema) : ce test confronte le module au texte même de la migration et de ses fonctions. Il
// garde aussi la RÉFÉRENCE d'avant l'application, l'essai `supabase/essais/articles.sql` (HISTORIQUE.md, « LES ARTICLES,
// EN BASE ») : chacun de ses contrôles exige de la base un code ET des mots. Ce test exige que chaque refus du module y
// soit exigé de la fonction qui le lève, et REJOUE dans le module les écritures de l'essai, dans leur ordre, sur l'état
// que ses étapes gardées construisent : le même premier refus, ou aucun.

const ESSAI = readFileSync(new URL('../../supabase/essais/articles.sql', import.meta.url), 'utf8')

interface EtapeDeLEssai {
  num: string
  genre: string
  qui: string
  droits: string | null
  ordre: string
  code: string
  attendu: string | null
}

const sansDoubles = (texte: string) => texte.replace(/''/g, "'")

function etapesDeLEssai(texte: string): EtapeDeLEssai[] {
  const motif = /\('(\w+)', '(jeu|controle|fait|valeur|mutation)', '(?:[^']|'')*', '(\w+)', (null|'\w+'),\s*\$q\$([\s\S]*?)\$q\$,\s*'(\w+)', (null|'((?:[^']|'')*)'), (?:null|'\w+')\)/g
  return [...texte.matchAll(motif)].map((m) => ({
    num: m[1], genre: m[2], qui: m[3], droits: m[4] === 'null' ? null : m[4].slice(1, -1), ordre: m[5], code: m[6],
    attendu: m[8] === undefined ? null : sansDoubles(m[8]),
  }))
}

// Un motif `like` de l'essai, en expression régulière : « % » pour n'importe quoi, « _ » pour un caractère, « \x » pour x.
function likeEnRegex(motif: string): RegExp {
  let source = ''
  for (let i = 0; i < motif.length; i++) {
    const c = motif[i]
    if (c === '\\' && i + 1 < motif.length) source += motif[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    else if (c === '%') source += '[\\s\\S]*'
    else if (c === '_') source += '.'
    else source += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${source}$`)
}

// Un modèle du module, en expression régulière : chaque « % » une valeur, « %% » un signe pour cent.
function modeleEnRegex(modele: string): RegExp {
  const morceaux = modele.split('%%').map((m) => m.split('%').map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s\\S]*'))
  return new RegExp(`^${morceaux.join('%')}$`)
}
// Le texte qu'un motif de l'essai exige, ses jokers laissés tels quels — un « % » échappé redevient un signe pour cent.
const texteDuMotif = (motif: string) => motif.replace(/\\%/g, '%')

const FONCTIONS = ['enregistrer_article', 'retirer_article', 'reprendre_article'] as const
type Fonction = (typeof FONCTIONS)[number]
const fonctionAppelee = (ordre: string): Fonction | null => FONCTIONS.find((f) => ordre.includes(`public.${f}(`)) ?? null

const ETAPES = etapesDeLEssai(ESSAI)
const etape = (num: string) => {
  const e = ETAPES.find((x) => x.num === num)
  if (!e) throw new Error(`étape ${num} introuvable dans articles.sql`)
  return e
}

describe('l’essai, lu', () => {
  it('ses étapes, toutes : deux de jeu, 158 jugées — le cent-cinquante-neuvième verdict est le bilan « rien n’est resté »', () => {
    // Le plancher qui distingue « aucun écart » d'« aveugle » : un motif qui ne reconnaîtrait plus les étapes rendrait une
    // liste vide, et toutes les confrontations ci-dessous passeraient sans rien confronter. Le compte des étapes que le
    // fichier OUVRE (une parenthèse, un numéro, un genre) est celui des étapes que le motif reconnaît en entier.
    const ouvertes = [...ESSAI.matchAll(/^\s*\('\w+', '(?:jeu|controle|fait|valeur|mutation)'/gm)].length
    expect(ETAPES).toHaveLength(ouvertes)
    expect(ETAPES.filter((e) => e.genre === 'jeu')).toHaveLength(2)
    expect(ETAPES.filter((e) => e.genre !== 'jeu')).toHaveLength(158)
    expect(ETAPES.filter((e) => e.genre === 'mutation')).toHaveLength(10)
    expect(new Set(ETAPES.map((e) => e.num)).size).toBe(ETAPES.length)
  })

  it('un motif « like » se lit comme la base le lit, un modèle du module comme remplirModele l’écrit', () => {
    expect(likeEnRegex('Le taux de 19 \\% n').test('Le taux de 19 % n')).toBe(true)
    expect(likeEnRegex('Le taux de 19 \\% n').test('Le taux de 19 x n')).toBe(false)
    expect(likeEnRegex('%articles_unite_check%').test('… « articles_unite_check » …')).toBe(true)
    expect(modeleEnRegex('Le taux de % %% n').test('Le taux de 7,5 % n')).toBe(true)
    expect(modeleEnRegex('Le taux de % %% n').test('Le taux de 7,5 n')).toBe(false)
  })
})

// ── 1. Chaque refus du module est exigé de la base par l'essai, sous ses mots et son code ─────────────────────────────

describe('les refus du module sont ceux que la base rend', () => {
  const listes = [
    ['enregistrer_article', REFUS_ENREGISTREMENT_ARTICLE],
    ['retirer_article', REFUS_RETRAIT_ARTICLE],
    ['reprendre_article', REFUS_REPRISE_ARTICLE],
  ] as const

  for (const [fonction, liste] of listes) {
    it(`${fonction} : chaque refus est exigé par un contrôle de l’essai, sous son code et ses mots`, () => {
      const exiges = ETAPES.filter((e) => e.genre === 'controle' && e.code !== 'OK' && e.attendu != null
        && fonctionAppelee(e.ordre) === fonction)
      for (const r of liste) {
        const temoins = exiges.filter((e) => modeleEnRegex(r.modele).test(texteDuMotif(e.attendu as string)))
        expect(temoins.length, `${fonction} : le refus « ${r.cle} » n'est exigé par aucun contrôle de articles.sql`).toBeGreaterThan(0)
        for (const e of temoins) expect(e.code, `${fonction}, contrôle ${e.num}`).toBe(r.code)
      }
      expect(new Set(liste.map((r) => r.cle)).size).toBe(liste.length)
      // Les rangs se suivent, du premier au dernier, sans en sauter.
      const rangs = [...new Set(liste.map((r) => r.rang))]
      expect(rangs).toEqual(rangs.map((_, i) => i + 1))
    })
  }

  it('neuf rangs pour enregistrer_article, quatorze messages ; l’accès d’abord, partout, avant « introuvable »', () => {
    expect(new Set(REFUS_ENREGISTREMENT_ARTICLE.map((r) => r.rang)).size).toBe(9)
    expect(REFUS_ENREGISTREMENT_ARTICLE).toHaveLength(14)
    for (const [, liste] of listes) expect(liste.slice(0, 2).map((r) => r.cle)).toEqual(['acces', 'introuvable'])
    // Sans droit, un article qui n'existe pas : le refus d'accès.
    for (const num of ['12', '31e']) expect([etape(num).code, etape(num).attendu]).toEqual(['42501', 'Accès refusé à ce dossier.'])
  })

  it('MEG1-Q1, la décision du cabinet : le cabinet et le client « Ventes » tiennent le catalogue — l’accès des trois fonctions est `gere_les_ventes`', () => {
    expect(QUI_TIENT_LE_CATALOGUE).toBe('le cabinet et le client qui porte « Ventes »')
    expect(etape('0d').ordre).toContain(`if not public.${PREDICAT_DES_GESTES}(p_dossier_id) or not exists`)
    // Les deux gestes que l'essai fait réussir : le chef du cabinet et le client qui porte « Ventes », sur le même dossier.
    expect([etape('7').qui, etape('7').code]).toEqual(['chef', 'OK'])
    expect([etape('7b').qui, etape('7b').droits, etape('7b').code]).toEqual(['client', 'ventes', 'OK'])
  })
})

// ── 2. Les écritures de l'essai, rejouées dans le module, sur l'état que ses étapes gardées construisent ─────────────

const DA = 'DA'
const DB = 'DB'

// Un argument JSON d'un appel de l'essai : `null`, un littéral `'…'::jsonb`, ou `jsonb_build_object(…)` dont chaque valeur
// est un texte, un nombre, `null` ou `repeat('…', n)`.
function argumentJson(source: string): unknown {
  const s = source.trim()
  if (s === 'null') return null
  const litteral = /^'((?:[^']|'')*)'::jsonb$/.exec(s)
  if (litteral) return JSON.parse(sansDoubles(litteral[1]))
  const construit = /^jsonb_build_object\(([\s\S]*)\)$/.exec(s)
  if (!construit) throw new Error(`argument JSON illisible : ${s}`)
  const valeurs = [...construit[1].matchAll(/repeat\('((?:[^']|'')*)', (\d+)\)|'((?:[^']|'')*)'|(-?[\d.]+(?:e-?\d+)?)|(null)/g)]
    .map((m) => (m[2] !== undefined ? sansDoubles(m[1]).repeat(Number(m[2])) : m[3] !== undefined ? sansDoubles(m[3])
      : m[4] !== undefined ? Number(m[4]) : null))
  const objet: Record<string, unknown> = {}
  for (let i = 0; i < valeurs.length; i += 2) objet[valeurs[i] as string] = valeurs[i + 1]
  return objet
}

// L'appel qu'une étape fait, lu dans son ordre : la fonction, le dossier, l'article visé, et la saisie.
interface Appel {
  fonction: Fonction
  dossier: string
  article: string | null
  saisie: unknown
}

function appelDe(ordre: string): Appel | null {
  const enregistrer = /public\.enregistrer_article\('\{(\w+)\}', (null|'\{(\w+)\}'), ([\s\S]*)\) a$/.exec(ordre)
  if (enregistrer) {
    return { fonction: 'enregistrer_article', dossier: enregistrer[1], article: enregistrer[3] ?? null, saisie: argumentJson(enregistrer[4]) }
  }
  const autre = /public\.(retirer_article|reprendre_article)\('\{(\w+)\}', '\{(\w+)\}'\) a$/.exec(ordre)
  if (autre) return { fonction: autre[1] as Fonction, dossier: autre[2], article: autre[3], saisie: null }
  return null
}

// Qui a accès, comme la base le juge : le chef (super-administrateur) sur un dossier qui existe, le client qui porte
// « Ventes » sur le dossier A, le membre affecté sur le dossier B. Le module ne juge pas l'accès : ces étapes-là seules
// se rejouent.
const aAcces = (e: EtapeDeLEssai, dossier: string) =>
  (e.qui === 'chef' && (dossier === DA || dossier === DB))
  || (e.qui === 'client' && (e.droits === 'ventes' || e.droits === 'deux') && dossier === DA)
  || (e.qui === 'membre_affecte' && dossier === DB)

interface Rejeu {
  etape: EtapeDeLEssai
  appel: Appel
  refus: { cle: string; message: string } | null
  codeDuModule: string | null
}

// Les étapes, dans leur ordre : chaque appel rejoué contre l'état du moment ; les étapes « fait » acceptées l'écrivent.
function rejouer(): Rejeu[] {
  const etat = new Map<string, ArticlePourReference>()
  const rejeux: Rejeu[] = []
  for (const e of ETAPES) {
    if (!['controle', 'fait', 'mutation'].includes(e.genre)) continue
    const appel = appelDe(e.ordre)
    if (!appel || !aAcces(e, appel.dossier)) continue
    const vise = appel.article == null ? null : etat.get(appel.article) ?? null
    let refus: { cle: string; message: string } | null
    let codeDuModule: string | null = null
    if (appel.fonction === 'enregistrer_article') {
      const cible: CibleArticle = appel.article == null ? { nouveau: true } : { nouveau: false, article: vise }
      refus = refusEnregistrementArticle(appel.dossier, cible, appel.saisie, [...etat.values()])
      codeDuModule = refus ? REFUS_ENREGISTREMENT_ARTICLE.find((r) => r.cle === refus?.cle)?.code ?? null : null
    } else if (appel.fonction === 'retirer_article') {
      refus = refusRetraitArticle(appel.dossier, vise)
      codeDuModule = refus ? REFUS_RETRAIT_ARTICLE.find((r) => r.cle === refus?.cle)?.code ?? null : null
    } else {
      refus = refusRepriseArticle(appel.dossier, vise)
      codeDuModule = refus ? REFUS_REPRISE_ARTICLE.find((r) => r.cle === refus?.cle)?.code ?? null : null
    }
    rejeux.push({ etape: e, appel, refus, codeDuModule })
    // Une étape gardée et acceptée écrit ce que la base a écrit.
    if (e.genre === 'fait' && e.code === 'OK') {
      const saisie = appel.saisie as Record<string, unknown> | null
      if (appel.fonction === 'enregistrer_article' && appel.article == null) {
        const nom = cleDeLEtape(e.num)
        etat.set(nom, { id: nom, dossier_id: appel.dossier, reference: (saisie?.reference as string | undefined) ?? null,
          designation: saisie?.designation as string, retire_le: null })
      } else if (appel.fonction === 'enregistrer_article' && vise) {
        etat.set(vise.id, { ...vise, reference: (saisie?.reference as string | undefined) ?? null, designation: saisie?.designation as string })
      } else if (appel.fonction === 'retirer_article' && vise) {
        etat.set(vise.id, { ...vise, retire_le: '2026-10-13T12:00:00Z' })
      } else if (appel.fonction === 'reprendre_article' && vise) {
        etat.set(vise.id, { ...vise, retire_le: null })
      }
    }
  }
  return rejeux
}

// La clé qu'une étape « fait » garde (la dernière colonne de son tuple) : l'identifiant que les étapes suivantes citent.
function cleDeLEtape(num: string): string {
  const m = new RegExp(`\\('${num}', 'fait',[\\s\\S]*?\\$q\\$,\\s*'\\w+', (?:null|'(?:[^']|'')*'), '(\\w+)'\\)`).exec(ESSAI)
  if (!m) throw new Error(`la clé de l’étape ${num} est introuvable`)
  return m[1]
}

describe('les écritures de l’essai, rejouées dans le module', () => {
  const REJEUX = rejouer()

  it('assez d’écritures pour juger : refus et acceptations, des trois fonctions, de chaque rang', () => {
    expect(REJEUX.length).toBeGreaterThanOrEqual(90)
    expect(REJEUX.filter((r) => r.etape.code === 'OK').length).toBeGreaterThanOrEqual(25)
    for (const f of FONCTIONS) expect(REJEUX.filter((r) => r.appel.fonction === f).length, f).toBeGreaterThanOrEqual(4)
    const rangsRejoues = new Set(REJEUX.filter((r) => r.appel.fonction === 'enregistrer_article')
      .flatMap((r) => (r.refus ? [REFUS_ENREGISTREMENT_ARTICLE.find((x) => x.cle === r.refus?.cle)?.rang] : [])))
    // Le rang 1 (l'accès) se juge en base seulement ; les huit autres sont rejoués.
    expect([...rangsRejoues].sort()).toEqual([2, 3, 4, 5, 6, 7, 8, 9])
  })

  it('chaque écriture : le même premier refus que la base, sous le même code — ou aucun quand elle accepte', () => {
    const ecarts: string[] = []
    for (const { etape: e, refus, codeDuModule } of REJEUX) {
      if (e.code === 'OK') {
        if (refus) ecarts.push(`${e.num} : la base accepte, le module refuse « ${refus.message} »`)
      } else if (!refus) {
        ecarts.push(`${e.num} : la base refuse (${e.code}), le module accepte`)
      } else if (!likeEnRegex(e.attendu as string).test(refus.message) || codeDuModule !== e.code) {
        ecarts.push(`${e.num} : la base « ${e.code} ${e.attendu} », le module « ${codeDuModule} ${refus.message} »`)
      }
    }
    expect(ecarts).toEqual([])
  })
})

// ── 3. Ce que le module lit, comme la base le lit ────────────────────────────────────────────────────────────────────

const article = (o: Partial<ArticlePourReference> & { id: string }): ArticlePourReference => ({
  dossier_id: DA, reference: null, designation: 'Consultation', retire_le: null, ...o,
})
const SAISIE = { designation: 'Essai', prix_unitaire_ht: 10, taux_tva: 20, nature: 'services' }
const neuf: CibleArticle = { nouveau: true }
const refus = (saisie: unknown, articles: readonly ArticlePourReference[] = [], cible: CibleArticle = neuf) =>
  refusEnregistrementArticle(DA, cible, saisie, articles)?.cle ?? null

describe('la saisie, lue comme la base la reçoit', () => {
  it('une saisie juste passe ; l’unité absente ou nulle vaut l’unité générique', () => {
    expect(refus(SAISIE)).toBeNull()
    expect(refus({ ...SAISIE, unite: null })).toBeNull()
    expect(refus({ ...SAISIE, unite: undefined })).toBeNull()
    expect(UNITE_PAR_DEFAUT).toBe(UNITE_GENERIQUE)
  })

  it('l’aller-retour par JSON : NaN et l’infini deviennent nuls, une clé indéfinie ou une fonction disparaît', () => {
    expect(refus({ ...SAISIE, prix_unitaire_ht: Number.NaN })).toBe('prix_absent')
    expect(refus({ ...SAISIE, taux_tva: Number.POSITIVE_INFINITY })).toBe('taux_absent')
    expect(refus({ ...SAISIE, description: () => 'x' })).toBeNull()
    expect(refus({ ...SAISIE, reference: undefined })).toBeNull()
    expect(refus(undefined)).toBe('designation_absente')
    expect(refus(null)).toBe('designation_absente')
    expect(refus(['Essai', 10, 20, 'services'])).toBe('designation_absente')
    // Une clé héritée n'est pas envoyée.
    expect(refus(Object.create({ designation: 'Essai', prix_unitaire_ht: 10, taux_tva: 20, nature: 'services' }))).toBe('designation_absente')
  })

  it('les caractères se comptent par point de code, comme `char_length` : un emoji vaut un', () => {
    const emoji = String.fromCodePoint(0x1f600)
    expect(emoji.length).toBe(2)
    expect(refus({ ...SAISIE, designation: emoji.repeat(DESIGNATION_MAX) })).toBeNull()
    expect(refus({ ...SAISIE, designation: emoji.repeat(DESIGNATION_MAX + 1) })).toBe('designation_longue')
    expect(refus({ ...SAISIE, description: emoji.repeat(DESCRIPTION_MAX) })).toBeNull()
    expect(refus({ ...SAISIE, description: emoji.repeat(DESCRIPTION_MAX + 1) })).toBe('description_invalide')
    expect(refus({ ...SAISIE, reference: emoji.repeat(REFERENCE_MAX) })).toBeNull()
    expect(refus({ ...SAISIE, reference: emoji.repeat(REFERENCE_MAX + 1) })).toBe('reference_invalide')
  })

  it('les blancs des bords sont les quatre de la base : une espace insécable n’en est pas un', () => {
    expect(BLANCS).toBe(' \t\n\r')
    const insecable = String.fromCharCode(0xa0)
    expect(sansBlancsAuxBords(` \t\n\rR 1\r\n\t `)).toBe('R 1')
    expect(sansBlancsAuxBords(`${insecable}R${insecable}`)).toBe(`${insecable}R${insecable}`)
    expect(refus({ ...SAISIE, reference: `${insecable}R` })).toBeNull()
    expect(refus({ ...SAISIE, designation: insecable })).toBeNull()
    for (const blanc of [' ', '\t', '\n', '\r']) {
      expect(refus({ ...SAISIE, reference: `R${blanc}` }), JSON.stringify(blanc)).toBe('reference_invalide')
      expect(refus({ ...SAISIE, reference: `${blanc}R` }), JSON.stringify(blanc)).toBe('reference_invalide')
      expect(refus({ ...SAISIE, designation: blanc.repeat(3) }), JSON.stringify(blanc)).toBe('designation_absente')
    }
  })

  it('le prix : six décimales, positif ou nul, sous la borne — le nombre tel que la base le lit, exposant compris', () => {
    expect(refus({ ...SAISIE, prix_unitaire_ht: 0 })).toBeNull()
    expect(refus({ ...SAISIE, prix_unitaire_ht: -0 })).toBeNull()
    expect(refus({ ...SAISIE, prix_unitaire_ht: 0.000001 })).toBeNull()
    expect(refus({ ...SAISIE, prix_unitaire_ht: 1e-7 })).toBe('prix_hors_bornes')
    expect(refus({ ...SAISIE, prix_unitaire_ht: 12.345678 })).toBeNull()
    expect(refus({ ...SAISIE, prix_unitaire_ht: 12.3456789 })).toBe('prix_hors_bornes')
    expect(refus({ ...SAISIE, prix_unitaire_ht: -0.01 })).toBe('prix_hors_bornes')
    expect(refus({ ...SAISIE, prix_unitaire_ht: BORNE_PRIX_ARTICLE_EUROS - 1 })).toBeNull()
    expect(refus({ ...SAISIE, prix_unitaire_ht: BORNE_PRIX_ARTICLE_EUROS })).toBe('prix_hors_bornes')
    expect(refus({ ...SAISIE, prix_unitaire_ht: 1e21 })).toBe('prix_hors_bornes')
    expect(refus({ ...SAISIE, prix_unitaire_ht: '10' })).toBe('prix_absent')
    expect(DECIMALES_PRIX_ARTICLE).toBe(6)
  })

  it('le taux : un de ceux de la DGFiP, dit comme la base l’écrit', () => {
    for (const taux of TAUX_ADMIS) expect(refus({ ...SAISIE, taux_tva: taux }), String(taux)).toBeNull()
    expect(refusEnregistrementArticle(DA, neuf, { ...SAISIE, taux_tva: 0.5 }, [])?.message).toBe("Le taux de 0,5 % n'est pas un taux de TVA admis.")
    expect(refusEnregistrementArticle(DA, neuf, { ...SAISIE, taux_tva: 1e-7 }, [])?.message)
      .toBe("Le taux de 0,0000001 % n'est pas un taux de TVA admis.")
    expect(refus({ ...SAISIE, taux_tva: '20' })).toBe('taux_absent')
  })

  it('l’unité et la nature : de leurs listes, à la casse près', () => {
    for (const { code } of UNITES_ARTICLE) expect(refus({ ...SAISIE, unite: code }), code).toBeNull()
    for (const unite of ['c62', 'XYZ', '', 62]) expect(refus({ ...SAISIE, unite }), String(unite)).toBe('unite_inconnue')
    for (const nature of NATURES_ARTICLE) expect(refus({ ...SAISIE, nature })).toBeNull()
    for (const nature of ['Biens', 'mixte', '', 1, null, undefined]) expect(refus({ ...SAISIE, nature }), String(nature)).toBe('nature_inconnue')
    expect(libelleUnite('HUR')).toBe('heure')
    expect(libelleUnite('LS')).toBe('forfait')
    expect(libelleUnite('ZZZ')).toBe('ZZZ')
    expect(new Set(UNITES_ARTICLE.map((u) => u.code)).size).toBe(UNITES_ARTICLE.length)
  })
})

describe('la référence : sa forme, puis son unicité dans le dossier', () => {
  const R1 = article({ id: 'a1', reference: 'R1' })

  it('prise par un autre article du dossier : il est nommé — dit retiré s’il l’est', () => {
    expect(refusEnregistrementArticle(DA, neuf, { ...SAISIE, reference: 'R1' }, [R1])?.message)
      .toBe("La référence « R1 » est déjà celle de l'article « Consultation » : une référence ne sert qu'une fois par dossier.")
    expect(refusEnregistrementArticle(DA, neuf, { ...SAISIE, reference: 'R1' }, [{ ...R1, retire_le: '2026-10-01T08:00:00Z' }])?.message)
      .toBe("La référence « R1 » est déjà celle de l'article « Consultation » (retiré) : une référence ne sert qu'une fois par dossier.")
  })

  it('libre : dans un autre dossier, à la casse près, ou la sienne propre ; deux articles sans référence ne se heurtent pas', () => {
    expect(refus({ ...SAISIE, reference: 'R1' }, [{ ...R1, dossier_id: DB }])).toBeNull()
    expect(refus({ ...SAISIE, reference: 'r1' }, [R1])).toBeNull()
    expect(refus({ ...SAISIE, reference: 'R1' }, [R1], { nouveau: false, article: { id: 'a1', dossier_id: DA, retire_le: null } })).toBeNull()
    expect(refus({ ...SAISIE, reference: null }, [article({ id: 'a2' }), article({ id: 'a3' })])).toBeNull()
  })

  it('la forme d’abord : une référence mal formée ne se cherche pas', () => {
    expect(refus({ ...SAISIE, reference: '' }, [article({ id: 'a2', reference: '' })])).toBe('reference_invalide')
    expect(refus({ ...SAISIE, reference: 7 })).toBe('reference_invalide')
  })

  it('un article nommé l’est par ses soixante-dix-neuf premiers caractères au-delà de quatre-vingts, comptés par point de code', () => {
    expect(NOM_DANS_UN_REFUS_MAX).toBe(80)
    expect(nomDansUnRefus('a'.repeat(80))).toBe('a'.repeat(80))
    expect(nomDansUnRefus('a'.repeat(81))).toBe(`${'a'.repeat(79)}…`)
    const emoji = String.fromCodePoint(0x1f600)
    expect(nomDansUnRefus(emoji.repeat(80))).toBe(emoji.repeat(80))
    expect(nomDansUnRefus(emoji.repeat(81))).toBe(`${emoji.repeat(79)}…`)
  })
})

describe('l’article visé : introuvable, d’un autre dossier, retiré — avant tout le reste', () => {
  it('enregistrer_article', () => {
    const vise = { id: 'a1', dossier_id: DA, retire_le: null }
    expect(refus({}, [], { nouveau: false, article: null })).toBe('introuvable')
    expect(refus({}, [], { nouveau: false, article: { ...vise, dossier_id: DB } })).toBe('introuvable')
    expect(refus({}, [], { nouveau: false, article: { ...vise, retire_le: '2026-10-01T08:00:00Z' } })).toBe('retire')
    expect(refus(SAISIE, [], { nouveau: false, article: vise })).toBeNull()
  })

  it('retirer_article et reprendre_article', () => {
    const actif = { dossier_id: DA, retire_le: null }
    const retire = { dossier_id: DA, retire_le: '2026-10-01T08:00:00Z' }
    expect(refusRetraitArticle(DA, null)?.cle).toBe('introuvable')
    expect(refusRetraitArticle(DB, actif)?.cle).toBe('introuvable')
    expect(refusRetraitArticle(DA, retire)?.message).toBe('Cet article est déjà retiré.')
    expect(refusRetraitArticle(DA, actif)).toBeNull()
    expect(refusRepriseArticle(DA, null)?.cle).toBe('introuvable')
    expect(refusRepriseArticle(DB, retire)?.cle).toBe('introuvable')
    expect(refusRepriseArticle(DA, actif)?.message).toBe("Cet article n'est pas retiré.")
    expect(refusRepriseArticle(DA, retire)).toBeNull()
  })
})

// ── 4. La ligne qu'un article pré-remplit ────────────────────────────────────────────────────────────────────────────

describe('la ligne qu’un article pré-remplit', () => {
  const consultation: Pick<Article, 'designation' | 'description' | 'prix_unitaire_ht' | 'taux_tva'> = {
    designation: 'Consultation', description: null, prix_unitaire_ht: 60, taux_tva: 20,
  }
  const soins = EXONERATIONS[0]

  it('redevable : le taux de l’article, aucune mention sur une ligne taxée', () => {
    expect(ligneDepuisArticle(consultation, 'redevable', null)).toEqual({
      ligne: { designation: 'Consultation', quantite: 1, prix_unitaire_ht: 60, taux_tva: 20 }, mention: null, avertissement: null,
    })
  })

  it('redevable, un article à 0 % : la mention de son exonération — ou ce qui manque pour la dire', () => {
    const exonere = { ...consultation, taux_tva: 0 }
    expect(ligneDepuisArticle(exonere, 'redevable', soins.code)).toEqual({
      ligne: { designation: 'Consultation', quantite: 1, prix_unitaire_ht: 60, taux_tva: 0 }, mention: soins.mention, avertissement: null,
    })
    const sansArticle = ligneDepuisArticle(exonere, 'redevable', null)
    expect(sansArticle.mention).toBeNull()
    expect(sansArticle.avertissement).toMatch(/^Une ligne à 0 % d’un dossier redevable demande l’article de son exonération/)
  })

  it('franchise : 0 %, quel que soit le taux de l’article, et la mention de l’art. 293 B', () => {
    expect(ligneDepuisArticle(consultation, 'franchise', null)).toEqual({
      ligne: { designation: 'Consultation', quantite: 1, prix_unitaire_ht: 60, taux_tva: 0 }, mention: MENTION_FRANCHISE, avertissement: null,
    })
  })

  it('exonéré : 0 % et la mention de son article ; sans article, ce qui manque', () => {
    expect(ligneDepuisArticle(consultation, 'exonere', soins.code)).toEqual({
      ligne: { designation: 'Consultation', quantite: 1, prix_unitaire_ht: 60, taux_tva: 0 }, mention: soins.mention, avertissement: null,
    })
    const sansArticle = ligneDepuisArticle(consultation, 'exonere', null)
    expect(sansArticle.ligne.taux_tva).toBe(0)
    expect(sansArticle.mention).toBeNull()
    expect(sansArticle.avertissement).toMatch(/^Le dossier est exonéré sans article d’exonération/)
  })

  it('statut à préciser : 0 %, comme une ligne saisie aujourd’hui, et le statut à préciser dit', () => {
    const ligne = ligneDepuisArticle(consultation, null, null)
    expect(ligne.ligne.taux_tva).toBe(0)
    expect(ligne.mention).toBeNull()
    expect(ligne.avertissement).toMatch(/^Le statut de TVA du dossier est à préciser/)
  })

  it('la désignation porte la description à sa suite, sur une seule ligne', () => {
    expect(designationDeLaLigne({ designation: 'Consultation', description: 'Une heure de conseil' })).toBe('Consultation — Une heure de conseil')
    expect(designationDeLaLigne({ designation: 'Consultation', description: 'Une heure\r\nde conseil\n' })).toBe('Consultation — Une heure de conseil')
    expect(designationDeLaLigne({ designation: 'Consultation\nlongue', description: '  ' })).toBe('Consultation longue')
    expect(designationDeLaLigne({ designation: 'Consultation', description: null })).toBe('Consultation')
    expect(ligneDepuisArticle({ ...consultation, description: 'Une heure' }, 'redevable', null).ligne.designation)
      .toBe('Consultation — Une heure')
  })

  it('la ligne garde le prix de l’article et une quantité de un ; la changer ne change pas l’article', () => {
    const source = { ...consultation }
    const { ligne } = ligneDepuisArticle(source, 'redevable', null)
    ligne.prix_unitaire_ht = 99
    expect(source.prix_unitaire_ht).toBe(60)
    expect(ligne.quantite).toBe(1)
  })
})

// ── 5. Le jour où l'export porte la migration ───────────────────────────────────────────────────────────────────────

const messagesSql = (sql: string) => [...sql.matchAll(/raise exception '((?:[^']|'')*)'/g)].map((m) => sansDoubles(m[1]))
const codesSql = (sql: string) => [...sql.matchAll(/raise exception '(?:[^']|'')*'[^;]*?using errcode = '(\w+)'/g)].map((m) => m[1])

describe('ARTICLES_EXPORTES dit ce que porte l’export', () => {
  const portee = fichiersDuSchema().some((f) => /create table public\.articles \(/.test(f.texte))

  it('le drapeau, et la migration avec lui', () => {
    expect(portee, 'ARTICLES_EXPORTES ne dit plus ce que porte l’export').toBe(ARTICLES_EXPORTES)
  })

  // La migration elle-même, dès qu'elle est dans l'export : UN fichier, à la version que l'historique lui a donnée.
  const migration = () => {
    const schema = new URL('../../supabase/schema/', import.meta.url)
    const noms = readdirSync(schema).filter((nom) => /^\d{14}_articles\.sql$/.test(nom))
    expect(noms, 'la migration articles doit être UNE dans l’export').toHaveLength(1)
    return readFileSync(new URL(noms[0], schema), 'utf8')
  }

  it('exportée, les fonctions disent les refus du module, dans le même ordre et sous les mêmes codes', () => {
    if (!ARTICLES_EXPORTES) return
    const enregistrer = derniereDefinitionSql('enregistrer_article')
    const messages = messagesSql(enregistrer)
    // Le refus de l'unicité se redit à la fin, pour l'écriture concurrente qui prend la même référence (23505).
    expect(messages.slice(0, -1)).toEqual(REFUS_ENREGISTREMENT_ARTICLE.map((r) => r.modele))
    expect(messages.at(-1)).toBe(REFUS_ENREGISTREMENT_ARTICLE.find((r) => r.cle === 'reference_prise')?.modele)
    expect(codesSql(enregistrer).slice(0, -1)).toEqual(REFUS_ENREGISTREMENT_ARTICLE.map((r) => r.code))
    for (const [fonction, liste] of [['retirer_article', REFUS_RETRAIT_ARTICLE], ['reprendre_article', REFUS_REPRISE_ARTICLE]] as const) {
      expect(messagesSql(derniereDefinitionSql(fonction)), fonction).toEqual(liste.map((r) => r.modele))
      expect(codesSql(derniereDefinitionSql(fonction)), fonction).toEqual(liste.map((r) => r.code))
    }
  })

  it('exportée, ses valeurs sont celles du module : unités, taux, natures, bornes, blancs', () => {
    if (!ARTICLES_EXPORTES) return
    const texte = migration()
    const liste = (motif: RegExp) => [...(motif.exec(texte)?.[1] ?? '').matchAll(/'(\w+)'/g)].map((m) => m[1])
    expect(liste(/constraint articles_unite_check\s+check \(unite in \(([^)]*)\)\)/)).toEqual(UNITES_ARTICLE.map((u) => u.code))
    expect(texte).toContain("unite text not null default 'C62'")
    expect(liste(/constraint articles_nature_check check \(nature in \(([^)]*)\)\)/)).toEqual([...NATURES_ARTICLE])
    const taux = /constraint articles_taux_check\s+check \(taux_tva in \(([^)]*)\)\)/.exec(texte)?.[1].split(',').map(Number)
    expect(taux).toEqual([...TAUX_ADMIS])
    expect(texte).toContain(`check (prix_unitaire_ht >= 0 and prix_unitaire_ht = round(prix_unitaire_ht, ${DECIMALES_PRIX_ARTICLE}) and prix_unitaire_ht < ${BORNE_PRIX_ARTICLE_EUROS})`)
    expect(texte).toContain(`check (char_length(reference) between 1 and ${REFERENCE_MAX} and btrim(reference, E' \\t\\n\\r') = reference)`)
    expect(texte).toContain(`check (btrim(designation, E' \\t\\n\\r') <> '' and char_length(designation) <= ${DESIGNATION_MAX})`)
    expect(texte).toContain(`check (char_length(description) <= ${DESCRIPTION_MAX})`)
    expect(texte).toContain('constraint articles_reference_unique unique (dossier_id, reference)')
    const enregistrer = derniereDefinitionSql('enregistrer_article')
    // Le nom de l'article qui porte la référence, coupé comme le module le coupe — au refus du rang 5, et redit à
    // l'écriture concurrente (23505) : les deux fois.
    const coupe = `case when char_length(v_autre.designation) > ${NOM_DANS_UN_REFUS_MAX} then left(v_autre.designation, ${NOM_DANS_UN_REFUS_MAX - 1}) || '…'`
    expect(enregistrer.split(coupe).length - 1).toBe(2)
    // La même liste d'unités, et le même blanc, dans la fonction que dans la table.
    expect(enregistrer).toContain(`not in (${UNITES_ARTICLE.map((u) => `'${u.code}'`).join(', ')})`)
    // Deux usages des blancs dans la fonction : la désignation vide, puis la référence aux bords — comme le module.
    expect(enregistrer.split("E' \\t\\n\\r'").length - 1).toBe(2)
    expect([...enregistrer.matchAll(/btrim\(p_article->>'(\w+)', E' \\t\\n\\r'\)/g)].map((m) => m[1])).toEqual(['designation', 'reference'])
    expect(enregistrer).toContain(`v_taux not in (${TAUX_ADMIS.join(', ')})`)
  })

  it('exportée, qui lit et qui écrit : trois policies aux connectés, aucune écriture directe hors de la restauration ; MEG1-Q1', () => {
    if (!ARTICLES_EXPORTES) return
    const texte = migration()
    const policies = [...texte.matchAll(/create policy (\w+) on public\.articles\s+for (\w+) to (\w+) (using|with check) \(([^;]*)\);/g)]
      .map((m) => `${m[1]} ${m[2]} ${m[3]} ${m[4]} ${m[5]}`)
    expect(policies).toEqual([
      'articles_lecture select authenticated using public.admin_du_dossier(dossier_id)',
      "articles_lecture_ventes select authenticated using public.client_du_dossier(dossier_id, 'ventes')",
      'articles_restauration insert authenticated with check public.is_super_admin()',
    ])
    expect([...texte.matchAll(/create policy/g)]).toHaveLength(3)
    for (const fonction of ['enregistrer_article(uuid, uuid, jsonb)', 'retirer_article(uuid, uuid)', 'reprendre_article(uuid, uuid)']) {
      expect(texte).toContain(`revoke execute on function public.${fonction} from public, anon;`)
      expect(texte).toContain(`grant execute on function public.${fonction} to authenticated;`)
    }
    // MEG1-Q1, décidée par le cabinet : l'accès des trois gestes est celui des ventes, avant toute autre chose.
    for (const fonction of ['enregistrer_article', 'retirer_article', 'reprendre_article']) {
      expect(derniereDefinitionSql(fonction), fonction)
        .toMatch(new RegExp(`\\$\\$\\ndeclare[\\s\\S]*?\\nbegin\\n  if not public\\.${PREDICAT_DES_GESTES}\\(p_dossier_id\\) or not exists`))
    }
    // Rien n'y retire quoi que ce soit : `apply_migration` la prend sans demander de confirmation.
    const instructions = texte.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n')
    expect(instructions.replace(/on delete cascade/g, '')).not.toMatch(/\b(delete|drop|truncate)\b/i)
  })
})
