import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ADRESSES_RECEPTION_EXPORTEES } from './adressesReception'
import { ARTICLES_EXPORTES } from './articles'
import { CONTACTS_EXPORTES } from './contacts'
import { DEVIS_EXPORTES } from './devis'
import {
  CHEMINS_DOSSIER,
  CHEMINS_DOSSIER_PREVUS,
  COLONNES_GENEREES,
  ORDRE_RESTAURATION,
  ORDRE_RESTAURATION_PREVU,
  PARENTS_HORS_PLAN_VOULUS,
  TABLES_AUTO_REFERENCEES,
  TABLES_AUTO_REFERENCEES_PAR_VAGUES,
  TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES,
  TABLES_DES_ADRESSES_RECEPTION,
  TABLES_DES_ARTICLES,
  TABLES_DES_CONTACTS,
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
  /** Les colonnes générées que le script retire de chaque insertion (`_generees`). */
  generees: { table: string; colonne: string }[]
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
  const generees = [...bloc(texte, '_generees').matchAll(/\('(\w+)','(\w+)'\)/g)].map((m) => ({ table: m[1], colonne: m[2] }))
  const deuxPasses = [...texte.matchAll(/update essai_restauration\.(\w+) set (\w+) = null;/g)].map((m) => ({
    table: m[1],
    colonne: m[2],
  }))
  const accesTraites = [
    ...[...texte.matchAll(/r\.acces = '(\w+)'/g)].map((m) => m[1]),
    ...[...texte.matchAll(/r\.acces in \(([^)]*)\)/g)].flatMap((m) => [...m[1].matchAll(/'(\w+)'/g)].map((n) => n[1])),
  ]
  return { ordre, chemins, vagues, generees, deuxPasses, accesTraites: [...new Set(accesTraites)].sort() }
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

// LES ARTICLES (espace client, étape A1) : un second bloc à part les met au plan quand leur table existe, juste après la
// table qu'il nomme (`agent_conversations`), les rangs qui suivent reculant d'autant. Ce qu'il dit : la table d'ancrage, les
// tables qu'il insère, leurs chemins, s'il recule bien les rangs qui suivent, et s'il ne joue qu'avec la table présente.
interface BlocDesArticles {
  ancre: string | null
  tables: string[]
  chemins: PlanDeLEssai['chemins']
  recule: boolean
  conditionne: boolean
}

const MARQUE_DES_ARTICLES = '-- ══ Les articles (espace client, étape A1) ══'

function blocDesArticles(texte: string): BlocDesArticles {
  const debut = texte.indexOf(MARQUE_DES_ARTICLES)
  const corps = debut < 0 ? '' : texte.slice(debut, texte.indexOf('end $$;', debut))
  const chemins: PlanDeLEssai['chemins'] = {}
  for (const m of corps.matchAll(/\('(\w+)','(\w+)',(?:null|'(\w+)'),(?:null|'(\w+)')\)/g)) {
    chemins[m[1]] = { acces: m[2], parent: m[3] ?? null, colonne: m[4] ?? null }
  }
  return {
    ancre: /where o\.table_nom = '(\w+)';/.exec(corps)?.[1] ?? null,
    tables: [...corps.matchAll(/values \(v_rang \+ (\d+), '(\w+)'\)/g)].sort((a, b) => Number(a[1]) - Number(b[1])).map((m) => m[2]),
    chemins,
    recule: corps.includes('set rang = -(rang + 1) where rang > v_rang;') && corps.includes('set rang = -rang where rang < 0;'),
    conditionne: corps.includes("if to_regclass('public.articles') is not null then"),
  }
}

/** Le plan que le script joue quand la table des articles existe : la sienne, insérée après sa table d'ancrage. */
function avecLesArticles(plan: PlanDeLEssai, bloc: BlocDesArticles): PlanDeLEssai {
  const tables = plan.ordre.map((o) => o.table)
  const place = bloc.ancre == null ? -1 : tables.indexOf(bloc.ancre)
  if (place < 0 || !bloc.recule) return { ...plan, chemins: { ...plan.chemins, ...bloc.chemins } }
  const ordre = [...tables.slice(0, place + 1), ...bloc.tables, ...tables.slice(place + 1)].map((table, i) => ({ rang: i + 1, table }))
  return { ...plan, ordre, chemins: { ...plan.chemins, ...bloc.chemins } }
}

