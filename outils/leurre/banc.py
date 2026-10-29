#!/usr/bin/env python3
"""LE BANC DU LEURRE : ce que rendent les essais de la base rejoués en production, éprouvé sur une RÉPLIQUE (HISTORIQUE.md,
« CE QUE RENDENT LES ESSAIS DE LA BASE REJOUÉS EN PRODUCTION »).

Les essais de supabase/essais/ se rejouent en production après chaque migration, et ce qu'ils rendent — les lignes d'un
SELECT, une NOTICE, un WARNING, le texte d'un refus — entre dans la conversation de la session, donc chez le fournisseur
du modèle. Un essai joué en production ne doit rien rendre qui dépende d'une ligne hors de ses dossiers fictifs : ni
une valeur, ni un compte de toute la base. Le banc le vérifie sur une réplique égale à la production. Chaque essai s'y
rejoue trois fois, en UNE transaction (psql -1), en mode verbeux, chaque fois sur une copie fraîche :
  P  la réplique telle quelle (et le semis de sa famille, s'il en a une) ;
  L  la même, plus quatre dossiers « réels » de leurre, aux valeurs fictives et reconnaissables (leurre.sql ; puis une
     ligne marquée par leurre dans CHAQUE table qui porte `dossier_id`, composée sur le catalogue par le remplisseur ;
     puis leurre_complement.sql et leurre_facture_zero.sql) ;
  D  L, plus un détecteur d'écritures (detecteur.sql), qui dit toute ligne écrite, même dans une transaction annulée.
Un essai est SÛR quand sa sortie L est celle de P (aux normalisations de NORMALISATIONS près, chacune avec sa raison, et
comptées dans le rapport), qu'aucun motif du leurre (regles.json) ne paraît dans P ni dans L, et que D n'écrit aucune
ligne du leurre ; sinon il est en FAUTE, et le rapport dit la ligne.

Il part de TOUT : chaque fichier de supabase/essais se classe par sa forme (regles.json, « replique_seulement ») — un
essai de réplique seulement (la phrase de son en-tête, ou une méta-commande de psql), un outil (.py, .mjs), ou un essai
joué en production, que le banc rejoue ; une autre forme l'arrête. Ce qui ne se rejoue pas sur la réplique telle quelle —
un jeu de départ que la production porte, le super-utilisateur, une migration préparée — est un cas particulier de
regles.json, avec sa raison ; src/lib/essaisEnProduction.test.ts les compte. Ses planchers : la couverture (toute table
de dossier porte une ligne de chacun des trois leurres garnis, sinon le banc s'arrête) ; le témoin (temoin.sql, un essai
fautif planté, que le banc doit voir de ses trois façons avant tout autre, sinon il est aveugle) ; chaque essai joué
jusqu'au bout sur P (une erreur ou ESSAI_IMPOSSIBLE l'arrête, hors d'un attendu de regles.json).

Usage — sur une RÉPLIQUE, jamais en production (la session n'atteint la production que par l'outil MCP) :
  python3 -I outils/leurre/banc.py --sorties <dossier> --modele production=<base> [--modele apres=<port>/<base>]
      [--port 5432] [--hote /var/run/postgresql] [--psql "psql"] [--super postgres] [--proprietaire proprietaire]
      [--travailleurs 3] [--garder] [--essais <dossier>] [essai …]
  python3 -I outils/leurre/banc.py --inventaire [--essais <dossier>]
« production » : une base de la réplique égale à la production (signature.sql le prouve) ; « apres » : la même munie
des migrations préparées que des essais attendent (regles.json les nomme). --essais : un autre dossier d'essais (une
version d'avant, copiée hors du dépôt ; par défaut supabase/essais). --psql : la commande, découpée comme par le
shell (ici : "runuser -u postgres -- /usr/lib/postgresql/16/bin/psql"). Le banc ne crée, ne refait et ne supprime que
des bases nommées banc_leurre_*, sur les grappes données ; il ne modifie pas les modèles. Il rend 0 si tout est SÛR, 1
sur une FAUTE, 2 s'il ne peut pas conclure.
"""
import argparse
import concurrent.futures
import difflib
import json
import os
import re
import shlex
import subprocess
import sys
import threading
import time

