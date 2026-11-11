import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { definitionsSql } from '../test/schema'
import {
  HONORAIRES_FACTURES_PREVUS, REFUS_DE_LA_FACTURATION, TAUX_DES_HONORAIRES, centimesAuProrata, designationDeLElement,
  factureCrediteeEnEntier, joursDeVigueur, joursDuProrata, lettreEnVigueurLe, lienQuiCouvre, motsDuRefusDeLaFacturation,
  periodeCivile, periodeDeForfaitValide, periodeDeTacheValide, periodesAFacturer, periodesDuForfait, refusDeLElement,
  refusDeLaDemande, totauxDuBrouillon,
  type FactureDuCabinet, type LettreAFacturer, type LienDHonoraires, type LigneDHonoraires,
} from './honorairesAFacturer'

// « À FACTURER » (ligne 47, LM7) : le module redit la migration `honoraires_factures` — préparée le 11/11/2026, dans
// l'export le jour de son application — : les refus de `facturer_honoraires` puis de sa garde, dans leur ordre, à leurs mots
// (les apostrophes typographiques du module rendues droites, `%%` rendu `%`) et à leur code ; le retour retire tout ce
// qu'elle crée ; l'essai et rls.sql l'attendent ; les libellés sont ceux que l'essai lit en base.

function leFichier(motif: RegExp, dossiers: readonly string[]): string {
  const trouves: string[] = []
  for (const dossier of dossiers) {
    const chemin = new URL(dossier, import.meta.url).pathname
    if (!existsSync(chemin)) continue
    for (const nom of readdirSync(chemin)) if (motif.test(nom)) trouves.push(chemin + nom)
  }
  expect(trouves, String(motif)).toHaveLength(1)
  return readFileSync(trouves[0], 'utf8')
}

const MIGRATION = leFichier(/^\d{14}_honoraires_factures\.sql$/, ['../../supabase/preparees/', '../../supabase/schema/'])
const RETOUR = leFichier(/^\d{14}_retour_honoraires_factures\.sql$/, ['../../supabase/preparees/retour/'])
const ESSAI = readFileSync(new URL('../../supabase/essais/honorairesFactures.sql', import.meta.url), 'utf8')
const RLS = readFileSync(new URL('../../supabase/essais/rls.sql', import.meta.url), 'utf8')

const droit = (s: string) => s.replace(/’/g, "'")
function fonction(nom: string): string {
  const definitions = definitionsSql(nom, [{ chemin: 'honoraires_factures', texte: MIGRATION }])
  expect(definitions, nom).not.toHaveLength(0)
  return definitions[definitions.length - 1].definition
}
const refusSql = (sql: string) =>
  [...sql.matchAll(/raise exception '((?:[^']|'')*)'[\s\S]*?using errcode = '([0-9A-Z]{5})'/g)]
    .map((m) => ({ code: m[2], modele: m[1].replace(/''/g, "'").replace(/%%/g, '%') }))
const attendus = (liste: readonly { code: string; modele: string }[]) => liste.map((r) => ({ code: r.code, modele: droit(r.modele) }))

