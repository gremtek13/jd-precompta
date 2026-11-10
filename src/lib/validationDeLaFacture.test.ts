import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { correspondAuModele } from '../test/essaiVentesFacturees'
import { argumentsSql, codesSql, messagesSql, nombreDeValeurs } from '../test/raiseSql'
import { definitionsSql, derniereDefinitionSql, fichiersDuSchema, fichiersPrepares, type DefinitionSql } from '../test/schema'
import { motsDuCabinet, pourLEspace } from './espaceVentes'
import { REFUS_DE_LA_VALIDATION_FIGEE } from './mentionsFigees'
import { EXONERATIONS, MENTION_FRANCHISE, mentionTva } from './statutTva'
import type { ArticleExoneration, RegimeInternational, StatutTva } from './types'
import { REGIMES_INTERNATIONAUX, horsDeLaTvaFrancaise } from './factureInternationale'
import {
  ADRESSE_DU_CLIENT_EXIGEE, AVIS_ARTICLE_A_CHOISIR, AVIS_STATUT_A_PRECISER, REFUS_ADRESSE_DU_CLIENT, REFUS_DE_LA_VALIDATION,
  REFUS_LIGNE_A_ZERO, avisDuStatutDeTva, plusRecenteDeLaSerie, refusDeLAdresseDuClient, refusDeLaDateDEmission,
  refusDeLaLigneAZero, refusDeLaValidation, refusDuStatutDeTva, type AdresseDuClientAJuger, type FactureDeLaSerie,
  type LigneAZeroAJuger, type ValidationAJuger,
} from './validationDeLaFacture'

// CE QUE LA VALIDATION EXIGE D'UNE FACTURE (correction de la facture, 31/10/2026, reprise le 02/11/2026 pour FACTURE-Q1 ;
// migration `facture_dates_centimes_mention_tva`, en production depuis le 02/11/2026), CONFRONTÉ AU
// TEXTE DE SA MIGRATION ET À SON ESSAI. La migration recopie la garde des factures (`garder_factures_validees`) au
// caractère près et n'y insère que quatre variables et un bloc ; ce garde le vérifie contre l'export, relit dans le bloc
// les mots, les codes, les valeurs, les conditions — le statut à préciser et l'article manquant refusés au seul accès
// « Ventes » (FACTURE-Q1, FACTURE-Q2) — et l'ordre que lib/validationDeLaFacture.ts redit, confronte les mentions de TVA du
// bloc à celles du module des statuts (lib/statutTva.ts), la série que la base lit à celle que le module lit, son retour
// arrière à l'export, et rejoue sur le module chaque cas de l'essai (supabase/essais/factures.sql, 107 à 114) tel que la
// base y a répondu. Le récit : HISTORIQUE.md, « LA FACTURE : LA DATE DANS L'ORDRE DE SA SÉRIE, LE DEMI-CENTIME ET LA
// MENTION DE TVA, REPRISE POUR FACTURE-Q1 (PRÉPARÉE, PAS APPLIQUÉE) ». Données FICTIVES.

const GARDE = 'garder_factures_validees'
const MIGRATION = /\/\d{14}_facture_dates_centimes_mention_tva\.sql$/
const RETOUR = /^\d{14}_retour_facture_dates_centimes_mention_tva\.sql$/
const md5 = (texte: string) => createHash('md5').update(texte, 'utf8').digest('hex')
const nomDuFichier = (chemin: string) => chemin.split('/').pop() as string
const corps = (definition: string) => definition.slice(definition.indexOf('as $$') + 'as $$'.length)
// Une définition sans la forme de son instruction : `create function` (l'export) ou `create or replace function`.
const uneDefinition = (definition: string) => definition.replace(/^create or replace function /, 'create function ')

// La migration, où qu'elle soit : préparée aujourd'hui, dans l'export le jour de son application.
function laMigration(): { chemin: string; texte: string } {
  const trouvees = [...fichiersPrepares(), ...fichiersDuSchema()].filter((x) => MIGRATION.test(x.chemin))
  expect(trouvees.map((f) => f.chemin), 'la migration facture_dates_centimes_mention_tva, une fois').toHaveLength(1)
  return trouvees[0]
}

// La définition qu'un texte donne à une fonction : du `create or replace function` au `$$;` qui la ferme.
function definitionDans(texte: string, nom: string): string {
  const debut = texte.indexOf(`create or replace function public.${nom}(`)
  expect(debut, `la définition de ${nom}`).toBeGreaterThanOrEqual(0)
  expect(texte.indexOf(`create or replace function public.${nom}(`, debut + 1), `${nom} définie deux fois`).toBe(-1)
  return texte.slice(debut, texte.indexOf('$$;', debut))
}

// La définition que l'export portait AVANT la migration : celle que la production porte le 31/10/2026.
function avantLaMigration(nom: string): { chemin: string; definition: string } {
  const limite = nomDuFichier(laMigration().chemin)
  return definitionsSql(nom, fichiersDuSchema().filter((f) => nomDuFichier(f.chemin) < limite)).at(-1) as DefinitionSql
}

// Le retour arrière, dans supabase/preparees/retour/.
function leRetour(): string {
  const dossier = new URL('../../supabase/preparees/retour/', import.meta.url).pathname
  expect(existsSync(dossier), 'supabase/preparees/retour/').toBe(true)
  const nom = readdirSync(dossier).find((n) => RETOUR.test(n))
  expect(nom, 'le retour arrière de facture_dates_centimes_mention_tva').toBeDefined()
  return readFileSync(dossier + nom, 'utf8')
}

// Ce que la migration insère dans la garde : ses quatre variables, sous leur commentaire, et le bloc de la validation, de
// son commentaire au `end if;` qui le ferme, juste avant le `return new;` de la branche UPDATE.
const VARIABLES = [
  "  -- Correction de la facture (31/10/2026) : ce que la validation exige.",
  '  v_mention text;',
  '  v_aujourdhui date;',
  '  v_numero_suivi text;',
  '  v_date_suivie date;',
]
const OUVERTURE_DU_BLOC = '    -- CE QUE LA VALIDATION EXIGE DE LA FACTURE (correction de la facture, 31/10/2026).'

