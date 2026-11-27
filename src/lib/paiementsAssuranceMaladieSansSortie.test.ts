import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// LE MODULE QUI LIT UN RETOUR DE L'ASSURANCE MALADIE N'A AUCUNE SORTIE (conception 53, §3 : « le module de lecture est pur :
// ni supabase, ni fetch, ni stockage, ni console, ni horloge »). Le fichier d'un praticien porte des données de santé ; il
// se lit dans le navigateur, et seuls des agrégats en sortent, par le RETOUR des fonctions. Ce relevé lit le texte du module,
// commentaires ôtés : une sortie (le réseau, un journal, le stockage du navigateur, l'horloge, un import dynamique) ou un
// import d'un autre module que `./csv` (les types exceptés) est une faute. Éprouvé par trois défauts plantés.
//
// ET AUCUN MOTEUR NE LIT LES DEUX TABLES — NI LA TRACE DE LEURS REMPLACEMENTS (NOE4R-Q2, préparée) — (conception 53, §8 : la
// recette entrerait deux fois) : leurs noms ne paraissent dans
// `src/` que là où la liste ci-dessous le dit, chaque fichier sous sa raison ; un lecteur nouveau se range ici, sa raison
// avec lui, ou il est une faute. Le plancher : les fichiers de la liste existent et nomment bien une des tables. Le même
// relevé pour les quatre tables du FACTURÉ (conception 59, § 5.1, BOR3) : le facturé n'est pas une recette, aucun moteur ne
// le lit ; le registre des lots et la clé du dossier, aucun écran non plus (aucune policy ne les ouvre).

const MODULE = 'src/lib/paiementsAssuranceMaladie.ts'
const IMPORTS_PERMIS = new Set(['./csv'])
// Le rangement de l'état des paiements (le lecteur du PDF, première partie) : il reçoit ce qu'un gabarit lira d'une page, et
// n'importe que le module de lecture et la liste des régimes.
const MODULE_DE_L_ETAT = 'src/lib/etatDesPaiementsAssuranceMaladie.ts'
const IMPORTS_PERMIS_DE_L_ETAT = new Set(['./paiementsAssuranceMaladie', './regimesAssuranceMaladie'])

const sansCommentaires = (texte: string) => texte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

