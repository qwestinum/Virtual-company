# Connecteur APEC — mise en service

Procédure d'exploitation. Spécification technique : `docs/specs/apec-adep-connector.md`.

> **État au 09/09/2026** : lots 0 à 4 livrés, et le **premier appel réel a
> abouti** en environnement de test (offre `179240002W`, statut `AVALIDER`) —
> la clé Argon2 est donc validée par l'Apec elle-même. Le WSDL de **production**
> n'a jamais été vu. Le connecteur tourne en **mode simulation** tant que
> `ADEP_ENABLED` n'est pas posé — et il le dit à l'écran.

---

## 0. Migration — AVANT tout déploiement

`scripts/migrate.sql`, **fichier entier**, **deux exécutions successives**
(règle absolue du projet), puis **Dashboard Supabase → Reload schema cache**.

Ce que le chantier APEC ajoute :

| Objet | Nature |
|---|---|
| `job_postings` | table + CHECK `attempt_state` + 2 index |
| `recruiters.adep_numero_dossier` | colonne, **chiffrée** |
| `app_settings.adep_config` | colonne jsonb |
| `sites.insee_code` | colonne |

Sans le rechargement du cache PostgREST, les lectures rendent
« not found in schema cache » et le panneau se retire en silence.

---

## 1. Variables d'environnement

| Variable | Où | Obligatoire | Note |
|---|---|---|---|
| `ADEP_ATS_ID` | env | pour publier | fourni par l'Apec |
| `ADEP_WSDL_URL` | env | si `ADEP_ENABLED` | avec ou sans `?wsdl` |
| `ADEP_ATS_PASSWORD_HASH` | env | pour publier | 342 caractères |
| `ADEP_ENABLED` | env | non | **`1` exactement** — tout le reste = simulation |
| `ADEP_TEST_NUMERO_DOSSIER` | env | non | **ignoré dès que `ADEP_ENABLED=1`** |
| `ADEP_PROBE_EMAIL` | fichier de sonde | pour `adep:probe` | adresse de réception |
| `MAILBOX_ENCRYPTION_KEY` | env | déjà posée | chiffre le `numeroDossier` |

⚠️ **Aucune de ces variables n'est `NEXT_PUBLIC_*`.** Le panneau apprend qu'il
est en simulation par la réponse de l'API, jamais par une variable de build.

### 1.1 Calculer la clé

```
npm run adep:hash -- --cross-check              # croise Node et Python, sans secret
npm run adep:hash -- --env .env.adep --reveal   # la clé à recopier
```

Le croisement exige `argon2-cffi` côté Python (`apt install python3-argon2`).
S'il manque, la commande **le dit** et ne prétend pas avoir vérifié.

⚠️ Une clé de **43 caractères** signifie 32 octets au lieu de 256 — le piège du
commentaire Java de la spécification. Ce n'est pas une clé tronquée, c'est une
clé entièrement différente : il n'y a aucun rattrapage, il faut recalculer.

---

## 2. Réglages du cabinet — une fois

`/settings` → **Intégrations — Canaux de diffusion** → bloc « APEC — réglages du
cabinet » (les autres jobboards gardent leur carte générique : APEC a le sien
parce que ses identifiants sont des variables d'environnement, pas un token en
base). Le résumé de la section DIT ce qui manque, replié — on ne découvre pas un
code NAF absent en butant sur un bouton désarmé au fond d'une campagne.

- **code NAF** du cabinet (format `0000X`) ;
- **description de l'entreprise**, 100 à 3000 caractères ;
- **affichage du logo** ;
- **mode client** — `direct` par défaut ; `indirect` exige une convention Apec
  Cabinets / ETT / PRISME (sinon `API_330`) ;
- valeurs par défaut : zone de déplacement, statut du poste, affichage du salaire.

Puis, **par site** (`/settings` → « Sites »), le **code commune INSEE**. ⚠️ Paris (75056), Lyon (69123) et
Marseille (13055) sont refusés par l'Apec : il faut l'arrondissement (75101–75120,
69381–69389, 13201–13216). Le validateur le dit, avec la plage.

Puis, **par recruteur** (`/settings` → « Recruteurs » → ✏️), son **identifiant
Apec** (`123456789W`). Il est **chiffré et jamais réaffiché** : le champ laissé
vide ne change rien, une valeur le remplace. La liste marque « Apec ✓ » les
recruteurs habilités. Un recruteur sans identifiant ne peut pas être référent
d'une campagne publiée — et le panneau le dit **avant** de proposer le bouton.

