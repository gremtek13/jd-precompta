import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  QUOI_DES_VENTES_DE_LA_SIMULATION, SANS_PROJECTION, SIMULATION_VENTES_FACTUREES_EXPORTEE, lectureDeLaSimulation,
  lectureDesVentesDeLaSimulation, lireLesVentesDeLaSimulation, recettesDeLaSimulation, ventesDeLaSimulation,
  type LectureDeLaSimulation,
} from './simulationVentesFacturees'
import {
  RECETTES_FACTUREES_NON_COMPTEES, recettesFactureesDuDossier, simulationDitNePasCompterLesVentesFacturees, totauxPourAnnee,
  type RecettesFacturees,
} from './estimation'
import type { ReponseDeLaBase } from './couvertureReleve'
import { derniereDefinitionSql, fichiersDuSchema } from '../test/schema'
import {
  ANNEES_DE_LA_SIMULATION, DOSSIERS_DE_LA_SIMULATION, PREFIXE_SIMULATION, TEXTE_ESSAI_SIMULATION, jeuPourLaBase,
  lecturesPourLEssai, recettesDeLAnnee, simulationCommeLaBase, ventesDuDossier,
} from '../test/essaiSimulationVentesFacturees'

// « MA SIMULATION » REÇOIT SES VENTES FACTURÉES (chantier EC-Q3, étape VF8e). Ce que ce fichier garde :
//   1. la lecture : la valeur de la base, lue sous la forme « comptées » de `RecettesFacturees` — et toute autre forme
//      refusée, jamais devinée ; un refus, une requête qui lève : une lecture incomplète, avec son motif ;
//   2. la lecture gardée avec son dossier ET son année ;
//   3. ce que l'écran en fait, dans les deux états du drapeau ;
//   4. la fonction exportée (supabase/schema/…_simulation_des_ventes_facturees.sql) : ce que le module lit est ce qu'elle
//      rend, l'accès avant toute lecture, ses refus, ses droits, rien d'autre qu'elle pose ;
//   5. l'essai (supabase/essais/simulationDesVentesFacturees.sql) : il porte exactement le jeu et les lectures que le
//      MODULE calcule (src/test/essaiSimulationVentesFacturees.ts) — `recettesFactureesParMois`, le même calcul en
//      entiers —, et ce que la base y rend, relu par ce module, fait les mêmes totaux que l'Estimation du cabinet.
// Données FICTIVES.

const D = '00000000-0000-4000-8000-000000000001'
const F1 = 'aaaaaaaa-0000-4000-8000-000000000101'
const F2 = 'aaaaaaaa-0000-4000-8000-000000000102'

const comptees = (parMois: [string, number][], sources: string[]): RecettesFacturees =>
  ({ etat: 'comptees', parMois: new Map(parMois), sources: new Set(sources) })

describe('la valeur de la base, sous la forme « comptées »', () => {
  it('lit les deux clés : les mois de l’année demandée, en centimes, et les sources', () => {
    const r = recettesDeLaSimulation({ par_mois: { '2026-03': 2777, '2026-01': 12000, '2026-09': 0 }, sources: [F2, F1] }, 2026)
    expect(r).toEqual(comptees([['2026-01', 12000], ['2026-03', 2777], ['2026-09', 0]], [F2, F1]))
    // Les mois dans leur ordre, quel que soit celui de la valeur rendue.
    expect([...(r as Extract<RecettesFacturees, { etat: 'comptees' }>).parMois.keys()]).toEqual(['2026-01', '2026-03', '2026-09'])
  })

  it('un dossier qui n’a pas basculé : les deux clés, vides — comptées, rien à compter', () => {
    expect(recettesDeLaSimulation({ par_mois: {}, sources: [] }, 2026)).toEqual(comptees([], []))
  })

  it('un total négatif (un avoir de l’année d’après) se lit tel quel', () => {
    expect(recettesDeLaSimulation({ par_mois: { '2027-01': -10000 }, sources: [F1] }, 2027)).toEqual(comptees([['2027-01', -10000]], [F1]))
  })

  it('toute autre forme se refuse : jamais des recettes nulles, ni une liste de sources vide', () => {
    const illisibles: unknown[] = [
      null, undefined, 'x', 12, [], [{ par_mois: {}, sources: [] }],
      {}, { par_mois: {} }, { sources: [] }, { par_mois: {}, sources: [], dossier: D }, { par_mois: {}, sources: [], numero: 'F1' },
      { par_mois: {}, sources: [], total: 0 },
      { par_mois: [], sources: [] }, { par_mois: null, sources: [] }, { par_mois: {}, sources: {} }, { par_mois: {}, sources: null },
      // Un mois d'une autre année, ou mal écrit.
      { par_mois: { '2025-12': 100 }, sources: [] }, { par_mois: { '2026-13': 100 }, sources: [] },
      { par_mois: { '2026-1': 100 }, sources: [] }, { par_mois: { '2026-00': 100 }, sources: [] },
      { par_mois: { '2026-01-01': 100 }, sources: [] }, { par_mois: { ' 2026-01': 100 }, sources: [] },
      // Des centimes qui n'en sont pas.
      { par_mois: { '2026-01': 12.5 }, sources: [] }, { par_mois: { '2026-01': '100' }, sources: [] },
      { par_mois: { '2026-01': null }, sources: [] }, { par_mois: { '2026-01': 2 ** 53 }, sources: [] },
      { par_mois: { '2026-01': Number.NaN }, sources: [] }, { par_mois: { '2026-01': Number.POSITIVE_INFINITY }, sources: [] },
      // Des sources qui n'en sont pas.
      { par_mois: {}, sources: [12] }, { par_mois: {}, sources: [null] }, { par_mois: {}, sources: ['F2026-0001'] },
      { par_mois: {}, sources: [F1.toUpperCase()] }, { par_mois: {}, sources: [F1, F1] }, { par_mois: {}, sources: [`${F1} `] },
    ]
    for (const rendu of illisibles) expect(recettesDeLaSimulation(rendu, 2026), JSON.stringify(rendu) ?? String(rendu)).toBeNull()
  })
})