// LES ADRESSES DE RÉCEPTION (espace client, étape A6a) : un troisième bloc à part les met au plan quand leur table existe,
// juste avant `exercices_valides` — après les pièces jointes écartées ; le bloc des devis, joué ensuite, met les siennes au
// même endroit, donc après elles —, avec leur chemin et leur vague. Ce qu'il dit : les tables, leurs chemins, leurs vagues,
// le décalage d'`exercices_valides` et le retrait du rang de la table, et s'il ne joue qu'avec la table présente.
interface BlocDesAdresses {
  tables: string[]
  chemins: PlanDeLEssai['chemins']
  vagues: { table: string; colonne: string }[]
  decalage: number | null
  retrait: number | null
  conditionne: boolean
}

const MARQUE_DES_ADRESSES = '-- ══ Les adresses de réception (espace client, étape A6a) ══'

function blocDesAdresses(texte: string): BlocDesAdresses {
  const debut = texte.indexOf(MARQUE_DES_ADRESSES)
  const corps = debut < 0 ? '' : texte.slice(debut, texte.indexOf('end $$;', debut))
  const chemins: PlanDeLEssai['chemins'] = {}
  for (const m of corps.matchAll(/\('(\w+)','(\w+)',(?:null|'(\w+)'),(?:null|'(\w+)')\)/g)) {
    chemins[m[1]] = { acces: m[2], parent: m[3] ?? null, colonne: m[4] ?? null }
  }
  const vagues = /insert into essai_restauration\._vagues \(table_nom, colonne\) values\s*([^;]*);/.exec(corps)?.[1] ?? ''
  const decalage = /set rang = rang \+ (\d+) where table_nom = 'exercices_valides'/.exec(corps)
  const retrait = /select o\.rang - (\d+), '\w+' from essai_restauration\._ordre o where o\.table_nom = 'exercices_valides';/.exec(corps)
  return {
    tables: [...corps.matchAll(/select o\.rang - \d+, '(\w+)' from/g)].map((m) => m[1]),
    chemins,
    vagues: [...vagues.matchAll(/\('(\w+)','(\w+)'\)/g)].map((m) => ({ table: m[1], colonne: m[2] })),
    decalage: decalage ? Number(decalage[1]) : null,
    retrait: retrait ? Number(retrait[1]) : null,
    conditionne: corps.includes("if to_regclass('public.adresses_reception') is not null then"),
  }
}

/** Le plan que le script joue quand la table des adresses existe : la sienne, insérée avant `exercices_valides`. */
function avecLesAdresses(plan: PlanDeLEssai, bloc: BlocDesAdresses): PlanDeLEssai {
  const tables = plan.ordre.map((o) => o.table)
  const place = tables.indexOf('exercices_valides')
  const ordre = [...tables.slice(0, place), ...bloc.tables, ...tables.slice(place)].map((table, i) => ({ rang: i + 1, table }))
  return { ...plan, ordre, chemins: { ...plan.chemins, ...bloc.chemins }, vagues: [...plan.vagues, ...bloc.vagues] }
}

// LES CONTACTS (espace client, étape A4a) : un quatrième bloc à part les met au plan quand leur table existe, juste avant
// `exercices_valides` — après les adresses de réception, que leur bloc vient d'y mettre ; le bloc des devis, joué ensuite,
// met les siennes au même endroit, donc après eux —, avec leur chemin, sans vague. Il se lit comme celui des adresses, sous
// sa marque et sa table, et se joue du même geste.
const MARQUE_DES_CONTACTS = '-- ══ Les contacts (espace client, étape A4a) ══'

function blocDesContacts(texte: string): BlocDesAdresses {
  const debut = texte.indexOf(MARQUE_DES_CONTACTS)
  const corps = debut < 0 ? '' : texte.slice(debut, texte.indexOf('end $$;', debut))
  const chemins: PlanDeLEssai['chemins'] = {}
  for (const m of corps.matchAll(/\('(\w+)','(\w+)',(?:null|'(\w+)'),(?:null|'(\w+)')\)/g)) {
    chemins[m[1]] = { acces: m[2], parent: m[3] ?? null, colonne: m[4] ?? null }
  }
  const vagues = /insert into essai_restauration\._vagues \(table_nom, colonne\) values\s*([^;]*);/.exec(corps)?.[1] ?? ''
  const decalage = /set rang = rang \+ (\d+) where table_nom = 'exercices_valides'/.exec(corps)
  const retrait = /select o\.rang - (\d+), '\w+' from essai_restauration\._ordre o where o\.table_nom = 'exercices_valides';/.exec(corps)
  return {
    tables: [...corps.matchAll(/select o\.rang - \d+, '(\w+)' from/g)].map((m) => m[1]),
    chemins,
    vagues: [...vagues.matchAll(/\('(\w+)','(\w+)'\)/g)].map((m) => ({ table: m[1], colonne: m[2] })),
    decalage: decalage ? Number(decalage[1]) : null,
    retrait: retrait ? Number(retrait[1]) : null,
    conditionne: corps.includes("if to_regclass('public.contacts') is not null then"),
  }
}