---

## 3. Recette sur le mock — sans l'Apec

`ADEP_ENABLED` absent. Le panneau affiche « mode simulation » et rien ne part.
Scénarios à dérouler :

1. **Pré-remplissage** — le panneau s'ouvre REPLIÉ : état, préalables, un
   bouton « Préparer la publication ». Dans « L'annonce », le titre et le
   descriptif viennent de l'annonce générique publiée quand il y en a une (leur
   provenance est écrite), sinon des **missions principales** de la fiche de
   poste ; la **description du profil** vient des **compétences clés**. Rien de
   tout cela ne se ressaisit. Sans aucune de ces sources, le panneau propose
   « Pré-rédiger le texte » — un bouton, jamais un automatisme.
   ⚠️ Un descriptif de plus de 3 000 caractères n'est **pas tronqué** : l'écart
   est affiché, c'est au recruteur de raccourcir.
2. **Publication nominale** — le formulaire, « Vérifier », « Publier ». Un numéro
   apparaît, le statut est daté.
3. **Rejet** — mettez un descriptif à 50 caractères : le validateur bloque
   AVANT l'envoi, avec le compte de caractères.
4. **Contrat impossible** — passez la fiche de poste en « freelance » : le
   panneau annonce le blocage en haut, le bouton reste désarmé.
5. **Dépublier / Republier** — l'aller-retour, puis vérifiez la phrase de
   fenêtre (« Republication possible jusqu'au … »).
6. **Clôture** — le dialog propose la dépublication, cochée par défaut.

---

## 4. Premier appel réel

**Dans cet ordre, sans sauter d'étape.**

```
npm run adep:probe -- --env .env.adep              # 1. dry-run
npm run adep:probe -- --env .env.adep --execute    # 2. appel RÉEL
```

Le dry-run vérifie l'espace de noms du WSDL **réellement servi**. S'il diverge de
notre constante, la sonde **refuse de continuer** : mettez à jour
`src/lib/jobboards/adep/namespaces.ts`, relancez les tests, recommencez.

`--execute` demande la recopie manuelle de l'`atsId`. Il crée **une offre de
test** intitulée « SONDE TECHNIQUE ADEP — ne pas traiter », confidentielle
(ODC). Pensez à la faire retirer.

⚠️ Si la sonde rend `uncertain`, **ne la relancez pas** : vérifiez d'abord sur
apec.fr sous la référence affichée. C'est exactement la situation où un rejeu
crée un doublon indélébile.

**Retirer l'offre de sonde** — elle est invisible d'ORQA (la sonde n'écrit rien
en base), d'où une option dédiée :

```
npm run adep:probe -- --env .env.adep --suspend SONDE-AAAAMMJJ-NNNN            # dry-run
npm run adep:probe -- --env .env.adep --suspend SONDE-AAAAMMJJ-NNNN --execute  # réel
```

⚠️ Un drapeau inconnu **arrête** la sonde au lieu d'être ignoré : sans cette
garde, une option mal orthographiée retombait sur le comportement par défaut —
une CRÉATION.

Une fois la sonde concluante : posez `ADEP_ENABLED=1` **et** `ADEP_WSDL_URL`.
L'une sans l'autre fait échouer franchement — c'est voulu.

---

## 5. Diagnostic

| Symptôme | Piste |
|---|---|
| Le panneau APEC ne s'affiche pas | route en 404 : migration non passée, ou cache PostgREST |
| « mode simulation » alors qu'on attend du réel | `ADEP_ENABLED` ≠ `1` (`true` ne suffit pas) |
| `API_102` | clé refusée — recalculer, vérifier la longueur (342) |
| `API_390` | référence déjà prise ; le connecteur va lire l'offre existante |
| `API_330` | convention Apec ne permet pas le mode indirect |
| `API_361` | fenêtre de republication fermée (30 j après la **publication**) |
| Statut figé | le statut est un CACHE : « Relire le statut » interroge l'Apec |
| Le texte publié ne suit pas l'annonce générique | **c'est voulu** : le texte est repris à l'ouverture du panneau et figé à la publication APEC. Corriger l'annonce générique après coup ne touche pas l'offre partie (l'Apec ne la rend plus modifiable) |

Le flux envoyé est conservé **caviardé** dans `job_postings.request_xml` (ni mot
de passe, ni numéro de dossier), et l'acquittement brut dans `ack_raw`. Les deux
se collent tels quels dans un message au support.

Questions ouvertes à poser à l'Apec : `docs/ops/apec-questions-support.md`.
