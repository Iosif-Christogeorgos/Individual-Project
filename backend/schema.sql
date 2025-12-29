-- ============================================================================
-- CrypShare Database Schema (FINAL SECURE)
-- ============================================================================

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

-- POLICY 1: Owner Delete (Owners can delete their own files)
CREATE POLICY "Owner Delete" ON files 
  FOR DELETE USING (auth.uid() = owner_id);

-- POLICY 2: Owner Read (OPTIONAL - Allows owners to see a list of their OWN files)
-- Without this, users cannot see a "My Files" history, even if they uploaded them.
CREATE POLICY "Owner List Own Files" ON files 
  FOR SELECT USING (auth.uid() = owner_id);

-- NOTE: There is NO public SELECT policy. Public access is via the RPC below.
-- INSERT is handled by the Service Role (Backend) only.

-- Index for cleanup job
CREATE INDEX IF NOT EXISTS idx_files_expires_at ON files(expires_at);


-- ============================================================================
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
SET search_path = public -- Security Best Practice: Prevents search_path hijacking
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
  AND f.expires_at > NOW()  -- CRITICAL: Don't return metadata if file is expired
  LIMIT 1;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION get_file_metadata(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_file_metadata(TEXT) TO authenticated;


-- ============================================================================
-- 3. PUBLIC_KEYS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS public_keys (
  id TEXT PRIMARY KEY,
  owner_id UUID REFERENCES auth.users(id),     -- Linked to Auth
  username TEXT UNIQUE NOT NULL,
  display_name TEXT,
  fingerprint TEXT UNIQUE NOT NULL,
  encryption_public_key JSONB NOT NULL,
  signing_public_key JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Constraint: One profile per user (Optional but recommended)
  CONSTRAINT unique_owner UNIQUE (owner_id)
);

ALTER TABLE public_keys ENABLE ROW LEVEL SECURITY;

-- SELECT: Public can read keys (Directory)
CREATE POLICY "Public Read" ON public_keys 
  FOR SELECT USING (true);

-- INSERT: Authenticated users only, must match their ID
CREATE POLICY "Owner Insert" ON public_keys 
  FOR INSERT WITH CHECK (auth.uid() = owner_id);

-- UPDATE: Owner only
CREATE POLICY "Owner Update" ON public_keys 
  FOR UPDATE USING (auth.uid() = owner_id);

-- DELETE: Owner only
CREATE POLICY "Owner Delete" ON public_keys 
  FOR DELETE USING (auth.uid() = owner_id);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_public_keys_username ON public_keys(username);
CREATE INDEX IF NOT EXISTS idx_public_keys_fingerprint ON public_keys(fingerprint);