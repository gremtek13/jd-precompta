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
  // INAL1 (ligne 44) : les fichiers qu'une ligne figée retient tant que le dossier existe — `remove` les tait, sans
  // erreur, comme la policy écarte une ligne. La ligne du dossier partie, le stockage les rend au super-administrateur
  // (« tout ») et ne rend plus rien d'un dossier supprimé à un chef qui ne l'est pas (« rien »).
  figes: new Set<string>(),
  apresLaLigne: 'tout' as 'tout' | 'rien',
  dossierParti: false,
  secondLeve: false,
}
const journal: { action: string; cible: string }[] = []
// Les lectures du stockage, seau et chemin : un seau qu'on ne doit pas lire ne se lit pas.
const listes: string[] = []

// LE DÉPART D'UN CLIENT (ligne 44, INAL5) : ce que la lecture rend avant la suppression — `null` le drapeau baissé (l'état
// réel), une lecture du départ, ou une lecture qui lève.
const depart = {
  lecture: null as null | Record<string, unknown>,
  leve: false,
}
vi.mock('./departDuClientLecture', () => ({
  lireLeDepartAvantLaSuppression: async () => {
    if (depart.leve) throw new Error('Les paquets d’archive et la conservation du dossier n’ont pas pu être lus : rien n’a été supprimé (panne fictive).')
    return depart.lecture
  },
}))

vi.mock('./logoDesFactures', () => ({
  get LOGO_DES_FACTURES_EXPORTE() {
    return etat.logo
  },
}))

vi.mock('./supabase', () => ({
  supabase: {
    from: (table: string) => ({
      // LE DOSSIER DU CABINET (ligne 47, LM1, en production depuis le 12/11/2026) : sa désignation se lit avant tout retrait
      // (`estDesigneCommeDossierDuCabinet`), et aucun cabinet ne désigne les dossiers de ce fichier — ce chemin-là se joue dans
      // dossierDuCabinetLecture.test.ts, sous les deux états du drapeau.
      select: (colonnes: string) => ({
        eq: (colonne: string) => ({
          maybeSingle: () => {
            if (table !== 'cabinets' || colonnes !== 'id' || colonne !== 'dossier_du_cabinet') throw new Error(`Lecture non attendue : ${table}`)
            return Promise.resolve({ data: null, error: null })
          },
        }),
      }),
      delete: () => ({
        eq: (_col: string, id: string) => {
          journal.push({ action: 'delete:dossiers', cible: id })
          if (!etat.deleteError) etat.dossierParti = true
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
          if (etat.dossierParti && etat.secondLeve) throw new Error('réseau coupé au second passage')
          if (etat.removeError) return Promise.resolve({ data: null, error: etat.removeError })
          if (etat.dossierParti && etat.apresLaLigne === 'rien') return Promise.resolve({ data: [], error: null })
          const permis = etat.dossierParti ? chemins : chemins.filter((c) => !etat.figes.has(c))
          const retires = etat.removePartiel ? permis.slice(0, 1) : permis
          return Promise.resolve({ data: retires.map((name) => ({ name })), error: null })
        },
      }),
    },
  },
}))

const { supprimerDossierDefinitivement, nettoyageAMontrer, messageNettoyage, PROFONDEUR_MAX } =
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
  etat.figes = new Set()
  etat.apresLaLigne = 'tout'
  etat.dossierParti = false
  etat.secondLeve = false
  journal.length = 0
  listes.length = 0
})

