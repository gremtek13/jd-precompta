import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  CAISSE_EXPORTEE, ecritureDeLOperation, ensembleDuJour, fluxDeLaCaisse, former, GESTES_DE_LA_CAISSE, jugerLaSaisie,
  jugerLaSaisieDUnMois, jugerLeRemplacement, jugerLeRetrait, MOTS_DE_LA_CAISSE, ORDRE_DES_REFUS, origineDite,
  premierJourNegatif, refusDeLaCaisse, refusDeLaSaisie, refusDeLaSaisieDUnMois, refusDuRemplacement, refusDuRetrait,
  remplacanteDe, soldesDeLaCaisse, texteCaisseNegative, versionsDeLOperation,
  type DossierDeLaCaisse, type EtatDeLaCaisse, type OperationDeLaCaisse, type SaisieDeCaisse,
} from './caisse'
import { PLAN_DECALE, PLAN_PAR_DEFAUT } from './planComptable'
import { commeLike, etapesDeLEssai, rejouerLEssai } from '../test/essaiCaisse'
import { fichiersDuSchema, fichiersPrepares } from '../test/schema'

// LE MODULE DE LA CAISSE CONFRONTÉ À LA BASE (ligne 26.6, étape C2). Deux juges, dans cet ordre :
//   1. L'ESSAI (supabase/essais/caisse.sql), ce que la base a RÉPONDU sur la réplique munie des deux migrations : chacune
//      de ses étapes que le module porte se rejoue ici, dans le même ordre, sur le même jeu (src/test/essaiCaisse.ts), et
//      son verdict — le code, et le message ou son motif — doit être celui de la base. Ce qui ne se rejoue pas se compte.
//   2. LE TEXTE DES DEUX MIGRATIONS, où qu'elles soient (préparées aujourd'hui, dans l'export le jour de leur
//      application) : les mots de chaque refus et leur ordre sont RELUS dans le corps des fonctions, jamais recopiés ici.

const ESSAI = readFileSync(new URL('../../supabase/essais/caisse.sql', import.meta.url), 'utf8')
// Le jour où l'essai a été joué, à Paris : ses dates sont de mars 2026, et « demain » le suit.
const AUJOURDHUI = '2026-10-29'

const sansApostrophes = (s: string) => s.replace(/''/g, "'").replace(/’/g, "'")

// ── Le texte des migrations ──────────────────────────────────────────────────────────────────────────────────────────

const MIGRATIONS = [...fichiersDuSchema(), ...fichiersPrepares()]
  .sort((a, b) => (a.chemin.split('/').pop()! < b.chemin.split('/').pop()! ? -1 : 1))

/** La dernière définition d'une fonction, dans l'export et les migrations préparées, dans l'ordre de leurs versions. */
function definition(nom: string): string {
  const motif = new RegExp(`create (?:or replace )?function public\\.${nom}\\(`, 'g')
  const fichier = MIGRATIONS.filter((f) => new RegExp(motif.source).test(f.texte)).pop()
  if (!fichier) throw new Error(`${nom} introuvable`)
  const debut = [...fichier.texte.matchAll(motif)].pop()!.index
  return fichier.texte.slice(debut, fichier.texte.indexOf('\n$$;', debut))
}

/** Les `raise exception` d'un corps, dans l'ordre du texte : leur gabarit (l'apostrophe doublée rendue simple) et leur code. */
function raises(corps: string): { gabarit: string; code: string }[] {
  return [...corps.matchAll(/raise exception '((?:[^']|'')*)'([^;]*);/g)].map((m) => ({
    gabarit: m[1].replace(/''/g, "'"),
    code: /using errcode = '(\w+)'/.exec(m[2])?.[1] ?? /using errcode = (\w+)/.exec(m[2])?.[1] ?? '',
  }))
}

