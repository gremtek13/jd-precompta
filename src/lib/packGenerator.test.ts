import JSZip from 'jszip'
import ExcelJS from 'exceljs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Categorie, Piece } from './types'

// Client Supabase simulé (même motif que contrepartieBanque.test.ts) : ce module est fait d'appels à
// la base et au stockage, il n'y a pas de calcul pur à en extraire. Le faux client rend les pièces et
// catégories programmées par le test, et permet de faire échouer le téléchargement d'un fichier
// précis — le cas qui rendait le pack silencieusement incomplet.
const etat = {
  pieces: { data: [] as Piece[], error: null as { message: string } | null },
  // Seconde requête du module sur `pieces` : les pièces validées sans date, que le filtre `gte`/`lte`
  // sur `date_piece` écarte (en SQL, NULL ne satisfait aucune comparaison) et qui n'entrent donc dans
  // aucun pack, quelle que soit la période demandée.
  sansDate: { data: [] as Piece[], error: null as { message: string } | null },
  categories: { data: [] as Categorie[], error: null as { message: string } | null },
  telechargementsEnEchec: new Set<string>(),
  // Plafond du serveur : nombre maximum de lignes rendues par requête, quoi qu'on demande. C'est
  // le « Max rows » de PostgREST, qui ne se signale pas (voir lib/lectureComplete.ts). Par défaut
  // aucun, donc une seule tranche suffit.
  plafond: null as number | null,
  // Total annoncé par la base, quand le test veut le faire mentir : une base qui annonce plus que
  // ce qu'elle rend est exactement ce qui produisait un pack amputé en silence.
  compteAnnonce: null as number | null,
  // A8d2c : les originaux des factures reprises, derrière `ORIGINAUX_DES_IMPORTS_PREVUS` (joué dans ses deux états).
  originaux: false,
  imports_factures: { data: [] as { id: string; fichier_chemin: string | null }[], error: null as { message: string } | null },
  factures_importees: { data: [] as { facture_id: string; import_id: string; fichier_chemin: string | null }[], error: null as { message: string } | null },
  // Le faux client APPLIQUE la période à cette table-ci : c'est elle qui décide de ce que le pack porte.
  factures_emises: { data: [] as { id: string; date_emission: string }[], error: null as { message: string } | null },
  // Les lectures faites, par table, et les téléchargements, par seau : un seau qu'on ne doit pas lire ne se lit pas.
  tables: [] as string[],
  telecharges: [] as string[],
}

vi.mock('./bornesStockage', async (importOriginal) => {
  const reel = await importOriginal<typeof import('./bornesStockage')>()
  return {
    ...reel,
    get ORIGINAUX_DES_IMPORTS_PREVUS() {
      return etat.originaux
    },
  }
})

