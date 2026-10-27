import { readdirSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fichiersDuSchema } from '../test/schema'
import { CHEMINS_DOSSIER_PREVUS } from './sauvegarde'

// L'ÉQUIPE NE CHANGE QUE PAR SON RÔLE (23Q2Q2-Q3, tranchée par le cabinet le 26/10/2026 à la recommandation ; migration
// `equipe_par_son_role`, PRÉPARÉE sous la version provisoire 20261027150000, pas appliquée). La policy de mise à jour de
// `cabinet_admins` ne juge que le cabinet, avant et après : tant qu'`authenticated` portait UPDATE sur la table entière, un
// chef changeait le COMPTE d'une ligne de son équipe — pour celui d'un client de ses dossiers — sans passer par
// `create-team-member`. La migration retire le droit sur la table et le rend sur la seule colonne `role`. Ce garde la
// confronte à la décision (les deux instructions, rien d'autre, ses deux gardes), et établit qu'aucun chemin qui écrit
// l'équipe ne casse : l'application n'en met à jour que `role` et n'y fait que retirer, les Edge Functions n'y font
// qu'insérer, avec la clé secrète, la sauvegarde d'un dossier ne la porte pas. L'essai (supabase/essais/rls.sql, bloc EQ)
// et la signature du schéma, qui lit désormais les droits par colonne, sont confrontés aussi. Récit : HISTORIQUE.md,
// « L'ÉQUIPE NE CHANGE QUE PAR SON RÔLE ». Données FICTIVES.

const MIGRATION = /\/\d{14}_equipe_par_son_role\.sql$/
const texteDeLaMigration = () => fichiersDuSchema().find((f) => MIGRATION.test(f.chemin))?.texte ?? ''
const RACINE = resolve(process.cwd())
const lire = (chemin: string) => readFileSync(resolve(RACINE, chemin), 'utf8')

const RETRAIT = 'revoke update on table public.cabinet_admins from authenticated;'
const DROIT_SUR_LE_ROLE = 'grant update (role) on table public.cabinet_admins to authenticated;'

/** Le texte sans ses lignes de commentaire (une ligne entièrement en commentaire, jamais un `--` de fin de ligne). */
const sansCommentaires = (texte: string) => texte.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n')

/** Les blocs `do $$ … $$;` du texte, dans l'ordre, et ce qui reste hors d'eux. */
function blocs(texte: string): { blocs: string[]; dehors: string } {
  const trouves: string[] = []
  let dehors = ''
  let i = 0
  for (;;) {
    const debut = texte.indexOf('do $$', i)
    if (debut < 0) break
    // Le corps d'un bloc ne porte aucun `$$` : le premier `$$;` qui suit le ferme.
    const fin = texte.indexOf('$$;', debut + 'do $$'.length)
    dehors += texte.slice(i, debut)
    trouves.push(texte.slice(debut, fin + 3))
    i = fin + 3
  }
  return { blocs: trouves, dehors: dehors + texte.slice(i) }
}

