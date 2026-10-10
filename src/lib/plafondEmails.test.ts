import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { executerModule } from '../test/compilationSeparee'
import { dateAParis } from './format'

// LE PLAFOND D'E-MAILS D'UN ACCÈS CLIENT SE COMPTE PAR JOUR DE PARIS (send-email, espace client, étape P3).
// La fonction tourne en UTC : un plafond compté sur le jour UTC repartirait à zéro à 1 h ou 2 h du matin à Paris, et
// deux jours de Paris se partageraient trente e-mails. Elle compte donc les e-mails du journal entre deux INSTANTS, le
// minuit de Paris du jour et celui du lendemain, qu'elle calcule par son bloc `JOUR DE PARIS`. Ce garde l'exécute seul
// contre `dateAParis` (src/lib/format.ts), une référence extérieure à lui : pour chaque heure de deux années, l'instant
// est dans son jour, le début est le premier instant de ce jour à Paris et la fin le premier du lendemain — 23 heures au
// passage à l'heure d'été, 25 au retour. Les contrats HTTP (`contratsFonctions.ts`) jouent le plafond lui-même.

const SOURCE = readFileSync(new URL('../../supabase/functions/send-email/index.ts', import.meta.url), 'utf8')

function blocDe(nom: string): string {
  const debut = SOURCE.indexOf(`// ── DÉBUT ${nom} `)
  const fin = SOURCE.indexOf(`// ── FIN ${nom} `)
  expect(debut, `bornes du bloc ${nom} introuvables dans send-email`).toBeGreaterThan(-1)
  expect(fin).toBeGreaterThan(debut)
  return SOURCE.slice(debut, SOURCE.indexOf('\n', fin) + 1)
}

type JourDeParis = (ms: number) => { debut: string; fin: string }
const executer = (bloc: string) => executerModule<{ jourDeParis: JourDeParis }>(`${bloc}\nexport { jourDeParis }\n`).jourDeParis
const jourDeParis = executer(blocDe('JOUR DE PARIS'))

const HEURE = 3_600_000
// `Intl.DateTimeFormat` se construit à chaque appel de `dateAParis` : la date d'un même instant ne se calcule qu'une fois.
const dates = new Map<number, string>()
const dateDe = (ms: number) => {
  let date = dates.get(ms)
  if (date === undefined) dates.set(ms, (date = dateAParis(new Date(ms))))
  return date
}
const veille = (iso: string) => dateDe(Date.parse(iso) - 1)

/** Ce que doit rendre le bloc pour l'instant `ms`, jugé par `dateAParis` seule ; la liste des fautes. */
function fautesPour(jour: JourDeParis, ms: number): string[] {
  const { debut, fin } = jour(ms)
  const date = dateDe(ms)
  const fautes: string[] = []
  const d = Date.parse(debut)
  const f = Date.parse(fin)
  if (!(d <= ms && ms < f)) fautes.push('l’instant hors de son jour')
  if (dateDe(d) !== date || veille(debut) === date) fautes.push(`début ${debut} n’est pas minuit du ${date}`)
  if (dateDe(f) === date || veille(fin) !== date) fautes.push(`fin ${fin} n’est pas minuit du lendemain du ${date}`)
  if (![23, 24, 25].includes((f - d) / HEURE)) fautes.push(`un jour de ${(f - d) / HEURE} h`)
  return fautes
}

/**
 * Chaque jour de 2026 et le premier de 2027 : les instants qui encadrent les deux minuits possibles de Paris (22 h et
 * 23 h UTC la veille), à la milliseconde, et le milieu du jour. L'année porte les deux changements d'heure.
 */
const INSTANTS: number[] = []
for (let t = Date.UTC(2026, 0, 1); t <= Date.UTC(2027, 0, 1); t += 24 * HEURE) {
  INSTANTS.push(t - 2 * HEURE - 1, t - 2 * HEURE, t - HEURE - 1, t - HEURE, t + 12 * HEURE)
}

describe('send-email : le jour de Paris du plafond d’un accès client', () => {
  it('pour chaque jour d’une année, le jour de l’instant, de minuit à minuit à Paris', () => {
    const fautes = INSTANTS.flatMap((ms) => fautesPour(jourDeParis, ms).map((x) => `${new Date(ms).toISOString()} : ${x}`))
    expect(fautes.slice(0, 5)).toEqual([])
  })

  it('les jours des changements d’heure durent 23 et 25 heures, les autres 24', () => {
    const duree = (iso: string) => {
      const { debut, fin } = jourDeParis(Date.parse(iso))
      return (Date.parse(fin) - Date.parse(debut)) / HEURE
    }
    expect([duree('2026-03-29T12:00:00Z'), duree('2026-10-25T12:00:00Z'), duree('2026-10-10T12:00:00Z')]).toEqual([23, 25, 24])
    // Minuit à Paris est la veille à 22 h UTC l'été, à 23 h l'hiver ; le jour du retour à l'heure d'hiver va de l'un à
    // l'autre.
    expect(jourDeParis(Date.parse('2026-10-25T22:30:00Z'))).toEqual({ debut: '2026-10-24T22:00:00.000Z', fin: '2026-10-25T23:00:00.000Z' })
    expect(jourDeParis(Date.parse('2026-10-10T22:30:00Z'))).toEqual({ debut: '2026-10-10T22:00:00.000Z', fin: '2026-10-11T22:00:00.000Z' })
    expect(jourDeParis(Date.parse('2026-12-31T23:30:00Z'))).toEqual({ debut: '2026-12-31T23:00:00.000Z', fin: '2027-01-01T23:00:00.000Z' })
  })

  it('le garde mord : le jour UTC, ou une avance de Paris figée à une heure, se voient', () => {
    const utc = blocDe('JOUR DE PARIS').replace(
      'return { debut: new Date(minuit(ici.day)).toISOString(), fin: new Date(minuit(ici.day + 1)).toISOString() }',
      'const j = new Date(ms).toISOString().split("T")[0]; return { debut: `${j}T00:00:00.000Z`, fin: new Date(Date.parse(`${j}T00:00:00.000Z`) + 86_400_000).toISOString() }',
    )
    const hiver = blocDe('JOUR DE PARIS').replace(
      'return t - (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - t)', 'return t - 3_600_000')
    for (const derive of [utc, hiver]) {
      expect(derive).not.toBe(blocDe('JOUR DE PARIS'))
      const jour = executer(derive)
      expect(INSTANTS.some((ms) => fautesPour(jour, ms).length > 0)).toBe(true)
    }
  })

  it('trente e-mails par dossier et par jour, pour un appelant qui n’est pas du cabinet, comptés avant Resend', () => {
    expect(SOURCE).toMatch(/\nconst PLAFOND_CLIENT_PAR_JOUR = 30\n/)
    const gestionnaire = SOURCE.slice(SOURCE.indexOf('Deno.serve('))
    const plafond = gestionnaire.indexOf('if (!lus.droits.cabinet) {')
    expect(plafond).toBeGreaterThan(-1)
    expect(plafond).toBeLessThan(gestionnaire.indexOf('resend.emails.send('))
    expect(gestionnaire).toContain('if (envoyes >= PLAFOND_CLIENT_PAR_JOUR) {')
    expect(gestionnaire).toContain('.eq("dossier_id", dossierId).gte("created_at", jour.debut).lt("created_at", jour.fin)')
  })
})
