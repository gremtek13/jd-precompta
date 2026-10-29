import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  IBAN_LONGUEUR_MAX, IBAN_LONGUEUR_MIN, MODELE_IBAN_DANS_UN_TEXTE, REFUS_DE_L_IBAN_DES_PARAMETRES, TEXTES_SANS_IBAN, candidatsIban,
  cleIbanValide, porteUnIban, refusDeLEnregistrement, refusEnregistrementParametres,
} from './parametresFacturation'
import { correspondAuModele } from '../test/essaiVentesFacturees'
import { derniereDefinitionSql, fichiersDuSchema } from '../test/schema'

// UN IBAN DANS UN TEXTE LIBRE (A7-Q3, la réponse (B) du cabinet du 28/10/2026), CONFRONTÉ À LA BASE : `porteUnIban` rend,
// cas par cas, ce que `porte_un_iban` (migration `mentions_figees`) a rendu sur les cas de supabase/essais/mentionsFigees.sql
// — même découpage, même clé ; le texte de la fonction porte les bornes et les formes du module ; la petite migration
// `iban_hors_des_parametres` est le texte de l'étape A5c1 au caractère près, hors de ses deux insertions, et son neuvième
// rang dit les refus du module, que son essai (supabase/essais/ibanHorsDesParametres.sql) exige de la base.

const md5 = (texte: string) => createHash('md5').update(texte, 'utf8').digest('hex')
const chaineSql = (s: string) => s.replace(/''/g, "'")
const lire = (chemin: string) => readFileSync(new URL(`../../${chemin}`, import.meta.url), 'utf8')
const entre = (texte: string, debut: string, fin: string) => {
  const i = texte.indexOf(debut)
  const j = i < 0 ? -1 : texte.indexOf(fin, i + debut.length)
  if (i < 0 || j < 0) throw new Error(`Bornes introuvables : « ${debut} » … « ${fin} »`)
  return texte.slice(i, j)
}
const corps = (definition: string) => (/\bas \$\$([\s\S]*)$/.exec(definition) as RegExpExecArray)[1]

const migration = (nom: string) => {
  const fichiers = fichiersDuSchema().filter((f) => new RegExp(`/\\d{14}_${nom}\\.sql$`).test(f.chemin))
  expect(fichiers, nom).toHaveLength(1)
  return fichiers[0]
}
const MENTIONS = migration('mentions_figees')
const IBAN_PARAMETRES = migration('iban_hors_des_parametres')
const LOGO = migration('logo_des_factures')
const FONCTION_IBAN = entre(MENTIONS.texte, 'create function public.porte_un_iban(', '$$;\n')
const MODULE = lire('src/lib/parametresFacturation.ts')

// ── Les cas de l'essai, que la base a jugés ─────────────────────────────────────────────────────────────────────────
// Une expression SQL de l'essai : NULL, ou des chaînes et des `chr(n)` joints par `||`.
function valeurSql(expression: string): string | null {
  const e = expression.trim()
  if (e === 'null') return null
  return [...e.matchAll(/'((?:[^']|'')*)'|chr\((\d+)\)/g)].map((m) => (m[2] ? String.fromCodePoint(Number(m[2])) : chaineSql(m[1]))).join('')
}
const BLOC = entre(lire('supabase/essais/mentionsFigees.sql'), '-- ── DÉBUT DES CAS IBAN ──', '-- ── FIN DES CAS IBAN ──')
const CAS = [...BLOC.matchAll(/^\s*\('(IBAN-\d+)', (.*)\),?$/gm)].map((m) => ({ nom: m[1], texte: valeurSql(m[2]) }))
const ATTENDUS = new Map((/'OK', '((?:IBAN-\d+=\w+ ?)+)'/.exec(BLOC) as RegExpExecArray)[1].split(' ')
  .map((paire) => paire.split('=') as [string, string]))

