import { readFileSync } from 'node:fs'
import type { LigneDeFacture } from '../lib/encaissementsFactures'
import { montantsDuDocument } from '../lib/factureCii'
import type { ModeComptable, MoyenEncaissement, NatureOperation } from '../lib/types'
import {
  recettesFactureesParMois, ventesFacturees, type EncaissementVendu, type FactureVendue, type PartVendue,
  type SourcesVentesFacturees, type VentesFacturees,
} from '../lib/ventesFacturees'

// L'ESSAI DE LA SIMULATION DES VENTES FACTURÉES (supabase/essais/simulationDesVentesFacturees.sql, chantier EC-Q3, étape
// VF8e), CÔTÉ MODULE : le jeu que l'essai pose en base — deux dossiers basculés qui portent le même jeu, l'un en trésorerie,
// l'autre en engagement — et ce que le MODULE en attend : pour chaque dossier et chacune des années 2025 à 2027, ce que
// `recettesFactureesParMois` rend des mois de l'année, et l'ensemble `sources`. L'essai exige de la base, sous ces mots, ce
// que le module rend : simulationVentesFacturees.test.ts vérifie qu'il porte exactement le jeu (`jeuPourLaBase`) et les
// lectures (`lecturesPourLEssai`) que ce module calcule. Le même calcul, en entiers, des deux côtés. Données FICTIVES.

export const TEXTE_ESSAI_SIMULATION = readFileSync(new URL('../../supabase/essais/simulationDesVentesFacturees.sql', import.meta.url), 'utf8')

// Les identifiants du jeu : un préfixe fixe, puis cinq chiffres — les dossiers 1 à 3, les factures 101 à 199, les avoirs
// 301 à 399, les encaissements 501 à 599 ; ceux du dossier en engagement, 1 000 de plus.
export const PREFIXE_SIMULATION = '5f8e0000-0000-4000-8000-0000000'
export const uuidSimulation = (n: number) => `${PREFIXE_SIMULATION}${String(n).padStart(5, '0')}`

/** Le dossier en trésorerie et celui en engagement, qui portent le même jeu. Le troisième, qui n'a pas basculé, est à part. */
export const DOSSIERS_DE_LA_SIMULATION: readonly { numero: number; mode: ModeComptable; decalage: number; nom: string }[] = [
  { numero: 1, mode: 'tresorerie', decalage: 0, nom: 'R' },
  { numero: 2, mode: 'engagement', decalage: 1000, nom: 'G' },
]

/** Les années que l'essai demande : celle du jeu, et ses deux voisines, qui en portent les bords. */
export const ANNEES_DE_LA_SIMULATION: readonly number[] = [2025, 2026, 2027]

interface FactureDuJeu {
  i: number
  numero: string
  type: 'facture' | 'avoir'
  emission: string
  nature: NatureOperation | null
  debits: boolean | null
  livraison: string | null
  origine: number | null
  source: boolean
  /** [quantité, prix unitaire hors taxe, taux]. */
  lignes: readonly (readonly [number, number, number])[]
}

interface EncaissementDuJeu {
  i: number
  facture: number
  date: string
  montant: number
  moyen: MoyenEncaissement
  annule: number | null
  retire: boolean
  /** [taux, montant]. */
  parts: readonly (readonly [number, number])[]
}

const F = (i: number, numero: string, emission: string, lignes: FactureDuJeu['lignes'], o: Partial<FactureDuJeu> = {}): FactureDuJeu => ({
  i, numero, type: 'facture', emission, nature: 'services', debits: false, livraison: null, origine: null, source: true, lignes, ...o,
})
const A = (i: number, numero: string, emission: string, origine: number, lignes: FactureDuJeu['lignes']): FactureDuJeu =>
  F(i, numero, emission, lignes, { type: 'avoir', origine })

