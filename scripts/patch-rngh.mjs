// Patches react-native-gesture-handler 2.32.0 for Gradle 9 compatibility.
// RNGH 2.32.0 ships a bare `import JsonSlurper` in android/build.gradle, which
// Gradle 9 no longer resolves (Groovy is removed from the default classpath).
// This rewrites it to the fully-qualified `import groovy.json.JsonSlurper`.
// Wired into the root postinstall so a `pnpm install` / `expo prebuild` refresh
// cannot silently reintroduce the breakage. Idempotent: re-running is a no-op.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const buildGradle = new URL(
  '../node_modules/react-native-gesture-handler/android/build.gradle',
  import.meta.url,
);

if (!existsSync(buildGradle)) {
  console.log('[patch-rngh] react-native-gesture-handler not found, skipping.');
  process.exit(0);
}

const source = readFileSync(buildGradle, 'utf8');
const bareImport = /^import JsonSlurper$/m;
const qualifiedImport = 'import groovy.json.JsonSlurper';

if (bareImport.test(source)) {
  writeFileSync(buildGradle, source.replace(bareImport, qualifiedImport), 'utf8');
  console.log('[patch-rngh] patched JsonSlurper import for Gradle 9.');
} else {
  console.log('[patch-rngh] already patched, nothing to do.');
}
