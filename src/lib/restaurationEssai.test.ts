import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ADRESSES_DES_ACCES_RETIRES_PREVUES, TABLES_DES_ADRESSES_DES_ACCES_RETIRES } from './adressesDesAccesRetires'
import { ADRESSES_RECEPTION_EXPORTEES } from './adressesReception'
import { ARTICLES_EXPORTES } from './articles'
import { CAISSE_EXPORTEE } from './caisse'
import { CONTACTS_EXPORTES } from './contacts'
import { DEVIS_EXPORTES } from './devis'
import { JUMELLE_INVERSEE_EXPORTEE } from './exemplairesDesFactures'
import { FACTURES_IMPORTEES_PREVUES } from './facturesImportees'
import { LETTRES_DE_MISSION_PREVUES } from './lettresDeMission'
import { HONORAIRES_FACTURES_PREVUS } from './honorairesAFacturer'
import { DEPOT_DES_HONORAIRES_PREVU } from './depotDesHonoraires'
import { DOCUMENTS_ET_DEMANDES_PREVUS, TABLES_DES_DOCUMENTS_ET_DEMANDES } from './documentsEtDemandes'
import { ACHATS_DU_CLIENT_PREVUS, TABLES_DES_ACHATS_DU_CLIENT } from './achatsClient'
import { NOTES_DE_FRAIS_PREVUES, TABLES_DES_NOTES_DE_FRAIS } from './notesDeFrais'
import { INVENTAIRE_PREVU, TABLES_DE_L_INVENTAIRE, TABLES_DES_PROVISIONS } from './inventaire'
import { DEPART_DU_CLIENT_PREVU } from './departDuClient'
import { NUMEROTATION_CONTINUE_PREVUE } from './numerotationContinue'
import { PIECE_D_UNE_FACTURE_REPRISE_PREVUE, TABLES_DE_LA_PIECE_D_UNE_FACTURE_REPRISE } from './pieceDUneFactureReprise'
import { PARAMETRES_FACTURATION_EXPORTES } from './parametresFacturation'
import { TRACE_DES_DROITS_PREVUE } from './traceDesDroits'
import { SITUATIONS_PUBLIEES_EXPORTEES } from './situationsPubliees'
import { SAISIES_2035_EN_BASE } from './saisies2035'
import { SAISIES_2035E_PREVUES, TABLES_DES_SAISIES_2035E } from './saisies2035E'
import { STOCKS_PREVUS, TABLES_DES_STOCKS } from './stocks'
import { AFFECTATION_PREVUE, TABLES_DE_L_AFFECTATION } from './affectationDuResultat'
import { PARAMETRES_DES_COTISATIONS_EXPORTES } from './parametresDesCotisations'
import { COMPTES_BANCAIRES_EN_BASE, TABLES_DES_COMPTES_BANCAIRES } from './comptesBancaires'
import { ORIGINAUX_RETENUS_PREVUS, TABLES_DES_ORIGINAUX_LIBERES } from './originauxRetenus'
import { MODELE_DU_CABINET_PREVU, TABLES_DU_MODELE_DU_CABINET } from './modeleDuCabinet'
import { COPIE_DES_FICHIERS_PREVUE, TABLES_DES_COPIES_DES_FICHIERS } from './copieDesFichiers'
import { EXERCICES_DECALES_PREVUS, TABLES_DES_EXERCICES } from './exercices'
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
  TABLES_DE_LA_CAISSE,
  TABLES_DE_LA_TRACE_DES_DROITS,
  TABLES_DES_FACTURES_IMPORTEES,
  TABLES_DE_LA_NUMEROTATION_CONTINUE,
  TABLES_DES_SITUATIONS_PUBLIEES,
  TABLES_DES_SAISIES_2035,
  TABLES_DES_PARAMETRES_DES_COTISATIONS,
  TABLES_DES_ADRESSES_RECEPTION,
  TABLES_DES_ARTICLES,
  TABLES_DES_CONTACTS,
  TABLES_DES_DEVIS,
  TABLES_DES_PARAMETRES_FACTURATION,
  TABLES_DU_JOURNAL_DES_DESIGNATIONS,
  type CheminDossier,
  TABLES_DES_LETTRES_DE_MISSION,
  TABLES_DES_HONORAIRES_FACTURES, TABLES_DES_HONORAIRES_DEPOSES,
  TABLES_DU_DEPART,
} from './sauvegarde'
import { indiceSql } from '../test/schema'

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

// LES DEVIS (espace client, étape P5) : un bloc à part du script les met au plan quand leurs tables existent, juste après
// la table qu'il nomme (`documents_divers` : avant le journal des e-mails, qui cite un devis envoyé, étape P6c1), les rangs
// qui suivent reculant d'autant. Ce qu'il dit : la table d'ancrage, les tables dans l'ordre où elles entrent, leurs
// chemins, le recul des rangs qui suivent — qui doit tomber juste pour ce nombre de tables —, et s'il ne joue qu'avec les
// tables présentes.
interface BlocDesDevis {
  ancre: string | null
  tables: string[]
  chemins: PlanDeLEssai['chemins']
  decalage: number | null
  recule: boolean
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
  const decalage = /set rang = -\(rang \+ (\d+)\) where rang > v_rang;/.exec(corps)
  return {
    ancre: /where o\.table_nom = '(\w+)';/.exec(corps)?.[1] ?? null,
    tables,
    chemins,
    decalage: decalage ? Number(decalage[1]) : null,
    recule: decalage != null && corps.includes('set rang = -rang where rang < 0;')
      && corps.includes('select v_rang + v.i, v.t from (values '),
    conditionne: corps.includes("if to_regclass('public.devis') is not null then"),
  }
}

/** Le plan que le script joue quand les tables des devis existent : les siennes, insérées après leur table d'ancrage. */
function avecLesDevis(plan: PlanDeLEssai, bloc: BlocDesDevis): PlanDeLEssai {
  const tables = plan.ordre.map((o) => o.table)
  const place = bloc.ancre == null ? -1 : tables.indexOf(bloc.ancre)
  if (place < 0 || !bloc.recule) return { ...plan, chemins: { ...plan.chemins, ...bloc.chemins } }
  const ordre = [...tables.slice(0, place + 1), ...bloc.tables, ...tables.slice(place + 1)].map((table, i) => ({ rang: i + 1, table }))
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

// LES PARAMÈTRES DE FACTURATION (espace client, étape A5a) : un cinquième bloc à part les met au plan quand leur table
// existe, juste avant `exercices_valides` — après les contacts, que leur bloc vient d'y mettre ; le bloc des devis, joué
// ensuite, met les siennes au même endroit, donc après eux —, avec leur chemin et leur vague. Il se lit comme celui des
// adresses, sous sa marque et sa table, et se joue du même geste.
const MARQUE_DES_PARAMETRES = '-- ══ Les paramètres de facturation (espace client, étape A5a) ══'

function blocDesParametres(texte: string): BlocDesAdresses {
  const debut = texte.indexOf(MARQUE_DES_PARAMETRES)
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
    conditionne: corps.includes("if to_regclass('public.parametres_facturation') is not null then"),
  }
}

/** Le plan que le script joue quand la table des paramètres existe : le même geste que pour les adresses. */
const avecLesParametres = avecLesAdresses

// LE JOURNAL DES DÉSIGNATIONS (chantier EC-Q3, étape VF6b) : un sixième bloc à part le met au plan quand sa table existe,
// juste avant `exercices_valides` — après les paramètres de facturation, que leur bloc vient d'y mettre ; le bloc des devis,
// joué ensuite, met les siennes au même endroit, donc après lui —, avec son chemin, sans vague. Il se lit comme celui des
// contacts, sous sa marque et sa table, et se joue du même geste.
const MARQUE_DU_JOURNAL = '-- ══ Le journal des désignations (chantier EC-Q3, étape VF6b) ══'

function blocDuJournal(texte: string): BlocDesAdresses {
  const debut = texte.indexOf(MARQUE_DU_JOURNAL)
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
    conditionne: corps.includes("if to_regclass('public.designations_des_pieces') is not null then"),
  }
}

/** Le plan que le script joue quand la table du journal existe : le même geste que pour les adresses. */
const avecLeJournal = avecLesAdresses

// LA CAISSE (ligne 26.6, étape C2) : un septième bloc à part la met au plan quand sa table existe, juste après la table
// qu'il nomme (`pieces_hors_de_france_taux`), les rangs qui suivent reculant d'autant — le geste des articles —, avec son
// chemin et sa vague (`remplace_id`). Joué après le journal des désignations et avant les devis : sa vague vient après
// celles des adresses et des paramètres, comme dans la liste du code.
interface BlocDeLaCaisse extends BlocDesArticles {
  vagues: { table: string; colonne: string }[]
}

const MARQUE_DE_LA_CAISSE = '-- ══ La caisse (ligne 26.6, étape C2) ══'

function blocDeLaCaisse(texte: string): BlocDeLaCaisse {
  const debut = texte.indexOf(MARQUE_DE_LA_CAISSE)
  const corps = debut < 0 ? '' : texte.slice(debut, texte.indexOf('end $$;', debut))
  const chemins: PlanDeLEssai['chemins'] = {}
  for (const m of corps.matchAll(/\('(\w+)','(\w+)',(?:null|'(\w+)'),(?:null|'(\w+)')\)/g)) {
    chemins[m[1]] = { acces: m[2], parent: m[3] ?? null, colonne: m[4] ?? null }
  }
  const vagues = /insert into essai_restauration\._vagues \(table_nom, colonne\) values\s*([^;]*);/.exec(corps)?.[1] ?? ''
  return {
    ancre: /where o\.table_nom = '(\w+)';/.exec(corps)?.[1] ?? null,
    tables: [...corps.matchAll(/values \(v_rang \+ (\d+), '(\w+)'\)/g)].sort((a, b) => Number(a[1]) - Number(b[1])).map((m) => m[2]),
    chemins,
    vagues: [...vagues.matchAll(/\('(\w+)','(\w+)'\)/g)].map((m) => ({ table: m[1], colonne: m[2] })),
    recule: corps.includes('set rang = -(rang + 1) where rang > v_rang;') && corps.includes('set rang = -rang where rang < 0;'),
    conditionne: corps.includes("if to_regclass('public.operations_caisse') is not null then"),
  }
}

/** Le plan que le script joue quand la table de la caisse existe : la sienne après sa table d'ancrage, et sa vague. */
function avecLaCaisse(plan: PlanDeLEssai, bloc: BlocDeLaCaisse): PlanDeLEssai {
  const place = avecLesArticles(plan, bloc)
  return { ...place, vagues: [...place.vagues, ...bloc.vagues] }
}

// LA TRACE DES DROITS (espace client, étape P1-trace) : un huitième bloc à part la met au plan quand sa table existe, juste
// après la table qu'il nomme (`memberships`), les rangs qui suivent reculant d'autant — le geste des articles —, avec son
// chemin ; aucune vague. Joué après la caisse et avant les devis.
const MARQUE_DE_LA_TRACE = '-- ══ La trace des droits (espace client, étape P1-trace) ══'

