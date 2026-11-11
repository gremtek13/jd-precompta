import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { definitionsSql } from '../test/schema'
import {
  CLES_DE_LA_REPRISE, DRAPEAU_DES_REPRISES_AU_CLIENT, FONCTION_DE_LA_REPRISE, FONCTION_DES_PIECES_CITEES,
  REFUS_DES_REPRISES_AU_CLIENT, lectureDeLaReprise, lireLaRepriseDeLaFacture, lireLesPiecesCiteesDeLaSimulation,
  piecesCiteesRendues, repriseDeLaFactureRendue, reprisesAuClientPrevues,
} from './reprisesAuClient'
import {
  refusEnregistrementVente, resteAEncaisserDeLaReprise, type ContexteFacture, type FacturePourEncaissement,
  type LigneDeFacture, type SaisieEncaissement,
} from './encaissementsFactures'

// LES FACTURES REPRISES, AU CLIENT (A8C-Q1, A8Q5-Q2) : le module lit ce que les deux fonctions de la migration
// `reprises_au_client` rendent — préparée le 11/11/2026, dans l'export depuis son application le même soir — ; il en redit les clés,
// les refus et les droits, confrontés au texte ; son retour retire ce qu'elle pose ; son essai attend les mots du module, et
// ce que la base y rend, relu par ce module, fait les plafonds que la base juge.

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

const MIGRATION = leFichier(/^\d{14}_reprises_au_client\.sql$/, ['../../supabase/preparees/', '../../supabase/schema/'])
const RETOUR = leFichier(/^\d{14}_retour_reprises_au_client\.sql$/, ['../../supabase/preparees/retour/'])
const ESSAI = readFileSync(new URL('../../supabase/essais/reprisesAuClient.sql', import.meta.url), 'utf8')

function fonction(nom: string): string {
  const definitions = definitionsSql(nom, [{ chemin: 'reprises_au_client', texte: MIGRATION }])
  expect(definitions, nom).toHaveLength(1)
  return definitions[0].definition
}

const refusSql = (sql: string) =>
  [...sql.matchAll(/raise exception '((?:[^']|'')*)'[\s\S]*?using errcode = '([0-9A-Z]{5})'/g)]
    .map((m) => ({ code: m[2], modele: m[1].replace(/''/g, "'") }))

const D = 'a8c10000-0000-4000-8000-0000000000d1'
const F = 'a8c10000-0000-4000-8000-0000000000c9'
const P1 = 'a8c10000-0000-4000-8000-0000000000b1'
const P2 = 'a8c10000-0000-4000-8000-0000000000b2'

// R-SERV-1 de l'essai : 1 420 € TTC (1 000 € HT à 20 %, 200 € HT à 10 %).
const LIGNES: LigneDeFacture[] = [
  { facture_id: F, ordre: 1, designation: 'Prestation', quantite: 1, prix_unitaire_ht: 1000, taux_tva: 20 },
  { facture_id: F, ordre: 2, designation: 'Séance', quantite: 1, prix_unitaire_ht: 200, taux_tva: 10 },
]
const FACTURE = {
  id: F, dossier_id: D, statut: 'importee', type: 'facture', numero: 'R-SERV-1', date_emission: '2026-10-22',
  emetteur_siret: null, montant_ht: 1200, montant_tva: 220, montant_ttc: 1420, superpdp_invoice_id: null, tiers_nom: 'Client S',
  source_de_la_vente: true,
} as unknown as FacturePourEncaissement

/** La valeur que l'essai attend de `reprise_de_la_facture` pour R-SERV-1, telle qu'il l'écrit (la date de reprise posée). */
function valeurDeLEssai(repriseLe: string): unknown {
  const m = /serv constant text := '([\s\S]*?)';\n/.exec(ESSAI)
  expect(m, 'la valeur de R-SERV-1 dans l’essai').not.toBeNull()
  return JSON.parse((m as RegExpExecArray)[1].replace('{R}', repriseLe))
}

afterEach(() => {
  DRAPEAU_DES_REPRISES_AU_CLIENT.REPRISES_AU_CLIENT_PREVUES = true
})

describe('le drapeau', () => {
  it('est levé depuis le 11/11/2026 : la migration en production, dans l’export et plus parmi les préparées', () => {
    expect(reprisesAuClientPrevues()).toBe(true)
    const schema = new URL('../../supabase/schema/', import.meta.url).pathname
    const preparees = new URL('../../supabase/preparees/', import.meta.url).pathname
    expect(readdirSync(schema).filter((n) => /^\d{14}_reprises_au_client\.sql$/.test(n))).toEqual(['20261111204440_reprises_au_client.sql'])
    expect(readdirSync(preparees).filter((n) => /_reprises_au_client\.sql$/.test(n))).toEqual([])
  })
  it('se lit à chaque appel', () => {
    DRAPEAU_DES_REPRISES_AU_CLIENT.REPRISES_AU_CLIENT_PREVUES = false
    expect(reprisesAuClientPrevues()).toBe(false)
  })
})

