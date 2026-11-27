import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { motsDuCabinet } from './espaceVentes'
import type { ImportAEnvoyer, PaiementAgrege } from './paiementsAssuranceMaladie'
import { REFUS_DE_L_IMPORT, refusDuConflit } from './paiementsAssuranceMaladie'
import {
  REFUS_DU_REMPLACEMENT, REMPLACEMENT_DES_JOURNEES_PREVU, TABLES_DES_REMPLACEMENTS_ASSURANCE_MALADIE, boutonDuRemplacement,
  confirmationDuRemplacement, journeeARemplacerDite, journeesRemplacees, presentationDuRemplacement, refusDeLaJourneeAssociee,
  refusDeLaJourneeAssocieeDit, refusDuRemplacementAvantLEnvoi, remplacementDesJournees, retraitDUnImportQuiARemplaceDit,
  type PaiementLuEnBase,
} from './remplacementDesJourneesAssuranceMaladie'

// LE REMPLACEMENT D'UNE JOURNÉE COMPTABLE (NOE4R-Q2 (B), conception 53, § 14.2) : les mots de la base, confrontés au texte de la
// migration (préparée, ou rangée dans l'export le jour de son application : ce test passe dans les deux états) ; le calcul que la
// base fait — la journée telle que l'export la porte, la version lue, la journée associée — redit sur des paiements fabriqués ;
// les mots de l'écran, ceux du client sans un mot du cabinet. L'essai de la base : supabase/essais/
// remplacementDesJourneesAssuranceMaladie.sql, sur une réplique.

const NOM = /^\d{14}_remplacement_des_journees_assurance_maladie\.sql$/
const ou = (dossier: string) => {
  const chemin = resolve(process.cwd(), `supabase/${dossier}`)
  const nom = readdirSync(chemin).find((n) => NOM.test(n))
  return nom ? `${chemin}/${nom}` : null
}
const PREPAREE = ou('preparees')
const RANGEE = ou('schema')
const MIGRATION = readFileSync((RANGEE ?? PREPAREE)!, 'utf8')
const sql = (s: string) => s.replace(/'/g, '\'\'')

const paiement = (p: Partial<PaiementLuEnBase> = {}): PaiementLuEnBase => ({
  id: 'p-oblig', date_journee_comptable: '2026-11-02', regime: 1, caisse: 691, organisme_complementaire: null, part: 'obligatoire',
  montant_centimes: 12345, regularisations_centimes: 0, nombre_de_factures: 7, ...p,
})
const sansId = ({ id: _id, ...p }: PaiementLuEnBase): PaiementAgrege => p
const importDe = (paiements: PaiementAgrege[]): ImportAEnvoyer => ({ version: 1, paiements, rejets: { nombre: 1, montant_centimes: 300 } })
const JOUR = '2026-11-16'

// En base : le 02/11, la part obligatoire et la complémentaire ; le 03/11, un forfait ; le 04/11, la part obligatoire.
const EN_BASE: PaiementLuEnBase[] = [
  paiement(),
  paiement({ id: 'p-compl', part: 'complementaire', montant_centimes: 2345, nombre_de_factures: 3 }),
  paiement({ id: 'p-forfait', date_journee_comptable: '2026-11-03', regime: null, caisse: null, part: 'forfait', montant_centimes: 50000, nombre_de_factures: 0 }),
  paiement({ id: 'p-j4', date_journee_comptable: '2026-11-04', montant_centimes: 900, regularisations_centimes: -100, nombre_de_factures: 1 }),
]
// Le nouvel export : le 02/11, la part obligatoire avec d'autres chiffres et une autre caisse, neuve ; le 04/11, aux mêmes chiffres.
const FICHIER = importDe([
  sansId(paiement({ montant_centimes: 13000, nombre_de_factures: 8 })),
  sansId(paiement({ caisse: 692, montant_centimes: 1500, nombre_de_factures: 1 })),
  sansId(EN_BASE[3]),
])

