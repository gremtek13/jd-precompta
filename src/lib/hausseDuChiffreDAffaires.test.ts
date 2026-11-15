import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  alerteAVoir, atteintLeSeuil, bornesDuTrimestre, ceQueDitLaVue, chiffreDAffairesDesSources, confirmationDeLaMarque,
  dernierTrimestreClos, HAUSSE_DU_CHIFFRE_D_AFFAIRES_PREVUE, jugerLaHausse, libelleDuTrimestre, marquesDansLOrdre, moisDeLaPeriode,
  phraseDeLaMarque, phraseDuTableauDeBord, pourcentDesDixiemes, REFUS_DE_LA_BASE, refusDuSeuil, SEUIL_HORS_BORNES, seuilDeLaSaisie,
  type EntreesDeLaHausse, type HausseDuChiffreDAffaires, type HausseVue, type MouvementDuReleve, type SourcesDuChiffreDAffaires,
} from './hausseDuChiffreDAffaires'
import { CAISSE_ABSENTE } from './recettesDeCaisse'
import { paiementsDesPieces } from './rattachement'
import { totauxPourAnnee } from './estimation'
import { recettesFactureesVides, ventesFactureesVides } from '../test/ventesFacturees'
import type { LigneBancaire, Piece } from './types'
import { formatMoney } from './format'

// L'espace insécable devant « % » : un pourcentage ne se coupe pas de son signe.
const NB = String.fromCharCode(160)

// L'ALERTE DE HAUSSE DU CHIFFRE D'AFFAIRES (docs/conceptions/52-alerte-hausse-du-chiffre-d-affaires.md) : les trimestres, le
// jugement et ses cas muets, le chiffre d'une période tiré du moteur de l'estimation, les mots — neutres —, et les refus de la
// base confrontés au texte de la migration préparée. Les essais de la base : supabase/essais/hausseDuChiffreDAffaires.sql et son
// compagnon de réplique, hausseDuChiffreDAffairesSuppression.sql.

const MIGRATION = 'supabase/preparees/20261115140000_hausse_du_chiffre_d_affaires.sql'
const RETOUR = 'supabase/preparees/retour/20261115140100_retour_hausse_du_chiffre_d_affaires.sql'
const texte = readFileSync(resolve(process.cwd(), MIGRATION), 'utf8')

describe('le drapeau et les fichiers de la migration', () => {
  it('baissé, la migration préparée, son retour et ses deux essais à côté, hors de l’export', () => {
    expect(HAUSSE_DU_CHIFFRE_D_AFFAIRES_PREVUE).toBe(false)
    for (const f of [MIGRATION, RETOUR, 'supabase/essais/hausseDuChiffreDAffaires.sql', 'supabase/essais/hausseDuChiffreDAffairesSuppression.sql']) {
      expect(existsSync(resolve(process.cwd(), f)), f).toBe(true)
    }
    expect(existsSync(resolve(process.cwd(), 'supabase/schema/20261115140000_hausse_du_chiffre_d_affaires.sql'))).toBe(false)
  })

  it('chaque refus de la base est redit sous ses mots, l’apostrophe doublée dans le texte SQL', () => {
    for (const [nom, mots] of Object.entries(REFUS_DE_LA_BASE)) {
      expect(texte, nom).toContain(`'${mots.replace(/'/g, "''")}'`)
    }
  })

  it('les bornes du seuil sont celles de la base, et le client n’a aucune branche', () => {
    expect(texte).toContain('check (seuil_de_hausse between 1 and 1000)')
    expect(texte).toContain('if p_seuil is not null and (p_seuil < 1 or p_seuil > 1000) then')
    expect(texte).not.toMatch(/client_du_dossier|droits_sur_le_dossier/)
    expect(texte).not.toMatch(/\bdelete\s+from\b|\bdrop\b|\btruncate\b/i)
  })
})