describe('la migration, confrontée au module', () => {
  it('pose les deux fonctions que l’écran appelle, et rien d’autre : ni table, ni policy, ni droit d’une table, ni suppression', () => {
    expect(fonction(FONCTION_DE_LA_REPRISE)).toMatch(/^create function public\.reprise_de_la_facture\(p_dossier_id uuid, p_facture_id uuid\)\nreturns jsonb\nlanguage plpgsql\nstable\nsecurity definer\nset search_path = public\nas \$\$/i)
    expect(fonction(FONCTION_DES_PIECES_CITEES)).toMatch(/^create function public\.pieces_citees_de_la_simulation\(p_dossier_id uuid\)\nreturns jsonb\nlanguage plpgsql\nstable\nsecurity definer\nset search_path = public\nas \$\$/i)
    const instructions = MIGRATION.split('\n').filter((l) => !l.startsWith('--'))
      .join('\n').match(/^(create|alter|grant|revoke|comment|insert|update|drop|delete|truncate|do)\b[^\n]*/gim) ?? []
    expect(instructions.map((l) => l.split(' ').slice(0, 2).join(' ').toLowerCase())).toEqual([
      'do $garde$', 'create function', 'revoke execute', 'grant execute', 'comment on',
      'create function', 'revoke execute', 'grant execute', 'comment on',
    ])
    expect(MIGRATION).not.toMatch(/\b(drop|delete|truncate)\b/i)
    expect(MIGRATION).not.toContain('\\')
    expect(MIGRATION).not.toContain('\r')
  })

  it('l’accès d’abord, sur le dossier annoncé, par les prédicats que `droits_sur_le_dossier` rend sous « ventes » et « banque »', () => {
    const reprise = fonction(FONCTION_DE_LA_REPRISE)
    const pieces = fonction(FONCTION_DES_PIECES_CITEES)
    expect(reprise.indexOf('if not public.gere_les_ventes(p_dossier_id) then')).toBeGreaterThan(0)
    expect(reprise.indexOf('if not public.gere_les_ventes(p_dossier_id) then')).toBeLessThan(reprise.indexOf(' from public.'))
    expect(pieces.indexOf('if not public.gere_la_banque(p_dossier_id) or not exists (select 1 from public.dossiers d where d.id = p_dossier_id) then'))
      .toBeGreaterThan(0)
    expect(pieces.indexOf('gere_la_banque')).toBeLessThan(pieces.indexOf('pieces_des_factures_reprises'))
  })

  it('les refus du module sont ceux de la migration, mot pour mot, au code près', () => {
    expect(refusSql(fonction(FONCTION_DE_LA_REPRISE))).toEqual([
      { code: '42501', modele: REFUS_DES_REPRISES_AU_CLIENT.acces },
      { code: 'P0002', modele: REFUS_DES_REPRISES_AU_CLIENT.introuvable },
    ])
    expect(refusSql(fonction(FONCTION_DES_PIECES_CITEES))).toEqual([{ code: '42501', modele: REFUS_DES_REPRISES_AU_CLIENT.acces }])
  })

  it('les six clés que le module lit sont celles que la fonction construit, et elles seules', () => {
    const construites = [...fonction(FONCTION_DE_LA_REPRISE).matchAll(/^\s+'([a-z_]+)', /gm)].map((m) => m[1]).sort()
    expect(construites).toEqual([...CLES_DE_LA_REPRISE])
    expect([...CLES_DE_LA_REPRISE]).toEqual([...CLES_DE_LA_REPRISE].sort())
  })

  it('les écrans appellent les deux fonctions sous leur nom, en toutes lettres (le garde des verrous lit le nom)', () => {
    const simulation = readFileSync(new URL('../pages/ClientSimulation.tsx', import.meta.url), 'utf8')
    const fenetre = readFileSync(new URL('../pages/dossier/EncaissementsFactureModal.tsx', import.meta.url), 'utf8')
    expect(simulation).toContain(`supabase.rpc('${FONCTION_DES_PIECES_CITEES}', { p_dossier_id: dossierLu })`)
    expect(fenetre).toContain(`supabase.rpc('${FONCTION_DE_LA_REPRISE}', { p_dossier_id: dossierId, p_facture_id: factureId })`)
  })

  it('ses droits : l’anonyme et PUBLIC n’exécutent pas, les connectés oui', () => {
    for (const signature of ['reprise_de_la_facture(uuid, uuid)', 'pieces_citees_de_la_simulation(uuid)']) {
      expect(MIGRATION).toContain(`revoke execute on function public.${signature} from public, anon;`)
      expect(MIGRATION).toContain(`grant execute on function public.${signature} to authenticated;`)
    }
  })

  it('les liens ACTIFS seuls, leurs identifiants seuls', () => {
    expect(fonction(FONCTION_DES_PIECES_CITEES)).toContain(
      "return coalesce((select jsonb_agg(r.piece_id order by r.piece_id)\n                     from public.pieces_des_factures_reprises r\n                    where r.dossier_id = p_dossier_id and r.retire_le is null), '[]'::jsonb);")
  })

  it('son retour retire les deux fonctions, et elles seules ; il se refuse si elles ne sont pas là', () => {
    const retraits = RETOUR.split('\n').filter((l) => /^drop /.test(l))
    expect(retraits).toEqual([
      'drop function public.reprise_de_la_facture(uuid, uuid);',
      'drop function public.pieces_citees_de_la_simulation(uuid);',
    ])
    expect(RETOUR).toContain("raise exception 'La migration reprises_au_client n''est pas en base : rien à défaire.';")
  })

  it('l’essai attend les mots du module', () => {
    expect(ESSAI).toContain(`refus constant text := '${REFUS_DES_REPRISES_AU_CLIENT.acces}';`)
    expect(ESSAI).toContain(`introuvable constant text := '${REFUS_DES_REPRISES_AU_CLIENT.introuvable}';`)
    expect(ESSAI).toContain(`'OK', '${CLES_DE_LA_REPRISE.join(',')}'),`)
  })
})