describe('les mots et l’ordre des refus, relus dans le texte des deux migrations', () => {
  it('l’accès, celui de `qui_ecrit_la_caisse`, pour les quatre', () => {
    expect(raises(definition('qui_ecrit_la_caisse'))).toEqual([MOTS_DE_LA_CAISSE.acces])
    for (const f of ['enregistrer_operation_caisse', 'enregistrer_operations_de_caisse', 'retirer_operation_caisse', 'remplacer_operation_caisse']) {
      const corps = definition(f)
      // L'accès vient avant toute lecture : son appel précède le premier `select` et le premier `raise`.
      const acces = corps.search(/public\.qui_ecrit_la_caisse\(p_dossier_id\)/)
      expect(acces, f).toBeGreaterThan(0)
      expect(acces, f).toBeLessThan(corps.search(/raise exception/))
      expect(acces, f).toBeLessThan(corps.search(/\bfrom public\./))
    }
  })

  for (const f of Object.keys(ORDRE_DES_REFUS) as (keyof typeof ORDRE_DES_REFUS)[]) {
    it(`${f} : chaque refus, son code et ses mots, dans l’ordre du texte`, () => {
      // Les refus dont le texte vient d'ailleurs (`raise exception '%', …` : la caisse négative, le refus d'un mois nommé
      // par son rang) se jugent à part ; le code interne du remplacement (JDC1B), qu'aucun appelant ne reçoit, aussi.
      const lus = raises(definition(f)).filter((r) => r.gabarit !== '%' && r.code !== 'JDC1B')
        // La date d'un mois se refuse deux fois sous les mêmes mots (sa forme, puis sa conversion) : un seul refus.
        .filter((r, i, tous) => i === 0 || r.gabarit !== tous[i - 1].gabarit)
      const attendus = ORDRE_DES_REFUS[f].map((cle) => MOTS_DE_LA_CAISSE[cle])
      expect(lus.map((r) => `${r.code} ${sansApostrophes(r.gabarit)}`)).toEqual(attendus.map((r) => `${r.code} ${sansApostrophes(r.gabarit)}`))
      expect(lus.length, f).toBeGreaterThanOrEqual(5)
    })
  }

  it('les refus qui portent un texte composé : la caisse négative, et le rang d’une opération d’un mois', () => {
    const saisie = definition('enregistrer_operation_caisse')
    expect(saisie).toContain("raise exception '%', public.texte_caisse_negative(case when p_genre = 'prelevement' then 'prelevement' else 'especes_rendues' end,")
    const mois = definition('enregistrer_operations_de_caisse')
    expect(mois).toContain("raise exception '%', format('Opération n° %s%s : %s', v_rang,")
    expect(mois).toContain("case when v_jour_lu is not null then ', du ' || v_jour_lu else '' end, v_message) using errcode = v_code;")
    expect(mois).toContain("raise exception '%', public.texte_caisse_negative('lot', 0, v_jour, v_solde) using errcode = '23514';")
    for (const f of ['retirer_operation_caisse', 'remplacer_operation_caisse']) {
      expect(definition(f)).toMatch(/raise exception '%', public\.texte_caisse_negative\('retrait_' \|\| v_(operation|ancienne)\.genre, v_(operation|ancienne)\.montant, v_jour, v_solde\)\s+using errcode = '23514';/)
    }
  })

  it('les mots d’une caisse négative, geste par geste, ceux de `texte_caisse_negative`', () => {
    const corps = definition('texte_caisse_negative')
    const gestes = [...corps.matchAll(/when '(\w+)' then format\('((?:[^']|'')*)'/g)].map((m) => [m[1], sansApostrophes(m[2])])
    const sinon = /else format\('((?:[^']|'')*)'/.exec(corps)![1]
    expect([...gestes, ['autre', sansApostrophes(sinon)]]).toEqual(Object.entries(GESTES_DE_LA_CAISSE).map(([g, t]) => [g, sansApostrophes(t)]))
    expect(gestes.length).toBeGreaterThanOrEqual(16)
    // Le montant et le solde, sans signe, à deux décimales, la virgule pour le point ; le solde négatif, le moins
    // typographique ; le jour, en JJ/MM/AAAA.
    expect(corps).toContain("replace(to_char(abs(p_montant), 'FM999999999990.00'), '.', ',') as montant")
    expect(corps).toContain("to_char(p_jour, 'DD/MM/YYYY') as jour")
    expect(corps).toContain("case when p_solde < 0 then '−' else '' end || replace(to_char(abs(p_solde), 'FM999999999990.00'), '.', ',') as solde")
  })

  it('l’écriture : les comptes du plan, la TVA incluse, le libellé de la base', () => {
    const corps = definition('enregistrer_operation_caisse')
    expect(corps).toContain("v_caisse := public.compte_du_role(p_dossier_id, 'caisse');")
    expect(corps).toContain("v_collectee := public.compte_du_role(p_dossier_id, 'tva_collectee');")
    expect(corps).toContain('v_dirigeant := public.compte_du_dirigeant(p_dossier_id);')
    expect(corps).toContain('v_tva := (public.tva_incluse(abs(p_montant), p_taux_tva) * 100)::bigint;')
    expect(corps).toContain("v_libelle := case when p_montant > 0 then 'Recettes en espèces du ' else 'Espèces rendues le ' end")
    expect(corps).toContain("|| to_char(p_date, 'DD/MM/YYYY') || ' — ' || v_categorie.libelle;")
    for (const op of [{ genre: 'apport' as const }, { genre: 'prelevement' as const }]) {
      const libelle = ecritureDeLOperation({ ...op, date: '2026-03-02', montant: 10, taux_tva: null, categorie: null }, MODELE)[0].libelle
      expect(corps).toContain(`'${libelle.replace(/'/g, "''")}'`)
    }
  })

  it('les soldes : les quatre flux de `premier_jour_negatif_de_la_caisse`, un solde par jour, le premier négatif', () => {
    const corps = definition('premier_jour_negatif_de_la_caisse')
    expect(corps).toContain("select a.date, case when a.sens = 'debit' then a.montant else -a.montant end")
    expect(corps).toContain("select o.date, case when o.genre = 'prelevement' then -o.montant else o.montant end")
    expect(corps).toContain('where o.dossier_id = p_dossier_id and o.retire_le is null')
    expect(corps).toContain('select l.date, -l.montant')
    expect(corps).toContain('where l.dossier_id = p_dossier_id and l.compte_bilan = c.compte')
    expect(corps).toContain('where e.dossier_id = p_dossier_id and f.source_de_la_vente and e.retire_le is null and e.ligne_bancaire_id is null')
    expect(corps).toContain("and case when e.annule_id is null then e.moyen = 'especes'")
    expect(corps).toContain("else o.ligne_bancaire_id is null and o.moyen = 'especes' end")
    expect(corps).toContain('select s.le_jour, s.le_solde from soldes s where s.le_solde < 0 order by s.le_jour limit 1')
  })
})

// ── L'essai, rejoué ──────────────────────────────────────────────────────────────────────────────────────────────────

