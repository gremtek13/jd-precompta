import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { refusEnregistrement, REFUS_ENREGISTREMENT } from './encaissementsFactures'
import {
  AUJOURD_HUI_RELEVE, GRAINE_DE_LA_BATTERIE, MONDE, SAISIES_DE_LA_BATTERIE, batterie, entreeDuCas, reponsesDuModule,
} from '../test/encaissementsBatterie'

// LE MODULE ET LA BASE, SUR LES MÊMES SAISIES (ligne 28.5, étape d2). La batterie de src/test/encaissementsBatterie.ts —
// un monde fictif et 4 000 saisies tirées au hasard, dont quelques centaines visent la frontière du seuil des frais — a
// été jouée le 08/10/2026 par `enregistrer_encaissement` ELLE-MÊME, sur une réplique locale du schéma (PostgreSQL 16,
// dont les neuf familles d'objets avaient, ce jour-là, l'empreinte de la production), chaque saisie en chef du cabinet
// puis annulée. Chaque réponse de la base — `ok`, ou son code et son message — a été recopiée dans l'ordre, et leur
// empreinte figée ici : le module doit rendre EXACTEMENT les mêmes, et il les rendait toutes, sans un écart. La base a
// rendu chacun des vingt-trois refus que le module juge, et des acceptations ; le test le vérifie aussi, pour que la
// batterie ne devienne pas muette sur un refus qu'un changement de tirage aurait cessé d'atteindre.
//
// Si le module change ce qu'il dit, ce test tombe ; si la fonction de la base change, la confrontation au texte de la
// migration (encaissementsFactures.test.ts) tombe. Dans les deux cas la batterie se REJOUE sur une réplique, par
// supabase/essais/batterieEncaissements.mjs (étape d4) : le script lit le jour de la base, tire la batterie pour ce jour,
// la fait juger et la confronte au module ; sans écart, AUJOURD_HUI_RELEVE et l'empreinte ci-dessous se remplacent
// ENSEMBLE par ce qu'il rend. Rejouée le 09/10/2026 sur la réplique de l'étape d4, la migration
// transmissions_des_encaissements posée : aucun écart sur 4 000 — l'empreinte figée reste celle du 08/10/2026.

const EMPREINTE_DE_LA_BASE = 'e061f97c366878a0d4b1c0e61118fbb8'

describe('la batterie jouée par la base', () => {
  const cas = batterie(SAISIES_DE_LA_BATTERIE, GRAINE_DE_LA_BATTERIE, AUJOURD_HUI_RELEVE)
  const reponses = cas.map((c) => {
    const e = entreeDuCas(MONDE, c)
    return refusEnregistrement(e.contexte, e.saisie, e.mouvements, AUJOURD_HUI_RELEVE)
  })

  // Quatre saisies se répètent, des tirages dégénérés (sans date, sans montant…) ; un tirage qui boucle n'en rendait que
  // 1 210 distinctes, et la batterie ne jouait plus que le quart de ce qu'elle annonçait.
  it('tire 3 996 saisies distinctes sur 4 000', () => {
    expect(new Set(cas.map((c) => JSON.stringify(c))).size).toBe(3996)
  })

  it('le module rend, saisie par saisie, ce que la base a rendu', () => {
    const sorties = reponsesDuModule(cas, AUJOURD_HUI_RELEVE)
    expect(sorties).toHaveLength(SAISIES_DE_LA_BATTERIE)
    expect(createHash('md5').update(sorties.join('\n')).digest('hex')).toBe(EMPREINTE_DE_LA_BASE)
  })

  it('atteint chaque refus que le module juge, et des acceptations', () => {
    const atteints = new Set(reponses.map((r) => r?.cle ?? 'ok'))
    for (const { cle } of REFUS_ENREGISTREMENT) if (cle !== 'acces') expect(atteints.has(cle), cle).toBe(true)
    expect(atteints.has('ok')).toBe(true)
  })

  // Ce que le script de rejeu suppose : tirée pour un autre jour, la batterie est la même, à ses dates près — le jour du
  // relevé, son lendemain et le 1er janvier qui suit glissent avec lui, les autres restent.
  it('se tire pour le jour où la base la juge, et ne change que de dates', () => {
    const dates = new Set(cas.map((c) => c.date))
    for (const d of ['2026-10-08', '2026-10-09', '2027-01-01']) expect(dates.has(d), d).toBe(true)
    const glissees: Record<string, string> = { '2026-10-08': '2027-03-15', '2026-10-09': '2027-03-16', '2027-01-01': '2028-01-01' }
    const autre = batterie(SAISIES_DE_LA_BATTERIE, GRAINE_DE_LA_BATTERIE, '2027-03-15')
    expect(autre).toEqual(cas.map((c) => ({ ...c, date: c.date == null ? null : (glissees[c.date] ?? c.date) })))
  })
})
