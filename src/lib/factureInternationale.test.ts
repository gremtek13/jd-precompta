import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { codesSql, messagesSql } from '../test/raiseSql'
import { fichiersDuSchema, fichiersPrepares } from '../test/schema'
import {
  ETATS_MEMBRES, FACTURE_INTERNATIONALE_EXPORTEE, FORME_DU_NUMERO_DE_TVA, FORME_DU_PAYS, LIBELLES_DES_REGIMES,
  MENTIONS_DES_REGIMES, PAYS_ATTRIBUES, PAYS_QUI_NE_SONT_PAS_ETRANGERS, REFUS_DE_LA_FACTURE_INTERNATIONALE as R,
  REFUS_DE_LA_MENTION_DU_DOSSIER, REGIMES_INTERNATIONAUX, categorieEreporting, categorieTvaDuRegime, mentionDuDossierExigee,
  mentionDuRegime, refusDeLaFactureInternationale, refusDeLaForme, refusDeLaMentionDuDossier, type SaisieInternationale,
} from './factureInternationale'
import { MENTION_FRANCHISE } from './statutTva'

// LA FACTURE À UN CLIENT ÉTABLI HORS DE FRANCE (ligne 28.5, étape e7a), CONFRONTÉE AU TEXTE DE SA MIGRATION ET À SON
// ESSAI. La migration (supabase/preparees/20261107120000_facture_internationale.sql, PRÉPARÉE, PAS APPLIQUÉE) recopie
// `enregistrer_facture` et la garde des factures de l'export au caractère près et n'y ajoute que les lignes d'E7a ; ce
// garde le vérifie, relit les mots, les codes, les listes, les formes et les mentions que le module redit, et rejoue sur
// le module chaque cas de l'essai (supabase/essais/factureInternationale.sql) tel que la base y a répondu, le 07/11/2026,
// sur une copie de la réplique mère. Le récit : HISTORIQUE.md, « LA FACTURE À UN CLIENT ÉTABLI HORS DE FRANCE, EN BASE
// (E7A, LIGNE 28.5) (PRÉPARÉE, PAS APPLIQUÉE) ». Données FICTIVES.

const md5 = (texte: string) => createHash('md5').update(texte, 'utf8').digest('hex')
const racine = new URL('../../', import.meta.url).pathname
const lire = (chemin: string) => readFileSync(racine + chemin, 'utf8')

// La migration, où qu'elle soit : préparée aujourd'hui, dans l'export le jour de son application.
function laMigration(): string {
  const trouvees = [...fichiersPrepares(), ...fichiersDuSchema()].filter((f) => /\/\d{14}_facture_internationale\.sql$/.test(f.chemin))
  expect(trouvees.map((f) => f.chemin), 'la migration facture_internationale, une fois').toHaveLength(1)
  return trouvees[0].texte
}

// Une fonction d'un texte SQL : sa définition entière, du `create or replace function` (en capitales dans l'export
// d'`enregistrer_facture`) à son délimiteur fermant, et son corps.
function fonction(texte: string, nom: string): { definition: string; corps: string } {
  const m = new RegExp(`create or replace function public\\.${nom}\\(`, 'i').exec(texte)
  if (!m) throw new Error(`${nom} introuvable`)
  const dollar = texte.slice(m.index).match(/\bas (\$[a-z_]*\$)/i) as RegExpMatchArray
  const ouverture = m.index + (dollar.index as number) + dollar[0].length
  const fin = texte.indexOf(dollar[1] + ';', ouverture)
  return { definition: texte.slice(m.index, fin + dollar[1].length + 1), corps: texte.slice(ouverture, fin) }
}