describe('l’essai de la caisse, rejoué par le module : les mêmes cas, les mêmes verdicts', () => {
  const issues = rejouerLEssai(ESSAI, AUJOURDHUI)
  const jugees = issues.filter((i) => i.genre === 'jugee')

  it('lit toutes les étapes de l’essai', () => {
    const etapes = etapesDeLEssai(ESSAI)
    expect(etapes.length).toBe(issues.length)
    // Le compte des étapes de l'essai, genre par genre (son en-tête les dit), au plancher près.
    expect(etapes.filter((e) => e.genre.startsWith('controle')).length).toBeGreaterThanOrEqual(250)
    expect(etapes.every((e) => e.titre && e.profil && e.sql.trim() !== '')).toBe(true)
  })

  it('chaque étape rejouée rend le verdict de la base', () => {
    const fausses = jugees.filter((i) => !i.juste).map((i) => `${i.etape.titre} — base : ${i.etape.code} ${i.etape.attendu} ; module : ${i.recu ? `${i.recu.code} ${i.recu.message}` : 'accepté'}`)
    expect(fausses).toEqual([])
  })

  it('en rejoue assez pour dire quelque chose — le plancher qui sépare « tout juste » d’« aveugle »', () => {
    expect(jugees.length).toBeGreaterThanOrEqual(150)
    // Chaque refus que le module porte, au moins une fois, sous le code et les mots que la base a rendus.
    const vus = new Set(jugees.filter((i) => i.recu).map((i) => sansApostrophes(i.recu!.message)))
    const attendus = [
      'tresorerie', 'genre', 'date_absente', 'date_avant_2000', 'date_avant_ouverture', 'montant_absent', 'montant_centime',
      'montant_nul', 'montant_negatif', 'montant_borne', 'categorie_absente', 'categorie_inconnue', 'categorie_de_trop',
      'taux_absent', 'taux_inconnu', 'taux_de_trop', 'ensemble_absent', 'ensemble_hors_recette', 'ecriture_incomplete',
      'mois_pas_un_tableau', 'mois_vide', 'operation_inconnue', 'operation_retiree', 'acces',
    ] as const
    for (const cle of attendus) {
      const gabarit = sansApostrophes(MOTS_DE_LA_CAISSE[cle].gabarit)
      expect([...vus].some((m) => commeLike(gabarit.replace(/%/g, '%'), m) || m.endsWith(gabarit)), cle).toBe(true)
    }
    // Et les refus de la caisse négative, par plusieurs gestes.
    for (const geste of ['prelevement', 'especes_rendues', 'versement', 'retrait_recette', 'retrait_apport', 'lot', 'ouverture_au_credit',
      'retrait_d_especes_retire', 'mouvement_change', 'ouverture_change', 'retrait_ouverture'] as const) {
      const debut = sansApostrophes(GESTES_DE_LA_CAISSE[geste]).split('%s')[0]
      expect([...vus].some((m) => m.startsWith(debut)), geste).toBe(true)
    }
  })

  it('compte ce qu’il ne rejoue pas, chaque fois avec sa raison', () => {
    const autres = issues.filter((i) => i.genre !== 'jugee')
    for (const i of autres) expect(i.raison, i.etape.titre).toMatch(/\S/)
    // Ce qui n'est pas du module : les lectures (valeur), les captures, les droits d'un rôle de l'API, les gardes et les
    // contraintes jouées en direct ; ce qui est hors jeu : un dossier dont une étape écrit ce que ce banc ne rejoue pas (le
    // registre des encaissements, la réinsertion de la restauration).
    expect(autres.length).toBeLessThan(issues.length - 150)
  })
})

// ── Le module, cas par cas ───────────────────────────────────────────────────────────────────────────────────────────

const MODELE = { mode: 'tresorerie' as const, compteNotesDeFrais: '455000', plan: PLAN_PAR_DEFAUT }

function caisse(o: Partial<EtatDeLaCaisse> = {}): EtatDeLaCaisse {
  return { compteCaisse: MODELE.plan.caisse, ouvertures: [], operations: [], mouvements: [], encaissements: [], factures: [], ...o }
}

function operation(o: Partial<OperationDeLaCaisse>): OperationDeLaCaisse {
  return {
    id: 'o', genre: 'apport', date: '2026-03-01', montant: 100, retire_le: null, origine: 'cabinet', cree_par: 'chef',
    remplace_id: null, categorie_id: null, taux_tva: null, encaissements_du_jour: null, piece_id: null, ...o,
  }
}

function dossier(o: Partial<DossierDeLaCaisse> = {}): DossierDeLaCaisse {
  return {
    quiEcrit: 'cabinet', utilisateur: 'chef', modele: MODELE, assujetti: false, aujourdhui: AUJOURDHUI, ouverture: null,
    anneesValidees: [], categories: [{ id: 'k-hon', dossier_id: 'd', libelle: 'Honoraires', compte_comptable: '706000' }],
    caisse: caisse(), ...o,
  }
}

function saisie(o: Partial<SaisieDeCaisse>): SaisieDeCaisse {
  return { genre: 'apport', date: '2026-03-01', montant: 10, categorie_id: null, taux_tva: null, encaissements_du_jour: null, ecritures: [], ...o }
}

const APPORT_100 = [{ compte: '530000', sens: 'debit', montant: 100 }, { compte: '108000', sens: 'credit', montant: 100 }]

