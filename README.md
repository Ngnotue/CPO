
# CPO — Collège Privé de l'Ouest

Site institutionnel du Collège Privé de l'Ouest, collège d'enseignement général et technique. Le projet comprend une interface responsive, un formulaire de contact réel et une base de contenu prête pour un lancement professionnel.

## Ce qui est couvert

- Présenter le collège, son approche pédagogique et ses valeurs de manière claire et institutionnelle.
- Mettre en avant le positionnement général et technique du CPO.
- Proposer une navigation simple vers les sections collège, parcours, admissions et contact.
- Valoriser l'espace familles et les parcours d'accompagnement.
- Présenter un parcours d'admission en plusieurs étapes.
- Ajouter automatiquement l'objet adéquat pour les demandes d'admission ou le suivi d'un dossier.
- Afficher le français par défaut et permettre la version anglaise.
- Gérer le thème clair/sombre avec mémorisation dans le navigateur.
- Maintenir une palette institutionnelle basée sur le bleu, le bleu marine et l'ivoire.
- Adapter le site aux écrans mobiles et aux préférences de réduction des animations.
- Envoyer les messages via une API backend sécurisée et des variables d'environnement.
- Préparer un cadre pour un déploiement léger sur un hébergeur Node.js standard.

## Structure

```text
cpo_frontend/
  index.html         # page d'accueil principale
  about.html         # page présentation du collège
  admissions.html    # page admissions
  contact.html       # page contact dédiée
  resources.html    # cours, exercices et documents publics
  styles.css         # design, thème clair/sombre et responsive
  script.js          # traductions, thème, navigation et formulaire
cpo_backend/
  server.js          # API contact + serveur statique
  package.json       # dépendances Node.js
  .env.example       # variables d'environnement SMTP
  .env               # configuration locale (non versionnée)
```

## Démarrage local

```powershell
npm install --prefix cpo_backend
Copy-Item cpo_backend/.env.example cpo_backend/.env
```

Pour l'envoi des courriels depuis Render, utilisez de préférence l'API HTTPS Brevo. Ajoutez `BREVO_API_KEY` et `BREVO_SENDER_EMAIL` dans l'environnement; l'adresse d'expéditeur doit être vérifiée dans Brevo. `BREVO_SENDER_NAME` est facultatif. En local, renseignez ces mêmes variables dans `cpo_backend/.env`.

L'endpoint `/api/health` indique maintenant le fournisseur (`brevo` ou `smtp`) et si sa configuration de base est présente, sans révéler la clé ni l'adresse d'expéditeur.

Le backend garde SMTP comme solution de repli si `BREVO_API_KEY` est absent. Pour ce mode, renseignez `SMTP_USER` et `SMTP_PASSWORD`; pour Gmail, utilisez un mot de passe d'application, pas le mot de passe normal du compte. Render peut bloquer les connexions SMTP sortantes, c'est pourquoi Brevo par API est privilégié.

Lancer le site :

```powershell
npm start --prefix cpo_backend
```

Puis ouvrir :

```text
http://localhost:8000
```

Sans configuration SMTP, le site retourne un message explicite au lieu d'échouer silencieusement.

## Déploiement

### Option simple : Render

1. Créer un service Web Node.js sur Render.
2. Connecter le dépôt GitHub du projet.
3. Définir le dossier racine du service sur le dépôt principal.
4. Configurer les variables d'environnement :
   - `PORT=8000`
   - `CONTACT_RECIPIENT=nnoguem@gmail.com`
  - `BREVO_API_KEY=...` (clé API confidentielle, backend seulement)
  - `BREVO_SENDER_EMAIL=...` (adresse validée dans Brevo)
  - `BREVO_SENDER_NAME=CPO | Collège Privé de l'Ouest` (facultatif)
  - SMTP (`SMTP_USER`, `SMTP_PASSWORD`, etc.) uniquement si la solution Brevo n'est pas activée.
5. Définir la commande de démarrage :

```bash
cd cpo_backend && npm install && npm start
```

### Option plus robuste : conteneur Docker

Un `Dockerfile` peut être ajouté pour un déploiement dans un environnement plus standardisé. Le serveur actuel est déjà prêt pour un hébergement Node classique car il sert les fichiers statiques et expose l’API de contact.

## Bonnes pratiques de production

- Ne pas versionner les clés Brevo ni les identifiants SMTP réels.
- Utiliser des variables d’environnement sur l’hébergeur.
- Vérifier l'adresse expéditeur dans Brevo avant d'envoyer.
- Tester le formulaire après publication sur la vraie URL de production.

## Base de données et portail Supabase