vi.mock('./supabase', () => {
  type Table = 'pieces' | 'categories' | 'imports_factures' | 'factures_importees' | 'factures_emises'
  const requete = (table: Table) => {
    etat.tables.push(table)
    // `.is(...)` n'apparaît que dans la requête des pièces sans date : le faux client s'en sert pour
    // distinguer les deux lectures de `pieces`, faute de pouvoir inspecter les filtres accumulés.
    let source: Table | 'sansDate' = table
    const bornes: { gte?: string; lte?: string } = {}
    // Le faux client honore `range` et annonce un `count` : sans cela, la lecture par tranches
    // tournerait à vide ou boucherait — et surtout le test ne prouverait rien de ce qu'elle garde.
    let debut = 0
    let fin = Number.MAX_SAFE_INTEGER
    const chaine = {
      select: () => chaine,
      eq: () => chaine,
      gte: (_col: string, v: string) => { bornes.gte = v; return chaine },
      lte: (_col: string, v: string) => { bornes.lte = v; return chaine },
      or: () => chaine,
      order: () => chaine,
      range: (d: number, f: number) => { debut = d; fin = f; return chaine },
      is: () => { source = 'sansDate'; return chaine },
      then: (resoudre: (v: unknown) => unknown) => {
        const brut = etat[source]
        const src = source === 'factures_emises'
          ? { ...brut, data: etat.factures_emises.data.filter((f) => (!bornes.gte || f.date_emission >= bornes.gte) && (!bornes.lte || f.date_emission <= bornes.lte)) }
          : brut
        if (src.error) return Promise.resolve(resoudre({ data: null, error: src.error, count: null }))
        const demande = fin - debut + 1
        const taille = etat.plafond == null ? demande : Math.min(demande, etat.plafond)
        return Promise.resolve(resoudre({
          data: src.data.slice(debut, debut + taille),
          error: null,
          count: etat.compteAnnonce ?? src.data.length,
        }))
      },
    }
    return chaine
  }
  return {
    supabase: {
      from: (table: string) => requete(table as Table),
      storage: {
        from: (seau: string) => ({
          // Un Uint8Array plutôt qu'un Blob : sous Node, JSZip ne sait pas relire un Blob qu'on lui a
          // confié. Le code de production ne fait que transmettre ce que rend `download` à JSZip,
          // sans jamais appeler de méthode dessus — le chemin exercé est donc bien le vrai.
          download: (chemin: string) => {
            etat.telecharges.push(`${seau}/${chemin}`)
            return Promise.resolve(
              etat.telechargementsEnEchec.has(chemin)
                ? { data: null, error: { message: 'Object not found' } }
                : { data: new TextEncoder().encode(`contenu de ${chemin}`) as unknown as Blob, error: null },
            )
          },
        }),
      },
    },
  }
})

const { remplirZipDossier, originauxDeLaPeriode } = await import('./packGenerator')
const { ORIGINAUX_DES_IMPORTS_PREVUS: ORIGINAUX_REEL } = await vi.importActual<typeof import('./bornesStockage')>('./bornesStockage')

const piece = (o: Partial<Piece>): Piece => ({
  id: 'p', dossier_id: 'd1', nom_fichier: 'facture.pdf', storage_path: 'd1/facture.pdf',
  statut: 'validee', type_piece: 'achat', date_piece: '2026-03-10',
  montant_ht: 100, montant_tva: 20, montant_ttc: 120, tiers: 'EDF', categorie_id: 'c1',
  ...o,
} as Piece)

const CATEGORIES = [{ id: 'c1', libelle: 'Achats fournisseurs' } as Categorie]

// Lu depuis le blob que la fonction renvoie, et non depuis le ZIP : c'est le même classeur, et JSZip
// ne sait pas relire sous Node le Blob que le code y a rangé.
async function feuilles(excelBlob: Blob): Promise<Record<string, unknown[][]>> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(await excelBlob.arrayBuffer())
  const out: Record<string, unknown[][]> = {}
  wb.eachSheet((feuille) => {
    const lignes: unknown[][] = []
    feuille.eachRow((row) => lignes.push((row.values as unknown[]).slice(1)))
    out[feuille.name] = lignes
  })
  return out
}

const cheminsDuZip = (zip: JSZip) => Object.keys(zip.files).filter((f) => !zip.files[f].dir)

beforeEach(() => {
  etat.pieces = { data: [], error: null }
  etat.sansDate = { data: [], error: null }
  etat.categories = { data: CATEGORIES, error: null }
  etat.telechargementsEnEchec = new Set()
  etat.plafond = null
  etat.compteAnnonce = null
  etat.originaux = ORIGINAUX_REEL
  etat.imports_factures = { data: [], error: null }
  etat.factures_importees = { data: [], error: null }
  etat.factures_emises = { data: [], error: null }
  etat.tables = []
  etat.telecharges = []
})