function blocDeLaTrace(texte: string): BlocDesArticles {
  const debut = texte.indexOf(MARQUE_DE_LA_TRACE)
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
    conditionne: corps.includes("if to_regclass('public.trace_des_droits') is not null then"),
  }
}

/** Le plan que le script joue quand la table de la trace existe : la sienne après sa table d'ancrage. */
const avecLaTrace = avecLesArticles

// L'ADRESSE D'UN ACCÈS RETIRÉ (P1T-E2) : un bloc à part la met au plan quand sa table existe, juste après la trace des droits
// (`trace_des_droits`, son ancre), les rangs qui suivent reculant d'autant — le geste des articles —, avec son chemin ; aucune
// vague. Joué juste après la trace, avant les devis.
const MARQUE_DES_ADRESSES_RETIREES = "-- ══ L'adresse d'un accès retiré (P1T-E2) ══"

function blocDesAdressesRetirees(texte: string): BlocDesArticles {
  const debut = texte.indexOf(MARQUE_DES_ADRESSES_RETIREES)
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
    conditionne: corps.includes("if to_regclass('public.adresses_des_acces_retires') is not null then"),
  }
}

/** Le plan que le script joue quand la table des adresses existe : la sienne après la trace. */
const avecLesAdressesRetirees = avecLesArticles

// LES SITUATIONS PUBLIÉES (espace client, étape C4a) : un neuvième bloc à part les met au plan quand leur table existe,
// juste après la table qu'il nomme (`memberships` : joué après la trace, il la précède), avec leur chemin et leur vague
// (`remplace_id`) — le geste de la caisse. Joué en dernier : sa vague vient après celle de la caisse, comme dans la liste du code.
const MARQUE_DES_SITUATIONS = '-- ══ Les situations publiées (espace client, étape C4a) ══'

function blocDesSituations(texte: string): BlocDeLaCaisse {
  const debut = texte.indexOf(MARQUE_DES_SITUATIONS)
  const corps = debut < 0 ? '' : texte.slice(debut, texte.indexOf('end $$;', debut))
  const chemins: PlanDeLEssai['chemins'] = {}
  for (const m of corps.matchAll(/\('(\w+)','(\w+)',(?:null|'(\w+)'),(?:null|'(\w+)')\)/g)) {
    chemins[m[1]] = { acces: m[2], parent: m[3] ?? null, colonne: m[4] ?? null }
  }
  const vagues = /insert into essai_restauration\._vagues \(table_nom, colonne\) values\s*([^;]*);/.exec(corps)?.[1] ?? ''
  return {
    ancre: /where o\.table_nom = '(\w+)';/.exec(corps)?.[1] ?? null,
    tables: [...corps.matchAll(/values \(v_rang \+ (\d+), '(\w+)'\)/g)].sort((a, b) => Number(a[1]) - Number(b[1])).map((m) => m[2]),
    chemins,
    vagues: [...vagues.matchAll(/\('(\w+)','(\w+)'\)/g)].map((m) => ({ table: m[1], colonne: m[2] })),
    recule: corps.includes('set rang = -(rang + 1) where rang > v_rang;') && corps.includes('set rang = -rang where rang < 0;'),
    conditionne: corps.includes("if to_regclass('public.situations_publiees') is not null then"),
  }
}

/** Le plan que le script joue quand la table des situations existe : la sienne après sa table d'ancrage, et sa vague. */
const avecLesSituations = avecLaCaisse

// LES SAISIES DE LA 2035 (étapes 2035S3 à S5) : un bloc à part met leur table au plan quand elle existe, juste après la table
// qu'il nomme (`designations_des_pieces`, donc juste avant les exercices validés), avec son chemin ; aucune vague.
const MARQUE_DES_SAISIES_2035 = '-- ══ Les saisies de la 2035 (étapes 2035S3 à S5) ══'

function blocDesSaisies2035(texte: string): BlocDesArticles {
  const debut = texte.indexOf(MARQUE_DES_SAISIES_2035)
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
    conditionne: corps.includes("if to_regclass('public.saisies_2035') is not null then"),
  }
}

/** Le plan que le script joue quand la table des saisies existe : la sienne après sa table d'ancrage. */
const avecLesSaisies2035 = avecLesArticles

// Le bloc des paramètres des cotisations (ligne 27, TNS-Q1 et TNS-Q4) : ses deux tables après la même ancre que les saisies,
// donc devant elles ; deux rangs de recul.
const MARQUE_DES_PARAMETRES_DES_COTISATIONS = '-- ══ Les paramètres des cotisations (ligne 27, TNS-Q1 et TNS-Q4) ══'

function blocDesParametresDesCotisations(texte: string): BlocDesArticles {
  const debut = texte.indexOf(MARQUE_DES_PARAMETRES_DES_COTISATIONS)
  const corps = debut < 0 ? '' : texte.slice(debut, texte.indexOf('end $$;', debut))
  const chemins: PlanDeLEssai['chemins'] = {}
  for (const m of corps.matchAll(/\('(\w+)','(\w+)',(?:null|'(\w+)'),(?:null|'(\w+)')\)/g)) {
    chemins[m[1]] = { acces: m[2], parent: m[3] ?? null, colonne: m[4] ?? null }
  }
  return {
    ancre: /where o\.table_nom = '(\w+)';/.exec(corps)?.[1] ?? null,
    tables: [...corps.matchAll(/values \(v_rang \+ (\d+), '(\w+)'\)/g)].sort((a, b) => Number(a[1]) - Number(b[1])).map((m) => m[2]),
    chemins,
    recule: corps.includes('set rang = -(rang + 2) where rang > v_rang;') && corps.includes('set rang = -rang where rang < 0;'),
    conditionne: corps.includes("if to_regclass('public.parametres_des_cotisations') is not null then"),
  }
}

/** Le plan que le script joue quand les tables des paramètres existent : les siennes après leur table d'ancrage. */
const avecLesParametresDesCotisations = avecLesArticles

// LES FACTURES REPRISES (ligne 51.5, étape A8a) : un dixième bloc à part les met au plan quand leurs tables existent, juste
// après la table qu'il nomme (`factures_emises`), le lot puis ses factures reprises, les rangs qui suivent reculant d'autant
// — le geste des articles —, avec leurs chemins ; aucune vague. Joué en dernier, après les devis.
const MARQUE_DES_FACTURES_REPRISES = '-- ══ Les factures reprises (ligne 51.5, étape A8a) ══'

function blocDesFacturesReprises(texte: string): BlocDesArticles {
  const debut = texte.indexOf(MARQUE_DES_FACTURES_REPRISES)
  const corps = debut < 0 ? '' : texte.slice(debut, texte.indexOf('end $$;', debut))
  const chemins: PlanDeLEssai['chemins'] = {}
  for (const m of corps.matchAll(/\('(\w+)','(\w+)',(?:null|'(\w+)'),(?:null|'(\w+)')\)/g)) {
    chemins[m[1]] = { acces: m[2], parent: m[3] ?? null, colonne: m[4] ?? null }
  }
  const tables = [...corps.matchAll(/values \(v_rang \+ (\d+), '(\w+)'\)/g)].sort((a, b) => Number(a[1]) - Number(b[1])).map((m) => m[2])
  return {
    ancre: /where o\.table_nom = '(\w+)';/.exec(corps)?.[1] ?? null,
    tables,
    chemins,
    // Les rangs qui suivent reculent d'autant de rangs que le bloc met de tables.
    recule: tables.length > 0 && corps.includes(`set rang = -(rang + ${tables.length}) where rang > v_rang;`)
      && corps.includes('set rang = -rang where rang < 0;'),
    conditionne: corps.includes("if to_regclass('public.factures_importees') is not null then"),
  }
}

/** Le plan que le script joue quand les tables des factures reprises existent : les leurs après leur table d'ancrage. */
const avecLesFacturesReprises = avecLesArticles

// LA NUMÉROTATION QUI CONTINUE (ligne 51.5, étape A9a) : un bloc à part met ses deux tables au plan quand elles existent,
// juste après la table qu'il nomme (`factures_importees`), les modèles de numéro puis les paroles du cabinet sur la suite
// reprise, les rangs qui suivent reculant d'autant — le geste des articles —, avec leurs chemins ; aucune vague. Joué après
// le bloc des factures reprises, dont il suit la dernière table.
const MARQUE_DE_LA_NUMEROTATION = '-- ══ La numérotation qui continue (ligne 51.5, étape A9a) ══'

function blocDeLaNumerotation(texte: string): BlocDesArticles {
  const debut = texte.indexOf(MARQUE_DE_LA_NUMEROTATION)
  const corps = debut < 0 ? '' : texte.slice(debut, texte.indexOf('end $$;', debut))
  const chemins: PlanDeLEssai['chemins'] = {}
  for (const m of corps.matchAll(/\('(\w+)','(\w+)',(?:null|'(\w+)'),(?:null|'(\w+)')\)/g)) {
    chemins[m[1]] = { acces: m[2], parent: m[3] ?? null, colonne: m[4] ?? null }
  }
  const tables = [...corps.matchAll(/values \(v_rang \+ (\d+), '(\w+)'\)/g)].sort((a, b) => Number(a[1]) - Number(b[1])).map((m) => m[2])
  return {
    ancre: /where o\.table_nom = '(\w+)';/.exec(corps)?.[1] ?? null,
    tables,
    chemins,
    recule: tables.length > 0 && corps.includes(`set rang = -(rang + ${tables.length}) where rang > v_rang;`)
      && corps.includes('set rang = -rang where rang < 0;'),
    conditionne: corps.includes("if to_regclass('public.modeles_numerotation') is not null then"),
  }
}

/** Le plan que le script joue quand les tables de la numérotation existent : les siennes après leur table d'ancrage. */
const avecLaNumerotation = avecLesArticles

// LA PIÈCE D'UNE FACTURE REPRISE (ligne 51.5, A8-Q5) : un bloc à part met sa table au plan quand elle existe, juste après la
// table qu'il nomme (`ecritures_brouillon`), les rangs qui suivent reculant d'un rang — le geste des articles —, avec son chemin ;
// aucune vague. Joué en dernier, après le bloc de la numérotation.
const MARQUE_DE_LA_PIECE_D_UNE_REPRISE = "-- ══ La pièce d'une facture reprise (ligne 51.5, A8-Q5) ══"