Le dépôt contient le début d'un portail du personnel basé sur Supabase
(PostgreSQL, Auth et Storage). La migration est
`supabase/migrations/20261108140000_cpo_portal.sql`; le test de permissions RLS
est `supabase/tests/portal_rls_test.sql`. Le modèle comprend les profils admin
/ professeur, classes, matières, actualités et publications, pièces jointes,
résultats nominatifs et journal d'audit.

### Sécurité retenue

- Les pages publiques ne demandent pas de compte. Elles ne lisent que les
  publications publiées, publiques, non expirées et dans la langue choisie.
- Les comptes du personnel sont créés par l'administrateur, pas par inscription
  publique. Un mot de passe temporaire doit être changé à la première connexion.
- Les professeurs ne gèrent que leurs propres publications. Les opérations sont
  contrôlées côté serveur et par les policies Postgres RLS.
- Les résultats contenant le nom d'un élève sont stockés séparément et réservés
  aux administrateurs. Ils ne sont jamais renvoyés au flux public.
- Les pièces jointes sont envoyées vers un bucket privé avec des URL signées;
  les clés Supabase privilégiées restent uniquement sur le backend.
- Le backend limite les connexions répétées pour un même identifiant et limite
  les demandes de contact répétées depuis une même adresse e-mail. Ces limites
  sont conservées en mémoire du processus et complètent, sans remplacer, les
  protections de Supabase Auth et du fournisseur e-mail.
- Les cookies de renouvellement du portail expirent après 12 heures sans
  renouvellement d'activité; les connexions actives les renouvellent avec la
  session Supabase.
- Le journal administrateur conserve les changements de publications, les
  suppressions de pièces jointes, la gestion des comptes professeurs et les
  créations de résultats privés, sans y recopier les notes ou noms d'élèves.
- La validation des certificats TLS SMTP est toujours activée dans le backend.

### Préparer Supabase

1. Créer un projet Supabase et désactiver les inscriptions ouvertes dans Auth.
2. Lier le projet depuis ce dépôt avec la Supabase CLI, puis appliquer la
   migration (`supabase link --project-ref <référence>`, puis
   `supabase db push`). Le fichier de test RLS se lance avec `supabase test db`.
3. Créer le premier compte admin via Supabase Auth. Copier son UUID et l'associer
   au rôle admin depuis l'éditeur SQL Supabase :

   ```sql
   insert into public.profiles (id, role, full_name, is_active, must_change_password)
   values ('UUID_DE_L_ADMIN', 'admin', 'Nom de l’administrateur', true, false)
   on conflict (id) do update
     set role = 'admin', is_active = true, must_change_password = false;
   ```

4. Configurer `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` et
   `SUPABASE_SECRET_KEY` dans les variables d'environnement du backend
   (`cpo_backend/.env` en local, Render en production). La clé secrète/service
   role ne doit jamais être ajoutée au frontend ou commitée.
5. Redéployer le backend, vérifier `/api/health` (`supabaseConfigured: true`),
   puis tester le flux public, les comptes professeur/admin et l'accès refusé
   aux résultats nominatifs pour les rôles non-admin.

Le projet Supabase et ses clés réelles ne sont pas inclus dans le dépôt. La
migration doit être appliquée à un projet créé et vérifiée avant de saisir des
données réelles. Prévoir des sauvegardes et tester régulièrement leur
restauration.

## Supabase : base de données et espace du personnel

Le socle Supabase du portail est fourni dans `supabase/migrations/`. Il utilise
PostgreSQL, Supabase Auth et Storage. La migration crée les profils avec rôles
`admin` / `teacher`, les actualités et publications, leurs métadonnées de
fichiers, les classes/matières et une table séparée pour les résultats
nominatifs.

### Ce qui est déjà prévu dans le code

- `GET /api/publications` renvoie uniquement les actualités publiques publiées,
  non expirées, dans la langue demandée (`fr` ou `en`).
- `/staff.html` fournit une connexion, le changement obligatoire du mot de
  passe temporaire, la gestion des publications et, pour l'administrateur, la
  création/suspension de comptes professeurs et l'enregistrement privé de
  résultats. L'équipe peut filtrer ses brouillons et retrouver les publications
  expirées pour leur donner une nouvelle date ou retirer leur expiration.
- `cpo_frontend/resources.html` présente au public les cours, exercices et
  documents que le personnel a explicitement publiés avec une visibilité
  publique; les visiteurs peuvent filtrer par type et ouvrir les pièces jointes.
- Le navigateur ne reçoit jamais la clé Supabase secrète. Les actions passent
  par le backend Node et les accès SQL sont protégés par Row Level Security
  (RLS).
- Les fichiers utilisent des URL d'envoi signées à durée limitée et le bucket
  privé `cpo-private-documents`. Le flux public ne reçoit des URL de lecture
  temporaires que pour des pièces jointes de publications publiques.
- Les résultats contenant le nom d'un élève ne sont pas publics; les policies
  RLS les réservent au rôle administrateur.

