import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { comptesLettrables } from './lettrage'
import {
  FORME_COMPTE_DE_ROLE,
  FORME_PREFIXE_AUXILIAIRE,
  PLAN_DECALE,
  ROLES_COMPTABLES,
  ROLES_DU_DIRIGEANT,
  type CleRoleComptable,
} from './planComptable'
import { CAS_DU_PLAN } from '../test/compositionsAuPlan'
import { derniereDefinitionSql } from '../test/schema'

// PC4 — RÉGLER LE PLAN D'UN DOSSIER (ligne 43 ; la migration `regler_le_plan_du_dossier`, préparée le 10/11/2026 ;
// HISTORIQUE.md, « 10/11/2026 — PC4 : RÉGLER LE PLAN D'UN DOSSIER, EN BASE (PRÉPARÉE, PAS APPLIQUÉE) »). La migration
// nomme des rôles que l'application tient aussi : les trois du dirigeant (`ROLES_DU_DIRIGEANT`, que `roleDuDirigeant`
// lit), les cinq qui se lettrent (`comptesLettrables`, comme `lettrer_pieces` depuis PC2), et ceux dont la génération des
// pièces écrit le compte (la garde des lignes de pièce). Ce test les confronte, pour qu'une liste ne bouge pas sans
// l'autre ; il exige aussi de la garde du plan les lignes que planComptable.test.ts lit (le jour où le fichier entre dans
// l'export, il les y trouve), et du retour la garde de l'étape PC1 au caractère près. Les refus, l'ordre, le verrou et
// la neutralité se rejouent en base : supabase/essais/reglerLePlanDuDossier.sql.

const RACINE = new URL('../../', import.meta.url)
const NOM = 'regler_le_plan_du_dossier'

/** La migration : préparée (supabase/preparees/), ou dans l'export sous la version de son application — le même texte. */
function laMigration(): string {
  const chemins = ['supabase/preparees/', 'supabase/schema/'].flatMap((d) =>
    existsSync(new URL(d, RACINE)) ? readdirSync(new URL(d, RACINE)).filter((n) => new RegExp(`^\\d{14}_${NOM}\\.sql$`).test(n)).map((n) => d + n) : [])
  if (chemins.length !== 1) throw new Error(`migration ${NOM} introuvable ou en double : ${chemins.join(', ')}`)
  return readFileSync(new URL(chemins[0], RACINE), 'utf8')
}

/** Le corps d'une fonction de la migration, entre ses deux `$$`. */
function corps(texte: string, fonction: string): string {
  const debut = texte.indexOf(`function public.${fonction}(`)
  if (debut < 0) throw new Error(`${fonction} introuvable`)
  const ouvre = texte.indexOf('$$', debut) + 2
  return texte.slice(ouvre, texte.indexOf('$$', ouvre))
}

/** Les rôles d'une liste `r.role in ('…', '…')`, la n-ième du texte. */
function listeDeRoles(texte: string, rang = 0): string[] {
  const listes = [...texte.matchAll(/r\.role in \(([^)]*)\)/g)].map((m) => [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]))
  if (!listes[rang]) throw new Error(`liste de rôles n° ${rang} introuvable`)
  return listes[rang]
}

/** Les rôles que le texte lit par `compte_du_role(…, 'rôle')`. */
const rolesLus = (texte: string) => [...new Set([...texte.matchAll(/compte_du_role\([^,]+, '([a-z_]+)'\)/g)].map((m) => m[1]))]

const trie = (x: Iterable<string>) => [...x].sort()
const ROLE_DU_COMPTE_DECALE = new Map(Object.entries(PLAN_DECALE).map(([role, compte]) => [compte, role as CleRoleComptable]))

