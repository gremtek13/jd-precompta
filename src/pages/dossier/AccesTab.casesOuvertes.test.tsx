import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import AccesTab from './AccesTab'
import { CE_QUE_DISENT_LES_CASES, ceQueDisentLesCases } from '../../lib/droitsAcces'

// L'ONGLET ACCÈS, LES DEUX ÉTAPES DE L'ESPACE CLIENT EN BASE (P7, la banque, et P2, les ventes : drapeaux levés). La
// phrase sous « Accès actuels » dit ce que la base ouvre à la SESSION du client, écran ou non (lib/droitsAcces.ts,
// `ceQueDisentLesCases`). Drapeaux baissés, AccesTab.test.tsx garde la phrase de l'état réel ; ici, que l'onglet suit les
// DEUX drapeaux — le contrôle croisé de P2 et P7 (10/10/2026) avait trouvé une phrase qui n'en lisait qu'un, et qui
// aurait dit « cocher une case ne change pas ce que le client voit ou fait » le jour où ses ventes lui sont ouvertes.
vi.mock('../../lib/couvertureReleve', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../lib/couvertureReleve')>(),
  COUVERTURE_EXPORTEE: true,
}))
vi.mock('../../lib/encaissementsFactures', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../lib/encaissementsFactures')>(),
  VENTES_DU_CLIENT_EXPORTEES: true,
}))

type LigneAcces = {
  id: string; user_id: string; email: string | null; dossier_id: string; created_at: string
  droit_ventes: boolean; droit_banque: boolean
}

const faux = vi.hoisted(() => ({ lignes: [] as LigneAcces[] }))

// La lecture des accès, seule faite au montage : le faux client APPLIQUE ses filtres d'égalité et sa tranche.
vi.mock('../../lib/supabase', async () => {
  const { filtrer, predicatEq } = await import('../../test/filtresPostgrest')
  return {
    supabase: {
      from: () => {
        const predicats: ReturnType<typeof predicatEq>[] = []
        let debut = 0
        let fin = Number.MAX_SAFE_INTEGER
        const chaine: Record<string, unknown> = {}
        Object.assign(chaine, {
          select: () => chaine,
          eq: (colonne: string, valeur: unknown) => { predicats.push(predicatEq(colonne, valeur)); return chaine },
          order: () => chaine,
          range: (d: number, f: number) => { debut = d; fin = f; return chaine },
          then: (suite: (r: { data: unknown[]; error: null; count: number }) => unknown) => {
            const lignes = filtrer(faux.lignes, predicats)
            return Promise.resolve({ data: lignes.slice(debut, fin + 1).map((l) => ({ ...l })), error: null, count: lignes.length })
              .then(suite)
          },
        })
        return chaine
      },
    },
  }
})

// La modale de relance fait ses propres appels et n'a rien à voir avec ce qu'on garde ici.
vi.mock('../../components/EnvoyerEmailModal', () => ({ default: () => null }))

const acces = (o: Partial<LigneAcces> & { id: string; dossier_id: string }): LigneAcces => ({
  user_id: `u-${o.id}`, email: null, created_at: '2026-10-01T08:00:00Z', droit_ventes: false, droit_banque: false, ...o,
})

describe('AccesTab — la phrase des cases, les deux étapes en base', () => {
  it('dit ce que « Ventes » et « Banque » ouvrent par la base, notes et motifs compris, et plus qu’une case ne change rien', async () => {
    faux.lignes = [
      acces({ id: 'm1', dossier_id: 'd1', email: 'client@exemple.fr', droit_ventes: true }),
      acces({ id: 'm2', dossier_id: 'd2', email: 'autre@exemple.fr' }),
    ]
    render(<AccesTab dossierId="d1" dossierNom="Cabinet Martin" codeEmail="abc123" />)
    // La lecture revenue : l'accès du dossier, et lui seul.
    await screen.findByText('client@exemple.fr')
    expect(screen.queryByText('autre@exemple.fr')).toBeNull()
    expect(CE_QUE_DISENT_LES_CASES).toBe(ceQueDisentLesCases(true, true))
    const phrase = screen.getByText(ceQueDisentLesCases(true, true))
    expect(phrase.textContent).toContain('« Ventes » permet déjà au client, par la base et sans écran encore, de lire ses ventes')
    expect(phrase.textContent).toContain('avec ce que le cabinet y a écrit (notes et motifs)')
    expect(phrase.textContent).toContain('et, avec « Ventes », de désigner celui qui prouve un encaissement.')
    expect(screen.queryByText(/cocher une case ne change pas|Cocher « Ventes » ne change pas/)).toBeNull()
  })
})
