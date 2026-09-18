import { beforeEach, describe, expect, it, vi } from 'vitest'

// Le client Supabase est simulé : ce module lit le cache des taux et appelle une Edge Function. La
// règle de CALCUL, elle, vit dans lib/devises.ts et se teste sans rien simuler — ici on vérifie
// l'aiguillage : cache d'abord, BCE ensuite, et ce qu'on écrit sur la pièce dans chaque cas.
const etat = {
  cache: [] as { date: string; taux: number }[],
  cacheErreur: null as { message: string } | null,
  reponseFonction: null as Record<string, unknown> | null,
  erreurFonction: null as { message: string } | null,
}
const appels = { cache: 0, fonction: 0 }

vi.mock('./supabase', () => ({
  supabase: {
    from: () => {
      const chaine = {
        select: () => chaine,
        eq: () => chaine,
        gte: () => chaine,
        lte: () => {
          appels.cache++
          return Promise.resolve({ data: etat.cache, error: etat.cacheErreur })
        },
      }
      return chaine
    },
    functions: {
      invoke: () => {
        appels.fonction++
        return Promise.resolve({ data: etat.reponseFonction, error: etat.erreurFonction })
      },
    },
  },
}))

const { montantsPourPiece, tauxBce } = await import('./tauxChange')

// Facture OpenAI de juillet 2025, telle qu'elle arrive : montants en dollars, texte lu du document.
const TEXTE_USD = 'Invoice OpenAI, LLC $24.00 USD due July 9, 2025 Total excluding tax $20.00 $4.00 Total $24.00'
const MONTANTS_USD = { montant_ht: 20, montant_tva: 4, montant_ttc: 24, texte_ocr: TEXTE_USD }

beforeEach(() => {
  etat.cache = []
  etat.cacheErreur = null
  etat.reponseFonction = { taux: 1.1698, date_du_taux: '2025-07-09' }
  etat.erreurFonction = null
  appels.cache = 0
  appels.fonction = 0
})

describe('tauxBce', () => {
  it('sert le cache sans appeler la BCE', async () => {
    // Un taux déjà publié ne change jamais : le redemander à chaque pièce d'un lot de factures du
    // même mois serait autant d'appels réseau pour la même réponse.
    etat.cache = [{ date: '2025-07-09', taux: 1.1698 }]
    expect(await tauxBce('USD', '2025-07-09')).toEqual({ taux: 1.1698, date: '2025-07-09' })
    expect(appels.fonction).toBe(0)
  })

  it('appelle la BCE quand le cache ne couvre pas la date', async () => {
    expect(await tauxBce('USD', '2025-07-09')).toEqual({ taux: 1.1698, date: '2025-07-09' })
    expect(appels.fonction).toBe(1)
  })

  it('ne cherche aucun taux pour l’euro', async () => {
    expect(await tauxBce('EUR', '2025-07-09')).toBeNull()
    expect(appels.cache + appels.fonction).toBe(0)
  })

  it('lève quand le cache est illisible, au lieu de le prendre pour vide', async () => {
    // Un cache vide déclenche un appel à la BCE ; un cache illisible est une panne. Confondre les
    // deux ferait interroger la BCE à chaque pièce, en silence.
    etat.cacheErreur = { message: 'permission denied' }
    await expect(tauxBce('USD', '2025-07-09')).rejects.toThrow('Taux de change illisibles')
  })

  it('rend null quand la BCE ne répond pas, sans lever', async () => {
    // L'appelant doit pouvoir enregistrer la pièce sans conversion : une pièce non convertie se
    // corrige, une pièce refusée est perdue.
    etat.erreurFonction = { message: 'timeout' }
    etat.reponseFonction = null
    expect(await tauxBce('USD', '2025-07-09')).toBeNull()
  })
})

describe('montantsPourPiece', () => {
  it('convertit une facture en dollars et garde de quoi la justifier', async () => {
    expect(await montantsPourPiece(MONTANTS_USD, '2025-07-09')).toEqual({
      montant_ht: 17.10, montant_tva: 3.42, montant_ttc: 20.52,
      devise: 'USD', montant_devise: 24, taux_change: 1.1698,
    })
  })

  it('laisse une facture en euros exactement telle quelle', async () => {
    expect(await montantsPourPiece(
      { montant_ht: 21.08, montant_tva: 4.22, montant_ttc: 25.30, texte_ocr: 'NET A PAYER TTC 25,30 €' },
      '2025-10-01',
    )).toEqual({
      montant_ht: 21.08, montant_tva: 4.22, montant_ttc: 25.30,
      devise: 'EUR', montant_devise: null, taux_change: null,
    })
    expect(appels.cache + appels.fonction).toBe(0)
  })

  it('n’écrit AUCUN montant en euros quand le taux est introuvable', async () => {
    // Le point qui compte : écrire 24,00 sans taux ferait passer 24 dollars pour 24 euros, et
    // personne ne verrait l'écart de 15 %. Nuls, les montants rendent la pièce visiblement
    // incomplète — invalidable, et signalée par piecesDeviseNonConvertie.
    etat.erreurFonction = { message: 'BCE injoignable' }
    etat.reponseFonction = null
    expect(await montantsPourPiece(MONTANTS_USD, '2025-07-09')).toEqual({
      montant_ht: null, montant_tva: null, montant_ttc: null,
      devise: 'USD', montant_devise: 24, taux_change: null,
    })
  })

  it('traite un texte absent comme une pièce en euros', async () => {
    // Une extraction ratée, ou une pièce saisie à la main : l'euro est le cas de l'écrasante
    // majorité, et supposer autre chose convertirait des montants déjà bons.
    expect(await montantsPourPiece({ montant_ttc: 120 }, '2026-03-10')).toEqual({
      montant_ht: null, montant_tva: null, montant_ttc: 120,
      devise: 'EUR', montant_devise: null, taux_change: null,
    })
  })
})