### Mise en service

1. Créer un projet Supabase et garder désactivée l'inscription publique dans
   Supabase Auth. Les comptes du personnel doivent être créés par
   l'administrateur.
2. Depuis le répertoire du projet, appliquer
   `supabase/migrations/20261108140000_cpo_portal.sql` avec la Supabase CLI
   (`supabase db push`) ou l'éditeur SQL Supabase. Vérifier la migration et ses
   policies dans le projet de préproduction avant la production.
3. Créer le premier utilisateur administrateur dans Supabase Auth. Copier son
   UUID puis l'associer à son profil via l'éditeur SQL :

   ```sql
   insert into public.profiles (id, role, full_name, is_active, must_change_password)
   values ('UUID_DE_L_ADMIN', 'admin', 'Nom de l’administrateur', true, false)
   on conflict (id) do update
     set role = 'admin', is_active = true, must_change_password = false;
   ```

4. Ajouter `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` et `SUPABASE_SECRET_KEY`
   dans les variables d'environnement du backend Render. La clé secrète (ou
   l'ancienne `service_role` si nécessaire) est privilégiée et ne doit jamais
   être ajoutée à `cpo_frontend`, au dépôt public, ni à une variable `VITE_`.
5. Redéployer le backend, puis vérifier `/api/health` :
   `supabaseConfigured` doit être `true`. Se connecter sur `/staff.html` et
   créer un compte professeur avec un mot de passe temporaire robuste, à
   transmettre au professeur par un canal sûr.
6. Vérifier les accès public, professeur et administrateur, notamment qu'un
   visiteur et un professeur ne peuvent pas lire les résultats nominatifs.

Les URL et clés de ce projet ne sont pas préremplies dans le dépôt. Avant de
mettre des données réelles en production, il faut exécuter et vérifier des tests
RLS adaptés au projet Supabase et configurer les sauvegardes. Le code de
l'interface ne constitue pas à lui seul une garantie de sécurité : RLS et les
permissions backend restent les autorités d'accès.
=======
# Cahier des charges fonctionnel et technique
## Plateforme web du CPO — Collège Privé de l’Ouest

**Établissement :** CPO — Collège Privé de l’Ouest  
**Localisation :** Bafoussam, Région de l’Ouest, Cameroun  
**Type de projet :** Site web institutionnel avec espace d’administration et espaces personnels pour les professeurs

---

## 1. Présentation du projet

L’objectif est de créer le site internet officiel du **CPO (Collège Privé de l’Ouest)** situé à **Bafoussam, dans la Région de l’Ouest au Cameroun**.

Le site doit permettre à l’établissement de communiquer facilement avec les élèves, les parents, les anciens élèves, les enseignants et toute personne extérieure à l’établissement.

La plateforme devra être simple à utiliser, rapide, adaptée aux téléphones mobiles et conçue pour fonctionner correctement avec des connexions internet qui peuvent être lentes ou instables.

Le site sera principalement public. Les visiteurs n’auront pas besoin de créer un compte pour consulter les informations publiées par le collège.

En revanche, les **professeurs et les administrateurs disposeront d’un accès sécurisé** leur permettant de publier du contenu.

---

# 2. Objectifs principaux

La plateforme devra permettre :

- de présenter officiellement le CPO ;
- de publier les actualités et annonces de l’établissement ;
- de publier les dates et informations relatives aux examens ;
- de publier les résultats scolaires lorsqu’ils sont destinés à être rendus publics ;
- de publier des exercices, cours, documents pédagogiques et autres ressources ;
- de permettre aux professeurs de disposer chacun de leur propre espace ;
- de permettre aux administrateurs de gérer les professeurs et leurs droits ;
- de permettre la publication de textes et de fichiers ;
- de consulter les documents sans obligation de créer un compte ;
- de garantir un niveau de sécurité élevé ;
- de conserver un historique des publications et des actions importantes ;
- de disposer d’un système de sauvegarde afin d’éviter la perte des données.

---

# 3. Accès public au site

## 3.1 Aucun compte pour les visiteurs

Les élèves, parents et visiteurs extérieurs ne devront **pas être obligés de créer un compte**.

Une personne pourra simplement :

1. ouvrir le site du CPO ;
2. consulter la page d’accueil ;
3. consulter les annonces ;
4. consulter les actualités ;
5. consulter les publications des professeurs ;
6. télécharger les documents autorisés ;
7. consulter les résultats publiés par l’établissement ;
8. consulter les exercices et ressources pédagogiques accessibles au public.

L’objectif est de rendre l’information facilement accessible.

---

# 4. Page d’accueil

La page d’accueil devra être particulièrement importante.

Elle devra permettre à l’administration de publier rapidement :

