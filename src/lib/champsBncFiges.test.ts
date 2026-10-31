import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { codesSql, messagesSql } from '../test/raiseSql'
import { fichiersDuSchema, fichiersPrepares } from '../test/schema'
import { CASES_2035, POSTES_RATTACHES, caseDuPoste, posteRattache } from './cases2035'
import {
  MODES_REGLEMENT, NATURES_OPERATION, SEPARATEUR_DU_POSTE, natOpDeLaLigne, type ChampsBnc, type LigneACaracteriser,
} from './champsBncDuFec'
import {
  CLASSE_DU_POSTE, COLONNES_CHAMPS_BNC, REFUS_DES_CHAMPS_BNC, champsDeLaLigneDemandee, identificationsAdmises, natOpFigee,
  posteDeLaNatOp, refusDesChampsBnc, type CleDuRefusDesChampsBnc, type DocumentDuDossier, type LigneAJuger,
} from './champsBncFiges'

// LES QUATRE CHAMPS DU FEC D'UN BNC, FIGÉS PAR LA VALIDATION (ligne 26.6, étape e ; lot FEC22b ; MVP-D5). La migration
// `champs_bnc_du_fec` — préparée dans supabase/preparees/, dans l'export sous la version de sa ligne d'historique le jour
// de son application, texte inchangé — reprend trois fonctions : `valider_exercice` (de `validation_des_ventes_facturees`),
// `empreinte_exercice` (de `report_des_soldes`) et la garde G5, `garder_lignes_de_la_vente_facturee` (de `virement_mixte`).
// Ce garde la confronte à l'export au caractère près, ce qu'elle ajoute défait ; relit dans son texte les refus, les
// listes et les clés que lib/champsBncFiges.ts redit, et ce module à lib/champsBncDuFec.ts et lib/cases2035.ts ; confronte
// son retour arrière (supabase/preparees/retour/) et l'essai (supabase/essais/validationExercice.sql, 150 à 190). Récit :
// HISTORIQUE.md, « LES QUATRE CHAMPS DU FEC D'UN BNC, EN BASE (FEC22B) ». Données FICTIVES.

const MIGRATION = /\/\d{14}_champs_bnc_du_fec\.sql$/
const md5 = (texte: string) => createHash('md5').update(texte, 'utf8').digest('hex')
const corps = (definition: string) => definition.slice(definition.indexOf('as $$') + 'as $$'.length)
const nomDuFichier = (chemin: string) => chemin.split('/').pop() as string
const motifDe = (fonction: string) => new RegExp(`create (or replace )?function public\\.${fonction}\\(`, 'g')

// Les trois fonctions reprises, chacune avec la migration dont l'export tient la définition d'hier, et l'empreinte de son
// corps que la garde de tête exige.
const REPRISES = [
  { fonction: 'valider_exercice', migration: 'validation_des_ventes_facturees', empreinte: 'd241891ff5f68e6fe4d92889b4b720ed' },
  { fonction: 'empreinte_exercice', migration: 'report_des_soldes', empreinte: '3e095e9bec4617beb85014c07f16127d' },
  { fonction: 'garder_lignes_de_la_vente_facturee', migration: 'virement_mixte', empreinte: '905446ccd461606b99fa11eff68c1db1' },
] as const

// La migration, où qu'elle soit : préparée aujourd'hui, dans l'export le jour de son application — jamais aux deux.
function laMigration(): { chemin: string; texte: string } {
  const trouvees = [...fichiersPrepares(), ...fichiersDuSchema()].filter((x) => MIGRATION.test(x.chemin))
  expect(trouvees.map((f) => f.chemin), 'la migration champs_bnc_du_fec, préparée OU dans l’export').toHaveLength(1)
  return trouvees[0]
}

// La définition qu'un texte donne à une fonction (la seule qu'il en donne).
function definitionDans(texte: string, fonction: string): string {
  const positions = [...texte.matchAll(motifDe(fonction))].map((m) => m.index)
  expect(positions, fonction).toHaveLength(1)
  return texte.slice(positions[0], texte.indexOf('$$;', positions[0]))
}

// La définition qu'une fonction a dans l'export AVANT la migration — celle que la production exécute tant qu'elle n'est
// pas appliquée.
function avantLaMigration(fonction: string): { chemin: string; definition: string } {
  const nom = nomDuFichier(laMigration().chemin)
  const avant = fichiersDuSchema().filter((f) => nomDuFichier(f.chemin) < nom && motifDe(fonction).test(f.texte))
  const { chemin, texte } = avant[avant.length - 1]
  const debut = [...texte.matchAll(motifDe(fonction))].pop()?.index as number
  return { chemin, definition: texte.slice(debut, texte.indexOf('$$;', debut)) }
}

// Le retour arrière, dans supabase/preparees/retour/.
function leRetour(): string {
  const dossier = new URL('../../supabase/preparees/retour/', import.meta.url).pathname
  expect(existsSync(dossier), 'supabase/preparees/retour/').toBe(true)
  const nom = readdirSync(dossier).find((n) => /^\d{14}_retour_champs_bnc_du_fec\.sql$/.test(n))
  expect(nom, 'le retour arrière de champs_bnc_du_fec').toBeDefined()
  return readFileSync(dossier + nom, 'utf8')
}

