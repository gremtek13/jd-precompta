import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { BordereauLu } from './bordereauDeTeletransmission'
import { factureDesBordereaux } from './factureAssuranceMaladie'
import {
  corpsDeLImportDuFacture,
  FACTURES_ASSURANCE_MALADIE_EN_BASE,
  FACTURES_ASSURANCE_MALADIE_PREVUES,
  REFUS_DE_LA_FONCTION_DU_FACTURE,
  REFUS_DE_L_IMPORT_DU_FACTURE,
  refusDeLImportDuFacture,
  refusDuLotDejaImporte,
  refusDuLotDUnImportRestaure,
  type ImportDuFactureAEnvoyer,
} from './importDuFactureAssuranceMaladie'
import { entierTire, tirage } from '../test/encaissementsBatterie'

// L'IMPORT DU FACTURÉ À L'ASSURANCE MALADIE (conception 59, BOR3) : les refus de la base, confrontés au texte de la migration
// préparée et redits sous ses mots ; un relevé de la base rejugé à l'identique ; le corps de l'appel, tiré de BOR2, que la
// base accepte. L'essai de la base : supabase/essais/facturesAssuranceMaladie.sql, sur une réplique. Des numéros de lot faits
// de 9, des caisses « VILLE FICTIVE », des montants inventés.

const MIGRATION = 'supabase/schema/20261120110200_factures_assurance_maladie.sql'
const RETOUR = 'supabase/preparees/retour/20261119140100_retour_factures_assurance_maladie.sql'
const ESSAIS = ['supabase/essais/facturesAssuranceMaladie.sql', 'supabase/essais/facturesAssuranceMaladieSuppression.sql']
const texteDeLaMigration = readFileSync(resolve(process.cwd(), MIGRATION), 'utf8')
const JOUR = '2026-11-19'

const bon = (): ImportDuFactureAEnvoyer => ({
  version: 1,
  lots: [
    { numero: 900101, cree_le: '2026-11-14', caisse: 691, nombre_de_factures: 3 },
    { numero: 900102, cree_le: '2026-11-14', caisse: 691, nombre_de_factures: 2 },
    { numero: 900103, cree_le: '2026-11-15', caisse: 692, nombre_de_factures: 4 },
  ],
  agregats: [
    { date_creation_lot: '2026-11-14', part: 'obligatoire', regime: 1, caisse: 691, organisme_complementaire: null, montant_centimes: 12000, nombre_de_lots: 2, nombre_de_factures: 5 },
    { date_creation_lot: '2026-11-14', part: 'complementaire', regime: null, caisse: null, organisme_complementaire: null, montant_centimes: 3000, nombre_de_lots: 2, nombre_de_factures: 5 },
    { date_creation_lot: '2026-11-15', part: 'obligatoire', regime: 1, caisse: 692, organisme_complementaire: null, montant_centimes: 8000, nombre_de_lots: 1, nombre_de_factures: 4 },
  ],
})
const avec = (chemin: (string | number)[], valeur: unknown): unknown => {
  const copie = JSON.parse(JSON.stringify(bon())) as Record<string, unknown>
  let o: Record<string, unknown> = copie
  for (const c of chemin.slice(0, -1)) o = o[c] as Record<string, unknown>
  o[chemin[chemin.length - 1]] = valeur
  return copie
}

describe('le drapeau et les fichiers de la migration', () => {
  it('la base levée, l’écran (BOR4) ouvert depuis le 20/11/2026 ; la migration dans l’export (en production depuis le 20/11/2026), son retour et ses essais à côté', () => {
    expect(FACTURES_ASSURANCE_MALADIE_EN_BASE).toBe(true)
    expect(FACTURES_ASSURANCE_MALADIE_PREVUES).toBe(true)
    for (const f of [MIGRATION, RETOUR, ...ESSAIS]) expect(existsSync(resolve(process.cwd(), f))).toBe(true)
    expect(existsSync(resolve(process.cwd(), 'supabase/preparees/20261119140000_factures_assurance_maladie.sql'))).toBe(false)
  })
})

