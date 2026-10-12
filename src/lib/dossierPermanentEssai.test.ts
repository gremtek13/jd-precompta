import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  REFUS_CONSIGNATION, REFUS_RETRAIT, refusDeConsigner, refusDeRetirer, refusDuRetraitDUneSourceCitee,
  type ArgumentsConsigner,
} from './dossierPermanent'
import type { NatureDossierPermanent, RevisionJustification, RevisionPreuve } from './types'
import { appelsDe, commeLaBase, etapesDe, lignesInserees, remplacerLesNoms, valeurSql, type Etape } from '../test/essaiSql'

// L'ESSAI DU DOSSIER PERMANENT (supabase/essais/dossierPermanent.sql), JOUÉ SUR UNE RÉPLIQUE PUIS EN PRODUCTION, REJOUÉ ICI
// APPEL PAR APPEL : ce qu'il a construit en base au moment de chaque étape — ses dossiers, ses pièces et ses documents,
// les entrées que ses étapes `fait` consignent, remplacent ou retirent (un `controle` s'annule) — et, pour chaque appel aux
// deux fonctions, ce que le module en dit (lib/dossierPermanent.ts). Le module doit dire ce que la base a dit : le refus,
// à son code et à ses mots, ou rien quand elle a accepté. Puis, pour chaque pièce ou document que l'essai tente de
// déplacer, le refus de `garder_source_citee` que le module redit (`refusDuRetraitDUneSourceCitee`). Les profils et leurs
// accès sont ceux du moteur de l'essai : le chef (super-administrateur) partout, le chef simple dans le cabinet du dossier
// `test` (T, A et le dossier du client, pas J), le membre dans T seul, le membre d'ailleurs dans A seul, le client, le
// compte rattaché à rien et l'anonyme nulle part ; un dossier qui n'existe pas, pour personne.

const ESSAI = readFileSync(new URL('../../supabase/essais/dossierPermanent.sql', import.meta.url), 'utf8')

// Les identifiants que l'essai fixe, lus dans son texte ; ceux que la base fournit au départ — le cabinet, le dossier du
// client, les comptes, le dossier qui n'existe pas — reçoivent ici des valeurs de la même forme.
function nomsDeLEssai(essai: string): Map<string, string> {
  const noms = new Map<string, string>([
    ['CAB', 'c0000000-0000-4000-8000-000000000001'], ['DC', 'c0000000-0000-4000-8000-0000000000dc'],
    ['CLIENT', 'c0000000-0000-4000-8000-0000000000c1'], ['CHEF', 'c0000000-0000-4000-8000-0000000000c2'],
    ['AUTRE', 'c0000000-0000-4000-8000-0000000000ff'],
    ['BLANCS', ' \t\n\r'], ['NBSP', ' '], ['E500', 'é'.repeat(500)], ['E501', 'é'.repeat(501)],
    ['E8000', 'é'.repeat(8000)], ['E8001', 'é'.repeat(8001)],
    ['H1', 'ab'.repeat(32)], ['H2', 'cd'.repeat(32)], ['HMAJ', 'AB'.repeat(32)],
  ])
  for (const m of essai.matchAll(/'(\w+)', '([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})'/g)) {
    noms.set(m[1], m[2])
  }
  return noms
}

interface Ligne {
  id: string
  dossier_id: string
  nature: NatureDossierPermanent
  titre: string
  piece_id: string | null
  document_id: string | null
  remplace_id: string | null
  retire_le: string | null
}

interface Rejeu {
  etape: Etape
  fonction: string
  /** Ce que la base a fait de l'appel : « OK », ou le code et le message (motif LIKE) que l'essai a exigés. */
  base: string
  /** Ce que le module en dit : `OK`, ou la clé de son refus, avec son code et ses mots. */
  cle: string
  code: string | null
  message: string | null
}

interface Deplacement {
  etape: Etape
  base: string
  message: string | null
}

const texteDe = (v: unknown) => (v == null ? null : String(v))
const RETIRE = '2026-10-11T08:00:00+00:00'

