import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { decoderLeFichier, decouperLeFichier, tableauDuFichier } from './contactsImportFichier'
import {
  confrontationAuxPaiementsEnBase,
  genresDesColonnes,
  importAEnvoyer,
  lireLesPaiements,
  PAIEMENTS_ASSURANCE_MALADIE_PREVUS,
  REFUS_DE_LA_FONCTION,
  REFUS_DE_L_IMPORT,
  refusAvantLEnvoi,
  refusDeLImport,
  refusDuConflit,
  refusDuReglage,
  statutDe,
  type ImportAEnvoyer,
  type PaiementAgrege,
  type ReglageDesColonnes,
} from './paiementsAssuranceMaladie'

// LES PAIEMENTS DE L'ASSURANCE MALADIE (conception 53, NOE1 et NOE2) : la lecture d'un export fabriqué — des noms, des NIR,
// des dates de naissance et de soins, des numéros de facture, de lot et de virement MANIFESTEMENT FAUX — dont rien d'autre
// que des agrégats ne sort ; les refus de la base, confrontés au texte de la migration préparée et redits sous ses mots ;
// l'essai de la base : supabase/essais/paiementsAssuranceMaladie.sql, sur une réplique.

const MIGRATION = 'supabase/preparees/20261116190000_paiements_assurance_maladie.sql'
const RETOUR = 'supabase/preparees/retour/20261116190100_retour_paiements_assurance_maladie.sql'
const ESSAI = 'supabase/essais/paiementsAssuranceMaladie.sql'
const texteDeLaMigration = readFileSync(resolve(process.cwd(), MIGRATION), 'utf8')

// ── Un export FICTIF du suivi des factures en tiers payant (aucune donnée réelle) ──────────────────────────────────────
// Ce qui ne doit JAMAIS sortir de la lecture : chaque valeur de patient, de facture, de lot et de virement.
const SECRETS = [
  'DUPONT-ESSAI', 'Jeannine', 'MARTIN-FICTIF', 'LEFAUX', 'BIDON', 'TEST Jean', 'ESSAI Léa',
  '2 99 99 99 999 999', '299999999999', '12/03/1985', '1985-03-12', '01/07/1950', '1950', '30/12/2001',
  '28/10/2026', '2026-10-28', '29/10/2026', '2026-10-29', '30/10/2026', '2026-10-30',
  'F-7788', '778801', 'L-4455', '445501', 'VIR CPAM', '0099887766', 'douze', 'Payée', 'Rejetée', 'En attente',
]
const EXPORT = [
  'N° facture;N° lot;Nom du patient;NIR;Date de naissance;Date des soins;Journée comptable;Régime;Caisse;Montant AMO;Statut AMO;Montant AMC;Statut AMC;Référence du virement',
  'F-778801;L-445501;DUPONT-ESSAI Jeannine;2 99 99 99 999 999 01;12/03/1985;28/10/2026;02/11/2026;01;691;26,50;Payée;7,90;Payée;VIR CPAM 0099887766261102',
  'F-778802;L-445501;MARTIN-FICTIF Paul;1 99 99 99 999 999 02;01/07/1950;28/10/2026;02/11/2026;01;691;19,00;Payée;;;VIR CPAM 0099887766261102',
  'F-778803;L-445502;LEFAUX Zoé;2 99 99 99 999 999 03;30/12/2001;29/10/2026;03/11/2026;01;691;-5,00;Payée;;;VIR CPAM 0099887766261103',
  'F-778804;L-445502;BIDON Marc;1 99 99 99 999 999 04;05/05/1977;29/10/2026;03/11/2026;01;691;12,00;Rejetée;3,00;Rejetée;',
  'F-778805;L-445503;ESSAI Léa;2 99 99 99 999 999 05;14/02/1990;30/10/2026;04/11/2026;01;691;douze;Payée;;;VIR CPAM 0099887766261104',
  'F-778806;L-445503;TEST Jean;1 99 99 99 999 999 06;20/09/1960;30/10/2026;04/11/2026;01;691;30,00;En attente;;;',
  'F-778807;L-445504;DUPONT-ESSAI Jeannine;2 99 99 99 999 999 01;12/03/1985;31/10/2026;LEFAUX;01;691;9,00;Payée;;;',
  '',
].join('\r\n')