// Remplace un passage qui doit paraître une fois, exactement.
function uneFois(texte: string, de: string, vers: string): string {
  expect(texte.split(de).length - 1, de.slice(0, 80)).toBe(1)
  return texte.replace(de, () => vers)
}

// ── Ce que la migration ajoute à chaque fonction, et qui, défait, rend celle d'hier ──────────────────────────────────

const DEBUT_DU_BLOC = "  -- LES QUATRE CHAMPS DU FEC D'UN BNC EN TRÉSORERIE (ligne 26.6, étape e ; lot FEC22b ; MVP-D5 ; LPF, art. A47 A-1,"
const APRES_LE_BLOC = "  -- Les déclencheurs d'intangibilité ne laissent passer « validée »"

// Le bloc neuf de `valider_exercice` : du commentaire qui l'ouvre au dernier refus, ligne vide comprise.
function leBloc(posee: string): string {
  const i = posee.indexOf(DEBUT_DU_BLOC)
  const j = posee.indexOf(APRES_LE_BLOC)
  expect(i).toBeGreaterThan(0)
  expect(j).toBeGreaterThan(i)
  return posee.slice(i, j)
}

function validationDefaite(posee: string): string {
  let t = uneFois(posee, '  v_vente record;\n  v_champs text;\n', '  v_vente record;\n')
  t = uneFois(t, leBloc(posee), '')
  t = uneFois(t, "  -- Les quatre champs du FEC d'un BNC partent avec la numérotation (lot FEC22b) : nuls quand la demande ne les porte\n  -- pas.\n", '')
  t = uneFois(t, `comp_aux_num = l.comp_aux_num, comp_aux_lib = l.comp_aux_lib,
         date_reglement = l.date_reglement::date, mode_reglement = l.mode_reglement,
         nature_operation = l.nature_operation, poste_rattache = l.poste_rattache,
         identification_client = l.identification_client
`, 'comp_aux_num = l.comp_aux_num, comp_aux_lib = l.comp_aux_lib\n')
  return uneFois(t, `      compte_lib text, comp_aux_num text, comp_aux_lib text, date_reglement text, mode_reglement text,
      nature_operation text, poste_rattache text, identification_client text)`, '      compte_lib text, comp_aux_num text, comp_aux_lib text)')
}

const CHAMP_DE_L_EMPREINTE = `,
          -- Les quatre champs du FEC d'un BNC (lot FEC22b) : UN champ de plus, présent seulement quand l'un d'eux
          -- est posé. \`concat_ws\` saute un argument nul : une écriture validée sans eux garde sa forme d'avant, au
          -- caractère près, et un exercice validé sans eux se vérifie comme hier ; une valeur posée, retirée ou
          -- passée d'un champ à l'autre change l'empreinte.
          case when num_nonnulls(e.date_reglement, e.mode_reglement, e.nature_operation, e.poste_rattache,
                                 e.identification_client) > 0 then
            concat_ws(chr(31), coalesce(to_char(e.date_reglement, 'YYYY-MM-DD'), ''), coalesce(e.mode_reglement, ''),
                      coalesce(e.nature_operation, ''), coalesce(e.poste_rattache, ''),
                      coalesce(e.identification_client, ''))
          end),`

function empreinteDefaite(posee: string): string {
  return uneFois(posee, `to_char(e.valide_le at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')${CHAMP_DE_L_EMPREINTE}`,
    `to_char(e.valide_le at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')),`)
}

function gardeDefaite(posee: string): string {
  let t = uneFois(posee, `  -- Ce que la validation d'un exercice pose sur la ligne — son numéro, sa pièce, ses libellés, et les quatre champs du
  -- FEC d'un BNC (lot FEC22b) — ne la change pas.
`, '')
  t = uneFois(t, `'comp_aux_num', 'comp_aux_lib', 'date_reglement', 'mode_reglement', 'nature_operation',
                            'poste_rattache', 'identification_client'])`, `'comp_aux_num', 'comp_aux_lib'])`)
  return uneFois(t, `'piece_date', 'compte_lib', 'comp_aux_num', 'comp_aux_lib',
                                                'date_reglement', 'mode_reglement', 'nature_operation',
                                                'poste_rattache', 'identification_client']) then`,
  `'piece_date', 'compte_lib', 'comp_aux_num', 'comp_aux_lib']) then`)
}

const DEFAIRE: Record<(typeof REPRISES)[number]['fonction'], (posee: string) => string> = {
  valider_exercice: validationDefaite,
  empreinte_exercice: empreinteDefaite,
  garder_lignes_de_la_vente_facturee: gardeDefaite,
}

