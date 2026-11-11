import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { definitionsSql } from '../test/schema'
import {
  HONORAIRES_FACTURES_PREVUS, REFUS_DE_LA_FACTURATION, TAUX_DES_HONORAIRES, designationDeLElement, factureCrediteeEnEntier,
  lettreEnVigueurLe, motsDuRefusDeLaFacturation, periodeDeForfaitValide, periodeDeTacheValide, periodesAFacturer,
  periodesDuForfait, refusDeLElement, refusDeLaDemande, totauxDuBrouillon,
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

  it('le retour retire la table et les six fonctions que la migration crée, et se refuse sous un lien', () => {
    const creees = [...MIGRATION.matchAll(/^create function public\.([a-z_]+)\(/gim)].map((m) => m[1]).sort()
    const retirees = [...RETOUR.matchAll(/^drop function public\.([a-z_]+)\(/gim)].map((m) => m[1]).sort()
    expect(creees).toHaveLength(6)
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
  it('un mois, un trimestre, une année civils, du premier au dernier jour', () => {
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
      designation: 'Forfait social — 1er trimestre 2026', montant_ht: 300 })
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

  it('une lettre ni acceptée ni d’effet ne propose rien ; une lettre résiliée s’arrête au mois qu’elle finit', () => {
    expect(periodesAFacturer([lettre('P', { acceptee_le: null })], [], [], [], AUJOURDHUI, 'echu')).toEqual([])
    const l4 = periodesAFacturer([L4], [], [], [], AUJOURDHUI, 'echu').filter((p) => p.ligne === 1).map((p) => p.periode_debut)
    expect(l4).toEqual(['2026-01-01', '2026-02-01'])
  })
})