describe('la migration, préparée ou rangée, et le drapeau', () => {
  it('elle est à un seul endroit ; préparée, le drapeau est baissé ; rangée, levé ; son retour et ses essais à côté', () => {
    expect([PREPAREE, RANGEE].filter((c) => c !== null)).toHaveLength(1)
    expect(REMPLACEMENT_DES_JOURNEES_PREVU).toBe(RANGEE !== null)
    for (const f of ['supabase/preparees/retour/20261127191100_retour_remplacement_des_journees_assurance_maladie.sql',
      'supabase/essais/remplacementDesJourneesAssuranceMaladie.sql', 'supabase/essais/remplacementDesJourneesAssuranceMaladieSuppression.sql']) {
      expect(existsSync(resolve(process.cwd(), f)), f).toBe(true)
    }
  })

  it('elle crée la seule table que le plan déclare, et suit celle de la période (NOE4R-Q1) à son empreinte', () => {
    expect([...MIGRATION.matchAll(/^create\s+table\s+public\.([a-z_]+)\s*\(/gim)].map((m) => m[1])).toEqual([...TABLES_DES_REMPLACEMENTS_ASSURANCE_MALADIE])
    // La garde de tête exige le corps de la fonction d'import que NOE4R-Q1 pose : l'empreinte de son corps dans le fichier de
    // cette migration-là, préparée ou rangée.
    const q1 = ['preparees', 'schema'].map((d) => resolve(process.cwd(), `supabase/${d}`))
      .flatMap((d) => readdirSync(d).filter((n) => /^\d{14}_periode_des_imports_assurance_maladie\.sql$/.test(n)).map((n) => `${d}/${n}`))
    expect(q1).toHaveLength(1)
    const texteQ1 = readFileSync(q1[0], 'utf8')
    const empreinte = /if v_empreinte = '([0-9a-f]{32})' then\s+raise exception 'La migration periode_des_imports_assurance_maladie est déjà en base/.exec(texteQ1)?.[1]
    expect(empreinte).toMatch(/^[0-9a-f]{32}$/)
    expect(MIGRATION).toContain(`('importer_paiements_assurance_maladie', 'public.importer_paiements_assurance_maladie(uuid,jsonb)', '${empreinte}')`)
  })
})

describe('les mots de la base, au caractère près', () => {
  it('les quatre constantes du remplacement sont celles de `remplacer_journees_assurance_maladie`, dans son ordre', () => {
    const constantes = [...MIGRATION.matchAll(/c_(\w+) constant text := '((?:[^']|'')*)';/g)].map((m) => [m[1], m[2].replace(/''/g, '\'')])
    expect(constantes).toEqual([
      ['forme', REFUS_DU_REMPLACEMENT.forme], ['rien', REFUS_DU_REMPLACEMENT.rien], ['change', REFUS_DU_REMPLACEMENT.change],
      ['trace', REFUS_DU_REMPLACEMENT.trace],
    ])
  })

  it('le refus d’une journée associée, sous sa journée ; et ceux de la garde de la trace', () => {
    expect(refusDeLaJourneeAssociee('2026-11-02')).toBe('La journée comptable du 02/11/2026 porte un paiement associé à un crédit du '
      + 'relevé : elle ne se remplace pas tant que cette association n\'est pas défaite.')
    expect(MIGRATION).toContain(`'${sql('La journée comptable du % porte un paiement associé à un crédit du relevé : elle ne se remplace pas tant que cette association n\'est pas défaite.')}'`)
    // Les refus de l'import que le remplacement reprend, sous les mêmes mots (la forme, l'exercice validé) : ceux de NOE3.
    expect(MIGRATION).toContain(`'${sql('Un paiement de l\'import tombe dans un exercice que le cabinet a validé : il ne s\'importe plus.')}'`)
    expect(MIGRATION).toContain('v_refus := public.refus_de_l_import_assurance_maladie(p_import, v_jour);')
  })
})

