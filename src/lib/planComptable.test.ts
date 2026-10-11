import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as comptes from './comptes'
import { auxiliaireDuTiers } from './engagement'
import {
  definitionDuRole,
  memeCompteAuxZerosPres,
  sousUneRacineDuRole,
  FORME_COMPTE_DE_ROLE,
  FORME_PREFIXE_AUXILIAIRE,
  PLAN_DECALE,
  PLAN_PAR_DEFAUT,
  PREFIXES_DECALES,
  ROLES_COMPTABLES,
  type CleRoleComptable,
} from './planComptable'
import { derniereDefinitionSql, fichiersDuSchema } from '../test/schema'

// LE CATALOGUE DES RÔLES (ligne 43, étape PC1) EST CONFRONTÉ À TROIS SOURCES QUI NE SE RECOPIENT PAS L'UNE L'AUTRE : le
// texte de la migration appliquée (ce que la base a reçu), les constantes de lib/comptes.ts et les préfixes de
// lib/engagement.ts (ce que l'application écrit aujourd'hui), et des défauts ÉPINGLÉS ici, à la main. Une seule source
// changée fait virer ce test au rouge : changer le défaut d'un rôle existant changerait les comptes de tout dossier qui ne
// le règle pas, sans un mot.

const RACINE = new URL('../../', import.meta.url)

function migrationDuPlan(): string {
  const nom = readdirSync(new URL('supabase/schema/', RACINE)).filter((n) => /^\d{14}_plan_comptable_des_dossiers\.sql$/.test(n))
  if (nom.length !== 1) throw new Error(`migration plan_comptable_des_dossiers introuvable ou en double : ${nom.join(', ')}`)
  return readFileSync(new URL(`supabase/schema/${nom[0]}`, RACINE), 'utf8')
}

const ESSAI = readFileSync(new URL('supabase/essais/planComptable.sql', RACINE), 'utf8')

type Valeur = string | number | null

/** Les n-uplets d'une liste `values (…), (…)` : chaînes SQL (`''` est une quote), `null` et entiers ; jusqu'au `;` ou à la
 *  parenthèse qui ferme la liste. Toute autre forme lève : un lecteur qui devinerait ferait passer un texte faux. */
export function nUplets(texte: string, debut: number): Valeur[][] {
  const lignes: Valeur[][] = []
  let i = debut
  const blancs = () => { while (i < texte.length && /[\s,]/.test(texte[i])) i++ }
  for (;;) {
    blancs()
    if (texte[i] !== '(') break
    i++
    const ligne: Valeur[] = []
    for (;;) {
      while (/\s/.test(texte[i])) i++
      if (texte[i] === "'") {
        let s = ''
        i++
        for (;;) {
          if (texte[i] === "'" && texte[i + 1] === "'") { s += "'"; i += 2; continue }
          if (texte[i] === "'") { i++; break }
          if (i >= texte.length) throw new Error('chaîne jamais refermée')
          s += texte[i++]
        }
        ligne.push(s)
      } else if (texte.startsWith('null', i)) {
        ligne.push(null)
        i += 4
      } else {
        const m = /^-?\d+/.exec(texte.slice(i))
        if (!m) throw new Error(`valeur illisible : ${texte.slice(i, i + 30)}`)
        ligne.push(Number(m[0]))
        i += m[0].length
      }
      while (/\s/.test(texte[i])) i++
      if (texte[i] === ',') { i++; continue }
      if (texte[i] === ')') { i++; break }
      throw new Error(`n-uplet mal formé : ${texte.slice(i, i + 30)}`)
    }
    lignes.push(ligne)
  }
  return lignes
}

/** Le catalogue tel que la migration l'insère, colonne par colonne. */
function catalogueDeLaMigration(texte: string) {
  const tete = 'insert into public.roles_comptables (role, racines, compte_defaut, libelle_defaut, prefixe_auxiliaire_defaut, ordre) values'
  const debut = texte.indexOf(tete)
  if (debut < 0 || texte.indexOf(tete, debut + 1) >= 0) throw new Error('insertion du catalogue introuvable ou en double')
  return nUplets(texte, debut + tete.length).map(([role, racines, compte, libelle, prefixe, ordre]) => {
    const r = /^\{([0-9,]+)\}$/.exec(String(racines))
    if (!r) throw new Error(`racines illisibles : ${String(racines)}`)
    return { role, racines: r[1].split(','), compteDefaut: compte, libelleDefaut: libelle, prefixeAuxiliaireDefaut: prefixe, ordre }
  })
}

