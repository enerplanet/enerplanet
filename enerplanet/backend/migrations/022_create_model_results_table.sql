-- Create model_results table
CREATE TABLE IF NOT EXISTS model_results (
    id SERIAL PRIMARY KEY,
    model_id INTEGER NOT NULL,
    user_id VARCHAR(255),
    
    zip_path TEXT NOT NULL,
    extracted_path TEXT NOT NULL,
    tif_file_path TEXT NOT NULL,
    tif_file_name VARCHAR(255) NOT NULL,
    
    geoserver_workspace VARCHAR(255),
    geoserver_layer_name VARCHAR(255),
    geoserver_store_name VARCHAR(255),
    
    file_size_bytes BIGINT DEFAULT 0,
    extraction_status VARCHAR(32) DEFAULT 'pending',
    geoserver_status VARCHAR(32) DEFAULT 'pending',
    error_message TEXT,
    
    metadata JSONB,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT fk_model_results_model FOREIGN KEY (model_id) REFERENCES models(id) ON DELETE CASCADE
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_model_results_model_id ON model_results(model_id);
CREATE INDEX IF NOT EXISTS idx_model_results_user_id ON model_results(user_id);
CREATE INDEX IF NOT EXISTS idx_model_results_geoserver_layer_name ON model_results(geoserver_layer_name);
CREATE INDEX IF NOT EXISTS idx_model_results_extraction_status ON model_results(extraction_status);
CREATE INDEX IF NOT EXISTS idx_model_results_geoserver_status ON model_results(geoserver_status);
