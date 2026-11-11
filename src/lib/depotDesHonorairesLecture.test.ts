import { beforeEach, describe, expect, it, vi } from 'vitest'
import { factureFigee } from '../test/mentionsFigees'

// LE GESTE ET LES LECTURES DU DÉPÔT DES HONORAIRES (ligne 47, LM8), devant un faux client : le PDF part sous le dossier du
// client puis la fonction de la base seule écrit ; un refus de la base retire le fichier déposé ; des lignes lues en partie,
// ou une facture qui n'a pas figé ses mentions, ne déposent rien ; une fonction qui rend moins de lignes que son compte est
// une lecture illisible. Données FICTIVES.

const faux = vi.hoisted(() => ({
  envois: [] as { chemin: string; type: string | undefined }[],
  envoiRefuse: null as { message: string } | null,
  rpcs: [] as { nom: string; args: Record<string, unknown> }[],
  reponses: {} as Record<string, { data: unknown; error: { message: string } | null; count?: number | null }>,
  lignes: { data: [] as unknown[], error: null as { message: string } | null },
  retraits: [] as string[][],
}))

vi.mock('./stockage', () => ({ retirerFichiers: async (_s: string, chemins: string[]) => { faux.retraits.push(chemins) } }))
vi.mock('./supabase', () => ({
  supabase: {
    from: () => {
      const chaine: Record<string, unknown> = {}
      Object.assign(chaine, {
        select: () => chaine, eq: () => chaine, neq: () => chaine, order: () => chaine, range: () => chaine,
        then: (suite: (r: unknown) => unknown) => Promise.resolve({ ...faux.lignes, count: faux.lignes.error ? null : faux.lignes.data.length }).then(suite),
      })
      return chaine
    },
    storage: {
      from: () => ({
        upload: async (chemin: string, _corps: Blob, o: { contentType?: string }) => {
          faux.envois.push({ chemin, type: o.contentType })
          return { data: faux.envoiRefuse ? null : { path: chemin }, error: faux.envoiRefuse }
        },
      }),
    },
    rpc: (nom: string, args: Record<string, unknown>) => {
      faux.rpcs.push({ nom, args })
      const r = faux.reponses[nom] ?? { data: null, error: { message: 'inattendu' } }
      return Promise.resolve({ data: r.data, error: r.error, count: r.count ?? null })
    },
  },
}))

const { deposerChezLeClient, lireLeDepotDesHonoraires, lireLesHonorairesDeposes } = await import('./depotDesHonorairesLecture')

const K = 'k0000000-0000-4000-8000-00000000000a'
const C = 'c0000000-0000-4000-8000-00000000000c'
const ligne = { id: 'l1', facture_id: 'f1', ordre: 1, designation: 'Honoraires fictifs', quantite: 1, prix_unitaire_ht: 100, taux_tva: 20 }

beforeEach(() => {
  faux.envois = []; faux.envoiRefuse = null; faux.rpcs = []; faux.retraits = []
  faux.lignes = { data: [ligne], error: null }
  faux.reponses = { deposer_honoraires_chez_le_client: { data: 'piece-1', error: null } }
})

describe('le clic « Déposer chez le client »', () => {
  it('dépose le PDF sous le dossier du client, puis appelle la fonction avec son chemin et son empreinte', async () => {
    const issue = await deposerChezLeClient({ dossierId: K, facture: factureFigee({ dossier_id: K }), numeroDeLOrigine: null, dossierClientId: C })
    expect(issue).toEqual({ ok: true, pieceId: 'piece-1' })
    expect(faux.envois).toHaveLength(1)
    expect(faux.envois[0].chemin).toMatch(new RegExp(`^${C}/\\d+-honoraires-facture-f2027-0001\\.pdf$`))
    expect(faux.envois[0].type).toBe('application/pdf')
    const [appel] = faux.rpcs
    expect(appel.nom).toBe('deposer_honoraires_chez_le_client')
    expect(appel.args).toMatchObject({ p_dossier_id: K, p_facture_id: 'f1', p_chemin: faux.envois[0].chemin })
    expect(appel.args.p_empreinte).toMatch(/^[0-9a-f]{64}$/)
    expect(faux.retraits).toEqual([])
  })

  it('un refus de la base se dit à ses mots et retire le fichier déposé', async () => {
    faux.reponses.deposer_honoraires_chez_le_client = { data: null, error: { message: 'Cette facture est déjà déposée chez le client.' } }
    const issue = await deposerChezLeClient({ dossierId: K, facture: factureFigee(), numeroDeLOrigine: null, dossierClientId: C })
    expect(issue).toEqual({ ok: false, message: 'Cette facture est déjà déposée chez le client.' })
    expect(faux.retraits).toEqual([[faux.envois[0].chemin]])
  })

  it('un envoi refusé ne va pas jusqu’à la base', async () => {
    faux.envoiRefuse = { message: 'stockage refusé' }
    const issue = await deposerChezLeClient({ dossierId: K, facture: factureFigee(), numeroDeLOrigine: null, dossierClientId: C })
    expect(issue.ok).toBe(false)
    expect(faux.rpcs).toEqual([])
    expect(faux.retraits).toEqual([])
  })

  it('des lignes illisibles, ou une facture qui n’a pas figé ses mentions, ne déposent rien', async () => {
    faux.lignes = { data: [], error: { message: 'refus' } }
    expect((await deposerChezLeClient({ dossierId: K, facture: factureFigee(), numeroDeLOrigine: null, dossierClientId: C })).ok).toBe(false)
    faux.lignes = { data: [ligne], error: null }
    const issue = await deposerChezLeClient({ dossierId: K, facture: factureFigee({ mentions_figees: false }), numeroDeLOrigine: null, dossierClientId: C })
    expect(issue).toEqual({ ok: false, message: 'Cette facture ne se tire pas de ses seules valeurs figées : rien n’a été déposé.' })
    expect(faux.envois).toEqual([])
    expect(faux.rpcs).toEqual([])
  })
})

describe('les lectures', () => {
  it('le cabinet : une fonction qui rend moins de lignes que son compte est illisible ; lue en entier, lue', async () => {
    faux.reponses.depots_des_honoraires = { data: [], error: null, count: 2 }
    expect(await lireLeDepotDesHonoraires(K, 'cab')).toEqual({ etat: 'illisible', dossierId: K, motif: '0 ligne(s) lue(s) sur 2' })
    faux.reponses.depots_des_honoraires = { data: [], error: null, count: 0 }
    expect(await lireLeDepotDesHonoraires(K, 'cab')).toMatchObject({ etat: 'lue', depots: [] })
    faux.reponses.depots_des_honoraires = { data: null, error: { message: 'Accès refusé à ce dossier.' } }
    expect(await lireLeDepotDesHonoraires(K, 'cab')).toMatchObject({ etat: 'illisible', motif: 'Accès refusé à ce dossier.' })
  })

  it('le client : la nature de chaque pièce déposée, ou illisible sans compte', async () => {
    faux.reponses.honoraires_deposes_au_dossier = { data: [{ piece_id: 'p1', nature: 'facture', depose_le: '2027-11-03T09:00:00Z' }], error: null, count: 1 }
    const lu = await lireLesHonorairesDeposes(C)
    expect(lu.etat === 'lue' && lu.natures.get('p1')).toBe('facture')
    faux.reponses.honoraires_deposes_au_dossier = { data: [], error: null, count: null }
    expect(await lireLesHonorairesDeposes(C)).toMatchObject({ etat: 'illisible', motif: 'la base n’a pas rendu de compte' })
  })
})