describe('remplirZipDossier', () => {
  it('range les pièces validées par type et les récapitule', async () => {
    etat.pieces.data = [
      piece({ id: 'a', storage_path: 'd1/a.pdf', type_piece: 'achat', montant_ttc: 120 }),
      piece({ id: 'v', storage_path: 'd1/v.pdf', type_piece: 'vente', montant_ttc: 300 }),
    ]
    const zip = new JSZip()
    const resultat = await remplirZipDossier(zip, 'd1', '2026-01-01', '2026-12-31')

    expect(resultat.nbPieces).toBe(2)
    expect(resultat.totalTtc).toBe(420)
    expect(resultat.manquantes).toEqual([])
    const chemins = cheminsDuZip(zip)
    expect(chemins.some((c) => c.includes('01_Achats'))).toBe(true)
    expect(chemins.some((c) => c.includes('02_Ventes'))).toBe(true)
  })

  it('exclut les pièces à valider du ZIP et les signale à part', async () => {
    etat.pieces.data = [
      piece({ id: 'ok', storage_path: 'd1/ok.pdf' }),
      piece({ id: 'attente', storage_path: 'd1/attente.pdf', statut: 'a_valider' }),
    ]
    const zip = new JSZip()
    const resultat = await remplirZipDossier(zip, 'd1', '2026-01-01', '2026-12-31')

    expect(resultat.nbPieces).toBe(1)
    const f = await feuilles(resultat.excelBlob)
    expect(f['Pièces à valider']).toBeDefined()
    expect(cheminsDuZip(zip).filter((c) => c.includes('Pieces/')).length).toBe(1)
  })

  it('recense une pièce dont le fichier est introuvable, au lieu de la passer sous silence', async () => {
    // Le défaut corrigé : le code faisait `continue`, mais l'Excel listait quand même la pièce, le
    // total la comptait et la ligne `packs` l'enregistrait. Le comptable recevait un récapitulatif
    // annonçant N pièces pour X € avec moins de fichiers dans l'archive, sans aucun signal.
    etat.pieces.data = [
      piece({ id: 'ok', storage_path: 'd1/ok.pdf', tiers: 'EDF' }),
      piece({ id: 'perdue', storage_path: 'd1/perdue.pdf', tiers: 'ORANGE' }),
    ]
    etat.telechargementsEnEchec.add('d1/perdue.pdf')

    const zip = new JSZip()
    const resultat = await remplirZipDossier(zip, 'd1', '2026-01-01', '2026-12-31')

    expect(resultat.manquantes).toHaveLength(1)
    expect(resultat.manquantes[0]).toContain('ORANGE') // slugify conserve la casse du tiers
    // Le ZIP n'a qu'un fichier de pièce, alors que le récap en annonce deux : c'est précisément cet
    // écart qui doit être visible.
    expect(cheminsDuZip(zip).filter((c) => c.includes('Pieces/')).length).toBe(1)
    expect(resultat.nbPieces).toBe(2)

    const f = await feuilles(resultat.excelBlob)
    expect(f['Pièces manquantes']).toBeDefined()
    expect(JSON.stringify(f['Pièces manquantes'])).toContain('ORANGE')
  })

  it('ne demande jamais au stockage le fichier d’un autre dossier : la pièce est manquante (CFCS-Q1)', async () => {
    // Une pièce que le client a posée dans d1 en nommant le fichier de d2 — la base ne le refuse pas.
    etat.pieces.data = [
      piece({ id: 'ok', storage_path: 'd1/ok.pdf', tiers: 'EDF' }),
      piece({ id: 'vol', storage_path: 'd2/vol.xml', nom_fichier: 'F.xml', lisible_path: 'd1/../d2/vol-lisible.pdf', tiers: 'ORANGE' }),
    ]
    const zip = new JSZip()
    const resultat = await remplirZipDossier(zip, 'd1', '2026-01-01', '2026-12-31')
    expect(etat.telecharges).toEqual(['pieces/d1/ok.pdf'])
    expect(resultat.manquantes).toHaveLength(2)
    expect(resultat.manquantes.every((m) => !m.includes('d2'))).toBe(true)
    expect(cheminsDuZip(zip).filter((c) => c.includes('Pieces/')).length).toBe(1)
  })

  it('n’ajoute pas la feuille des manquantes quand tout est là', async () => {
    etat.pieces.data = [piece({ id: 'ok', storage_path: 'd1/ok.pdf' })]
    const resultat = await remplirZipDossier(new JSZip(), 'd1', '2026-01-01', '2026-12-31')
    expect((await feuilles(resultat.excelBlob))['Pièces manquantes']).toBeUndefined()
  })

  it('lève si les catégories ne peuvent pas être lues', async () => {
    // Sans elles, chaque ligne du récapitulatif retomberait sur « — » et le résumé par catégorie
    // n'aurait plus qu'une entrée : un classement silencieusement vidé, envoyé tel quel.
    etat.pieces.data = [piece({ id: 'ok', storage_path: 'd1/ok.pdf' })]
    etat.categories = { data: [], error: { message: 'permission denied' } }
    // Le refus NOMME ce qui manquait et garde la cause : « permission denied » seul n'aurait dit ni
    // ce qu'on lisait, ni pourquoi un pack ne peut pas sortir quand même.
    await expect(remplirZipDossier(new JSZip(), 'd1', '2026-01-01', '2026-12-31'))
      .rejects.toThrow(/Pack non généré : les catégories.*permission denied/s)
  })

  it('lève si les pièces ne peuvent pas être lues', async () => {
    etat.pieces = { data: [], error: { message: 'permission denied' } }
    await expect(remplirZipDossier(new JSZip(), 'd1', '2026-01-01', '2026-12-31'))
      .rejects.toThrow(/Pack non généré : les pièces de la période.*permission denied/s)
  })

  it('garde les deux fichiers quand deux pièces porteraient le même nom', async () => {
    // Le défaut corrigé, et il n'a rien de théorique : le nom ne tient qu'à la date, au tiers et au
    // montant, si bien qu'un fournisseur récurrent au tarif fixe dont la date n'a pas pu être lue
    // (`sans_date` pour toutes) produit N fois le même nom. JSZip écrase alors silencieusement la
    // précédente — un dossier réel perdait 14 factures sur 17, pendant que l'Excel les listait
    // toutes et que le total les comptait toutes.
    etat.pieces.data = [
      piece({ id: '1', storage_path: 'd1/1.pdf', date_piece: null, tiers: 'Transmedical', montant_ttc: 38.4 }),
      piece({ id: '2', storage_path: 'd1/2.pdf', date_piece: null, tiers: 'Transmedical', montant_ttc: 38.4 }),
      piece({ id: '3', storage_path: 'd1/3.pdf', date_piece: null, tiers: 'Transmedical', montant_ttc: 38.4 }),
    ]
    const zip = new JSZip()
    const resultat = await remplirZipDossier(zip, 'd1', '2026-01-01', '2026-12-31')

    const fichiers = cheminsDuZip(zip).filter((c) => c.includes('Pieces/'))
    expect(fichiers).toHaveLength(3)
    // Et chacun a bien son propre contenu : trois entrées distinctes, pas trois fois la dernière.
    const contenus = await Promise.all(fichiers.map((f) => zip.file(f)!.async('string')))
    expect(new Set(contenus).size).toBe(3)
    expect(resultat.nbPieces).toBe(3)
  })

  it('fait désigner à l’Excel le fichier réellement écrit dans le ZIP', async () => {
    // Sans cela le récapitulatif nommerait trois fois le même fichier : impossible pour le comptable
    // de rapprocher une ligne de son justificatif, alors même que les trois sont dans l'archive.
    etat.pieces.data = [
      piece({ id: '1', storage_path: 'd1/1.pdf', date_piece: null, tiers: 'Transmedical', montant_ttc: 38.4 }),
      piece({ id: '2', storage_path: 'd1/2.pdf', date_piece: null, tiers: 'Transmedical', montant_ttc: 38.4 }),
    ]
    const zip = new JSZip()
    const resultat = await remplirZipDossier(zip, 'd1', '2026-01-01', '2026-12-31')

    const recap = (await feuilles(resultat.excelBlob))['Récap']
    const colonneFichier = recap[0].indexOf('Fichier')
    // La dernière ligne est le TOTAL, sans fichier.
    const nommes = recap.slice(1, -1).map((l) => l[colonneFichier] as string)
    expect(new Set(nommes).size).toBe(2)

    const dansLeZip = cheminsDuZip(zip).filter((c) => c.includes('Pieces/')).map((c) => c.split('/').pop())
    expect(nommes.slice().sort()).toEqual(dansLeZip.slice().sort())
  })

  it('joint la version lisible d’une facture reçue en XML, sous le nom de son original, et la récapitule', async () => {
    etat.pieces.data = [
      piece({ id: 'x', storage_path: 'd1/x.xml', nom_fichier: 'F-1.xml', lisible_path: 'd1/x-lisible.pdf', tiers: 'Martin', montant_ttc: 120 }),
      piece({ id: 'p', storage_path: 'd1/p.pdf', tiers: 'EDF', montant_ttc: 60 }),
    ]
    const zip = new JSZip()
    const resultat = await remplirZipDossier(zip, 'd1', '2026-01-01', '2026-12-31')

    const fichiers = cheminsDuZip(zip).filter((c) => c.includes('Pieces/')).map((c) => c.split('/').pop()).sort()
    expect(fichiers).toEqual(['2026-03-10_EDF_60.00€.pdf', '2026-03-10_Martin_120.00€.xml', '2026-03-10_Martin_120.00€_lisible.pdf'])
    expect(await zip.file('Pieces/01_Achats/2026-03-10_Martin_120.00€_lisible.pdf')!.async('string')).toBe('contenu de d1/x-lisible.pdf')
    // Une pièce, pas deux : le total et le compte ne bougent pas.
    expect(resultat.nbPieces).toBe(2)
    expect(resultat.totalTtc).toBe(180)

    const recap = (await feuilles(resultat.excelBlob))['Récap']
    const colonne = recap[0].indexOf('Version lisible')
    expect(colonne).toBeGreaterThan(-1)
    expect(recap.slice(1, -1).map((l) => [l[recap[0].indexOf('Fichier')], l[colonne] ?? ''])).toEqual(
      expect.arrayContaining([
        ['2026-03-10_Martin_120.00€.xml', '2026-03-10_Martin_120.00€_lisible.pdf'],
        ['2026-03-10_EDF_60.00€.pdf', ''],
      ]),
    )
  })

  it('une version lisible introuvable se recense comme toute pièce manquante', async () => {
    etat.pieces.data = [piece({ id: 'x', storage_path: 'd1/x.xml', nom_fichier: 'F-1.xml', lisible_path: 'd1/x-lisible.pdf', tiers: 'Martin' })]
    etat.telechargementsEnEchec = new Set(['d1/x-lisible.pdf'])
    const zip = new JSZip()
    const resultat = await remplirZipDossier(zip, 'd1', '2026-01-01', '2026-12-31')
    expect(resultat.manquantes).toEqual(['2026-03-10_Martin_120.00€_lisible.pdf'])
    // L'original, lui, est bien là.
    expect(cheminsDuZip(zip).filter((c) => c.includes('Pieces/')).map((c) => c.split('/').pop())).toEqual(['2026-03-10_Martin_120.00€.xml'])
  })

  it('un pack sans version lisible garde le récapitulatif que le comptable connaît', async () => {
    etat.pieces.data = [piece({ id: 'p', storage_path: 'd1/p.pdf' })]
    const resultat = await remplirZipDossier(new JSZip(), 'd1', '2026-01-01', '2026-12-31')
    expect((await feuilles(resultat.excelBlob))['Récap'][0]).not.toContain('Version lisible')
  })

  it('totalise par catégorie dans le résumé', async () => {
    etat.pieces.data = [
      piece({ id: 'a', storage_path: 'd1/a.pdf', montant_ttc: 120 }),
      piece({ id: 'b', storage_path: 'd1/b.pdf', montant_ttc: 80 }),
    ]
    const resultat = await remplirZipDossier(new JSZip(), 'd1', '2026-01-01', '2026-12-31')
    const resume = (await feuilles(resultat.excelBlob))['Résumé par catégorie']
    expect(resume).toEqual([['Catégorie', 'Total TTC'], ['Achats fournisseurs', 200]])
  })
})

