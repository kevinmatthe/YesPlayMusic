CREATE TABLE IF NOT EXISTS music_deployment_scope (
 singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
 scope text NOT NULL CHECK (scope IN ('local', 'preview', 'production'))
);
