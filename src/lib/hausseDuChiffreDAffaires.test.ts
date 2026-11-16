import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  aUnSeuil, alerteAVoir, atteintLeSeuil, atteintLeSeuilDeBaisse, BORNES_DES_SEUILS, bornesDesDouzeMois, bornesDuTrimestre, ceQueDitLaVue,
  chiffreDAffairesDesSources, confirmationDeLaMarque, deDevant, dernierTrimestreClos, franchissement, HAUSSE_DU_CHIFFRE_D_AFFAIRES_PREVUE,
  jugerLaHausse, libelleDuTrimestre, marquesDansLOrdre, moisDeLaPeriode, moisEnMots, phraseDeLaMarque, phraseDesSeuils,
  phraseDesSeuilsDuDossier, phraseDuReglage, phraseDuTableauDeBord, pourcentDesDixiemes, REFUS_DE_LA_BASE, refusDuSeuil,
  seuilDeLaSaisie, seuilsDeLaLigne, SEUILS_HORS_BORNES, SEUILS_VIDES, TITRE_DE_L_ALERTE, TITRE_DE_L_ALERTE_DANS_LES_DEUX_SENS,
  TITRE_DE_L_ALERTE_DE_BAISSE, type EntreesDeLaHausse, type HausseDuChiffreDAffaires, type HausseVue, type MouvementDuReleve,
  type SeuilDuDossier, type SourcesDuChiffreDAffaires,
} from './hausseDuChiffreDAffaires'
import { CAISSE_ABSENTE } from './recettesDeCaisse'
import { paiementsDesPieces } from './rattachement'
import { totauxPourAnnee } from './estimation'
import { recettesFactureesVides, ventesFactureesVides } from '../test/ventesFacturees'
import type { LigneBancaire, Piece } from './types'
import { formatMoney } from './format'

// L'espace insécable devant « % » : un pourcentage ne se coupe pas de son signe.
const NB = String.fromCharCode(160)

// L'ALERTE DU CHIFFRE D'AFFAIRES, À LA HAUSSE ET À LA BAISSE (docs/conceptions/52-alerte-hausse-du-chiffre-d-affaires.md ; les
// réponses du cabinet du 16/11/2026, CA-Q1 à CA-Q5) : les trimestres et les douze mois, le jugement et ses cas muets, les deux
// seuils jugés en entiers, le chiffre d'une période tiré du moteur de l'estimation, les mots — neutres —, et les refus de la
// base confrontés au texte de la migration préparée. Les essais de la base : supabase/essais/hausseDuChiffreDAffaires.sql et
// son compagnon de réplique, hausseDuChiffreDAffairesSuppression.sql.

/** Les fichiers d'un dossier du dépôt dont le nom suit le motif (aucun si le dossier manque). */
function fichiersDe(dossier: string, motif: RegExp): string[] {
  const chemin = resolve(process.cwd(), dossier)
  return existsSync(chemin) ? readdirSync(chemin).filter((n) => motif.test(n)).map((n) => `${dossier}/${n}`) : []
}

// La migration vit dans `supabase/preparees/` tant qu'elle n'est pas appliquée, puis dans l'export sous la version de sa ligne
// d'historique, texte inchangé : le test la trouve où elle est — un seul fichier en tout —, et juge le drapeau contre ce lieu.
const NOM_DE_LA_MIGRATION = /^\d{14}_hausse_du_chiffre_d_affaires\.sql$/
const PREPAREES = fichiersDe('supabase/preparees', NOM_DE_LA_MIGRATION)
const DANS_L_EXPORT = fichiersDe('supabase/schema', NOM_DE_LA_MIGRATION)
const MIGRATION = [...PREPAREES, ...DANS_L_EXPORT][0]
const RETOUR = 'supabase/preparees/retour/20261115140100_retour_hausse_du_chiffre_d_affaires.sql'
const texte = readFileSync(resolve(process.cwd(), MIGRATION), 'utf8')
const retour = readFileSync(resolve(process.cwd(), RETOUR), 'utf8')