describe('la migration de PC4 et l’application nomment les mêmes rôles', () => {
  const migration = laMigration()

  it('les trois rôles du dirigeant : la fonction, le contrôle du dossier et celui du plan, comme `roleDuDirigeant`', () => {
    const attendus = trie(ROLES_DU_DIRIGEANT)
    expect(trie(listeDeRoles(corps(migration, 'regler_plan_du_dossier')))).toEqual(attendus)
    const dossier = corps(migration, 'garder_compte_du_dirigeant')
    expect(trie(rolesLus(dossier))).toEqual(attendus)
    expect(trie(listeDeRoles(dossier))).toEqual(attendus)
    expect(trie(rolesLus(corps(migration, 'garder_dirigeant_du_plan')))).toEqual(attendus)
  })

  it('les cinq rôles qui se lettrent : le contrôle des lettrages, `comptesLettrables` et `lettrer_pieces`', () => {
    const application = comptesLettrables(PLAN_DECALE).map((compte) => ROLE_DU_COMPTE_DECALE.get(compte))
    expect(application).not.toContain(undefined)
    expect(trie(rolesLus(corps(migration, 'garder_compte_lettrable')))).toEqual(trie(application as string[]))
    expect(trie(rolesLus(derniereDefinitionSql('lettrer_pieces')))).toEqual(trie(application as string[]))
  })

  it('la garde des lignes de pièce surveille exactement les rôles dont la génération des pièces écrit le compte', () => {
    const surveilles = listeDeRoles(corps(migration, 'garder_comptes_des_pieces'))
    const racines = new Map(ROLES_COMPTABLES.map((r) => [r.role as string, r.racines as readonly string[]]))
    // Chaque ligne de PIÈCE que les cas des compositions rendent sous le plan décalé (où aucun compte de rôle n'est celui
    // d'une catégorie ou d'un bien des jeux) : son compte, s'il est celui d'un rôle, est celui d'un rôle surveillé ; et
    // s'il commence par la racine d'un rôle surveillé, c'est le compte de ce rôle — la ligne passe la garde.
    const lignes: { compte: string }[] = []
    const cueillir = (x: unknown): void => {
      if (Array.isArray(x)) x.forEach(cueillir)
      else if (x && typeof x === 'object') {
        const o = x as Record<string, unknown>
        if (typeof o.compte === 'string' && typeof o.piece_id === 'string') lignes.push({ compte: o.compte })
        else Object.values(o).forEach(cueillir)
      }
    }
    for (const cas of CAS_DU_PLAN) cueillir(cas.composer(PLAN_DECALE))
    // Le plancher : un relevé devenu aveugle ne prouverait rien.
    expect(lignes.length).toBeGreaterThan(40)
    const ecrits = new Set<string>()
    for (const { compte } of lignes) {
      const role = ROLE_DU_COMPTE_DECALE.get(compte)
      if (role) {
        expect(surveilles, `le compte ${compte} du rôle ${role}`).toContain(role)
        ecrits.add(role)
      }
      const garde = surveilles.find((r) => (racines.get(r) ?? []).some((racine) => compte.startsWith(racine)))
      if (garde) expect(compte, `une ligne sous la racine du rôle ${garde}`).toBe(PLAN_DECALE[garde as CleRoleComptable])
    }
    expect(trie(ecrits)).toEqual(trie(surveilles))
  })

  it('la forme d’un compte et d’un préfixe : celles que ce module recopie, dans la fonction et dans la garde du plan', () => {
    const regler = corps(migration, 'regler_plan_du_dossier')
    expect(regler).toContain(`!~ '${FORME_COMPTE_DE_ROLE.source}'`)
    expect(regler).toContain(`!~ '${FORME_PREFIXE_AUXILIAIRE.source}'`)
    // Les lignes que planComptable.test.ts lit dans la DERNIÈRE définition de la garde du plan : elles y restent.
    const garde = corps(migration, 'garder_plan_comptable_dossier')
    expect(garde).toContain(`if new.compte !~ '${FORME_COMPTE_DE_ROLE.source}' then`)
    expect(garde).toContain(`if new.prefixe_auxiliaire !~ '${FORME_PREFIXE_AUXILIAIRE.source}' then`)
    expect(garde).toContain('where left(new.compte, length(x.racine)) = x.racine')
  })

  it('le retour rend la garde de l’étape PC1 et les deux contraintes de leurs migrations, au caractère près', () => {
    const dossier = new URL('supabase/preparees/retour/', RACINE)
    const retour = readdirSync(dossier).filter((n) => new RegExp(`^\\d{14}_retour_${NOM}\\.sql$`).test(n))
    expect(retour).toHaveLength(1)
    const texte = readFileSync(new URL(retour[0], dossier), 'utf8')
    const pc1 = readFileSync(new URL(`supabase/schema/${readdirSync(new URL('supabase/schema/', RACINE))
      .find((n) => /^\d{14}_plan_comptable_des_dossiers\.sql$/.test(n))}`, RACINE), 'utf8')
    expect(corps(texte, 'garder_plan_comptable_dossier')).toBe(corps(pc1, 'garder_plan_comptable_dossier'))
    expect(texte).toContain("check (compte_notes_de_frais in ('455000', '108000', '467000'))")
    expect(texte).toContain("check (compte in ('401000', '404000', '411000', '455000', '467000'))")
    // Et ces deux textes sont ceux des migrations qui ont posé les contraintes.
    const fichiers = readdirSync(new URL('supabase/schema/', RACINE))
    const lire = (motif: RegExp) => readFileSync(new URL(`supabase/schema/${fichiers.find((n) => motif.test(n))}`, RACINE), 'utf8')
    expect(lire(/^\d{14}_modele_comptable_du_dossier\.sql$/)).toContain("check (compte_notes_de_frais in ('455000', '108000', '467000'))")
    expect(lire(/^\d{14}_lettrages_manuels\.sql$/)).toContain("check (compte in ('401000', '404000', '411000', '455000', '467000'))")
  })
})