describe('porteUnIban : le module et la base, cas par cas', () => {
  it('chaque cas de l’essai, jugé par porte_un_iban, est rendu tel quel par le module', () => {
    // Quarante cas, puis quatorze le 29/10/2026 : les bornes des deux formes, leurs groupements et leurs séparateurs, que
    // les mutations de `porte_un_iban` et de `porteUnIban` ont montrés sans juge (IBAN-41 à IBAN-54).
    expect(CAS).toHaveLength(54)
    expect(ATTENDUS.size).toBe(54)
    for (const { nom, texte } of CAS) expect(String(porteUnIban(texte)), nom).toBe(ATTENDUS.get(nom))
    // Le plancher : des IBAN lus ET des textes qui n'en portent pas.
    expect([...ATTENDUS.values()].filter((v) => v === 'true').length).toBeGreaterThanOrEqual(15)
    expect([...ATTENDUS.values()].filter((v) => v === 'false').length).toBeGreaterThanOrEqual(15)
  })

  it('les cas couvrent ce que la consigne nomme : les deux formes, la casse, plusieurs IBAN, une phrase, une clé fausse, un RIB, d’autres pays', () => {
    const verdict = (nom: string) => ATTENDUS.get(nom)
    const texte = (nom: string) => CAS.find((c) => c.nom === nom)?.texte ?? null
    expect([verdict('IBAN-01'), verdict('IBAN-02'), verdict('IBAN-03'), verdict('IBAN-05'), verdict('IBAN-07')]).toEqual(['true', 'true', 'true', 'true', 'true'])
    expect(texte('IBAN-03')).toBe((texte('IBAN-02') as string).toLowerCase())
    // La clé fausse, sous ses deux formes : le même compte, deux chiffres de contrôle d'une unité plus loin.
    expect([verdict('IBAN-08'), verdict('IBAN-09')]).toEqual(['false', 'false'])
    expect(cleIbanValide((texte('IBAN-09') as string))).toBe(false)
    expect(cleIbanValide(`FR93${(texte('IBAN-09') as string).slice(4)}`)).toBe(true)
    // Le RIB à l'ancienne, sa clé RIB juste : ce n'est pas un IBAN.
    expect(verdict('IBAN-14')).toBe('false')
    const [banque, guichet, compte, cleRib] = (texte('IBAN-14') as string).replace('RIB : ', '').split(' ')
    expect(97 - ((89 * Number(banque) + 15 * Number(guichet) + 3 * Number(compte)) % 97)).toBe(Number(cleRib))
    // D'autres pays : chacun lu.
    expect(['IBAN-17', 'IBAN-18', 'IBAN-19', 'IBAN-20', 'IBAN-21', 'IBAN-22', 'IBAN-23', 'IBAN-24', 'IBAN-25'].map(verdict).every((v) => v === 'true')).toBe(true)
    // Les bornes, sous les deux formes : quinze et trente-quatre caractères lus, quatorze et trente-cinq pas — chacun sa clé
    // juste —, au-delà de trente-quatre en groupes non plus ; deux lettres sans deux chiffres, des groupes autres que de
    // quatre, pas davantage ; une lettre accentuée sépare.
    const longueur = (nom: string) => (texte(nom) as string).replace(/ /g, '').length
    expect([longueur('IBAN-42'), longueur('IBAN-43'), longueur('IBAN-44'), longueur('IBAN-45'), longueur('IBAN-52')]).toEqual([34, 35, 14, 14, 15])
    // La clé seule, hors de toute forme (cleIbanValide exige la sienne) : le reste de la division par 97, après rotation.
    const cleJuste = (s: string) => {
      let reste = 0
      for (const c of s.slice(4) + s.slice(0, 4)) for (const d of c <= '9' ? c : String(c.charCodeAt(0) - 55)) reste = (reste * 10 + Number(d)) % 97
      return reste === 1
    }
    for (const nom of ['IBAN-42', 'IBAN-43', 'IBAN-44', 'IBAN-46']) expect(cleJuste(texte(nom) as string), nom).toBe(true)
    expect(['IBAN-41', 'IBAN-42', 'IBAN-52'].map(verdict)).toEqual(['true', 'true', 'true'])
    expect(['IBAN-43', 'IBAN-44', 'IBAN-45', 'IBAN-46', 'IBAN-47', 'IBAN-48', 'IBAN-49', 'IBAN-50', 'IBAN-51'].map(verdict).every((v) => v === 'false')).toBe(true)
    // Seules les vingt-six lettres latines passent en capitales (le i sans point ne devient pas un I) ; deux blancs, dont un
    // insécable, ne séparent pas deux groupes.
    expect([verdict('IBAN-53'), verdict('IBAN-54')]).toEqual(['false', 'false'])
    expect(porteUnIban((texte('IBAN-53') as string).replace(/^./, 'I'))).toBe(true)
    expect(porteUnIban((texte('IBAN-54') as string).replace(/ /g, ''))).toBe(true)
    for (const nom of ['IBAN-47', 'IBAN-48', 'IBAN-49']) expect((texte(nom) as string).replace(/ /g, ''), nom).toBe(texte('IBAN-01'))
    for (const nom of ['IBAN-50', 'IBAN-51']) expect(cleJuste((texte(nom) as string).replace(/ /g, '')), nom).toBe(true)
    // Les IBAN d'essai français portent le code banque 99999.
    for (const { nom, texte: t } of CAS) {
      for (const c of t === null ? [] : candidatsIban(t)) if (cleIbanValide(c) && c.startsWith('FR')) expect(c.slice(4, 9), nom).toBe('99999')
    }
  })

  it('le texte de la fonction porte les bornes, les formes et la clé du module', () => {
    expect([IBAN_LONGUEUR_MIN, IBAN_LONGUEUR_MAX]).toEqual([15, 34])
    expect(FONCTION_IBAN).toContain("if char_length(v_mots[i]) between 15 and 34 and v_mots[i] ~ '^[A-Z]{2}[0-9]{2}' then")
    expect(FONCTION_IBAN).toContain("if v_mots[i] ~ '^[A-Z]{2}[0-9]{2}$' then")
    expect(FONCTION_IBAN).toContain('while j <= array_length(v_mots, 1) and char_length(v_avant[j]) = 1 and strpos(v_blancs, v_avant[j]) > 0\n'
      + '            and char_length(v_mots[j]) <= 4 loop')
    expect(FONCTION_IBAN).toContain('exit when char_length(v_candidat) > 34;')
    expect(FONCTION_IBAN).toContain('if char_length(v_candidat) >= 15 then')
    expect(FONCTION_IBAN).toContain('exit when char_length(v_mots[j]) < 4;')
    expect(FONCTION_IBAN).toContain("v_signes constant text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';")
    expect(FONCTION_IBAN).toContain("translate(p_texte, 'abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ')")
    expect(FONCTION_IBAN).toContain("string_to_array(substr(v_candidat, 5) || left(v_candidat, 4), null)")
    expect(FONCTION_IBAN).toContain('case when ascii(v_car) <= 57 then v_car else (ascii(v_car) - 55)::text end')
    expect(FONCTION_IBAN).toContain('if v_converti::numeric % 97 = 1 then')
    // Le module, les mêmes formes, lues dans sa source.
    for (const ligne of ["const SIGNE_D_IBAN = /^[A-Z0-9]$/", 'const DEBUT_D_IBAN = /^[A-Z]{2}[0-9]{2}/', 'const GROUPE_DE_TETE = /^[A-Z]{2}[0-9]{2}$/',
      'const UN_BLANC = /^\\s$/u', "const capitales = texte.replace(/[a-z]/g, (c) => c.toUpperCase())"]) expect(MODULE, ligne).toContain(ligne)
    // Immuable, ni security definer, son chemin fixé, aucun rôle de l'API ne l'exécute.
    expect(FONCTION_IBAN).toContain('returns boolean\nlanguage plpgsql\nimmutable\nset search_path = public\nas $$')
    expect(MENTIONS.texte).toContain('revoke execute on function public.porte_un_iban(text) from public, anon, authenticated;')
  })
})