function bornesDuBloc(lignes: string[]): [number, number] {
  const debut = lignes.findIndex((l) => l.startsWith(OUVERTURE_DU_BLOC))
  expect(debut, 'l’ouverture du bloc de la validation').toBeGreaterThan(0)
  expect(lignes.filter((l) => l.startsWith(OUVERTURE_DU_BLOC))).toHaveLength(1)
  const si = lignes.indexOf("    if new.statut = 'validee' then", debut)
  // Le `end if;` à quatre espaces qui suit : celui du bloc, ses refus étant tous plus enfoncés.
  const fin = lignes.indexOf('    end if;', si)
  expect(si).toBeGreaterThan(debut)
  expect(fin).toBeGreaterThan(si)
  return [debut, fin + 1]
}

const POSEE = () => definitionDans(laMigration().texte, GARDE)
const BLOC = () => {
  const lignes = POSEE().split('\n')
  const [debut, fin] = bornesDuBloc(lignes)
  return lignes.slice(debut, fin).join('\n')
}

describe('la migration recopie la garde des factures, et n’y insère que ce que la validation exige', () => {
  it('sa garde de tête exige, avant toute définition, les deux corps que l’export et la production portent', () => {
    const texte = laMigration().texte
    const premiere = texte.indexOf('create or replace function')
    for (const [nom, signature, chemin, empreinte] of [
      [GARDE, 'public.garder_factures_validees()', /\/20261007193006_factures_validees_figees\.sql$/, 'e3dfa6dc1b3f127c66bab26d5637ef89'],
      ['centimes_ligne_facture', 'public.centimes_ligne_facture(numeric, numeric, numeric, boolean)',
        /\/20261008180607_encaissements_des_factures\.sql$/, '9b5b63d729df6c0d76f623a15d1e11d9'],
    ] as const) {
      const hier = avantLaMigration(nom)
      expect(hier.chemin, nom).toMatch(chemin)
      expect(md5(corps(hier.definition)), nom).toBe(empreinte)
      const ligne = texte.indexOf(`('${signature}', '${empreinte}')`)
      expect(ligne, nom).toBeGreaterThan(0)
      expect(ligne, nom).toBeLessThan(premiere)
    }
    // Une seule fonction de chaque nom, et les colonnes que mentions_figees a posées.
    expect(texte).toContain("p.proname = split_part(substr(t.signature, 8), '(', 1)) <> 1")
    expect(texte).toContain("a.attname in ('statut_tva', 'article_exoneration', 'mentions_figees')) <> 3 then")
  })

  it('elle remplace deux fonctions et rien d’autre : ni table, ni droit, ni policy, ni suppression', () => {
    const texte = laMigration().texte
    const instructions = texte.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n')
    expect([...instructions.matchAll(/create or replace function public\.(\w+)\(/g)].map((m) => m[1]))
      .toEqual(['centimes_ligne_facture', GARDE])
    expect([...instructions.matchAll(/comment on function public\.(\w+)\(/g)].map((m) => m[1])).toEqual(['centimes_ligne_facture', GARDE])
    for (const interdit of [/\bdrop\b/i, /\btruncate\b/i, /\bgrant\b/i, /\brevoke\b/i, /\bdelete\s+from\b/i, /\balter\s+table\b/i,
      /\bcreate\s+(table|policy|trigger|index)\b/i, /\binsert\s+into\b/i, /\bupdate\s+public\./i]) {
      expect(instructions, String(interdit)).not.toMatch(interdit)
    }
    // Le mot de la suppression n'y paraît que dans `tg_op`, comme dans la garde d'hier.
    expect([...instructions.matchAll(/delete/gi)].length).toBe([...avantLaMigration(GARDE).definition.matchAll(/delete/gi)].length)
    // Aucune barre oblique inverse ni fin de ligne Windows : l'outil d'application décode les échappements.
    expect(texte).not.toContain('\\')
    expect(texte).not.toContain('\r')
  })

  it('la garde posée est celle d’hier au caractère près, ses quatre variables et le bloc de la validation ôtés', () => {
    const lignes = POSEE().split('\n')
    const debutVariables = lignes.indexOf(VARIABLES[0])
    expect(lignes.slice(debutVariables, debutVariables + VARIABLES.length)).toEqual(VARIABLES)
    const [debut, fin] = bornesDuBloc(lignes)
    const sans = lignes.filter((_, i) => !(i >= debutVariables && i < debutVariables + VARIABLES.length) && !(i >= debut && i < fin))
    // L'export la créait (`create function`), la migration la remplace : le reste est identique.
    expect(uneDefinition(sans.join('\n'))).toBe(uneDefinition(avantLaMigration(GARDE).definition))
  })

  it('le bloc vient après la légitimité de la validation (enregistrer_facture seule), et juste avant le return de la branche', () => {
    const lignes = POSEE().split('\n')
    const [debut, fin] = bornesDuBloc(lignes)
    expect(lignes.slice(debut - 3, debut)).toEqual([
      "      raise exception 'Une facture ne se valide que par enregistrer_facture, qui lui donne son numéro.'",
      "        using errcode = '42501';",
      '    end if;',
    ])
    expect(lignes[fin]).toBe('    return new;')
    // Dans la branche UPDATE, que seule la validation par la fonction atteint avec `statut = 'validee'` : la restauration
    // insère, et l'insertion n'est pas jugée ici.
    const branche = POSEE().slice(POSEE().indexOf("  if tg_op = 'UPDATE' then"), POSEE().indexOf("  if new.statut = 'validee' and not public.restauration_des_factures"))
    expect(branche).toContain(OUVERTURE_DU_BLOC)
  })
})

describe('les refus du bloc sont ceux que le module redit, dans son ordre', () => {
  it('les mots, les codes, le nombre de valeurs : un à un', () => {
    const bloc = BLOC()
    expect(messagesSql(bloc)).toEqual(REFUS_DE_LA_VALIDATION.map((r) => r.modele))
    expect(codesSql(bloc)).toEqual(REFUS_DE_LA_VALIDATION.map((r) => r.code))
    expect(argumentsSql(bloc).map((a) => a.length)).toEqual(REFUS_DE_LA_VALIDATION.map((r) => nombreDeValeurs(r.modele)))
  })

  it('les valeurs : la mention du statut, les dates au jour de Paris en JJ/MM/AAAA, le numéro suivi', () => {
    expect(argumentsSql(BLOC())).toEqual([
      [], [], ['v_mention'],
      ["to_char(new.date_emission, 'DD/MM/YYYY')", "to_char(v_aujourdhui, 'DD/MM/YYYY')"],
      ["to_char(new.date_emission, 'DD/MM/YYYY')", 'v_numero_suivi', "to_char(v_date_suivie, 'DD/MM/YYYY')",
        "to_char(v_date_suivie, 'DD/MM/YYYY')"],
    ])
    expect(BLOC()).toContain("v_aujourdhui := (now() at time zone 'Europe/Paris')::date;")
  })

  it('les rangs suivent ceux des refus de la validation figée (A7), un à un', () => {
    const dernier = Math.max(...REFUS_DE_LA_VALIDATION_FIGEE.map((r) => r.rang))
    expect(REFUS_DE_LA_VALIDATION.map((r) => r.rang)).toEqual(REFUS_DE_LA_VALIDATION.map((_, i) => dernier + 1 + i))
  })

  it('les conditions : le statut à préciser et l’article manquant d’une FACTURE, au seul accès « Ventes » ; la mention d’une facture comme d’un avoir', () => {
    const bloc = BLOC()
    // FACTURE-Q1 (la réponse du cabinet du 02/11/2026) : le statut à préciser, comme l'article manquant (FACTURE-Q2), ne se
    // refuse qu'à qui n'est pas du cabinet du dossier — la condition même d'`enregistrer_facture` pour l'identité légale.
    expect(bloc).toContain("if new.type = 'facture' and new.statut_tva is null\n"
      + '         and not public.admin_du_dossier(new.dossier_id) then')
    expect(bloc).toContain("if new.type = 'facture' and new.statut_tva = 'exonere' and new.article_exoneration is null\n"
      + '         and not public.admin_du_dossier(new.dossier_id) then')
    expect([...bloc.matchAll(/admin_du_dossier/g)]).toHaveLength(2)
    expect(derniereDefinitionSql('enregistrer_facture')).toContain('v_cabinet := public.admin_du_dossier(p_dossier_id);')
    expect(bloc).toContain("if v_mention is not null and strpos(coalesce(new.mentions_legales, ''), v_mention) = 0 then")
    expect(bloc).toContain('if new.date_emission > v_aujourdhui then')
    expect(bloc).toContain('if new.date_emission < v_date_suivie then')
  })
})

describe('les mentions de TVA du bloc sont celles du module des statuts', () => {
  it('la franchise, et chaque article de la liste fermée, au caractère près et dans son ordre', () => {
    const bloc = BLOC()
    const franchise = /when new\.statut_tva = 'franchise' then '((?:[^']|'')*)'/.exec(bloc)
    expect(franchise?.[1]).toBe(MENTION_FRANCHISE)
    const articles = [...bloc.matchAll(/when '(cgi_\w+)' then '((?:[^']|'')*)'/g)].map((m) => [m[1], m[2].replace(/''/g, "'")])
    expect(articles).toEqual(EXONERATIONS.map((e) => [e.code, e.mention]))
  })

  it('`mentionTva` rend la même mention pour chaque statut et chaque article ; aucune pour un redevable ni un statut à préciser', () => {
    const statuts: (StatutTva | null)[] = [null, 'redevable', 'franchise', 'exonere']
    const articles: (ArticleExoneration | null)[] = [null, ...EXONERATIONS.map((e) => e.code)]
    for (const s of statuts) {
      for (const a of articles) {
        const attendue = s === 'franchise' ? MENTION_FRANCHISE : s === 'exonere' ? (EXONERATIONS.find((e) => e.code === a)?.mention ?? null) : null
        expect(mentionTva(s, a), `${s} ${a}`).toBe(attendue)
      }
    }
  })
})

