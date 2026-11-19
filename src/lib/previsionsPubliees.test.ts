import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { motsDuCabinet } from './espaceVentes'
import { TRESORERIE_A_90_JOURS_OFFERTE } from './tresorerieClient'
import { calculerPlanTresorerieAu, dateDuDepart, type LigneBanquePourPlan } from './planTresorerie'
import {
  avertissementDuRaccord, CE_QUE_LE_CLIENT_LIT, composerLaPrevision, joursDuRaccord, raccordDepasseUnMois, confirmationDeLaPublication, confirmationDuRetrait, contenuLu, memesMois,
  moisLePlusBas, NON_COMPTE_PREVISION_A_PART, nonComptesSelonLaPrevision, periodeDuRaccordEnLettres, phraseDeLaPublication,
  phraseDesMoisPasses, phraseDuDepart, phraseDuMoisLePlusBas, phraseDUnePrevisionPassee, phraseDuRaccord, phraseDuRythme,
  PREVISION_AUCUNE, PREVISION_CONTENU_ILLISIBLE, PREVISION_ESPECES, PREVISION_ILLISIBLE, PREVISION_MOT, PREVISION_PAS_UN_ENGAGEMENT,
  PREVISION_SANS_BANQUE, PREVISION_TITRE, previsionAMontrer, previsionEnCours, previsionsEnCours, PREVISIONS_PUBLIEES_PREVUES,
  REFUS_DU_MODULE, REFUS_PREVISION, type ContenuDeLaPrevision, type EntreeDeLaPrevision, type PrevisionPubliee,
} from './previsionsPubliees'

// LA PRÉVISION DE TRÉSORERIE PUBLIÉE (C8-Q2) : la composition du contenu que la base fige, confrontée au plan de l'onglet
// Financement ; ses refus, confrontés au texte de la migration préparée ; sa relecture par le client ; ce que les deux écrans
// en disent. L'essai de la base : supabase/essais/previsionsPubliees.sql, sur une réplique.

const MIGRATION = 'supabase/schema/20261118154124_previsions_publiees.sql'
const RETOUR = 'supabase/preparees/retour/20261115100100_retour_previsions_publiees.sql'
const ESSAI = 'supabase/essais/previsionsPubliees.sql'
const texte = readFileSync(resolve(process.cwd(), MIGRATION), 'utf8')
const texteDeLEssai = readFileSync(resolve(process.cwd(), ESSAI), 'utf8')

/** Un contenu à jour fixe de l'essai de la base (`fixe_<nom> constant jsonb := '…';`), que la base a jugé. */
function contenuFixe(nom: string): unknown {
  const m = new RegExp(`fixe_${nom} constant jsonb := '([^']*)';`).exec(texteDeLEssai)
  if (!m) throw new Error(`fixe_${nom} absent de l'essai`)
  return JSON.parse(m[1])
}

const ligne = (date: string, sens: 'debit' | 'credit', montant: number): LigneBanquePourPlan => ({ date, sens, montant })

// Six mois complets (mai à octobre 2026) d'un rythme régulier, un mois sans mouvement (juillet), et deux écritures de
// novembre : le départ est au 10 novembre.
const RYTHME: LigneBanquePourPlan[] = [
  ligne('2026-05-04', 'debit', 4000), ligne('2026-05-20', 'credit', 1500.5),
  ligne('2026-06-03', 'debit', 3800.25), ligne('2026-06-28', 'credit', 1700),
  ligne('2026-08-05', 'debit', 4200), ligne('2026-08-25', 'credit', 1650.75),
  ligne('2026-09-07', 'debit', 3900), ligne('2026-09-30', 'credit', 1600),
  ligne('2026-10-02', 'debit', 4100.1), ligne('2026-10-31', 'credit', 1580),
  ligne('2026-11-03', 'debit', 900), ligne('2026-11-10', 'credit', 200),
]

function entree(e: Partial<EntreeDeLaPrevision> = {}): EntreeDeLaPrevision {
  return {
    aujourdHui: '2026-11-15', lignesBanque: RYTHME, ouverture: null, lignesDuRythme: RYTHME,
    nbMoisHistorique: 6, nbMoisProjection: 6, avecEspeces: false, ...e,
  }
}