describe('candidatsIban : ce que le texte soumet à la clé', () => {
  it('la forme électronique : un mot de quinze à trente-quatre caractères, deux lettres et deux chiffres en tête', () => {
    expect(candidatsIban('IBAN : FR9399999000010000000000100.')).toEqual(['FR9399999000010000000000100'])
    expect(candidatsIban('FR11123456782')).toEqual([])
    expect(candidatsIban(`AB12${'C'.repeat(10)}`)).toEqual([])
    expect(candidatsIban(`AB12${'C'.repeat(11)}`)).toEqual([`AB12${'C'.repeat(11)}`])
    expect(candidatsIban(`AB12${'C'.repeat(30)}`)).toEqual([`AB12${'C'.repeat(30)}`])
    expect(candidatsIban(`AB12${'C'.repeat(31)}`)).toEqual([])
    expect(candidatsIban('IBANFR9399999000010000000000100')).toEqual([])
  })

  it('la forme papier : des groupes de quatre après un seul blanc, candidate à chaque groupe dès quinze caractères', () => {
    expect(candidatsIban('BE60 9990 0000 1234 pour le solde')).toEqual(['BE60999000001234', 'BE60999000001234POUR', 'BE60999000001234POURLE'])
    expect(candidatsIban('fr93 9999 9000 0100 0000 0000 100')).toEqual([
      'FR93999990000100', 'FR939999900001000000', 'FR9399999000010000000000', 'FR9399999000010000000000100'])
    expect(candidatsIban('FR93  9999 9000 0100 0000 0000 100')).toEqual([])
    expect(candidatsIban('FR93-9999-9000-0100-0000-0000-100')).toEqual([])
    expect(candidatsIban(`FR93${String.fromCharCode(160)}9999 9000 0100`)).toEqual(['FR93999990000100'])
    // Au-delà de trente-quatre caractères, la suite s'arrête (IBAN-50) : `cleIbanValide` borne déjà sa forme à trente-quatre,
    // mais la base, qui ne juge que la clé des candidats, a besoin de la borne — le module la tient de même.
    expect(candidatsIban('FR09 9999 9000 0000 0000 0000 0000 0000 0000').map((c) => c.length)).toEqual([16, 20, 24, 28, 32])
    // Un mot de plus de quatre caractères clôt la suite sans y entrer ; un de moins de quatre y entre et la clôt.
    expect(candidatsIban('FR93 9999 9000 0100 00000')).toEqual(['FR93999990000100'])
    expect(candidatsIban('FR93 9999 9000 010 0000')).toEqual(['FR9399999000010'])
    // Chaque mot de deux lettres et deux chiffres en ouvre une : un IBAN précédé d'un tel mot se lit encore.
    expect(candidatsIban('AB12 FR93 9999 9000 0100').filter((c) => c.startsWith('FR'))).toEqual(['FR93999990000100'])
    // Les seules lettres latines passent en capitales ; une lettre accentuée sépare.
    expect(candidatsIban('fr93 9999 9000 0100é')).toEqual(['FR93999990000100'])
  })

  it('aucun texte n’en porte : nul, vide, des blancs', () => {
    expect(porteUnIban(null)).toBe(false)
    expect(porteUnIban(undefined)).toBe(false)
    expect(porteUnIban('')).toBe(false)
    expect(porteUnIban(' \n\t ')).toBe(false)
  })
})