ICI = os.path.dirname(os.path.abspath(__file__))
RACINE = os.path.dirname(os.path.dirname(ICI))
ESSAIS = os.path.join(RACINE, 'supabase', 'essais')
REGLES = json.load(open(os.path.join(ICI, 'regles.json'), encoding='utf8'))
PREFIXE = 'banc_leurre_'
MOTIFS = {nom: re.compile(motif, re.I) for nom, motif in REGLES['motifs'].items()}
FIXES = set(REGLES['identifiants_fixes'])
# Les trois dossiers de leurre que le remplisseur garnit (V, le dossier à son premier jour, reste vide) : la lettre, le
# dossier, le préfixe des identifiants tirés pour lui (le plus petit, le plus grand, un milieu : un essai qui prend « le
# premier » ou « le dernier » par identifiant tombe sur un leurre), son montant, son compte client.
LEURRES = [
    ('A', '00000000-0000-4000-8000-00000000a001', '00000000', '7357.31', '7e570000-0000-4000-8000-0000000c0a01'),
    ('Z', 'fffffff0-0000-4000-8000-00000000a002', 'fffffff0', '7357.32', '7e570000-0000-4000-8000-0000000c0a02'),
    ('N', '7e570000-0000-4000-8000-00000000a003', '7e57e000', '7357.33', '7e570000-0000-4000-8000-0000000c0a03'),
]
LEURRE_V = '00000000-0000-4000-8000-00000000a000'
SIRENS = {'A': '999735731', 'Z': '999735749', 'N': '999735756'}


class Arret(Exception):
    """Le banc ne peut pas conclure (code 2)."""


# ── La classification ─────────────────────────────────────────────────────────────────────────────────────────────────

def entete_sql(texte):
    """Le premier paragraphe de l'en-tête d'un fichier SQL — ses lignes de commentaire jusqu'à la première vide (« -- »
    seul) ou à la première instruction —, sans leurs « -- », joint et ramené à un blanc. Le premier paragraphe seulement :
    plus bas, un en-tête parle d'AUTRES essais (« la suppression, sur une réplique seulement, par … », rls.sql)."""
    lignes = []
    for ligne in texte.split('\n'):
        s = ligne.strip()
        if not s.startswith('--') or not s[2:].strip():
            if lignes or (s and not s.startswith('--')):
                break
            continue
        lignes.append(s[2:])
    return ' '.join(' '.join(lignes).split())


def classer(dossier=ESSAIS):
    """Chaque fichier du dossier des essais, par sa forme : (joués en production, {réplique seulement: par quoi}, outils).
    Une autre forme arrête le banc : un fichier qu'il ne sait pas classer, il ne sait pas s'il faut le rejouer."""
    regle = REGLES['replique_seulement']
    phrase = regle['phrase'].upper()
    meta = re.compile(regle['meta_commande'], re.M)
    production, replique, outils = [], {}, []
    for nom in sorted(os.listdir(dossier)):
        chemin = os.path.join(dossier, nom)
        racine, ext = os.path.splitext(nom)
        if os.path.isdir(chemin):
            raise Arret(f'supabase/essais/{nom} : un dossier, que le banc ne sait pas classer')
        if ext in ('.py', '.mjs'):
            outils.append(nom)
            continue
        if ext != '.sql':
            raise Arret(f'supabase/essais/{nom} : une forme que le banc ne sait pas classer')
        texte = open(chemin, encoding='utf8').read()
        if phrase in entete_sql(texte).upper():
            replique[racine] = 'son en-tête'
        elif meta.search(texte):
            replique[racine] = 'une méta-commande de psql'
        else:
            production.append(racine)
    return production, replique, outils


def particuliers(production):
    """Les cas particuliers de regles.json, vérifiés : chacun nomme un essai joué en production, et porte sa raison."""
    cas = REGLES['particuliers']
    for essai, c in cas.items():
        if essai not in production:
            raise Arret(f'regles.json : le cas particulier « {essai} » ne nomme aucun essai joué en production')
        if not c.get('raison'):
            raise Arret(f'regles.json : le cas particulier « {essai} » ne dit pas sa raison')
        if c.get('role', 'proprietaire') not in ('proprietaire', 'super'):
            raise Arret(f'regles.json : le rôle de « {essai} » est inconnu')
    return cas


# ── La réplique ───────────────────────────────────────────────────────────────────────────────────────────────────────

