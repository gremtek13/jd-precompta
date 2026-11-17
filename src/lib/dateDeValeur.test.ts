import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  DATE_DE_VALEUR_PREVUE, ECART_MAXIMAL_DE_LA_DATE_DE_VALEUR, lireDateDeValeur, phraseDesDatesDeValeur,
} from './dateDeValeur'

// EXP58-Q4 : LA DATE DE VALEUR D'UN MOUVEMENT DU RELEVÉ. La lecture d'une cellule (gardée, écartée et comptée, ou absente),
// la phrase de l'aperçu, et la borne confrontée au texte de la migration `date_de_valeur_des_mouvements`, à son retour et à son
// essai ; le drapeau suit l'export. Données FICTIVES.

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

const MIGRATION = leFichier(/^\d{14}_date_de_valeur_des_mouvements\.sql$/, ['../../supabase/preparees/', '../../supabase/schema/'])
const RETOUR = leFichier(/^\d{14}_retour_date_de_valeur_des_mouvements\.sql$/, ['../../supabase/preparees/retour/'])
const ESSAI = readFileSync(new URL('../../supabase/essais/dateDeValeurDesMouvements.sql', import.meta.url), 'utf8')
const EXPORTEE = readdirSync(new URL('../../supabase/schema/', import.meta.url).pathname)
  .some((f) => /^\d{14}_date_de_valeur_des_mouvements\.sql$/.test(f))
const DEFINITION = 'CHECK (((date_valeur IS NULL) OR ((date_valeur >= (date - 92)) AND (date_valeur <= (date + 92)))))'

describe('lireDateDeValeur', () => {
  it('une cellule vide ne donne aucune date de valeur, sans rien compter d’écarté', () => {
    expect(lireDateDeValeur('', '2026-01-05')).toBeNull()
    expect(lireDateDeValeur('   ', '2026-01-05')).toBeNull()
  })

  it('lit la date comme la date d’opération (JJ/MM/AAAA, ISO, deux chiffres d’année), après ou avant elle', () => {
    expect(lireDateDeValeur('06/01/2026', '2026-01-05')).toEqual({ date: '2026-01-06' })
    expect(lireDateDeValeur(' 2026-01-02 ', '2026-01-05')).toEqual({ date: '2026-01-02' })
    expect(lireDateDeValeur('31.12.25', '2026-01-02')).toEqual({ date: '2025-12-31' })
  })

  it('une date qui ne se lit pas s’écarte, jamais devinée', () => {
    expect(lireDateDeValeur('31/02/2026', '2026-02-27')).toEqual({ ecart: 'illisible' })
    expect(lireDateDeValeur('valeur J+1', '2026-02-27')).toEqual({ ecart: 'illisible' })
    expect(lireDateDeValeur('forme non reconnue : 2026', '2026-02-27')).toEqual({ ecart: 'illisible' })
  })

  it('la borne de 92 jours, des deux côtés, à cheval sur le 31 décembre comme ailleurs', () => {
    expect(ECART_MAXIMAL_DE_LA_DATE_DE_VALEUR).toBe(92)
    expect(lireDateDeValeur('2026-04-02', '2025-12-31')).toEqual({ date: '2026-04-02' })
    expect(lireDateDeValeur('2026-04-03', '2025-12-31')).toEqual({ ecart: 'eloignee' })
    expect(lireDateDeValeur('2025-12-31', '2026-04-02')).toEqual({ date: '2025-12-31' })
    expect(lireDateDeValeur('2025-12-30', '2026-04-02')).toEqual({ ecart: 'eloignee' })
    // Une année bissextile : le 29 février compte.
    expect(lireDateDeValeur('2028-05-30', '2028-02-28')).toEqual({ date: '2028-05-30' })
    expect(lireDateDeValeur('2028-05-31', '2028-02-28')).toEqual({ ecart: 'eloignee' })
  })
})

describe('phraseDesDatesDeValeur', () => {
  it('rien quand aucune opération n’est lue', () => {
    expect(phraseDesDatesDeValeur({ gardees: 0, sans: 0, illisibles: 0, eloignees: 0 })).toBeNull()
  })

  it('compte les gardées, celles que le fichier ne porte pas, et chaque raison d’écart', () => {
    expect(phraseDesDatesDeValeur({ gardees: 3, sans: 0, illisibles: 0, eloignees: 0 })).toBe('Date de valeur gardée sur 3 opération(s).')
    expect(phraseDesDatesDeValeur({ gardees: 2, sans: 1, illisibles: 1, eloignees: 2 })).toBe(
      'Date de valeur gardée sur 2 opération(s) ; 1 sans date de valeur dans le fichier ; 3 non gardée(s) (1 illisible(s), '
      + '2 à plus de 92 jours de la date d’opération) : ces mouvements s’importent sans elle.')
  })
})

describe('la migration date_de_valeur_des_mouvements', () => {
  it('pose une date nullable sans défaut et la borne que le module redit, rien d’autre', () => {
    expect(MIGRATION).toContain('alter table public.lignes_bancaires add column date_valeur date;')
    expect(MIGRATION).toContain(`check (date_valeur is null or (date_valeur >= date - ${ECART_MAXIMAL_DE_LA_DATE_DE_VALEUR} `
      + `and date_valeur <= date + ${ECART_MAXIMAL_DE_LA_DATE_DE_VALEUR}));`)
    // La garde de fin attend la définition que le catalogue rend, comme l'essai et le retour.
    expect(MIGRATION).toContain(`is distinct from '${DEFINITION}'`)
    expect(RETOUR).toContain(`is distinct from '${DEFINITION}'`)
    expect(ESSAI).toContain(DEFINITION)
    // Aucune fonction, aucun déclencheur, aucune policy ; aucune instruction que l'outil d'application retiendrait.
    expect(MIGRATION).not.toMatch(/create (or replace )?(function|trigger|policy)/i)
    expect(MIGRATION).not.toMatch(/\b(drop|delete|truncate)\b/i)
    expect(MIGRATION).not.toContain('\\')
  })

  it('le figement relu en tête et en fin : le corps de garder_mouvement_valide qui compare la ligne entière', () => {
    expect(MIGRATION.match(/f10207e741e52cd7684e2b9e5ccd5328/g)).toHaveLength(2)
    expect(ESSAI).toContain('f10207e741e52cd7684e2b9e5ccd5328')
  })

  it('le retour se colle par le cabinet, et refuse dès qu’un mouvement porte une date de valeur', () => {
    expect(RETOUR).toMatch(/À COLLER par le cabinet/)
    expect(RETOUR).toContain('where date_valeur is not null')
    expect(RETOUR).toContain('alter table public.lignes_bancaires drop column date_valeur;')
  })

  it('le drapeau suit l’export : baissé tant que la migration n’y est pas, levé le jour où elle y entre', () => {
    expect(DATE_DE_VALEUR_PREVUE).toBe(EXPORTEE)
  })
})
