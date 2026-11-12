import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { definitionsSql } from '../test/schema'
import { LETTRES_DE_MISSION_PREVUES } from './lettresDeMission'
import { COLONNES_SANS_MONTANT, missionsEnVigueur } from './lettresDeMissionVue'
import {
  CLES_DE_LA_VALEUR, CLES_D_UNE_LETTRE, DRAPEAU_DES_MISSIONS_DU_CLIENT, FONCTION_DES_MISSIONS_DU_CLIENT,
  PARAMETRE_DES_MISSIONS_DU_CLIENT, REFUS_DES_MISSIONS_DU_CLIENT, lectureDesMissionsDuClient, lireLesMissionsParLaFonction,
  missionsDuClientPrevues, missionsDuClientRendues,
} from './missionsDuClient'

// LES MISSIONS D'UN CLIENT, SANS SES HONORAIRES (LM5-Q2) : le module lit ce que rend `missions_du_client` — la migration
// préparée le 11/11/2026, dans l'export le jour de son application — ; il en redit la fonction, son paramètre, son refus et
// ses clés, confrontés au texte ; le texte ne lit d'une lettre que ces clés ; son retour retire la fonction et elle seule ;
// son essai et le bloc MV de rls.sql attendent les mots du module ; et une valeur qui porterait une clé de plus — une clé
// d'honoraires d'abord — ne s'affiche jamais. Données FICTIVES.

function leFichier(motif: RegExp, dossiers: readonly string[]): string {
  const trouves: string[] = []
  for (const dossier of dossiers) {
    const chemin = new URL(dossier, import.meta.url).pathname
    if (!existsSync(chemin)) continue
    for (const nom of readdirSync(chemin)) if (motif.test(nom)) trouves.push(chemin + nom)
  }
  expect(trouves, String(motif)).toHaveLength(1)
  return readFileSync(trouves[0], 'utf8')
}

const MIGRATION = leFichier(/^\d{14}_missions_du_client\.sql$/, ['../../supabase/preparees/', '../../supabase/schema/'])
const RETOUR = leFichier(/^\d{14}_retour_missions_du_client\.sql$/, ['../../supabase/preparees/retour/'])
const ESSAI = readFileSync(new URL('../../supabase/essais/missionsDuClient.sql', import.meta.url), 'utf8')
const RLS = readFileSync(new URL('../../supabase/essais/rls.sql', import.meta.url), 'utf8')

function laFonction(): string {
  const definitions = definitionsSql(FONCTION_DES_MISSIONS_DU_CLIENT, [{ chemin: 'missions_du_client', texte: MIGRATION }])
  expect(definitions).toHaveLength(1)
  return definitions[0].definition
}
/** Le code de la fonction, sans ses commentaires (ils nomment ce qu'elle tait). */
const sansCommentaires = (sql: string) => sql.replace(/--.*$/gm, '')
/** Les clés d'un `array['…', …]` qui suit `debut` dans un texte. */
function lesCles(texte: string, debut: string): string[] {
  const i = texte.indexOf(debut)
  expect(i, debut).toBeGreaterThanOrEqual(0)
  const fin = texte.indexOf(']', i + debut.length)
  return [...texte.slice(i + debut.length, fin).matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
}

const C = '1b500000-0000-4000-8000-0000000000c1'
const lettre = (p: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: '1b500000-0000-4000-8000-0000000000e1', remplace_id: null, dossier_client_id: C, missions: ['tenue_comptable'],
  date_effet: '2026-01-01', fin_initiale: '2026-12-31', reconduction_tacite: true, proposee_le: '2026-11-10T09:00:00+00:00',
  acceptee_le: '2026-11-10T12:00:00+00:00', refusee_le: null, retiree_le: null, fin_au: null, ...p,
})
const valeur = (lettres: unknown[] = [lettre()], designe = true) => ({ dossier_du_cabinet_designe: designe, lettres })

afterEach(() => {
  DRAPEAU_DES_MISSIONS_DU_CLIENT.MISSIONS_DU_CLIENT_PREVUES = false
})

describe('le drapeau', () => {
  it('est levé depuis le 12/11/2026 : la migration est en production, son texte inchangé dans l’export', () => {
    expect(missionsDuClientPrevues()).toBe(true)
    expect(MIGRATION).toMatch(/PRÉPARÉE le\s+-- 11\/11\/2026, PAS APPLIQUÉE/)
  })
  it('ne se lève qu’avec la migration dans l’export, et après celui des lettres de mission', () => {
    const dansLExport = readdirSync(new URL('../../supabase/schema/', import.meta.url).pathname)
      .some((n) => /^\d{14}_missions_du_client\.sql$/.test(n))
    if (missionsDuClientPrevues()) {
      expect(dansLExport).toBe(true)
      expect(LETTRES_DE_MISSION_PREVUES).toBe(true)
    }
  })
  it('se lit à chaque appel', () => {
    DRAPEAU_DES_MISSIONS_DU_CLIENT.MISSIONS_DU_CLIENT_PREVUES = true
    expect(missionsDuClientPrevues()).toBe(true)
  })
})

