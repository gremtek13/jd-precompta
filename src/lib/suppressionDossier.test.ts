import { beforeEach, describe, expect, it, vi } from 'vitest'

// Supprimer un dossier, c'est le geste auquel se ramène une demande d'effacement — et les données de
// patients sont dans les FICHIERS, pas dans les tables (RGPD.md §4). Ce que ce fichier garde n'est
// donc pas « la fonction retire des fichiers » mais « elle DIT ce qu'elle n'a pas retiré » : rien ne
// recharge le stockage, aucun écran ne le relit jamais, donc un échec silencieux n'a strictement
// aucun témoin.
//
// Le faux client journalise ce qui part vraiment, parce que « tout a été retiré » et « rien n'a été
// tenté » rendaient tous deux `void` avant le 21/09/2026.

const etat = {
  // Par seau et par chemin, les entrées que `list()` rend. `null` = lecture REFUSÉE, ce qui est
  // indiscernable d'un dossier vide si on ne lit pas `{ error }` — le défaut d'origine.
  entrees: {} as Record<string, { name: string; id: string | null }[] | null>,
  removeError: null as Error | null,
  // `remove` accepte mais ne retire pas tout : ni erreur, ni suppression. Le cas qu'un `if (error)`
  // seul laisserait passer.
  removePartiel: false,
  listeLeve: false,
  deleteError: null as Error | null,
  // Le drapeau du logo des factures (étape A5c1), lu à chaque suppression : ses deux états se jouent ici, l'état réel
  // par défaut.
  logo: false,
}
const journal: { action: string; cible: string }[] = []
// Les lectures du stockage, seau et chemin : un seau qu'on ne doit pas lire ne se lit pas.
const listes: string[] = []

vi.mock('./logoDesFactures', () => ({
  get LOGO_DES_FACTURES_EXPORTE() {
    return etat.logo
  },
}))

vi.mock('./supabase', () => ({
  supabase: {
    from: () => ({
      delete: () => ({
        eq: (_col: string, id: string) => {
          journal.push({ action: 'delete:dossiers', cible: id })
          return Promise.resolve({ error: etat.deleteError })
        },
      }),
    }),
    storage: {
      from: (bucket: string) => ({
        list: (chemin: string, options: { limit: number; offset: number }) => {
          listes.push(`${bucket}/${chemin}`)
          if (etat.listeLeve) throw new Error('réseau coupé')
          const toutes = etat.entrees[`${bucket}/${chemin}`]
          if (toutes === undefined) return Promise.resolve({ data: [], error: null })
          if (toutes === null) {
            return Promise.resolve({ data: null, error: new Error('lecture refusée') })
          }
          return Promise.resolve({
            data: toutes.slice(options.offset, options.offset + options.limit),
            error: null,
          })
        },
        remove: (chemins: string[]) => {
          journal.push({ action: `remove:${bucket}`, cible: chemins.join(',') })
          if (etat.removeError) return Promise.resolve({ data: null, error: etat.removeError })
          const retires = etat.removePartiel ? chemins.slice(0, 1) : chemins
          return Promise.resolve({ data: retires.map((name) => ({ name })), error: null })
        },
      }),
    },
  },
}))

const { supprimerDossierDefinitivement, nettoyageAMontrer, messageNettoyage } =
  await import('./suppressionDossier')
const { LOGO_DES_FACTURES_EXPORTE: LOGO_REEL } = await vi.importActual<typeof import('./logoDesFactures')>('./logoDesFactures')

const D = 'dossier-1'
const fichiers = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ name: `piece-${i}.pdf`, id: `f${i}` }))

beforeEach(() => {
  etat.entrees = {}
  etat.removeError = null
  etat.removePartiel = false
  etat.listeLeve = false
  etat.deleteError = null
  etat.logo = LOGO_REEL
  journal.length = 0
  listes.length = 0
})

