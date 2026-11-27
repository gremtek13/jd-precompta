import { describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import {
  REFUS_DE_LA_TENUE,
  TENUE_REFUSEE_EN_BASE,
  phrasesDeLaFermetureDeLaTenue,
} from './modulesDuCabinet'
import { motsDeLaConfirmation, type CaseDUnModule } from './optionsDuCabinetVue'

// Le drapeau levé garde son état d'avant éprouvé (CLAUDE.md, « Un drapeau d'export levé garde son état d'avant éprouvé ») :
// ses deux états joués par un accesseur, la valeur réelle relue par `importActual`.
const etat = vi.hoisted(() => ({ drapeau: null as boolean | null }))
vi.mock('./modulesDuCabinet', async (importOriginal) => {
  const reel = await importOriginal<typeof import('./modulesDuCabinet')>()
  return {
    ...reel,
    get FRONTIERE_DE_LA_TENUE_PREVUE() {
      return etat.drapeau ?? reel.FRONTIERE_DE_LA_TENUE_PREVUE
    },
  }
})

// OPT6 — LA FRONTIÈRE DE LA TENUE, EN BASE : la migration (en production depuis le 27/11/2026, 255, par l'outil), son retour et son essai confrontés au module qui redit son
// refus (CLAUDE.md, « Un module qui redit une fonction SQL a son test à côté »). L'essai (supabase/essais/frontiereDeLaTenue.sql)
// se joue en production par l'outil comme sur une réplique : 15 verdicts, et six mutations de la garde qui mordent (HISTORIQUE.md, 26/11/2026).

const RACINE = new URL('../../', import.meta.url).pathname
const PREPAREE = 'supabase/preparees/20261126120000_frontiere_de_la_tenue.sql'
const RETOUR = 'supabase/preparees/retour/20261126120100_retour_frontiere_de_la_tenue.sql'
const ESSAI = 'supabase/essais/frontiereDeLaTenue.sql'
const EXPORTEE = 'supabase/schema/20261127053521_frontiere_de_la_tenue.sql'
const lire = (chemin: string) => readFileSync(RACINE + chemin, 'utf8')
const sql = (texte: string) => texte.replace(/''/g, '\'')

describe('OPT6 : la frontière de la tenue, en base', () => {
  const texte = lire(EXPORTEE)

  it('le drapeau suit la migration : levé, elle est rangée dans l’export sous sa version d’historique, texte inchangé', async () => {
    const reel = await vi.importActual<typeof import('./modulesDuCabinet')>('./modulesDuCabinet')
    expect(reel.FRONTIERE_DE_LA_TENUE_PREVUE).toBe(true)
    expect(existsSync(RACINE + PREPAREE)).toBe(false)
    // L'empreinte de la ligne d'historique (20261127053521), sans le saut de ligne final : 7 881 caractères.
    const sansFin = texte.replace(/\n$/, '')
    expect(sansFin.length).toBe(7881)
    expect(createHash('md5').update(sansFin).digest('hex')).toBe('e1f243dc55a4c7e66826d0516199a93d')
  })

  it('le refus du module est celui de la garde, et de son essai, au caractère près', () => {
    const m = /raise exception '((?:[^']|'')*)'\s+using errcode = 'P0001'/.exec(texte)
    expect(m).not.toBeNull()
    expect(sql(m![1])).toBe(REFUS_DE_LA_TENUE)
    const e = /refus constant text := '((?:[^']|'')*)';/.exec(lire(ESSAI))
    expect(sql(e![1])).toBe(REFUS_DE_LA_TENUE)
  })

  it('quatre déclencheurs AFTER ROW, aucun BEFORE ; la garde security definer au chemin vide, retirée des rôles de l’API', () => {
    const declencheurs = [...texte.matchAll(/create trigger (\w+) (before|after) ([a-z ]+?) on public\.(\w+)/gi)].map((m) => `${m[4]}:${m[1]}:${m[2]} ${m[3]}`)
    expect(declencheurs.sort()).toEqual([
      'ecritures_libres:frontiere_de_la_tenue:after insert',
      'ecritures_libres:frontiere_de_la_tenue_a_la_modification:after update',
      'exercices_valides:frontiere_de_la_tenue:after insert',
      'situations_publiees:frontiere_de_la_tenue:after insert',
    ])
    expect(texte).toContain('when (new.version is distinct from old.version)')
    expect(texte).toMatch(/security definer\s+set search_path = ''/)
    expect(texte).toContain('revoke all on function public.garder_frontiere_de_la_tenue() from public, anon, authenticated, service_role;')
    // Rien ne se supprime : la migration passe par l'outil.
    expect(texte.replace(/^--.*$/gm, '')).not.toMatch(/\b(drop|delete|truncate)\b/i)
  })

  it('le retour vérifie l’empreinte du corps que la migration pose, puis retire ses quatre déclencheurs et sa fonction', () => {
    const corps = /as \$\$([\s\S]*?)\$\$;/.exec(texte)![1]
    const empreinte = createHash('md5').update(corps.replace(/\r/g, '')).digest('hex')
    const retour = lire(RETOUR)
    expect(retour).toContain(`is distinct from '${empreinte}'`)
    expect((retour.match(/^drop trigger /gim) ?? []).length).toBe(4)
    expect(retour).toContain('drop function public.garder_frontiere_de_la_tenue();')
  })

  it.each([false, true])('la confirmation de fermer la tenue dit le refus de la base, le drapeau levé seulement (levé : %s)', (leve) => {
    etat.drapeau = leve
    expect(phrasesDeLaFermetureDeLaTenue(false)).toEqual([])
    expect(phrasesDeLaFermetureDeLaTenue(true)).toEqual([TENUE_REFUSEE_EN_BASE])
    const tenue: CaseDUnModule = {
      module: 'tenue', libelle: 'Tenue et déclarations', ouverte: true, geste: 'fermer', refus: null, ouvreAussi: [], suppose: [],
      jugeParLaBaseSeule: false,
    }
    const mots = motsDeLaConfirmation('Cabinet A', tenue)
    expect(mots.phrases.includes(TENUE_REFUSEE_EN_BASE)).toBe(leve)
    etat.drapeau = null
  })
})