function compose(e: Partial<EntreeDeLaPrevision> = {}): ContenuDeLaPrevision {
  const c = composerLaPrevision(entree(e))
  if (!c.ok) throw new Error(c.refus)
  return c.contenu
}

describe('le drapeau et les fichiers de la migration', () => {
  it('levé (en production depuis le 18/11/2026, 241), la migration dans l’export, son retour gardé, plus rien de préparé', () => {
    expect(PREVISIONS_PUBLIEES_PREVUES).toBe(true)
    expect(existsSync(resolve(process.cwd(), MIGRATION))).toBe(true)
    expect(existsSync(resolve(process.cwd(), RETOUR))).toBe(true)
    expect(existsSync(resolve(process.cwd(), 'supabase/preparees/20261115100000_previsions_publiees.sql'))).toBe(false)
  })

  it('la prévision ne se montre que dans « Ma trésorerie » : levée, la page doit l’être aussi', () => {
    if (PREVISIONS_PUBLIEES_PREVUES) expect(TRESORERIE_A_90_JOURS_OFFERTE).toBe(true)
  })

  it('chaque refus de la base est redit sous ses mots, l’apostrophe doublée dans le texte SQL', () => {
    for (const [nom, mots] of Object.entries(REFUS_PREVISION)) {
      expect(texte, nom).toContain(`'${mots.replace(/'/g, "''")}'`)
    }
  })

  it('la lecture du client passe par la case « Banque », et la prévision en cours la relit', () => {
    expect(texte).toContain("using (client_du_dossier(dossier_id, 'banque') and geste = 'publication' and prevision_publiee_en_cours(id));")
    expect(texte).toContain("(public.admin_du_dossier(s.dossier_id) or public.client_du_dossier(s.dossier_id, 'banque'))")
  })
})