// LE JEU. Montants en euros ; chaque cas dit ce qu'il éprouve.
export const FACTURES: readonly FactureDuJeu[] = [
  // F101 : facturée en janvier, encaissée en février — en trésorerie février, en engagement janvier.
  F(101, 'F2026-0001', '2026-01-15', [[1, 100, 20]]),
  // F102 : le PAIEMENT PARTIEL, en trois fois sur trois mois — la TVA de chaque part au cumul, le dernier tiers portant le
  // centime qui reste.
  F(102, 'F2026-0002', '2026-03-05', [[1, 83.33, 20]]),
  // F103 et son AVOIR de juin, entre deux encaissements : le second se juge sur la facture nette de l'avoir.
  F(103, 'F2026-0003', '2026-04-10', [[1, 200, 20]]),
  A(301, 'A2026-0001', '2026-06-20', 103, [[-1, 50, 20]]),
  // F104 : un encaissement, sa CONTRE-PASSATION le mois suivant, puis un nouvel encaissement.
  F(104, 'F2026-0004', '2026-06-01', [[1, 50, 20]]),
  // F105 : ÉCARTÉE — un encaissement que sa part ne fait pas.
  F(105, 'F2026-0005', '2026-02-01', [[1, 10, 20]]),
  // F106 : ÉCARTÉE — une contre-passation datée avant son encaissement.
  F(106, 'F2026-0006', '2026-07-01', [[1, 10, 20]]),
  // F107 : facturée en décembre 2025, encaissée le 1er janvier 2026 — le bord d'une année.
  F(107, 'F2025-0001', '2025-12-20', [[1, 40, 20]]),
  // F108 : facturée le 31 décembre 2026, encaissée le 3 janvier 2027 — l'autre bord.
  F(108, 'F2026-0007', '2026-12-31', [[1, 30, 20]]),
  // F109 : son seul encaissement RETIRÉ — rien en trésorerie, le document en engagement.
  F(109, 'F2026-0008', '2026-09-01', [[1, 40, 20]]),
  // F110 : un BIEN livré dix jours après sa facture, encaissé fin novembre — la recette à l'encaissement.
  F(110, 'F2026-0009', '2026-10-01', [[1, 300, 20]], { nature: 'biens', livraison: '2026-10-10' }),
  // F111 : une FRANCHISE (0 %), émise le 1er janvier — la recette est le TTC.
  F(111, 'F2026-0010', '2026-01-01', [[1, 80, 0]]),
  // F112 : DEUX TAUX, un encaissement réparti sur les deux.
  F(112, 'F2026-0011', '2026-05-10', [[1, 1000, 20], [1, 100, 5.5]]),
  // F113 et son avoir de l'année SUIVANTE, qui l'annule — en engagement, novembre 2026 puis janvier 2027.
  F(113, 'F2026-0012', '2026-11-15', [[1, 100, 20]]),
  A(302, 'A2027-0001', '2027-01-10', 113, [[-1, 100, 20]]),
  // F114 : un encaissement et sa contre-passation du MÊME MOIS — le mois a son entrée, à zéro.
  F(114, 'F2026-0013', '2026-09-10', [[1, 25, 20]]),
  // F115 : validée avant la bascule, PAS SOURCE — son encaissement ne compte pas ici, ni elle parmi les sources.
  F(115, 'F2026-0014', '2026-03-12', [[1, 30, 20]], { source: false }),
  // F116 : un encaissement du 31 décembre, sa contre-passation du 5 janvier — chacun dans son année.
  F(116, 'F2026-0015', '2026-12-01', [[1, 10, 20]]),
  // F117 et son avoir du jour de l'encaissement, qui annule le taux : ÉCARTÉE — en engagement non plus, ni sa facture ni son
  // avoir ne comptent (le mois d'août n'en reçoit pas d'entrée).
  F(117, 'F2026-0016', '2026-08-01', [[1, 10, 20]]),
  A(303, 'A2026-0002', '2026-08-05', 117, [[-1, 10, 20]]),
  // F118 : ÉCARTÉE — sans nature.
  F(118, 'F2026-0017', '2026-02-20', [[1, 30, 20]], { nature: null }),
  // F119 : ÉCARTÉE — sans ligne.
  F(119, 'F2026-0018', '2026-03-15', []),
  // F120 : ÉCARTÉE — sans l'option pour les débits que sa validation fige.
  F(120, 'F2026-0019', '2026-04-20', [[1, 20, 20]], { debits: null }),
  // F121 : des services sur l'option pour les débits — la recette, elle, à l'encaissement.
  F(121, 'F2026-0020', '2026-04-25', [[1, 60, 20]], { debits: true }),
  // F122 et son avoir du JOUR du premier encaissement : celui-ci se juge déjà sur la facture nette de l'avoir.
  F(122, 'F2026-0021', '2026-07-10', [[1, 500, 20]]),
  A(304, 'A2026-0003', '2026-07-10', 122, [[-1, 50, 20]]),
]

