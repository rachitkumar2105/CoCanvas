export type DocumentType = "DOCUMENT" | "WHITEBOARD";
export type DocumentRole = "OWNER" | "EDITOR" | "VIEWER";
export type WorkspaceRole = "OWNER" | "MEMBER";

export interface AuthResponse {
  userId: string;
  name: string;
  email: string;
  accessToken: string;
}

export interface WorkspaceResponse {
  id: string;
  name: string;
  ownerId: string;
  myRole: WorkspaceRole;
  createdAt: string;
}

export interface DocumentResponse {
  id: string;
  workspaceId: string;
  title: string;
  type: DocumentType;
  createdBy: string;
  myRole: DocumentRole | null;
  createdAt: string;
  updatedAt: string;
}

export interface CollabTokenResponse {
  token: string;
  expiresInSeconds: number;
}

export interface VersionResponse {
  id: string;
  documentId: string;
  label: string | null;
  createdAt: string;
}