// ── La petite migration ────────────────────────────────────────────────────────────────────────────────────────────
describe('la migration iban_hors_des_parametres', () => {
  const version = (f: { chemin: string }) => (/\/(\d{14})_/.exec(f.chemin) as RegExpExecArray)[1]
  const hier = entre(LOGO.texte, 'create or replace function public.enregistrer_parametres_facturation(', '$$;\n')
  const neuve = entre(IBAN_PARAMETRES.texte, 'create or replace function public.enregistrer_parametres_facturation(', '$$;\n')
  const RANG_9 = entre(neuve, '  -- 9. Un IBAN dans un texte libre', "  -- L'état du RIB (MEG1-Q12, hypothèse)")

  it('après mentions_figees, qu’elle suppose ; la dernière définition de la fonction est la sienne', () => {
    expect(version(IBAN_PARAMETRES) > version(MENTIONS)).toBe(true)
    expect(derniereDefinitionSql('enregistrer_parametres_facturation')).toBe(neuve)
  })

  it('le texte de l’étape A5c1 au caractère près, hors de ses deux insertions : la variable et le neuvième rang', () => {
    expect(neuve.replace('  v_type text;\n  v_libelle text;\nbegin\n', '  v_type text;\nbegin\n').replace(RANG_9, '')).toBe(hier)
    expect(RANG_9.split('\n').length).toBeLessThan(16)
  })

  it('le neuvième rang : les quatre textes, dans l’ordre du quatrième, chacun nommé ; le refus du module', () => {
    const textes = [...RANG_9.matchAll(/\((\d), '((?:[^']|'')*)', (v_\w+)\)/g)].map((m) => [Number(m[1]), chaineSql(m[2]), m[3]])
    expect(textes).toEqual([[1, "les conditions d'escompte", 'v_escompte'], [2, 'les pénalités de retard', 'v_penalites'],
      [3, 'les mentions complémentaires', 'v_mentions'], [4, 'le pied de page', 'v_pied']])
    expect(textes.map(([, libelle]) => libelle)).toEqual(TEXTES_SANS_IBAN.map((t) => t.libelle))
    expect(TEXTES_SANS_IBAN.map((t) => t.champ)).toEqual(['escompte', 'penalites', 'mentions_complementaires', 'pied_de_page'])
    expect(RANG_9).toContain(`raise exception '${MODELE_IBAN_DANS_UN_TEXTE.replace(/'/g, "''")}',\n      v_libelle using errcode = '22023';`)
    expect(REFUS_DE_L_IBAN_DES_PARAMETRES).toEqual([{ cle: 'iban_dans_un_texte', rang: 9, code: '22023', modele: MODELE_IBAN_DANS_UN_TEXTE }])
    expect(refusDeLEnregistrement(true).at(-1)).toEqual(REFUS_DE_L_IBAN_DES_PARAMETRES[0])
  })

  it('sa garde de tête : une seconde application, mentions_figees absente ou porte_un_iban changée, la fonction remplacée changée', () => {
    const garde = entre(IBAN_PARAMETRES.texte, 'do $garde$', '$garde$;')
    expect(garde).toContain("if strpos(coalesce(v_corps, ''), 'porte_un_iban(') > 0 then")
    expect(garde).toContain("if to_regprocedure('public.porte_un_iban(text)') is null then")
    const empreintes = [...garde.matchAll(/'([0-9a-f]{32})'/g)].map((m) => m[1])
    expect(empreintes).toEqual([md5(corps(FONCTION_IBAN)), md5(corps(hier))])
    // L'ordre des refus : la seconde application, l'absence de mentions_figees, porte_un_iban, la fonction remplacée.
    const messages = [...garde.matchAll(/raise exception '((?:[^']|'')*)'/g)].map((m) => chaineSql(m[1]))
    expect(messages.map((m) => m.split(' ')[0] + ' ' + m.split(' ')[1] + ' ' + m.split(' ')[2])).toEqual([
      'La migration iban_hors_des_parametres', 'La migration mentions_figees', 'La fonction porte_un_iban', 'La fonction enregistrer_parametres_facturation'])
  })

  it('elle s’applique par l’outil : aucune suppression, ni table, ni colonne, ni policy ; ses droits, ceux d’hier redits', () => {
    expect(IBAN_PARAMETRES.texte).not.toMatch(/\b(delete|drop|truncate)\b/i)
    expect(IBAN_PARAMETRES.texte).not.toMatch(/\b(create|alter) (table|policy)\b/i)
    expect(IBAN_PARAMETRES.texte).toContain('revoke execute on function public.enregistrer_parametres_facturation(uuid, uuid, jsonb) from public, anon;')
    expect(IBAN_PARAMETRES.texte).toContain('grant execute on function public.enregistrer_parametres_facturation(uuid, uuid, jsonb) to authenticated;')
    expect(IBAN_PARAMETRES.texte).not.toMatch(/\\u|\r/)
  })
})

