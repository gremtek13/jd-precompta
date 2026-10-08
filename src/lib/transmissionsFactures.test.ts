import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  DELAI_AVANT_ABANDON_MS, ETATS_ACTIFS, ETATS_TRANSMISSION, STATUTS_ANNULATION_SUPERPDP, abandonnable, estActive,
  libelleCanal, libelleCourtCanal, transmissionCourante, transmissionsDe,
} from './transmissionsFactures'
import type { EtatTransmission, TransmissionFacture } from './types'

const MIGRATION = readFileSync(new URL('../../supabase/schema/20261008045542_transmissions_des_factures.sql', import.meta.url), 'utf8')

function transmission(o: Partial<TransmissionFacture> = {}): TransmissionFacture {
  return {
    id: 't1', dossier_id: 'd1', facture_id: 'f1', canal: 'plateforme', hote: 'flux.plateforme-demo.fr', flux_id: null,
    sha256: 'a'.repeat(64), etat: 'envoi', detail: null, cree_le: '2026-10-08T08:00:00+00:00', maj_le: '2026-10-08T08:00:00+00:00',
    ...o,
  }
}

describe('les états d’une transmission', () => {
  it('les états actifs sont ceux de l’index unique de la base, et chaque état de la base a son libellé', () => {
    const index = /create unique index transmissions_factures_une_active[\s\S]*?where etat in \(([^)]*)\)/.exec(MIGRATION)
    expect(index).not.toBeNull()
    expect([...ETATS_ACTIFS].sort()).toEqual([...(index as RegExpExecArray)[1].matchAll(/'(\w+)'/g)].map((m) => m[1]).sort())
    const check = /constraint transmissions_factures_etat check \(etat in \(([^)]*)\)\)/.exec(MIGRATION)
    expect(check).not.toBeNull()
    const etats = [...(check as RegExpExecArray)[1].matchAll(/'(\w+)'/g)].map((m) => m[1] as EtatTransmission)
    expect(Object.keys(ETATS_TRANSMISSION).sort()).toEqual([...etats].sort())
  })

  it('une transmission active empêche un nouvel envoi ; un échec ou un rejet, non', () => {
    expect((['envoi', 'depose', 'accepte', 'rejete', 'echec'] as const).map((etat) => estActive({ etat })))
      .toEqual([true, true, true, false, false])
  })

  it('le canal se nomme, avec l’hôte de la plateforme du client', () => {
    expect(libelleCanal(transmission())).toBe('la plateforme du client (flux.plateforme-demo.fr)')
    expect(libelleCanal(transmission({ canal: 'superpdp', hote: 'api.superpdp.tech' }))).toBe('Super PDP')
    expect([libelleCourtCanal({ canal: 'plateforme' }), libelleCourtCanal({ canal: 'superpdp' })]).toEqual(['Plateforme du client', 'Super PDP'])
  })
})

describe('la transmission qui dit où en est une facture', () => {
  const echecAncien = transmission({ id: 't1', etat: 'echec', cree_le: '2026-10-01T08:00:00+00:00' })
  const deposee = transmission({ id: 't2', etat: 'depose', flux_id: 'F-1', cree_le: '2026-10-02T08:00:00+00:00' })
  const rejetRecent = transmission({ id: 't3', etat: 'rejete', flux_id: 'F-2', cree_le: '2026-10-03T08:00:00+00:00' })
  const autreFacture = transmission({ id: 't4', facture_id: 'f2', etat: 'accepte', flux_id: 'F-3', cree_le: '2026-10-04T08:00:00+00:00' })

  it('ses transmissions seules, de la plus récente à la plus ancienne', () => {
    expect(transmissionsDe([echecAncien, autreFacture, deposee, rejetRecent], 'f1').map((t) => t.id)).toEqual(['t3', 't2', 't1'])
  })

  it('l’active d’abord, même plus ancienne qu’un rejet ; sinon la plus récente ; nulle sans transmission', () => {
    expect(transmissionCourante([echecAncien, deposee, rejetRecent, autreFacture], 'f1')?.id).toBe('t2')
    expect(transmissionCourante([echecAncien, rejetRecent], 'f1')?.id).toBe('t3')
    expect(transmissionCourante([autreFacture], 'f1')).toBeNull()
  })

  it('deux transmissions du même instant se lisent toujours dans le même ordre', () => {
    const a = transmission({ id: 'a', etat: 'echec' })
    const b = transmission({ id: 'b', etat: 'echec' })
    expect(transmissionsDe([b, a], 'f1').map((t) => t.id)).toEqual(['a', 'b'])
    expect(transmissionsDe([a, b], 'f1').map((t) => t.id)).toEqual(['a', 'b'])
  })
})

describe('l’abandon d’une transmission sans issue connue', () => {
  const MIGRATION_ABANDON = readFileSync(new URL('../../supabase/schema/20261008064026_abandon_d_une_transmission.sql', import.meta.url), 'utf8')
  const depart = Date.parse('2026-10-08T08:00:00+00:00')

  it('le délai est celui que la base exige', () => {
    expect(MIGRATION_ABANDON).toContain(`cree_le > now() - interval '${DELAI_AVANT_ABANDON_MS / 60_000} minutes'`)
  })

  it('un envoi s’abandonne passé le délai, pas avant ; rien d’autre ne s’abandonne', () => {
    const envoi = transmission({ etat: 'envoi', cree_le: '2026-10-08T08:00:00+00:00' })
    expect(abandonnable(envoi, depart + DELAI_AVANT_ABANDON_MS)).toBe(false)
    expect(abandonnable(envoi, depart + DELAI_AVANT_ABANDON_MS + 1)).toBe(true)
    for (const etat of ['depose', 'accepte', 'rejete', 'echec'] as const) {
      expect(abandonnable(transmission({ etat }), depart + 3_600_000), etat).toBe(false)
    }
    expect(abandonnable(transmission({ etat: 'envoi', cree_le: 'illisible' }), depart + 3_600_000)).toBe(false)
  })
})

describe('l’avoir interne d’une facture rejetée ou refusée', () => {
  const MIGRATION_AVOIR = readFileSync(new URL('../../supabase/schema/20261008065832_avoir_interne_d_une_facture_rejetee.sql', import.meta.url), 'utf8')

  it('les statuts de Super PDP qui l’annulent sont ceux que la base lit', () => {
    const lus = /e\.status_code in \(([^)]*)\)/.exec(MIGRATION_AVOIR)
    expect(lus).not.toBeNull()
    expect([...(lus as RegExpExecArray)[1].matchAll(/'([^']+)'/g)].map((m) => m[1])).toEqual([...STATUTS_ANNULATION_SUPERPDP])
  })

  it('une transmission rejetée dit qu’elle ne repart pas, et pourquoi', () => {
    expect(ETATS_TRANSMISSION.rejete.explication).toMatch(/Elle ne repart pas : elle s’annule par un avoir interne, qui ne se transmet pas/)
    expect(ETATS_TRANSMISSION.rejete.explication).toContain('§ 3.6.4')
  })
})
