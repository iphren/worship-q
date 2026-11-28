/** Undoes the MCP migration, for tests that bring an older database up to date. */
import type { Database } from '../db';

export function undoMcpMigration(db: Database): void {
  db.exec('DROP TABLE mcp_token');
  db.exec('DROP TABLE mcp_authorization');
  db.exec('DROP TABLE oauth_client');
  db.exec('DROP TABLE mcp_user_workspace');
  db.exec('DROP TABLE mcp_user');
  db.exec('ALTER TABLE auth_state DROP COLUMN mcp_authorization_id');
  db.exec('ALTER TABLE auth_state DROP COLUMN flow');
}
