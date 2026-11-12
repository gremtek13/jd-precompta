import { describe, expect, it } from 'vitest'
import {
  phrasesDuBilan, refusDitAuClient, releverMaPlateforme, type AppelsDeLaReleve, type FluxAchat, type ListeDesAchats,
  type ReponseReception,
} from './receptionParLeClient'
import type { DrapeauxPlateforme, ReponsePlateforme } from './receptionPlateforme'

// « Relever ma plateforme » (étape B4r) : la relève page à page, facture par facture, sur des appels donnés.

const SANS: DrapeauxPlateforme = { definitif: false, raison: null, perimee: false, acces_refuse: false, identifiants_refuses: false }
const ok = <T,>(donnees: T): ReponsePlateforme<T> => ({ donnees, erreur: null, drapeaux: SANS })
const ko = <T,>(erreur: string, drapeaux: Partial<DrapeauxPlateforme> = {}): ReponsePlateforme<T> =>
  ({ donnees: null, erreur, drapeaux: { ...SANS, ...drapeaux } })

const flux = (valeurs: Partial<FluxAchat>): FluxAchat => ({
  id: 'f', sens: 'achat', syntaxe: 'CII', direction: 'In', nom: 'facture.xml', recu_le: null,
  mis_a_jour: '2026-11-01T10:00:00.000Z', etat: 'pret', deja_recue: false, ...valeurs,
})
const page = (valeurs: Partial<ListeDesAchats>): ListeDesAchats => ({
  hote: 'pa.exemple.fr', version: 'v1', depuis: null, flux: [], complete: true, motif: null, jusqua: null,
  ecartes: { illisible: 0, format: 0, statut_inconnu: 0, doublons: 0 }, ...valeurs,
})
const recue = (flowId: string, issue: ReponseReception['issue'], plus: Partial<ReponseReception> = {}) =>
  ok<ReponseReception>({ hote: 'pa.exemple.fr', flowId, issue, ...plus })

function appels(pages: ReponsePlateforme<ListeDesAchats>[], reponses: Record<string, ReponsePlateforme<ReponseReception>>) {
  const listes: (string | null)[] = []
  const recus: string[] = []
  const a: AppelsDeLaReleve = {
    lister: async (depuis) => { listes.push(depuis); return pages[listes.length - 1] ?? ko('plus de page') },
    recevoir: async (version, flowId) => { recus.push(`${version} ${flowId}`); return reponses[flowId] ?? ko('inattendue') },
  }
  return { a, listes, recus }
}