- annonces générales ;
- annonces d’examens ;
- dates importantes ;
- informations destinées aux élèves et aux parents ;
- communiqués ;
- résultats ;
- événements du collège ;
- documents officiels ;
- informations urgentes ;
- autres actualités de l’établissement.

## 4.1 Publication par l’administrateur

L’administrateur devra pouvoir créer une publication contenant :

- un titre ;
- un texte ;
- une date de publication ;
- éventuellement une date d’expiration ;
- une image ;
- un ou plusieurs fichiers ;
- une catégorie ;
- éventuellement une mention « important » ou « urgent ».

Les publications pourront être modifiées ou supprimées par l’administrateur.

## 4.2 Affichage

Les annonces récentes devront être visibles facilement depuis la page d’accueil.

Une publication pourra également être ouverte sur une page dédiée contenant son contenu complet.

---

# 5. Comptes des professeurs

Les professeurs ne devront pas pouvoir créer eux-mêmes leur compte.

La création des comptes devra être réservée à l’administrateur.

## 5.1 Création d’un compte

L’administrateur pourra créer un compte professeur avec, par exemple :

- nom ;
- prénom ;
- matière enseignée ;
- identifiant professeur ;
- adresse e-mail, si nécessaire ;
- mot de passe temporaire ;
- statut du compte : actif / suspendu.

Après création, l’administrateur transmettra au professeur son **ID de connexion et son mot de passe temporaire** par un moyen sécurisé.

## 5.2 Première connexion

Le mot de passe temporaire devra être utilisable uniquement pour la première connexion.

Lors de cette première connexion, le professeur devra obligatoirement :

1. saisir son identifiant ;
2. saisir son mot de passe temporaire ;
3. définir un nouveau mot de passe personnel ;
4. confirmer le nouveau mot de passe.

Le mot de passe temporaire devra ensuite être invalidé.

Le professeur ne devra jamais pouvoir revenir à l’ancien mot de passe temporaire.

---

# 6. Sécurité des comptes professeurs

Le système devra appliquer plusieurs mesures de sécurité :

- mots de passe stockés sous forme chiffrée/hachée ;
- aucune conservation des mots de passe en clair ;
- limitation du nombre de tentatives de connexion ;
- protection contre les attaques par force brute ;
- possibilité de déconnexion ;
- expiration des sessions après une période d’inactivité ;
- protection contre les attaques courantes sur les applications web ;
- validation stricte des fichiers envoyés ;
- contrôle des permissions ;
- journalisation des actions importantes.

Une authentification à deux facteurs pourra également être prévue comme fonctionnalité optionnelle pour les comptes administrateurs.

---

# 7. Espace personnel de chaque professeur

Chaque professeur devra disposer d’une page ou d’un espace personnel.

Exemple :

**Professeur : M. / Mme X**  
**Matière : Mathématiques**

Depuis son espace, le professeur pourra :

- écrire une publication ;
- publier un exercice ;
- publier un cours ;
- publier une information destinée à ses élèves ;
- envoyer un document ;
- modifier ses propres publications ;
- supprimer ses propres publications ;
- consulter la liste de ses publications ;
- consulter la date de publication ;
- organiser ses documents.

Les visiteurs pourront consulter les publications publiques du professeur sans avoir besoin de compte.

---

# 8. Publications des professeurs

Un professeur devra pouvoir créer une publication comprenant :

### Informations obligatoires

- titre ;
- contenu ou description ;
- date de publication.

### Informations facultatives

- matière ;
- classe concernée ;
- niveau scolaire ;
- catégorie ;
- image ;
- fichier joint.

Le professeur devra également pouvoir publier directement du texte depuis son espace personnel, sans être obligé d'envoyer un fichier.

---

# 9. Formats de fichiers acceptés

La plateforme devra permettre aux professeurs et aux administrateurs d'envoyer différents types de fichiers.

Formats à prévoir notamment :

- PDF ;
- Microsoft Word : DOC, DOCX ;
- Microsoft Excel : XLS, XLSX ;
- JPEG / JPG ;
- PNG.

D’autres formats pourront être ajoutés ultérieurement si nécessaire.

Pour des raisons de sécurité, les formats exécutables ou potentiellement dangereux ne devront pas être autorisés par défaut.

---

# 10. Taille des fichiers

Le système devra accepter des fichiers relativement volumineux.

Le site ne devra pas imposer une limite trop faible, car les utilisateurs au Cameroun ne réduisent pas nécessairement leurs fichiers avant de les envoyer.

La taille maximale devra toutefois être **configurable par l’administrateur**.

Exemple de configuration initiale possible :

- documents courants : jusqu’à 50 ou 100 Mo ;
- limite supérieure configurable selon les capacités du serveur ;
- possibilité d’augmenter ultérieurement la capacité.