const E = (i: number, facture: number, date: string, montant: number, moyen: MoyenEncaissement, parts: EncaissementDuJeu['parts'],
  o: Partial<EncaissementDuJeu> = {}): EncaissementDuJeu => ({ i, facture, date, montant, moyen, annule: null, retire: false, parts, ...o })

export const ENCAISSEMENTS: readonly EncaissementDuJeu[] = [
  E(501, 101, '2026-02-10', 120, 'virement', [[20, 120]]),
  E(502, 102, '2026-03-20', 33.33, 'virement', [[20, 33.33]]),
  E(503, 102, '2026-04-15', 33.33, 'cheque', [[20, 33.33]]),
  E(504, 102, '2026-05-02', 33.34, 'virement', [[20, 33.34]]),
  E(505, 103, '2026-05-15', 120, 'virement', [[20, 120]]),
  E(506, 103, '2026-07-01', 60, 'virement', [[20, 60]]),
  E(507, 104, '2026-06-10', 60, 'cheque', [[20, 60]]),
  E(508, 104, '2026-07-05', -60, 'cheque', [[20, -60]], { annule: 507 }),
  E(509, 104, '2026-08-01', 60, 'virement', [[20, 60]]),
  E(510, 105, '2026-02-15', 12, 'virement', [[20, 10]]),
  E(511, 106, '2026-07-02', 12, 'cheque', [[20, 12]]),
  E(512, 106, '2026-07-01', -12, 'cheque', [[20, -12]], { annule: 511 }),
  E(513, 107, '2026-01-01', 48, 'virement', [[20, 48]]),
  E(514, 108, '2027-01-03', 36, 'virement', [[20, 36]]),
  E(515, 109, '2026-09-05', 48, 'cheque', [[20, 48]], { retire: true }),
  E(516, 110, '2026-11-30', 360, 'virement', [[20, 360]]),
  E(517, 111, '2026-01-31', 80, 'especes', [[0, 80]]),
  E(518, 112, '2026-05-20', 1305.5, 'virement', [[20, 1200], [5.5, 105.5]]),
  E(519, 114, '2026-09-12', 30, 'cheque', [[20, 30]]),
  E(520, 114, '2026-09-28', -30, 'cheque', [[20, -30]], { annule: 519 }),
  E(521, 115, '2026-03-20', 36, 'virement', [[20, 36]]),
  E(522, 116, '2026-12-31', 12, 'cheque', [[20, 12]]),
  E(523, 116, '2027-01-05', -12, 'cheque', [[20, -12]], { annule: 522 }),
  E(524, 117, '2026-08-05', 12, 'cheque', [[20, 12]]),
  E(525, 118, '2026-02-25', 36, 'virement', [[20, 36]]),
  E(526, 120, '2026-04-28', 24, 'virement', [[20, 24]]),
  E(527, 121, '2026-06-30', 72, 'virement', [[20, 72]]),
  E(528, 122, '2026-07-10', 300, 'virement', [[20, 300]]),
  E(529, 122, '2026-08-20', 240, 'virement', [[20, 240]]),
]

// L'instant de création d'un encaissement : son jour, à une minute qui suit son numéro, comme l'essai le pose.
const creeLe = (e: EncaissementDuJeu) => `${e.date}T10:${String(e.i % 60).padStart(2, '0')}:00+00:00`

function dossierDuJeu(numero: number) {
  const d = DOSSIERS_DE_LA_SIMULATION.find((x) => x.numero === numero)
  if (!d) throw new Error(`dossier ${numero} hors du jeu`)
  return d
}