// Le plan par défaut, ÉPINGLÉ À LA MAIN : ni recopié du module, ni de comptes.ts. Un défaut changé ici exige d'abord de
// poser le défaut actuel dans chaque dossier écrit qui ne règle pas ce rôle (conception, §5.4).
const DEFAUTS_EPINGLES: Record<CleRoleComptable, string> = {
  banque: '512000',
  tva_deductible: '445660',
  tva_immobilisations: '445620',
  tva_collectee: '445710',
  tva_a_decaisser: '445510',
  credit_tva_a_reporter: '445670',
  remboursement_tva_demande: '445830',
  arrondi_charge: '658000',
  arrondi_produit: '758000',
  fournisseurs: '401000',
  fournisseurs_immobilisations: '404000',
  clients: '411000',
  exploitant: '108000',
  associe: '455000',
  autres_debiteurs_crediteurs: '467000',
  emprunt: '164000',
  interets_emprunt: '661100',
  assurance_emprunt: '616800',
  cotisations_exploitant: '646000',
  dotations_amortissements: '681100',
  indemnites_kilometriques: '625110',
  virements_internes: '580000',
  depots_cautionnements_verses: '275000',
  capital_individuel: '101000',
  resultat_benefice: '120000',
  resultat_perte: '129000',
}

// Chaque rôle face à la constante de lib/comptes.ts qu'il remplacera (étape PC3).
const CONSTANTE_DU_ROLE: Record<CleRoleComptable, keyof typeof comptes> = {
  banque: 'COMPTE_BANQUE',
  tva_deductible: 'COMPTE_TVA_DEDUCTIBLE',
  tva_immobilisations: 'COMPTE_TVA_IMMOBILISATIONS',
  tva_collectee: 'COMPTE_TVA_COLLECTEE',
  tva_a_decaisser: 'COMPTE_TVA_A_DECAISSER',
  credit_tva_a_reporter: 'COMPTE_CREDIT_TVA_A_REPORTER',
  remboursement_tva_demande: 'COMPTE_REMBOURSEMENT_TVA_DEMANDE',
  arrondi_charge: 'COMPTE_ARRONDIS_CHARGE',
  arrondi_produit: 'COMPTE_ARRONDIS_PRODUIT',
  fournisseurs: 'COMPTE_FOURNISSEURS',
  fournisseurs_immobilisations: 'COMPTE_FOURNISSEURS_IMMOBILISATIONS',
  clients: 'COMPTE_CLIENTS',
  exploitant: 'COMPTE_EXPLOITANT',
  associe: 'COMPTE_COURANT_ASSOCIE',
  autres_debiteurs_crediteurs: 'COMPTE_AUTRES_DEBITEURS_CREDITEURS',
  emprunt: 'COMPTE_EMPRUNT',
  interets_emprunt: 'COMPTE_INTERETS_EMPRUNT',
  assurance_emprunt: 'COMPTE_ASSURANCE_EMPRUNT',
  cotisations_exploitant: 'COMPTE_COTISATIONS_EXPLOITANT',
  dotations_amortissements: 'COMPTE_DOTATIONS_AMORTISSEMENTS',
  indemnites_kilometriques: 'COMPTE_INDEMNITES_KILOMETRIQUES',
  virements_internes: 'COMPTE_VIREMENTS_INTERNES',
  depots_cautionnements_verses: 'COMPTE_DEPOTS_ET_CAUTIONNEMENTS_VERSES',
  capital_individuel: 'COMPTE_CAPITAL_INDIVIDUEL',
  resultat_benefice: 'COMPTE_RESULTAT_BENEFICE',
  resultat_perte: 'COMPTE_RESULTAT_PERTE',
}

