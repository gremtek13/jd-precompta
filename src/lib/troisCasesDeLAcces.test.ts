import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TROIS_CASES_EXPORTEES } from './troisCasesDeLAcces'
import { SITUATIONS_PUBLIEES_EXPORTEES } from './situationsPubliees'
import {
  CASES_SANS_EFFET, DOMAINES, ceQueDitLaCaseSansEffet, definitionDe, demandeDeChangement, demandeDeChangementSelon,
  demandeDeChangementSelonLaForme, domainesSelon, domainesSelonLesMigrations, droitsDeLaLigne, droitsParDossier,
  formeDeChangerDroitsAcces, gesteDeLaCase,
} from './droitsAcces'

// LES TROIS CASES DE B1 (espace client, ligne 51.5, étape B1) : le drapeau, ses deux états, et les mots de l'écran
// confrontés au texte de la migration préparée (supabase/preparees/20261107140000_trois_cases_de_l_acces.sql) et de son
// retour. L'essai en base : supabase/essais/troisCasesDeLAcces.sql.
const RACINE = process.cwd()
const MIGRATION = readFileSync(resolve(RACINE, 'supabase/preparees/20261107140000_trois_cases_de_l_acces.sql'), 'utf8')
const RETOUR = readFileSync(resolve(RACINE, 'supabase/preparees/retour/20261107140100_retour_trois_cases_de_l_acces.sql'), 'utf8')

describe('les trois cases de B1 : le drapeau', () => {
  it('suit l’export, et ne se lève qu’après C4a', () => {
    const exportee = readdirSync(resolve(RACINE, 'supabase/schema')).some((f) => /^\d{14}_trois_cases_de_l_acces\.sql$/.test(f))
    expect(TROIS_CASES_EXPORTEES).toBe(exportee)
    expect(!TROIS_CASES_EXPORTEES || SITUATIONS_PUBLIEES_EXPORTEES).toBe(true)
  })

  it('les cases de l’onglet, état par état ; baissé, l’onglet d’hier', () => {
    const noms = (comptes: boolean, trois: boolean) => domainesSelonLesMigrations(comptes, trois).map((d) => d.domaine)
    expect(noms(false, false)).toEqual(['ventes', 'banque', 'caisse'])
    expect(noms(true, false)).toEqual(['ventes', 'banque', 'caisse', 'comptes'])
    expect(noms(true, true)).toEqual(['ventes', 'banque', 'caisse', 'comptes', 'achats', 'frais', 'documents'])
    expect(domainesSelon(true).map((d) => d.domaine)).toEqual(noms(true, false))
    expect(DOMAINES).toEqual(domainesSelonLesMigrations(SITUATIONS_PUBLIEES_EXPORTEES, TROIS_CASES_EXPORTEES))
    for (const d of CASES_SANS_EFFET) expect(definitionDe(d).colonne).toBe(`droit_${d}`)
  })

  it('la forme de changer_droits_acces : à huit sous B1, et le seul droit cliqué non nul', () => {
    expect([formeDeChangerDroitsAcces(false, false), formeDeChangerDroitsAcces(true, false), formeDeChangerDroitsAcces(true, true)])
      .toEqual([4, 5, 8])
    expect(demandeDeChangementSelonLaForme(8, 'm1', 'frais', true)).toEqual({
      p_membership_id: 'm1', p_ventes: null, p_banque: null, p_caisse: null, p_comptes: null, p_achats: null, p_frais: true,
      p_documents: null,
    })
    expect(demandeDeChangementSelonLaForme(8, 'm1', 'ventes', false)).toMatchObject({ p_ventes: false, p_achats: null })
    expect(Object.keys(demandeDeChangementSelonLaForme(5, 'm1', 'comptes', true))).not.toContain('p_achats')
    expect(Object.keys(demandeDeChangementSelonLaForme(4, 'm1', 'caisse', true))).not.toContain('p_comptes')
    expect(demandeDeChangementSelon(true, 'm1', 'comptes', true)).toEqual(demandeDeChangementSelonLaForme(5, 'm1', 'comptes', true))
    expect(demandeDeChangement('m1', 'banque', true))
      .toEqual(demandeDeChangementSelonLaForme(formeDeChangerDroitsAcces(SITUATIONS_PUBLIEES_EXPORTEES, TROIS_CASES_EXPORTEES), 'm1', 'banque', true))
  })

  it('seul `true` accorde ; deux lignes du même dossier, un droit sur les DEUX', () => {
    expect(droitsDeLaLigne({ droit_achats: true, droit_frais: 'true', droit_documents: 1 }))
      .toMatchObject({ achats: true, frais: false, documents: false })
    expect(droitsParDossier([
      { dossier_id: 'd', droit_achats: true, droit_frais: true, droit_documents: false },
      { dossier_id: 'd', droit_achats: true, droit_frais: false, droit_documents: true },
    ]).d).toMatchObject({ achats: true, frais: false, documents: false })
  })

  it('aucune garde : les deux gestes ; chaque phrase dit qu’elle ne change encore rien, et l’étape qui s’en servira', () => {
    const etapes = { achats: 'B4', frais: 'B7', documents: 'B2' } as const
    for (const d of CASES_SANS_EFFET) {
      expect(gesteDeLaCase(d, { etat: 'non_bascule' }, { etat: 'en_engagement', statut: 'exonere' })).toMatchObject({ cocher: true, decocher: true })
      const phrase = ceQueDitLaCaseSansEffet(d)
      expect(phrase).toContain(`« ${definitionDe(d).libelle} »`)
      expect(phrase).toContain('ne change encore rien')
      expect(phrase).toContain(`(étape ${etapes[d]})`)
    }
  })
})