describe('composer la prévision', () => {
  it('le contenu : le jour, le départ à la dernière écriture comptée, le rythme de six mois complets, le raccord, six mois enchaînés', () => {
    const c = compose()
    expect(c.version).toBe(1)
    expect(c.etablie_le).toBe('2026-11-15')
    expect(c.depart).toEqual({ au: '2026-11-10', solde: 1_266_910 })
    expect(c.rythme).toEqual({ debut: '2026-05', fin: '2026-10', mois: 6, mois_observes: 5, encaissements: 333_339, decaissements: 133_854 })
    // Le raccord (C8Q2-Q3) : du 11 au 30 novembre, 20 jours sur 30 du rythme ; décembre part de sa fin.
    expect(c.raccord).toEqual({ du: '2026-11-11', au: '2026-11-30', solde_debut: 1_266_910, encaissements: 222_226, decaissements: 89_236, solde_fin: 1_399_900 })
    expect(c.mois.map((m) => m.mois)).toEqual(['2026-12', '2027-01', '2027-02', '2027-03', '2027-04', '2027-05'])
    expect(c.mois[0].solde_debut).toBe(c.raccord?.solde_fin)
    for (const [i, m] of c.mois.entries()) {
      expect(m.solde_fin).toBe(m.solde_debut + m.encaissements - m.decaissements)
      if (i > 0) expect(m.solde_debut).toBe(c.mois[i - 1].solde_fin)
    }
    expect(Object.keys(c).sort()).toEqual(['avec_especes', 'depart', 'etablie_le', 'mois', 'raccord', 'rythme', 'version'])
    expect(contenuLu(c)).toEqual(c)
  })

  it('LA BASE ET LE MODULE D’ACCORD : le contenu qu’il compose est celui que l’essai de la base a fait juger, au caractère près', () => {
    expect(compose({ nbMoisProjection: 2 })).toEqual(contenuFixe('novembre'))
    for (const nom of ['novembre', 'trois_mois', 'sans_raccord', 'bissextile']) {
      expect(contenuLu(contenuFixe(nom)), nom).toEqual(contenuFixe(nom))
    }
    // Le départ au dernier jour du mois : aucun raccord, les mois d'hier.
    const sans = composerLaPrevision(entree({ aujourdHui: '2026-11-30', lignesBanque: [...RYTHME, ligne('2026-11-30', 'debit', 0)], nbMoisProjection: 1 }))
    expect(sans.ok && sans.contenu.raccord).toBeNull()
    expect(sans.ok && sans.contenu.mois[0].solde_debut).toBe(sans.ok && sans.contenu.depart.solde)
  })

  it('le même plan que l’onglet Financement : ses moyennes, son raccord, ses mois et ses soldes, au centime, sur une batterie', () => {
    for (const nbH of [1, 3, 6, 12, 24]) {
      for (const nbP of [1, 2, 6, 24]) {
        for (const jour of ['2026-11-01', '2026-11-15', '2026-11-30', '2026-12-31', '2027-01-01']) {
          const c = composerLaPrevision(entree({ aujourdHui: jour, nbMoisHistorique: nbH, nbMoisProjection: nbP }))
          const plan = calculerPlanTresorerieAu(RYTHME, c.ok ? c.contenu.depart.solde / 100 : 0, nbH, nbP, `${jour.slice(0, 7)}-01`,
            c.ok ? c.contenu.depart.au : null)
          if (!c.ok) {
            expect(plan.nbLignesObservees, `${nbH} ${nbP} ${jour}`).toBe(0)
            expect(c.refus).toBe(REFUS_PREVISION.sansMouvement)
            continue
          }
          const r = c.contenu.raccord
          expect(r && [r.du, r.au, r.solde_debut / 100, r.encaissements / 100, r.decaissements / 100, r.solde_fin / 100])
            .toEqual(plan.raccord && [plan.raccord.du, plan.raccord.au, plan.raccord.soldeDebut, plan.raccord.encaissements,
              plan.raccord.decaissements, plan.raccord.soldeFin])
          expect(c.contenu.mois.map((m) => m.mois)).toEqual(plan.lignes.map((l) => l.mois))
          expect(c.contenu.mois.map((m) => m.solde_fin / 100)).toEqual(plan.lignes.map((l) => l.soldeFin))
          expect(c.contenu.rythme.encaissements / 100).toBe(plan.moyenneEncaissements)
          expect(c.contenu.rythme.decaissements / 100).toBe(plan.moyenneDecaissements)
          expect(c.contenu.rythme.mois_observes).toBe(plan.nbMoisAvecDonnees)
          expect(contenuLu(c.contenu), `${nbH} ${nbP} ${jour}`).toEqual(c.contenu)
        }
      }
    }
  })

  it('le jour de Paris donne les mois : le 31 décembre, la prévision commence en janvier et le rythme finit en novembre', () => {
    const c = compose({ aujourdHui: '2026-12-31', nbMoisProjection: 2 })
    expect(c.mois.map((m) => m.mois)).toEqual(['2027-01', '2027-02'])
    expect([c.rythme.debut, c.rythme.fin]).toEqual(['2026-06', '2026-11'])
    expect(memesMois(c, ['2027-01', '2027-02'])).toBe(true)
    expect(memesMois(c, ['2026-12', '2027-01'])).toBe(false)
  })

  it('le départ : l’ouverture fait foi à sa date ; une écriture d’avant elle ne compte plus, une écriture à venir non plus', () => {
    const ouverture = { date: '2026-11-01', solde: 1000 }
    const c = compose({ ouverture })
    expect(c.depart).toEqual({ au: '2026-11-10', solde: 100_000 + 90_000 - 20_000 })
    expect(dateDuDepart([ligne('2026-10-31', 'debit', 5)], ouverture, '2026-11-15')).toBe('2026-11-01')
    expect(dateDuDepart([ligne('2026-11-20', 'debit', 5)], null, '2026-11-15')).toBeNull()
    expect(dateDuDepart([], null, '2026-11-15')).toBeNull()
  })

  it('ses refus, avant le clic : les bornes des mois, un solde inconnu, aucun mouvement observé', () => {
    expect(composerLaPrevision(entree({ nbMoisHistorique: 0 }))).toEqual({ ok: false, refus: REFUS_PREVISION.rythme })
    expect(composerLaPrevision(entree({ nbMoisHistorique: 25 }))).toEqual({ ok: false, refus: REFUS_PREVISION.rythme })
    expect(composerLaPrevision(entree({ nbMoisProjection: 0 }))).toEqual({ ok: false, refus: REFUS_PREVISION.mois })
    expect(composerLaPrevision(entree({ nbMoisProjection: 2.5 }))).toEqual({ ok: false, refus: REFUS_PREVISION.mois })
    expect(composerLaPrevision(entree({ lignesBanque: [], lignesDuRythme: [] }))).toEqual({ ok: false, refus: REFUS_DU_MODULE.soldeInconnu })
    expect(composerLaPrevision(entree({ ouverture: { date: '2026-12-01', solde: 5 } }))).toEqual({ ok: false, refus: REFUS_DU_MODULE.soldeInconnu })
    expect(composerLaPrevision(entree({ lignesDuRythme: [ligne('2026-11-03', 'debit', 900)] }))).toEqual({ ok: false, refus: REFUS_PREVISION.sansMouvement })
    expect(composerLaPrevision(entree({ lignesBanque: [ligne('2026-11-03', 'debit', Number.NaN)] }))).toEqual({ ok: false, refus: REFUS_DU_MODULE.montantIllisible })
  })

  it('les espèces de la caisse : dites telles que l’écran les compte', () => {
    expect(compose({ avecEspeces: true }).avec_especes).toBe(true)
    expect(compose().avec_especes).toBe(false)
  })
})