class Grappe:
    """Une grappe de la réplique, par psql : le super-utilisateur pour le leurre, les semis et la copie des bases ; le
    propriétaire des tables pour les essais, comme la production les joue."""

    def __init__(self, psql, hote, port, superu, proprietaire):
        self.psql, self.hote, self.port = psql, hote, str(port)
        self.superu, self.proprietaire = superu, proprietaire
        self.libres = []
        self.verrou = threading.Lock()

    def _commande(self, role, base, options):
        return self.psql + ['-h', self.hote, '-p', self.port, '-U', role, '-d', base, '-X', '-q', '-P', 'pager=off',
                            '-A', '-F', '\t'] + options

    def sql(self, base, requete):
        r = subprocess.run(self._commande(self.superu, base, ['-t', '-v', 'ON_ERROR_STOP=1']), input=requete,
                           capture_output=True, text=True)
        if r.returncode != 0:
            raise Arret(f'{self.port}/{base} : {r.stderr.strip()[:2000]}')
        return r.stdout

    def lignes(self, base, requete):
        return [ligne.split('\t') for ligne in self.sql(base, requete).split('\n') if ligne.strip()]

    def jouer(self, base, texte, sortie, role, une_transaction, arret):
        """Joue un texte (passé sur l'entrée standard) ; TOUTE la sortie — lignes, NOTICE, WARNING, erreurs avec leur
        DETAIL en mode verbeux — dans le fichier `sortie`. Rend le code de psql."""
        options = ['-v', 'ON_ERROR_STOP=' + ('1' if arret else '0'), '-v', 'VERBOSITY=verbose']
        if une_transaction:
            options.insert(0, '-1')
        r = subprocess.run(self._commande(role, base, options), input=texte, capture_output=True, text=True)
        with open(sortie, 'w', encoding='utf8') as f:
            f.write(r.stdout)
            f.write(r.stderr)
        return r.returncode

    def creer(self, base, modele):
        if not base.startswith(PREFIXE):
            raise ValueError(f'base protégée : le banc ne crée que des bases {PREFIXE}* ({base})')
        self.sql('postgres', f'drop database if exists {base};')
        self.sql('postgres', f'create database {base} template {modele} owner {self.proprietaire};')

    def jeter(self, base):
        if not base.startswith(PREFIXE):
            raise ValueError(f'base protégée : le banc ne supprime que des bases {PREFIXE}* ({base})')
        self.sql('postgres', f'drop database if exists {base};')

    def bases(self):
        return [b for (b,) in self.lignes('postgres', 'select datname from pg_database order by 1;')]

    def existe(self, base):
        return base in self.bases()


# ── Le leurre ─────────────────────────────────────────────────────────────────────────────────────────────────────────

def jouer_fichier(grappe, base, chemin, sorties, role=None):
    """Un fichier du banc (leurre, semis, détecteur), par le super-utilisateur, arrêté à la première erreur."""
    sortie = os.path.join(sorties, 'montage', f'{base}_{os.path.basename(chemin)}.txt')
    os.makedirs(os.path.dirname(sortie), exist_ok=True)
    code = grappe.jouer(base, open(chemin, encoding='utf8').read(), sortie, role or grappe.superu, False, True)
    if code != 0:
        raise Arret(f'{base} : {os.path.relpath(chemin, RACINE)} a échoué (code {code}) :\n'
                    + open(sortie, encoding='utf8').read()[-2000:])


def _valeur(table, col, typ, x, d, montant, client, cles, listes, colonnes, numero):
    """La valeur d'une colonne pour le leurre x : marquée, reconnaissable, et conforme à ce que la base exige d'elle."""
    if col == 'dossier_id':
        return f"'{d}'"
    if (table, col) in cles:
        cible, ccol = cles[(table, col)]
        if cible == 'auth.users':
            return f"'{client}'"
        if cible == 'public.dossiers':
            return f"'{d}'"
        nom = cible.split('.')[1]
        filtre = f"where dossier_id = '{d}'" if any(c[0] == 'dossier_id' for c in colonnes.get(nom, [])) else ''
        return f'(select {ccol} from {cible} {filtre} order by 1 limit 1)'
    # Les formats que des CHECK imposent, reconnus au nom de la colonne.
    if col == 'statut_tva':
        return "'redevable'"
    if 'annee' in col and typ in ('integer', 'smallint', 'bigint'):
        return '2025'
    if col == 'compte_immobilisation':
        return "'218300'"
    if 'compte' in col and typ == 'text' and (table, col) not in listes:
        return "'401000'"
    if any(k in col for k in ('empreinte', 'sha256', '_hash')) and typ == 'text':
        return f"md5('{x}{table}{col}') || md5('{table}{col}{x}')"
    if col == 'devise':
        return "'USD'"
    if col == 'hote':
        return "'leurre-7q3.example.test'"
    if col == 'createur_role':
        return "'SE'"
    if col == 'motif' and table == 'regles_affectation_bancaire':
        return f"'leurre 7q3 {x.lower()}'"
    if col == 'periode_debut':
        return "'2025-04-01'"
    if col == 'periode_fin':
        return "'2025-06-30'"
    if col in ('identifiant', 'siren'):
        return f"'{SIRENS[x]}'"
    if (table, col) in listes:
        return "'" + listes[(table, col)].replace("'", "''") + "'"
    if typ == 'text' or typ.startswith('character'):
        return f"'LEURRE-7Q3-{x} {table}.{col}'"
    m = re.match(r'numeric\((\d+),(\d+)\)', typ)
    if m and int(m.group(1)) - int(m.group(2)) < 5:
        return '7.31' if int(m.group(1)) - int(m.group(2)) >= 1 else '0.73'
    if typ.startswith('numeric') or typ in ('double precision', 'real'):
        return montant
    if typ in ('integer', 'smallint', 'bigint'):
        return '7'
    if typ == 'boolean':
        return 'false'
    if typ == 'date':
        return "'2025-06-17'"
    if typ.startswith('timestamp'):
        return "'2025-06-17 10:00:00+02'"
    if typ in ('jsonb', 'json'):
        return f"'{{\"leurre\": \"LEURRE-7Q3-{x} {table}.{col}\"}}'"
    if typ == 'text[]':
        return f"array['LEURRE-7Q3-{x} {table}.{col}']"
    if typ == 'uuid':
        # Un identifiant au préfixe du leurre : il trie avec son dossier (le premier, le dernier), et un essai qui le rend
        # le montre — jamais un identifiant tiré, qu'une sortie normalise.
        prefixe = next(p for lx, _, p, _, _ in LEURRES if lx == x)
        return f"'{prefixe}-0000-4000-8000-0000000{numero:05x}'"
    if typ == 'integer[]':
        return 'array[7]'
    return None