describe('nettoyage du stockage à la suppression d’un dossier', () => {
  it('retire tout et ne dit rien quand tout s’est bien passé', async () => {
    etat.entrees[`pieces/${D}`] = fichiers(3)
    const bilan = await supprimerDossierDefinitivement(D, { superAdministrateur: false })
    expect(bilan).toEqual({ demandes: 3, retires: 3, echecs: [], inventaireIncomplet: false })
    expect(nettoyageAMontrer(bilan)).toBe(false)
    expect(messageNettoyage(bilan)).toBe('')
    expect(journal.filter((j) => j.action === 'delete:dossiers')).toHaveLength(1)
  })

  it('DIT qu’il ne sait pas quand la liste est refusée', async () => {
    // Le défaut d'origine : `data: null` sur refus, traité comme « dossier vide ». Zéro fichier
    // retiré, et l'écran annonçait une suppression propre.
    etat.entrees[`pieces/${D}`] = null
    const bilan = await supprimerDossierDefinitivement(D, { superAdministrateur: false })
    expect(bilan.inventaireIncomplet).toBe(true)
    expect(nettoyageAMontrer(bilan)).toBe(true)
    expect(messageNettoyage(bilan)).toContain("on ne sait pas combien de fichiers y restent")
  })

  it('nomme ce que le stockage a refusé de retirer, avec la raison', async () => {
    etat.entrees[`pieces/${D}`] = fichiers(2)
    etat.removeError = new Error('objet verrouillé')
    const bilan = await supprimerDossierDefinitivement(D, { superAdministrateur: false })
    expect(bilan.demandes).toBe(2)
    expect(bilan.retires).toBe(0)
    expect(bilan.echecs.map((e) => e.chemin)).toEqual([`${D}/piece-0.pdf`, `${D}/piece-1.pdf`])
    expect(bilan.echecs[0].raison).toBe('objet verrouillé')
    expect(messageNettoyage(bilan)).toContain('objet verrouillé')
  })

  it('voit un retrait accepté mais incomplet, qui ne porte aucune erreur', async () => {
    etat.entrees[`pieces/${D}`] = fichiers(3)
    etat.removePartiel = true
    const bilan = await supprimerDossierDefinitivement(D, { superAdministrateur: false })
    // Le second passage (INAL1) reprend les deux restés et en retire un de plus : il en reste un.
    expect(bilan.retires).toBe(2)
    expect(bilan.echecs).toEqual([])
    // Aucune erreur nulle part, et pourtant un fichier est resté : c'est le compte qui le dit.
    expect(nettoyageAMontrer(bilan)).toBe(true)
    expect(messageNettoyage(bilan)).toContain("1 fichier n'a pas pu être retiré")
  })

  it('pagine au-delà du plafond de 100 de list()', async () => {
    // Le plafond ne se signale pas : sans pagination explicite, tout ce qui dépasse restait en place
    // indéfiniment. 250 fichiers = 3 pages de lecture et 3 lots de retrait.
    etat.entrees[`pieces/${D}`] = fichiers(250)
    const bilan = await supprimerDossierDefinitivement(D, { superAdministrateur: false })
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
    const bilan = await supprimerDossierDefinitivement(D, { superAdministrateur: false })
    expect(bilan.demandes).toBe(2)
    expect(journal.find((j) => j.action === 'remove:packs')?.cible).toBe(
      `${D}/2025-01-a-2025-12-1700000000/pack.zip,${D}/2025-01-a-2025-12-1700000000/recap.xlsx`,
    )
  })

  it('ne se tait pas non plus quand le nettoyage lève', async () => {
    etat.listeLeve = true
    const bilan = await supprimerDossierDefinitivement(D, { superAdministrateur: false })
    expect(bilan.inventaireIncomplet).toBe(true)
    expect(bilan.echecs[0].raison).toBe('réseau coupé')
  })

  it('supprime le dossier MALGRÉ un nettoyage raté — non bloquant reste non bloquant', async () => {
    etat.entrees[`pieces/${D}`] = fichiers(2)
    etat.removeError = new Error('objet verrouillé')
    await supprimerDossierDefinitivement(D, { superAdministrateur: false })
    expect(journal.filter((j) => j.action === 'delete:dossiers')).toHaveLength(1)
  })

  it('LÈVE quand la ligne dossiers, elle, ne part pas', async () => {
    // Là c'est un vrai échec à réessayer, pas un reste à signaler : RLS refuse la suppression à qui
    // n'est pas chef du cabinet, et l'écran doit le dire comme une erreur.
    etat.deleteError = new Error('new row violates row-level security policy')
    await expect(supprimerDossierDefinitivement(D, { superAdministrateur: false })).rejects.toThrow('row-level security')
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
    const bilan = await supprimerDossierDefinitivement(D, { superAdministrateur: false })
    expect(bilan).toEqual({ demandes: 3, retires: 3, echecs: [], inventaireIncomplet: false })
    expect(journal.find((j) => j.action === 'remove:ventes')?.cible).toBe(`${D}/logos/${'1'.repeat(64)}.png,${D}/logos/${'2'.repeat(64)}.jpg`)
    expect(journal.map((j) => j.action).indexOf('delete:dossiers')).toBe(journal.length - 1)
    expect(listes).toEqual(expect.arrayContaining([`pieces/${D}`, `packs/${D}`, `ventes/${D}`, `ventes/${D}/logos`]))
  })

  it('sa migration en base : une lecture refusée du seau des ventes se DIT, et le dossier part quand même', async () => {
    etat.logo = true
    etat.entrees[`ventes/${D}`] = null
    const bilan = await supprimerDossierDefinitivement(D, { superAdministrateur: false })
    expect(bilan.inventaireIncomplet).toBe(true)
    expect(messageNettoyage(bilan)).toContain('on ne sait pas combien de fichiers y restent')
    expect(journal.filter((j) => j.action === 'delete:dossiers')).toHaveLength(1)
  })

  it('sans sa migration : le seau des ventes n’est ni lu ni vidé — un seau absent ne fait pas dire un inventaire incomplet', async () => {
    etat.logo = false
    logos()
    const bilan = await supprimerDossierDefinitivement(D, { superAdministrateur: false })
    expect(bilan).toEqual({ demandes: 0, retires: 0, echecs: [], inventaireIncomplet: false })
    expect(listes.filter((l) => l.startsWith('ventes/'))).toEqual([])
    expect(journal.map((j) => j.action)).toEqual(['delete:dossiers'])
  })

  it('l’état réel du drapeau est celui que ces cas jouent par défaut', () => {
    expect(etat.logo).toBe(LOGO_REEL)
  })
})