describe('la caisse lue, jour par jour', () => {
  // Une facture source réglée en espèces le 10/03 (30 €), remise en banque par son mouvement le 11/03 (15 €), contre-passée
  // sans mouvement le 15/03 ; celle d'une facture qui n'est pas source n'entre pas.
  const etat = caisse({
    ouvertures: [{ date: '2026-01-01', compte: '530000', sens: 'debit', montant: 50 }, { date: '2026-01-01', compte: '512000', sens: 'debit', montant: 900 }],
    operations: [
      operation({ id: 'a', date: '2026-03-01', montant: 100 }),
      operation({ id: 'p', genre: 'prelevement', date: '2026-03-02', montant: 40 }),
      operation({ id: 'r', genre: 'recette', date: '2026-03-03', montant: 25.5 }),
      operation({ id: 'x', genre: 'recette', date: '2026-03-03', montant: 1000, retire_le: '2026-03-04T08:00:00Z' }),
    ],
    mouvements: [
      { id: 'v', date: '2026-03-05', montant: 120, compte_bilan: '530000' },
      { id: 'w', date: '2026-03-06', montant: -30, compte_bilan: '530000' },
      { id: 'e', date: '2026-03-06', montant: -500, compte_bilan: '580000' },
    ],
    factures: [{ id: 'f', numero: 'F2026-0001', source_de_la_vente: true }, { id: 'g', numero: 'F2026-0002', source_de_la_vente: false }],
    encaissements: [
      { id: 'e1', facture_id: 'f', date_encaissement: '2026-03-10', montant: 30, moyen: 'especes', ligne_bancaire_id: null, annule_id: null, retire_le: null },
      { id: 'e2', facture_id: 'f', date_encaissement: '2026-03-11', montant: 15, moyen: 'especes', ligne_bancaire_id: 'v', annule_id: null, retire_le: null },
      { id: 'e3', facture_id: 'f', date_encaissement: '2026-03-15', montant: -30, moyen: 'especes', ligne_bancaire_id: null, annule_id: 'e1', retire_le: null },
      { id: 'e4', facture_id: 'g', date_encaissement: '2026-03-10', montant: 99, moyen: 'especes', ligne_bancaire_id: null, annule_id: null, retire_le: null },
      { id: 'e5', facture_id: 'f', date_encaissement: '2026-03-10', montant: 7, moyen: 'virement', ligne_bancaire_id: null, annule_id: null, retire_le: null },
      { id: 'e6', facture_id: 'f', date_encaissement: '2026-03-10', montant: 4, moyen: 'especes', ligne_bancaire_id: null, annule_id: null, retire_le: '2026-03-12T08:00:00Z' },
    ],
  })

  it('les flux : l’ouverture de la caisse seule, les opérations non retirées, les mouvements sur la caisse, les espèces sources', () => {
    expect(fluxDeLaCaisse(etat).map((f) => `${f.jour} ${f.source} ${f.centimes}`)).toEqual([
      '2026-01-01 ouverture 5000', '2026-03-01 operation 10000', '2026-03-02 operation -4000', '2026-03-03 operation 2550',
      '2026-03-05 mouvement -12000', '2026-03-06 mouvement 3000', '2026-03-10 encaissement 3000', '2026-03-15 encaissement -3000',
    ])
  })

  it('le solde à la fin de chaque jour, et le premier négatif', () => {
    expect(soldesDeLaCaisse(etat).map((s) => `${s.jour} ${s.centimes}`)).toEqual([
      '2026-01-01 5000', '2026-03-01 15000', '2026-03-02 11000', '2026-03-03 13550', '2026-03-05 1550', '2026-03-06 4550',
      '2026-03-10 7550', '2026-03-15 4550',
    ])
    expect(premierJourNegatif(etat)).toBeNull()
    const vide = { ...etat, mouvements: [...etat.mouvements, { id: 'z', date: '2026-03-05', montant: 20, compte_bilan: '530000' }] }
    expect(premierJourNegatif(vide)).toEqual({ jour: '2026-03-05', centimes: -450 })
    expect(refusDeLaCaisse(vide, 'versement', -2000)?.message)
      .toBe('Ce versement de 20,00 € rendrait la caisse négative le 05/03/2026 (−4,50 €) : saisis d\'abord les recettes en espèces qui le précèdent.')
    // Un solde nul n'est pas négatif.
    expect(premierJourNegatif(caisse({ operations: [operation({}), operation({ id: 'p', genre: 'prelevement', montant: 100 })] }))).toBeNull()
  })

  it('le compte de la caisse est celui du plan, jamais un numéro en dur', () => {
    const decale = { ...etat, compteCaisse: PLAN_DECALE.caisse }
    expect(fluxDeLaCaisse(decale).filter((f) => f.source === 'ouverture' || f.source === 'mouvement')).toEqual([])
  })

  it('l’ensemble du jour : les espèces sans mouvement des factures sources, non retirées, triées', () => {
    expect(ensembleDuJour(etat, '2026-03-10')).toEqual(['e1'])
    expect(ensembleDuJour(etat, '2026-03-11')).toEqual([])
    expect(ensembleDuJour(etat, '2026-03-15')).toEqual(['e3'])
  })
})