describe('le drapeau et les fichiers de la migration', () => {
  it('une seule migration, préparée tant que le drapeau est baissé, dans l’export une fois levé ; son retour et ses deux essais à côté', () => {
    expect([...PREPAREES, ...DANS_L_EXPORT]).toHaveLength(1)
    expect(DANS_L_EXPORT).toHaveLength(HAUSSE_DU_CHIFFRE_D_AFFAIRES_PREVUE ? 1 : 0)
    expect(PREPAREES).toHaveLength(HAUSSE_DU_CHIFFRE_D_AFFAIRES_PREVUE ? 0 : 1)
    for (const f of [RETOUR, 'supabase/essais/hausseDuChiffreDAffaires.sql', 'supabase/essais/hausseDuChiffreDAffairesSuppression.sql']) {
      expect(existsSync(resolve(process.cwd(), f)), f).toBe(true)
    }
  })

  it('chaque refus de la base est redit sous ses mots, l’apostrophe doublée dans le texte SQL', () => {
    for (const [nom, mots] of Object.entries(REFUS_DE_LA_BASE)) {
      expect(texte, nom).toContain(`'${mots.replace(/'/g, "''")}'`)
    }
  })

  it('les bornes des deux seuils sont celles de la base, et le client n’a aucune branche', () => {
    expect(BORNES_DES_SEUILS).toEqual({ hausse: { minimum: 1, maximum: 1000 }, baisse: { minimum: 1, maximum: 100 } })
    expect(texte).toContain('check (seuil_de_hausse between 1 and 1000)')
    expect(texte).toContain('check (seuil_de_baisse between 1 and 100)')
    expect(texte).toContain("if p_sens = 'hausse' and p_seuil is not null and (p_seuil < 1 or p_seuil > 1000) then")
    expect(texte).toContain("if p_sens = 'baisse' and p_seuil is not null and (p_seuil < 1 or p_seuil > 100) then")
    expect(texte).toContain("if p_sens is null or p_sens not in ('hausse', 'baisse') then")
    expect(texte).not.toMatch(/client_du_dossier|droits_sur_le_dossier/)
    expect(texte).not.toMatch(/\bdelete\s+from\b|\bdrop\b|\btruncate\b/i)
  })

  it('le retour exige les quatre corps de la migration, à l’empreinte, et retire la fonction sous sa signature à quatre paramètres', () => {
    const corps = [...texte.matchAll(/create\s+function\s+public\.(\w+)\([^)]*\)[\s\S]*?\bas\s+\$\$([\s\S]*?)\$\$;/gi)]
    expect(corps.map((m) => m[1]).sort()).toEqual([
      'garder_hausse_vue_avec_le_client', 'garder_seuil_du_chiffre_d_affaires', 'marquer_hausse_vue_avec_le_client',
      'regler_seuil_du_chiffre_d_affaires',
    ])
    for (const [, nom, source] of corps) {
      const empreinte = createHash('md5').update(source).digest('hex')
      expect(retour, nom).toMatch(new RegExp(`'public\\.${nom}\\([^)]*\\)'\\)\\)\\s+is distinct from '${empreinte}'`))
    }
    expect(retour).toMatch(/drop\s+function\s+public\.regler_seuil_du_chiffre_d_affaires\(uuid,\s*text,\s*integer,\s*integer\);/i)
  })
})

describe('les trimestres et les douze mois', () => {
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

  it('les douze mois clos qui finissent avec le trimestre ; au 4e, l’année civile', () => {
    expect(bornesDesDouzeMois({ annee: 2026, trimestre: 1 })).toEqual({ debut: '2025-04-01', fin: '2026-03-31' })
    expect(bornesDesDouzeMois({ annee: 2026, trimestre: 2 })).toEqual({ debut: '2025-07-01', fin: '2026-06-30' })
    expect(bornesDesDouzeMois({ annee: 2026, trimestre: 3 })).toEqual({ debut: '2025-10-01', fin: '2026-09-30' })
    expect(bornesDesDouzeMois({ annee: 2026, trimestre: 4 })).toEqual({ debut: '2026-01-01', fin: '2026-12-31' })
    for (const t of [1, 2, 3, 4] as const) {
      const { debut, fin } = bornesDesDouzeMois({ annee: 2026, trimestre: t })
      expect(moisDeLaPeriode(debut, fin), String(t)).toHaveLength(12)
    }
  })

  it('des mois en mots : une suite se dit de son premier à son dernier ; la préposition s’élide devant une voyelle', () => {
    expect(moisEnMots(['2026-09'])).toBe('septembre 2026')
    expect(moisEnMots(['2024-10', '2024-11', '2024-12', '2025-01'])).toBe('octobre 2024 à janvier 2025')
    expect(moisEnMots(['2025-01', '2025-02', '2025-05'])).toBe('janvier 2025 à février 2025, mai 2025')
    expect(deDevant('août 2026')).toBe('d’août 2026')
    expect(deDevant('octobre 2024 à septembre 2025')).toBe('d’octobre 2024 à septembre 2025')
    expect(deDevant('avril 2026')).toBe('d’avril 2026')
    expect(deDevant('septembre 2026')).toBe('de septembre 2026')
  })
})