const ROLES = ROLES_COMPTABLES.map((r) => r.role)

describe('le catalogue des rôles comptables', () => {
  it('est celui que la migration a inséré, rôle par rôle et colonne par colonne', () => {
    const migration = catalogueDeLaMigration(migrationDuPlan())
    expect(migration).toHaveLength(26)
    expect(migration).toEqual(ROLES_COMPTABLES.map((r) => ({ ...r, racines: [...r.racines] })))
  })

  it('a l’empreinte que l’essai en base exige du catalogue vivant', () => {
    // La même ligne canonique des deux côtés : « rôle|racines|compte|libellé|préfixe|ordre », dans l'ordre du catalogue.
    const canonique = ROLES_COMPTABLES.map((r) =>
      [r.role, r.racines.join(','), r.compteDefaut, r.libelleDefaut ?? '', r.prefixeAuxiliaireDefaut ?? '', String(r.ordre)].join('|'),
    ).join('\n')
    const epinglee = /empreinte_catalogue constant text := '([0-9a-f]{32})'/.exec(ESSAI)?.[1]
    expect(epinglee).toBeDefined()
    expect(createHash('md5').update(canonique, 'utf8').digest('hex')).toBe(epinglee)
  })

  it('tient vingt-six rôles distincts, dans un ordre de dix en dix, chacun sous une racine du PCG', () => {
    expect(new Set(ROLES).size).toBe(26)
    expect(ROLES_COMPTABLES.map((r) => r.ordre)).toEqual(ROLES_COMPTABLES.map((_, i) => (i + 1) * 10))
    for (const r of ROLES_COMPTABLES) {
      expect(r.role, r.role).toMatch(/^[a-z][a-z_]*[a-z]$/)
      expect(r.racines.length, r.role).toBeGreaterThan(0)
      for (const racine of r.racines) expect(racine, r.role).toMatch(/^[1-7][0-9]{1,4}$/)
      expect(r.compteDefaut, r.role).toMatch(FORME_COMPTE_DE_ROLE)
      expect(sousUneRacineDuRole(r.role, r.compteDefaut), r.role).toBe(true)
    }
  })

  it('ne met jamais deux rôles sur le même compte, même à des zéros près (PCG, art. 1131-2)', () => {
    for (const a of ROLES_COMPTABLES) {
      for (const b of ROLES_COMPTABLES) {
        if (a.role < b.role) expect(memeCompteAuxZerosPres(a.compteDefaut, b.compteDefaut), `${a.role} / ${b.role}`).toBe(false)
      }
    }
  })

  it('ne donne au dirigeant non associé que le 467 : permettre le 468 est la question Q7, que PC1 ne tranche pas', () => {
    expect(definitionDuRole('autres_debiteurs_crediteurs')?.racines).toEqual(['467'])
    expect(sousUneRacineDuRole('autres_debiteurs_crediteurs', '468000')).toBe(false)
  })
})

