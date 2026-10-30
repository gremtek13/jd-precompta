import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { derniereDefinitionSql, fichiersDuSchema } from '../test/schema'
import { REFUS_VENTES_DOSSIER_NON_BASCULE } from './droitsAcces'
import { ORDRE_RESTAURATION } from './sauvegarde'

// « VENTES » NE SE PORTE QUE SUR UN DOSSIER BASCULÉ (chantier EC-Q3, ligne 28.65, étape VF8f, le resserrement ; décision
// EC3-Q2 ; migration `ventes_sur_dossier_bascule`, appliquée le 27/10/2026 sous la version 20261027163348). Une
// garde neuve, `garder_droit_ventes`, APRÈS l'insertion et la mise à jour de `droit_ventes` ou de `dossier_id` de
// `memberships`, refuse en 23514 « Ventes » qui arrive sur un accès d'un dossier dont les factures ne sont pas la source de
// leurs ventes, pour tout auteur, hors de l'insertion du super-administrateur (la restauration) ; elle lit le réglage du
// dossier `for share`. Ce garde la confronte à la décision et à ce qu'elle suppose (les fonctions à leur empreinte dans
// l'export), redit que le refus du module (lib/droitsAcces.ts) est le sien à la lettre, établit les chemins qui écrivent
// `droit_ventes` — aucun ne contourne la garde sans le dire —, et que les essais qui cochent « Ventes » basculent d'abord leur
// dossier. Ce qu'aucun texte ne prouve se joue sur une réplique : les essais entiers avant et après, deux sessions
// concurrentes, la restauration. Récit : HISTORIQUE.md, « « VENTES » NE SE PORTE QUE SUR UN DOSSIER BASCULÉ ». Données
// FICTIVES.

const MIGRATION = /\/\d{14}_ventes_sur_dossier_bascule\.sql$/
const texteDeLaMigration = () => fichiersDuSchema().find((f) => MIGRATION.test(f.chemin))?.texte ?? ''
const RACINE = resolve(process.cwd())
const lire = (chemin: string) => readFileSync(resolve(RACINE, chemin), 'utf8')
const md5 = (texte: string) => createHash('md5').update(texte).digest('hex')

/** Le texte sans ses lignes de commentaire (une ligne entièrement en commentaire, jamais un `--` de fin de ligne). */
const sansCommentaires = (texte: string) => texte.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n')

/** Les instructions du texte, coupées sur les `;` hors des corps `$$ … $$` et des chaînes, espaces resserrés. */
function instructions(texte: string): string[] {
  const out: string[] = []
  let courant = ''
  let dansUnCorps = false
  let dansUneChaine = false
  for (let i = 0; i < texte.length; i++) {
    if (!dansUneChaine && texte.startsWith('$$', i)) {
      dansUnCorps = !dansUnCorps
      courant += '$$'
      i++
      continue
    }
    // Une apostrophe doublée ferme puis rouvre la chaîne : le compte reste juste.
    if (!dansUnCorps && texte[i] === "'") dansUneChaine = !dansUneChaine
    if (texte[i] === ';' && !dansUnCorps && !dansUneChaine) {
      out.push(courant.replace(/\s+/g, ' ').trim())
      courant = ''
      continue
    }
    courant += texte[i]
  }
  if (courant.trim()) out.push(courant.replace(/\s+/g, ' ').trim())
  return out.filter(Boolean)
}

/** Le corps d'une fonction de l'export (entre ses `$$`), tel que la base le garde dans `pg_proc.prosrc`. */
function corpsExporte(nom: string): string {
  const definition = derniereDefinitionSql(nom)
  const ouverture = definition.indexOf('$$')
  return definition.slice(ouverture + 2)
}