describe('les deux seuils, en entiers exacts', () => {
  it('la hausse atteint 20 % pile, pas un centime en dessous ; sans recettes l’année d’avant, jamais', () => {
    expect(atteintLeSeuil(120_000, 100_000, 20)).toBe(true)
    expect(atteintLeSeuil(119_999, 100_000, 20)).toBe(false)
    expect(atteintLeSeuil(90_000, 100_000, 20)).toBe(false)
    expect(atteintLeSeuil(1, 0, 1)).toBe(false)
    // Un arrondi d'affichage ne décide rien : 19,96 % se MONTRE 20,0 %, mais n'atteint pas 20 %.
    expect(atteintLeSeuil(1_199_600, 1_000_000, 20)).toBe(false)
  })

  it('la baisse atteint 20 % pile, pas un centime au-dessus ; 100 %, le chiffre tombé à zéro ; sans recettes l’année d’avant, jamais', () => {
    expect(atteintLeSeuilDeBaisse(80_000, 100_000, 20)).toBe(true)
    expect(atteintLeSeuilDeBaisse(80_001, 100_000, 20)).toBe(false)
    expect(atteintLeSeuilDeBaisse(120_000, 100_000, 20)).toBe(false)
    expect(atteintLeSeuilDeBaisse(0, 100_000, 100)).toBe(true)
    expect(atteintLeSeuilDeBaisse(1, 100_000, 100)).toBe(false)
    expect(atteintLeSeuilDeBaisse(0, 0, 1)).toBe(false)
    // −19,96 % se MONTRE −20,0 %, mais n'atteint pas 20 %.
    expect(atteintLeSeuilDeBaisse(800_400, 1_000_000, 20)).toBe(false)
  })

  it('le franchissement : le sens du seuil atteint, un seuil nul ne jugeant rien', () => {
    expect(franchissement(130_000, 100_000, { hausse: 20, baisse: 20 })).toBe('hausse')
    expect(franchissement(70_000, 100_000, { hausse: 20, baisse: 20 })).toBe('baisse')
    expect(franchissement(110_000, 100_000, { hausse: 20, baisse: 20 })).toBeNull()
    expect(franchissement(70_000, 100_000, { hausse: 20, baisse: null })).toBeNull()
    expect(franchissement(130_000, 100_000, { hausse: null, baisse: 20 })).toBeNull()
    expect(aUnSeuil({ hausse: null, baisse: null })).toBe(false)
    expect(aUnSeuil({ hausse: null, baisse: 5 })).toBe(true)
  })

  it('la saisie : vide (aucun seuil), un entier dans les bornes de son sens, rien d’autre', () => {
    expect(seuilDeLaSaisie('')).toBeNull()
    expect(seuilDeLaSaisie(' 25 ')).toBe(25)
    for (const t of ['0', '1001', '12,5', '-3', 'vingt']) expect(refusDuSeuil('hausse', seuilDeLaSaisie(t)), t).toBe(SEUILS_HORS_BORNES.hausse)
    for (const t of ['', '1', '101', '1000']) expect(refusDuSeuil('hausse', seuilDeLaSaisie(t)), t).toBeNull()
    for (const t of ['0', '101', '1000', '7,5']) expect(refusDuSeuil('baisse', seuilDeLaSaisie(t)), t).toBe(SEUILS_HORS_BORNES.baisse)
    for (const t of ['', '1', '15', '100']) expect(refusDuSeuil('baisse', seuilDeLaSaisie(t)), t).toBeNull()
  })

  it('la variation montrée, au dixième de point', () => {
    expect(pourcentDesDixiemes(302)).toBe(`+30,2${NB}%`)
    expect(pourcentDesDixiemes(-40)).toBe(`−4,0${NB}%`)
    expect(pourcentDesDixiemes(0)).toBe(`0,0${NB}%`)
  })

  it('les seuils d’une ligne lue, ou deux seuils nuls sans ligne', () => {
    expect(seuilsDeLaLigne(null)).toEqual({ hausse: null, baisse: null })
    expect(seuilsDeLaLigne({ seuil_de_hausse: 20, seuil_de_baisse: null })).toEqual({ hausse: 20, baisse: null })
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

const MOIS_2024 = Object.fromEntries(moisDeLaPeriode('2024-01-01', '2024-12-31').map((m) => [m, 1_000_000]))
const MOIS_2025 = Object.fromEntries(moisDeLaPeriode('2025-01-01', '2025-12-31').map((m) => [m, 1_000_000]))
const MOIS_2026_PLAT = Object.fromEntries(moisDeLaPeriode('2026-01-01', '2026-10-31').map((m) => [m, 1_000_000]))

function entrees(e: Partial<EntreesDeLaHausse> = {}): EntreesDeLaHausse {
  return {
    seuils: { hausse: 20, baisse: null }, aujourdHui: '2026-11-15', releve: releveDe('2025-01', '2026-10'),
    chiffreDAffaires: chiffreParMois({ ...MOIS_2025, ...MOIS_2026_PLAT }), vues: [], ...e,
  }
}

const jugee = (h: HausseDuChiffreDAffaires) => {
  if (h.etat !== 'jugee') throw new Error(`attendue jugée : ${h.etat}`)
  return h
}

describe('le jugement du dernier trimestre clos', () => {
  it('sans aucun seuil, rien ne se calcule', () => {
    const chiffre = vi.fn(() => 0)
    expect(jugerLaHausse(entrees({ seuils: { hausse: null, baisse: null }, chiffreDAffaires: chiffre }))).toEqual({ etat: 'sans_seuil' })
    expect(chiffre).not.toHaveBeenCalled()
  })

  it('un trimestre plat : jugé, sans hausse ni baisse ; le trimestre et le cumul comparés', () => {
    const h = jugee(jugerLaHausse(entrees({ seuils: { hausse: 20, baisse: 20 } })))
    expect(h.trimestre).toEqual({ annee: 2026, trimestre: 3 })
    expect([h.hausse, h.baisse]).toEqual([false, false])
    expect(h.duTrimestre).toMatchObject({ etat: 'comparee', comparaison: { centimes: 3_000_000, precedentCentimes: 3_000_000, variationDixiemes: 0, franchit: null } })
    expect(h.duCumul).toMatchObject({ etat: 'comparee', comparaison: { debut: '2026-01-01', fin: '2026-09-30', debutPrecedent: '2025-01-01', finPrecedent: '2025-09-30' } })
    expect(alerteAVoir(h)).toBe(false)
  })

  it('le trimestre à +25 % et le cumul à +8,3 % : la hausse du trimestre suffit (l’un ou l’autre, CA-Q1)', () => {
    const h = jugee(jugerLaHausse(entrees({ chiffreDAffaires: chiffreParMois({ ...MOIS_2025, ...MOIS_2026_PLAT, '2026-07': 1_750_000 }) })))
    expect(h.duTrimestre).toMatchObject({ comparaison: { variationDixiemes: 250, franchit: 'hausse' } })
    expect(h.duCumul).toMatchObject({ comparaison: { variationDixiemes: 83, franchit: null } })
    expect([h.hausse, h.baisse]).toEqual([true, false])
    expect(alerteAVoir(h)).toBe(true)
  })

  it('une baisse de 25 % du trimestre : l’alerte se dit sous le seuil de baisse seul (CA-Q2), jamais sous celui de hausse', () => {
    const chiffre = chiffreParMois({ ...MOIS_2025, ...MOIS_2026_PLAT, '2026-07': 250_000 })
    const h = jugee(jugerLaHausse(entrees({ seuils: { hausse: null, baisse: 20 }, chiffreDAffaires: chiffre })))
    expect(h.duTrimestre).toMatchObject({ comparaison: { variationDixiemes: -250, franchit: 'baisse' } })
    expect([h.hausse, h.baisse]).toEqual([false, true])
    expect(alerteAVoir(h)).toBe(true)
    expect(alerteAVoir(jugerLaHausse(entrees({ seuils: { hausse: 20, baisse: null }, chiffreDAffaires: chiffre })))).toBe(false)
    expect(alerteAVoir(jugerLaHausse(entrees({ seuils: { hausse: 20, baisse: 30 }, chiffreDAffaires: chiffre })))).toBe(false)
  })

  it('les douze mois (CA-Q3) : comparés aux douze d’avant quand le relevé couvre les deux ans ; seuls, ils suffisent à l’alerte', () => {
    // Le 4e trimestre 2025 double celui de 2024 : le trimestre et le cumul de 2026 restent plats, les douze mois montent de 25 %.
    const parMois = { ...MOIS_2024, ...MOIS_2025, ...MOIS_2026_PLAT, '2025-10': 2_000_000, '2025-11': 2_000_000, '2025-12': 2_000_000 }
    const h = jugee(jugerLaHausse(entrees({ releve: releveDe('2024-10', '2026-10'), chiffreDAffaires: chiffreParMois(parMois) })))
    expect(h.duTrimestre).toMatchObject({ comparaison: { franchit: null } })
    expect(h.duCumul).toMatchObject({ comparaison: { franchit: null } })
    expect(h.surDouzeMois).toMatchObject({
      etat: 'comparee',
      comparaison: {
        debut: '2025-10-01', fin: '2026-09-30', debutPrecedent: '2024-10-01', finPrecedent: '2025-09-30',
        centimes: 15_000_000, precedentCentimes: 12_000_000, variationDixiemes: 250, franchit: 'hausse',
      },
    })
    expect(alerteAVoir(h)).toBe(true)
  })

  it('les douze mois muets tant que le relevé ne couvre pas les douze d’avant ; le trimestre et le cumul se jugent quand même', () => {
    const h = jugee(jugerLaHausse(entrees()))
    expect(h.surDouzeMois).toEqual({ etat: 'non_comparable', raison: 'releve_manquant', mois: ['2024-10', '2024-11', '2024-12'] })
    expect(h.duTrimestre.etat).toBe('comparee')
    // Un crédit à traiter dans les douze mois d'avant les tait aussi, sans toucher au trimestre.
    const credit: MouvementDuReleve = { date: '2024-11-05', montant: 120, statut: 'non_rapprochee' }
    const avecCredit = jugee(jugerLaHausse(entrees({ releve: [...releveDe('2024-10', '2026-10'), credit] })))
    expect(avecCredit.surDouzeMois).toEqual({ etat: 'non_comparable', raison: 'mouvements_a_traiter', mois: ['2024-11'] })
    expect(avecCredit.duTrimestre.etat).toBe('comparee')
  })

  it('une hausse du trimestre et une baisse sur douze mois : les deux sens, dits ensemble', () => {
    const parMois: Record<string, number> = { ...MOIS_2024, ...MOIS_2025 }
    for (const m of moisDeLaPeriode('2025-10-01', '2026-06-30')) parMois[m] = 500_000
    for (const m of ['2026-07', '2026-08', '2026-09']) parMois[m] = 1_250_000
    const h = jugee(jugerLaHausse(entrees({
      seuils: { hausse: 20, baisse: 20 }, releve: releveDe('2024-10', '2026-10'), chiffreDAffaires: chiffreParMois(parMois),
    })))
    expect(h.duTrimestre).toMatchObject({ comparaison: { variationDixiemes: 250, franchit: 'hausse' } })
    expect(h.duCumul).toMatchObject({ comparaison: { variationDixiemes: -250, franchit: 'baisse' } })
    expect(h.surDouzeMois).toMatchObject({ comparaison: { centimes: 8_250_000, precedentCentimes: 12_000_000, franchit: 'baisse' } })
    expect([h.hausse, h.baisse]).toEqual([true, true])
  })

  it('marquée vue avec le client pour CE trimestre, l’alerte ne se dit plus, dans les deux sens ; une marque d’un autre trimestre n’y fait rien', () => {
    const chiffre = chiffreParMois({ ...MOIS_2025, ...MOIS_2026_PLAT, '2026-07': 250_000 })
    const vue: HausseVue = { dossier_id: 'd1', annee: 2026, trimestre: 3, vue_par: 'u1', vue_le: '2026-11-16T09:00:00Z' }
    const seuils = { hausse: 20, baisse: 20 }
    expect(alerteAVoir(jugerLaHausse(entrees({ seuils, chiffreDAffaires: chiffre, vues: [vue] })))).toBe(false)
    expect(alerteAVoir(jugerLaHausse(entrees({ seuils, chiffreDAffaires: chiffre, vues: [{ ...vue, trimestre: 2 }] })))).toBe(true)
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

  it('au 1er trimestre, le cumul est le trimestre : pas de cumul ; les douze mois, d’avril à mars', () => {
    const h = jugee(jugerLaHausse(entrees({ aujourdHui: '2026-04-20', releve: releveDe('2024-04', '2026-03'), chiffreDAffaires: chiffreParMois({ ...MOIS_2024, ...MOIS_2025, ...MOIS_2026_PLAT }) })))
    expect(h.trimestre).toEqual({ annee: 2026, trimestre: 1 })
    expect(h.duCumul).toBeNull()
    expect(h.surDouzeMois).toMatchObject({ etat: 'comparee', comparaison: { debut: '2025-04-01', fin: '2026-03-31', debutPrecedent: '2024-04-01', finPrecedent: '2025-03-31' } })
  })

  it('en janvier, le 4e trimestre de l’année d’avant : le cumul est l’année entière, et les douze mois, qui la répètent, ne se comptent pas', () => {
    const h = jugee(jugerLaHausse(entrees({
      aujourdHui: '2027-01-20', releve: releveDe('2025-01', '2026-12'),
      chiffreDAffaires: chiffreParMois({ ...MOIS_2025, ...MOIS_2026_PLAT, '2026-11': 1_000_000, '2026-12': 1_000_000 }),
    })))
    expect(h.trimestre).toEqual({ annee: 2026, trimestre: 4 })
    expect(h.duCumul).toMatchObject({ comparaison: { debut: '2026-01-01', fin: '2026-12-31', finPrecedent: '2025-12-31' } })
    expect(h.surDouzeMois).toBeNull()
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

describe('le chiffre d’une période, celui de l’estimation (CA-Q5)', () => {
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
    // Douze mois à cheval sur deux années civiles : la somme des deux trimestres et du reste.
    expect(c.chiffreDAffaires('2025-04-01', '2026-03-31')).toBe(125_050)
  })

  it('une caisse lue en partie ne se compte pas : le motif, et rien de calculé', () => {
    const c = chiffreDAffairesDesSources(sources({ caisse: { dossierId: 'd1', enBase: true, lignes: [], complete: false, motif: 'coupée' } }), false, 'tresorerie')
    expect(c).toEqual({ ok: false, motif: 'coupée' })
  })
})

// ── Les mots ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Aucun conseil : le constat, les chiffres, les seuils. */
const CONSEIL = /conseil|devriez|pensez|il faut|réinvest|optimis|cotisations|impôt|inquiét|attention à/i

describe('les mots, neutres : le constat, les chiffres comparés, les seuils', () => {
  const hausse = jugee(jugerLaHausse(entrees({ chiffreDAffaires: chiffreParMois({ ...MOIS_2025, ...MOIS_2026_PLAT, '2026-07': 1_750_000 }) })))

  it('l’alerte de hausse dit le trimestre, le cumul, les douze mois non comparables et le seuil, sans un conseil', () => {
    const dit = ceQueDitLaVue({ etat: 'lue', hausse })
    if (dit.genre !== 'alerte') throw new Error(dit.genre)
    expect(dit.titre).toBe(TITRE_DE_L_ALERTE)
    expect(dit.phrases).toEqual([
      `Le chiffre d’affaires du 3e trimestre 2026 (juillet à septembre) est de ${formatMoney(37_500)}, contre ${formatMoney(30_000)} au même trimestre de 2025 : +25,0${NB}%.`,
      `Depuis le 1er janvier 2026 : ${formatMoney(97_500)}, contre ${formatMoney(90_000)} du 1er janvier au 30/09/2025 : +8,3${NB}%.`,
      'Les douze mois glissants ne se comparent pas : le relevé d’octobre 2024 à décembre 2024 manque.',
      `Le seuil de hausse de ce dossier est de 20${NB}%.`,
    ])
    for (const p of dit.phrases) expect(p).not.toMatch(CONSEIL)
  })

  it('l’alerte de baisse, et celle des deux sens : leur titre, la phrase des douze mois, les deux seuils', () => {
    const parMois: Record<string, number> = { ...MOIS_2024, ...MOIS_2025 }
    for (const m of moisDeLaPeriode('2025-10-01', '2026-06-30')) parMois[m] = 500_000
    for (const m of ['2026-07', '2026-08', '2026-09']) parMois[m] = 1_250_000
    const lesDeux = jugee(jugerLaHausse(entrees({
      seuils: { hausse: 20, baisse: 15 }, releve: releveDe('2024-10', '2026-10'), chiffreDAffaires: chiffreParMois(parMois),
    })))
    const dit = ceQueDitLaVue({ etat: 'lue', hausse: lesDeux })
    if (dit.genre !== 'alerte') throw new Error(dit.genre)
    expect(dit.titre).toBe(TITRE_DE_L_ALERTE_DANS_LES_DEUX_SENS)
    expect(dit.phrases.slice(2)).toEqual([
      `Sur douze mois, d’octobre 2025 à septembre 2026 : ${formatMoney(82_500)}, contre ${formatMoney(120_000)} d’octobre 2024 à septembre 2025 : −31,3${NB}%.`,
      `Les seuils de ce dossier : une hausse de 20${NB}%, une baisse de 15${NB}%.`,
    ])
    for (const p of dit.phrases) expect(p).not.toMatch(CONSEIL)
    const baisse = jugee(jugerLaHausse(entrees({
      seuils: { hausse: null, baisse: 20 }, chiffreDAffaires: chiffreParMois({ ...MOIS_2025, ...MOIS_2026_PLAT, '2026-07': 250_000 }),
    })))
    const ditBaisse = ceQueDitLaVue({ etat: 'lue', hausse: baisse })
    if (ditBaisse.genre !== 'alerte') throw new Error(ditBaisse.genre)
    expect(ditBaisse.titre).toBe(TITRE_DE_L_ALERTE_DE_BAISSE)
    expect(ditBaisse.phrases[0]).toContain(`: −25,0${NB}%.`)
    expect(ditBaisse.phrases.at(-1)).toBe(`Le seuil de baisse de ce dossier est de 20${NB}%.`)
    expect(phraseDesSeuils({ hausse: null, baisse: null })).toBe(SEUILS_VIDES)
  })

  it('les cas muets ou discrets : sans objet, en cours, sans seuil, une alerte vue, une variation sous les seuils — rien ; illisible, en attente, sans comparaison — une ligne discrète', () => {
    expect(ceQueDitLaVue({ etat: 'sans_objet' })).toEqual({ genre: 'rien' })
    expect(ceQueDitLaVue({ etat: 'en_cours' })).toEqual({ genre: 'rien' })
    expect(ceQueDitLaVue({ etat: 'lue', hausse: { etat: 'sans_seuil' } })).toEqual({ genre: 'rien' })
    expect(ceQueDitLaVue({ etat: 'lue', hausse: { ...hausse, vue: { dossier_id: 'd1', annee: 2026, trimestre: 3, vue_par: 'u', vue_le: '2026-11-16T09:00:00Z' } } })).toEqual({ genre: 'rien' })
    expect(ceQueDitLaVue({ etat: 'lue', hausse: jugerLaHausse(entrees()) })).toEqual({ genre: 'rien' })
    expect(ceQueDitLaVue({ etat: 'illisible', motif: 'x' }).genre).toBe('discret')
    const enAttente = ceQueDitLaVue({ etat: 'lue', hausse: jugerLaHausse(entrees({ releve: releveDe('2025-01', '2026-08') })) })
    expect(enAttente).toEqual({ genre: 'discret', phrase: 'Alerte du chiffre d’affaires : le 3e trimestre 2026 (juillet à septembre) se jugera quand le relevé de septembre 2026 sera importé.' })
    const sansAout = releveDe('2025-01', '2026-10').filter((l) => !l.date.startsWith('2026-08'))
    expect(ceQueDitLaVue({ etat: 'lue', hausse: jugerLaHausse(entrees({ releve: sansAout })) })).toEqual({
      genre: 'discret', phrase: 'Alerte du chiffre d’affaires : le 3e trimestre 2026 (juillet à septembre) se jugera quand le relevé d’août 2026 sera importé.',
    })
    const credit: MouvementDuReleve = { date: '2026-08-20', montant: 450, statut: 'non_rapprochee' }
    expect(ceQueDitLaVue({ etat: 'lue', hausse: jugerLaHausse(entrees({ releve: [...releveDe('2025-01', '2026-10'), credit] })) })).toEqual({
      genre: 'discret', phrase: 'Alerte du chiffre d’affaires : le 3e trimestre 2026 (juillet à septembre) se jugera quand ses encaissements d’août 2026 seront traités.',
    })
    expect(ceQueDitLaVue({ etat: 'lue', hausse: jugerLaHausse(entrees({ releve: releveDe('2026-01', '2026-10') })) })).toEqual({
      genre: 'discret',
      phrase: 'Alerte du chiffre d’affaires : le 3e trimestre 2026 (juillet à septembre) ne se compare pas à l’année d’avant — le relevé '
        + 'de juillet 2025 à septembre 2025 manque.',
    })
  })

  it('la confirmation nomme le trimestre et ce qui s’écrit ; la marque dit qui et quand ; le tableau de bord, les variations et les seuils', () => {
    expect(confirmationDeLaMarque({ annee: 2026, trimestre: 3 })).toContain('l’alerte du 3e trimestre 2026 (juillet à septembre)')
    expect(confirmationDeLaMarque({ annee: 2026, trimestre: 3 })).toContain('ne se retire pas')
    const v: HausseVue = { dossier_id: 'd1', annee: 2026, trimestre: 3, vue_par: 'abcdef12-0000-4000-8000-000000000001', vue_le: '2026-11-16T09:00:00Z' }
    expect(phraseDeLaMarque(v, 'abcdef12-0000-4000-8000-000000000001')).toBe('3e trimestre 2026 (juillet à septembre) : vue avec le client le 16/11/2026, par toi.')
    expect(phraseDeLaMarque(v, null)).toContain('par un autre compte du cabinet (abcdef12)')
    expect(phraseDuTableauDeBord(hausse)).toBe(`3e trimestre 2026 (juillet à septembre) : trimestre +25,0${NB}%, cumul +8,3${NB}% (seuil de hausse 20${NB}%).`)
    const douze = jugee(jugerLaHausse(entrees({
      seuils: { hausse: 20, baisse: 10 }, releve: releveDe('2024-10', '2026-10'),
      chiffreDAffaires: chiffreParMois({ ...MOIS_2024, ...MOIS_2025, ...MOIS_2026_PLAT, '2026-07': 1_750_000 }),
    })))
    expect(phraseDuTableauDeBord(douze)).toBe(`3e trimestre 2026 (juillet à septembre) : trimestre +25,0${NB}%, cumul +8,3${NB}%, `
      + `douze mois +6,3${NB}% (seuils : hausse 20${NB}%, baisse 10${NB}%).`)
    expect(marquesDansLOrdre([{ ...v, trimestre: 1 }, v, { ...v, annee: 2025, trimestre: 4 }]).map((m) => `${m.annee}-${m.trimestre}`)).toEqual(['2026-3', '2026-1', '2025-4'])
  })

  it('la carte : les deux seuils, ou « aucun », et le dernier réglage posé par la base ; ce que dit un réglage réussi', () => {
    const ligneLue: SeuilDuDossier = { dossier_id: 'd1', seuil_de_hausse: 20, seuil_de_baisse: null, regle_par: 'u-chef', regle_le: '2026-11-16T09:00:00Z' }
    expect(phraseDesSeuilsDuDossier(null, 'u-chef')).toBe(SEUILS_VIDES)
    expect(phraseDesSeuilsDuDossier(ligneLue, 'u-chef'))
      .toBe(`Seuil de hausse : 20${NB}% ; seuil de baisse : aucun. Dernier réglage le 16/11/2026, par toi.`)
    expect(phraseDesSeuilsDuDossier({ ...ligneLue, seuil_de_hausse: null }, 'u-chef'))
      .toBe(`${SEUILS_VIDES} Dernier réglage le 16/11/2026, par toi.`)
    expect(phraseDuReglage('baisse', 15)).toBe(`Seuil de baisse enregistré : 15${NB}% ✓`)
    expect(phraseDuReglage('hausse', null)).toBe('Seuil de hausse retiré : l’alerte de hausse ne se calcule plus ✓')
  })
})