describe('les trimestres', () => {
  it('le dernier trimestre clos : celui qui précède le trimestre du jour, le 4e de l’année d’avant en janvier', () => {
    expect(dernierTrimestreClos('2026-11-15')).toEqual({ annee: 2026, trimestre: 3 })
    expect(dernierTrimestreClos('2026-10-01')).toEqual({ annee: 2026, trimestre: 3 })
    expect(dernierTrimestreClos('2026-09-30')).toEqual({ annee: 2026, trimestre: 2 })
    expect(dernierTrimestreClos('2026-04-01')).toEqual({ annee: 2026, trimestre: 1 })
    expect(dernierTrimestreClos('2026-03-31')).toEqual({ annee: 2025, trimestre: 4 })
    expect(dernierTrimestreClos('2027-01-01')).toEqual({ annee: 2026, trimestre: 4 })
  })

  it('ses bornes et ses mois, de l’année bissextile à la fin d’année', () => {
    expect(bornesDuTrimestre({ annee: 2028, trimestre: 1 })).toEqual({ debut: '2028-01-01', fin: '2028-03-31' })
    expect(bornesDuTrimestre({ annee: 2026, trimestre: 2 })).toEqual({ debut: '2026-04-01', fin: '2026-06-30' })
    expect(bornesDuTrimestre({ annee: 2026, trimestre: 4 })).toEqual({ debut: '2026-10-01', fin: '2026-12-31' })
    expect(moisDeLaPeriode('2025-11-01', '2026-02-28')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02'])
    expect(libelleDuTrimestre({ annee: 2026, trimestre: 1 })).toBe('1er trimestre 2026 (janvier à mars)')
    expect(libelleDuTrimestre({ annee: 2026, trimestre: 3 })).toBe('3e trimestre 2026 (juillet à septembre)')
  })
})

describe('le seuil, en entiers exacts', () => {
  it('atteint à 20 % pile, pas un centime en dessous ; sans recettes l’année d’avant, jamais', () => {
    expect(atteintLeSeuil(120_000, 100_000, 20)).toBe(true)
    expect(atteintLeSeuil(119_999, 100_000, 20)).toBe(false)
    expect(atteintLeSeuil(90_000, 100_000, 20)).toBe(false)
    expect(atteintLeSeuil(1, 0, 1)).toBe(false)
    // Un arrondi d'affichage ne décide rien : 19,96 % se MONTRE 20,0 %, mais n'atteint pas 20 %.
    expect(atteintLeSeuil(1_199_600, 1_000_000, 20)).toBe(false)
  })

  it('la saisie : vide (aucun seuil), un entier de 1 à 1 000, rien d’autre', () => {
    expect(seuilDeLaSaisie('')).toBeNull()
    expect(seuilDeLaSaisie(' 25 ')).toBe(25)
    for (const t of ['0', '1001', '12,5', '-3', 'vingt']) expect(refusDuSeuil(seuilDeLaSaisie(t)), t).toBe(SEUIL_HORS_BORNES)
    for (const t of ['', '1', '1000']) expect(refusDuSeuil(seuilDeLaSaisie(t)), t).toBeNull()
  })

  it('la variation montrée, au dixième de point', () => {
    expect(pourcentDesDixiemes(302)).toBe(`+30,2${NB}%`)
    expect(pourcentDesDixiemes(-40)).toBe(`−4,0${NB}%`)
    expect(pourcentDesDixiemes(0)).toBe(`0,0${NB}%`)
  })
})

// ── Le jugement ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** Un mouvement rapproché par mois, du premier au dernier mois donnés. */
function releveDe(premier: string, dernier: string): MouvementDuReleve[] {
  return moisDeLaPeriode(`${premier}-01`, `${dernier}-01`).map((m) => ({ date: `${m}-10`, montant: 100, statut: 'rapprochee' as const }))
}

/** Le chiffre d'une période : la somme des mois qu'elle couvre, en centimes. */
function chiffreParMois(parMois: Record<string, number>): (debut: string, fin: string) => number {
  return (debut, fin) => moisDeLaPeriode(debut, fin).reduce((s, m) => s + (parMois[m] ?? 0), 0)
}

const MOIS_2025 = Object.fromEntries(moisDeLaPeriode('2025-01-01', '2025-12-31').map((m) => [m, 1_000_000]))
const MOIS_2026_PLAT = Object.fromEntries(moisDeLaPeriode('2026-01-01', '2026-10-31').map((m) => [m, 1_000_000]))

function entrees(e: Partial<EntreesDeLaHausse> = {}): EntreesDeLaHausse {
  return {
    seuil: 20, aujourdHui: '2026-11-15', releve: releveDe('2025-01', '2026-10'),
    chiffreDAffaires: chiffreParMois({ ...MOIS_2025, ...MOIS_2026_PLAT }), vues: [], ...e,
  }
}

const jugee = (h: HausseDuChiffreDAffaires) => {
  if (h.etat !== 'jugee') throw new Error(`attendue jugée : ${h.etat}`)
  return h
}

describe('le jugement du dernier trimestre clos', () => {
  it('sans seuil, rien ne se calcule', () => {
    const chiffre = vi.fn(() => 0)
    expect(jugerLaHausse(entrees({ seuil: null, chiffreDAffaires: chiffre }))).toEqual({ etat: 'sans_seuil' })
    expect(chiffre).not.toHaveBeenCalled()
  })

  it('un trimestre plat : jugé, sans hausse ; le trimestre et le cumul comparés', () => {
    const h = jugee(jugerLaHausse(entrees()))
    expect(h.trimestre).toEqual({ annee: 2026, trimestre: 3 })
    expect(h.hausse).toBe(false)
    expect(h.duTrimestre).toMatchObject({ etat: 'comparee', comparaison: { centimes: 3_000_000, precedentCentimes: 3_000_000, variationDixiemes: 0 } })
    expect(h.duCumul).toMatchObject({ etat: 'comparee', comparaison: { debut: '2026-01-01', fin: '2026-09-30', debutPrecedent: '2025-01-01', finPrecedent: '2025-09-30' } })
    expect(alerteAVoir(h)).toBe(false)
  })

  it('le trimestre à +25 % et le cumul à +8,3 % : la hausse du trimestre suffit (l’un ou l’autre)', () => {
    const h = jugee(jugerLaHausse(entrees({ chiffreDAffaires: chiffreParMois({ ...MOIS_2025, ...MOIS_2026_PLAT, '2026-07': 1_750_000 }) })))
    expect(h.duTrimestre).toMatchObject({ comparaison: { variationDixiemes: 250, atteintLeSeuil: true } })
    expect(h.duCumul).toMatchObject({ comparaison: { variationDixiemes: 83, atteintLeSeuil: false } })
    expect(h.hausse).toBe(true)
    expect(alerteAVoir(h)).toBe(true)
  })

  it('marquée vue avec le client pour CE trimestre, l’alerte ne se dit plus ; une marque d’un autre trimestre n’y fait rien', () => {
    const chiffre = chiffreParMois({ ...MOIS_2025, ...MOIS_2026_PLAT, '2026-07': 1_750_000 })
    const vue: HausseVue = { dossier_id: 'd1', annee: 2026, trimestre: 3, vue_par: 'u1', vue_le: '2026-11-16T09:00:00Z' }
    expect(alerteAVoir(jugerLaHausse(entrees({ chiffreDAffaires: chiffre, vues: [vue] })))).toBe(false)
    expect(alerteAVoir(jugerLaHausse(entrees({ chiffreDAffaires: chiffre, vues: [{ ...vue, trimestre: 2 }] })))).toBe(true)
  })

  it('en attente tant qu’un mois du trimestre manque au relevé, ou qu’un de ses crédits reste à traiter ; un débit à traiter n’y fait rien', () => {
    const sansSeptembre = releveDe('2025-01', '2026-10').filter((l) => !l.date.startsWith('2026-09'))
    expect(jugerLaHausse(entrees({ releve: sansSeptembre }))).toMatchObject({ etat: 'en_attente', raison: 'releve_manquant', mois: ['2026-09'] })
    const credit: MouvementDuReleve = { date: '2026-08-20', montant: 450, statut: 'non_rapprochee' }
    expect(jugerLaHausse(entrees({ releve: [...releveDe('2025-01', '2026-10'), credit] })))
      .toMatchObject({ etat: 'en_attente', raison: 'mouvements_a_traiter', mois: ['2026-08'] })
    const debit: MouvementDuReleve = { date: '2026-08-20', montant: -450, statut: 'non_rapprochee' }
    expect(jugerLaHausse(entrees({ releve: [...releveDe('2025-01', '2026-10'), debit] })).etat).toBe('jugee')
  })

  it('sans comparaison : un dossier dont le relevé commence en 2026', () => {
    const h = jugerLaHausse(entrees({ releve: releveDe('2026-01', '2026-10') }))
    expect(h).toMatchObject({ etat: 'sans_comparaison', duTrimestre: { etat: 'non_comparable', raison: 'releve_manquant' } })
  })

  it('l’année d’avant commencée en juin : le trimestre se compare, pas le cumul ; une année d’avant sans recettes ne se compare pas', () => {
    const h = jugee(jugerLaHausse(entrees({ releve: releveDe('2025-06', '2026-10') })))
    expect(h.duTrimestre.etat).toBe('comparee')
    expect(h.duCumul).toMatchObject({ etat: 'non_comparable', raison: 'releve_manquant', mois: ['2025-01', '2025-02', '2025-03', '2025-04', '2025-05'] })
    const sansRecettes = jugerLaHausse(entrees({ chiffreDAffaires: chiffreParMois(MOIS_2026_PLAT) }))
    expect(sansRecettes).toMatchObject({ etat: 'sans_comparaison', duTrimestre: { raison: 'sans_recettes_l_annee_d_avant' } })
  })

  it('au 1er trimestre, le cumul est le trimestre : une seule comparaison', () => {
    const h = jugee(jugerLaHausse(entrees({ aujourdHui: '2026-04-20', releve: releveDe('2025-01', '2026-03') })))
    expect(h.trimestre).toEqual({ annee: 2026, trimestre: 1 })
    expect(h.duCumul).toBeNull()
  })

  it('en janvier, le 4e trimestre de l’année d’avant : le cumul est l’année entière', () => {
    const h = jugee(jugerLaHausse(entrees({
      aujourdHui: '2027-01-20', releve: releveDe('2025-01', '2026-12'),
      chiffreDAffaires: chiffreParMois({ ...MOIS_2025, ...MOIS_2026_PLAT, '2026-11': 1_000_000, '2026-12': 1_000_000 }),
    })))
    expect(h.trimestre).toEqual({ annee: 2026, trimestre: 4 })
    expect(h.duCumul).toMatchObject({ comparaison: { debut: '2026-01-01', fin: '2026-12-31', finPrecedent: '2025-12-31' } })
  })
})

// ── Le chiffre tiré des sources : le moteur de l'estimation ───────────────────────────────────────────────────────────

const piece = (o: Partial<Piece>): Piece => ({
  id: 'p', dossier_id: 'd1', nom_fichier: 'x.pdf', statut: 'validee', type_piece: 'vente',
  date_piece: '2026-03-10', montant_ht: null, montant_tva: null, montant_ttc: 100, categorie_id: null, created_at: '2026-03-10T00:00:00Z', ...o,
} as Piece)

const ligne = (o: Partial<LigneBancaire>): LigneBancaire => ({
  id: 'l', dossier_id: 'd1', date: '2026-03-12', libelle: 'VIR', montant: 100, statut: 'rapprochee', piece_id: null,
  cotisation_id: null, categorie_id: null, taux_tva: null, prelevement_personnel: false, source_fichier: null, libelle_brut: null,
  emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false, reglement_groupe: false,
  compte_bilan: null, declaration_tva_id: null, id_externe: null, created_at: '2026-03-12T09:00:00Z', encaissements_de_factures: false, ...o,
})

function sources(o: Partial<SourcesDuChiffreDAffaires> = {}): SourcesDuChiffreDAffaires {
  return {
    dossierId: 'd1',
    piecesDeVente: [piece({ id: 'r1', date_piece: '2025-12-20', montant_ttc: 1000 }), piece({ id: 'r2', date_piece: '2026-02-10', montant_ttc: 250.5 })],
    lignes: [ligne({ id: 'l1', piece_id: 'r1', date: '2026-01-08', montant: 400 }), ligne({ id: 'l2', date: '2026-02-11', montant: -30, statut: 'non_rapprochee' })],
    ventilations: [], reglements: [], categories: [], ventesFacturees: ventesFactureesVides('d1'), encaissees: [],
    caisse: { dossierId: 'd1', enBase: false, lignes: [], complete: false, motif: 'la caisse n’est pas en base' },
    ...o,
  }
}

describe('le chiffre d’une période, celui de l’estimation', () => {
  it('le même que les repères annuels de l’onglet Estimation, en centimes ; le relevé rapproché seul date les pièces', () => {
    const c = chiffreDAffairesDesSources(sources(), false, 'tresorerie')
    if (!c.ok) throw new Error(c.motif)
    const s = sources()
    const paiements = paiementsDesPieces(s.lignes.filter((l) => l.statut === 'rapprochee'), [], [], [])
    for (const annee of [2025, 2026]) {
      const ca = totauxPourAnnee(s.piecesDeVente, [], annee, false, paiements, 'tresorerie', [], recettesFactureesVides(), CAISSE_ABSENTE).ca
      expect(c.chiffreDAffaires(`${annee}-01-01`, `${annee}-12-31`), String(annee)).toBe(Math.round(ca * 100))
    }
    // 600 € de 2025 restés à la date de facture, 400 € encaissés le 8 janvier, 250,50 € à leur facture de février.
    expect(c.chiffreDAffaires('2025-10-01', '2025-12-31')).toBe(60_000)
    expect(c.chiffreDAffaires('2026-01-01', '2026-03-31')).toBe(65_050)
  })

  it('une caisse lue en partie ne se compte pas : le motif, et rien de calculé', () => {
    const c = chiffreDAffairesDesSources(sources({ caisse: { dossierId: 'd1', enBase: true, lignes: [], complete: false, motif: 'coupée' } }), false, 'tresorerie')
    expect(c).toEqual({ ok: false, motif: 'coupée' })
  })
})

// ── Les mots ─────────────────────────────────────────────────────────────────────────────────────────────────────────

describe('les mots, neutres : le constat, les deux chiffres, le seuil', () => {
  const hausse = jugee(jugerLaHausse(entrees({ chiffreDAffaires: chiffreParMois({ ...MOIS_2025, ...MOIS_2026_PLAT, '2026-07': 1_750_000 }) })))

  it('l’alerte de la Vue d’ensemble dit le trimestre, le cumul et le seuil, sans un conseil', () => {
    const dit = ceQueDitLaVue({ etat: 'lue', hausse })
    if (dit.genre !== 'alerte') throw new Error(dit.genre)
    expect(dit.phrases).toEqual([
      `Le chiffre d’affaires du 3e trimestre 2026 (juillet à septembre) est de ${formatMoney(37_500)}, contre ${formatMoney(30_000)} au même trimestre de 2025 : +25,0${NB}%.`,
      `Depuis le 1er janvier 2026 : ${formatMoney(97_500)}, contre ${formatMoney(90_000)} du 1er janvier au 30/09/2025 : +8,3${NB}%.`,
      `Le seuil de ce dossier est de 20${NB}%.`,
    ])
    for (const p of dit.phrases) expect(p).not.toMatch(/conseil|devriez|pensez|il faut|réinvest|optimis|cotisations|impôt/i)
  })

  it('les cas muets ou discrets : sans objet, en cours, sans seuil, une hausse vue, une hausse sous le seuil — rien ; illisible, en attente, sans comparaison — une ligne discrète', () => {
    expect(ceQueDitLaVue({ etat: 'sans_objet' })).toEqual({ genre: 'rien' })
    expect(ceQueDitLaVue({ etat: 'en_cours' })).toEqual({ genre: 'rien' })
    expect(ceQueDitLaVue({ etat: 'lue', hausse: { etat: 'sans_seuil' } })).toEqual({ genre: 'rien' })
    expect(ceQueDitLaVue({ etat: 'lue', hausse: { ...hausse, vue: { dossier_id: 'd1', annee: 2026, trimestre: 3, vue_par: 'u', vue_le: '2026-11-16T09:00:00Z' } } })).toEqual({ genre: 'rien' })
    expect(ceQueDitLaVue({ etat: 'lue', hausse: jugerLaHausse(entrees()) })).toEqual({ genre: 'rien' })
    expect(ceQueDitLaVue({ etat: 'illisible', motif: 'x' }).genre).toBe('discret')
    const enAttente = ceQueDitLaVue({ etat: 'lue', hausse: jugerLaHausse(entrees({ releve: releveDe('2025-01', '2026-08') })) })
    expect(enAttente).toEqual({ genre: 'discret', phrase: 'Alerte de hausse : le 3e trimestre 2026 (juillet à septembre) se jugera quand le relevé de septembre 2026 sera importé.' })
    expect(ceQueDitLaVue({ etat: 'lue', hausse: jugerLaHausse(entrees({ releve: releveDe('2026-01', '2026-10') })) })).toEqual({
      genre: 'discret',
      phrase: 'Alerte de hausse : le 3e trimestre 2026 (juillet à septembre) ne se compare pas à l’année d’avant — le relevé manque pour '
        + 'juillet 2025, août 2025, septembre 2025.',
    })
  })

  it('la confirmation nomme le trimestre et ce qui s’écrit ; la marque dit qui et quand ; le tableau de bord, les deux variations et le seuil', () => {
    expect(confirmationDeLaMarque({ annee: 2026, trimestre: 3 })).toContain('3e trimestre 2026 (juillet à septembre)')
    expect(confirmationDeLaMarque({ annee: 2026, trimestre: 3 })).toContain('ne se retire pas')
    const v: HausseVue = { dossier_id: 'd1', annee: 2026, trimestre: 3, vue_par: 'abcdef12-0000-4000-8000-000000000001', vue_le: '2026-11-16T09:00:00Z' }
    expect(phraseDeLaMarque(v, 'abcdef12-0000-4000-8000-000000000001')).toBe('3e trimestre 2026 (juillet à septembre) : vue avec le client le 16/11/2026, par toi.')
    expect(phraseDeLaMarque(v, null)).toContain('par un autre compte du cabinet (abcdef12)')
    expect(phraseDuTableauDeBord(hausse)).toBe(`3e trimestre 2026 (juillet à septembre) : trimestre +25,0${NB}%, cumul +8,3${NB}% (seuil 20${NB}%).`)
    expect(marquesDansLOrdre([{ ...v, trimestre: 1 }, v, { ...v, annee: 2025, trimestre: 4 }]).map((m) => `${m.annee}-${m.trimestre}`)).toEqual(['2026-3', '2026-1', '2025-4'])
  })
})
