import { readdir, readFile } from 'node:fs/promises';

/**
 * Applies every checked-in migration to a D1 database, in order.
 *
 * This is deliberately dynamic: a hardcoded filename list silently skips any
 * migration added later, which is how a schema change can reach a test fixture
 * without ever being exercised. Line comments are stripped before the statements
 * are joined, otherwise a comment would swallow the rest of the file.
 */
export async function applyMigrations(db: D1Database): Promise<string[]> {
  const files = (await readdir('migrations')).filter(name => name.endsWith('.sql')).sort();
  for (const file of files) {
    const source = (await readFile(`migrations/${file}`, 'utf8'))
      .split('\n')
      .filter(line => !line.trimStart().startsWith('--'))
      .join(' ');
    await db.exec(source);
  }
  return files;
}