describe('la migration, redite', () => {
  it('le drapeau est baissé : la production n’a pas la table', () => {
    expect(HONORAIRES_FACTURES_PREVUS).toBe(false)
  })

  it('les refus de facturer_honoraires, dans leur ordre, puis celui de la garde quand les liens se posent', () => {
    const fonctionSql = refusSql(fonction('facturer_honoraires'))
    expect(fonctionSql).toEqual(attendus(REFUS_DE_LA_FACTURATION.slice(0, -1)))
    const garde = refusSql(fonction('garder_honoraires_factures'))
    expect(garde).toContainEqual(attendus(REFUS_DE_LA_FACTURATION.slice(-1))[0])
    expect(motsDuRefusDeLaFacturation('dejaFacturee')).toMatch(/^Cette période est déjà facturée/)
    expect(() => motsDuRefusDeLaFacturation('inconnu')).toThrow()
  })

  it('les taux, la lettre en vigueur et la facture créditée sont ceux de la base', () => {
    expect(fonction('facturer_honoraires')).toContain(`p_taux_tva not in (${[...TAUX_DES_HONORAIRES].sort((a, b) => a - b).join(', ')})`)
    const vigueur = fonction('lettre_en_vigueur_le')
    for (const morceau of ['l.acceptee_le is not null', 'l.date_effet <= p_jour', 'l.fin_au < p_jour', 'not l.reconduction_tacite',
      'l.fin_initiale < p_jour', 's.remplace_id = l.id', 's.acceptee_le is not null', 's.date_effet <= p_jour']) {
      expect(vigueur, morceau).toContain(morceau)
    }
    const creditee = fonction('facture_creditee_en_entier')
    for (const morceau of ["f.statut in ('validee', 'importee')", 'f.montant_ttc > 0', 'a.facture_origine_id = f.id',
      'ai.origine_id = f.id', '>= f.montant_ttc']) {
      expect(creditee, morceau).toContain(morceau)
    }
  })

  it('le retour retire la table et les neuf fonctions que la migration crée, et se refuse sous un lien', () => {
    const creees = [...MIGRATION.matchAll(/^create function public\.([a-z_]+)\(/gim)].map((m) => m[1]).sort()
    const retirees = [...RETOUR.matchAll(/^drop function public\.([a-z_]+)\(/gim)].map((m) => m[1]).sort()
    expect(creees).toHaveLength(9)
    expect(retirees).toEqual(creees)
    expect(RETOUR).toContain('drop table public.honoraires_factures;')
    expect(RETOUR).toContain('if exists (select 1 from public.honoraires_factures) then')
    expect(MIGRATION).not.toMatch(/\btruncate\b/i)
  })

  it('l’essai et rls.sql l’attendent, et se disent EN ATTENTE sans elle', () => {
    expect(ESSAI).toContain("if to_regclass('public.honoraires_factures') is null then")
    expect(ESSAI).toContain('EN ATTENTE de la migration honoraires_factures')
    expect(RLS).toContain('HF. les factures d\'\'honoraires : EN ATTENTE de la migration honoraires_factures')
    for (const controle of ['HF1.', 'HF2.', 'HF3.', 'HF4.', 'HF5.', 'HF6.', 'HF7.', 'M-HF2', 'M-HF5', 'M-HF7']) expect(RLS, controle).toContain(controle)
  })
})

describe('les périodes', () => {
  it('un mois, un trimestre, une année civils, ou une part de l’un d’eux (LM7-Q4 (C)) ; jamais à cheval sur deux', () => {
    expect(periodeDeForfaitValide('mois', '2026-01-15', '2026-01-31')).toBe(true)
    expect(periodeDeForfaitValide('trimestre', '2026-02-15', '2026-03-31')).toBe(true)
    expect(periodeDeForfaitValide('annee', '2026-03-01', '2026-03-01')).toBe(true)
    expect(periodeDeForfaitValide('mois', '2026-01-31', '2026-01-30')).toBe(false)
    expect(periodeCivile('trimestre', '2026-05-17')).toEqual({ debut: '2026-04-01', fin: '2026-06-30' })
    expect(periodeCivile('mois', '2028-02-10')).toEqual({ debut: '2028-02-01', fin: '2028-02-29' })
    expect(periodeCivile('annee', '2100-07-04')).toEqual({ debut: '2100-01-01', fin: '2100-12-31' })
    expect(periodeDeForfaitValide('mois', '2026-02-01', '2026-02-28')).toBe(true)
    expect(periodeDeForfaitValide('mois', '2028-02-01', '2028-02-29')).toBe(true)
    expect(periodeDeForfaitValide('mois', '2026-01-02', '2026-02-01')).toBe(false)
    expect(periodeDeForfaitValide('trimestre', '2026-04-01', '2026-06-30')).toBe(true)
    expect(periodeDeForfaitValide('trimestre', '2026-02-01', '2026-04-30')).toBe(false)
    expect(periodeDeForfaitValide('annee', '2026-01-01', '2026-12-31')).toBe(true)
    expect(periodeDeForfaitValide('annee', '2026-07-01', '2027-06-30')).toBe(false)
    expect(periodeDeForfaitValide(undefined, '2026-01-01', '2026-01-31')).toBe(false)
  })

  it('une tâche tient en un an au plus (le 29 février compté comme la base le compte)', () => {
    expect(periodeDeTacheValide('2026-01-01', '2026-12-31')).toBe(true)
    expect(periodeDeTacheValide('2026-01-01', '2027-01-01')).toBe(false)
    expect(periodeDeTacheValide('2026-06-15', '2026-06-15')).toBe(true)
    expect(periodeDeTacheValide('2026-06-15', '2026-06-14')).toBe(false)
    expect(periodeDeTacheValide('2028-02-29', '2029-02-27')).toBe(true)
    expect(periodeDeTacheValide('2028-02-29', '2029-02-28')).toBe(false)
  })

  it('les périodes civiles qui touchent un intervalle', () => {
    expect(periodesDuForfait('trimestre', '2026-02-15', '2026-07-01')).toEqual([
      { debut: '2026-01-01', fin: '2026-03-31' }, { debut: '2026-04-01', fin: '2026-06-30' }, { debut: '2026-07-01', fin: '2026-09-30' }])
    expect(periodesDuForfait('mois', '2026-11-20', '2027-01-05').map((p) => p.debut)).toEqual(['2026-11-01', '2026-12-01', '2027-01-01'])
    expect(periodesDuForfait('annee', '2026-03-01', '2026-03-01')).toEqual([{ debut: '2026-01-01', fin: '2026-12-31' }])
    expect(periodesDuForfait('mois', '2026-03-01', '2026-02-01')).toEqual([])
  })

  it('les libellés sont ceux que la fonction compose (l’essai les lit en base)', () => {
    const forfait = (libelle: string, periodicite: LigneDHonoraires['periodicite']): LigneDHonoraires =>
      ({ forme: 'forfait', libelle, montant_ht: 1, periodicite })
    const tache = (libelle: string): LigneDHonoraires => ({ forme: 'tache', libelle, montant_ht: 1, livrable: 'autre' })
    const libelles = [
      designationDeLElement(forfait('Tenue mensuelle', 'mois'), '2026-01-01', '2026-01-31'),
      designationDeLElement(forfait('Forfait social', 'trimestre'), '2026-01-01', '2026-03-31'),
      designationDeLElement(forfait('Tenue mensuelle (avenant)', 'mois'), '2026-09-01', '2026-09-30'),
      designationDeLElement(tache('Déclaration 2035'), '2026-01-01', '2026-12-31'),
      designationDeLElement(tache('Conseil'), '2026-06-15', '2026-06-15'),
    ]
    expect(libelles).toEqual(['Tenue mensuelle — janvier 2026', 'Forfait social — 1er trimestre 2026',
      'Tenue mensuelle (avenant) — septembre 2026', 'Déclaration 2035 — exercice 2026', 'Conseil — le 15/06/2026'])
    for (const l of libelles) expect(ESSAI, l).toContain(l)
    expect(designationDeLElement(forfait('Social', 'trimestre'), '2026-10-01', '2026-12-31')).toBe('Social — 4e trimestre 2026')
    expect(designationDeLElement(forfait('Annuel', 'annee'), '2026-01-01', '2026-12-31')).toBe('Annuel — année 2026')
    expect(designationDeLElement(tache('CA3'), '2026-04-01', '2026-06-30')).toBe('CA3 — 2e trimestre 2026')
    expect(designationDeLElement(tache('Dossier'), '2026-03-10', '2026-04-20')).toBe('Dossier — du 10/03/2026 au 20/04/2026')
  })

  it('les totaux du brouillon : chaque ligne arrondie, puis sommée (450, 90, 540 dans l’essai)', () => {
    expect(totauxDuBrouillon([150, 300], 20)).toEqual({ montant_ht: 450, montant_tva: 90, montant_ttc: 540 })
    expect(totauxDuBrouillon([33.33, 33.33], 8.5)).toEqual({ montant_ht: 66.66, montant_tva: 5.66, montant_ttc: 72.32 })
  })
})

// Le jeu de l'essai, en mémoire : L1 (C, du 01/01/2026 : forfait mensuel 150, la 2035, forfait trimestriel 300, un conseil),
// L4 (C, résiliée au 15/03/2026), L1B (l'avenant de L1, d'effet au 01/07/2026).
const H1: LigneDHonoraires[] = [
  { forme: 'forfait', libelle: 'Tenue mensuelle', montant_ht: 150, periodicite: 'mois' },
  { forme: 'tache', libelle: 'Déclaration 2035', montant_ht: 600, livrable: 'declaration_2035' },
  { forme: 'forfait', libelle: 'Forfait social', montant_ht: 300, periodicite: 'trimestre' },
  { forme: 'tache', libelle: 'Conseil', montant_ht: 80, livrable: 'autre' },
]
const lettre = (id: string, fin: Partial<LettreAFacturer> = {}): LettreAFacturer => ({
  id, remplace_id: null, dossier_client_id: 'C', date_effet: '2026-01-01', fin_initiale: '2026-12-31', reconduction_tacite: true,
  proposee_le: '2025-12-01', acceptee_le: '2025-12-05', refusee_le: null, retiree_le: null, fin_au: null,
  honoraires: H1, premier_exercice: 2026, ...fin,
})
const L1 = lettre('L1')
const L4 = lettre('L4', { retiree_le: '2026-03-01', fin_au: '2026-03-15' })
const L1B = lettre('L1B', { remplace_id: 'L1', date_effet: '2026-07-01', acceptee_le: '2026-09-10', honoraires: [
  { forme: 'forfait', libelle: 'Tenue mensuelle (avenant)', montant_ht: 160, periodicite: 'mois' },
  { forme: 'tache', libelle: 'Déclaration 2035', montant_ht: 650, livrable: 'declaration_2035' },
  { forme: 'tache', libelle: 'Conseil', montant_ht: 90, livrable: 'autre' }] })
const facture = (id: string, montant: number, fin: Partial<FactureDuCabinet> = {}): FactureDuCabinet =>
  ({ id, type: 'facture', statut: 'validee', montant_ttc: montant, facture_origine_id: null, numero: null, ...fin })
const avoir = (id: string, origine: string, montant: number): FactureDuCabinet =>
  ({ id, type: 'avoir', statut: 'validee', montant_ttc: -montant, facture_origine_id: origine, numero: null })
const lien = (facture_id: string, lettre_id: string, ligne: number, debut: string, fin: string): LienDHonoraires =>
  ({ facture_id, lettre_id, ligne, periode_debut: debut, periode_fin: fin, facturation: 1 })
const el = (lettre_id: string, ligne: number, periode_debut: string, periode_fin: string) => ({ lettre_id, ligne, periode_debut, periode_fin })
const AUJOURDHUI = '2026-11-11'

describe('ce qu’un avoir rend, la lettre en vigueur, les refus avant le clic', () => {
  it('une facture créditée EN ENTIER, par ses avoirs ou ceux d’une reprise ; un avoir partiel ne suffit pas ; un brouillon jamais', () => {
    const f2 = facture('F2', 180)
    expect(factureCrediteeEnEntier('F2', [f2, avoir('A1', 'F2', 60)], [])).toBe(false)
    expect(factureCrediteeEnEntier('F2', [f2, avoir('A1', 'F2', 60), avoir('A2', 'F2', 120)], [])).toBe(true)
    expect(factureCrediteeEnEntier('F2', [f2, avoir('A3', 'X', 180)], [{ facture_id: 'A3', origine_id: 'F2' }])).toBe(true)
    expect(factureCrediteeEnEntier('B', [facture('B', 180, { statut: 'brouillon' }), avoir('A4', 'B', 180)], [])).toBe(false)
    expect(factureCrediteeEnEntier('inconnue', [], [])).toBe(false)
  })

  it('l’avenant remplace la lettre d’avant dès son effet ; la résiliation l’arrête', () => {
    const lettres = [L1, L4, L1B]
    expect(lettreEnVigueurLe(L1, lettres, '2026-06-30')).toBe(true)
    expect(lettreEnVigueurLe(L1, lettres, '2026-07-31')).toBe(false)
    expect(lettreEnVigueurLe(L1B, lettres, '2026-07-31')).toBe(true)
    expect(lettreEnVigueurLe(L4, lettres, '2026-03-15')).toBe(true)
    expect(lettreEnVigueurLe(L4, lettres, '2026-03-31')).toBe(false)
  })

  it('les refus de chaque élément, dans l’ordre de la base (les étapes de l’essai)', () => {
    const lettres = [L1, L4, L1B, lettre('L3', { acceptee_le: null })]
    const refus = (e: ReturnType<typeof el>, liens: LienDHonoraires[] = [], factures: FactureDuCabinet[] = []) =>
      refusDeLElement(e, lettres, liens, factures, [], AUJOURDHUI)
    expect(refus(el('X', 1, '2026-01-01', '2026-01-31'))).toBe('introuvable')
    expect(refus(el('L3', 1, '2026-01-01', '2026-01-31'))).toBe('nonAcceptee')
    expect(refus(el('L1', 9, '2026-01-01', '2026-01-31'))).toBe('ligneIntrouvable')
    expect(refus(el('L1', 1, '2026-01-02', '2026-02-01'))).toBe('periodeDuForfait')
    expect(refus(el('L1', 2, '2026-01-01', '2027-01-01'))).toBe('periodeDeLaTache')
    expect(refus(el('L1B', 1, '2026-12-01', '2026-12-31'))).toBe('pasCommencee')
    expect(refus(el('L4', 1, '2026-03-01', '2026-03-31'))).toBe('horsDeVigueur')
    expect(refus(el('L1', 2, '2025-01-01', '2025-12-31'))).toBe('horsDeVigueur')
    expect(refus(el('L1', 1, '2026-09-01', '2026-09-30'))).toBe('horsDeVigueur')
    // Une tâche : la lettre en vigueur au dernier jour de sa période SUFFIT (le conseil du 10 février, sous la lettre
    // résiliée en mars) ; en vigueur aujourd'hui, l'avenant ne facture pas la 2035 d'avant son premier exercice.
    expect(refus(el('L4', 4, '2026-02-10', '2026-02-10'))).toBeNull()
    expect(refus(el('L1B', 2, '2025-01-01', '2025-12-31'))).toBe('horsDeVigueur')
    expect(refus(el('L1', 1, '2026-01-01', '2026-01-31'))).toBeNull()
    // Le temps passé, que la base admet dans une lettre sans le facturer (LM9).
    expect(refusDeLElement(el('LT', 1, '2026-01-01', '2026-01-31'),
      [lettre('LT', { honoraires: [{ forme: 'temps', libelle: 'Heure', montant_ht: 90 }] })], [], [], [], AUJOURDHUI)).toBe('tempsPasse')
  })

  it('une période déjà facturée : la même ligne, ou la ligne de même nature d’une autre version — sauf une tâche « autre »', () => {
    const lettres = [L1, L1B]
    const factures = [facture('F4', 300, { statut: 'brouillon' }), facture('F5', 900, { statut: 'brouillon' })]
    const liens = [lien('F4', 'L1', 1, '2026-08-01', '2026-08-31'), lien('F4', 'L1', 4, '2026-06-15', '2026-06-15'),
      lien('F5', 'L1B', 2, '2026-01-01', '2026-12-31')]
    const refus = (e: ReturnType<typeof el>) => refusDeLElement(e, lettres, liens, factures, [], AUJOURDHUI)
    expect(refus(el('L1B', 1, '2026-08-01', '2026-08-31'))).toBe('dejaFacturee')
    expect(refus(el('L1B', 3, '2026-06-15', '2026-06-15'))).toBeNull()
    expect(refus(el('L1B', 1, '2026-09-01', '2026-09-30'))).toBeNull()
    expect(refus(el('L1B', 2, '2026-01-01', '2026-12-31'))).toBe('dejaFacturee')
  })

  it('les refus de la demande : le nombre, le taux, le double, deux clients', () => {
    const lettres = [L1, lettre('L2', { dossier_client_id: 'C2' })]
    const janvier = el('L1', 1, '2026-01-01', '2026-01-31')
    expect(refusDeLaDemande([], lettres, 20)).toBe('nombre')
    expect(refusDeLaDemande([janvier], lettres, 5.5)).toBe('taux')
    expect(refusDeLaDemande([janvier, janvier], lettres, 20)).toBe('double')
    expect(refusDeLaDemande([janvier, el('L2', 1, '2026-01-01', '2026-12-31')], lettres, 20)).toBe('unSeulClient')
    expect(refusDeLaDemande([janvier], lettres, 8.5)).toBeNull()
  })
})

describe('les périodes à facturer', () => {
  it('à terme échu : les mois et les trimestres finis, sous la lettre en vigueur à leur dernier jour, sans ce qui est facturé', () => {
    const factures = [facture('F1', 180)]
    const liens = [lien('F1', 'L1', 1, '2026-01-01', '2026-01-31')]
    const a = periodesAFacturer([L1, L1B], liens, factures, [], AUJOURDHUI, 'echu')
    const cles = a.map((p) => `${p.lettre_id}:${p.ligne}:${p.periode_debut}`)
    // L1 : février à juin, ses trimestres 1 et 2 ; l'avenant : juillet à octobre (novembre n'est pas fini) ; pas le 3e
    // trimestre de L1, remplacée au 30/09 (l'avenant n'a pas de forfait trimestriel : il n'est plus facturé).
    expect(cles).toEqual(['L1:3:2026-01-01', 'L1:1:2026-02-01', 'L1:1:2026-03-01', 'L1:1:2026-04-01', 'L1:3:2026-04-01',
      'L1:1:2026-05-01', 'L1:1:2026-06-01', 'L1B:1:2026-07-01', 'L1B:1:2026-08-01', 'L1B:1:2026-09-01', 'L1B:1:2026-10-01'])
    expect(a[0]).toEqual({ lettre_id: 'L1', ligne: 3, periode_debut: '2026-01-01', periode_fin: '2026-03-31',
      designation: 'Forfait social — 1er trimestre 2026', montant_ht: 300, prorata: null })
  })

  it('à échoir : le mois commencé aussi ; un avoir qui crédite tout rend la période, un avoir partiel non', () => {
    const avant = periodesAFacturer([L1B], [], [], [], AUJOURDHUI, 'a_echoir').map((p) => p.periode_debut)
    expect(avant.at(-1)).toBe('2026-11-01')
    const f = facture('F', 192)
    const liens = [lien('F', 'L1B', 1, '2026-07-01', '2026-07-31')]
    const juillet = (factures: FactureDuCabinet[]) =>
      periodesAFacturer([L1B], liens, factures, [], AUJOURDHUI, 'echu').some((p) => p.periode_debut === '2026-07-01')
    expect(juillet([f])).toBe(false)
    expect(juillet([f, avoir('A', 'F', 50)])).toBe(false)
    expect(juillet([f, avoir('A', 'F', 50), avoir('B', 'F', 142)])).toBe(true)
  })

  it('une lettre ni acceptée ni d’effet ne propose rien ; une lettre résiliée le 15 mars facture ses quinze jours de mars', () => {
    expect(periodesAFacturer([lettre('P', { acceptee_le: null })], [], [], [], AUJOURDHUI, 'echu')).toEqual([])
    const l4 = periodesAFacturer([L4], [], [], [], AUJOURDHUI, 'echu').filter((p) => p.ligne === 1)
    expect(l4.map((p) => p.periode_debut)).toEqual(['2026-01-01', '2026-02-01', '2026-03-01'])
    expect(l4[2]).toMatchObject({ periode_fin: '2026-03-15', montant_ht: 72.58, prorata: { jours: 15, sur: 31, prixDeLaPeriode: 150 },
      designation: 'Tenue mensuelle — mars 2026, du 01/03/2026 au 15/03/2026 (15 jours sur 31)' })
  })
})

// LE PRORATA AU JOUR PRÈS (LM7-Q4 (C)) : le jeu des étapes 59 à 75 de l'essai — L5 (C3, d'effet au 15/01/2026 : 100,01 € par
// mois, 300 € par trimestre, 1 200 € par an) et son avenant L5B (d'effet au 16/04/2026 : 100,01 €, 330 €, 1 200 €).
const H5: LigneDHonoraires[] = [
  { forme: 'forfait', libelle: 'Tenue au prorata', montant_ht: 100.01, periodicite: 'mois' },
  { forme: 'forfait', libelle: 'Social au prorata', montant_ht: 300, periodicite: 'trimestre' },
  { forme: 'forfait', libelle: 'Annuel au prorata', montant_ht: 1200, periodicite: 'annee' },
]
const L5 = lettre('L5', { dossier_client_id: 'C3', date_effet: '2026-01-15', honoraires: H5 })
const L5B = lettre('L5B', { dossier_client_id: 'C3', remplace_id: 'L5', date_effet: '2026-04-16', fin_initiale: '2027-04-15', honoraires: [
  { forme: 'forfait', libelle: 'Tenue (avenant)', montant_ht: 100.01, periodicite: 'mois' },
  { forme: 'forfait', libelle: 'Social (avenant)', montant_ht: 330, periodicite: 'trimestre' },
  { forme: 'forfait', libelle: 'Annuel (avenant)', montant_ht: 1200, periodicite: 'annee' }] })

describe('le prorata au jour près (LM7-Q4 (C))', () => {
  it('redit la migration : le calcul en entiers, la période civile, la part exacte, un jour facturé une fois', () => {
    const prorata = fonction('honoraires_au_prorata')
    for (const morceau of ['prorata_arrondi((p_montant_ht * 100)::bigint,', '(p_fin - public.periode_civile_debut(p_periodicite, p_debut) + 1)::bigint',
      '(p_debut - public.periode_civile_debut(p_periodicite, p_debut))::bigint', '              - public.prorata_arrondi(',
      'p_montant_ht = round(p_montant_ht, 2)']) expect(prorata, morceau).toContain(morceau)
    expect(fonction('periode_civile_debut')).toContain('((extract(month from p_jour)::integer - 1) / 3) * 3 + 1')
    expect(fonction('periode_de_forfait_valide')).toContain(
      'public.periode_civile_debut(p_periodicite, p_debut) = public.periode_civile_debut(p_periodicite, p_fin)')
    expect(fonction('garder_honoraires_factures')).toContain('then h.periode_debut <= new.periode_fin and new.periode_debut <= h.periode_fin')
    const facturer = fonction('facturer_honoraires')
    for (const morceau of ['public.lettre_en_vigueur_le(v_lettre.id, v_debut) and public.lettre_en_vigueur_le(v_lettre.id, v_fin)',
      'public.lettre_en_vigueur_le(v_lettre.id, v_debut - 1)', 'public.lettre_en_vigueur_le(v_lettre.id, v_fin + 1)',
      "' sur ' || (v_civil_fin - v_civil_debut + 1) || ')'"]) expect(facturer, morceau).toContain(morceau)
    expect(MIGRATION).toContain('revoke execute on function public.honoraires_au_prorata(numeric, text, date, date) from public, anon, authenticated;')
  })

  it('les montants de l’essai, écrits en toutes lettres : le module les rend au centime', () => {
    const parts: [number, 'mois' | 'trimestre' | 'annee', string, string, number][] = [
      [100.01, 'mois', '2026-01-15', '2026-01-31', 5484], [300, 'trimestre', '2026-01-15', '2026-03-31', 25333],
      [100.01, 'mois', '2026-04-01', '2026-04-15', 5001], [100.01, 'mois', '2026-04-16', '2026-04-30', 5000],
      [300, 'trimestre', '2026-04-01', '2026-04-15', 4945], [330, 'trimestre', '2026-04-16', '2026-06-30', 27560],
      [1200, 'annee', '2026-01-15', '2026-04-15', 29918], [1200, 'annee', '2026-04-16', '2026-12-31', 85479],
    ]
    for (const [prix, p, debut, fin, attendu] of parts) expect(centimesAuProrata(prix, p, debut, fin), `${p} ${debut}`).toBe(attendu)
    for (const texte of ['1×54.84', '1×253.33', '50.01', '50.00 = 100.01', '49.45 275.60 299.18 854.79 = 1479.02']) expect(ESSAI, texte).toContain(texte)
    expect(joursDuProrata('trimestre', '2026-01-15', '2026-03-31')).toEqual({ jours: 76, sur: 90 })
    expect(centimesAuProrata(100.01, 'mois', '2026-01-15', '2026-02-14')).toBeNull()
    expect(centimesAuProrata(100.005, 'mois', '2026-01-15', '2026-01-31')).toBeNull()
  })

  it('deux parts d’un même mois au même prix font ce prix, jamais un centime de plus ; à deux prix, jamais plus que le plus élevé', () => {
    // L'arrondi de chaque moitié seule : 50,01 + 50,01 = 100,02 €. Le cumul : 50,01 + 50,00.
    expect(2 * Math.round(10001 * 15 / 30)).toBe(10002)
    for (const prix of [1, 3, 10001, 4321_98, 99_999_999_999]) {
      for (const [debut, fin, n] of [['2026-02-01', '2026-02-28', 28], ['2026-04-01', '2026-04-30', 30], ['2028-01-01', '2028-12-31', 366]] as const) {
        const periodicite = n === 366 ? 'annee' : 'mois'
        for (let k = 1; k < n; k += 1) {
          const jour = (i: number) => new Date(Date.UTC(Number(debut.slice(0, 4)), Number(debut.slice(5, 7)) - 1, 1 + i)).toISOString().slice(0, 10)
          const tete = centimesAuProrata(prix / 100, periodicite, debut, jour(k - 1))!
          const queue = centimesAuProrata(prix / 100, periodicite, jour(k), fin)!
          expect(tete + queue).toBe(prix)
          const autre = centimesAuProrata((prix + 77) / 100, periodicite, jour(k), fin)!
          expect(tete + autre).toBeLessThanOrEqual(prix + 77)
        }
      }
    }
  })

  it('les jours de vigueur d’une lettre, d’un seul tenant, sont ceux que lettreEnVigueurLe dit jour par jour', () => {
    const lettres = [L1, L4, L1B, L5, L5B, lettre('P', { acceptee_le: null })]
    expect(joursDeVigueur(L1, lettres)).toEqual({ debut: '2026-01-01', fin: '2026-06-30' })
    expect(joursDeVigueur(L4, lettres)).toEqual({ debut: '2026-01-01', fin: '2026-03-15' })
    expect(joursDeVigueur(L5, lettres)).toEqual({ debut: '2026-01-15', fin: '2026-04-15' })
    expect(joursDeVigueur(L5B, lettres)).toEqual({ debut: '2026-04-16', fin: null })
    expect(joursDeVigueur(lettres[5], lettres)).toBeNull()
    const sansReconduction = lettre('S', { reconduction_tacite: false, fin_initiale: '2026-05-31' })
    expect(joursDeVigueur(sansReconduction, [sansReconduction])).toEqual({ debut: '2026-01-01', fin: '2026-05-31' })
    for (const l of lettres.slice(0, 5)) {
      const v = joursDeVigueur(l, lettres)!
      for (let i = 0; i < 365; i += 1) {
        const jour = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10)
        expect(lettreEnVigueurLe(l, lettres, jour), `${l.id} ${jour}`).toBe(jour >= v.debut && (v.fin === null || jour <= v.fin))
      }
    }
  })

  it('les refus d’une part, dans l’ordre de la base (les étapes 59 à 62 et 66 de l’essai)', () => {
    const lettres = [L5, L5B]
    const refus = (debut: string, fin: string, ligne = 1, id = 'L5') => refusDeLElement(el(id, ligne, debut, fin), lettres, [], [], [], AUJOURDHUI)
    expect(refus('2026-01-01', '2026-01-31')).toBe('horsDeVigueur')
    expect(refus('2026-01-16', '2026-01-31')).toBe('joursDeLaLettre')
    expect(refus('2026-01-15', '2026-01-30')).toBe('joursDeLaLettre')
    expect(refus('2026-01-15', '2026-02-14')).toBe('periodeDuForfait')
    expect(refus('2026-04-01', '2026-04-30')).toBe('horsDeVigueur')
    expect(refus('2026-01-15', '2026-01-31')).toBeNull()
    expect(refus('2026-04-16', '2026-04-30', 1, 'L5B')).toBeNull()
    expect(refus('2026-01-15', '2026-04-15', 3)).toBeNull()
    expect(motsDuRefusDeLaFacturation('joursDeLaLettre')).toBe('La période d’un forfait suit la lettre au jour près : tous ses jours dans le mois, le trimestre ou l’année, et eux seuls.')
  })

  it('un jour d’un forfait ne se facture qu’une fois : la même ligne, ou l’avenant (les étapes 70 et 71) ; une tâche garde sa période', () => {
    const lettres = [L5, L5B]
    const factures = [facture('F6', 369.81, { statut: 'brouillon' })]
    const liens = [lien('F6', 'L5', 1, '2026-04-01', '2026-04-15')]
    expect(lienQuiCouvre(el('L5', 1, '2026-04-10', '2026-04-20'), lettres, liens, factures, [])).not.toBeNull()
    expect(lienQuiCouvre(el('L5B', 1, '2026-04-01', '2026-04-15'), lettres, liens, factures, [])).not.toBeNull()
    expect(lienQuiCouvre(el('L5B', 1, '2026-04-16', '2026-04-30'), lettres, liens, factures, [])).toBeNull()
    expect(lienQuiCouvre(el('L5', 2, '2026-04-01', '2026-04-15'), lettres, liens, factures, [])).toBeNull()
    const taches = [lien('F6', 'L1', 4, '2026-06-15', '2026-06-15')]
    expect(lienQuiCouvre(el('L1', 4, '2026-06-01', '2026-06-30'), [L1], taches, factures, [])).toBeNull()
  })

  it('les parts à facturer : la lettre d’effet au 15 janvier et son avenant du 16 avril, chacun au prix de sa lettre, dits comme la base les écrit', () => {
    const a = periodesAFacturer([L5, L5B], [], [], [], AUJOURDHUI, 'echu')
    const parts = a.filter((p) => p.prorata !== null).map((p) => `${p.lettre_id}:${p.ligne}:${p.periode_debut}:${p.periode_fin}:${p.montant_ht}`)
    expect(parts).toEqual(['L5:1:2026-01-15:2026-01-31:54.84', 'L5:2:2026-01-15:2026-03-31:253.33', 'L5:3:2026-01-15:2026-04-15:299.18',
      'L5:1:2026-04-01:2026-04-15:50.01',
      'L5:2:2026-04-01:2026-04-15:49.45', 'L5B:1:2026-04-16:2026-04-30:50', 'L5B:2:2026-04-16:2026-06-30:275.6'])
    // L'année de L5 (du 15 janvier au 15 avril) est échue à son dernier jour ; celle de l'avenant, au 31 décembre.
    expect(a.filter((p) => p.ligne === 3).map((p) => p.lettre_id)).toEqual(['L5'])
    expect(periodesAFacturer([L5, L5B], [], [], [], '2026-12-31', 'echu').filter((p) => p.ligne === 3).map((p) => p.montant_ht)).toEqual([299.18, 854.79])
    const janvier = a.find((p) => p.lettre_id === 'L5' && p.ligne === 1 && p.periode_debut === '2026-01-15')!
    expect(janvier.prorata).toEqual({ jours: 17, sur: 31, prixDeLaPeriode: 100.01 })
    // Les libellés que l'essai lit en base (64, 67) : janvier et le premier trimestre de L5, avril des deux lettres.
    const lus = a.filter((x) => x.prorata !== null && (x.ligne === 1 || x.periode_debut === '2026-01-15') && x.ligne < 3)
    expect(lus).toHaveLength(4)
    for (const p of lus) expect(ESSAI, p.designation).toContain(p.designation)
    expect(designationDeLElement(H5[0], '2026-01-31', '2026-01-31')).toBe('Tenue au prorata — janvier 2026, le 31/01/2026 (1 jour sur 31)')
    expect(designationDeLElement(H5[1], '2026-02-16', '2026-03-31')).toBe('Social au prorata — 1er trimestre 2026, du 16/02/2026 au 31/03/2026 (44 jours sur 90)')
  })
})
