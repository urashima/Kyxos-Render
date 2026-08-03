import { readFile, writeFile } from 'node:fs/promises';

const path = 'apps/studio/src/main.ts';
let source = await readFile(path, 'utf8');

function replaceOnce(input, search, replacement, label) {
  const count = input.split(search).length - 1;
  if (count === 0) {
    if (input.includes(replacement)) return input;
    throw new Error(`Patch marker not found: ${label}`);
  }
  if (count !== 1) throw new Error(`Patch marker is ambiguous (${count}): ${label}`);
  return input.replace(search, replacement);
}

source = replaceOnce(
  source,
  "import {\n  createApiClient,\n  hashBlob,",
  "import {\n  hashBlob,",
  'remove createApiClient import',
);
source = replaceOnce(
  source,
  "} from '@kyxos/api-client';\nimport {",
  "} from '@kyxos/api-client';\nimport { createDurableApiClient } from '@kyxos/api-client/durable';\nimport {",
  'add durable provider import',
);
source = replaceOnce(
  source,
  'const client = createApiClient({',
  'const client = createDurableApiClient({',
  'use durable provider',
);

const autosaveHelper = `
  async function flushDraftOrThrow(reason: string): Promise<number> {
    await autosave.flush();
    if (autosave.state !== 'Saved') {
      throw new Error(\`Draft save failed before \${reason}: \${autosave.state}.\`);
    }
    const persistedRevision = await client.drafts.getRevision(project.id);
    if (persistedRevision !== autosave.revision) {
      throw new Error(
        \`Draft revision mismatch before \${reason}: local \${autosave.revision}, persisted \${persistedRevision}.\`,
      );
    }
    globalThis.document.documentElement.dataset.durableDraftRevision = String(persistedRevision);
    return persistedRevision;
  }

`;
if (!source.includes('async function flushDraftOrThrow(reason: string)')) {
  source = replaceOnce(
    source,
    '  let previewMode = false;',
    `${autosaveHelper}  let previewMode = false;`,
    'insert strict draft flush helper',
  );
}

if (!source.includes("id: 'persist-import'")) {
  const activatePattern = /(    \{\n      id: 'activate-asset',[\s\S]*?\n    \},)\n  \]\);/;
  const match = source.match(activatePattern);
  if (!match) throw new Error('Patch marker not found: activate-asset step');
  const persistStep = `${match[1]}
    {
      id: 'persist-import',
      stage: 'building',
      progress: 0.98,
      async run(_current, signal) {
        throwIfImportAborted(signal);
        const revision = await flushDraftOrThrow('import completion');
        await flushWorkspace();
        if (workspaceDirty) {
          throw new Error('Workspace save failed during import completion.');
        }
        globalThis.document.documentElement.dataset.importDurable = 'true';
        globalThis.document.documentElement.dataset.importDurableRevision = String(revision);
      },
    },
  ]);`;
  source = source.replace(activatePattern, persistStep);
}

source = source.replace(
  /\n  scheduleImportPostprocess\(\{\n    label: `autosave:\$\{file\.name\}`,[\s\S]*?\n  \}\);\n/,
  '\n',
);

const publishPattern = /  async function publish\(\): Promise<void> \{[\s\S]*?\n  \}\n\n  async function loadWorkspaceScene/;
const publishReplacement = `  async function publish(): Promise<void> {
    if (!roleCan(currentRole, 'project:publish')) {
      showNotice('Your project role cannot publish releases.', true);
      return;
    }
    setBusy(publishButton, true);
    globalThis.document.documentElement.dataset.publishState = 'saving';
    delete globalThis.document.documentElement.dataset.publishError;
    try {
      showNotice('Saving the latest scene…');
      const revision = await flushDraftOrThrow('publish');
      await flushWorkspace();
      if (workspaceDirty) throw new Error('Workspace save did not complete.');

      globalThis.document.documentElement.dataset.publishState = 'capturing-thumbnail';
      let thumbnail: Blob | undefined;
      try {
        thumbnail = await adapter.captureThumbnail();
      } catch (error) {
        diagnosticConsole.log('warn', 'Publish thumbnail capture fell back.', error, 'publish');
      }

      globalThis.document.documentElement.dataset.publishState = 'publishing';
      showNotice('Creating immutable published version…');
      const release = await client.releases.publish(
        project.id,
        document.value,
        revision,
        thumbnail,
      );
      globalThis.document.documentElement.dataset.publishState = 'published';
      globalThis.document.documentElement.dataset.publishedReleaseId = release.id;
      globalThis.document.documentElement.dataset.publishedVersion = String(release.versionNumber);
      showPublishedNotice(release);
    } catch (error) {
      globalThis.document.documentElement.dataset.publishState = 'error';
      globalThis.document.documentElement.dataset.publishError = errorMessage(error);
      showNotice(errorMessage(error), true);
    } finally {
      setBusy(publishButton, false);
    }
  }

  async function loadWorkspaceScene`;
if (!source.includes("dataset.publishState = 'saving'")) {
  if (!publishPattern.test(source)) throw new Error('Patch marker not found: publish function');
  source = source.replace(publishPattern, publishReplacement);
}

await writeFile(path, source);
console.log('Patched Studio durable save/publish flow.');
