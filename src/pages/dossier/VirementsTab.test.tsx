import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import VirementsTab from './VirementsTab'
import type { LigneBancaire } from '../../lib/types'

// LE « TOTAL PRÉLEVÉ » SOMMAIT DES VALEURS ABSOLUES.
//
// Le bouton « Virement personnel » de l'onglet Banque n'est borné par AUCUN signe — et c'est le seul
// qui nomme la situation d'un mouvement venu du compte personnel de l'exploitant. Un apport marqué
// ainsi faisait donc MONTER le total, sous un libellé qui dit l'inverse : 1 000 € sortis et 300 €
// entrés affichaient « Total prélevé 1 300,00 € » au lieu de 700.
//
// LATENT, et mesuré : les 3 lignes marquées en base sont toutes des sorties, donc le total est juste
// aujourd'hui. Ce qui le rend digne d'être corrigé est qu'il ne PEUT pas se voir une fois arrivé —
// un total faux a exactement l'air d'un total, et la ligne fautive est noyée dans une liste.
const faux = vi.hoisted(() => ({ lignes: [] as LigneBancaire[] }))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => {
      const c: Record<string, unknown> = {}
      let debut = 0
      let fin = Number.MAX_SAFE_INTEGER
      Object.assign(c, {
        select: () => c,
        eq: () => c,
        order: () => c,
        update: () => c,
        // `count` est ANNONCÉ : un faux client qui l'omet fait déclarer INCOMPLÈTE toute lecture de
        // `lireTout`, et l'écran rend alors son bandeau à la place de la liste — le test serait vert
        // pour une raison qui n'est pas la sienne. C'est le coût récurrent de `lireTout`, et il se
        // paie une fois par faux client.
        range: (d: number, f: number) => { debut = d; fin = f; return c },
        then: (suite: (r: { data: LigneBancaire[]; error: null; count: number }) => unknown) =>
          Promise.resolve({
            data: faux.lignes.slice(debut, Math.min(debut + (fin - debut + 1), faux.lignes.length)),
            error: null,
            count: faux.lignes.length,
          }).then(suite),
      })
      return c
    },
  },
}))

// Typé `Partial<LigneBancaire> => LigneBancaire` SANS `as` : le compilateur vérifie alors chaque
// champ contre la table, exhaustivement. C'est ce qui a sorti `created_at` du jeu d'essai de
// BanqueTab, absent depuis toujours.
const ligne = (o: Partial<LigneBancaire> = {}): LigneBancaire => ({
  id: 'l-1', dossier_id: 'dossier-de-test', date: '2025-06-02', montant: -1000,
  libelle: 'VIREMENT COMPTE PERSO', libelle_brut: null, statut: 'ignoree',
  piece_id: null, cotisation_id: null, prelevement_personnel: true, source_fichier: null,
  created_at: '2025-06-02T09:00:00Z', ...o,
})

const monter = () => render(<VirementsTab dossierId="dossier-de-test" />)
// `\s` : `formatMoney` sépare les milliers par une espace fine insécable (U+202F).
const MONTANT = (texte: string) => new RegExp(`^${texte.replace(/ /g, '\\s')}$`)

describe('VirementsTab — le total prélevé', () => {
  it('additionne les sorties, en valeur absolue', async () => {
    faux.lignes = [ligne({ id: 'a', montant: -1000 }), ligne({ id: 'b', montant: -500 })]
    monter()

    await screen.findByText(MONTANT('1 500,00 €'))
  })

  it('n’ajoute PAS un mouvement entrant au total, et le NOMME', async () => {
    faux.lignes = [ligne({ id: 'a', montant: -1000 }), ligne({ id: 'b', montant: 300 })]
    monter()

    // Le défaut : 1 300,00 € — la somme des valeurs absolues, sous un libellé « Total prélevé ».
    await screen.findByText(MONTANT('1 000,00 €'))
    expect(screen.queryAllByText(MONTANT('1 300,00 €'))).toHaveLength(0)
    // Et l'apport n'est pas simplement écarté en silence : il est dit, avec son montant.
    const mention = screen.getByText(/mouvement\(s\) ENTRANT\(s\)/)
    expect(mention.textContent).toMatch(/300,00/)
  })

  it('se tait quand tous les mouvements sont des sorties', async () => {
    // Garde SYMÉTRIQUE : sans lui, « l'écran nomme les entrées » serait satisfait par un écran qui
    // affiche TOUJOURS cette mise en garde — et une mise en garde permanente cesse d'être lue, puis
    // emporte ses voisines dans son discrédit.
    faux.lignes = [ligne({ id: 'a', montant: -1000 })]
    monter()

    // Ancré sur la ligne elle-même : sans ancre, un écran encore en chargement rendrait le test vert
    // pour une raison fausse.
    await screen.findByText('VIREMENT COMPTE PERSO')
    expect(screen.queryAllByText(/mouvement\(s\) ENTRANT\(s\)/)).toHaveLength(0)
  })
})