describe('les trois cases de B1 : les mots de l’écran confrontés à la migration', () => {
  it('la forme à huit, ses paramètres et le refus qui nomme les sept cases, dans l’ordre de l’onglet', () => {
    expect(MIGRATION).toContain('p_comptes boolean, p_achats boolean, p_frais boolean, p_documents boolean)')
    const cles = Object.keys(demandeDeChangementSelonLaForme(8, 'm1', 'achats', true))
    for (const cle of cles) expect(MIGRATION).toMatch(new RegExp(`\\b${cle} (uuid|boolean)\\b`))
    const libelles = domainesSelonLesMigrations(true, true).map((d) => `« ${d.libelle} »`)
    expect(MIGRATION).toContain(`Aucun droit à changer : précise ${libelles.slice(0, -1).join(', ')} ou ${libelles.at(-1)}.`)
  })

  it('chaque case : sa colonne fausse par défaut, son mot dans client_du_dossier et droits_sur_le_dossier, ce qu’elle ouvrira dans son commentaire', () => {
    for (const d of CASES_SANS_EFFET) {
      expect(MIGRATION).toContain(`add column droit_${d} boolean not null default false`)
      expect(MIGRATION).toContain(`when '${d}' then m.droit_${d}`)
      expect(MIGRATION).toContain(`'${d}', public.admin_du_dossier(p_dossier_id) or public.client_du_dossier(p_dossier_id, '${d}')`)
      const commentaire = MIGRATION.slice(MIGRATION.indexOf(`comment on column public.memberships.droit_${d} is`))
      expect(commentaire.slice(0, commentaire.indexOf("';"))).toContain(definitionDe(d).ouvrira.replace(/’/g, "''"))
    }
  })

  it('le retour : les trois colonnes et la forme à huit, refusé sous une case cochée', () => {
    expect(RETOUR).toContain('drop function public.changer_droits_acces(uuid, boolean, boolean, boolean, boolean, boolean, boolean, boolean);')
    expect(RETOUR).toMatch(/drop column droit_achats,\s+drop column droit_frais,\s+drop column droit_documents;/i)
    expect(RETOUR).toContain('where m.droit_achats or m.droit_frais or m.droit_documents')
  })
})
