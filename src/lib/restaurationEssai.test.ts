import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DEVIS_EXPORTES } from './devis'
import {
  CHEMINS_DOSSIER,
  CHEMINS_DOSSIER_PREVUS,
  ORDRE_RESTAURATION,
  ORDRE_RESTAURATION_PREVU,
  PARENTS_HORS_PLAN_VOULUS,
  TABLES_AUTO_REFERENCEES,
  TABLES_AUTO_REFERENCEES_PAR_VAGUES,
  TABLES_DES_DEVIS,
  type CheminDossier,
} from './sauvegarde'

// L'ESSAI DE RESTAURATION REJOUE LE PLAN DU CODE, OU IL NE PROUVE RIEN.
//
// `supabase/essais/restauration.sql` restaure un dossier dans un schéma jetable qui porte les vraies contraintes, sur
// une réplique locale. Il recopie trois listes de ce module — l'ordre, le chemin de chaque table, les liens restaurés par
// vagues — et traite à part la seconde passe des avoirs. Le 09/10/2026, il datait encore du 18/09 : 40 tables sur 58,
// aucune vague. Un essai qui rejoue un AUTRE plan que celui du code donne un vert qui ne dit rien de la restauration
// réelle : ce test confronte, à chaque exécution de la suite, ce que le script recopie à ce que le code exécute.

const texteDeLEssai = readFileSync(new URL('../../supabase/essais/restauration.sql', import.meta.url), 'utf8')

interface PlanDeLEssai {
  ordre: { rang: number; table: string }[]
  chemins: Record<string, { acces: string; parent: string | null; colonne: string | null }>
  vagues: { table: string; colonne: string }[]
  /** Les tables dont le script réécrit le lien auto-référencé en deux passes. */
  deuxPasses: { table: string; colonne: string }[]
  /** Les accès que les branches du script savent traiter. */
  accesTraites: string[]
}

function bloc(texte: string, table: string): string {
  const debut = texte.indexOf(`insert into essai_restauration.${table} (`)
  if (debut < 0) return ''
  const fin = texte.indexOf(';', debut)
  return texte.slice(debut, fin < 0 ? texte.length : fin)
}

function planDeLEssai(texte: string): PlanDeLEssai {
  const ordre = [...bloc(texte, '_ordre').matchAll(/\((\d+),'(\w+)'\)/g)].map((m) => ({ rang: Number(m[1]), table: m[2] }))
  const chemins: PlanDeLEssai['chemins'] = {}
  for (const m of bloc(texte, '_chemins').matchAll(/\('(\w+)','(\w+)',(?:null|'(\w+)'),(?:null|'(\w+)')\)/g)) {
    chemins[m[1]] = { acces: m[2], parent: m[3] ?? null, colonne: m[4] ?? null }
  }
  const vagues = [...bloc(texte, '_vagues').matchAll(/\('(\w+)','(\w+)'\)/g)].map((m) => ({ table: m[1], colonne: m[2] }))
  const deuxPasses = [...texte.matchAll(/update essai_restauration\.(\w+) set (\w+) = null;/g)].map((m) => ({
    table: m[1],
    colonne: m[2],
  }))
  const accesTraites = [
    ...[...texte.matchAll(/r\.acces = '(\w+)'/g)].map((m) => m[1]),
    ...[...texte.matchAll(/r\.acces in \(([^)]*)\)/g)].flatMap((m) => [...m[1].matchAll(/'(\w+)'/g)].map((n) => n[1])),
  ]
  return { ordre, chemins, vagues, deuxPasses, accesTraites: [...new Set(accesTraites)].sort() }
}

function cheminAttendu(c: CheminDossier): { acces: string; parent: string | null; colonne: string | null } {
  return c.acces === 'par_parent'
    ? { acces: c.acces, parent: c.parent, colonne: c.colonne }
    : { acces: c.acces, parent: null, colonne: null }
}

// LES DEVIS (espace client, étape P5) : un bloc à part du script les met au plan quand leurs tables existent, juste avant
// `exercices_valides`, leurs rangs calculés. Ce qu'il dit : les tables, dans l'ordre où elles entrent ; leurs chemins ; le
// décalage d'`exercices_valides` et le rang de la première, qui doivent tomber juste pour ce nombre de tables.
interface BlocDesDevis {
  tables: string[]
  chemins: PlanDeLEssai['chemins']
  decalage: number | null
  retrait: number | null
  conditionne: boolean
}

const MARQUE_DES_DEVIS = '-- ══ Les devis (espace client, étape P5) ══'

