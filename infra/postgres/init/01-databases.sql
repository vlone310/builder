-- Local only: runs once, when the Postgres volume is first created.
-- Keycloak keeps its data in its own database and user.
CREATE USER keycloak WITH PASSWORD 'keycloak';
CREATE DATABASE keycloak OWNER keycloak;
-- Databases for the test suites (TEST_DATABASE_URL, E2E_DATABASE_URL).
CREATE DATABASE builder_test OWNER builder;
CREATE DATABASE builder_e2e OWNER builder;