describe('la série : celle que la base lit sous le verrou, celle que le module lit', () => {
  it('la base : même dossier, une autre facture, validée, même lettre et même année ; la date la plus tardive, puis le rang', () => {
    const bloc = BLOC()
    expect(bloc).toContain("where f.dossier_id = new.dossier_id and f.id <> new.id and f.statut = 'validee'\n"
      + "         and split_part(f.numero, '-', 1) = split_part(new.numero, '-', 1)\n"
      + "       order by f.date_emission desc, split_part(f.numero, '-', 2)::integer desc\n       limit 1;")
    // Le numéro est déjà pris (enregistrer_facture le pose avec la validation) : la série se lit sur lui. Sa forme, la
    // lettre de son type et l'année de sa date, la contrainte de la table la tient.
    const contrainte = fichiersDuSchema().map((f) => f.texte).join('\n')
    expect(contrainte).toContain("check (numero ~ '^[FA][0-9]{4}-[0-9]{4,}$'\n      and left(numero, 1) = case when type = 'avoir' then 'A' else 'F' end\n"
      + "      and substr(numero, 2, 4) = extract(year from date_emission)::integer::text)")
    // Le verrou de la série, tenu jusqu'à la fin de la transaction : enregistrer_facture prend le numéro
    // (attribuer_numero_facture, qui appelle prochain_numero_facture, qui verrouille la ligne du compteur) AVANT
    // l'écriture qui valide, et c'est cette écriture que la garde juge.
    const enregistrer = derniereDefinitionSql('enregistrer_facture')
    const prise = enregistrer.indexOf('v_numero := attribuer_numero_facture(p_dossier_id, extract(year from v_date_emission)::integer, v_type);')
    expect(prise).toBeGreaterThan(0)
    expect(prise).toBeLessThan(enregistrer.indexOf("    set statut = 'validee', numero = v_numero, validated_at = now()"))
    expect(derniereDefinitionSql('attribuer_numero_facture')).toContain('v_sequence := prochain_numero_facture(p_dossier_id, p_annee, p_type);')
    expect(derniereDefinitionSql('prochain_numero_facture')).toMatch(/from facture_numerotation n\s+where n\.dossier_id = p_dossier_id and n\.annee = p_annee and n\.type = p_type\s+for update;/)
  })

  const f = (numero: string | null, date: string, statut: 'validee' | 'brouillon' = 'validee'): FactureDeLaSerie =>
    ({ numero, date_emission: date, statut })

  it('le module : les brouillons, l’autre lettre et l’autre année n’en sont pas ; à date égale, le plus grand rang, en nombre', () => {
    const factures = [
      f('F2025-0001', '2025-12-05'), f(null, '2025-12-20', 'brouillon'), f('A2025-0001', '2025-12-30'), f('F2024-0007', '2024-12-31'),
      f('F2025-9999', '2025-12-10'), f('F2025-10000', '2025-12-10'),
    ]
    expect(plusRecenteDeLaSerie('facture', '2025-12-15', factures)).toEqual({ numero: 'F2025-10000', date: '2025-12-10' })
    expect(plusRecenteDeLaSerie('avoir', '2025-12-15', factures)).toEqual({ numero: 'A2025-0001', date: '2025-12-30' })
    expect(plusRecenteDeLaSerie('facture', '2024-06-01', factures)).toEqual({ numero: 'F2024-0007', date: '2024-12-31' })
    expect(plusRecenteDeLaSerie('facture', '2026-01-02', factures)).toBeNull()
  })

  it('une date égale à la plus récente passe ; une date d’avant se refuse ; une date qui n’en est pas une ne se juge pas', () => {
    const factures = [f('F2025-0001', '2025-12-05')]
    const juge = (dateEmission: string, aujourdhui = '2026-10-31') =>
      refusDeLaDateDEmission({ type: 'facture', dateEmission, aujourdhui, factures })
    expect(juge('2025-12-05')).toBeNull()
    expect(juge('2025-12-04')?.cle).toBe('date_avant_la_derniere')
    expect(juge('2026-10-31')).toBeNull()
    expect(juge('2026-11-01')?.cle).toBe('date_a_venir')
    expect(juge('')).toBeNull()
    expect(juge('05/12/2025')).toBeNull()
  })
})