function blocDesDevis(texte: string): BlocDesDevis {
  const debut = texte.indexOf(MARQUE_DES_DEVIS)
  const corps = debut < 0 ? '' : texte.slice(debut, texte.indexOf('end $$;', debut))
  const tables = [...corps.matchAll(/\((\d+),'(\w+)'\)/g)].sort((a, b) => Number(a[1]) - Number(b[1])).map((m) => m[2])
  const chemins: PlanDeLEssai['chemins'] = {}
  for (const m of corps.matchAll(/\('(\w+)','(\w+)',(?:null|'(\w+)'),(?:null|'(\w+)')\)/g)) {
    chemins[m[1]] = { acces: m[2], parent: m[3] ?? null, colonne: m[4] ?? null }
  }
  const decalage = /set rang = rang \+ (\d+) where table_nom = 'exercices_valides'/.exec(corps)
  const retrait = /table_nom = 'exercices_valides'\) - (\d+) \+ v\.i/.exec(corps)
  return {
    tables,
    chemins,
    decalage: decalage ? Number(decalage[1]) : null,
    retrait: retrait ? Number(retrait[1]) : null,
    conditionne: corps.includes("if to_regclass('public.devis') is not null then"),
  }
}

/** Le plan que le script joue quand les tables des devis existent : les siennes, insérées avant `exercices_valides`. */
function avecLesDevis(plan: PlanDeLEssai, bloc: BlocDesDevis): PlanDeLEssai {
  const tables = plan.ordre.map((o) => o.table)
  const place = tables.indexOf('exercices_valides')
  const ordre = [...tables.slice(0, place), ...bloc.tables, ...tables.slice(place)].map((table, i) => ({ rang: i + 1, table }))
  return { ...plan, ordre, chemins: { ...plan.chemins, ...bloc.chemins } }
}

/** Chaque écart entre ce que le script recopie et ce que le code exécute, dit en une phrase. */
function ecartsAuCode(
  plan: PlanDeLEssai,
  ordreDuCode: readonly string[],
  cheminsDuCode: Readonly<Record<string, CheminDossier>>,
): string[] {
  const ecarts: string[] = []
  plan.ordre.forEach((o, i) => {
    if (o.rang !== i + 1) ecarts.push(`_ordre : le rang ${o.rang} est à la place ${i + 1}`)
  })
  const ordre = plan.ordre.map((o) => o.table)
  if (ordre.join(',') !== ordreDuCode.join(',')) {
    const manquantes = ordreDuCode.filter((t) => !ordre.includes(t))
    const enTrop = ordre.filter((t) => !ordreDuCode.includes(t))
    const premier = ordre.findIndex((t, i) => t !== ordreDuCode[i])
    ecarts.push(`_ordre diffère d'ORDRE_RESTAURATION (manquantes : ${manquantes.join(', ') || 'aucune'} ; en trop : `
      + `${enTrop.join(', ') || 'aucune'} ; premier écart au rang ${premier + 1})`)
  }
  for (const [table, chemin] of Object.entries(cheminsDuCode)) {
    const recopie = plan.chemins[table]
    const attendu = cheminAttendu(chemin)
    if (!recopie) ecarts.push(`_chemins : ${table} manque`)
    else if (JSON.stringify(recopie) !== JSON.stringify(attendu)) {
      ecarts.push(`_chemins : ${table} vaut ${JSON.stringify(recopie)}, le code ${JSON.stringify(attendu)}`)
    }
  }
  for (const table of Object.keys(plan.chemins)) {
    if (!(table in cheminsDuCode)) ecarts.push(`_chemins : ${table} n'est pas dans CHEMINS_DOSSIER`)
  }
  if (JSON.stringify(plan.vagues) !== JSON.stringify(TABLES_AUTO_REFERENCEES_PAR_VAGUES)) {
    ecarts.push(`_vagues vaut ${JSON.stringify(plan.vagues)}, TABLES_AUTO_REFERENCEES_PAR_VAGUES `
      + JSON.stringify(TABLES_AUTO_REFERENCEES_PAR_VAGUES))
  }
  if (JSON.stringify(plan.deuxPasses) !== JSON.stringify(TABLES_AUTO_REFERENCEES)) {
    ecarts.push(`la seconde passe du script vise ${JSON.stringify(plan.deuxPasses)}, TABLES_AUTO_REFERENCEES `
      + JSON.stringify(TABLES_AUTO_REFERENCEES))
  }
  const accesDuCode = [...new Set(Object.values(cheminsDuCode).map((c) => c.acces))].sort()
  for (const acces of accesDuCode) {
    if (!plan.accesTraites.includes(acces)) ecarts.push(`aucune branche du script ne traite l'accès « ${acces} »`)
  }
  return ecarts
}