def remplisseur(grappe, base):
    """Le texte d'une passe du remplisseur : pour chaque table de dossier où un leurre garni n'a encore aucune ligne, une
    insertion par leurre — chaque colonne texte marquée (« LEURRE-7Q3-X table.colonne »), une colonne qu'un CHECK borne à
    une liste prend la première valeur, une clé étrangère vise une ligne du même leurre, les autres types une valeur fixe
    et reconnaissable. Rejouées par le super-utilisateur, déclencheurs coupés (`session_replication_role = replica` : les
    gardes et les clés ne jugent pas, les CHECK si), chacune dans sa sous-transaction, à trois niveaux (toutes les
    colonnes, puis les obligatoires et les textes, puis les obligatoires seules). Rend (le texte, les tables à garnir)."""
    colonnes = {}
    for t, col, typ, nn, defaut, gen in grappe.lignes(base, """
select c.relname, a.attname, format_type(a.atttypid, a.atttypmod), a.attnotnull, coalesce(pg_get_expr(d.adbin, d.adrelid), ''),
       a.attgenerated <> '' or a.attidentity <> ''
  from pg_class c join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
 where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' order by c.relname, a.attnum;"""):
        colonnes.setdefault(t, []).append((col, typ, nn == 't', defaut, gen == 't'))
    cles = {}
    for t, col, cible, ccol in grappe.lignes(base, """
select c.relname, a.attname,
       (select n2.nspname || '.' || c2.relname from pg_class c2 join pg_namespace n2 on n2.oid = c2.relnamespace where c2.oid = co.confrelid),
       (select a2.attname from pg_attribute a2 where a2.attrelid = co.confrelid and a2.attnum = co.confkey[1])
  from pg_constraint co join pg_class c on c.oid = co.conrelid
  join pg_attribute a on a.attrelid = c.oid and a.attnum = co.conkey[1]
 where c.relnamespace = 'public'::regnamespace and co.contype = 'f' and cardinality(co.conkey) = 1;"""):
        cles[(t, col)] = (cible, ccol)
    listes = {}
    for t, definition in grappe.lignes(base, """
select c.relname, translate(pg_get_constraintdef(co.oid), E'\\n\\t\\r', '   ')
  from pg_constraint co join pg_class c on c.oid = co.conrelid
 where c.relnamespace = 'public'::regnamespace and co.contype = 'c';"""):
        for m in re.finditer(r"\(\(?(\w+) = ANY \(ARRAY\[([^\]]+)\]\)\)?", definition):
            valeurs = re.findall(r"'((?:[^']|'')*)'::text", m.group(2))
            if valeurs:
                listes.setdefault((t, m.group(1)), valeurs[0])
        for m in re.finditer(r"\(\((\w+) = '((?:[^']|'')*)'::text\)\)", definition):
            listes.setdefault((t, m.group(1)), m.group(2))
    ids = ', '.join(f"'{d}'" for _, d, _, _, _ in LEURRES)
    tables = sorted(t for t, cols in colonnes.items() if any(c[0] == 'dossier_id' for c in cols))
    a_garnir = [t for t in tables if grappe.lignes(base, f'select count(*) from public.{t} where dossier_id in ({ids});')[0][0] == '0']

    def insertion(t, x, d, montant, client, niveau):
        noms, valeurs = [], []
        for rang, (col, typ, nn, defaut, gen) in enumerate(colonnes[t]):
            if gen:
                continue
            if niveau >= 2 and not nn and col != 'dossier_id' and not (niveau == 2 and typ == 'text'):
                continue
            if defaut and not nn and niveau > 1 and col != 'dossier_id':
                continue
            if defaut and col == 'id' and typ != 'uuid':
                continue
            if defaut and typ not in ('text', 'uuid') and (t, col) not in cles and col != 'dossier_id':
                continue
            numero = 0x80000 + tables.index(t) * 256 + rang
            v = _valeur(t, col, typ, x, d, montant, client, cles, listes, colonnes, numero)
            if v is None:
                if nn and not defaut:
                    return None
                continue
            noms.append(col)
            valeurs.append(v)
        return f"insert into public.{t} ({', '.join(noms)}) values ({', '.join(valeurs)})"

    sortie = ['\\set ON_ERROR_STOP on', 'begin;', 'set local session_replication_role = replica;',
              'create temporary table leurre_rempli (t text, x text, niveau int, erreur text) on commit drop;']
    for t in a_garnir:
        for x, d, _, montant, client in LEURRES:
            essais = []
            for niveau in (1, 2, 3):
                ins = insertion(t, x, d, montant, client, niveau)
                if ins and ins not in essais:
                    essais.append(ins)
            bloc = ['do $leurre$', "declare e text := '';", 'begin']
            for i, ins in enumerate(essais, 1):
                bloc += ['  begin', f'    {ins};', f"    insert into leurre_rempli values ('{t}', '{x}', {i}, null);", '    return;',
                         "  exception when others then e := e || ' | ' || sqlstate || ' ' || sqlerrm;", '  end;']
            bloc += [f"  insert into leurre_rempli values ('{t}', '{x}', 0, e);", 'end $leurre$;']
            sortie += bloc
    sortie += ["select t, string_agg(x || ':' || niveau, ' ' order by x), max(left(erreur, 300)) from leurre_rempli group by t order by t;",
               'commit;']
    return '\n'.join(sortie) + '\n', a_garnir


