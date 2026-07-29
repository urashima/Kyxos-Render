from pathlib import Path

path = Path('packages/viewer/src/KyxosViewer.ts')
text = path.read_text()
needle = """      try {
        source = dof(
          source,
          viewZ,
          uniform(Number(this.effects.dof.focusDistance ?? 4)),
          uniform(Number(this.effects.dof.focalLength ?? 45)),
          uniform(Number(this.effects.dof.bokehScale ?? 1.5)),
        );
      } catch (error) {
"""
replacement = """      try {
        // DepthOfFieldNode updates at FRAME time and immediately reads the input
        // texture dimensions. When the upstream result is a generic TSL expression
        // (notably the SSGI AO/GI composite), dof() otherwise creates a hidden
        // RTTNode that updates later at RENDER time. Materialize and initialize
        // that texture explicitly so it is ready before DoF allocates its passes.
        const dofInput = convertToTexture(source);
        if (dofInput !== source) {
          const drawingSize = this.renderer.getDrawingBufferSize(new THREE.Vector2());
          if (typeof dofInput.setSize === 'function') {
            dofInput.setSize(drawingSize.x, drawingSize.y);
          }
          dofInput.updateBeforeType = THREE.NodeUpdateType.FRAME;
          this.nodes.push(dofInput);
        }

        const dofNode = dof(
          dofInput,
          viewZ,
          uniform(Number(this.effects.dof.focusDistance ?? 4)),
          uniform(Number(this.effects.dof.focalLength ?? 45)),
          uniform(Number(this.effects.dof.bokehScale ?? 1.5)),
        );
        source = dofNode;
        this.nodes.push(dofNode);
      } catch (error) {
"""
if text.count(needle) != 1:
    raise SystemExit(f'Expected one DoF construction block, found {text.count(needle)}')
path.write_text(text.replace(needle, replacement, 1))