describe('l’ensemble du jour, sur le jeu de l’essai (section 60, dossier B) : les mots de la base', () => {
  // Le jeu de B tel que l'essai le pose (60, 60b, 60c, 64c) : sa facture source F2026-0001, deux espèces et un virement le
  // 10/03, des espèces du 11/03 remises par le crédit du 12/03, des espèces le 14/03 contre-passées le 15/03, des espèces
  // le 21/03 retirées. Les identifiants sont ceux du registre ; les verdicts, ceux que la base a rendus (lus dans l'essai).
  const enc = (id: string, date: string, montant: number, moyen: string, ligne: string | null = null, annule: string | null = null, retire: string | null = null) =>
    ({ id, facture_id: 'fb', date_encaissement: date, montant, moyen, ligne_bancaire_id: ligne, annule_id: annule, retire_le: retire }) as EtatDeLaCaisse['encaissements'][number]
  const b = dossier({
    categories: [{ id: 'kb', dossier_id: 'b', libelle: 'Honoraires', compte_comptable: '706000' }],
    caisse: caisse({
      factures: [{ id: 'fb', numero: 'F2026-0001', source_de_la_vente: true }],
      encaissements: [
        enc('b10a', '2026-03-10', 30, 'especes'), enc('b10b', '2026-03-10', 20, 'especes'), enc('b10v', '2026-03-10', 10, 'virement'),
        enc('b11', '2026-03-11', 15, 'especes', 'mb1'), enc('b14', '2026-03-14', 25, 'especes'),
        enc('b15', '2026-03-15', -25, 'especes', null, 'b14'), enc('b21', '2026-03-21', 5, 'especes', null, null, '2026-03-21T09:00:00Z'),
      ],
    }),
  })
  const etapes = etapesDeLEssai(ESSAI)
  const attendu = (numero: string) => {
    const e = etapes.find((x) => x.titre.startsWith(`${numero} `))!
    return { code: e.code, attendu: sansApostrophes(e.attendu) }
  }
  const recette = (date: string, ensemble: (string | null)[] | null) => saisie({
    genre: 'recette', date, montant: 40, categorie_id: 'kb', encaissements_du_jour: ensemble,
    ecritures: [{ compte: '530000', sens: 'debit', montant: 40 }, { compte: '706000', sens: 'credit', montant: 40 }],
  })
  const juge = (numero: string, s: SaisieDeCaisse) => {
    const r = refusDeLaSaisie(s, b)
    const a = attendu(numero)
    if (a.code === 'OK') expect(r, numero).toBeNull()
    else {
      expect(r?.code, numero).toBe(a.code)
      expect(commeLike(a.attendu, sansApostrophes(r!.message)), `${numero} : ${r?.message}`).toBe(true)
    }
  }

  it('61 à 62e : le 10/03, ses deux espèces, ni une de moins, ni une de plus, ni deux fois, ni un nul', () => {
    juge('61.', recette('2026-03-10', ['b10b', 'b10a']))
    juge('62.', recette('2026-03-10', ['b10a']))
    juge('62b.', recette('2026-03-10', ['b10a', 'b10b', 'b10v']))
    juge('62c.', recette('2026-03-10', ['b10a', 'b10b', 'ca155e00-0000-4000-8000-0000000000ee']))
    juge('62d.', recette('2026-03-10', ['b10a', 'b10b', 'b10a']))
    juge('62e.', recette('2026-03-10', [null]))
  })

  it('63 à 64e : les espèces remises en banque, la contre-passation, les espèces retirées', () => {
    juge('63.', recette('2026-03-11', []))
    juge('63b.', recette('2026-03-11', ['b11']))
    juge('64.', recette('2026-03-15', ['b15']))
    juge('64b.', recette('2026-03-15', []))
    juge('64d.', recette('2026-03-21', []))
    juge('64e.', recette('2026-03-21', ['b21']))
  })
})

describe('jugerLaSaisie — ce que la saisie devient', () => {
  it('l’écriture composée au plan est celle que la base accepte, et rien d’autre', () => {
    const recette = { genre: 'recette' as const, date: '2026-03-04', montant: 100, taux_tva: 5.5, categorie: { libelle: 'Honoraires', compte_comptable: '706000' } }
    expect(ecritureDeLOperation(recette, MODELE)).toEqual([
      { compte: '530000', sens: 'debit', montant: 100, libelle: 'Recettes en espèces du 04/03/2026 — Honoraires' },
      { compte: '706000', sens: 'credit', montant: 94.79, libelle: 'Recettes en espèces du 04/03/2026 — Honoraires' },
      { compte: '445710', sens: 'credit', montant: 5.21, libelle: 'Recettes en espèces du 04/03/2026 — Honoraires' },
    ])
    // Sous le plan décalé : chaque compte de rôle vient du plan.
    const decale = { ...MODELE, plan: PLAN_DECALE }
    expect(ecritureDeLOperation({ genre: 'prelevement', date: '2026-03-04', montant: 20, taux_tva: null, categorie: null }, decale)
      .map((l) => `${l.compte} ${l.sens} ${l.montant}`)).toEqual([`${PLAN_DECALE.caisse} credit 20`, `${PLAN_DECALE.exploitant} debit 20`])
    // Des espèces rendues : les sens inversés ; exonérée (0), deux lignes.
    expect(ecritureDeLOperation({ ...recette, montant: -12, taux_tva: 20 }, MODELE).map((l) => `${l.compte} ${l.sens} ${l.montant}`))
      .toEqual(['530000 credit 12', '706000 debit 10', '445710 debit 2'])
    expect(ecritureDeLOperation({ ...recette, taux_tva: 0 }, MODELE)).toHaveLength(2)
  })

  it('une saisie acceptée rend son opération et la caisse qui la porte ; une écriture au libellé de la base passe', () => {
    const lignes = ecritureDeLOperation({ genre: 'apport', date: '2026-03-01', montant: 100, taux_tva: null, categorie: null }, MODELE)
    const jugee = jugerLaSaisie(saisie({ montant: 100, ecritures: lignes }), dossier(), false, 'n1')
    expect(jugee.refus).toBeNull()
    if (jugee.refus) return
    expect(jugee.operation).toMatchObject({ id: 'n1', genre: 'apport', montant: 100, origine: 'cabinet', encaissements_du_jour: null })
    expect(jugee.caisse.operations.map((o) => o.id)).toEqual(['n1'])
  })

  it('le jour à Paris décide de « l’avenir », et le dit', () => {
    expect(refusDeLaSaisie(saisie({ date: '2026-10-30' }), dossier())?.message)
      .toBe('Une opération de caisse ne se date pas dans l\'avenir : nous sommes le 29/10/2026.')
    expect(refusDeLaSaisie(saisie({ date: '2026-10-29', ecritures: [{ compte: '530000', sens: 'debit', montant: 10 }, { compte: '108000', sens: 'credit', montant: 10 }] }), dossier())).toBeNull()
  })

  it('la frontière, sous les mots d’`exercice_fige` : validé, ou figé par un exercice plus récent', () => {
    expect(refusDeLaSaisie(saisie({ date: '2025-12-31' }), dossier({ anneesValidees: [2025] })))
      .toEqual({ code: '23514', message: 'L\'exercice 2025 est validé : sa caisse ne change plus.' })
    expect(refusDeLaSaisie(saisie({ date: '2024-06-01' }), dossier({ anneesValidees: [2025] }))?.message)
      .toBe('L\'exercice 2024 est figé par la validation de l\'exercice 2025 : sa caisse ne change plus.')
  })

  it('un montant que JSON porterait hors du centime n’est pas au centime', () => {
    expect(refusDeLaSaisie(saisie({ montant: 0.1 + 0.2 }), dossier())?.message).toBe('Le montant d\'une opération de caisse est au centime.')
    expect(refusDeLaSaisie(saisie({ montant: 0.3, ecritures: [{ compte: '530000', sens: 'debit', montant: 0.1 + 0.2 }, { compte: '108000', sens: 'credit', montant: 0.3 }] }), dossier())?.message)
      .toContain('L\'écriture proposée ne correspond pas')
  })
})

