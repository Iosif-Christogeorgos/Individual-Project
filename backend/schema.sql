-- ============================================================================
-- CRYPSHARE MASTER SCHEMA (VERSION 1.2 - FINAL)
-- Includes:
-- 1. All Security Fixes (Integrity, DoS, Privacy, Zero-Knowledge)
-- 2. Supabase Warning Fixes (mutable search_path, RLS enablement)
-- 3. Maintenance Functions (cleanup_expired_nonces)
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

-- Ensure filename is gone (Legacy cleanup)
ALTER TABLE files DROP COLUMN IF EXISTS filename;

-- Enable RLS for standard protection
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
SET statement_timeout = '500ms'  -- DOS PROTECTION: Kill slow queries
AS $$
BEGIN
  -- Validate input format early (fail fast before touching indexes)
  IF lookup_id IS NULL OR lookup_id !~ '^file-[a-f0-9]{64}\.bin$' THEN
    RETURN;  -- Return empty result for invalid IDs
  END IF;

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


-- 4. UPLOAD_TOKENS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS upload_tokens (
  file_id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_upload_tokens_expires_at ON upload_tokens(expires_at);
ALTER TABLE upload_tokens ENABLE ROW LEVEL SECURITY; 
-- No policies = service role access only


-- 5. OWNERSHIP_NONCES TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS ownership_nonces (
  nonce TEXT PRIMARY KEY,
  used_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ownership_nonces_used_at ON ownership_nonces(used_at);
ALTER TABLE ownership_nonces ENABLE ROW LEVEL SECURITY;

-- [RESTORED] Cleanup function for expired nonces
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
SET search_path = public; 

DROP TRIGGER IF EXISTS update_public_keys_updated_at ON public_keys;
CREATE TRIGGER update_public_keys_updated_at
   BEFORE UPDATE ON public_keys
   FOR EACH ROW
   EXECUTE PROCEDURE update_updated_at_column();


-- 7. SECURE RPC: consume_upload_token
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
  DELETE FROM upload_tokens 
  WHERE file_id = p_file_id 
    AND token_hash = p_token_hash 
    AND expires_at > NOW()
  RETURNING TRUE INTO v_found;
  
  RETURN COALESCE(v_found, FALSE);
END;
$$;

GRANT EXECUTE ON FUNCTION consume_upload_token(TEXT, TEXT) TO service_role;


-- 8. SECURE RPC: consume_ownership_nonce
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


-- 9. SECURITY FIX: IMMUTABLE FILE INTEGRITY (DOUBLE LOCK)
-- ============================================================================
CREATE OR REPLACE FUNCTION prevent_file_tampering()
RETURNS TRIGGER AS $$
BEGIN
  -- LAYER 1: SQL Columns
  IF NEW.content_hash IS DISTINCT FROM OLD.content_hash THEN
      RAISE EXCEPTION 'Security Violation: content_hash is immutable.';
  END IF;

  IF NEW.size IS DISTINCT FROM OLD.size THEN
      RAISE EXCEPTION 'Security Violation: File size is immutable.';
  END IF;

  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
      RAISE EXCEPTION 'Security Violation: File ownership cannot be transferred.';
  END IF;

  -- LAYER 2: JSONB Metadata (Client View)
  IF (NEW.metadata->>'contentHash') IS DISTINCT FROM (OLD.metadata->>'contentHash') THEN
      RAISE EXCEPTION 'Security Violation: metadata.contentHash is immutable.';
  END IF;

  IF (NEW.metadata->>'size')::BIGINT IS DISTINCT FROM (OLD.metadata->>'size')::BIGINT THEN
      RAISE EXCEPTION 'Security Violation: metadata.size is immutable.';
  END IF;

  IF (NEW.metadata->>'version')::INT IS DISTINCT FROM (OLD.metadata->>'version')::INT THEN
      RAISE EXCEPTION 'Security Violation: metadata.version is immutable.';
  END IF;

  IF (OLD.metadata->'signature') IS NOT NULL 
     AND (NEW.metadata->'signature') IS DISTINCT FROM (OLD.metadata->'signature') THEN
      RAISE EXCEPTION 'Security Violation: metadata.signature is immutable once set.';
  END IF;

  IF (OLD.metadata->'encryptedKeys') IS NOT NULL 
     AND (NEW.metadata->'encryptedKeys') IS DISTINCT FROM (OLD.metadata->'encryptedKeys') THEN
      RAISE EXCEPTION 'Security Violation: metadata.encryptedKeys is immutable once set.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = public; -- [FIXED] Eliminates Supabase warning

DROP TRIGGER IF EXISTS trg_prevent_file_tampering ON files;
CREATE TRIGGER trg_prevent_file_tampering
  BEFORE UPDATE ON files
  FOR EACH ROW
  EXECUTE PROCEDURE prevent_file_tampering();


-- 10. SECURITY FIX: METADATA SEGREGATION (ZERO-KNOWLEDGE PRIVACY)
-- ============================================================================
CREATE TABLE IF NOT EXISTS file_recipients (
  file_id TEXT REFERENCES files(id) ON DELETE CASCADE,
  recipient_fingerprint TEXT NOT NULL,
  encrypted_key JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (file_id, recipient_fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_file_recipients_fingerprint ON file_recipients(recipient_fingerprint);

-- [FIXED] Enable RLS to create a "Default Deny" state. 
ALTER TABLE file_recipients ENABLE ROW LEVEL SECURITY;


-- 10.1 SECURE RPC: get_encrypted_key_for_recipient
-- ============================================================================
DROP FUNCTION IF EXISTS get_encrypted_key_for_recipient(TEXT, TEXT);
CREATE OR REPLACE FUNCTION get_encrypted_key_for_recipient(
  lookup_file_id TEXT,
  lookup_fingerprint TEXT
)
RETURNS JSONB
LANGUAGE sql 
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '500ms'
AS $$
  SELECT encrypted_key 
  FROM file_recipients 
  WHERE file_id = lookup_file_id 
  AND recipient_fingerprint = lookup_fingerprint;
$$;

GRANT EXECUTE ON FUNCTION get_encrypted_key_for_recipient(TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_encrypted_key_for_recipient(TEXT, TEXT) TO authenticated;