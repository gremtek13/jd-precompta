import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lireLeReglageDeLaHausse } from './hausseDuChiffreDAffairesLecture'

// LA LECTURE DU RÉGLAGE DE L'ALERTE : les adresses de l'équipe se lisent pour les comptes qui ont réglé un seuil (CA2-Q1) ET pour
// ceux qui ont posé une marque « vue avec le client » (CA2Q1-Q1), sans doublon, sous la session de qui regarde ; une lecture de
// l'équipe en échec ne rend aucune adresse (la carte dit « le cabinet »), sans rendre le réglage illisible. Données FICTIVES.
const faux = vi.hoisted(() => ({
  seuils: [] as Record<string, unknown>[],
  vues: [] as Record<string, unknown>[],
  equipe: [] as Record<string, unknown>[],
  equipeEnErreur: false,
  demandes: [] as string[][],
}))

vi.mock('./supabase', () => {
  const requete = (table: string) => {
    let ids: string[] = []
    const q = {
      select: () => q,
      eq: () => q,
      order: () => q,
      in: (_colonne: string, valeurs: string[]) => { ids = valeurs; return q },
      range: () => {
        if (table === 'cabinet_admins') {
          faux.demandes.push(ids)
          if (faux.equipeEnErreur) return Promise.resolve({ data: null, error: { message: 'refusée' }, count: null })
          const lignes = faux.equipe.filter((l) => ids.includes(l.user_id as string))
          return Promise.resolve({ data: lignes, error: null, count: lignes.length })
        }
        const lignes = table === 'seuils_du_chiffre_d_affaires' ? faux.seuils : faux.vues
        return Promise.resolve({ data: lignes, error: null, count: lignes.length })
      },
    }
    return q
  }
  return { supabase: { from: (table: string) => requete(table) } }
})

const SEUIL = {
  id: 's1', dossier_id: 'd1', seuil_de_hausse: 20, seuil_de_baisse: null, regle_par: 'u-chef', regle_le: '2026-11-16T09:00:00Z',
  seuil_de_hausse_regle_par: 'u-chef', seuil_de_hausse_regle_le: '2026-11-16T09:00:00Z', seuil_de_baisse_regle_par: null,
  seuil_de_baisse_regle_le: null,
}
const vue = (trimestre: number, par: string) => ({ id: `v${trimestre}`, dossier_id: 'd1', annee: 2026, trimestre, vue_par: par, vue_le: '2026-11-16T09:00:00Z' })

beforeEach(() => {
  faux.seuils = [SEUIL]
  faux.vues = []
  faux.equipe = [{ user_id: 'u-chef', email: 'chef@cabinet.example' }, { user_id: 'u-membre', email: 'membre@cabinet.example' }]
  faux.equipeEnErreur = false
  faux.demandes = []
})

describe('la lecture du réglage — l’équipe des seuils et des marques', () => {
  it('les auteurs des seuils et des marques, une fois chacun, triés ; leurs adresses lues', async () => {
    faux.vues = [vue(3, 'u-membre'), vue(2, 'u-chef'), vue(1, 'u-parti')]
    const lu = await lireLeReglageDeLaHausse('d1')
    expect(faux.demandes).toEqual([['u-chef', 'u-membre', 'u-parti']])
    expect(lu.etat === 'lu' && [...(lu.equipe ?? new Map())]).toEqual([['u-chef', 'chef@cabinet.example'], ['u-membre', 'membre@cabinet.example']])
  })

  it('sans seuil, les auteurs des marques seuls ; sans auteur, aucune lecture de l’équipe', async () => {
    faux.seuils = []
    faux.vues = [vue(3, 'u-membre')]
    await lireLeReglageDeLaHausse('d1')
    expect(faux.demandes).toEqual([['u-membre']])
    faux.demandes = []
    faux.vues = []
    const lu = await lireLeReglageDeLaHausse('d1')
    expect(faux.demandes).toEqual([])
    expect(lu.etat === 'lu' && lu.equipe?.size).toBe(0)
  })

  it('l’équipe en échec : aucune adresse, et le réglage reste lu', async () => {
    faux.vues = [vue(3, 'u-membre')]
    faux.equipeEnErreur = true
    const lu = await lireLeReglageDeLaHausse('d1')
    expect(lu.etat).toBe('lu')
    expect(lu.etat === 'lu' && lu.equipe?.size).toBe(0)
  })
})
