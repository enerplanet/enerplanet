CREATE TABLE IF NOT EXISTS webservice_instances (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255),
    ip VARCHAR(45) NOT NULL,
    port INTEGER NOT NULL CHECK (port > 0 AND port <= 65535),
    protocol VARCHAR(10) NOT NULL DEFAULT 'http' CHECK (protocol IN ('http', 'https')),
    available BOOLEAN DEFAULT FALSE,
    last_check TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_heartbeat TIMESTAMP,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP
);

-- Add new columns if they don't exist (idempotent)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'webservice_instances' AND column_name = 'busy') THEN
        ALTER TABLE webservice_instances ADD COLUMN busy BOOLEAN DEFAULT FALSE;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'webservice_instances' AND column_name = 'status') THEN
        ALTER TABLE webservice_instances ADD COLUMN status VARCHAR(20) DEFAULT 'inactive' CHECK (status IN ('active', 'inactive', 'maintenance'));
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'webservice_instances' AND column_name = 'status_reason') THEN
        ALTER TABLE webservice_instances ADD COLUMN status_reason TEXT;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'webservice_instances' AND column_name = 'endpoint') THEN
        ALTER TABLE webservice_instances ADD COLUMN endpoint VARCHAR(255);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'webservice_instances' AND column_name = 'auto_scaling') THEN
        ALTER TABLE webservice_instances ADD COLUMN auto_scaling BOOLEAN NOT NULL DEFAULT FALSE;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'webservice_instances' AND column_name = 'max_concurrency') THEN
        ALTER TABLE webservice_instances ADD COLUMN max_concurrency INTEGER NOT NULL DEFAULT 2 CHECK (max_concurrency >= 1 AND max_concurrency <= 100);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'webservice_instances' AND column_name = 'current_concurrency') THEN
        ALTER TABLE webservice_instances ADD COLUMN current_concurrency INTEGER NOT NULL DEFAULT 0 CHECK (current_concurrency >= 0);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'webservice_instances' AND column_name = 'created_by_id') THEN
        ALTER TABLE webservice_instances ADD COLUMN created_by_id VARCHAR(64);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'webservice_instances' AND column_name = 'created_by_user') THEN
        ALTER TABLE webservice_instances ADD COLUMN created_by_user VARCHAR(255);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'webservice_instances' AND column_name = 'created_by_user_email') THEN
        ALTER TABLE webservice_instances ADD COLUMN created_by_user_email VARCHAR(255);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'webservice_instances' AND column_name = 'cpu_usage') THEN
        ALTER TABLE webservice_instances ADD COLUMN cpu_usage DECIMAL(5,2);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'webservice_instances' AND column_name = 'memory_usage') THEN
        ALTER TABLE webservice_instances ADD COLUMN memory_usage DECIMAL(5,2);
    END IF;
    -- Drop columns if they exist
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'webservice_instances' AND column_name = 'current_jobs') THEN
        ALTER TABLE webservice_instances DROP COLUMN current_jobs;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'webservice_instances' AND column_name = 'max_concurrent_jobs') THEN
        ALTER TABLE webservice_instances DROP COLUMN max_concurrent_jobs;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'webservice_instances' AND column_name = 'priority') THEN
        ALTER TABLE webservice_instances DROP COLUMN priority;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'webservice_instances' AND column_name = 'capabilities') THEN
        ALTER TABLE webservice_instances DROP COLUMN capabilities;
    END IF;
END $$;

-- Create index on status column after it's been added
CREATE INDEX IF NOT EXISTS idx_webservice_instances_status ON webservice_instances(status);

-- Create index for querying webservices with concurrency info
CREATE INDEX IF NOT EXISTS idx_webservice_capacity ON webservice_instances(status, available, current_concurrency, max_concurrency) WHERE deleted_at IS NULL;

-- Add comments on new columns
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'webservice_instances' AND column_name = 'max_concurrency') THEN
        COMMENT ON COLUMN webservice_instances.max_concurrency IS 'Maximum number of concurrent requests the webservice can handle';
    END IF;
    
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'webservice_instances' AND column_name = 'current_concurrency') THEN
        COMMENT ON COLUMN webservice_instances.current_concurrency IS 'Current number of requests being processed (for monitoring only)';
    END IF;
    
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'webservice_instances' AND column_name = 'auto_scaling') THEN
        COMMENT ON COLUMN webservice_instances.auto_scaling IS 'Whether Docker auto-scaling is enabled for this webservice';
    END IF;
END $$;
