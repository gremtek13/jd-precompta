import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { JUMELLE_INVERSEE_EXPORTEE, verdictDuPont, verdictDuPontDeLaPiece } from './exemplairesDesFactures'
import type { CanalTransmission, StatutFacture, TypeFacture } from './types'
import {
  jumellesDuDossier,
  type FacturePourJumelle,
  type JumellesDuDossier,
  type PiecePourJumelle,
  type TransmissionPourJumelle,
} from './ventesJumelles'
import { etapesDe, lignesInserees, valeurSql } from '../test/essaiSql'
import { derniereDefinitionSql } from '../test/schema'

// LE JUMEAU DU PONT (chantier EC-Q3, étape VF6b). La migration `jumelle_inversee` pose en base `factures_du_pont`, le jumeau
// du pont de l'application (lib/ventesJumelles.ts) : G3 et les fonctions du cabinet jugent une pièce par CE QUE SES TROIS
// FAITS DÉDUITS prouvent — le flux d'une transmission, l'identifiant de Super PDP, l'identité G1.42 —, sans sa désignation,
// que les gardes jugent. Deux lectures d'une même règle divergent en silence : ce test les confronte sur un jeu commun.
//
// LE JEU COMMUN est celui de l'essai `supabase/essais/exemplairesDesFactures.sql`, entre ses deux bornes « LE JEU DU
// JUMEAU » : des factures de J — sources ou non, une facture et un avoir, un brouillon, des SIRET aux blancs divers (une
// espace, une espace fine insécable, une tabulation, une espace insécable), un SIRET à dix chiffres —, leurs transmissions
// (une sur un autre hôte, une qui n'est pas de Super PDP, celle d'une facture d'un autre dossier), et des pièces que chaque
// fait rattache, ou pas. L'essai demande à la base ce que `factures_du_pont` rend de chaque pièce (contrôle 230), joué sur
// une réplique égale à la production plus les migrations de VF5h et de VF6b ; ce test rejoue le même jeu dans le pont, ses
// pièces lues SANS leur désignation, et exige le même rattachement, pièce par pièce. Puis, la migration exportée, il
// confronte au texte du jumeau ce qu'il ne peut pas rejouer : les blancs qu'il ôte d'un SIRET, ceux que `\s` ôte en
// JavaScript (`sirenDe`).

const ESSAI = readFileSync(new URL('../../supabase/essais/exemplairesDesFactures.sql', import.meta.url), 'utf8')
const DEBUT = '-- ══ LE JEU DU JUMEAU — DÉBUT'
const FIN = '-- ══ LE JEU DU JUMEAU — FIN'

const STATUTS: readonly StatutFacture[] = ['brouillon', 'validee']
const NATURES: readonly TypeFacture[] = ['facture', 'avoir']
const CANAUX: readonly CanalTransmission[] = ['plateforme', 'superpdp']

const texte = (v: unknown) => (v == null ? null : String(v))

interface Jumeau {
  factures: FacturePourJumelle[]
  transmissions: TransmissionPourJumelle[]
  /** Les pièces du jumeau, telles que le pont les lit — SANS leur désignation. */
  pieces: PiecePourJumelle[]
  /** Leur nom de fichier, que l'essai cite. */
  noms: Map<string, string>
  /** Ce que la base a rendu de chaque pièce (contrôle 230), par nom de fichier. */
  attendu: Map<string, string>
}

/** Le jeu du jumeau : les factures de tout l'essai (celles d'un autre dossier comprises), les transmissions et les pièces
 *  posées entre les deux bornes, et la valeur que l'essai attend de la base. */
