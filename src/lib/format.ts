// Rend un nom unique au sein d'une archive. JSZip écrase silencieusement un chemin déjà pris : rien
// n'est signalé, le fichier précédent disparaît simplement. Partout où plusieurs entrées se rangent
// dans un même ZIP, le nom passe donc par ici, et `utilises` — enrichi au passage — porte la mémoire
// de l'archive entière. Le suffixe `_2`, `_3`… n'apparaît qu'en cas de collision réelle, pour ne pas
// alourdir le cas courant. L'extension est passée à part (« .pdf », ou « » pour un dossier) parce
// qu'elle doit rester en fin de nom : la couper au dernier point découperait « S.A.R.L_Martin ».
export function nomUnique(racine: string, extension: string, utilises: Set<string>): string {
  let nom = `${racine}${extension}`
  for (let n = 2; utilises.has(nom); n += 1) nom = `${racine}_${n}${extension}`
  utilises.add(nom)
  return nom
}

export function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9.]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
}

// Clé de correspondance tiers → catégorie : insensible à la casse/aux espaces pour que
// "EDF", "edf" ou " EDF " retrouvent la même catégorie apprise.
export function normalizeTiers(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, ' ')
}

// Mots qui n'identifient personne : formes juridiques, qualificatifs de lieu, et le bruit que l'OCR
// ramasse autour d'un nom sur une facture. « Restaurant DALLOYAU » et « DALLOYAU » sont le même
// fournisseur ; « CARTE BANCAIRE » n'est pas un fournisseur du tout.
const MOTS_SANS_IDENTITE = new Set([
  'sarl', 'sasu', 'eurl', 'selarl', 'societe', 'entreprise', 'cabinet', 'groupe', 'siege',
  'monsieur', 'madame', 'france', 'paris', 'carte', 'bancaire', 'restaurant', 'client', 'compte',
  'service', 'services', 'facture', 'pour', 'avec', 'dont', 'les', 'des', 'sur',
])

// Recolle les sigles pointés : « C.P.A.M. » devient « cpam », « S.A.R.L. » devient « sarl ».
//
// Sans ça, les points sont aplatis en espaces comme n'importe quelle ponctuation et le sigle explose
// en lettres isolées. Le seuil des quatre caractères, qui existe justement pour refuser les fragments
// (« m », « sa »), les élimine alors toutes — et `cleFournisseur` retient le mot suivant. Une CPAM
// écrite « C.P.A.M. Marseille » rendait donc la clé **« marseille »** : pas une absence de clé, une
// clé FAUSSE, celle d'une ville. Deux sigles différents de la même ville se seraient confondus.
//
// Un point ne compte que s'il suit une lettre seule et qu'une lettre le suit immédiatement : il faut
// au moins deux groupes, et le dernier point est facultatif (l'OCR le perd souvent). Ni « x. y. »
// (espace après le point), ni « www.edf.fr » (trois lettres avant le point) ne sont donc touchés —
// seul le motif propre aux sigles l'est.
const SIGLE_POINTE = /(?:[a-z]\.){2,}[a-z]?/g

// Clé d'identité d'un fournisseur : le premier mot de son nom qui puisse vraiment le désigner.
//
// C'est ce qui permet de reconnaître un même fournisseur à travers les graphies que l'OCR produit.
// Sur un import réel, « Transmedical », « Transmedical / et redevient » et « Transmedical / et
// soigner redevient » — des bouts de slogan recopiés avec le nom — donnaient trois tiers distincts,
// donc trois arbitrages pour dix-sept pièces du même fournisseur. Idem pour « Siège Institut national
// de la propriété industrielle » avec et sans virgule finale.
//
// Quatre caractères au minimum : en dessous un fragment ne désigne rien (« m », « sa »), mais
// descendre plus bas ferait perdre des fournisseurs réels comme « ulys ».
//
// Rend null quand rien dans le nom n'identifie un fournisseur — l'appelant traite alors la pièce
// isolément plutôt que de la regrouper avec d'autres qui n'ont rien à voir.
export function cleFournisseur(tiers: string | null): string | null {
  if (!tiers) return null
  const mots = tiers
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    // Avant l'aplatissement de la ponctuation, jamais après : une fois les points devenus des
    // espaces, plus rien ne distingue un sigle d'une suite de mots d'une lettre.
    .replace(SIGLE_POINTE, (sigle) => sigle.replace(/\./g, ''))
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
  return mots.find((m) => m.length >= 4 && !MOTS_SANS_IDENTITE.has(m)) ?? null
}