describe('ce que `reprise_de_la_facture` rend', () => {
  const VALEUR = {
    reprise_le: '2026-11-01', nature_operation: 'services', encaisse_avant_reprise_centimes: 30001,
    encaisse_par_taux: [{ taux: 20, encaisse_centimes: 30001 }, { taux: 10, encaisse_centimes: 0 }],
    credite_par_les_repris_centimes: 11000, credite_par_les_repris_par_taux: [{ taux: 10, ttc_centimes: 11000 }],
  }

  it('se lit en centimes, pour la facture demandée', () => {
    expect(repriseDeLaFactureRendue(VALEUR, F)).toEqual({
      factureId: F, repriseLe: '2026-11-01', natureOperation: 'services', encaisseAvantRepriseCentimes: 30001,
      encaisseParTaux: [{ taux: 20, encaisseCentimes: 30001 }, { taux: 10, encaisseCentimes: 0 }],
      crediteParLesReprisCentimes: 11000, crediteParLesReprisParTaux: [{ taux: 10, ttcCentimes: 11000 }],
    })
    expect(repriseDeLaFactureRendue({ ...VALEUR, reprise_le: null, nature_operation: null }, F))
      .toMatchObject({ repriseLe: null, natureOperation: null })
  })

  it('toute autre forme se refuse : jamais un plafond deviné', () => {
    const illisibles: unknown[] = [
      null, [], 'texte', {}, { ...VALEUR, de_plus: 1 },
      Object.fromEntries(Object.entries(VALEUR).filter(([k]) => k !== 'reprise_le')),
      { ...VALEUR, reprise_le: '2026-02-30' }, { ...VALEUR, reprise_le: '01/11/2026' }, { ...VALEUR, nature_operation: 3 },
      { ...VALEUR, encaisse_avant_reprise_centimes: -1 }, { ...VALEUR, encaisse_avant_reprise_centimes: 300.01 },
      { ...VALEUR, encaisse_avant_reprise_centimes: '30001' }, { ...VALEUR, credite_par_les_repris_centimes: null },
      { ...VALEUR, encaisse_par_taux: {} }, { ...VALEUR, encaisse_par_taux: [{ taux: 20 }] },
      { ...VALEUR, encaisse_par_taux: [{ taux: 20, encaisse_centimes: 1, de_plus: 0 }] },
      { ...VALEUR, encaisse_par_taux: [{ taux: 20, encaisse_centimes: 1 }, { taux: 20, encaisse_centimes: 2 }] },
      { ...VALEUR, encaisse_par_taux: [{ taux: 20, encaisse_centimes: -1 }] },
      { ...VALEUR, encaisse_par_taux: [{ taux: 'vingt', encaisse_centimes: 1 }] },
      { ...VALEUR, credite_par_les_repris_par_taux: [{ taux: 10, encaisse_centimes: 1 }] },
    ]
    for (const rendu of illisibles) expect(repriseDeLaFactureRendue(rendu, F), JSON.stringify(rendu) ?? String(rendu)).toBeNull()
  })

  it('la lecture : un refus, une valeur illisible ou une requête qui lève la disent illisible, sans jamais rejeter', async () => {
    expect(lectureDeLaReprise(F, { data: VALEUR, error: null })).toMatchObject({ factureId: F, etat: 'lue' })
    expect(lectureDeLaReprise(F, { data: null, error: { message: REFUS_DES_REPRISES_AU_CLIENT.acces } }))
      .toEqual({ factureId: F, etat: 'illisible', motif: REFUS_DES_REPRISES_AU_CLIENT.acces })
    expect(lectureDeLaReprise(F, { data: { ...VALEUR, de_plus: 1 }, error: null })).toEqual({ factureId: F, etat: 'illisible', motif: 'valeur illisible' })
    await expect(lireLaRepriseDeLaFacture(F, Promise.reject(new Error('coupée')))).resolves.toEqual({ factureId: F, etat: 'illisible', motif: 'coupée' })
    let attendue = false
    const requete = { then: (ok: (r: { data: unknown; error: unknown }) => void) => { attendue = true; ok({ data: VALEUR, error: null }) } }
    expect((await lireLaRepriseDeLaFacture(F, requete as PromiseLike<{ data: unknown; error: unknown }>)).etat).toBe('lue')
    expect(attendue).toBe(true)
  })

  it('ce que l’essai attend de la base, relu par ce module, fait les plafonds que la base juge (étapes 7 à 9 de l’essai)', () => {
    const reprise = repriseDeLaFactureRendue(valeurDeLEssai('2026-11-01'), F)
    expect(reprise).not.toBeNull()
    const c: ContexteFacture = {
      dossierId: D, facture: FACTURE, lignes: LIGNES, transmissions: [], evenementsSuperpdp: [], statutsRecus: [],
      encaissements: [], parts: [], reprise: reprise ?? undefined,
    }
    const vente = { anneesValidees: [], factures: [] }
    expect(resteAEncaisserDeLaReprise(c, vente, reprise!)).toEqual({
      ttcCentimes: 100999, encaisseCentimes: 0, resteCentimes: 100999,
      parTaux: [
        { taux: 20, ttcCentimes: 89999, encaisseCentimes: 0, resteCentimes: 89999 },
        { taux: 10, ttcCentimes: 11000, encaisseCentimes: 0, resteCentimes: 11000 },
      ],
    })
    const saisie = (montant: number, repartition: SaisieEncaissement['repartition']): SaisieEncaissement =>
      ({ date: '2026-11-01', montant, moyen: 'cheque', ligneBancaireId: null, repartition })
    const juger = (s: SaisieEncaissement) => refusEnregistrementVente(c, s, [], '2026-11-11', false, vente)
    expect(juger(saisie(1009.99, [{ taux: 20, montant: 899.99 }, { taux: 10, montant: 110 }]))).toBeNull()
    const auTotal = juger(saisie(1010, [{ taux: 20, montant: 900 }, { taux: 10, montant: 110 }]))
    const auTaux = juger(saisie(110.01, [{ taux: 10, montant: 110.01 }]))
    // Les mots mêmes que l'essai exige de la base (ses étapes 8 et 9).
    expect(ESSAI).toContain(`'22023', '${auTotal?.message.replace(/'/g, "''")}'),`)
    expect(ESSAI).toContain(`'22023', '${auTaux?.message.replace(/'/g, "''")}'),`)
    expect(auTotal?.cle).toBe('plafond_reprise')
    expect(auTaux?.cle).toBe('plafond_reprise_taux')
  })
})