describe('la saisie d’un mois, telle qu’elle part', () => {
  it('un identifiant se lit comme Postgres le lit : sans tirets, en majuscules, entre accolades', () => {
    const d = dossier({ categories: [{ id: '0f0e0d0c-0b0a-4908-8706-050403020100', dossier_id: 'd', libelle: 'Honoraires', compte_comptable: '706000' }] })
    const op = (categorie_id: string) => ({
      genre: 'recette', date: '2026-03-02', montant: 40, categorie_id, encaissements_du_jour: [],
      ecritures: [{ compte: '530000', sens: 'debit', montant: 40 }, { compte: '706000', sens: 'credit', montant: 40 }],
    })
    for (const forme of ['0f0e0d0c-0b0a-4908-8706-050403020100', '0F0E0D0C0B0A49088706050403020100', '{0f0e0d0c-0b0a-4908-8706-050403020100}', '0f0e-0d0c-0b0a-4908-8706-0504-0302-0100']) {
      expect(refusDeLaSaisieDUnMois([op(forme)], d), forme).toBeNull()
    }
    for (const forme of ['{0f0e0d0c-0b0a-4908-8706-050403020100', '0f0e0d0c-0b0a-4908-8706-05040302010', 'zz0e0d0c-0b0a-4908-8706-050403020100']) {
      expect(refusDeLaSaisieDUnMois([op(forme)], d)?.message, forme)
        .toBe('Opération n° 1, du 02/03/2026 : Une opération de la saisie porte un identifiant illisible (sa catégorie ou un encaissement du jour).')
    }
  })

  it('un champ inconnu nommé par l’ordre des octets, coupé à quatre-vingts lettres ; une date absente ne nomme pas de jour', () => {
    const d = dossier()
    expect(refusDeLaSaisieDUnMois([{ genre: 'apport', zeta: 1, Alpha: 2, ecritures: [] }], d)?.message)
      .toBe('Opération n° 1 : « Alpha » n\'est pas un champ d\'une opération de caisse.')
    const long = 'é'.repeat(90)
    expect(refusDeLaSaisieDUnMois([{ [long]: 1 }], d)?.message)
      .toBe(`Opération n° 1 : « ${'é'.repeat(79)}… » n'est pas un champ d'une opération de caisse.`)
    expect(refusDeLaSaisieDUnMois([{ genre: 'apport', montant: 10, ecritures: [] }], d))
      .toEqual({ code: '22023', message: 'Opération n° 1 : La date de l\'opération de caisse est à renseigner.' })
    expect(refusDeLaSaisieDUnMois([{ genre: 'apport', date: '2025-02-29', montant: 10 }], d)?.message)
      .toBe('Opération n° 1 : La date de l\'opération est illisible : elle s\'écrit AAAA-MM-JJ.')
    expect(refusDeLaSaisieDUnMois([{ genre: 'apport', date: '2024-02-29', montant: 10 }], d)?.message)
      .toBe('Opération n° 1, du 29/02/2024 : L\'écriture proposée est incomplète.')
  })

  it('tout ou rien : la caisse se juge à la fin, et un jour qui retire avant qu’un autre ajoute passe', () => {
    const d = dossier()
    const prelevement = { genre: 'prelevement', date: '2026-03-10', montant: 50, ecritures: [{ compte: '108000', sens: 'debit', montant: 50 }, { compte: '530000', sens: 'credit', montant: 50 }] }
    const apport = { genre: 'apport', date: '2026-03-09', montant: 100, ecritures: APPORT_100 }
    expect(refusDeLaSaisieDUnMois([prelevement, apport], d)).toBeNull()
    const jugee = jugerLaSaisieDUnMois([prelevement, apport], d)
    expect(jugee.refus == null && jugee.caisse.operations.map((o) => o.genre)).toEqual(['prelevement', 'apport'])
    expect(refusDeLaSaisieDUnMois([{ ...prelevement, montant: 150, ecritures: [{ compte: '108000', sens: 'debit', montant: 150 }, { compte: '530000', sens: 'credit', montant: 150 }] }, apport], d))
      .toEqual({ code: '23514', message: 'La caisse serait négative le 10/03/2026 (−50,00 €) : saisis d\'abord les recettes en espèces qui précèdent ce jour.' })
  })
})