// INAL1 (ligne 44, la migration `piece_figee_dans_le_stockage`) : le stockage garde le fichier d'une pièce figée tant que
// sa ligne existe. Le premier passage le laisse, sans erreur ; la ligne du dossier partie, un second passage le reprend.
// L'original d'une facture reprise (A8d2a, migration `originaux_des_imports`) se range DEUX niveaux sous le dossier :
// `<dossier>/imports/<lot>/<empreinte>.<pdf|xml|csv>`. Jusqu'au 11/11/2026, la descente s'arrêtait au premier : le lot
// passait pour un fichier, et l'original — qui peut nommer un patient — restait dans le seau, le dossier parti (A8d2c).
// Le module ne lit pas `ORIGINAUX_DES_IMPORTS_PREVUS` : la descente vaut dans les deux états du drapeau.
describe('les originaux des factures reprises, sous imports/<lot>/ (A8d2c)', () => {
  const LOT = '5b0f3c1e-8a2d-4c6b-9e7f-1a2b3c4d5e6f'
  const original = (c: string, ext: string) => `${c.repeat(64)}.${ext}`

  it('partent avec le dossier, jusqu’au fichier du lot, avec le logo, AVANT la ligne du dossier', async () => {
    etat.logo = true
    etat.entrees[`ventes/${D}`] = [{ name: 'imports', id: null }, { name: 'logos', id: null }]
    etat.entrees[`ventes/${D}/imports`] = [{ name: LOT, id: null }]
    etat.entrees[`ventes/${D}/imports/${LOT}`] = [{ name: original('a', 'pdf'), id: 'o1' }, { name: original('b', 'xml'), id: 'o2' }]
    etat.entrees[`ventes/${D}/logos`] = [{ name: original('1', 'png'), id: 'l1' }]
    const bilan = await supprimerDossierDefinitivement(D, { superAdministrateur: false })
    expect(bilan).toEqual({ demandes: 3, retires: 3, echecs: [], inventaireIncomplet: false })
    const retrait = journal.findIndex((j) => j.action === 'remove:ventes')
    expect(journal[retrait].cible).toBe(
      `${D}/imports/${LOT}/${original('a', 'pdf')},${D}/imports/${LOT}/${original('b', 'xml')},${D}/logos/${original('1', 'png')}`,
    )
    expect(retrait).toBeLessThan(journal.findIndex((j) => j.action === 'delete:dossiers'))
    expect(listes).toEqual(expect.arrayContaining([`ventes/${D}/imports`, `ventes/${D}/imports/${LOT}`]))
  })

  it('un lot dont la lecture est refusée se DIT : l’inventaire est incomplet, le reste part', async () => {
    etat.logo = true
    etat.entrees[`ventes/${D}`] = [{ name: 'imports', id: null }]
    etat.entrees[`ventes/${D}/imports`] = [{ name: LOT, id: null }]
    etat.entrees[`ventes/${D}/imports/${LOT}`] = null
    const bilan = await supprimerDossierDefinitivement(D, { superAdministrateur: false })
    expect(bilan.inventaireIncomplet).toBe(true)
    expect(nettoyageAMontrer(bilan)).toBe(true)
  })

  it('plus bas que la borne, un sous-dossier ne se suit pas : il se dit, sans être compté pour un fichier', async () => {
    etat.logo = true
    let chemin = `ventes/${D}`
    for (let niveau = 1; niveau <= PROFONDEUR_MAX; niveau += 1) {
      etat.entrees[chemin] = [{ name: `n${niveau}`, id: null }]
      chemin = `${chemin}/n${niveau}`
    }
    etat.entrees[chemin] = [{ name: 'trop-bas.pdf', id: 'x' }]
    const bilan = await supprimerDossierDefinitivement(D, { superAdministrateur: false })
    expect(bilan).toEqual({ demandes: 0, retires: 0, echecs: [], inventaireIncomplet: true })
    expect(listes).not.toContain(chemin)
  })

  it('à la borne même, le fichier part', async () => {
    etat.logo = true
    let chemin = `ventes/${D}`
    for (let niveau = 1; niveau < PROFONDEUR_MAX; niveau += 1) {
      etat.entrees[chemin] = [{ name: `n${niveau}`, id: null }]
      chemin = `${chemin}/n${niveau}`
    }
    etat.entrees[chemin] = [{ name: 'au-plus-bas.pdf', id: 'x' }]
    const bilan = await supprimerDossierDefinitivement(D, { superAdministrateur: false })
    expect(bilan).toEqual({ demandes: 1, retires: 1, echecs: [], inventaireIncomplet: false })
  })
})