describe('la lecture', () => {
  it('rend les recettes lues, avec le dossier et l’année qui les ont demandées', () => {
    expect(lectureDesVentesDeLaSimulation(D, 2026, { data: { par_mois: { '2026-02': 10000 }, sources: [F1] }, error: null }))
      .toEqual({ dossierId: D, annee: 2026, etat: 'lue', recettes: comptees([['2026-02', 10000]], [F1]) })
  })

  it('un refus de la base : incomplète, et son motif', () => {
    expect(lectureDesVentesDeLaSimulation(D, 2026, { data: null, error: { message: 'Accès refusé à ce dossier.', code: '42501' } }))
      .toEqual({ dossierId: D, annee: 2026, etat: 'incomplete', motif: 'ventes facturées refusées : Accès refusé à ce dossier.' })
  })

  it('une valeur illisible, ou rien : incomplète', () => {
    for (const data of [null, { par_mois: {} }, [{ par_mois: {}, sources: [] }]]) {
      expect(lectureDesVentesDeLaSimulation(D, 2026, { data, error: null }))
        .toEqual({ dossierId: D, annee: 2026, etat: 'incomplete', motif: 'ventes facturées illisibles' })
    }
  })

  it('la requête est ATTENDUE, et une requête qui lève tombe du côté signalé — la lecture ne rejette jamais', async () => {
    // Un constructeur de requête n'est pas une promesse : un objet qui n'a qu'un `then`.
    const requete: PromiseLike<ReponseDeLaBase> = {
      then: (suite, echec) => Promise.resolve<ReponseDeLaBase>({ data: { par_mois: {}, sources: [F1] }, error: null }).then(suite, echec),
    }
    expect(await lireLesVentesDeLaSimulation(D, 2026, requete))
      .toEqual({ dossierId: D, annee: 2026, etat: 'lue', recettes: comptees([], [F1]) })
    const leve = { then: () => { throw new Error('réseau coupé') } }
    expect(await lireLesVentesDeLaSimulation(D, 2026, leve))
      .toEqual({ dossierId: D, annee: 2026, etat: 'incomplete', motif: 'ventes facturées refusées : réseau coupé' })
    await expect(lireLesVentesDeLaSimulation(D, 2026, Promise.reject(new Error('refusée')))).resolves
      .toEqual({ dossierId: D, annee: 2026, etat: 'incomplete', motif: 'ventes facturées refusées : refusée' })
  })
})

describe('la lecture ne vaut que pour son dossier et son année', () => {
  const lue: LectureDeLaSimulation = { dossierId: D, annee: 2026, etat: 'lue', recettes: comptees([], []) }

  it('celle qu’ils ont demandée', () => {
    expect(lectureDeLaSimulation(lue, D, 2026)).toBe(lue)
  })

  it('jamais celle d’un autre dossier, ni d’une autre année, ni rien', () => {
    expect(lectureDeLaSimulation(lue, F1, 2026)).toBeNull()
    expect(lectureDeLaSimulation(lue, D, 2027)).toBeNull()
    expect(lectureDeLaSimulation(lue, D, 2025)).toBeNull()
    expect(lectureDeLaSimulation(null, D, 2026)).toBeNull()
  })
})