function jumeauDe(essai: string): Jumeau {
  const debut = essai.indexOf(DEBUT)
  const fin = essai.indexOf(FIN)
  if (debut < 0 || fin < debut) throw new Error('Les bornes du jeu du jumeau manquent à l’essai.')
  const noms = new Map<string, string>()
  for (const m of essai.matchAll(/\{(\w+)\}/g)) if (!noms.has(m[1])) noms.set(m[1], m[1])
  const factures: FacturePourJumelle[] = []
  for (const e of etapesDe(essai).filter((x) => x.genre === 'jeu' || x.genre === 'fait')) {
    for (const f of lignesInserees(e.appel, 'factures_emises', noms)) {
      const statut = STATUTS.find((s) => s === f.statut)
      const type = NATURES.find((n) => n === f.type)
      if (statut === undefined || type === undefined) throw new Error(`Facture illisible : ${String(f.id)}`)
      factures.push({
        id: String(f.id), dossier_id: String(f.dossier_id), statut, type, numero: texte(f.numero), date_emission: String(f.date_emission),
        emetteur_siret: texte(f.emetteur_siret), superpdp_invoice_id: f.superpdp_invoice_id == null ? null : Number(f.superpdp_invoice_id),
      })
    }
  }
  const bloc = etapesDe(essai.slice(debut, fin))
  const transmissions: TransmissionPourJumelle[] = bloc.flatMap((e) => lignesInserees(e.appel, 'transmissions_factures', noms)).map((t) => {
    const canal = CANAUX.find((c) => c === t.canal)
    if (canal === undefined) throw new Error(`Canal illisible : ${String(t.canal)}`)
    return { facture_id: String(t.facture_id), canal, hote: String(t.hote), flux_id: texte(t.flux_id) }
  })
  const lues = bloc.flatMap((e) => lignesInserees(e.appel, 'pieces', noms))
  const pieces: PiecePourJumelle[] = lues.map((p) => ({
    id: String(p.id), dossier_id: String(p.dossier_id), flux_hote: texte(p.flux_hote), flux_id: texte(p.flux_id),
    superpdp_invoice_id: p.superpdp_invoice_id == null ? null : Number(p.superpdp_invoice_id),
    identite_numero: texte(p.identite_numero), identite_siren_vendeur: texte(p.identite_siren_vendeur), identite_date: texte(p.identite_date),
    identite_nature: p.identite_nature == null ? null : NATURES.find((n) => n === p.identite_nature) ?? null,
  }))
  const valeur = bloc.find((e) => e.genre === 'valeur' && e.numero === '230')
  if (valeur === undefined) throw new Error('Le contrôle 230 manque au jeu du jumeau.')
  const attendu = new Map(valeur.attendu.split(' ').map((x) => {
    const i = x.indexOf('=')
    return [x.slice(0, i), x.slice(i + 1)] as const
  }))
  return { factures, transmissions, pieces, noms: new Map(lues.map((p) => [String(p.id), String(p.nom_fichier)])), attendu }
}

/** Ce que le pont dit d'une pièce, sous la forme du contrôle 230 : « - », le numéro de sa facture, « plusieurs(…) » ou
 *  « nature(…) ». */
function libelle(jumelles: JumellesDuDossier, factures: readonly FacturePourJumelle[], pieceId: string): string {
  const numero = (id: string) => factures.find((f) => f.id === id)?.numero ?? '?'
  const incoherence = jumelles.incoherentes.find((i) => i.pieceId === pieceId)
  if (incoherence?.motif === 'nature') return `nature(${numero(incoherence.factureId)})`
  if (incoherence?.motif === 'plusieurs_factures') {
    return `plusieurs(${incoherence.factureIds.map(numero).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).join('+')})`
  }
  const jumelle = jumelles.parPiece.get(pieceId)
  return jumelle === undefined ? '-' : numero(jumelle.factureId)
}

function ecarts(essai: string): string[] {
  const j = jumeauDe(essai)
  const jumelles = jumellesDuDossier(j.factures, j.transmissions, j.pieces)
  const vus = j.pieces.map((p) => `${j.noms.get(p.id) ?? '?'}=${libelle(jumelles, j.factures, p.id)}`)
  const attendus = [...j.attendu].map(([nom, l]) => `${nom}=${l}`)
  return [...vus.filter((x) => !attendus.includes(x)).map((x) => `le pont : ${x}`),
    ...attendus.filter((x) => !vus.includes(x)).map((x) => `la base : ${x}`)]
}

describe('le jeu du jumeau, lu', () => {
  it('ses factures, ses transmissions, ses pièces et ce que la base en a rendu : le plancher qui distingue « aucun écart » d’« aveugle »', () => {
    const j = jumeauDe(ESSAI)
    const deJ = j.factures.filter((f) => f.dossier_id === 'J')
    expect([deJ.length, j.transmissions.length, j.pieces.length, j.attendu.size]).toEqual([8, 8, 22, 22])
    // Les blancs divers des SIRET sont lus tels que la base les a reçus : la concaténation de l'essai, caractère par caractère.
    expect(deJ.map((f) => f.emetteur_siret)).toEqual(['123 456 789 00012', '12345678900012', '123456789 00012', '123456789',
      '123456789\t00012', '123456789 00012', '1234567890', null])
    expect(valeurSql("'123' || chr(160) || '456'", new Map())).toBe('123 456')
    expect(valeurSql('chr(8239)', new Map())).toBe(' ')
  })
})

