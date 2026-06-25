-- ============================================================
-- LumeX — Migration 040: Study MVP schema (§7.1 study + §7.6 catalog)
-- ============================================================
-- Backing tables for the course-tuned study tool (a second Lumex product living
-- in the same database as LumeX Fud). Creates everything the safe-lane features
-- persist to: enrollments, study sessions, weak-topic map, flashcards (SM-2),
-- the daily free-practice cap, study streaks, the AI response cache, and the
-- CCMAS course catalog.
--
-- ⚠️  NEEDS HUMAN APPROVAL — LOCKED LANE (database migration). Do NOT merge or
--     run against any environment until Chibuike has reviewed it.
--
-- DECISIONS FOR REVIEW:
--  • Table names are prefixed `study_` (spec §7.1/§7.6 uses bare names like
--    `courses`, `streaks`, `faculties`). Reason: this DB already holds the food
--    app; bare `streaks` collides conceptually with `customer_streaks` (037) and
--    bare `courses`/`faculties` are ambiguous. Rename if you prefer the spec's
--    bare names.
--  • `user_id` columns reference `customers(id)` — study users are students, who
--    are customers. (Spec says "user_id"; ownership is still enforced in API
--    routes, with RLS as defence-in-depth, matching the rest of the codebase.)
--  • Catalog `id`s are TEXT slugs (e.g. 'biochemistry') to match lib/catalog and
--    let ingestion upsert idempotently by slug.
--  • Per the human-supplied ABSU catalog: faculties/programmes/catalog_courses
--    all carry `confidence` + `verified` (default false). Nothing is authoritative
--    until the gated human-verify step flips `verified` (§7.6).
--
-- RLS: enabled on every table (rule 25). User-owned tables get an owner-read
-- policy (phone from the JWT, mirroring 035/037) + service_role full access.
-- Reference/catalog tables are service_role-only (served via API) — no
-- `USING (true)` anywhere (rule 23).
--
-- Idempotent — safe to re-run.
-- ============================================================