def couverture(grappe, base):
    """Les tables de dossier, et celles où un des trois leurres garnis n'a aucune ligne."""
    ids = ', '.join(f"'{d}'" for _, d, _, _, _ in LEURRES)
    tables = [t for (t,) in grappe.lignes(base, """
select c.relname from pg_class c join pg_attribute a on a.attrelid = c.oid and a.attname = 'dossier_id' and not a.attisdropped
 where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' order by 1;""")]
    incompletes = []
    for t in tables:
        n = int(grappe.lignes(base, f'select count(distinct dossier_id) from public.{t} where dossier_id in ({ids});')[0][0])
        if n != len(LEURRES):
            incompletes.append(f'{t} ({n} sur {len(LEURRES)})')
    v = grappe.lignes(base, f"select count(*) from dossiers where id = '{LEURRE_V}';")[0][0]
    if v != '1':
        incompletes.append('le dossier V')
    return tables, incompletes


def monter_leurre(grappe, base, sorties):
    jouer_fichier(grappe, base, os.path.join(ICI, 'leurre.sql'), sorties)
    for passe in range(3):
        texte, a_garnir = remplisseur(grappe, base)
        if not a_garnir:
            break
        chemin = os.path.join(sorties, 'montage', f'{base}_remplisseur_{passe + 1}.sql')
        os.makedirs(os.path.dirname(chemin), exist_ok=True)
        open(chemin, 'w', encoding='utf8').write(texte)
        jouer_fichier(grappe, base, chemin, sorties)
    jouer_fichier(grappe, base, os.path.join(ICI, 'leurre_complement.sql'), sorties)
    jouer_fichier(grappe, base, os.path.join(ICI, 'leurre_facture_zero.sql'), sorties)


# ── La lecture des sorties ────────────────────────────────────────────────────────────────────────────────────────────

UUID = re.compile(r'\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b')
PREFIXES_LEURRE = tuple(p + '-0000-4000-8000-' for _, _, p, _, _ in LEURRES) + ('7e570000-0000-4000-8000-',)
# Ce qui change d'un passage à l'autre sans rien dire des données, ramené à une forme fixe avant la comparaison de P et de
# L — chaque règle avec sa raison ; le rapport dit combien de fois chacune a servi.
NORMALISATIONS = [
    ('ligne de psql', re.compile(r'^psql:<stdin>:\d+: '), 'psql: ',
     "le numéro de la ligne d'une erreur de psql (le même des deux côtés ; gardé pour comparer deux versions d'un essai)"),
    ('instant', re.compile(r'\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}(:\d{2})?|Z)?'), '<instant>',
     "l'instant du passage (now())"),
    ('durée', re.compile(r'\b\d+(\.\d+)? ?ms\b'), '<durée>', "le temps d'une requête"),
    ('horodatage', re.compile(r'\d{2}/\d{2}/\d{4} à \d{2}:\d{2}'), '<horodatage>', "l'heure d'une saisie de l'essai, en mots"),
    ('empreinte de ligne', re.compile(r'accepté : [0-9a-f]{32}'), 'accepté : <empreinte>',
     "l'empreinte d'une ligne de l'essai qui porte son instant de création (contacts 52, importContacts 7b, "
     "parametresFacturation 10d)"),
    ("début d'identifiant", re.compile(r'avoir [0-9a-f]{8}\b'), 'avoir <début>',
     "le début de l'identifiant tiré d'un avoir que l'essai crée (transmissionsFactures 40 à 42)"),
]
RAISON_UUID = ("un identifiant tiré au hasard pour une ligne que l'essai crée ; ceux des dossiers d'essai "
               "(regles.json) et du leurre restent tels quels")