describe('ce que l’écran en fait, dans les deux états du drapeau', () => {
  const lue: LectureDeLaSimulation = { dossierId: D, annee: 2026, etat: 'lue', recettes: comptees([['2026-01', 100]], [F1]) }
  const incomplete: LectureDeLaSimulation = { dossierId: D, annee: 2026, etat: 'incomplete', motif: 'ventes facturées illisibles' }

  it('baissé : ce qu’elle faisait avant VF8e, quelle que soit la lecture — non comptées, la phrase selon le réglage', () => {
    for (const lecture of [null, lue, incomplete]) {
      for (const reglage of [true, false, null, undefined]) {
        expect(ventesDeLaSimulation(false, lecture, reglage)).toEqual({
          recettes: RECETTES_FACTUREES_NON_COMPTEES, phrase: simulationDitNePasCompterLesVentesFacturees(reglage), motif: null,
        })
      }
    }
    expect(ventesDeLaSimulation(false, null, false)?.phrase).toBe(false)
    expect(ventesDeLaSimulation(false, null, true)?.phrase).toBe(true)
  })

  it('levé, la lecture revenue entière : comptées, et la phrase se tait — le réglage n’en décide plus', () => {
    for (const reglage of [true, false, null]) {
      expect(ventesDeLaSimulation(true, lue, reglage)).toEqual({ recettes: lue.recettes, phrase: false, motif: null })
    }
  })

  it('levé, la lecture incomplète : aucune projection, le motif pour le bandeau, et la phrase d’aujourd’hui', () => {
    expect(ventesDeLaSimulation(true, incomplete, false)).toEqual({ recettes: null, phrase: true, motif: 'ventes facturées illisibles' })
  })

  it('levé, la lecture pas revenue : l’écran attend', () => {
    expect(ventesDeLaSimulation(true, null, true)).toBeNull()
  })

  it('les mots du bandeau', () => {
    expect(QUOI_DES_VENTES_DE_LA_SIMULATION).toBe('Tes factures validées dans l’application')
    expect(SANS_PROJECTION).toBe('Recharge la page : ta projection ne s’affiche pas sans elles.')
  })
})

// ── La fonction exportée ──────────────────────────────────────────────────────────────────────────────────────────────
const SCHEMA = new URL('../../supabase/schema/', import.meta.url)
const FICHIERS_DE_LA_MIGRATION = readdirSync(SCHEMA).filter((nom) => /^\d{14}_simulation_des_ventes_facturees\.sql$/.test(nom))
const MIGRATION = FICHIERS_DE_LA_MIGRATION.length === 1 ? readFileSync(new URL(FICHIERS_DE_LA_MIGRATION[0], SCHEMA), 'utf8') : ''
const corpsDe = (definition: string) => definition.slice(definition.indexOf('as $$') + 'as $$'.length)
const md5 = (texte: string) => createHash('md5').update(texte, 'utf8').digest('hex')