export function formatMoney(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '—'
  return value.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })
}

export function formatDate(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('fr-FR')
}

// Année, mois (1-12) et jour d'une date, lus sur le calendrier civil.
//
// `new Date('2026-01-01').getFullYear()` ne rend 2026 qu'à l'est de Greenwich : la chaîne est
// interprétée comme minuit UTC, donc replacée en heure locale elle recule d'un jour dès que le
// décalage est négatif — à New York, ce 1er janvier se lit 31 décembre 2025. Tant que les
// utilisateurs sont en France le résultat est juste par chance, pas par construction ; ces
// fonctions lisent directement les composantes de la chaîne et ne dépendent d'aucun fuseau.
//
// **À réserver aux colonnes `date` de Postgres** (`date_piece`, `echeance`, `date_acquisition`,
// `date_emission`, `date_debut`, `date` des mouvements et des écritures) : une date civile n'a pas
// d'heure, donc pas de fuseau, et c'est bien son libellé qu'il faut lire.
//
// Pour un `created_at` (timestamptz), c'est `anneeLocaleDe` qu'il faut — voir juste en dessous.
export function anneeDe(date: string): number {
  return Number(date.slice(0, 4))
}

// Année d'un horodatage (`created_at`), telle que la voit l'utilisateur.
//
// Un timestamptz désigne un instant, pas une date civile : son année dépend donc légitimement du
// fuseau de qui le regarde. Un dépôt fait le 1er janvier à 00 h 30 à Paris est horodaté
// `2025-12-31T23:30:00Z` ; lire son libellé donnerait 2025, alors que l'utilisateur vient de le
// déposer en 2026 et le cherchera dans les dépôts de cette année-là. Ici, contrairement aux dates
// civiles, passer par `Date` est la bonne réponse et non le piège.
export function anneeLocaleDe(horodatage: string): number {
  return new Date(horodatage).getFullYear()
}

// Date civile (AAAA-MM-JJ) d'un horodatage, telle que la voit l'utilisateur — même raisonnement que
// `anneeLocaleDe`, poussé au jour près.
//
// Sert partout où un `created_at` doit servir de date civile de repli : la date d'une écriture quand
// la pièce n'en porte pas, la date d'acquisition d'une immobilisation. Prendre le libellé UTC
// (`created_at.slice(0, 10)`) daterait de la veille tout ce qui est déposé entre minuit et 1 ou 2 h
// du matin — et pour une écriture déposée dans la nuit du Nouvel An, la rangerait dans l'exercice
// précédent.
export function dateLocaleDe(horodatage: string): string {
  const d = new Date(horodatage)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function moisDe(date: string): number {
  return Number(date.slice(5, 7))
}

export function jourDe(date: string): number {
  return Number(date.slice(8, 10))
}

// Nombre de mois de l'année en cours déjà entièrement terminés (0 en janvier, 8 en septembre...) —
// sert à ne jamais réclamer un relevé bancaire ou une échéance pour le mois en cours, qui vient
// peut-être de commencer (voir DossiersList, ChecklistTab). Avant ce correctif, le mois en cours
// comptait comme "écoulé" dès son premier jour — le 8 septembre signalait déjà septembre comme
// manquant alors que le mois n'était même pas fini.
export function moisEcoulesCetteAnnee(): number {
  return new Date().getMonth()
}

// Ancienneté en langage courant ("il y a 2 h", "hier") pour les fils d'activité des tableaux de bord
// (voir DossiersList, ClientHome) — au-delà d'une semaine la date exacte redevient plus parlante
// qu'un décompte de jours.
export function dateRelative(iso: string): string {
  const heures = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000)
  if (heures < 1) return "à l'instant"
  if (heures < 24) return `il y a ${heures} h`
  const jours = Math.floor(heures / 24)
  if (jours === 1) return 'hier'
  if (jours < 7) return `il y a ${jours} j`
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
}