La plateforme devra afficher clairement la taille maximale autorisée avant l’envoi.

---

# 11. Nombre de documents par professeur

Chaque professeur pourra disposer initialement d’une capacité d’environ **40 documents ou publications actives**.

Cette limite devra être configurable.

Il serait préférable de ne pas coder définitivement la valeur « 40 ». L’administrateur devra pouvoir modifier cette limite ultérieurement selon les besoins du collège.

Exemple :

> Nombre maximum de documents par professeur : 40

L’administrateur pourra éventuellement passer cette valeur à 50, 100 ou davantage.

---

# 12. Date automatique de publication

Lorsqu'un professeur ou un administrateur publie un document, la plateforme devra enregistrer automatiquement :

- la date ;
- l'heure ;
- l'auteur de la publication.

La date devra être affichée automatiquement sur la page de publication.

Exemple :

> Publié le 17 septembre 2026 à 14:35

Il ne devra pas être nécessaire pour le professeur de saisir manuellement la date.

La date devra être générée par le serveur afin d'éviter les erreurs ou les manipulations.

---

# 13. Gestion des publications

Chaque publication devra pouvoir avoir un statut :

- brouillon ;
- publiée ;
- archivée ;
- supprimée.

Pour les professeurs :

- ils pourront gérer leurs propres publications ;
- ils ne pourront pas modifier les publications des autres professeurs ;
- ils ne pourront pas accéder aux fonctions réservées à l'administration.

Pour l'administrateur :

- accès à toutes les publications ;
- modification ;
- suppression ;
- archivage ;
- possibilité de désactiver une publication ;
- possibilité de contrôler les contenus publiés.

---

# 14. Organisation des documents

Pour rendre le site facile à utiliser, les documents devront pouvoir être classés.

Exemples de catégories :

- Mathématiques ;
- Français ;
- Anglais ;
- Informatique ;
- Physique ;
- Chimie ;
- Histoire-Géographie ;
- Exercices ;
- Cours ;
- Devoirs ;
- Examens ;
- Résultats ;
- Communiqués ;
- Documents administratifs.

Il serait également utile de pouvoir associer une publication à une **classe ou un niveau**, par exemple :

- 6e ;
- 5e ;
- 4e ;
- 3e ;
- Seconde ;
- Première ;
- Terminale.

Les catégories devront être modifiables par l’administrateur.

---

# 15. Recherche de documents

Le site devrait intégrer un système de recherche simple.

Un visiteur pourrait rechercher :

- un professeur ;
- une matière ;
- un titre ;
- un exercice ;
- un cours ;
- une classe ;
- un mot-clé ;
- un résultat.

Exemple :

> Rechercher : « Mathématiques Terminale »

Le système afficherait les publications correspondantes.

Cette fonctionnalité sera particulièrement importante lorsque le nombre de documents augmentera.

---

# 16. Consultation et téléchargement

Les visiteurs pourront :

- ouvrir une publication ;
- lire le texte ;
- visualiser certains fichiers lorsque le navigateur le permet ;
- télécharger les documents autorisés.

Pour les PDF, il serait intéressant de permettre une visualisation directe dans le navigateur avant le téléchargement.

Pour les fichiers Word et Excel, le téléchargement pourra être privilégié.

---

# 17. Gestion des résultats scolaires

Le site pourra disposer d'une rubrique dédiée aux résultats.

Exemples :

- résultats d'examens ;
- résultats de concours ;
- résultats scolaires ;
- résultats du BEPC ;
- résultats du Probatoire ;
- résultats du Baccalauréat ;
- autres résultats officiels du CPO.

Pour les résultats contenant des informations personnelles sur les élèves, l’administrateur devra pouvoir choisir entre :

- publication publique ;
- publication protégée ;
- publication sous forme de document ;
- publication anonymisée.

Cette distinction est importante afin d'éviter de rendre publiques des informations personnelles qui ne devraient pas l'être.

---

# 18. Administration générale

L’administrateur devra disposer d’un tableau de bord.

Le tableau de bord devra permettre de voir notamment :

- nombre de professeurs ;
- nombre de publications ;
- nombre de documents ;
- dernières publications ;
- derniers comptes créés ;
- espace de stockage utilisé ;
- publications récentes ;
- éventuelles erreurs d’envoi ;
- activité récente.

---

# 19. Gestion des professeurs

L’administrateur pourra :

- créer un professeur ;
- modifier son profil ;
- activer son compte ;
- suspendre son compte ;
- réinitialiser son accès ;
- imposer un nouveau mot de passe à la prochaine connexion ;
- supprimer ou archiver un compte ;
- consulter ses publications.

Lorsqu’un professeur quitte l’établissement, son compte pourra être désactivé sans nécessairement supprimer immédiatement ses publications.

---

# 20. Rôles et permissions