// Les lignes qu'un texte ajoute à un autre, qu'il recopie dans l'ordre : une ligne recopiée peut gagner une virgule (une
// colonne ajoutée après elle), et la mention de TVA du dossier y gagne sa condition d'E7a.
function ajouts(exporte: string, migre: string): string[] {
  const a = exporte.split('\n')
  const extras: string[] = []
  let i = 0
  for (const ligne of migre.split('\n')) {
    const attendue = a[i]
    if (i < a.length && (ligne === attendue || ligne === attendue + ','
      || ligne === attendue.replace('v_mention is not null and strpos', 'v_mention is not null and not v_hors_tva and strpos'))) i++
    else extras.push(ligne)
  }
  expect(i, "chaque ligne de l'export, dans l'ordre").toBe(a.length)
  return extras
}

const MIGRATION = laMigration()
const RETOUR = lire('supabase/preparees/retour/20261107120100_retour_facture_internationale.sql')
const EXPORT_EF = fonction(lire('supabase/schema/20261105231034_acomptes_des_devis.sql'), 'enregistrer_facture')
const EXPORT_GARDE = fonction(lire('supabase/schema/20261102112003_facture_dates_centimes_mention_tva.sql'), 'garder_factures_validees')
const EF = fonction(MIGRATION, 'enregistrer_facture')
const GARDE = fonction(MIGRATION, 'garder_factures_validees')
const BLOC = GARDE.corps.slice(GARDE.corps.indexOf('-- ── DÉBUT E7A ──'), GARDE.corps.indexOf('-- ── FIN E7A ──'))
const listeSql = (texte: string, nom: string) =>
  [...(new RegExp(`${nom} constant text\\[\\] := array\\[([^\\]]*)\\]`).exec(texte) as RegExpExecArray)[1].matchAll(/'([A-Z]{2})'/g)].map((m) => m[1])