// Les valeurs d'une liste SQL de littéraux, l'apostrophe doublée rendue simple ; les lignes de commentaire écartées
// d'abord (« l'opération » d'un commentaire décalerait les apostrophes).
const litteraux = (sql: string): string[] => [...sql.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n')
  .matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'"))

describe('la migration champs_bnc_du_fec reprend trois fonctions, et n’y ajoute que les quatre champs', () => {
  it('sa garde de tête exige, avant toute définition, les corps que l’export laisse aux trois fonctions', () => {
    const texte = laMigration().texte
    const premiereDefinition = texte.indexOf('create or replace function')
    for (const r of REPRISES) {
      const hier = avantLaMigration(r.fonction)
      expect(hier.chemin, r.fonction).toMatch(new RegExp(`/\\d{14}_${r.migration}\\.sql$`))
      expect(md5(corps(hier.definition)), r.fonction).toBe(r.empreinte)
      const ligne = `'${r.empreinte}', '${r.migration}')`
      expect(texte.indexOf(ligne), r.fonction).toBeGreaterThan(0)
      expect(texte.indexOf(ligne), r.fonction).toBeLessThan(premiereDefinition)
    }
    expect(texte).toContain("md5(replace((select p.prosrc from pg_proc p where p.oid = to_regprocedure(v.fonction)), chr(13), '')) <> v.empreinte then")
    // Et elle refuse une seconde application : les colonnes ou la contrainte déjà là.
    expect(texte.indexOf("cette migration ne s''applique pas deux fois.")).toBeLessThan(premiereDefinition)
  })

  it('chaque fonction est celle d’hier au caractère près, ce que la migration ajoute défait', () => {
    const texte = laMigration().texte
    for (const r of REPRISES) {
      expect(DEFAIRE[r.fonction](definitionDans(texte, r.fonction)), r.fonction).toBe(avantLaMigration(r.fonction).definition)
    }
  })

  it('le bloc neuf de la validation vient après tous ses refus d’hier, avant qu’elle n’écrive', () => {
    const posee = definitionDans(laMigration().texte, 'valider_exercice')
    const i = posee.indexOf(DEBUT_DU_BLOC)
    expect(posee.slice(i - 100, i)).toMatch(/if v_defaut is not null then\n {4}raise exception '%', v_defaut using errcode = '22023';\n {2}end if;\n\n$/)
    expect(posee.indexOf("perform set_config('jd.validation_exercice', p_dossier_id::text, true);")).toBeGreaterThan(i)
    // Le bloc ne lit que la demande, le brouillon du dossier et ses factures ; il n'écrit rien.
    const bloc = leBloc(posee)
    expect(bloc).not.toMatch(/\b(insert|update|delete)\b/i)
    expect([...bloc.matchAll(/public\.(\w+)/g)].map((m) => m[1]).sort()).toEqual(['ecritures_brouillon', 'factures_emises'])
    expect(bloc).toContain('join public.ecritures_brouillon e on e.id = x.id and e.dossier_id = p_dossier_id')
    expect(bloc).toContain("where f.dossier_id = p_dossier_id and f.statut = 'validee' and coalesce(f.numero, '') <> ''")
    // Le jour de Paris, celui de l'instant de la validation, comme l'exercice terminé se lit à Paris.
    expect(bloc).toContain("jour > (v_maintenant at time zone 'Europe/Paris')::date")
  })

  it('le texte : trois définitions, une seule table modifiée, aucun droit, aucun objet ni donnée retirés, ni barre oblique inverse ni retour chariot', () => {
    const texte = laMigration().texte
    expect(texte.match(/create (or replace )?function/g)).toHaveLength(3)
    expect(texte.match(/\balter table\b/gi)).toHaveLength(1)
    expect(texte).toContain('alter table public.ecritures_brouillon\n  add column date_reglement date,')
    expect(texte).not.toMatch(/\b(grant|revoke|drop|truncate)\b/i)
    expect(texte).not.toMatch(/\b(create|drop)\s+(table|policy|trigger|index|view)\b/i)
    expect(texte).not.toMatch(/\bdelete from\b/i)
    // « delete » n'y vient que de la garde G5 reprise, qui nomme l'opération qu'elle juge, comme hier.
    expect(texte.match(/delete/gi)?.length ?? 0).toBe(avantLaMigration('garder_lignes_de_la_vente_facturee').definition.match(/delete/gi)?.length ?? 0)
    expect(texte).not.toContain('\\')
    expect(texte).not.toContain('\r')
  })
})

describe('les colonnes et les clés : les cinq du module, dans son ordre', () => {
  it('cinq colonnes nulles, sans valeur par défaut, dans l’ordre de COLONNES_CHAMPS_BNC', () => {
    const texte = laMigration().texte
    const alter = texte.slice(texte.indexOf('alter table public.ecritures_brouillon'), texte.indexOf('add constraint'))
    expect([...alter.matchAll(/add column (\w+) (\w+),/g)].map((m) => `${m[1]} ${m[2]}`)).toEqual([
      'date_reglement date', 'mode_reglement text', 'nature_operation text', 'poste_rattache text', 'identification_client text',
    ])
    expect([...alter.matchAll(/add column (\w+)/g)].map((m) => m[1])).toEqual([...COLONNES_CHAMPS_BNC])
    expect(alter).not.toMatch(/\b(default|not null)\b/i)
  })

  it('la validation lit les cinq clés de `p_lignes`, en texte, et les pose sur la ligne sous leur nom', () => {
    const posee = definitionDans(laMigration().texte, 'valider_exercice')
    const cles = COLONNES_CHAMPS_BNC.map((c) => `${c} text`).join(', ')
    expect(leBloc(posee).replace(/\s+/g, ' ')).toContain(`as x(id uuid, journal text, numero integer, ${cles})`)
    expect(posee.replace(/\s+/g, ' ')).toContain(`compte_lib text, comp_aux_num text, comp_aux_lib text, ${cles})`)
    for (const c of COLONNES_CHAMPS_BNC) {
      expect(posee, c).toContain(c === 'date_reglement' ? 'date_reglement = l.date_reglement::date' : `${c} = l.${c}`)
    }
  })

  it('l’empreinte compte les cinq colonnes, dans le même ordre, en un champ présent seulement quand l’une est posée', () => {
    const posee = definitionDans(laMigration().texte, 'empreinte_exercice')
    expect(CHAMP_DE_L_EMPREINTE.replace(/\s+/g, ' ')).toContain(`num_nonnulls(${COLONNES_CHAMPS_BNC.map((c) => `e.${c}`).join(', ')}) > 0`)
    const champs = [...CHAMP_DE_L_EMPREINTE.matchAll(/coalesce\((?:to_char\()?e\.(\w+)/g)].map((m) => m[1])
    expect(champs).toEqual([...COLONNES_CHAMPS_BNC])
    expect(posee).toContain(CHAMP_DE_L_EMPREINTE)
  })

  it('G5 laisse à la validation les cinq colonnes, des deux côtés de sa comparaison', () => {
    const posee = definitionDans(laMigration().texte, 'garder_lignes_de_la_vente_facturee')
    const listes = [...posee.matchAll(/- array\[([^\]]*)\]/g)].map((m) => litteraux(m[1]))
    expect(listes).toHaveLength(2)
    for (const l of listes) expect(l.slice(-5)).toEqual([...COLONNES_CHAMPS_BNC])
    expect(listes[0]).toEqual(listes[1])
  })
})

describe('les refus neufs : leur clé, leur code et leurs mots, dans l’ordre de la base', () => {
  it('le jugement les rend dans cet ordre, et chaque clé lève son refus, au caractère près', () => {
    const bloc = leBloc(definitionDans(laMigration().texte, 'valider_exercice'))
    const jugement = bloc.slice(bloc.indexOf('  select case'), bloc.indexOf('  into v_champs;'))
    expect([...jugement.matchAll(/ then '(\w+)'\n/g)].map((m) => m[1])).toEqual(REFUS_DES_CHAMPS_BNC.map((r) => r.cle))
    const levees = [...bloc.matchAll(/if v_champs = '(\w+)' then\n {4}raise exception '((?:[^']|'')*)'\n {6}using errcode = '(\w+)';\n {2}end if;/g)]
    expect(levees.map((m) => ({ cle: m[1], code: m[3], message: m[2].replace(/''/g, "'") }))).toEqual(REFUS_DES_CHAMPS_BNC.map((r) => ({ ...r })))
    expect(messagesSql(bloc)).toEqual(REFUS_DES_CHAMPS_BNC.map((r) => r.message))
    expect(codesSql(bloc)).toEqual(REFUS_DES_CHAMPS_BNC.map((r) => r.code))
  })

  it('ils s’ajoutent aux refus d’hier, après le dernier de la numérotation : rien d’autre ne bouge', () => {
    const hier = messagesSql(avantLaMigration('valider_exercice').definition)
    const demain = messagesSql(definitionDans(laMigration().texte, 'valider_exercice'))
    const i = demain.indexOf(REFUS_DES_CHAMPS_BNC[0].message)
    expect(demain[i - 1]).toBe('%')
    expect(demain.toSpliced(i, REFUS_DES_CHAMPS_BNC.length)).toEqual(hier)
    const codesHier = codesSql(avantLaMigration('valider_exercice').definition)
    expect(codesSql(definitionDans(laMigration().texte, 'valider_exercice')).toSpliced(i, REFUS_DES_CHAMPS_BNC.length)).toEqual(codesHier)
  })

  it('aucun mot neuf ne répète un refus d’hier : chacun se reconnaît à ses mots seuls', () => {
    const hier = new Set(messagesSql(avantLaMigration('valider_exercice').definition))
    for (const r of REFUS_DES_CHAMPS_BNC) expect(hier.has(r.message), r.cle).toBe(false)
    expect(new Set(REFUS_DES_CHAMPS_BNC.map((r) => r.message)).size).toBe(REFUS_DES_CHAMPS_BNC.length)
  })
})

describe('les listes fermées que la base copie : celles de lib/champsBncDuFec.ts et de lib/cases2035.ts', () => {
  const texte = () => laMigration().texte
  const cte = (bloc: string, nom: string) => {
    const i = bloc.indexOf(`  ), ${nom} as (`)
    expect(i, nom).toBeGreaterThan(0)
    return bloc.slice(i, bloc.indexOf('\n  ), ', i + 5))
  }

  it('la validation : les modes, les natures, les postes et leur classe', () => {
    const bloc = leBloc(definitionDans(texte(), 'valider_exercice'))
    expect(litteraux(cte(bloc, 'modes(mode)'))).toEqual([...MODES_REGLEMENT])
    expect(litteraux(cte(bloc, 'natures(nature)'))).toEqual([...NATURES_OPERATION])
    const postes = litteraux(cte(bloc, 'postes(poste, classe)'))
    const paires = postes.flatMap((v, k) => (k % 2 === 0 ? [[v, postes[k + 1]]] : []))
    expect(paires).toEqual([...CLASSE_DU_POSTE.entries()])
    expect(paires.map(([p]) => p)).toEqual([...POSTES_RATTACHES])
  })

  it('la contrainte : les mêmes listes, les postes des recettes sur un produit, ceux des dépenses sur une charge', () => {
    const t = texte()
    const contrainte = t.slice(t.indexOf('add constraint ecritures_brouillon_champs_bnc_du_fec'), t.indexOf('comment on column'))
    const entre = (de: string, a: string) => contrainte.slice(contrainte.indexOf(de), contrainte.indexOf(a, contrainte.indexOf(de)))
    expect(litteraux(entre('mode_reglement in (', ')'))).toEqual([...MODES_REGLEMENT])
    expect(litteraux(entre('nature_operation in (', '))'))).toEqual([...NATURES_OPERATION])
    const recettes = litteraux(entre("(compte ~ '^7[0-9]{2}' and poste_rattache in (", '))').replace("'^7[0-9]{2}'", ''))
    const depenses = litteraux(entre("(compte ~ '^6[0-9]{2}' and poste_rattache in (", ')))))').replace("'^6[0-9]{2}'", ''))
    expect(recettes).toEqual([...CLASSE_DU_POSTE].filter(([, c]) => c === '7').map(([p]) => p))
    expect(depenses).toEqual([...CLASSE_DU_POSTE].filter(([, c]) => c === '6').map(([p]) => p))
    // Proposée : aucun des cinq ; validée : chacun dans sa forme ou nul — la règle d'`ecritures_brouillon_validation_complete`.
    expect(contrainte.replace(/\s+/g, ' ')).toContain(`(statut = 'proposee' and ${COLONNES_CHAMPS_BNC.map((c) => `${c} is null`).join(' and ')})`)
  })

  it('la classe d’un poste est celle que `posteRattache` accepte, et aucun poste ni aucune nature ne porte le séparateur', () => {
    for (const [poste, classe] of CLASSE_DU_POSTE) {
      expect(posteRattache(poste, 'recette') === poste, poste).toBe(classe === '7')
      expect(posteRattache(poste, 'depense') === poste, poste).toBe(classe === '6')
      expect(poste.includes(SEPARATEUR_DU_POSTE.trim()), poste).toBe(false)
    }
    for (const n of NATURES_OPERATION) expect(n.includes(SEPARATEUR_DU_POSTE.trim()), n).toBe(false)
    expect(CLASSE_DU_POSTE.size).toBe(POSTES_RATTACHES.length)
  })

  it('les cases qui se retranchent des recettes (AB, AC) ne reçoivent qu’une dépense : leurs postes sont de classe 6', () => {
    // Lu au formulaire, pas recopié : les cases soustractives de la table, et les postes qui y vont.
    const soustractives = CASES_2035.filter((c) => c.soustractive).map((c) => c.code)
    expect(soustractives).toEqual(['AB', 'AC'])
    const postesSoustractifs = POSTES_RATTACHES.filter((p) => soustractives.includes(caseDuPoste(p)?.code ?? ''))
    expect(postesSoustractifs).toEqual(['Débours payés pour le compte des clients', 'Débours', 'Honoraires rétrocédés', 'Rétrocessions'])
    for (const p of postesSoustractifs) expect(CLASSE_DU_POSTE.get(p), p).toBe('6')
    // Les autres postes du cadre des recettes, classe 7 ; tous ceux des autres cadres, classe 6.
    for (const p of POSTES_RATTACHES.filter((x) => !postesSoustractifs.includes(x))) {
      expect(CLASSE_DU_POSTE.get(p), p).toBe(caseDuPoste(p)?.cadre === 'recettes' ? '7' : '6')
    }
    expect([...CLASSE_DU_POSTE].filter(([, c]) => c === '7').map(([p]) => p)).toEqual(
      ['Recettes', 'Recettes encaissées y compris les remboursements de frais', 'Produits financiers', 'Gains divers'])
  })
})

describe('le retour arrière : les trois fonctions d’hier, au caractère près, puis la contrainte et les colonnes retirées', () => {
  it('il exige les corps que la migration a posés, et rend ceux d’hier', () => {
    const retour = leRetour()
    const premiereDefinition = retour.indexOf('create or replace function')
    for (const r of REPRISES) {
      const pose = md5(corps(definitionDans(laMigration().texte, r.fonction)))
      expect(retour.indexOf(`'${pose}'`), r.fonction).toBeGreaterThan(0)
      expect(retour.indexOf(`'${pose}'`), r.fonction).toBeLessThan(premiereDefinition)
      expect(definitionDans(retour, r.fonction), r.fonction).toBe(avantLaMigration(r.fonction).definition)
    }
    expect(retour.match(/create (or replace )?function/g)).toHaveLength(3)
  })

  it('il se refuse dès qu’une ligne porte l’un des champs, et ne retire que la contrainte et les cinq colonnes, en dernier', () => {
    const retour = leRetour()
    expect(retour.replace(/\s+/g, ' ')).toContain(`num_nonnulls(${COLONNES_CHAMPS_BNC.join(', ')}) > 0`)
    const retraits = [...retour.matchAll(/\bdrop (constraint|column) (\w+)/g)].map((m) => `${m[1]} ${m[2]}`)
    expect(retraits).toEqual(['constraint ecritures_brouillon_champs_bnc_du_fec', ...COLONNES_CHAMPS_BNC.map((c) => `column ${c}`)])
    expect(retour.indexOf('drop constraint')).toBeGreaterThan(retour.lastIndexOf('$$;'))
    expect(retour).not.toMatch(/\b(grant|revoke|truncate)\b/i)
    expect(retour).not.toMatch(/\bdelete from\b/i)
    expect(retour).not.toContain('\\')
    expect(retour).not.toContain('\r')
  })
})

// ── Le module : composer la demande, recomposer NatOp, juger comme la base ────────────────────────────────────────────

const ligne = (id: string, compte: string, poste: LigneACaracteriser['poste']): LigneACaracteriser => ({ id, compte, libelle: 'ESSAI', poste })
const ACHAT = ligne('l1', '606100', { de: 'categorie', categorie: { libelle: 'Fournitures', poste_2035: 'Achats' } })
const BANQUE = ligne('l2', '512000', { de: 'aucun' })
const VENTE = ligne('l3', '706000', { de: 'categorie', categorie: { libelle: 'Honoraires', poste_2035: 'recettes' } })

describe('composer la demande et recomposer NatOp', () => {
  it('NatOp se défait en nature et poste, et se recompose à l’identique, pour chaque nature', () => {
    for (const nature of NATURES_OPERATION) {
      for (const l of [ACHAT, BANQUE, VENTE]) {
        const natOp = natOpDeLaLigne(nature, l)
        const poste = posteDeLaNatOp(nature, natOp)
        expect(natOpFigee({ nature_operation: nature, poste_rattache: poste }), `${nature} ${l.compte}`).toBe(natOp)
      }
    }
    expect(posteDeLaNatOp('Dépense', `Dépense${SEPARATEUR_DU_POSTE}Achats`)).toBe('Achats')
    // Le poste sous l'orthographe du rattachement, jamais celle de la catégorie.
    expect(posteDeLaNatOp('Recette', natOpDeLaLigne('Recette', VENTE))).toBe('Recettes')
    expect(posteDeLaNatOp('Recette', 'Recette')).toBeNull()
    expect(() => posteDeLaNatOp('Recette', 'Dépense — Achats')).toThrow(/ne commence pas par sa nature/)
    expect(() => posteDeLaNatOp('Recette', `Recette${SEPARATEUR_DU_POSTE}`)).toThrow(/ne commence pas par sa nature/)
    expect(natOpFigee({ nature_operation: null, poste_rattache: null })).toBe('')
  })

  it('les cinq clés d’une ligne : le vide du fichier devient nul, la nature est celle de l’écriture, le poste celui de la ligne', () => {
    const champs: ChampsBnc = {
      dateRglt: '2024-03-05', modeRglt: 'Banque', nature: 'Dépense',
      natOp: new Map([[ACHAT.id, natOpDeLaLigne('Dépense', ACHAT)], [BANQUE.id, natOpDeLaLigne('Dépense', BANQUE)]]), idClient: '',
    }
    expect(champsDeLaLigneDemandee(champs, ACHAT.id)).toEqual({
      date_reglement: '2024-03-05', mode_reglement: 'Banque', nature_operation: 'Dépense', poste_rattache: 'Achats', identification_client: null,
    })
    expect(champsDeLaLigneDemandee(champs, BANQUE.id).poste_rattache).toBeNull()
    const sans: ChampsBnc = { ...champs, dateRglt: '', modeRglt: '', idClient: 'F2024-0001' }
    expect(champsDeLaLigneDemandee(sans, ACHAT.id)).toMatchObject({ date_reglement: null, mode_reglement: null, identification_client: 'F2024-0001' })
    expect(Object.keys(champsDeLaLigneDemandee(champs, ACHAT.id))).toEqual([...COLONNES_CHAMPS_BNC])
    expect(() => champsDeLaLigneDemandee(champs, 'inconnue')).toThrow(/n'a pas de NatOp/)
  })
})

// La numérotation de K 2024 de l'essai (supabase/essais/validationExercice.sql, avant 151), et ses documents : les mêmes
// cas, que la base juge en 151 à 166 et que le module doit juger de même.
const K: LigneAJuger[] = [
  { journal: 'AC', numero: 1, compte: '606100', date_reglement: '2024-03-05', mode_reglement: 'Banque', nature_operation: 'Dépense', poste_rattache: 'Achats', identification_client: null },
  { journal: 'AC', numero: 1, compte: '512000', date_reglement: '2024-03-05', mode_reglement: 'Banque', nature_operation: 'Dépense', poste_rattache: null, identification_client: null },
  { journal: 'VE', numero: 1, compte: '512000', date_reglement: '2024-05-10', mode_reglement: 'Banque', nature_operation: 'Recette', poste_rattache: null, identification_client: '999000102' },
  { journal: 'VE', numero: 1, compte: '706000', date_reglement: '2024-05-10', mode_reglement: 'Banque', nature_operation: 'Recette', poste_rattache: 'Recettes', identification_client: '999000102' },
  { journal: 'BQ', numero: 1, compte: '512000', date_reglement: '2024-06-01', mode_reglement: 'Banque', nature_operation: 'Recette', poste_rattache: null, identification_client: 'A2024-0001' },
  { journal: 'BQ', numero: 1, compte: '706000', date_reglement: '2024-06-01', mode_reglement: 'Banque', nature_operation: 'Recette', poste_rattache: 'Gains divers', identification_client: 'A2024-0001' },
  { journal: 'OD', numero: 1, compte: '681100', date_reglement: null, mode_reglement: null, nature_operation: 'Dotation aux amortissements', poste_rattache: 'Amortissements', identification_client: null },
  { journal: 'OD', numero: 1, compte: '281830', date_reglement: null, mode_reglement: null, nature_operation: 'Dotation aux amortissements', poste_rattache: null, identification_client: null },
]
const doc = (numero: string | null, tiers_siret: string | null, statut: DocumentDuDossier['statut'] = 'validee'): DocumentDuDossier => ({ numero, statut, tiers_siret })
const DOCUMENTS: DocumentDuDossier[] = [
  doc('F2024-0001', '99900010200015'), doc('F2024-0002', '99900070000008'), doc('A2024-0001', '99900070000008'),
  doc('F2024-0003', '99900030000010'), doc('F2024-0004', '999000201'), doc('F2024-0005', '999 000 607 00013'),
  doc(null, '99900040900014', 'brouillon'),
]
const AUJOURD_HUI = '2026-10-31'
const varier = (rang: number, o: Partial<LigneAJuger>, base: LigneAJuger[] = K) => base.map((l, i) => (i === rang ? { ...l, ...o } : l))
const deux = (rangs: [number, number], o: Partial<LigneAJuger>) => varier(rangs[1], o, varier(rangs[0], o))
const cleDe = (lignes: LigneAJuger[], documents = DOCUMENTS, jour = AUJOURD_HUI) => refusDesChampsBnc(lignes, documents, jour)?.cle ?? null

describe('juger comme la base : les cas de l’essai, un à un', () => {
  it('la numérotation de K passe ; sans les champs, rien ne se juge', () => {
    expect(cleDe(K)).toBeNull()
    const sans = K.map((l) => ({ ...l, date_reglement: null, mode_reglement: null, nature_operation: null, poste_rattache: null, identification_client: null }))
    expect(cleDe(sans, [])).toBeNull()
  })

  it('chaque cas fautif rend sa clé, celle que la base lève (151 à 165c)', () => {
    const cas: [string, LigneAJuger[], CleDuRefusDesChampsBnc][] = [
      ['151', deux([0, 1], { date_reglement: '2024-02-30' }), 'date_illisible'],
      ['151b', deux([0, 1], { date_reglement: '' }), 'date_illisible'],
      ['151c', deux([0, 1], { date_reglement: '05/03/2024' }), 'date_illisible'],
      ['152', deux([0, 1], { date_reglement: '2026-11-02' }), 'date_future'],
      ['153', deux([0, 1], { mode_reglement: 'Cheque' }), 'mode_hors_liste'],
      ['153b', deux([0, 1], { mode_reglement: '' }), 'mode_hors_liste'],
      ['154', deux([0, 1], { nature_operation: 'Soins infirmiers' }), 'nature_hors_liste'],
      ['155', varier(0, { poste_rattache: 'achats' }), 'poste_hors_liste'],
      ['156', deux([0, 1], { nature_operation: null }), 'poste_sans_nature'],
      ['157', varier(1, { poste_rattache: 'Achats' }), 'poste_hors_resultat'],
      ['158', varier(3, { poste_rattache: 'Achats' }), 'poste_hors_cadre'],
      ['158b', varier(0, { poste_rattache: 'Recettes' }), 'poste_hors_cadre'],
      ['158c', varier(3, { poste_rattache: 'Honoraires rétrocédés' }), 'poste_hors_cadre'],
      ['158e', varier(3, { poste_rattache: 'Débours payés pour le compte des clients' }), 'poste_hors_cadre'],
      ['159', varier(1, { date_reglement: '2024-03-06' }), 'date_differe'],
      ['159b', varier(1, { date_reglement: null }), 'date_differe'],
      ['160', varier(1, { mode_reglement: 'Chèque' }), 'mode_differe'],
      ['160b', varier(1, { mode_reglement: null }), 'mode_differe'],
      ['161', varier(1, { nature_operation: 'Recette' }), 'nature_differe'],
      ['161b', varier(1, { nature_operation: null }), 'nature_differe'],
      ['162', varier(3, { identification_client: 'F2024-0001' }), 'client_differe'],
      ['162b', varier(3, { identification_client: null }), 'client_differe'],
      ['163', deux([2, 3], { identification_client: 'ESSAI DUPONT' }), 'client_inconnu'],
      ['163b', deux([2, 3], { identification_client: '999000409' }), 'client_inconnu'],
      ['163e', deux([2, 3], { identification_client: '999000700' }), 'client_inconnu'],
      ['163f', deux([2, 3], { identification_client: '999000300' }), 'client_inconnu'],
      ['163g', deux([2, 3], { identification_client: '99900010200015' }), 'client_inconnu'],
      ['163h', deux([2, 3], { identification_client: '999000607' }), 'client_inconnu'],
      ['163i', deux([2, 3], { identification_client: '' }), 'client_inconnu'],
      ['165', deux([2, 3], { identification_client: 'ESSAI DUPONT' }).map((l, i) => (i < 2 ? { ...l, mode_reglement: 'Cheque' } : l)), 'mode_hors_liste'],
      ['165b', deux([0, 1], { date_reglement: '2024-13-01', nature_operation: 'Soins' }), 'date_illisible'],
    ]
    for (const [etape, lignes, cle] of cas) expect(cleDe(lignes), etape).toBe(cle)
    // 158d et 158f : les honoraires rétrocédés et les débours sur une charge passent — la rétrocession payée à un
    // remplaçant (622600) comme l'achat de l'essai (606100).
    expect(cleDe(varier(0, { poste_rattache: 'Honoraires rétrocédés' }))).toBeNull()
    expect(cleDe(varier(0, { compte: '622600', poste_rattache: 'Honoraires rétrocédés' }))).toBeNull()
    expect(cleDe(varier(0, { poste_rattache: 'Débours payés pour le compte des clients' }))).toBeNull()
    // 152b : le jour même passe ; 152 se juge au jour de Paris que l'appelant donne.
    expect(cleDe(deux([0, 1], { date_reglement: AUJOURD_HUI }))).toBeNull()
    expect(cleDe(deux([0, 1], { date_reglement: '2026-11-01' }), DOCUMENTS, '2026-11-01')).toBeNull()
    // 162c : deux écritures d'un même journal portent chacune les leurs.
    expect(cleDe(K.map((l, i) => (i === 2 || i === 3 ? { ...l, journal: 'AC', numero: 2 } : l)))).toBeNull()
  })

  it('le client : un document validé du dossier, ou le SIREN juste de son client figé — La Poste et son siège compris', () => {
    const avec = (siret: string) => [...DOCUMENTS, doc('F2024-0099', siret)]
    expect(cleDe(deux([2, 3], { identification_client: 'F2024-0002' }))).toBeNull()
    expect(cleDe(deux([2, 3], { identification_client: '999000201' }))).toBeNull()
    expect(cleDe(deux([2, 3], { identification_client: '356000000' }), avec('35600000000001'))).toBeNull()
    expect(cleDe(deux([2, 3], { identification_client: '356000000' }), avec('35600000000048'))).toBeNull()
    expect(cleDe(deux([2, 3], { identification_client: '356000000' }), avec('35600000000002'))).toBe('client_inconnu')
    // 163c, 163d : rien d'un autre dossier — l'appelant ne donne que les documents du sien.
    expect(cleDe(deux([2, 3], { identification_client: 'F2023-0001' }))).toBe('client_inconnu')
    expect([...identificationsAdmises(DOCUMENTS)].sort()).toEqual(
      ['999000102', '999000201', 'A2024-0001', 'F2024-0001', 'F2024-0002', 'F2024-0003', 'F2024-0004', 'F2024-0005'].sort())
  })
})

describe('l’essai joue chaque refus neuf, et la ligne qu’on scinderait', () => {
  const essai = readFileSync(new URL('../../supabase/essais/validationExercice.sql', import.meta.url), 'utf8')
  it('chaque refus y est attendu, sous son code, mots pour mots', () => {
    for (const r of REFUS_DES_CHAMPS_BNC) {
      expect(essai, r.cle).toContain(`'${r.code}',\n      '${r.message.replace(/'/g, "''")}'],`)
    }
  })
  it('les débours et les honoraires rétrocédés y sont joués : sur un produit refusés, sur une charge admis, des deux portes', () => {
    for (const poste of ['Honoraires rétrocédés', 'Débours payés pour le compte des clients']) {
      // La ligne 3 de K est le produit de la vente (706000), la ligne 0 la charge de l'achat (606100).
      expect(essai, poste).toContain(`jsonb_set({JK}, '{3,poste_rattache}', '"${poste}"'){FIN}$q$, '22023'`)
      expect(essai, poste).toContain(`jsonb_set({JK}, '{0,poste_rattache}', '"${poste}"'){FIN}$q$, 'OK'`)
    }
    // La restauration : une rétrocession sur un produit se refuse, sur une charge (622600) se réinsère.
    expect(essai).toContain("'706000', 'ESSAI', 1, 'credit', 'validee', now(), 'VE', 2, 'x', '2024-04-03', 'Honoraires', null, null, 'Recette', 'Honoraires rétrocédés', null)$q$, '23514'")
    expect(essai).toContain("'622600', 'ESSAI', 1, 'debit', 'validee', now(), 'AC', 2, 'x', '2024-04-03', 'Rétrocessions', null, null, 'Dépense', 'Honoraires rétrocédés', null)$q$, 'OK'")
  })
  it('les étapes du lot attendent la migration, et la ligne scindée entre deux écritures s’y refuse', () => {
    expect(essai).toContain("and attname = 'nature_operation' and not attisdropped")
    expect(essai).toContain('150. EN ATTENTE de la migration champs_bnc_du_fec (lot FEC22b)')
    for (const etape of ['166. une ligne scindée entre deux écritures', '166b.', '166c.']) expect(essai, etape).toContain(etape)
  })
})
