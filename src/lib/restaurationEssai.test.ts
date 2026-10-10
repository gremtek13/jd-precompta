import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  CHEMINS_DOSSIER,
  ORDRE_RESTAURATION,
  TABLES_AUTO_REFERENCEES,
  TABLES_AUTO_REFERENCEES_PAR_VAGUES,
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

/** Chaque écart entre ce que le script recopie et ce que le code exécute, dit en une phrase. */
function ecartsAuCode(plan: PlanDeLEssai): string[] {
  const ecarts: string[] = []
  plan.ordre.forEach((o, i) => {
    if (o.rang !== i + 1) ecarts.push(`_ordre : le rang ${o.rang} est à la place ${i + 1}`)
  })
  const ordre = plan.ordre.map((o) => o.table)
  if (ordre.join(',') !== ORDRE_RESTAURATION.join(',')) {
    const manquantes = ORDRE_RESTAURATION.filter((t) => !ordre.includes(t))
    const enTrop = ordre.filter((t) => !ORDRE_RESTAURATION.includes(t))
    const premier = ordre.findIndex((t, i) => t !== ORDRE_RESTAURATION[i])
    ecarts.push(`_ordre diffère d'ORDRE_RESTAURATION (manquantes : ${manquantes.join(', ') || 'aucune'} ; en trop : `
      + `${enTrop.join(', ') || 'aucune'} ; premier écart au rang ${premier + 1})`)
  }
  for (const [table, chemin] of Object.entries(CHEMINS_DOSSIER)) {
    const recopie = plan.chemins[table]
    const attendu = cheminAttendu(chemin)
    if (!recopie) ecarts.push(`_chemins : ${table} manque`)
    else if (JSON.stringify(recopie) !== JSON.stringify(attendu)) {
      ecarts.push(`_chemins : ${table} vaut ${JSON.stringify(recopie)}, le code ${JSON.stringify(attendu)}`)
    }
  }
  for (const table of Object.keys(plan.chemins)) {
    if (!(table in CHEMINS_DOSSIER)) ecarts.push(`_chemins : ${table} n'est pas dans CHEMINS_DOSSIER`)
  }
  if (JSON.stringify(plan.vagues) !== JSON.stringify(TABLES_AUTO_REFERENCEES_PAR_VAGUES)) {
    ecarts.push(`_vagues vaut ${JSON.stringify(plan.vagues)}, TABLES_AUTO_REFERENCEES_PAR_VAGUES `
      + JSON.stringify(TABLES_AUTO_REFERENCEES_PAR_VAGUES))
  }
  if (JSON.stringify(plan.deuxPasses) !== JSON.stringify(TABLES_AUTO_REFERENCEES)) {
    ecarts.push(`la seconde passe du script vise ${JSON.stringify(plan.deuxPasses)}, TABLES_AUTO_REFERENCEES `
      + JSON.stringify(TABLES_AUTO_REFERENCEES))
  }
  const accesDuCode = [...new Set(Object.values(CHEMINS_DOSSIER).map((c) => c.acces))].sort()
  for (const acces of accesDuCode) {
    if (!plan.accesTraites.includes(acces)) ecarts.push(`aucune branche du script ne traite l'accès « ${acces} »`)
  }
  return ecarts
}

describe('l’essai de restauration rejoue le plan du code', () => {
  const plan = planDeLEssai(texteDeLEssai)

  it('le script a été lu : une table par rang, un chemin par table, des vagues', () => {
    // Le plancher qui distingue « zéro écart » d'« aveugle » : un bloc que l'analyse ne reconnaîtrait plus rendrait des
    // listes vides, que les écarts diraient aussi — mais ce test dit lequel.
    expect(plan.ordre).toHaveLength(ORDRE_RESTAURATION.length)
    expect(Object.keys(plan.chemins)).toHaveLength(Object.keys(CHEMINS_DOSSIER).length)
    expect(plan.vagues.length).toBeGreaterThan(0)
    expect(plan.deuxPasses.length).toBeGreaterThan(0)
  })

  it('l’ordre, les chemins, les vagues, la seconde passe et les accès sont ceux du code', () => {
    expect(ecartsAuCode(plan)).toEqual([])
  })

  it('les vagues partent une instruction par vague, sur chacun des liens de la table', () => {
    // La condition d'une vague : chaque lien vide, hors du dossier, ou déjà écrit — celle de `vaguesParLien`.
    expect(texteDeLEssai).toContain(`'(s.%1$I is null or s.%1$I not in (select x.id from public.%2$I x where x.dossier_id = $1)'`)
    expect(texteDeLEssai).toContain(`' or s.%1$I in (select y.id from essai_restauration.%2$I y))', v.colonne, r.table_nom), ' and ')`)
    expect(texteDeLEssai).toContain('exit when ecrits = 0;')
  })

  describe('un défaut planté se voit', () => {
    const remplacer = (avant: string, apres: string) => {
      expect(texteDeLEssai).toContain(avant)
      return ecartsAuCode(planDeLEssai(texteDeLEssai.replace(avant, apres)))
    }

    it('deux tables échangées dans l’ordre', () => {
      const ecarts = remplacer("(59,'revision_justifications'),(60,'revision_preuves')", "(59,'revision_preuves'),(60,'revision_justifications')")
      expect(ecarts.join('\n')).toContain('premier écart au rang 59')
    })

    it('une table oubliée dans l’ordre', () => {
      const ecarts = remplacer(",(60,'revision_preuves'),(61,'exercices_valides')", ",(60,'exercices_valides')")
      expect(ecarts.join('\n')).toContain('manquantes : revision_preuves')
    })

    it('un rang sauté', () => {
      expect(remplacer("(61,'exercices_valides')", "(62,'exercices_valides')")).toContain('_ordre : le rang 62 est à la place 61')
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
