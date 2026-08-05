-- Donne les droits d'édition (editor) à tous les membres équipage sur le voyage partagé.
-- À exécuter si Paul/Yanis ne peuvent pas ajouter de contenu (erreur RLS).

update public.trip_members
set member_role = 'editor'
where member_role = 'viewer';
