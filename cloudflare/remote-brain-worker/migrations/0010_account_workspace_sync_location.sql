ALTER TABLE account_workspaces ADD COLUMN display_name TEXT NOT NULL DEFAULT '';
ALTER TABLE account_workspaces ADD COLUMN sync_backend_type TEXT NOT NULL DEFAULT 'local_directory';
ALTER TABLE account_workspaces ADD COLUMN sync_backend_config_json TEXT NOT NULL DEFAULT '{}';