// Les colonnes, par leur rang dans l'en-tête : les seules que le réglage nomme.
const REGLAGE: ReglageDesColonnes = {
  parts: [
    { part: 'obligatoire', journee: 6, montant: 9, statut: 10, regime: 7, caisse: 8 },
    { part: 'complementaire', journee: 6, montant: 11, statut: 12, regime: 7, caisse: 8 },
  ],
}

function lignesDuFichier(texte: string) {
  const decode = decoderLeFichier(new TextEncoder().encode(texte), 'client')
  if ('refus' in decode) throw new Error(decode.refus)
  const decoupe = decouperLeFichier(decode.texte, ';', 'client')
  if ('refus' in decoupe) throw new Error(decoupe.refus)
  return tableauDuFichier(decoupe.enregistrements, true)
}

const paiement = (p: Partial<PaiementAgrege> = {}): PaiementAgrege => ({
  date_journee_comptable: '2026-11-02', regime: 1, caisse: 691, part: 'obligatoire',
  montant_centimes: 4550, regularisations_centimes: 0, nombre_de_factures: 2, ...p,
})
const importDe = (paiements: PaiementAgrege[], rejets: ImportAEnvoyer['rejets'] = { nombre: 2, montant_centimes: 1500 }): ImportAEnvoyer =>
  ({ version: 1, paiements, rejets })
const JOUR = '2026-11-16'

describe('le drapeau et les fichiers de la migration', () => {
  it('baissé, la migration préparée, son retour et son essai à côté, hors de l’export', () => {
    expect(PAIEMENTS_ASSURANCE_MALADIE_PREVUS).toBe(false)
    for (const f of [MIGRATION, RETOUR, ESSAI]) expect(existsSync(resolve(process.cwd(), f))).toBe(true)
    expect(existsSync(resolve(process.cwd(), 'supabase/schema/20261116190000_paiements_assurance_maladie.sql'))).toBe(false)
  })
})

describe('les mots de la base, au caractère près', () => {
  const sql = (s: string) => s.replace(/''/g, '\'')
  it('les sept constantes du refus sont celles de `refus_de_l_import_assurance_maladie`, dans son ordre', () => {
    const constantes = [...texteDeLaMigration.matchAll(/c_(\w+) constant text := '((?:[^']|'')*)';/g)].map((m) => [m[1], sql(m[2])])
    expect(constantes).toEqual([
      ['forme', REFUS_DE_L_IMPORT.forme], ['nombre', REFUS_DE_L_IMPORT.nombre], ['paiement', REFUS_DE_L_IMPORT.paiement],
      ['a_venir', REFUS_DE_L_IMPORT.aVenir], ['coherence', REFUS_DE_L_IMPORT.coherence], ['doublon', REFUS_DE_L_IMPORT.doublon],
      ['rejets', REFUS_DE_L_IMPORT.rejets],
    ])
  })

  it('les refus des deux fonctions, et le conflit sous sa journée', () => {
    for (const mots of Object.values(REFUS_DE_LA_FONCTION)) {
      expect(texteDeLaMigration).toContain(`'${mots.replace(/'/g, '\'\'')}'`)
    }
    expect(refusDuConflit('2026-11-02')).toBe('Un paiement de l\'import est déjà en base avec d\'autres chiffres (la journée comptable du 02/11/2026) : retirer d\'abord l\'import qui le porte.')
    expect(texteDeLaMigration).toContain('\'Un paiement de l\'\'import est déjà en base avec d\'\'autres chiffres (la journée comptable du %) : retirer d\'\'abord l\'\'import qui le porte.\'')
  })
})

