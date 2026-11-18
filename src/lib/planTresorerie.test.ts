import { describe, expect, it } from 'vitest'
import {
  calculerPlanTresorerie, calculerPlanTresorerieAu, dateDuDepart, echeancesCotisations, echeancesEmprunts, partDuRythme, periodeDuRaccord,
  reserveSurMoyenne, reserveSurSolde, soldeBanqueADate, type LigneBanquePourPlan,
} from './planTresorerie'
import { ajouterJours, ajouterMois, dernierJourDuMois, premierJourDuMoisCourant } from './format'
import { entierTire, tirage } from '../test/encaissementsBatterie'
import type { Emprunt } from './emprunts'
import type { CotisationDeclaree } from './types'
import type { PlanTresorerie } from './planTresorerie'

const moisCourant = () => premierJourDuMoisCourant()
const cleMois = (decalage: number) => ajouterMois(moisCourant(), decalage).slice(0, 7)

describe('calculerPlanTresorerie', () => {
  it('démarre la projection au mois suivant, pas au mois en cours', () => {
    // Le mois en cours est exclu par construction (il n'est pas terminé). L'ancien calcul
    // l'étiquetait pourtant en première ligne : `toISOString()` sur un 1er du mois à minuit
    // heure de Paris rendait le mois précédent.
    const plan = calculerPlanTresorerie([], 10000, 6, 3, null)
    expect(plan.lignes.map((l) => l.mois)).toEqual([cleMois(1), cleMois(2), cleMois(3)])
  })

  it('exclut le mois en cours de la moyenne et inclut la borne basse', () => {
    const lignes: LigneBanquePourPlan[] = [
      { date: moisCourant(), sens: 'debit', montant: 999 },                  // mois en cours → exclu
      { date: ajouterMois(moisCourant(), -6), sens: 'debit', montant: 600 }, // borne basse → inclus
      { date: ajouterMois(moisCourant(), -7), sens: 'debit', montant: 777 }, // trop ancien → exclu
    ]
    expect(calculerPlanTresorerie(lignes, 0, 6, 1, null).moyenneEncaissements).toBe(100)
  })

  it('enchaîne les soldes d’un mois sur l’autre', () => {
    const lignes: LigneBanquePourPlan[] = [
      { date: ajouterMois(moisCourant(), -1), sens: 'debit', montant: 1200 },
      { date: ajouterMois(moisCourant(), -1), sens: 'credit', montant: 600 },
    ]
    const plan = calculerPlanTresorerie(lignes, 5000, 6, 2, null)
    expect(plan.moyenneEncaissements).toBe(200)
    expect(plan.moyenneDecaissements).toBe(100)
    expect(plan.lignes[0]).toMatchObject({ soldeDebut: 5000, soldeFin: 5100 })
    expect(plan.lignes[1]).toMatchObject({ soldeDebut: 5100, soldeFin: 5200 })
  })

  it('reste à zéro sans historique bancaire', () => {
    const plan = calculerPlanTresorerie([], 0, 6, 2, null)
    expect(plan.moyenneEncaissements).toBe(0)
    expect(plan.lignes.every((l) => l.soldeFin === 0)).toBe(true)
  })
})

