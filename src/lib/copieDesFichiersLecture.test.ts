import { beforeEach, describe, expect, it, vi } from 'vitest'

// L'ORCHESTRATION DE LA COPIE DES FICHIERS (INAL6) devant un faux client : une lecture partielle d'un inventaire, et rien
// ne s'écrit, rien ne s'enregistre ; sinon UN ZIP pour tout le cabinet (CFC-Q1 (B)), écrit en flux dans sa sortie, un
// fichier que le stockage ne rend pas compté manquant, l'enregistrement qui reçoit l'identifiant écrit dans le manifeste et
// l'empreinte de celui-ci ; le plafond de la sortie refuse la copie avant de l'atteindre ; le volume dit avant le clic ;
// l'attestation par le manifeste rechargé (CFC-Q2 (B)).

const monde = vi.hoisted(() => ({
  tables: {} as Record<string, unknown[]>,
  partielle: null as string | null,
  fichiers: {} as Record<string, string>,
  telecharges: [] as string[],
  listes: [] as string[],
  erreurStockage: null as { message: string; status?: number } | null,
  rpc: [] as { nom: string; args: Record<string, unknown> }[],
  rpcErreur: null as { message: string } | null,
}))

vi.mock('./supabase', () => {
  function requete(table: string) {
    const filtres: [string, unknown][] = []
    const r = {
      select: () => r,
      eq: (col: string, val: unknown) => { filtres.push([col, val]); return r },
      order: () => r,
      range: (debut: number, fin: number) => {
        const lignes = (monde.tables[table] ?? []).filter((l) => filtres.every(([c, v]) => (l as Record<string, unknown>)[c] === v))
        const tranche = lignes.slice(debut, fin + 1)
        // Une lecture partielle : la base annonce une ligne de plus qu'elle n'en rend.
        return Promise.resolve({ data: tranche, error: null, count: lignes.length + (monde.partielle === table ? 1 : 0) })
      },
    }
    return r
  }
  return {
    supabase: {
      from: requete,
      storage: {
        from: () => ({
          download: (chemin: string) => {
            monde.telecharges.push(chemin)
            return Promise.resolve(chemin in monde.fichiers
              ? { data: new Blob([monde.fichiers[chemin]]), error: null }
              : { data: null, error: monde.erreurStockage ?? { message: 'Object not found' } })
          },
          list: (repertoire: string, o: { limit: number; offset: number }) => {
            monde.listes.push(repertoire)
            const noms = Object.keys(monde.fichiers).filter((c) => c.slice(0, c.lastIndexOf('/')) === repertoire).sort()
            return Promise.resolve({
              data: noms.slice(o.offset, o.offset + o.limit).map((c) => ({ name: c.slice(repertoire.length + 1), metadata: { size: new TextEncoder().encode(monde.fichiers[c]).length } })),
              error: null,
            })
          },
        }),
      },
      rpc: (nom: string, args: Record<string, unknown>) => {
        monde.rpc.push({ nom, args })
        return Promise.resolve({ data: 'id', error: monde.rpcErreur })
      },
    },
  }
})

import JSZip from 'jszip'
import { MOTIF_HORS_DU_DOSSIER, NOM_DU_MANIFESTE, sha256Hex } from './copieDesFichiers'
import { attesterLaCopie, copierLesFichiersDuCabinet, preparerLaCopie } from './copieDesFichiersLecture'

const CAB = 'cab-1'
const DA = 'aaaaaaaa-0000-4000-8000-00000000000a'
const DB = 'bbbbbbbb-0000-4000-8000-00000000000b'
const COPIE = '0b0b0b0b-0000-4000-8000-0000000000aa'

beforeEach(() => {
  monde.partielle = null
  monde.rpc = []
  monde.rpcErreur = null
  monde.telecharges = []
  monde.listes = []
  monde.erreurStockage = null
  monde.fichiers = { [`${DA}/1-Dupont.pdf`]: 'pièce' }
  monde.tables = {
    dossiers: [{ id: DA, nom: 'A', siret: null, cabinet_id: CAB }, { id: DB, nom: 'B', siret: null, cabinet_id: CAB }],
    pieces: [
      { id: 'p1', dossier_id: DA, date_piece: '2026-02-01', created_at: '2026-02-01T09:00:00Z', storage_path: `${DA}/1-Dupont.pdf`, storage_hash: null, lisible_path: null },
      { id: 'p2', dossier_id: DA, date_piece: '2026-02-02', created_at: '2026-02-02T09:00:00Z', storage_path: `${DA}/2-perdu.pdf`, storage_hash: null, lisible_path: null },
    ],
    documents_divers: [], imports_factures: [], factures_importees: [],
  }
})