describe('refusDeLImport redit la forme que la base exige, dans son ordre (les étapes 28 à 46 de l’essai)', () => {
  const bon = importDe([paiement(), paiement({ part: 'complementaire', montant_centimes: 790, nombre_de_factures: 1 }),
    paiement({ date_journee_comptable: '2026-11-03', regime: null, caisse: null, part: 'forfait', montant_centimes: 50000, nombre_de_factures: 0 }),
    paiement({ date_journee_comptable: '2026-11-04', montant_centimes: 900, regularisations_centimes: -100, nombre_de_factures: 1 })])
  const avec = (chemin: (string | number)[], valeur: unknown): unknown => {
    const copie = JSON.parse(JSON.stringify(bon)) as Record<string, unknown>
    let o: Record<string, unknown> = copie
    for (const c of chemin.slice(0, -1)) o = o[c] as Record<string, unknown>
    o[chemin[chemin.length - 1]] = valeur
    return copie
  }
  it.each([
    ['bien formé', bon, null],
    ['la version 2', avec(['version'], 2), REFUS_DE_L_IMPORT.forme],
    ['une clé de plus, un texte libre', { ...bon, note: 'texte libre' }, REFUS_DE_L_IMPORT.forme],
    ['des rejets dits par un nombre seul', avec(['rejets'], 3), REFUS_DE_L_IMPORT.forme],
    ['des rejets absents', { version: 1, paiements: bon.paiements }, REFUS_DE_L_IMPORT.forme],
    ['aucun paiement', avec(['paiements'], []), REFUS_DE_L_IMPORT.nombre],
    ['un paiement qui porte un nom', avec(['paiements', 0, 'nom'], 'DUPONT-ESSAI'), REFUS_DE_L_IMPORT.paiement],
    ['un organisme dit par un texte', avec(['paiements', 0, 'regime'], '01'), REFUS_DE_L_IMPORT.paiement],
    ['une part hors de la liste', avec(['paiements', 0, 'part'], 'autre'), REFUS_DE_L_IMPORT.paiement],
    ['une fraction de centime', avec(['paiements', 0, 'montant_centimes'], 4550.5), REFUS_DE_L_IMPORT.paiement],
    ['une régularisation positive', avec(['paiements', 0, 'regularisations_centimes'], 100), REFUS_DE_L_IMPORT.paiement],
    ['un jour qui n’existe pas', avec(['paiements', 0, 'date_journee_comptable'], '2026-02-30'), REFUS_DE_L_IMPORT.paiement],
    ['un 29 février d’une année commune', avec(['paiements', 0, 'date_journee_comptable'], '2025-02-29'), REFUS_DE_L_IMPORT.paiement],
    ['une journée d’avant 2000', avec(['paiements', 0, 'date_journee_comptable'], '1999-12-31'), REFUS_DE_L_IMPORT.paiement],
    ['une journée à venir', avec(['paiements', 0, 'date_journee_comptable'], '2026-11-17'), REFUS_DE_L_IMPORT.aVenir],
    ['un forfait qui paierait une facture', avec(['paiements', 2, 'nombre_de_factures'], 1), REFUS_DE_L_IMPORT.coherence],
    ['un paiement de factures qui n’en paie aucune', avec(['paiements', 0, 'nombre_de_factures'], 0), REFUS_DE_L_IMPORT.coherence],
    ['un paiement de rien', avec(['paiements', 2, 'montant_centimes'], 0), REFUS_DE_L_IMPORT.coherence],
    ['deux paiements de même clé', avec(['paiements', 1, 'part'], 'obligatoire'), REFUS_DE_L_IMPORT.doublon],
    ['un montant rejeté sans rejet', avec(['rejets', 'nombre'], 0), REFUS_DE_L_IMPORT.rejets],
    ['des rejets qui portent un texte', avec(['rejets', 'motif'], 'libellé du rejet'), REFUS_DE_L_IMPORT.rejets],
    ['des rejets non dits', avec(['rejets'], null), null],
  ])('%s', (_, imp, attendu) => {
    expect(refusDeLImport(imp, JOUR)).toBe(attendu)
  })

  it('l’ordre de la base : le premier paiement fautif décide, sa forme avant sa journée, sa journée avant sa cohérence', () => {
    const deux = avec(['paiements', 0, 'date_journee_comptable'], '2026-11-17') as ImportAEnvoyer
    deux.paiements[1] = { ...deux.paiements[1], part: 'autre' as never }
    expect(refusDeLImport(deux, JOUR)).toBe(REFUS_DE_L_IMPORT.aVenir)
    const forfait = avec(['paiements', 2, 'nombre_de_factures'], 1) as ImportAEnvoyer
    forfait.paiements[2] = { ...forfait.paiements[2], date_journee_comptable: '2026-12-01' }
    expect(refusDeLImport(forfait, JOUR)).toBe(REFUS_DE_L_IMPORT.aVenir)
  })
})