describe('le pont de l’application et son jumeau en base rattachent les mêmes pièces aux mêmes factures', () => {
  it('pièce par pièce, ce que factures_du_pont a rendu à l’essai (230) est ce que jumellesDuDossier dit, sans la désignation', () => {
    expect(ecarts(ESSAI)).toEqual([])
  })

  it('les verdicts que les fonctions et G3 en tirent sont les mêmes des deux côtés', () => {
    const j = jumeauDe(ESSAI)
    const jumelles = jumellesDuDossier(j.factures, j.transmissions, j.pieces)
    const numeros = new Map(j.factures.filter((f) => f.dossier_id === 'J').map((f) => [f.numero, f.id]))
    for (const p of j.pieces) {
      const l = j.attendu.get(j.noms.get(p.id) ?? '') ?? '?'
      // La forme du contrôle 230 relue comme le feraient les lignes de factures_du_pont.
      const lignes = l === '-' ? [] : /^plusieurs\((.*)\)$/.test(l)
        ? (/^plusieurs\((.*)\)$/.exec(l)?.[1] ?? '').split('+').map((n) => ({ facture_id: numeros.get(n) ?? '?', nature_contraire: false }))
        : /^nature\((.*)\)$/.test(l) ? [{ facture_id: numeros.get(/^nature\((.*)\)$/.exec(l)?.[1] ?? '') ?? '?', nature_contraire: true }]
          : [{ facture_id: numeros.get(l) ?? '?', nature_contraire: false }]
      expect(verdictDuPontDeLaPiece(jumelles, p.id), j.noms.get(p.id)).toEqual(verdictDuPont(lignes))
    }
  })

  it('un défaut planté dans le jeu se voit : un hôte, un identifiant de Super PDP, une nature, une année, un SIREN', () => {
    const planter = (avant: string, apres: string) => {
      expect(ESSAI.split(avant), avant).toHaveLength(2)
      return ecarts(ESSAI.replace(avant, apres)).length
    }
    // La pièce venue d'un autre hôte, ramenée sur celui de la transmission de FS1 : le pont la rattache, la base ne l'a pas fait.
    expect(planter("'plateforme', 'autre.exemple.fr', 'vf6b-1'", "'plateforme', 'pa.exemple.fr', 'vf6b-1'")).toBeGreaterThan(0)
    // Le brouillon de J, validé : son identifiant de Super PDP rattacherait la pièce PJ19.
    expect(planter("null, 'brouillon', 'facture', null, '2026-04-07', 'CLIENT ESSAI', 10, 2, 12, null, 7099, null, false",
      "'F2026-0007', 'validee', 'facture', null, '2026-04-07', 'CLIENT ESSAI', 10, 2, 12, '12345678900012', 7099, '2026-04-07 10:00:00+00', false"))
      .toBeGreaterThan(0)
    // L'identité de PJ17 dit un avoir : sa facture devient contraire.
    expect(planter("'F2026-0001', '123456789', '2026-04-01', 'facture'),\n      ('{PJ18}'", "'F2026-0001', '123456789', '2026-04-01', 'avoir'),\n      ('{PJ18}'"))
      .toBeGreaterThan(0)
    // L'année de PJ7 ramenée à celle de FS1 : le pont la rattache.
    expect(planter("'F2026-0001', '123456789', '2025-12-31', 'facture'", "'F2026-0001', '123456789', '2026-12-31', 'facture'"))
      .toBeGreaterThan(0)
    // Le SIREN de PJ8 ramené à celui de FS2.
    expect(planter("'F2026-0002', '987654321', '2026-04-02', 'facture'", "'F2026-0002', '123456789', '2026-04-02', 'facture'"))
      .toBeGreaterThan(0)
  })
})

describe('le texte du jumeau, la migration exportée', () => {
  // Les points de code que `\s` reconnaît en JavaScript — ce que `sirenDe` ôte d'un SIRET —, relevés sur tout Unicode.
  const blancsDeJavaScript = () => {
    const blancs: number[] = []
    for (let c = 0; c <= 0x10ffff; c++) {
      if (c >= 0xd800 && c <= 0xdfff) continue
      if (/\s/.test(String.fromCodePoint(c))) blancs.push(c)
    }
    return blancs
  }

  it('les blancs que factures_du_pont ôte d’un SIRET sont ceux que \\s ôte en JavaScript, ni plus ni moins', () => {
    if (!JUMELLE_INVERSEE_EXPORTEE) return
    const sql = derniereDefinitionSql('factures_du_pont')
    const translate = /translate\(coalesce\(f\.emetteur_siret, ''\),([\s\S]*?), ''\)/.exec(sql)?.[1] ?? ''
    const ota = [...translate.matchAll(/chr\((\d+)\)/g)].map((m) => Number(m[1]))
    expect(ota).toEqual(blancsDeJavaScript())
  })

  it('le reste de la règle de sirenDe : neuf chiffres ou quatorze, les neuf premiers ; une facture validée de SON dossier', () => {
    if (!JUMELLE_INVERSEE_EXPORTEE) return
    const sql = derniereDefinitionSql('factures_du_pont')
    expect(sql).toContain("(select case when c ~ '^[0-9]{9}([0-9]{5})?$' then left(c, 9) end")
    expect(sql).toContain("where f.dossier_id = p_piece.dossier_id and f.statut = 'validee'")
    expect(sql).toContain('where t.hote = p_piece.flux_hote and t.flux_id = p_piece.flux_id')
    expect(sql).toContain("where t.canal = 'superpdp' and t.flux_id = p_piece.superpdp_invoice_id::text")
    expect(sql).toContain('and extract(year from v.date_emission) = extract(year from p_piece.identite_date)')
    expect(sql).toMatch(/returns table \(facture_id uuid, nature_contraire boolean\)\nlanguage sql\nstable\nset search_path = public/)
  })
})