const REFUS_SQL = REFUS_VENTES_DOSSIER_NON_BASCULE.message.replace(/'/g, "''")

describe('la migration ventes_sur_dossier_bascule', () => {
  it('est dans l’export, une fois, sous la version de sa ligne d’historique, après celle d’equipe_par_son_role', () => {
    const chemins = fichiersDuSchema().map((f) => f.chemin).filter((c) => MIGRATION.test(c))
    expect(chemins).toEqual(['supabase/schema/20261027163348_ventes_sur_dossier_bascule.sql'])
    expect(chemins[0] > 'supabase/schema/20261027163235_equipe_par_son_role.sql').toBe(true)
  })

  it('n’exécute que sa garde de tête, la garde, son commentaire, le retrait de son exécution, le commentaire de la colonne et le déclencheur', () => {
    const faites = instructions(sansCommentaires(texteDeLaMigration()))
    const tetes = [
      'do $$',
      'create function public.garder_droit_ventes() returns trigger language plpgsql security definer set search_path = public as $$',
      'comment on function public.garder_droit_ventes() is \'',
      'revoke execute on function public.garder_droit_ventes() from public, anon, authenticated',
      'comment on column public.memberships.droit_ventes is \'',
      'create trigger memberships_droit_ventes after insert or update of droit_ventes, dossier_id on public.memberships for each row execute function public.garder_droit_ventes()',
    ]
    expect(faites).toHaveLength(tetes.length)
    faites.forEach((instruction, i) => expect(instruction.startsWith(tetes[i]), instruction.slice(0, 120)).toBe(true))
    expect(faites[3]).toBe(tetes[3])
    expect(faites[5]).toBe(tetes[5])
  })

  it('sa garde de tête : une seconde application, les fonctions et le déclencheur qu’elle suppose, un accès « Ventes » déjà posé', () => {
    const [tete] = instructions(sansCommentaires(texteDeLaMigration()))
    // Une seconde application : la garde ou son déclencheur.
    expect(tete).toContain("if to_regprocedure('public.garder_droit_ventes()') is not null or exists (select 1 from pg_trigger t "
      + "where t.tgrelid = 'public.memberships'::regclass and t.tgname = 'memberships_droit_ventes') then")
    // Les trois fonctions, chacune à l'empreinte de son corps dans l'export, retours chariot écartés : une fonction changée
    // depuis par une migration de l'export ferait tomber ce test avant d'arrêter la migration.
    for (const [nom, signature] of [['garder_ventes_par_les_factures', '()'], ['is_super_admin', '()'],
      ['changer_droits_acces', '(uuid, boolean, boolean)']] as const) {
      const empreinte = md5(corpsExporte(nom).replace(/\r/g, ''))
      expect(tete, nom).toContain(`if to_regprocedure('public.${nom}${signature}') is null or md5(replace((select p.prosrc from pg_proc p `
        + `where p.oid = to_regprocedure('public.${nom}${signature}')), chr(13), '')) <> '${empreinte}' then`)
    }
    // Le déclencheur de la garde du réglage, tel que l'export le pose en dernier : avant l'insertion et la mise à jour des
    // deux colonnes, ligne par ligne (tgtype 23).
    const declencheurs = fichiersDuSchema().flatMap((f) => [...sansCommentaires(f.texte).matchAll(
      /create (?:or replace )?trigger dossiers_ventes_par_les_factures\s+([^;]*);/g)].map((m) => m[1].replace(/\s+/g, ' ')))
    expect(declencheurs.at(-1)).toBe('before insert or update of ventes_par_les_factures, ventes_par_les_factures_depuis '
      + 'on public.dossiers for each row execute function public.garder_ventes_par_les_factures()')
    expect(tete).toContain("and t.tgfoid = 'public.garder_ventes_par_les_factures()'::regprocedure and t.tgtype = 23 and t.tgenabled = 'O'")
    expect(tete).toContain("= 'ventes_par_les_factures,ventes_par_les_factures_depuis') <> 1 then")
    // Un accès « Ventes » sur un dossier qui n'a pas basculé : le choix revient au cabinet, jamais une case retirée.
    expect(tete).toContain('from public.memberships m join public.dossiers d on d.id = m.dossier_id '
      + 'where m.droit_ventes and not d.ventes_par_les_factures')
    expect(tete).toContain('if v_n > 0 then')
    expect(tete.match(/raise exception/g)).toHaveLength(6)
  })

  it('sa garde : « Ventes » qui arrive, l’insertion du super-administrateur exceptée, le réglage lu for share, le refus du module', () => {
    const definition = derniereDefinitionSql('garder_droit_ventes')
    expect(definition.replace(/\s+/g, ' ')).toContain('returns trigger language plpgsql security definer set search_path = public as $$')
    const code = sansCommentaires(corpsExporte('garder_droit_ventes')).split('\n').map((l) => l.trim()).filter(Boolean)
    expect(code).toEqual([
      'declare',
      'v_bascule boolean;',
      'begin',
      'if not new.droit_ventes then',
      'return null;',
      'end if;',
      "if tg_op = 'UPDATE' and old.droit_ventes and new.dossier_id = old.dossier_id then",
      'return null;',
      'end if;',
      "if tg_op = 'INSERT' and public.is_super_admin() then",
      'return null;',
      'end if;',
      'select d.ventes_par_les_factures into v_bascule from public.dossiers d where d.id = new.dossier_id for share;',
      'if v_bascule is not true then',
      `raise exception '${REFUS_SQL}'`,
      `using errcode = '${REFUS_VENTES_DOSSIER_NON_BASCULE.code}';`,
      'end if;',
      'return null;',
      'end',
    ])
  })

  it('rien que le détecteur de l’outil retienne ; ni table, ni colonne, ni policy, ni droit accordé, ni donnée', () => {
    const texte = texteDeLaMigration()
    const code = sansCommentaires(texte)
    // Ni dans le code ni dans un commentaire : le détecteur d'`apply_migration` lit tout le texte.
    for (const mot of ['drop', 'delete', 'truncate']) expect(texte.toLowerCase()).not.toContain(mot)
    expect(texte).not.toContain('\\')
    expect(texte).not.toContain('\r')
    for (const motif of [/\bcreate\s+table\b/i, /\balter\b/i, /\binsert\s+into\b/i, /\bupdate\s+(public\.)?\w+\s+set\b/i,
      /\bpolicy\b/i, /\bgrant\b/i]) {
      expect(code, String(motif)).not.toMatch(motif)
    }
  })

  it('le commentaire de la colonne garde ce que l’écran dit du droit, et nomme la garde', () => {
    const commentaire = /comment on column public\.memberships\.droit_ventes is\s+'((?:[^']|'')*)'/.exec(texteDeLaMigration())?.[1] ?? ''
    expect(commentaire).toContain('Le droit « Ventes » de cet accès (devis, factures, facture électronique)')
    expect(commentaire).toContain('(garder_droit_ventes, étape VF8f), hors de la restauration du super-administrateur.')
  })

  it('le refus du module est celui de la base, à la lettre, et celui que ses essais attendent', () => {
    expect(REFUS_VENTES_DOSSIER_NON_BASCULE.code).toBe('23514')
    expect(texteDeLaMigration()).toContain(`raise exception '${REFUS_SQL}'\n      using errcode = '23514';`)
    expect(lire('supabase/essais/droitsAcces.sql')).toContain(`refus_ventes text := '${REFUS_SQL}';`)
    expect(lire('supabase/essais/rls.sql')).toContain(`raison text := '${REFUS_SQL}';`)
  })
})

