import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import EreportingModal from './EreportingModal'
import { AUJOURDHUI, E1, F1, F2, OCTOBRE, P1, R1, R2, V1, dossier, fiche, lu, piece, regime, sources, taux, declaree } from '../../test/ereportingEcran'
import { contenuADeclarer } from '../../lib/declarationsEreporting'
import { declarationCalculee } from '../../lib/ereportingEcran'
import type { DossierEreporting } from '../../lib/ereporting'
import type { DeclarationEreportingHorsApplication, SourceDeclarationEreporting } from '../../lib/types'

// LA FENÊTRE DE L'E-REPORTING (ligne 28.5, étape e5c). Ce que ces cas gardent, et qu'aucun test des modules ne voit parce
// que tout vit dans le câblage : rien n'est affirmé ni offert tant qu'une lecture manque, table par table ; les refus des
// fonctions de la base sont dits AVANT le clic, sous leurs mots, et le bouton grisé tant qu'un refus tient ; un seul appel
// pour deux et trois clics du même rendu, et le verrou tenu jusqu'après la relecture ; une erreur de la base dite, la
// relecture faite aussi sur un refus, le verrou relâché ; les confirmations NOMMENT ce qu'on écrit ; la liste relue et les
// états recalculés après chaque geste. Le faux client APPLIQUE les filtres et ne rend que les colonnes demandées
// (src/test/filtresPostgrest.ts). Données FICTIVES (src/test/ereportingEcran.ts) ; « aujourd'hui » est le 5 novembre 2027.
const faux = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  muetApres: {} as Record<string, number>,
  refus: {} as Record<string, string>,
  rpcs: [] as { nom: string; args: Record<string, unknown> }[],
  erreurRpc: null as string | null,
  retenirRpc: false,
  libererRpc: null as null | (() => void),
  retenirLectures: false,
  libererLectures: null as null | (() => void),
  lectures: 0,
  // Les lectures ne reviennent pas tant qu'on ne les libère pas : la fenêtre pendant sa première lecture.
  porte: null as Promise<void> | null,
  libererPorte: null as null | (() => void),
  // Une lecture qui LÈVE (le réseau tombe) au lieu de rendre une erreur.
  leve: false,
  // Les lectures qui suivent un appel attendent cette barrière : la relecture que le verrou doit couvrir.
  barriere: null as Promise<void> | null,
}))

// Seul le téléchargement est remplacé (jsdom n'a pas d'URL.createObjectURL) : c'est le CONTENU qui est en cause.
const telecharge = vi.hoisted(() => ({ fichiers: [] as { nom: string; contenu: string }[] }))
vi.mock('../../lib/fec', async (vrai) => ({
  ...(await vrai<typeof import('../../lib/fec')>()),
  telechargerTexte: (nom: string, contenu: string) => { telecharge.fichiers.push({ nom, contenu }) },
}))