-- ─── §7.1 Study: canonical courses a student studies ─────────────────────────
CREATE TABLE IF NOT EXISTS study_courses (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code       TEXT NOT NULL UNIQUE,
  title      TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE study_courses ENABLE ROW LEVEL SECURITY;

-- enrollments: which courses a student is taking. user_id ALWAYS from the JWT.
CREATE TABLE IF NOT EXISTS study_enrollments (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES customers(id)     ON DELETE CASCADE,
  course_id  UUID NOT NULL REFERENCES study_courses(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, course_id)
);
ALTER TABLE study_enrollments ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_study_enrollments_user   ON study_enrollments (user_id);
CREATE INDEX IF NOT EXISTS idx_study_enrollments_course ON study_enrollments (course_id);

-- study_sessions: one row per ask/practice interaction (analytics + streaks).
CREATE TABLE IF NOT EXISTS study_sessions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES customers(id)     ON DELETE CASCADE,
  course_id  UUID NOT NULL REFERENCES study_courses(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('ask', 'practice')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE study_sessions ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_study_sessions_user   ON study_sessions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_study_sessions_course ON study_sessions (course_id);

-- weak-topic map: lower score = weaker. Bumped down on wrong, up on right.
CREATE TABLE IF NOT EXISTS study_weak_topics (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   UUID NOT NULL REFERENCES customers(id)     ON DELETE CASCADE,
  course_id UUID NOT NULL REFERENCES study_courses(id) ON DELETE CASCADE,
  topic     TEXT NOT NULL,
  score     INTEGER NOT NULL DEFAULT 0,
  last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, course_id, topic)
);
ALTER TABLE study_weak_topics ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_study_weak_topics_user   ON study_weak_topics (user_id);
CREATE INDEX IF NOT EXISTS idx_study_weak_topics_course ON study_weak_topics (course_id);

-- flashcard decks + cards (basic SM-2 spaced repetition).
CREATE TABLE IF NOT EXISTS study_flashcard_decks (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES customers(id)     ON DELETE CASCADE,
  course_id  UUID NOT NULL REFERENCES study_courses(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE study_flashcard_decks ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_study_decks_user   ON study_flashcard_decks (user_id);
CREATE INDEX IF NOT EXISTS idx_study_decks_course ON study_flashcard_decks (course_id);

CREATE TABLE IF NOT EXISTS study_flashcards (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deck_id     UUID NOT NULL REFERENCES study_flashcard_decks(id) ON DELETE CASCADE,
  front       TEXT NOT NULL,
  back        TEXT NOT NULL,
  ease_factor REAL NOT NULL DEFAULT 2.5 CHECK (ease_factor >= 1.3),
  due_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE study_flashcards ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_study_flashcards_deck ON study_flashcards (deck_id);
CREATE INDEX IF NOT EXISTS idx_study_flashcards_due  ON study_flashcards (deck_id, due_at);

-- daily free-practice cap (the business model). One row per user per day.
CREATE TABLE IF NOT EXISTS study_daily_usage (
  user_id        UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  usage_date     DATE NOT NULL,
  practice_count INTEGER NOT NULL DEFAULT 0 CHECK (practice_count >= 0),
  PRIMARY KEY (user_id, usage_date)
);
ALTER TABLE study_daily_usage ENABLE ROW LEVEL SECURITY;

-- study streaks (distinct from the food app's customer_streaks).
CREATE TABLE IF NOT EXISTS study_streaks (
  user_id          UUID PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
  current_streak   INTEGER NOT NULL DEFAULT 0 CHECK (current_streak >= 0),
  longest_streak   INTEGER NOT NULL DEFAULT 0 CHECK (longest_streak >= 0),
  last_active_date DATE,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE study_streaks ENABLE ROW LEVEL SECURITY;

-- AI response cache (cost control). Shared across all users — server-only.
CREATE TABLE IF NOT EXISTS study_ai_cache (
  cache_key  TEXT PRIMARY KEY,
  course_id  UUID REFERENCES study_courses(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('ask', 'practice')),
  payload    JSONB NOT NULL,
  model      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE study_ai_cache ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_study_ai_cache_course ON study_ai_cache (course_id);

-- ─── §7.6 CCMAS catalog (shared reference; ingested + human-verified) ─────────
CREATE TABLE IF NOT EXISTS study_faculties (
  id         TEXT PRIMARY KEY,                       -- slug, e.g. 'biological-physical-sciences'
  name       TEXT NOT NULL,
  confidence TEXT NOT NULL DEFAULT 'medium' CHECK (confidence IN ('low', 'medium', 'high')),
  verified   BOOLEAN NOT NULL DEFAULT FALSE,
  source_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE study_faculties ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS study_programmes (
  id         TEXT PRIMARY KEY,                       -- slug, e.g. 'biochemistry'
  faculty_id TEXT NOT NULL REFERENCES study_faculties(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  confidence TEXT NOT NULL DEFAULT 'medium' CHECK (confidence IN ('low', 'medium', 'high')),
  verified   BOOLEAN NOT NULL DEFAULT FALSE,
  source_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE study_programmes ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_study_programmes_faculty ON study_programmes (faculty_id);

CREATE TABLE IF NOT EXISTS study_catalog_courses (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  programme_id TEXT NOT NULL REFERENCES study_programmes(id) ON DELETE CASCADE,
  level        INTEGER NOT NULL CHECK (level IN (100, 200, 300, 400, 500)),
  semester     INTEGER NOT NULL CHECK (semester IN (1, 2)),
  code         TEXT NOT NULL,
  title        TEXT NOT NULL,
  credit_units INTEGER NOT NULL DEFAULT 0 CHECK (credit_units >= 0),
  kind         TEXT NOT NULL CHECK (kind IN ('core', 'elective')),
  source_url   TEXT,
  confidence   TEXT NOT NULL DEFAULT 'medium' CHECK (confidence IN ('low', 'medium', 'high')),
  verified     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (programme_id, level, semester, code)
);
ALTER TABLE study_catalog_courses ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_study_catalog_courses_bucket
  ON study_catalog_courses (programme_id, level, semester);

-- ═══ RLS POLICIES ════════════════════════════════════════════════════════════
-- Owner-read helper pattern (mirrors 035/037):
--   <user column> IN (SELECT id FROM customers WHERE phone = (auth.jwt() ->> 'phone'))

-- service_role full access on every table (server does the real work).
DROP POLICY IF EXISTS "svc_study_courses"        ON study_courses;
CREATE POLICY "svc_study_courses"        ON study_courses        FOR ALL USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS "svc_study_enrollments"    ON study_enrollments;
CREATE POLICY "svc_study_enrollments"    ON study_enrollments    FOR ALL USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS "svc_study_sessions"       ON study_sessions;
CREATE POLICY "svc_study_sessions"       ON study_sessions       FOR ALL USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS "svc_study_weak_topics"    ON study_weak_topics;
CREATE POLICY "svc_study_weak_topics"    ON study_weak_topics    FOR ALL USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS "svc_study_decks"          ON study_flashcard_decks;
CREATE POLICY "svc_study_decks"          ON study_flashcard_decks FOR ALL USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS "svc_study_flashcards"     ON study_flashcards;
CREATE POLICY "svc_study_flashcards"     ON study_flashcards     FOR ALL USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS "svc_study_daily_usage"    ON study_daily_usage;
CREATE POLICY "svc_study_daily_usage"    ON study_daily_usage    FOR ALL USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS "svc_study_streaks"        ON study_streaks;
CREATE POLICY "svc_study_streaks"        ON study_streaks        FOR ALL USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS "svc_study_ai_cache"       ON study_ai_cache;
CREATE POLICY "svc_study_ai_cache"       ON study_ai_cache       FOR ALL USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS "svc_study_faculties"      ON study_faculties;
CREATE POLICY "svc_study_faculties"      ON study_faculties      FOR ALL USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS "svc_study_programmes"     ON study_programmes;
CREATE POLICY "svc_study_programmes"     ON study_programmes     FOR ALL USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS "svc_study_catalog_courses" ON study_catalog_courses;
CREATE POLICY "svc_study_catalog_courses" ON study_catalog_courses FOR ALL USING (auth.role() = 'service_role');

-- Owner-read on user-owned tables (lets a student read their own rows directly).
DROP POLICY IF EXISTS "own_study_enrollments" ON study_enrollments;
CREATE POLICY "own_study_enrollments" ON study_enrollments FOR SELECT USING (
  user_id IN (SELECT id FROM customers WHERE phone = (auth.jwt() ->> 'phone'))
);
DROP POLICY IF EXISTS "own_study_sessions" ON study_sessions;
CREATE POLICY "own_study_sessions" ON study_sessions FOR SELECT USING (
  user_id IN (SELECT id FROM customers WHERE phone = (auth.jwt() ->> 'phone'))
);
DROP POLICY IF EXISTS "own_study_weak_topics" ON study_weak_topics;
CREATE POLICY "own_study_weak_topics" ON study_weak_topics FOR SELECT USING (
  user_id IN (SELECT id FROM customers WHERE phone = (auth.jwt() ->> 'phone'))
);
DROP POLICY IF EXISTS "own_study_decks" ON study_flashcard_decks;
CREATE POLICY "own_study_decks" ON study_flashcard_decks FOR SELECT USING (
  user_id IN (SELECT id FROM customers WHERE phone = (auth.jwt() ->> 'phone'))
);
DROP POLICY IF EXISTS "own_study_flashcards" ON study_flashcards;
CREATE POLICY "own_study_flashcards" ON study_flashcards FOR SELECT USING (
  deck_id IN (
    SELECT id FROM study_flashcard_decks
    WHERE user_id IN (SELECT id FROM customers WHERE phone = (auth.jwt() ->> 'phone'))
  )
);
DROP POLICY IF EXISTS "own_study_daily_usage" ON study_daily_usage;
CREATE POLICY "own_study_daily_usage" ON study_daily_usage FOR SELECT USING (
  user_id IN (SELECT id FROM customers WHERE phone = (auth.jwt() ->> 'phone'))
);
DROP POLICY IF EXISTS "own_study_streaks" ON study_streaks;
CREATE POLICY "own_study_streaks" ON study_streaks FOR SELECT USING (
  user_id IN (SELECT id FROM customers WHERE phone = (auth.jwt() ->> 'phone'))
);

-- Reference + catalog tables intentionally have NO public/owner policy: they are
-- read through the server (service_role) only. No USING (true) anywhere.