describe('relire une prévision : la forme, et une suite qui s’enchaîne', () => {
  const c = compose()
  const avec = (chemin: (string | number)[], valeur: unknown): unknown => {
    const copie = JSON.parse(JSON.stringify(c)) as Record<string, unknown>
    let o: Record<string | number, unknown> = copie
    for (const k of chemin.slice(0, -1)) o = o[k] as Record<string | number, unknown>
    o[chemin[chemin.length - 1]] = valeur
    return copie
  }

  it('ce qui ne se lit pas se dit illisible, jamais arrondi', () => {
    expect(contenuLu(null)).toBeNull()
    expect(contenuLu({ ...c, version: 2 })).toBeNull()
    expect(contenuLu({ ...c, note: 'texte libre' })).toBeNull()
    expect(contenuLu(avec(['avec_especes'], 'non'))).toBeNull()
    expect(contenuLu(avec(['etablie_le'], '2026-02-30'))).toBeNull()
    expect(contenuLu(avec(['depart', 'au'], '2026-11-16'))).toBeNull()
    expect(contenuLu(avec(['depart', 'solde'], 12.5))).toBeNull()
    expect(contenuLu(avec(['rythme', 'mois_observes'], 0))).toBeNull()
    expect(contenuLu(avec(['rythme', 'fin'], '2026-11'))).toBeNull()
    expect(contenuLu(avec(['rythme', 'encaissements'], -1))).toBeNull()
    expect(contenuLu(avec(['mois', 0, 'mois'], '2026-11'))).toBeNull()
    // Le dernier mois : aucun suivant ne relirait son solde de fin à sa place.
    expect(contenuLu(avec(['mois', c.mois.length - 1, 'solde_fin'], c.mois[c.mois.length - 1].solde_fin + 1))).toBeNull()
    expect(contenuLu(avec(['mois', 2, 'solde_fin'], c.mois[2].solde_fin + 1))).toBeNull()
    expect(contenuLu(avec(['mois', 1, 'encaissements'], c.rythme.encaissements + 1))).toBeNull()
    expect(contenuLu(avec(['mois'], []))).toBeNull()
    expect(contenuLu(c)).toEqual(c)
  })

  it('le raccord se relit comme la base le juge : ce qu’elle refuse sur ses contenus à jour fixe ne se lit pas', () => {
    expect(contenuLu(avec(['raccord'], null))).toBeNull()
    expect(contenuLu(avec(['raccord', 'encaissements'], 222_227))).toBeNull()
    expect(contenuLu(avec(['raccord', 'au'], '2026-11-29'))).toBeNull()
    expect(contenuLu(avec(['raccord', 'du'], '2026-11-10'))).toBeNull()
    expect(contenuLu(avec(['raccord', 'solde_debut'], 1_266_911))).toBeNull()
    expect(contenuLu(avec(['raccord', 'solde_fin'], 1_399_901))).toBeNull()
    expect(contenuLu(avec(['mois', 0, 'solde_debut'], c.depart.solde))).toBeNull()
    const { raccord: _r, ...sansLaCle } = c
    expect(contenuLu(sansLaCle)).toBeNull()
    // Les mutations de l'essai (étapes 60, 61, 63 et 65) : le demi-centime vers le bas, le prorata du seul mois du jour, un
    // raccord là où aucun jour ne reste, un février de 28 jours.
    const muter = (nom: string, chemins: [string[], unknown][]) => {
      const copie = contenuFixe(nom) as Record<string, unknown>
      for (const [chemin, valeur] of chemins) {
        let o = copie
        for (const k of chemin.slice(0, -1)) o = o[k] as Record<string, unknown>
        o[chemin[chemin.length - 1]] = valeur
      }
      return copie
    }
    expect(contenuLu(muter('trois_mois', [[['raccord', 'encaissements'], 833_347], [['raccord', 'solde_fin'], 1_498_712],
      [['mois', '0', 'solde_debut'], 1_498_712], [['mois', '0', 'solde_fin'], 1_698_197]]))).toBeNull()
    expect(contenuLu(muter('trois_mois', [[['raccord', 'encaissements'], 844_459], [['raccord', 'solde_fin'], 1_509_824]]))).toBeNull()
    expect(contenuLu(muter('sans_raccord', [[['raccord'], { du: '2026-12-01', au: '2026-11-30', solde_debut: 1_266_910, encaissements: 0, decaissements: 0, solde_fin: 1_266_910 }]]))).toBeNull()
    expect(contenuLu(muter('bissextile', [[['raccord', 'encaissements'], 85_714], [['raccord', 'decaissements'], 42_857],
      [['raccord', 'solde_fin'], 542_857], [['mois', '0', 'solde_debut'], 542_857]]))).toBeNull()
  })

  it('le mois le plus bas : le raccord compris, sous le mois où il finit ; le premier à égalité', () => {
    expect(moisLePlusBas(c)).toEqual({ mois: '2026-11', solde_debut: 1_266_910, encaissements: 222_226, decaissements: 89_236, solde_fin: 1_399_900 })
    const baisse = { raccord: null, mois: [{ ...c.mois[0], solde_fin: 5 }, { ...c.mois[1], solde_fin: -3 }, { ...c.mois[2], solde_fin: -3 }] }
    expect(moisLePlusBas(baisse).mois).toBe(c.mois[1].mois)
    expect(moisLePlusBas({ ...baisse, raccord: c.raccord }).mois).toBe(c.mois[1].mois)
  })
})