// Date SQL (AAAA-MM-JJ) d'aujourd'hui vue par l'utilisateur. `new Date().toISOString()` donnerait la
// veille entre minuit et 2 h du matin à Paris (l'instant est alors encore hier en UTC) — de quoi
// dater une facture de la veille pour qui la saisit tard le soir.
export function aujourdHuiSql(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Dernier jour du mois auquel appartient `dateSql`.
export function dernierJourDuMois(dateSql: string): string {
  const [annee, mois] = dateSql.slice(0, 10).split('-').map(Number)
  const jour = new Date(Date.UTC(annee, mois, 0)).getUTCDate()
  return `${dateSql.slice(0, 7)}-${String(jour).padStart(2, '0')}`
}

// Date SQL (AAAA-MM-JJ) du 1er du mois en cours, construite depuis les composantes locales — la
// seule façon sûre de nommer "le mois courant" : passer par `new Date(a, m, 1).toISOString()`
// renverrait le mois précédent dès que le fuseau local est à l'est de Greenwich (le 1er septembre à
// minuit à Paris, c'est le 31 août 22 h en UTC).
export function premierJourDuMoisCourant(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

// Ajoute `n` mois (négatif accepté) à une date SQL en restant dans le calendrier civil, sans jamais
// repasser par un objet Date converti en UTC — deux pièges évités d'un coup :
//   - le décalage de fuseau/heure d'été : `new Date('2026-01-15')` puis `setMonth(+6)` puis
//     `toISOString()` rend le 14 juillet, pas le 15, parce que Paris passe de UTC+1 à UTC+2 ;
//   - le débordement de fin de mois : `setMonth()` transforme le 31 janvier + 1 mois en 3 mars.
// Un jour absent du mois d'arrivée est ramené au dernier jour de ce mois, convention des
// échéanciers de prêt : une mensualité au 31 janvier tombe le 28 février.
export function ajouterMois(dateSql: string, n: number): string {
  const [annee, mois, jour] = dateSql.slice(0, 10).split('-').map(Number)
  const indexMois = mois - 1 + n
  const anneeCible = annee + Math.floor(indexMois / 12)
  const moisCible = ((indexMois % 12) + 12) % 12
  // Jour 0 du mois suivant = dernier jour du mois visé. En UTC, donc insensible au fuseau local.
  const dernierJour = new Date(Date.UTC(anneeCible, moisCible + 1, 0)).getUTCDate()
  const jourCible = Math.min(jour, dernierJour)
  return `${anneeCible}-${String(moisCible + 1).padStart(2, '0')}-${String(jourCible).padStart(2, '0')}`
}

// Ajoute `n` jours (négatif accepté) à une date SQL. Même discipline qu'`ajouterMois` : l'arithmétique
// se fait en UTC, donc ni le fuseau ni le passage à l'heure d'été ne peuvent décaler le résultat d'un
// jour — c'est précisément le genre d'écart d'un jour que ce dépôt a déjà payé trois fois.
export function ajouterJours(dateSql: string, n: number): string {
  const [annee, mois, jour] = dateSql.slice(0, 10).split('-').map(Number)
  const d = new Date(Date.UTC(annee, mois - 1, jour + n))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

// Nombre de dépôts par mois sur les `nbMois` derniers mois (le dernier = mois en cours), dans l'ordre
// chronologique — alimente les tendances des tuiles chiffrées.
export function comptesParMois(datesIso: string[], nbMois: number): number[] {
  const maintenant = new Date()
  const cles = Array.from({ length: nbMois }, (_, i) => {
    const d = new Date(maintenant.getFullYear(), maintenant.getMonth() - (nbMois - 1 - i), 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
  const compteurs = new Map(cles.map((c) => [c, 0]))
  for (const iso of datesIso) {
    // Les clés ci-dessus énumèrent des mois locaux : ranger les dépôts par leur libellé UTC
    // attribuerait au mois précédent tout ce qui est déposé le 1er entre minuit et 1 ou 2 h.
    const cle = dateLocaleDe(iso).slice(0, 7)
    const actuel = compteurs.get(cle)
    if (actuel !== undefined) compteurs.set(cle, actuel + 1)
  }
  return cles.map((c) => compteurs.get(c) ?? 0)
}

export const CATEGORIE_LABELS: Record<string, string> = {
  achat: 'Achat',
  vente: 'Vente',
  note_frais: 'Note de frais',
  autre: 'Autre',
}
