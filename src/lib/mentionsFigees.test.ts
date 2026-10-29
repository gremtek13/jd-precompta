import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { NATURES_ARTICLE, UNITES_ARTICLE } from './articles'
import { numeroTvaImprime } from './factureCii'
import {
  MENTIONS_FIGEES_EXPORTEES, NATURES_DE_LIGNE, REFERENCE_DE_LIGNE_MAX, REFUS_DE_LA_PROVENANCE, REFUS_DE_LA_VALIDATION_FIGEE,
  REFUS_DES_TEXTES, TEXTES_DE_LA_LIGNE, TEXTES_DE_L_EN_TETE, TEXTES_FIGES_A_LA_VALIDATION, UNITES_DE_LIGNE, adresseNette,
  denominationAbsente, mentionsAFiger, porteLaMentionEI, refusDeLaProvenance, refusDeLaValidationFigee, refusDesTextesDeLaFacture,
  siretSansBlancs,
  type EntreeDesMentions, type MentionsDeLOrigine, type ValidationAJuger, type VersionAFiger,
} from './mentionsFigees'
import { MODELE_IBAN_DANS_UN_TEXTE } from './parametresFacturation'
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
// Le dernier refus de la validation, un IBAN dans ce qu'elle figerait (A7-Q3) : lu par sa place, que le test des rangs
// garde (depuis A7Q-Q1, le neuvième).
const IBAN_A_LA_VALIDATION = REFUS_DE_LA_VALIDATION_FIGEE[REFUS_DE_LA_VALIDATION_FIGEE.length - 1]

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
// Reprise sur A7-Q2 et A7-Q3 (29/10/2026) : la validation va jusqu'au mandataire, ses refus d'un IBAN compris ; les textes
// écrits se jugent entre l'écriture des lignes et la validation.
const VALIDATION = () => entre(FONCTION, '-- A7. CE QUE LA VALIDATION FIGE', '    -- Le mandataire :')
const TEXTES = () => entre(FONCTION, '-- A7-Q3. UN IBAN DANS UN TEXTE LIBRE', '  if p_valider then')