function blocDeLaPieceDUneReprise(texte: string): BlocDesArticles {
  const debut = texte.indexOf(MARQUE_DE_LA_PIECE_D_UNE_REPRISE)
  const corps = debut < 0 ? '' : texte.slice(debut, texte.indexOf('end $$;', debut))
  const chemins: PlanDeLEssai['chemins'] = {}
  for (const m of corps.matchAll(/\('(\w+)','(\w+)',(?:null|'(\w+)'),(?:null|'(\w+)')\)/g)) {
    chemins[m[1]] = { acces: m[2], parent: m[3] ?? null, colonne: m[4] ?? null }
  }
  const tables = [...corps.matchAll(/values \(v_rang \+ (\d+), '(\w+)'\)/g)].sort((a, b) => Number(a[1]) - Number(b[1])).map((m) => m[2])
  return {
    ancre: /where o\.table_nom = '(\w+)';/.exec(corps)?.[1] ?? null,
    tables,
    chemins,
    recule: tables.length > 0 && corps.includes(`set rang = -(rang + ${tables.length}) where rang > v_rang;`)
      && corps.includes('set rang = -rang where rang < 0;'),
    conditionne: corps.includes("if to_regclass('public.pieces_des_factures_reprises') is not null then"),
  }
}

/** Le plan que le script joue quand la table des liens existe : la sienne après sa table d'ancrage. */
const avecLaPieceDUneReprise = avecLesArticles

// LES COMPTES BANCAIRES D'UN DOSSIER (ligne 26.6, lot MCB1) : un bloc à part met leur table au plan quand elle existe, juste
// après `categories`, les rangs qui suivent reculant d'un — le geste des articles —, avec son chemin ; aucune vague. Joué
// avant le bloc des lettres de mission.
const MARQUE_DES_COMPTES_BANCAIRES = "-- ══ Les comptes bancaires d'un dossier (ligne 26.6, lot MCB1) ══"

function blocDesComptesBancaires(texte: string): BlocDesArticles {
  const debut = texte.indexOf(MARQUE_DES_COMPTES_BANCAIRES)
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
    conditionne: corps.includes("if to_regclass('public.comptes_bancaires') is not null then"),
  }
}

/** Le plan que le script joue quand la table des comptes bancaires existe : la sienne après sa table d'ancrage. */
const avecLesComptesBancaires = avecLesArticles

// LES ORIGINAUX LIBÉRÉS D'UN DOSSIER SUPPRIMÉ (ligne 51.5, A8D2A-Q1) : un bloc à part met leur table au plan quand elle
// existe, juste après `cabinet_admins`, les rangs qui suivent reculant d'un — le geste des articles —, avec son chemin
// (`cabinet`) ; aucune vague. Joué après le bloc des comptes bancaires, avant celui des lettres de mission.
const MARQUE_DES_ORIGINAUX_LIBERES = "-- ══ Les originaux libérés d'un dossier supprimé (ligne 51.5, A8D2A-Q1) ══"

function blocDesOriginauxLiberes(texte: string): BlocDesArticles {
  const debut = texte.indexOf(MARQUE_DES_ORIGINAUX_LIBERES)
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
    conditionne: corps.includes("if to_regclass('public.originaux_liberes') is not null then"),
  }
}

/** Le plan que le script joue quand la table des originaux libérés existe : la sienne après sa table d'ancrage. */
const avecLesOriginauxLiberes = avecLesArticles

// LES COPIES DES FICHIERS (INAL6) : un bloc à part met leur table au plan quand elle existe, juste après `cabinet_admins`,
// les rangs qui suivent reculant d'un ; joué AVANT le bloc des originaux libérés (même ancrage : il la repousse derrière lui).
const MARQUE_DES_COPIES_DES_FICHIERS = '-- ══ Les copies des fichiers sur un support du cabinet (INAL6) ══'

function blocDesCopiesDesFichiers(texte: string): BlocDesArticles {
  const debut = texte.indexOf(MARQUE_DES_COPIES_DES_FICHIERS)
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
    conditionne: corps.includes("if to_regclass('public.copies_des_fichiers') is not null then"),
  }
}

const avecLesCopiesDesFichiers = avecLesArticles

// LE MODÈLE DE PLAN DU CABINET (ligne 43, PC5) : un bloc à part met sa table au plan quand elle existe, juste après
// `roles_comptables`, les rangs qui suivent reculant d'un — le geste des originaux —, avec son chemin (`cabinet`) ; aucune
// vague. Joué après le bloc des originaux libérés, avant celui des lettres de mission.
const MARQUE_DU_MODELE_DU_CABINET = '-- ══ Le modèle de plan du cabinet (ligne 43, PC5) ══'

function blocDuModeleDuCabinet(texte: string): BlocDesArticles {
  const debut = texte.indexOf(MARQUE_DU_MODELE_DU_CABINET)
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
    conditionne: corps.includes("if to_regclass('public.plan_comptable_cabinet') is not null then"),
  }
}

/** Le plan que le script joue quand la table du modèle existe : la sienne après sa table d'ancrage. */
const avecLeModeleDuCabinet = avecLesArticles

// LES LETTRES DE MISSION (ligne 47, LM4) : un bloc à part met leurs deux tables au plan quand elles existent, juste après la
// table qu'il nomme (`precisions_mouvements`), les rangs qui suivent reculant de deux, avec leurs chemins et leurs vagues
// (`remplace_id`) — le geste de la caisse. Joué en dernier : ses vagues viennent après toutes les autres.
// LE DÉPART D'UN CLIENT (ligne 44, INAL5) : un bloc à part met ses deux tables au plan quand elles existent, après
// `exercices_valides`, la dernière, les paquets avant la conservation ; leurs chemins ; aucune vague. Joué en dernier.
const MARQUE_DU_DEPART = '-- ══ Le départ d\'un client (ligne 44, INAL5) ══'

function blocDuDepart(texte: string): BlocDeLaCaisse {
  const debut = texte.indexOf(MARQUE_DU_DEPART)
  const corps = debut < 0 ? '' : texte.slice(debut, texte.indexOf('end $$;', debut))
  const chemins: PlanDeLEssai['chemins'] = {}
  for (const m of corps.matchAll(/\('(\w+)','(\w+)',(?:null|'(\w+)'),(?:null|'(\w+)')\)/g)) {
    chemins[m[1]] = { acces: m[2], parent: m[3] ?? null, colonne: m[4] ?? null }
  }
  const tables = [...corps.matchAll(/values \(v_rang \+ (\d+), '(\w+)'\)/g)].sort((a, b) => Number(a[1]) - Number(b[1])).map((m) => m[2])
  return {
    ancre: /where o\.table_nom = '(\w+)';/.exec(corps)?.[1] ?? null,
    tables,
    chemins,
    vagues: [],
    recule: tables.length > 0 && corps.includes(`set rang = -(rang + ${tables.length}) where rang > v_rang;`)
      && corps.includes('set rang = -rang where rang < 0;'),
    conditionne: corps.includes("if to_regclass('public.conservations_des_dossiers') is not null then"),
  }
}

const MARQUE_DES_LETTRES_DE_MISSION = '-- ══ Les lettres de mission (ligne 47, LM4) ══'

function blocDesLettresDeMission(texte: string): BlocDeLaCaisse {
  const debut = texte.indexOf(MARQUE_DES_LETTRES_DE_MISSION)
  const corps = debut < 0 ? '' : texte.slice(debut, texte.indexOf('end $$;', debut))
  const chemins: PlanDeLEssai['chemins'] = {}
  for (const m of corps.matchAll(/\('(\w+)','(\w+)',(?:null|'(\w+)'),(?:null|'(\w+)')\)/g)) {
    chemins[m[1]] = { acces: m[2], parent: m[3] ?? null, colonne: m[4] ?? null }
  }
  const vagues = /insert into essai_restauration\._vagues \(table_nom, colonne\) values\s*([^;]*);/.exec(corps)?.[1] ?? ''
  const tables = [...corps.matchAll(/values \(v_rang \+ (\d+), '(\w+)'\)/g)].sort((a, b) => Number(a[1]) - Number(b[1])).map((m) => m[2])
  return {
    ancre: /where o\.table_nom = '(\w+)';/.exec(corps)?.[1] ?? null,
    tables,
    chemins,
    vagues: [...vagues.matchAll(/\('(\w+)','(\w+)'\)/g)].map((m) => ({ table: m[1], colonne: m[2] })),
    recule: tables.length > 0 && corps.includes(`set rang = -(rang + ${tables.length}) where rang > v_rang;`)
      && corps.includes('set rang = -rang where rang < 0;'),
    conditionne: corps.includes("if to_regclass('public.lettres_de_mission') is not null then"),
  }
}

/** Le plan que le script joue quand les tables des lettres existent : les leurs après leur table d'ancrage, et leurs vagues. */
const avecLesLettresDeMission = avecLaCaisse

// LES FACTURES D'HONORAIRES (ligne 47, LM7) : un bloc à part met leur table au plan quand elle existe, juste après
// `lettres_de_mission`, les rangs qui suivent reculant d'un — le geste des articles —, avec son chemin ; aucune vague. Joué
// après le bloc des lettres de mission, qui pose son ancre.
const MARQUE_DES_HONORAIRES_FACTURES = "-- ══ Les factures d'honoraires (ligne 47, LM7) ══"

function blocDesHonorairesFactures(texte: string): BlocDesArticles {
  const debut = texte.indexOf(MARQUE_DES_HONORAIRES_FACTURES)
  const corps = debut < 0 ? '' : texte.slice(debut, texte.indexOf('end $$;', debut))
  const chemins: PlanDeLEssai['chemins'] = {}
  for (const m of corps.matchAll(/\('(\w+)','(\w+)',(?:null|'(\w+)'),(?:null|'(\w+)')\)/g)) {
    chemins[m[1]] = { acces: m[2], parent: m[3] ?? null, colonne: m[4] ?? null }
  }
  const tables = [...corps.matchAll(/values \(v_rang \+ (\d+), '(\w+)'\)/g)].sort((a, b) => Number(a[1]) - Number(b[1])).map((m) => m[2])
  return {
    ancre: /where o\.table_nom = '(\w+)';/.exec(corps)?.[1] ?? null,
    tables,
    chemins,
    recule: tables.length > 0 && corps.includes(`set rang = -(rang + ${tables.length}) where rang > v_rang;`)
      && corps.includes('set rang = -rang where rang < 0;'),
    conditionne: corps.includes("if to_regclass('public.honoraires_factures') is not null then"),
  }
}

/** Le plan que le script joue quand la table des liens d'honoraires existe : la sienne après sa table d'ancrage. */
const avecLesHonorairesFactures = avecLesArticles

// LE DÉPÔT DES FACTURES D'HONORAIRES (ligne 47, LM8) : un bloc à part met sa table au plan quand elle existe, juste après
// `honoraires_factures`, les rangs qui suivent reculant d'un — le geste des articles —, avec son chemin ; aucune vague.
// Joué après le bloc des factures d'honoraires, qui pose son ancre.
const MARQUE_DES_HONORAIRES_DEPOSES = "-- ══ Le dépôt des factures d'honoraires (ligne 47, LM8) ══"