describe('refusDeLImport rejuge le relevé de la base : deux cents imports fictifs tirés d’une graine fixe', () => {
  // Chaque cas a été jugé par `refus_de_l_import_assurance_maladie` sur une réplique portée à la migration (16/11/2026) ; le
  // module doit rendre le même refus, au caractère près, ou nul avec elle.
  const releve = JSON.parse(readFileSync(resolve(process.cwd(), 'src/lib/paiementsAssuranceMaladie.releve.json'), 'utf8')) as
    { jour: string; cas: { import: unknown; refus: string | null }[] }
  it('chaque refus de la base est celui du module, et chaque issue du refus y paraît', () => {
    expect(releve.cas.length).toBeGreaterThanOrEqual(200)
    const ecarts = releve.cas.filter((c) => refusDeLImport(c.import, releve.jour) !== c.refus)
    expect(ecarts).toEqual([])
    const issues = new Set(releve.cas.map((c) => c.refus))
    for (const mots of [...Object.values(REFUS_DE_L_IMPORT), null]) expect(issues).toContain(mots)
  })
})

describe('le conflit et « rien de neuf », avant le clic (les étapes 23 à 25 de l’essai)', () => {
  const premier = importDe([paiement(), paiement({ date_journee_comptable: '2026-11-03' })])
  it('un même fichier : rien de neuf ; une journée de plus : un paiement nouveau ; d’autres chiffres : la journée nommée', () => {
    expect(refusAvantLEnvoi(premier, JOUR, premier.paiements)).toBe(REFUS_DE_LA_FONCTION.rienDeNeuf)
    const plus = importDe([...premier.paiements, paiement({ date_journee_comptable: '2026-11-04' })])
    expect(confrontationAuxPaiementsEnBase(plus, premier.paiements)).toEqual({ conflit: null, nouveaux: 1, dejaImportes: 2 })
    expect(refusAvantLEnvoi(plus, JOUR, premier.paiements)).toBeNull()
    const autre = importDe([paiement({ date_journee_comptable: '2026-11-03', montant_centimes: 4551 }), paiement({ montant_centimes: 4551 })])
    expect(refusAvantLEnvoi(autre, JOUR, premier.paiements)).toBe(refusDuConflit('2026-11-02'))
  })
  it('deux organismes non dits se heurtent, comme sous `nulls not distinct`', () => {
    const sans = paiement({ regime: null, caisse: null })
    expect(confrontationAuxPaiementsEnBase(importDe([sans]), [sans]).nouveaux).toBe(0)
    expect(confrontationAuxPaiementsEnBase(importDe([sans]), [paiement()]).nouveaux).toBe(1)
  })
})