describe('la migration equipe_par_son_role', () => {
  it('est dans l’export, une fois, sous une version provisoire postérieure à la dernière migration appliquée', () => {
    const chemins = fichiersDuSchema().map((f) => f.chemin).filter((c) => MIGRATION.test(c))
    expect(chemins).toHaveLength(1)
    expect(chemins[0] > 'supabase/schema/20261027055337_contre_passation_sur_mouvement_fige.sql').toBe(true)
  })

  it('n’exécute que le retrait du droit sur la table puis le droit sur `role`, entre ses deux gardes', () => {
    const { blocs: trouves, dehors } = blocs(sansCommentaires(texteDeLaMigration()))
    const instructions = dehors.split(';').map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean).map((s) => `${s};`)
    expect(instructions).toEqual([RETRAIT, DROIT_SUR_LE_ROLE])
    expect(trouves).toHaveLength(2)
    const texte = sansCommentaires(texteDeLaMigration())
    // La garde de tête AVANT le retrait, celle de fin APRÈS le droit.
    expect(texte.indexOf(trouves[0])).toBeLessThan(texte.indexOf(RETRAIT))
    expect(texte.indexOf(trouves[1])).toBeGreaterThan(texte.indexOf(DROIT_SUR_LE_ROLE))
  })

  it('sa garde de tête exige l’état d’avant : UPDATE sur la table à authenticated, aucun droit par colonne', () => {
    const [tete] = blocs(sansCommentaires(texteDeLaMigration())).blocs
    expect(tete).toContain("if not has_table_privilege('authenticated', 'public.cabinet_admins', 'UPDATE') then")
    // Un droit par colonne se lit à ses ENTRÉES : un `attacl` vidé par un retrait n'en porte aucune.
    expect(tete).toContain('cross join lateral aclexplode(a.attacl) d')
    expect(tete).toContain("where a.attrelid = 'public.cabinet_admins'::regclass and a.attnum > 0 and a.atttypid <> 0) then")
    expect(tete.match(/raise exception/g)).toHaveLength(3)
  })

  it('sa garde de fin exige l’état d’après : authenticated ne met plus à jour que `role`, quel que soit le chemin du droit', () => {
    const [, fin] = blocs(sansCommentaires(texteDeLaMigration())).blocs
    expect(fin).toContain("and has_column_privilege('authenticated', a.attrelid, a.attnum, 'UPDATE');")
    expect(fin).toContain("if v_ouvertes is distinct from 'role' then")
    expect(fin.match(/raise exception/g)).toHaveLength(1)
  })

  it('ne crée, ne change ni ne retire aucun objet ni aucune donnée, et rien que le détecteur de l’outil retienne', () => {
    const texte = texteDeLaMigration()
    const code = sansCommentaires(texte)
    for (const motif of [/\bcreate\b/i, /\balter\b/i, /\binsert\b/i, /\bupdate\s+(public\.)?\w+\s+set\b/i, /\bpolicy\b/i, /\bcomment on\b/i]) {
      expect(code, String(motif)).not.toMatch(motif)
    }
    // Ni dans le code ni dans un commentaire : le détecteur d'`apply_migration` lit tout le texte.
    for (const mot of ['drop', 'delete', 'truncate']) expect(texte.toLowerCase()).not.toContain(mot)
    expect(texte).not.toContain('\\')
    expect(texte).not.toContain('\r')
    expect(code.match(/\b(grant|revoke)\b/gi)).toHaveLength(2)
  })
})

// ── Les chemins qui écrivent l'équipe : aucun ne casse ───────────────────────────────────────────────────────────────

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

interface Acces { fichier: string; receveur: string; operation: string; argument: string }