function blocDesHonorairesDeposes(texte: string): BlocDesArticles {
  const debut = texte.indexOf(MARQUE_DES_HONORAIRES_DEPOSES)
  const corps = debut < 0 ? '' : texte.slice(debut, texte.indexOf('end $$;', debut))
  const chemins: PlanDeLEssai['chemins'] = {}
  for (const m of corps.matchAll(/\('(\w+)','(\w+)',(?:null|'(\w+)'),(?:null|'(\w+)')\)/g)) {
    chemins[m[1]] = { acces: m[2], parent: m[3] ?? null, colonne: m[4] ?? null }
  }
  const tables = [...corps.matchAll(/values \(v_rang \+ (\d+), '(\w+)'\)/g)].sort((a, b) => Number(a[1]) - Number(b[1])).map((m) => m[2])
  return {
    ancre: /where o\.table_nom = '(\w+)';/.exec(corps)?.[1] ?? null,
    tables,
    chemins,
    recule: tables.length > 0 && corps.includes(`set rang = -(rang + ${tables.length}) where rang > v_rang;`)
      && corps.includes('set rang = -rang where rang < 0;'),
    conditionne: corps.includes("if to_regclass('public.honoraires_deposes') is not null then"),
  }
}

/** Le plan que le script joue quand la table des dépôts d'honoraires existe : la sienne après sa table d'ancrage. */
const avecLesHonorairesDeposes = avecLesArticles

// LES DOCUMENTS ET LES DEMANDES DU CABINET (ligne 51.5, B2) : un bloc à part met leurs cinq tables au plan quand elles
// existent, juste après `dossier_permanent`, les rangs qui suivent reculant de cinq — le geste des articles —, avec leurs
// chemins ; aucune vague. Joué en dernier.
const MARQUE_DES_DOCUMENTS_ET_DEMANDES = '-- ══ Les documents et les demandes du cabinet (ligne 51.5, B2) ══'

function blocDesDocumentsEtDemandes(texte: string): BlocDesArticles {
  const debut = texte.indexOf(MARQUE_DES_DOCUMENTS_ET_DEMANDES)
  const corps = debut < 0 ? '' : texte.slice(debut, texte.indexOf('end $$;', debut))
  const chemins: PlanDeLEssai['chemins'] = {}
  for (const m of corps.matchAll(/\('(\w+)','(\w+)',(?:null|'(\w+)'),(?:null|'(\w+)')\)/g)) {
    chemins[m[1]] = { acces: m[2], parent: m[3] ?? null, colonne: m[4] ?? null }
  }
  const tables = [...corps.matchAll(/values \(v_rang \+ (\d+), '(\w+)'\)/g)].sort((a, b) => Number(a[1]) - Number(b[1])).map((m) => m[2])
  return {
    ancre: /where o\.table_nom = '(\w+)';/.exec(corps)?.[1] ?? null,
    tables,
    chemins,
    recule: tables.length > 0 && corps.includes(`set rang = -(rang + ${tables.length}) where rang > v_rang;`)
      && corps.includes('set rang = -rang where rang < 0;'),
    conditionne: corps.includes("if to_regclass('public.documents_cabinet') is not null then"),
  }
}

/** Le plan que le script joue quand les tables des documents et des demandes existent : les leurs après leur ancre. */
const avecLesDocumentsEtDemandes = avecLesArticles

const MARQUE_DES_ACHATS_DU_CLIENT = '-- ══ Les achats du client (ligne 51.5, B4) ══'

function blocDesAchatsDuClient(texte: string): BlocDesArticles {
  const debut = texte.indexOf(MARQUE_DES_ACHATS_DU_CLIENT)
  const corps = debut < 0 ? '' : texte.slice(debut, texte.indexOf('end $$;', debut))
  const chemins: PlanDeLEssai['chemins'] = {}
  for (const m of corps.matchAll(/\('(\w+)','(\w+)',(?:null|'(\w+)'),(?:null|'(\w+)')\)/g)) {
    chemins[m[1]] = { acces: m[2], parent: m[3] ?? null, colonne: m[4] ?? null }
  }
  const tables = [...corps.matchAll(/values \(v_rang \+ (\d+), '(\w+)'\)/g)].sort((a, b) => Number(a[1]) - Number(b[1])).map((m) => m[2])
  return {
    ancre: /where o\.table_nom = '(\w+)';/.exec(corps)?.[1] ?? null,
    tables,
    chemins,
    recule: tables.length > 0 && corps.includes(`set rang = -(rang + ${tables.length}) where rang > v_rang;`)
      && corps.includes('set rang = -rang where rang < 0;'),
    conditionne: corps.includes("if to_regclass('public.paiements_declares') is not null then"),
  }
}

const MARQUE_DES_NOTES_DE_FRAIS = '-- ══ Les notes de frais (ligne 51.5, B7) ══'

function blocDesNotesDeFrais(texte: string): BlocDesArticles {
  const debut = texte.indexOf(MARQUE_DES_NOTES_DE_FRAIS)
  const corps = debut < 0 ? '' : texte.slice(debut, texte.indexOf('end $$;', debut))
  const chemins: PlanDeLEssai['chemins'] = {}
  for (const m of corps.matchAll(/\('(\w+)','(\w+)',(?:null|'(\w+)'),(?:null|'(\w+)')\)/g)) {
    chemins[m[1]] = { acces: m[2], parent: m[3] ?? null, colonne: m[4] ?? null }
  }
  const tables = [...corps.matchAll(/values \(v_rang \+ (\d+), '(\w+)'\)/g)].sort((a, b) => Number(a[1]) - Number(b[1])).map((m) => m[2])
  return {
    ancre: /where o\.table_nom = '(\w+)';/.exec(corps)?.[1] ?? null,
    tables,
    chemins,
    recule: tables.length > 0 && corps.includes(`set rang = -(rang + ${tables.length}) where rang > v_rang;`)
      && corps.includes('set rang = -rang where rang < 0;'),
    conditionne: corps.includes("if to_regclass('public.notes_de_frais') is not null then"),
  }
}

// LES SAISIES DE L'ANNEXE 2035-E (ligne 48) : un bloc à part, joué en dernier, met leur table juste après celle des saisies
// de la 2035, donc juste avant les exercices validés ; son chemin ; aucune vague.
const MARQUE_DES_SAISIES_2035E = "-- ══ Les saisies de l'annexe 2035-E (ligne 48) ══"

function blocDesSaisies2035E(texte: string): BlocDesArticles {
  const debut = texte.indexOf(MARQUE_DES_SAISIES_2035E)
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
    conditionne: corps.includes("if to_regclass('public.saisies_2035e') is not null then"),
  }
}

/** Le plan que le script joue quand la table des saisies de l'annexe existe : la sienne après sa table d'ancrage. */
const avecLesSaisies2035E = avecLesArticles

// LES OPÉRATIONS D'INVENTAIRE (ligne 35, INV2) : un bloc à part, joué en dernier, met leur table juste après
// `notes_internes`, avant les pièces hors de France ; son chemin ; aucune vague.
const MARQUE_DE_L_INVENTAIRE = "-- ══ Les opérations d'inventaire (ligne 35, INV2) ══"

function blocDeLInventaire(texte: string): BlocDesArticles {
  const debut = texte.indexOf(MARQUE_DE_L_INVENTAIRE)
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
    conditionne: corps.includes("if to_regclass('public.operations_inventaire') is not null then"),
  }
}

/** Le plan que le script joue quand la table des opérations d'inventaire existe : la sienne après sa table d'ancrage. */
const avecLInventaire = avecLesArticles

// LES PROVISIONS (ligne 35, INV4) : un bloc à part, joué après celui des opérations d'inventaire, met leur table juste après
// `notes_internes`, devant les opérations qui les citent ; son chemin ; aucune vague.
const MARQUE_DES_PROVISIONS = "-- ══ Les provisions (ligne 35, INV4) ══"

function blocDesProvisions(texte: string): BlocDesArticles {
  const debut = texte.indexOf(MARQUE_DES_PROVISIONS)
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
    conditionne: corps.includes("if to_regclass('public.provisions') is not null then"),
  }
}

// LES STOCKS DE CLÔTURE (ligne 36, LIA2) : un bloc à part, joué AVANT celui des opérations d’inventaire (qui passe devant
// lui), met leur table juste après `notes_internes` ; son chemin ; aucune vague.
const MARQUE_DES_STOCKS = "-- ══ Les stocks de clôture (ligne 36) ══"

function blocDesStocks(texte: string): BlocDesArticles {
  const debut = texte.indexOf(MARQUE_DES_STOCKS)
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
    conditionne: corps.includes("if to_regclass('public.stocks_de_cloture') is not null then"),
  }
}

/** Le plan que le script joue quand la table des stocks de clôture existe : la sienne après sa table d'ancrage. */
const avecLesStocks = avecLesArticles

// LES EXERCICES DÉCLARÉS (ligne 42, EXD2) : un bloc à part met leur table au plan quand elle existe, juste après `dossiers`,
// les rangs qui suivent reculant d'un ; joué APRÈS tous les autres blocs, pour qu'aucun ne se glisse entre le dossier et elle.
const MARQUE_DES_EXERCICES = '-- ══ Les exercices déclarés (ligne 42, EXD2) ══'

function blocDesExercices(texte: string): BlocDesArticles {
  const debut = texte.indexOf(MARQUE_DES_EXERCICES)
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
    conditionne: corps.includes("if to_regclass('public.exercices') is not null then"),
  }
}

/** Le plan que le script joue quand la table des exercices déclarés existe : la sienne juste après le dossier. */
const avecLesExercices = avecLesArticles

// L'AFFECTATION DU RÉSULTAT (lignes 33 et 45, AFF2) : un bloc à part, joué AVANT ceux des stocks et des opérations
// d'inventaire (qui passent devant lui), met ses deux tables juste après `notes_internes` ; leurs chemins ; aucune vague.
const MARQUE_DE_L_AFFECTATION = "-- ══ L'affectation du résultat (lignes 33 et 45, AFF2) ══"

function blocDeLAffectation(texte: string): BlocDesArticles {
  const debut = texte.indexOf(MARQUE_DE_L_AFFECTATION)
  const corps = debut < 0 ? '' : texte.slice(debut, texte.indexOf('end $$;', debut))
  const chemins: PlanDeLEssai['chemins'] = {}
  for (const m of corps.matchAll(/\('(\w+)','(\w+)',(?:null|'(\w+)'),(?:null|'(\w+)')\)/g)) {
    chemins[m[1]] = { acces: m[2], parent: m[3] ?? null, colonne: m[4] ?? null }
  }
  return {
    ancre: /where o\.table_nom = '(\w+)';/.exec(corps)?.[1] ?? null,
    tables: [...corps.matchAll(/values \(v_rang \+ (\d+), '(\w+)'\)/g)].sort((a, b) => Number(a[1]) - Number(b[1])).map((m) => m[2]),
    chemins,
    // Deux tables : les suivantes reculent de deux rangs.
    recule: corps.includes('set rang = -(rang + 2) where rang > v_rang;') && corps.includes('set rang = -rang where rang < 0;'),
    conditionne: corps.includes("if to_regclass('public.affectations_du_resultat') is not null then"),
  }
}