describe('le plan par défaut', () => {
  it('EST les constantes d’aujourd’hui (lib/comptes.ts), une par rôle, et toutes', () => {
    for (const role of ROLES) expect(PLAN_PAR_DEFAUT[role], role).toBe(comptes[CONSTANTE_DU_ROLE[role]])
    // Les vingt-six constantes de comptes, sans en oublier une ni en compter une deux fois.
    const constantes = Object.keys(comptes).filter((n) => n.startsWith('COMPTE_')).sort()
    expect(Object.values(CONSTANTE_DU_ROLE).sort()).toEqual(constantes)
  })

  it('est ÉPINGLÉ', () => {
    expect(PLAN_PAR_DEFAUT).toEqual(DEFAUTS_EPINGLES)
    expect(Object.isFrozen(PLAN_PAR_DEFAUT)).toBe(true)
  })

  it('porte les libellés que l’application donne aujourd’hui, et aucun au capital ni au résultat', () => {
    // `LIBELLES_COMPTES` exclut à dessein les trois comptes du report : leur libellé est celui que le report leur donne.
    for (const r of ROLES_COMPTABLES) expect(r.libelleDefaut, r.role).toBe(comptes.LIBELLES_COMPTES[r.compteDefaut] ?? null)
    expect(ROLES_COMPTABLES.filter((r) => r.libelleDefaut === null).map((r) => r.role))
      .toEqual(['capital_individuel', 'resultat_benefice', 'resultat_perte'])
    // Et aucun libellé de comptes.ts n'est laissé hors du catalogue.
    expect(Object.keys(comptes.LIBELLES_COMPTES).sort()).toEqual(
      ROLES_COMPTABLES.filter((r) => r.libelleDefaut !== null).map((r) => r.compteDefaut).sort())
  })

  it('porte les préfixes des comptes auxiliaires que lib/engagement.ts écrit, sur les trois rôles de tiers seulement', () => {
    for (const r of ROLES_COMPTABLES) {
      const auxiliaire = auxiliaireDuTiers({ tiers: null }, r.compteDefaut)
      expect(auxiliaire ? auxiliaire.num.replace(/DIVERS$/, '') : null, r.role).toBe(r.prefixeAuxiliaireDefaut)
    }
    expect(ROLES_COMPTABLES.filter((r) => r.prefixeAuxiliaireDefaut !== null).map((r) => r.role))
      .toEqual(['fournisseurs', 'fournisseurs_immobilisations', 'clients'])
  })
})

describe('le plan décalé (fictif, pour les étapes suivantes)', () => {
  it('règle chaque rôle, sur un autre compte que son défaut, que la garde accepterait', () => {
    expect(Object.keys(PLAN_DECALE).sort()).toEqual([...ROLES].sort())
    for (const role of ROLES) {
      expect(PLAN_DECALE[role], role).not.toBe(PLAN_PAR_DEFAUT[role])
      expect(PLAN_DECALE[role], role).toMatch(FORME_COMPTE_DE_ROLE)
      expect(sousUneRacineDuRole(role, PLAN_DECALE[role]), role).toBe(true)
    }
  })

  it('ne met jamais deux rôles sur le même compte, même à des zéros près, ni sur le défaut d’un autre', () => {
    for (const a of ROLES) {
      for (const b of ROLES) {
        if (a === b) continue
        expect(memeCompteAuxZerosPres(PLAN_DECALE[a], PLAN_DECALE[b]), `${a} / ${b}`).toBe(false)
        expect(memeCompteAuxZerosPres(PLAN_DECALE[a], PLAN_PAR_DEFAUT[b]), `${a} / défaut de ${b}`).toBe(false)
      }
    }
  })

  it('porte des préfixes bien formés, distincts entre eux et de ceux du catalogue', () => {
    const prefixes = Object.values(PREFIXES_DECALES)
    expect(new Set(prefixes).size).toBe(3)
    for (const p of prefixes) {
      expect(p).toMatch(FORME_PREFIXE_AUXILIAIRE)
      expect(ROLES_COMPTABLES.map((r) => r.prefixeAuxiliaireDefaut)).not.toContain(p)
    }
  })

  it('est celui que l’essai en base fait écrire et relire (contrôle 32)', () => {
    const tete = 'select dossier_libre, v.role, v.compte, v.prefixe from (values'
    const debut = ESSAI.indexOf(tete)
    expect(debut).toBeGreaterThan(0)
    const lignes = nUplets(ESSAI, debut + tete.length)
    expect(Object.fromEntries(lignes.map(([role, compte]) => [role, compte]))).toEqual(PLAN_DECALE)
    expect(Object.fromEntries(lignes.filter(([, , prefixe]) => prefixe !== null).map(([role, , prefixe]) => [role, prefixe])))
      .toEqual(PREFIXES_DECALES)
  })
})