describe('le calcul de la base, redit : la journée telle que l’export la porte', () => {
  it('la journée du 02/11 : la part qui diffère remplacée, la caisse neuve ajoutée, la complémentaire que le fichier ne porte pas gardée', () => {
    const r = remplacementDesJournees(FICHIER, EN_BASE, new Set())
    expect(r.journees).toEqual([{
      journee: '2026-11-02', totalEnBase: 12345 + 2345, totalApres: 13000 + 1500 + 2345, remplaces: 1, ajoutes: 1, gardes: 1, associee: false,
    }])
    // La version : TOUS les paiements en base de la journée, jamais ceux d'une autre ; le retiré : celui qui diffère seul.
    expect(r.paiementsLus).toEqual(['p-compl', 'p-oblig'])
    expect(r.remplaces).toEqual(['p-oblig'])
    expect(refusDuRemplacementAvantLEnvoi(FICHIER, JOUR, r)).toBeNull()
  })

  it('un fichier qui ne diffère de la base sur aucune journée : rien à remplacer', () => {
    const r = remplacementDesJournees(importDe(EN_BASE.map(sansId)), EN_BASE, new Set())
    expect(r).toEqual({ journees: [], paiementsLus: [], remplaces: [] })
    expect(refusDuRemplacementAvantLEnvoi(importDe(EN_BASE.map(sansId)), JOUR, r)).toBe(REFUS_DU_REMPLACEMENT.rien)
  })

  it('une journée dont un paiement est associé — même un paiement que le fichier ne remplace pas — se refuse, nommée ; une autre journée associée ne retient rien', () => {
    const associee = remplacementDesJournees(FICHIER, EN_BASE, new Set(['p-compl']))
    expect(associee.journees[0].associee).toBe(true)
    expect(refusDuRemplacementAvantLEnvoi(FICHIER, JOUR, associee)).toBe(refusDeLaJourneeAssociee('2026-11-02'))
    const ailleurs = remplacementDesJournees(FICHIER, EN_BASE, new Set(['p-j4', 'p-forfait']))
    expect(refusDuRemplacementAvantLEnvoi(FICHIER, JOUR, ailleurs)).toBeNull()
  })

  it('deux journées à remplacer : chacune à part, dans l’ordre des dates ; la plus ancienne associée se dit', () => {
    // Le 04/11 aussi, avec d'autres chiffres.
    const fichier = importDe([FICHIER.paiements[0], FICHIER.paiements[1],
      sansId(paiement({ date_journee_comptable: '2026-11-04', montant_centimes: 1000, regularisations_centimes: -100, nombre_de_factures: 2 }))])
    const r = remplacementDesJournees(fichier, EN_BASE, new Set(['p-j4', 'p-oblig']))
    expect(r.journees.map((j) => [j.journee, j.remplaces, j.associee])).toEqual([['2026-11-02', 1, true], ['2026-11-04', 1, true]])
    expect(r.paiementsLus).toEqual(['p-compl', 'p-j4', 'p-oblig'])
    expect(refusDuRemplacementAvantLEnvoi(fichier, JOUR, r)).toBe(refusDeLaJourneeAssociee('2026-11-02'))
  })

  it('la forme de l’import passe d’abord, sous les mots de la base ; un organisme complémentaire est de la clé', () => {
    const mauvais = { ...FICHIER, version: 2 } as unknown as ImportAEnvoyer
    expect(refusDuRemplacementAvantLEnvoi(mauvais, JOUR, remplacementDesJournees(FICHIER, EN_BASE, new Set()))).toBe(REFUS_DE_L_IMPORT.forme)
    // Un paiement complémentaire nommé ne remplace pas le non dit : il est neuf, et la journée n'a rien à remplacer de lui.
    const nomme = importDe([sansId({ ...EN_BASE[1], organisme_complementaire: 1234567890, montant_centimes: 999, nombre_de_factures: 1 })])
    expect(remplacementDesJournees(nomme, EN_BASE, new Set()).journees).toEqual([])
  })

  it('l’import seul, lui, refuse toujours le conflit sous ses mots d’hier : le remplacement est un autre geste', () => {
    expect(refusDuConflit('2026-11-02')).toContain('retirer d\'abord l\'import qui le porte')
  })
})