Le système devra utiliser une gestion claire des rôles.

## Administrateur

L’administrateur pourra :

- gérer les professeurs ;
- gérer les publications ;
- publier sur la page d’accueil ;
- gérer les documents ;
- gérer les catégories ;
- gérer les résultats ;
- gérer les paramètres du site ;
- gérer les comptes ;
- consulter les journaux de sécurité ;
- effectuer les opérations de maintenance autorisées.

## Professeur

Le professeur pourra :

- se connecter à son espace ;
- modifier son profil selon les droits accordés ;
- publier du texte ;
- publier des documents ;
- publier des exercices ;
- modifier ses propres publications ;
- supprimer ses propres publications ;
- consulter ses propres publications.

## Visiteur

Le visiteur pourra :

- consulter le site ;
- consulter les informations publiques ;
- consulter les publications ;
- consulter les annonces ;
- consulter les résultats rendus publics ;
- télécharger les documents autorisés.

Le visiteur ne pourra pas publier et ne pourra pas accéder aux espaces privés.

---

# 21. Sécurité générale du site

La sécurité devra être considérée comme une exigence fondamentale du projet.

Le système devra notamment prévoir :

- HTTPS obligatoire ;
- mots de passe hachés avec un algorithme moderne et adapté ;
- protection contre les injections SQL ;
- protection contre les attaques XSS ;
- protection CSRF ;
- contrôle strict des permissions ;
- validation des fichiers uploadés ;
- limitation des tentatives de connexion ;
- protection contre les attaques par force brute ;
- gestion sécurisée des sessions ;
- protection des fichiers privés ;
- séparation entre fichiers publics et fichiers administratifs ;
- journalisation des connexions et actions importantes ;
- mises à jour régulières du serveur et des dépendances ;
- sauvegardes régulières ;
- procédure de restauration en cas d'incident.

Il faudra éviter d'exposer directement dans les URL les chemins internes des fichiers ou les informations sensibles.

---

# 22. Protection des fichiers

Les fichiers envoyés par les utilisateurs devront être contrôlés avant leur stockage.

Le système devra notamment vérifier :

- extension ;
- type MIME ;
- taille ;
- nom du fichier ;
- contenu lorsque cela est techniquement possible.

Les noms de fichiers devront être nettoyés afin d'éviter les problèmes de sécurité.

Les fichiers devront être stockés de manière à empêcher l'exécution de contenu dangereux.

---

# 23. Sauvegardes

Le site devra disposer d'un système de sauvegarde.

Il est recommandé de prévoir :

- sauvegarde de la base de données ;
- sauvegarde des fichiers ;
- sauvegardes automatiques ;
- plusieurs versions de sauvegarde ;
- stockage d'une copie sur un emplacement différent du serveur principal ;
- procédure de restauration testée régulièrement.

Une sauvegarde qui n'a jamais été testée ne doit pas être considérée comme une garantie suffisante.

---

# 24. Adaptation au contexte camerounais

Le site devra être conçu en tenant compte des conditions réelles d'utilisation au Cameroun.

Il devra être :

- compatible avec les smartphones ;
- rapide à charger ;
- optimisé pour les connexions lentes ;
- peu gourmand en données pour les pages classiques ;
- utilisable avec les principaux navigateurs mobiles ;
- adapté aux écrans de petite taille.

Les images devront être optimisées.

Les pages publiques devront éviter les animations trop lourdes qui ralentissent inutilement le chargement.

Les fichiers volumineux pourront rester disponibles au téléchargement sans alourdir inutilement la page d'accueil.

---

# 25. Interface utilisateur

L'interface devra être :

- moderne ;
- professionnelle ;
- claire ;
- simple ;
- adaptée à un établissement scolaire ;
- responsive ;
- facilement compréhensible par des utilisateurs non techniques.

La navigation pourrait comporter par exemple :

- Accueil ;
- Le CPO ;
- Actualités ;
- Annonces ;
- Enseignants ;
- Cours et exercices ;
- Résultats ;
- Examens ;
- Documents ;
- Contact.

Les rubriques exactes pourront être adaptées lors de la conception graphique.

---

# 26. Page dédiée à chaque professeur

Chaque professeur pourra disposer d'une page publique.

Exemple :

> **M. NOGUEM**  
> Professeur de Mathématiques

La page pourra afficher :

- présentation courte ;
- matière ;
- classes enseignées ;
- dernières publications ;
- cours ;
- exercices ;
- documents ;
- dates des publications.

Les visiteurs n'auront pas accès aux fonctions d'administration depuis cette page.

---

# 27. Système de publication

Le processus de publication devra être simple.

### Exemple pour un professeur