// ── Le module redit le neuvième rang, et son essai l'exige de la base ──────────────────────────────────────────────
interface Etape { numero: string; genre: string; qui: string; requete: string; code: string; attendu: string | null }
const ESSAI = lire('supabase/essais/ibanHorsDesParametres.sql')
const ETAPES: Etape[] = [...ESSAI.matchAll(
  /\('(\w+)', '(\w+)', '(?:[^']|'')*', '(\w+)',\s*\$q\$([\s\S]*?)\$q\$,\s*'(\w+)',\s*(null|'(?:[^']|'')*'),\s*(?:null|'\w+')\)/g,
)].map((m) => ({ numero: m[1], genre: m[2], qui: m[3], requete: m[4], code: m[5], attendu: m[6] === 'null' ? null : chaineSql(m[6].slice(1, -1)) }))

describe('l’essai ibanHorsDesParametres.sql, rejoué par le module', () => {
  const DP = (/'DP', '([0-9a-f-]{36})'/.exec(ESSAI) as RegExpExecArray)[1]
  // Un motif `like` de l'essai : « % » pour n'importe quoi.
  const commeLike = (motif: string, texte: string) => new RegExp(`^${motif.split('%').map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s\\S]*')}$`).test(texte)

  it('chaque texte se refuse pour le cabinet et pour le client, chacun sous son libellé', () => {
    expect(ETAPES.length).toBeGreaterThan(25)
    for (const qui of ['chef', 'client']) {
      for (const { libelle } of TEXTES_SANS_IBAN) {
        expect(ETAPES.some((e) => e.genre === 'controle' && e.qui === qui && e.code === '22023'
          && e.attendu === `Un IBAN figure dans ${libelle} : sur une facture, un IBAN ne s'imprime que dans le RIB des paramètres de facturation, confirmé par le cabinet.`),
        `${qui} : ${libelle}`).toBe(true)
      }
    }
  })

  it('chaque première version de l’essai : le module rend le refus de la base, ou aucun quand elle accepte', () => {
    const APPEL = new RegExp(`enregistrer_parametres_facturation\\('\\{DP\\}', null,\\s*'((?:[^']|'')*)'::jsonb\\)`)
    let rejoues = 0
    for (const e of ETAPES) {
      const appel = APPEL.exec(e.requete)
      if (!appel) continue
      const saisie = JSON.parse(chaineSql(appel[1]))
      const rendu = refusEnregistrementParametres(DP, null, saisie, [], [])
      rejoues += 1
      if (e.code === 'OK') {
        expect(rendu, `étape ${e.numero}`).toBeNull()
      } else {
        expect(rendu !== null && rendu !== 'rompue' && commeLike(e.attendu as string, rendu.message), `étape ${e.numero}`).toBe(true)
        if (rendu !== null && rendu !== 'rompue' && rendu.cle === 'iban_dans_un_texte') expect(correspondAuModele(MODELE_IBAN_DANS_UN_TEXTE, rendu.message)).toBe(true)
      }
    }
    expect(rejoues).toBeGreaterThanOrEqual(18)
  })

  it('le neuvième rang vient après les refus d’hier, et ne juge que les quatre textes', () => {
    const DOSSIER = '00000000-0000-4000-8000-000000000001'
    const juge = (saisie: unknown) => {
      const r = refusEnregistrementParametres(DOSSIER, null, saisie, [], [])
      return r === null || r === 'rompue' ? r : r.cle
    }
    const IBAN = 'FR1399999000020000000001234'
    expect(juge({ pied_de_page: IBAN })).toBe('iban_dans_un_texte')
    expect(juge({ escompte: 'é'.repeat(301), pied_de_page: IBAN })).toBe('escompte')
    expect(juge({ delai_paiement_jours: 61, pied_de_page: IBAN })).toBe('delai')
    expect(juge({ iban: 'FR00', pied_de_page: IBAN })).toBe('iban_forme')
    expect(juge({ logo_chemin: 'x', pied_de_page: IBAN })).toBe('logo_ensemble')
    expect(juge({ iban: 'FR9399999000010000000000100', titulaire_compte: `ESSAI ${IBAN}` })).toBeNull()
    expect(juge({ pied_de_page: 'FR1499999000020000000001234' })).toBeNull()
  })
})