vi.mock('../../lib/supabase', async () => {
  const { filtrer, predicatEq, predicatIn } = await import('../../test/filtresPostgrest')
  type Ligne = Record<string, unknown>
  const nouvelId = (n: number) => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`
  // Les extraits de contenu : les sources qu'une déclaration porte, comme la fonction de la base les écrit.
  const sourcesDuContenu = (objet: string, contenu: Ligne): { genre: string; source_id: string }[] => {
    if (objet === 'achats') return (contenu.achats as { ficheId: string }[]).map((a) => ({ genre: 'fiche', source_id: a.ficheId }))
    if (objet === 'ventes') return (contenu.transactions as { factures: string[] }[]).flatMap((t) => t.factures.map((id) => ({ genre: 'facture', source_id: id })))
    return (contenu.paiements as { encaissements: string[] }[]).flatMap((p) => p.encaissements.map((id) => ({ genre: 'encaissement', source_id: id })))
  }
  const executer = (nom: string, args: Ligne) => {
    if (faux.erreurRpc) return { data: null, error: { message: faux.erreurRpc } }
    if (nom === 'confirmer_regime_ereporting') {
      faux.tables.regimes_ereporting.push({
        id: nouvelId(faux.rpcs.length), dossier_id: args.p_dossier_id, depuis: args.p_depuis, statut_tva: args.p_statut_tva,
        article_exoneration: args.p_article_exoneration, tva_periodicite: args.p_tva_periodicite, tva_sur_debits: args.p_tva_sur_debits,
        frequence_transactions: args.p_frequence_transactions, frequence_paiements: args.p_frequence_paiements, note: args.p_note,
        cree_par: 'u1', cree_le: '2027-11-05T10:00:00Z', retire_le: null, retire_par: null,
      })
    } else if (nom === 'retirer_regime_ereporting') {
      faux.tables.regimes_ereporting = faux.tables.regimes_ereporting.map((r) =>
        (r.id === args.p_regime_id ? { ...r, retire_le: '2027-11-05T10:05:00Z', retire_par: 'u1' } : r))
    } else if (nom === 'declarer_ereporting_hors_application') {
      const id = nouvelId(faux.rpcs.length)
      faux.tables.declarations_ereporting = faux.tables.declarations_ereporting.map((d) =>
        (d.id === args.p_remplace_id ? { ...d, etat: 'remplacee' } : d))
      faux.tables.declarations_ereporting.push({
        id, dossier_id: args.p_dossier_id, objet: args.p_objet, periode_debut: args.p_debut, periode_fin: args.p_fin,
        regime_id: args.p_regime_id, type_transmission: args.p_remplace_id ? 'RE' : 'IN', remplace_id: args.p_remplace_id,
        canal: 'manuel', plateforme: args.p_plateforme, contenu: args.p_contenu, empreinte: 'b'.repeat(64),
        nb_operations: (args.p_contenu as Ligne).nombreOperations, etat: 'declaree', note: args.p_note, cree_par: 'u1',
        cree_le: '2027-11-05T10:10:00Z',
      })
      for (const s of sourcesDuContenu(args.p_objet as string, args.p_contenu as Ligne)) {
        faux.tables.declarations_ereporting_sources.push({ declaration_id: id, dossier_id: args.p_dossier_id, ...s })
      }
    }
    if (faux.retenirLectures) faux.barriere = new Promise<void>((r) => { faux.libererLectures = r })
    return { data: {}, error: null }
  }
  return {
    supabase: {
      rpc: (nom: string, args: Ligne) => {
        faux.rpcs.push({ nom, args })
        if (faux.retenirRpc) return new Promise((r) => { faux.libererRpc = () => r(executer(nom, args)) })
        return Promise.resolve(executer(nom, args))
      },
      from: (table: string) => {
        const predicats: ((l: Ligne) => boolean)[] = []
        let debut = 0
        let fin = Number.MAX_SAFE_INTEGER
        let colonnes: string[] | null = null
        const c: Ligne = {}
        Object.assign(c, {
          select: (liste: string) => {
            colonnes = liste === '*' ? null : liste.split(',').map((x) => x.trim()).filter((x) => !x.includes('!inner'))
            return c
          },
          eq: (colonne: string, valeur: unknown) => {
            if (colonne === 'factures_emises.dossier_id') {
              predicats.push((l) => (faux.tables.factures_emises.find((f) => f.id === l.facture_id) as Ligne | undefined)?.dossier_id === valeur)
            } else predicats.push(predicatEq(colonne, valeur))
            return c
          },
          in: (colonne: string, valeurs: unknown[]) => { predicats.push(predicatIn(colonne, valeurs)); return c },
          order: () => c,
          range: (d: number, f: number) => { debut = d; fin = f; return c },
          then: (suite: (r: unknown) => unknown, echec?: (e: unknown) => unknown) => {
            faux.lectures += 1
            if (faux.leve) return Promise.reject(new Error('réseau coupé')).then(suite, echec)
            const reponse = () => {
              if (faux.refus[table]) return { data: null, error: { message: faux.refus[table] }, count: null }
              const toutes = filtrer(faux.tables[table] ?? [], predicats)
              const rendu = toutes.slice(debut, Math.min(fin + 1, toutes.length, faux.muetApres[table] ?? Infinity))
                .map((l) => (colonnes ? Object.fromEntries(colonnes.map((k) => [k, l[k]])) : l))
              return { data: rendu, error: null, count: toutes.length }
            }
            return (faux.porte ?? faux.barriere ?? Promise.resolve()).then(reponse).then(suite, echec)
          },
        })
        return c
      },
    },
  }
})

const jour = (iso: string) => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(iso))
}

function monde(o: { declarations?: DeclarationEreportingHorsApplication[]; sourcesDeclarees?: SourceDeclarationEreporting[]; s?: ReturnType<typeof sources> } = {}) {
  const s = o.s ?? sources()
  faux.tables = {
    regimes_ereporting: s.regimes.lignes.map((r) => ({ ...r })),
    pieces_ecartees_ereporting: s.ecarts.lignes.map((r) => ({ ...r })),
    declarations_ereporting: (o.declarations ?? s.declarations.lignes).map((r) => ({ ...r })),
    declarations_ereporting_sources: (o.sourcesDeclarees ?? s.sources.lignes).map((r) => ({ ...r })),
    pieces_hors_de_france: s.fiches.lignes.map((r) => ({ ...r })),
    pieces_hors_de_france_taux: s.taux.lignes.map((r) => ({ ...r })),
    pieces: s.pieces.lignes.map((r) => ({ ...r })),
    factures_emises: s.factures.lignes.map((r) => ({ ...r })),
    facture_lignes: s.lignes.lignes.map((r) => ({ ...r })),
    encaissements_factures: s.encaissements.lignes.map((r) => ({ ...r })),
    encaissements_factures_taux: s.parts.lignes.map((r) => ({ ...r })),
    piece_textes_ocr: s.textes.lignes.map((t) => ({ id: `t-${String(t.piece_id)}`, dossier_id: 'd1', ...t })),
  }
}

const surfaces = { ferme: vi.fn(), misAJour: vi.fn() }
let confirmations: string[] = []

async function monter(o: { dossier?: DossierEreporting; confirmerDEmblee?: boolean } = {}) {
  render(<EreportingModal dossierId="d1" dossier={o.dossier ?? dossier()} confirmerDEmblee={o.confirmerDEmblee} onClose={surfaces.ferme} onUpdated={surfaces.misAJour} />)
  await laisser()
}

// Les lectures de la fenêtre s'enchaînent (régimes, déclarations, fiches, puis les textes) : on laisse passer les microtâches.
async function laisser(tours = 12) {
  for (let i = 0; i < tours; i++) await act(async () => { await Promise.resolve() })
}

beforeEach(() => {
  faux.muetApres = {}
  faux.refus = {}
  faux.rpcs = []
  faux.erreurRpc = null
  faux.retenirRpc = false
  faux.libererRpc = null
  faux.retenirLectures = false
  faux.libererLectures = null
  faux.lectures = 0
  faux.porte = null
  faux.libererPorte = null
  faux.leve = false
  faux.barriere = null
  surfaces.ferme.mockClear()
  surfaces.misAJour.mockClear()
  confirmations = []
  telecharge.fichiers = []
  vi.spyOn(window, 'confirm').mockImplementation((texte?: string) => { confirmations.push(texte ?? ''); return true })
  jour('2027-11-05T10:00:00Z')
  monde()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

const sansEspaces = (t: string) => t.replace(/[  ]/g, ' ')
// Les textes de la base et des modules écrivent tantôt l’apostrophe droite, tantôt la courbe : un attendu les admet toutes deux.
const phrase = (texte: string) => new RegExp(texte.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/['’]/g, '[\'’]'))
// Un paragraphe dont le texte ENTIER (ses éléments en ligne compris) porte ce motif.
const paragraphe = (motif: RegExp) => screen.getAllByText((_, el) => el?.tagName === 'P' && motif.test(el.textContent ?? ''), { selector: 'p' })
const bouton = (nom: string | RegExp) => screen.queryByRole('button', { name: nom })
const tableau = (nom: string) => screen.getByRole('table', { name: nom })
const lignesDe = (nom: string) => within(tableau(nom)).getAllByRole('row').slice(1)
const TABLE_ACHATS = 'Périodes : Achats à un fournisseur établi hors de France'
const TABLE_VENTES = 'Périodes : Ventes à des particuliers'
const TABLE_PAIEMENTS = 'Périodes : Paiements de ces ventes'

async function ouvrirLaPeriode(table: string, libelle: string) {
  const ligneCliquee = lignesDe(table).find((l) => within(l).queryByText(libelle))
  if (!ligneCliquee) throw new Error(`Aucune période « ${libelle} »`)
  await act(async () => { fireEvent.click(within(ligneCliquee).getByRole('button', { name: 'Détail' })) })
}

describe('la lecture', () => {
  it('pendant sa première lecture, la fenêtre ne dit que « Chargement… » : ni régime, ni période, ni geste', async () => {
    let liberer = () => {}
    faux.porte = new Promise<void>((r) => { liberer = r })
    await monter()
    expect(screen.getByText('Chargement…')).toBeTruthy()
    expect(screen.queryByText('Régime d’e-reporting')).toBeNull()
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Fermer'])
    faux.porte = null
    await act(async () => { liberer() })
    await laisser()
    expect(screen.queryByText('Chargement…')).toBeNull()
    expect(screen.getByText('Régime d’e-reporting')).toBeTruthy()
  })

  it('lues en entier : le régime en vigueur, ses fréquences, et les périodes de l’objet choisi', async () => {
    await monter()
    const regimeEnVigueur = screen.getByText('redevable, chaque mois', { selector: 'strong' }).closest('p')?.textContent
    expect(regimeEnVigueur).toContain('depuis le 01/01/2026')
    expect(regimeEnVigueur).toContain('ses ventes et ses achats se déclarent chaque mois ; ses paiements se déclarent chaque mois')
    // Les achats d’abord, les plus récentes en tête.
    const lignes = lignesDe(TABLE_ACHATS).map((l) => l.textContent)
    expect(lignes).toHaveLength(3)
    expect(lignes[0]).toContain('novembre 2027')
    expect(lignes[0]).toContain('Période en cours')
    expect(lignes[1]).toContain('octobre 2027')
    expect(lignes[1]).toContain('À déclarer avant le 10/11/2027')
    expect(lignes[2]).toContain('septembre 2027')
    expect(lignes[2]).toContain('Rien à déclarer')
  })

  it('ne dit pas « chargé » sur une lecture qui lève : le réseau coupé se dit, et rien n’est offert', async () => {
    faux.leve = true
    const journal = vi.spyOn(console, 'error').mockImplementation(() => {})
    await monter()
    journal.mockRestore()
    expect(screen.getByText(/L’e-reporting du dossier n’a pas pu être lu : réseau coupé\./)).toBeTruthy()
    expect(screen.queryByText('Chargement…')).toBeNull()
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Fermer'])
  })

  const TABLES: [string, string, string][] = [
    ['regimes_ereporting', 'Les régimes d’e-reporting confirmés', 'lus'],
    ['pieces_ecartees_ereporting', 'Les pièces écartées de l’e-reporting', 'lues'],
    ['declarations_ereporting', 'Les déclarations d’e-reporting', 'lues'],
    ['declarations_ereporting_sources', 'Les sources des déclarations', 'lues'],
    ['pieces', 'Les pièces du dossier', 'lues'],
    ['pieces_hors_de_france', 'Les fiches « fournisseur établi hors de France »', 'lues'],
    ['pieces_hors_de_france_taux', 'Les fiches « fournisseur établi hors de France »', 'lues'],
    ['factures_emises', 'Les factures émises', 'lues'],
    ['facture_lignes', 'Les lignes des factures', 'lues'],
    ['encaissements_factures', 'Les encaissements', 'lus'],
    ['encaissements_factures_taux', 'La répartition des encaissements par taux', 'lue'],
    ['piece_textes_ocr', 'Les textes lus sur les documents', 'lus'],
  ]

  it.each(TABLES)('%s lue en partie : la fenêtre le dit, et n’affirme ni n’offre rien', async (table, quoi) => {
    // Deux lignes de plus, dont une seule se rend : la lecture annonce le total, rend moins.
    const en_trop = (i: number) => ({ id: `x-${i}`, dossier_id: 'd1', piece_id: P1, fiche_id: F1, facture_id: V1, encaissement_id: E1, taux: 5 + i, declaration_id: `x-${i}`, genre: 'fiche', source_id: F1 })
    faux.tables[table] = [...faux.tables[table], en_trop(1), en_trop(2)]
    faux.muetApres[table] = 1
    await monter()
    expect(screen.getAllByText(new RegExp(quoi.replace(/[«»()]/g, '.'))).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Rien n’est affirmé ni offert/).length).toBeGreaterThan(0)
    // Ni régime, ni période, ni état, ni geste : seul « Fermer ».
    expect(screen.queryByText('Régime d’e-reporting')).toBeNull()
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.queryByText('Rien à déclarer')).toBeNull()
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Fermer'])
    expect(faux.rpcs).toEqual([])
  })

  it('une lecture refusée par la base se dit avec la raison, sans rien offrir', async () => {
    faux.refus.factures_emises = 'permission refusée'
    await monter()
    expect(screen.getByText(/Les factures émises n'ont pas pu être lues en entier \(lecture interrompue après 0 ligne\(s\) : permission refusée\)/)).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Fermer'])
  })

  it('avant les opérations du 1er septembre 2027, aucune période n’est à déclarer, et la fenêtre le dit', async () => {
    jour('2026-10-11T10:00:00Z')
    await monter()
    expect(screen.queryByRole('table', { name: /^Périodes/ })).toBeNull()
    expect(screen.getByText(/Les déclarations commencent avec les opérations du 01\/09\/2027 \(PME, micro-entreprise\) : aucune période n’est encore à déclarer\./)).toBeTruthy()
  })
})

describe('le régime', () => {
  it('sans régime confirmé : la fenêtre le dit, propose celui du statut d’aujourd’hui sans le confirmer, et les périodes attendent', async () => {
    monde({ s: sources({ regimes: lu([]) }) })
    await monter()
    expect(screen.getByText(/Aucun régime n’est confirmé pour ce dossier\./)).toBeTruthy()
    expect(screen.getByText(/redevable, chaque mois — , proposé, et ne se déclarent pas/)).toBeTruthy()
    expect(screen.queryByRole('table', { name: 'Histoire des régimes d’e-reporting' })).toBeNull()
    // Le régime est à confirmer : aucune période ne se déclare.
    const octobre = lignesDe(TABLE_ACHATS).find((l) => l.textContent?.includes('octobre 2027'))
    expect(octobre?.textContent).toContain('Régime à confirmer')
  })

  it('l’histoire : les régimes retirés se disent retirés, et seuls les actifs se retirent', async () => {
    monde({ s: sources({ regimes: lu([
      regime({ id: R1, depuis: '2026-01-01', retire_le: '2026-02-01T10:00:00Z', retire_par: 'u1', statut_tva: 'franchise', tva_periodicite: null, frequence_transactions: 'bimestre', frequence_paiements: 'bimestre' }),
      regime({ id: R2, depuis: '2026-02-01', note: 'Confirmé avec le service des impôts.' }),
    ]) }) })
    await monter()
    const histoire = within(tableau('Histoire des régimes d’e-reporting')).getAllByRole('row').slice(1)
    expect(histoire).toHaveLength(2)
    // Du plus récent au plus ancien.
    expect(histoire[0].textContent).toContain('01/02/2026')
    expect(histoire[0].textContent).toContain('Confirmé avec le service des impôts.')
    expect(within(histoire[0]).getByRole('button', { name: 'Retirer' })).toBeTruthy()
    expect(histoire[1].textContent).toContain('Retiré le 01/02/2026')
    expect(within(histoire[1]).queryByRole('button', { name: 'Retirer' })).toBeNull()
  })

  it('l’onglet TVA contredit le régime : le régime est à reconfirmer, et les périodes n’y sont pas déclarables', async () => {
    await monter({ dossier: dossier({ statut_tva: 'franchise', article_exoneration: null }) })
    // L’alerte du régime, et la période qu’elle retient.
    expect(document.querySelector('.alerte-tva')?.textContent).toContain('n’est plus celui du régime confirmé à partir du 01/01/2026')
    const octobre = lignesDe(TABLE_ACHATS).find((l) => l.textContent?.includes('octobre 2027'))
    expect(octobre?.textContent).toContain('Régime à reconfirmer')
  })

  it('un statut à préciser ne fait pas reconfirmer, il le dit', async () => {
    await monter({ dossier: dossier({ statut_tva: null, article_exoneration: null }) })
    // Aucune alerte du régime : un statut à préciser ne se compare à rien.
    expect(document.querySelector('.alerte-tva')).toBeNull()
    expect(screen.getByText(/Le statut de TVA du dossier est à préciser \(onglet TVA\)/)).toBeTruthy()
  })

  describe('confirmer un régime', () => {
    async function ouvrirLaConfirmation() {
      await act(async () => { fireEvent.click(bouton('Confirmer un régime…') as HTMLElement) })
    }
    const champ = (libelle: string | RegExp) => screen.getByLabelText(libelle) as HTMLInputElement | HTMLSelectElement
    const saisir = async (libelle: string | RegExp, valeur: string) => { await act(async () => { fireEvent.change(champ(libelle), { target: { value: valeur } }) }) }
    const confirmer = () => bouton('Confirmer le régime') as HTMLButtonElement

    it('s’ouvre sur le statut de l’onglet TVA — SAUF le jour, que le cabinet saisit', async () => {
      await monter()
      await ouvrirLaConfirmation()
      expect((champ('À partir du') as HTMLInputElement).value).toBe('')
      expect((champ('Statut de TVA') as HTMLSelectElement).value).toBe('redevable')
      expect((champ('Périodicité de sa déclaration de TVA') as HTMLSelectElement).value).toBe('trimestrielle')
      expect((screen.getByLabelText('Le dossier a opté pour la TVA sur les débits') as HTMLInputElement).checked).toBe(false)
      expect(screen.getByText(/Le jour n’est jamais proposé/)).toBeTruthy()
      // Le jour absent est dit, sans alarme, et le bouton est grisé.
      expect(screen.getByText(phrase('Le jour à partir duquel ce régime vaut est à renseigner.')).className).toBe('muted')
      expect(confirmer().disabled).toBe(true)
    })

    it('s’ouvre d’emblée quand la carte le demande', async () => {
      await monter({ confirmerDEmblee: true })
      expect(champ('À partir du')).toBeTruthy()
      expect(bouton('Confirmer un régime…')).toBeNull()
    })

    it('dit AVANT le clic ce que la base refuserait, dans son ordre, sous ses mots', async () => {
      await monter()
      await ouvrirLaConfirmation()
      // 3. Avant l’an 2000.
      await saisir('À partir du', '1999-12-31')
      expect(screen.getByText(phrase('Un régime ne se date pas avant l’an 2000.')).className).toBe('error-text')
      // 3. Dans l’avenir : « nous sommes le 05/11/2027 ».
      await saisir('À partir du', '2027-11-06')
      expect(screen.getByText(phrase('Un régime ne se confirme pas pour l’avenir : nous sommes le 05/11/2027.'))).toBeTruthy()
      // 4. Un régime déjà confirmé ce jour-là.
      await saisir('À partir du', '2026-01-01')
      expect(screen.getByText(phrase('Un régime est déjà confirmé à partir du 01/01/2026 : le retirer d’abord pour en confirmer un autre ce jour-là.'))).toBeTruthy()
      expect(confirmer().disabled).toBe(true)
      // Un jour libre : plus de refus, le bouton s’ouvre.
      await saisir('À partir du', '2027-09-01')
      expect(screen.queryByText(/Un régime est déjà confirmé/)).toBeNull()
      expect(confirmer().disabled).toBe(false)
      // 6. Un redevable sans périodicité.
      await saisir('Périodicité de sa déclaration de TVA', '')
      expect(screen.getByText(phrase('Un redevable déclare sa TVA chaque mois ou chaque trimestre : la périodicité est à renseigner.'))).toBeTruthy()
      expect(confirmer().disabled).toBe(true)
      // 4. Le statut absent.
      await saisir('Statut de TVA', '')
      expect(screen.getByText(phrase('Un régime confirmé est celui d’un dossier redevable, en franchise en base ou exonéré : un statut à préciser ne se confirme pas.'))).toBeTruthy()
    })

    it('une note de plus de 2 000 caractères se refuse avant le clic', async () => {
      await monter()
      await ouvrirLaConfirmation()
      await saisir('À partir du', '2027-09-01')
      await saisir('Note (facultative)', 'x'.repeat(2001))
      expect(screen.getByText(phrase('La note de la confirmation dépasse 2 000 caractères.'))).toBeTruthy()
      expect(confirmer().disabled).toBe(true)
    })

    it('dit les fréquences que le régime donne : un franchisé au bimestre, un exonéré chaque mois, une option pour les débits sans paiements', async () => {
      await monter()
      await ouvrirLaConfirmation()
      await saisir('Statut de TVA', 'franchise')
      expect(paragraphe(/^Sous ce régime, ses ventes et ses achats se déclarent tous les deux mois ; ses paiements se déclarent tous les deux mois\.$/)).toHaveLength(1)
      expect(screen.queryByLabelText('Périodicité de sa déclaration de TVA')).toBeNull()
      await saisir('Statut de TVA', 'exonere')
      expect(paragraphe(/^Sous ce régime, ses ventes et ses achats se déclarent chaque mois/)).toHaveLength(1)
      await saisir('Statut de TVA', 'redevable')
      await act(async () => { fireEvent.click(screen.getByLabelText('Le dossier a opté pour la TVA sur les débits')) })
      expect(paragraphe(/^Sous ce régime, .* ses paiements ne se déclarent pas \(option pour la TVA sur les débits\)\.$/)).toHaveLength(1)
    })

    it('confirme : la confirmation nomme le jour, le régime et ses fréquences ; la base reçoit les neuf paramètres ; le régime paraît à la relecture', async () => {
      await monter()
      await ouvrirLaConfirmation()
      await saisir('À partir du', '2027-09-01')
      await saisir('Note (facultative)', '  Confirmé par téléphone. ')
      await act(async () => { fireEvent.click(confirmer()) })
      await laisser()
      expect(confirmations).toHaveLength(1)
      expect(confirmations[0]).toContain('à partir du 01/09/2027')
      expect(confirmations[0]).toContain('« redevable, chaque mois »')
      expect(confirmations[0]).toContain('ses ventes et ses achats se déclarent chaque mois ; ses paiements se déclarent chaque mois')
      expect(confirmations[0]).toContain('Il ne se modifie pas')
      expect(faux.rpcs).toHaveLength(1)
      expect(faux.rpcs[0]).toEqual({
        nom: 'confirmer_regime_ereporting',
        args: {
          p_dossier_id: 'd1', p_depuis: '2027-09-01', p_statut_tva: 'redevable', p_article_exoneration: null,
          p_tva_periodicite: 'trimestrielle', p_tva_sur_debits: false, p_frequence_transactions: 'mois', p_frequence_paiements: 'mois',
          p_note: 'Confirmé par téléphone.',
        },
      })
      expect(screen.getByRole('status').textContent).toBe('Régime confirmé à partir du 01/09/2027.')
      // La relecture montre le régime confirmé, et le formulaire s’est refermé.
      const histoire = within(tableau('Histoire des régimes d’e-reporting')).getAllByRole('row').slice(1)
      expect(histoire.map((l) => l.textContent?.slice(0, 10))).toEqual(['01/09/2027R', '01/01/2026R'].map((x) => x.slice(0, 10)))
      expect(screen.queryByLabelText('À partir du')).toBeNull()
      expect(surfaces.misAJour).toHaveBeenCalledTimes(1)
    })

    it('deux puis trois clics du même rendu : un seul appel, et le verrou tient jusqu’à la relecture', async () => {
      await monter()
      await ouvrirLaConfirmation()
      await saisir('À partir du', '2027-09-01')
      faux.retenirRpc = true
      const b = confirmer()
      await act(async () => { fireEvent.click(b); fireEvent.click(b); fireEvent.click(b) })
      expect(faux.rpcs).toHaveLength(1)
      expect(confirmations).toHaveLength(1)
      // L’appel revient, mais la relecture reste en attente : le verrou tient encore.
      faux.retenirRpc = false
      faux.retenirLectures = true
      await act(async () => { faux.libererRpc?.() })
      await laisser()
      await act(async () => { fireEvent.click(b) })
      expect(faux.rpcs).toHaveLength(1)
      // Les retraits sont tenus par le même verrou.
      const retirer = screen.getAllByRole('button', { name: /^Retirer|Retrait/ })
      await act(async () => { fireEvent.click(retirer[0]) })
      expect(faux.rpcs).toHaveLength(1)
      // La relecture revient : le verrou se relâche.
      faux.retenirLectures = false
      await act(async () => { faux.libererLectures?.() })
      await laisser()
      expect(screen.getByRole('status').textContent).toContain('Régime confirmé')
      expect(surfaces.misAJour).toHaveBeenCalledTimes(1)
      expect(bouton('Confirmer un régime…')).toBeTruthy()
    })

    it('refusée par la base : l’erreur se dit, les listes sont relues, le verrou est relâché, le formulaire reste', async () => {
      await monter()
      await ouvrirLaConfirmation()
      await saisir('À partir du', '2027-09-01')
      faux.erreurRpc = 'Un régime est déjà confirmé à partir du 01/09/2027 : le retirer d’abord pour en confirmer un autre ce jour-là.'
      const lecturesAvant = faux.lectures
      await act(async () => { fireEvent.click(confirmer()) })
      await laisser()
      expect(screen.getByText(/Un régime est déjà confirmé à partir du 01\/09\/2027/, { selector: 'p.error-text' })).toBeTruthy()
      // Relues aussi sur un refus.
      expect(faux.lectures).toBeGreaterThan(lecturesAvant)
      // Le verrou est relâché : un nouvel essai part.
      faux.erreurRpc = null
      await act(async () => { fireEvent.click(confirmer()) })
      await laisser()
      expect(faux.rpcs).toHaveLength(2)
    })

    it('un confirm refusé n’écrit rien', async () => {
      await monter()
      await ouvrirLaConfirmation()
      await saisir('À partir du', '2027-09-01')
      vi.spyOn(window, 'confirm').mockImplementation(() => false)
      await act(async () => { fireEvent.click(confirmer()) })
      expect(faux.rpcs).toEqual([])
      expect(confirmer().disabled).toBe(false)
    })

    it('Annuler referme le formulaire sans rien écrire', async () => {
      await monter()
      await ouvrirLaConfirmation()
      await act(async () => { fireEvent.click(bouton('Annuler') as HTMLElement) })
      expect(screen.queryByLabelText('À partir du')).toBeNull()
      expect(faux.rpcs).toEqual([])
    })
  })

  describe('retirer un régime', () => {
    it('la confirmation nomme le régime et son jour ; la base reçoit le dossier et le régime ; il paraît retiré', async () => {
      await monter()
      await act(async () => { fireEvent.click(bouton('Retirer') as HTMLElement) })
      await laisser()
      expect(confirmations[0]).toContain('Retirer le régime « redevable, chaque mois » confirmé à partir du 01/01/2026 ?')
      expect(confirmations[0]).toContain('Aucune déclaration n’a été faite sous ce régime.')
      expect(faux.rpcs).toEqual([{ nom: 'retirer_regime_ereporting', args: { p_dossier_id: 'd1', p_regime_id: R1 } }])
      expect(screen.getByRole('status').textContent).toBe('Régime du 01/01/2026 retiré : il reste dans l’historique, marqué retiré.')
      expect(screen.getByText(/Retiré le 05\/11\/2027/)).toBeTruthy()
      expect(surfaces.misAJour).toHaveBeenCalledTimes(1)
    })

    it('dit combien de déclarations faites sous ce régime resteront, à rectifier', async () => {
      const { declaration, sources: lignesSources } = declaree('achats', OCTOBRE)
      monde({ declarations: [declaration], sourcesDeclarees: lignesSources })
      await monter()
      await act(async () => { fireEvent.click(bouton('Retirer') as HTMLElement) })
      await laisser()
      expect(confirmations[0]).toContain('1 déclaration faite sous ce régime reste déclarée et se dira à rectifier.')
    })

    it('deux clics du même rendu : un seul appel', async () => {
      await monter()
      faux.retenirRpc = true
      const b = bouton('Retirer') as HTMLElement
      await act(async () => { fireEvent.click(b); fireEvent.click(b); fireEvent.click(b) })
      expect(faux.rpcs).toHaveLength(1)
    })

    it('refusé par la base : l’erreur se dit, les listes sont relues, le verrou est relâché', async () => {
      await monter()
      faux.erreurRpc = 'Ce régime est déjà retiré.'
      const lecturesAvant = faux.lectures
      await act(async () => { fireEvent.click(bouton('Retirer') as HTMLElement) })
      await laisser()
      expect(screen.getByText('Ce régime est déjà retiré.', { selector: 'p.error-text' })).toBeTruthy()
      // Relues aussi sur un refus : la base a peut-être vu ce que l’écran n’avait pas lu.
      expect(faux.lectures).toBeGreaterThan(lecturesAvant)
      faux.erreurRpc = null
      await act(async () => { fireEvent.click(bouton('Retirer') as HTMLElement) })
      await laisser()
      expect(faux.rpcs).toHaveLength(2)
    })

    it('une relecture qui lève APRÈS l’écriture se dit comme une lecture, sans faire dire que l’écriture a échoué', async () => {
      await monter()
      faux.leve = true
      const journal = vi.spyOn(console, 'error').mockImplementation(() => {})
      await act(async () => { fireEvent.click(bouton('Retirer') as HTMLElement) })
      await laisser()
      journal.mockRestore()
      expect(faux.rpcs).toHaveLength(1)
      expect(screen.getByText(/L’e-reporting du dossier n’a pas pu être lu : réseau coupé\./)).toBeTruthy()
      expect(screen.queryByText(/n’a pas pu être retiré/)).toBeNull()
    })
  })
})

describe('les périodes', () => {
  it('les trois objets, chacun ses périodes ; l’objet qui a quelque chose à faire le dit', async () => {
    await monter()
    expect(bouton('Achats à un fournisseur établi hors de France · 1 à faire')).toBeTruthy()
    expect(bouton('Ventes à des particuliers · 1 à faire')).toBeTruthy()
    expect(bouton('Paiements de ces ventes · 1 à faire')).toBeTruthy()
    await act(async () => { fireEvent.click(bouton(/^Ventes à des particuliers/) as HTMLElement) })
    expect(lignesDe(TABLE_VENTES).map((l) => l.textContent)[1]).toContain('À déclarer avant le 10/11/2027')
    await act(async () => { fireEvent.click(bouton(/^Paiements de ces ventes/) as HTMLElement) })
    expect(lignesDe(TABLE_PAIEMENTS)).toHaveLength(3)
    expect(bouton(/^Paiements de ces ventes/)?.getAttribute('aria-pressed')).toBe('true')
    expect(bouton(/^Achats à un fournisseur/)?.getAttribute('aria-pressed')).toBe('false')
  })

  it('l’échéance dépassée : en retard', async () => {
    jour('2027-11-12T10:00:00Z')
    await monter()
    const octobre = lignesDe(TABLE_ACHATS).find((l) => l.textContent?.includes('octobre 2027'))
    expect(octobre?.textContent).toContain('En retard')
    expect(octobre?.textContent).toContain('L’échéance est dépassée.')
  })

  it('le détail d’une période : son contenu en tableau, ses totaux, ce qui l’explique — et le geste de la déclarer', async () => {
    await monter()
    await ouvrirLaPeriode(TABLE_ACHATS, 'octobre 2027')
    expect(screen.getByRole('heading', { name: 'Achats à un fournisseur établi hors de France — octobre 2027' })).toBeTruthy()
    expect(screen.getByText(/Du 01\/10\/2027 au 31\/10\/2027\. Au plus tard le 10\/11\/2027\./)).toBeTruthy()
    const contenu = within(tableau('Contenu : Achats à un fournisseur établi hors de France')).getAllByRole('row').slice(1)
    expect(contenu.map((l) => sansEspaces(l.textContent ?? ''))).toEqual(['05/10/2027Editeur LogicielFacture n° INV-1IE120,00 €'])
    expect(sansEspaces(screen.getByText(/^1 facture, 120,00 € hors taxe\.$/).textContent ?? '')).toBe('1 facture, 120,00 € hors taxe.')
    expect(screen.getByRole('heading', { name: 'Déclarée sur la plateforme' })).toBeTruthy()
    // Fermer referme le détail.
    await act(async () => { fireEvent.click(within(tableau(TABLE_ACHATS)).getByRole('button', { name: 'Fermer' })) })
    expect(screen.queryByRole('heading', { name: /— octobre 2027/ })).toBeNull()
  })

  it('« Télécharger le détail (CSV) » : le fichier de la période, sans réseau ni écriture ; rien à télécharger sans contenu', async () => {
    await monter()
    await ouvrirLaPeriode(TABLE_ACHATS, 'octobre 2027')
    await act(async () => { fireEvent.click(bouton('Télécharger le détail (CSV)') as HTMLElement) })
    expect(telecharge.fichiers).toHaveLength(1)
    expect(telecharge.fichiers[0].nom).toBe('e-reporting-achats-2027-10-01-2027-10-31.csv')
    expect(telecharge.fichiers[0].contenu.split('\r\n')[1]).toBe('2027-10-05;Editeur Logiciel;Facture;INV-1;2027-10-05;IE;EUR;120,00')
    expect(faux.rpcs).toEqual([])
    await ouvrirLaPeriode(TABLE_ACHATS, 'septembre 2027')
    expect(bouton('Télécharger le détail (CSV)')).toBeNull()
  })

  it('un détail ouvert sur un objet se referme quand on change d’objet', async () => {
    await monter()
    await ouvrirLaPeriode(TABLE_ACHATS, 'octobre 2027')
    await act(async () => { fireEvent.click(bouton(/^Ventes à des particuliers/) as HTMLElement) })
    expect(screen.queryByRole('heading', { name: /— octobre 2027/ })).toBeNull()
  })

  it('une période en cours ou sans opération n’offre aucun geste', async () => {
    await monter()
    await ouvrirLaPeriode(TABLE_ACHATS, 'novembre 2027')
    expect(screen.queryByRole('heading', { name: 'Déclarée sur la plateforme' })).toBeNull()
    expect(screen.queryByLabelText(/Plateforme sur laquelle/)).toBeNull()
    await ouvrirLaPeriode(TABLE_ACHATS, 'septembre 2027')
    expect(screen.queryByLabelText(/Plateforme sur laquelle/)).toBeNull()
  })

  it('une pièce qui ressemble à un achat à l’étranger : à vérifier, la pièce nommée, aucun geste de déclaration', async () => {
    monde({ s: sources({
      pieces: lu([piece({ id: P1, devise: 'USD', montant_devise: 50, montant_ttc: 46, date_piece: '2027-10-09', tiers: 'Service en ligne' })]),
      fiches: lu([]), taux: lu([]),
    }) })
    await monter()
    const octobre = lignesDe(TABLE_ACHATS).find((l) => l.textContent?.includes('octobre 2027'))
    expect(octobre?.textContent).toContain('À vérifier')
    await ouvrirLaPeriode(TABLE_ACHATS, 'octobre 2027')
    // Dite dans la ligne ET dans le détail, avec la pièce nommée.
    expect(screen.getAllByText(/Une pièce d’achat sans fiche ressemble à un achat à un fournisseur établi hors de France\./).length).toBeGreaterThan(0)
    expect(screen.getByText('(la pièce « Service en ligne »)')).toBeTruthy()
    expect(screen.queryByLabelText(/Plateforme sur laquelle/)).toBeNull()
  })

  describe('déclarer une période', () => {
    const plateforme = () => screen.getByLabelText('Plateforme sur laquelle la période a été déclarée') as HTMLInputElement
    const declarer = () => bouton('Déclarée sur la plateforme') as HTMLButtonElement
    const taper = async (valeur: string) => { await act(async () => { fireEvent.change(plateforme(), { target: { value: valeur } }) }) }

    async function ouvrirOctobre() {
      await monter()
      await ouvrirLaPeriode(TABLE_ACHATS, 'octobre 2027')
    }

    it('la plateforme se nomme : absente, le refus de la base se dit sans alarme et le bouton est grisé', async () => {
      await ouvrirOctobre()
      expect(plateforme().value).toBe('')
      expect(screen.getByText('La plateforme sur laquelle la période a été déclarée est à nommer.').className).toBe('muted')
      expect(declarer().disabled).toBe(true)
      await taper('Plateforme fictive')
      expect(screen.queryByText('La plateforme sur laquelle la période a été déclarée est à nommer.')).toBeNull()
      expect(sansEspaces(screen.getByText(/^La déclaration gardera, figé et empreinté par la base/).textContent ?? ''))
        .toContain('1 facture, 120,00 € hors taxe.')
      expect(declarer().disabled).toBe(false)
    })

    it('dit AVANT le clic les autres refus de la base : plateforme trop longue, note trop longue', async () => {
      await ouvrirOctobre()
      await taper('x'.repeat(201))
      expect(screen.getByText('Le nom de la plateforme dépasse 200 caractères.').className).toBe('error-text')
      expect(declarer().disabled).toBe(true)
      await taper('Plateforme fictive')
      await act(async () => { fireEvent.change(screen.getByLabelText('Note (facultative)', { selector: '#ereporting-note-declaration' }), { target: { value: 'n'.repeat(2001) } }) })
      expect(screen.getByText('La note de la déclaration dépasse 2 000 caractères.')).toBeTruthy()
      expect(declarer().disabled).toBe(true)
    })

    it('déclare : la confirmation nomme la plateforme, l’objet, la période et le contenu ; la base reçoit le contenu calculé', async () => {
      await ouvrirOctobre()
      await taper('  Plateforme fictive ')
      await act(async () => { fireEvent.change(screen.getByLabelText('Note (facultative)', { selector: '#ereporting-note-declaration' }), { target: { value: 'Déposée par le cabinet.' } }) })
      await act(async () => { fireEvent.click(declarer()) })
      await laisser()
      expect(confirmations).toHaveLength(1)
      expect(sansEspaces(confirmations[0])).toContain('Vous déclarez avoir transmis sur Plateforme fictive l’e-reporting des achats à l’étranger d’octobre 2027 : 1 facture, 120,00 € hors taxe.')
      expect(confirmations[0]).toContain('Cette mention ne s’efface pas')
      expect(faux.rpcs).toHaveLength(1)
      const attendu = contenuADeclarer(declarationCalculee('achats', OCTOBRE, sources(), dossier(), AUJOURDHUI))
      expect(faux.rpcs[0]).toEqual({
        nom: 'declarer_ereporting_hors_application',
        args: {
          p_dossier_id: 'd1', p_objet: 'achats', p_debut: '2027-10-01', p_fin: '2027-10-31', p_regime_id: R1, p_remplace_id: null,
          p_plateforme: 'Plateforme fictive', p_contenu: attendu, p_note: 'Déposée par le cabinet.',
        },
      })
      // La relecture montre la déclaration : l’état de la ligne, le bloc du détail, plus de geste.
      expect(screen.getByRole('status').textContent).toBe('Déclaration enregistrée : Achats à un fournisseur établi hors de France, octobre 2027.')
      const octobre = lignesDe(TABLE_ACHATS).find((l) => l.textContent?.includes('octobre 2027'))
      expect(octobre?.textContent).toContain('Déclarée le 05/11/2027')
      expect(octobre?.textContent).toContain('à jour')
      expect(paragraphe(/^Déclarée le 05\/11\/2027 sur Plateforme fictive \(initiale\), 1 opération\(s\)\. Empreinte du contenu figé : b{16}… — Déposée par le cabinet\.$/)).toHaveLength(1)
      expect(screen.queryByLabelText(/Plateforme sur laquelle/)).toBeNull()
      expect(plateformeApres()).toBe('')
    })

    const plateformeApres = () => (screen.queryByLabelText('Plateforme sur laquelle la période a été déclarée') as HTMLInputElement | null)?.value ?? ''

    it('deux puis trois clics du même rendu : un seul appel, et le verrou tient jusqu’à la relecture', async () => {
      await ouvrirOctobre()
      await taper('Plateforme fictive')
      faux.retenirRpc = true
      const b = declarer()
      await act(async () => { fireEvent.click(b); fireEvent.click(b); fireEvent.click(b) })
      expect(faux.rpcs).toHaveLength(1)
      expect(confirmations).toHaveLength(1)
      faux.retenirRpc = false
      faux.retenirLectures = true
      await act(async () => { faux.libererRpc?.() })
      await laisser()
      // La relecture n’est pas revenue : le bouton ne repart pas, ni aucun autre geste.
      await act(async () => { fireEvent.click(b) })
      expect(faux.rpcs).toHaveLength(1)
      await act(async () => { fireEvent.click(bouton('Retirer') as HTMLElement) })
      expect(faux.rpcs).toHaveLength(1)
      faux.retenirLectures = false
      await act(async () => { faux.libererLectures?.() })
      await laisser()
      expect(screen.getByRole('status').textContent).toContain('Déclaration enregistrée')
    })

    it('refusée par la base : l’erreur se dit, les listes sont relues, le verrou est relâché', async () => {
      await ouvrirOctobre()
      await taper('Plateforme fictive')
      faux.erreurRpc = 'Une déclaration de cette période est déjà active, faite sur « Autre » : une correction se fait par une déclaration rectificative, qui la remplace entière.'
      const avant = faux.lectures
      await act(async () => { fireEvent.click(declarer()) })
      await laisser()
      expect(screen.getByText(/Une déclaration de cette période est déjà active/, { selector: 'p.error-text' })).toBeTruthy()
      expect(faux.lectures).toBeGreaterThan(avant)
      faux.erreurRpc = null
      await act(async () => { fireEvent.click(declarer()) })
      await laisser()
      expect(faux.rpcs).toHaveLength(2)
    })

    it('un confirm refusé n’écrit rien', async () => {
      await ouvrirOctobre()
      await taper('Plateforme fictive')
      vi.spyOn(window, 'confirm').mockImplementation(() => false)
      await act(async () => { fireEvent.click(declarer()) })
      expect(faux.rpcs).toEqual([])
      expect(declarer().disabled).toBe(false)
    })

    it('les ventes et les paiements se déclarent de même, chacun sous son objet', async () => {
      await monter()
      await act(async () => { fireEvent.click(bouton(/^Ventes à des particuliers/) as HTMLElement) })
      await ouvrirLaPeriode(TABLE_VENTES, 'octobre 2027')
      await taper('Plateforme fictive')
      await act(async () => { fireEvent.click(declarer()) })
      await laisser()
      expect(faux.rpcs[0].args).toMatchObject({ p_objet: 'ventes', p_debut: '2027-10-01', p_fin: '2027-10-31' })
      expect(sansEspaces(confirmations[0])).toContain('l’e-reporting des ventes à des particuliers d’octobre 2027 : 1 facture, 100,00 € hors taxe, 20,00 € de TVA.')
      await act(async () => { fireEvent.click(bouton(/^Paiements de ces ventes/) as HTMLElement) })
      await ouvrirLaPeriode(TABLE_PAIEMENTS, 'octobre 2027')
      await taper('Plateforme fictive')
      await act(async () => { fireEvent.click(declarer()) })
      await laisser()
      expect(faux.rpcs[1].args).toMatchObject({ p_objet: 'paiements' })
      expect(sansEspaces(confirmations[1])).toContain('1 encaissement, 120,00 € TTC')
    })

    it('ouvrir une autre période repart d’une saisie vide', async () => {
      await ouvrirOctobre()
      await taper('Plateforme fictive')
      await ouvrirLaPeriode(TABLE_ACHATS, 'septembre 2027')
      await ouvrirLaPeriode(TABLE_ACHATS, 'octobre 2027')
      expect(plateforme().value).toBe('')
    })
  })

  describe('une période déclarée', () => {
    const monterDeclaree = async (modifier: (s: ReturnType<typeof sources>) => ReturnType<typeof sources> = (s) => s, o: Partial<DeclarationEreportingHorsApplication> = {}) => {
      const { declaration, sources: lignesSources } = declaree('achats', OCTOBRE, sources(), o)
      monde({ s: modifier(sources({ declarations: lu([declaration]), sources: lu(lignesSources) })) })
      await monter()
      await ouvrirLaPeriode(TABLE_ACHATS, 'octobre 2027')
      return declaration
    }

    it('à jour : le bloc de la déclaration et son empreinte, aucun geste', async () => {
      await monterDeclaree()
      expect(paragraphe(/^Déclarée le 02\/11\/2027 sur Plateforme fictive \(initiale\), 1 opération\(s\)\. Empreinte du contenu figé : a{16}…$/)).toHaveLength(1)
      expect(screen.queryByRole('heading', { name: 'À rectifier' })).toBeNull()
      expect(screen.queryByLabelText(/Plateforme sur laquelle/)).toBeNull()
    })

    it('la fiche corrigée depuis : à rectifier, ce qui change est dit, et la rectificative s’offre', async () => {
      await monterDeclaree((s) => ({
        ...s,
        fiches: lu([fiche(), fiche({ id: F2, remplace_id: F1, numero: 'INV-1-BIS', cree_le: '2027-11-03T10:00:00Z' })]),
        taux: lu([taux(), taux({ fiche_id: F2 })]),
      }))
      const octobre = lignesDe(TABLE_ACHATS).find((l) => l.textContent?.includes('octobre 2027'))
      expect(octobre?.textContent).toContain('À rectifier')
      expect(screen.getByRole('heading', { name: 'À rectifier' })).toBeTruthy()
      expect(screen.getByText(/la rectificative remplace la période ENTIÈRE/)).toBeTruthy()
      expect(screen.getByText('L’achat de la pièce « Editeur Logiciel » a changé : le numéro de la facture.')).toBeTruthy()
      expect(screen.getByRole('heading', { name: 'Déclarer la rectificative' })).toBeTruthy()
    })

    it('déclare la rectificative : elle désigne l’active, la confirmation dit qu’elle remplace ENTIÈREMENT, et l’historique garde les deux', async () => {
      const active = await monterDeclaree((s) => ({
        ...s,
        fiches: lu([fiche(), fiche({ id: F2, remplace_id: F1, numero: 'INV-1-BIS', cree_le: '2027-11-03T10:00:00Z' })]),
        taux: lu([taux(), taux({ fiche_id: F2 })]),
      }))
      await act(async () => { fireEvent.change(screen.getByLabelText('Plateforme sur laquelle la période a été déclarée'), { target: { value: 'Autre plateforme' } }) })
      await act(async () => { fireEvent.click(bouton('Déclarer la rectificative') as HTMLElement) })
      await laisser()
      expect(sansEspaces(confirmations[0])).toContain('la déclaration RECTIFICATIVE de l’e-reporting des achats à l’étranger d’octobre 2027 : 1 facture, 120,00 € hors taxe.')
      expect(confirmations[0]).toContain('Elle remplace ENTIÈREMENT celle du 02/11/2027 (Plateforme fictive, 1 opération)')
      expect(faux.rpcs).toHaveLength(1)
      expect(faux.rpcs[0].args).toMatchObject({ p_objet: 'achats', p_remplace_id: active.id, p_plateforme: 'Autre plateforme' })
      expect(screen.getByRole('status').textContent).toContain('Rectificative enregistrée')
      // La chaîne : la rectificative active, l’initiale remplacée.
      const historique = screen.getByRole('heading', { name: 'Historique de la période' }).nextElementSibling as HTMLElement
      expect(within(historique).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
        'Rectificative du 05/11/2027 sur Autre plateforme, 1 opération(s) — active.',
        'Initiale du 02/11/2027 sur Plateforme fictive, 1 opération(s) — remplacée.',
      ])
    })

    it('un régime retiré depuis : la cause se dit, la rectificative attend la confirmation d’un régime', async () => {
      await monterDeclaree((s) => ({ ...s, regimes: lu([regime({ retire_le: '2027-11-03T10:00:00Z', retire_par: 'u1' })]) }))
      expect(screen.getByRole('heading', { name: 'À rectifier' })).toBeTruthy()
      expect(screen.getByText(/Le régime sous lequel la période a été déclarée a été retiré le 03\/11\/2027/)).toBeTruthy()
      expect(screen.queryByRole('heading', { name: 'Déclarer la rectificative' })).toBeNull()
      expect(screen.getByText(/La rectificative ne se fait pas encore\. Aucun régime confirmé ne couvre le début de la période/)).toBeTruthy()
    })

    it('la pièce n’est plus déclarable : la rectificative à zéro opération se dit sans s’offrir', async () => {
      await monterDeclaree((s) => ({ ...s, fiches: lu([fiche({ retire_le: '2027-11-03T10:00:00Z', retire_par: 'u1' })]) }))
      expect(screen.getByText(/ne contient plus aucune opération : la base refuse une déclaration à blanc/)).toBeTruthy()
      expect(screen.queryByRole('heading', { name: 'Déclarer la rectificative' })).toBeNull()
    })
  })
})

describe('les lectures de la fenêtre ne dépendent que du dossier', () => {
  it('une déclaration d’un autre dossier ne change rien à la période', async () => {
    const { declaration, sources: lignesSources } = declaree('achats', OCTOBRE)
    monde({ declarations: [{ ...declaration, dossier_id: 'd2' }], sourcesDeclarees: lignesSources.map((x) => ({ ...x, dossier_id: 'd2' })) })
    await monter()
    const octobre = lignesDe(TABLE_ACHATS).find((l) => l.textContent?.includes('octobre 2027'))
    expect(octobre?.textContent).toContain('À déclarer avant le 10/11/2027')
  })

  it('Fermer referme la fenêtre', async () => {
    await monter()
    await act(async () => { fireEvent.click(bouton('Fermer') as HTMLElement) })
    expect(surfaces.ferme).toHaveBeenCalledTimes(1)
  })

  it('Fermer est grisé pendant un geste', async () => {
    await monter()
    faux.retenirRpc = true
    await act(async () => { fireEvent.click(bouton('Retirer') as HTMLElement) })
    expect((bouton('Fermer') as HTMLButtonElement).disabled).toBe(true)
  })
})