describe('la migration, confrontée au module', () => {
  it('la fonction, son paramètre : security definer, chemin fixé, stable, une valeur jsonb', () => {
    expect(laFonction()).toContain(`create function public.${FONCTION_DES_MISSIONS_DU_CLIENT}(${PARAMETRE_DES_MISSIONS_DU_CLIENT} uuid)\n`
      + 'returns jsonb\nlanguage plpgsql\nstable\nsecurity definer\nset search_path = public\n')
  })

  it('l’accès d’abord, sur le dossier du client : rien n’est lu avant ; le refus, à ses mots et à son code', () => {
    const code = sansCommentaires(laFonction())
    const acces = code.indexOf(`if not public.admin_du_dossier(${PARAMETRE_DES_MISSIONS_DU_CLIENT}) then`)
    expect(acces).toBeGreaterThan(0)
    expect(acces).toBeLessThan(code.indexOf('from public.'))
    const refus = `raise exception '${REFUS_DES_MISSIONS_DU_CLIENT.acces}' using errcode = '${REFUS_DES_MISSIONS_DU_CLIENT.code}';`
    expect(code.split(refus)).toHaveLength(3)
    expect(code).not.toMatch(/client_du_dossier|droits_sur_le_dossier|gere_les_ventes|gere_la_banque/)
  })

  it('chaque lettre par les douze clés de la carte, chacune la colonne de son nom, et elles seules', () => {
    const code = sansCommentaires(laFonction())
    const paires = [...code.matchAll(/'([a-z_]+)', (?:to_jsonb\()?l\.([a-z_]+)/g)].map((m) => [m[1], m[2]])
    expect(paires.map(([cle]) => cle)).toEqual([...CLES_D_UNE_LETTRE])
    expect(paires.every(([cle, colonne]) => cle === colonne)).toBe(true)
    expect(CLES_D_UNE_LETTRE).toEqual(COLONNES_SANS_MONTANT.split(', '))
    // Aucune autre colonne de la lettre n'est lue : ni honoraires, ni répartition, ni identités, ni empreinte…
    const lues = new Set([...code.matchAll(/\bl\.([a-z_]+)/g)].map((m) => m[1]))
    // La date de création ne sert qu'à ranger les brouillons (LM5Q2-Q1 (B)) : lue dans le tri, jamais rendue.
    expect([...lues].filter((c) => !CLES_D_UNE_LETTRE.includes(c) && c !== 'dossier_id' && c !== 'cree_le')).toEqual([])
    expect(code.match(/\bl\.cree_le\b/g)).toEqual(['l.cree_le'])
    expect(code).toContain('order by l.proposee_le nulls last, l.cree_le, l.id')
    expect(code).not.toMatch(/honoraires|repartition|empreinte|identite_|clauses|signataire|modele_id|document_signe/)
  })

  it('ses deux clés ; les lettres du client, brouillons compris, dans le dossier que son cabinet a désigné', () => {
    const code = sansCommentaires(laFonction())
    expect(code).toContain(`'${CLES_DE_LA_VALEUR[0]}', v_dossier_du_cabinet is not null,`)
    expect(code).toContain(`'${CLES_DE_LA_VALEUR[1]}', coalesce((`)
    expect(code).toContain('       where l.dossier_id = v_dossier_du_cabinet\n'
      + `         and l.dossier_client_id = ${PARAMETRE_DES_MISSIONS_DU_CLIENT}), '[]'::jsonb));`)
    // Les brouillons compris (LM5Q2-Q1 (B)) : aucune condition sur la proposition ; les proposées d'abord, puis les
    // brouillons par leur création.
    expect(code).not.toContain('proposee_le is not null')
    expect(code).toContain('             order by l.proposee_le nulls last, l.cree_le, l.id)')
  })

  it('les connectés seuls l’exécutent ; aucun mot de suppression : l’outil la prendra', () => {
    expect(MIGRATION).toContain(`revoke execute on function public.${FONCTION_DES_MISSIONS_DU_CLIENT}(uuid) from public, anon;\n`
      + `grant execute on function public.${FONCTION_DES_MISSIONS_DU_CLIENT}(uuid) to authenticated;`)
    expect(MIGRATION).not.toMatch(/drop|delete|truncate/i)
  })

  it('son retour retire la fonction, et elle seule ; il se refuse si elle n’est pas là', () => {
    expect(RETOUR.split('\n').filter((l) => /^drop /.test(l))).toEqual([`drop function public.${FONCTION_DES_MISSIONS_DU_CLIENT}(uuid);`])
    expect(RETOUR).toContain("raise exception 'La migration missions_du_client n''est pas en base : rien à défaire.';")
  })

  it('l’essai et le bloc MV de rls.sql attendent les mots et les clés du module', () => {
    expect(ESSAI).toContain(`refus constant text := '${REFUS_DES_MISSIONS_DU_CLIENT.acces}';`)
    expect(lesCles(ESSAI, 'cles constant text[] := array[')).toEqual([...CLES_D_UNE_LETTRE])
    const bloc = RLS.slice(RLS.indexOf('do $mv$'), RLS.indexOf('end $mv$;'))
    expect(bloc).toContain(`refus text := '${REFUS_DES_MISSIONS_DU_CLIENT.acces}';`)
    expect(lesCles(bloc, 'cles text[] := array[')).toEqual([...CLES_D_UNE_LETTRE])
    expect(bloc).toContain(`= array['${CLES_DE_LA_VALEUR.join("', '")}']`)
  })
})

describe('la valeur rendue, reconnue entière', () => {
  it('lue : ses lettres, d’où la carte déduit les missions en vigueur', () => {
    const rendue = missionsDuClientRendues(valeur([lettre(), lettre({ id: '1b500000-0000-4000-8000-0000000000e3', refusee_le: '2026-11-10T13:00:00+00:00', acceptee_le: null })]), C)
    expect(rendue?.dossierDuCabinetDesigne).toBe(true)
    expect(rendue?.lettres).toHaveLength(2)
    expect(missionsEnVigueur(rendue?.lettres ?? [], C, '2026-11-11').map((m) => m.missions)).toEqual([['tenue_comptable']])
  })

  it('une clé de plus — d’honoraires, d’empreinte — ou une clé qui manque : illisible, jamais affichée', () => {
    expect(missionsDuClientRendues(valeur([lettre({ honoraires: [{ forme: 'forfait', libelle: 'x', montant_ht: 150, periodicite: 'mois' }] })]), C)).toBeNull()
    expect(missionsDuClientRendues(valeur([lettre({ empreinte: 'ab'.repeat(32) })]), C)).toBeNull()
    const sansFin: Record<string, unknown> = lettre()
    delete sansFin.fin_au
    expect(missionsDuClientRendues(valeur([sansFin]), C)).toBeNull()
    expect(missionsDuClientRendues({ ...valeur(), honoraires: [] }, C)).toBeNull()
  })

  it('une mission hors du catalogue, la lettre d’un autre client, un brouillon que la base n’écrit pas, un doublon : illisible', () => {
    expect(missionsDuClientRendues(valeur([lettre({ missions: ['audit'] })]), C)).toBeNull()
    expect(missionsDuClientRendues(valeur([lettre({ dossier_client_id: '1b500000-0000-4000-8000-0000000000c2' })]), C)).toBeNull()
    // Un brouillon se lit (LM5Q2-Q1 (B)) ; un « brouillon » accepté, refusé ou résilié est une forme que la base n'écrit pas.
    expect(missionsDuClientRendues(valeur([lettre({ proposee_le: null, acceptee_le: null })]), C)?.lettres[0].proposee_le).toBeNull()
    expect(missionsDuClientRendues(valeur([lettre({ proposee_le: null })]), C)).toBeNull()
    expect(missionsDuClientRendues(valeur([lettre({ proposee_le: null, acceptee_le: null, refusee_le: '2026-11-10T09:00:00+00:00' })]), C)).toBeNull()
    expect(missionsDuClientRendues(valeur([lettre(), lettre()]), C)).toBeNull()
    expect(missionsDuClientRendues(valeur([lettre({ date_effet: '01/01/2026' })]), C)).toBeNull()
  })

  it('sans dossier du cabinet désigné : aucune lettre, ou illisible ; une autre forme : illisible', () => {
    expect(missionsDuClientRendues(valeur([], false), C)).toEqual({ dossierDuCabinetDesigne: false, lettres: [] })
    expect(missionsDuClientRendues(valeur([lettre()], false), C)).toBeNull()
    expect(missionsDuClientRendues([], C)).toBeNull()
    expect(missionsDuClientRendues(null, C)).toBeNull()
    expect(missionsDuClientRendues({ dossier_du_cabinet_designe: 'oui', lettres: [] }, C)).toBeNull()
  })
})

describe('la lecture', () => {
  it('le refus de la base se dit refusé, à ses mots ; une autre erreur, illisible', () => {
    const refus = { code: REFUS_DES_MISSIONS_DU_CLIENT.code, message: REFUS_DES_MISSIONS_DU_CLIENT.acces }
    expect(lectureDesMissionsDuClient(C, { data: null, error: refus })).toEqual({ etat: 'refusee', motif: REFUS_DES_MISSIONS_DU_CLIENT.acces })
    expect(lectureDesMissionsDuClient(C, { data: null, error: { code: '57014', message: 'délai dépassé' } }).etat).toBe('illisible')
    expect(lectureDesMissionsDuClient(C, { data: valeur([lettre({ montant_ht: 150 })]), error: null }).etat).toBe('illisible')
  })

  it('lue ; une requête qui lève tombe du côté illisible, sans rejeter', async () => {
    expect(await lireLesMissionsParLaFonction(C, Promise.resolve({ data: valeur(), error: null }))).toMatchObject({ etat: 'lue', dossierDuCabinetDesigne: true })
    expect((await lireLesMissionsParLaFonction(C, Promise.reject(new TypeError('réseau coupé')))).etat).toBe('illisible')
  })
})