describe('pièces validées sans date', () => {
  it('les signale, alors qu’aucune période ne peut les contenir', async () => {
    // Le défaut : le filtre `gte`/`lte` sur `date_piece` écarte les NULL — en SQL, une comparaison
    // avec NULL n'est jamais vraie. Une pièce validée sans date est donc absente de *tous* les packs,
    // du ZIP comme du récapitulatif et du total, sans que rien ne le dise. Un dossier réel en
    // comptait 18 sur 22, pour 1 697,39 € : le comptable ne pouvait s'en apercevoir qu'en recomptant
    // les pièces du dossier à la main.
    etat.pieces.data = [piece({ id: 'ok', storage_path: 'd1/ok.pdf' })]
    etat.sansDate.data = [
      piece({ id: 'nd1', storage_path: 'd1/nd1.pdf', date_piece: null, tiers: 'Transmedical', nom_fichier: '879698.pdf' }),
      piece({ id: 'nd2', storage_path: 'd1/nd2.pdf', date_piece: null, tiers: 'Transmedical', nom_fichier: '878667.pdf' }),
    ]
    const resultat = await remplirZipDossier(new JSZip(), 'd1', '2026-01-01', '2026-12-31')

    expect(resultat.sansDate).toHaveLength(2)
    expect(resultat.sansDate[0]).toContain('Transmedical')
    expect(resultat.sansDate[0]).toContain('879698.pdf')
    // Elles restent hors du pack et de son total : elles n'appartiennent pas à cette période.
    expect(resultat.nbPieces).toBe(1)
    const f = await feuilles(resultat.excelBlob)
    expect(f['Pièces sans date']).toBeDefined()
    expect(JSON.stringify(f['Pièces sans date'])).toContain('879698.pdf')
  })

  it('n’ajoute pas la feuille quand toutes les pièces ont une date', async () => {
    // Une feuille vide en permanence serait ignorée comme le reste.
    etat.pieces.data = [piece({ id: 'ok', storage_path: 'd1/ok.pdf' })]
    const resultat = await remplirZipDossier(new JSZip(), 'd1', '2026-01-01', '2026-12-31')
    expect(resultat.sansDate).toEqual([])
    expect((await feuilles(resultat.excelBlob))['Pièces sans date']).toBeUndefined()
  })

  it('recolle les tranches quand le serveur plafonne le nombre de lignes rendues', async () => {
    // PostgREST plafonne sans le signaler : la réponse est une liste valide, simplement plus courte.
    // Ici le serveur ne rend que deux pièces à la fois — les trois doivent malgré tout être dans le
    // ZIP et dans le récapitulatif.
    etat.plafond = 2
    etat.pieces.data = [
      piece({ id: 'a', storage_path: 'd1/a.pdf', nom_fichier: 'a.pdf', tiers: 'A' }),
      piece({ id: 'b', storage_path: 'd1/b.pdf', nom_fichier: 'b.pdf', tiers: 'B' }),
      piece({ id: 'c', storage_path: 'd1/c.pdf', nom_fichier: 'c.pdf', tiers: 'C' }),
    ]
    const zip = new JSZip()
    const resultat = await remplirZipDossier(zip, 'd1', '2026-01-01', '2026-12-31')
    expect(resultat.nbPieces).toBe(3)
    expect(Object.keys(zip.files).filter((f) => f.endsWith('.pdf'))).toHaveLength(3)
  })

  it('REFUSE de produire un pack sur une lecture qui ne peut pas se dire complète', async () => {
    // La base annonce cinq pièces et n'en rend que deux, puis plus rien. Un pack construit là-dessus
    // serait cohérent avec lui-même — ZIP, récapitulatif et total d'accord — et faux tous les trois.
    // On ne peut même pas recenser ce qui manque, comme on le fait pour les pièces sans date : on
    // ignore ce qu'on n'a pas lu.
    etat.plafond = 2
    etat.compteAnnonce = 5
    etat.pieces.data = [
      piece({ id: 'a', storage_path: 'd1/a.pdf', nom_fichier: 'a.pdf' }),
      piece({ id: 'b', storage_path: 'd1/b.pdf', nom_fichier: 'b.pdf' }),
    ]
    await expect(remplirZipDossier(new JSZip(), 'd1', '2026-01-01', '2026-12-31'))
      .rejects.toThrow(/Pack non généré.*2 ligne\(s\) lue\(s\) sur 5/s)
  })

  it('lève si cette lecture échoue, plutôt que d’annoncer « aucune »', async () => {
    // Même piège que partout ailleurs : un tableau vide veut dire « rien à signaler », donc une
    // lecture refusée aurait rétabli exactement le silence qu'on vient de supprimer.
    etat.pieces.data = [piece({ id: 'ok', storage_path: 'd1/ok.pdf' })]
    etat.sansDate = { data: [], error: { message: 'permission denied' } }
    await expect(remplirZipDossier(new JSZip(), 'd1', '2026-01-01', '2026-12-31'))
      .rejects.toThrow(/Pack non généré : les pièces sans date.*permission denied/s)
  })
})

