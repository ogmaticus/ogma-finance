-- Финансы: начальная схема PostgreSQL (сервер v2).
-- Таблицы бюджета повторяют схему D1 версии 1.9.x, чтобы логика server/budget.ts работала без изменений.

CREATE TABLE budget_documents (
  owner text PRIMARY KEY,
  revision integer NOT NULL,
  data text NOT NULL,
  updated_at text NOT NULL
);

CREATE TABLE budget_versions (
  owner text NOT NULL,
  revision integer NOT NULL,
  data text NOT NULL,
  created_at text NOT NULL,
  PRIMARY KEY (owner, revision)
);

CREATE TABLE screenshot_files (
  id text PRIMARY KEY,
  owner text NOT NULL,
  hash text NOT NULL,
  object_key text NOT NULL,
  name text NOT NULL,
  mime text NOT NULL,
  size integer NOT NULL,
  source_id text,
  created_at text NOT NULL
);
CREATE UNIQUE INDEX screenshot_owner_hash ON screenshot_files (owner, hash);
CREATE INDEX screenshot_owner_created_id ON screenshot_files (owner, created_at, id);

CREATE TABLE owner_data_state (
  owner text PRIMARY KEY,
  generation integer NOT NULL,
  deleting integer NOT NULL
);

-- Пользователи и вход по коду на почту.
CREATE TABLE users (
  id text PRIMARY KEY,
  email text NOT NULL UNIQUE,
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);

CREATE TABLE login_codes (
  email text PRIMARY KEY,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user ON sessions (user_id);
CREATE INDEX sessions_expires ON sessions (expires_at);

-- Журнал согласий на обработку персональных данных (152-ФЗ).
-- Хранит хеш почты, чтобы подтвердить факт согласия и после удаления аккаунта.
CREATE TABLE consents (
  id bigserial PRIMARY KEY,
  user_id text,
  email_hash text NOT NULL,
  document text NOT NULL,
  version text NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  ip text,
  user_agent text,
  withdrawn_at timestamptz
);
CREATE INDEX consents_user ON consents (user_id);

-- Ограничение частоты запросов (коды входа, попытки).
CREATE TABLE rate_limits (
  key text PRIMARY KEY,
  window_start timestamptz NOT NULL,
  count integer NOT NULL
);