// CE SUR QUOI LA MOYENNE REPOSE. Le module a toujours eu raison de rendre 0 sans historique — le test
// voisin « reste à zéro sans historique bancaire » le fige. Ce qui manquait est de pouvoir DISTINGUER
// ce zéro-là d'un zéro observé : les deux produisaient le même écran, sur le document qu'un cabinet
// montre à une banque.
describe('ce sur quoi la moyenne repose', () => {
  const ligne = (decalage: number, montant = 100): LigneBanquePourPlan =>
    ({ date: `${cleMois(decalage)}-15`, sens: 'debit', montant })

  it('compte les lignes et les mois RÉELLEMENT servis, pas ceux demandés', () => {
    const plan = calculerPlanTresorerie([ligne(-1), ligne(-1, 50), ligne(-3)], 0, 6, 1, null)
    expect(plan.nbLignesObservees).toBe(3)
    expect(plan.nbMoisAvecDonnees).toBe(2)
    expect(plan.nbMoisHistorique).toBe(6)
  })

  it('ne compte pas ce que la fenêtre écarte', () => {
    // Le mois en cours n'est pas terminé, le -7e est hors fenêtre : ni l'un ni l'autre n'est
    // « observé », sans quoi le compteur promettrait une assiette que la moyenne n'a pas utilisée.
    const plan = calculerPlanTresorerie([ligne(0), ligne(-7), ligne(-2)], 0, 6, 1, null)
    expect(plan.nbLignesObservees).toBe(1)
    expect(plan.nbMoisAvecDonnees).toBe(1)
  })

  it('LAISSE LE DIVISEUR AUX MOIS DEMANDÉS', () => {
    // Garde délibéré, et c'est la moitié du correctif : un mois calme est un VRAI zéro. Diviser par
    // les seuls mois servis ferait d'un cabinet en congés un cabinet deux fois plus actif — on dit
    // l'assiette, on ne la corrige pas.
    const plan = calculerPlanTresorerie([ligne(-1, 600)], 0, 6, 1, null)
    expect(plan.moyenneEncaissements).toBe(100)
  })
})

describe('reserveSurMoyenne', () => {
  const plan = (o: Partial<PlanTresorerie>): PlanTresorerie => ({
    moyenneEncaissements: 0, moyenneDecaissements: 0, nbMoisHistorique: 6,
    nbLignesObservees: 0, nbMoisAvecDonnees: 0, raccord: null, lignes: [], ...o,
  })

  it('se tait quand tous les mois demandés sont servis', () => {
    // Une mise en garde permanente cesse d'être lue, puis emporte ses voisines dans son discrédit.
    expect(reserveSurMoyenne(plan({ nbLignesObservees: 12, nbMoisAvecDonnees: 6 }))).toBeNull()
  })

  it('dit que la moyenne ne repose sur RIEN quand aucun mouvement n’a été lu', () => {
    const texte = reserveSurMoyenne(plan({}))
    expect(texte).toContain('ne repose sur rien')
    // Le zéro est une AFFIRMATION tant que personne ne dit qu'il n'a rien été lu.
    expect(texte).toContain('0,00 € ne veut pas dire')
    // Et la cause est actionnable : un relevé importé ne produit aucune écriture à lui seul.
    expect(texte).toContain('écritures générées')
  })

  it('distingue « rien lu » de « lu sur une partie » — jamais la même conséquence', () => {
    const partiel = reserveSurMoyenne(plan({ nbLignesObservees: 4, nbMoisAvecDonnees: 2 }))
    expect(partiel).toContain('2 de ces 6 mois')
    expect(partiel).toContain('sous-estimée')
    // Garde symétrique : la conséquence de l'un ne doit pas s'afficher sur l'autre.
    expect(partiel).not.toContain('ne repose sur rien')
    expect(reserveSurMoyenne(plan({}))).not.toContain('sous-estimée')
  })

  it('accorde le singulier quand il ne manque qu’un mois', () => {
    const texte = reserveSurMoyenne(plan({ nbLignesObservees: 9, nbMoisAvecDonnees: 5 }))
    expect(texte).toContain('le mois restant compte')
    expect(texte).not.toContain('mois restants comptent')
  })
})

