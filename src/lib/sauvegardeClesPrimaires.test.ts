import { describe, expect, it } from 'vitest'
import { clesPrimairesDuSchema, fichiersDuSchema } from '../test/schema'
import { CLES_PRIMAIRES, RELATIONS } from './sauvegarde'

// UNE PROMESSE ÉCRITE DANS UN COMMENTAIRE, ET RIEN DERRIÈRE — trouvée le 22/09/2026 en balayant les
// commentaires qui AFFIRMENT qu'un test garde quelque chose. Six affirmations de ce genre dans les
// sources de production ; cinq tiennent, celle-ci ne trouvait aucun test.
//
// `liensPerdus` (sauvegarde.ts) compare sur `id`, et son en-tête explique pourquoi c'est correct :
// « une clé étrangère d'une seule colonne ne peut viser qu'une clé primaire d'une seule colonne :
// toutes les tables PARENTES du graphe ont donc `id`. **Un test le vérifie**, pour que le jour où ce
// ne serait plus vrai se voie ici. » Il n'existait pas.
//
// CE QUE SA RUPTURE COÛTERAIT, dit exactement plutôt que dramatisé : elle est BRUYANTE, pas
// silencieuse. Un parent sans colonne `id` ferait rendre `Set {"undefined"}` à `identifiants`, donc
// CHAQUE ligne fille serait déclarée « lien perdu » — et `restaurerSauvegarde` REFUSE sur un lien
// perdu. Le dégât n'est donc pas une restauration fausse mais une restauration IMPOSSIBLE, bloquée
// par des centaines de liens qui ne sont pas cassés, au moment précis où l'on restaure. C'est le
// terrain que PLAN_DE_REPRISE.md décrit comme celui dont on découvre les défauts trop tard.
//
// L'INVARIANT TIENT AUJOURD'HUI — 11 parents, aucun à clé composite. Ce test ne corrige donc rien :
// il rend vraie une phrase qui était fausse, et attrape la relation qu'on ajoutera demain vers l'une
// des six tables à clé non-`id`.

// ────────────────────────────────────────────────────────────────────────────────────────────────
// LA SOURCE EST LE SCHÉMA EXPORTÉ, JAMAIS UNE LISTE TENUE À LA MAIN — comme `sauvegardeTables` et
// comme `rls.sql` part de `pg_class`. Une table créée demain avec une clé composite est vue sans que
// personne ait à l'inscrire quelque part, et c'est tout l'enjeu : `CLES_PRIMAIRES` est justement une
// liste d'inclusion, et ce dépôt connaît sous cinq noms la panne qu'elles produisent.
//
// LES `ALTER` SE REJOUENT, et ce n'est pas du zèle — mesuré, sans eux la dérivation est FAUSSE sur
// deux tables : `piece_textes_ocr` (créée avec `primary key` sur `piece_id`, passée à un `id` de
// substitution par `alter table … add column id … primary key`) et `facture_numerotation` (passée de
// deux à trois colonnes par `drop constraint` + `add primary key`). Quatre instructions dans tout le
// schéma, deux formes, toutes rejouées ici dans l'ordre des fichiers puis des instructions.
//
// **CE QUE CE TEST NE PEUT PAS GARDER, annoncé plutôt que laissé croire** : que le schéma exporté
// décrive la base RÉELLE. C'est le couple habituel de ce dépôt — une moitié gardée par le code,
// l'autre par une vérification. Cette vérification a été faite le 22/09/2026 par une requête sur
// `pg_constraint` : **41 tables, six à clé non-`id`, et la dérivation ci-dessous les rend EXACTEMENT,
// colonne par colonne**. La dérive du fichier exporté, elle, est gardée par `supabase/schema/README.md`
// et par `sauvegardeTables.test.ts`.
// ────────────────────────────────────────────────────────────────────────────────────────────────

// La dérivation vit dans `src/test/schema.ts` : `triTotal.test.ts` en dépend aussi, et une clé
// primaire lue de deux façons différentes est exactement ce qu'aucun test ne verrait.

const estId = (cols: string[]) => cols.length === 1 && cols[0] === 'id'