/** Le plan que le script joue quand la table des contacts existe : le même geste que pour les adresses. */
const avecLesContacts = avecLesAdresses

/** Le plan que le script joue avec les tables des quatre blocs, dans l'ordre où il les joue : les articles, les adresses
 *  de réception, les contacts, les devis. */
const avecLesBlocs = (texte: string): PlanDeLEssai =>
  avecLesDevis(avecLesContacts(avecLesAdresses(avecLesArticles(planDeLEssai(texte), blocDesArticles(texte)), blocDesAdresses(texte)),
    blocDesContacts(texte)), blocDesDevis(texte))

/** Chaque écart entre ce que le script recopie et ce que le code exécute, dit en une phrase. */
function ecartsAuCode(
  plan: PlanDeLEssai,
  ordreDuCode: readonly string[],
  cheminsDuCode: Readonly<Record<string, CheminDossier>>,
  vaguesDuCode: readonly { table: string; colonne: string }[] = TABLES_AUTO_REFERENCEES_PAR_VAGUES,
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
  if (JSON.stringify(plan.vagues) !== JSON.stringify(vaguesDuCode)) {
    ecarts.push(`_vagues vaut ${JSON.stringify(plan.vagues)}, TABLES_AUTO_REFERENCEES_PAR_VAGUES `
      + JSON.stringify(vaguesDuCode))
  }
  const generees = Object.entries(COLONNES_GENEREES).flatMap(([table, colonnes]) => colonnes.map((colonne) => ({ table, colonne })))
  if (JSON.stringify(plan.generees) !== JSON.stringify(generees)) {
    ecarts.push(`_generees vaut ${JSON.stringify(plan.generees)}, COLONNES_GENEREES ${JSON.stringify(generees)}`)
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
  const articles = blocDesArticles(texteDeLEssai)
  const adresses = blocDesAdresses(texteDeLEssai)
  const contacts = blocDesContacts(texteDeLEssai)
  // Le plan que le script joue sur une base qui a les tables des quatre blocs, et celui qu'il joue AUJOURD'HUI : le même que
  // le code, selon que `ARTICLES_EXPORTES`, `ADRESSES_RECEPTION_EXPORTEES`, `CONTACTS_EXPORTES` et `DEVIS_EXPORTES` sont
  // levés ou non.
  const prevu = avecLesBlocs(texteDeLEssai)
  const avecLesArticlesDuJour = ARTICLES_EXPORTES ? avecLesArticles(plan, articles) : plan
  const avecLesAdressesDuJour = ADRESSES_RECEPTION_EXPORTEES ? avecLesAdresses(avecLesArticlesDuJour, adresses) : avecLesArticlesDuJour
  const avecLesContactsDuJour = CONTACTS_EXPORTES ? avecLesContacts(avecLesAdressesDuJour, contacts) : avecLesAdressesDuJour
  const courant = DEVIS_EXPORTES ? avecLesDevis(avecLesContactsDuJour, devis) : avecLesContactsDuJour

  it('le script a été lu : une table par rang, un chemin par table, des vagues', () => {
    // Le plancher qui distingue « zéro écart » d'« aveugle » : un bloc que l'analyse ne reconnaîtrait plus rendrait des
    // listes vides, que les écarts diraient aussi — mais ce test dit lequel.
    expect(courant.ordre).toHaveLength(ORDRE_RESTAURATION.length)
    expect(Object.keys(courant.chemins)).toHaveLength(Object.keys(CHEMINS_DOSSIER).length)
    expect(plan.vagues.length).toBeGreaterThan(0)
    expect(plan.generees.length).toBeGreaterThan(0)
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

  it('le bloc des articles a été lu : sa table, son chemin, sa table d’ancrage, les rangs qui suivent reculés', () => {
    expect(articles.tables).toEqual([...TABLES_DES_ARTICLES])
    expect(Object.keys(articles.chemins).sort()).toEqual([...TABLES_DES_ARTICLES].sort())
    // L'ancrage est la table qui précède la leur dans l'ordre PRÉVU du code.
    expect(articles.ancre).toBe(ORDRE_RESTAURATION_PREVU[ORDRE_RESTAURATION_PREVU.indexOf(TABLES_DES_ARTICLES[0]) - 1])
    expect(articles.recule).toBe(true)
    expect(articles.conditionne).toBe(true)
  })

  it('le bloc des adresses de réception a été lu : sa table, son chemin, sa vague, des rangs qui tombent juste', () => {
    expect(adresses.tables).toEqual([...TABLES_DES_ADRESSES_RECEPTION])
    expect(Object.keys(adresses.chemins).sort()).toEqual([...TABLES_DES_ADRESSES_RECEPTION].sort())
    expect(adresses.vagues).toEqual(TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES.filter((a) => TABLES_DES_ADRESSES_RECEPTION.includes(a.table)))
    // `exercices_valides` recule d'autant de rangs qu'il entre de tables, et la table prend l'avant-dernier rang.
    expect(adresses.decalage).toBe(adresses.tables.length)
    expect(adresses.retrait).toBe(1)
    expect(adresses.conditionne).toBe(true)
  })

  it('le bloc des contacts a été lu : sa table, son chemin, aucune vague, des rangs qui tombent juste', () => {
    expect(contacts.tables).toEqual([...TABLES_DES_CONTACTS])
    expect(Object.keys(contacts.chemins).sort()).toEqual([...TABLES_DES_CONTACTS].sort())
    expect(contacts.vagues).toEqual([])
    expect(TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES.filter((a) => TABLES_DES_CONTACTS.includes(a.table))).toEqual([])
    // `exercices_valides` recule d'autant de rangs qu'il entre de tables, et la table prend l'avant-dernier rang.
    expect(contacts.decalage).toBe(contacts.tables.length)
    expect(contacts.retrait).toBe(1)
    expect(contacts.conditionne).toBe(true)
  })

  it('avec les tables des quatre blocs, le script joue le plan PRÉVU du code — quels que soient les drapeaux', () => {
    expect(ecartsAuCode(prevu, ORDRE_RESTAURATION_PREVU, CHEMINS_DOSSIER_PREVUS, TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES)).toEqual([])
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
    // Le plan d'hier, sans les tables des trois blocs (devis, articles, adresses de réception) : celui que le script joue sur
    // une base qui ne les a pas, ses vagues comprises.
    const horsDesBlocs = (t: string) => !TABLES_DES_DEVIS.includes(t) && !TABLES_DES_ARTICLES.includes(t)
      && !TABLES_DES_ADRESSES_RECEPTION.includes(t) && !TABLES_DES_CONTACTS.includes(t)
    const vaguesSansLesBlocs = TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES.filter((a) => horsDesBlocs(a.table))
    const ordreSansLesBlocs = ORDRE_RESTAURATION_PREVU.filter(horsDesBlocs)
    const cheminsSansLesBlocs = Object.fromEntries(Object.entries(CHEMINS_DOSSIER_PREVUS).filter(([table]) => horsDesBlocs(table)))
    const remplacer = (avant: string, apres: string) => {
      expect(texteDeLEssai).toContain(avant)
      return ecartsAuCode(planDeLEssai(texteDeLEssai.replace(avant, apres)), ordreSansLesBlocs, cheminsSansLesBlocs, vaguesSansLesBlocs)
    }
    // Le même, sur le plan que le script joue avec les tables des trois blocs.
    const remplacerDevis = (avant: string, apres: string) => {
      expect(texteDeLEssai).toContain(avant)
      return ecartsAuCode(avecLesBlocs(texteDeLEssai.replace(avant, apres)), ORDRE_RESTAURATION_PREVU, CHEMINS_DOSSIER_PREVUS,
        TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES)
    }
    // Les rangs se lisent dans le code, pas dans ce fichier : une table ajoutée à l'ordre les décale tous — le plan
    // comptable d'un dossier et son catalogue, deux d'un coup (ligne 43, PC1). Ceux de la liste que le script recopie,
    // sans les tables des trois blocs, que ses blocs à part ajoutent (quels que soient les drapeaux).
    const rang = (table: string) => ordreSansLesBlocs.indexOf(table) + 1
    const [justifications, preuves, valides] = ['revision_justifications', 'revision_preuves', 'exercices_valides'].map(rang)

    it('une table des devis oubliée, deux échangées, un chemin oublié', () => {
      expect(remplacerDevis(",(3,'devis_factures')) as v(i, t)", ') as v(i, t)').join('\n')).toContain('manquantes : devis_factures')
      expect(remplacerDevis("(1,'devis_numerotation'),(2,'devis')", "(1,'devis'),(2,'devis_numerotation')").join('\n'))
        .toContain('premier écart')
      expect(remplacerDevis("('devis_factures','direct',null,null),", '').join('\n')).toContain('_chemins : devis_factures manque')
    })

    it('les articles ancrés ailleurs, sans leur chemin, sans le recul des rangs, ou joués sans leur table', () => {
      // Ancrés après une autre table : l'ordre diffère du code au rang de l'article.
      expect(remplacerDevis("where o.table_nom = 'agent_conversations';", "where o.table_nom = 'a_nouveaux';").join('\n'))
        .toContain('premier écart')
      expect(remplacerDevis("\n     ('articles','direct',null,null);", '').join('\n')).toContain('_chemins : articles manque')
      // Sans le recul des rangs, la table n'entre pas où le code la met — et la clé de `_ordre` l'aurait refusée.
      expect(remplacerDevis('set rang = -rang where rang < 0;', 'set rang = rang where rang < 0;').join('\n'))
        .toContain('manquantes : articles')
      expect(blocDesArticles(texteDeLEssai.replace("if to_regclass('public.articles') is not null then", 'if true then')).conditionne)
        .toBe(false)
    })

    it('les adresses de réception sans leur chemin, sans leur vague, mal placées, ou jouées sans leur table', () => {
      expect(remplacerDevis("\n     ('adresses_reception','direct',null,null);", '').join('\n')).toContain('_chemins : adresses_reception manque')
      expect(remplacerDevis("\n     ('adresses_reception','remplace_id');", '').join('\n')).toContain('_vagues vaut')
      // Ancrées ailleurs qu'avant `exercices_valides` : l'ordre diffère du code.
      const ancre = "select o.rang - 1, 'adresses_reception' from essai_restauration._ordre o where o.table_nom = 'exercices_valides';"
      expect(blocDesAdresses(texteDeLEssai.replace(ancre, ancre.replace('rang - 1', 'rang - 2'))).retrait).not.toBe(1)
      expect(blocDesAdresses(texteDeLEssai.replace('set rang = rang + 1 where', 'set rang = rang + 2 where')).decalage).not.toBe(1)
      expect(blocDesAdresses(texteDeLEssai.replace("if to_regclass('public.adresses_reception') is not null then", 'if true then')).conditionne)
        .toBe(false)
      // Le bloc oublié : la table manque au plan prévu.
      const debut = texteDeLEssai.indexOf('-- ══ Les adresses de réception (espace client, étape A6a) ══')
      const sansLeBloc = texteDeLEssai.slice(0, debut) + texteDeLEssai.slice(texteDeLEssai.indexOf('end $$;', debut) + 'end $$;'.length)
      expect(ecartsAuCode(avecLesBlocs(sansLeBloc), ORDRE_RESTAURATION_PREVU, CHEMINS_DOSSIER_PREVUS, TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES)
        .join('\n')).toContain('manquantes : adresses_reception')
    })

    it('les contacts sans leur chemin, mal placés, joués sans leur table, ou leur bloc oublié', () => {
      expect(remplacerDevis("\n     ('contacts','direct',null,null);", '').join('\n')).toContain('_chemins : contacts manque')
      const ancre = "select o.rang - 1, 'contacts' from essai_restauration._ordre o where o.table_nom = 'exercices_valides';"
      expect(blocDesContacts(texteDeLEssai.replace(ancre, ancre.replace('rang - 1', 'rang - 2'))).retrait).not.toBe(1)
      const marque = texteDeLEssai.indexOf(MARQUE_DES_CONTACTS)
      const decale = texteDeLEssai.slice(0, marque) + texteDeLEssai.slice(marque).replace('set rang = rang + 1 where', 'set rang = rang + 2 where')
      expect(blocDesContacts(decale).decalage).not.toBe(1)
      expect(blocDesContacts(texteDeLEssai.replace("if to_regclass('public.contacts') is not null then", 'if true then')).conditionne)
        .toBe(false)
      const sansLeBloc = texteDeLEssai.slice(0, marque) + texteDeLEssai.slice(texteDeLEssai.indexOf('end $$;', marque) + 'end $$;'.length)
      expect(ecartsAuCode(avecLesBlocs(sansLeBloc), ORDRE_RESTAURATION_PREVU, CHEMINS_DOSSIER_PREVUS, TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES)
        .join('\n')).toContain('manquantes : contacts')
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
      const sansLaTable = ordreSansLesBlocs.filter((t) => t !== 'revision_preuves').map((t, i) => `(${i + 1},'${t}')`)
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
      expect(remplacer(",\n ('pieces_hors_de_france','remplace_id'),", ',').join('\n')).toContain('_vagues vaut')
      expect(remplacer(",\n ('revision_conclusions','remplace_id'),", ',').join('\n')).toContain('_vagues vaut')
      expect(remplacer(",\n ('revision_seuils','remplace_id'),", ',').join('\n')).toContain('_vagues vaut')
      expect(remplacer(",\n ('revision_explications','remplace_id'),", ',').join('\n')).toContain('_vagues vaut')
      expect(remplacer(",\n ('declarations_ereporting','remplace_id'),", ',').join('\n')).toContain('_vagues vaut')
      expect(remplacer(",\n ('dossier_permanent','remplace_id');", ';').join('\n')).toContain('_vagues vaut')
    })

    it('une colonne générée oubliée, ou inventée', () => {
      expect(remplacer("values\n ('piece_textes_ocr','texte_md5');", "values\n ('piece_textes_ocr','texte');").join('\n'))
        .toContain('_generees vaut [{"table":"piece_textes_ocr","colonne":"texte"}]')
      expect(remplacer("values\n ('piece_textes_ocr','texte_md5');", "values\n ('piece_textes_ocr','texte_md5'),('pieces','statut');").join('\n'))
        .toContain('_generees vaut')
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

// LA RECOPIE DES CLÉS ÉTRANGÈRES NE PEUT PLUS ÉCHOUER EN SILENCE (défaut relevé le 10/10/2026, ligne 41, étape R4). Sur une
// base en avance sur le plan du script — une migration appliquée dont les tables n'y sont pas encore —, le bloc qui
// recopie les clés échouait ; psql passait à la suite, la restauration courait sans aucune clé et le verdict disait
// « IDENTIQUE ». Faute de base, ce test lit dans le texte ce qui l'empêche : l'arrêt à la première erreur, posé avant
// toute instruction et jamais levé ; un bloc des clés qui cherche dans le plan les deux tables de chaque clé, lève en
// NOMMANT celles qui manquent avant d'en recopier aucune, et ne rattrape rien ; son témoin, écrit après la recopie dans
// le même bloc (un bloc `do` est tout ou rien) ; un verdict qui se dit EN FAUTE sans le témoin. Le comportement, lui,
// s'éprouve sur une réplique (le commentaire de la section 1 du script).
function fautesDeLArret(texte: string): string[] {
  const fautes: string[] = []
  const instructions = texte.split('\n').map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('--'))
  if (instructions[0] !== '\\set ON_ERROR_STOP on') fautes.push('la première instruction n’est pas « \\set ON_ERROR_STOP on »')
  for (const m of texte.matchAll(/\\(?:un)?set\s+ON_ERROR_STOP\b[^\n]*/gi)) {
    if (m[0].trim() !== '\\set ON_ERROR_STOP on') fautes.push(`l’arrêt à la première erreur est touché plus loin : ${m[0].trim()}`)
  }
  const recopie = texte.indexOf("execute format('alter table essai_restauration.%I add constraint %I %s'")
  const debut = texte.lastIndexOf('do $$', recopie)
  const fin = texte.indexOf('end $$;', recopie)
  if (recopie < 0 || debut < 0 || fin < 0) return [...fautes, 'le bloc qui recopie les clés étrangères est introuvable']
  const corps = texte.slice(debut, fin)
  const leve = corps.indexOf("raise exception 'ESSAI EN FAUTE")
  if (leve < 0 || leve > corps.indexOf('for r in')) fautes.push('le bloc des clés ne lève pas avant d’en recopier aucune')
  if (!corps.includes("string_agg(format('%s (%s → %s)', c.conname, te.relname, tp.relname)")
    || !/raise exception 'ESSAI EN FAUTE(?:[^']|'')*%',\s*hors_plan;/.test(corps)) {
    fautes.push('le bloc des clés ne nomme pas celles qui ne se recopient pas')
  }
  for (const [alias, quelle] of [['te', 'enfant'], ['tp', 'parente']]) {
    if (!corps.includes(`to_regclass(format('essai_restauration.%I', ${alias}.relname)) is null`)) {
      fautes.push(`le bloc des clés ne cherche pas la table ${quelle} dans le plan`)
    }
  }
  if (/exception\s+when/i.test(corps)) fautes.push('le bloc des clés rattrape une erreur')
  const temoin = corps.indexOf('insert into essai_restauration._cles_recopiees')
  if (temoin < 0 || temoin < corps.lastIndexOf('end loop;')) fautes.push('le témoin ne s’écrit pas après la recopie, dans son bloc')
  if (!/select 'EN FAUTE'[^;]*where not exists \(select 1 from essai_restauration\._cles_recopiees\)/.test(texte)) {
    fautes.push('le verdict ne se dit pas EN FAUTE sans le témoin')
  }
  return fautes
}

describe('l’essai s’arrête, nommément, quand les clés étrangères ne se recopient pas', () => {
  it('l’arrêt, le bloc qui nomme et lève, le témoin, le verdict EN FAUTE', () => {
    expect(fautesDeLArret(texteDeLEssai)).toEqual([])
  })

  it('un défaut planté se voit', () => {
    const plante = (avant: string, apres: string) => {
      expect(texteDeLEssai).toContain(avant)
      return fautesDeLArret(texteDeLEssai.replace(avant, apres)).join('\n')
    }
    expect(plante('\\set ON_ERROR_STOP on\n', '')).toContain('la première instruction')
    expect(plante('-- ══ 2. La restauration', '\\set ON_ERROR_STOP off\n-- ══ 2. La restauration')).toContain('touché plus loin')
    expect(plante("raise exception 'ESSAI EN FAUTE", "raise notice 'ESSAI EN FAUTE")).toContain('ne lève pas')
    expect(plante("n''est pas au plan — %',\n      hors_plan;", "n''est pas au plan',\n      hors_plan;")).toContain('ne nomme pas')
    expect(plante("to_regclass(format('essai_restauration.%I', te.relname)) is null", 'false')).toContain('table enfant')
    expect(plante("to_regclass(format('essai_restauration.%I', tp.relname)) is null", 'false')).toContain('table parente')
    expect(plante("ns.nspname = 'essai_restauration';\nend $$;", "ns.nspname = 'essai_restauration';\nexception when others then null;\nend $$;"))
      .toContain('rattrape')
    // Le témoin retiré, puis écrit AVANT la recopie : il ne prouverait plus qu'elle a passé.
    const temoin = '  insert into essai_restauration._cles_recopiees\n'
      + '    select count(*) from pg_constraint c join pg_namespace ns on ns.oid = c.connamespace\n'
      + "     where c.contype = 'f' and ns.nspname = 'essai_restauration';\n"
    expect(plante(temoin, '')).toContain('le témoin')
    expect(fautesDeLArret(texteDeLEssai.replace(temoin, '').replace('  end if;\n  for r in', `  end if;\n${temoin}  for r in`)).join('\n'))
      .toContain('le témoin')
    expect(plante(' where not exists (select 1 from essai_restauration._cles_recopiees)', ' where false')).toContain('EN FAUTE')
  })
})

// L'ESSAI PORTE LA GÉNÉRATION, ET NE L'ÉCRIT JAMAIS (défaut relevé à l'étape e5b1, corrigé le 11/10/2026). Ses tables
// d'essai étaient créées sans la génération des colonnes que la base calcule : il recopiait `piece_textes_ocr.texte_md5`
// sans peine, pendant que la restauration de l'application, qui l'envoyait aussi, était refusée (428C9). Faute de base,
// ce test lit dans le texte ce qui l'empêche : des tables d'essai qui portent la génération ; une liste de colonnes qui
// retire celles de `_generees` ; une boucle de restauration dont CHAQUE insertion nomme ses colonnes par cette liste et
// aucune ne recopie la ligne entière ; une ligne ARRET qui dit le code de l'erreur ; les trois contrôles du recalcul. Le
// comportement, lui, s'éprouve sur une réplique (l'en-tête du script).
function boucleDeRestauration(texte: string): string {
  const coeur = texte.indexOf("if r.acces = 'le_dossier' then")
  const debut = texte.lastIndexOf('do $$', coeur)
  const fin = texte.indexOf('end $$;', coeur)
  return coeur < 0 || debut < 0 || fin < 0 ? '' : texte.slice(debut, fin)
}

const CONTROLES_DE_LA_GENERATION = [
  "'les colonnes générées de la base, au plan, sont celles que la restauration retire'",
  "' : la table d''essai la calcule comme la base'",
  "' : recalculée à la restauration, égale à la source'",
  'count(*) filter (where e.%1$I is not distinct from s.%1$I)',
]

function fautesDeLaGeneration(texte: string): string[] {
  const fautes: string[] = []
  if (!/create table essai_restauration\.%I \(like public\.%I [^)]*\bincluding generated\)/.test(texte)) {
    fautes.push('les tables d’essai ne portent pas la génération (`including generated`)')
  }
  const debutListe = texte.indexOf('create function essai_restauration._colonnes(')
  const liste = debutListe < 0 ? '' : texte.slice(debutListe, texte.indexOf('$f$;', debutListe))
  if (!liste.includes('a.attname not in (select g.colonne from essai_restauration._generees g where g.table_nom = t)')) {
    fautes.push('la liste des colonnes ne retire pas celles de `_generees`')
  }
  const boucle = boucleDeRestauration(texte)
  if (boucle === '') return [...fautes, 'la boucle de restauration est introuvable']
  // Les tables de travail du script commencent par « _ » (`_verdict`) : seules les autres reçoivent une restauration.
  const insertions = [...boucle.matchAll(/insert into essai_restauration\.(%I|(?!_)\w+)( \(%s\) select %s)?/g)]
  // Le plancher qui distingue « aucune faute » d'« aveugle » : le dossier, le direct, les deux des vagues, les factures, le
  // partagé, le parent.
  if (insertions.length < 7) fautes.push(`la boucle ne compte que ${insertions.length} insertion(s) de la restauration`)
  for (const m of insertions.filter((i) => i[2] === undefined)) {
    fautes.push(`une insertion de la restauration ne nomme pas ses colonnes : « ${boucle.slice(m.index, m.index! + 70)} »`)
  }
  if (/select\s+(?:\w+\.)?\*|\(\w+\)\.\*/.test(boucle)) fautes.push('une insertion de la restauration recopie la ligne entière')
  const colonnes = [...boucle.matchAll(/colonnes(_s)? := essai_restauration\._colonnes\(r\.table_nom, '(s\.)?'\);/g)]
  if (colonnes.length !== 2 || colonnes.some((c) => (c[1] ?? '') !== (c[2] ? '_s' : ''))) {
    fautes.push('la boucle ne tire pas ses deux listes de colonnes de `_colonnes`')
  }
  if (!boucle.includes("'ARRET', 'sur ' || r.table_nom || ' : ' || sqlstate || ' ' || sqlerrm")) {
    fautes.push('la ligne ARRET ne dit pas le code de l’erreur')
  }
  for (const controle of CONTROLES_DE_LA_GENERATION) {
    if (!texte.includes(controle)) fautes.push(`le contrôle du recalcul « ${controle} » manque`)
  }
  return fautes
}

describe('l’essai porte la génération, et ne l’écrit jamais', () => {
  it('des tables qui calculent, une liste qui retire, des insertions qui la suivent, l’arrêt et les contrôles', () => {
    expect(fautesDeLaGeneration(texteDeLEssai)).toEqual([])
  })

  it('un défaut planté se voit', () => {
    const plante = (avant: string, apres: string) => {
      expect(texteDeLEssai).toContain(avant)
      return fautesDeLaGeneration(texteDeLEssai.replace(avant, apres)).join('\n')
    }
    expect(plante('including indexes including generated)', 'including indexes)')).toContain('ne portent pas la génération')
    expect(plante('\n     and a.attname not in (select g.colonne from essai_restauration._generees g where g.table_nom = t)', ''))
      .toContain('ne retire pas')
    expect(plante("'insert into essai_restauration.%I (%s) select %s from public.%I where id = $1',\n        r.table_nom, colonnes, colonnes, r.table_nom)",
      "'insert into essai_restauration.%I select * from public.%I where id = $1',\n        r.table_nom, r.table_nom)"))
      .toMatch(/ne nomme pas ses colonnes(.|\n)*recopie la ligne entière/)
    expect(plante("'insert into essai_restauration.factures_emises (%s) select %s from public.factures_emises s",
      "'insert into essai_restauration.factures_emises select s.* from public.factures_emises s")).toContain('recopie la ligne entière')
    expect(plante("colonnes_s := essai_restauration._colonnes(r.table_nom, 's.');", "colonnes_s := colonnes;"))
      .toContain('deux listes de colonnes')
    expect(plante("' : ' || sqlstate || ' ' || sqlerrm", "' : ' || sqlerrm")).toContain('le code de l’erreur')
    for (const controle of CONTROLES_DE_LA_GENERATION) {
      expect(plante(controle, "'un autre contrôle'")).toContain('manque')
    }
    expect(fautesDeLaGeneration(texteDeLEssai.replace("if r.acces = 'le_dossier' then", "if r.acces = 'dossier' then")))
      .toEqual(['la boucle de restauration est introuvable'])
  })
})