describe('la garde du plan (`garder_plan_comptable_dossier`)', () => {
  const garde = () => derniereDefinitionSql('garder_plan_comptable_dossier')

  it('exige la forme que ce module recopie : six chiffres (hypothèse Q5), un préfixe d’une à cinq lettres ou chiffres', () => {
    expect(garde()).toContain(`if new.compte !~ '${FORME_COMPTE_DE_ROLE.source}' then`)
    expect(garde()).toContain(`if new.prefixe_auxiliaire !~ '${FORME_PREFIXE_AUXILIAIRE.source}' then`)
  })

  it('juge la racine comme ce module : le compte commence par l’une des racines du rôle', () => {
    expect(garde()).toContain('where left(new.compte, length(x.racine)) = x.racine')
    expect(sousUneRacineDuRole('banque', '512100')).toBe(true)
    expect(sousUneRacineDuRole('banque', '511000')).toBe(false)
    // La racine EN TÊTE, comme `left(compte, length(racine))` : la retrouver au milieu du numéro ne suffit pas.
    expect(sousUneRacineDuRole('banque', '451200')).toBe(false)
    expect(sousUneRacineDuRole('interets_emprunt', '661200')).toBe(false)
    expect(sousUneRacineDuRole('virements_internes', '581000')).toBe(true)
  })

  it('reconnaît deux numéros qui ne diffèrent que par leurs zéros de fin, et eux seuls', () => {
    expect(memeCompteAuxZerosPres('445510', '4455100')).toBe(true)
    expect(memeCompteAuxZerosPres('512000', '512')).toBe(true)
    expect(memeCompteAuxZerosPres('512000', '512100')).toBe(false)
    expect(memeCompteAuxZerosPres('101000', '110000')).toBe(false)
  })

  it('ne connaît pas un rôle que le catalogue ignore', () => {
    expect(definitionDuRole('role_d_une_base_plus_recente')).toBeUndefined()
    expect(definitionDuRole('banque')?.compteDefaut).toBe('512000')
  })
})