function dependances(plafond = 1024 * 1024) {
  const morceaux: Uint8Array[] = []
  const etat = { termine: false, abandonne: false }
  const zip = () => {
    const t = new Uint8Array(morceaux.reduce((s, m) => s + m.length, 0))
    let p = 0
    for (const m of morceaux) { t.set(m, p); p += m.length }
    return t
  }
  return {
    morceaux, etat, zip,
    dep: {
      sortie: {
        plafond,
        ecrire: async (m: Uint8Array) => { morceaux.push(new Uint8Array(m)) },
        terminer: async () => { etat.termine = true },
        abandonner: async () => { etat.abandonne = true },
      },
      maintenant: () => new Date('2026-11-12T10:00:00Z'),
      identifiant: () => COPIE,
    },
  }
}

async function manifesteDe(zip: Uint8Array): Promise<string> {
  return (await (await JSZip.loadAsync(zip, { checkCRC32: true })).file(NOM_DU_MANIFESTE)!.async('string'))
}

describe('la copie des fichiers d’un cabinet', () => {
  it('une lecture partielle d’un inventaire : rien d’écrit, la sortie abandonnée, rien d’enregistré, le motif dit', async () => {
    monde.partielle = 'documents_divers'
    const { morceaux, etat, dep } = dependances()
    const issue = await copierLesFichiersDuCabinet(CAB, dep)
    expect(issue).toMatchObject({ ok: false, message: expect.stringContaining('Aucune copie, aucun ZIP : les documents n’ont pas pu être lus en entier') })
    expect(morceaux).toEqual([])
    expect(etat).toEqual({ termine: false, abandonne: true })
    expect(monde.rpc).toEqual([])
  })

  it('la liste des dossiers lue en partie : rien d’écrit non plus', async () => {
    monde.partielle = 'dossiers'
    const { morceaux, dep } = dependances()
    expect((await copierLesFichiersDuCabinet(CAB, dep)).ok).toBe(false)
    expect(morceaux).toEqual([])
  })

  it('UN ZIP pour tous les dossiers, un répertoire par dossier, LE manifeste à sa racine ; l’enregistrement reçoit son identifiant et son empreinte', async () => {
    const { etat, zip, dep } = dependances()
    const issue = await copierLesFichiersDuCabinet(CAB, dep)
    expect(etat).toEqual({ termine: true, abandonne: false })
    expect(issue).toMatchObject({ ok: true, bilan: { copieId: COPIE, dossiers: 2, fichiers: 2, manquants: 1, nonVerifies: 1, enregistrementRefuse: null } })
    const lu = await JSZip.loadAsync(zip(), { checkCRC32: true })
    expect(Object.keys(lu.files).sort()).toEqual([NOM_DU_MANIFESTE, 'SANS_SIREN-aaaaaaaa/pieces/20260201-p1.pdf'])
    const manifeste = await manifesteDe(zip())
    expect(manifeste).toContain(`Identifiant de la copie : ${COPIE}`)
    expect(manifeste).toContain('DOSSIER SANS_SIREN-bbbbbbbb/ : B')
    expect(monde.rpc).toHaveLength(1)
    expect(monde.rpc[0].nom).toBe('enregistrer_copie_des_fichiers')
    expect(monde.rpc[0].args).toEqual({
      p_copie_id: COPIE, p_cabinet_id: CAB, p_nb_dossiers: 2, p_nb_fichiers: 2, p_nb_verifies: 0, p_nb_ecarts: 0, p_nb_manquants: 1,
      p_octets: new TextEncoder().encode('pièce').length, p_empreinte_du_manifeste: await sha256Hex(new TextEncoder().encode(manifeste)),
    })
  })

  it('un refus de la base se dit, le ZIP parti', async () => {
    monde.rpcErreur = { message: 'La copie porte 2 dossier(s), le cabinet en a 3' }
    const { etat, dep } = dependances()
    const issue = await copierLesFichiersDuCabinet(CAB, dep)
    expect(etat.termine).toBe(true)
    expect(issue).toMatchObject({ ok: true, bilan: { enregistrementRefuse: expect.stringContaining('le cabinet en a 3') } })
  })

  it('au plafond de la sortie : la copie s’arrête avant, la sortie abandonnée, rien d’enregistré', async () => {
    monde.fichiers[`${DA}/2-perdu.pdf`] = 'x'.repeat(5000)
    const { etat, dep } = dependances(4000)
    const issue = await copierLesFichiersDuCabinet(CAB, dep)
    expect(issue).toMatchObject({ ok: false, message: expect.stringContaining('la copie passerait') })
    expect(etat).toEqual({ termine: false, abandonne: true })
    expect(monde.rpc).toEqual([])
  })

  // La relecture de sécurité du 12/11/2026 : le client de A insère une pièce dont le chemin désigne un fichier de B (la base
  // le laisse faire) ; la copie le téléchargeait avec les droits du chef et le rangeait dans le ZIP de A.
  it('un chemin qui désigne un autre dossier n’est pas téléchargé ni mesuré : manquant, dit sans son chemin', async () => {
    monde.fichiers[`${DB}/9-Martin Paul.pdf`] = 'le fichier de B'
    monde.tables.pieces.push({ id: 'p3', dossier_id: DA, date_piece: '2026-02-03', created_at: '2026-02-03T09:00:00Z', storage_path: `${DB}/9-Martin Paul.pdf`, storage_hash: null, lisible_path: null })
    const { zip, dep } = dependances()
    const issue = await copierLesFichiersDuCabinet(CAB, dep)
    expect(monde.telecharges).not.toContain(`${DB}/9-Martin Paul.pdf`)
    expect(issue).toMatchObject({ ok: true, bilan: { fichiers: 3, manquants: 2 } })
    const manifeste = await manifesteDe(zip())
    expect(manifeste).toContain(MOTIF_HORS_DU_DOSSIER)
    expect(manifeste).not.toMatch(/Martin/)
    const lu = await JSZip.loadAsync(zip())
    expect(Object.keys(lu.files)).toHaveLength(2)
    monde.listes = []
    await preparerLaCopie(CAB)
    expect(monde.listes).toEqual([DA])
  })

  it('le refus du stockage n’entre pas tel quel au manifeste : il peut porter le chemin, donc le nom déposé', async () => {
    monde.erreurStockage = { message: `Invalid key: ${DA}/2-perdu Dupont Jeanne.pdf`, status: 400 }
    const { zip, dep } = dependances()
    await copierLesFichiersDuCabinet(CAB, dep)
    const manifeste = await manifesteDe(zip())
    expect(manifeste).toContain('MANQUANTS (1)')
    expect(manifeste).toContain('le stockage ne l’a pas rendu (400)')
    expect(manifeste).not.toMatch(/Dupont|perdu|Invalid key/)
  })

  it('un cabinet sans dossier : aucune copie', async () => {
    monde.tables.dossiers = []
    const { morceaux, dep } = dependances()
    expect(await copierLesFichiersDuCabinet(CAB, dep)).toEqual({ ok: false, message: 'Aucune copie : le cabinet n’a aucun dossier.' })
    expect(morceaux).toEqual([])
  })
})

