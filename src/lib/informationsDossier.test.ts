import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  chargerInformationsDossier,
  enregistrerInformationsDossier,
  payloadInformations,
  type SaisieInformations,
} from './informationsDossier'
import type { InformationsDossier } from './types'

// CE QUE CE MODULE DOIT SAVOIR DIRE : la différence entre « ce dossier n'a rien rempli » et « on
// n'a pas pu lire ». Les deux rendaient jusqu'ici le même formulaire vide, et l'enregistrement qui
// suit porte TOUS les champs — donc écrase ce qu'on n'a pas lu.
const faux = vi.hoisted(() => ({
  lecture: { data: null as InformationsDossier | null, error: null as { message: string } | null },
  ecriture: { error: null as { message: string } | null },
  payloads: [] as unknown[],
  conflits: [] as unknown[],
}))

vi.mock('./supabase', () => ({
  supabase: {
    from: () => {
      const chaine: Record<string, unknown> = {}
      Object.assign(chaine, {
        select: () => chaine,
        eq: () => chaine,
        maybeSingle: () => Promise.resolve(faux.lecture),
        upsert: (payload: unknown, options: unknown) => {
          faux.payloads.push(payload)
          faux.conflits.push(options)
          return Promise.resolve(faux.ecriture)
        },
      })
      return chaine
    },
  },
}))

function ligne(o: Partial<InformationsDossier> = {}): InformationsDossier {
  return {
    id: 'i1', dossier_id: 'd1', vehicule_type: 'personnel_ik', vehicule_libelle: 'Peugeot 308',
    jours_travailles_an: 218, tickets_restaurant: true,
    justificatif_tickets_restaurant_recu: false, cheques_vacances: true,
    justificatif_cheques_vacances_recu: false, notes: 'Local partagé',
    updated_at: '2026-09-20T10:00:00Z', ...o,
  }
}

function saisie(o: Partial<SaisieInformations> = {}): SaisieInformations {
  return {
    vehiculeType: 'personnel_ik', vehiculeLibelle: 'Peugeot 308', joursTravailles: '218',
    ticketsRestaurant: true, chequesVacances: false, notes: 'Local partagé', ...o,
  }
}

beforeEach(() => {
  faux.lecture = { data: null, error: null }
  faux.ecriture = { error: null }
  faux.payloads = []
  faux.conflits = []
})

describe('chargerInformationsDossier — « rien à lire » et « pas pu lire » ne sont pas la même chose', () => {
  it('rend la ligne du dossier', async () => {
    faux.lecture = { data: ligne(), error: null }
    const { informations, erreur } = await chargerInformationsDossier('d1')
    expect(informations?.vehicule_type).toBe('personnel_ik')
    expect(erreur).toBeNull()
  })

  it('rend « rien », sans erreur, sur un dossier qui n’a jamais rempli le formulaire', async () => {
    // Le garde SYMÉTRIQUE : sans lui, « l'écran refuse d'enregistrer quand ça a échoué » serait
    // satisfait par un écran qui refuse TOUJOURS — c'est-à-dire un formulaire qu'on ne peut plus
    // remplir sur un dossier neuf, qui est le cas le plus courant.
    faux.lecture = { data: null, error: null }
    const { informations, erreur } = await chargerInformationsDossier('d1')
    expect(informations).toBeNull()
    expect(erreur).toBeNull()
  })

  it('REND l’erreur quand la lecture échoue, au lieu de la jeter', async () => {
    // Le défaut d'origine : `const { data } = …` puis `if (data)`. Une session expirée laissait le
    // formulaire sur ses valeurs par défaut, sans un mot.
    faux.lecture = { data: null, error: { message: 'JWT expired' } }
    const { informations, erreur } = await chargerInformationsDossier('d1')
    expect(informations).toBeNull()
    expect(erreur).toContain('JWT expired')
  })

  it('lit le message d’une erreur Postgrest, qui n’est PAS une instance d’Error', async () => {
    // L'objet nu est exactement ce que rend le chemin non levant de postgrest-js, et c'est le piège
    // que `messageErreur` existe pour fermer : un `instanceof Error` jetterait la raison.
    faux.lecture = { data: null, error: { message: 'permission denied for table informations_dossier' } }
    const { erreur } = await chargerInformationsDossier('d1')
    expect(erreur).toContain('permission denied')
  })

  it('retombe sur un repli parlant quand l’erreur ne porte pas de message', async () => {
    faux.lecture = { data: null, error: { message: '' } }
    const { erreur } = await chargerInformationsDossier('d1')
    expect(erreur).toBe("Les informations du dossier n'ont pas pu être lues.")
  })
})

describe('payloadInformations — ce que le formulaire envoie vraiment', () => {
  it('retire le libellé quand il n’y a aucun véhicule', () => {
    // Un champ grisé GARDE sa valeur : la règle est déjà payée sur la carte Véhicules, et ici elle
    // enverrait le modèle d'une voiture que le dossier déclare ne pas avoir.
    const p = payloadInformations('d1', saisie({ vehiculeType: 'aucun', vehiculeLibelle: 'Peugeot 308' }))
    expect(p.vehicule_type).toBe('aucun')
    expect(p.vehicule_libelle).toBeNull()
  })

  it('garde le libellé, nettoyé, quand il y a un véhicule', () => {
    const p = payloadInformations('d1', saisie({ vehiculeLibelle: '  Peugeot 308  ' }))
    expect(p.vehicule_libelle).toBe('Peugeot 308')
  })

  it('rend null plutôt qu’une chaîne vide sur les jours et les notes', () => {
    const p = payloadInformations('d1', saisie({ joursTravailles: '', notes: '   ' }))
    expect(p.jours_travailles_an).toBeNull()
    expect(p.notes).toBeNull()
  })

  it('convertit les jours travaillés en nombre', () => {
    expect(payloadInformations('d1', saisie({ joursTravailles: '218' })).jours_travailles_an).toBe(218)
  })

  it('n’écrit AUCUN des deux justificatifs reçus', () => {
    // Ils se cochent depuis la Checklist. Les poser ici les remettrait à faux à chaque
    // enregistrement du formulaire — un travail déjà fait, défait sans un signal.
    const p = payloadInformations('d1', saisie()) as Record<string, unknown>
    expect('justificatif_tickets_restaurant_recu' in p).toBe(false)
    expect('justificatif_cheques_vacances_recu' in p).toBe(false)
  })
})

describe('enregistrerInformationsDossier', () => {
  it('vise la contrainte unique du dossier', async () => {
    await enregistrerInformationsDossier('d1', saisie())
    expect(faux.conflits).toEqual([{ onConflict: 'dossier_id' }])
  })

  it('rend null quand l’écriture passe', async () => {
    expect(await enregistrerInformationsDossier('d1', saisie())).toBeNull()
  })

  it('REND le message quand l’écriture échoue', async () => {
    faux.ecriture = { error: { message: 'new row violates row-level security policy' } }
    const erreur = await enregistrerInformationsDossier('d1', saisie())
    expect(erreur).toContain('row-level security')
  })
})