// ── Les cas de l'essai : le module rend, pour chacun, ce que la base a rendu ─────────────────────────────────────────
const ESSAI = readFileSync(new URL('../../supabase/essais/factures.sql', import.meta.url), 'utf8')

/** Le message que l'essai attend de la base, la migration appliquée, pour l'étape `id` : `case when correction then '…'`. */
function messageAttendu(id: string, demain: string, aujourdhui: string): string {
  const debut = ESSAI.indexOf(`array['controle', '${id}. `)
  expect(debut, `l’étape ${id} de l’essai`).toBeGreaterThan(0)
  const suite = ESSAI.slice(debut, ESSAI.indexOf("array['", debut + 10))
  expect(suite).toContain("case when correction then '22023' else 'OK' end")
  const m = /case when correction then ((?:'(?:[^']|'')*'|\s*\|\|\s*|to_char\((?:demain|aujourdhui), 'DD\/MM\/YYYY'\))+) else '' end\]/.exec(suite)
  expect(m, `le message attendu de l’étape ${id}`).not.toBeNull()
  const enClair = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`
  return [...(m as RegExpExecArray)[1].matchAll(/'((?:[^']|'')*)'|to_char\((demain|aujourdhui), 'DD\/MM\/YYYY'\)/g)]
    .map((x) => (x[2] === 'demain' ? enClair(demain) : x[2] === 'aujourdhui' ? enClair(aujourdhui) : x[1].replace(/''/g, "'")))
    .join('')
}

// Les dossiers de l'essai, tels qu'il les pose : K redevable, F en franchise, E exonéré pour ses soins, N sans statut, S
// exonéré sans article et V sans statut (où valide le client « Ventes »).
const AUJOURDHUI = '2026-10-31'
const DEMAIN = '2026-11-01'
const SERIE_K = [{ numero: 'F2025-0001', date_emission: '2025-12-05', statut: 'validee' as const },
  { numero: 'A2025-0001', date_emission: '2025-12-06', statut: 'validee' as const }]
const base = (o: Partial<ValidationAJuger>): ValidationAJuger => ({
  type: 'facture', dateEmission: '2026-03-02', aujourdhui: AUJOURDHUI, factures: [], statutTva: 'redevable',
  articleExoneration: null, cabinet: true, mentionsLegales: null, ...o,
})
// La facture de V, telle que l'essai la fait valider (107, M107, M107b) ; la restaurée qui la précède dans sa série.
const FACTURE_V: Partial<ValidationAJuger> = {
  dateEmission: '2026-03-10', mentionsLegales: MENTION_FRANCHISE,
  factures: [{ numero: 'F2026-0001', date_emission: '2026-02-01', statut: 'validee' }],
}
const REFUSES: [string, ValidationAJuger][] = [
  ['107', base({ ...FACTURE_V, statutTva: null, cabinet: false, factures: [] })],
  ['108', base({ statutTva: 'exonere', cabinet: false, dateEmission: '2026-03-10' })],
  ['109', base({ statutTva: 'franchise', mentionsLegales: 'Paiement à réception.' })],
  ['110', base({ statutTva: 'exonere', articleExoneration: 'cgi_261_4_1', mentionsLegales: 'Exonération de TVA, art. 261, 4, 4° a du CGI.' })],
  ['110b', base({ statutTva: 'exonere', articleExoneration: 'cgi_261_4_1', mentionsLegales: 'Exonération de TVA, art. 261, 4, 1° du CGI' })],
  ['111', base({ type: 'avoir', statutTva: 'franchise', dateEmission: '2026-03-05' })],
  ['112', base({ dateEmission: DEMAIN })],
  ['113', base({ dateEmission: '2025-12-02', factures: SERIE_K })],
  ['114', base({ type: 'avoir', dateEmission: '2025-12-05', factures: SERIE_K })],
]
const ACCEPTES: [string, ValidationAJuger][] = [
  ['M107', base({ ...FACTURE_V, statutTva: null, cabinet: true, factures: [] })],
  ['107a', base({ statutTva: null, cabinet: true })],
  ['107c', base({ type: 'avoir', statutTva: null, cabinet: false, dateEmission: '2026-02-05' })],
  ['M107b', base({ ...FACTURE_V, statutTva: 'franchise', cabinet: false })],
  ['M108', base({ statutTva: 'exonere', cabinet: true, dateEmission: '2026-03-10' })],
  ['M109', base({ statutTva: 'franchise', mentionsLegales: 'Paiement à réception. TVA non applicable, art. 293 B du CGI. Merci.' })],
  ['M110', base({ statutTva: 'exonere', articleExoneration: 'cgi_261_4_1', mentionsLegales: 'Exonération de TVA, art. 261, 4, 1° du CGI.' })],
  ['M111', base({ type: 'avoir', statutTva: 'franchise', dateEmission: '2026-03-05', mentionsLegales: MENTION_FRANCHISE })],
  ['111b', base({ statutTva: 'redevable' })],
  ['M112', base({ dateEmission: AUJOURDHUI })],
  ['M113', base({ dateEmission: '2025-12-05', factures: SERIE_K })],
  ['113b', base({ dateEmission: '2024-12-02', factures: SERIE_K })],
  ['M114', base({ type: 'avoir', dateEmission: '2025-12-06', factures: SERIE_K })],
]

describe('le module rejoue les cas de l’essai de la base (factures.sql, 107 à 114)', () => {
  it.each(REFUSES)('%s : le refus que la base a rendu, sous ses mots', (id, cas) => {
    const r = refusDeLaValidation(cas)
    expect(r?.code).toBe('22023')
    expect(correspondAuModele(r?.message ?? '', messageAttendu(id, DEMAIN, AUJOURDHUI)) || r?.message === messageAttendu(id, DEMAIN, AUJOURDHUI),
      `${id} : ${r?.message}`).toBe(true)
  })

  it.each(ACCEPTES)('%s : la base l’a laissé valider, le module aussi', (id, cas) => {
    expect(refusDeLaValidation(cas), id).toBeNull()
    expect(ESSAI).toContain(`array['controle', '${id}. `)
  })

  it('l’ordre, quand plusieurs refus se rencontrent : celui de la base', () => {
    // Un statut à préciser et une date à venir : le statut d'abord, pour le client ; pour le cabinet, qui valide encore
    // (FACTURE-Q1), la date.
    expect(refusDeLaValidation(base({ statutTva: null, cabinet: false, dateEmission: DEMAIN }))?.cle).toBe('statut_tva_a_preciser')
    expect(refusDeLaValidation(base({ statutTva: null, cabinet: true, dateEmission: DEMAIN }))?.cle).toBe('date_a_venir')
    // Un article manquant (client) et une date d'avant la série : l'article d'abord.
    expect(refusDeLaValidation(base({ statutTva: 'exonere', cabinet: false, dateEmission: '2025-12-01', factures: SERIE_K }))?.cle)
      .toBe('article_a_choisir')
    // La mention absente et une date à venir : la mention d'abord.
    expect(refusDeLaValidation(base({ statutTva: 'franchise', dateEmission: DEMAIN }))?.cle).toBe('mention_tva_absente')
    // Une date à venir passe avant la série (une date à venir n'est jamais d'avant la dernière : la dernière n'est pas à venir).
    expect(refusDeLaValidation(base({ dateEmission: DEMAIN, factures: SERIE_K }))?.cle).toBe('date_a_venir')
    // Les clés du module, dans l'ordre de leurs rangs.
    expect(REFUS_DE_LA_VALIDATION.map((r) => r.cle))
      .toEqual(['statut_tva_a_preciser', 'article_a_choisir', 'mention_tva_absente', 'date_a_venir', 'date_avant_la_derniere'])
  })

  it('un avoir n’est jugé ni sur le statut à préciser ni sur l’article : la voie de la correction reste ouverte', () => {
    for (const cabinet of [true, false]) {
      expect(refusDeLaValidation(base({ type: 'avoir', statutTva: null, cabinet }))).toBeNull()
      expect(refusDeLaValidation(base({ type: 'avoir', statutTva: 'exonere', cabinet }))).toBeNull()
    }
  })
})