function rejouer(essai: string): { rejeux: Rejeu[]; deplacements: Deplacement[] } {
  const noms = nomsDeLEssai(essai)
  const dossiers = new Map<string, string>()      // dossier → cabinet
  dossiers.set(noms.get('DC') as string, noms.get('CAB') as string)
  const pieces = new Map<string, string>()        // pièce → dossier
  const documents = new Map<string, string>()     // document → dossier
  let entrees: Ligne[] = []
  const decisions: Pick<RevisionJustification, 'id' | 'annee' | 'compte'>[] = []
  const preuves: Pick<RevisionPreuve, 'justification_id' | 'piece_id' | 'document_id'>[] = []
  const rejeux: Rejeu[] = []
  const deplacements: Deplacement[] = []
  let compteur = 0
  const nouvelId = () => `f0000000-0000-4000-8000-${String(++compteur).padStart(12, '0')}`
  // Les noms se résolvent AVANT la lecture : un identifiant vit aussi dans un JSON (`{"piece_id": "{P1}"}`), que la
  // base reçoit résolu.
  const valeur = (x: string) => valeurSql(remplacerLesNoms(x, noms), noms, (texte) => {
    const m = /^\(select id from dossier_permanent where titre = '((?:[^']|'')*)'\)$/.exec(texte)
    if (!m) throw new Error(`Sous-requête que le test ne sait pas lire : ${texte}`)
    const trouvees = entrees.filter((e) => e.titre === m[1].replace(/''/g, "'"))
    if (trouvees.length > 1) throw new Error(`Sous-requête à plusieurs lignes : ${texte}`)
    return trouvees[0]?.id ?? null
  })
  const acces = (profil: string, dossier: string) => {
    if (!dossiers.has(dossier)) return false
    if (profil === 'chef') return true
    if (profil === 'chef_simple') return dossiers.get(dossier) === noms.get('CAB')
    if (profil === 'membre') return dossier === noms.get('T')
    if (profil === 'membre_ailleurs') return dossier === noms.get('A')
    return false
  }
  const idsDe = (table: Map<string, string>, dossier: string) => [...table].filter(([, d]) => d === dossier).map(([id]) => id)

  // Ce que l'essai a construit, sous les noms de la base : les identifiants fixes résolus, les autres gardés.
  const resolu = (texte: string) => remplacerLesNoms(texte, noms)

  for (const e of etapesDe(essai)) {
    if (e.genre === 'jeu') {
      for (const d of lignesInserees(e.appel, 'dossiers', noms)) dossiers.set(String(d.id), String(d.cabinet_id))
      for (const p of lignesInserees(e.appel, 'pieces', noms)) pieces.set(String(p.id), String(p.dossier_id))
      for (const d of lignesInserees(e.appel, 'documents_divers', noms)) documents.set(String(d.id), String(d.dossier_id))
      for (const j of lignesInserees(e.appel, 'revision_justifications', noms)) {
        decisions.push({ id: String(j.id), annee: Number(j.annee), compte: String(j.compte) })
      }
      for (const p of lignesInserees(e.appel, 'revision_preuves', noms)) {
        preuves.push({ justification_id: String(p.justification_id), piece_id: texteDe(p.piece_id), document_id: texteDe(p.document_id) })
      }
      continue
    }
    if (e.genre === 'retenir') {
      const appel = resolu(e.appel)
      let m: RegExpExecArray | null
      let trouvees: Ligne[]
      if ((m = /^select id::text from dossier_permanent where dossier_id = '([\w-]+)' and titre = '((?:[^']|'')*)'$/.exec(appel))) {
        const [, dossier, titre] = m
        trouvees = entrees.filter((x) => x.dossier_id === dossier && x.titre === titre.replace(/''/g, "'"))
      } else if ((m = /^select id::text from dossier_permanent where remplace_id = '([\w-]+)'$/.exec(appel))) {
        const cible = m[1]
        trouvees = entrees.filter((x) => x.remplace_id === cible)
      } else throw new Error(`Étape « retenir » que le test ne sait pas lire : ${e.appel}`)
      expect(trouvees, appel).toHaveLength(1)
      noms.set(e.titre, trouvees[0]?.id ?? '')
      continue
    }
    if (e.genre !== 'fait' && e.genre !== 'controle') continue
    const base = e.code === 'OK' ? 'OK' : `${e.code} ${e.attendu}`

    // Un déplacement de pièce ou de document, précédé ou non d'une consignation : la garde des sources.
    const dep = /^(?:select (consigner_au_dossier_permanent\([\s\S]*\)); )?update (pieces|documents_divers) set dossier_id = '\{A\}' where id = '\{(\w+)\}'$/.exec(e.appel)
    if (dep) {
      const [, consignation, table, nom] = dep
      let lignes = entrees
      if (consignation !== undefined) {
        const appel = appelsDe(`select ${consignation}`)?.[0]
        if (appel === undefined) throw new Error(`Consignation que le test ne sait pas lire : ${consignation}`)
        const v = appel.arguments.map(valeur)
        const citation = v[4] as { piece_id?: string; document_id?: string } | null
        lignes = [...entrees, {
          id: nouvelId(), dossier_id: String(v[0]), nature: String(v[1]) as NatureDossierPermanent, titre: String(v[2]),
          piece_id: citation?.piece_id ?? null, document_id: citation?.document_id ?? null, remplace_id: texteDe(v[7]), retire_le: null,
        }]
      }
      const id = noms.get(nom) as string
      const source = table === 'pieces' ? { pieceId: id } : { documentId: id }
      deplacements.push({ etape: e, base, message: refusDuRetraitDUneSourceCitee(source, 'changement-de-dossier', { decisions, preuves }, lignes) })
      continue
    }

    const appels = appelsDe(e.appel)
    // Une écriture directe juge la garde et les contraintes, pas le module.
    if (appels == null) continue
    const fait = e.genre === 'fait'
    // Une étape `fait` doit passer : sinon le jeu rejoué ne serait plus celui de la base.
    if (fait) expect(e.code, e.titre).toBe('OK')
    // Les appels d'une même étape se voient les uns les autres ; un contrôle s'annule à la fin.
    let etat = entrees
    for (const { fonction, arguments: brut } of appels) {
      const v = brut.map(valeur)
      const dossier = String(v[0])
      if (fonction === 'consigner_au_dossier_permanent') {
        expect(v, e.titre).toHaveLength(8)
        const a: ArgumentsConsigner = {
          p_dossier_id: dossier, p_nature: texteDe(v[1]), p_titre: texteDe(v[2]), p_texte: texteDe(v[3]), p_citation: v[4],
          p_valable_du: texteDe(v[5]), p_valable_jusqu_au: texteDe(v[6]), p_remplace_id: texteDe(v[7]),
        }
        const refus = refusDeConsigner(a, {
          accesAuDossier: acces(e.profil, dossier), entrees: etat, pieces: idsDe(pieces, dossier), documents: idsDe(documents, dossier),
        })
        rejeux.push({ etape: e, fonction, base, cle: refus?.cle ?? 'OK', code: refus?.code ?? null, message: refus?.message ?? null })
        if (refus === null) {
          const citation = v[4] as { piece_id?: string; document_id?: string } | null
          etat = [...etat, {
            id: nouvelId(), dossier_id: dossier, nature: a.p_nature as NatureDossierPermanent, titre: String(a.p_titre),
            piece_id: citation?.piece_id ?? null, document_id: citation?.document_id ?? null, remplace_id: a.p_remplace_id, retire_le: null,
          }]
        }
      } else if (fonction === 'retirer_du_dossier_permanent') {
        expect(v, e.titre).toHaveLength(2)
        const refus = refusDeRetirer({ p_dossier_id: dossier, p_entree_id: texteDe(v[1]) }, { accesAuDossier: acces(e.profil, dossier), entrees: etat })
        rejeux.push({ etape: e, fonction, base, cle: refus?.cle ?? 'OK', code: refus?.code ?? null, message: refus?.message ?? null })
        if (refus === null) etat = etat.map((x) => (x.id === v[1] ? { ...x, retire_le: RETIRE } : x))
      } else throw new Error(`Fonction que le test ne sait pas rejouer : ${fonction}`)
    }
    if (fait) entrees = etat
  }
  return { rejeux, deplacements }
}