describe('le retrait, le remplacement et l’origine', () => {
  const ops = [
    operation({ id: 'ap', date: '2026-03-01', montant: 100 }),
    operation({ id: 're', genre: 'recette', date: '2026-03-02', montant: 40, categorie_id: 'k-hon', encaissements_du_jour: [] }),
    operation({ id: 'pr', genre: 'prelevement', date: '2026-03-03', montant: 120 }),
  ]
  const d = dossier({ caisse: caisse({ operations: ops }) })

  it('le client : ses propres opérations seulement, celles du cabinet et d’un autre accès refusées sous leurs mots', () => {
    const client = dossier({
      quiEcrit: 'client', utilisateur: 'u1',
      caisse: caisse({ operations: [...ops, operation({ id: 'c1', origine: 'client', cree_par: 'u1' }), operation({ id: 'c2', origine: 'client', cree_par: 'u2' })] }),
    })
    expect(refusDuRetrait('ap', client)?.message).toBe('Cette opération a été saisie par ton cabinet : demande-lui de la corriger.')
    expect(refusDuRetrait('c2', client)?.message).toBe('Cette opération a été saisie depuis un autre accès à ce dossier : demande à ton cabinet de la corriger.')
    expect(refusDuRetrait('c1', client)).toBeNull()
    expect(refusDuRetrait('c1', dossier({ quiEcrit: null }))).toEqual({ code: '42501', message: 'Accès refusé à ce dossier.' })
  })

  it('un retrait qui viderait la caisse se dit sous les mots de son geste ; un prélèvement se retire sans être jugé', () => {
    expect(refusDuRetrait('ap', d)?.message)
      .toBe('Retirer cet apport de 100,00 € rendrait la caisse négative le 03/03/2026 (−80,00 €) : retire d\'abord les sorties d\'espèces qui le suivent.')
    expect(refusDuRetrait('pr', d)).toBeNull()
    const retire = jugerLeRetrait('pr', d, '2026-03-04T08:00:00Z')
    expect(retire.refus == null && retire.caisse.operations.find((o) => o.id === 'pr')?.retire_le).toBe('2026-03-04T08:00:00Z')
    expect(refusDuRetrait('pr', retire.refus ? d : { ...d, caisse: retire.caisse })?.message)
      .toBe('Cette opération a été retirée ou remplacée depuis ta lecture : relis ta caisse.')
  })

  it('le remplacement : un instant sous zéro passe ; pour de bon, les mots du retrait de l’ancienne', () => {
    const plus = saisie({ genre: 'recette', date: '2026-03-02', montant: 60, categorie_id: 'k-hon', encaissements_du_jour: [], ecritures: [{ compte: '530000', sens: 'debit', montant: 60 }, { compte: '706000', sens: 'credit', montant: 60 }] })
    const jugee = jugerLeRemplacement('re', plus, d, '2026-03-04T08:00:00Z', 'nv')
    expect(jugee.refus).toBeNull()
    if (jugee.refus) return
    expect(jugee.operation.remplace_id).toBe('re')
    expect(versionsDeLOperation('nv', jugee.caisse.operations).map((o) => o.id)).toEqual(['re', 'nv'])
    expect(versionsDeLOperation('re', jugee.caisse.operations).map((o) => o.id)).toEqual(['re', 'nv'])
    expect(remplacanteDe('re', jugee.caisse.operations)?.id).toBe('nv')
    expect(remplacanteDe('nv', jugee.caisse.operations)).toBeNull()
    const moins = { ...plus, montant: 10, ecritures: [{ compte: '530000', sens: 'debit', montant: 10 }, { compte: '706000', sens: 'credit', montant: 10 }] }
    expect(refusDuRemplacement('re', moins, d)?.message)
      .toBe('Retirer cette recette de 40,00 € rendrait la caisse négative le 03/03/2026 (−10,00 €) : retire d\'abord les sorties d\'espèces qui la suivent.')
    // Une sortie neuve parle la première, sous ses mots à elle.
    const sortie = saisie({ genre: 'prelevement', date: '2026-03-02', montant: 200, ecritures: [{ compte: '108000', sens: 'debit', montant: 200 }, { compte: '530000', sens: 'credit', montant: 200 }] })
    expect(refusDuRemplacement('re', sortie, d)?.message).toMatch(/^Ce prélèvement de 200,00 € rendrait la caisse négative le 02\/03\/2026/)
  })

  it('l’origine se dit au cabinet pour le client seulement', () => {
    expect(origineDite({ origine: 'cabinet', remplace_id: null })).toBeNull()
    expect(origineDite({ origine: 'client', remplace_id: null })).toBe('saisie par le client')
    expect(origineDite({ origine: 'client', remplace_id: 'x' })).toBe('remplacée par le client')
    expect(versionsDeLOperation('inconnue', ops)).toEqual([])
  })
})