// ── FACTURE-Q1 (la réponse du cabinet du 02/11/2026, contre la recommandation) et FACTURE-Q2 : les deux refus qui dépendent
// de l'auteur, dits avant le clic selon l'espace ───────────────────────────────────────────────────────────────────────
describe('le statut de TVA à préciser et l’article manquant : refusés au seul accès « Ventes », dits au cabinet', () => {
  const STATUTS: (StatutTva | null)[] = [null, 'redevable', 'franchise', 'exonere']
  const ARTICLES: (ArticleExoneration | null)[] = [null, ...EXONERATIONS.map((e) => e.code)]

  it('le client : une facture sans statut, ou exonérée sans article, se refuse sous les mots de la base ; rien d’autre', () => {
    for (const statutTva of STATUTS) {
      for (const articleExoneration of ARTICLES) {
        const r = refusDuStatutDeTva({ type: 'facture', statutTva, articleExoneration, cabinet: false })
        const attendu = statutTva == null ? 'statut_tva_a_preciser'
          : statutTva === 'exonere' && articleExoneration == null ? 'article_a_choisir' : null
        expect(r?.cle ?? null, `${statutTva} ${articleExoneration}`).toBe(attendu)
        if (r) expect(r).toEqual({ cle: attendu, code: '22023', message: REFUS_DE_LA_VALIDATION.find((x) => x.cle === attendu)?.modele })
      }
    }
  })

  it('le cabinet : aucun de ces refus, et l’avis qui dit ce qu’un accès « Ventes » ne validerait pas', () => {
    for (const statutTva of STATUTS) {
      for (const articleExoneration of ARTICLES) {
        const v = { type: 'facture' as const, statutTva, articleExoneration }
        expect(refusDuStatutDeTva({ ...v, cabinet: true })).toBeNull()
        const avis = avisDuStatutDeTva({ ...v, cabinet: true })
        const client = refusDuStatutDeTva({ ...v, cabinet: false })
        expect(avis, `${statutTva} ${articleExoneration}`).toBe(client === null ? null
          : client.cle === 'statut_tva_a_preciser' ? AVIS_STATUT_A_PRECISER : AVIS_ARTICLE_A_CHOISIR)
        // Au client, jamais d'avis : le refus le dit.
        expect(avisDuStatutDeTva({ ...v, cabinet: false })).toBeNull()
      }
    }
  })

  it('un avoir : ni refus ni avis, dans aucun espace', () => {
    for (const cabinet of [true, false]) {
      for (const statutTva of STATUTS) {
        expect(refusDuStatutDeTva({ type: 'avoir', statutTva, articleExoneration: null, cabinet })).toBeNull()
        expect(avisDuStatutDeTva({ type: 'avoir', statutTva, articleExoneration: null, cabinet })).toBeNull()
      }
    }
  })

  it('le premier refus de la validation est celui-là, quand il s’applique', () => {
    expect(refusDeLaValidation(base({ statutTva: null, cabinet: false }))).toEqual(
      refusDuStatutDeTva({ type: 'facture', statutTva: null, articleExoneration: null, cabinet: false }))
    expect(refusDeLaValidation(base({ statutTva: null, cabinet: true }))).toBeNull()
    expect(refusDeLaValidation(base({ statutTva: 'exonere', cabinet: true }))).toBeNull()
  })

  it('ce que le client lit — les cinq refus, ceux de la base et ceux du formulaire — ne renvoie à aucun onglet du cabinet', () => {
    for (const r of REFUS_DE_LA_VALIDATION) {
      const texte = r.modele.replace(/%/g, 'F2026-0001')
      expect(motsDuCabinet(pourLEspace('client', texte)), r.cle).toEqual([])
    }
    // Les deux que seul un accès « Ventes » reçoit se disent tutoyés, avec la phrase de la conception.
    for (const cle of ['statut_tva_a_preciser', 'article_a_choisir'] as const) {
      const modele = REFUS_DE_LA_VALIDATION.find((r) => r.cle === cle)?.modele as string
      expect(pourLEspace('client', modele), cle).toMatch(/^(Ton cabinet doit d’abord préciser ton statut de TVA|Ta société est exonérée)/)
      expect(pourLEspace('cabinet', modele)).toBe(modele)
    }
  })
})

