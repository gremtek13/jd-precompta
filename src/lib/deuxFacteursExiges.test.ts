import { describe, expect, it } from 'vitest'
import {
  DEUX_FACTEURS_EXIGES_EXPORTE, compteLu, confirmationDuGeste, exigenceRecommandee, gestesDuCompte, monExigenceLue,
  porteDeLExigence, type CompteDeuxFacteurs,
} from './deuxFacteursExiges'

const LIGNE = {
  user_id: 'u1', email: 'membre@essai.invalid', genre: 'membre', a_un_facteur: true, exigee_depuis: null,
  dernier_retrait: null, peut_exiger: true, peut_lever: true, peut_retirer: true,
}
const compte = (p: Partial<CompteDeuxFacteurs> = {}): CompteDeuxFacteurs => ({ ...(compteLu(LIGNE) as CompteDeuxFacteurs), ...p })

describe('la double authentification exigée — la règle (C7, second temps)', () => {
  it('le drapeau est baissé tant que la migration n’est pas en base', () => {
    expect(DEUX_FACTEURS_EXIGES_EXPORTE).toBe(false)
  })

  it('une ligne d’une autre forme ne se lit pas : la liste entière se dira illisible', () => {
    expect(compteLu(LIGNE)?.userId).toBe('u1')
    for (const faute of [{ genre: 'chef_inconnu' }, { a_un_facteur: 'oui' }, { email: 3 }, { user_id: null }, { peut_lever: undefined }]) {
      expect(compteLu({ ...LIGNE, ...faute }), JSON.stringify(faute)).toBeNull()
    }
    expect(compteLu(null)).toBeNull()
  })

  it('les gestes : ce que la base permet, et ce que l’état du compte rend utile', () => {
    expect(gestesDuCompte(compte())).toEqual(['exiger', 'retirer'])
    expect(gestesDuCompte(compte({ aUnFacteur: false }))).toEqual([])
    expect(gestesDuCompte(compte({ exigeeDepuis: '2026-11-07T10:00:00Z' }))).toEqual(['lever', 'retirer'])
    expect(gestesDuCompte(compte({ exigeeDepuis: '2026-11-07T10:00:00Z', aUnFacteur: false }))).toEqual(['lever'])
    expect(gestesDuCompte(compte({ peutExiger: false, peutLever: false, peutRetirer: false }))).toEqual([])
  })

  it('SEC-Q1 et SEC-Q2 : le cabinet toujours ; un client pour « Ventes », « Banque », « Achats » ou « Documents », pas « Caisse » seule', () => {
    expect(exigenceRecommandee({ genre: 'chef' }, null)).toBe(true)
    expect(exigenceRecommandee({ genre: 'membre' }, null)).toBe(true)
    expect(exigenceRecommandee({ genre: 'client' }, { caisse: true })).toBe(false)
    expect(exigenceRecommandee({ genre: 'client' }, { ventes: true })).toBe(true)
    expect(exigenceRecommandee({ genre: 'client' }, { documents: true, caisse: false })).toBe(true)
    expect(exigenceRecommandee({ genre: 'client' }, null)).toBe(false)
  })

  it('chaque confirmation nomme le compte et dit ce qui change pour lui', () => {
    expect(confirmationDuGeste('exiger', compte())).toContain('membre@essai.invalid')
    expect(confirmationDuGeste('lever', compte())).toContain('seul mot de passe')
    expect(confirmationDuGeste('retirer', compte({ exigeeDepuis: '2026-11-07T10:00:00Z' }))).toContain('inscrira un nouvel appareil')
    expect(confirmationDuGeste('retirer', compte())).toContain('seul mot de passe')
    expect(confirmationDuGeste('retirer', compte())).toContain('sessions fermées')
  })

  it('la porte : drapeau baissé ou aal2, ouverte sans lecture ; exigé sans facteur, l’inscription ; illisible, fermée', () => {
    const lue = (exigee: boolean, satisfaite = !exigee) => ({ etat: 'lue' as const, valeur: { exigee, satisfaite, espace: 'client' as const } })
    expect(porteDeLExigence(false, 'aal1', lue(true), 'sans-facteur')).toBe('ouverte')
    expect(porteDeLExigence(true, 'aal2', { etat: 'lecture' }, 'verifie')).toBe('ouverte')
    expect(porteDeLExigence(true, 'aal1', { etat: 'lecture' }, 'sans-facteur')).toBe('lecture')
    expect(porteDeLExigence(true, 'aal1', { etat: 'illisible' }, 'sans-facteur')).toBe('illisible')
    expect(porteDeLExigence(true, 'aal1', lue(true), 'sans-facteur')).toBe('inscription')
    expect(porteDeLExigence(true, 'aal1', lue(true), 'code-a-donner')).toBe('ouverte')
    expect(porteDeLExigence(true, 'aal1', lue(false), 'sans-facteur')).toBe('ouverte')
    expect(porteDeLExigence(true, null, lue(true), 'sans-facteur')).toBe('inscription')
  })

  it('ce que la porte lit se refuse sur une autre forme', () => {
    expect(monExigenceLue({ exigee: true, satisfaite: false, espace: 'cabinet' })).toEqual({ exigee: true, satisfaite: false, espace: 'cabinet' })
    expect(monExigenceLue({ exigee: 'oui', satisfaite: false, espace: null })).toBeNull()
    expect(monExigenceLue({ exigee: true, satisfaite: false, espace: 'equipe' })).toBeNull()
  })
})