// Le module dit-il ce que la base a dit ? Un refus à son code et à ses mots ; l'anonyme, que la base arrête avant la
// fonction (« permission denied »), à son code seulement.
function concorde(r: Rejeu): boolean {
  if (r.cle === 'OK') return r.base === 'OK'
  if (!r.base.startsWith(`${r.code} `)) return false
  return r.etape.profil === 'anon' ? r.cle === 'acces' : commeLaBase(r.base.slice(`${r.code} `.length), r.message)
}

function concordeDeplacement(d: Deplacement): boolean {
  if (d.message === null) return d.base === 'OK'
  return d.base.startsWith('23514 ') && commeLaBase(d.base.slice('23514 '.length), d.message)
}

describe('l’essai joué sur la réplique, rejoué appel par appel', () => {
  let rejeux: Rejeu[] = []
  let deplacements: Deplacement[] = []
  // Le rejeu se paie une fois ; un test qui dépasserait son délai sous la charge ne jugerait rien.
  beforeAll(() => {
    ({ rejeux, deplacements } = rejouer(ESSAI))
  }, 60_000)
  const de = (fonction: string) => rejeux.filter((r) => r.fonction === fonction)

  it('le module dit ce que la base a dit, à chaque appel', () => {
    expect(rejeux.length).toBeGreaterThan(0)
    for (const r of rejeux) expect(concorde(r), `${r.etape.titre} : la base « ${r.base} », le module « ${r.cle} »`).toBe(true)
  })

  it('rejoue tous les appels aux deux fonctions des étapes qui ne sont faites que d’appels', () => {
    // Compté dans le texte de l'essai, sans le lire comme le rejeu.
    const ecrits = (fonction: string) => etapesDe(ESSAI)
      .filter((e) => (e.genre === 'fait' || e.genre === 'controle') && appelsDe(e.appel) !== null)
      .reduce((n, e) => n + (e.appel.match(new RegExp(`\\b${fonction}\\(`, 'g'))?.length ?? 0), 0)
    for (const f of ['consigner_au_dossier_permanent', 'retirer_du_dossier_permanent']) expect(de(f), f).toHaveLength(ecrits(f))
    expect([de('consigner_au_dossier_permanent').length, de('retirer_du_dossier_permanent').length]).toEqual([103, 14])
  })

  it('des acceptés, des accès refusés, des introuvables, sur chaque fonction', () => {
    const compte = (f: string, ...cles: string[]) => de(f).filter((r) => cles.includes(r.cle)).length
    expect([compte('consigner_au_dossier_permanent', 'OK'), compte('consigner_au_dossier_permanent', 'acces')]).toEqual([40, 8])
    expect([compte('retirer_du_dossier_permanent', 'OK'), compte('retirer_du_dossier_permanent', 'acces'),
      compte('retirer_du_dossier_permanent', 'introuvable')]).toEqual([4, 5, 3])
  })

  it('chaque refus que l’écran peut dire a été rendu au moins une fois par la base', () => {
    const vus = (f: string) => new Set(de(f).map((r) => r.cle))
    expect(REFUS_CONSIGNATION.map((r) => r.cle).filter((c) => !vus('consigner_au_dossier_permanent').has(c))).toEqual([])
    expect(REFUS_RETRAIT.map((r) => r.cle).filter((c) => !vus('retirer_du_dossier_permanent').has(c))).toEqual([])
  })

  it('la garde des sources : pour chaque déplacement que l’essai tente, le module redit la base', () => {
    expect(deplacements.map((d) => d.etape.numero)).toEqual([
      '130', '131', '132', '133', '134', '135', '136', '138a', '138b', '138c', '138d', '138e', '138f', '138g', '138h',
    ])
    for (const d of deplacements) {
      expect(concordeDeplacement(d), `${d.etape.titre} : la base « ${d.base} », le module « ${d.message} »`).toBe(true)
    }
  })

  it('un message réécrit dans l’essai, un accepté devenu refus : le rejeu les voit', () => {
    const planter = (avant: string, apres: string) => {
      expect(ESSAI.split(avant)).toHaveLength(2)
      const r = rejouer(ESSAI.replace(avant, apres))
      return [...r.rejeux.filter((x) => !concorde(x)), ...r.deplacements.filter((x) => !concordeDeplacement(x))].map((x) => x.etape.numero)
    }
    expect(planter("'22023', 'Cette entrée est déjà retirée.'],", "'22023', 'Cette entrée est retirée.'],")).toEqual(['76'])
    expect(planter("repeat('t', 500), 'Texte.', null, null, null, null)$q$, 'OK', ''],",
      "repeat('t', 501), 'Texte.', null, null, null, null)$q$, 'OK', ''],")).toEqual(['19'])
    expect(planter("(contrat d''emprunt) : elle ne change", "(contrat) : elle ne change")).toEqual(['138f'])
  })
})
