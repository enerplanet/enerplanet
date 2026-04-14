CREATE TABLE IF NOT EXISTS pylovo_instances (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    ip VARCHAR(255) NOT NULL,
    port INTEGER NOT NULL CHECK (port > 0 AND port <= 65535),
    protocol VARCHAR(10) NOT NULL DEFAULT 'http' CHECK (protocol IN ('http', 'https')),
    endpoint VARCHAR(255),
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'maintenance')),
    available BOOLEAN NOT NULL DEFAULT TRUE,
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    last_check TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_heartbeat TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pylovo_instances_status ON pylovo_instances(status);
CREATE INDEX IF NOT EXISTS idx_pylovo_instances_primary ON pylovo_instances(is_primary) WHERE deleted_at IS NULL;

-- Seed the default PyLovo instance
INSERT INTO pylovo_instances (name, ip, port, protocol, status, available, is_primary)
SELECT 'PyLovo Grid Engine', 'localhost', 8086, 'http', 'active', true, true
WHERE NOT EXISTS (SELECT 1 FROM pylovo_instances WHERE name = 'PyLovo Grid Engine');
