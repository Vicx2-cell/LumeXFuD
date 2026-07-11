-- LumeX Fud - Migration 107: quote/repost reference support for feed posts

ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS quoted_post_id UUID REFERENCES posts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reposted_post_id UUID REFERENCES posts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS posts_quoted_post_idx ON posts(quoted_post_id) WHERE quoted_post_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS posts_reposted_post_idx ON posts(reposted_post_id) WHERE reposted_post_id IS NOT NULL;
