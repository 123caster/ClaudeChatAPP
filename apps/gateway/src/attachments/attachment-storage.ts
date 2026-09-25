import {
  chmodSync,
  createReadStream,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
  type ReadStream,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const storedNamePattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:bin|webp)$/i;

export type StoredAttachmentFile = {
  name: string;
  modifiedAtMs: number;
};

export class AttachmentStorage {
  private readonly originalsDirectory: string;
  private readonly previewsDirectory: string;

  public constructor(rootDirectory: string) {
    const root = resolve(rootDirectory);
    this.originalsDirectory = join(root, 'originals');
    this.previewsDirectory = join(root, 'previews');
    for (const directory of [root, this.originalsDirectory, this.previewsDirectory]) {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      try {
        chmodSync(directory, 0o700);
      } catch {
        // Windows does not expose POSIX directory modes; ACLs remain inherited.
      }
    }
  }

  public storeOriginal(data: Buffer | string): string {
    const name = `${randomUUID()}.bin`;
    writeFileSync(this.originalPath(name), data, { mode: 0o600, flag: 'wx' });
    return name;
  }

  public storePreview(data: Buffer): string {
    const name = `${randomUUID()}.webp`;
    writeFileSync(this.previewPath(name), data, { mode: 0o600, flag: 'wx' });
    return name;
  }

  public originalPath(name: string): string {
    return this.resolveStoredName(this.originalsDirectory, name, '.bin');
  }

  public previewPath(name: string): string {
    return this.resolveStoredName(this.previewsDirectory, name, '.webp');
  }

  public readOriginal(name: string): Buffer {
    return readFileSync(this.originalPath(name));
  }

  public previewStream(name: string): ReadStream {
    return createReadStream(this.previewPath(name));
  }

  public deleteOriginal(name: string | null): void {
    if (name) rmSync(this.originalPath(name), { force: true });
  }

  public deletePreview(name: string | null): void {
    if (name) rmSync(this.previewPath(name), { force: true });
  }

  public listOriginals(): StoredAttachmentFile[] {
    return this.listDirectory(this.originalsDirectory, '.bin');
  }

  public listPreviews(): StoredAttachmentFile[] {
    return this.listDirectory(this.previewsDirectory, '.webp');
  }

  private resolveStoredName(directory: string, name: string, extension: '.bin' | '.webp'): string {
    if (!storedNamePattern.test(name) || !name.toLowerCase().endsWith(extension)) {
      throw new Error('Invalid attachment storage name.');
    }
    return join(directory, name);
  }

  private listDirectory(directory: string, extension: '.bin' | '.webp'): StoredAttachmentFile[] {
    return readdirSync(directory)
      .filter((name) => storedNamePattern.test(name) && name.toLowerCase().endsWith(extension))
      .map((name) => ({ name, modifiedAtMs: statSync(join(directory, name)).mtimeMs }));
  }
}
