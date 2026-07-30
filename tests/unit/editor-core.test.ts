import { describe, expect, it } from 'vitest';
import {
  AutosaveController,
  EditorSession,
  detectRevisionConflict,
  sanitizeAnnotation,
  setTransformCommand,
  type PersistedDraft,
} from '../../packages/editor-core/src';
import { createDefaultSceneDocument } from '../../packages/scene-contract/src';

describe('editor core', () => {
  it('applies undo and redo through commands', () => {
    const session = new EditorSession(createDefaultSceneDocument());
    const before = session.snapshot().document.model.transform;
    const after = { ...before, position: [1, 2, 3] as [number, number, number] };
    session.dispatch(setTransformCommand(before, after));
    expect(session.snapshot().document.model.transform.position).toEqual([1, 2, 3]);
    expect(session.undo().data?.document.model.transform.position).toEqual([0, 0, 0]);
    expect(session.redo().data?.document.model.transform.position).toEqual([1, 2, 3]);
  });

  it('flushes autosave and increments revision', async () => {
    const session = new EditorSession(createDefaultSceneDocument());
    const autosave = new AutosaveController(session, {
      save: async (draft: PersistedDraft) => ({
        ok: true,
        code: 'KX_OK',
        data: { ...draft, revision: draft.revision + 1 },
      }),
    });
    const result = await autosave.flush();
    expect(result.ok).toBe(true);
    expect(session.snapshot().revision).toBe(1);
    expect(session.snapshot().saveState).toBe('Saved');
  });

  it('sanitizes annotation markdown and detects save conflicts', () => {
    const document = createDefaultSceneDocument();
    const sanitized = sanitizeAnnotation({
      id: 'a',
      title: '<bad>',
      markdown: '<script>alert(1)</script>**ok**',
      position: [0, 0, 0],
      surfaceNormal: [0, 1, 0],
      cameraPosition: document.camera.position,
      cameraTarget: document.camera.target,
      sortOrder: 0,
      visible: true,
    });
    expect(sanitized.title).toBe('bad');
    expect(sanitized.markdown).toContain('**ok**');
    expect(detectRevisionConflict(1, 2).code).toBe('KX_SAVE_CONFLICT');
  });
});
