import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { refusEnregistrement, REFUS_ENREGISTREMENT } from './encaissementsFactures'
import {
  AUJOURD_HUI_RELEVE, GRAINE_DE_LA_BATTERIE, MONDE, SAISIES_DE_LA_BATTERIE, batterie, casDuClient, entreeDuCas,
  reponsesDuModule, reponsesDuModuleSansBanque,
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
// transmissions_des_encaissements posée : aucun écart sur 4 000 — l'empreinte figée restait celle du 08/10/2026. Puis,
// le même jour, sur la réplique de l'étape d7, la migration cycle_de_vie_des_factures_emises posée et le monde augmenté
// d'une facture que seule sa plateforme dit refusée (F14, un statut 210 lu) et de deux statuts qui ne refusent rien (207
// et 211) : aucun écart sur 4 000, et l'empreinte et le jour du relevé remplacés ensemble.
//
// LA PASSE DU CLIENT (espace client, étape P2). Rejouée le 10/10/2026 sur une réplique dont signature.sql égalait la
// production à 109 migrations : sans les deux migrations de l'étape, puis avec elles — aucun écart sur 4 000 les deux
// fois, et l'empreinte du chef identique des deux côtés ; le jour du relevé et l'empreinte remplacés ensemble. Avec elles,
// le script joue en plus les 3 693 saisies du dossier du client EN CLIENT, son accès au seul droit « Ventes » : aucun
// écart, et leur empreinte figée ci-dessous — 2 086 refusées par le refus neuf d'un mouvement désigné sans « Banque »,
// 285 acceptées. Elle dit ce que répond une base qui porte la migration ventes_du_client — la production depuis le
// 10/10/2026.
// Le refus neuf déplacé après ceux de la facture, dans le module, y faisait 546 écarts (la passe du chef, aucun).

const EMPREINTE_DE_LA_BASE = '38a63609e3cd1b1aa047253b3bf482b1'
const EMPREINTE_SANS_BANQUE = '26ff232d0b8335525ca51205c367d9e1'

describe('la batterie jouée par la base', () => {
  const cas = batterie(SAISIES_DE_LA_BATTERIE, GRAINE_DE_LA_BATTERIE, AUJOURD_HUI_RELEVE)
  const reponses = cas.map((c) => {
    const e = entreeDuCas(MONDE, c)
    return refusEnregistrement(e.contexte, e.saisie, e.mouvements, AUJOURD_HUI_RELEVE, true)
  })
  const reponsesSansBanque = casDuClient(cas).map((c) => {
    const e = entreeDuCas(MONDE, c)
    return refusEnregistrement(e.contexte, e.saisie, e.mouvements, AUJOURD_HUI_RELEVE, false)
  })

  // Deux saisies se répètent, des tirages dégénérés (sans date, sans montant…) ; un tirage qui boucle n'en rendait que
  // 1 210 distinctes, et la batterie ne jouait plus que le quart de ce qu'elle annonçait.
  it('tire 3 998 saisies distinctes sur 4 000', () => {
    expect(new Set(cas.map((c) => JSON.stringify(c))).size).toBe(3998)
  })

  it('le module rend, saisie par saisie, ce que la base a rendu', () => {
    const sorties = reponsesDuModule(cas, AUJOURD_HUI_RELEVE)
    expect(sorties).toHaveLength(SAISIES_DE_LA_BATTERIE)
    expect(createHash('md5').update(sorties.join('\n')).digest('hex')).toBe(EMPREINTE_DE_LA_BASE)
  })

  it('le client qui ne porte que « Ventes », sur son dossier : le module rend ce que la base a rendu', () => {
    const sorties = reponsesDuModuleSansBanque(cas, AUJOURD_HUI_RELEVE)
    expect(sorties).toHaveLength(3693)
    expect(createHash('md5').update(sorties.join('\n')).digest('hex')).toBe(EMPREINTE_SANS_BANQUE)
  })

  it('atteint chaque refus que le module juge, et des acceptations — le refus neuf, sur la passe du client seule', () => {
    const atteints = new Set(reponses.map((r) => r?.cle ?? 'ok'))
    const atteintsSansBanque = new Set(reponsesSansBanque.map((r) => r?.cle ?? 'ok'))
    for (const { cle } of REFUS_ENREGISTREMENT) {
      if (cle === 'acces') continue
      expect(atteints.has(cle) || atteintsSansBanque.has(cle), cle).toBe(true)
    }
    expect(atteints.has('mouvement_sans_banque')).toBe(false)
    expect(atteintsSansBanque.has('mouvement_sans_banque')).toBe(true)
    expect(atteints.has('ok')).toBe(true)
    expect(atteintsSansBanque.has('ok')).toBe(true)
  })

  // Ce que le script de rejeu suppose : tirée pour un autre jour, la batterie est la même, à ses dates près — le jour du
  // relevé, son lendemain et le 1er janvier qui suit glissent avec lui, les autres restent.
  it('se tire pour le jour où la base la juge, et ne change que de dates', () => {
    const dates = new Set(cas.map((c) => c.date))
    for (const d of ['2026-10-10', '2026-10-11', '2027-01-01']) expect(dates.has(d), d).toBe(true)
    const glissees: Record<string, string> = { '2026-10-10': '2027-03-15', '2026-10-11': '2027-03-16', '2027-01-01': '2028-01-01' }
    const autre = batterie(SAISIES_DE_LA_BATTERIE, GRAINE_DE_LA_BATTERIE, '2027-03-15')
    expect(autre).toEqual(cas.map((c) => ({ ...c, date: c.date == null ? null : (glissees[c.date] ?? c.date) })))
  })
})