describe('les mots de la base, au caractère près', () => {
  const sql = (s: string) => s.replace(/''/g, '\'')
  it('les huit constantes du refus sont celles de `refus_de_l_import_des_factures_assurance_maladie`, dans son ordre', () => {
    const constantes = [...texteDeLaMigration.matchAll(/c_(\w+) constant text := '((?:[^']|'')*)';/g)].map((m) => [m[1], sql(m[2])])
    const R = REFUS_DE_L_IMPORT_DU_FACTURE
    expect(constantes).toEqual([
      ['forme', R.forme], ['nombre', R.nombre], ['lot', R.lot], ['a_venir', R.aVenir], ['doublon_lot', R.doublonLot],
      ['total', R.total], ['doublon_total', R.doublonTotal], ['coherence', R.coherence],
    ])
  })

  it('les refus de la fonction d’import : l’accès, un lot déjà importé, un import restauré, sous leurs jours', () => {
    expect(texteDeLaMigration).toContain(`'${REFUS_DE_LA_FONCTION_DU_FACTURE.acces}'`)
    expect(refusDuLotDejaImporte(2, '2026-11-19')).toBe('Le bordereau 2 de l\'envoi a déjà été importé le 19/11/2026 : un lot ne s\'importe pas deux fois.')
    expect(texteDeLaMigration).toContain('\'Le bordereau % de l\'\'envoi a déjà été importé le % : un lot ne s\'\'importe pas deux fois.\'')
    expect(refusDuLotDUnImportRestaure('2026-11-14')).toBe('Un import restauré, dont la sauvegarde ne porte pas le registre des lots, couvre le 14/11/2026 : le retirer d\'abord, puis réimporter ses bordereaux.')
    expect(texteDeLaMigration).toContain('\'Un import restauré, dont la sauvegarde ne porte pas le registre des lots, couvre le % : le retirer d\'\'abord, puis réimporter ses bordereaux.\'')
  })

  it('l’empreinte de la base : le HMAC-SHA-256 de « lot:numéro:date:caisse » sous la clé du dossier, deux fois écrit à l’identique', () => {
    const formule = "extensions.hmac(convert_to('lot:' || ((x ->> 'numero')::numeric)::bigint::text || ':'"
    expect(texteDeLaMigration).toContain(formule)
    expect(texteDeLaMigration).toContain("extensions.hmac(convert_to('lot:' || ((x.lot ->> 'numero')::numeric)::bigint::text || ':'")
    expect(texteDeLaMigration.match(/v_cle, 'sha256'\)/g)).toHaveLength(2)
  })
})