describe('reserveSurSolde', () => {
  it('se tait dès qu’une écriture bancaire existe', () => {
    // Même sur une seule ligne : le solde est alors un vrai solde, et une mise en garde permanente
    // cesserait d'être lue.
    expect(reserveSurSolde([{ date: '2026-01-15', sens: 'debit', montant: 1 }], null, '2026-06-30')).toBeNull()
  })

  it('dit que « 0,00 € » n’est pas « zéro à la banque »', () => {
    const texte = reserveSurSolde([], null, '2026-06-30')
    expect(texte).toContain("n'est pas")
    expect(texte).toContain('rien de comptabilisé')
    expect(texte).toContain('écritures générées')
  })

  it('NE REGARDE PAS LA MÊME FENÊTRE QUE LA MOYENNE', () => {
    // Un dossier peut avoir un solde parfaitement juste et une moyenne qui ne repose sur rien : les
    // écritures existent, mais toutes en dehors des mois que la moyenne regarde. Fondre les deux
    // réserves ferait taire celle du solde ou crier celle de la moyenne.
    const vieille: LigneBanquePourPlan[] = [{ date: `${cleMois(-24)}-15`, sens: 'debit', montant: 500 }]
    expect(reserveSurSolde(vieille, null, `${cleMois(0)}-01`)).toBeNull()
    expect(reserveSurMoyenne(calculerPlanTresorerie(vieille, 0, 6, 1, null))).toContain('ne repose sur rien')
  })

  it('se tait sur un dossier ouvert par des à-nouveaux, même SANS aucune écriture', () => {
    // Une banque soldée à la reprise est un zéro CONNU : « rien de comptabilisé » serait faux.
    expect(reserveSurSolde([], { date: '2026-01-01', solde: 0 }, '2026-06-30')).toBeNull()
    expect(reserveSurSolde([], { date: '2026-01-01', solde: 0 }, '2026-01-01')).toBeNull()
  })

  it('dit qu’avant l’ouverture, aucun solde de départ n’est connu', () => {
    const texte = reserveSurSolde(
      [{ date: '2025-11-15', sens: 'debit', montant: 100 }], { date: '2026-01-01', solde: 4000 }, '2025-12-31',
    )
    expect(texte).toContain("précède l'ouverture du dossier (01/01/2026)")
    expect(texte).toContain('aucun solde')
  })
})

describe('soldeBanqueADate', () => {
  const lignes: LigneBanquePourPlan[] = [
    { date: '2025-12-20', sens: 'debit', montant: 700 },
    { date: '2026-01-01', sens: 'credit', montant: 50.1 },
    { date: '2026-02-10', sens: 'debit', montant: 1000.2 },
    { date: '2026-03-05', sens: 'credit', montant: 300 },
  ]

  it('cumule tout l’historique quand rien n’ouvre le dossier', () => {
    expect(soldeBanqueADate(lignes, null, '2026-02-28')).toBe(1650.1)
    expect(soldeBanqueADate(lignes, null, '2026-12-31')).toBe(1350.1)
  })

  it('part du solde repris, et une écriture ANTÉRIEURE à l’ouverture n’est plus comptée', () => {
    // Les 700 € de décembre sont déjà dans les 4 000 € repris : les ajouter les compterait deux fois.
    const ouverture = { date: '2026-01-01', solde: 4000 }
    expect(soldeBanqueADate(lignes, ouverture, '2026-02-28')).toBe(4950.1)
    expect(soldeBanqueADate(lignes, ouverture, '2026-12-31')).toBe(4650.1)
  })

  it('compte l’écriture du JOUR de l’ouverture : un mouvement de ce jour suit le solde de la veille', () => {
    expect(soldeBanqueADate(lignes, { date: '2026-01-01', solde: 4000 }, '2026-01-01')).toBe(3949.9)
  })

  it('retombe sur le cumul avant l’ouverture, faute de solde de départ connu', () => {
    expect(soldeBanqueADate(lignes, { date: '2026-01-01', solde: 4000 }, '2025-12-31')).toBe(700)
  })

  it('rend le solde repris tel quel sur un dossier sans aucune écriture', () => {
    expect(soldeBanqueADate([], { date: '2026-01-01', solde: -1234.56 }, '2026-06-30')).toBe(-1234.56)
  })

  it('compte en centimes : pas de dérive de flottant', () => {
    const dixCentimes: LigneBanquePourPlan[] = Array.from({ length: 3 }, (_, i) => ({ date: `2026-01-0${i + 2}`, sens: 'debit' as const, montant: 0.1 }))
    expect(soldeBanqueADate(dixCentimes, { date: '2026-01-01', solde: 0.2 }, '2026-01-31')).toBe(0.5)
  })
})