describe('clés primaires — ce que la sauvegarde suppose du schéma', () => {
  const cles = clesPrimairesDuSchema(fichiersDuSchema())
  const parents = [...new Set(RELATIONS.map((r) => r.parent))].sort()
  const tablesDuGraphe = new Set([...RELATIONS.map((r) => r.parent), ...RELATIONS.map((r) => r.enfant)])

  it('lit bien tout le schéma, et toutes les tables du graphe', () => {
    // La borne sans laquelle « aucun parent en faute » voudrait aussi dire « je ne lis plus rien ».
    // Le compte de tables ne fait que croître ; ce qui se met à jour tout seul, en revanche, c'est
    // que CHAQUE table du graphe de sauvegarde ait une clé primaire dérivée — si le lecteur devenait
    // aveugle sur une forme de `create table`, c'est ici que ça se verrait.
    expect(cles.size).toBeGreaterThanOrEqual(41)
    expect(parents.length).toBeGreaterThanOrEqual(11)
    for (const t of tablesDuGraphe) {
      expect(cles.get(t), `aucune clé primaire dérivée pour ${t}`).toBeDefined()
      expect(cles.get(t)!.length, `clé primaire vide pour ${t}`).toBeGreaterThan(0)
    }
    // `pack_pieces` a été SUPPRIMÉE (migration `drop_table_morte_pack_pieces`) : la rejouer prouve
    // que les `drop table` sont pris en compte, sans quoi la liste porterait une table fantôme.
    expect(cles.has('pack_pieces')).toBe(false)
  })

  it('TOUTE table PARENTE du graphe a `id` pour clé primaire', () => {
    // LA PHRASE QUE `liensPerdus` ÉCRIT DEPUIS TOUJOURS, enfin vérifiée. Une relation ajoutée demain
    // vers `superpdp_credentials`, `previsionnels_bancaires` ou l'une des quatre autres rendrait
    // toute restauration impossible — voir l'en-tête.
    const fautifs = parents.filter((p) => !estId(cles.get(p) ?? []))
    expect(
      fautifs,
      'un parent dont la clé primaire n’est pas `id` : `liensPerdus` compare sur `id` et déclarerait ' +
        'perdue chaque ligne fille, donc `restaurerSauvegarde` refuserait tout.',
    ).toEqual([])
  })

  it('rejoue les instructions dans l’ORDRE ÉCRIT, pas dans l’ordre des motifs', () => {
    // CE CAS EST SYNTHÉTIQUE, ET C'EST ASSUMÉ : sans lui le tri par position ne servait à rien, car
    // l'ordre des expressions régulières (create, drop table, drop pk, add pk, add colonne) coïncide
    // par ACCIDENT avec l'ordre textuel de tous les fichiers réels. Une mutation qui ne mord pas
    // accuse d'abord le jeu d'essai — le tri tient par CONSTRUCTION, il lui fallait un cas qui le
    // distingue.
    //
    // La séquence ci-dessous est celle d'une table qui reçoit un `id` de substitution PUIS qu'on
    // re-clé ensuite : l'ordre des motifs rendrait `{id}`, l'ordre écrit rend `{a, b}`.
    const synthetique = [{
      chemin: 'synthetique.sql',
      texte: [
        'create table t_synth (a uuid, b uuid, primary key (a));',
        'alter table t_synth add column id uuid primary key default gen_random_uuid();',
        'alter table t_synth drop constraint t_synth_pkey;',
        'alter table t_synth add primary key (a, b);',
      ].join('\n'),
    }]
    expect(clesPrimairesDuSchema(synthetique).get('t_synth')).toEqual(['a', 'b'])
  })

  it('`CLES_PRIMAIRES` dit EXACTEMENT ce que le schéma dit, dans les deux sens', () => {
    // Cette liste décide du TRI des lectures paginées (`sauvegardeDonnees`) : un tri sur une clé qui
    // n'en est pas une rend des doublons et des trous sans erreur, Postgres n'étant pas tenu de
    // garder le même ordre d'une tranche à l'autre. Elle est tenue à la main ; le schéma, non.
    //
    // Aucune exception, et c'est possible parce que les deux tombent juste : une de moins serait une
    // table qu'on paginerait sur un `id` inexistant, une de plus une raison morte.
    const duSchema = Object.fromEntries([...cles].filter(([, c]) => !estId(c)).sort())
    const deLaListe = Object.fromEntries(
      Object.entries(CLES_PRIMAIRES).map(([t, c]) => [t, [...c]]).sort(),
    )
    expect(duSchema).toEqual(deLaListe)
  })
})
