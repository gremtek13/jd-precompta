import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  AUTEUR_DES_CONNEXIONS_PREVU, RAISON_AUTEUR_NON_LU, RAISON_CONNEXION_HORS_DU_CABINET, auteurDeLaConnexionDit,
  refusDeLAuteurDitAuClient,
} from './auteurDesConnexions'
import { motsDuCabinet } from './espaceVentes'
import { refusDitAuClient } from './receptionParLeClient'
import { indiceSql } from '../test/schema'

// QUI A ÉCRIT LA CONNEXION À LA PLATEFORME DU CLIENT (B4RS-Q1) : ce que les deux espaces en disent, drapeau baissé (l'écran
// d'hier) et levé ; la raison du refus confrontée à la fonction, et la migration à ses refus.
const RACINE = join(__dirname, '../..')
const FONCTION = readFileSync(join(RACINE, 'supabase/functions/plateforme-agreee/index.ts'), 'utf8')
const MIGRATION = readFileSync(join(RACINE, 'supabase/preparees/20261113201000_auteur_des_connexions_plateformes.sql'), 'utf8')

describe('le drapeau de l’auteur des connexions', () => {
  it('est baissé tant que la migration n’est pas en base', () => {
    expect(AUTEUR_DES_CONNEXIONS_PREVU).toBe(false)
  })

  it('baissé (la valeur par défaut) : rien ne se dit, ni dans la fiche ni dans le refus', () => {
    expect(auteurDeLaConnexionDit({ ecrite_par_le_cabinet: false, ecrite_le: null }, 'cabinet')).toBeNull()
    expect(auteurDeLaConnexionDit({ ecrite_par_le_cabinet: true, ecrite_le: '2026-11-13T09:00:00.000Z' }, 'client')).toBeNull()
    expect(refusDeLAuteurDitAuClient(RAISON_CONNEXION_HORS_DU_CABINET)).toBeNull()
    // Le refus de la fonction se dit alors par sa phrase, comme toute raison inconnue de l'écran d'hier.
    expect(refusDitAuClient('La connexion à la plateforme n’a pas été enregistrée par le cabinet.', RAISON_CONNEXION_HORS_DU_CABINET))
      .toBe('Ta plateforme n’a pas pu être relevée : La connexion à la plateforme n’a pas été enregistrée par le cabinet.')
  })
})

describe('l’auteur non lu : la relève par un accès client fermée par la fonction d’aujourd’hui', () => {
  it('se dit au client, drapeau baissé comme levé, à ses mots, sans renvoyer à la phrase du serveur', () => {
    const dit = refusDeLAuteurDitAuClient(RAISON_AUTEUR_NON_LU)
    expect(dit).toMatch(/^La relève depuis ton espace n’est pas encore ouverte : .* Parles-en à ton cabinet\.$/)
    expect(refusDeLAuteurDitAuClient(RAISON_AUTEUR_NON_LU, true)).toBe(dit)
    expect(refusDitAuClient('La relève depuis l’espace client n’est pas encore ouverte.', RAISON_AUTEUR_NON_LU)).toBe(dit)
    expect(motsDuCabinet(dit ?? '')).toEqual([])
  })

  it('la raison est celle que la fonction nomme, une fois, dans la réception par le client', () => {
    expect(FONCTION.split(`raison: "${RAISON_AUTEUR_NON_LU}"`)).toHaveLength(2)
    const debut = FONCTION.indexOf('// ── DÉBUT RÉCEPTION PAR LE CLIENT')
    const fin = FONCTION.indexOf('// ── FIN RÉCEPTION PAR LE CLIENT')
    const ici = FONCTION.indexOf(`raison: "${RAISON_AUTEUR_NON_LU}"`)
    expect(ici > debut && ici < fin).toBe(true)
  })
})

describe('levé : la fiche de la plateforme et le refus de la relève', () => {
  it('écrite par le cabinet : son jour, aux mots de chaque espace ; jamais un compte', () => {
    const vue = { ecrite_par_le_cabinet: true, ecrite_le: '2026-11-13T09:00:00.000Z' }
    expect(auteurDeLaConnexionDit(vue, 'cabinet', true)).toBe('le cabinet, le 13/11/2026')
    expect(auteurDeLaConnexionDit(vue, 'client', true)).toBe('ton cabinet, le 13/11/2026')
    expect(auteurDeLaConnexionDit({ ecrite_par_le_cabinet: true, ecrite_le: null }, 'cabinet', true)).toBe('le cabinet')
  })

  it('pas par le cabinet : la relève depuis l’espace client y est fermée, dit à chacun', () => {
    const vue = { ecrite_par_le_cabinet: false, ecrite_le: null }
    expect(auteurDeLaConnexionDit(vue, 'cabinet', true)).toMatch(/^pas par le cabinet .*reste fermée tant que vous ne l’avez pas enregistrée vous-même$/)
    expect(auteurDeLaConnexionDit(vue, 'client', true)).toBe('pas par ton cabinet : « Relever ma plateforme » attend qu’il l’enregistre')
  })

  it('une vue qui ne porte pas l’auteur (la fonction d’avant) : rien ne se dit', () => {
    expect(auteurDeLaConnexionDit({}, 'cabinet', true)).toBeNull()
  })

  it('le refus nommé, et lui seul', () => {
    expect(refusDeLAuteurDitAuClient(RAISON_CONNEXION_HORS_DU_CABINET, true)).toMatch(/^La connexion à ta plateforme n’a pas été enregistrée par ton cabinet/)
    expect(refusDeLAuteurDitAuClient('sans_plateforme', true)).toBeNull()
    expect(refusDeLAuteurDitAuClient(null, true)).toBeNull()
  })
})

describe('les mots confrontés à la fonction et à la migration', () => {
  it('la raison est celle que la fonction nomme, une fois, dans la réception par le client', () => {
    expect(FONCTION.split(`raison: "${RAISON_CONNEXION_HORS_DU_CABINET}"`)).toHaveLength(2)
    const debut = FONCTION.indexOf('// ── DÉBUT RÉCEPTION PAR LE CLIENT')
    const fin = FONCTION.indexOf('// ── FIN RÉCEPTION PAR LE CLIENT')
    const ici = FONCTION.indexOf(`raison: "${RAISON_CONNEXION_HORS_DU_CABINET}"`)
    expect(ici > debut && ici < fin).toBe(true)
  })

  it('la fonction lit les deux colonnes que la migration pose, et appelle l’attestation qu’elle crée, sous ses paramètres', () => {
    expect(FONCTION).toContain('const COLONNES_DE_L_AUTEUR = ", ecrite_par, ecrite_le"')
    expect(MIGRATION).toContain('add column ecrite_par uuid,\n  add column ecrite_le timestamptz,')
    expect(MIGRATION).toContain('create function public.attester_connexion_plateforme(p_dossier_id uuid, p_version timestamptz)')
    expect(FONCTION).toContain('.rpc("attester_connexion_plateforme", { p_dossier_id: dossierId, p_version: ecrite.updated_at })')
  })

  it('l’attestation ne prend pas d’auteur en paramètre : la base le lit de la session', () => {
    const corps = MIGRATION.slice(indiceSql(MIGRATION, 'create function public.attester_connexion_plateforme'))
    expect(corps).toContain('set ecrite_par = auth.uid(), ecrite_le = pg_catalog.now()')
    expect(corps).toContain("raise exception 'Accès refusé à ce dossier.' using errcode = '42501';")
  })
})