describe('échéances connues', () => {
  const pret: Emprunt = {
    id: 'e1', dossier_id: 'd1', nom: 'Matériel', organisme_preteur: null,
    capital_initial: 12000, taux_annuel: 3, date_debut: '2026-01-31', duree_mois: 24,
    created_at: '2026-01-01T00:00:00Z',
  }

  it('ne retient que les échéances d’emprunt de la période demandée', () => {
    const echeances = echeancesEmprunts([pret], '2026-04-01', '2026-06-30')
    expect(echeances.map((e) => e.date)).toEqual(['2026-04-30', '2026-05-31', '2026-06-30'])
    expect(echeances.every((e) => e.libelle.includes('Matériel'))).toBe(true)
  })

  it('ignore un emprunt pas encore commencé', () => {
    expect(echeancesEmprunts([pret], '2025-01-01', '2025-06-30')).toEqual([])
  })

  it('ne retient que les cotisations non versées de la période', () => {
    const cotisations = [
      { id: 'c1', dossier_id: 'd1', echeance: '2026-05-05', montant_appele: 300, montant_verse: null },
      { id: 'c2', dossier_id: 'd1', echeance: '2026-05-20', montant_appele: 400, montant_verse: 400 }, // déjà payée
      { id: 'c3', dossier_id: 'd1', echeance: '2026-09-05', montant_appele: 500, montant_verse: null }, // hors période
    ] as CotisationDeclaree[]
    const echeances = echeancesCotisations(cotisations, '2026-04-01', '2026-06-30')
    expect(echeances).toHaveLength(1)
    expect(echeances[0]).toMatchObject({ date: '2026-05-05', montant: 300 })
  })
})