VERDICT = ('t', 'f', 'ok', 'mord')
ERREUR = re.compile(r'^(psql:[^:]*:\d+: )?(ERROR|FATAL)')
DETECTION = re.compile(r'DETECTEUR\|(\w[\w-]*)\|([\w.]+)\|(\w+)\|')


def normaliser(texte, compteurs):
    sortie = []
    for ligne in texte.split('\n'):
        def uuid(m):
            u = m.group(0)
            if u in FIXES or u.startswith(PREFIXES_LEURRE):
                return u
            compteurs['identifiant tiré'] = compteurs.get('identifiant tiré', 0) + 1
            return '<uuid>'
        ligne = UUID.sub(uuid, ligne)
        for nom, expr, remplacement, _ in NORMALISATIONS:
            ligne, n = expr.subn(remplacement, ligne)
            if n:
                compteurs[nom] = compteurs.get(nom, 0) + n
        sortie.append(ligne)
    return sortie


def motifs(texte):
    """Les occurrences de chaque motif du leurre, et les lignes qui en portent."""
    comptes = {nom: len(r.findall(texte)) for nom, r in MOTIFS.items()}
    lignes = [(i, ligne) for i, ligne in enumerate(texte.split('\n'), 1) if any(r.search(ligne) for r in MOTIFS.values())]
    return comptes, lignes


def lire_p(texte):
    """Ce que dit la sortie propre : le nombre de verdicts, de fautes, d'erreurs ; l'essai s'est-il dit impossible."""
    n = fautes = 0
    lignes = texte.split('\n')
    for ligne in lignes:
        champs = ligne.split('\t')
        for v in champs[1:]:
            if v in VERDICT or v.startswith('*** '):
                n += 1
                fautes += v not in ('t', 'ok', 'mord')
                break
    erreurs = sum(1 for ligne in lignes if ERREUR.match(ligne))
    return n, fautes, erreurs, 'ESSAI_IMPOSSIBLE' in texte


# ── Le rejeu ──────────────────────────────────────────────────────────────────────────────────────────────────────────