// La DERNIÈRE définition de chaque fonction de l'export — celle que la base exécute —, quel que soit le délimiteur de son
// corps : `derniereDefinitionSql` ne lit que `$$`, et une fonction de l'export s'écrit entre `$function$`. Rend, par nom,
// la définition jusqu'au délimiteur qui ferme le corps, et le corps seul : ce que `pg_proc.prosrc` porte en base.
function dernieresDefinitions(): Map<string, { definition: string; corps: string }> {
  const vues = new Map<string, { definition: string; corps: string }>()
  for (const { texte } of fichiersDuSchema()) {
    for (const m of texte.matchAll(/create (?:or replace )?function public\.(\w+)\(/g)) {
      const ouverture = /\bas\s+(\$\w*\$)/i.exec(texte.slice(m.index))
      if (!ouverture) throw new Error(`Corps de ${m[1]} introuvable dans le schéma exporté.`)
      const debutDuCorps = m.index + ouverture.index + ouverture[0].length
      const fin = texte.indexOf(ouverture[1], debutDuCorps)
      if (fin < 0) throw new Error(`Fin du corps de ${m[1]} introuvable dans le schéma exporté.`)
      vues.set(m[1], { definition: texte.slice(m.index, fin), corps: texte.slice(debutDuCorps, fin) })
    }
  }
  return vues
}

// « compte_du_dirigeant comme le case recopié dans les fonctions d'aujourd'hui, à prouver contre leur texte » : prouvé à
// l'étape PC1, contre les cinq qui le recopiaient ; depuis l'étape PC2, elles l'appellent à sa place. L'essai (contrôles
// 8 et 9) évalue de plus ces expressions telles que la base les porte, sur chaque dossier.
describe('compte_du_dirigeant remplace le case que cinq fonctions recopiaient', () => {
  it('les cinq l’appellent, une fois chacune — et plus aucune fonction ne recopie le case', () => {
    const definitions = new Map([...dernieresDefinitions()].map(([nom, d]) => [nom, d.definition]))
    // Le plancher qui distingue « aucune porteuse » d'un lecteur devenu aveugle : l'export compte 107 fonctions au
    // 10/10/2026, dont `compte_du_dirigeant`.
    expect(definitions.size).toBeGreaterThanOrEqual(107)
    expect(definitions.has('compte_du_dirigeant')).toBe(true)
    expect([...definitions].filter(([, corps]) => /else '108000' end/.test(corps)).map(([nom]) => nom)).toEqual([])
    const lectrices = [...definitions]
      .filter(([nom, corps]) => nom !== 'compte_du_dirigeant' && /public\.compte_du_dirigeant\(/.test(corps))
      .map(([nom]) => nom).sort()
    expect(lectrices).toEqual([
      'classer_virement_personnel', 'ecrire_forfait_kilometrique', 'ecrire_mouvement_compte_bilan',
      'enregistrer_paiement_personnel_cotisation', 'ventiler_mouvement_bancaire',
    ])
    for (const nom of lectrices) {
      expect(definitions.get(nom)!.match(/public\.compte_du_dirigeant\(/g), nom).toHaveLength(1)
      // Et c'est la définition que `derniereDefinitionSql` lit aussi : les deux lecteurs s'accordent.
      expect(definitions.get(nom)).toBe(derniereDefinitionSql(nom))
    }
  })

  it('la fonction rend la même expression, le 108000 lu dans le plan au rôle de l’exploitant', () => {
    const definition = derniereDefinitionSql('compte_du_dirigeant')
    expect(definition).toContain("select case when d.mode_comptable = 'engagement' then d.compte_notes_de_frais\n"
      + "              else public.compte_du_role(d.id, 'exploitant') end\n"
      + '    from public.dossiers d\n'
      + '   where d.id = p_dossier_id')
    expect(PLAN_PAR_DEFAUT.exploitant).toBe('108000')
    // Le compte d'un rôle sans ligne : le défaut du catalogue, que le test du catalogue confronte à la migration.
    expect(derniereDefinitionSql('compte_du_role')).toContain('select coalesce(p.compte, r.compte_defaut) into v_compte')
  })
})

// LA BASE LIT LE PLAN (étape PC2). Six migrations, `la_base_lit_le_plan_1` à `_6`, font lire aux quatorze fonctions de la
// conception (§ 2.3) le compte de chaque rôle dans le plan du dossier ; elles se COLLENT par le cabinet. Leur essai en
// base, supabase/essais/laBaseLitLePlan.sql, porte ce qui se confronte ici : le plan décalé qu'il pose, ce qu'il attend
// de chaque fonction, et `pc2_exigee` — vrai seulement quand l'export porte les six migrations, comme dans
// planComptable.sql. Avant, une fonction qui ne lit pas encore le plan s'y dit EN ATTENTE ; après, c'est une faute.
const ESSAI_PC2 = readFileSync(new URL('supabase/essais/laBaseLitLePlan.sql', RACINE), 'utf8')
const PC2_EXPORTEE = readdirSync(new URL('supabase/schema/', RACINE)).some((n) => /^\d{14}_la_base_lit_le_plan_6\.sql$/.test(n))

/** Ce que l'essai attend d'une des quatorze : ses rôles, son dirigeant, le dossier de son verrou (nul pour une lectrice),
 *  les expressions qui désignent ce dossier dans une lecture du plan, et sa forme. */
interface FonctionQuiLitLePlan {
  f: string
  roles: string
  dirigeant: boolean
  verrou: string | null
  lus: string[]
  forme: string
}

function quatorzeDeLEssai(): FonctionQuiLitLePlan[] {
  const m = /\n {2}quatorze constant jsonb := '(\[[\s\S]*?\])';\n/.exec(ESSAI_PC2)
  if (!m) throw new Error('la liste des quatorze est introuvable dans l’essai')
  return JSON.parse(m[1]) as FonctionQuiLitLePlan[]
}

function pc2Exigee(texte: string): boolean {
  const m = [...texte.matchAll(/\bpc2_exigee constant boolean := (true|false);/g)]
  if (m.length !== 1) throw new Error(`pc2_exigee introuvable ou en double (${m.length})`)
  return m[0][1] === 'true'
}

// Les quatorze de la conception (§ 2.3), recopiées à la main : l'inventaire refait le 10/10/2026 sur la production n'en a
// trouvé ni une de plus, ni une de moins.
const QUATORZE = [
  'affecter_mouvement_bancaire', 'classer_virement_personnel', 'ecrire_mouvement_compte_bilan', 'ventiler_mouvement_bancaire',
  'rapprocher_echeance_emprunt', 'rapprocher_cotisation', 'rapprocher_declaration_tva', 'ecrire_dotation_amortissement',
  'ecrire_forfait_kilometrique', 'ecrire_liquidation_tva', 'liquidation_attendue', 'lettrer_pieces', 'soldes_a_reporter',
  'enregistrer_paiement_personnel_cotisation',
]

describe('l’essai de la base qui lit le plan (étape PC2)', () => {
  it('pose le plan décalé de ce module, rôle par rôle', () => {
    const tete = 'select %L, v.role, v.compte from (values'
    const debut = ESSAI_PC2.indexOf(tete)
    expect(debut).toBeGreaterThan(0)
    expect(ESSAI_PC2.indexOf(tete, debut + 1)).toBe(-1)
    const lignes = nUplets(ESSAI_PC2, debut + tete.length)
    expect(Object.fromEntries(lignes.map(([role, compte]) => [role, compte]))).toEqual(PLAN_DECALE)
  })

  it('attend des quatorze de la conception des rôles du catalogue, et le verrou des seules qui écrivent', () => {
    const quatorze = quatorzeDeLEssai()
    expect(quatorze.map((q) => q.f.split('(')[0]).sort()).toEqual([...QUATORZE].sort())
    const definitions = dernieresDefinitions()
    for (const q of quatorze) {
      const nom = q.f.split('(')[0]
      expect(definitions.has(nom), nom).toBe(true)
      const roles = q.roles.split(',')
      // Dans l'ordre où la base les range (`collate "C"`), sans doublon, tous au catalogue.
      expect(roles, nom).toEqual([...new Set(roles)].sort())
      for (const role of roles) expect(ROLES, `${nom} : ${role}`).toContain(role)
      expect(q.verrou === null, nom).toBe(nom === 'liquidation_attendue' || nom === 'soldes_a_reporter')
      if (q.verrou !== null) expect(q.lus, nom).toContain(q.verrou === 'cle_validation' ? 'p_dossier_id' : q.verrou)
    }
    // Les cinq qui lisent le compte du dirigeant sont celles qui recopient le case jusqu'à l'étape PC2.
    expect(quatorze.filter((q) => q.dirigeant).map((q) => q.f.split('(')[0]).sort()).toEqual([
      'classer_virement_personnel', 'ecrire_forfait_kilometrique', 'ecrire_mouvement_compte_bilan',
      'enregistrer_paiement_personnel_cotisation', 'ventiler_mouvement_bancaire',
    ])
  })

  it('n’exige la lecture du plan, ici comme dans planComptable.sql, que lorsque l’export porte les six migrations', () => {
    expect(pc2Exigee(ESSAI_PC2)).toBe(PC2_EXPORTEE)
    expect(pc2Exigee(ESSAI)).toBe(PC2_EXPORTEE)
  })
})

// LA FORME QUE L'ESSAI EXIGE DE LA BASE (supabase/essais/laBaseLitLePlan.sql, contrôles 1 à 7), EXIGÉE ICI DU TEXTE
// EXPORTÉ — la dernière définition de chacune, celle que la base exécute : la CI ne joue pas l'essai, et une migration qui
// remettrait un compte en dur, lirait un rôle pour un autre ou le plan d'un autre dossier, ou retirerait le verrou, se
// verrait ici avant d'être appliquée. Les attentes sont celles de l'essai, lues dans son texte : une seule liste.
describe('les quatorze fonctions de la base lisent le plan (étape PC2)', () => {
  const definitions = dernieresDefinitions()
  // La clé du verrou de la validation, lue dans le corps de `cle_validation` : celle que les fonctions écrivent en ligne,
  // leur appelant n'exécutant pas `cle_validation`.
  const cle = /hashtextextended\(('[^']*') \|\| p_dossier_id::text, 0\)/.exec(derniereDefinitionSql('cle_validation'))?.[1]
  const DEFAUTS = ROLES_COMPTABLES.map((r) => r.compteDefaut)

  it('l’export porte les six migrations, et la clé du verrou se lit dans cle_validation', () => {
    expect(PC2_EXPORTEE).toBe(true)
    expect(cle).toBe("'jd.validation_exercice:'")
  })

  for (const q of quatorzeDeLEssai()) {
    const nom = q.f.split('(')[0]
    it(`${nom} : ses rôles, le dossier de l’appel, son verrou, aucun compte en dur, sa forme`, () => {
      const corps = definitions.get(nom)!.corps
      // Sa forme, celle que l'essai attend (contrôle 6) : sécurité, volatilité, langage, search_path — lus dans l'en-tête.
      const entete = definitions.get(nom)!.definition.split(/\bas\s+\$\w*\$/i)[0].toLowerCase()
      const [securite, volatilite, langage, reglages] = q.forme.split(':')
      expect(/\bsecurity\s+definer\b/.test(entete) ? 'definer' : 'invoker', `${nom} : sécurité`).toBe(securite)
      expect(/\bstable\b/.test(entete) ? 's' : /\bimmutable\b/.test(entete) ? 'i' : 'v', `${nom} : volatilité`).toBe(volatilite)
      expect(/\blanguage\s+(\w+)/.exec(entete)?.[1], `${nom} : langage`).toBe(langage)
      expect(/\bset\s+search_path\s*(?:=|to)\s*'?public'?/.test(entete) ? 'search_path=public' : '', `${nom} : réglages`).toBe(reglages)
      // Ses rôles, exactement, tous au catalogue ; le dirigeant par compte_du_dirigeant, jamais le case recopié.
      expect(ROLES.filter((role) => corps.includes(`'${role}'`)).sort(), nom).toEqual(q.roles.split(','))
      expect(corps.includes('public.compte_du_dirigeant('), nom).toBe(q.dirigeant)
      expect(corps, nom).not.toMatch(/else '108000' end/)
      // Aucun compte du catalogue entre apostrophes.
      expect(DEFAUTS.filter((compte) => corps.includes(`'${compte}'`)), nom).toEqual([])
      // Chaque lecture du plan porte le dossier de l'appel : `compte_du_role` rend le défaut d'un rôle pour un dossier
      // qu'il ne connaît pas, si bien qu'un autre identifiant passerait inaperçu tant qu'aucun plan n'est réglé.
      const lus = [
        ...[...corps.matchAll(/public\.compte_du_role\(\s*([^,]+?)\s*,/g)].map((m) => m[1]),
        ...[...corps.matchAll(/public\.compte_du_dirigeant\(\s*([^)]+?)\s*\)/g)].map((m) => m[1]),
      ]
      expect(lus.length, nom).toBeGreaterThan(0)
      for (const x of lus) expect(q.lus, `${nom} : ${x}`).toContain(x)
      // Le verrou partagé de son dossier, avant la première lecture du plan ; aucun dans une lectrice, qui se lit sous
      // celui de son appelante.
      const premiereLecture = Math.min(
        ...[corps.indexOf('public.compte_du_role('), corps.indexOf('public.compte_du_dirigeant(')].filter((i) => i >= 0))
      if (q.verrou === null) {
        expect(corps, nom).not.toMatch(/advisory/)
      } else {
        const verrou = q.verrou === 'cle_validation'
          ? 'perform pg_advisory_xact_lock_shared(public.cle_validation(p_dossier_id));'
          : `perform pg_advisory_xact_lock_shared(hashtextextended(${cle} || ${q.verrou}::text, 0));`
        const ici = corps.indexOf(verrou)
        expect(ici, `${nom} : le verrou`).toBeGreaterThanOrEqual(0)
        expect(ici, `${nom} : le verrou avant la lecture du plan`).toBeLessThan(premiereLecture)
      }
    })
  }
})

describe('le lecteur des n-uplets', () => {
  it('lit les chaînes, leurs quotes doublées, null et les entiers, et refuse ce qu’il ne connaît pas', () => {
    expect(nUplets(" ('a''b', null, 12), ('c', 'd', -3);", 0)).toEqual([["a'b", null, 12], ['c', 'd', -3]])
    expect(() => nUplets("('a', vrai)", 0)).toThrow('valeur illisible')
    expect(() => nUplets("('a' 'b')", 0)).toThrow('n-uplet mal formé')
  })
})
