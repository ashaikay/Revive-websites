SET session_replication_role = replica;

--
-- PostgreSQL database dump
--

-- \restrict dxZShimW5jxTlivh21RciXQBi79acmk3aRqDmaR2D0i3QWse12kGhdCd5Jgx7SV

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: workspaces; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."workspaces" ("id", "name", "slug", "status", "created_by", "created_at", "updated_at") VALUES
	('4e8cd22c-8ae8-4f45-91ef-b08607387f9b', 'REV RLS Workspace A', 'rev-rls-a-20260912193134554', 'active', '8b2c373e-73ce-4c35-b1aa-875a5d441bb4', '2026-09-12 19:31:36.058191+00', '2026-09-12 19:31:36.058191+00'),
	('1c527c55-7bc7-4c9c-97b0-a33f8e725075', 'REV RLS Workspace B', 'rev-rls-b-20260912193134554', 'active', 'd288c613-84f8-4530-b988-9984008427c4', '2026-09-12 19:31:37.026681+00', '2026-09-12 19:31:37.026681+00');


--
-- Data for Name: contacts; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."contacts" ("id", "workspace_id", "lifecycle", "name", "company", "email", "phone", "source", "estimated_value", "score", "last_interaction_at", "next_action_at", "owner_user_id", "created_at", "updated_at") VALUES
	('d81da4bc-c04e-44b2-b983-d395c0e7a46c', '4e8cd22c-8ae8-4f45-91ef-b08607387f9b', 'prospect', 'RLS Contact 20260912195951640', 'updated', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-09-12 19:59:52.86113+00', '2026-09-12 19:59:52.86113+00'),
	('255ec99e-a386-4835-8658-dfe4f36a7c72', '1c527c55-7bc7-4c9c-97b0-a33f8e725075', 'prospect', 'RLS B Contact 20260912195951640', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-09-12 20:00:10.324536+00', '2026-09-12 20:00:10.324536+00'),
	('24800789-81a3-4ba9-a14b-c9af221e54e7', '4e8cd22c-8ae8-4f45-91ef-b08607387f9b', 'prospect', 'REV positive contact A-phase2d1d-1789244876990', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-09-12 20:28:01.263512+00', '2026-09-12 20:28:01.263512+00'),
	('d0af4a35-55b7-47e6-af67-159e67c788bd', '1c527c55-7bc7-4c9c-97b0-a33f8e725075', 'prospect', 'REV positive contact B-phase2d1d-1789244876990', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-09-12 20:28:01.783226+00', '2026-09-12 20:28:01.783226+00'),
	('e353d903-cb42-47bf-9290-9adf91e593d2', '4e8cd22c-8ae8-4f45-91ef-b08607387f9b', 'prospect', 'REV positive contact A-phase2d1d-1789244901588', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-09-12 20:28:25.767285+00', '2026-09-12 20:28:25.767285+00'),
	('1c4aef51-d9e3-4cd9-93c2-9835b4e39551', '1c527c55-7bc7-4c9c-97b0-a33f8e725075', 'prospect', 'REV positive contact B-phase2d1d-1789244901588', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-09-12 20:28:26.766321+00', '2026-09-12 20:28:26.766321+00'),
	('849d338e-03f8-44e2-b356-337dd9edd21b', '4e8cd22c-8ae8-4f45-91ef-b08607387f9b', 'prospect', 'REV positive contact A-phase2d1d-1789244943241', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-09-12 20:29:06.734867+00', '2026-09-12 20:29:06.734867+00'),
	('77d1b4c9-fdf7-4b66-94c1-400dda289818', '1c527c55-7bc7-4c9c-97b0-a33f8e725075', 'prospect', 'REV positive contact B-phase2d1d-1789244943241', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-09-12 20:29:07.231796+00', '2026-09-12 20:29:07.231796+00');


--
-- Data for Name: goals; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."goals" ("id", "workspace_id", "title", "objective", "metric", "target_value", "current_value", "start_date", "target_date", "priority", "status", "created_at", "updated_at") VALUES
	('08e420f1-073c-44a5-8791-4d62b7f4a527', '4e8cd22c-8ae8-4f45-91ef-b08607387f9b', 'RLS Goal 20260912195951640', 'synthetic', 'count', 1, 1, '2026-09-12', '2026-09-13', 'low', 'draft', '2026-09-12 19:59:52.74947+00', '2026-09-12 19:59:52.74947+00'),
	('d09bc04b-57b5-4f2c-b9b9-ab1cafda45b7', '1c527c55-7bc7-4c9c-97b0-a33f8e725075', 'RLS B Goal 20260912195951640', 'synthetic', 'count', 1, 0, '2026-09-12', '2026-09-13', 'low', 'draft', '2026-09-12 20:00:10.233641+00', '2026-09-12 20:00:10.233641+00'),
	('233135db-2d86-4a21-953a-9d7aec130679', '4e8cd22c-8ae8-4f45-91ef-b08607387f9b', 'REV positive goal A-phase2d1d-1789244876990', 'synthetic Phase 2D.1D', 'count', 1, 0, '2026-09-12', '2026-09-13', 'low', 'draft', '2026-09-12 20:28:01.201491+00', '2026-09-12 20:28:01.201491+00'),
	('965bbf21-fd57-4152-bb34-f59257d8fd09', '1c527c55-7bc7-4c9c-97b0-a33f8e725075', 'REV positive goal B-phase2d1d-1789244876990', 'synthetic Phase 2D.1D', 'count', 1, 0, '2026-09-12', '2026-09-13', 'low', 'draft', '2026-09-12 20:28:01.731491+00', '2026-09-12 20:28:01.731491+00'),
	('f2c3694d-072a-4572-9053-d38ef13ab619', '4e8cd22c-8ae8-4f45-91ef-b08607387f9b', 'REV positive goal A-phase2d1d-1789244901588', 'synthetic Phase 2D.1D', 'count', 1, 0, '2026-09-12', '2026-09-13', 'low', 'draft', '2026-09-12 20:28:25.565603+00', '2026-09-12 20:28:25.565603+00'),
	('a3e2bc8e-a8f8-40ed-b7fc-14f1ed195858', '1c527c55-7bc7-4c9c-97b0-a33f8e725075', 'REV positive goal B-phase2d1d-1789244901588', 'synthetic Phase 2D.1D', 'count', 1, 0, '2026-09-12', '2026-09-13', 'low', 'draft', '2026-09-12 20:28:26.68254+00', '2026-09-12 20:28:26.68254+00'),
	('e2d74a35-48a8-4900-9361-8bd5047cfc7b', '4e8cd22c-8ae8-4f45-91ef-b08607387f9b', 'REV positive goal A-phase2d1d-1789244943241', 'synthetic Phase 2D.1D', 'count', 1, 0, '2026-09-12', '2026-09-13', 'low', 'draft', '2026-09-12 20:29:06.665514+00', '2026-09-12 20:29:06.665514+00'),
	('78f0f05d-be8c-48b3-a2f9-886e7507841b', '1c527c55-7bc7-4c9c-97b0-a33f8e725075', 'REV positive goal B-phase2d1d-1789244943241', 'synthetic Phase 2D.1D', 'count', 1, 0, '2026-09-12', '2026-09-13', 'low', 'draft', '2026-09-12 20:29:07.18111+00', '2026-09-12 20:29:07.18111+00');


--
-- Data for Name: opportunities; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: rev_actions; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."rev_actions" ("id", "workspace_id", "goal_id", "contact_id", "action_type", "title", "description", "rationale", "requires_approval", "status", "execution_status", "proposed_at", "approved_at", "executed_at", "outcome_summary", "opportunity_id") VALUES
	('7a7eed47-81ee-4281-838d-4a6ee8bd55c3', '4e8cd22c-8ae8-4f45-91ef-b08607387f9b', '08e420f1-073c-44a5-8791-4d62b7f4a527', 'd81da4bc-c04e-44b2-b983-d395c0e7a46c', 'test', 'RLS Action 20260912195951640', 'synthetic', 'updated', true, 'proposed', 'not_started', '2026-09-12 19:59:52.955015+00', NULL, NULL, NULL, NULL),
	('df767ebe-7cd7-400d-98a9-b0ac92cb9b82', '1c527c55-7bc7-4c9c-97b0-a33f8e725075', 'd09bc04b-57b5-4f2c-b9b9-ab1cafda45b7', '255ec99e-a386-4835-8658-dfe4f36a7c72', 'test', 'RLS B Action 20260912195951640', 'synthetic', NULL, true, 'proposed', 'not_started', '2026-09-12 20:00:10.420045+00', NULL, NULL, NULL, NULL),
	('e19c0374-d2e2-4d79-a606-6eaa73c77b60', '4e8cd22c-8ae8-4f45-91ef-b08607387f9b', '233135db-2d86-4a21-953a-9d7aec130679', '24800789-81a3-4ba9-a14b-c9af221e54e7', 'test', 'REV positive action A-phase2d1d-1789244876990', 'synthetic Phase 2D.1D', NULL, true, 'proposed', 'not_started', '2026-09-12 20:28:01.333272+00', NULL, NULL, NULL, NULL),
	('bda15dd0-7966-470d-b6c3-dcd1fd508c90', '1c527c55-7bc7-4c9c-97b0-a33f8e725075', '965bbf21-fd57-4152-bb34-f59257d8fd09', 'd0af4a35-55b7-47e6-af67-159e67c788bd', 'test', 'REV positive action B-phase2d1d-1789244876990', 'synthetic Phase 2D.1D', NULL, true, 'proposed', 'not_started', '2026-09-12 20:28:01.84095+00', NULL, NULL, NULL, NULL),
	('e86cd032-aaab-42ab-93f5-ef7ea82ba35d', '4e8cd22c-8ae8-4f45-91ef-b08607387f9b', 'f2c3694d-072a-4572-9053-d38ef13ab619', 'e353d903-cb42-47bf-9290-9adf91e593d2', 'test', 'REV positive action A-phase2d1d-1789244901588', 'synthetic Phase 2D.1D', NULL, true, 'proposed', 'not_started', '2026-09-12 20:28:25.899219+00', NULL, NULL, NULL, NULL),
	('2c55aff4-4777-4474-a662-6c4002bed95e', '1c527c55-7bc7-4c9c-97b0-a33f8e725075', 'a3e2bc8e-a8f8-40ed-b7fc-14f1ed195858', '1c4aef51-d9e3-4cd9-93c2-9835b4e39551', 'test', 'REV positive action B-phase2d1d-1789244901588', 'synthetic Phase 2D.1D', NULL, true, 'proposed', 'not_started', '2026-09-12 20:28:26.815706+00', NULL, NULL, NULL, NULL),
	('e5598c33-e80c-4255-aa0c-3adfb22c08ac', '4e8cd22c-8ae8-4f45-91ef-b08607387f9b', 'e2d74a35-48a8-4900-9361-8bd5047cfc7b', '849d338e-03f8-44e2-b356-337dd9edd21b', 'test', 'REV positive action A-phase2d1d-1789244943241', 'synthetic Phase 2D.1D', NULL, true, 'proposed', 'not_started', '2026-09-12 20:29:06.799348+00', NULL, NULL, NULL, NULL),
	('09af70c5-0254-4e6d-aac2-3cae7a038cff', '1c527c55-7bc7-4c9c-97b0-a33f8e725075', '78f0f05d-be8c-48b3-a2f9-886e7507841b', '77d1b4c9-fdf7-4b66-94c1-400dda289818', 'test', 'REV positive action B-phase2d1d-1789244943241', 'synthetic Phase 2D.1D', NULL, true, 'proposed', 'not_started', '2026-09-12 20:29:07.283974+00', NULL, NULL, NULL, NULL);


--
-- Data for Name: approvals; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."approvals" ("id", "workspace_id", "rev_action_id", "requested_at", "decided_at", "decided_by", "decision", "notes") VALUES
	('a46b1f59-cfb4-48bf-bb6e-77ca4d4269a6', '4e8cd22c-8ae8-4f45-91ef-b08607387f9b', '7a7eed47-81ee-4281-838d-4a6ee8bd55c3', '2026-09-12 19:59:53.048647+00', NULL, NULL, NULL, 'updated'),
	('7977a786-9d07-459f-9815-cca201eba88c', '1c527c55-7bc7-4c9c-97b0-a33f8e725075', 'df767ebe-7cd7-400d-98a9-b0ac92cb9b82', '2026-09-12 20:00:10.528002+00', NULL, NULL, NULL, NULL),
	('be19d4c6-941d-4065-991e-528e6bba7781', '4e8cd22c-8ae8-4f45-91ef-b08607387f9b', 'e19c0374-d2e2-4d79-a606-6eaa73c77b60', '2026-09-12 20:28:01.392002+00', NULL, NULL, NULL, NULL),
	('9617318e-31ea-4390-9f85-63c16be5d501', '1c527c55-7bc7-4c9c-97b0-a33f8e725075', 'bda15dd0-7966-470d-b6c3-dcd1fd508c90', '2026-09-12 20:28:01.87739+00', NULL, NULL, NULL, NULL),
	('d3d5819f-9966-4441-a3b7-c6702fbaf92d', '4e8cd22c-8ae8-4f45-91ef-b08607387f9b', 'e86cd032-aaab-42ab-93f5-ef7ea82ba35d', '2026-09-12 20:28:26.093368+00', NULL, NULL, NULL, NULL),
	('750b6f75-cdbc-424e-a030-851cf26b4370', '1c527c55-7bc7-4c9c-97b0-a33f8e725075', '2c55aff4-4777-4474-a662-6c4002bed95e', '2026-09-12 20:28:26.897632+00', NULL, NULL, NULL, NULL),
	('3e2ecc51-1b91-4ee2-92d0-8871f08685f7', '4e8cd22c-8ae8-4f45-91ef-b08607387f9b', 'e5598c33-e80c-4255-aa0c-3adfb22c08ac', '2026-09-12 20:29:06.986323+00', NULL, NULL, NULL, NULL),
	('878d343a-a4bd-4672-bf12-12bd35c0c219', '1c527c55-7bc7-4c9c-97b0-a33f8e725075', '09af70c5-0254-4e6d-aac2-3cae7a038cff', '2026-09-12 20:29:07.341913+00', NULL, NULL, NULL, NULL);


--
-- Data for Name: audit_log; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."audit_log" ("id", "workspace_id", "actor_user_id", "actor_type", "action", "resource_type", "resource_id", "metadata", "timestamp") VALUES
	('545cba7f-9404-4c3d-a0e7-969c497557be', '4e8cd22c-8ae8-4f45-91ef-b08607387f9b', '8b2c373e-73ce-4c35-b1aa-875a5d441bb4', 'user', 'workspace.created', 'workspace', '4e8cd22c-8ae8-4f45-91ef-b08607387f9b', '{"source": "bootstrap"}', '2026-09-12 19:31:36.058191+00'),
	('fd76d4fb-1010-4c27-bd32-b368907e0ffc', '1c527c55-7bc7-4c9c-97b0-a33f8e725075', 'd288c613-84f8-4530-b988-9984008427c4', 'user', 'workspace.created', 'workspace', '1c527c55-7bc7-4c9c-97b0-a33f8e725075', '{"source": "bootstrap"}', '2026-09-12 19:31:37.026681+00'),
	('25d5ee8e-9116-4754-9b4b-a194347af4ca', '4e8cd22c-8ae8-4f45-91ef-b08607387f9b', '8b2c373e-73ce-4c35-b1aa-875a5d441bb4', 'user', 'rls.matrix', 'test', NULL, '{}', '2026-09-12 19:59:53.272522+00'),
	('7eddaf62-9bef-4225-9507-6f520675658e', '1c527c55-7bc7-4c9c-97b0-a33f8e725075', 'd288c613-84f8-4530-b988-9984008427c4', 'user', 'rls.matrix', 'test', NULL, '{}', '2026-09-12 20:00:10.768437+00'),
	('82f3e289-fc83-4c82-be62-cc08177abaa8', '4e8cd22c-8ae8-4f45-91ef-b08607387f9b', '8b2c373e-73ce-4c35-b1aa-875a5d441bb4', 'user', 'phase2d1d.A-phase2d1d-1789244876990', 'test', NULL, '{}', '2026-09-12 20:28:01.615545+00'),
	('cd3e2d55-e03b-46ab-94b2-5291526ff8a4', '1c527c55-7bc7-4c9c-97b0-a33f8e725075', 'd288c613-84f8-4530-b988-9984008427c4', 'user', 'phase2d1d.B-phase2d1d-1789244876990', 'test', NULL, '{}', '2026-09-12 20:28:01.981761+00'),
	('40197985-4532-4f5a-afe7-c1f5d7f41fe4', '4e8cd22c-8ae8-4f45-91ef-b08607387f9b', '8b2c373e-73ce-4c35-b1aa-875a5d441bb4', 'user', 'phase2d1d.A-phase2d1d-1789244901588', 'test', NULL, '{}', '2026-09-12 20:28:26.41409+00'),
	('ddbf015b-b039-48d1-93b8-0149e9a30675', '1c527c55-7bc7-4c9c-97b0-a33f8e725075', 'd288c613-84f8-4530-b988-9984008427c4', 'user', 'phase2d1d.B-phase2d1d-1789244901588', 'test', NULL, '{}', '2026-09-12 20:28:27.020116+00'),
	('c6360318-fa34-4428-85e1-734317fa083c', '4e8cd22c-8ae8-4f45-91ef-b08607387f9b', '8b2c373e-73ce-4c35-b1aa-875a5d441bb4', 'user', 'phase2d1d.A-phase2d1d-1789244943241', 'test', NULL, '{}', '2026-09-12 20:29:07.080269+00'),
	('fe79e343-61fc-4a28-87e1-baa2ec30c7a4', '1c527c55-7bc7-4c9c-97b0-a33f8e725075', 'd288c613-84f8-4530-b988-9984008427c4', 'user', 'phase2d1d.B-phase2d1d-1789244943241', 'test', NULL, '{}', '2026-09-12 20:29:07.450726+00');


--
-- Data for Name: business_memory_events; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."business_memory_events" ("id", "workspace_id", "event_type", "entity_type", "entity_id", "title", "summary", "structured_data", "occurred_at", "created_by_type", "created_by_id") VALUES
	('f34dfd5b-48e6-44dd-853d-e1ec7dcc5ec9', '4e8cd22c-8ae8-4f45-91ef-b08607387f9b', 'test', 'test', NULL, 'RLS Memory 20260912195951640', 'synthetic', '{}', '2026-09-12 00:00:00+00', 'user', '8b2c373e-73ce-4c35-b1aa-875a5d441bb4'),
	('da94437b-847a-4204-aa06-8155333e291d', '1c527c55-7bc7-4c9c-97b0-a33f8e725075', 'test', 'test', NULL, 'RLS B Memory 20260912195951640', 'synthetic', '{}', '2026-09-12 00:00:00+00', 'user', 'd288c613-84f8-4530-b988-9984008427c4'),
	('b38cd74b-f13e-4f57-8eea-4f0d4bc525c6', '4e8cd22c-8ae8-4f45-91ef-b08607387f9b', 'test', 'test', NULL, 'REV positive memory A-phase2d1d-1789244876990', 'synthetic Phase 2D.1D', '{}', '2026-09-12 00:00:00+00', 'user', '8b2c373e-73ce-4c35-b1aa-875a5d441bb4'),
	('bb26e421-3960-4615-931a-6e34aeb8b577', '1c527c55-7bc7-4c9c-97b0-a33f8e725075', 'test', 'test', NULL, 'REV positive memory B-phase2d1d-1789244876990', 'synthetic Phase 2D.1D', '{}', '2026-09-12 00:00:00+00', 'user', 'd288c613-84f8-4530-b988-9984008427c4'),
	('2ce7b61f-ff1a-4b40-a2f9-c7188240c603', '4e8cd22c-8ae8-4f45-91ef-b08607387f9b', 'test', 'test', NULL, 'REV positive memory A-phase2d1d-1789244901588', 'synthetic Phase 2D.1D', '{}', '2026-09-12 00:00:00+00', 'user', '8b2c373e-73ce-4c35-b1aa-875a5d441bb4'),
	('2f068e7d-8e45-43a7-b3de-bfd023b266ff', '1c527c55-7bc7-4c9c-97b0-a33f8e725075', 'test', 'test', NULL, 'REV positive memory B-phase2d1d-1789244901588', 'synthetic Phase 2D.1D', '{}', '2026-09-12 00:00:00+00', 'user', 'd288c613-84f8-4530-b988-9984008427c4'),
	('3604d6bd-5b8d-414a-b01e-200d7999d03c', '4e8cd22c-8ae8-4f45-91ef-b08607387f9b', 'test', 'test', NULL, 'REV positive memory A-phase2d1d-1789244943241', 'synthetic Phase 2D.1D', '{}', '2026-09-12 00:00:00+00', 'user', '8b2c373e-73ce-4c35-b1aa-875a5d441bb4'),
	('dde5ad25-267a-4483-8d82-e6fd7723c41e', '1c527c55-7bc7-4c9c-97b0-a33f8e725075', 'test', 'test', NULL, 'REV positive memory B-phase2d1d-1789244943241', 'synthetic Phase 2D.1D', '{}', '2026-09-12 00:00:00+00', 'user', 'd288c613-84f8-4530-b988-9984008427c4');


--
-- Data for Name: business_profiles; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: business_services; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."business_services" ("id", "workspace_id", "name", "description", "price_information", "active") VALUES
	('1f7a107d-39be-45fe-8362-963a6e484d70', '4e8cd22c-8ae8-4f45-91ef-b08607387f9b', 'RLS Service 20260912195951640', 'updated', NULL, true),
	('7df4fb95-5e45-4a7e-ab7a-30562d7c04df', '1c527c55-7bc7-4c9c-97b0-a33f8e725075', 'RLS B Service 20260912195951640', 'updated', NULL, true),
	('c135db0d-2545-454f-a10d-df5a6b0bbd12', '4e8cd22c-8ae8-4f45-91ef-b08607387f9b', 'REV positive service A-phase2d1d-1789244876990', 'synthetic Phase 2D.1D', NULL, true),
	('a1f7fc93-99b2-4c00-b483-14bdaab3abc7', '1c527c55-7bc7-4c9c-97b0-a33f8e725075', 'REV positive service B-phase2d1d-1789244876990', 'synthetic Phase 2D.1D', NULL, true),
	('2da61439-03c7-4071-8717-bc3122125d82', '4e8cd22c-8ae8-4f45-91ef-b08607387f9b', 'REV positive service A-phase2d1d-1789244901588', 'synthetic Phase 2D.1D', NULL, true),
	('443b9e7a-be87-4027-99b3-63d7826d38d8', '1c527c55-7bc7-4c9c-97b0-a33f8e725075', 'REV positive service B-phase2d1d-1789244901588', 'synthetic Phase 2D.1D', NULL, true),
	('92815181-70c5-4c1b-b007-b8e69533e67b', '4e8cd22c-8ae8-4f45-91ef-b08607387f9b', 'REV positive service A-phase2d1d-1789244943241', 'synthetic Phase 2D.1D', NULL, true),
	('41c5ee95-053e-45a2-ab83-56314b2b6e21', '1c527c55-7bc7-4c9c-97b0-a33f8e725075', 'REV positive service B-phase2d1d-1789244943241', 'synthetic Phase 2D.1D', NULL, true);


--
-- Data for Name: contact_suppressions; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: quotes; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."quotes" ("id", "created_at", "full_name", "business_name", "email", "phone", "contact_method", "project_type", "current_url", "business_type", "target_audience", "page_count", "budget", "pages_needed", "features_needed", "branding_ready", "content_ready", "assets_ready", "launch_date", "start_soon", "deposit_ok", "project_details", "status", "selected_package", "payment_option", "payment_link_label", "maintenance_plan", "design_addons", "payment_status", "consultation_status") VALUES
	('778bacf0-49f5-49bb-99fd-3230918f2139', '2026-03-20 20:46:37.41228+00', 'd', NULL, 'demo@example.com', NULL, 'phone', 'new', NULL, 'individual', NULL, '10+', '2000_5000', '{blog}', '{ecommerce}', 'no', NULL, 'partial', '2026-03-25', 'no', 'discuss', 'ddddddddddddddddddddddddddddddddddddd', 'new', NULL, NULL, NULL, NULL, NULL, 'unpaid', 'not_booked'),
	('b42692c9-8d26-427c-8905-58d5f009f5a3', '2026-03-20 22:13:46.618635+00', 'e444', '', 'revive955@gmail.com', '', 'email', 'new', '', 'startup', '', '2-3', '500_1000', '{home}', '{booking,social}', NULL, 'yes', 'partial', '2000-04-06', 'yes', 'discuss', 'yyyyyyyyyyyyyyyyyyyyyyyyy', 'new', NULL, NULL, NULL, NULL, NULL, 'unpaid', 'not_booked'),
	('4a6a84b5-4778-4912-bfc8-67ab5c1267ba', '2026-07-19 14:07:45.029914+00', 'Hannah Melotto', 'Melotto Group', 'hannah.melotto@melottogroup.com', '2158218810', 'email', 'new', NULL, 'individual', NULL, '1', 'under_500', '{}', '{}', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'new', NULL, NULL, NULL, NULL, '{}', 'unpaid', 'not_booked');


--
-- Data for Name: workspace_members; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."workspace_members" ("workspace_id", "user_id", "role", "status", "joined_at") VALUES
	('4e8cd22c-8ae8-4f45-91ef-b08607387f9b', '8b2c373e-73ce-4c35-b1aa-875a5d441bb4', 'owner', 'active', '2026-09-12 19:31:36.058191+00'),
	('1c527c55-7bc7-4c9c-97b0-a33f8e725075', 'd288c613-84f8-4530-b988-9984008427c4', 'owner', 'active', '2026-09-12 19:31:37.026681+00');


--
-- PostgreSQL database dump complete
--

-- \unrestrict dxZShimW5jxTlivh21RciXQBi79acmk3aRqDmaR2D0i3QWse12kGhdCd5Jgx7SV

RESET ALL;