describe('refusDeLImportDuFacture redit la forme que la base exige, dans son ordre (les étapes 33 à 56 de l’essai)', () => {
  const R = REFUS_DE_L_IMPORT_DU_FACTURE
  it.each([
    ['bien formé', bon(), null],
    ['la version 2', avec(['version'], 2), R.forme],
    ['une clé de plus, un texte libre', { ...bon(), note: 'texte libre' }, R.forme],
    ['sans totaux', (() => { const c = bon() as Partial<ImportDuFactureAEnvoyer>; delete c.agregats; return c })(), R.forme],
    ['aucun lot', avec(['lots'], []), R.nombre],
    ['aucun total : les lots seuls', avec(['agregats'], []), null],
    ['un lot qui porte un nom', avec(['lots', 0, 'nom'], 'DUPONT-ESSAI'), R.lot],
    ['un numéro de lot écrit en texte', avec(['lots', 0, 'numero'], '900101'), R.lot],
    ['un numéro de lot de dix chiffres', avec(['lots', 0, 'numero'], 1_000_000_000), R.lot],
    ['un numéro de lot nul', avec(['lots', 0, 'numero'], 0), R.lot],
    ['une date de création qui n’existe pas', avec(['lots', 0, 'cree_le'], '2026-02-30'), R.lot],
    ['une date d’avant 1990', avec(['lots', 0, 'cree_le'], '1989-12-31'), R.lot],
    ['un lot créé demain', avec(['lots', 0, 'cree_le'], '2026-11-20'), R.aVenir],
    ['une caisse de quatre chiffres', avec(['lots', 0, 'caisse'], 1000), R.lot],
    ['un lot sans facture', avec(['lots', 0, 'nombre_de_factures'], 0), R.lot],
    ['un lot de plus de 10 000 factures', avec(['lots', 0, 'nombre_de_factures'], 10_001), R.lot],
    ['deux lots de même empreinte', avec(['lots', 1, 'numero'], 900101), R.doublonLot],
    ['deux lots de même numéro et de même date, de deux caisses : deux lots (la caisse est de l’empreinte)', {
      version: 1, agregats: [], lots: [{ numero: 900201, cree_le: '2026-11-18', caisse: 691, nombre_de_factures: 1 },
        { numero: 900201, cree_le: '2026-11-18', caisse: 692, nombre_de_factures: 1 }],
    }, null],
    ['le même lot écrit 7 puis 7.0 : un doublon', {
      version: 1, agregats: [], lots: [{ numero: 7, cree_le: '2026-11-18', caisse: 691, nombre_de_factures: 1 },
        { numero: 7.0, cree_le: '2026-11-18', caisse: 691.0, nombre_de_factures: 1 }],
    }, R.doublonLot],
    ['un total dont la part est hors de la liste', avec(['agregats', 0, 'part'], 'forfait'), R.total],
    ['une part obligatoire sans son régime', avec(['agregats', 0, 'regime'], null), R.total],
    ['une part obligatoire sous un organisme complémentaire', avec(['agregats', 0, 'organisme_complementaire'], 12345678), R.total],
    ['une part complémentaire sous une caisse', avec(['agregats', 1, 'caisse'], 691), R.total],
    ['une part complémentaire sous son organisme', avec(['agregats', 1, 'organisme_complementaire'], 9_999_999_999), null],
    ['un organisme complémentaire de onze chiffres', avec(['agregats', 1, 'organisme_complementaire'], 10_000_000_000), R.total],
    ['un organisme complémentaire écrit en texte', avec(['agregats', 1, 'organisme_complementaire'], 'MUTUELLE ESSAI'), R.total],
    ['une fraction de centime', avec(['agregats', 0, 'montant_centimes'], 12000.5), R.total],
    ['un total négatif (un lot d’avoirs)', avec(['agregats', 2, 'montant_centimes'], -8000), null],
    ['moins de factures que de lots', avec(['agregats', 0, 'nombre_de_factures'], 1), R.total],
    ['deux totaux de même clé', avec(['agregats', 2], bon().agregats[0]), R.doublonTotal],
    ['un total à une date qu’aucun lot ne porte', avec(['agregats', 2, 'date_creation_lot'], '2026-11-16'), R.coherence],
    ['une part obligatoire sous une caisse qu’aucun lot du jour ne porte', avec(['agregats', 2, 'caisse'], 693), R.coherence],
    ['un total qui compte plus de lots que le jour n’en porte', (() => {
      const c = bon(); c.agregats[1] = { ...c.agregats[1], nombre_de_lots: 3, nombre_de_factures: 5 }; return c
    })(), R.coherence],
    ['un total qui compte plus de factures que ses lots', avec(['agregats', 2, 'nombre_de_factures'], 5), R.coherence],
  ])('%s', (_, imp, attendu) => {
    expect(refusDeLImportDuFacture(imp, JOUR)).toBe(attendu)
  })

  it('l’ordre de la base : un lot fautif décide avant un total fautif ; la forme d’un lot avant sa date', () => {
    const deux = avec(['lots', 0, 'cree_le'], '2026-11-20') as ImportDuFactureAEnvoyer
    deux.agregats[0] = { ...deux.agregats[0], part: 'autre' as never }
    expect(refusDeLImportDuFacture(deux, JOUR)).toBe(REFUS_DE_L_IMPORT_DU_FACTURE.aVenir)
    const forme = avec(['lots', 1, 'caisse'], 1000) as ImportDuFactureAEnvoyer
    forme.lots[0] = { ...forme.lots[0], cree_le: '2026-12-01' }
    expect(refusDeLImportDuFacture(forme, JOUR)).toBe(REFUS_DE_L_IMPORT_DU_FACTURE.aVenir)
    expect(refusDeLImportDuFacture(bon(), '2026-02-30')).toBe(REFUS_DE_L_IMPORT_DU_FACTURE.aVenir)
  })
})

describe('refusDeLImportDuFacture rejuge le relevé de la base : deux cent quarante et un imports tirés d’une graine fixe', () => {
  // Chaque cas a été jugé par `refus_de_l_import_des_factures_assurance_maladie` sur une réplique portée à la migration
  // (19/11/2026) ; le module doit rendre le même refus, au caractère près, ou nul avec elle.
  const releve = JSON.parse(readFileSync(resolve(process.cwd(), 'src/lib/importDuFactureAssuranceMaladie.releve.json'), 'utf8')) as
    { jour: string; cas: { import: unknown; refus: string | null }[] }
  it('chaque refus de la base est celui du module, et chaque issue du refus y paraît', () => {
    expect(releve.cas.length).toBeGreaterThanOrEqual(240)
    const ecarts = releve.cas.filter((c) => refusDeLImportDuFacture(c.import, releve.jour) !== c.refus)
    expect(ecarts).toEqual([])
    const issues = new Set(releve.cas.map((c) => c.refus))
    for (const mots of [...Object.values(REFUS_DE_L_IMPORT_DU_FACTURE), null]) expect(issues).toContain(mots)
  })
})

