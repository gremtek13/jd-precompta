import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { refusEnregistrement, REFUS_ENREGISTREMENT, type CleRefusEnregistrement } from './encaissementsFactures'
import { AUJOURD_HUI_RELEVE, MONDE, batterie, entreeDuCas } from '../test/encaissementsBatterie'

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
// migration (encaissementsFactures.test.ts) tombe, et la batterie se rejoue sur une réplique (HISTORIQUE.md, « LE MODULE
// DES ENCAISSEMENTS ») avant que l'empreinte ne se remplace.

const NOMBRE = 4000
const GRAINE = 20261008
const EMPREINTE_DE_LA_BASE = 'e061f97c366878a0d4b1c0e61118fbb8'

// Le code de chaque refus, dans la famille que la base lui donne.
const CODES: Partial<Record<CleRefusEnregistrement, string>> = { acces: '42501', facture_introuvable: 'P0002' }

describe('la batterie jouée par la base', () => {
  const cas = batterie(NOMBRE, GRAINE)
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
    const sorties = reponses.map((r) => (r ? `${CODES[r.cle] ?? '22023'} ${r.message}` : 'ok'))
    expect(sorties).toHaveLength(NOMBRE)
    expect(createHash('md5').update(sorties.join('\n')).digest('hex')).toBe(EMPREINTE_DE_LA_BASE)
  })

  it('atteint chaque refus que le module juge, et des acceptations', () => {
    const atteints = new Set(reponses.map((r) => r?.cle ?? 'ok'))
    for (const { cle } of REFUS_ENREGISTREMENT) if (cle !== 'acces') expect(atteints.has(cle), cle).toBe(true)
    expect(atteints.has('ok')).toBe(true)
  })
})