describe('les mots d’une caisse négative', () => {
  it('le montant sans signe, le solde au moins typographique, deux gestes sans montant', () => {
    expect(texteCaisseNegative('versement', -50000, '2026-03-05', -31450))
      .toBe('Ce versement de 500,00 € rendrait la caisse négative le 05/03/2026 (−314,50 €) : saisis d\'abord les recettes en espèces qui le précèdent.')
    expect(texteCaisseNegative('mouvement_change', 50000, '2026-03-05', -1)).toBe('Ce changement d\'un mouvement classé sur la caisse la rendrait négative le 05/03/2026 (−0,01 €).')
    expect(texteCaisseNegative('inconnu', 1, '2026-03-05', 0)).toBe('Cette écriture rendrait la caisse négative le 05/03/2026 (0,00 €).')
    expect(former('% et %', 'a')).toBe('a et %')
  })

  it('l’essai les a lus en base, pour un même montant, un même jour et un même solde (étape 98)', () => {
    const e = etapesDeLEssai(ESSAI).find((x) => x.titre.startsWith('98. '))!
    const gestes = /unnest\(array\[([^\]]*)\]/.exec(e.sql)![1].split(',').map((g) => g.trim().replace(/'/g, ''))
    expect(gestes.map((g) => texteCaisseNegative(g, 50000, '2026-03-05', -31450)).join(' | ')).toBe(e.attendu)
  })
})

// LES BORDS QUE L'ESSAI NE TOUCHE PAS : chacun est né d'une mutation du module qui survivait (étape C2), et sa valeur
// attendue se lit dans le texte de la migration (`p_date < date '2000-01-01'`, `p_date < v_ouverture`, le taux 8,5 de
// `recettes_assujetties_du_releve`, `jsonb_array_length(p_operations) > 1000`, `case when p_genre = 'recette' then
// v_recus end`, `v_origine`, le libellé `'Espèces rendues le '`).
describe('les bords de la saisie, que l’essai ne touche pas', () => {
  const HONORAIRES = { libelle: 'Honoraires', compte_comptable: '706000' }
  const recette = (montant: number, taux: number | null, date = '2026-03-01') => saisie({
    genre: 'recette', date, montant, categorie_id: 'k-hon', taux_tva: taux, encaissements_du_jour: [],
    ecritures: ecritureDeLOperation({ genre: 'recette', date, montant, taux_tva: taux, categorie: HONORAIRES }, MODELE),
  })
  const apport = (date: string) => saisie({
    date, montant: 10, ecritures: ecritureDeLOperation({ genre: 'apport', date, montant: 10, taux_tva: null, categorie: null }, MODELE),
  })

  it('le 1er janvier 2000 se saisit, le 31 décembre 1999 non ; le jour de l’ouverture se saisit, la veille non', () => {
    expect(refusDeLaSaisie(apport('2000-01-01'), dossier())).toBeNull()
    expect(refusDeLaSaisie(apport('1999-12-31'), dossier())?.message).toBe(MOTS_DE_LA_CAISSE.date_avant_2000.gabarit)
    expect(refusDeLaSaisie(apport('2026-01-01'), dossier({ ouverture: '2026-01-01' }))).toBeNull()
    expect(refusDeLaSaisie(apport('2025-12-31'), dossier({ ouverture: '2026-01-01' }))?.message)
      .toBe(former(MOTS_DE_LA_CAISSE.date_avant_ouverture.gabarit, '01/01/2026'))
  })

  it('un dossier assujetti : chacun des cinq taux de la caisse, 8,5 compris, et aucun autre', () => {
    for (const taux of [0, 5.5, 8.5, 10, 20]) expect(refusDeLaSaisie(recette(100, taux), dossier({ assujetti: true })), String(taux)).toBeNull()
    expect(refusDeLaSaisie(recette(100, 7), dossier({ assujetti: true }))?.message).toBe(MOTS_DE_LA_CAISSE.taux_inconnu.gabarit)
  })

  it('des espèces rendues : leur libellé, celui de la base ; la caisse jugée hors d’un mois, pas dans un mois', () => {
    expect(definition('enregistrer_operation_caisse')).toContain('\'Espèces rendues le \'')
    expect(ecritureDeLOperation({ genre: 'recette', date: '2026-03-04', montant: -12, taux_tva: null, categorie: HONORAIRES }, MODELE)
      .map((l) => l.libelle)).toEqual(['Espèces rendues le 04/03/2026 — Honoraires', 'Espèces rendues le 04/03/2026 — Honoraires'])
    expect(refusDeLaSaisie(recette(-10, null), dossier())).toEqual({
      code: '23514', message: texteCaisseNegative('especes_rendues', -1000, '2026-03-01', -1000),
    })
    expect(jugerLaSaisie(recette(-10, null), dossier(), true, 'x').refus).toBeNull()
  })

  it('l’opération acceptée : l’origine de qui écrit, et l’ensemble du jour d’une recette seulement', () => {
    const duClient = jugerLaSaisie(apport('2026-03-01'), dossier({ quiEcrit: 'client', utilisateur: 'acces-1' }), false, 'n')
    expect(duClient.refus).toBeNull()
    if (duClient.refus) return
    expect(duClient.operation).toMatchObject({ origine: 'client', cree_par: 'acces-1', encaissements_du_jour: null })
    const vide = jugerLaSaisie({ ...apport('2026-03-01'), encaissements_du_jour: [] }, dossier(), false, 'n')
    expect(vide.refus ? vide.refus : vide.operation.encaissements_du_jour).toBeNull()
    const uneRecette = jugerLaSaisie(recette(10, null), dossier(), false, 'r')
    expect(uneRecette.refus ? uneRecette.refus : uneRecette.operation.encaissements_du_jour).toEqual([])
  })

  it('un mois de mille opérations au plus ; le 29 février d’une année bissextile, et de 2000, existe', () => {
    expect(refusDeLaSaisieDUnMois(Array(1001).fill(1), dossier())?.message)
      .toBe(former(MOTS_DE_LA_CAISSE.mois_trop_long.gabarit, '1001'))
    expect(refusDeLaSaisieDUnMois(Array(1000).fill(1), dossier())?.message)
      .toBe(`Opération n° 1 : ${MOTS_DE_LA_CAISSE.mois_pas_un_objet.gabarit}`)
    const illisible = (date: string) => refusDeLaSaisieDUnMois([{ genre: 'apport', date, montant: 10 }], dossier())?.message ?? ''
    expect(illisible('2000-02-29')).not.toContain(MOTS_DE_LA_CAISSE.mois_date_illisible.gabarit)
    expect(illisible('2024-02-29')).not.toContain(MOTS_DE_LA_CAISSE.mois_date_illisible.gabarit)
    expect(illisible('1900-02-29')).toBe(`Opération n° 1 : ${MOTS_DE_LA_CAISSE.mois_date_illisible.gabarit}`)
    expect(illisible('2025-02-29')).toBe(`Opération n° 1 : ${MOTS_DE_LA_CAISSE.mois_date_illisible.gabarit}`)
  })
})

describe('le drapeau', () => {
  it('reste baissé tant que les deux migrations ne sont pas dans l’export', () => {
    const exportees = fichiersDuSchema().some((f) => /\d{14}_caisse_retrait_et_versement\.sql$/.test(f.chemin))
      && fichiersDuSchema().some((f) => /\d{14}_caisse\.sql$/.test(f.chemin))
    expect(CAISSE_EXPORTEE).toBe(exportees)
  })
})