class Banc:
    def __init__(self, args):
        self.args = args
        psql = shlex.split(args.psql)
        self.grappes = {}

        def grappe(port):
            if port not in self.grappes:
                self.grappes[port] = Grappe(psql, args.hote, port, args.super, args.proprietaire)
            return self.grappes[port]
        self.modeles = {}
        for m in args.modele:
            if '=' not in m:
                raise Arret(f'--modele {m} : la forme est famille=[port/]base')
            famille, cible = m.split('=', 1)
            port, base = cible.split('/', 1) if '/' in cible else (str(args.port), cible)
            self.modeles[famille] = (grappe(port), base)
        if 'production' not in self.modeles:
            raise Arret('--modele production=<base> manque : la réplique égale à la production')
        self.sorties = os.path.abspath(args.sorties)
        if os.path.commonpath([self.sorties, RACINE]) == RACINE:
            raise Arret('--sorties : hors du dépôt (les sorties ne sont pas des sources)')
        os.makedirs(self.sorties, exist_ok=True)
        self.normalisations = {}
        self.verrou = threading.Lock()

    def famille_de(self, essai, cas):
        return cas.get(essai, {}).get('famille', 'production')

    def monter(self, familles):
        """Pour chaque famille : P (le modèle, ou la production et son semis), L (P et le leurre), D (L et le détecteur)."""
        self.bases = {}
        for famille in sorted(familles):
            if famille in self.modeles:
                grappe, p = self.modeles[famille]
                if not grappe.existe(p):
                    raise Arret(f'--modele {famille} : la base {p} n’existe pas sur le port {grappe.port}')
            else:
                semis = os.path.join(ICI, 'semis', famille + '.sql')
                if not os.path.exists(semis):
                    raise Arret(f'la famille « {famille} » : ni modèle donné (--modele {famille}=…), ni semis/{famille}.sql')
                grappe, production = self.modeles['production']
                p = f'{PREFIXE}{famille}_p'
                grappe.creer(p, production)
                jouer_fichier(grappe, p, semis, self.sorties)
            l, d = f'{PREFIXE}{famille}_l', f'{PREFIXE}{famille}_d'
            grappe.creer(l, p)
            monter_leurre(grappe, l, self.sorties)
            tables, incompletes = couverture(grappe, l)
            if incompletes or not tables:
                raise Arret(f'la couverture du leurre ({famille}) : {len(tables)} tables de dossier, incomplètes : '
                            + ', '.join(incompletes))
            grappe.creer(d, l)
            jouer_fichier(grappe, d, os.path.join(ICI, 'detecteur.sql'), self.sorties)
            self.bases[famille] = (grappe, {'P': p, 'L': l, 'D': d}, len(tables))
            print(f'famille {famille} : P {p}, L {l}, D {d} ; le leurre couvre {len(tables)} tables de dossier sur {len(tables)}',
                  flush=True)

    def rejouer(self, nom, texte, famille, role, config):
        grappe, bases, _ = self.bases[famille]
        with grappe.verrou:
            if not grappe.libres:
                raise RuntimeError('aucune base de travail libre')
            travail = grappe.libres.pop()
        try:
            grappe.creer(travail, bases[config])
            sortie = os.path.join(self.sorties, f'{nom}_{config}.txt')
            grappe.jouer(travail, texte, sortie, grappe.superu if role == 'super' else grappe.proprietaire, True, False)
            grappe.jeter(travail)
        finally:
            with grappe.verrou:
                grappe.libres.append(travail)
        return open(sortie, encoding='utf8', errors='replace').read()

    def juger(self, nom, sorties):
        """Le verdict d'un essai sur ses trois sorties."""
        p, l, d = sorties['P'], sorties['L'], sorties['D']
        compteurs = {}
        np, nl = normaliser(p, compteurs), normaliser(l, compteurs)
        with self.verrou:
            for k, v in compteurs.items():
                self.normalisations[k] = self.normalisations.get(k, 0) + v
        ecarts = [x for x in difflib.unified_diff(np, nl, lineterm='', n=0) if not x.startswith(('---', '+++', '@@'))]
        comptes_p, lignes_p = motifs(p)
        comptes_l, lignes_l = motifs(l)
        ecritures = [m for m in DETECTION.finditer(d) if m.group(1) == 'LEURRE']
        return {
            'p': lire_p(p),
            'ecarts': ecarts,
            'motifs': sum(comptes_p.values()) + sum(comptes_l.values()),
            'lignes_motifs': [('P', i, x) for i, x in lignes_p] + [('L', i, x) for i, x in lignes_l],
            'ecritures': sorted({f'{m.group(2)}:{m.group(3)}' for m in ecritures}),
            'nb_ecritures': len(ecritures),
        }

    def temoin(self):
        """Le témoin planté : le banc doit le voir de ses trois façons, sinon il est aveugle."""
        texte = open(os.path.join(ICI, 'temoin.sql'), encoding='utf8').read()
        sorties = {c: self.rejouer('_temoin', texte, 'production', 'proprietaire', c) for c in 'PLD'}
        j = self.juger('_temoin', sorties)
        vu = {'écart': bool(j['ecarts']), 'motif': j['motifs'] > 0, 'écriture du leurre': j['nb_ecritures'] > 0}
        aveugle = [k for k, v in vu.items() if not v]
        if aveugle:
            raise Arret('le témoin planté (temoin.sql) n’est pas vu — ' + ', '.join(aveugle)
                        + ' : le banc est aveugle, il ne conclut rien')
        return f"vu de ses trois façons : {len(j['ecarts'])} ligne(s) d'écart, {j['motifs']} motif(s), " \
               f"{j['nb_ecritures']} écriture(s) du leurre"

    def courir(self, choisis):
        debut = time.time()
        dossier = os.path.abspath(self.args.essais)
        production, replique, outils = classer(dossier)
        cas = particuliers(production)
        essais = [e for e in production if not choisis or e in choisis]
        inconnus = [e for e in choisis if e not in production]
        if inconnus:
            raise Arret('essais inconnus, ou de réplique seulement : ' + ', '.join(inconnus))
        print(f'{len(production) + len(replique) + len(outils)} fichiers : {len(production)} essais joués en production, '
              f'{len(replique)} de réplique seulement ({", ".join(f"{e} ({q})" for e, q in sorted(replique.items()))}), '
              f'{len(outils)} outils ; rejoués ici : {len(essais)}', flush=True)
        for grappe in self.grappes.values():
            for b in grappe.bases():
                if b.startswith(PREFIXE):
                    grappe.jeter(b)
        familles = {'production'} | {self.famille_de(e, cas) for e in essais}
        self.monter(familles)
        for grappe in self.grappes.values():
            grappe.libres = [f'{PREFIXE}t{k}' for k in range(self.args.travailleurs)]
        temoin = self.temoin()
        print('témoin :', temoin, flush=True)
        textes = {e: open(os.path.join(dossier, e + '.sql'), encoding='utf8').read() for e in essais}
        resultats = {}
        with concurrent.futures.ThreadPoolExecutor(max_workers=self.args.travailleurs) as pool:
            taches = {(e, c): pool.submit(self.rejouer, e, textes[e], self.famille_de(e, cas),
                                          cas.get(e, {}).get('role', 'proprietaire'), c)
                      for e in essais for c in 'PLD'}
            for (e, c), t in taches.items():
                resultats.setdefault(e, {})[c] = t.result()
        lignes, fautes, aveugles = [], [], []
        for e in essais:
            j = self.juger(e, resultats[e])
            n, f, err, impossible = j['p']
            attendu = cas.get(e, {}).get('attendu')
            if attendu == 'impossible' and not impossible:
                aveugles.append(f'{e} : regles.json l’attend impossible, et il s’est joué — retirer le cas particulier')
            elif attendu != 'impossible' and (impossible or err or not resultats[e]['P'].strip()):
                aveugles.append(f'{e} : il ne se joue pas sur P ({err} erreur(s){", ESSAI_IMPOSSIBLE" if impossible else ""}'
                                f'{", aucune sortie" if not resultats[e]["P"].strip() else ""})'
                                ' : sa famille ou son rôle manque à regles.json')
            faute = j['ecarts'] or j['motifs'] or j['nb_ecritures']
            verdict = 'FAUTE' if faute else 'SÛR'
            lignes.append(f'{e:30} {verdict:5}  P {n:4} verdicts ({f} en faute, {err} erreur(s){", impossible" if impossible else ""})'
                          f'  écarts {len(j["ecarts"])}  motifs {j["motifs"]}  écritures du leurre {j["nb_ecritures"]}')
            if faute:
                fautes.append((e, j))
        rapport = [f'Banc du leurre — {time.strftime("%d/%m/%Y %H:%M")} — {len(essais)} essais rejoués sur {len(production)} '
                   f'joués en production, en {time.time() - debut:.0f} s', f'Témoin : {temoin}', ''] + lignes + ['']
        for e, j in fautes:
            rapport.append(f'=== {e}')
            rapport += [f'    écart : {x[:300]}' for x in j['ecarts'][:12]]
            rapport += [f'    motif {c}:{i} : {x[:300]}' for c, i, x in j['lignes_motifs'][:12]]
            rapport += [f'    écriture du leurre : {x}' for x in j['ecritures'][:12]]
        rapport.append('Normalisations (les lignes de P et de L ramenées à une forme fixe) :')
        raisons = {nom: raison for nom, _, _, raison in NORMALISATIONS}
        raisons['identifiant tiré'] = RAISON_UUID
        for nom in sorted(self.normalisations):
            rapport.append(f'    {nom} : {self.normalisations[nom]} — {raisons[nom]}')
        if aveugles:
            rapport += ['', 'Ne conclut pas :'] + [f'    {x}' for x in aveugles]
        open(os.path.join(self.sorties, 'rapport.txt'), 'w', encoding='utf8').write('\n'.join(rapport) + '\n')
        print('\n'.join(rapport), flush=True)
        if not self.args.garder:
            for grappe in self.grappes.values():
                for b in grappe.bases():
                    if b.startswith(PREFIXE):
                        grappe.jeter(b)
        if aveugles:
            return 2
        return 1 if fautes else 0


