// ─── 文件系统适配器类型定义 ───

/**
 * 文件系统适配器接口
 *
 * 持久化层的抽象。默认实现为 FileSystemAdapter（读写磁盘文件），
 * 开发者可替换为 SQLite、Postgres 等，上层无感知。
 */
export interface FileSystemAdapter {
  /** 读取 JSON 文件，文件不存在返回 null */
  readJSON<T>(path: string): Promise<T | null>;
  /** 写入 JSON 文件（覆盖） */
  writeJSON(path: string, data: unknown): Promise<void>;
  /** 追加一行到文件末尾 */
  appendLine(path: string, line: string): Promise<void>;
  /** 读取文件所有行 */
  readLines(path: string): Promise<string[]>;
  /** 创建目录（递归） */
  mkdir(path: string): Promise<void>;
  /** 判断文件或目录是否存在 */
  exists(path: string): Promise<boolean>;
  /** 列出指定目录下的子目录名 */
  listDirs(path: string): Promise<string[]>;
}
