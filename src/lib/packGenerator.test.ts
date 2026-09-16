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
  categories: { data: [] as Categorie[], error: null as { message: string } | null },
  telechargementsEnEchec: new Set<string>(),
}

vi.mock('./supabase', () => {
  const requete = (table: 'pieces' | 'categories') => {
    const chaine = {
      select: () => chaine,
      eq: () => chaine,
      gte: () => chaine,
      lte: () => chaine,
      or: () => chaine,
      then: (resoudre: (v: unknown) => unknown) => Promise.resolve(resoudre(etat[table])),
    }
    return chaine
  }
  return {
    supabase: {
      from: (table: string) => requete(table as 'pieces' | 'categories'),
      storage: {
        from: () => ({
          // Un Uint8Array plutôt qu'un Blob : sous Node, JSZip ne sait pas relire un Blob qu'on lui a
          // confié. Le code de production ne fait que transmettre ce que rend `download` à JSZip,
          // sans jamais appeler de méthode dessus — le chemin exercé est donc bien le vrai.
          download: (chemin: string) =>
            Promise.resolve(
              etat.telechargementsEnEchec.has(chemin)
                ? { data: null, error: { message: 'Object not found' } }
                : { data: new TextEncoder().encode(`contenu de ${chemin}`) as unknown as Blob, error: null },
            ),
        }),
      },
    },
  }
})

const { remplirZipDossier } = await import('./packGenerator')

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
  etat.categories = { data: CATEGORIES, error: null }
  etat.telechargementsEnEchec = new Set()
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
    await expect(remplirZipDossier(new JSZip(), 'd1', '2026-01-01', '2026-12-31')).rejects.toMatchObject({
      message: 'permission denied',
    })
  })

  it('lève si les pièces ne peuvent pas être lues', async () => {
    etat.pieces = { data: [], error: { message: 'permission denied' } }
    await expect(remplirZipDossier(new JSZip(), 'd1', '2026-01-01', '2026-12-31')).rejects.toMatchObject({
      message: 'permission denied',
    })
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
