-- ============================================================================
-- CRYPSHARE MASTER SCHEMA (FINAL OPTIMIZED)
-- Includes: All Tables, Security Fixes, and Performance Tweaks
-- ============================================================================

-- 1. FILES TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,                         -- File ID (matches R2 object key)
  owner_id UUID REFERENCES auth.users(id),     -- Links to authenticated user
  filename TEXT NOT NULL,
  size BIGINT NOT NULL,
  content_hash TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  metadata JSONB NOT NULL
);

ALTER TABLE files ENABLE ROW LEVEL SECURITY;

-- 1.1 FILES INDEXES (Performance)
CREATE INDEX IF NOT EXISTS idx_files_expires_at ON files(expires_at);
CREATE INDEX IF NOT EXISTS idx_files_owner_id ON files(owner_id); -- Optimization for dashboards

-- 1.2 FILES POLICIES (Optimized with SELECT wrapper)
-- Drop old policies first to ensure we replace them with the fast versions
DROP POLICY IF EXISTS "Owner Delete" ON files;
CREATE POLICY "Owner Delete" ON files 
  FOR DELETE USING ((select auth.uid()) = owner_id);

DROP POLICY IF EXISTS "Owner List Own Files" ON files;
CREATE POLICY "Owner List Own Files" ON files 
  FOR SELECT USING ((select auth.uid()) = owner_id);


-- 2. SECURE RPC FUNCTION: get_file_metadata
-- ============================================================================
CREATE OR REPLACE FUNCTION get_file_metadata(lookup_id TEXT)
RETURNS TABLE (
  id TEXT,
  filename TEXT,
  size BIGINT,
  content_hash TEXT,
  created_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  metadata JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER      -- Runs with admin privileges (bypasses RLS)
SET search_path = public -- Security Fix: Locks search path to public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    f.id,
    f.filename,
    f.size,
    f.content_hash,
    f.created_at,
    f.expires_at,
    f.metadata
  FROM files f
  WHERE f.id = lookup_id
  AND f.expires_at > NOW()  -- Returns nothing if file is expired
  LIMIT 1;
END;
$$;

-- Grant execute permission to everyone (public/anon)
GRANT EXECUTE ON FUNCTION get_file_metadata(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_file_metadata(TEXT) TO authenticated;


-- 3. PUBLIC_KEYS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS public_keys (
  id TEXT PRIMARY KEY,
  owner_id UUID REFERENCES auth.users(id),     -- Linked to Auth
  username TEXT UNIQUE NOT NULL,               -- Unique identifier for the user
  fingerprint TEXT UNIQUE NOT NULL,
  encryption_public_key JSONB NOT NULL,
  signing_public_key JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT unique_owner UNIQUE (owner_id),
  CONSTRAINT valid_enc_key CHECK (jsonb_typeof(encryption_public_key) = 'object'),
  CONSTRAINT valid_sign_key CHECK (signing_public_key IS NULL OR jsonb_typeof(signing_public_key) = 'object'),
  CONSTRAINT username_length CHECK (char_length(username) >= 3 AND char_length(username) <= 50)
);

ALTER TABLE public_keys ENABLE ROW LEVEL SECURITY;

-- 3.1 PUBLIC_KEYS INDEXES
CREATE INDEX IF NOT EXISTS idx_public_keys_username ON public_keys(username);
CREATE INDEX IF NOT EXISTS idx_public_keys_fingerprint ON public_keys(fingerprint);

-- 3.2 PUBLIC_KEYS POLICIES (Optimized with SELECT wrapper)
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


-- 4. HELPER TRIGGERS
-- ============================================================================
-- Security Fix: Added SET search_path = '' to remove warning
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql'
SET search_path = ''; 

-- Re-attach trigger (Safe to run multiple times)
DROP TRIGGER IF EXISTS update_public_keys_updated_at ON public_keys;
CREATE TRIGGER update_public_keys_updated_at
    BEFORE UPDATE ON public_keys
    FOR EACH ROW
    EXECUTE PROCEDURE update_updated_at_column();