describe('les prévisions en cours, et ce que le client en voit', () => {
  const c = compose()
  const ligneDe = (id: string, geste: 'publication' | 'retrait', remplace: string | null, publiee: string, contenu: unknown = c): PrevisionPubliee => ({
    id, dossier_id: 'd1', geste, contenu: geste === 'retrait' ? null : contenu, remplace_id: remplace, publiee_le: publiee,
  })

  it('en cours : une publication qu’aucune ligne ne cite ; la plus récente d’abord', () => {
    const lignes = [ligneDe('p1', 'publication', null, '2026-11-01T08:00:00Z'), ligneDe('p2', 'publication', 'p1', '2026-11-02T08:00:00Z'),
      ligneDe('r2', 'retrait', 'p2', '2026-11-03T08:00:00Z'), ligneDe('p3', 'publication', null, '2026-11-04T08:00:00Z')]
    expect(previsionsEnCours(lignes).map((l) => l.id)).toEqual(['p3'])
    expect(previsionEnCours(lignes)?.id).toBe('p3')
    expect(previsionEnCours(lignes.slice(0, 3))).toBeNull()
    expect(previsionEnCours([ligneDe('a', 'publication', null, '2026-11-01T08:00:00Z'), ligneDe('b', 'publication', null, '2026-11-02T08:00:00Z')])?.id).toBe('b')
  })

  it('ce que la page montre : rien de publié, un contenu illisible, ses mois passés, tout passé', () => {
    expect(previsionAMontrer([], '2026-11-20')).toEqual({ etat: 'aucune' })
    expect(previsionAMontrer([ligneDe('p1', 'publication', null, '2026-11-15T08:00:00Z', { version: 1 })], '2026-11-20')).toEqual({ etat: 'illisible' })
    const une = [ligneDe('p1', 'publication', null, '2026-11-15T08:00:00Z')]
    expect(previsionAMontrer(une, '2026-11-20')).toEqual({ etat: 'montree', contenu: c, moisPasses: 0 })
    // Le raccord de novembre passé dès décembre, puis décembre et janvier.
    expect(previsionAMontrer(une, '2026-12-01')).toEqual({ etat: 'montree', contenu: c, moisPasses: 1 })
    expect(previsionAMontrer(une, '2027-02-03')).toEqual({ etat: 'montree', contenu: c, moisPasses: 3 })
    expect(previsionAMontrer(une, '2027-06-01')).toEqual({ etat: 'passee', etablieLe: '2026-11-15' })
  })

  it('la ligne « non comptée » de « Ma trésorerie » : la phrase d’hier drapeau baissé, « à part » levé', () => {
    const lignes = [{ cle: 'achats', phrase: 'a', centimes: null }, { cle: 'previsionnel-du-cabinet', phrase: 'hier', centimes: null }]
    expect(nonComptesSelonLaPrevision(lignes, false)).toEqual(lignes)
    expect(nonComptesSelonLaPrevision(lignes, true).map((l) => l.phrase)).toEqual(['a', NON_COMPTE_PREVISION_A_PART])
  })
})