describe('releverMaPlateforme', () => {
  it('ne demande au serveur que les factures prêtes et pas encore là, et compte chaque issue', async () => {
    const { a, recus } = appels([ok(page({
      flux: [
        flux({ id: 'deja', deja_recue: true }), flux({ id: 'attente', etat: 'en_attente' }), flux({ id: 'rejet', etat: 'en_erreur' }),
        flux({ id: 'r1' }), flux({ id: 'r2' }), flux({ id: 'dbl' }), flux({ id: 'autre' }), flux({ id: 'cab' }), flux({ id: 'tard' }),
        flux({ id: 'panne' }),
      ],
      ecartes: { illisible: 1, format: 1, statut_inconnu: 0, doublons: 3 },
    }))], {
      r1: recue('r1', 'recue', { piece_id: 'p1' }), r2: recue('r2', 'recue', { sans_lisible: true }), dbl: recue('dbl', 'doublon'),
      autre: recue('autre', 'autre_entreprise'), cab: recue('cab', 'au_cabinet', { raison: 'factur_x' }),
      tard: ko('pas fini', { raison: 'en_attente' }), panne: ko('La plateforme ne répond pas.'),
    })
    const b = await releverMaPlateforme(a)
    expect(recus).toEqual(['v1 r1', 'v1 r2', 'v1 dbl', 'v1 autre', 'v1 cab', 'v1 tard', 'v1 panne'])
    expect(b).toMatchObject({
      recues: 2, sansLisible: 1, dejaLa: 1, doublons: 1, autreEntreprise: 1, auCabinet: 1, enAttente: 2, rejetees: 1,
      ecartees: 2, complete: true, interruption: null,
    })
    expect(b.echecs).toEqual(['« facture.xml » : La plateforme ne répond pas.'])
  })

  it('continue au cours de la même relève depuis le point que la page rend possible, et s’arrête quand il n’avance plus', async () => {
    const { a, listes } = appels([
      ok(page({ complete: false, jusqua: '2026-11-01T10:00:00.000Z', motif: 'plus de 100' })),
      ok(page({ complete: false, jusqua: '2026-11-01T10:00:00.000Z', motif: 'la plateforme n’avance plus' })),
    ], {})
    const b = await releverMaPlateforme(a)
    expect(listes).toEqual([null, '2026-11-01T10:00:00.000Z'])
    expect(b.complete).toBe(false)
    expect(b.motif).toBe('la plateforme n’avance plus')
    expect(phrasesDuBilan(b)).toContain('La relève n’est pas allée au bout : la plateforme n’avance plus.')
  })

  it('s’arrête sur la connexion changée ou l’identité refusée, et le dit', async () => {
    const perimee = await releverMaPlateforme(appels([ok(page({ flux: [flux({ id: 'a' }), flux({ id: 'b' })] }))], {
      a: ko('La connexion a changé.', { perimee: true }), b: recue('b', 'recue'),
    }).a)
    expect(perimee.recues).toBe(0)
    expect(perimee.interruption).toMatch(/a changé pendant la relève/)
    const acces = await releverMaPlateforme(appels([ok(page({ flux: [flux({ id: 'a' })] }))], {
      a: ko('La plateforme refuse l’identité.', { acces_refuse: true }),
    }).a)
    expect(acces.interruption).toMatch(/refuse l’identité/)
  })

  it('une réponse qui ne correspond pas à la facture demandée ne se compte pas reçue', async () => {
    const { a } = appels([ok(page({ flux: [flux({ id: 'a' })] }))], {
      a: ok<ReponseReception>({ hote: 'autre.exemple.fr', flowId: 'a', issue: 'recue' }),
    })
    const b = await releverMaPlateforme(a)
    expect(b.recues).toBe(0)
    expect(b.echecs).toEqual(['« facture.xml » : la réponse ne correspond pas à la facture demandée.'])
  })

  it('une liste refusée arrête tout, dite aux mots du client', async () => {
    const b = await releverMaPlateforme(appels([ko('…', { raison: 'superpdp' })], {}).a)
    expect(b.interruption).toMatch(/par Super PDP/)
    expect(phrasesDuBilan(b)).toEqual([])
  })
})

describe('les mots de la relève', () => {
  it('nomment chaque refus du serveur sans ses mots de cabinet', () => {
    expect(refusDitAuClient('Aucune plateforme…', 'sans_plateforme')).toMatch(/pas de plateforme reliée/)
    expect(refusDitAuClient('…', 'sans_siret')).toMatch(/SIRET de ta société/)
    expect(refusDitAuClient('Dossier introuvable.', null)).toMatch(/case « Achats »/)
    expect(refusDitAuClient('La plateforme ne répond pas.', null)).toBe('Ta plateforme n’a pas pu être relevée : La plateforme ne répond pas.')
  })

  it('s’accordent au nombre, et disent qu’il n’y avait rien', () => {
    const vide = { recues: 0, sansLisible: 0, dejaLa: 0, doublons: 0, auCabinet: 0, autreEntreprise: 0, enAttente: 0, rejetees: 0, ecartees: 0, echecs: [], interruption: null, complete: true, motif: null }
    expect(phrasesDuBilan(vide)).toEqual(['Ta plateforme n’a aucune facture d’achat à recevoir.'])
    expect(phrasesDuBilan({ ...vide, recues: 1 })[0]).toBe('1 facture reçue : elle arrive chez ton cabinet, à valider.')
    expect(phrasesDuBilan({ ...vide, recues: 2, sansLisible: 2 })[0])
      .toBe('2 factures reçues : elles arrivent chez ton cabinet, à valider. 2 n’ont pas de version lisible : ton cabinet lira l’original.')
    expect(phrasesDuBilan({ ...vide, autreEntreprise: 1 })[0]).toMatch(/^1 facture ne désigne pas ta société comme acheteur : elle n’est pas reçue/)
  })
})