/** Chaque `.from('cabinet_admins')` d'un fichier, l'objet qui le porte, et la PREMIÈRE méthode qui suit : l'opération. */
function accesALEquipe(fichiers: string[]): Acces[] {
  const trouves: Acces[] = []
  for (const fichier of fichiers) {
    const texte = lire(fichier)
    for (const m of texte.matchAll(/(\w+)\s*\.from\(\s*['"]cabinet_admins['"]\s*\)\s*\.(\w+)\(/g)) {
      const ouvrante = (m.index as number) + m[0].length - 1
      trouves.push({ fichier, receveur: m[1], operation: m[2], argument: argument(texte, ouvrante).trim() })
    }
    // Une forme que le motif ne lit pas est une faute : sans cela, une écriture écrite autrement passerait inaperçue.
    const tous = [...texte.matchAll(/\.from\(\s*['"]cabinet_admins['"]\s*\)/g)].length
    expect(trouves.filter((t) => t.fichier === fichier), `${fichier} : un accès à cabinet_admins d'une forme inconnue`).toHaveLength(tous)
  }
  return trouves
}

const ECRITURES = new Set(['insert', 'update', 'upsert', 'delete'])

describe('les chemins qui écrivent cabinet_admins', () => {
  it('l’application ne met à jour que `role`, n’y fait que retirer, et n’y insère rien', () => {
    const acces = accesALEquipe(sources('src', /\.tsx?$/))
    // Un plancher : sans lui, un balayage devenu aveugle rendrait « aucune écriture » sur un dépôt qui en porte.
    expect(acces.filter((a) => a.operation === 'select').length).toBeGreaterThanOrEqual(4)
    const ecritures = acces.filter((a) => ECRITURES.has(a.operation))
    expect(ecritures.map((a) => `${a.fichier} ${a.operation} ${a.argument}`)).toEqual([
      'src/pages/EquipePage.tsx update { role: nouveauRole }',
      'src/pages/EquipePage.tsx delete ',
    ])
    expect(acces.every((a) => a.operation === 'select' || ECRITURES.has(a.operation))).toBe(true)
  })

  it('les Edge Functions n’y font qu’insérer, avec la clé secrète', () => {
    const fichiers = readdirSync(resolve(RACINE, 'supabase/functions'))
      .filter((d) => statSync(resolve(RACINE, 'supabase/functions', d)).isDirectory())
      .sort()
      .map((d) => `supabase/functions/${d}/index.ts`)
    const ecritures = accesALEquipe(fichiers).filter((a) => ECRITURES.has(a.operation))
    expect(ecritures.map((a) => `${a.fichier} ${a.receveur}.${a.operation}`)).toEqual([
      'supabase/functions/create-cabinet/index.ts admin.insert',
      'supabase/functions/create-team-member/index.ts admin.insert',
    ])
    for (const { fichier } of ecritures) {
      expect(lire(fichier)).toContain('const admin = createClient(supabaseUrl, cleSecrete)')
    }
  })

  it('la sauvegarde d’un dossier ne la porte pas : une table de niveau cabinet, que sa restauration n’écrit pas', () => {
    expect(CHEMINS_DOSSIER_PREVUS.cabinet_admins).toEqual({ acces: 'cabinet' })
  })
})

// ── L'essai et la signature ──────────────────────────────────────────────────────────────────────────────────────────

const RLS = lire('supabase/essais/rls.sql')
const BLOC_EQ = (() => {
  const debut = RLS.indexOf('-- ══ EQ. L\'équipe ne change que par son rôle')
  return debut < 0 ? '' : RLS.slice(debut, RLS.indexOf('end $$;', debut) + 'end $$;'.length)
})()

describe('l’essai des policies (rls.sql, bloc EQ)', () => {
  it('attend la migration tant que la table porte UPDATE et aucun droit par colonne', () => {
    expect(BLOC_EQ).toContain("if has_table_privilege('authenticated', 'public.cabinet_admins', 'UPDATE')\n"
      + '     and not exists (select 1 from pg_attribute a cross join lateral aclexplode(a.attacl) d')
    expect(BLOC_EQ).toContain('EN ATTENTE de la migration equipe_par_son_role')
  })

  it('le chef change le rôle, mais ni le compte, ni le cabinet, ni l’adresse — refusés par le droit, à leur raison', () => {
    for (const ecriture of ["'user_id = user_id'", "'cabinet_id = cabinet_id'", "'email = ''autre-membre@example.test'''",
      "'role = ''comptable_en_chef'', email = ''autre-membre@example.test'''"]) {
      expect(BLOC_EQ).toContain(ecriture)
    }
    expect(BLOC_EQ).toContain("refus text := 'permission denied for table cabinet_admins';")
    expect(BLOC_EQ).toContain("'ok', not accepte and motif = '42501' and message = refus);")
    expect(BLOC_EQ).toContain("'ok', touchees = 1 and motif = 'P0001' and message = 'ANNULATION_ESSAI');")
    for (const controle of ['EQ1.', 'EQ2.', 'EQ3.', 'EQ4.', 'EQ5.']) expect(BLOC_EQ).toContain(`'${controle} `)
    for (const mutation of ['M-EQ1', 'M-EQ2', 'M-EQ3', 'M-EQ4', 'M-EQ5']) expect(BLOC_EQ).toContain(`'mutation', '${mutation} — `)
  })

  it('la signature du schéma lit les droits par colonne', () => {
    expect(lire('supabase/essais/signature.sql')).toContain('from pg_attribute att cross join lateral aclexplode(att.attacl) a')
  })
})