describe('le second passage, après la ligne du dossier (INAL1)', () => {
  const figes = () => {
    etat.entrees[`pieces/${D}`] = fichiers(3)
    etat.figes = new Set([`${D}/piece-0.pdf`, `${D}/piece-2.pdf`])
  }

  it('le super-administrateur : les fichiers figés partent au second passage, APRÈS la ligne, et seulement eux', async () => {
    figes()
    const bilan = await supprimerDossierDefinitivement(D, { superAdministrateur: false })
    expect(bilan).toEqual({ demandes: 3, retires: 3, echecs: [], inventaireIncomplet: false })
    expect(nettoyageAMontrer(bilan)).toBe(false)
    expect(journal).toEqual([
      { action: 'remove:pieces', cible: `${D}/piece-0.pdf,${D}/piece-1.pdf,${D}/piece-2.pdf` },
      { action: 'delete:dossiers', cible: D },
      { action: 'remove:pieces', cible: `${D}/piece-0.pdf,${D}/piece-2.pdf` },
    ])
  })

  it('un chef qui n’est pas super-administrateur : le second passage ne retire rien, et le bilan le dit', async () => {
    figes()
    etat.apresLaLigne = 'rien'
    const bilan = await supprimerDossierDefinitivement(D, { superAdministrateur: false })
    expect(bilan).toEqual({ demandes: 3, retires: 1, echecs: [], inventaireIncomplet: false })
    expect(nettoyageAMontrer(bilan)).toBe(true)
    expect(messageNettoyage(bilan)).toContain('2 fichiers')
    expect(messageNettoyage(bilan)).toContain("l'administrateur")
    expect(journal.filter((j) => j.action === 'delete:dossiers')).toHaveLength(1)
  })

  it('aucun second passage dans un seau que le premier a vidé', async () => {
    figes()
    etat.entrees[`packs/${D}`] = [{ name: 'pack.zip', id: 'z1' }]
    await supprimerDossierDefinitivement(D, { superAdministrateur: false })
    expect(journal.filter((j) => j.action === 'remove:packs')).toHaveLength(1)
    expect(journal.filter((j) => j.action === 'remove:pieces')).toHaveLength(2)
  })

  it('aucun second passage quand la ligne du dossier ne part pas : les fichiers d’un dossier qui reste restent', async () => {
    figes()
    etat.deleteError = new Error('new row violates row-level security policy')
    await expect(supprimerDossierDefinitivement(D, { superAdministrateur: false })).rejects.toThrow('row-level security')
    expect(journal.map((j) => j.action)).toEqual(['remove:pieces', 'delete:dossiers'])
  })

  it('un second passage qui lève ne fait pas lever la suppression : le bilan dit l’inventaire douteux', async () => {
    figes()
    etat.secondLeve = true
    const bilan = await supprimerDossierDefinitivement(D, { superAdministrateur: false })
    expect(bilan.inventaireIncomplet).toBe(true)
    expect(bilan.retires).toBe(1)
    expect(bilan.echecs.map((e) => e.raison)).toEqual(['réseau coupé au second passage'])
    expect(messageNettoyage(bilan)).toContain('on ne sait pas combien de fichiers y restent')
  })

  it('un chemin qui échoue aux deux passages ne compte qu’un échec, sous la raison du second', async () => {
    etat.entrees[`pieces/${D}`] = fichiers(2)
    etat.removeError = new Error('objet verrouillé')
    const bilan = await supprimerDossierDefinitivement(D, { superAdministrateur: false })
    expect(bilan.echecs).toEqual([
      { chemin: `${D}/piece-0.pdf`, raison: 'objet verrouillé' },
      { chemin: `${D}/piece-1.pdf`, raison: 'objet verrouillé' },
    ])
    expect(journal.map((j) => j.action)).toEqual(['remove:pieces', 'delete:dossiers', 'remove:pieces'])
  })
})

