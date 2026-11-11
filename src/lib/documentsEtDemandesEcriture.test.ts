import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { deposerEtPublierUnDocument } from './documentsEtDemandesEcriture'
import { FORME_CHEMIN_D_UN_DOCUMENT_DU_CABINET } from './bornesStockage'
import { REFUS } from './documentsEtDemandes'

// Déposer puis publier un document du cabinet (étape B3a) : la saisie et le fichier jugés AVANT tout envoi ; le fichier dans
// le seau privé sous `<dossier>/<document>/<empreinte>.<ext>`, jamais sous son nom ; puis la fonction de la base, avec le
// MÊME identifiant et le MÊME chemin ; un dépôt refusé ne publie rien ; une publication refusée se dit, le fichier déposé.

const faux = vi.hoisted(() => ({
  depots: [] as { seau: string; chemin: string; corps: Blob; options: Record<string, unknown> }[],
  appels: [] as { nom: string; args: Record<string, unknown> }[],
  erreurDuDepot: null as unknown,
  erreurDeLaBase: null as unknown,
}))

vi.mock('./supabase', () => ({
  supabase: {
    storage: {
      from: (seau: string) => ({
        upload: (chemin: string, corps: Blob, options: Record<string, unknown>) => {
          faux.depots.push({ seau, chemin, corps, options })
          return Promise.resolve({ data: faux.erreurDuDepot ? null : { path: chemin }, error: faux.erreurDuDepot })
        },
      }),
    },
    rpc: (nom: string, args: Record<string, unknown>) => {
      faux.appels.push({ nom, args })
      return Promise.resolve(faux.erreurDeLaBase
        ? { data: null, error: faux.erreurDeLaBase }
        : { data: { id: args.p_document_id, titre: args.p_titre }, error: null })
    },
  },
}))

afterEach(() => { faux.depots = []; faux.appels = []; faux.erreurDuDepot = null; faux.erreurDeLaBase = null })

const PDF = new TextEncoder().encode('%PDF-1.7\nun contenu fictif')
const fichier = (nom: string, octets: Uint8Array<ArrayBuffer> = PDF, type = 'application/pdf') => new File([octets], nom, { type })
const saisie = { titre: 'Liasse 2025', nature: 'liasse', exercice: 2025 }
const DOSSIER = '11111111-2222-4333-8444-555555555555'

describe('déposer puis publier un document du cabinet', () => {
  it('le fichier sous son empreinte, puis la fonction avec le même identifiant et le même chemin', async () => {
    const issue = await deposerEtPublierUnDocument(DOSSIER, saisie, fichier('liasse de Dupont.pdf'))
    expect(issue.ok).toBe(true)
    expect(faux.depots).toHaveLength(1)
    const { seau, chemin, corps, options } = faux.depots[0]
    expect(seau).toBe('documents-cabinet')
    expect(FORME_CHEMIN_D_UN_DOCUMENT_DU_CABINET.test(chemin)).toBe(true)
    expect(chemin).not.toContain('Dupont')
    const empreinte = createHash('sha256').update(PDF).digest('hex')
    expect(chemin.startsWith(`${DOSSIER}/`)).toBe(true)
    expect(chemin.endsWith(`/${empreinte}.pdf`)).toBe(true)
    expect(corps.type).toBe('application/pdf')
    expect(options).toEqual({ upsert: false, contentType: 'application/pdf' })
    expect(faux.appels).toEqual([{ nom: 'publier_document_du_cabinet', args: {
      p_dossier_id: DOSSIER, p_document_id: chemin.split('/')[1], p_titre: 'Liasse 2025', p_nature: 'liasse', p_exercice: 2025,
      p_nom_fichier: 'liasse de Dupont.pdf', p_chemin: chemin,
    } }])
  })

  it('une saisie ou un fichier refusés ne partent pas : rien n’est déposé, rien n’est appelé', async () => {
    expect(await deposerEtPublierUnDocument(DOSSIER, { ...saisie, titre: '  ' }, fichier('a.pdf'))).toEqual({ ok: false, message: REFUS.titre })
    expect(await deposerEtPublierUnDocument(DOSSIER, { ...saisie, exercice: 1999 }, fichier('a.pdf'))).toEqual({ ok: false, message: REFUS.exercice })
    const svg = await deposerEtPublierUnDocument(DOSSIER, saisie, fichier('a.pdf', new TextEncoder().encode('<svg/>')))
    expect(svg.ok === false && svg.message).toContain('un document mis à disposition se dépose en PDF, JPEG ou PNG')
    expect(faux.depots).toHaveLength(0)
    expect(faux.appels).toHaveLength(0)
  })

  it('un dépôt refusé ne publie rien ; une publication refusée se dit, le fichier déposé', async () => {
    faux.erreurDuDepot = { message: 'Payload too large' }
    const depot = await deposerEtPublierUnDocument(DOSSIER, saisie, fichier('a.pdf'))
    expect(depot).toEqual({ ok: false, message: 'Le fichier n’est pas déposé : Payload too large.' })
    expect(faux.appels).toHaveLength(0)
    faux.erreurDuDepot = null
    faux.erreurDeLaBase = { message: REFUS.fichierInadmis, code: '22023' }
    const publication = await deposerEtPublierUnDocument(DOSSIER, saisie, fichier('a.pdf'))
    expect(publication).toEqual({ ok: false, message: `Le fichier est déposé, mais le document n’est pas publié : ${REFUS.fichierInadmis}` })
  })
})
