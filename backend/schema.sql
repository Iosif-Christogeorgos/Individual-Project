-- ============================================================================
-- CRYPSHARE MASTER SCHEMA (AUTO-FIX & UPDATE)
-- ============================================================================

-- 1. FILES TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,                         -- File ID (matches R2 object key)
  owner_id UUID REFERENCES auth.users(id),     -- Links to authenticated user
  size BIGINT NOT NULL,
  content_hash TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  metadata JSONB NOT NULL
);

-- [CRITICAL FIX] Ensure filename is gone
ALTER TABLE files DROP COLUMN IF EXISTS filename;

ALTER TABLE files ENABLE ROW LEVEL SECURITY;

-- 1.1 FILES INDEXES
CREATE INDEX IF NOT EXISTS idx_files_expires_at ON files(expires_at);
CREATE INDEX IF NOT EXISTS idx_files_owner_id ON files(owner_id);

-- 1.2 FILES POLICIES
DROP POLICY IF EXISTS "Owner Delete" ON files;
CREATE POLICY "Owner Delete" ON files 
  FOR DELETE USING ((select auth.uid()) = owner_id);

DROP POLICY IF EXISTS "Owner List Own Files" ON files;
CREATE POLICY "Owner List Own Files" ON files 
  FOR SELECT USING ((select auth.uid()) = owner_id);


-- 2. SECURE RPC FUNCTION: get_file_metadata
-- ============================================================================
-- [FIX] Drop old function first because return type changed (removed filename)
DROP FUNCTION IF EXISTS get_file_metadata(text);

CREATE OR REPLACE FUNCTION get_file_metadata(lookup_id TEXT)
RETURNS TABLE (
  id TEXT,
  size BIGINT,
  content_hash TEXT,
  created_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  metadata JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER      -- Runs with admin privileges (bypasses RLS)
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    f.id,
    f.size,
    f.content_hash,
    f.created_at,
    f.expires_at,
    f.metadata
  FROM files f
  WHERE f.id = lookup_id
  AND f.expires_at > NOW()
  LIMIT 1;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_file_metadata(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_file_metadata(TEXT) TO authenticated;


-- 3. PUBLIC_KEYS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS public_keys (
  id TEXT PRIMARY KEY,
  owner_id UUID REFERENCES auth.users(id),
  username TEXT UNIQUE NOT NULL,
  fingerprint TEXT UNIQUE NOT NULL,
  encryption_public_key JSONB NOT NULL,
  signing_public_key JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT unique_owner UNIQUE (owner_id),
  CONSTRAINT valid_enc_key CHECK (jsonb_typeof(encryption_public_key) = 'object'),
  CONSTRAINT valid_sign_key CHECK (signing_public_key IS NULL OR jsonb_typeof(signing_public_key) = 'object'),
  CONSTRAINT username_length CHECK (char_length(username) >= 3 AND char_length(username) <= 50)
);

ALTER TABLE public_keys ENABLE ROW LEVEL SECURITY;

-- 3.1 PUBLIC_KEYS INDEXES
CREATE INDEX IF NOT EXISTS idx_public_keys_username ON public_keys(username);
CREATE INDEX IF NOT EXISTS idx_public_keys_fingerprint ON public_keys(fingerprint);

-- 3.2 PUBLIC_KEYS POLICIES
DROP POLICY IF EXISTS "Public Read" ON public_keys;
CREATE POLICY "Public Read" ON public_keys 
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Owner Insert" ON public_keys;
CREATE POLICY "Owner Insert" ON public_keys 
  FOR INSERT WITH CHECK ((select auth.uid()) = owner_id);

DROP POLICY IF EXISTS "Owner Update" ON public_keys;
CREATE POLICY "Owner Update" ON public_keys 
  FOR UPDATE USING ((select auth.uid()) = owner_id);

DROP POLICY IF EXISTS "Owner Delete" ON public_keys;
CREATE POLICY "Owner Delete" ON public_keys 
  FOR DELETE USING ((select auth.uid()) = owner_id);


-- 4. UPLOAD_TOKENS TABLE (Security: Persistent tokens for metadata authorization)
-- ============================================================================
CREATE TABLE IF NOT EXISTS upload_tokens (
  file_id TEXT PRIMARY KEY,                    -- File ID this token authorizes
  token_hash TEXT NOT NULL,                    -- SHA-256 hash of the token
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL             -- Tokens expire after 1 hour
);

-- Index for cleanup queries
CREATE INDEX IF NOT EXISTS idx_upload_tokens_expires_at ON upload_tokens(expires_at);

-- RLS: Only service role can access (no client access)
ALTER TABLE upload_tokens ENABLE ROW LEVEL SECURITY;

-- No policies = no client access, only service role can read/write


-- 5. OWNERSHIP_NONCES TABLE (Security: Prevent replay attacks on ownership proofs)
-- ============================================================================
CREATE TABLE IF NOT EXISTS ownership_nonces (
  nonce TEXT PRIMARY KEY,                      -- Unique nonce value
  used_at TIMESTAMPTZ DEFAULT NOW()           -- When the nonce was consumed
);

-- Index for cleanup queries  
CREATE INDEX IF NOT EXISTS idx_ownership_nonces_used_at ON ownership_nonces(used_at);

-- RLS: Only service role can access
ALTER TABLE ownership_nonces ENABLE ROW LEVEL SECURITY;

-- Cleanup function for expired nonces (older than 10 minutes)
CREATE OR REPLACE FUNCTION cleanup_expired_nonces()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM ownership_nonces WHERE used_at < NOW() - INTERVAL '10 minutes';
END;
$$;


-- 6. HELPER TRIGGERS
-- ============================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = NOW();
   RETURN NEW;
END;
$$ language 'plpgsql'
SET search_path = ''; 

DROP TRIGGER IF EXISTS update_public_keys_updated_at ON public_keys;
CREATE TRIGGER update_public_keys_updated_at
   BEFORE UPDATE ON public_keys
   FOR EACH ROW
   EXECUTE PROCEDURE update_updated_at_column();


-- 7. SECURE RPC: Consume upload token atomically
-- ============================================================================
CREATE OR REPLACE FUNCTION consume_upload_token(p_file_id TEXT, p_token_hash TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_found BOOLEAN := FALSE;
BEGIN
  -- Atomically check and delete the token
  DELETE FROM upload_tokens 
  WHERE file_id = p_file_id 
    AND token_hash = p_token_hash 
    AND expires_at > NOW()
  RETURNING TRUE INTO v_found;
  
  RETURN COALESCE(v_found, FALSE);
END;
$$;

GRANT EXECUTE ON FUNCTION consume_upload_token(TEXT, TEXT) TO service_role;


-- 8. SECURE RPC: Check and consume ownership nonce atomically
-- ============================================================================
CREATE OR REPLACE FUNCTION consume_ownership_nonce(p_nonce TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted BOOLEAN := FALSE;
BEGIN
  -- Try to insert the nonce (will fail if already used due to PRIMARY KEY)
  BEGIN
    INSERT INTO ownership_nonces (nonce, used_at) VALUES (p_nonce, NOW());
    v_inserted := TRUE;
  EXCEPTION WHEN unique_violation THEN
    v_inserted := FALSE;
  END;
  
  RETURN v_inserted;
END;
$$;

GRANT EXECUTE ON FUNCTION consume_ownership_nonce(TEXT) TO service_role;