// A8d2c : le pack porte les originaux des factures reprises de la période, sous `Factures_reprises/<lot>/<fichier>` ;
// la sauvegarde n'en porte que les lignes. Derrière `ORIGINAUX_DES_IMPORTS_PREVUS`, joué dans ses deux états.
describe('les originaux des factures reprises (A8d2c)', () => {
  const LOT = '5b0f3c1e-8a2d-4c6b-9e7f-1a2b3c4d5e6f'
  const AUTRE_LOT = '6c1f4d2e-9b3e-4d7c-8f80-2b3c4d5e6f70'
  const lot = (id: string, c: string, ext = 'pdf') => ({ id, fichier_chemin: `d1/imports/${id}/${c.repeat(64)}.${ext}` })
  const jeu = () => {
    etat.pieces.data = [piece({ id: 'a', storage_path: 'd1/a.pdf' })]
    etat.imports_factures.data = [lot(LOT, 'a'), lot(AUTRE_LOT, 'b', 'csv')]
    etat.factures_importees.data = [
      { facture_id: 'f1', import_id: LOT, fichier_chemin: null },
      { facture_id: 'f2', import_id: AUTRE_LOT, fichier_chemin: null },
      { facture_id: 'f3', import_id: LOT, fichier_chemin: `d1/imports/${LOT}/${'c'.repeat(64)}.xml` },
    ]
    etat.factures_emises.data = [
      { id: 'f1', date_emission: '2026-02-01' }, { id: 'f2', date_emission: '2024-06-30' }, { id: 'f3', date_emission: '2026-03-01' },
    ]
  }

  it('drapeau baissé : le pack d’hier — aucune lecture des imports, rien du seau des ventes', async () => {
    etat.originaux = false
    jeu()
    const zip = new JSZip()
    const resultat = await remplirZipDossier(zip, 'd1', '2026-01-01', '2026-12-31')
    expect(cheminsDuZip(zip).sort()).toEqual(['Pieces/01_Achats/2026-03-10_EDF_120.00€.pdf', 'Recap.xlsx'])
    expect(etat.tables.filter((t) => t !== 'pieces' && t !== 'categories')).toEqual([])
    expect(etat.telecharges.filter((c) => !c.startsWith('pieces/'))).toEqual([])
    expect(Object.keys(await feuilles(resultat.excelBlob))).not.toContain('Factures reprises')
  })

  it('drapeau levé : les originaux de la période, du seau des ventes, sous Factures_reprises/<lot>/', async () => {
    etat.originaux = true
    jeu()
    const zip = new JSZip()
    const resultat = await remplirZipDossier(zip, 'd1', '2026-01-01', '2026-12-31')
    expect(cheminsDuZip(zip).filter((c) => c.startsWith('Factures_reprises/')).sort()).toEqual([
      `Factures_reprises/${LOT}/${'a'.repeat(64)}.pdf`, `Factures_reprises/${LOT}/${'c'.repeat(64)}.xml`,
    ])
    expect(etat.telecharges.filter((c) => !c.startsWith('pieces/')).sort()).toEqual([
      `ventes/d1/imports/${LOT}/${'a'.repeat(64)}.pdf`, `ventes/d1/imports/${LOT}/${'c'.repeat(64)}.xml`,
    ])
    expect(resultat.manquantes).toEqual([])
    expect((await feuilles(resultat.excelBlob))['Factures reprises']).toEqual([
      ['Fichier', 'Statut'],
      [`Factures_reprises/${LOT}/${'a'.repeat(64)}.pdf`, "Dans l'archive"],
      [`Factures_reprises/${LOT}/${'c'.repeat(64)}.xml`, "Dans l'archive"],
    ])
  })

  it('un original introuvable se dit dans le récapitulatif et à l’appelant', async () => {
    etat.originaux = true
    jeu()
    etat.telechargementsEnEchec = new Set([`d1/imports/${LOT}/${'a'.repeat(64)}.pdf`])
    const resultat = await remplirZipDossier(new JSZip(), 'd1', '2026-01-01', '2026-12-31')
    expect(resultat.manquantes).toEqual([`Factures_reprises/${LOT}/${'a'.repeat(64)}.pdf`])
    expect((await feuilles(resultat.excelBlob))['Factures reprises'][1]).toEqual([
      `Factures_reprises/${LOT}/${'a'.repeat(64)}.pdf`, "Absent de l'archive — fichier introuvable au moment de la génération",
    ])
  })

  it('un original hors du dossier n’est ni demandé, ni nommé par son chemin (CFCS-Q1)', async () => {
    etat.originaux = true
    jeu()
    etat.imports_factures.data = [{ id: LOT, fichier_chemin: `d2/imports/${LOT}/${'a'.repeat(64)}.pdf` }, lot(AUTRE_LOT, 'b', 'csv')]
    etat.factures_importees.data = [{ facture_id: 'f1', import_id: LOT, fichier_chemin: null }]
    const resultat = await remplirZipDossier(new JSZip(), 'd1', '2026-01-01', '2026-12-31')
    expect(etat.telecharges.filter((c) => c.startsWith('ventes/'))).toEqual([])
    expect(resultat.manquantes).toHaveLength(1)
    const reprises = JSON.stringify((await feuilles(resultat.excelBlob))['Factures reprises'])
    expect(reprises).not.toContain('d2')
    expect(reprises).toContain('hors du dossier')
  })

  it('une lecture des imports qui ne se dit pas complète refuse le pack', async () => {
    etat.originaux = true
    jeu()
    etat.factures_importees.error = { message: 'lecture refusée' }
    await expect(remplirZipDossier(new JSZip(), 'd1', '2026-01-01', '2026-12-31')).rejects.toThrow(/factures reprises/)
  })

  it('la période décide : un lot sans facture de la période n’est pas porté ; toute l’histoire les porte tous', () => {
    const lots = [lot(LOT, 'a'), lot(AUTRE_LOT, 'b', 'csv'), { id: 'sans-fichier', fichier_chemin: null }]
    const reprises = [
      { facture_id: 'f1', import_id: LOT, fichier_chemin: null },
      { facture_id: 'f2', import_id: AUTRE_LOT, fichier_chemin: null },
      { facture_id: 'f4', import_id: 'sans-fichier', fichier_chemin: null },
      { facture_id: 'f3', import_id: LOT, fichier_chemin: `d1/imports/${LOT}/${'a'.repeat(64)}.pdf` },
    ]
    expect(originauxDeLaPeriode(lots, reprises, new Set(['f1']))).toEqual([`d1/imports/${LOT}/${'a'.repeat(64)}.pdf`])
    expect(originauxDeLaPeriode(lots, reprises, new Set(['f2', 'f4']))).toEqual([`d1/imports/${AUTRE_LOT}/${'b'.repeat(64)}.csv`])
    expect(originauxDeLaPeriode(lots, reprises, new Set(['f1', 'f2', 'f3', 'f4']))).toEqual([
      `d1/imports/${LOT}/${'a'.repeat(64)}.pdf`, `d1/imports/${AUTRE_LOT}/${'b'.repeat(64)}.csv`,
    ])
    expect(originauxDeLaPeriode(lots, reprises, new Set())).toEqual([])
  })

  // Levé le 11/11/2026 (`originaux_des_imports` en production) : les cas jouent l'état réel par défaut ; l'état d'avant, sans
  // aucune lecture des imports, reste joué ci-dessus (`etat.originaux = false`).
  it('l’état réel du drapeau est celui que ces cas jouent par défaut : levé, la migration en production', () => {
    expect(ORIGINAUX_REEL).toBe(true)
  })
})