describe('nettoyage du stockage à la suppression d’un dossier', () => {
  it('retire tout et ne dit rien quand tout s’est bien passé', async () => {
    etat.entrees[`pieces/${D}`] = fichiers(3)
    const bilan = await supprimerDossierDefinitivement(D)
    expect(bilan).toEqual({ demandes: 3, retires: 3, echecs: [], inventaireIncomplet: false })
    expect(nettoyageAMontrer(bilan)).toBe(false)
    expect(messageNettoyage(bilan)).toBe('')
    expect(journal.filter((j) => j.action === 'delete:dossiers')).toHaveLength(1)
  })

  it('DIT qu’il ne sait pas quand la liste est refusée', async () => {
    // Le défaut d'origine : `data: null` sur refus, traité comme « dossier vide ». Zéro fichier
    // retiré, et l'écran annonçait une suppression propre.
    etat.entrees[`pieces/${D}`] = null
    const bilan = await supprimerDossierDefinitivement(D)
    expect(bilan.inventaireIncomplet).toBe(true)
    expect(nettoyageAMontrer(bilan)).toBe(true)
    expect(messageNettoyage(bilan)).toContain("on ne sait pas combien de fichiers y restent")
  })

  it('nomme ce que le stockage a refusé de retirer, avec la raison', async () => {
    etat.entrees[`pieces/${D}`] = fichiers(2)
    etat.removeError = new Error('objet verrouillé')
    const bilan = await supprimerDossierDefinitivement(D)
    expect(bilan.demandes).toBe(2)
    expect(bilan.retires).toBe(0)
    expect(bilan.echecs.map((e) => e.chemin)).toEqual([`${D}/piece-0.pdf`, `${D}/piece-1.pdf`])
    expect(bilan.echecs[0].raison).toBe('objet verrouillé')
    expect(messageNettoyage(bilan)).toContain('objet verrouillé')
  })

  it('voit un retrait accepté mais incomplet, qui ne porte aucune erreur', async () => {
    etat.entrees[`pieces/${D}`] = fichiers(3)
    etat.removePartiel = true
    const bilan = await supprimerDossierDefinitivement(D)
    expect(bilan.retires).toBe(1)
    expect(bilan.echecs).toEqual([])
    // Aucune erreur nulle part, et pourtant deux fichiers sont restés : c'est le compte qui le dit.
    expect(nettoyageAMontrer(bilan)).toBe(true)
    expect(messageNettoyage(bilan)).toContain('2 fichiers')
  })

  it('pagine au-delà du plafond de 100 de list()', async () => {
    // Le plafond ne se signale pas : sans pagination explicite, tout ce qui dépasse restait en place
    // indéfiniment. 250 fichiers = 3 pages de lecture et 3 lots de retrait.
    etat.entrees[`pieces/${D}`] = fichiers(250)
    const bilan = await supprimerDossierDefinitivement(D)
    expect(bilan.demandes).toBe(250)
    expect(bilan.retires).toBe(250)
    expect(journal.filter((j) => j.action === 'remove:pieces')).toHaveLength(3)
  })

  it('descend dans les sous-dossiers, où un pack range son ZIP', async () => {
    etat.entrees[`packs/${D}`] = [{ name: '2025-01-a-2025-12-1700000000', id: null }]
    etat.entrees[`packs/${D}/2025-01-a-2025-12-1700000000`] = [
      { name: 'pack.zip', id: 'z1' },
      { name: 'recap.xlsx', id: 'x1' },
    ]
    const bilan = await supprimerDossierDefinitivement(D)
    expect(bilan.demandes).toBe(2)
    expect(journal.find((j) => j.action === 'remove:packs')?.cible).toBe(
      `${D}/2025-01-a-2025-12-1700000000/pack.zip,${D}/2025-01-a-2025-12-1700000000/recap.xlsx`,
    )
  })

  it('ne se tait pas non plus quand le nettoyage lève', async () => {
    etat.listeLeve = true
    const bilan = await supprimerDossierDefinitivement(D)
    expect(bilan.inventaireIncomplet).toBe(true)
    expect(bilan.echecs[0].raison).toBe('réseau coupé')
  })

  it('supprime le dossier MALGRÉ un nettoyage raté — non bloquant reste non bloquant', async () => {
    etat.entrees[`pieces/${D}`] = fichiers(2)
    etat.removeError = new Error('objet verrouillé')
    await supprimerDossierDefinitivement(D)
    expect(journal.filter((j) => j.action === 'delete:dossiers')).toHaveLength(1)
  })

  it('LÈVE quand la ligne dossiers, elle, ne part pas', async () => {
    // Là c'est un vrai échec à réessayer, pas un reste à signaler : RLS refuse la suppression à qui
    // n'est pas chef du cabinet, et l'écran doit le dire comme une erreur.
    etat.deleteError = new Error('new row violates row-level security policy')
    await expect(supprimerDossierDefinitivement(D)).rejects.toThrow('row-level security')
  })
})