describe('ce que `pieces_citees_de_la_simulation` rend', () => {
  it('un tableau d’identifiants, sans doublon', () => {
    expect(piecesCiteesRendues([P1, P2])).toEqual(new Set([P1, P2]))
    expect(piecesCiteesRendues([])).toEqual(new Set())
    for (const rendu of [null, {}, 'x', [P1, P1], [P1, 3], ['pas-un-identifiant']]) {
      expect(piecesCiteesRendues(rendu), JSON.stringify(rendu)).toBeNull()
    }
  })

  it('la lecture : lues, ou illisibles avec leur motif — jamais un ensemble vide deviné ; elle ne rejette jamais', async () => {
    await expect(lireLesPiecesCiteesDeLaSimulation(Promise.resolve({ data: [P1], error: null })))
      .resolves.toEqual({ etat: 'lues', piecesCitees: new Set([P1]) })
    await expect(lireLesPiecesCiteesDeLaSimulation(Promise.resolve({ data: null, error: { message: REFUS_DES_REPRISES_AU_CLIENT.acces } })))
      .resolves.toEqual({ etat: 'illisibles', motif: `pièces citées refusées : ${REFUS_DES_REPRISES_AU_CLIENT.acces}` })
    await expect(lireLesPiecesCiteesDeLaSimulation(Promise.resolve({ data: { ids: [] }, error: null })))
      .resolves.toEqual({ etat: 'illisibles', motif: 'pièces citées illisibles' })
    await expect(lireLesPiecesCiteesDeLaSimulation(Promise.reject(new Error('coupée'))))
      .resolves.toEqual({ etat: 'illisibles', motif: 'pièces citées refusées : coupée' })
  })
})