// ── Les chemins qui posent ou changent `droit_ventes` ────────────────────────────────────────────────────────────────

/** Tous les fichiers sources sous un dossier, hors des tests et de leurs fabriques. */
function sources(dossier: string, extensions: RegExp): string[] {
  const out: string[] = []
  // Triés : l'ordre d'un répertoire n'est pas celui des noms, et l'inventaire se compare tel quel.
  for (const nom of readdirSync(resolve(RACINE, dossier)).sort()) {
    const chemin = `${dossier}/${nom}`
    if (statSync(resolve(RACINE, chemin)).isDirectory()) {
      if (chemin !== 'src/test') out.push(...sources(chemin, extensions))
    } else if (extensions.test(nom) && !/\.test\.tsx?$/.test(nom)) out.push(chemin)
  }
  return out
}

/** L'argument d'un appel ouvert en `i` (la parenthèse), parenthèses et accolades appariées. */
function argument(texte: string, i: number): string {
  let profondeur = 0
  for (let k = i; k < texte.length; k++) {
    if (texte[k] === '(' || texte[k] === '{') profondeur++
    else if (texte[k] === ')' || texte[k] === '}') {
      profondeur--
      if (profondeur === 0) return texte.slice(i + 1, k)
    }
  }
  return ''
}

interface Acces { fichier: string; operation: string; argument: string }

