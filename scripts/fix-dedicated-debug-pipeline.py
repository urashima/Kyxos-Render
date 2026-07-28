from pathlib import Path

path = Path('packages/viewer/src/KyxosViewer.ts')
text = path.read_text()
needle = """    this.debugNodes.set('emissive', renderOutput(emissiveNode));
    this.warnings.delete('emissive-prepass');

    let source: any = beauty;
"""
replacement = """    this.debugNodes.set('emissive', renderOutput(emissiveNode));
    this.warnings.delete('emissive-prepass');

    // Debug buffers use a dedicated short graph. Building the complete temporal
    // and post-processing stack and then selecting an early pass does not
    // reliably schedule that pass in the pinned Three.js RenderPipeline.
    if (this.debugView !== 'final') {
      this.beforeNode = renderOutput(beauty);
      this.finalNode = this.beforeNode;
      pipeline.outputNode = this.debugNodes.get(this.debugView) ?? this.beforeNode;
      pipeline.needsUpdate = true;
      this.warnings.delete('pipeline');
      this.dispatchEvent(new CustomEvent('pipeline-rebuilt', { detail: { reason } }));
      return;
    }

    let source: any = beauty;
"""
if text.count(needle) != 1:
    raise SystemExit(f'Expected one debug-pipeline insertion marker, found {text.count(needle)}')
path.write_text(text.replace(needle, replacement, 1))