describe('le départ d’un client, lu avant de vider le stockage (INAL5)', () => {
  const lue = (p: Record<string, unknown> = {}) => ({
    etat: 'lue', dossierId: D, exercices: [{ annee: 2025, empreinte: 'e2025' }], paquets: [], conservation: null, accesClient: 0, ...p,
  })
  beforeEach(() => { depart.lecture = null; depart.leve = false })

  it('un paquet qui manque : le refus, avant tout retrait du stockage et toute suppression de la ligne', async () => {
    depart.lecture = lue()
    etat.entrees = { [`pieces/${D}`]: fichiers(2) }
    await expect(supprimerDossierDefinitivement(D, { superAdministrateur: false }))
      .rejects.toThrow('Le paquet d’archive n’a pas été téléchargé pour l’exercice validé 2025.')
    expect(journal).toEqual([])
    expect(listes).toEqual([])
  })

  it('une conservation qui court : le refus, même paquets téléchargés', async () => {
    depart.lecture = lue({
      paquets: [{ annee: 2025, empreinte_exercice: 'e2025', telecharge_le: '2027-01-01T00:00:00Z' }],
      conservation: { jusqu_au: '2099-12-31', dernier_exercice: 2089, posee_le: '2090-01-01T00:00:00Z' },
    })
    await expect(supprimerDossierDefinitivement(D, { superAdministrateur: false })).rejects.toThrow('Ce dossier est conservé jusqu’au 31/12/2099')
    expect(journal).toEqual([])
  })

  it('le super-administrateur passe, et le paquet téléchargé aussi', async () => {
    depart.lecture = lue()
    await supprimerDossierDefinitivement(D, { superAdministrateur: true })
    expect(journal.map((j) => j.action)).toContain('delete:dossiers')
    journal.length = 0
    depart.lecture = lue({ paquets: [{ annee: 2025, empreinte_exercice: 'e2025', telecharge_le: '2027-01-01T00:00:00Z' }] })
    await supprimerDossierDefinitivement(D, { superAdministrateur: false })
    expect(journal.map((j) => j.action)).toContain('delete:dossiers')
  })

  it('une lecture qui lève : rien n’est retiré', async () => {
    depart.leve = true
    etat.entrees = { [`pieces/${D}`]: fichiers(2) }
    await expect(supprimerDossierDefinitivement(D, { superAdministrateur: true })).rejects.toThrow('rien n’a été supprimé')
    expect(journal).toEqual([])
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

// B2 (ligne 51.5) : le seau `documents-cabinet` n'est vidé qu'une fois sa migration en base (`DOCUMENTS_ET_DEMANDES_PREVUS`) —
// avant, le lister rendrait une erreur (un seau absent) et chaque suppression dirait un inventaire incomplet ; après, ses
// fichiers partent avec le dossier, comme ceux des trois autres.
describe('les seaux qu’une suppression de dossier vide', () => {
  it('le seau des documents du cabinet, sa migration en base seulement ; celui des ventes, la sienne', async () => {
    const { seauxDuDossier } = await import('./suppressionDossier')
    expect(seauxDuDossier(false, false)).toEqual(['pieces', 'packs'])
    expect(seauxDuDossier(true, false)).toEqual(['pieces', 'packs', 'ventes'])
    expect(seauxDuDossier(true, true)).toEqual(['pieces', 'packs', 'ventes', 'documents-cabinet'])
  })
})
