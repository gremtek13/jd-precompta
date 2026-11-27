import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { sansCommentaires } from '../test/blocsSql'
import { fichiersDuSchema, fichiersPrepares } from '../test/schema'

// LE CONTRÔLE 141 DE supabase/essais/validationExercice.sql — « tout déclencheur qui garde une suppression laisse passer la
// cascade d'un dossier qu'on supprime » — compare les déclencheurs BEFORE … DELETE de la base à une liste tenue à la main :
// celle de la production d'un jour, puis une ligne par migration préparée (ou rangée depuis), comptée quand sa table existe.
// Une liste tenue à la main ne contient que ce à quoi on a pensé : la répétition des migrations préparées du 27/11/2026 l'a
// trouvée fausse au collage de NOE4R-Q2 (`remplacements_assurance_maladie_garde`, oubliée : 85 gardes observées, 84
// attendues), un essai joué en production qui serait passé au rouge le jour du collage.
//
// Ce relevé part de TOUT : chaque déclencheur que l'export (migrations et socle) et les préparées créent BEFORE … DELETE sur
// une table, moins ceux qu'une migration suivante retire, doit paraître dans l'essai sous la forme que le contrôle observe
// (`<table>.<déclencheur>:<fonction>:`) — sauf les deux gardes de la caisse, que la requête du contrôle écarte elle-même et
// que le 141b juge à part. Un plancher distingue « zéro oubli » d'« aveugle » ; des défauts plantés prouvent qu'il voit. Ce
// qu'il ne voit pas, dit : un déclencheur créé dans un bloc `do` (creationsDansLesBlocs.test.ts les refuse, hors de cas nommés)
// et la FORME de la garde (« dossier », « parent », « ? »), que seul l'essai, rejoué sur une réplique, juge.

const ESSAI = readFileSync(new URL('../../supabase/essais/validationExercice.sql', import.meta.url), 'utf8')
const ECARTEES_PAR_LA_REQUETE = ['garder_operation_caisse', 'garder_ecriture_de_caisse']

interface Declencheur { table: string; nom: string; fonction: string; fichier: string }

const MOTIF = new RegExp(
  String.raw`(create\s+(?:or\s+replace\s+)?(?:constraint\s+)?trigger\s+"?(\w+)"?\s+(before|after|instead\s+of)\s+([\s\S]*?)\s+on\s+(?:public\.)?"?(\w+)"?\b[\s\S]*?execute\s+(?:function|procedure)\s+(?:public\.)?(\w+)\s*\()`
  + String.raw`|(drop\s+trigger\s+(?:if\s+exists\s+)?"?(\w+)"?\s+on\s+(?:public\.)?"?(\w+)"?)`, 'gi')

/** Les déclencheurs BEFORE … DELETE vivants au bout des fichiers donnés, dans leur ordre : une création les pose (la dernière
 *  l'emporte), un retrait les ôte. */
function gardesDeSuppression(fichiers: { chemin: string; texte: string }[]): Declencheur[] {
  const vivants = new Map<string, Declencheur & { quand: string; evenements: string }>()
  for (const f of fichiers) {
    for (const m of sansCommentaires(f.texte).matchAll(MOTIF)) {
      if (m[1]) {
        vivants.set(`${m[5]}.${m[2]}`, { table: m[5], nom: m[2], fonction: m[6], fichier: f.chemin, quand: m[3].toLowerCase(), evenements: m[4].toLowerCase() })
      } else {
        vivants.delete(`${m[9]}.${m[8]}`)
      }
    }
  }
  return [...vivants.values()].filter((d) => d.quand === 'before' && /\bdelete\b/.test(d.evenements))
    .map(({ table, nom, fonction, fichier }) => ({ table, nom, fonction, fichier }))
}

/** Les gardes que l'essai n'attend pas. */
function oubliees(gardes: Declencheur[], essai: string): Declencheur[] {
  return gardes.filter((d) => !ECARTEES_PAR_LA_REQUETE.includes(d.fonction) && !essai.includes(`${d.table}.${d.nom}:${d.fonction}:`))
}

const TOUS = [...fichiersDuSchema(), ...fichiersPrepares()]

describe('le contrôle 141 de validationExercice.sql attend chaque garde de suppression de l’export et des préparées', () => {
  it('aucune garde oubliée', () => {
    expect(oubliees(gardesDeSuppression(TOUS), ESSAI).map((d) => `${d.table}.${d.nom}:${d.fonction} (${d.fichier})`)).toEqual([])
  })

  it('le plancher : le relevé voit les gardes de la production et celles des préparées', () => {
    const gardes = gardesDeSuppression(TOUS)
    // 109 le 27/11/2026 : les 107 que le contrôle observe au bout de la chaîne des préparées, et les deux de la caisse — dont
    // 23 des préparées. Le plancher dépasse les 86 de l'export seul : sans les préparées, le relevé tomberait dessous ; une
    // préparée rangée dans l'export le jour de son collage y reste comptée.
    expect(gardes.length).toBeGreaterThanOrEqual(105)
    expect(gardes.filter((d) => ECARTEES_PAR_LA_REQUETE.includes(d.fonction))).toHaveLength(2)
    // La requête du contrôle les écarte bien, sous ces deux noms.
    expect(ESSAI).toContain(`p.proname not in ('${ECARTEES_PAR_LA_REQUETE.join("', '")}')`)
  })

  it('il voit : une garde plantée dans une préparée, oubliée de l’essai, se dit ; retirée ensuite, ou sans suppression, non', () => {
    const plantee = { chemin: 'supabase/preparees/29991231000000_plantee.sql', texte: 'create table public.plantee (id uuid);\n'
      + 'create trigger plantee_garde\n  before insert or update or delete on public.plantee\n  for each row execute function public.garder_plantee();\n' }
    const forme = { chemin: 'supabase/preparees/29991231000001_plantee_bis.sql', texte: 'create or replace trigger "plantee_bis" before update of x or delete on plantee for each row execute procedure garder_plantee_bis();\n' }
    expect(oubliees(gardesDeSuppression([...TOUS, plantee, forme]), ESSAI).map((d) => `${d.table}.${d.nom}:${d.fonction}`))
      .toEqual(['plantee.plantee_garde:garder_plantee', 'plantee.plantee_bis:garder_plantee_bis'])
    const retiree = { chemin: 'supabase/preparees/29991231000002_retrait.sql', texte: 'drop trigger if exists plantee_garde on public.plantee;\n' }
    const sansSuppression = { chemin: 'supabase/preparees/29991231000003_sans.sql', texte: 'create trigger plantee_ins before insert or update on public.plantee for each row execute function public.f();\n' }
    expect(oubliees(gardesDeSuppression([...TOUS, plantee, retiree, sansSuppression]), ESSAI)).toEqual([])
    // Une garde en commentaire seulement ne compte pas.
    const enCommentaire = { chemin: 'supabase/preparees/29991231000004_commentaire.sql', texte: '-- create trigger t before delete on public.plantee for each row execute function public.g();\n' }
    expect(oubliees(gardesDeSuppression([...TOUS, enCommentaire]), ESSAI)).toEqual([])
    // L'essai d'hier, sans la ligne de NOE4R-Q2 : la garde oubliée se dit.
    const sansLaLigne = ESSAI.replace(`'remplacements_assurance_maladie.remplacements_assurance_maladie_garde:garder_remplacements_assurance_maladie:dossier:O'`, `''`)
    expect(oubliees(gardesDeSuppression(TOUS), sansLaLigne).map((d) => `${d.table}.${d.nom}`)).toEqual(['remplacements_assurance_maladie.remplacements_assurance_maladie_garde'])
  })
})