describe('la migration facture_internationale, confrontée à l’export', () => {
  it('sa garde de tête vérifie les deux corps de l’export à leur empreinte', () => {
    expect([...MIGRATION.matchAll(/is distinct from '([0-9a-f]{32})'/g)].map((m) => m[1]))
      .toEqual([md5(EXPORT_EF.corps), md5(EXPORT_GARDE.corps)])
  })

  it('enregistrer_facture recopie l’export et n’y ajoute que ses seize lignes', () => {
    const extras = ajouts(EXPORT_EF.definition, EF.definition)
    expect(extras).toHaveLength(16)
    expect(extras.filter((l) => !/client_pays|client_numero_tva|regime_international|E7a|l'opération telle/.test(l))).toEqual([])
  })

  it('la garde recopie l’export et n’y ajoute que ses déclarations, son bloc et la mention selon le régime', () => {
    const declare = new Set(GARDE.corps.slice(GARDE.corps.indexOf('  -- E7a (07/11/2026)'), GARDE.corps.indexOf('\nbegin')).split('\n'))
    const bloc = new Set(GARDE.corps.slice(GARDE.corps.indexOf('      -- ── DÉBUT E7A ──'), GARDE.corps.indexOf('      -- ── FIN E7A ──') + 30).split('\n'))
    const restants = ajouts(EXPORT_GARDE.definition, GARDE.definition).filter((l) => !declare.has(l) && !bloc.has(l))
    // Trois lignes de commentaire, `v_hors_tva`, et le refus de la mention du dossier (son `end if;` a la forme d'une ligne
    // du bloc, qui le compte) : sept.
    expect(restants).toHaveLength(7)
    expect(restants.filter((l) => /v_hors_tva|E7a|au régime|jamais celle du dossier|raise exception 'Les mentions légales portent|v_mention, v_regime_lu/.test(l))).toHaveLength(7)
  })

  it('le retour reprend les deux fonctions de l’export au caractère près, puis retire les trois colonnes', () => {
    expect(fonction(RETOUR, 'enregistrer_facture').definition).toBe(EXPORT_EF.definition)
    expect(fonction(RETOUR, 'garder_factures_validees').definition).toBe(EXPORT_GARDE.definition)
    expect(RETOUR).toMatch(/drop column client_pays,\n {2}drop column client_numero_tva,\n {2}drop column regime_international;/)
  })

  it('les quinze refus du bloc, dans l’ordre et sous les mots du module, tous en 22023', () => {
    expect(messagesSql(BLOC)).toEqual([...R])
    expect(codesSql(BLOC)).toEqual(Array(15).fill('22023'))
    const apres = GARDE.corps.slice(GARDE.corps.indexOf('-- ── FIN E7A ──'))
    expect(messagesSql(apres)).toContain(REFUS_DE_LA_MENTION_DU_DOSSIER)
    expect(messagesSql(GARDE.corps).filter((m) => m.startsWith('Les mentions légales ne portent pas la mention de TVA du dossier'))).toHaveLength(1)
  })

  it('les pays, l’Union, les formes, les régimes, leurs libellés et leurs mentions', () => {
    expect(listeSql(GARDE.corps, 'v_pays_iso')).toEqual([...PAYS_ATTRIBUES])
    expect(listeSql(GARDE.corps, 'v_union')).toEqual([...ETATS_MEMBRES])
    const horsDeFrance = lire('supabase/schema/20261010081009_pieces_hors_de_france.sql')
    expect(listeSql(horsDeFrance, 'c_pays')).toEqual([...PAYS_ATTRIBUES])
    expect(listeSql(horsDeFrance, 'c_union')).toEqual([...ETATS_MEMBRES])
    const exclus = /client_pays not in \(([^)]*)\)/.exec(MIGRATION) as RegExpExecArray
    expect([...exclus[1].matchAll(/'([A-Z]{2})'/g)].map((m) => m[1])).toEqual([...PAYS_QUI_NE_SONT_PAS_ETRANGERS])
    expect(MIGRATION).toContain(`check (client_pays ~ '${FORME_DU_PAYS.source}'`)
    expect(MIGRATION).toContain(`check (client_numero_tva ~ '${FORME_DU_NUMERO_DE_TVA.source}')`)
    const regimes = /check \(regime_international in \(([^)]*)\)\)/.exec(MIGRATION) as RegExpExecArray
    expect([...regimes[1].matchAll(/'(\w+)'/g)].map((m) => m[1])).toEqual([...REGIMES_INTERNATIONAUX])
    const lus = BLOC.slice(BLOC.indexOf('v_regime_lu := case'), BLOC.indexOf('end;', BLOC.indexOf('v_regime_lu := case')))
    const libelles = Object.fromEntries([...lus.matchAll(/when '(\w+)' then '((?:[^']|'')*)'/g)].map((m) => [m[1], m[2].replace(/''/g, "'")]))
    expect(libelles).toEqual(LIBELLES_DES_REGIMES)
    const commentaire = (/comment on column public\.factures_emises\.regime_international is\n((?: {2}'(?:[^']|'')*'\n?)+);/.exec(MIGRATION) as RegExpExecArray)[1]
    const texte = [...commentaire.matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'")).join('')
    for (const r of REGIMES_INTERNATIONAUX) {
      const mention = MENTIONS_DES_REGIMES[r]
      expect(texte, r).toContain(mention == null ? `${r} : la mention de TVA du dossier` : `${r} : « ${mention} »`)
    }
  })

  it('le drapeau reste baissé tant que la migration est préparée', () => {
    const preparee = fichiersPrepares().some((f) => /_facture_internationale\.sql$/.test(f.chemin))
    expect(FACTURE_INTERNATIONALE_EXPORTEE).toBe(!preparee)
  })
})

describe('le module redit la garde : les cas de l’essai, tels que la base y a répondu', () => {
  const BASE: SaisieInternationale = {
    type: 'facture', typeClient: 'etranger', pays: 'DE', numeroTva: 'DE123456789', regime: 'autoliquidation_ue',
    nature: 'services', numeroTvaDuVendeur: 'FR32123456782', montantTva: 0, tauxDesLignes: [0],
  }
  const lu = 'La facture porte une autoliquidation par le client'
  const CAS: [string, Partial<SaisieInternationale>, string | null][] = [
    ['30', {}, null],
    ['32', { pays: null }, R[0]],
    ['33', { pays: 'XX', numeroTva: 'XX123456789' }, "Le pays du client, « XX », n'est pas un code de pays attribué (ISO 3166-1, deux lettres)."],
    ['34', { regime: null }, "Le client est établi hors de France (DE) : la facture dit le régime de l'opération, d'où vient la mention de TVA qu'elle imprime."],
    ['35', { typeClient: 'assujetti' }, R[3]],
    ['36', { pays: 'US', numeroTva: null, regime: 'hors_champ' }, R[4]],
    ['M36', { typeClient: 'non_assujetti', pays: 'US', numeroTva: null, regime: 'hors_champ' }, null],
    ['37', { typeClient: 'non_assujetti' }, `${lu}, qui ne se facture qu'à une entreprise (un assujetti), jamais à un particulier.`],
    ['38', { pays: 'US', numeroTva: 'US123456' }, `${lu}, qui vise un client établi dans un autre État membre de l'Union : « US » n'en est pas un.`],
    ['M38', { pays: 'US', numeroTva: 'US123456', regime: 'prestation_hors_ue' }, null],
    ['39', { regime: 'exportation', nature: 'biens' }, "La facture porte une exportation, qui vise un client établi hors de l'Union : « DE » en est un État membre."],
    ['M39', { regime: 'exportation', nature: 'biens', pays: 'CH', numeroTva: 'CHE123456789MWST' }, null],
    ['40', { regime: 'livraison_intracommunautaire' }, 'La facture porte une livraison intracommunautaire, une livraison de biens : sa nature est « biens ».'],
    ['M40', { regime: 'livraison_intracommunautaire', nature: 'biens' }, null],
    ['41', { nature: 'biens' }, `${lu}, une prestation de services : sa nature est « services ».`],
    ['42', { numeroTva: null }, `${lu}, qui exige le numéro de TVA du client (CGI, ann. II, art. 242 nonies A, I, 3° et 4°).`],
    ['43', { numeroTva: 'FR12345678901' }, 'Le numéro de TVA du client, « FR12345678901 », commence par le code de son pays, « DE » (norme EN 16931, règle BR-CO-09).'],
    ['44', { pays: 'GR', numeroTva: 'GR123456789' }, 'Le numéro de TVA du client, « GR123456789 », commence par le code de son pays, « EL » (norme EN 16931, règle BR-CO-09).'],
    ['M44', { pays: 'GR', numeroTva: 'EL123456789' }, null],
    ['45', { numeroTva: 'DE1234567890123' }, "Le numéro de TVA d'un client de l'Union tient en deux lettres suivies de deux à douze chiffres ou lettres : « DE1234567890123 » n'en a pas la forme."],
    ['46', { numeroTvaDuVendeur: null }, R[13].replace('%', 'une autoliquidation par le client')],
    ['47', { montantTva: 20, tauxDesLignes: [20] }, `${lu}, que la TVA française ne taxe pas : chaque ligne est au taux 0.`],
    ['48', { tauxDesLignes: [20] }, `${lu}, que la TVA française ne taxe pas : chaque ligne est au taux 0.`],
    ['52', { regime: 'taxable_en_france', numeroTva: null, tauxDesLignes: [20], montantTva: 20 }, null],
    ['53', { pays: null, numeroTva: null, regime: null }, null],
    ['60', { type: 'avoir', numeroTva: null }, null],
  ]
  it.each(CAS)('le cas %s', (_cas, ecart, attendu) => {
    expect(refusDeLaFactureInternationale({ ...BASE, ...ecart })).toBe(attendu)
  })

  it('la mention de TVA du dossier : refusée hors de la TVA française (50, 61), exigée sinon (52)', () => {
    expect(refusDeLaMentionDuDossier('autoliquidation_ue', MENTION_FRANCHISE, MENTION_FRANCHISE)).toBe(
      `Les mentions légales portent « ${MENTION_FRANCHISE} », la mention de TVA du dossier : elle ne vaut que pour une opération que la TVA française taxe, et la facture porte une autoliquidation par le client, qui imprime la sienne.`)
    expect(refusDeLaMentionDuDossier('autoliquidation_ue', MENTION_FRANCHISE, 'Escompte : néant.')).toBeNull()
    expect(refusDeLaMentionDuDossier('taxable_en_france', MENTION_FRANCHISE, MENTION_FRANCHISE)).toBeNull()
    expect(refusDeLaMentionDuDossier(null, MENTION_FRANCHISE, MENTION_FRANCHISE)).toBeNull()
    expect([null, 'taxable_en_france', 'hors_champ', 'exportation'].map((r) => mentionDuDossierExigee(r as never))).toEqual([true, true, false, false])
  })

  it('les formes que les contraintes refusent (10 à 13)', () => {
    expect(refusDeLaForme('FR', null)).toMatch(/^Le pays du client/)
    expect(refusDeLaForme('de', null)).toMatch(/^Le pays du client/)
    expect(refusDeLaForme('DE', 'DE 123456789')).toMatch(/^Le numéro de TVA du client/)
    expect(refusDeLaForme('DE', 'DE123456789')).toBeNull()
    expect(refusDeLaForme(null, null)).toBeNull()
  })
})

describe('ce que le régime décide : la mention imprimée, le CII et l’e-reporting', () => {
  it('la catégorie de TVA et le motif VATEX de chaque régime ; aucun pour une opération taxable en France', () => {
    expect(REGIMES_INTERNATIONAUX.map((r) => [r, categorieTvaDuRegime(r)?.categorie ?? null, categorieTvaDuRegime(r)?.vatex ?? null])).toEqual([
      ['autoliquidation_ue', 'AE', 'VATEX-EU-AE'], ['prestation_hors_ue', 'O', 'VATEX-EU-O'],
      ['livraison_intracommunautaire', 'K', 'VATEX-EU-IC'], ['exportation', 'G', 'VATEX-EU-G'],
      ['taxable_en_france', null, null], ['hors_champ', 'O', 'VATEX-EU-O'],
    ])
    for (const r of REGIMES_INTERNATIONAUX) expect(categorieTvaDuRegime(r)?.texte ?? null, r).toBe(mentionDuRegime(r))
    expect(mentionDuRegime('autoliquidation_ue')).toMatch(/^Autoliquidation/)
  })

  it('le bloc et la catégorie de l’e-reporting', () => {
    expect(categorieEreporting('autoliquidation_ue', 'etranger', 'services')).toEqual({ bloc: '10.1', categorieTva: 'AE' })
    expect(categorieEreporting('taxable_en_france', 'etranger', 'services')).toEqual({ bloc: '10.1', categorieTva: null })
    expect(categorieEreporting('hors_champ', 'non_assujetti', 'services')).toEqual({ bloc: '10.3', categorie: 'TNT1' })
    expect(categorieEreporting('taxable_en_france', 'non_assujetti', 'biens')).toEqual({ bloc: '10.3', categorie: 'TLB1' })
    expect(categorieEreporting('taxable_en_france', 'non_assujetti', 'services')).toEqual({ bloc: '10.3', categorie: 'TPS1' })
    expect(categorieEreporting('exportation', 'non_assujetti', 'biens')).toEqual({ bloc: '10.3', categorie: null })
    expect(categorieEreporting(null, 'etranger', 'services')).toBeNull()
    expect(categorieEreporting('autoliquidation_ue', 'assujetti', 'services')).toBeNull()
  })
})