describe('le corps de l’appel, tiré de BOR2 : la base l’accepte, et il ne se compose qu’à l’appel', () => {
  const bordereau = (o: { lot: number; creeLe: string; code: string; libelle: string; factures: number; caisse: number; mutuelle: number }): BordereauLu => ({
    lot: o.lot, creeLe: o.creeLe, securise: false, organisme: { code: o.code, libelle: o.libelle }, nombreDeFactures: o.factures,
    totaux: { totalCentimes: o.caisse + o.mutuelle, caisseCentimes: o.caisse, mutuelleCentimes: o.mutuelle, assureCentimes: 0 },
  })

  it('cent envois tirés : chaque corps est bien formé pour la base, ses lots et ses totaux ceux de BOR2', () => {
    const t = tirage(20261119)
    const libelles = ['CPAM - VILLE FICTIVE', 'MSA - BOURG FICTIF']
    let prets = 0
    for (let essai = 0; essai < 100; essai++) {
      const n = 1 + entierTire(t, 6)
      const bs: BordereauLu[] = []
      for (let i = 0; i < n; i++) {
        const lot = 900_000_000 + entierTire(t, 99_999_999)
        if (bs.some((b) => b.lot === lot)) continue
        bs.push(bordereau({
          lot, creeLe: `2026-${String(1 + entierTire(t, 10)).padStart(2, '0')}-${String(1 + entierTire(t, 28)).padStart(2, '0')}`,
          code: String(entierTire(t, 4)).padStart(3, '0'), libelle: libelles[entierTire(t, libelles.length)],
          factures: 1 + entierTire(t, 40), caisse: entierTire(t, 500_000) - (entierTire(t, 10) === 0 ? 250_000 : 0),
          mutuelle: entierTire(t, 3) === 0 ? 0 : entierTire(t, 200_000),
        }))
      }
      const r = factureDesBordereaux(bs, { aujourdHui: JOUR, regimesChoisis: [] })
      if (r.etat !== 'pret') continue
      prets++
      const corps = corpsDeLImportDuFacture(r)
      expect(refusDeLImportDuFacture(JSON.parse(JSON.stringify(corps)), JOUR)).toBeNull()
      expect(corps.lots.map((l) => l.numero)).toEqual(bs.map((b) => b.lot))
      expect(corps.agregats.every((a) => a.organisme_complementaire === null)).toBe(true)
      expect(corps.agregats.filter((a) => a.part === 'complementaire').every((a) => a.regime === null && a.caisse === null)).toBe(true)
      const somme = (part: string) => corps.agregats.filter((a) => a.part === part).reduce((s, a) => s + a.montant_centimes, 0)
      expect(somme('obligatoire')).toBe(r.resume.obligatoireCentimes)
      expect(somme('complementaire')).toBe(r.resume.complementaireCentimes)
      // Ce que l'écran montre avant le clic (le résultat de BOR2) ne porte aucun numéro de lot ; le corps, qui part à l'appel, si.
      for (const b of bs) expect(JSON.stringify(r)).not.toContain(String(b.lot))
    }
    expect(prets).toBeGreaterThan(60)
  })

  it('ses clés, et aucune autre : trois pour l’import, quatre par lot, huit par total', () => {
    const r = factureDesBordereaux([bordereau({ lot: 999999001, creeLe: '2026-10-05', code: '691', libelle: 'CPAM - VILLE FICTIVE', factures: 3, caisse: 4500, mutuelle: 1200 })],
      { aujourdHui: JOUR, regimesChoisis: [] })
    if (r.etat !== 'pret') throw new Error(r.etat)
    const corps = corpsDeLImportDuFacture(r)
    expect(Object.keys(corps).sort()).toEqual(['agregats', 'lots', 'version'])
    expect(corps.lots).toEqual([{ numero: 999999001, cree_le: '2026-10-05', caisse: 691, nombre_de_factures: 3 }])
    expect(corps.agregats).toEqual([
      { date_creation_lot: '2026-10-05', part: 'obligatoire', regime: 1, caisse: 691, organisme_complementaire: null, montant_centimes: 4500, nombre_de_lots: 1, nombre_de_factures: 3 },
      { date_creation_lot: '2026-10-05', part: 'complementaire', regime: null, caisse: null, organisme_complementaire: null, montant_centimes: 1200, nombre_de_lots: 1, nombre_de_factures: 3 },
    ])
  })
})
