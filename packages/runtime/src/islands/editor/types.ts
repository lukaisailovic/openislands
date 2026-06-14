export interface EditorFile {
  /** Project-relative posix path, e.g. "data/docs/notes/idea.md". */
  path: string;
  name: string;
  ext: string;
  size: number;
  mtime: number;
}

export interface FileVersion {
  id: string;
  createdAt: number;
  byteSize: number;
  label?: string;
}

export interface EditorGroup {
  id: string;
  label?: string;
  icon?: string;
  match: string[];
}

export interface ContentEditorConfig {
  type: "content.editor";
  title?: string;
  span?: number;
  file?: string;
  dir?: string;
  include?: string[];
  csv?: boolean;
  readOnly?: boolean;
  groups?: EditorGroup[];
}