describe('la lecture d’un export fabriqué : des agrégats, et rien d’autre', () => {
  const { colonnes, lignes } = lignesDuFichier(EXPORT)
  const lecture = lireLesPaiements(lignes, REGLAGE)

  it('les agrégats par journée comptable, organisme et part ; les rejets ; la période', () => {
    expect(colonnes).toHaveLength(14)
    expect(lecture.paiements).toEqual([
      paiement({ part: 'complementaire', montant_centimes: 790, nombre_de_factures: 1 }),
      paiement({ montant_centimes: 4550, nombre_de_factures: 2 }),
      paiement({ date_journee_comptable: '2026-11-03', montant_centimes: -500, regularisations_centimes: -500, nombre_de_factures: 0 }),
    ])
    expect(lecture.rejets).toEqual({ nombre: 2, montant_centimes: 1500 })
    expect(lecture.periode).toEqual({ du: '2026-11-02', au: '2026-11-03' })
    expect(lecture.lignes).toBe(7)
  })

  it('ce qui n’est pas sûr s’écarte et se compte, sous sa ligne et sa raison — jamais zéro, jamais la valeur', () => {
    expect(lecture.ecartees).toEqual([
      { ligne: 6, part: 'obligatoire', raison: 'montant' },
      { ligne: 8, part: 'obligatoire', raison: 'journee' },
    ])
    expect(lecture.enAttente).toBe(1)
    expect(lecture.sansMontant).toBe(5)
  })

  it('AUCUNE valeur de patient, de facture, de lot ni de virement ne sort de la lecture, ni de l’import qui part', () => {
    const sortie = JSON.stringify({ lecture, envoi: importAEnvoyer(lecture), genres: genresDesColonnes(lignes, colonnes.length) })
    for (const secret of SECRETS) expect(sortie, secret).not.toContain(secret)
    // Les seules dates qui sortent sont des journées comptables du fichier.
    expect([...new Set(sortie.match(/\d{4}-\d{2}-\d{2}/g))].sort()).toEqual(['2026-11-02', '2026-11-03'])
  })

  it('l’import qui part a la forme que la base accepte, et ses sept clés seulement', () => {
    const envoi = importAEnvoyer(lecture)
    expect(envoi).not.toBeNull()
    expect(refusDeLImport(envoi, JOUR)).toBeNull()
    expect(Object.keys(envoi!.paiements[0]).sort()).toEqual(['caisse', 'date_journee_comptable', 'montant_centimes',
      'nombre_de_factures', 'part', 'regime', 'regularisations_centimes'])
    expect(importAEnvoyer(lireLesPaiements([], REGLAGE))).toBeNull()
  })

  it('sans colonne de statut, les rejets ne sont pas dits (nuls, jamais zéro) et toute part lue est payée', () => {
    const sansStatut = lireLesPaiements(lignes, { parts: [{ ...REGLAGE.parts[0], statut: null }] })
    expect(sansStatut.rejets).toBeNull()
    expect(sansStatut.paiements.map((p) => [p.date_journee_comptable, p.montant_centimes, p.nombre_de_factures])).toEqual([
      ['2026-11-02', 4550, 2], ['2026-11-03', 700, 1], ['2026-11-04', 3000, 1],
    ])
  })

  it('un organisme qui n’est pas un code en chiffres écarte la part ; sans colonne d’organisme, il n’est pas dit', () => {
    const mauvais = lireLesPaiements(lignes, { parts: [{ ...REGLAGE.parts[0], regime: 2 }] })
    expect(mauvais.paiements).toEqual([])
    expect(new Set(mauvais.ecartees.map((e) => e.raison))).toEqual(new Set(['organisme', 'montant', 'journee']))
    const sansOrganisme = lireLesPaiements(lignes, { parts: [{ ...REGLAGE.parts[0], regime: null, caisse: null }] })
    expect(sansOrganisme.paiements.every((p) => p.regime === null && p.caisse === null)).toBe(true)
  })

  it('le genre des colonnes, sans une valeur : la journée, les montants, les codes, les statuts', () => {
    const genres = genresDesColonnes(lignes, colonnes.length)
    expect(genres[5]).toMatchObject({ date: true, montant: false })
    expect(genres[6]).toMatchObject({ date: false })
    expect(genres[7]).toMatchObject({ code: true, montant: true, date: false })
    expect(genres[9]).toMatchObject({ montant: false, date: false })
    expect(genres[10]).toMatchObject({ statut: true })
    expect(genres[11]).toMatchObject({ montant: true })
    expect(genres[2]).toMatchObject({ date: false, montant: false, code: false, statut: false, vide: false })
  })
})

describe('le réglage et les statuts', () => {
  it('une ou deux parts, différentes, dans le fichier, une colonne par usage', () => {
    expect(refusDuReglage(REGLAGE, 14)).toBeNull()
    expect(refusDuReglage({ parts: [] }, 14)).toMatch(/une part au moins/)
    expect(refusDuReglage({ parts: [REGLAGE.parts[0], REGLAGE.parts[0]] }, 14)).toMatch(/qu’une fois/)
    expect(refusDuReglage({ parts: [{ ...REGLAGE.parts[0], montant: 14 }] }, 14)).toMatch(/pas dans le fichier/)
    expect(refusDuReglage({ parts: [{ ...REGLAGE.parts[0], statut: 9 }] }, 14)).toMatch(/qu’à un usage/)
  })
  it('une liste fermée, sans casse ni accents ; un mot inconnu n’est rien', () => {
    expect(['Payée', 'PAYE', ' réglée ', 'Rejetée', 'refus', 'En  attente', 'Traitement caisse'].map(statutDe))
      .toEqual(['payee', 'payee', 'payee', 'rejetee', 'rejetee', 'en_attente', 'en_attente'])
    expect(statutDe('DUPONT-ESSAI')).toBeNull()
    expect(statutDe('')).toBeNull()
  })
})