// LE MOIS DE RACCORD (C8Q2-Q3, la réponse (B) du cabinet du 18/11/2026) : du lendemain de la dernière écriture de banque à
// la fin du mois en cours, le rythme moyen au prorata des jours de chaque mois. Les montants de ces cas sont ceux des
// contenus à jour fixe de supabase/essais/previsionsPubliees.sql, que la base a jugés.
describe('le mois de raccord', () => {
  // LE PLAN D'HIER, recopié tel qu'il était avant le raccord (git, 18/11/2026) : l'oracle de « rien ne change là où le
  // raccord ne joue pas ».
  function planDHier(lignesBanque: readonly LigneBanquePourPlan[], soldeActuel: number, nbH: number, nbP: number, premier: string) {
    const debutHistorique = ajouterMois(premier, -nbH)
    const dansHistorique = lignesBanque.filter((l) => l.date >= debutHistorique && l.date < premier)
    const totalE = dansHistorique.filter((l) => l.sens === 'debit').reduce((s, l) => s + l.montant, 0)
    const totalD = dansHistorique.filter((l) => l.sens === 'credit').reduce((s, l) => s + l.montant, 0)
    const moyenneEncaissements = Math.round((totalE / nbH) * 100) / 100
    const moyenneDecaissements = Math.round((totalD / nbH) * 100) / 100
    const nbMoisAvecDonnees = new Set(dansHistorique.map((l) => l.date.slice(0, 7))).size
    const lignes = []
    let soldeCourant = soldeActuel
    for (let i = 1; i <= nbP; i++) {
      const soldeDebut = soldeCourant
      const soldeFin = Math.round((soldeDebut + moyenneEncaissements - moyenneDecaissements) * 100) / 100
      lignes.push({ mois: ajouterMois(premier, i).slice(0, 7), soldeDebut, encaissements: moyenneEncaissements, decaissements: moyenneDecaissements, soldeFin })
      soldeCourant = soldeFin
    }
    return { moyenneEncaissements, moyenneDecaissements, nbMoisHistorique: nbH, nbLignesObservees: dansHistorique.length, nbMoisAvecDonnees, lignes }
  }

  it('ses jours : du lendemain du départ au dernier jour du mois en cours ; aucun, rien', () => {
    expect(periodeDuRaccord('2026-11-10', '2026-11-01')).toEqual({ du: '2026-11-11', au: '2026-11-30' })
    // L'exemple de la question : le 15 novembre, une dernière écriture du 31 octobre — tout novembre.
    expect(periodeDuRaccord('2026-10-31', '2026-11-01')).toEqual({ du: '2026-11-01', au: '2026-11-30' })
    expect(periodeDuRaccord('2026-09-15', '2026-11-01')).toEqual({ du: '2026-09-16', au: '2026-11-30' })
    expect(periodeDuRaccord('2028-02-05', '2028-02-01')).toEqual({ du: '2028-02-06', au: '2028-02-29' })
    expect(periodeDuRaccord('2026-12-31', '2026-12-01')).toBeNull()
    expect(periodeDuRaccord('2026-11-30', '2026-11-01')).toBeNull()
  })

  it('sa part : le prorata des jours de chaque mois, arrondi au centime, le demi-centime vers le haut — les cas que la base a jugés', () => {
    expect(partDuRythme(333_339, '2026-11-11', '2026-11-30')).toBe(222_226)
    expect(partDuRythme(133_854, '2026-11-11', '2026-11-30')).toBe(89_236)
    // 15 jours sur 30 de septembre (166 669,5 : 166 670), puis octobre et novembre entiers.
    expect(partDuRythme(333_339, '2026-09-16', '2026-11-30')).toBe(833_348)
    expect(partDuRythme(133_854, '2026-09-16', '2026-11-30')).toBe(334_635)
    // Février 2028 : 24 jours sur 29.
    expect(partDuRythme(100_000, '2028-02-06', '2028-02-29')).toBe(82_759)
    expect(partDuRythme(50_000, '2028-02-06', '2028-02-29')).toBe(41_379)
    expect(partDuRythme(1, '2026-11-01', '2026-11-15')).toBe(1)
    expect(partDuRythme(1, '2026-12-01', '2026-12-15')).toBe(0)
    expect(partDuRythme(-1, '2026-11-01', '2026-11-15')).toBe(-1)
    expect(partDuRythme(333_339, '2026-12-01', '2026-11-30')).toBe(0)
    expect(partDuRythme(1.5, '2026-11-01', '2026-11-30')).toBeNaN()
  })

  it('un mois couvert en entier compte le rythme exact, de 2000 à 2100, jusqu’au plafond de la base', () => {
    const suivant = tirage(181126)
    for (let n = 0; n < 1200; n++) {
      const premier = ajouterMois('2000-01-01', entierTire(suivant, 1212))
      const rythme = n % 3 === 0 ? 99_999_999_999_999 : entierTire(suivant, 1_000_000_000)
      expect(partDuRythme(rythme, premier, dernierJourDuMois(premier)), premier).toBe(rythme)
    }
  })

  it('la même part qu’un calcul jour par jour, sur une batterie tirée d’une graine fixe', () => {
    const suivant = tirage(4_181_126)
    for (let n = 0; n < 3000; n++) {
      const du = ajouterJours('2025-01-01', entierTire(suivant, 900))
      const au = ajouterJours(du, entierTire(suivant, 120))
      const rythme = entierTire(suivant, 2_000_000_000)
      // Un mois à la fois : ses jours comptés un par un, puis l'arrondi de Math.round (le demi vers le haut, exact à ces tailles).
      let attendu = 0
      let jour = du
      while (jour <= au) {
        const fin = dernierJourDuMois(jour)
        let jours = 0
        while (jour <= au && jour <= fin) { jours++; jour = ajouterJours(jour, 1) }
        attendu += Math.round(rythme * jours / Number(fin.slice(8, 10)))
      }
      expect(partDuRythme(rythme, du, au), `${rythme} ${du} ${au}`).toBe(attendu)
    }
  })

  it('l’exemple de la question : le 15 novembre, partie du 31 octobre, novembre entier au rythme, et décembre part de sa fin', () => {
    const lignes = [1, 2, 3, 4, 5, 6].flatMap((d): LigneBanquePourPlan[] => [
      { date: `${ajouterMois('2026-11-01', -d).slice(0, 7)}-10`, sens: 'debit', montant: 600 },
      { date: `${ajouterMois('2026-11-01', -d).slice(0, 7)}-20`, sens: 'credit', montant: 200 },
    ])
    const plan = calculerPlanTresorerieAu(lignes, 5000, 6, 2, '2026-11-01', '2026-10-31')
    expect(plan.raccord).toEqual({ du: '2026-11-01', au: '2026-11-30', soldeDebut: 5000, encaissements: 600, decaissements: 200, soldeFin: 5400 })
    expect(plan.lignes.map((l) => [l.mois, l.soldeDebut, l.soldeFin])).toEqual([['2026-12', 5400, 5800], ['2027-01', 5800, 6200]])
    // Sans raccord, décembre partait du 31 octobre : le défaut que le cabinet a choisi de corriger (C8Q2-Q3).
    expect(planDHier(lignes, 5000, 6, 2, '2026-11-01').lignes[0]).toMatchObject({ mois: '2026-12', soldeDebut: 5000 })
  })

  it('la date du départ : la dernière écriture comptée, l’ouverture faisant foi à sa date', () => {
    const l = (date: string): LigneBanquePourPlan => ({ date, sens: 'debit', montant: 1 })
    expect(dateDuDepart([l('2026-10-31'), l('2026-11-10'), l('2026-11-20')], null, '2026-11-15')).toBe('2026-11-10')
    expect(dateDuDepart([l('2026-10-31')], { date: '2026-11-01', solde: 3 }, '2026-11-15')).toBe('2026-11-01')
    expect(dateDuDepart([], null, '2026-11-15')).toBeNull()
  })

  it('LÀ OÙ LE RACCORD NE JOUE PAS, LE PLAN D’HIER AU CENTIME ; ailleurs, les mois d’hier partis de la fin du raccord', () => {
    const suivant = tirage(18_112_026)
    let avecRaccord = 0
    for (let n = 0; n < 800; n++) {
      const premier = ajouterMois('2026-01-01', entierTire(suivant, 30))
      const lignes: LigneBanquePourPlan[] = Array.from({ length: entierTire(suivant, 60) }, (): LigneBanquePourPlan => ({
        date: ajouterJours(ajouterMois(premier, -26), entierTire(suivant, 820)),
        sens: entierTire(suivant, 2) === 0 ? 'debit' : 'credit',
        montant: entierTire(suivant, 1_000_000) / 100,
      }))
      const solde = (entierTire(suivant, 4_000_000) - 2_000_000) / 100
      const nbH = 1 + entierTire(suivant, 24)
      const nbP = 1 + entierTire(suivant, 24)
      const hier = planDHier(lignes, solde, nbH, nbP, premier)
      // Le raccord ne joue pas : sans date de départ (les ratios), ou partie du dernier jour du mois en cours.
      expect(calculerPlanTresorerieAu(lignes, solde, nbH, nbP, premier, null)).toEqual({ ...hier, raccord: null })
      expect(calculerPlanTresorerieAu(lignes, solde, nbH, nbP, premier, dernierJourDuMois(premier))).toEqual({ ...hier, raccord: null })
      // Il joue : les moyennes et ce qu'elles observent inchangés ; les mois sont ceux d'hier, partis de la fin du raccord.
      const departAu = ajouterJours(premier, entierTire(suivant, 120) - 90)
      const plan = calculerPlanTresorerieAu(lignes, solde, nbH, nbP, premier, departAu)
      if (departAu >= dernierJourDuMois(premier)) continue
      avecRaccord++
      expect(plan.raccord).not.toBeNull()
      const r = plan.raccord!
      expect([r.du, r.au, r.soldeDebut]).toEqual([ajouterJours(departAu, 1), dernierJourDuMois(premier), solde])
      expect(r.encaissements).toBe(partDuRythme(Math.round(hier.moyenneEncaissements * 100), r.du, r.au) / 100)
      expect(r.soldeFin).toBe(Math.round((solde + r.encaissements - r.decaissements) * 100) / 100)
      expect({ ...plan, raccord: null }).toEqual({ ...planDHier(lignes, r.soldeFin, nbH, nbP, premier), raccord: null })
    }
    // Un plancher : la batterie ne vaut que si le raccord joue sur une bonne part de ses cas.
    expect(avecRaccord).toBeGreaterThan(500)
  })
})