describe('le drapeau', () => {
  it('reste faux dans ce lot : la migration est préparée, pas appliquée — la session le lève, elle appliquée', () => {
    // Ce test change avec lui. Levé avant l'application, chaque simulation d'un client « Banque » appellerait une fonction
    // que la base n'a pas, et ne projetterait plus rien.
    expect(SIMULATION_VENTES_FACTUREES_EXPORTEE).toBe(false)
    const texte = readFileSync(resolve(process.cwd(), 'src/lib/simulationVentesFacturees.ts'), 'utf8')
    const commentaire = texte.slice(texte.indexOf('// LA FONCTION N\'EST PAS ENCORE EN BASE'), texte.indexOf('export const SIMULATION_VENTES_FACTUREES_EXPORTEE'))
    expect(commentaire).toContain('PRÉPARÉE')
    expect(commentaire).toContain('La session le lèvera elle-même, la migration appliquée.')
  })

  it('la migration est dans l’export, une fois, et y définit la fonction que l’écran appellera le drapeau levé', () => {
    expect(FICHIERS_DE_LA_MIGRATION).toHaveLength(1)
    expect(fichiersDuSchema().filter((f) => /create (or replace )?function public\.ventes_facturees_de_la_simulation\(/.test(f.texte)))
      .toHaveLength(1)
    const ecran = readFileSync(resolve(process.cwd(), 'src/pages/ClientSimulation.tsx'), 'utf8')
    expect(ecran).toContain("supabase.rpc('ventes_facturees_de_la_simulation', { p_dossier_id: dossierLu, p_annee: annee })")
  })
})

describe('la fonction exportée rend ce que le module lit, à qui la case « Banque » ouvre le dossier', () => {
  const sql = derniereDefinitionSql('ventes_facturees_de_la_simulation')
  const corps = sql.slice(sql.indexOf('\nbegin\n'))

  it('sa signature : un dossier, une année, une seule valeur jsonb, security definer, stable, son chemin fixé', () => {
    expect(sql).toMatch(/^create function public\.ventes_facturees_de_la_simulation\(p_dossier_id uuid, p_annee integer\)\nreturns jsonb\nlanguage plpgsql\nstable\nsecurity definer\nset search_path = public\nas \$\$/)
  })

  it('l’accès d’abord — le cabinet du dossier ou un accès « Banque », sur un dossier qui existe —, puis l’année, avant toute lecture', () => {
    const acces = corps.indexOf("raise exception 'Accès refusé à ce dossier.' using errcode = '42501';")
    const annee = corps.indexOf("raise exception 'Exercice invalide.' using errcode = '22023';")
    expect(acces).toBeGreaterThan(0)
    expect(annee).toBeGreaterThan(acces)
    expect(corps.slice(0, acces)).toContain('if not public.gere_la_banque(p_dossier_id) or not exists (select 1 from public.dossiers d where d.id = p_dossier_id) then')
    expect(corps.slice(acces, annee)).toContain('if p_annee is null or p_annee < 2000 or p_annee > 2100 then')
    // Rien n'est lu avant les deux refus, hors du dossier que l'accès nomme.
    expect(corps.slice(0, annee)).not.toMatch(/factures_emises|encaissements_factures|calcul_vente_facturee/)
  })

  it('les deux clés que le module lit, et elles seules — d’un dossier non basculé aussi, vides', () => {
    expect([...corps.matchAll(/jsonb_build_object\(([^;]*)\)/g)].map((m) => m[1])).toEqual([
      "'par_mois', '{}'::jsonb, 'sources', '[]'::jsonb",
      "'par_mois', v_par_mois, 'sources', v_sources",
    ])
    expect(corps).toContain('if not v_bascule then')
  })

  it('le total par mois : la règle du cumul (`calcul_vente_facturee`), les parts en trésorerie, les documents en engagement, le hors-taxe des mois de l’année', () => {
    expect(corps).toContain('cross join lateral public.calcul_vente_facturee(f.id) c')
    expect(corps).toContain("where c.genre = case when v_mode = 'engagement' then 'document' else 'part' end")
    expect(corps).toContain('and c.date_effet between v_debut and v_fin')
    expect(corps).toContain("select to_char(c.date_effet, 'YYYY-MM') as mois, c.base_centimes")
    expect(corps).toContain('sum(e.base_centimes)::bigint as centimes from evenements e group by e.mois')
  })

  it('les sources : les factures et avoirs validés sources du dossier, de toute année, dans l’ordre de leurs identifiants', () => {
    expect(corps).toContain("select coalesce(jsonb_agg(f.id order by f.id), '[]'::jsonb) into v_sources")
    expect(corps).toContain("where f.dossier_id = p_dossier_id and f.statut = 'validee' and f.source_de_la_vente;")
  })

  it('ses droits : l’anonyme et PUBLIC ne l’exécutent pas, les connectés oui — et la migration ne pose rien d’autre', () => {
    expect(MIGRATION).toContain('revoke execute on function public.ventes_facturees_de_la_simulation(uuid, integer) from public, anon;')
    expect(MIGRATION).toContain('grant execute on function public.ventes_facturees_de_la_simulation(uuid, integer) to authenticated;')
    expect(MIGRATION.match(/\bgrant\b/gi)).toHaveLength(1)
    expect(MIGRATION).not.toMatch(/create (table|policy|trigger|index|view)|alter (table|policy)|\bdrop\b|\bdelete\b|\btruncate\b|\bupdate\b/i)
    expect(MIGRATION).not.toContain('\\')
    expect(MIGRATION).not.toContain('\r')
    expect([...MIGRATION.matchAll(/create (or replace )?function/g)]).toHaveLength(1)
  })

  it('sa garde de tête exige la règle du cumul et le prédicat de la banque tels que l’export les porte', () => {
    for (const [nom, signature] of [['calcul_vente_facturee', 'public.calcul_vente_facturee(uuid)'], ['gere_la_banque', 'public.gere_la_banque(uuid)']]) {
      const empreinte = md5(corpsDe(derniereDefinitionSql(nom)))
      expect(MIGRATION, nom).toContain(`('${signature}', '${empreinte}', `)
    }
    expect(MIGRATION).toContain("if to_regprocedure('public.ventes_facturees_de_la_simulation(uuid, integer)') is not null then")
  })
})

// ── L'essai : le même calcul que le module ────────────────────────────────────────────────────────────────────────────
describe('l’essai porte le jeu et les lectures que le module calcule', () => {
  it('la macro JEU est le jeu du module', () => {
    expect(TEXTE_ESSAI_SIMULATION).toContain(`'JEU', $m$${jeuPourLaBase()}$m$,`)
  })

  it('les lectures 1 à 10 sont, mot pour mot, ce que `recettesFactureesParMois` et `sources` rendent du jeu', () => {
    expect(TEXTE_ESSAI_SIMULATION).toContain(`\n${lecturesPourLEssai()}\n`)
  })

  it('le jeu rencontre ce qu’il annonce : les deux modèles, des écartées par motif, un mois à zéro, les bords d’une année', () => {
    const r = ventesDuDossier(1)
    expect(new Set(r.ecartees.map((e) => e.motif))).toEqual(new Set(['nature', 'option_debits', 'sans_lignes', 'encaissement_illisible',
      'contre_passation_illisible', 'ttc_nul']))
    expect(r.parts.some((p) => p.annuleId !== null)).toBe(true)
    expect(recettesDeLAnnee(1, 2026).get('2026-09')).toBe(0)
    expect(recettesDeLAnnee(2, 2026).get('2026-06')).toBe(0)
    // Une facture écartée ne compte pas en engagement non plus : le mois d'août de G n'a pas d'entrée.
    expect(recettesDeLAnnee(2, 2026).has('2026-08')).toBe(false)
    expect(recettesDeLAnnee(1, 2025).size).toBe(0)
    expect(recettesDeLAnnee(2, 2025).size).toBe(1)
    expect([...recettesDeLAnnee(2, 2027).values()]).toEqual([-10000])
    // Les bords d'une année : des parts du 1er janvier et du 31 décembre (R), des documents des mêmes jours (G).
    expect(r.parts.some((p) => p.date === '2026-01-01') && r.parts.some((p) => p.date === '2026-12-31')).toBe(true)
    const g = ventesDuDossier(2)
    expect(g.documents.some((d) => d.date === '2026-01-01') && g.documents.some((d) => d.date === '2026-12-31')).toBe(true)
    // Une facture qui n'est pas source n'est pas parmi les sources.
    expect(r.sources.has(`${PREFIXE_SIMULATION}00115`)).toBe(false)
    expect(r.sources.size).toBe(25)
  })

  it('les refus que l’essai exige sont ceux de la migration, mot pour mot', () => {
    for (const message of ['Accès refusé à ce dossier.', 'Exercice invalide.']) {
      expect(MIGRATION).toContain(`'${message}'`)
      expect(TEXTE_ESSAI_SIMULATION).toContain(`$m$${message}$m$`)
    }
    expect(TEXTE_ESSAI_SIMULATION).toContain("'42501', 'permission denied for function ventes_facturees_de_la_simulation'")
  })

  it('ce que la base y rend, relu par ce module, fait les mêmes totaux que l’Estimation du cabinet — année par année', () => {
    for (const d of DOSSIERS_DE_LA_SIMULATION) {
      const ventes = ventesDuDossier(d.numero)
      const cabinet = recettesFactureesDuDossier(ventes, d.mode)
      for (const annee of ANNEES_DE_LA_SIMULATION) {
        const rendu = JSON.parse(simulationCommeLaBase(d.numero, annee).replaceAll('{U}', PREFIXE_SIMULATION))
        const client = recettesDeLaSimulation(rendu, annee)
        expect(client, `${d.nom} ${annee}`).not.toBeNull()
        const totaux = (recettes: RecettesFacturees) =>
          totauxPourAnnee([], [], annee, true, new Map(), d.mode, [], recettes).ca
        expect(totaux(client as RecettesFacturees), `${d.nom} ${annee}`).toBe(totaux(cabinet))
        expect((client as Extract<RecettesFacturees, { etat: 'comptees' }>).sources).toEqual(ventes.sources)
      }
    }
  })
})