/** Le jeu tel que la lecture du cabinet le rendrait au module, pour un dossier du jeu. */
export function sourcesDuDossier(numero: number): SourcesVentesFacturees {
  const d = dossierDuJeu(numero)
  const u = (i: number) => uuidSimulation(i + d.decalage)
  const dossierId = uuidSimulation(d.numero)
  return {
    dossierId,
    factures: FACTURES.map((f): FactureVendue => ({
      id: u(f.i), dossier_id: dossierId, statut: 'validee', type: f.type, numero: f.numero, date_emission: f.emission,
      tiers_nom: 'ESSAI', facture_origine_id: f.origine == null ? null : u(f.origine), source_de_la_vente: f.source,
      nature_operation: f.nature, option_debits: f.debits, date_prestation: f.livraison,
    })),
    lignes: FACTURES.flatMap((f) => f.lignes.map(([quantite, prix, taux], k): LigneDeFacture => ({
      facture_id: u(f.i), ordre: k + 1, designation: 'ESSAI', quantite, prix_unitaire_ht: prix, taux_tva: taux,
    }))),
    encaissements: ENCAISSEMENTS.map((e): EncaissementVendu => ({
      id: u(e.i), dossier_id: dossierId, facture_id: u(e.facture), date_encaissement: e.date, montant: e.montant, moyen: e.moyen,
      ligne_bancaire_id: null, annule_id: e.annule == null ? null : u(e.annule), cree_le: creeLe(e),
      retire_le: e.retire ? `${e.date}T12:00:00+00:00` : null,
    })),
    parts: ENCAISSEMENTS.flatMap((e) => e.parts.map(([taux, montant]): PartVendue => ({
      encaissement_id: u(e.i), dossier_id: dossierId, taux, montant,
    }))),
  }
}

/** Les ventes facturées d'un dossier du jeu, selon le module. */
export function ventesDuDossier(numero: number): VentesFacturees {
  return ventesFacturees(sourcesDuDossier(numero))
}

/** Ce que le module compte des mois d'une année — `recettesFactureesParMois`, dans le modèle du dossier, restreint à l'année. */
export function recettesDeLAnnee(numero: number, annee: number): Map<string, number> {
  const toutes = recettesFactureesParMois(ventesDuDossier(numero), dossierDuJeu(numero).mode)
  return new Map([...toutes].filter(([mois]) => mois.startsWith(`${annee}-`)))
}

const ordreC = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/** Un total par mois sous la forme où la base l'écrit (le texte d'un `jsonb`) : les clés dans leur ordre, « clé: valeur ». */
export function parMoisCommeLaBase(parMois: ReadonlyMap<string, number>): string {
  return `{${[...parMois].sort(([a], [b]) => ordreC(a, b)).map(([mois, c]) => `"${mois}": ${c}`).join(', ')}}`
}

/** Une liste d'identifiants sous la forme où la base l'écrit, dans l'ordre des identifiants. */
export function sourcesCommeLaBase(sources: Iterable<string>): string {
  return `[${[...sources].sort(ordreC).map((s) => `"${s}"`).join(', ')}]`
}

/** Le jeu dans le langage de la macro de l'essai : `{D}` le dossier, `{U}` le préfixe, les identifiants par leur numéro. */
const DOSSIER_ESSAI: Readonly<Record<number, string>> = { 1: '{D1}', 2: '{D2}' }

/**
 * Le jeu, sous la forme que l'essai pose en base (la macro JEU) : des tableaux, les cases vides de la fin ôtées (l'essai les
 * lit nulles). Une facture : [numéro, numéro de facture, émission, nature (« s », « b » ou rien), débits (0, 1 ou rien),
 * source (0 ou 1), hors taxe, TVA, facture d'origine, livraison] ; une ligne : [facture, ordre, quantité, prix, taux] ; un
 * encaissement : [numéro, facture, date, montant, moyen, retiré (1 ou rien), encaissement annulé] ; une part : [encaissement,
 * taux, montant]. Les montants d'une facture sont ceux que ses lignes font (`montantsDuDocument`), signés pour un avoir.
 */