describe('l’essai de restauration rejoue le plan du code', () => {
  const plan = planDeLEssai(texteDeLEssai)
  const devis = blocDesDevis(texteDeLEssai)
  // Le plan que le script joue sur une base qui a les tables des devis, et celui qu'il joue AUJOURD'HUI : le même que le
  // code, selon que `DEVIS_EXPORTES` est levé ou non.
  const prevu = avecLesDevis(plan, devis)
  const courant = DEVIS_EXPORTES ? prevu : plan

  it('le script a été lu : une table par rang, un chemin par table, des vagues', () => {
    // Le plancher qui distingue « zéro écart » d'« aveugle » : un bloc que l'analyse ne reconnaîtrait plus rendrait des
    // listes vides, que les écarts diraient aussi — mais ce test dit lequel.
    expect(courant.ordre).toHaveLength(ORDRE_RESTAURATION.length)
    expect(Object.keys(courant.chemins)).toHaveLength(Object.keys(CHEMINS_DOSSIER).length)
    expect(plan.vagues.length).toBeGreaterThan(0)
    expect(plan.deuxPasses.length).toBeGreaterThan(0)
  })

  it('l’ordre, les chemins, les vagues, la seconde passe et les accès sont ceux du code', () => {
    expect(ecartsAuCode(courant, ORDRE_RESTAURATION, CHEMINS_DOSSIER)).toEqual([])
  })

  it('le bloc des devis a été lu : leurs trois tables, leurs chemins, des rangs qui tombent juste', () => {
    expect([...devis.tables].sort()).toEqual([...TABLES_DES_DEVIS].sort())
    expect(Object.keys(devis.chemins).sort()).toEqual([...TABLES_DES_DEVIS].sort())
    // `exercices_valides` recule d'autant de rangs qu'il entre de tables, et la première prend son ancien rang.
    expect(devis.decalage).toBe(devis.tables.length)
    expect(devis.retrait).toBe(devis.tables.length + 1)
    expect(devis.conditionne).toBe(true)
  })

  it('avec les tables des devis, le script joue le plan PRÉVU du code — quel que soit le drapeau', () => {
    expect(ecartsAuCode(prevu, ORDRE_RESTAURATION_PREVU, CHEMINS_DOSSIER_PREVUS)).toEqual([])
  })

  it('pose en prérequis chaque parent que la sauvegarde ne porte pas, comme la base d’arrivée doit le porter', () => {
    // Le cabinet du dossier, et le catalogue des rôles comptables (ligne 43, PC1) : sans eux, le script s'arrêterait sur
    // la clé du dossier, ou sur celle du plan.
    for (const parent of PARENTS_HORS_PLAN_VOULUS) {
      expect(texteDeLEssai).toMatch(new RegExp(`insert into essai_restauration\\.${parent}\\s+select \\* from public\\.${parent}`))
    }
  })

  it('les vagues partent une instruction par vague, sur chacun des liens de la table', () => {
    // La condition d'une vague : chaque lien vide, hors du dossier, ou déjà écrit — celle de `vaguesParLien`.
    expect(texteDeLEssai).toContain(`'(s.%1$I is null or s.%1$I not in (select x.id from public.%2$I x where x.dossier_id = $1)'`)
    expect(texteDeLEssai).toContain(`' or s.%1$I in (select y.id from essai_restauration.%2$I y))', v.colonne, r.table_nom), ' and ')`)
    expect(texteDeLEssai).toContain('exit when ecrits = 0;')
  })

  describe('un défaut planté se voit', () => {
    // Le plan d'hier, sans les tables des devis : celui que le script joue sur une base qui ne les a pas.
    const ordreSansDevis = ORDRE_RESTAURATION_PREVU.filter((t) => !TABLES_DES_DEVIS.includes(t))
    const cheminsSansDevis = Object.fromEntries(Object.entries(CHEMINS_DOSSIER_PREVUS).filter(([table]) => !TABLES_DES_DEVIS.includes(table)))
    const remplacer = (avant: string, apres: string) => {
      expect(texteDeLEssai).toContain(avant)
      return ecartsAuCode(planDeLEssai(texteDeLEssai.replace(avant, apres)), ordreSansDevis, cheminsSansDevis)
    }
    // Le même, sur le plan que le script joue avec les tables des devis.
    const remplacerDevis = (avant: string, apres: string) => {
      expect(texteDeLEssai).toContain(avant)
      const texte = texteDeLEssai.replace(avant, apres)
      return ecartsAuCode(avecLesDevis(planDeLEssai(texte), blocDesDevis(texte)), ORDRE_RESTAURATION_PREVU, CHEMINS_DOSSIER_PREVUS)
    }
    // Les rangs se lisent dans le code, pas dans ce fichier : une table ajoutée à l'ordre les décale tous — le plan
    // comptable d'un dossier et son catalogue, deux d'un coup (ligne 43, PC1). Ceux de la liste que le script recopie,
    // sans les devis, que son bloc à part ajoute (quel que soit le drapeau).
    const rang = (table: string) => ordreSansDevis.indexOf(table) + 1
    const [justifications, preuves, valides] = ['revision_justifications', 'revision_preuves', 'exercices_valides'].map(rang)

    it('une table des devis oubliée, deux échangées, un chemin oublié', () => {
      expect(remplacerDevis(",(3,'devis_factures')) as v(i, t)", ') as v(i, t)').join('\n')).toContain('manquantes : devis_factures')
      expect(remplacerDevis("(1,'devis_numerotation'),(2,'devis')", "(1,'devis'),(2,'devis_numerotation')").join('\n'))
        .toContain('premier écart')
      expect(remplacerDevis("('devis_factures','direct',null,null),", '').join('\n')).toContain('_chemins : devis_factures manque')
    })

    it('un décalage ou un rang de départ qui ne tombent pas juste', () => {
      const decale = blocDesDevis(texteDeLEssai.replace('set rang = rang + 3 where', 'set rang = rang + 2 where'))
      expect(decale.decalage).not.toBe(decale.tables.length)
      const retire = blocDesDevis(texteDeLEssai.replace("'exercices_valides') - 4 + v.i", "'exercices_valides') - 3 + v.i"))
      expect(retire.retrait).not.toBe(retire.tables.length + 1)
      expect(blocDesDevis(texteDeLEssai.replace("if to_regclass('public.devis') is not null then", 'if true then')).conditionne).toBe(false)
    })

    it('deux tables échangées dans l’ordre', () => {
      const ecarts = remplacer(`(${justifications},'revision_justifications'),(${preuves},'revision_preuves')`,
        `(${justifications},'revision_preuves'),(${preuves},'revision_justifications')`)
      expect(ecarts.join('\n')).toContain(`premier écart au rang ${justifications}`)
    })

    it('une table oubliée dans l’ordre', () => {
      // Le bloc entier se réécrit depuis le code, sans la table et aux rangs continus : seule son absence se voit, où que
      // passent les lignes (la banque du client, P7, a glissé deux tables entre elle et `exercices_valides`).
      const sansLaTable = ordreSansDevis.filter((t) => t !== 'revision_preuves').map((t, i) => `(${i + 1},'${t}')`)
      const ecarts = remplacer(bloc(texteDeLEssai, '_ordre'),
        `insert into essai_restauration._ordre (rang, table_nom) values ${sansLaTable.join(',')}`)
      expect(ecarts.join('\n')).toContain('manquantes : revision_preuves')
    })

    it('un rang sauté', () => {
      expect(remplacer(`(${valides},'exercices_valides')`, `(${valides + 1},'exercices_valides')`))
        .toContain(`_ordre : le rang ${valides + 1} est à la place ${valides}`)
    })

    it('le plan comptable d’un dossier, ou son catalogue, oublié', () => {
      const plan = rang('plan_comptable_dossier')
      expect(remplacer(`,(${plan},'plan_comptable_dossier')`, '').join('\n')).toContain('manquantes : plan_comptable_dossier')
      expect(remplacer("('roles_comptables','global',null,null),", '')).toContain('_chemins : roles_comptables manque')
    })

    it('un chemin oublié, ou faux', () => {
      expect(remplacer("('revision_preuves','direct',null,null),", '')).toContain('_chemins : revision_preuves manque')
      expect(remplacer("('mouvements_cca','par_parent','comptes_courants_associes','compte_id')",
        "('mouvements_cca','par_parent','comptes_courants_associes','id')").join('\n')).toContain('_chemins : mouvements_cca vaut')
    })

    it('une vague oubliée', () => {
      expect(remplacer(",('revision_justifications','reprise_de'),", ',').join('\n')).toContain('_vagues vaut')
      expect(remplacer(",\n ('pieces_hors_de_france','remplace_id');", ';').join('\n')).toContain('_vagues vaut')
    })

    it('une seconde passe qui viserait une autre colonne', () => {
      expect(remplacer('update essai_restauration.factures_emises set facture_origine_id = null;',
        'update essai_restauration.factures_emises set avoir_id = null;').join('\n')).toContain('la seconde passe du script vise')
    })

    it('un accès que plus aucune branche ne traite', () => {
      expect(remplacer("elsif r.acces = 'par_parent' then", "elsif r.acces = 'par_parent_oublie' then"))
        .toContain('aucune branche du script ne traite l\'accès « par_parent »')
    })
  })
})