describe('les mots', () => {
  const c = compose({ avecEspeces: true })

  it('la confirmation du cabinet NOMME ce qui part, et dit que c’est une prévision', () => {
    const f = confirmationDeLaPublication(c, null)
    const tout = f.paragraphes.join(' ')
    expect(f.titre).toBe('Publier cette prévision au client ?')
    expect(f.bouton).toBe('Publier')
    for (const attendu of ['15/11/2026', '10/11/2026', '12 669,10', 'mai 2026', 'octobre 2026', '6 mois', 'des mouvements sur 5',
      'décembre 2026', 'mai 2027', 'case « Banque »', 'espèces', 'Le raccord, du 11/11/2026 au 30/11/2026', 'au prorata des jours',
      '2 222,26 € encaissés et 892,36 € payés', 'solde au 30/11/2026, 13 999,00 €', 'décembre 2026 part de ce solde',
      'pas un engagement', 'jamais ajoutée à son point bas', 'ni le nom d’un emprunt', 'Elle se fige']) {
      expect(tout.replace(/ | /g, ' ')).toContain(attendu)
    }
    expect(tout).not.toContain('pas compté')
    // Sans raccord, aucune phrase de raccord.
    const sans = composerLaPrevision(entree({ aujourdHui: '2026-11-30', lignesBanque: [...RYTHME, ligne('2026-11-30', 'debit', 0)] }))
    if (!sans.ok) throw new Error(sans.refus)
    expect(confirmationDeLaPublication(sans.contenu, null).paragraphes.join(' ')).not.toContain('raccord')
    const r = confirmationDeLaPublication(compose(), { publiee_le: '2026-11-02T09:00:00Z' })
    expect(r.titre).toBe('Remplacer la prévision publiée au client ?')
    expect(r.bouton).toBe('Remplacer')
    expect(r.paragraphes.join(' ')).toContain('Elle remplace celle publiée le')
    expect(r.paragraphes.join(' ')).not.toContain('espèces')
    expect(confirmationDuRetrait({ publiee_le: '2026-11-02T09:00:00Z' }).bouton).toBe('Retirer')
  })

  it('ce que dit l’écran du cabinet : le client « Banque », « Ma trésorerie », le mot « prévision », à part', () => {
    expect(CE_QUE_LE_CLIENT_LIT).toContain('« Banque »')
    expect(CE_QUE_LE_CLIENT_LIT).toContain('« Ma trésorerie »')
    expect(CE_QUE_LE_CLIENT_LIT).toContain('« prévision »')
  })

  it('les mots du client tutoient et ne nomment aucun onglet', () => {
    const phrases = [PREVISION_TITRE, PREVISION_MOT, PREVISION_PAS_UN_ENGAGEMENT, PREVISION_AUCUNE, PREVISION_ILLISIBLE,
      PREVISION_CONTENU_ILLISIBLE, PREVISION_SANS_BANQUE, PREVISION_ESPECES, NON_COMPTE_PREVISION_A_PART,
      phraseDeLaPublication(c.etablie_le), phraseDuDepart(c.depart), phraseDuRythme(c.rythme), phraseDuRythme({ ...c.rythme, mois_observes: 6 }),
      phraseDuRaccord(c.raccord!), periodeDuRaccordEnLettres(c.raccord!), phraseDuMoisLePlusBas(c.mois[0]),
      phraseDuMoisLePlusBas({ ...c.mois[0], solde_fin: -100 }), phraseDesMoisPasses(c.etablie_le), phraseDUnePrevisionPassee(c.etablie_le)]
    for (const p of phrases) expect(motsDuCabinet(p), p).toEqual([])
    expect(PREVISION_PAS_UN_ENGAGEMENT).toContain('pas un engagement')
    expect(phraseDuDepart(c.depart)).toContain('10 novembre 2026')
    expect(phraseDuRythme(c.rythme)).toContain('sur 5 de ces 6 mois')
    expect(phraseDuRythme({ ...c.rythme, mois_observes: 6 })).not.toContain('de ces')
    expect(phraseDuMoisLePlusBas({ ...c.mois[0], solde_fin: -100 })).toContain('sous zéro')
    expect(periodeDuRaccordEnLettres(c.raccord!)).toBe('Du 11 novembre 2026 au 30 novembre 2026')
    expect(phraseDuRaccord(c.raccord!).replace(/ | /g, ' ')).toBe('Du 11 novembre 2026 au 30 novembre 2026, après cette dernière '
      + 'écriture, elle compte ce rythme au prorata des jours : 2 222,26 € encaissés et 892,36 € payés.')
  })
})

