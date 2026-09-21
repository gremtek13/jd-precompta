import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
// La date réellement demandée à la BCE. Sans elle, le faux client répond la même chose quelle que
// soit la date, et le repli « aujourd'hui » de montantsPourPiece n'est vérifiable par rien.
const datesDemandees: string[] = []

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
      invoke: (_nom: string, options?: { body?: { date?: string } }) => {
        appels.fonction++
        if (options?.body?.date) datesDemandees.push(options.body.date)
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
  datesDemandees.length = 0
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
      devise: 'USD', montant_devise: 24, taux_change: 1.1698, conversion_source: 'bce',
    })
  })

  it('laisse une facture en euros exactement telle quelle', async () => {
    expect(await montantsPourPiece(
      { montant_ht: 21.08, montant_tva: 4.22, montant_ttc: 25.30, texte_ocr: 'NET A PAYER TTC 25,30 €' },
      '2025-10-01',
    )).toEqual({
      montant_ht: 21.08, montant_tva: 4.22, montant_ttc: 25.30,
      devise: 'EUR', montant_devise: null, taux_change: null, conversion_source: null,
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
      devise: 'USD', montant_devise: 24, taux_change: null, conversion_source: null,
    })
  })

  it('traite un texte absent comme une pièce en euros', async () => {
    // Une extraction ratée, ou une pièce saisie à la main : l'euro est le cas de l'écrasante
    // majorité, et supposer autre chose convertirait des montants déjà bons.
    expect(await montantsPourPiece({ montant_ttc: 120 }, '2026-03-10')).toEqual({
      montant_ht: null, montant_tva: null, montant_ttc: 120,
      devise: 'EUR', montant_devise: null, taux_change: null, conversion_source: null,
    })
  })
})

// LE REPLI « AUJOURD'HUI » N'ÉTAIT EXERCÉ PAR AUCUN TEST, et c'est là que vivait le défaut du
// 21/09/2026 : `new Date().toISOString().slice(0, 10)`, donc la date UTC. Les quatre cas ci-dessus
// passent tous une date explicite — l'angle mort que CLAUDE.md nomme sous « un paramètre par défaut
// est un angle mort des tests », ici sous la forme d'une valeur implicite plutôt que d'un défaut de
// signature.
//
// CE QU'IL EN COÛTE : une pièce en devise dont l'OCR n'a pas lu la date est convertie au taux de la
// VEILLE. À Paris, entre minuit et 2 h du matin ; à l'est de Greenwich, pendant toute la matinée.
// Le montant en euros part alors en comptabilité sans que rien ne le distingue d'une conversion
// juste — le taux enregistré est un vrai taux BCE, simplement pas celui du bon jour.
describe('la date de repli est celle du calendrier civil, jamais celle d’UTC', () => {
  const TZ_ORIGINE = process.env.TZ
  afterEach(() => { vi.useRealTimers(); process.env.TZ = TZ_ORIGINE })

  // LE TEST CHOISIT SES FUSEAUX AU LIEU DE SUBIR CELUI DU RUNNER, et c'est ce qui décide de ce
  // qu'il garde. Sous TZ=UTC — le fuseau du runner GitHub — les deux implémentations sont
  // INDISCERNABLES : un test qui se contente du fuseau ambiant est donc vert avec le défaut entier,
  // et la garantie repose alors sur quelqu'un pensant à lancer `npm run test:fuseaux`. Node relit
  // `process.env.TZ` à chaque opération de date, donc le fuseau se choisit ici même et la garantie
  // tient dans n'importe quel runner.
  const FUSEAUX = ['Europe/Paris', 'UTC', 'America/Martinique', 'Pacific/Auckland']

  // Vingt-quatre instants d'une même journée. Un seul ne suffirait pas : quel que soit l'instant
  // choisi, il existe un fuseau où la date UTC et la date locale coïncident encore (à Paris l'écart
  // ne dure que de minuit à 2 h). Balayer les vingt-quatre heures garantit qu'au moins un instant
  // les sépare dans TOUT fuseau dont le décalage n'est pas nul.
  const INSTANTS = Array.from({ length: 24 }, (_, h) => `2026-09-21T${String(h).padStart(2, '0')}:30:00Z`)

  function dateCivileLocale(): string {
    // Recalculée ici plutôt que reprise d'`aujourdHuiSql` : le test doit distinguer les deux
    // implémentations, pas répéter celle qu'il vérifie.
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }

  it('demande le taux du jour de l’utilisateur pour une pièce sans date lue', async () => {
    vi.useFakeTimers()
    for (const tz of FUSEAUX) {
      process.env.TZ = tz
      for (const instant of INSTANTS) {
        vi.setSystemTime(new Date(instant))
        datesDemandees.length = 0
        await montantsPourPiece(MONTANTS_USD, null)
        expect(datesDemandees, `${tz}, instant ${instant}`).toEqual([dateCivileLocale()])
      }
    }
  })

  it('sépare bien les deux dates hors UTC, quel que soit le fuseau du runner', () => {
    // La borne qui empêche le test précédent d'être vert pour une raison fausse : si le fuseau ne
    // changeait pas, les deux dates coïncideraient partout et le balayage ne démontrerait rien.
    // UTC est attendu à ZÉRO séparation — c'est exactement pourquoi il ne peut pas être le seul
    // fuseau exercé.
    vi.useFakeTimers()
    const separations = new Map<string, number>()
    for (const tz of FUSEAUX) {
      process.env.TZ = tz
      separations.set(tz, INSTANTS.filter((instant) => {
        vi.setSystemTime(new Date(instant))
        return dateCivileLocale() !== instant.slice(0, 10)
      }).length)
    }
    // Et la liste elle-même est gardée, sans quoi la boucle ci-dessous tournerait ZÉRO fois et
    // passerait à vide : ramener `FUSEAUX` au seul UTC restaurerait exactement l'aveuglement que ce
    // test existe pour lever. Vérifié par mutation — sans cette ligne, elle SURVIVAIT.
    const horsUtc = FUSEAUX.filter((f) => f !== 'UTC')
    expect(horsUtc.length, 'FUSEAUX doit exercer au moins un fuseau décalé').toBeGreaterThan(0)
    expect(separations.get('UTC'), 'UTC doit rester exercé, pour la borne à zéro').toBe(0)
    for (const tz of horsUtc) {
      expect(separations.get(tz), tz).toBeGreaterThan(0)
    }
  })

  it('garde la date lue sur le document quand il y en a une', async () => {
    // Garde SYMÉTRIQUE : sans lui, « demande toujours la date du jour » satisferait le premier test
    // tout en jetant la date de la pièce — une facture de juillet convertie au taux d'aujourd'hui.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-21T22:30:00Z'))
    await montantsPourPiece(MONTANTS_USD, '2025-07-09')
    expect(datesDemandees).toEqual(['2025-07-09'])
  })
})
