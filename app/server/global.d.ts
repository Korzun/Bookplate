declare global {
  namespace Express {
    interface Request {
      kosyncUser?: string;
      kosyncUserId?: string;
      user?: import('./services/jwt').AuthUser;
      opdsOwner?: { userId: string; username: string };
      opdsDevice?: import('./types').Device;
      mcpIdentity?: import('./services/mcp-token').McpTokenIdentity;
    }
  }
}

export {};