describe('les mots de l’écran', () => {
  const r = remplacementDesJournees(FICHIER, EN_BASE, new Set())

  it('la journée nommée, son total en base et son total après, et ce qui change ; le bouton', () => {
    expect(journeeARemplacerDite(r.journees[0]).replace(/[\u00a0\u202f]/g, ' ')).toBe('Journée comptable du 02/11/2026 : 146,90 € en base, '
      + '168,45 € après le remplacement — 1 paiement remplacé, 1 ajouté, 1 gardé (que le fichier ne porte pas).')
    expect(boutonDuRemplacement(1)).toBe('Remplacer la journée et importer')
    expect(boutonDuRemplacement(3)).toBe('Remplacer 3 journées et importer')
  })

  it('la confirmation nomme chaque journée et dit ce que le geste ne défera pas', () => {
    const texte = confirmationDuRemplacement(r, 'cabinet').replace(/[\u00a0\u202f]/g, ' ')
    expect(texte).toBe('Remplacer une journée comptable — le 02/11/2026, 146,90 € en base, 168,45 € après. 1 paiement en base quitte '
      + 'l’import qui l’avait apporté pour celui-ci ; ses anciens chiffres restent dans la trace des remplacements. Retirer ce '
      + 'nouvel import ne le rendra pas : il faudrait réimporter l’ancien fichier.')
    expect(confirmationDuRemplacement(r, 'client')).toContain('réimporter ton ancien fichier')
  })

  it('la journée associée : la raison au cabinet et le geste ; au praticien, à qui s’adresser', () => {
    expect(refusDeLaJourneeAssocieeDit('2026-11-02', 'cabinet')).toBe(`${refusDeLaJourneeAssociee('2026-11-02')} Ouvrir la fiche du crédit dans le relevé, puis « Défaire l’association ».`)
    expect(refusDeLaJourneeAssocieeDit('2026-11-02', 'client')).toContain('Ton cabinet doit d’abord défaire cette association')
  })

  it('la trace regroupée par import et par journée, les plus récentes d’abord', () => {
    const trace = (p: Partial<Parameters<typeof journeesRemplacees>[0][number]>) => ({
      id: 't', import_id: 'i2', ancien_import_id: 'i1', date_journee_comptable: '2026-11-02', ancien_montant_centimes: 100,
      nouveau_montant_centimes: 150, remplace_le: '2026-11-20T10:00:00Z', ...p,
    })
    expect(journeesRemplacees([
      trace({ id: 't1' }), trace({ id: 't2', ancien_montant_centimes: 50, nouveau_montant_centimes: 60 }),
      trace({ id: 't3', import_id: 'i3', date_journee_comptable: '2026-11-04', remplace_le: '2026-11-21T10:00:00Z' }),
    ])).toEqual([
      { importId: 'i3', journee: '2026-11-04', le: '2026-11-21T10:00:00Z', paiements: 1, avant: 100, apres: 150 },
      { importId: 'i2', journee: '2026-11-02', le: '2026-11-20T10:00:00Z', paiements: 2, avant: 150, apres: 210 },
    ])
  })

  it('les phrases du client ne portent aucun mot du cabinet', () => {
    const textes = [presentationDuRemplacement(2, 'client'), confirmationDuRemplacement(r, 'client'),
      refusDeLaJourneeAssocieeDit('2026-11-02', 'client'), retraitDUnImportQuiARemplaceDit(2, 'client')]
    for (const t of textes) expect(motsDuCabinet(t)).toEqual([])
  })
})