// Le seau des ventes (le logo des factures, étape A5c1) : un dossier y range ses logos sous `<dossier>/logos/`. Sa
// migration en base, la suppression du dossier le vide comme les deux autres — les données d'un client partent toutes
// avec lui ; avant elle, le seau n'existe pas, et le lire ferait dire à chaque suppression un inventaire incomplet.
describe('le seau des ventes, selon que sa migration est en base', () => {
  const logos = () => {
    etat.entrees[`ventes/${D}`] = [{ name: 'logos', id: null }]
    etat.entrees[`ventes/${D}/logos`] = [{ name: `${'1'.repeat(64)}.png`, id: 'l1' }, { name: `${'2'.repeat(64)}.jpg`, id: 'l2' }]
  }

  it('sa migration en base : ses logos partent avec le dossier, sous-dossier compris, AVANT la ligne du dossier', async () => {
    etat.logo = true
    etat.entrees[`pieces/${D}`] = fichiers(1)
    logos()
    const bilan = await supprimerDossierDefinitivement(D)
    expect(bilan).toEqual({ demandes: 3, retires: 3, echecs: [], inventaireIncomplet: false })
    expect(journal.find((j) => j.action === 'remove:ventes')?.cible).toBe(`${D}/logos/${'1'.repeat(64)}.png,${D}/logos/${'2'.repeat(64)}.jpg`)
    expect(journal.map((j) => j.action).indexOf('delete:dossiers')).toBe(journal.length - 1)
    expect(listes).toEqual(expect.arrayContaining([`pieces/${D}`, `packs/${D}`, `ventes/${D}`, `ventes/${D}/logos`]))
  })

  it('sa migration en base : une lecture refusée du seau des ventes se DIT, et le dossier part quand même', async () => {
    etat.logo = true
    etat.entrees[`ventes/${D}`] = null
    const bilan = await supprimerDossierDefinitivement(D)
    expect(bilan.inventaireIncomplet).toBe(true)
    expect(messageNettoyage(bilan)).toContain('on ne sait pas combien de fichiers y restent')
    expect(journal.filter((j) => j.action === 'delete:dossiers')).toHaveLength(1)
  })

  it('sans sa migration : le seau des ventes n’est ni lu ni vidé — un seau absent ne fait pas dire un inventaire incomplet', async () => {
    etat.logo = false
    logos()
    const bilan = await supprimerDossierDefinitivement(D)
    expect(bilan).toEqual({ demandes: 0, retires: 0, echecs: [], inventaireIncomplet: false })
    expect(listes.filter((l) => l.startsWith('ventes/'))).toEqual([])
    expect(journal.map((j) => j.action)).toEqual(['delete:dossiers'])
  })

  it('l’état réel du drapeau est celui que ces cas jouent par défaut', () => {
    expect(etat.logo).toBe(LOGO_REEL)
  })
})

describe('ce qu’on montre au cabinet', () => {
  const bilan = (o: Partial<Parameters<typeof messageNettoyage>[0]> = {}) => ({
    demandes: 0, retires: 0, echecs: [], inventaireIncomplet: false, ...o,
  })

  it('reste muet quand il n’y a rien à dire', () => {
    expect(messageNettoyage(bilan({ demandes: 5, retires: 5 }))).toBe('')
    expect(messageNettoyage(bilan())).toBe('')
  })

  it('accorde le singulier', () => {
    const texte = messageNettoyage(bilan({ demandes: 1, retires: 0 }))
    expect(texte).toContain("1 fichier n'a pas pu être retiré")
    expect(texte).not.toContain('fichiers')
  })

  it('nomme la conséquence et pas seulement le fait', () => {
    // « des fichiers sont restés » ne dit pas que l'effacement qu'on croyait fait ne l'est pas.
    const texte = messageNettoyage(bilan({ demandes: 3, retires: 1 }))
    expect(texte).toContain("ne sont plus rattachés à aucun dossier")
    expect(texte).toContain("l'administrateur")
  })

  it('ne répète pas trois fois la même raison', () => {
    const echecs = Array.from({ length: 5 }, (_, i) => ({ chemin: `c${i}`, raison: 'refusé' }))
    const texte = messageNettoyage(bilan({ demandes: 5, retires: 0, echecs }))
    expect(texte.match(/refusé/g)).toHaveLength(1)
  })
})
