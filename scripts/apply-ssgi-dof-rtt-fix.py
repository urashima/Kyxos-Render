from pathlib import Path

path = Path('packages/viewer/src/KyxosViewer.ts')
text = path.read_text()

flags_needle = """    const dofBeforeTraa = !useSSAA && this.effects.dof.enabled && this.effects.traa.enabled;
    const applyDepthOfField = () => {
"""
flags_replacement = """    // SSGI produces AO/GI through FRAME-updated pass textures and then
    // combines them into a generic TSL expression. Passing that expression into
    // DepthOfFieldNode creates a nested RTT/FRAME graph that can deadlock or crash
    // the renderer. When SSGI and DoF are both active, blur the stable Beauty
    // texture first, compose SSGI afterward, and let TRAA resolve the full result.
    const dofBeforeSsgi = !useSSAA && this.effects.dof.enabled && this.effects.ssgi.enabled;
    const dofBeforeTraa =
      !useSSAA &&
      this.effects.dof.enabled &&
      this.effects.traa.enabled &&
      !dofBeforeSsgi;
    const dofAppliedBeforeFinal = dofBeforeSsgi || dofBeforeTraa;
    const applyDepthOfField = () => {
"""
if text.count(flags_needle) != 1:
    raise SystemExit(f'Expected one DoF ordering flag block, found {text.count(flags_needle)}')
text = text.replace(flags_needle, flags_replacement, 1)

ssgi_needle = """      this.warnings.delete('capture-ssaa');

      if (this.effects.ssgi.enabled) {
"""
ssgi_replacement = """      this.warnings.delete('capture-ssaa');

      if (dofBeforeSsgi) applyDepthOfField();

      if (this.effects.ssgi.enabled) {
"""
if text.count(ssgi_needle) != 1:
    raise SystemExit(f'Expected one SSGI insertion point, found {text.count(ssgi_needle)}')
text = text.replace(ssgi_needle, ssgi_replacement, 1)

final_needle = """    if (!dofBeforeTraa) applyDepthOfField();
"""
final_replacement = """    if (!dofAppliedBeforeFinal) applyDepthOfField();
"""
if text.count(final_needle) != 1:
    raise SystemExit(f'Expected one final DoF call, found {text.count(final_needle)}')
text = text.replace(final_needle, final_replacement, 1)

path.write_text(text)