def inventaire(dossier):
    production, replique, outils = classer(os.path.abspath(dossier))
    cas = particuliers(production)
    print(f'{len(production)} essais joués en production :', ' '.join(production))
    print(f'{len(replique)} de réplique seulement :', ', '.join(f'{e} ({q})' for e, q in sorted(replique.items())))
    print(f'{len(outils)} outils :', ' '.join(outils))
    print(f'{len(cas)} cas particuliers :')
    for e, c in sorted(cas.items()):
        print(f'    {e} : {c.get("famille", "production")}, {c.get("role", "proprietaire")}'
              f'{", attendu " + c["attendu"] if "attendu" in c else ""} — {c["raison"]}')
    return 0


def main():
    a = argparse.ArgumentParser(description='Le banc du leurre (voir son en-tête).')
    a.add_argument('--inventaire', action='store_true')
    a.add_argument('--sorties')
    a.add_argument('--modele', action='append', default=[])
    a.add_argument('--port', default='5432')
    a.add_argument('--hote', default='/var/run/postgresql')
    a.add_argument('--psql', default='psql')
    a.add_argument('--super', default='postgres')
    a.add_argument('--proprietaire', default='proprietaire')
    a.add_argument('--travailleurs', type=int, default=3)
    a.add_argument('--garder', action='store_true')
    a.add_argument('--essais', default=ESSAIS)
    a.add_argument('choisis', nargs='*', metavar='essai')
    args = a.parse_args()
    try:
        if args.inventaire:
            return inventaire(args.essais)
        if not args.sorties:
            raise Arret('--sorties <dossier> manque')
        return Banc(args).courir(args.choisis)
    except Arret as x:
        print('LE BANC NE CONCLUT PAS :', x, file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