describe('avant le clic : le volume', () => {
  it('la taille que le stockage dit de chaque fichier de l’inventaire ; un fichier qu’il ne liste pas, de taille inconnue', async () => {
    const issue = await preparerLaCopie(CAB)
    expect(issue).toEqual({ ok: true, preparation: { dossiers: 2, fichiers: 2, octets: new TextEncoder().encode('pièce').length, tailleInconnue: 1 } })
    expect(monde.telecharges).toEqual([])
  })

  it('une lecture partielle : aucun volume', async () => {
    monde.partielle = 'pieces'
    expect((await preparerLaCopie(CAB)).ok).toBe(false)
  })
})

describe('le manifeste rechargé', () => {
  async function copieFaite() {
    const { zip, dep } = dependances()
    await copierLesFichiersDuCabinet(CAB, dep)
    const texte = await manifesteDe(zip())
    monde.rpc = []
    return { texte, copie: { id: COPIE, faite_le: '2026-11-12T10:01:00Z', nb_fichiers: 2, empreinte_du_manifeste: await sha256Hex(new TextEncoder().encode(texte)) } }
  }

  it('tel quel : la base reçoit le texte entier à attester', async () => {
    const { texte, copie } = await copieFaite()
    expect(await attesterLaCopie(CAB, copie, new Blob([texte]))).toEqual({ ok: true })
    expect(monde.rpc).toEqual([{ nom: 'attester_copie_des_fichiers', args: { p_cabinet_id: CAB, p_copie_id: COPIE, p_manifeste: texte } }])
  })

  it('retouché, ou vide : refusé ici, la base n’est pas appelée ; son refus à elle se dit', async () => {
    const { texte, copie } = await copieFaite()
    expect(await attesterLaCopie(CAB, copie, new Blob([texte.replace('\tnon vérifié', '\tvérifié')]))).toMatchObject({ ok: false, message: expect.stringContaining('retouché') })
    expect(await attesterLaCopie(CAB, copie, new Blob([]))).toMatchObject({ ok: false })
    expect(monde.rpc).toEqual([])
    monde.rpcErreur = { message: 'Cette copie est déjà attestée.' }
    expect(await attesterLaCopie(CAB, copie, new Blob([texte]))).toEqual({ ok: false, message: 'Cette copie est déjà attestée.' })
  })
})