export function jeuPourLaBase(): string {
  const montants = (f: FactureDuJeu) => {
    const groupes = montantsDuDocument({ type: f.type }, f.lignes.map(([quantite, prix, taux], k) => ({
      ordre: k + 1, designation: 'ESSAI', quantite, prix_unitaire_ht: prix, taux_tva: taux,
    })), null).groupes
    const signe = f.type === 'avoir' ? -1 : 1
    const ht = groupes.reduce((s, g) => s + g.baseCentimes, 0)
    const tva = groupes.reduce((s, g) => s + g.tvaCentimes, 0)
    return [(signe * ht) / 100, (signe * tva) / 100]
  }
  const b = (v: boolean | null) => (v == null ? null : v ? 1 : 0)
  const sansFinVide = (l: (string | number | null)[]) => {
    while (l.length > 0 && l[l.length - 1] == null) l.pop()
    return l
  }
  return JSON.stringify({
    f: FACTURES.map((f) => sansFinVide([f.i, f.numero, f.emission, f.nature == null ? null : f.nature === 'biens' ? 'b' : 's',
      b(f.debits), b(f.source), ...montants(f), f.origine, f.livraison])),
    l: FACTURES.flatMap((f) => f.lignes.map(([q, p, t], k) => [f.i, k + 1, q, p, t])),
    e: ENCAISSEMENTS.map((e) => sansFinVide([e.i, e.facture, e.date, e.montant, e.moyen, e.retire ? 1 : null, e.annule])),
    p: ENCAISSEMENTS.flatMap((e) => e.parts.map(([t, m]) => [e.i, t, m])),
  })
}

/** Les sources d'un dossier du jeu, sous la forme de la macro : `{U}`, le préfixe, puis les cinq chiffres de l'identifiant. */
function sourcesDeLaMacro(numero: number): string {
  return sourcesCommeLaBase([...ventesDuDossier(numero).sources].map((id) => `{U}${id.slice(PREFIXE_SIMULATION.length)}`))
}

/**
 * Ce que la fonction rend d'un dossier du jeu pour une année, sous la forme où la base l'écrit (le texte du `jsonb`) : ses
 * deux clés dans l'ordre du `jsonb` — la plus courte d'abord, « sources » puis « par_mois » —, les sources sous la forme de
 * la macro.
 */
export function simulationCommeLaBase(numero: number, annee: number): string {
  return `{"sources": ${sourcesDeLaMacro(numero)}, "par_mois": ${parMoisCommeLaBase(recettesDeLAnnee(numero, annee))}}`
}

/**
 * Les lectures de l'essai que le MODULE dicte, mot pour mot : pour chaque dossier du jeu et chaque année, ce que la fonction
 * rend des mois ; pour chaque dossier, ses sources ; puis la valeur entière que lisent le client « Banque » de R et un membre
 * de l'équipe affecté à R. Une ligne de l'essai par lecture, dans cet ordre, numérotées de 1 à 10 :
 * simulationVentesFacturees.test.ts exige que l'essai porte exactement ce bloc.
 */
export function lecturesPourLEssai(): string {
  const lignes: string[] = []
  let numero = 0
  for (const d of DOSSIERS_DE_LA_SIMULATION) {
    for (const annee of ANNEES_DE_LA_SIMULATION) {
      numero++
      lignes.push(`  array['lecture', '${numero}. ${d.nom} (${d.mode === 'tresorerie' ? 'trésorerie' : 'engagement'}), ${annee} : le hors-taxe de chaque mois', 'chef', `
        + `$q$select (ventes_facturees_de_la_simulation('${DOSSIER_ESSAI[d.numero]}', ${annee}) -> 'par_mois')::text$q$, '', `
        + `'${parMoisCommeLaBase(recettesDeLAnnee(d.numero, annee))}'],`)
    }
    numero++
    lignes.push(`  array['lecture', '${numero}. ${d.nom} : les factures et avoirs sources, de toute année', 'chef', `
      + `$q$select (ventes_facturees_de_la_simulation('${DOSSIER_ESSAI[d.numero]}', 2026) -> 'sources')::text$q$, '', `
      + `'${sourcesDeLaMacro(d.numero)}'],`)
  }
  for (const [profil, titre] of [
    ['client_b', 'le client qui porte « Banque » sur R lit, de R, ce que lit le cabinet'],
    // L'apostrophe doublée : le titre est une chaîne de l'essai.
    ['membre', "un membre de l''équipe affecté à R aussi"],
  ] as const) {
    numero++
    lignes.push(`  array['lecture', '${numero}. ${titre}', '${profil}', `
      + `$q$select ventes_facturees_de_la_simulation('{D1}', 2026)::text$q$, '', '${simulationCommeLaBase(1, 2026)}'],`)
  }
  return lignes.join('\n')
}