describe('le retour arrière rend les deux fonctions de l’export, sous sa garde de tête', () => {
  it('sa garde exige les corps que la migration pose, puis il redonne ceux d’hier au caractère près', () => {
    const retour = leRetour()
    const premiere = retour.indexOf('create or replace function')
    for (const nom of ['centimes_ligne_facture', GARDE]) {
      const empreinte = md5(corps(definitionDans(laMigration().texte, nom)))
      expect(retour.indexOf(`'${empreinte}')`), nom).toBeGreaterThan(0)
      expect(retour.indexOf(`'${empreinte}')`), nom).toBeLessThan(premiere)
      expect(uneDefinition(definitionDans(retour, nom)), nom).toBe(uneDefinition(avantLaMigration(nom).definition))
    }
    const instructions = retour.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n')
    for (const interdit of [/\bdrop\b/i, /\btruncate\b/i, /\bgrant\b/i, /\brevoke\b/i, /\bdelete\s+from\b/i, /\balter\s+table\b/i]) {
      expect(instructions, String(interdit)).not.toMatch(interdit)
    }
  })
})

// ── L'ADRESSE DU CLIENT (JJ-Q4) ET LA LIGNE À 0 % D'UN REDEVABLE (A7C-Q1) ──────────────────────────────────────────
// Les deux refus du déclencheur `factures_emises_figees_mentions` (migration `adresse_du_client_exigee`, préparée le
// 07/11/2026, en production depuis le 08/11/2026), CONFRONTÉS AU TEXTE DE SA MIGRATION, où qu'elle soit — préparée hier,
// dans l'export depuis son application —, à son retour, à la garde qu'il suit, et rejoués sur les cas de son essai
// (supabase/essais/adresseDuClientExigee.sql) tels que la réplique y a répondu.
const MIGRATION_ADRESSE = /\/\d{14}_adresse_du_client_exigee\.sql$/
const RETOUR_ADRESSE = /^\d{14}_retour_adresse_du_client_exigee\.sql$/
const ESSAI_ADRESSE = new URL('../../supabase/essais/adresseDuClientExigee.sql', import.meta.url)
const FONCTION = 'garder_mentions_a_la_validation'
const DECLENCHEUR = 'factures_emises_figees_mentions'

function laMigrationDeLAdresse(): { chemin: string; texte: string; dansLExport: boolean } {
  const preparees = fichiersPrepares().filter((x) => MIGRATION_ADRESSE.test(x.chemin))
  const exportees = fichiersDuSchema().filter((x) => MIGRATION_ADRESSE.test(x.chemin))
  expect([...preparees, ...exportees].map((f) => f.chemin), 'la migration adresse_du_client_exigee, une fois').toHaveLength(1)
  return { ...[...preparees, ...exportees][0], dansLExport: exportees.length === 1 }
}