1. Connexion.
2. Ouverture de l'espace personnel.
3. Cliquer sur « Nouvelle publication ».
4. Saisir le titre.
5. Saisir le texte.
6. Choisir la matière et éventuellement la classe.
7. Ajouter un fichier si nécessaire.
8. Cliquer sur « Publier ».
9. Le serveur enregistre automatiquement la date et l'heure.
10. La publication apparaît sur la page du professeur.
11. Si elle est configurée comme publique, elle devient immédiatement visible par les visiteurs.

---

# 28. Modification et suppression

Un professeur devra pouvoir modifier ou supprimer ses propres publications.

Avant une suppression définitive, le système devrait demander une confirmation.

Pour plus de sécurité, une publication supprimée pourrait d'abord passer dans un état « corbeille » ou « archivée ».

L'administrateur pourra récupérer ou supprimer définitivement les éléments selon ses droits.

---

# 29. Notifications

Une fonctionnalité de notification pourra être ajoutée ultérieurement.

Par exemple :

- nouvelle publication d'un professeur ;
- nouvelle annonce ;
- nouveau document ;
- nouvelle information importante.

Les notifications pourront éventuellement être envoyées par e-mail ou par d'autres moyens, selon les besoins et les services disponibles.

Cette fonctionnalité n'est pas indispensable pour la première version.

---

# 30. Évolutivité du projet

La plateforme devra être conçue pour pouvoir évoluer.

Il faudra éviter de construire un système limité aux besoins actuels.

À l'avenir, le CPO pourrait ajouter :

- plusieurs administrateurs ;
- plusieurs niveaux de permissions ;
- comptes élèves ;
- comptes parents ;
- espace parents ;
- messagerie ;
- calendrier scolaire ;
- emploi du temps ;
- inscriptions en ligne ;
- préinscriptions ;
- paiement en ligne ;
- notifications ;
- statistiques ;
- application mobile ;
- espace de téléchargement avancé ;
- système de gestion des absences ;
- gestion des notes ;
- bulletin scolaire numérique.

Ces fonctionnalités ne sont pas obligatoires dans la première version, mais l'architecture technique devra permettre leur ajout ultérieur.

---

# 31. Protection des données personnelles

Le projet devra prévoir une politique claire concernant les données personnelles.

Les informations sensibles concernant les élèves, parents et professeurs ne devront pas être rendues publiques par défaut.

En particulier, les résultats scolaires devront être publiés avec prudence.

Il faudra définir :

- quelles informations sont publiques ;
- quelles informations sont réservées à l'administration ;
- quelles informations sont accessibles uniquement aux personnes autorisées ;
- combien de temps les données sont conservées ;
- comment les données sont supprimées ou archivées.

---

# 32. Journalisation et traçabilité

Pour les opérations importantes, le système devra conserver un journal.

Exemples :

- connexion d'un administrateur ;
- connexion d'un professeur ;
- création d'un compte ;
- modification d'un compte ;
- publication d'un document ;
- suppression d'un document ;
- modification d'une publication ;
- changement de mot de passe ;
- tentative de connexion échouée.

Le journal devra être accessible à l'administration selon les droits prévus.

---

# 33. Administration du stockage

Le système devra permettre de suivre l'utilisation du stockage.

L'administrateur pourra voir :

- espace total disponible ;
- espace utilisé ;
- espace restant ;
- documents les plus volumineux ;
- fichiers supprimés ou archivés.

Cela permettra d'éviter qu'un utilisateur remplisse accidentellement tout l'espace du serveur.

---

# 34. Gestion des erreurs

Le site devra afficher des messages simples et compréhensibles.

Exemples :

> « Le fichier est trop volumineux. La taille maximale autorisée est de 100 Mo. »

> « Ce type de fichier n'est pas autorisé. »

> « Votre publication a été enregistrée avec succès. »

Les erreurs techniques détaillées ne devront pas être affichées aux visiteurs, afin de ne pas divulguer d'informations utiles à une personne malveillante.

---

# 35. Technologies et architecture

Le choix exact des technologies pourra être défini lors de la conception technique.

L'architecture devra néanmoins respecter les principes suivants :

- séparation claire entre interface utilisateur, logique métier et base de données ;
- authentification sécurisée ;
- gestion des rôles et permissions ;
- API ou architecture permettant une évolution future ;
- base de données relationnelle adaptée ;
- stockage sécurisé des fichiers ;
- système de sauvegarde ;
- journalisation ;
- possibilité de mettre à jour les composants sans reconstruire toute la plateforme.

Une architecture moderne et maintenable devra être privilégiée plutôt qu'une solution construite uniquement pour répondre aux besoins immédiats.

---

# 36. Hébergement

L'hébergement devra être choisi en fonction :

- du nombre d'utilisateurs ;
- du volume de documents ;
- de la capacité de stockage ;
- de la bande passante ;
- de la qualité des sauvegardes ;
- de la sécurité ;
- de la disponibilité du serveur ;
- de la possibilité d'augmenter les ressources ultérieurement.