// ── Le drapeau, la migration, sa garde de tête ─────────────────────────────────────────────────────────────────────
describe('le drapeau et la migration', () => {
  it('le drapeau est levé : la migration est en base depuis le 29/10/2026, sous sa version, et son commentaire le dit', () => {
    // Levé, l'étape A7b envoie les clés neuves et lit les colonnes figées, que la base porte désormais.
    expect(MENTIONS_FIGEES_EXPORTEES).toBe(true)
    const commentaire = entre(MODULE, '// LA MIGRATION EST EN BASE depuis le 29/10/2026', 'export const MENTIONS_FIGEES_EXPORTEES')
    expect(commentaire).toContain('`mentions_figees`, collée par le cabinet (version 20261029214359)')
    expect(MIGRATION.chemin).toMatch(/\/20261029214359_mentions_figees\.sql$/)
  })

  it('la migration est dans l’export, une fois, et seule à définir les trois fonctions neuves', () => {
    expect(MIGRATIONS).toHaveLength(1)
    for (const nom of ['numero_tva_du_vendeur', 'porte_la_mention_ei', 'porte_un_iban']) {
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
  // Repris le 29/10/2026 sur A7Q-Q1 : la dénomination du dossier, au huitième rang, après l'entrepreneur individuel.
  const VALID = ['contact_garde', 'forme_a_regler', 'entrepreneur_individuel', 'denomination_a_poser', 'siret_a_poser',
    'siret_du_dossier', 'adresse_a_poser', 'adresse_du_dossier', 'iban_a_la_validation'] as const

  it('ceux d’hier d’abord, dans le même ordre et sous les mêmes mots, puis la provenance, les textes, la validation', () => {
    const hier = definitionDAvant('enregistrer_facture').texte
    expect(messagesSql(FONCTION)).toEqual([
      ...messagesSql(hier),
      ...REFUS_DE_LA_PROVENANCE.map((r) => r.modele),
      ...REFUS_DES_TEXTES.map((r) => r.modele),
      ...REFUS_DE_LA_VALIDATION_FIGEE.map((r) => r.modele),
    ])
    expect(codesSql(FONCTION)).toEqual([
      ...codesSql(hier), ...REFUS_DE_LA_PROVENANCE.map((r) => r.code), ...REFUS_DES_TEXTES.map((r) => r.code),
      ...REFUS_DE_LA_VALIDATION_FIGEE.map((r) => r.code),
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

  it('la validation : le contact gardé, la forme, l’entrepreneur individuel, l’émetteur du dossier, un IBAN, avant la numérotation', () => {
    expect(REFUS_DE_LA_VALIDATION_FIGEE.map((r) => r.cle)).toEqual([...VALID])
    expect(messagesSql(VALIDATION())).toEqual(REFUS_DE_LA_VALIDATION_FIGEE.map((r) => r.modele))
    expect(codesSql(VALIDATION())).toEqual(REFUS_DE_LA_VALIDATION_FIGEE.map((r) => r.code))
    expect(valeursSql(VALIDATION())).toEqual(['', '', '', '', '', '', '', '', 'v_libelle'])
    expect(REFUS_DE_LA_VALIDATION_FIGEE.map((r) => r.rang)).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 13])
    expect(FONCTION.indexOf('-- A7. CE QUE LA VALIDATION FIGE')).toBeLessThan(FONCTION.indexOf('v_numero := attribuer_numero_facture('))
    expect(FONCTION.indexOf('    -- Le mandataire :')).toBeLessThan(FONCTION.indexOf('v_numero := attribuer_numero_facture('))
    // Les conditions que le module rejoue, telles que la fonction les écrit : la forme jugée pour un accès « Ventes » seul,
    // hors d'un avoir qui reprend l'identité de sa facture ; le mandataire, le cabinet seul.
    expect(VALIDATION()).toContain('v_cabinet := public.admin_du_dossier(p_dossier_id);\n'
      + "    if v_forme_juridique is null and not v_cabinet and not (v_type = 'avoir' and v_origine.mentions_figees) then")
    expect(VALIDATION()).toContain("if v_forme_juridique = '1000' and not public.porte_la_mention_ei(v_denomination) then")
    // A7Q-Q1 : la dénomination que la facture figera, absente ou de blancs (`denominationAbsente`), pour un accès
    // « Ventes », hors d'un avoir qui reprend l'identité de sa facture — la condition même de la forme ; après
    // l'entrepreneur individuel, avant l'émetteur (l'ordre des messages, ci-dessus).
    expect(VALIDATION()).toContain("    if btrim(coalesce(v_denomination, ''), v_blancs) = '' and not v_cabinet\n"
      + "       and not (v_type = 'avoir' and v_origine.mentions_figees) then")
    expect(VALIDATION().indexOf("public.porte_la_mention_ei(v_denomination)"))
      .toBeLessThan(VALIDATION().indexOf("btrim(coalesce(v_denomination, ''), v_blancs)"))
    expect(VALIDATION().indexOf("btrim(coalesce(v_denomination, ''), v_blancs)"))
      .toBeLessThan(VALIDATION().indexOf("    if not v_cabinet and v_type <> 'avoir' then"))
    // La valeur jugée est celle que la validation écrit : lue une fois dans le dossier (ou reprise de la facture d'un
    // avoir).
    expect(VALIDATION()).toContain('      v_denomination := v_dossier.denomination_imprimee;')
    expect(FONCTION).toContain('        denomination_imprimee = v_denomination, forme_juridique = v_forme_juridique, capital = v_capital,')
    expect(FONCTION).toContain('    if v_cabinet then\n      select c.nom into v_mandataire from cabinets c where c.id = v_dossier.cabinet_id;')
    // A7-Q2 : un accès « Ventes » et une facture seulement ; le SIRET, ses blancs retirés partout ; l'adresse, ses fins de ligne
    // ramenées et les blancs de ses bords retirés — `siretSansBlancs` et `adresseNette`, que les cas ci-dessous jugent.
    expect(VALIDATION()).toContain("    if not v_cabinet and v_type <> 'avoir' then\n"
      + "      if translate(coalesce(v_dossier.siret, ''), v_blancs, '') = '' then")
    expect(VALIDATION()).toContain("      if translate(coalesce(v_emetteur_siret, ''), v_blancs, '') <> translate(v_dossier.siret, v_blancs, '') then")
    expect(VALIDATION()).toContain("      if btrim(coalesce(v_dossier.adresse, ''), v_blancs) = '' then")
    expect(VALIDATION()).toContain("      if btrim(replace(replace(coalesce(v_emetteur_adresse, ''), E'\\r\\n', E'\\n'), E'\\r', E'\\n'), v_blancs)\n"
      + "         <> btrim(replace(replace(v_dossier.adresse, E'\\r\\n', E'\\n'), E'\\r', E'\\n'), v_blancs) then")
    expect(FONCTION).toContain('    select f.contact_id, f.emetteur_siret, f.emetteur_adresse into v_contact, v_emetteur_siret, v_emetteur_adresse\n'
      + '      from factures_emises f where f.id = v_id;')
    // A7-Q3 à la validation : l'identité, sauf celle qu'un avoir reprend, puis les textes de la version courante, dans l'ordre
    // du module ; un libellé par texte.
    const figes = [...VALIDATION().matchAll(/\((\d), '((?:[^']|'')*)', (v_\w+(?:\.\w+)?)\)/g)].map((m) => [Number(m[1]), chaineSql(m[2]), m[3]])
    expect(figes).toEqual([[1, 'la dénomination du dossier', 'v_denomination'], [2, 'la ville du greffe du dossier', 'v_rcs_ville'],
      [3, "les autres mentions de l'identité du dossier", 'v_mentions_identite'],
      [4, "les conditions d'escompte des paramètres de facturation", 'v_courante.escompte'],
      [5, 'les pénalités de retard des paramètres de facturation', 'v_courante.penalites'],
      [6, 'les mentions complémentaires des paramètres de facturation', 'v_courante.mentions_complementaires'],
      [7, 'le pied de page des paramètres de facturation', 'v_courante.pied_de_page']])
    expect(figes.map(([rang, libelle]) => ({ rang, libelle }))).toEqual(TEXTES_FIGES_A_LA_VALIDATION.map((t) => ({ ...t })))
    expect(VALIDATION()).toContain("       and (x.rang > 3 or not (v_type = 'avoir' and coalesce(v_origine.mentions_figees, false)))")
    // Le refus du contact gardé est, mot pour mot, celui de la provenance : l'écran le dit d'une seule phrase ; celui d'un IBAN
    // est celui des textes, et celui des paramètres de facturation.
    expect(REFUS_DE_LA_VALIDATION_FIGEE[0].modele).toBe(REFUS_DE_LA_PROVENANCE[3].modele)
    expect(IBAN_A_LA_VALIDATION.cle).toBe('iban_a_la_validation')
    expect(IBAN_A_LA_VALIDATION.modele).toBe(MODELE_IBAN_DANS_UN_TEXTE)
  })

  it('les textes écrits : un IBAN dans un texte libre que la facture imprime, après les lignes, avant la validation', () => {
    expect(REFUS_DES_TEXTES.map((r) => [r.cle, r.rang, r.code, r.modele])).toEqual([['iban_dans_un_texte', 4, '22023', MODELE_IBAN_DANS_UN_TEXTE]])
    expect(messagesSql(TEXTES())).toEqual([MODELE_IBAN_DANS_UN_TEXTE])
    expect(codesSql(TEXTES())).toEqual(['22023'])
    expect(valeursSql(TEXTES())).toEqual(['v_libelle'])
    expect(FONCTION.indexOf('insert into facture_lignes')).toBeLessThan(FONCTION.indexOf('-- A7-Q3. UN IBAN DANS UN TEXTE LIBRE'))
    // L'en-tête dans l'ordre de l'impression, la colonne de chacun et son libellé, ceux du module ; les lignes au rang 12, la
    // mention légale au 13 ; d'un avoir, la mention légale seule.
    const entete = [...TEXTES().matchAll(/\((\d+), '((?:[^']|'')*)', f\.(\w+)\)/g)].map((m) => ({ rang: Number(m[1]), libelle: chaineSql(m[2]), cle: m[3] }))
    expect(entete).toEqual(TEXTES_DE_L_EN_TETE.map(({ rang, libelle, cle }) => ({ rang, libelle, cle })))
    expect(TEXTES()).toContain("where f.id = v_id and (v_type <> 'avoir' or x.rang = 13)")
    expect(TEXTES()).toContain("select 12, l.ordre * 2 + y.rang, y.quoi || ' de la ligne ' || (l.ordre + 1), y.valeur")
    const ligne = [...TEXTES().matchAll(/\((\d), '((?:[^']|'')*)', l\.(\w+)\)/g)].map((m) => ({ cle: m[3], libelle: chaineSql(m[2]) }))
    expect(ligne).toEqual(TEXTES_DE_LA_LIGNE.map(({ cle, libelle }) => ({ cle, libelle })))
    // Ce que la base garde d'un brouillon quand l'appel ne nomme pas la clé : les champs `?` de la mise à jour, ceux du module.
    const gardes = [...FONCTION.matchAll(/ {6}(\w+) = case when p_facture \? '(\w+)'/g)].map((m) => m[1])
    expect(TEXTES_DE_L_EN_TETE.filter((t) => t.garde).map((t) => t.cle).every((c) => gardes.includes(c))).toBe(true)
    expect(TEXTES_DE_L_EN_TETE.filter((t) => !t.garde).every((t) => FONCTION.includes(`      ${t.cle} = p_facture->>'${t.cle}',`))).toBe(true)
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
interface EtapeDeLEssai { numero: string; genre: string; qui: string; requete: string; code: string; attendu: string | null }
const ETAPES: EtapeDeLEssai[] = [...ESSAI.matchAll(
  /\('(\w+)', '(\w+)', '(?:[^']|'')*', '(\w+)', (?:null|'\w+'),\s*\$q\$([\s\S]*?)\$q\$,\s*'(\w+)',\s*(null|'(?:[^']|'')*'),\s*(?:null|'\w+')\)/g,
)].map((m) => ({ numero: m[1], genre: m[2], qui: m[3], requete: m[4], code: m[5], attendu: m[6] === 'null' ? null : chaineSql(m[6].slice(1, -1)) }))

// Les identifiants de l'essai ; l'inconnu (tiré au hasard) prend ici un identifiant qu'aucun jeu ne pose.
const IDS = new Map([...entre(ESSAI, 'ids := jsonb_build_object(', ';\n').matchAll(/'(\w+)', '([0-9a-f-]{36})'/g)].map((m) => [m[1], m[2]]))
IDS.set('INCONNUE', 'a7a00000-0000-4000-8000-00000000ffff')
const macro = (texte: string) => texte.replace(/\{(\w+)\}/g, (tout, cle: string) => IDS.get(cle) ?? tout)

describe('l’essai exige chaque refus neuf, et le module rejoue ses appels comme la base y a répondu', () => {
  it('chaque refus du module est exigé par au moins un contrôle de l’essai, sous son code et ses mots', () => {
    expect(ETAPES.length).toBeGreaterThan(180)
    for (const r of [...REFUS_DE_LA_PROVENANCE, ...REFUS_DES_TEXTES, ...REFUS_DE_LA_VALIDATION_FIGEE]) {
      expect(ETAPES.some((e) => e.genre === 'controle' && e.code === r.code && e.attendu !== null && correspondAuModele(r.modele, e.attendu)),
        r.cle).toBe(true)
    }
    // Un IBAN : chaque texte que la facture imprime, et chaque texte que la validation figerait, a son contrôle — pour les
    // textes, par le cabinet ET par le client.
    const libellesExiges = (qui: string) => new Set(ETAPES.filter((e) => e.genre === 'controle' && e.qui === qui && e.code === '22023'
      && e.attendu !== null && correspondAuModele(MODELE_IBAN_DANS_UN_TEXTE, e.attendu))
      .map((e) => (e.attendu as string).slice('Un IBAN figure dans '.length).split(' : ')[0]))
    for (const qui of ['chef', 'client']) {
      for (const t of TEXTES_DE_L_EN_TETE) expect(libellesExiges(qui).has(t.libelle), `${qui} : ${t.libelle}`).toBe(true)
      for (const t of TEXTES_DE_LA_LIGNE) expect(libellesExiges(qui).has(`${t.libelle} de la ligne 1`), `${qui} : ${t.libelle}`).toBe(true)
    }
    const aLaValidation = new Set([...libellesExiges('chef'), ...libellesExiges('client')])
    expect(TEXTES_FIGES_A_LA_VALIDATION.filter((t) => aLaValidation.has(t.libelle)).map((t) => t.rang)).toEqual([1, 2, 3, 4, 5, 6, 7])
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
    // Le refus d'un IBAN est le même modèle pour les textes écrits et pour la validation : son libellé dit lequel.
    const libelleDUnIban = (attendu: string) => attendu.slice('Un IBAN figure dans '.length).split(' : ')[0]
    const aLaValidation = new Set<string>(TEXTES_FIGES_A_LA_VALIDATION.map((t) => t.libelle))
    const neuf = (e: EtapeDeLEssai) => {
      if (e.attendu === null) return undefined
      const attendu = e.attendu
      if (e.code === '22023' && correspondAuModele(MODELE_IBAN_DANS_UN_TEXTE, attendu)) {
        return aLaValidation.has(libelleDUnIban(attendu)) ? IBAN_A_LA_VALIDATION : REFUS_DES_TEXTES[0]
      }
      return [...REFUS_DE_LA_PROVENANCE, ...REFUS_DE_LA_VALIDATION_FIGEE].find((r) => r.code === e.code && correspondAuModele(r.modele, attendu))
    }
    let rejoues = 0
    const vus = new Set<string>()
    for (const e of ETAPES) {
      const appel = APPEL.exec(e.requete.split('§§')[0])
      if (!appel) continue
      const facture = JSON.parse(macro(chaineSql(appel[3])))
      const lignes = JSON.parse(macro(chaineSql(appel[4])))
      const avoir = appel[2] === 'null' && facture.type === 'avoir'
      const provenance = refusDeLaProvenance({
        avoir, facture, lignes, contactsDuDossier: contactsDe(appel[1]), articlesDuDossier: articlesDe(appel[1]),
      })
      // Les textes se jugent après la provenance ; un brouillon modifié par l'essai garde ce que la saisie ne nomme pas, et
      // celui qui y pose un IBAN en direct le fait dans un ordre à part (l'étape 185), que la recherche des appels n'atteint pas.
      const textes = provenance ? null : refusDesTextesDeLaFacture({ avoir, facture, lignes, brouillon: null })
      const rendu = provenance ?? textes
      const attendu = e.code === 'OK' ? null : neuf(e)
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
    // Le plancher : l'essai ne s'est pas vidé, et chaque refus de la provenance et des textes y a été rejoué au moins une
    // fois — la référence de cent un caractères (l'étape 44, composée en SQL) l'est par le test qui suit.
    expect(rejoues).toBeGreaterThanOrEqual(90)
    expect([...vus].sort()).toEqual(['article', 'contact', 'iban_dans_un_texte', 'nature', 'reference', 'unite'])
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

  it('les blancs que la base retire du SIRET sont ceux que `\\s` désigne en JavaScript, un par un — dans chaque fonction', () => {
    // Trois déclarations : `numero_tva_du_vendeur`, `porte_un_iban` et `enregistrer_facture` (A7-Q2), chacune la même liste.
    const declarations = [...MIGRATION.texte.matchAll(/v_blancs constant text :=([^;]*);\n/g)].map((m) => m[1])
    expect(declarations).toHaveLength(3)
    const enJs: number[] = []
    for (let c = 0; c <= 0xffff; c++) if (/\s/.test(String.fromCharCode(c))) enJs.push(c)
    for (const d of declarations) expect([...d.matchAll(/chr\((\d+)\)/g)].map((m) => Number(m[1]))).toEqual(enJs)
    // `trim` retire de même aux bords, ceux-là et pas d'autres, et le module l'emploie (`adresseNette`).
    const retires: number[] = []
    for (let c = 0; c <= 0xffff; c++) if (`${String.fromCharCode(c)}x`.trim() === 'x') retires.push(c)
    expect(retires).toEqual(enJs)
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
    // Adapté le 29/10/2026 à A7-Q2 et A7-Q3 : la validation lit aussi l'émetteur, le dossier et les paramètres en vigueur.
    const base: ValidationAJuger = { contactGarde: null, contactsDuDossier: [K], formeJuridique: '1000', denomination: 'ESSAI DUPONT EI',
      rcsVille: null, mentionsIdentite: null, cabinet: false, avoir: false, reprise: false, emetteurSiret: '12345678200010',
      emetteurAdresse: 'ESSAI ADRESSE', dossierSiret: '12345678200010', dossierAdresse: 'ESSAI ADRESSE', parametres: null }
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
    // Adapté le 29/10/2026 à A7Q-Q1 : une société sans dénomination ne se valide plus depuis l'espace client ; le
    // cabinet, si (la règle entière, au test « A7Q-Q1 » ci-dessous).
    expect(refusDeLaValidationFigee({ ...base, formeJuridique: '5710', denomination: null })?.cle).toBe('denomination_a_poser')
    expect(refusDeLaValidationFigee({ ...base, formeJuridique: '5710', denomination: null, cabinet: true })).toBeNull()
  })

  const BASE_A7Q: ValidationAJuger = { contactGarde: null, contactsDuDossier: [], formeJuridique: '1000', denomination: 'ESSAI DUPONT EI',
    rcsVille: null, mentionsIdentite: null, cabinet: false, avoir: false, reprise: false, emetteurSiret: '12345678200010',
    emetteurAdresse: 'ESSAI ADRESSE\nESSAI VILLE', dossierSiret: '12345678200010', dossierAdresse: 'ESSAI ADRESSE\nESSAI VILLE', parametres: null }
  const cle = (v: Partial<ValidationAJuger>) => refusDeLaValidationFigee({ ...BASE_A7Q, ...v })?.cle ?? null

  it('A7-Q2 : le SIRET et l’adresse du dossier, aux blancs et aux fins de ligne près ; le cabinet et un avoir ne sont pas jugés', () => {
    expect(cle({})).toBeNull()
    expect(cle({ emetteurSiret: '123 456 782 00010', emetteurAdresse: ' ESSAI ADRESSE\r\nESSAI VILLE\r\n' })).toBeNull()
    expect(cle({ emetteurSiret: `123456782${String.fromCharCode(0xa0)}00010` })).toBeNull()
    expect(cle({ emetteurAdresse: 'ESSAI ADRESSE\rESSAI VILLE' })).toBeNull()
    expect(cle({ emetteurSiret: '10000020700015' })).toBe('siret_du_dossier')
    expect(cle({ emetteurSiret: null })).toBe('siret_du_dossier')
    expect(cle({ emetteurAdresse: 'ESSAI AUTRE ADRESSE' })).toBe('adresse_du_dossier')
    expect(cle({ emetteurAdresse: 'ESSAI  ADRESSE\nESSAI VILLE' })).toBe('adresse_du_dossier')
    expect(cle({ emetteurAdresse: null })).toBe('adresse_du_dossier')
    expect(cle({ dossierAdresse: ' \n\t' })).toBe('adresse_a_poser')
    expect(cle({ dossierSiret: null })).toBe('siret_a_poser')
    expect(cle({ dossierSiret: '   ', dossierAdresse: null })).toBe('siret_a_poser')
    expect(cle({ emetteurSiret: '10000020700015', emetteurAdresse: 'ESSAI AUTRE ADRESSE' })).toBe('siret_du_dossier')
    // Du côté du dossier de même (les étapes 149d à 149h de l'essai) : son SIRET en groupes, un blanc insécable compris, son
    // adresse sur trois lignes — une fin de ligne Windows, puis un retour chariot seul —, un blanc et une fin de ligne au
    // bout ; une fin de ligne n'est pas un espace ; un SIRET de blancs n'en est pas un.
    const enGroupes = `123 456 782${String.fromCharCode(0xa0)}00010`
    const surTroisLignes = 'ESSAI ADRESSE G\r\nESSAI SECONDE LIGNE G\rESSAI TROISIÈME LIGNE G \r\n'
    const dossier = { dossierSiret: enGroupes, dossierAdresse: surTroisLignes }
    expect(cle({ ...dossier, emetteurAdresse: 'ESSAI ADRESSE G\rESSAI SECONDE LIGNE G\nESSAI TROISIÈME LIGNE G' })).toBeNull()
    expect(cle({ ...dossier, emetteurAdresse: 'ESSAI ADRESSE G\r\nESSAI SECONDE LIGNE G\r\nESSAI TROISIÈME LIGNE G' })).toBeNull()
    expect(cle({ ...dossier, emetteurAdresse: 'ESSAI ADRESSE G ESSAI SECONDE LIGNE G ESSAI TROISIÈME LIGNE G' })).toBe('adresse_du_dossier')
    expect(cle({ dossierSiret: ` ${String.fromCharCode(0xa0)}\t`, dossierAdresse: surTroisLignes })).toBe('siret_a_poser')
    // L'ordre, aussi quand le dossier n'a pas d'adresse : un autre SIRET se dit d'abord (l'étape 143b).
    expect(cle({ emetteurSiret: '10000020700015', dossierAdresse: null })).toBe('siret_du_dossier')
    expect(cle({ formeJuridique: null, dossierSiret: null })).toBe('forme_a_regler')
    expect(cle({ cabinet: true, dossierSiret: null, dossierAdresse: null, emetteurSiret: 'x' })).toBeNull()
    expect(cle({ avoir: true, emetteurSiret: '10000020700015', emetteurAdresse: 'ESSAI AUTRE ADRESSE' })).toBeNull()
    expect(refusDeLaValidationFigee({ ...BASE_A7Q, dossierSiret: null })).toEqual({ cle: 'siret_a_poser', code: '22023',
      message: "Le SIRET du dossier n'est pas renseigné : le cabinet le renseigne avant qu'une facture se valide depuis l'espace client." })
  })

  it('« les mêmes » : le SIRET sans aucun blanc, l’adresse aux bords nets et aux fins de ligne ramenées', () => {
    expect(siretSansBlancs(` 123\t456${String.fromCharCode(0x202f)}782 00010\n`)).toBe('12345678200010')
    expect(siretSansBlancs(null)).toBe('')
    expect(adresseNette(`${String.fromCharCode(0xfeff)} 12 rue X\r\n69001 Lyon\r\n `)).toBe('12 rue X\n69001 Lyon')
    expect(adresseNette('12 rue X\r69001 Lyon')).toBe('12 rue X\n69001 Lyon')
    expect(adresseNette(null)).toBe('')
  })

  it('A7Q-Q1 : la dénomination du dossier, absente ou de blancs, pour un accès « Ventes » et quelle que soit la forme', () => {
    const societe: Partial<ValidationAJuger> = { formeJuridique: '5710', denomination: 'ESSAI SOCIÉTÉ' }
    expect(cle(societe)).toBeNull()
    expect(cle({ ...societe, denomination: null })).toBe('denomination_a_poser')
    expect(cle({ ...societe, denomination: undefined })).toBe('denomination_a_poser')
    expect(cle({ ...societe, denomination: '' })).toBe('denomination_a_poser')
    // Faite de blancs : ceux que `\s` désigne — l'insécable et l'espace fine insécable, que la contrainte de la colonne
    // laisse passer (elle n'écarte que quatre blancs), comme la tabulation et les fins de ligne.
    const blancs = `${String.fromCharCode(0xa0)}${String.fromCharCode(0x202f)}\t\r\n${String.fromCharCode(0x3000)}`
    expect(cle({ ...societe, denomination: blancs })).toBe('denomination_a_poser')
    expect(denominationAbsente(blancs)).toBe(true)
    // Un caractère qui n'est pas un blanc suffit, même invisible : la base ne juge ici que l'absence.
    expect(cle({ ...societe, denomination: ` ${String.fromCharCode(0x200b)} ` })).toBeNull()
    expect(denominationAbsente(`${blancs}x${blancs}`)).toBe(false)
    // Le cabinet n'est pas jugé ; un avoir qui reprend l'identité de sa facture non plus ; l'avoir d'une facture
    // d'avant, qui fige l'identité du jour, l'est — comme la forme.
    expect(cle({ ...societe, denomination: null, cabinet: true })).toBeNull()
    expect(cle({ ...societe, denomination: null, avoir: true, reprise: true })).toBeNull()
    expect(cle({ ...societe, denomination: null, avoir: true, reprise: false })).toBe('denomination_a_poser')
    expect(cle({ formeJuridique: null, denomination: null, avoir: true, reprise: false })).toBe('forme_a_regler')
    // L'ordre : la forme d'abord ; puis l'entrepreneur individuel, dont le refus dit ce que la dénomination doit
    // porter, et qui vaut aussi pour le cabinet ; puis elle ; puis l'émetteur (A7-Q2), puis un IBAN (A7-Q3).
    expect(cle({ formeJuridique: null, denomination: null })).toBe('forme_a_regler')
    expect(cle({ formeJuridique: '1000', denomination: null })).toBe('entrepreneur_individuel')
    expect(cle({ formeJuridique: '1000', denomination: blancs })).toBe('entrepreneur_individuel')
    expect(cle({ formeJuridique: '1000', denomination: null, cabinet: true })).toBe('entrepreneur_individuel')
    expect(cle({ ...societe, denomination: null, dossierSiret: null, dossierAdresse: null })).toBe('denomination_a_poser')
    expect(cle({ ...societe, denomination: null, emetteurSiret: '10000020700015', emetteurAdresse: 'ESSAI AUTRE ADRESSE' }))
      .toBe('denomination_a_poser')
    const parametres = { escompte: null, penalites: null, mentions_complementaires: null, pied_de_page: 'FR13 9999 9000 0200 0000 0001 234' }
    expect(cle({ ...societe, denomination: null, parametres })).toBe('denomination_a_poser')
    expect(cle({ ...societe, denomination: null, parametres, cabinet: true })).toBe('iban_a_la_validation')
    expect(refusDeLaValidationFigee({ ...BASE_A7Q, ...societe, denomination: null })).toEqual({ cle: 'denomination_a_poser',
      code: '22023',
      message: "La dénomination du dossier n'est pas renseignée : le cabinet la renseigne avant qu'une facture se valide depuis l'espace client." })
  })

  it('A7-Q3 à la validation : l’identité, sauf celle qu’un avoir reprend, puis les paramètres en vigueur, pour tout auteur', () => {
    const IBAN = 'FR13 9999 9000 0200 0000 0001 234'
    const parametres = { escompte: null, penalites: null, mentions_complementaires: null, pied_de_page: `ESSAI, IBAN ${IBAN}` }
    expect(refusDeLaValidationFigee({ ...BASE_A7Q, parametres })).toEqual({ cle: 'iban_a_la_validation', code: '22023',
      message: `Un IBAN figure dans le pied de page des paramètres de facturation : sur une facture, un IBAN ne s'imprime que dans le RIB des paramètres de facturation, confirmé par le cabinet.` })
    expect(cle({ cabinet: true, parametres })).toBe('iban_a_la_validation')
    expect(cle({ parametres: { ...parametres, pied_de_page: 'FR14 9999 9000 0200 0000 0001 234' } })).toBeNull()
    const libelle = (v: Partial<ValidationAJuger>) => refusDeLaValidationFigee({ ...BASE_A7Q, ...v })?.message.split(' : ')[0] ?? null
    expect(libelle({ parametres: { ...parametres, escompte: IBAN } })).toBe("Un IBAN figure dans les conditions d'escompte des paramètres de facturation")
    expect(libelle({ mentionsIdentite: IBAN, parametres })).toBe("Un IBAN figure dans les autres mentions de l'identité du dossier")
    expect(libelle({ denomination: `ESSAI DUPONT EI ${IBAN}`, rcsVille: IBAN })).toBe('Un IBAN figure dans la dénomination du dossier')
    expect(libelle({ rcsVille: `Lyon ${IBAN}` })).toBe('Un IBAN figure dans la ville du greffe du dossier')
    // L'identité qu'un avoir reprend de sa facture ne se rejuge pas ; les paramètres du jour, si.
    expect(cle({ avoir: true, reprise: true, mentionsIdentite: IBAN })).toBeNull()
    expect(cle({ avoir: true, reprise: true, mentionsIdentite: IBAN, parametres })).toBe('iban_a_la_validation')
    // L'émetteur d'un accès « Ventes » se juge avant.
    expect(cle({ emetteurSiret: 'x', parametres })).toBe('siret_du_dossier')
  })
})

describe('refusDesTextesDeLaFacture (A7-Q3)', () => {
  const IBAN = 'FR13 9999 9000 0200 0000 0001 234'
  const facture = { tiers_nom: 'ESSAI CLIENT', emetteur_nom: 'ESSAI', emetteur_siret: '12345678200010', montant_ttc: 12 }
  const ligne = (champs: Record<string, unknown> = {}) => ({ designation: 'ESSAI SÉANCE', quantite: 1, prix_unitaire_ht: 10, taux_tva: 20, ...champs })
  const juger = (f: Record<string, unknown>, lignes: unknown[] = [ligne()], avoir = false, brouillon: Record<string, string | null> | null = null) =>
    refusDesTextesDeLaFacture({ avoir, facture: f, lignes, brouillon })?.message.split(' : ')[0] ?? null

  it('un texte sans IBAN, ou à clé fausse, passe ; chaque texte que la facture imprime se juge, nommé', () => {
    expect(juger(facture)).toBeNull()
    expect(juger({ ...facture, mentions_legales: 'FR14 9999 9000 0200 0000 0001 234' })).toBeNull()
    for (const t of TEXTES_DE_L_EN_TETE) expect(juger({ ...facture, [t.cle]: `ESSAI ${IBAN}` }), t.cle).toBe(`Un IBAN figure dans ${t.libelle}`)
    expect(juger(facture, [ligne(), ligne({ reference: IBAN.replace(/ /g, '') })])).toBe('Un IBAN figure dans la référence de la ligne 2')
    // Les notes et l'adresse électronique du client ne s'impriment pas.
    expect(juger({ ...facture, notes: IBAN, tiers_email: IBAN })).toBeNull()
  })

  it('l’ordre : l’en-tête, puis chaque ligne (sa désignation, puis sa référence), puis la mention légale', () => {
    expect(juger({ ...facture, emetteur_nom: IBAN, mentions_legales: IBAN }, [ligne({ designation: IBAN })])).toBe("Un IBAN figure dans le nom de l'émetteur")
    expect(juger({ ...facture, mentions_legales: IBAN }, [ligne({ designation: IBAN })])).toBe('Un IBAN figure dans la désignation de la ligne 1')
    expect(juger(facture, [ligne({ reference: 'FR1399999000020000000001234' }), ligne({ designation: IBAN })]))
      .toBe('Un IBAN figure dans la référence de la ligne 1')
    expect(juger({ ...facture, mentions_legales: IBAN, livraison_ville: IBAN })).toBe('Un IBAN figure dans la ville de livraison')
  })

  it('un avoir : ses lignes et sa mention légale seules ; un brouillon modifié garde ce que la saisie ne nomme pas', () => {
    expect(juger({ type: 'avoir', tiers_nom: IBAN, tiers_adresse: IBAN }, [ligne({ quantite: -1 })], true)).toBeNull()
    expect(juger({ type: 'avoir', mentions_legales: IBAN }, [ligne({ quantite: -1 })], true)).toBe('Un IBAN figure dans la mention légale')
    expect(juger({ type: 'avoir' }, [ligne({ quantite: -1, designation: IBAN })], true)).toBe('Un IBAN figure dans la désignation de la ligne 1')
    // La ville de livraison du brouillon, gardée quand la saisie ne la nomme pas ; remplacée quand elle la nomme, nulle comprise.
    expect(juger(facture, [ligne()], false, { livraison_ville: `ESSAI ${IBAN}` })).toBe('Un IBAN figure dans la ville de livraison')
    expect(juger({ ...facture, livraison_ville: null }, [ligne()], false, { livraison_ville: `ESSAI ${IBAN}` })).toBeNull()
    // Le nom du client ne se garde pas : la mise à jour l'écrit de la saisie, nul quand elle ne le porte pas.
    expect(juger({ emetteur_nom: 'ESSAI' }, [ligne()], false, { tiers_nom: IBAN } as Record<string, string>)).toBeNull()
  })

  it('la saisie telle que la base la lit : un nombre, un objet, une saisie qui n’est pas un objet', () => {
    expect(juger({ ...facture, tiers_nom: 123 })).toBeNull()
    expect(juger({ ...facture, tiers_nom: { iban: IBAN } })).toBe('Un IBAN figure dans le nom du client')
    expect(refusDesTextesDeLaFacture({ avoir: false, facture: null, lignes: 'pas une liste', brouillon: null })).toBeNull()
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