// La fonction du déclencheur : de son `create function` au `$$;` qui la ferme ; son corps, ce que `prosrc` garde.
function laFonctionDeLAdresse(texte: string): { definition: string; corps: string } {
  const debut = texte.indexOf(`create function public.${FONCTION}(`)
  expect(debut, `la définition de ${FONCTION}`).toBeGreaterThanOrEqual(0)
  const definition = texte.slice(debut, texte.indexOf('$$;', debut))
  return { definition, corps: definition.slice(definition.indexOf('as $$') + 'as $$'.length) }
}

const blancsDe = (texte: string) => (texte.match(/v_blancs constant text := ([\s\S]*?);/)?.[1] ?? '').replace(/\s+/g, ' ')

describe('l’adresse du client (JJ-Q4) et la ligne à 0 % (A7C-Q1) : le module redit les refus de la migration', () => {
  it('deux refus, au caractère près, en 22023, dans l’ordre du module ; leurs conditions sur les valeurs que la facture fige', () => {
    const { definition } = laFonctionDeLAdresse(laMigrationDeLAdresse().texte)
    expect(messagesSql(definition)).toEqual([REFUS_ADRESSE_DU_CLIENT.modele, REFUS_LIGNE_A_ZERO.modele])
    expect(codesSql(definition)).toEqual([REFUS_ADRESSE_DU_CLIENT.code, REFUS_LIGNE_A_ZERO.code])
    expect([REFUS_ADRESSE_DU_CLIENT.rang, REFUS_LIGNE_A_ZERO.rang]).toEqual([19, 20])
    // Un avoir suit sa facture ; le type de client, l'adresse, le statut et l'article de la ligne qui se valide, jamais la
    // fiche du contact ni le dossier vivant ; le régime d'e7a lu sans exiger sa colonne.
    expect(definition).toContain("if new.type <> 'facture' then\n    return new;\n  end if;")
    expect(definition).toContain("if new.type_client in ('assujetti', 'organisme_public')\n     and btrim(coalesce(new.tiers_adresse, ''), v_blancs) = '' then")
    expect(definition).toContain("if new.statut_tva = 'redevable' and new.article_exoneration is null\n"
      + "     and coalesce(to_jsonb(new) ->> 'regime_international', 'taxable_en_france') = 'taxable_en_france'\n"
      + '     and exists (select 1 from public.facture_lignes l where l.facture_id = new.id and l.taux_tva = 0) then')
    expect(definition).not.toMatch(/\bcontacts\b|\bdossiers\b/)
    expect(definition.indexOf('L\'\'adresse du client manque')).toBeLessThan(definition.indexOf('Une ligne est au taux 0'))
    // DEFINER, comme la garde, pour lire les lignes quelle que soit la RLS de l'appelant.
    expect(definition).toMatch(/language plpgsql\nsecurity definer\nset search_path = public\nas \$\$/)
  })

  it('ses blancs sont ceux d’enregistrer_facture, que `trim` retire', () => {
    const { definition } = laFonctionDeLAdresse(laMigrationDeLAdresse().texte)
    // La dernière définition d'`enregistrer_facture` dans l'export (une migration collée l'écrit en capitales).
    const motif = /create or replace function public\.enregistrer_facture\(/gi
    const exportes = fichiersDuSchema().filter((f) => new RegExp(motif.source, 'i').test(f.texte))
    expect(exportes.length, 'enregistrer_facture, dans l’export').toBeGreaterThan(0)
    const texte = exportes[exportes.length - 1].texte
    const derniere = texte.slice([...texte.matchAll(motif)].pop()?.index as number)
    expect(blancsDe(derniere), 'les blancs d’enregistrer_facture').toMatch(/^chr\(9\)/)
    expect(blancsDe(definition)).toBe(blancsDe(derniere))
    // Le même ensemble que `String.prototype.trim` : chaque blanc de la base se retire, un caractère visible reste.
    const codes = [...blancsDe(definition).matchAll(/chr\((\d+)\)/g)].map((m) => Number(m[1]))
    expect(codes).toHaveLength(25)
    for (const c of codes) expect(String.fromCodePoint(c).trim(), String(c)).toBe('')
    for (const c of [0x200b, 0x2d, 0x5f]) expect(String.fromCodePoint(c).trim(), String(c)).not.toBe('')
  })

  it('le régime qui exempte la ligne à 0 % est celui que lib/factureInternationale.ts dit hors de la TVA française', () => {
    const regimes: (RegimeInternational | null)[] = [null, ...REGIMES_INTERNATIONAUX]
    for (const regime of regimes) {
      const juge = refusDeLaLigneAZero({ type: 'facture', statutTva: 'redevable', articleExoneration: null, regimeInternational: regime, tauxDesLignes: [0] })
      // La base : exemptée quand le régime, ou « taxable_en_france » à défaut, n'est pas « taxable_en_france ».
      expect(juge === null, String(regime)).toBe((regime ?? 'taxable_en_france') !== 'taxable_en_france')
      expect(juge === null, String(regime)).toBe(horsDeLaTvaFrancaise(regime))
    }
  })

  it('son déclencheur suit la garde des factures dans l’ordre des noms, au seul passage à « validée »', () => {
    const { texte } = laMigrationDeLAdresse()
    const declencheur = texte.match(new RegExp(`create trigger (\\w+)\\s+before update on public\\.factures_emises\\s+for each row\\s+when \\(([^\\n]*)\\)\\s+execute function public\\.${FONCTION}\\(\\);`))
    expect(declencheur, 'le déclencheur, avant la mise à jour, ligne').not.toBeNull()
    const [, nom, quand] = declencheur as RegExpMatchArray
    expect(nom).toBe(DECLENCHEUR)
    expect(quand).toBe("new.statut = 'validee' and old.statut is distinct from 'validee'")
    // Le nom de la garde en est le début : il la suit, avant la marque d'acompte et la source de la vente.
    expect(nom.startsWith('factures_emises_figees_')).toBe(true)
    const ordre = ['factures_emises_figees', nom, 'factures_emises_marque_d_acompte', 'factures_emises_source_de_la_vente']
    expect([...ordre].sort()).toEqual(ordre)
    // Personne n'exécute la fonction ; la migration ne porte aucun mot de retrait (elle s'applique par l'outil).
    expect(texte).toContain(`revoke execute on function public.${FONCTION}() from public, anon, authenticated;`)
    expect(texte).not.toMatch(/\b(delete|drop|truncate)\b|attisdropped/i)
  })

  it('le retour retire ce que la migration pose, sous sa garde, à l’empreinte de la fonction', () => {
    const dossier = new URL('../../supabase/preparees/retour/', import.meta.url).pathname
    const nom = readdirSync(dossier).find((n) => RETOUR_ADRESSE.test(n))
    expect(nom, 'le retour de adresse_du_client_exigee').toBeDefined()
    const retour = readFileSync(dossier + nom, 'utf8')
    const empreinte = md5(laFonctionDeLAdresse(laMigrationDeLAdresse().texte).corps)
    const garde = retour.indexOf(`is distinct from '${empreinte}' then`)
    expect(garde, 'l’empreinte du corps posé').toBeGreaterThan(0)
    expect(retour.indexOf(`drop trigger ${DECLENCHEUR} on public.factures_emises;`)).toBeGreaterThan(garde)
    expect(retour.indexOf(`drop function public.${FONCTION}();`)).toBeGreaterThan(garde)
  })

  it('le drapeau suit la migration : baissé tant qu’elle n’est que préparée, levé quand elle entre dans l’export', () => {
    expect(ADRESSE_DU_CLIENT_EXIGEE).toBe(laMigrationDeLAdresse().dansLExport)
  })

  // Les cas de l'essai, tels que la réplique y a répondu le 07/11/2026 (la migration appliquée) : refusé, ou validé.
  const CAS_DE_L_ADRESSE: [string, AdresseDuClientAJuger, boolean][] = [
    ['10', { type: 'facture', typeClient: 'assujetti', tiersAdresse: null }, true],
    ['M10', { type: 'facture', typeClient: 'assujetti', tiersAdresse: '5 avenue de l Essai, 69001 Lyon' }, false],
    ['11', { type: 'facture', typeClient: 'assujetti', tiersAdresse: ' \t\n  ' }, true],
    ['12', { type: 'facture', typeClient: 'organisme_public', tiersAdresse: null }, true],
    ['M12', { type: 'facture', typeClient: 'organisme_public', tiersAdresse: '5 avenue de l Essai, 69001 Lyon' }, false],
    ['20', { type: 'facture', typeClient: 'non_assujetti', tiersAdresse: null }, false],
    ['22', { type: 'facture', typeClient: 'etranger', tiersAdresse: null }, false],
    ['23', { type: 'facture', typeClient: null, tiersAdresse: null }, false],
    ['24', { type: 'avoir', typeClient: 'assujetti', tiersAdresse: null }, false],
  ]
  it.each(CAS_DE_L_ADRESSE)('le cas %s de l’essai (l’adresse)', (num, cas, refuse) => {
    expect(readFileSync(ESSAI_ADRESSE, 'utf8'), `le contrôle ${num} dans l’essai`).toContain(`('${num}', `)
    const r = refusDeLAdresseDuClient(cas)
    expect(r !== null, num).toBe(refuse)
    if (r) expect(r).toEqual({ cle: 'adresse_du_client', code: '22023', message: REFUS_ADRESSE_DU_CLIENT.modele })
  })

  const ligne = (v: Partial<LigneAZeroAJuger>): LigneAZeroAJuger => ({
    type: 'facture', statutTva: 'redevable', articleExoneration: null, regimeInternational: null, tauxDesLignes: [0], ...v,
  })
  const CAS_DE_LA_LIGNE: [string, LigneAZeroAJuger, boolean][] = [
    ['40', ligne({}), true],
    ['M40', ligne({ tauxDesLignes: [20] }), false],
    ['41', ligne({ articleExoneration: 'cgi_261_4_4_a' }), false],
    ['42', ligne({ statutTva: 'franchise' }), false],
    ['43', ligne({ statutTva: 'exonere', articleExoneration: 'cgi_261_4_1' }), false],
    ['44', ligne({ regimeInternational: 'autoliquidation_ue' }), false],
    ['45', ligne({ regimeInternational: 'taxable_en_france' }), true],
    ['46', ligne({}), true],
  ]
  it.each(CAS_DE_LA_LIGNE)('le cas %s de l’essai (la ligne à 0 %%)', (num, cas, refuse) => {
    expect(readFileSync(ESSAI_ADRESSE, 'utf8'), `le contrôle ${num} dans l’essai`).toContain(`('${num}', `)
    const r = refusDeLaLigneAZero(cas)
    expect(r !== null, num).toBe(refuse)
    if (r) expect(r).toEqual({ cle: 'ligne_a_zero', code: '22023', message: REFUS_LIGNE_A_ZERO.modele })
  })

  it('un avoir, un statut à préciser : la ligne à 0 % ne se juge pas ; parmi d’autres taux, elle se juge', () => {
    expect(refusDeLaLigneAZero(ligne({ tauxDesLignes: [20, 0] }))?.cle).toBe('ligne_a_zero')
    expect(refusDeLaLigneAZero(ligne({ type: 'avoir' }))).toBeNull()
    expect(refusDeLaLigneAZero(ligne({ statutTva: null }))).toBeNull()
    expect(refusDeLaLigneAZero(ligne({ tauxDesLignes: [] }))).toBeNull()
  })

  it('l’essai attend les messages du module, mot pour mot', () => {
    const essai = readFileSync(ESSAI_ADRESSE, 'utf8')
    expect(essai).toContain(`'22023', '${REFUS_ADRESSE_DU_CLIENT.modele.replace(/'/g, "''")}'`)
    expect(essai).toContain(`'22023', '${REFUS_LIGNE_A_ZERO.modele.replace(/'/g, "''")}'`)
  })
})