describe('un raccord de plus d’un mois : un avertissement au cabinet, jamais un refus (C8Q2Q3-Q1)', () => {
  it('« plus d’un mois » : plus de 31 jours civils, bornes comprises', () => {
    expect(joursDuRaccord({ du: '2026-11-01', au: '2026-11-30' })).toBe(30)
    expect(joursDuRaccord({ du: '2026-10-31', au: '2026-11-30' })).toBe(31)
    expect(joursDuRaccord({ du: '2028-02-01', au: '2028-02-29' })).toBe(29)
    expect(raccordDepasseUnMois(null)).toBe(false)
    expect(raccordDepasseUnMois({ du: '2026-10-31', au: '2026-11-30' })).toBe(false)
    expect(raccordDepasseUnMois({ du: '2026-10-30', au: '2026-11-30' })).toBe(true)
    expect(raccordDepasseUnMois({ du: '2026-10-03', au: '2026-11-30' })).toBe(true)
  })

  const jusquAu = (date: string) => RYTHME.filter((l) => l.date <= date)

  it('la banque à jour : rien ; vieille de plus d’un mois : depuis quand, et le relevé à importer d’abord', () => {
    expect(avertissementDuRaccord(compose())).toBeNull()
    expect(avertissementDuRaccord(compose({ lignesBanque: jusquAu('2026-10-31') }))).toBeNull()
    const vieux = compose({ lignesBanque: jusquAu('2026-10-02') })
    expect(vieux.raccord).toMatchObject({ du: '2026-10-03', au: '2026-11-30' })
    expect(avertissementDuRaccord(vieux)).toBe('La banque n’est à jour dans les comptes qu’au 02/10/2026 : le raccord, du '
      + '03/10/2026 au 30/11/2026, compte 59 jours au rythme moyen, plus d’un mois. Importe d’abord le relevé qui suit cette '
      + 'date : la prévision partira d’un solde plus récent. Tu peux aussi la publier telle quelle.')
    // Sans raccord (la banque à jour au dernier jour du mois), aucun avertissement.
    expect(avertissementDuRaccord({ depart: vieux.depart, raccord: null })).toBeNull()
  })

  it('la confirmation le reprend, et seulement alors', () => {
    const vieux = compose({ lignesBanque: jusquAu('2026-10-02') })
    expect(confirmationDeLaPublication(vieux, null).paragraphes).toContain(avertissementDuRaccord(vieux))
    expect(confirmationDeLaPublication(compose(), null).paragraphes.join(' ')).not.toContain('Importe d’abord')
  })
})