const SORTIES: readonly [string, RegExp][] = [
  ['le client de la base', /supabase/i],
  ['le réseau', /\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon/],
  ['un journal', /\bconsole\s*\./],
  ['le stockage du navigateur', /localStorage|sessionStorage|indexedDB|document\.cookie|caches\./],
  ['l’horloge', /\bDate\b|performance\.now|\bsetTimeout\b|\bsetInterval\b/],
  ['un import dynamique', /\bimport\s*\(/],
  ['une Edge Function ou le modèle', /functions\.invoke|\binvoke\s*\(|bedrock/i],
  ['la fenêtre', /\bwindow\s*\.|\bnavigator\s*\.|\bpostMessage\b/],
]

/** Les fautes d'un texte de module : une sortie, ou un import hors de la liste (les imports de type exceptés). */
export function fautesDeSortie(texte: string, permis: ReadonlySet<string> = IMPORTS_PERMIS): string[] {
  const code = sansCommentaires(texte)
  const fautes = SORTIES.filter(([, motif]) => motif.test(code)).map(([nom]) => nom)
  for (const m of code.matchAll(/^\s*import\s+(type\s+)?[\s\S]*?\sfrom\s+'([^']+)'/gm)) {
    if (!m[1] && !permis.has(m[2])) fautes.push(`l’import de ${m[2]}`)
  }
  return fautes
}

describe('le module de lecture n’a aucune sortie', () => {
  const texte = readFileSync(resolve(process.cwd(), MODULE), 'utf8')

  it('aucune sortie, et `./csv` seul importé', () => {
    expect(fautesDeSortie(texte)).toEqual([])
    expect(texte).toContain('from \'./csv\'')
  })

  it('trois défauts plantés se voient : un journal d’une cellule, le client de la base, l’horloge', () => {
    const journal = texte.replace('for (const { ligne, cellules } of lignes) {', 'for (const { ligne, cellules } of lignes) {\n    console.log(cellules)')
    expect(journal).not.toBe(texte)
    expect(fautesDeSortie(journal)).toEqual(['un journal'])
    expect(fautesDeSortie(`import { supabase } from './supabase'\n${texte}`)).toEqual(['le client de la base', 'l’import de ./supabase'])
    expect(fautesDeSortie(texte.replace('const bissextile =', 'const aujourdHui = new Date()\n  const bissextile ='))).toEqual(['l’horloge'])
  })
})

describe('le rangement de l’état des paiements n’a aucune sortie', () => {
  const texte = readFileSync(resolve(process.cwd(), MODULE_DE_L_ETAT), 'utf8')

  it('aucune sortie, et les deux modules permis seuls importés', () => {
    expect(fautesDeSortie(texte, IMPORTS_PERMIS_DE_L_ETAT)).toEqual([])
    expect(texte).toContain('from \'./paiementsAssuranceMaladie\'')
  })

  it('trois défauts plantés se voient : un journal d’une ligne, le client de la base, l’horloge', () => {
    const ancre = 'for (const l of e.lignes) {\n    const m = l.montant_centimes'
    expect(texte).toContain(ancre)
    expect(fautesDeSortie(texte.replace(ancre, `${ancre}\n    console.log(l)`), IMPORTS_PERMIS_DE_L_ETAT)).toEqual(['un journal'])
    expect(fautesDeSortie(`import { supabase } from './supabase'\n${texte}`, IMPORTS_PERMIS_DE_L_ETAT))
      .toEqual(['le client de la base', 'l’import de ./supabase'])
    expect(fautesDeSortie(texte.replace('let sansMontant = 0', 'let sansMontant = Date.now()'), IMPORTS_PERMIS_DE_L_ETAT))
      .toEqual(['l’horloge'])
  })
})

// Les fichiers de `src/` qui nomment une des deux tables, chacun sous sa raison.
const LECTEURS_PERMIS: Readonly<Record<string, string>> = {
  'src/lib/paiementsAssuranceMaladie.ts': 'le module de lecture, qui nomme la fonction d’import de la base',
  'src/lib/paiementsAssuranceMaladie.test.ts': 'les essais du module, qui nomment la migration',
  'src/lib/sauvegarde.ts': 'le plan de sauvegarde, derrière le drapeau',
  'src/lib/sauvegardePaiementsAssuranceMaladie.test.ts': 'les essais du plan de sauvegarde',
  'src/lib/sauvegardeAssociationsAssuranceMaladie.test.ts': 'les essais du plan de sauvegarde de l’association (NOE8)',
  'src/lib/restaurationEssai.test.ts': 'la garde de l’essai de restauration',
  'src/lib/types.ts': 'le type des deux tables',
  'src/lib/paiementsAssuranceMaladieLecture.ts': 'la lecture de l’écran d’import (NOE4), qui montre et ne calcule rien',
  'src/lib/paiementsAssuranceMaladieLecture.test.ts': 'les essais de cette lecture',
  'src/components/PaiementsAssuranceMaladie.tsx': 'l’écran d’import (NOE4), qui appelle la fonction d’import et celle du retrait',
  'src/components/PaiementsAssuranceMaladie.test.tsx': 'les essais de l’écran d’import',
  'src/lib/rapprochementAssuranceMaladie.ts': 'le rapprochement (NOE5), qui propose et contrôle sans rien compter (conception 53, § 8), et nomme sa migration',
  'src/lib/rapprochementAssuranceMaladie.test.ts': 'les essais du rapprochement, qui relisent les mots de sa migration',
  'src/pages/dossier/BanqueTab.tsx': 'l’onglet Banque (NOE5b), qui appelle les deux fonctions de l’association, au cabinet seul ; '
    + 'il ne compte rien des paiements : la fiche et la section les montrent, les candidats d’une vente écartent un crédit associé',
  'src/pages/dossier/BanqueTab.assuranceMaladie.test.tsx': 'les essais de l’association dans l’onglet Banque',
  'src/lib/optionsDesCabinetsLecture.ts': 'l’écran des modules des cabinets (OPT4), qui lit le seul dossier des associations pour '
    + 'dire avant le clic la fermeture de l’assurance maladie que la base refuserait ; aucun montant, rien de compté',
  'src/lib/optionsDuCabinetVue.test.ts': 'les essais de l’écran des modules, qui confrontent cette lecture au critère de la migration',
  'src/pages/OptionsDesCabinets.test.tsx': 'les essais de l’écran des modules, dont le faux client rend les associations',
  'src/pages/dossier/RevisionTab.test.tsx': 'les essais de la Révision (NOE6), dont le faux client REFUSE chacune des trois tables : '
    + 'leurs points se taisent seuls, la révision demeure',
  // La trace des remplacements (NOE4R-Q2, préparée) : la même règle, ses lecteurs nommés.
  'src/lib/remplacementDesJourneesAssuranceMaladie.ts': 'le module du remplacement d’une journée (NOE4R-Q2), qui redit les refus de sa '
    + 'fonction et dit ce que l’écran nomme ; il ne compte rien des paiements dans aucun moteur, et nomme sa table pour le plan',
  'src/lib/remplacementDesJourneesAssuranceMaladie.test.ts': 'les essais du module du remplacement, qui relisent les mots de sa migration',
  'src/lib/sauvegardeRemplacementsAssuranceMaladie.test.ts': 'les essais du plan de sauvegarde de la trace des remplacements',
  'src/lib/creationsDansLesBlocs.test.ts': 'le relevé des créations dans les blocs, qui compte la restrictive de la trace des remplacements',
  'src/lib/essaisEnProduction.test.ts': 'le classement des essais de la base, qui nomme les migrations de NOE4R-Q1 et NOE4R-Q2 (le nom de la '
    + 'première porte celui de la table des imports)',
  'src/lib/gardesDeSuppressionAttendues.test.ts': 'le relevé des gardes de suppression que le contrôle 141 de validationExercice.sql '
    + 'attend, qui nomme la garde de la trace des remplacements dans son défaut planté ; il ne lit aucune ligne',
}

function fichiers(dossier: string): string[] {
  return readdirSync(dossier).flatMap((nom) => {
    const chemin = join(dossier, nom)
    return statSync(chemin).isDirectory() ? fichiers(chemin) : /\.(ts|tsx)$/.test(nom) ? [chemin] : []
  })
}

describe('aucun moteur ne lit les tables des paiements de l’assurance maladie', () => {
  const racine = process.cwd()
  const nommant = fichiers(resolve(racine, 'src'))
    .filter((f) => /(imports|paiements|remplacements)_assurance_maladie/.test(readFileSync(f, 'utf8')))
    .map((f) => relative(racine, f).split('\\').join('/'))
    .sort()

  it('seuls les fichiers de la liste nomment les tables', () => {
    expect(nommant.filter((f) => !(f in LECTEURS_PERMIS))).toEqual([])
  })

  it('le plancher : chaque fichier de la liste existe et nomme une des tables', () => {
    expect(nommant).toEqual(Object.keys(LECTEURS_PERMIS).sort())
  })
})

// Les fichiers de `src/` qui nomment une des quatre tables du facturé (BOR3), chacun sous sa raison.
const LECTEURS_DU_FACTURE_PERMIS: Readonly<Record<string, string>> = {
  'src/lib/importDuFactureAssuranceMaladie.ts': 'le module de l’import, qui nomme la fonction d’import et la migration',
  'src/lib/importDuFactureAssuranceMaladie.test.ts': 'les essais du module, qui nomment la migration',
  'src/lib/sauvegarde.ts': 'le plan de sauvegarde, derrière le drapeau',
  'src/lib/sauvegardeFacturesAssuranceMaladie.test.ts': 'les essais du plan de sauvegarde',
  'src/lib/restaurationEssai.test.ts': 'la garde de l’essai de restauration',
  'src/lib/restaurationInterrompue.ts': 'ce que la restauration dit ne pas porter : le registre et la clé',
  'src/lib/restaurationInterrompue.test.ts': 'les essais de ces mots, qui relisent la migration',
  'src/lib/types.ts': 'le type des imports et des totaux',
  'src/lib/paiementsAssuranceMaladieSansSortie.test.ts': 'ce relevé, qui nomme les tables qu’il cherche',
  'src/lib/factureAssuranceMaladieLecture.ts': 'la lecture de l’écran d’import (BOR4), les imports et leurs totaux, qui montre et ne '
    + 'calcule rien ; ni le registre ni la clé',
  'src/lib/factureAssuranceMaladieLecture.test.ts': 'les essais de cette lecture',
  'src/components/FactureAssuranceMaladie.tsx': 'l’écran d’import (BOR4), qui appelle la fonction d’import et celle du retrait',
  'src/components/FactureAssuranceMaladie.test.tsx': 'les essais de l’écran d’import',
}

describe('aucun moteur ne lit les tables du facturé à l’assurance maladie', () => {
  const racine = process.cwd()
  const nommant = fichiers(resolve(racine, 'src'))
    .filter((f) => /factures_assurance_maladie|lots_teletransmission_importes|cles_des_lots_teletransmission/.test(readFileSync(f, 'utf8')))
    .map((f) => relative(racine, f).split('\\').join('/'))
    .sort()

  it('seuls les fichiers de la liste nomment les tables', () => {
    expect(nommant.filter((f) => !(f in LECTEURS_DU_FACTURE_PERMIS))).toEqual([])
  })

  it('le plancher : chaque fichier de la liste existe et nomme une des tables', () => {
    expect(nommant).toEqual(Object.keys(LECTEURS_DU_FACTURE_PERMIS).sort())
  })
})