/** Chaque `.from('memberships')` d'un fichier et la PREMIÈRE méthode qui suit : l'opération. */
function accesAuxAcces(fichiers: string[]): Acces[] {
  const trouves: Acces[] = []
  for (const fichier of fichiers) {
    const texte = lire(fichier)
    for (const m of texte.matchAll(/\.from\(\s*['"]memberships['"]\s*\)\s*\.(\w+)\(/g)) {
      const ouvrante = (m.index as number) + m[0].length - 1
      trouves.push({ fichier, operation: m[1], argument: argument(texte, ouvrante).trim() })
    }
    // Une forme que le motif ne lit pas est une faute : sans cela, une écriture écrite autrement passerait inaperçue.
    const tous = [...texte.matchAll(/\.from\(\s*['"]memberships['"]\s*\)/g)].length
    expect(trouves.filter((t) => t.fichier === fichier), `${fichier} : un accès à memberships d'une forme inconnue`).toHaveLength(tous)
  }
  return trouves
}

const ECRITURES = new Set(['insert', 'update', 'upsert', 'delete'])

describe('les chemins qui posent ou changent droit_ventes', () => {
  it('l’application : changer_droits_acces depuis l’onglet Accès, le retrait d’un accès, et rien d’autre de nommé', () => {
    const acces = accesAuxAcces(sources('src', /\.tsx?$/))
    // Un plancher : sans lui, un balayage devenu aveugle rendrait « aucune écriture » sur un dépôt qui en porte.
    expect(acces.filter((a) => a.operation === 'select').length).toBeGreaterThanOrEqual(7)
    expect(acces.filter((a) => ECRITURES.has(a.operation)).map((a) => `${a.fichier} ${a.operation}`))
      .toEqual(['src/pages/dossier/AccesTab.tsx delete'])
    expect(acces.every((a) => a.operation === 'select' || ECRITURES.has(a.operation))).toBe(true)
    const appels = sources('src', /\.tsx?$/).filter((f) => /\.rpc\(\s*['"]changer_droits_acces['"]/.test(lire(f)))
    expect(appels).toEqual(['src/pages/dossier/AccesTab.tsx'])
  })

  it('la restauration : une insertion du super-administrateur, le dossier avant ses accès', () => {
    // `restaurerSauvegarde` insère chaque table par `supabase.from(table).insert(lot)` — jamais une mise à jour de
    // `memberships` (sa seconde passe ne repose que des liens auto-référencés) — et son écran n'est monté que sur la page
    // du super-administrateur : l'insertion que la garde laisse passer.
    const donnees = lire('src/lib/sauvegardeDonnees.ts')
    expect(donnees).toContain('const { error } = await supabase.from(table).insert(lot)')
    expect(ORDRE_RESTAURATION.indexOf('dossiers')).toBeGreaterThanOrEqual(0)
    expect(ORDRE_RESTAURATION.indexOf('memberships')).toBeGreaterThan(ORDRE_RESTAURATION.indexOf('dossiers'))
    const montes = sources('src', /\.tsx$/).filter((f) => /<RestaurationCard\b/.test(lire(f)))
    expect(montes).toEqual(['src/pages/SuperAdminPage.tsx'])
  })

  it('les Edge Functions : une seule écriture, l’insertion de create-client-access, qui ne nomme aucun droit', () => {
    const fichiers = readdirSync(resolve(RACINE, 'supabase/functions'))
      .filter((d) => statSync(resolve(RACINE, 'supabase/functions', d)).isDirectory())
      .sort()
      .map((d) => `supabase/functions/${d}/index.ts`)
    const acces = accesAuxAcces(fichiers)
    expect(acces.filter((a) => a.operation === 'select').length).toBeGreaterThanOrEqual(4)
    const ecritures = acces.filter((a) => ECRITURES.has(a.operation))
    expect(ecritures.map((a) => `${a.fichier} ${a.operation} ${a.argument.replace(/\s+/g, ' ')}`)).toEqual([
      'supabase/functions/create-client-access/index.ts insert { user_id: clientUserId, dossier_id: dossierId, role: "client", email }',
    ])
  })

  it('en base : parmi les fonctions de l’export, seule changer_droits_acces écrit memberships', () => {
    const ecrivent = fichiersDuSchema().flatMap((f) => [...sansCommentaires(f.texte).matchAll(
      /\b(?:insert\s+into|update)\s+(?:public\.)?memberships\b/gi)].map(() => f.chemin))
    expect(ecrivent).toEqual(['supabase/schema/20261009224031_droits_des_acces_clients.sql'])
    expect(derniereDefinitionSql('changer_droits_acces')).toContain('update public.memberships m')
  })
})

// ── Les essais ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** Une écriture de `droit_ventes` dans un essai : un `set`, une insertion qui le nomme, la fonction qui le coche. */
const ECRIT_VENTES = [
  /\bset\s+(?:[a-z_]+\s*=[^;]*?,\s*)?droit_ventes\s*=/i,
  /changer_droits_acces\s*\([^;)]*?,\s*(?:true|[a-z_.]+)\s*,/i,
  /insert\s+into\s+(?:public\.)?memberships\s*\([^)]*\bdroit_ventes\b/i,
  /\bdroit_ventes\s*=\s*true\b/i,
]
/** Un dossier basculé par l'essai : le réglage posé, ou un dossier inséré qui le nomme. */
const BASCULE = [
  /\bset\s+ventes_par_les_factures\s*=\s*true\b/i,
  /insert\s+into\s+(?:public\.)?dossiers\s*\([^)]*\bventes_par_les_factures\b/i,
]

describe('les essais qui cochent « Ventes »', () => {
  it('chacun bascule aussi un dossier — la liste, au nom près', () => {
    const essais = readdirSync(resolve(RACINE, 'supabase/essais')).filter((n) => /\.(sql|mjs|py)$/.test(n)).sort()
    const ecrivent = essais.filter((n) => ECRIT_VENTES.some((m) => m.test(lire(`supabase/essais/${n}`))))
    // caisse.sql depuis l'étape C6 de la caisse : le client de l'essai porte « Ventes » et « Banque » sur S6, un dossier qu'il
    // insère basculé.
    expect(ecrivent).toEqual([
      'articles.sql', 'banqueClient.sql', 'batterieEncaissements.mjs', 'caisse.sql', 'contacts.sql', 'dernierChangementDeRib.sql', 'devis.sql',
      'dossiersAuRibAConfirmer.sql', 'droitsAcces.sql', 'ecrituresVentesFacturees.sql', 'etatFactureElectronique.sql',
      'exemplairesDesFactures.sql', 'ibanHorsDesParametres.sql', 'importContacts.sql', 'logoDesFactures.sql', 'logoDesFacturesSuppression.sql',
      'mentionsFigees.sql', 'parametresFacturation.sql', 'piecesJointesEcartees.sql', 'rls.sql', 'simulationDesVentesFacturees.sql',
      'ventesClient.sql', 'ventesFacturees.sql',
    ])
    for (const n of ecrivent) expect(BASCULE.some((m) => m.test(lire(`supabase/essais/${n}`))), n).toBe(true)
  })

  it('droitsAcces.sql joue la garde : les contrôles 70 à 83 et les mutations 90 à 95, « rien n’est resté » compte les bascules', () => {
    const essai = lire('supabase/essais/droitsAcces.sql')
    for (let n = 70; n <= 81; n++) expect(essai, String(n)).toContain(`('${n}', '`)
    expect(essai).toContain("'controle', '82. un accès « Ventes » restauré sur un dossier qui n''a pas basculé")
    expect(essai).toContain("'controle', '83. la garde : security definer, chemin fixé")
    for (let n = 90; n <= 95; n++) expect(essai, String(n)).toContain(`('${n}', 'le contrôle `)
    expect(essai).toContain('select count(*), count(*) filter (where d.ventes_par_les_factures) into dossiers_avant, bascules_avant from dossiers d;')
  })

  it('rls.sql rejoue la garde (bloc VS), et l’attend tant que la migration manque', () => {
    const rls = lire('supabase/essais/rls.sql')
    const debut = rls.indexOf('-- ══ VS. « Ventes » ne se porte que sur un dossier basculé')
    expect(debut).toBeGreaterThan(0)
    const bloc = rls.slice(debut, rls.indexOf('end $$;', debut))
    expect(bloc).toContain("if to_regprocedure('public.garder_droit_ventes()') is null then")
    expect(bloc).toContain('EN ATTENTE de la migration ventes_sur_dossier_bascule')
    for (const controle of ['VS1. ', 'VS2. ', 'VS3. ']) expect(bloc).toContain(`'controle', '${controle}`)
    for (const mutation of ['M-VS1', 'M-VS2']) expect(bloc).toContain(`'mutation', '${mutation} — `)
  })

  it('restauration.sql : l’accès « Ventes » réinséré par le super-administrateur, son dossier avant lui, au même réglage', () => {
    expect(lire('supabase/essais/restauration.sql'))
      .toContain("'memberships.droit_ventes : chaque accès « Ventes » restauré le portant, son dossier avant lui, au même réglage'")
  })
})