/** Le plan que le script joue quand les tables de l'affectation existent : les leurs après leur ancre. */
const avecLAffectation = avecLesArticles

/** Le plan que le script joue quand la table des notes de frais existe : la sienne après son ancre — jouée AVANT les achats du
 *  client et les documents et les demandes, qui passent devant. */
const avecLesNotesDeFrais = avecLesArticles

/** Le plan que le script joue quand les tables des achats du client existent : les leurs après leur ancre — joué AVANT les
 *  documents et les demandes, qui passent devant. */
const avecLesAchatsDuClient = avecLesArticles

/** Le plan que le script joue avec les tables des huit blocs, dans l'ordre où il les joue : les articles, les adresses
 *  de réception, les contacts, les paramètres de facturation, le journal des désignations, la caisse, la trace des droits,
 *  les devis. */
const avecLesBlocs = (texte: string): PlanDeLEssai => avecLesExercices(avecLInventaire(avecLInventaire(avecLesStocks(avecLAffectation(avecLesSaisies2035E(avecLesDocumentsEtDemandes(avecLesAchatsDuClient(avecLesNotesDeFrais(avecLaCaisse(avecLesHonorairesDeposes(avecLesHonorairesFactures(avecLesLettresDeMission(avecLeModeleDuCabinet(avecLesOriginauxLiberes(avecLesCopiesDesFichiers(avecLesComptesBancaires(avecLaPieceDUneReprise(avecLaNumerotation(avecLesFacturesReprises(avecLesParametresDesCotisations(avecLesSaisies2035(
  avecLesSituations(avecLesDevis(avecLesAdressesRetirees(avecLaTrace(avecLaCaisse(avecLeJournal(avecLesParametres(avecLesContacts(avecLesAdresses(avecLesArticles(planDeLEssai(texte),
    blocDesArticles(texte)), blocDesAdresses(texte)), blocDesContacts(texte)), blocDesParametres(texte)), blocDuJournal(texte)),
  blocDeLaCaisse(texte)), blocDeLaTrace(texte)), blocDesAdressesRetirees(texte)), blocDesDevis(texte)), blocDesSituations(texte)), blocDesSaisies2035(texte)),
  blocDesParametresDesCotisations(texte)), blocDesFacturesReprises(texte)), blocDeLaNumerotation(texte)), blocDeLaPieceDUneReprise(texte)), blocDesComptesBancaires(texte)), blocDesCopiesDesFichiers(texte)), blocDesOriginauxLiberes(texte)), blocDuModeleDuCabinet(texte)), blocDesLettresDeMission(texte)), blocDesHonorairesFactures(texte)), blocDesHonorairesDeposes(texte)), blocDuDepart(texte)), blocDesNotesDeFrais(texte)), blocDesAchatsDuClient(texte)), blocDesDocumentsEtDemandes(texte)), blocDesSaisies2035E(texte)), blocDeLAffectation(texte)), blocDesStocks(texte)), blocDeLInventaire(texte)), blocDesProvisions(texte)), blocDesExercices(texte))

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
  const parametres = blocDesParametres(texteDeLEssai)
  const journal = blocDuJournal(texteDeLEssai)
  const caisse = blocDeLaCaisse(texteDeLEssai)
  const trace = blocDeLaTrace(texteDeLEssai)
  // Le plan que le script joue sur une base qui a les tables des six blocs, et celui qu'il joue AUJOURD'HUI : le même que
  // le code, selon que `ARTICLES_EXPORTES`, `ADRESSES_RECEPTION_EXPORTEES`, `CONTACTS_EXPORTES`,
  // `PARAMETRES_FACTURATION_EXPORTES`, `JUMELLE_INVERSEE_EXPORTEE` et `DEVIS_EXPORTES` sont levés ou non.
  const prevu = avecLesBlocs(texteDeLEssai)
  const avecLesArticlesDuJour = ARTICLES_EXPORTES ? avecLesArticles(plan, articles) : plan
  const avecLesAdressesDuJour = ADRESSES_RECEPTION_EXPORTEES ? avecLesAdresses(avecLesArticlesDuJour, adresses) : avecLesArticlesDuJour
  const avecLesContactsDuJour = CONTACTS_EXPORTES ? avecLesContacts(avecLesAdressesDuJour, contacts) : avecLesAdressesDuJour
  const avecLesParametresDuJour = PARAMETRES_FACTURATION_EXPORTES ? avecLesParametres(avecLesContactsDuJour, parametres) : avecLesContactsDuJour
  const avecLeJournalDuJour = JUMELLE_INVERSEE_EXPORTEE ? avecLeJournal(avecLesParametresDuJour, journal) : avecLesParametresDuJour
  const avecLaCaisseDuJour = CAISSE_EXPORTEE ? avecLaCaisse(avecLeJournalDuJour, caisse) : avecLeJournalDuJour
  const avecLaTraceDuJour = TRACE_DES_DROITS_PREVUE ? avecLaTrace(avecLaCaisseDuJour, trace) : avecLaCaisseDuJour
  const adressesRetirees = blocDesAdressesRetirees(texteDeLEssai)
  const avecLesAdressesRetireesDuJour = ADRESSES_DES_ACCES_RETIRES_PREVUES
    ? avecLesAdressesRetirees(avecLaTraceDuJour, adressesRetirees) : avecLaTraceDuJour
  const situations = blocDesSituations(texteDeLEssai)
  const avecLesDevisDuJour = DEVIS_EXPORTES ? avecLesDevis(avecLesAdressesRetireesDuJour, devis) : avecLesAdressesRetireesDuJour
  const avecLesSituationsDuJour = SITUATIONS_PUBLIEES_EXPORTEES ? avecLesSituations(avecLesDevisDuJour, situations) : avecLesDevisDuJour
  const saisies2035 = blocDesSaisies2035(texteDeLEssai)
  const avecLesSaisies2035DuJour = SAISIES_2035_EN_BASE ? avecLesSaisies2035(avecLesSituationsDuJour, saisies2035) : avecLesSituationsDuJour
  const parametresDesCotisations = blocDesParametresDesCotisations(texteDeLEssai)
  const avecLesCotisationsDuJour = PARAMETRES_DES_COTISATIONS_EXPORTES
    ? avecLesParametresDesCotisations(avecLesSaisies2035DuJour, parametresDesCotisations) : avecLesSaisies2035DuJour
  const reprises = blocDesFacturesReprises(texteDeLEssai)
  const avecLesReprisesDuJour = FACTURES_IMPORTEES_PREVUES ? avecLesFacturesReprises(avecLesCotisationsDuJour, reprises) : avecLesCotisationsDuJour
  const numerotation = blocDeLaNumerotation(texteDeLEssai)
  const avecLaNumerotationDuJour = NUMEROTATION_CONTINUE_PREVUE ? avecLaNumerotation(avecLesReprisesDuJour, numerotation) : avecLesReprisesDuJour
  const pieceDUneReprise = blocDeLaPieceDUneReprise(texteDeLEssai)
  const avecLaPieceDuJour = PIECE_D_UNE_FACTURE_REPRISE_PREVUE
    ? avecLaPieceDUneReprise(avecLaNumerotationDuJour, pieceDUneReprise) : avecLaNumerotationDuJour
  const comptesBancaires = blocDesComptesBancaires(texteDeLEssai)
  const avecLesComptesDuJour = COMPTES_BANCAIRES_EN_BASE ? avecLesComptesBancaires(avecLaPieceDuJour, comptesBancaires) : avecLaPieceDuJour
  const copies = blocDesCopiesDesFichiers(texteDeLEssai)
  const avecLesCopiesDuJour = COPIE_DES_FICHIERS_PREVUE ? avecLesCopiesDesFichiers(avecLesComptesDuJour, copies) : avecLesComptesDuJour
  const originaux = blocDesOriginauxLiberes(texteDeLEssai)
  const avecLesOriginauxDuJour = ORIGINAUX_RETENUS_PREVUS ? avecLesOriginauxLiberes(avecLesCopiesDuJour, originaux) : avecLesCopiesDuJour
  const modeleDuCabinet = blocDuModeleDuCabinet(texteDeLEssai)
  const avecLeModeleDuJour = MODELE_DU_CABINET_PREVU ? avecLeModeleDuCabinet(avecLesOriginauxDuJour, modeleDuCabinet) : avecLesOriginauxDuJour
  const lettresDeMission = blocDesLettresDeMission(texteDeLEssai)
  const avecLesLettresDuJour = LETTRES_DE_MISSION_PREVUES ? avecLesLettresDeMission(avecLeModeleDuJour, lettresDeMission) : avecLeModeleDuJour
  const honorairesFactures = blocDesHonorairesFactures(texteDeLEssai)
  const avecLesHonorairesDuJour = HONORAIRES_FACTURES_PREVUS ? avecLesHonorairesFactures(avecLesLettresDuJour, honorairesFactures) : avecLesLettresDuJour
  const honorairesDeposes = blocDesHonorairesDeposes(texteDeLEssai)
  const avecLesDepotsDuJour = DEPOT_DES_HONORAIRES_PREVU ? avecLesHonorairesDeposes(avecLesHonorairesDuJour, honorairesDeposes) : avecLesHonorairesDuJour
  const depart = blocDuDepart(texteDeLEssai)
  const avecLeDepartDuJour = DEPART_DU_CLIENT_PREVU ? avecLaCaisse(avecLesDepotsDuJour, depart) : avecLesDepotsDuJour
  const notesDeFrais = blocDesNotesDeFrais(texteDeLEssai)
  const avecLesNotesDuJour = NOTES_DE_FRAIS_PREVUES ? avecLesNotesDeFrais(avecLeDepartDuJour, notesDeFrais) : avecLeDepartDuJour
  const achatsDuClient = blocDesAchatsDuClient(texteDeLEssai)
  const avecLesAchatsDuJour = ACHATS_DU_CLIENT_PREVUS ? avecLesAchatsDuClient(avecLesNotesDuJour, achatsDuClient) : avecLesNotesDuJour
  const documentsEtDemandes = blocDesDocumentsEtDemandes(texteDeLEssai)
  const avecLesDocumentsDuJour = DOCUMENTS_ET_DEMANDES_PREVUS ? avecLesDocumentsEtDemandes(avecLesAchatsDuJour, documentsEtDemandes) : avecLesAchatsDuJour
  const saisies2035E = blocDesSaisies2035E(texteDeLEssai)
  const avecLesSaisies2035EDuJour = SAISIES_2035E_PREVUES ? avecLesSaisies2035E(avecLesDocumentsDuJour, saisies2035E) : avecLesDocumentsDuJour
  const affectation = blocDeLAffectation(texteDeLEssai)
  const avecLAffectationDuJour = AFFECTATION_PREVUE ? avecLAffectation(avecLesSaisies2035EDuJour, affectation) : avecLesSaisies2035EDuJour
  const stocks = blocDesStocks(texteDeLEssai)
  const avecLesStocksDuJour = STOCKS_PREVUS ? avecLesStocks(avecLAffectationDuJour, stocks) : avecLAffectationDuJour
  const inventaire = blocDeLInventaire(texteDeLEssai)
  const provisions = blocDesProvisions(texteDeLEssai)
  const avecLInventaireDuJour = INVENTAIRE_PREVU ? avecLInventaire(avecLInventaire(avecLesStocksDuJour, inventaire), provisions) : avecLesStocksDuJour
  const exercices = blocDesExercices(texteDeLEssai)
  const courant = EXERCICES_DECALES_PREVUS ? avecLesExercices(avecLInventaireDuJour, exercices) : avecLInventaireDuJour

  it('le bloc des stocks de clôture : sa table, après `notes_internes`, joué avant celui de l’inventaire, conditionné, son chemin (ligne 36)', () => {
    expect(stocks).toEqual({
      ancre: 'notes_internes', tables: [...TABLES_DES_STOCKS], recule: true, conditionne: true,
      chemins: { stocks_de_cloture: { acces: 'direct', parent: null, colonne: null } },
    })
    // Les deux blocs s'ancrent sur `notes_internes` : celui de l'inventaire, joué après, passe devant les stocks.
    const rang = ORDRE_RESTAURATION_PREVU.indexOf('notes_internes')
    expect(ORDRE_RESTAURATION_PREVU.slice(rang + 1, rang + 2 + TABLES_DE_L_INVENTAIRE.length + TABLES_DES_STOCKS.length
      + TABLES_DE_L_AFFECTATION.length))
      .toEqual([...TABLES_DE_L_INVENTAIRE, ...TABLES_DES_STOCKS, ...TABLES_DE_L_AFFECTATION, 'pieces_hors_de_france'])
    expect(texteDeLEssai.indexOf(MARQUE_DES_STOCKS)).toBeGreaterThan(texteDeLEssai.indexOf(MARQUE_DES_SAISIES_2035E))
    expect(texteDeLEssai.indexOf(MARQUE_DES_STOCKS)).toBeGreaterThan(texteDeLEssai.indexOf(MARQUE_DE_L_AFFECTATION))
  })

  it('le bloc de l’affectation du résultat : ses deux tables, après `notes_internes`, joué avant celui des stocks, conditionné, leurs chemins (AFF2)', () => {
    expect(affectation).toEqual({
      ancre: 'notes_internes', tables: [...TABLES_DE_L_AFFECTATION], recule: true, conditionne: true,
      chemins: Object.fromEntries(TABLES_DE_L_AFFECTATION.map((t) => [t, { acces: 'direct', parent: null, colonne: null }])),
    })
    expect(texteDeLEssai.indexOf(MARQUE_DE_L_AFFECTATION)).toBeGreaterThan(texteDeLEssai.indexOf(MARQUE_DES_SAISIES_2035E))
  })

  it('le bloc des opérations d’inventaire : sa table, après `notes_internes`, joué avant celui des exercices, conditionné, son chemin (INV2)', () => {
    expect(inventaire).toEqual({
      ancre: 'notes_internes', tables: ['operations_inventaire'], recule: true, conditionne: true,
      chemins: { operations_inventaire: { acces: 'direct', parent: null, colonne: null } },
    })
    // Les provisions (INV4) : leur bloc, joué après, passe devant les opérations d'inventaire qui les citent.
    expect(provisions).toEqual({
      ancre: 'notes_internes', tables: [...TABLES_DES_PROVISIONS], recule: true, conditionne: true,
      chemins: Object.fromEntries(TABLES_DES_PROVISIONS.map((t) => [t, { acces: 'direct', parent: null, colonne: null }])),
    })
    expect(texteDeLEssai.indexOf(MARQUE_DES_PROVISIONS)).toBeGreaterThan(texteDeLEssai.indexOf(MARQUE_DE_L_INVENTAIRE))
    const rang = ORDRE_RESTAURATION_PREVU.indexOf('notes_internes')
    expect(ORDRE_RESTAURATION_PREVU.slice(rang + 1, rang + 1 + TABLES_DE_L_INVENTAIRE.length)).toEqual([...TABLES_DE_L_INVENTAIRE])
    expect(texteDeLEssai.indexOf(MARQUE_DE_L_INVENTAIRE)).toBeGreaterThan(texteDeLEssai.indexOf(MARQUE_DES_STOCKS))
  })


  it('le bloc des exercices déclarés : sa table, juste après `dossiers`, joué en dernier, conditionné, son chemin (ligne 42)', () => {
    expect(exercices).toEqual({
      ancre: 'dossiers', tables: [...TABLES_DES_EXERCICES], recule: true, conditionne: true,
      chemins: { exercices: { acces: 'direct', parent: null, colonne: null } },
    })
    const rang = ORDRE_RESTAURATION_PREVU.indexOf('dossiers')
    expect(ORDRE_RESTAURATION_PREVU.slice(rang, rang + 2)).toEqual(['dossiers', 'exercices'])
    // Les blocs ensemble (ligne 42 ; lignes 35, 36, 33 et 45) : les exercices juste après le dossier, puis, après les notes
    // internes, les provisions devant les opérations d'inventaire qui les citent, l'inventaire devant les stocks, les stocks
    // devant l'affectation, et le plan que le script joue avec eux est le plan prévu du code.
    const notes = ORDRE_RESTAURATION_PREVU.indexOf('notes_internes')
    expect(ORDRE_RESTAURATION_PREVU.slice(notes, notes + 7)).toEqual(['notes_internes', 'provisions', 'operations_inventaire',
      'stocks_de_cloture', 'affectations_du_resultat', 'lignes_d_affectation', 'pieces_hors_de_france'])
    expect(avecLesBlocs(texteDeLEssai).ordre.map((o) => o.table)
      .filter((t) => ['dossiers', 'exercices', 'notes_internes', ...TABLES_DE_L_INVENTAIRE, ...TABLES_DES_STOCKS,
        ...TABLES_DE_L_AFFECTATION].includes(t)))
      .toEqual(['dossiers', 'exercices', 'notes_internes', 'provisions', 'operations_inventaire', 'stocks_de_cloture',
        'affectations_du_resultat', 'lignes_d_affectation'])
    expect(texteDeLEssai.indexOf(MARQUE_DES_EXERCICES)).toBeGreaterThan(texteDeLEssai.indexOf(MARQUE_DE_L_INVENTAIRE))
  })

  it('le bloc des saisies de l’annexe 2035-E : sa table, après `saisies_2035`, joué en dernier, conditionné, son chemin (ligne 48)', () => {
    expect(saisies2035E).toEqual({
      ancre: 'saisies_2035', tables: ['saisies_2035e'], recule: true, conditionne: true,
      chemins: { saisies_2035e: { acces: 'direct', parent: null, colonne: null } },
    })
    const rang = ORDRE_RESTAURATION_PREVU.indexOf('saisies_2035')
    expect(ORDRE_RESTAURATION_PREVU.slice(rang + 1, rang + 3)).toEqual(['saisies_2035e', 'exercices_valides'])
    expect(texteDeLEssai.indexOf(MARQUE_DES_SAISIES_2035E)).toBeGreaterThan(texteDeLEssai.indexOf(MARQUE_DES_DOCUMENTS_ET_DEMANDES))
  })

  it('le bloc des notes de frais : sa table, après `dossier_permanent`, jouée avant les achats du client, conditionné, son chemin (B7)', () => {
    expect(notesDeFrais).toEqual({
      ancre: 'dossier_permanent', tables: [...TABLES_DES_NOTES_DE_FRAIS], recule: true, conditionne: true,
      chemins: Object.fromEntries(TABLES_DES_NOTES_DE_FRAIS.map((t) => [t, { acces: 'direct', parent: null, colonne: null }])),
    })
    const rang = ORDRE_RESTAURATION_PREVU.indexOf('pieces_vues')
    expect(ORDRE_RESTAURATION_PREVU.slice(rang + 1, rang + 2)).toEqual([...TABLES_DES_NOTES_DE_FRAIS])
    expect(texteDeLEssai.indexOf(MARQUE_DES_NOTES_DE_FRAIS)).toBeGreaterThan(texteDeLEssai.indexOf(MARQUE_DU_DEPART))
    expect(texteDeLEssai.indexOf(MARQUE_DES_ACHATS_DU_CLIENT)).toBeGreaterThan(texteDeLEssai.indexOf(MARQUE_DES_NOTES_DE_FRAIS))
  })

  it('le bloc des achats du client : ses deux tables, après `dossier_permanent`, joué avant les documents et les demandes, conditionné, leurs chemins (B4)', () => {
    expect(achatsDuClient).toEqual({
      ancre: 'dossier_permanent', tables: [...TABLES_DES_ACHATS_DU_CLIENT], recule: true, conditionne: true,
      chemins: Object.fromEntries(TABLES_DES_ACHATS_DU_CLIENT.map((t) => [t, { acces: 'direct', parent: null, colonne: null }])),
    })
    const rang = ORDRE_RESTAURATION_PREVU.indexOf('relances_demandes')
    expect(ORDRE_RESTAURATION_PREVU.slice(rang + 1, rang + 3)).toEqual([...TABLES_DES_ACHATS_DU_CLIENT])
    expect(texteDeLEssai.indexOf(MARQUE_DES_ACHATS_DU_CLIENT)).toBeGreaterThan(texteDeLEssai.indexOf(MARQUE_DU_DEPART))
    expect(texteDeLEssai.indexOf(MARQUE_DES_DOCUMENTS_ET_DEMANDES)).toBeGreaterThan(texteDeLEssai.indexOf(MARQUE_DES_ACHATS_DU_CLIENT))
  })

  it('le bloc des documents et des demandes : ses cinq tables, après `dossier_permanent`, conditionné, leurs chemins (B2)', () => {
    expect(documentsEtDemandes).toEqual({
      ancre: 'dossier_permanent', tables: [...TABLES_DES_DOCUMENTS_ET_DEMANDES], recule: true, conditionne: true,
      chemins: Object.fromEntries(TABLES_DES_DOCUMENTS_ET_DEMANDES.map((t) => [t, { acces: 'direct', parent: null, colonne: null }])),
    })
    const rang = ORDRE_RESTAURATION_PREVU.indexOf('dossier_permanent')
    expect(ORDRE_RESTAURATION_PREVU.slice(rang + 1, rang + 6)).toEqual([...TABLES_DES_DOCUMENTS_ET_DEMANDES])
    expect(texteDeLEssai.indexOf(MARQUE_DES_DOCUMENTS_ET_DEMANDES)).toBeGreaterThan(texteDeLEssai.indexOf(MARQUE_DU_DEPART))
  })

  it('le bloc du dépôt des factures d’honoraires : sa table, après `honoraires_factures`, conditionnée, son chemin (LM8)', () => {
    expect(honorairesDeposes).toEqual({
      ancre: 'honoraires_factures', tables: ['honoraires_deposes'], recule: true, conditionne: true,
      chemins: { honoraires_deposes: { acces: 'direct', parent: null, colonne: null } },
    })
    expect(ORDRE_RESTAURATION_PREVU[ORDRE_RESTAURATION_PREVU.indexOf('honoraires_deposes') - 1]).toBe('honoraires_factures')
    expect(texteDeLEssai.indexOf(MARQUE_DES_HONORAIRES_DEPOSES)).toBeGreaterThan(texteDeLEssai.indexOf(MARQUE_DES_HONORAIRES_FACTURES))
    expect(texteDeLEssai.indexOf(MARQUE_DU_DEPART)).toBeGreaterThan(texteDeLEssai.indexOf(MARQUE_DES_HONORAIRES_DEPOSES))
  })

  it('le bloc du départ d’un client : ses deux tables, après `exercices_valides`, conditionné, leurs chemins, aucune vague (INAL5)', () => {
    expect(depart).toEqual({
      ancre: 'exercices_valides', tables: [...TABLES_DU_DEPART], recule: true, conditionne: true, vagues: [],
      chemins: Object.fromEntries(TABLES_DU_DEPART.map((t) => [t, { acces: 'direct', parent: null, colonne: null }])),
    })
    expect(texteDeLEssai.indexOf(MARQUE_DU_DEPART)).toBeGreaterThan(texteDeLEssai.indexOf(MARQUE_DES_HONORAIRES_FACTURES))
  })

  it('le bloc des factures d’honoraires : sa table, après `lettres_de_mission`, conditionnée, son chemin (LM7)', () => {
    expect(honorairesFactures).toEqual({
      ancre: 'lettres_de_mission', tables: [...TABLES_DES_HONORAIRES_FACTURES], recule: true, conditionne: true,
      chemins: { honoraires_factures: { acces: 'direct', parent: null, colonne: null } },
    })
    expect(ORDRE_RESTAURATION_PREVU[ORDRE_RESTAURATION_PREVU.indexOf(TABLES_DES_HONORAIRES_FACTURES[0]) - 1]).toBe('lettres_de_mission')
    expect(texteDeLEssai.indexOf(MARQUE_DES_HONORAIRES_FACTURES)).toBeGreaterThan(texteDeLEssai.indexOf('-- ══ Les lettres de mission (ligne 47, LM4) ══'))
  })

  it('le bloc des lettres de mission : leurs deux tables, après `precisions_mouvements`, conditionné, leurs chemins et leurs vagues (LM4)', () => {
    expect(lettresDeMission).toEqual({
      ancre: 'precisions_mouvements', tables: [...TABLES_DES_LETTRES_DE_MISSION], recule: true, conditionne: true,
      chemins: Object.fromEntries(TABLES_DES_LETTRES_DE_MISSION.map((t) => [t, { acces: 'direct', parent: null, colonne: null }])),
      vagues: TABLES_DES_LETTRES_DE_MISSION.map((table) => ({ table, colonne: 'remplace_id' })),
    })
  })

  it('le bloc du modèle de plan du cabinet : sa table, après `roles_comptables`, conditionnée, son chemin de cabinet (PC5)', () => {
    expect(modeleDuCabinet).toEqual({
      ancre: 'roles_comptables', tables: [...TABLES_DU_MODELE_DU_CABINET], recule: true, conditionne: true,
      chemins: { plan_comptable_cabinet: { acces: 'cabinet', parent: null, colonne: null } },
    })
    expect(texteDeLEssai.indexOf(MARQUE_DU_MODELE_DU_CABINET)).toBeGreaterThan(texteDeLEssai.indexOf(MARQUE_DES_ORIGINAUX_LIBERES))
  })

  it('le bloc des copies des fichiers : sa table, après `cabinet_admins`, conditionnée, son chemin de cabinet, joué avant les originaux (INAL6)', () => {
    expect(copies).toEqual({
      ancre: 'cabinet_admins', tables: [...TABLES_DES_COPIES_DES_FICHIERS], recule: true, conditionne: true,
      chemins: { copies_des_fichiers: { acces: 'cabinet', parent: null, colonne: null } },
    })
    expect(texteDeLEssai.indexOf(MARQUE_DES_COPIES_DES_FICHIERS)).toBeLessThan(texteDeLEssai.indexOf(MARQUE_DES_ORIGINAUX_LIBERES))
  })

  it('le bloc des originaux libérés : sa table, après `cabinet_admins`, conditionnée, son chemin de cabinet (A8D2A-Q1)', () => {
    expect(originaux).toEqual({
      ancre: 'cabinet_admins', tables: [...TABLES_DES_ORIGINAUX_LIBERES], recule: true, conditionne: true,
      chemins: { originaux_liberes: { acces: 'cabinet', parent: null, colonne: null } },
    })
  })

  it('le bloc des comptes bancaires : sa table, après `categories`, conditionnée, son chemin (MCB1)', () => {
    expect(comptesBancaires).toEqual({
      ancre: 'categories', tables: [...TABLES_DES_COMPTES_BANCAIRES], recule: true, conditionne: true,
      chemins: { comptes_bancaires: { acces: 'direct', parent: null, colonne: null } },
    })
  })

  it('le bloc de la pièce d’une facture reprise : sa table, après `ecritures_brouillon`, conditionné, son chemin (A8-Q5)', () => {
    expect(pieceDUneReprise).toEqual({
      ancre: 'ecritures_brouillon', tables: [...TABLES_DE_LA_PIECE_D_UNE_FACTURE_REPRISE], recule: true, conditionne: true,
      chemins: { pieces_des_factures_reprises: { acces: 'direct', parent: null, colonne: null } },
    })
  })

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
    // L'ancrage est la table qui précède la première des leurs dans l'ordre PRÉVU du code — avant le journal des e-mails,
    // qui cite un devis envoyé (étape P6c1) ; les tables qui suivent reculent d'autant de rangs qu'il en entre.
    expect(devis.ancre).toBe(ORDRE_RESTAURATION_PREVU[ORDRE_RESTAURATION_PREVU.indexOf(devis.tables[0]) - 1])
    expect(ORDRE_RESTAURATION_PREVU[ORDRE_RESTAURATION_PREVU.indexOf(devis.tables[devis.tables.length - 1]) + 1]).toBe('emails_envoyes')
    expect(devis.decalage).toBe(devis.tables.length)
    expect(devis.recule).toBe(true)
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

  it('le bloc des paramètres de facturation a été lu : sa table, son chemin, sa vague, des rangs qui tombent juste', () => {
    expect(parametres.tables).toEqual([...TABLES_DES_PARAMETRES_FACTURATION])
    expect(Object.keys(parametres.chemins).sort()).toEqual([...TABLES_DES_PARAMETRES_FACTURATION].sort())
    expect(parametres.vagues)
      .toEqual(TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES.filter((a) => TABLES_DES_PARAMETRES_FACTURATION.includes(a.table)))
    // `exercices_valides` recule d'autant de rangs qu'il entre de tables, et la table prend l'avant-dernier rang.
    expect(parametres.decalage).toBe(parametres.tables.length)
    expect(parametres.retrait).toBe(1)
    expect(parametres.conditionne).toBe(true)
  })

  it('le bloc du journal des désignations a été lu : sa table, son chemin, aucune vague, des rangs qui tombent juste', () => {
    expect(journal.tables).toEqual([...TABLES_DU_JOURNAL_DES_DESIGNATIONS])
    expect(Object.keys(journal.chemins).sort()).toEqual([...TABLES_DU_JOURNAL_DES_DESIGNATIONS].sort())
    expect(journal.vagues).toEqual([])
    expect(TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES.filter((a) => TABLES_DU_JOURNAL_DES_DESIGNATIONS.includes(a.table))).toEqual([])
    // `exercices_valides` recule d'autant de rangs qu'il entre de tables, et la table prend l'avant-dernier rang.
    expect(journal.decalage).toBe(journal.tables.length)
    expect(journal.retrait).toBe(1)
    expect(journal.conditionne).toBe(true)
  })

  it('le bloc de la caisse a été lu : sa table, son ancre, son chemin, sa vague, les rangs qui suivent reculés', () => {
    expect(caisse.tables).toEqual([...TABLES_DE_LA_CAISSE])
    expect(caisse.ancre).toBe(ORDRE_RESTAURATION_PREVU[ORDRE_RESTAURATION_PREVU.indexOf(TABLES_DE_LA_CAISSE[0]) - 1])
    expect(caisse.chemins).toEqual({ operations_caisse: { acces: 'direct', parent: null, colonne: null } })
    expect(caisse.vagues).toEqual(TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES.filter((a) => TABLES_DE_LA_CAISSE.includes(a.table)))
    expect(caisse.recule).toBe(true)
    expect(caisse.conditionne).toBe(true)
    // Joué après le journal et avant les devis : sa vague suit celles des autres blocs, comme dans la liste du code.
    expect(texteDeLEssai.indexOf(MARQUE_DE_LA_CAISSE)).toBeGreaterThan(texteDeLEssai.indexOf(MARQUE_DU_JOURNAL))
    expect(texteDeLEssai.indexOf(MARQUE_DE_LA_CAISSE)).toBeLessThan(texteDeLEssai.indexOf(MARQUE_DES_DEVIS))
  })

  it('le bloc de l’adresse d’un accès retiré a été lu : sa table, après la trace, conditionné, son chemin (P1T-E2)', () => {
    expect(adressesRetirees).toEqual({
      ancre: 'trace_des_droits', tables: [...TABLES_DES_ADRESSES_DES_ACCES_RETIRES], recule: true, conditionne: true,
      chemins: { adresses_des_acces_retires: { acces: 'direct', parent: null, colonne: null } },
    })
    expect(ORDRE_RESTAURATION_PREVU[ORDRE_RESTAURATION_PREVU.indexOf(TABLES_DES_ADRESSES_DES_ACCES_RETIRES[0]) - 1]).toBe('trace_des_droits')
    expect(texteDeLEssai.indexOf(MARQUE_DES_ADRESSES_RETIREES)).toBeGreaterThan(texteDeLEssai.indexOf(MARQUE_DE_LA_TRACE))
    expect(texteDeLEssai.indexOf(MARQUE_DES_ADRESSES_RETIREES)).toBeLessThan(texteDeLEssai.indexOf(MARQUE_DES_DEVIS))
  })

  it('le bloc de la trace des droits a été lu : sa table, son ancre, son chemin, les rangs qui suivent reculés', () => {
    expect(trace.tables).toEqual([...TABLES_DE_LA_TRACE_DES_DROITS])
    // Les situations publiées (étape C4a), jouées après elle sur la même ancre, s'intercalent : l'ancre se lit sans elles.
    const sansLesSituations = ORDRE_RESTAURATION_PREVU.filter((t) => !TABLES_DES_SITUATIONS_PUBLIEES.includes(t))
    expect(trace.ancre).toBe(sansLesSituations[sansLesSituations.indexOf(TABLES_DE_LA_TRACE_DES_DROITS[0]) - 1])
    expect(trace.chemins).toEqual({ trace_des_droits: { acces: 'direct', parent: null, colonne: null } })
    expect(trace.recule).toBe(true)
    expect(trace.conditionne).toBe(true)
    expect(texteDeLEssai.indexOf(MARQUE_DE_LA_TRACE)).toBeGreaterThan(texteDeLEssai.indexOf(MARQUE_DE_LA_CAISSE))
    expect(texteDeLEssai.indexOf(MARQUE_DE_LA_TRACE)).toBeLessThan(texteDeLEssai.indexOf(MARQUE_DES_DEVIS))
  })

  it('le bloc des paramètres des cotisations : ses deux tables après les désignations, conditionnées, après le bloc des saisies', () => {
    expect(parametresDesCotisations.ancre).toBe('designations_des_pieces')
    expect(parametresDesCotisations.tables).toEqual(['debuts_d_activite', 'parametres_des_cotisations'])
    expect(parametresDesCotisations.recule).toBe(true)
    expect(parametresDesCotisations.conditionne).toBe(true)
    expect(texteDeLEssai.indexOf(MARQUE_DES_PARAMETRES_DES_COTISATIONS)).toBeGreaterThan(texteDeLEssai.indexOf(MARQUE_DES_SAISIES_2035))
  })

  it('le bloc des factures reprises a été lu : ses tables, son ancre, leurs chemins, les rangs qui suivent reculés', () => {
    expect(reprises.tables).toEqual([...TABLES_DES_FACTURES_IMPORTEES])
    expect(reprises.ancre).toBe(ORDRE_RESTAURATION_PREVU[ORDRE_RESTAURATION_PREVU.indexOf(TABLES_DES_FACTURES_IMPORTEES[0]) - 1])
    expect(reprises.chemins).toEqual({
      imports_factures: { acces: 'direct', parent: null, colonne: null },
      factures_importees: { acces: 'direct', parent: null, colonne: null },
    })
    expect(reprises.recule).toBe(true)
    expect(reprises.conditionne).toBe(true)
    // Joué en dernier, avant la création des tables d'essai.
    expect(texteDeLEssai.indexOf(MARQUE_DES_FACTURES_REPRISES)).toBeGreaterThan(texteDeLEssai.indexOf(MARQUE_DES_DEVIS))
    expect(texteDeLEssai.indexOf(MARQUE_DES_FACTURES_REPRISES))
      .toBeLessThan(indiceSql(texteDeLEssai, "execute format('create table essai_restauration.%I (like public.%I"))
  })

  it('le bloc de la numérotation qui continue a été lu : ses tables, son ancre, leurs chemins, les rangs qui suivent reculés', () => {
    expect(numerotation.tables).toEqual([...TABLES_DE_LA_NUMEROTATION_CONTINUE])
    expect(numerotation.ancre).toBe(TABLES_DES_FACTURES_IMPORTEES[TABLES_DES_FACTURES_IMPORTEES.length - 1])
    expect(numerotation.ancre).toBe(ORDRE_RESTAURATION_PREVU[ORDRE_RESTAURATION_PREVU.indexOf(TABLES_DE_LA_NUMEROTATION_CONTINUE[0]) - 1])
    expect(numerotation.chemins).toEqual({
      modeles_numerotation: { acces: 'direct', parent: null, colonne: null },
      continuite_des_series: { acces: 'direct', parent: null, colonne: null },
    })
    expect(numerotation.recule).toBe(true)
    expect(numerotation.conditionne).toBe(true)
    // Joué après le bloc des factures reprises, avant la création des tables d'essai.
    expect(texteDeLEssai.indexOf(MARQUE_DE_LA_NUMEROTATION)).toBeGreaterThan(texteDeLEssai.indexOf(MARQUE_DES_FACTURES_REPRISES))
    expect(texteDeLEssai.indexOf(MARQUE_DE_LA_NUMEROTATION))
      .toBeLessThan(indiceSql(texteDeLEssai, "execute format('create table essai_restauration.%I (like public.%I"))
  })

  it('avec les tables des huit blocs, le script joue le plan PRÉVU du code — quels que soient les drapeaux', () => {
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
      && !TABLES_DES_PARAMETRES_FACTURATION.includes(t) && !TABLES_DU_JOURNAL_DES_DESIGNATIONS.includes(t)
      && !TABLES_DE_LA_CAISSE.includes(t) && !TABLES_DE_LA_TRACE_DES_DROITS.includes(t) && !TABLES_DES_SITUATIONS_PUBLIEES.includes(t)
      && !TABLES_DES_ADRESSES_DES_ACCES_RETIRES.includes(t)
      && !TABLES_DES_SAISIES_2035.includes(t) && !TABLES_DES_PARAMETRES_DES_COTISATIONS.includes(t)
      && !TABLES_DES_FACTURES_IMPORTEES.includes(t) && !TABLES_DE_LA_NUMEROTATION_CONTINUE.includes(t)
      && !TABLES_DE_LA_PIECE_D_UNE_FACTURE_REPRISE.includes(t) && !TABLES_DES_COMPTES_BANCAIRES.includes(t)
      && !TABLES_DES_LETTRES_DE_MISSION.includes(t) && !TABLES_DES_ORIGINAUX_LIBERES.includes(t) && !(TABLES_DES_COPIES_DES_FICHIERS as readonly string[]).includes(t) && !TABLES_DES_HONORAIRES_FACTURES.includes(t)
      && !TABLES_DES_HONORAIRES_DEPOSES.includes(t) && !(TABLES_DES_DOCUMENTS_ET_DEMANDES as readonly string[]).includes(t)
      && !(TABLES_DES_ACHATS_DU_CLIENT as readonly string[]).includes(t)
      && !(TABLES_DES_NOTES_DE_FRAIS as readonly string[]).includes(t)
      && !(TABLES_DES_SAISIES_2035E as readonly string[]).includes(t)
      && !(TABLES_DES_STOCKS as readonly string[]).includes(t)
      && !(TABLES_DU_MODELE_DU_CABINET as readonly string[]).includes(t)
      && !(TABLES_DE_L_INVENTAIRE as readonly string[]).includes(t)
      && !(TABLES_DES_EXERCICES as readonly string[]).includes(t)
      && !(TABLES_DE_L_AFFECTATION as readonly string[]).includes(t)
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

    it('les paramètres de facturation sans leur chemin, sans leur vague, mal placés, joués sans leur table, ou leur bloc oublié', () => {
      expect(remplacerDevis("\n     ('parametres_facturation','direct',null,null);", '').join('\n')).toContain('_chemins : parametres_facturation manque')
      expect(remplacerDevis("\n     ('parametres_facturation','remplace_id');", '').join('\n')).toContain('_vagues vaut')
      const ancre = "select o.rang - 1, 'parametres_facturation' from essai_restauration._ordre o where o.table_nom = 'exercices_valides';"
      expect(blocDesParametres(texteDeLEssai.replace(ancre, ancre.replace('rang - 1', 'rang - 2'))).retrait).not.toBe(1)
      const marque = texteDeLEssai.indexOf(MARQUE_DES_PARAMETRES)
      const decale = texteDeLEssai.slice(0, marque) + texteDeLEssai.slice(marque).replace('set rang = rang + 1 where', 'set rang = rang + 2 where')
      expect(blocDesParametres(decale).decalage).not.toBe(1)
      expect(blocDesParametres(texteDeLEssai.replace("if to_regclass('public.parametres_facturation') is not null then", 'if true then'))
        .conditionne).toBe(false)
      const sansLeBloc = texteDeLEssai.slice(0, marque) + texteDeLEssai.slice(texteDeLEssai.indexOf('end $$;', marque) + 'end $$;'.length)
      expect(ecartsAuCode(avecLesBlocs(sansLeBloc), ORDRE_RESTAURATION_PREVU, CHEMINS_DOSSIER_PREVUS, TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES)
        .join('\n')).toContain('manquantes : parametres_facturation')
    })

    it('le journal des désignations sans son chemin, mal placé, joué sans sa table, ou son bloc oublié', () => {
      expect(remplacerDevis("\n     ('designations_des_pieces','direct',null,null);", '').join('\n'))
        .toContain('_chemins : designations_des_pieces manque')
      const ancre = "select o.rang - 1, 'designations_des_pieces' from essai_restauration._ordre o where o.table_nom = 'exercices_valides';"
      expect(blocDuJournal(texteDeLEssai.replace(ancre, ancre.replace('rang - 1', 'rang - 2'))).retrait).not.toBe(1)
      const marque = texteDeLEssai.indexOf(MARQUE_DU_JOURNAL)
      const decale = texteDeLEssai.slice(0, marque) + texteDeLEssai.slice(marque).replace('set rang = rang + 1 where', 'set rang = rang + 2 where')
      expect(blocDuJournal(decale).decalage).not.toBe(1)
      expect(blocDuJournal(texteDeLEssai.replace("if to_regclass('public.designations_des_pieces') is not null then", 'if true then'))
        .conditionne).toBe(false)
      const sansLeBloc = texteDeLEssai.slice(0, marque) + texteDeLEssai.slice(texteDeLEssai.indexOf('end $$;', marque) + 'end $$;'.length)
      expect(ecartsAuCode(avecLesBlocs(sansLeBloc), ORDRE_RESTAURATION_PREVU, CHEMINS_DOSSIER_PREVUS, TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES)
        .join('\n')).toContain('manquantes : designations_des_pieces')
    })

    it('un décalage ou un rang de départ qui ne tombent pas juste', () => {
      const decale = blocDesDevis(texteDeLEssai.replace('set rang = -(rang + 3) where rang > v_rang;', 'set rang = -(rang + 2) where rang > v_rang;'))
      expect(decale.decalage).not.toBe(decale.tables.length)
      // Ancrés ailleurs — après le journal des désignations, comme avant l'étape P6c1 —, le journal des e-mails les précède.
      const ancre = texteDeLEssai.replace("where o.table_nom = 'documents_divers';", "where o.table_nom = 'designations_des_pieces';")
      expect(blocDesDevis(ancre).ancre).not.toBe(ORDRE_RESTAURATION_PREVU[ORDRE_RESTAURATION_PREVU.indexOf('devis_numerotation') - 1])
      expect(ecartsAuCode(avecLesBlocs(ancre), ORDRE_RESTAURATION_PREVU, CHEMINS_DOSSIER_PREVUS, TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES)
        .join('\n')).toContain('premier écart')
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
  const recopie = indiceSql(texte, "execute format('alter table essai_restauration.%I add constraint %I %s'")
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
  if (!/create table essai_restauration\.%I \(like public\.%I [^)]*\bincluding generated\)/i.test(texte)) {
    fautes.push('les tables d’essai ne portent pas la génération (`including generated`)')
  }
  const debutListe = indiceSql(texte, 'create function essai_restauration._colonnes(')
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
