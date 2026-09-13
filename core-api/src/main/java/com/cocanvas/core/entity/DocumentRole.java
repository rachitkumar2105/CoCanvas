package com.cocanvas.core.entity;

public enum DocumentRole {
  OWNER,
  EDITOR,
  VIEWER;

  public boolean canWrite() {
    return this == OWNER || this == EDITOR;
  }

  public boolean canManagePermissions() {
    return this == OWNER;
  }
}