Il faudra notamment vérifier les limites réelles concernant :

- taille maximale des fichiers ;
- espace disque ;
- trafic mensuel ;
- nombre de connexions ;
- sauvegardes ;
- base de données.

---

# 37. Nom de domaine

Le site devra utiliser un nom de domaine officiel du CPO.

Le domaine devra être simple à retenir et clairement associé au Collège Privé de l'Ouest.

Exemple de structure :

> `www.cpo-bafoussam...`

Le nom exact devra être choisi après vérification de sa disponibilité.

---

# 38. Première version du projet — MVP

Pour commencer, la première version devrait se concentrer sur les fonctions essentielles.

### Partie publique

- page d'accueil ;
- présentation du CPO ;
- actualités ;
- annonces ;
- résultats publics ;
- liste des professeurs ;
- page de chaque professeur ;
- documents ;
- exercices ;
- recherche ;
- téléchargement des fichiers ;
- contact.

### Partie administration

- connexion administrateur ;
- tableau de bord ;
- création des comptes professeurs ;
- gestion des professeurs ;
- publication d'annonces ;
- publication de documents ;
- gestion des catégories ;
- gestion des résultats ;
- gestion des publications ;
- gestion du stockage.

### Partie professeur

- connexion sécurisée ;
- changement obligatoire du mot de passe lors de la première connexion ;
- tableau de bord personnel ;
- création de publications ;
- publication de textes ;
- envoi de PDF, Word, Excel, JPG et PNG ;
- modification de ses publications ;
- suppression de ses publications ;
- limite configurable de publications ;
- affichage automatique de la date de publication.

---

# 39. Critères de réussite

Le projet sera considéré comme fonctionnel lorsque :

- un visiteur pourra consulter le site sans créer de compte ;
- l'administrateur pourra créer un compte professeur ;
- le professeur pourra se connecter avec ses identifiants temporaires ;
- le professeur sera obligé de définir son propre mot de passe lors de sa première connexion ;
- le professeur pourra publier du texte ;
- le professeur pourra publier des documents ;
- les formats PDF, Word, Excel, JPG et PNG pourront être utilisés ;
- la date de publication sera générée automatiquement ;
- chaque professeur disposera de son espace ;
- l'administrateur pourra publier des annonces sur la page d'accueil ;
- les visiteurs pourront consulter les publications publiques ;
- les droits d'accès seront correctement séparés ;
- les fichiers seront protégés ;
- les mots de passe ne seront jamais stockés en clair ;
- les sauvegardes seront configurées ;
- le site fonctionnera correctement sur smartphone ;
- le système pourra évoluer lorsque le nombre de professeurs et de documents augmentera.

---

# 40. Points à décider avant le développement

Les éléments suivants devront être définis avant la mise en production :

1. Nom de domaine définitif.
2. Hébergeur.
3. Budget annuel d'hébergement.
4. Capacité de stockage initiale.
5. Taille maximale d'un fichier.
6. Nombre maximum de documents par professeur.
7. Liste officielle des matières.
8. Liste des classes et niveaux.
9. Nombre d'administrateurs.
10. Règles de publication des résultats.
11. Politique de conservation des données.
12. Identité visuelle du CPO : logo, couleurs, typographie.
13. Adresse e-mail officielle du collège.
14. Procédure de récupération des comptes.
15. Fréquence des sauvegardes.
16. Personnes responsables de l'administration du site.

---

# 41. Recommandation importante concernant la sécurité

Le site ne doit pas être conçu uniquement comme une simple page HTML avec un système de connexion ajouté par-dessus.

Comme la plateforme devra gérer des comptes, des documents et des publications, elle devra disposer d'un véritable système d'authentification, d'autorisation, de stockage sécurisé et de sauvegarde.

La sécurité devra être intégrée dès la conception et non ajoutée après la réalisation du site.

Il faudra également prévoir au moins un **compte administrateur de secours** ou une procédure sécurisée de récupération administrative, afin d'éviter qu'une perte d'accès au compte principal bloque définitivement la gestion du site.

---

# 42. Vision finale

Le site du **Collège Privé de l'Ouest (CPO)** doit devenir plus qu'une simple vitrine.

Il doit constituer une véritable **plateforme numérique de communication et de partage pédagogique** entre l'établissement et son environnement.

L'idée centrale est simple :

**Le public consulte librement les informations.  
Les professeurs publient depuis leur espace personnel.  
L'administration contrôle et organise l'ensemble de la plateforme.**

Cette architecture permettra au CPO de commencer avec un système relativement simple tout en disposant d'une base suffisamment solide pour intégrer plus tard de nouveaux services scolaires numériques.

